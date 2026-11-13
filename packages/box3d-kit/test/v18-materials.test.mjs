// The material library (box3d-webgpu-kit/materials) as the package publishes it: the same data and helpers as the
// repository source, and the steel-on-steel values in the rigid world against the closed forms of sliding friction
// and restitution. The rigid scenario is the one the validation report runs (validation/domains/materials.mjs).
// SI units. Nothing here depends on wall-clock time.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld, capabilities, EngineError} from 'box3d-webgpu-kit';
import * as M from 'box3d-webgpu-kit/materials';
import {solidMaterial as repoSolidMaterial} from '../../../src/engine/materials.ts';
import {rigidSteel, RIGID} from '../../../validation/domains/materials.mjs';
import {SolidBody, boxMesh} from 'box3d-webgpu-kit/solid';
import {HeatSolver} from 'box3d-webgpu-kit/heat';
import {Granular} from 'box3d-webgpu-kit/granular';
import {FractureBody} from 'box3d-webgpu-kit/fracture';

const G = 9.81;

test('the materials subpath publishes the library, its helpers and its version', () => {
  assert.ok(capabilities().modules.includes('materials'));
  assert.match(M.MATERIAL_LIBRARY_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(M.materialIds().length, 32);
  assert.deepEqual(M.solidMaterial('structural-steel-s355'), repoSolidMaterial('structural-steel-s355'), 'the packaged copy is the repository source');
  assert.equal(M.materialAudit().length, 332);
  assert.throws(() => M.material('unobtainium'), error => error instanceof EngineError && error.code === 'INVALID_PAYLOAD');
  for (const source of Object.values(M.MATERIAL_SOURCES)) assert.match(source.url, /^https:\/\//);
});

test('the helpers\' outputs are accepted by the packaged solvers', () => {
  const body = new SolidBody({mesh: boxMesh({size: [1, 0.1, 0.1], cells: [4, 1, 1]}), material: M.solidMaterial('aluminium-6061-t6')});
  assert.equal(body.material.youngModulus, 68.9e9);
  const fracture = new FractureBody({mesh: boxMesh({size: [1, 0.1, 0.1], cells: [4, 1, 1]}), material: M.solidMaterial('soda-lime-glass'), fracture: M.fractureLaw('soda-lime-glass')});
  assert.ok(fracture.tetCount > 0);
  const heat = new HeatSolver({nx: 4, ny: 1, nz: 1, dx: 0.01, dy: 1, dz: 1, materials: [M.heatMaterial('copper-c11000'), M.heatMaterial('water'), M.heatMaterial('air')], temperature: 293.15, dt: 1});
  heat.step();
  const grains = new Granular({material: M.grainMaterial('glass-beads'), config: {dt: 1e-7, capacity: 1}});
  grains.addGrain([0, 0, 0], 0.001);
  assert.ok(Math.abs(grains.masses[0] / (2500 * 4 / 3 * Math.PI * 1e-9) - 1) < 1e-12);
});

test('with the library steel-on-steel values a block slides to v0^2 / (2 mu_k g) and a ball rebounds to e^2 h', async () => {
  const r = await rigidSteel(M, createWorld);
  assert.deepEqual([r.pair.kineticFriction, r.pair.restitution, r.pair.impactSpeed], [0.3, 0.56, [3.13, 4.43]]);
  const impact = Math.sqrt(2 * G * RIGID.drop);
  assert.ok(impact >= r.pair.impactSpeed[0] && impact <= r.pair.impactSpeed[1], `the drop hits at ${impact} m/s, inside the measured range`);
  assert.ok(Math.abs(r.distance / r.stopping - 1) <= 0.01, `sliding distance ${r.distance} against ${r.stopping}`);
  // One 240 Hz step of gravity is 1% of the impact speed: the rebound reads about 2% low.
  assert.ok(Math.abs(r.peak / r.rebound - 1) <= 0.03, `rebound ${r.peak} against ${r.rebound}`);
});
