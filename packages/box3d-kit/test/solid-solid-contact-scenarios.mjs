// Set-ups of the deformable-against-deformable contact validation, shared by test/v22-solid-solid-contact.test.mjs
// (which asserts on them) and validation/domains/solid-contact.mjs (which reports them). Each builds a problem with a
// closed-form answer, runs the real solver and returns the measured numbers beside the reference. SI units.
// `K` is the kit: {SolidBody, boxMesh, SolidSolidContact, solidSolidContactSubsystem, createSimulation, createWorld}.
import {createHash} from 'node:crypto';
import {bondedLayerFactor} from './solid-contact-scenarios.mjs';

export const G = 9.81;
const near = (a, b) => Math.abs(a - b) < 1e-9;
const sha = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };

// ---------------------------------------------------------------------------------------------------
// Two elastic blocks pressed together: springs in series.
// ---------------------------------------------------------------------------------------------------

/** Block A (0.1 x L1 x 0.1 m, E1) on rollers with block B (0.1 x L2 x 0.1 m, E2) on top of it, B's top pushed down by
 * `delta`; rollers on x = 0 and z = 0 of both, no friction, so both are in uniaxial stress whatever their Poisson's
 * ratios: F = delta A / (L1 / E1 + L2 / E2 + c), c the compliance of the contact springs per unit area. Each search
 * direction gives a layer of springs of stiffness stiffnessScale min(M_i / l_i) per unit area (M = lambda + 2 mu, l the
 * mean element size), and the two layers act side by side. */
export function seriesBlocks(K, {cellsA = [3, 3, 3], cellsB = [4, 4, 4], E1 = 1e9, E2 = 3e9, nu1 = 0.3, nu2 = 0.2, L1 = 0.1, L2 = 0.08, delta = 1e-5, model = 'linear', stiffnessScale = 100, method} = {}) {
  const a = 0.1, config = {model, tolerance: 1e-12};
  const A = new K.SolidBody({mesh: K.boxMesh({size: [a, L1, a], cells: cellsA}), material: {youngModulus: E1, poissonRatio: nu1, density: 1000}, config});
  const B = new K.SolidBody({mesh: K.boxMesh({size: [a, L2, a], cells: cellsB, origin: [0, L1, 0]}), material: {youngModulus: E2, poissonRatio: nu2, density: 1000}, config});
  for (const b of [A, B]) { b.constrain(b.selectNodes(x => near(x, 0)), [0, null, null]); b.constrain(b.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]); }
  A.constrain(A.selectNodes((x, y) => near(y, 0)), [null, 0, null]);
  B.constrain(B.selectNodes((x, y) => near(y, L1 + L2)), [null, -delta, null]);
  const contact = new K.SolidSolidContact([A, B], {stiffnessScale, method}), result = contact.solveStatic();
  const force = -contact.contactForce(0, 1)[1], back = contact.contactForce(1, 0)[1];
  const kA = stiffnessScale * (A.lambda + 2 * A.mu) / Math.cbrt(6 * A.referenceVolume / A.tetCount), kB = stiffnessScale * (B.lambda + 2 * B.mu) / Math.cbrt(6 * B.referenceVolume / B.tetCount);
  const springs = 1 / (2 * Math.min(kA, kB)), rigid = delta * a * a / (L1 / E1 + L2 / E2), exact = delta * a * a / (L1 / E1 + L2 / E2 + springs);
  // The stress of each body, element by element, against the uniform one.
  let worstStress = 0;
  for (const b of [A, B]) { const s = b.stresses(); for (let e = 0; e < b.tetCount; e++) worstStress = Math.max(worstStress, Math.abs(s[6 * e + 1] / (-exact / (a * a)) - 1)); }
  const iface = A.selectNodes((x, y) => near(y, L1)); let mean = 0; for (const n of iface) mean += A.displacements[3 * n + 1] / iface.length;
  return {converged: result.converged, passes: result.passes, force, back, exact, rigid, error: force / exact - 1, errorRigid: force / rigid - 1, worstStress, interface: mean, interfaceExact: -exact * L1 / (E1 * a * a),
    depth: contact.maxPenetration(), contacts: contact.stats.contacts, nodes: A.nodeCount + B.nodeCount};
}

// ---------------------------------------------------------------------------------------------------
// Hertz: two elastic bodies with curved faces.
// ---------------------------------------------------------------------------------------------------

/** `m` equal cells over [0, fine], then n - m cells that grow geometrically to W. */
function graded(n, m, fine, W) {
  const h = fine / m, rest = n - m; let lo = 1, hi = 10;
  for (let k = 0; k < 200; k++) { const r = 0.5 * (lo + hi); let s = 0, c = h; for (let i = 0; i < rest; i++) { c *= r; s += c; } if (s > W - fine) hi = r; else lo = r; }
  const x = [0]; let c = h; for (let i = 1; i <= n; i++) { if (i > m) c *= lo; x.push(i <= m ? i * h : x[i - 1] + c); } x[n] = W; return x;
}
/** A quarter (x >= 0, z >= 0) of a block of side 2 W and depth W whose face towards the other body is a paraboloid of
 * radius R (a cap of a sphere; R = Infinity: flat), graded towards the contact. `up`: the face is the top (at y = W on
 * the axis), otherwise the block is the mirror image above it. */
