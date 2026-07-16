import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedBaselineArchive = 'benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz';
const expectedBaselineSha256 = 'dea18ff88e86568e5449c9dece5610d0dfadf38d901eef1c1e39155c64e8c3f5';

const read = (relativePath) => JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
const sha256File = (relativePath) => crypto
  .createHash('sha256')
  .update(fs.readFileSync(path.join(root, relativePath)))
  .digest('hex');
const exactIds = (count) => Array.from({ length: count }, (_, index) => index + 1);
const geometricMean = (values) =>
  Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
const classificationTotal = (summary) =>
  summary.accepted
  + summary.borderline
  + summary.rejectedNoWin
  + summary.rejectedCorrectness
  + summary.controls;

assert.equal(
  sha256File(expectedBaselineArchive),
  expectedBaselineSha256,
  'the bundled v1.10 source baseline must match the release SHA-256 exactly',
);

// The release headline is a scene-diverse production-path tournament, not a
// collection of unrelated microbenchmarks. Every record must be classified,
// deterministic within each version, and within its declared fidelity bounds.
const tournament = read('benchmarks/results/v111-production-100.json');
assert.equal(tournament.baselineArchive, expectedBaselineArchive, 'production tournament must use the bundled v1.10 baseline');
assert.equal(tournament.caseCount, 100, 'v1.11 production tournament must contain exactly 100 experiments');
assert.equal(tournament.records.length, 100, 'v1.11 production result array must contain exactly 100 records');
assert.deepEqual(tournament.records.map((entry) => entry.id), exactIds(100), 'production experiment IDs must cover 1–100 exactly once');
assert.equal(tournament.samples, 8, 'release tournament must retain eight balanced timed samples per version/case');
assert.equal(tournament.workloadScale, 1, 'release tournament must use the full workload scale');
assert.equal(classificationTotal(tournament.summary), 100, 'all 100 production outcomes must be classified exactly once');
assert.equal(tournament.summary.rejectedCorrectness, 0, 'no retained v1.11 production path may fail correctness');
assert.equal(tournament.summary.deterministicGroups, 200, 'both versions of all 100 experiments must be deterministic');
assert.equal(tournament.summary.unchangedGroupCount, 10, 'the tournament must retain ten unchanged-frame groups');
assert.equal(tournament.summary.unchangedExactGroups, 10, 'all unchanged-frame groups must pass their exactness gate');
assert.ok(tournament.summary.changedGeometricMean >= 1.03, 'changed production paths must retain at least a 1.03x geometric-mean speedup');
for (const entry of tournament.records) {
  assert.equal(entry.baselineDeterministic, true, `production case ${entry.id} baseline was not deterministic`);
  assert.equal(entry.candidateDeterministic, true, `production case ${entry.id} candidate was not deterministic`);
  assert.equal(entry.correctness?.correct, true, `production case ${entry.id} failed correctness`);
  assert.ok(entry.correctness.stateError <= entry.correctness.fidelityLimit, `production case ${entry.id} exceeded its state-fidelity limit`);
  assert.ok(entry.correctness.matrixError <= entry.correctness.renderLimit, `production case ${entry.id} exceeded its matrix-fidelity limit`);
  assert.ok(entry.correctness.colorError <= entry.correctness.renderLimit, `production case ${entry.id} exceeded its color-fidelity limit`);
  assert.ok(entry.correctness.lineError <= entry.correctness.renderLimit, `production case ${entry.id} exceeded its line-fidelity limit`);
}
const categoryCounts = Object.fromEntries(tournament.categories.map((entry) => [entry.category, entry.cases]));
assert.deepEqual(categoryCounts, {
  'cloth-wasm': 30,
  'rope-wasm': 25,
  fallback: 15,
  effects: 10,
  'water-control': 10,
  'js-control': 5,
  'unchanged-control': 5,
}, 'production tournament category coverage changed');
assert.ok(tournament.categories.every((entry) => entry.correctnessFailures === 0), 'a production category reported a correctness failure');

