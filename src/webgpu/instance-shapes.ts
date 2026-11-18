/**
 * Sphere and capsule instances for the Lab renderer, and the plan that says how
 * every rigid row is drawn (boxes, spheres, capsules, or a body's own geometry).
 *
 * A rigid instance row is a column-major 4x4 matrix scaled by the body's half
 * extents. A sphere row is scaled (r, r, r). A capsule row is scaled
 * (radius, halfLength, radius) with its axis along local Y, so the row draws an
 * open unit cylinder exactly; the two round ends are hemispheres of radius r
 * centred at +-halfLength along the row's Y column. This is the decomposition
 * `syncShapeMeshes` in packages/box3d-kit/src/three.ts uses.
 *
 * Everything here is plain arithmetic with no GPU dependency, so it runs in node.
 */

export const SHAPE_KIND_BOX = 0;
export const SHAPE_KIND_SPHERE = 1;
export const SHAPE_KIND_CAPSULE = 2;
/** Rows drawn with the body's own geometry when the source supplies it (src/webgpu/body-geometry.ts). */
export const SHAPE_KIND_HULL = 3;
export const SHAPE_KIND_MESH = 4;
export const SHAPE_KIND_HEIGHTFIELD = 5;
/** Several shapes on one body; its geometry holds every child at its local pose. */
export const SHAPE_KIND_COMPOUND = 6;
const ownGeometryKind = (kind: number | undefined): boolean => kind === SHAPE_KIND_HULL || kind === SHAPE_KIND_MESH || kind === SHAPE_KIND_HEIGHTFIELD || kind === SHAPE_KIND_COMPOUND;

/** Segments around the axis. The cylinder and the sphere use the same table, so their rims share vertices. */
export const ROUND_SEGMENTS = 32;
/** Latitude bands of the full sphere. Even, so the first half of the vertex list is the upper hemisphere. */
export const ROUND_RINGS = 16;
/** Floats per mesh vertex: position.xyz, normal.xyz. The cube mesh uses the same layout. */
export const ROUND_VERTEX_FLOATS = 6;

export interface InstanceShapePlan {
  /** Rigid rows the plan covers. Rows past it (ropes, soft bodies, effects) are boxes. */
  readonly count: number;
  /** Runs of consecutive rows as [start, length, start, length, ...]. */
  readonly boxRuns: Uint32Array;
  readonly sphereRuns: Uint32Array;
  readonly capsuleRuns: Uint32Array;
  /** Capsule rows in ascending order; cap instances 2k and 2k + 1 belong to capsuleRows[k]. */
  readonly capsuleRows: Uint32Array;
  readonly sphereCount: number;
  readonly capsuleCount: number;
  /**
   * Hull, mesh, height-field and compound rows that have their own geometry, in ascending
   * order. They are in no run: each is one draw of that body's vertex range with
   * the row as its instance.
   */
  readonly geometryRows: Uint32Array;
}

/**
 * Split the first `count` rows into runs per shape. Returns null when every row
 * is drawn as a box, which is the signal to keep the original single cube draw.
 *
 * A hull, mesh, height-field or compound row is drawn with its own geometry when
 * `hasGeometry(row)` says the source has it; without `hasGeometry`, or when it
 * returns false, the row is drawn as a box, as is any unknown kind.
 */
export function planInstanceShapes(
  kinds: ArrayLike<number> | null | undefined, count: number, hasGeometry?: (row: number) => boolean,
): InstanceShapePlan | null {
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Shape plan count must be a non-negative integer.');
  if (!kinds || count === 0) return null;
  const known = Math.min(count, kinds.length);
  let shaped = false;
  const geometryRows: number[] = [];
  for (let i = 0; i < known; i++) {
    const kind = kinds[i];
    if (kind === SHAPE_KIND_SPHERE || kind === SHAPE_KIND_CAPSULE) shaped = true;
    else if (hasGeometry && ownGeometryKind(kind) && hasGeometry(i)) geometryRows.push(i);
  }
  if (!shaped && geometryRows.length === 0) return null;
  const GEOMETRY = 3;
  const runs: number[][] = [[], [], [], []];
  const capsuleRows: number[] = [];
  let nextGeometry = 0;
  let sphereCount = 0;
  let runKind = -1;
  let runStart = 0;
  for (let i = 0; i <= count; i++) {
    let kind = -1;
    if (i < count) {
      const raw = i < known ? kinds[i] : SHAPE_KIND_BOX;
      kind = raw === SHAPE_KIND_SPHERE || raw === SHAPE_KIND_CAPSULE ? raw : SHAPE_KIND_BOX;
      if (geometryRows[nextGeometry] === i) { kind = GEOMETRY; nextGeometry++; }
      if (kind === SHAPE_KIND_SPHERE) sphereCount++;
      else if (kind === SHAPE_KIND_CAPSULE) capsuleRows.push(i);
    }
    if (kind !== runKind) {
      if (runKind >= 0) runs[runKind]!.push(runStart, i - runStart);
      runKind = kind;
      runStart = i;
    }
  }
  return {
    count,
    boxRuns: Uint32Array.from(runs[SHAPE_KIND_BOX]!),
    sphereRuns: Uint32Array.from(runs[SHAPE_KIND_SPHERE]!),
    capsuleRuns: Uint32Array.from(runs[SHAPE_KIND_CAPSULE]!),
    capsuleRows: Uint32Array.from(capsuleRows),
    sphereCount,
    capsuleCount: capsuleRows.length,
    geometryRows: Uint32Array.from(geometryRows),
  };
}

