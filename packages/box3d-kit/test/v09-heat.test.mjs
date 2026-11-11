// The packaged heat module (box3d-webgpu-kit/heat) against closed-form answers. SI units.
// The full validation suite is tests/engine/heat.test.mjs in the repository; this file checks that
// the published copy is the same solver and gives the same textbook results.
import assert from 'node:assert/strict';
import test from 'node:test';
import {capabilities} from 'box3d-webgpu-kit';
import {HeatSolver, HEAT_SOLVER_ID, thermalShock, restrainedThermalStress} from 'box3d-webgpu-kit/heat';

const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);

test('the heat module is packaged and listed', () => {
  assert.equal(HEAT_SOLVER_ID, 'heat-fv-implicit-js-f64-v1');
  assert.ok(capabilities().modules.includes('heat'));
});

test('a three-layer wall: flux and interface temperatures from the thermal resistances', () => {
  const layers = [{k: 0.7, cells: 10}, {k: 0.04, cells: 5}, {k: 1.4, cells: 15}], h = 0.01;
  const material = layers.flatMap((layer, m) => Array(layer.cells).fill(m));
  const wall = new HeatSolver({
    nx: 30, ny: 1, nz: 1, dx: h, dy: 1, dz: 1, material, temperature: 280,
    materials: layers.map(layer => ({conductivity: layer.k, density: 1800, specificHeat: 900})),
    boundaries: [{face: 'x-', type: 'temperature', temperature: 293.15}, {face: 'x+', type: 'temperature', temperature: 263.15}],
  });
  assert.equal(wall.solveSteady().converged, true);
  const resistance = layers.map(layer => layer.cells * h / layer.k), flux = 30 / resistance.reduce((a, b) => a + b, 0);
  near(wall.boundaryHeatRate(0), flux, 1e-9 * flux, 'heat flux');                      // exact with harmonic-mean faces
  near(wall.faceTemperature(9, 0, 0, 'x+'), 293.15 - flux * resistance[0], 1e-9, 'first interface');
  near(wall.faceTemperature(14, 0, 0, 'x+'), 293.15 - flux * (resistance[0] + resistance[1]), 1e-9, 'second interface');
});

test('a cooling slab follows the first Fourier mode and its energy ledger balances', () => {
  const steel = {conductivity: 50, density: 7800, specificHeat: 500}, alpha = 50 / (7800 * 500), L = 0.1, nx = 40, h = L / nx;
  const rate = alpha * (Math.PI / L) ** 2;
  const slab = new HeatSolver({
    nx, ny: 1, nz: 1, dx: h, dy: 1, dz: 1, materials: [steel], dt: 0.1, scheme: 'crank-nicolson',
    temperature: Float64Array.from({length: nx}, (_, i) => 300 + 100 * Math.sin(Math.PI * (i + 0.5) * h / L)),
    boundaries: [{face: 'x-', type: 'temperature', temperature: 300}, {face: 'x+', type: 'temperature', temperature: 300}],
  });
  const before = slab.storedEnergy();
  slab.step(400);
  const measured = -Math.log((slab.temperature[nx / 2] - 300) / (100 * Math.sin(Math.PI * (nx / 2 + 0.5) * h / L))) / slab.time;
  // The space error of the rate is (pi h / L)^2 / 12 = 5.1e-4; allow 1e-3.
  near(measured, rate, 1e-3 * rate, 'first-mode decay rate alpha (pi/L)^2');
  near(slab.storedEnergy() - before, slab.boundaryEnergy[0] + slab.boundaryEnergy[1], 1e-9 * before, 'energy ledger');
});

test('the explicit scheme refuses a step above its stability limit; thermal stress is -E alpha dT', () => {
  const steel = {conductivity: 50, density: 7800, specificHeat: 500}, h = 0.01, limit = h * h / (6 * 50 / (7800 * 500));
  const block = dt => new HeatSolver({nx: 4, ny: 4, nz: 4, dx: h, dy: h, dz: h, materials: [steel], temperature: 300, dt, scheme: 'explicit'});
  near(block(limit).explicitStabilityLimit(), limit, 1e-12 * limit, 'h^2 / (6 alpha)');
  assert.throws(() => block(limit * 1.01), error => error.code === 'UNSTABLE_TIME_STEP');
  const stress = restrainedThermalStress([343.15], {expansion: 12e-6, youngsModulus: 200e9, reference: 293.15});
  near(stress[0], -120e6, 1e-3, 'restrained bar');
  const shock = thermalShock([300, 480, 300], {expansion: 8e-6, youngsModulus: 370e9, poissonRatio: 0.22, reference: 500, constraint: 'plate', tensileStrength: 300e6});
  assert.deepEqual(Array.from(shock.crackedCells), [0, 2]);
});
