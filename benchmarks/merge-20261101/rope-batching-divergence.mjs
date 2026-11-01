#!/usr/bin/env node
// Why rope variants 2, 3 and 5 left batched projection: replays the rope-batching gate's workload (the seeds and the
// scheduled kicks, blasts, projectile and rain of scripts/rope-batching-qualification.mjs) at stress 5 for every rope
// scene, comparing two builds of the current source:
//   main-policy  - batched kernel projection wherever main's rule allowed it
//   legacy       - batched projection disabled (the per-constraint cadence the gate treats as the reference)
// It records, per scene, the first checked frame (every 12 frames, like the gate) where positions differ and the largest
// absolute position difference over 720 frames, instead of stopping at the first mismatch as the gate does.
// usage: node benchmarks/merge-20261101/rope-batching-divergence.mjs [--out file.json]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { environment, gitInfo, sha256File } from './stats.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const out = path.resolve(args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(root, 'benchmarks/merge-20261101/results/rope-batching-divergence.json'));
const MAIN_RULE = 'return stress === 5 && variant !== 4 && variant !== 8 && !(variant === 0 && (mode === 0 || mode === 3));';
const LEGACY_RULE = 'return false;';

function buildWithRule(dir, rule) {
  for (const item of ['src', 'tests', 'tsconfig.json', 'tsconfig.test.json']) fs.cpSync(path.join(root, item), path.join(dir, item), { recursive: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  const file = path.join(dir, 'src/soft/simulations.ts');
  const source = fs.readFileSync(file, 'utf8');
  const pattern = /(export function ropeBatchProjectionEligible\([^)]*\): boolean \{\n)([\s\S]*?)(\n\})/;
  if (!pattern.test(source)) throw new Error('ropeBatchProjectionEligible not found');
  if (rule) fs.writeFileSync(file, source.replace(pattern, (_, head, _body, tail) => `${head}  ${rule}${tail}`));
  execFileSync(path.join(root, 'node_modules/.bin/tsc'), ['-p', 'tsconfig.test.json'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, '.test-build/package.json'), '{"type":"commonjs"}');
  return path.join(dir, '.test-build');
}

function applyScheduledAction(suite, frame) {
  if (frame === 60) suite.kick(18);
  else if (frame === 120) suite.explode([0, 8, 0], 24, 12);
  else if (frame === 180) suite.launchProjectile([-18, 10, 0], [38, 0, 0], 1);
  else if (frame === 240) suite.spawnRain(96, 14, 24);
  else if (frame === 420) suite.explode([3, 6, -2], 16, 9);
  else if (frame === 540) suite.kick(12);
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'rope-divergence-'));
try {
  const builds = { mainPolicy: buildWithRule(path.join(temp, 'main-policy'), MAIN_RULE), legacy: buildWithRule(path.join(temp, 'legacy'), LEGACY_RULE), merged: buildWithRule(path.join(temp, 'merged'), null) };
  const load = (build) => {
    const require = createRequire(path.join(build, 'package.json'));
    return { scenes: require(path.join(build, 'src/scenes.js')).SCENES, Suite: require(path.join(build, 'src/soft/simulations.js')).SoftSimulationSuite, Kernel: require(path.join(build, 'src/soft/kernels.js')).SoftKernelModule };
  };
  const a = load(builds.mainPolicy);
  const b = load(builds.legacy);
  const current = createRequire(path.join(builds.merged, 'package.json'))(path.join(builds.merged, 'src/soft/simulations.js')).ropeBatchProjectionEligible;
  const wasm = fs.readFileSync(path.join(root, 'public/soft-kernels-simd.wasm'));
  const kernel = (K) => new K('simd', new WebAssembly.Instance(new WebAssembly.Module(wasm), {}).exports);
  const stress = 5;
  const cases = [];
  for (let id = 650; id < 700; id++) {
    const scene = a.scenes[id];
    const sa = new a.Suite(kernel(a.Kernel));
    const sb = new b.Suite(kernel(b.Kernel));
    const seed = (0x710000 + stress * 1000 + id) >>> 0;
    sa.createScene(a.scenes[id], stress, seed);
    sb.createScene(b.scenes[id], stress, seed);
    let firstDivergentFrame = null;
    let maxAbsDiff = 0;
    for (let frame = 0; frame < 720; frame++) {
      applyScheduledAction(sa, frame);
      applyScheduledAction(sb, frame);
      sa.step(1 / 60, 4);
      sb.step(1 / 60, 4);
      if (frame % 12 === 0 || frame === 719) {
        const pa = sa.active.positions;
        const pb = sb.active.positions;
        let worst = 0;
        for (let i = 0; i < Math.min(pa.length, pb.length); i++) worst = Math.max(worst, Math.abs(pa[i] - pb[i]));
        if (worst > 0 && firstDivergentFrame === null) firstDivergentFrame = frame;
        maxAbsDiff = Math.max(maxAbsDiff, worst);
      }
    }
    const mainBatched = new Function('stress', 'variant', 'mode', MAIN_RULE)(stress, scene.variant, scene.mode);
    cases.push({ id, title: scene.title, variant: scene.variant, mode: scene.mode, batchedOnMain: mainBatched, batchedOnMerged: current(stress, scene.variant, scene.mode), firstDivergentFrame, maxAbsDiff });
  }
  const batched = cases.filter((c) => c.batchedOnMain);
  const divergent = batched.filter((c) => c.firstDivergentFrame !== null);
  const result = {
    title: 'Rope batched projection under main\'s eligibility rule vs the legacy per-constraint cadence (rope-batching gate workload)',
    stress, framesPerScene: 720, checkEvery: 12,
    mainRule: MAIN_RULE,
    environment: environment(), harness: { git: gitInfo(root), sha256: sha256File(fileURLToPath(import.meta.url)) },
    summary: {
      batchedOnMain: batched.length,
      divergentWhenBatched: divergent.length,
      divergentScenes: divergent.map((c) => `${c.id} v${c.variant} m${c.mode} from frame ${c.firstDivergentFrame}, max ${c.maxAbsDiff.toFixed(3)}`),
      nonBatchedScenesIdentical: cases.filter((c) => !c.batchedOnMain).every((c) => c.firstDivergentFrame === null),
      mergedRuleExcludesEveryDivergentScene: divergent.every((c) => !c.batchedOnMerged),
      batchedOnMergedAndIdentical: cases.filter((c) => c.batchedOnMerged).every((c) => c.firstDivergentFrame === null),
    },
    cases,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
  console.log(JSON.stringify(result.summary, null, 2));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
