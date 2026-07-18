import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const resultDir = path.join(root, 'benchmarks/results');
const jsonPath = path.join(resultDir, 'v113-native-build-flags.json');
const markdownPath = path.join(resultDir, 'v113-native-build-flags.md');
const emsdkEnv = process.env.EMSDK_ENV ?? path.join(os.homedir(), 'emsdk/emsdk_env.sh');
const box3dRoot = path.join(root, 'third_party/box3d');
const sampleCount = Math.max(8, Math.ceil(Number(process.env.B3W_ALLOCATOR_SAMPLES ?? 8) / 2) * 2);
const minimumBatchMs = Math.max(20, Number(process.env.B3W_ALLOCATOR_MIN_BATCH_MS ?? 20));
const calibrationTargetMs = Math.max(minimumBatchMs * 1.35, Number(process.env.B3W_ALLOCATOR_TARGET_MS ?? 28));
const bootstrapIterations = Math.max(2000, Number(process.env.B3W_ALLOCATOR_BOOTSTRAPS ?? 5000));

assert.ok(fs.existsSync(emsdkEnv), `Emscripten environment script missing: ${emsdkEnv}`);
assert.ok(fs.existsSync(path.join(box3dRoot, 'CMakeLists.txt')), `Box3D checkout missing: ${box3dRoot}`);

