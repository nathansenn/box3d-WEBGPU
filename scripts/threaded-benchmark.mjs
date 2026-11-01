// Dense-rain benchmark of the single-threaded artifact (box3d.js) against the pthread artifact (box3d-mt.js)
// at several worker counts; see docs/THREADED_ENGINE.md. Every measurement runs in a fresh Node process.
// Workload = docs/NATIVE_CAPACITY.md: scene 0, stress 1, seed 42, fill to N bodies with rain spread
// 12*sqrt(N/4096) at height 2, dt 1/60, 4 substeps, 8 warmup + 24 measured frames of b3w_world_step.
// Configs run interleaved (for each rep, for each size, every config once) so load drift hits all alike.
// usage: node scripts/threaded-benchmark.mjs [--bodies=1024,4096,16384] [--configs=st,mt1,mt2,mt4,mt8]
//        [--reps=3] [--out=result.json] [--timeoutMs=240000] [--graceMs=20000]   (st = single-threaded, mtN = N workers)
//        BOX3D_WASM_DIR overrides public/box3d, as in scripts/native-box3d-soak.mjs.
// Every run's final state must equal the single-threaded artifact's (exit 1 otherwise). Timings never fail
// the run: they depend on the machine, and the JSON records the load average beside every one of them.
// A run is judged on the result line its child prints. A child that prints a complete result and then does not
// exit within --graceMs is killed and recorded under exitHangs, not failures: Node 26.0.0 was seen stalling in its own
// platform shutdown after a finished run (docs/THREADED_ENGINE.md, hazard B). A child that dies, exits non-zero or
// never prints a result is a failure.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { lastJsonLine, superviseChild } from './supervise-child.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : '1'];
}));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.resolve(process.env.BOX3D_WASM_DIR ?? path.join(root, 'public/box3d'));
const DT = 1 / 60;

function hashWords(u32) {
  let h1 = 0x811c9dc5 | 0;
  let h2 = 0x9e3779b9 | 0;
  for (let i = 0; i < u32.length; i++) {
    const w = u32[i] | 0;
    h1 = Math.imul(h1 ^ w, 0x01000193);
    h2 = Math.imul(h2 ^ w, 0x5bd1e995);
    h2 ^= h2 >>> 13;
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}
function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}
const median = (values) => percentile(values, 0.5);

