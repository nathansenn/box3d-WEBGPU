'use strict';

/*
 * Focused v1.12 runtime-candidate qualification against the exact bundled
 * v1.11 source. This deliberately benchmarks the complete methods containing
 * the changes, while keeping setup and capture outside the timed interval.
 *
 * Run directly (no package.json wiring is required):
 *
 *   node --expose-gc benchmarks/v112-runtime-candidates.cjs
 */

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const ARCHIVE = path.join(ROOT, 'benchmarks/baselines/box3d-webgpu-v1.11.0-source.tar.gz');
const EXPECTED_ARCHIVE_SHA256 = '7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537';
const RESULTS_JSON = path.join(ROOT, 'benchmarks/results/v112-runtime-candidates.json');
const RESULTS_MD = path.join(ROOT, 'benchmarks/results/v112-runtime-candidates.md');
const SAMPLE_COUNT = Math.max(16, Number.parseInt(process.env.V112_RUNTIME_SAMPLES || '16', 10));
const BOOTSTRAPS = Math.max(5000, Number.parseInt(process.env.V112_RUNTIME_BOOTSTRAPS || '20000', 10));
const WARMUP_ROUNDS = 3;
const TARGET_FAST_MS = Math.max(30, Number(process.env.V112_RUNTIME_TARGET_MS || 60));
const MAX_SLOW_MS = Math.max(160, Number(process.env.V112_RUNTIME_MAX_MS || 280));
const RELEVANT_SOURCE = ['src/math.ts', 'src/physics/fallback.ts', 'src/soft/simulations.ts'];

assert.equal(SAMPLE_COUNT % 2, 0, 'V112_RUNTIME_SAMPLES must be even for equal execution-order strata');

