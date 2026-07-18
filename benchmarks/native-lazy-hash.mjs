import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const bundledBaselineDir = path.join(root, 'benchmarks', 'baselines', 'native-v1.10-lazy-hash');
const baselineDir = path.resolve(
  process.env.B3W_NATIVE_BASELINE_DIR ?? bundledBaselineDir,
);
const optimizedDir = path.resolve(
  process.env.B3W_NATIVE_OPTIMIZED_DIR ?? path.join(root, 'public', 'box3d'),
);
const outputDir = path.resolve(
  process.env.B3W_NATIVE_BENCH_OUTPUT_DIR ?? path.join(root, 'benchmarks', 'results'),
);

const expectedBaseline = Object.freeze({
  'box3d.js': '116e03dfee941b27fc9801dc598a21c4af1f1c2e32571f9777493bd8c7a81dff',
  'box3d.wasm': 'e9ae9984286b3549719443294fe1a18e9067391da2afc93a2cd783aa56117c3c',
});

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer (received ${process.env[name]}).`);
  }
  return value;
}

const samplesPerArtifact = positiveInteger('B3W_NATIVE_BENCH_SAMPLES', 15);
const sceneId = positiveInteger('B3W_NATIVE_BENCH_SCENE_ID', 3);
const stress = positiveInteger('B3W_NATIVE_BENCH_STRESS', 5);
const seed = 0x515151;

const scenarios = [
  { id: 'sync-only', label: 'Sync only', iterations: positiveInteger('B3W_NATIVE_SYNC_ITERATIONS', 250), hashPeriod: 0 },
  { id: 'hash-every-12-syncs', label: 'Hash every 12 syncs', iterations: positiveInteger('B3W_NATIVE_HASH12_ITERATIONS', 240), hashPeriod: 12 },
  { id: 'hash-every-sync', label: 'Hash every sync', iterations: positiveInteger('B3W_NATIVE_HASH1_ITERATIONS', 120), hashPeriod: 1 },
];

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function artifactInfo(dir, expectedHashes = undefined) {
  const files = {};
  for (const name of ['box3d.js', 'box3d.wasm']) {
    const filePath = path.join(dir, name);
    if (!fs.existsSync(filePath)) {
      const expected = expectedHashes
        ? ` Expected SHA-256: ${expectedHashes[name]}.`
        : '';
      throw new Error(
        `Missing ${filePath}.${expected} Supply the pre-change directory with B3W_NATIVE_BASELINE_DIR when benchmarking a saved baseline.`,
      );
    }
    const bytes = fs.readFileSync(filePath);
    const digest = sha256(bytes);
    if (expectedHashes && digest !== expectedHashes[name]) {
      throw new Error(`${filePath} SHA-256 ${digest} does not match the required pre-change artifact ${expectedHashes[name]}.`);
    }
    files[name] = { path: filePath, bytes: bytes.byteLength, sha256: digest };
  }
  const provenancePath = path.join(dir, 'BUILD_PROVENANCE.json');
  return {
    directory: dir,
    files,
    provenance: fs.existsSync(provenancePath)
      ? JSON.parse(fs.readFileSync(provenancePath, 'utf8'))
      : null,
  };
}

async function loadModule(artifacts, tag) {
  const factoryUrl = `${pathToFileURL(artifacts.files['box3d.js'].path).href}?native-lazy-hash=${tag}-${Date.now()}`;
  const factory = (await import(factoryUrl)).default;
  if (typeof factory !== 'function') throw new Error(`${factoryUrl} did not export an Emscripten factory.`);
  const wasmBinary = fs.readFileSync(artifacts.files['box3d.wasm'].path);
  if (!WebAssembly.validate(wasmBinary)) throw new Error(`${artifacts.files['box3d.wasm'].path} is not valid WebAssembly.`);
  const module = await factory({ wasmBinary });
  for (const name of [
    '_b3w_create_scene',
    '_b3w_body_count',
    '_b3w_matrices_ptr',
    '_b3w_sync_transforms',
    '_b3w_replay_hash',
    '_b3w_destroy',
  ]) {
    if (typeof module[name] !== 'function') throw new Error(`${tag} module is missing ${name}.`);
  }
  return module;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) * 0.5
    : sorted[middle];
}

function summarize(values) {
  const center = median(values);
  return {
    medianMsPerSync: center,
    madMsPerSync: median(values.map((value) => Math.abs(value - center))),
    minMsPerSync: Math.min(...values),
    maxMsPerSync: Math.max(...values),
    rawMsPerSync: values,
  };
}

function runSample(module, iterations, hashPeriod) {
  const started = performance.now();
  for (let iteration = 0; iteration < iterations; iteration++) {
    module._b3w_sync_transforms();
    if (hashPeriod > 0 && (iteration + 1) % hashPeriod === 0) module._b3w_replay_hash();
  }
  return (performance.now() - started) / iterations;
}

function exactMatrixComparison(baseline, optimized, bodyCount) {
  const matrixWords = bodyCount * 16;
  const baselineStart = Number(baseline._b3w_matrices_ptr()) >>> 2;
  const optimizedStart = Number(optimized._b3w_matrices_ptr()) >>> 2;
  const baselineBits = new Uint32Array(baseline.HEAPF32.buffer);
  const optimizedBits = new Uint32Array(optimized.HEAPF32.buffer);
  for (let index = 0; index < matrixWords; index++) {
    if (baselineBits[baselineStart + index] !== optimizedBits[optimizedStart + index]) {
      throw new Error(`Matrix bit mismatch at float ${index}.`);
    }
  }
  return matrixWords;
}

function format(value, digits = 6) {
  return Number(value).toFixed(digits);
}

function markdown(result) {
  const rows = result.results.map((entry) => {
    const direction = entry.speedup >= 1
      ? `${format(entry.speedup, 2)}x faster`
      : `${format((entry.optimized.medianMsPerSync / entry.baseline.medianMsPerSync - 1) * 100, 1)}% slower`;
    return `| ${entry.label} | ${format(entry.baseline.medianMsPerSync)} ms | ${format(entry.optimized.medianMsPerSync)} ms | **${direction}** |`;
  }).join('\n');
  const baselineLocation = result.artifacts.baselineBundledInRepository
    ? `The pre-change binary is bundled as the benchmark-only fixture at \`${path.relative(root, result.artifacts.baseline.directory)}\`. It is not loaded by the application.`
    : `The pre-change binary is external to the repository at \`${result.artifacts.baseline.directory}\`.`;
  const rerunCommand = result.artifacts.baselineBundledInRepository
    ? 'node benchmarks/native-lazy-hash.mjs'
    : 'B3W_NATIVE_BASELINE_DIR=/path/to/pre-change-box3d node benchmarks/native-lazy-hash.mjs';

  return `# Native Box3D lazy replay-hash benchmark

This benchmark isolates the exported \`b3w_sync_transforms\` bridge path. It is not a whole-physics-frame or GPU benchmark.

## Result

| Scenario | Pre-change | Lazy hash | Result |
|---|---:|---:|---:|
${rows}

## Correctness

- Bodies: ${result.correctness.bodyCount}
- Matrix floats compared bit-for-bit: ${result.correctness.matrixFloats}
- Exact matrix bits: ${result.correctness.exactMatrixBits}
- Matching replay hash: \`${result.correctness.replayHash}\`

## Method

- ${result.method.samplesPerArtifact} timed samples per artifact
- Alternating baseline-first / optimized-first measurement order
- ${result.method.warmupIterations} warm-up syncs before each scenario
- Scene ${result.method.sceneId}, stress ${result.method.stress}, seed \`0x${result.method.seed.toString(16)}\`
- Host: ${result.host.cpu}; ${result.host.platform}/${result.host.arch}; Node ${result.host.node}

## Baseline provenance

${baselineLocation} The script requires these identities:

- \`box3d.js\`: \`${result.artifacts.baseline.files['box3d.js'].sha256}\`
- \`box3d.wasm\`: \`${result.artifacts.baseline.files['box3d.wasm'].sha256}\`

Run:

\`\`\`bash
${rerunCommand}
\`\`\`

The hash-every-sync control is intentionally retained. Lazy hashing only helps when replay-hash requests are less frequent than transform synchronization; it can regress when callers immediately request a hash after every sync.
`;
}

