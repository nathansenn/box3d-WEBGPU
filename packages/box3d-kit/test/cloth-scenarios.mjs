// Set-ups of the cloth validation, shared by test/v16-cloth.test.mjs (which asserts on them) and
// validation/domains/cloth.mjs (which reports them). Each function builds a problem with a closed-form
// answer, runs the real solver and returns the measured numbers beside the reference. SI units.
// `K` is the kit: {Cloth, ClothCoupling, clothGrid, clothSubsystem, createWorld, createSimulation, axisRotation}.
// Nothing here measures wall-clock time.

export const G = 9.81, HZ = 240, DT = 1 / HZ, SUB = 4;

/** Frequency of a signal from its upward crossings of its own mean, with linear interpolation. */
export function frequency(samples, dt) {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length, crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] < mean && samples[i] >= mean) crossings.push(i - 1 + (mean - samples[i - 1]) / (samples[i] - samples[i - 1]));
  return (crossings.length - 1) / ((crossings.at(-1) - crossings[0]) * dt);
}
const boundary = (grid, n = grid.nx, m = grid.ny) => { const out = []; for (let j = 0; j <= m; j++) for (let i = 0; i <= n; i++) if (i === 0 || j === 0 || i === n || j === m) out.push(grid.node(i, j)); return out; };
const mean = (cloth, nodes, axis) => nodes.reduce((sum, k) => sum + cloth.positions[3 * k + axis], 0) / nodes.length;
const newWorld = (K, options = {}) => K.createWorld({step: DT, subSteps: SUB, ground: false, ...options});

// ---------------------------------------------------------------------------------------------------
// Membrane.
// ---------------------------------------------------------------------------------------------------

/** Patch test: the boundary of an irregular mesh is given a uniform deformation gradient; the interior must follow it. */
export function patch(K) {
  const n = 6, grid = K.clothGrid({nx: n, ny: n, u: [1, 0, 0], v: [0, 1, 0], jitter: 0.3, seed: 3});
  const F = [[1.02, 0.01], [0.005, 0.97]], pinned = boundary(grid), positions = Float64Array.from(grid.positions);
  const map = k => [F[0][0] * grid.positions[3 * k] + F[0][1] * grid.positions[3 * k + 1], F[1][0] * grid.positions[3 * k] + F[1][1] * grid.positions[3 * k + 1]];
  for (const k of pinned) [positions[3 * k], positions[3 * k + 1]] = map(k);
  const cloth = new K.Cloth({positions, restPositions: grid.positions, triangles: grid.triangles, pinned,
    material: {arealDensity: 0.3, youngModulus: 1e6, thickness: 1e-3, poissonRatio: 0.3}, config: {dt: 1 / 60, gravity: [0, 0, 0], residualTolerance: 1e-12}});
  const result = cloth.solveStatic();
  let worst = 0, stress = 0;
  for (let k = 0; k < cloth.nodeCount; k++) { const [x, y] = map(k); worst = Math.max(worst, Math.abs(cloth.positions[3 * k] - x), Math.abs(cloth.positions[3 * k + 1] - y)); }
  // Every triangle must carry the same Green strain, (F^T F - 1) / 2.
  const e11 = 0.5 * (F[0][0] ** 2 + F[1][0] ** 2 - 1);
  for (let t = 0; t < cloth.triangleCount; t++) {
    // The triangle's own axes differ from x, y: compare the invariant E11 + E22.
    const s = cloth.triangleStress(t), trace = s[3] + s[4], expected = e11 + 0.5 * (F[0][1] ** 2 + F[1][1] ** 2 - 1);
    stress = Math.max(stress, Math.abs(trace - expected));
  }
  return {converged: result.converged, worst, strainTrace: stress, nodes: cloth.nodeCount};
}

/**
 * Uniaxial tension: a free strip pulled by a uniform traction T (N/m of reference width) on its two ends, no supports.
 * For the St. Venant-Kirchhoff sheet the stretch l1 solves l1 Y (l1^2 - 1) / 2 = T and the width follows
 * l2^2 - 1 = -nu (l1^2 - 1); to first order strain = T / Y and contraction = -nu strain.
 */
