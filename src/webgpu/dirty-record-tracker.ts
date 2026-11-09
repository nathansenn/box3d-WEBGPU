import type { DirtyRecordSpan } from './sparse-upload';

/** Experimental producer-owned strategies. Callers explicitly select a mode. */
export type DirtyTrackingMode = 'ranges' | 'bitset' | 'index-list' | 'tile-32' | 'dense-bypass';

export type DirtyRecordTrackerOptions = Readonly<{
  /**
   * 'ranges' only, and rejected by other modes. When a frame's merged spans form more
   * than this many disjoint runs, finish() reports a full result. A positive safe
   * integer; omit it for no cap.
   */
  maxRanges?: number;
}>;

export type DirtyRecordTrackingResult = Readonly<{
  /**
   * Borrowed storage: copy these spans before the next begin() if retaining them.
   * When full is true this is one span covering every record, never an empty list,
   * so passing it on as upload evidence can't be read as "nothing changed".
   */
  spans: readonly DirtyRecordSpan[];
  /** Exact unique marked records, or null when full is true. */
  dirtyCount: number | null;
  /**
   * Exact count when dirtyCount is known. When full is true it is a lower bound:
   * floor(recordCount / 4) + 1 for dense-bypass, the merged count for capped 'ranges'.
   */
  countedDirtyRecords: number;
  /** Records covered by the spans, or recordCount when full is true. */
  coverageUpperBound: number;
  /**
   * Metadata was abandoned (dense-bypass passed 25%, or 'ranges' passed maxRanges):
   * the caller must upload the complete record buffer.
   */
  full: boolean;
}>;

export type DirtyRecordTracker = Readonly<{
  /** Start a new frame, discarding any unfinished frame and invalidating borrowed spans. */
  begin(): void;
  /** Mark every modified record. Duplicate marks are valid; invalid indices throw. */
  mark(index: number): void;
  /**
   * Mark records [start, start + count) as if each were passed to mark(). Overlaps are
   * valid and count 0 does nothing, but a range that doesn't fit in [0, recordCount]
   * still throws RangeError, and a finished frame still requires begin().
   */
  markRange(start: number, count: number): void;
  /** Finish the current frame. Idempotent until begin(); marking then requires begin(). */
  finish(): DirtyRecordTrackingResult;
}>;

type MutableSpan = { start: number; count: number };

function popcount32(word: number): number {
  word -= (word >>> 1) & 0x5555_5555;
  word = (word & 0x3333_3333) + ((word >>> 2) & 0x3333_3333);
  return Math.imul((word + (word >>> 4)) & 0x0f0f_0f0f, 0x0101_0101) >>> 24;
}

/**
 * Track producer writes without comparing record contents. Construction starts an empty
 * frame. Results include every marked record, sorted into disjoint contiguous spans;
 * tile-32 may also cover unchanged records. No strategy is enabled by the renderer.
 *
 * Each tracker owns its working storage. Use separate trackers for separate buffers.
 * finish() borrows its spans until begin(); scalar result fields remain snapshots.
 * dense-bypass drops metadata after more than 25% of records have been marked and
 * stops counting at floor(recordCount / 4) + 1. 'ranges' with options.maxRanges drops
 * it in finish() when the merged spans form more than maxRanges disjoint runs; the cap
 * applies to the merged result, so it doesn't depend on the order of the marks.
 * full=true therefore has dirtyCount=null.
 *
 * markRange() marks a contiguous block in one call: 'ranges' stores one span, the
 * bitmap modes set whole 32-bit words, and 'index-list' still visits every record.
 */