function cap(K, n, m, fine, W, R, up, material) {
  const mesh = K.boxMesh({size: [n, n, n], cells: [n, n, n]}), x = graded(n, m, fine, W), p = mesh.positions;
  for (let i = 0; i < p.length; i += 3) {
    const px = x[Math.round(p[i])], pz = x[Math.round(p[i + 2])], depth = x[n - Math.round(p[i + 1])], drop = (px * px + pz * pz) / (2 * R) * (1 - depth / W);
    p[i] = px; p[i + 2] = pz; p[i + 1] = up ? W - depth - drop : W + depth + drop;
  }
  // The mirror image turns every element inside out: swap two of its nodes.
  if (!up) for (let e = 0; e < mesh.tets.length; e += 4) { const t = mesh.tets[e]; mesh.tets[e] = mesh.tets[e + 1]; mesh.tets[e + 1] = t; }
  const solid = new K.SolidBody({mesh, material: {...material, density: 1000}, config: {model: 'linear', tolerance: 1e-9}});
  solid.constrain(solid.selectNodes(px => near(px, 0)), [0, null, null]);
  solid.constrain(solid.selectNodes((px, py, pz) => near(pz, 0)), [null, null, 0]);
  return solid;
}
/** Two elastic caps of radii R1 and R2 (quarters by symmetry, each W deep with its far face held) pressed together by
 * `delta`. Reference: F = (4/3) E* sqrt(R*) delta^1.5, 1 / E* = (1 - nu1^2) / E1 + (1 - nu2^2) / E2, 1 / R* = 1 / R1 + 1 / R2,
 * times the factor of a layer bonded to a rigid base (Dimitriadis et al. 2002) at chi = sqrt(R* delta) / W: exact to that
 * formula's order for equal bodies (the contact plane is then a mirror plane), an estimate for unequal ones of the same
 * Poisson's ratio and depth. */
export function hertzCaps(K, n, m, {fine = 0.04, W = 0.5, R1 = 3, R2 = 1.5, delta = 0.000625, E1 = 1e6, E2 = 1e6, nu = 0.3, stiffnessScale = 1000, method, upper: [nU, mU] = [n, m]} = {}) {
  const lower = cap(K, n, m, fine, W, R1, true, {youngModulus: E1, poissonRatio: nu}), upper = cap(K, nU, mU, fine, W, R2, false, {youngModulus: E2, poissonRatio: nu});
  lower.constrain(lower.selectNodes((px, py) => near(py, 0)), [0, 0, 0]);
  const far = upper.selectNodes((px, py) => near(py, 2 * W)); upper.constrain(far, [0, -delta, 0]);
  const contact = new K.SolidSolidContact([lower, upper], {stiffnessScale, method}), result = contact.solveStatic({tolerance: 1e-7});
  const force = -4 * contact.contactForce(0, 1)[1], R = 1 / (1 / R1 + 1 / R2), modulus = 1 / ((1 - nu * nu) / E1 + (1 - nu * nu) / E2);
  const exact = 4 / 3 * modulus * Math.sqrt(R) * delta ** 1.5, a = Math.sqrt(R * delta), layer = bondedLayerFactor(a / W, nu);
  return {n, m, nodes: lower.nodeCount + upper.nodeCount, converged: result.converged, passes: result.passes, force, exact, error: force / exact - 1, layer, errorLayer: force / (exact * layer) - 1,
    contacts: contact.stats.contacts, radius: a, cellsPerRadius: a / (fine / m), cellsPerRadiusUpper: a / (fine / mU), depth: contact.maxPenetration(), newton: contact.stats.newtonIterations, linear: contact.stats.linearIterations};
}

// ---------------------------------------------------------------------------------------------------
// Free impact of two solids: momentum.
// ---------------------------------------------------------------------------------------------------

/** Two cubes of different mass, stiffness and mesh fly at each other off centre (no gravity, friction `friction`) and
 * part again. The contact forces sum to zero, so the linear momentum keeps its value to the solve tolerance; the angular
 * momentum only as well as the frozen contact points allow. */
