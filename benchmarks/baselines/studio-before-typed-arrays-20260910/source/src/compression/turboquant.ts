/**
 * Independent TurboQuant-style vector quantization for simulation transport.
 *
 * `dense` is a bounded blockwise adaptation of TurboQuant-MSE: normalize,
 * apply a deterministic random orthogonal rotation, then use a Gaussian
 * Lloyd-Max scalar codebook. It is not the paper's one global d×d rotation.
 *
 * `structured` replaces the dense matrix with randomized normalized
 * Walsh-Hadamard stages, following the later Fast-TurboQuant direction for
 * O(d log d) browser-friendly transforms. No external implementation code is
 * copied here, and the QJL inner-product residual stage is intentionally not
 * used because this codec reconstructs simulation state vectors.
 *
 * Keep this outside the authoritative solver and same-thread GPU upload path;
 * it is intended for bandwidth-limited snapshots, replay, and transport.
 */

export type TurboQuantBits = 2 | 3 | 4;
export type TurboQuantRotation = 'dense' | 'structured';

export type TurboQuantOptions = {
  bits?: TurboQuantBits;
  blockSize?: number;
  seed?: number;
  rotation?: TurboQuantRotation;
  /** Physics adaptation: subtract/store one mean per block before rotation. */
  centered?: boolean;
};

export type TurboQuantPacket = {
  readonly length: number;
  readonly blockSize: number;
  readonly bits: TurboQuantBits;
  readonly rotation: TurboQuantRotation;
  readonly seed: number;
  readonly centered: boolean;
  readonly norms: Float32Array;
  readonly means: Float32Array;
  readonly codes: Uint8Array;
};

type Codebook = {
  centroids: Float32Array;
  thresholds: Float32Array;
};

const CODEBOOKS: Readonly<Record<TurboQuantBits, Codebook>> = {
  2: {
    centroids: new Float32Array([-1.51041760849908, -0.452780034636486, 0.452780034636486, 1.51041760849908]),
    thresholds: new Float32Array([-0.981598821567777, 0, 0.981598821567777]),
  },
  3: {
    centroids: new Float32Array([
      -2.15194570453694, -1.34390927850495, -0.756005281205841, -0.245094178944208,
      0.245094178944209, 0.756005281205842, 1.34390927850495, 2.15194570453694,
    ]),
    thresholds: new Float32Array([
      -1.74792749152094, -1.04995727985539, -0.500549730075021, 0,
      0.500549730075021, 1.04995727985539, 1.74792749152094,
    ]),
  },
  4: {
    centroids: new Float32Array([
      -2.73258957099499, -2.06901722653118, -1.61804638602168, -1.25623119734698,
      -0.942340456486791, -0.656759118532332, -0.388048299490207, -0.128395029851118,
      0.128395029851119, 0.388048299490207, 0.656759118532333, 0.942340456486794,
      1.25623119734698, 1.61804638602168, 2.06901722653118, 2.73258957099499,
    ]),
    thresholds: new Float32Array([
      -2.40080339876308, -1.84353180627642, -1.43713879168432, -1.09928582691688,
      -0.799549787509557, -0.522403709011266, -0.258221664670661, 0,
      0.258221664670661, 0.522403709011267, 0.799549787509557, 1.09928582691688,
      1.43713879168432, 1.84353180627642, 2.40080339876308,
    ]),
  },
};

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function xorshift32(state: number): number {
  let x = state >>> 0;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return x >>> 0;
}

class DeterministicRng {
  private state: number;
  private spare: number | null = null;

  constructor(seed: number) {
    this.state = (seed >>> 0) || 0x9e3779b9;
  }

  nextU32(): number {
    this.state = xorshift32(this.state);
    return this.state;
  }

  next(): number {
    return (this.nextU32() + 0.5) / 4294967296;
  }

  gaussian(): number {
    if (this.spare !== null) {
      const value = this.spare;
      this.spare = null;
      return value;
    }
    const u1 = Math.max(1e-12, this.next());
    const u2 = this.next();
    const radius = Math.sqrt(-2 * Math.log(u1));
    const angle = 2 * Math.PI * u2;
    this.spare = radius * Math.sin(angle);
    return radius * Math.cos(angle);
  }
}

