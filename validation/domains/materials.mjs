// The material library (src/engine/materials.ts) in the solvers: each case builds a solver's input from a library
// entry with the library's helpers and checks the result against the closed form in which that property enters,
// with the reference computed from the library values directly. It checks that the values reach the solvers in
// the right units and roles; it does not check the values against experiments (docs/MATERIALS.md has their sources).
// The scenarios are exported so that tests/engine/materials.test.mjs and packages/box3d-kit/test/v18-materials.test.mjs
// assert on the same runs. SI units.
import {engine, kit, memo, defineCases, relative, absolute, upper} from '../lib.mjs';
import {griffithStrength} from './fracture.mjs';

const FILE = 'tests/engine/materials.test.mjs';
const KIT_FILE = 'packages/box3d-kit/test/v18-materials.test.mjs';
const T = {
  consistency: 'internal consistency: G = E / (2 (1 + nu)) for the isotropic entries with three sourced moduli, and the disagreements are flagged',
  tension: 'an aluminium 6061-T6 bar in tension stretches by F L / (E A) with the library E',
  cantilever: 'a structural-steel cantilever deflects as Timoshenko beam theory says with the library E and nu',
  expansion: 'a free stainless 304 bar heated by 100 K grows by alpha dT L with the library alpha',
  griffith: 'a soda-lime glass plate fails at the Griffith stress of the library K_IC',
  diffusion: 'a copper bar cools with the time constant L^2 / (pi^2 alpha) of the library k, rho and c_p',
  hertz: 'two natural-rubber spheres and two glass beads stay in contact for the Hertz duration of the library E, nu and rho',
  restitution: 'two glass beads rebound at the library restitution',
  rigid: 'with the library steel-on-steel values a block slides to v0^2 / (2 mu_k g) and a ball rebounds to e^2 h',
};

const G = 9.81, HZ = 240, SUB = 4;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const lib = () => engine('materials');

// ---- Internal consistency --------------------------------------------------------------------------------------

/** The isotropic entries whose E, nu and G all come from a source and are not flagged, with |G / (E / 2 (1 + nu)) - 1|. */
export async function shearConsistencies() {
  const M = await lib();
  return M.materialIds().map(id => M.shearConsistency(id)).filter(row => row !== null);
}
export const CONSISTENT = [['aluminium-6061-t6', 0.01, 'E and G to three and two digits; G and nu "estimated from trends in similar Al alloys".'],
  ['soda-lime-glass', 0.03, 'The sheet gives E and G to two digits (72 and 30 GPa), so G is known to about 1.7% and E to 0.7%.'],
  ['granite-barre', 0.01, 'One specimen set, four values from one table.'],
  ['structural-steel-s355', 0.005, 'The design value G ≈ 81000 MPa is itself E / (2 (1 + nu)) rounded.']];

// ---- Solids --------------------------------------------------------------------------------------------------------

const facesWithNormal = (body, axis, sign) => body.selectFaces((cx, cy, cz, nx, ny, nz) => sign * [nx, ny, nz][axis] > 0.999);
const mean = (values, nodes, component) => { let s = 0; for (const n of nodes) s += values[3 * n + component]; return s / nodes.length; };
function symmetryPlanes(body) {
  body.constrain(body.selectNodes(x => near(x, 0)), [0, null, null]);
  body.constrain(body.selectNodes((x, y) => near(y, 0)), [null, 0, null]);
  body.constrain(body.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]);
}

export const TENSION = {L: 2, b: 0.05, h: 0.04, F: 2e5};
export const tension = () => memo('materials/tension', async () => {
  const {SolidBody, boxMesh} = await engine('solid'), M = await lib(), {L, b, h, F} = TENSION;
  const material = M.solidMaterial('aluminium-6061-t6');
  const body = new SolidBody({mesh: boxMesh({size: [L, b, h], cells: [8, 2, 2]}), material, config: {model: 'linear', tolerance: 1e-12}});
  symmetryPlanes(body); body.addTraction(facesWithNormal(body, 0, 1), [F / (b * h), 0, 0]);
  const result = body.solveStatic();
  return {elongation: mean(result.displacements, body.selectNodes(x => near(x, L)), 0), exact: F * L / (M.materialProperty('aluminium-6061-t6', 'youngModulus') * b * h)};
});

