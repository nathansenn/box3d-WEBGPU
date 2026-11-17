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
  bandTension: 'crack band per element: bars of 10, 20 and 40 cells and a 3-D mesh dissipate G_f per unit area in tension with the band width of each element (no bandWidth given)',
  bandCompression: 'crack band per element: bars of 10, 20 and 40 cells and a 3-D mesh crush in one band of elements that dissipates G_c per unit area, scaled by the peak stress of the band',
  confinement: 'confinement: under lateral pressure the peak follows EN 1992-1-1 3.1.9, (3.24) and (3.25)',
  biaxial: 'biaxial compression: the equal-biaxial strength is 1.16 f_cm (Kupfer, Hilsdorf and Rusch 1969)',
  flow: 'non-associated flow: the plastic volume change per unit kappa_c is the dilatancy psi of the potential, below the meridian slope',
  tie: 'reinforced tie: embedded bars with perfect bond follow the one-dimensional series model through cracking to yield',
  beam: 'reinforced beam in four-point bending: cracking and yield moments against the transformed and cracked sections',
  cube: 'the 150 mm cube between steel platens (friction 0.2) against the 150 x 300 mm cylinder (EN 1992-1-1 Table 3.1: 37 / 30) and a cylinder of slenderness 1',
};
const solid = () => engine('solid');
const law = () => engine('concrete-law');
const materials = () => engine('materials');
const studio = () => import(pathToFileURL(path.join(ROOT, 'src/studio/material-labs/concrete-si.ts')).href);

/** C30/37 from the library, with options for the law. */
export async function c30(extra = {}) {
  const {concreteMaterial} = await materials(), m = concreteMaterial('concrete-c30-37');
  return {...m, concrete: {...m.concrete, ...extra}};
}
const near = (a, b) => Math.abs(a - b) < 1e-12;

/** A prism [Lx, a, a] on three symmetry planes, loaded along x by end displacements. `weak` scales the strength of the
 * middle cell (it localises there), or with `zone` of the elements whose centroid is within zone / 2 of the middle. The
 * guess of each step is extrapolated from the last two (the loading path). */
