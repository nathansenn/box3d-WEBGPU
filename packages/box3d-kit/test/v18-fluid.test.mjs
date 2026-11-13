// Volumetric incompressible flow (box3d-webgpu-kit/fluid) against closed forms, published tables and its own
// conservation laws. SI units throughout. The set-ups live in fluid-scenarios.mjs, which the validation report runs as
// well. Every tolerance below says where it comes from; measured values are printed as diagnostics and recorded in
// docs/FLUID.md. Nothing here depends on wall-clock time.
//
// Facts that set most tolerances:
//  - Central differences on the staggered grid are second order in space; Adams-Bashforth 2 and the projection are second
//    order in time for smooth flow, so the Taylor-Green error falls by about 4 when h and dt halve.
//  - Obstacles are immersed in the grid; their surface is located to first order in the cell size. At 2.4 cells per
//    radius the drag of a sphere is several percent off; the bands say so and docs/FLUID.md gives a finer case.
//  - The projection stops when max |div u| h is 1e-10 of the largest velocity.
//  - The rigid world keeps float32 state: momentum resolves to about 1e-7.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld, capabilities, EngineError} from 'box3d-webgpu-kit';
import {createSimulation} from 'box3d-webgpu-kit/simulation';
import * as fluid from 'box3d-webgpu-kit/fluid';
import * as S from './fluid-scenarios.mjs';

const {Fluid, FreeSurfaceFluid, FluidCoupling, fluidSubsystem, FLUID_SOLVER_ID, FLUID_COUPLING_BACKEND, FREE_SURFACE_SOLVER_ID, FLUID_SUBSYSTEM_ORDER, hasimotoDragFactor, ductVelocity, ductFlowRate, poiseuilleVelocity, sloshingFrequency} = fluid;
const K = {...fluid, createWorld, createSimulation};
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const sci = value => value.toExponential(2);
const order = (coarse, fine) => Math.log2(Math.abs(coarse) / Math.abs(fine));
const periodic = {xMin: 'periodic', xMax: 'periodic', yMin: 'periodic', yMax: 'periodic', zMin: 'periodic', zMax: 'periodic'};

test('the fluid module is listed, names its solvers and checks its options', () => {
  assert.ok(capabilities().modules.includes('fluid'));
  assert.equal(FLUID_SOLVER_ID, 'fluid-mac-projection-mic-pcg-js-f64-v1');
  assert.equal(FLUID_COUPLING_BACKEND, 'rigid-fluid-coupling-fictitious-domain-js-f64-v1');
  assert.equal(FREE_SURFACE_SOLVER_ID, 'fluid-free-surface-apic-mac-js-f64-v1');
  assert.equal(FLUID_SUBSYSTEM_ORDER, 180);
  const base = {cells: [4, 4, 4], spacing: 0.01, density: 1000, viscosity: 1e-3, dt: 1e-3};
  assert.throws(() => new Fluid({...base, boundaries: {xMin: 'periodic'}}), EngineError, 'periodic on one side only');
  assert.throws(() => new Fluid({...base, boundaries: {yMax: {type: 'no-slip', velocity: [0, 1, 0]}}}), EngineError, 'a wall moving along its normal');
  assert.throws(() => new Fluid({...base, boundaries: {xMin: 'inflow'}}), EngineError, 'an inflow without a velocity');
  assert.throws(() => new Fluid({...base, cells: [0, 4, 4]}), EngineError);
  // The closed forms the validation uses, checked against limits they must reach.
  near(ductVelocity(0, 0, 1, 50, 1, 1), 0.5, 1e-8, 'a wide duct is plane Poiseuille flow at its centre (200 terms)');
  near(ductFlowRate(1, 50, 1, 1) / (2 / 3 * 2 * 50), 1 - 0.63 / 50, 2e-3, 'flow rate of a wide duct (the 0.63 a / b edge loss)');
  near(poiseuilleVelocity(0.5, 1, 8, 1), 1, 1e-15, 'Poiseuille centre speed G H^2 / (8 nu)');
  near(hasimotoDragFactor(1e-9), 1, 2e-3, 'Hasimoto: a single sphere in a huge cell has Stokes drag');
  near(sloshingFrequency(1, 1e3) * 2 * Math.PI, Math.sqrt(9.81 * Math.PI), 1e-12, 'deep water: omega^2 = g k');
});

