import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), '..');

function exactBytes(view) {
  return Buffer.from(view.buffer, view.byteOffset, view.byteLength);
}

function applyScheduledAction(suite, frame) {
  if (frame === 60) suite.kick(18);
  else if (frame === 120) suite.explode([0, 8, 0], 24, 12);
  else if (frame === 180) suite.launchProjectile([-18, 10, 0], [38, 0, 0], 1);
  else if (frame === 240) suite.spawnRain(96, 14, 24);
  else if (frame === 420) suite.explode([3, 6, -2], 16, 9);
  else if (frame === 540) suite.kick(12);
}

async function workerMain(baselineBuild, optimizedBuild, stress) {
  const baselineScenes = require(path.join(baselineBuild, 'src/scenes.js')).SCENES;
  const optimizedScenes = require(path.join(optimizedBuild, 'src/scenes.js')).SCENES;
  const BaselineSuite = require(path.join(baselineBuild, 'src/soft/simulations.js')).SoftSimulationSuite;
  const { SoftSimulationSuite: OptimizedSuite, ropeBatchProjectionEligible } = require(path.join(optimizedBuild, 'src/soft/simulations.js'));
  const BaselineKernel = require(path.join(baselineBuild, 'src/soft/kernels.js')).SoftKernelModule;
  const OptimizedKernel = require(path.join(optimizedBuild, 'src/soft/kernels.js')).SoftKernelModule;
  const wasm = fs.readFileSync(path.join(root, 'public/soft-kernels-simd.wasm'));
  const baselineKernel = new BaselineKernel('simd', new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports);
  const optimizedKernel = new OptimizedKernel('simd', new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports);
  const qualified = [];
  const legacyControls = [];

  for (let sceneId = 650; sceneId < 700; sceneId++) {
    const baseline = new BaselineSuite(baselineKernel);
    const optimized = new OptimizedSuite(optimizedKernel);
    const seed = (0x710000 + stress * 1000 + sceneId) >>> 0;
    assert.ok(baseline.createScene(baselineScenes[sceneId], stress, seed), `baseline scene ${sceneId} failed`);
    assert.ok(optimized.createScene(optimizedScenes[sceneId], stress, seed), `optimized scene ${sceneId} failed`);

    for (let frame = 0; frame < 720; frame++) {
      applyScheduledAction(baseline, frame);
      applyScheduledAction(optimized, frame);
      if (frame & 1) {
        optimized.step(1 / 60, 4);
        baseline.step(1 / 60, 4);
      } else {
        baseline.step(1 / 60, 4);
        optimized.step(1 / 60, 4);
      }
      if (frame % 12 === 0 || frame === 719) {
        const a = baseline.active.positions;
        const b = optimized.active.positions;
        assert.equal(a.length, b.length, `stress ${stress} scene ${sceneId} position length at frame ${frame}`);
        assert.equal(Buffer.compare(exactBytes(a), exactBytes(b)), 0, `stress ${stress} scene ${sceneId} position mismatch at frame ${frame}`);
        const af = baseline.buildFrame(false);
        const bf = optimized.buildFrame(false);
        assert.equal(af.brokenCount, bf.brokenCount, `stress ${stress} scene ${sceneId} break mismatch at frame ${frame}`);
        assert.equal(af.constraintCount, bf.constraintCount, `stress ${stress} scene ${sceneId} constraint mismatch at frame ${frame}`);
        assert.equal(baseline.hash(), optimized.hash(), `stress ${stress} scene ${sceneId} replay mismatch at frame ${frame}`);
      }
    }
    const batched = ropeBatchProjectionEligible(stress, baselineScenes[sceneId].variant, baselineScenes[sceneId].mode);
    (batched ? qualified : legacyControls).push(sceneId);
  }

  process.stdout.write(`${JSON.stringify({ stress, framesPerScene: 720, qualified, legacyControls })}\n`);
}

function spawnWorker(baselineBuild, optimizedBuild, stress) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, '--worker', baselineBuild, optimizedBuild, String(stress)], {
      cwd: root,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) reject(new Error(`stress ${stress} qualification failed (${code}):\n${stderr || stdout}`));
      else resolve(JSON.parse(stdout));
    });
  });
}

if (process.argv[2] === '--worker') {
  await workerMain(path.resolve(process.argv[3]), path.resolve(process.argv[4]), Number(process.argv[5]));
} else {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-rope-qualification-'));
  try {
    // Qualify batched rope projection against the legacy per-constraint cadence of
    // the same source. The archived v1.9.0 source is no longer a valid reference:
    // since dfedd9f (2026-08-14) rope drag is time-step scaled and gravity comes
    // from the scene binding, which intentionally changes every rope trajectory.
    const baselineSource = path.join(tempRoot, 'legacy-cadence-source');
    const baselineBuild = path.join(tempRoot, 'legacy-cadence-build');
    const optimizedBuild = path.join(tempRoot, 'optimized-build');
    for (const entry of ['src', 'tests', 'tsconfig.json', 'tsconfig.test.json']) {
      fs.cpSync(path.join(root, entry), path.join(baselineSource, entry), { recursive: true });
    }
    const simulationsPath = path.join(baselineSource, 'src/soft/simulations.ts');
    const simulations = fs.readFileSync(simulationsPath, 'utf8');
    const batchingSwitch = 'this.batchKernelProjection = ropeBatchProjectionEligible(stress, this.variant, this.mode);';
    if (simulations.split(batchingSwitch).length !== 2) throw new Error('Cannot locate the batched rope projection switch.');
    fs.writeFileSync(simulationsPath, simulations.replace(batchingSwitch, 'this.batchKernelProjection = false;'));
    const tsc = path.join(root, 'node_modules/.bin/tsc');
    for (const [source, build] of [[baselineSource, baselineBuild], [root, optimizedBuild]]) {
      execFileSync(tsc, ['-p', path.join(source, 'tsconfig.test.json'), '--outDir', build, '--rootDir', source], { cwd: root, stdio: 'pipe' });
      fs.writeFileSync(path.join(build, 'package.json'), '{"type":"commonjs"}\n');
    }
    const results = await Promise.all([1, 2, 3, 4, 5].map((stress) => spawnWorker(baselineBuild, optimizedBuild, stress)));
    const evidence = {
      result: 'passed',
      baselineSource: 'current source with batched rope projection disabled (legacy per-constraint cadence)',
      stresses: results,
      sceneStressCombinations: results.length * 50,
      qualifiedBatchedCombinations: results.reduce((sum, result) => sum + result.qualified.length, 0),
      legacyControlCombinations: results.reduce((sum, result) => sum + result.legacyControls.length, 0),
      framesPerCombination: 720,
      exactCheckCadence: 12,
      actionFrames: [60, 120, 180, 240, 420, 540],
    };
    const outputPath = path.join(root, 'benchmarks/results/rope-batching-qualification.json');
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
    console.log(`Wrote ${outputPath}`);
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