const baselineArtifacts = artifactInfo(baselineDir, expectedBaseline);
const optimizedArtifacts = artifactInfo(optimizedDir);
const modules = {
  baseline: await loadModule(baselineArtifacts, 'baseline'),
  optimized: await loadModule(optimizedArtifacts, 'optimized'),
};

const baselineCount = modules.baseline._b3w_create_scene(sceneId, stress, seed);
const optimizedCount = modules.optimized._b3w_create_scene(sceneId, stress, seed);
if (baselineCount !== optimizedCount || baselineCount !== modules.baseline._b3w_body_count()) {
  throw new Error(`Body-count mismatch: baseline=${baselineCount}, optimized=${optimizedCount}.`);
}

modules.baseline._b3w_sync_transforms();
modules.optimized._b3w_sync_transforms();
const matrixFloats = exactMatrixComparison(modules.baseline, modules.optimized, baselineCount);
const baselineHash = modules.baseline._b3w_replay_hash() >>> 0;
const optimizedHash = modules.optimized._b3w_replay_hash() >>> 0;
if (baselineHash !== optimizedHash) throw new Error(`Replay-hash mismatch: ${baselineHash} != ${optimizedHash}.`);

const measurementOrder = Array.from(
  { length: samplesPerArtifact },
  (_, index) => index % 2 === 0 ? 'baseline-first' : 'optimized-first',
);
const results = [];
const warmupIterations = 48;

