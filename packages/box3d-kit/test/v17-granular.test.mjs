// Granular media by the discrete element method (box3d-webgpu-kit/granular) against closed-form answers and
// the two classic silo laws. SI units throughout. The set-ups live in granular-scenarios.mjs, which the
// validation report runs as well. Every tolerance below says where it comes from; measured values are printed
// as diagnostics and recorded in docs/GRANULAR.md. Nothing here depends on wall-clock time.
//
// Four facts set most tolerances:
//  - Velocity Verlet is second order: halving the step divides the error of an elastic impact by four.
//  - A soft-sphere contact has a finite overlap. Closed forms for rigid spheres (rebound angles, rolling)
//    hold to about the overlap over the radius, which the two-body cases keep below 1e-3.
//  - The bulk cases (Janssen, Beverloo, repose) use a few hundred to a few thousand beads so that the gate
//    stays short. They fluctuate by several percent from one packing to the next; their bands are wide and
//    say so. docs/GRANULAR.md records what larger runs gave.
//  - The rigid world keeps float32 state: a force of 1 N resolves 1e-7 N.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld, axisRotation, capabilities, EngineError} from 'box3d-webgpu-kit';
import {createSimulation} from 'box3d-webgpu-kit/simulation';
import * as granular from 'box3d-webgpu-kit/granular';
import * as S from './granular-scenarios.mjs';

const {Granular, GranularCoupling, granularSubsystem, granularLattice, granularDampingCoefficient, rayleighTime, hertzContactDuration, GRANULAR_SOLVER_ID, GRANULAR_COUPLING_BACKEND, GRANULAR_SUBSYSTEM_ORDER, GRANULAR_TIME_STEP_LIMIT, HERTZ_DURATION_FACTOR} = granular;
const K = {...granular, createWorld, createSimulation, axisRotation};
const {G, DT, BEAD} = S;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const sci = value => value.toExponential(2);
const order = (coarse, fine) => Math.log2(Math.abs(coarse) / Math.abs(fine));
const R = 0.005;

test('the granular module is listed and names its solver', () => {
  assert.ok(capabilities().modules.includes('granular'));
  assert.equal(GRANULAR_SOLVER_ID, 'granular-dem-soft-sphere-verlet-js-f64-v1');
  assert.equal(GRANULAR_COUPLING_BACKEND, 'rigid-granular-coupling-subcycled-js-f64-v1');
  // The Hertz duration constant is 2 * integral of dx / sqrt(1 - x^(5/2)); check it by quadrature (x = sin(u^(5/4))^(4/5) removes the singularity).
  let sum = 0; const n = 2000, top = (Math.PI / 2) ** 0.8;
  for (let i = 0; i < n; i++) { const u = (i + 0.5) * top / n; sum += Math.sin(u ** 1.25) ** -0.2 * u ** 0.25 * top / n; }
  near(2 * sum, HERTZ_DURATION_FACTOR, 1e-7, 'Hertz duration factor');
  near(hertzContactDuration(1, 1, 1, 1), HERTZ_DURATION_FACTOR * (15 / 16) ** 0.4, 1e-12, 'duration = factor * delta_max / v');
});