function sha256File(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function sha256Bytes(view) {
  return crypto.createHash('sha256').update(Buffer.from(view.buffer, view.byteOffset, view.byteLength)).digest('hex');
}

function quote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

function runShell(command, label, options = {}) {
  const run = spawnSync('bash', ['-lc', command], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (run.status !== 0) {
    throw new Error(`${label} failed (${run.status})\n${run.stdout ?? ''}\n${run.stderr ?? ''}`);
  }
  return run;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >>> 1;
  return sorted.length & 1 ? sorted[middle] : 0.5 * (sorted[middle - 1] + sorted[middle]);
}

function geometricMean(values) {
  assert.ok(values.length > 0);
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function stats(values) {
  const med = median(values);
  return {
    rawMsPerTransaction: values,
    medianMsPerTransaction: med,
    madMsPerTransaction: median(values.map((value) => Math.abs(value - med))),
    minimumMsPerTransaction: Math.min(...values),
    maximumMsPerTransaction: Math.max(...values),
  };
}

function deterministicRandom(seed = 0x113a110c) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function balancedBootstrap(defaultValues, emmallocValues, iterations) {
  const random = deterministicRandom();
  const strata = [[], []];
  for (let i = 0; i < defaultValues.length; i++) strata[i & 1].push(i);
  const ratios = new Float64Array(iterations);
  const a = new Array(defaultValues.length);
  const b = new Array(emmallocValues.length);
  for (let iteration = 0; iteration < iterations; iteration++) {
    let cursor = 0;
    for (const stratum of strata) {
      for (let i = 0; i < stratum.length; i++) {
        const source = stratum[Math.floor(random() * stratum.length)];
        a[cursor] = defaultValues[source];
        b[cursor] = emmallocValues[source];
        cursor += 1;
      }
    }
    ratios[iteration] = median(a) / median(b);
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

function buildVariant(tempRoot, allocator) {
  const buildDir = path.join(tempRoot, `build-${allocator}`);
  const outputDir = path.join(tempRoot, `out-${allocator}`);
  const allocatorFlag = allocator === 'emmalloc' ? '-sMALLOC=emmalloc' : '';
  const configureArgs = [
    'emcmake', 'cmake',
    '-S', path.join(root, 'wasm'),
    '-B', buildDir,
    '-DCMAKE_BUILD_TYPE=Release',
    `-DBOX3D_ROOT=${box3dRoot}`,
    `-DBOX3D_OUTPUT_DIR=${outputDir}`,
    '-DBOX3D_DISABLE_SIMD=OFF',
    `-DCMAKE_EXE_LINKER_FLAGS:STRING=${allocatorFlag}`,
  ];
  const environment = `source ${quote(emsdkEnv)} >/dev/null`;
  const configure = `${environment} && ${configureArgs.map(quote).join(' ')}`;
  const build = `${environment} && cmake --build ${quote(buildDir)} --target box3d_web --config Release -j${Math.max(1, os.cpus().length)}`;
  const start = performance.now();
  const configured = runShell(configure, `${allocator} configure`);
  const built = runShell(build, `${allocator} build`);
  const buildElapsedMs = performance.now() - start;
  const jsPath = path.join(outputDir, 'box3d.js');
  const wasmPath = path.join(outputDir, 'box3d.wasm');
  assert.ok(fs.statSync(jsPath).size > 0 && fs.statSync(wasmPath).size > 0, `${allocator} artifacts missing`);
  const linkCandidates = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(target);
      else if (entry.name === 'link.txt') linkCandidates.push(target);
    }
  };
  visit(buildDir);
  const linkFile = linkCandidates.find((file) => fs.readFileSync(file, 'utf8').includes('box3d.js')) ?? null;
  const linkCommand = linkFile ? fs.readFileSync(linkFile, 'utf8').trim() : null;
  if (allocator === 'emmalloc') assert.ok(linkCommand?.includes('-sMALLOC=emmalloc'), 'emmalloc link command does not contain allocator flag');
  if (allocator === 'default') assert.ok(!linkCommand?.includes('-sMALLOC='), 'default link unexpectedly contains allocator override');
  return {
    allocator,
    buildDir,
    outputDir,
    jsPath,
    wasmPath,
    wasmBinary: fs.readFileSync(wasmPath),
    configureArgs,
    allocatorFlag: allocatorFlag || '(Emscripten default)',
    linkCommand,
    buildElapsedMs,
    configureOutputTail: `${configured.stdout}${configured.stderr}`.trim().split('\n').slice(-8),
    buildOutputTail: `${built.stdout}${built.stderr}`.trim().split('\n').slice(-8),
    artifacts: {
      'box3d.js': { bytes: fs.statSync(jsPath).size, sha256: sha256File(jsPath) },
      'box3d.wasm': { bytes: fs.statSync(wasmPath).size, sha256: sha256File(wasmPath) },
      combinedBytes: fs.statSync(jsPath).size + fs.statSync(wasmPath).size,
    },
  };
}

async function instantiate(variant, tag) {
  const imported = await import(`${pathToFileURL(variant.jsPath).href}?allocator-benchmark=${tag}-${Date.now()}-${Math.random()}`);
  const mod = await imported.default({ wasmBinary: variant.wasmBinary });
  for (const symbol of [
    '_b3w_create_scene', '_b3w_destroy', '_b3w_body_count', '_b3w_dynamic_count',
    '_b3w_matrices_ptr', '_b3w_colors_ptr', '_b3w_max_bodies', '_b3w_transform_version',
    '_b3w_color_version', '_b3w_awake_count', '_b3w_sync_transforms', '_b3w_step',
    '_b3w_apply_impulse', '_b3w_kick_stack', '_b3w_explode', '_b3w_launch_projectile',
    '_b3w_spawn_rain', '_b3w_replay_hash',
  ]) assert.equal(typeof mod[symbol], 'function', `${variant.allocator} missing ${symbol}`);
  return mod;
}

function captureWorld(mod, execution) {
  const bodyCount = mod._b3w_body_count();
  const matrixPointer = Number(mod._b3w_matrices_ptr());
  const colorPointer = Number(mod._b3w_colors_ptr());
  const matrices = new Uint32Array(mod.HEAPF32.buffer, matrixPointer, bodyCount * 16).slice();
  const colors = new Uint32Array(mod.HEAPF32.buffer, colorPointer, bodyCount * 4).slice();
  return {
    counters: {
      bodyCount,
      dynamicCount: mod._b3w_dynamic_count(),
      awakeCount: mod._b3w_awake_count(),
      maxBodies: mod._b3w_max_bodies(),
      transformVersion: mod._b3w_transform_version() >>> 0,
      colorVersion: mod._b3w_color_version() >>> 0,
    },
    replayHash: mod._b3w_replay_hash() >>> 0,
    matrixSha256: sha256Bytes(matrices),
    colorSha256: sha256Bytes(colors),
    matrices,
    colors,
    execution,
  };
}

function publicSnapshot(snapshot) {
  return {
    counters: snapshot.counters,
    replayHash: snapshot.replayHash,
    matrixSha256: snapshot.matrixSha256,
    colorSha256: snapshot.colorSha256,
    matrixWords: snapshot.matrices.length,
    colorWords: snapshot.colors.length,
    execution: snapshot.execution,
  };
}

function compareSnapshots(a, b, label) {
  assert.deepEqual(b.counters, a.counters, `${label}: counters/revisions differ`);
  assert.equal(b.replayHash, a.replayHash, `${label}: replay hash differs`);
  assert.deepEqual(b.execution, a.execution, `${label}: action/create results differ`);
  assert.equal(b.matrices.length, a.matrices.length, `${label}: matrix lengths differ`);
  assert.equal(b.colors.length, a.colors.length, `${label}: color lengths differ`);
  for (let i = 0; i < a.matrices.length; i++) assert.equal(b.matrices[i], a.matrices[i], `${label}: matrix word ${i} differs`);
  for (let i = 0; i < a.colors.length; i++) assert.equal(b.colors[i], a.colors[i], `${label}: color word ${i} differs`);
}

function applyAction(mod, definition, ordinal = 0) {
  const scale = definition.actionScale ?? 1;
  switch (definition.action) {
    case 'impulse': {
      const count = mod._b3w_body_count();
      const index = Math.max(1, Math.min(count - 1, 1 + ((definition.sceneId + ordinal * 7) % Math.max(1, count - 1))));
      mod._b3w_apply_impulse(index, (5 + ordinal) * scale, (2 + (ordinal & 3)) * scale, (-2 + (ordinal % 5)) * scale);
      return { type: 'impulse', index };
    }
    case 'kick':
      mod._b3w_kick_stack((4 + (definition.sceneId % 9)) * scale);
      return { type: 'kick' };
    case 'explode-hit':
      mod._b3w_explode((definition.sceneId % 7) - 3, 2 + (definition.stress % 3), ((definition.sceneId >>> 1) % 7) - 3, 8 * scale, 7 + (definition.sceneId % 12));
      return { type: 'explode-hit' };
    case 'explode-miss':
      mod._b3w_explode(5000 + definition.sceneId, 6000, -7000, 12 * scale, 3 + (definition.sceneId % 4));
      return { type: 'explode-miss' };
    case 'projectile': {
      const index = mod._b3w_launch_projectile(-18, 4 + definition.stress, (definition.sceneId % 9) - 4, 18 + definition.stress * 2, 1, 0, 0.4 + (definition.sceneId % 4) * 0.15);
      return { type: 'projectile', index };
    }
    case 'rain': {
      const added = mod._b3w_spawn_rain(8 + (definition.sceneId % 19), 5 + definition.stress, 9 + definition.stress * 2);
      return { type: 'rain', added };
    }
    case 'combo': {
      const results = [];
      results.push(applyAction(mod, { ...definition, action: 'impulse' }, ordinal));
      results.push(applyAction(mod, { ...definition, action: 'explode-hit' }, ordinal));
      results.push(applyAction(mod, { ...definition, action: 'projectile' }, ordinal));
      if ((ordinal & 1) === 0) results.push(applyAction(mod, { ...definition, action: 'rain' }, ordinal));
      return { type: 'combo', results };
    }
    default:
      return { type: 'none' };
  }
}

function executeTransaction(mod, definition, capture) {
  const createReturns = [];
  const actionResults = [];
  const first = mod._b3w_create_scene(definition.sceneId, definition.stress, definition.seed >>> 0);
  createReturns.push(first);
  if (definition.recreateSceneId !== undefined) {
    createReturns.push(mod._b3w_create_scene(definition.recreateSceneId, definition.recreateStress, (definition.seed ^ 0x9e3779b9) >>> 0));
  }
  let settledAfter = null;
  const preSteps = definition.preSteps ?? 0;
  for (let frame = 0; frame < preSteps; frame++) {
    mod._b3w_step(definition.dt ?? 1 / 60, definition.subSteps ?? 4);
    if (definition.stopWhenSettled && mod._b3w_awake_count() === 0) {
      settledAfter = frame + 1;
      break;
    }
  }
  for (let i = 0; i < (definition.actionRepeats ?? (definition.action ? 1 : 0)); i++) {
    actionResults.push(applyAction(mod, definition, i));
    for (let frame = 0; frame < (definition.actionStepGap ?? 0); frame++) mod._b3w_step(definition.dt ?? 1 / 60, definition.subSteps ?? 4);
  }
  for (let frame = 0; frame < (definition.steps ?? 0); frame++) {
    if (definition.midAction && frame === Math.floor((definition.steps ?? 0) / 2)) {
      actionResults.push(applyAction(mod, { ...definition, action: definition.midAction }, actionResults.length));
    }
    mod._b3w_step(definition.dt ?? 1 / 60, definition.subSteps ?? 4);
  }
  for (let i = 0; i < (definition.syncRepeats ?? 0); i++) mod._b3w_sync_transforms();
  const hashes = [];
  for (let i = 0; i < (definition.hashRepeats ?? 0); i++) hashes.push(mod._b3w_replay_hash() >>> 0);
  const execution = { createReturns, actionResults, hashes, settledAfter };
  const snapshot = capture ? captureWorld(mod, execution) : null;
  mod._b3w_destroy();
  return snapshot;
}

function makeDefinitions() {
  const definitions = [];
  const createScenes = [0, 3, 20, 39, 50, 79, 99, 100, 139, 149, 150, 189, 199, 200, 239, 249, 300, 399, 700, 749];
  createScenes.forEach((sceneId, index) => definitions.push({
    id: `create-${String(index).padStart(2, '0')}-scene-${sceneId}`,
    category: 'create', changeClass: 'allocator-sensitive',
    sceneId, stress: 1 + (index % 5), seed: (0x11300000 + sceneId * 31 + index) >>> 0,
    semantic: `create/destroy catalog scene ${sceneId} at stress ${1 + (index % 5)}`,
  }));

  const actionKinds = ['impulse', 'kick', 'explode-hit', 'projectile'];
  for (let index = 0; index < 20; index++) {
    const sceneId = (index * 37 + 13) % 750;
    definitions.push({
      id: `action-${String(index).padStart(2, '0')}-${actionKinds[index % actionKinds.length]}`,
      category: 'action', changeClass: 'allocator-sensitive',
      sceneId, stress: 1 + (index % 5), seed: (0x11310000 + index * 977) >>> 0,
      action: actionKinds[index % actionKinds.length], actionRepeats: 1 + (index % 3), actionStepGap: index % 2,
      steps: 2 + (index % 5), subSteps: 1 << (index % 3),
      semantic: `${actionKinds[index % actionKinds.length]} x${1 + (index % 3)} plus ${2 + (index % 5)} evolution steps`,
    });
  }

  for (let index = 0; index < 20; index++) {
    const sceneId = (index * 29 + 7) % 750;
    definitions.push({
      id: `active-${String(index).padStart(2, '0')}-scene-${sceneId}`,
      category: 'active', changeClass: 'solver-control',
      sceneId, stress: 1 + (index % 5), seed: (0x11320000 + index * 1237) >>> 0,
      steps: 5 + (index % 13), subSteps: [1, 2, 4, 8][index % 4],
      midAction: index % 4 === 0 ? 'impulse' : undefined,
      semantic: `active simulation ${5 + (index % 13)} frames at ${[1, 2, 4, 8][index % 4]} substeps${index % 4 === 0 ? ' with midpoint impulse' : ''}`,
    });
  }

  const settledScenes = [0, 10, 20, 50, 60, 70, 100, 110, 120, 150, 160, 170, 200, 210, 220, 600, 610, 650, 700, 710];
  settledScenes.forEach((sceneId, index) => definitions.push({
    id: `settled-${String(index).padStart(2, '0')}-scene-${sceneId}`,
    category: 'settled', changeClass: 'solver-control',
    sceneId, stress: 1 + (index % 3), seed: (0x11330000 + index * 1597) >>> 0,
    preSteps: 90 + (index % 4) * 30, stopWhenSettled: true,
    steps: 8 + (index % 9), subSteps: [2, 4, 8][index % 3],
    semantic: `settle for up to ${90 + (index % 4) * 30} frames then ${8 + (index % 9)} steady/quiescing steps`,
  }));

  for (let index = 0; index < 19; index++) {
    const sceneId = (index * 41 + 23) % 750;
    definitions.push({
      id: `mixed-${String(index).padStart(2, '0')}-scene-${sceneId}`,
      category: 'mixed-lifecycle', changeClass: 'allocator-sensitive',
      sceneId, stress: 1 + (index % 5), seed: (0x11340000 + index * 2017) >>> 0,
      recreateSceneId: index % 3 === 0 ? (sceneId + 137) % 750 : undefined,
      recreateStress: 1 + ((index + 2) % 5),
      preSteps: index % 5, action: index % 4 === 0 ? 'combo' : ['rain', 'projectile', 'explode-miss'][index % 3],
      actionRepeats: 1 + (index % 2), actionStepGap: index % 3,
      steps: 3 + (index % 8), syncRepeats: index % 4, hashRepeats: 1 + (index % 3),
      semantic: `lifecycle${index % 3 === 0 ? ' with scene replacement' : ''}, action stream, explicit sync/hash, and evolution`,
    });
  }
  assert.equal(definitions.length, 99);
  assert.equal(new Set(definitions.map((entry) => entry.id)).size, 99);
  assert.equal(new Set(definitions.map((entry) => JSON.stringify({ ...entry, id: undefined }))).size, 99, 'semantic definitions are duplicated');
  return definitions;
}

function elapsedTransactions(mod, definition, repeats) {
  const start = performance.now();
  for (let i = 0; i < repeats; i++) executeTransaction(mod, definition, false);
  return performance.now() - start;
}

function calibrate(defaultMod, emmallocMod, definition) {
  let repeats = 1;
  let elapsedDefault = 0;
  let elapsedEmmalloc = 0;
  for (let round = 0; round < 10; round++) {
    elapsedDefault = elapsedTransactions(defaultMod, definition, repeats);
    elapsedEmmalloc = elapsedTransactions(emmallocMod, definition, repeats);
    const minimum = Math.min(elapsedDefault, elapsedEmmalloc);
    if (minimum >= calibrationTargetMs) break;
    const projected = minimum > 0 ? Math.ceil(repeats * calibrationTargetMs / minimum) : repeats * 4;
    repeats = Math.min(1_048_576, Math.max(repeats * 2, Math.min(repeats * 8, projected)));
  }
  return { repeats, pilotDefaultMs: elapsedDefault, pilotEmmallocMs: elapsedEmmalloc, targetMs: calibrationTargetMs };
}

function benchmarkDefinition(defaultMod, emmallocMod, definition) {
  const exactDefault = executeTransaction(defaultMod, definition, true);
  const exactEmmalloc = executeTransaction(emmallocMod, definition, true);
  compareSnapshots(exactDefault, exactEmmalloc, definition.id);
  const calibration = calibrate(defaultMod, emmallocMod, definition);
  let repeats = calibration.repeats;
  let measured;
  for (let attempt = 0; attempt < 4; attempt++) {
    const elapsed = { default: [], emmalloc: [] };
    const normalized = { default: [], emmalloc: [] };
    const order = [];
    for (let sample = 0; sample < sampleCount; sample++) {
      const variants = sample & 1 ? ['emmalloc', 'default'] : ['default', 'emmalloc'];
      order.push(variants.join('→'));
      for (const variant of variants) {
        const mod = variant === 'default' ? defaultMod : emmallocMod;
        const duration = elapsedTransactions(mod, definition, repeats);
        elapsed[variant].push(duration);
        normalized[variant].push(duration / repeats);
      }
    }
    const minimum = Math.min(...elapsed.default, ...elapsed.emmalloc);
    measured = { elapsed, normalized, order, minimum, attempt };
    if (minimum >= minimumBatchMs) break;
    repeats = Math.max(repeats + 1, Math.ceil(repeats * minimumBatchMs * 1.15 / Math.max(0.001, minimum)));
  }
  assert.ok(measured.minimum >= minimumBatchMs, `${definition.id}: timed batch below ${minimumBatchMs} ms`);
  const defaultStats = stats(measured.normalized.default);
  const emmallocStats = stats(measured.normalized.emmalloc);
  const speedup = defaultStats.medianMsPerTransaction / emmallocStats.medianMsPerTransaction;
  const interval = balancedBootstrap(measured.normalized.default, measured.normalized.emmalloc, bootstrapIterations);
  return {
    id: definition.id,
    category: definition.category,
    changeClass: definition.changeClass,
    semantic: definition.semantic,
    parameters: Object.fromEntries(Object.entries(definition).filter(([key]) => !['id', 'category', 'changeClass', 'semantic'].includes(key))),
    samplesPerVariant: sampleCount,
    balancedOrder: { AB: sampleCount / 2, BA: sampleCount / 2, raw: measured.order },
    calibration: { ...calibration, finalRepeats: repeats, measurementAttempts: measured.attempt + 1 },
    timerFloor: { minimumRequiredMs: minimumBatchMs, minimumObservedMs: measured.minimum, passed: true },
    default: { ...defaultStats, rawElapsedMsPerBatch: measured.elapsed.default },
    emmalloc: { ...emmallocStats, rawElapsedMsPerBatch: measured.elapsed.emmalloc },
    speedup,
    pairedBootstrap95: interval,
    exactness: {
      passed: true,
      default: publicSnapshot(exactDefault),
      emmalloc: publicSnapshot(exactEmmalloc),
    },
  };
}

async function elapsedStartups(variant, repeats, sampleTag) {
  const start = performance.now();
  for (let i = 0; i < repeats; i++) {
    const mod = await instantiate(variant, `${sampleTag}-${i}`);
    mod._b3w_destroy();
  }
  return performance.now() - start;
}

async function benchmarkStartup(defaultVariant, emmallocVariant) {
  let repeats = 1;
  for (let round = 0; round < 8; round++) {
    const a = await elapsedStartups(defaultVariant, repeats, `cal-a-${round}`);
    const b = await elapsedStartups(emmallocVariant, repeats, `cal-b-${round}`);
    const minimum = Math.min(a, b);
    if (minimum >= calibrationTargetMs) break;
    repeats = Math.max(repeats * 2, Math.ceil(repeats * calibrationTargetMs / Math.max(0.001, minimum)));
  }
  let measured;
  for (let attempt = 0; attempt < 4; attempt++) {
    const elapsed = { default: [], emmalloc: [] };
    const order = [];
    for (let sample = 0; sample < sampleCount; sample++) {
      const variants = sample & 1 ? ['emmalloc', 'default'] : ['default', 'emmalloc'];
      order.push(variants.join('→'));
      for (const variantName of variants) {
        const variant = variantName === 'default' ? defaultVariant : emmallocVariant;
        elapsed[variantName].push(await elapsedStartups(variant, repeats, `sample-${attempt}-${sample}-${variantName}`));
      }
    }
    const minimum = Math.min(...elapsed.default, ...elapsed.emmalloc);
    measured = { elapsed, order, minimum, attempt };
    if (minimum >= minimumBatchMs) break;
    repeats = Math.max(repeats + 1, Math.ceil(repeats * minimumBatchMs * 1.15 / Math.max(0.001, minimum)));
  }
  assert.ok(measured.minimum >= minimumBatchMs, 'startup timed batch below floor');
  const normalized = {
    default: measured.elapsed.default.map((value) => value / repeats),
    emmalloc: measured.elapsed.emmalloc.map((value) => value / repeats),
  };
  const defaultStats = stats(normalized.default);
  const emmallocStats = stats(normalized.emmalloc);
  return {
    id: 'startup-00-module-import-compile-instantiate',
    category: 'startup',
    changeClass: 'allocator-sensitive',
    semantic: 'fresh ES-module import plus WebAssembly compile/instantiate and Emscripten runtime initialization',
    samplesPerVariant: sampleCount,
    balancedOrder: { AB: sampleCount / 2, BA: sampleCount / 2, raw: measured.order },
    calibration: { finalRepeats: repeats, measurementAttempts: measured.attempt + 1 },
    timerFloor: { minimumRequiredMs: minimumBatchMs, minimumObservedMs: measured.minimum, passed: true },
    default: { ...defaultStats, rawElapsedMsPerBatch: measured.elapsed.default },
    emmalloc: { ...emmallocStats, rawElapsedMsPerBatch: measured.elapsed.emmalloc },
    speedup: defaultStats.medianMsPerTransaction / emmallocStats.medianMsPerTransaction,
    pairedBootstrap95: balancedBootstrap(normalized.default, normalized.emmalloc, bootstrapIterations),
    exactness: { passed: true, note: 'Both factories passed the full symbol contract; all 99 stateful workloads compare every world output bit.' },
  };
}

function classify(entry) {
  if (entry.pairedBootstrap95.low95 > 1.03) return 'measured win';
  if (entry.pairedBootstrap95.high95 < 0.95) return 'material regression';
  if (entry.pairedBootstrap95.low95 > 1) return 'small measured gain';
  if (entry.pairedBootstrap95.high95 < 1) return 'small measured regression';
  return 'parity / inconclusive';
}

const sourceIdentity = {
  bridge: { path: 'wasm/box3d_web.c', sha256: sha256File(path.join(root, 'wasm/box3d_web.c')) },
  cmake: { path: 'wasm/CMakeLists.txt', sha256: sha256File(path.join(root, 'wasm/CMakeLists.txt')) },
  box3dHead: runShell(`git -C ${quote(box3dRoot)} rev-parse HEAD`, 'Box3D revision').stdout.trim(),
  emscripten: runShell(`source ${quote(emsdkEnv)} >/dev/null && emcc --version | head -2`, 'Emscripten version').stdout.trim(),
};

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'box3d-v113-allocator-'));
let defaultMod;
let emmallocMod;
try {
  console.error('Building isolated default-allocator native module...');
  const defaultVariant = buildVariant(tempRoot, 'default');
  console.error('Building isolated emmalloc native module...');
  const emmallocVariant = buildVariant(tempRoot, 'emmalloc');
  assert.notEqual(defaultVariant.artifacts['box3d.wasm'].sha256, emmallocVariant.artifacts['box3d.wasm'].sha256, 'allocator variants produced identical WASM');
  [defaultMod, emmallocMod] = await Promise.all([
    instantiate(defaultVariant, 'persistent-default'),
    instantiate(emmallocVariant, 'persistent-emmalloc'),
  ]);
  const definitions = makeDefinitions();
  const cases = [];
  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index];
    console.error(`[${index + 1}/100] ${definition.id}`);
    const entry = benchmarkDefinition(defaultMod, emmallocMod, definition);
    entry.classification = classify(entry);
    cases.push(entry);
  }
  console.error('[100/100] startup-00-module-import-compile-instantiate');
  const startup = await benchmarkStartup(defaultVariant, emmallocVariant);
  startup.classification = classify(startup);
  cases.push(startup);
  assert.equal(cases.length, 100);

  const allocatorSensitive = cases.filter((entry) => entry.changeClass === 'allocator-sensitive');
  const controls = cases.filter((entry) => entry.changeClass === 'solver-control');
  const changedGeometricMean = geometricMean(allocatorSensitive.map((entry) => entry.speedup));
  const controlGeometricMean = geometricMean(controls.map((entry) => entry.speedup));
  const minimumIndividual = Math.min(...cases.map((entry) => entry.speedup));
  const artifactSize = {
    defaultCombinedBytes: defaultVariant.artifacts.combinedBytes,
    emmallocCombinedBytes: emmallocVariant.artifacts.combinedBytes,
    bytesSaved: defaultVariant.artifacts.combinedBytes - emmallocVariant.artifacts.combinedBytes,
    ratioDefaultOverEmmalloc: defaultVariant.artifacts.combinedBytes / emmallocVariant.artifacts.combinedBytes,
  };
  const gates = {
    exactly100SemanticallyUnique: cases.length === 100 && new Set(cases.map((entry) => entry.id)).size === 100,
    eightOrMoreBalancedSamples: cases.every((entry) => entry.samplesPerVariant >= 8 && entry.balancedOrder.AB === entry.balancedOrder.BA),
    allBatchesAtLeast20ms: cases.every((entry) => entry.timerFloor.passed && entry.timerFloor.minimumObservedMs >= 20),
    exactMatricesColorsCountersHashes: cases.every((entry) => entry.exactness.passed),
    sourceUnchangedDuringRun:
      sourceIdentity.bridge.sha256 === sha256File(path.join(root, sourceIdentity.bridge.path)) &&
      sourceIdentity.cmake.sha256 === sha256File(path.join(root, sourceIdentity.cmake.path)),
    changedGeometricMeanAtLeast1_03: changedGeometricMean >= 1.03,
    controlsAtLeast0_98: controlGeometricMean >= 0.98,
    noIndividualBelow0_95: minimumIndividual >= 0.95,
  };
  const recommendIntegrate = gates.changedGeometricMeanAtLeast1_03 && gates.controlsAtLeast0_98 && gates.noIndividualBelow0_95 && gates.exactMatricesColorsCountersHashes;
  const result = {
    schemaVersion: 1,
    title: 'v1.13 native WebAssembly allocator build-flag tournament',
    generatedAt: new Date().toISOString(),
    platform: { platform: process.platform, arch: process.arch, node: process.version, cpu: os.cpus()[0]?.model ?? 'unknown' },
    sourceIdentity,
    methodology: {
      experimentCount: 100,
      composition: { create: 20, action: 20, active: 20, settled: 20, mixedLifecycle: 19, startup: 1 },
      samplesPerVariant: sampleCount,
      balancedOrder: `${sampleCount / 2} default→emmalloc and ${sampleCount / 2} emmalloc→default`,
      minimumTimedBatchMs: minimumBatchMs,
      calibrationTargetMs,
      bootstrapIterations,
      buildDifference: 'Isolated CMake builds use identical current source, Box3D checkout, -O3/-flto/SIMD/release flags, and Emscripten 4.0.23. The only intentional difference is final-link -sMALLOC=emmalloc.',
      exactness: 'For every stateful workload, compare every matrix and color Uint32 bit, body/dynamic/awake/max counters, transform/color revisions, action/create returns, and replay hash.',
      acceptance: 'Integrate only if allocator-sensitive complete-path geometric mean >=1.03x, solver controls >=0.98x, no individual median <0.95x, and exactness passes.',
    },
    builds: {
      default: { ...defaultVariant, wasmBinary: undefined, buildDir: undefined, outputDir: undefined, jsPath: undefined, wasmPath: undefined },
      emmalloc: { ...emmallocVariant, wasmBinary: undefined, buildDir: undefined, outputDir: undefined, jsPath: undefined, wasmPath: undefined },
      artifactSize,
    },
    cases,
    summary: {
      cases: cases.length,
      allocatorSensitiveCases: allocatorSensitive.length,
      solverControlCases: controls.length,
      allocatorSensitiveGeometricMean: changedGeometricMean,
      solverControlGeometricMean: controlGeometricMean,
      allCasesGeometricMean: geometricMean(cases.map((entry) => entry.speedup)),
      minimumIndividualSpeedup: minimumIndividual,
      maximumIndividualSpeedup: Math.max(...cases.map((entry) => entry.speedup)),
      startupSpeedup: startup.speedup,
      measuredWins: cases.filter((entry) => entry.classification === 'measured win').length,
      materialRegressions: cases.filter((entry) => entry.classification === 'material regression').length,
      recommendIntegrate,
    },
    gates,
    passedEvidenceIntegrity: gates.exactly100SemanticallyUnique && gates.eightOrMoreBalancedSamples && gates.allBatchesAtLeast20ms && gates.exactMatricesColorsCountersHashes && gates.sourceUnchangedDuringRun,
    recommendation: recommendIntegrate
      ? 'Integrate -sMALLOC=emmalloc: it clears every predeclared performance, control, individual-regression, and exactness gate.'
      : 'Do not integrate -sMALLOC=emmalloc: it fails at least one predeclared complete-path performance/control/regression gate despite exact output.',
    scopeBoundary: 'Native Node/WebAssembly startup, creation, action, active, settled, and lifecycle CPU timing; not browser frame rate or physical-GPU timing.',
  };
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
  const categoryRows = [...new Set(cases.map((entry) => entry.category))].map((category) => {
    const group = cases.filter((entry) => entry.category === category);
    return `| ${category} | ${group.length} | ${geometricMean(group.map((entry) => entry.speedup)).toFixed(4)}× | ${Math.min(...group.map((entry) => entry.speedup)).toFixed(4)}× |`;
  }).join('\n');
  const slowestRows = [...cases].sort((a, b) => a.speedup - b.speedup).slice(0, 10)
    .map((entry) => `| ${entry.id} | ${entry.speedup.toFixed(4)}× | ${entry.pairedBootstrap95.low95.toFixed(4)}–${entry.pairedBootstrap95.high95.toFixed(4)}× | ${entry.classification} |`).join('\n');
  fs.writeFileSync(markdownPath, `# v1.13 native allocator build-flag tournament\n\n` +
    `Verdict: **${recommendIntegrate ? 'integrate emmalloc' : 'do not integrate emmalloc'}**.\n\n` +
    `Exactly **100** semantically unique workloads used ${sampleCount} balanced samples per variant and timed batches no shorter than ${minimumBatchMs} ms. All stateful workloads matched every matrix/color bit, counter/revision, action return, and replay hash.\n\n` +
    `- Allocator-sensitive complete-path geometric mean: **${changedGeometricMean.toFixed(4)}×** (gate: >=1.03×)\n` +
    `- Solver-control geometric mean: **${controlGeometricMean.toFixed(4)}×** (gate: >=0.98×)\n` +
    `- Worst individual median: **${minimumIndividual.toFixed(4)}×** (gate: >=0.95×)\n` +
    `- Startup speedup: **${startup.speedup.toFixed(4)}×**\n` +
    `- Artifact size: **${artifactSize.defaultCombinedBytes.toLocaleString()} B → ${artifactSize.emmallocCombinedBytes.toLocaleString()} B** (${artifactSize.bytesSaved.toLocaleString()} B saved; ${artifactSize.ratioDefaultOverEmmalloc.toFixed(4)}× smaller ratio)\n\n` +
    `## Category results\n\n| Category | Workloads | Geometric mean | Worst median |\n|---|---:|---:|---:|\n${categoryRows}\n\n` +
    `## Ten slowest emmalloc comparisons\n\n| Workload | Default/emmalloc | 95% interval | Classification |\n|---|---:|---:|---|\n${slowestRows}\n\n` +
    `Recommendation: ${result.recommendation}\n\nRaw balanced samples, hashes, artifact identities, link commands, and all 100 workload definitions are retained in the JSON evidence.\n`);
  console.log(JSON.stringify({ summary: result.summary, gates, recommendation: result.recommendation, artifacts: result.builds.artifactSize }, null, 2));
  if (!result.passedEvidenceIntegrity) process.exitCode = 1;
} finally {
  defaultMod?._b3w_destroy();
  emmallocMod?._b3w_destroy();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
