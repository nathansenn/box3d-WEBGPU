// Deformable solids: tetrahedral finite elements (src/engine/solid.ts), against closed-form elasticity.
// Set-ups are those of tests/engine/solid.test.mjs. SI units.
import {engine, memo, defineCases, relative, absolute, upper, lower, order} from '../lib.mjs';

const FILE = 'tests/engine/solid.test.mjs';
const T = {
  patch: 'patch test: an arbitrary uniform strain is reproduced on an irregular mesh to 1e-10',
  tension: 'uniaxial tension: elongation F L / (E A), lateral strain -nu, uniform stress F / A',
  moduli: 'simple shear gives G = E / (2 (1 + nu)) and hydrostatic pressure gives K = E / (3 (1 - 2 nu))',
  hanging: 'a bar hanging under its own weight stretches by rho g L^2 / (2 E)',
  cantilever: 'cantilever with an end load converges to F L^3 / (3 E I) + F L / (kappa G A); locking is measured',
  axial: 'axial vibration of a fixed-free bar: f1 = sqrt(E / rho) / (4 L), second-order convergence, and the time integrator agrees',
  bending: 'first bending frequency of a cantilever approaches Euler-Bernoulli theory',
  wave: 'a suddenly loaded bar carries its stress wave at sqrt(E / rho)',
  energy: 'energy: the midpoint rule conserves it over 30 periods, backward Euler only loses it',
  damping: 'Rayleigh damping: a mode decays as exp(-(alpha / 2 + beta omega^2 / 2) t)',
  neo: 'Neo-Hookean bar stretched to twice its length matches the analytic nominal stress',
  thermal: 'thermal eigenstrain: a free block expands by alpha dT without stress, a restrained bar carries -E alpha dT',
};

const steel = {youngModulus: 200e9, poissonRatio: 0.3, density: 7850};
const lame = ({youngModulus: E, poissonRatio: nu}) => ({lambda: E * nu / ((1 + nu) * (1 - 2 * nu)), mu: E / (2 * (1 + nu))});
const near = (a, b) => Math.abs(a - b) < 1e-9;
const solid = () => engine('solid');

/** Moves the interior nodes of a box mesh by a repeatable pseudo-random fraction of a cell. */
function jitter(boxNode, mesh, cells, size, amount = 0.35) {
  let seed = 20261111; const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296 - 0.5; };
  for (let k = 1; k < cells[2]; k++) for (let j = 1; j < cells[1]; j++) for (let i = 1; i < cells[0]; i++) {
    const n = boxNode(cells, i, j, k); for (let c = 0; c < 3; c++) mesh.positions[3 * n + c] += amount * size[c] / cells[c] * random();
  }
  return mesh;
}
const irregular = async (size, cells) => { const {boxMesh, boxNode} = await solid(); return jitter(boxNode, boxMesh({size, cells}), cells, size); };
/** Symmetry planes x = 0, y = 0, z = 0: no rigid motion, free Poisson contraction. */
function symmetryPlanes(body) {
  body.constrain(body.selectNodes(x => near(x, 0)), [0, null, null]);
  body.constrain(body.selectNodes((x, y) => near(y, 0)), [null, 0, null]);
  body.constrain(body.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]);
}
const facesWithNormal = (body, axis, sign) => body.selectFaces((cx, cy, cz, nx, ny, nz) => sign * [nx, ny, nz][axis] > 0.999);
const sumComponent = (values, nodes, component) => { let s = 0; for (const n of nodes) s += values[3 * n + component]; return s; };
const meanComponent = (values, nodes, component) => sumComponent(values, nodes, component) / nodes.length;

const patch = model => memo(`solid/patch/${model}`, async () => {
  const {SolidBody} = await solid();
  const A = [1.0e-3, 2.0e-4, -3.0e-4, 4.0e-4, -2.0e-3, 5.0e-4, -1.0e-4, 3.0e-4, 1.5e-3], size = [1.2, 0.9, 0.7], cells = [3, 3, 3];
  const body = new SolidBody({mesh: await irregular(size, cells), material: steel, config: {model, tolerance: 1e-13}}), X = body.referencePositions;
  const field = n => [0, 1, 2].map(i => A[3 * i] * X[3 * n] + A[3 * i + 1] * X[3 * n + 1] + A[3 * i + 2] * X[3 * n + 2]);
  for (const n of body.selectNodes((x, y, z) => near(x, 0) || near(x, size[0]) || near(y, 0) || near(y, size[1]) || near(z, 0) || near(z, size[2]))) body.constrain([n], field(n));
  const result = body.solveStatic();
  let error = 0, scale = 0;
  for (let n = 0; n < body.nodeCount; n++) { const f = field(n); for (let i = 0; i < 3; i++) { error = Math.max(error, Math.abs(result.displacements[3 * n + i] - f[i])); scale = Math.max(scale, Math.abs(f[i])); } }
  return error / scale;
});

const TENSION = {L: 2, b: 0.3, h: 0.2, F: 5e4};
const tension = () => memo('solid/tension', async () => {
  const {SolidBody} = await solid(), {L, b, h, F} = TENSION, A = b * h;
  const body = new SolidBody({mesh: await irregular([L, b, h], [6, 2, 2]), material: steel, config: {model: 'linear', tolerance: 1e-12}});
  symmetryPlanes(body); body.addTraction(facesWithNormal(body, 0, 1), [F / A, 0, 0]);
  const result = body.solveStatic();
  return {elongation: meanComponent(result.displacements, body.selectNodes(x => near(x, L)), 0), stress: body.stresses()[0],
    lateral: meanComponent(result.displacements, body.selectNodes((x, y) => near(y, b)), 1) / b, energy: result.strainEnergy};
});

const moduli = () => memo('solid/moduli', async () => {
  const {SolidBody, boxNode} = await solid(), L = 1, cells = [3, 3, 3], tau = 4e7, p = 5e7;
  const shear = new SolidBody({mesh: await irregular([L, L, L], cells), material: steel, config: {model: 'linear', tolerance: 1e-12}});
  shear.addTraction(facesWithNormal(shear, 1, 1), [tau, 0, 0]); shear.addTraction(facesWithNormal(shear, 1, -1), [-tau, 0, 0]);
  shear.addTraction(facesWithNormal(shear, 0, 1), [0, tau, 0]); shear.addTraction(facesWithNormal(shear, 0, -1), [0, -tau, 0]);
  shear.constrain([boxNode(cells, 0, 0, 0)], [0, 0, 0]); shear.constrain([boxNode(cells, 3, 0, 0)], [null, 0, 0]); shear.constrain([boxNode(cells, 0, 0, 3)], [0, null, null]);
  const sheared = shear.solveStatic(), gamma = sheared.displacements[3 * boxNode(cells, 0, 3, 0)] / L;
  const block = new SolidBody({mesh: await irregular([L, L, L], cells), material: steel, config: {model: 'linear', tolerance: 1e-12}});
  symmetryPlanes(block); for (const axis of [0, 1, 2]) block.addPressure(facesWithNormal(block, axis, 1), p);
  block.solveStatic();
  const strain = block.strains(); let dilatation = 0;
  for (let e = 0; e < block.tetCount; e++) dilatation += block.elementVolume[e] * (strain[6 * e] + strain[6 * e + 1] + strain[6 * e + 2]);
  return {shear: tau / gamma, bulk: -p / (dilatation / block.referenceVolume)};
});