// Controls are intentionally unchanged source paths. Protect their aggregate
// parity separately from the changed-path win gate so a fast changed case
// cannot hide a broad regression elsewhere. Effects and unchanged-frame
// controls run close enough to timer/JIT floors that they keep aggregate and
// exactness gates instead of brittle per-case timing floors.
const controls = tournament.records.filter((entry) => entry.control === true);
assert.equal(controls.length, 74, 'production tournament control coverage changed');
assert.ok(controls.every((entry) => entry.decision === 'control'), 'a production control was misclassified');
const nonTimerControls = controls.filter((entry) => entry.category !== 'unchanged-control');
assert.ok(
  geometricMean(nonTimerControls.map((entry) => entry.speedup)) >= 0.98,
  'non-timer production controls regressed in aggregate',
);
for (const [category, floor] of Object.entries({
  'cloth-wasm': 0.97,
  'rope-wasm': 0.97,
  'water-control': 0.97,
  'js-control': 0.97,
  effects: 0.95,
})) {
  const records = controls.filter((entry) => entry.category === category);
  assert.ok(records.length > 0, `missing ${category} production controls`);
  assert.ok(
    geometricMean(records.map((entry) => entry.speedup)) >= floor,
    `${category} production controls regressed in aggregate`,
  );
}
const stableControls = controls.filter((entry) => !['effects', 'unchanged-control'].includes(entry.category));
assert.ok(stableControls.every((entry) => entry.speedup >= 0.94), 'a stable production control regressed by more than 6%');
const unchangedControls = controls.filter((entry) => entry.category === 'unchanged-control');
assert.ok(unchangedControls.every((entry) =>
  entry.withinRunExact
  && entry.baselineWithinRunExact
  && entry.candidateWithinRunExact), 'an unchanged-frame control lost exactness');

// Long-horizon and interaction qualifications protect the deliberately narrow
// fused cloth schedule. Rope stays on the conservative path.
const horizon = read('benchmarks/results/v111-long-horizon-fidelity.json');
assert.equal(horizon.sourceStableDuringRun, true, 'long-horizon source changed during qualification');
assert.equal(horizon.summary.total, 100, 'long-horizon qualification must cover 100 cloth/rope scenes');
assert.equal(horizon.summary.passed, 100, 'all long-horizon qualification scenes must pass');
assert.equal(horizon.summary.failed, 0, 'long-horizon qualification may not contain failures');
assert.equal(horizon.summary.fastPath, 5, 'only the five qualified cloth scenes may use the fused schedule');
assert.equal(horizon.summary.conservative, 95, '95 cloth/rope scenes must remain conservative');
assert.equal(horizon.summary.deterministic, true, 'long-horizon qualification must be deterministic');
assert.equal(horizon.summary.finite, true, 'long-horizon qualification must remain finite');
assert.equal(horizon.summary.metadataExact, true, 'long-horizon metadata must remain exact');
assert.equal(horizon.summary.topologyExact, true, 'long-horizon topology must remain exact');
assert.ok(horizon.summary.maxStateRelativeL2 <= 0.002, 'long-horizon state error exceeded the 0.2% release ceiling');

const interaction = read('benchmarks/results/v111-fastpath-interaction-fidelity.json');
assert.equal(interaction.sourceStableDuringRun, true, 'interaction source changed during qualification');
assert.equal(interaction.summary.total, 8, 'fast-path interaction qualification must cover eight schedules');
assert.equal(interaction.summary.actualPassed, 8, 'all actual interaction schedules must pass');
assert.equal(interaction.summary.actualFailed, 0, 'actual interaction qualification may not contain failures');
assert.equal(interaction.summary.dynamicGuardPassed, 8, 'all dynamic fallback guards must pass');
assert.equal(interaction.summary.prearmedGuardPassed, 8, 'all pre-armed fallback guards must pass');
assert.equal(interaction.summary.actionsExact, true, 'interaction action sequences must remain exact');
assert.equal(interaction.summary.actualDeterministic, true, 'actual interaction schedules must be deterministic');
assert.equal(interaction.summary.actualFinite, true, 'actual interaction schedules must remain finite');
assert.ok(interaction.summary.maxActualStateRelativeL2 <= 0.002, 'interaction state error exceeded the 0.2% release ceiling');

// Camera matrices: exact Float32 output, zero per-resolve source allocations,
// and a material win even when every camera input changes.
const camera = read('benchmarks/results/camera-path-v110.json');
assert.equal(camera.passed, true, 'camera matrix benchmark did not pass');
assert.equal(camera.baseline.archiveSha256, expectedBaselineSha256, 'camera benchmark used the wrong v1.10 baseline');
assert.equal(camera.fidelity.cases, 4096, 'camera fidelity set must contain 4,096 cases');
assert.equal(camera.fidelity.viewBitMismatches, 0, 'camera view-projection output changed at the Float32 bit level');
assert.equal(camera.fidelity.lightBitMismatches, 0, 'camera light-projection output changed at the Float32 bit level');
assert.equal(camera.fidelity.eyeValueMismatches, 0, 'camera eye output changed');
assert.equal(camera.optimized.sourceLevelHeapAllocationsPerResolve, 0, 'camera resolve reintroduced source-level heap allocation');
assert.ok(camera.workloads.find((entry) => entry.name === 'static-camera')?.speedup >= 10, 'static camera cache must retain at least a 10x subsystem win');
assert.ok(camera.workloads.find((entry) => entry.name === 'fully-changing-cinematic-shake')?.speedup >= 1.20, 'fully changing camera path must retain at least a 1.20x subsystem win');

