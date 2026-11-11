// Contact, friction and welds between a tetrahedral solid and rigid bodies (box3d-webgpu-kit/solid-contact) against
// closed-form answers. SI units. The set-ups live in solid-contact-scenarios.mjs, which the validation report runs as
// well. Every tolerance below says where it comes from; measured values are printed as diagnostics and recorded in
// docs/SOLID_CONTACT.md. Nothing here depends on wall-clock time.
//
// Four facts set most tolerances:
//  - A uniform strain is in the space of linear tetrahedra, so the pad and column checks are limited by the solve
//    (1e-10 of the force) and by the contact springs, not by the mesh.
//  - A contact is a spring: under a pressure p it is p l / (stiffnessScale (lambda + 2 mu)) deep. The force it
//    carries does not depend on that; the place of the rigid body does.
//  - The rigid solver keeps float32 state: a mass is known to 6e-8 of itself, a position near 0.1 m to 7e-9 m.
//  - Backward Euler turns a mode of angular frequency w by atan(w h) per step and takes (w h)^2 of its energy.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld, capabilities, EngineError} from 'box3d-webgpu-kit';
import {createSimulation} from 'box3d-webgpu-kit/simulation';
import * as solid from 'box3d-webgpu-kit/solid';
import * as contact from 'box3d-webgpu-kit/solid-contact';
import * as S from './solid-contact-scenarios.mjs';

const {SolidContact, SolidCoupling, solidContactSubsystem, SOLID_CONTACT_SOLVER_ID, SOLID_COUPLING_BACKEND, SOLID_CONTACT_SUBSYSTEM_ORDER} = contact;
const {SolidBody, boxMesh} = solid;
const K = {...solid, ...contact, createWorld, createSimulation};
const {G, DT} = S;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const sci = x => Number(x).toExponential(2), pct = x => `${(100 * x).toFixed(2)}%`;
const invalid = (fn, code = 'INVALID_PAYLOAD') => assert.throws(fn, error => error instanceof EngineError && error.code === code);

test('the solid-contact module is listed and names its solver', () => {
  assert.ok(capabilities().modules.includes('solid-contact'));
  assert.equal(SOLID_CONTACT_SOLVER_ID, 'solid-contact-penalty-newton-pcg-js-f64-v1');
  assert.equal(SOLID_COUPLING_BACKEND, 'rigid-solid-coupling-monolithic-js-f64-v1');
  assert.equal(SOLID_CONTACT_SUBSYSTEM_ORDER, 170);
});

test('what it refuses', () => {
  const mesh = boxMesh({size: [1, 1, 1], cells: [1, 1, 1]}), material = {youngModulus: 1e6, poissonRatio: 0.3, density: 1000};
  invalid(() => new SolidContact(new SolidBody({mesh, material, config: {integrator: 'midpoint'}})));
  const c = new SolidContact(new SolidBody({mesh, material}));
  invalid(() => c.addBody({shape: {kind: 'hull', points: []}, type: 'static', position: [0, 0, 0], rotation: [0, 0, 0, 1]}));
  invalid(() => c.addBody({shape: {kind: 'plane', normal: [0, 1, 0]}, type: 'dynamic', mass: 1, position: [0, 0, 0], rotation: [0, 0, 0, 1]}));
  invalid(() => c.addBody({shape: {kind: 'sphere', radius: 1}, type: 'dynamic', position: [0, 3, 0], rotation: [0, 0, 0, 1]}));
  const ball = c.addBody({shape: {kind: 'sphere', radius: 1}, type: 'static', position: [0, 3, 0], rotation: [0, 0, 0, 1]});
  c.weld([0], ball);
  invalid(() => c.weld([0], ball));
  invalid(() => c.weld([99], ball));
  c.unweld([0]);
  assert.equal(c.weldCount, 0);
  // A world that steps at another rate is refused: the coupling exchanges forces with the rigid step.
  const world = {loop: {step: 1 / 60}, gravity: () => [0, -G, 0], getState() {}, applyForce() {}, applyTorque() {}};
  invalid(() => new SolidCoupling(world, new SolidBody({mesh, material, config: {dt: 1 / 240}})));
});