export function uniaxial(K, {membrane = 'stvk', nu = 0.3, diagonal = 'uniform', jitter = 0, traction = 10} = {}) {
  const L = 1, W = 0.25, nx = 16, ny = 4, E = 1e7, t = 1e-3, Y = E * t;
  const grid = K.clothGrid({nx, ny, u: [L, 0, 0], v: [0, W, 0], diagonal, jitter, seed: 11});
  const cloth = new K.Cloth({positions: grid.positions, triangles: grid.triangles,
    material: {arealDensity: 0.2, youngModulus: E, thickness: t, poissonRatio: nu, membrane, bending: 'none'}, config: {dt: 1 / 60, gravity: [0, 0, 0], residualTolerance: 1e-10}});
  for (let j = 0; j <= ny; j++) {
    const share = W / ny * (j === 0 || j === ny ? 0.5 : 1);
    cloth.setNodalForce(grid.node(nx, j), [traction * share, 0, 0]); cloth.setNodalForce(grid.node(0, j), [-traction * share, 0, 0]);
  }
  const result = cloth.solveStatic({pseudoStep: 10}), x = cloth.positions;
  const axial = (x[3 * grid.node(nx, 2)] - x[3 * grid.node(0, 2)]) / L - 1, lateral = (x[3 * grid.node(8, ny) + 1] - x[3 * grid.node(8, 0) + 1]) / W - 1;
  // Exact St. Venant-Kirchhoff stretch by Newton's method.
  let l1 = 1 + traction / Y; for (let i = 0; i < 50; i++) l1 -= (l1 * Y * (l1 * l1 - 1) / 2 - traction) / (Y * (3 * l1 * l1 - 1) / 2);
  const l2 = Math.sqrt(1 - nu * (l1 * l1 - 1));
  return {converged: result.converged, axial, lateral, modulus: traction / axial / t, poisson: -lateral / axial, youngModulus: E, exactAxial: l1 - 1, exactLateral: l2 - 1, linearAxial: traction / Y};
}

/** A strip hanging from its top edge under its own weight: elongation rho g L^2 / (2 Y), reaction = weight. */
export function hangingStrip(K, {n = 16, nu = 0} = {}) {
  const L = 1, W = 0.2, E = 1e7, t = 1e-3, rho = 0.5, across = Math.max(1, n >> 2);
  const grid = K.clothGrid({nx: across, ny: n, u: [W, 0, 0], v: [0, -L, 0]}), pinned = [];
  for (let i = 0; i <= across; i++) pinned.push(grid.node(i, 0));
  const cloth = new K.Cloth({positions: grid.positions, triangles: grid.triangles, pinned,
    material: {arealDensity: rho, youngModulus: E, thickness: t, poissonRatio: nu, bending: 'none'}, config: {dt: 1 / 60, gravity: [0, -G, 0], residualTolerance: 1e-10}});
  const result = cloth.solveStatic({pseudoStep: 10}), tip = [];
  for (let i = 0; i <= across; i++) tip.push(grid.node(i, n));
  const elongation = -mean(cloth, tip, 1) - L, reference = rho * G * L * L / (2 * E * t);
  return {converged: result.converged, elongation, reference, strain: rho * G * L / (E * t), reaction: cloth.totalReaction()[1], weight: cloth.mass() * G};
}

/** A stiff strip, longer than its span, pinned at both ends: its sag against the inextensible catenary. */
export function catenary(K, n) {
  const L = 1.2, span = 1, W = 0.2, E = 1e9, t = 1e-3, rho = 0.5, across = 2;
  let a = 1; { let lo = 0.01, hi = 100; for (let i = 0; i < 200; i++) { a = 0.5 * (lo + hi); if (2 * a * Math.sinh(span / (2 * a)) > L) lo = a; else hi = a; } }
  const sag = a * (Math.cosh(span / (2 * a)) - 1), grid = K.clothGrid({nx: n, ny: across, u: [L, 0, 0], v: [0, 0, W]}), positions = Float64Array.from(grid.positions), pinned = [];
  for (let j = 0; j <= across; j++) for (let i = 0; i <= n; i++) {
    const k = grid.node(i, j), x = a * Math.asinh((L * i / n - L / 2) / a);
    positions[3 * k] = x; positions[3 * k + 1] = a * Math.cosh(x / a) - a * Math.cosh(span / (2 * a));
    if (i === 0 || i === n) pinned.push(k);
  }
  const cloth = new K.Cloth({positions, restPositions: grid.positions, triangles: grid.triangles, pinned,
    material: {arealDensity: rho, youngModulus: E, thickness: t, poissonRatio: 0.3, bending: 'none'}, config: {dt: 1 / 60, gravity: [0, -G, 0], residualTolerance: 1e-9}});
  const result = cloth.solveStatic({pseudoStep: 1});
  let horizontal = 0; for (let j = 0; j <= across; j++) horizontal += cloth.reactions[3 * grid.node(n, j)];
  return {converged: result.converged, sag: -cloth.positions[3 * grid.node(n / 2, 1) + 1], reference: sag, horizontal, horizontalReference: rho * W * G * a};
}

// ---------------------------------------------------------------------------------------------------
// Bending.
// ---------------------------------------------------------------------------------------------------

/**
 * A strip clamped along one short edge (one extra row of held triangles is the wall) under gravity.
 * Small deflection: tip = w L^4 / (8 D) with w = rho g, for nu = 0 or for cylindrical bending.
 */
