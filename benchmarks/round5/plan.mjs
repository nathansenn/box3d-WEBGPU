/** Frozen Round 5 experiment family. This module has no GPU or native dependency. */
export const TRACKER_MODES = Object.freeze(['ranges', 'bitset', 'index-list', 'tile-32', 'dense-bypass']);
export const SEEDS = Object.freeze([0x5a170b21, 0x65c3d109]);
export const UPLOAD_POLICY = Object.freeze({ costCoalescing: true, callPenaltyBytes: 1024,
  maxCalls: 16, maxCoverageFraction: 1, minSavingsBytes: 4096, maxPlanningSpans: 256, gapRecords: 0 });
export const QUALITY = Object.freeze({ id: 'cinematic', label: 'Fixed qualification quality', exposure: 1.1,
  bloomStrength: .12, fogDensity: .002, shadowStrength: .85, effectBudget: 64,
  resolutionScale: 1, sampleCount: 4, shadowMapSize: 2048, shadowTapCount: 9 });
const synthetic = [];
for (const count of [4096, 16384]) for (const pattern of ['contiguous', 'clustered', 'scattered', 'dense']) {
  for (const streams of ['matrix-only', 'matrix+color']) synthetic.push(Object.freeze({
    id: `producer-${count}-${pattern}-${streams.replace('+', '-')}`, kind: 'synthetic', count, pattern, streams,
    changedRecordsPerFrame: pattern === 'dense' ? Math.ceil((count - 1) * .8) : count / 64,
    groundRecord: 0, scatteredStride: 997, clusterCount: 4,
    mutation: 'Matrix translation changes every selected record each frame. matrix+color also changes color every frame; matrix-only preserves color versions.',
    scope: 'Controlled deterministic producer; candidate tracking begins at the mutation and is charged to complete-frame timing.'
  }));
}
export const WORKLOADS = Object.freeze([...synthetic, ...[
  { id: 'native-stack-active', sceneId: 0, stress: 1, preSteps: 12 },
  { id: 'native-stack-stress', sceneId: 0, stress: 4, preSteps: 12 },
  { id: 'native-domino-active', sceneId: 50, stress: 1, preSteps: 12 },
  { id: 'native-stack-settled', sceneId: 0, stress: 1, preSteps: 600 },
].map(row => Object.freeze({ ...row, kind: 'native',
  scope: 'Actual checked-in Box3D WebAssembly scene. Native physics stepping is timed in both arms; candidate full-record dirty discovery and snapshot maintenance are timed. Native metadata is not producer-owned.' }))]);
export const PROTOCOL = Object.freeze({ width: 1920, height: 1080, quality: QUALITY,
  caseCount: 100, independentSets: 2, pairsPerSet: 32, framesPerWindow: 8, warmupWindowsPerArm: 2,
  seeds: SEEDS, caseOrderSeed: 0x28f139a7,
  nativePairSeed: '(seed + Math.imul(pairIndex, 0x9e3779b9)) >>> 0',
  baseline: 'Existing full-stream uploads for changed versions after identical producer work; unchanged-version upload caches remain active',
  candidate: 'One of five dirty-record tracking representations with one fixed upload policy',
  timing: 'Mutation or native physics step; candidate discovery, mark/finish, evidence construction and snapshot maintenance; planning, upload, shadow/HDR/post passes, and queue completion for eight serialized frames.',
  excluded: 'Fixture reset and native pre-stepping, tracker construction, initial full upload/render, warmup, compilation, GPU timing-result drain, exact pixel/buffer readbacks and filesystem writes.',
  diagnostics: 'Candidate per-frame tracking receipts (scalar dirty counts, coverage, full flags and span counts) are constructed and retained inside timing. Per-frame upload accounting is charged to both arms.',
  timestamps: 'Every arm requires finite positive main/post timestamps. Cached shadow passes may be absent; optional shadow/compute times must be finite and nonnegative when present. Existing shadow reuse remains enabled.',
  inference: { method: 'Exact paired directional sign tests, excluding ties, in one Holm family of 400 hypotheses',
    alpha: .05, minimumMedianSpeedup: 1.03, regressionRatio: 1 / 1.03, maximumP95Ratio: 1.10,
    requiredSets: 2, independentSetSize: 32, familySize: 400 },
  parity: 'First and last measured pair of each independent set: exact all-pixel equality, full matrix and color GPU readback versus CPU and opposite arm; every measured arm has a valid last-frame GPU timestamp receipt.',
  scope: 'Native Dawn WebGPU offscreen complete-frame windows; not browser compositor or interactive game FPS.',
});
export function buildPlan() {
  const cases = WORKLOADS.flatMap(workload => TRACKER_MODES.map(mode => ({
    id: '', workload: { ...workload }, mode, uploadPolicy: { ...UPLOAD_POLICY }
  }))).map((row, index) => ({ ...row, id: `R5-${String(index + 1).padStart(3, '0')}` }));
  const executionOrder = cases.map(row => row.id); let state = PROTOCOL.caseOrderSeed >>> 0;
  for (let i = executionOrder.length - 1; i > 0; i--) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    const j = (state >>> 0) % (i + 1); [executionOrder[i], executionOrder[j]] = [executionOrder[j], executionOrder[i]];
  }
  const plan = { schema: 'box3d.round5.plan/1', protocol: PROTOCOL, uploadPolicy: UPLOAD_POLICY, cases, executionOrder };
  validatePlan(plan); return plan;
}
export function validatePlan(plan) {
  if (plan.cases.length !== 100 || new Set(plan.cases.map(row => row.id)).size !== 100) throw new Error('Expected 100 unique conditions');
  if (new Set(plan.executionOrder).size !== 100 || plan.executionOrder.some(id => !plan.cases.some(row => row.id === id))) throw new Error('Invalid execution order');
  if (new Set(plan.cases.map(row => row.workload.id)).size !== 20) throw new Error('Expected 20 workloads');
  for (const workload of WORKLOADS) {
    const modes = plan.cases.filter(row => row.workload.id === workload.id).map(row => row.mode);
    if (modes.length !== 5 || TRACKER_MODES.some(mode => !modes.includes(mode))) throw new Error('Incomplete tracking family: ' + workload.id);
  }
  if (plan.cases.some(row => JSON.stringify(row.uploadPolicy) !== JSON.stringify(UPLOAD_POLICY))) throw new Error('Upload policy must be fixed across all conditions');
  return true;
}
