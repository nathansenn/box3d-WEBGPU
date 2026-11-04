import {
  createDirtyRecordTracker,
  type DirtyRecordTracker,
  type DirtyRecordTrackingResult,
  type DirtyTrackingMode,
} from '../src/webgpu/dirty-record-tracker';

const modes: DirtyTrackingMode[] = ['ranges', 'bitset', 'index-list', 'tile-32', 'dense-bypass'];
let replayedFrames = 0;
let boundaryChecks = 0;
let fuzzFrames = 0;

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}

function throws(fn: () => unknown, label: string): void {
  let seen = false;
  try { fn(); } catch { seen = true; }
  check(seen, label);
  boundaryChecks++;
}

/** Deliberately independent oracle: byte per record, no tracker bit operations. */
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
  marks: readonly number[],
  result: DirtyRecordTrackingResult,
  label: string,
): void {
  const oracle = new Uint8Array(recordCount);
  for (const index of marks) oracle[index] = 1;
  const unique = oracle.reduce((sum, value) => sum + value, 0);
  const expectedFull = mode === 'dense-bypass' && unique > Math.floor(recordCount / 4);
  check(result.full === expectedFull, `${label}: full decision`);
  if (expectedFull) {
    check(result.spans.length === 0, `${label}: bypass cannot expose incomplete spans`);
    check(result.dirtyCount === null, `${label}: bypass cannot claim an exact count`);
    check(result.countedDirtyRecords === Math.floor(recordCount / 4) + 1, `${label}: counted prefix`);
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
      check(actual[index] === expected[index], `${label}: coverage of record ${index}`);
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
  if (result.full) destination.set(source);
  else {
    for (const span of result.spans) {
      const first = span.start * wordsPerRecord;
      const end = (span.start + span.count) * wordsPerRecord;
      destination.set(source.subarray(first, end), first);
    }
  }
  for (let word = 0; word < source.length; word++) {
    check(source[word] === destination[word], `${label}: replay word ${word}`);
  }
  replayedFrames++;
}

function frame(
  recordCount: number,
  mode: DirtyTrackingMode,
  marks: readonly number[],
  label: string,
  tracker: DirtyRecordTracker = createDirtyRecordTracker(recordCount, mode),
): DirtyRecordTrackingResult {
  tracker.begin();
  for (const index of marks) tracker.mark(index);
  const result = tracker.finish();
  check(tracker.finish() === result, `${label}: finish is idempotent`);
  verifyResult(recordCount, mode, marks, result, label);
  return result;
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
}

for (const count of [0, 1, 2, 3, 4, 5, 7, 8, 31, 32, 33, 100, 129]) {
  const threshold = Math.floor(count / 4);
  const exactQuarter = Array.from({ length: threshold }, (_, i) => i);
  const tracker = createDirtyRecordTracker(count, 'dense-bypass');
  frame(count, 'dense-bypass', exactQuarter.flatMap(index => [index, index]),
    `dense-bypass: equality at threshold ${count}`, tracker);
  if (count === 0) continue;
  tracker.begin();
  for (let index = 0; index <= threshold; index++) tracker.mark(index);
  for (const invalid of [-1, count, 0.5, NaN, Infinity, '0']) {
    throws(() => tracker.mark(invalid as number), `dense-bypass: validate after bypass ${count}/${String(invalid)}`);
  }
  for (let index = count - 1; index >= 0; index--) tracker.mark(index);
  verifyResult(count, 'dense-bypass', Array.from({ length: count }, (_, i) => i), tracker.finish(),
    `dense-bypass: no false exact count after bypass ${count}`);
  frame(count, 'dense-bypass', [], `dense-bypass: clear counted prefix ${count}`, tracker);
}

for (const invalid of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER, 0x1_0000_0000, '5']) {
  throws(() => createDirtyRecordTracker(invalid as number, 'ranges'), `reject invalid recordCount ${String(invalid)}`);
}
throws(() => createDirtyRecordTracker(10, 'unknown' as DirtyTrackingMode), 'reject unknown mode');

// Deterministic fuzz changes input order, duplication, sparse/dense coverage, and
// active words across consecutive frames on the same tracker.
let seed = 0x32a59f71;
function next(): number {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed;
}
const counts = [0, 1, 2, 3, 4, 7, 31, 32, 33, 63, 64, 65, 97, 255, 257, 1025];
for (const recordCount of counts) {
  const trackers = modes.map(mode => createDirtyRecordTracker(recordCount, mode));
  for (let iteration = 0; iteration < 24; iteration++) {
    const marks: number[] = [];
    const attempts = recordCount === 0 ? 0 : next() % (recordCount * 2 + 1);
    for (let attempt = 0; attempt < attempts; attempt++) {
      const index = next() % recordCount;
      marks.push(index);
      if (next() % 3 === 0) marks.push(index);
    }
    if (iteration % 3 === 0) marks.sort((a, b) => a - b);
    if (iteration % 3 === 1) marks.sort((a, b) => b - a);
    modes.forEach((mode, index) => {
      frame(recordCount, mode, marks, `${mode}: fuzz n=${recordCount} frame=${iteration}`, trackers[index]);
      fuzzFrames++;
    });
  }
}

// Multiple disjoint words and the final incomplete word in a larger sparse buffer.
for (const mode of modes) {
  frame(4097, mode, [0, 31, 32, 63, 64, 1023, 2048, 4095, 4096], `${mode}: large sparse boundary frame`);
}

console.log(JSON.stringify({ test: 'dirty-record-tracker', modes: modes.length, replayedFrames, boundaryChecks, fuzzFrames, correct: true }));