export async function prism({material, n = 1, m = 1, Lx, a = Lx, weak = 1, zone = 0, steps, end, pressure = 0}) {
  const {SolidBody, boxMesh} = await solid();
  const b = new SolidBody({mesh: boxMesh({size: [Lx, a, a], cells: [n, m, m]}), material, config: {model: 'green-lagrange', tolerance: 1e-9, forceTolerance: 1e-6, maxNewtonIterations: 300}});
  if (weak !== 1) {
    const X = b.referencePositions, f = new Float64Array(b.tetCount);
    for (let e = 0; e < b.tetCount; e++) { let x = 0; for (let q = 0; q < 4; q++) x += X[3 * b.tets[4 * e + q]] / 4; f[e] = (zone > 0 ? Math.abs(x - Lx / 2) < zone / 2 : Math.floor(x / (Lx / n)) === Math.floor(n / 2)) ? weak : 1; }
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

/** Crack band per element in tension: the bar of `tension` (0.2 m, 0.04 m section, middle cell 2 % weaker) on n x m x m
 * cells without a bandWidth, so each element's band is its width along its crack normal; with `volume`, the band width of
 * the earlier default (6 V)^(1/3) of the mean element volume instead, for comparison. */
export const tensionBand = (n, m = 1, volume = false) => memo(`concrete/tension-band/${n}/${m}/${volume}`, async () => {
  const material = await c30(), Lx = 0.2, a = 0.04, concrete = {...material.concrete, ...(volume ? {bandWidth: Math.cbrt(Lx * a * a / (n * m * m))} : {})};
  const {rows, A, body} = await prism({material: {...material, concrete}, n, m, Lx, a, weak: 0.98, steps: 300, end: 3e-4});
  let peak = 0, work = 0, previous = {strain: 0, stress: 0};
  for (const r of rows) { peak = Math.max(peak, r.stress); work += 0.5 * (r.stress + previous.stress) * (r.strain - previous.strain) * Lx * A; previous = r; }
  const opening = body.crackOpening(), bands = body.bandWidths().tension, cracked = [];
  for (let e = 0; e < body.tetCount; e++) if (opening[e] > 0) cracked.push(bands[e]);
  return {peak, work, A, finalStress: rows.at(-1).stress, Gf: material.concrete.fractureEnergy, ft: material.concrete.tensileStrength, cracked,
    cell: Lx / n, unconverged: rows.filter(r => !r.converged).length};
});

/** Crack band per element in compression: a 0.2 m prism of 0.02 m section (a quarter of a 40 x 40 mm prism by symmetry)
 * on n x m x m cells without a bandWidth, frictionless ends, a 40 mm zone in the middle 10 % weaker, shortened by
 * 6 per mille in 240 steps. The plastic work after the peak, per unit area, against G_c times the peak stress over f_cm
 * (an element's softening is anchored at its own peak: the weak zone's strength factor and the confinement its pre-peak
 * dilatancy draws from the stronger ends set that peak), and against 0.9 G_c. */
export const crushBand = (n, m = 1) => memo(`concrete/crush-band/${n}/${m}`, async () => {
  const material = await c30(), Lx = 0.2, a = 0.02;
  const {rows, A, body} = await prism({material, n, m, Lx, a, weak: 0.9, zone: 0.04, steps: 240, end: -0.006 * Lx});
  let peak = 0, at = 0; rows.forEach((r, i) => { if (-r.stress > peak) { peak = -r.stress; at = i; } });
  const post = rows.at(-1).plasticWork - rows[at].plasticWork, c = material.concrete, X = body.referencePositions, eroded = new Set();
  for (let e = 0; e < body.tetCount; e++) if (body.erodedMask[e]) { let x = 0; for (let q = 0; q < 4; q++) x += X[3 * body.tets[4 * e + q]] / 4; eroded.add(Math.floor(x / (Lx / n))); }
  return {peak, post, A, Gc: body.concreteLaw.input.crushingEnergy, fcm: c.compressiveStrength, ratio: post / (body.concreteLaw.input.crushingEnergy * A * peak / c.compressiveStrength),
    raw: post / (0.9 * body.concreteLaw.input.crushingEnergy * A), erodedCells: [...eroded], erodedCount: body.erodedCount, finalStress: rows.at(-1).stress, unconverged: rows.filter(r => !r.converged).length};
});

/** A single cell of height h crushed homogeneously; the plastic work after the peak per unit area. */
export const band = h => memo(`concrete/band/${h}`, async () => {
  const {buildConcreteLaw} = await solid(), material = await c30(), law = {...material.concrete, bandWidth: h};
  const probe = buildConcreteLaw(law, material.youngModulus, material.poissonRatio, 1e-6), crushed = probe.crushedStrain;
  const {rows, A, body} = await prism({material: {...material, concrete: law}, Lx: h, a: 0.04, steps: 400, end: -1.15 * crushed * h});
  let peak = 0, atPeak = 0;
  for (const r of rows) if (-r.stress > peak) { peak = -r.stress; atPeak = r.plasticWork; }
  return {perArea: (rows.at(-1).plasticWork - atPeak) / A, Gc: body.concreteLaw.input.crushingEnergy, eroded: body.erodedCount};
});

/** One cell under lateral pressure p, then compressed axially: the peak axial stress, against EN 1992-1-1 (3.24) / (3.25). */
export const confined = ratio => memo(`concrete/confined/${ratio}`, async () => {
  const {en1992Confined} = await law(), material = await c30(), fcm = material.concrete.compressiveStrength, L = 0.05;
  const {rows} = await prism({material: {...material, concrete: {...material.concrete, bandWidth: L}}, Lx: L, a: L, steps: 160, end: -0.008 * L, pressure: ratio * fcm});
  let peak = 0; for (const r of rows) peak = Math.max(peak, -r.stress);
  return {peak, closed: fcm * en1992Confined(ratio), fcm};
});

/** One cell compressed equally along y and z by displacement (x free): the peak stress over f_cm. */
export const biaxial = () => memo('concrete/biaxial', async () => {
  const {SolidBody, boxMesh} = await solid(), m = await c30(), L = 0.05;
  const b = new SolidBody({mesh: boxMesh({size: [L, L, L], cells: [1, 1, 1]}), material: {...m, concrete: {...m.concrete, bandWidth: L}}, config: {model: 'green-lagrange', tolerance: 1e-9, forceTolerance: 1e-6, maxNewtonIterations: 300}});
  const x0 = b.selectNodes(x => near(x, 0)), y0 = b.selectNodes((x, y) => near(y, 0)), z0 = b.selectNodes((x, y, z) => near(z, 0)), yL = b.selectNodes((x, y) => near(y, L)), zL = b.selectNodes((x, y, z) => near(z, L));
  b.constrain(x0, [0, null, null]); b.constrain(y0, [null, 0, null]); b.constrain(z0, [null, null, 0]);
  let peak = 0, converged = true, previous = b.displacements.slice(), before = previous.slice();
  for (let i = 1; i <= 200; i++) {
    const u = -0.006 * L * i / 200, guess = new Float64Array(previous.length);
    for (let j = 0; j < guess.length; j++) guess[j] = 2 * previous[j] - before[j];
    for (const k of yL) guess[3 * k + 1] = u; for (const k of zL) guess[3 * k + 2] = u; for (const k of x0) guess[3 * k] = 0; for (const k of y0) guess[3 * k + 1] = 0; for (const k of z0) guess[3 * k + 2] = 0;
    b.constrain(yL, [null, u, null]); b.constrain(zL, [null, null, u]); b.setState(guess);
    const r = b.solveStatic();
    let F = 0; for (const k of yL) F += r.reactions[3 * k + 1];
    if (-F / (L * L) >= peak) { peak = -F / (L * L); converged &&= r.converged; } before = previous; previous = b.displacements.slice();
  }
  return {ratio: peak / m.concrete.compressiveStrength, converged};
});

/** The peak surface of the law under plane stress (0, -a s, -s): s / f_cm for a stress ratio a (Kupfer's biaxial tests). */
export const biaxialEnvelope = a => memo(`concrete/envelope/${a}`, async () => {
  const {buildConcreteLaw} = await solid(), {meridianValue, lodeFactor} = await law(), m = await c30();
  const L = buildConcreteLaw(m.concrete, m.youngModulus, m.poissonRatio, 1e-6), o = [0, 0];
  const F = s => { const p = -(1 + a) * s / 3, d = [-p, -a * s - p, -s - p], J2 = 0.5 * (d[0] ** 2 + d[1] ** 2 + d[2] ** 2), J3 = d[0] * d[1] * d[2];
    lodeFactor(Math.acos(Math.max(-1, Math.min(1, 1.5 * Math.sqrt(3) * J3 / J2 ** 1.5))) / 3, L.eccentricity, o); return Math.sqrt(3 * J2) * o[0] - meridianValue(L, -p); };
  let lo = 0.5, hi = 3; for (let i = 0; i < 100; i++) { const s = (lo + hi) / 2; if (F(s) > 0) hi = s; else lo = s; }
  return lo;
});

/** Plastic flow of the return mapping in uniaxial compression past the elastic limit: volumetric plastic strain per kappa_c
 * (the dilatancy psi of the potential) and the slope of the yield meridian there (non-associated: psi < slope). */
export const flow = () => memo('concrete/flow', async () => {
  const {buildConcreteLaw} = await solid(), {ConcreteReturn} = await law(), m = await c30(), E = m.youngModulus, nu = m.poissonRatio;
  const L = buildConcreteLaw({...m.concrete, bandWidth: 0.05}, E, nu, 1e-6), la = E * nu / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu)), R = new ConcreteReturn(L, la, mu);
  const eps = -0.8 * m.concrete.compressiveStrength / E, t = [eps, -nu * eps, -nu * eps, 0, 0, 0];
  R.map(t, 0, 0, 1, 0.3 * m.concrete.compressiveStrength);
  return {volumetric: (R.plastic[0] + R.plastic[1] + R.plastic[2]) / R.dKappaC, psi: L.dilatancy, slope: L.friction, eccentricity: L.eccentricity};
});

