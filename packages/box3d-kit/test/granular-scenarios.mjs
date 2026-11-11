// Set-ups of the granular validation, shared by test/v17-granular.test.mjs (which asserts on them) and
// validation/domains/granular.mjs (which reports them). Each function builds a problem with a known answer,
// runs the real solver and returns the measured numbers beside the reference. SI units.
// `K` is the kit: the exports of box3d-webgpu-kit/granular plus {createWorld, createSimulation, axisRotation}.
// Nothing here measures wall-clock time.

export const G = 9.81, HZ = 240, DT = 1 / HZ, SUB = 4;

/** Glass-like beads made soft enough to step cheaply: 10 mm, Hertz. */
export const BEAD = {density: 2500, youngModulus: 1e8, poissonRatio: 0.3, restitution: 1, friction: 0};
const R = 0.005;

/** The critical time of a grain of radius r for this material and law. */
export function criticalTime(K, material, config, r) {
  return new K.Granular({material, config: {...config, dt: 1e-12, capacity: 1}}).criticalTimeFor(r);
}
/** A time step that is `fraction` of the critical time and divides `span` a whole number of times. */
const stepFor = (K, material, config, r, fraction, span) => span / Math.ceil(span / (fraction * criticalTime(K, material, config, r)));
const newWorld = (K, options = {}) => K.createWorld({step: DT, subSteps: SUB, ground: false, ...options});
const linearLaw = stiffness => ({law: 'linear', normalStiffness: stiffness});

// ---------------------------------------------------------------------------------------------------
// Two bodies.
// ---------------------------------------------------------------------------------------------------

/**
 * Two equal grains meet head on. Returns the contact duration (the overlap's zero crossings, interpolated inside a
 * step) beside Hertz's closed form, the restitution, the largest drift of the energy ledger and the momentum change.
 */
export function headOn(K, {law = 'hertz', restitution = 1, fraction = 0.02, speed = 0.1, stiffness = 1e5} = {}) {
  const material = {...BEAD, restitution}, config = {gravity: [0, 0, 0], ...(law === 'linear' ? linearLaw(stiffness) : {})};
  const dt = fraction * criticalTime(K, material, config, R);
  const g = new K.Granular({material, config: {...config, dt, capacity: 2}});
  const start = 1e-3 * R * (1 + 0.37 * fraction);
  g.addGrain([-R - start, 0, 0], R, [speed / 2, 0, 0]); g.addGrain([R + start, 0, 0], R, [-speed / 2, 0, 0]);
  const x = g.positions, gap = () => x[3] - x[0] - 2 * R, p0 = g.linearMomentum()[0], e0 = g.energyBalance();
  let before = gap(), begin = null, end = null, drift = 0, deepest = 0;
  for (let step = 0; step < 4e6 && end === null; step++) {
    g.step();
    const now = gap();
    if (begin === null && now < 0) begin = g.time - dt + dt * before / (before - now);
    else if (begin !== null && now >= 0) end = g.time - dt + dt * before / (before - now);
    drift = Math.max(drift, Math.abs(g.energyBalance() - e0)); deepest = Math.max(deepest, -now);
    before = now;
  }
  const mass = g.masses[0], modulus = K.granularEffectiveModulus(material.youngModulus, material.poissonRatio);
  return {dt, steps: g.stats.steps, duration: end - begin, hertzDuration: K.hertzContactDuration(mass / 2, R / 2, modulus, speed), linearDuration: Math.PI * Math.sqrt(mass / 2 / stiffness),
    restitution: (g.velocities[3] - g.velocities[0]) / speed, energyDrift: drift / e0, momentum: Math.abs(g.linearMomentum()[0] - p0) / (mass * speed), overlap: deepest / R,
    dissipated: g.dissipatedDamping, kinetic: g.kineticEnergy(), energy: e0};
}

/**
 * A grain without spin strikes a plane at the angle whose tangent is `psi` (tangential over normal speed). Returns
 * psi2 = tangential velocity of the contact point after the impact over the normal speed before it, and the normal
 * restitution. Sliding throughout: psi2 = psi - (7/2) mu (1 + e). Sticking with linear springs and no damping:
 * psi2 = psi cos(pi sqrt(7 k_t / (2 k_n))).
 */
export function oblique(K, {law = 'hertz', restitution = 1, friction = 0.3, psi = 1, ratio = 2 / 7, tangentialDamping = 1, fraction = 0.01, speed = 0.01, stiffness = 1e5} = {}) {
  const material = {...BEAD, restitution, friction}, config = {gravity: [0, 0, 0], tangentialDamping, ...(law === 'linear' ? {...linearLaw(stiffness), tangentialStiffnessRatio: ratio} : {})};
  const g = new K.Granular({material, config: {...config, dt: fraction * criticalTime(K, material, config, R), capacity: 1}});
  g.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}});
  g.addGrain([0, R * (1 + 1e-4), 0], R, [psi * speed, -speed, 0]);
  let touched = false;
  for (let step = 0; step < 4e6; step++) { g.step(); if (g.stats.wallContacts) touched = true; else if (touched) break; }
  const v = g.velocities, w = g.angularVelocities;
  return {psi2: (v[0] + R * w[2]) / speed, restitution: v[1] / speed, sliding: psi - 3.5 * friction * (1 + restitution), sticking: psi * Math.cos(Math.PI * Math.sqrt(3.5 * ratio)), overlap: g.stats.maxOverlap};
}