export function impact(K, {friction = 0.3, steps = 400, dt = 1e-4} = {}) {
  const make = (origin, E, rho, cells, v) => {
    const b = new K.SolidBody({mesh: K.boxMesh({size: [0.1, 0.1, 0.1], cells, origin}), material: {youngModulus: E, poissonRatio: 0.3, density: rho}, config: {model: 'corotational', dt, tolerance: 1e-10}});
    for (let n = 0; n < b.nodeCount; n++) for (let c = 0; c < 3; c++) b.velocities[3 * n + c] = v[c];
    return b;
  };
  const A = make([0, 0, 0], 2e7, 1000, [3, 3, 3], [1, 0, 0]), B = make([0.105, 0.03, 0.02], 5e7, 2500, [4, 4, 4], [-0.5, 0, 0]);
  const contact = new K.SolidSolidContact([A, B], {friction}), p0 = contact.linearMomentum(), L0 = contact.angularMomentum(), e0 = contact.energy();
  let worstLinear = 0, worstAngular = 0, most = 0, touched = 0, energyRise = 0, last = e0.kinetic + e0.strain;
  for (let i = 0; i < steps; i++) {
    contact.step();
    const p = contact.linearMomentum(), L = contact.angularMomentum(), e = contact.energy(), total = e.kinetic + e.strain + contact.contactEnergy();
    worstLinear = Math.max(worstLinear, Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2])); worstAngular = Math.max(worstAngular, Math.hypot(L[0] - L0[0], L[1] - L0[1], L[2] - L0[2]));
    most = Math.max(most, contact.stats.contacts); if (contact.stats.contacts > 0) touched++; energyRise = Math.max(energyRise, total - last); last = total;
  }
  const mean = b => { const v = [0, 0, 0]; for (let n = 0; n < b.nodeCount; n++) for (let c = 0; c < 3; c++) v[c] += b.nodalMass[n] * b.velocities[3 * n + c] / b.mass; return v; };
  const e1 = contact.energy();
  return {momentum: Math.hypot(...p0), worstLinear, angular: Math.hypot(...L0), worstAngular, most, touched, contactsAtEnd: contact.stats.contacts, vA: mean(A), vB: mean(B), massA: A.mass, massB: B.mass,
    energyBefore: e0.kinetic, energyAfter: e1.kinetic + e1.strain, energyRise, unconverged: contact.stats.unconvergedSteps, bits: sha(A.displacements, A.velocities, B.displacements, B.velocities)};
}

// ---------------------------------------------------------------------------------------------------
// A stack of soft blocks at rest.
// ---------------------------------------------------------------------------------------------------

export function makeStack(K, {friction = 0.5} = {}) {
  const make = (y, E, cells) => new K.SolidBody({mesh: K.boxMesh({size: [0.1, 0.1, 0.1], cells, origin: [0, y, 0]}), material: {youngModulus: E, poissonRatio: 0.3, density: 1000}, config: {model: 'corotational', dt: 1 / 240, gravity: [0, -G, 0], massDamping: 5, tolerance: 1e-9}});
  const solids = [make(0, 2e5, [3, 3, 3]), make(0.1, 1e5, [4, 4, 4]), make(0.2, 3e5, [3, 3, 3])];
  const contact = new K.SolidSolidContact(solids, {friction}); contact.addPlane({normal: [0, 1, 0], friction});
  return {solids, contact};
}
/** Three soft cubes (E = 0.2, 0.1 and 0.3 MPa: they shorten by 0.5 to 1.5 % under the weight above) of different meshes
 * stacked on a plane, for `seconds`: each interface carries the weight above it and the stack comes to rest. */
export function stack(K, {seconds = 2, friction = 0.5} = {}) {
  const {solids, contact} = makeStack(K, {friction}), steps = Math.round(seconds * 240);
  contact.step(steps);
  const weights = solids.map(b => b.mass * G), ground = contact.contactForce(0, -1), low = contact.contactForce(0, 1), high = contact.contactForce(1, 2);
  let speed = 0, drift = 0;
  for (const b of solids) {
    for (let n = 0; n < b.nodeCount; n++) speed = Math.max(speed, Math.hypot(b.velocities[3 * n], b.velocities[3 * n + 1], b.velocities[3 * n + 2]));
    let cx = 0, cz = 0; for (let n = 0; n < b.nodeCount; n++) { cx += b.nodalMass[n] * b.displacements[3 * n] / b.mass; cz += b.nodalMass[n] * b.displacements[3 * n + 2] / b.mass; }
    drift = Math.max(drift, Math.hypot(cx, cz));
  }
  const top = solids[2].selectNodes((x, y) => near(y, 0.3)); let settle = 0; for (const n of top) settle -= solids[2].displacements[3 * n + 1] / top.length;
  // Each cube shortens by (the weight above + half its own) L / (E A); the contact springs add their depth.
  const expected = [[2.5, 2e5], [1.5, 1e5], [0.5, 3e5]].reduce((sum, [w, E]) => sum + w * weights[0] * 0.1 / (E * 0.01), 0);
  return {weights, ground: ground[1], low: -low[1], high: -high[1], speed, drift, settle, expected, depth: contact.maxPenetration(), contacts: contact.stats.contacts, unconverged: contact.stats.unconvergedSteps,
    bits: sha(...solids.flatMap(b => [b.displacements, b.velocities]))};
}

// ---------------------------------------------------------------------------------------------------
// Coulomb friction between two solids on a slope.
// ---------------------------------------------------------------------------------------------------

/** A block (0.1 x 0.05 x 0.1 m, E = 5 MPa) on a wider block (0.3 x 0.05 x 0.1 m, E = 20 MPa) whose base is held, with
 * gravity tilted by `degrees` about z: the upper block stays when tan(theta) < mu and slides at g (sin - mu cos) when
 * tan(theta) > mu. The acceleration is the least-squares fit of its mean velocity over the second half of the run. */
