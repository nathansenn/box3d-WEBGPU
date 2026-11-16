// The concrete crush lab in SI units (src/studio/material-labs/concrete-si.ts): a cube of the concrete law
// (src/engine/concrete-law.ts) between steel platens through SolidContact. Run: node --test tests/studio/concrete-si.test.mjs
// (npm run test:studio:materials). The engine law itself is tested in tests/engine/solid-concrete.test.mjs.
import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {cubeAndCylinder} from '../../validation/domains/concrete.mjs';
const {ConcreteModel, concreteSpec, ec2Curve, PLATEN_FRICTION, CONCRETE_DRAW_SCALE, liveFaces, cylinderMeshOgrid} = await import('../../src/studio/material-labs/concrete-si.ts');
const {materialProperty} = await import('../../src/engine/materials.ts');
const {LABS, MATERIALS, normalizeSettings} = await import('../../src/studio/material-labs/catalog.ts');
const {labWorkerHandler} = await import('../../src/studio/material-labs/lab-worker-protocol.ts');
const preset = (id, extra = {}) => normalizeSettings('concrete', {...LABS.concrete.defaults, ...LABS.concrete.experiments.find(e => e.id === id).settings, ...extra});
const close = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${label}: ${a} vs ${b}`);
const run = (m, seconds) => { for (let i = 0; i < Math.round(seconds * 120); i++) m.step(1 / 120); return m; };

test('SI values: EN 1992-1-1 classes from the library for every mix; the reinforced mix embeds B500B bars', () => {
  const c30 = concreteSpec('standard').material, lib = id => p => materialProperty(id, p, {allowUnverified: true});
  for (const [p, key] of [['compressiveStrength', 'compressiveStrength'], ['tensileStrength', 'tensileStrength'], ['peakStrain', 'peakStrain'], ['ultimateStrain', 'ultimateStrain'], ['fractureEnergy', 'fractureEnergy']])
    assert.equal(c30.concrete[key], lib('concrete-c30-37')(p), p);
  assert.equal(c30.youngModulus, lib('concrete-c30-37')('youngModulus'));
  assert.equal(concreteSpec('high-strength').material.concrete.compressiveStrength, 68e6);
  assert.equal(concreteSpec('lightweight').material.density, 1850);
  assert.equal(concreteSpec('mortar').libraryId, 'concrete-c20-25');
  const rc = concreteSpec('reinforced'), bars = rc.reinforcement(0.15, 0.15).bars;
  assert.equal(rc.modelled, true);assert.match(rc.source, /B500B/);
  assert.equal(bars.length, 6, 'four corner bars and two links');
  assert.equal(bars[0].youngModulus, materialProperty('reinforcing-steel-b500b', 'youngModulus'));assert.equal(bars[0].yieldStress, 500e6);
  assert.ok(Math.abs(bars[0].hardeningModulus - 40e6 / (0.05 - 0.0025)) < 1, 'EN 1992-1-1 3.2.7 (2) a): (k - 1) f_yk / (eps_uk - f_yk / E_s)');
  assert.ok(concreteSpec('fiber').material.concrete.fractureEnergy > 20 * c30.concrete.fractureEnergy, 'fibres: a much larger G_f (unverified)');
  const ceramic = concreteSpec('ceramic').material;
  assert.equal(ceramic.youngModulus, lib('alumina-96')('youngModulus'));assert.equal(ceramic.concrete.elasticLimit, 1);
  for (const m of MATERIALS.concrete) { const s = concreteSpec(m.id); assert.ok(s.source.length > 20 && s.name.length > 3, m.id); }
  const curve = ec2Curve(concreteSpec('standard'));
  assert.ok(Math.abs(Math.max(...curve.filter((v, i) => i % 2 === 1)) - 38) < 0.01, 'the chart\'s EN 1992-1-1 curve peaks at f_cm (sampled)');
  assert.equal(LABS.concrete.defaults.size, 150);assert.equal(LABS.concrete.defaults.damping, PLATEN_FRICTION);
});

test('the 150 mm cube between steel platens (friction 0.2) against the 150 x 300 mm cylinder (EN 1992-1-1 Table 3.1: 37 / 30) and a cylinder of slenderness 1', async () => {
  const r = await cubeAndCylinder();
  console.log('# cube, cylinder, short cylinder', JSON.stringify(r));
  assert.equal(r.friction, PLATEN_FRICTION);
  for (const shape of ['cube', 'cylinder', 'short']) {
    assert.equal(r[shape].unconverged, 0, `${shape}: every step converged, from the first contact on`);
    assert.ok(r[shape].last < 0.995 * r[shape].peak, `${shape}: the run went past its peak`);
  }
  // 5 %: EN 1992-1-1 Table 3.1 gives f_ck,cube / f_ck = 37 / 30 for C30/37; measured 1.20. The friction 0.2 is a sourced
  // model input, not a measured coefficient (docs/STUDIO_MATERIAL_LABS.md): with 0.57 the ratio is 1.43.
  close(r.ratio, 37 / 30, 0.05, 'cube over cylinder');
  // 3 %: the slenderness-1 correction of CSN EN 12390-3/Z1, 1.17, as quoted by Stredulova and Elias (2023); measured 1.16.
  close(r.slenderness, 1.17, 0.03, 'short cylinder over cylinder');
  assert.ok(r.cylinder.peak / r.cylinder.fcm > 1 && r.cylinder.peak / r.cylinder.fcm < 1.12, `cylinder ${r.cylinder.peak / r.cylinder.fcm} f_cm (the platens confine its ends too)`);
});

test('the cylinder mesh: an O-grid of tetrahedra with no flattened corner cell, its section a 12-sided polygon', () => {
  const R = 0.075, H = 0.3, m = cylinderMeshOgrid(R, H, 3, 1, 10), X = m.positions;
  let volume = 0, worst = Infinity;
  for (let e = 0; e < m.tets.length / 4; e++) {
    const p = [0, 1, 2, 3].map(q => [X[3 * m.tets[4 * e + q]], X[3 * m.tets[4 * e + q] + 1], X[3 * m.tets[4 * e + q] + 2]]);
    const a = p[1].map((v, k) => v - p[0][k]), b = p[2].map((v, k) => v - p[0][k]), c = p[3].map((v, k) => v - p[0][k]);
    const v = Math.abs(a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6;
    const edges = [[0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [2, 3]].map(([i, j]) => Math.hypot(...p[i].map((x, k) => x - p[j][k])));
    volume += v; worst = Math.min(worst, 6 * Math.sqrt(2) * v / Math.max(...edges) ** 3);
  }
  close(volume, 6 * Math.sin(Math.PI / 6) * R * R * H, 1e-12, 'the volume of the 12-sided prism');
  assert.ok(worst > 0.05, `smallest volume over the cube of the longest edge (scaled to 1 for a regular tetrahedron): ${worst}`);
  assert.equal(m.tets.length / 4, 1260);
});

test('reinforced core: the bars are embedded, drawn, share the load and report their stress', () => {
  const p = preset('reinforced-core', {rate: 1}), plain = run(new ConcreteModel(preset('cube-crush', {rate: 1})), 1.2), m = run(new ConcreteModel(p), 1.2);
  const bars = m.solid.reinforcementForces().force, compressed = [...bars].filter(f => f < 0).length;
  console.log(`# reinforced core at 1.2 per mille: ${(m.force / 1e3).toFixed(1)} kN against ${(plain.force / 1e3).toFixed(1)} kN plain; ${m.solid.rebar.segmentCount} bar segments, ${compressed} in compression; ${m.frame.status}`);
  assert.ok(m.force > plain.force, 'the bars stiffen the cube');
  assert.ok(compressed > 0.4 * bars.length, 'the corner bars carry compression');
  assert.equal(m.frame.bars.length, 6 * m.solid.rebar.segmentCount);assert.ok(m.frame.bars.every(Number.isFinite));
  assert.match(m.frame.status, /bars at \d+ % of f_yk/);
});

