// Thin plates (src/engine/plate.ts): Kirchhoff bending on a grid with brittle fracture between nodes, against plate theory.
// Set-ups are those of tests/engine/plate.test.mjs: a 2.6 m x 2.0 m x 8 mm soda-lime pane (E = 72 GPa, nu = 0.23,
// rho = 2500 kg/m^3), simply supported on all edges. SI units.
import {engine, memo, defineCases, relative, absolute, lower} from '../lib.mjs';

const FILE = 'tests/engine/plate.test.mjs';
const T = {
  navier: 'static: uniform pressure on a simply supported plate matches the Navier series; moments converge at second order',
  frequency: 'dynamics: the (1,1) mode rings at the exact grid frequency, which approaches Kirchhoff theory',
  fracture: 'fracture: the first crack opens where the Navier surface stress reaches the strength, perpendicular to it; prestress adds to the strength',
  levy: 'von Karman plate: centre deflection of a square plate under uniform pressure against Levy (NACA Report 737), edges held and edges free to move',
  graded: 'graded grid: the undamaged pane still matches Navier, the first Kirchhoff mode and the first-crack pressure',
  gradedLevy: 'graded grid: von Karman centre deflection and edge tension against Levy (Table 9 and 10), as on the equal grid',
};
/** Levy, "Bending of rectangular plates with large deflections", NACA Report 737 (1942), read in the scan on NTRS
 * (https://ntrs.nasa.gov/api/citations/19930091816/downloads/19930091816.pdf): simply supported square plate of side a
 * and thickness h under uniform pressure p, Poisson's ratio 0.316. [p a^4 / (E h^4), w_center / h]. Table 9: edge
 * displacement zero (the last column of Table 10 gives the average edge tension -p_x a^2 / (E h^2)). Table 6: edge
 * compression zero (the edges stay straight and carry no net force). Levy's six-term series oscillates in the centre
 * deflection: he brackets the true value at the largest loads between 1.827 and 1.846 (Table 9, 278.5) and between 2.704
 * and 2.743 (Table 6, 247). */
export const LEVY = {
  held: [[14.78, 0.485, 0.451], [51.4, 0.952, 1.816], [132.0, 1.402, 4.12], [278.5, 1.846, 7.38]],
  free: [[12.1, 0.486], [29.4, 0.962], [56.9, 1.424], [99.4, 1.870], [161, 2.307], [247, 2.742], [358, 3.174], [497, 3.600]],
};
/** The plate of Levy's tables on an n x n grid by dynamic relaxation: w_center / h, the average tension across the middle
 * section over E h^2 / a^2 (equal to the average edge tension), and the centre's membrane and bending stresses over E h^2 / a^2. */