// Main-loop line staging: exact across mixed active/paused/toggle frames. The
// paused ratios are work-elimination subsystem numbers; mixed and forced-active
// controls prevent those timer-floor results from hiding a rebuild regression.
const frameLines = read('benchmarks/results/v111-main-frame-lines.json');
assert.equal(frameLines.decision, 'accepted', 'main-frame line staging was not accepted');
assert.equal(frameLines.acceptance.passed, true, 'main-frame line staging acceptance gate failed');
assert.equal(frameLines.source.baselineArchive, expectedBaselineArchive, 'main-frame line benchmark used the wrong baseline archive');
assert.equal(frameLines.source.baselineArchiveSha256, expectedBaselineSha256, 'main-frame line benchmark used the wrong baseline SHA-256');
assert.equal(frameLines.exactness.framesCompared, 4096, 'main-frame line exactness suite must cover 4,096 frames');
assert.equal(frameLines.exactness.floatFieldsComparedPerLine, 10, 'main-frame line exactness must cover all ten float fields');
assert.equal(frameLines.exactness.mismatches, 0, 'main-frame line staging changed a line count or float field');
assert.ok(frameLines.exactness.unchangedIdentityChecks > 0, 'main-frame line suite must prove unchanged-frame identity reuse');
assert.ok(frameLines.benchmark.samples >= 9, 'main-frame line benchmark must retain at least nine timed samples');
assert.equal(frameLines.benchmark.alternatingOrder, true, 'main-frame line benchmark must alternate baseline/candidate order');
const frameLinesByName = Object.fromEntries(frameLines.benchmark.scenarios.map((entry) => [entry.name, entry]));
assert.ok(frameLinesByName['paused-diagnostics'].paired95[0] > 1, 'paused diagnostic line staging lower confidence bound must clear parity');
assert.ok(frameLinesByName['paused-effects'].paired95[0] > 1, 'paused effect line staging lower confidence bound must clear parity');
assert.ok(frameLinesByName['mixed-60hz'].paired95[0] > 1, 'mixed 60 Hz line staging lower confidence bound must clear parity');
assert.ok(frameLinesByName['active-diagnostics'].paired95[0] >= 0.97, 'forced active line rebuild regressed beyond the 0.97x guard');

// Lazy replay hashing is cadence-sensitive. The sync-only and telemetry paths
// are retained wins; hash-every-sync is an explicit non-win boundary.
const nativeHash = read('benchmarks/results/native-lazy-hash-benchmark.json');
assert.equal(nativeHash.correctness.exactMatrixBits, true, 'native lazy hash changed transform bits');
assert.equal(nativeHash.correctness.exactReplayHash, true, 'native lazy hash changed the replay hash');
const nativeHashById = Object.fromEntries(nativeHash.results.map((entry) => [entry.id, entry]));
assert.ok(nativeHashById['sync-only'].speedup >= 5, 'native sync-only bridge path must retain at least a 5x subsystem win');
assert.ok(nativeHashById['hash-every-12-syncs'].speedup >= 3, 'native telemetry-cadence bridge path must retain at least a 3x subsystem win');
assert.ok(nativeHashById['hash-every-sync'].speedup < 1, 'native hash-every-sync must remain documented as a rejected cadence');

const fallbackHash = read('benchmarks/results/v111-fallback-lazy-hash.json');
assert.equal(fallbackHash.baseline.archiveSha256, expectedBaselineSha256, 'fallback hash benchmark used the wrong v1.10 baseline');
assert.equal(fallbackHash.verdict.realWin, true, 'fallback lazy replay hash was not retained as a real cadence win');
const fallbackHashByMode = Object.fromEntries(fallbackHash.modeAggregates.map((entry) => [entry.mode, entry]));
assert.ok(fallbackHash.modeAggregates.every((entry) => entry.allExact), 'fallback lazy replay hash changed an output');
assert.ok(fallbackHashByMode['sync-only'].geometricMeanSpeedup >= 1.20, 'fallback sync-only path must retain at least a 1.20x aggregate win');
assert.ok(fallbackHashByMode['telemetry-cadence'].geometricMeanSpeedup >= 1.20, 'fallback telemetry-cadence path must retain at least a 1.20x aggregate win');
assert.ok(fallbackHashByMode['hash-every-sync'].geometricMeanSpeedup < 1.03, 'fallback hash-every-sync must remain classified as parity/non-win');

