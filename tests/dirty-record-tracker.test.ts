import {
  createDirtyRecordTracker,
  type DirtyRecordTracker,
  type DirtyRecordTrackerOptions,
  type DirtyRecordTrackingResult,
  type DirtyTrackingMode,
} from '../src/webgpu/dirty-record-tracker';

const modes: DirtyTrackingMode[] = ['ranges', 'bitset', 'index-list', 'tile-32', 'dense-bypass'];
let replayedFrames = 0;
let boundaryChecks = 0;
let fuzzFrames = 0;
let rangeFrames = 0;
let rangeBoundaryChecks = 0;
let maxRangesChecks = 0;

/** One producer call: a mark() index, or a markRange() [start, count] pair. */
type Mark = number | readonly [start: number, count: number];

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

function throws(fn: () => unknown, label: string): void {
  let seen = false;
  try { fn(); } catch { seen = true; }
  check(seen, label);
  boundaryChecks++;
}

/** The value fn throws, or undefined when it returns normally. */
function caught(fn: () => unknown): unknown {
  try { fn(); } catch (error) { return error; }
  return undefined;
}

/** Deliberately independent oracle: byte per record, no tracker bit operations. */
function markedRecords(recordCount: number, marks: readonly Mark[]): Uint8Array {
  const oracle = new Uint8Array(recordCount);
  for (const mark of marks) {
    if (typeof mark === 'number') oracle[mark] = 1;
    else for (let index = mark[0]; index < mark[0] + mark[1]; index++) oracle[index] = 1;
  }
  return oracle;
}

/** Maximal runs of marked records: the spans 'ranges' must merge a frame into. */
function markedRuns(oracle: Uint8Array): number {
  let runs = 0;
  for (let index = 0; index < oracle.length; index++) {
    if (oracle[index] && (index === 0 || !oracle[index - 1])) runs++;
  }
  return runs;
}

function expectedCoverage(oracle: Uint8Array, mode: DirtyTrackingMode): Uint8Array {
  const coverage = oracle.slice();
  if (mode === 'tile-32') {
    for (let index = 0; index < oracle.length; index++) {
      if (!oracle[index]) continue;
      const start = Math.floor(index / 32) * 32;
      coverage.fill(1, start, Math.min(start + 32, oracle.length));
    }
  }
  return coverage;
}

function verifyResult(
  recordCount: number,
  mode: DirtyTrackingMode,
  marks: readonly Mark[],
  result: DirtyRecordTrackingResult,
  label: string,
  maxRanges?: number,
): void {
  const oracle = markedRecords(recordCount, marks);
  const unique = oracle.reduce((sum, value) => sum + value, 0);
  const bypassed = mode === 'dense-bypass' && unique > Math.floor(recordCount / 4);
  const capped = mode === 'ranges' && maxRanges !== undefined && markedRuns(oracle) > maxRanges;
  const expectedFull = bypassed || capped;
  check(result.full === expectedFull, `${label}: full decision`);
  if (expectedFull) {
    check(recordCount > 0 && result.spans.length === 1 && result.spans[0].start === 0 && result.spans[0].count === recordCount,
      `${label}: a full result is one span covering every record, never incomplete or empty spans`);
    check(result.dirtyCount === null, `${label}: a full result cannot claim an exact count`);
    // dense-bypass stops counting at the first record over the threshold, whether it
    // came from mark() or markRange(); capped 'ranges' has merged every span first.
    check(result.countedDirtyRecords === (bypassed ? Math.floor(recordCount / 4) + 1 : unique), `${label}: counted prefix`);
    check(result.countedDirtyRecords <= unique, `${label}: counted prefix is a lower bound`);
    check(result.coverageUpperBound === recordCount, `${label}: full coverage bound`);
  } else {
    check(result.dirtyCount === unique, `${label}: exact unique count`);
    check(result.countedDirtyRecords === unique, `${label}: counted records`);
    const actual = new Uint8Array(recordCount);
    let previousEnd = -1;
    let spanRecords = 0;
    for (const span of result.spans) {
      check(Number.isSafeInteger(span.start), `${label}: integer start`);
      check(Number.isSafeInteger(span.count) && span.count > 0, `${label}: positive integer count`);
      check(span.start >= 0 && span.start + span.count <= recordCount, `${label}: span bounds`);
      check(span.start > previousEnd, `${label}: sorted, disjoint, maximally coalesced spans`);
      actual.fill(1, span.start, span.start + span.count);
      spanRecords += span.count;
      previousEnd = span.start + span.count;
    }
    const expected = expectedCoverage(oracle, mode);
    for (let index = 0; index < recordCount; index++) {
      if (actual[index] !== expected[index]) throw new Error(`${label}: coverage of record ${index}`);
    }
    check(result.coverageUpperBound === spanRecords, `${label}: coverage accounting`);
  }

  // Copy opaque record bits as a buffer upload would. Include nonzero -> zero,
  // negative zero, and NaN bit patterns: tracking is about writes, not truthiness.
  const wordsPerRecord = 4;
  const destination = new Uint32Array(recordCount * wordsPerRecord);
  for (let index = 0; index < destination.length; index++) destination[index] = (index + 1) >>> 0;
  const source = destination.slice();
  for (let index = 0; index < recordCount; index++) {
    if (!oracle[index]) continue;
    source[index * wordsPerRecord] = 0;
    source[index * wordsPerRecord + 1] = 0x80000000;
    source[index * wordsPerRecord + 2] = 0x7fc01234;
    source[index * wordsPerRecord + 3] = (index * 2654435761) >>> 0;
  }
  // Replay through the spans alone, as a caller that forwards them would, even when full.
  for (const span of result.spans) {
    const first = span.start * wordsPerRecord;
    const end = (span.start + span.count) * wordsPerRecord;
    destination.set(source.subarray(first, end), first);
  }
  for (let word = 0; word < source.length; word++) {
    if (source[word] !== destination[word]) throw new Error(`${label}: replay word ${word}`);
  }
  replayedFrames++;
}

