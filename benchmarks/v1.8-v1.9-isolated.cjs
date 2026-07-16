'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.8.0-source.tar.gz');
const samples = Math.max(3, Number.parseInt(process.env.V19_SAMPLES || '7', 10));
const bootstrapIterations = Math.max(1000, Number.parseInt(process.env.V19_BOOTSTRAPS || '10000', 10));
const workloadStart = Math.max(1, Number.parseInt(process.env.V19_WORKLOAD_START || '1', 10));
const workloadEnd = Math.min(10, Number.parseInt(process.env.V19_WORKLOAD_END || '10', 10));
if (workloadStart > workloadEnd) throw new Error(`V19_WORKLOAD_START ${workloadStart} exceeds V19_WORKLOAD_END ${workloadEnd}`);
const workloads = [
  ['cloth-cargo-full', 'Cargo net · adaptive solver + handoff', 'dynamic-breakthrough'],
  ['cloth-membrane-full', 'Maximum membrane · adaptive solver + handoff', 'dynamic-breakthrough'],
  ['cloth-membrane-storm', 'Maximum membrane · 72-projectile storm', 'dynamic-breakthrough'],
  ['rope-maximum-frame', 'Maximum rope · CPU render handoff', 'frame-breakthrough'],
  ['rope-maximum-full', 'Maximum rope · solver + handoff', 'dynamic-breakthrough'],
  ['rope-maximum-storm', 'Maximum rope · 96-impact storm', 'dynamic-breakthrough'],
  ['mixed-maximum', 'Maximum cloth + rope + water', 'mixed'],
  ['cloth-tearing-control', 'Tearing cloth · topology control', 'control'],
  ['water-maximum-control', 'Maximum water · unchanged control', 'control'],
  ['cloth-regular-control', 'Regular cloth · non-adaptive control', 'control'],
];

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}
function prepareBaseline() {
  const direct = process.env.V19_BASELINE_ROOT;
  if (direct) return path.resolve(direct);
  if (!fs.existsSync(archive)) throw new Error(`missing reproducible baseline archive: ${archive}`);
  const target = path.join(os.tmpdir(), `box3d-v18-v19-${process.pid}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  runCommand('tar', ['-xzf', archive, '-C', target, '--strip-components=1']);
  fs.rmSync(path.join(target, 'node_modules'), { recursive: true, force: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  runCommand(path.join(root, 'node_modules/.bin/tsc'), ['-p', path.join(target, 'tsconfig.test.json')], { cwd: target });
  fs.mkdirSync(path.join(target, '.test-build'), { recursive: true });
  fs.writeFileSync(path.join(target, '.test-build/package.json'), '{"type":"commonjs"}');
  return target;
}

const baselineRoot = prepareBaseline();
const worker = path.join(root, 'benchmarks/v1.8-v1.9-worker.cjs');
function median(values) { const sorted = [...values].sort((a, b) => a - b); const middle = sorted.length >> 1; return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5; }
function mad(values) { const center = median(values); return median(values.map((value) => Math.abs(value - center))); }
function geometricMean(values) { return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length); }
function decodeFloat32(encoded) { const bytes = Buffer.from(encoded, 'base64'); return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4).slice(); }
function relativeL2(a, b) { if (a.length !== b.length) return Infinity; let error = 0; let reference = 0; for (let i = 0; i < a.length; i++) { const delta = b[i] - a[i]; error += delta * delta; reference += a[i] * a[i]; } return Math.sqrt(error / Math.max(reference, 1e-30)); }
function maxAbs(a, b) { if (a.length !== b.length) return Infinity; let maximum = 0; for (let i = 0; i < a.length; i++) maximum = Math.max(maximum, Math.abs(a[i] - b[i])); return maximum; }
function run(variant, workloadId) {
  const sourceRoot = variant === 'v1.8' ? baselineRoot : root;
  const result = spawnSync(process.execPath, ['--expose-gc', worker, sourceRoot, variant, workloadId], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${variant} ${workloadId} failed:\n${result.stderr || result.stdout}`);
  return JSON.parse(result.stdout);
}
let randomState = 0x19c0ffee;
function random01() { randomState ^= randomState << 13; randomState ^= randomState >>> 17; randomState ^= randomState << 5; return (randomState >>> 0) / 0x100000000; }
function percentile(sorted, p) { const x = (sorted.length - 1) * p; const lower = Math.floor(x); const upper = Math.ceil(x); const mix = x - lower; return sorted[lower] + (sorted[upper] - sorted[lower]) * mix; }
function bootstrap(baseline, optimized) {
  const ratios = [];
  for (let iteration = 0; iteration < bootstrapIterations; iteration++) {
    const b = []; const o = [];
    for (let i = 0; i < baseline.length; i++) { const index = Math.floor(random01() * baseline.length); b.push(baseline[index]); o.push(optimized[index]); }
    ratios.push(median(b) / median(o));
  }
  ratios.sort((a, b) => a - b);
  return [percentile(ratios, 0.025), percentile(ratios, 0.975)];
}

