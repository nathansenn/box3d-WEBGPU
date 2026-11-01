#!/usr/bin/env node
// Absolute CPU cost of the Engineering Studio solvers that the merge adds (there is no main-branch counterpart).
//   --suite studio : FailureSimulation (canopy, metal press, suspension bridge) with the backends src/studio/main.ts
//                    uses, at a service load (0.8) and a failure load (4). The bridge also runs with the river response
//                    timed in place, and once with it disabled to isolate its cost before any piece reaches the water.
//   --suite labs   : every material-lab experiment program (src/studio/material-labs), stepped at DT=1/120 to its
//                    authored duration or until --budget-s of wall time, whichever comes first.
// Every sample is a fresh Node process pinned to one CPU. Imports the TypeScript sources directly (Node type stripping).
// usage: node benchmarks/merge-20261101/studio-bench.mjs --suite studio|labs [--rounds 5] [--cpu 3] [--budget-s 60] [--out f]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';
import { describe, environment, gitInfo, median, round, sha256File } from './stats.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i < 0 ? fallback : args[i + 1]; };
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const self = fileURLToPath(import.meta.url);

// The lab sources use extensionless relative imports; resolve them to .ts like tests/studio/material-labs.test.mjs.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && !/\.[a-z]+$/i.test(specifier) && context.parentURL?.endsWith('.ts')) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (fs.existsSync(url)) return next(url.href, context);
    }
    return next(specifier, context);
  },
});

function stepStats(stepMs, dt) {
  const total = stepMs.reduce((a, v) => a + v, 0);
  const d = describe(stepMs);
  return {
    steps: stepMs.length,
    totalMs: total,
    perStepMs: d,
    simulatedSeconds: stepMs.length * dt,
    realTimeFactor: (stepMs.length * dt * 1000) / total,
    // The studio steps at 120 Hz, two solver steps per 60 Hz display frame.
    displayFrameBudgetShareAt60Hz: (2 * d.mean) / (1000 / 60),
    stepsOver8_33ms: stepMs.filter((v) => v > 1000 / 120).length,
  };
}

async function studioChild() {
  const physics = await import(path.join(root, 'src/studio/physics.ts'));
  const { FailureSimulation, FIXED_DT, STUDIO_CANOPY_CONTACT_BACKEND, STUDIO_SCALED_CHECKPOINT_BACKEND } = physics;
  const study = opt('--study');
  const load = Number(opt('--load'));
  const steps = Number(opt('--steps', 1920));
  const river = opt('--river', 'on');
  const backend = study === 'canopy' ? STUDIO_CANOPY_CONTACT_BACKEND : STUDIO_SCALED_CHECKPOINT_BACKEND;
  const t0 = performance.now();
  const sim = new FailureSimulation(study, {}, backend);
  const constructMs = performance.now() - t0;
  sim.targetLoad = load;
  let riverMs = 0;
  let riverCalls = 0;
  if (study === 'bridge') {
    const original = sim.riverResponse.bind(sim);
    sim.riverResponse = river === 'off' ? () => {} : (dt) => {
      const a = performance.now();
      original(dt);
      riverMs += performance.now() - a;
      riverCalls++;
    };
  }
  const stepMs = new Float64Array(steps);
  const snapshotMs = [];
  const target = sim.createSnapshotTarget();
  let firstBreakStep = -1;
  for (let i = 0; i < steps; i++) {
    const a = performance.now();
    sim.step(FIXED_DT);
    stepMs[i] = performance.now() - a;
    if (firstBreakStep < 0 && sim.brokenCount > 0) firstBreakStep = i;
    if (i % 2 === 1) {
      const b = performance.now();
      sim.snapshotInto(target);
      snapshotMs.push(performance.now() - b);
    }
  }
  const stats = stepStats(Array.from(stepMs), FIXED_DT);
  return {
    backend, constructMs, ...stats, snapshotIntoMs: describe(snapshotMs),
    nodes: sim.nodes.length, links: sim.links.length, faces: sim.faces.length,
    brokenCount: sim.brokenCount, yieldedCount: sim.yieldedCount, firstBreakTime: firstBreakStep < 0 ? null : (firstBreakStep + 1) * FIXED_DT,
    waterImpacts: sim.waterImpacts?.length ?? 0, riverMs, riverCalls, riverShareOfStepTime: riverMs / stats.totalMs,
    // A quarter of the per-step series, so the result shows how cost evolves through loading and failure.
    stepSeriesEvery8: Array.from(stepMs).filter((_, i) => i % 8 === 0).map((v) => round(v, 4)),
  };
}

async function labChild() {
  const { LABS, normalizeSettings } = await import(path.join(root, 'src/studio/material-labs/catalog.ts'));
  const { createModel, DT } = await import(path.join(root, 'src/studio/material-labs/models.ts'));
  const lab = opt('--lab');
  const experimentId = opt('--experiment');
  const budgetMs = Number(opt('--budget-s', 60)) * 1000;
  const experiment = LABS[lab].experiments.find((e) => e.id === experimentId);
  const settings = normalizeSettings(lab, { ...LABS[lab].defaults, ...experiment.settings });
  // Same program length as tests/studio/material-labs.test.mjs.
  const duration = Math.max(LABS[lab].duration, lab === 'concrete' ? settings.load / settings.rate + 4 : lab === 'rubber' ? settings.load / settings.rate + settings.damping + 8 : 0);
  const t0 = performance.now();
  const model = createModel(lab, settings);
  const constructMs = performance.now() - t0;
  const planned = Math.ceil(duration / DT);
  const stepMs = [];
  const started = performance.now();
  for (let i = 0; i < planned; i++) {
    const a = performance.now();
    model.step(DT);
    stepMs.push(performance.now() - a);
    if (performance.now() - started > budgetMs) break;
  }
  const stats = stepStats(stepMs, DT);
  return {
    constructMs, plannedSteps: planned, plannedSeconds: duration, completed: stepMs.length === planned, ...stats,
    phase: model.frame.phase, metrics: [...model.frame.metrics], collisions: model.frame.collisions ?? null,
    stepSeriesEvery8: stepMs.filter((_, i) => i % 8 === 0).map((v) => round(v, 4)),
  };
}