test('time step: the explicit viscous limit and the Courant number are checked, at construction, registration and every step', async () => {
  const options = {cells: [8, 8, 8], spacing: 0.01, density: 1000, viscosity: 1, gravity: [0, 0, 0]};
  const limit = 0.01 ** 2 / (2 * 3 * 1e-3);
  assert.throws(() => new Fluid({...options, dt: 1.01 * limit}), error => error instanceof EngineError && error.code === 'UNSTABLE_TIME_STEP' && /viscous/.test(error.message));
  const ok = new Fluid({...options, dt: limit});
  near(ok.maxTimeStep().viscous, limit, 1e-15, 'h^2 / (2 d nu)');
  assert.equal(new Fluid({...options, dt: 10 * limit, diffusion: 'backward-euler'}).maxTimeStep().viscous, Infinity);
  const forced = new Fluid({...options, dt: 2 * limit, allowUnstable: true});
  assert.equal(forced.stats.unstable, true);
  // A 2D flow has two active axes.
  near(new Fluid({...options, cells: [8, 8, 1], dt: 1e-3, boundaries: {zMin: 'periodic', zMax: 'periodic'}}).maxTimeStep().viscous, 0.01 ** 2 / (4 * 1e-3), 1e-15, '2D limit');
  // An inflow too fast for the step is refused when the subsystem registers; the loop reports the Courant number per step.
  const fast = new Fluid({cells: [8, 4, 1], spacing: 0.01, density: 1000, viscosity: 1e-3, dt: 0.01, gravity: [0, 0, 0], boundaries: {xMin: {type: 'inflow', velocity: [2, 0, 0]}, xMax: 'outflow', zMin: 'periodic', zMax: 'periodic'}});
  assert.throws(() => fast.checkTimeStep(), error => error.code === 'UNSTABLE_TIME_STEP' && /Courant/.test(error.message));
  const world = await createWorld({step: 0.01, ground: false});
  try {
    assert.throws(() => createSimulation(world).add(fluidSubsystem(fast)), error => error.code === 'UNSTABLE_TIME_STEP');
    const slow = new Fluid({cells: [8, 4, 1], spacing: 0.01, density: 1000, viscosity: 1e-3, dt: 0.005, gravity: [0, 0, 0], boundaries: {xMin: {type: 'inflow', velocity: [0.5, 0, 0]}, xMax: 'outflow', zMin: 'periodic', zMax: 'periodic'}});
    const sim = createSimulation(world), events = [];
    sim.add(fluidSubsystem(slow, {id: 'duct'}));
    sim.onEvent(e => events.push(`${e.source}:${e.type}`));
    assert.deepEqual(sim.order().map(row => [row.id, row.stage, row.timing?.substeps ?? null]), [['world', 'rigid', 1], ['duct', 'post', 2], ['events', 'events', null]]);
    for (let i = 0; i < 3; i++) sim.step();
    near(slow.time, 0.03, 1e-15, 'two fluid steps per simulation step');
    near(slow.stats.cfl, 0.5 * 0.005 / 0.01, 1e-3, 'Courant number of the inflow');
    assert.deepEqual(events, []);
    const entry = sim.energy().entries.find(e => e.id === 'duct');
    assert.ok(entry && entry.parts.kinetic > 0 && entry.parts.workByBoundaries > 0, 'energy entry with the work of the open sides');
  } finally { world.dispose(); }
});

test('projection: the divergence left is at the solver tolerance, with walls, an outflow and obstacles', t => {
  const r = S.projection(K);
  t.diagnostic(`max |div u| h / max |u|: ${sci(r.projected)} after one projection, ${sci(r.stepped)} after steps`);
  assert.ok(r.projected <= 1.5e-10 && r.stepped <= 1.5e-10, 'the stopping rule of the solver (1e-10), with the slack of the boundary faces');
  assert.equal(r.unconverged, 0);
});

