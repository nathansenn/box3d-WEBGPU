/**
 * Stream packing shared by the Lab's two renderers, and the CPU halves of work the WebGPU
 * renderer does on the GPU, for the WebGL2 renderer (src/webgl/lab-renderer.ts).
 *
 *   fillLineVertexData   both renderers: DebugLine records as line-list vertices.
 *   expandRopeSegments   WebGL2: the WebGPU rope compute shader (ropeComputeShader in
 *                        src/webgpu/renderer.ts) as a loop, writing instance rows.
 *   surface builders     WebGL2: the cloth, sheet and water surfaces the WebGPU vertex
 *                        shaders reconstruct, as plain vertex arrays.
 *
 * Plain arithmetic with no DOM and no GPU, so it runs in node (tests/physics/lab-webgl-streams.test.mjs).
 */
import type { DebugLine, DynamicSurfaceFrame, GpuClothSurfaceFrame, GpuSegmentGridFrame, GpuWaterSurfaceFrame, PackedSurfaceFrame } from '../types';

/** Floats per line vertex: position.xyz, colour.rgba. */
export const LINE_VERTEX_FLOATS = 7;

/** Write two vertices per line, at most `maxVertices`; returns the floats written. */
export function fillLineVertexData(lines: readonly DebugLine[], maxVertices: number, out: Float32Array): number {
  const maxFloats = Math.min(out.length, Math.min(maxVertices, lines.length * 2) * 7);
  let cursor = 0;
  for (let i = 0; i < lines.length && cursor + 14 <= maxFloats; i++) {
    const line = lines[i];
    out[cursor++] = line.ax;
    out[cursor++] = line.ay;
    out[cursor++] = line.az;
    out[cursor++] = line.r;
    out[cursor++] = line.g;
    out[cursor++] = line.b;
    out[cursor++] = line.a;
    out[cursor++] = line.bx;
    out[cursor++] = line.by;
    out[cursor++] = line.bz;
    out[cursor++] = line.r;
    out[cursor++] = line.g;
    out[cursor++] = line.b;
    out[cursor++] = line.a;
  }
  return cursor;
}

/** Limits of the rope stream, the same in both renderers. */
export const MAX_ROPE_NODES = 4096;
export const MAX_ROPE_SEGMENTS = 4096;

const mix = (a: number, b: number, t: number): number => a * (1 - t) + b * t;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * One instance row per segment of a rope grid, as the WebGPU rope compute pass writes it: a square
 * tube from node A to node B (columns: x * radius, y * length / 2, z * radius, midpoint), and the
 * segment colour shifted by its strain. `outMatrices` and `outColors` receive rows from row 0.
 * Segments whose nodes are out of range are left as they are (the compute pass skips them too).
 * Returns the number of rows covered: min(segmentCount, MAX_ROPE_SEGMENTS, rows that fit).
 */