/** A grain on a plane tilted by `degrees`, from rest. Returns its acceleration down the slope over the second half of the run. */
export function incline(K, {degrees = 30, friction = 0.1, law = 'hertz', seconds = 0.6, fraction = 0.1} = {}) {
  const theta = degrees * Math.PI / 180, material = {...BEAD, restitution: 0.3, friction};
  const config = {gravity: [G * Math.sin(theta), -G * Math.cos(theta), 0], ...(law === 'linear' ? linearLaw(1e4) : {})};
  const g = new K.Granular({material, config: {...config, dt: fraction * criticalTime(K, material, config, R), capacity: 1}});
  g.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}}); g.addGrain([0, R, 0], R);
  const steps = Math.round(seconds / g.dt), half = Math.round(steps / 2);
  g.step(half);
  const v1 = g.velocities[0], w1 = g.angularVelocities[2], t1 = g.time;
  g.step(steps - half);
  return {acceleration: (g.velocities[0] - v1) / (g.time - t1), spinAcceleration: -(g.angularVelocities[2] - w1) / (g.time - t1) * R,
    sliding: G * (Math.sin(theta) - friction * Math.cos(theta)), rolling: 5 / 7 * G * Math.sin(theta), slips: friction < 2 / 7 * Math.tan(theta), steps};
}

// ---------------------------------------------------------------------------------------------------
// Many grains in a box.
// ---------------------------------------------------------------------------------------------------

/** Five planes: a floor at y = 0 and four sides around [0, w] x [0, d]. Returns the wall indices. */
function openBox(g, w, d, {floorFriction, sideFriction = 0} = {}) {
  return {floor: g.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}, friction: floorFriction}),
    sides: [g.addWall({shape: {kind: 'plane', normal: [1, 0, 0]}, friction: sideFriction}), g.addWall({shape: {kind: 'plane', normal: [-1, 0, 0]}, position: [w, 0, 0], friction: sideFriction}),
      g.addWall({shape: {kind: 'plane', normal: [0, 0, 1]}, friction: sideFriction}), g.addWall({shape: {kind: 'plane', normal: [0, 0, -1]}, position: [0, 0, d], friction: sideFriction})]};
}
const PITCH = 2.2 * R;
/** A jittered lattice of nx x ny x nz beads of 9 to 11 mm starting at height y0. */
const beadLattice = (K, nx, ny, nz, {y0 = 0, seed = 7, x0 = 0, z0 = 0} = {}) => K.granularLattice({min: [x0, y0, z0], max: [x0 + nx * PITCH, y0 + ny * PITCH, z0 + nz * PITCH], radius: [0.9 * R, 1.1 * R], gap: 0, jitter: 1, seed});

/**
 * Beads dropped into a box with friction, rolling resistance and damping. Returns the drift of
 * kinetic + gravitational + elastic + dissipated, as a fraction of the energy dissipated, and the parts.
 */
export function ledger(K, {law = 'hertz', fraction = 0.1, seconds = 0.3, n = [6, 8, 6]} = {}) {
  const material = {...BEAD, youngModulus: 5e6, restitution: 0.6, friction: 0.5, rollingFriction: 0.1}, config = law === 'linear' ? linearLaw(5e3) : {};
  const lattice = beadLattice(K, ...n, {y0: 0}), dt = fraction * criticalTime(K, material, config, 0.9 * R);
  const g = new K.Granular({material, config: {...config, dt, capacity: lattice.count}});
  openBox(g, n[0] * PITCH, n[2] * PITCH, {sideFriction: 0.5});
  g.addGrains(lattice.positions, lattice.radii);
  const e0 = g.energyBalance(), potential0 = g.gravitationalEnergy();
  let drift = 0;
  const steps = Math.round(seconds / dt);
  for (let done = 0; done < steps; done += 50) { g.step(Math.min(50, steps - done)); drift = Math.max(drift, Math.abs(g.energyBalance() - e0)); }
  const dissipated = g.dissipatedDamping + g.dissipatedFriction;
  return {grains: lattice.count, dt, steps, drift: drift / dissipated, final: (g.energyBalance() - e0) / dissipated, kinetic: g.kineticEnergy(), potentialDrop: potential0 - g.gravitationalEnergy(), elastic: g.elasticEnergy(),
    damping: g.dissipatedDamping, friction: g.dissipatedFriction, overlap: g.stats.maxOverlap, fraction: g.timeStepFraction};
}

