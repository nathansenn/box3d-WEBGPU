// Determinism and engagement test for the pthread artifact box3d-mt.{js,wasm}; see docs/THREADED_ENGINE.md.
// The shipped single-threaded artifact is the oracle. The threaded artifact must reproduce its exact state
// (matrix and colour streams plus replay hash) over the 800-scene catalog at every worker count, while the
// worker count changes mid-run, while the awake-body threshold moves a world on and off its workers, and
// while several native-world contexts are interleaved. It also checks that requested workers were used.
// usage: node scripts/threaded-determinism-test.mjs [--workers=1,2,4,8] [--stride=1] [--out=result.json] [--record]
//        BOX3D_WASM_DIR overrides public/box3d, as in scripts/native-box3d-soak.mjs.
// --record writes a passing full run into BUILD_PROVENANCE.json as threaded.validation, citing --out as its evidence.
// It needs the full run (stride 1, workers 1,2,4,8), the default artifact directory, and --out inside the repository.
// The run is supervised by a child process: no verdict within --timeoutMs means a deadlocked worker barrier, and the
// child is killed. A child that printed its verdict and then did not exit within --graceMs (default 20000) is killed too,
// but its verdict stands: Node 26.0.0 was seen stalling in its own platform shutdown (docs/THREADED_ENGINE.md, hazard B).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { superviseChild, verdictOf } from './supervise-child.mjs';

const args = Object.fromEntries(process.argv.slice(2).map((a) => {
  const [k, ...v] = a.replace(/^--/, '').split('=');
  return [k, v.length ? v.join('=') : '1'];
}));

