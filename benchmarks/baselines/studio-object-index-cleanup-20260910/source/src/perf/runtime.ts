/** Allocation-free performance primitives shared by simulation and rendering hot paths. */
export function nextCapacity(current: number, required: number, minimum = 16): number {
  let capacity = Math.max(minimum, current | 0);
  while (capacity < required) capacity = capacity < 1_048_576 ? capacity << 1 : Math.ceil(capacity * 1.5);
  return capacity;
}

export class NumericArena {
  private f32Store = new Float32Array(0);
  private u32Store = new Uint32Array(0);
  private f32Offset = 0;
  private u32Offset = 0;
  reset(): void { this.f32Offset = 0; this.u32Offset = 0; }
  f32(length: number): Float32Array {
    const end = this.f32Offset + length;
    if (end > this.f32Store.length) {
      const next = new Float32Array(nextCapacity(this.f32Store.length, end, 1024));
      next.set(this.f32Store); this.f32Store = next;
    }
    const view = this.f32Store.subarray(this.f32Offset, end); this.f32Offset = end; return view;
  }
  u32(length: number): Uint32Array {
    const end = this.u32Offset + length;
    if (end > this.u32Store.length) {
      const next = new Uint32Array(nextCapacity(this.u32Store.length, end, 1024));
      next.set(this.u32Store); this.u32Store = next;
    }
    const view = this.u32Store.subarray(this.u32Offset, end); this.u32Offset = end; return view;
  }
}

export class FixedRing<T> {
  private readonly values: Array<T | undefined>;
  private head = 0;
  private countValue = 0;
  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity <= 0) throw new RangeError('capacity must be positive');
    this.values = new Array<T | undefined>(capacity);
  }
  get size(): number { return this.countValue; }
  push(value: T): void { this.values[this.head] = value; this.head = (this.head + 1) % this.capacity; this.countValue = Math.min(this.capacity, this.countValue + 1); }
  atFromNewest(offset: number): T | undefined {
    if (offset < 0 || offset >= this.countValue) return undefined;
    return this.values[(this.head - 1 - offset + this.capacity) % this.capacity];
  }
  clear(): void { this.values.fill(undefined); this.head = 0; this.countValue = 0; }
}

export class FrameBudgetGovernor {
  private ema = 0;
  private over = 0;
  private under = 0;
  constructor(readonly targetMs = 16.667, readonly alpha = 0.08) {}
  sample(frameMs: number): -1 | 0 | 1 {
    if (!Number.isFinite(frameMs) || frameMs < 0) return 0;
    this.ema = this.ema === 0 ? frameMs : this.ema + (frameMs - this.ema) * this.alpha;
    if (this.ema > this.targetMs * 1.08) { this.over++; this.under = 0; if (this.over >= 12) { this.over = 0; return -1; } }
    else if (this.ema < this.targetMs * 0.72) { this.under++; this.over = 0; if (this.under >= 120) { this.under = 0; return 1; } }
    else { this.over = 0; this.under = 0; }
    return 0;
  }
  get averageMs(): number { return this.ema; }
}

export const fastLength2 = (x: number, y: number): number => Math.sqrt(x * x + y * y);
export const fastLength3 = (x: number, y: number, z: number): number => Math.sqrt(x * x + y * y + z * z);
export const clampFast = (v: number, lo: number, hi: number): number => v < lo ? lo : v > hi ? hi : v;