export function expandRopeSegments(grid: GpuSegmentGridFrame, outMatrices: Float32Array, outColors: Float32Array): number {
  const nodeCount = Math.max(0, Math.min(grid.nodeCount, Math.floor(grid.positions.length / 3), MAX_ROPE_NODES));
  const segmentCount = Math.max(0, Math.min(grid.segmentCount, Math.floor(grid.segments.length / 8), MAX_ROPE_SEGMENTS,
    Math.floor(outMatrices.length / 16), Math.floor(outColors.length / 4)));
  const materialMode = grid.presentation === 'material';
  const p = grid.positions, s = grid.segments;
  for (let i = 0; i < segmentCount; i++) {
    const o = i * 8;
    const nodeA = Math.trunc(s[o]!), nodeB = Math.trunc(s[o + 1]!);
    if (!(nodeA >= 0 && nodeA < nodeCount && nodeB >= 0 && nodeB < nodeCount)) continue;
    const inverseRestLength = s[o + 2]!, baseRadius = s[o + 3]!;
    const r = s[o + 4]!, g = s[o + 5]!, b = s[o + 6]!, a = s[o + 7]!;
    const ax = p[nodeA * 3]!, ay = p[nodeA * 3 + 1]!, az = p[nodeA * 3 + 2]!;
    const bx = p[nodeB * 3]!, by = p[nodeB * 3 + 1]!, bz = p[nodeB * 3 + 2]!;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    const rawLength = lengthSquared > 0 ? Math.sqrt(lengthSquared) : 0;
    const safeLength = Math.max(rawLength, 0.0001);
    const yx = dx / safeLength, yy = dy / safeLength, yz = dz / safeLength;
    let xx: number, xy: number, xz: number;
    if (Math.abs(yy) < 0.92) { xx = yz; xy = 0; xz = -yx; } else { xx = -yy; xy = yx; xz = 0; }
    const xLength = Math.max(Math.hypot(xx, xy, xz), 0.000001);
    xx /= xLength; xy /= xLength; xz /= xLength;
    // z = y x x
    const zx = yy * xz - yz * xy, zy = yz * xx - yx * xz, zz = yx * xy - yy * xx;
    const signedStrain = rawLength * inverseRestLength - 1;
    const strainScale = materialMode ? 24 : 4.2;
    const demand = clamp01(Math.abs(signedStrain) * strainScale);
    const tension = clamp01(signedStrain * strainScale);
    const heat = materialMode ? demand : tension;
    const compression = materialMode ? clamp01(-signedStrain * strainScale) : 0;
    const radius = baseRadius * (1 - tension * 0.2 + compression * 0.08);
    const m = i * 16, half = safeLength * 0.5;
    outMatrices[m] = xx * radius; outMatrices[m + 1] = xy * radius; outMatrices[m + 2] = xz * radius; outMatrices[m + 3] = 0;
    outMatrices[m + 4] = yx * half; outMatrices[m + 5] = yy * half; outMatrices[m + 6] = yz * half; outMatrices[m + 7] = 0;
    outMatrices[m + 8] = zx * radius; outMatrices[m + 9] = zy * radius; outMatrices[m + 10] = zz * radius; outMatrices[m + 11] = 0;
    outMatrices[m + 12] = (ax + bx) * 0.5; outMatrices[m + 13] = (ay + by) * 0.5; outMatrices[m + 14] = (az + bz) * 0.5; outMatrices[m + 15] = 1;
    const shift = heat - compression * heat;
    const c = i * 4;
    outColors[c] = mix(mix(r, 0.05, compression), 1.0, shift);
    outColors[c + 1] = mix(mix(g, 0.34, compression), 0.06, shift);
    outColors[c + 2] = mix(mix(b, 1.0, compression), 0.02, shift);
    outColors[c + 3] = materialMode && a < 0 ? a : mix(a, 2.2, heat);
  }
  return segmentCount;
}

/** Floats per surface vertex in the WebGL2 renderer: position.xyz, normal.xyz, colour.rgba, uv. */
export const SURFACE_VERTEX_FLOATS = 12;
/** The WebGPU renderer's surface limits, kept by the WebGL2 renderer. */
export const MAX_SURFACE_VERTICES = 16384;
export const MAX_SURFACE_INDICES = 98304;

/** How a surface is shaded: woven cloth, a brushed metal sheet, or translucent water. */
export type SurfaceShading = 'cloth' | 'sheet' | 'water';

export interface BuiltSurface {
  readonly shading: SurfaceShading;
  readonly vertexCount: number;
  readonly indices: Uint16Array;
  readonly indexCount: number;
  /** Cloth and sheets cast shadows; water does not (as in the WebGPU renderer). */
  readonly castsShadow: boolean;
}

function decodeOctNormal(x: number, y: number, out: Float32Array, o: number): void {
  let nx = x, ny = y;
  const nz = 1 - Math.abs(x) - Math.abs(y);
  if (nz < 0) {
    nx = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1);
    ny = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1);
  }
  const length = Math.hypot(nx, ny, nz) || 1;
  out[o] = nx / length; out[o + 1] = ny / length; out[o + 2] = nz / length;
}

/** A packed surface (24-byte vertices: position f32x3, oct normal snorm16x2, colour unorm8x4, uv unorm16x2). */
export function decodePackedSurface(frame: PackedSurfaceFrame, out: Float32Array): number {
  if (frame.vertexStride !== 24) return 0;
  const count = Math.min(frame.vertexCount, Math.floor(frame.vertices.byteLength / 24), Math.floor(out.length / SURFACE_VERTEX_FLOATS));
  const view = new DataView(frame.vertices.buffer, frame.vertices.byteOffset, frame.vertices.byteLength);
  const snorm = (v: number): number => Math.max(-1, v / 32767);
  for (let i = 0; i < count; i++) {
    const b = i * 24, o = i * SURFACE_VERTEX_FLOATS;
    out[o] = view.getFloat32(b, true); out[o + 1] = view.getFloat32(b + 4, true); out[o + 2] = view.getFloat32(b + 8, true);
    decodeOctNormal(snorm(view.getInt16(b + 12, true)), snorm(view.getInt16(b + 14, true)), out, o + 3);
    out[o + 6] = view.getUint8(b + 16) / 255; out[o + 7] = view.getUint8(b + 17) / 255; out[o + 8] = view.getUint8(b + 18) / 255; out[o + 9] = view.getUint8(b + 19) / 255;
    out[o + 10] = view.getUint16(b + 20, true) / 65535; out[o + 11] = view.getUint16(b + 22, true) / 65535;
  }
  return count;
}

