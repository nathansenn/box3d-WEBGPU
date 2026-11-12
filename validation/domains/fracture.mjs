// Fracture of deformable solids (src/engine/solid-fracture.ts) against closed-form fracture mechanics.
// The scenarios are exported so that tests/engine/solid-fracture.test.mjs asserts on the same runs the
// report prints. SI units. The material is concrete-like unless stated: E = 30 GPa, nu = 0.2,
// sigma_c = 3 MPa, G_c = 100 J/m^2, so l_ch = E G_c / sigma_c^2 = 0.333 m and delta_c = 66.7 um.
import {engine, memo, defineCases, relative, absolute, upper, lower} from '../lib.mjs';

const FILE = 'tests/engine/solid-fracture.test.mjs';
const T = {
  bar: 'uniaxial bar with a weak interface: peak sigma_c A, linear softening, G_c A dissipated, damaged secant, zero traction when broken',
  objective: 'mesh objectivity: a through-crack dissipates G_c A on three meshes; the crack band needs its regularisation for that',
  energy: 'energy balance: external work = strain + interface + kinetic + dissipated energy, quasi-static and dynamic',
  griffith: 'Griffith: a centre-cracked plate fails at K_Ic / (Y sqrt(pi a)) with K_Ic = sqrt(E G_c), within the stated band',
  beam: 'notched three-point bending: peak load against LEFM and the size-effect law, and the work of fracture against G_c times the ligament',
  momentum: 'mass and momentum: node splitting and the fragment hand-off conserve them; a bar broken in free flight keeps its momentum',
  thermal: 'thermal shock: the heat solver cracks the quenched plate at its cooled face when the heat module says the surface stress reaches the strength',
  path: 'crack paths follow element faces: the area and energy of a crack inclined to the mesh depend on the mesh',
};

export const CONCRETE = {youngModulus: 30e9, poissonRatio: 0.2, density: 2400};
export const SIGMA_C = 3e6, G_C = 100, L_CH = CONCRETE.youngModulus * G_C / SIGMA_C ** 2, DELTA_C = 2 * G_C / SIGMA_C;
/** Effective length of the fracture process zone of a linear softening law, c_f = 0.419 l_ch (Planas and Elices, as
 * quoted by Bazant and Planas, "Fracture and Size Effect in Concrete and Other Quasibrittle Materials", 1998). */
export const C_F = 0.419 * L_CH;
const near = (a, b, tolerance = 1e-9) => Math.abs(a - b) < tolerance;
const fracture = () => engine('solid-fracture');
const sum = (values, nodes, component) => { let s = 0; for (const n of nodes) s += values[3 * n + component]; return s; };

/** Planes from `from` to `to`, the first cell `first` wide and each next one `ratio` times wider. */
function geometric(from, to, first, ratio) {
  const out = [], sign = Math.sign(to - from); let x = from, h = first;
  while (Math.abs(to - x) > 1.5 * h) { x += sign * h; out.push(x); h *= ratio; }
  out.push(to); return out;
}

// ---- Uniaxial bar ------------------------------------------------------------------------------------------------

export const BAR = {length: 0.2, width: 0.05};
/** A bar on symmetry planes, pulled at x = L by a prescribed displacement. */
export async function barBody(cells, law, config = {}, material = CONCRETE) {
  const {FractureBody, boxMesh} = {...await fracture(), ...await engine('solid')};
  const body = new FractureBody({mesh: boxMesh({size: [BAR.length, BAR.width, BAR.width], cells}), material, fracture: law, config: {tolerance: 1e-11, ...config}});
  body.constrain(body.selectNodes(x => near(x, 0)), [0, null, null]);
  body.constrain(body.selectNodes((x, y) => near(y, 0)), [null, 0, null]);
  body.constrain(body.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]);
  const end = () => body.selectNodes(x => near(x, BAR.length));
  const pull = U => { body.constrain(end(), [U, null, null]); const result = body.solveStatic(); return {...result, force: sum(result.reactions, end(), 0)}; };
  return {body, pull, area: BAR.width ** 2};
}
/** The cohesive bar: every face is strong (2 sigma_c) except the cross-section at mid-length (sigma_c).
 * `insertion: 'manual'` puts the interface there before loading; 'on-demand' lets the solver insert it.
 * Returns the load path: 10 equal steps to the peak, then `steps` to just past full separation. */
