import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import ts from 'typescript';

const ROOT = path.resolve(import.meta.dirname, '..');
const EFFECTS_PATH = path.join(ROOT, 'src/effects.ts');
const MATH_PATH = path.join(ROOT, 'src/math.ts');
const RESULTS_JSON = path.join(ROOT, 'benchmarks/results/v112-effects-drag.json');
const RESULTS_MD = path.join(ROOT, 'benchmarks/results/v112-effects-drag.md');
const SAMPLES = Math.max(8, Number(process.env.V112_EFFECTS_SAMPLES ?? 12));
const require = createRequire(import.meta.url);

assert.equal(SAMPLES % 2, 0, 'V112_EFFECTS_SAMPLES must be even for balanced execution order');

const candidateSource = fs.readFileSync(EFFECTS_PATH, 'utf8');
const mathSource = fs.readFileSync(MATH_PATH, 'utf8');
const precomputeBlock = `    // Every built-in effect uses one of these five drag coefficients. Compute
    // their identical exponential factors once per update instead of once per
    // particle; retain the legacy calculation for any future custom value.
    const hasParticles = this.particles.length > 0;
    const explosionHotDrag = hasParticles ? Math.pow(0.94, dragScale) : 1;
    const explosionSmokeDrag = hasParticles ? Math.pow(0.975, dragScale) : 1;
    const projectileDrag = hasParticles ? Math.pow(0.92, dragScale) : 1;
    const impulseDustDrag = hasParticles ? Math.pow(0.965, dragScale) : 1;
    const rainDrag = hasParticles ? Math.pow(0.998, dragScale) : 1;

`;
const dispatchBlock = `      const drag = particle.drag === 0.94 ? explosionHotDrag
        : particle.drag === 0.975 ? explosionSmokeDrag
        : particle.drag === 0.92 ? projectileDrag
        : particle.drag === 0.965 ? impulseDustDrag
        : particle.drag === 0.998 ? rainDrag
        : Math.pow(particle.drag, dragScale);`;
assert.ok(candidateSource.includes(precomputeBlock), 'candidate drag precomputation block is missing');
assert.ok(candidateSource.includes(dispatchBlock), 'candidate exact drag dispatch block is missing');
const baselineSource = candidateSource
  .replace(precomputeBlock, '')
  .replace(dispatchBlock, '      const drag = Math.pow(particle.drag, dragScale);');
assert.ok(!baselineSource.includes('explosionHotDrag'), 'failed to reconstruct the immediate legacy control');

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-v112-effects-'));

function compileVariant(label, effectsSource) {
  const root = path.join(tempRoot, label);
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"commonjs"}\n');
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    esModuleInterop: true,
  };
  const compile = (name, source) => {
    const result = ts.transpileModule(source, { compilerOptions: options, fileName: `${name}.ts` });
    fs.writeFileSync(path.join(root, `${name}.js`), result.outputText);
  };
  compile('math', mathSource);
  compile('effects', effectsSource);
  return require(path.join(root, 'effects.js')).CinematicEffects;
}

const BaselineEffects = compileVariant('baseline', baselineSource);
const CandidateEffects = compileVariant('candidate', candidateSource);

function createEffects(Ctor, kind, seedOffset = 0) {
  const effects = new Ctor();
  effects.clear((0x515151 + seedOffset) >>> 0);
  if (kind === 'explosion') {
    for (let i = 0; i < 14; i++) {
      effects.spawnExplosion([i * 0.21 - 1.4, 2.5 + (i % 4) * 0.3, i * -0.13], 24, 1536);
    }
  } else if (kind === 'ballistic') {
    for (let i = 0; i < 12; i++) effects.spawnProjectileMuzzle([-12 + i * 0.2, 6, 0], [24, 2, i * 0.03], 1536);
    for (let i = 0; i < 8; i++) effects.spawnImpulseDust([i * 0.3 - 1, 0.2, i * -0.2], 16, 1536);
    for (let i = 0; i < 8; i++) effects.spawnRainFlash([0, 16 + i * 0.1, 0], 1536);
  } else {
    for (let i = 0; i < 10; i++) {
      effects.spawnExplosion([i * 0.3 - 1.5, 3 + (i % 3), i * -0.2], 24, 1536);
    }
    for (let i = 0; i < 4; i++) effects.spawnRainFlash([0, 16 + i, 0], 1536);
    for (let i = 0; i < 4; i++) effects.spawnProjectileMuzzle([-12 + i, 6, 0], [24, 2, i * 0.1], 1536);
    for (let i = 0; i < 4; i++) effects.spawnImpulseDust([i * 0.4 - 0.8, 0.2, 0], 16, 1536);
  }
  return effects;
}

function assertNumberExact(actual, expected, label) {
  assert.ok(Object.is(actual, expected), `${label}: ${actual} !== ${expected}`);
}

function assertFloat32Exact(actual, expected, count, label) {
  assert.ok(actual.length >= count && expected.length >= count, `${label} is shorter than ${count}`);
  const a = new Uint32Array(actual.buffer, actual.byteOffset, count);
  const b = new Uint32Array(expected.buffer, expected.byteOffset, count);
  for (let i = 0; i < count; i++) assert.equal(a[i], b[i], `${label}[${i}] differs`);
}