test('Taylor-Green vortex: decay rate and velocity against the exact solution, second order, energy ledger', t => {
  const runs = [16, 32, 64].map(n => S.taylorGreen(K, {n}));
  const [a, b, c] = runs;
  t.diagnostic(`L2 velocity error ${runs.map(r => sci(r.velocityError)).join(', ')}; rate error ${runs.map(r => sci(r.rate / r.exactRate - 1)).join(', ')}; ledger ${runs.map(r => sci(r.ledger)).join(', ')}`);
  assert.ok(order(a.velocityError, b.velocityError) > 1.9 && order(b.velocityError, c.velocityError) > 1.9, 'second order in h (dt proportional to h)');
  within(b.rate, b.exactRate, 5e-3, 'energy decay rate 4 nu k^2 at 32 cells');
  assert.ok(order(a.rate - a.exactRate, b.rate - b.exactRate) > 1.9, 'the rate converges at second order');
  for (const r of runs) { assert.ok(r.divergence < 1e-9, 'divergence'); assert.ok(Math.abs(r.ledger) < 1e-3, `kinetic + dissipated is constant to ${sci(r.ledger)} of the dissipated energy`); }
  // Upwind advection is first order: still converging, with a larger error.
  const up = S.taylorGreen(K, {n: 32, advection: 'upwind'});
  assert.ok(up.velocityError > 5 * b.velocityError, `upwind ${sci(up.velocityError)} against central ${sci(b.velocityError)}`);
});

test('channels: plane Poiseuille and Couette flow, and a square duct against its series solution', t => {
  const p8 = S.poiseuille(K, {n: 8}), p16 = S.poiseuille(K, {n: 16});
  t.diagnostic(`Poiseuille ${sci(p8.error)} (8 cells), ${sci(p16.error)} (16 cells) of the centre speed`);
  // The discrete steady solution is the parabola shifted by G h^2 / (8 nu): the error is exactly (h / H)^2 of the peak.
  within(p8.error, p8.closedForm, 1e-6, 'Poiseuille error (h / H)^2, 8 cells');
  within(p16.error, p16.closedForm, 1e-6, 'Poiseuille error (h / H)^2, 16 cells');
  const c = S.couette(K);
  assert.ok(c.error < 1e-7, `Couette: a linear profile is exact on this grid (${sci(c.error)})`);
  const d8 = S.squareDuct(K, {n: 8}), d16 = S.squareDuct(K, {n: 16});
  t.diagnostic(`square duct: profile ${sci(d8.error)}, ${sci(d16.error)}; flow rate ${sci(d8.flowRate / d8.exactFlowRate - 1)}, ${sci(d16.flowRate / d16.exactFlowRate - 1)}`);
  assert.ok(order(d8.error, d16.error) > 1.8, 'duct profile second order');
  within(d16.flowRate, d16.exactFlowRate, 0.02, 'duct flow rate at 16 cells');
  near(d16.centreCoefficient, 0.2947, 1e-4, 'u_centre nu / (G a^2) of a square duct (0.2947, from memory)');
});

test('inflow and outflow: a parabolic inflow stays parabolic, loses 8 mu U / H^2 of pressure per metre, and what enters leaves', t => {
  const r = S.channel(K);
  t.diagnostic(`outlet profile ${sci(r.profile)}, pressure gradient ${r.gradient} against ${r.exactGradient}, mass ${sci(r.massError)}`);
  assert.ok(r.profile < 0.01, 'outlet profile within 1% of the peak');
  within(r.gradient, r.exactGradient, 0.02, 'pressure gradient (the discrete parabola is (h/H)^2 off)');
  assert.ok(Math.abs(r.massError) < 1e-8, 'flux in = flux out');
});

test('lid-driven cavity at Re 100 and 400 against Ghia, Ghia & Shin (1982)', t => {
  const re100 = S.cavity(K, {n: 32, re: 100});
  t.diagnostic(`Re 100, 32 x 32: largest |u - u_Ghia| ${sci(re100.uError)}, |v - v_Ghia| ${sci(re100.vError)} of the lid speed (${re100.steps} steps)`);
  assert.ok(re100.uError < 0.005 && re100.vError < 0.012, 'Re 100 centre lines within 0.5% (u) and 1.2% (v) of the lid speed');
  const re400 = S.cavity(K, {n: 48, re: 400, courant: 1, tolerance: 2e-6});
  t.diagnostic(`Re 400, 48 x 48: ${sci(re400.uError)}, ${sci(re400.vError)} (${re400.steps} steps)`);
  assert.ok(re400.uError < 0.025 && re400.vError < 0.025, 'Re 400 centre lines within 2.5% of the lid speed');
});