test('time step: the critical time is documented, an unstable step is refused, and allowUnstable warns instead', () => {
  const material = {...BEAD, restitution: 0.5}, critical = rayleighTime(R, material.density, material.youngModulus, material.poissonRatio);
  const stable = new Granular({material, config: {dt: 0.2 * critical, capacity: 4}});
  near(stable.criticalTimeFor(R), critical, 1e-15, 'Hertz: the critical time is the Rayleigh time');
  near(critical, Math.PI * R * Math.sqrt(material.density / (material.youngModulus / 2.6)) / (0.1631 * 0.3 + 0.8766), 1e-12, 'Rayleigh time formula');
  stable.addGrain([0, 0, 0], R);
  near(stable.timeStepFraction, 0.2, 1e-12, 'fraction of the critical time');
  // A smaller grain has a shorter critical time: the same step is now too long for it.
  assert.throws(() => stable.addGrain([1, 0, 0], 0.4 * R), error => error instanceof EngineError && error.code === 'UNSTABLE_TIME_STEP' && /critical time/.test(error.message));
  assert.equal(stable.grainCount, 1, 'the refused grain was not added');
  const linear = new Granular({material: {density: 2500, restitution: 0.5, friction: 0}, config: {dt: 1e-6, capacity: 2, law: 'linear', normalStiffness: 1e4}});
  const mass = 2500 * 4 / 3 * Math.PI * R ** 3;
  near(linear.criticalTimeFor(R), Math.PI * Math.sqrt(mass / 2 / 1e4), 1e-15, 'linear: the critical time is the contact duration of two such grains');
  assert.deepEqual({...GRANULAR_TIME_STEP_LIMIT}, {hertz: 0.4, linear: 0.2});
  const forced = new Granular({material, config: {dt: 0.6 * critical, capacity: 2, allowUnstable: true}});
  forced.addGrain([0, 0, 0], R);
  assert.equal(forced.stats.unstable, true);
  // The same refusal reaches the stepping loop: a subsystem built on a forced solver registers and warns once.
  const events = [], sub = granularSubsystem(forced);
  sub.validate({dt: forced.dt, subSteps: undefined, timing: {dt: forced.dt, substeps: 1, every: 1}});
  const ctx = {world: null, tick: 1, time: 0, dt: forced.dt, substeps: 1, emit: (type, data) => events.push([type, data])};
  sub.step(ctx); sub.finish(ctx); sub.step(ctx); sub.finish(ctx);
  assert.deepEqual(events.map(e => e[0]), ['unstable-step']);
  near(events[0][1].fraction, 0.6, 1e-12, 'the warning carries the fraction');
  // Bad input is refused with the payload code.
  for (const make of [() => new Granular({material, config: {dt: 0, capacity: 1}}), () => new Granular({material: {...material, restitution: 0}, config: {dt: 1e-6, capacity: 1}}),
    () => new Granular({material, config: {dt: 1e-6, capacity: 1, normalStiffness: 1}}), () => new Granular({material: {density: 1, restitution: 1, friction: 0}, config: {dt: 1e-6, capacity: 1, law: 'linear'}}),
    () => stable.addWall({shape: {kind: 'plane', normal: [0, 0, 0]}}), () => stable.addWall({shape: {kind: 'cylinder', radius: 1, from: 0, to: 1}, type: 'dynamic', mass: 1}), () => stable.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}, linearVelocity: [1, 0, 0]})])
    assert.throws(make, error => error instanceof EngineError && error.code === 'INVALID_PAYLOAD');
});

test('two grains, elastic: the Hertz contact duration matches the closed form and the scheme is second order', t => {
  const runs = [0.08, 0.04, 0.02].map(fraction => S.headOn(K, {fraction}));
  for (const r of runs) {
    // The duration is read from the overlap's zero crossings; what is left is the time-stepping error.
    within(r.duration, r.hertzDuration, 5e-4, 'contact duration against 2.943 delta_max / v');
    assert.ok(r.momentum <= 1e-13, `momentum is conserved to round-off (${r.momentum})`);
    near(r.restitution, 1, 1e-4, 'an undamped impact returns the speed');
  }
  within(runs[2].duration, runs[2].hertzDuration, 5e-5, 'at 2% of the Rayleigh time');
  const durationOrder = order(runs[0].duration / runs[0].hertzDuration - 1, runs[1].duration / runs[1].hertzDuration - 1), energyOrder = order(runs[1].energyDrift, runs[2].energyDrift);
  assert.ok(durationOrder > 1.7 && durationOrder < 2.3, `duration error is second order (${durationOrder})`);
  assert.ok(energyOrder > 1.8 && energyOrder < 2.2, `energy error during the impact is second order (${energyOrder})`);
  // The closed form holds at any speed: ten times slower and ten times faster (2.8% overlap).
  for (const speed of [0.01, 1]) { const r = S.headOn(K, {fraction: 0.02, speed}); within(r.duration, r.hertzDuration, 1e-4, `duration at ${speed} m/s`); }
  const linear = S.headOn(K, {law: 'linear', fraction: 0.01});
  within(linear.duration, linear.linearDuration, 2e-4, 'linear law: duration pi sqrt(m* / k_n)');
  t.diagnostic(`Hertz duration error at 8%, 4%, 2% of the Rayleigh time: ${runs.map(r => sci(r.duration / r.hertzDuration - 1)).join(', ')} (order ${durationOrder.toFixed(2)}); energy drift ${runs.map(r => sci(r.energyDrift)).join(', ')} (order ${energyOrder.toFixed(2)}); linear duration error ${sci(linear.duration / linear.linearDuration - 1)}`);
});

