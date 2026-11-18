// Set-ups of the shallow-water validation, shared by test/v20-shallow-water.test.mjs (which asserts on them) and
// validation/domains/shallow-water.mjs (which reports them). Each function builds a problem with a known answer, runs the
// real solver and returns the measured numbers beside the reference. SI units.
// `K` is the kit: the exports of box3d-webgpu-kit/shallow-water plus {createWorld, createSimulation}.
// Nothing here measures wall-clock time.
//
// Sources of the references (opened; see docs/SHALLOW_WATER.md):
//  - SWASHES, Delestre et al. 2013 (arXiv:1110.0288): lake at rest with a bump (3.1.1, 3.1.2), the three flows over a
//    bump of Goutal and Maurel 1997 (3.1.3-3.1.5), Stoker's and Ritter's dam breaks (4.1.1, 4.1.2), Thacker's paraboloid (4.2.2).
//  - WEPP technical documentation, ch. 4 (USDA-ARS 1995), eqs. 4.4.1-4.4.10: the kinematic wave on a plane.
//  - Rawls, Brakensiek and Miller 1983, J. Hydraul. Eng. 109(1), eqs. 1-2 and Table 2: Green-Ampt.

export const G = 9.81;

/** 64-bit FNV-1a of float64 arrays, as hex. */
export function hashArrays(...arrays) {
  let a = 0xcbf29ce484222325n;
  for (const array of arrays) for (const b of new BigUint64Array(Float64Array.from(array).buffer)) a = BigInt.asUintN(64, (a ^ b) * 0x100000001b3n);
  return a.toString(16).padStart(16, '0');
}
const centre = (w, i, k = 0) => [w.origin[0] + (i + 0.5) * w.dx, w.origin[1] + (k + 0.5) * w.dz];

/** A lake at rest over a bumpy 2D bed, fully immersed or partly emerged: velocity and level change after `steps` steps. */
export function lakeAtRest(K, {level = 0.25, steps = 400, cells = [60, 40]} = {}) {
  const bed = (x, z) => 0.3 * Math.exp(-((x - 1.4) ** 2 + (z - 1) ** 2) / 0.2) + 0.12 * Math.sin(2.5 * x) * Math.cos(3 * z) + 0.04 * x;
  const w = new K.ShallowWater({cells, spacing: 0.05, bed, level, dt: 0.02});
  let dryCells = 0; for (let c = 0; c < w.cells; c++) if (w.h[c] === 0) dryCells++;
  for (let s = 0; s < steps; s++) w.step();
  let speed = 0, drift = 0;
  for (let c = 0; c < w.cells; c++) {
    const h = w.h[c];
    if (h > 0) { drift = Math.max(drift, Math.abs(h + w.bed[c] - level)); speed = Math.max(speed, Math.hypot(w.qx[c], w.qz[c]) / h); }
  }
  return {speed, drift, dryCells, volumeError: Math.abs(w.volumeError()) / w.volume(), substeps: w.stats.totalSubsteps};
}

/** L1 error of h over the domain, over the L1 norm of the reference. */
function l1(w, exact) {
  let e = 0, r = 0;
  for (let k = 0; k < w.nz; k++) for (let i = 0; i < w.nx; i++) { const [x, z] = centre(w, i, k), h = exact(x, z); e += Math.abs(w.h[i + w.nx * k] - h); r += h; }
  return e / r;
}

/** Ritter's dry dam break (SWASHES 4.1.2: h_l = 0.005 m, x0 = 5 m, L = 10 m, T = 6 s). */
export function ritter(K, {cells = 400, order = 2} = {}) {
  const L = 10, depth = 0.005, dam = 5, T = 6;
  const w = new K.ShallowWater({cells: [cells, 1], spacing: L / cells, depth: x => (x <= dam ? depth : 0), dt: 0.1, order, boundaries: {xMax: 'open'}});
  for (let s = 0; s < Math.round(T / 0.1); s++) w.step();
  const error = l1(w, x => K.ritterDamBreak(x, w.time, {depth, dam})[0]);
  // The wet front: the last cell deeper than 1% of h_l against x_B = x0 + 2 t sqrt(g h_l).
  let front = 0; for (let i = 0; i < cells; i++) if (w.h[i] > 0.01 * depth) front = centre(w, i)[0];
  // Where the exact depth is 1% of h_l: (sqrt(g h_l) - (x - x0)/2t) = 1.5 sqrt(0.01 g h_l)... solved from the formula.
  const c = Math.sqrt(G * depth), xFront = dam + 2 * w.time * (c - 1.5 * Math.sqrt(0.01 * G * depth));
  let negative = 0; for (const h of w.h) if (h < 0) negative++;
  return {error, front, xFront, xB: dam + 2 * w.time * c, cell: L / cells, negative, volumeError: Math.abs(w.volumeError()) / w.volume()};
}