export async function cohesiveBar({cells = [4, 1, 1], insertion = 'on-demand', steps = 30, ratio = 0.02} = {}) {
  const {body, pull, area} = await barBody(cells, {model: 'cohesive', strength: 2 * SIGMA_C, toughness: G_C, insertion, initialOpeningRatio: ratio});
  const weak = body.selectInteriorFaces((cx, cy, cz, nx) => near(cx, BAR.length / 2) && Math.abs(nx) > 0.999);
  body.setInterfaceProperties(weak, {strength: SIGMA_C});
  if (insertion === 'manual') body.insertCohesive(weak);
  const d0 = ratio * DELTA_C, E = CONCRETE.youngModulus, peakAt = SIGMA_C * BAR.length / E + d0, endAt = 1.05 * DELTA_C, rows = [];
  let worstBalance = 0, worstLaw = 0, lowestDamage = 0, irreversible = true;
  const record = U => {
    const r = pull(U), state = body.interfaces.length ? body.interfaceState(weak[0]) : null, opening = state ? state.normal[0] : 0, e = body.energy();
    // The traction the law gives for the measured opening (which is the largest so far on this monotonic path).
    const law = !state ? null : opening <= d0 ? SIGMA_C * opening / d0 : opening < DELTA_C ? SIGMA_C * (DELTA_C - opening) / (DELTA_C - d0) : 0;
    if (law !== null) worstLaw = Math.max(worstLaw, Math.abs(r.force / area - law) / SIGMA_C);
    worstBalance = Math.max(worstBalance, Math.abs(e.balance) / (G_C * area));
    if (state) { if (state.damage[0] < lowestDamage - 1e-15) irreversible = false; lowestDamage = Math.max(lowestDamage, state.damage[0]); }
    const row = {U, stress: r.force / area, opening, damage: state ? state.damage[0] : 0, converged: r.converged, energy: e};
    rows.push(row); return row;
  };
  for (let i = 1; i <= 10; i++) record(peakAt * i / 10);
  for (let i = 1; i <= steps; i++) record(peakAt + (endAt - peakAt) * i / steps);
  const e = body.energy();
  return {body, pull, record, weak, area, rows, peakAt, d0, peak: Math.max(...rows.map(row => row.stress)), worstLaw, worstBalance, irreversible,
    dissipated: e.dissipated, work: e.externalWork, relaxation: e.relaxation, fragments: body.fragments().length, finalStress: rows.at(-1).stress};
}
/** The crack-band bar: one layer of cells at mid-length has strength sigma_c, the rest 2 sigma_c. Poisson's ratio 0
 * unless given, so the layer is in uniaxial stress. Without regularisation the failure strain is that of a 25 mm band
 * (the bar then softens without snap-back on all three meshes). */
export async function crackBandBar({nx = 4, regularisation = 'crack-band', poissonRatio = 0, steps = 40} = {}) {
  const L = BAR.length, h = L / nx, E = CONCRETE.youngModulus, fixed = 2 * G_C / (SIGMA_C * L / 8);
  const {body, pull, area} = await barBody([nx, 1, 1], {model: 'crack-band', strength: 2 * SIGMA_C, toughness: G_C, regularisation, ...(regularisation === 'none' ? {failureStrain: fixed} : {})}, {}, {...CONCRETE, poissonRatio});
  const start = Math.floor(nx / 2) * h;
  body.setElementProperties(body.selectElements(cx => cx > start && cx < start + h), {strength: SIGMA_C});
  const end = regularisation === 'none' ? fixed : 2 * G_C / (SIGMA_C * h), peakAt = SIGMA_C * L / E, endAt = 1.02 * end * h;
  let peak = 0, worstBalance = 0, monotone = true; const before = new Float64Array(body.tetCount);
  const record = U => {
    const r = pull(U); peak = Math.max(peak, r.force / area);
    worstBalance = Math.max(worstBalance, Math.abs(body.energy().balance) / (G_C * area));
    for (let e = 0; e < body.tetCount; e++) { if (body.elementDamage[e] < before[e]) monotone = false; before[e] = body.elementDamage[e]; }
    return r;
  };
  for (let i = 1; i <= 5; i++) record(peakAt * i / 5);
  for (let i = 1; i <= steps; i++) record(peakAt + (endAt - peakAt) * i / steps);
  const e = body.energy(), last = record(endAt * 1.01);
  return {body, area, h, peak, work: e.externalWork, dissipated: e.dissipated, worstBalance, monotone, finalStress: last.force / area,
    failed: body.takeEvents().filter(event => event.kind === 'element-failed').length, layer: body.selectElements(cx => cx > start && cx < start + h).length};
}

// ---- Griffith plate ----------------------------------------------------------------------------------------------

/** A centre-cracked plate, half of it (x >= 0) on a symmetry plane: crack half-length a, half-width b = 4 a,
 * half-height 2 b, thin (two cells of size h), under a remote tension applied as a traction on both ends.
 * The crack plane y = 0 is a mesh plane: the crack is cut for x < a and the ligament carries cohesive
 * interfaces. The mesh has cells of size h = `cell` l_ch from `back` cells behind the tip to `ahead` cells in
 * front of it and three rows on each side of the plane, and grows geometrically away from there. */