export function incline(K, degrees, {friction = 0.3, seconds = 0.5, dt = 1 / 480, method} = {}) {
  const t = degrees * Math.PI / 180, g = [G * Math.sin(t), -G * Math.cos(t), 0];
  const base = new K.SolidBody({mesh: K.boxMesh({size: [0.3, 0.05, 0.1], cells: [9, 2, 3]}), material: {youngModulus: 2e7, poissonRatio: 0.3, density: 1000}, config: {model: 'linear', dt, gravity: g, tolerance: 1e-10}});
  const block = new K.SolidBody({mesh: K.boxMesh({size: [0.1, 0.05, 0.1], cells: [4, 2, 4], origin: [0.01, 0.05, 0]}), material: {youngModulus: 5e6, poissonRatio: 0.3, density: 1000}, config: {model: 'linear', dt, gravity: g, tolerance: 1e-10}});
  base.constrain(base.selectNodes((x, y) => near(y, 0)), [0, 0, 0]);
  const contact = new K.SolidSolidContact([base, block], {friction, method}), steps = Math.round(seconds / dt), times = [], speeds = [];
  const mean = array => { let s = 0; for (let n = 0; n < block.nodeCount; n++) s += block.nodalMass[n] * array[3 * n] / block.mass; return s; };
  for (let i = 0; i < steps; i++) { contact.step(); if (i >= steps / 2) { times.push((i + 1) * dt); speeds.push(mean(block.velocities)); } }
  const mt = times.reduce((a, b) => a + b, 0) / times.length, mv = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  const acceleration = times.reduce((s, v, i) => s + (v - mt) * (speeds[i] - mv), 0) / times.reduce((s, v) => s + (v - mt) ** 2, 0);
  const force = contact.contactForce(1, 0), weight = block.mass * G;
  return {degrees, friction, acceleration, exact: Math.max(0, G * (Math.sin(t) - friction * Math.cos(t))), travel: mean(block.displacements), speed: speeds.at(-1), normal: force[1], normalExact: weight * Math.cos(t),
    shear: -force[0], shearStick: weight * Math.sin(t), shearSlide: friction * weight * Math.cos(t), contacts: contact.stats.contacts, unconverged: contact.stats.unconvergedSteps, passes: contact.stats.frictionPasses};
}

// ---------------------------------------------------------------------------------------------------
// Self-contact: a C-shaped block closes on itself.
// ---------------------------------------------------------------------------------------------------

/** A block with a slot cut into it from one side (a C): its upper arm is pushed down until it lands on the lower arm.
 * Without self-contact the arm passes through; with it the arms stop at each other and the reaction grows. */
export function closingSlot(K, {selfContact = true, push = 0.024} = {}) {
  const nx = 6, ny = 5, mesh = K.boxMesh({size: [0.12, 0.1, 0.02], cells: [nx, ny, 1]}), X = mesh.positions, keep = [];
  // Remove the cells of the middle layer (0.04 < y < 0.06) for x > 0.04: the slot is 0.02 m high.
  for (let e = 0; e < mesh.tets.length; e += 4) {
    let cx = 0, cy = 0; for (let q = 0; q < 4; q++) { cx += X[3 * mesh.tets[e + q]] / 4; cy += X[3 * mesh.tets[e + q] + 1] / 4; }
    if (!(cx > 0.04 && cy > 0.04 && cy < 0.06)) keep.push(mesh.tets[e], mesh.tets[e + 1], mesh.tets[e + 2], mesh.tets[e + 3]);
  }
  const solid = new K.SolidBody({mesh: {positions: mesh.positions, tets: Uint32Array.from(keep)}, material: {youngModulus: 1e6, poissonRatio: 0.3, density: 1000}, config: {model: 'corotational', tolerance: 1e-9}});
  solid.constrain(solid.selectNodes((x, y) => near(y, 0)), [0, 0, 0]);
  solid.constrain(solid.selectNodes(() => true), [null, null, 0]);
  const tip = solid.selectNodes((x, y) => near(y, 0.1) && x > 0.1 - 1e-9), contact = new K.SolidSolidContact([solid], {selfContact});
  const rows = [], lower = Array.from(solid.selectNodes((x, y, z) => near(y, 0.04) && x > 0.04 - 1e-9 && near(z, 0))), upper = solid.selectNodes((x, y, z) => near(y, 0.06) && near(x, 0.12) && near(z, 0))[0];
  for (let i = 1; i <= 6; i++) {
    solid.constrain(tip, [null, -push * i / 6, null]);
    const r = contact.solveStatic({tolerance: 1e-7}), reactions = solid.reactions(); let force = 0; for (const n of tip) force -= reactions[3 * n + 1];
    // The opening at the mouth: the height of the upper arm's lower corner above the lower arm's top surface below it
    // (the deformed line through the top nodes of the lower arm at z = 0).
    const at = n => [X[3 * n] + solid.displacements[3 * n], X[3 * n + 1] + solid.displacements[3 * n + 1]], [tx, ty] = at(upper), line = lower.map(at).sort((p, q) => p[0] - q[0]);
    let k = 0; while (k < line.length - 2 && line[k + 1][0] < tx) k++;
    const surface = line[k][1] + (line[k + 1][1] - line[k][1]) * (tx - line[k][0]) / (line[k + 1][0] - line[k][0]);
    rows.push({push: push * i / 6, force, opening: ty - surface, contacts: contact.stats.contacts, converged: r.converged});
  }
  return {rows, depth: contact.maxPenetration()};
}