/**
 * A column of beads at rest in a box with frictionless sides: the floor must carry the weight. Returns the floor force
 * (mean over the last tenth of a second) over the weight.
 */
export function column(K, {law = 'hertz', n = [5, 12, 5], seconds = 0.7, fraction = 0.12} = {}) {
  const material = {...BEAD, youngModulus: 5e6, restitution: 0.3, friction: 0.5, rollingFriction: 0.1}, config = law === 'linear' ? linearLaw(5e3) : {};
  const lattice = beadLattice(K, ...n), dt = fraction * criticalTime(K, material, config, 0.9 * R);
  const g = new K.Granular({material, config: {...config, dt, capacity: lattice.count}});
  const {floor, sides} = openBox(g, n[0] * PITCH, n[2] * PITCH, {sideFriction: 0});
  g.addGrains(lattice.positions, lattice.radii);
  const window = Math.round(0.1 / dt);
  g.step(Math.round(seconds / dt) - window); g.resetWallImpulses(); g.step(window);
  const weight = g.mass() * G;
  let sideways = 0; for (const s of sides) sideways = Math.max(sideways, Math.abs(g.wallImpulse(s)[1]) / (window * dt));
  return {grains: lattice.count, weight, floor: g.wallImpulse(floor)[1] / (window * dt), instant: g.wallForce(floor)[1], sideFriction: sideways, kinetic: g.kineticEnergy(), potential: g.gravitationalEnergy(), overlap: g.stats.overlap, coordination: g.coordination()};
}

// ---------------------------------------------------------------------------------------------------
// Silo: Janssen and Beverloo.
// ---------------------------------------------------------------------------------------------------

/** Mean bead diameter of the silo runs, m, and their material: linear springs of k_n = 4000 m g / d. */
export const SILO_D = 2 * R;
const SILO_MASS = 2500 * Math.PI / 6 * (SILO_D * SILO_D * SILO_D);
export const SILO_STIFFNESS = 4000 * SILO_MASS * G / SILO_D;
const SILO = {material: {density: 2500, restitution: 0.3, friction: 0.5, rollingFriction: 0.02}, config: linearLaw(SILO_STIFFNESS)};

/**
 * Pour a lattice column of beads into a cylinder of radius `radius` standing on a floor and let it come to rest.
 * Returns the solver, the wall indices and the fill's mass and height.
 */
export function fillSilo(K, {radius, latticeHeight, wallFriction = 0.5, seconds, fraction = 0.12, seed = 11, capacity} = {}) {
  const {material, config} = SILO, reach = radius - 1.1 * R;
  const lattice = K.granularLattice({min: [-radius, 0, -radius], max: [radius, latticeHeight, radius], radius: [0.9 * R, 1.1 * R], gap: 0, jitter: 1, seed, inside: (x, y, z) => x * x + z * z < reach * reach});
  const dt = fraction * criticalTime(K, material, config, 0.9 * R);
  const g = new K.Granular({material, config: {...config, dt, capacity: capacity ?? lattice.count}});
  const floor = g.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}, type: 'kinematic', friction: wallFriction});
  const wall = g.addWall({shape: {kind: 'cylinder', radius, from: -1, to: latticeHeight + 1}, friction: wallFriction});
  g.addGrains(lattice.positions, lattice.radii);
  g.step(Math.round(seconds / dt));
  let top = 0; for (let i = 0; i < g.grainCount; i++) top = Math.max(top, g.positions[3 * i + 1] + g.radii[i]);
  return {g, floor, wall, mass: g.mass(), height: top, dt, count: lattice.count};
}

/** Least-squares fit of F = W_s (1 - exp(-W / W_s)) to (weight, base load) pairs: returns W_s and the rms residual over W_s. */
export function fitJanssen(weights, loads) {
  const model = (ws, w) => ws * (1 - Math.exp(-w / ws)), cost = ws => weights.reduce((sum, w, k) => sum + (model(ws, w) - loads[k]) ** 2, 0);
  // The minimum is where the slope of the cost changes sign: found by bisection, which pins it down to round-off
  // (comparing costs would leave it loose by the square root of that).
  const slope = ws => weights.reduce((sum, w, k) => { const e = Math.exp(-w / ws); return sum + (model(ws, w) - loads[k]) * (1 - e - w / ws * e); }, 0);
  let lo = 0.5 * Math.min(...loads), hi = 4 * Math.max(...loads);
  for (let i = 0; i < 200; i++) { const mid = 0.5 * (lo + hi); if (slope(mid) < 0) lo = mid; else hi = mid; }
  const ws = 0.5 * (lo + hi);
  return {saturation: ws, residual: Math.sqrt(cost(ws) / weights.length) / ws};
}

