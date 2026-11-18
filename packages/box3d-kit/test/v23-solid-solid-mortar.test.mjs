// Mortar (segment-to-segment) and edge-to-edge contact between deformable solids (`SolidSolidContact`,
// box3d-webgpu-kit/solid-contact), against closed-form answers, beside the node-to-face method of version 1. SI units.
// The set-ups live in solid-solid-contact-scenarios.mjs, which the validation report runs as well. Measured values are
// printed and recorded in docs/SOLID_CONTACT.md. Nothing here depends on wall-clock time.
//
// What sets the tolerances:
//  - The mortar integrals are exact for flat faces (three-point rule on each piece of the overlap), so a uniform
//    pressure is carried as a uniform pressure (the contact patch test). What is left, a few 1e-4 of the pressure, sits
//    at the rim: the two blocks spread sideways by different Poisson strains, so a strip of a few micrometres of the
//    softer block's face is not covered. With nu = 0 (the rotated set-up) the answer is exact to the solve.
//  - Hertz is a mesh study: linear tetrahedra are too stiff, the error falls with the mesh.
//  - Edge contact is a point spring of stiffness stiffnessScale (lambda + 2 mu) l: its depth is force / k.
import assert from 'node:assert/strict';
import test from 'node:test';
import {EngineError} from 'box3d-webgpu-kit';
import {encodeState} from '../dist/core/checkpoint.js';
import * as solid from 'box3d-webgpu-kit/solid';
import * as contact from 'box3d-webgpu-kit/solid-contact';
import * as S from './solid-solid-contact-scenarios.mjs';

const {SolidSolidContact, SOLID_SOLID_CONTACT_SOLVER_ID, SOLID_SOLID_CONTACT_NODE_FACE_SOLVER_ID} = contact;
const K = {...solid, ...contact};
const sci = x => Number(x).toExponential(2), pct = x => `${(100 * x).toFixed(2)}%`;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const invalid = fn => assert.throws(fn, error => error instanceof EngineError && error.code === 'INVALID_PAYLOAD');

test('the two methods name themselves; options are checked', () => {
  const mesh = solid.boxMesh({size: [1, 1, 1], cells: [1, 1, 1]}), material = {youngModulus: 1e6, poissonRatio: 0.3, density: 1000};
  const a = new solid.SolidBody({mesh, material}), b = new solid.SolidBody({mesh: solid.boxMesh({size: [1, 1, 1], cells: [1, 1, 1], origin: [0, 1, 0]}), material});
  const mortar = new SolidSolidContact([a, b]), nodeFace = new SolidSolidContact([a, b], {method: 'node-face'});
  assert.equal(mortar.solver, SOLID_SOLID_CONTACT_SOLVER_ID); assert.equal(mortar.method, 'mortar'); assert.equal(mortar.edges, true);
  assert.equal(nodeFace.solver, SOLID_SOLID_CONTACT_NODE_FACE_SOLVER_ID); assert.equal(nodeFace.edges, false);
  assert.equal(new SolidSolidContact([a, b], {edges: false}).edges, false);
  invalid(() => new SolidSolidContact([a, b], {method: 'segment'}));
  invalid(() => new SolidSolidContact([a, b], {edges: 1}));
});

