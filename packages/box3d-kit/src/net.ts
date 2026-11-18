/**
 * Compact pose snapshots for authoritative servers: the server simulates, the
 * clients only draw. Positions are quantized to 1/1024 m, rotations use
 * smallest-three int16 quaternions, and rows whose quantized pose did not
 * change since the previous snapshot (sleeping bodies) are skipped.
 *
 * Deltas assume ordered, reliable delivery (WebSocket, WebRTC reliable
 * channel). On loss or for a late joiner, send a keyframe.
 */
import {EngineError} from './core/contracts.js';
import type {InstanceSource} from './three.js';

const MAGIC = 0x42335331; // "B3S1"
const HEADER_BYTES = 20;
const POSITION_SCALE = 1024;
const QUAT_SCALE = 32767 / Math.SQRT1_2;
const FLAG_SCALE = 4;

interface PoseState {
  count: number;
  /** Quantized per row: px, py, pz, quat index, qa, qb, qc. */
  q: Int32Array;
  /** Half extents per row. */
  scale: Float32Array;
}

function ensure(state: PoseState, count: number): void {
  if (state.q.length < count * 7) {
    const q = new Int32Array(Math.max(count, 64) * 7); q.set(state.q); state.q = q;
    const s = new Float32Array(Math.max(count, 64) * 3); s.set(state.scale); state.scale = s;
  }
}

function quantizeRow(m: Float32Array, o: number, out: Int32Array, w: number, scale: Float32Array, sw: number): void {
  const hx = Math.hypot(m[o], m[o + 1], m[o + 2]), hy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]), hz = Math.hypot(m[o + 8], m[o + 9], m[o + 10]);
  scale[sw] = hx; scale[sw + 1] = hy; scale[sw + 2] = hz;
  out[w] = Math.round(m[o + 12] * POSITION_SCALE);
  out[w + 1] = Math.round(m[o + 13] * POSITION_SCALE);
  out[w + 2] = Math.round(m[o + 14] * POSITION_SCALE);
  const m00 = m[o] / hx, m10 = m[o + 1] / hx, m20 = m[o + 2] / hx, m01 = m[o + 4] / hy, m11 = m[o + 5] / hy, m21 = m[o + 6] / hy, m02 = m[o + 8] / hz, m12 = m[o + 9] / hz, m22 = m[o + 10] / hz;
  let x: number, y: number, z: number, qw: number;
  const trace = m00 + m11 + m22;
  if (trace > 0) { const s = 0.5 / Math.sqrt(trace + 1); qw = 0.25 / s; x = (m21 - m12) * s; y = (m02 - m20) * s; z = (m10 - m01) * s; }
  else if (m00 > m11 && m00 > m22) { const s = 2 * Math.sqrt(1 + m00 - m11 - m22); qw = (m21 - m12) / s; x = 0.25 * s; y = (m01 + m10) / s; z = (m02 + m20) / s; }
  else if (m11 > m22) { const s = 2 * Math.sqrt(1 + m11 - m00 - m22); qw = (m02 - m20) / s; x = (m01 + m10) / s; y = 0.25 * s; z = (m12 + m21) / s; }
  else { const s = 2 * Math.sqrt(1 + m22 - m00 - m11); qw = (m10 - m01) / s; x = (m02 + m20) / s; y = (m12 + m21) / s; z = 0.25 * s; }
  const q = [x, y, z, qw];
  let largest = 0;
  for (let i = 1; i < 4; i++) if (Math.abs(q[i]) > Math.abs(q[largest])) largest = i;
  const sign = q[largest] < 0 ? -1 : 1;
  out[w + 3] = largest;
  let k = 4;
  for (let i = 0; i < 4; i++) if (i !== largest) out[w + k++] = Math.max(-32767, Math.min(32767, Math.round(q[i] * sign * QUAT_SCALE)));
}

