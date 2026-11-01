#!/usr/bin/env node
// A/B benchmark of the native Box3D WebAssembly build (single-threaded box3d.js/box3d.wasm) between two artifact
// directories, through the legacy single-world API both builds export (b3w_create_scene / b3w_step).
// Every sample is a fresh Node process pinned to one CPU; rounds alternate which build runs first (ABBA).
// usage: node benchmarks/merge-20261101/native-ab.mjs --baseline <dir> --candidate <dir>
//        [--per-family 4] [--rounds 5] [--warmup 30] [--frames 120] [--stress 5] [--cpu 3] [--out file.json]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, environment, gitInfo, mannWhitney, median, ratioOfMedians, round, sha256File, verdict } from './stats.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

if (args.includes('--child')) {
  const dir = path.resolve(opt('--dir'));
  const sceneId = Number(opt('--scene'));
  const stress = Number(opt('--stress', 5));
  const warmup = Number(opt('--warmup', 30));
  const frames = Number(opt('--frames', 120));
  const t0 = performance.now();
  const mod = await (await import(pathToFileURL(path.join(dir, 'box3d.js')).href)).default({ wasmBinary: fs.readFileSync(path.join(dir, 'box3d.wasm')) });
  const loadMs = performance.now() - t0;
  const t1 = performance.now();
  const created = mod._b3w_create_scene(sceneId, stress, (0xb0d1e5 + sceneId) >>> 0);
  const createMs = performance.now() - t1;
  const stepMs = new Float64Array(frames);
  const hashes = [];
  const awake = [];
  for (let f = 0; f < warmup + frames; f++) {
    const a = performance.now();
    mod._b3w_step(1 / 60, 4);
    const b = performance.now();
    if (f >= warmup) stepMs[f - warmup] = b - a;
    if ((f + 1) % 30 === 0) { hashes.push(mod._b3w_replay_hash() >>> 0); awake.push(mod._b3w_awake_count()); }
  }
  process.stdout.write(JSON.stringify({ loadMs, createMs, created, bodies: mod._b3w_body_count(), stepMs: Array.from(stepMs), hashes, awake }) + '\n');
  process.exit(0);
}

const baselineDir = path.resolve(opt('--baseline'));
const candidateDir = path.resolve(opt('--candidate'));
const perFamily = Number(opt('--per-family', 4));
const rounds = Number(opt('--rounds', 5));
const warmup = Number(opt('--warmup', 30));
const frames = Number(opt('--frames', 120));
const stress = Number(opt('--stress', 5));
const cpu = opt('--cpu', '3');
const out = path.resolve(opt('--out', path.join(root, 'benchmarks/merge-20261101/results/native-ab.json')));
const require = createRequire(import.meta.url);
const { SCENES } = require(path.resolve(opt('--scenes-build', path.join(root, '.test-build')), 'src/scenes.js'));
const rigid = SCENES.filter((s) => !['cloth', 'rope', 'water', 'fracture'].includes(s.family));
const families = [...new Set(rigid.map((s) => s.family))];
const sampled = families.flatMap((family) => {
  const list = rigid.filter((s) => s.family === family);
  return Array.from({ length: perFamily }, (_, k) => list[Math.floor((k * list.length) / perFamily)]);
});
const selected = sampled.slice(0, Number(opt('--limit', sampled.length)));


