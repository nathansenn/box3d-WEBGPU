import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineArchive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.11.0-source.tar.gz');
const currentDir = path.join(root, 'public/box3d');
const currentBridge = path.join(root, 'wasm/box3d_web.c');
const resultDir = path.join(root, 'benchmarks/results');
const sampleCount = Math.max(8, Math.ceil(Number(process.env.B3W_V112_NATIVE_SAMPLES ?? 24) / 2) * 2);
const bootstrapIterations = Math.max(2000, Number(process.env.B3W_V112_NATIVE_BOOTSTRAPS ?? 20000));
const calibrationTargetMs = Math.max(8, Number(process.env.B3W_V112_NATIVE_TARGET_MS ?? 24));
const expected = {
  archiveSha256: '7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537',
  baseline: {
    'box3d.js': '8ec00439683b8da258916ebe90f0cea6a6d0672641fda571936b6012fd3cec3b',
    'box3d.wasm': '55106a695b86c801ff7b79348ed50906e88835f46436083d37bbe09cb494f3f4',
    bridge: 'df439fef40fdb832b355999391bc2d912aa2520e4a78874b1400d646db161f1d',
  },
};

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >>> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function stats(values) {
  const medianMs = median(values);
  return {
    samplesMsPerOperation: values,
    medianMsPerOperation: medianMs,
    madMsPerOperation: median(values.map((value) => Math.abs(value - medianMs))),
    minimumMsPerOperation: Math.min(...values),
    maximumMsPerOperation: Math.max(...values),
  };
}

function geometricMean(values) {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function deterministicRandom(seed = 0x7112b3) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

// Preserve the equal AB/BA design inside every resample. This prevents a slow
// drift in either half of the run from being mistaken for a code-version win.
function stratifiedBalancedBootstrap(baselineValues, currentValues, iterations) {
  assert.equal(baselineValues.length, currentValues.length);
  assert.equal(baselineValues.length & 1, 0);
  const strata = [[], []];
  for (let i = 0; i < baselineValues.length; i++) strata[i & 1].push(i);
  const random = deterministicRandom();
  const ratios = new Float64Array(iterations);
  const resampledBaseline = new Array(baselineValues.length);
  const resampledCurrent = new Array(currentValues.length);
  for (let iteration = 0; iteration < iterations; iteration++) {
    let cursor = 0;
    for (const stratum of strata) {
      for (let i = 0; i < stratum.length; i++) {
        const source = stratum[Math.floor(random() * stratum.length)];
        resampledBaseline[cursor] = baselineValues[source];
        resampledCurrent[cursor] = currentValues[source];
        cursor += 1;
      }
    }
    ratios[iteration] = median(resampledBaseline) / median(resampledCurrent);
  }
  ratios.sort();
  return {
    method: 'deterministic stratified balanced-order paired bootstrap of medians',
    iterations,
    low95: ratios[Math.floor(iterations * 0.025)],
    median: ratios[Math.floor(iterations * 0.5)],
    high95: ratios[Math.floor(iterations * 0.975)],
  };
}

function extractBaseline() {
  assert.equal(sha256File(baselineArchive), expected.archiveSha256, 'v1.11 baseline archive identity changed');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'box3d-v111-native-'));
  const extraction = spawnSync('tar', [
    '-xzf', baselineArchive, '-C', directory,
    'public/box3d/box3d.js',
    'public/box3d/box3d.wasm',
    'public/box3d/BUILD_PROVENANCE.json',
    'wasm/box3d_web.c',
  ], { encoding: 'utf8' });
  if (extraction.status !== 0) {
    throw new Error(`Unable to extract v1.11 native artifact: ${extraction.stderr || extraction.stdout}`);
  }
  return {
    temporaryRoot: directory,
    artifactDir: path.join(directory, 'public/box3d'),
    bridgePath: path.join(directory, 'wasm/box3d_web.c'),
  };
}