function apply(tracker: DirtyRecordTracker, marks: readonly Mark[]): void {
  for (const mark of marks) {
    if (typeof mark === 'number') tracker.mark(mark);
    else tracker.markRange(mark[0], mark[1]);
  }
}

function options(maxRanges: number | undefined): DirtyRecordTrackerOptions | undefined {
  return maxRanges === undefined ? undefined : { maxRanges };
}

function frame(
  recordCount: number,
  mode: DirtyTrackingMode,
  marks: readonly Mark[],
  label: string,
  tracker: DirtyRecordTracker = createDirtyRecordTracker(recordCount, mode),
  maxRanges?: number,
): DirtyRecordTrackingResult {
  tracker.begin();
  apply(tracker, marks);
  const result = tracker.finish();
  check(tracker.finish() === result, `${label}: finish is idempotent`);
  verifyResult(recordCount, mode, marks, result, label, maxRanges);
  if (marks.some(mark => typeof mark !== 'number')) rangeFrames++;
  return result;
}

/** A frame on a fresh 'ranges' tracker with the given cap. */
function cappedFrame(recordCount: number, maxRanges: number, marks: readonly Mark[], label: string): DirtyRecordTrackingResult {
  return frame(recordCount, 'ranges', marks, label, createDirtyRecordTracker(recordCount, 'ranges', { maxRanges }), maxRanges);
}

