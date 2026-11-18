/** Optional GPU timestamps. No queue-wide wait and no allocation when the ring is full. */
const MAX_CONSECUTIVE_INVALID_SAMPLES = 8;
class InvalidTimestampPairError extends Error {}

export type GpuPassName = 'compute' | 'shadow' | 'main' | 'post';
export type GpuTimingStatus = 'disabled' | 'unsupported' | 'ready' | 'error' | 'disposed';

export interface GpuTimingOptions {
  enabled?: boolean;
  /** Sample the first frame and then every Nth frame. Default: 30. */
  sampleEveryFrames?: number;
  /** Bounded to 1..8 slots. Default: 3. */
  ringSize?: number;
}

export interface GpuTimingResult {
  readonly frameId: number;
  readonly sampledAtMs: number;
  readonly completedAtMs: number;
  /** An absent pass is null. Zero is possible for a real quantized timestamp pair. */
  readonly passMs: Readonly<Record<GpuPassName, number | null>>;
  /** Sum of measured passes; excludes gaps, uploads and presentation. */
  readonly totalPassMs: number;
}

export interface GpuTimingInfo {
  readonly status: GpuTimingStatus;
  readonly supported: boolean;
  readonly reason: string | null;
  readonly latest: GpuTimingResult | null;
  readonly frames: number;
  readonly submittedSamples: number;
  readonly completedSamples: number;
  readonly droppedSamples: number;
  readonly failedSamples: number;
  readonly pendingSamples: number;
  readonly ringSize: number;
  readonly sampleEveryFrames: number;
}

// Keep the compatibility surface local: the project's minimal WebGPU ambient
// declarations intentionally omit the optional query/mapping APIs.
interface QuerySet { destroy(): void; }
interface ReadbackBuffer extends GPUBuffer {
  mapAsync(mode: number, offset?: number, size?: number): Promise<void>;
  getMappedRange(offset?: number, size?: number): ArrayBuffer;
  unmap(): void;
}
interface TimingDevice extends GPUDevice {
  readonly features?: ReadonlySet<string>;
  readonly lost?: Promise<{ reason: string; message: string }>;
  createQuerySet?: (descriptor: { label: string; type: 'timestamp'; count: number }) => QuerySet;
}
interface TimingEncoder extends GPUCommandEncoder {
  resolveQuerySet(querySet: QuerySet, first: number, count: number, destination: GPUBuffer, offset: number): void;
  copyBufferToBuffer(source: GPUBuffer, sourceOffset: number, destination: GPUBuffer, destinationOffset: number, size: number): void;
}
export interface GpuPassTimestampWrites {
  readonly querySet: QuerySet;
  readonly beginningOfPassWriteIndex: number;
  readonly endOfPassWriteIndex: number;
}
export interface GpuTimingFrame {
  readonly slotIndex: number;
  readonly frameId: number;
}
interface Slot {
  querySet: QuerySet;
  resolve: GPUBuffer;
  readback: ReadbackBuffer;
  writes: Record<GpuPassName, GpuPassTimestampWrites>;
  token: GpuTimingFrame | null;
  state: 'free' | 'encoding' | 'resolved' | 'reading';
  passMask: number;
  sampledAtMs: number;
}

const PASSES: readonly GpuPassName[] = ['compute', 'shadow', 'main', 'post'];
const QUERY_COUNT = PASSES.length * 2;
const RESULT_BYTES = QUERY_COUNT * BigUint64Array.BYTES_PER_ELEMENT;
const MAP_READ = 0x0001;
const boundedInteger = (value: number | undefined, fallback: number, maximum: number): number =>
  Number.isFinite(value) ? Math.min(maximum, Math.max(1, Math.floor(value!))) : fallback;
const errorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

export class GpuPassTimer {
  private status: GpuTimingStatus;
  private readonly supported: boolean;
  private reason: string | null;
  private readonly slots: Slot[] = [];
  private readonly ringSize: number;
  private readonly sampleEveryFrames: number;
  private latest: GpuTimingResult | null = null;
  private frames = 0;
  private submittedSamples = 0;
  private completedSamples = 0;
  private droppedSamples = 0;
  private failedSamples = 0;
  private consecutiveInvalidSamples = 0;
  private nextSlot = 0;

