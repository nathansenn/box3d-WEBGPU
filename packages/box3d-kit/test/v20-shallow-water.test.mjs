// Shallow water on terrain (box3d-webgpu-kit/shallow-water) against closed forms and benchmark solutions, and its own
// conservation laws. SI units throughout. The set-ups live in shallow-water-scenarios.mjs, which the validation report
// runs as well; docs/SHALLOW_WATER.md records the measured values and where each reference was read.
//
// Facts that set most tolerances:
//  - The scheme is second order for smooth flow (MUSCL + Heun) and first order at shocks, shorelines and extrema (the
//    minmod limiter clips there), so the L1 error falls by about 4 per halving of the cells on the subcritical bump and
//    by about 2 on the dam breaks and the moving shoreline.
//  - Well-balancing and the volume budget are exact up to float64 round-off: their bounds are a few hundred ulps.
//  - Manning friction is split (Strang) and solved by backward Euler, so the normal depth carries an O(dt) error.
//  - The rigid world keeps float32 state.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld, capabilities, EngineError} from 'box3d-webgpu-kit';
import {createSimulation} from 'box3d-webgpu-kit/simulation';
import * as sw from 'box3d-webgpu-kit/shallow-water';
import * as S from './shallow-water-scenarios.mjs';

const {ShallowWater, ShallowWaterCoupling, shallowWaterSubsystem, SHALLOW_WATER_SOLVER_ID, SHALLOW_WATER_COUPLING_BACKEND, SHALLOW_WATER_SUBSYSTEM_ORDER} = sw;
const K = {...sw, createWorld, createSimulation};
const below = (actual, bound, label) => assert.ok(actual <= bound, `${label}: got ${actual}, expected <= ${bound}`);
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const sci = value => value.toExponential(2);

test('the shallow-water module is listed, names its solver and checks its options', () => {
  assert.ok(capabilities().modules.includes('shallow-water'));
  assert.equal(SHALLOW_WATER_SOLVER_ID, 'shallow-water-hr-muscl-hll-js-f64-v1');
  assert.equal(SHALLOW_WATER_COUPLING_BACKEND, 'rigid-shallow-water-coupling-js-f64-v1');
  assert.equal(SHALLOW_WATER_SUBSYSTEM_ORDER, 190);
  assert.throws(() => new ShallowWater({cells: [0, 4], spacing: 1}), EngineError);
  assert.throws(() => new ShallowWater({cells: [4, 4], spacing: 1, bed: [1, 2, 3]}), EngineError, 'a bed of the wrong length');
  assert.throws(() => new ShallowWater({cells: [4, 4], spacing: 1, boundaries: {yMin: 'wall'}}), EngineError, 'an unknown side');
  assert.throws(() => new ShallowWater({cells: [4, 4], spacing: 1, boundaries: {xMin: {type: 'inflow'}}}), EngineError, 'an inflow without a discharge');
  assert.throws(() => new ShallowWater({cells: [4, 4], spacing: 1, depth: () => -1}), EngineError, 'a negative depth');
  assert.throws(() => new ShallowWater({cells: [4, 4], spacing: 1, order: 3}), EngineError);
  // The closed forms reach the limits they must.
  near(K.ritterDamBreak(5, 1, {depth: 1, dam: 5})[0], 4 / 9, 1e-15, 'Ritter: h = 4/9 h_l at the dam');
  const [hs] = K.stokerDamBreak(5, 1, {left: 1, right: 1e-12, dam: 5});
  near(hs, 4 / 9, 1e-3, 'Stoker tends to Ritter as h_r -> 0');
  near(K.bumpSteadyDepth(0, 'subcritical'), 2, 2e-3, 'subcritical bump: about h_L far from the bump');
  near(K.greenAmptCumulative(0.5 * K.greenAmptPondingTime(1e-5, S.LOAM), 1e-5, S.LOAM), 0.5 * K.greenAmptPondingTime(1e-5, S.LOAM) * 1e-5, 1e-18, 'before ponding all the rain enters');
});

test('a lake at rest over a bumpy bed stays at rest to round-off, immersed and partly emerged (well-balancing)', () => {
  for (const level of [0.25, 0.15]) {
    const r = S.lakeAtRest(K, {level});
    console.log(`level ${level} m, ${r.dryCells} dry cells: |u| ${sci(r.speed)} m/s, |eta - eta0| ${sci(r.drift)} m after ${r.substeps} substeps`);
    below(r.speed, 1e-12, 'velocity');
    below(r.drift, 1e-14, 'level');
    below(r.volumeError, 1e-14, 'volume');
  }
  assert.ok(S.lakeAtRest(K, {level: 0.15}).dryCells > 100, 'the emerged case has dry cells');
});

