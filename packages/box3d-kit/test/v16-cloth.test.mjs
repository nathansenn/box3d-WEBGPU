// The calibrated cloth (box3d-webgpu-kit/cloth) against closed-form answers. SI units throughout.
// The set-ups live in cloth-scenarios.mjs, which the validation report runs as well. Every tolerance
// below says where it comes from; measured values are printed as diagnostics and recorded in
// docs/CLOTH.md. Nothing here depends on wall-clock time.
//
// Four facts set most tolerances:
//  - The membrane law is St. Venant-Kirchhoff: linear in the Green strain, so a strain e differs from
//    the small-strain answer by about 1.5 e. Where a check is tight it uses the exact law instead.
//  - Linear triangles, lumped masses and the hinge-averaged curvature are second order in the mesh
//    size on structured meshes: halving the mesh divides the error by about four.
//  - The time-stepped runs stop at a residual force of 1e-6 (or the stated fraction) of the largest
//    load on a node, and the rigid solver keeps float32 state: a position near 0.25 m resolves 3e-8 m.
//  - Backward Euler multiplies the energy of a mode by 1 / (1 + (omega dt)^2) every step.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld, axisRotation, capabilities, EngineError} from 'box3d-webgpu-kit';
import {createSimulation} from 'box3d-webgpu-kit/simulation';
import * as cloth from 'box3d-webgpu-kit/cloth';
import * as S from './cloth-scenarios.mjs';

const {Cloth, ClothCoupling, clothGrid, clothSubsystem, CLOTH_SOLVER_ID, CLOTH_COUPLING_BACKEND, CLOTH_SUBSYSTEM_ORDER} = cloth;
const K = {...cloth, createWorld, createSimulation, axisRotation};
const {G, HZ, DT} = S;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const rel = (actual, expected) => (actual - expected) / expected;
const sci = value => value.toExponential(2);
const order = (coarse, fine) => Math.log2(Math.abs(coarse) / Math.abs(fine));

test('the cloth module is listed and names its solver', () => {
  assert.ok(capabilities().modules.includes('cloth'));
  assert.equal(CLOTH_SOLVER_ID, 'cloth-stvk-koiter-newton-pcg-js-f64-v1');
  assert.equal(CLOTH_COUPLING_BACKEND, 'rigid-cloth-coupling-monolithic-js-f64-v1');
});

test('membrane patch test: a uniform strain is reproduced on an irregular mesh', t => {
  const r = S.patch(K);
  assert.ok(r.converged);
  // Constant-strain triangles hold any uniform deformation exactly: what is left is rounding (1e-16 of a 1 m sheet).
  assert.ok(r.worst < 1e-12, `interior nodes follow the uniform deformation (worst ${r.worst} m)`);
  assert.ok(r.strainTrace < 1e-11, `every triangle carries the same strain (worst ${r.strainTrace})`);
  t.diagnostic(`patch test, ${r.nodes} nodes jittered by 30% of a cell: position error ${sci(r.worst)} m, strain error ${sci(r.strainTrace)}`);
});

test('uniaxial strip: stress = E strain and lateral contraction = -nu strain; edge springs fail it', t => {
  const stvk = S.uniaxial(K), jittered = S.uniaxial(K, {jitter: 0.3}), zero = S.uniaxial(K, {nu: 0});
  for (const [label, r] of [['regular', stvk], ['irregular', jittered]]) {
    assert.ok(r.converged);
    // Against the exact St. Venant-Kirchhoff sheet the state is uniform, so only the solve tolerance is left.
    within(r.axial, r.exactAxial, 1e-8, `${label}: axial strain against the exact law`);
    within(r.lateral, r.exactLateral, 1e-8, `${label}: lateral strain against the exact law`);
    // Against Hooke's law the law's own nonlinearity shows: 1.5 e in the modulus, e in the ratio (e = 1e-3).
    within(r.modulus, r.youngModulus, 2e-3, `${label}: stress / strain = E`);
    near(r.poisson, 0.3, 1e-3, `${label}: contraction / extension = nu`);
  }
  near(zero.poisson, 0, 1e-9, 'nu = 0: no contraction');
  // Edge springs have no Poisson's ratio to set. On this mesh they give 0.0005 with one diagonal direction and 0.29 with
  // alternating ones, whatever the material says, and the alternating mesh is 22% too stiff.
  const uniform = S.uniaxial(K, {membrane: 'spring'}), alternate = S.uniaxial(K, {membrane: 'spring', diagonal: 'alternate'}), other = S.uniaxial(K, {membrane: 'spring', diagonal: 'alternate', nu: 0});
  assert.ok(Math.abs(uniform.poisson - 0.3) > 0.25, `springs, uniform diagonals: Poisson's ratio ${uniform.poisson} is nowhere near 0.3`);
  assert.ok(Math.abs(rel(alternate.modulus, alternate.youngModulus)) > 0.15, `springs, alternating diagonals: modulus off by ${rel(alternate.modulus, alternate.youngModulus)}`);
  near(other.poisson, alternate.poisson, 1e-9, 'springs: the contraction does not depend on the material Poisson ratio');
  t.diagnostic(`membrane: E error ${sci(rel(stvk.modulus, stvk.youngModulus))} (the law's 1.5 e), nu = ${stvk.poisson.toFixed(5)}; exact-law errors ${sci(rel(stvk.axial, stvk.exactAxial))} and ${sci(rel(stvk.lateral, stvk.exactLateral))}; irregular mesh ${sci(rel(jittered.axial, jittered.exactAxial))}`);
  t.diagnostic(`edge springs: uniform diagonals E error ${sci(rel(uniform.modulus, uniform.youngModulus))}, nu = ${uniform.poisson.toFixed(4)}; alternating E error ${sci(rel(alternate.modulus, alternate.youngModulus))}, nu = ${alternate.poisson.toFixed(4)} (also with material nu = 0: ${other.poisson.toFixed(4)})`);
});

