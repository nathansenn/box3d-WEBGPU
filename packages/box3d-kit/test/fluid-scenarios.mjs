// Set-ups of the fluid validation, shared by test/v18-fluid.test.mjs (which asserts on them) and
// validation/domains/fluid.mjs (which reports them). Each function builds a problem with a known answer, runs the
// real solver and returns the measured numbers beside the reference. SI units.
// `K` is the kit: the exports of box3d-webgpu-kit/fluid plus {createWorld, createSimulation}.
// Nothing here measures wall-clock time.

export const G = 9.81;
const PERIODIC = 'periodic';
const allPeriodic = {xMin: PERIODIC, xMax: PERIODIC, yMin: PERIODIC, yMax: PERIODIC, zMin: PERIODIC, zMax: PERIODIC};
/** A 2D flow: one cell along z, periodic in z. */
const flat = {zMin: PERIODIC, zMax: PERIODIC};

/** Step until the largest change of the face velocities over one step is below `tolerance` times the largest velocity. */
function untilSteady(fluid, {tolerance = 1e-8, maxSteps = 20000, every = 1} = {}) {
  const fields = [fluid.u, fluid.v, fluid.w], before = fields.map(x => new Float64Array(x.length));
  let steps = 0, change = Infinity;
  while (steps < maxSteps) {
    fields.forEach((x, c) => before[c].set(x));
    fluid.step(every); steps += every;
    let delta = 0, top = 0;
    fields.forEach((x, c) => { const b = before[c]; for (let i = 0; i < x.length; i++) { const d = Math.abs(x[i] - b[i]); if (d > delta) delta = d; const a = Math.abs(x[i]); if (a > top) top = a; } });
    change = delta / (top || 1) / every;
    if (change < tolerance) break;
  }
  return {steps, change};
}
/** 64-bit FNV-1a of float64 arrays, as hex. */
export function hashArrays(...arrays) {
  let a = 0xcbf29ce484222325n;
  for (const array of arrays) for (const b of new BigUint64Array(Float64Array.from(array).buffer)) a = BigInt.asUintN(64, (a ^ b) * 0x100000001b3n);
  return a.toString(16);
}

// ---------------------------------------------------------------------------------------------------
// Projection.
// ---------------------------------------------------------------------------------------------------

/**
 * A random velocity in a 12 x 10 x 8 box with a tilted capsule in it, projected once and then stepped three times, for
 * closed walls, all sides periodic, and an outflow with a free-slip floor. Returns the largest max |div u| h / max |u|.
 */
export function projection(K) {
  let seed = 7, worst = 0, stepped = 0, unconverged = 0;
  const random = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 - 0.5; };
  for (const boundaries of [{}, allPeriodic, {xMax: 'outflow', yMin: 'free-slip'}]) {
    const f = new K.Fluid({cells: [12, 10, 8], spacing: 0.01, density: 1000, viscosity: 1e-3, dt: 0.01, gravity: [0, -G, 0], boundaries});
    f.addObstacle({shape: {kind: 'capsule', radius: 0.015, halfLength: 0.02}, position: [0.06, 0.05, 0.04], rotation: [0.3826834, 0, 0, 0.9238795]});
    f.setVelocity(() => [random(), random(), random()]);
    f.project();
    let top = 0;
    for (const x of [f.u, f.v, f.w]) for (const value of x) top = Math.max(top, Math.abs(value));
    worst = Math.max(worst, f.maxDivergence() * f.h / top);
    f.step(3);
    stepped = Math.max(stepped, f.stats.divergence); unconverged += f.stats.unconverged;
  }
  return {projected: worst, stepped, unconverged};
}

// ---------------------------------------------------------------------------------------------------
// Taylor-Green vortex: a periodic square of side 2 pi m, U = 1 m/s, nu = 0.01 m^2/s (Re = 100 on the side).
// ---------------------------------------------------------------------------------------------------