test('water at rest in a closed tank: no spurious currents, hydrostatic pressure, buoyancy on an immersed sphere', t => {
  const r = S.hydrostatic(K);
  t.diagnostic(`largest speed ${sci(r.speed)} m/s; head ${r.head} Pa against ${r.exactHead}; lift ${r.lift} N against ${r.gridBuoyancy} (grid volume) and ${r.buoyancy} (sphere)`);
  assert.ok(r.speed < 1e-12 * r.scale, 'speed below 1e-12 g dt');
  within(r.head, r.exactHead, 1e-9, 'rho g (L - h) between the bottom and top cell layers');
  within(r.lift, r.gridBuoyancy, 1e-9, 'lift = rho g V of the displaced grid volume');
  within(r.lift, r.buoyancy, 0.06, 'and the sphere volume: the solid fraction ramp adds about h^2 / (4 a^2)');
});

test('Stokes drag on a sphere in a periodic cube against Hasimoto (1959), and the force on a control surface', t => {
  const r = S.stokesDrag(K, {n: 16}), fine = S.stokesDrag(K, {n: 24});
  const e16 = r.measured / r.hasimoto - 1, e24 = fine.measured / fine.hasimoto - 1, p = Math.log(e16 / e24) / Math.log(1.5);
  t.diagnostic(`K = ${r.measured} (16 cells, ${sci(e16)}) and ${fine.measured} (24 cells, ${sci(e24)}) against Hasimoto ${r.hasimoto}, the error falling at order ${p.toFixed(2)}; Re ${sci(r.reynolds)}; control surface ${sci(r.surface / r.force - 1)}, balance ${sci(r.force / r.balance - 1)}`);
  assert.ok(r.reynolds < 0.1, 'Stokes regime');
  within(r.measured, r.hasimoto, 0.1, 'drag factor within 10% at 2.4 cells per radius');
  within(fine.measured, fine.hasimoto, 0.05, 'and within 5% at 3.6 cells per radius');
  assert.ok(p > 1.5, 'converging at about second order');
  within(r.surface, r.force, 0.01, 'momentum flux, pressure and viscous stress on a box around the sphere give the same force');
  within(r.force, r.balance, 2e-3, 'steady: the force equals the body force on the fluid');
});

test('coupling: a sphere of the rigid world settles at the terminal velocity Hasimoto drag gives', async t => {
  const r = await S.settling(K);
  t.diagnostic(`U = ${r.velocity} m/s against ${r.expected} (${sci(r.velocity / r.expected - 1)}), Re ${sci(r.reynolds)}, step ${r.step} s against the response time ${sci(r.responseTime)} s`);
  assert.ok(r.reynolds < 0.1);
  within(r.velocity, r.expected, 0.12, 'terminal velocity within 12% (the drag error of 2.4 cells per radius)');
});

test('coupling: the fluid and a rigid body exchange equal and opposite momentum', async t => {
  const r = await S.momentumExchange(K);
  t.diagnostic(`fluid side ${sci(r.fluidSide)}, total through the world ${sci(r.total)} of the ${sci(r.exchanged)} N s exchanged`);
  assert.ok(r.exchanged > 1e-5);
  assert.ok(r.fluidSide < 1e-12, 'the fluid gains what the body is handed (float64)');
  assert.ok(r.total < 1e-6, 'fluid + body momentum through the float32 world');
});

test('determinism: repeat runs are bit-identical, and the Simulation loop adds nothing', async () => {
  const a = await S.fingerprint(K), b = await S.fingerprint(K), c = await S.fingerprint(K, {simulation: true});
  assert.equal(a.hash, b.hash);
  assert.equal(a.hash, c.hash);
  assert.ok(Math.abs(a.position[1] - 0.015) < 0.005, 'the sphere sank to the ground');
  assert.deepEqual(c.order, ['fluid', 'world', 'events']);
  assert.ok(c.energy.entries[0].parts.dissipated > 0);
  assert.equal(S.freeSurfaceRest(K, {seconds: 0.2}).hash, S.freeSurfaceRest(K, {seconds: 0.2}).hash);
});

