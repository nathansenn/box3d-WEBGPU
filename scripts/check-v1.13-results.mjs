import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { GROUPS, makeRegistry, registryDigest, stableStringify } =
  require('../benchmarks/v113-production-1000-registry.cjs');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineArchiveRelative = 'benchmarks/baselines/box3d-webgpu-v1.12.0-source.tar.gz';
const baselineArchive = path.join(root, baselineArchiveRelative);
const expectedBaselineSha256 = '33d7fc828fdea54e087f25815bcdabd8f9608fcda6912e1e5c7dd57139534c67';
const confirmationRunsPerCase = 8;
const confirmationSamplesPerRun = 8;
const confirmationTargetMs = 25;
const confirmationMinimumRepetitionCap = 1024;
const confirmationBootstrapCount = 50000;
const harnessPaths = [
  'benchmarks/v113-production-1000.cjs',
  'benchmarks/v113-production-1000-registry.cjs',
  'scripts/check-v1.13-results.mjs',
];
const SOURCE_ROOTS = [
  'src', 'wasm', 'scripts', 'public/box3d', 'public/textures',
  'public/soft-kernels-simd.wasm', 'public/soft-kernels-scalar.wasm',
  'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.test.json',
  'tsconfig.benchmark.json', 'vite.config.ts', 'index.html',
];

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(filePath) {
  return sha256Buffer(fs.readFileSync(filePath));
}

function listFiles(base, relativePath, output) {
  if (path.basename(relativePath) === '.DS_Store') return;
  const absolute = path.join(base, relativePath);
  if (!fs.existsSync(absolute)) return;
  const stat = fs.statSync(absolute);
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(absolute).sort()) listFiles(base, path.join(relativePath, entry), output);
    return;
  }
  output.push(relativePath.split(path.sep).join('/'));
}

function manifest(base) {
  const files = [];
  for (const entry of SOURCE_ROOTS) listFiles(base, entry, files);
  const entries = [...new Set(files)].sort().map((relativePath) => {
    const absolute = path.join(base, relativePath);
    return { path: relativePath, bytes: fs.statSync(absolute).size, sha256: sha256File(absolute) };
  });
  return {
    sha256: sha256Buffer(Buffer.from(stableStringify(entries))),
    fileCount: entries.length,
    entries,
  };
}

function compactManifest(value) {
  return { sha256: value.sha256, fileCount: value.fileCount };
}

function manifestDiff(baseline, candidate) {
  const before = new Map(baseline.entries.map((entry) => [entry.path, entry.sha256]));
  const after = new Map(candidate.entries.map((entry) => [entry.path, entry.sha256]));
  return [...new Set([...before.keys(), ...after.keys()])]
    .sort()
    .filter((relativePath) => before.get(relativePath) !== after.get(relativePath))
    .map((relativePath) => ({
      path: relativePath,
      baselineSha256: before.get(relativePath) || null,
      candidateSha256: after.get(relativePath) || null,
    }));
}

function harnessIdentity() {
  const files = harnessPaths.map((relativePath) => {
    const absolute = path.join(root, relativePath);
    return { path: relativePath, bytes: fs.statSync(absolute).size, sha256: sha256File(absolute) };
  });
  return { files, sha256: sha256Buffer(Buffer.from(stableStringify(files))) };
}

function artifactIdentity(projectRoot) {
  const relativeFiles = [
    'public/box3d/box3d.js', 'public/box3d/box3d.wasm',
    'public/box3d/BUILD_PROVENANCE.json', 'wasm/box3d_web.c', 'wasm/soft_kernels.c',
    'public/soft-kernels-simd.wasm', 'public/soft-kernels-scalar.wasm',
  ];
  const files = relativeFiles.map((relativePath) => {
    const absolute = path.join(projectRoot, relativePath);
    return fs.existsSync(absolute)
      ? { path: relativePath, bytes: fs.statSync(absolute).size, sha256: sha256File(absolute) }
      : { path: relativePath, bytes: null, sha256: null };
  });
  const provenancePath = path.join(projectRoot, 'public/box3d/BUILD_PROVENANCE.json');
  let provenanceValid = false;
  if (fs.existsSync(provenancePath)) {
    const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    const byPath = new Map(files.map((entry) => [entry.path, entry]));
    provenanceValid = ['box3d.js', 'box3d.wasm'].every((name) => {
      const actual = byPath.get(`public/box3d/${name}`);
      return actual?.sha256 === provenance.artifacts?.[name]?.sha256 && actual?.bytes === provenance.artifacts?.[name]?.bytes;
    }) && byPath.get('wasm/box3d_web.c')?.sha256 === provenance.bridge?.sha256;
  }
  return {
    files,
    provenanceValid,
    provenanceSha256: fs.existsSync(provenancePath) ? sha256File(provenancePath) : null,
    sha256: sha256Buffer(Buffer.from(stableStringify(files))),
  };
}

const RENDERER_GATE_RESULTS = [
  'benchmarks/results/native-rigid-upload-metal.json',
  'benchmarks/results/upload-cache-metal.json',
  'benchmarks/results/renderer-startup-metal.json',
];