test("Ritter's dry dam break: depth profile, wet front, positivity, convergence", () => {
  const coarse = S.ritter(K, {cells: 200}), fine = S.ritter(K, {cells: 400});
  console.log(`L1 ${sci(coarse.error)} (200 cells), ${sci(fine.error)} (400), order ${S.order(coarse.error, fine.error).toFixed(2)}; front ${fine.front.toFixed(3)} m vs ${fine.xFront.toFixed(3)} m (1% of h_l)`);
  below(fine.error, 4e-3, 'L1 error at 400 cells');
  below(Math.abs(fine.front - fine.xFront), 6 * fine.cell, 'wet front within six cells');
  assert.ok(S.order(coarse.error, fine.error) > 0.8, 'first order or better');
  assert.equal(fine.negative, 0, 'no negative depth');
  below(fine.volumeError, 1e-14, 'volume');
});

test("Stoker's wet dam break: depth profile and shock position", () => {
  const coarse = S.stoker(K, {cells: 200}), fine = S.stoker(K, {cells: 400});
  console.log(`L1 ${sci(coarse.error)} (200), ${sci(fine.error)} (400); shock ${fine.shock.toFixed(4)} m vs x_C ${fine.xC.toFixed(4)} m`);
  below(fine.error, 4e-3, 'L1 error');
  below(Math.abs(fine.shock - fine.xC), fine.cell, 'shock within one cell');
  assert.ok(S.order(coarse.error, fine.error) > 0.8);
});

test("Thacker's oscillating paraboloid: moving shoreline over one period, convergence, volume", () => {
  const coarse = S.thacker(K, {cells: 50}), fine = S.thacker(K, {cells: 100});
  console.log(`L1 after one period ${sci(coarse.error)} (50^2), ${sci(fine.error)} (100^2), order ${S.order(coarse.error, fine.error).toFixed(2)}`);
  below(fine.worst, 0.025, 'L1 error at 100 x 100 over one period');
  assert.ok(S.order(coarse.error, fine.error) > 1, 'better than first order');
  below(fine.volumeError, 1e-14, 'volume');
});

test('steady flows over a bump (Goutal and Maurel): subcritical, transcritical, and with a hydraulic jump', () => {
  const sub = S.bump(K, 'subcritical'), sub100 = S.bump(K, 'subcritical', {cells: 100}), trans = S.bump(K, 'transcritical'), shock = S.bump(K, 'shock');
  console.log(`subcritical L1 ${sci(sub.error)} (order ${S.order(sub100.error, sub.error).toFixed(2)}), transcritical ${sci(trans.error)}, with jump ${sci(shock.error)}; jump at ${shock.jump} m vs ${shock.jumpExact.toFixed(3)} m`);
  below(sub.error, 1e-4, 'subcritical');
  assert.ok(S.order(sub100.error, sub.error) > 1.8, 'second order on the smooth subcritical flow');
  below(trans.error, 1e-3, 'transcritical');
  assert.ok(trans.froude > 1.5, 'the flow is supercritical after the crest');
  below(shock.error, 3e-3, 'with a jump');
  below(Math.abs(shock.jump - shock.jumpExact), shock.cell, 'the jump within one cell');
  for (const r of [sub, trans, shock]) below(r.discharge, 0.01, 'the discharge is uniform to 1%');
});

test('Manning: the normal depth of a uniform channel', () => {
  for (const slope of [0.001, 0.01]) {
    const r = S.manning(K, {slope, time: slope === 0.001 ? 6000 : 3000});
    console.log(`S ${slope}: h ${r.depth.toFixed(6)} m vs normal ${r.normal.toFixed(6)} m (${sci(r.depth / r.normal - 1)}), q ${r.discharge.toFixed(6)}, Fr ${r.froude.toFixed(2)}`);
    near(r.depth / r.normal, 1, slope === 0.001 ? 5e-4 : 2e-3, 'normal depth');
    near(r.discharge, r.q, 1e-4, 'discharge');
  }
});

test('rain on a slope: the outflow hydrograph against the kinematic wave', () => {
  const r = S.rainOnSlope(K), coarse = S.rainOnSlope(K, {cells: 200});
  console.log(`rms ${sci(r.rms)} (400 cells), ${sci(coarse.rms)} (200); steady outflow off rL by ${sci(r.steady)}; t_e ${r.te.toFixed(1)} s`);
  below(r.rms, 0.05, 'hydrograph');
  below(r.steady, 1e-4, 'equilibrium outflow = rain x length');
  assert.ok(r.rms < coarse.rms, 'the hydrograph converges');
  below(r.volumeError, 1e-11, 'volume');
});