for (const scenario of scenarios) {
  runSample(modules.baseline, warmupIterations, scenario.hashPeriod);
  runSample(modules.optimized, warmupIterations, scenario.hashPeriod);
  const raw = { baseline: [], optimized: [] };
  for (let sample = 0; sample < samplesPerArtifact; sample++) {
    const order = sample % 2 === 0 ? ['baseline', 'optimized'] : ['optimized', 'baseline'];
    for (const name of order) {
      raw[name].push(runSample(modules[name], scenario.iterations, scenario.hashPeriod));
    }
  }
  const baseline = summarize(raw.baseline);
  const optimized = summarize(raw.optimized);
  results.push({
    id: scenario.id,
    label: scenario.label,
    iterationsPerSample: scenario.iterations,
    hashPeriod: scenario.hashPeriod,
    baseline,
    optimized,
    speedup: baseline.medianMsPerSync / optimized.medianMsPerSync,
    optimizedTimeReductionPercent: (1 - optimized.medianMsPerSync / baseline.medianMsPerSync) * 100,
  });
}

modules.baseline._b3w_sync_transforms();
modules.optimized._b3w_sync_transforms();
exactMatrixComparison(modules.baseline, modules.optimized, baselineCount);
if ((modules.baseline._b3w_replay_hash() >>> 0) !== (modules.optimized._b3w_replay_hash() >>> 0)) {
  throw new Error('Post-benchmark replay hashes differ.');
}

const result = {
  schemaVersion: 1,
  benchmark: 'native-box3d-lazy-replay-hash',
  generatedAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    cpu: os.cpus()[0]?.model ?? 'unknown',
  },
  artifacts: {
    baseline: baselineArtifacts,
    optimized: optimizedArtifacts,
    baselineBundledInRepository: baselineDir === path.resolve(bundledBaselineDir),
    expectedBaselineSha256: expectedBaseline,
  },
  method: {
    sceneId,
    stress,
    seed,
    bodyCount: baselineCount,
    samplesPerArtifact,
    warmupIterations,
    alternatingOrder: true,
    measurementOrder,
  },
  correctness: {
    bodyCount: baselineCount,
    matrixFloats,
    exactMatrixBits: true,
    replayHash: baselineHash,
    exactReplayHash: true,
  },
  results,
  interpretation: {
    scope: 'Exported native b3w_sync_transforms bridge path only; not total physics or frame time.',
    cadenceBoundary: 'Lazy hashing is beneficial only when replay hashes are requested less often than transform synchronization.',
  },
};

fs.mkdirSync(outputDir, { recursive: true });
const jsonPath = path.join(outputDir, 'native-lazy-hash-benchmark.json');
const markdownPath = path.join(outputDir, 'native-lazy-hash-benchmark.md');
fs.writeFileSync(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
fs.writeFileSync(markdownPath, markdown(result));
modules.baseline._b3w_destroy();
modules.optimized._b3w_destroy();

console.log(JSON.stringify({
  result: 'passed',
  jsonPath,
  markdownPath,
  correctness: result.correctness,
  speedups: Object.fromEntries(results.map((entry) => [entry.id, entry.speedup])),
}, null, 2));