/**
 * Janssen: the load on the floor of a narrow silo against the weight poured in. The silo is filled in `stages` batches
 * (a lattice `batch` bead diameters tall each, dropped from just above the fill, so that no batch lands hard). After
 * each batch has come to rest the floor is lowered by `lower` at `speed`, so that the fill slides down the wall and the
 * wall friction acts upwards everywhere, and the loads are read as means over the last 60% of that descent.
 * Returns, per stage, the weight, the floor load and the wall's share, and the mobilised wall friction (vertical wall
 * force over mu times the sum of the wall's normal forces); and the fit of Janssen's law with its one fitted number,
 * the saturation load, turned into the stress ratio K with the wall friction that was measured.
 */
export function janssen(K, {diameters = 6, batch = 9, stages = 8, wallFriction = 0.5, lower = 0.5 * SILO_D, speed = 0.02, settle = 0.25, fraction = 0.12} = {}) {
  const {material, config} = SILO, radius = diameters * SILO_D / 2, reach = radius - 1.1 * R, fills = [];
  const batches = [];
  for (let k = 0; k < stages; k++) batches.push(K.granularLattice({min: [-radius, 0, -radius], max: [radius, batch * SILO_D, radius], radius: [0.9 * R, 1.1 * R], gap: 0, jitter: 1, seed: 11 + k, inside: (x, y, z) => x * x + z * z < reach * reach}));
  const dt = fraction * criticalTime(K, material, config, 0.9 * R);
  const g = new K.Granular({material, config: {...config, dt, capacity: batches.reduce((sum, b) => sum + b.count, 0)}});
  const floor = g.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}, type: 'kinematic', friction: wallFriction});
  const wall = g.addWall({shape: {kind: 'cylinder', radius, from: -10, to: 10}, friction: wallFriction});
  const top = () => { let y = g.wallPosition(floor)[1]; for (let i = 0; i < g.grainCount; i++) y = Math.max(y, g.positions[3 * i + 1] + g.radii[i]); return y; };
  const descent = Math.round(lower / speed / dt), window = Math.round(0.6 * descent);
  for (const lattice of batches) {
    const y0 = top() + 0.2 * SILO_D, positions = Float64Array.from(lattice.positions);
    for (let i = 0; i < lattice.count; i++) positions[3 * i + 1] += y0;
    g.addGrains(positions, lattice.radii);
    g.step(Math.round(settle / dt));
    g.setWallVelocity(floor, [0, -speed, 0]); g.step(descent - window);
    g.resetWallImpulses(); let normal = 0;
    for (let k = 0; k < window; k++) { g.step(); normal += g.wallNormalLoad(wall) / window; }
    g.setWallVelocity(floor, [0, 0, 0]);
    const base = g.wallImpulse(floor)[1] / (window * dt), carried = g.wallImpulse(wall)[1] / (window * dt);
    fills.push({grains: g.liveCount, weight: g.mass() * G, base: -base, wall: -carried, normal, mobilised: -carried / (wallFriction * normal), height: top() - g.wallPosition(floor)[1], overlap: g.stats.overlap});
  }
  const fit = fitJanssen(fills.map(f => f.weight), fills.map(f => f.base)), tallest = fills.at(-1);
  // lambda = D / (4 mu K) is the height of fill that weighs the saturation load.
  const lambda = fit.saturation / (tallest.weight / tallest.height), mobilised = tallest.mobilised * wallFriction;
  // Measured directly on the full silo: mean wall pressure over the vertical stress on the floor.
  const direct = tallest.normal / (2 * Math.PI * radius * tallest.height) / (tallest.base / (Math.PI * radius * radius));
  // The floor loads of the second half of the stages: their mean and their largest departure from it.
  const late = fills.slice(fills.length >> 1).map(f => f.base), plateau = late.reduce((a, b) => a + b, 0) / late.length;
  return {fills, saturation: fit.saturation, residual: fit.residual, lambda, stressRatio: 2 * radius / (4 * mobilised * lambda), stressRatioDirect: direct, stressRatioFullFriction: 2 * radius / (4 * wallFriction * lambda), mobilisedFriction: mobilised,
    balance: Math.max(...fills.map(f => Math.abs(f.base + f.wall - f.weight) / f.weight)), hydrostatic: tallest.base / tallest.weight, plateau, scatter: Math.max(...late.map(b => Math.abs(b / plateau - 1))), maxOverlap: g.stats.maxOverlap};
}

