'use strict';

/*
 * Exact 100-case production-path tournament for the v1.11 baseline versus the
 * working tree. The harness intentionally builds both trees into isolated
 * temporary directories and alternates execution order for every timed sample.
 *
 * This file is not wired into package.json on purpose. Run it directly:
 *
 *   node --expose-gc benchmarks/v112-production-100.cjs
 *
 * Environment:
 *   V112_SAMPLES=8       timed samples per variant/case (minimum 8, even)
 *   V112_SCALE=0.25      warmup and timed-iteration scale
 *   V112_TARGET_MS=25    calibrated minimum accumulated timed work/sample
 *   V112_BOOTSTRAPS=20000 stratified log-ratio bootstrap resamples
 *   V112_KEEP_TEMP=1     retain isolated build trees for inspection
 *   V112_OUTPUT_PREFIX=... override JSON/Markdown output prefix
 *   V112_CASE_LIMIT=N    smoke-only subset (never accepted as release evidence)
 *   V112_CASE_IDS=1,71,86 explicit smoke-only cases
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const baselineVersion = 'v1.11.0';
const candidateVersion = 'v1.12';
const benchmarkGeneration = 'v1.12';
const baselineArchive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.11.0-source.tar.gz');
const expectedBaselineSha256 =
  '7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537';
const requestedSampleCount = Number.parseInt(process.env.V112_SAMPLES || '8', 10);
const validSampleCount = Number.isFinite(requestedSampleCount) ? requestedSampleCount : 8;
const sampleCount = Math.max(8, validSampleCount + (validSampleCount & 1));
const requestedScale = Number(process.env.V112_SCALE || '0.25');
const workloadScale = Math.max(0.02, Number.isFinite(requestedScale) ? requestedScale : 0.25);
const requestedTargetMs = Number(process.env.V112_TARGET_MS || '25');
const targetBatchMs = Math.max(1, Number.isFinite(requestedTargetMs) ? requestedTargetMs : 25);
const requestedBootstraps = Number.parseInt(process.env.V112_BOOTSTRAPS || '20000', 10);
const bootstrapCount = Math.max(1000, Number.isFinite(requestedBootstraps) ? requestedBootstraps : 20000);
const caseLimit = Math.max(0, Number.parseInt(process.env.V112_CASE_LIMIT || '0', 10));
const requestedCaseIds = (process.env.V112_CASE_IDS || '')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 100);
const outputPrefix = process.env.V112_OUTPUT_PREFIX
  ? path.resolve(process.env.V112_OUTPUT_PREFIX)
  : path.join(root, 'benchmarks/results/v112-production-100');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-v112-production-'));
const baselineRoot = path.join(tempRoot, 'baseline-v1.11');
const currentBuild = path.join(tempRoot, 'current-build');
const currentAssets = path.join(tempRoot, 'current-assets');
let observableSink = 0;
const harnessPath = __filename;

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

  // A missing shared config is materialized only inside the isolated baseline
  // test/benchmark configs, but its source archive omitted their shared base.
  // Materialize the shared base config inside the isolated extraction rather
  // than inheriting the candidate tree's potentially changing compiler rules.
  const baselineBaseConfig = {
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
  fs.writeFileSync(target, `${JSON.stringify(baselineBaseConfig, null, 2)}\n`);
}

function prepareBaseline() {
  if (!fs.existsSync(baselineArchive)) {
    throw new Error(`missing exact v1.11 baseline archive: ${baselineArchive}`);
  }
  const archiveSha256 = crypto.createHash('sha256').update(fs.readFileSync(baselineArchive)).digest('hex');
  assert.equal(archiveSha256, expectedBaselineSha256, 'v1.11 baseline archive checksum');
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

function quantile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) return Number.NaN;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function bootstrapOrderBalanced(orderGroups, seed) {
  const rng = makeRng(seed);
  const firstCount = orderGroups.baselineFirst.length;
  const secondCount = orderGroups.candidateFirst.length;
  assert.ok(firstCount >= 4 && secondCount >= 4, 'bootstrap requires at least four samples/order stratum');
  const results = new Array(bootstrapCount);
  const bf = new Array(firstCount);
  const cs = new Array(firstCount);
  const cf = new Array(secondCount);
  const bs = new Array(secondCount);
  for (let bootstrap = 0; bootstrap < bootstrapCount; bootstrap++) {
    for (let i = 0; i < firstCount; i++) {
      const sample = Math.floor(rng() * firstCount);
      bf[i] = orderGroups.baselineFirst[sample];
      cs[i] = orderGroups.candidateSecond[sample];
    }
    for (let i = 0; i < secondCount; i++) {
      const sample = Math.floor(rng() * secondCount);
      cf[i] = orderGroups.candidateFirst[sample];
      bs[i] = orderGroups.baselineSecond[sample];
    }
    const firstRatio = median(bf) / median(cs);
    const secondRatio = median(bs) / median(cf);
    results[bootstrap] = Math.sqrt(firstRatio * secondRatio);
  }
  return {
    confidence: 0.95,
    resamples: bootstrapCount,
    lower: quantile(results, 0.025),
    median: quantile(results, 0.5),
    upper: quantile(results, 0.975),
  };
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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
  for (const entry of ['src', 'wasm', 'scripts', 'package.json', 'package-lock.json', 'tsconfig.json', 'tsconfig.test.json']) {
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

function filesDiffer(relativePath) {
  const baselineFile = path.join(baselineRoot, relativePath);
  const candidateFile = path.join(root, relativePath);
  if (!fs.existsSync(baselineFile) || !fs.existsSync(candidateFile)) return true;
  return sha256File(baselineFile) !== sha256File(candidateFile);
}

function sourceComparison(relativePath) {
  const baselineFile = path.join(baselineRoot, relativePath);
  const candidateFile = path.join(root, relativePath);
  return {
    path: relativePath,
    baselineSha256: fs.existsSync(baselineFile) ? sha256File(baselineFile) : null,
    candidateSha256: fs.existsSync(candidateFile) ? sha256File(candidateFile) : null,
    changed: filesDiffer(relativePath),
  };
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

  // v1.12 changes only the variant-5 batched WASM solve plus the axis-aligned
  // sphere instance writer used by drape variants 3/7. Include every variant-5
  // presentation mode and every non-tearing sphere mode; the rest are explicit
  // unchanged controls. Rain is kept off changed variant-5 cases because live
  // projectile contacts deliberately select the legacy interaction route.
  const clothScenes = [
    605, 615, 625, 635, 645,
    603, 613, 623, 633, 643,
    607, 617, 627, 637, 647,
    600, 601, 602, 604,
    610, 611, 612, 614, 618, 619,
    620, 621, 622, 624, 629,
  ];
  const changedClothSceneIds = new Set(clothScenes.filter((sceneId) => {
    const variant = (sceneId - 600) % 10;
    return variant === 5 || variant === 3 || variant === 7;
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
      rain: !changedClothSceneIds.has(sceneId) && index === clothScenes.length - 1 ? 72 : 0,
      control: !changedClothSceneIds.has(sceneId),
      fidelityLimit: 0.002,
    });
  }

  // Rope tuple-allocation candidates did not clear the stabilized focused
  // benchmark and were reverted. Keep broad rope coverage as explicit
  // unchanged controls so the tournament can still detect collateral drift.
  const ropeScenes = Array.from({ length: 25 }, (_, index) => 650 + index);
  for (let index = 0; index < ropeScenes.length; index++) {
    const sceneId = ropeScenes[index];
    const debug = [651, 653, 655, 659, 661].includes(sceneId);
    definitions.push({
      category: 'rope-wasm',
      sceneId,
      engine: 'soft',
      wasm: true,
      warmup: 12,
      iterations: 84,
      rain: index % 8 === 7 ? 96 : 0,
      debug,
      control: true,
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
      // The dynamic-index traversal candidate was rejected and fully reverted.
      // Cached dynamicCount is measured by the focused harness; complete
      // fallback frames remain unchanged controls here.
      control: true,
      fidelityLimit: 0.005,
    });
  }

  for (let index = 0; index < 10; index++) {
    definitions.push({
      category: 'effects',
      sceneId: -1,
      engine: 'effects',
      effectVariant: index,
      operation: index >= 7 ? 'effect-unchanged-frame' : 'effect-update-frame',
      warmup: 16,
      iterations: index >= 7 ? 250000 : 120,
      // v1.12 changes particle-update drag math only. Cached buildFrame calls
      // do not execute that code and therefore remain explicit controls.
      control: index >= 7 || !filesDiffer('src/effects.ts'),
      fidelityLimit: 1e-6,
    });
  }

  for (let variant = 0; variant < 10; variant++) {
    const rain = variant % 3 === 0 ? 144 : 0;
    // Variant 5 creates its own rain reservoir during construction, so it
    // exercises the changed droplet-instance writer even without this
    // harness adding more rain explicitly.
    const exercisesDropletWriter = rain > 0 || variant === 5;
    definitions.push({
      category: exercisesDropletWriter ? 'water-rain' : 'water-control',
      sceneId: 740 + variant,
      engine: 'soft',
      wasm: true,
      warmup: 15,
      iterations: 120,
      rain,
      control: !exercisesDropletWriter,
      fidelityLimit: 1e-7,
    });
  }

  const jsControls = [600, 643, 650, 699, 749];
  for (const sceneId of jsControls) {
    definitions.push({
      category: 'js-soft',
      sceneId,
      engine: 'soft',
      wasm: false,
      warmup: 12,
      iterations: 72,
      control: sceneId !== 643,
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
      // At the timer-floor safety cap this still measures 16,000 exact cached
      // frame requests per variant/sample at the release workload scale.
      iterations: 1000,
      maxRepetitions: 64,
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
    'water-rain': 5,
    'water-control': 5,
    'js-soft': 5,
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
    suite.buildFrame(Boolean(definition.debug));
  }
  return suite;
}

function softOperation(suite, definition) {
  if (definition.operation === 'unchanged-frame') {
    const frame = suite.buildFrame(Boolean(definition.debug));
    observableSink = (observableSink + frame.frameVersion + frame.instanceCount) >>> 0;
    return;
  }
  suite.step(1 / 60, 4);
  const frame = suite.buildFrame(Boolean(definition.debug));
  observableSink = (observableSink + frame.frameVersion + frame.nodeCount) >>> 0;
}

function captureSoft(suite, definition) {
  const frame = suite.buildFrame(Boolean(definition.debug));
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
  const lines = new Float32Array(frame.debugLines.length * 10);
  for (let i = 0; i < frame.debugLines.length; i++) {
    const line = frame.debugLines[i];
    const offset = i * 10;
    lines[offset] = line.ax; lines[offset + 1] = line.ay; lines[offset + 2] = line.az;
    lines[offset + 3] = line.bx; lines[offset + 4] = line.by; lines[offset + 5] = line.bz;
    lines[offset + 6] = line.r; lines[offset + 7] = line.g; lines[offset + 8] = line.b; lines[offset + 9] = line.a;
  }
  const metadata = {
    kind: frame.kind,
    nodes: frame.nodeCount,
    constraints: frame.constraintCount,
    broken: frame.brokenCount,
    instances: frame.instanceCount,
    ropeSegments: frame.ropeGrid?.segmentCount || 0,
    lineCount: frame.debugLines.length,
    hash: suite.hash() >>> 0,
  };
  return {
    ...metadata,
    state,
    matrices,
    colors,
    ropePositions,
    lines,
    finite: finiteArray(state) && finiteArray(matrices) && finiteArray(colors) && finiteArray(ropePositions) && finiteArray(lines),
    fingerprint: hashTypedArrays([state, matrices, colors, ropePositions, lines], metadata),
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
  if (definition.operation === 'effect-unchanged-frame') effects.buildFrame(budget);
  return effects;
}

function effectsOperation(effects, definition) {
  if (definition.operation !== 'effect-unchanged-frame') effects.update(1 / 60);
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

function measureSingle(project, definition, collectGarbage = true) {
  let subject;
  let operation;
  let capture;
  let destroy;
  if (definition.engine === 'soft') {
    subject = setupSoft(project, definition);
    operation = () => softOperation(subject, definition);
    capture = () => captureSoft(subject, definition);
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
  const unchangedOperation = definition.operation === 'unchanged-frame' ||
    definition.operation === 'effect-unchanged-frame';
  const before = unchangedOperation ? capture() : null;
  if (collectGarbage) global.gc?.();
  const started = performance.now();
  for (let i = 0; i < iterations; i++) operation();
  const elapsed = performance.now() - started;
  const result = capture();
  destroy();
  return {
    ms: elapsed / iterations,
    elapsedMs: elapsed,
    iterations,
    capture: result,
    beforeFingerprint: before?.fingerprint || null,
    withinRunExact: before ? before.fingerprint === result.fingerprint : null,
  };
}

function calibrateRepetitions(baseline, candidate, definition) {
  const baselinePilot = measureSingle(baseline, definition);
  const candidatePilot = measureSingle(candidate, definition);
  const fastestElapsed = Math.max(0.000001, Math.min(baselinePilot.elapsedMs, candidatePilot.elapsedMs));
  // A 25% safety margin absorbs JIT/GC pilot variance without changing the
  // simulated horizon inside an individual deterministic repetition.
  const safetyCap = definition.maxRepetitions ?? 512;
  let repetitions = Math.max(1, Math.min(safetyCap, Math.ceil(targetBatchMs / (fastestElapsed * 0.75))));
  const adaptiveTrials = [];
  // Cold pilots can overestimate hot V8 work by several times. Prime both
  // subjects with the proposed complete batch, then grow it from observed
  // hot timings. Two corrections plus a 25% margin keep release samples near
  // the requested floor without allowing unbounded setup amplification.
  for (let pass = 0; pass < 2; pass++) {
    const baselineTrial = measureBatch(baseline, definition, repetitions);
    const candidateTrial = measureBatch(candidate, definition, repetitions);
    const fastestTrialMs = Math.max(0.000001, Math.min(baselineTrial.elapsedMs, candidateTrial.elapsedMs));
    adaptiveTrials.push({
      repetitions,
      baselineElapsedMs: baselineTrial.elapsedMs,
      candidateElapsedMs: candidateTrial.elapsedMs,
      fastestElapsedMs: fastestTrialMs,
    });
    if (fastestTrialMs >= targetBatchMs * 1.1 || repetitions === safetyCap) break;
    const growth = Math.max(1.1, (targetBatchMs * 1.25) / fastestTrialMs);
    const next = Math.min(safetyCap, Math.max(repetitions + 1, Math.ceil(repetitions * growth)));
    if (next === repetitions) break;
    repetitions = next;
  }
  return {
    repetitions,
    safetyCap,
    baselinePilotElapsedMs: baselinePilot.elapsedMs,
    candidatePilotElapsedMs: candidatePilot.elapsedMs,
    estimatedBaselineBatchMs: baselinePilot.elapsedMs * repetitions,
    estimatedCandidateBatchMs: candidatePilot.elapsedMs * repetitions,
    adaptiveTrials,
  };
}

function measureBatch(project, definition, repetitions) {
  let elapsedMs = 0;
  let operationCount = 0;
  let capture = null;
  let beforeFingerprint = null;
  let withinRunExact = null;
  let deterministicFingerprint = null;
  let repeatedSetupDeterministic = true;
  global.gc?.();
  for (let repeat = 0; repeat < repetitions; repeat++) {
    if (repeat > 0 && repeat % 32 === 0) global.gc?.();
    const measured = measureSingle(project, definition, false);
    elapsedMs += measured.elapsedMs;
    operationCount += measured.iterations;
    capture ??= measured.capture;
    beforeFingerprint ??= measured.beforeFingerprint;
    if (measured.withinRunExact !== null) {
      withinRunExact = withinRunExact === null
        ? measured.withinRunExact
        : withinRunExact && measured.withinRunExact;
    }
    if (deterministicFingerprint === null) deterministicFingerprint = measured.capture.fingerprint;
    else repeatedSetupDeterministic = repeatedSetupDeterministic &&
      deterministicFingerprint === measured.capture.fingerprint;
  }
  return {
    ms: elapsedMs / operationCount,
    elapsedMs,
    iterations: operationCount,
    repetitions,
    capture,
    beforeFingerprint,
    withinRunExact,
    repeatedSetupDeterministic,
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
  const lineError = baseline.lines || current.lines ? maxAbs(baseline.lines, current.lines) : 0;
  const sameBreakCount = baseline.broken === current.broken;
  const sameCounts = definition.engine === 'soft'
    ? baseline.nodes === current.nodes && baseline.instances === current.instances &&
      baseline.ropeSegments === current.ropeSegments && baseline.lineCount === current.lineCount
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

function decisionFor(definition, correctness, speedup, confidence, orderBalanced) {
  if (!correctness) return 'rejected-correctness';
  if (definition.control) return 'control';
  const bothOrdersNonRegressive = orderBalanced.baselineFirstRatio >= 0.98 &&
    orderBalanced.candidateFirstRatio >= 0.98;
  if (speedup >= 1.03 && confidence.lower > 1 && bothOrdersNonRegressive) return 'accepted';
  if (speedup >= 0.98 || confidence.upper >= 1) return 'borderline';
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
    `${result.smokeMode ? 'Smoke subset' : 'Exactly'} **${result.caseCount}** cases, **${result.samples}** timed samples per variant/case, with an equal number of both execution orders.`,
    '',
    `Baseline archive SHA-256: \`${result.baselineArchiveSha256}\`.`,
    '',
    `Candidate source digest: \`${result.candidateSourceDigest.sha256}\` (${result.candidateSourceDigest.fileCount} files).`,
    '',
    `Harness digest: \`${result.harnessSha256}\`.`,
    '',
    '## Summary',
    '',
    `- Accepted wins: **${result.summary.accepted}**`,
    `- Borderline: **${result.summary.borderline}**`,
    `- Rejected, no win: **${result.summary.rejectedNoWin}**`,
    `- Rejected, correctness: **${result.summary.rejectedCorrectness}**`,
    `- Controls: **${result.summary.controls}**`,
    `- Cases whose minimum observed batch met ${result.targetBatchMs} ms: **${result.summary.batchTargetMetCases}/${result.caseCount}** (${result.summary.batchRepeatCapCases} reached the repeat cap)`,
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
    '| # | Category | Scene | Baseline ms | Candidate ms | Speedup | 95% CI | Batch reps | State L2 | Deterministic | Decision |',
    '|---:|---|---|---:|---:|---:|---:|---:|---:|---|---|',
  );
  for (const record of result.records) {
    lines.push(
      `| ${record.id} | ${record.category} | ${record.sceneTitle.replace(/\|/g, '\\|')} | ` +
      `${record.baselineMedianMs.toFixed(6)} | ${record.candidateMedianMs.toFixed(6)} | ` +
      `${record.speedup.toFixed(4)}x | ${record.confidence.lower.toFixed(3)}–${record.confidence.upper.toFixed(3)} | ` +
      `${record.calibration.repetitions} | ${record.correctness.stateError.toExponential(3)} | ` +
      `${record.baselineDeterministic && record.candidateDeterministic ? 'yes' : 'NO'} | ${record.decision} |`,
    );
  }
  lines.push(
    '',
    '## Gates',
    '',
    '- Every timed sample starts from the same scene, seed, stress, and action setup.',
    '- Every case has an equal number of baseline-first and candidate-first samples.',
    '- Reported speedup is the geometric mean of the two order-stratified median ratios.',
    '- Every non-control acceptance requires a >1.00 lower bound from a deterministic 95% order-stratified bootstrap and non-regression in both order strata.',
    `- Timed batches are calibrated toward at least ${result.targetBatchMs} ms per implementation where each case's declared repeat safety cap permits it.`,
    '- Medians and median absolute deviations are retained in JSON.',
    '- All authoritative state and render streams must remain finite.',
    '- Node/body/instance counts and soft-system break counts must match.',
    '- Cross-version state bounds are domain-specific: cloth 0.2%, rope 0.05%, water 1e-7, and fallback 0.5%.',
    '- Every unchanged control must have an exact before/after fingerprint independently inside both implementations.',
    '- JavaScript controls retain their strict control thresholds.',
    '- Each implementation must reproduce an identical result fingerprint across its samples.',
    '- Exact baseline archive, candidate source-tree, and benchmark-harness digests are recorded and source stability is asserted at the end.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

async function main() {
  const harnessSha256AtStart = sha256File(harnessPath);
  prepareBaseline();
  prepareCurrent();
  assert.ok(filesDiffer('src/soft/simulations.ts'), 'v1.12 soft source must differ from exact v1.11');
  assert.equal(filesDiffer('src/physics/fallback.ts'), false, 'rejected fallback candidates must remain fully reverted');
  const baselineSource = sourceDigest(baselineRoot);
  const candidateSourceAtStart = sourceDigest(root);
  const baseline = loadProject(
    baselineRoot,
    path.join(baselineRoot, '.test-build'),
    baselineRoot,
    baselineVersion,
  );
  const candidate = loadProject(root, currentBuild, currentAssets, 'working-tree');
  const allDefinitions = makeDefinitions();
  const smokeMode = caseLimit > 0 || requestedCaseIds.length > 0;
  const definitions = requestedCaseIds.length > 0
    ? allDefinitions.filter((definition) => requestedCaseIds.includes(definition.id))
    : smokeMode ? allDefinitions.slice(0, Math.min(caseLimit, 100)) : allDefinitions;
  const records = [];
  const started = performance.now();

  for (let index = 0; index < definitions.length; index++) {
    const definition = definitions[index];
    const baselineTimes = [];
    const candidateTimes = [];
    const baselineBatchElapsedMs = [];
    const candidateBatchElapsedMs = [];
    const baselineCaptures = [];
    const candidateCaptures = [];
    const baselineWithinRunExactSamples = [];
    const candidateWithinRunExactSamples = [];
    const baselineRepeatedSetupDeterministicSamples = [];
    const candidateRepeatedSetupDeterministicSamples = [];
    const orderGroups = {
      baselineFirst: [],
      baselineSecond: [],
      candidateFirst: [],
      candidateSecond: [],
    };
    const calibration = calibrateRepetitions(baseline, candidate, definition);
    for (let sample = 0; sample < sampleCount; sample++) {
      const baselineRunsFirst = ((index + sample) & 1) === 0;
      const order = baselineRunsFirst ? [baseline, candidate] : [candidate, baseline];
      for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
        const project = order[orderIndex];
        const measured = measureBatch(project, definition, calibration.repetitions);
        if (project === baseline) {
          baselineTimes.push(measured.ms);
          baselineBatchElapsedMs.push(measured.elapsedMs);
          baselineCaptures.push(measured.capture);
          baselineWithinRunExactSamples.push(measured.withinRunExact);
          baselineRepeatedSetupDeterministicSamples.push(measured.repeatedSetupDeterministic);
          orderGroups[orderIndex === 0 ? 'baselineFirst' : 'baselineSecond'].push(measured.ms);
        } else {
          candidateTimes.push(measured.ms);
          candidateBatchElapsedMs.push(measured.elapsedMs);
          candidateCaptures.push(measured.capture);
          candidateWithinRunExactSamples.push(measured.withinRunExact);
          candidateRepeatedSetupDeterministicSamples.push(measured.repeatedSetupDeterministic);
          orderGroups[orderIndex === 0 ? 'candidateFirst' : 'candidateSecond'].push(measured.ms);
        }
      }
    }

    const baselineMedian = median(baselineTimes);
    const candidateMedian = median(candidateTimes);
    const pooledSpeedup = baselineMedian / candidateMedian;
    const orderBalanced = orderBalancedSpeedup(orderGroups);
    const confidence = bootstrapOrderBalanced(orderGroups, (0x11200000 + definition.id) >>> 0);
    const speedup = orderBalanced.speedup;
    const baselineDeterministic = deterministic(baselineCaptures) &&
      baselineRepeatedSetupDeterministicSamples.every(Boolean);
    const candidateDeterministic = deterministic(candidateCaptures) &&
      candidateRepeatedSetupDeterministicSamples.every(Boolean);
    const isUnchangedControl = definition.operation === 'unchanged-frame' ||
      definition.operation === 'effect-unchanged-frame';
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
    const decision = decisionFor(definition, correctness.correct, speedup, confidence, orderBalanced);
    const sceneTitle = definition.sceneId >= 0
      ? baseline.SCENES[definition.sceneId].title
      : `Cinematic effects variant ${definition.effectVariant + 1}`;
    const record = {
      ...definition,
      sceneTitle,
      baselineSamplesMs: baselineTimes,
      candidateSamplesMs: candidateTimes,
      baselineBatchElapsedMs,
      candidateBatchElapsedMs,
      minimumTimedBatchMs: Math.min(...baselineBatchElapsedMs, ...candidateBatchElapsedMs),
      baselineMedianMs: baselineMedian,
      candidateMedianMs: candidateMedian,
      baselineMadMs: mad(baselineTimes),
      candidateMadMs: mad(candidateTimes),
      calibration,
      pooledSpeedup,
      orderBalanced,
      confidence,
      speedup,
      baselineDeterministic,
      candidateDeterministic,
      baselineWithinRunExactSamples,
      candidateWithinRunExactSamples,
      baselineRepeatedSetupDeterministicSamples,
      candidateRepeatedSetupDeterministicSamples,
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
      `${String(definition.id).padStart(3, '0')}/${String(definitions.length).padStart(3, '0')} ` +
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
  const candidateSourceAtEnd = sourceDigest(root);
  const harnessSha256AtEnd = sha256File(harnessPath);
  assert.deepEqual(candidateSourceAtEnd, candidateSourceAtStart, 'candidate source changed during benchmark');
  assert.equal(harnessSha256AtEnd, harnessSha256AtStart, 'benchmark harness changed during benchmark');
  const result = {
    schemaVersion: 4,
    generatedAt: new Date().toISOString(),
    baseline: `${baselineVersion} exact source archive`,
    candidate: `${candidateVersion} working tree`,
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpu: {
      model: os.cpus()[0]?.model || 'unknown',
      logicalCores: os.cpus().length,
    },
    baselineArchive: path.relative(root, baselineArchive),
    baselineArchiveSha256: expectedBaselineSha256,
    baselineSourceDigest: baselineSource,
    candidateSourceDigest: candidateSourceAtStart,
    candidateSourceDigestAtEnd: candidateSourceAtEnd,
    harnessSha256: harnessSha256AtStart,
    harnessSha256AtEnd,
    sourceStableDuringRun: true,
    harnessStableDuringRun: true,
    auditedRuntimeSourceFiles: [
      sourceComparison('src/math.ts'),
      sourceComparison('src/effects.ts'),
      sourceComparison('src/physics/fallback.ts'),
      sourceComparison('src/soft/simulations.ts'),
      sourceComparison('wasm/box3d_web.c'),
    ],
    smokeMode,
    caseCount: records.length,
    samples: sampleCount,
    workloadScale,
    targetBatchMs,
    bootstrapCount,
    elapsedSeconds: (performance.now() - started) / 1000,
    observableSink,
    methodology: {
      order: 'equal baseline-first and candidate-first samples for every case',
      statistic: 'median and median absolute deviation',
      speedup: 'geometric mean of the two order-stratified median ratios',
      confidence: 'deterministic 95% stratified bootstrap over the two execution-order strata',
      timing: `production operations after warmup; independent deterministic batches calibrated toward >=${targetBatchMs} ms; setup, capture, and process startup excluded`,
      determinism: 'SHA-256 fingerprint of authoritative numeric streams and structural metadata across every sample',
      changedPathMap: {
        cloth: 'variant 5 batched WASM solve; variants 3/7 axis-aligned sphere stream',
        rope: 'unchanged control; allocation-free tuple candidates were benchmarked separately and reverted after failing the confidence gate',
        fallback: 'rejected cached-count and traversal candidates were fully reverted; all fallback frames are v1.11-exact controls',
        effects: filesDiffer('src/effects.ts') ? 'five exact built-in particle drag factors are computed once per update instead of once per particle' : 'unchanged control',
        water: 'rain/drop cases exercise axis-aligned droplet stream; dry cases are controls',
        native: 'source changed but excluded from this TS/WASM-soft tournament; require dedicated rebuilt upstream Box3D benchmark',
      },
    },
    summary: {
      accepted: records.filter((record) => record.decision === 'accepted').length,
      borderline: records.filter((record) => record.decision === 'borderline').length,
      rejectedNoWin: records.filter((record) => record.decision === 'rejected-no-win').length,
      rejectedCorrectness: records.filter((record) => record.decision === 'rejected-correctness').length,
      controls: records.filter((record) => record.decision === 'control').length,
      batchTargetMetCases: records.filter((record) => record.minimumTimedBatchMs >= targetBatchMs).length,
      batchRepeatCapCases: records.filter((record) => record.calibration.repetitions === record.calibration.safetyCap).length,
      minimumTimedBatchMs: Math.min(...records.map((record) => record.minimumTimedBatchMs)),
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
      unchangedGroupCount: records.filter((record) =>
        record.operation === 'unchanged-frame' || record.operation === 'effect-unchanged-frame').length * 2,
    },
    categories,
    records,
  };
  if (!smokeMode) assert.equal(result.caseCount, 100, 'release result must contain exactly 100 cases');
  fs.mkdirSync(path.dirname(outputPrefix), { recursive: true });
  fs.writeFileSync(`${outputPrefix}.json`, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(`${outputPrefix}.md`, markdownReport(result));
  console.log(`wrote ${outputPrefix}.json`);
  console.log(`wrote ${outputPrefix}.md`);
  if (result.summary.rejectedCorrectness > 0 ||
      result.summary.deterministicGroups !== result.caseCount * 2) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.env.V112_KEEP_TEMP === '1') {
      console.error(`kept temporary benchmark trees: ${tempRoot}`);
    } else {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
