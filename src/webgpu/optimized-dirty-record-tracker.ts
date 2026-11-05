/**
 * Opt-in producer-owned alternatives to the Round 5 dirty tracker.
 *
 * These algorithms do not discover changes: mark EVERY modified record or range.
 * They do not enable an upload policy, infer changes from a camera, or change
 * simulation state. A full result means that the complete stream must be sent.
 * Results structurally satisfy DirtyRecordTrackingResult from PR #12.
 */
export type DirtyTrackingHypothesis =
  | 'touched-words'
  | 'touched-tiles'
  | 'epoch-words'
  | 'range-union'
  | 'locality-gated';

export type ProducerLocality = 'localized' | 'scattered' | 'dense' | 'unknown';
export type OptimizedDirtyRecordOptions = Readonly<{
  /** A performance hint, NEVER a claim that an unmarked record is unchanged. */
  locality?: ProducerLocality;
  /** Range-union abandons metadata above this bounded number of disjoint spans. */
  maxRanges?: number;
}>;
export type OptimizedDirtyRecordResult = Readonly<{
  /** Borrowed storage, invalidated by begin(). Copy before retaining it. */
  spans: readonly Readonly<{ start: number; count: number }>[];
  dirtyCount: number | null;
  countedDirtyRecords: number;
  coverageUpperBound: number;
  full: boolean;
}>;
export type OptimizedDirtyRecordTracker = Readonly<{
  /** Discards any unfinished frame; the locality hint is fixed at construction. */
  begin(): void;
  mark(index: number): void;
  /** The producer certifies that every record in this valid range may have changed. */
  markRange(start: number, count: number): void;
  /** Idempotent until begin(); all marks, including empty ones, then require begin(). */
  finish(): OptimizedDirtyRecordResult;
}>;

type Span = { start: number; count: number };
const METHODS: readonly DirtyTrackingHypothesis[] = [
  'touched-words', 'touched-tiles', 'epoch-words', 'range-union', 'locality-gated',
];
const LOCALITIES: readonly ProducerLocality[] = ['localized', 'scattered', 'dense', 'unknown'];