/** Least-squares line through W^(2/5) against D: Beverloo's W = C rho_b sqrt(g) (D - k d)^(5/2). Returns C, k and the worst relative misfit of W. */
export function fitBeverloo(orifices, rates, bulkDensity, d) {
  const y = rates.map(w => w ** 0.4), n = orifices.length, mx = orifices.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0; for (let i = 0; i < n; i++) { sxy += (orifices[i] - mx) * (y[i] - my); sxx += (orifices[i] - mx) ** 2; }
  const slope = sxy / sxx, intercept = my - slope * mx, C = slope ** 2.5 / (bulkDensity * Math.sqrt(G)), k = -intercept / slope / d;
  const misfit = Math.max(...rates.map((w, i) => Math.abs(C * bulkDensity * Math.sqrt(G) * (orifices[i] - k * d) ** 2.5 / w - 1)));
  return {C, k, misfit};
}

/**
 * Beverloo: a flat-bottomed silo is filled once, then drained through orifices of several diameters (in bead
 * diameters). The mass flow is the slope of discharged mass against time over `count` beads, after `skip` seconds. The run named
 * by `long` goes on until `long.count` beads are out; its first and last thirds give the rate as the level falls.
 * The bulk density is that of the fill at rest between 2 bead diameters and 60% of its height, wall to wall.
 */
export function beverloo(K, {diameters = 15, latticeHeight = 24, orifices = [5, 6, 7, 8], count = 200, skip = 0.12, long = {orifice: 8, count: 700}, wallFriction = 0.5, fraction = 0.17} = {}) {
  const radius = diameters * SILO_D / 2;
  const filled = fillSilo(K, {radius, latticeHeight: latticeHeight * SILO_D, wallFriction, seconds: 0.45, fraction});
  const source = filled.g, n = source.grainCount, runs = [];
  const y1 = 2 * SILO_D, y2 = 0.6 * filled.height;
  let slab = 0; for (let i = 0; i < n; i++) { const y = source.positions[3 * i + 1]; if (y >= y1 && y < y2) slab += source.masses[i]; }
  const bulkDensity = slab / (Math.PI * radius * radius * (y2 - y1));
  const {material, config} = SILO;
  const slope = (t, m) => { const k = t.length, mt = t.reduce((a, b) => a + b, 0) / k, mm = m.reduce((a, b) => a + b, 0) / k; let sxy = 0, sxx = 0; for (let i = 0; i < k; i++) { sxy += (t[i] - mt) * (m[i] - mm); sxx += (t[i] - mt) ** 2; } return sxy / sxx; };
  const level = g => { let top = 0; for (let i = 0; i < n; i++) if (g.alive[i]) top = Math.max(top, g.positions[3 * i + 1]); return top / SILO_D; };
  for (const orifice of orifices) {
    const g = new K.Granular({material, config: {...config, dt: filled.dt, capacity: n, bounds: {min: [-2 * radius, -3 * SILO_D, -2 * radius], max: [2 * radius, 1e3, 2 * radius]}}});
    g.addWall({shape: {kind: 'annulus', innerRadius: orifice * SILO_D / 2, outerRadius: radius + SILO_D}, friction: wallFriction});
    g.addWall({shape: {kind: 'cylinder', radius, from: -1e-3, to: latticeHeight * SILO_D + 1}, friction: wallFriction});
    g.addGrains(source.positions.subarray(0, 3 * n), source.radii.subarray(0, n));
    const times = [], masses = [], limit = Math.round(3 / g.dt), wanted = long && long.orifice === orifice ? long.count : count;
    g.step(Math.round(skip / g.dt));
    const first = g.stats.removed, startLevel = level(g);
    let seen = first;
    for (let step = 0; step < limit && g.stats.removed < first + wanted; step += 20) {
      g.step(20);
      if (g.stats.removed > seen) { seen = g.stats.removed; times.push(g.time); masses.push(g.stats.removedMass); }
    }
    // The rate of every run is read over the same number of beads, so the long run does not weigh more.
    let cut = times.length; for (let i = 0; i < times.length; i++) if (masses[i] - masses[0] > count * SILO_MASS) { cut = i; break; }
    const run = {orifice, rate: slope(times.slice(0, cut), masses.slice(0, cut)), discharged: g.stats.removed, seconds: g.time, jammed: g.stats.removed < first + wanted};
    if (long && long.orifice === orifice) { const third = Math.floor(times.length / 3); Object.assign(run, {early: slope(times.slice(0, third), masses.slice(0, third)), late: slope(times.slice(-third), masses.slice(-third)), startLevel, endLevel: level(g)}); }
    runs.push(run);
  }
  const fit = fitBeverloo(runs.map(r => r.orifice * SILO_D), runs.map(r => r.rate), bulkDensity, SILO_D), tall = runs.find(r => r.early !== undefined);
  return {grains: n, bulkDensity, fillHeight: filled.height / SILO_D, packing: bulkDensity / material.density, kineticAtOpening: source.kineticEnergy(), runs, ...fit, heightRatio: tall ? tall.late / tall.early : null, levels: tall ? [tall.startLevel, tall.endLevel] : null};
}

