#!/usr/bin/env node
// A/B benchmark of the CPU soft-body suite (cloth, rope, water, fracture) between two compiled source trees.
// Every sample is a fresh Node process pinned to one CPU; rounds alternate which build runs first (ABBA).
// A frame is step(1/60, 4) followed by buildFrame(false), because the candidate moved kinetic-energy work
// from step() into the first telemetry read; timing step() alone would hide that cost.
// usage: node benchmarks/merge-20261101/soft-ab.mjs --baseline <test-build dir> --candidate <test-build dir>
//        [--scenes all|sample] [--rounds 5] [--warmup 30] [--frames 120] [--stress 5] [--kernel javascript|simd|scalar]
//        [--cpu 3] [--out file.json]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { describe, environment, gitInfo, mannWhitney, median, ratioOfMedians, round, sha256File, verdict } from './stats.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function loadBuild(dir) {
  const require = createRequire(path.join(dir, 'package.json'));
  return {
    SCENES: require(path.join(dir, 'src/scenes.js')).SCENES,
    SoftSimulationSuite: require(path.join(dir, 'src/soft/simulations.js')).SoftSimulationSuite,
    SoftKernelModule: require(path.join(dir, 'src/soft/kernels.js')).SoftKernelModule,
  };
}

function kernelFor(build, kind) {
  if (kind === 'javascript') return null;
  const bytes = fs.readFileSync(path.join(root, 'public', `soft-kernels-${kind}.wasm`));
  return new build.SoftKernelModule(kind, new WebAssembly.Instance(new WebAssembly.Module(bytes), {}).exports);
}

// The same perturbation script as scripts/soft-simulation-soak.cjs, scaled to the frame count.
function perturb(suite, scene, frame, total) {
  const at = (f) => frame === Math.floor(total * f);
  if (scene.family === 'fracture') {
    if (at(0.10)) suite.setLoadTarget(0.42);
    if (at(0.35)) suite.setLoadTarget(0.96);
    if (at(0.55)) suite.setLoadTarget(1.38);
    if (at(0.72)) suite.setLoadTarget(2);
    if (at(0.88)) suite.releaseLoad();
  } else {
    if (at(0.20)) suite.kick(18);
    if (at(0.40)) suite.launchProjectile([-18, 9, 0], [36, 1.5, 0], 0.9);
    if (at(0.60)) suite.explode([0, 5, 0], 36, 18);
    if (at(0.80)) suite.spawnRain(scene.family === 'water' ? 160 : 64, 14, 22);
  }
}

// FNV-1a over the bits of the active instance matrices and colours: equal only when the presented state is identical.
function exactHash(frame) {
  let h = 0x811c9dc5;
  for (const view of [frame.matrices.subarray(0, frame.instanceCount * 16), frame.colors.subarray(0, frame.instanceCount * 4)]) {
    const words = new Uint32Array(view.buffer, view.byteOffset, view.length);
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], 0x01000193) >>> 0;
  }
  return h >>> 0;
}

if (args.includes('--child')) {
  const build = loadBuild(path.resolve(opt('--build')));
  const sceneId = Number(opt('--scene'));
  const stress = Number(opt('--stress', 5));
  const warmup = Number(opt('--warmup', 30));
  const frames = Number(opt('--frames', 120));
  const scene = build.SCENES.find((s) => s.id === sceneId);
  const total = warmup + frames;
  const suite = new build.SoftSimulationSuite(kernelFor(build, opt('--kernel', 'javascript')));
  const t0 = performance.now();
  if (!suite.createScene(scene, stress, 0xa110000 + scene.id)) throw new Error(`scene ${sceneId} did not activate`);
  const createMs = performance.now() - t0;
  const stepMs = new Float64Array(frames);
  const buildMs = new Float64Array(frames);
  const hashes = [];
  for (let f = 0; f < total; f++) {
    perturb(suite, scene, f, total);
    const a = performance.now();
    suite.step(1 / 60, 4);
    const b = performance.now();
    const frame = suite.buildFrame(false);
    const c = performance.now();
    if (f >= warmup) { stepMs[f - warmup] = b - a; buildMs[f - warmup] = c - b; }
    if ((f + 1) % 30 === 0) hashes.push(exactHash(frame));
    if (f === total - 1) {
      process.stdout.write(JSON.stringify({
        createMs, stepMs: Array.from(stepMs), buildMs: Array.from(buildMs), hashes,
        nodeCount: frame.nodeCount, constraintCount: frame.constraintCount, brokenCount: frame.brokenCount,
        label: suite.label(), kind: suite.kind(),
      }) + '\n');
    }
  }
  process.exit(0);
}

