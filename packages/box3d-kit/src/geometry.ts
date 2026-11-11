/**
 * Geometry import and preparation: OBJ, STL and glTF 2.0 parsers that return
 * plain triangle meshes, mesh measures (volume, centre of mass, bounds,
 * convexity), convex hulls, an approximate convex decomposition, and helpers
 * that turn a mesh into the kit's hull, mesh and height-field shapes.
 *
 * Nothing here fetches, touches the DOM or needs the WASM: every function is
 * synchronous and works on data you already hold. Units are whatever the file
 * uses; the kit's worlds are in metres, so scale with `transformMesh` first
 * when a file is in millimetres. Malformed input throws
 * `EngineError('INVALID_PAYLOAD')` with the reason.
 */
import {EngineError} from './core/contracts.js';
import type {Body, BodyOptions, BodyType, Joint, JointOptions, QuatLike, Vec3Like} from './world.js';

/** A triangle mesh: flat [x, y, z, ...] vertices and index triples, counter-clockwise seen from outside. */
export interface TriangleMesh {
  vertices: Float32Array;
  indices: Uint32Array;
  name?: string;
}
/** Anything mesh-shaped is accepted as input; outputs are always typed arrays. */
export interface MeshLike {
  readonly vertices: ArrayLike<number>;
  readonly indices: ArrayLike<number>;
  readonly name?: string;
}
export type BinaryLike = ArrayBuffer | Uint8Array;
/** External glTF buffers by the `uri` the file names them with. */
export type GLTFBuffers = Readonly<Record<string, BinaryLike>> | ReadonlyMap<string, BinaryLike>;

/** Hard caps. Input beyond them is rejected before anything large is allocated. */
export const GEOMETRY_LIMITS = Object.freeze({
  /** Vertices in one parsed file or one mesh. */
  maxVertices: 4_000_000,
  /** Triangles in one parsed file or one mesh. */
  maxTriangles: 8_000_000,
  /** Triangles `convexDecompose` accepts. */
  maxDecomposeTriangles: 200_000,
  /** Hulls `convexDecompose` returns at most. */
  maxHulls: 64,
  /** Hull vertices Box3D keeps. */
  maxHullPoints: 64,
  /** Half-edges Box3D allows in one hull; a hull with only triangular faces reaches it at 44 vertices. */
  maxHullHalfEdges: 255,
  /** Grid points in a sampled height field. */
  maxHeightfieldCells: 1 << 22,
  /** Vertex x face tests `isConvex` is willing to run. */
  maxConvexityTests: 2e8,
});

function bad(message: string): never { throw new EngineError('INVALID_PAYLOAD', message); }
type V3 = [number, number, number];

function vec3(value: Vec3Like | undefined, fallback: V3, label: string): V3 {
  if (value === undefined) return fallback;
  const v = value as unknown as {x?: unknown; y?: unknown; z?: unknown; length?: unknown; [i: number]: unknown};
  const out = (typeof v.length === 'number' ? [v[0], v[1], v[2]] : [v.x, v.y, v.z]) as V3;
  if (!out.every(n => typeof n === 'number' && Number.isFinite(n))) bad(`${label} must be three finite numbers.`);
  return out;
}

function bytesOf(data: unknown, label: string): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return bad(`${label} must be an ArrayBuffer or Uint8Array.`);
}

interface Checked { v: ArrayLike<number>; idx: ArrayLike<number>; nv: number; nt: number }
function checkMesh(mesh: MeshLike, label = 'mesh'): Checked {
  if (!mesh || typeof mesh !== 'object') bad(`${label} must be {vertices, indices}.`);
  const v = mesh.vertices, idx = mesh.indices;
  if (!v || !idx || typeof v.length !== 'number' || typeof idx.length !== 'number') bad(`${label} must be {vertices, indices}.`);
  if (v.length % 3 !== 0) bad(`${label}.vertices must hold x, y, z triples.`);
  if (idx.length % 3 !== 0) bad(`${label}.indices must hold triangles (triples).`);
  const nv = v.length / 3, nt = idx.length / 3;
  if (nv > GEOMETRY_LIMITS.maxVertices) bad(`${label} has ${nv} vertices; the limit is ${GEOMETRY_LIMITS.maxVertices}.`);
  if (nt > GEOMETRY_LIMITS.maxTriangles) bad(`${label} has ${nt} triangles; the limit is ${GEOMETRY_LIMITS.maxTriangles}.`);
  for (let i = 0; i < v.length; i++) if (!Number.isFinite(v[i])) bad(`${label}: vertex ${Math.floor(i / 3)} is not finite.`);
  for (let i = 0; i < idx.length; i++) {
    const k = idx[i];
    if (!Number.isInteger(k) || k < 0 || k >= nv) bad(`${label}: index ${k} is out of range (the mesh has ${nv} vertices).`);
  }
  return {v, idx, nv, nt};
}

// ---------------------------------------------------------------------------
// Measures
// ---------------------------------------------------------------------------

export interface MeshBounds { min: [number, number, number]; max: [number, number, number] }

/** Axis-aligned bounds of every vertex. */
export function meshBounds(mesh: MeshLike): MeshBounds {
  const {v, nv} = checkMesh(mesh);
  if (nv === 0) bad('mesh has no vertices.');
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) {
    const value = v[i + k];
    if (value < min[k]) min[k] = value;
    if (value > max[k]) max[k] = value;
  }
  return {min, max};
}

function diagonal(v: ArrayLike<number>): number {
  let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
  for (let i = 0; i + 2 < v.length; i += 3) {
    if (v[i] < x0) x0 = v[i]; if (v[i] > x1) x1 = v[i];
    if (v[i + 1] < y0) y0 = v[i + 1]; if (v[i + 1] > y1) y1 = v[i + 1];
    if (v[i + 2] < z0) z0 = v[i + 2]; if (v[i + 2] > z1) z1 = v[i + 2];
  }
  return v.length < 3 ? 0 : Math.hypot(x1 - x0, y1 - y0, z1 - z0);
}

// Signed-tetrahedron sums about the first vertex (to limit cancellation): 6 V and 24 V c.
function integrals(v: ArrayLike<number>, idx: ArrayLike<number>): {volume: number; centroid: V3 | null} {
  if (idx.length === 0) return {volume: 0, centroid: null};
  const rx = v[0], ry = v[1], rz = v[2];
  let six = 0, sx = 0, sy = 0, sz = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ax = v[a] - rx, ay = v[a + 1] - ry, az = v[a + 2] - rz;
    const bx = v[b] - rx, by = v[b + 1] - ry, bz = v[b + 2] - rz;
    const cx = v[c] - rx, cy = v[c + 1] - ry, cz = v[c + 2] - rz;
    const det = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    six += det; sx += det * (ax + bx + cx); sy += det * (ay + by + cy); sz += det * (az + bz + cz);
  }
  return {volume: six / 6, centroid: six === 0 ? null : [rx + sx / (4 * six), ry + sy / (4 * six), rz + sz / (4 * six)]};
}

/**
 * Enclosed volume by summing signed tetrahedra. Exact (to float64 roundoff)
 * for a closed, consistently wound mesh; positive when triangles are
 * counter-clockwise seen from outside, negative when the mesh is inside out.
 * For an open mesh the number has no meaning: check `isClosed` first.
 */
export function meshVolume(mesh: MeshLike): number {
  const {v, idx} = checkMesh(mesh);
  return integrals(v, idx).volume;
}

/** Centre of mass of the uniform solid a closed mesh encloses. */
export function meshCenterOfMass(mesh: MeshLike): [number, number, number] {
  const {v, idx} = checkMesh(mesh);
  const {volume, centroid} = integrals(v, idx);
  const size = diagonal(v);
  if (!centroid || !(Math.abs(volume) > 1e-12 * size * size * size)) bad('mesh encloses no volume, so it has no centre of mass.');
  return centroid!;
}

/**
 * Merge vertices closer than `tolerance` (0, the default, merges only identical
 * positions) and drop triangles that collapse. Each vertex joins the first
 * earlier vertex within the tolerance, so chains of near points are not all
 * merged into one.
 */
export function weldVertices(mesh: MeshLike, tolerance = 0): TriangleMesh {
  const {v, idx, nv} = checkMesh(mesh);
  if (!(tolerance >= 0) || !Number.isFinite(tolerance)) bad('tolerance must be zero or a positive number.');
  let size = 16;
  while (size < nv * 2) size *= 2;
  const mask = size - 1, head = new Int32Array(size).fill(-1), next = new Int32Array(nv), remap = new Uint32Array(nv);
  const out = new Float32Array(nv * 3), f = new Float32Array(3), bits = new Int32Array(f.buffer);
  const inv = tolerance > 0 ? 1 / tolerance : 0, tol2 = tolerance * tolerance;
  const hash = (i: number, j: number, k: number) => (Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ Math.imul(k, 83492791)) & mask;
  let count = 0;
  for (let p = 0; p < nv; p++) {
    f[0] = v[p * 3] + 0; f[1] = v[p * 3 + 1] + 0; f[2] = v[p * 3 + 2] + 0;   // + 0 turns -0 into 0
    const x = f[0], y = f[1], z = f[2];
    let found = -1, home: number;
    if (tolerance === 0) {
      home = hash(bits[0], bits[1], bits[2]);
      for (let r = head[home]; r >= 0; r = next[r]) if (out[r * 3] === x && out[r * 3 + 1] === y && out[r * 3 + 2] === z) { found = r; break; }
    } else {
      const ci = Math.floor(x * inv), cj = Math.floor(y * inv), ck = Math.floor(z * inv);
      home = hash(ci, cj, ck);
      search: for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (let dk = -1; dk <= 1; dk++) {
        for (let r = head[hash(ci + di, cj + dj, ck + dk)]; r >= 0; r = next[r]) {
          const dx = out[r * 3] - x, dy = out[r * 3 + 1] - y, dz = out[r * 3 + 2] - z;
          if (dx * dx + dy * dy + dz * dz <= tol2 && (found < 0 || r < found)) found = r;
        }
        if (found === 0) break search;
      }
    }
    if (found < 0) {
      found = count++;
      out[found * 3] = x; out[found * 3 + 1] = y; out[found * 3 + 2] = z;
      next[found] = head[home]; head[home] = found;
    }
    remap[p] = found;
  }
  const indices = new Uint32Array(idx.length);
  let n = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = remap[idx[t]], b = remap[idx[t + 1]], c = remap[idx[t + 2]];
    if (a === b || b === c || a === c) continue;
    indices[n++] = a; indices[n++] = b; indices[n++] = c;
  }
  return named({vertices: out.slice(0, count * 3), indices: indices.slice(0, n)}, mesh.name);
}

function named(mesh: TriangleMesh, name: string | undefined): TriangleMesh {
  if (name !== undefined) mesh.name = name;
  return mesh;
}

