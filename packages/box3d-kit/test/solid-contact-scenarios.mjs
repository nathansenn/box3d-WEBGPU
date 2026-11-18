// Set-ups of the solid-contact validation, shared by test/v17-solid-contact.test.mjs (which asserts on them) and
// validation/domains/solid-contact.mjs (which reports them). Each function builds a problem with a closed-form
// answer, runs the real solver and returns the measured numbers beside the reference. SI units.
// `K` is the kit: {SolidBody, boxMesh, SolidContact, SolidCoupling, solidContactSubsystem, createWorld, createSimulation}.
// Nothing here measures wall-clock time.
import {createHash} from 'node:crypto';

export const G = 9.81, HZ = 240, DT = 1 / HZ, SUB = 4;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const newWorld = (K, options = {}) => K.createWorld({step: DT, subSteps: SUB, ground: false, ...options});
const meanY = (solid, nodes) => { let s = 0; for (const n of nodes) s += solid.displacements[3 * n + 1]; return s / nodes.length; };
/** Rollers on x = 0, y = 0 and z = 0: no rigid motion, free Poisson contraction, so a load along y is uniaxial stress. */
function rollers(solid) {
  solid.constrain(solid.selectNodes((x, y) => near(y, 0)), [null, 0, null]);
  solid.constrain(solid.selectNodes(x => near(x, 0)), [0, null, null]);
  solid.constrain(solid.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]);
}
/** Frequency of a signal from its upward crossings of its own mean, with linear interpolation. */
export function frequency(samples, dt) {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length, crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] < mean && samples[i] >= mean) crossings.push(i - 1 + (mean - samples[i - 1]) / (samples[i] - samples[i - 1]));
  return (crossings.length - 1) / ((crossings.at(-1) - crossings[0]) * dt);
}

// ---------------------------------------------------------------------------------------------------
// A rigid block on an elastic pad.
// ---------------------------------------------------------------------------------------------------

/** Statics. `mode` 'stress': the pad's sides are free, so it is in uniaxial stress and shortens by m g L / (E A).
 * 'strain': every node is held sideways, so it is in uniaxial strain and shortens by m g L / ((lambda + 2 mu) A). */
export function padStatic(K, {mode = 'stress', model = 'linear', mass = 10, cells = [4, 2, 4], stiffnessScale} = {}) {
  const L = 0.05, W = 0.2, E = 1e6, nu = 0.3;
  const solid = new K.SolidBody({mesh: K.boxMesh({size: [W, L, W], cells}), material: {youngModulus: E, poissonRatio: nu, density: 1000}, config: {model, dt: DT}});
  if (mode === 'stress') rollers(solid);
  else { solid.constrain(solid.selectNodes((x, y) => near(y, 0)), [null, 0, null]); solid.constrain(solid.selectNodes(() => true), [0, null, 0]); }
  const contact = new K.SolidContact(solid, {gravity: [0, -G, 0], stiffnessScale});
  const body = contact.addBody({shape: {kind: 'box', halfExtents: [0.3, 0.05, 0.3]}, type: 'dynamic', mass, position: [W / 2, L + 0.05, W / 2], rotation: [0, 0, 0, 1], inertia: {kind: 'locked'}});
  const result = contact.solveStatic(), top = solid.selectNodes((x, y) => near(y, L));
  const modulus = mode === 'stress' ? E : E * (1 - nu) / ((1 + nu) * (1 - 2 * nu)), exact = mass * G * L / (modulus * W * W);
  const stress = solid.stresses(); let worstStress = 0;
  for (let e = 0; e < solid.tetCount; e++) worstStress = Math.max(worstStress, Math.abs(stress[6 * e + 1] / (-mass * G / (W * W)) - 1));
  const depth = contact.maxPenetration(), expectedDepth = mass * G / (W * W) * contact.elementSize / (contact.stiffnessScale * (solid.lambda + 2 * solid.mu));
  return {converged: result.converged, passes: result.passes, shortening: -meanY(solid, top), exact, error: -meanY(solid, top) / exact - 1, worstStress,
    force: contact.bodyForce(body)[1], weight: mass * G, bodyDrop: L + 0.05 - contact.bodyPosition(body)[1], depth, expectedDepth, contacts: contact.stats.contacts, nodes: top.length,
    wrongModulus: mode === 'stress' ? exact * E / (E * (1 - nu) / ((1 + nu) * (1 - 2 * nu))) : exact * (E * (1 - nu) / ((1 + nu) * (1 - 2 * nu))) / E};
}

