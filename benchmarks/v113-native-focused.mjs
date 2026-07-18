import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const baselineArchive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.12.0-source.tar.gz');
const candidateDir = path.resolve(process.env.B3W_NATIVE_CANDIDATE_DIR ?? path.join(root, 'public/box3d'));
const candidateBridge = path.resolve(process.env.B3W_NATIVE_CANDIDATE_BRIDGE ?? path.join(root, 'wasm/box3d_web.c'));
const resultDir = path.join(root, 'benchmarks/results');
const sampleCount = Math.max(4, Math.ceil(Number(process.env.B3W_NATIVE_FOCUSED_SAMPLES ?? 12) / 2) * 2);
const bootstrapIterations = Math.max(1000, Number(process.env.B3W_NATIVE_FOCUSED_BOOTSTRAPS ?? 10000));
const calibrationTargetMs = Math.max(4, Number(process.env.B3W_NATIVE_FOCUSED_TARGET_MS ?? 20));
const expected = {
  archive: '33d7fc828fdea54e087f25815bcdabd8f9608fcda6912e1e5c7dd57139534c67',
  js: '8ec00439683b8da258916ebe90f0cea6a6d0672641fda571936b6012fd3cec3b',
  wasm: '03cf2a4a24e2c4aab33d51411c6bd3ff21440f068a3c8830ece34ad0ed9f168a',
  bridge: '5807ca7b29b8a7f7cfebbd15a78d843a97290978d571d5bb6b135890b4f13a18',
};

const scenarios = {
  smallSleep: { sceneId: 700, stress: 1, seed: 0x700113 },
  staticHeavy: { sceneId: 380, stress: 1, seed: 0x380113 },
  mixed: { sceneId: 384, stress: 5, seed: 0x384113 },
  dense: { sceneId: 3, stress: 5, seed: 0x300113 },
  denseSleep: { sceneId: 299, stress: 5, seed: 0x299113 },
};

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >>> 1;
  return sorted.length & 1 ? sorted[middle] : 0.5 * (sorted[middle - 1] + sorted[middle]);
}

function stats(values) {
  const med = median(values);
  return {
    rawMsPerOperation: values,
    medianMsPerOperation: med,
    madMsPerOperation: median(values.map((value) => Math.abs(value - med))),
    minimumMsPerOperation: Math.min(...values),
    maximumMsPerOperation: Math.max(...values),
  };
}

function deterministicRandom(seed = 0x7113b3) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function balancedBootstrap(baselineValues, candidateValues, iterations) {
  assert.equal(baselineValues.length, candidateValues.length);
  assert.equal(baselineValues.length & 1, 0);
  const strata = [[], []];
  for (let i = 0; i < baselineValues.length; i++) strata[i & 1].push(i);
  const random = deterministicRandom();
  const ratios = new Float64Array(iterations);
  const baselineSample = new Array(baselineValues.length);
  const candidateSample = new Array(candidateValues.length);
  for (let iteration = 0; iteration < iterations; iteration++) {
    let cursor = 0;
    for (const stratum of strata) {
      for (let i = 0; i < stratum.length; i++) {
        const source = stratum[Math.floor(random() * stratum.length)];
        baselineSample[cursor] = baselineValues[source];
        candidateSample[cursor] = candidateValues[source];
        cursor += 1;
      }
    }
    ratios[iteration] = median(baselineSample) / median(candidateSample);
  }
  ratios.sort();
  return {
    method: 'deterministic stratified balanced-order bootstrap of medians',
    iterations,
    low95: ratios[Math.floor(iterations * 0.025)],
    median: ratios[Math.floor(iterations * 0.5)],
    high95: ratios[Math.floor(iterations * 0.975)],
  };
}

function extractBaseline() {
  assert.equal(sha256File(baselineArchive), expected.archive, 'frozen v1.12 archive changed');
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'box3d-v112-focused-'));
  const extraction = spawnSync('tar', [
    '-xzf', baselineArchive, '-C', temporaryRoot,
    'public/box3d/box3d.js',
    'public/box3d/box3d.wasm',
    'public/box3d/BUILD_PROVENANCE.json',
    'wasm/box3d_web.c',
  ], { encoding: 'utf8' });
  if (extraction.status !== 0) throw new Error(extraction.stderr || extraction.stdout);
  return {
    temporaryRoot,
    artifactDir: path.join(temporaryRoot, 'public/box3d'),
    bridgePath: path.join(temporaryRoot, 'wasm/box3d_web.c'),
  };
}

