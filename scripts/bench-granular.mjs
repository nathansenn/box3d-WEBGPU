// Speed and exactness of the discrete element solver (src/engine/granular.ts) on the Studio granular tray presets
// (src/studio/material-labs/catalog.ts, LABS.granular.experiments) and the Lab's hopper-seesaw example.
//
// For each case: wall time of the build (the tray settles its column for 0.3 s inside the constructor) and of a fixed
// stretch of simulated time on one thread, the speed as simulated seconds per wall second ("x real time"), and a
// SHA-256 of the observable state at the end (positions, velocities, spins, contact forces and torques, the energy
// ledger, the statistics and every wall's force and impulse). Two runs of a pure refactor must print the same hashes.
//
//   node scripts/bench-granular.mjs                 all cases, 1 s of simulated time each
//   node scripts/bench-granular.mjs --seconds 0.25  shorter
//   node scripts/bench-granular.mjs --only sand-avalanche,bead-runout
//   node scripts/bench-granular.mjs --json out.json write the results
//   node scripts/bench-granular.mjs --check base.json  fail when a hash differs from a saved run
//   node scripts/bench-granular.mjs --threads 4  the tray's contacts on 4 threads (granular-parallel.ts); wall time
//   --repeat N  the fastest of N runs; --wall  wall time instead of this process's CPU time
import {registerHooks} from 'node:module';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
/** CPU time of this process, ms (user + system): steadier than wall time on a shared machine. */
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
registerHooks({resolve(s, c, next) { if (s.startsWith('.') && !/\.[a-z]+$/i.test(s) && c.parentURL?.endsWith('.ts')) { const u = new URL(s + '.ts', c.parentURL); if (existsSync(u)) return next(u.href, c); } return next(s, c); }});

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const threads = Number(flag('--threads') ?? 1), wall = args.includes('--wall') || threads > 1;
// Times are CPU time of this process unless --wall (or --threads, whose helpers' CPU time would add up).
const clock = wall ? () => performance.now() : cpu;
const repeat = Number(flag('--repeat') ?? 1), seconds = Number(flag('--seconds') ?? 1), only = flag('--only')?.split(','), jsonOut = flag('--json'), check = flag('--check');
const {GranularModel, DT} = await import('../src/studio/material-labs/models.ts');
const {LABS} = await import('../src/studio/material-labs/catalog.ts');
let pool = null;
if (threads > 1) {
  const {GranularThreads, nodeGranularWorker} = await import('../src/engine/granular-parallel.ts');
  const {useTrayExecutor} = await import('../src/studio/material-labs/granular-si.ts');
  pool = await GranularThreads.create(threads, nodeGranularWorker); useTrayExecutor(pool);
}

/** Observable state of a Granular, hashed. */
export function granularHash(g) {
  const h = createHash('sha256'), n = g.grainCount, f64 = a => h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  for (const a of [g.positions, g.velocities, g.angularVelocities, g.forces, g.torques]) f64(a.subarray(0, 3 * n));
  f64(Float64Array.from([g.time, g.dissipatedDamping, g.dissipatedFriction, g.externalWork, g.elasticEnergy(), g.kineticEnergy()]));
  h.update(JSON.stringify(g.stats));
  for (let w = 0; w < g.wallCount; w++) for (const a of [g.wallForce(w), g.wallTorque(w), g.wallImpulse(w), g.wallAngularImpulse(w), g.wallPosition(w)]) f64(Float64Array.from(a));
  return h.digest('hex');
}

const results = [];
const cases = LABS.granular.experiments.filter(e => !only || only.includes(e.id));
for (const experiment of cases) {
  let best = null;
  // With --repeat, the fastest of the runs (the machine may be shared); every run must give the same hash.
  for (let rep = 0; rep < repeat; rep++) {
    const t0 = clock();
    const model = new GranularModel({...experiment.settings});
    const t1 = clock();
    const steps0 = model.tray.solver.stats.steps;
    while (model.frame.time < seconds - 1e-9) model.step(Math.min(DT, seconds - model.frame.time));
    const t2 = clock(), g = model.tray.solver, steps = g.stats.steps - steps0;
    const r = {id: experiment.id, grains: model.count, dt: g.dt, steps, contacts: g.stats.contacts, pairs: g.stats.pairs, buildMs: +(t1 - t0).toFixed(1), runMs: +(t2 - t1).toFixed(1),
      realTime: +(seconds / ((t2 - t1) / 1000)).toFixed(3), nsPerGrainStep: +((t2 - t1) * 1e6 / (steps * model.count)).toFixed(1), hash: granularHash(g)};
    if (best && best.hash !== r.hash) throw new Error(`${r.id}: two runs differ`);
    if (!best || r.runMs < best.runMs) best = r;
  }
  const r = best;
  results.push(r);
  console.log(`${r.id.padEnd(16)} ${String(r.grains).padStart(5)} grains  ${String(r.steps).padStart(6)} steps  build ${String(r.buildMs).padStart(8)} ms  run ${String(r.runMs).padStart(8)} ms  ${String(r.realTime).padStart(6)}x real time  ${String(r.nsPerGrainStep).padStart(6)} ns/grain-step  ${r.hash.slice(0, 16)}`);
}
if (!only || only.includes('hopper-seesaw')) {
  const {readFile} = await import('node:fs/promises');
  const {resolve} = await import('node:path');
  const {pathToFileURL} = await import('node:url');
  const {NativeWorldPool} = await import('../src/engine/native-world.ts');
  const {hopperSeesawScene} = await import('../src/engine/scene-format.ts');
  const {loadLabScene} = await import('../src/lab/scene-host.ts');
  const {CoupledSceneView} = await import('../src/lab/coupled-scene.ts');
  const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
  const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
  const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));
  const world = pool.createWorld(); world.retainBodyShapes(true);
  const t0 = clock(), loaded = loadLabScene(world, hopperSeesawScene()), view = new CoupledSceneView(loaded, world), t1 = clock();
  const steps = Math.round(seconds * 60);
  for (let i = 0; i < steps; i++) view.step();
  const t2 = clock();
  const r = {id: 'hopper-seesaw', grains: null, steps, buildMs: +(t1 - t0).toFixed(1), runMs: +(t2 - t1).toFixed(1), realTime: +(seconds / ((t2 - t1) / 1000)).toFixed(3), hash: view.stateHash()};
  results.push(r); view.dispose(); world.destroy();
  console.log(`${r.id.padEnd(16)}  (Lab, ${steps} world steps)  build ${r.buildMs} ms  run ${r.runMs} ms  ${r.realTime}x real time  ${String(r.hash).slice(0, 16)}`);
}
pool?.dispose();
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({seconds, threads, clock: wall ? 'wall' : 'cpu', results}, null, 1));
if (check) {
  const base = JSON.parse(readFileSync(check, 'utf8'));
  let bad = 0;
  for (const r of results) { const b = base.results.find(x => x.id === r.id); if (b && b.hash !== r.hash) { bad++; console.error(`HASH CHANGED: ${r.id}`); } else if (b) console.log(`same: ${r.id}  speed-up ${(b.runMs / r.runMs).toFixed(2)}x`); }
  if (base.seconds !== seconds) { console.error('the saved run used another --seconds'); bad++; }
  process.exitCode = bad ? 1 : 0;
}
