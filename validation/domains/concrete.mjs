// The concrete law of the tetrahedral solid (src/engine/concrete-law.ts, material.concrete of src/engine/solid.ts)
// against EN 1992-1-1 3.1.5 and Table 3.1, the fib Model Code 2010 fracture energy, the crack band and the
// Drucker-Prager closed form; and the Studio cube (src/studio/material-labs/concrete-si.ts) against a slenderness-2 prism.
// tests/engine/solid-concrete.test.mjs asserts the same numbers from these set-ups. SI units.
import {engine, memo, defineCases, relative, absolute} from '../lib.mjs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {ROOT} from '../lib.mjs';

const FILE = 'tests/engine/solid-concrete.test.mjs', STUDIO_FILE = 'tests/studio/concrete-si.test.mjs';
export const CT = {
  compression: 'uniaxial compression of one cell of band width L_c follows EN 1992-1-1 (3.14) to f_cm at eps_c1 and on to eps_cu1',
  tension: 'uniaxial tension: the peak is f_ctm and the energy dissipated through a cracked band is G_f A on three meshes (crack band, mesh objective)',
  band: 'crack band in compression: a crushed band of width h dissipates G_c per unit area after the peak for every h',
  confinement: 'confinement: under lateral pressure the peak follows the Drucker-Prager closed form f_c + m sigma_3',
  cube: 'the 150 mm cube between frictional steel platens fails above a prism of slenderness 2, the cylinder\'s (EN 1992-1-1 Table 3.1 gives 37 / 30)',
};
const solid = () => engine('solid');
const materials = () => engine('materials');
const studio = () => import(pathToFileURL(path.join(ROOT, 'src/studio/material-labs/concrete-si.ts')).href);

/** C30/37 from the library, with options for the law. */
export async function c30(extra = {}) {
  const {concreteMaterial} = await materials(), m = concreteMaterial('concrete-c30-37');
  return {...m, concrete: {...m.concrete, ...extra}};
}
const near = (a, b) => Math.abs(a - b) < 1e-12;

/** A prism [Lx, a, a] on three symmetry planes, loaded along x by end displacements. `weak` scales the strength of the
 * middle cell (it localises there). The guess of each step is extrapolated from the last two (the loading path). */
export async function prism({material, n = 1, Lx, a = Lx, weak = 1, steps, end, pressure = 0}) {
  const {SolidBody, boxMesh} = await solid();
  const b = new SolidBody({mesh: boxMesh({size: [Lx, a, a], cells: [n, 1, 1]}), material, config: {model: 'green-lagrange', tolerance: 1e-9, forceTolerance: 1e-6, maxNewtonIterations: 300}});
  if (weak !== 1) {
    const X = b.referencePositions, f = new Float64Array(b.tetCount);
    for (let e = 0; e < b.tetCount; e++) { let x = 0; for (let q = 0; q < 4; q++) x += X[3 * b.tets[4 * e + q]] / 4; f[e] = Math.floor(x / (Lx / n)) === Math.floor(n / 2) ? weak : 1; }
    b.setStrengthFactors(f);
  }
  const x0 = b.selectNodes(x => near(x, 0)), y0 = b.selectNodes((x, y) => near(y, 0)), z0 = b.selectNodes((x, y, z) => near(z, 0)), tip = b.selectNodes(x => near(x, Lx));
  b.constrain(x0, [0, null, null]); b.constrain(y0, [null, 0, null]); b.constrain(z0, [null, null, 0]);
  if (pressure) {
    // Lateral pressure on the free faces y = a and z = a, applied first (one static step: it stays elastic).
    b.addPressure(b.selectFaces((cx, cy, cz, nx, ny, nz) => ny > 0.999 || nz > 0.999), pressure);
    b.solveStatic();
  }
  const A = a * a, rows = [];let previous = b.displacements.slice(), before = previous.slice();
  for (let i = 1; i <= steps; i++) {
    const u = end * i / steps, guess = new Float64Array(previous.length);
    for (let j = 0; j < guess.length; j++) guess[j] = 2 * previous[j] - before[j];
    for (const k of tip) guess[3 * k] = u; for (const k of x0) guess[3 * k] = 0; for (const k of y0) guess[3 * k + 1] = 0; for (const k of z0) guess[3 * k + 2] = 0;
    b.constrain(tip, [u, null, null]); b.setState(guess);
    const r = b.solveStatic();
    let F = 0; for (const k of tip) F += r.reactions[3 * k];
    rows.push({strain: u / Lx, stress: F / A, plasticWork: b.plasticWork, converged: r.converged});
    before = previous; previous = b.displacements.slice();
  }
  return {body: b, rows, A};
}