function artifactIdentity(artifactDir, bridgePath, frozen) {
  const provenancePath = path.join(artifactDir, 'BUILD_PROVENANCE.json');
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  const files = {};
  for (const name of ['box3d.js', 'box3d.wasm']) {
    const filePath = path.join(artifactDir, name);
    files[name] = { bytes: fs.statSync(filePath).size, sha256: sha256File(filePath) };
    assert.equal(files[name].sha256, provenance.artifacts[name].sha256, `${name} provenance digest differs`);
    assert.equal(files[name].bytes, provenance.artifacts[name].bytes, `${name} provenance byte count differs`);
  }
  const bridgeSha256 = sha256File(bridgePath);
  if (frozen) {
    assert.equal(files['box3d.js'].sha256, expected.js, 'frozen v1.12 JS changed');
    assert.equal(files['box3d.wasm'].sha256, expected.wasm, 'frozen v1.12 WASM changed');
    assert.equal(bridgeSha256, expected.bridge, 'frozen v1.12 bridge changed');
  }
  return {
    artifactDir,
    files,
    provenanceFileSha256: sha256File(provenancePath),
    bridge: {
      path: bridgePath,
      sha256: bridgeSha256,
      provenanceSha256: provenance.bridge.sha256,
      matchesArtifactProvenance: bridgeSha256 === provenance.bridge.sha256,
    },
    provenance,
  };
}

async function loadModule(identity, tag) {
  const jsPath = path.join(identity.artifactDir, 'box3d.js');
  const imported = await import(`${pathToFileURL(jsPath).href}?native-focused=${tag}-${Date.now()}`);
  const mod = await imported.default({ wasmBinary: fs.readFileSync(path.join(identity.artifactDir, 'box3d.wasm')) });
  for (const symbol of [
    '_b3w_create_scene', '_b3w_destroy', '_b3w_body_count', '_b3w_dynamic_count',
    '_b3w_matrices_ptr', '_b3w_colors_ptr', '_b3w_max_bodies', '_b3w_sync_transforms',
    '_b3w_step', '_b3w_explode', '_b3w_kick_stack', '_b3w_replay_hash',
    '_b3w_awake_count', '_b3w_transform_version', '_b3w_color_version',
  ]) assert.equal(typeof mod[symbol], 'function', `${tag} missing ${symbol}`);
  return mod;
}

function streamBits(mod, count, kind) {
  const width = kind === 'matrix' ? 16 : 4;
  const pointer = kind === 'matrix' ? mod._b3w_matrices_ptr() : mod._b3w_colors_ptr();
  return new Uint32Array(mod.HEAPF32.buffer, Number(pointer), count * width);
}