export const CANTILEVER = {L: 1, t: 0.1, F: 2000};
/** End-loaded cantilever, L / t = 10, `n` cells through the thickness; the reference is Timoshenko's with the library E and nu. */
export const cantilever = n => memo(`materials/cantilever/${n}`, async () => {
  const {SolidBody, boxMesh} = await engine('solid'), M = await lib(), {L, t, F} = CANTILEVER, id = 'structural-steel-s355';
  const body = new SolidBody({mesh: boxMesh({size: [L, t, t], cells: [10 * n, n, n]}), material: M.solidMaterial(id), config: {model: 'linear'}});
  body.constrain(body.selectNodes(x => near(x, 0))); body.addTraction(facesWithNormal(body, 0, 1), [0, -F / (t * t), 0]);
  const result = body.solveStatic(), tip = mean(result.displacements, body.selectNodes(x => near(x, L)), 1);
  const E = M.materialProperty(id, 'youngModulus'), nu = M.materialProperty(id, 'poissonRatio'), I = t ** 4 / 12, Gs = E / (2 * (1 + nu)), kappa = 10 * (1 + nu) / (12 + 11 * nu);
  const bending = -F * L ** 3 / (3 * E * I), timoshenko = bending - F * L / (kappa * Gs * t * t);
  return {tip, bending, timoshenko};
});

export const EXPANSION = {L: 1, b: 0.05, rise: 100};
export const expansion = () => memo('materials/expansion', async () => {
  const {SolidBody, boxMesh} = await engine('solid'), M = await lib(), {L, b, rise} = EXPANSION, id = 'stainless-304';
  const body = new SolidBody({mesh: boxMesh({size: [L, b, b], cells: [6, 1, 1]}), material: M.solidMaterial(id), config: {model: 'linear', tolerance: 1e-13}});
  symmetryPlanes(body); body.setTemperatureChange(rise);
  const result = body.solveStatic();
  return {growth: mean(result.displacements, body.selectNodes(x => near(x, L)), 0), exact: M.materialProperty(id, 'thermalExpansion') * rise * L};
});

// ---- Fracture ------------------------------------------------------------------------------------------------------

/** The centre-cracked plate of the fracture domain, made of soda-lime glass: the thin plate is in plane stress, so
 * G_c = K_IC^2 / E (fractureLaw with state 'plane-stress') and the Griffith stress is K_IC / (Y sqrt(pi a)). */
export const glassPlate = (cell = 0.5) => memo(`materials/glass-plate/${cell}`, async () => {
  const M = await lib(), id = 'soda-lime-glass', law = M.fractureLaw(id, {state: 'plane-stress'});
  const r = await griffithStrength({cell, material: M.solidMaterial(id, {thermalExpansion: null}), strength: law.strength, toughness: law.toughness});
  const K = M.materialProperty(id, 'fractureToughness');
  return {...r, law, griffith: K / (r.Y * Math.sqrt(Math.PI * r.a)), body: undefined, top: undefined, bottom: undefined};
});

// ---- Heat ----------------------------------------------------------------------------------------------------------

export const DIFFUSION = {L: 0.1, cells: 50, hot: 400, cold: 300};
/** A copper bar at 400 K with both ends held at 300 K: past the first instants it cools in its slowest mode,
 * exp(-t / tau) with tau = L^2 / (pi^2 alpha). tau is read from the mid-point excess at tau and 2 tau. */
