// Speed and exactness of the MAC-grid fluid solvers (src/engine/fluid.ts) on the Studio liquid flume presets
// (src/studio/material-labs/catalog.ts, LABS.liquid.experiments with the flume rig: FreeSurfaceFluid) and the Lab's
// fluid examples (sphere-settling, cavity-flow, flow-past-cylinder: Fluid; dam-break: FreeSurfaceFluid).
//
// For each case: wall time of the build and of a fixed stretch of simulated time on one thread, the speed as simulated
// seconds per wall second ("x real time"), pressure iterations, and a SHA-256 of the state at the end (the solver's
// exact checkpoint for the flume, the Lab's coupled state hash for the examples).
//
//   node scripts/bench-fluid.mjs                    all cases, 1 s of simulated time each
//   node scripts/bench-fluid.mjs --seconds 0.5 --only water-release,cavity-flow
//   node scripts/bench-fluid.mjs --json out.json    write the results
//   node scripts/bench-fluid.mjs --check base.json  fail when a hash differs from a saved run
import {registerHooks} from 'node:module';
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {performance} from 'node:perf_hooks';
/** CPU time of this process, ms (user + system): steadier than wall time on a shared machine. */
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000; };
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
registerHooks({resolve(s, c, next) { if (s.startsWith('.') && !/\.[a-z]+$/i.test(s) && c.parentURL?.endsWith('.ts')) { const u = new URL(s + '.ts', c.parentURL); if (existsSync(u)) return next(u.href, c); } return next(s, c); }});

const args = process.argv.slice(2), flag = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const threads = Number(flag('--threads') ?? 1), wall = args.includes('--wall') || threads > 1;
// Times are CPU time of this process unless --wall (or --threads, whose helpers' CPU time would add up).
const clock = wall ? () => performance.now() : cpu;
const repeat = Number(flag('--repeat') ?? 1), seconds = Number(flag('--seconds') ?? 1), only = flag('--only')?.split(','), jsonOut = flag('--json'), check = flag('--check');
const {LiquidModel, DT} = await import('../src/studio/material-labs/models.ts');
const {LABS, normalizeSettings} = await import('../src/studio/material-labs/catalog.ts');
const {liquidSettings} = await import('../src/studio/material-labs/liquid-config.ts');

/** Observable state of a FreeSurfaceFluid, hashed: particles, grid velocities and pressure, time. */
export function freeSurfaceHash(f) {
  const h = createHash('sha256'), f64 = a => h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  f64(f.positions.subarray(0, 3 * f.count)); f64(f.velocities.subarray(0, 3 * f.count));
  for (const a of f.vel ?? []) f64(a);
  f64(f.p);
  f64(Float64Array.from([f.time]));
  return h.digest('hex');
}

const results = [];
const report = r => {
  results.push(r);
  console.log(`${r.id.padEnd(20)} ${String(r.cells).padStart(6)} cells ${String(r.particles ?? '').padStart(7)} particles  ${String(r.steps).padStart(5)} steps  build ${String(r.buildMs).padStart(7)} ms  run ${String(r.runMs).padStart(8)} ms  ${String(r.realTime).padStart(6)}x real time  ${String(r.iterations ?? '').padStart(6)} it/step  ${String(r.hash).slice(0, 16)}`);
};
const flumeCases = LABS.liquid.experiments.filter(e => liquidSettings(normalizeSettings('liquid', e.settings)).rig === 'flume' && (!only || only.includes(e.id)));
const fastest = (make) => { let best = null; for (let rep = 0; rep < repeat; rep++) { const r = make(); if (best && best.hash !== r.hash) throw new Error(`${r.id}: two runs differ`); if (!best || r.runMs < best.runMs) best = r; } return best; };
for (const experiment of flumeCases) report(fastest(() => {
  const t0 = clock(), model = new LiquidModel({...experiment.settings}), t1 = clock(), f = model.flume.fluid;
  let iterations = 0, last = f.stats.steps;
  const step0 = f.stats.steps;
  // Pressure iterations summed over the steps (the stats hold the last step's).
  while (model.frame.time < seconds - 1e-9) { model.step(Math.min(DT, seconds - model.frame.time)); if (f.stats.steps !== last) { iterations += f.stats.pressureIterations * (f.stats.steps - last); last = f.stats.steps; } }
  const t2 = clock();
  const steps = f.stats.steps - step0; iterations = +(iterations / Math.max(1, steps)).toFixed(1);
  return {id: experiment.id, cells: f.nx * f.ny * f.nz, particles: f.count, steps, buildMs: +(t1 - t0).toFixed(1), runMs: +(t2 - t1).toFixed(1),
    realTime: +(seconds / ((t2 - t1) / 1000)).toFixed(3), iterations, hash: freeSurfaceHash(f)};
}));
const LAB = ['sphere-settling', 'cavity-flow', 'flow-past-cylinder', 'dam-break'].filter(id => !only || only.includes(id));
if (LAB.length) {
  const {NativeWorldPool} = await import('../src/engine/native-world.ts');
  const {COUPLED_EXAMPLE_SCENES} = await import('../src/engine/scene-format.ts');
  const {loadLabScene} = await import('../src/lab/scene-host.ts');
  const {CoupledSceneView} = await import('../src/lab/coupled-scene.ts');
  const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
  const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
  const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));
  for (const id of LAB) report(fastest(() => {
    const world = pool.createWorld(); world.retainBodyShapes(true);
    const t0 = clock(), loaded = loadLabScene(world, COUPLED_EXAMPLE_SCENES[id]()), view = new CoupledSceneView(loaded, world), t1 = clock();
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) view.step();
    const t2 = clock();
    const r = {id, cells: COUPLED_EXAMPLE_SCENES[id]().fluids[0].cells.reduce((a, b) => a * b, 1), particles: null, steps, buildMs: +(t1 - t0).toFixed(1), runMs: +(t2 - t1).toFixed(1),
      realTime: +(seconds / ((t2 - t1) / 1000)).toFixed(3), iterations: null, hash: view.stateHash()};
    view.dispose(); world.destroy(); return r;
  }));
}
if (jsonOut) writeFileSync(jsonOut, JSON.stringify({seconds, clock: wall ? 'wall' : 'cpu', results}, null, 1));
if (check) {
  const base = JSON.parse(readFileSync(check, 'utf8'));
  let bad = 0;
  for (const r of results) { const b = base.results.find(x => x.id === r.id); if (b && b.hash !== r.hash) { bad++; console.error(`HASH CHANGED: ${r.id}`); } else if (b) console.log(`same: ${r.id}  speed-up ${(b.runMs / r.runMs).toFixed(2)}x`); }
  if (base.seconds !== seconds) { console.error('the saved run used another --seconds'); bad++; }
  process.exitCode = bad ? 1 : 0;
}