export function taylorGreen(K, {n = 32, time = 1, courant = 0.4, advection = 'central', diffusion = 'explicit'} = {}) {
  const L = 2 * Math.PI, nu = 0.01, h = L / n, dt = courant * h / 2;
  const fluid = new K.Fluid({cells: [n, n, 1], spacing: h, density: 1, viscosity: nu, dt, gravity: [0, 0, 0], advection, diffusion, boundaries: allPeriodic});
  fluid.setVelocity((x, y) => K.taylorGreenVelocity(x, y, 0, {nu}));
  const e0 = fluid.kineticEnergy();
  fluid.step(Math.round(time / dt));
  const t = fluid.time, e1 = fluid.kineticEnergy();
  let error = 0, norm = 0;
  for (const c of [0, 1]) {
    const x = fluid.vel[c];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const f = fluid.index(i, j, 0), p = fluid.facePosition(c, f), exact = K.taylorGreenVelocity(p[0], p[1], t, {nu})[c];
      error += (x[f] - exact) ** 2; norm += exact ** 2;
    }
  }
  const rate = -Math.log(e1 / e0) / t;
  return {velocityError: Math.sqrt(error / norm), rate, exactRate: 4 * nu, divergence: fluid.maxDivergence() * h / Math.exp(-2 * nu * t),
    ledger: (fluid.energyBalance() - e0) / (e0 - e1), dissipated: fluid.dissipated, kineticLoss: e0 - e1, steps: fluid.stats.steps, iterations: fluid.stats.pressureIterations};
}

// ---------------------------------------------------------------------------------------------------
// Channels and ducts: a viscous oil (rho = 900 kg/m^3, mu = 0.09 Pa s) driven by a body acceleration (a pressure gradient
// over density). Steady states by backward Euler, which reaches them in large steps.
// ---------------------------------------------------------------------------------------------------

const OIL = {density: 900, viscosity: 0.09};
const NU_OIL = OIL.viscosity / OIL.density;

/** Plane Poiseuille flow between walls 20 mm apart: largest error of the profile over the centre-line speed. */
export function poiseuille(K, {n = 16} = {}) {
  const H = 0.02, accel = 0.02, h = H / n;
  const fluid = new K.Fluid({cells: [2, n, 1], spacing: h, ...OIL, dt: 0.05, gravity: [0, 0, 0], bodyForce: [accel, 0, 0], diffusion: 'backward-euler', boundaries: {xMin: PERIODIC, xMax: PERIODIC, ...flat}});
  const run = untilSteady(fluid, {tolerance: 1e-10});
  const peak = accel * H * H / (8 * NU_OIL);
  let error = 0;
  for (let j = 0; j < n; j++) error = Math.max(error, Math.abs(fluid.u[fluid.index(0, j, 0)] - K.poiseuilleVelocity((j + 0.5) * h, H, accel, NU_OIL)));
  return {error: error / peak, closedForm: (h / H) ** 2, peak, ...run};
}
/** Plane Couette flow, top wall at 10 mm/s: largest error of the linear profile over the wall speed. */
export function couette(K, {n = 16} = {}) {
  const H = 0.02, U = 0.01, h = H / n;
  const fluid = new K.Fluid({cells: [2, n, 1], spacing: h, ...OIL, dt: 0.05, gravity: [0, 0, 0], diffusion: 'backward-euler', boundaries: {xMin: PERIODIC, xMax: PERIODIC, yMax: {type: 'no-slip', velocity: [U, 0, 0]}, ...flat}});
  const run = untilSteady(fluid, {tolerance: 1e-12});
  let error = 0;
  for (let j = 0; j < n; j++) error = Math.max(error, Math.abs(fluid.u[fluid.index(0, j, 0)] - U * (j + 0.5) * h / H));
  return {error: error / U, ...run};
}
/** Fully developed flow in a square duct of side 20 mm (one periodic cell along it): profile and flow rate against the series. */
export function squareDuct(K, {n = 16} = {}) {
  const H = 0.02, a = H / 2, accel = 0.02, h = H / n;
  const fluid = new K.Fluid({cells: [1, n, n], spacing: h, ...OIL, dt: 0.05, gravity: [0, 0, 0], bodyForce: [accel, 0, 0], diffusion: 'backward-euler', boundaries: {xMin: PERIODIC, xMax: PERIODIC}});
  const run = untilSteady(fluid, {tolerance: 1e-10});
  const centre = K.ductVelocity(0, 0, a, a, accel, NU_OIL);
  let error = 0;
  for (let k = 0; k < n; k++) for (let j = 0; j < n; j++) error = Math.max(error, Math.abs(fluid.u[fluid.index(0, j, k)] - K.ductVelocity((j + 0.5) * h - a, (k + 0.5) * h - a, a, a, accel, NU_OIL)));
  const flow = fluid.flowRate(0, 0), exact = K.ductFlowRate(a, a, accel, NU_OIL);
  return {error: error / centre, flowRate: flow, exactFlowRate: exact, centreCoefficient: centre * NU_OIL / (accel * a * a), ...run};
}
/**
 * A 2D channel 20 mm wide and 80 mm long with a parabolic inflow (peak 10 mm/s) and an outflow (p = 0): the flow stays
 * parabolic, the pressure falls by 8 mu U_max / H^2 per metre, and what enters leaves.
 */
