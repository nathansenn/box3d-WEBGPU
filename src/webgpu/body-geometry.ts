/**
 * Render geometry for the bodies whose shape is not a box, sphere or capsule:
 * convex hulls, static triangle meshes, height fields and compounds.
 *
 * Each function returns a triangle list in the layout of the renderer's cube
 * mesh (position.xyz, normal.xyz; six floats per vertex, three vertices per
 * triangle, counter-clockwise seen from the lit side), in the body's own
 * frame. Such a body's instance row is an unscaled rigid transform, so the
 * renderer draws the list with the row's matrix and colour.
 *
 * Normals:
 *   hull          flat. A hull is a polyhedron; the triangles of one face share its normal.
 *   mesh          flat, and every triangle is drawn on both sides (see meshRenderMesh).
 *   height field  smooth, from central differences of the heights.
 *   compound      each child at its local pose: boxes and hulls flat, spheres and capsules smooth.
 *
 * Plain arithmetic with no GPU dependency, so it runs in node.
 */
import { convexHull } from '../engine/geometry.ts';
import type { NativeBodyShape, NativeCompoundChild, NativeConvexShape } from '../engine/native-world.ts';

/** Floats per vertex: position.xyz, normal.xyz. */
export const BODY_MESH_VERTEX_FLOATS = 6;
/** Most vertices one body's render mesh may have (36 MB of vertex data). */
export const BODY_MESH_MAX_VERTICES = 1_500_000;

export interface BodyRenderMesh {
  /** position.xyz, normal.xyz per vertex; three vertices per triangle. */
  readonly vertices: Float32Array;
  readonly vertexCount: number;
  /** What was done to stay within BODY_MESH_MAX_VERTICES, or null when the mesh is complete. */
  readonly reduced: string | null;
}

function emitFlat(out: Float32Array, o: number, p: ArrayLike<number>, a: number, b: number, c: number, flip: boolean): number {
  const ax = p[a * 3]!, ay = p[a * 3 + 1]!, az = p[a * 3 + 2]!;
  const bx = p[b * 3]!, by = p[b * 3 + 1]!, bz = p[b * 3 + 2]!;
  const cx = p[c * 3]!, cy = p[c * 3 + 1]!, cz = p[c * 3 + 2]!;
  let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
  let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
  let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const length = Math.hypot(nx, ny, nz);
  // A triangle with no area has no normal and covers no pixel.
  if (!(length > 0) || !Number.isFinite(length)) return o;
  const sign = flip ? -1 : 1;
  nx *= sign / length; ny *= sign / length; nz *= sign / length;
  const put = (x: number, y: number, z: number): void => {
    out[o++] = x; out[o++] = y; out[o++] = z; out[o++] = nx; out[o++] = ny; out[o++] = nz;
  };
  put(ax, ay, az);
  if (flip) { put(cx, cy, cz); put(bx, by, bz); } else { put(bx, by, bz); put(cx, cy, cz); }
  return o;
}

const finish = (out: Float32Array, floats: number, reduced: string | null): BodyRenderMesh => {
  const vertices = floats === out.length ? out : out.slice(0, floats);
  return { vertices, vertexCount: floats / BODY_MESH_VERTEX_FLOATS, reduced };
};

/**
 * The convex hull of a hull body's points, one flat-shaded triangle list.
 * Box3D keeps at most 64 hull vertices: for a body created with more points
 * than that, the solver's hull is an inscribed simplification of what is drawn.
 * Throws when the points have no hull with volume (the engine refuses those too).
 */
export function hullRenderMesh(points: ArrayLike<number>): BodyRenderMesh {
  const hull = convexHull(points);
  const out = new Float32Array(hull.indices.length * BODY_MESH_VERTEX_FLOATS);
  let o = 0;
  for (let t = 0; t < hull.indices.length; t += 3) o = emitFlat(out, o, hull.vertices, hull.indices[t]!, hull.indices[t + 1]!, hull.indices[t + 2]!, false);
  return finish(out, o, null);
}

/**
 * A static triangle mesh, flat-shaded. Every triangle is written twice: once
 * with its own winding and the normal that winding gives, once reversed with
 * the opposite normal. A static mesh is often an open surface (a ramp, a
 * terrain patch, an imported shell with holes), and the solid pipeline culls
 * back faces; drawing both sides keeps such a surface visible and lit from
 * either side whatever its winding. A mesh above 250,000 triangles is drawn
 * one-sided, and above 500,000 only its first 500,000 triangles are drawn.
 */
