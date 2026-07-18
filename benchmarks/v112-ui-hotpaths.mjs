import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

const ROOT = resolve(import.meta.dirname, '..');
const ARCHIVE = join(ROOT, 'benchmarks/baselines/box3d-webgpu-v1.11.0-source.tar.gz');
const EXPECTED_ARCHIVE_SHA256 = '7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537';
const OUTPUT_JSON = join(ROOT, 'benchmarks/results/v112-ui-hotpaths.json');
const OUTPUT_MARKDOWN = join(ROOT, 'benchmarks/results/v112-ui-hotpaths.md');
const SAMPLE_COUNT = Math.max(16, Number.parseInt(process.env.V112_UI_SAMPLES ?? '16', 10));
const BOOTSTRAPS = Math.max(5_000, Number.parseInt(process.env.V112_UI_BOOTSTRAPS ?? '20000', 10));
const MIN_BATCH_MS = Math.max(25, Number(process.env.V112_UI_MIN_BATCH_MS ?? '35'));
const WRITE_RESULTS = process.env.V112_UI_WRITE !== '0';

assert.equal(SAMPLE_COUNT % 2, 0, 'V112_UI_SAMPLES must be even for balanced execution order');

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const archiveSha256 = sha256(ARCHIVE);
assert.equal(archiveSha256, EXPECTED_ARCHIVE_SHA256, 'unexpected v1.11 baseline archive');

const temp = mkdtempSync(join(tmpdir(), 'webphysics-v112-ui-'));
let timingSink = 0;

function transpile(sourcePath, destinationPath, rewrites = []) {
  let source = readFileSync(sourcePath, 'utf8');
  for (const [from, to] of rewrites) source = source.replaceAll(from, to);
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  });
  mkdirSync(dirname(destinationPath), { recursive: true });
  writeFileSync(destinationPath, output.outputText);
}

function compileTree(sourceRoot, label) {
  const outputRoot = join(temp, label);
  mkdirSync(outputRoot, { recursive: true });
  transpile(join(sourceRoot, 'src/math.ts'), join(outputRoot, 'math.mjs'));
  transpile(join(sourceRoot, 'src/scenes.ts'), join(outputRoot, 'scenes.mjs'), [["'./math'", "'./math.mjs'"]]);
  transpile(join(sourceRoot, 'src/showcases.ts'), join(outputRoot, 'showcases.mjs'), [
    ["'./math'", "'./math.mjs'"],
    ["'./scenes'", "'./scenes.mjs'"],
  ]);
  return join(outputRoot, 'showcases.mjs');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function stats(values) {
  const center = median(values);
  return {
    medianMs: center,
    madMs: median(values.map((value) => Math.abs(value - center))),
    samplesMs: values,
  };
}

function xorshift32(state) {
  state ^= state << 13;
  state ^= state >>> 17;
  state ^= state << 5;
  return state >>> 0;
}

function bootstrapInterval(baseline, candidate, iterations) {
  const ratios = [];
  let state = 0x715517;
  for (let run = 0; run < iterations; run++) {
    const sampledBaseline = [];
    const sampledCandidate = [];
    for (let i = 0; i < baseline.length; i++) {
      state = xorshift32(state);
      const index = state % baseline.length;
      sampledBaseline.push(baseline[index]);
      sampledCandidate.push(candidate[index]);
    }
    ratios.push(median(sampledBaseline) / median(sampledCandidate));
  }
  ratios.sort((a, b) => a - b);
  return {
    low: ratios[Math.floor(ratios.length * 0.025)],
    high: ratios[Math.min(ratios.length - 1, Math.floor(ratios.length * 0.975))],
  };
}

function assertCameraExact(actual, expected, label) {
  for (const field of ['yaw', 'pitch', 'distance']) {
    assert.ok(Object.is(actual[field], expected[field]), `${label}.${field}: ${actual[field]} !== ${expected[field]}`);
  }
  for (let axis = 0; axis < 3; axis++) {
    assert.ok(Object.is(actual.target[axis], expected.target[axis]), `${label}.target[${axis}] differs`);
  }
}

function runBatch(iterations, callback) {
  let sink = 0;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const rig = callback(i);
    sink += rig.yaw + rig.pitch * 3 + rig.distance * 0.01 + rig.target[i % 3];
  }
  const elapsedMs = performance.now() - start;
  timingSink += sink;
  return elapsedMs;
}

function calibrate(baseline, candidate) {
  let iterations = 16_384;
  for (;;) {
    const baselineMs = runBatch(iterations, baseline);
    const candidateMs = runBatch(iterations, candidate);
    if (Math.min(baselineMs, candidateMs) >= MIN_BATCH_MS) return iterations;
    iterations *= 2;
    if (iterations > 67_108_864) throw new Error('unable to calibrate camera workload');
  }
}

