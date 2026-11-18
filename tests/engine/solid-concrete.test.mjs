// The concrete law of the tetrahedral solid (src/engine/concrete-law.ts; material.concrete in src/engine/solid.ts):
// EN 1992-1-1 3.1.5 in uniaxial compression, f_ctm and G_f in tension on three meshes, the crack band in compression,
// the Drucker-Prager closed form under confinement, the return mapping, inputs and checkpoints. The set-ups are those of
// validation/domains/concrete.mjs (domain "solid" of the validation report). Run: npm run test:solid
import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {compression, tension, band, tensionBand, crushBand, confined, biaxial, biaxialEnvelope, flow, tie, beam, c30, b500} from '../../validation/domains/concrete.mjs';
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

test('crack band per element: bars of 10, 20 and 40 cells and a 3-D mesh dissipate G_f per unit area in tension with the band width of each element (no bandWidth given)', async () => {
  const rows = [];
  for (const [n, m] of [[10, 1], [20, 1], [40, 1], [20, 2]]) {
    const r = await tensionBand(n, m), ratio = r.work / (0.98 * r.Gf * r.A);
    rows.push({mesh: `${n}x${m}x${m}`, peak: +(r.peak / 1e6).toFixed(4), ratio: +ratio.toFixed(5), cracked: r.cracked.length});
    close(ratio, 1, 0.05, `${n} x ${m} x ${m}: G_f A through the band`);
    close(r.peak, 0.98 * r.ft, 0.02, `${n} x ${m} x ${m}: the weak cell sets the peak`);
    assert.ok(Math.abs(r.finalStress) < 1e-3 * r.ft && r.unconverged === 0, 'separated, every step converged');
    // The cracked elements are those of the weak cell, each with the cell's length along the bar as its band.
    assert.equal(r.cracked.length, 5 * m * m);
    for (const h of r.cracked) close(h, r.cell, 1e-9, 'band width = width along the crack normal');
  }
  const old = await tensionBand(10, 1, true), oldRatio = old.work / (0.98 * old.Gf * old.A);
  console.log('# band per element, tension', JSON.stringify(rows), `; with the band (6 V)^(1/3) of the mean volume: ${oldRatio.toFixed(4)}`);
  assert.ok(oldRatio < 0.7, 'the earlier default band (6 V)^(1/3) is not the band of an elongated cell');
});

test('crack band per element: bars of 10, 20 and 40 cells and a 3-D mesh crush in one band of elements that dissipates G_c per unit area, scaled by the peak stress of the band', async () => {
  const rows = [];
  for (const [n, m] of [[10, 1], [20, 1], [40, 1], [20, 2]]) {
    const r = await crushBand(n, m);
    rows.push({mesh: `${n}x${m}x${m}`, peak: +(r.peak / 1e6).toFixed(3), ratio: +r.ratio.toFixed(4), raw: +r.raw.toFixed(4), crushed: r.erodedCells});
    close(r.ratio, 1, 0.05, `${n} x ${m} x ${m}: G_c A sigma_peak / f_cm after the peak`);
    assert.equal(r.erodedCells.length, 1, 'one band of elements crushes');
    assert.equal(r.erodedCount, 5 * m * m, 'the whole band, across the section');
    assert.ok(Math.abs(r.finalStress) < 1e-3 * r.fcm && r.unconverged === 0, 'crushed through, every step converged');
  }
  console.log('# band per element, compression', JSON.stringify(rows));
});