test('hanging strip: elongation rho g L^2 / (2 E t) and reaction = weight', t => {
  const coarse = S.hangingStrip(K, {n: 8}), fine = S.hangingStrip(K, {n: 16}), poisson = S.hangingStrip(K, {n: 16, nu: 0.3});
  for (const r of [coarse, fine, poisson]) { assert.ok(r.converged); within(r.reaction, r.weight, 1e-8, 'reaction = weight'); }
  // Lumped weights make the nodes of a bar exact, so the mesh does not matter. What is left is the law: the stretch is
  // short by the top strain rho g L / Y = 4.9e-4. Tolerance: twice that.
  for (const r of [coarse, fine]) within(r.elongation, r.reference, 2 * r.strain, 'elongation');
  near(rel(fine.elongation, fine.reference), -fine.strain, 5e-5, 'the shortfall is the top strain, as the law predicts');
  // With nu = 0.3 the clamp also holds the top edge at its width, which the formula ignores: 0.9% on this 5:1 strip.
  within(poisson.elongation, poisson.reference, 0.015, 'elongation with nu = 0.3');
  t.diagnostic(`hanging strip: elongation error ${sci(rel(coarse.elongation, coarse.reference))} (8 elements), ${sci(rel(fine.elongation, fine.reference))} (16), ${sci(rel(poisson.elongation, poisson.reference))} with nu = 0.3; top strain ${sci(fine.strain)}; reaction error ${sci(rel(fine.reaction, fine.weight))}`);
});

test('catenary: a stiff strip pinned at both ends sags like the inextensible catenary, converging with the mesh', t => {
  const r = [8, 16, 32].map(n => S.catenary(K, n)), errors = r.map(one => rel(one.sag, one.reference));
  for (const one of r) assert.ok(one.converged);
  // A chain of n straight links with lumped weights against the smooth curve: second order. Measured 0.82%, 0.20%, 0.051%.
  // The strip stretches by 2e-6 under its own weight, far below these.
  assert.ok(Math.abs(errors[0]) < 0.012 && Math.abs(errors[1]) < 0.003 && Math.abs(errors[2]) < 0.0008, `sag errors ${errors}`);
  assert.ok(order(errors[0], errors[1]) > 1.8 && order(errors[1], errors[2]) > 1.8, 'second order in the mesh size');
  within(r[2].horizontal, r[2].horizontalReference, 5e-4, 'horizontal reaction = weight per length times the catenary parameter');
  t.diagnostic(`catenary sag error ${errors.map(sci).join(', ')} at 8, 16, 32 elements (orders ${order(errors[0], errors[1]).toFixed(2)}, ${order(errors[1], errors[2]).toFixed(2)}); horizontal reaction error ${sci(rel(r[2].horizontal, r[2].horizontalReference))}`);
});

test('cantilever strip: tip deflection w L^4 / (8 D), second order on regular meshes, with the error on irregular ones stated', t => {
  const regular = [8, 16, 32].map(n => S.cantilever(K, n)), errors = regular.map(one => rel(one.tip, one.plate));
  for (const one of regular) { assert.ok(one.converged); assert.ok(one.tip < 0.02 * one.length, 'small deflection'); }
  // Hinge lines carrying lumped loads integrate the moment by the trapezoid rule: second order. Measured +1.5%, +0.37%, +0.080%.
  assert.ok(Math.abs(errors[0]) < 0.02 && Math.abs(errors[1]) < 0.005 && Math.abs(errors[2]) < 0.0012, `tip errors ${errors}`);
  assert.ok(order(errors[0], errors[1]) > 1.8 && order(errors[1], errors[2]) > 1.8, 'second order in the mesh size');
  // The other structured mesh behaves the same.
  const alternate = S.cantilever(K, 16, {diagonal: 'alternate'});
  within(alternate.tip, alternate.plate, 0.005, 'alternating diagonals');
  // Irregular meshes: the triangle-averaged curvature is not consistent there. The error does not go away with refinement;
  // these are bounds on what was measured (-0.40% at 10% jitter, -4.4% at 25%, 16 elements), not a claim of accuracy.
  const mild = S.cantilever(K, 16, {jitter: 0.1}), strong = S.cantilever(K, 16, {jitter: 0.25});
  within(mild.tip, mild.plate, 0.01, 'nodes jittered by 10% of a cell');
  within(strong.tip, strong.plate, 0.06, 'nodes jittered by 25% of a cell');
  // The plain hinge energy has no Poisson's ratio and depends on the mesh: 37% too soft on this one.
  const hinge = S.cantilever(K, 16, {bending: 'hinge'});
  assert.ok(rel(hinge.tip, hinge.plate) > 0.3, `plain hinge energy on a right-triangle mesh: ${rel(hinge.tip, hinge.plate)}`);
  // With nu = 0.3 a narrow strip lies between the plate (cylindrical bending, D) and the beam (E t^3 / 12): its free edges curl.
  const poisson = S.cantilever(K, 16, {nu: 0.3});
  assert.ok(poisson.tip > poisson.plate && poisson.tip < poisson.beam, `nu = 0.3: ${poisson.tip} between ${poisson.plate} and ${poisson.beam}`);
  t.diagnostic(`cantilever tip error ${errors.map(sci).join(', ')} at 8, 16, 32 elements (orders ${order(errors[0], errors[1]).toFixed(2)}, ${order(errors[1], errors[2]).toFixed(2)}); alternating diagonals ${sci(rel(alternate.tip, alternate.plate))}`);
  t.diagnostic(`irregular meshes (16 elements): ${sci(rel(mild.tip, mild.plate))} at 10% jitter, ${sci(rel(strong.tip, strong.plate))} at 25%; plain hinge energy ${sci(rel(hinge.tip, hinge.plate))}; nu = 0.3: ${sci(rel(poisson.tip, poisson.plate))} above the plate value, ${sci(rel(poisson.tip, poisson.beam))} below the beam value`);
});

