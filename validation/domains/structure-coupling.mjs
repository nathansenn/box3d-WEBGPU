// Cables and frames <-> rigid bodies (box3d-webgpu-kit/structure), against closed-form statics and dynamics.
// Set-ups are those of packages/box3d-kit/test/v11-structure.test.mjs: SI units, 240 Hz, 4 sub-steps.
import {kit, memo, defineCases, relative, absolute, lower, frequency, order} from '../lib.mjs';

const G = 9.81, HZ = 240, SUB = 4, DT = 1 / HZ;
const FILE = 'packages/box3d-kit/test/v11-structure.test.mjs';
const T = {
  hang: 'a body hanging from a cable: tension m g, stretch m g L / (E A), support reaction = total weight',
  pendulum: 'pendulum on a stiff cable: small-angle period; energy only ever falls',
  bounce: 'spring pendulum: vertical bounce at sqrt(k/m)/(2 pi), converging with the step',
  tether: 'a tether between two bodies in zero gravity conserves momentum; the centre of mass does not accelerate',
  offCentre: 'off-centre attachment: the cable pull turns the body until its centre of mass hangs under the attachment',
  tipStatic: 'a body clamped to a cantilever tip: static deflection and reactions',
  tipDynamic: 'a body clamped to a cantilever tip: fundamental frequency and energy over 66 periods',
  midspan: 'a simply supported beam with a body pinned at midspan: deflection m g L^3/(48 E I), reactions m g/2 each plus beam weight',
  chain: 'a body on a cable on a frame: the chain carries the weight down to the wall',
  hook: 'a kinematic body drives a frame node: a propped cantilever with a raised support',
  stays: 'a cable-stayed span carrying a body along the deck: stay forces and deflection match hand statics, reactions carry the weight',
};

const modules = () => memo('structure/modules', async () => {
  const [{createWorld}, {StructureCoupling}, {CompliantCableRuntime, hangingCableDefinition}, {FrameRuntime}] = await Promise.all([kit('index'), kit('structure'), kit('cable'), kit('frame')]);
  return {createWorld, StructureCoupling, CompliantCableRuntime, hangingCableDefinition, FrameRuntime};
});
const newWorld = async (options = {}) => (await modules()).createWorld({step: 1 / (options.hz ?? HZ), subSteps: SUB, ground: false, ...(options.gravity ? {gravity: options.gravity} : {})});
const sphere = (world, radius, density, position, extra = {}) => world.createBody({shape: {kind: 'sphere', radius}, position, density, neverSleeps: true, ...extra});
const cableConfig = (overrides = {}) => ({dt: DT, substeps: 1, maxIterations: 2048, residualTolerance: 1e-10, drag: 0, gravity: [0, -G, 0], solver: 'proximal', forceTolerance: 1e-6, ...overrides});
/** The documented order: coupling first, then the rigid step. */
function run(world, coupling, steps, each) {
  for (let i = 0; i < steps; i++) { coupling.step(); world.step(); if (each) each(i); }
}

// Frame sections. `soft` is the one tests/engine/frame.test.mjs validates the frame solver with.
const soft = {youngModulus: 2e9, shearModulus: 8e8, area: 0.002, iy: 1e-6, iz: 3e-6, torsionConstant: 2e-6, density: 1000, up: [0, 1, 0]};
const steel = {youngModulus: 2e11, shearModulus: 8e10, area: 0.002, iy: 1e-6, iz: 3e-6, torsionConstant: 2e-6, density: 7850, up: [0, 1, 0]};
const frameConfig = (drag, overrides = {}) => ({dt: DT, substeps: 1, maxIterations: 1024, drag, gravity: [0, -G, 0], forceTolerance: 1e-9, momentTolerance: 1e-9, impulseTolerance: 1e-10, angularImpulseTolerance: 1e-10, ...overrides});
/** A straight beam along x. 'cantilever' clamps node 0; 'simple' pins node 0 and puts the last node on a roller. */
function beam({section, segments, length, drag, support}) {
  const positions = new Float64Array(3 * (segments + 1)), fixed = new Uint8Array(6 * (segments + 1)), elements = [];
  for (let i = 0; i <= segments; i++) { positions[3 * i] = length * i / segments; if (i) elements.push({...section, a: i - 1, b: i}); }
  if (support === 'cantilever') fixed.fill(1, 0, 6);
  else { fixed[0] = fixed[1] = fixed[2] = fixed[3] = 1; fixed[6 * segments + 1] = fixed[6 * segments + 2] = 1; }
  return {config: frameConfig(drag), positions, fixed, elements};
}
const EI = soft.youngModulus * soft.iz;