function makeDenseOrthogonal(size: number, seed: number): Float32Array {
  const rng = new DeterministicRng(seed ^ 0x51ed270b);
  const matrix = new Float64Array(size * size);
  const row = new Float64Array(size);

  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) row[c] = rng.gaussian();

    // Modified Gram-Schmidt with one re-orthogonalization pass. The matrix is
    // generated once, so setup cost is intentionally traded for stable rows.
    for (let pass = 0; pass < 2; pass++) {
      for (let q = 0; q < r; q++) {
        const qo = q * size;
        let dot = 0;
        for (let c = 0; c < size; c++) dot += row[c] * matrix[qo + c];
        for (let c = 0; c < size; c++) row[c] -= dot * matrix[qo + c];
      }
    }

    let norm2 = 0;
    for (let c = 0; c < size; c++) norm2 += row[c] * row[c];
    if (norm2 < 1e-18) {
      row.fill(0);
      row[r] = 1;
      norm2 = 1;
    }
    const invNorm = 1 / Math.sqrt(norm2);
    const ro = r * size;
    for (let c = 0; c < size; c++) matrix[ro + c] = row[c] * invNorm;
  }

  return new Float32Array(matrix);
}

function makeSigns(size: number, rng: DeterministicRng): Int8Array {
  const signs = new Int8Array(size);
  for (let i = 0; i < size; i++) signs[i] = (rng.nextU32() & 1) === 0 ? -1 : 1;
  return signs;
}

function makePermutation(size: number, rng: DeterministicRng): Uint16Array {
  const permutation = new Uint16Array(size);
  for (let i = 0; i < size; i++) permutation[i] = i;
  for (let i = size - 1; i > 0; i--) {
    const j = rng.nextU32() % (i + 1);
    const tmp = permutation[i];
    permutation[i] = permutation[j];
    permutation[j] = tmp;
  }
  return permutation;
}

function fwhtNormalized(values: Float32Array, size: number): void {
  for (let width = 1; width < size; width <<= 1) {
    const span = width << 1;
    for (let base = 0; base < size; base += span) {
      const end = base + width;
      for (let i = base; i < end; i++) {
        const a = values[i];
        const b = values[i + width];
        values[i] = a + b;
        values[i + width] = a - b;
      }
    }
  }
  const scale = 1 / Math.sqrt(size);
  for (let i = 0; i < size; i++) values[i] *= scale;
}

function quantizeScalar(value: number, thresholds: Float32Array): number {
  let low = 0;
  let high = thresholds.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (value > thresholds[mid]) low = mid + 1;
    else high = mid;
  }
  return low;
}

function writePackedCode(target: Uint8Array, bitOffset: number, bits: number, code: number): void {
  const byteIndex = bitOffset >>> 3;
  const shift = bitOffset & 7;
  target[byteIndex] |= (code << shift) & 0xff;
  const spill = shift + bits - 8;
  if (spill > 0) target[byteIndex + 1] |= code >>> (bits - spill);
}

function readPackedCode(source: Uint8Array, bitOffset: number, bits: number): number {
  const byteIndex = bitOffset >>> 3;
  const shift = bitOffset & 7;
  let value = source[byteIndex] >>> shift;
  const available = 8 - shift;
  if (available < bits) value |= source[byteIndex + 1] << available;
  return value & ((1 << bits) - 1);
}

export function turboQuantPacketBytes(packet: TurboQuantPacket): number {
  return packet.codes.byteLength + packet.norms.byteLength + packet.means.byteLength;
}

export function turboQuantCompressionRatio(packet: TurboQuantPacket): number {
  const compressed = turboQuantPacketBytes(packet);
  return compressed > 0 ? (packet.length * Float32Array.BYTES_PER_ELEMENT) / compressed : 0;
}

export class TurboQuantCodec {
  readonly bits: TurboQuantBits;
  readonly blockSize: number;
  readonly seed: number;
  readonly rotation: TurboQuantRotation;
  readonly centered: boolean;