const hangingBar = () => memo('solid/hanging', async () => {
  const {SolidBody, boxMesh} = await solid(), L = 3, w = 0.2, g = 9.81, n = 4;
  const body = new SolidBody({mesh: boxMesh({size: [L, w, w], cells: [15 * n, n, n]}), material: {...steel, poissonRatio: 0}, config: {model: 'linear', gravity: [g, 0, 0], tolerance: 1e-12}});
  symmetryPlanes(body); const result = body.solveStatic();
  return {tip: meanComponent(result.displacements, body.selectNodes(x => near(x, L)), 0), reaction: sumComponent(result.reactions, body.selectNodes(x => near(x, 0)), 0)};
});

/** End-loaded cantilever of square section t x t, n cells through the thickness; reference: Timoshenko. */
const cantilever = (n, nu, slenderness = 5) => memo(`solid/cantilever/${n}/${nu}`, async () => {
  const {SolidBody, boxMesh} = await solid(), L = 1, t = L / slenderness, E = 200e9, F = 1000;
  const body = new SolidBody({mesh: boxMesh({size: [L, t, t], cells: [slenderness * n, n, n]}), material: {youngModulus: E, poissonRatio: nu, density: 7850}, config: {model: 'linear'}});
  body.constrain(body.selectNodes(x => near(x, 0))); body.addTraction(facesWithNormal(body, 0, 1), [0, -F / (t * t), 0]);
  const result = body.solveStatic();
  const I = t ** 4 / 12, G = E / (2 * (1 + nu)), kappa = 10 * (1 + nu) / (12 + 11 * nu), timoshenko = -F * L ** 3 / (3 * E * I) - F * L / (kappa * G * t * t);
  const tip = meanComponent(result.displacements, body.selectNodes(x => near(x, L)), 1);
  return {tip, timoshenko, error: tip / timoshenko - 1};
});
const timoshenko = nu => { const t = 0.2, E = 200e9, F = 1000, I = t ** 4 / 12, G = E / (2 * (1 + nu)), kappa = 10 * (1 + nu) / (12 + 11 * nu); return -F / (3 * E * I) - F / (kappa * G * t * t); };

const AXIAL = Math.sqrt(200e9 / 7850) / 4;
const axialMode = nx => memo(`solid/axial/${nx}`, async () => {
  const {SolidBody, boxMesh} = await solid(), L = 1, w = L / nx;
  const body = new SolidBody({mesh: boxMesh({size: [L, w, w], cells: [nx, 1, 1]}), material: {youngModulus: 200e9, poissonRatio: 0, density: 7850}, config: {model: 'linear', integrator: 'midpoint', dt: 1 / (AXIAL * 200), tolerance: 1e-12}});
  body.constrain(body.selectNodes(x => near(x, 0))); body.constrain(body.selectNodes(() => true), [null, 0, 0]);
  return body.fundamentalMode().frequency;
});

const BENDING = 1.875104068711961 ** 2 / (2 * Math.PI) * Math.sqrt(200e9 * 0.01 / (12 * 7850));
const bendingMode = n => memo(`solid/bending/${n}`, async () => {
  const {SolidBody, boxMesh} = await solid(), L = 1, thickness = 0.1;
  const body = new SolidBody({mesh: boxMesh({size: [L, thickness, thickness], cells: [10 * n, n, n]}), material: {youngModulus: 200e9, poissonRatio: 0.3, density: 7850}, config: {model: 'linear'}});
  body.constrain(body.selectNodes(x => near(x, 0)));
  return body.fundamentalMode().frequency;
});

const waveSpeed = () => memo('solid/wave', async () => {
  const {SolidBody, boxMesh} = await solid();
  const L = 1, nx = 100, w = L / nx, E = 200e9, rho = 7850, c = Math.sqrt(E / rho), material = {youngModulus: E, poissonRatio: 0, density: rho}, mesh = boxMesh({size: [L, w, w], cells: [nx, 1, 1]});
  const limit = new SolidBody({mesh, material, config: {model: 'linear'}}).explicitLimit(), dt = 0.5 * limit.criticalTimeStep;
  const body = new SolidBody({mesh, material, config: {model: 'linear', integrator: 'explicit', dt}}), applied = 1e6;
  body.constrain(body.selectNodes(x => near(x, 0))); body.addTraction(facesWithNormal(body, 0, 1), [applied, 0, 0]);
  const X = body.referencePositions, centre = e => (X[3 * body.tets[4 * e]] + X[3 * body.tets[4 * e + 1]] + X[3 * body.tets[4 * e + 2]] + X[3 * body.tets[4 * e + 3]]) / 4;
  const stations = [0.75, 0.25].map(x => ({x, elements: [...Array(body.tetCount).keys()].filter(e => Math.abs(centre(e) - x) < w / 2), time: null, previous: 0}));
  const stress = new Float64Array(6 * body.tetCount);
  for (let step = 0; step < Math.ceil(1.2 * L / c / dt) && stations.some(s => s.time === null); step++) {
    body.step(); body.stresses(stress);
    for (const s of stations) {
      let mean = 0, volume = 0; for (const e of s.elements) { mean += stress[6 * e] * body.elementVolume[e]; volume += body.elementVolume[e]; } mean /= volume;
      if (s.time === null && mean >= 0.5 * applied) s.time = body.time - dt * (mean - 0.5 * applied) / (mean - s.previous);
      s.previous = mean;
    }
  }
  return (stations[0].x - stations[1].x) / (stations[1].time - stations[0].time);
});