/** The same pad under a rigid box of the rigid world, through the stepping loop: the box settles on it. */
export async function padWorld(K, {seconds = 2, scheme = 'implicit', loop = true} = {}) {
  const L = 0.05, W = 0.2, E = 1e6, nu = 0.3, half = [0.15, 0.05, 0.15], density = 800;
  const world = await newWorld(K);
  try {
    const solid = new K.SolidBody({mesh: K.boxMesh({size: [W, L, W], cells: [4, 2, 4]}), material: {youngModulus: E, poissonRatio: nu, density: 1000}, config: {model: 'linear', dt: DT, massDamping: 5}});
    rollers(solid);
    const box = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [W / 2, L + half[1], W / 2], density, neverSleeps: true, lockRotation: true, linearDamping: 4});
    const coupling = new K.SolidCoupling(world, solid, {scheme});
    coupling.addBody(box, {shape: {kind: 'box', halfExtents: half}, inertia: {kind: 'locked'}});
    const sim = K.createSimulation(world), events = [];
    sim.add(K.solidContactSubsystem(coupling));
    sim.onEvent(event => { if (event.source === 'solid-contact') events.push(`${event.tick}:${event.type}`); });
    const steps = Math.round(seconds * HZ), top = solid.selectNodes((x, y) => near(y, L));
    let worstBalanceRise = 0, last = null;
    for (let i = 0; i < steps; i++) {
      if (loop) sim.step(); else { coupling.step(); world.step(); }
      if (loop && i % 8 === 0) { const e = sim.energy().entries.find(entry => entry.id === 'solid-contact'); if (last !== null) worstBalanceRise = Math.max(worstBalanceRise, e.balance - last); last = e.balance; }
    }
    const state = world.getState(box), mass = state.mass, exact = mass * G * L / (E * W * W), entry = sim.energy().entries.find(e => e.id === 'solid-contact');
    return {mass, shortening: -meanY(solid, top), exact, error: -meanY(solid, top) / exact - 1, force: coupling.force(box)[1], weight: mass * G,
      bodyDrop: L + half[1] - state.position[1], speed: Math.hypot(...state.linearVelocity), depth: coupling.contact.maxPenetration(), events, entry, worstBalanceRise,
      order: sim.order().map(row => row.id), unconverged: coupling.contact.stats.unconvergedSteps, hash: world.exactHash(), bits: sha(solid.displacements, solid.velocities)};
  } finally { world.dispose(); }
}
const sha = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };

// ---------------------------------------------------------------------------------------------------
// Hertz: a rigid sphere pressed into an elastic block.
// ---------------------------------------------------------------------------------------------------

/** Force factor of a layer of thickness t bonded to a rigid base under a rigid sphere, against the half space
 * (Dimitriadis, Horkay, Maresca, Kachar and Chadwick, Biophys. J. 82, 2002), chi = sqrt(R delta) / t. */
export function bondedLayerFactor(chi, nu) {
  const a = -(1.2876 - 1.4678 * nu + 1.3442 * nu * nu) / (1 - nu), b = (0.6387 - 1.0277 * nu + 1.5164 * nu * nu) / (1 - nu), pi = Math.PI;
  return 1 - 2 * a / pi * chi + 4 * a * a / pi ** 2 * chi ** 2 - 8 / pi ** 3 * (a ** 3 + 4 * pi ** 2 / 15 * b) * chi ** 3 + 16 * a / pi ** 4 * (a ** 3 + 3 * pi ** 2 / 5 * b) * chi ** 4;
}
/** `m` equal cells over [0, fine], then n - m cells that grow geometrically to W. */
function graded(n, m, fine, W) {
  const h = fine / m, rest = n - m; let lo = 1, hi = 10;
  for (let k = 0; k < 200; k++) { const r = 0.5 * (lo + hi); let s = 0, c = h; for (let i = 0; i < rest; i++) { c *= r; s += c; } if (s > W - fine) hi = r; else lo = r; }
  const x = [0]; let c = h; for (let i = 1; i <= n; i++) { if (i > m) c *= lo; x.push(i <= m ? i * h : x[i - 1] + c); } x[n] = W; return x;
}
/** A quarter of a block of side 2 W and depth W (symmetry planes x = 0 and z = 0, base held), a rigid sphere of radius R
 * pressed `delta` into its top at the corner. Reference: F = (4/3) E* sqrt(R) delta^1.5 with E* = E / (1 - nu^2). */