export interface MeshTransform {
  readonly position?: Vec3Like;
  /** Unit quaternion [x, y, z, w]; normalised for you. */
  readonly rotation?: QuatLike;
  /** One factor or one per axis. A mirroring scale also reverses the winding, so the mesh stays outward-facing. */
  readonly scale?: number | Vec3Like;
}

/** A copy scaled, then rotated, then translated. */
export function transformMesh(mesh: MeshLike, transform: MeshTransform): TriangleMesh {
  const {v, idx} = checkMesh(mesh);
  const s = typeof transform.scale === 'number' ? vec3([transform.scale, transform.scale, transform.scale], [1, 1, 1], 'scale') : vec3(transform.scale, [1, 1, 1], 'scale');
  const p = vec3(transform.position, [0, 0, 0], 'position');
  let q = [0, 0, 0, 1];
  if (transform.rotation !== undefined) {
    const r = transform.rotation as unknown as {x?: number; y?: number; z?: number; w?: number; length?: number; [i: number]: number};
    q = typeof r.length === 'number' ? [r[0], r[1], r[2], r[3]] : [r.x!, r.y!, r.z!, r.w!];
    const length = Math.hypot(q[0], q[1], q[2], q[3]);
    if (!(length > 0) || !Number.isFinite(length)) bad('rotation must be a non-zero quaternion [x, y, z, w].');
    q = q.map(c => c / length);
  }
  const m = trs(p, q, s);
  const vertices = new Float32Array(v.length);
  applyMatrix(m, v, vertices, 0, v.length / 3);
  const indices = Uint32Array.from(idx);
  if (s[0] * s[1] * s[2] < 0) swapWinding(indices, 0, indices.length);
  return named({vertices, indices}, mesh.name);
}

function swapWinding(indices: Uint32Array, from: number, to: number): void {
  for (let t = from; t < to; t += 3) { const k = indices[t + 1]; indices[t + 1] = indices[t + 2]; indices[t + 2] = k; }
}

/** A copy with every triangle reversed (turns an inside-out mesh the right way round). */
export function flipWinding(mesh: MeshLike): TriangleMesh {
  const {v, idx} = checkMesh(mesh);
  const indices = Uint32Array.from(idx);
  swapWinding(indices, 0, indices.length);
  return named({vertices: Float32Array.from(v), indices}, mesh.name);
}

/**
 * True when the surface has no boundary: after merging vertices within
 * `tolerance`, every triangle edge is matched by exactly one edge running the
 * other way. A closed mesh with consistent winding is what `meshVolume`,
 * `meshCenterOfMass`, `isConvex` and `convexDecompose` need.
 */
export function isClosed(mesh: MeshLike, tolerance = 0): boolean {
  const welded = weldVertices(mesh, tolerance), idx = welded.indices, nv = welded.vertices.length / 3;
  if (idx.length === 0) return false;
  const edges = new Map<number, number>();
  for (let t = 0; t < idx.length; t += 3) for (let e = 0; e < 3; e++) {
    const key = idx[t + e] * nv + idx[t + (e + 1) % 3];
    edges.set(key, (edges.get(key) ?? 0) + 1);
  }
  for (const [key, count] of edges) {
    const a = Math.floor(key / nv), b = key - a * nv;
    if (count !== 1 || edges.get(b * nv + a) !== 1) return false;
  }
  return true;
}

/**
 * True when the mesh is closed, outward-wound (positive volume) and no vertex
 * lies more than `tolerance` outside the plane of any triangle. The default
 * tolerance is 1e-6 of the bounding-box diagonal. Costs vertices x triangles
 * tests and refuses meshes beyond `GEOMETRY_LIMITS.maxConvexityTests`.
 */