test('Green-Ampt infiltration against its closed form, with the ponding time', () => {
  const r = S.greenAmpt(K), fine = S.greenAmpt(K, {dt: 1});
  console.log(`|F - F_exact| ${sci(r.worst)} m (dt 10 s), ${sci(fine.worst)} m (dt 1 s); F ${r.final.toFixed(6)} m; ponding ${fine.ponded} s vs ${fine.pondingTime.toFixed(1)} s`);
  below(r.worst, 1e-6 * r.final * 100, 'within 1e-4 of F at dt = 10 s');
  below(fine.worst, r.worst / 10, 'first order or better in dt');
  near(fine.ponded, fine.pondingTime, 2 * fine.dt, 'ponding time');
});

test('the volume budget closes to round-off with every source and side at once', () => {
  const r = S.budget(K);
  console.log(`volume ${r.volume.toFixed(4)} m^3, budget error ${sci(r.error)} m^3 (${sci(r.relative)}); ledger ${JSON.stringify(r.ledger)}`);
  below(r.relative, 1e-12, 'budget');
  assert.ok(r.ledger.inflow > 0 && r.ledger.rain > 0 && r.ledger.infiltrated > 0, 'every term is active');
});

test('determinism and an exact resume from saveState', () => {
  const r = S.resume(K);
  assert.equal(r.a, r.b, 'resumed run');
  assert.equal(r.a, r.repeat, 'repeat run');
});

test('a floating box: Archimedes draft, and the lake rises by the displaced volume', async () => {
  const r = await S.floatingBox(K);
  console.log(`draft ${r.draft.toFixed(4)} m vs ${r.archimedes} m, displaced ${r.submerged.toFixed(5)} m^3 vs ${r.displacedExact}, rise ${sci(r.rise)} m vs ${sci(r.riseExact)} m`);
  near(r.submerged / r.displacedExact, 1, 0.03, 'displaced volume = m / rho (the lake still sloshes)');
  near(r.draft / r.archimedes, 1, 0.03, 'draft');
  near(r.rise / r.riseExact, 1, 0.03, 'level rise');
  below(Math.abs(r.volumeError), 1e-12, 'water volume');
});

test('a sphere in a current: drag carries it towards the water speed, and the impulses balance exactly', async () => {
  const r = await S.drifting(K);
  console.log(`sphere ${r.velocity.toFixed(4)} m/s in water at ${r.water} m/s; impulse on bodies ${r.onBodies.toFixed(6)} N s, on water ${r.onWater.toFixed(6)} N s`);
  assert.ok(r.velocity > 0.8 * r.water && r.velocity < r.water * 1.02, 'carried to within 20% of the current, never past it');
  assert.equal(r.onBodies, -r.onWater, 'third law');
});

test('through a Simulation: bit-identical to stepping by hand, with diagnostics', async () => {
  const r = await S.throughSimulation(K);
  assert.equal(r.simulation, r.manual);
  assert.equal(r.diagnostics.solver, SHALLOW_WATER_SOLVER_ID);
  below(Math.abs(r.diagnostics.volumeError), 1e-13, 'volume');
});

test('a coupled body and the water resume from a Simulation checkpoint bit for bit', async () => {
  const build = async () => {
    const world = await createWorld({step: 1 / 60, subSteps: 4, ground: false, gravity: [0, -9.81, 0]});
    const water = new ShallowWater({cells: [30, 30], spacing: 0.1, bed: (x, z) => 0.05 * x, level: 0.4, dt: 1 / 60, manning: 0.02, boundaries: {xMin: {type: 'inflow', discharge: 0.05}, xMax: 'open'}});
    const coupling = new ShallowWaterCoupling(world, water);
    const box = world.createBody({shape: {kind: 'box', halfExtents: [0.15, 0.08, 0.1]}, position: [1, 0.45, 1.5], density: 400, neverSleeps: true});
    coupling.addBody(box, {shape: {kind: 'box', halfExtents: [0.15, 0.08, 0.1]}});
    return {world, simulation: createSimulation(world).add(shallowWaterSubsystem(coupling, {id: 'river'}))};
  };
  const a = await build(), b = await build();
  try {
    for (let i = 0; i < 60; i++) a.simulation.step();
    const saved = a.simulation.checkpoint();
    for (let i = 0; i < 60; i++) a.simulation.step();
    const expected = a.simulation.checkpoint();
    b.simulation.restore(saved);
    for (let i = 0; i < 60; i++) b.simulation.step();
    const actual = b.simulation.checkpoint();
    assert.equal(Buffer.compare(Buffer.from(actual), Buffer.from(expected)), 0, 'the same bytes');
    const e = a.simulation.energy().entries.find(x => x.id === 'river');
    assert.ok(e.total > 0 && e.parts.potential > 0, 'energy reported');
  } finally { a.world.dispose?.(); b.world.dispose?.(); }
});