export function hertz(K, n, m, {fine = 0.04, W = 0.5, R = 1, delta = 0.000625, E = 1e6, nu = 0.3, stiffnessScale = 1000} = {}) {
  const mesh = K.boxMesh({size: [n, n, n], cells: [n, n, n]}), x = graded(n, m, fine, W), p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) { p[i] = x[Math.round(p[i])]; p[i + 2] = x[Math.round(p[i + 2])]; p[i + 1] = W - x[n - Math.round(p[i + 1])]; }
  const solid = new K.SolidBody({mesh, material: {youngModulus: E, poissonRatio: nu, density: 1000}, config: {model: 'linear', dt: DT, tolerance: 1e-9}});
  solid.constrain(solid.selectNodes((px, py) => near(py, 0)), [0, 0, 0]);
  solid.constrain(solid.selectNodes(px => near(px, 0)), [0, null, null]);
  solid.constrain(solid.selectNodes((px, py, pz) => near(pz, 0)), [null, null, 0]);
  const contact = new K.SolidContact(solid, {stiffnessScale});
  const sphere = contact.addBody({shape: {kind: 'sphere', radius: R}, type: 'static', position: [0, W + R - delta, 0], rotation: [0, 0, 0, 1]});
  const result = contact.solveStatic({tolerance: 1e-7});
  const force = 4 * contact.bodyForce(sphere)[1], modulus = E / (1 - nu * nu), exact = 4 / 3 * modulus * Math.sqrt(R) * delta ** 1.5, a = Math.sqrt(R * delta), layer = bondedLayerFactor(a / W, nu);
  return {n, m, nodes: solid.nodeCount, converged: result.converged, force, exact, error: force / exact - 1, layer, errorLayer: force / (exact * layer) - 1,
    contacts: contact.stats.contacts, radius: a, cellsPerRadius: a / (fine / m), depth: contact.maxPenetration(), delta};
}
/** Least-squares slope of ln F against ln delta. */
export function hertzExponent(K, n, m, deltas, options = {}) {
  const runs = deltas.map(delta => hertz(K, n, m, {...options, delta})), xs = deltas.map(Math.log), ys = runs.map(r => Math.log(r.force)), ysLayer = runs.map(r => Math.log(r.force / r.layer));
  const fit = y => { const mx = xs.reduce((s, v) => s + v, 0) / xs.length, my = y.reduce((s, v) => s + v, 0) / y.length; return xs.reduce((s, v, i) => s + (v - mx) * (y[i] - my), 0) / xs.reduce((s, v) => s + (v - mx) ** 2, 0); };
  return {runs, exponent: fit(ys), exponentLayer: fit(ysLayer)};
}

// ---------------------------------------------------------------------------------------------------
// Friction: a rigid block on a deformable incline.
// ---------------------------------------------------------------------------------------------------

/** A slab tilted by `degrees` about z with its base held, a rigid box on it with Coulomb coefficient mu. Below
 * tan(theta) = mu the box must stay; above it must slide at g (sin theta - mu cos theta). */
