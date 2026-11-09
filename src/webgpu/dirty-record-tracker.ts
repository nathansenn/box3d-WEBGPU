import type { DirtyRecordSpan } from './sparse-upload';

/** Experimental producer-owned strategies. Callers explicitly select a mode. */
export type DirtyTrackingMode = 'ranges' | 'bitset' | 'index-list' | 'tile-32' | 'dense-bypass';

export type DirtyRecordTrackingResult = Readonly<{
  /**
   * Borrowed storage: copy these spans before the next begin() if retaining them.
   * When full is true this is one span covering every record, never an empty list,
   * so passing it on as upload evidence can't be read as "nothing changed".
   */
  spans: readonly DirtyRecordSpan[];
  /** Exact unique marked records, or null after dense-bypass stops deduplicating. */
  dirtyCount: number | null;
  /** Exact count when dirtyCount is known; otherwise a unique-record lower bound. */
  countedDirtyRecords: number;
  /** Records covered by the spans, or recordCount when full is true. */
  coverageUpperBound: number;
  /** Metadata was abandoned: the caller must upload the complete record buffer. */
  full: boolean;
}>;

export type DirtyRecordTracker = Readonly<{
  /** Start a new frame, discarding any unfinished frame and invalidating borrowed spans. */
  begin(): void;
  /** Mark every modified record. Duplicate marks are valid; invalid indices throw. */
  mark(index: number): void;
  /** Finish the current frame. Idempotent until begin(); mark() then requires begin(). */
  finish(): DirtyRecordTrackingResult;
}>;

type MutableSpan = { start: number; count: number };

/**
 * Track producer writes without comparing record contents. Construction starts an empty
 * frame. Results include every marked record, sorted into disjoint contiguous spans;
 * tile-32 may also cover unchanged records. No strategy is enabled by the renderer.
 *
 * Each tracker owns its working storage. Use separate trackers for separate buffers.
 * finish() borrows its spans until begin(); scalar result fields remain snapshots.
 * dense-bypass drops metadata after more than 25% of records have been marked and
 * stops counting new unique records. full=true therefore has dirtyCount=null.
 */
export function createDirtyRecordTracker(recordCount: number, mode: DirtyTrackingMode): DirtyRecordTracker {
  if (!Number.isSafeInteger(recordCount) || recordCount < 0 || recordCount > 0xffff_ffff) {
    throw new RangeError('recordCount must be an integer between 0 and 4294967295');
  }
  if (!['ranges', 'bitset', 'index-list', 'tile-32', 'dense-bypass'].includes(mode)) {
    throw new RangeError(`Unknown dirty tracking mode: ${String(mode)}`);
  }

  const spans: MutableSpan[] = [];
  const indices: number[] = [];
  const touchedWords: number[] = [];
  const bitmap = mode === 'bitset' || mode === 'tile-32' || mode === 'dense-bypass'
    ? new Uint32Array(Math.ceil(recordCount / 32)) : null;
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
      for (const word of touchedWords) bitmap[word] = 0;
      touchedWords.length = 0;
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
    if (previous === 0) touchedWords.push(wordIndex);
    bitmap![wordIndex] = (previous | mask) >>> 0;
    uniqueCount++;
    if (mode === 'dense-bypass' && uniqueCount > bypassThreshold) full = true;
  }

  function finish(): DirtyRecordTrackingResult {
    if (finished) return finished;
    let coverageUpperBound = 0;
    if (full) {
      // The bitmap prefix is retained only so begin() can clear touched words.
      // It must not be mistaken for complete metadata after tracking stops, so the
      // result is one span covering every record: forwarding it uploads everything.
      spans.length = 0;
      if (recordCount > 0) spans.push({ start: 0, count: recordCount });
      coverageUpperBound = recordCount;
    } else if (mode === 'ranges') {
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
    } else if (tags) {
      indices.sort((a, b) => a - b);
      for (const index of indices) appendSpan(index, 1);
      coverageUpperBound = uniqueCount;
    } else {
      for (let wordIndex = 0; wordIndex < bitmap!.length; wordIndex++) {
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
    finished = {
      spans,
      dirtyCount: full ? null : uniqueCount,
      countedDirtyRecords: uniqueCount,
      coverageUpperBound,
      full,
    };
    return finished;
  }

  return { begin, mark, finish };
}