test('contact patch test: a uniform pressure crosses an interface whose meshes do not match, as the monolithic answer', t => {
  const rows = [['3 on 4 cells', {}], ['5 on 7 x 6 x 7 cells', {cellsA: [5, 5, 5], cellsB: [7, 6, 7]}], ['3 on 3 cells, crossed diagonals', {cellsA: [3, 3, 3], cellsB: [3, 3, 3]}],
    ['E2 = 100 E1', {E1: 1e8, E2: 1e10}], ['distorted upper mesh', {distort: 0.04}]];
  for (const [label, options] of rows) {
    const m = S.patchPressure(K, options), n = S.patchPressure(K, {...options, method: 'node-face'});
    t.diagnostic(`${label}: mortar pressure within ${sci(m.pressure)}, element stress ${sci(m.stress)}, displacements ${sci(m.displacement)} of the monolithic answer, force ${m.force.toFixed(6)} N of ${m.forceExact} (${m.passes} passes); node-face ${pct(n.pressure)}, ${pct(n.stress)}, ${sci(n.displacement)}`);
    assert.ok(m.converged && n.converged, label);
    // 1 %: the requirement. Measured 1.6e-4 to 4.4e-4 for moduli within 3 of each other, 4.3e-3 for a ratio of 100 (the
    // uncovered strip at the rim grows with the difference of the Poisson strains).
    assert.ok(m.pressure < (options.E2 ? 0.01 : 1e-3), `${label}: nodal pressure ${m.pressure}`);
    assert.ok(m.stress < (options.E2 ? 0.01 : 1e-3), `${label}: element stress ${m.stress}`);
    assert.ok(m.displacement < 1e-4, `${label}: displacements ${m.displacement}`);
    near(m.force / m.forceExact - 1, 0, 1e-9, `${label}: the force is the applied one`);
    // The node-to-face method fails the patch test: 8.6 % to 77 % here. The comparison shows what the mortar fixes.
    assert.ok(n.pressure > 0.05, `${label}: node-face ${n.pressure}`);
  }
  for (const [label, options] of [['turned 0.7 rad about (1, 2, 3)', {}], ['5 on 7 x 6 x 7 cells, turned', {cellsA: [5, 5, 5], cellsB: [7, 6, 7]}]]) {
    const m = S.patchRotated(K, options), n = S.patchRotated(K, {...options, method: 'node-face'});
    t.diagnostic(`${label}, nu = 0: mortar force ${sci(m.error)}, pressure within ${sci(m.pressure)}, displacements ${sci(m.displacement)} of delta; node-face ${pct(n.pressure)}, ${sci(n.displacement)}`);
    assert.ok(m.converged, label);
    // Nothing spreads sideways with nu = 0: the answer is exact to the solve (measured 1e-10 and below).
    near(m.error, 0, 1e-8, `${label}: force`); assert.ok(m.pressure < 1e-8 && m.displacement < 1e-8, `${label}: ${m.pressure}, ${m.displacement}`);
  }
});

test('Hertz: an elastic sphere on an elastic block, meshes that do not match, with the mesh study', t => {
  // The lower block is flat (R1 = infinity), the sphere R2 = 1 m; their element sizes at the contact differ by 4/3 and 6/5.
  const runs = [[8, 4, [7, 3]], [12, 6, [10, 5]]].map(([n, m, upper]) => S.hertzCaps(K, n, m, {R1: Infinity, R2: 1, upper}));
  for (const r of runs) t.diagnostic(`${r.cellsPerRadius.toFixed(2)} and ${r.cellsPerRadiusUpper.toFixed(2)} cells per contact radius (${r.nodes} nodes): F ${r.force.toFixed(3)} N, Hertz ${r.exact.toFixed(3)} N (${pct(r.error)}), with the layer factor ${pct(r.errorLayer)}; ${r.contacts} contacts, ${r.passes} passes`);
  for (const r of runs) assert.ok(r.converged);
  // Measured +11.1 % and +9.3 % against the layer factor (+16.2 %, +14.3 % against plain Hertz); bounds: measured + 3 %.
  assert.ok(runs[0].errorLayer > 0 && runs[0].errorLayer < 0.14, `coarse ${runs[0].errorLayer}`);
  assert.ok(runs[1].errorLayer > 0 && runs[1].errorLayer < 0.12, `medium ${runs[1].errorLayer}`);
  assert.ok(runs[1].errorLayer < runs[0].errorLayer, 'the error falls with the mesh');
});

test('Coulomb friction at the threshold: a block on a non-matching base sticks at tan(theta) = 0.99 mu and slides at 1.01 mu', t => {
  const [stick, slide] = S.frictionThreshold(K);
  t.diagnostic(`0.99 mu: travel ${sci(stick.travel)} m, speed ${sci(stick.speed)} m/s, shear ${stick.shear} N (m g sin ${stick.shearStick}); 1.01 mu: a ${slide.acceleration} m/s^2 (exact ${slide.exact}), travel ${sci(slide.travel)} m, shear ${slide.shear} N (mu N ${slide.shearSlide})`);
  assert.equal(stick.unconverged + slide.unconverged, 0);
  assert.ok(stick.speed === 0 && stick.travel < 2e-5, 'it stays (the travel is the elastic shear of the block, 12 um)');
  near(stick.shear / stick.shearStick - 1, 0, 1e-6, 'the interface carries m g sin(theta)');
  // Sliding at 1 % above the angle: a = g (sin - mu cos) = 0.028 m/s^2, 2 % of the frictionless one.
  near(slide.acceleration / slide.exact - 1, 0, 0.01, 'sliding acceleration');
  assert.ok(slide.travel > 100 * stick.travel, 'it slides');
  near(slide.shear / slide.shearSlide - 1, 0, 1e-3, 'friction force mu N');
});

