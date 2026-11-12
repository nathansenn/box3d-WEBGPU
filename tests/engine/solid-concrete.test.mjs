// The concrete law of the tetrahedral solid (src/engine/concrete-law.ts; material.concrete in src/engine/solid.ts):
// EN 1992-1-1 3.1.5 in uniaxial compression, f_ctm and G_f in tension on three meshes, the crack band in compression,
// the Drucker-Prager closed form under confinement, the return mapping, inputs and checkpoints. The set-ups are those of
// validation/domains/concrete.mjs (domain "solid" of the validation report). Run: npm run test:solid
import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {compression, tension, band, confined, c30} from '../../validation/domains/concrete.mjs';
const {SolidBody, boxMesh, SOLID_CONCRETE_SOLVER_ID, buildConcreteLaw} = await import('../../src/engine/solid.ts');
const {ConcreteReturn} = await import('../../src/engine/concrete-law.ts');
const {encodeState} = await import('../../src/engine/checkpoint.ts');

const close = (a, b, tol, label) => assert.ok(Math.abs(a - b) <= tol * Math.abs(b), `${label}: ${a} vs ${b} (${(a / b - 1) * 100} %)`);

test('uniaxial compression of one cell of band width L_c follows EN 1992-1-1 (3.14) to f_cm at eps_c1 and on to eps_cu1', async () => {
  const r = await compression();
  console.log(`# L_c ${r.L.toFixed(4)} m, peak ${(r.peak / 1e6).toFixed(3)} MPa at ${(r.at * 1e3).toFixed(3)} per mille, worst ${(r.worst / r.fcm * 100).toFixed(2)} % of f_cm, at eps_cu1 ${(r.ultimate / 1e6).toFixed(3)} vs ${(r.ec2Ultimate / 1e6).toFixed(3)} MPa`);
  close(r.peak, 38e6, 0.005, 'peak = f_cm');
  close(r.at, 0.0022, 0.02, 'strain at the peak = eps_c1');
  assert.ok(r.worst / r.fcm <= 0.03, `within 3 % of f_cm of (3.14) up to eps_cu1: ${r.worst / r.fcm}`);
  close(r.ultimate, r.ec2Ultimate, 0.02, 'stress at eps_cu1');
  assert.ok(r.rows.every(row => row.converged), 'every load step converged');
});

test('uniaxial tension: the peak is f_ctm and the energy dissipated through a cracked band is G_f A on three meshes (crack band, mesh objective)', async () => {
  const rows = [];
  for (const n of [5, 10, 20]) {
    const r = await tension(n);
    rows.push({n, peak: r.peak, ratio: r.work / (0.98 * r.Gf * r.A)});
    close(r.peak, 0.98 * r.ft, 0.02, `${n} cells: the weak cell sets the peak`);
    close(r.work / (0.98 * r.Gf * r.A), 1, 0.01, `${n} cells: G_f A through the band`);
    assert.ok(Math.abs(r.finalStress) < 1e-3 * r.ft, 'the bar carries nothing once the crack is open');
  }
  console.log('# tension', JSON.stringify(rows));
});

test('crack band in compression: a crushed band of width h dissipates G_c per unit area after the peak for every h', async () => {
  for (const h of [0.12, 0.06, 0.03]) {
    const r = await band(h);
    close(r.perArea, r.Gc, 0.02, `${h} m band: G_c per unit area`);
    assert.ok(r.eroded > 0, 'the crushed cell erodes');
  }
});

test('confinement: under lateral pressure the peak follows the Drucker-Prager closed form f_c + m sigma_3', async () => {
  for (const ratio of [0.05, 0.2]) {
    const c = await confined(ratio);
    close(c.peak, c.closed, 0.005, `lateral ${ratio} f_cm`);
    // EN 1992-1-1 (3.24) / (3.25) on the mean strength: the law's gain is lower, stated in the document.
    const ec2 = ratio <= 0.05 ? 1 + 5 * ratio : 1.125 + 2.5 * ratio;
    console.log(`# confinement ${ratio}: law ${(c.peak / c.fcm).toFixed(3)} f_cm (m = ${c.m.toFixed(3)}), EN 1992-1-1 3.1.9 ${ec2.toFixed(3)} f_cm`);
    assert.ok(c.peak / c.fcm < ec2, 'the biaxial-fitted friction gains less than EN 1992-1-1 3.1.9');
  }
});