/** Stoker's wet dam break (SWASHES 4.1.1: h_l = 0.005 m, h_r = 0.001 m, x0 = 5 m, L = 10 m, T = 6 s). */
export function stoker(K, {cells = 400} = {}) {
  const L = 10, left = 0.005, right = 0.001, dam = 5, T = 6;
  const w = new K.ShallowWater({cells: [cells, 1], spacing: L / cells, depth: x => (x <= dam ? left : right), dt: 0.1, boundaries: {xMax: 'open'}});
  for (let s = 0; s < Math.round(T / 0.1); s++) w.step();
  const error = l1(w, x => K.stokerDamBreak(x, w.time, {left, right, dam})[0]);
  // Shock position: where h crosses the mean of h_m and h_r, against x_C.
  const cm = K.stokerMiddleCelerity(left, right), hm = cm * cm / G, xC = dam + w.time * 2 * cm * cm * (Math.sqrt(G * left) - cm) / (cm * cm - G * right);
  let shock = NaN; const mid = 0.5 * (hm + right);
  for (let i = cells - 1; i > 0; i--) if (w.h[i - 1] >= mid && w.h[i] < mid) { const [x0] = centre(w, i - 1); shock = x0 + (w.h[i - 1] - mid) / (w.h[i - 1] - w.h[i]) * w.dx; break; }
  return {error, shock, xC, cell: L / cells, middle: hm};
}

/** Thacker's oscillating paraboloid (SWASHES 4.2.2: a = 1 m, r0 = 0.8 m, h0 = 0.1 m, L = 4 m), over `periods` periods. */
export function thacker(K, {cells = 100, periods = 1} = {}) {
  const P = {h0: 0.1, a: 1, r0: 0.8, centre: [2, 2]}, T = 2 * Math.PI / K.thackerFrequency(P.h0, P.a), steps = 100 * periods;
  const w = new K.ShallowWater({cells: [cells, cells], spacing: 4 / cells, bed: (x, z) => K.thackerBed(x, z, P), depth: (x, z) => K.thackerDepth(x, z, 0, P), dt: T / 100});
  const errors = [];
  for (let s = 1; s <= steps; s++) { w.step(); if (s % 25 === 0) errors.push(l1(w, (x, z) => K.thackerDepth(x, z, w.time, P))); }
  return {error: errors.at(-1), errors, worst: Math.max(...errors), period: T, volumeError: Math.abs(w.volumeError()) / w.volume(), substeps: w.stats.totalSubsteps};
}

const BUMP = {subcritical: {q: 4.42, h: 2}, transcritical: {q: 1.53, h: 0.66}, shock: {q: 0.18, h: 0.33}};
/** The three steady flows over the Goutal-Maurel bump (SWASHES 3.1.3-3.1.5), run from rest to `time` s. */
export function bump(K, kind, {cells = 200, time = 300} = {}) {
  const {q, h} = BUMP[kind], L = 25;
  const w = new K.ShallowWater({cells: [cells, 1], spacing: L / cells, bed: x => K.bumpBed(x), level: h, dt: 0.5, boundaries: {xMin: {type: 'inflow', discharge: q * L / cells}, xMax: {type: 'stage', level: h}}});
  for (let s = 0; s < time / 0.5; s++) w.step();
  const error = l1(w, x => K.bumpSteadyDepth(x, kind));
  let discharge = 0, froude = 0;
  // The cell discharge away from the jump (inside a captured jump the cell values are not a steady state of the cell).
  const jumpX = kind === 'shock' ? K.bumpShockPosition() : -1;
  for (let i = 0; i < cells; i++) { froude = Math.max(froude, w.froude(i)); if (Math.abs(centre(w, i)[0] - jumpX) > 4 * w.dx) discharge = Math.max(discharge, Math.abs(w.qx[i] - q) / q); }
  const out = {error, discharge, froude, volumeError: Math.abs(w.volumeError()) / w.volume()};
  if (kind === 'shock') {
    // The jump: the largest rise of h between neighbouring cells downstream of the crest.
    let best = 0, at = NaN;
    for (let i = 1; i < cells; i++) { const x = centre(w, i)[0]; if (x < 10 || x > 14) continue; const rise = w.h[i] - w.h[i - 1]; if (rise > best) { best = rise; at = x - 0.5 * w.dx; } }
    return {...out, jump: at, jumpExact: K.bumpShockPosition(), cell: L / cells};
  }
  return out;
}

