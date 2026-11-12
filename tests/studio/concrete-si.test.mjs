// The concrete crush lab in SI units (src/studio/material-labs/concrete-si.ts): a cube of the concrete law
// (src/engine/concrete-law.ts) between steel platens through SolidContact. Run: node --test tests/studio/concrete-si.test.mjs
// (npm run test:studio:materials). The engine law itself is tested in tests/engine/solid-concrete.test.mjs.
import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {cubeAndCylinder} from '../../validation/domains/concrete.mjs';
const {ConcreteModel, concreteSpec, ec2Curve, PLATEN_FRICTION, CONCRETE_DRAW_SCALE, liveFaces} = await import('../../src/studio/material-labs/concrete-si.ts');
const {materialProperty} = await import('../../src/engine/materials.ts');
const {LABS, MATERIALS, normalizeSettings} = await import('../../src/studio/material-labs/catalog.ts');
const {labWorkerHandler} = await import('../../src/studio/material-labs/lab-worker-protocol.ts');
const preset = (id, extra = {}) => normalizeSettings('concrete', {...LABS.concrete.defaults, ...LABS.concrete.experiments.find(e => e.id === id).settings, ...extra});
const run = (m, seconds) => { for (let i = 0; i < Math.round(seconds * 120); i++) m.step(1 / 120); return m; };

test('SI values: EN 1992-1-1 classes from the library for every mix; reinforcement is marked as not modelled', () => {
  const c30 = concreteSpec('standard').material, lib = id => p => materialProperty(id, p, {allowUnverified: true});
  for (const [p, key] of [['compressiveStrength', 'compressiveStrength'], ['tensileStrength', 'tensileStrength'], ['peakStrain', 'peakStrain'], ['ultimateStrain', 'ultimateStrain'], ['fractureEnergy', 'fractureEnergy']])
    assert.equal(c30.concrete[key], lib('concrete-c30-37')(p), p);
  assert.equal(c30.youngModulus, lib('concrete-c30-37')('youngModulus'));
  assert.equal(concreteSpec('high-strength').material.concrete.compressiveStrength, 68e6);
  assert.equal(concreteSpec('lightweight').material.density, 1850);
  assert.equal(concreteSpec('mortar').libraryId, 'concrete-c20-25');
  assert.equal(concreteSpec('reinforced').modelled, false);
  assert.match(concreteSpec('reinforced').source, /not modelled/);
  assert.ok(concreteSpec('fiber').material.concrete.fractureEnergy > 20 * c30.concrete.fractureEnergy, 'fibres: a much larger G_f (unverified)');
  const ceramic = concreteSpec('ceramic').material;
  assert.equal(ceramic.youngModulus, lib('alumina-96')('youngModulus'));assert.equal(ceramic.concrete.elasticLimit, 1);
  for (const m of MATERIALS.concrete) { const s = concreteSpec(m.id); assert.ok(s.source.length > 20 && s.name.length > 3, m.id); }
  const curve = ec2Curve(concreteSpec('standard'));
  assert.ok(Math.abs(Math.max(...curve.filter((v, i) => i % 2 === 1)) - 38) < 0.01, 'the chart\'s EN 1992-1-1 curve peaks at f_cm (sampled)');
  assert.equal(LABS.concrete.defaults.size, 150);assert.equal(LABS.concrete.defaults.damping, PLATEN_FRICTION);
});

test("the 150 mm cube between frictional steel platens fails above a prism of slenderness 2, the cylinder's (EN 1992-1-1 Table 3.1 gives 37 / 30)", async () => {
  const r = await cubeAndCylinder();
  console.log('# cube and slenderness-2 prism', JSON.stringify(r));
  assert.ok(r.cube.peak > r.cylinder.peak, 'the cube is stronger');
  assert.ok(Math.abs(r.ratio / (37 / 30) - 1) <= 0.1, `ratio ${r.ratio} within 10 % of 37 / 30`);
  assert.ok(Math.abs(r.cylinder.peak / r.cylinder.fcm - 1) < 0.05, 'the prism fails near f_cm');
});

test('frictionless platens: the cube fails at f_cm at eps_c1, the uniaxial curve of the law', () => {
  const m = run(new ConcreteModel(preset('cube-crush', {damping: 0, load: 3, rate: 1})), 3.1);
  const peak = m.peakForce / m.area;
  console.log(`# frictionless cube: ${(peak / 1e6).toFixed(2)} MPa at ${(m.peakStrain * 1e3).toFixed(2)} per mille`);
  assert.ok(Math.abs(peak / 38e6 - 1) < 0.02, `peak ${peak}`);
  assert.ok(Math.abs(m.peakStrain / 0.0022 - 1) < 0.06, `strain at the peak ${m.peakStrain}`);
});

test('cube crush: peak above f_cm, softening, spalling, and the machine stops on the load drop; readouts in MPa, %, kN', () => {
  const p = preset('cube-crush', {rate: 1}), m = new ConcreteModel(p), t = performance.now();
  run(m, p.load / p.rate + 1);
  const [stress, strain, force] = m.frame.metrics, peak = m.peakForce / m.area;
  console.log(`# cube crush: peak ${(peak / 1e6).toFixed(2)} MPa at ${(m.peakStrain * 1e3).toFixed(2)} per mille, stopped "${m.stopped}" at ${strain.toFixed(3)} %, ${m.solid.erodedCount} spalled, ${((performance.now() - t) / 1000).toFixed(1)} s CPU for ${m.frame.time.toFixed(1)} s`);
  assert.ok(peak > 38e6 && peak < 1.4 * 38e6, `platen friction raises the cube's strength above f_cm: ${peak}`);
  assert.ok(m.stopped.length > 0 && m.frame.phase === 'Failed · machine stopped', m.frame.phase);
  assert.ok(m.solid.erodedCount > 0, 'elements spalled');
  assert.ok(stress < 0.75 * peak / 1e6, 'the load fell after the peak');
  assert.ok(Math.abs(force * 1e3 / m.area / 1e6 - stress) < 1e-9 * stress, 'stress = force / area');
  assert.ok(Math.abs(strain - m.measuredStrain() * 100) < 1e-12, 'strain in %');
  assert.ok(m.frame.curve.length >= 2 * 100 && m.frame.curve.every(Number.isFinite), 'the stress-strain curve is recorded');
  assert.ok([...m.frame.damage].some(d => d === 255) && [...m.frame.damage].some(d => d > 0 && d < 255), 'spalled and damaged elements are in the frame');
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