if (args.includes('--child')) {
  const result = opt('--suite') === 'labs' ? await labChild() : await studioChild();
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(0);
}

const suite = opt('--suite', 'studio');
const rounds = Number(opt('--rounds', 5));
const cpu = opt('--cpu', '3');
const budget = opt('--budget-s', '60');
const out = path.resolve(opt('--out', path.join(root, `benchmarks/merge-20261101/results/${suite}-bench.json`)));

function runChild(extra) {
  const r = spawnSync('taskset', ['-c', cpu, process.execPath, self, '--child', '--suite', suite, '--budget-s', budget, '--steps', opt('--steps', '1920'), ...extra],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 3600000 });
  if (r.status !== 0) throw new Error(`child failed (${extra.join(' ')}): ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

const started = Date.now();
const cases = [];
if (suite === 'studio') {
  const matrix = [];
  for (const study of ['canopy', 'plate', 'bridge'])
    for (const load of [0.8, 4]) {
      matrix.push({ study, load, river: 'on' });
      if (study === 'bridge') matrix.push({ study, load, river: 'off' });
    }
  for (const c of matrix) {
    const samples = [];
    for (let r = 0; r < rounds; r++) samples.push(runChild(['--study', c.study, '--load', String(c.load), '--river', c.river]));
    const meanStep = samples.map((s) => s.perStepMs.mean);
    const entry = {
      ...c, backend: samples[0].backend, rounds,
      meanStepMsAcrossRounds: describe(meanStep),
      pooledStepMs: describe(samples.flatMap((s) => s.stepSeriesEvery8)),
      realTimeFactor: describe(samples.map((s) => s.realTimeFactor)),
      displayFrameBudgetShareAt60Hz: describe(samples.map((s) => s.displayFrameBudgetShareAt60Hz)),
      snapshotIntoMs: describe(samples.map((s) => s.snapshotIntoMs.median)),
      constructMs: describe(samples.map((s) => s.constructMs)),
      riverShareOfStepTime: c.study === 'bridge' && c.river === 'on' ? describe(samples.map((s) => s.riverShareOfStepTime)) : null,
      riverMsPerCall: c.study === 'bridge' && c.river === 'on' ? describe(samples.map((s) => s.riverMs / Math.max(1, s.riverCalls))) : null,
      deterministicAcrossRounds: samples.every((s) => s.brokenCount === samples[0].brokenCount && s.waterImpacts === samples[0].waterImpacts),
      outcome: { nodes: samples[0].nodes, links: samples[0].links, faces: samples[0].faces, brokenCount: samples[0].brokenCount, yieldedCount: samples[0].yieldedCount, firstBreakTime: samples[0].firstBreakTime, waterImpacts: samples[0].waterImpacts },
      samples,
    };
    cases.push(entry);
    console.log(`[studio] ${c.study.padEnd(6)} load ${c.load} river ${c.river.padEnd(3)} mean step ${median(meanStep).toFixed(4)} ms (sd ${entry.meanStepMsAcrossRounds.sd.toFixed(4)}), real-time x${entry.realTimeFactor.median.toFixed(1)}, broken ${entry.outcome.brokenCount}, impacts ${entry.outcome.waterImpacts}`);
  }
} else {
  const { LAB_IDS, LABS } = await import(path.join(root, 'src/studio/material-labs/catalog.ts'));
  for (const lab of LAB_IDS)
    for (const experiment of LABS[lab].experiments) {
      const sample = runChild(['--lab', lab, '--experiment', experiment.id]);
      cases.push({ lab, experiment: experiment.id, name: experiment.name, ...sample });
      console.log(`[labs] ${lab.padEnd(9)} ${experiment.id.padEnd(28)} ${sample.completed ? 'complete' : 'BUDGET  '} sim ${sample.simulatedSeconds.toFixed(2)}/${sample.plannedSeconds.toFixed(2)} s, step median ${sample.perStepMs.median.toFixed(3)} ms p95 ${sample.perStepMs.p95.toFixed(3)} max ${sample.perStepMs.max.toFixed(1)}, real-time x${sample.realTimeFactor.toFixed(2)}`);
    }
}

const sources = suite === 'studio' ? ['src/studio/physics.ts'] : ['src/studio/material-labs/models.ts', 'src/studio/material-labs/catalog.ts', 'src/engine/convex-contact.ts'];
const result = {
  title: suite === 'studio' ? 'Engineering Studio solver cost (merged branch)' : 'Material lab program cost (merged branch)',
  method: {
    sample: 'fresh Node process per sample, pinned with taskset',
    timing: 'performance.now() around every solver step; 120 Hz fixed step',
    rounds: suite === 'studio' ? rounds : 1, cpu, budgetSeconds: suite === 'labs' ? Number(budget) : undefined,
  },
  environment: environment(),
  sources: Object.fromEntries(sources.map((s) => [s, sha256File(path.join(root, s))])),
  harness: { git: gitInfo(root), sha256: sha256File(self) },
  durationSeconds: Math.round((Date.now() - started) / 1000),
  cases,
};
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n');
console.log(`wrote ${out}`);
