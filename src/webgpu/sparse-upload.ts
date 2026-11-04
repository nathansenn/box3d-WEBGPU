/**
 * Source-proven, opt-in record ranges for a GPU-resident stream.
 *
 * A record may be sent by one or several adjacent GPUQueue.writeBuffer calls.
 * This planner NEVER infers changes by scanning scene data: callers must supply
 * an exhaustive changed-record set for the exact previous and next revisions.
 * Without such evidence the renderer uses its existing full-buffer path.
 */
export type DirtyRecordSpan = Readonly<{ start: number; count: number }>;
export type SparseUploadOptions = Readonly<{
  /** Always coalesce gaps this small before applying the cost model. */
  gapRecords?: number;
  maxCalls?: number;
  /** Approximate write-call overhead expressed in equivalent bytes. */
  callPenaltyBytes?: number;
  minSavingsBytes?: number;
  /** Bound output runs and sortable input spans; every input is still validated. */
  maxPlanningSpans?: number;
  /** Fall back when the selected ranges exceed this fraction of a full write. */
  maxCoverageFraction?: number;
  /** Opt in to optimal additive byte + call cost coalescing after gapRecords. */
  costCoalescing?: boolean;
}>;
export type SparseUploadPlan = Readonly<{
  mode: 'none' | 'ranges' | 'full';
  spans: readonly DirtyRecordSpan[];
  writtenBytes: number;
  fullBytes: number;
  callCount: number;
}>;