test('two grains, damped: the restitution is the one asked for, at any speed, for both laws', t => {
  const rows = [];
  for (const law of ['hertz', 'linear']) for (const restitution of [0.9, 0.5, 0.2]) for (const speed of [0.1, 1]) {
    // The linear dashpot switches on at first touch, which costs it a first-order error in the step: it gets a finer one.
    const r = S.headOn(K, {law, restitution, speed, fraction: law === 'hertz' ? 0.01 : 0.002});
    near(r.restitution, restitution, law === 'hertz' ? 1e-3 : 2e-3, `${law} e = ${restitution} at ${speed} m/s`);
    assert.ok(r.momentum <= 1e-13, 'momentum is conserved to round-off');
    // What the dashpot took is what the grains lost.
    within(r.dissipated, r.energy - r.kinetic, law === 'hertz' ? 1e-4 : 2e-3, 'dissipated energy = kinetic energy lost');
    rows.push(`${law} ${restitution} @${speed}: ${sci(r.restitution - restitution)}`);
  }
  // The coefficient is solved for, not taken from the textbook formula: for the linear law without the clamp it would be
  // 2 zeta with e = exp(-pi zeta / sqrt(1 - zeta^2)). The unclamped contact pulls at the end of the impact and so loses
  // more: with the clamp the same restitution needs more damping (0.511 against 0.431 at e = 0.5).
  const zeta = -Math.log(0.5) / Math.hypot(Math.PI, Math.log(0.5));
  assert.ok(granularDampingCoefficient(0.5, 'linear') > 2 * zeta && granularDampingCoefficient(0.5, 'linear') < 3 * zeta);
  assert.equal(granularDampingCoefficient(1, 'hertz'), 0);
  t.diagnostic(`restitution error: ${rows.join('; ')}`);
});

test('oblique impact: sliding and sticking rebounds match their closed forms', t => {
  // Sliding throughout: the tangential impulse is mu times the normal one, psi2 = psi1 - (7/2) mu (1 + e).
  const slides = [S.oblique(K, {psi: 5, restitution: 1}), S.oblique(K, {psi: 5, restitution: 0.7}), S.oblique(K, {law: 'linear', psi: 6, restitution: 0.6, friction: 0.4})];
  for (const r of slides) near(r.psi2, r.sliding, 5e-3, 'sliding regime');
  near(slides[1].restitution, 0.7, 1e-3, 'friction does not change the normal restitution');
  // Sticking, linear springs, no damping: the tangential spring swings through pi sqrt(7 k_t / 2 k_n) of a cycle.
  const full = S.oblique(K, {law: 'linear', psi: 1, friction: 10, tangentialDamping: 0, fraction: 0.005}), part = S.oblique(K, {law: 'linear', psi: 1, friction: 10, ratio: 1 / 7, tangentialDamping: 0, fraction: 0.005});
  near(full.psi2, -1, 2e-3, 'k_t = 2/7 k_n: the tangential velocity of the contact point reverses exactly');
  // At the very end of this impact the normal force goes to zero before the tangential one: a little slip, 2.5e-3.
  near(part.psi2, part.sticking, 5e-3, 'k_t = 1/7 k_n: psi2 = cos(pi sqrt(1/2)) psi1');
  // Hertz-Mindlin has no closed form in the sticking regime; the rebound must reverse (Maw, Barber and Fawcett's negative branch).
  const maw = S.oblique(K, {psi: 1, tangentialDamping: 0});
  assert.ok(maw.psi2 < -0.1 && maw.psi2 > -1, `Hertz-Mindlin at psi1 = 1 reverses the tangential velocity (${maw.psi2})`);
  t.diagnostic(`sliding psi2 - reference: ${slides.map(r => sci(r.psi2 - r.sliding)).join(', ')}; sticking: ${sci(full.psi2 + 1)}, ${sci(part.psi2 - part.sticking)}; Hertz-Mindlin psi2(1) = ${maw.psi2.toFixed(3)}; overlap ${sci(slides[0].overlap)}`);
});

test('a grain on an incline slides at g (sin - mu cos) and rolls at (5/7) g sin', t => {
  for (const law of ['hertz', 'linear']) {
    const slide = S.incline(K, {law, friction: 0.1}), roll = S.incline(K, {law, friction: 0.5});
    assert.ok(slide.slips && !roll.slips);
    // While it slides the friction force is exactly mu N, whatever the spin.
    within(slide.acceleration, slide.sliding, 1e-9, `${law}: sliding acceleration`);
    within(slide.spinAcceleration, 2.5 * 0.1 * G * Math.cos(Math.PI / 6), 1e-3, `${law}: spin-up of the sliding grain, (5/2) mu g cos`);
    // Rolling: the lever arm is the radius less the overlap, and the tangential spring still rings a little.
    within(roll.acceleration, roll.rolling, 1e-3, `${law}: rolling acceleration`);
    within(roll.spinAcceleration, roll.rolling, 1e-3, `${law}: rolling without slip`);
    t.diagnostic(`${law}: sliding ${sci(slide.acceleration / slide.sliding - 1)}, rolling ${sci(roll.acceleration / roll.rolling - 1)}`);
  }
});