export function createDirtyRecordTracker(
  recordCount: number,
  mode: DirtyTrackingMode,
  options?: DirtyRecordTrackerOptions,
): DirtyRecordTracker {
  if (!Number.isSafeInteger(recordCount) || recordCount < 0 || recordCount > 0xffff_ffff) {
    throw new RangeError('recordCount must be an integer between 0 and 4294967295');
  }
  if (!['ranges', 'bitset', 'index-list', 'tile-32', 'dense-bypass'].includes(mode)) {
    throw new RangeError(`Unknown dirty tracking mode: ${String(mode)}`);
  }
  // Reject anything a mode wouldn't use, so an option is never silently ignored.
  if (options !== undefined) {
    if (options === null || typeof options !== 'object') throw new RangeError('options must be an object');
    for (const key of Object.keys(options)) {
      if (key !== 'maxRanges') throw new RangeError(`Unknown dirty tracking option: ${key}`);
    }
  }
  const maxRanges = options?.maxRanges;
  if (maxRanges !== undefined) {
    if (mode !== 'ranges') throw new RangeError(`maxRanges applies only to 'ranges' mode, not '${mode}'`);
    if (!Number.isSafeInteger(maxRanges) || maxRanges < 1) {
      throw new RangeError('maxRanges must be a positive safe integer');
    }
  }

  const spans: MutableSpan[] = [];
  const indices: number[] = [];
  const bitmap = mode === 'bitset' || mode === 'tile-32' || mode === 'dense-bypass'
    ? new Uint32Array(Math.ceil(recordCount / 32)) : null;
  // A word is listed once per frame, when it first becomes nonzero, so this never overflows.
  const touchedWords = bitmap ? new Uint32Array(bitmap.length) : null;
  let touchedWordCount = 0;
  const tags = mode === 'index-list' ? new Uint32Array(recordCount) : null;
  const bypassThreshold = Math.floor(recordCount / 4);
  let generation = 1;
  let uniqueCount = 0;
  let full = false;
  let finished: DirtyRecordTrackingResult | null = null;

  function appendSpan(start: number, count: number): void {
    const last = spans[spans.length - 1];
    if (last && last.start + last.count === start) last.count += count;
    else spans.push({ start, count });
  }

  function begin(): void {
    if (bitmap) {
      for (let i = 0; i < touchedWordCount; i++) bitmap[touchedWords![i]] = 0;
      touchedWordCount = 0;
    }
    if (tags) {
      generation = (generation + 1) >>> 0;
      if (generation === 0) {
        tags.fill(0);
        generation = 1;
      }
    }
    spans.length = 0;
    indices.length = 0;
    uniqueCount = 0;
    full = false;
    finished = null;
  }

  function mark(index: number): void {
    // Validate before the fast full-bypass return: abandoned metadata is not a
    // license to accept out-of-bounds writes from the producer.
    if (!Number.isSafeInteger(index) || index < 0 || index >= recordCount) {
      throw new RangeError(`Dirty record index ${String(index)} is outside [0, ${recordCount})`);
    }
    if (finished) throw new Error('begin() is required before marking a finished frame');
    if (full) return;

    if (mode === 'ranges') {
      const last = spans[spans.length - 1];
      if (last && index >= last.start && index < last.start + last.count) return;
      if (last && index === last.start + last.count) last.count++;
      else spans.push({ start: index, count: 1 });
      return;
    }
    if (tags) {
      if (tags[index] === generation) return;
      tags[index] = generation;
      indices.push(index);
      uniqueCount++;
      return;
    }
    // Division avoids signed 32-bit index wrapping for large record counts.
    const wordIndex = Math.floor(index / 32);
    const mask = (1 << (index % 32)) >>> 0;
    const previous = bitmap![wordIndex];
    if ((previous & mask) !== 0) return;
    if (previous === 0) touchedWords![touchedWordCount++] = wordIndex;
    bitmap![wordIndex] = (previous | mask) >>> 0;
    uniqueCount++;
    if (mode === 'dense-bypass' && uniqueCount > bypassThreshold) full = true;
  }

  function markRange(start: number, count: number): void {
    // Validate before any early return, as mark() does. start + count <= recordCount is
    // checked as count <= recordCount - start so two unbounded inputs are never added.
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(count) || start < 0 || count < 0
      || count > recordCount - start) {
      throw new RangeError(`Dirty record range (start ${String(start)}, count ${String(count)}) `
        + `does not fit in ${recordCount} records`);
    }
    if (finished) throw new Error('begin() is required before marking a finished frame');
    if (count === 0 || full) return;
    const end = start + count;

    if (mode === 'ranges') {
      // One span per call. A range that overlaps or touches the previous span widens
      // it in place; finish() sorts and merges the rest.
      const last = spans[spans.length - 1];
      if (last && start <= last.start + last.count && end >= last.start) {
        const lastEnd = last.start + last.count;
        last.start = Math.min(last.start, start);
        last.count = Math.max(lastEnd, end) - last.start;
      } else {
        spans.push({ start, count });
      }
      return;
    }
    if (tags) {
      for (let index = start; index < end; index++) {
        if (tags[index] === generation) continue;
        tags[index] = generation;
        indices.push(index);
        uniqueCount++;
      }
      return;
    }
    // Words inside the range are set whole; only the first and last can be partial.
    const firstWord = Math.floor(start / 32);
    const lastWord = Math.floor((end - 1) / 32);
    for (let wordIndex = firstWord; wordIndex <= lastWord; wordIndex++) {
      const low = wordIndex === firstWord ? start % 32 : 0;
      const high = wordIndex === lastWord ? (end - 1) % 32 + 1 : 32;
      // Shift counts wrap modulo 32, so a mask that reaches bit 31 is written out.
      const mask = ((0xffff_ffff << low) & (high === 32 ? 0xffff_ffff : 0xffff_ffff >>> (32 - high))) >>> 0;
      const previous = bitmap![wordIndex];
      const next = (previous | mask) >>> 0;
      if (next === previous) continue;
      if (previous === 0) touchedWords![touchedWordCount++] = wordIndex;
      bitmap![wordIndex] = next;
      uniqueCount += popcount32((next ^ previous) >>> 0);
      if (mode === 'dense-bypass' && uniqueCount > bypassThreshold) {
        // Stop where per-record marks would have: past the threshold the count is
        // only a lower bound, so it is reported as threshold + 1 either way.
        uniqueCount = bypassThreshold + 1;
        full = true;
        return;
      }
    }
  }

  function finish(): DirtyRecordTrackingResult {
    if (finished) return finished;
    let coverageUpperBound = 0;
    if (!full && mode === 'ranges') {
      spans.sort((a, b) => a.start - b.start);
      let length = 0;
      for (const span of spans) {
        const last = spans[length - 1];
        if (last && span.start <= last.start + last.count) {
          last.count = Math.max(last.start + last.count, span.start + span.count) - last.start;
        } else {
          spans[length++] = span;
        }
      }
      spans.length = length;
      for (const span of spans) coverageUpperBound += span.count;
      uniqueCount = coverageUpperBound;
      // Applied to the merged spans, so the outcome doesn't depend on the order of marks.
      if (maxRanges !== undefined && length > maxRanges) full = true;
    } else if (!full && tags) {
      indices.sort((a, b) => a - b);
      for (const index of indices) appendSpan(index, 1);
      coverageUpperBound = uniqueCount;
    } else if (!full) {
      // When at most one word in 64 is touched, sorting those words costs less than
      // scanning the bitmap (measured in Node 22); otherwise scan. Both visit the
      // nonzero words in ascending order, so the output is identical. Typed-array
      // sort() is numeric.
      const touched = touchedWordCount * 64 <= bitmap!.length
        ? touchedWords!.subarray(0, touchedWordCount).sort() : null;
      const visits = touched ? touched.length : bitmap!.length;
      for (let visit = 0; visit < visits; visit++) {
        const wordIndex = touched ? touched[visit] : visit;
        let word = bitmap![wordIndex];
        if (word === 0) continue;
        const base = wordIndex * 32;
        if (mode === 'tile-32') {
          const count = Math.min(32, recordCount - base);
          appendSpan(base, count);
          coverageUpperBound += count;
        } else {
          while (word !== 0) {
            const bit = 31 - Math.clz32(word & -word);
            appendSpan(base + bit, 1);
            word = (word & (word - 1)) >>> 0;
          }
        }
      }
      if (mode !== 'tile-32') coverageUpperBound = uniqueCount;
    }
    if (full) {
      // dense-bypass keeps its bitmap prefix only so begin() can clear touched words,
      // and capped 'ranges' has more spans than the caller allowed. Neither may be
      // mistaken for complete metadata, so the result is one span covering every
      // record: forwarding it uploads everything.
      spans.length = 0;
      if (recordCount > 0) spans.push({ start: 0, count: recordCount });
      coverageUpperBound = recordCount;
    }
    finished = {
      spans,
      dirtyCount: full ? null : uniqueCount,
      countedDirtyRecords: uniqueCount,
      coverageUpperBound,
      full,
    };
    return finished;
  }

  return { begin, mark, markRange, finish };
}