function rendererGateIdentity() {
  const rendererPath = path.join(root, 'src/webgpu/renderer.ts');
  const rendererSha256 = sha256File(rendererPath);
  const files = RENDERER_GATE_RESULTS.map((relativePath) => {
    const absolute = path.join(root, relativePath);
    if (!fs.existsSync(absolute)) return { path: relativePath, exists: false, fresh: false, sha256: null };
    const json = JSON.parse(fs.readFileSync(absolute, 'utf8'));
    return {
      path: relativePath,
      exists: true,
      fresh: json?.rendererSha256 === rendererSha256,
      sha256: sha256File(absolute),
      json,
    };
  });
  const byPath = new Map(files.map((entry) => [entry.path, entry]));
  const rigid = byPath.get(RENDERER_GATE_RESULTS[0])?.json;
  const cache = byPath.get(RENDERER_GATE_RESULTS[1])?.json?.uploadCacheBenchmark;
  const startup = byPath.get(RENDERER_GATE_RESULTS[2])?.json;
  return {
    rendererSha256,
    files,
    passed: files.every((entry) => entry.exists && entry.fresh) &&
      rigid?.result === 'passed' && rigid?.dawnBackend === 'metal' && rigid?.uncapturedWebGpuErrors === 0 &&
      rigid?.actualGpuQueueUploadBytes?.settledUnchanged === 0 &&
      cache?.dawnBackend === 'metal' && cache?.cachedUploadedBytes === 0 &&
      String(startup?.environment?.backend).toLowerCase() === 'metal',
    sha256: sha256Buffer(Buffer.from(stableStringify(files.map(({ json, ...entry }) => entry)))),
  };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function mad(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function geometricMean(values) {
  assert.ok(values.length > 0, 'geometric mean requires values');
  assert.ok(values.every((value) => Number.isFinite(value) && value > 0), 'geometric mean has invalid values');
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function quantile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function orderGroups(samples) {
  return {
    baselineFirst: samples.filter((sample) => sample.order === 'AB').map((sample) => sample.baseline.msPerOperation),
    candidateSecond: samples.filter((sample) => sample.order === 'AB').map((sample) => sample.candidate.msPerOperation),
    candidateFirst: samples.filter((sample) => sample.order === 'BA').map((sample) => sample.candidate.msPerOperation),
    baselineSecond: samples.filter((sample) => sample.order === 'BA').map((sample) => sample.baseline.msPerOperation),
  };
}

function recomputeOrderStatistics(samples) {
  const groups = orderGroups(samples);
  const baselineFirstMedian = median(groups.baselineFirst);
  const candidateSecondMedian = median(groups.candidateSecond);
  const candidateFirstMedian = median(groups.candidateFirst);
  const baselineSecondMedian = median(groups.baselineSecond);
  const baselineFirstRatio = baselineFirstMedian / candidateSecondMedian;
  const candidateFirstRatio = baselineSecondMedian / candidateFirstMedian;
  return {
    speedup: Math.sqrt(baselineFirstRatio * candidateFirstRatio),
    baselineFirstRatio,
    candidateFirstRatio,
    baselineFirstMedianMs: baselineFirstMedian,
    candidateSecondMedianMs: candidateSecondMedian,
    candidateFirstMedianMs: candidateFirstMedian,
    baselineSecondMedianMs: baselineSecondMedian,
  };
}

function recomputeBootstrap(samples, resamples, seed) {
  const groups = orderGroups(samples);
  const count = groups.baselineFirst.length;
  assert.equal(count, groups.candidateFirst.length, 'AB/BA stratum mismatch');
  const random = rng(seed);
  const distribution = new Float64Array(resamples);
  const bf = new Array(count);
  const cs = new Array(count);
  const cf = new Array(count);
  const bs = new Array(count);
  let nonWins = 0;
  let nonRegressions = 0;
  for (let iteration = 0; iteration < resamples; iteration++) {
    for (let index = 0; index < count; index++) {
      const selected = Math.floor(random() * count);
      bf[index] = groups.baselineFirst[selected];
      cs[index] = groups.candidateSecond[selected];
    }
    for (let index = 0; index < count; index++) {
      const selected = Math.floor(random() * count);
      cf[index] = groups.candidateFirst[selected];
      bs[index] = groups.baselineSecond[selected];
    }
    const ratio = Math.sqrt((median(bf) / median(cs)) * (median(bs) / median(cf)));
    distribution[iteration] = ratio;
    if (ratio <= 1) nonWins++;
    if (ratio >= 1) nonRegressions++;
  }
  return {
    confidence: 0.95,
    resamples,
    seed: seed >>> 0,
    lower: quantile(distribution, 0.025),
    median: quantile(distribution, 0.5),
    upper: quantile(distribution, 0.975),
    pOneSided: (nonWins + 1) / (resamples + 1),
    pRegressionOneSided: (nonRegressions + 1) / (resamples + 1),
  };
}

function confirmationEvidencePath(caseId, runIndex) {
  return path.join(root, 'benchmarks/results',
    `v113-control-confirmation-case-${String(caseId).padStart(4, '0')}-run-${String(runIndex).padStart(2, '0')}.json`);
}

function bootstrapProcessGeometricMean(speedups, familyCount, seed) {
  assert.equal(speedups.length, confirmationRunsPerCase,
    'material-control confirmation requires exactly eight independent process speedups');
  assert.ok(speedups.every((value) => Number.isFinite(value) && value > 0),
    'material-control confirmation contains an invalid process speedup');
  const random = rng(seed);
  const distribution = new Float64Array(confirmationBootstrapCount);
  const selected = new Array(speedups.length);
  for (let iteration = 0; iteration < confirmationBootstrapCount; iteration++) {
    for (let index = 0; index < selected.length; index++) {
      selected[index] = speedups[Math.floor(random() * speedups.length)];
    }
    distribution[iteration] = geometricMean(selected);
  }
  const familywiseAlpha = 0.05;
  const perCaseAlpha = familywiseAlpha / Math.max(1, familyCount);
  return {
    resamples: confirmationBootstrapCount,
    seed: seed >>> 0,
    processCount: speedups.length,
    familyCount,
    familywiseConfidence: 1 - familywiseAlpha,
    bonferroniPerCaseAlpha: perCaseAlpha,
    pointGeometricMean: geometricMean(speedups),
    lower: quantile(distribution, perCaseAlpha),
    median: quantile(distribution, 0.5),
    upper: quantile(distribution, 1 - perCaseAlpha),
  };
}

function approximatelyEqual(actual, expected, tolerance = 1e-10) {
  return Number.isFinite(actual) && Number.isFinite(expected) &&
    Math.abs(actual - expected) <= tolerance * Math.max(1, Math.abs(expected));
}

function assertStatsEqual(actual, expected, label) {
  for (const key of Object.keys(expected)) {
    assert.ok(approximatelyEqual(actual[key], expected[key]), `${label}.${key}: ${actual[key]} != ${expected[key]}`);
  }
}

function bhQValues(records, probabilityKey = 'pOneSided') {
  const sorted = [...records].sort((a, b) =>
    a.confidence[probabilityKey] - b.confidence[probabilityKey]);
  const output = new Map();
  let running = 1;
  for (let index = sorted.length - 1; index >= 0; index--) {
    const adjusted = Math.min(1,
      sorted[index].confidence[probabilityKey] * sorted.length / (index + 1));
    running = Math.min(running, adjusted);
    output.set(sorted[index].id, running);
  }
  return output;
}

function caseControl(definition, changedFiles) {
  if (definition.expectedControl) return { control: true, changedSourceFiles: [] };
  const scene = changedFiles.find((entry) => entry.path === 'src/scenes.ts');
  const selector = definition.engine === 'native'
    ? (entry) => entry.path === 'wasm/box3d_web.c' || entry.path === 'src/physics/wasm.ts' || entry.path.startsWith('public/box3d/')
    : definition.engine === 'fallback'
      ? (entry) => entry.path === 'src/physics/fallback.ts'
      : definition.engine === 'soft' || definition.engine === 'mixed-soft'
        ? (entry) => entry.path.startsWith('src/soft/') || entry.path === 'wasm/soft_kernels.c' || entry.path.startsWith('public/soft-kernels-')
        : definition.engine === 'camera'
          ? (entry) => entry.path === 'src/camera.ts' || entry.path === 'src/math.ts'
          : definition.engine === 'frame-lines'
            ? (entry) => entry.path === 'src/frame-lines.ts' || entry.path === 'src/main.ts'
            : definition.engine === 'effects'
              ? (entry) => entry.path === 'src/effects.ts'
              : definition.engine === 'wasm-wrapper'
                ? (entry) => entry.path === 'src/physics/wasm.ts'
                : (entry) => entry.path === 'src/webgpu/renderer.ts' || entry.path.startsWith('src/assets/');
  const domainFiles = changedFiles.filter(selector);
  if (scene && ['native', 'fallback', 'soft', 'mixed-soft'].includes(definition.engine)) domainFiles.push(scene);
  const unique = [...new Map(domainFiles.map((entry) => [entry.path, entry])).values()];
  return { control: unique.length === 0, changedSourceFiles: unique };
}

function assertPathEvidence(record, evidence, label, scale) {
  assert.equal(evidence.engine, record.engine, `${record.id} ${label} engine path mismatch`);
  const expectedFrames = Math.max(2, Math.round(record.iterations * scale));
  assert.equal(evidence.frames, expectedFrames, `${record.id} ${label} frame path mismatch`);
  assert.equal(evidence.operations, expectedFrames, `${record.id} ${label} operation count mismatch`);
  const expectedActions = record.actionCycle
    ? record.actions.reduce((count, action) => count + (
        action.frame < expectedFrames
          ? Math.floor((expectedFrames - 1 - action.frame) / record.actionCycle) + 1
          : 0
      ), 0)
    : record.actions.filter((action) => action.frame < expectedFrames).length;
  assert.equal(evidence.actionCalls, expectedActions, `${record.id} ${label} action trace did not execute`);
  if (record.engine === 'soft') assert.equal(evidence.buildFrames, expectedFrames, `${record.id} ${label} buildFrame count`);
  if (record.engine === 'mixed-soft') assert.equal(evidence.buildFrames, expectedFrames * 3, `${record.id} ${label} mixed buildFrame count`);
  if (record.protocol === 'native-create-only' || record.protocol === 'native-create-step') {
    assert.equal(evidence.createCalls, expectedFrames, `${record.id} ${label} native creation was outside timed path`);
  }
  if (record.protocol === 'fallback-create-step') {
    assert.equal(evidence.createCalls, expectedFrames, `${record.id} ${label} fallback creation was outside timed path`);
  }
  if (record.protocol === 'settled-step-control') {
    assert.equal(evidence.settledAchieved, true, `${record.id} ${label} did not settle`);
    assert.equal(evidence.awakeCount, 0, `${record.id} ${label} settled path remained awake`);
  }
}

function assertRecord(record, definition, shard, smoke) {
  assert.equal(record.id, definition.id, `case ${definition.id} ID mismatch`);
  for (const field of ['semanticKey', 'semanticSha256', 'executionTraceSha256', 'group', 'engine', 'domain', 'sceneId', 'sceneIds', 'protocol', 'variant']) {
    assert.deepEqual(record[field], definition[field], `case ${definition.id} registry field ${field}`);
  }
  assert.equal(record.shard, shard.shard, `case ${record.id} shard mismatch`);
  const expectedControl = caseControl(definition, shard.changedFiles);
  assert.equal(record.control, expectedControl.control, `case ${record.id} control classification`);
  assert.deepEqual(record.changedSourceFiles, expectedControl.changedSourceFiles, `case ${record.id} changed source files`);
  const sampleMinimum = smoke ? 2 : 8;
  assert.ok(Number.isInteger(shard.methodology.samples) && shard.methodology.samples >= sampleMinimum && shard.methodology.samples % 2 === 0,
    `case ${record.id} invalid sample count`);
  assert.equal(record.samples.length, shard.methodology.samples, `case ${record.id} raw sample count`);
  assert.equal(record.samples.filter((sample) => sample.order === 'AB').length, shard.methodology.samples / 2, `case ${record.id} AB count`);
  assert.equal(record.samples.filter((sample) => sample.order === 'BA').length, shard.methodology.samples / 2, `case ${record.id} BA count`);

  for (const sample of record.samples) {
    assert.ok(sample.order === 'AB' || sample.order === 'BA', `case ${record.id} invalid order`);
    for (const variant of ['baseline', 'candidate']) {
      const measured = sample[variant];
      assert.ok(Number.isFinite(measured.msPerOperation) && measured.msPerOperation > 0, `case ${record.id} invalid ${variant} timing`);
      assert.ok(Number.isFinite(measured.elapsedMs) && measured.elapsedMs > 0, `case ${record.id} invalid ${variant} batch`);
      assert.ok(Number.isInteger(measured.operations) && measured.operations > 0, `case ${record.id} invalid ${variant} operations`);
      assert.equal(measured.repetitions, record.calibration.repetitions, `case ${record.id} ${variant} calibration repetitions`);
      assert.equal(measured.repeatedSetupDeterministic, true, `case ${record.id} ${variant} setup nondeterminism`);
      assert.match(measured.capture.fingerprint, /^[0-9a-f]{64}$/, `case ${record.id} ${variant} fingerprint`);
      assert.equal(measured.capture.finite, true, `case ${record.id} ${variant} non-finite capture`);
      assertPathEvidence(record, measured.pathEvidence, `${variant} sample`, shard.methodology.workloadScale);
    }
    assert.equal(sample.correctness.correct, true, `case ${record.id} timed sample correctness`);
  }

  const baselineTimes = record.samples.map((sample) => sample.baseline.msPerOperation);
  const candidateTimes = record.samples.map((sample) => sample.candidate.msPerOperation);
  assert.ok(approximatelyEqual(record.baselineMedianMs, median(baselineTimes)), `case ${record.id} baseline median`);
  assert.ok(approximatelyEqual(record.candidateMedianMs, median(candidateTimes)), `case ${record.id} candidate median`);
  assert.ok(approximatelyEqual(record.baselineMadMs, mad(baselineTimes)), `case ${record.id} baseline MAD`);
  assert.ok(approximatelyEqual(record.candidateMadMs, mad(candidateTimes)), `case ${record.id} candidate MAD`);
  const statistics = recomputeOrderStatistics(record.samples);
  assertStatsEqual(record.statistics, statistics, `case ${record.id} order statistics`);
  const confidence = recomputeBootstrap(record.samples, shard.methodology.bootstrapCount, record.confidence.seed);
  assertStatsEqual(record.confidence, confidence, `case ${record.id} confidence`);
  const minimum = Math.min(...record.samples.flatMap((sample) => [sample.baseline.elapsedMs, sample.candidate.elapsedMs]));
  assert.ok(approximatelyEqual(record.minimumTimedBatchMs, minimum), `case ${record.id} minimum batch`);
  assert.ok(Number.isInteger(record.calibration.repetitions) && record.calibration.repetitions >= 1,
    `case ${record.id} calibration repetitions`);
  assert.ok(Number.isInteger(record.calibration.safetyCap) && record.calibration.safetyCap >= record.calibration.repetitions,
    `case ${record.id} calibration cap`);

  assert.equal(record.correctness.correct, true, `case ${record.id} aggregate correctness`);
  assert.equal(record.correctness.baselineDeterministic, true, `case ${record.id} baseline determinism`);
  assert.equal(record.correctness.candidateDeterministic, true, `case ${record.id} candidate determinism`);
  if (smoke) {
    assert.ok(record.correctness.checkpoints.length >= 1 && record.correctness.checkpoints.length <= 4,
      `case ${record.id} smoke checkpoint count`);
  } else {
    assert.equal(record.correctness.checkpoints.length, 4, `case ${record.id} must contain four checkpoints`);
  }
  for (const checkpoint of record.correctness.checkpoints) {
    assert.equal(checkpoint.correctness.correct, true, `case ${record.id} checkpoint ${checkpoint.step}`);
    assert.match(checkpoint.baseline.fingerprint, /^[0-9a-f]{64}$/, `case ${record.id} checkpoint baseline fingerprint`);
    assert.match(checkpoint.candidate.fingerprint, /^[0-9a-f]{64}$/, `case ${record.id} checkpoint candidate fingerprint`);
  }
  assertPathEvidence(record, record.checkpointPathEvidence.baseline, 'baseline checkpoint', shard.methodology.workloadScale);
  assertPathEvidence(record, record.checkpointPathEvidence.candidate, 'candidate checkpoint', shard.methodology.workloadScale);
  if (definition.unchangedFrame) assert.equal(record.correctness.unchangedExact, true, `case ${record.id} unchanged frame was not exact`);
}

function loadJson(filePath) {
  assert.ok(fs.existsSync(filePath), `missing evidence ${filePath}`);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function validateControlConfirmation(screeningRecord, runs, familyCount, context) {
  assert.equal(runs.length, confirmationRunsPerCase,
    `case ${screeningRecord.id} requires exactly ${confirmationRunsPerCase} confirmation processes`);
  const definition = context.registryById.get(screeningRecord.id);
  assert.ok(definition, `confirmation case ${screeningRecord.id} is absent from the registry`);
  assert.equal(screeningRecord.control, true, `case ${screeningRecord.id} confirmation target is not a control`);
  const uniqueInvocations = new Set();
  const uniqueProcessInstances = new Set();
  const uniqueProcessNonces = new Set();
  const uniqueParentTokens = new Set();
  const processSpeedups = [];
  const evidence = [];

  for (let runIndex = 1; runIndex <= confirmationRunsPerCase; runIndex++) {
    const filePath = confirmationEvidencePath(screeningRecord.id, runIndex);
    const run = runs[runIndex - 1];
    assert.equal(run.schemaVersion, 1, `case ${screeningRecord.id} confirmation ${runIndex} schema`);
    assert.equal(run.campaign, 'webphysics-v1.13-material-control-confirmation',
      `case ${screeningRecord.id} confirmation ${runIndex} campaign`);
    assert.equal(run.confirmationMode, true, `case ${screeningRecord.id} confirmation ${runIndex} mode`);
    assert.equal(run.confirmationCaseId, screeningRecord.id,
      `case ${screeningRecord.id} confirmation ${runIndex} target identity`);
    assert.equal(run.confirmationRunIndex, runIndex,
      `case ${screeningRecord.id} confirmation run index`);
    assert.equal(run.shard, definition.shard, `case ${screeningRecord.id} confirmation shard`);
    assert.equal(run.group, definition.group, `case ${screeningRecord.id} confirmation group`);
    assert.equal(run.smokeMode, false, `case ${screeningRecord.id} confirmation cannot be smoke evidence`);
    assert.equal(run.caseCount, 1, `case ${screeningRecord.id} confirmation case count`);
    assert.equal(run.registryCaseCount, 1000, `case ${screeningRecord.id} confirmation registry size`);
    assert.equal(run.registrySha256, context.registrySha256,
      `case ${screeningRecord.id} confirmation registry digest`);
    assert.deepEqual(run.executionOrder, [screeningRecord.id],
      `case ${screeningRecord.id} confirmation execution order`);
    assert.deepEqual(run.registryCases, [{
      id: definition.id,
      semanticSha256: definition.semanticSha256,
      executionTraceSha256: definition.executionTraceSha256,
    }], `case ${screeningRecord.id} confirmation registry evidence`);
    assert.equal(run.baselineArchive, baselineArchiveRelative,
      `case ${screeningRecord.id} confirmation baseline path`);
    assert.equal(run.baselineArchiveSha256, expectedBaselineSha256,
      `case ${screeningRecord.id} confirmation baseline archive digest`);
    assert.deepEqual(run.baselineSource, compactManifest(context.frozenBaseline.source),
      `case ${screeningRecord.id} confirmation baseline source`);
    assert.deepEqual(run.baselineArtifacts, context.frozenBaseline.artifacts,
      `case ${screeningRecord.id} confirmation baseline artifacts`);
    assert.deepEqual(run.candidateSourceAtStart, compactManifest(context.currentSource),
      `case ${screeningRecord.id} confirmation candidate source`);
    assert.deepEqual(run.candidateSourceAtStart, run.candidateSourceAtEnd,
      `case ${screeningRecord.id} confirmation source start/end`);
    assert.deepEqual(run.harnessAtStart, context.currentHarness,
      `case ${screeningRecord.id} confirmation harness closure`);
    assert.deepEqual(run.harnessAtStart, run.harnessAtEnd,
      `case ${screeningRecord.id} confirmation harness start/end`);
    assert.deepEqual(run.candidateArtifactsAtStart, context.currentArtifacts,
      `case ${screeningRecord.id} confirmation artifacts`);
    assert.deepEqual(run.candidateArtifactsAtStart, run.candidateArtifactsAtEnd,
      `case ${screeningRecord.id} confirmation artifacts start/end`);
    assert.deepEqual(run.rendererGatesAtStart, context.currentRendererGates,
      `case ${screeningRecord.id} confirmation renderer gates`);
    assert.deepEqual(run.rendererGatesAtStart, run.rendererGatesAtEnd,
      `case ${screeningRecord.id} confirmation renderer gates start/end`);
    assert.deepEqual(run.changedFiles, context.expectedChangedFiles,
      `case ${screeningRecord.id} confirmation changed source files`);
    assert.deepEqual(run.environment, context.environment,
      `case ${screeningRecord.id} confirmation toolchain environment`);
    assert.equal(run.sourceStableDuringRun, true,
      `case ${screeningRecord.id} confirmation source changed`);
    assert.equal(run.harnessStableDuringRun, true,
      `case ${screeningRecord.id} confirmation harness changed`);
    assert.equal(run.artifactsStableDuringRun, true,
      `case ${screeningRecord.id} confirmation artifacts changed`);
    assert.equal(run.rendererGatesStableDuringRun, true,
      `case ${screeningRecord.id} confirmation renderer evidence changed`);
    assert.equal(run.methodology.workloadScale, 1,
      `case ${screeningRecord.id} confirmation workload scale`);
    assert.ok(run.methodology.targetBatchMs >= confirmationTargetMs,
      `case ${screeningRecord.id} confirmation target batch`);
    assert.ok(run.methodology.samples >= confirmationSamplesPerRun && run.methodology.samples % 2 === 0,
      `case ${screeningRecord.id} confirmation sample balance`);
    assert.match(run.methodology.confirmation, /fresh process/i,
      `case ${screeningRecord.id} confirmation methodology disclosure`);
    assert.equal(run.records.length, 1, `case ${screeningRecord.id} confirmation records`);
    const record = run.records[0];
    assertRecord(record, definition, run, false);
    assert.equal(record.control, true, `case ${screeningRecord.id} confirmation control classification`);
    assert.ok(record.calibration.safetyCap >= confirmationMinimumRepetitionCap,
      `case ${screeningRecord.id} confirmation repetition cap`);
    assert.ok(record.minimumTimedBatchMs >= run.methodology.targetBatchMs * 0.9 ||
      record.calibration.repetitions === record.calibration.safetyCap,
    `case ${screeningRecord.id} confirmation did not reach its target or raised cap`);
    const processEvidence = run.processEvidence;
    assert.ok(Number.isInteger(processEvidence?.pid) && processEvidence.pid > 0,
      `case ${screeningRecord.id} confirmation ${runIndex} PID`);
    assert.ok(Number.isInteger(processEvidence?.parentPid) && processEvidence.parentPid > 0,
      `case ${screeningRecord.id} confirmation ${runIndex} parent PID`);
    assert.match(processEvidence?.processStartedAt || '', /^\d{4}-\d{2}-\d{2}T/,
      `case ${screeningRecord.id} confirmation ${runIndex} process start`);
    assert.match(processEvidence?.processNonce || '', /^[0-9a-f]{48}$/,
      `case ${screeningRecord.id} confirmation ${runIndex} process nonce`);
    assert.match(processEvidence?.parentToken || '', /^[0-9a-f]{32,64}$/,
      `case ${screeningRecord.id} confirmation ${runIndex} parent token`);
    const invocationKey = stableStringify({
      pid: processEvidence.pid,
      processStartedAt: processEvidence.processStartedAt,
      processNonce: processEvidence.processNonce,
      parentToken: processEvidence.parentToken,
    });
    assert.equal(uniqueInvocations.has(invocationKey), false,
      `case ${screeningRecord.id} confirmation ${runIndex} reused process evidence`);
    uniqueInvocations.add(invocationKey);
    uniqueProcessInstances.add(`${processEvidence.pid}:${processEvidence.processStartedAt}`);
    uniqueProcessNonces.add(processEvidence.processNonce);
    uniqueParentTokens.add(processEvidence.parentToken);
    processSpeedups.push(record.statistics.speedup);
    evidence.push({
      path: path.relative(root, filePath),
      sha256: sha256File(filePath),
      generatedAt: run.generatedAt,
      runIndex,
      processEvidence,
      speedup: record.statistics.speedup,
      baselineFirstRatio: record.statistics.baselineFirstRatio,
      candidateFirstRatio: record.statistics.candidateFirstRatio,
      minimumTimedBatchMs: record.minimumTimedBatchMs,
      repetitions: record.calibration.repetitions,
      repetitionCap: record.calibration.safetyCap,
    });
  }

  assert.equal(uniqueInvocations.size, confirmationRunsPerCase,
    `case ${screeningRecord.id} confirmation processes are not unique`);
  assert.equal(uniqueProcessInstances.size, confirmationRunsPerCase,
    `case ${screeningRecord.id} confirmation process instances are not unique`);
  assert.equal(uniqueProcessNonces.size, confirmationRunsPerCase,
    `case ${screeningRecord.id} confirmation process nonces are not unique`);
  assert.equal(uniqueParentTokens.size, confirmationRunsPerCase,
    `case ${screeningRecord.id} confirmation parent tokens are not unique`);
  const aggregate = bootstrapProcessGeometricMean(
    processSpeedups, familyCount, (0x113c0000 ^ screeningRecord.id ^ familyCount) >>> 0,
  );
  return {
    caseId: screeningRecord.id,
    group: screeningRecord.group,
    screeningSpeedup: screeningRecord.statistics.speedup,
    screeningRegressionQValue: screeningRecord.controlRegressionQValue,
    threshold: 0.94,
    processSpeedups,
    aggregate,
    confirmedMaterialRegression: aggregate.upper < 0.94,
    evidence,
  };
}

function extractBaselineManifest() {
  assert.equal(sha256File(baselineArchive), expectedBaselineSha256, 'v1.12 archive SHA-256 changed');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-v113-check-baseline-'));
  try {
    const extraction = spawnSync('tar', ['-xzf', baselineArchive, '-C', directory], { encoding: 'utf8' });
    if (extraction.status !== 0) throw new Error(extraction.stderr || extraction.stdout);
    return { source: manifest(directory), artifacts: artifactIdentity(directory) };
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
}

function finalDecision(record, qValue, targetBatchMs) {
  if (!record.correctness.correct) return 'rejected-correctness';
  if (record.control) return 'control';
  if (record.minimumTimedBatchMs < targetBatchMs * 0.9) return 'timer-floor';
  if (record.statistics.speedup >= 1.03 && record.confidence.lower > 1 &&
      record.statistics.baselineFirstRatio >= 0.98 && record.statistics.candidateFirstRatio >= 0.98 &&
      qValue <= 0.05) return 'accepted';
  if (record.statistics.speedup >= 0.98 || record.confidence.upper >= 1) return 'borderline';
  return 'rejected-no-win';
}

function markdown(merged) {
  const lines = [
    '# WebPhysics v1.13 exact 1,000-case release tournament', '',
    `Generated: ${merged.generatedAt}`, '',
    `Candidate source: \`${merged.candidateSource.sha256}\``, '',
    `Registry: \`${merged.registrySha256}\``, '',
    '## Summary', '',
    `- Cases: **${merged.caseCount}**`,
    `- Accepted confidence- and multiplicity-bounded wins: **${merged.summary.accepted}**`,
    `- Borderline: **${merged.summary.borderline}**`,
    `- Controls: **${merged.summary.controls}**`,
    `- Timer-floor cases excluded from performance aggregates: **${merged.summary.timerFloor}**`,
    `- Correctness failures: **${merged.summary.correctnessFailures}**`,
    `- Material control regressions screened for fresh-process confirmation: **${merged.summary.screenedMaterialControlRegressions}**`,
    `- Material control regressions confirmed by the Bonferroni familywise upper bound: **${merged.summary.confirmedMaterialControlRegressions}**`,
    `- Eligible changed-path geometric mean: **${merged.summary.changedGeometricMean.toFixed(4)}×**`,
    `- Eligible control geometric mean: **${merged.summary.controlGeometricMean.toFixed(4)}×**`,
    '', '## Groups', '',
    '| Group | Cases | Eligible GM | Controls | Accepted |',
    '|---|---:|---:|---:|---:|',
  ];
  for (const group of merged.groups) {
    lines.push(`| ${group.group} | ${group.cases} | ${group.eligibleGeometricMean.toFixed(4)}× | ${group.controls} | ${group.accepted} |`);
  }
  if (merged.controlConfirmation.results.length > 0) {
    lines.push('', '## Fresh-process material-control confirmations', '',
      '| Case | Screening | Eight-process GM | Bonferroni upper bound | Result |',
      '|---:|---:|---:|---:|---|');
    for (const result of merged.controlConfirmation.results) {
      lines.push(`| ${result.caseId} | ${result.screeningSpeedup.toFixed(4)}× | ` +
        `${result.aggregate.pointGeometricMean.toFixed(4)}× | ${result.aggregate.upper.toFixed(4)}× | ` +
        `${result.confirmedMaterialRegression ? 'CONFIRMED regression' : 'not confirmed'} |`);
    }
  }
  lines.push('', 'Raw AB/BA samples, checkpoint captures, source/artifact hashes, p-values, BH q-values, and final decisions are retained in the merged JSON.', '');
  return `${lines.join('\n')}\n`;
}

function validate(shards, smoke = false, options = {}) {
  const confirmationRunsByCase = options.confirmationRunsByCase || new Map();
  const allowPendingControlConfirmation = options.allowPendingControlConfirmation === true;
  const registry = makeRegistry();
  const registrySha256 = registryDigest(registry);
  const registryById = new Map(registry.map((entry) => [entry.id, entry]));
  const currentSource = manifest(root);
  const currentHarness = harnessIdentity();
  const currentArtifacts = artifactIdentity(root);
  const currentRendererGates = rendererGateIdentity();
  const frozenBaseline = extractBaselineManifest();
  const expectedChangedFiles = manifestDiff(frozenBaseline.source, currentSource);
  const currentEnvironment = {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model || 'unknown',
    logicalCores: os.cpus().length,
    typescriptVersion: JSON.parse(fs.readFileSync(path.join(root, 'node_modules/typescript/package.json'), 'utf8')).version,
    typescriptPackageSha256: sha256File(path.join(root, 'node_modules/typescript/package.json')),
  };

  assert.equal(new Set(registry.map((entry) => entry.semanticSha256)).size, 1000, 'registry semantic keys are not unique');
  assert.equal(new Set(registry.map((entry) => entry.executionTraceSha256)).size, 1000, 'registry execution traces are not unique');
  if (!smoke) assert.equal(shards.length, 10, 'release merge requires ten shards');

  const records = [];
  const sourceDigests = new Set();
  const harnessDigests = new Set();
  const artifactDigests = new Set();
  const environmentDigests = new Set();
  const methodologyDigests = new Set();
  const rendererGateDigests = new Set();
  const seenShards = new Set();
  for (const shard of shards) {
    assert.equal(shard.schemaVersion, 1, 'v1.13 shard schema version');
    assert.equal(shard.campaign, 'webphysics-v1.13-production-1000', 'campaign mismatch');
    assert.equal(shard.registryCaseCount, 1000, 'registry size mismatch');
    assert.equal(shard.registrySha256, registrySha256, 'registry digest mismatch');
    assert.equal(shard.baselineArchive, baselineArchiveRelative, 'baseline archive path mismatch');
    assert.equal(shard.baselineArchiveSha256, expectedBaselineSha256, 'baseline archive digest mismatch');
    assert.equal(shard.sourceStableDuringRun, true, `shard ${shard.shard} source changed`);
    assert.equal(shard.harnessStableDuringRun, true, `shard ${shard.shard} harness changed`);
    assert.equal(shard.artifactsStableDuringRun, true, `shard ${shard.shard} artifacts changed`);
    assert.equal(shard.rendererGatesStableDuringRun, true, `shard ${shard.shard} renderer validation evidence changed`);
    assert.deepEqual(shard.candidateSourceAtStart, shard.candidateSourceAtEnd, `shard ${shard.shard} source start/end`);
    assert.deepEqual(shard.harnessAtStart, shard.harnessAtEnd, `shard ${shard.shard} harness start/end`);
    assert.deepEqual(shard.candidateArtifactsAtStart, shard.candidateArtifactsAtEnd, `shard ${shard.shard} artifacts start/end`);
    assert.deepEqual(shard.rendererGatesAtStart, shard.rendererGatesAtEnd, `shard ${shard.shard} renderer validation start/end`);
    assert.deepEqual(shard.baselineSource, compactManifest(frozenBaseline.source), `shard ${shard.shard} baseline source digest`);
    assert.deepEqual(shard.baselineArtifacts, frozenBaseline.artifacts, `shard ${shard.shard} baseline artifacts`);
    if (!smoke || shard.candidateSourceAtStart.sha256 === currentSource.sha256) {
      assert.deepEqual(shard.changedFiles, expectedChangedFiles, `shard ${shard.shard} changed-file manifest`);
      assert.deepEqual(shard.candidateArtifactsAtStart, currentArtifacts, `shard ${shard.shard} candidate artifacts`);
      assert.deepEqual(shard.rendererGatesAtStart, currentRendererGates, `shard ${shard.shard} renderer validation evidence`);
    }
    assert.equal(shard.group, GROUPS[shard.shard - 1], `shard ${shard.shard} group`);
    assert.equal(shard.smokeMode, smoke, `shard ${shard.shard} smoke classification`);
    if (!smoke) {
      assert.equal(shard.caseCount, 100, `shard ${shard.shard} case count`);
      assert.equal(shard.methodology.samples >= 8 && shard.methodology.samples % 2 === 0, true, `shard ${shard.shard} sample count`);
      assert.ok(shard.methodology.targetBatchMs >= 25, `shard ${shard.shard} target batch`);
      assert.ok(shard.methodology.bootstrapCount >= 20000, `shard ${shard.shard} bootstrap count`);
      assert.equal(shard.methodology.workloadScale, 1, `shard ${shard.shard} workload scale`);
    }
    assert.equal(new Set(shard.executionOrder).size, shard.caseCount, `shard ${shard.shard} execution order duplicate`);
    assert.deepEqual([...shard.executionOrder].sort((a, b) => a - b), shard.records.map((record) => record.id), `shard ${shard.shard} execution order coverage`);
    assert.equal(shard.registryCases.length, shard.caseCount, `shard ${shard.shard} registry evidence count`);
    assert.deepEqual(
      shard.registryCases,
      shard.records.map((record) => ({
        id: record.id,
        semanticSha256: registryById.get(record.id).semanticSha256,
        executionTraceSha256: registryById.get(record.id).executionTraceSha256,
      })),
      `shard ${shard.shard} registry evidence`,
    );

    sourceDigests.add(shard.candidateSourceAtStart.sha256);
    harnessDigests.add(shard.harnessAtStart.sha256);
    artifactDigests.add(shard.candidateArtifactsAtStart.sha256);
    environmentDigests.add(sha256Buffer(Buffer.from(stableStringify(shard.environment))));
    methodologyDigests.add(sha256Buffer(Buffer.from(stableStringify(shard.methodology))));
    rendererGateDigests.add(shard.rendererGatesAtStart.sha256);
    assert.equal(seenShards.has(shard.shard), false, `duplicate shard ${shard.shard}`);
    seenShards.add(shard.shard);
    for (const record of shard.records) {
      const definition = registryById.get(record.id);
      assert.ok(definition, `unknown case ${record.id}`);
      assertRecord(record, definition, shard, smoke);
      records.push(record);
    }
  }

  assert.equal(sourceDigests.size, 1, 'shards measured different candidate source trees');
  assert.equal(harnessDigests.size, 1, 'shards used different harness closures');
  assert.equal(artifactDigests.size, 1, 'shards used different candidate artifacts');
  assert.equal(environmentDigests.size, 1, 'shards used different toolchain environments');
  assert.equal(methodologyDigests.size, 1, 'shards used different benchmark methodology');
  assert.equal(rendererGateDigests.size, 1, 'shards used different renderer Metal validation evidence');
  if (smoke && [...sourceDigests][0] !== currentSource.sha256) {
    console.warn('⚠️ smoke note: the shared working source moved after the source-stable smoke run');
  } else {
    assert.equal([...sourceDigests][0], currentSource.sha256, 'working source no longer matches measured candidate');
  }
  assert.equal([...harnessDigests][0], currentHarness.sha256, 'current harness no longer matches measured harness');
  assert.equal([...artifactDigests][0], currentArtifacts.sha256, 'current packaged artifacts do not match measured rebuilt artifacts');
  assert.equal([...rendererGateDigests][0], currentRendererGates.sha256, 'current renderer Metal gates do not match measured gates');
  if (smoke && !currentArtifacts.provenanceValid) {
    console.warn('⚠️ smoke note: native Box3D provenance became stale after the source-stable smoke run');
  } else {
    assert.equal(currentArtifacts.provenanceValid, true, 'native Box3D artifact provenance is stale');
  }
  if (!smoke) assert.equal(currentRendererGates.passed, true,
    'fresh Dawn/Metal renderer runtime, upload-cache, rigid-upload, and startup validation is required');

  records.sort((a, b) => a.id - b.id);
  assert.equal(new Set(records.map((record) => record.id)).size, records.length, 'duplicate case IDs');
  assert.equal(new Set(records.map((record) => record.semanticSha256)).size, records.length, 'duplicate semantic cases');
  assert.equal(new Set(records.map((record) => record.executionTraceSha256)).size, records.length, 'duplicate execution traces');
  if (!smoke) {
    assert.equal(records.length, 1000, 'release evidence must contain exactly 1,000 cases');
    assert.deepEqual(records.map((record) => record.id), Array.from({ length: 1000 }, (_, index) => index + 1), 'case IDs must be exactly 1..1000');
    assert.deepEqual([...seenShards].sort((a, b) => a - b), Array.from({ length: 10 }, (_, index) => index + 1), 'shards must be exactly 1..10');
  }

  const releaseTargetMs = shards[0].methodology.targetBatchMs;
  const changedEligible = records.filter((record) => !record.control && record.correctness.correct &&
    record.minimumTimedBatchMs >= releaseTargetMs * 0.9);
  const qValues = bhQValues(changedEligible);
  const controlsEligible = records.filter((record) => record.control && record.correctness.correct &&
    record.minimumTimedBatchMs >= releaseTargetMs * 0.9);
  const controlRegressionQValues = bhQValues(controlsEligible, 'pRegressionOneSided');
  for (const record of records) {
    record.qValue = qValues.get(record.id) ?? 1;
    record.controlRegressionQValue = controlRegressionQValues.get(record.id) ?? 1;
    record.finalDecision = finalDecision(record, record.qValue, releaseTargetMs);
  }
  const screenedMaterialControls = controlsEligible.filter((record) =>
    record.statistics.speedup < 0.94 && record.controlRegressionQValue <= 0.05);
  const controlConfirmationResults = [];
  if (!smoke && screenedMaterialControls.length > 0 && !allowPendingControlConfirmation) {
    const confirmationContext = {
      registryById,
      registrySha256,
      frozenBaseline,
      currentSource,
      currentHarness,
      currentArtifacts,
      currentRendererGates,
      expectedChangedFiles,
      environment: shards[0].environment,
    };
    for (const record of screenedMaterialControls) {
      const runs = confirmationRunsByCase.get(record.id);
      assert.ok(runs, `case ${record.id} is missing its eight fresh-process control confirmations`);
      const confirmation = validateControlConfirmation(
        record, runs, screenedMaterialControls.length, confirmationContext,
      );
      record.controlConfirmation = confirmation;
      controlConfirmationResults.push(confirmation);
    }
  }

  if (!smoke) {
    assert.equal(records.some((record) => !record.correctness.correct), false, 'a case failed correctness');
    assert.ok(changedEligible.length > 0, 'candidate did not execute any changed eligible paths');
    assert.ok(records.some((record) => record.finalDecision === 'accepted'), 'no optimization survived the release gate');
    if (controlsEligible.length > 0) {
      assert.ok(geometricMean(controlsEligible.map((record) => record.statistics.speedup)) >= 0.98,
        'eligible controls regressed in aggregate');
      if (!allowPendingControlConfirmation) {
        assert.equal(controlConfirmationResults.some((entry) => entry.confirmedMaterialRegression), false,
          'a screened material control regression remained below 0.94x after eight fresh processes and a Bonferroni familywise upper bootstrap bound');
      }
    }
    for (const group of GROUPS) {
      const groupControls = controlsEligible.filter((record) => record.group === group);
      if (groupControls.length > 0) {
        assert.ok(geometricMean(groupControls.map((record) => record.statistics.speedup)) >= 0.98,
          `${group} controls regressed in aggregate`);
      }
    }
    assert.ok(geometricMean(changedEligible.map((record) => record.statistics.speedup)) >= 1.01,
      'eligible changed paths did not retain an aggregate win');
  }

  const eligible = records.filter((record) => record.minimumTimedBatchMs >= releaseTargetMs * 0.9);
  const eligibleControls = eligible.filter((record) => record.control);
  const changed = eligible.filter((record) => !record.control);
  return {
    schemaVersion: 1,
    campaign: 'webphysics-v1.13-production-1000-merged',
    generatedAt: [...shards].sort((a, b) => a.shard - b.shard).at(-1).generatedAt,
    smokeMode: smoke,
    caseCount: records.length,
    shardCount: shards.length,
    registrySha256,
    baselineArchive: baselineArchiveRelative,
    baselineArchiveSha256: expectedBaselineSha256,
    candidateSource: compactManifest(currentSource),
    harness: currentHarness,
    artifacts: currentArtifacts,
    rendererValidation: currentRendererGates,
    environment: shards[0].environment,
    methodology: shards[0].methodology,
    controlConfirmation: {
      screening: 'speedup <0.94x and one-sided regression p-value survives global Benjamini-Hochberg correction at q<=0.05',
      runsPerCase: confirmationRunsPerCase,
      minimumBalancedSamplesPerRun: confirmationSamplesPerRun,
      targetBatchMs: confirmationTargetMs,
      minimumRepetitionCap: confirmationMinimumRepetitionCap,
      processAggregation: 'geometric mean of each fresh process order-balanced AB/BA speedup',
      familywiseInference: 'one-sided upper process bootstrap bound with Bonferroni alpha=0.05/screened-control-family-size',
      threshold: 0.94,
      pending: allowPendingControlConfirmation && screenedMaterialControls.length > 0,
      requiredCaseIds: screenedMaterialControls.map((record) => record.id),
      results: controlConfirmationResults,
    },
    summary: {
      accepted: records.filter((record) => record.finalDecision === 'accepted').length,
      borderline: records.filter((record) => record.finalDecision === 'borderline').length,
      controls: records.filter((record) => record.finalDecision === 'control').length,
      timerFloor: records.filter((record) => record.finalDecision === 'timer-floor').length,
      rejectedNoWin: records.filter((record) => record.finalDecision === 'rejected-no-win').length,
      correctnessFailures: records.filter((record) => !record.correctness.correct).length,
      screenedMaterialControlRegressions: screenedMaterialControls.length,
      confirmedMaterialControlRegressions: controlConfirmationResults.filter((entry) =>
        entry.confirmedMaterialRegression).length,
      materialControlRegressions: controlConfirmationResults.filter((entry) =>
        entry.confirmedMaterialRegression).length,
      eligibleCases: eligible.length,
      changedGeometricMean: changed.length ? geometricMean(changed.map((record) => record.statistics.speedup)) : 1,
      controlGeometricMean: eligibleControls.length ? geometricMean(eligibleControls.map((record) => record.statistics.speedup)) : 1,
    },
    groups: GROUPS.map((group) => {
      const selected = records.filter((record) => record.group === group);
      const selectedEligible = selected.filter((record) => record.minimumTimedBatchMs >= releaseTargetMs * 0.9);
      return {
        group,
        cases: selected.length,
        eligible: selectedEligible.length,
        eligibleGeometricMean: selectedEligible.length
          ? geometricMean(selectedEligible.map((record) => record.statistics.speedup)) : 1,
        controls: selected.filter((record) => record.control).length,
        accepted: selected.filter((record) => record.finalDecision === 'accepted').length,
      };
    }),
    records,
  };
}

function launchControlConfirmations(caseIds) {
  const registryById = new Map(makeRegistry().map((entry) => [entry.id, entry]));
  const harness = path.join(root, 'benchmarks/v113-production-1000.cjs');
  for (const caseId of caseIds) {
    const definition = registryById.get(caseId);
    assert.ok(definition, `cannot launch confirmation for unknown case ${caseId}`);
    for (let runIndex = 1; runIndex <= confirmationRunsPerCase; runIndex++) {
      const filePath = confirmationEvidencePath(caseId, runIndex);
      const outputPrefix = filePath.slice(0, -'.json'.length);
      const parentToken = crypto.randomBytes(24).toString('hex');
      const result = spawnSync(process.execPath, ['--expose-gc', harness], {
        cwd: root,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        env: {
          ...process.env,
          V113_SMOKE: '0',
          V113_CONFIRM: '1',
          V113_CONFIRM_CASE_ID: String(caseId),
          V113_CONFIRM_RUN: String(runIndex),
          V113_CONFIRM_TOKEN: parentToken,
          V113_SHARD: String(definition.shard),
          V113_SAMPLES: String(confirmationSamplesPerRun),
          V113_TARGET_MS: String(confirmationTargetMs),
          V113_BOOTSTRAPS: '20000',
          V113_SCALE: '1',
          V113_CASE_IDS: '',
          V113_CASE_LIMIT: '0',
          V113_OUTPUT_PREFIX: outputPrefix,
        },
      });
      if (result.status !== 0) {
        const detail = [result.stdout, result.stderr].filter(Boolean).join('\n');
        throw new Error(`fresh-process confirmation failed for case ${caseId}, run ${runIndex}\n${detail}`);
      }
      assert.ok(fs.existsSync(filePath), `confirmation process did not write ${filePath}`);
      console.log(`   confirmed process ${runIndex}/${confirmationRunsPerCase} for case ${caseId}`);
    }
  }
}

function loadControlConfirmations(caseIds) {
  return new Map(caseIds.map((caseId) => [caseId,
    Array.from({ length: confirmationRunsPerCase }, (_, index) =>
      loadJson(confirmationEvidencePath(caseId, index + 1)))]));
}

const args = process.argv.slice(2);
const smokeIndex = args.indexOf('--smoke');
if (smokeIndex >= 0) {
  const fileArgument = args[smokeIndex + 1];
  assert.ok(fileArgument, '--smoke requires a shard JSON path');
  const filePath = path.isAbsolute(fileArgument) ? fileArgument : path.join(root, fileArgument);
  const merged = validate([loadJson(filePath)], true);
  console.log(`✅ v1.13 smoke evidence passed: ${merged.caseCount} case(s)`);
} else {
  const verifyOnly = args.includes('--verify');
  const explicit = args.filter((argument) => argument !== '--merge' && argument !== '--verify');
  const shardPaths = explicit.length > 0
    ? explicit.map((argument) => path.isAbsolute(argument) ? argument : path.join(root, argument))
    : Array.from({ length: 10 }, (_, index) =>
      path.join(root, `benchmarks/results/v113-production-1000-shard-${String(index + 1).padStart(2, '0')}.json`));
  const preliminary = validate(shardPaths.map(loadJson), false, {
    allowPendingControlConfirmation: true,
  });
  const confirmationCaseIds = preliminary.controlConfirmation.requiredCaseIds;
  if (!verifyOnly && confirmationCaseIds.length > 0) {
    console.log(`running ${confirmationRunsPerCase} fresh processes for each of ${confirmationCaseIds.length} screened control(s)`);
    launchControlConfirmations(confirmationCaseIds);
  }
  const confirmationRunsByCase = loadControlConfirmations(confirmationCaseIds);
  const merged = validate(shardPaths.map(loadJson), false, { confirmationRunsByCase });
  const outputPath = path.join(root, 'benchmarks/results/v113-production-1000.json');
  const reportPath = path.join(root, 'benchmarks/results/v113-production-1000.md');
  const expectedJson = `${JSON.stringify(merged, null, 2)}\n`;
  const expectedMarkdown = markdown(merged);
  if (verifyOnly) {
    assert.ok(fs.existsSync(outputPath), 'merged v1.13 JSON evidence is missing');
    assert.ok(fs.existsSync(reportPath), 'merged v1.13 Markdown evidence is missing');
    assert.equal(fs.readFileSync(outputPath, 'utf8'), expectedJson, 'merged v1.13 JSON evidence is stale');
    assert.equal(fs.readFileSync(reportPath, 'utf8'), expectedMarkdown, 'merged v1.13 Markdown evidence is stale');
  } else {
    fs.writeFileSync(outputPath, expectedJson);
    fs.writeFileSync(reportPath, expectedMarkdown);
  }
  console.log(`✅ v1.13 exact source-frozen gate passed: ${merged.caseCount}/1000 cases`);
  console.log(`   accepted=${merged.summary.accepted}, controls=${merged.summary.controls}, timer-floor=${merged.summary.timerFloor}`);
  console.log(`   ${verifyOnly ? 'verified' : 'wrote'} ${path.relative(root, outputPath)}`);
  console.log(`   ${verifyOnly ? 'verified' : 'wrote'} ${path.relative(root, reportPath)}`);
}