export const diffusion = () => memo('materials/diffusion', async () => {
  const {HeatSolver} = await engine('heat'), M = await lib(), {L, cells, hot, cold} = DIFFUSION, id = 'copper-c11000';
  const tau = L * L / (Math.PI ** 2 * M.thermalDiffusivity(id)), perTau = 2000, dt = tau / perTau;
  const solver = new HeatSolver({nx: cells, ny: 1, nz: 1, dx: L / cells, dy: 1, dz: 1, materials: [M.heatMaterial(id)], temperature: hot, dt, scheme: 'crank-nicolson',
    boundaries: [{face: 'x-', type: 'temperature', temperature: cold}, {face: 'x+', type: 'temperature', temperature: cold}]});
  const middle = () => 0.5 * (solver.temperature[cells / 2 - 1] + solver.temperature[cells / 2]) - cold;
  solver.step(perTau); const first = middle(), t1 = solver.time;
  solver.step(perTau); const second = middle(), t2 = solver.time;
  return {tau, measured: (t2 - t1) / Math.log(first / second)};
});

// ---- Grains --------------------------------------------------------------------------------------------------------

/** Two equal spheres of a library material meeting head on at `speed`; returns the measured contact duration, the
 * Hertz duration from the library E, nu and rho, and the rebound ratio. */
export const headOn = (id, {restitution, friction, speed = 0.1, radius = 0.005, fraction = 0.02} = {}) => memo(`materials/head-on/${id}/${restitution}/${speed}`, async () => {
  const K = await engine('granular'), M = await lib();
  const material = M.grainMaterial(id, {...(restitution === undefined ? {} : {restitution}), ...(friction === undefined ? {} : {friction})});
  const dt = fraction * K.rayleighTime(radius, material.density, material.youngModulus, material.poissonRatio);
  const g = new K.Granular({material, config: {gravity: [0, 0, 0], dt, capacity: 2}});
  const start = 1e-3 * radius;
  g.addGrain([-radius - start, 0, 0], radius, [speed / 2, 0, 0]); g.addGrain([radius + start, 0, 0], radius, [-speed / 2, 0, 0]);
  const x = g.positions, gap = () => x[3] - x[0] - 2 * radius;
  let before = gap(), begin = null, end = null;
  for (let step = 0; step < 4e6 && end === null; step++) {
    g.step();
    const now = gap();
    if (begin === null && now < 0) begin = g.time - dt + dt * before / (before - now);
    else if (begin !== null && now >= 0) end = g.time - dt + dt * before / (before - now);
    before = now;
  }
  const mass = g.masses[0];
  // The references use the library's numbers, not the material object the helper built.
  const E = M.materialProperty(id, 'youngModulus'), nu = Math.min(M.SOLVER_POISSON_LIMIT, M.materialProperty(id, 'poissonRatio'));
  const Estar = E / (2 * (1 - nu * nu)), hertz = K.HERTZ_DURATION_FACTOR * (15 * (mass / 2) * speed * speed / (16 * Estar * Math.sqrt(radius / 2))) ** 0.4 / speed;
  return {duration: end - begin, hertz, rebound: (g.velocities[3] - g.velocities[0]) / speed, material};
});

// ---- Rigid world (needs the built kit) -----------------------------------------------------------------------------

export const RIGID = {v0: 3, drop: 0.75, radius: 0.1};
/** A steel block sliding on a steel floor with the kinetic coefficient, and a steel ball dropped 0.75 m (3.8 m/s at
 * impact, inside the 3.1 to 4.4 m/s of the restitution measurement) on it. */
export async function rigidSteel(M, createWorld) {
  const pair = M.contactPair('structural-steel-s355', 'structural-steel-s355', 'dry', {use: 'kinetic'}), {v0, drop, radius} = RIGID;
  const w = await createWorld({step: 1 / HZ, subSteps: SUB, gravity: [0, -G, 0], ground: false});
  try {
    const density = M.materialProperty('structural-steel-s355', 'density');
    w.createBody({shape: {kind: 'box', halfExtents: [50, 0.5, 5]}, type: 'static', position: [0, -0.5, 0], friction: pair.friction, restitution: pair.restitution});
    const slider = w.createBody({shape: {kind: 'box', halfExtents: [0.25, 0.05, 0.25]}, position: [0, 0.05, 0], density, friction: pair.friction, restitution: 0, lockRotation: true, linearVelocity: [v0, 0, 0]});
    for (let i = 0; i < HZ * 3; i++) w.step();
    const distance = w.getState(slider).position[0];
    const ball = w.createBody({shape: {kind: 'sphere', radius}, position: [30, drop + radius, 0], density, friction: pair.friction, restitution: pair.restitution});
    let rising = false, peak = 0;
    for (let i = 0; i < HZ * 4; i++) {
      w.step();
      const s = w.getState(ball);
      if (s.linearVelocity[1] > 0) rising = true;
      if (rising) peak = Math.max(peak, s.position[1] - radius);
      if (rising && s.linearVelocity[1] < -0.2) break;
    }
    return {distance, stopping: v0 * v0 / (2 * pair.kineticFriction * G), peak, rebound: pair.restitution ** 2 * drop, pair};
  } finally { w.dispose(); }
}
const rigid = () => memo('materials/rigid', async () => rigidSteel(await lib(), (await kit('index')).createWorld));