export function isConvex(mesh: MeshLike, tolerance?: number): boolean {
  const welded = weldVertices(mesh, 0), v = welded.vertices, idx = welded.indices, nv = v.length / 3;
  const tol = tolerance ?? 1e-6 * diagonal(v);
  if (!(tol >= 0) || !Number.isFinite(tol)) bad('tolerance must be zero or a positive number.');
  if (!isClosed(welded) || !(integrals(v, idx).volume > 0)) return false;
  if (nv * (idx.length / 3) > GEOMETRY_LIMITS.maxConvexityTests) bad(`mesh is too large for isConvex (${nv} vertices x ${idx.length / 3} triangles).`);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = v[b] - v[a], uy = v[b + 1] - v[a + 1], uz = v[b + 2] - v[a + 2];
    const wx = v[c] - v[a], wy = v[c + 1] - v[a + 1], wz = v[c + 2] - v[a + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const length = Math.hypot(nx, ny, nz);
    if (!(length > 0)) continue;
    nx /= length; ny /= length; nz /= length;
    const d = nx * v[a] + ny * v[a + 1] + nz * v[a + 2];
    for (let p = 0; p < v.length; p += 3) if (nx * v[p] + ny * v[p + 1] + nz * v[p + 2] - d > tol) return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Convex hull (quickhull, farthest point first)
// ---------------------------------------------------------------------------

interface HullFace { a: number; b: number; c: number; nx: number; ny: number; nz: number; d: number; out: number[]; far: number; farD: number; alive: boolean; mark: number }
interface Hull { vertices: number[]; faces: number[] }

/**
 * Quickhull that always adds the point farthest from the current hull. Every
 * point it adds is a vertex of the true hull, so stopping at `maxVertices`
 * leaves an inscribed polytope that already holds the largest features.
 * Returns null when the points are coplanar within `eps`.
 */
function quickhull(p: ArrayLike<number>, maxVertices: number, epsScale = 1e-7): Hull | null {
  const n = Math.floor(p.length / 3);
  if (n < 4) return null;
  const eps = epsScale * diagonal(p);
  if (!(eps > 0)) return null;
  const extremes = [0, 0, 0, 0, 0, 0];
  for (let i = 1; i < n; i++) for (let k = 0; k < 3; k++) {
    if (p[i * 3 + k] < p[extremes[k * 2] * 3 + k]) extremes[k * 2] = i;
    if (p[i * 3 + k] > p[extremes[k * 2 + 1] * 3 + k]) extremes[k * 2 + 1] = i;
  }
  const dist2 = (i: number, j: number) => (p[i * 3] - p[j * 3]) ** 2 + (p[i * 3 + 1] - p[j * 3 + 1]) ** 2 + (p[i * 3 + 2] - p[j * 3 + 2]) ** 2;
  let i0 = 0, i1 = 0, best = 0;
  for (const a of extremes) for (const b of extremes) if (dist2(a, b) > best) { best = dist2(a, b); i0 = a; i1 = b; }
  if (!(Math.sqrt(best) > eps)) return null;
  const ex = p[i1 * 3] - p[i0 * 3], ey = p[i1 * 3 + 1] - p[i0 * 3 + 1], ez = p[i1 * 3 + 2] - p[i0 * 3 + 2], el = Math.sqrt(best);
  let i2 = -1; best = eps * eps;
  for (let i = 0; i < n; i++) {
    const x = p[i * 3] - p[i0 * 3], y = p[i * 3 + 1] - p[i0 * 3 + 1], z = p[i * 3 + 2] - p[i0 * 3 + 2];
    const cx = y * ez - z * ey, cy = z * ex - x * ez, cz = x * ey - y * ex, d2 = (cx * cx + cy * cy + cz * cz) / (el * el);
    if (d2 > best) { best = d2; i2 = i; }
  }
  if (i2 < 0) return null;
  const plane = (a: number, b: number, c: number): [number, number, number, number] => {
    const ux = p[b * 3] - p[a * 3], uy = p[b * 3 + 1] - p[a * 3 + 1], uz = p[b * 3 + 2] - p[a * 3 + 2];
    const wx = p[c * 3] - p[a * 3], wy = p[c * 3 + 1] - p[a * 3 + 1], wz = p[c * 3 + 2] - p[a * 3 + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length; ny /= length; nz /= length;
    return [nx, ny, nz, nx * p[a * 3] + ny * p[a * 3 + 1] + nz * p[a * 3 + 2]];
  };
  const base = plane(i0, i1, i2);
  let i3 = -1, signed = 0; best = eps;
  for (let i = 0; i < n; i++) {
    const d = base[0] * p[i * 3] + base[1] * p[i * 3 + 1] + base[2] * p[i * 3 + 2] - base[3];
    if (Math.abs(d) > best) { best = Math.abs(d); i3 = i; signed = d; }
  }
  if (i3 < 0) return null;

  const faces: HullFace[] = [], edges = new Map<number, HullFace>();
  const addFace = (a: number, b: number, c: number): HullFace => {
    const [nx, ny, nz, d] = plane(a, b, c);
    const face: HullFace = {a, b, c, nx, ny, nz, d, out: [], far: -1, farD: eps, alive: true, mark: -1};
    faces.push(face);
    edges.set(a * n + b, face); edges.set(b * n + c, face); edges.set(c * n + a, face);
    return face;
  };
  const height = (face: HullFace, i: number) => face.nx * p[i * 3] + face.ny * p[i * 3 + 1] + face.nz * p[i * 3 + 2] - face.d;
  const assign = (i: number, candidates: readonly HullFace[]) => {
    for (const face of candidates) {
      const h = height(face, i);
      if (h > eps) {
        face.out.push(i);
        if (h > face.farD) { face.farD = h; face.far = i; }
        return;
      }
    }
  };
  // The base triangle faces away from the fourth point.
  if (signed > 0) { const k = i1; i1 = i2; i2 = k; }
  const first = [addFace(i0, i1, i2), addFace(i0, i3, i1), addFace(i1, i3, i2), addFace(i2, i3, i0)];
  for (let i = 0; i < n; i++) if (i !== i0 && i !== i1 && i !== i2 && i !== i3) assign(i, first);
  const vertices = [i0, i1, i2, i3];

  for (let stamp = 0; vertices.length < maxVertices; stamp++) {
    let seed: HullFace | null = null;
    for (const face of faces) if (face.alive && face.far >= 0 && (!seed || face.farD > seed.farD)) seed = face;
    if (!seed) break;
    const apex = seed.far, visible: HullFace[] = [seed], horizon: number[] = [];
    seed.mark = stamp;
    for (let k = 0; k < visible.length; k++) {
      const face = visible[k], corners = [face.a, face.b, face.c];
      for (let e = 0; e < 3; e++) {
        const u = corners[e], w = corners[(e + 1) % 3], neighbour = edges.get(w * n + u);
        if (!neighbour || neighbour.mark === stamp) continue;
        if (height(neighbour, apex) > eps) { neighbour.mark = stamp; visible.push(neighbour); } else horizon.push(u, w);
      }
    }
    const orphans: number[] = [];
    for (const face of visible) {
      face.alive = false;
      for (const i of face.out) if (i !== apex) orphans.push(i);
      face.out = [];
      edges.delete(face.a * n + face.b); edges.delete(face.b * n + face.c); edges.delete(face.c * n + face.a);
    }
    const fresh: HullFace[] = [];
    for (let h = 0; h < horizon.length; h += 2) fresh.push(addFace(horizon[h], horizon[h + 1], apex));
    for (const i of orphans) assign(i, fresh);
    vertices.push(apex);
    if (faces.length > 64 && faces.length > edges.size) {
      let kept = 0;
      for (const face of faces) if (face.alive) faces[kept++] = face;
      faces.length = kept;
    }
  }
  const out: number[] = [];
  for (const face of faces) if (face.alive) out.push(face.a, face.b, face.c);
  return {vertices, faces: out};
}

// Half-edges of the hull once triangles in one plane are merged into polygons, as Box3D stores it.
// Only faces that agree to about 1e-5 rad count as one plane, so this never undercounts.
function hullHalfEdges(p: ArrayLike<number>, hull: Hull): number {
  const faces = hull.faces, normals = new Float64Array(faces.length), owner = new Map<number, number>(), n = Math.floor(p.length / 3);
  for (let t = 0; t < faces.length; t += 3) {
    const a = faces[t] * 3, b = faces[t + 1] * 3, c = faces[t + 2] * 3;
    const ux = p[b] - p[a], uy = p[b + 1] - p[a + 1], uz = p[b + 2] - p[a + 2], wx = p[c] - p[a], wy = p[c + 1] - p[a + 1], wz = p[c + 2] - p[a + 2];
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx, length = Math.hypot(nx, ny, nz) || 1;
    normals[t] = nx / length; normals[t + 1] = ny / length; normals[t + 2] = nz / length;
    for (let e = 0; e < 3; e++) owner.set(faces[t + e] * n + faces[t + (e + 1) % 3], t);
  }
  let count = 0;
  for (const [key, t] of owner) {
    const a = Math.floor(key / n), b = key - a * n, other = owner.get(b * n + a);
    if (other === undefined || 1 - (normals[t] * normals[other] + normals[t + 1] * normals[other + 1] + normals[t + 2] * normals[other + 2]) > 1e-10) count++;
  }
  return count;
}

// A hull Box3D accepts: at most `maxPoints` vertices and at most 255 half-edges. A hull whose faces are all
// triangles has 6 V - 12 half-edges, so 44 vertices always fit.
function boxHull(p: ArrayLike<number>, maxPoints: number): Hull | null {
  const hull = quickhull(p, maxPoints);
  if (!hull || hull.vertices.length <= 44 || hullHalfEdges(p, hull) <= GEOMETRY_LIMITS.maxHullHalfEdges) return hull;
  return quickhull(p, 44);
}

function hullMesh(p: ArrayLike<number>, hull: Hull): TriangleMesh {
  const local = new Map<number, number>(), vertices = new Float32Array(hull.vertices.length * 3);
  hull.vertices.forEach((index, i) => {
    local.set(index, i);
    vertices[i * 3] = p[index * 3]; vertices[i * 3 + 1] = p[index * 3 + 1]; vertices[i * 3 + 2] = p[index * 3 + 2];
  });
  return {vertices, indices: Uint32Array.from(hull.faces, index => local.get(index)!)};
}

export interface ConvexHullOptions {
  /** Stop after this many hull vertices, keeping the farthest-first ones. Default: no limit. */
  readonly maxVertices?: number;
}

/**
 * Convex hull of a flat [x, y, z, ...] point list (or of a mesh's vertices) as
 * a closed, outward-wound triangle mesh. With `maxVertices` the result is an
 * inscribed approximation: its volume never exceeds the true hull's. Points
 * within 1e-7 of the bounding-box diagonal of a face are treated as on it.
 */
export function convexHull(points: ArrayLike<number> | MeshLike, options: ConvexHullOptions = {}): TriangleMesh {
  const p = pointsOf(points);
  const max = options.maxVertices ?? Infinity;
  if (!(max >= 4)) bad('maxVertices must be at least 4.');
  const hull = quickhull(p, max);
  if (!hull) bad('points are coplanar (or fewer than four), so they have no convex hull with volume.');
  return hullMesh(p, hull!);
}

function pointsOf(points: ArrayLike<number> | MeshLike): ArrayLike<number> {
  const p = (points as MeshLike).vertices !== undefined && typeof (points as ArrayLike<number>).length !== 'number' ? (points as MeshLike).vertices : points as ArrayLike<number>;
  if (!p || typeof p.length !== 'number' || p.length % 3 !== 0) bad('points must be a flat list of x, y, z triples.');
  if (p.length / 3 > GEOMETRY_LIMITS.maxVertices) bad(`too many points (${p.length / 3}); the limit is ${GEOMETRY_LIMITS.maxVertices}.`);
  for (let i = 0; i < p.length; i++) if (!Number.isFinite(p[i])) bad(`point ${Math.floor(i / 3)} is not finite.`);
  return p;
}

// ---------------------------------------------------------------------------
// Shapes for PhysicsWorld.createBody
// ---------------------------------------------------------------------------

export interface HullShape { readonly kind: 'hull'; readonly points: Float32Array }
export interface MeshShape { readonly kind: 'mesh'; readonly vertices: Float32Array; readonly indices: Uint32Array }
export interface HeightfieldShape {
  readonly kind: 'heightfield';
  readonly heights: Float32Array;
  readonly countX: number;
  readonly countZ: number;
  readonly spacing: readonly [number, number];
  /** Use this as the body position so the grid sits where the source surface is. */
  readonly origin: [number, number, number];
}

export interface HullShapeOptions {
  /** Most hull points to keep, 4..64. Default 32. */
  readonly maxPoints?: number;
}

/**
 * The convex hull of a mesh (or point list) as a `{kind: 'hull'}` shape. Only
 * true hull vertices are returned. When the hull has more than `maxPoints`
 * vertices the farthest-first subset is kept, which makes the shape slightly
 * smaller than the true hull, never larger.
 *
 * Box3D stores at most 64 hull vertices and 255 half-edges, and rejects a
 * hull beyond the second limit. A hull whose faces are all triangles (any
 * rounded shape) reaches it at 44 vertices, so such a hull is cut to 44 points
 * even when `maxPoints` is higher; a hull with polygonal faces (a prism, a
 * bevelled box) can keep all 64. Passing a raw point cloud of a rounded shape
 * straight to `createBody` fails for the same reason; this function is the fix.
 */
export function toHullShape(mesh: MeshLike | ArrayLike<number>, options: HullShapeOptions = {}): HullShape {
  const max = options.maxPoints ?? 32;
  if (!Number.isInteger(max) || max < 4 || max > GEOMETRY_LIMITS.maxHullPoints) bad(`maxPoints must be an integer from 4 to ${GEOMETRY_LIMITS.maxHullPoints}.`);
  const p = pointsOf(mesh), hull = boxHull(p, max);
  if (!hull) bad('points are coplanar (or fewer than four), so they have no convex hull with volume.');
  return {kind: 'hull', points: hullMesh(p, hull!).vertices};
}

/** A validated `{kind: 'mesh'}` shape for static scenery. Zero-area triangles are dropped; winding is kept. */
export function toMeshShape(mesh: MeshLike): MeshShape {
  const {v, idx} = checkMesh(mesh);
  const vertices = Float32Array.from(v), indices = new Uint32Array(idx.length);
  let n = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = vertices[b] - vertices[a], uy = vertices[b + 1] - vertices[a + 1], uz = vertices[b + 2] - vertices[a + 2];
    const wx = vertices[c] - vertices[a], wy = vertices[c + 1] - vertices[a + 1], wz = vertices[c + 2] - vertices[a + 2];
    if (!(Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) > 0)) continue;
    indices[n++] = idx[t]; indices[n++] = idx[t + 1]; indices[n++] = idx[t + 2];
  }
  if (n === 0) bad('mesh has no triangles with area.');
  return {kind: 'mesh', vertices, indices: indices.slice(0, n)};
}

export interface HeightfieldOptions {
  readonly countX: number;
  readonly countZ: number;
  /** Grid step [dx, dz]. Required for a function; for a mesh the default spans its bounds. */
  readonly spacing?: readonly [number, number];
  /** World [x, z] of grid point (0, 0). Default: the mesh's minimum corner, or [0, 0] for a function. */
  readonly origin?: readonly [number, number];
  /** Height used where no part of the mesh lies above a grid point. Without it such a point is an error. */
  readonly missing?: number;
}

/**
 * Sample a surface onto the regular grid a height field needs. Pass a function
 * `(x, z) => y`, or a mesh: each grid point then takes the highest point of
 * the mesh on its vertical line (vertical faces are skipped). Heights are
 * absolute, so use the returned `origin` as the body position. Between grid
 * points the terrain is piecewise linear, so features narrower than the
 * spacing are lost.
 */
export function toHeightfieldShape(source: MeshLike | ((x: number, z: number) => number), options: HeightfieldOptions): HeightfieldShape {
  const {countX, countZ} = options;
  if (!Number.isInteger(countX) || !Number.isInteger(countZ) || countX < 2 || countZ < 2) bad('countX and countZ must be integers of at least 2.');
  if (countX * countZ > GEOMETRY_LIMITS.maxHeightfieldCells) bad(`height field of ${countX} x ${countZ} exceeds ${GEOMETRY_LIMITS.maxHeightfieldCells} points.`);
  const pair = (value: readonly [number, number] | undefined, label: string): [number, number] | undefined => {
    if (value === undefined) return undefined;
    if (!(value.length === 2) || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) bad(`${label} must be two finite numbers.`);
    return [value[0], value[1]];
  };
  let spacing = pair(options.spacing, 'spacing'), origin = pair(options.origin, 'origin');
  const heights = new Float32Array(countX * countZ);
  if (typeof source === 'function') {
    if (!spacing) bad('spacing is required when sampling a function.');
    origin ??= [0, 0];
    if (!(spacing![0] > 0 && spacing![1] > 0)) bad('spacing must be positive.');
    for (let j = 0; j < countZ; j++) for (let i = 0; i < countX; i++) {
      const y = source(origin[0] + i * spacing![0], origin[1] + j * spacing![1]);
      if (typeof y !== 'number' || !Number.isFinite(y)) bad(`the height function returned ${String(y)} at grid point (${i}, ${j}).`);
      heights[i + j * countX] = y;
    }
    return {kind: 'heightfield', heights, countX, countZ, spacing: spacing!, origin: [origin[0], 0, origin[1]]};
  }
  const {v, idx} = checkMesh(source);
  const bounds = meshBounds(source);
  origin ??= [bounds.min[0], bounds.min[2]];
  spacing ??= [(bounds.max[0] - origin[0]) / (countX - 1), (bounds.max[2] - origin[1]) / (countZ - 1)];
  if (!(spacing[0] > 0 && spacing[1] > 0)) bad('spacing must be positive (the mesh has no extent along x or z).');
  if (options.missing !== undefined && !Number.isFinite(options.missing)) bad('missing must be a finite number.');
  heights.fill(-Infinity);
  const [ox, oz] = origin, [dx, dz] = spacing, slack = 1e-7;
  let work = 0;
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    // Triangle corners in grid units.
    const ax = (v[a] - ox) / dx, az = (v[a + 2] - oz) / dz, bx = (v[b] - ox) / dx, bz = (v[b + 2] - oz) / dz, cx = (v[c] - ox) / dx, cz = (v[c + 2] - oz) / dz;
    const area = (bx - ax) * (cz - az) - (cx - ax) * (bz - az);
    if (!(Math.abs(area) > 1e-12)) continue;
    const i0 = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - slack)), i1 = Math.min(countX - 1, Math.floor(Math.max(ax, bx, cx) + slack));
    const j0 = Math.max(0, Math.ceil(Math.min(az, bz, cz) - slack)), j1 = Math.min(countZ - 1, Math.floor(Math.max(az, bz, cz) + slack));
    if (i1 < i0 || j1 < j0) continue;
    work += (i1 - i0 + 1) * (j1 - j0 + 1);
    if (work > 4e8) bad('sampling this mesh onto this grid is too much work; use a coarser grid or a simpler mesh.');
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const wb = ((i - ax) * (cz - az) - (cx - ax) * (j - az)) / area, wc = ((bx - ax) * (j - az) - (i - ax) * (bz - az)) / area, wa = 1 - wb - wc;
      if (wa < -slack || wb < -slack || wc < -slack) continue;
      const y = wa * v[a + 1] + wb * v[b + 1] + wc * v[c + 1];
      if (y > heights[i + j * countX]) heights[i + j * countX] = y;
    }
  }
  for (let k = 0; k < heights.length; k++) if (heights[k] === -Infinity) {
    if (options.missing === undefined) bad(`the mesh has no surface above grid point (${k % countX}, ${Math.floor(k / countX)}); pass options.missing for a fill height.`);
    heights[k] = options.missing!;
  }
  return {kind: 'heightfield', heights, countX, countZ, spacing, origin: [ox, 0, oz]};
}