test('energy ledger: kinetic + gravitational + elastic + dissipated stays constant, converging at second order', t => {
  const coarse = S.ledger(K, {fraction: 0.2}), fine = S.ledger(K, {fraction: 0.1}), linear = S.ledger(K, {law: 'linear', fraction: 0.1});
  for (const r of [coarse, fine, linear]) {
    assert.ok(r.damping > 0 && r.friction > 0, 'both dissipation channels are counted');
    // The beads fell and came nearly to rest: what the dashpots and friction took is the potential energy lost.
    within(r.damping + r.friction, r.potentialDrop - r.kinetic - r.elastic, 0.02, 'dissipated = potential lost - what is still stored');
  }
  // Drift of the sum over the energy dissipated: measured 4.9e-3 at 20% of the Rayleigh time and 1.2e-3 at 10%.
  assert.ok(coarse.drift < 0.01, `ledger at 20% of the critical time (${coarse.drift})`);
  assert.ok(fine.drift < 0.0025, `ledger at 10% (${fine.drift})`);
  assert.ok(linear.drift < 0.02, `linear law at 10% of the contact time (${linear.drift})`);
  const rate = order(coarse.drift, fine.drift);
  // Many-body and chaotic, so the two runs are not the same trajectory: the order is read loosely.
  assert.ok(rate > 1.4 && rate < 2.6, `the ledger converges at about second order (${rate})`);
  t.diagnostic(`${fine.grains} beads, ${fine.steps} steps: drift / dissipated ${sci(coarse.drift)} at 20%, ${sci(fine.drift)} at 10% (order ${rate.toFixed(2)}), linear ${sci(linear.drift)}; damping ${sci(fine.damping)} J, friction ${sci(fine.friction)} J, potential lost ${sci(fine.potentialDrop)} J`);
});

test('a column at rest: the floor carries the weight', t => {
  const r = S.column(K);
  // Frictionless sides carry nothing, so the floor must read the weight; the beads still creep at 1e-8 J.
  within(-r.floor, r.weight, 1e-3, 'floor force = weight');
  assert.equal(r.sideFriction, 0, 'frictionless sides carry no vertical load');
  assert.ok(r.kinetic < 1e-6 * r.potential, `the column is at rest (${r.kinetic} J)`);
  assert.ok(r.overlap < 0.05 && r.coordination > 3);
  t.diagnostic(`${r.grains} beads: floor / weight - 1 = ${sci(-r.floor / r.weight - 1)}, largest overlap ${sci(r.overlap)}, coordination ${r.coordination.toFixed(2)}`);
});

test('Janssen: the load on a silo floor saturates with fill height', t => {
  const r = S.janssen(K);
  const shares = r.fills.map(f => f.base / f.weight);
  // The floor's share of the weight falls batch after batch, to an eighth: a fluid would give 1 every time.
  for (let i = 1; i < shares.length; i++) assert.ok(shares[i] < shares[i - 1] + 0.03, `share ${i} does not rise (${shares})`);
  assert.ok(shares[3] < 0.5 * shares[0] && shares[7] < 0.6 * shares[3], `the share keeps falling (${shares})`);
  assert.ok(shares.at(-1) < 0.2, `the full silo puts under a fifth of its weight on the floor (${shares.at(-1)})`);
  // The second half of the batches doubles the weight and leaves the floor load where it was. The load of one stage is a
  // mean over 3 mm of descent of a column six beads wide, and wanders by about a tenth around the plateau.
  assert.ok(r.scatter < 0.2, `the floor load has saturated (largest departure from the plateau ${r.scatter})`);
  // Floor and wall together carry the weight while the floor descends at constant speed.
  assert.ok(r.balance < 0.02, `floor + wall = weight (${r.balance})`);
  // One number is fitted: the saturation load W_s of F = W_s (1 - exp(-W / W_s)).
  assert.ok(r.residual < 0.1, `Janssen's curve fits the eight loads (rms ${r.residual} of the saturation load)`);
  within(r.plateau, r.saturation, 0.1, 'the fitted saturation load is the plateau');
  // K follows from W_s with the wall friction that was actually mobilised (measured, not fitted), and is checked
  // against the stress ratio read directly from the wall and floor loads of the full silo.
  assert.ok(r.mobilisedFriction > 0.15 && r.mobilisedFriction <= 0.5, `mobilised wall friction (${r.mobilisedFriction})`);
  assert.ok(r.stressRatio > 0.5 && r.stressRatio < 2, `stress ratio from the fit (${r.stressRatio})`);
  within(r.stressRatio, r.stressRatioDirect, 0.25, 'K from the fit against K from the measured wall pressure');
  t.diagnostic(`floor load / weight for ${r.fills.map(f => f.grains).join(', ')} beads: ${shares.map(s => s.toFixed(3)).join(', ')}; floor loads ${r.fills.map(f => f.base.toFixed(2)).join(', ')} N; fitted saturation load ${r.saturation.toFixed(3)} N (lambda = ${(r.lambda / S.SILO_D).toFixed(2)} d), rms misfit ${sci(r.residual)}, plateau ${r.plateau.toFixed(3)} N with scatter ${sci(r.scatter)}; mobilised wall friction ${r.mobilisedFriction.toFixed(3)}; K = ${r.stressRatio.toFixed(2)} from the fit, ${r.stressRatioDirect.toFixed(2)} measured directly (${r.stressRatioFullFriction.toFixed(2)} if the wall friction were fully mobilised); largest overlap ${sci(r.maxOverlap)}`);
});