test('frictionless platens: the cube fails at f_cm at eps_c1, the uniaxial curve of the law', () => {
  const m = run(new ConcreteModel(preset('cube-crush', {damping: 0, load: 3, rate: 1})), 3.1);
  const peak = m.peakForce / m.area;
  console.log(`# frictionless cube: ${(peak / 1e6).toFixed(2)} MPa at ${(m.peakStrain * 1e3).toFixed(2)} per mille`);
  assert.ok(Math.abs(peak / 38e6 - 1) < 0.02, `peak ${peak}`);
  assert.ok(Math.abs(m.peakStrain / 0.0022 - 1) < 0.06, `strain at the peak ${m.peakStrain}`);
});

test('cube crush: peak above f_cm, then stable softening to the end of the program; readouts in MPa, %, kN', () => {
  const p = preset('cube-crush', {rate: 1}), m = new ConcreteModel(p), t = performance.now();
  run(m, p.load / p.rate + 1);
  const [stress, strain, force] = m.frame.metrics, peak = m.peakForce / m.area;
  console.log(`# cube crush: peak ${(peak / 1e6).toFixed(2)} MPa at ${(m.peakStrain * 1e3).toFixed(2)} per mille, ${stress.toFixed(2)} MPa at ${strain.toFixed(3)} %, stopped "${m.stopped}", phase "${m.frame.phase}", ${m.solid.erodedCount} spalled, ${m.unconverged} steps without equilibrium, ${((performance.now() - t) / 1000).toFixed(1)} s CPU for ${m.frame.time.toFixed(1)} s`);
  assert.ok(peak > 1.2 * 38e6 && peak < 1.4 * 38e6, `platen friction raises the cube's strength above f_cm (to about 1.3 f_cm at friction 0.2; EN 1992-1-1's mean cube strength is about 38 x 37 / 30 = 46.9 MPa): ${peak}`);
  // With platen friction 0.2 the cube softens under displacement control without losing equilibrium: the machine does not
  // stop within the 8 per mille of the program and no element has yet lost all its strength (with friction 0.57 the run
  // ended in a machine stop at 7.4 per mille: the first baseline of this law).
  assert.equal(m.stopped, '');assert.equal(m.frame.phase, 'Post-peak softening');
  assert.ok(stress < 0.97 * peak / 1e6, 'the load fell after the peak');
  assert.ok([...m.frame.damage].some(d => d > 127), 'elements lost more than half their strength');
  assert.ok(Math.abs(force * 1e3 / m.area / 1e6 - stress) < 1e-9 * stress, 'stress = force / area');
  assert.ok(Math.abs(strain - m.measuredStrain() * 100) < 1e-12, 'strain in %');
  assert.ok(m.frame.curve.length >= 2 * 100 && m.frame.curve.every(Number.isFinite), 'the stress-strain curve is recorded');
  assert.ok([...m.frame.damage].some(d => d > 0 && d < 255), 'damaged elements are in the frame');
  // Drawing: the faces of the elements still present close the solid, and the cube is drawn eight times larger.
  const live = liveFaces(m.solid, e => m.frame.damage[e] !== 255);
  assert.equal(live.faces.length, 3 * live.owners.length);
  assert.ok(Math.abs(m.frame.positions[1] - (0.95 + CONCRETE_DRAW_SCALE * m.solid.positions()[1])) < 1e-5);
});