/**
 * Angle of repose: beads held on a ledge by a gate; the gate is taken away, the beads that run off the edge are
 * removed, and what stays slopes from the back wall down to the edge. The slab is 3.5 beads deep between frictionless
 * planes; the ledge itself has friction 0.5 and rolling friction 0.3 in every run, so that a lone bead does not roll
 * on it for ever. Returns the slope of the least-squares line through the highest bead of each one-diameter column
 * along the ledge, in degrees, and the fraction of the mass that stayed (a second reading that does not depend on a
 * fit).
 */
export function repose(K, {friction = 0.5, rollingFriction = 0.1, length = 12, height = 8, depth = 3.5, seconds = 1.4, fraction = 0.17} = {}) {
  const material = {density: 2500, restitution: 0.3, friction, rollingFriction}, config = linearLaw(SILO_STIFFNESS);
  const L = length * SILO_D, D = depth * SILO_D;
  const lattice = K.granularLattice({min: [0, 0, 0], max: [L, 2.2 * height * SILO_D, D], radius: [0.9 * R, 1.1 * R], gap: 0, jitter: 1, seed: 5});
  const dt = fraction * criticalTime(K, material, config, 0.9 * R);
  const g = new K.Granular({material, config: {...config, dt, capacity: lattice.count, bounds: {min: [-1, -4 * SILO_D, -1], max: [L + 1, 1e3, D + 1]}}});
  // The ledge is the top of a box, so that beads past its edge fall away.
  g.addWall({shape: {kind: 'box', halfExtents: [L / 2, SILO_D, D]}, position: [L / 2, -SILO_D, D / 2], friction: 0.5, rollingFriction: 0.3});
  g.addWall({shape: {kind: 'plane', normal: [1, 0, 0]}});
  g.addWall({shape: {kind: 'plane', normal: [0, 0, 1]}, friction: 0, rollingFriction: 0}); g.addWall({shape: {kind: 'plane', normal: [0, 0, -1]}, position: [0, 0, D], friction: 0, rollingFriction: 0});
  const gate = g.addWall({shape: {kind: 'plane', normal: [-1, 0, 0]}, position: [L, 0, 0]});
  g.addGrains(lattice.positions, lattice.radii);
  g.step(Math.round(0.3 / dt));
  const poured = g.mass(), tail = Math.round(0.3 / dt);
  g.setWallEnabled(gate, false);
  g.step(Math.round(seconds / dt) - tail);
  const before = g.stats.removed; g.step(tail);
  const tops = new Array(length).fill(0);
  let mass = 0;
  for (let i = 0; i < g.grainCount; i++) {
    // Beads in the air past the edge are on their way out.
    if (!g.alive[i] || g.positions[3 * i + 1] < 0 || g.positions[3 * i] >= L) continue;
    mass += g.masses[i];
    const c = Math.floor(g.positions[3 * i] / SILO_D);
    if (c >= 0 && c < length) tops[c] = Math.max(tops[c], g.positions[3 * i + 1] + g.radii[i]);
  }
  const xs = tops.map((_, c) => (c + 0.5) * SILO_D), mx = xs.reduce((a, b) => a + b, 0) / length, my = tops.reduce((a, b) => a + b, 0) / length;
  let sxy = 0, sxx = 0; for (let c = 0; c < length; c++) { sxy += (xs[c] - mx) * (tops[c] - my); sxx += (xs[c] - mx) ** 2; }
  return {angle: Math.atan(-sxy / sxx) * 180 / Math.PI, retained: mass / poured, grains: lattice.count, left: g.liveCount, leaving: g.stats.removed - before, backHeight: tops[0] / SILO_D};
}

// ---------------------------------------------------------------------------------------------------
// Coupling to the rigid world.
// ---------------------------------------------------------------------------------------------------

const COUPLED = {material: {density: 2500, restitution: 0.3, friction: 0.5, rollingFriction: 0.05}, config: linearLaw(SILO_STIFFNESS)};
const coupledStep = K => stepFor(K, COUPLED.material, COUPLED.config, 0.9 * R, 0.12, DT);

/**
 * A rigid block is dropped on a bed of beads in a box. Returns the mean force of the bed on the block over the last
 * fifth of a second against its weight, the block's speed, and the floor load against the weight of bed and block.
 */