/** Normal depth in a uniform wide channel: inflow q per width, Manning n, slope S, open outlet. */
export function manning(K, {cells = 100, length = 100, slope = 0.001, n = 0.03, q = 0.5, time = 6000, cfl} = {}) {
  const hn = K.manningNormalDepth(q, n, slope), dx = length / cells;
  const w = new K.ShallowWater({cells: [cells, 1], spacing: dx, bed: x => -slope * x, depth: () => 0.5 * hn, manning: n, dt: 10, ...(cfl ? {cfl} : {}), boundaries: {xMin: {type: 'inflow', discharge: q * dx}, xMax: 'open'}});
  for (let s = 0; s < time / 10; s++) w.step();
  const i = cells >> 1;
  return {depth: w.h[i], normal: hn, discharge: w.qx[i], q, froude: w.froude(i)};
}

/** Rain on an impervious plane (length 20 m, slope 5%, n = 0.02, 50 mm/h): the outflow hydrograph against the kinematic wave. */
export function rainOnSlope(K, {cells = 400, length = 20, slope = 0.05, n = 0.02, rain = 50 / 1000 / 3600, time = 300, dt = 0.5} = {}) {
  const dx = length / cells;
  const w = new K.ShallowWater({cells: [cells, 1], spacing: dx, bed: x => slope * (length - x), manning: n, rain, dt, boundaries: {xMax: 'open'}});
  const P = {length, rain, slope, manning: n}, te = K.kinematicEquilibriumTime(P);
  let before = 0, se = 0, sr = 0, late = 0;
  const hydrograph = [];
  for (let s = 0; s < time / dt; s++) {
    w.step();
    const q = -(w.ledger.inflow - before) / dt / dx; before = w.ledger.inflow;
    const ref = K.kinematicWaveOutflow(w.time - dt / 2, P);
    se += (q - ref) ** 2; sr += ref * ref; hydrograph.push([w.time, q, ref]);
    if (w.time > 2 * te) late = Math.max(late, Math.abs(q / (rain * length) - 1));
  }
  return {rms: Math.sqrt(se / sr), steady: late, te, hydrograph, volumeError: Math.abs(w.volumeError()) / w.volume()};
}

/** Green-Ampt under constant rain on a loam (Rawls et al. 1983 Table 2: K 0.34 cm/h, psi 8.89 cm, theta_e 0.434), initial effective saturation 30%. */
export const LOAM = {conductivity: 0.34 / 100 / 3600, suction: 0.0889, moistureDeficit: 0.434 * 0.7};
export function greenAmpt(K, {dt = 10, rain = 2 / 100 / 3600, hours = 2} = {}) {
  const w = new K.ShallowWater({cells: [1, 1], spacing: 1, soil: LOAM, rain, dt});
  let worst = 0, ponded = NaN;
  for (let s = 0; s < hours * 3600 / dt; s++) {
    w.step();
    const F = K.greenAmptCumulative(w.time, rain, LOAM);
    worst = Math.max(worst, Math.abs(w.infiltrated[0] - F));
    if (Number.isNaN(ponded) && w.h[0] > 1e-9) ponded = w.time;
  }
  return {worst, final: w.infiltrated[0], exact: K.greenAmptCumulative(w.time, rain, LOAM), ponded, pondingTime: K.greenAmptPondingTime(rain, LOAM), dt, volumeError: Math.abs(w.volumeError())};
}

/** Volume budget of everything at once: an inflow, an open side, rain, infiltration on half the cells, friction, wetting and drying. */
export function budget(K, {steps = 400} = {}) {
  const nx = 48, nz = 32, soil = Array.from({length: nx * nz}, (_, c) => (c % nx < nx / 2 ? LOAM : null));
  const w = new K.ShallowWater({cells: [nx, nz], spacing: 0.25, bed: (x, z) => 0.02 * (12 - x) + 0.15 * Math.sin(z) ** 2, depth: (x, z, b) => (x < 3 ? Math.max(0, 0.3 - b) : 0), manning: 0.03, soil, rain: 1e-4, dt: 0.05,
    boundaries: {xMin: {type: 'inflow', discharge: 0.2}, xMax: 'open'}});
  for (let s = 0; s < steps; s++) w.step();
  const L = w.ledger;
  return {error: Math.abs(w.volumeError()), volume: w.volume(), relative: Math.abs(w.volumeError()) / w.volume(), ledger: {...L}, wet: w.stats.wetCells};
}

/** Order of the L1 error between two resolutions. */
export const order = (coarse, fine, ratio = 2) => Math.log(coarse / fine) / Math.log(ratio);