test('crack band limits: the snap-back length 2 E G_f / f_t^2, the stretch beyond it, and the warning of a coarse mesh', async () => {
  const m = await c30(), E = m.youngModulus, c = m.concrete;
  const law = buildConcreteLaw({...c, bandWidth: 0.03}, E, m.poissonRatio, 1e-6);
  close(law.snapBackLength.tension, 2 * E * c.fractureEnergy / c.tensileStrength ** 2, 1e-12, 'linear softening: 2 E G_f / f_t^2');
  assert.ok(law.stretchLength.tension < law.snapBackLength.tension && law.stretchLength.compression < law.snapBackLength.compression);
  // Plain concrete on 30 mm cells: no finding. A 2 m cell (beyond the stretch length of C30/37, 0.6 m): a warning with the numbers.
  const fine = new SolidBody({mesh: boxMesh({size: [0.09, 0.03, 0.03], cells: [3, 1, 1]}), material: m, config: {model: 'linear'}});
  assert.deepEqual(fine.crackBandFindings(), []);
  const coarse = new SolidBody({mesh: boxMesh({size: [4, 2, 2], cells: [2, 1, 1]}), material: m, config: {model: 'linear'}});
  const found = coarse.crackBandFindings('slab');
  assert.ok(found.length >= 1 && found.every(f => f.severity === 'warning' && f.rule === 'crack-band' && f.subject === 'slab'));
  const t = found.find(f => f.message.includes('tension'));
  assert.ok(t && t.numbers.bandWidth > t.numbers.stretchLength && t.numbers.energyFactor > 1, JSON.stringify(t));
  // The stretched element dissipates bandWidth / stretchLength times G_f: the law's factor for a band that wide.
  const wide = buildConcreteLaw({...c, bandWidth: 2}, E, m.poissonRatio, 1e-6);
  close(wide.tensionEnergyFactor, 2 / wide.stretchLength.tension, 1e-9, 'energy factor of a 2 m band');
});

test('confinement: under lateral pressure the peak follows EN 1992-1-1 3.1.9, (3.24) and (3.25)', async () => {
  for (const ratio of [0.05, 0.2]) {
    const c = await confined(ratio);
    console.log(`# confinement ${ratio}: law ${(c.peak / c.fcm).toFixed(4)} f_cm, EN 1992-1-1 3.1.9 ${(c.closed / c.fcm).toFixed(4)} f_cm`);
    close(c.peak, c.closed, 0.01, `lateral ${ratio} f_cm`);
  }
});

test('biaxial compression: the equal-biaxial strength is 1.16 f_cm (Kupfer, Hilsdorf and Rusch 1969)', async () => {
  const b = await biaxial(), half = await biaxialEnvelope(0.5);
  console.log(`# equal biaxial ${b.ratio.toFixed(4)} f_cm (1.16); peak surface at sigma_2 / sigma_1 = 0.5: ${half.toFixed(3)} f_cm (Kupfer: 1.27, a miss)`);
  close(b.ratio, 1.16, 0.01, 'equal-biaxial strength');
  assert.ok(b.converged, 'every step to the peak converged');
  // The elliptic section through the EN 1992-1-1 meridian and the 1.16 point overshoots Kupfer's 1.27 at the ratio 0.5: documented.
  assert.ok(half > 1.27 && half < 1.45, `ratio 0.5: ${half}`);
});

test('non-associated flow: the plastic volume change per unit kappa_c is the dilatancy psi of the potential, below the meridian slope', async () => {
  const f = await flow();
  console.log(`# volumetric plastic strain per kappa_c ${f.volumetric}, psi ${f.psi}, meridian slope ${f.slope}, eccentricity ${f.eccentricity}`);
  close(f.volumetric, f.psi, 1e-9, 'the volumetric flow is the dilatancy of the potential');
  assert.ok(f.psi < f.slope, 'non-associated: the potential is flatter than the yield meridian');
});

test('reinforced tie: embedded bars with perfect bond follow the one-dimensional series model through cracking to yield', async () => {
  const r = await tie(0.01), steel = await b500();
  console.log(`# tie: worst ${(r.worst * 100).toFixed(2)} % of A_s f_y over ${r.compared} steps; elastic ${r.elastic} vs ${r.EA}; plateau ${r.plateau} vs ${r.Ny}; stiffening at 1 per mille ${r.stiffening}`);
  close(r.elastic, r.EA, 1e-4, 'uncracked: E_c A + E_s A_s (Green-Lagrange strain at 1.3e-5)');
  assert.ok(r.worst <= 0.03, `cracking sequence within 3 % of A_s f_y of the series model: ${r.worst}`);
  assert.ok(r.plateau >= r.Ny && r.plateau <= 1.01 * r.Ny, 'the bar yields across the open crack');
  assert.ok(r.converged, `every step up to yield converged (${r.unconverged} later steps on the yield plateau did not)`);
  assert.equal(steel.yieldStress, 500e6);
});