/** One cell of band width L_c (the law's reference length) in uniaxial compression to 3.6 per mille. */
export const compression = () => memo('concrete/compression', async () => {
  const {buildConcreteLaw, ec2CompressionStress} = await solid(), material = await c30();
  const probe = buildConcreteLaw(material.concrete, material.youngModulus, material.poissonRatio, 1e-6), L = probe.referenceLength;
  const {rows} = await prism({material: {...material, concrete: {...material.concrete, bandWidth: L}}, Lx: L, steps: 180, end: -0.0036 * L});
  const c = material.concrete, E = material.youngModulus;
  let peak = 0, at = 0, worst = 0, ultimate = 0;
  for (const r of rows) {
    const e = -r.strain, s = -r.stress;
    if (s > peak) { peak = s; at = e; }
    if (e <= c.ultimateStrain + 1e-12) worst = Math.max(worst, Math.abs(s - ec2CompressionStress(e, c.compressiveStrength, c.peakStrain, E)));
    if (Math.abs(e - c.ultimateStrain) < 1e-9) ultimate = s;
  }
  return {L, peak, at, worst, ultimate, ec2Ultimate: ec2CompressionStress(c.ultimateStrain, c.compressiveStrength, c.peakStrain, E), fcm: c.compressiveStrength, rows};
});

/** A 0.2 m bar of 0.04 m section in tension, its middle cell 2 % weaker, on n cells. */
export const tension = n => memo(`concrete/tension/${n}`, async () => {
  const material = await c30(), Lx = 0.2, a = 0.04;
  const {rows, A} = await prism({material: {...material, concrete: {...material.concrete, bandWidth: Lx / n}}, n, Lx, a, weak: 0.98, steps: 300, end: 3e-4});
  let peak = 0, work = 0, previous = {strain: 0, stress: 0};
  for (const r of rows) { peak = Math.max(peak, r.stress); work += 0.5 * (r.stress + previous.stress) * (r.strain - previous.strain) * Lx * A; previous = r; }
  return {peak, work, A, finalStress: rows.at(-1).stress, Gf: material.concrete.fractureEnergy, ft: material.concrete.tensileStrength};
});

/** A single cell of height h crushed homogeneously; the plastic work after the peak per unit area. */
export const band = h => memo(`concrete/band/${h}`, async () => {
  const {buildConcreteLaw} = await solid(), material = await c30(), law = {...material.concrete, bandWidth: h};
  const probe = buildConcreteLaw(law, material.youngModulus, material.poissonRatio, 1e-6), crushed = probe.kappaCrushed * (1 - probe.friction / 3);
  const {rows, A, body} = await prism({material: {...material, concrete: law}, Lx: h, a: 0.04, steps: 400, end: -1.15 * crushed * h});
  let peak = 0, atPeak = 0;
  for (const r of rows) if (-r.stress > peak) { peak = -r.stress; atPeak = r.plasticWork; }
  return {perArea: (rows.at(-1).plasticWork - atPeak) / A, Gc: body.concreteLaw.input.crushingEnergy, eroded: body.erodedCount};
});

/** One cell under lateral pressure p, then compressed axially: the peak axial stress. */
export const confined = ratio => memo(`concrete/confined/${ratio}`, async () => {
  const material = await c30(), fcm = material.concrete.compressiveStrength, L = 0.05;
  const {rows, body} = await prism({material: {...material, concrete: {...material.concrete, bandWidth: L}}, Lx: L, a: L, steps: 160, end: -0.008 * L, pressure: ratio * fcm});
  let peak = 0; for (const r of rows) peak = Math.max(peak, -r.stress);
  const beta = body.concreteLaw.friction, m = (1 + 2 * beta / 3) / (1 - beta / 3);
  return {peak, closed: fcm + m * ratio * fcm, m, beta, fcm};
});

/** The Studio cube and a prism of slenderness 2 (the cylinder's) of the same law between the same platens: peak stresses. */
export const cubeAndCylinder = () => memo('concrete/cube-cylinder', async () => {
  const {ConcreteModel} = await studio(), {LABS, normalizeSettings} = await import(pathToFileURL(path.join(ROOT, 'src/studio/material-labs/catalog.ts')).href);
  const settings = normalizeSettings('concrete', {...LABS.concrete.defaults, load: 4.5, rate: 1});
  const run = shape => { const m = new ConcreteModel(settings, {shape}); for (let i = 0; i < Math.round(4.6 * 120); i++) m.step(1 / 120); return {peak: m.peakForce / m.area, strain: m.peakStrain, fcm: m.spec.material.concrete.compressiveStrength, unconverged: m.unconverged}; };
  const cube = run('cube'), cylinder = run('prism');
  return {cube, cylinder, ratio: cube.peak / cylinder.peak};
});