test('pre-tensioned strip: first frequency (1 / 2L) sqrt(T / rho), converging with the mesh', t => {
  const r = [8, 16, 32].map(n => S.tensionedStrip(K, {n})), errors = r.map(one => rel(one.frequency, one.reference));
  // Lumped masses on n segments ring at f sin(pi / 2n) / (pi / 2n): -0.64%, -0.16%, -0.040%, second order.
  assert.ok(Math.abs(errors[0]) < 0.008 && Math.abs(errors[1]) < 0.002 && Math.abs(errors[2]) < 0.0006, `frequency errors ${errors}`);
  assert.ok(order(errors[0], errors[1]) > 1.8 && order(errors[1], errors[2]) > 1.7, 'second order in the mesh size');
  // Against that lumped frequency only the midpoint rule's (omega dt)^2 / 12 = 6.9e-5 is left.
  for (const one of r) { within(one.frequency, one.lumped, 1e-4, 'frequency of the lumped strip'); assert.equal(one.unconverged, 0); }
  t.diagnostic(`strip frequency error ${errors.map(sci).join(', ')} at 8, 16, 32 elements (orders ${order(errors[0], errors[1]).toFixed(2)}, ${order(errors[1], errors[2]).toFixed(2)}); against the lumped string ${r.map(one => sci(rel(one.frequency, one.lumped))).join(', ')} (the time step)`);
});

test('pressurised square membrane: centre deflection 0.0737 p a^2 / T', t => {
  const r = [8, 16, 32].map(n => S.pressurisedMembrane(K, n)), errors = r.map(one => rel(one.deflection, one.reference));
  // The coefficient is the double Fourier series of T lap(w) = -p on a square with w = 0 on the edge (Timoshenko's 0.0737).
  near(r[0].coefficient, 0.0737, 5e-5, 'the series gives the handbook coefficient');
  for (const one of r) { assert.ok(one.converged); within(one.reaction, one.load, 1e-7, 'the edge carries p a^2'); }
  // Linear triangles on Poisson's equation: second order. Measured -1.2%, -0.33%, -0.098%. The membrane also stiffens with
  // deflection (w0 / a = 1e-3 adds 1e-4 of the tension), which is why the last halving gains less than four.
  assert.ok(Math.abs(errors[0]) < 0.016 && Math.abs(errors[1]) < 0.0045 && Math.abs(errors[2]) < 0.0014, `deflection errors ${errors}`);
  assert.ok(order(errors[0], errors[1]) > 1.7 && order(errors[1], errors[2]) > 1.5, 'converging at about second order');
  const jittered = S.pressurisedMembrane(K, 16, {jitter: 0.25});
  within(jittered.deflection, jittered.reference, 0.006, 'the membrane does not mind an irregular mesh');
  t.diagnostic(`membrane deflection error ${errors.map(sci).join(', ')} at 8, 16, 32 cells per side (orders ${order(errors[0], errors[1]).toFixed(2)}, ${order(errors[1], errors[2]).toFixed(2)}); irregular 16: ${sci(rel(jittered.deflection, jittered.reference))}; coefficient ${r[0].coefficient.toFixed(6)}; edge reaction error ${sci(rel(r[2].reaction, r[2].load))}`);
});