// ---------------------------------------------------------------------------------------------------
// The contact patch test: a uniform pressure through an interface whose two surface meshes do not match.
// ---------------------------------------------------------------------------------------------------

/** Tributary area of every node of `body` on the faces that `pick` selects (a third of each face's area), as a map. */
function tributary(body, pick) {
  const X = body.referencePositions, F = body.faces, out = new Map();
  for (let f = 0; f < F.length; f += 3) {
    const [a, b, c] = [F[f], F[f + 1], F[f + 2]], P = q => [X[3 * q], X[3 * q + 1], X[3 * q + 2]], [pa, pb, pc] = [P(a), P(b), P(c)];
    if (!pick(pa, pb, pc)) continue;
    const u = pb.map((v, i) => v - pa[i]), v = pc.map((w, i) => w - pa[i]), area = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]) / 2;
    for (const n of [a, b, c]) out.set(n, (out.get(n) ?? 0) + area / 3);
  }
  return out;
}
/** The spring stiffness per unit area of one search direction between two bodies: stiffnessScale min(M / l). */
const pairStiffness = (A, B, scale) => scale * Math.min((A.lambda + 2 * A.mu) / Math.cbrt(6 * A.referenceVolume / A.tetCount), (B.lambda + 2 * B.mu) / Math.cbrt(6 * B.referenceVolume / B.tetCount));

/** Block A (0.1 x L1 x 0.1 m, E1, nu1) on rollers, block B (0.1 x L2 x 0.1 m, E2, nu2) on it, a pressure p on B's top: both
 * are in uniaxial stress whatever their meshes, and the monolithic answer (one body of two materials) is linear in each:
 * u_y = -p y / E1 in A, -p L1 / E1 - p / (2 k) - p (y - L1) / E2 in B (2 k: the two search directions' springs, which
 * are the only difference from a bonded interface), u_x = nu p x / E, u_z = nu p z / E. Reports the contact pressure at
 * every interface node (its contact force over its share of the interface), the element stresses and every nodal
 * displacement against that answer. B starts at the springs' depth so the first solve has a support. */
export function patchPressure(K, {cellsA = [3, 3, 3], cellsB = [4, 4, 4], E1 = 1e9, E2 = 3e9, nu1 = 0.3, nu2 = 0.2, L1 = 0.1, L2 = 0.08, p = 1e5, method = 'mortar', stiffnessScale = 100, distort = 0} = {}) {
  const a = 0.1, config = {model: 'linear', tolerance: 1e-12};
  const meshB = K.boxMesh({size: [a, L2, a], cells: cellsB, origin: [0, L1, 0]});
  // A distorted mesh: the inner nodes of B moved in x and z (the faces stay planar where the boundary is), the interface too.
  if (distort) for (let i = 0; i < meshB.positions.length; i += 3) { const x = meshB.positions[i], z = meshB.positions[i + 2]; meshB.positions[i] += distort * a * Math.sin(Math.PI * x / a) * Math.sin(2 * Math.PI * z / a); meshB.positions[i + 2] += distort * a * Math.sin(2 * Math.PI * x / a) * Math.sin(Math.PI * z / a); }
  const A = new K.SolidBody({mesh: K.boxMesh({size: [a, L1, a], cells: cellsA}), material: {youngModulus: E1, poissonRatio: nu1, density: 1000}, config});
  const B = new K.SolidBody({mesh: meshB, material: {youngModulus: E2, poissonRatio: nu2, density: 1000}, config});
  for (const b of [A, B]) { b.constrain(b.selectNodes(x => near(x, 0)), [0, null, null]); b.constrain(b.selectNodes((x, y, z) => near(z, 0)), [null, null, 0]); }
  A.constrain(A.selectNodes((x, y) => near(y, 0)), [null, 0, null]);
  B.addPressure(B.selectFaces((cx, cy) => near(cy, L1 + L2)), p);
  const k = pairStiffness(A, B, stiffnessScale), gap = p / (2 * k);
  const start = new Float64Array(3 * B.nodeCount); for (let n = 0; n < B.nodeCount; n++) start[3 * n + 1] = -p * L1 / E1 - gap; B.setState(start);
  const contact = new K.SolidSolidContact([A, B], {stiffnessScale, method}), result = contact.solveStatic();
  // Contact pressure: the contact force of each interface node over its share of the interface, both bodies.
  let pressure = 0, total = 0;
  for (const [body, offset] of [[A, 0], [B, 3 * A.nodeCount]]) {
    for (const [n, area] of tributary(body, (...q) => q.every(v => near(v[1], L1)))) { pressure = Math.max(pressure, Math.abs(Math.abs(contact.nodeForce[offset + 3 * n + 1]) / (area * p) - 1)); if (body === A) total -= contact.nodeForce[3 * n + 1]; }
  }
  let stress = 0; for (const b of [A, B]) { const s = b.stresses(); for (let e = 0; e < b.tetCount; e++) stress = Math.max(stress, Math.abs(s[6 * e + 1] / -p - 1)); }
  const exact = (body, n) => { const X = body.referencePositions, x = X[3 * n], y = X[3 * n + 1], z = X[3 * n + 2], [E, nu] = body === A ? [E1, nu1] : [E2, nu2];
    return [nu * p * x / E, body === A ? -p * y / E1 : -p * L1 / E1 - gap - p * (y - L1) / E2, nu * p * z / E]; };
  const scale = p * (L1 / E1 + L2 / E2); let displacement = 0;
  for (const b of [A, B]) for (let n = 0; n < b.nodeCount; n++) { const e = exact(b, n); for (let c = 0; c < 3; c++) displacement = Math.max(displacement, Math.abs(b.displacements[3 * n + c] - e[c]) / scale); }
  return {converged: result.converged, passes: result.passes, pressure, stress, displacement, force: total, forceExact: p * a * a, contacts: contact.stats.contacts, depth: contact.maxPenetration(), nodes: A.nodeCount + B.nodeCount};
}