// ---------------------------------------------------------------------------
// Approximate convex decomposition
// ---------------------------------------------------------------------------

export interface ConvexDecomposeOptions {
  /** Most hulls to return, 1..64. Default 16. */
  readonly maxHulls?: number;
  /** Stop when (sum of hull volumes - sum of part volumes) / mesh volume falls to this. Default 0.01. */
  readonly maxConcavity?: number;
  /** Most points per hull, 4..64. Default 32. Hulls with only triangular faces are cut to 44 (see `toHullShape`). */
  readonly maxHullPoints?: number;
  /** Most face planes tried per split, 1..64. Default 16 (the largest by area); nine axis-aligned planes are always added. */
  readonly maxCandidates?: number;
}

export interface ConvexPart {
  /** Hull points, ready for `{kind: 'hull', points}`. */
  points: Float32Array;
  /** Volume of the hull of `points`. */
  volume: number;
  /** Exact volume of the piece of the original solid this hull covers. */
  partVolume: number;
  /** Centre of mass of that piece. */
  centroid: [number, number, number];
}

export interface ConvexDecomposition {
  hulls: ConvexPart[];
  /** Volume of the input mesh. */
  meshVolume: number;
  /** Sum of the hull volumes. Hulls of neighbouring pieces may overlap, and the overlap is counted twice. */
  hullVolume: number;
  /** (hullVolume - meshVolume) / meshVolume. Zero when the pieces are exactly convex. */
  volumeError: number;
  /** Sum of the pieces' exact volumes over the mesh volume, minus 1: what the splitting itself lost (slivers dropped). */
  partVolumeError: number;
}

interface Part { tris: Float64Array; volume: number; centroid: V3; hullVolume: number; concavity: number; final: boolean }

// Volume and centroid of a triangle soup whose signed sum is closed.
function soupIntegrals(tris: Float64Array): {volume: number; centroid: V3} {
  const rx = tris[0], ry = tris[1], rz = tris[2];
  let six = 0, sx = 0, sy = 0, sz = 0;
  for (let t = 0; t < tris.length; t += 9) {
    const ax = tris[t] - rx, ay = tris[t + 1] - ry, az = tris[t + 2] - rz;
    const bx = tris[t + 3] - rx, by = tris[t + 4] - ry, bz = tris[t + 5] - rz;
    const cx = tris[t + 6] - rx, cy = tris[t + 7] - ry, cz = tris[t + 8] - rz;
    const det = ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    six += det; sx += det * (ax + bx + cx); sy += det * (ay + by + cy); sz += det * (az + bz + cz);
  }
  return {volume: six / 6, centroid: six === 0 ? [rx, ry, rz] : [rx + sx / (4 * six), ry + sy / (4 * six), rz + sz / (4 * six)]};
}

function hullVolumeOf(p: ArrayLike<number>, hull: Hull): number {
  const r = hull.faces[0] * 3;
  let six = 0;
  for (let t = 0; t < hull.faces.length; t += 3) {
    const a = hull.faces[t] * 3, b = hull.faces[t + 1] * 3, c = hull.faces[t + 2] * 3;
    const ax = p[a] - p[r], ay = p[a + 1] - p[r + 1], az = p[a + 2] - p[r + 2];
    const bx = p[b] - p[r], by = p[b + 1] - p[r + 1], bz = p[b + 2] - p[r + 2];
    const cx = p[c] - p[r], cy = p[c + 1] - p[r + 1], cz = p[c + 2] - p[r + 2];
    six += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
  }
  return six / 6;
}

/**
 * Cut a closed triangle soup with the plane n . x = d. Each side keeps its
 * clipped triangles and is closed again with a fan of triangles from one point
 * of the cut plane to every cut edge. The fan can fold over itself when the
 * cross-section is not convex, but its signed sum is the cross-section, so
 * volumes and centroids of both sides are exact and their hulls are unchanged.
 */
function clipSoup(tris: Float64Array, nx: number, ny: number, nz: number, d: number, eps: number): [Float64Array, Float64Array] {
  const sides: number[][] = [[], []], cuts: number[][] = [[], []];
  const h = [0, 0, 0], s = [0, 0, 0], poly: number[] = [], on: boolean[] = [];
  for (let t = 0; t < tris.length; t += 9) {
    for (let k = 0; k < 3; k++) {
      h[k] = nx * tris[t + k * 3] + ny * tris[t + k * 3 + 1] + nz * tris[t + k * 3 + 2] - d;
      s[k] = h[k] > eps ? 1 : h[k] < -eps ? -1 : 0;
    }
    let only = 0;   // a triangle lying in the plane bounds the side its normal points away from
    if (s[0] === 0 && s[1] === 0 && s[2] === 0) {
      const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
      const wx = tris[t + 6] - tris[t], wy = tris[t + 7] - tris[t + 1], wz = tris[t + 8] - tris[t + 2];
      only = (uy * wz - uz * wy) * nx + (uz * wx - ux * wz) * ny + (ux * wy - uy * wx) * nz > 0 ? -1 : 1;
    }
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? -1 : 1;
      if (only !== 0 && only !== sign) continue;
      poly.length = 0; on.length = 0;
      for (let k = 0; k < 3; k++) {
        const m = (k + 1) % 3;
        if (s[k] * sign >= 0) { poly.push(tris[t + k * 3], tris[t + k * 3 + 1], tris[t + k * 3 + 2]); on.push(s[k] === 0); }
        if (s[k] * s[m] < 0) {
          // Always interpolate from the negative end, so both triangles sharing the edge get the same point.
          const lo = s[k] < 0 ? k : m, hi = s[k] < 0 ? m : k, u = h[lo] / (h[lo] - h[hi]);
          for (let c = 0; c < 3; c++) poly.push(tris[t + lo * 3 + c] + u * (tris[t + hi * 3 + c] - tris[t + lo * 3 + c]));
          on.push(true);
        }
      }
      const count = on.length;
      if (count < 3) continue;
      const out = sides[side], cut = cuts[side];
      for (let k = 1; k + 1 < count; k++) out.push(poly[0], poly[1], poly[2], poly[k * 3], poly[k * 3 + 1], poly[k * 3 + 2], poly[k * 3 + 3], poly[k * 3 + 4], poly[k * 3 + 5]);
      for (let k = 0; k < count; k++) {
        const m = (k + 1) % count;
        if (on[k] && on[m]) cut.push(poly[k * 3], poly[k * 3 + 1], poly[k * 3 + 2], poly[m * 3], poly[m * 3 + 1], poly[m * 3 + 2]);
      }
    }
  }
  return [0, 1].map(side => {
    const out = sides[side], cut = cuts[side];
    if (cut.length > 0) {
      let cx = 0, cy = 0, cz = 0;
      for (let k = 0; k < cut.length; k += 3) { cx += cut[k]; cy += cut[k + 1]; cz += cut[k + 2]; }
      const m = cut.length / 3;
      cx /= m; cy /= m; cz /= m;
      for (let k = 0; k < cut.length; k += 6) out.push(cut[k + 3], cut[k + 4], cut[k + 5], cut[k], cut[k + 1], cut[k + 2], cx, cy, cz);
    }
    return Float64Array.from(out);
  }) as [Float64Array, Float64Array];
}

const SEARCH_HULL_VERTICES = 4096;
// A piece counts as convex when its hull exceeds it by less than this fraction.
const CONVEX_FRACTION = 1e-6;

// The distinct points of a soup (each corner is stored once per triangle that uses it).
function distinctPoints(tris: Float64Array): Float64Array {
  const n = tris.length / 3, words = new Uint32Array(tris.buffer, tris.byteOffset, n * 6);
  let size = 16;
  while (size < n * 2) size *= 2;
  const table = new Int32Array(size).fill(-1), out = new Float64Array(tris.length);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const x = tris[i * 3], y = tris[i * 3 + 1], z = tris[i * 3 + 2];
    let h = 0;
    for (let w = 0; w < 6; w++) h = Math.imul(h ^ words[i * 6 + w], 0x9e3779b1);
    let slot = (h ^ h >>> 15) & (size - 1);
    for (;;) {
      const k = table[slot];
      if (k < 0) { table[slot] = count; out[count * 3] = x; out[count * 3 + 1] = y; out[count * 3 + 2] = z; count++; break; }
      if (out[k * 3] === x && out[k * 3 + 1] === y && out[k * 3 + 2] === z) break;
      slot = (slot + 1) & (size - 1);
    }
  }
  return out.subarray(0, count * 3);
}