// Exact soft-system work reductions and memory right-sizing.
const soft = read('benchmarks/results/v111-soft-exact-gains.json');
assert.equal(soft.sourceStableDuringRun, true, 'soft-system source changed during its benchmark');
assert.equal(soft.currentSourceFingerprint, soft.currentSourceFingerprintAtEnd, 'soft-system source fingerprint changed during its benchmark');
assert.ok(Object.values(soft.correctness).flat().every((entry) => entry.exact), 'an exact soft-system comparison failed');
assert.ok(soft.timings.every((entry) => entry.retained), 'a soft-system timing marked for rejection was retained');
const softTiming = Object.fromEntries(soft.timings.map((entry) => [entry.name, entry]));
assert.ok(softTiming['Sphere-collider solve (10 scenes × 36 frames)'].speedup >= 1.03, 'sphere collision precheck must retain at least a 1.03x subsystem win');
assert.ok(softTiming['Cloth explosion actions (50 scenes × 32)'].speedup >= 2, 'cloth explosion rejection must retain at least a 2x subsystem win');
assert.ok(softTiming['Rope explosion actions (50 scenes × 32)'].speedup >= 2, 'rope explosion rejection must retain at least a 2x subsystem win');
const memoryByName = Object.fromEntries(soft.memory.summary.map((entry) => [entry.name, entry]));
assert.ok(memoryByName.all.reduction >= 0.30, 'soft-system retained typed-array memory must fall by at least 30% overall');
assert.ok(memoryByName.rope.reduction >= 0.70, 'rope retained typed-array memory must fall by at least 70%');
assert.equal(soft.caps.summary.cloth.maxInstances, 161, 'cloth instance capacity changed from the audited exact cap');
assert.equal(soft.caps.summary.rope.maxInstances, 97, 'rope instance capacity changed from the audited exact cap');
assert.equal(soft.caps.summary.water.maxInstances, 788, 'water instance capacity changed from the audited exact cap');

// Fallback rigid-body exact work reductions.
const fallback = read('benchmarks/results/v111-fallback-exact-gains.json');
assert.equal(fallback.passed, true, 'fallback static/explosion benchmark did not pass');
assert.equal(fallback.baselineSha256, expectedBaselineSha256, 'fallback benchmark used the wrong v1.10 baseline');
assert.equal(fallback.sourceStableDuringRun, true, 'fallback source changed during its exact-gains benchmark');
assert.equal(fallback.capturesDetached, true, 'fallback benchmark captures must be detached from mutable source buffers');
assert.equal(fallback.exactComparisons, 273, 'fallback static/explosion suite must retain 273 exact comparisons');
assert.ok(fallback.groups.every((entry) => entry.records.every((record) => record.exact)), 'fallback static/explosion output changed');
assert.ok(fallback.groups.find((entry) => entry.label.includes('static'))?.geometricMean >= 1.10, 'one-time fallback static streams must retain at least a 1.10x aggregate win');
assert.ok(fallback.groups.find((entry) => entry.label.includes('explosions'))?.geometricMean >= 2, 'fallback explosion rejection must retain at least a 2x aggregate win');
assert.ok(fallback.boundaryCases.every((entry) => entry.exact), 'fallback explosion boundary case changed');

const pair = read('benchmarks/results/v111-fallback-pair-exact-gains.json');
assert.equal(pair.archiveSha256, expectedBaselineSha256, 'fallback contact benchmark used the wrong v1.10 baseline');
assert.equal(pair.passed, true, 'allocation-free fallback contact benchmark did not pass');
assert.equal(pair.sourceStableDuringRun, true, 'fallback contact source changed during its benchmark');
assert.equal(pair.samples, 21, 'fallback contact proof must retain 21 timed samples');
assert.equal(pair.timedFrames, 72, 'fallback contact proof must retain 72 timed frames per sample');
assert.equal(pair.exactComparisons, 504, 'fallback contact proof must retain 504 exact comparisons');
assert.equal(pair.benchmark.accepted, true, 'allocation-free fallback contact resolver was not accepted');
assert.ok(pair.benchmark.pairedBootstrap95.lower >= 1.02, 'fallback contact lower confidence bound must clear 1.02x');
assert.ok(pair.benchmark.minimumSpeedupVsControl >= 0.98, 'no fallback contact scene may regress by more than 2%');
assert.ok(pair.benchmark.records.every((entry) => entry.exact), 'fallback contact resolver changed an output');

