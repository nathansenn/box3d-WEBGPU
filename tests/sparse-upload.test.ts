import { planSparseRecordUpload, type DirtyRecordSpan } from '../src/webgpu/sparse-upload';

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
function throws(fn: () => unknown, label: string): void {
  let seen = false; try { fn(); } catch { seen = true; }
  check(seen, label);
}
function equalArray(a: Float32Array, b: Float32Array, label: string): void {
  check(a.length === b.length, label + ': length');
  for (let i = 0; i < a.length; i++) check(Object.is(a[i], b[i]), label + ': index ' + i);
}

const simple = planSparseRecordUpload(4096, 64, [{ start: 100, count: 12 }]);
check(simple.mode === 'ranges' && simple.writtenBytes === 12 * 64, '12 dirty records should be sparse');
check(planSparseRecordUpload(1, 64, [{ start: 0, count: 1 }]).mode === 'full', 'full fallback');
check(planSparseRecordUpload(100, 64, []).mode === 'none', 'producer-certified unchanged stream');
check(planSparseRecordUpload(100, 16, [
  { start: 4, count: 2 }, { start: 8, count: 2 }, { start: 5, count: 3 },
], { gapRecords: 0, minSavingsBytes: 0, callPenaltyBytes: 0 }).spans[0].count === 6, 'overlap and adjacent merge');
throws(() => planSparseRecordUpload(100, 64, [{ start: 99, count: 2 }]), 'out-of-bound reject');
throws(() => planSparseRecordUpload(100, 64, [{ start: -1, count: 1 }]), 'negative reject');
throws(() => planSparseRecordUpload(100, 64, [{ start: 0.25, count: 1 }]), 'fraction reject');
throws(() => planSparseRecordUpload(100, 6, [{ start: 0, count: 1 }]), 'alignment reject');
throws(() => planSparseRecordUpload(100, 64, [{ start: 1, count: 1 }], { maxCalls: 0 }), 'zero-call reject');
let replayed = 0, sparse = 0, full = 0, none = 0;

for (let test = 0; test < 100; test++) {
  const records = 257 + (test % 10) * 257;
  const floatsPerRecord = test % 2 ? 4 : 16;
  const before = new Float32Array(records * floatsPerRecord);
  for (let i = 0; i < before.length; i++) before[i] = (i * 3 + test) % 937;
  const after = before.slice();
  const dirty: DirtyRecordSpan[] = [];
  const changed = new Set<number>();
  for (let j = 0, n = (test * 17) % 61; j < n; j++) {
    const idx = (j * (test % 5 === 0 ? 1 : 37 + test) + test * 103) % records;
    changed.add(idx);
  }
  for (const idx of changed) {
    after[idx * floatsPerRecord] += 1 + test;
    dirty.push({ start: idx, count: 1 });
  }
  const plan = planSparseRecordUpload(records, floatsPerRecord * 4, dirty, {
    gapRecords: test % 8, maxCalls: 4 + (test % 16),
    callPenaltyBytes: (test % 5) * 512, minSavingsBytes: 0,
  });
  const candidate = before.slice();
  for (const span of plan.spans) {
    const start = span.start * floatsPerRecord, end = start + span.count * floatsPerRecord;
    candidate.set(after.subarray(start, end), start);
  }
  equalArray(candidate, after, 'deterministic record replay ' + test);
  check(plan.writtenBytes <= plan.fullBytes, 'never exceeds full payload');
  if (plan.mode === 'ranges') sparse++; else if (plan.mode === 'full') full++; else none++;
  replayed++;
}
console.log(JSON.stringify({ test: 'sparse-upload', replayed, sparse, full, none, boundaryChecks: 9, correct: true }));
