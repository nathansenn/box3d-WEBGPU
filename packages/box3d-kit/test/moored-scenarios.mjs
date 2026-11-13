// Set-ups for a floating body held by a cable, shared by test/v17-moored.test.mjs (which asserts on them) and
// validation/domains/simulation.mjs (which reports them). A spar buoy on a taut vertical elastic tether, built by hand
// from the kit's public pieces so that the link between the water and the structure coupling can be left out
// (`linked: false`: the scheme before the link existed). SI units. Nothing here measures wall-clock time.
// `K` is {createWorld, createSimulation, waterSubsystem, structureSubsystem, linkWaterToStructure, WaterCoupling,
// StructureCoupling, CompliantCableRuntime}.

export const G = 9.81, RHO = 1000;
/** The spar and its tether. Half extents 0.1 x 1 x 0.1 m (waterplane 0.04 m^2), 32 kg; the tether runs from the bed
 * to the centre of the spar's lower face, rest length 2.4 m, E A = 2400 N (1000 N/m); the basin is 8 m x 8 m and 4 m
 * deep. A slender spar on a soft tether, so that the water's own answer to the heave (which the closed form leaves
 * out) is small. */
export const SPAR = Object.freeze({half: [0.1, 1, 0.1], density: 400, depth: 4, restLength: 2.4, axialRigidity: 2400, nodeMass: 0.024, cells: 16, cell: 0.5});

/** Closed-form equilibrium: rho g A d - (m + m_n) g = (E A / L0) s, with the spar's lower face at L0 + s and the
 * draught d = level - (L0 + s). The level is the rest depth plus (V - V0) / (basin area), V0 the volume the spar
 * displaced when the run started. Linear in s. */
export function sparEquilibrium(mass, startDraught) {
  const {half, depth, restLength: L0, axialRigidity: EA, nodeMass, cells, cell} = SPAR, A = 4 * half[0] * half[2], basin = (cells * cell) ** 2, k = EA / L0, kh = RHO * G * A;
  // level = depth + A (d - d0) / basin and d = level - L0 - s  =>  d (1 - A / basin) = depth - A d0 / basin - L0 - s.
  const share = 1 - A / basin, offset = depth - A * startDraught / basin - L0;
  // kh (offset - s) / share - (m + m_n) g = k s
  const stretch = (kh * offset / share - (mass + nodeMass) * G) / (k + kh / share), draught = (offset - stretch) / share;
  return {stretch, draught, tension: k * stretch, buoyancy: kh * draught, tetherStiffness: k, hydrostaticStiffness: kh, waterplane: A,
    // Heave about that state: the tether and the hydrostatic spring act together on the spar and the tether's upper
    // node. No added mass: the coupling has none.
    frequency: Math.sqrt((k + kh) / (mass + nodeMass)) / (2 * Math.PI), frequencyTetherOnly: Math.sqrt(k / (mass + nodeMass)) / (2 * Math.PI)};
}

async function build(K, {hz = 240, linked = true, linearDrag = 0, waterDrag = 0, start = null, kick = 0} = {}) {
  const {half, density, depth, restLength, axialRigidity, nodeMass, cells, cell} = SPAR, dt = 1 / hz, side = cells * cell / 2;
  const world = await K.createWorld({step: dt, subSteps: 4, ground: false});
  // Start where the closed form puts it unless told otherwise, so that a run at rest stays at rest.
  const mass0 = density * 8 * half[0] * half[1] * half[2], guess = sparEquilibrium(mass0, 1.375), bottom = start ?? restLength + guess.stretch;
  const shape = {kind: 'box', halfExtents: half};
  const spar = world.createBody({shape, position: [0, bottom + half[1], 0], density, neverSleeps: true, lockRotation: true, linearVelocity: [0, kick, 0]});
  const water = new K.WaterCoupling(world, {cols: cells, rows: cells, dx: cell, dz: cell, restDepth: depth, origin: [-side, 0, -side], waterDrag});
  water.attach(spar, shape, {dragCoefficient: 0, linearDrag});
  const cable = new K.CompliantCableRuntime({
    config: {dt, substeps: 1, maxIterations: 64, residualTolerance: 1e-12, drag: 0, gravity: [0, -G, 0], solver: 'proximal', forceTolerance: 1e-9},
    positions: [0, 0, 0, 0, bottom, 0], masses: [nodeMass, nodeMass], pinned: [1, 0],
    constraints: [{a: 0, b: 1, restLength, compliance: restLength / axialRigidity}],
  });
  const structure = new K.StructureCoupling(world);
  structure.addCable(cable);
  const attachment = structure.attachCableToBody(cable, 1, spar, {inertia: {kind: 'locked'}, localPoint: [0, -half[1], 0]});
  if (linked) K.linkWaterToStructure(water, structure);
  const sim = K.createSimulation(world).add(K.structureSubsystem(structure, {bodies: [spar]})).add(K.waterSubsystem(water));
  const startDraught = depth - bottom;
  return {world, sim, spar, water, cable, attachment, dt, hz, startDraught, dispose: () => { cable.destroy(); world.dispose(); }};
}