test('return mapping: the stress is the derivative of the returned energy, in every regime', async () => {
  const m = await c30(), E = m.youngModulus, nu = m.poissonRatio, la = E * nu / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
  const law = buildConcreteLaw({...m.concrete, bandWidth: 0.03}, E, nu, 1e-6), R = new ConcreteReturn(law, la, mu);
  const cases = [[[1e-5, 0, 0, 0, 0, 0], 0, 0], [[1.2e-4, -1e-5, -2e-5, 1e-5, 0, 3e-6], 0, 1e-4], [[-2.5e-3, 4e-4, 1e-3, 2e-4, 1e-4, 0], 1e-3, 2e-4], [[2e-4, 1.9e-4, 1e-4, 0, 0, 0], 0, 0], [[-1.6e-3, 5e-4, 3e-4, 0, 2e-4, 1e-4], 2e-4, 0]];
  for (const f of [1, 0.9]) for (const [t, kc, kt] of cases) {
    R.map(t, kc, kt, f); const s = [...R.stress];
    for (let j = 0; j < 6; j++) {
      const d = 1e-10, p = [...t], q = [...t]; p[j] += d; q[j] -= d;
      R.map(p, kc, kt, f); const wp = R.energy; R.map(q, kc, kt, f); const wm = R.energy;
      const g = (wp - wm) / (2 * d) / (j < 3 ? 1 : 2);
      assert.ok(Math.abs(g - s[j]) <= 1e-6 * Math.max(...s.map(Math.abs)) + 1, `component ${j}: ${g} vs ${s[j]}`);
    }
  }
});

test('inputs: a concrete law replaces yieldStress, needs a plastic model, and has its own solver id', async () => {
  const m = await c30(), mesh = boxMesh({size: [0.1, 0.1, 0.1], cells: [1, 1, 1]});
  assert.equal(new SolidBody({mesh, material: m, config: {model: 'green-lagrange'}}).solver, SOLID_CONCRETE_SOLVER_ID);
  assert.throws(() => new SolidBody({mesh, material: {...m, yieldStress: 1e6}}), /replaces yieldStress/);
  assert.throws(() => new SolidBody({mesh, material: m, config: {model: 'corotational'}}), /linear or green-lagrange/);
  assert.throws(() => new SolidBody({mesh, material: m, config: {model: 'linear', viscoelastic: {branches: [{ratio: 1, time: 1}]}}}), /viscoelastic/);
  assert.throws(() => new SolidBody({mesh, material: {...m, concrete: {...m.concrete, tensileStrength: 50e6}}, config: {model: 'linear'}}), /below the compressive/);
  assert.throws(() => new SolidBody({mesh, material: {...m, concrete: {...m.concrete, extra: 1}}, config: {model: 'linear'}}), /extra/);
  // A ceramic band far wider than its characteristic length: the softening is stretched, and says by how much.
  const brittle = buildConcreteLaw({compressiveStrength: 2e9, tensileStrength: 3e8, peakStrain: 2e9 / 3.3e11, ultimateStrain: 2e9 / 3.3e11, fractureEnergy: 35, crushingEnergy: 35, elasticLimit: 1, bandWidth: 0.02}, 3.3e11, 0.22, 1e-6);
  assert.ok(brittle.tensionEnergyFactor > 1 && brittle.compressionEnergyFactor > 1);
  assert.equal(buildConcreteLaw({...m.concrete, bandWidth: 0.03}, m.youngModulus, m.poissonRatio, 1e-6).tensionEnergyFactor, 1, 'plain concrete on 30 mm cells needs no stretch');
});

test('checkpoints: a concrete solid resumes bit for bit after cracking, crushing and erosion', async () => {
  const m = await c30(), make = () => {
    const b = new SolidBody({mesh: boxMesh({size: [0.06, 0.02, 0.02], cells: [3, 1, 1]}), material: {...m, concrete: {...m.concrete, bandWidth: 0.02}}, config: {model: 'green-lagrange', dt: 1e-3, forceTolerance: 1e-6}});
    const f = new Float64Array(b.tetCount); for (let e = 0; e < f.length; e++) f[e] = 1 + 0.05 * Math.sin(3 * e); b.setStrengthFactors(f);
    b.constrain(b.selectNodes(x => x < 1e-9), [0, 0, 0]); return b;
  };
  const tip = b => b.selectNodes(x => x > 0.06 - 1e-9);
  const drive = (b, from, to) => { for (let i = from; i < to; i++) { b.constrain(tip(b), [i < 40 ? 3e-7 * i : 1.2e-5 - 5.5e-6 * (i - 40), null, null]); b.step(); } };
  const a = make(); drive(a, 0, 50); const saved = a.saveState(); drive(a, 50, 90); const expected = encodeState(a.saveState());
  assert.ok(a.crackOpening().some(w => w > 0) && a.equivalentPlasticStrain().some(k => k > 0), 'cracked in tension, then crushed in compression');
  const b = make(); b.restoreState(saved); drive(b, 50, 90);
  assert.deepEqual(encodeState(b.saveState()), expected);
});