/** Repeatability and an exact resume: run, save, run on; restore a copy built the same way and run the same; compare hashes. */
export function resume(K) {
  const make = () => new K.ShallowWater({cells: [40, 30], spacing: 0.1, bed: (x, z) => 0.1 * Math.sin(x) + 0.05 * z, depth: (x, z, b) => (x < 1.5 ? Math.max(0, 0.4 - b) : 0), manning: 0.02, soil: LOAM, rain: 2e-5, dt: 0.02, boundaries: {xMax: 'open'}});
  const a = make();
  for (let s = 0; s < 60; s++) a.step();
  const saved = a.saveState();
  for (let s = 0; s < 60; s++) a.step();
  const b = make(); b.restoreState(saved);
  for (let s = 0; s < 60; s++) b.step();
  const c = make(); for (let s = 0; s < 120; s++) c.step();
  return {a: hashArrays(a.h, a.qx, a.qz, a.infiltrated), b: hashArrays(b.h, b.qx, b.qz, b.infiltrated), repeat: hashArrays(c.h, c.qx, c.qz, c.infiltrated), time: [a.time, b.time]};
}

/** A box floating in a lake: its draft against Archimedes (m / (rho A)), and the lake's rise against the displaced volume. */
export async function floatingBox(K, {seconds = 6} = {}) {
  const world = await K.createWorld({step: 1 / 60, subSteps: 4, ground: false, gravity: [0, -G, 0]});
  try {
    const half = [0.2, 0.1, 0.15], density = 500, mass = density * 8 * half[0] * half[1] * half[2], level = 0.5;
    const water = new K.ShallowWater({cells: [40, 40], spacing: 0.1, level, dt: 1 / 60, density: 1000});
    const coupling = new K.ShallowWaterCoupling(world, water);
    const box = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [2, level + half[1] + 0.001, 2], density, neverSleeps: true, linearDamping: 0, angularDamping: 0.5});
    coupling.addBody(box, {shape: {kind: 'box', halfExtents: half}});
    const area = 4 * half[0] * half[2], draft = mass / (1000 * area);
    let y = 0, n = 0;
    for (let i = 0; i < seconds * 60; i++) { coupling.step(); world.step(); if (i >= seconds * 60 - 60) { y += world.getState(box).position[1]; n++; } }
    const bottom = y / n - half[1], report = coupling.report(box);
    const mean = water.volume() / (water.nx * water.nz * water.dx * water.dz);
    return {draft: water.levelAt(2.0, 0.5) - bottom, archimedes: draft, measuredLevel: water.levelAt(2.0, 0.5), submerged: report.submergedVolume, displacedExact: mass / 1000,
      rise: mean - level, riseExact: mass / 1000 / (4 * 4), volumeError: water.volumeError(), body: world.getState(box).position};
  } finally { world.dispose?.(); }
}

/** A sphere held in a current by drag: the impulse the bodies receive and the momentum the water loses are equal and opposite. */
export async function drifting(K, {seconds = 10} = {}) {
  const world = await K.createWorld({step: 1 / 60, subSteps: 4, ground: false, gravity: [0, -G, 0]});
  try {
    const water = new K.ShallowWater({cells: [60, 20], spacing: 0.1, level: 0.6, velocity: [0.5, 0], dt: 1 / 60, boundaries: {xMin: 'open', xMax: 'open'}});
    const coupling = new K.ShallowWaterCoupling(world, water);
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.12}, position: [1.5, 0.6, 1], density: 600, neverSleeps: true, linearDamping: 0});
    coupling.addBody(ball, {shape: {kind: 'sphere', radius: 0.12}});
    let onBodies = 0, onWater = 0;
    for (let i = 0; i < seconds * 60; i++) { coupling.step(); onBodies += coupling.impulseOnBodies[0]; onWater += coupling.impulseOnWater[0]; world.step(); }
    return {velocity: world.getState(ball).linearVelocity[0], water: 0.5, onBodies, onWater, sourceMomentum: water.sourceMomentum[0]};
  } finally { world.dispose?.(); }
}

/** The same bare water stepped by hand and through a Simulation: bit-identical. */
export async function throughSimulation(K) {
  const make = () => new K.ShallowWater({cells: [30, 20], spacing: 0.1, depth: (x) => (x < 1 ? 0.3 : 0.05), dt: 1 / 60, manning: 0.02});
  const a = make();
  for (let i = 0; i < 90; i++) a.step();
  const world = await K.createWorld({step: 1 / 60, ground: false});
  try {
    const b = make(), sim = K.createSimulation(world).add(K.shallowWaterSubsystem(b, {id: 'pond'}));
    for (let i = 0; i < 90; i++) sim.step();
    return {manual: hashArrays(a.h, a.qx, a.qz), simulation: hashArrays(b.h, b.qx, b.qz), diagnostics: sim.diagnostics().subsystems.pond};
  } finally { world.dispose?.(); }
}