const baselineDir = path.resolve(opt('--baseline'));
const candidateDir = path.resolve(opt('--candidate'));
const rounds = Number(opt('--rounds', 5));
const warmup = Number(opt('--warmup', 30));
const frames = Number(opt('--frames', 120));
const stress = Number(opt('--stress', 5));
const kernel = opt('--kernel', 'javascript');
const cpu = opt('--cpu', '3');
const sceneMode = opt('--scenes', 'sample');
const out = path.resolve(opt('--out', path.join(root, 'benchmarks/merge-20261101/results/soft-ab.json')));

const baselineScenes = loadBuild(baselineDir).SCENES;
const candidateScenes = loadBuild(candidateDir).SCENES;
const soft = candidateScenes.filter((s) => ['cloth', 'rope', 'water', 'fracture'].includes(s.family));
for (const s of soft) {
  const b = baselineScenes.find((x) => x.id === s.id);
  if (!b || b.title !== s.title || b.family !== s.family) throw new Error(`scene ${s.id} differs between builds`);
}
// Sample: every rope scene (rope batching changed), and every fifth scene of the other families.
const sampled = sceneMode === 'all' ? soft : soft.filter((s, i) => s.family === 'rope' || soft.filter((x) => x.family === s.family).indexOf(s) % 5 === 0);
const selected = sampled.slice(0, Number(opt('--limit', sampled.length)));

