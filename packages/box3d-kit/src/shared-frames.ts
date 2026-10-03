/**
 * Lock-free frame channel over a SharedArrayBuffer (seqlock). A worker
 * publishes transforms; the main thread copies the latest complete frame
 * whenever it renders, with no postMessage, allocation or waiting per frame.
 *
 * Requires SharedArrayBuffer: cross-origin isolated pages (COOP/COEP) in
 * browsers, always available in Node worker_threads.
 */
const HEADER_INTS = 8; // seq, count, colorRevision, capacity, reserved…
const SEQ = 0, COUNT = 1, COLOR_REV = 2, CAPACITY = 3;

export function sharedMemoryAvailable(): boolean {
  const g = globalThis as {SharedArrayBuffer?: unknown; crossOriginIsolated?: boolean};
  return typeof g.SharedArrayBuffer === 'function' && g.crossOriginIsolated !== false;
}

function layout(buffer: SharedArrayBuffer, capacity: number) {
  const header = new Int32Array(buffer, 0, HEADER_INTS);
  const matrices = new Float32Array(buffer, HEADER_INTS * 4, capacity * 16);
  const colors = new Float32Array(buffer, HEADER_INTS * 4 + capacity * 64, capacity * 4);
  return {header, matrices, colors};
}

export class SharedFrameWriter {
  readonly buffer: SharedArrayBuffer;
  readonly capacity: number;
  private readonly view: ReturnType<typeof layout>;
  private colorVersion = -1;
  private colorCount = -1;

  constructor(capacity: number) {
    this.capacity = capacity;
    this.buffer = new SharedArrayBuffer(HEADER_INTS * 4 + capacity * 80);
    this.view = layout(this.buffer, capacity);
    this.view.header[CAPACITY] = capacity;
  }

  /** Publish one complete frame. Rows beyond capacity are dropped. */
  publish(matrices: Float32Array, count: number, colors: Float32Array, colorVersion: number): void {
    const {header} = this.view, n = Math.min(count, this.capacity);
    Atomics.add(header, SEQ, 1); // odd: writing
    this.view.matrices.set(matrices.subarray(0, n * 16));
    if (colorVersion !== this.colorVersion || n !== this.colorCount) {
      this.view.colors.set(colors.subarray(0, n * 4));
      this.colorVersion = colorVersion;
      this.colorCount = n;
      header[COLOR_REV]++;
    }
    header[COUNT] = n;
    Atomics.add(header, SEQ, 1); // even: complete
  }
}

export class SharedFrameReader {
  private readonly view: ReturnType<typeof layout>;
  readonly capacity: number;
  private seen = 0;
  private colorSeen = -1;
  count = 0;
  /** Private copies: stable while you render, independent of the writer. */
  readonly matrices: Float32Array;
  readonly colors: Float32Array;
  /** Number of the newest frame copied, as published by the writer (skipped frames count too). */
  revision = 0;
  colorRevision = 0;

  constructor(buffer: SharedArrayBuffer) {
    this.capacity = new Int32Array(buffer, 0, HEADER_INTS)[CAPACITY];
    this.view = layout(buffer, this.capacity);
    this.matrices = new Float32Array(this.capacity * 16);
    this.colors = new Float32Array(this.capacity * 4);
  }

  /** Copy the newest complete frame if there is one. Returns true when it changed. */
  poll(): boolean {
    const {header} = this.view;
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = Atomics.load(header, SEQ);
      if (before === this.seen) return false;
      if (before & 1) continue; // writer mid-frame; retry
      const count = header[COUNT], colorRev = header[COLOR_REV];
      this.matrices.set(this.view.matrices.subarray(0, count * 16));
      const colorsChanged = colorRev !== this.colorSeen;
      if (colorsChanged) this.colors.set(this.view.colors.subarray(0, count * 4));
      if (Atomics.load(header, SEQ) !== before) continue; // torn: the writer moved on, retry
      this.seen = before;
      this.count = count;
      this.revision = before >>> 1;
      if (colorsChanged) { this.colorSeen = colorRev; this.colorRevision = colorRev; }
      return true;
    }
    return false; // writer is very busy; keep the previous complete frame
  }
}
