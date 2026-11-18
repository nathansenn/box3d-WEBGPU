/** Compact dynamic-surface layout shared by CPU simulation and WebGPU.
 *  0..11  : position.xyz as float32
 * 12..15  : octahedral normal.xy as snorm16
 * 16..19  : color/stress as unorm8x4
 * 20..23  : uv as unorm16x2
 */
export const PACKED_SURFACE_VERTEX_BYTES = 24;

export class PackedSurfaceBuffer {
  readonly buffer: ArrayBuffer;
  readonly data: Uint8Array;
  readonly u8: Uint8Array;
  readonly f32: Float32Array;
  readonly i16: Int16Array;
  readonly u16: Uint16Array;

  constructor(vertexCount: number) {
    const safeCount = Math.max(0, Math.floor(vertexCount));
    this.buffer = new ArrayBuffer(safeCount * PACKED_SURFACE_VERTEX_BYTES);
    this.data = new Uint8Array(this.buffer);
    this.u8 = this.data;
    this.f32 = new Float32Array(this.buffer);
    this.i16 = new Int16Array(this.buffer);
    this.u16 = new Uint16Array(this.buffer);
  }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Homogeneous octahedral encoding; L1 normalization preserves direction. */
export function encodeOctNormal(nx: number, ny: number, nz: number): readonly [number, number] {
  if (Math.abs(nx) + Math.abs(ny) + Math.abs(nz) <= 1e-12) {
    nx = 0;
    ny = 1;
    nz = 0;
  }
  const inverseL1 = 1 / Math.max(1e-12, Math.abs(nx) + Math.abs(ny) + Math.abs(nz));
  let ox = nx * inverseL1;
  let oy = ny * inverseL1;
  if (nz < 0) {
    const oldX = ox;
    ox = (1 - Math.abs(oy)) * (oldX < 0 ? -1 : 1);
    oy = (1 - Math.abs(oldX)) * (oy < 0 ? -1 : 1);
  }
  return [
    Math.round((ox < -1 ? -1 : ox > 1 ? 1 : ox) * 32767),
    Math.round((oy < -1 ? -1 : oy > 1 ? 1 : oy) * 32767),
  ];
}

export function writePackedSurfaceVertex(
  buffer: PackedSurfaceBuffer,
  index: number,
  px: number,
  py: number,
  pz: number,
  nx: number,
  ny: number,
  nz: number,
  r: number,
  g: number,
  b: number,
  a: number,
  u: number,
  v: number,
): void {
  const f = index * 6;
  const h = index * 12;
  const byte = index * PACKED_SURFACE_VERTEX_BYTES;
  buffer.f32[f] = px;
  buffer.f32[f + 1] = py;
  buffer.f32[f + 2] = pz;
  const oct = encodeOctNormal(nx, ny, nz);
  buffer.i16[h + 6] = oct[0];
  buffer.i16[h + 7] = oct[1];
  buffer.u8[byte + 16] = Math.round(clamp01(r) * 255);
  buffer.u8[byte + 17] = Math.round(clamp01(g) * 255);
  buffer.u8[byte + 18] = Math.round(clamp01(b) * 255);
  buffer.u8[byte + 19] = Math.round(clamp01(a) * 255);
  buffer.u16[h + 10] = Math.round(clamp01(u) * 65535);
  buffer.u16[h + 11] = Math.round(clamp01(v) * 65535);
}

export function translatePackedSurfacePositions(
  data: Uint8Array,
  vertexCount: number,
  dx: number,
  dy: number,
  dz: number,
): void {
  const safeCount = Math.max(0, Math.min(Math.floor(vertexCount), Math.floor(data.byteLength / PACKED_SURFACE_VERTEX_BYTES)));
  const f32 = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
  const stride = PACKED_SURFACE_VERTEX_BYTES / 4;
  for (let i = 0; i < safeCount; i++) {
    const offset = i * stride;
    f32[offset] += dx;
    f32[offset + 1] += dy;
    f32[offset + 2] += dz;
  }
}

export function packedSurfacePositionsAreFinite(data: Uint8Array, vertexCount: number): boolean {
  const safeCount = Math.max(0, Math.min(Math.floor(vertexCount), Math.floor(data.byteLength / PACKED_SURFACE_VERTEX_BYTES)));
  const f32 = new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
  for (let i = 0; i < safeCount; i++) {
    const offset = i * (PACKED_SURFACE_VERTEX_BYTES / 4);
    if (!Number.isFinite(f32[offset]) || !Number.isFinite(f32[offset + 1]) || !Number.isFinite(f32[offset + 2])) {
      return false;
    }
  }
  return true;
}