export function meshRenderMesh(vertices: ArrayLike<number>, indices: ArrayLike<number>, maxVertices = BODY_MESH_MAX_VERTICES): BodyRenderMesh {
  const all = Math.floor(indices.length / 3);
  const fit = Math.floor(maxVertices / 3);
  const twoSided = all * 2 <= fit;
  const triangles = Math.min(all, fit);
  const reduced = triangles < all ? `only the first ${triangles} of ${all} triangles are drawn` : twoSided ? null : 'drawn one-sided';
  const out = new Float32Array(triangles * (twoSided ? 2 : 1) * 3 * BODY_MESH_VERTEX_FLOATS);
  const vertexCount = Math.floor(vertices.length / 3);
  let o = 0;
  for (let t = 0; t < triangles; t++) {
    const a = indices[t * 3]!, b = indices[t * 3 + 1]!, c = indices[t * 3 + 2]!;
    if (!(a >= 0 && a < vertexCount && b >= 0 && b < vertexCount && c >= 0 && c < vertexCount)) continue;
    o = emitFlat(out, o, vertices, a, b, c, false);
    if (twoSided) o = emitFlat(out, o, vertices, a, b, c, true);
  }
  return finish(out, o, reduced);
}

/**
 * A height field: countX by countZ heights (index x + z * countX) on a grid of
 * spacing [dx, dz] that starts at the body origin and extends along +x and +z.
 *
 * Each cell is split along the diagonal from (x + 1, z) to (x, z + 1), which is
 * the split Box3D collides with (tests/physics/body-geometry.test.mjs compares
 * the mesh with ray casts against the engine). Triangles are counter-clockwise
 * seen from above; the surface is one-sided, as it is in the solver. Normals
 * are smooth: normalize(-dh/dx, 1, -dh/dz) from central differences, one-sided
 * at the border. A field too large for the vertex budget is drawn from every
 * k-th sample (the last row and column are always kept).
 */
export function heightfieldRenderMesh(
  heights: ArrayLike<number>, countX: number, countZ: number, spacing: readonly [number, number], maxVertices = BODY_MESH_MAX_VERTICES,
): BodyRenderMesh {
  if (!Number.isInteger(countX) || !Number.isInteger(countZ) || countX < 2 || countZ < 2 || heights.length < countX * countZ) {
    throw new RangeError('A height field needs countX * countZ heights, with at least 2 samples a side.');
  }
  let stride = 1;
  const cells = (k: number): number => Math.ceil((countX - 1) / k) * Math.ceil((countZ - 1) / k);
  while (cells(stride) * 6 > maxVertices) stride++;
  const xs: number[] = [], zs: number[] = [];
  for (let x = 0; x < countX - 1; x += stride) xs.push(x);
  xs.push(countX - 1);
  for (let z = 0; z < countZ - 1; z += stride) zs.push(z);
  zs.push(countZ - 1);
  const dx = spacing[0], dz = spacing[1];
  const h = (x: number, z: number): number => heights[x + z * countX]!;
  const out = new Float32Array((xs.length - 1) * (zs.length - 1) * 6 * BODY_MESH_VERTEX_FLOATS);
  let o = 0;
  const put = (x: number, z: number): void => {
    const x0 = Math.max(0, x - 1), x1 = Math.min(countX - 1, x + 1), z0 = Math.max(0, z - 1), z1 = Math.min(countZ - 1, z + 1);
    const sx = (h(x1, z) - h(x0, z)) / ((x1 - x0) * dx), sz = (h(x, z1) - h(x, z0)) / ((z1 - z0) * dz);
    const inv = 1 / Math.hypot(sx, 1, sz);
    out[o++] = x * dx; out[o++] = h(x, z); out[o++] = z * dz;
    out[o++] = -sx * inv; out[o++] = inv; out[o++] = -sz * inv;
  };
  for (let j = 0; j < zs.length - 1; j++) {
    for (let i = 0; i < xs.length - 1; i++) {
      const x0 = xs[i]!, x1 = xs[i + 1]!, z0 = zs[j]!, z1 = zs[j + 1]!;
      put(x0, z0); put(x0, z1); put(x1, z0);
      put(x1, z0); put(x0, z1); put(x1, z1);
    }
  }
  return finish(out, o, stride > 1 ? `drawn from every ${stride}th height sample` : null);
}

/** Segments around a sphere or capsule of a compound, and latitude bands of a full sphere. */
const COMPOUND_SEGMENTS = 24, COMPOUND_RINGS = 12;

/**
 * One convex shape in its own frame, as position.xyz, normal.xyz triples of
 * counter-clockwise triangles: a box and a hull flat-shaded, a sphere and a
 * capsule (axis along local Y) smooth-shaded.
 */