export function cantilever(K, n, {nu = 0, diagonal = 'uniform', jitter = 0, bending = 'koiter', across} = {}) {
  const L = 0.2, W = 0.05, E = 2e9, t = 1e-3, rho = 0.25, h = L / n, ny = across ?? Math.max(2, n >> 2);
  const grid = K.clothGrid({nx: n + 1, ny, u: [L + h, 0, 0], v: [0, 0, W], origin: [-h, 0, 0], diagonal, jitter, seed: 7}), pinned = [], tip = [];
  for (let j = 0; j <= ny; j++) {
    // The two held rows stay straight whatever the jitter.
    for (let i = 0; i <= 1; i++) { const k = grid.node(i, j); pinned.push(k); grid.positions[3 * k] = (i - 1) * h; grid.positions[3 * k + 2] = W * j / ny; }
    tip.push(grid.node(n + 1, j));
  }
  const cloth = new K.Cloth({positions: grid.positions, triangles: grid.triangles, pinned,
    material: {arealDensity: rho, youngModulus: E, thickness: t, poissonRatio: nu, bending}, config: {dt: 1 / 60, gravity: [0, -G, 0], residualTolerance: 1e-9, maxCgIterations: 20000, cgTolerance: 1e-4}});
  const result = cloth.solveStatic({pseudoStep: 100}), D = cloth.bendingStiffness;
  return {converged: result.converged, tip: -mean(cloth, tip, 1), plate: rho * G * L ** 4 / (8 * D), beam: rho * G * L ** 4 / (8 * D * (1 - nu * nu)), length: L, nodes: cloth.nodeCount};
}

// ---------------------------------------------------------------------------------------------------
// Dynamics of a pre-tensioned strip, and energy.
// ---------------------------------------------------------------------------------------------------

/**
 * A strip stretched by 1 % between two pinned ends and set moving in its first transverse mode:
 * f = (1 / (2 L)) sqrt(T / rho) in the stretched state. Returns the measured frequency and the energy history.
 */
export function tensionedStrip(K, {n = 16, dt = 1 / 2000, integrator = 'midpoint', seconds = 0.5} = {}) {
  const L0 = 1, W = 0.1, E = 1e7, t = 1e-3, rho = 0.3, Y = E * t, stretch = 1.01, L = stretch * L0, amplitude = 1e-4, across = 2;
  const grid = K.clothGrid({nx: n, ny: across, u: [L0, 0, 0], v: [0, 0, W]}), positions = Float64Array.from(grid.positions), velocities = new Float64Array(positions.length), pinned = [];
  // Tension per unit of (unchanged, nu = 0) width, and the mass per stretched area.
  const tension = stretch * Y * 0.5 * (stretch * stretch - 1), reference = 1 / (2 * L) * Math.sqrt(tension / (rho / stretch)), omega = 2 * Math.PI * reference;
  for (let k = 0; k < positions.length / 3; k++) { positions[3 * k] *= stretch; velocities[3 * k + 1] = amplitude * omega * Math.sin(Math.PI * positions[3 * k] / L); }
  for (let j = 0; j <= across; j++) pinned.push(grid.node(0, j), grid.node(n, j));
  const cloth = new K.Cloth({positions, restPositions: grid.positions, velocities, triangles: grid.triangles, pinned,
    material: {arealDensity: rho, youngModulus: E, thickness: t, poissonRatio: 0, bending: 'none'}, config: {dt, gravity: [0, 0, 0], integrator, residualTolerance: 1e-10}});
  const steps = Math.round(seconds / dt), middle = grid.node(n / 2, 1), samples = [], prestress = cloth.membraneEnergy(), start = cloth.totalEnergy() - prestress;
  let worstDrift = 0, rose = 0, previous = start;
  for (let i = 0; i < steps; i++) {
    cloth.step(); samples.push(cloth.positions[3 * middle + 1]);
    const energy = cloth.totalEnergy() - prestress;
    worstDrift = Math.max(worstDrift, Math.abs(energy - start)); rose = Math.max(rose, energy - previous); previous = energy;
  }
  // A lumped string of n segments rings at f sin(pi / 2n) / (pi / 2n); backward Euler multiplies the energy by 1 / (1 + (omega dt)^2) per step.
  const lumped = reference * Math.sin(Math.PI / (2 * n)) / (Math.PI / (2 * n)), omegaLumped = 2 * Math.PI * lumped;
  return {frequency: frequency(samples, dt), reference, lumped, start, end: previous, worstDrift, rose, steps, expectedDecay: (1 + (omegaLumped * dt) ** 2) ** -steps, unconverged: cloth.stats.unconvergedSteps};
}

/** A pre-tensioned square membrane under uniform pressure: centre deflection c p a^2 / T, c = 0.07367 (the Fourier series of T lap(w) = -p). */
export function membraneCoefficient() {
  let c = 0;
  for (let m = 1; m < 400; m += 2) for (let n = 1; n < 400; n += 2) c += 16 / Math.PI ** 4 * Math.sin(m * Math.PI / 2) * Math.sin(n * Math.PI / 2) / (m * n * (m * m + n * n));
  return c;
}
export function pressurisedMembrane(K, n, {diagonal = 'uniform', jitter = 0} = {}) {
  const a0 = 1, E = 1e7, t = 1e-3, nu = 0.3, Y = E * t, stretch = 1.01, a = a0 * stretch, c = membraneCoefficient();
  const grid = K.clothGrid({nx: n, ny: n, u: [a0, 0, 0], v: [0, 0, a0], diagonal, jitter, seed: 5}), positions = Float64Array.from(grid.positions).map(v => v * stretch);
  // Equibiaxial stretch: the Cauchy tension equals the second Piola-Kirchhoff one, Y / (1 - nu) (stretch^2 - 1) / 2.
  const tension = Y / (1 - nu) * 0.5 * (stretch * stretch - 1), pressure = 1e-3 * tension / (c * a);
  const cloth = new K.Cloth({positions, restPositions: grid.positions, triangles: grid.triangles, pinned: boundary(grid),
    material: {arealDensity: 0.3, youngModulus: E, thickness: t, poissonRatio: nu, bending: 'none'}, config: {dt: 1 / 60, gravity: [0, 0, 0], residualTolerance: 1e-9}});
  cloth.setPressure(pressure);
  const result = cloth.solveStatic({pseudoStep: 1});
  return {converged: result.converged, deflection: Math.abs(cloth.positions[3 * grid.node(n / 2, n / 2) + 1]), reference: c * pressure * a * a / tension, reaction: Math.abs(cloth.totalReaction()[1]), load: pressure * a * a, coefficient: c};
}