function xorshift(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

for (const mode of modes) {
  const fresh = createDirtyRecordTracker(65, mode);
  verifyResult(65, mode, [], fresh.finish(), `${mode}: construction starts an empty frame`);
  throws(() => fresh.mark(0), `${mode}: finished frame requires begin`);
  frame(0, mode, [], `${mode}: zero capacity`);
  frame(1, mode, [0, 0, 0], `${mode}: only record zero`);
  frame(65, mode, [0], `${mode}: first record`);
  frame(65, mode, [64], `${mode}: last record and partial tail tile`);
  frame(65, mode, [31, 32, 63, 64, 0, 31, 63], `${mode}: word boundaries and duplicates`);
  frame(100, mode, [10, 11, 12, 7, 8, 9, 11, 4, 5, 6, 3, 2, 1, 0, 12], `${mode}: unordered overlapping ranges`);
  frame(100, mode, Array.from({ length: 100 }, (_, i) => 99 - i), `${mode}: reversed dense frame`);
  frame(100, mode, Array.from({ length: 100 }, (_, i) => i), `${mode}: sequential dense frame`);
  frame(128, mode, Array.from({ length: 100 }, () => 0), `${mode}: duplicate storm is one record`);

  const tracker = createDirtyRecordTracker(129, mode);
  tracker.mark(128);
  tracker.begin();
  verifyResult(129, mode, [], tracker.finish(), `${mode}: discard unfinished frame`);
  const first = frame(129, mode, [0, 1, 32, 128], `${mode}: first retained result`, tracker);
  const saved = first.spans.map(span => ({ ...span }));
  const originalCount = first.dirtyCount;
  const originalCoverage = first.coverageUpperBound;
  frame(129, mode, [64, 65], `${mode}: reset does not leak old marks`, tracker);
  check(first.dirtyCount === originalCount && first.coverageUpperBound === originalCoverage,
    `${mode}: scalar results remain snapshots`);
  verifyResult(129, mode, [0, 1, 32, 128], { ...first, spans: saved }, `${mode}: copied spans survive begin`);
  frame(129, mode, [], `${mode}: reset empty frame`, tracker);
  frame(129, mode, Array.from({ length: 129 }, (_, i) => i), `${mode}: reset dense frame`, tracker);
  frame(129, mode, [128], `${mode}: reset after dense frame`, tracker);

  const matrixTracker = createDirtyRecordTracker(65, mode);
  const colorTracker = createDirtyRecordTracker(65, mode);
  matrixTracker.mark(0);
  colorTracker.mark(64);
  verifyResult(65, mode, [0], matrixTracker.finish(), `${mode}: matrix tracker independence`);
  verifyResult(65, mode, [64], colorTracker.finish(), `${mode}: color tracker independence`);
  colorTracker.begin();
  verifyResult(65, mode, [0], matrixTracker.finish(), `${mode}: other tracker reset isolation`);

  for (const invalid of [-1, 65, 66, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, '0']) {
    const invalidTracker = createDirtyRecordTracker(65, mode);
    throws(() => invalidTracker.mark(invalid as number), `${mode}: reject invalid index ${String(invalid)}`);
    invalidTracker.mark(0);
    verifyResult(65, mode, [0], invalidTracker.finish(), `${mode}: invalid mark cannot corrupt state`);
  }
  throws(() => createDirtyRecordTracker(0, mode).mark(0), `${mode}: empty tracker rejects mark`);

  // markRange(): empty and full ranges, the last record, and starts and lengths on and
  // around the word boundaries at 0, 31/32, 63/64 and 127/128 of 129 records.
  frame(0, mode, [[0, 0]], `${mode}: empty range on an empty tracker`);
  frame(65, mode, [[0, 0], [17, 0], [65, 0]], `${mode}: zero-count ranges are no-ops`);
  frame(1, mode, [[0, 1]], `${mode}: one-record full range`);
  frame(65, mode, [[0, 65]], `${mode}: full range`);
  frame(65, mode, [[64, 1]], `${mode}: last record by range`);
  frame(65, mode, [[63, 2]], `${mode}: range into the partial tail word`);
  for (const start of [0, 1, 30, 31, 32, 33, 63, 64, 65, 96, 127, 128]) {
    for (const count of [1, 2, 31, 32, 33, 64, 65, 129]) {
      if (start + count <= 129) frame(129, mode, [[start, count]], `${mode}: range ${start}+${count}`);
    }
  }
  frame(129, mode, [[40, 5], [10, 10], [20, 20]], `${mode}: unordered adjacent and overlapping ranges`);
  frame(129, mode, [[64, 10], [0, 10], [32, 10], [100, 0], [70, 10]], `${mode}: unordered disjoint ranges`);
  frame(129, mode, [[10, 5], [5, 5], [0, 5]], `${mode}: each range ends where the previous one starts`);
  frame(129, mode, [[0, 50], [10, 5], [0, 50], [49, 2]], `${mode}: nested and duplicate ranges`);
  frame(129, mode, [[10, 5], [0, 30]], `${mode}: range covering the previous one`);
  frame(129, mode, [[31, 2], [63, 2], [95, 2], [127, 2]], `${mode}: ranges straddling each word boundary`);
  frame(129, mode, [5, [0, 5], 10, [6, 4], 128, [127, 2], 31, [32, 1], 64, [64, 0]],
    `${mode}: ranges and marks interleaved`);

  const rangeTracker = createDirtyRecordTracker(129, mode);
  frame(129, mode, [[0, 129]], `${mode}: reused tracker, full range`, rangeTracker);
  frame(129, mode, [[64, 2]], `${mode}: reused tracker, old range does not leak`, rangeTracker);
  frame(129, mode, [], `${mode}: reused tracker, empty after ranges`, rangeTracker);
  rangeTracker.begin();
  rangeTracker.markRange(0, 129);
  rangeTracker.begin();
  verifyResult(129, mode, [], rangeTracker.finish(), `${mode}: begin discards an unfinished range`);

  const invalidRanges: readonly (readonly [unknown, unknown])[] = [
    [-1, 1], [0, -1], [-1, 0], [66, 0], [65, 1], [64, 2], [0, 66], [1, 65],
    [0.5, 1], [0, 0.5], [NaN, 1], [0, NaN], [Infinity, 0], [0, Infinity], [-Infinity, 1],
    ['0', 1], [0, '1'], [undefined, 1], [0, undefined], [Number.MAX_SAFE_INTEGER, 1],
    [1, Number.MAX_SAFE_INTEGER], [2 ** 53, 0], [0, 2 ** 53],
  ];
  for (const [start, count] of invalidRanges) {
    const invalidTracker = createDirtyRecordTracker(65, mode);
    check(caught(() => invalidTracker.markRange(start as number, count as number)) instanceof RangeError,
      `${mode}: reject invalid range ${String(start)}+${String(count)}`);
    rangeBoundaryChecks++;
    invalidTracker.markRange(0, 2);
    invalidTracker.mark(64);
    verifyResult(65, mode, [[0, 2], 64], invalidTracker.finish(), `${mode}: invalid range cannot corrupt state`);
  }
  // A finished frame needs begin(), even for an empty range. Validation still comes first.
  const done = createDirtyRecordTracker(65, mode);
  done.finish();
  for (const [start, count] of [[0, 0], [0, 1], [65, 0], [64, 1]]) {
    const error = caught(() => done.markRange(start, count));
    check(error instanceof Error && !(error instanceof RangeError) && error.message.includes('begin()'),
      `${mode}: finished frame requires begin before markRange ${start}+${count}`);
    rangeBoundaryChecks++;
  }
  check(caught(() => done.markRange(0, 66)) instanceof RangeError, `${mode}: finished frame still validates ranges`);
  check(caught(() => createDirtyRecordTracker(0, mode).markRange(0, 1)) instanceof RangeError,
    `${mode}: empty tracker rejects a range`);
  rangeBoundaryChecks += 2;

  // Ported from PR #14: inputs are still validated once 65 of 257 records are marked,
  // which is past the dense-bypass threshold of 64, so that mode has already gone full.
  const fullTracker = createDirtyRecordTracker(257, mode);
  fullTracker.markRange(0, 65);
  fullTracker.mark(100);
  for (const [start, count] of [[-1, 1], [0, -1], [258, 0], [257, 1], [256, 2], [0, NaN], [Infinity, 1], [0, 0.1], [NaN, 1]]) {
    check(caught(() => fullTracker.markRange(start, count)) instanceof RangeError,
      `${mode}: validate range ${start}+${count} after 65 of 257 records`);
    rangeBoundaryChecks++;
  }
  for (const index of [-1, 257, NaN, Infinity, 0.1]) {
    throws(() => fullTracker.mark(index), `${mode}: validate index ${index} after 65 of 257 records`);
  }
  fullTracker.markRange(257, 0);
  verifyResult(257, mode, [[0, 65], 100], fullTracker.finish(), `${mode}: state after rejected inputs`);
}

for (const count of [0, 1, 2, 3, 4, 5, 7, 8, 31, 32, 33, 100, 129]) {
  const threshold = Math.floor(count / 4);
  const exactQuarter = Array.from({ length: threshold }, (_, i) => i);
  const tracker = createDirtyRecordTracker(count, 'dense-bypass');
  frame(count, 'dense-bypass', exactQuarter.flatMap(index => [index, index]),
    `dense-bypass: equality at threshold ${count}`, tracker);
  // markRange() reaches and crosses the threshold the same way, from either end.
  frame(count, 'dense-bypass', [[0, threshold], [0, threshold]], `dense-bypass: range equality at threshold ${count}`, tracker);
  frame(count, 'dense-bypass', [[count - threshold, threshold]], `dense-bypass: tail range at threshold ${count}`, tracker);
  if (count === 0) continue;
  frame(count, 'dense-bypass', [[count - threshold - 1, threshold + 1]], `dense-bypass: range one over threshold ${count}`, tracker);
  frame(count, 'dense-bypass', [...exactQuarter, [count - 1, 1]], `dense-bypass: marks then a range cross ${count}`, tracker);
  frame(count, 'dense-bypass', [[0, count], 0, [0, count]], `dense-bypass: full range ${count}`, tracker);
  tracker.begin();
  for (let index = 0; index <= threshold; index++) tracker.mark(index);
  for (const invalid of [-1, count, 0.5, NaN, Infinity, '0']) {
    throws(() => tracker.mark(invalid as number), `dense-bypass: validate after bypass ${count}/${String(invalid)}`);
  }
  for (const [start, length] of [[-1, 1], [0, count + 1], [count, 1], [count + 1, 0], [0.5, 1], [0, NaN]]) {
    check(caught(() => tracker.markRange(start, length)) instanceof RangeError,
      `dense-bypass: validate range after bypass ${count}/${start}+${length}`);
    rangeBoundaryChecks++;
  }
  tracker.markRange(count, 0);
  for (let index = count - 1; index >= 0; index--) tracker.mark(index);
  tracker.markRange(0, count);
  verifyResult(count, 'dense-bypass', Array.from({ length: count }, (_, i) => i), tracker.finish(),
    `dense-bypass: no false exact count after bypass ${count}`);
  frame(count, 'dense-bypass', [], `dense-bypass: clear counted prefix ${count}`, tracker);
}

// maxRanges: 'ranges' reports a full result once the merged frame has more than
// maxRanges disjoint spans. The cap is applied to the merged spans in finish().
{
  const tracker = createDirtyRecordTracker(100, 'ranges', { maxRanges: 3 });
  const atCap = frame(100, 'ranges', [[0, 5], [10, 5], [20, 5]], 'maxRanges: at the cap', tracker, 3);
  check(!atCap.full && atCap.spans.length === 3, 'maxRanges: exactly at the cap is not full');
  const overCap = frame(100, 'ranges', [[0, 5], [10, 5], [20, 5], 99], 'maxRanges: one over the cap', tracker, 3);
  check(overCap.full && overCap.countedDirtyRecords === 16, 'maxRanges: one over the cap is full and keeps the merged count');
  const filled = frame(100, 'ranges', [0, 2, 4, 6, 8, 1, 3, 5, 7], 'maxRanges: gaps filled later', tracker, 3);
  check(!filled.full && filled.spans.length === 1, 'maxRanges: later marks that fill gaps keep the frame under the cap');
  const adjacent = frame(100, 'ranges', [[5, 5], [0, 5], [10, 5], [30, 1], [50, 1]], 'maxRanges: adjacent ranges', tracker, 3);
  check(!adjacent.full && adjacent.spans.length === 3, 'maxRanges: adjacent spans merge before the cap is applied');
  const cleared = frame(100, 'ranges', [], 'maxRanges: begin after a full frame', tracker, 3);
  check(!cleared.full && cleared.spans.length === 0, 'maxRanges: begin clears a full frame');
  maxRangesChecks += 5;

  // Ported from PR #14: overlaps and adjacency merge without losing records.
  const pair = createDirtyRecordTracker(100, 'ranges', { maxRanges: 2 });
  const merged = frame(100, 'ranges', [[40, 5], [10, 10], [20, 20]], 'maxRanges: overlapping ranges merge', pair, 2);
  check(merged.spans.length === 1 && merged.spans[0].start === 10 && merged.spans[0].count === 35, 'maxRanges: merged span');
  const scattered = frame(100, 'ranges', [1, 5, 99], 'maxRanges: three scattered marks over a cap of two', pair, 2);
  check(scattered.full && scattered.dirtyCount === null && scattered.countedDirtyRecords === 3, 'maxRanges: scattered marks');
  maxRangesChecks += 2;

  check(!cappedFrame(1, 1, [0], 'maxRanges: one record, cap one').full, 'maxRanges: one record');
  check(!cappedFrame(129, 1, [[0, 129]], 'maxRanges: full range, cap one').full, 'maxRanges: a full range is one span');
  check(cappedFrame(129, 1, [0, 128], 'maxRanges: first and last, cap one').full, 'maxRanges: two spans over a cap of one');
  check(!cappedFrame(129, Number.MAX_SAFE_INTEGER, [0, 128], 'maxRanges: largest cap').full, 'maxRanges: largest cap');
  check(!cappedFrame(0, 1, [], 'maxRanges: empty tracker').full, 'maxRanges: empty tracker');
  maxRangesChecks += 5;
}
for (const invalid of [0, -1, 1.5, NaN, Infinity, -Infinity, 2 ** 53, '4', null, true]) {
  check(caught(() => createDirtyRecordTracker(10, 'ranges', { maxRanges: invalid as number })) instanceof RangeError,
    `reject maxRanges ${String(invalid)}`);
  maxRangesChecks++;
}
for (const mode of modes) {
  if (mode === 'ranges') continue;
  check(caught(() => createDirtyRecordTracker(10, mode, { maxRanges: 4 })) instanceof RangeError,
    `${mode}: rejects maxRanges instead of ignoring it`);
  maxRangesChecks++;
  frame(10, mode, [3], `${mode}: empty options`, createDirtyRecordTracker(10, mode, {}));
  frame(10, mode, [3], `${mode}: undefined maxRanges`, createDirtyRecordTracker(10, mode, { maxRanges: undefined }));
}
for (const invalid of [64, 'ranges', null, true, { locality: 'localized' }, { maxRanges: 4, locality: 'localized' }]) {
  check(caught(() => createDirtyRecordTracker(10, 'ranges', invalid as unknown as DirtyRecordTrackerOptions)) instanceof RangeError,
    `reject options ${JSON.stringify(invalid)}`);
  maxRangesChecks++;
}

for (const invalid of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, 0x1_0000_0000, '5']) {
  throws(() => createDirtyRecordTracker(invalid as number, 'ranges'), `reject invalid recordCount ${String(invalid)}`);
}
throws(() => createDirtyRecordTracker(10, 'unknown' as DirtyTrackingMode), 'reject unknown mode');

