// Contact and friction between deformable solids, and of a solid with itself (`SolidSolidContact`,
// box3d-webgpu-kit/solid-contact), against closed-form answers. SI units. The set-ups live in
// solid-solid-contact-scenarios.mjs, which the validation report runs as well. Every tolerance says where it comes from;
// measured values are printed and recorded in docs/SOLID_CONTACT.md. Nothing here depends on wall-clock time.
//
// What sets the tolerances:
//  - A contact is a spring of stiffness stiffnessScale (lambda + 2 mu) / l per unit of facing area (of the softer body),
//    and each pair of bodies is searched both ways, so an interface under pressure p closes by p l / (2 scale M).
//  - The default method is the mortar (segment to segment): it passes the contact patch test on surface meshes that do
//    not match (element stress uniform to 4e-4 below). The node-to-face method of version 1 (method: 'node-face') does
//    not: the interface pressure is uneven from node to node (5.5 % in element stress on the default pair), the total
//    force is not. v23-solid-solid-mortar.test.mjs has the patch test of both.
//  - Backward Euler takes (w h)^2 of the energy of a mode per step: impacts lose energy, they never gain it.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld, EngineError} from 'box3d-webgpu-kit';
import {createSimulation} from 'box3d-webgpu-kit/simulation';
import {encodeState} from '../dist/core/checkpoint.js';
import * as solid from 'box3d-webgpu-kit/solid';
import * as contact from 'box3d-webgpu-kit/solid-contact';
import * as S from './solid-solid-contact-scenarios.mjs';

const {SolidSolidContact, solidSolidContactSubsystem, SOLID_SOLID_CONTACT_SOLVER_ID} = contact;
const {SolidBody, boxMesh} = solid;
const K = {...solid, ...contact, createSimulation};
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const sci = x => Number(x).toExponential(2), pct = x => `${(100 * x).toFixed(2)}%`;
const invalid = fn => assert.throws(fn, error => error instanceof EngineError && error.code === 'INVALID_PAYLOAD');

test('the solver names itself and refuses what it cannot do', () => {
  assert.equal(SOLID_SOLID_CONTACT_SOLVER_ID, 'solid-solid-contact-mortar-penalty-newton-pcg-js-f64-v2');
  const mesh = boxMesh({size: [1, 1, 1], cells: [1, 1, 1]}), material = {youngModulus: 1e6, poissonRatio: 0.3, density: 1000};
  const a = new SolidBody({mesh, material}), b = new SolidBody({mesh: boxMesh({size: [1, 1, 1], cells: [1, 1, 1], origin: [0, 1, 0]}), material});
  invalid(() => new SolidSolidContact([]));
  invalid(() => new SolidSolidContact([a, a]));
  invalid(() => new SolidSolidContact([a, new SolidBody({mesh, material, config: {integrator: 'midpoint'}})]));
  invalid(() => new SolidSolidContact([a, new SolidBody({mesh, material, config: {dt: 1 / 60}})]));
  invalid(() => new SolidSolidContact([a, b], {selfContact: [2]}));
  const c = new SolidSolidContact([a, b]);
  invalid(() => c.setFriction(0, 0, 0.3));
  c.setFriction(0, 1, 0.3); c.addPlane({normal: [0, 1, 0]}); c.step();
  invalid(() => c.addPlane({normal: [0, 1, 0]}));
  assert.equal(c.solver, SOLID_SOLID_CONTACT_SOLVER_ID);
});

