/**
 * three.js adapter. It is written against the structural shape of three's
 * classes, so this package has no dependency on three: pass your own THREE
 * namespace in and any recent three release works.
 */

/** Anything that streams box instances: PhysicsWorld, or RemoteWorld from ./worker. */
export interface InstanceSource {
  bodyCount(): number;
  transformVersion(): number;
  colorVersion(): number;
  matrices(): Float32Array;
  colors(): Float32Array;
  /** Optional render interpolation (PhysicsWorld provides it). */
  interpolatedMatrices?(alpha: number): Float32Array;
  readonly capacity?: number;
  readonly native?: {readonly maxBodies: number};
  /** Shape of every row. When absent every row is a box. */
  bodyKinds?(): readonly string[];
}

interface BufferAttributeLike { array: ArrayLike<number> & {set(source: ArrayLike<number>, offset?: number): void}; needsUpdate: boolean }
export interface InstancedMeshLike {
  count: number;
  instanceMatrix: BufferAttributeLike;
  instanceColor: BufferAttributeLike | null;
}
interface ThreeLike {
  BoxGeometry: new (w: number, h: number, d: number) => unknown;
  MeshStandardMaterial: new (options?: object) => unknown;
  InstancedMesh: new (geometry: any, material: any, count: number) => InstancedMeshLike;
  InstancedBufferAttribute: new (array: Float32Array, itemSize: number) => BufferAttributeLike;
}

export interface SyncOptions {
  /**
   * Interpolation factor from update(): render between the last two physics
   * steps so motion stays smooth when the display runs faster than physics.
   * Omit to draw the latest step exactly.
   */
  readonly alpha?: number;
}

/**
 * Create an InstancedMesh sized to the world's body capacity. Box3D writes
 * matrices scaled by half extents, so the geometry is a 2x2x2 unit box.
 */
export function createBodyMesh<M extends InstancedMeshLike = InstancedMeshLike>(THREE: ThreeLike, source: InstanceSource, material?: unknown, capacity?: number): M {
  const size = capacity ?? source.capacity ?? source.native?.maxBodies ?? 4096;
  const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 2, 2), material ?? new THREE.MeshStandardMaterial({roughness: 0.6}), size);
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(size * 3), 3);
  (mesh as {frustumCulled?: boolean}).frustumCulled = false;
  syncInstancedMesh(source, mesh);
  return mesh as M;
}

const synced = new WeakMap<InstancedMeshLike, {transform: number; color: number; count: number; alpha: number | undefined}>();

/**
 * Copy transforms (and colors when they changed) into the mesh. Cheap to call
 * every frame: it skips the copy when nothing moved and alpha is unchanged.
 * Returns the number of instances drawn.
 */
export function syncInstancedMesh(source: InstanceSource, mesh: InstancedMeshLike, options: SyncOptions = {}): number {
  const capacity = mesh.instanceMatrix.array.length / 16;
  const count = Math.min(source.bodyCount(), capacity);
  const transform = source.transformVersion(), color = source.colorVersion(), alpha = options.alpha;
  const last = synced.get(mesh);
  if (last && last.transform === transform && last.color === color && last.count === count && last.alpha === alpha) return count;
  const matrices = alpha !== undefined && source.interpolatedMatrices ? source.interpolatedMatrices(alpha) : source.matrices();
  mesh.instanceMatrix.array.set(matrices.subarray(0, count * 16));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor && (!last || last.color !== color || last.count !== count)) {
    const rgba = source.colors(), rgb = mesh.instanceColor.array as Float32Array;
    for (let i = 0; i < count; i++) { rgb[i * 3] = rgba[i * 4]; rgb[i * 3 + 1] = rgba[i * 4 + 1]; rgb[i * 3 + 2] = rgba[i * 4 + 2]; }
    mesh.instanceColor.needsUpdate = true;
  }
  mesh.count = count;
  synced.set(mesh, {transform, color, count, alpha});
  return count;
}

interface ShapeThreeLike extends ThreeLike {
  SphereGeometry: new (radius: number, widthSegments?: number, heightSegments?: number) => unknown;
  CylinderGeometry: new (radiusTop: number, radiusBottom: number, height: number, radialSegments?: number, heightSegments?: number, openEnded?: boolean) => unknown;
  Group: new () => {add(...objects: any[]): unknown};
}

/** One InstancedMesh per primitive; add `group` to your scene. */
export interface ShapeMeshes<G = unknown> {
  readonly group: G;
  readonly boxes: InstancedMeshLike;
  /** Spheres, plus the two round caps of every capsule. */
  readonly spheres: InstancedMeshLike;
  /** The straight middle section of every capsule. */
  readonly cylinders: InstancedMeshLike;
}

