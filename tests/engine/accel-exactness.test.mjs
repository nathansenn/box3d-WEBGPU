// Pins of the states the speed work must not change (docs/GRANULAR.md and docs/FLUID.md, "Cost"). The hashes were taken
// from the solvers before that work (commit 5fc530d) and are asserted here, so a later refactor that changes a bit fails:
//  - the Studio granular tray, every prepared experiment: the state after the 0.3 s settle and 0.1 s of the gate lifting
//    (positions, velocities, spins, contact forces and torques, the energy ledger, the statistics, every wall's loads);
//  - the free-surface solver (dam break of the Lab, and the Studio flume's solver driven in 1/120 s steps, the
//    way the solver was stepped before the flume moved to 1/60 s blocks): particles, grid velocities, pressure;
//  - the volumetric solver with its default MIC(0) pressure solve (the lid-driven cavity of the Lab): velocities,
//    pressure and the checkpoint bytes.
// PRINT=1 prints the hashes instead of asserting them.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
registerHooks({resolve(s, c, next) { if (s.startsWith('.') && !/\.[a-z]+$/i.test(s) && c.parentURL?.endsWith('.ts')) { const u = new URL(s + '.ts', c.parentURL); if (existsSync(u)) return next(u.href, c); } return next(s, c); }});
const {GranularModel, DT} = await import('../../src/studio/material-labs/models.ts');
const {LABS} = await import('../../src/studio/material-labs/catalog.ts');
const {FreeSurfaceFluid, Fluid} = await import('../../src/engine/fluid.ts');
const {encodeState} = await import('../../src/engine/checkpoint.ts');
const PRINT = process.env.PRINT === '1';

const sha = parts => { const h = createHash('sha256'); for (const p of parts) h.update(typeof p === 'string' ? p : new Uint8Array(p.buffer, p.byteOffset, p.byteLength)); return h.digest('hex').slice(0, 32); };
function granularHash(g) {
  const n = g.grainCount, parts = [g.positions, g.velocities, g.angularVelocities, g.forces, g.torques].map(a => a.slice(0, 3 * n));
  parts.push(Float64Array.from([g.time, g.dissipatedDamping, g.dissipatedFriction, g.externalWork, g.elasticEnergy(), g.kineticEnergy()]), JSON.stringify(g.stats));
  for (let w = 0; w < g.wallCount; w++) parts.push(Float64Array.from([...g.wallForce(w), ...g.wallTorque(w), ...g.wallImpulse(w), ...g.wallAngularImpulse(w), ...g.wallPosition(w)]));
  return sha(parts);
}
const check = (label, actual, expected) => { if (PRINT) console.log(`    ${JSON.stringify(label)}: '${actual}',`); else assert.equal(actual, expected, label); };

const TRAY = {
  'sand-avalanche': '5d153d7ecfd7367e4a3dd56eab9e20b7',
  'bead-runout': 'c1762970798f6679ebf6618472f14d6f',
  'coarse-gravel': 'ebcf2e9581c16c66e72fa1813b302c35',
  'angular-pile': '8bde794caa70ca54872b5a13a6cce85d',
  'slow-sluice': '348a752b77bd8c6c37bb31f7f07fdaca',
  'polymer-pellets': 'eb5e71741d2da9be5fb84fe8e50d6499',
  'steel-shot': 'e9cfdd288b42d24a7b93503f33953848',
  'damped-pile': '414136bf1be28059c88b2099c86a853d',
};
test('the Studio granular tray: every prepared experiment gives the pinned state', () => {
  for (const experiment of LABS.granular.experiments) {
    const model = new GranularModel({...experiment.settings});
    while (model.frame.time < 0.1 - 1e-9) model.step(DT);
    check(experiment.id, granularHash(model.tray.solver), TRAY[experiment.id]);
  }
});

const FREE = {dam: '403f30ecedb56758945c2401a2714c56', flume: 'd05c41701bae4d7f28df62f7ea39c57c', flumeViscous: '0b3895153be0921ae4fc405a6466e96e'};
test('the free-surface solver: a dam break and the flume solver give the pinned state', () => {
  const dam = new FreeSurfaceFluid({cells: [20, 12, 6], spacing: 0.03, origin: [-0.3, 0, -0.09], density: 1000, dt: 1 / 120});
  dam.addLiquid((x, y, z) => x < -0.12 && y < 0.3 && z < 0);
  dam.step(40);
  check('dam', sha([dam.positions, dam.velocities, dam.affine, dam.p, ...dam.vel]), FREE.dam);
  for (const [key, viscosity, walls] of [['flume', 0, 'free-slip'], ['flumeViscous', 7.43, 'no-slip']]) {
    // The Studio flume's solver (liquid-si.ts) with a gate lifting at 0.8 m/s, in 1/120 s steps.
    const f = new FreeSurfaceFluid({cells: [48, 9, 16], spacing: 0.125, origin: [-3, 0, -1], density: 1000, viscosity, walls, dt: 1 / 120, gravity: [0, -9.81, 0], cflLimit: 1});
    f.addObstacle({shape: {kind: 'cylinder', radius: 0.2, halfLength: 1.125}, position: [1.25, 0, 0.48]});
    const gate = f.addObstacle({shape: {kind: 'box', halfExtents: [0.05, 1.125, 2]}, position: [-1.07, 1.125, 0]});
    f.addLiquid((x, y) => x < -1.12 ? y < 0.65 : x > -1.02 && y < 0.068);
    for (let s = 1; s <= 24; s++) { const lift = Math.min(1.1, s / 120 * 0.8); f.moveObstacle(gate, [-1.07, 1.125 + lift, 0], [0, lift < 1.1 ? 0.8 : 0, 0]); f.step(); }
    check(key, sha([f.positions, f.velocities, f.affine, f.p, ...f.vel]), FREE[key]);
  }
});

const VOLUME = {cavity: '54ba3bd63a3fe5bb3c07ae1b479e4075', cavityCheckpoint: '0b98b2c86b0a3627b2ef804ef2efe0bf'};
test('the volumetric solver with MIC(0): the lid-driven cavity gives the pinned state and checkpoint bytes', () => {
  const f = new Fluid({cells: [16, 16, 16], spacing: 0.1 / 16, density: 900, viscosity: 0.09, dt: 1 / 240, boundaries: {yMax: {type: 'no-slip', velocity: [0.1, 0, 0]}}});
  f.step(30);
  check('cavity', sha([f.u, f.v, f.w, f.p]), VOLUME.cavity);
  check('cavityCheckpoint', sha([encodeState(f.saveState())]), VOLUME.cavityCheckpoint);
});
