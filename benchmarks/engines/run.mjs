// The engine comparison: this engine against the current npm releases of the other web physics engines.
//
//   npm run bench:engines                         every engine, every scene, 5 repeats, then the report
//   node benchmarks/engines/run.mjs --engines=box3d,rapier --scenes=boxes-1k,chain-100 --repeats=3
//   node benchmarks/engines/run.mjs --configs=default,8     solver settings: each engine's default, and 8 solver passes
//   node benchmarks/engines/run.mjs --budget-repeats=3      repeats of the equal-budget rows (default 2; --budget-scenes picks the scenes)
//   node benchmarks/engines/run.mjs --no-report             only write the raw results
//   --out <file>   raw results (default benchmarks/results/logs/engines/latest.json, which git ignores)
//
// Every measurement of a heavy scene is one fresh Node process (child.mjs), one thread; the light scenes of one
// engine share a process per repeat. Six processes run at a time (--concurrency). --resume continues an interrupted run. Runs are interleaved: for each
// repeat and each scene, every engine runs once before the next scene starts, so a change in machine load hits all engines alike, and
// the ratio to this engine is taken inside each round. A step is timed twice: by the wall clock, and by the CPU time
// the process used (what the step cost, whatever else the machine was doing). Timings are never asserted. A run that fails, is unsupported or
// exceeds its time budget is recorded as such and not repeated. Raw results go to a git-ignored file; report.mjs turns
// them into docs/BENCHMARKS_ENGINES.md and public/benchmarks/benchmarks.json.
import {spawn, spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import {fileURLToPath} from 'node:url';
import {SCENES} from './scenes.mjs';

const here = path.dirname(fileURLToPath(import.meta.url)), root = path.resolve(here, '../..');
// V8 normally starts WebAssembly in its baseline compiler (Liftoff) and moves hot functions to the optimizing compiler
// on background threads. On a busy machine those threads are starved and a run spends an unpredictable time in
// baseline code (measured here under load: the same 1,000-box run took 15.4 ms per step with tiering and 7.9 ms
// without). --no-liftoff compiles each WASM function with the optimizing compiler when it is first called, so the
// warm-up scene pays for compilation and every measured step runs optimized code. --expose-gc lets a child collect
// garbage before it builds the measured world.
export const NODE_FLAGS = ['--expose-gc', '--no-liftoff'];
// Repeats per scene. On the machine this was written on, a busy shared VM, one pass over every engine costs about
// two minutes of CPU for the 5,000-body scenes and more for the largest one, so the largest scenes get fewer repeats;
// the report prints the number of repeats beside every row. --repeats caps these numbers.
const HEAVY_REPEATS = {'boxes-10k': 1, 'boxes-5k': 2, 'spheres-5k': 2, 'raycast-10k': 2, 'boxes-1k': 3, 'capsules-2k': 3, 'hulls-1k': 3, 'trimesh-2k': 3, 'heightfield-2k': 3, 'ragdolls-100': 3, 'raycast-200': 3};
// CPU-time budget of one run's stepping, per scene (default --step-budget-ms). The 10,000-box pile needs about 25 s
// in the faster engines when the machine is busy, so it gets 60 s.
const SCENE_BUDGET_MS = {'boxes-10k': 60000};
const budgetOf = (sceneId, options) => Math.max(options.stepBudgetMs, SCENE_BUDGET_MS[sceneId] ?? 0);
export const repeatsOf = (sceneId, config, options) => config === 'default' ? Math.min(options.repeats, HEAVY_REPEATS[sceneId] ?? options.repeats) : Math.min(options.budgetRepeats, sceneId in HEAVY_REPEATS ? 1 : options.budgetRepeats);
// The equal-budget rows cover the scenes where the number of solver passes decides the answer or the cost.
export const BUDGET_SCENES = ['pyramid-20', 'pyramid-20-sleep', 'boxes-1k', 'hulls-1k', 'ragdolls-100', 'chain-100', 'chain-1000', 'stack-10', 'stack-100', 'stack-1000', 'pair-1000', 'pendulum'];
export const ENGINES = ['box3d', 'rapier-simd', 'rapier', 'jolt', 'physx-tgs', 'physx', 'havok', 'ammo', 'cannon'];

function parse(argv) {
  const options = {engines: ENGINES, scenes: SCENES.map(scene => scene.id), budgetScenes: BUDGET_SCENES, repeats: 5, budgetRepeats: 2, configs: ['default', '8'], report: true, out: path.join(root, 'benchmarks/results/logs/engines/latest.json'), stepBudgetMs: 20000, concurrency: 6, resume: false, twice: true};
  for (let i = 0; i < argv.length; i++) {
    const [key, inline] = argv[i].split('='), value = () => inline ?? argv[++i];
    if (key === '--engines') options.engines = value().split(',');
    else if (key === '--scenes') options.scenes = value().split(',');
    else if (key === '--repeats') options.repeats = Number(value());
    else if (key === '--budget-repeats') options.budgetRepeats = Number(value());
    else if (key === '--budget-scenes') options.budgetScenes = value().split(',');
    else if (key === '--configs') options.configs = value().split(',');
    else if (key === '--out') options.out = path.resolve(value());
    else if (key === '--step-budget-ms') options.stepBudgetMs = Number(value());
    else if (key === '--concurrency') options.concurrency = Number(value());
    else if (key === '--no-report') options.report = false;
    else if (key === '--resume') options.resume = true;
    else if (key === '--no-twice') options.twice = false;
    else throw new RangeError(`Unknown argument ${argv[i]}`);
  }
  for (const id of options.engines) if (!ENGINES.includes(id)) throw new RangeError(`Unknown engine ${id}`);
  for (const id of options.scenes) if (!SCENES.some(scene => scene.id === id)) throw new RangeError(`Unknown scene ${id}`);
  return options;
}

/** Run one child and return its JSON line, or a failure record. */
export function runChild(args, timeoutMs, everyLine = false) {
  return new Promise(resolve => {
    const env = {...process.env};
    delete env.NODE_OPTIONS;
    const child = spawn(process.execPath, [...NODE_FLAGS, path.join(here, 'child.mjs'), ...args], {env, stdio: ['ignore', 'pipe', 'pipe']});
    let out = '', err = '', done = false;
    const timer = setTimeout(() => { if (!done) child.kill('SIGKILL'); }, timeoutMs);
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('close', (code, signal) => {
      done = true; clearTimeout(timer);
      const lines = out.trim().split('\n').filter(text => text.startsWith('{'));
      const failure = {failed: true, error: signal === 'SIGKILL' ? `no result after ${Math.round(timeoutMs / 1000)} s of wall time; the process was stopped` : signal ? `the process ended with ${signal} (out of memory or an abort inside the engine)` : `exit ${code}: ${(err || out).trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`};
      if (everyLine) {
        // One line per scene; a process that died early leaves fewer lines, and the failure record says why.
        const parsed = [];
        for (const text of lines) { try { parsed.push(JSON.parse(text)); } catch { /* a cut-off line */ } }
        resolve(code === 0 ? parsed : [...parsed, failure]);
        return;
      }
      const line = lines.pop();
      if (line) { try { resolve(JSON.parse(line)); return; } catch { /* fall through */ } }
      resolve(failure);
    });
  });
}

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
/** The adapters of this engine import the built kit; build it when it is missing and say whether we did. */
export function ensureKit() {
  const kitDir = path.join(root, 'packages/box3d-kit');
  // BOX3D_KIT_DIST: the adapter loads a built copy of the kit from elsewhere (adapters/box3d.mjs).
  if (process.env.BOX3D_KIT_DIST || fs.existsSync(path.join(kitDir, 'dist/index.js'))) return () => {};
  console.log('Building box3d-webgpu-kit...');
  const built = spawnSync(npm, ['--prefix', kitDir, 'run', 'build'], {encoding: 'utf8'});
  if (built.status !== 0) throw new Error(`box3d-kit build failed:\n${built.stdout}${built.stderr}`);
  // The kit's build outputs are git-ignored and the source manifest check fails on leftovers.
  return () => { spawnSync(npm, ['--prefix', kitDir, 'run', 'clean'], {encoding: 'utf8'}); };
}
/** Install the other engines (npm ci in benchmarks/engines) unless every pinned version is already there. */
export function ensureEngines() {
  const pinned = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8')).devDependencies;
  const installed = name => { try { return JSON.parse(fs.readFileSync(path.join(here, 'node_modules', name, 'package.json'), 'utf8')).version; } catch { return null; } };
  const missing = Object.entries(pinned).filter(([name, version]) => installed(name) !== version).map(([name]) => name);
  if (missing.length === 0) return;
  console.log(`Installing the benchmark dependencies (${missing.join(', ')})...`);
  const result = spawnSync(npm, ['ci', '--prefix', here, '--no-audit', '--no-fund'], {encoding: 'utf8'});
  if (result.status !== 0) throw new Error(`npm ci in benchmarks/engines failed:\n${result.stdout}${result.stderr}`);
}

/** Size of the files an engine ships, raw and gzip -9. */
function bundleSizes(meta) {
  const base = meta.id === 'box3d' ? root : path.join(here, 'node_modules', meta.package);
  return meta.files.map(file => {
    const bytes = fs.readFileSync(path.join(base, file));
    return {file: meta.id === 'box3d' ? file : `${meta.package}/${file}`, bytes: bytes.length, gzipBytes: zlib.gzipSync(bytes, {level: 9}).length};
  });
}

async function main() {
  const options = parse(process.argv.slice(2));
  ensureEngines();
  const cleanKit = ensureKit();
  let started = new Date();
  const runs = [], skip = new Set(), done = new Set();
  if (options.resume && fs.existsSync(options.out)) {
    // Continue an interrupted run: keep what was measured and run only what is missing.
    const previous = JSON.parse(fs.readFileSync(options.out, 'utf8'));
    started = new Date(previous.started);
    for (const run of previous.runs) {
      runs.push(run); done.add(`${run.config}|${run.repeat}|${run.scene}|${run.engine}`);
      if (run.failed || run.timedOut) skip.add(`${run.config}|${run.scene}|${run.engine}`);
    }
    console.log(`Resuming: ${runs.length} runs kept.`);
  }
  const engines = [];
  for (const id of options.engines) {
    const {meta} = await import(`./adapters/${id}.mjs`);
    engines.push({...meta, bundle: bundleSizes(meta)});
  }
  const machine = {cpu: os.cpus()[0]?.model ?? 'unknown', logicalCpus: os.cpus().length, memoryGb: Math.round(os.totalmem() / 2 ** 30), platform: `${os.platform()} ${os.release()}`, node: process.version, v8: process.versions.v8,
    nodeFlags: NODE_FLAGS.join(' '),
    note: 'shared virtual machine; other jobs ran on it during the measurement (see the load average beside every run)'};
  const save = () => {
    fs.mkdirSync(path.dirname(options.out), {recursive: true});
    fs.writeFileSync(options.out, JSON.stringify({schema: 'box3d-engine-comparison-raw', version: 1, started: started.toISOString(), finished: new Date().toISOString(), machine, options: {...options, out: undefined}, engines, runs}));
  };
  // Light scenes (a few bodies, well under a second of stepping) share one process per engine and repeat, so that an
  // engine's WASM is compiled once for all of them; every heavy scene gets a fresh process, whose peak memory is its own.
  const HEAVY = new Set(['piles', 'terrain', 'queries']), heavy = id => HEAVY.has(SCENES.find(scene => scene.id === id).group) || id === 'ragdolls-100';
  const record = (result, engine, sceneId, config, repeat, load, wallMs, batched) => {
    runs.push({...result, engine: engine.id, scene: sceneId, config, repeat, loadAverage: load, wallMs, batched, ...(batched ? {peakRssBytes: null} : {})});
    if (result.failed || result.timedOut) skip.add(`${config}|${sceneId}|${engine.id}`);
    return `${engine.id} ${result.failed ? 'FAILED' : result.rays && !Number.isFinite(result.step.mean) ? `${result.rays.bestMs.toFixed(0)} ms/rays` : `${result.step.mean.toFixed(2)} ms${result.timedOut ? ' (timed out)' : ''}`}`;
  };
  const pool = async (items, job) => {
    const queue = [...items];
    await Promise.all(Array.from({length: Math.max(1, options.concurrency)}, async () => { for (let item = queue.shift(); item; item = queue.shift()) await job(item); }));
  };
  const runPhase = async (config, repeat, repeats) => {
    const scenes = options.scenes.filter(id => (config === 'default' || options.budgetScenes.includes(id)) && repeat < repeatsOf(id, config, options));
    const todo = (id, engine) => !skip.has(`${config}|${id}|${engine.id}`) && !done.has(`${config}|${repeat}|${id}|${engine.id}`);
    const configurable = engines.filter(engine => !(config !== 'default' && engine.budget.startsWith('not configurable')));
    const label = `[${config} #${repeat + 1}/${repeats}]`;
    const light = scenes.filter(id => !heavy(id));
    if (light.length) {
      await pool(configurable, async engine => {
        const wanted = light.filter(id => todo(id, engine));
        if (wanted.length === 0) return;
        const load = os.loadavg()[0], t0 = Date.now();
        const lines = await runChild([`--engine=${engine.id}`, `--scene=${wanted.join(',')}`, `--solver=${config}`, `--budgetMs=${options.stepBudgetMs}`], options.stepBudgetMs * 20 * wanted.length + 300000, true);
        for (const id of wanted) {
          const result = lines.find(line => line.scene === id) ?? {failed: true, error: lines.find(line => line.failed && !line.scene)?.error ?? 'the process ended before this scene'};
          record(result, engine, id, config, repeat, load, Date.now() - t0, true);
        }
      });
      console.log(`${label} ${light.length} light scenes: ${configurable.map(engine => `${engine.id} ${runs.filter(run => run.config === config && run.repeat === repeat && run.engine === engine.id && run.batched && !run.failed).length} ok`).join(', ')}`);
      save();
    }
    for (const sceneId of scenes.filter(heavy)) {
      // Every engine runs this scene before the next scene starts, `concurrency` processes at a time.
      const line = new Map();
      await pool(configurable.filter(engine => todo(sceneId, engine)), async engine => {
        const load = os.loadavg()[0], t0 = Date.now();
        const result = await runChild([`--engine=${engine.id}`, `--scene=${sceneId}`, `--solver=${config}`, `--budgetMs=${budgetOf(sceneId, options)}`], budgetOf(sceneId, options) * 20 + 300000);
        line.set(engine.id, record(result, engine, sceneId, config, repeat, load, Date.now() - t0, false));
      });
      console.log(`${label} ${sceneId}: ${engines.map(engine => line.get(engine.id)).filter(Boolean).join(', ')}`);
      save();
    }
  };
  try {
    // Order: one repeat of each setting first, then the same-process determinism check, then the remaining repeats,
    // so that a run stopped early still holds complete repeats of everything.
    const budget = options.configs.filter(config => config !== 'default');
    for (let repeat = 0; repeat < Math.max(options.repeats, options.budgetRepeats); repeat++) {
      if (options.configs.includes('default') && repeat < options.repeats) await runPhase('default', repeat, options.repeats);
      for (const config of budget) if (repeat < options.budgetRepeats) await runPhase(config, repeat, options.budgetRepeats);
      if (repeat === 0 && options.twice) {
        // Same-process determinism: build and run one scene twice in one process.
        await pool(engines.filter(engine => !done.has(`twice|0|boxes-1k|${engine.id}`)), async engine => {
          const result = await runChild([`--engine=${engine.id}`, '--scene=boxes-1k', '--twice=1', `--budgetMs=${options.stepBudgetMs}`], options.stepBudgetMs * 20 + 300000);
          runs.push({...result, engine: engine.id, scene: 'boxes-1k', config: 'twice', repeat: 0, loadAverage: os.loadavg()[0]});
          console.log(`[same-process rerun] ${engine.id}: ${result.failed ? `FAILED ${result.error}` : result.twice?.identical ? 'identical' : 'different'}`);
        });
        save();
      }
    }
  } finally {
    save();
    cleanKit();
  }
  console.log(`Raw results: ${path.relative(root, options.out)} (${runs.length} runs, ${((Date.now() - started) / 60000).toFixed(1)} min)`);
  if (options.report) {
    const report = spawnSync(process.execPath, [path.join(here, 'report.mjs'), '--raw', options.out], {stdio: 'inherit'});
    if (report.status !== 0) process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error?.stack ?? error); process.exitCode = 1; });
