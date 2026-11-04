import { planSparseRecordUpload, type DirtyRecordSpan } from '../src/webgpu/sparse-upload';
import { WebGPURenderer, type RigidInstanceDirtyEvidence } from '../src/webgpu/renderer';

let boundaryChecks = 0;

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label);
}
function throws(fn: () => unknown, label: string): void {
  let seen = false; try { fn(); } catch { seen = true; }
  check(seen, label);
  boundaryChecks++;
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
throws(() => planSparseRecordUpload(0, 64, [{ start: 0, count: 1 }]), 'empty stream cannot contain a record');
throws(() => planSparseRecordUpload(100, 64, [{ start: 101, count: 0 }]), 'out-of-bounds empty range reject');
throws(() => planSparseRecordUpload(100, 64, [{ start: 0, count: Number.NaN }]), 'NaN count reject');
throws(() => planSparseRecordUpload(Number.MAX_SAFE_INTEGER, 64, []), 'unsafe byte length reject');
throws(() => planSparseRecordUpload(100, 64, [], { maxPlanningSpans: -1 }), 'negative planning budget reject');
throws(() => planSparseRecordUpload(100, 64, [], { minSavingsBytes: 0.5 }), 'fractional savings reject');
throws(() => planSparseRecordUpload(100, 64, [], { callPenaltyBytes: Number.POSITIVE_INFINITY }), 'infinite penalty reject');
for (const fraction of [-0.1, 1.1, Number.NaN, Number.POSITIVE_INFINITY]) {
  throws(() => planSparseRecordUpload(100, 64, [], { maxCoverageFraction: fraction }), 'invalid coverage reject');
}
throws(() => planSparseRecordUpload(100, 64, {} as readonly DirtyRecordSpan[]), 'non-array cannot certify an unchanged stream');
throws(() => planSparseRecordUpload(100, 64, new Array<DirtyRecordSpan>(1)), 'array hole reject');
throws(() => planSparseRecordUpload(100, 64, [], { costCoalescing: 1 as unknown as boolean }), 'non-boolean strategy reject');

const orderedLarge = Array.from({ length: 512 }, (_, start) => ({ start: start + 100, count: 1 }));
const orderedPlan = planSparseRecordUpload(4096, 64, orderedLarge, { maxPlanningSpans: 2 });
check(orderedPlan.mode === 'ranges' && orderedPlan.spans.length === 1 && orderedPlan.writtenBytes === 512 * 64,
  'large sorted contiguous metadata has no sortable-input budget penalty');
check(planSparseRecordUpload(4096, 64, [...orderedLarge].reverse(), { maxPlanningSpans: 2 }).mode === 'full',
  'unordered fragmented metadata bypasses allocation and sorting above budget');
check(planSparseRecordUpload(4096, 64, [{ start: 1, count: 1 }, { start: 100, count: 1 }], {
  maxPlanningSpans: 1, costCoalescing: true,
}).mode === 'full', 'normalized run budget is bounded even for cost coalescing');
throws(() => planSparseRecordUpload(4096, 64, [
  ...orderedLarge, { start: 4096, count: 1 },
], { maxPlanningSpans: 1 }), 'invalid trailing span is still validated after planning budget');
check(planSparseRecordUpload(0, 64, [{ start: 0, count: 0 }], { maxPlanningSpans: 0 }).mode === 'none',
  'empty stream and empty spans remain an explicit no-write plan');
check(planSparseRecordUpload(4096, 64, [{ start: 1, count: 1 }], { maxPlanningSpans: 0 }).mode === 'full',
  'zero planning budget disables sparse planning safely');
check(planSparseRecordUpload(4096, 64, [{ start: 10, count: 2048 }], {
  maxCoverageFraction: 0.5,
}).mode === 'ranges', 'coverage at the limit is accepted');
check(planSparseRecordUpload(4096, 64, [{ start: 10, count: 2049 }], {
  maxCoverageFraction: 0.5,
}).mode === 'full', 'coverage beyond the limit falls back');
check(planSparseRecordUpload(4096, 64, [{ start: 10, count: 1 }], {
  maxCoverageFraction: 0,
}).mode === 'full', 'zero coverage disables nonempty sparse uploads');

const hugePenalty = planSparseRecordUpload(10_000, 4, [{ start: 0, count: 9998 }], {
  minSavingsBytes: 0, callPenaltyBytes: Number.MAX_SAFE_INTEGER,
});
check(hugePenalty.mode === 'ranges' && hugePenalty.writtenBytes === 39992,
  'single-call penalty cancels against the baseline without overflow');
check(planSparseRecordUpload(10_000, 4, [{ start: 0, count: 1 }, { start: 9999, count: 1 }], {
  minSavingsBytes: 0, callPenaltyBytes: Number.MAX_SAFE_INTEGER,
}).mode === 'full', 'multiple-call penalty overflow cannot select a false saving');

const immutableInput = Object.freeze([
  Object.freeze({ start: 20, count: 2 }), Object.freeze({ start: 4, count: 5 }),
  Object.freeze({ start: 7, count: 3 }), Object.freeze({ start: 10, count: 0 }),
]);
const immutablePlan = planSparseRecordUpload(1000, 64, immutableInput, { minSavingsBytes: 0, callPenaltyBytes: 0 });
check(immutableInput[0].start === 20 && immutablePlan.spans[0].start === 4 && immutablePlan.spans[0].count === 6,
  'overlap normalization preserves immutable unsorted producer data');

// Independent exhaustive oracle: enumerate every partition of the required
// ranges, rather than repeating the implementation's largest-gap selection.
function oracleCost(records: number, recordBytes: number, changed: readonly DirtyRecordSpan[], gap: number, maxCalls: number, penalty: number): number {
  const occupied = new Uint8Array(records);
  for (const span of changed) occupied.fill(1, span.start, span.start + span.count);
  const runs: { start: number; end: number }[] = [];
  for (let i = 0; i < records; i++) {
    if (!occupied[i]) continue;
    const start = i;
    while (i + 1 < records && occupied[i + 1]) i++;
    const previous = runs[runs.length - 1];
    if (previous && start - previous.end <= gap) previous.end = i + 1;
    else runs.push({ start, end: i + 1 });
  }
  let best = records * recordBytes;
  for (let mask = 0; mask < (1 << (runs.length - 1)); mask++) {
    let calls = 1, bytes = 0, start = runs[0].start;
    for (let i = 1; i < runs.length; i++) {
      if ((mask & (1 << (i - 1))) === 0) continue;
      bytes += (runs[i - 1].end - start) * recordBytes;
      start = runs[i].start;
      calls++;
    }
    bytes += (runs[runs.length - 1].end - start) * recordBytes;
    if (calls <= maxCalls) best = Math.min(best, bytes + (calls - 1) * penalty);
  }
  return best;
}

let oracleCases = 0;
for (let mask = 1; mask < 256; mask++) {
  const changed: DirtyRecordSpan[] = [];
  for (let bit = 0; bit < 8; bit++) if (mask & (1 << bit)) changed.push({ start: bit, count: 1 });
  for (const gap of [0, 1, 2]) for (const penalty of [0, 4, 12, 1000]) for (const maxCalls of [1, 2, 4]) for (const minSaved of [0, 8]) {
    const plan = planSparseRecordUpload(8, 4, changed, {
      gapRecords: gap, maxCalls, callPenaltyBytes: penalty, minSavingsBytes: minSaved, costCoalescing: true,
    });
    const minimum = oracleCost(8, 4, changed, gap, maxCalls, penalty);
    const expected = 32 - minimum < minSaved ? 32 : minimum;
    const actual = plan.writtenBytes + (plan.callCount - 1) * penalty;
    check(actual === expected, `exhaustive cost oracle mask=${mask} gap=${gap} penalty=${penalty} calls=${maxCalls} savings=${minSaved}`);
    check(plan.callCount <= maxCalls, 'exact coalescing obeys the write-call budget');
    for (const span of changed) check(plan.spans.some(output => output.start <= span.start && output.start + output.count >= span.start + span.count),
      'exact coalescing retains every dirty record');
    oracleCases++;
  }
}

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
    costCoalescing: test % 2 === 0,
    maxCoverageFraction: test % 3 === 0 ? 0.5 : 1,
    maxPlanningSpans: test % 7 === 0 ? 8 : 256,
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

// Invoke the actual renderer upload method with a byte-copying queue fixture.
// This checks producer-version/layout authority, not native GPU performance.
const records = 4096;
let heap = new Float32Array(records * 20);
let frameVersion = 1, colorVersion = 1;
const matrixTarget = { data: new Uint8Array(records * 64) };
const colorTarget = { data: new Uint8Array(records * 16) };
const writes: { target: unknown; offset: number; size: number }[] = [];
const renderer = Object.assign(Object.create(WebGPURenderer.prototype), {
  disposed: false, deviceLoss: null, instanceCapacity: records,
  rigidSourceIdentity: null, rigidHeapIdentity: null, rigidHeapByteOffset: -1,
  rigidMatrixByteOffset: -1, rigidColorByteOffset: -1, rigidCount: -1,
  rigidFrameVersion: -1, rigidColorVersion: -1, shadowContentGeneration: 0,
  matrixBuffer: matrixTarget, colorBuffer: colorTarget, instancePartition: null,
  device: { queue: { writeBuffer(target: { data: Uint8Array }, offset: number, data: ArrayBuffer, dataOffset: number, size: number) {
    target.data.set(new Uint8Array(data, dataOffset, size), offset);
    writes.push({ target, offset, size });
  } } },
}) as WebGPURenderer;
const source = {
  get HEAPF32() { return heap; },
  frameVersion: () => frameVersion,
  colorVersion: () => colorVersion,
  _b3w_matrices_ptr: () => 0,
  _b3w_colors_ptr: () => records * 64,
  _b3w_body_count: () => records,
  _b3w_max_bodies: () => records,
};
let rendererProvenanceChecks = 0;
function byteParity(label: string) {
  const expected = new Uint8Array(heap.buffer, heap.byteOffset, heap.byteLength);
  for (let i = 0; i < matrixTarget.data.length; i++) check(matrixTarget.data[i] === expected[i], label + ': matrix byte ' + i);
  for (let i = 0; i < colorTarget.data.length; i++) check(colorTarget.data[i] === expected[records * 64 + i], label + ': color byte ' + i);
  rendererProvenanceChecks++;
}
function nextDelta(override: Partial<RigidInstanceDirtyEvidence> = {}): RigidInstanceDirtyEvidence {
  const previousFrameVersion = frameVersion;
  frameVersion++;
  heap[100 * 16 + 12] = frameVersion;
  return { previousFrameVersion, previousColorVersion: colorVersion, frameVersion, colorVersion,
    matrices: [{ start: 100, count: 1 }], ...override };
}
check(renderer.uploadInstances(source, records) === records * 80, 'renderer first upload is full');
byteParity('renderer initial upload');
const sparseProof = nextDelta();
writes.length = 0;
check(renderer.uploadInstances(source, records, sparseProof) === 64, 'authoritative matrix delta uses one record');
check(writes.length === 1 && writes[0].offset === 100 * 64 && writes[0].size === 64, 'actual sparse byte offsets');
byteParity('renderer sparse delta');
check(renderer.uploadInstances(source, records) === 0, 'unchanged versions retain the no-write path');

for (const mismatch of ['previousFrameVersion', 'previousColorVersion', 'frameVersion', 'colorVersion'] as const) {
  const proof = nextDelta({ [mismatch]: -999 });
  check(renderer.uploadInstances(source, records, proof) === records * 64, 'mismatched ' + mismatch + ' forces the full matrix stream');
  byteParity('renderer ' + mismatch);
}
const emptyProof = { previousFrameVersion: frameVersion, previousColorVersion: colorVersion,
  frameVersion: ++frameVersion, colorVersion, matrices: [] };
check(renderer.uploadInstances(source, records, emptyProof) === 0, 'certified unchanged matrix data across versions writes nothing');
byteParity('renderer certified unchanged data');
check(renderer.uploadInstances(source, records, nextDelta({ matrices: undefined })) === records * 64,
  'missing matrix evidence falls back per stream');
byteParity('renderer missing evidence');
check(renderer.uploadInstances({ ...source }, records, nextDelta()) === records * 80,
  'source identity change invalidates both caches');
check(renderer.uploadInstances(source, records) === records * 80, 'return to original source restores both streams');
byteParity('renderer source identity');

const padded = new Float32Array(heap.length * 2);
padded.set(heap, heap.length);
heap = padded.subarray(heap.length);
check(renderer.uploadInstances(source, records, nextDelta()) === records * 80, 'new heap and view force full writes');
byteParity('renderer heap replacement');
check(renderer.uploadInstances(source, records, nextDelta()) === 64, 'sparse write honors nonzero heap-view offset');
byteParity('renderer heap view offset');
heap = padded.subarray(0, heap.length);
check(renderer.uploadInstances(source, records, nextDelta()) === records * 80, 'same heap with a different view offset forces full writes');
byteParity('renderer changed view offset');

check(renderer.uploadInstances(source, records - 1, nextDelta()) === (records - 1) * 80, 'count change invalidates both caches');
check(renderer.uploadInstances(source, records) === records * 80, 'count growth refreshes the full active source');
byteParity('renderer count transitions');
writes.length = 0;
throws(() => renderer.uploadInstances(source, records, nextDelta({ matrices: [{ start: records, count: 1 }] })),
  'invalid authoritative range is rejected');
check(writes.length === 0, 'invalid matrix range queues no write');
check(renderer.uploadInstances(source, records) === records * 64, 'full upload safely recovers after rejected range');
byteParity('renderer validation recovery');
for (const count of [-1, 0.5, records + 1, Number.NaN]) throws(() => renderer.uploadInstances(source, count), 'invalid renderer count reject');
throws(() => renderer.uploadInstances({ ...source, _b3w_body_count: () => records + 1 }, records), 'invalid source capacity reject');

console.log(JSON.stringify({ test: 'sparse-upload', replayed, sparse, full, none, boundaryChecks, oracleCases, rendererProvenanceChecks, correct: true }));