function compareBits(a, b, label) {
  assert.equal(a.length, b.length, `${label}: lengths differ`);
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

function assertExactWorld(baseline, candidate, label, compareRevisions = true) {
  const baselineCounters = counters(baseline);
  const candidateCounters = counters(candidate);
  const comparableBaseline = compareRevisions ? baselineCounters : {
    bodyCount: baselineCounters.bodyCount,
    dynamicCount: baselineCounters.dynamicCount,
    awakeCount: baselineCounters.awakeCount,
    maxBodies: baselineCounters.maxBodies,
  };
  const comparableCandidate = compareRevisions ? candidateCounters : {
    bodyCount: candidateCounters.bodyCount,
    dynamicCount: candidateCounters.dynamicCount,
    awakeCount: candidateCounters.awakeCount,
    maxBodies: candidateCounters.maxBodies,
  };
  assert.deepEqual(comparableCandidate, comparableBaseline, `${label}: counters/revisions differ`);
  compareBits(streamBits(baseline, baselineCounters.bodyCount, 'matrix'), streamBits(candidate, candidateCounters.bodyCount, 'matrix'), `${label}: matrices`);
  compareBits(streamBits(baseline, baselineCounters.bodyCount, 'color'), streamBits(candidate, candidateCounters.bodyCount, 'color'), `${label}: colors`);
  assert.equal(candidate._b3w_replay_hash() >>> 0, baseline._b3w_replay_hash() >>> 0, `${label}: replay hash differs`);
  return baselineCounters;
}

function createScene(mod, scenario) {
  const returned = mod._b3w_create_scene(scenario.sceneId, scenario.stress, scenario.seed >>> 0);
  assert.equal(returned, mod._b3w_body_count());
  return counters(mod);
}

function matrixPosition(mod, index) {
  const start = Number(mod._b3w_matrices_ptr()) >>> 2;
  return [mod.HEAPF32[start + index * 16 + 12], mod.HEAPF32[start + index * 16 + 13], mod.HEAPF32[start + index * 16 + 14]];
}

function prepareAwakeRatio(mod, scenario, ratio, maxFrames = 1200) {
  const initial = createScene(mod, scenario);
  const threshold = Math.max(1, Math.floor(initial.dynamicCount * ratio));
  for (let frame = 0; frame < maxFrames; frame++) {
    mod._b3w_step(1 / 60, 4);
    const awakeCount = mod._b3w_awake_count();
    if (awakeCount > 0 && awakeCount <= threshold) {
      return { initial, preparationFrames: frame + 1, awakeCount, ratio: awakeCount / initial.dynamicCount };
    }
  }
  throw new Error(`scene ${scenario.sceneId} did not reach awake ratio ${ratio}`);
}

function runCorrectness(baseline, candidate) {
  const records = [];

  createScene(baseline, scenarios.staticHeavy);
  createScene(candidate, scenarios.staticHeavy);
  assertExactWorld(baseline, candidate, 'explosion initial');
  baseline._b3w_explode(10000, 10000, 10000, 24, 3);
  candidate._b3w_explode(10000, 10000, 10000, 24, 3);
  assertExactWorld(baseline, candidate, 'explosion definite miss');

  createScene(baseline, scenarios.mixed);
  createScene(candidate, scenarios.mixed);
  baseline._b3w_explode(0, 3, 0, 18, 9);
  candidate._b3w_explode(0, 3, 0, 18, 9);
  for (let frame = 0; frame < 12; frame++) {
    baseline._b3w_step(1 / 60, 4);
    candidate._b3w_step(1 / 60, 4);
    assertExactWorld(baseline, candidate, `mixed explosion frame ${frame}`);
  }

  createScene(baseline, scenarios.smallSleep);
  createScene(candidate, scenarios.smallSleep);
  assertExactWorld(baseline, candidate, 'boundary initial');
  const [x, y, z] = matrixPosition(baseline, 1);
  const radius = 3;
  baseline._b3w_explode(x + radius, y, z, 18, radius);
  candidate._b3w_explode(x + radius, y, z, 18, radius);
  for (let frame = 0; frame < 12; frame++) {
    baseline._b3w_step(1 / 60, 4);
    candidate._b3w_step(1 / 60, 4);
    assertExactWorld(baseline, candidate, `boundary explosion frame ${frame}`);
  }
  records.push({ family: 'explosion', exact: true });

  createScene(baseline, scenarios.staticHeavy);
  createScene(candidate, scenarios.staticHeavy);
  baseline._b3w_kick_stack(8);
  candidate._b3w_kick_stack(8);
  for (let frame = 0; frame < 12; frame++) {
    baseline._b3w_step(1 / 60, 4);
    candidate._b3w_step(1 / 60, 4);
    assertExactWorld(baseline, candidate, `cached-position kick frame ${frame}`);
  }
  records.push({ family: 'kick', exact: true });

  for (const scenario of [scenarios.dense, scenarios.staticHeavy, scenarios.mixed, scenarios.smallSleep]) {
    createScene(baseline, scenario);
    createScene(candidate, scenario);
    assertExactWorld(baseline, candidate, `construction scene ${scenario.sceneId}`);
    for (let frame = 0; frame < 3; frame++) {
      baseline._b3w_step(1 / 60, 4);
      candidate._b3w_step(1 / 60, 4);
    }
    assertExactWorld(baseline, candidate, `construction evolved scene ${scenario.sceneId}`);
  }
  records.push({ family: 'construction-reset', exact: true });

  for (const definition of [
    { label: 'static partial sleep', scenario: scenarios.staticHeavy, ratio: 0.25 },
    { label: 'dense partial sleep', scenario: scenarios.denseSleep, ratio: 0.10 },
  ]) {
    const baselinePrepared = prepareAwakeRatio(baseline, definition.scenario, definition.ratio);
    const candidatePrepared = prepareAwakeRatio(candidate, definition.scenario, definition.ratio);
    assert.deepEqual(candidatePrepared, baselinePrepared, `${definition.label}: preparation differs`);
    assertExactWorld(baseline, candidate, definition.label);
    for (let frame = 0; frame < 8; frame++) {
      baseline._b3w_step(1 / 60, 4);
      candidate._b3w_step(1 / 60, 4);
      assertExactWorld(baseline, candidate, `${definition.label} frame ${frame}`);
    }
  }
  records.push({ family: 'partial-sleep-transform-sync', exact: true });
  return records;
}

function elapsedFor(mod, definition, context, repeats) {
  const start = performance.now();
  for (let i = 0; i < repeats; i++) definition.operation(mod, context, i);
  return performance.now() - start;
}

function prepareCase(mod, definition) {
  return definition.prepare(mod);
}

function warmCase(mod, definition, context) {
  for (let i = 0; i < (definition.warmups ?? 4); i++) definition.operation(mod, context, i);
}

function calibrate(mod, definition) {
  if (definition.fixedRepeats) return { repeats: definition.fixedRepeats, fixed: true, targetMs: calibrationTargetMs };
  let repeats = 1;
  let elapsedMs = 0;
  for (let round = 0; round < 10; round++) {
    const context = prepareCase(mod, definition);
    warmCase(mod, definition, context);
    elapsedMs = elapsedFor(mod, definition, context, repeats);
    if (elapsedMs >= calibrationTargetMs * 0.85 || repeats >= (definition.maxRepeats ?? 1_048_576)) break;
    const projected = elapsedMs > 0 ? Math.ceil(repeats * calibrationTargetMs / elapsedMs) : repeats * 4;
    repeats = Math.min(definition.maxRepeats ?? 1_048_576, Math.max(repeats * 2, Math.min(repeats * 8, projected)));
  }
  return { repeats, fixed: false, pilotElapsedMs: elapsedMs, targetMs: calibrationTargetMs };
}

function classify(speedup, interval, floorPassed, distinctCandidate) {
  if (!distinctCandidate) return 'identity control: artifacts are byte-identical';
  const relativeWidth = (interval.high95 - interval.low95) / speedup;
  if (!floorPassed || relativeWidth > 0.20) return 'too noisy / no claim';
  if (interval.low95 > 1.03) return 'accepted measured win';
  if (interval.high95 < 0.95) return 'measured material regression';
  if (interval.low95 > 1) return 'small gain below acceptance threshold';
  return 'parity / no proven difference';
}

function benchmarkCase(baseline, candidate, definition, distinctCandidate) {
  const calibration = calibrate(baseline, definition);
  if (!definition.fixedRepeats) {
    const maximum = definition.maxRepeats ?? 1_048_576;
    for (let round = 0; round < 6 && calibration.repeats < maximum; round++) {
      const context = prepareCase(candidate, definition);
      warmCase(candidate, definition, context);
      const candidatePilotMs = elapsedFor(candidate, definition, context, calibration.repeats);
      calibration.candidatePilotMs = candidatePilotMs;
      if (candidatePilotMs >= calibrationTargetMs * 0.85) break;
      const projected = candidatePilotMs > 0 ? Math.ceil(calibration.repeats * calibrationTargetMs / candidatePilotMs) : calibration.repeats * 4;
      calibration.repeats = Math.min(maximum, Math.max(calibration.repeats * 2, Math.min(calibration.repeats * 8, projected)));
    }
  }
  const raw = { baseline: [], candidate: [] };
  const elapsed = { baseline: [], candidate: [] };
  const preparation = { baseline: [], candidate: [] };
  const revisionDeltas = { baseline: [], candidate: [] };
  const order = [];
  for (let sample = 0; sample < sampleCount; sample++) {
    const variants = sample & 1 ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
    order.push(variants.join('→'));
    for (const variant of variants) {
      const mod = variant === 'baseline' ? baseline : candidate;
      const revisionsBefore = counters(mod);
      const context = prepareCase(mod, definition);
      preparation[variant].push(context?.benchmarkMetadata ?? context ?? null);
      warmCase(mod, definition, context);
      const sampleElapsed = elapsedFor(mod, definition, context, calibration.repeats);
      elapsed[variant].push(sampleElapsed);
      raw[variant].push(sampleElapsed / calibration.repeats);
      const revisionsAfter = counters(mod);
      revisionDeltas[variant].push({
        transform: (revisionsAfter.transformVersion - revisionsBefore.transformVersion) >>> 0,
        color: (revisionsAfter.colorVersion - revisionsBefore.colorVersion) >>> 0,
      });
    }
    for (let frame = 0; frame < (definition.evolveAfter ?? 0); frame++) {
      baseline._b3w_step(1 / 60, 4);
      candidate._b3w_step(1 / 60, 4);
    }
    assertExactWorld(baseline, candidate, `${definition.id} sample ${sample}`, false);
    assert.deepEqual(revisionDeltas.candidate[sample], revisionDeltas.baseline[sample], `${definition.id} sample ${sample}: revision deltas differ`);
  }
  const baselineStats = stats(raw.baseline);
  const candidateStats = stats(raw.candidate);
  const speedup = baselineStats.medianMsPerOperation / candidateStats.medianMsPerOperation;
  const interval = balancedBootstrap(raw.baseline, raw.candidate, bootstrapIterations);
  const floor = {
    baselineMedianBatchMs: median(elapsed.baseline),
    candidateMedianBatchMs: median(elapsed.candidate),
    minimumMs: definition.fixedRepeats ? 0.5 : calibrationTargetMs * 0.5,
  };
  floor.passed = Math.min(floor.baselineMedianBatchMs, floor.candidateMedianBatchMs) >= floor.minimumMs;
  return {
    id: definition.id,
    label: definition.label,
    scope: definition.scope,
    calibration,
    repeatsPerSample: calibration.repeats,
    samplesPerVariant: sampleCount,
    balancedOrder: { AB: sampleCount / 2, BA: sampleCount / 2, raw: order },
    preparation,
    revisionDeltas,
    baseline: { ...baselineStats, rawElapsedMsPerSample: elapsed.baseline },
    candidate: { ...candidateStats, rawElapsedMsPerSample: elapsed.candidate },
    speedup,
    pairedBootstrap95: interval,
    timerFloor: floor,
    classification: classify(speedup, interval, floor.passed, distinctCandidate),
    exactAfterEverySample: true,
  };
}

const prepareScene = (scenario) => (mod) => {
  const initial = createScene(mod, scenario);
  return { benchmarkMetadata: initial };
};
const preparePartial = (scenario, ratio) => (mod) => {
  const prepared = prepareAwakeRatio(mod, scenario, ratio);
  return { ...prepared, benchmarkMetadata: prepared };
};

const definitions = [
  {
    id: 'explode-definite-miss-static-heavy', label: 'Definite-miss explosion, static-heavy', scope: 'action',
    prepare: prepareScene(scenarios.staticHeavy), operation: (mod) => mod._b3w_explode(10000, 10000, 10000, 24, 3),
  },
  {
    id: 'explode-definite-miss-dense', label: 'Definite-miss explosion, dense dynamic', scope: 'action',
    prepare: prepareScene(scenarios.dense), operation: (mod) => mod._b3w_explode(10000, 10000, 10000, 24, 3),
  },
  {
    id: 'explode-mixed-static-heavy', label: 'Mixed hit/miss explosion, static-heavy', scope: 'action',
    prepare: prepareScene(scenarios.staticHeavy), operation: (mod) => mod._b3w_explode(0, 3, 0, 0, 9), evolveAfter: 2,
  },
  {
    id: 'explode-mixed-dense', label: 'Mixed hit/miss explosion, dense dynamic', scope: 'action',
    prepare: prepareScene(scenarios.dense), operation: (mod) => mod._b3w_explode(0, 3, 0, 0, 18), evolveAfter: 2,
  },
  {
    id: 'explode-boundary', label: 'Exact-radius boundary explosion', scope: 'action',
    prepare: (mod) => {
      const initial = createScene(mod, scenarios.smallSleep);
      const [x, y, z] = matrixPosition(mod, 1);
      return { center: [x + 3, y, z], benchmarkMetadata: initial };
    },
    operation: (mod, context) => mod._b3w_explode(context.center[0], context.center[1], context.center[2], 0, 3),
  },
  {
    id: 'kick-static-heavy', label: 'Kick action, static-heavy', scope: 'action',
    prepare: prepareScene(scenarios.staticHeavy), operation: (mod) => mod._b3w_kick_stack(8), maxRepeats: 65536, evolveAfter: 2,
  },
  {
    id: 'kick-dense', label: 'Kick action, dense dynamic', scope: 'action',
    prepare: prepareScene(scenarios.dense), operation: (mod) => mod._b3w_kick_stack(8), maxRepeats: 512, evolveAfter: 2,
  },
  {
    id: 'construct-repeated-hull-dense', label: 'Repeated-size dense scene reconstruction', scope: 'construction-reset',
    prepare: prepareScene(scenarios.dense), warmups: 1, maxRepeats: 32,
    operation: (mod) => mod._b3w_create_scene(scenarios.dense.sceneId, scenarios.dense.stress, scenarios.dense.seed), evolveAfter: 2,
  },
  {
    id: 'construct-varied-static-heavy', label: 'Varied static-heavy scene reconstruction', scope: 'construction-reset',
    prepare: prepareScene(scenarios.staticHeavy), warmups: 1, maxRepeats: 512,
    operation: (mod) => mod._b3w_create_scene(scenarios.staticHeavy.sceneId, scenarios.staticHeavy.stress, scenarios.staticHeavy.seed), evolveAfter: 2,
  },
  {
    id: 'reset-large-small-churn', label: 'Large-to-small scene reset churn', scope: 'construction-reset',
    prepare: prepareScene(scenarios.smallSleep), warmups: 1, maxRepeats: 16,
    operation: (mod) => {
      mod._b3w_create_scene(scenarios.dense.sceneId, scenarios.dense.stress, scenarios.dense.seed);
      mod._b3w_create_scene(scenarios.smallSleep.sceneId, scenarios.smallSleep.stress, scenarios.smallSleep.seed);
    }, evolveAfter: 2,
  },
  {
    id: 'destroy-small-recreate', label: 'Destroy and small-scene recreate', scope: 'construction-reset',
    prepare: prepareScene(scenarios.smallSleep), warmups: 1, maxRepeats: 4096,
    operation: (mod) => {
      mod._b3w_destroy();
      mod._b3w_create_scene(scenarios.smallSleep.sceneId, scenarios.smallSleep.stress, scenarios.smallSleep.seed);
    }, evolveAfter: 2,
  },
  {
    id: 'sync-static-heavy-active', label: 'Explicit transform sync, static-heavy active', scope: 'transform-sync',
    prepare: prepareScene(scenarios.staticHeavy), operation: (mod) => mod._b3w_sync_transforms(),
  },
  {
    id: 'sync-static-heavy-partial-sleep', label: 'Explicit transform sync, static-heavy partially sleeping', scope: 'transform-sync',
    prepare: preparePartial(scenarios.staticHeavy, 0.25), operation: (mod) => mod._b3w_sync_transforms(),
  },
  {
    id: 'sync-dense-active', label: 'Explicit transform sync, dense active', scope: 'transform-sync',
    prepare: prepareScene(scenarios.dense), operation: (mod) => mod._b3w_sync_transforms(),
  },
  {
    id: 'step-static-heavy-partial-sleep', label: 'Whole step, static-heavy partially sleeping', scope: 'step-plus-sync',
    prepare: preparePartial(scenarios.staticHeavy, 0.25), warmups: 0, fixedRepeats: 64,
    operation: (mod) => mod._b3w_step(1 / 60, 4),
  },
  {
    id: 'step-dense-partial-sleep', label: 'Whole step, dense partially sleeping', scope: 'step-plus-sync',
    prepare: preparePartial(scenarios.denseSleep, 0.10), warmups: 0, fixedRepeats: 8,
    operation: (mod) => mod._b3w_step(1 / 60, 4),
  },
];

const bodyEventApi = {
  call: 'b3World_GetBodyEvents(b3WorldId) immediately after b3World_Step',
  events: ['b3BodyEvents.moveEvents', 'b3BodyEvents.moveCount'],
  moveEventFields: [
    'b3BodyMoveEvent.userData',
    'b3BodyMoveEvent.transform.p',
    'b3BodyMoveEvent.transform.q',
    'b3BodyMoveEvent.bodyId',
    'b3BodyMoveEvent.fellAsleep',
  ],
  mapping: 'Set b3BodyDef.userData=(void*)(uintptr_t)(streamIndex+1), then decode event.userData back to streamIndex.',
  terminalPose: 'Always write events with fellAsleep=true; that event contains the final sleeping transform.',
  lifetime: 'The buffered event array is consumed before another step or body destruction; Box3D documents invalidation when bodies are destroyed.',
  hybridBoundary: 'Use moved-only events only immediately after a step and below a measured moveCount/dynamicCount crossover. Keep exported explicit b3w_sync_transforms on the full safe path because its most recent event array may be stale.',
};

const extracted = extractBaseline();
let baseline;
let candidate;
try {
  const baselineIdentity = artifactIdentity(extracted.artifactDir, extracted.bridgePath, true);
  const candidateIdentity = artifactIdentity(candidateDir, candidateBridge, false);
  const distinctCandidate = baselineIdentity.files['box3d.wasm'].sha256 !== candidateIdentity.files['box3d.wasm'].sha256;
  [baseline, candidate] = await Promise.all([
    loadModule(baselineIdentity, 'baseline'),
    loadModule(candidateIdentity, 'candidate'),
  ]);

  const correctness = runCorrectness(baseline, candidate);
  const cases = definitions.map((definition) => benchmarkCase(baseline, candidate, definition, distinctCandidate));
  const identitiesAtEnd = {
    archive: sha256File(baselineArchive),
    candidateJs: sha256File(path.join(candidateDir, 'box3d.js')),
    candidateWasm: sha256File(path.join(candidateDir, 'box3d.wasm')),
    candidateBridge: sha256File(candidateBridge),
    candidateProvenance: sha256File(path.join(candidateDir, 'BUILD_PROVENANCE.json')),
  };
  const identity = {
    archiveSha256: sha256File(baselineArchive),
    sameJs: baselineIdentity.files['box3d.js'].sha256 === candidateIdentity.files['box3d.js'].sha256,
    sameWasm: baselineIdentity.files['box3d.wasm'].sha256 === candidateIdentity.files['box3d.wasm'].sha256,
    distinctCandidate,
    candidateBridgeMatchesArtifactProvenance: candidateIdentity.bridge.matchesArtifactProvenance,
    candidateUnchangedDuringRun:
      identitiesAtEnd.candidateJs === candidateIdentity.files['box3d.js'].sha256 &&
      identitiesAtEnd.candidateWasm === candidateIdentity.files['box3d.wasm'].sha256 &&
      identitiesAtEnd.candidateBridge === candidateIdentity.bridge.sha256 &&
      identitiesAtEnd.candidateProvenance === candidateIdentity.provenanceFileSha256,
  };
  const gates = {
    frozenArchiveExact: identity.archiveSha256 === expected.archive,
    frozenArtifactsExact: baselineIdentity.files['box3d.js'].sha256 === expected.js && baselineIdentity.files['box3d.wasm'].sha256 === expected.wasm,
    artifactInternalProvenance: candidateIdentity.files['box3d.js'].sha256 === candidateIdentity.provenance.artifacts['box3d.js'].sha256 && candidateIdentity.files['box3d.wasm'].sha256 === candidateIdentity.provenance.artifacts['box3d.wasm'].sha256,
    exactExplosion: correctness.some((entry) => entry.family === 'explosion' && entry.exact),
    exactKick: correctness.some((entry) => entry.family === 'kick' && entry.exact),
    exactConstructionReset: correctness.some((entry) => entry.family === 'construction-reset' && entry.exact),
    exactPartialSleep: correctness.some((entry) => entry.family === 'partial-sleep-transform-sync' && entry.exact),
    exactAfterEveryTimedSample: cases.every((entry) => entry.exactAfterEverySample),
    balancedTimings: cases.every((entry) => entry.balancedOrder.AB === entry.balancedOrder.BA),
    artifactsUnchangedDuringRun: identity.candidateUnchangedDuringRun && identitiesAtEnd.archive === expected.archive,
  };
  const claimability = {
    distinctCandidate,
    candidateBridgeMatchesArtifactProvenance: candidateIdentity.bridge.matchesArtifactProvenance,
    batchesAboveTimerFloor: cases.every((entry) => entry.timerFloor.passed),
  };
  const result = {
    schemaVersion: 1,
    title: 'Frozen v1.12 versus current native focused rigid benchmark',
    generatedAt: new Date().toISOString(),
    platform: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model ?? 'unknown' },
    artifacts: { baseline: baselineIdentity, candidate: candidateIdentity, identity, identitiesAtEnd },
    methodology: {
      samplesPerVariantPerCase: sampleCount,
      balancedOrder: `${sampleCount / 2} AB and ${sampleCount / 2} BA`,
      bootstrapIterations,
      calibrationTargetMs,
      timing: 'raw elapsed samples and normalized milliseconds per operation; setup/preparation and post-timing exactness checks are excluded',
      exactness: 'body/dynamic/awake/max counters, transform/color revisions, all active matrix/color bits, replay hashes, and post-action evolution',
      acceptance: 'no win can be claimed unless candidate WASM is distinct, bridge provenance matches, timer-floor gates pass, and the 95% lower bound exceeds 1.03x',
    },
    bodyEventApi,
    correctness,
    cases,
    summary: {
      cases: cases.length,
      identityControls: cases.filter((entry) => entry.classification.startsWith('identity control')).length,
      acceptedWins: cases.filter((entry) => entry.classification === 'accepted measured win').length,
      regressions: cases.filter((entry) => entry.classification === 'measured material regression').length,
    },
    gates,
    claimability,
    passed: Object.values(gates).every(Boolean),
    benchmarkClaimable: Object.values(claimability).every(Boolean),
    scopeBoundary: 'Node/WASM bridge and solver timing only; not browser FPS or physical-GPU timing.',
  };

  fs.mkdirSync(resultDir, { recursive: true });
  const jsonPath = path.join(resultDir, 'v113-native-focused.json');
  const markdownPath = path.join(resultDir, 'v113-native-focused.md');
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  const rows = cases.map((entry) => `| ${entry.label} | ${entry.speedup.toFixed(3)}× | ${entry.pairedBootstrap95.low95.toFixed(3)}–${entry.pairedBootstrap95.high95.toFixed(3)}× | ${entry.classification} |`).join('\n');
  fs.writeFileSync(markdownPath, `# Native focused rigid benchmark\n\n` +
    `Frozen v1.12 WASM: \`${baselineIdentity.files['box3d.wasm'].sha256}\`\n\n` +
    `Candidate WASM: \`${candidateIdentity.files['box3d.wasm'].sha256}\`\n\n` +
    `Candidate bridge matches artifact provenance: **${candidateIdentity.bridge.matchesArtifactProvenance}**\n\n` +
    `Benchmark claimable: **${result.benchmarkClaimable}**\n\n` +
    `| Case | Median speedup | Balanced-bootstrap 95% interval | Classification |\n|---|---:|---:|---|\n${rows}\n\n` +
    `All active matrix/color bits, counters, revisions, and replay hashes matched after every timed sample. Raw samples are retained in the JSON evidence.\n`);
  console.log(JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
} finally {
  baseline?._b3w_destroy();
  candidate?._b3w_destroy();
  fs.rmSync(extracted.temporaryRoot, { recursive: true, force: true });
}
