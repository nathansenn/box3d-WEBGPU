'use strict';

/*
 * Deterministic material-fracture correctness and current-performance baseline.
 *
 * This is deliberately not a cross-version speed tournament. It records the
 * current implementation across the exact cartesian matrix:
 *
 *   10 material presets x 5 modes x 2 stress levels = 100 cases
 *
 * Compile the test tree first, then run this script. Set
 * MATERIAL_FRACTURE_OUTPUT to retain the complete JSON evidence on disk.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');

const root = path.resolve(__dirname, '..');
const compiledRoot = path.join(root, '.test-build');
const simulationsPath = path.join(compiledRoot, 'src/soft/simulations.js');
if (!fs.existsSync(simulationsPath)) {
  throw new Error('missing .test-build; compile with `tsc -p tsconfig.test.json` before running material-fracture-100.cjs');
}

const { SCENES } = require(path.join(compiledRoot, 'src/scenes.js'));
const { SoftSimulationSuite } = require(simulationsPath);
const { MATERIAL_BEHAVIOR_PRESETS } = require(path.join(compiledRoot, 'src/soft/material-presets.js'));

const frameCount = Math.max(60, Number.parseInt(process.env.MATERIAL_FRACTURE_FRAMES || '180', 10));
const sampleCount = Math.max(2, Number.parseInt(process.env.MATERIAL_FRACTURE_SAMPLES || '3', 10));
const outputPath = process.env.MATERIAL_FRACTURE_OUTPUT
  ? path.resolve(process.env.MATERIAL_FRACTURE_OUTPUT)
  : null;
const stressLevels = [2, 5];
const phaseRank = { elastic: 0, yielding: 1, fracturing: 2, failed: 3 };

function finiteArray(values, length = values.length) {
  for (let index = 0; index < length; index++) if (!Number.isFinite(values[index])) return false;
  return true;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function quantile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - (position - lower)) + sorted[upper] * (position - lower);
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
  }
  return value;
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stableValue(value))).digest('hex');
}

function validatePresetOrder() {
  const expected = [
    'structural-steel', 'aluminum-alloy', 'copper', 'oak-timber', 'cross-laminated-timber',
    'reinforced-concrete', 'soda-lime-glass', 'acrylic', 'elastomer', 'carbon-fiber',
  ];
  assert.equal(MATERIAL_BEHAVIOR_PRESETS.length, 10);
  assert.deepEqual(MATERIAL_BEHAVIOR_PRESETS.map((preset) => preset.id), expected);
  for (const preset of MATERIAL_BEHAVIOR_PRESETS) {
    assert.ok(Number.isFinite(preset.densityScale) && preset.densityScale > 0);
    for (const value of [preset.axialStiffness, preset.shearStiffness, preset.bendStiffness, preset.damping, preset.anisotropy]) {
      assert.ok(Number.isFinite(value) && value > 0 && value <= 1, `${preset.id}: normalized coefficient outside (0, 1]`);
    }
    assert.ok(preset.tensileYieldStrain > 0 && preset.tensileBreakStrain > preset.tensileYieldStrain);
    assert.ok(preset.compressionYieldStrain > 0 && preset.compressionBreakStrain > preset.compressionYieldStrain);
    assert.ok(preset.plasticCreep >= 0 && preset.damageRate > 0 && preset.fatigueRate >= 0);
    assert.ok(finiteArray(preset.baseColor));
  }
  return expected;
}

function at(frame, fraction) {
  return frame === Math.min(frameCount - 1, Math.max(0, Math.round((frameCount - 1) * fraction)));
}

function applySchedule(suite, mode, frame) {
  if (mode === 0) {
    if (at(frame, 0)) suite.setLoadTarget(0.42);
    if (at(frame, 0.22)) suite.setLoadTarget(0.96);
    if (at(frame, 0.48)) suite.setLoadTarget(1.38);
    if (at(frame, 0.68)) suite.setLoadTarget(2);
    if (at(frame, 0.90)) suite.releaseLoad();
  } else if (mode === 1) {
    if (at(frame, 0)) { suite.setLoadTarget(1.35); suite.cycleLoad(); }
    if (at(frame, 0.45)) suite.kick(15);
    if (at(frame, 0.88)) suite.releaseLoad();
  } else if (mode === 2) {
    if (at(frame, 0)) suite.setLoadTarget(0.25);
    if (at(frame, 0.20)) suite.setLoadTarget(0.55);
    if (at(frame, 0.40)) suite.setLoadTarget(0.85);
    if (at(frame, 0.60)) suite.setLoadTarget(1.15);
    if (at(frame, 0.78)) suite.setLoadTarget(1.55);
    if (at(frame, 0.92)) suite.releaseLoad();
  } else if (mode === 3) {
    if (at(frame, 0)) suite.setLoadTarget(0.55);
    if (at(frame, 0.24)) assert.ok(suite.launchProjectile([-16, 9, 0], [35, -1, 0], 0.9) >= 0);
    if (at(frame, 0.48)) suite.explode([0, 6, 0], 32, 12);
    if (at(frame, 0.64)) assert.ok(suite.spawnRain(24, 9, 17) > 0);
    if (at(frame, 0.72)) suite.setLoadTarget(2);
    if (at(frame, 0.92)) suite.releaseLoad();
  } else {
    if (at(frame, 0)) suite.setLoadTarget(0.42);
    if (at(frame, 0.18)) suite.setLoadTarget(0.96);
    if (at(frame, 0.36)) suite.setLoadTarget(1.38);
    if (at(frame, 0.50)) suite.kick(18);
    if (at(frame, 0.62)) suite.setLoadTarget(2);
    if (at(frame, 0.72)) assert.ok(suite.launchProjectile([-16, 9, 0], [36, -1, 0], 0.9) >= 0);
    if (at(frame, 0.82)) suite.explode([0, 6, 0], 34, 13);
    if (at(frame, 0.94)) suite.releaseLoad();
  }
}

function inspectFrame(frame, expectedLabel, trackers, history, frameIndex) {
  assert.equal(frame.kind, 'fracture');
  assert.ok(frame.material, 'material telemetry is missing');
  assert.equal(frame.material.label, expectedLabel);
  assert.ok(frame.ropeGrid && frame.ropeGrid.presentation === 'material');
  assert.ok(frame.nodeCount > 0 && frame.constraintCount > 0);
  assert.ok(frame.instanceCount >= 0);
  assert.ok(Number.isFinite(frame.energy) && frame.energy >= 0);
  assert.ok(Number.isInteger(frame.hash) && frame.hash !== 0);
  assert.ok(finiteArray(frame.matrices, frame.instanceCount * 16));
  assert.ok(finiteArray(frame.colors, frame.instanceCount * 4));
  assert.ok(finiteArray(frame.ropeGrid.positions, frame.ropeGrid.nodeCount * 3));
  assert.ok(finiteArray(frame.ropeGrid.segments, frame.ropeGrid.segmentCount * 8));
  assert.ok(frame.material.yieldStrain > 0 && frame.material.breakStrain > frame.material.yieldStrain);
  assert.ok(Number.isFinite(frame.material.loadTarget) && Number.isFinite(frame.material.loadProgress));
  assert.ok(Number.isFinite(frame.material.maxStrain) && frame.material.maxStrain >= 0);
  assert.ok(Number.isFinite(frame.material.peakDamage) && frame.material.peakDamage >= 0 && frame.material.peakDamage <= 1);
  assert.ok(frame.material.yieldedCount >= trackers.yielded, 'yielded count regressed');
  assert.ok(frame.material.damagedCount >= trackers.damaged, 'damaged count regressed');
  assert.ok(frame.brokenCount >= trackers.broken, 'broken count regressed');
  assert.ok(frame.material.peakDamage + 1e-8 >= trackers.peakDamage, 'peak damage regressed');
  assert.ok(frame.material.maxStrain + 1e-8 >= trackers.maxStrain, 'maximum strain regressed');
  assert.ok(phaseRank[frame.material.failurePhase] >= trackers.phase, 'failure phase regressed');

  if (trackers.firstYieldFrame === null && frame.material.yieldedCount > 0) trackers.firstYieldFrame = frameIndex;
  if (trackers.firstDamageFrame === null && frame.material.damagedCount > 0) trackers.firstDamageFrame = frameIndex;
  if (trackers.firstBreakFrame === null && frame.brokenCount > 0) trackers.firstBreakFrame = frameIndex;
  trackers.yielded = frame.material.yieldedCount;
  trackers.damaged = frame.material.damagedCount;
  trackers.broken = frame.brokenCount;
  trackers.peakDamage = frame.material.peakDamage;
  trackers.maxStrain = frame.material.maxStrain;
  trackers.phase = phaseRank[frame.material.failurePhase];

  history.update(`${frameIndex}:${frame.hash}:${frame.brokenCount}:${frame.material.yieldedCount}:` +
    `${frame.material.damagedCount}:${frame.material.peakDamage.toPrecision(9)}:` +
    `${frame.material.maxStrain.toPrecision(9)}:${frame.ropeGrid.segmentCount};`);
}

function runSample(definition) {
  const suite = new SoftSimulationSuite();
  assert.ok(suite.createScene(definition.scene, definition.stress, definition.seed));
  const trackers = {
    yielded: 0, damaged: 0, broken: 0, peakDamage: 0, maxStrain: 0, phase: 0,
    firstYieldFrame: null, firstDamageFrame: null, firstBreakFrame: null,
  };
  const history = crypto.createHash('sha256');
  let stepMs = 0;
  let frameBuildMs = 0;

  for (let frameIndex = 0; frameIndex < frameCount; frameIndex++) {
    applySchedule(suite, definition.mode, frameIndex);
    const stepStarted = performance.now();
    suite.step(1 / 60, 4);
    stepMs += performance.now() - stepStarted;
    const buildStarted = performance.now();
    const frame = suite.buildFrame(false);
    frameBuildMs += performance.now() - buildStarted;
    inspectFrame(frame, definition.preset.label, trackers, history, frameIndex);
  }

  const frame = suite.buildFrame(false);
  const validation = suite.validate();
  assert.ok(validation.ok, validation.message);
  const result = {
    stepMs,
    frameBuildMs,
    totalMs: stepMs + frameBuildMs,
    msPerFrame: (stepMs + frameBuildMs) / frameCount,
    finalHash: suite.hash() >>> 0,
    finalBrokenCount: frame.brokenCount,
    finalYieldedCount: frame.material.yieldedCount,
    finalDamagedCount: frame.material.damagedCount,
    peakDamage: frame.material.peakDamage,
    maxStrain: frame.material.maxStrain,
    firstYieldFrame: trackers.firstYieldFrame,
    firstDamageFrame: trackers.firstDamageFrame,
    firstBreakFrame: trackers.firstBreakFrame,
    trajectorySha256: history.digest('hex'),
  };
  suite.destroy();
  return result;
}

function summarizeSamples(samples) {
  const times = samples.map((sample) => sample.msPerFrame);
  const reference = samples[0];
  for (const sample of samples.slice(1)) {
    assert.equal(sample.trajectorySha256, reference.trajectorySha256, 'trajectory digest is nondeterministic');
    assert.equal(sample.finalHash, reference.finalHash, 'final replay hash is nondeterministic');
    assert.equal(sample.finalBrokenCount, reference.finalBrokenCount, 'final break count is nondeterministic');
    assert.equal(sample.firstYieldFrame, reference.firstYieldFrame, 'yield point is nondeterministic');
    assert.equal(sample.firstDamageFrame, reference.firstDamageFrame, 'damage point is nondeterministic');
    assert.equal(sample.firstBreakFrame, reference.firstBreakFrame, 'break point is nondeterministic');
  }
  return {
    medianMsPerFrame: median(times),
    minimumMsPerFrame: Math.min(...times),
    maximumMsPerFrame: Math.max(...times),
    samples,
  };
}

const presetOrder = validatePresetOrder();
const registry = [];
let id = 1;
for (let mode = 0; mode < 5; mode++) {
  for (let variant = 0; variant < 10; variant++) {
    for (const stress of stressLevels) {
      const sceneId = 750 + mode * 10 + variant;
      const preset = MATERIAL_BEHAVIOR_PRESETS[variant];
      registry.push({
        id: id++,
        key: `${preset.id}|mode-${mode}|stress-${stress}`,
        sceneId,
        scene: SCENES[sceneId],
        preset,
        mode,
        stress,
        seed: (0xf4ac0000 ^ Math.imul(sceneId + 1, 0x9e3779b1) ^ Math.imul(stress, 0x85ebca6b)) >>> 0,
      });
    }
  }
}
assert.equal(registry.length, 100);
assert.equal(new Set(registry.map((entry) => entry.key)).size, 100);
// The catalog's numeric variant is the stable mapping to the ordered preset.
assert.ok(registry.every((entry) => entry.scene?.family === 'fracture' && entry.scene.variant === MATERIAL_BEHAVIOR_PRESETS.indexOf(entry.preset)));

const cases = [];
for (const definition of registry) {
  const samples = [];
  for (let sample = 0; sample < sampleCount; sample++) samples.push(runSample(definition));
  const timing = summarizeSamples(samples);
  const reference = samples[0];
  if (reference.firstBreakFrame !== null) {
    assert.ok(reference.firstYieldFrame !== null && reference.firstYieldFrame <= reference.firstBreakFrame,
      'fracture was reported before its constraint entered the yielded state');
    assert.ok(reference.firstDamageFrame !== null && reference.firstDamageFrame <= reference.firstBreakFrame,
      'fracture was reported before damage was visible in telemetry');
  }
  cases.push({
    id: definition.id,
    semanticKey: definition.key,
    sceneId: definition.sceneId,
    materialId: definition.preset.id,
    materialLabel: definition.preset.label,
    mode: definition.mode,
    stress: definition.stress,
    seed: definition.seed,
    deterministic: true,
    finite: true,
    monotonic: true,
    firstYieldFrame: reference.firstYieldFrame,
    firstDamageFrame: reference.firstDamageFrame,
    firstBreakFrame: reference.firstBreakFrame,
    finalBrokenCount: reference.finalBrokenCount,
    finalYieldedCount: reference.finalYieldedCount,
    finalDamagedCount: reference.finalDamagedCount,
    peakDamage: reference.peakDamage,
    maxStrain: reference.maxStrain,
    trajectorySha256: reference.trajectorySha256,
    timing,
  });
  process.stderr.write(`material case ${String(definition.id).padStart(3, '0')}/100 ${definition.key} ${timing.medianMsPerFrame.toFixed(4)} ms/frame\n`);
}

const medians = cases.map((entry) => entry.timing.medianMsPerFrame);
const payload = {
  schemaVersion: 1,
  campaign: 'webphysics-material-fracture-current-baseline-100',
  generatedAt: new Date().toISOString(),
  comparison: 'none; current-source correctness and performance baseline only',
  methodology: {
    exactCases: 100,
    materialPresets: 10,
    modes: 5,
    stressLevels,
    framesPerSample: frameCount,
    samplesPerCase: sampleCount,
    fixedStepSeconds: 1 / 60,
    substeps: 4,
    timedScope: 'material solver step plus cached frame construction; validation and trajectory hashing excluded',
    presetOrder,
  },
  summary: {
    cases: cases.length,
    finiteCases: cases.filter((entry) => entry.finite).length,
    deterministicCases: cases.filter((entry) => entry.deterministic).length,
    monotonicCases: cases.filter((entry) => entry.monotonic).length,
    casesReachingYield: cases.filter((entry) => entry.firstYieldFrame !== null).length,
    casesAccumulatingDamage: cases.filter((entry) => entry.firstDamageFrame !== null).length,
    casesBreaking: cases.filter((entry) => entry.firstBreakFrame !== null).length,
    medianCaseMsPerFrame: median(medians),
    p95CaseMsPerFrame: quantile(medians, 0.95),
    minimumCaseMsPerFrame: Math.min(...medians),
    maximumCaseMsPerFrame: Math.max(...medians),
  },
  registrySha256: sha256(registry.map(({ scene, preset, ...entry }) => ({ ...entry, materialId: preset.id, sceneFamily: scene.family }))),
  cases,
};

assert.equal(payload.summary.finiteCases, 100);
assert.equal(payload.summary.deterministicCases, 100);
assert.equal(payload.summary.monotonicCases, 100);
assert.ok(payload.summary.casesReachingYield > 0, 'no material case reached yield');
assert.ok(payload.summary.casesAccumulatingDamage > 0, 'no material case accumulated damage');
assert.ok(payload.summary.casesBreaking > 0, 'no material case reached fracture');

if (outputPath) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`);
}
process.stdout.write(`${JSON.stringify({
  schemaVersion: payload.schemaVersion,
  campaign: payload.campaign,
  comparison: payload.comparison,
  methodology: payload.methodology,
  summary: payload.summary,
  registrySha256: payload.registrySha256,
  evidenceFile: outputPath,
}, null, 2)}\n`);