// Deterministic fuzz changes input order, duplication, sparse/dense coverage, range
// calls and active words across consecutive frames on the same tracker. Each frame
// also checks the 'ranges' cap exactly at, and one below, its merged span count.
let seed = 0x32a59f71;
function next(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
}
function markStart(mark: Mark): number {
  return typeof mark === 'number' ? mark : mark[0];
}
const counts = [0, 1, 2, 3, 4, 7, 31, 32, 33, 63, 64, 65, 97, 255, 257, 1025];
for (const recordCount of counts) {
  const trackers = modes.map(mode => createDirtyRecordTracker(recordCount, mode));
  for (let iteration = 0; iteration < 24; iteration++) {
    const marks: Mark[] = [];
    const attempts = recordCount === 0 ? 0 : next() % (recordCount * 2 + 1);
    // Odd frames mix markRange() calls of up to 70 records into the per-record marks.
    const withRanges = iteration % 2 === 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      const index = next() % recordCount;
      if (withRanges && next() % 4 === 0) {
        marks.push([index, next() % (Math.min(70, recordCount - index) + 1)]);
        continue;
      }
      marks.push(index);
      if (next() % 3 === 0) marks.push(index);
    }
    if (iteration % 3 === 0) marks.sort((a, b) => markStart(a) - markStart(b));
    if (iteration % 3 === 1) marks.sort((a, b) => markStart(b) - markStart(a));
    const label = `fuzz n=${recordCount} frame=${iteration}`;
    modes.forEach((mode, index) => {
      frame(recordCount, mode, marks, `${mode}: ${label}`, trackers[index]);
      fuzzFrames++;
    });
    const runs = markedRuns(markedRecords(recordCount, marks));
    if (runs > 0) {
      check(!cappedFrame(recordCount, runs, marks, `ranges: ${label} cap ${runs}`).full, `${label}: at the cap`);
      maxRangesChecks++;
    }
    if (runs > 1) {
      check(cappedFrame(recordCount, runs - 1, marks, `ranges: ${label} cap ${runs - 1}`).full, `${label}: over the cap`);
      maxRangesChecks++;
    }
  }
}