/** Call `draw(start, length)` for each run, clipped to rows below `limit`. */
export function forEachRun(runs: Uint32Array, limit: number, draw: (start: number, length: number) => void): void {
  for (let i = 0; i < runs.length; i += 2) {
    const start = runs[i]!;
    if (start >= limit) return;
    draw(start, Math.min(runs[i + 1]!, limit - start));
  }
}

/** Geometry rows below `instanceCount`. */
export function geometryRowsBelow(plan: InstanceShapePlan, instanceCount: number): number {
  const rows = plan.geometryRows;
  if (instanceCount >= plan.count) return rows.length;
  let n = 0;
  while (n < rows.length && rows[n]! < instanceCount) n++;
  return n;
}

/**
 * Box runs for a frame of `instanceCount` instances. Rows from plan.count up to
 * instanceCount are boxes; they join the last rigid box run when it touches them,
 * so a scene whose round bodies come first still draws its boxes in one call.
 */
export function forEachBoxRun(plan: InstanceShapePlan, instanceCount: number, draw: (start: number, length: number) => void): void {
  const runs = plan.boxRuns;
  const rigid = Math.min(plan.count, instanceCount);
  let tailStart = rigid;
  let last = runs.length;
  if (instanceCount > plan.count && runs.length >= 2 && runs[runs.length - 2]! + runs[runs.length - 1]! === plan.count) {
    tailStart = runs[runs.length - 2]!;
    last = runs.length - 2;
  }
  for (let i = 0; i < last; i += 2) {
    const start = runs[i]!;
    if (start >= rigid) return;
    draw(start, Math.min(runs[i + 1]!, rigid - start));
  }
  if (instanceCount > tailStart) draw(tailStart, instanceCount - tailStart);
}

/** Capsules whose row is below `instanceCount`. */
export function capsulesBelow(plan: InstanceShapePlan, instanceCount: number): number {
  const rows = plan.capsuleRows;
  if (instanceCount >= plan.count) return rows.length;
  let n = 0;
  while (n < rows.length && rows[n]! < instanceCount) n++;
  return n;
}

/**
 * Write the two cap instances of every capsule row.
 *
 * `matrices` and `colors` are the row streams (16 and 4 floats per row) starting
 * at the given float offsets. Cap 2k is the +Y end and cap 2k + 1 the -Y end of
 * capsuleRows[k]. Both are drawn with the upper hemisphere mesh:
 *
 *   +Y cap  columns (X, Yhat * r, Z),   origin + Y
 *   -Y cap  columns (X, -Yhat * r, -Z), origin - Y   (the hemisphere turned half a revolution about X)
 *
 * where X, Y, Z are the row's columns, r = |X| and Yhat = Y / |Y|. Turning rather
 * than mirroring keeps the triangle winding, so back-face culling still works.
 */
export function writeCapsuleCaps(
  matrices: ArrayLike<number>, matrixStart: number,
  colors: ArrayLike<number>, colorStart: number,
  capsuleRows: ArrayLike<number>,
  outMatrices: Float32Array, outColors: Float32Array,
): number {
  const capsules = capsuleRows.length;
  if (outMatrices.length < capsules * 32 || outColors.length < capsules * 8) throw new RangeError('Capsule cap output is too small.');
  for (let k = 0; k < capsules; k++) {
    const m = matrixStart + capsuleRows[k]! * 16;
    const c = colorStart + capsuleRows[k]! * 4;
    const yx = matrices[m + 4]!, yy = matrices[m + 5]!, yz = matrices[m + 6]!;
    const radius = Math.hypot(matrices[m]!, matrices[m + 1]!, matrices[m + 2]!);
    const half = Math.hypot(yx, yy, yz);
    const scale = half > 0 ? radius / half : 0;
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      const o = (k * 2 + side) * 16;
      for (let i = 0; i < 4; i++) {
        outMatrices[o + i] = matrices[m + i]!;
        outMatrices[o + 4 + i] = matrices[m + 4 + i]! * scale * sign;
        outMatrices[o + 8 + i] = matrices[m + 8 + i]! * sign;
        outMatrices[o + 12 + i] = matrices[m + 12 + i]!;
      }
      // The scaled columns keep the row's w components (0, 0, 0, 1).
      outMatrices[o + 7] = matrices[m + 7]!;
      outMatrices[o + 11] = matrices[m + 11]!;
      outMatrices[o + 12] = matrices[m + 12]! + sign * yx;
      outMatrices[o + 13] = matrices[m + 13]! + sign * yy;
      outMatrices[o + 14] = matrices[m + 14]! + sign * yz;
      const oc = (k * 2 + side) * 4;
      for (let i = 0; i < 4; i++) outColors[oc + i] = colors[c + i]!;
    }
  }
  return capsules * 2;
}