test('free surface: a water column collapses as Martin & Moyce (1952) measured', t => {
  const r = S.damBreak(K);
  t.diagnostic(`T at Z = ${S.MARTIN_MOYCE.map(([z]) => z).join(', ')}: ${r.shifted.map(x => x.toFixed(2)).join(', ')} (shifted by ${r.shift.toFixed(3)}); errors ${r.errors.map(e => (100 * e).toFixed(1)).join(', ')} %; volume ${sci(r.volumeChange)}`);
  assert.equal(r.times.length, S.MARTIN_MOYCE.length);
  assert.ok(r.worst < 0.1, 'within 10% of the measured times once both read T = 1.19 at Z = 1.44');
  assert.ok(r.shift > 0, 'without the shift the computed front leads the measured one');
  assert.ok(r.divergence < 1e-9 && Math.abs(r.volumeChange) < 0.06);
});

test('free surface: the first sloshing mode has the frequency of the linear dispersion relation; a tank at rest stays at rest', t => {
  const r = S.sloshing(K);
  t.diagnostic(`f = ${r.frequency} Hz against ${r.expected} (${sci(r.frequency / r.expected - 1)}); amplitude after 3 periods ${r.decay.toFixed(2)} of the first; volume ${sci(r.volumeChange)}`);
  within(r.frequency, r.expected, 0.02, 'sloshing frequency');
  assert.ok(Math.abs(r.volumeChange) < 0.01, 'liquid-cell volume within 1%');
  const rest = S.freeSurfaceRest(K);
  assert.ok(rest.speed < 1e-9 * rest.scale, `still water: ${sci(rest.speed)} m/s`);
  assert.equal(rest.volumeChange, 0);
});

test('free surface, viscous: a film on a no-slip floor slows down as the series solution of u_t = nu u_yy says', t => {
  const r = S.viscousFilmDecay(K);
  t.diagnostic(r.rows.map(x => `t ${x.time.toFixed(3)} s: ${x.measured.toFixed(4)} against ${x.expected.toFixed(4)} (${(100 * x.error).toFixed(2)}%)`).join('; '));
  assert.ok(r.worst < 0.02, 'depth-averaged speed within 2% while it falls to 7% of its start (10 cells across the film)');
});

test('free surface, viscous: a released volume spreads as Huppert (1982) gives, x_N = 1.411 (g q^3 t / 3 nu)^(1/5)', t => {
  const r = S.viscousSpreading(K);
  t.diagnostic(r.late.map(x => `t ${x.time.toFixed(1)} s: ${x.front.toFixed(4)} m against ${x.expected.toFixed(4)} (${(100 * x.error).toFixed(2)}%)`).join('; ') + `; d(x_N^5)/dt ${sci(r.slope)} against ${sci(r.expectedSlope)}`);
  assert.ok(r.worst < 0.02, 'front within 2% from t = 3 s to 6 s');
  within(r.slope, r.expectedSlope, 0.08, 'growth of x_N^5');
  assert.equal(r.particleVolume, 0, 'particles keep their volume exactly');
});

test('free surface, obstacles: a gate holds water and glycerol at rest with the hydrostatic force; a lifting gate releases flow past a post', t => {
  for (const [viscosity, density] of [[0, 998.2], [1.412, 1261.08]]) {
    const r = S.gateHydrostatic(K, {viscosity, density});
    t.diagnostic(`mu ${viscosity} Pa s: gate force ${r.force.toFixed(5)} N against ${r.expected.toFixed(5)} (${sci(r.force / r.expected - 1)}), speed ${sci(r.speed)} m/s`);
    within(r.force, r.expected, 0.01, 'hydrostatic gate force');
    assert.ok(r.speed < 1e-9 * r.scale, 'held liquid stays at rest');
  }
  const a = S.gateRelease(K, {seconds: 0.6}), b = S.gateRelease(K, {seconds: 0.6}), oil = S.gateRelease(K, {seconds: 0.6, viscosity: 0.0797});
  t.diagnostic(`water: front ${a.front.toFixed(3)} m, cells ${sci(a.cellVolumeChange)}, post ${a.peakPost.toFixed(1)} N; olive oil front ${oil.front.toFixed(3)} m`);
  assert.equal(a.inSolid, 0, 'no particle enters a solid cell');
  assert.equal(oil.inSolid, 0);
  assert.equal(a.particleVolumeChange, 0);
  assert.ok(Math.abs(a.cellVolumeChange) < 0.15, 'cells holding particles within 15% while the release splashes against the far wall');
  assert.ok(a.front > 0.55 && a.peakPost > 0, 'the release reaches the post and pushes on it');
  assert.equal(a.hash, b.hash, 'bit-identical repeat');
});