test('a rigid block on an elastic pad: uniaxial stress with free sides, uniaxial strain with held sides', t => {
  for (const model of ['linear', 'corotational']) {
    const free = S.padStatic(K, {mode: 'stress', model}), held = S.padStatic(K, {mode: 'strain', model});
    for (const [label, r] of [['free sides', free], ['held sides', held]]) {
      assert.ok(r.converged, `${label}: the static solve converged`);
      // A uniform strain is in the element space and every node's spring is as stiff as the area it turns to the block,
      // so the springs sink evenly: what is left is the solve tolerance. 1e-8 is a hundred times the measured error.
      within(r.shortening, r.exact, 1e-8, `${model}, ${label}: shortening`);
      // The corotational model reports the Cauchy stress on the deformed area, which differs from m g / A by the lateral strain.
      assert.ok(r.worstStress < (model === 'linear' ? 1e-8 : 3e-3), `${model}, ${label}: every element carries -m g / A (worst ${r.worstStress})`);
      within(r.force, r.weight, 1e-9, `${model}, ${label}: the block is pushed up by its weight`);
      // The block itself sits one contact depth lower: p l / (100 (lambda + 2 mu)), with l measured on the deformed pad.
      within(r.depth, r.expectedDepth, 5e-3, `${model}, ${label}: contact depth`);
      near(r.bodyDrop, r.shortening + r.depth, 1e-12, `${model}, ${label}: block = pad + depth`);
      assert.equal(r.contacts, r.nodes, 'every top node carries load');
    }
    // The two boundary conditions differ by (1 - nu) / ((1 + nu)(1 - 2 nu)) = 1.346: using the wrong one is a 35% error.
    within(free.shortening / held.shortening, (1 - 0.3) / (1.3 * 0.4), 1e-8, `${model}: ratio of the two cases`);
    t.diagnostic(`${model}: free sides ${sci(free.shortening)} m against m g L / (E A) = ${sci(free.exact)} (error ${sci(free.error)}); held sides ${sci(held.shortening)} m against m g L / ((lambda + 2 mu) A) = ${sci(held.exact)} (error ${sci(held.error)}); contact depth ${sci(free.depth)} m`);
  }
});

test('the same pad under a box of the rigid world, in the stepping loop: compression, force, events, energy, repeat runs', async t => {
  const a = await S.padWorld(K), b = await S.padWorld(K), hand = await S.padWorld(K, {loop: false});
  // The box's mass is a float32 (6e-8); the run stops when the motion has died to 1e-9 of the compression.
  within(a.shortening, a.exact, 1e-6, 'pad shortening');
  within(a.force, a.weight, 1e-6, 'force on the box');
  assert.ok(a.speed < 1e-6, `the box is at rest (${a.speed} m/s)`);
  // The world reports the box 5.5e-7 m (one contact depth) below the pad's top, to float32 rounding of 0.1 m.
  near(a.bodyDrop, a.shortening + a.depth, 2e-8, 'box position');
  assert.deepEqual(a.events, ['1:contact-begin']);
  assert.deepEqual(a.order, ['solid-contact', 'world', 'events']);
  assert.equal(a.unconverged, 0);
  // Ledger: the box did m g x on the pad on its way down; backward Euler and the damping only take energy out.
  assert.ok(a.entry.exchanged > a.entry.total && a.entry.total > 0, 'work went in and part of it was dissipated');
  assert.ok(a.worstBalanceRise <= 1e-9 * a.entry.exchanged, `total - exchanged never rises (largest rise ${a.worstBalanceRise} J)`);
  within(a.entry.parts.strain, 0.5 * a.weight * a.shortening, 1e-5, 'strain energy = F x / 2');
  // Determinism: a repeat run and a hand-driven run (coupling.step(); world.step()) end on the same bits.
  assert.equal(a.hash, b.hash); assert.equal(a.bits, b.bits);
  assert.equal(a.hash, hand.hash); assert.equal(a.bits, hand.bits);
  t.diagnostic(`box of ${a.mass.toFixed(4)} kg at 240 Hz: pad ${sci(a.shortening)} m against ${sci(a.exact)} (error ${sci(a.error)}); force ${a.force.toFixed(5)} N against ${a.weight.toFixed(5)}; speed ${sci(a.speed)} m/s; largest rise of total - exchanged ${sci(a.worstBalanceRise)} J of ${sci(a.entry.exchanged)} J; repeat and hand-driven runs bit-identical`);
});