test('reinforced beam in four-point bending: cracking and yield moments against the transformed and cracked sections', async () => {
  const r = await beam();
  console.log(`# beam: first crack between ${r.crack[0].toFixed(0)} and ${r.crack[1].toFixed(0)} N m (M_cr ${r.Mcr.toFixed(0)}); first yield at ${r.yield[1].toFixed(0)} N m (M_y ${r.My.toFixed(0)})`);
  close((r.crack[0] + r.crack[1]) / 2, r.Mcr, 0.06, 'cracking moment');
  close(r.yield[1], r.My, 0.05, 'yield moment');
  assert.ok(r.converged);
});

test('reinforcement with the sparse LDL preconditioner: the bars are in the assembled tangent, and the beam gives the same moments', async () => {
  // A reinforced body, elastic and then compressed until the concrete hardens and the bars yield (a soft steel of f_y = 200 MPa, so
  // that they yield before the concrete softens): the factor of the assembled matrix inverts the tangent the conjugate gradients multiply by.
  const m = await c30(), steel = await b500();
  const b = new SolidBody({mesh: boxMesh({size: [0.08, 0.02, 0.02], cells: [4, 2, 2]}), material: {...m, concrete: {...m.concrete, bandWidth: 0.02}}, config: {model: 'green-lagrange', linearSolver: 'ldl'},
    reinforcement: {bars: [{points: [0.001, 0.004, 0.006, 0.079, 0.016, 0.013], area: 2e-5, ...steel, yieldStress: 200e6, hardeningModulus: 2e9}, {points: [0.02, 0.003, 0.003, 0.02, 0.017, 0.003, 0.06, 0.017, 0.017], area: 1e-5, ...steel, yieldStress: 200e6}]}});
  const k = b.kernel(), n = 3 * b.nodeCount, X = b.referencePositions; let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  b.constrain(b.selectNodes(x => x < 1e-9));
  for (const amplitude of [1e-5, -1.5e-3]) {
    const u = new Float64Array(n); for (let j = 0; j < n; j++) u[j] = k.fixed[j] ? 0 : X[j - j % 3] * (j % 3 === 0 ? amplitude : -0.2 * amplitude) * (1 + 0.2 * rnd());
    b.setState(u); k.energy(u, null, true); k.commit(); k.energy(u, null, true);
    const L = k.assembleTangent(1, 0); L.factor();
    const x = Float64Array.from({length: n}, (v, j) => k.fixed[j] ? 0 : rnd()), Kx = new Float64Array(n), z = new Float64Array(n); k.tangentProduct(x, Kx); L.solve(Kx, z);
    let error = 0; for (let j = 0; j < n; j++) error = Math.max(error, Math.abs(z[j] - x[j]));
    const yielded = b.reinforcementForces().force.filter((f, s) => Math.abs(f) >= b.rebar.area[s] * 200e6 * (1 - 1e-9)).length, hardened = b.equivalentPlasticStrain().filter(v => v > 0).length;
    console.log(`# reinforced, strain ${amplitude}: K^-1 (K x) - x ${error.toExponential(2)}, ${yielded} of ${b.rebar.segmentCount} bar segments at yield, ${hardened} of ${b.tetCount} elements plastic, pivots modified ${L.modified}, shift ${L.shift}`);
    assert.ok(L.modified === 0 && L.shift === 0, 'positive definite: the factor is the exact inverse');
    assert.ok(amplitude > 0 || (yielded > 0 && hardened > 0), 'bars at yield and concrete past its elastic limit in the second state');
    assert.ok(error < 1e-7, `the assembled matrix is the tangent: ${error}`);
  }
  const cg = await beam(), ldl = await beam('ldl');
  console.log(`# beam with ldl: first crack ${ldl.crack[0].toFixed(1)} to ${ldl.crack[1].toFixed(1)} N m (cg ${cg.crack[0].toFixed(1)} to ${cg.crack[1].toFixed(1)}), first yield ${ldl.yield[1].toFixed(1)} N m (cg ${cg.yield[1].toFixed(1)}); inner iterations ${ldl.inner} against ${cg.inner}`);
  assert.ok(ldl.converged, 'every load step converged');
  close(ldl.crack[1], cg.crack[1], 1e-6, 'cracking moment');
  close(ldl.yield[1], cg.yield[1], 1e-3, 'yield moment');
  assert.ok(ldl.inner < cg.inner / 5, 'far fewer inner iterations');
});