test('energy: backward Euler loses 1 / (1 + (omega dt)^2) per step, the midpoint rule conserves', t => {
  const slow = S.tensionedStrip(K, {integrator: 'backward-euler', dt: 1 / 1000}), fast = S.tensionedStrip(K, {integrator: 'backward-euler', dt: 1 / 2000});
  for (const r of [slow, fast]) {
    // Never rising, and by the amount the scheme's own amplification factor gives for this mode (the start is one mode to 1e-3).
    assert.ok(r.rose <= 1e-9 * r.start, `backward Euler never gains energy (largest rise ${r.rose} J of ${r.start} J)`);
    within(r.end / r.start, r.expectedDecay, 2e-3, 'energy left after 0.5 s');
    assert.equal(r.unconverged, 0);
  }
  // Half the step, half the decay rate: omega^2 dt.
  within(Math.log(fast.end / fast.start) / Math.log(slow.end / slow.start), 0.5, 0.01, 'the numerical damping is proportional to dt');
  // Midpoint on a mode of a pre-stressed membrane: the energy is quadratic to 1e-8 at this amplitude, and so is the drift.
  const midpoint = S.tensionedStrip(K, {integrator: 'midpoint', dt: 1 / 500});
  assert.ok(midpoint.worstDrift < 1e-6 * midpoint.start, `midpoint keeps the energy (drift ${midpoint.worstDrift} J of ${midpoint.start} J)`);
  t.diagnostic(`backward Euler: energy left after 0.5 s ${(slow.end / slow.start).toFixed(5)} at dt = 1/1000 (factor ${slow.expectedDecay.toFixed(5)}), ${(fast.end / fast.start).toFixed(5)} at 1/2000 (${fast.expectedDecay.toFixed(5)}); midpoint: largest drift ${sci(midpoint.worstDrift / midpoint.start)} of the mode's energy over ${midpoint.steps} steps`);
});

test('loads: wind and pressure are normal-pressure models, a prescribed node moves its neighbours', () => {
  // A free square facing a 10 m/s wind in zero gravity: every triangle feels (1/2) rho C u^2 A along its normal, so after
  // one step (the wind is evaluated at the start of the step) every node moves at h (1/2) rho C u^2 / rho_A.
  const grid = clothGrid({nx: 4, ny: 4, u: [0, 0, 1], v: [0, 1, 0]});
  const sheet = new Cloth({positions: grid.positions, triangles: grid.triangles, material: {arealDensity: 0.25, youngModulus: 1e6, thickness: 1e-3, poissonRatio: 0.3}, config: {dt: DT, gravity: [0, 0, 0], residualTolerance: 1e-10}});
  sheet.setWind({velocity: [10, 0, 0], airDensity: 1.2, coefficient: 1.1});
  sheet.step();
  const p = [0, 0, 0]; sheet.linearMomentum(p);
  // The triangle normals of this grid point along -x, and the wind blows along +x: the push is along +x.
  near(p[0], DT * 0.5 * 1.2 * 1.1 * 100 * 1, 1e-9, 'wind impulse = (1/2) rho C u^2 A dt');
  // Backward Euler moves the sheet by h v with the new v: the wind does F h v = p^2 / m of work, and half of it is kept as kinetic energy.
  near(sheet.externalWork, p[0] * p[0] / sheet.mass(), 1e-9, 'the work of the wind over the step');
  near(sheet.kineticEnergy(), p[0] * p[0] / (2 * sheet.mass()), 1e-9, 'kinetic energy of the sheet');
  sheet.setWind(null);
  // Pressure: 100 Pa on the same sheet pushes it along its normal with p A.
  const blown = new Cloth({positions: grid.positions, triangles: grid.triangles, material: {arealDensity: 0.25, youngModulus: 1e6, thickness: 1e-3, poissonRatio: 0.3}, config: {dt: DT, gravity: [0, 0, 0], residualTolerance: 1e-10}});
  blown.setPressure(100); blown.step(); blown.linearMomentum(p);
  near(p[0], -DT * 100, 1e-9, 'pressure impulse = p A dt along the normal');
  // A pinned node moved by 1 mm drags a stiff sheet with it and reports the force it took.
  const held = new Cloth({positions: grid.positions, triangles: grid.triangles, pinned: [grid.node(0, 0), grid.node(4, 4)], material: {arealDensity: 0.25, youngModulus: 1e6, thickness: 1e-3, poissonRatio: 0.3}, config: {dt: DT, gravity: [0, 0, 0]}});
  held.pin(grid.node(4, 4), [0, 1.001, 1.001]); held.solveStatic();
  near(held.positions[3 * grid.node(4, 4) + 1], 1.001, 1e-15, 'the node is where it was put');
  assert.ok(held.reactions[3 * grid.node(4, 4) + 1] > 1e-3, 'and its support pulls');
  const total = held.totalReaction();
  near(total[1], 0, 1e-6, 'the two supports balance');
  assert.ok(held.isPinned(grid.node(0, 0)) && !held.isPinned(grid.node(1, 1)));
});