/** A fixed-free bar released from a stretched and bent shape, so many modes are present. */
async function ringing(integrator, model) {
  const {SolidBody, boxMesh} = await solid(), L = 1, nx = 8, w = L / nx, E = 200e9, rho = 7850, period = 4 * L / Math.sqrt(E / rho);
  const body = new SolidBody({mesh: boxMesh({size: [L, w, w], cells: [nx, 1, 1]}), material: {youngModulus: E, poissonRatio: 0.3, density: rho}, config: {model, integrator, dt: period / 40, tolerance: 1e-12}});
  body.constrain(body.selectNodes(x => near(x, 0)));
  const X = body.referencePositions, u = new Float64Array(X.length);
  for (let n = 0; n < body.nodeCount; n++) if (!near(X[3 * n], 0)) { u[3 * n] = 1e-3 * X[3 * n]; u[3 * n + 1] = 3e-4 * X[3 * n] ** 2; }
  body.setState(u); return body;
}
const total = body => body.strainEnergy() + body.kineticEnergy();
const midpointEnergy = () => memo('solid/energy/midpoint', async () => {
  const body = await ringing('midpoint', 'linear'), initial = total(body); let drift = 0;
  for (let step = 0; step < 1200; step++) { body.step(); drift = Math.max(drift, Math.abs(total(body) / initial - 1)); }
  return drift;
});
const eulerEnergy = () => memo('solid/energy/euler', async () => {
  const body = await ringing('backward-euler', 'linear'); let previous = total(body), rise = -Infinity;
  for (let step = 0; step < 400; step++) { body.step(); const energy = total(body); rise = Math.max(rise, energy / previous - 1); previous = energy; }
  return rise;
});

const damping = () => memo('solid/damping', async () => {
  const {SolidBody, boxMesh} = await solid(), L = 1, nx = 8, w = L / nx, material = {youngModulus: 200e9, poissonRatio: 0, density: 7850}, massDamping = 900;
  const build = dt => { const body = new SolidBody({mesh: boxMesh({size: [L, w, w], cells: [nx, 1, 1]}), material, config: {model: 'linear', integrator: 'midpoint', dt, tolerance: 1e-12, massDamping}}); body.constrain(body.selectNodes(x => near(x, 0))); body.constrain(body.selectNodes(() => true), [null, 0, 0]); return body; };
  const mode = build(1e-6).fundamentalMode(), omega = mode.angularFrequency, zeta = 0.5 * massDamping / omega, damped = omega * Math.sqrt(1 - zeta * zeta);
  const steps = 400, body = build(2 * Math.PI / damped / steps), tip = body.selectNodes(x => near(x, L))[0];
  body.setState(mode.shape.map(v => 1e-4 * v)); const start = body.displacements[3 * tip];
  body.step(3 * steps);
  return {value: body.displacements[3 * tip] / start, reference: Math.exp(-zeta * omega * 3 * 2 * Math.PI / damped)};
});

const neoHookean = () => memo('solid/neo-hookean', async () => {
  const {SolidBody} = await solid();
  const rubber = {youngModulus: 3e6, poissonRatio: 0.45, density: 1100}, {lambda, mu} = lame(rubber), stretch = 2, size = [0.1, 0.02, 0.02], cells = [4, 2, 2];
  const residual = q => mu * (q * q - 1) + lambda * Math.log(stretch * q * q); let low = 0.5, high = 1;
  for (let k = 0; k < 200; k++) { const mid = 0.5 * (low + high); if (residual(mid) > 0) high = mid; else low = mid; }
  const lateral = 0.5 * (low + high), J = stretch * lateral * lateral, nominal = mu * (stretch - 1 / stretch) + lambda * Math.log(J) / stretch;
  const body = new SolidBody({mesh: await irregular(size, cells), material: rubber, config: {model: 'neo-hookean', tolerance: 1e-12}});
  symmetryPlanes(body); const end = body.selectNodes(x => near(x, size[0])); body.constrain(end, [(stretch - 1) * size[0], null, null]);
  const result = body.solveStatic({loadSteps: 10});
  return {stress: sumComponent(result.reactions, end, 0) / (size[1] * size[2]), nominal,
    lateral: 1 + meanComponent(result.displacements, body.selectNodes((x, y) => near(y, size[1])), 1) / size[1], lateralExact: lateral};
});

const THERMAL = {alpha: 1.2e-5, rise: 80, size: [0.5, 0.2, 0.1], cells: [4, 2, 2]};
const thermal = () => memo('solid/thermal', async () => {
  const {SolidBody} = await solid(), {alpha, rise, size, cells} = THERMAL, material = {...steel, thermalExpansion: alpha};
  const free = new SolidBody({mesh: await irregular(size, cells), material, config: {model: 'linear', tolerance: 1e-12}});
  symmetryPlanes(free); free.setTemperatureChange(rise); const expanded = free.solveStatic();
  const held = new SolidBody({mesh: await irregular(size, cells), material, config: {model: 'linear', tolerance: 1e-12}});
  symmetryPlanes(held); const end = held.selectNodes(x => near(x, size[0])); held.constrain(end, [0, null, null]);
  held.setTemperatureChange(new Float64Array(held.nodeCount).fill(rise)); held.solveStatic();
  return {growth: meanComponent(expanded.displacements, free.selectNodes(x => near(x, size[0])), 0), stress: held.stresses()[0]};
});