const LINE_FIELDS = ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'r', 'g', 'b', 'a'];
let exactFrames = 0;
let exactScalars = 0;
let aggregateHash = 0x811c9dc5;
const exactBaseline = createEffects(BaselineEffects, 'mixed');
const exactCandidate = createEffects(CandidateEffects, 'mixed');
const deltaPattern = [1 / 60, 1 / 120, 1 / 90, 0.05, 0, 1 / 144];
for (let frameIndex = 0; frameIndex < 360; frameIndex++) {
  if (frameIndex === 90 || frameIndex === 210) {
    const center = [frameIndex * 0.001, 3, -frameIndex * 0.0005];
    exactBaseline.spawnExplosion(center, 18, 1536);
    exactCandidate.spawnExplosion(center, 18, 1536);
  }
  if (frameIndex === 150) {
    exactBaseline.spawnRainFlash([0, 16, 0], 1536);
    exactCandidate.spawnRainFlash([0, 16, 0], 1536);
  }
  const dt = deltaPattern[frameIndex % deltaPattern.length];
  exactBaseline.update(dt);
  exactCandidate.update(dt);
  assert.equal(exactCandidate.particleCount(), exactBaseline.particleCount(), `particle count at frame ${frameIndex}`);
  const baselineFrame = exactBaseline.buildFrame(1536);
  const candidateFrame = exactCandidate.buildFrame(1536);
  assert.equal(candidateFrame.count, baselineFrame.count, `frame count at ${frameIndex}`);
  assert.equal(candidateFrame.frameVersion, baselineFrame.frameVersion, `frame version at ${frameIndex}`);
  assertFloat32Exact(candidateFrame.matrices, baselineFrame.matrices, baselineFrame.count * 16, `matrices frame ${frameIndex}`);
  assertFloat32Exact(candidateFrame.colors, baselineFrame.colors, baselineFrame.count * 4, `colors frame ${frameIndex}`);
  assert.equal(candidateFrame.debugLines.length, baselineFrame.debugLines.length, `line count at ${frameIndex}`);
  for (let lineIndex = 0; lineIndex < baselineFrame.debugLines.length; lineIndex++) {
    for (const field of LINE_FIELDS) {
      assertNumberExact(candidateFrame.debugLines[lineIndex][field], baselineFrame.debugLines[lineIndex][field], `line ${lineIndex}.${field} frame ${frameIndex}`);
      exactScalars++;
    }
  }
  const baselineShake = exactBaseline.cameraShake();
  const candidateShake = exactCandidate.cameraShake();
  assertNumberExact(candidateShake.yaw, baselineShake.yaw, `shake yaw frame ${frameIndex}`);
  assertNumberExact(candidateShake.pitch, baselineShake.pitch, `shake pitch frame ${frameIndex}`);
  for (let axis = 0; axis < 3; axis++) {
    assertNumberExact(candidateShake.targetOffset[axis], baselineShake.targetOffset[axis], `shake target ${axis} frame ${frameIndex}`);
  }
  exactScalars += 5;
  aggregateHash ^= candidateFrame.count;
  aggregateHash = Math.imul(aggregateHash, 0x01000193) >>> 0;
  exactFrames++;
}

const scenarios = [
  { name: 'mixed-60hz', kind: 'mixed', frames: 72, replicas: 5, deltas: [1 / 60] },
  { name: 'mixed-120hz', kind: 'mixed', frames: 108, replicas: 5, deltas: [1 / 120] },
  { name: 'explosion-dense', kind: 'explosion', frames: 72, replicas: 5, deltas: [1 / 60] },
  { name: 'ballistic-and-rain', kind: 'ballistic', frames: 72, replicas: 5, deltas: [1 / 60] },
  { name: 'mixed-variable-dt', kind: 'mixed', frames: 96, replicas: 5, deltas: deltaPattern },
];

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function measureWorkload(Ctor, scenario, includeBuild, seedBase) {
  const instances = Array.from({ length: scenario.replicas }, (_, index) => createEffects(Ctor, scenario.kind, seedBase + index));
  let sink = 0;
  const start = performance.now();
  for (let frameIndex = 0; frameIndex < scenario.frames; frameIndex++) {
    const dt = scenario.deltas[frameIndex % scenario.deltas.length];
    for (let replica = 0; replica < instances.length; replica++) {
      const effects = instances[replica];
      effects.update(dt);
      if (includeBuild) {
        const frame = effects.buildFrame(1536);
        sink += frame.count + frame.matrices[0] + frame.colors[0] + frame.debugLines.length;
      } else {
        sink += effects.particleCount();
      }
    }
  }
  return { ms: performance.now() - start, sink };
}

function stats(values) {
  const center = median(values);
  return { medianMs: center, madMs: median(values.map((value) => Math.abs(value - center))), samplesMs: values };
}