export async function incline(K, degrees, {mu = 0.5, seconds = 1, cells = [16, 2, 2]} = {}) {
  const theta = degrees * Math.PI / 180, c = Math.cos(theta), s = Math.sin(theta), Lx = 1.0, T = 0.05, Wz = 0.2, half = [0.1, 0.05, 0.1];
  const world = await newWorld(K);
  try {
    const mesh = K.boxMesh({size: [Lx, T, Wz], cells}), p = mesh.positions;
    // Rotate about z: the slab's long axis x' = (c, s, 0) points up the slope, its normal is (-s, c, 0).
    for (let i = 0; i < p.length; i += 3) { const x = p[i], y = p[i + 1]; p[i] = c * x - s * y; p[i + 1] = s * x + c * y; }
    const solid = new K.SolidBody({mesh, material: {youngModulus: 2e6, poissonRatio: 0.3, density: 1000}, config: {model: 'linear', dt: DT}});
    // The base is the face that was y = 0 before the rotation: points with -s x + c y = 0.
    solid.constrain(solid.selectNodes((x, y) => near(-s * x + c * y, 0)), [0, 0, 0]);
    const along = 0.8, centre = [c * along - s * (T + half[1]), s * along + c * (T + half[1]), Wz / 2];
    const box = world.createBody({shape: {kind: 'box', halfExtents: half}, position: centre, rotation: [0, 0, Math.sin(theta / 2), Math.cos(theta / 2)], density: 500, neverSleeps: true});
    const coupling = new K.SolidCoupling(world, solid);
    coupling.addBody(box, {shape: {kind: 'box', halfExtents: half}, friction: mu});
    const steps = Math.round(seconds * HZ), samples = [], settle = Math.round(0.25 * HZ);
    for (let i = 0; i < steps; i++) {
      coupling.step(); world.step();
      const x = world.getState(box).position; samples.push((x[0] - centre[0]) * c + (x[1] - centre[1]) * s);
    }
    // Acceleration from a least-squares parabola through the travel after the box has settled on the slab.
    const ts = [], ys = []; for (let i = settle; i < steps; i++) { ts.push((i - settle) * DT); ys.push(samples[i]); }
    const acceleration = 2 * quadratic(ts, ys), state = world.getState(box), normal = [-s, c, 0];
    const F = coupling.force(box), normalForce = F[0] * normal[0] + F[1] * normal[1], tangential = F[0] * c + F[1] * s;
    return {degrees, mu, travel: samples.at(-1), travelAfterSettling: samples.at(-1) - samples[settle], acceleration, expected: -G * (s - mu * c), tanTheta: Math.tan(theta),
      normalForce, tangential, ratio: Math.abs(tangential / normalForce), weightNormal: state.mass * G * c, speed: Math.hypot(...state.linearVelocity), contacts: coupling.contact.stats.contacts,
      unconverged: coupling.contact.stats.unconvergedSteps, frictionPasses: coupling.contact.stats.frictionPasses};
  } finally { world.dispose(); }
}
/** Coefficient a of the least-squares fit y = a t^2 + b t + c. */
function quadratic(t, y) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, r0 = 0, r1 = 0, r2 = 0;
  for (let i = 0; i < t.length; i++) { const a = t[i], b = a * a; s0++; s1 += a; s2 += b; s3 += a * b; s4 += b * b; r0 += y[i]; r1 += a * y[i]; r2 += b * y[i]; }
  const det = s4 * (s2 * s0 - s1 * s1) - s3 * (s3 * s0 - s1 * s2) + s2 * (s3 * s1 - s2 * s2);
  return (r2 * (s2 * s0 - s1 * s1) - s3 * (r1 * s0 - r0 * s1) + s2 * (r1 * s1 - r0 * s2)) / det;
}

// ---------------------------------------------------------------------------------------------------
// A mass on an elastic column.
// ---------------------------------------------------------------------------------------------------

/** First root of x tan x = ratio: a uniform bar held at one end with a point mass M at the other swings at
 * omega = x c / L, where ratio = (bar mass) / M and c = sqrt(E / rho). */
export function barWithTipMass(ratio) {
  let lo = 0, hi = Math.PI / 2 - 1e-12;
  for (let k = 0; k < 200; k++) { const x = 0.5 * (lo + hi); if (x * Math.tan(x) > ratio) hi = x; else lo = x; }
  return 0.5 * (lo + hi);
}
/** A rigid block resting on a column (rollers at its base and on two sides, so it is a one-dimensional bar), set
 * swinging by a small downward velocity. `welded` fixes the block to the top nodes instead of resting it there. */