test('Beverloo: the discharge through an orifice follows (D - k d)^(5/2) and does not depend on the fill height', t => {
  const r = S.beverloo(K);
  assert.ok(r.runs.every(run => !run.jammed), 'no orifice jammed');
  for (let i = 1; i < r.runs.length; i++) assert.ok(r.runs[i].rate > r.runs[i - 1].rate, 'a wider orifice flows faster');
  // A pure power law through the smallest and largest orifice has an exponent well above 5/2: the empty annulus k d.
  const apparent = Math.log(r.runs.at(-1).rate / r.runs[0].rate) / Math.log(r.runs.at(-1).orifice / r.runs[0].orifice);
  assert.ok(apparent > 2.6 && apparent < 3.6, `apparent exponent of W against D (${apparent})`);
  // Two numbers are fitted, C and k, to four rates each read from 200 beads: the bands are wide on purpose.
  assert.ok(r.misfit < 0.15, `Beverloo's law fits the four rates (worst ${r.misfit})`);
  assert.ok(r.C > 0.35 && r.C < 0.75, `C (${r.C})`);
  assert.ok(r.k > 0.5 && r.k < 2.5, `k (${r.k})`);
  // The level falls by a fifth during the long run: a liquid would slow by 10%, the beads do not slow.
  assert.ok(r.levels[1] < 0.85 * r.levels[0]);
  assert.ok(r.heightRatio > 0.92 && r.heightRatio < 1.12, `rate late / early as the level falls (${r.heightRatio})`);
  t.diagnostic(`${r.grains} beads, bulk density ${r.bulkDensity.toFixed(0)} kg/m^3 (packing ${r.packing.toFixed(3)}): rates ${r.runs.map(run => `${run.orifice}d ${run.rate.toFixed(3)}`).join(', ')} kg/s; C = ${r.C.toFixed(3)}, k = ${r.k.toFixed(2)}, worst misfit ${sci(r.misfit)}, apparent exponent ${apparent.toFixed(2)}; level ${r.levels.map(l => l.toFixed(1)).join(' -> ')} d, rate late / early ${r.heightRatio.toFixed(3)}`);
});

test('angle of repose: steeper with friction and with rolling resistance (a trend check)', t => {
  const cases = [[0.2, 0], [0.5, 0], [0.5, 0.1], [0.5, 0.3]].map(([friction, rollingFriction]) => ({friction, rollingFriction, ...S.repose(K, {friction, rollingFriction})}));
  for (const c of cases) assert.ok(c.angle > 15 && c.angle < 45, `a plausible angle (${c.angle})`);
  // The mass left on the ledge needs no fit and must rise with both coefficients; the fitted slope carries about 2 degrees of noise.
  for (let i = 1; i < cases.length; i++) {
    assert.ok(cases[i].retained > cases[i - 1].retained, `more stays with more resistance (${cases.map(c => c.retained)})`);
    assert.ok(cases[i].angle > cases[i - 1].angle - 2, `the slope does not fall (${cases.map(c => c.angle)})`);
  }
  assert.ok(cases[3].angle > cases[0].angle + 6, 'rolling resistance of 0.3 and friction 0.5 against friction 0.2 alone');
  t.diagnostic(cases.map(c => `mu ${c.friction}, mu_r ${c.rollingFriction}: ${c.angle.toFixed(1)} deg, ${(100 * c.retained).toFixed(1)}% left`).join('; '));
});