  private readonly codebook: Codebook;
  private readonly sqrtBlock: number;
  private readonly blockA: Float32Array;
  private readonly blockB: Float32Array;
  private readonly denseMatrix: Float32Array | null;
  private readonly signsA: Int8Array | null;
  private readonly signsB: Int8Array | null;
  private readonly permutation: Uint16Array | null;

  constructor(options: TurboQuantOptions = {}) {
    this.bits = options.bits ?? 3;
    this.blockSize = Math.max(4, Math.floor(options.blockSize ?? (options.rotation === 'dense' ? 32 : 64)));
    this.seed = (options.seed ?? 0x7f4a7c15) >>> 0;
    this.rotation = options.rotation ?? 'structured';
    this.centered = options.centered ?? false;
    if (!isPowerOfTwo(this.blockSize)) throw new Error(`TurboQuant blockSize must be a power of two; received ${this.blockSize}.`);
    if (this.rotation === 'dense' && this.blockSize > 128) {
      throw new Error('Dense TurboQuant blocks above 128 are intentionally rejected because O(d²) setup/runtime is unsuitable for this browser path.');
    }

    this.codebook = CODEBOOKS[this.bits];
    this.sqrtBlock = Math.sqrt(this.blockSize);
    this.blockA = new Float32Array(this.blockSize);
    this.blockB = new Float32Array(this.blockSize);

    if (this.rotation === 'dense') {
      this.denseMatrix = makeDenseOrthogonal(this.blockSize, this.seed);
      this.signsA = null;
      this.signsB = null;
      this.permutation = null;
    } else {
      const rng = new DeterministicRng(this.seed ^ 0xa511e9b3);
      this.denseMatrix = null;
      this.signsA = makeSigns(this.blockSize, rng);
      this.signsB = makeSigns(this.blockSize, rng);
      this.permutation = makePermutation(this.blockSize, rng);
    }
  }

  createPacket(length: number): TurboQuantPacket {
    const safeLength = Math.max(0, Math.floor(length));
    const blockCount = Math.ceil(safeLength / this.blockSize);
    const codeBytes = Math.ceil((blockCount * this.blockSize * this.bits) / 8);
    return {
      length: safeLength,
      blockSize: this.blockSize,
      bits: this.bits,
      rotation: this.rotation,
      seed: this.seed,
      centered: this.centered,
      norms: new Float32Array(blockCount),
      means: this.centered ? new Float32Array(blockCount) : new Float32Array(0),
      codes: new Uint8Array(codeBytes),
    };
  }

  encode(source: Float32Array, predictor?: Float32Array): TurboQuantPacket {
    const packet = this.createPacket(source.length);
    this.encodeInto(source, packet, predictor);
    return packet;
  }

  encodeInto(source: Float32Array, packet: TurboQuantPacket, predictor?: Float32Array): void {
    this.encodeCore(source, packet, predictor);
  }

  /** Encode and reconstruct in one traversal, avoiding a second code-unpack pass. */
  encodeIntoAndReconstruct(
    source: Float32Array,
    packet: TurboQuantPacket,
    reconstruction: Float32Array,
    predictor?: Float32Array,
  ): void {
    if (reconstruction.length < source.length) throw new Error('TurboQuant reconstruction is shorter than the source vector.');
    this.encodeCore(source, packet, predictor, reconstruction);
  }