function ringTable(segments: number): { cos: Float64Array; sin: Float64Array } {
  const cos = new Float64Array(segments), sin = new Float64Array(segments);
  for (let j = 0; j < segments; j++) {
    const theta = (2 * Math.PI * j) / segments;
    cos[j] = Math.cos(theta);
    sin[j] = Math.sin(theta);
  }
  return { cos, sin };
}

function checkTessellation(segments: number, rings = 2): void {
  if (!Number.isSafeInteger(segments) || segments < 3 || !Number.isSafeInteger(rings) || rings < 2 || rings % 2 !== 0) {
    throw new RangeError('Round meshes need at least 3 segments and an even number of rings.');
  }
}

/** Vertices of the upper hemisphere; the sphere list starts with them. */
export function hemisphereVertexCount(segments = ROUND_SEGMENTS, rings = ROUND_RINGS): number {
  checkTessellation(segments, rings);
  return segments * 3 + (rings / 2 - 1) * segments * 6;
}
export function sphereVertexCount(segments = ROUND_SEGMENTS, rings = ROUND_RINGS): number {
  return hemisphereVertexCount(segments, rings) * 2;
}
export function cylinderVertexCount(segments = ROUND_SEGMENTS): number {
  checkTessellation(segments);
  return segments * 6;
}

/**
 * Unit sphere as a triangle list of (position, normal), counter-clockwise seen
 * from outside, ordered from the +Y pole down. The equator ring has y = 0 exactly.
 */
export function sphereVertexData(segments = ROUND_SEGMENTS, rings = ROUND_RINGS): Float32Array {
  const out = new Float32Array(sphereVertexCount(segments, rings) * ROUND_VERTEX_FLOATS);
  const { cos, sin } = ringTable(segments);
  const ringY = new Float64Array(rings + 1), ringR = new Float64Array(rings + 1);
  for (let i = 0; i <= rings; i++) {
    const phi = (Math.PI * i) / rings;
    ringY[i] = i === 0 ? 1 : i === rings ? -1 : i * 2 === rings ? 0 : Math.cos(phi);
    ringR[i] = i === 0 || i === rings ? 0 : i * 2 === rings ? 1 : Math.sin(phi);
  }
  let o = 0;
  const put = (i: number, j: number): void => {
    const s = j % segments;
    const x = ringR[i]! * cos[s]!, y = ringY[i]!, z = ringR[i]! * sin[s]!;
    out[o++] = x; out[o++] = y; out[o++] = z;
    out[o++] = x; out[o++] = y; out[o++] = z;
  };
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      // a = (i, j), b = (i + 1, j), c = (i + 1, j + 1), d = (i, j + 1).
      if (i > 0) { put(i, j); put(i, j + 1); put(i + 1, j + 1); }
      if (i < rings - 1) { put(i, j); put(i + 1, j + 1); put(i + 1, j); }
    }
  }
  return out;
}

/** Open unit cylinder: radius 1, y from -1 to 1, no end discs, outward normals. */
export function cylinderVertexData(segments = ROUND_SEGMENTS): Float32Array {
  const out = new Float32Array(cylinderVertexCount(segments) * ROUND_VERTEX_FLOATS);
  const { cos, sin } = ringTable(segments);
  let o = 0;
  const put = (y: number, j: number): void => {
    const s = j % segments;
    out[o++] = cos[s]!; out[o++] = y; out[o++] = sin[s]!;
    out[o++] = cos[s]!; out[o++] = 0; out[o++] = sin[s]!;
  };
  for (let j = 0; j < segments; j++) {
    put(1, j); put(1, j + 1); put(-1, j + 1);
    put(1, j); put(-1, j + 1); put(-1, j);
  }
  return out;
}