function artifactIdentity(artifactDir, bridgePath, frozen = false) {
  const provenancePath = path.join(artifactDir, 'BUILD_PROVENANCE.json');
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  const files = {};
  for (const name of ['box3d.js', 'box3d.wasm']) {
    const filePath = path.join(artifactDir, name);
    const digest = sha256File(filePath);
    const bytes = fs.statSync(filePath).size;
    assert.equal(provenance.artifacts[name].sha256, digest, `${name} does not match its provenance`);
    assert.equal(provenance.artifacts[name].bytes, bytes, `${name} byte count does not match its provenance`);
    if (frozen) assert.equal(digest, expected.baseline[name], `frozen v1.11 ${name} changed`);
    files[name] = { bytes, sha256: digest };
  }
  const bridgeSha256 = sha256File(bridgePath);
  assert.equal(provenance.bridge.sha256, bridgeSha256, 'bridge source does not match artifact provenance');
  if (frozen) assert.equal(bridgeSha256, expected.baseline.bridge, 'frozen v1.11 bridge source changed');
  return { artifactDir, files, bridge: { path: bridgePath, sha256: bridgeSha256 }, provenance };
}

async function loadModule(identity, tag) {
  const jsPath = path.join(identity.artifactDir, 'box3d.js');
  const imported = await import(`${pathToFileURL(jsPath).href}?v112-native=${tag}-${Date.now()}`);
  const mod = await imported.default({ wasmBinary: fs.readFileSync(path.join(identity.artifactDir, 'box3d.wasm')) });
  for (const symbol of [
    '_b3w_create_scene', '_b3w_destroy', '_b3w_body_count', '_b3w_dynamic_count',
    '_b3w_matrices_ptr', '_b3w_colors_ptr', '_b3w_max_bodies', '_b3w_sync_transforms',
    '_b3w_step', '_b3w_explode', '_b3w_kick_stack', '_b3w_launch_projectile',
    '_b3w_spawn_rain', '_b3w_replay_hash', '_b3w_awake_count',
    '_b3w_transform_version', '_b3w_color_version',
  ]) {
    assert.equal(typeof mod[symbol], 'function', `${tag} is missing ${symbol}`);
  }
  return mod;
}

function streamBits(mod, count, kind) {
  const width = kind === 'matrices' ? 16 : 4;
  const pointer = kind === 'matrices' ? mod._b3w_matrices_ptr() : mod._b3w_colors_ptr();
  return new Uint32Array(mod.HEAPF32.buffer, Number(pointer), count * width);
}

function compareBits(a, b, label) {
  assert.equal(a.length, b.length, `${label}: stream lengths differ`);
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) throw new Error(`${label}: bit ${i} differs (${a[i]} != ${b[i]})`);
  }
}

function counters(mod) {
  return {
    bodyCount: mod._b3w_body_count(),
    dynamicCount: mod._b3w_dynamic_count(),
    awakeCount: mod._b3w_awake_count(),
    maxBodies: mod._b3w_max_bodies(),
    transformVersion: mod._b3w_transform_version() >>> 0,
    colorVersion: mod._b3w_color_version() >>> 0,
  };
}

function assertExactWorld(baseline, current, label, includeReplayHash = true) {
  const baselineCounters = counters(baseline);
  const currentCounters = counters(current);
  assert.deepEqual(currentCounters, baselineCounters, `${label}: counters or stream revisions differ`);
  compareBits(streamBits(baseline, baselineCounters.bodyCount, 'matrices'), streamBits(current, currentCounters.bodyCount, 'matrices'), `${label}: matrices`);
  compareBits(streamBits(baseline, baselineCounters.bodyCount, 'colors'), streamBits(current, currentCounters.bodyCount, 'colors'), `${label}: colors`);
  if (includeReplayHash) {
    assert.equal(current._b3w_replay_hash() >>> 0, baseline._b3w_replay_hash() >>> 0, `${label}: replay hash differs`);
  }
  return baselineCounters;
}

const scenarioDefinitions = {
  staticHeavy: { sceneId: 380, stress: 1, seed: 0x380112 },
  nearlyAllDynamic: { sceneId: 3, stress: 5, seed: 0x300112 },
  mixed: { sceneId: 384, stress: 5, seed: 0x384112 },
};

function createScene(mod, scenario) {
  const returned = mod._b3w_create_scene(scenario.sceneId, scenario.stress, scenario.seed >>> 0);
  assert.equal(returned, mod._b3w_body_count());
  return counters(mod);
}