export async function griffithPlate({cell = 0.5, a = 5, grading = 1.5, back = 6, ahead = 10, rows = 3, insertion = 'manual', threshold = 1, tip, material = CONCRETE, strength = SIGMA_C, toughness = G_C} = {}) {
  const {FractureBody, gradedBoxMesh} = await fracture();
  // Lengths scale with l_ch = E G_c / sigma_c^2 of the material (the concrete-like default unless given).
  const E = material.youngModulus, lch = E * toughness / strength ** 2, cf = 0.419 * lch;
  const half = a * lch, b = 4 * half, H = 2 * b, h = cell * lch, t = 2 * h, behind = Math.min(back, Math.round(a / cell) - 1), lo = half - behind * h, hi = half + ahead * h;
  const xs = geometric(lo, 0, h, grading).reverse(); for (let i = 0; i < behind + ahead; i++) xs.push(lo + i * h); xs.push(hi, ...geometric(hi, b, h, grading));
  const up = [0]; for (let i = 1; i <= rows; i++) up.push(i * h); up.push(...geometric(up.at(-1), H, h * grading, grading));
  const body = new FractureBody({mesh: gradedBoxMesh({x: xs, y: [...up.slice(1).map(v => -v).reverse(), ...up], z: [0, t]}), material,
    fracture: {model: 'cohesive', strength, toughness, insertion, insertionThreshold: threshold, ...(tip === undefined ? {} : {tipInsertionThreshold: tip})}, config: {tolerance: 1e-9, maxNewtonIterations: 12, maxLinearIterations: 5000}});
  const plane = [...body.selectInteriorFaces((cx, cy, cz, nx, ny) => near(cy, 0) && Math.abs(ny) > 0.999)];
  body.precrack(plane.filter(f => body.interiorFace(f).centroid[0] < half));
  if (insertion === 'manual') body.insertCohesive(plane.filter(f => body.interiorFace(f).centroid[0] > half));
  body.constrain(body.selectNodes(x => near(x, 0)), [0, null, null]);
  body.constrain(body.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]);
  const top = body.selectFaces((cx, cy, cz, nx, ny) => ny > 0.999), bottom = body.selectFaces((cx, cy, cz, nx, ny) => ny < -0.999);
  // Y: Feddersen's secant formula for a centre crack in a strip of finite width.
  const Y = w => Math.sqrt(1 / Math.cos(Math.PI * w / (2 * b))), K = Math.sqrt(E * toughness);
  return {body, top, bottom, a: half, b, H, h, t, Y: Y(half), lefm: K / (Y(half) * Math.sqrt(Math.PI * half)), cf, lch,
    effective: K / (Y(half + cf) * Math.sqrt(Math.PI * (half + cf))), ligament: (b - half) * t, fineAhead: ahead * h * t};
}
/** Raises the remote stress from 0.9 of the LEFM estimate in steps of `step` of it until the crack runs: the solve
 * does not converge, or the crack has run out of the refined zone. Returns the last stable and the first unstable stress. */
export async function griffithStrength(options = {}, {start = 0.9, step = 0.01, limit = 1.7} = {}) {
  const plate = await griffithPlate(options), {body, top, bottom, lefm} = plate;
  let applied = 0, stable = 0, unstable = 0, openBefore = 0, solves = 0;
  for (let k = start; k < limit + 1e-12; k += step) {
    const stress = k * lefm; body.clearSurfaceLoads(); body.addTraction(top, [0, stress, 0]); body.addTraction(bottom, [0, -stress, 0]);
    const result = body.solveStatic({predictor: applied > 0 ? stress / applied : 1}), area = body.crackArea(); solves++;
    if (!result.converged || area.open > plate.fineAhead) { unstable = k; break; }
    stable = k; applied = stress; openBefore = area.open;
  }
  return {...plate, stable, unstable, strength: unstable > 0 && stable > 0 ? 0.5 * (stable + unstable) * lefm : NaN, ratio: unstable > 0 && stable > 0 ? 0.5 * (stable + unstable) : NaN,
    step, growthBeforeFailure: openBefore / plate.t, solves, tets: body.tetCount, zoneCells: plate.cf / plate.h};
}

// ---- Notched three-point bending ---------------------------------------------------------------------------------

/** k(alpha) of K_I = P k / (t sqrt(D)) for three-point bending with span 4 D (Srawley's formula, ASTM E399). */
export const bendingShape = alpha => 4 * 3 * Math.sqrt(alpha) * (1.99 - alpha * (1 - alpha) * (2.15 - 3.93 * alpha + 2.7 * alpha * alpha)) / (2 * (1 + 2 * alpha) * (1 - alpha) ** 1.5);
/** A beam of depth D = `depth` l_ch, span 4 D and notch D / 2 on two supports, loaded at mid-span by a prescribed
 * deflection. `cells` cells through the depth; the mid-section carries cohesive interfaces above the notch. */