test('friction on an incline: sticks below tan(theta) = mu, slides at g (sin - mu cos) above', async t => {
  const sliding = await S.incline(K, 30, 0.3), smooth = await S.incline(K, 30, 0), below = await S.incline(K, 26, 0.5, 1), above = await S.incline(K, 27, 0.5, 1);
  // Backward Euler under a constant force gives v = a t exactly, so only the solve tolerance and the friction limit's
  // dependence on the converged normal force are left. Measured 5e-9 and 3e-8.
  within(sliding.speed, sliding.expectedSpeed, 1e-6, 'sliding speed at 30 degrees, mu = 0.3');
  within(sliding.travel, sliding.expectedTravel, 1e-6, 'sliding distance');
  within(smooth.speed, smooth.expectedSpeed, 1e-6, 'no friction: g sin(theta)');
  // tan(26 deg) = 0.488 < 0.5 < tan(27 deg) = 0.510.
  assert.ok(Math.abs(below.speed) < 1e-9 && Math.abs(below.travel) < 1e-6, `26 degrees: stuck (speed ${below.speed} m/s, moved ${below.travel} m, the stretch of the stick spring)`);
  // Just above, the acceleration is the small difference of two forces 50 times larger: still 3e-8.
  within(above.speed, above.expectedSpeed, 1e-5, '27 degrees: slides at g (sin - mu cos)');
  for (const r of [sliding, smooth, below, above]) { assert.equal(r.contacts, 16, 'every node rests on the ramp'); assert.equal(r.unconverged, 0); }
  t.diagnostic(`incline: speed error ${sci(rel(sliding.speed, sliding.expectedSpeed))} (30 deg, mu 0.3), ${sci(rel(smooth.speed, smooth.expectedSpeed))} (frictionless), ${sci(rel(above.speed, above.expectedSpeed))} (27 deg, mu 0.5); at 26 deg it moved ${sci(below.travel)} m and stopped (${sci(Math.abs(below.speed))} m/s)`);
});

test('no tunnelling: a thin kinematic plate sweeps a cloth at up to 200 m/s', async t => {
  const runs = [];
  for (const speed of [2, 20, 200]) {
    const r = await S.sweep(K, speed); runs.push(r);
    // The 2 mm plate travels up to 0.83 m in one step. No node may end behind it, and the cloth must be carried in front.
    assert.equal(r.behind, 0, `${speed} m/s: no node behind the plate`);
    assert.ok(r.carried > 0, `${speed} m/s: the cloth rides on the leading face`);
    // Depth into the leading face: the penalty depth of a node being accelerated to the plate's speed in one step.
    assert.ok(r.deepest < 1e-3, `${speed} m/s: no node deeper than the plate's half thickness (${r.deepest} m)`);
  }
  // A curved body is seen through one tangent plane per node and step, which is good while it moves less than about its
  // radius per step. A 5 cm sphere at 10 m/s (0.83 radii per step): nodes dip in by under a millimetre and come back.
  const ball = await S.sweep(K, 10, 'sphere');
  assert.equal(ball.behind, 0, 'sphere at 10 m/s: no node left inside');
  assert.ok(ball.deepest < 1.5e-3, `sphere at 10 m/s: deepest ${ball.deepest} m`);
  t.diagnostic(`plate: travel per step / thickness ${runs.map(r => (r.travelPerStep / r.thickness).toFixed(0)).join(', ')} at 2, 20, 200 m/s; deepest node ${runs.map(r => sci(r.deepest)).join(', ')} m from the leading face (negative: clear of it); sphere at 10 m/s: ${sci(ball.deepest)} m inside, ${ball.unconverged} unconverged steps of ${ball.steps}`);
});

test('trampoline: momentum balances, reactions carry the weight at rest, rest depth matches statics', async t => {
  const r = await S.trampoline(K);
  assert.equal(r.unconverged, 0);
  // The cloth catches the ball: it arrives at 2 m/s and is thrown back up.
  assert.ok(r.speedAtContact > 1.9 && r.deceleration > 5 * G, `the ball is decelerated by the cloth (peak ${r.deceleration} m/s^2)`);
  // Momentum of ball + cloth against the impulse of gravity and of the supports over 1.25 s of bouncing. The cloth's side
  // is exact in float64; the ball's velocity is float32 (1e-7 of 2 m/s per step). Measured 1.6e-6 of the momentum exchanged.
  near(r.momentumChange, r.impulse, 1e-5 * r.exchanged, 'momentum change = impulse of gravity and reactions');
  // At rest (the ball still creeps at 4e-5 m/s) the supports carry both weights. Measured 1.3e-5.
  within(r.reaction, r.weight, 1e-4, 'support reactions = weight of cloth + ball');
  within(r.force, r.ballWeight, 1e-4, 'the cloth holds the ball up with its weight');
  assert.ok(r.contacts >= 4, 'the ball rests on several nodes');
  // The same problem solved as statics, with the ball as an unknown: the heights agree to 4e-7 m of a 97 mm sag.
  assert.ok(r.staticConverged);
  // The static solve stops at a residual of 1e-8 of the largest nodal force; forty support nodes add up to 3e-8 here.
  within(r.staticReaction, r.weight, 1e-6, 'statics: reactions = weight');
  near(r.height, r.staticHeight, 5e-6, 'rest height of the ball against the static solve');
  t.diagnostic(`trampoline: momentum mismatch ${sci(Math.abs(r.momentumChange - r.impulse) / r.exchanged)} of ${r.exchanged.toFixed(2)} N s; at rest reactions ${sci(rel(r.reaction, r.weight))}, force on the ball ${sci(rel(r.force, r.ballWeight))}, ball speed ${sci(r.speed)} m/s; rest height ${r.height.toFixed(6)} m against ${r.staticHeight.toFixed(6)} m from statics (${sci(r.height - r.staticHeight)} m); peak deceleration ${(r.deceleration / G).toFixed(1)} g`);
});

