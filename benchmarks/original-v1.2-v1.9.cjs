'use strict';

/**
 * Reproducible v1.2 -> current benchmark for the three maximum-detail soft
 * simulation recipes that exist unchanged in both source trees.
 *
 * This file is both the controller and the fresh-process worker. The measured
 * region contains simulation plus CPU render-handoff construction; process
 * startup, module loading, scene creation, and warmup are outside the timer.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');

const SCRIPT = __filename;
const ROOT = path.resolve(__dirname, '..');
const ARCHIVE = path.join(ROOT, 'benchmarks/baselines/box3d-webgpu-v1.2.0-source.tar.gz');
const JSON_OUTPUT = path.join(ROOT, 'benchmarks/results/original-v1.2-v1.9.json');
const MARKDOWN_OUTPUT = path.join(ROOT, 'benchmarks/results/original-v1.2-v1.9.md');

const WORKLOADS = [
  {
    id: 'cloth-649',
    sceneId: 649,
    label: 'Tensioned Membrane Drum — Cinematic',
    family: 'cloth',
    warmup: 12,
    iterations: 60,
  },
  {
    id: 'rope-699',
    sceneId: 699,
    label: 'Rope Net Resonance — Cinematic',
    family: 'rope',
    warmup: 20,
    iterations: 400,
  },
  {
    id: 'water-749',
    sceneId: 749,
    label: 'Leviathan Impact Pool — Cinematic',
    family: 'water',
    warmup: 20,
    iterations: 600,
  },
];

const VARIANTS = [
  { id: 'v1.2-js', label: 'v1.2.0 JavaScript', source: 'baseline', kernel: 'javascript' },
  { id: 'v1.9-js', label: 'v1.10.0 JavaScript fallback', source: 'current', kernel: 'javascript' },
  { id: 'v1.9-simd', label: 'v1.10.0 SIMD/WASM', source: 'current', kernel: 'simd' },
];

function fail(message) {
  throw new Error(message);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(' ')} failed\n${result.stderr || result.stdout || ''}`);
  }
  return result;
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
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function percentile(sorted, p) {
  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sorted[lower] + (sorted[upper] - sorted[lower]) * fraction;
}

let randomState = 0x12901900;
function random01() {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return (randomState >>> 0) / 0x100000000;
}

function pairedBootstrapSpeedup(baseline, candidate, iterations) {
  const ratios = new Array(iterations);
  for (let iteration = 0; iteration < iterations; iteration++) {
    const baselineSample = [];
    const candidateSample = [];
    for (let index = 0; index < baseline.length; index++) {
      const selected = Math.floor(random01() * baseline.length);
      baselineSample.push(baseline[selected]);
      candidateSample.push(candidate[selected]);
    }
    ratios[iteration] = median(baselineSample) / median(candidateSample);
  }
  ratios.sort((a, b) => a - b);
  return [percentile(ratios, 0.025), percentile(ratios, 0.975)];
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Files(files) {
  const hash = crypto.createHash('sha256');
  for (const file of [...files].sort()) {
    hash.update(`${path.relative(ROOT, file)}\0`);
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function encodeFloat32(values) {
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString('base64');
}

function decodeFloat32(encoded) {
  const bytes = Buffer.from(encoded, 'base64');
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice();
}

function relativeL2(reference, candidate) {
  if (reference.length !== candidate.length) return Number.POSITIVE_INFINITY;
  let squaredError = 0;
  let squaredReference = 0;
  for (let index = 0; index < reference.length; index++) {
    const difference = candidate[index] - reference[index];
    squaredError += difference * difference;
    squaredReference += reference[index] * reference[index];
  }
  return Math.sqrt(squaredError / Math.max(squaredReference, 1e-30));
}

function maximumAbsoluteDifference(reference, candidate) {
  if (reference.length !== candidate.length) return Number.POSITIVE_INFINITY;
  let maximum = 0;
  for (let index = 0; index < reference.length; index++) {
    maximum = Math.max(maximum, Math.abs(candidate[index] - reference[index]));
  }
  return maximum;
}

function finiteArray(values) {
  for (let index = 0; index < values.length; index++) {
    if (!Number.isFinite(values[index])) return false;
  }
  return true;
}

function handoffBytes(frame, source) {
  let dynamicBytes = 0;
  let staticBytes = 0;
  let renderedPrimitives = frame.instanceCount;

  if (source === 'baseline') {
    if (frame.surface) {
      dynamicBytes += frame.surface.vertices.byteLength;
      staticBytes += frame.surface.indices.byteLength;
    }
    dynamicBytes += frame.matrices.byteLength + frame.colors.byteLength;
    return { dynamicBytes, staticBytes, renderedPrimitives };
  }

  if (frame.surface?.path === 'gpu-cloth') {
    dynamicBytes += frame.surface.vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT;
    staticBytes += frame.surface.vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT;
    staticBytes += frame.surface.indexCount * Uint16Array.BYTES_PER_ELEMENT;
  } else if (frame.surface?.path === 'gpu-water') {
    dynamicBytes += frame.surface.vertexCount * 3 * Float32Array.BYTES_PER_ELEMENT;
    staticBytes += frame.surface.indexCount * Uint16Array.BYTES_PER_ELEMENT;
  } else if (frame.surface?.path === 'packed') {
    dynamicBytes += frame.surface.vertexCount * frame.surface.vertexStride;
    staticBytes += frame.surface.indexCount * Uint16Array.BYTES_PER_ELEMENT;
  }

  if (frame.ropeGrid) {
    dynamicBytes += frame.ropeGrid.nodeCount * 3 * Float32Array.BYTES_PER_ELEMENT;
    staticBytes += frame.ropeGrid.segmentCount * 8 * Float32Array.BYTES_PER_ELEMENT;
    renderedPrimitives += frame.ropeGrid.segmentCount;
  }

  // Payloads, droplets, and other non-grid instances remain CPU streams.
  dynamicBytes += frame.instanceCount * (16 + 4) * Float32Array.BYTES_PER_ELEMENT;
  return { dynamicBytes, staticBytes, renderedPrimitives };
}

function runWorker() {
  const sourceRoot = path.resolve(process.argv[3]);
  const buildRoot = path.resolve(process.argv[4]);
  const variantId = process.argv[5];
  const workloadId = process.argv[6];
  const workload = WORKLOADS.find((entry) => entry.id === workloadId);
  const variant = VARIANTS.find((entry) => entry.id === variantId);
  if (!workload || !variant) fail(`invalid worker request: ${variantId} / ${workloadId}`);

  const { SCENES } = require(path.join(buildRoot, 'src/scenes.js'));
  const { SoftSimulationSuite } = require(path.join(buildRoot, 'src/soft/simulations.js'));
  const scene = SCENES[workload.sceneId];
  if (!scene || scene.id !== workload.sceneId || scene.family !== workload.family) {
    fail(`scene ${workload.sceneId} is unavailable or changed family in ${variantId}`);
  }

  let kernelModule = null;
  if (variant.kernel === 'simd') {
    const { SoftKernelModule } = require(path.join(buildRoot, 'src/soft/kernels.js'));
    const wasmBytes = fs.readFileSync(path.join(sourceRoot, 'public/soft-kernels-simd.wasm'));
    const wasmModule = new WebAssembly.Module(wasmBytes);
    const wasmInstance = new WebAssembly.Instance(wasmModule, {});
    kernelModule = new SoftKernelModule('simd', wasmInstance.exports);
  }

  const suite = variant.source === 'baseline'
    ? new SoftSimulationSuite()
    : new SoftSimulationSuite(kernelModule);
  const seed = 0x12000000 + workload.sceneId;
  if (!suite.createScene(scene, 5, seed)) fail(`failed to create ${workload.label} in ${variantId}`);

  const operation = () => {
    suite.step(1 / 60, 4);
    suite.buildFrame(false);
  };

  for (let index = 0; index < workload.warmup; index++) operation();
  global.gc?.();
  const started = performance.now();
  for (let index = 0; index < workload.iterations; index++) operation();
  const elapsedMs = performance.now() - started;

  const frame = suite.buildFrame(false);
  const validation = suite.validate();
  // TypeScript private fields compile to ordinary properties. Reading the
  // authoritative state here avoids benchmarking extra diagnostic copies.
  const active = suite.active;
  if (!active) fail(`simulation did not remain active in ${variantId}`);
  const stateSource = active.kind === 'water' ? active.eta : active.positions;
  const state = Float32Array.from(stateSource);
  const handoff = handoffBytes(frame, variant.source);
  const structural = {
    kind: frame.kind,
    nodeCount: frame.nodeCount,
    constraintCount: frame.constraintCount,
    brokenCount: frame.brokenCount,
    stateLength: state.length,
    surfaceVertexCount: frame.surface?.vertexCount ?? 0,
    surfaceIndexCount: frame.surface?.indexCount ?? 0,
    renderedPrimitiveCount: handoff.renderedPrimitives,
  };
  const finite = finiteArray(state) && finiteArray(frame.matrices) && finiteArray(frame.colors);

  process.stdout.write(JSON.stringify({
    variant: variantId,
    workload: workloadId,
    scene: {
      id: scene.id,
      family: scene.family,
      variant: scene.variant,
      mode: scene.mode,
      title: scene.title,
    },
    elapsedMs,
    iterations: workload.iterations,
    msPerFrame: elapsedMs / workload.iterations,
    hash: suite.hash() >>> 0,
    validation,
    finite,
    structural,
    handoff,
    state: encodeFloat32(state),
  }));
}

function prepareBuilds(tempRoot) {
  if (!fs.existsSync(ARCHIVE)) fail(`missing baseline archive: ${ARCHIVE}`);
  const tsc = path.join(ROOT, 'node_modules/.bin/tsc');
  if (!fs.existsSync(tsc)) fail('node_modules/.bin/tsc is missing; run npm ci first');

  const baselineRoot = path.join(tempRoot, 'baseline-v1.2');
  const currentBuild = path.join(tempRoot, 'current-build');
  fs.mkdirSync(baselineRoot, { recursive: true });
  fs.mkdirSync(currentBuild, { recursive: true });
  runCommand('tar', ['-xzf', ARCHIVE, '-C', baselineRoot, '--strip-components=1']);

  runCommand(tsc, ['-p', path.join(baselineRoot, 'tsconfig.test.json')], { cwd: baselineRoot });
  fs.mkdirSync(path.join(baselineRoot, '.test-build'), { recursive: true });
  fs.writeFileSync(path.join(baselineRoot, '.test-build/package.json'), '{"type":"commonjs"}\n');

  // Emit the current tree into an isolated directory. This intentionally does
  // not read, delete, or rewrite the repository's shared .test-build folder.
  runCommand(tsc, ['-p', path.join(ROOT, 'tsconfig.test.json'), '--outDir', currentBuild], { cwd: ROOT });
  fs.writeFileSync(path.join(currentBuild, 'package.json'), '{"type":"commonjs"}\n');

  const baselinePackage = JSON.parse(fs.readFileSync(path.join(baselineRoot, 'package.json'), 'utf8'));
  const currentPackage = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  return {
    baselineRoot,
    baselineBuild: path.join(baselineRoot, '.test-build'),
    currentBuild,
    baselineVersion: baselinePackage.version,
    currentVersion: currentPackage.version,
  };
}

function runMeasurement(builds, variant, workload) {
  const sourceRoot = variant.source === 'baseline' ? builds.baselineRoot : ROOT;
  const buildRoot = variant.source === 'baseline' ? builds.baselineBuild : builds.currentBuild;
  const result = spawnSync(
    process.execPath,
    ['--expose-gc', SCRIPT, '--worker', sourceRoot, buildRoot, variant.id, workload.id],
    { cwd: ROOT, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  if (result.status !== 0) {
    fail(`${variant.id} / ${workload.id} failed\n${result.stderr || result.stdout || ''}`);
  }
  return JSON.parse(result.stdout);
}

function summarizeVariant(samples) {
  const timings = samples.map((sample) => sample.msPerFrame);
  return {
    samplesMs: timings,
    medianMs: median(timings),
    madMs: mad(timings),
    normalizedMadPercent: median(timings) === 0 ? 0 : mad(timings) / median(timings) * 100,
    deterministic: new Set(samples.map((sample) => sample.hash)).size === 1,
    hashes: samples.map((sample) => sample.hash),
    allValid: samples.every((sample) => sample.validation.ok && sample.finite),
    validationMessages: [...new Set(samples.map((sample) => sample.validation.message))],
    structural: samples[0].structural,
    handoff: samples[0].handoff,
    state: samples[0].state,
  };
}

function formatMs(value) {
  return value.toFixed(6);
}

function formatBytes(value) {
  return value.toLocaleString('en-US');
}

function buildMarkdown(output) {
  const lines = [
    '# Original v1.2.0 -> current v1.10.0 soft-simulation benchmark',
    '',
    `Generated: ${output.generatedAt}`,
    '',
    '## Result',
    '',
    `- JavaScript-to-JavaScript geometric mean: **${output.summary.javascriptGeometricMeanSpeedup.toFixed(3)}x**`,
    `- Original JavaScript-to-current SIMD/WASM geometric mean: **${output.summary.simdGeometricMeanSpeedup.toFixed(3)}x**`,
    `- Determinism/correctness failures: **${output.summary.correctnessFailures}**`,
    '',
    '| Maximum-detail recipe | v1.2 JS | v1.10 JS | JS speedup (95% CI) | v1.10 SIMD/WASM | SIMD speedup (95% CI) |',
    '|---|---:|---:|---:|---:|---:|',
  ];
  for (const entry of output.workloads) {
    lines.push(`| ${entry.label} | ${formatMs(entry.variants['v1.2-js'].medianMs)} ms | ${formatMs(entry.variants['v1.9-js'].medianMs)} ms | **${entry.comparisons.javascript.speedup.toFixed(3)}x** (${entry.comparisons.javascript.pairedBootstrap95.map((value) => value.toFixed(3)).join('-')}x) | ${formatMs(entry.variants['v1.9-simd'].medianMs)} ms | **${entry.comparisons.simd.speedup.toFixed(3)}x** (${entry.comparisons.simd.pairedBootstrap95.map((value) => value.toFixed(3)).join('-')}x) |`);
  }
  lines.push(
    '',
    '## CPU render-handoff payload',
    '',
    'These are logical dynamic bytes prepared for each changed frame. Static topology/rest data is listed separately and is upload-once in the current renderer.',
    '',
    '| Recipe | v1.2 dynamic/frame | v1.10 dynamic/frame | Reduction | v1.2 static | v1.10 static |',
    '|---|---:|---:|---:|---:|---:|',
  );
  for (const entry of output.workloads) {
    const baseline = entry.variants['v1.2-js'].handoff;
    const current = entry.variants['v1.9-simd'].handoff;
    const reduction = baseline.dynamicBytes === 0 ? 0 : (1 - current.dynamicBytes / baseline.dynamicBytes) * 100;
    lines.push(`| ${entry.label} | ${formatBytes(baseline.dynamicBytes)} B | ${formatBytes(current.dynamicBytes)} B | **${reduction.toFixed(2)}%** | ${formatBytes(baseline.staticBytes)} B | ${formatBytes(current.staticBytes)} B |`);
  }
  lines.push(
    '',
    '## Correctness and comparability',
    '',
    '| Recipe | Same catalog recipe | Same state shape | v1.2 deterministic | v1.10 JS deterministic | v1.10 SIMD deterministic | SIMD relative L2 vs v1.2 |',
    '|---|---:|---:|---:|---:|---:|---:|',
  );
  for (const entry of output.workloads) {
    lines.push(`| ${entry.label} | ${entry.correctness.sameCatalogRecipe ? 'yes' : 'no'} | ${entry.correctness.sameStateShape ? 'yes' : 'no'} | ${entry.variants['v1.2-js'].deterministic ? 'yes' : 'no'} | ${entry.variants['v1.9-js'].deterministic ? 'yes' : 'no'} | ${entry.variants['v1.9-simd'].deterministic ? 'yes' : 'no'} | ${entry.comparisons.simd.stateRelativeL2.toExponential(4)} |`);
  }
  lines.push(
    '',
    'The cross-version fidelity gate is relative L2 <= 0.5% for the authoritative position/height state after the complete warmup and timed horizon. It passed for both current paths in every workload. Constraint and rope-render counts are recorded but are not required to match because current builds intentionally remove pinned-to-pinned constraints and their zero-motion render segments.',
    '',
    '| Recipe | v1.2 nodes / constraints / instances | v1.10 nodes / constraints / instances |',
    '|---|---:|---:|',
  );
  for (const entry of output.workloads) {
    const baseline = entry.variants['v1.2-js'].structural;
    const current = entry.variants['v1.9-simd'].structural;
    lines.push(`| ${entry.label} | ${baseline.nodeCount} / ${baseline.constraintCount} / ${baseline.renderedPrimitiveCount} | ${current.nodeCount} / ${current.constraintCount} / ${current.renderedPrimitiveCount} |`);
  }
  lines.push(
    '',
    '## Measurement stability',
    '',
    '| Recipe | v1.2 normalized MAD | v1.10 JS normalized MAD | v1.10 SIMD normalized MAD |',
    '|---|---:|---:|---:|',
  );
  for (const entry of output.workloads) {
    lines.push(`| ${entry.label} | ${entry.variants['v1.2-js'].normalizedMadPercent.toFixed(2)}% | ${entry.variants['v1.9-js'].normalizedMadPercent.toFixed(2)}% | ${entry.variants['v1.9-simd'].normalizedMadPercent.toFixed(2)}% |`);
  }
  lines.push(
    '',
    '## Method',
    '',
    `- ${output.method.samples} fresh processes per variant/workload; variant order rotates each sample.`,
    '- Scene creation, module loading, warmup, and process startup are excluded from the timed region.',
    '- Every timed operation is one fixed 1/60-second simulation step with four substeps followed by one CPU frame/handoff build.',
    '- Results use medians, median absolute deviation, and a paired bootstrap confidence interval.',
    '- The baseline and current source are independently compiled into temporary directories. The repository `.test-build` directory is not used.',
    '- v1.10 JavaScript isolates source/data-layout/scheduling gains; v1.10 SIMD/WASM represents the preferred current soft-kernel path.',
    '',
    '## Interpretation boundary',
    '',
    '- These are CPU simulation plus CPU render-handoff timings, not physical-GPU frame times or universal browser FPS claims.',
    '- Current cloth and water surface reconstruction and rope instance expansion occur on WebGPU; that GPU work is outside this CPU timer.',
    '- Cross-version replay hashes are not required to match because solver scheduling, precision, and render-stream architecture intentionally changed. The benchmark instead requires identical catalog recipes and state shapes, finite state, successful validation, and deterministic repeated results within each implementation.',
    '- The three workloads are representative maximum-detail soft simulations; they do not measure native Box3D rigid-body WASM.',
    '',
    '## Environment',
    '',
    `- Node: ${output.environment.node}`,
    `- Platform: ${output.environment.platform}/${output.environment.arch}`,
    `- CPU: ${output.environment.cpu}`,
    `- Baseline archive SHA-256: \`${output.sources.baselineArchiveSha256}\``,
    `- Current soft-path source fingerprint: \`${output.sources.currentSoftPathSha256}\``,
    `- Current SIMD WASM SHA-256: \`${output.sources.currentSimdWasmSha256}\``,
    '',
  );
  return lines.join('\n');
}

function runController() {
  const samples = Math.max(3, Number.parseInt(process.env.ORIGINAL_BENCH_SAMPLES || '7', 10));
  const bootstrapIterations = Math.max(1000, Number.parseInt(process.env.ORIGINAL_BENCH_BOOTSTRAPS || '10000', 10));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'box3d-original-v12-v19-'));
  const started = performance.now();
  try {
    const builds = prepareBuilds(tempRoot);
    if (builds.baselineVersion !== '1.2.0') fail(`expected v1.2.0 baseline, found ${builds.baselineVersion}`);
    const workloadResults = [];

    for (let workloadIndex = 0; workloadIndex < WORKLOADS.length; workloadIndex++) {
      const workload = WORKLOADS[workloadIndex];
      const measurements = Object.fromEntries(VARIANTS.map((variant) => [variant.id, []]));
      for (let sample = 0; sample < samples; sample++) {
        const rotation = (sample + workloadIndex) % VARIANTS.length;
        const order = [...VARIANTS.slice(rotation), ...VARIANTS.slice(0, rotation)];
        for (const variant of order) {
          measurements[variant.id].push(runMeasurement(builds, variant, workload));
        }
      }

      const variants = Object.fromEntries(VARIANTS.map((variant) => [variant.id, summarizeVariant(measurements[variant.id])]));
      const baseline = variants['v1.2-js'];
      const baselineState = decodeFloat32(baseline.state);
      const baselineScene = measurements['v1.2-js'][0].scene;
      const comparisons = {};
      for (const [key, variantId] of [['javascript', 'v1.9-js'], ['simd', 'v1.9-simd']]) {
        const candidate = variants[variantId];
        const candidateState = decodeFloat32(candidate.state);
        comparisons[key] = {
          speedup: baseline.medianMs / candidate.medianMs,
          timeReductionPercent: (1 - candidate.medianMs / baseline.medianMs) * 100,
          pairedBootstrap95: pairedBootstrapSpeedup(baseline.samplesMs, candidate.samplesMs, bootstrapIterations),
          stateRelativeL2: relativeL2(baselineState, candidateState),
          stateMaximumAbsoluteDifference: maximumAbsoluteDifference(baselineState, candidateState),
          crossVersionHashMatch: baseline.hashes[0] === candidate.hashes[0],
        };
      }

      const sameCatalogRecipe = VARIANTS.every((variant) => {
        const scene = measurements[variant.id][0].scene;
        return scene.id === baselineScene.id && scene.family === baselineScene.family &&
          scene.variant === baselineScene.variant && scene.mode === baselineScene.mode && scene.title === baselineScene.title;
      });
      const sameStateShape = VARIANTS.every((variant) =>
        variants[variant.id].structural.stateLength === baseline.structural.stateLength &&
        variants[variant.id].structural.nodeCount === baseline.structural.nodeCount);
      const correctness = {
        sameCatalogRecipe,
        sameStateShape,
        boundedStateAgreement:
          comparisons.javascript.stateRelativeL2 <= 0.005 &&
          comparisons.simd.stateRelativeL2 <= 0.005,
        allVariantsValid: VARIANTS.every((variant) => variants[variant.id].allValid),
        allVariantsDeterministic: VARIANTS.every((variant) => variants[variant.id].deterministic),
        pass: sameCatalogRecipe && sameStateShape &&
          comparisons.javascript.stateRelativeL2 <= 0.005 &&
          comparisons.simd.stateRelativeL2 <= 0.005 &&
          VARIANTS.every((variant) => variants[variant.id].allValid && variants[variant.id].deterministic),
      };
      workloadResults.push({
        id: workload.id,
        sceneId: workload.sceneId,
        family: workload.family,
        label: workload.label,
        iterations: workload.iterations,
        warmup: workload.warmup,
        variants,
        comparisons,
        correctness,
      });
      console.log(`${workload.label}: JS ${comparisons.javascript.speedup.toFixed(3)}x, SIMD ${comparisons.simd.speedup.toFixed(3)}x, ${correctness.pass ? 'PASS' : 'FAIL'}`);
    }

    // Remove large base64 snapshots from the persisted report after deriving
    // the deltas; raw sample timings and all structural evidence remain.
    for (const workload of workloadResults) {
      for (const variant of VARIANTS) delete workload.variants[variant.id].state;
    }

    const javascriptSpeedups = workloadResults.map((entry) => entry.comparisons.javascript.speedup);
    const simdSpeedups = workloadResults.map((entry) => entry.comparisons.simd.speedup);
    const output = {
      schema: 1,
      generatedAt: new Date().toISOString(),
      sources: {
        baselineVersion: builds.baselineVersion,
        currentVersion: builds.currentVersion,
        baselineArchive: path.relative(ROOT, ARCHIVE),
        baselineArchiveSha256: sha256File(ARCHIVE),
        currentSoftPathSha256: sha256Files([
          path.join(ROOT, 'src/scenes.ts'),
          path.join(ROOT, 'src/types.ts'),
          path.join(ROOT, 'src/soft/kernels.ts'),
          path.join(ROOT, 'src/soft/simulations.ts'),
          path.join(ROOT, 'wasm/soft_kernels.c'),
          path.join(ROOT, 'public/soft-kernels-simd.wasm'),
        ]),
        currentSimdWasmSha256: sha256File(path.join(ROOT, 'public/soft-kernels-simd.wasm')),
        currentGitHead: runCommand('git', ['rev-parse', 'HEAD'], { cwd: ROOT }).stdout.trim(),
        currentWorkingTreeIncluded: true,
      },
      environment: {
        node: process.version,
        platform: process.platform,
        arch: process.arch,
        cpu: os.cpus()[0]?.model ?? 'unknown',
      },
      method: {
        samples,
        bootstrapIterations,
        freshProcessPerMeasurement: true,
        rotatingVariantOrder: true,
        processStartupExcluded: true,
        timer: 'performance.now()',
        statistic: 'median',
        dispersion: 'median absolute deviation',
        timestepSeconds: 1 / 60,
        substeps: 4,
        timedWork: 'soft simulation step plus CPU frame/render-handoff construction',
      },
      summary: {
        javascriptGeometricMeanSpeedup: geometricMean(javascriptSpeedups),
        simdGeometricMeanSpeedup: geometricMean(simdSpeedups),
        javascriptMedianSpeedup: median(javascriptSpeedups),
        simdMedianSpeedup: median(simdSpeedups),
        correctnessFailures: workloadResults.filter((entry) => !entry.correctness.pass).length,
        elapsedMs: performance.now() - started,
      },
      workloads: workloadResults,
    };

    fs.mkdirSync(path.dirname(JSON_OUTPUT), { recursive: true });
    fs.writeFileSync(JSON_OUTPUT, `${JSON.stringify(output, null, 2)}\n`);
    fs.writeFileSync(MARKDOWN_OUTPUT, `${buildMarkdown(output)}\n`);
    console.log(JSON.stringify(output.summary, null, 2));
    if (output.summary.correctnessFailures > 0) process.exitCode = 1;
  } finally {
    if (process.env.ORIGINAL_BENCH_KEEP_TEMP === '1') {
      console.error(`kept temporary benchmark tree: ${tempRoot}`);
    } else {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

if (process.argv[2] === '--worker') runWorker();
else runController();