test('walls: plates with an orifice, cones, cylinders, boxes and a moving plane behave as the geometry says', () => {
  const material = {...BEAD, youngModulus: 1e7, restitution: 0.3, friction: 0.3, rollingFriction: 0.1}, dt = 0.1 * S.criticalTime(K, material, {}, R);
  // An annular plate: a bead over the hole falls through, a bead over the plate rests on it.
  const plate = new Granular({material, config: {dt, capacity: 2}});
  plate.addWall({shape: {kind: 'annulus', innerRadius: 3 * R, outerRadius: 0.1}});
  plate.addGrain([0, 2 * R, 0], R); plate.addGrain([6 * R, 2 * R, 0], R);
  plate.step(Math.round(0.4 / dt));
  assert.ok(plate.positions[1] < -0.3, 'the bead over the orifice fell through');
  near(plate.positions[4], R, 2e-3 * R, 'the bead over the plate rests a radius above it');
  // A cone (apex down, 45 degrees) with a closed tip: the bead comes to rest on the axis at r / sin(45) above the apex.
  const cone = new Granular({material, config: {dt, capacity: 1}});
  cone.addWall({shape: {kind: 'frustum', r0: 0, z0: 0, r1: 0.1, z1: 0.1}});
  cone.addGrain([0.01, 0.05, 0.004], R);
  cone.step(Math.round(1.2 / dt));
  near(cone.positions[1], R * Math.SQRT2, 0.01 * R, 'height of the bead in the cone');
  assert.ok(Math.hypot(cone.positions[0], cone.positions[2]) < 0.02 * R, 'the bead sits on the axis');
  // A cylinder shell keeps a bead thrown at it inside; a box carries a bead on its top face.
  const can = new Granular({material, config: {dt, capacity: 2, gravity: [0, 0, 0]}});
  can.addWall({shape: {kind: 'cylinder', radius: 0.03, from: -1, to: 1}});
  can.addGrain([0, 0, 0], R, [0.07, 0.01, 0.04]);
  let farthest = 0;
  for (let i = 0; i < 400; i++) { can.step(50); farthest = Math.max(farthest, Math.hypot(can.positions[0], can.positions[2])); }
  assert.ok(farthest < 0.03 - R + 0.02 * R && farthest > 0.03 - 1.01 * R, `the bead stays inside the shell (${farthest})`);
  const table = new Granular({material, config: {dt, capacity: 1}});
  table.addWall({shape: {kind: 'box', halfExtents: [0.02, 0.01, 0.02]}, position: [0, 0.05, 0], rotation: [0, Math.sin(0.3), 0, Math.cos(0.3)]});
  table.addGrain([0.004, 0.06 + 1.5 * R, 0.003], R);
  table.step(Math.round(0.6 / dt));
  near(table.positions[1], 0.06 + R, 2e-3 * R, 'the bead rests on the box');
  near(-table.wallForce(0)[1], table.mass() * G, 1e-3 * table.mass() * G, 'and the box carries its weight');
  // A kinematic plane lifts a bead: the work the wall does is booked as exchanged energy, and the ledger closes.
  const lift = new Granular({material, config: {dt, capacity: 1}});
  const floor = lift.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}, type: 'kinematic'});
  lift.addGrain([0, R, 0], R);
  lift.step(Math.round(0.2 / dt));
  const e0 = lift.energyBalance(), m0 = lift.mechanicalEnergy();
  lift.setWallVelocity(floor, [0, 0.05, 0]); lift.step(Math.round(0.5 / dt));
  near(lift.velocities[1], 0.05, 1e-4, 'the bead rides the plane');
  near(lift.wallPosition(floor)[1], 0.05 * Math.round(0.5 / dt) * dt, 1e-12, 'the plane moved as told');
  const gained = lift.mechanicalEnergy() - m0;
  assert.ok(gained > 0.9 * lift.mass() * G * 0.025);
  near(lift.energyBalance(), e0, 2e-3 * gained, 'energy gained = work of the wall, less what the contact dissipated');
  assert.ok(lift.externalWork > gained);
});

test('coupling: a block resting on a bed is carried by a force equal to its weight, and the floor reads both', async t => {
  const r = await S.blockOnBed(K);
  // The mean is over 48 rigid steps; the block's weight is a float32 mass times g.
  within(r.force, r.weight, 1e-5, 'force of the bed on the block = its weight');
  within(r.base, r.total, 1e-5, 'floor load = weight of bed and block');
  assert.ok(r.speed < 1e-5, `the block is at rest (${r.speed} m/s)`);
  assert.ok(r.contacts >= 3, 'it stands on at least three beads');
  t.diagnostic(`${r.grains} beads, ${r.substeps} grain steps per rigid step: force / weight - 1 = ${sci(r.force / r.weight - 1)}, floor / total - 1 = ${sci(r.base / r.total - 1)}, block speed ${sci(r.speed)} m/s on ${r.contacts} beads`);
});