function runCorrectnessSuite(baseline, current) {
  const records = [];
  for (const [scenarioName, scenario] of Object.entries(scenarioDefinitions)) {
    const baselineInitial = createScene(baseline, scenario);
    const currentInitial = createScene(current, scenario);
    assert.deepEqual(currentInitial, baselineInitial, `${scenarioName}: initial counters differ`);
    assertExactWorld(baseline, current, `${scenarioName}: initial`);

    baseline._b3w_sync_transforms();
    current._b3w_sync_transforms();
    assertExactWorld(baseline, current, `${scenarioName}: explicit transform sync`);

    // A definite miss exercises the new squared-distance rejection without
    // changing solver state. The later near-field action proves the retained
    // path still applies identical impulses and evolves to the same pose.
    baseline._b3w_explode(10000, 10000, 10000, 24, 3);
    current._b3w_explode(10000, 10000, 10000, 24, 3);
    assertExactWorld(baseline, current, `${scenarioName}: far explosion`);

    baseline._b3w_explode(0, 3, 0, 18, 9);
    current._b3w_explode(0, 3, 0, 18, 9);
    for (let frame = 0; frame < 12; frame++) {
      baseline._b3w_step(1 / 60, 4);
      current._b3w_step(1 / 60, 4);
      assertExactWorld(baseline, current, `${scenarioName}: near explosion frame ${frame}`);
    }

    baseline._b3w_kick_stack(8);
    current._b3w_kick_stack(8);
    const baselineProjectile = baseline._b3w_launch_projectile(-12, 6, 0, 24, 2, 0, 0.8);
    const currentProjectile = current._b3w_launch_projectile(-12, 6, 0, 24, 2, 0, 0.8);
    const baselineRain = baseline._b3w_spawn_rain(12, 8, 14);
    const currentRain = current._b3w_spawn_rain(12, 8, 14);
    assert.equal(currentProjectile, baselineProjectile, `${scenarioName}: projectile index differs`);
    assert.equal(currentRain, baselineRain, `${scenarioName}: rain count differs`);
    for (let frame = 0; frame < 12; frame++) {
      baseline._b3w_step(1 / 60, 4);
      current._b3w_step(1 / 60, 4);
      assertExactWorld(baseline, current, `${scenarioName}: mixed action frame ${frame}`);
    }
    records.push({
      scenario: scenarioName,
      definition: scenario,
      initial: baselineInitial,
      final: counters(baseline),
      replayHash: baseline._b3w_replay_hash() >>> 0,
      matrixBitsCompared: baseline._b3w_body_count() * 16 * 27,
      colorBitsCompared: baseline._b3w_body_count() * 4 * 27,
      exact: true,
    });
  }
  return records;
}

function elapsedFor(mod, operation, repeats) {
  const start = performance.now();
  for (let i = 0; i < repeats; i++) operation(mod);
  return performance.now() - start;
}

function calibrate(mod, operation, scenario) {
  createScene(mod, scenario);
  for (let i = 0; i < 64; i++) operation(mod);
  let repeats = 16;
  let elapsedMs = 0;
  for (let round = 0; round < 12; round++) {
    elapsedMs = elapsedFor(mod, operation, repeats);
    if (elapsedMs >= calibrationTargetMs * 0.85 || repeats >= 1_048_576) break;
    const projected = elapsedMs > 0 ? Math.ceil(repeats * calibrationTargetMs / elapsedMs) : repeats * 4;
    repeats = Math.min(1_048_576, Math.max(repeats * 2, Math.min(repeats * 8, projected)));
  }
  return { repeats, pilotElapsedMs: elapsedMs, targetMs: calibrationTargetMs };
}

function classify(speedup, interval, timerFloorPassed) {
  const relativeIntervalWidth = (interval.high95 - interval.low95) / speedup;
  if (!timerFloorPassed || relativeIntervalWidth > 0.15) return 'too noisy / no claim';
  if (interval.low95 > 1.03) return 'accepted measured win';
  if (interval.high95 < 0.95) return 'measured material regression';
  if (interval.high95 < 1) return 'bounded measured slowdown within 5% materiality envelope';
  if (interval.low95 > 1) return 'small measured gain below acceptance threshold';
  return 'parity / no proven difference';
}