test('a cloth draped over a box on a spring scale adds exactly its weight', async t => {
  const r = await S.scale(K), blind = await S.scale(K, {estimateSupports: false});
  // The scale is a spring joint of the rigid world, calibrated by the box alone. Its extra sag of 1.55 mm is read from a
  // float32 position (ulp 2e-9 m near 0.03 m, and the box still moves by 1e-7 m): 1e-4 is ten times the measured 1.2e-5.
  within(r.reading, r.weight, 1e-4, 'the scale reads the weight of the cloth');
  within(r.force, r.weight, 1e-5, 'the cloth pushes the box down with its weight');
  assert.ok(r.hang > 0.1, 'the cloth hangs over the edges: the box carries cloth that does not touch it');
  assert.equal(r.unconverged, 0);
  // Without the support estimate the cloth still weighs the same, but it expects the box to fall each step and so sits
  // about (n + 1) / (2 n) g dt^2 = 0.11 mm into it.
  within(blind.reading, blind.weight, 1e-4, 'without the support estimate: the same reading');
  assert.ok(Math.abs(r.gap) < 5e-6 && blind.gap < -5e-5, `resting gap ${r.gap} m with the estimate, ${blind.gap} m without`);
  t.diagnostic(`scale: reading error ${sci(rel(r.reading, r.weight))}, contact force error ${sci(rel(r.force, r.weight))}, extra sag ${(1e3 * r.sag).toFixed(4)} mm, cloth hangs ${(1e3 * r.hang).toFixed(0)} mm below the box top, ${r.contacts} nodes touching; resting gap error ${sci(r.gap)} m (${sci(blind.gap)} m without the support estimate)`);
});

test('a body hanging from a strip stretches it by m g L / (E t w)', async t => {
  const r = await S.hangingBody(K);
  assert.equal(r.blewUp, false); assert.equal(r.unconverged, 0);
  // Against the exact law element by element only float32 is left: one ulp of the body's position near 1.05 m is 1.2e-7 m,
  // 6e-5 of the 1.97 mm stretch. Against the linear formula the law's 1.5 e shows (e = 2e-3).
  near(r.stretch, r.exact, 2.5e-7, 'stretch against the exact law');
  within(r.stretch, r.linear, 2 * r.strain, 'stretch against m g L / (E t w) + rho g L^2 / (2 E t)');
  within(r.reaction, r.weight, 1e-6, 'the top edge carries body + strip');
  within(r.force, r.bodyWeight, 1e-6, 'the strip pulls the body up with its weight');
  t.diagnostic(`hanging body: stretch ${sci(r.stretch)} m, exact law ${sci(r.exact)} m (difference ${sci(r.stretch - r.exact)} m), linear formula error ${sci(rel(r.stretch, r.linear))}; reaction error ${sci(rel(r.reaction, r.weight))}, attachment force error ${sci(rel(r.force, r.bodyWeight))}`);
});

test('a light body on a stiff cloth is stable; naive staggering blows up', async t => {
  // 40 g on a strip of stiffness k = E t w / L. The number that matters is k dt^2 / m.
  const rows = [];
  for (const ratio of [0.05, 0.25, 3, 868, 1e4]) {
    const youngModulus = ratio / 8.68e-8, implicit = await S.hangingBody(K, {youngModulus, density: 20, probe: true}), naive = await S.hangingBody(K, {youngModulus, density: 20, probe: true, scheme: 'naive-staggered'});
    rows.push({ratio: implicit.stiffnessRatio, implicit, naive});
    // Released at the unstretched length the body can at most swing at g / omega = g dt / sqrt(k dt^2 / m). The strip weighs
    // as much as the body here and a third of it swings along, which lowers omega by 15%: the bound allows 30%.
    assert.equal(implicit.blewUp, false);
    assert.ok(implicit.fastest <= 1.3 * G * DT / Math.sqrt(implicit.stiffnessRatio) + 1e-4, `k dt^2 / m = ${ratio}: implicit coupling stays within the physical swing (${implicit.fastest} m/s)`);
  }
  // The naive scheme is fine while the cloth is soft against the body's inertia, throws the body about from a ratio of
  // about 0.25 (9 m/s where the right answer peaks at 0.09), and overflows from about 3.
  assert.ok(rows[0].naive.fastest < 0.5, 'naive, ratio 0.05: still bounded');
  assert.ok(rows[1].naive.fastest > 10 * rows[1].implicit.fastest, 'naive, ratio 0.25: already wrong');
  for (const row of rows.slice(2)) assert.equal(row.naive.blewUp, true, `naive, ratio ${row.ratio}: blows up`);
  t.diagnostic(`fastest body speed in 1 s, implicit / naive: ${rows.map(row => `k dt^2/m = ${row.ratio.toPrecision(3)}: ${sci(row.implicit.fastest)} / ${row.naive.blewUp ? 'blew up' : sci(row.naive.fastest)}`).join('; ')}`);
  // And at rest on the stiffest: the strip carries the weight.
  const rest = await S.hangingBody(K, {youngModulus: 1e10, density: 20});
  within(rest.reaction, rest.weight, 1e-6, 'stiff strip, light body: reaction = weight');
  within(rest.force, rest.bodyWeight, 1e-6, 'stiff strip, light body: attachment force = weight');
});