  private encodeCore(
    source: Float32Array,
    packet: TurboQuantPacket,
    predictor?: Float32Array,
    reconstruction?: Float32Array,
  ): void {
    this.assertPacket(packet, source.length);
    if (predictor && predictor.length < source.length) throw new Error('TurboQuant predictor is shorter than the source vector.');
    packet.codes.fill(0);
    const n = source.length;
    const d = this.blockSize;
    const a = this.blockA;
    let codeByteOffset = 0;
    let sourceOffset = 0;
    let blockIndex = 0;

    while (sourceOffset < n) {
      const count = Math.min(d, n - sourceOffset);
      let mean = 0;
      if (this.centered) {
        for (let i = 0; i < count; i++) mean += source[sourceOffset + i] - (predictor?.[sourceOffset + i] ?? 0);
        mean /= Math.max(1, count);
        packet.means[blockIndex] = mean;
      }

      let norm2 = 0;
      for (let i = 0; i < count; i++) {
        const value = source[sourceOffset + i] - (predictor?.[sourceOffset + i] ?? 0) - mean;
        a[i] = value;
        norm2 += value * value;
      }
      for (let i = count; i < d; i++) a[i] = 0;

      const norm = Math.sqrt(norm2);
      packet.norms[blockIndex] = norm;
      if (norm > 1e-20) {
        const invNorm = 1 / norm;
        for (let i = 0; i < d; i++) a[i] *= invNorm;
        this.rotateForward(a, this.blockB);
      } else {
        this.blockB.fill(0);
      }

      const rotated = this.blockB;
      codeByteOffset = this.packRotatedBlock(rotated, packet.codes, codeByteOffset, reconstruction);

      if (reconstruction) {
        this.rotateInverse(rotated, a);
        for (let i = 0; i < count; i++) {
          reconstruction[sourceOffset + i] = a[i] * norm + mean + (predictor?.[sourceOffset + i] ?? 0);
        }
      }

      sourceOffset += count;
      blockIndex++;
    }
  }

  decode(packet: TurboQuantPacket, predictor?: Float32Array): Float32Array {
    const output = new Float32Array(packet.length);
    this.decodeInto(packet, output, predictor);
    return output;
  }

  decodeInto(packet: TurboQuantPacket, output: Float32Array, predictor?: Float32Array): void {
    this.assertPacket(packet, output.length);
    if (output.length < packet.length) throw new Error('TurboQuant output is shorter than packet.length.');
    if (predictor && predictor.length < packet.length) throw new Error('TurboQuant predictor is shorter than packet.length.');

    const n = packet.length;
    const d = this.blockSize;
    const centroids = this.codebook.centroids;
    const b = this.blockB;
    let codeByteOffset = 0;
    let outputOffset = 0;
    let blockIndex = 0;

    while (outputOffset < n) {
      const count = Math.min(d, n - outputOffset);
      codeByteOffset = this.unpackRotatedBlock(packet.codes, codeByteOffset, b, centroids);
      this.rotateInverse(b, this.blockA);
      const scale = packet.norms[blockIndex];
      const mean = this.centered ? packet.means[blockIndex] : 0;
      for (let i = 0; i < count; i++) {
        output[outputOffset + i] = this.blockA[i] * scale + mean + (predictor?.[outputOffset + i] ?? 0);
      }
      outputOffset += count;
      blockIndex++;
    }
  }

  private packRotatedBlock(
    rotated: Float32Array,
    target: Uint8Array,
    byteOffset: number,
    reconstruct: Float32Array | undefined,
  ): number {
    const d = this.blockSize;
    const thresholds = this.codebook.thresholds;
    const centroids = this.codebook.centroids;
    const scale = this.sqrtBlock;

    if (this.bits === 4) {
      for (let i = 0; i < d; i += 2) {
        const c0 = quantizeScalar(rotated[i] * scale, thresholds);
        const c1 = quantizeScalar(rotated[i + 1] * scale, thresholds);
        target[byteOffset++] = c0 | (c1 << 4);
        if (reconstruct) {
          rotated[i] = centroids[c0] / scale;
          rotated[i + 1] = centroids[c1] / scale;
        }
      }
      return byteOffset;
    }

    if (this.bits === 3) {
      for (let i = 0; i < d; i += 8) {
        const c0 = quantizeScalar(rotated[i] * scale, thresholds);
        const c1 = quantizeScalar(rotated[i + 1] * scale, thresholds);
        const c2 = quantizeScalar(rotated[i + 2] * scale, thresholds);
        const c3 = quantizeScalar(rotated[i + 3] * scale, thresholds);
        const c4 = quantizeScalar(rotated[i + 4] * scale, thresholds);
        const c5 = quantizeScalar(rotated[i + 5] * scale, thresholds);
        const c6 = quantizeScalar(rotated[i + 6] * scale, thresholds);
        const c7 = quantizeScalar(rotated[i + 7] * scale, thresholds);
        const packed = c0 | (c1 << 3) | (c2 << 6) | (c3 << 9) | (c4 << 12) | (c5 << 15) | (c6 << 18) | (c7 << 21);
        target[byteOffset++] = packed & 0xff;
        target[byteOffset++] = (packed >>> 8) & 0xff;
        target[byteOffset++] = (packed >>> 16) & 0xff;
        if (reconstruct) {
          rotated[i] = centroids[c0] / scale;
          rotated[i + 1] = centroids[c1] / scale;
          rotated[i + 2] = centroids[c2] / scale;
          rotated[i + 3] = centroids[c3] / scale;
          rotated[i + 4] = centroids[c4] / scale;
          rotated[i + 5] = centroids[c5] / scale;
          rotated[i + 6] = centroids[c6] / scale;
          rotated[i + 7] = centroids[c7] / scale;
        }
      }
      return byteOffset;
    }

    for (let i = 0; i < d; i += 4) {
      const c0 = quantizeScalar(rotated[i] * scale, thresholds);
      const c1 = quantizeScalar(rotated[i + 1] * scale, thresholds);
      const c2 = quantizeScalar(rotated[i + 2] * scale, thresholds);
      const c3 = quantizeScalar(rotated[i + 3] * scale, thresholds);
      target[byteOffset++] = c0 | (c1 << 2) | (c2 << 4) | (c3 << 6);
      if (reconstruct) {
        rotated[i] = centroids[c0] / scale;
        rotated[i + 1] = centroids[c1] / scale;
        rotated[i + 2] = centroids[c2] / scale;
        rotated[i + 3] = centroids[c3] / scale;
      }
    }
    return byteOffset;
  }

