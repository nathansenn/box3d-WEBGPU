'use strict';

/*
 * WebPhysics v1.13 exact 1,000-case production tournament, shard runner.
 *
 * Release execution is intentionally ten sequential fresh processes:
 *
 *   for shard in {1..10}; do
 *     V113_SHARD=$shard node --expose-gc benchmarks/v113-production-1000.cjs
 *   done
 *   node scripts/check-v1.13-results.mjs --merge
 *
 * Tiny smoke execution (never valid release evidence):
 *
 *   V113_SMOKE=1 V113_SHARD=7 V113_CASE_IDS=601 \
 *     V113_OUTPUT_PREFIX=/tmp/v113-smoke \
 *     node --expose-gc benchmarks/v113-production-1000.cjs
 *
 * Release environment:
 *   V113_SHARD=1..10       exactly one 100-case shard
 *   V113_SAMPLES=8         even samples, at least eight outside smoke mode
 *   V113_TARGET_MS=25      minimum target timed batch
 *   V113_BOOTSTRAPS=20000 deterministic stratified bootstrap resamples
 *   V113_SCALE=1           semantic horizon scale; release gate requires 1
 *   V113_KEEP_TEMP=1       preserve isolated source/build trees
 *
 * Prospective material-control confirmation (launched only by --merge):
 *   V113_CONFIRM=1
 *   V113_CONFIRM_CASE_ID=812
 *   V113_CONFIRM_RUN=1      one of eight independent processes
 *   V113_CONFIRM_TOKEN=...  parent-issued unique invocation token
 *
 * Smoke-only environment:
 *   V113_SMOKE=1
 *   V113_CASE_IDS=601,602
 *   V113_CASE_LIMIT=1
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const {
  GROUPS,
  makeRegistry,
  registryDigest,
  stableStringify,
} = require('./v113-production-1000-registry.cjs');

const root = path.resolve(__dirname, '..');
const generation = 'v1.13';
const baselineVersion = 'v1.12.0';
const baselineArchive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.12.0-source.tar.gz');
const expectedBaselineSha256 = '33d7fc828fdea54e087f25815bcdabd8f9608fcda6912e1e5c7dd57139534c67';
const registryPath = path.join(root, 'benchmarks/v113-production-1000-registry.cjs');
const checkerPath = path.join(root, 'scripts/check-v1.13-results.mjs');
const harnessPath = __filename;
const smokeMode = process.env.V113_SMOKE === '1';
const confirmationMode = process.env.V113_CONFIRM === '1';
assert.equal(smokeMode && confirmationMode, false, 'smoke and confirmation modes are mutually exclusive');
const confirmationCaseId = Number.parseInt(process.env.V113_CONFIRM_CASE_ID || '0', 10);
const confirmationRunIndex = Number.parseInt(process.env.V113_CONFIRM_RUN || '0', 10);
const confirmationParentToken = process.env.V113_CONFIRM_TOKEN || '';
if (confirmationMode) {
  assert.ok(Number.isInteger(confirmationCaseId) && confirmationCaseId >= 1 && confirmationCaseId <= 1000,
    'V113_CONFIRM_CASE_ID must be 1..1000');
  assert.ok(Number.isInteger(confirmationRunIndex) && confirmationRunIndex >= 1 && confirmationRunIndex <= 8,
    'V113_CONFIRM_RUN must be 1..8');
  assert.match(confirmationParentToken, /^[0-9a-f]{32,64}$/,
    'V113_CONFIRM_TOKEN must be a unique hexadecimal parent token');
}
const requestedShard = Number.parseInt(process.env.V113_SHARD || '1', 10);
assert.ok(Number.isInteger(requestedShard) && requestedShard >= 1 && requestedShard <= 10, 'V113_SHARD must be 1..10');

const requestedSamples = Number.parseInt(process.env.V113_SAMPLES || (smokeMode ? '2' : '8'), 10);
const normalizedSamples = Number.isFinite(requestedSamples) ? requestedSamples : (smokeMode ? 2 : 8);
const sampleCount = smokeMode
  ? Math.max(2, normalizedSamples + (normalizedSamples & 1))
  : Math.max(8, normalizedSamples + (normalizedSamples & 1));
const requestedTargetMs = Number(process.env.V113_TARGET_MS || (smokeMode ? '1' : '25'));
const targetBatchMs = Math.max(smokeMode ? 0.25 : 25, Number.isFinite(requestedTargetMs) ? requestedTargetMs : 25);
const requestedBootstraps = Number.parseInt(process.env.V113_BOOTSTRAPS || (smokeMode ? '1000' : '20000'), 10);
const bootstrapCount = Math.max(smokeMode ? 250 : 20000, Number.isFinite(requestedBootstraps) ? requestedBootstraps : 20000);
const requestedScale = Number(process.env.V113_SCALE || (smokeMode ? '0.08' : '1'));
const workloadScale = Math.max(smokeMode ? 0.04 : 1, Number.isFinite(requestedScale) ? requestedScale : 1);
const caseLimit = Math.max(0, Number.parseInt(process.env.V113_CASE_LIMIT || '0', 10));
const caseIds = (process.env.V113_CASE_IDS || '')
  .split(',')
  .map((value) => Number.parseInt(value.trim(), 10))
  .filter((value) => Number.isInteger(value) && value >= 1 && value <= 1000);
if (!smokeMode) {
  assert.equal(caseLimit, 0, 'V113_CASE_LIMIT is smoke-only');
  assert.equal(caseIds.length, 0, 'V113_CASE_IDS is smoke-only');
}
if (confirmationMode) {
  assert.ok(sampleCount >= 8 && sampleCount % 2 === 0,
    'control confirmation requires at least four balanced AB/BA samples');
  assert.ok(targetBatchMs >= 25, 'control confirmation target must be at least 25 ms');
  assert.equal(workloadScale, 1, 'control confirmation must use semantic workload scale 1');
}

const defaultPrefix = confirmationMode
  ? path.join(root, 'benchmarks/results',
    `v113-control-confirmation-case-${String(confirmationCaseId).padStart(4, '0')}-run-${String(confirmationRunIndex).padStart(2, '0')}`)
  : smokeMode
    ? path.join(root, `benchmarks/results/diagnostics/v113-smoke-shard-${String(requestedShard).padStart(2, '0')}`)
    : path.join(root, `benchmarks/results/v113-production-1000-shard-${String(requestedShard).padStart(2, '0')}`);
const outputPrefix = process.env.V113_OUTPUT_PREFIX
  ? path.resolve(process.env.V113_OUTPUT_PREFIX)
  : defaultPrefix;
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), confirmationMode
  ? `webphysics-v113-confirm-${confirmationCaseId}-${confirmationRunIndex}-`
  : `webphysics-v113-shard-${requestedShard}-`));
const baselineRoot = path.join(tempRoot, 'baseline-v1.12');
const currentBuild = path.join(tempRoot, 'candidate-build');
const currentAssets = path.join(tempRoot, 'candidate-assets');
let observableSink = 0;

const SOURCE_ROOTS = [
  'src',
  'wasm',
  'scripts',
  'public/box3d',
  'public/textures',
  'public/soft-kernels-simd.wasm',
  'public/soft-kernels-scalar.wasm',
  'package.json',
  'package-lock.json',
  'tsconfig.json',
  'tsconfig.test.json',
  'tsconfig.benchmark.json',
  'vite.config.ts',
  'index.html',
];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    const detail = [result.stdout, result.stderr].filter(Boolean).join('\n');
    throw new Error(`${command} ${args.join(' ')} failed with status ${result.status}\n${detail}`);
  }
  return result;
}

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
    for (const entry of fs.readdirSync(absolute).sort()) {
      listFiles(base, path.join(relativePath, entry), output);
    }
    return;
  }
  output.push(relativePath.split(path.sep).join('/'));
}

function manifest(base, roots = SOURCE_ROOTS) {
  const files = [];
  for (const entry of roots) listFiles(base, entry, files);
  const entries = [...new Set(files)].sort().map((relativePath) => {
    const absolute = path.join(base, relativePath);
    return {
      path: relativePath,
      bytes: fs.statSync(absolute).size,
      sha256: sha256File(absolute),
    };
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
  const files = [harnessPath, registryPath, checkerPath].map((filePath) => ({
    path: path.relative(root, filePath).split(path.sep).join('/'),
    bytes: fs.statSync(filePath).size,
    sha256: sha256File(filePath),
  }));
  return { files, sha256: sha256Buffer(Buffer.from(stableStringify(files))) };
}

function artifactIdentity(projectRoot, rebuiltAssetRoot = projectRoot) {
  const relativeFiles = [
    'public/box3d/box3d.js',
    'public/box3d/box3d.wasm',
    'public/box3d/BUILD_PROVENANCE.json',
    'wasm/box3d_web.c',
    'wasm/soft_kernels.c',
    'public/soft-kernels-simd.wasm',
    'public/soft-kernels-scalar.wasm',
  ];
  const files = relativeFiles.map((relativePath) => {
    const sourceRoot = relativePath.startsWith('public/soft-kernels-') ? rebuiltAssetRoot : projectRoot;
    const absolute = path.join(sourceRoot, relativePath);
    return fs.existsSync(absolute)
      ? { path: relativePath, bytes: fs.statSync(absolute).size, sha256: sha256File(absolute) }
      : { path: relativePath, bytes: null, sha256: null };
  });
  let provenance = null;
  let provenanceValid = false;
  const provenancePath = path.join(projectRoot, 'public/box3d/BUILD_PROVENANCE.json');
  if (fs.existsSync(provenancePath)) {
    provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
    const byPath = new Map(files.map((entry) => [entry.path, entry]));
    provenanceValid = ['box3d.js', 'box3d.wasm'].every((name) => {
      const actual = byPath.get(`public/box3d/${name}`);
      return actual?.sha256 === provenance.artifacts?.[name]?.sha256 &&
        actual?.bytes === provenance.artifacts?.[name]?.bytes;
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
  const passed = files.every((entry) => entry.exists && entry.fresh) &&
    rigid?.result === 'passed' && rigid?.dawnBackend === 'metal' && rigid?.uncapturedWebGpuErrors === 0 &&
    rigid?.actualGpuQueueUploadBytes?.settledUnchanged === 0 &&
    cache?.dawnBackend === 'metal' && cache?.cachedUploadedBytes === 0 &&
    String(startup?.environment?.backend).toLowerCase() === 'metal';
  return {
    rendererSha256,
    files,
    passed,
    sha256: sha256Buffer(Buffer.from(stableStringify(files.map(({ json, ...entry }) => entry)))),
  };
}

function writeCommonJsPackage(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"commonjs"}\n');
}

function ensureBaselineBaseTsconfig() {
  const filePath = path.join(baselineRoot, 'tsconfig.json');
  if (fs.existsSync(filePath)) return;
  const config = {
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
      skipLibCheck: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], noEmit: true,
    },
    include: ['src'],
  };
  fs.writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`);
}

function transpileBenchModule(projectRoot, buildRoot, relativePath, transform = (source) => source, emitted = new Set()) {
  const ts = require(path.join(root, 'node_modules/typescript'));
  const inputPath = path.join(projectRoot, relativePath);
  if (emitted.has(inputPath)) return;
  emitted.add(inputPath);
  const outputPath = path.join(buildRoot, relativePath.replace(/\.ts$/, '.js'));
  const source = transform(fs.readFileSync(inputPath, 'utf8'));
  const compilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    esModuleInterop: true,
  };
  const transpiled = ts.transpileModule(source, {
    fileName: inputPath,
    compilerOptions,
    reportDiagnostics: true,
  });
  const errors = (transpiled.diagnostics || []).filter((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error);
  assert.equal(errors.length, 0, `failed to transpile ${relativePath}: ${errors.map((entry) => entry.messageText).join('; ')}`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, transpiled.outputText);

  // Follow only dependencies that survived TypeScript erasure. Resolve from
  // projectRoot so an archived baseline never borrows current implementation.
  for (const dependency of ts.preProcessFile(transpiled.outputText, true, true).importedFiles) {
    if (!dependency.fileName.startsWith('.')) continue;
    const resolved = ts.resolveModuleName(dependency.fileName, inputPath, compilerOptions, ts.sys).resolvedModule;
    assert.ok(resolved && !resolved.isExternalLibraryImport && !resolved.resolvedFileName.endsWith('.d.ts'),
      `unable to resolve runtime dependency ${dependency.fileName} of ${relativePath}`);
    const dependencyPath = path.relative(projectRoot, resolved.resolvedFileName);
    assert.ok(!path.isAbsolute(dependencyPath) && dependencyPath !== '..' && !dependencyPath.startsWith(`..${path.sep}`),
      `runtime dependency escaped projectRoot: ${dependency.fileName}`);
    transpileBenchModule(projectRoot, buildRoot, dependencyPath, undefined, emitted);
  }
}

function prepareBenchModules(projectRoot, buildRoot) {
  const emitted = new Set();
  for (const relativePath of ['src/camera.ts', 'src/frame-lines.ts', 'src/assets/ktx2.ts', 'src/webgpu/renderer.ts']) {
    transpileBenchModule(projectRoot, buildRoot, relativePath, undefined, emitted);
  }
  transpileBenchModule(projectRoot, buildRoot, 'src/physics/wasm.ts', (source) => {
    const classEnd = source.indexOf('\nfunction publicAsset');
    assert.ok(classEnd > 0, 'unable to isolate WasmPhysicsBackend');
    return source.slice(0, classEnd).replace('class WasmPhysicsBackend', 'export class WasmPhysicsBackend');
  }, emitted);
}

function prepareBaseline() {
  assert.ok(fs.existsSync(baselineArchive), `missing v1.12 archive: ${baselineArchive}`);
  assert.equal(sha256File(baselineArchive), expectedBaselineSha256, 'v1.12 archive SHA-256 changed');
  fs.mkdirSync(baselineRoot, { recursive: true });
  run('tar', ['-xzf', baselineArchive, '-C', baselineRoot]);
  ensureBaselineBaseTsconfig();
  const modulesPath = path.join(baselineRoot, 'node_modules');
  fs.rmSync(modulesPath, { recursive: true, force: true });
  fs.symlinkSync(path.join(root, 'node_modules'), modulesPath, process.platform === 'win32' ? 'junction' : 'dir');
  run(path.join(root, 'node_modules/.bin/tsc'), [
    '-p', path.join(baselineRoot, 'tsconfig.test.json'),
    '--outDir', path.join(baselineRoot, '.test-build'),
  ], { cwd: baselineRoot });
  writeCommonJsPackage(path.join(baselineRoot, '.test-build'));
  prepareBenchModules(baselineRoot, path.join(baselineRoot, '.test-build'));
  const packaged = {
    simd: sha256File(path.join(baselineRoot, 'public/soft-kernels-simd.wasm')),
    scalar: sha256File(path.join(baselineRoot, 'public/soft-kernels-scalar.wasm')),
  };
  run('bash', [path.join(baselineRoot, 'scripts/build-soft-kernels.sh')], { cwd: baselineRoot });
  assert.equal(sha256File(path.join(baselineRoot, 'public/soft-kernels-simd.wasm')), packaged.simd,
    'v1.12 SIMD kernel did not rebuild byte-identically');
  assert.equal(sha256File(path.join(baselineRoot, 'public/soft-kernels-scalar.wasm')), packaged.scalar,
    'v1.12 scalar kernel did not rebuild byte-identically');
}

function prepareCandidate() {
  run(path.join(root, 'node_modules/.bin/tsc'), [
    '-p', path.join(root, 'tsconfig.test.json'), '--outDir', currentBuild,
  ], { cwd: root });
  writeCommonJsPackage(currentBuild);
  prepareBenchModules(root, currentBuild);
  fs.mkdirSync(path.join(currentAssets, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(currentAssets, 'wasm'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts/build-soft-kernels.sh'), path.join(currentAssets, 'scripts/build-soft-kernels.sh'));
  fs.copyFileSync(path.join(root, 'wasm/soft_kernels.c'), path.join(currentAssets, 'wasm/soft_kernels.c'));
  fs.chmodSync(path.join(currentAssets, 'scripts/build-soft-kernels.sh'), 0o755);
  run('bash', [path.join(currentAssets, 'scripts/build-soft-kernels.sh')], { cwd: currentAssets });
}

async function loadNativeModule(projectRoot, tag) {
  const artifactDir = path.join(projectRoot, 'public/box3d');
  const jsPath = path.join(artifactDir, 'box3d.js');
  const wasmPath = path.join(artifactDir, 'box3d.wasm');
  const imported = await import(`${pathToFileURL(jsPath).href}?v113=${tag}-${Date.now()}`);
  const mod = await imported.default({
    wasmBinary: fs.readFileSync(wasmPath),
    print() {},
    printErr() {},
  });
  const symbols = [
    '_b3w_create_scene', '_b3w_destroy', '_b3w_body_count', '_b3w_dynamic_count',
    '_b3w_matrices_ptr', '_b3w_colors_ptr', '_b3w_max_bodies', '_b3w_sync_transforms',
    '_b3w_step', '_b3w_explode', '_b3w_kick_stack', '_b3w_launch_projectile',
    '_b3w_spawn_rain', '_b3w_replay_hash', '_b3w_awake_count',
    '_b3w_transform_version', '_b3w_color_version',
  ];
  for (const symbol of symbols) assert.equal(typeof mod[symbol], 'function', `${tag} missing ${symbol}`);
  return mod;
}

async function loadProject(projectRoot, buildRoot, assetRoot, tag, needNative) {
  const { SCENES } = require(path.join(buildRoot, 'src/scenes.js'));
  const { SoftSimulationSuite } = require(path.join(buildRoot, 'src/soft/simulations.js'));
  const { SoftKernelModule } = require(path.join(buildRoot, 'src/soft/kernels.js'));
  const { FallbackPhysicsBackend } = require(path.join(buildRoot, 'src/physics/fallback.js'));
  const { CinematicEffects } = require(path.join(buildRoot, 'src/effects.js'));
  const { CameraMatrixCache } = require(path.join(buildRoot, 'src/camera.js'));
  const { FrameLineStager } = require(path.join(buildRoot, 'src/frame-lines.js'));
  const { WasmPhysicsBackend } = require(path.join(buildRoot, 'src/physics/wasm.js'));
  const { WebGPURenderer } = require(path.join(buildRoot, 'src/webgpu/renderer.js'));
  const kernelBytes = fs.readFileSync(path.join(assetRoot, 'public/soft-kernels-simd.wasm'));
  const compiledKernel = new WebAssembly.Module(kernelBytes);
  return {
    tag,
    SCENES,
    SoftSimulationSuite,
    SoftKernelModule,
    FallbackPhysicsBackend,
    CinematicEffects,
    CameraMatrixCache,
    FrameLineStager,
    WasmPhysicsBackend,
    WebGPURenderer,
    native: needNative ? await loadNativeModule(projectRoot, tag) : null,
    createSoftSuite() {
      const instance = new WebAssembly.Instance(compiledKernel, {});
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
  return finite.length === 0 ? 0 : Math.exp(finite.reduce((sum, value) => sum + Math.log(value), 0) / finite.length);
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

function shuffled(values, seed) {
  const output = [...values];
  const random = rng(seed);
  for (let index = output.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [output[index], output[other]] = [output[other], output[index]];
  }
  return output;
}

function orderGroupsFromSamples(samples) {
  return {
    baselineFirst: samples.filter((sample) => sample.order === 'AB').map((sample) => sample.baseline.msPerOperation),
    candidateSecond: samples.filter((sample) => sample.order === 'AB').map((sample) => sample.candidate.msPerOperation),
    candidateFirst: samples.filter((sample) => sample.order === 'BA').map((sample) => sample.candidate.msPerOperation),
    baselineSecond: samples.filter((sample) => sample.order === 'BA').map((sample) => sample.baseline.msPerOperation),
  };
}

function orderBalancedStatistics(samples) {
  const groups = orderGroupsFromSamples(samples);
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

function bootstrap(samples, seed) {
  const groups = orderGroupsFromSamples(samples);
  const count = groups.baselineFirst.length;
  assert.equal(count, groups.candidateFirst.length, 'AB/BA strata must be equal');
  assert.ok(count >= (smokeMode ? 1 : 4), 'insufficient order-stratum samples');
  const random = rng(seed);
  const distribution = new Float64Array(bootstrapCount);
  const bf = new Array(count);
  const cs = new Array(count);
  const cf = new Array(count);
  const bs = new Array(count);
  let nonWins = 0;
  let nonRegressions = 0;
  for (let iteration = 0; iteration < bootstrapCount; iteration++) {
    for (let i = 0; i < count; i++) {
      const selected = Math.floor(random() * count);
      bf[i] = groups.baselineFirst[selected];
      cs[i] = groups.candidateSecond[selected];
    }
    for (let i = 0; i < count; i++) {
      const selected = Math.floor(random() * count);
      cf[i] = groups.candidateFirst[selected];
      bs[i] = groups.baselineSecond[selected];
    }
    const ratio = Math.sqrt((median(bf) / median(cs)) * (median(bs) / median(cf)));
    distribution[iteration] = ratio;
    if (ratio <= 1) nonWins++;
    if (ratio >= 1) nonRegressions++;
  }
  return {
    confidence: 0.95,
    resamples: bootstrapCount,
    seed: seed >>> 0,
    lower: quantile(distribution, 0.025),
    median: quantile(distribution, 0.5),
    upper: quantile(distribution, 0.975),
    pOneSided: (nonWins + 1) / (bootstrapCount + 1),
    pRegressionOneSided: (nonRegressions + 1) / (bootstrapCount + 1),
  };
}

function scaledIterations(value) {
  return Math.max(2, Math.round(value * workloadScale));
}

function cloneTyped(values, count = values.length) {
  return values.slice(0, count);
}

function typedBytesEqual(a, b) {
  if (!a || !b || a.byteLength !== b.byteLength || a.constructor !== b.constructor) return false;
  return Buffer.from(a.buffer, a.byteOffset, a.byteLength)
    .equals(Buffer.from(b.buffer, b.byteOffset, b.byteLength));
}

function arraysFinite(arrays) {
  for (const values of arrays) {
    if (!(values instanceof Float32Array || values instanceof Float64Array)) continue;
    for (let index = 0; index < values.length; index++) if (!Number.isFinite(values[index])) return false;
  }
  return true;
}

function arraysRelativeL2(a, b) {
  if (a.length !== b.length) return Number.POSITIVE_INFINITY;
  let error = 0;
  let reference = 0;
  for (let part = 0; part < a.length; part++) {
    if (a[part].length !== b[part].length) return Number.POSITIVE_INFINITY;
    for (let index = 0; index < a[part].length; index++) {
      const delta = Number(b[part][index]) - Number(a[part][index]);
      error += delta * delta;
      reference += Number(a[part][index]) * Number(a[part][index]);
    }
  }
  return Math.sqrt(error / Math.max(reference, 1e-30));
}

function hashCapture(parts, metadata) {
  const hash = crypto.createHash('sha256');
  hash.update(stableStringify(metadata));
  for (const values of parts) hash.update(Buffer.from(values.buffer, values.byteOffset, values.byteLength));
  return hash.digest('hex');
}

function flattenLines(lines) {
  const output = new Float32Array(lines.length * 10);
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    const offset = index * 10;
    output[offset] = line.ax; output[offset + 1] = line.ay; output[offset + 2] = line.az;
    output[offset + 3] = line.bx; output[offset + 4] = line.by; output[offset + 5] = line.bz;
    output[offset + 6] = line.r; output[offset + 7] = line.g; output[offset + 8] = line.b; output[offset + 9] = line.a;
  }
  return output;
}

function captureGeneric(kind, stateParts, renderParts, metadata = {}, structural = metadata, topologyParts = []) {
  const normalizedState = stateParts.map((values) => cloneTyped(values));
  const normalizedRender = renderParts.map((values) => cloneTyped(values));
  const normalizedTopology = topologyParts.map((values) => cloneTyped(values));
  const allParts = [...normalizedState, ...normalizedRender, ...normalizedTopology];
  const normalizedMetadata = { kind, ...metadata };
  return {
    metadata: normalizedMetadata,
    structural: { kind, ...structural },
    stateParts: normalizedState,
    renderParts: normalizedRender,
    topologyParts: normalizedTopology,
    finite: arraysFinite(allParts),
    fingerprint: hashCapture(allParts, normalizedMetadata),
    topologyFingerprint: hashCapture(normalizedTopology, { count: normalizedTopology.length }),
  };
}

function captureNative(mod) {
  const bodyCount = mod._b3w_body_count();
  const matrixStart = Number(mod._b3w_matrices_ptr()) >>> 2;
  const colorStart = Number(mod._b3w_colors_ptr()) >>> 2;
  const matrices = cloneTyped(new Uint32Array(mod.HEAPF32.buffer, matrixStart * 4, bodyCount * 16));
  const colors = cloneTyped(new Uint32Array(mod.HEAPF32.buffer, colorStart * 4, bodyCount * 4));
  const metadata = {
    kind: 'native',
    bodyCount,
    dynamicCount: mod._b3w_dynamic_count(),
    awakeCount: mod._b3w_awake_count(),
    transformVersion: mod._b3w_transform_version() >>> 0,
    colorVersion: mod._b3w_color_version() >>> 0,
    replayHash: mod._b3w_replay_hash() >>> 0,
  };
  const stateParts = [matrices];
  const renderParts = [matrices, colors];
  const allParts = [...stateParts, colors];
  // Stream revision counters are deliberately monotonic across destroy/create
  // cycles. They are useful path evidence but are not part of deterministic
  // world state, so exclude them from the repeated-setup fingerprint.
  const fingerprintMetadata = {
    kind: metadata.kind,
    bodyCount: metadata.bodyCount,
    dynamicCount: metadata.dynamicCount,
    awakeCount: metadata.awakeCount,
    replayHash: metadata.replayHash,
  };
  return {
    metadata,
    structural: {
      kind: metadata.kind,
      bodyCount: metadata.bodyCount,
      dynamicCount: metadata.dynamicCount,
      awakeCount: metadata.awakeCount,
    },
    stateParts,
    renderParts,
    topologyParts: [],
    finite: arraysFinite(allParts),
    fingerprint: hashCapture(allParts, fingerprintMetadata),
    topologyFingerprint: sha256Buffer(Buffer.alloc(0)),
  };
}

function captureFallback(backend) {
  const bodyCount = backend.bodyCount();
  const matrixStart = Number(backend._b3w_matrices_ptr()) >>> 2;
  const colorStart = Number(backend._b3w_colors_ptr()) >>> 2;
  const matrices = new Uint32Array(backend.HEAPF32.buffer, matrixStart * 4, bodyCount * 16);
  const colors = new Uint32Array(backend.HEAPF32.buffer, colorStart * 4, bodyCount * 4);
  return captureGeneric(
    'fallback', [matrices], [matrices, colors],
    {
      bodyCount,
      dynamicCount: backend.dynamicCount(),
      replayHash: backend.replayHash() >>> 0,
      broadphaseAxis: backend.broadphaseAxis(),
      broadphaseCandidates: backend.broadphaseCandidateCount(),
    },
    { bodyCount, dynamicCount: backend.dynamicCount() },
  );
}

function captureSoft(suite) {
  const frame = suite.buildFrame(false);
  const active = suite.active;
  assert.ok(active, 'soft simulation is inactive');
  const stateParts = active.kind === 'water'
    ? [cloneTyped(active.eta), cloneTyped(active.u), cloneTyped(active.v)]
    : [cloneTyped(active.positions)];
  const matrices = cloneTyped(frame.matrices, frame.instanceCount * 16);
  const colors = cloneTyped(frame.colors, frame.instanceCount * 4);
  const renderParts = [matrices, colors];
  const topologyParts = [];
  if (frame.ropeGrid) {
    renderParts.push(cloneTyped(frame.ropeGrid.positions, frame.ropeGrid.nodeCount * 3));
    renderParts.push(cloneTyped(frame.ropeGrid.segments, frame.ropeGrid.segmentCount * 8));
  }
  if (frame.surface) {
    topologyParts.push(cloneTyped(frame.surface.indices, frame.surface.indexCount));
    if (frame.surface.path === 'packed') {
      renderParts.push(cloneTyped(frame.surface.vertices, frame.surface.vertexCount * frame.surface.vertexStride));
    } else if (frame.surface.path === 'gpu-cloth') {
      renderParts.push(cloneTyped(frame.surface.positions, frame.surface.vertexCount * 3));
      renderParts.push(cloneTyped(frame.surface.restPositions, frame.surface.vertexCount * 3));
    } else {
      renderParts.push(cloneTyped(frame.surface.eta, frame.surface.vertexCount));
      renderParts.push(cloneTyped(frame.surface.u, frame.surface.vertexCount));
      renderParts.push(cloneTyped(frame.surface.v, frame.surface.vertexCount));
    }
  }
  renderParts.push(flattenLines(frame.debugLines));
  const metadata = {
    kind: frame.kind,
    nodeCount: frame.nodeCount,
    constraintCount: frame.constraintCount,
    brokenCount: frame.brokenCount,
    instanceCount: frame.instanceCount,
    ropeSegmentCount: frame.ropeGrid?.segmentCount || 0,
    surfacePath: frame.surface?.path || null,
    vertexCount: frame.surface?.vertexCount || 0,
    indexCount: frame.surface?.indexCount || 0,
    topologyVersion: frame.surface?.topologyVersion ?? frame.ropeGrid?.topologyVersion ?? 0,
    frameVersion: frame.frameVersion,
    replayHash: suite.hash() >>> 0,
  };
  const allParts = [...stateParts, ...renderParts, ...topologyParts];
  return {
    metadata,
    structural: {
      kind: metadata.kind,
      nodeCount: metadata.nodeCount,
      constraintCount: metadata.constraintCount,
      brokenCount: metadata.brokenCount,
      instanceCount: metadata.instanceCount,
      ropeSegmentCount: metadata.ropeSegmentCount,
      surfacePath: metadata.surfacePath,
      vertexCount: metadata.vertexCount,
      indexCount: metadata.indexCount,
    },
    stateParts,
    renderParts,
    topologyParts,
    finite: arraysFinite(allParts),
    fingerprint: hashCapture(allParts, metadata),
    topologyFingerprint: hashCapture(topologyParts, { count: topologyParts.length }),
  };
}

function serializeCapture(capture) {
  return {
    metadata: capture.metadata,
    finite: capture.finite,
    fingerprint: capture.fingerprint,
    topologyFingerprint: capture.topologyFingerprint,
    stateElements: capture.stateParts.reduce((sum, values) => sum + values.length, 0),
    renderElements: capture.renderParts.reduce((sum, values) => sum + values.length, 0),
  };
}

function compareCapture(definition, baseline, candidate) {
  const sameStructural = stableStringify(baseline.structural) === stableStringify(candidate.structural);
  const sameTopology = baseline.topologyFingerprint === candidate.topologyFingerprint;
  const stateError = arraysRelativeL2(baseline.stateParts, candidate.stateParts);
  const renderError = arraysRelativeL2(baseline.renderParts, candidate.renderParts);
  const exactState = baseline.stateParts.length === candidate.stateParts.length &&
    baseline.stateParts.every((values, index) => typedBytesEqual(values, candidate.stateParts[index]));
  const exactRender = baseline.renderParts.length === candidate.renderParts.length &&
    baseline.renderParts.every((values, index) => typedBytesEqual(values, candidate.renderParts[index]));
  const exactBits = exactState && exactRender && sameTopology &&
    baseline.metadata.replayHash === candidate.metadata.replayHash;
  const correct = baseline.finite && candidate.finite && sameStructural && sameTopology &&
    stateError <= definition.fidelity.stateRelativeL2 &&
    renderError <= definition.fidelity.renderRelativeL2 &&
    (!definition.fidelity.exactBits || exactBits);
  return {
    correct,
    stateError,
    renderError,
    sameStructural,
    sameTopology,
    exactState,
    exactRender,
    exactBits,
    stateLimit: definition.fidelity.stateRelativeL2,
    renderLimit: definition.fidelity.renderRelativeL2,
  };
}

function applyNativeAction(mod, action) {
  switch (action.action) {
    case 'kick': mod._b3w_kick_stack(action.strength); return 1;
    case 'explosion': mod._b3w_explode(...action.center, action.strength, action.radius); return 1;
    case 'projectile': return Number(mod._b3w_launch_projectile(...action.position, ...action.velocity, action.size) >= 0);
    case 'rain': return mod._b3w_spawn_rain(action.count, action.spread, action.height);
    default: throw new Error(`unknown native action ${action.action}`);
  }
}

function applySoftAction(suite, action) {
  switch (action.action) {
    case 'kick': suite.kick(action.strength); return 1;
    case 'explosion': suite.explode(action.center, action.strength, action.radius); return 1;
    case 'projectile': return Number(suite.launchProjectile(action.position, action.velocity, action.size) >= 0);
    case 'rain': return suite.spawnRain(action.count, action.spread, action.height);
    default: throw new Error(`unknown soft action ${action.action}`);
  }
}

function createNativeSubject(project, definition) {
  const mod = project.native;
  assert.ok(mod, `${project.tag}: native module was not loaded`);
  const createWorld = (withStep = false) => {
    mod._b3w_destroy();
    const created = mod._b3w_create_scene(definition.sceneId, definition.stress, definition.seed >>> 0);
    assert.equal(created, mod._b3w_body_count(), `${project.tag}: native create count mismatch`);
    if (withStep) mod._b3w_step(1 / 60, 4);
    return created;
  };
  createWorld(false);
  let warmupSteps = 0;
  if (definition.protocol === 'native-create-only' || definition.protocol === 'native-create-step') {
    for (; warmupSteps < scaledIterations(definition.warmup); warmupSteps++) {
      createWorld(definition.protocol === 'native-create-step');
    }
  } else if (definition.protocol === 'settled-step-control') {
    const maximum = Math.max(definition.warmup, 1200);
    while (warmupSteps < maximum) {
      mod._b3w_step(1 / 60, 4);
      warmupSteps++;
      if (warmupSteps >= definition.warmup && mod._b3w_awake_count() === 0) break;
    }
  } else {
    for (; warmupSteps < scaledIterations(definition.warmup); warmupSteps++) mod._b3w_step(1 / 60, 4);
  }
  let frame = 0;
  let actionCalls = 0;
  let actionEffects = 0;
  let createCalls = 0;
  let syncCalls = 0;
  return {
    step() {
      if (definition.protocol === 'native-create-only' || definition.protocol === 'native-create-step') {
        createWorld(definition.protocol === 'native-create-step');
        createCalls++;
        frame++;
        observableSink = (observableSink + mod._b3w_body_count()) >>> 0;
        return;
      }
      const actionFrame = definition.actionCycle ? frame % definition.actionCycle : frame;
      for (const action of definition.actions) {
        if (action.frame === actionFrame) {
          actionCalls++;
          actionEffects += applyNativeAction(mod, action);
        }
      }
      if (definition.protocol === 'explicit-sync') {
        mod._b3w_sync_transforms();
        syncCalls++;
      } else {
        mod._b3w_step(1 / 60, 4);
        if (definition.protocol === 'native-step-explicit-sync' || definition.protocol === 'native-mixed-actions') {
          mod._b3w_sync_transforms();
          syncCalls++;
        }
      }
      frame++;
      observableSink = (observableSink + mod._b3w_transform_version() + mod._b3w_body_count()) >>> 0;
    },
    capture() { return captureNative(mod); },
    evidence() {
      return {
        engine: 'native', frames: frame, warmupSteps, actionCalls, actionEffects,
        operations: frame, createCalls, syncCalls,
        settledAchieved: definition.protocol !== 'settled-step-control' || mod._b3w_awake_count() === 0,
        awakeCount: mod._b3w_awake_count(),
      };
    },
    destroy() { mod._b3w_destroy(); },
  };
}

function applyFallbackAction(backend, action) {
  switch (action.action) {
    case 'kick': backend.kick(action.strength); return 1;
    case 'explosion': backend.explode(...action.center, action.strength, action.radius); return 1;
    case 'projectile': return Number(backend.launchProjectile(...action.position, ...action.velocity, action.size) >= 0);
    case 'rain': return backend.spawnRain(action.count, action.spread, action.height);
    default: throw new Error(`unknown fallback action ${action.action}`);
  }
}

function createFallbackSubject(project, definition) {
  const scene = project.SCENES[definition.sceneId];
  assert.ok(scene, `${project.tag}: missing fallback scene ${definition.sceneId}`);
  let backend;
  const createBackend = (withStep = false) => {
    backend?.destroy();
    backend = new project.FallbackPhysicsBackend(4096);
    const created = backend.createScene(scene, definition.stress, definition.seed);
    assert.equal(created, backend.bodyCount(), `${project.tag}: fallback create count mismatch`);
    if (withStep) backend.step(1 / 60, 2);
  };
  createBackend(false);
  let warmupSteps = 0;
  for (; warmupSteps < scaledIterations(definition.warmup); warmupSteps++) {
    if (definition.protocol === 'fallback-create-step') createBackend(true);
    else if (definition.protocol === 'fallback-invalid-step-control') backend.step(Number.NaN, 2);
    else backend.step(1 / 60, 2);
  }
  let frame = 0;
  let createCalls = 0;
  let actionCalls = 0;
  let actionEffects = 0;
  return {
    step() {
      if (definition.protocol === 'fallback-create-step') {
        createBackend(true);
        createCalls++;
      } else if (definition.protocol === 'fallback-invalid-step-control') {
        backend.step(Number.NaN, 2);
      } else {
        for (const action of definition.actions) {
          if (action.frame === frame) {
            actionCalls++;
            actionEffects += applyFallbackAction(backend, action);
          }
        }
        backend.step(1 / 60, 2);
      }
      frame++;
      observableSink = (observableSink + backend.frameVersion() + backend.bodyCount()) >>> 0;
    },
    capture() { return captureFallback(backend); },
    evidence() {
      return { engine: 'fallback', frames: frame, operations: frame, warmupSteps, createCalls, actionCalls, actionEffects };
    },
    destroy() { backend.destroy(); },
  };
}

function createSoftSubject(project, definition) {
  const suite = project.createSoftSuite();
  const scene = project.SCENES[definition.sceneId];
  assert.ok(scene, `${project.tag}: missing scene ${definition.sceneId}`);
  assert.ok(suite.createScene(scene, definition.stress, definition.seed), `${project.tag}: failed scene ${definition.sceneId}`);
  let warmupSteps = 0;
  for (; warmupSteps < scaledIterations(definition.warmup); warmupSteps++) suite.step(1 / 60, 4);
  if (definition.unchangedFrame) {
    suite.buildFrame(false);
    suite.buildFrame(false);
  }
  let frame = 0;
  let actionCalls = 0;
  let actionEffects = 0;
  let buildFrames = 0;
  return {
    step() {
      if (!definition.unchangedFrame) {
        for (const action of definition.actions) {
          if (action.frame === frame) {
            actionCalls++;
            actionEffects += applySoftAction(suite, action);
          }
        }
        suite.step(1 / 60, 4);
      }
      const built = suite.buildFrame(false);
      buildFrames++;
      frame++;
      observableSink = (observableSink + built.frameVersion + built.nodeCount) >>> 0;
    },
    capture() { return captureSoft(suite); },
    evidence() {
      return { engine: 'soft', frames: frame, operations: frame, warmupSteps, actionCalls, actionEffects, buildFrames };
    },
    destroy() { suite.destroy(); },
  };
}

function captureMixedSoft(suites) {
  const captures = suites.map(captureSoft);
  return captureGeneric(
    'mixed-soft',
    captures.flatMap((capture) => capture.stateParts),
    captures.flatMap((capture) => capture.renderParts),
    {
      replayHash: captures.reduce((hash, capture) => (Math.imul(hash ^ (capture.metadata.replayHash >>> 0), 16777619)) >>> 0, 2166136261),
      sceneCount: captures.length,
      kinds: captures.map((capture) => capture.metadata.kind),
      frameVersions: captures.map((capture) => capture.metadata.frameVersion),
    },
    {
      sceneCount: captures.length,
      kinds: captures.map((capture) => capture.metadata.kind),
      nodes: captures.map((capture) => capture.metadata.nodeCount),
      instances: captures.map((capture) => capture.metadata.instanceCount),
    },
    captures.flatMap((capture) => capture.topologyParts),
  );
}

function createMixedSoftSubject(project, definition) {
  const suites = definition.sceneIds.map((sceneId, index) => {
    const suite = project.createSoftSuite();
    assert.ok(suite.createScene(project.SCENES[sceneId], definition.stress, (definition.seed + index * 0x9e3779b1) >>> 0));
    return suite;
  });
  let warmupSteps = 0;
  for (; warmupSteps < scaledIterations(definition.warmup); warmupSteps++) {
    for (const suite of suites) suite.step(1 / 60, 4);
  }
  if (definition.unchangedFrame) for (const suite of suites) suite.buildFrame(false);
  let frame = 0;
  let buildFrames = 0;
  return {
    step() {
      if (!definition.unchangedFrame) for (const suite of suites) suite.step(1 / 60, 4);
      for (const suite of suites) suite.buildFrame(false);
      buildFrames += suites.length;
      frame++;
      observableSink = (observableSink + suites.reduce((sum, suite) => sum + suite.hash(), 0)) >>> 0;
    },
    capture() { return captureMixedSoft(suites); },
    evidence() {
      return { engine: 'mixed-soft', frames: frame, operations: frame, warmupSteps, actionCalls: 0, actionEffects: 0, buildFrames };
    },
    destroy() { for (const suite of suites) suite.destroy(); },
  };
}

function createCameraSubject(project, definition) {
  const cache = new project.CameraMatrixCache();
  const variant = definition.variant;
  const rig = { yaw: 0.2 + variant * 0.013, pitch: 0.4, distance: 34 + variant, target: [0, 4, 0] };
  const shake = { yaw: 0, pitch: 0, targetOffset: [0, 0, 0] };
  const light = [-0.42, -0.82, -0.38];
  let frame = 0;
  let resolved = cache.resolve(rig, shake, 16 / 9, light);
  let resolveCalls = 1;
  const active = definition.protocol !== 'camera-unchanged';
  return {
    step() {
      if (active) {
        rig.yaw += 0.00011 * (1 + (variant % 5));
        shake.yaw = Math.sin(frame * 0.07) * 0.001;
        if (definition.protocol === 'camera-forced-active-control') rig.target[0] += 0.00003;
      }
      resolved = cache.resolve(rig, shake, 16 / 9, light);
      resolveCalls++;
      frame++;
      observableSink = (observableSink + Math.trunc(resolved.eye[0] * 1000)) >>> 0;
    },
    capture() {
      return captureGeneric('camera', [resolved.viewProjection, resolved.lightViewProjection], [new Float32Array(resolved.eye)],
        { replayHash: 0, eye: [...resolved.eye] }, { matrices: 2, eyeCount: 3 });
    },
    evidence() { return { engine: 'camera', frames: frame, operations: frame, actionCalls: 0, actionEffects: 0, resolveCalls }; },
    destroy() {},
  };
}

function makeDebugLines(count, seed) {
  const lines = new Array(count);
  for (let index = 0; index < count; index++) {
    const phase = seed * 0.001 + index * 0.071;
    lines[index] = {
      ax: Math.sin(phase) * 8, ay: index * 0.01, az: Math.cos(phase) * 8,
      bx: Math.sin(phase + 0.1) * 8, by: index * 0.01 + 0.4, bz: Math.cos(phase + 0.1) * 8,
      r: (index % 7) / 6, g: (index % 11) / 10, b: (index % 13) / 12, a: 1,
    };
  }
  return lines;
}

function createFrameLinesSubject(project, definition) {
  const stager = new project.FrameLineStager();
  const count = 32 + definition.variant * 7;
  const rigid = makeDebugLines(count, definition.seed);
  const soft = makeDebugLines(Math.floor(count / 2), definition.seed ^ 0x51);
  const effects = makeDebugLines(Math.floor(count / 3), definition.seed ^ 0xa7);
  let version = 1;
  let frame = 0;
  let builds = 0;
  const buildRigid = () => { builds++; return rigid; };
  let resolved = stager.resolve(true, version, version, version, buildRigid, soft, effects);
  return {
    step() {
      if (definition.protocol === 'lines-active') version++;
      resolved = stager.resolve(true, version, version, version, buildRigid, soft, effects);
      frame++;
      observableSink = (observableSink + resolved.length) >>> 0;
    },
    capture() {
      const values = flattenLines(resolved);
      return captureGeneric('frame-lines', [values], [values],
        { replayHash: 0, lineCount: resolved.length }, { lineCount: resolved.length });
    },
    evidence() { return { engine: 'frame-lines', frames: frame, operations: frame, actionCalls: 0, actionEffects: 0, builderCalls: builds }; },
    destroy() {},
  };
}

function createEffectsSubject(project, definition) {
  const effects = new project.CinematicEffects();
  const budget = 256 + definition.variant * 24;
  effects.clear(definition.seed);
  for (let index = 0; index < 2 + definition.variant % 4; index++) {
    effects.spawnExplosion([index * 1.3, 3 + index * 0.2, -index], 10 + definition.variant, budget);
  }
  effects.spawnProjectileMuzzle([-12, 6, 0], [24, 2, 0], budget);
  effects.spawnImpulseDust([0, 0.2, 0], 8 + definition.variant, budget);
  let built = effects.buildFrame(budget);
  let frame = 0;
  let buildFrames = 1;
  return {
    step() {
      if (definition.protocol === 'effects-active') effects.update(1 / 60);
      built = effects.buildFrame(budget);
      buildFrames++;
      frame++;
      observableSink = (observableSink + built.count + built.frameVersion) >>> 0;
    },
    capture() {
      const matrices = built.matrices.subarray(0, built.count * 16);
      const colors = built.colors.subarray(0, built.count * 4);
      const lines = flattenLines(built.debugLines);
      return captureGeneric('effects', [matrices], [matrices, colors, lines],
        { replayHash: 0, count: built.count, lineCount: built.debugLines.length, frameVersion: built.frameVersion },
        { count: built.count, lineCount: built.debugLines.length });
    },
    evidence() { return { engine: 'effects', frames: frame, operations: frame, actionCalls: 0, actionEffects: 0, buildFrames }; },
    destroy() {},
  };
}

function createWasmWrapperSubject(project, definition) {
  const heap = new Float32Array(4096);
  for (let index = 0; index < heap.length; index++) heap[index] = Math.sin(index * 0.013 + definition.variant);
  const calls = { matrices: 0, colors: 0, step: 0, body: 0, dynamic: 0 };
  let transformVersion = 7;
  const mod = {
    HEAPF32: heap,
    _b3w_matrices_ptr() { calls.matrices++; return 0; },
    _b3w_colors_ptr() { calls.colors++; return 2048 * 4; },
    _b3w_max_bodies() { return 128; },
    _b3w_body_count() { calls.body++; return 64 + definition.variant; },
    _b3w_dynamic_count() { calls.dynamic++; return 48 + definition.variant; },
    _b3w_transform_version() { return transformVersion; },
    _b3w_color_version() { return 3; },
    _b3w_replay_hash() { return 0x51130000 ^ definition.variant; },
    _b3w_step() { calls.step++; transformVersion++; heap[transformVersion % 1024] += 0.0001; },
  };
  const backend = new project.WasmPhysicsBackend(mod);
  let frame = 0;
  return {
    step() {
      const repetitions = 2 + (definition.variant % 7);
      for (let index = 0; index < repetitions; index++) {
        if (definition.protocol !== 'wrapper-counts') {
          observableSink ^= Number(backend._b3w_matrices_ptr()) + Number(backend._b3w_colors_ptr());
        }
        if (definition.protocol !== 'wrapper-pointers') observableSink ^= backend.bodyCount() + backend.dynamicCount();
      }
      if (definition.protocol === 'wrapper-step-pointers' || definition.protocol === 'wrapper-mixed') backend.step(1 / 60, 4);
      frame++;
    },
    capture() {
      const summary = new Uint32Array([
        Number(backend._b3w_matrices_ptr()), Number(backend._b3w_colors_ptr()), backend.bodyCount(),
        backend.dynamicCount(), backend.frameVersion(), backend.colorVersion(), backend.replayHash() >>> 0,
      ]);
      return captureGeneric('wasm-wrapper', [summary, heap], [summary],
        { replayHash: backend.replayHash() >>> 0, maxBodies: backend.maxBodies }, { maxBodies: backend.maxBodies });
    },
    evidence() { return { engine: 'wasm-wrapper', frames: frame, operations: frame, actionCalls: 0, actionEffects: 0, wrapperCalls: { ...calls } }; },
    destroy() {},
  };
}

function makeMockBuffer(label, bytes = 4 * 1024 * 1024) {
  return { label, bytes: new Uint8Array(bytes), destroy() {} };
}

function makeMockRenderer(project, definition) {
  globalThis.window ??= { devicePixelRatio: 1 };
  globalThis.GPUTextureUsage ??= { RENDER_ATTACHMENT: 1, TEXTURE_BINDING: 2 };
  const writes = [];
  const queue = {
    writeBuffer(target, destinationOffset, data, sourceOffset = 0, size) {
      const source = ArrayBuffer.isView(data)
        ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
        : new Uint8Array(data);
      const byteOffset = sourceOffset || 0;
      const byteLength = size ?? (source.byteLength - byteOffset);
      const required = destinationOffset + byteLength;
      if (required > target.bytes.length) {
        const grown = new Uint8Array(Math.max(required, target.bytes.length * 2));
        grown.set(target.bytes);
        target.bytes = grown;
      }
      target.bytes.set(source.subarray(byteOffset, byteOffset + byteLength), destinationOffset);
      writes.push({ label: target.label, destinationOffset, byteLength });
    },
    submit() {},
  };
  const texture = (label = 'texture') => ({ label, createView() { return { label: `${label}-view` }; }, destroy() {} });
  const pass = () => ({
    setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, setIndexBuffer() {},
    draw() {}, drawIndexed() {}, dispatchWorkgroups() {}, end() {},
  });
  let textureCreations = 0;
  const device = {
    queue,
    createTexture(descriptor) { textureCreations++; return texture(descriptor.label); },
    createBindGroup(descriptor) { return { label: descriptor.label }; },
    createCommandEncoder() {
      return { beginComputePass: pass, beginRenderPass: pass, finish() { return {}; } };
    },
  };
  const canvas = { clientWidth: 640 + definition.variant * 3, clientHeight: 360 + definition.variant * 2, width: 0, height: 0 };
  const context = { getCurrentTexture() { return texture('swapchain'); } };
  const buffers = Object.fromEntries([
    'uniformBuffer', 'vertexBuffer', 'matrixBuffer', 'colorBuffer', 'ropePositionBuffer', 'ropeSegmentBuffer',
    'ropeUniformBuffer', 'lineBuffer', 'surfaceVertexBuffer', 'surfaceIndexBuffer', 'clothPositionBuffer',
    'clothRestPositionBuffer', 'clothParamsBuffer', 'waterEtaBuffer', 'waterUBuffer', 'waterVBuffer', 'waterParamsBuffer',
  ].map((name) => [name, makeMockBuffer(name)]));
  const pipelines = { sky: {}, solid: {}, cloth: {}, gpuCloth: {}, gpuWater: {}, line: {} };
  const renderer = new project.WebGPURenderer({
    canvas, device, context, format: 'bgra8unorm', maxInstances: 4096,
    shadowPipeline: {}, surfaceShadowPipeline: {}, gpuClothShadowPipeline: {},
    mainPipelines1x: pipelines, mainPipelines4x: pipelines, postPipeline: {}, ropeComputePipeline: {},
    shadowBindGroup: {}, sceneBindGroup: {}, sceneBindGroupLayout: {}, gpuClothBindGroup: {},
    gpuWaterBindGroup: {}, ropeComputeBindGroup: {}, postBindGroupLayout: {},
    ...buffers,
    shadowTexture: texture('shadow'), shadowView: {}, shadowSampler: {}, linearSampler: {},
    materialNoise: { texture: texture('noise'), view: {}, sampler: {}, compressed: false, sourceBytes: 0, source: 'procedural-r8' },
  });
  return { renderer, canvas, device, writes, buffers, get textureCreations() { return textureCreations; } };
}

function gridIndices(cols, rows) {
  const indices = new Uint16Array((cols - 1) * (rows - 1) * 6);
  let write = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[write++] = a; indices[write++] = c; indices[write++] = b;
      indices[write++] = b; indices[write++] = c; indices[write++] = d;
    }
  }
  return indices;
}

function rendererUniformState(frame, variant) {
  const identity = new Float32Array(16);
  identity[0] = identity[5] = identity[10] = identity[15] = 1;
  return {
    viewProjection: identity,
    lightViewProjection: identity,
    cameraPosition: [variant * 0.1, 5, 12],
    timeSeconds: frame / 60,
    lightDirection: [-0.42, -0.82, -0.38],
    fogColor: [0.03, 0.05, 0.09],
    quality: {
      id: 'cinematic', label: 'Cinematic', exposure: 1, bloomStrength: 0.2, fogDensity: 0.01,
      shadowStrength: 0, effectBudget: 1024, resolutionScale: 1, sampleCount: 4,
      shadowMapSize: 2048, shadowTapCount: 9,
    },
  };
}

function captureMockRenderer(mock) {
  const writtenLabels = new Set(mock.writes.map((entry) => entry.label));
  const selected = Object.values(mock.buffers)
    .filter((buffer) => writtenLabels.has(buffer.label))
    .sort((a, b) => a.label.localeCompare(b.label));
  const viewport = mock.renderer.viewport();
  const canvasState = new Uint32Array([viewport[0], viewport[1], mock.canvas.width, mock.canvas.height]);
  return captureGeneric('renderer', [canvasState], selected.map((buffer) => buffer.bytes),
    { replayHash: 0, viewport: [...viewport], canvas: [mock.canvas.width, mock.canvas.height], buffers: selected.map((buffer) => buffer.label) },
    { viewport: [...viewport], canvas: [mock.canvas.width, mock.canvas.height], buffers: selected.map((buffer) => buffer.label) });
}

function createRendererSubject(project, definition) {
  const mock = makeMockRenderer(project, definition);
  const { renderer } = mock;
  let frame = 0;
  let uploadedBytes = 0;
  const active = !definition.unchangedFrame;
  const count = 48 + definition.variant * 13;
  const heap = new Float32Array(count * 20);
  for (let index = 0; index < heap.length; index++) heap[index] = Math.sin(index * 0.017 + definition.variant);
  let rigidFrameVersion = 1;
  const rigidSource = {
    HEAPF32: heap,
    frameVersion: () => rigidFrameVersion,
    colorVersion: () => rigidFrameVersion,
    _b3w_matrices_ptr: () => 0,
    _b3w_colors_ptr: () => count * 16 * 4,
    _b3w_body_count: () => count,
    _b3w_max_bodies: () => count,
  };
  const matrices = new Float32Array(count * 16);
  const colors = new Float32Array(count * 4);
  for (let index = 0; index < matrices.length; index++) matrices[index] = Math.cos(index * 0.019 + definition.variant);
  for (let index = 0; index < colors.length; index++) colors[index] = (index % 17) / 16;
  const cols = 10 + (definition.variant % 5);
  const rows = 9 + (definition.variant % 4);
  const vertexCount = cols * rows;
  const positions = new Float32Array(vertexCount * 3);
  const restPositions = new Float32Array(vertexCount * 3);
  const eta = new Float32Array(vertexCount);
  const u = new Float32Array(vertexCount);
  const v = new Float32Array(vertexCount);
  for (let index = 0; index < vertexCount; index++) {
    positions[index * 3] = restPositions[index * 3] = index % cols;
    positions[index * 3 + 1] = restPositions[index * 3 + 1] = Math.sin(index * 0.1) * 0.1;
    positions[index * 3 + 2] = restPositions[index * 3 + 2] = Math.floor(index / cols);
    eta[index] = Math.sin(index * 0.07) * 0.2;
    u[index] = Math.cos(index * 0.05) * 0.1;
    v[index] = Math.sin(index * 0.09) * 0.1;
  }
  const indices = gridIndices(cols, rows);
  const cloth = {
    path: 'gpu-cloth', material: 'cloth', positions, restPositions, indices,
    vertexCount, indexCount: indices.length, topologyVersion: 1, frameVersion: 1,
    cols, rows, baseColorA: [0.2, 0.4, 0.8, 1], baseColorB: [0.8, 0.3, 0.2, 1],
  };
  const water = {
    path: 'gpu-water', material: 'water', eta, u, v, indices,
    vertexCount, indexCount: indices.length, topologyVersion: 1, frameVersion: 1,
    cols, rows, width: 18 + definition.variant, depth: 14, baseY: 0.2,
  };
  const ropeNodeCount = Math.min(512, count + 2);
  const ropePositions = new Float32Array(ropeNodeCount * 3);
  const ropeSegments = new Float32Array((ropeNodeCount - 1) * 8);
  for (let index = 0; index < ropeNodeCount; index++) ropePositions[index * 3] = index * 0.2;
  for (let index = 0; index < ropeNodeCount - 1; index++) {
    const offset = index * 8;
    ropeSegments[offset] = index; ropeSegments[offset + 1] = index + 1; ropeSegments[offset + 2] = 5;
    ropeSegments[offset + 3] = 0.08; ropeSegments[offset + 4] = 0.5; ropeSegments[offset + 5] = 0.7;
    ropeSegments[offset + 6] = 0.9; ropeSegments[offset + 7] = 1;
  }
  const rope = { positions: ropePositions, segments: ropeSegments, nodeCount: ropeNodeCount, segmentCount: ropeNodeCount - 1, topologyVersion: 1, frameVersion: 1 };

  // Prime resize resources before timing; upload subjects retain their normal
  // cold-first upload because that is part of their repeated production path.
  if (!definition.engine.startsWith('renderer-uniform')) renderer.resize();
  if (definition.unchangedFrame) {
    if (definition.engine === 'renderer-rigid') renderer.uploadInstances(rigidSource, count);
    else if (definition.engine === 'renderer-cloth') renderer.uploadSurface(cloth);
    else if (definition.engine === 'renderer-water') renderer.uploadSurface(water);
    else if (definition.engine === 'renderer-rope') renderer.uploadRopeGrid(rope, 32);
    else if (definition.engine === 'renderer-effects') renderer.uploadEffects(matrices, colors, 64, count, rigidFrameVersion);
    else {
      renderer.writeSceneUniforms(rendererUniformState(0, definition.variant));
      renderer.render(0, [], 0);
    }
  }
  return {
    step() {
      if (definition.engine === 'renderer-rigid') {
        if (active) { rigidFrameVersion++; heap[frame % heap.length] += 0.00001; }
        uploadedBytes += renderer.uploadInstances(rigidSource, count);
      } else if (definition.engine === 'renderer-cloth') {
        if (active) { cloth.frameVersion++; positions[(frame * 3) % positions.length] += 0.00001; cloth.baseColorA[0] = 0.2 + (frame & 1) * 0.0001; }
        uploadedBytes += renderer.uploadSurface(cloth);
      } else if (definition.engine === 'renderer-water') {
        if (active) { water.frameVersion++; eta[frame % eta.length] += 0.00001; water.width = 18 + definition.variant + (frame & 1) * 0.001; }
        uploadedBytes += renderer.uploadSurface(water);
      } else if (definition.engine === 'renderer-rope') {
        if (active) { rope.frameVersion++; ropePositions[frame % ropePositions.length] += 0.00001; }
        uploadedBytes += renderer.uploadRopeGrid(rope, 32);
      } else if (definition.engine === 'renderer-effects') {
        if (active) { rigidFrameVersion++; matrices[frame % matrices.length] += 0.00001; }
        uploadedBytes += renderer.uploadEffects(matrices, colors, 64, count, rigidFrameVersion);
      } else {
        const uniformFrame = definition.protocol === 'uniforms-resize-dedup' ? 0 : frame;
        if (definition.protocol === 'uniforms-active-resize' || definition.protocol === 'renderer-forced-resize-control') {
          mock.canvas.clientWidth = 640 + definition.variant * 3 + (frame % 3);
          mock.canvas.clientHeight = 360 + definition.variant * 2 + (frame % 2);
        }
        renderer.writeSceneUniforms(rendererUniformState(uniformFrame, definition.variant));
        if (definition.protocol === 'uniforms-delayed-resize') {
          mock.canvas.clientWidth += 1;
          mock.canvas.clientHeight += 1;
        }
        renderer.render(0, [], uniformFrame);
      }
      frame++;
      observableSink = (observableSink + uploadedBytes + mock.writes.length) >>> 0;
    },
    capture() { return captureMockRenderer(mock); },
    evidence() {
      return {
        engine: definition.engine, frames: frame, operations: frame, actionCalls: 0, actionEffects: 0,
        queueWrites: mock.writes.length, uploadedBytes, textureCreations: mock.textureCreations,
        viewport: [...renderer.viewport()], canvas: [mock.canvas.width, mock.canvas.height],
      };
    },
    destroy() {},
  };
}

function createSubject(project, definition) {
  if (definition.engine === 'native') return createNativeSubject(project, definition);
  if (definition.engine === 'fallback') return createFallbackSubject(project, definition);
  if (definition.engine === 'soft') return createSoftSubject(project, definition);
  if (definition.engine === 'mixed-soft') return createMixedSoftSubject(project, definition);
  if (definition.engine === 'camera') return createCameraSubject(project, definition);
  if (definition.engine === 'frame-lines') return createFrameLinesSubject(project, definition);
  if (definition.engine === 'effects') return createEffectsSubject(project, definition);
  if (definition.engine === 'wasm-wrapper') return createWasmWrapperSubject(project, definition);
  if (definition.engine.startsWith('renderer-')) return createRendererSubject(project, definition);
  throw new Error(`unsupported v1.13 engine ${definition.engine}`);
}

function checkpointSteps(iterations, fractions) {
  return [...new Set(fractions.map((fraction) => Math.max(1, Math.ceil(iterations * fraction))))].sort((a, b) => a - b);
}

function trajectory(project, definition) {
  const subject = createSubject(project, definition);
  const iterations = scaledIterations(definition.iterations);
  const wanted = new Set(checkpointSteps(iterations, definition.checkpointFractions));
  const checkpoints = [];
  for (let step = 1; step <= iterations; step++) {
    subject.step();
    if (wanted.has(step)) checkpoints.push({ step, capture: subject.capture() });
  }
  const evidence = subject.evidence();
  subject.destroy();
  return { iterations, checkpoints, evidence };
}

function compareTrajectories(definition, baseline, candidate) {
  assert.deepEqual(baseline.checkpoints.map((entry) => entry.step), candidate.checkpoints.map((entry) => entry.step));
  const checkpoints = baseline.checkpoints.map((entry, index) => {
    const other = candidate.checkpoints[index];
    return {
      step: entry.step,
      baseline: serializeCapture(entry.capture),
      candidate: serializeCapture(other.capture),
      correctness: compareCapture(definition, entry.capture, other.capture),
    };
  });
  return {
    correct: checkpoints.every((entry) => entry.correctness.correct),
    checkpoints,
    baselinePathEvidence: baseline.evidence,
    candidatePathEvidence: candidate.evidence,
  };
}

function measureSingle(project, definition, collectGarbage = true) {
  const subject = createSubject(project, definition);
  const iterations = scaledIterations(definition.iterations);
  const before = definition.unchangedFrame ? subject.capture() : null;
  if (collectGarbage) global.gc?.();
  const started = performance.now();
  for (let iteration = 0; iteration < iterations; iteration++) subject.step();
  const elapsedMs = performance.now() - started;
  const capture = subject.capture();
  const pathEvidence = subject.evidence();
  subject.destroy();
  return {
    elapsedMs,
    iterations,
    msPerOperation: elapsedMs / iterations,
    capture,
    pathEvidence,
    beforeFingerprint: before?.fingerprint || null,
    withinRunExact: before ? before.fingerprint === capture.fingerprint : null,
  };
}

function measureBatch(project, definition, repetitions) {
  let elapsedMs = 0;
  let operations = 0;
  let capture = null;
  let pathEvidence = null;
  let deterministicFingerprint = null;
  let repeatedSetupDeterministic = true;
  let withinRunExact = null;
  global.gc?.();
  for (let repetition = 0; repetition < repetitions; repetition++) {
    if (repetition > 0 && repetition % 32 === 0) global.gc?.();
    const measured = measureSingle(project, definition, false);
    elapsedMs += measured.elapsedMs;
    operations += measured.iterations;
    capture ??= measured.capture;
    pathEvidence ??= measured.pathEvidence;
    if (deterministicFingerprint === null) deterministicFingerprint = measured.capture.fingerprint;
    else repeatedSetupDeterministic = repeatedSetupDeterministic &&
      deterministicFingerprint === measured.capture.fingerprint;
    if (measured.withinRunExact !== null) {
      withinRunExact = withinRunExact === null
        ? measured.withinRunExact
        : withinRunExact && measured.withinRunExact;
    }
  }
  return {
    elapsedMs,
    operations,
    repetitions,
    msPerOperation: elapsedMs / operations,
    capture,
    pathEvidence,
    repeatedSetupDeterministic,
    withinRunExact,
  };
}

function calibrate(baseline, candidate, definition) {
  const baselinePilot = measureSingle(baseline, definition);
  const candidatePilot = measureSingle(candidate, definition);
  const fastestPilot = Math.max(0.000001, Math.min(baselinePilot.elapsedMs, candidatePilot.elapsedMs));
  const safetyCap = confirmationMode
    ? Math.max(1024, definition.maxRepetitions || 0)
    : definition.maxRepetitions || 128;
  let repetitions = Math.max(1, Math.min(safetyCap, Math.ceil(targetBatchMs / (fastestPilot * 0.75))));
  const trials = [];
  for (let pass = 0; pass < 2; pass++) {
    const baselineTrial = measureBatch(baseline, definition, repetitions);
    const candidateTrial = measureBatch(candidate, definition, repetitions);
    const fastest = Math.max(0.000001, Math.min(baselineTrial.elapsedMs, candidateTrial.elapsedMs));
    trials.push({
      repetitions,
      baselineElapsedMs: baselineTrial.elapsedMs,
      candidateElapsedMs: candidateTrial.elapsedMs,
      fastestElapsedMs: fastest,
    });
    if (fastest >= targetBatchMs * 1.1 || repetitions === safetyCap) break;
    repetitions = Math.min(safetyCap, Math.max(repetitions + 1, Math.ceil(repetitions * targetBatchMs * 1.25 / fastest)));
  }
  return {
    repetitions,
    safetyCap,
    baselinePilotElapsedMs: baselinePilot.elapsedMs,
    candidatePilotElapsedMs: candidatePilot.elapsedMs,
    trials,
  };
}

function caseControl(definition, changedFiles) {
  if (definition.expectedControl) return { control: true, changedSourceFiles: [] };
  const sceneChanged = changedFiles.some((entry) => entry.path === 'src/scenes.ts');
  const selectors = definition.engine === 'native'
    ? [(entry) => entry.path === 'wasm/box3d_web.c' || entry.path === 'src/physics/wasm.ts' || entry.path.startsWith('public/box3d/')]
    : definition.engine === 'fallback'
      ? [(entry) => entry.path === 'src/physics/fallback.ts']
      : definition.engine === 'soft' || definition.engine === 'mixed-soft'
        ? [(entry) => entry.path.startsWith('src/soft/') || entry.path === 'wasm/soft_kernels.c' || entry.path.startsWith('public/soft-kernels-')]
        : definition.engine === 'camera'
          ? [(entry) => entry.path === 'src/camera.ts' || entry.path === 'src/math.ts']
          : definition.engine === 'frame-lines'
            ? [(entry) => entry.path === 'src/frame-lines.ts' || entry.path === 'src/main.ts']
            : definition.engine === 'effects'
              ? [(entry) => entry.path === 'src/effects.ts']
              : definition.engine === 'wasm-wrapper'
                ? [(entry) => entry.path === 'src/physics/wasm.ts']
                : [(entry) => entry.path === 'src/webgpu/renderer.ts' || entry.path.startsWith('src/assets/')];
  const domainFiles = changedFiles.filter((entry) => selectors.some((selector) => selector(entry)));
  if (sceneChanged && ['native', 'fallback', 'soft', 'mixed-soft'].includes(definition.engine)) {
    domainFiles.push(changedFiles.find((entry) => entry.path === 'src/scenes.ts'));
  }
  const unique = [...new Map(domainFiles.filter(Boolean).map((entry) => [entry.path, entry])).values()];
  return { control: unique.length === 0, changedSourceFiles: unique };
}

function provisionalDecision(control, correctness, speedup, confidence, orderBalanced, minimumBatchMs, atCap) {
  if (!correctness) return 'rejected-correctness';
  if (control) return 'control';
  const timingAdequate = minimumBatchMs >= targetBatchMs * 0.9;
  if (!timingAdequate && atCap) return 'timer-floor';
  if (speedup >= 1.03 && confidence.lower > 1 &&
      orderBalanced.baselineFirstRatio >= 0.98 && orderBalanced.candidateFirstRatio >= 0.98) return 'accepted-provisional';
  if (speedup >= 0.98 || confidence.upper >= 1) return 'borderline';
  return 'rejected-no-win';
}

function markdown(result) {
  const lines = [
    `# WebPhysics ${generation} shard ${result.shard}/10`,
    '',
    `Generated: ${result.generatedAt}`,
    '',
    `Cases: **${result.caseCount}**; group: **${result.group}**; smoke: **${result.smokeMode}**.`,
    '',
    `Registry: \`${result.registrySha256}\``,
    '',
    `Candidate source: \`${result.candidateSourceAtStart.sha256}\``,
    '',
    `Harness closure: \`${result.harnessAtStart.sha256}\``,
    '',
    '| ID | Scene | Protocol | Speedup | 95% CI | Min batch | Correct | Decision |',
    '|---:|---|---|---:|---:|---:|---|---|',
  ];
  for (const record of result.records) {
    lines.push(`| ${record.id} | ${record.sceneTitle.replace(/\|/g, '\\|')} | ${record.protocol} | ` +
      `${record.statistics.speedup.toFixed(4)}× | ${record.confidence.lower.toFixed(3)}–${record.confidence.upper.toFixed(3)} | ` +
      `${record.minimumTimedBatchMs.toFixed(2)} ms | ${record.correctness.correct ? 'yes' : 'NO'} | ${record.decision} |`);
  }
  return `${lines.join('\n')}\n`;
}

async function main() {
  const registry = makeRegistry();
  const registrySha256 = registryDigest(registry);
  const harnessAtStart = harnessIdentity();
  const candidateSourceAtStart = manifest(root);
  const rendererGatesAtStart = rendererGateIdentity();
  prepareBaseline();
  prepareCandidate();
  const baselineSource = manifest(baselineRoot);
  const changedFiles = manifestDiff(baselineSource, candidateSourceAtStart);
  const baselineArtifacts = artifactIdentity(baselineRoot, baselineRoot);
  const candidateArtifactsAtStart = artifactIdentity(root, currentAssets);

  let definitions = registry.filter((definition) => definition.shard === requestedShard);
  if (confirmationMode) definitions = definitions.filter((definition) => definition.id === confirmationCaseId);
  if (caseIds.length > 0) definitions = definitions.filter((definition) => caseIds.includes(definition.id));
  if (caseLimit > 0) definitions = definitions.slice(0, caseLimit);
  assert.ok(definitions.length > 0, 'selected shard/case filter is empty');
  if (confirmationMode) {
    assert.equal(definitions.length, 1, 'confirmation process must contain exactly one case');
    assert.equal(definitions[0].shard, requestedShard, 'confirmation case shard mismatch');
  } else if (!smokeMode) {
    assert.equal(definitions.length, 100, 'release shard must contain exactly 100 cases');
  }
  const needNative = definitions.some((definition) => definition.engine === 'native');
  const baseline = await loadProject(
    baselineRoot, path.join(baselineRoot, '.test-build'), baselineRoot, baselineVersion, needNative,
  );
  const candidate = await loadProject(root, currentBuild, currentAssets, 'v1.13-candidate', needNative);
  const executionOrder = shuffled(definitions.map((definition) => definition.id), (0x11300000 ^ requestedShard) >>> 0);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const records = [];
  const started = performance.now();

  for (let executionIndex = 0; executionIndex < executionOrder.length; executionIndex++) {
    const definition = byId.get(executionOrder[executionIndex]);
    const controlInfo = caseControl(definition, changedFiles);
    if (confirmationMode) assert.equal(controlInfo.control, true,
      `case ${definition.id} is not an unchanged control eligible for confirmation`);
    const baselineTrajectory = trajectory(baseline, definition);
    const candidateTrajectory = trajectory(candidate, definition);
    const checkpointCorrectness = compareTrajectories(definition, baselineTrajectory, candidateTrajectory);
    const calibration = calibrate(baseline, candidate, definition);
    const samples = [];
    const baselineFingerprints = [];
    const candidateFingerprints = [];
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
      const baselineFirst = ((executionIndex + sampleIndex) & 1) === 0;
      let baselineMeasured;
      let candidateMeasured;
      if (baselineFirst) {
        baselineMeasured = measureBatch(baseline, definition, calibration.repetitions);
        candidateMeasured = measureBatch(candidate, definition, calibration.repetitions);
      } else {
        candidateMeasured = measureBatch(candidate, definition, calibration.repetitions);
        baselineMeasured = measureBatch(baseline, definition, calibration.repetitions);
      }
      const correctness = compareCapture(definition, baselineMeasured.capture, candidateMeasured.capture);
      baselineFingerprints.push(baselineMeasured.capture.fingerprint);
      candidateFingerprints.push(candidateMeasured.capture.fingerprint);
      samples.push({
        sampleIndex,
        order: baselineFirst ? 'AB' : 'BA',
        baseline: {
          msPerOperation: baselineMeasured.msPerOperation,
          elapsedMs: baselineMeasured.elapsedMs,
          operations: baselineMeasured.operations,
          repetitions: baselineMeasured.repetitions,
          capture: serializeCapture(baselineMeasured.capture),
          pathEvidence: baselineMeasured.pathEvidence,
          repeatedSetupDeterministic: baselineMeasured.repeatedSetupDeterministic,
          withinRunExact: baselineMeasured.withinRunExact,
        },
        candidate: {
          msPerOperation: candidateMeasured.msPerOperation,
          elapsedMs: candidateMeasured.elapsedMs,
          operations: candidateMeasured.operations,
          repetitions: candidateMeasured.repetitions,
          capture: serializeCapture(candidateMeasured.capture),
          pathEvidence: candidateMeasured.pathEvidence,
          repeatedSetupDeterministic: candidateMeasured.repeatedSetupDeterministic,
          withinRunExact: candidateMeasured.withinRunExact,
        },
        correctness,
      });
    }

    const baselineTimes = samples.map((sample) => sample.baseline.msPerOperation);
    const candidateTimes = samples.map((sample) => sample.candidate.msPerOperation);
    const statistics = orderBalancedStatistics(samples);
    const confidence = bootstrap(samples, (0x113d0000 ^ definition.id) >>> 0);
    const minimumTimedBatchMs = Math.min(...samples.flatMap((sample) => [sample.baseline.elapsedMs, sample.candidate.elapsedMs]));
    const baselineDeterministic = new Set(baselineFingerprints).size === 1 &&
      samples.every((sample) => sample.baseline.repeatedSetupDeterministic);
    const candidateDeterministic = new Set(candidateFingerprints).size === 1 &&
      samples.every((sample) => sample.candidate.repeatedSetupDeterministic);
    const unchangedExact = definition.unchangedFrame
      ? samples.every((sample) => sample.baseline.withinRunExact === true && sample.candidate.withinRunExact === true)
      : null;
    const correctness = {
      correct: checkpointCorrectness.correct && samples.every((sample) => sample.correctness.correct) &&
        baselineDeterministic && candidateDeterministic && (unchangedExact !== false),
      checkpoints: checkpointCorrectness.checkpoints,
      sampleCorrectness: samples.map((sample) => sample.correctness),
      baselineDeterministic,
      candidateDeterministic,
      unchangedExact,
    };
    const atCap = calibration.repetitions === calibration.safetyCap;
    const decision = provisionalDecision(
      controlInfo.control, correctness.correct, statistics.speedup, confidence, statistics,
      minimumTimedBatchMs, atCap,
    );
    const record = {
      ...definition,
      sceneTitle: baseline.SCENES[definition.sceneId]?.title || `Native scene ${definition.sceneId}`,
      executionIndex,
      control: controlInfo.control,
      changedSourceFiles: controlInfo.changedSourceFiles,
      baselineMedianMs: median(baselineTimes),
      candidateMedianMs: median(candidateTimes),
      baselineMadMs: mad(baselineTimes),
      candidateMadMs: mad(candidateTimes),
      statistics,
      confidence,
      minimumTimedBatchMs,
      calibration,
      samples,
      checkpointPathEvidence: {
        baseline: checkpointCorrectness.baselinePathEvidence,
        candidate: checkpointCorrectness.candidatePathEvidence,
      },
      correctness,
      decision,
    };
    records.push(record);
    console.log(
      `${String(executionIndex + 1).padStart(3, '0')}/${String(definitions.length).padStart(3, '0')} ` +
      `case ${String(definition.id).padStart(4, '0')} ${definition.group.padEnd(29)} ` +
      `${statistics.speedup.toFixed(3)}x ${decision}`,
    );
  }

  records.sort((a, b) => a.id - b.id);
  const candidateSourceAtEnd = manifest(root);
  const candidateArtifactsAtEnd = artifactIdentity(root, currentAssets);
  const harnessAtEnd = harnessIdentity();
  const rendererGatesAtEnd = rendererGateIdentity();
  const sourceStableDuringRun = candidateSourceAtStart.sha256 === candidateSourceAtEnd.sha256;
  const artifactsStableDuringRun = candidateArtifactsAtStart.sha256 === candidateArtifactsAtEnd.sha256;
  const harnessStableDuringRun = harnessAtStart.sha256 === harnessAtEnd.sha256;
  const rendererGatesStableDuringRun = rendererGatesAtStart.sha256 === rendererGatesAtEnd.sha256;
  assert.equal(sourceStableDuringRun, true, 'candidate production source changed during shard');
  assert.equal(artifactsStableDuringRun, true, 'candidate artifacts changed during shard');
  assert.equal(harnessStableDuringRun, true, 'benchmark harness closure changed during shard');
  assert.equal(rendererGatesStableDuringRun, true, 'renderer Metal validation evidence changed during shard');

  const result = {
    schemaVersion: 1,
    campaign: confirmationMode
      ? 'webphysics-v1.13-material-control-confirmation'
      : 'webphysics-v1.13-production-1000',
    generatedAt: new Date().toISOString(),
    baseline: `${baselineVersion} exact source archive`,
    candidate: 'v1.13 source-frozen working tree',
    shard: requestedShard,
    group: GROUPS[requestedShard - 1],
    smokeMode,
    ...(confirmationMode ? {
      confirmationMode: true,
      confirmationCaseId,
      confirmationRunIndex,
      processEvidence: {
        pid: process.pid,
        parentPid: process.ppid,
        processStartedAt: new Date(performance.timeOrigin).toISOString(),
        processNonce: crypto.randomBytes(24).toString('hex'),
        parentToken: confirmationParentToken,
      },
    } : {}),
    caseCount: records.length,
    registryCaseCount: registry.length,
    registrySha256,
    registryCases: definitions.map((definition) => ({
      id: definition.id,
      semanticSha256: definition.semanticSha256,
      executionTraceSha256: definition.executionTraceSha256,
    })),
    executionOrder,
    baselineArchive: path.relative(root, baselineArchive),
    baselineArchiveSha256: expectedBaselineSha256,
    baselineSource: compactManifest(baselineSource),
    candidateSourceAtStart: compactManifest(candidateSourceAtStart),
    candidateSourceAtEnd: compactManifest(candidateSourceAtEnd),
    changedFiles,
    harnessAtStart,
    harnessAtEnd,
    rendererGatesAtStart,
    rendererGatesAtEnd,
    baselineArtifacts,
    candidateArtifactsAtStart,
    candidateArtifactsAtEnd,
    sourceStableDuringRun,
    artifactsStableDuringRun,
    harnessStableDuringRun,
    rendererGatesStableDuringRun,
    environment: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
      cpuModel: os.cpus()[0]?.model || 'unknown',
      logicalCores: os.cpus().length,
      typescriptVersion: JSON.parse(fs.readFileSync(path.join(root, 'node_modules/typescript/package.json'), 'utf8')).version,
      typescriptPackageSha256: sha256File(path.join(root, 'node_modules/typescript/package.json')),
    },
    methodology: {
      samples: sampleCount,
      workloadScale,
      targetBatchMs,
      bootstrapCount,
      order: 'equal AB and BA samples per case; deterministic shuffled case order per shard',
      timing: 'warmup, outer subject construction, capture, compilation, and process startup excluded; case-defined world creation is inside the timed production operation',
      correctness: 'four deterministic trajectory checkpoints plus every timed-sample final capture',
      acceptance: 'provisional >=1.03x, lower 95% bound >1, both order strata >=0.98; merged checker applies global multiplicity and control gates',
      controlGate: 'eligible controls require >=0.98x aggregate and per-group geometric means; a <0.94x individual regression surviving global one-sided Benjamini-Hochberg q<=0.05 screening receives eight independent fresh-process confirmations and fails only when its Bonferroni familywise upper bootstrap bound remains <0.94x',
      ...(confirmationMode ? {
        confirmation: 'one control in one fresh process; >=4 balanced AB/BA samples, >=25 ms target, >=1024 repetition cap, semantic scale 1; merger aggregates eight process-level order-balanced speedups',
      } : {}),
    },
    observableSink,
    elapsedSeconds: (performance.now() - started) / 1000,
    summary: {
      acceptedProvisional: records.filter((record) => record.decision === 'accepted-provisional').length,
      controls: records.filter((record) => record.decision === 'control').length,
      correctnessFailures: records.filter((record) => !record.correctness.correct).length,
      timerFloor: records.filter((record) => record.decision === 'timer-floor').length,
      geometricMean: geometricMean(records.map((record) => record.statistics.speedup)),
      minimumTimedBatchMs: Math.min(...records.map((record) => record.minimumTimedBatchMs)),
    },
    records,
  };

  fs.mkdirSync(path.dirname(outputPrefix), { recursive: true });
  fs.writeFileSync(`${outputPrefix}.json`, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(`${outputPrefix}.md`, markdown(result));
  console.log(`wrote ${outputPrefix}.json`);
  console.log(`wrote ${outputPrefix}.md`);
  if (result.summary.correctnessFailures > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  })
  .finally(() => {
    if (process.env.V113_KEEP_TEMP === '1') {
      console.error(`kept temporary trees: ${tempRoot}`);
    } else {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