/** The Studio cube, the EN 12390 cylinder (diameter the cube's edge, twice as tall, an O-grid mesh) and a cylinder as tall
 * as its diameter, of the same law between the same platens (friction: the lab's default, 0.2): peak stresses. */
export const cubeAndCylinder = (friction) => memo(`concrete/cube-cylinder/${friction}`, async () => {
  const {ConcreteModel} = await studio(), {LABS, normalizeSettings} = await import(pathToFileURL(path.join(ROOT, 'src/studio/material-labs/catalog.ts')).href);
  const settings = normalizeSettings('concrete', {...LABS.concrete.defaults, load: 3.4, rate: 1, ...(friction === undefined ? {} : {damping: friction})});
  const run = shape => {
    const m = new ConcreteModel(settings, {shape}); for (let i = 0; i < Math.round(3.5 * 120); i++) m.step(1 / 120);
    return {peak: m.peakForce / m.area, strain: m.peakStrain, last: m.force / m.area, fcm: m.spec.material.concrete.compressiveStrength, unconverged: m.unconverged};
  };
  const cube = run('cube'), cylinder = run('cylinder'), short = run('short-cylinder');
  return {friction: settings.damping, cube, cylinder, short, ratio: cube.peak / cylinder.peak, slenderness: short.peak / cylinder.peak};
});