function convexTriangles(shape: NativeConvexShape): number[] {
  const out: number[] = [];
  if (shape.kind === 'hull') { const mesh = hullRenderMesh(shape.points); for (let i = 0; i < mesh.vertexCount * BODY_MESH_VERTEX_FLOATS; i++) out.push(mesh.vertices[i]!); return out; }
  if (shape.kind === 'box') {
    const [hx, hy, hz] = shape.halfExtents;
    // Each face: its outward normal axis and sign, and two in-plane axes u, v with u x v = normal.
    for (const [n, u, v] of [[0, 1, 2], [1, 2, 0], [2, 0, 1]] as const) for (const sign of [1, -1]) {
      const h = [hx, hy, hz], normal = [0, 0, 0]; normal[n] = sign;
      const corner = (a: number, b: number): void => { const p = [0, 0, 0]; p[n] = sign * h[n]!; p[u] = a * h[u]!; p[v] = b * h[v]!; out.push(p[0]!, p[1]!, p[2]!, normal[0]!, normal[1]!, normal[2]!); };
      // Counter-clockwise seen from outside; the winding flips with the face's sign.
      if (sign > 0) { corner(-1, -1); corner(1, -1); corner(1, 1); corner(-1, -1); corner(1, 1); corner(-1, 1); }
      else { corner(-1, -1); corner(1, 1); corner(1, -1); corner(-1, -1); corner(-1, 1); corner(1, 1); }
    }
    return out;
  }
  const radius = shape.radius, half = shape.kind === 'capsule' ? shape.halfLength : 0;
  // A point of the unit sphere at latitude band i (0 at the +y pole) and segment j; `lift` moves the two halves apart for a capsule.
  const put = (i: number, j: number, lift: number): void => {
    const polar = Math.PI * i / COMPOUND_RINGS, around = 2 * Math.PI * j / COMPOUND_SEGMENTS;
    const nx = Math.sin(polar) * Math.cos(around), ny = Math.cos(polar), nz = Math.sin(polar) * Math.sin(around);
    out.push(nx * radius, ny * radius + lift, nz * radius, nx, ny, nz);
  };
  for (let i = 0; i < COMPOUND_RINGS; i++) {
    // Bands above the equator belong to the upper cap, the others to the lower one.
    const lift = i < COMPOUND_RINGS / 2 ? half : -half;
    for (let j = 0; j < COMPOUND_SEGMENTS; j++) {
      if (i > 0) { put(i, j, lift); put(i, j + 1, lift); put(i + 1, j, lift); }
      if (i < COMPOUND_RINGS - 1) { put(i, j + 1, lift); put(i + 1, j + 1, lift); put(i + 1, j, lift); }
    }
  }
  if (half > 0) for (let j = 0; j < COMPOUND_SEGMENTS; j++) {
    // The cylinder between the two equators.
    const side = (k: number, y: number): void => { const around = 2 * Math.PI * k / COMPOUND_SEGMENTS, nx = Math.cos(around), nz = Math.sin(around); out.push(nx * radius, y, nz * radius, nx, 0, nz); };
    side(j, half); side(j + 1, half); side(j, -half);
    side(j + 1, half); side(j + 1, -half); side(j, -half);
  }
  return out;
}

/**
 * Every shape of a compound body in the body's frame, as one triangle list:
 * each child's own mesh turned by its rotation and moved to its position.
 * Children the engine could not have accepted (a hull without volume) are left out.
 */
export function compoundRenderMesh(children: readonly NativeCompoundChild[]): BodyRenderMesh {
  const parts: number[][] = [];
  let floats = 0;
  for (const child of children) {
    let local: number[];
    try { local = convexTriangles(child.shape); } catch { continue; }
    const [px, py, pz] = child.position ?? [0, 0, 0], [x, y, z, w] = child.rotation ?? [0, 0, 0, 1];
    // Rows of the rotation matrix of the unit quaternion.
    const r = [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
    for (let i = 0; i < local.length; i += 3) {
      const a = local[i]!, b = local[i + 1]!, c = local[i + 2]!, isPosition = i % 6 === 0;
      local[i] = r[0]! * a + r[1]! * b + r[2]! * c + (isPosition ? px : 0);
      local[i + 1] = r[3]! * a + r[4]! * b + r[5]! * c + (isPosition ? py : 0);
      local[i + 2] = r[6]! * a + r[7]! * b + r[8]! * c + (isPosition ? pz : 0);
    }
    parts.push(local); floats += local.length;
  }
  const out = new Float32Array(floats);
  let o = 0;
  for (const part of parts) { out.set(part, o); o += part.length; }
  return finish(out, floats, null);
}

/** The render mesh of a hull, mesh, height-field or compound shape; null for the shapes that are drawn as instances of a shared mesh. */
export function bodyRenderMesh(shape: NativeBodyShape): BodyRenderMesh | null {
  switch (shape.kind) {
    case 'compound': return compoundRenderMesh(shape.shapes);
    case 'hull': return hullRenderMesh(shape.points);
    case 'mesh': return meshRenderMesh(shape.vertices, shape.indices);
    case 'heightfield': return heightfieldRenderMesh(shape.heights, shape.countX, shape.countZ, shape.spacing);
    default: return null;
  }
}