test('two elastic blocks pressed together are springs in series: delta A / (L1 / E1 + L2 / E2 + contact springs)', t => {
  // Surface meshes that match (4 x 4 cells on both, the same diagonals): the uniform state is the answer, to the solve.
  const match = S.seriesBlocks(K, {cellsA: [4, 4, 4], cellsB: [4, 4, 4]});
  t.diagnostic(`matching meshes: force ${match.force} N against ${match.exact} N (${sci(match.error)}); element stress within ${sci(match.worstStress)} of uniform; ${match.contacts} contacts, ${match.passes} passes`);
  assert.ok(match.converged);
  // 1e-6: the solve tolerance and the 8e-9 m by which the two search directions' gaps differ.
  near(match.error, 0, 1e-6, 'matching meshes: force');
  near(match.worstStress, 0, 1e-3, 'matching meshes: uniform stress');
  within(match.back, match.force, 1e-12, 'action and reaction');
  // 3 x 3 x 3 against 4 x 4 x 4 cells, E 1 and 3 GPa, nu 0.3 and 0.2: the total force is the series one, and with the
  // mortar the pressure is even too.
  const rows = [['3 on 4 cells', {}], ['5 on 7 x 6 x 7 cells', {cellsA: [5, 5, 5], cellsB: [7, 6, 7]}], ['E2 = 100 E1', {E1: 1e8, E2: 1e10}], ['corotational', {model: 'corotational'}], ['stiffnessScale 1000', {stiffnessScale: 1000}]];
  for (const [label, options] of rows) {
    const r = S.seriesBlocks(K, options);
    t.diagnostic(`${label}: force ${r.force.toFixed(3)} N against ${r.exact.toFixed(3)} N (${sci(r.error)}; ${sci(r.errorRigid)} without the springs' compliance); element stress within ${pct(r.worstStress)} of uniform; depth ${sci(r.depth)} m; ${r.contacts} contacts`);
    assert.ok(r.converged, label);
    // 1e-6: measured 3e-10 to 1e-8 with the mortar (5e-5 to 2.4e-4 node to face, which fails the patch test).
    near(r.error, 0, 1e-6, `${label}: force`);
    // Element stress: measured 1.8e-4 to 3.9e-4 (5.5 to 6 % node to face, 30 % for a modulus ratio of 100). What is left
    // sits at the rim, where the two blocks spread sideways by different Poisson strains.
    assert.ok(r.worstStress < 1e-3, `${label}: element stress ${r.worstStress}`);
  }
  // The worst case for node against face: nodes that coincide while the surface diagonals differ (3 on 3 cells).
  const worst = S.seriesBlocks(K, {cellsA: [3, 3, 3], cellsB: [3, 3, 3]}), old = S.seriesBlocks(K, {cellsA: [3, 3, 3], cellsB: [3, 3, 3], method: 'node-face'});
  t.diagnostic(`coincident nodes, crossed diagonals: force ${sci(worst.error)}, element stress within ${pct(worst.worstStress)}; node to face ${pct(old.error)} and ${pct(old.worstStress)}`);
  near(worst.error, 0, 1e-6, 'crossed diagonals: force (measured 1e-8; node to face -1.5 %)');
  assert.ok(worst.worstStress < 1e-3, `crossed diagonals: element stress ${worst.worstStress} (node to face 42 %)`);
  near(old.error, -0.015, 0.002, 'node to face keeps its version-1 answer');
});

test('Hertz: two elastic caps pressed together, with the mesh study', t => {
  const runs = [[8, 4], [12, 6], [16, 8]].map(([n, m]) => S.hertzCaps(K, n, m));
  for (const r of runs) t.diagnostic(`${r.cellsPerRadius} cells per contact radius (${r.nodes} nodes): F ${r.force.toFixed(3)} N, Hertz ${r.exact.toFixed(3)} N (${pct(r.error)}), with the layer factor ${r.layer.toFixed(4)} ${pct(r.errorLayer)}; ${r.contacts} contacts, ${r.passes} passes, ${r.newton} Newton and ${r.linear} inner iterations`);
  for (const r of runs) assert.ok(r.converged);
  // Linear tetrahedra: too stiff, converging from above. Measured with the mortar +15.8 %, +8.7 %, +5.7 % (node to face
  // +15.3 %, +8.5 %, +5.9 %; +9.4 % and +6.8 % for the rigid sphere of v17 on the two finer meshes). The bounds are the
  // measured values plus a margin.
  assert.ok(runs[0].errorLayer > 0 && runs[0].errorLayer < 0.18, `coarse ${runs[0].errorLayer}`);
  assert.ok(runs[1].errorLayer > 0 && runs[1].errorLayer < 0.11, `medium ${runs[1].errorLayer}`);
  assert.ok(runs[2].errorLayer > 0 && runs[2].errorLayer < 0.08, `fine ${runs[2].errorLayer}`);
  assert.ok(runs[2].errorLayer < runs[1].errorLayer && runs[1].errorLayer < runs[0].errorLayer, 'the error falls with the mesh');
  // Unequal bodies: a modulus ratio of 5, and a cap on a flat block. Same meshes, same error: E* and R* are what the formula says.
  const stiff = S.hertzCaps(K, 8, 4, {E2: 5e6}), flat = S.hertzCaps(K, 8, 4, {R1: Infinity, R2: 1});
  t.diagnostic(`E2 = 5 E1: ${pct(stiff.errorLayer)}; flat against R = 1 m: ${pct(flat.errorLayer)} (equal caps: ${pct(runs[0].errorLayer)})`);
  near(stiff.errorLayer, runs[0].errorLayer, 0.01, 'the modulus ratio enters through E*');
  near(flat.errorLayer, runs[0].errorLayer, 0.01, 'the radii enter through R*');
  // F ~ delta^1.5: half the approach gives 2^-1.5 of the force, less what the contact patch loses in resolution.
  const half = S.hertzCaps(K, 12, 6, {delta: 0.0003125});
  t.diagnostic(`exponent between delta and delta / 2 on the medium mesh: ${(Math.log(runs[1].force / half.force) / Math.log(2)).toFixed(3)}`);
  near(Math.log(runs[1].force / half.force) / Math.log(2), 1.5, 0.12, 'F ~ delta^1.5');
});