/** The same two blocks with the whole set-up turned by `angle` about the axis `axis` (the interface lies across no
 * coordinate plane), nu = 0 so the end faces can be held in all three directions, B's far end pushed `delta` along the
 * turned axis. Answer: uniform stress sigma = delta / (L1 / E1 + 1 / (2 k) + L2 / E2) and u linear along the axis. */
export function patchRotated(K, {cellsA = [3, 3, 3], cellsB = [4, 4, 4], E1 = 1e9, E2 = 3e9, L1 = 0.1, L2 = 0.08, delta = 1e-5, axis = [1, 2, 3], angle = 0.7, method = 'mortar', stiffnessScale = 100} = {}) {
  const a = 0.1, config = {model: 'linear', tolerance: 1e-12}, l = Math.hypot(...axis), [kx, ky, kz] = axis.map(v => v / l), c = Math.cos(angle), s = Math.sin(angle);
  // Rodrigues: R = c I + s [k]x + (1 - c) k k^T.
  const R = [c + kx * kx * (1 - c), kx * ky * (1 - c) - kz * s, kx * kz * (1 - c) + ky * s, ky * kx * (1 - c) + kz * s, c + ky * ky * (1 - c), ky * kz * (1 - c) - kx * s, kz * kx * (1 - c) - ky * s, kz * ky * (1 - c) + kx * s, c + kz * kz * (1 - c)];
  const turn = mesh => { const P = mesh.positions; for (let i = 0; i < P.length; i += 3) { const [x, y, z] = [P[i], P[i + 1], P[i + 2]]; P[i] = R[0] * x + R[1] * y + R[2] * z; P[i + 1] = R[3] * x + R[4] * y + R[5] * z; P[i + 2] = R[6] * x + R[7] * y + R[8] * z; } return mesh; };
  const up = [R[1], R[4], R[7]], along = (x, y, z) => x * up[0] + y * up[1] + z * up[2];
  const A = new K.SolidBody({mesh: turn(K.boxMesh({size: [a, L1, a], cells: cellsA})), material: {youngModulus: E1, poissonRatio: 0, density: 1000}, config});
  const B = new K.SolidBody({mesh: turn(K.boxMesh({size: [a, L2, a], cells: cellsB, origin: [0, L1, 0]})), material: {youngModulus: E2, poissonRatio: 0, density: 1000}, config});
  A.constrain(A.selectNodes((x, y, z) => near(along(x, y, z), 0)), [0, 0, 0]);
  B.constrain(B.selectNodes((x, y, z) => near(along(x, y, z), L1 + L2)), up.map(v => -delta * v));
  const contact = new K.SolidSolidContact([A, B], {stiffnessScale, method}), result = contact.solveStatic();
  const k = pairStiffness(A, B, stiffnessScale), sigma = delta / (L1 / E1 + 1 / (2 * k) + L2 / E2), gap = sigma / (2 * k);
  const f = contact.contactForce(1, 0), force = f[0] * up[0] + f[1] * up[1] + f[2] * up[2];
  let pressure = 0;
  for (const [body, offset] of [[A, 0], [B, 3 * A.nodeCount]])
    for (const [n, area] of tributary(body, (...q) => q.every(v => near(along(...v), L1)))) { const F = contact.nodeForce.subarray(offset + 3 * n, offset + 3 * n + 3); pressure = Math.max(pressure, Math.abs(Math.abs(F[0] * up[0] + F[1] * up[1] + F[2] * up[2]) / (area * sigma) - 1)); }
  let displacement = 0;
  for (const b of [A, B]) for (let n = 0; n < b.nodeCount; n++) {
    const X = b.referencePositions, t = along(X[3 * n], X[3 * n + 1], X[3 * n + 2]), w = b === A ? -sigma * t / E1 : -sigma * L1 / E1 - gap - sigma * (t - L1) / E2;
    for (let q = 0; q < 3; q++) displacement = Math.max(displacement, Math.abs(b.displacements[3 * n + q] - w * up[q]) / delta);
  }
  return {converged: result.converged, passes: result.passes, force, forceExact: sigma * a * a, error: force / (sigma * a * a) - 1, pressure, displacement, contacts: contact.stats.contacts};
}