export async function blockOnBed(K, {n = [8, 6, 8], seconds = 1.1, simulation = false} = {}) {
  const world = await newWorld(K);
  try {
    const {material, config} = COUPLED, lattice = beadLattice(K, ...n), w = n[0] * PITCH, d = n[2] * PITCH, half = [0.3 * w, 0.015, 0.3 * d];
    const g = new K.Granular({material, config: {...config, dt: coupledStep(K), capacity: lattice.count}});
    const {floor} = openBox(g, w, d, {sideFriction: 0});
    g.addGrains(lattice.positions, lattice.radii);
    const block = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [w / 2, n[1] * PITCH + 0.03, d / 2], density: 1500, neverSleeps: true});
    const coupling = new K.GranularCoupling(world, g);
    coupling.addBody(block, {shape: {kind: 'box', halfExtents: half}});
    const steps = Math.round(seconds * HZ), window = Math.round(0.2 * HZ), events = [];
    let sim = null;
    if (simulation) { sim = K.createSimulation(world); sim.add(K.granularSubsystem(coupling)).trackBody(block, {kind: 'box', halfExtents: half}); sim.onEvent(e => { if (e.source === 'granular') events.push(`${e.tick}:${e.type}`); }); }
    const advance = () => { if (sim) sim.step(); else { coupling.step(); world.step(); } };
    for (let i = 0; i < steps - window; i++) advance();
    let force = 0, base = 0;
    for (let i = 0; i < window; i++) { advance(); force += coupling.force(block)[1] / window; base += g.wallImpulse(floor)[1] / DT / window; }
    const s = world.getState(block);
    return {force, weight: s.mass * G, base: -base, total: (s.mass + g.mass()) * G, speed: Math.hypot(...s.linearVelocity), height: s.position[1], substeps: coupling.substeps, grains: lattice.count, contacts: g.wallContacts(coupling.indexOf(block)),
      events, energy: sim ? sim.energy() : null, order: sim ? sim.order().map(row => row.id) : null, hash: stateHash(g, world)};
  } finally { world.dispose(); }
}

/**
 * Newton's third law without gravity: a cluster of beads flies into a free rigid sphere. Returns the change of the
 * total momentum (beads plus body, the body's from the world's own mass and velocity) over the momentum exchanged.
 */
export async function freeCollision(K, {seconds = 0.12} = {}) {
  const world = await newWorld(K, {gravity: [0, 0, 0]});
  try {
    const {material, config} = COUPLED, lattice = beadLattice(K, 3, 3, 3, {x0: -1.5 * PITCH, y0: 0.03, z0: -1.5 * PITCH + 0.004});
    const g = new K.Granular({material, config: {...config, dt: coupledStep(K), capacity: lattice.count, gravity: [0, 0, 0]}});
    const velocities = new Float64Array(3 * lattice.count); for (let i = 0; i < lattice.count; i++) velocities[3 * i + 1] = -1;
    g.addGrains(lattice.positions, lattice.radii, velocities);
    const radius = 0.02, ball = world.createBody({shape: {kind: 'sphere', radius}, position: [0, 0, 0], density: 1000, neverSleeps: true});
    const coupling = new K.GranularCoupling(world, g);
    coupling.addBody(ball, {shape: {kind: 'sphere', radius}});
    const before = coupling.diagnostics().momentum, grains0 = g.linearMomentum();
    let impulse = [0, 0, 0];
    for (let i = 0; i < Math.round(seconds * HZ); i++) { coupling.step(); const f = coupling.force(ball); for (let k = 0; k < 3; k++) impulse[k] += f[k] * DT; world.step(); }
    const after = coupling.diagnostics().momentum, grains1 = g.linearMomentum(), s = world.getState(ball);
    const exchanged = Math.hypot(...impulse);
    return {change: Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) / exchanged, exchanged, bodySpeed: Math.hypot(...s.linearVelocity),
      // The grains' own momentum change against minus the impulse the coupling handed over: both float64.
      grainSide: Math.hypot(grains1[0] - grains0[0] + impulse[0], grains1[1] - grains0[1] + impulse[1], grains1[2] - grains0[2] + impulse[2]) / exchanged};
  } finally { world.dispose(); }
}

/** The same collision inside the solver alone, the sphere a dynamic wall: total momentum change over the momentum exchanged. */
export function freeCollisionSolver(K, {seconds = 0.12} = {}) {
  const {material, config} = COUPLED, lattice = beadLattice(K, 3, 3, 3, {x0: -1.5 * PITCH, y0: 0.03, z0: -1.5 * PITCH + 0.004});
  const g = new K.Granular({material, config: {...config, dt: coupledStep(K), capacity: lattice.count, gravity: [0, 0, 0]}});
  const velocities = new Float64Array(3 * lattice.count); for (let i = 0; i < lattice.count; i++) velocities[3 * i + 1] = -1;
  g.addGrains(lattice.positions, lattice.radii, velocities);
  const mass = 1000 * 4 / 3 * Math.PI * (0.02 * 0.02 * 0.02), ball = g.addWall({shape: {kind: 'sphere', radius: 0.02}, type: 'dynamic', mass});
  const total = () => { const p = g.linearMomentum(), v = g.wallLinearVelocity(ball); return [p[0] + mass * v[0], p[1] + mass * v[1], p[2] + mass * v[2]]; };
  const before = total(); g.step(Math.round(seconds / g.dt)); const after = total(), exchanged = Math.hypot(...g.wallImpulse(ball));
  return {change: Math.hypot(after[0] - before[0], after[1] - before[1], after[2] - before[2]) / exchanged, exchanged, balance: g.energyBalance()};
}