function benchmarkCase(baseline, current, definition) {
  const calibration = calibrate(baseline, definition.operation, definition.scenario);
  const raw = { baseline: [], current: [] };
  const elapsed = { baseline: [], current: [] };
  const order = [];
  for (let sample = 0; sample < sampleCount; sample++) {
    const variants = sample & 1 ? ['current', 'baseline'] : ['baseline', 'current'];
    order.push(variants.join('→'));
    for (const variant of variants) {
      const mod = variant === 'baseline' ? baseline : current;
      createScene(mod, definition.scenario);
      for (let warmup = 0; warmup < 64; warmup++) definition.operation(mod);
      const sampleElapsed = elapsedFor(mod, definition.operation, calibration.repeats);
      elapsed[variant].push(sampleElapsed);
      raw[variant].push(sampleElapsed / calibration.repeats);
    }
  }
  const baselineStats = stats(raw.baseline);
  const currentStats = stats(raw.current);
  const speedup = baselineStats.medianMsPerOperation / currentStats.medianMsPerOperation;
  const interval = stratifiedBalancedBootstrap(raw.baseline, raw.current, bootstrapIterations);
  const timerFloorGuard = {
    calibratedBatchMedianBaselineMs: median(elapsed.baseline),
    calibratedBatchMedianCurrentMs: median(elapsed.current),
    minimumRequiredBatchMs: calibrationTargetMs * 0.5,
    passed: Math.min(median(elapsed.baseline), median(elapsed.current)) >= calibrationTargetMs * 0.5,
  };
  return {
    id: definition.id,
    label: definition.label,
    scene: definition.scenario,
    population: createScene(baseline, definition.scenario),
    operation: definition.operationDescription,
    calibration,
    samples: sampleCount,
    balancedOrder: { AB: sampleCount / 2, BA: sampleCount / 2, order },
    baseline: { ...baselineStats, elapsedMsPerSample: elapsed.baseline },
    current: { ...currentStats, elapsedMsPerSample: elapsed.current },
    speedup,
    timeReductionPercent: (1 - 1 / speedup) * 100,
    pairedBootstrap95: interval,
    confidenceRelativeWidth: (interval.high95 - interval.low95) / speedup,
    classification: classify(speedup, interval, timerFloorGuard.passed),
    timerFloorGuard,
  };
}