function measureScenario(scenario, includeBuild) {
  for (let warmup = 0; warmup < 3; warmup++) {
    measureWorkload(BaselineEffects, scenario, includeBuild, 0x1000 + warmup * 10);
    measureWorkload(CandidateEffects, scenario, includeBuild, 0x1000 + warmup * 10);
  }
  const baseline = [];
  const candidate = [];
  const baselineFirst = { baseline: [], candidate: [] };
  const candidateFirst = { baseline: [], candidate: [] };
  let sink = 0;
  for (let sample = 0; sample < SAMPLES; sample++) {
    globalThis.gc?.();
    const seed = 0x5000 + sample * 100;
    const order = sample % 2 === 0
      ? [[BaselineEffects, baseline, baselineFirst.baseline], [CandidateEffects, candidate, baselineFirst.candidate]]
      : [[CandidateEffects, candidate, candidateFirst.candidate], [BaselineEffects, baseline, candidateFirst.baseline]];
    for (const [Ctor, pooled, stratum] of order) {
      const measured = measureWorkload(Ctor, scenario, includeBuild, seed);
      pooled.push(measured.ms);
      stratum.push(measured.ms);
      sink += measured.sink;
    }
  }
  const baselineFirstRatio = median(baselineFirst.baseline) / median(baselineFirst.candidate);
  const candidateFirstRatio = median(candidateFirst.baseline) / median(candidateFirst.candidate);
  return {
    name: `${scenario.name}:${includeBuild ? 'update+build' : 'update-only'}`,
    frames: scenario.frames,
    replicas: scenario.replicas,
    callsPerSample: scenario.frames * scenario.replicas,
    baseline: stats(baseline),
    candidate: stats(candidate),
    speedup: Math.sqrt(baselineFirstRatio * candidateFirstRatio),
    pooledMedianSpeedup: median(baseline) / median(candidate),
    orderStrata: { baselineFirstRatio, candidateFirstRatio },
    sink,
  };
}

const measurements = [];
for (const scenario of scenarios) {
  measurements.push(measureScenario(scenario, false));
  measurements.push(measureScenario(scenario, true));
}
const geometricMean = (values) => Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
const updateOnly = measurements.filter((entry) => entry.name.endsWith(':update-only'));
const updateAndBuild = measurements.filter((entry) => entry.name.endsWith(':update+build'));
const result = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  candidate: 'precompute five exact built-in particle drag factors once per CinematicEffects.update',
  source: {
    candidate: 'src/effects.ts',
    candidateSha256: crypto.createHash('sha256').update(candidateSource).digest('hex'),
    immediateControl: 'candidate source with only the five-factor precompute/dispatch block mechanically reverted',
    immediateControlSha256: crypto.createHash('sha256').update(baselineSource).digest('hex'),
  },
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    samples: SAMPLES,
    balancedExecutionOrder: true,
  },
  exactness: {
    passed: true,
    frames: exactFrames,
    scalarComparisons: exactScalars,
    float32MatrixAndColorBitsExact: true,
    debugLinesExact: true,
    cameraShakeExact: true,
    particleCountsAndFrameVersionsExact: true,
    aggregateHash: `0x${aggregateHash.toString(16).padStart(8, '0')}`,
  },
  summary: {
    updateOnlyGeometricMeanSpeedup: geometricMean(updateOnly.map((entry) => entry.speedup)),
    updateAndBuildGeometricMeanSpeedup: geometricMean(updateAndBuild.map((entry) => entry.speedup)),
    minimumUpdateOnlySpeedup: Math.min(...updateOnly.map((entry) => entry.speedup)),
    minimumUpdateAndBuildSpeedup: Math.min(...updateAndBuild.map((entry) => entry.speedup)),
  },
  measurements,
};

if (process.env.V112_EFFECTS_WRITE !== '0') {
  fs.writeFileSync(RESULTS_JSON, `${JSON.stringify(result, null, 2)}\n`);
  const rows = measurements.map((entry) => `| ${entry.name} | ${entry.baseline.medianMs.toFixed(3)} ms | ${entry.candidate.medianMs.toFixed(3)} ms | **${entry.speedup.toFixed(3)}×** |`).join('\n');
  fs.writeFileSync(RESULTS_MD, `# WebPhysics v1.12 — exact cinematic-effect drag-factor benchmark

The immediate control is the current source with only the five-factor drag precomputation mechanically reverted. All other v1.11/v1.12 source is identical.

## Exactness

- Compared frames: **${result.exactness.frames}**
- Compared line/shake scalars: **${result.exactness.scalarComparisons.toLocaleString()}**
- Float32 matrix/color bits: **exact**
- Debug lines, camera shake, counts, and frame versions: **exact**

## Complete class workloads

| Workload | Control | Candidate | Balanced speedup |
|---|---:|---:|---:|
${rows}

Update-only geometric mean: **${result.summary.updateOnlyGeometricMeanSpeedup.toFixed(3)}×**
Update-plus-build geometric mean: **${result.summary.updateAndBuildGeometricMeanSpeedup.toFixed(3)}×**

These are complete real CinematicEffects.update and update + buildFrame workloads, not the isolated Math.pow micro-kernel.
`);
}

console.log(JSON.stringify({ exactness: result.exactness, summary: result.summary }, null, 2));
fs.rmSync(tempRoot, { recursive: true, force: true });
