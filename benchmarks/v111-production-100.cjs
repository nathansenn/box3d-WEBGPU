'use strict';

/*
 * Exact 100-case production-path tournament for the v1.10 baseline versus the
 * working tree. The harness intentionally builds both trees into isolated
 * temporary directories and alternates execution order for every timed sample.
 *
 * This file is not wired into package.json on purpose. Run it directly:
 *
 *   node --expose-gc benchmarks/v111-production-100.cjs
 *
 * Environment:
 *   V111_SAMPLES=8       timed samples per variant/case (minimum 8, even)
 *   V111_SCALE=0.25      warmup and timed-iteration scale
 *   V111_KEEP_TEMP=1     retain isolated build trees for inspection
 *   V111_OUTPUT_PREFIX=... override JSON/Markdown output prefix
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const baselineVersion = process.env.PRODUCTION_BENCH_BASELINE_VERSION || 'v1.10.0';
const candidateVersion = process.env.PRODUCTION_BENCH_CANDIDATE_VERSION || 'v1.11';
const benchmarkGeneration = process.env.PRODUCTION_BENCH_GENERATION || 'v1.11';
const v112Mode = benchmarkGeneration === 'v1.12';
const baselineArchive = process.env.PRODUCTION_BENCH_BASELINE_ARCHIVE
  ? path.resolve(process.env.PRODUCTION_BENCH_BASELINE_ARCHIVE)
  : path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz');
const expectedBaselineSha256 = process.env.PRODUCTION_BENCH_BASELINE_SHA256 ||
  'dea18ff88e86568e5449c9dece5610d0dfadf38d901eef1c1e39155c64e8c3f5';
const requestedSampleCount = Number.parseInt(process.env.V111_SAMPLES || '8', 10);
const sampleCount = Math.max(8, requestedSampleCount + (requestedSampleCount & 1));
const workloadScale = Math.max(0.02, Number(process.env.V111_SCALE || '0.25'));
const outputPrefix = process.env.V111_OUTPUT_PREFIX
  ? path.resolve(process.env.V111_OUTPUT_PREFIX)
  : path.join(root, 'benchmarks/v111-production-100.results');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-v111-production-'));
const baselineRoot = path.join(tempRoot, 'baseline-v1.10');
const currentBuild = path.join(tempRoot, 'current-build');
const currentAssets = path.join(tempRoot, 'current-assets');
let observableSink = 0;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}`);
  }
}

function writeCommonJsPackage(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"commonjs"}\n');
}

function ensureBaselineBaseTsconfig() {
  const target = path.join(baselineRoot, 'tsconfig.json');
  if (fs.existsSync(target)) return;

  // The exact v1.10 source baseline intentionally contains the specialized
  // test/benchmark configs, but its source archive omitted their shared base.
  // Materialize the v1.10 base config inside the isolated extraction rather
  // than inheriting the candidate tree's potentially changing compiler rules.
  const v110BaseConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'Bundler',
      strict: true,
      skipLibCheck: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      noEmit: true,
    },
    include: ['src'],
  };
  fs.writeFileSync(target, `${JSON.stringify(v110BaseConfig, null, 2)}\n`);
}

function prepareBaseline() {
  if (!fs.existsSync(baselineArchive)) {
    throw new Error(`missing exact v1.10 baseline archive: ${baselineArchive}`);
  }
  const archiveSha256 = crypto.createHash('sha256').update(fs.readFileSync(baselineArchive)).digest('hex');
  assert.equal(archiveSha256, expectedBaselineSha256, 'v1.10 baseline archive checksum');
  fs.mkdirSync(baselineRoot, { recursive: true });
  run('tar', ['-xzf', baselineArchive, '-C', baselineRoot]);
  ensureBaselineBaseTsconfig();
  const baselineModules = path.join(baselineRoot, 'node_modules');
  fs.rmSync(baselineModules, { recursive: true, force: true });
  fs.symlinkSync(
    path.join(root, 'node_modules'),
    baselineModules,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  run(path.join(root, 'node_modules/.bin/tsc'), ['-p', path.join(baselineRoot, 'tsconfig.test.json')], {
    cwd: baselineRoot,
  });
  writeCommonJsPackage(path.join(baselineRoot, '.test-build'));
  run('bash', [path.join(baselineRoot, 'scripts/build-soft-kernels.sh')], { cwd: baselineRoot });
}

function prepareCurrent() {
  run(path.join(root, 'node_modules/.bin/tsc'), [
    '-p', path.join(root, 'tsconfig.test.json'),
    '--outDir', currentBuild,
  ], { cwd: root });
  writeCommonJsPackage(currentBuild);

  // Rebuild current soft kernels in an isolated miniature source tree so the
  // tournament never mutates tracked public/ artifacts.
  fs.mkdirSync(path.join(currentAssets, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(currentAssets, 'wasm'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/build-soft-kernels.sh'), path.join(currentAssets, 'scripts/build-soft-kernels.sh'));
  fs.copyFileSync(path.join(root, 'wasm/soft_kernels.c'), path.join(currentAssets, 'wasm/soft_kernels.c'));
  fs.chmodSync(path.join(currentAssets, 'scripts/build-soft-kernels.sh'), 0o755);
  run('bash', [path.join(currentAssets, 'scripts/build-soft-kernels.sh')], { cwd: currentAssets });
}

function loadProject(projectRoot, buildRoot, assetRoot, label) {
  const { SCENES } = require(path.join(buildRoot, 'src/scenes.js'));
  const { SoftSimulationSuite } = require(path.join(buildRoot, 'src/soft/simulations.js'));
  const { SoftKernelModule } = require(path.join(buildRoot, 'src/soft/kernels.js'));
  const { FallbackPhysicsBackend } = require(path.join(buildRoot, 'src/physics/fallback.js'));
  const { CinematicEffects } = require(path.join(buildRoot, 'src/effects.js'));
  const kernelBytes = fs.readFileSync(path.join(assetRoot, 'public/soft-kernels-simd.wasm'));
  const kernelModule = new WebAssembly.Module(kernelBytes);
  return {
    label,
    projectRoot,
    SCENES,
    SoftSimulationSuite,
    SoftKernelModule,
    FallbackPhysicsBackend,
    CinematicEffects,
    createSoftSuite(useWasm) {
      if (!useWasm) return new SoftSimulationSuite();
      const instance = new WebAssembly.Instance(kernelModule, {});
      return new SoftSimulationSuite(new SoftKernelModule('simd', instance.exports));
    },
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
  const finite = values.filter((value) => Number.isFinite(value) && value > 0);
  return finite.length === 0
    ? 0
    : Math.exp(finite.reduce((sum, value) => sum + Math.log(value), 0) / finite.length);
}

function orderBalancedSpeedup(orderGroups) {
  const baselineFirst = median(orderGroups.baselineFirst);
  const candidateSecond = median(orderGroups.candidateSecond);
  const candidateFirst = median(orderGroups.candidateFirst);
  const baselineSecond = median(orderGroups.baselineSecond);
  const baselineFirstRatio = baselineFirst / candidateSecond;
  const candidateFirstRatio = baselineSecond / candidateFirst;
  return {
    speedup: Math.sqrt(baselineFirstRatio * candidateFirstRatio),
    baselineFirstRatio,
    candidateFirstRatio,
    baselineFirstMedianMs: baselineFirst,
    baselineSecondMedianMs: baselineSecond,
    candidateFirstMedianMs: candidateFirst,
    candidateSecondMedianMs: candidateSecond,
  };
}

function relativeL2(a, b) {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let error = 0;
  let reference = 0;
  for (let i = 0; i < a.length; i++) {
    const delta = b[i] - a[i];
    error += delta * delta;
    reference += a[i] * a[i];
  }
  return Math.sqrt(error / Math.max(reference, 1e-30));
}

function maxAbs(a, b) {
  if (!a || !b || a.length !== b.length) return Number.POSITIVE_INFINITY;
  let maximum = 0;
  for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i] - b[i]));
  return maximum;
}

function finiteArray(values) {
  if (!values) return true;
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) return false;
  }
  return true;
}

function hashTypedArrays(arrays, metadata) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(metadata));
  for (const values of arrays) {
    if (!values) continue;
    hash.update(Buffer.from(values.buffer, values.byteOffset, values.byteLength));
  }
  return hash.digest('hex');
}

function scaledIterations(value) {
  return Math.max(2, Math.round(value * workloadScale));
}

function softDomainFidelity(sceneId) {
  if (sceneId < 650) return 0.002;
  if (sceneId < 700) return 0.0005;
  return 1e-7;
}

function makeDefinitions() {
  const definitions = [];

  const intactCloth = [];
  for (let sceneId = 600; sceneId < 650; sceneId++) {
    const variant = (sceneId - 600) % 10;
    const mode = Math.floor((sceneId - 600) / 10);
    if (variant !== 6 && !(mode >= 3 && variant === 7)) intactCloth.push(sceneId);
  }
  const safeClothSceneIds = [609, 619, 629, 639, 649];
  const clothControls = intactCloth
    .filter((sceneId) => !safeClothSceneIds.includes(sceneId))
    .slice(0, 30 - safeClothSceneIds.length);
  const clothScenes = [...safeClothSceneIds, ...clothControls];
  // Variant 9 uses the newly qualified fused WASM step. Sphere-drape variants
  // 3 and 7 use the exact squared-distance broad rejection retained by the
  // missed-gains audit. Both are changed production paths; other cloth cases
  // remain controls for this tournament (constructor memory is timed
  // separately because setup is deliberately excluded here).
  const changedClothSceneIds = new Set(clothScenes.filter((sceneId) => {
    const variant = (sceneId - 600) % 10;
    if (v112Mode) return variant === 5;
    return safeClothSceneIds.includes(sceneId) || variant === 3 || variant === 7;
  }));
  for (let index = 0; index < clothScenes.length; index++) {
    const sceneId = clothScenes[index];
    definitions.push({
      category: 'cloth-wasm',
      sceneId,
      engine: 'soft',
      wasm: true,
      warmup: 12,
      iterations: 72,
      rain: index % 10 === 9 ? 72 : 0,
      control: !changedClothSceneIds.has(sceneId),
      fidelityLimit: 0.002,
    });
  }

  // The new rope integration kernel won isolated/interaction-free benchmarks,
  // but altered break topology once users launched projectiles or rain. The
  // interactive release therefore keeps every rope case on v1.10's already
  // qualified projection batching and treats this entire group as controls.
  const safeRopeSceneIds = [];
  const ropeControls = Array.from({ length: 50 }, (_, index) => 650 + index)
    .filter((sceneId) => !safeRopeSceneIds.includes(sceneId))
    .slice(0, 25 - safeRopeSceneIds.length);
  const ropeScenes = [...safeRopeSceneIds, ...ropeControls];
  for (let index = 0; index < ropeScenes.length; index++) {
    const sceneId = ropeScenes[index];
    const fusedKernelStep = safeRopeSceneIds.includes(sceneId);
    definitions.push({
      category: 'rope-wasm',
      sceneId,
      engine: 'soft',
      wasm: true,
      warmup: 12,
      iterations: 84,
      rain: index % 8 === 7 ? 96 : 0,
      control: !fusedKernelStep,
      fidelityLimit: 0.0005,
    });
  }

  const fallbackScenes = [49, 99, 149, 199, 249, 299, 349, 399, 449, 499, 549, 599, 190, 240, 290];
  for (let index = 0; index < fallbackScenes.length; index++) {
    definitions.push({
      category: 'fallback',
      sceneId: fallbackScenes[index],
      engine: 'fallback',
      // Fallback paths are sensitive to V8 tiering and GC because complete
      // frames allocate far more JS objects than the WASM soft paths. A
      // longer warm-up and timed horizon prevents startup/tiering effects
      // from dominating these production-frame measurements.
      warmup: 24,
      iterations: 96,
      rain: index === 5 || index === 14 ? 180 : 0,
      explode: index % 5 === 4,
      fidelityLimit: 0.005,
    });
  }

  for (let index = 0; index < 10; index++) {
    definitions.push({
      category: 'effects',
      sceneId: -1,
      engine: 'effects',
      effectVariant: index,
      warmup: 16,
      iterations: 120,
      control: true,
      fidelityLimit: 1e-6,
    });
  }

  for (let variant = 0; variant < 10; variant++) {
    definitions.push({
      category: 'water-control',
      sceneId: 740 + variant,
      engine: 'soft',
      wasm: true,
      warmup: 15,
      iterations: 120,
      control: true,
      fidelityLimit: 1e-7,
    });
  }

  const jsControls = [600, 643, 650, 699, 749];
  for (const sceneId of jsControls) {
    definitions.push({
      category: 'js-control',
      sceneId,
      engine: 'soft',
      wasm: false,
      warmup: 12,
      iterations: 72,
      control: true,
      fidelityLimit: 1e-7,
    });
  }

  const unchangedControls = [600, 649, 650, 699, 749];
  for (const sceneId of unchangedControls) {
    const fidelityLimit = softDomainFidelity(sceneId);
    definitions.push({
      category: 'unchanged-control',
      sceneId,
      engine: 'soft',
      wasm: true,
      operation: 'unchanged-frame',
      warmup: 24,
      iterations: 6000,
      control: true,
      fidelityLimit,
      renderFidelityLimit: fidelityLimit,
    });
  }

  assert.equal(definitions.length, 100, `expected exactly 100 cases, received ${definitions.length}`);
  const expectedCounts = {
    'cloth-wasm': 30,
    'rope-wasm': 25,
    fallback: 15,
    effects: 10,
    'water-control': 10,
    'js-control': 5,
    'unchanged-control': 5,
  };
  for (const [category, expected] of Object.entries(expectedCounts)) {
    assert.equal(definitions.filter((item) => item.category === category).length, expected, category);
  }
  return definitions.map((definition, index) => ({ id: index + 1, ...definition }));
}

function setupSoft(project, definition) {
  const suite = project.createSoftSuite(definition.wasm);
  const scene = project.SCENES[definition.sceneId];
  assert.ok(scene, `missing scene ${definition.sceneId}`);
  assert.ok(suite.createScene(scene, 5, 0x111000 + definition.sceneId), `failed scene ${definition.sceneId}`);
  if (definition.rain) suite.spawnRain(definition.rain, 14, 24);
  if (definition.operation === 'unchanged-frame') {
    for (let i = 0; i < 12; i++) suite.step(1 / 60, 4);
    suite.buildFrame(false);
  }
  return suite;
}

function softOperation(suite, definition) {
  if (definition.operation === 'unchanged-frame') {
    const frame = suite.buildFrame(false);
    observableSink = (observableSink + frame.frameVersion + frame.instanceCount) >>> 0;
    return;
  }
  suite.step(1 / 60, 4);
  const frame = suite.buildFrame(false);
  observableSink = (observableSink + frame.frameVersion + frame.nodeCount) >>> 0;
}

function captureSoft(suite) {
  const frame = suite.buildFrame(false);
  const active = suite.active;
  let state;
  if (active.kind === 'water') {
    // eta alone is not the authoritative water state: retain both velocity
    // fields as well so a faster solver cannot pass while changing currents.
    state = new Float32Array(active.eta.length + active.u.length + active.v.length);
    state.set(active.eta, 0);
    state.set(active.u, active.eta.length);
    state.set(active.v, active.eta.length + active.u.length);
  } else {
    state = Float32Array.from(active.positions);
  }
  const matrices = Float32Array.from(frame.matrices.subarray(0, frame.instanceCount * 16));
  const colors = Float32Array.from(frame.colors.subarray(0, frame.instanceCount * 4));
  const ropePositions = frame.ropeGrid
    ? Float32Array.from(frame.ropeGrid.positions.subarray(0, frame.ropeGrid.nodeCount * 3))
    : new Float32Array(0);
  const metadata = {
    kind: frame.kind,
    nodes: frame.nodeCount,
    constraints: frame.constraintCount,
    broken: frame.brokenCount,
    instances: frame.instanceCount,
    ropeSegments: frame.ropeGrid?.segmentCount || 0,
    hash: suite.hash() >>> 0,
  };
  return {
    ...metadata,
    state,
    matrices,
    colors,
    ropePositions,
    finite: finiteArray(state) && finiteArray(matrices) && finiteArray(colors) && finiteArray(ropePositions),
    fingerprint: hashTypedArrays([state, matrices, colors, ropePositions], metadata),
  };
}

function setupFallback(project, definition) {
  const backend = new project.FallbackPhysicsBackend(4096);
  const scene = project.SCENES[definition.sceneId];
  assert.ok(scene, `missing fallback scene ${definition.sceneId}`);
  backend.createScene(scene, 5, 0x111000 + definition.sceneId);
  if (definition.rain) backend.spawnRain(definition.rain, 28, 34);
  if (definition.explode) backend.explode(0, 8, 0, 24, 14);
  return backend;
}

function fallbackOperation(backend) {
  backend.step(1 / 60, 2);
  observableSink = (observableSink + backend.frameVersion() + backend.bodyCount()) >>> 0;
}

function captureFallback(backend) {
  const bodyCount = backend.bodyCount();
  const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
  const colorStart = Number(backend._b3w_colors_ptr()) / 4;
  const matrices = Float32Array.from(backend.HEAPF32.subarray(matrixStart, matrixStart + bodyCount * 16));
  const colors = Float32Array.from(backend.HEAPF32.subarray(colorStart, colorStart + bodyCount * 4));
  const metadata = {
    bodyCount,
    dynamicCount: backend.dynamicCount(),
    hash: backend.replayHash() >>> 0,
    broadphaseAxis: backend.broadphaseAxis(),
    broadphaseCandidates: backend.broadphaseCandidateCount(),
  };
  return {
    ...metadata,
    state: matrices,
    matrices,
    colors,
    broken: 0,
    finite: finiteArray(matrices) && finiteArray(colors),
    fingerprint: hashTypedArrays([matrices, colors], metadata),
  };
}

function setupEffects(project, definition) {
  const effects = new project.CinematicEffects();
  const variant = definition.effectVariant;
  const budget = 256 + variant * 128;
  effects.clear(0xeff000 + variant);
  for (let i = 0; i < 1 + (variant % 4); i++) {
    effects.spawnExplosion([i * 1.5, 3 + i * 0.2, -i], 10 + variant, budget);
  }
  if ((variant & 1) !== 0) effects.spawnProjectileMuzzle([-12, 6, 0], [24, 2, 0], budget);
  if (variant % 3 !== 0) effects.spawnImpulseDust([0, 0.2, 0], 8 + variant, budget);
  if (variant >= 5) effects.spawnRainFlash([0, 16, 0], budget);
  return effects;
}

function effectsOperation(effects, definition) {
  effects.update(1 / 60);
  const frame = effects.buildFrame(256 + definition.effectVariant * 128);
  observableSink = (observableSink + frame.count + frame.frameVersion) >>> 0;
}

function captureEffects(effects, definition) {
  const frame = effects.buildFrame(256 + definition.effectVariant * 128);
  const matrices = Float32Array.from(frame.matrices.subarray(0, frame.count * 16));
  const colors = Float32Array.from(frame.colors.subarray(0, frame.count * 4));
  const lines = new Float32Array(frame.debugLines.length * 10);
  for (let i = 0; i < frame.debugLines.length; i++) {
    const line = frame.debugLines[i];
    const offset = i * 10;
    lines[offset] = line.ax; lines[offset + 1] = line.ay; lines[offset + 2] = line.az;
    lines[offset + 3] = line.bx; lines[offset + 4] = line.by; lines[offset + 5] = line.bz;
    lines[offset + 6] = line.r; lines[offset + 7] = line.g; lines[offset + 8] = line.b; lines[offset + 9] = line.a;
  }
  const metadata = { count: frame.count, frameVersion: frame.frameVersion, lineCount: frame.debugLines.length };
  return {
    ...metadata,
    state: matrices,
    matrices,
    colors,
    lines,
    broken: 0,
    finite: finiteArray(matrices) && finiteArray(colors) && finiteArray(lines),
    fingerprint: hashTypedArrays([matrices, colors, lines], metadata),
  };
}

function measure(project, definition) {
  let subject;
  let operation;
  let capture;
  let destroy;
  if (definition.engine === 'soft') {
    subject = setupSoft(project, definition);
    operation = () => softOperation(subject, definition);
    capture = () => captureSoft(subject);
    destroy = () => subject.destroy();
  } else if (definition.engine === 'fallback') {
    subject = setupFallback(project, definition);
    operation = () => fallbackOperation(subject);
    capture = () => captureFallback(subject);
    destroy = () => subject.destroy();
  } else {
    subject = setupEffects(project, definition);
    operation = () => effectsOperation(subject, definition);
    capture = () => captureEffects(subject, definition);
    destroy = () => {};
  }

  const warmup = scaledIterations(definition.warmup);
  const iterations = scaledIterations(definition.iterations);
  for (let i = 0; i < warmup; i++) operation();
  const before = definition.operation === 'unchanged-frame' ? capture() : null;
  global.gc?.();
  const started = performance.now();
  for (let i = 0; i < iterations; i++) operation();
  const elapsed = performance.now() - started;
  const result = capture();
  destroy();
  return {
    ms: elapsed / iterations,
    iterations,
    capture: result,
    beforeFingerprint: before?.fingerprint || null,
    withinRunExact: before ? before.fingerprint === result.fingerprint : null,
  };
}

function deterministic(captures) {
  return new Set(captures.map((capture) => capture.fingerprint)).size === 1;
}

function compareCaptures(definition, baseline, current) {
  const sameShapes = baseline.state.length === current.state.length &&
    baseline.matrices.length === current.matrices.length &&
    baseline.colors.length === current.colors.length;
  const stateError = relativeL2(baseline.state, current.state);
  const matrixError = relativeL2(baseline.matrices, current.matrices);
  const colorError = relativeL2(baseline.colors, current.colors);
  const lineError = definition.engine === 'effects' ? maxAbs(baseline.lines, current.lines) : 0;
  const sameBreakCount = baseline.broken === current.broken;
  const sameCounts = definition.engine === 'soft'
    ? baseline.nodes === current.nodes && baseline.instances === current.instances && baseline.ropeSegments === current.ropeSegments
    : definition.engine === 'fallback'
      ? baseline.bodyCount === current.bodyCount && baseline.dynamicCount === current.dynamicCount
      : baseline.count === current.count && baseline.lineCount === current.lineCount;
  const withinFidelity = stateError <= definition.fidelityLimit;
  const renderLimit = definition.renderFidelityLimit ?? (definition.engine === 'effects'
    ? 1e-6
    : definition.engine === 'fallback'
      ? definition.fidelityLimit
      : 5e-4);
  const renderCorrect = matrixError <= renderLimit && colorError <= renderLimit && lineError <= renderLimit;
  return {
    correct: baseline.finite && current.finite && sameShapes && sameBreakCount && sameCounts && withinFidelity && renderCorrect,
    stateError,
    matrixError,
    colorError,
    lineError,
    sameBreakCount,
    sameCounts,
    fidelityLimit: definition.fidelityLimit,
    renderLimit,
  };
}

function decisionFor(definition, correctness, speedup) {
  if (!correctness) return 'rejected-correctness';
  if (definition.control) return 'control';
  if (speedup >= 1.03) return 'accepted';
  if (speedup >= 0.98) return 'borderline';
  return 'rejected-no-win';
}

function markdownReport(result) {
  const lines = [
    `# WebPhysics ${benchmarkGeneration} production-path 100-case benchmark`,
    '',
    `Generated: ${result.generatedAt}`,
    '',
    `Baseline: **${result.baseline}**; candidate: **${result.candidate}**.`,
    '',
    `Exactly **${result.caseCount}** cases, **${result.samples}** timed samples per variant/case, with an equal number of both execution orders.`,
    '',
    '## Summary',
    '',
    `- Accepted wins: **${result.summary.accepted}**`,
    `- Borderline: **${result.summary.borderline}**`,
    `- Rejected, no win: **${result.summary.rejectedNoWin}**`,
    `- Rejected, correctness: **${result.summary.rejectedCorrectness}**`,
    `- Controls: **${result.summary.controls}**`,
    `- Changed-path geometric mean: **${result.summary.changedGeometricMean.toFixed(4)}x**`,
    `- Deterministic baseline/candidate groups: **${result.summary.deterministicGroups}/${result.caseCount * 2}**`,
    `- Exact unchanged before/after groups: **${result.summary.unchangedExactGroups}/${result.summary.unchangedGroupCount}**`,
    '',
    '## Category counts',
    '',
    '| Category | Cases | Geometric mean | Correctness failures |',
    '|---|---:|---:|---:|',
  ];
  for (const category of result.categories) {
    lines.push(`| ${category.category} | ${category.cases} | ${category.geometricMean.toFixed(4)}x | ${category.correctnessFailures} |`);
  }
  lines.push(
    '',
    '## All cases',
    '',
    '| # | Category | Scene | Baseline ms | Candidate ms | Speedup | State L2 | Breaks | Deterministic | Within-run exact | Decision |',
    '|---:|---|---|---:|---:|---:|---:|---|---|---|---|',
  );
  for (const record of result.records) {
    lines.push(
      `| ${record.id} | ${record.category} | ${record.sceneTitle.replace(/\|/g, '\\|')} | ` +
      `${record.baselineMedianMs.toFixed(6)} | ${record.candidateMedianMs.toFixed(6)} | ` +
      `${record.speedup.toFixed(4)}x | ${record.correctness.stateError.toExponential(3)} | ` +
      `${record.correctness.sameBreakCount ? 'match' : 'DIFF'} | ` +
      `${record.baselineDeterministic && record.candidateDeterministic ? 'yes' : 'NO'} | ` +
      `${record.withinRunExact === null ? '—' : record.withinRunExact ? 'yes' : 'NO'} | ${record.decision} |`,
    );
  }
  lines.push(
    '',
    '## Gates',
    '',
    '- Every timed sample starts from the same scene, seed, stress, and action setup.',
    '- Every case has an equal number of baseline-first and candidate-first samples.',
    '- Reported speedup is the geometric mean of the two order-stratified median ratios.',
    '- Medians and median absolute deviations are retained in JSON.',
    '- All authoritative state and render streams must remain finite.',
    '- Node/body/instance counts and soft-system break counts must match.',
    '- Cross-version state bounds are domain-specific: cloth 0.2%, rope 0.05%, water 1e-7, and fallback 0.5%.',
    '- Every unchanged control must have an exact before/after fingerprint independently inside both implementations.',
    '- JavaScript controls retain their strict control thresholds.',
    '- Each implementation must reproduce an identical result fingerprint across its samples.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

async function main() {
  prepareBaseline();
  prepareCurrent();
  const baseline = loadProject(
    baselineRoot,
    path.join(baselineRoot, '.test-build'),
    baselineRoot,
    baselineVersion,
  );
  const candidate = loadProject(root, currentBuild, currentAssets, 'working-tree');
  const definitions = makeDefinitions();
  const records = [];
  const started = performance.now();

  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index];
    const baselineTimes = [];
    const candidateTimes = [];
    const baselineCaptures = [];
    const candidateCaptures = [];
    const baselineWithinRunExactSamples = [];
    const candidateWithinRunExactSamples = [];
    const orderGroups = {
      baselineFirst: [],
      baselineSecond: [],
      candidateFirst: [],
      candidateSecond: [],
    };
    for (let sample = 0; sample < sampleCount; sample++) {
      const baselineRunsFirst = ((index + sample) & 1) === 0;
      const order = baselineRunsFirst ? [baseline, candidate] : [candidate, baseline];
      for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
        const project = order[orderIndex];
        const measured = measure(project, definition);
        if (project === baseline) {
          baselineTimes.push(measured.ms);
          baselineCaptures.push(measured.capture);
          baselineWithinRunExactSamples.push(measured.withinRunExact);
          orderGroups[orderIndex === 0 ? 'baselineFirst' : 'baselineSecond'].push(measured.ms);
        } else {
          candidateTimes.push(measured.ms);
          candidateCaptures.push(measured.capture);
          candidateWithinRunExactSamples.push(measured.withinRunExact);
          orderGroups[orderIndex === 0 ? 'candidateFirst' : 'candidateSecond'].push(measured.ms);
        }
      }
    }

    const baselineMedian = median(baselineTimes);
    const candidateMedian = median(candidateTimes);
    const pooledSpeedup = baselineMedian / candidateMedian;
    const orderBalanced = orderBalancedSpeedup(orderGroups);
    const speedup = orderBalanced.speedup;
    const baselineDeterministic = deterministic(baselineCaptures);
    const candidateDeterministic = deterministic(candidateCaptures);
    const isUnchangedControl = definition.operation === 'unchanged-frame';
    const baselineWithinRunExact = isUnchangedControl
      ? baselineWithinRunExactSamples.every((value) => value === true)
      : null;
    const candidateWithinRunExact = isUnchangedControl
      ? candidateWithinRunExactSamples.every((value) => value === true)
      : null;
    const withinRunExact = isUnchangedControl
      ? baselineWithinRunExact && candidateWithinRunExact
      : null;
    const correctness = compareCaptures(definition, baselineCaptures[0], candidateCaptures[0]);
    correctness.correct = correctness.correct && baselineDeterministic && candidateDeterministic;
    correctness.withinRunExact = withinRunExact;
    if (isUnchangedControl) correctness.correct = correctness.correct && withinRunExact;
    const decision = decisionFor(definition, correctness.correct, speedup);
    const sceneTitle = definition.sceneId >= 0
      ? baseline.SCENES[definition.sceneId].title
      : `Cinematic effects variant ${definition.effectVariant + 1}`;
    const record = {
      ...definition,
      sceneTitle,
      baselineSamplesMs: baselineTimes,
      candidateSamplesMs: candidateTimes,
      baselineMedianMs: baselineMedian,
      candidateMedianMs: candidateMedian,
      baselineMadMs: mad(baselineTimes),
      candidateMadMs: mad(candidateTimes),
      pooledSpeedup,
      orderBalanced,
      speedup,
      baselineDeterministic,
      candidateDeterministic,
      baselineWithinRunExactSamples,
      candidateWithinRunExactSamples,
      baselineWithinRunExact,
      candidateWithinRunExact,
      withinRunExact,
      baselineFingerprint: baselineCaptures[0].fingerprint,
      candidateFingerprint: candidateCaptures[0].fingerprint,
      baselineBrokenCount: baselineCaptures[0].broken,
      candidateBrokenCount: candidateCaptures[0].broken,
      correctness,
      decision,
    };
    records.push(record);
    console.log(
      `${String(definition.id).padStart(3, '0')}/100 ` +
      `${definition.category.padEnd(19)} ${speedup.toFixed(3)}x ${decision}`,
    );
  }

  const categoryNames = [...new Set(records.map((record) => record.category))];
  const categories = categoryNames.map((category) => {
    const selected = records.filter((record) => record.category === category);
    return {
      category,
      cases: selected.length,
      geometricMean: geometricMean(selected.map((record) => record.speedup)),
      correctnessFailures: selected.filter((record) => !record.correctness.correct).length,
    };
  });
  const changed = records.filter((record) => !record.control);
  const result = {
    schemaVersion: 3,
    generatedAt: new Date().toISOString(),
    baseline: `${baselineVersion} exact source archive`,
    candidate: `${candidateVersion} working tree`,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    baselineArchive: path.relative(root, baselineArchive),
    baselineArchiveSha256: expectedBaselineSha256,
    caseCount: records.length,
    samples: sampleCount,
    workloadScale,
    elapsedSeconds: (performance.now() - started) / 1000,
    observableSink,
    methodology: {
      order: 'equal baseline-first and candidate-first samples for every case',
      statistic: 'median and median absolute deviation',
      speedup: 'geometric mean of the two order-stratified median ratios',
      timing: 'production operations after warmup; setup, capture, and process startup excluded',
      determinism: 'SHA-256 fingerprint of authoritative numeric streams and structural metadata across every sample',
    },
    summary: {
      accepted: records.filter((record) => record.decision === 'accepted').length,
      borderline: records.filter((record) => record.decision === 'borderline').length,
      rejectedNoWin: records.filter((record) => record.decision === 'rejected-no-win').length,
      rejectedCorrectness: records.filter((record) => record.decision === 'rejected-correctness').length,
      controls: records.filter((record) => record.decision === 'control').length,
      changedGeometricMean: geometricMean(changed.map((record) => record.speedup)),
      changedMedian: median(changed.map((record) => record.speedup)),
      deterministicGroups: records.reduce(
        (sum, record) => sum + Number(record.baselineDeterministic) + Number(record.candidateDeterministic),
        0,
      ),
      unchangedExactGroups: records.reduce(
        (sum, record) => sum + Number(record.baselineWithinRunExact) + Number(record.candidateWithinRunExact),
        0,
      ),
      unchangedGroupCount: records.filter((record) => record.operation === 'unchanged-frame').length * 2,
    },
    categories,
    records,
  };
  assert.equal(result.caseCount, 100, 'result must contain exactly 100 cases');
  fs.mkdirSync(path.dirname(outputPrefix), { recursive: true });
  fs.writeFileSync(`${outputPrefix}.json`, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(`${outputPrefix}.md`, markdownReport(result));
  console.log(`wrote ${outputPrefix}.json`);
  console.log(`wrote ${outputPrefix}.md`);
  if (result.summary.rejectedCorrectness > 0 || result.summary.deterministicGroups !== 200) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.env.V111_KEEP_TEMP === '1') {
      console.error(`kept temporary benchmark trees: ${tempRoot}`);
    } else {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