test('Hertz: a rigid sphere pressed into an elastic block, with the mesh study', t => {
  const runs = [[8, 4], [12, 6], [16, 8]].map(([n, m]) => S.hertz(K, n, m));
  for (const r of runs) assert.ok(r.converged, `n = ${r.n} converged`);
  // Linear tetrahedra and node-against-sphere contact are too stiff, and the block is 20 contact radii deep, not a
  // half space: a bonded layer of that depth is 4.6% stiffer than Hertz (Dimitriadis et al. 2002). Against Hertz times
  // that factor the measured errors are +16.3%, +9.4% and +6.8% at 2.5, 3.75 and 5 elements per contact radius;
  // the bounds are those plus a margin. Always too stiff.
  const bounds = [0.18, 0.11, 0.08];
  runs.forEach((r, i) => assert.ok(r.errorLayer > 0 && r.errorLayer < bounds[i], `n = ${r.n}: ${r.errorLayer} against the bound ${bounds[i]}`));
  assert.ok(runs[0].errorLayer > runs[1].errorLayer && runs[1].errorLayer > runs[2].errorLayer, 'the error falls with the mesh');
  // The contact springs are 5e-7 m deep under a 6.25e-4 m indentation: 0.1%, not what limits this.
  assert.ok(runs[2].depth < 2e-3 * runs[2].delta);
  // The exponent: force against indentation over a factor of three, on the 12-cell mesh.
  const sweep = S.hertzExponent(K, 12, 7, [0.0002, 0.00033, 0.00045, 0.000625]);
  // 1.5 for a half space; measured 1.56 (1.54 with the layer factor divided out). 0.08 covers it with a margin.
  near(sweep.exponent, 1.5, 0.08, 'exponent of F against delta');
  t.diagnostic(`F against (4/3) E* sqrt(R) delta^1.5 = ${runs[0].exact.toFixed(3)} N: ${runs.map(r => `${r.nodes} nodes (${r.cellsPerRadius} cells per contact radius, ${r.contacts} nodes in contact) ${pct(r.error)}, against the bonded layer ${pct(r.errorLayer)}`).join('; ')}; exponent ${sweep.exponent.toFixed(3)} (${sweep.exponentLayer.toFixed(3)} without the layer factor)`);
});

test('Coulomb friction on a deformable incline: sticks below tan(theta) = mu, slides at g (sin - mu cos) above', async t => {
  const below = await S.incline(K, 26), above = await S.incline(K, 27.5);
  // mu = 0.5 is 26.57 degrees. At 26 degrees (tan = 0.488) the box must not creep at all once it has settled: the
  // stick spring holds a fixed point. Float32 resolves its position to 6e-8 m.
  assert.ok(below.tanTheta < below.mu && above.tanTheta > above.mu);
  assert.ok(Math.abs(below.travelAfterSettling) < 1e-7, `no creep below (moved ${below.travelAfterSettling} m in 0.75 s)`);
  assert.ok(below.speed < 1e-6, 'at rest below');
  within(below.ratio, below.tanTheta, 1e-5, 'below: friction / normal = tan(theta), under the limit');
  within(below.normalForce, below.weightNormal, 1e-5, 'below: normal force = m g cos(theta)');
  // At 27.5 degrees (tan = 0.521) it slides; the acceleration is fitted over 0.75 s. Measured 0.4% from the closed
  // form: the friction limit of each node follows its normal force to 1e-4 and the box rocks a little on the nodes.
  within(above.acceleration, above.expected, 0.02, 'above: acceleration');
  within(above.ratio, above.mu, 1e-3, 'above: friction / normal = mu');
  assert.equal(below.unconverged + above.unconverged, 0);
  t.diagnostic(`mu = 0.5: at 26 deg (tan ${below.tanTheta.toFixed(4)}) moved ${sci(below.travelAfterSettling)} m after settling, friction / normal ${below.ratio.toFixed(5)}; at 27.5 deg (tan ${above.tanTheta.toFixed(4)}) acceleration ${above.acceleration.toFixed(5)} m/s^2 against ${above.expected.toFixed(5)} (error ${pct(above.acceleration / above.expected - 1)}), friction / normal ${above.ratio.toFixed(5)}`);
});