let observableSink = 0;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with ${result.status}`);
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function relevantSourceHashes() {
  return Object.fromEntries(RELEVANT_SOURCE.map((relative) => [relative, sha256File(path.join(ROOT, relative))]));
}

function writeCommonJsPackage(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'package.json'), '{"type":"commonjs"}\n');
}

function prepareProjects(tempRoot) {
  const baselineRoot = path.join(tempRoot, 'baseline');
  const baselineBuild = path.join(tempRoot, 'baseline-build');
  const currentBuild = path.join(tempRoot, 'current-build');
  const archiveHash = sha256File(ARCHIVE);
  assert.equal(archiveHash, EXPECTED_ARCHIVE_SHA256, 'exact v1.11 archive checksum');

  fs.mkdirSync(baselineRoot, { recursive: true });
  run('tar', ['-xzf', ARCHIVE, '-C', baselineRoot]);
  const baselineTsconfig = path.join(baselineRoot, 'tsconfig.json');
  if (!fs.existsSync(baselineTsconfig)) {
    fs.writeFileSync(baselineTsconfig, `${JSON.stringify({
      compilerOptions: {
        target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true,
        skipLibCheck: true, lib: ['ES2022', 'DOM', 'DOM.Iterable'], noEmit: true,
      },
      include: ['src'],
    }, null, 2)}\n`);
  }
  fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(baselineRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const tsc = path.join(ROOT, 'node_modules/.bin/tsc');
  run(tsc, ['-p', path.join(baselineRoot, 'tsconfig.test.json'), '--outDir', baselineBuild], { cwd: baselineRoot });
  run(tsc, ['-p', path.join(ROOT, 'tsconfig.test.json'), '--outDir', currentBuild], { cwd: ROOT });
  writeCommonJsPackage(baselineBuild);
  writeCommonJsPackage(currentBuild);

  function load(buildRoot, label) {
    return {
      label,
      SCENES: require(path.join(buildRoot, 'src/scenes.js')).SCENES,
      FallbackPhysicsBackend: require(path.join(buildRoot, 'src/physics/fallback.js')).FallbackPhysicsBackend,
      SoftSimulationSuite: require(path.join(buildRoot, 'src/soft/simulations.js')).SoftSimulationSuite,
    };
  }

  return {
    archiveHash,
    baseline: load(baselineBuild, 'v1.11.0 exact archive'),
    candidate: load(currentBuild, 'v1.12 working tree'),
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

function quantile(values, probability) {
  const sorted = [...values].sort((a, b) => a - b);
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

function orderBalancedSummary(groups, seed) {
  const baselineFirstRatio = median(groups.baselineFirst) / median(groups.candidateSecond);
  const candidateFirstRatio = median(groups.baselineSecond) / median(groups.candidateFirst);
  const speedup = Math.sqrt(baselineFirstRatio * candidateFirstRatio);
  const rng = makeRng(seed);
  const firstCount = groups.baselineFirst.length;
  const secondCount = groups.candidateFirst.length;
  const resampled = new Array(BOOTSTRAPS);
  const bf = new Array(firstCount);
  const cs = new Array(firstCount);
  const cf = new Array(secondCount);
  const bs = new Array(secondCount);
  for (let bootstrap = 0; bootstrap < BOOTSTRAPS; bootstrap++) {
    for (let i = 0; i < firstCount; i++) {
      const sample = Math.floor(rng() * firstCount);
      bf[i] = groups.baselineFirst[sample];
      cs[i] = groups.candidateSecond[sample];
    }
    for (let i = 0; i < secondCount; i++) {
      const sample = Math.floor(rng() * secondCount);
      cf[i] = groups.candidateFirst[sample];
      bs[i] = groups.baselineSecond[sample];
    }
    resampled[bootstrap] = Math.sqrt((median(bf) / median(cs)) * (median(bs) / median(cf)));
  }
  return {
    speedup,
    baselineFirstRatio,
    candidateFirstRatio,
    confidence95: { lower: quantile(resampled, 0.025), median: quantile(resampled, 0.5), upper: quantile(resampled, 0.975) },
  };
}

function hashArrays(metadata, arrays) {
  const hash = crypto.createHash('sha256');
  hash.update(JSON.stringify(metadata));
  for (const values of arrays) hash.update(Buffer.from(values.buffer, values.byteOffset, values.byteLength));
  return hash.digest('hex');
}

function captureFallback(backend) {
  const bodyCount = backend.bodyCount();
  const matrixStart = Number(backend._b3w_matrices_ptr()) / 4;
  const colorStart = Number(backend._b3w_colors_ptr()) / 4;
  const matrices = backend.HEAPF32.subarray(matrixStart, matrixStart + bodyCount * 16);
  const colors = backend.HEAPF32.subarray(colorStart, colorStart + bodyCount * 4);
  const metadata = {
    bodyCount,
    dynamicCount: backend.dynamicCount(),
    frameVersion: backend.frameVersion(),
    colorVersion: backend.colorVersion(),
    replayHash: backend.replayHash() >>> 0,
    broadphaseAxis: backend.broadphaseAxis(),
    broadphaseCandidates: backend.broadphaseCandidateCount(),
  };
  return { metadata, fingerprint: hashArrays(metadata, [matrices, colors]) };
}

const LINE_FIELDS = ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'r', 'g', 'b', 'a'];

function captureSoft(suite, debug) {
  const frame = suite.buildFrame(debug);
  const active = suite.active;
  const matrices = frame.matrices.subarray(0, frame.instanceCount * 16);
  const colors = frame.colors.subarray(0, frame.instanceCount * 4);
  const lines = new Float64Array(frame.debugLines.length * LINE_FIELDS.length);
  for (let lineIndex = 0; lineIndex < frame.debugLines.length; lineIndex++) {
    const line = frame.debugLines[lineIndex];
    for (let fieldIndex = 0; fieldIndex < LINE_FIELDS.length; fieldIndex++) {
      lines[lineIndex * LINE_FIELDS.length + fieldIndex] = line[LINE_FIELDS[fieldIndex]];
    }
  }
  let state;
  if (frame.kind === 'water') {
    state = new Float32Array(active.eta.length + active.u.length + active.v.length);
    state.set(active.eta);
    state.set(active.u, active.eta.length);
    state.set(active.v, active.eta.length + active.u.length);
  } else {
    state = active.positions;
  }
  const metadata = {
    kind: frame.kind,
    instanceCount: frame.instanceCount,
    nodeCount: frame.nodeCount,
    constraintCount: frame.constraintCount,
    brokenCount: frame.brokenCount,
    frameVersion: frame.frameVersion,
    hash: suite.hash() >>> 0,
    lineCount: frame.debugLines.length,
  };
  return { metadata, fingerprint: hashArrays(metadata, [state, matrices, colors, lines]) };
}

function setupFallback(project, sceneId) {
  const backend = new project.FallbackPhysicsBackend(4096);
  backend.createScene(project.SCENES[sceneId], 5, (0x112500 + sceneId) >>> 0);
  return backend;
}

function setupSoft(project, sceneId, rain = 0) {
  const suite = new project.SoftSimulationSuite();
  assert.ok(suite.createScene(project.SCENES[sceneId], 5, (0x112500 + sceneId) >>> 0));
  if (rain > 0) {
    const existing = suite.active.droplets?.length || 0;
    const remaining = Math.max(0, rain - existing);
    assert.equal(suite.spawnRain(remaining, 18, 26), remaining);
    assert.equal(suite.active.droplets?.length, rain);
  }
  return suite;
}

function forceSoftFrame(suite, debug) {
  const active = suite.active;
  active.frameVersion = (active.frameVersion + 1) >>> 0;
  const frame = active.buildFrame(debug);
  observableSink = (observableSink + frame.frameVersion + frame.instanceCount + frame.debugLines.length) >>> 0;
}

const CASES = [
  {
    id: 'fallback-dynamic-count', family: 'fallback dynamic index/cache', sceneId: 390,
    description: 'reverted cached dynamicCount micro-candidate control',
    control: true,
    pilotIterations: 20000, maxIterations: 2000000, preTimedIterations: 10000,
    setup: (project) => setupFallback(project, 390),
    operation: (backend) => { observableSink = (observableSink + backend.dynamicCount()) >>> 0; },
    capture: captureFallback,
  },
  {
    id: 'fallback-sync-transforms', family: 'fallback dynamic index/cache', sceneId: 390,
    description: 'reverted syncTransforms control on a 135-body / 38-dynamic static-heavy scene',
    control: true,
    pilotIterations: 1000, maxIterations: 100000, preTimedIterations: 100,
    setup: (project) => setupFallback(project, 390),
    operation: (backend) => { backend.syncTransforms(); observableSink ^= backend.frameVersion(); },
    capture: captureFallback,
  },
  {
    id: 'fallback-complete-step', family: 'fallback dynamic index/cache', sceneId: 390,
    description: 'unchanged complete two-substep fallback frame control',
    control: true,
    pilotIterations: 12, maxIterations: 3000, preTimedIterations: 20,
    setup: (project) => setupFallback(project, 390),
    operation: (backend) => { backend.step(1 / 60, 2); observableSink ^= backend.frameVersion(); },
    capture: captureFallback,
  },
  {
    id: 'cloth-sphere-frame', family: 'axis-aligned matrix writer', sceneId: 607,
    description: 'forced cloth collider-sphere buildFrame (one exact zero-rotation matrix)',
    pilotIterations: 20000, maxIterations: 2000000, preTimedIterations: 1000,
    setup: (project) => setupSoft(project, 607),
    operation: (suite) => forceSoftFrame(suite, false),
    capture: (suite) => captureSoft(suite, false),
  },
  {
    id: 'water-768-droplet-frame', family: 'axis-aligned matrix writer', sceneId: 745,
    description: 'forced water buildFrame with the full 768-droplet budget',
    pilotIterations: 80, maxIterations: 30000, preTimedIterations: 20,
    setup: (project) => setupSoft(project, 745, 768),
    operation: (suite) => forceSoftFrame(suite, false),
    capture: (suite) => captureSoft(suite, false),
  },
  {
    id: 'rope-payload-frame', family: 'rope tuple removal', sceneId: 658,
    description: 'reverted rope payload tuple candidate control',
    control: true,
    pilotIterations: 20000, maxIterations: 2000000, preTimedIterations: 1000,
    setup: (project) => setupSoft(project, 658),
    operation: (suite) => forceSoftFrame(suite, false),
    capture: (suite) => captureSoft(suite, false),
  },
  {
    id: 'rope-debug-frame', family: 'rope tuple removal', sceneId: 658,
    description: 'reverted rope debug tuple candidate control',
    control: true,
    pilotIterations: 300, maxIterations: 100000, preTimedIterations: 20,
    setup: (project) => setupSoft(project, 658),
    operation: (suite) => forceSoftFrame(suite, true),
    capture: (suite) => captureSoft(suite, true),
  },
];

function measure(project, definition, iterations) {
  const subject = definition.setup(project);
  global.gc?.();
  // Prime this fresh subject after collection so post-GC first-call and cold
  // cache effects cannot masquerade as an implementation difference.
  for (let i = 0; i < definition.preTimedIterations; i++) definition.operation(subject);
  const started = performance.now();
  for (let i = 0; i < iterations; i++) definition.operation(subject);
  const elapsedMs = performance.now() - started;
  const capture = definition.capture(subject);
  subject.destroy?.();
  return { elapsedMs, nsPerOperation: elapsedMs * 1e6 / iterations, capture };
}

function calibrate(baseline, candidate, definition) {
  const baselinePilot = measure(baseline, definition, definition.pilotIterations);
  const candidatePilot = measure(candidate, definition, definition.pilotIterations);
  assert.deepEqual(candidatePilot.capture, baselinePilot.capture, `${definition.id} pilot output`);
  const baselineNs = baselinePilot.elapsedMs * 1e6 / definition.pilotIterations;
  const candidateNs = candidatePilot.elapsedMs * 1e6 / definition.pilotIterations;
  const fastestNs = Math.max(0.01, Math.min(baselineNs, candidateNs));
  const slowestNs = Math.max(baselineNs, candidateNs);
  const targetIterations = Math.ceil(TARGET_FAST_MS * 1e6 / fastestNs);
  const slowCapIterations = Math.max(definition.pilotIterations, Math.floor(MAX_SLOW_MS * 1e6 / slowestNs));
  const iterations = Math.max(
    definition.pilotIterations,
    Math.min(definition.maxIterations, targetIterations, slowCapIterations),
  );
  return {
    iterations,
    pilot: {
      baselineNsPerOperation: baselineNs,
      candidateNsPerOperation: candidateNs,
      expectedBaselineBatchMs: baselineNs * iterations / 1e6,
      expectedCandidateBatchMs: candidateNs * iterations / 1e6,
    },
  };
}

function classify(summary, baselineNoise, candidateNoise) {
  const bothOrdersNonRegressive = summary.baselineFirstRatio >= 0.98 && summary.candidateFirstRatio >= 0.98;
  const bothOrdersNonWinning = summary.baselineFirstRatio <= 1.02 && summary.candidateFirstRatio <= 1.02;
  let decision = 'parity/noise';
  if (summary.speedup >= 1.02 && summary.confidence95.lower > 1 && bothOrdersNonRegressive) decision = 'true-win';
  else if (summary.speedup <= 0.98 && summary.confidence95.upper < 1 && bothOrdersNonWinning) decision = 'regression';
  const maximumNoise = Math.max(baselineNoise, candidateNoise);
  const noise = maximumNoise <= 0.03 ? 'low' : maximumNoise <= 0.08 ? 'moderate' : 'high';
  return { decision, noise, maximumNormalizedMad: maximumNoise };
}

function markdown(result) {
  const lines = [
    '# WebPhysics v1.12 focused runtime-candidate qualification',
    '',
    `Exact baseline archive: \`${result.baselineArchiveSha256}\`.`,
    '',
    `Each path used **${result.sampleCount}** timed samples (equal execution-order strata), ${result.warmupRounds} warmup rounds per implementation, calibrated batches, and ${result.bootstrapResamples.toLocaleString()} order-stratified bootstrap resamples.`,
    '',
    'Classification requires at least a 2% effect and a 95% interval wholly beyond parity. Smaller/inconclusive effects are parity/noise.',
    '',
    '| Family | Complete timed path | Iterations | v1.11 ns/op | v1.12 ns/op | Speedup | 95% CI | nMAD | Result | Exact |',
    '|---|---|---:|---:|---:|---:|---:|---:|---|---|',
  ];
  for (const record of result.records) {
    lines.push(`| ${record.family} | ${record.id} | ${record.iterations.toLocaleString()} | ${record.baseline.nsPerOperation.toFixed(2)} | ${record.candidate.nsPerOperation.toFixed(2)} | **${record.speedup.toFixed(3)}x** | ${record.confidence95.lower.toFixed(3)}–${record.confidence95.upper.toFixed(3)} | ${(record.classification.maximumNormalizedMad * 100).toFixed(2)}% | **${record.classification.decision}** (${record.classification.noise} noise) | yes |`);
  }
  lines.push(
    '',
    '## Interpretation',
    '',
    ...result.interpretation.map((item) => `- ${item}`),
    '',
    'Every sample started from the same scene/stress/seed. Setup, garbage collection, post-GC subject priming, and capture hashing were excluded from timed regions. Final matrices, colors, debug lines, authoritative soft state, body/node counts, frame versions, and replay hashes matched bit-for-bit across versions and across repeated samples.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

function main() {
  const sourceHashesAtStart = relevantSourceHashes();
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-v112-runtime-'));
  const projects = prepareProjects(tempRoot);
  const records = [];

  for (let caseIndex = 0; caseIndex < CASES.length; caseIndex++) {
    const definition = CASES[caseIndex];
    const calibration = calibrate(projects.baseline, projects.candidate, definition);

    for (let warmup = 0; warmup < WARMUP_ROUNDS; warmup++) {
      const first = ((caseIndex + warmup) & 1) === 0 ? projects.baseline : projects.candidate;
      const second = first === projects.baseline ? projects.candidate : projects.baseline;
      measure(first, definition, calibration.iterations);
      measure(second, definition, calibration.iterations);
    }

    const baselineSamples = [];
    const candidateSamples = [];
    const baselineFingerprints = [];
    const candidateFingerprints = [];
    const groups = { baselineFirst: [], baselineSecond: [], candidateFirst: [], candidateSecond: [] };
    for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
      const baselineFirst = ((caseIndex + sample) & 1) === 0;
      const order = baselineFirst
        ? [projects.baseline, projects.candidate]
        : [projects.candidate, projects.baseline];
      for (let orderIndex = 0; orderIndex < order.length; orderIndex++) {
        const project = order[orderIndex];
        const measured = measure(project, definition, calibration.iterations);
        if (project === projects.baseline) {
          baselineSamples.push(measured.nsPerOperation);
          baselineFingerprints.push(measured.capture.fingerprint);
          groups[orderIndex === 0 ? 'baselineFirst' : 'baselineSecond'].push(measured.nsPerOperation);
        } else {
          candidateSamples.push(measured.nsPerOperation);
          candidateFingerprints.push(measured.capture.fingerprint);
          groups[orderIndex === 0 ? 'candidateFirst' : 'candidateSecond'].push(measured.nsPerOperation);
        }
      }
    }

    assert.equal(new Set(baselineFingerprints).size, 1, `${definition.id} baseline determinism`);
    assert.equal(new Set(candidateFingerprints).size, 1, `${definition.id} candidate determinism`);
    assert.equal(candidateFingerprints[0], baselineFingerprints[0], `${definition.id} exact cross-version output/hash`);

    const summary = orderBalancedSummary(groups, (0x112c0000 + caseIndex) >>> 0);
    const baselineMedian = median(baselineSamples);
    const candidateMedian = median(candidateSamples);
    const baselineNoise = mad(baselineSamples) / Math.max(baselineMedian, 1e-12);
    const candidateNoise = mad(candidateSamples) / Math.max(candidateMedian, 1e-12);
    const measuredClassification = classify(summary, baselineNoise, candidateNoise);
    const classification = definition.control
      ? { ...measuredClassification, decision: 'control' }
      : measuredClassification;
    const record = {
      id: definition.id,
      family: definition.family,
      sceneId: definition.sceneId,
      description: definition.description,
      iterations: calibration.iterations,
      preTimedIterations: definition.preTimedIterations,
      calibration: calibration.pilot,
      exact: {
        passed: true,
        fingerprint: baselineFingerprints[0],
        deterministicBaselineSamples: baselineFingerprints.length,
        deterministicCandidateSamples: candidateFingerprints.length,
      },
      baseline: { nsPerOperation: baselineMedian, normalizedMad: baselineNoise, samples: baselineSamples },
      candidate: { nsPerOperation: candidateMedian, normalizedMad: candidateNoise, samples: candidateSamples },
      speedup: summary.speedup,
      confidence95: summary.confidence95,
      orderStrata: {
        baselineFirstRatio: summary.baselineFirstRatio,
        candidateFirstRatio: summary.candidateFirstRatio,
        samplesPerOrder: SAMPLE_COUNT / 2,
      },
      classification,
    };
    records.push(record);
    console.log(`${definition.id}: ${record.speedup.toFixed(3)}x (${record.confidence95.lower.toFixed(3)}–${record.confidence95.upper.toFixed(3)}) ${classification.decision}`);
  }

  assert.deepEqual(relevantSourceHashes(), sourceHashesAtStart, 'relevant product source changed during benchmark');
  const byId = Object.fromEntries(records.map((record) => [record.id, record]));
  const result = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    baseline: 'v1.11.0 exact bundled source archive',
    candidate: 'v1.12 working tree',
    baselineArchiveSha256: projects.archiveHash,
    relevantCandidateSourceSha256: sourceHashesAtStart,
    environment: { node: process.version, platform: process.platform, arch: process.arch },
    sampleCount: SAMPLE_COUNT,
    warmupRounds: WARMUP_ROUNDS,
    bootstrapResamples: BOOTSTRAPS,
    targetFastBatchMs: TARGET_FAST_MS,
    maximumSlowBatchMs: MAX_SLOW_MS,
    exactCases: records.filter((record) => record.exact.passed).length,
    summary: {
      trueWins: records.filter((record) => record.classification.decision === 'true-win').length,
      parityOrNoise: records.filter((record) => record.classification.decision === 'parity/noise').length,
      regressions: records.filter((record) => record.classification.decision === 'regression').length,
      controls: records.filter((record) => record.classification.decision === 'control').length,
    },
    interpretation: [
      `Rejected fallback cached-count candidate is restored as a control at ${byId['fallback-dynamic-count'].speedup.toFixed(3)}x; complete-frame evidence outweighed its isolated query speed.`,
      `Rejected fallback dynamic-count and traversal candidates were fully reverted. The restored v1.11 fallback remains a control: dynamicCount ${byId['fallback-dynamic-count'].speedup.toFixed(3)}x, syncTransforms ${byId['fallback-sync-transforms'].speedup.toFixed(3)}x, and complete frame ${byId['fallback-complete-step'].speedup.toFixed(3)}x.`,
      `Axis-aligned matrix specialization: cloth sphere ${byId['cloth-sphere-frame'].classification.decision} at ${byId['cloth-sphere-frame'].speedup.toFixed(3)}x; full 768-droplet water frame ${byId['water-768-droplet-frame'].classification.decision} at ${byId['water-768-droplet-frame'].speedup.toFixed(3)}x.`,
      `Rejected rope tuple candidates remain controls: payload ${byId['rope-payload-frame'].speedup.toFixed(3)}x; debug ${byId['rope-debug-frame'].speedup.toFixed(3)}x.`,
    ],
    records,
    observableSink,
  };

  fs.writeFileSync(RESULTS_JSON, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(RESULTS_MD, markdown(result));
  console.log(JSON.stringify(result.summary, null, 2));
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

main();