/**
 * Meshes for a world that mixes boxes, spheres and capsules (createBody).
 * A capsule is drawn exactly, as an open cylinder plus two spheres, so any
 * radius and length renders correctly from the same three instanced meshes.
 * Call syncShapeMeshes() every frame. For a boxes-only world createBodyMesh()
 * is cheaper.
 */
export function createShapeMeshes<G = unknown>(THREE: ShapeThreeLike, source: InstanceSource, material?: unknown, capacity?: number): ShapeMeshes<G> {
  const size = capacity ?? source.capacity ?? source.native?.maxBodies ?? 4096;
  const shared = material ?? new THREE.MeshStandardMaterial({roughness: 0.6});
  const make = (geometry: unknown, count: number) => {
    const mesh = new THREE.InstancedMesh(geometry, shared, count);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
    (mesh as {frustumCulled?: boolean}).frustumCulled = false;
    mesh.count = 0;
    return mesh;
  };
  const meshes = {
    boxes: make(new THREE.BoxGeometry(2, 2, 2), size),
    // A capsule contributes two spheres, so a world of capsules needs twice the rows.
    spheres: make(new THREE.SphereGeometry(1, 24, 16), size * 2),
    cylinders: make(new THREE.CylinderGeometry(1, 1, 2, 24, 1, true), size),
  };
  const group = new THREE.Group();
  group.add(meshes.boxes, meshes.spheres, meshes.cylinders);
  const result = {group: group as G, ...meshes};
  syncShapeMeshes(source, result);
  return result;
}

const shapeSynced = new WeakMap<ShapeMeshes, {transform: number; color: number; count: number; alpha: number | undefined}>();

/** Copy transforms and colors into the three meshes. Skips the work when nothing changed. Returns the body count drawn. */
export function syncShapeMeshes(source: InstanceSource, meshes: ShapeMeshes, options: SyncOptions = {}): number {
  const count = Math.min(source.bodyCount(), meshes.boxes.instanceMatrix.array.length / 16);
  const transform = source.transformVersion(), color = source.colorVersion(), alpha = options.alpha;
  const last = shapeSynced.get(meshes);
  if (last && last.transform === transform && last.color === color && last.count === count && last.alpha === alpha) return count;
  const matrices = alpha !== undefined && source.interpolatedMatrices ? source.interpolatedMatrices(alpha) : source.matrices();
  const rgba = source.colors(), kinds = source.bodyKinds?.();
  const targets = [meshes.boxes, meshes.spheres, meshes.cylinders], used = [0, 0, 0];
  const put = (target: number, row: number, write?: (out: Float32Array, o: number) => void) => {
    const mesh = targets[target], o = used[target] * 16, out = mesh.instanceMatrix.array as Float32Array;
    if (write) write(out, o); else out.set(matrices.subarray(row * 16, row * 16 + 16), o);
    const rgb = mesh.instanceColor?.array as Float32Array | undefined;
    if (rgb) { const c = used[target] * 3; rgb[c] = rgba[row * 4]; rgb[c + 1] = rgba[row * 4 + 1]; rgb[c + 2] = rgba[row * 4 + 2]; }
    used[target]++;
  };
  for (let row = 0; row < count; row++) {
    const kind = kinds?.[row] ?? 'box';
    if (kind === 'box') { put(0, row); continue; }
    if (kind === 'sphere') { put(1, row); continue; }
    // Hull, mesh and height-field rows carry caller geometry: draw those with your own meshes and the row's matrix.
    if (kind !== 'capsule') continue;
    // Capsule rows are scaled (radius, halfLength, radius): right for the cylinder as they are.
    put(2, row);
    const m = row * 16, radius = Math.hypot(matrices[m], matrices[m + 1], matrices[m + 2]);
    const half = Math.hypot(matrices[m + 4], matrices[m + 5], matrices[m + 6]), k = half > 0 ? radius / half : 0;
    for (const side of [1, -1]) put(1, row, (out, o) => {
      out.set(matrices.subarray(m, m + 16), o);
      // Uniform radius on every axis, centered on the end of the capsule's segment.
      out[o + 4] = matrices[m + 4] * k; out[o + 5] = matrices[m + 5] * k; out[o + 6] = matrices[m + 6] * k;
      out[o + 12] = matrices[m + 12] + side * matrices[m + 4]; out[o + 13] = matrices[m + 13] + side * matrices[m + 5]; out[o + 14] = matrices[m + 14] + side * matrices[m + 6];
    });
  }
  targets.forEach((mesh, i) => {
    mesh.count = used[i];
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  });
  shapeSynced.set(meshes, {transform, color, count, alpha});
  return count;
}
