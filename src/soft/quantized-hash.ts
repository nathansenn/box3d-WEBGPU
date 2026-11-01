/** Sentinels folded in for values the old quantizer silently collapsed (NaN became 0, overflow wrapped). */
const NAN_WORD = 0x7fc00001 | 0;
const POS_SAT = 0x7fffffff | 0;
const NEG_SAT = 0x80000000 | 0;

/** Bit-identical to the legacy `Math.trunc(v*scale)|0` for finite in-range values; NaN and overflow get distinct words. */
export function quantizeWord(value: number, scale: number): number {
  const scaled = value * scale;
  if (scaled !== scaled) return NAN_WORD;
  if (scaled >= 2147483647) return POS_SAT;
  if (scaled <= -2147483648) return NEG_SAT;
  return Math.trunc(scaled) | 0;
}

export function quantizedHash(values: ArrayLike<number>, scale: number, count = values.length, seed = 2166136261): number {
  let hash = seed >>> 0;
  const safeCount = Math.min(count, values.length);
  for (let i = 0; i < safeCount; i++) {
    const q = quantizeWord(values[i], scale);
    hash ^= q & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (q >>> 8) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (q >>> 16) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
    hash ^= (q >>> 24) & 0xff; hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}