// ---------------------------------------------------------------------------------------------------
// Friction at the threshold: tan(theta) = (1 -+ 1 %) mu.
// ---------------------------------------------------------------------------------------------------

/** The block of `incline` (4 x 2 x 4 cells on a base of 9 x 2 x 3 cells: the surface meshes do not match) on slopes with
 * tan(theta) = ratio mu: it must stay below 1 and slide above. */
export function frictionThreshold(K, {friction = 0.3, ratios = [0.99, 1.01], seconds = 0.5, method} = {}) {
  return ratios.map(ratio => ({ratio, ...incline(K, Math.atan(ratio * friction) * 180 / Math.PI, {friction, seconds, method})}));
}

// ---------------------------------------------------------------------------------------------------
// Edge against edge: square bars standing on an edge ("diamonds"), crossed.
// ---------------------------------------------------------------------------------------------------

/** A square bar of side `a` and length `L` along x, turned 45° about its axis so that one edge is on top, then turned by
 * `yaw` (degrees) about the vertical, its centre at `centre`. `cells` along its length (odd: the middle of the bar is the
 * middle of an element edge), 2 x 2 across. */
export function diamondBar(K, {a = 0.02, L = 0.2, cells = 9, yaw = 0, centre = [0, 0, 0], E = 1e7, nu = 0.3, density = 1000, config = {}} = {}) {
  const mesh = K.boxMesh({size: [L, a, a], cells: [cells, 2, 2], origin: [-L / 2, -a / 2, -a / 2]}), P = mesh.positions, r = Math.SQRT1_2, c = Math.cos(yaw * Math.PI / 180), s = Math.sin(yaw * Math.PI / 180);
  for (let i = 0; i < P.length; i += 3) {
    const x = P[i], y = r * (P[i + 1] - P[i + 2]), z = r * (P[i + 1] + P[i + 2]);
    P[i] = c * x + s * z + centre[0]; P[i + 1] = y + centre[1]; P[i + 2] = -s * x + c * z + centre[2];
  }
  return new K.SolidBody({mesh, material: {youngModulus: E, poissonRatio: nu, density}, config: {model: 'linear', tolerance: 1e-10, ...config}});
}
/** The lowest edge of the upper bar meets the highest edge of the lower one at the origin. The signed distance between
 * the two edge lines near their crossing, from the deformed nodes (negative: one edge has gone through the other). */
function edgeSeparation(lower, upper) {
  const line = (body, pick) => { const X = body.referencePositions, u = body.displacements, nodes = []; for (let n = 0; n < body.nodeCount; n++) if (pick(X[3 * n + 1])) nodes.push(n); return nodes.map(n => [0, 1, 2].map(c => X[3 * n + c] + u[3 * n + c])); };
  const top = Math.max(...Array.from({length: lower.nodeCount}, (_, n) => lower.referencePositions[3 * n + 1])), bottom = Math.min(...Array.from({length: upper.nodeCount}, (_, n) => upper.referencePositions[3 * n + 1]));
  const A = line(lower, y => near(y, top)).sort((p, q) => p[0] - q[0] || p[2] - q[2]), B = line(upper, y => near(y, bottom));
  // Lower edge along its own direction, upper edge along its own: sort each by its parameter along its chord.
  const dir = pts => { const d = pts[pts.length - 1].map((v, i) => v - pts[0][i]); return pts.slice().sort((p, q) => (p[0] - q[0]) * d[0] + (p[2] - q[2]) * d[2]); };
  const a = dir(A), b = dir(B.sort((p, q) => p[0] - q[0] || p[2] - q[2]));
  let best = Infinity;
  for (let i = 0; i + 1 < a.length; i++) for (let j = 0; j + 1 < b.length; j++) {
    const d1 = a[i + 1].map((v, k) => v - a[i][k]), d2 = b[j + 1].map((v, k) => v - b[j][k]), r = a[i].map((v, k) => v - b[j][k]);
    const aa = d1[0] ** 2 + d1[1] ** 2 + d1[2] ** 2, ee = d2[0] ** 2 + d2[1] ** 2 + d2[2] ** 2, bb = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2], cc = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2], ff = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2], den = aa * ee - bb * bb;
    const s = (bb * ff - cc * ee) / den, t = (aa * ff - bb * cc) / den; if (!(s >= 0 && s <= 1 && t >= 0 && t <= 1)) continue;
    // Upper above lower: the upper point's height over the lower point along +y of the common normal.
    const n = [d1[1] * d2[2] - d1[2] * d2[1], d1[2] * d2[0] - d1[0] * d2[2], d1[0] * d2[1] - d1[1] * d2[0]], nl = Math.hypot(...n), sign = n[1] < 0 ? -1 : 1;
    best = Math.min(best, sign * ((b[j][0] + t * d2[0] - a[i][0] - s * d1[0]) * n[0] + (b[j][1] + t * d2[1] - a[i][1] - s * d1[1]) * n[1] + (b[j][2] + t * d2[2] - a[i][2] - s * d1[2]) * n[2]) / nl);
  }
  return best;
}
/** Two diamond bars crossed at `angle` degrees, touching edge on edge at the origin, both held at their ends; the upper
 * bar's ends are pushed down by `push`. No node of either bar is inside the other: only edge contact can carry the load.
 * Statics. Force balance: what the lower bar's supports carry is the contact force is what the upper bar's supports
 * give. */