  private unpackRotatedBlock(
    source: Uint8Array,
    byteOffset: number,
    rotated: Float32Array,
    centroids: Float32Array,
  ): number {
    const d = this.blockSize;
    const invScale = 1 / this.sqrtBlock;
    if (this.bits === 4) {
      for (let i = 0; i < d; i += 2) {
        const packed = source[byteOffset++];
        rotated[i] = centroids[packed & 0x0f] * invScale;
        rotated[i + 1] = centroids[packed >>> 4] * invScale;
      }
      return byteOffset;
    }
    if (this.bits === 3) {
      for (let i = 0; i < d; i += 8) {
        const packed = source[byteOffset] | (source[byteOffset + 1] << 8) | (source[byteOffset + 2] << 16);
        byteOffset += 3;
        rotated[i] = centroids[packed & 7] * invScale;
        rotated[i + 1] = centroids[(packed >>> 3) & 7] * invScale;
        rotated[i + 2] = centroids[(packed >>> 6) & 7] * invScale;
        rotated[i + 3] = centroids[(packed >>> 9) & 7] * invScale;
        rotated[i + 4] = centroids[(packed >>> 12) & 7] * invScale;
        rotated[i + 5] = centroids[(packed >>> 15) & 7] * invScale;
        rotated[i + 6] = centroids[(packed >>> 18) & 7] * invScale;
        rotated[i + 7] = centroids[(packed >>> 21) & 7] * invScale;
      }
      return byteOffset;
    }
    for (let i = 0; i < d; i += 4) {
      const packed = source[byteOffset++];
      rotated[i] = centroids[packed & 3] * invScale;
      rotated[i + 1] = centroids[(packed >>> 2) & 3] * invScale;
      rotated[i + 2] = centroids[(packed >>> 4) & 3] * invScale;
      rotated[i + 3] = centroids[(packed >>> 6) & 3] * invScale;
    }
    return byteOffset;
  }

  private assertPacket(packet: TurboQuantPacket, expectedLength: number): void {
    if (
      packet.length !== expectedLength || packet.blockSize !== this.blockSize || packet.bits !== this.bits ||
      packet.rotation !== this.rotation || packet.seed !== this.seed || packet.centered !== this.centered
    ) {
      throw new Error('TurboQuant packet parameters do not match this codec instance.');
    }
    const blocks = Math.ceil(packet.length / this.blockSize);
    if (packet.norms.length < blocks || (this.centered && packet.means.length < blocks)) {
      throw new Error('TurboQuant packet metadata is truncated.');
    }
    const expectedCodeBytes = Math.ceil((blocks * this.blockSize * this.bits) / 8);
    if (packet.codes.byteLength < expectedCodeBytes) throw new Error('TurboQuant packet code stream is truncated.');
  }