function writeRowMatrix(state: PoseState, row: number, m: Float32Array): void {
  const w = row * 7, q = state.q, o = row * 16;
  const small = [q[w + 4] / QUAT_SCALE, q[w + 5] / QUAT_SCALE, q[w + 6] / QUAT_SCALE];
  const largest = Math.sqrt(Math.max(0, 1 - small[0] * small[0] - small[1] * small[1] - small[2] * small[2]));
  const quat = [0, 0, 0, 0];
  let k = 0;
  for (let i = 0; i < 4; i++) quat[i] = i === q[w + 3] ? largest : small[k++];
  const [x, y, z, qw] = quat, n = 1 / Math.hypot(x, y, z, qw);
  const nx = x * n, ny = y * n, nz = z * n, nw = qw * n;
  const hx = state.scale[row * 3], hy = state.scale[row * 3 + 1], hz = state.scale[row * 3 + 2];
  const xx = nx * nx, yy = ny * ny, zz = nz * nz, xy = nx * ny, xz = nx * nz, yz = ny * nz, wx = nw * nx, wy = nw * ny, wz = nw * nz;
  m[o] = (1 - 2 * (yy + zz)) * hx; m[o + 1] = 2 * (xy + wz) * hx; m[o + 2] = 2 * (xz - wy) * hx; m[o + 3] = 0;
  m[o + 4] = 2 * (xy - wz) * hy; m[o + 5] = (1 - 2 * (xx + zz)) * hy; m[o + 6] = 2 * (yz + wx) * hy; m[o + 7] = 0;
  m[o + 8] = 2 * (xz + wy) * hz; m[o + 9] = 2 * (yz - wx) * hz; m[o + 10] = (1 - 2 * (xx + yy)) * hz; m[o + 11] = 0;
  m[o + 12] = q[w] / POSITION_SCALE; m[o + 13] = q[w + 1] / POSITION_SCALE; m[o + 14] = q[w + 2] / POSITION_SCALE; m[o + 15] = 1;
}

/** Server side. One encoder per client connection (each tracks what that client has). */
export class SnapshotEncoder {
  private state: PoseState = {count: 0, q: new Int32Array(0), scale: new Float32Array(0)};
  private sequence = 0;
  private fresh: PoseState = {count: 0, q: new Int32Array(0), scale: new Float32Array(0)};

  /** Encode the source's current poses; a delta against the last snapshot unless `keyframe` is set or nothing was sent yet. */
  encode(source: InstanceSource, options: {keyframe?: boolean} = {}): Uint8Array {
    const m = source.matrices(), count = source.bodyCount();
    ensure(this.fresh, count);
    for (let row = 0; row < count; row++) quantizeRow(m, row * 16, this.fresh.q, row * 7, this.fresh.scale, row * 3);
    this.fresh.count = count;
    const keyframe = options.keyframe || this.sequence === 0;
    const prev = this.state, changed: number[] = [], scaled: boolean[] = [];
    for (let row = 0; row < count; row++) {
      const w = row * 7, sw = row * 3;
      const known = !keyframe && row < prev.count;
      const scaleSame = known && prev.scale[sw] === this.fresh.scale[sw] && prev.scale[sw + 1] === this.fresh.scale[sw + 1] && prev.scale[sw + 2] === this.fresh.scale[sw + 2];
      let poseSame = known;
      for (let k = 0; poseSame && k < 7; k++) poseSame = prev.q[w + k] === this.fresh.q[w + k];
      if (!(poseSame && scaleSame)) { changed.push(row); scaled.push(!scaleSame); }
    }
    const bitsetBytes = Math.ceil(count / 8);
    let bytes = HEADER_BYTES + bitsetBytes;
    for (const s of scaled) bytes += 19 + (s ? 12 : 0);
    const buffer = new ArrayBuffer(bytes), view = new DataView(buffer), out = new Uint8Array(buffer);
    const baseline = keyframe ? 0 : this.sequence;
    this.sequence = (this.sequence + 1) >>> 0 || 1;
    view.setUint32(0, MAGIC, true);
    view.setUint32(4, this.sequence, true);
    view.setUint32(8, baseline, true);
    view.setUint32(12, count, true);
    view.setUint32(16, changed.length, true);
    for (const row of changed) out[HEADER_BYTES + (row >> 3)] |= 1 << (row & 7);
    let p = HEADER_BYTES + bitsetBytes;
    changed.forEach((row, i) => {
      const w = row * 7, q = this.fresh.q;
      view.setUint8(p, q[w + 3] | (scaled[i] ? FLAG_SCALE : 0)); p += 1;
      view.setInt32(p, q[w], true); view.setInt32(p + 4, q[w + 1], true); view.setInt32(p + 8, q[w + 2], true); p += 12;
      view.setInt16(p, q[w + 4], true); view.setInt16(p + 2, q[w + 5], true); view.setInt16(p + 4, q[w + 6], true); p += 6;
      if (scaled[i]) {
        view.setFloat32(p, this.fresh.scale[row * 3], true); view.setFloat32(p + 4, this.fresh.scale[row * 3 + 1], true); view.setFloat32(p + 8, this.fresh.scale[row * 3 + 2], true); p += 12;
      }
    });
    // The fresh state becomes what the client has.
    [this.state, this.fresh] = [this.fresh, this.state];
    return out;
  }
}