/** B500B reinforcing steel from the library (EN 1992-1-1 3.2.7 and Table C.1). */
export async function b500() {
  const {materialProperty} = await materials(), id = 'reinforcing-steel-b500b';
  return {youngModulus: materialProperty(id, 'youngModulus'), yieldStress: materialProperty(id, 'yieldStrength'), hardeningModulus: 0};
}

/** A reinforced tie: a 0.4 m C30/37 prism of section a x a (a quarter by symmetry, one cell across) with one embedded bar
 * of 1.13 % of the section on its corner line, pulled by its end; cell strengths 0.94 to 1 (a fixed sequence), so the
 * cells crack one by one. The reference is the same chain as a one-dimensional series model: each cell elastic, or cracked
 * with N = A_s min(E_s eps_b, f_y) + A sigma_c(kappa), eps_b = sigma_c / E_c + kappa, sigma_c the linear softening of the
 * cell's f_t and G_f on the band width h. */
export const tie = (a = 0.01, n = 10) => memo(`concrete/tie/${a}/${n}`, async () => {
  const {SolidBody, boxMesh} = await solid(), m = await c30(), steel = await b500(), Lx = 0.4, h = Lx / n, A = a * a, As = 0.0113 * A;
  const Es = steel.youngModulus, fy = steel.yieldStress, cellF = i => 0.94 + 0.06 * ((i * 0.6180339887) % 1);
  const b = new SolidBody({mesh: boxMesh({size: [Lx, a, a], cells: [n, 1, 1]}), material: {...m, concrete: {...m.concrete, bandWidth: h}}, config: {model: 'green-lagrange', tolerance: 1e-9, forceTolerance: 1e-6, maxNewtonIterations: 300},
    reinforcement: {bars: [{points: [0, 0, 0, Lx, 0, 0], area: As, ...steel}]}});
  const X = b.referencePositions, f = new Float64Array(b.tetCount);
  for (let e = 0; e < b.tetCount; e++) { let x = 0; for (let q = 0; q < 4; q++) x += X[3 * b.tets[4 * e + q]] / 4; f[e] = cellF(Math.floor(x / h)); }
  b.setStrengthFactors(f);
  const x0 = b.selectNodes(x => near(x, 0)), y0 = b.selectNodes((x, y) => near(y, 0)), z0 = b.selectNodes((x, y, z) => near(z, 0)), tip = b.selectNodes(x => near(x, Lx));
  b.constrain(x0, [0, null, null]); b.constrain(y0, [null, 0, null]); b.constrain(z0, [null, null, 0]);
  const rows = []; let previous = b.displacements.slice(), before = previous.slice();
  for (let i = 1; i <= 300; i++) {
    const u = 4e-3 * Lx * i / 300, guess = new Float64Array(previous.length);
    for (let j = 0; j < guess.length; j++) guess[j] = 2 * previous[j] - before[j];
    for (const k of tip) guess[3 * k] = u; for (const k of x0) guess[3 * k] = 0; for (const k of y0) guess[3 * k + 1] = 0; for (const k of z0) guess[3 * k + 2] = 0;
    b.constrain(tip, [u, null, null]); b.setState(guess);
    const r = b.solveStatic(); let N = 0; for (const k of tip) N += r.reactions[3 * k];
    rows.push({U: u, N, converged: r.converged}); before = previous; previous = b.displacements.slice();
  }
  const Ec = m.youngModulus, ft0 = m.concrete.tensileStrength, Gf0 = m.concrete.fractureEnergy, EA = Ec * A + Es * As;
  const cellStrain = (i, N) => {
    const ft = cellF(i) * ft0, wc = 2 * cellF(i) * Gf0 / ft;
    if (N <= ft * A + Es * As * ft / Ec) return N / EA;
    let lo = 0, hi = 1;
    for (let k = 0; k < 200; k++) { const kk = (lo + hi) / 2, sc = Math.max(0, ft * (1 - kk * h / wc)), eb = sc / Ec + kk; if (As * Math.min(Es * eb, fy) + A * sc < N) lo = kk; else hi = kk; }
    return Math.max(0, ft * (1 - lo * h / wc)) / Ec + lo;
  };
  const Uof = N => { let U = 0; for (let i = 0; i < n; i++) U += h * cellStrain(i, N); return U; };
  const reference = U => { let lo = 0, hi = As * fy * (1 - 1e-9); if (Uof(hi) < U) return NaN; for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (Uof(mid) < U) lo = mid; else hi = mid; } return lo; };
  let worst = 0, compared = 0;
  let converged = true;
  for (const r of rows) { const c = reference(r.U); if (Number.isNaN(c)) continue; compared++; converged &&= r.converged; worst = Math.max(worst, Math.abs(r.N - c) / (As * fy)); }
  const strain = rows.find(r => r.U >= 0.4 * 1e-3 * Lx * 2.5 - 1e-15);
  return {worst, compared, elastic: rows[0].N / (rows[0].U / Lx), EA, plateau: rows.at(-1).N, Ny: As * fy, converged, unconverged: rows.filter(r => !r.converged).length,
    stiffening: strain ? (strain.N - Es * As * strain.U / Lx) / (As * fy) : NaN, rows};
});