// J2 plasticity (tests/engine/solid-plasticity.test.mjs) and the press brake (tests/engine/press-brake.test.mjs).
const PLASTIC_FILE = 'tests/engine/solid-plasticity.test.mjs', PRESS_FILE = 'tests/engine/press-brake.test.mjs';
const P = {
  cycle: 'uniaxial cycle, linear model: hardening branch, elastic unloading and reverse yield match the bilinear law exactly',
  bending: 'pure bending: elastic-plastic moment-curvature of a rectangular section, and springback after release',
  cylinder: 'thick-walled cylinder under internal pressure (plane strain): first yield and the Hill collapse pressure',
  brake: 'three-point air bend, S355, 2 mm, die opening 8 t: limit load, equilibrium of punch and die, and elastic springback',
};
const PL = {E: 200e9, nu: 0.3, sy: 250e6};
const plasticCycle = () => memo('solid/plastic-cycle', async () => {
  const {SolidBody, boxMesh} = await solid(), L = 0.1, w = 0.01, H = 2e9;
  const body = new SolidBody({mesh: boxMesh({size: [L, w, w], cells: [4, 1, 1]}), material: {youngModulus: PL.E, poissonRatio: PL.nu, density: 7850, yieldStress: PL.sy, hardeningModulus: H}, config: {model: 'linear'}});
  symmetryPlanes(body); const end = body.selectNodes(x => near(x, L)), out = {};
  for (const strain of [0.006, 0.003]) { body.constrain(end, [strain * L, null, null]); const r = body.solveStatic(); out[strain] = sumComponent(r.reactions, end, 0) / (w * w); }
  return out;
});
// Bilinear law: yield at 250 MPa, tangent E H / (E + H) after; then elastic back from 0.006 until reverse yield at -(sigma_y + H p).
const HARD = 2e9, ET = PL.E * HARD / (PL.E + HARD), S6 = PL.sy + ET * (0.006 - PL.sy / PL.E), P6 = 0.006 - S6 / PL.E;
const plasticBending = () => memo('solid/plastic-bending', async () => {
  const {SolidBody, boxMesh} = await solid(), h = 0.01, b = 0.01, L = 0.02;
  const body = new SolidBody({mesh: boxMesh({size: [L, h, b / 2], cells: [16, 8, 2]}), material: {youngModulus: PL.E, poissonRatio: PL.nu, density: 7850, yieldStress: PL.sy}, config: {model: 'linear'}});
  body.constrain(body.selectNodes(x => near(x, 0)), [0, null, null]); body.constrain(body.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]); body.constrain(body.selectNodes((x, y) => near(x, 0) && near(y, h / 2)), [0, 0, null]);
  const end = body.selectNodes(x => near(x, L)), mid = body.selectNodes(x => near(x, L / 2)), X = body.referencePositions, ky = 2 * PL.sy / PL.E / h, k = 8 * ky;
  const curvature = () => { let sy = 0, sx = 0, sxy = 0, syy = 0, n0 = 0; const u = body.displacements; for (const n of mid) { const y = X[3 * n + 1] - h / 2; sy += y; sx += u[3 * n]; sxy += y * u[3 * n]; syy += y * y; n0++; } return -(n0 * sxy - sy * sx) / (n0 * syy - sy * sy) / (L / 2); };
  for (const n of end) body.constrain([n], [-k * L * (X[3 * n + 1] - h / 2), null, null]);
  const r = body.solveStatic(); let M = 0; for (const n of end) M -= r.reactions[3 * n] * (X[3 * n + 1] - h / 2);
  const moment = (kk) => { const c = Math.min(h / 2, PL.sy / PL.E / kk); return 2 * b * (PL.E * kk * c ** 3 / 3 + PL.sy * ((h / 2) ** 2 - c * c) / 2); };
  const loaded = curvature(); body.release(end); body.solveStatic();
  return {moment: 2 * M, exact: moment(k), recovered: loaded - curvature(), springback: moment(loaded) / (PL.E * b * h ** 3 / 12)};
});
const brake = () => memo('solid/press-brake', async () => {
  const {PressBrake} = await engine('press-brake'), {plasticMaterial} = await engine('materials'), t = 0.002;
  const material = {...plasticMaterial('structural-steel-s355', {allowUnverified: true}), hardeningModulus: 0, failureStrain: Infinity};
  const pb = new PressBrake({material, thickness: t, width: 1, dt: 1 / 60, friction: 0}), speed = 0.8 * t / (16 * pb.dt);
  pb.setPunchSpeed(speed); for (let s = 0; s < 16; s++) pb.step();
  const F = pb.punchForce, d = pb.deflection; pb.setPunchSpeed(-speed); for (let s = 0; s < 10; s++) pb.step();
  const Ep = material.youngModulus / (1 - material.poissonRatio ** 2), Mp = 2 / Math.sqrt(3) * material.yieldStress * t * t / 4, V = pb.dieOpening;
  return {limit: F, FL: 4 * Mp / V, recovered: d - pb.deflection, springback: F * V ** 3 / (48 * Ep * t ** 3 / 12)};
});
const PLASTIC_CASES = [
  {id: 'solid.plastic.hardening', title: 'J2 plasticity: uniaxial stress on the hardening branch', quantity: 'axial stress of a bar stretched to 0.6% (sigma_y 250 MPa, H 2 GPa, linear model)', unit: 'Pa', test: P.cycle, file: PLASTIC_FILE,
    reference: {formula: 'sigma = sigma_y + E H / (E + H) (eps - sigma_y / E)', value: S6}, tolerance: relative(1e-9), measure: async () => (await plasticCycle())[0.006]},
  {id: 'solid.plastic.reverse-yield', title: 'J2 plasticity: reverse yield after unloading', quantity: 'axial stress after unloading from 0.6% to 0.3% strain', unit: 'Pa', test: P.cycle, file: PLASTIC_FILE,
    reference: {formula: 'sigma = -(sigma_y + H p), p from the bilinear law', value: -(PL.sy + HARD * (P6 + (Math.abs(S6 - PL.E * 0.003) - PL.sy - HARD * P6) / (PL.E + HARD)))}, tolerance: relative(1e-9), measure: async () => (await plasticCycle())[0.003]},
  {id: 'solid.plastic.moment', title: 'Elastic-plastic bending moment at 8 times the yield curvature', quantity: 'end moment of a 10 x 10 mm beam in pure bending, 16 x 8 x 2 cells, perfectly plastic', unit: 'N m', test: P.bending, file: PLASTIC_FILE,
    reference: {formula: 'M = b (E k c^3 / 3 ... ) = M_y (3 / 2)(1 - (k_y / k)^2 / 3)', value: null}, tolerance: relative(0.04), note: 'Linear tetrahedra are too strong in bending: 3.2% here, from shear and plastic-incompressibility locking.',
    measure: async () => { const r = await plasticBending(); return {value: r.moment, reference: r.exact}; }},
  {id: 'solid.plastic.springback', title: 'Springback of a plastically bent beam', quantity: 'curvature recovered at mid-length when the end moment is released', unit: '1/m', test: P.bending, file: PLASTIC_FILE,
    reference: {formula: 'dk = M(k) / (E I), k the curvature reached at mid-length', value: null}, tolerance: relative(0.01),
    measure: async () => { const r = await plasticBending(); return {value: r.recovered, reference: r.springback}; }},
  {id: 'solid.press-brake.limit', title: 'Press brake: three-point air bend at the limit load', quantity: 'punch force of a 2 mm S355 sheet (perfectly plastic) over an 8 t die, divided by the beam-theory limit load', unit: '1', test: P.brake, file: PRESS_FILE,
    reference: {formula: 'F / (4 M_p\' / V) = 1, M_p\' = (2 / sqrt 3) sigma_y t^2 / 4 (plane strain)', value: 1}, tolerance: upper(0.35),
    note: 'Measured 1.23 times beam theory: a short section under a punch of radius t, and 4 cells through the thickness are 6.6% too strong in plastic plane-strain bending.',
    measure: async () => { const r = await brake(); return r.limit / r.FL; }},
  {id: 'solid.press-brake.springback', title: 'Press brake: elastic springback of the bend depth', quantity: 'bend depth recovered when the punch retracts', unit: 'm', test: P.brake, file: PRESS_FILE,
    reference: {formula: 'd = F V^3 / (48 E\' I), E\' = E / (1 - nu^2)', value: null}, tolerance: relative(0.12), note: 'Measured 0.90 of the beam value: the elastic bending stiffness of four cells through the thickness.',
    measure: async () => { const r = await brake(); return {value: r.recovered, reference: r.springback}; }},
];

