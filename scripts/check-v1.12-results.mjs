import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedBaselineArchive = 'benchmarks/baselines/box3d-webgpu-v1.11.0-source.tar.gz';
const expectedBaselineSha256 = '7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537';
const expectedHarness = 'benchmarks/v112-production-100.cjs';
const defaultResult = 'benchmarks/results/v112-production-100.json';
const resultArgument = process.argv[2] || defaultResult;
const resultPath = path.isAbsolute(resultArgument) ? resultArgument : path.join(root, resultArgument);
const materialRegressionFloor = 0.95;

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function listDigestFiles(base, relativePath, output) {
  const absolute = path.join(base, relativePath);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absolute).sort()) {
      listDigestFiles(base, path.join(relativePath, entry), output);
    }
    return;
  }
  if (!/\.(?:ts|mjs|cjs|c|h|wgsl|json|sh)$/.test(relativePath)) return;
  output.push(relativePath.split(path.sep).join('/'));
}

function sourceDigest(base) {
  const files = [];
  for (const entry of [
    'src',
    'wasm',
    'scripts',
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'tsconfig.test.json',
  ]) {
    listDigestFiles(base, entry, files);
  }
  const hash = crypto.createHash('sha256');
  for (const relative of [...new Set(files)].sort()) {
    hash.update(relative);
    hash.update('\0');
    hash.update(fs.readFileSync(path.join(base, relative)));
    hash.update('\0');
  }
  return { sha256: hash.digest('hex'), fileCount: files.length };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function geometricMean(values) {
  assert.ok(values.length > 0, 'geometric mean requires at least one value');
  assert.ok(values.every((value) => Number.isFinite(value) && value > 0), 'geometric-mean values must be finite and positive');
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function approximatelyEqual(actual, expected, tolerance = 1e-9) {
  return Number.isFinite(actual) && Number.isFinite(expected) &&
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

function assertFinitePositive(value, message) {
  assert.ok(Number.isFinite(value) && value > 0, message);
}

function assertHexSha256(value, message) {
  assert.match(value, /^[0-9a-f]{64}$/, message);
}

function readEvidence(relativePath) {
  const absolute = path.join(root, relativePath);
  assert.ok(fs.existsSync(absolute), `missing v1.12 evidence: ${relativePath}`);
  return JSON.parse(fs.readFileSync(absolute, 'utf8'));
}

function groupBy(records, key) {
  const groups = new Map();
  for (const record of records) {
    const value = record[key];
    if (!groups.has(value)) groups.set(value, []);
    groups.get(value).push(record);
  }
  return groups;
}

assert.ok(fs.existsSync(resultPath), `missing v1.12 tournament result: ${resultPath}`);
const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));

// Exact provenance and source stability. The result is accepted only while the
// source and harness still match the bytes that produced its measurements.
const baselinePath = path.join(root, expectedBaselineArchive);
const harnessPath = path.join(root, expectedHarness);
assert.equal(sha256File(baselinePath), expectedBaselineSha256, 'bundled v1.11 archive SHA-256 changed');
assert.equal(result.schemaVersion, 4, 'v1.12 result schema must be version 4');
assert.equal(result.baselineArchive, expectedBaselineArchive, 'v1.12 tournament used the wrong baseline archive');
assert.equal(result.baselineArchiveSha256, expectedBaselineSha256, 'v1.12 result recorded the wrong baseline SHA-256');
assert.equal(result.smokeMode, false, 'smoke/subset evidence cannot pass the v1.12 release gate');
assert.equal(result.sourceStableDuringRun, true, 'candidate source changed during the benchmark');
assert.equal(result.harnessStableDuringRun, true, 'benchmark harness changed during the benchmark');
assert.deepEqual(result.candidateSourceDigestAtEnd, result.candidateSourceDigest, 'candidate start/end source digests differ');
assert.equal(result.harnessSha256AtEnd, result.harnessSha256, 'harness start/end SHA-256 values differ');
assertHexSha256(result.baselineSourceDigest?.sha256, 'missing/invalid baseline source digest');
assert.ok(result.baselineSourceDigest.fileCount > 0, 'baseline source digest has no files');
assertHexSha256(result.candidateSourceDigest?.sha256, 'missing/invalid candidate source digest');
assert.ok(result.candidateSourceDigest.fileCount > 0, 'candidate source digest has no files');
assertHexSha256(result.harnessSha256, 'missing/invalid benchmark harness SHA-256');
assert.deepEqual(sourceDigest(root), result.candidateSourceDigest, 'working source no longer matches the measured candidate digest');
assert.equal(sha256File(harnessPath), result.harnessSha256, 'current v1.12 harness no longer matches the measured harness');

const expectedAuditedFiles = [
  'src/math.ts',
  'src/effects.ts',
  'src/physics/fallback.ts',
  'src/soft/simulations.ts',
  'wasm/box3d_web.c',
];
assert.deepEqual(
  result.auditedRuntimeSourceFiles?.map((entry) => entry.path),
  expectedAuditedFiles,
  'audited v1.12 runtime-source set changed',
);
const expectedChangedState = new Map([
  ['src/math.ts', true],
  ['src/effects.ts', true],
  ['src/physics/fallback.ts', false],
  ['src/soft/simulations.ts', true],
  ['wasm/box3d_web.c', true],
]);
for (const entry of result.auditedRuntimeSourceFiles) {
  assert.equal(entry.changed, expectedChangedState.get(entry.path), `${entry.path} changed/reverted state is incorrect`);
  assertHexSha256(entry.baselineSha256, `${entry.path} lacks its v1.11 SHA-256`);
  assert.equal(entry.candidateSha256, sha256File(path.join(root, entry.path)), `${entry.path} no longer matches measured bytes`);
}

// Complete, balanced 100-case methodology.
assert.equal(result.caseCount, 100, 'v1.12 tournament must contain exactly 100 cases');
assert.equal(result.records?.length, 100, 'v1.12 record array must contain exactly 100 cases');
assert.deepEqual(result.records.map((record) => record.id), Array.from({ length: 100 }, (_, index) => index + 1), 'case IDs must cover 1–100 exactly once');
assert.ok(Number.isInteger(result.samples) && result.samples >= 8 && result.samples % 2 === 0, 'release evidence requires an even sample count of at least eight');
assert.ok(result.workloadScale >= 0.25, 'release evidence must use at least the default 0.25 workload scale');
assert.ok(result.targetBatchMs >= 25, 'release evidence must target at least 25 ms timed batches');
assert.ok(result.bootstrapCount >= 20000, 'release evidence must retain at least 20,000 bootstrap resamples');
assert.match(result.methodology?.order || '', /equal baseline-first and candidate-first/, 'methodology does not assert balanced execution order');
assert.match(result.methodology?.confidence || '', /95% stratified bootstrap/, 'methodology does not assert stratified confidence bounds');
assert.match(result.methodology?.timing || '', /setup, capture, and process startup excluded/, 'timing methodology does not identify excluded setup work');
assert.match(result.methodology?.determinism || '', /SHA-256 fingerprint/, 'determinism methodology is missing');
assert.ok(result.methodology?.changedPathMap && typeof result.methodology.changedPathMap === 'object', 'changed/control path map is missing');

const expectedCategoryCounts = {
  'cloth-wasm': 30,
  'rope-wasm': 25,
  fallback: 15,
  effects: 10,
  'water-rain': 5,
  'water-control': 5,
  'js-soft': 5,
  'unchanged-control': 5,
};
assert.deepEqual(
  Object.fromEntries(result.categories.map((category) => [category.category, category.cases])),
  expectedCategoryCounts,
  'v1.12 production category coverage changed',
);
assert.ok(result.categories.every((category) => category.correctnessFailures === 0), 'a category reports correctness failures');

const allowedDecisions = new Set(['accepted', 'borderline', 'rejected-no-win', 'rejected-correctness', 'control']);
const decisionCounts = {
  accepted: 0,
  borderline: 0,
  rejectedNoWin: 0,
  rejectedCorrectness: 0,
  controls: 0,
};

for (const record of result.records) {
  assert.ok(allowedDecisions.has(record.decision), `case ${record.id} has unknown decision ${record.decision}`);
  if (record.decision === 'accepted') decisionCounts.accepted++;
  else if (record.decision === 'borderline') decisionCounts.borderline++;
  else if (record.decision === 'rejected-no-win') decisionCounts.rejectedNoWin++;
  else if (record.decision === 'rejected-correctness') decisionCounts.rejectedCorrectness++;
  else decisionCounts.controls++;
  assert.equal(record.control === true, record.decision === 'control', `case ${record.id} control classification is inconsistent`);

  for (const field of ['baselineSamplesMs', 'candidateSamplesMs', 'baselineBatchElapsedMs', 'candidateBatchElapsedMs']) {
    assert.equal(record[field]?.length, result.samples, `case ${record.id} ${field} is not balanced at ${result.samples} samples`);
    assert.ok(record[field].every((value) => Number.isFinite(value) && value > 0), `case ${record.id} ${field} contains invalid timing`);
  }
  assertFinitePositive(record.baselineMedianMs, `case ${record.id} baseline median is invalid`);
  assertFinitePositive(record.candidateMedianMs, `case ${record.id} candidate median is invalid`);
  assertFinitePositive(record.speedup, `case ${record.id} speedup is invalid`);
  assert.ok(approximatelyEqual(record.speedup, record.orderBalanced?.speedup), `case ${record.id} does not use its order-balanced speedup`);
  for (const field of [
    'baselineFirstRatio',
    'candidateFirstRatio',
    'baselineFirstMedianMs',
    'baselineSecondMedianMs',
    'candidateFirstMedianMs',
    'candidateSecondMedianMs',
  ]) {
    assertFinitePositive(record.orderBalanced?.[field], `case ${record.id} has invalid order stratum ${field}`);
  }

  assert.equal(record.confidence?.confidence, 0.95, `case ${record.id} confidence level changed`);
  assert.equal(record.confidence?.resamples, result.bootstrapCount, `case ${record.id} bootstrap count changed`);
  assertFinitePositive(record.confidence?.lower, `case ${record.id} lower confidence bound is invalid`);
  assertFinitePositive(record.confidence?.median, `case ${record.id} confidence median is invalid`);
  assertFinitePositive(record.confidence?.upper, `case ${record.id} upper confidence bound is invalid`);
  assert.ok(record.confidence.lower <= record.confidence.median && record.confidence.median <= record.confidence.upper,
    `case ${record.id} confidence interval is unordered`);

  assert.ok(Number.isInteger(record.calibration?.safetyCap) && record.calibration.safetyCap >= 1 && record.calibration.safetyCap <= 512,
    `case ${record.id} calibration safety cap is invalid`);
  assert.ok(Number.isInteger(record.calibration?.repetitions) && record.calibration.repetitions >= 1 && record.calibration.repetitions <= record.calibration.safetyCap,
    `case ${record.id} calibration repetitions are invalid`);
  const actualMinimumBatch = Math.min(...record.baselineBatchElapsedMs, ...record.candidateBatchElapsedMs);
  assert.ok(approximatelyEqual(record.minimumTimedBatchMs, actualMinimumBatch), `case ${record.id} minimum batch summary is inconsistent`);
  const baselineBatchMedian = median(record.baselineBatchElapsedMs);
  const candidateBatchMedian = median(record.candidateBatchElapsedMs);
  const timingAdequate = record.calibration.repetitions === record.calibration.safetyCap ||
    (baselineBatchMedian >= result.targetBatchMs * 0.90 && candidateBatchMedian >= result.targetBatchMs * 0.90);
  assert.equal(timingAdequate, true, `case ${record.id} did not reach a stable calibrated timing batch and did not hit the safety cap`);

  assert.equal(record.baselineDeterministic, true, `case ${record.id} baseline is nondeterministic`);
  assert.equal(record.candidateDeterministic, true, `case ${record.id} candidate is nondeterministic`);
  assert.ok(record.baselineRepeatedSetupDeterministicSamples?.every(Boolean), `case ${record.id} baseline repeated setup drifted`);
  assert.ok(record.candidateRepeatedSetupDeterministicSamples?.every(Boolean), `case ${record.id} candidate repeated setup drifted`);
  assertHexSha256(record.baselineFingerprint, `case ${record.id} baseline fingerprint is invalid`);
  assertHexSha256(record.candidateFingerprint, `case ${record.id} candidate fingerprint is invalid`);
  assert.equal(record.correctness?.correct, true, `case ${record.id} failed correctness`);
  assert.equal(record.correctness.sameCounts, true, `case ${record.id} changed structural counts`);
  assert.equal(record.correctness.sameBreakCount, true, `case ${record.id} changed break topology/count`);
  assert.ok(record.correctness.stateError <= record.correctness.fidelityLimit, `case ${record.id} exceeded state fidelity`);
  assert.ok(record.correctness.matrixError <= record.correctness.renderLimit, `case ${record.id} exceeded matrix fidelity`);
  assert.ok(record.correctness.colorError <= record.correctness.renderLimit, `case ${record.id} exceeded color fidelity`);
  assert.ok(record.correctness.lineError <= record.correctness.renderLimit, `case ${record.id} exceeded debug-line fidelity`);

  const unchanged = record.operation === 'unchanged-frame' || record.operation === 'effect-unchanged-frame';
  if (unchanged) {
    assert.equal(record.withinRunExact, true, `case ${record.id} unchanged-frame path was not exact`);
    assert.equal(record.baselineWithinRunExact, true, `case ${record.id} baseline unchanged-frame path drifted`);
    assert.equal(record.candidateWithinRunExact, true, `case ${record.id} candidate unchanged-frame path drifted`);
  }
  if (record.decision === 'accepted') {
    assert.ok(record.speedup >= 1.03 && record.confidence.lower > 1,
      `case ${record.id} was accepted without a confidence-bounded material win`);
  }
}

assert.deepEqual(
  {
    accepted: result.summary.accepted,
    borderline: result.summary.borderline,
    rejectedNoWin: result.summary.rejectedNoWin,
    rejectedCorrectness: result.summary.rejectedCorrectness,
    controls: result.summary.controls,
  },
  decisionCounts,
  'summary classification counts do not match the 100 records',
);
assert.equal(Object.values(decisionCounts).reduce((sum, value) => sum + value, 0), 100, 'all 100 outcomes were not classified exactly once');
assert.equal(result.summary.rejectedCorrectness, 0, 'v1.12 retained a correctness failure');
assert.equal(result.summary.deterministicGroups, 200, 'both versions of all 100 cases must be deterministic');
assert.equal(result.summary.unchangedExactGroups, result.summary.unchangedGroupCount, 'an unchanged-frame group lost exactness');
assert.equal(result.summary.batchTargetMetCases,
  result.records.filter((record) => record.minimumTimedBatchMs >= result.targetBatchMs).length,
  'batch target summary is inconsistent');
assert.equal(result.summary.batchRepeatCapCases,
  result.records.filter((record) => record.calibration.repetitions === record.calibration.safetyCap).length,
  'batch repeat-cap summary is inconsistent');

const changed = result.records.filter((record) => !record.control);
assert.ok(changed.length > 0, 'v1.12 tournament contains no changed production paths');
assert.ok(approximatelyEqual(result.summary.changedGeometricMean, geometricMean(changed.map((record) => record.speedup))),
  'changed-path geometric mean is inconsistent');
assert.ok(approximatelyEqual(result.summary.changedMedian, median(changed.map((record) => record.speedup))),
  'changed-path median is inconsistent');

// Use the geometric mean of every per-case lower confidence bound as a
// deliberately conservative category-level confidence bound. A fast case may
// not hide a confidence-bounded regression of another changed subsystem.
const changedGroups = groupBy(changed, 'category');
const aggregateConfidence = [];
for (const [category, records] of changedGroups) {
  const pointEstimate = geometricMean(records.map((record) => record.speedup));
  const conservativeLowerBound = geometricMean(records.map((record) => record.confidence.lower));
  aggregateConfidence.push({ category, cases: records.length, pointEstimate, conservativeLowerBound });
  assert.ok(conservativeLowerBound >= materialRegressionFloor,
    `${category} changed-path confidence-bounded aggregate regressed materially: ${conservativeLowerBound.toFixed(4)}x < ${materialRegressionFloor.toFixed(2)}x`);
}

console.log(
  `✅ v1.12 evidence gate passed: 100 balanced cases, ${decisionCounts.accepted} accepted, ` +
  `${changed.length} changed paths across ${changedGroups.size} groups, zero correctness/determinism failures, ` +
  `all confidence-bounded changed groups >=${materialRegressionFloor.toFixed(2)}x`,
);
for (const group of aggregateConfidence) {
  console.log(`   ${group.category}: ${group.cases} cases, ${group.pointEstimate.toFixed(4)}x point, ${group.conservativeLowerBound.toFixed(4)}x conservative lower bound`);
}

// Focused exact benchmarks cover hot paths whose complete operation is either
// diluted by larger production frames or not exercised by the 100-case soft
// tournament (camera direction). These files remain tied to the current source
// bytes and are release failures if their exactness/performance gates drift.
const effectsEvidence = readEvidence('benchmarks/results/v112-effects-drag.json');
assert.equal(effectsEvidence.schemaVersion, 1, 'effects evidence schema changed');
assert.equal(effectsEvidence.source?.candidateSha256, sha256File(path.join(root, 'src/effects.ts')), 'effects evidence is stale');
assert.equal(effectsEvidence.exactness?.passed, true, 'effects exactness failed');
assert.equal(effectsEvidence.exactness?.float32MatrixAndColorBitsExact, true, 'effects matrix/color bits changed');
assert.ok(effectsEvidence.exactness?.scalarComparisons >= 500000, 'effects exactness coverage is too small');
assert.ok(effectsEvidence.summary?.minimumUpdateOnlySpeedup >= 1.03, 'an effects update workload lost its focused win');
assert.ok(effectsEvidence.summary?.minimumUpdateAndBuildSpeedup >= 1.02, 'an effects update+build workload lost its focused win');

const uiEvidence = readEvidence('benchmarks/results/v112-ui-hotpaths.json');
assert.equal(uiEvidence.schemaVersion, 1, 'UI evidence schema changed');
assert.equal(uiEvidence.baseline?.archiveSha256, expectedBaselineSha256, 'UI evidence used the wrong baseline');
assert.equal(uiEvidence.candidate?.sourceSha256, sha256File(path.join(root, 'src/showcases.ts')), 'UI evidence is stale');
assert.equal(uiEvidence.passed, true, 'UI benchmark gate failed');
assert.ok(uiEvidence.fidelity?.exactSamples >= 120000, 'UI exactness coverage is too small');
assert.ok(uiEvidence.summary?.minimumSpeedup >= 1.02, 'a UI camera workload lost its focused win');
assert.match(fs.readFileSync(path.join(root, 'src/main.ts'), 'utf8'), /sampleShowcaseCameraInto\(activeShowcase, cinematicTime, camera\)/,
  'allocation-free camera sampler is not integrated in the director');

const runtimeEvidence = readEvidence('benchmarks/results/v112-runtime-candidates.json');
assert.equal(runtimeEvidence.schemaVersion, 1, 'runtime evidence schema changed');
assert.equal(runtimeEvidence.baselineArchiveSha256, expectedBaselineSha256, 'runtime evidence used the wrong baseline');
for (const [relativePath, digest] of Object.entries(runtimeEvidence.relevantCandidateSourceSha256 ?? {})) {
  assert.equal(digest, sha256File(path.join(root, relativePath)), `runtime evidence is stale for ${relativePath}`);
}
assert.equal(runtimeEvidence.exactCases, runtimeEvidence.records?.length, 'runtime evidence lost exact cases');
assert.equal(runtimeEvidence.summary?.regressions, 0, 'focused runtime evidence retained a regression');
for (const [id, minimumLowerBound] of [['cloth-sphere-frame', 1.2], ['water-768-droplet-frame', 2.0]]) {
  const record = runtimeEvidence.records.find((entry) => entry.id === id);
  assert.ok(record, `runtime evidence is missing ${id}`);
  assert.equal(record.exact?.passed, true, `${id} is not exact`);
  assert.equal(record.classification?.decision, 'true-win', `${id} is not a qualified win`);
  assert.ok(record.confidence95?.lower >= minimumLowerBound, `${id} lost its confidence-bounded win`);
}

const nativeEvidence = readEvidence('benchmarks/results/v112-native-candidates.json');
assert.equal(nativeEvidence.schemaVersion, 1, 'native evidence schema changed');
assert.equal(nativeEvidence.baseline?.archiveSha256Actual, expectedBaselineSha256, 'native evidence used the wrong source archive');
assert.equal(nativeEvidence.candidate?.bridgeSha256, sha256File(path.join(root, 'wasm/box3d_web.c')), 'native bridge evidence is stale');
assert.equal(nativeEvidence.candidate?.jsSha256, sha256File(path.join(root, 'public/box3d/box3d.js')), 'native JavaScript artifact evidence is stale');
assert.equal(nativeEvidence.candidate?.wasmSha256, sha256File(path.join(root, 'public/box3d/box3d.wasm')), 'native WASM evidence is stale');
assert.equal(nativeEvidence.staleness?.stale, false, 'native evidence reports a stale artifact');
assert.equal(nativeEvidence.passed, true, 'native execution/correctness gate failed');
assert.equal(nativeEvidence.optimizationPassed, true, 'native optimization gate failed');
assert.ok(Object.values(nativeEvidence.exactness ?? {}).every(Boolean), 'native output exactness failed');
assert.equal(nativeEvidence.summary?.measuredMaterialRegressions, 0, 'native benchmark retained a material regression');
const staticSync = nativeEvidence.records?.find((entry) => entry.id === 'sync-static-heavy');
const denseSync = nativeEvidence.records?.find((entry) => entry.id === 'sync-nearly-all-dynamic-control');
assert.equal(staticSync?.classification, 'accepted measured win', 'static-heavy native sync is not a qualified win');
assert.ok(staticSync?.pairedBootstrap95?.low95 >= 1.10, 'static-heavy native sync lost its confidence-bounded win');
assert.ok(denseSync?.pairedBootstrap95?.low95 >= 0.95, 'dense-dynamic native sync regressed materially');

console.log('   focused exact gates: effects, camera director, cloth sphere, water droplets, and native transform sync passed');