// Ported from PR #14: twenty random ranges per frame plus repeated marks, on sizes
// around word boundaries, each tracker reused for 24 frames. Also 'ranges' capped at 8.
{
  const random = xorshift(0x18afa421);
  const configs: readonly Readonly<{ mode: DirtyTrackingMode; maxRanges?: number }>[] = [
    ...modes.map(mode => ({ mode })), { mode: 'ranges', maxRanges: 8 },
  ];
  for (const recordCount of [0, 1, 2, 31, 32, 33, 63, 64, 65, 257, 4097]) {
    for (const { mode, maxRanges } of configs) {
      const name = maxRanges === undefined ? mode : `${mode} cap ${maxRanges}`;
      const tracker = createDirtyRecordTracker(recordCount, mode, options(maxRanges));
      for (let iteration = 0; iteration < 24; iteration++) {
        const marks: Mark[] = [];
        for (let call = 0; call < 20; call++) {
          const start = recordCount ? random() % (recordCount + 1) : 0;
          marks.push([start, random() % Math.min(39, recordCount - start + 1)]);
          if (recordCount && call % 3 === 0) {
            const index = random() % recordCount;
            marks.push(index, index);
          }
        }
        frame(recordCount, mode, marks, `${name}: range replay n=${recordCount} frame=${iteration}`, tracker, maxRanges);
        check(caught(() => tracker.markRange(0, 0)) instanceof Error, `${name}: finished range replay requires begin`);
        rangeBoundaryChecks++;
        frame(recordCount, mode, [], `${name}: empty after range replay n=${recordCount}`, tracker, maxRanges);
      }
    }
  }
}

