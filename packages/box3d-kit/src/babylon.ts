/**
 * Babylon.js adapter using thin instances: one mesh draws every body, and
 * each frame updates a single matrix buffer. Written against Babylon's
 * structural API, so this package does not depend on @babylonjs/core.
 *
 * Babylon is left-handed by default and Box3D is right-handed; the adapter
 * mirrors Z unless you pass {rightHanded: true} (use that when the scene has
 * `scene.useRightHandedSystem = true`).
 */
import type {InstanceSource} from './three.js';

/** Structural subset of a Babylon Mesh used for thin instances. */
export interface ThinInstanceMeshLike {
  thinInstanceSetBuffer(kind: string, buffer: Float32Array | null, stride?: number, staticBuffer?: boolean): void;
  thinInstanceBufferUpdated(kind: string): void;
  thinInstanceCount: number;
}

export interface BabylonSyncOptions {
  readonly alpha?: number;
  /** The Babylon scene uses useRightHandedSystem = true: copy matrices unchanged. */
  readonly rightHanded?: boolean;
}

interface Binding { matrices: Float32Array; colors: Float32Array; transform: number; color: number; count: number; alpha: number | undefined }
const bindings = new WeakMap<ThinInstanceMeshLike, Binding>();

/**
 * Bind a mesh (a 2x2x2 box, e.g. MeshBuilder.CreateBox('b', {size: 2})) to a
 * source and allocate its thin-instance buffers for `capacity` bodies.
 */
export function bindThinInstances(source: InstanceSource, mesh: ThinInstanceMeshLike, capacity?: number): void {
  const size = capacity ?? source.capacity ?? source.native?.maxBodies ?? 4096;
  const binding: Binding = {matrices: new Float32Array(size * 16), colors: new Float32Array(size * 4), transform: -1, color: -1, count: -1, alpha: undefined};
  mesh.thinInstanceSetBuffer('matrix', binding.matrices, 16, false);
  mesh.thinInstanceSetBuffer('color', binding.colors, 4, false);
  bindings.set(mesh, binding);
}

/** Copy the latest (or interpolated) transforms into the mesh's thin instances. Returns the drawn count. */
export function syncThinInstances(source: InstanceSource, mesh: ThinInstanceMeshLike, options: BabylonSyncOptions = {}): number {
  let binding = bindings.get(mesh);
  if (!binding) { bindThinInstances(source, mesh); binding = bindings.get(mesh)!; }
  const count = Math.min(source.bodyCount(), binding.matrices.length / 16);
  const transform = source.transformVersion(), color = source.colorVersion(), alpha = options.alpha;
  if (binding.transform !== transform || binding.count !== count || binding.alpha !== alpha) {
    const m = alpha !== undefined && source.interpolatedMatrices ? source.interpolatedMatrices(alpha) : source.matrices();
    const out = binding.matrices;
    out.set(m.subarray(0, count * 16));
    if (!options.rightHanded) {
      // Mirror Z: M' = S·M·S with S = diag(1, 1, -1, 1). Negate entries where exactly one index is z.
      for (let o = 0; o < count * 16; o += 16) { out[o + 2] = -out[o + 2]; out[o + 6] = -out[o + 6]; out[o + 8] = -out[o + 8]; out[o + 9] = -out[o + 9]; out[o + 14] = -out[o + 14]; }
    }
    mesh.thinInstanceBufferUpdated('matrix');
  }
  if (binding.color !== color || binding.count !== count) {
    const rgba = source.colors(), out = binding.colors;
    for (let i = 0; i < count * 4; i += 4) { out[i] = rgba[i]; out[i + 1] = rgba[i + 1]; out[i + 2] = rgba[i + 2]; out[i + 3] = 1; }
    mesh.thinInstanceBufferUpdated('color');
  }
  mesh.thinInstanceCount = count;
  Object.assign(binding, {transform, color, count, alpha});
  return count;
}