const extracted = extractBaseline();
let baseline;
let current;
try {
  const baselineIdentity = artifactIdentity(extracted.artifactDir, extracted.bridgePath, true);
  const currentIdentity = artifactIdentity(currentDir, currentBridge, false);
  const identitiesAtStart = {
    archive: { path: baselineArchive, bytes: fs.statSync(baselineArchive).size, sha256: sha256File(baselineArchive) },
    baseline: baselineIdentity,
    current: currentIdentity,
  };
  [baseline, current] = await Promise.all([
    loadModule(baselineIdentity, 'baseline'),
    loadModule(currentIdentity, 'current'),
  ]);

  const correctness = runCorrectnessSuite(baseline, current);
  const benchmarkDefinitions = [
    {
      id: 'sync-static-heavy',
      label: 'Static-heavy explicit transform synchronization',
      scenario: scenarioDefinitions.staticHeavy,
      operation: (mod) => mod._b3w_sync_transforms(),
      operationDescription: 'b3w_sync_transforms; 72 static and 55 dynamic bodies',
    },
    {
      id: 'sync-nearly-all-dynamic-control',
      label: 'Nearly-all-dynamic explicit transform synchronization',
      scenario: scenarioDefinitions.nearlyAllDynamic,
      operation: (mod) => mod._b3w_sync_transforms(),
      operationDescription: 'b3w_sync_transforms; one static floor and 4,095 dynamic bodies',
    },
    {
      id: 'far-explosion-static-heavy',
      label: 'Static-heavy definite-miss explosion rejection',
      scenario: scenarioDefinitions.staticHeavy,
      operation: (mod) => mod._b3w_explode(10000, 10000, 10000, 24, 3),
      operationDescription: 'b3w_explode at a far center; no body can be inside radius',
    },
    {
      id: 'far-explosion-nearly-all-dynamic',
      label: 'Nearly-all-dynamic definite-miss explosion rejection',
      scenario: scenarioDefinitions.nearlyAllDynamic,
      operation: (mod) => mod._b3w_explode(10000, 10000, 10000, 24, 3),
      operationDescription: 'b3w_explode at a far center across 4,095 dynamic bodies',
    },
    {
      id: 'mixed-sync-and-far-explosion',
      label: 'Mixed static/dynamic frame preparation',
      scenario: scenarioDefinitions.mixed,
      operation: (mod) => {
        mod._b3w_sync_transforms();
        mod._b3w_explode(10000, 10000, 10000, 24, 3);
      },
      operationDescription: 'one explicit transform synchronization plus one definite-miss explosion',
    },
  ];
  const cases = benchmarkDefinitions.map((definition) => benchmarkCase(baseline, current, definition));
  const identitiesAtEnd = {
    archiveSha256: sha256File(baselineArchive),
    baselineJsSha256: sha256File(path.join(extracted.artifactDir, 'box3d.js')),
    baselineWasmSha256: sha256File(path.join(extracted.artifactDir, 'box3d.wasm')),
    currentJsSha256: sha256File(path.join(currentDir, 'box3d.js')),
    currentWasmSha256: sha256File(path.join(currentDir, 'box3d.wasm')),
    baselineBridgeSha256: sha256File(extracted.bridgePath),
    currentBridgeSha256: sha256File(currentBridge),
  };
  assert.equal(identitiesAtEnd.archiveSha256, identitiesAtStart.archive.sha256, 'baseline archive changed during benchmark');
  assert.equal(identitiesAtEnd.currentWasmSha256, identitiesAtStart.current.files['box3d.wasm'].sha256, 'current WASM changed during benchmark');
  assert.equal(identitiesAtEnd.currentBridgeSha256, identitiesAtStart.current.bridge.sha256, 'current bridge changed during benchmark');

  const accepted = cases.filter((entry) => entry.classification === 'accepted measured win');
  const controls = cases.filter((entry) => entry.classification === 'parity / no proven difference');
  const smallGains = cases.filter((entry) => entry.classification === 'small measured gain below acceptance threshold');
  const boundedSlowdowns = cases.filter((entry) => entry.classification === 'bounded measured slowdown within 5% materiality envelope');
  const noisy = cases.filter((entry) => entry.classification === 'too noisy / no claim');
  const regressions = cases.filter((entry) => entry.classification === 'measured material regression');
  const currentArtifactStaleness = {
    bridgeMatchesBuildProvenance: identitiesAtStart.current.bridge.sha256 === identitiesAtStart.current.provenance.bridge.sha256,
    jsMatchesBuildProvenance: identitiesAtStart.current.files['box3d.js'].sha256 === identitiesAtStart.current.provenance.artifacts['box3d.js'].sha256,
    wasmMatchesBuildProvenance: identitiesAtStart.current.files['box3d.wasm'].sha256 === identitiesAtStart.current.provenance.artifacts['box3d.wasm'].sha256,
    artifactChangedDuringRun: identitiesAtEnd.currentJsSha256 !== identitiesAtStart.current.files['box3d.js'].sha256 || identitiesAtEnd.currentWasmSha256 !== identitiesAtStart.current.files['box3d.wasm'].sha256,
    bridgeChangedDuringRun: identitiesAtEnd.currentBridgeSha256 !== identitiesAtStart.current.bridge.sha256,
    sourceMtimeMs: fs.statSync(currentBridge).mtimeMs,
    wasmMtimeMs: fs.statSync(path.join(currentDir, 'box3d.wasm')).mtimeMs,
  };
  currentArtifactStaleness.sourceNewerThanArtifact = currentArtifactStaleness.sourceMtimeMs > currentArtifactStaleness.wasmMtimeMs + 1;
  currentArtifactStaleness.stale = !currentArtifactStaleness.bridgeMatchesBuildProvenance ||
    !currentArtifactStaleness.jsMatchesBuildProvenance ||
    !currentArtifactStaleness.wasmMatchesBuildProvenance ||
    currentArtifactStaleness.artifactChangedDuringRun ||
    currentArtifactStaleness.bridgeChangedDuringRun ||
    currentArtifactStaleness.sourceNewerThanArtifact;
  const frozenBaseline = {
    archiveSha256Expected: expected.archiveSha256,
    archiveSha256Actual: identitiesAtStart.archive.sha256,
    archiveMatch: identitiesAtStart.archive.sha256 === expected.archiveSha256,
    jsSha256Expected: expected.baseline['box3d.js'],
    jsSha256Actual: identitiesAtStart.baseline.files['box3d.js'].sha256,
    wasmSha256Expected: expected.baseline['box3d.wasm'],
    wasmSha256Actual: identitiesAtStart.baseline.files['box3d.wasm'].sha256,
    bridgeSha256Expected: expected.baseline.bridge,
    bridgeSha256Actual: identitiesAtStart.baseline.bridge.sha256,
    sourceFrozen: true,
    changedDuringRun: identitiesAtEnd.archiveSha256 !== identitiesAtStart.archive.sha256 ||
      identitiesAtEnd.baselineJsSha256 !== identitiesAtStart.baseline.files['box3d.js'].sha256 ||
      identitiesAtEnd.baselineWasmSha256 !== identitiesAtStart.baseline.files['box3d.wasm'].sha256 ||
      identitiesAtEnd.baselineBridgeSha256 !== identitiesAtStart.baseline.bridge.sha256,
  };
  const exactness = {
    matrices: correctness.every((entry) => entry.exact),
    colors: correctness.every((entry) => entry.exact),
    replayHashes: correctness.every((entry) => entry.exact),
    observableStateAndCounters: correctness.every((entry) => entry.exact),
  };
  const gates = {
    frozenBaselineArchive: frozenBaseline.archiveMatch && !frozenBaseline.changedDuringRun,
    frozenBaselineArtifacts: identitiesAtStart.baseline.files['box3d.js'].sha256 === expected.baseline['box3d.js'] && identitiesAtStart.baseline.files['box3d.wasm'].sha256 === expected.baseline['box3d.wasm'],
    distinctWasmCandidate: identitiesAtStart.baseline.files['box3d.wasm'].sha256 !== identitiesAtStart.current.files['box3d.wasm'].sha256,
    currentArtifactNotStale: !currentArtifactStaleness.stale,
    exactMatrices: exactness.matrices,
    exactColors: exactness.colors,
    exactReplayHashes: exactness.replayHashes,
    exactStateAndCounters: exactness.observableStateAndCounters,
    balancedOrder: cases.every((entry) => entry.balancedOrder.AB === entry.balancedOrder.BA),
    calibratedBatchesAboveTimerFloor: cases.every((entry) => entry.timerFloorGuard.passed),
    everyCaseClassified: accepted.length + controls.length + smallGains.length + boundedSlowdowns.length + noisy.length + regressions.length === cases.length,
  };
  const optimizationGates = {
    atLeastOneConfidenceBoundedWin: accepted.length > 0,
    noMeasuredMaterialRegression: regressions.length === 0,
  };
  const result = {
    schemaVersion: 1,
    title: 'Box3D WebGPU v1.12 native dynamic-index and explosion-rejection benchmark',
    generatedAt: new Date().toISOString(),
    platform: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: os.cpus()[0]?.model ?? 'unknown',
    },
    artifacts: identitiesAtStart,
    baseline: frozenBaseline,
    candidate: {
      jsSha256: identitiesAtStart.current.files['box3d.js'].sha256,
      wasmSha256: identitiesAtStart.current.files['box3d.wasm'].sha256,
      bridgeSha256: identitiesAtStart.current.bridge.sha256,
      staleness: currentArtifactStaleness,
    },
    identitiesAtEnd,
    staleness: {
      frozenBaselineChangedDuringRun: frozenBaseline.changedDuringRun,
      currentArtifact: currentArtifactStaleness,
      stale: frozenBaseline.changedDuringRun || currentArtifactStaleness.stale,
    },
    methodology: {
      sourceFrozenComparison: 'exact v1.11 source archive public/box3d JS+WASM versus current public/box3d JS+WASM',
      sampleCountPerVariantPerCase: sampleCount,
      balancedOrder: `${sampleCount / 2} AB and ${sampleCount / 2} BA samples per case`,
      calibrationTargetMs,
      calibration: 'baseline pilot doubles/projects a shared repeat count until the timed batch approaches the target; both variants then use exactly that repeat count',
      statistic: 'median milliseconds per operation with MAD',
      confidence: `${bootstrapIterations.toLocaleString()}-resample deterministic stratified balanced-order paired bootstrap of medians`,
      correctness: 'bit-exact Float32 matrix and color streams, replay hashes, body/dynamic/awake counts, max-body counter, and transform/color revisions after sync, definite-miss and near-field explosions, steps, kick, projectile, and rain',
      timerFloorPolicy: 'no per-call claim is accepted unless both variants execute a calibrated batch whose median duration is at least half the target',
      classification: 'accepted only when the confidence lower bound exceeds 1.03x; otherwise >=0.95x point estimate is reported as parity/control, never as a win',
    },
    correctness,
    exactness,
    cases,
    records: cases,
    summary: {
      totalCases: cases.length,
      acceptedMeasuredWins: accepted.length,
      parityControls: controls.length,
      smallUnacceptedGains: smallGains.length,
      boundedSlowdownsWithinMaterialityEnvelope: boundedSlowdowns.length,
      tooNoisyNoClaim: noisy.length,
      measuredMaterialRegressions: regressions.length,
      acceptedGeometricMeanSpeedup: accepted.length ? geometricMean(accepted.map((entry) => entry.speedup)) : 1,
      allCaseGeometricMeanSpeedup: geometricMean(cases.map((entry) => entry.speedup)),
      acceptedIds: accepted.map((entry) => entry.id),
      controlIds: controls.map((entry) => entry.id),
      smallGainIds: smallGains.map((entry) => entry.id),
      boundedSlowdownIds: boundedSlowdowns.map((entry) => entry.id),
      noisyIds: noisy.map((entry) => entry.id),
      regressionIds: regressions.map((entry) => entry.id),
    },
    scopeBoundary: 'These are native bridge subsystem timings in Node/WASM. They do not measure full browser frame rate, Box3D solver throughput, or physical-GPU execution.',
    gates,
    optimizationGates,
    passed: Object.values(gates).every(Boolean),
    optimizationPassed: Object.values(optimizationGates).every(Boolean),
  };

  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(path.join(resultDir, 'v112-native-candidates.json'), `${JSON.stringify(result, null, 2)}\n`);
  const rows = cases.map((entry) =>
    `| ${entry.label} | ${entry.population.bodyCount} / ${entry.population.dynamicCount} | ${entry.speedup.toFixed(3)}× | ${entry.pairedBootstrap95.low95.toFixed(3)}–${entry.pairedBootstrap95.high95.toFixed(3)}× | ${entry.classification} |`,
  ).join('\n');
  const markdown = `# v1.12 native Box3D focused benchmark\n\n` +
    `Compared the exact frozen v1.11 native artifact with the current v1.12 artifact. Matrix bits, color bits, replay hashes, observable state, counts, and stream revisions remained exact across all three correctness scenarios.\n\n` +
    `| Case | Bodies / dynamic | Median speedup | Balanced-bootstrap 95% interval | Classification |\n` +
    `|---|---:|---:|---:|---|\n${rows}\n\n` +
    `- Frozen v1.11 archive: \`${identitiesAtStart.archive.sha256}\`\n` +
    `- Frozen v1.11 WASM: \`${identitiesAtStart.baseline.files['box3d.wasm'].sha256}\`\n` +
    `- Current v1.12 WASM: \`${identitiesAtStart.current.files['box3d.wasm'].sha256}\`\n` +
    `- Frozen v1.11 bridge: \`${identitiesAtStart.baseline.bridge.sha256}\`\n` +
    `- Current v1.12 bridge: \`${identitiesAtStart.current.bridge.sha256}\`\n` +
    `- Samples: **${sampleCount} per variant per case**, exactly balanced AB/BA\n` +
    `- Confidence: **${bootstrapIterations.toLocaleString()}** deterministic stratified balanced-order resamples\n` +
    `- Accepted wins: **${accepted.length}**; parity controls: **${controls.length}**; small unaccepted gains: **${smallGains.length}**; bounded slowdowns under 5%: **${boundedSlowdowns.length}**; too noisy/no claim: **${noisy.length}**; material regressions: **${regressions.length}**\n` +
    `- Accepted-path geometric mean: **${result.summary.acceptedGeometricMeanSpeedup.toFixed(3)}×**\n\n` +
    `The nearly-all-dynamic transform case is an intentional control: the dynamic-index optimization has almost no static work to remove there, so it is not presented as a speedup unless its confidence interval independently proves one. Definite-miss explosions measure the squared-distance rejection path. These are bridge subsystem timings, not browser FPS claims.\n`;
  fs.writeFileSync(path.join(resultDir, 'v112-native-candidates.md'), markdown);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  baseline?._b3w_destroy();
  current?._b3w_destroy();
  fs.rmSync(extracted.temporaryRoot, { recursive: true, force: true });
}