export default defineCases('materials', FILE, [
  ...CONSISTENT.map(([id, tolerance, note]) => ({id: `materials.consistency.${id}`, title: `Consistency of the moduli: ${id}`, quantity: 'shear modulus as the source states it', unit: 'Pa', test: T.consistency,
    reference: {formula: 'G = E / (2 (1 + nu)) from the stated E and nu', value: null}, tolerance: relative(tolerance), note,
    measure: async () => { const row = (await shearConsistencies()).find(one => one.id === id); return {value: row.stated, reference: row.isotropic}; }})),
  {id: 'materials.consistency.flagged', title: 'Consistency of the moduli: the disagreements are flagged', quantity: 'entries whose G is more than 3% from E / (2 (1 + nu)) and that do not say so', unit: '1', test: T.consistency,
    reference: {formula: 'none unflagged', value: 0}, tolerance: absolute(0),
    note: 'Stainless 304 (G 13% above, from one datasheet) and PMMA (a dynamic G at 10 Hz against a short-term E, 41% above) are flagged in the library and kept as stated.',
    measure: async () => (await shearConsistencies()).filter(row => Math.abs(row.relative) > 0.03 && !row.flagged).length},
  {id: 'materials.tension.aluminium-6061-t6', title: 'Aluminium 6061-T6 bar in tension', quantity: 'elongation of a 2 m bar, 50 x 40 mm, under 200 kN, built with solidMaterial', unit: 'm', test: T.tension,
    reference: {formula: 'dL = F L / (E A), E from the library', value: null}, tolerance: relative(1e-9),
    measure: async () => { const r = await tension(); return {value: r.elongation, reference: r.exact}; }},
  {id: 'materials.cantilever.steel-s355', title: 'Structural steel S355 cantilever, 8 cells through the thickness', quantity: 'tip deflection of a 1 m cantilever, 100 x 100 mm, 2 kN at the end, 80 x 8 x 8 cells', unit: 'm', test: T.cantilever,
    reference: {formula: 'u = -(F L^3 / (3 E I) + F L / (kappa G A)), E and nu from the library', value: null}, tolerance: relative(0.045),
    note: 'Linear tetrahedra are stiff in bending (the solid domain measures the locking; 3.7% here, 5.8% at 6 cells, 11% at 4): the tolerance is that discretisation error, not uncertainty in E.',
    measure: async () => { const r = await cantilever(8); return {value: r.tip, reference: r.timoshenko}; }},
  {id: 'materials.expansion.stainless-304', title: 'Stainless 304 bar heated by 100 K', quantity: 'free growth of a 1 m bar with the thermal eigenstrain', unit: 'm', test: T.expansion,
    reference: {formula: 'dL = alpha dT L, alpha from the library', value: null}, tolerance: relative(1e-9),
    measure: async () => { const r = await expansion(); return {value: r.growth, reference: r.exact}; }},
  {id: 'materials.griffith.soda-lime-glass', title: 'Soda-lime glass plate: Griffith stress', quantity: 'remote stress at which a centre crack of half-length 5 l_ch runs (l_ch = 0.33 mm), cells of l_ch / 2, cohesive law from fractureLaw', unit: 'Pa', test: T.griffith,
    reference: {formula: 'K_IC / (Y sqrt(pi a)), Y = sqrt(sec(pi a / (2 b))), K_IC from the library', value: null}, tolerance: relative(0.05),
    note: 'The plate of fracture.griffith.fine scaled to glass, and it reads the same 3.5% low: the process zone of a crack of 5 l_ch. Thin plate, so G_c = K_IC^2 / E (plane stress).',
    measure: async () => { const r = await glassPlate(0.5); return {value: r.strength, reference: r.griffith}; }},
  {id: 'materials.diffusion.copper', title: 'Copper bar cooling: time constant', quantity: 'decay time of the mid-point excess of a 0.1 m bar between its ends at 300 K, 50 cells, Crank-Nicolson', unit: 's', test: T.diffusion,
    reference: {formula: 'tau = L^2 / (pi^2 alpha), alpha = k / (rho c_p) from the library', value: null}, tolerance: relative(1e-3),
    note: 'Second-order finite volumes: the slowest eigenvalue is about 3e-4 off at 50 cells.',
    measure: async () => { const r = await diffusion(); return {value: r.measured, reference: r.tau}; }},
  {id: 'materials.hertz.natural-rubber', title: 'Natural-rubber spheres: Hertz contact duration', quantity: 'contact time of two 10 mm spheres meeting at 0.1 m/s, restitution 1, step 2% of the Rayleigh time', unit: 's', test: T.hertz,
    reference: {formula: 't = 2.9433 d / v, d = (15 m* v^2 / (16 E* sqrt(R*)))^(2/5), E* = E / (2 (1 - nu^2)), library E, nu (capped at 0.4999) and rho', value: null}, tolerance: relative(1e-3),
    note: 'Restitution 1 and friction 0 are passed in (the library has no sourced rubber-on-rubber values); the overlap reaches about 1.5% of the radius.',
    measure: async () => { const r = await headOn('natural-rubber', {restitution: 1, friction: 0}); return {value: r.duration, reference: r.hertz}; }},
  {id: 'materials.hertz.glass-beads', title: 'Glass beads: Hertz contact duration', quantity: 'contact time of two 10 mm glass beads meeting at 0.1 m/s, restitution 1', unit: 's', test: T.hertz,
    reference: {formula: 't = 2.9433 d / v, d = (15 m* v^2 / (16 E* sqrt(R*)))^(2/5), library E, nu and rho', value: null}, tolerance: relative(1e-3),
    measure: async () => { const r = await headOn('glass-beads', {restitution: 1}); return {value: r.duration, reference: r.hertz}; }},
  {id: 'materials.restitution.glass-beads', title: 'Glass beads: restitution', quantity: 'rebound speed over impact speed of two beads built with grainMaterial, at 0.1 m/s', unit: '1', test: T.restitution,
    reference: {formula: 'e of glass beads on glass beads in the library', value: 0.926}, tolerance: absolute(1e-3),
    measure: async () => (await headOn('glass-beads', {fraction: 0.01})).rebound},
  {id: 'materials.rigid.sliding.steel', title: 'Steel on steel: sliding distance', quantity: 'distance a steel block slides from 3 m/s on a steel floor, kinetic coefficient from contactPair', unit: 'm', test: T.rigid, file: KIT_FILE,
    reference: {formula: 'd = v0^2 / (2 mu_k g), mu_k = 0.3 (steel on steel, dry)', value: 9 / (2 * 0.3 * G)}, tolerance: relative(0.01),
    measure: async () => (await rigid()).distance},
  {id: 'materials.rigid.rebound.steel', title: 'Steel on steel: rebound height', quantity: 'first rebound of a steel ball dropped 0.75 m on a steel floor, restitution from contactPair', unit: 'm', test: T.rigid, file: KIT_FILE,
    reference: {formula: 'h1 = e^2 h, e = 0.56 (steel ball on steel plate at 3.1 to 4.4 m/s)', value: 0.56 ** 2 * 0.75}, tolerance: relative(0.03),
    note: 'At 240 Hz one step of gravity is 0.04 m/s against 3.8 m/s at impact; the ball reads about 2% low, as the rigid domain\'s 5 m drop reads within 2%.',
    measure: async () => (await rigid()).peak},
]);
