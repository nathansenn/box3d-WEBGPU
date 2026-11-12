/**
 * A coupled scene in the Physics Lab: stepping it through its Simulation, and drawing the parts
 * that are not rigid bodies with the streams the Lab renderer already has. No render pass is added.
 *
 *   - Rigid bodies: the world's own instance rows, as for any scene.
 *   - Grains: one sphere row each, appended to the instance stream after the bodies.
 *   - Cloths: one mesh row each, appended to the instance stream. Its triangle list is rebuilt
 *     from the node positions after every step, with smooth normals, and written for both sides.
 *   - Water basins: one mesh row each: the free surface as a height field over the basin, with
 *     four side faces down to the floor, in the renderer's translucent material.
 *   - Fixed grain walls: boxes, spheres and capsules as rows of those shapes, cylinders, rings
 *     and cones as mesh rows, all translucent. A `plane` wall is not drawn.
 *   - Cables and frame elements: segments of the renderer's rope stream (straight square tubes
 *     between node positions), as the SI bridge draws its stays.
 *   - The water surface also gets a wire grid in the renderer's line stream (the one the scene
 *     editor draws its frames with): seen from above, the translucent surface alone is faint.
 *
 * `CoupledSceneView` is an `InstanceBufferSource`: it holds a copy of the world's rows followed
 * by its own, so the renderer's shape plan (boxes, spheres, capsules, own geometry) covers both.
 * Mesh rows use `shapeGeometry`, the hook hull and mesh bodies use; a mesh that changed is a new
 * object, which is what makes the renderer upload it again.
 *
 * Everything here is plain arithmetic with no DOM and no GPU, so it runs in node
 * (tests/physics/lab-coupled-scenes.test.mjs).
 */
import type { NativeBodyHandle } from '../engine/native-world.ts';
import type { Scene, SceneGrainWall } from '../engine/scene-format.ts';
import type { SimulationEnergy, SimulationEvent } from '../engine/simulation.ts';
import type { DebugLine, GpuSegmentGridFrame, InstanceBufferSource, InstanceGeometry } from '../types';
import { exactTransformHash, type LabLoadedScene } from './scene-host.ts';

const KIND_BOX = 0, KIND_SPHERE = 1, KIND_CAPSULE = 2, KIND_MESH = 4;
/** Instance colour alpha: 1 is the plain opaque material, -4 the renderer's translucent one (src/webgpu/renderer.ts). */
const OPAQUE = 1, TRANSLUCENT = -4;
const WATER_COLOR = [0.16, 0.52, 0.78], CLOTH_COLOR = [0.24, 0.55, 0.50], GRAIN_COLORS = [[0.83, 0.66, 0.36], [0.62, 0.72, 0.80], [0.74, 0.50, 0.42]], WALL_COLOR = [0.70, 0.78, 0.84];
const CABLE_COLOR = [0.88, 0.89, 0.90], FRAME_COLOR = [0.76, 0.30, 0.20];
/** Limits of the renderer's rope stream (MAX_ROPE_NODES and MAX_ROPE_SEGMENTS in src/webgpu/renderer.ts). */
export const COUPLED_DRAW_LIMITS = Object.freeze({ lineNodes: 4096, lineSegments: 4096, waterQuads: 16384, events: 64, waterGridLines: 48 });
const ROUND = 32;