test('coupling: the third law, grains and body exchange equal and opposite momentum', async t => {
  const r = await S.freeCollision(K), solver = S.freeCollisionSolver(K);
  assert.ok(r.bodySpeed > 0.1, 'the body was struck');
  // The impulse the coupling hands the world and the grains' own momentum change are the same float64 numbers.
  assert.ok(r.grainSide < 1e-12, `grains' momentum change + impulse handed over (${r.grainSide})`);
  // The body's velocity is a float32 of the world: 1e-7 of the momentum exchanged.
  assert.ok(r.change < 2e-6, `total momentum of beads and body (${r.change})`);
  // Inside the solver alone, with the body a dynamic wall, it is round-off.
  assert.ok(solver.change < 1e-12, `solver alone (${solver.change})`);
  t.diagnostic(`momentum change over momentum exchanged: grains' side ${sci(r.grainSide)}, with the float32 body ${sci(r.change)}, solver alone ${sci(solver.change)}`);
});

test('coupling: a box of beads on a spring scale reads their weight', async t => {
  const r = await S.scale(K);
  // The reading is a float32 position of the tray; the sag is 42 mm.
  within(r.reading, r.weight, 1e-5, 'extra spring load = weight of the beads');
  within(r.force, r.weight, 1e-5, 'force of the beads on the tray');
  t.diagnostic(`${r.grains} beads: reading / weight - 1 = ${sci(r.reading / r.weight - 1)}, sag ${(1e3 * r.sag).toFixed(2)} mm`);
});

test('coupling: time steps must nest, bodies are told apart and a one-way body is not pushed', async () => {
  const world = await createWorld({step: DT, subSteps: 4, ground: false, gravity: [0, 0, 0]});
  try {
    const material = {density: 2500, restitution: 0.3, friction: 0.5}, config = {law: 'linear', normalStiffness: S.SILO_STIFFNESS};
    const odd = new Granular({material, config: {...config, dt: DT / 36.5, capacity: 1}});
    assert.throws(() => new GranularCoupling(world, odd), error => error instanceof EngineError && /whole number of grain steps/.test(error.message));
    assert.throws(() => new GranularCoupling({}, odd), TypeError);
    const g = new Granular({material, config: {...config, dt: DT / 40, capacity: 8}});
    const coupling = new GranularCoupling(world, g);
    assert.equal(coupling.substeps, 40);
    const half = [0.05, 0.01, 0.05], plate = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [0, 0, 0], density: 500, neverSleeps: true});
    const index = coupling.addBody(plate, {shape: {kind: 'box', halfExtents: half}, twoWay: false, gravityScale: 0});
    assert.equal(coupling.indexOf(plate), index);
    assert.throws(() => coupling.addBody(plate, {shape: {kind: 'box', halfExtents: half}}), EngineError);
    assert.throws(() => coupling.force({}), EngineError);
    g.addGrain([0, 0.01 + R, 0], R, [0, -0.2, 0]);
    let pushed = 0;
    for (let i = 0; i < 20; i++) { coupling.step(); pushed = Math.max(pushed, Math.abs(coupling.force(plate)[1])); world.step(); }
    assert.ok(pushed > 0, 'the bead pressed on the plate');
    assert.ok(Math.abs(world.getState(plate).linearVelocity[1]) < 1e-6, 'a one-way body feels nothing');
  } finally { world.dispose(); }
});

