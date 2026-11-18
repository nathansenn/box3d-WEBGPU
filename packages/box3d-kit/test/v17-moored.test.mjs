// A floating body held by a cable: the structure coupling's interface solve with the water's force in it
// (linkWaterToStructure of box3d-webgpu-kit/simulation, StructureCoupling.addLoadProvider, WaterCoupling.predictLoad).
// SI units. The set-ups are in moored-scenarios.mjs: a slender spar (0.2 m x 0.2 m x 2 m, 32 kg) on a taut vertical
// tether of 1000 N/m in a basin 4 m deep, built by hand so that the link can be left out. `linked: false` is the scheme
// before the link: the interface solve then sees gravity only and places the cable's end where the spar would fall
// to without buoyancy, B dt^2 / m lower. Measured values are printed as diagnostics; nothing depends on wall-clock time.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld} from 'box3d-webgpu-kit';
import {createSimulation, waterSubsystem, structureSubsystem, linkWaterToStructure} from 'box3d-webgpu-kit/simulation';
import {WaterCoupling} from 'box3d-webgpu-kit/coupling';
import {StructureCoupling} from 'box3d-webgpu-kit/structure';
import {CompliantCableRuntime} from 'box3d-webgpu-kit/cable';
import * as S from './moored-scenarios.mjs';

const K = {createWorld, createSimulation, waterSubsystem, structureSubsystem, linkWaterToStructure, WaterCoupling, StructureCoupling, CompliantCableRuntime};
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const sci = x => Number(x).toExponential(2), pct = x => `${(100 * x).toFixed(2)}%`;

test('the load provider and the prediction: what they refuse and that a prediction changes nothing', async () => {
  const world = await createWorld({step: 1 / 240, ground: false});
  try {
    const shape = {kind: 'box', halfExtents: [0.25, 0.25, 0.25]};
    const body = world.createBody({shape, position: [0, 1.9, 0], density: 500, neverSleeps: true}), dry = world.createBody({shape, position: [2, 9, 0], density: 500});
    const water = new WaterCoupling(world, {cols: 16, rows: 16, dx: 0.5, dz: 0.5, restDepth: 2, origin: [-4, 0, -4]});
    water.attach(body, shape, {linearDrag: 50});
    const out = new Float64Array(6);
    assert.equal(water.predictLoad(dry, out), false, 'a body that is not attached has no prediction');
    // The prediction is the force the next step applies: compare with the report of that step, for three steps.
    for (let i = 0; i < 3; i++) {
      const before = Float64Array.from(water.eta), report = {...water.report(body), buoyancy: Array.from(water.report(body).buoyancy)};
      out.fill(0); assert.equal(water.predictLoad(body, out), true);
      assert.deepEqual(Float64Array.from(water.eta), before, 'the water is untouched');
      assert.deepEqual(Array.from(water.report(body).buoyancy), report.buoyancy, 'the report is untouched');
      assert.equal(water.report(body).submergedVolume, report.submergedVolume);
      water.step();
      const r = water.report(body);
      for (let k = 0; k < 3; k++) assert.ok(out[k] === r.buoyancy[k] + r.drag[k], `force component ${k} is the one applied: ${out[k]} against ${r.buoyancy[k] + r.drag[k]}`);
      assert.ok(out[1] > 100, 'the body is in the water');
      world.step();
    }
    const structure = new StructureCoupling(world);
    assert.throws(() => structure.addLoadProvider(null));
    const remove = structure.addLoadProvider(() => {});
    remove(); remove();
  } finally { world.dispose(); }
});

test('moored spar at rest: draught and tension against the closed form, with and without the water in the interface solve', async t => {
  const rows = [];
  for (const hz of [240, 60, 30]) {
    const linked = await S.sparAtRest(K, {hz}), before = await S.sparAtRest(K, {hz, linked: false});
    assert.equal(linked.failed, null); assert.equal(before.failed, null);
    // Force balance on the spar, with the displaced volume the water reports: cable force = -(rho g V - m g). Float32
    // mass and gravity in the rigid solver leave 1e-6.
    within(linked.forceOnSpar, linked.balanceForce, 2e-6, `${hz} Hz: force of the cable on the spar = weight - buoyancy`);
    // The tension in the segment is that less the weight of the cable's upper node, which hangs from the spar.
    within(linked.tension, linked.balanceTension, 2e-6, `${hz} Hz: tension = rho g V - (m + m_n) g`);
    // Against the closed-form equilibrium (tether stretch, level rise, draught). Measured 4e-7 and 1e-7 m at every
    // step size: what is left is float32 (the spar's height near 2.6 m is known to 2.4e-7 m).
    within(linked.tension, linked.exactTension, 5e-6, `${hz} Hz: tension against the closed form`);
    near(linked.draught, linked.exactDraught, 1e-6, `${hz} Hz: draught against the closed form`);
    // Before: the cable's end is placed where the spar would go without buoyancy, B dt^2 / m lower, and the draught is
    // off by about that (measured 0.7 to 1.7 times it; the tether's own stiffness against the lag sets the factor).
    assert.ok(before.draughtError < -0.5 * before.lag && before.draughtError > -2 * before.lag, `${hz} Hz without the link: draught off by about B dt^2 / m (${before.draughtError} against ${before.lag})`);
    assert.ok(Math.abs(before.draughtError) > 1000 * Math.abs(linked.draughtError), 'the link removes the error');
    rows.push(`${hz} Hz: draught error ${sci(linked.draughtError)} m (before ${sci(before.draughtError)} m, B dt^2 / m = ${sci(before.lag)} m); tension error ${sci(linked.tensionError)} (before ${sci(before.tensionError)})`);
  }
  t.diagnostic(`closed form: tension 225.2833 N, draught 1.374717 m. ${rows.join('; ')}`);
});