test('a mass on an elastic column swings at the frequency of a bar with a tip mass', async t => {
  const r = await S.column(K), fine = await S.column(K, {hz: 480});
  // Exact: omega = x c / L with x tan x = (column mass) / (block mass). Eight lumped-mass cells along the bar lower
  // it by about 0.1%; backward Euler alone would lower it by (omega h)^2 / 3 = 0.24% at 240 Hz, but the block is
  // moved by the rigid step, which is not backward Euler, and the measured shift is smaller. Measured -0.14% at
  // 240 Hz and -0.12% at 480 Hz; the bound is 0.4%.
  within(r.measured, r.exact, 4e-3, 'frequency at 240 Hz');
  within(fine.measured, fine.exact, 4e-3, 'frequency at 480 Hz');
  // The column's own mass matters: a massless spring would give a frequency 10% higher.
  assert.ok(r.massless / r.exact > 1.09);
  assert.ok(Math.abs(r.measured / r.massless - 1) > 0.08, 'the massless formula is told apart');
  // The block stays on the column: it rests there, it is not welded.
  assert.ok(r.leastContacts >= 4, 'contact is kept through the swing');
  assert.equal(r.unconverged, 0);
  t.diagnostic(`block ${r.bodyMass} kg on a ${r.columnMass} kg column: ${r.measured.toFixed(4)} Hz at 240 Hz (error ${pct(r.error)}), ${fine.measured.toFixed(4)} Hz at 480 Hz (error ${pct(fine.error)}), exact ${r.exact.toFixed(4)} Hz, Rayleigh M + m/3 ${r.rayleigh.toFixed(4)} Hz, massless spring ${r.massless.toFixed(4)} Hz; backward-Euler prediction ${r.backwardEuler.toFixed(4)} Hz`);
});

test('welds: a hanging weight stretches its bar by M g L / (E A) + rho g L^2 / (2 E), and a welded end is a clamped end', async t => {
  const r = await S.hangingWeld(K), clamped = await S.hangingWeld(K, {nu: 0.3}), swing = await S.column(K, {welded: true});
  // With nu = 0 the welded face has nothing to restrain and the bar is in uniaxial stress. What is left is the weld
  // springs' own stretch (force / stiffness) and the float32 mass: measured 4e-6.
  within(r.stretch, r.exact, 5e-5, 'stretch, nu = 0');
  within(r.force, r.weight, 1e-5, 'the bar pulls the block up by its weight');
  within(r.support, r.totalWeight, 1e-5, 'the support carries the block and the bar');
  assert.ok(r.speed < 1e-5 && r.tilt < 1e-5, 'the block hangs still and straight');
  // With nu = 0.3 the weld holds the end face's width, as a rigid plate glued to it would: 1.4% stiffer here.
  assert.ok(clamped.error < -0.005 && clamped.error > -0.03, `a welded end restrains the Poisson contraction (${clamped.error})`);
  // The same restraint raises the frequency of the welded block on the column by 0.5%.
  within(swing.measured, swing.exact, 0.012, 'welded block on the column');
  assert.ok(swing.measured > swing.exact);
  t.diagnostic(`hanging ${r.mass.toFixed(3)} kg: stretch ${sci(r.stretch)} m against ${sci(r.exact)} (error ${sci(r.error)}), force ${r.force.toFixed(5)} N; with nu = 0.3 the welded end is stiffer, error ${pct(clamped.error)}; welded block on the column ${swing.measured.toFixed(4)} Hz (${pct(swing.error)})`);
});