export function channel(K, {n = 12} = {}) {
  const H = 0.02, length = 4 * H, peak = 0.01, h = H / n;
  const inflow = (x, y) => [4 * peak * y * (H - y) / (H * H), 0, 0];
  const fluid = new K.Fluid({cells: [4 * n, n, 1], spacing: h, ...OIL, dt: 0.05, gravity: [0, 0, 0], diffusion: 'backward-euler',
    boundaries: {xMin: {type: 'inflow', velocity: inflow}, xMax: 'outflow', ...flat}});
  const run = untilSteady(fluid, {tolerance: 1e-10});
  let profile = 0;
  for (let j = 0; j < n; j++) { const y = (j + 0.5) * h; profile = Math.max(profile, Math.abs(fluid.u[fluid.index(4 * n, j, 0)] - inflow(0, y)[0])); }
  // Pressure gradient in the middle half, from the mean pressure of two columns of cells.
  const column = i => { let s = 0; for (let j = 0; j < n; j++) s += fluid.p[i + 4 * n * j]; return s / n; };
  const i0 = n, i1 = 3 * n, gradient = (column(i1) - column(i0)) / ((i1 - i0) * h), exact = -8 * OIL.viscosity * peak / (H * H);
  const inFlow = fluid.flowRate(0, 0), outFlow = fluid.flowRate(0, 4 * n);
  return {profile: profile / peak, gradient, exactGradient: exact, massError: (outFlow - inFlow) / inFlow, length, ...run};
}

// ---------------------------------------------------------------------------------------------------
// Lid-driven cavity (Ghia, Ghia & Shin 1982).
// ---------------------------------------------------------------------------------------------------

/**
 * Ghia, Ghia & Shin, J. Comput. Phys. 48 (1982) 387-411, tables I and II: u on the vertical centre line, v on the
 * horizontal one, for Re = 100 and 400. Transcribed from two independent copies that agree on these columns:
 *   https://gist.github.com/ivan-pi/3e9326d18a366ffe6a8e5bfda6353219 (table I)
 *   https://raw.githubusercontent.com/DravenPie/PINNFormers-Navier-Stokes-Equations/HEAD/data/ghiav.txt (table II)
 *   https://raw.githubusercontent.com/hhucyl/permeable_bed/HEAD/uy.txt (table II)
 * The paper itself was not opened. The Re = 400 point v(0.9063) = -0.23827 is marked as probably wrong in the second
 * copy (it breaks the smooth profile) and is left out.
 */
export const GHIA = {
  y: [0.9766, 0.9688, 0.9609, 0.9531, 0.8516, 0.7344, 0.6172, 0.5000, 0.4531, 0.2813, 0.1719, 0.1016, 0.0703, 0.0625, 0.0547],
  u: {100: [0.84123, 0.78871, 0.73722, 0.68717, 0.23151, 0.00332, -0.13641, -0.20581, -0.21090, -0.15662, -0.10150, -0.06434, -0.04775, -0.04192, -0.03717],
    400: [0.75837, 0.68439, 0.61756, 0.55892, 0.29093, 0.16256, 0.02135, -0.11477, -0.17119, -0.32726, -0.24299, -0.14612, -0.10338, -0.09266, -0.08186]},
  x: [0.9688, 0.9609, 0.9531, 0.9453, 0.9063, 0.8594, 0.8047, 0.5000, 0.2344, 0.2266, 0.1563, 0.0938, 0.0781, 0.0703, 0.0625],
  v: {100: [-0.05906, -0.07391, -0.08864, -0.10313, -0.16914, -0.22445, -0.24533, 0.05454, 0.17527, 0.17507, 0.16077, 0.12317, 0.10890, 0.10091, 0.09233],
    400: [-0.12146, -0.15663, -0.19254, -0.22847, null, -0.44993, -0.38598, 0.05186, 0.30174, 0.30203, 0.28124, 0.22965, 0.20920, 0.19713, 0.18360]},
};
/** A unit cavity, lid speed 1, nu = 1 / Re (dimensionless, as in the paper). Largest centre-line errors over the lid speed. */
export function cavity(K, {n = 32, re = 100, courant = 0.5, tolerance = 1e-6} = {}) {
  const h = 1 / n;
  const fluid = new K.Fluid({cells: [n, n, 1], spacing: h, density: 1, viscosity: 1 / re, dt: courant * h, gravity: [0, 0, 0], diffusion: 'backward-euler',
    boundaries: {yMax: {type: 'no-slip', velocity: [1, 0, 0]}, ...flat}, cflLimit: 2});
  const run = untilSteady(fluid, {tolerance, every: 10, maxSteps: 40000});
  const u = GHIA.y.map(y => fluid.velocityAt(0.5, y, h / 2)[0]), v = GHIA.x.map(x => fluid.velocityAt(x, 0.5, h / 2)[1]);
  const worst = (measured, reference) => Math.max(...measured.map((m, i) => reference[i] === null ? 0 : Math.abs(m - reference[i])));
  return {uError: worst(u, GHIA.u[re]), vError: worst(v, GHIA.v[re]), u, v, time: fluid.time, ...run};
}