  private rotateForward(input: Float32Array, output: Float32Array): void {
    const d = this.blockSize;
    if (this.rotation === 'dense') {
      const matrix = this.denseMatrix!;
      for (let row = 0; row < d; row++) {
        const base = row * d;
        let sum = 0;
        for (let col = 0; col < d; col++) sum += matrix[base + col] * input[col];
        output[row] = sum;
      }
      return;
    }

    const signsA = this.signsA!;
    const signsB = this.signsB!;
    const permutation = this.permutation!;
    for (let i = 0; i < d; i++) output[i] = input[i] * signsA[i];
    fwhtNormalized(output, d);
    const temp = this.blockA;
    for (let i = 0; i < d; i++) temp[i] = output[permutation[i]] * signsB[i];
    fwhtNormalized(temp, d);
    output.set(temp);
  }

  private rotateInverse(input: Float32Array, output: Float32Array): void {
    const d = this.blockSize;
    if (this.rotation === 'dense') {
      const matrix = this.denseMatrix!;
      for (let col = 0; col < d; col++) {
        let sum = 0;
        for (let row = 0; row < d; row++) sum += matrix[row * d + col] * input[row];
        output[col] = sum;
      }
      return;
    }

    const signsA = this.signsA!;
    const signsB = this.signsB!;
    const permutation = this.permutation!;
    output.set(input);
    fwhtNormalized(output, d);
    const temp = this.blockB;
    temp.fill(0);
    for (let i = 0; i < d; i++) temp[permutation[i]] = output[i] * signsB[i];
    fwhtNormalized(temp, d);
    for (let i = 0; i < d; i++) output[i] = temp[i] * signsA[i];
  }
}

/** Stateful predictive transport. Encoder and decoder must start from the same reference. */
export class TurboQuantDeltaStream {
  readonly codec: TurboQuantCodec;
  readonly reference: Float32Array;
  readonly reconstruction: Float32Array;
  readonly packet: TurboQuantPacket;

  constructor(length: number, options: TurboQuantOptions = {}, initial?: Float32Array) {
    this.codec = new TurboQuantCodec(options);
    this.reference = new Float32Array(length);
    this.reconstruction = new Float32Array(length);
    if (initial) this.reference.set(initial.subarray(0, length));
    this.reconstruction.set(this.reference);
    this.packet = this.codec.createPacket(length);
  }

  encodeFrame(source: Float32Array): TurboQuantPacket {
    // Keep the encoder reference synchronized with exactly what a decoder
    // receives without unpacking the just-written code stream a second time.
    this.codec.encodeIntoAndReconstruct(source, this.packet, this.reconstruction, this.reference);
    this.reference.set(this.reconstruction);
    return this.packet;
  }

  decodeFrame(packet: TurboQuantPacket, output = this.reconstruction): Float32Array {
    this.codec.decodeInto(packet, output, this.reference);
    this.reference.set(output);
    return output;
  }

  reset(reference?: Float32Array): void {
    this.reference.fill(0);
    if (reference) this.reference.set(reference.subarray(0, this.reference.length));
    this.reconstruction.set(this.reference);
  }
}

export function turboQuantError(reference: Float32Array, reconstructed: Float32Array): {
  mse: number;
  rmse: number;
  relativeL2: number;
  maxAbs: number;
} {
  const count = Math.min(reference.length, reconstructed.length);
  if (count === 0) return { mse: 0, rmse: 0, relativeL2: 0, maxAbs: 0 };
  let error2 = 0;
  let reference2 = 0;
  let maxAbs = 0;
  for (let i = 0; i < count; i++) {
    const delta = reconstructed[i] - reference[i];
    const abs = Math.abs(delta);
    if (abs > maxAbs) maxAbs = abs;
    error2 += delta * delta;
    reference2 += reference[i] * reference[i];
  }
  const mse = error2 / count;
  return {
    mse,
    rmse: Math.sqrt(mse),
    relativeL2: Math.sqrt(error2 / Math.max(1e-30, reference2)),
    maxAbs,
  };
}