test('the deviatoric return\'s Newton step: lodeFactor2 gives r of lodeFactor to the bit, r\' to rounding and the exact r\'\'', async () => {
  const {lodeFactor, lodeFactor2} = await import('../../src/engine/concrete-law.ts');
  const one = [0, 0], two = [0, 0, 0], up = [0, 0], down = [0, 0]; let worst = 0;
  for (const e of [0.55, 0.7614879649890591, 0.9, 1]) for (let th = 0.005; th < Math.PI / 3; th += 0.0371) {
    lodeFactor(th, e, one); lodeFactor2(th, e, two);
    assert.equal(two[0], one[0], 'r to the bit'); assert.ok(Math.abs(two[1] - one[1]) <= 1e-14 * Math.max(1, Math.abs(one[1])), "r' to rounding");
    const d = 1e-6; lodeFactor(th + d, e, up); lodeFactor(th - d, e, down);
    worst = Math.max(worst, Math.abs(two[2] - (up[1] - down[1]) / (2 * d)) / Math.max(1, Math.abs(two[2])));
  }
  // 5e-8: central differences of r' with a step of 1e-6 rad (rounding of r' over 2e-6, measured 1.1e-8).
  assert.ok(worst < 5e-8, `r'' against central differences: ${worst}`);
});

test('consistent tangent: the principal-axes tangent with its closed-form compression part matches differences of the return in every regime', async () => {
  const m = await c30(), E = m.youngModulus, nu = m.poissonRatio, la = E * nu / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
  const law = buildConcreteLaw({...m.concrete, bandWidth: 0.03}, E, nu, 1e-6), R = new ConcreteReturn(law, la, mu);
  let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const fd = (t, kc, kt, xn, out) => { R.map(t, kc, kt, 1, xn, -1); const base = Array.from(R.stress), d = 1e-9; for (let j = 0; j < 6; j++) { const u = Array.from(t); u[j] += j < 3 ? d : d / 2; R.map(u, kc, kt, 1, xn, -1); for (let i = 0; i < 6; i++) out[6 * i + j] = (R.stress[i] - base[i]) / d; } };
  const A = new Float64Array(36), B = new Float64Array(36), F = new Float64Array(36), seen = {compression: 0, rankine: 0, equal: 0, softening: 0};
  let worst = 0, worstClosed = 0;
  for (let k = 0; k < 900; k++) {
    // The last 300: after the peak on the anchored softening surface, with band widths other than the law's.
    if (k === 600) R.element(1.4 * 38e6, 0.02, 0.045);
    const c = -0.004 * rnd(), w = () => rnd() - 0.5;
    const t = [c + 0.0015 * w(), c * (k % 3 === 0 ? 1 : -0.2) + 0.0015 * w(), -0.2 * c + 0.001 * w() + (k % 4 === 0 ? 3e-4 : 0), 0.001 * w(), 0.001 * w(), 0.001 * w()];
    const equal = k % 5 === 0; if (equal) { t[3] = t[4] = t[5] = 0; t[1] = t[2]; }
    const kc = k >= 600 ? law.kappaPeak * (1 + 3 * rnd()) : k % 4 === 0 ? 0 : 0.003 * rnd(), kt = k % 7 === 0 ? 1e-4 : 0, xn = 1e7 * rnd();
    R.map(t, kc, kt, 1, xn, -1); if (!R.yielded) continue;
    if (R.dKappaT > 0) seen.rankine++; else seen.compression++; if (equal) seen.equal++; if (k >= 600 && R.dKappaC > 0) seen.softening++;
    const kept = R.principalValid ? Float64Array.from(R.principal) : null;
    fd(t, kc, kt, xn, A);
    const before = R.closedFormCount; R.tangent(t, kc, kt, 1, xn, -1, B, 1e-9, kept, 0);
    let d = 0; for (let q = 0; q < 36; q++) d = Math.max(d, Math.abs(A[q] - B[q])); worst = Math.max(worst, d / E);
    if (R.closedFormCount > before) { R.closedForm = false; R.tangent(t, kc, kt, 1, xn, -1, F, 1e-9, kept, 0); R.closedForm = true; let dd = 0; for (let q = 0; q < 36; q++) dd = Math.max(dd, Math.abs(F[q] - B[q])); worstClosed = Math.max(worstClosed, dd / E); }
  }
  R.element(0);
  console.log(`# tangent: ${seen.compression} compression and ${seen.rankine} Rankine returns (${seen.equal} with two equal principal strains, ${seen.softening} on the softening surface), ${R.closedFormCount} in closed form; against tensor differences ${worst.toExponential(2)} E, closed form against principal differences ${worstClosed.toExponential(2)} E`);
  assert.ok(seen.compression > 100 && seen.rankine > 10 && seen.equal > 50 && seen.softening > 50 && R.closedFormCount > 100);
  // 1e-5 E: forward differences with a step of 1e-9 carry an error of about 1e-6 E (rounding of the stress over the step).
  assert.ok(worst < 1e-5, `tangent against differences: ${worst}`);
  assert.ok(worstClosed < 1e-5, `closed form against differences: ${worstClosed}`);
});