function makePart(tris: Float64Array, minVolume: number): Part | null {
  if (tris.length < 36) return null;
  const {volume, centroid} = soupIntegrals(tris);
  if (!(volume > minVolume)) return null;
  const points = distinctPoints(tris), hull = quickhull(points, SEARCH_HULL_VERTICES);
  if (!hull) return null;
  const hullVolume = hullVolumeOf(points, hull);
  return {tris, volume, centroid, hullVolume, concavity: Math.max(0, hullVolume - volume), final: false};
}

function splitPart(part: Part, maxCandidates: number, minVolume: number): [Part, Part] | null {
  const tris = part.tris, size = diagonal(tris), eps = 1e-6 * size;
  // Candidate planes: the planes of the part's own faces (a concave solid is cut best along the faces that
  // meet at its inner corners), merged when they coincide and ranked by area, plus axis-aligned planes.
  const planes = new Map<string, {nx: number; ny: number; nz: number; d: number; area: number}>();
  for (let t = 0; t < tris.length; t += 9) {
    const ux = tris[t + 3] - tris[t], uy = tris[t + 4] - tris[t + 1], uz = tris[t + 5] - tris[t + 2];
    const wx = tris[t + 6] - tris[t], wy = tris[t + 7] - tris[t + 1], wz = tris[t + 8] - tris[t + 2];
    let nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    const length = Math.hypot(nx, ny, nz);
    if (!(length > 1e-12 * size * size)) continue;
    nx /= length; ny /= length; nz /= length;
    // A plane and its mirror image cut the same way: make the largest normal component positive.
    const flip = (Math.abs(nx) >= Math.abs(ny) && Math.abs(nx) >= Math.abs(nz) ? nx : Math.abs(ny) >= Math.abs(nz) ? ny : nz) < 0 ? -1 : 1;
    nx *= flip; ny *= flip; nz *= flip;
    const d = nx * tris[t] + ny * tris[t + 1] + nz * tris[t + 2];
    const key = `${Math.round(nx * 1e4)},${Math.round(ny * 1e4)},${Math.round(nz * 1e4)},${Math.round(d / (1e-5 * size))}`;
    const seen = planes.get(key);
    if (seen) seen.area += length; else planes.set(key, {nx, ny, nz, d, area: length});
  }
  const cuts = (plane: {nx: number; ny: number; nz: number; d: number}): boolean => {
    let above = false, below = false;
    for (let k = 0; k < tris.length; k += 3) {
      const h = plane.nx * tris[k] + plane.ny * tris[k + 1] + plane.nz * tris[k + 2] - plane.d;
      if (h > 10 * eps) above = true; else if (h < -10 * eps) below = true;
      if (above && below) return true;
    }
    return false;
  };
  const candidates = [...planes.values()].filter(cuts).sort((a, b) => b.area - a.area).slice(0, maxCandidates);
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let k = 0; k < tris.length; k++) { const axis = k % 3; if (tris[k] < lo[axis]) lo[axis] = tris[k]; if (tris[k] > hi[axis]) hi[axis] = tris[k]; }
  for (let axis = 0; axis < 3; axis++) for (const u of [0.25, 0.5, 0.75]) {
    if (!(hi[axis] - lo[axis] > 100 * eps)) continue;
    candidates.push({nx: axis === 0 ? 1 : 0, ny: axis === 1 ? 1 : 0, nz: axis === 2 ? 1 : 0, d: lo[axis] + u * (hi[axis] - lo[axis]), area: 0});
  }
  let best: [Part, Part] | null = null, bestOpen = 3, bestCost = Infinity;
  for (const plane of candidates) {
    const [below, above] = clipSoup(tris, plane.nx, plane.ny, plane.nz, plane.d, eps);
    const a = makePart(below, minVolume), b = makePart(above, minVolume);
    if (!a || !b) continue;
    // First, the fewest halves still concave (a cut that finishes a piece is never wasted). Then the least
    // concavity left plus a penalty for uneven halves: without it a curved solid is shaved into slivers,
    // each of which lowers the concavity a little, where a cut through the middle lowers it most in the end.
    // On a tie the earlier candidate stays: face planes come before axis planes, larger faces first.
    const open = (a.concavity > CONVEX_FRACTION * a.hullVolume ? 1 : 0) + (b.concavity > CONVEX_FRACTION * b.hullVolume ? 1 : 0);
    const cost = a.concavity + b.concavity + 0.5 * part.concavity * Math.abs(a.volume - b.volume) / part.volume;
    if (open < bestOpen || (open === bestOpen && cost < bestCost - 1e-9 * part.hullVolume)) { bestOpen = open; bestCost = cost; best = [a, b]; }
  }
  return best;
}

/**
 * Approximate convex decomposition of a closed, outward-wound mesh, for
 * turning a concave solid into a set of convex hulls.
 *
 * The method is greedy recursive plane splitting. Each piece's concavity is
 * the volume of its convex hull minus its own volume. The piece with the
 * largest concavity is cut in two by one plane, chosen among the planes of its
 * own faces (the largest `maxCandidates` by area) and nine axis-aligned planes
 * at the quarter points of its bounds: the plane that leaves the fewest
 * concave halves, then the least concavity plus a penalty for uneven halves.
 * This repeats until the summed concavity is at most `maxConcavity` of the
 * mesh volume or `maxHulls` pieces exist. The result is the hull of each piece.
 *
 * Limits, stated plainly:
 * - It is not V-HACD or CoACD. Cuts are single planes chosen greedily, so a
 *   polyhedral solid with flat inner faces (an L, a U, a bracket, steps) splits
 *   exactly, while a curved concavity (a bowl, a torus) is only approached as
 *   the hull count grows; check `volumeError`.
 * - The mesh must be closed and must not self-intersect; an open or inside-out
 *   mesh is rejected.
 * - Hulls of neighbouring pieces can overlap, and each hull is limited to
 *   `maxHullPoints` points, so `hullVolume` can be above or (rarely) below the
 *   mesh volume. `partVolume` is each piece's exact volume.
 * - Cost grows with triangles x candidates x hulls: fine for thousands of
 *   triangles, slow for hundreds of thousands. Simplify big meshes first.
 * - Pieces thinner than about 1e-6 of the mesh size are dropped.
 */
export function convexDecompose(mesh: MeshLike, options: ConvexDecomposeOptions = {}): ConvexDecomposition {
  const maxHulls = options.maxHulls ?? 16, maxConcavity = options.maxConcavity ?? 0.01, maxHullPoints = options.maxHullPoints ?? 32, maxCandidates = options.maxCandidates ?? 16;
  if (!Number.isInteger(maxHulls) || maxHulls < 1 || maxHulls > GEOMETRY_LIMITS.maxHulls) bad(`maxHulls must be an integer from 1 to ${GEOMETRY_LIMITS.maxHulls}.`);
  if (!(maxConcavity >= 0) || !Number.isFinite(maxConcavity)) bad('maxConcavity must be zero or a positive number.');
  if (!Number.isInteger(maxHullPoints) || maxHullPoints < 4 || maxHullPoints > GEOMETRY_LIMITS.maxHullPoints) bad(`maxHullPoints must be an integer from 4 to ${GEOMETRY_LIMITS.maxHullPoints}.`);
  if (!Number.isInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 64) bad('maxCandidates must be an integer from 1 to 64.');
  const welded = weldVertices(mesh, 0), v = welded.vertices, idx = welded.indices;
  if (idx.length / 3 > GEOMETRY_LIMITS.maxDecomposeTriangles) bad(`convexDecompose accepts at most ${GEOMETRY_LIMITS.maxDecomposeTriangles} triangles; this mesh has ${idx.length / 3}.`);
  if (!isClosed(welded)) bad('convexDecompose needs a closed mesh (every edge shared by exactly two triangles, wound consistently).');
  const total = integrals(v, idx).volume, size = diagonal(v);
  if (total < 0) bad('mesh is inside out (negative volume); use flipWinding first.');
  if (!(total > 1e-12 * size * size * size)) bad('mesh encloses no volume.');
  const soup = new Float64Array(idx.length * 3);
  for (let k = 0; k < idx.length; k++) { soup[k * 3] = v[idx[k] * 3]; soup[k * 3 + 1] = v[idx[k] * 3 + 1]; soup[k * 3 + 2] = v[idx[k] * 3 + 2]; }
  const minVolume = 1e-9 * total;
  const whole = makePart(soup, minVolume);
  if (!whole) bad('mesh is flat.');
  const parts: Part[] = [whole!];
  while (parts.length < maxHulls) {
    let concavity = 0, worst: Part | null = null;
    for (const part of parts) {
      concavity += part.concavity;
      if (!part.final && part.concavity > CONVEX_FRACTION * part.hullVolume && (!worst || part.concavity > worst.concavity)) worst = part;
    }
    if (concavity <= maxConcavity * total || !worst) break;
    const halves = splitPart(worst, maxCandidates, minVolume);
    if (!halves) { worst.final = true; continue; }
    parts.splice(parts.indexOf(worst), 1, halves[0], halves[1]);
  }
  const hulls: ConvexPart[] = [];
  let hullVolume = 0, partVolume = 0;
  for (const part of parts) {
    const hull = boxHull(part.tris, maxHullPoints);
    if (!hull) continue;
    const points = hullMesh(part.tris, hull).vertices;
    const rounded = quickhull(points, maxHullPoints);
    if (!rounded) continue;
    const volume = hullVolumeOf(points, rounded);
    hulls.push({points, volume, partVolume: part.volume, centroid: part.centroid});
    hullVolume += volume; partVolume += part.volume;
  }
  hulls.sort((a, b) => b.partVolume - a.partVolume);
  return {hulls, meshVolume: total, hullVolume, volumeError: (hullVolume - total) / total, partVolumeError: (partVolume - total) / total};
}

// ---------------------------------------------------------------------------
// Bodies from a mesh
// ---------------------------------------------------------------------------

/** The part of `PhysicsWorld` this module uses. */
export interface BodyFactory {
  createBody(options: BodyOptions): Body | null;
  createJoint(options: JointOptions): Joint;
  destroyBody?(body: Body): boolean;
}

export interface MeshBodiesOptions extends Omit<BodyOptions, 'shape' | 'position' | 'type'> {
  /**
   * 'mesh' (default): one static triangle-mesh body, for scenery of any shape.
   * 'hull': one body with the mesh's convex hull.
   * 'decomposed': one hull body per piece of `convexDecompose`, welded together.
   */
  readonly as?: 'mesh' | 'hull' | 'decomposed';
  /** Where the mesh's origin goes. Default [0, 0, 0]. */
  readonly position?: Vec3Like;
  /** For 'hull' and 'decomposed'. Default 'dynamic'. A 'mesh' body is always static. */
  readonly type?: BodyType;
  /** For 'hull': most hull points, default 32. */
  readonly maxPoints?: number;
  /** For 'decomposed'. */
  readonly decomposition?: ConvexDecomposeOptions;
}