test('momentum in a free impact of two solids', t => {
  for (const friction of [0.3, 0]) {
    const r = S.impact(K, {friction});
    t.diagnostic(`friction ${friction}: |p| ${r.momentum} kg m/s, worst change ${sci(r.worstLinear)}; |L| ${r.angular}, worst change ${sci(r.worstAngular)} (${sci(r.worstAngular / r.angular)}); contact for ${r.touched} steps, at most ${r.most} contacts; kinetic ${r.energyBefore.toFixed(4)} J to ${r.energyAfter.toFixed(4)} J; v_A ${r.vA.map(v => v.toFixed(3))}, v_B ${r.vB.map(v => v.toFixed(3))}`);
    assert.ok(r.touched > 5 && r.contactsAtEnd === 0, 'they met and parted');
    assert.equal(r.unconverged, 0);
    // The contact forces sum to zero term by term; what is left is the Newton tolerance (1e-10 of the force scale) over 400 steps.
    near(r.worstLinear / r.momentum, 0, 1e-8, 'linear momentum');
    // The contact points are frozen during a step: the pair of forces has an arm of the order of the slip in that step.
    near(r.worstAngular / r.angular, 0, 3e-3, 'angular momentum (measured 6.5e-4 with friction, 1.4e-3 without)');
    assert.ok(r.energyRise <= 1e-9 * r.energyBefore, `the energy never rises: ${r.energyRise}`);
    assert.ok(r.energyAfter < r.energyBefore);
    near(r.massA * r.vA[0] + r.massB * r.vB[0], r.massA * 1 - r.massB * 0.5, 1e-8, 'm_A v_A + m_B v_B');
  }
  assert.equal(S.impact(K).bits, S.impact(K).bits, 'repeat runs are identical to the bit');
});

test('a stack of three soft blocks comes to rest: every interface carries the weight above it', t => {
  const r = S.stack(K);
  t.diagnostic(`plane ${r.ground} N (weight ${r.weights[0] * 3}); lower interface ${r.low} N, upper ${r.high} N; speed ${sci(r.speed)} m/s, sideways drift ${sci(r.drift)} m; top settles ${sci(r.settle)} m (bars in series: ${sci(r.expected)}); depth ${sci(r.depth)} m; ${r.contacts} contacts`);
  assert.equal(r.unconverged, 0);
  // 1e-6 of the weight: the stack has stopped (mass damping 5 / s for 2 s), the forces are those of statics.
  within(r.ground, 3 * r.weights[0], 1e-6, 'the plane carries all three');
  within(r.low, 2 * r.weights[0], 1e-6, 'the lower interface carries two');
  within(r.high, r.weights[0], 1e-6, 'the upper interface carries one');
  assert.ok(r.speed < 1e-9 && r.drift < 1e-9, 'at rest, where it was put');
  // The shortening of three bars under their own and each other's weight; friction at the interfaces holds the Poisson
  // expansion back (uniaxial strain there), which makes the stack up to 10 % stiffer than free bars.
  assert.ok(r.settle > 0.85 * r.expected && r.settle < 1.02 * r.expected, `settlement ${r.settle} against ${r.expected}`);
});

