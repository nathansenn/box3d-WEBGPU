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
  gapRecords?: number;
  maxCalls?: number;
  /** Approximate write-call overhead expressed in equivalent bytes. */
  callPenaltyBytes?: number;
  minSavingsBytes?: number;
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

/**
 * The full upload is always the safe fallback. An empty dirty list means the
 * producer explicitly certifies that no record changed between two revisions.
 * Keep the result independent of GPU throughput assumptions until calibrated.
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
  for (const [value, name] of [[gap, 'gap'], [maxCalls, 'max calls'], [penalty, 'call penalty'], [minSaved, 'minimum savings']] as const) integer(value, name);
  if (maxCalls < 1) throw new RangeError('At least one upload call must be permitted');
  const sorted = changed.map(span => {
    integer(span.start, 'span start'); integer(span.count, 'span count');
    if (span.start > recordCount || span.count > recordCount - span.start) throw new RangeError('Dirty span outside stream');
    return { start: span.start, count: span.count };
  }).filter(span => span.count > 0).sort((a, b) => a.start - b.start);
  if (!sorted.length) return { mode: 'none', spans: [], writtenBytes: 0, fullBytes, callCount: 0 };
  const merged: { start: number; count: number }[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    const end = span.start + span.count;
    if (last && span.start <= last.start + last.count + gap) {
      last.count = Math.max(last.start + last.count, end) - last.start;
    } else {
      merged.push({ ...span });
    }
  }
  const sparseBytes = merged.reduce((sum, span) => sum + span.count * recordBytes, 0);
  // Overlap cannot produce more than one full stream; gap merging cannot
  // extend beyond the provided range and never drops changed records.
  const estimatedCost = sparseBytes + merged.length * penalty;
  if (sparseBytes >= fullBytes || merged.length > maxCalls || fullBytes - estimatedCost < minSaved) {
    return { mode: 'full', spans: [{ start: 0, count: recordCount }], writtenBytes: fullBytes, fullBytes, callCount: recordCount ? 1 : 0 };
  }
  return { mode: 'ranges', spans: merged, writtenBytes: sparseBytes, fullBytes, callCount: merged.length };
}