export async function notchedBeam({depth = 0.6, cells = 8, perElastic = 8, stop = 0.5, tail = 4, maxSteps = 400} = {}) {
  const {FractureBody, gradedBoxMesh} = await fracture();
  const E = CONCRETE.youngModulus, D = depth * L_CH, S = 4 * D, a0 = D / 2, h = D / cells, t = 2 * h;
  const half = [0, h, 2 * h, 3 * h, ...geometric(3 * h, S / 2, 1.4 * h, 1.4), S / 2 + D / 4];
  const body = new FractureBody({mesh: gradedBoxMesh({x: [...half.slice(1).map(v => -v).reverse(), ...half], y: Array.from({length: cells + 1}, (_, i) => i * h), z: [0, t]}), material: CONCRETE,
    fracture: {model: 'cohesive', strength: SIGMA_C, toughness: G_C, insertion: 'manual'}, config: {tolerance: 1e-9}});
  const plane = [...body.selectInteriorFaces((cx, cy, cz, nx) => near(cx, 0) && Math.abs(nx) > 0.999)];
  body.precrack(plane.filter(f => body.interiorFace(f).centroid[1] < a0)); body.insertCohesive(plane.filter(f => body.interiorFace(f).centroid[1] > a0));
  body.constrain(body.selectNodes((x, y) => near(x, -S / 2) && near(y, 0)), [0, 0, null]);
  body.constrain(body.selectNodes((x, y) => near(x, S / 2) && near(y, 0)), [null, 0, null]);
  body.constrain(body.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]);
  const loaded = body.selectNodes((x, y) => near(x, 0) && near(y, D)), ligament = (D - a0) * t, alpha = a0 / D, k = bendingShape(alpha), slope = (bendingShape(alpha + 1e-5) ** 2 - bendingShape(alpha - 1e-5) ** 2) / 2e-5;
  const lefm = Math.sqrt(E * G_C) * t * Math.sqrt(D) / k, sizeEffect = t * Math.sqrt(E * G_C * D) / Math.sqrt(k * k + slope * C_F / D);
  // Deflection steps: a fraction of the elastic deflection under the size-effect load; four times larger once the load has fallen for `tail` steps.
  const increment = 2 * sizeEffect * S ** 3 / (4 * E * t * D ** 3) / perElastic;
  let peak = 0, deflection = 0, falling = 0, steps = 0, worstBalance = 0, load = 0, unconverged = 0;
  for (; steps < maxSteps;) {
    deflection += increment * (falling > tail ? 4 : 1); body.constrain(loaded, [null, -deflection, null]);
    const result = body.solveStatic(); steps++; load = -sum(result.reactions, loaded, 1); if (!result.converged) unconverged++;
    if (load < peak) falling++; peak = Math.max(peak, load);
    worstBalance = Math.max(worstBalance, Math.abs(body.energy().balance) / (G_C * ligament));
    if (load < stop * peak) break;
  }
  const e = body.energy();
  return {body, D, h, t, ligament, peak, lefm, sizeEffect, work: e.externalWork, dissipated: e.dissipated, stored: e.strain + e.interface, worstBalance, steps, unconverged, finalLoad: load,
    hinge: 1 - h / (2 * (D - a0)), ligamentCells: (D - a0) / h};
}

// ---- Free flight -------------------------------------------------------------------------------------------------

/** A free bar whose halves fly apart: the x velocity changes sign over a quarter of the length around the
 * mid-section, which pulls the weak cross-section apart. A rigid translation is added, and with `spin` a rigid rotation. */