export interface MeshBodies {
  bodies: Body[];
  /** Weld joints holding a decomposed set together (bodies[0] to each other body). Empty otherwise. */
  joints: Joint[];
  /** The decomposition, when `as` is 'decomposed'. */
  decomposition?: ConvexDecomposition;
}

// Bodies of one decomposed mesh share a negative collision group, so they never collide with each other.
let nextGroup = -0x4000;

/**
 * Put a mesh into a world.
 *
 * - `as: 'mesh'`: one static triangle-mesh body.
 * - `as: 'hull'`: one body shaped as the mesh's convex hull (see `toHullShape`
 *   for how many points are kept). For a closed mesh the density is scaled so
 *   the body's mass is density x mesh volume, whether the hull is larger than
 *   the mesh (a concave solid) or smaller (a rounded solid cut to 44 points);
 *   for an open mesh the mass is density x hull volume.
 * - `as: 'decomposed'`: the kit has no compound shapes yet, so a concave solid
 *   becomes one hull body per convex piece, all created at the same pose and
 *   held together by weld joints to the largest piece. The pieces share a
 *   negative collision group (pass `filter.groupIndex` to choose it), so they
 *   do not push each other apart. Each piece's density is scaled by its exact
 *   volume over its hull volume, so the set's total mass is density x mesh
 *   volume even where hulls overlap. Welds are solved iteratively: under hard
 *   impacts the set flexes slightly, unlike a true compound body.
 */
export function createBodiesFromMesh(world: BodyFactory, mesh: MeshLike, options: MeshBodiesOptions = {}): MeshBodies {
  const {as = 'mesh', position, type, maxPoints, decomposition: decomposeOptions, ...rest} = options;
  const at = vec3(position, [0, 0, 0], 'position');
  const bodies: Body[] = [], joints: Joint[] = [];
  const create = (bodyOptions: BodyOptions): Body => {
    const body = world.createBody(bodyOptions);
    if (!body) {
      for (const made of bodies) world.destroyBody?.(made);
      throw new EngineError('INVALID_STATE', 'The world could not create the body (is it full?).');
    }
    bodies.push(body);
    return body;
  };
  if (as === 'mesh') {
    create({...rest, shape: toMeshShape(mesh), position: at, type: 'static'});
    return {bodies, joints};
  }
  if (as === 'hull') {
    const shape = toHullShape(mesh, maxPoints === undefined ? {} : {maxPoints});
    let density = rest.density ?? 1000;
    if (isClosed(mesh)) {
      const solid = meshVolume(mesh), hull = quickhull(shape.points, Infinity);
      if (solid > 0 && hull) density *= solid / hullVolumeOf(shape.points, hull);
    }
    create({...rest, shape, position: at, type: type ?? 'dynamic', density});
    return {bodies, joints};
  }
  if (as !== 'decomposed') bad(`as must be 'mesh', 'hull' or 'decomposed'.`);
  const decomposition = convexDecompose(mesh, decomposeOptions);
  if (decomposition.hulls.length === 0) bad('the decomposition produced no hulls.');
  const density = rest.density ?? 1000, single = decomposition.hulls.length === 1;
  const filter = single ? rest.filter : {...rest.filter, groupIndex: rest.filter?.groupIndex || nextGroup--};
  if (nextGroup < -0x7fff0000) nextGroup = -0x4000;
  for (const hull of decomposition.hulls) {
    create({...rest, ...(filter ? {filter} : {}), shape: {kind: 'hull', points: hull.points}, position: at, type: type ?? 'dynamic', density: density * hull.partVolume / hull.volume});
  }
  if ((type ?? 'dynamic') === 'dynamic') for (let i = 1; i < bodies.length; i++) joints.push(world.createJoint({type: 'weld', bodyA: bodies[0], bodyB: bodies[i]}));
  return {bodies, joints, decomposition};
}

// ---------------------------------------------------------------------------
// OBJ
// ---------------------------------------------------------------------------

/**
 * Wavefront OBJ. Reads `v` (x y z; a fourth value or colours are ignored) and
 * `f` with the index forms `v`, `v/vt`, `v//vn` and `v/vt/vn`, 1-based or
 * negative (relative to the vertices read so far). Polygons are triangulated
 * as fans from their first corner, which is right for convex polygons only.
 * Each `o` or `g` name starts a mesh (faces under the same name are merged);
 * every mesh gets only the vertices it uses. Normals, texture coordinates,
 * materials, smoothing groups, lines, points, curves and surfaces are ignored.
 * Returns one mesh per object with faces.
 */
export function parseOBJ(text: string): TriangleMesh[] {
  if (typeof text !== 'string') bad('parseOBJ needs the file text as a string.');
  const positions: number[] = [];
  interface Group { name: string | undefined; faces: number[] }
  const groups = new Map<string, Group>();
  let current: Group | null = null, triangles = 0, start = 0, line = 0, pending = '';
  const corner = /^(-?\d+)(?:\/(-?\d*)(?:\/(-?\d*))?)?$/;
  while (start <= text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    let raw = text.slice(start, end);
    start = end + 1; line++;
    if (raw.endsWith('\r')) raw = raw.slice(0, -1);
    if (raw.endsWith('\\')) { pending += raw.slice(0, -1) + ' '; continue; }
    raw = pending + raw; pending = '';
    const hash = raw.indexOf('#');
    const tokens = (hash >= 0 ? raw.slice(0, hash) : raw).trim().split(/\s+/);
    const keyword = tokens[0];
    if (keyword === 'v') {
      if (tokens.length < 4) bad(`OBJ line ${line}: a vertex needs x, y and z.`);
      for (let k = 1; k <= 3; k++) {
        const value = Number(tokens[k]);
        if (!Number.isFinite(value)) bad(`OBJ line ${line}: vertex coordinate '${tokens[k]}' is not a finite number.`);
        positions.push(value);
      }
      if (positions.length / 3 > GEOMETRY_LIMITS.maxVertices) bad(`OBJ has more than ${GEOMETRY_LIMITS.maxVertices} vertices.`);
    } else if (keyword === 'f') {
      const count = tokens.length - 1, have = positions.length / 3;
      if (count < 3) bad(`OBJ line ${line}: a face needs at least three corners.`);
      if (!current) { current = {name: undefined, faces: []}; groups.set('', current); }
      triangles += count - 2;
      if (triangles > GEOMETRY_LIMITS.maxTriangles) bad(`OBJ has more than ${GEOMETRY_LIMITS.maxTriangles} triangles.`);
      let first = 0, previous = 0;
      for (let k = 1; k <= count; k++) {
        const match = corner.exec(tokens[k]);
        if (!match) bad(`OBJ line ${line}: face corner '${tokens[k]}' is not v, v/vt, v//vn or v/vt/vn.`);
        const given = Number(match![1]);
        // Positive indices may name vertices that come later in the file; they are checked at the end.
        const index = given < 0 ? have + given : given - 1;
        if (given === 0 || index < 0 || !Number.isSafeInteger(index)) bad(`OBJ line ${line}: face index ${given} is out of range (${have} vertices so far).`);
        if (k === 1) first = index;
        else if (k > 2) current.faces.push(first, previous, index);
        previous = index;
      }
    } else if (keyword === 'o' || keyword === 'g') {
      const name = tokens.slice(1).join(' ');
      current = groups.get(`=${name}`) ?? null;
      if (!current) { current = {name: name || undefined, faces: []}; groups.set(`=${name}`, current); }
    }
  }
  const have = positions.length / 3, meshes: TriangleMesh[] = [];
  for (const group of groups.values()) {
    if (group.faces.length === 0) continue;
    const local = new Map<number, number>(), vertices: number[] = [], indices = new Uint32Array(group.faces.length);
    for (let k = 0; k < group.faces.length; k++) {
      const index = group.faces[k];
      if (index >= have) bad(`OBJ: face index ${index + 1} is out of range (the file has ${have} vertices).`);
      let mapped = local.get(index);
      if (mapped === undefined) {
        mapped = local.size; local.set(index, mapped);
        vertices.push(positions[index * 3], positions[index * 3 + 1], positions[index * 3 + 2]);
      }
      indices[k] = mapped;
    }
    meshes.push(named({vertices: Float32Array.from(vertices), indices}, group.name));
  }
  if (meshes.length === 0) bad('OBJ has no faces.');
  return meshes;
}

// ---------------------------------------------------------------------------
// STL
// ---------------------------------------------------------------------------

/**
 * STL, binary or ASCII. Bytes are read as binary exactly when the length is
 * 84 + 50 x the triangle count stored at byte 80, whatever the header says (a
 * binary header may begin with "solid"); otherwise they must be ASCII text
 * starting with `solid`. A string is always ASCII. Corners at identical
 * positions are welded to one vertex, and winding follows the corner order
 * (stored normals are ignored). ASCII files must end each solid with
 * `endsolid`; several solids in one file are merged. Triangles with two
 * identical corners are dropped.
 */
export function parseSTL(data: BinaryLike | string): TriangleMesh {
  if (typeof data === 'string') return parseAsciiSTL(data);
  const bytes = bytesOf(data, 'parseSTL data');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const declared = bytes.length >= 84 ? view.getUint32(80, true) : -1;
  if (declared >= 0 && 84 + 50 * declared === bytes.length) {
    if (declared === 0) bad('STL has no triangles.');
    if (declared > GEOMETRY_LIMITS.maxTriangles) bad(`STL has ${declared} triangles; the limit is ${GEOMETRY_LIMITS.maxTriangles}.`);
    const soup = new Float32Array(declared * 9);
    for (let t = 0; t < declared; t++) for (let k = 0; k < 9; k++) {
      const value = view.getFloat32(84 + t * 50 + 12 + k * 4, true);
      if (!Number.isFinite(value)) bad(`STL triangle ${t} has a coordinate that is not finite.`);
      soup[t * 9 + k] = value;
    }
    return weldSoup(soup, undefined);
  }
  let head = '';
  for (let i = 0; i < Math.min(bytes.length, 256); i++) head += String.fromCharCode(bytes[i]);
  if (/^\s*solid(\s|$)/.test(head)) {
    // Text that is cut off, or a binary file with a "solid" header and the wrong length, fails in the ASCII reader with the reason.
    let text: string;
    try { text = new TextDecoder('utf-8').decode(bytes); } catch { return bad('STL text could not be decoded.'); }
    if (/\bfacet\b/.test(text) || declared < 0) return parseAsciiSTL(text);
  }
  if (bytes.length < 84) bad(`STL is truncated: ${bytes.length} bytes is shorter than the 84-byte binary header and it is not ASCII.`);
  return bad(`STL is truncated or corrupt: its header declares ${declared} triangles (${84 + 50 * declared} bytes) but the data is ${bytes.length} bytes.`);
}