// Ported from PR #14: 500 trackers of random sizes, six frames each, alternating
// mark() and markRange(). Half of the 'ranges' trackers get a random cap.
{
  const random = xorshift(0x924aca39);
  for (let trial = 0; trial < 500; trial++) {
    const recordCount = random() % 1537;
    const mode = modes[trial % modes.length];
    const maxRanges = mode === 'ranges' && trial % 2 === 0 ? 1 + random() % 64 : undefined;
    const tracker = createDirtyRecordTracker(recordCount, mode, options(maxRanges));
    for (let iteration = 0; iteration < 6; iteration++) {
      const marks: Mark[] = [];
      for (let call = 0; call < 60 && recordCount; call++) {
        const index = random() % recordCount;
        if (call % 2) marks.push(index);
        else marks.push([index, random() % Math.min(80, recordCount - index + 1)]);
      }
      frame(recordCount, mode, marks, `${mode}: random trial ${trial} frame ${iteration}`, tracker, maxRanges);
    }
  }
}

// Multiple disjoint words and the final incomplete word in a larger sparse buffer.
for (const mode of modes) {
  frame(4097, mode, [0, 31, 32, 63, 64, 1023, 2048, 4095, 4096], `${mode}: large sparse boundary frame`);
  frame(4097, mode, [[4064, 33], [0, 1], [2047, 2], [31, 2]], `${mode}: large sparse boundary ranges`);
}