function runChild(dir, scene) {
  const r = spawnSync('taskset', ['-c', cpu, process.execPath, fileURLToPath(import.meta.url), '--child', '--build', dir,
    '--scene', String(scene.id), '--stress', String(stress), '--warmup', String(warmup), '--frames', String(frames), '--kernel', kernel],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 600000 });
  if (r.status !== 0) throw new Error(`child failed for scene ${scene.id}: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const cases = [];
const started = Date.now();
for (const scene of selected) {
  const raw = { baseline: [], candidate: [] };
  for (let r = 0; r < rounds; r++) {
    const order = r % 2 === 0 ? ['baseline', 'candidate'] : ['candidate', 'baseline'];
    for (const which of order) raw[which].push(runChild(which === 'baseline' ? baselineDir : candidateDir, scene));
  }
  const summarize = (samples) => {
    const frameMean = samples.map((s) => s.stepMs.reduce((a, v, i) => a + v + s.buildMs[i], 0) / s.stepMs.length);
    const frameMedian = samples.map((s) => median(s.stepMs.map((v, i) => v + s.buildMs[i])));
    const pooled = samples.flatMap((s) => s.stepMs.map((v, i) => v + s.buildMs[i]));
    return {
      perRoundMeanFrameMs: frameMean.map((v) => round(v)),
      perRoundMedianFrameMs: frameMedian.map((v) => round(v)),
      meanFrameMs: describe(frameMean),
      pooledFrameMs: describe(pooled),
      stepMs: describe(samples.flatMap((s) => s.stepMs)),
      buildFrameMs: describe(samples.flatMap((s) => s.buildMs)),
      createMs: describe(samples.map((s) => s.createMs)),
      hashes: samples[0].hashes,
      deterministicAcrossRounds: samples.every((s) => JSON.stringify(s.hashes) === JSON.stringify(samples[0].hashes)),
      nodeCount: samples[0].nodeCount, constraintCount: samples[0].constraintCount, brokenCount: samples[0].brokenCount,
    };
  };
  const b = summarize(raw.baseline);
  const c = summarize(raw.candidate);
  const ratio = ratioOfMedians(raw.baseline.map((s, i) => b.perRoundMeanFrameMs[i]), raw.candidate.map((s, i) => c.perRoundMeanFrameMs[i]));
  const firstDifferentHash = b.hashes.findIndex((h, i) => h !== c.hashes[i]);
  const entry = {
    id: scene.id, title: scene.title, family: scene.family, label: raw.candidate[0].label,
    baseline: b, candidate: c,
    speedRatioMeanFrame: ratio, verdict: verdict(ratio),
    mannWhitneyMeanFrame: mannWhitney(b.perRoundMeanFrameMs, c.perRoundMeanFrameMs),
    trajectory: firstDifferentHash < 0 ? 'bit-identical hashes at every checkpoint' : `hashes differ from frame ${(firstDifferentHash + 1) * 30}`,
  };
  cases.push(entry);
  console.log(`[soft-ab] ${scene.id} ${scene.family.padEnd(8)} ${scene.title.slice(0, 40).padEnd(40)} base ${median(b.perRoundMeanFrameMs).toFixed(3)} ms cand ${median(c.perRoundMeanFrameMs).toFixed(3)} ms ratio ${ratio.point.toFixed(3)} [${ratio.low95.toFixed(3)}, ${ratio.high95.toFixed(3)}] ${entry.verdict}; ${entry.trajectory}`);
}

const families = {};
for (const family of ['cloth', 'rope', 'water', 'fracture']) {
  const list = cases.filter((c) => c.family === family);
  if (!list.length) continue;
  const ratios = list.map((c) => c.speedRatioMeanFrame.point);
  families[family] = {
    scenes: list.length,
    geometricMeanSpeedRatio: Math.exp(ratios.reduce((a, v) => a + Math.log(v), 0) / ratios.length),
    medianSpeedRatio: median(ratios),
    faster: list.filter((c) => c.verdict === 'candidate faster').length,
    slower: list.filter((c) => c.verdict === 'candidate slower').length,
    noSignificantDifference: list.filter((c) => c.verdict === 'no significant difference').length,
    bitIdenticalTrajectories: list.filter((c) => c.trajectory.startsWith('bit-identical')).length,
  };
}
const allRatios = cases.map((c) => c.speedRatioMeanFrame.point);
const result = {
  title: 'Soft-body suite A/B: main vs merged',
  method: {
    sample: 'fresh Node process per sample, pinned with taskset; ABBA order across rounds',
    frame: 'step(1/60, 4) + buildFrame(false), timed separately with performance.now()',
    workload: 'scripts/soft-simulation-soak.cjs perturbation script scaled to warmup+frames; seed 0xa110000 + scene id',
    statistic: 'ratio of medians of per-round mean frame time (baseline/candidate; >1 means candidate faster), paired percentile bootstrap 95% interval',
    rounds, warmup, frames, stress, kernel, cpu, sceneMode,
  },
  environment: environment(),
  baseline: { dir: baselineDir, simulationsSha256: sha256File(path.join(baselineDir, 'src/soft/simulations.js')) },
  candidate: { dir: candidateDir, simulationsSha256: sha256File(path.join(candidateDir, 'src/soft/simulations.js')) },
  harness: { git: gitInfo(root), sha256: sha256File(fileURLToPath(import.meta.url)) },
  durationSeconds: Math.round((Date.now() - started) / 1000),
  summary: {
    scenes: cases.length,
    geometricMeanSpeedRatio: Math.exp(allRatios.reduce((a, v) => a + Math.log(v), 0) / allRatios.length),
    families,
  },
  cases,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify(result.summary, null, 2));