const hanging = () => memo('structure/hanging', async () => {
  const {StructureCoupling, CompliantCableRuntime, hangingCableDefinition} = await modules();
  const L = 2, rho = 0.5, radius = 0.1, segments = 8, EA = 1e5, world = await newWorld();
  try {
    const cable = new CompliantCableRuntime(hangingCableDefinition({segments, length: L, linearDensity: rho, tipMass: 0, axialRigidity: EA, config: cableConfig()}));
    const body = sphere(world, radius, 2000, [0, -L, 0], {linearDamping: 8});
    const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
    const attachment = coupling.attachCableToBody(cable, segments, body, {inertia: {kind: 'sphere', radius}});
    run(world, coupling, 6 * HZ);
    world.setDamping(body, 0, 0);
    let tension = 0, reaction = 0;
    const window = HZ / 2;
    run(world, coupling, window, () => { tension += Math.hypot(...attachment.force) / window; reaction += cable.inspect().supportReactions[1] / window; });
    return {tension, weight: mass * G, stretch: -(world.getState(body).position[1] + L), expectedStretch: mass * G * L / EA + rho * G * L * L / (2 * EA), reaction, total: (mass + rho * L) * G};
  } finally { world.dispose(); }
});

const cablePendulum = () => memo('structure/pendulum', async () => {
  const {StructureCoupling, CompliantCableRuntime, hangingCableDefinition} = await modules();
  const L = 2, radius = 0.1, theta = 0.1, world = await newWorld();
  try {
    const definition = hangingCableDefinition({segments: 1, length: L, linearDensity: 0.05, tipMass: 0, axialRigidity: 1e6, config: cableConfig()});
    definition.positions[3] = L * Math.sin(theta); definition.positions[4] = -L * Math.cos(theta);
    const cable = new CompliantCableRuntime(definition);
    const body = sphere(world, radius, 2000, [L * Math.sin(theta), -L * Math.cos(theta), 0]);
    const coupling = new StructureCoupling(world);
    coupling.attachCableToBody(cable, 1, body, {inertia: {kind: 'sphere', radius}});
    const xs = [], energy = [coupling.diagnostics().total];
    run(world, coupling, 20 * HZ, i => { xs.push(world.getState(body).position[0]); if (i % HZ === HZ - 1) energy.push(coupling.diagnostics().total); });
    const scale = world.getState(body).mass * G * L * (1 - Math.cos(theta));
    let rise = 0; for (let i = 1; i < energy.length; i++) rise = Math.max(rise, energy[i] - energy[i - 1]);
    return {period: 1 / frequency(xs, DT), rise: rise / scale};
  } finally { world.dispose(); }
});

const bounce = hz => memo(`structure/bounce/${hz}`, async () => {
  const {StructureCoupling, CompliantCableRuntime, hangingCableDefinition} = await modules();
  const L = 2, EA = 4000, rho = 0.05, radius = 0.1, world = await newWorld({hz});
  try {
    const cable = new CompliantCableRuntime(hangingCableDefinition({segments: 4, length: L, linearDensity: rho, tipMass: 0, axialRigidity: EA, config: cableConfig({dt: 1 / hz})}));
    const body = sphere(world, radius, 1000, [0, -L, 0]);
    const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
    coupling.attachCableToBody(cable, 4, body, {inertia: {kind: 'sphere', radius}});
    const ys = [];
    run(world, coupling, 3 * hz, () => { ys.push(world.getState(body).position[1]); });
    const expected = Math.sqrt(EA / L / (mass + rho * L / 3)) / (2 * Math.PI), hertz = frequency(ys, 1 / hz);
    return {hertz, expected, error: Math.abs(hertz / expected - 1)};
  } finally { world.dispose(); }
});

const tether = () => memo('structure/tether', async () => {
  const {StructureCoupling, CompliantCableRuntime} = await modules();
  const world = await newWorld({gravity: [0, 0, 0]});
  try {
    const segments = 4, L = 2, rho = 0.5, EA = 1e5, gap = 1.6;
    const positions = new Float64Array(3 * (segments + 1)), masses = new Float64Array(segments + 1), constraints = [];
    for (let i = 0; i <= segments; i++) {
      positions[3 * i] = gap * i / segments; masses[i] = rho * L / segments * (i === 0 || i === segments ? 0.5 : 1);
      if (i) constraints.push({a: i - 1, b: i, restLength: L / segments, compliance: L / (segments * EA)});
    }
    const cable = new CompliantCableRuntime({config: cableConfig({gravity: [0, 0, 0]}), positions, masses, constraints});
    const half = [0.1, 0.1, 0.1];
    const a = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [0, 0, 0], density: 500, neverSleeps: true});
    const b = sphere(world, 0.15, 300, [gap, 0, 0]);
    const coupling = new StructureCoupling(world);
    const ends = [coupling.attachCableToBody(cable, 0, a, {inertia: {kind: 'box', halfExtents: half}}), coupling.attachCableToBody(cable, segments, b, {inertia: {kind: 'sphere', radius: 0.15}})];
    const bodyMass = [world.getState(a).mass, world.getState(b).mass], endMass = [masses[0], masses[segments]], throwV = [-1, 0.25, 0];
    world.applyImpulse(a, throwV.map(v => v * bodyMass[0]));
    const start = coupling.diagnostics(), view = cable.couplingViews().velocities;
    const interior = () => [0, 1, 2].map(k => { let p = 0; for (let i = 1; i < segments; i++) p += masses[i] * view[3 * i + k]; return p; });
    const com = () => {
      const sa = world.getState(a), sb = world.getState(b), s = cable.inspect();
      const out = [0, 0, 0]; let total = 0;
      const put = (m, p) => { total += m; for (let k = 0; k < 3; k++) out[k] += m * p[k]; };
      put(sa.mass + masses[0], sa.position); put(sb.mass + masses[segments], sb.position);
      for (let i = 1; i < segments; i++) put(masses[i], s.positions.subarray(3 * i, 3 * i + 3));
      return out.map(v => v / total);
    };
    const com0 = com();
    let drift = 0, comError = 0, exchange = 0;
    for (let i = 0; i < 4 * HZ; i++) {
      const before = interior();
      coupling.step();
      const after = interior();
      for (let k = 0; k < 3; k++) exchange = Math.max(exchange, Math.abs(after[k] - before[k] + ends.reduce((sum, e, j) => sum + e.force[k] * DT * (1 + endMass[j] / bodyMass[j]), 0)));
      world.step();
      if (i % 20 !== 19) continue;
      const d = coupling.diagnostics(), time = (i + 1) * DT, c = com();
      drift = Math.max(drift, Math.hypot(...d.momentum.map((p, k) => p - start.momentum[k])));
      comError = Math.max(comError, Math.hypot(...c.map((x, k) => x - com0[k] - start.momentum[k] / start.mass * time)));
    }
    return {exchange, drift, comError};
  } finally { world.dispose(); }
});