/** Does this scene need the coupled view: has it a section that is not rigid bodies and joints? */
export function sceneIsCoupled(scene: Scene): boolean {
  return (scene.water?.length ?? 0) + (scene.cables?.length ?? 0) + (scene.frames?.length ?? 0) + (scene.cloths?.length ?? 0) + (scene.grains?.length ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// State hash
// ---------------------------------------------------------------------------

/** Two FNV-1a lanes over bytes, 16 hex digits. Not cryptographic: it tells two runs apart. */
class Fnv {
  private a = 0x811c9dc5;
  private b = 0xc2b2ae35;
  bytes(view: ArrayBufferView): void {
    const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
    let a = this.a, b = this.b;
    for (let i = 0; i < bytes.length; i++) { const v = bytes[i]!; a = Math.imul(a ^ v, 0x01000193); b = Math.imul(b ^ v, 0x01000197) + 0x9e3779b9 | 0; }
    this.a = a; this.b = b;
  }
  word(value: number): void { this.bytes(new Uint32Array([value >>> 0])); }
  digest(): string { return (this.a >>> 0).toString(16).padStart(8, '0') + (this.b >>> 0).toString(16).padStart(8, '0'); }
}

/**
 * A hash of everything a coupled scene's solvers hold, bit for bit: the exact float32 bits of every body
 * transform, then the float64 arrays of each basin (eta, u, v), cable (node positions and velocities), frame
 * (displacements and velocities), cloth (node positions and velocities) and grain set (positions, velocities,
 * spins, and which grains are left), in file order. Two runs with equal hashes after the same number of steps
 * took the same steps. For a rigid-only scene it covers the transforms only.
 */
export function coupledStateHash(loaded: LabLoadedScene): string {
  const h = new Fnv(), scene = loaded.scene;
  h.word(exactTransformHash(loaded.builder.world.native));
  for (const basin of scene.water ?? []) { const w = loaded.water.get(basin.id)!; h.bytes(w.eta); h.bytes(w.u); h.bytes(w.v); }
  for (const cable of scene.cables ?? []) { const v = loaded.cables.get(cable.id)!.couplingViews(); h.bytes(v.positions); h.bytes(v.velocities); }
  for (const frame of scene.frames ?? []) { const v = loaded.frames.get(frame.id)!.couplingViews(); h.bytes(v.displacements); h.bytes(v.velocities); }
  for (const cloth of scene.cloths ?? []) { const c = loaded.cloths.get(cloth.id)!.cloth; h.bytes(c.positions); h.bytes(c.velocities); }
  for (const set of scene.grains ?? []) {
    const g = loaded.grains.get(set.id)!.granular, n = g.grainCount;
    h.bytes(g.positions.subarray(0, 3 * n)); h.bytes(g.velocities.subarray(0, 3 * n)); h.bytes(g.angularVelocities.subarray(0, 3 * n)); h.bytes(g.alive.subarray(0, n));
  }
  return h.digest();
}

// ---------------------------------------------------------------------------
// Triangle lists: position.xyz, normal.xyz per vertex, three vertices per triangle
// ---------------------------------------------------------------------------

/**
 * A triangle mesh with one normal per node (the area-weighted mean of its triangles' normals), written for
 * both sides: each triangle once as given, and once reversed with the normals negated, because the solid
 * pipeline culls back faces and a cloth is seen from above and from below. `out` must hold
 * `triangles.length * 2 * 6` floats; `normals` is scratch of `3 * nodes` floats.
 */
export function writeTwoSidedMesh(positions: ArrayLike<number>, triangles: ArrayLike<number>, normals: Float32Array, out: Float32Array): number {
  normals.fill(0);
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = 3 * triangles[t]!, b = 3 * triangles[t + 1]!, c = 3 * triangles[t + 2]!;
    const ux = positions[b]! - positions[a]!, uy = positions[b + 1]! - positions[a + 1]!, uz = positions[b + 2]! - positions[a + 2]!;
    const vx = positions[c]! - positions[a]!, vy = positions[c + 1]! - positions[a + 1]!, vz = positions[c + 2]! - positions[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const k of [a, b, c]) { normals[k] += nx; normals[k + 1] += ny; normals[k + 2] += nz; }
  }
  for (let k = 0; k + 2 < normals.length; k += 3) {
    const length = Math.hypot(normals[k]!, normals[k + 1]!, normals[k + 2]!);
    if (length > 0) { normals[k] /= length; normals[k + 1] /= length; normals[k + 2] /= length; } else normals[k + 1] = 1;
  }
  let o = 0;
  const put = (k: number, sign: number): void => {
    out[o++] = positions[k]!; out[o++] = positions[k + 1]!; out[o++] = positions[k + 2]!;
    out[o++] = sign * normals[k]!; out[o++] = sign * normals[k + 1]!; out[o++] = sign * normals[k + 2]!;
  };
  for (let t = 0; t + 2 < triangles.length; t += 3) {
    const a = 3 * triangles[t]!, b = 3 * triangles[t + 1]!, c = 3 * triangles[t + 2]!;
    put(a, 1); put(b, 1); put(c, 1);
    put(a, -1); put(c, -1); put(b, -1);
  }
  return o;
}

/** How a basin's surface is sampled for drawing: every `stride`-th cell, so that it has at most COUPLED_DRAW_LIMITS.waterQuads quads. */
export function waterDrawGrid(cols: number, rows: number): { stride: number; nx: number; nz: number; floats: number } {
  let stride = 1;
  while (Math.ceil(cols / stride) * Math.ceil(rows / stride) > COUPLED_DRAW_LIMITS.waterQuads) stride++;
  const nx = Math.ceil(cols / stride), nz = Math.ceil(rows / stride);
  // Top: two triangles per quad. Sides: two triangles per edge quad on four sides. Six floats per vertex.
  return { stride, nx, nz, floats: (nx * nz * 6 + (2 * nx + 2 * nz) * 6) * 6 };
}

/**
 * The free surface of a basin as a triangle list. The solver holds one elevation per cell; a drawn vertex sits
 * on a cell corner and takes the mean of the cells that touch it, so the surface reaches the basin walls. The
 * four sides run from the surface down to the floor. `heights` is scratch of `(nx + 1) * (nz + 1)` floats.
 */
export function writeWaterMesh(
  eta: ArrayLike<number>, cols: number, rows: number, dx: number, dz: number, restDepth: number, origin: readonly number[],
  grid: { stride: number; nx: number; nz: number }, heights: Float32Array, out: Float32Array,
): number {
  const { stride, nx, nz } = grid, ox = origin[0]!, oy = origin[1]!, oz = origin[2]!, top = oy + restDepth;
  const xAt = (i: number): number => ox + Math.min(cols, i * stride) * dx, zAt = (j: number): number => oz + Math.min(rows, j * stride) * dz;
  for (let j = 0; j <= nz; j++) for (let i = 0; i <= nx; i++) {
    const ci = Math.min(cols, i * stride), cj = Math.min(rows, j * stride);
    let sum = 0, count = 0;
    for (let b = cj - 1; b <= cj; b++) for (let a = ci - 1; a <= ci; a++) if (a >= 0 && a < cols && b >= 0 && b < rows) { sum += eta[a + cols * b]!; count++; }
    heights[i + (nx + 1) * j] = top + (count > 0 ? sum / count : 0);
  }
  const h = (i: number, j: number): number => heights[Math.max(0, Math.min(nx, i)) + (nx + 1) * Math.max(0, Math.min(nz, j))]!;
  let o = 0;
  const put = (x: number, y: number, z: number, nx_: number, ny_: number, nz_: number): void => { out[o++] = x; out[o++] = y; out[o++] = z; out[o++] = nx_; out[o++] = ny_; out[o++] = nz_; };
  const surface = (i: number, j: number): void => {
    const sx = (h(i - 1, j) - h(i + 1, j)) / (xAt(Math.min(nx, i + 1)) - xAt(Math.max(0, i - 1)) || 1), sz = (h(i, j - 1) - h(i, j + 1)) / (zAt(Math.min(nz, j + 1)) - zAt(Math.max(0, j - 1)) || 1);
    const length = Math.hypot(sx, 1, sz);
    put(xAt(i), h(i, j), zAt(j), sx / length, 1 / length, sz / length);
  };
  // Counter-clockwise seen from above (+y).
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    surface(i, j); surface(i, j + 1); surface(i + 1, j + 1);
    surface(i, j); surface(i + 1, j + 1); surface(i + 1, j);
  }
  const side = (x0: number, z0: number, y0: number, x1: number, z1: number, y1: number, nx_: number, nz_: number): void => {
    put(x0, oy, z0, nx_, 0, nz_); put(x1, y1, z1, nx_, 0, nz_); put(x0, y0, z0, nx_, 0, nz_);
    put(x0, oy, z0, nx_, 0, nz_); put(x1, oy, z1, nx_, 0, nz_); put(x1, y1, z1, nx_, 0, nz_);
  };
  for (let i = 0; i < nx; i++) {
    side(xAt(i + 1), zAt(0), h(i + 1, 0), xAt(i), zAt(0), h(i, 0), 0, -1);
    side(xAt(i), zAt(nz), h(i, nz), xAt(i + 1), zAt(nz), h(i + 1, nz), 0, 1);
  }
  for (let j = 0; j < nz; j++) {
    side(xAt(0), zAt(j), h(0, j), xAt(0), zAt(j + 1), h(0, j + 1), -1, 0);
    side(xAt(nx), zAt(j + 1), h(nx, j + 1), xAt(nx), zAt(j), h(nx, j), 1, 0);
  }
  return o;
}