// 65,537 records is 2,049 words, so finish() visits only the touched words when at
// most 32 are touched and scans the bitmap otherwise. Marks arrive in random order.
{
  const random = xorshift(0x5eed2026);
  const recordCount = 65_537;
  const trackers = modes.map(mode => createDirtyRecordTracker(recordCount, mode));
  for (let iteration = 0; iteration < 32; iteration++) {
    const marks: Mark[] = [];
    const calls = iteration === 0 ? 0 : random() % (iteration % 2 ? 16 : 64);
    for (let call = 0; call < calls; call++) {
      const index = random() % recordCount;
      marks.push(call % 3 === 0 ? [index, random() % Math.min(40, recordCount - index + 1)] : index);
    }
    if (iteration === 5) marks.push([recordCount - 1, 1], 0, [31, 2]);
    if (iteration === 7) marks.push([1000, 20_000]);
    if (iteration === 9) marks.push(recordCount - 1, 32_768, 32_767, 0);
    modes.forEach((mode, index) => frame(recordCount, mode, marks, `${mode}: large sparse frame ${iteration}`, trackers[index]));
  }
}

console.log(JSON.stringify({
  test: 'dirty-record-tracker', modes: modes.length, replayedFrames, boundaryChecks, fuzzFrames,
  rangeFrames, rangeBoundaryChecks, maxRangesChecks, correct: true,
}));