const offCentre = () => memo('structure/off-centre', async () => {
  const {StructureCoupling, CompliantCableRuntime, hangingCableDefinition} = await modules();
  const L = 1, hx = 0.3, hy = 0.1, hz = 0.2, a = 0.2, world = await newWorld();
  try {
    const cable = new CompliantCableRuntime(hangingCableDefinition({segments: 1, length: L, linearDensity: 0.05, tipMass: 0, axialRigidity: 1e9, config: cableConfig()}));
    const body = world.createBody({shape: {kind: 'box', halfExtents: [hx, hy, hz]}, position: [-a, -L - hy, 0], density: 400, neverSleeps: true});
    const mass = world.getState(body).mass, inertia = mass / 3 * (hx * hx + hy * hy), coupling = new StructureCoupling(world);
    const attachment = coupling.attachCableToBody(cable, 1, body, {inertia: {kind: 'box', halfExtents: [hx, hy, hz]}});
    coupling.step(); world.step();
    const [fx, fy] = attachment.force, first = Math.hypot(fx, fy), alpha = world.getState(body).angularVelocity[2] / DT;
    const result = {first, expectedFirst: mass * G / (1 + mass * a * a / inertia), alpha, expectedAlpha: (a * fy - hy * fx) / inertia};
    world.setDamping(body, 1.5, 3);
    run(world, coupling, 12 * HZ);
    let restForce = 0; run(world, coupling, HZ / 2, () => { restForce += Math.hypot(...attachment.force) / (HZ / 2); });
    const state = world.getState(body);
    return {...result, angle: 2 * Math.atan2(state.rotation[2], state.rotation[3]), expectedAngle: Math.atan2(a, hy), restForce, weight: mass * G};
  } finally { world.dispose(); }
});

const tipStatic = () => memo('structure/tip-static', async () => {
  const {StructureCoupling, FrameRuntime} = await modules();
  const L = 2, segments = 8, beamMass = soft.density * soft.area * L, radius = 0.1, world = await newWorld();
  try {
    const frame = new FrameRuntime(beam({section: soft, segments, length: L, drag: 200, support: 'cantilever'}));
    const body = sphere(world, radius, 1000, [L, 0, 0]);
    const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
    const attachment = coupling.attachFrameToBody(frame, segments, body, {mode: 'clamped', inertia: {kind: 'sphere', radius}});
    run(world, coupling, 4 * HZ);
    let force = 0, reaction = 0, moment = 0; const window = HZ / 2;
    run(world, coupling, window, () => { const s = frame.inspect(); force += attachment.force[1] / window; reaction += s.supportReactions[1] / window; moment += s.supportReactions[5] / window; });
    return {
      tip: frame.inspect().displacements[6 * segments + 1], expectedTip: -(mass * G * L ** 3 / (3 * EI) + beamMass / L * G * L ** 4 / (8 * EI)),
      reaction, expectedReaction: (mass + beamMass) * G, moment, expectedMoment: mass * G * L + beamMass * G * L / 2, force, weight: mass * G,
    };
  } finally { world.dispose(); }
});