export async function freeFlight({integrator = 'explicit', stepShare = 0.8, spin = 0, cells = [8, 2, 2], duration = 1.2e-4} = {}) {
  const {FractureBody, boxMesh} = {...await fracture(), ...await engine('solid')};
  const L = BAR.length, w = BAR.width, law = {model: 'cohesive', strength: 10 * SIGMA_C, toughness: G_C, initialOpeningRatio: 0.1};
  const limit = new FractureBody({mesh: boxMesh({size: [L, w, w], cells}), material: CONCRETE, fracture: law, config: {dt: 1e-12}}).explicitLimit();
  const dt = (integrator === 'explicit' ? 1 : 20) * stepShare * limit;
  const body = new FractureBody({mesh: boxMesh({size: [L, w, w], cells}), material: CONCRETE, fracture: law, config: {integrator, dt, tolerance: 1e-12}});
  body.setInterfaceProperties(body.selectInteriorFaces((cx, cy, cz, nx) => near(cx, L / 2) && Math.abs(nx) > 0.999), {strength: SIGMA_C});
  const X = body.referencePositions, v = new Float64Array(3 * body.nodeCount), V = 1.2;
  for (let n = 0; n < body.nodeCount; n++) {
    const x = X[3 * n] - L / 2, y = X[3 * n + 1] - w / 2;
    v[3 * n] = V * Math.sign(x) * Math.min(1, Math.abs(x) / (L / 8)) + 0.3 - spin * y; v[3 * n + 1] = spin * x + 0.1; v[3 * n + 2] = -0.2;
  }
  body.setState(undefined, v);
  const before = body.momentum(), kinetic = body.kineticEnergy(), steps = Math.round(duration / dt), pScale = body.mass * V, lScale = body.mass * V * L, nodesBefore = body.nodeCount;
  let balance = 0, linear = 0, angular = 0; const distance = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  for (let i = 0; i < steps; i++) {
    body.step(); const m = body.momentum();
    balance = Math.max(balance, Math.abs(body.energy().balance) / kinetic); linear = Math.max(linear, distance(m.linear, before.linear) / pScale); angular = Math.max(angular, distance(m.angular, before.angular) / lScale);
  }
  let nodal = 0; for (const m of body.nodalMass) nodal += m;
  return {body, dt, limit, steps, balance, linear, angular, before, pScale, nodesBefore, nodalMassError: Math.abs(nodal / body.mass - 1), dissipated: body.energy().dissipated, area: w * w, fragments: body.fragments(), events: body.takeEvents()};
}

// ---- Crack path --------------------------------------------------------------------------------------------------

/** A strip in tension whose weak faces lie in a band around a plane inclined by `degrees` to the cross-section.
 * The solver inserts interfaces where they are needed, so the crack is the path the mesh offers inside the band. */
export async function inclinedCrack({nx = 8, pattern = 'alternating5', degrees = 30, steps = 60, tip} = {}) {
  const {FractureBody, boxMesh} = {...await fracture(), ...await engine('solid')};
  const L = 0.2, W = 0.1, h = L / nx, angle = degrees * Math.PI / 180, n = [Math.cos(angle), Math.sin(angle)], distance = (x, y) => (x - L / 2) * n[0] + (y - W / 2) * n[1];
  const body = new FractureBody({mesh: boxMesh({size: [L, W, h], cells: [nx, nx / 2, 1], pattern}), material: CONCRETE, fracture: {model: 'cohesive', strength: 20 * SIGMA_C, toughness: G_C, ...(tip === undefined ? {} : {tipInsertionThreshold: tip})}, config: {tolerance: 1e-9, maxNewtonIterations: 200}});
  body.setInterfaceProperties(body.selectInteriorFaces((cx, cy) => Math.abs(distance(cx, cy)) < 0.75 * h), {strength: SIGMA_C});
  body.constrain(body.selectNodes(x => near(x, 0)), [0, null, null]);
  body.constrain(body.selectNodes((x, y) => near(x, 0) && near(y, 0)), [0, 0, null]);
  body.constrain(body.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]);
  const end = body.selectNodes(x => near(x, L)), section = W * h, ideal = section / Math.cos(angle); let peak = 0, unconverged = 0;
  for (let i = 1; i <= steps && body.fragments().length === 1; i++) {
    body.constrain(end, [(SIGMA_C * L / CONCRETE.youngModulus + 2.5 * DELTA_C) * i / steps, null, null]);
    const result = body.solveStatic(); if (!result.converged) unconverged++; peak = Math.max(peak, sum(result.reactions, end, 0));
  }
  let moment = 0, open = 0; const faces = [];
  for (const f of body.interfaces) { const face = body.interiorFace(f); if (face.state !== 'open') continue; faces.push(f); open += face.area; moment += face.area * distance(face.centroid[0], face.centroid[1]) ** 2; }
  return {body, h, ideal, section, peak: peak / (SIGMA_C * section), areaRatio: open / ideal, energyRatio: body.energy().dissipated / (G_C * ideal), roughness: Math.sqrt(moment / open) / h, fragments: body.fragments().length, unconverged, faces};
}

// ---- Thermal shock -----------------------------------------------------------------------------------------------

/** The quenched plate of `quenchedPlate()` in a Simulation with a stand-in rigid world: heat solver, the thermal link
 * and the fracturing solid. Steps until the first crack event. */