/** A reinforced C30/37 beam, 1.2 m span, 200 x 100 mm, two 6 mm B500B bars at d = 170 mm, in four-point bending with the
 * loads 0.5 m from the supports (half the span by symmetry, half the width by symmetry: 12 x 8 x 1 cells), driven by
 * the displacement of the loading line. The moment at the first crack and at the first yield of a bar segment, against
 * the transformed uncracked section (f_ctm I / (h - y)) and the cracked elastic section (A_s f_y d (1 - k / 3)). */
export const beam = (linearSolver = 'cg') => memo(`concrete/beam/${linearSolver}`, async () => {
  const {SolidBody, boxMesh} = await solid(), m = await c30(), steel = await b500();
  const half = 0.6, H = 0.2, bw = 0.05, a = 0.5, d = 0.17, dia = 0.006, As = Math.PI * dia * dia / 4, nx = 12, ny = 8, steps = 120, end = -1.2e-3;
  const b = new SolidBody({mesh: boxMesh({size: [half, H, bw], cells: [nx, ny, 1]}), material: {...m, concrete: {...m.concrete, bandWidth: half / nx}}, config: {model: 'green-lagrange', tolerance: 1e-8, forceTolerance: 1e-4, maxNewtonIterations: 200, linearSolver},
    reinforcement: {bars: [{points: [0, H - d, bw / 2, half, H - d, bw / 2], area: As, ...steel}]}});
  const sup = b.selectNodes((x, y) => near(x, 0) && near(y, 0)), sym = b.selectNodes(x => near(x, half)), z0 = b.selectNodes((x, y, z) => near(z, 0));
  const load = b.selectNodes((x, y) => near(y, H) && Math.abs(x - a) < 0.51 * half / nx);
  b.constrain(sup, [null, 0, null]); b.constrain(sym, [0, null, null]); b.constrain(z0, [null, null, 0]);
  let previous = b.displacements.slice(), before = previous.slice(), last = 0, crack = null, yieldAt = null, converged = true, inner = 0;
  for (let i = 1; i <= steps && !yieldAt; i++) {
    const u = end * i / steps, guess = new Float64Array(previous.length);
    for (let j = 0; j < guess.length; j++) guess[j] = 2 * previous[j] - before[j];
    for (const k of load) guess[3 * k + 1] = u; for (const k of sup) guess[3 * k + 1] = 0; for (const k of sym) guess[3 * k] = 0; for (const k of z0) guess[3 * k + 2] = 0;
    b.constrain(load, [null, u, null]); b.setState(guess);
    const r = b.solveStatic(); converged &&= r.converged; inner += b.stats.linearIterations;
    let R = 0; for (const k of sup) R += r.reactions[3 * k + 1];
    const M = 2 * R * a;
    if (!crack && b.crackOpening().some(w => w > 0)) crack = [last, M];
    if (b.reinforcementForces().force.some(f => f >= As * steel.yieldStress * (1 - 1e-9))) yieldAt = [last, M];
    last = M; before = previous; previous = b.displacements.slice();
  }
  // Hand calculation, full section b = 0.1 m, two bars.
  const B = 2 * bw, Ast = 2 * As, n = steel.youngModulus / m.youngModulus, ft = m.concrete.tensileStrength, fy = steel.yieldStress;
  const At = B * H + (n - 1) * Ast, y = (B * H * H / 2 + (n - 1) * Ast * d) / At, I = B * H ** 3 / 12 + B * H * (H / 2 - y) ** 2 + (n - 1) * Ast * (d - y) ** 2;
  const rho = Ast / (B * d), k = Math.sqrt(2 * rho * n + (rho * n) ** 2) - rho * n;
  return {crack, yield: yieldAt, Mcr: ft * I / (H - y), My: Ast * fy * d * (1 - k / 3), converged, inner};
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
    note: 'The cell crushes homogeneously. In a longer prism a band of elements crushes and dissipates G_c per unit area scaled by its peak (rows band-compression-*).', measure: async () => (await band(h)).perArea})),
  ...[[10, 1], [20, 1], [40, 1], [20, 2]].map(([n, m]) => ({id: `solid.concrete.band-tension-${n}x${m}x${m}`, title: `Concrete law: crack band per element in tension, ${n} x ${m} x ${m} cells`, quantity: `work of the end force until a 0.2 m bar of ${n} x ${m} x ${m} cells (no bandWidth given) carries nothing, over 0.98 G_f A`, unit: '1', test: CT.bandTension,
    reference: {formula: 'G_f = 73 f_cm^0.18 N/m (fib Model Code 2010, quoted by Sucharda 2020, eq. 14), crack band of each element: its width along the crack normal', value: 1}, tolerance: relative(0.05),
    note: `Cells of ${200 / n} x ${40 / m} x ${40 / m} mm. With the earlier default band (6 V)^(1/3) of the mean element volume the same bar dissipates 0.63 of G_f A.`,
    measure: async () => { const r = await tensionBand(n, m); return r.work / (0.98 * r.Gf * r.A); }})),
  ...[[10, 1], [20, 1], [40, 1], [20, 2]].map(([n, m]) => ({id: `solid.concrete.band-compression-${n}x${m}x${m}`, title: `Concrete law: crack band per element in compression, ${n} x ${m} x ${m} cells`, quantity: `plastic work after the peak of a 0.2 m prism of ${n} x ${m} x ${m} cells (40 mm zone 10 % weaker, no bandWidth given), over G_c A sigma_peak / f_cm`, unit: '1', test: CT.bandCompression,
    reference: {formula: 'G_c = f_cm w_d / 2, w_d = 0.5 mm (the law\'s default, after the ATENA crack band model; from memory), anchored at the band\'s peak', value: 1}, tolerance: relative(0.05),
    note: 'One band of elements crushes. Against 0.9 G_c A (the zone\'s strength factor) the ratio is 0.96 to 1.06: the zone\'s pre-peak dilatancy draws confinement from the stronger ends, by an amount that depends on the mesh, and the softening starts from that peak.',
    measure: async () => (await crushBand(n, m)).ratio})),
  ...[0.05, 0.2].map(r => ({id: `solid.concrete.confined-${Math.round(r * 100)}`, title: `Concrete law: strength under a lateral pressure of ${r} f_cm`, quantity: 'peak axial stress of one cell under constant lateral pressure', unit: 'Pa', test: CT.confinement,
    reference: {formula: r <= 0.05 ? 'f_cm (1 + 5 sigma_2 / f_cm), EN 1992-1-1 (3.24)' : 'f_cm (1.125 + 2.5 sigma_2 / f_cm), EN 1992-1-1 (3.25)', value: null}, tolerance: relative(0.01),
    note: 'Applied to the mean strength (the standard writes it for f_ck). The pressure of the last step sets the strength of the next (non-associated flow solved as associated steps), which leaves this cell 0.3 % low at 160 load steps.',
    measure: async () => { const c = await confined(r); return {value: c.peak, reference: c.closed}; }})),
  {id: 'solid.concrete.biaxial', title: 'Concrete law: equal-biaxial compressive strength', quantity: 'peak stress of one cell compressed equally along two axes, over f_cm', unit: '1', test: CT.biaxial,
    reference: {formula: 'Kupfer, Hilsdorf and Rusch (1969), ACI J. 66(8): "only 16 percent larger than under uniaxial compression" (abstract)', value: 1.16}, tolerance: relative(0.01),
    note: 'Fitted: the eccentricity of the deviatoric section is chosen for this point. At sigma_2 / sigma_1 = 0.5 the peak surface gives 1.39 f_cm against Kupfer\'s 1.27 (a miss, see notValidated).', measure: async () => (await biaxial()).ratio},
  {id: 'solid.concrete.dilatancy', title: 'Concrete law: non-associated plastic volume change', quantity: 'volumetric plastic strain per unit kappa_c of a return past the elastic limit, over psi', unit: '1', test: CT.flow,
    reference: {formula: 'tr(d eps_p) = psi d kappa_c, psi = tan 30 degrees (potential q r(theta) + psi p)', value: 1}, tolerance: absolute(1e-9),
    measure: async () => { const f = await flow(); return f.volumetric / f.psi; }},
  {id: 'solid.concrete.cube-cylinder', file: STUDIO_FILE, title: 'Concrete: cube strength over cylinder strength between steel platens', quantity: 'peak stress of the 150 mm cube over that of the 150 x 300 mm cylinder (C30/37, the Studio lab\'s models, platen friction 0.2)', unit: '1', test: CT.cube,
    reference: {formula: 'f_ck,cube / f_ck = 37 / 30 (EN 1992-1-1 Table 3.1, C30/37)', value: 37 / 30}, tolerance: relative(0.05),
    note: 'The friction 0.2 is the value Stredulova and Elias (Engineering Mechanics 2023, p. 239) use between steel platens and concrete in their model of the compression test, a calibrated input, not a measurement. Measured coefficients of steel plate on concrete or grout are 0.43 to 0.70 (Gomez, Kanvinde and Deierlein, AISC Eng. J. 2011); with 0.57 the ratio is 1.43, a miss. Read this row as: the friction another compression-test model needs is also the one that gives this law the code\'s ratio.',
    measure: async () => (await cubeAndCylinder()).ratio},
  {id: 'solid.concrete.cylinder-slenderness', file: STUDIO_FILE, title: 'Concrete: a cylinder as tall as its diameter over the standard cylinder', quantity: 'peak stress of a 150 x 150 mm cylinder over that of the 150 x 300 mm cylinder, same platens (friction 0.2)', unit: '1', test: CT.cube,
    reference: {formula: '1.17: the correction of CSN EN 12390-3/Z1 for slenderness 1, as quoted by Stredulova and Elias (2023)', value: 1.17}, tolerance: relative(0.03),
    note: 'The same paper measures and computes (lattice discrete particle model, friction 0.2, 50 mm cylinders) about 1.23: this law is 5 % below that.',
    measure: async () => (await cubeAndCylinder()).slenderness},
  {id: 'solid.concrete.tie', title: 'Reinforced concrete tie: cracking to yield', quantity: 'largest difference of the end force from the one-dimensional series model of the same cells, over A_s f_y', unit: '1', test: CT.tie,
    reference: {formula: 'series model: each cell elastic, or cracked with N = A_s min(E_s eps_b, f_y) + A sigma_c(kappa); B500B: E_s 200 GPa, f_yk 500 MPa (EN 1992-1-1 3.2.7, Table C.1)', value: 0}, tolerance: absolute(0.03),
    note: '10 mm section, 40 mm cells: slender, so the force the bar hands over at a crack spreads across the section at once. With a 50 mm section the difference is 14 % of A_s f_y (shear lag the series model ignores).',
    measure: async () => (await tie(0.01)).worst},
  {id: 'solid.concrete.beam-cracking', title: 'Reinforced concrete beam: cracking moment', quantity: 'moment at the first cracked element (mean of the load steps either side) of a 200 x 100 mm C30/37 beam with two 6 mm bars, four-point bending', unit: 'N m', test: CT.beam,
    reference: {formula: 'M_cr = f_ctm I / (h - y), transformed uncracked section (n = E_s / E_cm)', value: null}, tolerance: relative(0.06),
    note: 'Load steps of 160 N m bracket the crack; the element stress is at its centroid, 3 to 12 mm above the tension face (8 cells through the depth).',
    measure: async () => { const r = await beam(); return {value: (r.crack[0] + r.crack[1]) / 2, reference: r.Mcr}; }},
  {id: 'solid.concrete.beam-yield', title: 'Reinforced concrete beam: yield moment', quantity: 'moment at which the first bar segment yields', unit: 'N m', test: CT.beam,
    reference: {formula: 'M_y = A_s f_y d (1 - k / 3), k = sqrt(2 rho n + (rho n)^2) - rho n (cracked elastic section); f_yk = 500 MPa', value: null}, tolerance: relative(0.05),
    note: 'The concrete is at 0.48 f_cm at the top at yield, a little past the elastic limit of the law; tension stiffening between the smeared cracks is in the model, not in the hand calculation.',
    measure: async () => { const r = await beam(); return {value: r.yield[1], reference: r.My}; }},
]);
