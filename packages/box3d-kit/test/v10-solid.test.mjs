// The packaged tetrahedral solid solver (box3d-webgpu-kit/solid) against closed-form answers.
// The full validation suite is tests/engine/solid.test.mjs in the repository; this file proves
// the published module is that solver.
import assert from 'node:assert/strict';
import test from 'node:test';
import {SolidBody, SOLID_SOLVER_ID, boxMesh} from 'box3d-webgpu-kit/solid';
import {EngineError, capabilities} from 'box3d-webgpu-kit';

const steel = {youngModulus: 200e9, poissonRatio: 0.3, density: 7850};
const near = (a, b) => Math.abs(a - b) < 1e-9;
const close = (actual, expected, relative) => assert.ok(Math.abs(actual - expected) <= relative * Math.abs(expected), `${actual} != ${expected}`);

test('the solid module is listed and identifies its solver', () => {
  assert.ok(capabilities().modules.includes('solid'));
  assert.equal(SOLID_SOLVER_ID, 'solid-tet-corot-js-f64-v1');
});

test('a steel bar in tension stretches by F L / (E A) and carries F / A', () => {
  const L = 2, w = 0.1, F = 5e4;
  for (const model of ['linear', 'corotational', 'neo-hookean']) {
    const bar = new SolidBody({mesh: boxMesh({size: [L, w, w], cells: [8, 2, 2]}), material: steel, config: {model, tolerance: 1e-12}});
    bar.constrain(bar.selectNodes(x => near(x, 0)), [0, null, null]);
    bar.constrain(bar.selectNodes((x, y) => near(y, 0)), [null, 0, null]);
    bar.constrain(bar.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]);
    bar.addTraction(bar.selectFaces((cx, cy, cz, nx) => nx > 0.999), [F / (w * w), 0, 0]);
    const result = bar.solveStatic();
    assert.ok(result.converged);
    // The finite-strain models agree with Hooke's law to first order in the strain (2.5e-5 here).
    const tolerance = model === 'linear' ? 1e-9 : 1e-4;
    for (const n of bar.selectNodes(x => near(x, L))) close(result.displacements[3 * n], F * L / (steel.youngModulus * w * w), tolerance);
    close(bar.stresses()[0], F / (w * w), tolerance);
    assert.equal(bar.failedElements({criterion: 'von-mises', strength: 250e6}).length, 0);
  }
});

test('a bar rings at sqrt(E / rho) / (4 L), and an explicit step above the stability limit is refused', () => {
  const L = 1, w = 1 / 16, mesh = boxMesh({size: [L, w, w], cells: [16, 1, 1]}), material = {...steel, poissonRatio: 0};
  const bar = new SolidBody({mesh, material, config: {model: 'linear'}});
  bar.constrain(bar.selectNodes(x => near(x, 0)));
  bar.constrain(bar.selectNodes(() => true), [null, 0, 0]);
  close(bar.fundamentalMode().frequency, Math.sqrt(steel.youngModulus / steel.density) / (4 * L), 1e-3);
  const dt = 2 * bar.explicitLimit().criticalTimeStep;
  assert.throws(() => new SolidBody({mesh, material, config: {integrator: 'explicit', dt}}), error => error instanceof EngineError && error.code === 'UNSTABLE_TIME_STEP');
});