/** The spar brought to rest by drag, then read over the last half second. */
export async function sparAtRest(K, {hz = 240, linked = true, seconds = 6} = {}) {
  const b = await build(K, {hz, linked, linearDrag: 600, waterDrag: 2});
  try {
    const {world, sim, spar, water, cable, attachment} = b, steps = Math.round(seconds * hz), window = Math.round(hz / 2), half = SPAR.half;
    const mean = {tension: 0, force: 0, y: 0, volume: 0, level: 0, speed: 0}; let failed = null;
    try {
      for (let i = 0; i < steps; i++) {
        sim.step();
        if (i < steps - window) continue;
        const s = world.getState(spar), report = water.report(spar);
        mean.tension += cable.inspect().tensions[0] / window; mean.force += attachment.force[1] / window; mean.y += s.position[1] / window;
        mean.volume += report.submergedVolume / window; mean.level += water.elevationAt(0, 0) / window; mean.speed += Math.abs(s.linearVelocity[1]) / window;
      }
    } catch (error) { failed = error.code ?? error.message; }
    const mass = world.getState(spar).mass, exact = sparEquilibrium(mass, b.startDraught), draught = SPAR.depth + mean.level - (mean.y - half[1]);
    const buoyancy = RHO * G * mean.volume;
    return {hz, linked, failed, mass, tension: mean.tension, exactTension: exact.tension, tensionError: mean.tension / exact.tension - 1, draught, exactDraught: exact.draught, draughtError: draught - exact.draught,
      // Force balance with the measured displaced volume: buoyancy - weight = tension (+ the upper node's weight on the cable side).
      forceOnSpar: mean.force, balanceForce: -(buoyancy - mass * G), balanceTension: buoyancy - (mass + SPAR.nodeMass) * G, speed: mean.speed,
      lag: buoyancy / mass / (hz * hz), bias: SPAR.nodeMass * buoyancy / (mass + SPAR.nodeMass), exact};
  } finally { b.dispose(); }
}

/** Heave: started at the closed-form equilibrium with a small vertical speed, no drag. Frequency from the upward
 * crossings of the mean, and how the swing changes from the first to the last period. */
export async function sparHeave(K, {hz = 240, linked = true, seconds = 6, kick = 0.05} = {}) {
  const b = await build(K, {hz, linked, kick});
  try {
    const {world, sim, spar, cable} = b, steps = Math.round(seconds * hz), samples = [], tensions = []; let failed = null, slack = 0;
    try {
      for (let i = 0; i < steps; i++) { sim.step(); samples.push(world.getState(spar).position[1]); const t = cable.inspect().tensions[0]; tensions.push(t); if (!(t > 0)) slack++; }
    } catch (error) { failed = error.code ?? error.message; }
    const mass = world.getState(spar).mass, exact = sparEquilibrium(mass, b.startDraught), mean = samples.reduce((a, v) => a + v, 0) / samples.length, crossings = [];
    for (let i = 1; i < samples.length; i++) if (samples[i - 1] < mean && samples[i] >= mean) crossings.push(i - 1 + (mean - samples[i - 1]) / (samples[i] - samples[i - 1]));
    const frequency = crossings.length > 1 ? (crossings.length - 1) / ((crossings.at(-1) - crossings[0]) * b.dt) : NaN, period = Math.round(hz / exact.frequency);
    const swing = from => { let lo = Infinity, hi = -Infinity; for (let i = from; i < from + period && i < samples.length; i++) { lo = Math.min(lo, samples[i]); hi = Math.max(hi, samples[i]); } return (hi - lo) / 2; };
    const first = swing(0), last = swing(samples.length - period), meanTension = tensions.reduce((a, v) => a + v, 0) / tensions.length;
    return {hz, linked, failed, mass, frequency, exact: exact.frequency, error: frequency / exact.frequency - 1, tetherOnly: exact.frequencyTetherOnly, expectedAmplitude: kick / (2 * Math.PI * exact.frequency),
      first, last, growth: last / first, meanOffset: mean - (SPAR.restLength + exact.stretch + SPAR.half[1]), meanTension, tensionError: meanTension / exact.tension - 1, slack, periods: crossings.length - 1};
  } finally { b.dispose(); }
}
