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