function gridNormal(p: ArrayLike<number>, left: number, right: number, up: number, down: number, out: Float32Array, o: number): void {
  // cross(row tangent, column tangent), as the WebGPU cloth vertex shader.
  const cx = p[right * 3]! - p[left * 3]!, cy = p[right * 3 + 1]! - p[left * 3 + 1]!, cz = p[right * 3 + 2]! - p[left * 3 + 2]!;
  const rx = p[down * 3]! - p[up * 3]!, ry = p[down * 3 + 1]! - p[up * 3 + 1]!, rz = p[down * 3 + 2]! - p[up * 3 + 2]!;
  const nx = ry * cz - rz * cy, ny = rz * cx - rx * cz, nz = rx * cy - ry * cx;
  const l2 = nx * nx + ny * ny + nz * nz;
  if (l2 > 1e-12) { const inv = 1 / Math.sqrt(l2); out[o] = nx * inv; out[o + 1] = ny * inv; out[o + 2] = nz * inv; }
  else { out[o] = 0; out[o + 1] = 1; out[o + 2] = 0; }
}

/**
 * An intact cloth grid (cols x rows nodes): normals from the neighbouring nodes, the two-colour
 * check of 2x2 cells, and the strain against the rest pose along the grid edges (4-neighbourhood
 * and the diagonals; the WebGPU shader also looks two nodes away) in colour alpha.
 */
export function clothSurfaceVertices(frame: GpuClothSurfaceFrame, out: Float32Array): number {
  const cols = frame.cols, rows = frame.rows;
  const count = Math.min(frame.vertexCount, cols * rows, Math.floor(frame.positions.length / 3), Math.floor(out.length / SURFACE_VERTEX_FLOATS));
  const p = frame.positions, rest = frame.restPositions;
  const edge = (i: number, j: number): number => {
    if (j < 0 || j >= count || rest.length < (Math.max(i, j) + 1) * 3) return 0;
    const restLength = Math.max(Math.hypot(rest[j * 3]! - rest[i * 3]!, rest[j * 3 + 1]! - rest[i * 3 + 1]!, rest[j * 3 + 2]! - rest[i * 3 + 2]!), 0.000001);
    return Math.abs(Math.hypot(p[j * 3]! - p[i * 3]!, p[j * 3 + 1]! - p[i * 3 + 1]!, p[j * 3 + 2]! - p[i * 3 + 2]!) / restLength - 1);
  };
  const a = frame.baseColorA, b = frame.baseColorB;
  for (let i = 0; i < count; i++) {
    const col = i % cols, row = Math.floor(i / cols), o = i * SURFACE_VERTEX_FLOATS;
    const left = col > 0 ? i - 1 : i, right = col + 1 < cols ? i + 1 : i, up = row > 0 ? i - cols : i, down = row + 1 < rows ? i + cols : i;
    out[o] = p[i * 3]!; out[o + 1] = p[i * 3 + 1]!; out[o + 2] = p[i * 3 + 2]!;
    gridNormal(p, left, right, up, down, out, o + 3);
    let strain = 0;
    if (col > 0) strain = Math.max(strain, edge(i, i - 1));
    if (col + 1 < cols) strain = Math.max(strain, edge(i, i + 1));
    if (row > 0) strain = Math.max(strain, edge(i, i - cols));
    if (row + 1 < rows) strain = Math.max(strain, edge(i, i + cols));
    if (col > 0 && row > 0) strain = Math.max(strain, edge(i, i - cols - 1));
    if (col + 1 < cols && row + 1 < rows) strain = Math.max(strain, edge(i, i + cols + 1));
    strain = clamp01(strain * 3.2);
    const checker = ((col >> 1) + (row >> 1)) & 1;
    const t = strain <= 0.35 ? 0 : strain >= 1 ? 1 : ((strain - 0.35) / 0.65) ** 2 * (3 - 2 * (strain - 0.35) / 0.65);
    const stress = t * 0.72;
    out[o + 6] = mix(mix(a[0], b[0], checker), 1.0, stress);
    out[o + 7] = mix(mix(a[1], b[1], checker), 0.035, stress);
    out[o + 8] = mix(mix(a[2], b[2], checker), 0.005, stress);
    out[o + 9] = strain;
    out[o + 10] = col / Math.max(cols - 1, 1); out[o + 11] = row / Math.max(rows - 1, 1);
  }
  return count;
}