// ---------------------------------------------------------------------------------------------------
// Water at rest in a closed tank with a sphere in it.
// ---------------------------------------------------------------------------------------------------

/** A 0.2 m cube of water at rest (started from the hydrostatic pressure) with a fixed sphere of radius 30 mm: largest velocity, pressure head and buoyancy. */
export function hydrostatic(K, {n = 16, steps = 40} = {}) {
  const L = 0.2, h = L / n, a = 0.03, rho = 1000;
  const fluid = new K.Fluid({cells: [n, n, n], spacing: h, density: rho, viscosity: 1e-3, dt: 0.01, gravity: [0, -G, 0], diffusion: 'crank-nicolson'});
  const sphere = fluid.addObstacle({shape: {kind: 'sphere', radius: a}, position: [0.1, 0.1, 0.1]});
  // Start from the hydrostatic pressure, as a tank that has been at rest would be.
  fluid.setPressure((x, y) => rho * G * (L - y));
  fluid.step(steps);
  let speed = 0;
  for (const x of fluid.vel) for (const value of x) speed = Math.max(speed, Math.abs(value));
  // Pressure difference between the bottom and top cell layers (means over the layers) against rho g (L - h).
  const layer = j => { let s = 0; for (let k = 0; k < n; k++) for (let i = 0; i < n; i++) s += fluid.p[i + n * (j + n * k)]; return s / (n * n); };
  const head = layer(0) - layer(n - 1), exactHead = rho * G * (L - h);
  const lift = fluid.obstacleForce(sphere)[1], gridVolume = fluid.obstacleVolume(sphere);
  return {speed, scale: G * fluid.dt, head, exactHead, lift, gridBuoyancy: rho * G * gridVolume, buoyancy: rho * G * 4 / 3 * Math.PI * a ** 3, iterations: fluid.stats.pressureIterations};
}

// ---------------------------------------------------------------------------------------------------
// Stokes drag on a sphere: a simple cubic array (one sphere in a periodic cube), Hasimoto's correction.
// ---------------------------------------------------------------------------------------------------

const STOKES = {L: 0.02, rho: 1000, mu: 1, ratio: 0.15, accel: 0.1};
/**
 * A fixed sphere of radius 0.15 L in a periodic cube of side L = 20 mm of a fluid with mu = 1 Pa s driven by a body
 * acceleration (Re about 0.06). Returns K = F / (6 pi mu a U), U the mean velocity over the cube, beside Hasimoto's K,
 * and the force measured on a control surface around the sphere and from the momentum balance. Stops when the force
 * changes by less than `settle` of itself in a step (the steady state does not depend on the step).
 */
