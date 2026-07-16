import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = path.join(root, 'node_modules/.bin/tsc');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-v110-benchmark-'));
const baselineArchive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.9.0-integration-source.tar.gz');
const baselineRoot = process.env.V110_BASELINE_ROOT
  ? path.resolve(process.env.V110_BASELINE_ROOT)
  : path.join(tempRoot, 'baseline-source');
if (!process.env.V110_BASELINE_ROOT) {
  fs.mkdirSync(baselineRoot, { recursive: true });
  execFileSync('tar', ['-xzf', baselineArchive, '-C', baselineRoot]);
}
let benchmarkSink = 0;

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function geometricMean(values) {
  return Math.exp(values.reduce((sum, value) => sum + Math.log(value), 0) / values.length);
}

function elapsedMs(fn) {
  const start = performance.now();
  fn();
  return performance.now() - start;
}

function compileProject(sourceRoot, label) {
  const buildRoot = path.join(tempRoot, label);
  execFileSync(tsc, [
    '-p', path.join(sourceRoot, 'tsconfig.test.json'),
    '--outDir', buildRoot,
    '--rootDir', sourceRoot,
  ], { cwd: root, stdio: 'pipe' });
  fs.writeFileSync(path.join(buildRoot, 'package.json'), '{"type":"commonjs"}\n');
  return buildRoot;
}

function createEffects(Ctor, budget) {
  const effects = new Ctor();
  effects.clear(0x515151);
  for (let i = 0; i < 10; i++) effects.spawnExplosion([i * 0.3 - 1.5, 3 + (i % 3), i * -0.2], 24, budget);
  for (let i = 0; i < 4; i++) effects.spawnRainFlash([0, 16 + i, 0], budget);
  effects.spawnProjectileMuzzle([-12, 6, 0], [24, 2, 0], budget);
  effects.spawnImpulseDust([0, 0.2, 0], 16, budget);
  return effects;
}

function effectsOperation(Ctor, workload) {
  const budget = 1536;
  const effects = createEffects(Ctor, budget);
  if (workload === 'unchanged') {
    effects.update(1 / 60);
    effects.buildFrame(budget);
    const iterations = 3000;
    return elapsedMs(() => {
      for (let i = 0; i < iterations; i++) {
        const frame = effects.buildFrame(budget);
        benchmarkSink = (benchmarkSink + frame.count + (frame.frameVersion ?? 0)) >>> 0;
      }
    }) / iterations;
  }
  const frames = 90;
  return elapsedMs(() => {
    for (let frame = 0; frame < frames; frame++) {
      if (frame > 0 && frame % 30 === 0) effects.spawnExplosion([0, 3, 0], 18, budget);
      effects.update(1 / 120);
      if (workload === 'changed') effects.buildFrame(budget);
    }
  }) / frames;
}

function relativeL2(a, b, count) {
  let error = 0;
  let reference = 0;
  for (let i = 0; i < count; i++) {
    const delta = a[i] - b[i];
    error += delta * delta;
    reference += a[i] * a[i];
  }
  return Math.sqrt(error / Math.max(reference, 1e-30));
}

function retainedTypedBytes(value, seenObjects = new Set(), seenBuffers = new Set()) {
  if (!value || typeof value !== 'object' || seenObjects.has(value)) return 0;
  seenObjects.add(value);
  if (ArrayBuffer.isView(value)) {
    if (seenBuffers.has(value.buffer)) return 0;
    seenBuffers.add(value.buffer);
    return value.buffer.byteLength;
  }
  let total = 0;
  for (const child of Object.values(value)) total += retainedTypedBytes(child, seenObjects, seenBuffers);
  return total;
}

function waterInitOperation(Suite, scenes) {
  const scene = scenes.SCENES.find((candidate) => candidate.family === 'water' && candidate.mode === 4 && candidate.variant === 9);
  assert.ok(scene, 'maximum water scene missing');
  const iterations = 200;
  return elapsedMs(() => {
    for (let i = 0; i < iterations; i++) {
      const suite = new Suite();
      suite.createScene(scene, 5, (0x515151 + i) >>> 0);
      suite.destroy();
    }
  }) / iterations;
}