function weldSoup(soup: Float32Array, name: string | undefined): TriangleMesh {
  const indices = new Uint32Array(soup.length / 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  const mesh = weldVertices({vertices: soup, indices});
  if (mesh.indices.length === 0) bad('STL has no triangles with three distinct corners.');
  return named(mesh, name);
}

function parseAsciiSTL(text: string): TriangleMesh {
  const soup: number[] = [];
  let name: string | undefined, open = false, facet = false, corners = 0, solids = 0, start = 0, line = 0;
  while (start < text.length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = text.length;
    const raw = text.slice(start, end).trim();
    start = end + 1; line++;
    if (!raw) continue;
    const tokens = raw.split(/\s+/), keyword = tokens[0].toLowerCase();
    if (keyword === 'vertex') {
      if (!facet) bad(`STL line ${line}: vertex outside a facet.`);
      if (tokens.length !== 4) bad(`STL line ${line}: a vertex needs x, y and z.`);
      if (++corners > 3) bad(`STL line ${line}: a facet has more than three vertices.`);
      for (let k = 1; k <= 3; k++) {
        const value = Number(tokens[k]);
        if (!Number.isFinite(value)) bad(`STL line ${line}: vertex coordinate '${tokens[k]}' is not a finite number.`);
        soup.push(value);
      }
      if (soup.length / 9 > GEOMETRY_LIMITS.maxTriangles) bad(`STL has more than ${GEOMETRY_LIMITS.maxTriangles} triangles.`);
    } else if (keyword === 'facet') {
      if (!open || facet) bad(`STL line ${line}: unexpected facet.`);
      facet = true; corners = 0;
    } else if (keyword === 'endfacet') {
      if (!facet || corners !== 3) bad(`STL line ${line}: a facet needs exactly three vertices.`);
      facet = false;
    } else if (keyword === 'outer' || keyword === 'endloop') {
      if (!facet) bad(`STL line ${line}: '${raw}' outside a facet.`);
    } else if (keyword === 'solid') {
      if (open) bad(`STL line ${line}: solid inside a solid.`);
      open = true; solids++;
      if (solids === 1 && tokens.length > 1) name = raw.slice(5).trim();
    } else if (keyword === 'endsolid') {
      if (!open || facet) bad(`STL line ${line}: unexpected endsolid.`);
      open = false;
    } else bad(`STL line ${line}: unexpected '${raw.slice(0, 40)}'.`);
  }
  if (solids === 0) bad('STL text does not start with solid.');
  if (facet || open) bad('STL text is truncated: it ends inside a solid (no endsolid).');
  if (soup.length === 0) bad('STL has no triangles.');
  return weldSoup(Float32Array.from(soup), name);
}

// ---------------------------------------------------------------------------
// glTF 2.0
// ---------------------------------------------------------------------------

type Mat4 = number[];
const IDENTITY: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
  }
  return out;
}

// Column-major T * R * S.
function trs(t: readonly number[], q: readonly number[], s: readonly number[]): Mat4 {
  const [x, y, z, w] = q;
  return [
    (1 - 2 * (y * y + z * z)) * s[0], 2 * (x * y + z * w) * s[0], 2 * (x * z - y * w) * s[0], 0,
    2 * (x * y - z * w) * s[1], (1 - 2 * (x * x + z * z)) * s[1], 2 * (y * z + x * w) * s[1], 0,
    2 * (x * z + y * w) * s[2], 2 * (y * z - x * w) * s[2], (1 - 2 * (x * x + y * y)) * s[2], 0,
    t[0], t[1], t[2], 1,
  ];
}

function applyMatrix(m: Mat4, from: ArrayLike<number>, to: Float32Array, offset: number, count: number): void {
  for (let i = 0; i < count; i++) {
    const x = from[i * 3], y = from[i * 3 + 1], z = from[i * 3 + 2];
    to[offset + i * 3] = m[0] * x + m[4] * y + m[8] * z + m[12];
    to[offset + i * 3 + 1] = m[1] * x + m[5] * y + m[9] * z + m[13];
    to[offset + i * 3 + 2] = m[2] * x + m[6] * y + m[10] * z + m[14];
  }
}

const determinant3 = (m: Mat4) => m[0] * (m[5] * m[10] - m[9] * m[6]) - m[4] * (m[1] * m[10] - m[9] * m[2]) + m[8] * (m[1] * m[6] - m[5] * m[2]);

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);
function list(value: unknown, label: string): unknown[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) bad(`glTF: ${label} must be an array.`);
  return value as unknown[];
}
function item(values: unknown[], index: unknown, label: string): Json {
  if (!Number.isInteger(index) || (index as number) < 0 || (index as number) >= values.length) bad(`glTF: ${label} ${String(index)} does not exist.`);
  const value = values[index as number];
  if (!isObject(value)) bad(`glTF: ${label} ${String(index)} is not an object.`);
  return value as Json;
}
function natural(value: unknown, fallback: number | null, label: string): number {
  if (value === undefined && fallback !== null) return fallback;
  if (!Number.isInteger(value) || (value as number) < 0) bad(`glTF: ${label} must be a non-negative integer.`);
  return value as number;
}
function numbers(value: unknown, length: number, label: string): number[] {
  if (!Array.isArray(value) || value.length !== length || !value.every(n => typeof n === 'number' && Number.isFinite(n))) bad(`glTF: ${label} must be ${length} finite numbers.`);
  return value as number[];
}

function decodeBase64(text: string, label: string): Uint8Array {
  const clean = text.replace(/[\s=]+/g, '');
  if (/[^A-Za-z0-9+/_-]/.test(clean) || clean.length % 4 === 1) bad(`glTF: ${label} is not valid base64.`);
  const out = new Uint8Array(Math.floor(clean.length * 3 / 4));
  let acc = 0, bits = 0, n = 0;
  for (let i = 0; i < clean.length; i++) {
    const c = clean.charCodeAt(i);
    const value = c >= 65 && c <= 90 ? c - 65 : c >= 97 && c <= 122 ? c - 71 : c >= 48 && c <= 57 ? c + 4 : c === 43 || c === 45 ? 62 : 63;
    acc = (acc << 6 | value) & 0xffffff; bits += 6;
    if (bits >= 8) { bits -= 8; out[n++] = acc >> bits & 0xff; }
  }
  return out;
}

const COMPONENT_BYTES: Record<number, number> = {5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4};
const TYPE_COMPONENTS: Record<string, number> = {SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16};
// Required extensions that do not change how positions and indices are stored.
const HARMLESS_EXTENSION = /^(KHR_materials_|KHR_texture_|KHR_lights_|KHR_xmp|EXT_texture_|MSFT_texture_)/;

interface AccessorView { view: DataView; offset: number; stride: number; count: number; componentType: number; type: string }

