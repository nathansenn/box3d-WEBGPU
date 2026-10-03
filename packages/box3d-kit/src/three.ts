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