export async function quench(options = {}) {
  const {quenchedPlate, fractureSubsystem} = await fracture(), {Simulation, heatSubsystem, thermalSolidLink} = await engine('simulation'), {thermalShock} = await engine('heat');
  const plate = quenchedPlate(options), {heat, body} = plate, world = {loop: {step: heat.dt}, step() {}, gravity: () => [0, 0, 0], getState: () => null};
  const sim = new Simulation(world).add(heatSubsystem(heat)).add(thermalSolidLink(heat, body, {reference: plate.reference})).add(fractureSubsystem(body)), events = [];
  sim.onEvent(event => events.push(event));
  let estimate = null, surfaceAtEstimate = NaN;
  for (let i = 0; i < 600 && events.length === 0; i++) {
    sim.step();
    if (estimate === null && thermalShock(heat.temperature, plate.shock).count > 0) { estimate = sim.time; surfaceAtEstimate = heat.temperature[0]; }
  }
  const first = events[0], depths = events.map(event => body.interiorFace(event.data.face).centroid[0] / plate.cellSize);
  return {plate, sim, events, estimate, onset: first ? first.data.time : NaN, tick: first ? first.tick : -1, depths, modes: [...new Set(events.map(event => event.data.mode))], surfaceAtEstimate, order: sim.order().map(row => row.id)};
}

// ---- The report's rows -------------------------------------------------------------------------------------------

const bar = () => memo('fracture/bar', () => cohesiveBar({cells: [8, 2, 2], insertion: 'manual'}));
const barOnDemand = () => memo('fracture/bar-on-demand', () => cohesiveBar({cells: [8, 2, 2]}));
const band = (nx, regularisation) => memo(`fracture/band/${nx}/${regularisation}`, () => crackBandBar({nx, regularisation}));
const plate = cell => memo(`fracture/griffith/${cell}`, () => griffithStrength({cell}));
/** The same plate with nothing inserted beforehand: the solver finds the ligament. `tip` 1 turns the crack-front rule off. */
const plateOnDemand = (cell, tip) => memo(`fracture/griffith-on-demand/${cell}/${tip}`, () => griffithStrength({cell, insertion: 'on-demand', ...(tip === undefined ? {} : {tip})}, tip === 1 ? {limit: 1.3} : {}));
const beam = (depth, cells, stop) => memo(`fracture/beam/${depth}/${cells}/${stop}`, () => notchedBeam({depth, cells, stop}));
const flight = spin => memo(`fracture/flight/${spin}`, () => freeFlight({spin}));
const shock = () => memo('fracture/quench', () => quench());
const path = pattern => memo(`fracture/path/${pattern}`, () => inclinedCrack({pattern}));