const LOCKING = [[1, 0.68], [2, 0.37], [4, 0.13], [8, 0.036]];
export default defineCases('solid', FILE, [
  ...['linear', 'corotational', 'neo-hookean'].map(model => (
    {id: `solid.patch.${model}`, title: `Patch test (${model})`, quantity: 'largest displacement error of the 8 interior nodes of an irregular mesh under a uniform strain, relative to the largest displacement', unit: '1', test: T.patch,
      reference: {formula: 'u = A X at every node', value: 0}, tolerance: upper(1e-10), note: 'A linear field is in the element space, so this is the solver tolerance, not a discretisation error.',
      measure: () => patch(model)})),
  {id: 'solid.tension.elongation', title: 'Uniaxial tension: elongation', quantity: 'end displacement of a 2 m steel bar (0.3 x 0.2 m) under 50 kN', unit: 'm', test: T.tension,
    reference: {formula: 'dL = F L / (E A)', value: 5e4 * 2 / (200e9 * 0.06)}, tolerance: relative(1e-9), measure: async () => (await tension()).elongation},
  {id: 'solid.tension.stress', title: 'Uniaxial tension: stress', quantity: 'axial stress in the first element', unit: 'Pa', test: T.tension,
    reference: {formula: 'sigma = F / A', value: 5e4 / 0.06}, tolerance: relative(1e-9), measure: async () => (await tension()).stress},
  {id: 'solid.tension.lateral-strain', title: 'Uniaxial tension: Poisson contraction', quantity: 'lateral strain of the bar', unit: '1', test: T.tension,
    reference: {formula: 'eps_y = -nu F / (E A)', value: -0.3 * 5e4 / (200e9 * 0.06)}, tolerance: relative(1e-9), measure: async () => (await tension()).lateral},
  {id: 'solid.tension.energy', title: 'Uniaxial tension: strain energy', quantity: 'strain energy of the bar', unit: 'J', test: T.tension,
    reference: {formula: 'U = F^2 L / (2 E A)', value: 25e8 * 2 / (2 * 200e9 * 0.06)}, tolerance: relative(1e-9), measure: async () => (await tension()).energy},
  {id: 'solid.shear-modulus', title: 'Simple shear: shear modulus', quantity: 'tau / gamma of a unit cube under pure shear tractions', unit: 'Pa', test: T.moduli,
    reference: {formula: 'G = E / (2 (1 + nu))', value: 200e9 / 2.6}, tolerance: relative(1e-9), measure: async () => (await moduli()).shear},
  {id: 'solid.bulk-modulus', title: 'Hydrostatic pressure: bulk modulus', quantity: '-p / (dV / V) of a unit cube under pressure on three faces', unit: 'Pa', test: T.moduli,
    reference: {formula: 'K = E / (3 (1 - 2 nu))', value: 200e9 / 1.2}, tolerance: relative(1e-9), measure: async () => (await moduli()).bulk},
  {id: 'solid.hanging-bar.stretch', title: 'Bar hanging under its own weight: tip displacement', quantity: 'mean tip displacement of a 3 m steel bar, nu = 0, 60 x 4 x 4 cells', unit: 'm', test: T.hanging,
    reference: {formula: 'u = rho g L^2 / (2 E)', value: 7850 * 9.81 * 9 / (2 * 200e9)}, tolerance: relative(5e-5), note: 'The lumped weights of a tetrahedral cross-section are not uniform; the error falls with refinement.',
    measure: async () => (await hangingBar()).tip},
  {id: 'solid.hanging-bar.reaction', title: 'Bar hanging under its own weight: support reaction', quantity: 'force at the support', unit: 'N', test: T.hanging,
    reference: {formula: 'R = -rho g L A', value: -7850 * 9.81 * 3 * 0.04}, tolerance: relative(1e-10), measure: async () => (await hangingBar()).reaction},
  ...LOCKING.map(([n, bound]) => (
    {id: `solid.cantilever.locking.${n}`, title: `Cantilever tip deflection, ${n} cell${n > 1 ? 's' : ''} through the thickness`, quantity: `tip deflection of an end-loaded cantilever, L / t = 5, nu = 0, ${5 * n} x ${n} x ${n} cells`, unit: 'm', test: T.cantilever,
      reference: {formula: 'u = -(F L^3 / (3 E I) + F L / (kappa G A)) (Timoshenko)', value: timoshenko(0)}, tolerance: relative(bound),
      note: 'Linear tetrahedra are too stiff in bending (shear locking). The tolerance is the measured error with a small margin, not a claim of accuracy: use at least four cells through anything that bends.',
      measure: async () => (await cantilever(n, 0)).tip})),
  {id: 'solid.cantilever.order', title: 'Cantilever: observed order at the finest pair', quantity: 'convergence order of the tip error from 4 to 8 cells through the thickness', unit: '1', test: T.cantilever,
    reference: {formula: 'log2(e_4 / e_8) -> 2', value: 2}, tolerance: lower(0.25), note: 'The order rises towards 2 as locking fades; the test requires more than 1.75 here.',
    measure: async () => order((await cantilever(4, 0)).error, (await cantilever(8, 0)).error)},
  {id: 'solid.cantilever.volumetric-locking', title: 'Cantilever at nu = 0.4999 (volumetric locking), 4 cells', quantity: 'tip deflection of the same 4-cell cantilever as Poisson\'s ratio approaches 0.5', unit: 'm', test: T.cantilever,
    reference: {formula: 'u = -(F L^3 / (3 E I) + F L / (kappa G A)) (Timoshenko)', value: timoshenko(0.4999)}, tolerance: relative(0.30),
    note: 'A documented weakness, shown on purpose: the mesh is 25% to 30% too stiff here. nu above 0.49 needs a mixed or higher-order element, which this solver does not have.',
    measure: async () => (await cantilever(4, 0.4999)).tip},
  {id: 'solid.axial-frequency', title: 'Axial vibration of a fixed-free bar, 32 cells', quantity: 'lowest axial frequency of a 1 m steel bar', unit: 'Hz', test: T.axial,
    reference: {formula: 'f1 = sqrt(E / rho) / (4 L)', value: AXIAL}, tolerance: relative(1.3e-4), measure: () => axialMode(32)},
  {id: 'solid.axial-frequency.order', title: 'Axial vibration: observed order', quantity: 'convergence order of the frequency error from 16 to 32 cells', unit: '1', test: T.axial,
    reference: {formula: 'log2(e_16 / e_32) = 2', value: 2}, tolerance: absolute(0.02), note: 'The test asserts the order within 1% of 2.',
    measure: async () => order(await axialMode(16) / AXIAL - 1, await axialMode(32) / AXIAL - 1)},
  {id: 'solid.bending-frequency', title: 'First bending frequency of a cantilever, 4 cells through the thickness', quantity: 'lowest frequency of a 1 m cantilever, L / t = 10, nu = 0.3, 40 x 4 x 4 cells', unit: 'Hz', test: T.bending,
    reference: {formula: 'f1 = (1.8751^2 / (2 pi L^2)) sqrt(E I / (rho A)) (Euler-Bernoulli)', value: BENDING}, tolerance: relative(0.06),
    note: 'Bending locking makes the mesh too stiff, so the frequency is 5% to 6% high at four cells.', measure: () => bendingMode(4)},
  {id: 'solid.bending-frequency.order', title: 'First bending frequency: observed order', quantity: 'convergence order of the frequency error from 2 to 4 cells through the thickness', unit: '1', test: T.bending,
    reference: {formula: 'log2(e_2 / e_4) -> 2', value: 2}, tolerance: lower(0.3), note: 'The test requires more than 1.7.',
    measure: async () => order(await bendingMode(2) / BENDING - 1, await bendingMode(4) / BENDING - 1)},
  {id: 'solid.wave-speed', title: 'Stress wave in a suddenly loaded bar', quantity: 'speed of the half-height point of the stress front between x = 0.75 L and 0.25 L (100 cells, explicit)', unit: 'm/s', test: T.wave,
    reference: {formula: 'c = sqrt(E / rho)', value: Math.sqrt(200e9 / 7850)}, tolerance: relative(0.02), note: 'Lumped-mass linear elements disperse the front.', measure: waveSpeed},
  {id: 'solid.energy.midpoint', title: 'Midpoint rule: energy conservation', quantity: 'largest relative energy change over 1200 steps (30 periods), linear model', unit: '1', test: T.energy,
    reference: {formula: '|E(t) / E(0) - 1| = 0', value: 0}, tolerance: upper(1e-10), measure: midpointEnergy},
  {id: 'solid.energy.backward-euler', title: 'Backward Euler: energy never rises', quantity: 'largest relative energy rise in one step over 400 steps', unit: '1', test: T.energy,
    reference: {formula: 'E(t + dt) <= E(t)', value: 0}, tolerance: upper(1e-12), measure: eulerEnergy},
  {id: 'solid.rayleigh-damping', title: 'Rayleigh damping: amplitude after 3 periods', quantity: 'tip amplitude ratio of one axial mode with mass damping 900 /s (midpoint rule)', unit: '1', test: T.damping,
    reference: {formula: 'a / a0 = exp(-zeta omega t), zeta = alpha / (2 omega)', value: null}, tolerance: relative(2e-3), measure: damping},
  {id: 'solid.neo-hookean.stress', title: 'Neo-Hookean bar stretched to twice its length: nominal stress', quantity: 'reaction force / reference area of a rubber bar (E = 3 MPa, nu = 0.45)', unit: 'Pa', test: T.neo,
    reference: {formula: 'P = mu (s - 1 / s) + lambda ln(s q^2) / s, with mu (q^2 - 1) + lambda ln(s q^2) = 0', value: null}, tolerance: relative(1e-9),
    measure: async () => { const r = await neoHookean(); return {value: r.stress, reference: r.nominal}; }},
  {id: 'solid.neo-hookean.lateral', title: 'Neo-Hookean bar: lateral stretch', quantity: 'lateral stretch of the same bar', unit: '1', test: T.neo,
    reference: {formula: 'q from mu (q^2 - 1) + lambda ln(s q^2) = 0', value: null}, tolerance: relative(1e-9),
    measure: async () => { const r = await neoHookean(); return {value: r.lateral, reference: r.lateralExact}; }},
  {id: 'solid.thermal.free-expansion', title: 'Thermal eigenstrain: free expansion', quantity: 'end displacement of a free 0.5 m steel block heated by 80 K', unit: 'm', test: T.thermal,
    reference: {formula: 'u = alpha dT L', value: THERMAL.alpha * THERMAL.rise * 0.5}, tolerance: relative(1e-10), measure: async () => (await thermal()).growth},
  {id: 'solid.thermal.restrained-stress', title: 'Thermal eigenstrain: restrained bar', quantity: 'axial stress of the bar held at both ends and heated by 80 K (linear model)', unit: 'Pa', test: T.thermal,
    reference: {formula: 'sigma = -E alpha dT', value: -200e9 * THERMAL.alpha * THERMAL.rise}, tolerance: relative(1e-10), measure: async () => (await thermal()).stress},
  ...PLASTIC_CASES,
]);