test('self-collision: stacked sheets carry their weight a thickness apart', t => {
  const r = S.stack(K);
  assert.equal(r.unconverged, 0); assert.equal(r.dropped, 0);
  // At rest every sheet rests on the one below through the repulsion, and the plane carries all three. Residual 1e-6 of a nodal weight.
  within(r.support, r.weight, 1e-6, 'the plane carries the three sheets');
  // The gap is the thickness less force / stiffness: 0.9999 of it under one and two sheets.
  for (const gap of r.gaps) assert.ok(gap > 0.99 && gap <= 1.0001, `layers sit ${gap} thicknesses apart`);
  assert.ok(r.nearest > 0.99, `nearest approach ${r.nearest} thicknesses`);
  assert.ok(r.kinetic < 1e-9, 'at rest');
  t.diagnostic(`stack: support error ${sci(rel(r.support, r.weight))}, gaps ${r.gaps.map(g => g.toFixed(5)).join(', ')} thicknesses, nearest node-triangle distance ${r.nearest.toFixed(5)}, ${r.pairs} pairs pressing`);
});

test('self-collision: a folded cloth pressed by a box keeps its layers apart', async t => {
  const r = await S.foldPress(K), without = await S.foldPress(K, {selfCollision: false});
  assert.equal(r.dropped, 0);
  // Stated guarantee: the gap stays above thickness - force per pair / stiffness. Here 0.02 N per pair on 2e4 N/m: 0.9997.
  // Asserted: 0.95 of the thickness at every sampled step of the drop and at rest (measured 0.999).
  assert.ok(r.nearest > 0.95 && r.final > 0.95, `layers stay ${r.nearest} thicknesses apart during the press, ${r.final} at rest`);
  assert.ok(r.layerGap > 0.95, `the upper layer rests ${r.layerGap} thicknesses above the lower one`);
  // The plane under the fold carries the box and the cloth. The box still settles (linear damping 2 /s): 1e-4.
  within(r.support, r.weight, 1e-4, 'the plane carries box + cloth');
  within(r.boxForce, r.boxWeight, 1e-4, 'the cloth carries the box');
  // Without self-collision the same box presses the upper layer through the lower one.
  assert.ok(without.final < 1e-3 && without.layerGap < 0.01, 'without self-collision the layers pass through each other');
  t.diagnostic(`fold: nearest approach ${r.nearest.toFixed(4)} thicknesses during the press, ${r.final.toFixed(4)} at rest, upper layer ${r.layerGap.toFixed(4)} above the lower; support error ${sci(rel(r.support, r.weight))}; ${r.pairs} pairs pressing, ${r.forcePerPair.toFixed(3)} N each, ${r.unconverged} unconverged steps; without self-collision the layers end ${sci(without.final)} thicknesses apart`);
});

test('determinism: repeat runs are bit-identical, and the Simulation loop adds nothing', async t => {
  const first = await S.fingerprint(K), second = await S.fingerprint(K), looped = await S.fingerprint(K, {simulation: true});
  assert.equal(first.hash, second.hash, 'two runs give the same bits (cloth float64 state and the world hash)');
  assert.equal(looped.hash, first.hash, 'a run through the Simulation is bit-identical to coupling.step(); world.step()');
  // Events: the ball lands on the cloth and is thrown off again.
  assert.ok(looped.events.some(e => e.endsWith('contact-begin')) && looped.events.some(e => e.endsWith('contact-end')), `contact events ${looped.events}`);
  // The ledger: the cloth's energy less the work done on it never rises (backward Euler, drag and friction only take).
  assert.ok(looped.balanceRise <= 1e-9, `cloth energy balance never rises (largest rise ${looped.balanceRise} J)`);
  const entry = looped.energy.entries.find(e => e.id === 'cloth');
  assert.equal(entry.kind, 'cloth-coupling'); assert.equal(entry.domain, 'mechanical');
  near(entry.total, Object.values(entry.parts).reduce((a, b) => a + b, 0), 1e-12, 'total = sum of the parts');
  assert.ok(looped.energy.entries.some(e => e.id === 'rigid'), 'the tracked bodies are in the ledger');
  t.diagnostic(`fingerprint ${first.hash}; events ${looped.events.join(' ')}; cloth balance ${entry.balance.toFixed(4)} J after ${sci(entry.exchanged)} J of work, largest rise ${sci(looped.balanceRise)} J`);
});