test('return mapping: the stress is the derivative of the returned energy, in every regime', async () => {
  const m = await c30(), E = m.youngModulus, nu = m.poissonRatio, la = E * nu / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu));
  const cases = [[[1e-5, 0, 0, 0, 0, 0], 0, 0, 0], [[1.2e-4, -1e-5, -2e-5, 1e-5, 0, 3e-6], 0, 1e-4, 0], [[-2.5e-3, 4e-4, 1e-3, 2e-4, 1e-4, 0], 1e-3, 2e-4, 5e6], [[2e-4, 1.9e-4, 1e-4, 0, 0, 0], 0, 0, 0],
    [[-1.6e-3, 5e-4, 3e-4, 0, 2e-4, 1e-4], 2e-4, 0, 1e7], [[-3e-3, -1e-3, -2e-4, 1e-4, 0, 3e-4], 1e-3, 0, 2e7], [[-2e-3, 3e-4, 3e-4, 0, 0, 0], 5e-4, 0, 12e6], [[-6e-3, -5e-3, -4e-3, 0, 1e-4, 0], 8e-3, 0, 40e6]];
  // The law of this version (elliptic section, EN 1992-1-1 meridian, psi below its slope), that of version 1 (a straight
  // meridian, associated), and a nonlocal step (strength frozen at k(kappa_bar)).
  // And the softening surface after the peak (anchored, band widths other than the law's).
  for (const [extra, kbar, anchor] of [[{}, -1, 0], [{friction: 0.3636}, -1, 0], [{}, 2e-3, 0], [{}, -1, 1.3 * 38e6]]) {
    const law = buildConcreteLaw({...m.concrete, bandWidth: 0.03, ...extra}, E, nu, 1e-6), R = new ConcreteReturn(law, la, mu);
    if (anchor) { R.element(anchor, 0.02, 0.05); for (const c of cases) c[1] = Math.max(c[1], law.kappaPeak * 1.5); }
    for (const f of [1, 0.9]) for (const [t, kc, kt, xn] of cases) {
    R.map(t, kc, kt, f, xn, kbar); const s = [...R.stress];
    for (let j = 0; j < 6; j++) {
      const d = 1e-10, p = [...t], q = [...t]; p[j] += d; q[j] -= d;
      R.map(p, kc, kt, f, xn, kbar); const wp = R.energy; R.map(q, kc, kt, f, xn, kbar); const wm = R.energy;
      const g = (wp - wm) / (2 * d) / (j < 3 ? 1 : 2);
      assert.ok(Math.abs(g - s[j]) <= 1e-6 * Math.max(...s.map(Math.abs)) + 1, `component ${j}: ${g} vs ${s[j]}`);
    }
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
  assert.throws(() => buildConcreteLaw({...m.concrete, friction: 0.3, meridian: [1 / 3, 1, 1, 2]}, m.youngModulus, m.poissonRatio, 1e-6), /either friction/);
  assert.throws(() => buildConcreteLaw({...m.concrete, meridian: [0, 0.5, 1 / 3, 1, 1, 3]}, m.youngModulus, m.poissonRatio, 1e-6), /concave/);
  assert.throws(() => buildConcreteLaw({...m.concrete, biaxialRatio: 3}, m.youngModulus, m.poissonRatio, 1e-6), /eccentricity/);
  assert.throws(() => buildConcreteLaw({...m.concrete, postPeak: 'damage'}, m.youngModulus, m.poissonRatio, 1e-6), /postPeak/);
  assert.throws(() => buildConcreteLaw({...m.concrete, nonlocalLength: 0.02, postPeak: 'band'}, m.youngModulus, m.poissonRatio, 1e-6), /nonlocal/);
  assert.equal(buildConcreteLaw({...m.concrete, nonlocalLength: 0.02}, m.youngModulus, m.poissonRatio, 1e-6).postPeak, 'lagged');
  assert.throws(() => buildConcreteLaw({...m.concrete, softeningDilatancy: -3}, m.youngModulus, m.poissonRatio, 1e-6), /softeningDilatancy/);
  const steel = await b500(), bar = {points: [0, 0.05, 0.05, 0.1, 0.05, 0.05], area: 1e-4, ...steel};
  assert.throws(() => new SolidBody({mesh, material: {youngModulus: 3e10, poissonRatio: 0.2, density: 2400}, reinforcement: {bars: [bar]}}), /needs a concrete law/);
  assert.throws(() => new SolidBody({mesh, material: m, config: {model: 'linear'}, reinforcement: {bars: [{...bar, points: [0, 0.05, 0.05, 0.2, 0.05, 0.05]}]}}), /outside the solid/);
  assert.throws(() => new SolidBody({mesh, material: m, config: {model: 'linear', integrator: 'explicit', dt: 1e-7}, reinforcement: {bars: [bar]}}), /implicit integrator/);
  // A ceramic band far wider than its characteristic length: the softening is stretched, and says by how much.
  const brittle = buildConcreteLaw({compressiveStrength: 2e9, tensileStrength: 3e8, peakStrain: 2e9 / 3.3e11, ultimateStrain: 2e9 / 3.3e11, fractureEnergy: 35, crushingEnergy: 35, elasticLimit: 1, bandWidth: 0.02}, 3.3e11, 0.22, 1e-6);
  assert.ok(brittle.tensionEnergyFactor > 1 && brittle.compressionEnergyFactor > 1);
  assert.equal(buildConcreteLaw({...m.concrete, bandWidth: 0.03}, m.youngModulus, m.poissonRatio, 1e-6).tensionEnergyFactor, 1, 'plain concrete on 30 mm cells needs no stretch');
});