if (args.child) {
  const threaded = args.artifact === 'mt';
  const workers = Number(args.workers);
  const bodies = Number(args.bodies);
  const warmup = Number(args.warmup ?? 8);
  const measured = Number(args.measured ?? 24);
  const file = path.join(artifactDir, threaded ? 'box3d-mt.js' : 'box3d.js');
  const started = performance.now();
  const factory = (await import(pathToFileURL(file).href)).default;
  const mod = await factory(threaded
    ? { b3wPoolSize: workers - 1, locateFile: (f) => path.join(artifactDir, f) }
    : { wasmBinary: fs.readFileSync(path.join(artifactDir, 'box3d.wasm')) });
  const loadMs = performance.now() - started;
  const applied = threaded ? mod._b3w_set_worker_count(workers) : 1;
  if (threaded) mod._b3w_set_thread_threshold(0); // measure the requested worker count, not the adaptive policy

  const handle = mod._b3w_world_create();
  if (!handle) throw new Error(`world create failed: ${mod._b3w_world_last_create_error()}`);
  mod._b3w_world_create_scene(handle, 0, 1, 42);
  if (bodies > 4096) mod._b3w_world_reserve(handle, bodies);
  mod._b3w_world_spawn_rain(handle, bodies - mod._b3w_world_body_count(handle), 12 * Math.sqrt(bodies / 4096), 2.0);
  const count = mod._b3w_world_body_count(handle);
  const memory = () => (mod.wasmMemory ? mod.wasmMemory.buffer : mod.HEAPU8.buffer);
  const stateHash = () => hashWords(new Uint32Array(memory(), Number(mod._b3w_world_matrices_ptr(handle)), count * 16));

  const frameMs = [];
  let stepped = 0;
  for (let frame = 0; frame < warmup + measured; frame++) {
    const t0 = performance.now();
    mod._b3w_world_step(handle, DT, 4);
    const elapsed = performance.now() - t0;
    if (frame >= warmup) frameMs.push(elapsed);
    if (threaded && mod._b3w_last_step_workers() === applied) stepped += 1;
  }
  const result = {
    artifact: threaded ? 'mt' : 'st', workers: applied, bodies: count, awake: mod._b3w_world_awake_count(handle),
    contacts: mod._b3w_world_contact_count(handle), stepP50: +median(frameMs).toFixed(3), stepP95: +percentile(frameMs, 0.95).toFixed(3),
    stepMin: +Math.min(...frameMs).toFixed(3), framesOnRequestedWorkers: threaded ? stepped : null, loadMs: +loadMs.toFixed(1),
    hash: stateHash(), replayHash: (mod._b3w_world_replay_hash(handle) >>> 0).toString(16), load1: +os.loadavg()[0].toFixed(2),
    sharedMemory: threaded ? memory() instanceof SharedArrayBuffer : false,
  };
  process.stdout.write(`${JSON.stringify(result)}\n`, () => process.exit(0));
} else {
  const sizes = String(args.bodies ?? '1024,4096,16384').split(',').map(Number);
  const configs = String(args.configs ?? 'st,mt1,mt2,mt4,mt8').split(',');
  const reps = Number(args.reps ?? 3);
  const timeoutMs = Number(args.timeoutMs ?? 240000);
  const graceMs = Number(args.graceMs ?? 20000);
  if (!sizes.every((n) => Number.isInteger(n) && n > 0) || !configs.every((c) => /^(st|mt[1-9]\d*)$/.test(c)) || !configs.includes('st')) {
    throw new Error('--bodies takes positive integers; --configs takes st and mtN entries and must include st (the oracle)');
  }
  // One fresh child process per measurement.
  const runChild = (childArgs) => superviseChild(process.execPath, [fileURLToPath(import.meta.url), '--child', ...childArgs], {
    timeoutMs, graceMs, resultOf: lastJsonLine,
  });
  const digest = (name) => {
    const file = path.join(artifactDir, name);
    return fs.existsSync(file) ? crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') : null;
  };
  const cpus = os.cpus().length;
  const loadBefore = +os.loadavg()[0].toFixed(2);
  const runs = [];
  const failures = [];
  const exitHangs = [];
  for (let rep = 1; rep <= reps; rep++) {
    for (const bodies of sizes) {
      for (const config of configs) {
        const workers = config === 'st' ? 1 : Number(config.slice(2));
        const run = await runChild([`--artifact=${config === 'st' ? 'st' : 'mt'}`, `--workers=${workers}`, `--bodies=${bodies}`]);
        if (run.result && (run.status === 0 || run.exitHang)) {
          runs.push({ rep, config, ...run.result });
          if (run.exitHang) exitHangs.push({ rep, config, bodies, graceMs });
        } else {
          failures.push({ rep, config, bodies, status: run.status, signal: run.signal, timedOut: run.timedOut, printedResult: run.result !== null, error: run.stderr });
        }
      }
    }
  }
  const summary = [];
  for (const bodies of sizes) {
    const oracleRuns = runs.filter((r) => r.bodies === bodies && r.config === 'st');
    const oracle = oracleRuns[0];
    const oracleP50 = oracleRuns.length ? median(oracleRuns.map((r) => r.stepP50)) : NaN;
    const oracleMin = oracleRuns.length ? Math.min(...oracleRuns.map((r) => r.stepMin)) : NaN;
    for (const config of configs) {
      const rows = runs.filter((r) => r.bodies === bodies && r.config === config);
      if (rows.length === 0) continue;
      const p50 = median(rows.map((r) => r.stepP50));
      const min = Math.min(...rows.map((r) => r.stepMin));
      summary.push({
        bodies, config, runs: rows.length, stepP50Median: +p50.toFixed(3), stepP50Runs: rows.map((r) => r.stepP50), stepMin: +min.toFixed(3),
        speedupVsSingle: +(oracleP50 / p50).toFixed(2), speedupVsSingleByMin: +(oracleMin / min).toFixed(2),
        loadMedianMs: +median(rows.map((r) => r.loadMs)).toFixed(1), framesOnRequestedWorkers: config === 'st' ? null : Math.min(...rows.map((r) => r.framesOnRequestedWorkers)),
        stateEqualsSingle: oracle ? rows.every((r) => r.hash === oracle.hash && r.replayHash === oracle.replayHash && r.bodies === oracle.bodies) : false,
        load1: [Math.min(...rows.map((r) => r.load1)), Math.max(...rows.map((r) => r.load1))],
      });
    }
  }
  const loadMax = Math.max(loadBefore, ...runs.map((r) => r.load1));
  const result = {
    schema: 'box3d-threaded-benchmark/1', node: process.version, platform: `${process.platform}-${process.arch}`, cpus, loadBefore, loadMax,
    quietMachine: loadMax <= cpus / 2,
    method: 'dense rain, scene 0 stress 1 seed 42, N bodies, dt 1/60, 4 substeps, 8 warmup + 24 measured frames of b3w_world_step, one fresh process per run, configs interleaved, threshold 0',
    artifacts: Object.fromEntries(['box3d.js', 'box3d.wasm', 'box3d-mt.js', 'box3d-mt.wasm'].map((n) => [n, digest(n)])),
    sizes, configs, reps, summary, failures, exitHangs, runs,
  };
  if (args.out) fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(result, null, 2)}\n`);
  console.log(`load1 before ${loadBefore}, max ${loadMax} on ${cpus} CPUs${result.quietMachine ? '' : ' (load-contaminated: timings are not quiet-machine numbers)'}`);
  console.log('bodies config runs  p50 ms   min ms  speedup  (by min)  load ms  on-workers  state==single');
  for (const s of summary) {
    console.log(`${String(s.bodies).padStart(6)} ${s.config.padEnd(6)} ${String(s.runs).padStart(4)} ${s.stepP50Median.toFixed(2).padStart(8)} ${s.stepMin.toFixed(2).padStart(8)} ${s.speedupVsSingle.toFixed(2).padStart(8)} ${s.speedupVsSingleByMin.toFixed(2).padStart(9)} ${s.loadMedianMs.toFixed(0).padStart(8)} ${String(s.framesOnRequestedWorkers ?? '-').padStart(11)}  ${s.stateEqualsSingle ? 'yes' : 'NO'}`);
  }
  for (const h of exitHangs) console.error(`NOTE rep ${h.rep} ${h.config} ${h.bodies}: the result was printed but the process did not exit within ${h.graceMs} ms and was killed (Node shutdown stall; the measurement is kept)`);
  for (const f of failures) console.error(`FAILED rep ${f.rep} ${f.config} ${f.bodies}: status ${f.status} signal ${f.signal}${f.timedOut ? ' timed out' : ''}${f.printedResult ? ' after printing a result' : ''} ${f.error}`);
  const unequal = summary.filter((s) => !s.stateEqualsSingle);
  const engaged = summary.filter((s) => s.config !== 'st' && s.framesOnRequestedWorkers < 32);
  if (unequal.length || failures.length || engaged.length) {
    console.error(`threaded benchmark FAILED: ${unequal.length} configs differ from the single-threaded state, ${failures.length} runs failed, ${engaged.length} configs did not use their workers on every frame`);
    process.exit(1);
  }
}