export function stokesDrag(K, {n = 16, courant = 5, steps = 200, settle = 2e-5} = {}) {
  const {L, rho, mu, ratio, accel} = STOKES, nu = mu / rho, h = L / n, a = ratio * L;
  const fluid = new K.Fluid({cells: [n, n, n], spacing: h, density: rho, viscosity: mu, dt: courant * h * h / nu, gravity: [0, 0, 0], bodyForce: [accel, 0, 0], diffusion: 'backward-euler', boundaries: allPeriodic});
  const sphere = fluid.addObstacle({shape: {kind: 'sphere', radius: a}, position: [L / 2, L / 2, L / 2]});
  let last = 0, run = 0;
  for (; run < steps; run++) { fluid.step(); const now = fluid.obstacleForce(sphere)[0]; if (run > 4 && Math.abs(now - last) < settle * Math.abs(now)) { run++; break; } last = now; }
  const U = fluid.flowRate(0, 0) / (L * L), F = fluid.obstacleForce(sphere)[0];
  const solid = 4 / 3 * Math.PI * a ** 3 / L ** 3, lo = Math.floor(n / 2 - a / h - 2), hi = Math.ceil(n / 2 + a / h + 1);
  const surface = fluid.controlVolumeForce([lo, lo, lo], [hi, hi, hi])[0];
  return {measured: F / (6 * Math.PI * mu * a * U), hasimoto: K.hasimotoDragFactor(solid), solid, cellsPerRadius: a / h, force: F, surface,
    balance: rho * accel * (L ** 3 - fluid.obstacleVolume(sphere)), reynolds: U * 2 * a / nu, steps: run};
}

// ---------------------------------------------------------------------------------------------------
// Coupled to the rigid world.
// ---------------------------------------------------------------------------------------------------

/**
 * A sphere of the rigid world (1.5 times denser than the fluid) settles in the same periodic cube under gravity, with a
 * uniform back-pressure that keeps the total momentum of fluid and sphere at zero. At its terminal velocity the drag
 * balances m g V / (V - V_b); with Hasimoto's K and the zero-momentum frame that gives
 *   U = - m g V^2 / (6 pi mu a K (V - V_b) (m / rho + V - V_b)).
 */
export async function settling(K, {n = 16, seconds = 0.1, hz = 2000, density = 1500} = {}) {
  const L = 0.02, rho = 1000, nu = 2e-3, mu = rho * nu, h = L / n, a = 0.15 * L, step = 1 / hz;
  const world = await K.createWorld({step, subSteps: 4, ground: false, gravity: [0, -G, 0]});
  try {
    const fluid = new K.Fluid({cells: [n, n, n], spacing: h, density: rho, viscosity: mu, dt: step, gravity: [0, -G, 0], diffusion: 'backward-euler', boundaries: allPeriodic});
    const ball = world.createBody({shape: {kind: 'sphere', radius: a}, position: [L / 2, L / 2, L / 2], density, neverSleeps: true});
    const coupling = new K.FluidCoupling(world, fluid);
    coupling.addBody(ball, {shape: {kind: 'sphere', radius: a}});
    const V = L ** 3, Vb = fluid.obstacleVolume(0), m = world.getState(ball).mass;
    fluid.bodyForce[1] = G + m * G / (rho * (V - Vb));
    for (let i = 0; i < Math.round(seconds * hz); i++) { coupling.step(); world.step(); }
    const U = world.getState(ball).linearVelocity[1], factor = K.hasimotoDragFactor(4 / 3 * Math.PI * a ** 3 / V);
    const expected = -m * G * V * V / (6 * Math.PI * mu * a * factor * (V - Vb) * (m / rho + V - Vb));
    const responseTime = m / (6 * Math.PI * mu * a * factor);
    return {velocity: U, expected, reynolds: Math.abs(U) * 2 * a / nu, responseTime, step, massRatio: m / (rho * Vb), cellsPerRadius: a / h};
  } finally { world.dispose(); }
}

/**
 * Newton's third law: a sphere of the rigid world thrown through a periodic cube of fluid at rest, no gravity, explicit
 * viscosity (every operator of the step then conserves momentum to round-off). Returns the change of the fluid's own
 * momentum plus the impulse handed to the body (float64, both from the coupling's numbers) and the change of the total
 * momentum of fluid and body (the body's from the world's float32 state), each over the momentum exchanged.
 */
