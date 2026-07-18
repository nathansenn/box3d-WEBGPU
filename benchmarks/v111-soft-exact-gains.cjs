'use strict';

/*
 * Exact v1.10-versus-current proof for the soft-simulation optimizations that
 * were missing from the earlier tournaments:
 *
 *   - tearing-only cloth render state is absent from intact GPU cloth;
 *   - per-domain instance streams match their exhaustive action ceilings;
 *   - sphere collision and explosion misses avoid an unnecessary hypot;
 *   - scene construction/retained typed-array costs are measured directly.
 *
 * The script deliberately reuses the long-horizon harness's exact archived
 * baseline and isolated compilation machinery. It never mutates public WASM
 * artifacts or the release build.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const harness = require('./v111-long-horizon-fidelity.cjs');

const {
  root,
  baselineArchive,
  baselineRoot,
  currentBuild,
  currentAssets,
  prepareBaseline,
  prepareCurrent,
  loadProject,
  setupSuite,
  captureSuite,
  sourceFingerprint,
  cleanupTemporaryTree,
} = harness;

const outputJson = path.join(root, 'benchmarks/results/v111-soft-exact-gains.json');
const outputMarkdown = path.join(root, 'benchmarks/results/v111-soft-exact-gains.md');
const samples = Math.max(5, Number.parseInt(process.env.V111_SOFT_GAIN_SAMPLES || '7', 10));
const sphereFrames = Math.max(24, Number.parseInt(process.env.V111_SOFT_GAIN_SPHERE_FRAMES || '36', 10));
const explosionCount = Math.max(16, Number.parseInt(process.env.V111_SOFT_GAIN_EXPLOSIONS || '32', 10));
const sceneIds = Array.from({ length: 150 }, (_, index) => 600 + index);
const clothIds = sceneIds.filter((id) => id < 650);
const ropeIds = sceneIds.filter((id) => id >= 650 && id < 700);
const waterIds = sceneIds.filter((id) => id >= 700);
const sphereIds = clothIds.filter((id) => id % 10 === 3 || id % 10 === 7);

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function mad(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function summarizePair(name, baselineValues, currentValues) {
  const baselineMedianMs = median(baselineValues);
  const currentMedianMs = median(currentValues);
  return {
    name,
    samples: baselineValues.length,
    baselineValuesMs: baselineValues,
    currentValuesMs: currentValues,
    baselineMedianMs,
    currentMedianMs,
    baselineMadMs: mad(baselineValues),
    currentMadMs: mad(currentValues),
    speedup: baselineMedianMs / currentMedianMs,
    retained: baselineMedianMs / currentMedianMs >= 1.02,
  };
}

function measurePair(name, baselineFn, currentFn) {
  // Separate untimed warm-ups establish both JIT paths before alternation.
  baselineFn();
  currentFn();
  const baselineValues = [];
  const currentValues = [];
  for (let sample = 0; sample < samples; sample++) {
    if (sample % 2 === 0) {
      baselineValues.push(baselineFn());
      currentValues.push(currentFn());
    } else {
      currentValues.push(currentFn());
      baselineValues.push(baselineFn());
    }
  }
  return summarizePair(name, baselineValues, currentValues);
}

function timeConstructors(project) {
  const suite = project.createSuite();
  const start = performance.now();
  for (const sceneId of sceneIds) {
    assert.ok(suite.createScene(project.SCENES[sceneId], 5, (0x5c1100 + sceneId) >>> 0));
  }
  const elapsed = performance.now() - start;
  suite.destroy();
  return elapsed;
}

function timeSphereCollisions(project) {
  const suites = sphereIds.map((sceneId) => setupSuite(project, sceneId, (0x5c2200 + sceneId) >>> 0));
  const start = performance.now();
  for (let frame = 0; frame < sphereFrames; frame++) {
    for (const suite of suites) suite.step(1 / 60, 4);
  }
  const elapsed = performance.now() - start;
  for (const suite of suites) suite.destroy();
  return elapsed;
}

function applyExplosionSequence(suite) {
  for (let index = 0; index < explosionCount; index++) {
    if (index % 4 === 0) {
      suite.explode([0, 7.5, 0], 12, 2.5);
    } else {
      const offset = 90 + index * 3;
      suite.explode([offset, offset * 0.7, -offset], 12, 4);
    }
  }
}

function timeExplosions(project, ids) {
  const suite = project.createSuite();
  let elapsed = 0;
  for (const sceneId of ids) {
    assert.ok(suite.createScene(project.SCENES[sceneId], 5, (0x5c3300 + sceneId) >>> 0));
    const start = performance.now();
    applyExplosionSequence(suite);
    elapsed += performance.now() - start;
  }
  suite.destroy();
  return elapsed;
}

function bufferKeyFactory() {
  const ids = new WeakMap();
  let nextId = 1;
  return (view) => {
    let id = ids.get(view.buffer);
    if (!id) {
      id = nextId++;
      ids.set(view.buffer, id);
    }
    return `${id}:${view.byteOffset}:${view.byteLength}`;
  };
}

function retainedTypedState(active) {
  const keyFor = bufferKeyFactory();
  const ranges = new Map();
  const fields = {};
  const add = (name, value) => {
    if (!ArrayBuffer.isView(value) || value instanceof DataView) return;
    fields[name] = value.byteLength;
    ranges.set(keyFor(value), value.byteLength);
  };
  for (const [name, value] of Object.entries(active)) add(name, value);
  if (active.vertices && active.vertices.data) add('vertices.data', active.vertices.data);
  return {
    bytes: [...ranges.values()].reduce((sum, value) => sum + value, 0),
    fields,
  };
}

function memoryAudit(project) {
  const suite = project.createSuite();
  const records = [];
  for (const sceneId of sceneIds) {
    assert.ok(suite.createScene(project.SCENES[sceneId], 5, (0x5c4400 + sceneId) >>> 0));
    const state = retainedTypedState(suite.active);
    records.push({
      sceneId,
      family: project.SCENES[sceneId].family,
      variant: project.SCENES[sceneId].variant,
      mode: project.SCENES[sceneId].mode,
      tearing: project.SCENES[sceneId].family === 'cloth' && Boolean(suite.active.tearingEnabled),
      bytes: state.bytes,
      fields: state.fields,
    });
  }
  suite.destroy();
  return records;
}

function aggregateMemory(baselineRecords, currentRecords) {
  const groups = [
    ['all', () => true],
    ['cloth-intact', (record) => record.family === 'cloth' && !record.tearing],
    ['cloth-tearing', (record) => record.family === 'cloth' && record.tearing],
    ['rope', (record) => record.family === 'rope'],
    ['water', (record) => record.family === 'water'],
  ];
  return groups.map(([name, predicate]) => {
    const baseline = baselineRecords.filter(predicate);
    const current = currentRecords.filter(predicate);
    assert.equal(current.length, baseline.length);
    const baselineBytes = baseline.reduce((sum, record) => sum + record.bytes, 0);
    const currentBytes = current.reduce((sum, record) => sum + record.bytes, 0);
    return {
      name,
      scenes: baseline.length,
      baselineBytes,
      currentBytes,
      bytesSaved: baselineBytes - currentBytes,
      reduction: 1 - currentBytes / baselineBytes,
      baselineMeanBytes: baselineBytes / Math.max(1, baseline.length),
      currentMeanBytes: currentBytes / Math.max(1, current.length),
    };
  });
}

function fillActionPools(suite, family) {
  let launched = 0;
  if (family === 'water') {
    for (let attempt = 0; attempt < 32; attempt++) {
      if (suite.launchProjectile([-12 + attempt, 8, 0], [8, 0, 0], 0.7) < 0) break;
      launched++;
    }
  } else {
    if (suite.launchProjectile([-18, 8, 0], [32, 0, 0], 0.7) >= 0) launched++;
  }
  const rain = suite.spawnRain(999, 14, 24);
  return { launched, rain };
}

function capAudit(baseline, current) {
  const baselineSuite = baseline.createSuite();
  const currentSuite = current.createSuite();
  const records = [];
  const summary = {
    cloth: { maxInstances: 0, maxProjectiles: 0, maxColliders: 0, maxPayloads: 0, maxFloaters: 0, maxDroplets: 0, scenesAtMax: [] },
    rope: { maxInstances: 0, maxProjectiles: 0, maxColliders: 0, maxPayloads: 0, maxFloaters: 0, maxDroplets: 0, scenesAtMax: [] },
    water: { maxInstances: 0, maxProjectiles: 0, maxColliders: 0, maxPayloads: 0, maxFloaters: 0, maxDroplets: 0, scenesAtMax: [] },
  };
  const expectedBudgets = { cloth: 161, rope: 97, water: 788 };
  for (const sceneId of sceneIds) {
    const baselineScene = baseline.SCENES[sceneId];
    const currentScene = current.SCENES[sceneId];
    assert.equal(currentScene.family, baselineScene.family);
    const seed = (0x5c5500 + sceneId) >>> 0;
    assert.ok(baselineSuite.createScene(baselineScene, 5, seed));
    assert.ok(currentSuite.createScene(currentScene, 5, seed));
    const baselineActions = fillActionPools(baselineSuite, baselineScene.family);
    const currentActions = fillActionPools(currentSuite, currentScene.family);
    assert.deepEqual(currentActions, baselineActions, `action-pool behavior changed in scene ${sceneId}`);
    const baselineFrame = baselineSuite.buildFrame(false);
    const currentFrame = currentSuite.buildFrame(false);
    assert.equal(currentFrame.instanceCount, baselineFrame.instanceCount, `instance count changed in scene ${sceneId}`);
    assert.ok(currentFrame.matrices.length >= currentFrame.instanceCount * 16, `matrix stream clamped scene ${sceneId}`);
    assert.ok(currentFrame.colors.length >= currentFrame.instanceCount * 4, `color stream clamped scene ${sceneId}`);
    assert.equal(currentFrame.matrices.length, expectedBudgets[currentScene.family] * 16, `matrix budget mismatch scene ${sceneId}`);
    assert.equal(currentFrame.colors.length, expectedBudgets[currentScene.family] * 4, `color budget mismatch scene ${sceneId}`);
    const active = currentSuite.active;
    const projectiles = active.projectiles?.length || 0;
    const colliders = active.sphereRadius > 0 ? 1 : 0;
    const payloads = active.payloads?.length || 0;
    const floaters = active.floaters?.length || 0;
    const droplets = active.droplets?.length || 0;
    const familySummary = summary[currentScene.family];
    familySummary.maxProjectiles = Math.max(familySummary.maxProjectiles, projectiles);
    familySummary.maxColliders = Math.max(familySummary.maxColliders, colliders);
    familySummary.maxPayloads = Math.max(familySummary.maxPayloads, payloads);
    familySummary.maxFloaters = Math.max(familySummary.maxFloaters, floaters);
    familySummary.maxDroplets = Math.max(familySummary.maxDroplets, droplets);
    if (currentFrame.instanceCount > familySummary.maxInstances) {
      familySummary.maxInstances = currentFrame.instanceCount;
      familySummary.scenesAtMax = [sceneId];
    } else if (currentFrame.instanceCount === familySummary.maxInstances) {
      familySummary.scenesAtMax.push(sceneId);
    }
    records.push({
      sceneId,
      family: currentScene.family,
      instanceCount: currentFrame.instanceCount,
      matrixCapacity: currentFrame.matrices.length / 16,
      colorCapacity: currentFrame.colors.length / 4,
      projectiles,
      colliders,
      payloads,
      floaters,
      droplets,
      actions: currentActions,
    });
  }
  baselineSuite.destroy();
  currentSuite.destroy();
  assert.equal(summary.cloth.maxInstances, expectedBudgets.cloth, 'cloth cap was not reached exhaustively');
  assert.equal(summary.rope.maxInstances, expectedBudgets.rope, 'rope cap was not reached exhaustively');
  assert.equal(summary.rope.maxPayloads, 1, 'rope recipes exceed the one-payload allowance');
  assert.equal(summary.water.maxInstances, expectedBudgets.water, 'water cap was not reached exhaustively');
  return { expectedBudgets, summary, records };
}

function compareSphereOutputs(baseline, current) {
  const records = [];
  for (const sceneId of sphereIds) {
    const seed = (0x5c6600 + sceneId) >>> 0;
    const baselineSuite = setupSuite(baseline, sceneId, seed);
    const currentSuite = setupSuite(current, sceneId, seed);
    for (let frame = 0; frame < sphereFrames; frame++) {
      baselineSuite.step(1 / 60, 4);
      currentSuite.step(1 / 60, 4);
    }
    const baselineCapture = captureSuite(baselineSuite);
    const currentCapture = captureSuite(currentSuite);
    const exact = baselineCapture.fingerprint === currentCapture.fingerprint;
    assert.ok(exact, `sphere-collision output differs in scene ${sceneId}`);
    records.push({ sceneId, exact, fingerprint: currentCapture.fingerprint });
    baselineSuite.destroy();
    currentSuite.destroy();
  }
  return records;
}

function compareExplosionOutputs(baseline, current, ids) {
  const records = [];
  for (const sceneId of ids) {
    const seed = (0x5c7700 + sceneId) >>> 0;
    const baselineSuite = setupSuite(baseline, sceneId, seed);
    const currentSuite = setupSuite(current, sceneId, seed);
    applyExplosionSequence(baselineSuite);
    applyExplosionSequence(currentSuite);
    const baselineCapture = captureSuite(baselineSuite);
    const currentCapture = captureSuite(currentSuite);
    const exact = baselineCapture.fingerprint === currentCapture.fingerprint;
    assert.ok(exact, `explosion output differs in scene ${sceneId}`);
    records.push({ sceneId, exact, fingerprint: currentCapture.fingerprint });
    baselineSuite.destroy();
    currentSuite.destroy();
  }
  return records;
}

function formatBytes(bytes) {
  if (Math.abs(bytes) >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
  return `${(bytes / 1024).toFixed(2)} KiB`;
}

function makeMarkdown(payload) {
  const lines = [
    '# v1.11 exact soft-simulation gains',
    '',
    `Exact baseline: \`${payload.baseline.archive}\` (SHA-256 \`${payload.baseline.sha256}\`)`,
    '',
    `Source stable during run: **${payload.sourceStableDuringRun ? 'yes' : 'no'}**`,
    '',
    '## Timings',
    '',
    '| Workload | v1.10 median | Current median | Speedup | Decision |',
    '|---|---:|---:|---:|---|',
  ];
  for (const timing of payload.timings) {
    lines.push(`| ${timing.name} | ${timing.baselineMedianMs.toFixed(3)} ms | ${timing.currentMedianMs.toFixed(3)} ms | ${timing.speedup.toFixed(3)}× | ${timing.retained ? 'retain' : 'below 1.02× gate'} |`);
  }
  lines.push('', '## Retained typed-array memory', '', '| Domain | Scenes | v1.10 mean | Current mean | Reduction |', '|---|---:|---:|---:|---:|');
  for (const memory of payload.memory.summary) {
    lines.push(`| ${memory.name} | ${memory.scenes} | ${formatBytes(memory.baselineMeanBytes)} | ${formatBytes(memory.currentMeanBytes)} | ${(memory.reduction * 100).toFixed(2)}% |`);
  }
  lines.push(
    '',
    `Summed across the 150 independently constructed scenes: **${formatBytes(payload.memory.summary[0].bytesSaved)} saved**.`,
    '',
    '## Exhaustive action ceilings',
    '',
    '| Domain | Scenes scanned | Maximum rendered instances | Exact capacity | Component ceiling |',
    '|---|---:|---:|---:|---|',
    `| Cloth | 50 | ${payload.caps.summary.cloth.maxInstances} | ${payload.caps.expectedBudgets.cloth} | ${payload.caps.summary.cloth.maxProjectiles} projectiles + ${payload.caps.summary.cloth.maxColliders} collider |`,
    `| Rope | 50 | ${payload.caps.summary.rope.maxInstances} | ${payload.caps.expectedBudgets.rope} | ${payload.caps.summary.rope.maxProjectiles} projectiles + ${payload.caps.summary.rope.maxPayloads} payload |`,
    `| Water | 50 | ${payload.caps.summary.water.maxInstances} | ${payload.caps.expectedBudgets.water} | ${payload.caps.summary.water.maxDroplets} droplets + ${payload.caps.summary.water.maxFloaters} floaters |`,
    '',
    'All 150 recipes were saturated through the public launch/rain actions. Baseline/current action counts matched, every current stream reached its documented cap without clamping, and all collider/explosion comparison fingerprints were exact.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function main() {
  fs.mkdirSync(path.dirname(outputJson), { recursive: true });
  const sourceFingerprintAtStart = sourceFingerprint();
  prepareBaseline();
  prepareCurrent();
  const baseline = loadProject(path.join(baselineRoot, '.test-build'), baselineRoot, 'v1.10 exact archive');
  const current = loadProject(currentBuild, currentAssets, 'current working tree');

  const baselineMemory = memoryAudit(baseline);
  const currentMemory = memoryAudit(current);
  const memorySummary = aggregateMemory(baselineMemory, currentMemory);
  const caps = capAudit(baseline, current);
  const correctness = {
    sphere: compareSphereOutputs(baseline, current),
    clothExplosions: compareExplosionOutputs(baseline, current, clothIds),
    ropeExplosions: compareExplosionOutputs(baseline, current, ropeIds),
  };

  const timings = [
    measurePair('Construct all 150 soft scenes', () => timeConstructors(baseline), () => timeConstructors(current)),
    measurePair(`Sphere-collider solve (${sphereIds.length} scenes × ${sphereFrames} frames)`, () => timeSphereCollisions(baseline), () => timeSphereCollisions(current)),
    measurePair(`Cloth explosion actions (50 scenes × ${explosionCount})`, () => timeExplosions(baseline, clothIds), () => timeExplosions(current, clothIds)),
    measurePair(`Rope explosion actions (50 scenes × ${explosionCount})`, () => timeExplosions(baseline, ropeIds), () => timeExplosions(current, ropeIds)),
  ];

  const sourceFingerprintAtEnd = sourceFingerprint();
  const sourceStableDuringRun = sourceFingerprintAtStart === sourceFingerprintAtEnd;
  const archiveSha = crypto.createHash('sha256').update(fs.readFileSync(baselineArchive)).digest('hex');
  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: {
      archive: path.relative(root, baselineArchive),
      sha256: archiveSha,
    },
    configuration: { samples, sphereFrames, explosionCount, stress: 5, subSteps: 4 },
    currentSourceFingerprint: sourceFingerprintAtStart,
    currentSourceFingerprintAtEnd: sourceFingerprintAtEnd,
    sourceStableDuringRun,
    timings,
    memory: { summary: memorySummary, baseline: baselineMemory, current: currentMemory },
    caps,
    correctness,
  };
  fs.writeFileSync(outputJson, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(outputMarkdown, makeMarkdown(payload));
  process.stdout.write(`Wrote ${path.relative(root, outputJson)}\n`);
  process.stdout.write(`Wrote ${path.relative(root, outputMarkdown)}\n`);
  for (const timing of timings) {
    process.stdout.write(`${timing.name}: ${timing.speedup.toFixed(3)}x (${timing.baselineMedianMs.toFixed(3)} -> ${timing.currentMedianMs.toFixed(3)} ms)\n`);
  }
  process.stdout.write(`Retained typed-array savings across 150 constructors: ${formatBytes(memorySummary[0].bytesSaved)} (${(memorySummary[0].reduction * 100).toFixed(2)}%)\n`);
  if (!sourceStableDuringRun) throw new Error('candidate source changed during benchmark; discard evidence and rerun');
}

try {
  main();
} finally {
  cleanupTemporaryTree();
}