test('clothSubsystem: stage, order, time-step rule and diagnostics', async () => {
  const world = await createWorld({step: DT, subSteps: 4, ground: false});
  try {
    const grid = clothGrid({nx: 3, ny: 3, u: [0.3, 0, 0], v: [0, 0, 0.3], origin: [0, 1, 0]}), material = {arealDensity: 0.3, youngModulus: 1e6, thickness: 1e-3, poissonRatio: 0.3};
    const make = dt => new Cloth({positions: grid.positions, triangles: grid.triangles, pinned: [0], material, config: {dt}});
    const coupled = new ClothCoupling(world, make(DT)), sub = clothSubsystem(coupled);
    assert.equal(sub.stage, 'couple'); assert.equal(sub.order, CLOTH_SUBSYSTEM_ORDER); assert.deepEqual(sub.timeStep, {dt: DT, rule: 'equal'}); assert.equal(sub.kind, 'cloth-coupling');
    const sim = createSimulation(world).add(sub);
    assert.deepEqual(sim.order().map(row => row.id), ['cloth', 'world', 'events']);
    sim.step(); sim.step();
    assert.equal(coupled.cloth.stats.steps, 2); assert.equal(coupled.steps, 2);
    const d = sim.diagnostics().subsystems.cloth;
    assert.equal(d.solver, CLOTH_SOLVER_ID); assert.equal(d.backend, CLOTH_COUPLING_BACKEND); assert.equal(d.nodes, 16);
    // A coupled cloth cannot be sub-cycled; a bare one may take whole fractions or multiples of the step.
    assert.throws(() => new ClothCoupling(world, make(DT / 2)), e => e instanceof EngineError && /must be equal/.test(e.message));
    const bare = clothSubsystem(make(DT / 2), {id: 'flag'});
    assert.equal(bare.stage, 'post'); assert.equal(bare.timeStep.rule, 'commensurate');
    sim.add(bare); sim.step();
    assert.equal(sim.get('flag') !== undefined, true);
    assert.throws(() => sim.add(clothSubsystem(make(DT / 2.5), {id: 'odd'})), e => e instanceof EngineError && e.code === 'INVALID_STATE');
    assert.throws(() => clothSubsystem({}), TypeError);
    sim.dispose();
  } finally { world.dispose(); }
});

test('construction refuses bad meshes, shapes and options', async () => {
  const material = {arealDensity: 0.3, youngModulus: 1e6, thickness: 1e-3, poissonRatio: 0.3}, config = {dt: DT};
  const bad = (definition, pattern) => assert.throws(() => new Cloth({material, config, ...definition}), e => e instanceof EngineError && e.code === 'INVALID_PAYLOAD' && pattern.test(e.message), String(pattern));
  const square = [0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0];
  bad({positions: square, triangles: [0, 1, 2, 0, 3, 2]}, /not consistently oriented/);
  bad({positions: [...square, 0.5, 0.5, 1], triangles: [0, 1, 2, 0, 2, 3, 0, 2, 4]}, /More than two triangles/);
  bad({positions: square, triangles: [0, 1, 1]}, /repeats a node/);
  bad({positions: [0, 0, 0, 1, 0, 0, 2, 0, 0], triangles: [0, 1, 2]}, /no area/);
  bad({positions: square, triangles: [0, 1, 2]}, /belongs to no triangle/);
  bad({positions: square, triangles: [0, 1, 2, 0, 2, 3], selfCollision: {thickness: 0.4}}, /half the smallest triangle height/);
  bad({positions: square, triangles: [0, 1, 2, 0, 2, 3], material: {...material, poissonRatio: 0.5}}, /poissonRatio/);
  bad({positions: square, triangles: [0, 1, 2, 0, 2, 3], material: {...material, membrane: 'pbd'}}, /membrane/);
  const sheet = new Cloth({positions: square, triangles: [0, 1, 2, 0, 2, 3], material, config});
  // Bending stiffness is the plate value unless stated.
  near(sheet.bendingStiffness, 1e6 * 1e-9 / (12 * (1 - 0.09)), 1e-18, 'D = E t^3 / (12 (1 - nu^2))');
  near(sheet.membraneStiffness, 1e3, 0, 'Y = E t');
  near(sheet.mass(), 0.3, 1e-15, 'mass = areal density times area');
  assert.throws(() => sheet.addBody({shape: {kind: 'hull', points: []}, type: 'static', position: [0, 0, 0], rotation: [0, 0, 0, 1]}), /Hulls, triangle meshes and height fields are not/);
  assert.throws(() => sheet.addBody({shape: {kind: 'plane', normal: [0, 1, 0]}, type: 'dynamic', mass: 1, position: [0, 0, 0], rotation: [0, 0, 0, 1]}), /plane cannot be a dynamic body/);
  assert.throws(() => sheet.attach(0, 3), /not a body/);
  const midpoint = new Cloth({positions: square, triangles: [0, 1, 2, 0, 2, 3], material, config: {dt: DT, integrator: 'midpoint'}});
  assert.throws(() => midpoint.addBody({shape: {kind: 'sphere', radius: 1}, type: 'static', position: [0, -5, 0], rotation: [0, 0, 0, 1]}), /midpoint integrator has no contact/);
  const world = await createWorld({step: DT, subSteps: 4, ground: false});
  try {
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.1}, position: [0, 5, 0]}), coupling = new ClothCoupling(world, sheet);
    coupling.addBody(ball, {shape: {kind: 'sphere', radius: 0.1}});
    assert.throws(() => coupling.addBody(ball, {shape: {kind: 'sphere', radius: 0.1}}), /already coupled/);
    assert.throws(() => coupling.attach(0, world.createBody({shape: {kind: 'sphere', radius: 0.1}, position: [3, 5, 0]})), /not coupled/);
    assert.throws(() => new ClothCoupling(world, midpoint), /backward-euler/);
    assert.throws(() => new ClothCoupling({}, sheet), TypeError);
  } finally { world.dispose(); }
});