const started = performance.now();
const results = [];
for (let workloadIndex = workloadStart - 1; workloadIndex < workloadEnd; workloadIndex++) {
  const [id, label, category] = workloads[workloadIndex];
  const baselineTimes = []; const optimizedTimes = [];
  const baselineHashes = []; const optimizedHashes = [];
  const baselineMeasurements = []; const optimizedMeasurements = [];
  for (let sample = 0; sample < samples; sample++) {
    const order = ((sample + workloadIndex) & 1) === 0 ? ['v1.8', 'v1.9'] : ['v1.9', 'v1.8'];
    for (const variant of order) {
      const measurement = run(variant, id);
      const targetTimes = variant === 'v1.8' ? baselineTimes : optimizedTimes;
      const targetHashes = variant === 'v1.8' ? baselineHashes : optimizedHashes;
      const targetMeasurements = variant === 'v1.8' ? baselineMeasurements : optimizedMeasurements;
      targetTimes.push(measurement.msPerOperation);
      targetHashes.push(measurement.hash);
      targetMeasurements.push(measurement);
    }
  }
  const baselineMedian = median(baselineTimes);
  const optimizedMedian = median(optimizedTimes);
  const speedup = baselineMedian / optimizedMedian;
  const interval = bootstrap(baselineTimes, optimizedTimes);
  const b = baselineMeasurements.at(-1);
  const o = optimizedMeasurements.at(-1);
  const stateError = relativeL2(decodeFloat32(b.state), decodeFloat32(o.state));
  const matrixError = relativeL2(decodeFloat32(b.matrices), decodeFloat32(o.matrices));
  const colorError = relativeL2(decodeFloat32(b.colors), decodeFloat32(o.colors));
  const stateLimit = (id.startsWith('cloth-') && !id.includes('tearing')) || id === 'mixed-maximum' ? 0.0025 : 1e-6;
  const correctness = b.nodes === o.nodes && b.constraints === o.constraints && b.instances === o.instances && stateError <= stateLimit && matrixError <= 2e-4 && colorError <= 2e-4;
  const record = {
    id, label, category,
    baselineSamplesMs: baselineTimes,
    optimizedSamplesMs: optimizedTimes,
    baselineMedianMs: baselineMedian,
    optimizedMedianMs: optimizedMedian,
    baselineMadMs: mad(baselineTimes),
    optimizedMadMs: mad(optimizedTimes),
    speedup,
    pairedBootstrap95: interval,
    baselineDeterministic: new Set(baselineHashes).size === 1,
    optimizedDeterministic: new Set(optimizedHashes).size === 1,
    crossVersionHashMatch: baselineHashes[0] === optimizedHashes[0],
    stateError,
    matrixError,
    colorError,
    maxStateAbs: maxAbs(decodeFloat32(b.state), decodeFloat32(o.state)),
    correctness,
    payload: {
      baselineDynamicBytes: b.dynamicBytes,
      optimizedDynamicBytes: o.dynamicBytes,
      byteReduction: b.dynamicBytes ? 1 - o.dynamicBytes / b.dynamicBytes : 0,
    },
    metadata: {
      baseline: { hash: b.hash, nodes: b.nodes, constraints: b.constraints, instances: b.instances },
      optimized: { hash: o.hash, nodes: o.nodes, constraints: o.constraints, instances: o.instances },
    },
  };
  results.push(record);
  console.log(`${String(workloadIndex + 1).padStart(2, '0')}/10 ${label}: ${speedup.toFixed(3)}× [${interval[0].toFixed(3)}, ${interval[1].toFixed(3)}] ${correctness ? 'PASS' : 'FAIL'}`);
}
const changed = results.filter((entry) => entry.category !== 'control');
const dynamic = results.filter((entry) => entry.category === 'dynamic-breakthrough' || entry.category === 'mixed');
const output = {
  schema: 1,
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model ?? 'unknown' },
  method: { samples, bootstrapIterations, freshProcessPerMeasurement: true, alternatingOrder: true, processStartupExcluded: true },
  summary: {
    changedGeometricMeanSpeedup: geometricMean(changed.map((entry) => entry.speedup)),
    dynamicGeometricMeanSpeedup: geometricMean(dynamic.map((entry) => entry.speedup)),
    medianSpeedup: median(results.map((entry) => entry.speedup)),
    correctnessFailures: results.filter((entry) => !entry.correctness).length,
    elapsedMs: performance.now() - started,
  },
  results,
};
const resultsDir = path.join(root, 'benchmarks/results');
fs.mkdirSync(resultsDir, { recursive: true });
const resultBase = workloadStart === 1 && workloadEnd === 10 ? 'v1.8-v1.9-isolated' : `v1.8-v1.9-isolated-shard-${workloadStart}-${workloadEnd}`;
fs.writeFileSync(path.join(resultsDir, `${resultBase}.json`), JSON.stringify(output, null, 2));
const markdown = [
  '# v1.8 → v1.9 Isolated Fresh-Process Benchmark', '',
  `- Changed-path geometric mean: **${output.summary.changedGeometricMeanSpeedup.toFixed(3)}×**`,
  `- Dynamic/mixed geometric mean: **${output.summary.dynamicGeometricMeanSpeedup.toFixed(3)}×**`,
  `- Correctness failures: **${output.summary.correctnessFailures}**`, '',
  '| Workload | v1.8 ms | v1.9 ms | Speedup | Paired 95% interval | Dynamic bytes |',
  '|---|---:|---:|---:|---:|---:|',
  ...results.map((entry) => `| ${entry.label} | ${entry.baselineMedianMs.toFixed(6)} | ${entry.optimizedMedianMs.toFixed(6)} | **${entry.speedup.toFixed(3)}×** | ${entry.pairedBootstrap95[0].toFixed(3)}–${entry.pairedBootstrap95[1].toFixed(3)}× | ${entry.payload.baselineDynamicBytes} → ${entry.payload.optimizedDynamicBytes} |`),
  '',
];
fs.writeFileSync(path.join(resultsDir, `${resultBase.toUpperCase().replaceAll('.', '_').replaceAll('-', '_')}.md`), markdown.join('\n'));
console.log(JSON.stringify(output.summary, null, 2));
if (output.summary.correctnessFailures > 0) process.exitCode = 1;
