// Thin plates (src/engine/plate.ts): Kirchhoff bending on a grid with brittle fracture between nodes, against plate theory.
// Set-ups are those of tests/engine/plate.test.mjs: a 2.6 m x 2.0 m x 8 mm soda-lime pane (E = 72 GPa, nu = 0.23,
// rho = 2500 kg/m^3), simply supported on all edges. SI units.
import {engine, memo, defineCases, relative, absolute, lower} from '../lib.mjs';

const FILE = 'tests/engine/plate.test.mjs';
const T = {
  navier: 'static: uniform pressure on a simply supported plate matches the Navier series; moments converge at second order',
  frequency: 'dynamics: the (1,1) mode rings at the exact grid frequency, which approaches Kirchhoff theory',
  fracture: 'fracture: the first crack opens where the Navier surface stress reaches the strength, perpendicular to it; prestress adds to the strength',
};
const A = 2.6, B = 2, TH = 0.008, GLASS = {youngModulus: 72e9, poissonRatio: 0.23, density: 2500}, Q = 1000, STRENGTH = 41e6;
const plate = () => engine('plate');
const edge = (x, y) => x < 1e-9 || y < 1e-9 || x > A - 1e-9 || y > B - 1e-9;
async function supported(cells, extra = {}) { const {PlateBody} = await plate(), p = new PlateBody({size: [A, B], cells, thickness: TH, material: GLASS, ...extra}); p.hold(p.selectNodes(edge)); return p; }
const rigidity = GLASS.youngModulus * TH ** 3 / (12 * (1 - GLASS.poissonRatio ** 2));

const navier = cells => memo(`plate/navier/${cells}`, async () => {
  const {navierUniform} = await plate(), p = await supported(cells);
  for (let n = 0; n < p.nodeCount; n++) p.force[n] = Q * p.area[n];
  p.solveStatic();
  const c = p.node(cells[0] / 2, cells[1] / 2), [mx, my] = p.moments(c);
  return {w: p.w[c], mx, my, exact: navierUniform(A, B, rigidity, GLASS.poissonRatio, Q)};
});
const ring = () => memo('plate/ring', async () => {
  const cells = [26, 20], p = await supported(cells);
  for (let n = 0; n < p.nodeCount; n++) p.w[n] = 1e-3 * Math.sin(Math.PI * p.x(n) / A) * Math.sin(Math.PI * p.y(n) / B);
  const h = 0.5 * p.stableTimeStep(), c = p.node(13, 10), E0 = p.kineticEnergy() + p.strainEnergy(); let prev = p.w[c], drift = 0; const crossings = [];
  for (let s = 0; s < 40000; s++) { p.advance(h); const w = p.w[c]; if (prev > 0 && w <= 0) crossings.push((s + prev / (prev - w)) * h); prev = w; if (s % 50 === 0) drift = Math.max(drift, Math.abs(p.kineticEnergy() + p.strainEnergy() - E0) / E0); }
  return {f: (crossings.length - 1) / (crossings.at(-1) - crossings[0]), drift};
});
const onset = prestress => memo(`plate/onset/${prestress}`, async () => {
  let lo = 0, hi = 1e6;
  for (let k = 0; k < 50; k++) { const q = 0.5 * (lo + hi), p = await supported([26, 20], {fracture: {strength: STRENGTH, prestress}}); for (let n = 0; n < p.nodeCount; n++) p.force[n] = q * p.area[n]; p.solveStatic({tolerance: 1e-13}); if (p.checkFracture() > 0) hi = q; else lo = q; }
  return hi;
});
const navierOnset = async () => { const {navierUniform} = await plate(), ex = navierUniform(A, B, rigidity, GLASS.poissonRatio, 1); return STRENGTH * TH * TH / (6 * Math.max(ex.mx, ex.my)); };