function readGLTF(source: string | object, buffers: GLTFBuffers | undefined, bin: Uint8Array | null): TriangleMesh[] {
  let json: unknown = source;
  if (typeof source === 'string') {
    try { json = JSON.parse(source); } catch (error) { bad(`glTF: the JSON does not parse (${(error as Error).message}).`); }
  }
  if (!isObject(json)) bad('glTF: the file must be a JSON object.');
  const root = json as Json;
  const version = isObject(root.asset) ? root.asset.version : undefined;
  if (typeof version !== 'string' || !/^2\./.test(version)) bad(`glTF: only version 2.0 is supported (asset.version is ${JSON.stringify(version)}).`);
  for (const extension of list(root.extensionsRequired, 'extensionsRequired')) {
    if (typeof extension !== 'string' || !HARMLESS_EXTENSION.test(extension)) bad(`glTF: the file requires the extension ${String(extension)}, which this reader does not support.`);
  }
  const jsonBuffers = list(root.buffers, 'buffers'), views = list(root.bufferViews, 'bufferViews'), accessors = list(root.accessors, 'accessors');
  const meshes = list(root.meshes, 'meshes'), nodes = list(root.nodes, 'nodes'), scenes = list(root.scenes, 'scenes');

  const loaded = new Map<number, Uint8Array>();
  const buffer = (index: unknown): Uint8Array => {
    const def = item(jsonBuffers, index, 'buffer'), key = index as number;
    const cached = loaded.get(key);
    if (cached) return cached;
    let bytes: Uint8Array;
    if (def.uri === undefined) {
      if (key !== 0 || !bin) bad(`glTF: buffer ${key} has no uri and there is no GLB binary chunk for it.`);
      bytes = bin!;
    } else if (typeof def.uri !== 'string') {
      bytes = bad(`glTF: buffer ${key} has a uri that is not a string.`);
    } else if (/^data:/i.test(def.uri)) {
      const comma = def.uri.indexOf(',');
      if (comma < 0 || !/;base64$/i.test(def.uri.slice(0, comma))) bad(`glTF: buffer ${key} has a data: URI that is not base64.`);
      bytes = decodeBase64(def.uri.slice(comma + 1), `buffer ${key}`);
    } else {
      let found: BinaryLike | undefined;
      const names = [def.uri];
      try { names.push(decodeURIComponent(def.uri)); } catch { /* keep the raw name */ }
      for (const name of names) {
        found ??= buffers instanceof Map ? buffers.get(name) : buffers && Object.prototype.hasOwnProperty.call(buffers, name) ? (buffers as Record<string, BinaryLike>)[name] : undefined;
      }
      if (!found) bad(`glTF: buffer ${key} is the external file '${def.uri}', which was not supplied. Pass it as buffers['${def.uri}']; this module does not fetch.`);
      bytes = bytesOf(found, `buffers['${def.uri}']`);
    }
    const byteLength = natural(def.byteLength, null, `buffer ${key} byteLength`);
    if (byteLength > bytes.length) bad(`glTF: buffer ${key} declares ${byteLength} bytes but only ${bytes.length} were supplied.`);
    loaded.set(key, bytes);
    return bytes;
  };

  const accessor = (index: unknown, label: string): AccessorView => {
    const def = item(accessors, index, 'accessor');
    if (def.sparse !== undefined) bad(`glTF: ${label} uses a sparse accessor, which is not supported. Re-export without sparse accessors.`);
    if (def.bufferView === undefined) bad(`glTF: ${label} has an accessor without a bufferView.`);
    const viewDef = item(views, def.bufferView, 'bufferView'), bytes = buffer(viewDef.buffer);
    const viewOffset = natural(viewDef.byteOffset, 0, 'bufferView byteOffset'), viewLength = natural(viewDef.byteLength, null, 'bufferView byteLength');
    if (viewOffset + viewLength > bytes.length) bad(`glTF: bufferView ${String(def.bufferView)} runs past the end of its buffer.`);
    const componentType = def.componentType as number, type = def.type as string;
    const size = COMPONENT_BYTES[componentType], components = TYPE_COMPONENTS[type];
    if (!size || !components) bad(`glTF: ${label} has an unknown accessor componentType or type.`);
    const element = size * components, stride = natural(viewDef.byteStride, element, 'bufferView byteStride');
    if (stride < element) bad(`glTF: ${label} has a byteStride of ${stride}, smaller than its ${element}-byte elements.`);
    const count = natural(def.count, null, 'accessor count'), offset = natural(def.byteOffset, 0, 'accessor byteOffset');
    if (count > 0 && offset + (count - 1) * stride + element > viewLength) bad(`glTF: ${label} reads ${count} elements, which runs past the end of its bufferView.`);
    return {view: new DataView(bytes.buffer, bytes.byteOffset + viewOffset + offset, count > 0 ? (count - 1) * stride + element : 0), offset: 0, stride, count, componentType, type};
  };

  // The default scene's nodes; without scenes, every node that is nobody's child.
  let roots: unknown[];
  if (scenes.length > 0) roots = list(item(scenes, root.scene ?? 0, 'scene').nodes, 'scene.nodes');
  else {
    const child = new Set<unknown>();
    for (let n = 0; n < nodes.length; n++) for (const c of list(item(nodes, n, 'node').children, 'node.children')) child.add(c);
    roots = nodes.map((_, n) => n).filter(n => !child.has(n));
  }

  const out: TriangleMesh[] = [], visited = new Uint8Array(nodes.length);
  let totalVertices = 0, totalTriangles = 0;
  const stack: {node: unknown; parent: Mat4}[] = roots.map(node => ({node, parent: IDENTITY})).reverse();
  while (stack.length > 0) {
    const {node: index, parent} = stack.pop()!;
    const node = item(nodes, index, 'node');
    if (visited[index as number]) bad(`glTF: node ${String(index)} is reached twice; the node hierarchy must be a tree.`);
    visited[index as number] = 1;
    let local: Mat4;
    if (node.matrix !== undefined) local = numbers(node.matrix, 16, `node ${String(index)} matrix`);
    else {
      const t = node.translation === undefined ? [0, 0, 0] : numbers(node.translation, 3, `node ${String(index)} translation`);
      let q = node.rotation === undefined ? [0, 0, 0, 1] : numbers(node.rotation, 4, `node ${String(index)} rotation`);
      const s = node.scale === undefined ? [1, 1, 1] : numbers(node.scale, 3, `node ${String(index)} scale`);
      const length = Math.hypot(q[0], q[1], q[2], q[3]);
      if (!(length > 0)) bad(`glTF: node ${String(index)} has a zero rotation quaternion.`);
      q = q.map(c => c / length);
      local = trs(t, q, s);
    }
    const world = multiply(parent, local);
    const children = list(node.children, 'node.children');
    for (let c = children.length - 1; c >= 0; c--) stack.push({node: children[c], parent: world});
    if (node.mesh === undefined) continue;

    const meshDef = item(meshes, node.mesh, 'mesh');
    const parts: {positions: AccessorView; indices: AccessorView | null; mode: number; triangles: number}[] = [];
    let vertexCount = 0, triangleCount = 0;
    const primitives = list(meshDef.primitives, 'mesh.primitives');
    for (let p = 0; p < primitives.length; p++) {
      const primitive = primitives[p], label = `mesh ${String(node.mesh)} primitive ${p}`;
      if (!isObject(primitive)) bad(`glTF: ${label} is not an object.`);
      const prim = primitive as Json, mode = prim.mode === undefined ? 4 : prim.mode as number;
      if (!Number.isInteger(mode) || mode < 0 || mode > 6) bad(`glTF: ${label} has the unknown mode ${String(prim.mode)}.`);
      if (mode < 4) continue;   // points and lines carry no surface
      const attributes = isObject(prim.attributes) ? prim.attributes : {};
      if (attributes.POSITION === undefined) continue;
      const positions = accessor(attributes.POSITION, `${label} POSITION`);
      if (positions.type !== 'VEC3' || positions.componentType !== 5126) bad(`glTF: ${label} POSITION must be VEC3 of FLOAT (quantised positions are not supported).`);
      let indices: AccessorView | null = null;
      if (prim.indices !== undefined) {
        indices = accessor(prim.indices, `${label} indices`);
        if (indices.type !== 'SCALAR' || ![5121, 5123, 5125].includes(indices.componentType)) bad(`glTF: ${label} indices must be SCALAR of UNSIGNED_BYTE, UNSIGNED_SHORT or UNSIGNED_INT.`);
      }
      const corners = indices ? indices.count : positions.count;
      if (mode === 4 && corners % 3 !== 0) bad(`glTF: ${label} is a triangle list with ${corners} corners, not a multiple of three.`);
      const triangles = mode === 4 ? corners / 3 : Math.max(0, corners - 2);
      if (triangles === 0) continue;
      vertexCount += positions.count; triangleCount += triangles;
      totalVertices += positions.count; totalTriangles += triangles;
      if (totalVertices > GEOMETRY_LIMITS.maxVertices) bad(`glTF: the scene has more than ${GEOMETRY_LIMITS.maxVertices} vertices.`);
      if (totalTriangles > GEOMETRY_LIMITS.maxTriangles) bad(`glTF: the scene has more than ${GEOMETRY_LIMITS.maxTriangles} triangles.`);
      parts.push({positions, indices, mode, triangles});
    }
    if (triangleCount === 0) continue;
    const vertices = new Float32Array(vertexCount * 3), indices = new Uint32Array(triangleCount * 3), scratch = new Float32Array(3);
    let vertexBase = 0, n = 0;
    for (const part of parts) {
      const {positions} = part;
      for (let i = 0; i < positions.count; i++) {
        for (let k = 0; k < 3; k++) {
          scratch[k] = positions.view.getFloat32(i * positions.stride + k * 4, true);
          if (!Number.isFinite(scratch[k])) bad(`glTF: mesh ${String(node.mesh)} has a position that is not finite (vertex ${i}).`);
        }
        applyMatrix(world, scratch, vertices, (vertexBase + i) * 3, 1);
      }
      const source = part.indices;
      const corner = (i: number): number => {
        if (!source) return i;
        const at = i * source.stride;
        const value = source.componentType === 5121 ? source.view.getUint8(at) : source.componentType === 5123 ? source.view.getUint16(at, true) : source.view.getUint32(at, true);
        if (value >= positions.count) bad(`glTF: mesh ${String(node.mesh)} has index ${value}, out of range for ${positions.count} vertices.`);
        return value;
      };
      const first = n;
      for (let t = 0; t < part.triangles; t++) {
        let a: number, b: number, c: number;
        if (part.mode === 4) { a = corner(t * 3); b = corner(t * 3 + 1); c = corner(t * 3 + 2); }
        else if (part.mode === 5) { a = corner(t); b = corner(t + 1 + t % 2); c = corner(t + 2 - t % 2); }
        else { a = corner(t + 1); b = corner(t + 2); c = corner(0); }
        // Strips and fans use repeated corners as stitches: those triangles have no area.
        if (part.mode !== 4 && (a === b || b === c || a === c)) continue;
        indices[n++] = vertexBase + a; indices[n++] = vertexBase + b; indices[n++] = vertexBase + c;
      }
      if (determinant3(world) < 0) swapWinding(indices, first, n);
      vertexBase += positions.count;
    }
    for (let k = 0; k < vertices.length; k++) if (!Number.isFinite(vertices[k])) bad(`glTF: node ${String(index)} has a transform that makes positions non-finite.`);
    const name = typeof node.name === 'string' ? node.name : typeof meshDef.name === 'string' ? meshDef.name : undefined;
    out.push(named({vertices, indices: n === indices.length ? indices : indices.slice(0, n)}, name));
  }
  if (out.length === 0) bad('glTF: the scene has no triangle meshes.');
  return out;
}

/**
 * glTF 2.0 from its JSON (text or parsed) and its buffers. Returns one mesh
 * per node of the default scene that carries a mesh, in world space: each
 * node's transform (matrix, or translation, rotation and scale) and those of
 * its ancestors are applied to the positions, and a mirroring transform also
 * reverses the winding. Primitives of one mesh are merged.
 *
 * Supported: TRIANGLES, TRIANGLE_STRIP and TRIANGLE_FAN primitives (points and
 * lines are skipped); POSITION as VEC3 FLOAT; indices as UNSIGNED_BYTE, SHORT
 * or INT, or none; byteStride; `data:` base64 buffers; external buffers found
 * in `buffers` by their uri (nothing is fetched).
 *
 * Rejected with a clear error: sparse accessors, quantised or compressed
 * geometry (KHR_mesh_quantization, KHR_draco_mesh_compression,
 * EXT_meshopt_compression when required), versions other than 2.x, a node
 * graph that is not a tree, and any accessor that reads outside its buffer.
 * Ignored: normals, UVs, materials, skins, morph targets, animations, cameras
 * and instancing extensions.
 */
export function parseGLTF(json: string | object, buffers?: GLTFBuffers): TriangleMesh[] {
  return readGLTF(json, buffers, null);
}

/** Binary glTF (.glb): the JSON chunk and the embedded BIN chunk. See `parseGLTF` for what is read. */
export function parseGLB(data: BinaryLike, buffers?: GLTFBuffers): TriangleMesh[] {
  const bytes = bytesOf(data, 'parseGLB data');
  if (bytes.length < 20) bad(`GLB is truncated: ${bytes.length} bytes is shorter than a header and one chunk.`);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) bad('GLB: the file does not start with the magic bytes "glTF".');
  const version = view.getUint32(4, true), length = view.getUint32(8, true);
  if (version !== 2) bad(`GLB: container version ${version} is not supported (only 2).`);
  if (length !== bytes.length) bad(`GLB: the header declares ${length} bytes but the data is ${bytes.length} bytes (truncated or padded).`);
  let json: string | null = null, bin: Uint8Array | null = null;
  for (let at = 12; at < length;) {
    if (at + 8 > length) bad('GLB: a chunk header runs past the end of the file.');
    const chunkLength = view.getUint32(at, true), chunkType = view.getUint32(at + 4, true);
    if (at + 8 + chunkLength > length) bad(`GLB: a chunk of ${chunkLength} bytes runs past the end of the file.`);
    const chunk = bytes.subarray(at + 8, at + 8 + chunkLength);
    if (at === 12) {
      if (chunkType !== 0x4e4f534a) bad('GLB: the first chunk must be JSON.');
      try { json = new TextDecoder('utf-8', {fatal: true}).decode(chunk); } catch { bad('GLB: the JSON chunk is not valid UTF-8.'); }
    } else if (chunkType === 0x004e4942 && !bin) bin = chunk;
    at += 8 + chunkLength + (4 - chunkLength % 4) % 4;
  }
  if (json === null) bad('GLB: there is no JSON chunk.');
  return readGLTF(json!, buffers, bin);
}