// ---------------------------------------------------------------------------------------------------
// Contact and friction.
// ---------------------------------------------------------------------------------------------------

/** A square patch lying on a static box tilted by `degrees`: it slides at g (sin - mu cos) when tan > mu and sticks below. */
export async function incline(K, degrees, mu, seconds = 0.5) {
  const world = await newWorld(K);
  try {
    const angle = degrees * Math.PI / 180, half = [2, 0.1, 1], t = 1e-3, side = 0.2, n = 3;
    const ramp = world.createBody({shape: {kind: 'box', halfExtents: half}, type: 'static', position: [0, 0, 0], rotation: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)]});
    const normal = [-Math.sin(angle), Math.cos(angle), 0], uphill = [Math.cos(angle), Math.sin(angle), 0];
    const origin = [normal[0] * (half[1] + t / 2) - uphill[0] * side / 2, normal[1] * (half[1] + t / 2) - uphill[1] * side / 2, -side / 2];
    const grid = K.clothGrid({nx: n, ny: n, u: [uphill[0] * side, uphill[1] * side, 0], v: [0, 0, side], origin});
    const cloth = new K.Cloth({positions: grid.positions, triangles: grid.triangles, material: {arealDensity: 0.3, youngModulus: 1e7, thickness: t, poissonRatio: 0.3}, config: {dt: DT, gravity: [0, -G, 0], residualTolerance: 1e-9}});
    const coupling = new K.ClothCoupling(world, cloth);
    coupling.addBody(ramp, {shape: {kind: 'box', halfExtents: half}, friction: mu});
    const start = Float64Array.from(cloth.positions), steps = Math.round(seconds * HZ);
    for (let i = 0; i < steps; i++) { coupling.step(); world.step(); }
    let travel = 0, speed = 0;
    for (let k = 0; k < cloth.nodeCount; k++) for (let d = 0; d < 3; d++) { travel -= (cloth.positions[3 * k + d] - start[3 * k + d]) * uphill[d] / cloth.nodeCount; speed -= cloth.velocities[3 * k + d] * uphill[d] / cloth.nodeCount; }
    // Backward Euler under a constant force: v = a t exactly, x = a h^2 n (n + 1) / 2.
    const acceleration = Math.max(0, G * (Math.sin(angle) - mu * Math.cos(angle)));
    return {travel, speed, expectedSpeed: acceleration * seconds, expectedTravel: acceleration * DT * DT * steps * (steps + 1) / 2, contacts: cloth.stats.contacts, unconverged: cloth.stats.unconvergedSteps};
  } finally { world.dispose(); }
}