test('momentum in a free impact: to rounding with float64 bodies, to float32 through the rigid world', async t => {
  const own = S.impact(K, {steps: 120}), world = await S.impactWorld(K, {steps: 120});
  assert.ok(own.touched >= 5 && world.touched >= 3, 'the ball hit the block');
  // Every spring pulls its node and its body with the same force, the internal forces of the mesh sum to zero, and
  // the ball takes exactly the force of the solve; what is left is the residual of the nodes' solve, 1e-12 of the
  // largest force, times the step. Measured 1.4e-12 of the ball's momentum.
  assert.ok(own.worst < 2e-11, `float64: momentum changed by ${own.worst} of the ball's`);
  // Through the world the ball's velocity is a float32 and the rigid step rounds each update: measured 1.2e-7.
  assert.ok(world.worst < 2e-6, `float32 world: momentum changed by ${world.worst}`);
  assert.equal(own.unconverged, 0);
  // Backward Euler and friction take energy; they must not add any.
  assert.ok(own.energyLeft < 1 && own.energyLeft > 0.1);
  t.diagnostic(`ball 3 kg at 2.06 m/s into a free 8 kg block, friction 0.4: momentum error ${sci(own.worst)} with float64 bodies, ${sci(world.worst)} through the float32 world; ${pct(own.energyLeft)} of the kinetic energy left`);
});

test('mass ratios: a light body on a stiff solid and a heavy body on a soft one stay put; naive staggering throws the light one off', async t => {
  // 4 g on a steel block (contact stiffness times h^2 over the body's mass: 7e8) and 80 kg on a 2 kg pad of E = 2e5 Pa.
  const light = await S.resting(K, {E: 2e11, density: 1}), light60 = await S.resting(K, {E: 2e11, density: 1, hz: 60});
  const heavy = await S.resting(K, {E: 2e5, density: 20000, hz: 60, seconds: 3});
  const naive = await S.resting(K, {E: 2e11, density: 1, scheme: 'naive-staggered'}), naiveHeavy = await S.resting(K, {E: 2e5, density: 20000, scheme: 'naive-staggered'});
  for (const [label, r] of [['240 Hz', light], ['60 Hz', light60]]) {
    assert.equal(r.failed, null);
    assert.ok(r.largestSpeed < 1e-5, `light body, ${label}: never faster than ${r.largestSpeed} m/s`);
    assert.ok(Math.abs(r.sink) < 1e-8 && r.largestRise < 1e-8, `light body, ${label}: stays where it was put`);
    within(r.force, r.weight, 1e-5, `light body, ${label}: carried by its weight`);
    assert.ok(r.largestForceOverWeight < 1.001, `light body, ${label}: the force never overshoots`);
    assert.equal(r.unconverged, 0);
  }
  // The heavy body is dropped on from touching, so it overshoots (a suddenly applied load: at most twice the weight)
  // and backward Euler at 60 Hz damps it to rest on m g L / (E A)-like compression.
  assert.equal(heavy.failed, null);
  assert.ok(heavy.largestForceOverWeight < 2.001 && heavy.largestRise <= 0, 'heavy body: bounded, never thrown up');
  within(heavy.force, heavy.weight, 1e-3, 'heavy body: comes to rest carried by its weight');
  assert.ok(heavy.speed < 1e-4);
  // Handing the solid's force to a body that was moved without it: the light body is thrown off in the first steps.
  assert.equal(naive.failed, 'thrown-off');
  assert.ok(naive.ran <= 3 && naive.largestForceOverWeight > 1e6);
  // The naive scheme is an explicit spring on the body: stable only while stiffness h^2 / mass is small, as for the heavy body (0.03).
  assert.equal(naiveHeavy.failed, null);
  assert.ok(naiveHeavy.stepNumber < 0.1 && naive.stepNumber > 1e8);
  t.diagnostic(`4 g on steel (k h^2 / m = ${sci(light.stepNumber)}): largest speed ${sci(light.largestSpeed)} m/s at 240 Hz, ${sci(light60.largestSpeed)} at 60 Hz, force / weight at most ${light.largestForceOverWeight.toFixed(6)}; naive staggering: ${sci(naive.largestSpeed)} m/s after ${naive.ran} step(s), force ${sci(naive.largestForceOverWeight)} weights. 80 kg on a 2 kg soft pad at 60 Hz: force / weight at most ${heavy.largestForceOverWeight.toFixed(3)}, at rest ${sci(heavy.speed)} m/s; naive there is stable (k h^2 / m = ${naiveHeavy.stepNumber.toFixed(3)})`);
});

