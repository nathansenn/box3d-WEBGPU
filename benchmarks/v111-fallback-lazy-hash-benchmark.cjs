'use strict';

/*
 * Isolated-process qualification for the v1.11 lazy JS fallback replay hash.
 *
 * Controller:
 *   node --expose-gc benchmarks/v111-fallback-lazy-hash-benchmark.cjs
 *
 * Optional environment:
 *   V111_HASH_SAMPLES=9
 *   V111_HASH_WARMUP=360
 *   V111_HASH_ITERATIONS=1200
 *   V111_HASH_CADENCE=12
 *   V111_HASH_BOOTSTRAPS=10000
 *   V111_HASH_KEEP_TEMP=1
 *
 * The controller extracts the bundled exact v1.10 source archive, compiles
 * both versions into temporary CommonJS trees, and starts a fresh Node process
 * for every version/sample. Worker mode is an internal implementation detail.
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');

const scriptPath = fs.realpathSync(__filename);
const root = path.resolve(__dirname, '..');
const baselineArchive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz');
const outputJson = path.join(root, 'benchmarks/results/v111-fallback-lazy-hash.json');
const outputMarkdown = path.join(root, 'benchmarks/results/v111-fallback-lazy-hash.md');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
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

function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * fraction;
}

function pairedBootstrap(baseline, candidate, repetitions, seed) {
  assert.equal(baseline.length, candidate.length);
  let state = seed >>> 0;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
  const ratios = new Float64Array(repetitions);
  for (let repetition = 0; repetition < repetitions; repetition++) {
    const sampledBaseline = new Array(baseline.length);
    const sampledCandidate = new Array(candidate.length);
    for (let index = 0; index < baseline.length; index++) {
      const selected = Math.floor(next() * baseline.length);
      sampledBaseline[index] = baseline[selected];
      sampledCandidate[index] = candidate[selected];
    }
    ratios[repetition] = median(sampledBaseline) / median(sampledCandidate);
  }
  ratios.sort();
  return {
    low: quantile(ratios, 0.025),
    high: quantile(ratios, 0.975),
  };
}

function workerMain() {
  const [buildRoot, sceneText, mode, warmupText, iterationsText, cadenceText, rainText, seedText] = process.argv.slice(3);
  const sceneId = Number(sceneText);
  const warmup = Number(warmupText);
  const iterations = Number(iterationsText);
  const cadence = Number(cadenceText);
  const rainCount = Number(rainText);
  const seed = Number(seedText) >>> 0;
  const { SCENES } = require(path.join(buildRoot, 'src/scenes.js'));
  const { FallbackPhysicsBackend } = require(path.join(buildRoot, 'src/physics/fallback.js'));
  const scene = SCENES[sceneId];
  assert.ok(scene, `missing scene ${sceneId}`);
  const backend = new FallbackPhysicsBackend(4096);
  backend.createScene(scene, 5, seed);
  if (rainCount > 0) backend.spawnRain(rainCount, 28, 34);

  let sink = 0;
  const runLoop = (count) => {
    for (let index = 0; index < count; index++) {
      backend.syncTransforms();
      if (mode === 'hash-every-sync' || (mode === 'telemetry-cadence' && (index + 1) % cadence === 0)) {
        sink = (sink ^ backend.replayHash()) >>> 0;
      } else {
        sink = (sink + backend.frameVersion()) >>> 0;
      }
    }
  };

  // Warm the exact production methods in the same fresh process, then exclude
  // JIT warmup and GC from the timed interval.
  runLoop(warmup);
  global.gc?.();
  const started = performance.now();
  runLoop(iterations);
  const elapsedMs = performance.now() - started;

  // This final call is outside the timer. It materializes the deferred current
  // hash for exact cross-version validation without contaminating sync-only.
  const replayHash = backend.replayHash() >>> 0;
  const bodyCount = backend.bodyCount();
  const matrixOffset = Number(backend._b3w_matrices_ptr()) / Float32Array.BYTES_PER_ELEMENT;
  const matrices = backend.HEAPF32.subarray(matrixOffset, matrixOffset + bodyCount * 16);
  let finite = true;
  for (let index = 0; index < matrices.length; index++) {
    if (!Number.isFinite(matrices[index])) { finite = false; break; }
  }
  const matrixSha256 = crypto
    .createHash('sha256')
    .update(Buffer.from(matrices.buffer, matrices.byteOffset, matrices.byteLength))
    .digest('hex');
  const result = {
    sceneId,
    sceneTitle: scene.title,
    family: scene.family,
    mode,
    bodyCount,
    dynamicCount: backend.dynamicCount(),
    frameVersion: backend.frameVersion(),
    elapsedMs,
    msPerSync: elapsedMs / iterations,
    replayHash,
    matrixSha256,
    finite,
    sink,
  };
  backend.destroy();
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed (${result.status})\n${result.stdout || ''}\n${result.stderr || ''}`,
    );
  }
  return result.stdout;
}

function writeBaseTsconfig(sourceRoot) {
  const file = path.join(sourceRoot, 'tsconfig.json');
  if (fs.existsSync(file)) return;
  fs.writeFileSync(file, `${JSON.stringify({
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
  }, null, 2)}\n`);
}

function compileProject(sourceRoot, buildRoot) {
  run(path.join(root, 'node_modules/.bin/tsc'), [
    '-p', path.join(sourceRoot, 'tsconfig.test.json'),
    '--outDir', buildRoot,
    '--rootDir', sourceRoot,
  ], { cwd: sourceRoot });
  fs.writeFileSync(path.join(buildRoot, 'package.json'), '{"type":"commonjs"}\n');
}

function sampleWorker(buildRoot, workload, version) {
  const stdout = run(process.execPath, [
    '--expose-gc',
    scriptPath,
    '--worker',
    buildRoot,
    String(workload.sceneId),
    workload.mode,
    String(workload.warmup),
    String(workload.iterations),
    String(workload.cadence),
    String(workload.rainCount),
    String(workload.seed),
  ], {
    cwd: root,
    env: { ...process.env, V111_HASH_WORKER_VERSION: version },
    maxBuffer: 16 * 1024 * 1024,
  });
  return JSON.parse(stdout.trim());
}

function markdownReport(result) {
  const lines = [
    '# v1.11 JS fallback lazy replay-hash benchmark',
    '',
    `Generated: ${result.generatedAt}`,
    '',
    `Baseline: exact bundled **v1.10** source archive; candidate: **working tree**.`,
    '',
    `Each cell uses **${result.config.samples} fresh processes per version**, alternating order, after ` +
      `${result.config.warmup} in-process JIT warmups. Timings contain ${result.config.iterations} production ` +
      '`syncTransforms()` calls per process.',
    '',
    '## Result',
    '',
    `**${result.verdict.realWin ? 'Real conditional win' : 'No proven win'}:** ${result.verdict.summary}`,
    '',
    `Caveat: ${result.verdict.caveat}`,
    '',
    '| Scene | Bodies | Hash policy | v1.10 ms/sync | Current ms/sync | Speedup | Paired 95% interval | Exact matrices + hash |',
    '|---|---:|---|---:|---:|---:|---:|---|',
  ];
  for (const record of result.records) {
    lines.push(
      `| ${record.sceneLabel} | ${record.bodyCount} | ${record.modeLabel} | ` +
      `${record.baselineMedianMs.toFixed(6)} | ${record.candidateMedianMs.toFixed(6)} | ` +
      `${record.speedup.toFixed(3)}x | ${record.confidence95.low.toFixed(3)}–${record.confidence95.high.toFixed(3)}x | ` +
      `${record.correctness.exact ? 'yes' : 'NO'} |`,
    );
  }
  lines.push('', '## Aggregate by hash policy', '', '| Policy | Geometric-mean speedup | All exact |', '|---|---:|---|');
  for (const aggregate of result.modeAggregates) {
    lines.push(`| ${aggregate.modeLabel} | ${aggregate.geometricMeanSpeedup.toFixed(3)}x | ${aggregate.allExact ? 'yes' : 'NO'} |`);
  }
  lines.push(
    '',
    '## Method and interpretation',
    '',
    '- `sync-only` does not request telemetry during the timed loop.',
    `- ` + '`telemetry cadence` requests `replayHash()` every ' + `${result.config.cadence} syncs.`,
    '- `hash every sync` forces the candidate to perform the deferred hash work every time.',
    '- A final hash request occurs outside the timer for exact result validation.',
    '- Matrix buffers are compared byte-for-byte using SHA-256, and replay hashes must match exactly.',
    '- Every version/sample runs in a fresh Node process; import, setup, warmup, and process startup are excluded.',
    '- Medians, MAD, all raw samples, and deterministic paired-bootstrap intervals are preserved in JSON.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function controllerMain() {
  const samples = Math.max(5, Number.parseInt(process.env.V111_HASH_SAMPLES || '9', 10));
  const warmup = Math.max(60, Number.parseInt(process.env.V111_HASH_WARMUP || '360', 10));
  const iterations = Math.max(120, Number.parseInt(process.env.V111_HASH_ITERATIONS || '1200', 10));
  const cadence = Math.max(2, Number.parseInt(process.env.V111_HASH_CADENCE || '12', 10));
  const bootstraps = Math.max(1000, Number.parseInt(process.env.V111_HASH_BOOTSTRAPS || '10000', 10));
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-lazy-hash-'));
  const baselineRoot = path.join(tempRoot, 'baseline-source');
  const baselineBuild = path.join(tempRoot, 'baseline-build');
  const candidateBuild = path.join(tempRoot, 'candidate-build');
  try {
    assert.ok(fs.existsSync(baselineArchive), `missing ${baselineArchive}`);
    fs.mkdirSync(baselineRoot, { recursive: true });
    run('tar', ['-xzf', baselineArchive, '-C', baselineRoot]);
    writeBaseTsconfig(baselineRoot);
    const baselineModules = path.join(baselineRoot, 'node_modules');
    fs.symlinkSync(path.join(root, 'node_modules'), baselineModules, process.platform === 'win32' ? 'junction' : 'dir');
    compileProject(baselineRoot, baselineBuild);
    compileProject(root, candidateBuild);

    const scenes = [
      { sceneLabel: 'Medium bridge', sceneId: 199, rainCount: 0 },
      { sceneLabel: 'Dense stack', sceneId: 49, rainCount: 0 },
      { sceneLabel: 'Rain stress + 180', sceneId: 299, rainCount: 180 },
    ];
    const modes = [
      { mode: 'sync-only', modeLabel: 'Sync only' },
      { mode: 'telemetry-cadence', modeLabel: `Telemetry every ${cadence}` },
      { mode: 'hash-every-sync', modeLabel: 'Hash every sync' },
    ];
    const workloads = [];
    for (const scene of scenes) {
      for (const mode of modes) {
        workloads.push({
          ...scene,
          ...mode,
          warmup,
          iterations,
          cadence,
          seed: (0x6c617a79 + scene.sceneId) >>> 0,
        });
      }
    }

    const records = [];
    for (let workloadIndex = 0; workloadIndex < workloads.length; workloadIndex++) {
      const workload = workloads[workloadIndex];
      const baselineSamples = [];
      const candidateSamples = [];
      const pairedEvidence = [];
      for (let sample = 0; sample < samples; sample++) {
        const order = ((workloadIndex + sample) & 1) === 0
          ? [['baseline', baselineBuild], ['candidate', candidateBuild]]
          : [['candidate', candidateBuild], ['baseline', baselineBuild]];
        const pair = {};
        for (const [version, buildRoot] of order) pair[version] = sampleWorker(buildRoot, workload, version);
        const exactMatrices = pair.baseline.matrixSha256 === pair.candidate.matrixSha256;
        const exactHash = pair.baseline.replayHash === pair.candidate.replayHash;
        const exactCounts = pair.baseline.bodyCount === pair.candidate.bodyCount &&
          pair.baseline.dynamicCount === pair.candidate.dynamicCount;
        assert.ok(pair.baseline.finite && pair.candidate.finite, `${workload.sceneLabel} non-finite matrices`);
        assert.ok(exactMatrices, `${workload.sceneLabel}/${workload.mode}: matrix mismatch`);
        assert.ok(exactHash, `${workload.sceneLabel}/${workload.mode}: replay hash mismatch`);
        assert.ok(exactCounts, `${workload.sceneLabel}/${workload.mode}: body-count mismatch`);
        baselineSamples.push(pair.baseline.msPerSync);
        candidateSamples.push(pair.candidate.msPerSync);
        pairedEvidence.push({ baseline: pair.baseline, candidate: pair.candidate });
      }
      const baselineMedianMs = median(baselineSamples);
      const candidateMedianMs = median(candidateSamples);
      const baselineMatrixHashes = new Set(pairedEvidence.map((pair) => pair.baseline.matrixSha256));
      const candidateMatrixHashes = new Set(pairedEvidence.map((pair) => pair.candidate.matrixSha256));
      const baselineReplayHashes = new Set(pairedEvidence.map((pair) => pair.baseline.replayHash));
      const candidateReplayHashes = new Set(pairedEvidence.map((pair) => pair.candidate.replayHash));
      const exact = pairedEvidence.every((pair) =>
        pair.baseline.matrixSha256 === pair.candidate.matrixSha256 &&
        pair.baseline.replayHash === pair.candidate.replayHash &&
        pair.baseline.bodyCount === pair.candidate.bodyCount,
      ) && baselineMatrixHashes.size === 1 && candidateMatrixHashes.size === 1 &&
        baselineReplayHashes.size === 1 && candidateReplayHashes.size === 1;
      const record = {
        ...workload,
        bodyCount: pairedEvidence[0].baseline.bodyCount,
        dynamicCount: pairedEvidence[0].baseline.dynamicCount,
        baselineSamplesMs: baselineSamples,
        candidateSamplesMs: candidateSamples,
        baselineMedianMs,
        candidateMedianMs,
        baselineMadMs: mad(baselineSamples),
        candidateMadMs: mad(candidateSamples),
        speedup: baselineMedianMs / candidateMedianMs,
        confidence95: pairedBootstrap(baselineSamples, candidateSamples, bootstraps, 0x111000 + workloadIndex),
        correctness: {
          exact,
          exactMatrices: true,
          exactReplayHash: true,
          deterministicBaseline: baselineMatrixHashes.size === 1 && baselineReplayHashes.size === 1,
          deterministicCandidate: candidateMatrixHashes.size === 1 && candidateReplayHashes.size === 1,
          matrixSha256: pairedEvidence[0].baseline.matrixSha256,
          replayHash: pairedEvidence[0].baseline.replayHash,
        },
        pairedEvidence,
      };
      records.push(record);
      console.log(`${workload.sceneLabel.padEnd(20)} ${workload.mode.padEnd(19)} ${record.speedup.toFixed(3)}x`);
    }

    const modeAggregates = modes.map(({ mode, modeLabel }) => {
      const selected = records.filter((record) => record.mode === mode);
      return {
        mode,
        modeLabel,
        geometricMeanSpeedup: geometricMean(selected.map((record) => record.speedup)),
        allExact: selected.every((record) => record.correctness.exact),
      };
    });
    const syncAggregate = modeAggregates.find((entry) => entry.mode === 'sync-only');
    const telemetryAggregate = modeAggregates.find((entry) => entry.mode === 'telemetry-cadence');
    const forcedAggregate = modeAggregates.find((entry) => entry.mode === 'hash-every-sync');
    const conditionalRecords = records.filter((record) => record.mode !== 'hash-every-sync');
    const realWin = conditionalRecords.every((record) => record.correctness.exact) &&
      conditionalRecords.some((record) => record.confidence95.low > 1.02) &&
      geometricMean(conditionalRecords.map((record) => record.speedup)) > 1.03;
    const result = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      environment: {
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        processorCount: os.cpus().length,
      },
      baseline: {
        label: 'v1.10.0 exact source archive',
        archive: path.relative(root, baselineArchive),
        archiveSha256: sha256File(baselineArchive),
      },
      candidate: {
        label: 'working tree',
        fallbackSha256: sha256File(path.join(root, 'src/physics/fallback.ts')),
      },
      config: { samples, warmup, iterations, cadence, bootstraps, freshProcessPerMeasurement: true, alternatingOrder: true },
      verdict: {
        realWin,
        summary: `sync-only geometric mean ${syncAggregate.geometricMeanSpeedup.toFixed(3)}x; ` +
          `telemetry-cadence ${telemetryAggregate.geometricMeanSpeedup.toFixed(3)}x; ` +
          `hash-every-sync ${forcedAggregate.geometricMeanSpeedup.toFixed(3)}x.`,
        caveat: 'The gain exists only while replayHash() is requested less often than syncTransforms(); requesting a hash every sync forces the deferred O(min(bodies, 512)) scan and should collapse the advantage toward parity.',
      },
      modeAggregates,
      records,
    };
    assert.ok(records.every((record) => record.correctness.exact), 'correctness gate failed');
    fs.writeFileSync(outputJson, `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(outputMarkdown, markdownReport(result));
    console.log(`Wrote ${outputJson}`);
    console.log(`Wrote ${outputMarkdown}`);
  } finally {
    if (process.env.V111_HASH_KEEP_TEMP === '1') {
      console.error(`Kept ${tempRoot}`);
    } else {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

if (process.argv[2] === '--worker') {
  workerMain();
} else {
  controllerMain();
}