export function crossedBars(K, {angle = 90, push = 5e-4, edges, method, friction = 0, a = 0.02, L = 0.2, cells = 9} = {}) {
  const h = a * Math.SQRT1_2, lower = diamondBar(K, {a, L, cells, centre: [0, -h, 0]}), upper = diamondBar(K, {a, L, cells, yaw: angle, centre: [0, h, 0]});
  const ends = (body, yaw) => { const c = Math.cos(yaw * Math.PI / 180), s = Math.sin(yaw * Math.PI / 180); return body.selectNodes((x, y, z) => Math.abs(Math.abs(c * x - s * z) - L / 2) < 1e-9); };
  lower.constrain(ends(lower, 0), [0, 0, 0]); upper.constrain(ends(upper, angle), [0, -push, 0]);
  const contact = new K.SolidSolidContact([lower, upper], {edges, method, friction}), result = contact.solveStatic({tolerance: 1e-9});
  const sum = body => { const r = body.reactions(); let y = 0; for (let n = 0; n < body.nodeCount; n++) y += r[3 * n + 1]; return y; };
  const force = contact.contactForce(1, 0)[1], onLower = contact.contactForce(0, 1)[1];
  // The edge spring: stiffnessScale (100) min((lambda + 2 mu) / l) l^2, l the mean element size (both bars alike).
  const l = Math.cbrt(6 * lower.referenceVolume / lower.tetCount), stiffness = 100 * (lower.lambda + 2 * lower.mu) * l;
  return {converged: result.converged, passes: result.passes, force, onLower, lowerSupports: sum(lower), upperSupports: sum(upper), edgeContacts: contact.stats.edgeContacts, contacts: contact.stats.contacts, stiffness,
    depth: contact.maxPenetration(), separation: edgeSeparation(lower, upper), push};
}
/** Two free diamond bars crossed at 90° fly edge first at each other (no gravity) and part: linear momentum is kept and
 * the edges do not pass through each other. */
export function crossedImpact(K, {edges, speed = 0.5, steps = 300, dt = 1e-4, friction = 0.3} = {}) {
  const h = 0.02 * Math.SQRT1_2, config = {dt, model: 'corotational'};
  const lower = diamondBar(K, {centre: [0, -h - 1e-4, 0], config}), upper = diamondBar(K, {yaw: 90, centre: [0.003, h + 1e-4, 0.002], E: 2e7, density: 2000, config});
  for (let n = 0; n < lower.nodeCount; n++) lower.velocities[3 * n + 1] = speed / 2;
  for (let n = 0; n < upper.nodeCount; n++) upper.velocities[3 * n + 1] = -speed / 2;
  const contact = new K.SolidSolidContact([lower, upper], {edges, friction}), p0 = contact.linearMomentum();
  let worst = 0, touched = 0, most = 0, deepest = 0, separation = Infinity;
  for (let i = 0; i < steps; i++) {
    contact.step(); const p = contact.linearMomentum(); worst = Math.max(worst, Math.hypot(p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]));
    if (contact.stats.edgeContacts > 0) touched++; most = Math.max(most, contact.stats.edgeContacts); deepest = Math.max(deepest, contact.maxPenetration());
    separation = Math.min(separation, edgeSeparation(lower, upper));
  }
  const vy = b => { let s = 0; for (let n = 0; n < b.nodeCount; n++) s += b.nodalMass[n] * b.velocities[3 * n + 1] / b.mass; return s; };
  const cy = b => { let s = 0; for (let n = 0; n < b.nodeCount; n++) s += b.nodalMass[n] * (b.referencePositions[3 * n + 1] + b.displacements[3 * n + 1]) / b.mass; return s; };
  return {momentum: Math.hypot(lower.mass * speed / 2, upper.mass * speed / 2), worst, touched, most, deepest, separation, vLower: vy(lower), vUpper: vy(upper), above: cy(upper) - cy(lower),
    unconverged: contact.stats.unconvergedSteps, contact, bits: sha(lower.displacements, lower.velocities, upper.displacements, upper.velocities)};
}