// Viscoelasticity (config.viscoelastic): a Prony branch on the elastic stress, E(t) = E (1 + gamma exp(-t / tau)).
const VFILE = 'tests/engine/solid-viscoelastic.test.mjs';
const VT = {
  relaxation: 'relaxation: a strain held from the first step relaxes by the discrete Prony recursion, which approaches E (1 + gamma exp(-t / tau))',
  creep: 'creep and recovery of a bar under constant stress follow the standard linear solid, retardation time tau (1 + gamma)',
  contact: 'through SolidContact: a viscoelastic cube resting on a plane creeps under its weight to the elastic settlement',
};
const VE = {E: 2e6, gamma: 1.5, tau: 2, L: 0.1};
async function veBar(dt, density = 1) {
  const {SolidBody, boxMesh} = await solid();
  return new SolidBody({mesh: boxMesh({size: [VE.L, 0.02, 0.02], cells: [4, 1, 1]}), material: {youngModulus: VE.E, poissonRatio: 0, density},
    config: {model: 'linear', dt, massDamping: 0, tolerance: 1e-12, viscoelastic: {branches: [{ratio: VE.gamma, time: VE.tau}]}}});
}
const veAxial = b => { const s = b.stresses(); let m = 0; for (let e = 0; e < b.tetCount; e++) m += s[6 * e]; return m / b.tetCount; };
const veRelax = () => memo('solid/ve-relax', async () => {
  const dt = VE.tau / 200, b = await veBar(dt), eps = 0.01, a = Math.exp(-dt / VE.tau), beta = (1 - a) / (dt / VE.tau); let worst = 0, atTau = 0;
  for (let n = 0; n < b.nodeCount; n++) b.constrain([n], [eps * b.referencePositions[3 * n], 0, 0]);
  for (let n = 1; n <= 600; n++) { b.step(); const s = veAxial(b); worst = Math.max(worst, Math.abs(s / (VE.E * eps * (1 + VE.gamma * beta * a ** (n - 1))) - 1)); if (n === 200) atTau = s; }
  return {worst, atTau, eps};
});
const veCreep = dt => memo(`solid/ve-creep/${dt}`, async () => {
  const b = await veBar(dt, 1e-3), sigma = 5e4, end = b.selectFaces((cx, cy, cz, nx) => nx > 0.999), tip = b.selectNodes(x => x > VE.L - 1e-9);
  b.constrain(b.selectNodes(x => x < 1e-9), [0, null, null]); b.constrain(b.selectNodes((x, y) => y < 1e-9), [null, 0, null]); b.constrain(b.selectNodes((x, y, z) => z < 1e-9), [null, null, 0]);
  b.addTraction(end, [sigma, 0, 0]);
  const strain = () => { let s = 0; for (const n of tip) s += b.displacements[3 * n]; return s / tip.length / VE.L; };
  const tauC = VE.tau * (1 + VE.gamma), steps = t => Math.round(t / dt); let atTauC = 0;
  for (let n = 1; n <= steps(3 * tauC); n++) { b.step(); if (n === steps(tauC)) atTauC = strain(); }
  b.addTraction(end, [-sigma, 0, 0]); b.step(steps(tauC));
  const e0 = sigma / (VE.E * (1 + VE.gamma)), einf = sigma / VE.E, creepAt = t => einf - (einf - e0) * Math.exp(-t / tauC);
  return {atTauC, recovered: strain(), expected: creepAt(tauC), recoveredExpected: (creepAt(3 * tauC) - e0) * Math.exp(-1)};
});
const veContact = () => memo('solid/ve-contact', async () => {
  const {SolidBody, boxMesh} = await solid(), {SolidContact} = await engine('solid-contact');
  const size = 0.1, rho = 1000, Einf = 2e4, tau = 0.5, dt = 1 / 100;
  const cube = new SolidBody({mesh: boxMesh({size: [size, size, size], cells: [2, 2, 2]}), material: {youngModulus: Einf, poissonRatio: 0, density: rho},
    config: {model: 'linear', dt, massDamping: 20, gravity: [0, -9.81, 0], tolerance: 1e-10, viscoelastic: {branches: [{ratio: 3, time: tau}]}}});
  const contact = new SolidContact(cube, {gravity: [0, -9.81, 0]});
  contact.addBody({shape: {kind: 'plane', normal: [0, 1, 0]}, type: 'static', position: [0, 0, 0], rotation: [0, 0, 0, 1]});
  const top = cube.selectNodes((x, y) => y > size - 1e-9); contact.step(5 + Math.round(16 * tau / dt));
  let s = 0; for (const n of top) s += cube.displacements[3 * n + 1];
  return {settlement: -s / top.length, elastic: rho * 9.81 * size * size / (2 * Einf)};
});
export const viscoelastic = defineCases('solid', VFILE, [
  {id: 'solid.viscoelastic.recursion', title: 'Viscoelastic relaxation: the stress history', quantity: 'largest relative difference over 600 steps between the stress of a held strain and the discrete Prony recursion E eps (1 + gamma b a^(n-1))', unit: '1', test: VT.relaxation,
    reference: {formula: 'a = exp(-dt / tau), b = (1 - a) / (dt / tau)', value: 0}, tolerance: absolute(1e-9), measure: async () => (await veRelax()).worst},
  {id: 'solid.viscoelastic.relaxation', title: 'Viscoelastic relaxation at t = tau', quantity: 'axial stress of a bar held at 1 % strain from t = 0, dt = tau / 200', unit: 'Pa', test: VT.relaxation,
    reference: {formula: 'sigma = E eps (1 + gamma exp(-t / tau))', value: VE.E * 0.01 * (1 + VE.gamma * Math.exp(-1))}, tolerance: relative(0.01),
    note: 'The recursion takes the strain as rising linearly over the first step, so a step load reads O(dt / tau) high.', measure: async () => (await veRelax()).atTau},
  {id: 'solid.viscoelastic.creep', title: 'Creep of a standard linear solid at t = tau (1 + gamma)', quantity: 'strain of a bar under a constant 50 kPa traction, dt = tau / 200', unit: '1', test: VT.creep,
    reference: {formula: 'eps = sigma / E - (sigma / E - sigma / E0) exp(-t / tau_c), E0 = E (1 + gamma), tau_c = tau (1 + gamma)', value: null}, tolerance: relative(0.01),
    measure: async () => { const r = await veCreep(VE.tau / 200); return {value: r.atTauC, reference: r.expected}; }},
  {id: 'solid.viscoelastic.creep-order', title: 'Creep: observed order in the time step', quantity: 'order of the creep error at tau_c from dt = tau / 100 to tau / 200', unit: '1', test: VT.creep,
    reference: {formula: 'backward Euler: 1', value: 1}, tolerance: absolute(0.2),
    measure: async () => { const c = await veCreep(VE.tau / 100), f = await veCreep(VE.tau / 200); return Math.log2((c.atTauC / c.expected - 1) / (f.atTauC / f.expected - 1)); }},
  {id: 'solid.viscoelastic.recovery', title: 'Recovery after unloading', quantity: 'strain tau_c after the 50 kPa traction is removed at 3 tau_c', unit: '1', test: VT.creep,
    reference: {formula: 'eps = (eps(t1) - sigma / E0) exp(-(t - t1) / tau_c)', value: null}, tolerance: relative(0.01),
    measure: async () => { const r = await veCreep(VE.tau / 200); return {value: r.recovered, reference: r.recoveredExpected}; }},
  {id: 'solid.viscoelastic.contact', title: 'Viscoelastic cube on a plane through SolidContact', quantity: 'settlement of the top face after 16 tau under its own weight (E = 20 kPa long-term, 4x instantaneous)', unit: 'm', test: VT.contact,
    reference: {formula: 'rho g L^2 / (2 E) (fully relaxed)', value: 1000 * 9.81 * 0.01 / (2 * 2e4)}, tolerance: relative(0.03),
    note: 'Lumped weights on 2 cells; the contact springs sink the base by a small extra depth.', measure: async () => (await veContact()).settlement},
  {id: 'solid.bonded-compression', file: 'tests/studio/rubber-si.test.mjs', title: 'Bonded rubber cylinder of the Studio elastomer lab, small strain', quantity: 'apparent compression modulus of the lab\'s 625-element cylinder (R 0.58 m, H 0.86 m, nu 0.49, tet4-nodal) between bonded platens at 1 % strain', unit: 'Pa', test: 'bonded compression at small strain: the lab mesh against the bonded-block closed form and the converged 3-D solution, tet4-nodal and tet4',
    reference: {formula: '1 / E_c = 1 / (E (1 + 2 S^2)) + 1 / K, S = R / (2 H), K = E / (3 (1 - 2 nu)) (Gent and Lindley, as quoted in Koblar et al. 2014, Eq. 2)', value: null}, tolerance: relative(0.35),
    note: 'tet4-nodal (the lab\'s element) 29 % above the closed form, tet4 52 %. The closed form assumes parabolic bulging: for this tall specimen (S = 0.34) the converged 3-D solution is 1.12 times it (Richardson from 16 and 24 cells across with both elements), so the lab mesh is 15 % too stiff with tet4-nodal and 35 % with tet4.',
    measure: async () => {
      const {SolidBody} = await solid(), {cylinderMesh, RUBBER_BASE} = await import(new URL('../../src/studio/material-labs/rubber-si.ts', import.meta.url).href);
      const R = 0.58, H = 0.86, E = 1.5e6, nu = 0.49, S = R / (2 * H), K = E / (3 * (1 - 2 * nu));
      const b = new SolidBody({mesh: cylinderMesh(R, H, 5, 5), material: {youngModulus: E, poissonRatio: nu, density: 1000}, config: {model: 'linear', tolerance: 1e-9, element: 'tet4-nodal', linearSolver: 'ldl'}});
      b.constrain(b.selectNodes((x, y) => y < RUBBER_BASE + 1e-9)); const top = b.selectNodes((x, y) => y > RUBBER_BASE + H - 1e-9); b.constrain(top, [0, -0.01 * H, 0]);
      const r = b.solveStatic(); let F = 0; for (const n of top) F += r.reactions[3 * n + 1];
      return {value: -F / (Math.PI * R * R) / 0.01, reference: 1 / (1 / (E * (1 + 2 * S * S)) + 1 / K)};
    }},
  {id: 'solid.nodal.patch', file: 'tests/engine/solid-nodal.test.mjs', title: 'Averaged nodal pressure element: near-incompressible patch test', quantity: 'largest displacement error over the largest displacement, uniform strain on an irregular 3 x 3 x 3 mesh, nu = 0.4999, green-lagrange model, tet4-nodal', unit: '1',
    test: 'near-incompressible patch test (nu = 0.4999): a uniform strain is reproduced on an irregular mesh by every model of tet4-nodal',
    reference: {formula: 'u = A X (a linear field is in the element space)', value: 0}, tolerance: absolute(1e-8),
    measure: async () => {
      const {SolidBody, boxMesh, boxNode} = await solid(), A = [1.0e-3, 2.0e-4, -3.0e-4, 4.0e-4, -2.0e-3, 5.0e-4, -1.0e-4, 3.0e-4, 1.5e-3], size = [1.2, 0.9, 0.7], cells = [3, 3, 3];
      const body = new SolidBody({mesh: jitter(boxNode, boxMesh({size, cells}), cells, size), material: {...steel, poissonRatio: 0.4999}, config: {model: 'green-lagrange', element: 'tet4-nodal', linearSolver: 'ldl', tolerance: 1e-13}}), X = body.referencePositions;
      const field = n => [0, 1, 2].map(i => A[3 * i] * X[3 * n] + A[3 * i + 1] * X[3 * n + 1] + A[3 * i + 2] * X[3 * n + 2]);
      for (const n of body.selectNodes((x, y, z) => near(x, 0) || near(x, size[0]) || near(y, 0) || near(y, size[1]) || near(z, 0) || near(z, size[2]))) body.constrain([n], field(n));
      const r = body.solveStatic(); let error = 0, scale = 0;
      for (let n = 0; n < body.nodeCount; n++) { const f = field(n); for (let i = 0; i < 3; i++) { error = Math.max(error, Math.abs(r.displacements[3 * n + i] - f[i])); scale = Math.max(scale, Math.abs(f[i])); } }
      return error / scale;
    }},
  {id: 'solid.nodal.cook', file: 'tests/engine/solid-nodal.test.mjs', title: "Cook's membrane, nearly incompressible, tet4-nodal", quantity: 'vertical displacement of the corner (48, 60), 32 x 32 cells in plane strain, E = 250, nu = 0.4999, shear 6.25 per unit length', unit: '1',
    test: "Cook's membrane, nearly incompressible: the tip deflection converges to the reference 7.769 (Sukumar et al. 2023)",
    reference: {formula: 'reference solution 7.769 (Sukumar et al., arXiv:2304.04941, Cook\'s membrane section)', value: 7.769}, tolerance: relative(0.05),
    note: 'Converges from below: 0.54, 0.78, 0.91, 0.96 of the reference at 4, 8, 16, 32 cells (tet4: 0.42, 0.57, 0.78, 0.90). Linear tetrahedra stay stiff in bending.',
    measure: async () => {
      const {SolidBody, boxMesh} = await solid(), n = 32, mesh = boxMesh({size: [1, 1, 48 / n], cells: [n, n, 1]}), p = mesh.positions;
      for (let i = 0; i < p.length; i += 3) { const s = p[i], t = p[i + 1]; p[i] = 48 * s; p[i + 1] = 44 * s + t * (44 + 16 * s - 44 * s); }
      const b = new SolidBody({mesh, material: {youngModulus: 250, poissonRatio: 0.4999, density: 1}, config: {model: 'linear', element: 'tet4-nodal', linearSolver: 'ldl', tolerance: 1e-11}});
      b.constrain(b.selectNodes(x => x < 1e-9)); b.constrain(b.selectNodes(() => true), [null, null, 0]); b.addTraction(b.selectFaces((cx, cy, cz, nx) => nx > 0.99), [0, 6.25, 0]);
      const r = b.solveStatic(), tip = b.selectNodes((x, y) => near(x, 48) && near(y, 60)); let v = 0; for (const k of tip) v += r.displacements[3 * k + 1] / tip.length; return v;
    }},
  {id: 'solid.nodal.plastic-bending', file: 'tests/engine/solid-nodal.test.mjs', title: 'Plane-strain fully plastic bending, tet4-nodal, 4 cells through the depth', quantity: 'end moment at 16 k_y over the elastic-perfectly-plastic closed form, minus 1', unit: '1',
    test: 'plastic incompressibility: plane-strain pure bending at 16 k_y with tet4-nodal against tet4',
    reference: {formula: "M = M_p' (1 - (k_y / k)^2 / 3), M_p' = (2 / sqrt 3) sigma_y h^2 / 4", value: 0}, tolerance: upper(0.055),
    note: 'tet4-nodal 4.8 % (8 cells 1.3 %), tet4 6.8 % (2.0 %): the plastic-incompressibility part is removed; the bending error of linear tetrahedra remains.',
    measure: async () => {
      const {SolidBody, boxMesh} = await solid(), E = 200e9, NU = 0.3, SY = 250e6, h = 0.01, L = 0.02, ny = 4, dz = h / ny;
      const b = new SolidBody({mesh: boxMesh({size: [L, h, dz], cells: [2 * ny, ny, 1]}), material: {youngModulus: E, poissonRatio: NU, density: 7850, yieldStress: SY}, config: {model: 'linear', element: 'tet4-nodal', linearSolver: 'ldl', maxNewtonIterations: 200}});
      b.constrain(b.selectNodes(x => near(x, 0)), [0, null, null]); b.constrain(b.selectNodes(() => true), [null, null, 0]); b.constrain(b.selectNodes((x, y) => near(x, 0) && near(y, h / 2)), [0, 0, null]);
      const end = b.selectNodes(x => near(x, L)), X = b.referencePositions, sy = 2 / Math.sqrt(3) * SY, ky = 2 * sy / (E / (1 - NU * NU) * h); let M = 0;
      for (let s = 1; s <= 8; s++) { const k = 16 * ky * s / 8; for (const n of end) b.constrain([n], [-k * L * (X[3 * n + 1] - h / 2), null, null]); const r = b.solveStatic(); M = 0; for (const n of end) M -= r.reactions[3 * n] * (X[3 * n + 1] - h / 2); }
      return M / dz / (sy * h * h / 4 * (1 - 1 / (3 * 256))) - 1;
    }},
]);