test('checkpoints: a concrete solid resumes bit for bit after cracking, crushing and erosion, also nonlocal and reinforced', async () => {
  const m = await c30(), steel = await b500();
  for (const variant of ['local', 'nonlocal', 'reinforced', 'reinforced-ldl', 'band-per-element', 'lagged']) {
  const make = () => {
    const b = new SolidBody({mesh: boxMesh({size: [0.06, 0.02, 0.02], cells: [3, 1, 1]}), material: {...m, concrete: {...m.concrete, ...(variant === 'band-per-element' ? {} : {bandWidth: 0.02}), ...(variant === 'nonlocal' ? {nonlocalLength: 0.02} : {}), ...(variant === 'lagged' ? {postPeak: 'lagged'} : {})}}, config: {model: 'green-lagrange', dt: 1e-3, forceTolerance: 1e-6, ...(variant === 'reinforced-ldl' ? {linearSolver: 'ldl'} : {})},
      ...(variant.startsWith('reinforced') ? {reinforcement: {bars: [{points: [0, 0.01, 0.01, 0.06, 0.01, 0.01], area: 1e-6, ...steel}]}} : {})});
    const f = new Float64Array(b.tetCount); for (let e = 0; e < f.length; e++) f[e] = 1 + 0.05 * Math.sin(3 * e); b.setStrengthFactors(f);
    b.constrain(b.selectNodes(x => x < 1e-9), [0, 0, 0]); return b;
  };
  const tip = b => b.selectNodes(x => x > 0.06 - 1e-9);
  const drive = (b, from, to) => { for (let i = from; i < to; i++) { b.constrain(tip(b), [i < 40 ? 3e-7 * i : 1.2e-5 - 5.5e-6 * (i - 40), null, null]); b.step(); } };
  const a = make(); drive(a, 0, 50); const saved = a.saveState(); drive(a, 50, 90); const expected = encodeState(a.saveState());
  assert.ok(a.crackOpening().some(w => w > 0) && a.equivalentPlasticStrain().some(k => k > 0), 'cracked in tension, then crushed in compression');
  if (variant !== 'nonlocal') assert.ok(a.equivalentPlasticStrain().some(k => k > a.concreteLaw.kappaPeak), `${variant}: past the compressive peak (softening surface)`);
  const b = make(); b.restoreState(saved); drive(b, 50, 90);
  assert.deepEqual(encodeState(b.saveState()), expected, variant);
  }
});