test('a solid resting on a body that rests on rigid ground weighs what it should', async t => {
  const r = await S.supported(K), blind = await S.supported(K, {estimateSupports: false});
  // The box under the block is held up by the rigid world's own contact, which the coupling only sees through the
  // estimate of the box's supports. The force on the box must be the block's weight either way; float32 mass and
  // the settling leave 1e-6.
  within(r.force, -r.weight, 1e-5, 'force on the box');
  within(blind.force, -blind.weight, 1e-4, 'force on the box, no support estimate');
  assert.ok(r.boxSpeed < 1e-5 && r.solidSpeed < 1e-5, 'both at rest');
  t.diagnostic(`4 kg block on a box on rigid ground: force on the box ${r.force.toFixed(5)} N against ${(-r.weight).toFixed(5)} (error ${sci(r.error)}); without the support estimate error ${sci(blind.error)}`);
});

test('the other shapes: a free cube on a ground plane, and a capsule on a pad', t => {
  const {plane, capsule} = S.planeAndCapsule(K);
  assert.ok(plane.converged && capsule.converged);
  // The plane is the only thing that holds the cube: it must carry exactly the weight, on every bottom node.
  within(plane.force, -plane.weight, 1e-9, 'force on the plane');
  assert.ok(plane.sideways < 1e-9 * plane.weight);
  assert.equal(plane.contacts, plane.bottomNodes);
  // With nu = 0, under its own weight on a frictionless plane, the cube is a bar standing on its end:
  // rho g L^2 / (2 E). Measured -0.36 % on 4 cells: the lumped weights of a tetrahedral cross-section are not uniform.
  within(plane.shortening, plane.exactShortening, 8e-3, 'shortening of the cube');
  // The capsule is carried by its weight, with no sideways force or torque left.
  within(capsule.force, capsule.weight, 1e-9, 'force on the capsule');
  assert.ok(capsule.sideways < 1e-8 * capsule.weight && capsule.torque < 1e-8 * capsule.weight);
  // Only nodes are tested: a cylinder cannot balance on one row of them, so it rolls half a node spacing and sits
  // on two rows, lower by the chord's sagitta R - sqrt(R^2 - (s / 2)^2) plus the pad's own dent.
  near(capsule.rolled, capsule.spacing / 2, 1e-3, 'it settles between two rows of nodes');
  assert.ok(capsule.widest <= 0.51 * capsule.spacing + 1e-3 && capsule.longest <= capsule.reach, 'the carrying nodes are under it');
  assert.ok(capsule.sink > capsule.chordDrop && capsule.sink < capsule.chordDrop + 2e-4, `sink ${capsule.sink} against the sagitta ${capsule.chordDrop}`);
  t.diagnostic(`cube on a plane: force ${plane.force.toFixed(6)} N against ${(-plane.weight).toFixed(6)}, shortening ${sci(plane.shortening)} m against ${sci(plane.exactShortening)} (${pct(plane.shortening / plane.exactShortening - 1)}), contact depth ${sci(plane.depth)} m; capsule on a pad: force ${capsule.force.toFixed(6)} N against ${capsule.weight.toFixed(6)}, rolled ${sci(capsule.rolled)} m onto two rows ${sci(capsule.spacing)} m apart, ${capsule.carrying} nodes carry it, sink ${sci(capsule.sink)} m (sagitta ${sci(capsule.chordDrop)} m)`);
});