function benchmarkPair(baselineFn, optimizedFn, samples = 11) {
  for (let i = 0; i < 3; i++) {
    baselineFn();
    optimizedFn();
  }
  const baseline = [];
  const optimized = [];
  for (let sample = 0; sample < samples; sample++) {
    if (sample & 1) {
      optimized.push(optimizedFn());
      baseline.push(baselineFn());
    } else {
      baseline.push(baselineFn());
      optimized.push(optimizedFn());
    }
  }
  const baselineMedian = median(baseline);
  const optimizedMedian = median(optimized);
  return { baseline, optimized, baselineMedian, optimizedMedian, speedup: baselineMedian / optimizedMedian };
}

function ropeSample(buildRoot, sceneId) {
  return JSON.parse(execFileSync(process.execPath, [
    '--expose-gc',
    path.join(root, 'benchmarks/rope-hotpath-worker.cjs'),
    buildRoot,
    root,
    String(sceneId),
    'simd',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, ROPE_WARMUPS: '7', ROPE_ITERATIONS: '80', ROPE_PROJECTILES: '96' },
    maxBuffer: 16 * 1024 * 1024,
  }));
}

try {
  if (!fs.existsSync(path.join(baselineRoot, 'src/effects.ts'))) throw new Error(`V1.10 baseline is missing at ${baselineRoot}`);
  const baselineBuild = compileProject(baselineRoot, 'baseline');
  const optimizedBuild = compileProject(root, 'optimized');
  const baselineEffects = require(path.join(baselineBuild, 'src/effects.js')).CinematicEffects;
  const optimizedEffects = require(path.join(optimizedBuild, 'src/effects.js')).CinematicEffects;
  const baselineSim = require(path.join(baselineBuild, 'src/soft/simulations.js'));
  const optimizedSim = require(path.join(optimizedBuild, 'src/soft/simulations.js'));
  const baselineScenes = require(path.join(baselineBuild, 'src/scenes.js'));
  const optimizedScenes = require(path.join(optimizedBuild, 'src/scenes.js'));

  const effectsCorrectA = createEffects(baselineEffects, 1536);
  const effectsCorrectB = createEffects(optimizedEffects, 1536);
  for (let i = 0; i < 45; i++) {
    effectsCorrectA.update(1 / 120);
    effectsCorrectB.update(1 / 120);
  }
  const effectFrameA = effectsCorrectA.buildFrame(1536);
  const effectFrameB = effectsCorrectB.buildFrame(1536);
  assert.equal(effectFrameA.count, effectFrameB.count);
  const effectCorrectness = {
    count: effectFrameA.count,
    matrixRelativeL2: relativeL2(effectFrameA.matrices, effectFrameB.matrices, effectFrameA.count * 16),
    colorRelativeL2: relativeL2(effectFrameA.colors, effectFrameB.colors, effectFrameA.count * 4),
    debugLinesEqual: effectFrameA.debugLines.length === effectFrameB.debugLines.length,
    maximumDebugLineAbsoluteError: 0,
  };
  const debugFields = ['ax', 'ay', 'az', 'bx', 'by', 'bz', 'r', 'g', 'b', 'a'];
  for (let line = 0; line < effectFrameA.debugLines.length; line++) {
    for (const field of debugFields) {
      effectCorrectness.maximumDebugLineAbsoluteError = Math.max(
        effectCorrectness.maximumDebugLineAbsoluteError,
        Math.abs(effectFrameA.debugLines[line][field] - effectFrameB.debugLines[line][field]),
      );
    }
  }
  assert.equal(effectCorrectness.matrixRelativeL2, 0);
  assert.equal(effectCorrectness.colorRelativeL2, 0);
  assert.equal(effectCorrectness.debugLinesEqual, true);
  assert.ok(effectCorrectness.maximumDebugLineAbsoluteError <= 1e-12, `effect debug-line error ${effectCorrectness.maximumDebugLineAbsoluteError}`);

  const effects = {
    changedFrame: benchmarkPair(
      () => effectsOperation(baselineEffects, 'changed'),
      () => effectsOperation(optimizedEffects, 'changed'),
    ),
    updateOnly: benchmarkPair(
      () => effectsOperation(baselineEffects, 'update'),
      () => effectsOperation(optimizedEffects, 'update'),
    ),
    unchangedFrame: benchmarkPair(
      () => effectsOperation(baselineEffects, 'unchanged'),
      () => effectsOperation(optimizedEffects, 'unchanged'),
    ),
  };

  const waterInit = benchmarkPair(
    () => waterInitOperation(baselineSim.SoftSimulationSuite, baselineScenes),
    () => waterInitOperation(optimizedSim.SoftSimulationSuite, optimizedScenes),
  );
  const baselineWaterSuite = new baselineSim.SoftSimulationSuite();
  const optimizedWaterSuite = new optimizedSim.SoftSimulationSuite();
  const baselineWaterScene = baselineScenes.SCENES.find((scene) => scene.family === 'water' && scene.mode === 4 && scene.variant === 9);
  const optimizedWaterScene = optimizedScenes.SCENES.find((scene) => scene.family === 'water' && scene.mode === 4 && scene.variant === 9);
  baselineWaterSuite.createScene(baselineWaterScene, 5, 0x515151);
  optimizedWaterSuite.createScene(optimizedWaterScene, 5, 0x515151);
  const waterMemory = {
    baselineBytes: retainedTypedBytes(baselineWaterSuite),
    optimizedBytes: retainedTypedBytes(optimizedWaterSuite),
  };
  waterMemory.reductionBytes = waterMemory.baselineBytes - waterMemory.optimizedBytes;
  waterMemory.reductionFraction = 1 - waterMemory.optimizedBytes / waterMemory.baselineBytes;

  const ropeSceneIds = [695, 696, 697, 698, 699];
  const rope = [];
  for (const sceneId of ropeSceneIds) {
    const baselineSamples = [];
    const optimizedSamples = [];
    for (let sample = 0; sample < 5; sample++) {
      const order = sample & 1
        ? [['optimized', optimizedBuild], ['baseline', baselineBuild]]
        : [['baseline', baselineBuild], ['optimized', optimizedBuild]];
      const pair = {};
      for (const [label, build] of order) pair[label] = ropeSample(build, sceneId);
      assert.equal(pair.baseline.exactStateHash, pair.optimized.exactStateHash, `rope ${sceneId} exact state mismatch`);
      assert.equal(pair.baseline.replayHash, pair.optimized.replayHash, `rope ${sceneId} replay mismatch`);
      baselineSamples.push(pair.baseline.msPerFrame);
      optimizedSamples.push(pair.optimized.msPerFrame);
    }
    const baselineMedian = median(baselineSamples);
    const optimizedMedian = median(optimizedSamples);
    rope.push({ sceneId, baselineSamples, optimizedSamples, baselineMedian, optimizedMedian, speedup: baselineMedian / optimizedMedian });
  }

  const evidence = {
    environment: {
      node: process.version,
      platform: `${process.platform}/${process.arch}`,
      baselineSource: process.env.V110_BASELINE_ROOT ?? path.relative(root, baselineArchive),
      alternatingOrder: true,
      observableSink: benchmarkSink,
    },
    correctness: { effects: effectCorrectness, ropeExactScenes: ropeSceneIds },
    effects,
    waterInitialization: waterInit,
    waterRetainedMemory: waterMemory,
    rope,
    ropeGeometricMean: geometricMean(rope.map((result) => result.speedup)),
  };
  const outputPath = path.join(root, 'benchmarks/results/v1.10-integration-hotpaths.json');
  if (process.env.V110_WRITE_RESULTS !== '0') {
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify(evidence, null, 2));
  console.log(process.env.V110_WRITE_RESULTS === '0' ? 'Result persistence disabled.' : `Wrote ${outputPath}`);
} finally {
  fs.rmSync(tempRoot, { recursive: true, force: true });
}