/** Client side. Apply snapshots in order; it is an InstanceSource for the three.js adapter and writeInstances. */
export class SnapshotDecoder implements InstanceSource {
  private state: PoseState = {count: 0, q: new Int32Array(0), scale: new Float32Array(0)};
  private matrixData = new Float32Array(0);
  private colorData = new Float32Array(0);
  private sequence = 0;
  private revision = 0;
  /** RGBA used for every instance (snapshots carry poses only). */
  color: readonly [number, number, number, number] = [0.8, 0.8, 0.8, 1];

  /** Apply one snapshot. Throws INVALID_STATE for a delta whose baseline this client does not have: request a keyframe. */
  apply(bytes: Uint8Array): void {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    if (bytes.byteLength < HEADER_BYTES || view.getUint32(0, true) !== MAGIC) throw new EngineError('INVALID_PAYLOAD', 'Not a Box3D snapshot.');
    const sequence = view.getUint32(4, true), baseline = view.getUint32(8, true), count = view.getUint32(12, true), changed = view.getUint32(16, true);
    if (baseline !== 0 && baseline !== this.sequence) throw new EngineError('INVALID_STATE', `Snapshot ${sequence} needs baseline ${baseline}, have ${this.sequence}; request a keyframe.`);
    ensure(this.state, count);
    if (this.matrixData.length < count * 16) {
      const m = new Float32Array(Math.max(count, 64) * 16); m.set(this.matrixData); this.matrixData = m;
    }
    const bitsetBytes = Math.ceil(count / 8);
    let p = HEADER_BYTES + bitsetBytes, seen = 0;
    for (let row = 0; row < count; row++) {
      if (!(bytes[HEADER_BYTES + (row >> 3)] & (1 << (row & 7)))) continue;
      const w = row * 7, q = this.state.q, flags = view.getUint8(p); p += 1;
      q[w + 3] = flags & 3;
      q[w] = view.getInt32(p, true); q[w + 1] = view.getInt32(p + 4, true); q[w + 2] = view.getInt32(p + 8, true); p += 12;
      q[w + 4] = view.getInt16(p, true); q[w + 5] = view.getInt16(p + 2, true); q[w + 6] = view.getInt16(p + 4, true); p += 6;
      if (flags & FLAG_SCALE) {
        this.state.scale[row * 3] = view.getFloat32(p, true); this.state.scale[row * 3 + 1] = view.getFloat32(p + 4, true); this.state.scale[row * 3 + 2] = view.getFloat32(p + 8, true); p += 12;
      }
      writeRowMatrix(this.state, row, this.matrixData);
      seen++;
    }
    if (seen !== changed || p !== bytes.byteLength) throw new EngineError('INVALID_PAYLOAD', 'Corrupt snapshot.');
    this.state.count = count;
    this.sequence = sequence;
    this.revision++;
  }

  bodyCount(): number { return this.state.count; }
  transformVersion(): number { return this.revision; }
  colorVersion(): number { return this.state.count; }
  matrices(): Float32Array { return this.matrixData.subarray(0, this.state.count * 16); }
  colors(): Float32Array {
    const n = this.state.count * 4;
    if (this.colorData.length < n) this.colorData = new Float32Array(Math.max(n, 256));
    for (let i = 0; i < n; i += 4) this.colorData.set(this.color, i);
    return this.colorData.subarray(0, n);
  }
}