/**
 * A shallow-water grid (cols x rows cells over width x depth, centred on the origin, at baseY + eta):
 * slope normals, the depth colour of the WebGPU water shader, and foam from curvature and current in alpha.
 */
export function waterSurfaceVertices(frame: GpuWaterSurfaceFrame, out: Float32Array): number {
  const cols = frame.cols, rows = frame.rows;
  const count = Math.min(frame.vertexCount, cols * rows, frame.eta.length, Math.floor(out.length / SURFACE_VERTEX_FLOATS));
  const eta = frame.eta, u = frame.u, v = frame.v;
  const cellX = frame.width / Math.max(cols - 1, 1), cellZ = frame.depth / Math.max(rows - 1, 1);
  for (let i = 0; i < count; i++) {
    const col = i % cols, row = Math.floor(i / cols), o = i * SURFACE_VERTEX_FLOATS;
    const left = col > 0 ? i - 1 : i, right = col + 1 < cols ? i + 1 : i, up = row > 0 ? i - cols : i, down = row + 1 < rows ? i + cols : i;
    const h = (k: number): number => (k < count ? eta[k]! : eta[i]!);
    out[o] = -frame.width * 0.5 + col * cellX; out[o + 1] = frame.baseY + eta[i]!; out[o + 2] = -frame.depth * 0.5 + row * cellZ;
    const sx = (h(left) - h(right)) / Math.max(cellX * 2, 0.0001), sz = (h(up) - h(down)) / Math.max(cellZ * 2, 0.0001);
    const inv = 1 / Math.hypot(sx, 1, sz);
    out[o + 3] = sx * inv; out[o + 4] = inv; out[o + 5] = sz * inv;
    const curvature = Math.abs(h(left) + h(right) + h(up) + h(down) - eta[i]! * 4);
    const current = Math.hypot(u[i] ?? 0, v[i] ?? 0);
    const depthMix = clamp01(eta[i]! * 0.18 + 0.5);
    out[o + 6] = mix(0.006, 0.025, depthMix); out[o + 7] = mix(0.075, 0.32, depthMix); out[o + 8] = mix(0.14, 0.48, depthMix);
    out[o + 9] = clamp01(curvature * 4.5 + current * 0.12);
    out[o + 10] = col / Math.max(cols - 1, 1); out[o + 11] = row / Math.max(rows - 1, 1);
  }
  return count;
}

/**
 * Any dynamic surface as WebGL2 vertices in `out`, with its index list and shading; null when it
 * is empty or invalid (an index past the vertices, a count that is not whole triangles).
 */
export function buildSurface(surface: DynamicSurfaceFrame | null, out: Float32Array): BuiltSurface | null {
  if (!surface || surface.vertexCount <= 0 || surface.indexCount <= 0) return null;
  let vertexCount: number;
  let shading: SurfaceShading;
  if (surface.path === 'packed') { vertexCount = decodePackedSurface(surface, out); shading = surface.material === 'sheet' ? 'sheet' : 'cloth'; }
  else if (surface.path === 'gpu-cloth') { vertexCount = clothSurfaceVertices(surface, out); shading = 'cloth'; }
  else { if (surface.cols < 2 || surface.rows < 2) return null; vertexCount = waterSurfaceVertices(surface, out); shading = 'water'; }
  const indexCount = Math.min(surface.indexCount, surface.indices.length, MAX_SURFACE_INDICES);
  if (vertexCount <= 0 || indexCount <= 0 || indexCount % 3 !== 0) return null;
  for (let i = 0; i < indexCount; i++) if (surface.indices[i]! >= vertexCount) return null;
  return { shading, vertexCount, indices: surface.indices, indexCount, castsShadow: shading !== 'water' };
}