  constructor(device: GPUDevice, options: GpuTimingOptions = {}) {
    const timingDevice = device as TimingDevice;
    this.ringSize = boundedInteger(options.ringSize, 3, 8);
    this.sampleEveryFrames = boundedInteger(options.sampleEveryFrames, 30, 600);
    this.supported = !!timingDevice.features?.has('timestamp-query') && typeof timingDevice.createQuerySet === 'function';
    this.status = options.enabled === false ? 'disabled' : this.supported ? 'ready' : 'unsupported';
    this.reason = this.status === 'disabled' ? 'GPU timing was disabled.'
      : this.status === 'unsupported' ? 'The device does not expose timestamp-query.' : null;
    if (this.status !== 'ready') return;

    const allocated: Array<{ destroy(): void }> = [];
    try {
      for (let index = 0; index < this.ringSize; index++) {
        const querySet = timingDevice.createQuerySet!({ label: `AAA timing queries ${index}`, type: 'timestamp', count: QUERY_COUNT });
        allocated.push(querySet);
        const resolve = device.createBuffer({ label: `AAA timing resolve ${index}`, size: RESULT_BYTES, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
        allocated.push(resolve);
        const readback = device.createBuffer({ label: `AAA timing readback ${index}`, size: RESULT_BYTES, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }) as ReadbackBuffer;
        allocated.push(readback);
        if (typeof readback.mapAsync !== 'function' || typeof readback.getMappedRange !== 'function' || typeof readback.unmap !== 'function') {
          throw new Error('Timestamp readback mapping is unavailable.');
        }
        const writes = Object.fromEntries(PASSES.map((name, pass) => [name, Object.freeze({ querySet, beginningOfPassWriteIndex: pass * 2, endOfPassWriteIndex: pass * 2 + 1 })])) as Record<GpuPassName, GpuPassTimestampWrites>;
        this.slots.push({ querySet, resolve, readback, writes, token: null, state: 'free', passMask: 0, sampledAtMs: 0 });
      }
    } catch (error) {
      for (const resource of allocated) {
        try { resource.destroy(); } catch { /* Continue releasing the remaining allocation. */ }
      }
      this.slots.length = 0;
      this.fail(error);
    }
    void timingDevice.lost?.then(
      (info) => this.fail(new Error(`GPU device lost (${info.reason}): ${info.message}`)),
      (error: unknown) => this.fail(error),
    );
  }

  beginFrame(): GpuTimingFrame | null {
    if (this.status === 'disposed') return null;
    const frameId = ++this.frames;
    if (this.status !== 'ready' || (frameId - 1) % this.sampleEveryFrames !== 0) return null;
    for (let offset = 0; offset < this.slots.length; offset++) {
      const slotIndex = (this.nextSlot + offset) % this.slots.length;
      const slot = this.slots[slotIndex]!;
      if (slot.state !== 'free') continue;
      const token = Object.freeze({ slotIndex, frameId });
      slot.token = token;
      slot.state = 'encoding';
      slot.passMask = 0;
      slot.sampledAtMs = performance.now();
      this.nextSlot = (slotIndex + 1) % this.slots.length;
      return token;
    }
    this.droppedSamples++;
    return null;
  }

  timestampWrites(frame: GpuTimingFrame | null, pass: GpuPassName): GpuPassTimestampWrites | undefined {
    const slot = this.slotFor(frame);
    if (!slot || slot.state !== 'encoding') return undefined;
    slot.passMask |= 1 << PASSES.indexOf(pass);
    return slot.writes[pass];
  }

  resolveFrame(encoder: GPUCommandEncoder, frame: GpuTimingFrame | null): void {
    const slot = this.slotFor(frame);
    if (!slot || slot.state !== 'encoding') return;
    if (!slot.passMask) { this.discardFrame(frame); return; }
    try {
      const timingEncoder = encoder as TimingEncoder;
      // Resolving unwritten queries is legal. Their values are never published:
      // passMask selects only passes encoded in this frame, even on slot reuse.
      timingEncoder.resolveQuerySet(slot.querySet, 0, QUERY_COUNT, slot.resolve, 0);
      timingEncoder.copyBufferToBuffer(slot.resolve, 0, slot.readback, 0, RESULT_BYTES);
      slot.state = 'resolved';
    } catch (error) {
      this.fail(error);
      this.discardFrame(frame);
    }
  }

  /** Call immediately after queue.submit. Mapping waits only on this slot's copy. */
  submitFrame(frame: GpuTimingFrame | null): void {
    const slot = this.slotFor(frame);
    if (!slot || slot.state !== 'resolved') return;
    slot.state = 'reading';
    this.submittedSamples++;
    try {
      void slot.readback.mapAsync(MAP_READ, 0, RESULT_BYTES).then(
        () => this.readResult(slot, frame!),
        (error: unknown) => {
          if (this.status !== 'disposed' && slot.token === frame) {
            this.fail(error);
            this.releaseSlot(slot);
          }
        },
      );
    } catch (error) {
      this.fail(error);
      this.releaseSlot(slot);
    }
  }

  /** Release a frame whose encoder was abandoned before submission. */
  discardFrame(frame: GpuTimingFrame | null): void {
    const slot = this.slotFor(frame);
    if (slot && slot.state !== 'reading') this.releaseSlot(slot);
  }

  info(): GpuTimingInfo {
    return {
      status: this.status, supported: this.supported, reason: this.reason, latest: this.latest,
      frames: this.frames, submittedSamples: this.submittedSamples, completedSamples: this.completedSamples,
      droppedSamples: this.droppedSamples, failedSamples: this.failedSamples,
      pendingSamples: this.slots.filter((slot) => slot.state !== 'free').length,
      ringSize: this.ringSize, sampleEveryFrames: this.sampleEveryFrames,
    };
  }

  dispose(): void {
    if (this.status === 'disposed') return;
    this.status = 'disposed';
    this.reason = 'GPU timing was disposed.';
    this.latest = null;
    for (const slot of this.slots) {
      // Clear tokens before canceling maps: both a late resolution and an
      // AbortError from destroy must leave diagnostics and counters untouched.
      this.releaseSlot(slot);
      try { slot.readback.unmap(); } catch { /* Already unmapped/lost. */ }
      for (const resource of [slot.querySet, slot.resolve, slot.readback]) {
        try { resource.destroy(); } catch { /* Release every slot after device loss. */ }
      }
    }
    this.slots.length = 0;
  }

  private slotFor(frame: GpuTimingFrame | null): Slot | undefined {
    if (!frame || this.status === 'disposed') return undefined;
    const slot = this.slots[frame.slotIndex];
    return slot?.token === frame ? slot : undefined;
  }

  private releaseSlot(slot: Slot): void {
    slot.token = null;
    slot.state = 'free';
    slot.passMask = 0;
  }

  private fail(error: unknown): void {
    if (this.status === 'disposed') return;
    this.status = 'error';
    this.reason = errorMessage(error);
    this.failedSamples++;
  }

  private readResult(slot: Slot, frame: GpuTimingFrame): void {
    if (this.status === 'disposed' || slot.token !== frame) return;
    try {
      if (this.status !== 'ready') return;
      const values = new BigUint64Array(slot.readback.getMappedRange(0, RESULT_BYTES));
      const passMs: Record<GpuPassName, number | null> = { compute: null, shadow: null, main: null, post: null };
      let totalPassMs = 0;
      for (let index = 0; index < PASSES.length; index++) {
        if (!(slot.passMask & (1 << index))) continue;
        const start = values[index * 2];
        const end = values[index * 2 + 1];
        if (start === undefined || end === undefined || (start === 0n && end === 0n) || end < start || end - start > BigInt(Number.MAX_SAFE_INTEGER)) {
          throw new InvalidTimestampPairError(`Invalid GPU timestamp pair for ${PASSES[index]} in frame ${frame.frameId}: ${start} -> ${end}.`);
        }
        const milliseconds = Number(end - start) / 1e6;
        passMs[PASSES[index]!] = milliseconds;
        totalPassMs += milliseconds;
      }
      const result = Object.freeze({ frameId: frame.frameId, sampledAtMs: slot.sampledAtMs, completedAtMs: performance.now(), passMs: Object.freeze(passMs), totalPassMs });
      this.completedSamples++;
      this.consecutiveInvalidSamples = 0;
      // WebGPU promises can settle out of order. Never replace a newer sample.
      if (!this.latest || frame.frameId > this.latest.frameId) this.latest = result;
    } catch (error) {
      // One bad timestamp pair (driver glitch, counter wrap) is dropped; only a
      // run of them disables timing.
      if (error instanceof InvalidTimestampPairError && ++this.consecutiveInvalidSamples < MAX_CONSECUTIVE_INVALID_SAMPLES) {
        this.failedSamples++;
      } else {
        this.fail(error);
      }
    } finally {
      try { slot.readback.unmap(); } catch (error) { this.fail(error); }
      this.releaseSlot(slot);
    }
  }
}
