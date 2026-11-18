// The discrete element solver on several threads (src/engine/granular-parallel.ts) gives the results of the single
// thread to the bit, for any number of threads, and checkpoints move between the two:
//  - the Studio tray (linear law, a kinematic gate lifted every step, a cylinder and a ring) for 1 (the split kernels on
//    the calling thread), 2 and 3 threads against the serial loop;
//  - a Hertz case with rolling resistance, a dynamic sphere, a turning kinematic box and grains leaving the bounds;
//  - a save taken while threaded, restored into a solver on one thread, runs on the same.
// The serial loop itself is checked against the solver before the split (the hashes in the bench, scripts/bench-granular.mjs).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
registerHooks({resolve(s, c, next) { if (s.startsWith('.') && !/\.[a-z]+$/i.test(s) && c.parentURL?.endsWith('.ts')) { const u = new URL(s + '.ts', c.parentURL); if (existsSync(u)) return next(u.href, c); } return next(s, c); }});
const {Granular, granularLattice} = await import('../../src/engine/granular.ts');
const {GranularThreads, nodeGranularWorker} = await import('../../src/engine/granular-parallel.ts');
const {GranularTray, grainSI} = await import('../../src/studio/material-labs/granular-si.ts');

function hash(g) {
  const h = createHash('sha256'), add = a => h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength));
  for (const a of [g.positions, g.velocities, g.angularVelocities, g.forces, g.torques]) add(a.subarray(0, 3 * g.grainCount));
  add(Float64Array.from([g.time, g.dissipatedDamping, g.dissipatedFriction, g.externalWork, g.elasticEnergy(), g.kineticEnergy()]));
  h.update(JSON.stringify(g.stats));
  for (let w = 0; w < g.wallCount; w++) for (const a of [g.wallForce(w), g.wallTorque(w), g.wallImpulse(w), g.wallAngularImpulse(w), g.wallPosition(w), g.wallRotation(w)]) add(Float64Array.from(a));
  return h.digest('hex');
}
const pools = new Map();
const pool = async threads => { if (!pools.has(threads)) pools.set(threads, await GranularThreads.create(threads, nodeGranularWorker)); return pools.get(threads); };
test.after(() => { for (const p of pools.values()) p.dispose(); });

test('threads are available in Node', () => assert.equal(GranularThreads.available(), true));

test('the Studio tray: 1, 2 and 3 threads give the serial result to the bit', async () => {
  const run = async threads => {
    const tray = new GranularTray(grainSI('sand'), {diameter: 0.012, fill: 60, opening: 0.12, liftSpeed: 0.12, frictionScale: 1, seed: 7});
    if (threads) tray.solver.useExecutor(await pool(threads));
    for (let i = 0; i < 30; i++) tray.step(1 / 120);
    return {hash: hash(tray.solver), contacts: tray.solver.stats.contacts, rebuilds: tray.solver.stats.rebuilds};
  };
  const serial = await run(0);
  assert.ok(serial.contacts > 100 && serial.rebuilds > 2, 'the run has contacts and rebuilds');
  for (const threads of [1, 2, 3]) assert.deepEqual(await run(threads), serial, `${threads} threads`);
});

test('Hertz grains with rolling resistance, a dynamic sphere, a turning box and removals: 3 threads give the serial result', async () => {
  const build = () => {
    const lattice = granularLattice({min: [-0.06, 0.02, -0.06], max: [0.06, 0.14, 0.06], radius: [0.004, 0.005], gap: 0.05, jitter: 1, seed: 3});
    const g = new Granular({material: {density: 2500, youngModulus: 5e6, poissonRatio: 0.3, restitution: 0.5, friction: 0.4, rollingFriction: 0.05},
      config: {dt: 2e-5, capacity: lattice.count, bounds: {min: [-0.2, -0.05, -0.2], max: [0.2, 0.5, 0.04]}}});
    g.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}});
    g.addWall({shape: {kind: 'plane', normal: [1, 0, 0]}, position: [-0.08, 0, 0]});
    g.addWall({shape: {kind: 'box', halfExtents: [0.03, 0.01, 0.03]}, type: 'kinematic', position: [0.02, 0.01, 0], angularVelocity: [0, 3, 0], linearVelocity: [0.3, 0, 0]});
    g.addWall({shape: {kind: 'sphere', radius: 0.02}, type: 'dynamic', mass: 0.05, position: [0, 0.16, 0], linearVelocity: [0, -1, 0]});
    g.addGrains(lattice.positions, lattice.radii);
    return g;
  };
  const serial = build();serial.step(1500);
  const threaded = build();threaded.useExecutor(await pool(3));threaded.step(1500);
  assert.ok(serial.stats.removed > 0, 'grains left the bounds');
  assert.ok(serial.wallImpulse(3)[1] > 0, 'the sphere was hit');
  assert.equal(hash(threaded), hash(serial));
});

test('a save taken on several threads restores into a solver on one and runs on the same', async () => {
  const make = () => new GranularTray(grainSI('beads'), {diameter: 0.012, fill: 40, opening: 0.12, liftSpeed: 0.2, frictionScale: 1, seed: 11});
  const a = make(), b = make();
  a.solver.useExecutor(await pool(2));
  for (let i = 0; i < 10; i++) a.step(1 / 120);
  const saved = a.solver.saveState(), at = a.time;
  b.solver.restoreState(saved);
  // The tray's own clock and gate: bring b to a's time without stepping its solver (the gate is placed every step).
  Object.assign(b, {time: at});
  b['solverTime'] = a['solverTime'];
  for (let i = 0; i < 10; i++) { a.step(1 / 120); b.step(1 / 120); }
  assert.equal(hash(b.solver), hash(a.solver));
});