// Native Box3D revisions retain exact state, remove settled work, and split the
// rigid transform/material uploads without claiming active-step acceleration.
const nativeRigid = read('benchmarks/results/native-rigid-stream.json');
assert.equal(nativeRigid.passed, true, 'native rigid-stream benchmark did not pass');
assert.ok(Object.values(nativeRigid.gates).every(Boolean), 'a native rigid-stream gate failed');
assert.equal(nativeRigid.metalUploadValidation.uncapturedWebGpuErrors, 0, 'native rigid upload produced a WebGPU error');
assert.ok(nativeRigid.measurements.settled.speedup >= 50, 'settled native step path must retain at least a 50x subsystem win');
assert.ok(nativeRigid.uploadVolume.activeReductionPercent >= 19.99, 'active rigid upload must remain approximately 20% smaller');
assert.equal(nativeRigid.uploadVolume.optimizedSettledBytesPerFrame, 0, 'settled rigid state must upload zero bytes');
assert.ok(nativeRigid.rejectedCandidates.some((entry) => entry.name.includes('move-event') && entry.decision.startsWith('rejected')), 'rejected Box3D move-event candidate is missing');

const nativeUpload = read('benchmarks/results/native-rigid-upload-metal.json');
assert.equal(nativeUpload.result, 'passed', 'native Metal upload validation did not pass');
assert.equal(nativeUpload.uncapturedWebGpuErrors, 0, 'native Metal upload validation reported a WebGPU error');
assert.equal(nativeUpload.actualGpuQueueUploadBytes.settledUnchanged, 0, 'settled native Metal path must upload zero bytes');

// This is the sole timing-overlap exception: dead packed-water startup work is
// retained as a strict resource/pipeline elimination, not as a claimed timing
// win. Exact pixels and zero WebGPU errors are still mandatory.
const deadWater = read('benchmarks/results/dead-packed-water-startup-metal.json');
assert.equal(deadWater.passed, true, 'dead packed-water removal validation did not pass');
assert.equal(deadWater.retentionGate.resourceAndPipelineWorkStrictlyEliminated, true, 'dead packed-water work was not strictly eliminated');
assert.equal(deadWater.pipelineReduction.shaderModules, 1, 'dead packed-water removal must eliminate one shader module');
assert.equal(deadWater.pipelineReduction.renderPipelines, 2, 'dead packed-water removal must eliminate two render pipelines');
assert.equal(deadWater.exactRuntimeValidation.controlAndOptimizedPixelHashesExact, true, 'dead packed-water removal changed rendered pixels');
assert.equal(deadWater.exactRuntimeValidation.uncapturedWebGpuErrors, 0, 'dead packed-water validation reported a WebGPU error');
// Deliberately no startup-speed assertion: its confidence/noise interval may overlap.

// Exact shadow reuse was rejected and fully reverted. Preserve its positive
// exactness/paused evidence as well as the active-path confidence miss so a
// later pass cannot promote the candidate without clearing the same gate.
const shadow = read('benchmarks/results/shadow-cache-metal.json');
assert.equal(shadow.passed, false, 'rejected shadow-cache candidate unexpectedly passed');
assert.equal(shadow.retained, false, 'rejected shadow-cache candidate was not reverted');
assert.equal(shadow.decision, 'rejected-reverted', 'shadow-cache rejection classification changed');
assert.equal(
  sha256File('src/webgpu/renderer.ts'),
  shadow.sourceIntegrity.retainedRendererSha256,
  'release renderer does not match the post-revert shadow evidence',
);
assert.notEqual(shadow.sourceIntegrity.candidateRendererSha256, shadow.sourceIntegrity.retainedRendererSha256,
  'shadow candidate and retained renderer unexpectedly match');
