/**
 * Units and axes contract: Box3D works in metres, kilograms and seconds in a
 * right-handed, Y-up frame (gravity is -10 m/s² along Y). Engines such as
 * Blender, Unreal-style pipelines and many CAD tools are Z-up; convert at the
 * render boundary instead of changing the simulation.
 */
export type UpAxis = 'y' | 'z';

/**
 * Copy `count` column-major 4x4 matrices from `source` into `out`, converting
 * from Box3D's Y-up frame when `up` is 'z': (x, y, z) -> (x, -z, y), which
 * keeps the frame right-handed. `out` may alias `source`.
 */
export function convertMatrices(source: Float32Array, out: Float32Array, count: number, up: UpAxis = 'y'): Float32Array {
  const n = count * 16;
  if (up === 'y') {
    if (out !== source) out.set(source.subarray(0, n));
    return out;
  }
  for (let o = 0; o < n; o += 4) {
    const y = source[o + 1], z = source[o + 2];
    out[o] = source[o];
    out[o + 1] = -z;
    out[o + 2] = y;
    out[o + 3] = source[o + 3];
  }
  return out;
}

/** Convert one Box3D (Y-up) point or direction to the target frame. */
export function convertVector(v: readonly [number, number, number], up: UpAxis = 'y'): [number, number, number] {
  return up === 'z' ? [v[0], -v[2], v[1]] : [v[0], v[1], v[2]];
}

/** Convert one point or direction from the target frame back to Box3D's Y-up frame. */
export function toBox3DFrame(v: readonly [number, number, number], up: UpAxis = 'y'): [number, number, number] {
  return up === 'z' ? [v[0], v[2], -v[1]] : [v[0], v[1], v[2]];
}