export const concrete = defineCases('solid', FILE, [
  {id: 'solid.concrete.peak', title: 'Concrete law: uniaxial compressive strength', quantity: 'peak nominal stress of one C30/37 cell of band width L_c in uniaxial compression', unit: 'Pa', test: CT.compression,
    reference: {formula: 'f_cm (EN 1992-1-1 Table 3.1, C30/37)', value: 38e6}, tolerance: relative(0.005),
    note: 'Nominal stress over the reference area and Green-Lagrange kinematics: 0.2 % low at the peak.', measure: async () => (await compression()).peak},
  {id: 'solid.concrete.peak-strain', title: 'Concrete law: strain at the compressive peak', quantity: 'axial strain at the peak of the same test (steps of 0.02 per mille)', unit: '1', test: CT.compression,
    reference: {formula: 'eps_c1 (EN 1992-1-1 Table 3.1, C30/37)', value: 0.0022}, tolerance: relative(0.02), measure: async () => (await compression()).at},
  {id: 'solid.concrete.curve', title: 'Concrete law: the EN 1992-1-1 (3.14) curve', quantity: 'largest stress difference from (3.14) between 0 and eps_cu1, over f_cm', unit: '1', test: CT.compression,
    reference: {formula: 'sigma / f_cm = (k eta - eta^2) / (1 + (k - 2) eta), k = 1.05 E_cm eps_c1 / f_cm', value: 0}, tolerance: absolute(0.03),
    note: 'Largest where plasticity starts (0.4 f_cm): E_cm is a secant there, so the law blends the small offset to the curve into the hardening.',
    measure: async () => { const r = await compression(); return r.worst / r.fcm; }},
  {id: 'solid.concrete.ultimate', title: 'Concrete law: stress at the nominal ultimate strain', quantity: 'nominal stress of the same cell at eps_cu1 = 3.5 per mille', unit: 'Pa', test: CT.compression,
    reference: {formula: '(3.14) at eps_cu1', value: null}, tolerance: relative(0.02), measure: async () => { const r = await compression(); return {value: r.ultimate, reference: r.ec2Ultimate}; }},
  {id: 'solid.concrete.tension-peak', title: 'Concrete law: uniaxial tensile strength', quantity: 'peak stress of a 5-cell bar whose middle cell is 2 % weaker', unit: 'Pa', test: CT.tension,
    reference: {formula: '0.98 f_ctm (EN 1992-1-1 Table 3.1, C30/37: 2.9 MPa)', value: 0.98 * 2.9e6}, tolerance: relative(0.02), measure: async () => (await tension(5)).peak},
  ...[5, 10, 20].map(n => ({id: `solid.concrete.fracture-energy-${n}`, title: `Concrete law: energy to break a bar in tension, ${n} cells`, quantity: `work of the end force until the ${n}-cell bar carries nothing, over 0.98 G_f A`, unit: '1', test: CT.tension,
    reference: {formula: 'G_f = 73 f_cm^0.18 N/m (fib Model Code 2010, quoted), crack band', value: 1}, tolerance: relative(0.01),
    measure: async () => { const r = await tension(n); return r.work / (0.98 * r.Gf * r.A); }})),
  ...[0.12, 0.06, 0.03].map(h => ({id: `solid.concrete.crushing-energy-${Math.round(h * 1000)}mm`, title: `Concrete law: crushing energy of a ${h * 1000} mm band`, quantity: 'plastic work after the peak per unit area of a single crushed cell', unit: 'J/m^2', test: CT.band,
    reference: {formula: 'G_c = f_cm w_d / 2, w_d = 0.5 mm (ATENA crack band default)', value: 38e6 * 5e-4 / 2}, tolerance: relative(0.02),
    note: 'The cell crushes homogeneously; in a longer prism the band does not stay one cell thick (see notValidated).', measure: async () => (await band(h)).perArea})),
  ...[0.05, 0.2].map(r => ({id: `solid.concrete.confined-${Math.round(r * 100)}`, title: `Concrete law: strength under a lateral pressure of ${r} f_cm`, quantity: 'peak axial stress of one cell under constant lateral pressure', unit: 'Pa', test: CT.confinement,
    reference: {formula: 'f_cm + m sigma_3, m = (1 + 2 beta / 3) / (1 - beta / 3)', value: null}, tolerance: relative(0.005),
    note: 'The closed form of the law, not of concrete: EN 1992-1-1 (3.24) and (3.25) give a larger gain (see the Studio document).',
    measure: async () => { const c = await confined(r); return {value: c.peak, reference: c.closed}; }})),
  {id: 'solid.concrete.cube-cylinder', file: STUDIO_FILE, title: 'Studio concrete cube over a cylinder', quantity: 'peak stress of the 150 mm C30/37 cube over that of a 150 x 150 x 300 mm prism (the cylinder\'s slenderness), both between steel platens with friction 0.57', unit: '1', test: CT.cube,
    reference: {formula: 'f_ck,cube / f_ck = 37 / 30 (EN 1992-1-1 Table 3.1, C30/37)', value: 37 / 30}, tolerance: relative(0.1),
    note: 'A square prism stands in for the cylinder; confinement by platen friction only, with the biaxial-fitted friction parameter, on 5 cells across.',
    measure: async () => (await cubeAndCylinder()).ratio},
]);