assert.equal(shadow.gates.activePassed, false, 'shadow-cache active-path gate must record the rejection');
assert.ok(shadow.dependencyGates.every((entry) => entry.passed), 'a shadow dependency invalidation gate failed');
assert.ok(Object.values(shadow.exactPixelGates).every((entry) => entry.passed && entry.exact), 'a shadow-cache exact-pixel gate failed');
assert.equal(shadow.webgpuErrors.length, 0, 'shadow-cache validation reported a WebGPU error');
assert.ok(shadow.measurements.unchanged.rigid.speedup.ci95[0] > 1, 'paused rigid shadow-cache lower confidence bound must clear parity');
assert.ok(shadow.measurements.unchanged.cloth.speedup.ci95[0] > 1, 'paused cloth shadow-cache lower confidence bound must clear parity');
assert.ok(shadow.gpuTimestampEvidence.activeControls.rigid.fields.cpuSubmitMs.speedup.ci95[0] < 0.98,
  'shadow-cache rejection must preserve the active rigid CPU-submit confidence miss');

// The visible relative-base browser pass is recorded separately from Dawn's
// headless pipeline validation. It proves the packaged module URL, native
// Box3D selection, interactive soft domains, and the complete in-app catalog
// sweep in the environment where the Pages-only import bug was found.
const browserAcceptance = read('benchmarks/results/v111-visible-browser-acceptance.json');
assert.equal(browserAcceptance.passed, true, 'visible browser acceptance did not pass');
assert.equal(browserAcceptance.environment.displayedVersion, 'v1.11.0', 'visible browser version badge was stale');
assert.equal(browserAcceptance.backend.nativeArtifactLoaded, true, 'visible browser did not load native Box3D WASM');
assert.ok(['rigid', 'cloth', 'rope', 'water'].every((domain) =>
  browserAcceptance.interactiveChecks.some((entry) => entry.domain === domain && entry.passed)),
'visible browser acceptance did not cover every simulation domain');
assert.equal(browserAcceptance.stateValidation.scenesPassed, 750, 'visible browser scene sweep was incomplete');
assert.equal(browserAcceptance.stateValidation.heroSequencesPassed, 30, 'visible browser hero sweep was incomplete');
assert.equal(browserAcceptance.stateValidation.effectsPassed, true, 'visible browser effects validation failed');
assert.equal(browserAcceptance.regressionFoundAndFixed.regressionAssertionAdded, true,
  'relative-base native-module regression was not protected by a source assertion');

// Rejected candidates are part of the release proof: these results prevent a
// later refactor from quietly reintroducing faster-looking but unproven edits.
const rendererRejected = read('benchmarks/results/renderer-hotpath-metal.json');
assert.equal(rendererRejected.sourceIntegrity.archiveSha256, expectedBaselineSha256, 'renderer rejection tournament used the wrong v1.10 baseline');
assert.equal(rendererRejected.candidateSummaries.length, 4, 'renderer rejection tournament must retain four candidate summaries');
assert.ok(rendererRejected.candidateSummaries.every((entry) => entry.fidelityPassed), 'a renderer candidate failed fidelity unexpectedly');
assert.ok(rendererRejected.candidateSummaries.every((entry) => entry.decision === 'revert-no-stable-benefit'), 'an unproven renderer candidate was not reverted');

for (const relativePath of [
  'benchmarks/results/v111-long-horizon-rejected-100.json',
  'benchmarks/results/v111-qualification-guard-rejected-100.json',
]) {
  const rejected = read(relativePath);
  assert.equal(rejected.baselineArchive, expectedBaselineArchive, `${relativePath} used the wrong baseline archive`);
  assert.equal(rejected.caseCount, 100, `${relativePath} must retain exactly 100 search cases`);
  assert.equal(rejected.records.length, 100, `${relativePath} must retain exactly 100 records`);
  assert.deepEqual(rejected.records.map((entry) => entry.id), exactIds(100), `${relativePath} IDs must cover 1–100 exactly once`);
  assert.ok(rejected.summary.rejectedCorrectness > 0, `${relativePath} must preserve evidence that aggressive candidates were rejected for correctness`);
  assert.equal(rejected.summary.deterministicGroups, 200, `${relativePath} must preserve 200 deterministic version groups`);
}

console.log(
  `✅ v1.11 evidence gate passed: exact v1.10 baseline, 100 production experiments, `
  + `${tournament.summary.accepted} accepted wins, ${tournament.summary.changedGeometricMean.toFixed(3)}x changed-path GM, `
  + `${pair.benchmark.geometricMeanVsControl.toFixed(3)}x exact fallback-contact GM, `
  + 'exact camera/native/soft/resource gates, binding shadow-cache rejection, zero retained-path correctness failures',
);