/** Lowest root of the clamped beam with a tip point mass: 1 + cos(l) cosh(l) + mu l (cos(l) sinh(l) - sin(l) cosh(l)) = 0. */
function tipMassRoot(mu) {
  const f = l => 1 + Math.cos(l) * Math.cosh(l) + mu * l * (Math.cos(l) * Math.sinh(l) - Math.sin(l) * Math.cosh(l));
  let lo = 0.1, hi = 1.8751;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

const tipDynamic = () => memo('structure/tip-dynamic', async () => {
  const {StructureCoupling, FrameRuntime} = await modules();
  const L = 2, segments = 8, beamMass = soft.density * soft.area * L, radius = 0.1, world = await newWorld();
  try {
    const frame = new FrameRuntime(beam({section: soft, segments, length: L, drag: 0, support: 'cantilever'}));
    const body = sphere(world, radius, 1000, [L, 0, 0]);
    const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
    coupling.attachFrameToBody(frame, segments, body, {mode: 'clamped', inertia: {kind: 'sphere', radius}});
    const view = frame.couplingViews().displacements, ys = [];
    run(world, coupling, 20 * HZ, () => { ys.push(view[6 * segments + 1]); });
    const first = Math.max(...ys.slice(0, HZ)) - Math.min(...ys.slice(0, HZ)), last = Math.max(...ys.slice(-HZ)) - Math.min(...ys.slice(-HZ));
    return {
      hertz: frequency(ys, DT), first, last,
      rayleigh: Math.sqrt(3 * EI / ((mass + 0.2357 * beamMass) * L ** 3)) / (2 * Math.PI),
      exact: tipMassRoot(mass / beamMass) ** 2 / (2 * Math.PI * L * L) * Math.sqrt(EI / (soft.density * soft.area)),
    };
  } finally { world.dispose(); }
});

const midspan = () => memo('structure/midspan', async () => {
  const {StructureCoupling, FrameRuntime} = await modules();
  const L = 4, segments = 8, weight = soft.density * soft.area * G, radius = 0.15, world = await newWorld();
  try {
    const frame = new FrameRuntime(beam({section: soft, segments, length: L, drag: 40, support: 'simple'}));
    const body = sphere(world, radius, 1000, [L / 2, 0, 0]);
    const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
    coupling.attachFrameToBody(frame, segments / 2, body, {mode: 'pinned', inertia: {kind: 'sphere', radius}});
    run(world, coupling, 5 * HZ);
    let left = 0; const window = HZ / 2;
    run(world, coupling, window, () => { left += frame.inspect().supportReactions[1] / window; });
    return {middle: frame.inspect().displacements[6 * (segments / 2) + 1], expected: -(mass * G * L ** 3 / (48 * EI) + 5 * weight * L ** 4 / (384 * EI)), left, each: mass * G / 2 + weight * L / 2};
  } finally { world.dispose(); }
});

const chain = () => memo('structure/chain', async () => {
  const {StructureCoupling, FrameRuntime, CompliantCableRuntime} = await modules();
  const L = 2, segments = 8, beamMass = soft.density * soft.area * L, radius = 0.1, world = await newWorld();
  try {
    const frame = new FrameRuntime(beam({section: soft, segments, length: L, drag: 200, support: 'cantilever'}));
    const length = 1, rho = 0.2, parts = 2, positions = [], masses = [], constraints = [];
    for (let i = 0; i <= parts; i++) { positions.push(L, -length * i / parts, 0); masses.push(rho * length / parts * (i === 0 || i === parts ? 0.5 : 1)); if (i) constraints.push({a: i - 1, b: i, restLength: length / parts, compliance: length / (parts * 1e6)}); }
    const cable = new CompliantCableRuntime({config: cableConfig(), positions, masses, constraints});
    const body = sphere(world, radius, 1000, [L, -length, 0], {linearDamping: 4});
    const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
    coupling.attachCableToFrame(cable, 0, frame, segments);
    coupling.attachCableToBody(cable, parts, body, {inertia: {kind: 'sphere', radius}});
    run(world, coupling, 5 * HZ);
    let reaction = 0; const window = HZ / 2;
    run(world, coupling, window, () => { reaction += frame.inspect().supportReactions[1] / window; });
    return {tip: frame.inspect().displacements[6 * segments + 1], expectedTip: -((mass + rho * length) * G * L ** 3 / (3 * EI) + beamMass / L * G * L ** 4 / (8 * EI)), reaction, expectedReaction: (mass + rho * length + beamMass) * G};
  } finally { world.dispose(); }
});

const hook = () => memo('structure/hook', async () => {
  const {StructureCoupling, FrameRuntime} = await modules();
  const L = 2, segments = 8, weight = soft.density * soft.area * G, world = await newWorld();
  try {
    const frame = new FrameRuntime(beam({section: soft, segments, length: L, drag: 50, support: 'cantilever'}));
    const body = world.createBody({shape: {kind: 'sphere', radius: 0.05}, type: 'kinematic', position: [L, 0, 0]});
    const coupling = new StructureCoupling(world);
    const attachment = coupling.attachFrameToBody(frame, segments, body, {mode: 'pinned', inertia: {kind: 'locked'}});
    let y = 0;
    for (let i = 0; i < HZ; i++) { y += 0.01 * DT; world.moveKinematic(body, [L, y, 0]); coupling.step(); world.step(); }
    world.setVelocity(body, [0, 0, 0]);
    run(world, coupling, 2 * HZ);
    let force = 0; const window = HZ / 2;
    run(world, coupling, window, () => { force += attachment.force[1] / window; });
    const hookY = world.getState(body).position[1];
    return {force, expected: -(3 * EI * hookY / L ** 3 + 3 * weight * L / 8), gap: Math.abs(frame.inspect().displacements[6 * segments + 1] - hookY)};
  } finally { world.dispose(); }
});

/** Hand statics of the cable-stayed span by the flexibility method (see the test file for the derivation). */
function stayStatics(span, loadX) {
  const {L, towerX, towerY, stayEA, mass} = span, EIs = steel.youngModulus * steel.iz, EA = steel.youngModulus * steel.area, w = steel.density * steel.area * G;
  const influence = (x, a) => { const b = L - a; return x <= a ? b * x * (L * L - b * b - x * x) / (6 * L * EIs) : a * (L - x) * (L * L - a * a - (L - x) ** 2) / (6 * L * EIs); };
  const self = x => w * x * (L ** 3 - 2 * L * x * x + x ** 3) / (24 * EIs);
  const stays = span.stays.map(s => ({x: s.x, length: s.length, cx: (towerX - s.x) / s.length, cy: towerY / s.length, end: s.endMass * G}));
  const A = [[0, 0], [0, 0]], b = [0, 0];
  for (let i = 0; i < 2; i++) {
    let sag = self(stays[i].x) + mass * G * influence(stays[i].x, loadX);
    for (const s of stays) sag += s.end * influence(stays[i].x, s.x);
    b[i] = sag * stays[i].cy;
    for (let j = 0; j < 2; j++) A[i][j] = stays[j].cy * influence(stays[i].x, stays[j].x) * stays[i].cy + stays[j].cx * Math.min(stays[i].x, stays[j].x) / EA * stays[i].cx + (i === j ? stays[i].length / stayEA : 0);
  }
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0], tensions = [(b[0] * A[1][1] - b[1] * A[0][1]) / det, (A[0][0] * b[1] - A[1][0] * b[0]) / det];
  const deflection = x => -self(x) - mass * G * influence(x, loadX) + stays.reduce((sum, s, j) => sum + (tensions[j] * s.cy - s.end) * influence(x, s.x), 0);
  return {tensions, deflection};
}