function runChild(dir, scene) {
  const r = spawnSync('taskset', ['-c', cpu, process.execPath, fileURLToPath(import.meta.url), '--child', '--dir', dir,
    '--scene', String(scene.id), '--stress', String(stress), '--warmup', String(warmup), '--frames', String(frames)],
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
    const mean = samples.map((s) => s.stepMs.reduce((a, v) => a + v, 0) / s.stepMs.length);
    return {
      perRoundMeanStepMs: mean.map((v) => round(v)),
      meanStepMs: describe(mean),
      pooledStepMs: describe(samples.flatMap((s) => s.stepMs)),
      createMs: describe(samples.map((s) => s.createMs)),
      loadMs: describe(samples.map((s) => s.loadMs)),
      bodies: samples[0].bodies,
      awakeAtCheckpoints: samples[0].awake,
      hashes: samples[0].hashes,
      deterministicAcrossRounds: samples.every((s) => JSON.stringify(s.hashes) === JSON.stringify(samples[0].hashes)),
    };
  };
  const b = summarize(raw.baseline);
  const c = summarize(raw.candidate);
  const ratio = ratioOfMedians(b.perRoundMeanStepMs, c.perRoundMeanStepMs);
  const firstDifferent = b.hashes.findIndex((h, i) => h !== c.hashes[i]);
  const entry = {
    id: scene.id, title: scene.title, family: scene.family, baseline: b, candidate: c,
    speedRatioMeanStep: ratio, verdict: verdict(ratio),
    mannWhitneyMeanStep: mannWhitney(b.perRoundMeanStepMs, c.perRoundMeanStepMs),
    sameBodyCount: b.bodies === c.bodies,
    trajectory: firstDifferent < 0 ? 'bit-identical replay hashes at every checkpoint' : `replay hashes differ from frame ${(firstDifferent + 1) * 30}`,
  };
  cases.push(entry);
  console.log(`[native-ab] ${String(scene.id).padStart(3)} ${scene.family.padEnd(12)} bodies ${b.bodies}/${c.bodies} base ${median(b.perRoundMeanStepMs).toFixed(3)} ms cand ${median(c.perRoundMeanStepMs).toFixed(3)} ms ratio ${ratio.point.toFixed(3)} [${ratio.low95.toFixed(3)}, ${ratio.high95.toFixed(3)}] ${entry.verdict}; ${entry.trajectory}`);
}

const byFamily = {};
for (const family of families) {
  const list = cases.filter((c) => c.family === family);
  const ratios = list.map((c) => c.speedRatioMeanStep.point);
  byFamily[family] = {
    scenes: list.length,
    geometricMeanSpeedRatio: Math.exp(ratios.reduce((a, v) => a + Math.log(v), 0) / ratios.length),
    faster: list.filter((c) => c.verdict === 'candidate faster').length,
    slower: list.filter((c) => c.verdict === 'candidate slower').length,
    bitIdentical: list.filter((c) => c.trajectory.startsWith('bit-identical')).length,
  };
}
const allRatios = cases.map((c) => c.speedRatioMeanStep.point);
const result = {
  title: 'Native Box3D WASM A/B: main vs merged (single-threaded artifact)',
  method: {
    sample: 'fresh Node process per sample, pinned with taskset; ABBA order across rounds',
    workload: `b3w_create_scene(id, ${stress}, 0xb0d1e5 + id), ${warmup} warmup + ${frames} timed b3w_step(1/60, 4)`,
    statistic: 'ratio of medians of per-round mean step time (baseline/candidate; >1 means candidate faster), paired percentile bootstrap 95% interval',
    rounds, warmup, frames, stress, perFamily, cpu,
  },
  environment: environment(),
  baseline: { dir: baselineDir, js: sha256File(path.join(baselineDir, 'box3d.js')), wasm: sha256File(path.join(baselineDir, 'box3d.wasm')), wasmBytes: fs.statSync(path.join(baselineDir, 'box3d.wasm')).size },
  candidate: { dir: candidateDir, js: sha256File(path.join(candidateDir, 'box3d.js')), wasm: sha256File(path.join(candidateDir, 'box3d.wasm')), wasmBytes: fs.statSync(path.join(candidateDir, 'box3d.wasm')).size },
  harness: { git: gitInfo(root), sha256: sha256File(fileURLToPath(import.meta.url)) },
  durationSeconds: Math.round((Date.now() - started) / 1000),
  summary: { scenes: cases.length, geometricMeanSpeedRatio: Math.exp(allRatios.reduce((a, v) => a + Math.log(v), 0) / allRatios.length), byFamily },
  cases,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
console.log(JSON.stringify(result.summary, null, 2));