export async function column(K, {cells = 8, seconds = 2.5, welded = false, hz = HZ, mass = 2} = {}) {
  const L = 0.5, W = 0.05, E = 2e5, rho = 1000, half = [0.05, 0.05, 0.05], dt = 1 / hz;
  const world = await K.createWorld({step: dt, subSteps: SUB, ground: false});
  try {
    const solid = new K.SolidBody({mesh: K.boxMesh({size: [W, L, W], cells: [1, cells, 1]}), material: {youngModulus: E, poissonRatio: 0.3, density: rho}, config: {model: 'linear', dt, gravity: [0, -G, 0]}});
    rollers(solid);
    const volume = 8 * half[0] * half[1] * half[2], top = solid.selectNodes((x, y) => near(y, L)), k = E * W * W / L, columnMass = rho * W * W * L;
    // Start from the static shape under the block and the column's own weight, so that only the kick moves it.
    const settle = new K.SolidContact(solid, {gravity: [0, -G, 0]});
    const own = settle.addBody({shape: {kind: 'box', halfExtents: half}, type: 'dynamic', mass, position: [W / 2, L + half[1], W / 2], rotation: [0, 0, 0, 1], inertia: {kind: 'locked'}});
    settle.solveStatic();
    const start = settle.bodyPosition(own), speed = 0.05, rest = meanY(solid, top);
    const box = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [start[0], start[1], start[2]], density: mass / volume, neverSleeps: true, lockRotation: true, linearVelocity: [0, -speed, 0]});
    const u = solid.displacements, v = Float64Array.from(solid.velocities);
    // The column's nodes move with the block in the first mode: give them the matching share of the kick.
    for (let n = 0; n < solid.nodeCount; n++) v[3 * n + 1] = -speed * solid.referencePositions[3 * n + 1] / L;
    solid.setState(u, v);
    const coupling = new K.SolidCoupling(world, solid);
    coupling.addBody(box, {shape: {kind: 'box', halfExtents: half}, inertia: {kind: 'locked'}});
    if (welded) coupling.weld(top, box);
    const steps = Math.round(seconds * hz), samples = [];
    let leastContacts = Infinity;
    for (let i = 0; i < steps; i++) { coupling.step(); world.step(); samples.push(meanY(solid, top)); leastContacts = Math.min(leastContacts, coupling.contact.stats.contacts); }
    const bodyMass = world.getState(box).mass, ratio = columnMass / bodyMass, c = Math.sqrt(E / rho), omega = barWithTipMass(ratio) * c / L;
    const measured = frequency(samples, dt), exact = omega / (2 * Math.PI), rayleigh = Math.sqrt(k / (bodyMass + columnMass / 3)) / (2 * Math.PI), massless = Math.sqrt(k / bodyMass) / (2 * Math.PI);
    // Backward Euler turns a mode of frequency omega by atan(omega h) per step.
    const backwardEuler = Math.atan(omega * dt) / dt / (2 * Math.PI);
    return {cells, hz, bodyMass, columnMass, measured, exact, backwardEuler, rayleigh, massless, error: measured / exact - 1, errorBackwardEuler: measured / backwardEuler - 1,
      amplitude: (Math.max(...samples.slice(0, Math.round(hz / exact))) - Math.min(...samples.slice(0, Math.round(hz / exact)))) / 2, staticShortening: -rest, leastContacts, unconverged: coupling.contact.stats.unconvergedSteps};
  } finally { world.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// A hanging weight welded to a bar.
// ---------------------------------------------------------------------------------------------------

/** A bar held at its top with a rigid block welded to its lower face: it stretches by M g L / (E A) + rho g L^2 / (2 E). */
export async function hangingWeld(K, {seconds = 2, nu = 0} = {}) {
  const L = 0.4, W = 0.05, E = 1e6, rho = 1000, half = [0.04, 0.04, 0.04];
  const world = await newWorld(K);
  try {
    const solid = new K.SolidBody({mesh: K.boxMesh({size: [W, L, W], cells: [2, 8, 2], origin: [0, -L, 0]}), material: {youngModulus: E, poissonRatio: nu, density: rho}, config: {model: 'linear', dt: DT, gravity: [0, -G, 0], massDamping: 6}});
    solid.constrain(solid.selectNodes((x, y) => near(y, 0)), [null, 0, null]);
    solid.constrain(solid.selectNodes(x => near(x, 0)), [0, null, null]);
    solid.constrain(solid.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]);
    const box = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [W / 2, -L - half[1], W / 2], density: 3000, neverSleeps: true, linearDamping: 4});
    const coupling = new K.SolidCoupling(world, solid);
    coupling.addBody(box, {shape: {kind: 'box', halfExtents: half}, collide: false});
    const bottom = solid.selectNodes((x, y) => near(y, -L));
    coupling.weld(bottom, box);
    for (let i = 0; i < Math.round(seconds * HZ); i++) { coupling.step(); world.step(); }
    const state = world.getState(box), mass = state.mass, exact = mass * G * L / (E * W * W) + rho * G * L * L / (2 * E), stretch = -meanY(solid, bottom);
    const reactions = solid.reactions(); let support = 0; for (let n = 0; n < solid.nodeCount; n++) support += reactions[3 * n + 1];
    return {mass, stretch, exact, error: stretch / exact - 1, force: coupling.force(box)[1], weight: mass * G, torque: Math.hypot(...coupling.torque(box)), support, totalWeight: (mass + solid.mass) * G,
      bodyDrop: -L - half[1] - state.position[1], tilt: Math.hypot(state.rotation[0], state.rotation[1], state.rotation[2]), speed: Math.hypot(...state.linearVelocity), unconverged: coupling.contact.stats.unconvergedSteps};
  } finally { world.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// Momentum in a free impact.
// ---------------------------------------------------------------------------------------------------

/** A rigid sphere thrown at a free elastic block, no gravity, with this object's own bodies (float64 throughout).
 * Linear momentum of the block plus the sphere must stay what it was. */
export function impact(K, {steps = 240, friction = 0.4} = {}) {
  const solid = new K.SolidBody({mesh: K.boxMesh({size: [0.2, 0.2, 0.2], cells: [4, 4, 4]}), material: {youngModulus: 5e5, poissonRatio: 0.3, density: 1000}, config: {model: 'corotational', dt: DT, tolerance: 1e-12}});
  const contact = new K.SolidContact(solid, {gravity: [0, 0, 0]});
  const radius = 0.05, mass = 3, speed = [-2, -0.4, 0.3];
  const ball = contact.addBody({shape: {kind: 'sphere', radius}, type: 'dynamic', mass, friction, position: [0.2 + radius + 0.02, 0.13, 0.08], rotation: [0, 0, 0, 1], linearVelocity: speed});
  const before = Array.from(contact.linearMomentum()), scale = mass * Math.hypot(...speed); let worst = 0, touched = 0, largestForce = 0;
  for (let i = 0; i < steps; i++) {
    contact.step();
    const p = contact.linearMomentum(); worst = Math.max(worst, Math.hypot(p[0] - before[0], p[1] - before[1], p[2] - before[2]) / scale);
    if (contact.bodyContacts(ball) > 0) touched++;
    largestForce = Math.max(largestForce, Math.hypot(...contact.bodyForce(ball)));
  }
  const v = contact.bodyVelocity(ball); let blockMomentum = [0, 0, 0];
  for (let n = 0; n < solid.nodeCount; n++) for (let q = 0; q < 3; q++) blockMomentum[q] += solid.nodalMass[n] * solid.velocities[3 * n + q];
  return {worst, touched, largestForce, ballVelocity: Array.from(v), blockVelocity: blockMomentum.map(p => p / solid.mass), before, unconverged: contact.stats.unconvergedSteps, energyLeft: (solid.kineticEnergy() + 0.5 * mass * (v[0] ** 2 + v[1] ** 2 + v[2] ** 2)) / (0.5 * mass * (speed[0] ** 2 + speed[1] ** 2 + speed[2] ** 2))};
}
/** The same throw through the rigid world (float32 bodies): momentum of block plus ball. */
export async function impactWorld(K, {steps = 240} = {}) {
  const world = await newWorld(K, {gravity: [0, 0, 0]});
  try {
    const solid = new K.SolidBody({mesh: K.boxMesh({size: [0.2, 0.2, 0.2], cells: [4, 4, 4]}), material: {youngModulus: 5e5, poissonRatio: 0.3, density: 1000}, config: {model: 'corotational', dt: DT, tolerance: 1e-12}});
    const radius = 0.05, speed = [-2, -0.4, 0.3];
    const ball = world.createBody({shape: {kind: 'sphere', radius}, position: [0.2 + radius + 0.02, 0.13, 0.08], density: 3 / (4 / 3 * Math.PI * radius ** 3), linearVelocity: speed, neverSleeps: true});
    const coupling = new K.SolidCoupling(world, solid);
    coupling.addBody(ball, {shape: {kind: 'sphere', radius}, friction: 0.4});
    const before = coupling.diagnostics().momentum.slice(), scale = Math.hypot(...before); let worst = 0, touched = 0;
    for (let i = 0; i < steps; i++) {
      coupling.step(); world.step();
      const p = coupling.diagnostics().momentum; worst = Math.max(worst, Math.hypot(p[0] - before[0], p[1] - before[1], p[2] - before[2]) / scale);
      if (coupling.contact.bodyContacts(0) > 0) touched++;
    }
    return {worst, touched, ballVelocity: Array.from(world.getState(ball).linearVelocity), gravity: Array.from(world.gravity())};
  } finally { world.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// Stability: mass ratios, and the naive scheme.
// ---------------------------------------------------------------------------------------------------

/** A rigid box set down on a pad through the rigid world. Returns how far it is from its static place at the end,
 * the largest speed it reached and whether the run stayed finite. */
export async function resting(K, {E, density, scheme = 'implicit', seconds = 1, hz = HZ} = {}) {
  const L = 0.05, W = 0.2, half = [0.1, 0.05, 0.1], dt = 1 / hz;
  const world = await K.createWorld({step: dt, subSteps: SUB, ground: false});
  try {
    const solid = new K.SolidBody({mesh: K.boxMesh({size: [W, L, W], cells: [4, 2, 4]}), material: {youngModulus: E, poissonRatio: 0.3, density: 1000}, config: {model: 'linear', dt}});
    solid.constrain(solid.selectNodes((x, y) => near(y, 0)), [0, 0, 0]);
    const box = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [W / 2, L + half[1], W / 2], density, neverSleeps: true});
    const coupling = new K.SolidCoupling(world, solid, {scheme});
    coupling.addBody(box, {shape: {kind: 'box', halfExtents: half}});
    const mass = world.getState(box).mass, steps = Math.round(seconds * hz); let largestSpeed = 0, largestRise = 0, failed = null, ran = 0, largestForce = 0;
    try {
      for (let i = 0; i < steps; i++) {
        coupling.step(); world.step(); ran++;
        const s = world.getState(box); largestSpeed = Math.max(largestSpeed, Math.hypot(...s.linearVelocity)); largestRise = Math.max(largestRise, s.position[1] - (L + half[1]));
        largestForce = Math.max(largestForce, Math.abs(coupling.force(box)[1]));
        if (!Number.isFinite(largestSpeed)) { failed = 'nonfinite'; break; }
        // Thrown off at more than 20 m/s from rest: stop here, the rigid solver only reports itself unstable from now on.
        if (largestSpeed > 20) { failed = 'thrown-off'; break; }
      }
    } catch (error) { failed = error.code ?? error.message; }
    const s = world.getState(box);
    return {mass, solidMass: solid.mass, massRatio: mass / solid.mass, stiffness: E * W * W / L, stepNumber: E * W * W / L * dt * dt / mass, ran, failed, largestSpeed, largestRise,
      largestForceOverWeight: largestForce / (mass * G), force: coupling.force(box)[1], weight: mass * G, sink: L + half[1] - s.position[1], speed: Math.hypot(...s.linearVelocity), unconverged: coupling.contact.stats.unconvergedSteps};
  } finally { world.dispose(); }
}

/** A soft block resting on a dynamic rigid box that itself rests on static rigid ground. The coupling sees the ground
 * only through the estimate of the box's supports; without it the solid expects the box to fall away. */
export async function supported(K, {estimateSupports = true, seconds = 1.5} = {}) {
  const W = 0.2, H = 0.1, half = [0.2, 0.05, 0.2];
  const world = await newWorld(K);
  try {
    world.createBody({shape: {kind: 'box', halfExtents: [1, 0.1, 1]}, type: 'static', position: [0, -0.1, 0]});
    const box = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [0, half[1], 0], density: 400, neverSleeps: true});
    const solid = new K.SolidBody({mesh: K.boxMesh({size: [W, H, W], cells: [4, 2, 4], origin: [-W / 2, 2 * half[1], -W / 2]}), material: {youngModulus: 2e5, poissonRatio: 0.3, density: 1000}, config: {model: 'linear', dt: DT, gravity: [0, -G, 0], massDamping: 6}});
    const coupling = new K.SolidCoupling(world, solid, {estimateSupports});
    coupling.addBody(box, {shape: {kind: 'box', halfExtents: half}, friction: 0.5});
    for (let i = 0; i < Math.round(seconds * HZ); i++) { coupling.step(); world.step(); }
    const s = world.getState(box), weight = solid.mass * G, expectedDepth = weight / (W * W) * coupling.contact.elementSize / (coupling.contact.stiffnessScale * (solid.lambda + 2 * solid.mu));
    return {force: coupling.force(box)[1], weight, error: -coupling.force(box)[1] / weight - 1, depth: coupling.contact.maxPenetration(), expectedDepth, fall: (SUB + 1) / (2 * SUB) * G * DT * DT,
      boxHeight: s.position[1], boxSpeed: Math.hypot(...s.linearVelocity), solidSpeed: Math.sqrt(2 * solid.kineticEnergy() / solid.mass)};
  } finally { world.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// The other shapes: a ground plane and a capsule.
// ---------------------------------------------------------------------------------------------------

/** A free elastic cube set on a fixed plane (nothing else holds it), and a capsule lying on a pad. Statics. */
export function planeAndCapsule(K) {
  const side = 0.1, cube = new K.SolidBody({mesh: K.boxMesh({size: [side, side, side], cells: [4, 4, 4]}), material: {youngModulus: 1e5, poissonRatio: 0, density: 1000}, config: {model: 'linear', dt: DT, gravity: [0, -G, 0]}});
  const onPlane = new K.SolidContact(cube), ground = onPlane.addBody({shape: {kind: 'plane', normal: [0, 1, 0]}, type: 'static', position: [0, 0, 0], rotation: [0, 0, 0, 1]});
  const settled = onPlane.solveStatic(), bottom = cube.selectNodes((x, y) => near(y, 0)), top = cube.selectNodes((x, y) => near(y, side));
  let lowest = Infinity; for (const n of bottom) lowest = Math.min(lowest, cube.displacements[3 * n + 1]);
  // With nu = 0 a cube under its own weight on a frictionless plane is a bar standing on its end and shortens by
  // rho g L^2 / (2 E). (With nu = 0.3 the exact self-weight solution warps the cross-sections, the flat plane does not
  // let the base follow, and the shortening is 2.0 % less on this mesh.)
  const weight = cube.mass * G, force = onPlane.bodyForce(ground);

  const L = 0.4, W = 0.2, T = 0.05, pad = new K.SolidBody({mesh: K.boxMesh({size: [L, T, W], cells: [8, 2, 8]}), material: {youngModulus: 1e6, poissonRatio: 0.3, density: 1000}, config: {model: 'linear', dt: DT}});
  pad.constrain(pad.selectNodes((x, y) => near(y, 0)), [0, 0, 0]);
  const onPad = new K.SolidContact(pad, {gravity: [0, -G, 0]}), radius = 0.05, halfLength = 0.1, mass = 2, s = Math.SQRT1_2;
  // The capsule's axis is its local y; turned 90 degrees about z it lies along x.
  const capsule = onPad.addBody({shape: {kind: 'capsule', radius, halfLength}, type: 'dynamic', mass, position: [L / 2, T + radius, W / 2], rotation: [0, 0, s, s]});
  const rested = onPad.solveStatic(), F = onPad.bodyForce(capsule), x = onPad.bodyPosition(capsule);
  // Only nodes are tested, so a cylinder cannot balance on one row of them: it rolls until two rows carry it. The
  // nodes that carry it then lie within one node spacing of its axis and between its ends.
  let widest = 0, longest = 0, carrying = 0;
  for (const n of pad.selectNodes((px, py) => near(py, T))) { if (Math.abs(onPad.nodeForce[3 * n + 1]) > 1e-9 * mass * G) { carrying++; widest = Math.max(widest, Math.abs(pad.referencePositions[3 * n + 2] - x[2])); longest = Math.max(longest, Math.abs(pad.referencePositions[3 * n] - x[0])); } }
  return {plane: {converged: settled.converged, force: force[1], weight, sideways: Math.hypot(force[0], force[2]), contacts: onPlane.stats.contacts, bottomNodes: bottom.length, sink: -lowest, depth: onPlane.maxPenetration(),
      shortening: -(meanY(cube, top) - meanY(cube, bottom)), exactShortening: 1000 * G * side * side / (2 * 1e5)},
    capsule: {converged: rested.converged, force: F[1], weight: mass * G, sideways: Math.hypot(F[0], F[2]), torque: Math.hypot(...onPad.bodyTorque(capsule)), carrying, widest, longest, sink: T + radius - x[1], reach: halfLength + radius, spacing: W / 8, rolled: Math.abs(x[2] - W / 2), chordDrop: radius - Math.sqrt(radius * radius - (W / 16) ** 2)}};
}