/**
 * A scale: a tray on a spring (a prismatic joint with a spring, as in the cloth scale) under a box of beads whose side
 * walls are frictionless and fixed, so the whole weight rests on the tray. The extra sag over the tray alone reads the load.
 */
export async function scale(K, {n = [8, 4, 8], seconds = 2.5} = {}) {
  const {material, config} = COUPLED, w = n[0] * PITCH, d = n[2] * PITCH, half = [0.6 * w, 0.01, 0.6 * d];
  const run = async withGrains => {
    const world = await newWorld(K);
    try {
      const axis = K.axisRotation([0, 1, 0], 'x'), tray = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [w / 2, -half[1], d / 2], density: 1000, neverSleeps: true});
      world.createJoint({type: 'prismatic', bodyA: null, bodyB: tray, frameA: {position: [w / 2, -half[1], d / 2], rotation: axis}, frameB: {rotation: axis}, spring: {hertz: 3, dampingRatio: 1, target: 0}});
      let g = null, coupling = null;
      if (withGrains) {
        const lattice = beadLattice(K, ...n, {y0: 0.002});
        g = new K.Granular({material, config: {...config, dt: coupledStep(K), capacity: lattice.count}});
        for (const [normal, position] of [[[1, 0, 0], [0, 0, 0]], [[-1, 0, 0], [w, 0, 0]], [[0, 0, 1], [0, 0, 0]], [[0, 0, -1], [0, 0, d]]]) g.addWall({shape: {kind: 'plane', normal}, position, friction: 0, rollingFriction: 0});
        g.addGrains(lattice.positions, lattice.radii);
        coupling = new K.GranularCoupling(world, g);
        coupling.addBody(tray, {shape: {kind: 'box', halfExtents: half}});
      }
      const steps = Math.round(seconds * HZ), window = HZ / 2;
      for (let i = 0; i < steps - window; i++) { coupling?.step(); world.step(); }
      let y = 0, force = 0;
      for (let i = 0; i < window; i++) { coupling?.step(); world.step(); y += world.getState(tray).position[1] / window; if (coupling) force += coupling.force(tray)[1] / window; }
      return {y: y + half[1], force, mass: world.getState(tray).mass, grainMass: g ? g.mass() : 0, grains: g ? g.liveCount : 0};
    } finally { world.dispose(); }
  };
  const alone = await run(false), loaded = await run(true);
  // The spring is linear: it holds the tray's weight at the sag -alone.y.
  return {reading: alone.mass * G * (alone.y - loaded.y) / -alone.y, weight: loaded.grainMass * G, force: -loaded.force, sag: alone.y - loaded.y, grains: loaded.grains};
}

// ---------------------------------------------------------------------------------------------------
// Determinism.
// ---------------------------------------------------------------------------------------------------

function stateHash(g, world) {
  const n = g.grainCount, bits = new BigUint64Array(new Float64Array([...g.positions.subarray(0, 3 * n), ...g.velocities.subarray(0, 3 * n), ...g.angularVelocities.subarray(0, 3 * n), g.dissipatedDamping, g.dissipatedFriction]).buffer);
  let a = 0xcbf29ce484222325n; for (const b of bits) a = BigInt.asUintN(64, (a ^ b) * 0x100000001b3n);
  return world ? `${a.toString(16)}:${world.exactHash().toString(16)}` : a.toString(16);
}
/** Every bit of a short coupled run (beads, a box, a block dropped on them), as text; optionally through the Simulation loop. */
export const fingerprint = (K, {simulation = false} = {}) => blockOnBed(K, {n: [5, 4, 5], seconds: 0.5, simulation});
/** Every bit of a short run of the solver alone, with Hertz contacts, rolling resistance, a moving wall and removal at the bounds. */
export function solverFingerprint(K) {
  const material = {...BEAD, youngModulus: 5e6, restitution: 0.5, friction: 0.4, rollingFriction: 0.1}, lattice = beadLattice(K, 5, 5, 5);
  const g = new K.Granular({material, config: {dt: 0.15 * criticalTime(K, material, {}, 0.9 * R), capacity: lattice.count, bounds: {min: [-0.05, -0.05, -0.05], max: [0.2, 1, 0.2]}}});
  openBox(g, 5 * PITCH, 5 * PITCH, {sideFriction: 0.3});
  g.addWall({shape: {kind: 'sphere', radius: 0.012}, type: 'kinematic', position: [2.5 * PITCH, 0.12, 2.5 * PITCH], linearVelocity: [0.05, -0.5, 0], angularVelocity: [0, 3, 0]});
  g.addGrains(lattice.positions, lattice.radii);
  g.step(3000);
  return {hash: stateHash(g, null), contacts: g.stats.contacts, rebuilds: g.stats.rebuilds, removed: g.stats.removed};
}