try {
  const baselineRoot = join(temp, 'baseline-source');
  mkdirSync(baselineRoot, { recursive: true });
  execFileSync('tar', ['-xzf', ARCHIVE, '-C', baselineRoot]);

  const baselineModulePath = compileTree(baselineRoot, 'baseline-modules');
  const candidateModulePath = compileTree(ROOT, 'candidate-modules');
  const baselineModule = await import(`${pathToFileURL(baselineModulePath).href}?baseline=${Date.now()}`);
  const candidateModule = await import(`${pathToFileURL(candidateModulePath).href}?candidate=${Date.now()}`);

  assert.equal(baselineModule.AAA_SHOWCASES.length, candidateModule.AAA_SHOWCASES.length, 'showcase count differs');
  assert.equal(typeof candidateModule.sampleShowcaseCameraInto, 'function', 'allocation-free sampler is not exported');

  let exactSamples = 0;
  let exactHash = 0x811c9dc5;
  const out = { yaw: 0, pitch: 0, distance: 0, target: [0, 0, 0] };
  const outTarget = out.target;
  for (let index = 0; index < baselineModule.AAA_SHOWCASES.length; index++) {
    const baselineShowcase = baselineModule.AAA_SHOWCASES[index];
    const candidateShowcase = candidateModule.AAA_SHOWCASES[index];
    for (let step = -2; step <= 4098; step++) {
      const time = (step / 4096) * baselineShowcase.duration;
      const expected = baselineModule.sampleShowcaseCamera(baselineShowcase, time);
      const wrapped = candidateModule.sampleShowcaseCamera(candidateShowcase, time);
      const actual = candidateModule.sampleShowcaseCameraInto(candidateShowcase, time, out);
      assertCameraExact(wrapped, expected, `wrapped ${index}/${step}`);
      assertCameraExact(actual, expected, `into ${index}/${step}`);
      assert.equal(actual, out, 'into sampler replaced the output rig');
      assert.equal(actual.target, outTarget, 'into sampler replaced the output target');
      exactHash ^= ((actual.yaw * 1e6) | 0) ^ ((actual.distance * 1e4) | 0) ^ step;
      exactHash = Math.imul(exactHash, 0x01000193) >>> 0;
      exactSamples++;
    }
  }

  const firstWrapped = candidateModule.sampleShowcaseCamera(candidateModule.AAA_SHOWCASES[0], 1);
  const secondWrapped = candidateModule.sampleShowcaseCamera(candidateModule.AAA_SHOWCASES[0], 1);
  assert.notEqual(firstWrapped, secondWrapped, 'public allocating wrapper changed object-identity semantics');
  assert.notEqual(firstWrapped.target, secondWrapped.target, 'public allocating wrapper changed target-identity semantics');

  const workloads = [
    {
      name: 'director-interior-track',
      input(i, showcases) {
        const showcase = showcases[i % showcases.length];
        const normalized = ((i * 17) & 4095) / 4096;
        return [showcase, showcase.duration * (0.001 + normalized * 0.998)];
      },
    },
    {
      name: 'director-60hz-tour',
      input(i, showcases) {
        const showcaseIndex = Math.floor(i / (19 * 60)) % showcases.length;
        const showcase = showcases[showcaseIndex];
        return [showcase, (i % Math.max(1, Math.floor(showcase.duration * 60))) / 60];
      },
    },
    {
      name: 'endpoint-and-clamp-sampling',
      input(i, showcases) {
        const showcase = showcases[(i * 13) % showcases.length];
        return [showcase, (i & 1) === 0 ? -1 : showcase.duration + 1];
      },
    },
  ];

  const measured = [];
  for (const workload of workloads) {
    const baselineCallback = (i) => {
      const [showcase, time] = workload.input(i, baselineModule.AAA_SHOWCASES);
      return baselineModule.sampleShowcaseCamera(showcase, time);
    };
    const candidateOut = { yaw: 0, pitch: 0, distance: 0, target: [0, 0, 0] };
    const candidateCallback = (i) => {
      const [showcase, time] = workload.input(i, candidateModule.AAA_SHOWCASES);
      return candidateModule.sampleShowcaseCameraInto(showcase, time, candidateOut);
    };
    const iterations = calibrate(baselineCallback, candidateCallback);
    for (let warmup = 0; warmup < 4; warmup++) {
      runBatch(Math.max(4096, iterations >> 3), baselineCallback);
      runBatch(Math.max(4096, iterations >> 3), candidateCallback);
    }
    const baselineSamples = [];
    const candidateSamples = [];
    const baselineFirst = { baseline: [], candidate: [] };
    const candidateFirst = { baseline: [], candidate: [] };
    for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
      globalThis.gc?.();
      const order = (sample & 1) === 0
        ? [[baselineCallback, baselineSamples, baselineFirst.baseline], [candidateCallback, candidateSamples, baselineFirst.candidate]]
        : [[candidateCallback, candidateSamples, candidateFirst.candidate], [baselineCallback, baselineSamples, candidateFirst.baseline]];
      for (const [callback, pooled, stratum] of order) {
        const ms = runBatch(iterations, callback);
        pooled.push(ms);
        stratum.push(ms);
      }
    }
    const stratumSpeedups = [
      median(baselineFirst.baseline) / median(baselineFirst.candidate),
      median(candidateFirst.baseline) / median(candidateFirst.candidate),
    ];
    const speedup = Math.sqrt(stratumSpeedups[0] * stratumSpeedups[1]);
    measured.push({
      name: workload.name,
      iterations,
      minimumBatchMs: Math.min(...baselineSamples, ...candidateSamples),
      baseline: stats(baselineSamples),
      candidate: stats(candidateSamples),
      speedup,
      orderStratumSpeedups: stratumSpeedups,
      pairedBootstrap95: bootstrapInterval(baselineSamples, candidateSamples, BOOTSTRAPS),
    });
  }

  const geometricMean = Math.exp(measured.reduce((sum, entry) => sum + Math.log(entry.speedup), 0) / measured.length);
  const minimumSpeedup = Math.min(...measured.map((entry) => entry.speedup));
  const gates = {
    archiveIntegrity: archiveSha256 === EXPECTED_ARCHIVE_SHA256,
    exactOutput: exactSamples === baselineModule.AAA_SHOWCASES.length * 4101,
    minimumBatchDuration: measured.every((entry) => entry.minimumBatchMs >= 25),
    stableMinimumSpeedup: minimumSpeedup >= 1.03,
    geometricMeanSpeedup: geometricMean >= 1.03,
  };
  const passed = Object.values(gates).every(Boolean);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: {
      label: 'exact archived v1.11 source',
      archive: 'benchmarks/baselines/box3d-webgpu-v1.11.0-source.tar.gz',
      archiveSha256,
    },
    candidate: {
      sourceSha256: sha256(join(ROOT, 'src/showcases.ts')),
      integration: 'sampleShowcaseCameraInto(activeShowcase, cinematicTime, camera)',
    },
    methodology: {
      sampleCount: SAMPLE_COUNT,
      balancedAlternatingOrder: true,
      warmups: 4,
      minimumBatchTargetMs: MIN_BATCH_MS,
      bootstrapResamples: BOOTSTRAPS,
    },
    fidelity: { exactSamples, exactHash, wrapperIdentityPreserved: true, outputStorageReused: true },
    results: measured,
    summary: { geometricMeanSpeedup: geometricMean, minimumSpeedup },
    gates,
    passed,
    timingSink,
  };

  const markdown = `# v1.12 UI hot-path benchmark\n\n` +
    `Exact v1.11 archive SHA-256: \`${archiveSha256}\`.\n\n` +
    `The cinematic camera sampler now writes into the existing camera rig and directly selects the built-in five-key track segment instead of allocating a rig/target vector and scanning earlier keys every active director frame. ` +
    `${exactSamples.toLocaleString()} samples matched the archived v1.11 output exactly. The public allocating wrapper retains its identity semantics.\n\n` +
    `| Workload | Baseline median | Candidate median | Speedup | 95% bootstrap interval | Min batch |\n|---|---:|---:|---:|---:|---:|\n` +
    measured.map((entry) => `| ${entry.name} | ${entry.baseline.medianMs.toFixed(3)} ms | ${entry.candidate.medianMs.toFixed(3)} ms | **${entry.speedup.toFixed(3)}×** | ${entry.pairedBootstrap95.low.toFixed(3)}–${entry.pairedBootstrap95.high.toFixed(3)}× | ${entry.minimumBatchMs.toFixed(1)} ms |`).join('\n') +
    `\n\nGeometric mean: **${geometricMean.toFixed(3)}×**; minimum workload: **${minimumSpeedup.toFixed(3)}×**. Gate: **${passed ? 'PASS' : 'FAIL'}**.\n\n` +
    `## Reviewed but not changed\n\n` +
    `- A stateful monotonic-segment cache was piloted and removed: it regressed randomized interior sampling to 0.990× and reached only 1.023× on the 60 Hz tour trace. Direct five-key selection was faster and simpler.\n` +
    `- Camera shake already returns a shared constant while idle. The active-shake allocation is inside \`src/effects.ts\`, which was intentionally outside this audit's edit scope.\n` +
    `- The renderer's per-frame \`resize()\` call is guarded by exact dimensions before any texture work; there is no duplicate resize call in \`src/main.ts\`.\n` +
    `- Stats update only five times per second, and its changing timing fields make broad DOM-write suppression a low-value, harder-to-prove frame optimization.\n` +
    `- The duplicate category-filter listener is a setup-time bug, not a frame hot path; changing its event-observable call count was excluded from the exact-behavior optimization.\n`;

  if (WRITE_RESULTS) {
    mkdirSync(dirname(OUTPUT_JSON), { recursive: true });
    writeFileSync(OUTPUT_JSON, `${JSON.stringify(report, null, 2)}\n`);
    writeFileSync(OUTPUT_MARKDOWN, markdown);
  }
  console.log(markdown);
  if (!passed) process.exitCode = 1;
} finally {
  rmSync(temp, { recursive: true, force: true });
}
