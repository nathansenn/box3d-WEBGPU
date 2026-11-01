/**
 * Pose arrays for ECS-style engines and compact transport: write positions
 * and rotations into caller-owned typed arrays (structure of arrays), or pack
 * a 28-byte position+quaternion record per body. No allocation per call.
 */
import type {InstanceSource} from './three.js';
import type {Body, PhysicsWorld} from './world.js';

/** Unit quaternion [x, y, z, w] of row `o` of a half-extent-scaled matrix stream, into out[w..w+3]. */
function rotation(m: Float32Array, o: number, out: Float32Array, w: number): void {
  const hx = Math.hypot(m[o], m[o + 1], m[o + 2]), hy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]), hz = Math.hypot(m[o + 8], m[o + 9], m[o + 10]);
  const m00 = m[o] / hx, m10 = m[o + 1] / hx, m20 = m[o + 2] / hx, m01 = m[o + 4] / hy, m11 = m[o + 5] / hy, m21 = m[o + 6] / hy, m02 = m[o + 8] / hz, m12 = m[o + 9] / hz, m22 = m[o + 10] / hz;
  const trace = m00 + m11 + m22;
  if (trace > 0) { const s = 0.5 / Math.sqrt(trace + 1); out[w + 3] = 0.25 / s; out[w] = (m21 - m12) * s; out[w + 1] = (m02 - m20) * s; out[w + 2] = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); out[w + 3] = (m21 - m12) / s; out[w] = 0.25 * s; out[w + 1] = (m01 + m10) / s; out[w + 2] = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); out[w + 3] = (m02 - m20) / s; out[w] = (m01 + m10) / s; out[w + 1] = 0.25 * s; out[w + 2] = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); out[w + 3] = (m10 - m01) / s; out[w] = (m02 + m20) / s; out[w + 1] = (m12 + m21) / s; out[w + 2] = 0.25 * s; }
}

export interface PoseArrays {
  /** xyz per row (3 floats). */
  readonly positions: Float32Array;
  /** xyzw per row (4 floats). */
  readonly rotations: Float32Array;
  /** Optional half extents per row (3 floats). */
  readonly halfExtents?: Float32Array;
}

/** Fill structure-of-arrays pose buffers for every instance row. Returns the row count written. */
export function readPoses(source: InstanceSource, out: PoseArrays): number {
  const m = source.matrices(), rows = Math.min(source.bodyCount(), out.positions.length / 3, out.rotations.length / 4, out.halfExtents ? out.halfExtents.length / 3 : Infinity);
  for (let row = 0; row < rows; row++) {
    const o = row * 16;
    out.positions[row * 3] = m[o + 12]; out.positions[row * 3 + 1] = m[o + 13]; out.positions[row * 3 + 2] = m[o + 14];
    rotation(m, o, out.rotations, row * 4);
    if (out.halfExtents) {
      out.halfExtents[row * 3] = Math.hypot(m[o], m[o + 1], m[o + 2]);
      out.halfExtents[row * 3 + 1] = Math.hypot(m[o + 4], m[o + 5], m[o + 6]);
      out.halfExtents[row * 3 + 2] = Math.hypot(m[o + 8], m[o + 9], m[o + 10]);
    }
  }
  return rows;
}

/**
 * Pack px, py, pz, qx, qy, qz, qw per row (28 bytes instead of 64): for
 * transport, compact GPU layouts or engines that compose their own matrices.
 */
export function packPoses(source: InstanceSource, out: Float32Array): number {
  const m = source.matrices(), rows = Math.min(source.bodyCount(), Math.floor(out.length / 7));
  for (let row = 0; row < rows; row++) {
    const o = row * 16, w = row * 7;
    out[w] = m[o + 12]; out[w + 1] = m[o + 13]; out[w + 2] = m[o + 14];
    rotation(m, o, out, w + 3);
  }
  return rows;
}

/**
 * ECS style: poses for a list of entities' bodies, in the list's order, into
 * component arrays indexed like `bodies`. Destroyed bodies are skipped and
 * reported in the returned count of live bodies; their slots are left as is.
 */
export function readBodyPoses(world: PhysicsWorld, bodies: readonly (Body | null)[], out: PoseArrays): number {
  const m = world.matrices();
  let live = 0;
  for (let i = 0; i < bodies.length; i++) {
    const body = bodies[i];
    const row = body ? world.native.bodyIndex(body) : null;
    if (row === null) continue;
    const o = row * 16;
    out.positions[i * 3] = m[o + 12]; out.positions[i * 3 + 1] = m[o + 13]; out.positions[i * 3 + 2] = m[o + 14];
    rotation(m, o, out.rotations, i * 4);
    live++;
  }
  return live;
}