export default defineCases('fracture', FILE, [
  {id: 'fracture.bar.peak', title: 'Cohesive bar: peak load', quantity: 'peak stress of a 0.2 m bar with a weak cross-section, cohesive interface, 8 x 2 x 2 cells', unit: 'Pa', test: T.bar,
    reference: {formula: 'sigma_c', value: SIGMA_C}, tolerance: relative(1e-9), measure: async () => (await bar()).peak, note: 'A load step lands on the peak, U = sigma_c L / E + delta_0; the stress is uniform, so only the solver tolerance remains.'},
  {id: 'fracture.bar.softening', title: 'Cohesive bar: softening law', quantity: 'largest difference between the bar stress and sigma_c (delta_c - delta) / (delta_c - delta_0) at the measured opening, over 40 load steps, divided by sigma_c', unit: '1', test: T.bar,
    reference: {formula: 'linear softening to delta_c = 2 G_c / sigma_c', value: 0}, tolerance: absolute(1e-8), measure: async () => (await bar()).worstLaw},
  {id: 'fracture.bar.energy', title: 'Cohesive bar: fracture energy', quantity: 'energy dissipated when the bar has separated', unit: 'J', test: T.bar,
    reference: {formula: 'G_c A', value: G_C * BAR.width ** 2}, tolerance: relative(1e-9), measure: async () => (await bar()).dissipated},
  {id: 'fracture.bar.work', title: 'Cohesive bar: work to break it', quantity: 'area under the load-displacement curve of the same bar', unit: 'J', test: T.bar,
    reference: {formula: 'G_c A', value: G_C * BAR.width ** 2}, tolerance: relative(1e-3), measure: async () => (await bar()).work, note: 'Trapezoid rule over the load steps; the error is in the two steps that hold a kink of the curve.'},
  {id: 'fracture.bar.insertion-loss', title: 'Cohesive bar: energy released when an interface is inserted under load', quantity: 'relaxation the ledger books when the solver inserts the interface of the same bar itself, divided by G_c A', unit: '1', test: T.objective,
    reference: {formula: 'T_before T_after / (2 K G_c) = (delta_0 / delta_c) (1 + E delta_0 / (sigma_c L))', value: 0.02 * (1 + CONCRETE.youngModulus * 0.02 * DELTA_C / (SIGMA_C * BAR.length))}, tolerance: relative(1e-6), measure: async () => (await barOnDemand()).relaxation / (G_C * BAR.width ** 2),
    note: 'An interface inserted at a loaded face adds its compliance at once. The work to break this bar is 2.1 % above G_c A for that reason; the dissipated energy is still G_c A.'},
  {id: 'fracture.band.regularised', title: 'Crack band: fracture energy with regularisation', quantity: 'work to break a bar with a weak layer of 12.5 mm cells, nu = 0', unit: 'J', test: T.objective,
    reference: {formula: 'G_c A', value: G_C * BAR.width ** 2}, tolerance: relative(0.01), measure: async () => (await band(16, 'crack-band')).work},
  {id: 'fracture.band.objectivity', title: 'Crack band: mesh objectivity', quantity: 'work to break the bar on 50 mm cells divided by that on 12.5 mm cells, with regularisation', unit: '1', test: T.objective,
    reference: {formula: 'W_coarse / W_fine = 1', value: 1}, tolerance: relative(0.01), measure: async () => (await band(4, 'crack-band')).work / (await band(16, 'crack-band')).work},
  {id: 'fracture.band.unregularised', title: 'Crack band without regularisation: mesh dependence', quantity: 'the same ratio with a fixed failure strain', unit: '1', test: T.objective,
    reference: {formula: 'h_coarse / h_fine = 4', value: 4}, tolerance: relative(0.02), measure: async () => (await band(4, 'none')).work / (await band(16, 'none')).work, note: 'Shown as a failure of the unregularised model: its dissipated energy is proportional to the element size.'},
  {id: 'fracture.griffith.coarse', title: 'Griffith: centre-cracked plate, cells of l_ch', quantity: 'remote stress at which a crack of half-length 5 l_ch runs, cells of l_ch at the tip', unit: 'Pa', test: T.griffith,
    reference: {formula: 'sqrt(E G_c) / (Y sqrt(pi a)), Y = sqrt(sec(pi a / (2 b)))', value: null}, tolerance: relative(0.15), measure: async () => { const r = await plate(1); return {value: r.strength, reference: r.lefm}; },
    note: 'Too coarse on purpose: 0.42 cells per process-zone length c_f. The plate reads 11.5 % strong. Load steps of 1 % of the reference.'},
  {id: 'fracture.griffith.fine', title: 'Griffith: centre-cracked plate, cells of l_ch / 2', quantity: 'the same with cells of l_ch / 2', unit: 'Pa', test: T.griffith,
    reference: {formula: 'sqrt(E G_c) / (Y sqrt(pi a))', value: null}, tolerance: relative(0.05), measure: async () => { const r = await plate(0.5); return {value: r.strength, reference: r.lefm}; },
    note: 'A cohesive crack of this size is weaker than LEFM because of its process zone: refined meshes converge to 0.955 of the reference (see the next row and docs/SOLID_FRACTURE.md).'},
  {id: 'fracture.griffith.effective-crack', title: 'Griffith with the process zone', quantity: 'the same against LEFM for the crack a + c_f, c_f = 0.419 l_ch', unit: 'Pa', test: T.griffith,
    reference: {formula: 'sqrt(E G_c) / (Y sqrt(pi (a + c_f)))', value: null}, tolerance: relative(0.03), measure: async () => { const r = await plate(0.5); return {value: r.strength, reference: r.effective}; }},
  {id: 'fracture.griffith.on-demand-fine', title: 'Griffith with on-demand insertion, cells of l_ch / 2', quantity: 'failure stress with no interface inserted beforehand (default thresholds), over that of the pre-inserted crack path, minus 1', unit: '1', test: T.griffith,
    reference: {formula: 'the same crack: 0', value: 0}, tolerance: absolute(0.011), measure: async () => (await plateOnDemand(0.5)).ratio / (await plate(0.5)).ratio - 1,
    note: 'One load step is 1 % of the reference. Faces that touch a crack front are inserted at 0.4 of their strength (tipInsertionThreshold); with that rule off the plate still holds 1.59 times its Griffith stress.'},
  {id: 'fracture.griffith.on-demand-coarse', title: 'Griffith with on-demand insertion, cells of l_ch', quantity: 'the same with cells of l_ch', unit: '1', test: T.griffith,
    reference: {formula: 'the same crack: 0', value: 0}, tolerance: absolute(0.011), measure: async () => (await plateOnDemand(1)).ratio / (await plate(1)).ratio - 1, note: 'Measured +0.9 %, one load step.'},
  {id: 'fracture.griffith.on-demand-off', title: 'Griffith with insertion at the strength only', quantity: 'largest stress held, over LEFM, with tipInsertionThreshold = 1 and cells of l_ch / 2; the load stops at 1.3', unit: '1', test: T.griffith,
    reference: {formula: 'the pre-inserted path fails at 0.965', value: 0.965}, tolerance: lower(0), measure: async () => (await plateOnDemand(0.5, 1)).stable,
    note: 'Shown as a failure of the plain rule, not as accuracy: the mean stress of two linear elements under-reads the peak at the tip, so no interface appears and the plate does not fail (1.59 when loaded further; on cells of l_ch not below 1.8).'},
  {id: 'fracture.beam.work', title: 'Notched beam: work of fracture', quantity: 'area under the load-deflection curve of a beam of depth 0.6 l_ch, 6 cells in the ligament', unit: 'J', test: T.beam,
    reference: {formula: 'G_c t (D - a0) (1 - h / (2 (D - a0)))', value: null}, tolerance: relative(0.01), measure: async () => { const r = await beam(0.6, 12, 0.002); return {value: r.work, reference: G_C * r.ligament * r.hinge}; },
    note: 'The node row under the load is the hinge and never opens, so half a cell of the ligament stays whole: 8.3 % of G_c times the ligament here, 12.5 % with 4 cells.'},
  {id: 'fracture.beam.peak', title: 'Notched beam: peak load', quantity: 'peak load of a beam of depth 2.4 l_ch, 8 cells through the depth', unit: 'N', test: T.beam,
    reference: {formula: 't sqrt(E G_c D) / sqrt(k^2 + (k^2)\' c_f / D), Bazant\'s size-effect law', value: null}, tolerance: relative(0.12), measure: async () => { const r = await beam(2.4, 8, 0.5); return {value: r.peak, reference: r.sizeEffect}; },
    note: 'The law is an asymptote for large beams: measured +9 % at 2.4 l_ch with 8 cells, +6 % with 12 cells and +1 % at 4.8 l_ch. The LEFM load is an upper bound (0.75 of it here).'},
  {id: 'fracture.flight.linear-momentum', title: 'Free flight: linear momentum', quantity: 'largest change of the linear momentum of a bar that breaks in flight, divided by m V', unit: '1', test: T.momentum,
    reference: {formula: 'no change: internal forces cancel in pairs', value: 0}, tolerance: absolute(1e-12), measure: async () => (await flight(0)).linear},
  {id: 'fracture.flight.angular-momentum', title: 'Free flight: angular momentum of a spinning bar', quantity: 'largest change of the angular momentum of the bar spinning at 40 rad/s, divided by m V L', unit: '1', test: T.momentum,
    reference: {formula: 'no change', value: 0}, tolerance: absolute(1e-3), measure: async () => (await flight(40)).angular, note: 'Small-strain elements: forces act along reference directions, so angular momentum is kept only to the order of the rotation times the strain.'},
  {id: 'fracture.flight.energy', title: 'Free flight: energy balance', quantity: 'largest energy imbalance of the explicit run at 0.8 of the stability limit, divided by the initial kinetic energy', unit: '1', test: T.energy,
    reference: {formula: 'work - (strain + interface + kinetic + dissipated) = 0', value: 0}, tolerance: absolute(5e-4), measure: async () => (await flight(0)).balance, note: 'Second order in the time step: 1.2e-4, 2.9e-5 and 8e-6 at 0.8, 0.4 and 0.2 of the limit.'},
  {id: 'fracture.thermal.onset', title: 'Thermal shock: time of the first crack', quantity: 'time at which the quenched plate first cracks', unit: 's', test: T.thermal,
    reference: {formula: 'time at which E alpha dT / (1 - nu) of the surface cell reaches sigma_c (heat module)', value: null}, tolerance: relative(0.05), measure: async () => { const r = await shock(); return {value: r.onset, reference: r.estimate}; },
    note: 'The solid reads element temperatures that average in the second cell layer, so it cracks a few steps later.'},
  {id: 'fracture.path.area', title: 'Crack path: a crack inclined 30 degrees to the mesh', quantity: 'crack area divided by the area of the inclined plane, five-tetrahedron cells', unit: '1', test: T.path,
    reference: {formula: 'area of the plane: ratio 1', value: 1}, tolerance: upper(0.3), measure: async () => (await path('alternating5')).areaRatio, note: 'Shown as a limit: the crack follows faces. It is 2.5 % larger than the plane on this mesh, 21 % with cells half the size and 30 % on six-tetrahedron cells, and the dissipated energy is 38 % to 54 % above G_c times the plane.'},
  {id: 'fracture.path.energy', title: 'Crack path: energy of the inclined crack', quantity: 'dissipated energy over G_c times the area of the inclined plane, five-tetrahedron cells', unit: '1', test: T.path,
    reference: {formula: 'G_c times the plane: ratio 1', value: 1}, tolerance: upper(0.6), measure: async () => (await path('alternating5')).energyRatio, note: 'Shown as a limit, measured +38 %: faces beside the path soften without opening. It does not fall with refinement (+49 % with cells half the size).'},
]);