test('low strain: stops before the peak, nothing spalls, the cube holds', () => {
  const p = preset('low-strain'), m = run(new ConcreteModel(p), p.load / p.rate + 0.5), damaged = [...m.frame.damage].filter(d => d > 0);
  console.log(`# low strain: ${damaged.length} of ${m.solid.tetCount} elements have lost strength, at most ${(Math.max(0, ...damaged) / 2.54).toFixed(1)} %`);
  assert.equal(m.solid.erodedCount, 0);assert.ok(damaged.length < 0.2 * m.solid.tetCount && damaged.every(d => d < 254));
  assert.equal(m.frame.phase, 'Holding');assert.equal(m.unconverged, 0);
  assert.ok(m.frame.metrics[0] > 20 && m.frame.metrics[0] < 43, `stress ${m.frame.metrics[0]} MPa, below the cube's peak (45 MPa)`);
});

test('determinism and the shared lab worker: the same settings repeat bit for bit; the worker runs the concrete lab', () => {
  const a = run(new ConcreteModel(preset('aged-spall')), 1), b = run(new ConcreteModel(preset('aged-spall')), 1);
  assert.deepEqual(a.snapshot(), b.snapshot());
  const handle = labWorkerHandler(), first = handle({type: 'reset', generation: 1, lab: 'concrete', settings: preset('cube-crush')});
  assert.equal(first.type, 'frame');
  const next = handle({type: 'step', generation: 1, request: 1, ticks: 8, release: false});
  assert.equal(next.type, 'frame', next.message);assert.ok(next.frame.time > 0 && next.frame.curve.length >= 2);
});