export function createOptimizedDirtyRecordTracker(
  recordCount: number,
  hypothesis: DirtyTrackingHypothesis,
  options: OptimizedDirtyRecordOptions = {},
): OptimizedDirtyRecordTracker {
  if (!Number.isSafeInteger(recordCount) || recordCount < 0 || recordCount > 0xffff_ffff) {
    throw new RangeError('recordCount must be an integer between 0 and 4294967295');
  }
  if (!METHODS.includes(hypothesis)) throw new RangeError('Unknown dirty tracking hypothesis');
  const locality = options.locality ?? 'unknown';
  const maxRanges = options.maxRanges ?? 64;
  if (!LOCALITIES.includes(locality)) throw new RangeError('Unknown producer locality');
  if (!Number.isSafeInteger(maxRanges) || maxRanges < 1 || maxRanges > 65536) {
    throw new RangeError('maxRanges must be an integer between 1 and 65536');
  }
  // Unknown/native, scattered, and dense producers are deliberately NOT promoted.
  // No mark still means no changes; the first nonempty valid mark requests full.
  const bypass = hypothesis === 'locality-gated' && locality !== 'localized';
  const rangeMode = hypothesis === 'range-union';
  const tileMode = hypothesis === 'touched-tiles' || hypothesis === 'locality-gated';
  const wordCount = Math.ceil(recordCount / 32);
  const bitmap = !bypass && !rangeMode ? new Uint32Array(wordCount) : null;
  const epochs = hypothesis === 'epoch-words' ? new Uint32Array(wordCount) : null;
  const touched: number[] = [];
  const spans: Span[] = [];
  let generation = 1;
  let unique = 0;
  let full = false;
  let finished: OptimizedDirtyRecordResult | null = null;

  function begin(): void {
    if (epochs) {
      generation = (generation + 1) >>> 0;
      if (generation === 0) {
        epochs.fill(0);
        generation = 1;
      }
    } else if (bitmap) {
      for (let i = 0; i < touched.length; i++) bitmap[touched[i]] = 0;
    }
    touched.length = 0;
    spans.length = 0;
    unique = 0;
    full = false;
    finished = null;
  }

  function mutable(): void {
    if (finished !== null) throw new Error('begin() is required before marking a finished frame');
  }
  function validRange(start: number, count: number): void {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 ||
        count < 0 || start > recordCount || count > recordCount - start) {
      throw new RangeError('Dirty range lies outside the producer stream');
    }
  }
  function popcount(word: number): number {
    word = word - ((word >>> 1) & 0x55555555);
    word = (word & 0x33333333) + ((word >>> 2) & 0x33333333);
    return Math.imul((word + (word >>> 4)) & 0x0f0f0f0f, 0x01010101) >>> 24;
  }
  function addWord(index: number, mask: number): void {
    let previous = bitmap![index];
    if (epochs && epochs[index] !== generation) {
      epochs[index] = generation;
      previous = 0;
    }
    const next = (previous | mask) >>> 0;
    if (next === previous) return;
    if (previous === 0) touched.push(index);
    unique += popcount((next ^ previous) >>> 0);
    bitmap![index] = next;
  }
  function union(start: number, count: number): void {
    let end = start + count;
    let first = 0;
    // Adjacency coalesces without sorting or allocating one object per record.
    while (first < spans.length && spans[first].start + spans[first].count < start) first++;
    let last = first;
    while (last < spans.length && spans[last].start <= end) {
      start = Math.min(start, spans[last].start);
      end = Math.max(end, spans[last].start + spans[last].count);
      unique -= spans[last].count;
      last++;
    }
    unique += end - start;
    spans.splice(first, last - first, { start, count: end - start });
    if (spans.length > maxRanges) {
      // unique is now only a lower bound; every subsequent input is still validated.
      full = true;
      spans.length = 0;
    }
  }
  function markRange(start: number, count: number): void {
    validRange(start, count);
    mutable();
    if (count === 0 || full) return;
    if (bypass) { full = true; unique = count; return; }
    if (rangeMode) { union(start, count); return; }
    const end = start + count;
    const first = Math.floor(start / 32);
    const last = Math.floor((end - 1) / 32);
    for (let word = first; word <= last; word++) {
      const low = word === first ? start % 32 : 0;
      const high = word === last ? (end - 1) % 32 + 1 : 32;
      // JavaScript shifts mask the count modulo 32: explicitly handle full words.
      const left = (0xffff_ffff << low) >>> 0;
      const right = high === 32 ? 0xffff_ffff : (0xffff_ffff >>> (32 - high));
      addWord(word, (left & right) >>> 0);
    }
  }
  function mark(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= recordCount) {
      throw new RangeError('Dirty index lies outside the producer stream');
    }
    mutable();
    if (full) return;
    if (bypass) { full = true; unique = 1; return; }
    if (rangeMode) { union(index, 1); return; }
    addWord(Math.floor(index / 32), (1 << (index % 32)) >>> 0);
  }
  function append(start: number, count: number): void {
    const last = spans[spans.length - 1];
    if (last && last.start + last.count === start) last.count += count;
    else spans.push({ start, count });
  }
  function finish(): OptimizedDirtyRecordResult {
    if (finished !== null) return finished;
    let coverage = full ? recordCount : unique;
    if (full) spans.length = 0;
    else if (bitmap) {
      // Only dirty words are visited. Sorting these indices retains deterministic
      // ascending spans even when producer marks arrive out of order.
      touched.sort((a, b) => a - b);
      coverage = 0;
      for (let i = 0; i < touched.length; i++) {
        const index = touched[i];
        let word = bitmap[index];
        const base = index * 32;
        if (tileMode) {
          const count = Math.min(32, recordCount - base);
          append(base, count);
          coverage += count;
        } else {
          while (word !== 0) {
            const bit = 31 - Math.clz32(word & -word);
            append(base + bit, 1);
            word = (word & (word - 1)) >>> 0;
          }
        }
      }
      if (!tileMode) coverage = unique;
    }
    finished = { spans, dirtyCount: full ? null : unique, countedDirtyRecords: unique,
      coverageUpperBound: coverage, full };
    return finished;
  }
  return { begin, mark, markRange, finish };
}