test('Coulomb friction between two solids: sticks below tan(theta) = mu, slides at g (sin - mu cos) above', t => {
  for (const degrees of [10, 15]) {
    const r = S.incline(K, degrees);
    t.diagnostic(`${degrees} deg, mu 0.3: travel ${sci(r.travel)} m, speed ${sci(r.speed)} m/s, shear ${r.shear} N (m g sin ${r.shearStick}), normal ${r.normal} N (m g cos ${r.normalExact})`);
    assert.ok(Math.abs(r.speed) < 1e-9 && r.travel < 1e-5, 'it stays');
    within(r.shear, r.shearStick, 1e-6, 'the interface carries m g sin(theta)');
    within(r.normal, r.normalExact, 1e-6, 'and m g cos(theta)');
  }
  const slide = S.incline(K, 25), free = S.incline(K, 25, {friction: 0, seconds: 0.3});
  t.diagnostic(`25 deg, mu 0.3: a ${slide.acceleration} m/s^2 (exact ${slide.exact}), shear ${slide.shear} N (mu m g cos ${slide.shearSlide}); mu 0: a ${free.acceleration} (exact ${free.exact})`);
  // 1e-3: the block is deformable, so its mean velocity carries its own vibration; measured 8e-6 and 1e-3.
  within(slide.acceleration, slide.exact, 1e-3, 'sliding acceleration');
  within(slide.shear, slide.shearSlide, 1e-3, 'friction force mu N');
  within(free.acceleration, free.exact, 2e-3, 'frictionless acceleration');
  assert.equal(slide.unconverged, 0);
});

test('self-contact: the arms of a slotted block stop at each other', t => {
  const on = S.closingSlot(K), off = S.closingSlot(K, {selfContact: false});
  t.diagnostic(`with self-contact: force ${on.rows.map(r => r.force.toFixed(2)).join(', ')} N, ${on.rows.map(r => r.contacts).join(', ')} contacts, deepest ${sci(on.depth)} m; without: ${off.rows.map(r => r.force.toFixed(2)).join(', ')} N, mouth ${off.rows.map(r => (1e3 * r.opening).toFixed(2)).join(', ')} mm`);
  assert.ok(on.rows.every(r => r.converged) && off.rows.every(r => r.converged));
  for (let i = 0; i < 4; i++) within(on.rows[i].force, off.rows[i].force, 1e-9, 'before the arms meet nothing changes');
  assert.equal(on.rows[3].contacts, 0); assert.ok(on.rows[5].contacts >= 2, 'the arms touch');
  assert.ok(off.rows[5].opening < -0.004, 'without self-contact the upper arm goes 5 mm through the lower one');
  // With it the arms rest on each other: the contact is a few hundredths of a millimetre deep and the force more than doubles.
  assert.ok(on.depth < 5e-5, `depth ${on.depth}`);
  assert.ok(on.rows[5].force > 2 * off.rows[5].force, 'the closed slot is stiffer');
});

test('checkpoints and the stepping loop: a stack with friction resumes bit for bit, alone and as a subsystem', async () => {
  const run = (from, to, c) => { for (let i = from; i < to; i++) c.step(); };
  const a = S.makeStack(K).contact; run(0, 60, a); const saved = a.saveState(), early = encodeState(saved); run(60, 140, a); const expected = encodeState(a.saveState());
  const b = S.makeStack(K).contact; b.step(7); b.restoreState(saved); run(60, 140, b);
  assert.deepEqual(encodeState(b.saveState()), expected, 'resume');
  assert.throws(() => S.makeStack(K).contact.restoreState({...saved, solids: saved.solids.slice(0, 2)}), error => error instanceof EngineError && error.code === 'CHECKPOINT_MISMATCH');
  // The same group in the stepping loop beside a rigid world: one group step per simulation step, and a resume of the loop.
  const world = await createWorld({step: 1 / 240, subSteps: 4, ground: false});
  try {
    const s = S.makeStack(K), sim = createSimulation(world); sim.add(solidSolidContactSubsystem(s.contact));
    for (let i = 0; i < 60; i++) sim.step();
    assert.deepEqual(encodeState(s.contact.saveState()), early, 'the loop takes the same steps');
    const entry = sim.energy().entries.find(e => e.id === 'solid-solid-contact');
    assert.ok(entry && Number.isFinite(entry.total) && entry.parts.contact > 0);
    const checkpoint = sim.checkpoint(); for (let i = 60; i < 140; i++) sim.step();
    assert.deepEqual(encodeState(s.contact.saveState()), expected);
    sim.restore(checkpoint); for (let i = 60; i < 140; i++) sim.step();
    assert.deepEqual(encodeState(s.contact.saveState()), expected, 'resume through the loop');
  } finally { world.dispose(); }
});