const stayedSpan = () => memo('structure/stays', async () => {
  const {StructureCoupling, FrameRuntime, CompliantCableRuntime} = await modules();
  const world = await newWorld();
  try {
    const L = 8, segments = 8, towerX = 4, towerY = 3, stayEA = 5e6, stayRho = 0.2, radius = 0.15;
    const frame = new FrameRuntime(beam({section: steel, segments, length: L, drag: 60, support: 'simple'}));
    const coupling = new StructureCoupling(world);
    const stays = [2, 6].map(x => {
      const length = Math.hypot(x - towerX, towerY);
      const cable = new CompliantCableRuntime({config: cableConfig({maxIterations: 64, forceTolerance: 1e-9, residualTolerance: 1e-12}),
        positions: [towerX, towerY, 0, x, 0, 0], masses: [stayRho * length / 2, stayRho * length / 2], pinned: [1, 0], constraints: [{a: 0, b: 1, restLength: length, compliance: length / stayEA}]});
      coupling.attachCableToFrame(cable, 1, frame, x);
      return {cable, length, x, endMass: stayRho * length / 2};
    });
    const body = sphere(world, radius, 1000, [1, 0, 0]);
    const mass = world.getState(body).mass;
    const span = {L, towerX, towerY, stayEA, mass, stays};
    const weight = (mass + steel.density * steel.area * L + stays.reduce((sum, s) => sum + stayRho * s.length, 0)) * G;
    let attachment = null, worstTension = 0, worstDeflection = 0, worstReaction = 0;
    for (let node = 1; node < segments; node++) {
      if (attachment) coupling.detach(attachment);
      const u = frame.couplingViews().displacements;
      world.setTransform(body, [node + u[6 * node], u[6 * node + 1], 0]); world.setVelocity(body, [0, 0, 0]);
      attachment = coupling.attachFrameToBody(frame, node, body, {mode: 'pinned', inertia: {kind: 'sphere', radius}});
      run(world, coupling, Math.round(1.75 * HZ));
      const window = HZ / 4, tension = [0, 0]; let reaction = 0, deflection = 0;
      run(world, coupling, window, () => {
        const s = frame.inspect(); reaction += (s.supportReactions[1] + s.supportReactions[6 * segments + 1]) / window; deflection += s.displacements[6 * node + 1] / window;
        stays.forEach((stay, i) => { const c = stay.cable.inspect(); tension[i] += c.tensions[0] / window; reaction += c.supportReactions[1] / window; });
      });
      const hand = stayStatics(span, node);
      tension.forEach((value, i) => { worstTension = Math.max(worstTension, Math.abs(value / hand.tensions[i] - 1)); });
      worstDeflection = Math.max(worstDeflection, Math.abs(deflection / hand.deflection(node) - 1));
      worstReaction = Math.max(worstReaction, Math.abs(reaction / weight - 1));
    }
    return {worstTension, worstDeflection, worstReaction};
  } finally { world.dispose(); }
});