/** A thin kinematic plate (or a sphere) sweeps at `speed` through a free cloth in zero gravity. Counts the nodes it left behind. */
export async function sweep(K, speed, shape = 'box') {
  const world = await newWorld(K, {gravity: [0, 0, 0]});
  try {
    const side = 0.4, n = 10, t = 1e-3, half = [0.001, 0.3, 0.3], radius = 0.05, startX = -0.3;
    const grid = K.clothGrid({nx: n, ny: n, u: [0, 0, side], v: [0, side, 0], origin: [0, -side / 2, -side / 2]});
    const cloth = new K.Cloth({positions: grid.positions, triangles: grid.triangles, material: {arealDensity: 0.3, youngModulus: 1e6, thickness: t, poissonRatio: 0.3, bendingStiffness: 1e-4}, config: {dt: DT, gravity: [0, 0, 0]}});
    const form = shape === 'box' ? {kind: 'box', halfExtents: half} : {kind: 'sphere', radius};
    const body = world.createBody({shape: form, type: 'kinematic', position: [startX, 0, 0]}), coupling = new K.ClothCoupling(world, cloth);
    coupling.addBody(body, {shape: form, friction: 0.2});
    const steps = Math.ceil(0.8 / (speed * DT));
    // Depth of a node behind the plate's leading face, or inside the sphere (negative when it is clear).
    const depth = (k, px) => shape === 'box' ? px + half[0] - cloth.positions[3 * k] : radius - Math.hypot(cloth.positions[3 * k] - px, cloth.positions[3 * k + 1], cloth.positions[3 * k + 2]);
    let x = startX, deepest = -Infinity, behind = 0;
    for (let i = 0; i < steps; i++) {
      x += speed * DT; world.moveKinematic(body, [x, 0, 0]); coupling.step(); world.step();
      const px = world.getState(body).position[0];
      for (let k = 0; k < cloth.nodeCount; k++) deepest = Math.max(deepest, depth(k, px));
    }
    const px = world.getState(body).position[0];
    for (let k = 0; k < cloth.nodeCount; k++) if (shape === 'box' ? cloth.positions[3 * k] < px - half[0] : depth(k, px) > 1e-4) behind++;
    return {behind, deepest, travelPerStep: speed * DT, thickness: 2 * half[0], carried: mean(cloth, [...Array(cloth.nodeCount).keys()], 0) - px, steps, unconverged: cloth.stats.unconvergedSteps};
  } finally { world.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// Two-way coupling.
// ---------------------------------------------------------------------------------------------------

function trampolineCloth(K, n, drag) {
  const a = 1, grid = K.clothGrid({nx: n, ny: n, u: [a, 0, 0], v: [0, 0, -a], origin: [-a / 2, 0, a / 2]});
  const cloth = new K.Cloth({positions: grid.positions, triangles: grid.triangles, pinned: boundary(grid),
    material: {arealDensity: 0.3, youngModulus: 5e6, thickness: 1e-3, poissonRatio: 0.3, bendingStiffness: 1e-3}, config: {dt: DT, gravity: [0, -G, 0], drag, residualTolerance: 1e-8},
    // A stated contact stiffness, so that the time-stepped run and the static solve sink into the contact by the same amount.
    contact: {stiffness: 2e5}});
  return {cloth, grid};
}
/**
 * A sphere dropped on a square cloth pinned along its edges.
 *  - Bouncing (no drag): momentum of ball + cloth against the impulse of gravity and of the support reactions.
 *  - Then damped to rest: reactions against the weight, and the ball's height against a static solve.
 */
export async function trampoline(K, {n = 10, record = false} = {}) {
  const world = await newWorld(K);
  try {
    // The ball spans several nodes: only nodes touch a body, and a ball resting on a single node would be balanced on a pin.
    const radius = 0.35, {cloth, grid} = trampolineCloth(K, n, 0);
    const ball = world.createBody({shape: {kind: 'sphere', radius}, position: [0, radius + 0.2, 0], density: 15, neverSleeps: true});
    const mass = world.getState(ball).mass, coupling = new K.ClothCoupling(world, cloth), shape = {kind: 'sphere', radius};
    // No friction here: with friction the rest state depends on how the cloth was caught, and there would be no single static answer.
    coupling.addBody(ball, {shape});
    const momentum = () => coupling.diagnostics().momentum[1], pinnedWeight = () => { let w = 0; for (const k of boundary(grid)) w += cloth.masses[k] * G; return w; };
    const start = momentum(), weight = (mass + cloth.mass()) * G, history = [];
    let impulse = 0, lowest = Infinity, fastest = 0, firstContact = -1, speedAtContact = 0, deceleration = 0;
    const bounce = Math.round(1.25 * HZ);
    for (let i = 0; i < bounce; i++) {
      const before = world.getState(ball).linearVelocity[1];
      coupling.step(); world.step();
      // Gravity on everything that moves, plus what the supports give beyond holding the pinned nodes' own weight.
      impulse += DT * (cloth.totalReaction()[1] - weight);
      const s = world.getState(ball);
      lowest = Math.min(lowest, s.position[1]); fastest = Math.max(fastest, -s.linearVelocity[1]);
      if (firstContact < 0 && cloth.stats.contacts > 0) { firstContact = i; speedAtContact = -before; }
      deceleration = Math.max(deceleration, (s.linearVelocity[1] - before) / DT + G);
      if (record) history.push(s.position[1]);
    }
    const momentumChange = momentum() - start, exchanged = Math.abs(impulse) + mass * fastest;
    void pinnedWeight;
    // Damp to rest.
    cloth.drag = 12; world.setDamping(ball, 6, 6);
    for (let i = 0; i < 3 * HZ; i++) { coupling.step(); world.step(); }
    world.setDamping(ball, 0, 0); cloth.drag = 0;
    let reaction = 0, force = 0, height = 0; const window = HZ / 4;
    for (let i = 0; i < window; i++) { coupling.step(); world.step(); reaction += cloth.totalReaction()[1] / window; force += coupling.force(ball)[1] / window; height += world.getState(ball).position[1] / window; }
    const speed = Math.abs(world.getState(ball).linearVelocity[1]);
    // The same problem as statics: the ball is an unknown of the solve, carrying its weight.
    const still = trampolineCloth(K, n, 0).cloth, index = still.addBody({shape, type: 'dynamic', mass, position: [0, height, 0], rotation: [0, 0, 0, 1]});
    const solved = still.solveStatic({pseudoStep: 0.05, maxIterations: 400});
    return {mass, clothMass: cloth.mass(), momentumChange, impulse, exchanged, lowest, speedAtContact, fastest, deceleration, reaction, weight, force, ballWeight: mass * G, height, speed,
      staticHeight: still.bodyPosition(index)[1], staticConverged: solved.converged, staticReaction: still.totalReaction()[1], contacts: cloth.stats.contacts, unconverged: cloth.stats.unconvergedSteps, steps: cloth.stats.steps, history};
  } finally { world.dispose(); }
}

/**
 * A cloth draped over a box that stands on a spring scale (a prismatic joint with a spring to the world, calibrated by the
 * box alone: the spring carries the box's weight at its own sag). The extra sag reads the extra load.
 */
export async function scale(K, {estimateSupports = true, n = 8} = {}) {
  const half = [0.3, 0.1, 0.3], settle = 4 * HZ, window = HZ / 2;
  const run = async withCloth => {
    const world = await newWorld(K);
    try {
      const axis = K.axisRotation([0, 1, 0], 'x'), box = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [0, 0, 0], density: 200, neverSleeps: true});
      world.createJoint({type: 'prismatic', bodyA: null, bodyB: box, frameA: {position: [0, 0, 0], rotation: axis}, frameB: {rotation: axis}, spring: {hertz: 3, dampingRatio: 1, target: 0}});
      let cloth = null, coupling = null;
      if (withCloth) {
        const side = 0.9, t = 1e-3, grid = K.clothGrid({nx: n, ny: n, u: [side, 0, 0], v: [0, 0, -side], origin: [-side / 2, half[1] + t / 2, side / 2]});
        cloth = new K.Cloth({positions: grid.positions, triangles: grid.triangles, material: {arealDensity: 1, youngModulus: 1e6, thickness: t, poissonRatio: 0.3, bendingStiffness: 2e-4}, config: {dt: DT, gravity: [0, -G, 0], drag: 3}});
        coupling = new K.ClothCoupling(world, cloth, {estimateSupports});
        coupling.addBody(box, {shape: {kind: 'box', halfExtents: half}, friction: 0.5});
      }
      for (let i = 0; i < settle; i++) { coupling?.step(); world.step(); }
      let y = 0, force = 0;
      for (let i = 0; i < window; i++) { coupling?.step(); world.step(); y += world.getState(box).position[1] / window; if (coupling) force += coupling.force(box)[1] / window; }
      let gap = 0, count = 0, lowest = 0;
      if (cloth) for (let k = 0; k < cloth.nodeCount; k++) {
        lowest = Math.min(lowest, cloth.positions[3 * k + 1] - y);
        if (Math.abs(cloth.positions[3 * k]) < 0.2 && Math.abs(cloth.positions[3 * k + 2]) < 0.2) { gap += cloth.positions[3 * k + 1] - (y + half[1]) - 5e-4; count++; }
      }
      return {y, force, mass: world.getState(box).mass, clothMass: cloth ? cloth.mass() : 0, gap: count ? gap / count : 0, hang: -lowest, contacts: cloth ? cloth.stats.contacts : 0, unconverged: cloth ? cloth.stats.unconvergedSteps : 0};
    } finally { world.dispose(); }
  };
  const alone = await run(false), loaded = await run(true);
  // The spring is linear: it holds the box's weight at the sag -alone.y.
  return {reading: alone.mass * G * (alone.y - loaded.y) / -alone.y, weight: loaded.clothMass * G, force: -loaded.force, sag: alone.y - loaded.y, gap: loaded.gap, hang: loaded.hang, contacts: loaded.contacts, unconverged: loaded.unconverged};
}