export async function momentumExchange(K, {n = 16, steps = 60} = {}) {
  const hz = 120, step = 1 / hz, L = 0.04, h = L / n, a = 0.006;
  const world = await K.createWorld({step, subSteps: 4, ground: false, gravity: [0, 0, 0]});
  try {
    const fluid = new K.Fluid({cells: [n, n, n], spacing: h, density: 1000, viscosity: 0.1, dt: step, gravity: [0, 0, 0], boundaries: allPeriodic});
    const ball = world.createBody({shape: {kind: 'sphere', radius: a}, position: [L / 2, L / 2, L / 2], density: 3000, neverSleeps: true});
    world.setVelocity(ball, [0.05, 0.02, 0], [0, 0, 3]);
    const coupling = new K.FluidCoupling(world, fluid);
    coupling.addBody(ball, {shape: {kind: 'sphere', radius: a}});
    const fluid0 = fluid.momentum(), total0 = coupling.diagnostics().momentum, impulse = [0, 0, 0], angular = [0, 0, 0];
    for (let i = 0; i < steps; i++) { coupling.step(); const F = coupling.force(ball), T = coupling.torque(ball); for (let k = 0; k < 3; k++) { impulse[k] += F[k] * step; angular[k] += T[k] * step; } world.step(); }
    const fluid1 = fluid.momentum(), total1 = coupling.diagnostics().momentum, exchanged = Math.hypot(...impulse);
    return {exchanged, angularImpulse: Math.hypot(...angular),
      fluidSide: Math.hypot(...[0, 1, 2].map(k => fluid1[k] - fluid0[k] + impulse[k])) / exchanged,
      total: Math.hypot(...[0, 1, 2].map(k => total1[k] - total0[k])) / exchanged,
      speed: Math.hypot(...world.getState(ball).linearVelocity), courant: fluid.stats.maxCfl};
  } finally { world.dispose(); }
}