test('moored spar in heave: sqrt((rho g A + E A / L0) / (m + m_n)), with no added mass', async t => {
  const r = await S.sparHeave(K, {hz: 240, seconds: 8}), coarse = await S.sparHeave(K, {hz: 60, seconds: 8});
  assert.equal(r.failed, null); assert.equal(r.slack, 0, 'the tether stays taut');
  // The closed form has the hydrostatic spring rho g A (392 N/m), the tether (1000 N/m) and the mass of the spar and
  // of the tether's upper node; no added mass, which the coupling does not have either. The model's water also answers
  // the spar's volume source (a local rise and radiated waves), which the closed form leaves out, and the cable is
  // stepped implicitly. Measured -0.43% at 240 Hz and -1.0% at 60 Hz; the bounds are 1% and 2%.
  within(r.frequency, r.exact, 0.01, 'heave frequency at 240 Hz');
  within(coarse.frequency, coarse.exact, 0.02, 'heave frequency at 60 Hz');
  // Both springs act: the tether alone would give 0.889 Hz, 15% lower.
  assert.ok(r.frequency > 1.1 * r.tetherOnly, 'the hydrostatic stiffness is in the frequency');
  // The swing must not grow. It decays: the cable's implicit step takes energy at a rate first order in the step
  // (35% of the amplitude in 8 s at 240 Hz, 75% at 60 Hz), and the waves carry some away.
  assert.ok(r.growth < 1 && coarse.growth < r.growth, 'the swing decays, faster at the larger step');
  within(r.first, r.expectedAmplitude, 0.05, 'first swing = v0 / omega');
  t.diagnostic(`heave: ${r.frequency.toFixed(4)} Hz at 240 Hz (error ${pct(r.error)}), ${coarse.frequency.toFixed(4)} Hz at 60 Hz (${pct(coarse.error)}), closed form ${r.exact.toFixed(4)} Hz, tether alone ${r.tetherOnly.toFixed(4)} Hz; amplitude after 8 s over the first swing: ${r.growth.toFixed(3)} at 240 Hz, ${coarse.growth.toFixed(3)} at 60 Hz`);
});

test('a large step: the spar set at its equilibrium stays there; without the water in the interface solve it rings and settles off it', async t => {
  const rows = [];
  for (const hz of [240, 30]) {
    const linked = await S.sparHeave(K, {hz, kick: 0, seconds: 8}), before = await S.sparHeave(K, {hz, kick: 0, linked: false, seconds: 8});
    assert.equal(linked.failed, null); assert.equal(before.failed, null);
    // Linked: the spar never moves (its float32 height does not change by one unit) and the tension is the closed form's.
    assert.ok(linked.first < 3e-7 && linked.last < 3e-7, `${hz} Hz: no motion (${linked.first} m)`);
    assert.ok(Math.abs(linked.meanOffset) < 5e-7, `${hz} Hz: stays at the equilibrium (${linked.meanOffset} m)`);
    assert.ok(Math.abs(linked.tensionError) < 5e-6, `${hz} Hz: tension`);
    // Before: the first step already pulls the spar towards the scheme's own, wrong, equilibrium: it swings by nearly
    // the whole offset (0.5 mm at 240 Hz, 12 mm at 30 Hz) and settles that far from the closed form.
    assert.ok(before.first > 1000 * Math.max(linked.first, 1e-7), `${hz} Hz without the link: it rings (${before.first} m)`);
    assert.ok(before.meanOffset > 0.5 * before.first, `${hz} Hz without the link: it settles off the equilibrium`);
    rows.push(`${hz} Hz: swing ${sci(linked.first)} m, offset ${sci(linked.meanOffset)} m, tension error ${sci(linked.tensionError)} (before: swing ${sci(before.first)} m, offset ${sci(before.meanOffset)} m, tension error ${sci(before.tensionError)})`);
  }
  // At 30 Hz the old scheme is 14 mm and 2.2% off.
  t.diagnostic(rows.join('; '));
});