function rotate(q: readonly number[] | undefined, v: readonly [number, number, number]): [number, number, number] {
  if (!q) return [v[0], v[1], v[2]];
  const [x, y, z, w] = q as [number, number, number, number];
  const tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}

/**
 * A cylinder, ring or cone wall of a grain set as a two-sided triangle list in world space: the straight line
 * from (r0, z0) to (r1, z1) turned about the wall's axis. Null for the other wall shapes.
 */
export function grainWallMesh(wall: SceneGrainWall): Float32Array | null {
  const shape = wall.shape;
  let r0: number, z0: number, r1: number, z1: number;
  if (shape.kind === 'cylinder') { r0 = r1 = shape.radius; z0 = shape.from; z1 = shape.to; }
  else if (shape.kind === 'annulus') { r0 = shape.innerRadius; r1 = shape.outerRadius; z0 = z1 = shape.offset ?? 0; }
  else if (shape.kind === 'frustum') { r0 = shape.r0; z0 = shape.z0; r1 = shape.r1; z1 = shape.z1; }
  else return null;
  const raw = shape.axis ?? [0, 1, 0], length = Math.hypot(raw[0], raw[1], raw[2]) || 1, axis: [number, number, number] = [raw[0] / length, raw[1] / length, raw[2] / length];
  // Two unit vectors across the axis.
  const seed: [number, number, number] = Math.abs(axis[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let e1: [number, number, number] = [axis[1] * seed[2] - axis[2] * seed[1], axis[2] * seed[0] - axis[0] * seed[2], axis[0] * seed[1] - axis[1] * seed[0]];
  const l1 = Math.hypot(e1[0], e1[1], e1[2]); e1 = [e1[0] / l1, e1[1] / l1, e1[2] / l1];
  const e2: [number, number, number] = [axis[1] * e1[2] - axis[2] * e1[1], axis[2] * e1[0] - axis[0] * e1[2], axis[0] * e1[1] - axis[1] * e1[0]];
  const position = wall.position ?? [0, 0, 0], q = wall.rotation;
  const point = (radius: number, along: number, angle: number): [number, number, number] => {
    const c = Math.cos(angle), s = Math.sin(angle);
    const local = rotate(q, [radius * (c * e1[0] + s * e2[0]) + along * axis[0], radius * (c * e1[1] + s * e2[1]) + along * axis[1], radius * (c * e1[2] + s * e2[2]) + along * axis[2]]);
    return [local[0] + position[0], local[1] + position[1], local[2] + position[2]];
  };
  const out = new Float32Array(ROUND * 4 * 3 * 6);
  let o = 0;
  const triangle = (a: readonly number[], b: readonly number[], c: readonly number[]): void => {
    const ux = b[0]! - a[0]!, uy = b[1]! - a[1]!, uz = b[2]! - a[2]!, vx = c[0]! - a[0]!, vy = c[1]! - a[1]!, vz = c[2]! - a[2]!;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const size = Math.hypot(nx, ny, nz);
    if (!(size > 0)) return;
    nx /= size; ny /= size; nz /= size;
    for (const p of [a, b, c]) { out[o++] = p[0]!; out[o++] = p[1]!; out[o++] = p[2]!; out[o++] = nx; out[o++] = ny; out[o++] = nz; }
  };
  for (let k = 0; k < ROUND; k++) {
    const a0 = 2 * Math.PI * k / ROUND, a1 = 2 * Math.PI * (k + 1) / ROUND;
    const p00 = point(r0, z0, a0), p01 = point(r0, z0, a1), p10 = point(r1, z1, a0), p11 = point(r1, z1, a1);
    triangle(p00, p01, p11); triangle(p00, p11, p10);
    triangle(p00, p11, p01); triangle(p00, p10, p11);
  }
  return o === out.length ? out : out.slice(0, o);
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

interface MeshRow { geometry: InstanceGeometry; readonly color: readonly number[]; readonly alpha: number; readonly update: (() => void) | null }
interface ShapeRow { readonly kind: number; readonly matrix: Float32Array; readonly color: readonly number[]; readonly alpha: number }

/** One row of the readout: an event of the simulation, with body handles replaced by scene ids. */
export interface CoupledEventLine { readonly tick: number; readonly source: string; readonly type: string; readonly detail: string }
export interface CoupledReadout {
  readonly tick: number;
  readonly time: number;
  readonly dt: number;
  /** Mean wall-clock milliseconds per simulation step since the last readout that followed a step, or NaN before any step. */
  readonly stepMs: number;
  readonly energy: SimulationEnergy;
  /** Events counted since the scene was loaded, and the latest ones, newest last. */
  readonly eventCount: number;
  readonly events: readonly CoupledEventLine[];
  /** The step plan: 'structure, sheet, world, ...'. */
  readonly order: readonly string[];
}

function rigidMatrix(position: readonly number[], q: readonly number[] | undefined, scale: readonly [number, number, number]): Float32Array {
  const m = new Float32Array(16), x = rotate(q, [1, 0, 0]), y = rotate(q, [0, 1, 0]), z = rotate(q, [0, 0, 1]);
  m[0] = x[0] * scale[0]; m[1] = x[1] * scale[0]; m[2] = x[2] * scale[0];
  m[4] = y[0] * scale[1]; m[5] = y[1] * scale[1]; m[6] = y[2] * scale[1];
  m[8] = z[0] * scale[2]; m[9] = z[1] * scale[2]; m[10] = z[2] * scale[2];
  m[12] = position[0]!; m[13] = position[1]!; m[14] = position[2]!; m[15] = 1;
  return m;
}
const IDENTITY = rigidMatrix([0, 0, 0], undefined, [1, 1, 1]);

/**
 * Steps a loaded coupled scene and exposes it to the renderer. Create it after `loadLabScene`, call `step()`
 * for every fixed step (it calls `simulation.step()`), `sync()` once per rendered frame, and hand the object to
 * `renderer.uploadInstances(view, view.rowCount)` and `view.ropeGrid` to `renderer.uploadRopeGrid`.
 */
export class CoupledSceneView implements InstanceBufferSource {
  readonly loaded: LabLoadedScene;
  /** Cables and frame elements as the renderer's rope stream, or null when the scene has neither. */
  readonly ropeGrid: GpuSegmentGridFrame | null;
  /** What could not be drawn in full, for the panel: a rope stream that was cut, a basin drawn at a coarser grid. */
  readonly notes: readonly string[];
  private readonly base: InstanceBufferSource;
  private heap = new Float32Array(0);
  private kinds = new Uint8Array(0);
  private capacity = 0;
  private bodyRows = 0;
  private readonly meshRows: MeshRow[] = [];
  private readonly shapeRows: ShapeRow[] = [];
  private readonly grainSets: { readonly positions: Float64Array; readonly radii: Float64Array; readonly alive: Uint8Array; readonly count: number; readonly color: readonly number[] }[] = [];
  private grainRows = 0;
  private readonly lines: (() => void)[] = [];
  private readonly waterGrids: { readonly heights: Float32Array; readonly nx: number; readonly nz: number; readonly x: (i: number) => number; readonly z: (j: number) => number }[] = [];
  /** The wire grid over every water surface, for the renderer's line stream; `overlayVersion` changes when it does. */
  readonly overlayLines: DebugLine[] = [];
  overlayVersion = 1;
  private frames = 1;
  private colors = 1;
  private shapes = 1;
  private syncedKey = '';
  private drawnTick = -1;
  private stepMs = 0;
  private stepCount = 0;
  private lastStepMs = NaN;
  private eventCount = 0;
  private readonly events: CoupledEventLine[] = [];
  private readonly unsubscribe: () => void;

  constructor(loaded: LabLoadedScene, base: InstanceBufferSource) {
    this.loaded = loaded;
    this.base = base;
    const scene = loaded.scene, notes: string[] = [];

    for (const description of scene.cloths ?? []) {
      const cloth = loaded.cloths.get(description.id)!.cloth, triangles = cloth.triangles;
      const vertices = new Float32Array(triangles.length * 2 * 6), normals = new Float32Array(3 * cloth.nodeCount);
      const row: MeshRow = { geometry: { vertices, vertexCount: 0 }, color: CLOTH_COLOR, alpha: OPAQUE, update: null };
      (row as { update: () => void }).update = () => { row.geometry = { vertices, vertexCount: writeTwoSidedMesh(cloth.positions, triangles, normals, vertices) / 6 }; };
      this.meshRows.push(row);
    }
    for (const basin of scene.water ?? []) {
      const water = loaded.water.get(basin.id)!, grid = waterDrawGrid(basin.cols, basin.rows);
      if (grid.stride > 1) notes.push(`Basin "${basin.id}" is drawn at every ${grid.stride}${grid.stride === 2 ? 'nd' : grid.stride === 3 ? 'rd' : 'th'} cell.`);
      const vertices = new Float32Array(grid.floats), heights = new Float32Array((grid.nx + 1) * (grid.nz + 1));
      this.waterGrids.push({ heights, nx: grid.nx, nz: grid.nz, x: i => basin.origin[0] + Math.min(basin.cols, i * grid.stride) * basin.dx, z: j => basin.origin[2] + Math.min(basin.rows, j * grid.stride) * basin.dz });
      const row: MeshRow = { geometry: { vertices, vertexCount: 0 }, color: WATER_COLOR, alpha: TRANSLUCENT, update: null };
      (row as { update: () => void }).update = () => { row.geometry = { vertices, vertexCount: writeWaterMesh(water.eta, basin.cols, basin.rows, basin.dx, basin.dz, basin.restDepth, basin.origin, grid, heights, vertices) / 6 }; };
      this.meshRows.push(row);
    }
    let planes = 0;
    (scene.grains ?? []).forEach((set, index) => {
      for (const wall of set.walls ?? []) {
        const shape = wall.shape, position = wall.position ?? [0, 0, 0];
        if (shape.kind === 'plane') { planes++; continue; }
        if (shape.kind === 'box') this.shapeRows.push({ kind: KIND_BOX, matrix: rigidMatrix(position, wall.rotation, [shape.halfExtents[0], shape.halfExtents[1], shape.halfExtents[2]]), color: WALL_COLOR, alpha: TRANSLUCENT });
        else if (shape.kind === 'sphere') this.shapeRows.push({ kind: KIND_SPHERE, matrix: rigidMatrix(position, wall.rotation, [shape.radius, shape.radius, shape.radius]), color: WALL_COLOR, alpha: TRANSLUCENT });
        else if (shape.kind === 'capsule') this.shapeRows.push({ kind: KIND_CAPSULE, matrix: rigidMatrix(position, wall.rotation, [shape.radius, shape.halfLength, shape.radius]), color: WALL_COLOR, alpha: TRANSLUCENT });
        else { const vertices = grainWallMesh(wall); if (vertices) this.meshRows.push({ geometry: { vertices, vertexCount: vertices.length / 6 }, color: WALL_COLOR, alpha: TRANSLUCENT, update: null }); }
      }
      const dem = loaded.grains.get(set.id)!.granular;
      this.grainSets.push({ positions: dem.positions, radii: dem.radii, alive: dem.alive, count: dem.grainCount, color: GRAIN_COLORS[index % GRAIN_COLORS.length]! });
      this.grainRows += dem.grainCount;
    });
    if (planes > 0) notes.push(`${planes} plane ${planes === 1 ? 'wall of the grains is' : 'walls of the grains are'} not drawn.`);

    // Cables and frames: every node a rope node, every segment and element a rope segment.
    let nodes = 0, segments = 0;
    for (const cable of scene.cables ?? []) { nodes += cable.masses.length; segments += cable.segments.length; }
    for (const frame of scene.frames ?? []) { nodes += frame.nodes.length / 3; segments += frame.elements.length; }
    if (segments > 0) {
      if (nodes > COUPLED_DRAW_LIMITS.lineNodes || segments > COUPLED_DRAW_LIMITS.lineSegments) notes.push(`The scene has ${nodes} cable and frame nodes and ${segments} segments; the first ${COUPLED_DRAW_LIMITS.lineNodes} nodes and ${COUPLED_DRAW_LIMITS.lineSegments} segments are drawn.`);
      const positions = new Float32Array(3 * nodes), data = new Float32Array(8 * segments);
      let node = 0, segment = 0;
      // A cable's section is not in the scene: it is drawn 1/150 of the scene's size thick, between 5 mm and 5 cm.
      let lo = Infinity, hi = -Infinity;
      for (const list of [...(scene.cables ?? []).map(c => c.nodes), ...(scene.frames ?? []).map(f => f.nodes)]) for (const v of list) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const cableRadius = Math.min(0.05, Math.max(0.005, (hi - lo) / 300));
      for (const cable of scene.cables ?? []) {
        const first = node, live = loaded.cables.get(cable.id)!.couplingViews().positions, count = cable.masses.length;
        for (const s of cable.segments) data.set([first + s.a, first + s.b, 1 / s.restLength, cableRadius, CABLE_COLOR[0]!, CABLE_COLOR[1]!, CABLE_COLOR[2]!, 1], 8 * segment++);
        this.lines.push(() => { for (let k = 0; k < 3 * count; k++) positions[3 * first + k] = live[k]!; });
        node += count;
      }
      for (const frame of scene.frames ?? []) {
        const first = node, rest = frame.nodes, count = rest.length / 3, u = loaded.frames.get(frame.id)!.couplingViews().displacements;
        for (const e of frame.elements) {
          const a = 3 * e.a, b = 3 * e.b, length = Math.hypot(rest[b]! - rest[a]!, rest[b + 1]! - rest[a + 1]!, rest[b + 2]! - rest[a + 2]!);
          // An element is drawn as a square tube of its own cross-section area.
          data.set([first + e.a, first + e.b, 1 / length, Math.max(cableRadius, Math.sqrt(e.area) / 2), FRAME_COLOR[0]!, FRAME_COLOR[1]!, FRAME_COLOR[2]!, 1], 8 * segment++);
        }
        this.lines.push(() => { for (let n = 0; n < count; n++) for (let k = 0; k < 3; k++) positions[3 * (first + n) + k] = rest[3 * n + k]! + u[6 * n + k]!; });
        node += count;
      }
      this.ropeGrid = { presentation: 'rope', positions, segments: data, nodeCount: Math.min(nodes, COUPLED_DRAW_LIMITS.lineNodes), segmentCount: Math.min(segments, COUPLED_DRAW_LIMITS.lineSegments), topologyVersion: 1, frameVersion: 0 };
    } else this.ropeGrid = null;
    this.notes = notes;

    // Numbers are shortened, body handles become scene ids, vectors and anything else are left out.
    const idOf = (value: unknown): unknown => {
      if (typeof value === 'number') return +value.toPrecision(4);
      if (typeof value === 'string' || typeof value === 'boolean') return value;
      if (value === null || value === undefined || Array.isArray(value) || ArrayBuffer.isView(value)) return null;
      try { return loaded.builder.idOf(value as NativeBodyHandle) ?? null; } catch { return null; }
    };
    this.unsubscribe = loaded.simulation.onEvent((event: SimulationEvent) => {
      this.eventCount++;
      let detail = '';
      if (event.data !== null && typeof event.data === 'object') {
        const parts: string[] = [];
        for (const [key, value] of Object.entries(event.data as Record<string, unknown>)) { if (key === 'kind' || key === 'type') continue; const shown = idOf(value); if (shown !== null && typeof shown !== 'object') parts.push(`${key} ${String(shown)}`); }
        detail = parts.join(', ');
      }
      this.events.push({ tick: event.tick, source: event.source, type: event.type, detail });
      if (this.events.length > COUPLED_DRAW_LIMITS.events) this.events.splice(0, this.events.length - COUPLED_DRAW_LIMITS.events);
    });
    this.sync();
  }

  /** One fixed step of the whole scene: `simulation.step()`, timed. */
  step(): void {
    const start = performance.now();
    this.loaded.simulation.step();
    this.stepMs += performance.now() - start;
    this.stepCount++;
  }

  /** Rows to draw: the world's bodies, then the mesh rows, the wall rows and one row per grain. */
  get rowCount(): number { return this.bodyRows + this.extraRows; }
  private get extraRows(): number { return this.meshRows.length + this.shapeRows.length + this.grainRows; }
  /** What is drawn besides the bodies, for `box3dLab.sceneState()` and the tests. */
  drawInfo(): { meshRows: number; meshVertices: number; wallRows: number; grainRows: number; liveGrains: number; lineNodes: number; lineSegments: number } {
    let meshVertices = 0, liveGrains = 0;
    for (const row of this.meshRows) meshVertices += row.geometry.vertexCount;
    for (const set of this.grainSets) for (let i = 0; i < set.count; i++) liveGrains += set.alive[i]!;
    return { meshRows: this.meshRows.length, meshVertices, wallRows: this.shapeRows.length, grainRows: this.grainRows, liveGrains, lineNodes: this.ropeGrid?.nodeCount ?? 0, lineSegments: this.ropeGrid?.segmentCount ?? 0 };
  }

  /**
   * Bring the rows up to date with the world and the solvers. Returns false when nothing changed since the last
   * call (same body rows, same simulation tick), in which case nothing was written and no version moved.
   */
  sync(): boolean {
    const base = this.base, bodies = base._b3w_body_count(), tick = this.loaded.simulation.tick;
    const key = `${bodies}:${tick}:${base.frameVersion()}:${base.colorVersion()}:${base.shapeVersion?.() ?? 0}`;
    if (key === this.syncedKey) return false;
    this.syncedKey = key;
    const total = bodies + this.extraRows;
    if (total > this.capacity) {
      this.capacity = Math.max(64, total + (total >> 2));
      this.heap = new Float32Array(this.capacity * 20);
      this.kinds = new Uint8Array(this.capacity);
    }
    const heap = this.heap, colorStart = this.capacity * 16, source = base.HEAPF32;
    const matrixPtr = Number(base._b3w_matrices_ptr()) / 4, colorPtr = Number(base._b3w_colors_ptr()) / 4;
    heap.set(source.subarray(matrixPtr, matrixPtr + bodies * 16), 0);
    heap.set(source.subarray(colorPtr, colorPtr + bodies * 4), colorStart);
    const baseKinds = base.shapeKinds?.() ?? null;
    for (let i = 0; i < bodies; i++) this.kinds[i] = baseKinds && i < baseKinds.length ? baseKinds[i]! : KIND_BOX;
    this.bodyRows = bodies;

    const moved = tick !== this.drawnTick;
    this.drawnTick = tick;
    let row = bodies;
    const color = (at: number, rgb: readonly number[], alpha: number): void => { heap[colorStart + 4 * at] = rgb[0]!; heap[colorStart + 4 * at + 1] = rgb[1]!; heap[colorStart + 4 * at + 2] = rgb[2]!; heap[colorStart + 4 * at + 3] = alpha; };
    for (const mesh of this.meshRows) {
      if (mesh.update && (moved || mesh.geometry.vertexCount === 0)) mesh.update();
      heap.set(IDENTITY, 16 * row); color(row, mesh.color, mesh.alpha); this.kinds[row++] = KIND_MESH;
    }
    for (const shape of this.shapeRows) { heap.set(shape.matrix, 16 * row); color(row, shape.color, shape.alpha); this.kinds[row++] = shape.kind; }
    for (const set of this.grainSets) {
      const p = set.positions, radii = set.radii, alive = set.alive;
      for (let i = 0; i < set.count; i++, row++) {
        const m = 16 * row, r = alive[i] ? radii[i]! : 0;
        heap.fill(0, m, m + 16);
        // A grain that left its bounds keeps its row, with no size.
        heap[m] = r; heap[m + 5] = r; heap[m + 10] = r; heap[m + 12] = p[3 * i]!; heap[m + 13] = p[3 * i + 1]!; heap[m + 14] = p[3 * i + 2]!; heap[m + 15] = 1;
        color(row, set.color, OPAQUE); this.kinds[row] = KIND_SPHERE;
      }
    }
    if (this.ropeGrid) { for (const write of this.lines) write(); this.ropeGrid.frameVersion = (this.ropeGrid.frameVersion + 1) >>> 0; }
    if (moved && this.waterGrids.length > 0) this.buildWaterLines();
    this.frames = (this.frames + 1) >>> 0;
    this.colors = (this.colors + 1) >>> 0;
    this.shapes = (this.shapes + 1) >>> 0;
    return true;
  }

  private buildWaterLines(): void {
    const lines = this.overlayLines;
    let n = 0;
    const line = (ax: number, ay: number, az: number, bx: number, by: number, bz: number): void => {
      const l = lines[n] ?? (lines[n] = { ax: 0, ay: 0, az: 0, bx: 0, by: 0, bz: 0, r: 0.55, g: 0.82, b: 1, a: 0.55 });
      l.ax = ax; l.ay = ay; l.az = az; l.bx = bx; l.by = by; l.bz = bz; n++;
    };
    for (const g of this.waterGrids) {
      const h = (i: number, j: number): number => g.heights[i + (g.nx + 1) * j]! + 0.004;
      const every = (count: number): number => Math.max(1, Math.ceil(count / COUPLED_DRAW_LIMITS.waterGridLines));
      const si = every(g.nx), sj = every(g.nz);
      for (let j = 0; j <= g.nz; j += sj) for (let i = 0; i < g.nx; i++) line(g.x(i), h(i, j), g.z(j), g.x(i + 1), h(i + 1, j), g.z(j));
      for (let i = 0; i <= g.nx; i += si) for (let j = 0; j < g.nz; j++) line(g.x(i), h(i, j), g.z(j), g.x(i), h(i, j + 1), g.z(j + 1));
    }
    lines.length = n;
    this.overlayVersion = (this.overlayVersion + 1) >>> 0;
  }

  // ---- InstanceBufferSource ----
  get HEAPF32(): Float32Array { return this.heap; }
  frameVersion(): number { return this.frames; }
  colorVersion(): number { return this.colors; }
  _b3w_matrices_ptr(): number { return 0; }
  _b3w_colors_ptr(): number { return this.capacity * 64; }
  _b3w_body_count(): number { return this.rowCount; }
  _b3w_max_bodies(): number { return this.capacity; }
  shapeVersion(): number { return this.shapes; }
  shapeKinds(): Uint8Array { return this.kinds; }
  shapeGeometry(row: number): InstanceGeometry | null {
    if (row < this.bodyRows) return this.base.shapeGeometry?.(row) ?? null;
    const mesh = this.meshRows[row - this.bodyRows];
    return mesh && mesh.geometry.vertexCount > 0 ? mesh.geometry : null;
  }

  // ---- Readout ----
  stateHash(): string { return coupledStateHash(this.loaded); }
  /** Events the simulation emitted since the scene was loaded. */
  eventTotal(): number { return this.eventCount; }
  /** The clock, the cost of a step, the energy ledger and the latest events. Allocates: call it a few times a second. */
  readout(): CoupledReadout {
    const simulation = this.loaded.simulation;
    // While paused no step runs: the last measured cost is kept.
    if (this.stepCount > 0) { this.lastStepMs = this.stepMs / this.stepCount; this.stepMs = 0; this.stepCount = 0; }
    const stepMs = this.lastStepMs;
    return { tick: simulation.tick, time: simulation.time, dt: simulation.dt, stepMs, energy: simulation.energy(), eventCount: this.eventCount, events: this.events.slice(-8), order: simulation.order().map(row => row.id) };
  }
  dispose(): void { this.unsubscribe(); }
}