/** Every bit of a short coupled run (a sphere dropped into a closed box of water with a fixed obstacle, onto the world's ground), as text; optionally through the Simulation loop. */
export async function fingerprint(K, {simulation = false, steps = 30} = {}) {
  const hz = 120, step = 1 / hz;
  const world = await K.createWorld({step, subSteps: 4, ground: true, gravity: [0, -G, 0]});
  try {
    const fluid = new K.Fluid({cells: [10, 12, 10], spacing: 0.01, density: 1000, viscosity: 0.05, dt: step, gravity: [0, -G, 0], diffusion: 'crank-nicolson', boundaries: {yMax: 'free-slip'}});
    fluid.addObstacle({shape: {kind: 'box', halfExtents: [0.02, 0.01, 0.03]}, position: [0.05, 0.02, 0.05], rotation: [0, 0.2588190451, 0, 0.9659258263]});
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.015}, position: [0.08, 0.08, 0.075], density: 4000, neverSleeps: true});
    const coupling = new K.FluidCoupling(world, fluid);
    coupling.addBody(ball, {shape: {kind: 'sphere', radius: 0.015}});
    const events = [];
    let sim = null;
    if (simulation) { sim = K.createSimulation(world); sim.add(K.fluidSubsystem(coupling)); sim.onEvent(e => { if (e.source === 'fluid') events.push(`${e.tick}:${e.type}`); }); }
    for (let i = 0; i < steps; i++) { if (sim) sim.step(); else { coupling.step(); world.step(); } }
    return {hash: `${hashArrays(fluid.u, fluid.v, fluid.w, fluid.p)}:${world.exactHash().toString(16)}`, events, energy: sim ? sim.energy() : null, order: sim ? sim.order().map(row => row.id) : null,
      position: world.getState(ball).position};
  } finally { world.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// Free surface.
// ---------------------------------------------------------------------------------------------------

/**
 * Martin & Moyce (1952), Phil. Trans. R. Soc. A 244, 312-324, table 2: collapse of a water column of width a and height
 * 2a (n^2 = 2), surge front Z = x / a against T = n t sqrt(g / a); the mean of the three records with a = 1 1/8 in.
 * Read from the scanned paper at https://www.math.ntu.edu.tw/~shyue/orch08/benchmarks/lowmach/broken-dam/91519.pdf
 * (JSTOR copy). The paper's times are normalised so that every record reads T = 1.19 at Z = 1.44 (the instant of
 * release was not recorded).
 */
export const MARTIN_MOYCE = [[1.44, 1.19], [1.89, 1.58], [2.33, 1.91], [2.78, 2.23], [3.22, 2.58], [3.67, 2.91], [4.11, 3.26], [4.56, 3.60], [5.00, 3.92], [5.44, 4.26], [5.89, 4.61], [6.33, 4.95], [6.76, 5.32]];

/** The 2D collapse of a water column a = 1 1/8 in wide and 2a high in a tank 8a long. Returns T at each tabulated Z, raw and shifted to T = 1.19 at Z = 1.44. */
export function damBreak(K, {perA = 16, dt = 5e-4} = {}) {
  const a = 0.028575, h = a / perA;
  const fluid = new K.FreeSurfaceFluid({cells: [8 * perA, Math.round(2.5 * perA), 1], spacing: h, density: 1000, dt, gravity: [0, -G, 0]});
  fluid.addLiquid((x, y) => x < a && y < 2 * a);
  const scale = Math.SQRT2 * Math.sqrt(G / a), volume0 = fluid.liquidVolume(), times = [];
  let previousZ = fluid.front(0) / a, previousT = 0, next = 0;
  while (next < MARTIN_MOYCE.length && fluid.time * scale < 10) {
    fluid.step();
    const Z = fluid.front(0) / a, T = fluid.time * scale;
    while (next < MARTIN_MOYCE.length && Z >= MARTIN_MOYCE[next][0]) { times.push(previousT + (T - previousT) * (MARTIN_MOYCE[next][0] - previousZ) / (Z - previousZ)); next++; }
    previousZ = Z; previousT = T;
  }
  const shift = MARTIN_MOYCE[0][1] - times[0], shifted = times.map(t => t + shift);
  const errors = shifted.map((t, i) => t / MARTIN_MOYCE[i][1] - 1);
  return {times, shifted, errors, worst: Math.max(...errors.map(Math.abs)), shift, volumeChange: fluid.liquidVolume() / volume0 - 1, particles: fluid.count, divergence: fluid.stats.divergence, steps: fluid.stats.steps, courant: fluid.stats.maxCfl};
}

/**
 * First sloshing mode of water 0.2 m deep in a tank 0.4 m long (2D), surface started as A cos(pi x / L) with A = 10 mm:
 * the frequency of the horizontal centre of mass against the linear dispersion relation omega^2 = g k tanh(k H).
 */
export function sloshing(K, {n = 32, dt = 0.005, periods = 3, amplitude = 0.01} = {}) {
  const L = 0.4, H = 0.2, h = L / n, k = Math.PI / L;
  const fluid = new K.FreeSurfaceFluid({cells: [n, Math.round(1.6 * H / h), 1], spacing: h, density: 1000, dt, gravity: [0, -G, 0]});
  fluid.addLiquid((x, y) => y < H + amplitude * Math.cos(k * x));
  const expected = K.sloshingFrequency(L, H, G), volume0 = fluid.liquidVolume(), samples = [];
  const centre = () => { let s = 0; for (let i = 0; i < fluid.count; i++) s += fluid.positions[3 * i]; return s / fluid.count; };
  const first = centre();
  for (let s = 0; s < Math.round(periods / expected / dt); s++) { fluid.step(); samples.push(centre()); }
  const mean = samples.reduce((x, y) => x + y, 0) / samples.length, crossings = [];
  for (let i = 1; i < samples.length; i++) { const a = samples[i - 1] - mean, b = samples[i] - mean; if ((a > 0 && b <= 0) || (a < 0 && b >= 0)) crossings.push(i - 1 + a / (a - b)); }
  const frequency = (crossings.length - 1) / (2 * (crossings.at(-1) - crossings[0]) * dt);
  const late = samples.slice(-Math.round(1 / expected / dt)).map(x => Math.abs(x - mean));
  return {frequency, expected, crossings: crossings.length, volumeChange: fluid.liquidVolume() / volume0 - 1, decay: Math.max(...late) / Math.abs(first - mean), particles: fluid.count, divergence: fluid.stats.divergence};
}

/** Water 0.1 m deep at rest in a tank 0.2 m long (2D) for one second: the largest particle speed it picks up, against sqrt(g h). */
export function freeSurfaceRest(K, {n = 32, dt = 0.005, seconds = 1} = {}) {
  const L = 0.2, h = L / n;
  const fluid = new K.FreeSurfaceFluid({cells: [n, n, 1], spacing: h, density: 1000, dt, gravity: [0, -G, 0]});
  fluid.addLiquid((x, y) => y < 0.1);
  const volume0 = fluid.liquidVolume();
  fluid.step(Math.round(seconds / dt));
  return {speed: fluid.maxSpeed(), scale: Math.sqrt(G * h), volumeChange: fluid.liquidVolume() / volume0 - 1, hash: hashArrays(fluid.positions, fluid.velocities)};
}