const BALL = 1000 * 4 / 3 * Math.PI * 1e-3;   // the 0.1 m sphere of density 1000 used on the frames, kg
export default defineCases('structure-coupling', FILE, [
  {id: 'structure.hanging.tension', title: 'Hanging body: cable tension', quantity: 'tension at an 8.4 kg ball on a 2 m cable (8 segments, EA = 1e5 N), half-second mean', unit: 'N', test: T.hang,
    reference: {formula: 'T = m g', value: 2 * BALL * G}, tolerance: relative(1e-5),
    measure: async () => { const r = await hanging(); return {value: r.tension, reference: r.weight}; }},
  {id: 'structure.hanging.stretch', title: 'Hanging body: cable stretch', quantity: 'elongation of the cable under the ball and its own weight', unit: 'm', test: T.hang,
    reference: {formula: 'dL = m g L / (E A) + rho g L^2 / (2 E A)', value: 2 * BALL * G * 2 / 1e5 + 0.5 * G * 4 / 2e5}, tolerance: absolute(5e-7),
    note: 'Two float32 ulps of a position near 2 m.',
    measure: async () => { const r = await hanging(); return {value: r.stretch, reference: r.expectedStretch}; }},
  {id: 'structure.hanging.reaction', title: 'Hanging body: support reaction', quantity: 'vertical reaction at the cable anchor', unit: 'N', test: T.hang,
    reference: {formula: 'R = (m + rho L) g', value: (2 * BALL + 1) * G}, tolerance: relative(1e-5),
    measure: async () => { const r = await hanging(); return {value: r.reaction, reference: r.total}; }},
  {id: 'structure.cable-pendulum.period', title: 'Pendulum on a stiff cable: period', quantity: 'period of a ball on a 2 m cable released at 0.1 rad, mean over 20 s', unit: 's', test: T.pendulum,
    reference: {formula: 'T = 2 pi sqrt(L / g) (1 + theta0^2 / 16)', value: 2 * Math.PI * Math.sqrt(2 / G) * (1 + 0.01 / 16)}, tolerance: relative(3e-3),
    note: 'The implicit-Euler cable step shifts a period by O((omega dt)^2) and damps the swing.', measure: async () => (await cablePendulum()).period},
  {id: 'structure.cable-pendulum.energy', title: 'Pendulum on a stiff cable: energy never rises', quantity: 'largest rise of the total energy between one-second samples, as a fraction of the swing energy', unit: '1', test: T.pendulum,
    reference: {formula: 'E(t + 1 s) - E(t) <= 0', value: 0}, tolerance: {kind: 'upper', value: 1e-4}, note: 'Float32 noise of the rigid solver: 1e-4 of the swing energy.',
    measure: async () => (await cablePendulum()).rise},
  {id: 'structure.bounce.240', title: 'Spring pendulum: bounce frequency at 240 Hz', quantity: 'vertical bounce frequency of a ball on an elastic cable (k = 2000 N/m)', unit: 'Hz', test: T.bounce,
    reference: {formula: 'f = sqrt(k / (m + rho L / 3)) / (2 pi)', value: Math.sqrt(2000 / (BALL + 0.1 / 3)) / (2 * Math.PI)}, tolerance: relative(1e-2),
    measure: async () => { const r = await bounce(240); return {value: r.hertz, reference: r.expected}; }},
  {id: 'structure.bounce.960', title: 'Spring pendulum: bounce frequency at 960 Hz', quantity: 'the same frequency with a four times smaller step', unit: 'Hz', test: T.bounce,
    reference: {formula: 'f = sqrt(k / (m + rho L / 3)) / (2 pi)', value: Math.sqrt(2000 / (BALL + 0.1 / 3)) / (2 * Math.PI)}, tolerance: relative(1.5e-3),
    measure: async () => { const r = await bounce(960); return {value: r.hertz, reference: r.expected}; }},
  {id: 'structure.bounce.order', title: 'Spring pendulum: observed order in the step', quantity: 'convergence order of the frequency error from 240 Hz to 960 Hz', unit: '1', test: T.bounce,
    reference: {formula: 'log(e_240 / e_960) / log(4) = 1 (implicit Euler)', value: 1}, tolerance: lower(1),
    note: 'The test asserts only that the error falls at each halving of the step (order above 0); the measured order is reported.',
    measure: async () => order((await bounce(240)).error, (await bounce(960)).error, 4)},
  {id: 'structure.tether.exchange', title: 'Tether in zero gravity: impulse exchange', quantity: 'largest per-step sum of the impulses exchanged between cable and bodies (float64)', unit: 'kg m/s', test: T.tether,
    reference: {formula: 'sum of J = 0', value: 0}, tolerance: absolute(1e-12), measure: async () => (await tether()).exchange},
  {id: 'structure.tether.momentum', title: 'Tether in zero gravity: momentum', quantity: 'largest change of the momentum of two bodies and the cable over 4 s (float32 rigid solver)', unit: 'kg m/s', test: T.tether,
    reference: {formula: '|p(t) - p(0)| = 0', value: 0}, tolerance: absolute(5e-5), measure: async () => (await tether()).drift},
  {id: 'structure.tether.centre-of-mass', title: 'Tether in zero gravity: centre of mass', quantity: 'largest distance of the centre of mass from its straight line over 4 s', unit: 'm', test: T.tether,
    reference: {formula: '|x_cm(t) - x_cm(0) - v_cm t| = 0', value: 0}, tolerance: absolute(3e-4),
    note: 'The two integrators place a moving mass differently within a step, by up to (3/8) dt dP / M while momentum passes between them.',
    measure: async () => (await tether()).comError},
  {id: 'structure.off-centre.release-force', title: 'Off-centre attachment: cable force at release', quantity: 'cable force in the first step on a box hung 0.2 m off centre', unit: 'N', test: T.offCentre,
    reference: {formula: 'T0 = m g / (1 + m a^2 / I)', value: null}, tolerance: relative(2e-3),
    measure: async () => { const r = await offCentre(); return {value: r.first, reference: r.expectedFirst}; }},
  {id: 'structure.off-centre.angular-acceleration', title: 'Off-centre attachment: angular acceleration', quantity: 'angular acceleration of the box in the first step', unit: 'rad/s^2', test: T.offCentre,
    reference: {formula: 'alpha = (r x F) / I', value: null}, tolerance: relative(1e-5),
    measure: async () => { const r = await offCentre(); return {value: r.alpha, reference: r.expectedAlpha}; }},
  {id: 'structure.off-centre.rest-angle', title: 'Off-centre attachment: rotation at rest', quantity: 'angle the box has turned once its centre of mass hangs under the attachment', unit: 'rad', test: T.offCentre,
    reference: {formula: 'theta = atan(a / h_y)', value: Math.atan2(0.2, 0.1)}, tolerance: absolute(1e-3), measure: async () => (await offCentre()).angle},
  {id: 'structure.cantilever.tip-deflection', title: 'Body clamped to a cantilever tip: deflection', quantity: 'tip deflection of a 2 m cantilever (EI = 6000 N m^2) carrying a 4.19 kg ball', unit: 'm', test: T.tipStatic,
    reference: {formula: 'u = -(m g L^3 / (3 E I) + w L^4 / (8 E I))', value: -(BALL * G * 8 / (3 * EI) + 2 * G * 16 / (8 * EI))}, tolerance: relative(1e-6),
    note: 'Cubic elements are exact for a tip load and for uniform weight, so this is the solver tolerance.',
    measure: async () => { const r = await tipStatic(); return {value: r.tip, reference: r.expectedTip}; }},
  {id: 'structure.cantilever.wall-force', title: 'Body clamped to a cantilever tip: wall force', quantity: 'vertical reaction at the clamp, half-second mean', unit: 'N', test: T.tipStatic,
    reference: {formula: 'R = (m + m_beam) g', value: (BALL + 4) * G}, tolerance: relative(1e-5),
    measure: async () => { const r = await tipStatic(); return {value: r.reaction, reference: r.expectedReaction}; }},
  {id: 'structure.cantilever.wall-moment', title: 'Body clamped to a cantilever tip: wall moment', quantity: 'moment at the clamp, half-second mean', unit: 'N m', test: T.tipStatic,
    reference: {formula: 'M = m g L + m_beam g L / 2', value: BALL * G * 2 + 4 * G}, tolerance: relative(1e-5),
    measure: async () => { const r = await tipStatic(); return {value: r.moment, reference: r.expectedMoment}; }},
  {id: 'structure.cantilever.tip-mass-frequency', title: 'Cantilever with a tip mass: fundamental frequency', quantity: 'frequency of the tip over 20 s (66 periods)', unit: 'Hz', test: T.tipDynamic,
    reference: {formula: '1 + cos(l) cosh(l) + mu l (cos(l) sinh(l) - sin(l) cosh(l)) = 0, f = l^2 sqrt(E I / (rho A)) / (2 pi L^2)', value: null}, tolerance: relative(3e-3),
    note: 'The exact root is for a point mass; the ball\'s rotary inertia lowers f by 0.09% and the midpoint rule by 0.06%.',
    measure: async () => { const r = await tipDynamic(); return {value: r.hertz, reference: r.exact}; }},
  {id: 'structure.cantilever.rayleigh-frequency', title: 'Cantilever with a tip mass: Rayleigh estimate', quantity: 'the same frequency against Rayleigh\'s estimate', unit: 'Hz', test: T.tipDynamic,
    reference: {formula: 'f = sqrt(3 E I / ((m + 0.2357 m_beam) L^3)) / (2 pi)', value: Math.sqrt(3 * EI / ((BALL + 0.2357 * 4) * 8)) / (2 * Math.PI)}, tolerance: relative(5e-3),
    measure: async () => { const r = await tipDynamic(); return {value: r.hertz, reference: r.rayleigh}; }},
  {id: 'structure.cantilever.amplitude', title: 'Cantilever with a tip mass: amplitude kept', quantity: 'peak-to-peak swing in the last second of 20 s, against the first second', unit: 'm', test: T.tipDynamic,
    reference: {formula: 'swing(19..20 s) = swing(0..1 s)', value: null}, tolerance: relative(5e-3),
    measure: async () => { const r = await tipDynamic(); return {value: r.last, reference: r.first}; }},
  {id: 'structure.midspan.deflection', title: 'Simply supported beam with a body at midspan: deflection', quantity: 'midspan deflection of a 4 m span carrying a 14.1 kg ball', unit: 'm', test: T.midspan,
    reference: {formula: 'u = -(m g L^3 / (48 E I) + 5 w L^4 / (384 E I))', value: -(1000 * 4 / 3 * Math.PI * 0.15 ** 3 * G * 64 / (48 * EI) + 5 * 2 * G * 256 / (384 * EI))}, tolerance: relative(1e-6),
    measure: async () => { const r = await midspan(); return {value: r.middle, reference: r.expected}; }},
  {id: 'structure.midspan.reaction', title: 'Simply supported beam with a body at midspan: reaction', quantity: 'left support reaction, half-second mean', unit: 'N', test: T.midspan,
    reference: {formula: 'R = m g / 2 + w L / 2', value: 1000 * 4 / 3 * Math.PI * 0.15 ** 3 * G / 2 + 2 * G * 2}, tolerance: relative(1e-5),
    measure: async () => { const r = await midspan(); return {value: r.left, reference: r.each}; }},
  {id: 'structure.chain.tip-deflection', title: 'Body on a cable on a cantilever: tip deflection', quantity: 'tip deflection with a ball hanging on a 1 m cable (0.2 kg) from the tip', unit: 'm', test: T.chain,
    reference: {formula: 'u = -((m + m_cable) g L^3 / (3 E I) + w L^4 / (8 E I))', value: -((BALL + 0.2) * G * 8 / (3 * EI) + 2 * G * 16 / (8 * EI))}, tolerance: relative(2e-5),
    measure: async () => { const r = await chain(); return {value: r.tip, reference: r.expectedTip}; }},
  {id: 'structure.chain.wall-force', title: 'Body on a cable on a cantilever: wall force', quantity: 'vertical reaction at the clamp, half-second mean', unit: 'N', test: T.chain,
    reference: {formula: 'R = (m + m_cable + m_beam) g', value: (BALL + 0.2 + 4) * G}, tolerance: relative(2e-5),
    measure: async () => { const r = await chain(); return {value: r.reaction, reference: r.expectedReaction}; }},
  {id: 'structure.hook.reaction', title: 'Propped cantilever with a raised support', quantity: 'force on a kinematic hook that lifts the tip by 10 mm, half-second mean', unit: 'N', test: T.hook,
    reference: {formula: 'F = -(3 E I d / L^3 + 3 w L / 8)', value: -(3 * EI * 0.01 / 8 + 3 * 2 * G * 2 / 8)}, tolerance: relative(2e-5),
    measure: async () => { const r = await hook(); return {value: r.force, reference: r.expected}; }},
  {id: 'structure.hook.follow', title: 'Propped cantilever: the tip follows the hook', quantity: 'distance between the frame tip and the hook at rest', unit: 'm', test: T.hook,
    reference: {formula: '|u_tip - y_hook| = 0', value: 0}, tolerance: absolute(1e-6), note: 'Float32 hook pose near x = 2 m.', measure: async () => (await hook()).gap},
  {id: 'structure.stayed-span.tension', title: 'Cable-stayed span: stay tensions', quantity: 'worst relative error of the two stay tensions with the ball at each of 7 deck nodes', unit: '1', test: T.stays,
    reference: {formula: 'flexibility method: |T / T_hand - 1| = 0', value: 0}, tolerance: absolute(2e-4),
    note: 'The hand solution linearises the stay geometry (3e-4 of the stretch at most).', measure: async () => (await stayedSpan()).worstTension},
  {id: 'structure.stayed-span.deflection', title: 'Cable-stayed span: deflection under the load', quantity: 'worst relative error of the deck deflection under the ball over 7 positions', unit: '1', test: T.stays,
    reference: {formula: 'flexibility method: |u / u_hand - 1| = 0', value: 0}, tolerance: absolute(2e-4), note: 'The test allows a further 1e-7 m on each deflection; it is not needed here.', measure: async () => (await stayedSpan()).worstDeflection},
  {id: 'structure.stayed-span.reaction', title: 'Cable-stayed span: total vertical reaction', quantity: 'worst relative error of the summed support and tower reactions over 7 positions', unit: '1', test: T.stays,
    reference: {formula: '|sum R / (total weight) - 1| = 0', value: 0}, tolerance: absolute(5e-5), measure: async () => (await stayedSpan()).worstReaction},
]);