test('edge against edge: two square bars on edge, crossed, pressed together', t => {
  for (const angle of [90, 60]) {
    const r = S.crossedBars(K, {angle}), off = S.crossedBars(K, {angle, edges: false});
    t.diagnostic(`${angle} deg: force ${r.force} N, on the lower bar ${r.onLower} N, its supports ${r.lowerSupports} N, the upper bar's ${r.upperSupports} N; ${r.edgeContacts} edge contact, depth ${sci(r.depth)} m, edges ${sci(r.separation)} m apart; without edge contact ${off.contacts} contacts and the edges ${sci(off.separation)} m apart`);
    assert.ok(r.converged, `${angle}`);
    assert.equal(r.edgeContacts, 1);
    // Force balance: action and reaction exactly; the supports of each bar carry the contact force to the solve tolerance.
    assert.equal(r.onLower, -r.force);
    near(r.lowerSupports / r.force - 1, 0, 1e-8, 'the lower bar\'s supports');
    near(r.upperSupports / r.force + 1, 0, 1e-8, 'the upper bar\'s supports');
    // Depth: the spring's, force / k with k = stiffnessScale (lambda + 2 mu) l (1.0e-7 m against a push of 5e-4 m); the
    // geometric separation of the deformed edges is the same.
    near(r.depth, r.force / r.stiffness, 1e-12, 'depth = force / k'); assert.ok(r.depth < 1e-3 * r.push, `depth ${r.depth}`);
    near(r.separation, -r.depth, 1e-12, 'the edges are where the contact says');
    // Without it no node meets a face: the upper bar goes through by the whole push.
    assert.equal(off.contacts, 0); near(off.separation, -r.push, 1e-9, 'without edge contact');
  }
  // With friction (mu 0.3) the same answer, and the static passes settle (the edge pair keeps its friction state).
  const f = S.crossedBars(K, {friction: 0.3}); assert.ok(f.converged); near(f.force / S.crossedBars(K).force - 1, 0, 1e-6, 'friction');
});

test('edge against edge in motion: crossed bars fly at each other edge first and part', t => {
  const on = S.crossedImpact(K), off = S.crossedImpact(K, {edges: false});
  t.diagnostic(`with edge contact: ${on.touched} steps in contact, deepest ${sci(on.deepest)} m, edges at least ${sci(on.separation)} m apart, momentum change ${sci(on.worst)} of ${on.momentum} kg m/s, v_lower ${on.vLower.toFixed(4)}, v_upper ${on.vUpper.toFixed(4)} m/s; without: edges ${sci(off.separation)} m apart`);
  assert.equal(on.unconverged, 0);
  assert.ok(on.touched > 10 && on.most >= 1, 'they met edge on edge');
  // The forces of a row sum to zero: momentum to the Newton tolerance.
  near(on.worst / on.momentum, 0, 1e-8, 'linear momentum');
  // The edges never go deeper than the spring's depth (1 um against the 2.5 mm the bars close in the contact time).
  assert.ok(on.separation > -2e-6, `separation ${on.separation}`);
  assert.ok(on.vLower < 0 && on.vUpper > on.vLower, 'they bounced apart');
  assert.ok(off.separation < -1e-3, 'without edge contact they pass through each other');
  assert.equal(S.crossedImpact(K).bits, on.bits, 'repeat runs are identical to the bit');
});

test('checkpoints: mortar and edge contacts with friction resume bit for bit', () => {
  const run = r => { const c = r.contact; for (let i = 0; i < 40; i++) c.step(); return c; };
  // The crossed bars in mid contact: edge contacts (and their friction state) and the mortar rows are in the state.
  const a = S.crossedImpact(K, {steps: 60}), saved = a.contact.saveState(); run(a); const expected = encodeState(a.contact.saveState());
  const b = S.crossedImpact(K, {steps: 20}); b.contact.restoreState(saved); run(b);
  assert.deepEqual(encodeState(b.contact.saveState()), expected, 'resume');
  assert.ok(saved.eCount > 0, 'an edge contact was pressing when the state was saved');
});