if (!args.child) {
  const timeoutMs = Number(args.timeoutMs ?? 600000);
  const graceMs = Number(args.graceMs ?? 20000);
  const run = await superviseChild(process.execPath, [fileURLToPath(import.meta.url), '--child', ...process.argv.slice(2)], {
    timeoutMs, graceMs, stderr: 'inherit', forward: (chunk) => process.stdout.write(chunk),
    resultOf: verdictOf('THREADED_DETERMINISM_VERDICT'),
  });
  if (run.timedOut) {
    console.error(`threaded determinism test printed no verdict within ${timeoutMs} ms and was killed: a worker barrier is probably deadlocked`);
    process.exit(2);
  }
  if (run.result === null) {
    console.error(`threaded determinism test ended without a verdict (${run.signal ? `signal ${run.signal}` : `status ${run.status}`})`);
    process.exit(1);
  }
  if (run.exitHang) {
    console.error(`warning: the child printed its verdict (${run.result}) and then did not exit within ${graceMs} ms, so it was killed; the verdict stands (Node shutdown stall, see docs/THREADED_ENGINE.md)`);
    process.exit(run.result === 'passed' ? 0 : 1);
  }
  if (run.signal) console.error(`threaded determinism test: the child printed its verdict (${run.result}) and then died from signal ${run.signal}`);
  process.exit(run.status ?? 1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.resolve(process.env.BOX3D_WASM_DIR ?? path.join(root, 'public/box3d'));
const workerList = String(args.workers ?? '1,2,4,8').split(',').map(Number);
if (workerList.length === 0 || workerList.some((w) => !Number.isInteger(w) || w < 1)) {
  throw new Error(`--workers must be a list of positive integers, got ${args.workers}`);
}
const stride = Number(args.stride ?? 1);
if (args.record) {
  const evidence = args.out ? path.relative(root, path.resolve(args.out)) : '..';
  if (![1, 2, 4, 8].every((w) => workerList.includes(w)) || stride !== 1) throw new Error('--record needs the full run: --stride=1 and --workers including 1,2,4,8');
  if (process.env.BOX3D_WASM_DIR) throw new Error('--record updates the repository manifest, so BOX3D_WASM_DIR must not be set');
  if (evidence.startsWith('..') || path.isAbsolute(evidence)) throw new Error('--record needs --out inside the repository: it is the evidence the manifest cites');
}
const pool = Math.max(...workerList) - 1;
const digest = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');

// Identity: the oracle and the threaded artifact must be the exact, current, recorded builds.
const provenance = JSON.parse(fs.readFileSync(path.join(artifactDir, 'BUILD_PROVENANCE.json'), 'utf8'));
const stale = [];
function expectArtifact(name, record) {
  const file = path.join(artifactDir, name);
  if (!fs.existsSync(file)) { stale.push(`${name} is missing`); return; }
  const bytes = fs.readFileSync(file);
  if (bytes.byteLength !== record?.bytes || digest(bytes) !== record?.sha256) stale.push(`${name} does not match BUILD_PROVENANCE.json`);
}
for (const name of ['box3d.js', 'box3d.wasm']) expectArtifact(name, provenance.artifacts?.[name]);
const threadedRecord = provenance.threaded;
if (!threadedRecord) stale.push('BUILD_PROVENANCE.json has no threaded record');
for (const name of ['box3d-mt.js', 'box3d-mt.wasm']) expectArtifact(name, threadedRecord?.artifacts?.[name]);
for (const [key, file] of [['threadsSha256', 'wasm/box3d_threads.c'], ['bridgeSha256', provenance.bridge?.source ?? 'wasm/box3d_web.c'], ['cmakeSha256', 'wasm/CMakeLists.txt']]) {
  if (digest(fs.readFileSync(path.join(root, file))) !== threadedRecord?.sources?.[key]) stale.push(`${file} changed since the threaded artifact was built`);
}
if (stale.length) throw new Error(`${stale.join('; ')}. Run npm run build:wasm:mt.`);

async function load(name, options) {
  const imported = await import(pathToFileURL(path.join(artifactDir, name)).href);
  const started = performance.now();
  const mod = await imported.default(options);
  return { mod, loadMs: +(performance.now() - started).toFixed(1) };
}
const { mod: oracle, loadMs: oracleLoadMs } = await load('box3d.js', { wasmBinary: fs.readFileSync(path.join(artifactDir, 'box3d.wasm')) });
const { mod: mt, loadMs: mtLoadMs } = await load('box3d-mt.js', { b3wPoolSize: pool, locateFile: (f) => path.join(artifactDir, f) });

const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };

// The contract a loader relies on.
check(oracle._b3w_set_worker_count === undefined, 'the single-threaded artifact must not export _b3w_set_worker_count');
check(mt._b3w_threads_supported() === 1, 'threads_supported');
const capacity = mt._b3w_worker_capacity();
check(capacity === pool + 1, `capacity ${capacity} should be the preloaded pool ${pool} plus the calling thread`);
check(mt._b3w_get_worker_count() === 1, 'a fresh module must start on one worker');
check(mt._b3w_last_step_workers() === 1, 'last_step_workers must start at 1');
check(mt._b3w_get_thread_threshold() === 384, 'default awake-body threshold');
check(mt._b3w_set_worker_count(0) === 1 && mt._b3w_set_worker_count(-5) === 1, 'worker counts below 1 clamp to 1');
check(mt._b3w_set_worker_count(1000) === capacity && mt._b3w_get_worker_count() === capacity, 'worker counts above capacity clamp to it');
check(mt._b3w_set_thread_threshold(-1) === 0, 'negative thresholds clamp to 0');
mt._b3w_set_worker_count(1);

const memory = (mod) => (mod.wasmMemory ? mod.wasmMemory.buffer : mod.HEAPU8.buffer);
function hashWords(u32, seed1 = 0x811c9dc5 | 0, seed2 = 0x9e3779b9 | 0) {
  let h1 = seed1;
  let h2 = seed2;
  for (let i = 0; i < u32.length; i++) {
    const w = u32[i] | 0;
    h1 = Math.imul(h1 ^ w, 0x01000193);
    h2 = Math.imul(h2 ^ w, 0x5bd1e995);
    h2 ^= h2 >>> 13;
  }
  return [h1 >>> 0, h2 >>> 0];
}
function streamHash(mod, matricesPtr, colorsPtr, count) {
  const buffer = memory(mod);
  const a = hashWords(new Uint32Array(buffer, Number(matricesPtr), count * 16));
  const b = hashWords(new Uint32Array(buffer, Number(colorsPtr), count * 4), a[0] | 0, a[1] | 0);
  return b[0].toString(16).padStart(8, '0') + b[1].toString(16).padStart(8, '0');
}
const legacyState = (mod, count) => `${streamHash(mod, mod._b3w_matrices_ptr(), mod._b3w_colors_ptr(), count)}:${(mod._b3w_replay_hash() >>> 0).toString(16)}:${mod._b3w_body_count()}`;

// With threshold 0 a step that begins with awake bodies must use exactly the requested worker count.
// A step that begins with none returns inside the bridge before any worker decision, so it is not checked.
const engagement = { checked: 0, notEngaged: 0, skippedAsleep: 0, detail: [] };
function step(mod, expected, where) {
  const awake = mod._b3w_awake_count();
  mod._b3w_step(1 / 60, 4);
  if (expected === null) return;
  if (awake === 0) { engagement.skippedAsleep += 1; return; }
  engagement.checked += 1;
  const got = mod._b3w_last_step_workers();
  const want = Math.min(expected, capacity);
  if (got !== want) {
    engagement.notEngaged += 1;
    if (engagement.detail.length < 5) engagement.detail.push({ ...where, awake, want, got });
  }
}

// The catalog recipe of scripts/native-box3d-soak.mjs, hashing the full streams.
function catalogPass(mod, workers, pass) {
  const out = [];
  for (let sceneId = 0; sceneId < 800; sceneId += stride) {
    const count = mod._b3w_create_scene(sceneId, 1 + (sceneId % 5), (0xc0ffee + sceneId) >>> 0);
    for (let frame = 0; frame < 3; frame++) step(mod, workers, { pass, scene: sceneId, frame });
    out.push(legacyState(mod, count));
  }
  return out;
}

// The worker count changes while a simulation is in flight.
function switchingPass(mod, plan) {
  const out = [];
  for (let sceneId = 0; sceneId < 800; sceneId += stride * 16) {
    const count = mod._b3w_create_scene(sceneId, 1 + (sceneId % 5), (0xc0ffee + sceneId) >>> 0);
    for (let frame = 0; frame < 12; frame++) {
      if (plan === null) { mod._b3w_step(1 / 60, 4); continue; }
      const workers = plan[frame % plan.length];
      mod._b3w_set_worker_count(workers);
      step(mod, workers, { pass: 'switching', scene: sceneId, frame });
    }
    out.push(legacyState(mod, count));
  }
  return out;
}

// Independent re-implementation of b3w_choose_workers (wasm/box3d_threads.c): a second method for the policy.
function policy(current, awake, requested, enter) {
  if (requested <= 1) return 1;
  const leave = enter - Math.trunc(enter / 3);
  if (current <= 1) return awake >= enter ? requested : 1;
  return awake < leave ? 1 : requested;
}

// A world grows past the threshold and starts using its workers; the threshold is then raised above the body
// count (forcing the fall back to one worker) and lowered again (forcing the return). Every decision is compared
// with the re-implemented policy, every state with the single-threaded oracle.
function adaptiveRun(mod, requested, frameCount, target) {
  const base = 384;
  const threaded = requested !== null;
  let threshold = base;
  if (threaded) { mod._b3w_set_thread_threshold(threshold); mod._b3w_set_worker_count(requested); }
  mod._b3w_create_scene(0, 1, 42);
  const trace = [];
  const awakeBefore = [];
  const hashes = [];
  const decisions = [];
  let current = 1;
  for (let frame = 0; frame < frameCount; frame++) {
    if (frame === 10) mod._b3w_spawn_rain(target - mod._b3w_body_count(), 12, 2.0);
    if (threaded && frame === Math.floor(frameCount * 0.5)) { threshold = 5000; mod._b3w_set_thread_threshold(threshold); }
    if (threaded && frame === Math.floor(frameCount * 0.75)) { threshold = base; mod._b3w_set_thread_threshold(threshold); }
    const awake = mod._b3w_awake_count();
    awakeBefore.push(awake);
    mod._b3w_step(1 / 60, 4);
    if (threaded) {
      const used = awake > 0 ? mod._b3w_last_step_workers() : 0; // 0: the step never reached the solver
      if (awake > 0) {
        decisions.push({ used, want: policy(current, awake, Math.min(requested, capacity), threshold) });
        current = used;
      }
      trace.push(used);
    }
    if (frame % 8 === 7) hashes.push(legacyState(mod, mod._b3w_body_count()));
  }
  return { trace, awakeBefore, hashes, decisions };
}

// Several native-world contexts stepped in turn, as the app does, while the worker count changes.
const WORLD_SCENES = [0, 101, 302, 555];
function worldsPass(mod, plan) {
  const handles = WORLD_SCENES.map((scene, i) => {
    const handle = mod._b3w_world_create() >>> 0;
    check(handle !== 0, 'world creation failed');
    mod._b3w_world_create_scene(handle, scene, 1 + i, (0xabc000 + i) >>> 0);
    return handle;
  });
  for (let frame = 0; frame < 24; frame++) {
    if (plan !== null) mod._b3w_set_worker_count(plan[frame % plan.length]);
    for (const handle of handles) mod._b3w_world_step(handle, 1 / 60, 4);
  }
  const out = handles.map((handle) => {
    const count = mod._b3w_world_body_count(handle);
    const streams = streamHash(mod, mod._b3w_world_matrices_ptr(handle), mod._b3w_world_colors_ptr(handle), count);
    return `${streams}:${(mod._b3w_world_replay_hash(handle) >>> 0).toString(16)}:${count}`;
  });
  for (const handle of handles) mod._b3w_world_destroy(handle);
  return out;
}

const started = performance.now();
mt._b3w_set_thread_threshold(0); // thread every world so the small catalog scenes exercise the workers
const oracleCatalog = catalogPass(oracle, null, 'oracle');
const mismatches = [];
let comparisons = 0;
function compare(label, got, want) {
  check(got.length === want.length, `${label} produced ${got.length} states, expected ${want.length}`);
  comparisons += got.length;
  got.forEach((value, i) => {
    if (value !== want[i]) mismatches.push({ pass: label, index: i, got: value, want: want[i] });
  });
}
const passMs = {};
for (const workers of workerList) {
  check(mt._b3w_set_worker_count(workers) === Math.min(workers, capacity), `worker count ${workers} was not accepted`);
  const t = performance.now();
  compare(`catalog-w${workers}`, catalogPass(mt, workers, `w${workers}`), oracleCatalog);
  passMs[workers] = +(performance.now() - t).toFixed(0);
}
compare('switching', switchingPass(mt, workerList.length > 1 ? workerList : [1, 1]), switchingPass(oracle, null));

const adaptiveFrames = 480;
const adaptiveTarget = 1200;
const adaptiveWorkers = Math.min(Math.max(...workerList), capacity);
const adaptiveOracle = adaptiveRun(oracle, null, adaptiveFrames, adaptiveTarget);
const adaptive = adaptiveRun(mt, adaptiveWorkers, adaptiveFrames, adaptiveTarget);
compare('adaptive', adaptive.hashes, adaptiveOracle.hashes);
const policyMismatches = adaptive.decisions.filter((d) => d.used !== d.want).length;
let transitionsUp = 0;
let transitionsDown = 0;
let previous = 0;
for (const used of adaptive.trace) {
  if (used === 0) continue;
  if (previous > 0 && previous <= 1 && used > 1) transitionsUp += 1;
  if (previous > 1 && used <= 1) transitionsDown += 1;
  previous = used;
}
if (adaptiveWorkers > 1) {
  check(transitionsUp >= 2 && transitionsDown >= 1, `the adaptive run must cross the threshold up and down (up ${transitionsUp}, down ${transitionsDown})`);
  check(adaptive.trace.some((w) => w > 1), 'the adaptive run never used its workers');
}

mt._b3w_set_thread_threshold(0);
compare('worlds', worldsPass(mt, workerList.length > 1 ? workerList : [1, 1]), worldsPass(oracle, null));
compare('worlds-default-count', (() => { mt._b3w_set_worker_count(1); return worldsPass(mt, null); })(), worldsPass(oracle, null));

// A device that cannot preload workers gets a threaded module that still runs, on one worker.
const { mod: bare } = await load('box3d-mt.js', { b3wPoolSize: 0, locateFile: (f) => path.join(artifactDir, f) });
check(bare._b3w_worker_capacity() === 1 && bare._b3w_set_worker_count(8) === 1, 'a module without a worker pool must report capacity 1');
bare._b3w_set_thread_threshold(0);
const sampleScenes = [0, 57, 301, 799];
function sceneState(mod, sceneId) {
  const count = mod._b3w_create_scene(sceneId, 1 + (sceneId % 5), (0xc0ffee + sceneId) >>> 0);
  for (let frame = 0; frame < 3; frame++) mod._b3w_step(1 / 60, 4);
  return legacyState(mod, count);
}
compare('no-pool', sampleScenes.map((s) => sceneState(bare, s)), sampleScenes.map((s) => sceneState(oracle, s)));

const summary = {
  result: 'pending',
  artifacts: Object.fromEntries(Object.entries(threadedRecord.artifacts).map(([n, a]) => [n, a.sha256])),
  node: process.version,
  capacity, pool, workerList, stride,
  catalogScenes: oracleCatalog.length,
  comparisons,
  mismatches: mismatches.length,
  firstMismatches: mismatches.slice(0, 3),
  engagement,
  adaptive: {
    workers: adaptiveWorkers, frames: adaptiveFrames, target: adaptiveTarget, hashCompares: adaptive.hashes.length,
    policyChecks: adaptive.decisions.length, policyMismatches, transitionsUp, transitionsDown,
    awakeMax: Math.max(...adaptive.awakeBefore), awakeMin: Math.min(...adaptive.awakeBefore),
    threadedFrames: adaptive.trace.filter((w) => w > 1).length,
  },
  problems,
  catalogDigest: digest(oracleCatalog.join('|')).slice(0, 16),
  loadMs: { oracle: oracleLoadMs, threaded: mtLoadMs },
  passMs,
  elapsedMs: +(performance.now() - started).toFixed(0),
  host: { load1: +os.loadavg()[0].toFixed(2), cpus: os.cpus().length },
};
const failed = mismatches.length > 0 || engagement.notEngaged > 0 || policyMismatches > 0 || problems.length > 0;
summary.result = failed ? 'failed' : 'passed';
if (args.out) fs.writeFileSync(path.resolve(args.out), `${JSON.stringify(summary, null, 2)}\n`);
if (args.record && !failed) {
  // Same shape as the single-threaded `validation` block. update-threaded-provenance.mjs resets it to not_run
  // whenever the threaded sources or artifacts change, so it can only ever describe the hashes it was measured on.
  provenance.threaded.validation = {
    status: 'pass',
    catalogScenes: summary.catalogScenes,
    exactComparisons: summary.comparisons,
    workerCounts: workerList,
    engagementChecks: engagement.checked,
    adaptivePolicyChecks: summary.adaptive.policyChecks,
    adaptiveThresholdCrossings: { up: summary.adaptive.transitionsUp, down: summary.adaptive.transitionsDown },
    interleavedWorlds: WORLD_SCENES.length,
    noPoolModule: 'exact state on one worker',
    catalogDigest: summary.catalogDigest,
    oracle: 'the shipped single-threaded artifact recorded under artifacts',
    evidence: [path.relative(root, path.resolve(args.out)).split(path.sep).join('/')],
    scope: 'Exact equality of the pthread artifact with the single-threaded artifact (matrix and colour streams, replay hash) at every tested worker count, across mid-run worker-count changes, awake-body threshold crossings, interleaved native worlds and a module without a worker pool. No speedup, FPS, whole-engine 100x, browser-stability or release claim; speedups are measured separately in docs/THREADED_ENGINE.md.',
  };
  fs.writeFileSync(path.join(artifactDir, 'BUILD_PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  console.log('Recorded threaded.validation in BUILD_PROVENANCE.json');
} else if (args.record) {
  console.error('--record: the run failed, so BUILD_PROVENANCE.json was not changed');
}
// Pool workers keep the process alive, so exit explicitly once the report is flushed. The last line is what the
// supervising parent waits for: it tells a finished run that is slow to exit from one that never finished.
process.stdout.write(`${JSON.stringify(summary, null, 2)}\nTHREADED_DETERMINISM_VERDICT ${summary.result}\n`, () => process.exit(failed ? 1 : 0));