test('the stepping loop: stage, time-step check, energy ledger and events', async () => {
  const looped = await S.fingerprint(K, {simulation: true});
  assert.deepEqual(looped.order, ['granular', 'world', 'events']);
  assert.equal(GRANULAR_SUBSYSTEM_ORDER, 160);
  assert.ok(looped.events.some(e => e.endsWith(':contact-begin')), `the block touching the bed is an event (${looped.events})`);
  const entry = looped.energy.entries.find(e => e.id === 'granular');
  assert.equal(entry.kind, 'granular-coupling');
  for (const part of ['kinetic', 'potential', 'elastic', 'dissipatedDamping', 'dissipatedFriction']) assert.ok(Number.isFinite(entry.parts[part]), `ledger part ${part}`);
  near(entry.total, entry.parts.kinetic + entry.parts.potential + entry.parts.elastic, 1e-12, 'total = kinetic + potential + elastic');
  assert.ok(entry.parts.dissipatedDamping > 0 && entry.parts.dissipatedFriction > 0);
  assert.ok(looped.energy.entries.some(e => e.id === 'rigid'), 'the tracked block is in the ledger');
  // A bare Granular is a post-stage field: with a quarter of the simulation step it takes four steps per tick, bit for bit.
  const world = await createWorld({step: DT, subSteps: 4, ground: false});
  try {
    const build = () => {
      const material = {...BEAD, youngModulus: 5e6, restitution: 0.5, friction: 0.4}, lattice = granularLattice({min: [0, 0.02, 0], max: [0.05, 0.07, 0.05], radius: [0.9 * R, 1.1 * R], gap: 0, jitter: 1, seed: 3});
      const g = new Granular({material, config: {dt: DT / 80, capacity: lattice.count, bounds: {min: [-1, -0.05, -1], max: [1, 1, 1]}}});
      g.addWall({shape: {kind: 'annulus', innerRadius: 0.02, outerRadius: 1}, position: [0.025, 0, 0.025]});
      g.addGrains(lattice.positions, lattice.radii);
      return g;
    };
    const direct = build(), inLoop = build(), sim = createSimulation(world), events = [];
    sim.add(granularSubsystem(inLoop, {id: 'beads'}));
    sim.onEvent(e => { if (e.source === 'beads') events.push(e); });
    assert.deepEqual(sim.order().map(row => row.id), ['world', 'beads', 'events']);
    const e0 = inLoop.energyBalance();
    for (let i = 0; i < 60; i++) sim.step();
    direct.step(60 * 80);
    assert.deepEqual(inLoop.positions, direct.positions, 'the loop adds nothing');
    const removed = events.filter(e => e.type === 'grains-removed');
    assert.ok(removed.length > 0, 'beads leaving through the orifice are events');
    assert.equal(removed.reduce((sum, e) => sum + e.data.count, 0), inLoop.stats.removed);
    near(removed.reduce((sum, e) => sum + e.data.mass, 0), inLoop.stats.removedMass, 1e-12, 'with their mass');
    // Removed beads take their energy out through `exchanged`: the balance still closes.
    const energy = sim.energy().entries.find(e => e.id === 'beads');
    near(energy.balance + energy.parts.dissipatedDamping + energy.parts.dissipatedFriction, e0, 5e-3 * (energy.parts.dissipatedDamping + energy.parts.dissipatedFriction), 'balance with beads removed');
    // A step that is not commensurate with the simulation's is refused at registration.
    const off = new Granular({material: {...BEAD}, config: {dt: DT / 80.5, capacity: 1}});
    assert.throws(() => createSimulation(world).add(granularSubsystem(off)), EngineError);
    assert.throws(() => granularSubsystem({}), TypeError);
  } finally { world.dispose(); }
});

test('determinism: repeat runs are bit-identical, and the Simulation loop adds nothing', async () => {
  const a = await S.fingerprint(K), b = await S.fingerprint(K), c = await S.fingerprint(K, {simulation: true});
  assert.equal(a.hash, b.hash, 'two coupled runs agree in every bit of the beads and of the rigid world');
  assert.equal(a.hash, c.hash, 'and so does a run through the Simulation loop');
  const x = S.solverFingerprint(K), y = S.solverFingerprint(K);
  assert.equal(x.hash, y.hash, 'two runs of the solver alone agree in every bit');
  assert.ok(x.contacts > 0 && x.rebuilds > 1, 'the run had contacts and rebuilt its neighbour list');
});

test('glass beads: the library beads with one fitted rolling resistance pile at 22 degrees and collapse as Lajeunesse et al. (2005) measured', t => {
  const pile = S.glassBeadRepose(K);
  t.diagnostic(`pile angles ${pile.angles.map(a => a.toFixed(1)).join(', ')} deg, mean ${pile.angle.toFixed(2)} against 22 (fitted with rolling resistance ${S.GLASS_BEAD_ROLLING})`);
  near(pile.angle, 22, 2.5, 'angle of repose of the library glass beads (Lajeunesse et al. Table I: 22 ± 0.5 deg)');
  for (const aspect of [0.5, 1, 2]) {
    const r = S.columnCollapse(K, {aspect});
    t.diagnostic(`a = ${r.aspect.toFixed(2)}: runout ${r.runout.toFixed(2)} L_i against ${r.expectedRunout.toFixed(2)} (${(100 * (r.runout / r.expectedRunout - 1)).toFixed(0)}%), deposit height ${r.height.toFixed(2)} L_i, ${r.grains} beads`);
    within(r.runout, r.expectedRunout, 0.3, `runout at a = ${r.aspect.toFixed(2)} (prefactor read from a log-log figure, 10 mm beads in a channel 6 d wide)`);
    if (r.expectedHeight !== null) within(r.height, r.expectedHeight, 0.1, 'a low column keeps its height');
    assert.ok(r.kinetic < 1e-3, 'the deposit has come to rest');
  }
});