function integer(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name}`);
}

type MutableSpan = { start: number; count: number };

/**
 * For a fixed call penalty, keeping a gap saves gapBytes - penalty. Keeping
 * the largest positive savings, up to maxCalls - 1, is therefore optimal.
 * This is an exact cost-model result, not a measured GPU throughput claim.
 */
function coalesceByCost(spans: MutableSpan[], recordBytes: number, maxCalls: number, penalty: number): MutableSpan[] {
  if (spans.length < 2) return spans;
  const cuts: { index: number; bytes: number }[] = [];
  for (let i = 1; i < spans.length; i++) {
    const previous = spans[i - 1];
    const bytes = (spans[i].start - previous.start - previous.count) * recordBytes;
    if (bytes > penalty) cuts.push({ index: i, bytes });
  }
  if (cuts.length === spans.length - 1 && spans.length <= maxCalls) return spans;
  if (cuts.length >= maxCalls) {
    cuts.sort((a, b) => b.bytes - a.bytes || a.index - b.index);
    cuts.length = maxCalls - 1;
    cuts.sort((a, b) => a.index - b.index);
  }
  const result: MutableSpan[] = [];
  let start = spans[0].start, cut = 0;
  for (let i = 1; i < spans.length; i++) {
    if (cut < cuts.length && cuts[cut].index === i) {
      const previous = spans[i - 1];
      result.push({ start, count: previous.start + previous.count - start });
      start = spans[i].start;
      cut++;
    }
  }
  const last = spans[spans.length - 1];
  result.push({ start, count: last.start + last.count - start });
  return result;
}

/**
 * The full upload is always the safe fallback. An empty dirty list means the
 * producer explicitly certifies that no record changed between two revisions.
 * Monotonic producer ranges need no input copy or sort. Excessively fragmented
 * metadata is validated but bypasses normalization, bounding planner allocation
 * even when the only sensible action is a full upload. The optional cost model
 * must be calibrated on the target workload before enabling it in production.
 */
export function planSparseRecordUpload(
  recordCount: number,
  recordBytes: number,
  changed: readonly DirtyRecordSpan[],
  options: SparseUploadOptions = {},
): SparseUploadPlan {
  integer(recordCount, 'record count');
  integer(recordBytes, 'record byte size');
  if (recordBytes === 0 || recordBytes % 4 !== 0) throw new RangeError('Record size must be a positive multiple of four');
  const fullBytes = recordCount * recordBytes;
  if (!Number.isSafeInteger(fullBytes)) throw new RangeError('GPU upload exceeds safe integer capacity');
  const gap = options.gapRecords ?? 0;
  const maxCalls = options.maxCalls ?? 32;
  const penalty = options.callPenaltyBytes ?? 4096;
  const minSaved = options.minSavingsBytes ?? 4096;
  const maxPlanningSpans = options.maxPlanningSpans ?? 256;
  const maxCoverage = options.maxCoverageFraction ?? 1;
  integer(gap, 'gap');
  integer(maxCalls, 'max calls');
  integer(penalty, 'call penalty');
  integer(minSaved, 'minimum savings');
  integer(maxPlanningSpans, 'maximum planning spans');
  if (maxCalls < 1) throw new RangeError('At least one upload call must be permitted');
  if (!Number.isFinite(maxCoverage) || maxCoverage < 0 || maxCoverage > 1) throw new RangeError('Coverage fraction must be between zero and one');
  if (options.costCoalescing !== undefined && typeof options.costCoalescing !== 'boolean') throw new TypeError('Cost coalescing must be boolean');
  if (!Array.isArray(changed)) throw new TypeError('Dirty spans must be an array');

  // Do not skip validation after reaching the planning budget. A malformed
  // later span must never masquerade as a valid/unchanged stream.
  let nonempty = 0, monotonic = true, previousStart = -1;
  for (let i = 0; i < changed.length; i++) {
    const span = changed[i];
    if (!span || typeof span !== 'object') throw new RangeError('Invalid dirty span');
    integer(span.start, 'span start'); integer(span.count, 'span count');
    if (span.start > recordCount || span.count > recordCount - span.start) throw new RangeError('Dirty span outside stream');
    if (span.count === 0) continue;
    if (span.start < previousStart) monotonic = false;
    previousStart = span.start;
    nonempty++;
  }
  if (!nonempty) return { mode: 'none', spans: [], writtenBytes: 0, fullBytes, callCount: 0 };
  const full = (): SparseUploadPlan => ({ mode: 'full', spans: [{ start: 0, count: recordCount }], writtenBytes: fullBytes, fullBytes, callCount: 1 });
  if ((!monotonic && nonempty > maxPlanningSpans) || maxPlanningSpans === 0 ||
      fullBytes - recordBytes < minSaved || maxCoverage === 0) return full();

  let ordered: readonly DirtyRecordSpan[] = changed;
  if (!monotonic) {
    // Copy references only; merged output never aliases or mutates the input.
    const sorted: DirtyRecordSpan[] = [];
    for (let i = 0; i < changed.length; i++) if (changed[i].count > 0) sorted.push(changed[i]);
    sorted.sort((a, b) => a.start - b.start);
    ordered = sorted;
  }
  let merged: MutableSpan[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const span = ordered[i];
    if (span.count === 0) continue;
    const last = merged[merged.length - 1];
    const end = span.start + span.count;
    if (last && span.start - (last.start + last.count) <= gap) {
      last.count = Math.max(last.start + last.count, end) - last.start;
    } else {
      merged.push({ start: span.start, count: span.count });
      if (merged.length > maxPlanningSpans) return full();
      if (!options.costCoalescing && merged.length > maxCalls) return full();
    }
  }
  if (options.costCoalescing) merged = coalesceByCost(merged, recordBytes, maxCalls, penalty);
  let sparseBytes = 0;
  for (let i = 0; i < merged.length; i++) sparseBytes += merged[i].count * recordBytes;
  if (sparseBytes >= fullBytes || sparseBytes / fullBytes > maxCoverage) return full();

  // Compare like-for-like costs: fullBytes + one call versus sparseBytes +
  // callCount calls. Cancel the common call before comparison. Dividing the
  // remaining savings avoids overflow for otherwise valid safe-integer inputs.
  const availableSavings = fullBytes - sparseBytes - minSaved;
  const extraCalls = merged.length - 1;
  if (availableSavings < 0 || (extraCalls > 0 && penalty > Math.floor(availableSavings / extraCalls))) return full();
  return { mode: 'ranges', spans: merged, writtenBytes: sparseBytes, fullBytes, callCount: merged.length };
}