export default defineCases('plate', FILE, [
  {id: 'plate.navier.deflection', title: 'Simply supported plate under uniform pressure: centre deflection', quantity: 'centre deflection of the pane under 1 kPa, 26 x 20 cells (0.1 m)', unit: 'm', test: T.navier,
    reference: {formula: 'Navier series w = sum 16 q sin(m pi/2) sin(n pi/2) / (pi^6 D m n ((m/a)^2 + (n/b)^2)^2)', value: null}, tolerance: relative(2e-5),
    measure: async () => { const r = await navier([26, 20]); return {value: r.w, reference: r.exact.deflection}; }},
  {id: 'plate.navier.moment', title: 'Simply supported plate under uniform pressure: centre moment', quantity: 'centre moment M_y per unit length, 26 x 20 cells', unit: 'N m/m', test: T.navier,
    reference: {formula: 'Navier series M_y = D sum c ((n pi / b)^2 + nu (m pi / a)^2)', value: null}, tolerance: relative(3e-3),
    note: 'Finite-difference curvatures: second-order error, 0.18 % at 0.1 m cells.',
    measure: async () => { const r = await navier([26, 20]); return {value: r.my, reference: r.exact.my}; }},
  {id: 'plate.navier.order', title: 'Centre moment: observed order', quantity: 'convergence order of the M_y error from 26 x 20 to 52 x 40 cells', unit: '1', test: T.navier,
    reference: {formula: 'log2(e_coarse / e_fine) = 2', value: 2}, tolerance: absolute(0.1),
    measure: async () => { const c = await navier([26, 20]), f = await navier([52, 40]); return Math.log2((c.my / c.exact.my - 1) / (f.my / f.exact.my - 1)); }},
  {id: 'plate.frequency.grid', title: 'First mode of the simply supported pane: the grid\'s own frequency', quantity: 'frequency of the (1,1) mode released from its shape, explicit steps at half the limit', unit: 'Hz', test: T.frequency,
    reference: {formula: 'f = (lambda_x + lambda_y) sqrt(D / (rho t)) / (2 pi), lambda = (4 / h^2) sin^2(m pi h / (2 a))', value: null}, tolerance: relative(1e-5),
    note: 'The sine modes are exact eigenvectors of the grid, so this checks the operator and the time step, not the mesh.',
    measure: async () => { const {plateGridFrequency} = await plate(); return {value: (await ring()).f, reference: plateGridFrequency(A, B, [26, 20], rigidity, GLASS.density * TH, 1, 1)}; }},
  {id: 'plate.frequency.theory', title: 'First mode of the simply supported pane against Kirchhoff theory', quantity: 'frequency of the (1,1) mode, 26 x 20 cells', unit: 'Hz', test: T.frequency,
    reference: {formula: 'f = (pi / 2) ((1 / a)^2 + (1 / b)^2) sqrt(D / (rho t))', value: Math.PI / 2 * (1 / A ** 2 + 1 / B ** 2) * Math.sqrt(rigidity / (GLASS.density * TH))}, tolerance: relative(2.5e-3),
    note: 'The grid is 0.17 % low at 0.1 m cells (second order).', measure: async () => (await ring()).f},
  {id: 'plate.energy', title: 'Explicit step: energy without damping', quantity: 'largest relative energy change over 40,000 steps at half the stability limit', unit: '1', test: T.frequency,
    reference: {formula: '|E(t) / E(0) - 1| -> 0 as h -> 0', value: 0}, tolerance: absolute(5e-3),
    note: 'Symplectic Euler keeps a bounded oscillation of order omega h; it does not drift.', measure: async () => (await ring()).drift},
  {id: 'plate.fracture.onset', title: 'First crack under uniform pressure', quantity: 'pressure at which the first bond of the simply supported pane breaks (strength 41 MPa)', unit: 'Pa', test: T.fracture,
    reference: {formula: 'q_c = sigma_c t^2 / (6 max(M_x, M_y) per unit q) (Navier)', value: null}, tolerance: relative(0.02),
    note: 'The check reads the moment at a bond\'s middle, the mean of two nodes, so the grid cracks 0.6 % later than the peak at the centre says.',
    measure: async () => ({value: await onset(0), reference: await navierOnset()})},
  {id: 'plate.fracture.prestress', title: 'First crack with a surface prestress', quantity: 'onset pressure with 124 MPa surface compression over that without', unit: '1', test: T.fracture,
    reference: {formula: '(sigma_c + sigma_p) / sigma_c (linear plate)', value: (41 + 124) / 41}, tolerance: relative(1e-9),
    measure: async () => (await onset(124e6)) / (await onset(0))},
  {id: 'plate.fracture.margin', title: 'First crack is never early', quantity: 'onset pressure over the Navier estimate', unit: '1', test: T.fracture,
    reference: {formula: 'q_c / q_Navier >= 1', value: 1}, tolerance: lower(0),
    measure: async () => (await onset(0)) / (await navierOnset())},
]);