/**
 * A box hanging from a strip whose lower edge is attached to it. Returns the stretch against m g L / (E t w) plus the
 * strip's own weight, and against the same with the exact St. Venant-Kirchhoff law, element by element.
 * With `probe` the run is short and only reports whether it stayed bounded.
 */
export async function hangingBody(K, {youngModulus = 1e8, density = 2000, scheme = 'implicit', probe = false, segments = 8} = {}) {
  const world = await newWorld(K);
  try {
    const L = 1, W = 0.2, t = 1e-3, rho = 0.2, across = 2, r = 0.05, half = [W / 2, r, r], Y = youngModulus * t;
    const grid = K.clothGrid({nx: across, ny: segments, u: [W, 0, 0], v: [0, -L, 0], origin: [-W / 2, 0, 0]}), pinned = [];
    for (let i = 0; i <= across; i++) pinned.push(grid.node(i, 0));
    const cloth = new K.Cloth({positions: grid.positions, triangles: grid.triangles, pinned, material: {arealDensity: rho, youngModulus, thickness: t, poissonRatio: 0, bending: 'none'}, config: {dt: DT, gravity: [0, -G, 0], drag: probe ? 0 : 6, residualTolerance: 1e-9}});
    const body = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [0, -L - r, 0], density, neverSleeps: true, linearDamping: probe ? 0 : 8});
    const mass = world.getState(body).mass, coupling = new K.ClothCoupling(world, cloth, {scheme});
    coupling.addBody(body, {shape: {kind: 'box', halfExtents: half}, collide: false});
    for (let i = 0; i <= across; i++) coupling.attach(grid.node(i, segments), body);
    let fastest = 0, blewUp = false;
    const steps = probe ? HZ : 3 * HZ;
    try {
      for (let i = 0; i < steps && !blewUp; i++) {
        coupling.step(); world.step();
        const speed = Math.hypot(...world.getState(body).linearVelocity);
        fastest = Math.max(fastest, speed); blewUp = !Number.isFinite(speed) || speed > 100;
      }
    } catch (error) { if (error?.code !== 'INVALID_PAYLOAD') throw error; blewUp = true; } // The world refuses a force beyond float32.
    if (probe || blewUp) return {blewUp, fastest, mass, stiffnessRatio: Y * W / L * DT * DT / mass};
    world.setDamping(body, 0, 0);
    let y = 0, reaction = 0, force = 0; const window = HZ / 2;
    for (let i = 0; i < window; i++) { coupling.step(); world.step(); y += world.getState(body).position[1] / window; reaction += cloth.totalReaction()[1] / window; force += coupling.force(body)[1] / window; }
    // Each row of elements carries the body and the nodes below it; the exact law gives its stretch.
    let exact = 0;
    for (let j = 0; j < segments; j++) {
      const below = mass * G + rho * W * G * L / segments * (segments - j - 0.5), traction = below / W;
      let l1 = 1 + traction / Y; for (let i = 0; i < 50; i++) l1 -= (l1 * Y * (l1 * l1 - 1) / 2 - traction) / (Y * (3 * l1 * l1 - 1) / 2);
      exact += (l1 - 1) * L / segments;
    }
    return {blewUp, fastest, mass, stretch: -(y + L + r), linear: mass * G * L / (Y * W) + rho * G * L * L / (2 * Y), exact, strain: mass * G / (Y * W), reaction, weight: (mass + cloth.mass()) * G, force, bodyWeight: mass * G, stiffnessRatio: Y * W / L * DT * DT / mass, unconverged: cloth.stats.unconvergedSteps};
  } finally { world.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// Self-collision.
// ---------------------------------------------------------------------------------------------------

/** Three separate sheets of one cloth stacked on a plane, a thickness and a half apart at the start. */
export function stack(K, layers = 3) {
  const side = 0.3, n = 6, thickness = 4e-3, t = 1e-3, positions = [], triangles = [];
  let base = 0;
  for (let l = 0; l < layers; l++) {
    // Each sheet is shifted sideways so that no node sits exactly over another.
    const grid = K.clothGrid({nx: n, ny: n, u: [side, 0, 0], v: [0, 0, -side], origin: [0.013 * l, t / 2 + l * 1.5 * thickness, 0.007 * l]});
    positions.push(...grid.positions); for (const i of grid.triangles) triangles.push(i + base); base += grid.positions.length / 3;
  }
  const cloth = new K.Cloth({positions, triangles, material: {arealDensity: 0.4, youngModulus: 1e6, thickness: t, poissonRatio: 0.3, bendingStiffness: 1e-3}, config: {dt: DT, gravity: [0, -G, 0], drag: 8}, selfCollision: {thickness}});
  const plane = cloth.addBody({shape: {kind: 'plane', normal: [0, 1, 0]}, type: 'static', position: [0, 0, 0], rotation: [0, 0, 0, 1], friction: 0.5});
  cloth.step(2 * HZ);
  const per = base / layers, heights = [];
  for (let l = 0; l < layers; l++) { let y = 0; for (let k = 0; k < per; k++) y += cloth.positions[3 * (l * per + k) + 1] / per; heights.push(y); }
  return {support: cloth.bodyForce(plane)[1], weight: -cloth.mass() * G, gaps: heights.slice(1).map((y, i) => (y - heights[i]) / thickness), nearest: cloth.minimumSelfDistance() / thickness,
    kinetic: cloth.kineticEnergy(), pairs: cloth.stats.selfPairs, dropped: cloth.stats.droppedPairs, unconverged: cloth.stats.unconvergedSteps};
}

/** A strip folded back on itself on a plane, with a box dropped on the fold. With self-collision the two layers stay a thickness apart. */
export async function foldPress(K, {selfCollision = true, density = 400} = {}) {
  const world = await newWorld(K);
  try {
    const W = 0.12, flat = 0.2, bend = 0.012, thickness = 4e-3, t = 1e-3, nx = 20, ny = 4, arc = Math.PI * bend, length = 2 * flat + arc;
    const grid = K.clothGrid({nx, ny, u: [length, 0, 0], v: [0, 0, W]}), positions = Float64Array.from(grid.positions), top = [];
    for (let k = 0; k < positions.length / 3; k++) {
      const s = grid.positions[3 * k];
      if (s <= flat) { positions[3 * k] = s; positions[3 * k + 1] = t / 2; }
      else if (s <= flat + arc) { const a = (s - flat) / bend; positions[3 * k] = flat + bend * Math.sin(a); positions[3 * k + 1] = t / 2 + bend - bend * Math.cos(a); }
      else { positions[3 * k] = flat - (s - flat - arc); positions[3 * k + 1] = t / 2 + 2 * bend; if (s > flat + arc + 0.03) top.push(k); }
    }
    // The fold is the rest shape, so nothing but the box presses the layers together.
    const cloth = new K.Cloth({positions, triangles: grid.triangles, material: {arealDensity: 0.3, youngModulus: 2e6, thickness: t, poissonRatio: 0.3, bendingStiffness: 5e-5}, config: {dt: DT, gravity: [0, -G, 0], drag: 4},
      ...(selfCollision ? {selfCollision: {thickness}} : {})});
    const coupling = new K.ClothCoupling(world, cloth), plane = coupling.addPlane({normal: [0, 1, 0], friction: 0.6}), half = [0.07, 0.03, 0.05];
    const box = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [0.1, 2 * bend + t + half[1] + 0.002, W / 2], density, neverSleeps: true, linearDamping: 2, angularDamping: 2});
    const mass = world.getState(box).mass;
    coupling.addBody(box, {shape: {kind: 'box', halfExtents: half}, friction: 0.6});
    let nearest = Infinity;
    for (let i = 0; i < 1.5 * HZ; i++) { coupling.step(); world.step(); if (i % 6 === 0) nearest = Math.min(nearest, cloth.minimumSelfDistance()); }
    let lowestTop = Infinity; for (const k of top) lowestTop = Math.min(lowestTop, cloth.positions[3 * k + 1]);
    return {nearest: nearest / thickness, final: cloth.minimumSelfDistance() / thickness, layerGap: (lowestTop - t / 2) / thickness, support: -cloth.bodyForce(plane)[1], weight: (mass + cloth.mass()) * G, boxForce: coupling.force(box)[1], boxWeight: mass * G,
      forcePerPair: mass * G / Math.max(1, cloth.stats.selfPairs), pairs: cloth.stats.selfPairs, dropped: cloth.stats.droppedPairs, unconverged: cloth.stats.unconvergedSteps};
  } finally { world.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// Determinism and the stepping loop.
// ---------------------------------------------------------------------------------------------------

/** A short coupled run with contact, friction, an attachment and self-collision; returns every bit of the state as text. */
export async function fingerprint(K, {simulation = false, steps = 150} = {}) {
  const world = await newWorld(K);
  try {
    const n = 8, side = 0.6, grid = K.clothGrid({nx: n, ny: n, u: [side, 0, 0], v: [0, 0, -side], origin: [-side / 2, 0.5, side / 2], diagonal: 'alternate'});
    const cloth = new K.Cloth({positions: grid.positions, triangles: grid.triangles, pinned: [grid.node(0, 0), grid.node(n, 0), grid.node(0, n), grid.node(n, n)],
      material: {arealDensity: 0.3, youngModulus: 2e6, thickness: 1e-3, poissonRatio: 0.3, bendingStiffness: 2e-4}, config: {dt: DT, gravity: [0, -G, 0], drag: 1}, selfCollision: {thickness: 3e-3}});
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.1}, position: [0.05, 0.75, 0.02], density: 400, neverSleeps: true});
    const weight = world.createBody({shape: {kind: 'box', halfExtents: [0.04, 0.04, 0.04]}, position: [0, 0.5 - 0.04, -side / 2], density: 500, neverSleeps: true});
    const coupling = new K.ClothCoupling(world, cloth);
    coupling.addBody(ball, {shape: {kind: 'sphere', radius: 0.1}, friction: 0.4});
    coupling.addBody(weight, {shape: {kind: 'box', halfExtents: [0.04, 0.04, 0.04]}, collide: false});
    coupling.attach(grid.node(n / 2, n), weight);
    const events = [];
    let energy = null, balanceRise = 0;
    if (simulation) {
      const sim = K.createSimulation(world);
      sim.add(K.clothSubsystem(coupling)).trackBody(ball, {kind: 'sphere', radius: 0.1}).trackBody(weight, {kind: 'box', halfExtents: [0.04, 0.04, 0.04]});
      sim.onEvent(event => { if (event.source === 'cloth') events.push(`${event.tick}:${event.type}`); });
      // The cloth's energy less the work done on it can only fall: backward Euler, drag and friction all dissipate.
      let last = sim.energy().entries[0].balance;
      for (let i = 0; i < steps; i++) { sim.step(); const now = sim.energy().entries[0].balance; balanceRise = Math.max(balanceRise, now - last); last = now; }
      energy = sim.energy();
    } else for (let i = 0; i < steps; i++) { coupling.step(); world.step(); }
    const bits = new BigUint64Array(cloth.positions.buffer.slice(0)), hash = [];
    let a = 0xcbf29ce484222325n; for (const b of bits) a = BigInt.asUintN(64, (a ^ b) * 0x100000001b3n);
    hash.push(a.toString(16), world.exactHash().toString(16));
    return {hash: hash.join(':'), events, energy, balanceRise, ballHeight: world.getState(ball).position[1], contacts: cloth.stats.contacts, unconverged: cloth.stats.unconvergedSteps};
  } finally { world.dispose(); }
}