export const levy = (kind, load, n = 16) => memo(`plate/levy/${kind}/${load}/${n}`, async () => {
  const {PlateBody, navierUniform} = await plate(), a = 1, h = 0.01, E = 70e9, nu = 0.316, q = load * E * h ** 4 / a ** 4;
  const p = new PlateBody({size: [a, a], cells: [n, n], thickness: h, material: {youngModulus: E, poissonRatio: nu, density: 2700}, membrane: true});
  const rim = p.selectNodes((x, y) => x < 1e-9 || x > a - 1e-9 || y < 1e-9 || y > a - 1e-9);
  p.hold(rim);
  if (kind === 'held') p.holdInPlane(rim);
  else {
    p.holdInPlane(p.selectNodes(x => x < 1e-9), [true, false]); p.tieInPlane(p.selectNodes(x => x > a - 1e-9), 0);
    p.holdInPlane(p.selectNodes((x, y) => y < 1e-9), [false, true]); p.tieInPlane(p.selectNodes((x, y) => y > a - 1e-9), 1);
  }
  for (let k = 0; k < p.nodeCount; k++) p.force[k] = q * p.area[k];
  const r = p.relax({tolerance: 1e-7}), c = p.node(n / 2, n / 2), N = p.membraneForces(c), M = p.moments(c), scale = a * a / (E * h * h);
  let tension = 0; for (let j = 0; j < n; j++) tension += (p.cellForce[3 * (j * n + n / 2)] + p.cellForce[3 * (j * n + n / 2 - 1)]) / (2 * n);
  return {w: p.w[c] / h, linear: navierUniform(a, a, p.rigidity, nu, q).deflection / h, tension: tension / h * scale, membrane: N[0] / h * scale, bending: 6 * M[0] / (h * h) * scale, steps: r.steps, converged: r.converged};
});
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
/** Node lines of `cells` equal cells over `size`, each cell within `half` of `at` split `factor` times (the glass lab's refinement). */
const gradedLines = (size, cells, at, half, factor) => { const h = size / cells, out = [0]; for (let i = 0; i < cells; i++) { const a = i * h, b = (i + 1) * h, s = b > at - half + 1e-9 && a < at + half - 1e-9 ? factor : 1; for (let k = 1; k <= s; k++) out.push(k === s ? b : a + (b - a) * k / s); } out[out.length - 1] = size; return out; };
const PANE_LINES = {x: gradedLines(A, 26, A / 2, 0.3, 2), y: gradedLines(B, 20, B / 2, 0.3, 2)};
const gradedPane = async (extra = {}) => { const {PlateBody} = await plate(), p = new PlateBody({size: [A, B], cells: [PANE_LINES.x.length - 1, PANE_LINES.y.length - 1], lines: PANE_LINES, thickness: TH, material: GLASS, ...extra}); p.hold(p.selectNodes(edge)); return p; };
const gradedCentre = p => p.selectNodes((x, y) => Math.abs(x - A / 2) < 1e-9 && Math.abs(y - B / 2) < 1e-9)[0];
const gradedNavier = () => memo('plate/graded/navier', async () => {
  const {navierUniform} = await plate(), p = await gradedPane();
  for (let n = 0; n < p.nodeCount; n++) p.force[n] = Q * p.area[n];
  p.solveStatic({tolerance: 1e-13});
  const c = gradedCentre(p), [, my] = p.moments(c);
  return {w: p.w[c], my, exact: navierUniform(A, B, rigidity, GLASS.poissonRatio, Q)};
});
const gradedOnset = () => memo('plate/graded/onset', async () => {
  let lo = 0, hi = 1e6;
  for (let k = 0; k < 50; k++) { const q = 0.5 * (lo + hi), p = await gradedPane({fracture: {strength: STRENGTH}}); for (let n = 0; n < p.nodeCount; n++) p.force[n] = q * p.area[n]; p.solveStatic({tolerance: 1e-13}); if (p.checkFracture() > 0) hi = q; else lo = q; }
  return hi;
});
const gradedLevy = load => memo(`plate/graded/levy/${load}`, async () => {
  const {PlateBody} = await plate(), lines = {x: gradedLines(1, 16, 0.5, 0.125, 2), y: gradedLines(1, 16, 0.5, 0.125, 2)}, n = lines.x.length - 1, E = 70e9, h = 0.01;
  const p = new PlateBody({size: [1, 1], cells: [n, n], lines, thickness: h, material: {youngModulus: E, poissonRatio: 0.316, density: 2700}, membrane: true});
  const rim = p.selectNodes((x, y) => x < 1e-9 || x > 1 - 1e-9 || y < 1e-9 || y > 1 - 1e-9); p.hold(rim); p.holdInPlane(rim);
  for (let k = 0; k < p.nodeCount; k++) p.force[k] = load * E * h ** 4 * p.area[k];
  p.relax({tolerance: 1e-7});
  return p.w[p.selectNodes((x, y) => Math.abs(x - 0.5) < 1e-9 && Math.abs(y - 0.5) < 1e-9)[0]] / h;
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
  ...LEVY.held.map(([load, w], k) => ({id: `plate.karman.held-${k + 1}`, title: `Von Karman plate, edges held, p a^4 / (E h^4) = ${load}`, quantity: 'centre deflection over the thickness of a simply supported square plate with immovable edges, nu = 0.316, 16 x 16 cells', unit: '1', test: T.levy,
    reference: {formula: `Levy, NACA Report 737 (1942), Table 9: ${w}${k === 3 ? ' (true value between 1.827 and 1.846)' : ''}`, value: w}, tolerance: relative(0.01),
    note: `Linear theory gives ${(0.04386 * load).toFixed(2)}. Levy's value is a six-term Fourier solution.`, measure: async () => (await levy('held', load)).w})),
  ...LEVY.free.map(([load, w], k) => ({id: `plate.karman.free-${k + 1}`, title: `Von Karman plate, straight edges free to move, p a^4 / (E h^4) = ${load}`, quantity: 'centre deflection over the thickness, edges straight with no net force, nu = 0.316, 16 x 16 cells', unit: '1', test: T.levy,
    reference: {formula: `Levy, NACA Report 737 (1942), Table 6: ${w}${k === 5 ? ' (true value between 2.704 and 2.743)' : ''}`, value: w}, tolerance: relative(0.01),
    measure: async () => (await levy('free', load)).w})),
  {id: 'plate.karman.edge-tension', title: 'Von Karman plate, edges held: average edge tension', quantity: 'average tension across the middle section over E h^2 / a^2 at p a^4 / (E h^4) = 278.5', unit: '1', test: T.levy,
    reference: {formula: 'Levy, NACA Report 737, Table 10: -p_x a^2 / (E h^2) = 7.38', value: 7.38}, tolerance: relative(0.04),
    note: 'Measured 2 to 3 % above Levy at all four loads (0.466, 1.866, 4.21, 7.50 against 0.451, 1.816, 4.12, 7.38).', measure: async () => (await levy('held', 278.5)).tension},
  {id: 'plate.graded.deflection', title: 'Graded grid (0.05 m cells within 0.3 m of the centre): centre deflection under uniform pressure', quantity: 'centre deflection of the pane under 1 kPa, 32 x 26 cells', unit: 'm', test: T.graded,
    reference: {formula: 'Navier series (as plate.navier.deflection)', value: null}, tolerance: relative(2e-4),
    note: 'The second difference is first order where the spacing changes from 0.1 to 0.05 m: -1.0e-4 against +8.7e-6 on the equal grid.',
    measure: async () => { const r = await gradedNavier(); return {value: r.w, reference: r.exact.deflection}; }},
  {id: 'plate.graded.moment', title: 'Graded grid: centre moment under uniform pressure', quantity: 'centre moment M_y per unit length, 32 x 26 cells', unit: 'N m/m', test: T.graded,
    reference: {formula: 'Navier series (as plate.navier.moment)', value: null}, tolerance: relative(3e-3),
    measure: async () => { const r = await gradedNavier(); return {value: r.my, reference: r.exact.my}; }},
  {id: 'plate.graded.onset', title: 'Graded grid: first crack under uniform pressure', quantity: 'pressure at which the first bond breaks (strength 41 MPa), 32 x 26 cells', unit: 'Pa', test: T.graded,
    reference: {formula: 'q_c = sigma_c t^2 / (6 max(M_x, M_y) per unit q) (Navier)', value: null}, tolerance: relative(0.02),
    note: 'The same tolerance as plate.fracture.onset on the equal grid (+0.59 % there); never early.',
    measure: async () => ({value: await gradedOnset(), reference: await navierOnset()})},
  ...LEVY.held.map(([load, w], k) => ({id: `plate.graded.karman-held-${k + 1}`, title: `Graded grid, von Karman plate, edges held, p a^4 / (E h^4) = ${load}`, quantity: 'centre deflection over the thickness, 16 x 16 cells with the middle quarter split (20 x 20)', unit: '1', test: T.gradedLevy,
    reference: {formula: `Levy, NACA Report 737 (1942), Table 9: ${w}`, value: w}, tolerance: relative(0.01),
    measure: async () => gradedLevy(load)})),
  {id: 'plate.karman.mesh', title: 'Von Karman plate: mesh dependence', quantity: 'centre deflection at p a^4 / (E h^4) = 278.5 on 8 x 8 cells over that on 32 x 32, minus 1', unit: '1', test: T.levy,
    reference: {formula: '0 (converged)', value: 0}, tolerance: absolute(0.015),
    note: '1.855, 1.841 and 1.837 on 8, 16 and 32 cells: the grid is 1.0 % and 0.2 % above its fine value.', measure: async () => (await levy('held', 278.5, 8)).w / (await levy('held', 278.5, 32)).w - 1},
]);
