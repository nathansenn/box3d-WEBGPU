// Cables and frames <-> rigid bodies, checked against closed-form answers. SI units throughout.
// Every tolerance below says where it comes from; the measured values are printed as diagnostics
// and recorded in docs/STRUCTURE_COUPLING.md.
//
// Three facts set most tolerances:
//  - The rigid solver keeps float32 state. One ulp of a position near 2 m is 2.4e-7 m, and the
//    coupling reads the body pose every step.
//  - The cable solver is an implicit-Euler step (first order, numerically damped). The frame solver
//    is the midpoint rule (second order, no numerical damping, so its stiffest modes ring at the step
//    frequency after a sudden load: reactions are averaged over a window, never read at one instant).
//  - The frame's CG and the cable's proximal solve stop at the force tolerances set below.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld} from 'box3d-webgpu-kit';
import {StructureCoupling, STRUCTURE_COUPLING_BACKEND} from 'box3d-webgpu-kit/structure';
import {CompliantCableRuntime, hangingCableDefinition} from 'box3d-webgpu-kit/cable';
import {FrameRuntime} from 'box3d-webgpu-kit/frame';

const G = 9.81, HZ = 240, SUB = 4, DT = 1 / HZ;
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const rel = (actual, expected) => (actual - expected) / expected;
const sci = value => value.toExponential(2);

const newWorld = (options = {}) => createWorld({step: 1 / (options.hz ?? HZ), subSteps: SUB, ground: false, ...(options.gravity ? {gravity: options.gravity} : {})});
const sphere = (world, radius, density, position, extra = {}) => world.createBody({shape: {kind: 'sphere', radius}, position, density, neverSleeps: true, ...extra});
const cableConfig = (overrides = {}) => ({dt: DT, substeps: 1, maxIterations: 2048, residualTolerance: 1e-10, drag: 0, gravity: [0, -G, 0], solver: 'proximal', forceTolerance: 1e-6, ...overrides});
/** The documented order: coupling first, then the rigid step. */
function run(world, coupling, steps, each) {
  for (let i = 0; i < steps; i++) { coupling.step(); world.step(); if (each) each(i); }
}
/** Frequency of a signal from its upward crossings of its own mean, with linear interpolation. */
function frequency(samples, dt) {
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length, crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] < mean && samples[i] >= mean) crossings.push(i - 1 + (mean - samples[i - 1]) / (samples[i] - samples[i - 1]));
  return {hertz: (crossings.length - 1) / ((crossings.at(-1) - crossings[0]) * dt), periods: crossings.length - 1};
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

test('a body hanging from a cable: tension m g, stretch m g L / (E A), support reaction = total weight', async t => {
  // Tolerances. Tension and reaction: 1e-5 relative; at rest the body's own force balance fixes them, what is left is
  // residual motion after settling and float32 mass. Stretch: 5e-7 m absolute, two float32 ulps of a position near 2 m
  // (the lumped cable reproduces the continuum stretch m g L/EA + rho g L^2/(2 EA) exactly).
  // The XPBD backend estimates tension from its last multiplier and needs substeps to converge: 1e-3.
  const L = 2, rho = 0.5, radius = 0.1;
  for (const [name, config, segments, EA, tolerance, stretchTolerance] of [
    ['proximal, 8 segments, EA 1e5', cableConfig(), 8, 1e5, 1e-5, 5e-7],
    ['proximal, 2 segments, EA 1e6', cableConfig(), 2, 1e6, 1e-5, 5e-7],
    ['xpbd, 4 segments x 4 substeps, EA 1e5', {dt: DT, substeps: 4, maxIterations: 256, residualTolerance: 1e-10, drag: 0, gravity: [0, -G, 0]}, 4, 1e5, 1e-3, 2e-6],
  ]) {
    const world = await newWorld();
    try {
      const cable = new CompliantCableRuntime(hangingCableDefinition({segments, length: L, linearDensity: rho, tipMass: 0, axialRigidity: EA, config}));
      const body = sphere(world, radius, 2000, [0, -L, 0], {linearDamping: 8});
      const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
      const attachment = coupling.attachCableToBody(cable, segments, body, {inertia: {kind: 'sphere', radius}});
      run(world, coupling, 6 * HZ);
      world.setDamping(body, 0, 0);
      let tension = 0, reaction = 0;
      const window = HZ / 2;
      run(world, coupling, window, () => { tension += Math.hypot(...attachment.force) / window; reaction += cable.inspect().supportReactions[1] / window; });
      const state = world.getState(body), stretch = -(state.position[1] + L), expected = mass * G * L / EA + rho * G * L * L / (2 * EA);
      t.diagnostic(`${name}: tension ${tension.toFixed(5)} N (m g ${(mass * G).toFixed(5)}, error ${sci(rel(tension, mass * G))}); stretch ${sci(stretch)} m (expected ${sci(expected)}, error ${sci(stretch - expected)} m); reaction error ${sci(rel(reaction, (mass + rho * L) * G))}; speed ${sci(Math.hypot(...state.linearVelocity))} m/s`);
      within(tension, mass * G, tolerance, `${name}: tension = m g`);
      near(stretch, expected, stretchTolerance, `${name}: stretch`);
      within(reaction, (mass + rho * L) * G, tolerance, `${name}: support reaction = weight of body + cable`);
    } finally { world.dispose(); }
  }
});

test('pendulum on a stiff cable: small-angle period; energy only ever falls', async t => {
  // One stiff segment (EA 1e6 N on a 8.4 kg bob), released from 0.1 rad. The cable's half mass rides on the bob, so
  // T = 2 pi sqrt(L/g) (1 + theta0^2/16). Tolerance 0.3%: the implicit-Euler cable step shifts a period by O((omega dt)^2)
  // and damps the swing at (n+1)/(4n) omega^2 dt per second for n rigid substeps (0.0064 /s here), which moves the
  // amplitude-dependent term. Measured 0.12%.
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
    const {hertz, periods} = frequency(xs, DT), expected = 2 * Math.PI * Math.sqrt(L / G) * (1 + theta * theta / 16);
    const swing = energy[0] - Math.min(...energy), scale = world.getState(body).mass * G * L * (1 - Math.cos(theta));
    let rise = 0; for (let i = 1; i < energy.length; i++) rise = Math.max(rise, energy[i] - energy[i - 1]);
    t.diagnostic(`period ${(1 / hertz).toFixed(5)} s over ${periods} periods (expected ${expected.toFixed(5)}, error ${sci(rel(1 / hertz, expected))}); energy lost in 20 s ${sci(swing / scale)} of the swing energy; largest rise between samples ${sci(rise / scale)}`);
    within(1 / hertz, expected, 3e-3, 'pendulum period');
    // Energy: never above the start, never rising between one-second samples by more than float32 noise (1e-4 of the swing energy), and
    // the loss matches the scheme's known damping rate 2 x 0.0064 /s x 20 s = 23% within a factor of 1.5.
    assert.ok(Math.max(...energy) <= energy[0] + 1e-4 * scale, 'energy must not exceed its initial value');
    assert.ok(rise <= 1e-4 * scale, `energy rose by ${rise} J between samples`);
    assert.ok(swing / scale > 0.1 && swing / scale < 0.35, `numerical loss ${swing / scale} is outside the expected band`);
  } finally { world.dispose(); }
});

test('spring pendulum: vertical bounce at sqrt(k/m)/(2 pi), converging with the step', async t => {
  // k = EA/L = 2000 N/m on 4.19 kg plus a third of the cable's 0.1 kg: 3.464 Hz. The cable step is first order, so the
  // error is asserted against the step: 1% at 240 Hz, 0.3% at 480 Hz, 0.15% at 960 Hz, and falling. Measured 0.31%, 0.09%, 0.04%.
  const L = 2, EA = 4000, rho = 0.05, radius = 0.1, errors = [];
  for (const [hz, tolerance] of [[240, 1e-2], [480, 3e-3], [960, 1.5e-3]]) {
    const world = await newWorld({hz});
    try {
      const cable = new CompliantCableRuntime(hangingCableDefinition({segments: 4, length: L, linearDensity: rho, tipMass: 0, axialRigidity: EA, config: cableConfig({dt: 1 / hz})}));
      const body = sphere(world, radius, 1000, [0, -L, 0]);
      const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
      coupling.attachCableToBody(cable, 4, body, {inertia: {kind: 'sphere', radius}});
      const ys = [], energy = [coupling.diagnostics().total];
      run(world, coupling, 3 * hz, i => { ys.push(world.getState(body).position[1]); if (i % (hz / 4) === hz / 4 - 1) energy.push(coupling.diagnostics().total); });
      const {hertz, periods} = frequency(ys, 1 / hz), expected = Math.sqrt(EA / L / (mass + rho * L / 3)) / (2 * Math.PI);
      let rise = 0; for (let i = 1; i < energy.length; i++) rise = Math.max(rise, energy[i] - energy[i - 1]);
      errors.push(Math.abs(rel(hertz, expected)));
      t.diagnostic(`${hz} Hz: bounce ${hertz.toFixed(5)} Hz over ${periods} periods (expected ${expected.toFixed(5)}, error ${sci(rel(hertz, expected))}); energy after 3 s ${(energy.at(-1) - energy[0]).toFixed(4)} J, largest rise ${sci(rise)} J`);
      within(hertz, expected, tolerance, `bounce frequency at ${hz} Hz`);
      assert.ok(rise <= 1e-6, `bounce energy rose by ${rise} J at ${hz} Hz`);
    } finally { world.dispose(); }
  }
  assert.ok(errors[1] < errors[0] && errors[2] < errors[1], `the bounce frequency error must fall with the step: ${errors.map(sci)}`);
});

test('a tether between two bodies in zero gravity conserves momentum; the centre of mass does not accelerate', async t => {
  // A 4 kg box and a 4.24 kg ball joined by a slack 2 m cable (1 kg, 4 segments). The box is thrown away at 1.03 m/s; the
  // tether snaps taut and drags the ball. Two checks:
  //  1. The coupling's own exchange, in float64: every step, the impulses it hands the two bodies, the momentum change of
  //     the cable's interior nodes and of the two end masses riding on the bodies sum to zero. Tolerance 1e-12 kg m/s
  //     (round-off of sums of order 1).
  //  2. The outcome in the rigid solver, which integrates in float32: momentum of bodies + cable holds to 5e-5 kg m/s on
  //     4.1 (1e-5 relative, the accumulated rounding of ~1000 float32 velocity updates). The centre of mass stays within
  //     3e-4 m of its straight line and does not drift off it: the rigid solver moves a body by dt (v + 5/8 dv) in a step
  //     and the cable moves a node by dt (v + dv), so while momentum dP passes between them the centre of mass is off by
  //     up to (3/8) dt dP / M = 7e-4 m at most here, returning as the momentum returns. A free body thrown alongside
  //     shows the solver's own float32 position error.
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
    const control = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [0, 3, 0], density: 500, neverSleeps: true});
    const coupling = new StructureCoupling(world);
    const ends = [coupling.attachCableToBody(cable, 0, a, {inertia: {kind: 'box', halfExtents: half}}), coupling.attachCableToBody(cable, segments, b, {inertia: {kind: 'sphere', radius: 0.15}})];
    const bodyMass = [world.getState(a).mass, world.getState(b).mass], endMass = [masses[0], masses[segments]], throwV = [-1, 0.25, 0];
    world.applyImpulse(a, throwV.map(v => v * bodyMass[0])); world.applyImpulse(control, throwV.map(v => v * bodyMass[0]));
    const start = coupling.diagnostics(), view = cable.couplingViews().velocities;
    const interior = () => [0, 1, 2].map(k => { let p = 0; for (let i = 1; i < segments; i++) p += masses[i] * view[3 * i + k]; return p; });
    const com = () => {
      const sa = world.getState(a), sb = world.getState(b), s = cable.inspect();
      // Bodies, with each cable end's own lumped mass riding on its body, and the interior nodes.
      const out = [0, 0, 0]; let total = 0;
      const add = (m, p) => { total += m; for (let k = 0; k < 3; k++) out[k] += m * p[k]; };
      add(sa.mass + masses[0], sa.position); add(sb.mass + masses[segments], sb.position);
      for (let i = 1; i < segments; i++) add(masses[i], s.positions.subarray(3 * i, 3 * i + 3));
      return out.map(v => v / total);
    };
    const com0 = com(), control0 = world.getState(control).position;
    let drift = 0, peak = 0, comError = 0, exchange = 0, controlError = 0;
    for (let i = 0; i < 4 * HZ; i++) {
      const before = interior();
      coupling.step();
      // Impulse to each body, plus the end mass that rides on it and moves with it (dv = J / m_body for a free body pulled at its centre).
      const after = interior();
      for (let k = 0; k < 3; k++) exchange = Math.max(exchange, Math.abs(after[k] - before[k] + ends.reduce((sum, e, j) => sum + e.force[k] * DT * (1 + endMass[j] / bodyMass[j]), 0)));
      world.step();
      peak = Math.max(peak, ends[1].tension);
      if (i % 20 !== 19) continue;
      const d = coupling.diagnostics(), time = (i + 1) * DT, c = com(), free = world.getState(control).position;
      drift = Math.max(drift, Math.hypot(...d.momentum.map((p, k) => p - start.momentum[k])));
      comError = Math.max(comError, Math.hypot(...c.map((x, k) => x - com0[k] - start.momentum[k] / start.mass * time)));
      controlError = Math.max(controlError, Math.hypot(...free.map((x, k) => x - control0[k] - throwV[k] * time)));
    }
    const finish = coupling.diagnostics(), speedB = Math.hypot(...world.getState(b).linearVelocity);
    t.diagnostic(`momentum ${start.momentum.map(v => v.toFixed(4))} kg m/s; coupling exchange residual ${sci(exchange)} kg m/s per step (float64); largest change in the rigid solver ${sci(drift)} (float32); centre of mass off its straight line by at most ${sci(comError)} m in 4 s (a free body alone: ${sci(controlError)} m); peak tension ${peak.toFixed(1)} N; ball speed ${speedB.toFixed(3)} m/s; energy ${start.total.toFixed(3)} -> ${finish.total.toFixed(3)} J`);
    assert.ok(peak > 10 && speedB > 0.15, 'the tether must have gone taut and pulled the ball');
    near(exchange, 0, 1e-12, 'impulses exchanged between cable and bodies sum to zero');
    near(drift, 0, 5e-5, 'momentum of the pair and the cable');
    near(comError, 0, 3e-4, 'centre of mass on a straight line at constant speed');
    assert.ok(finish.total <= start.total + 1e-6, 'the snap may lose energy but not create it');
  } finally { world.dispose(); }
});

test('off-centre attachment: the cable pull turns the body until its centre of mass hangs under the attachment', async t => {
  // A 0.6 x 0.2 x 0.4 m box hung by one stiff segment from a point a = 0.2 m off centre on its top face.
  // At release, with an inextensible cable, the attachment point cannot accelerate: T0 = m g / (1 + m a^2 / I), the
  // effective mass 1/(1/m + a^2/I) times g, and the body turns at alpha = a T0 / I.
  const L = 1, hx = 0.3, hy = 0.1, hz = 0.2, a = 0.2, world = await newWorld();
  try {
    // EA = 1e9 N: the cable gives way by m_eff/(dt^2 k) = 5e-4 of the ideal tension in the first step. Tolerance 2e-3.
    const cable = new CompliantCableRuntime(hangingCableDefinition({segments: 1, length: L, linearDensity: 0.05, tipMass: 0, axialRigidity: 1e9, config: cableConfig()}));
    const body = world.createBody({shape: {kind: 'box', halfExtents: [hx, hy, hz]}, position: [-a, -L - hy, 0], density: 400, neverSleeps: true});
    const mass = world.getState(body).mass, inertia = mass / 3 * (hx * hx + hy * hy), coupling = new StructureCoupling(world);
    const attachment = coupling.attachCableToBody(cable, 1, body, {inertia: {kind: 'box', halfExtents: [hx, hy, hz]}});
    coupling.step(); world.step();
    const [fx, fy] = attachment.force, first = Math.hypot(fx, fy), alpha = world.getState(body).angularVelocity[2] / DT;
    const expected = mass * G / (1 + mass * a * a / inertia), torque = a * fy - hy * fx;
    t.diagnostic(`release: cable force ${first.toFixed(4)} N (m g/(1 + m a^2/I) = ${expected.toFixed(4)}, error ${sci(rel(first, expected))}; m g = ${(mass * G).toFixed(2)}); angular acceleration ${alpha.toFixed(4)} rad/s^2 ((r x F)/I = ${(torque / inertia).toFixed(4)}, error ${sci(rel(alpha, torque / inertia))}); effective mass ${attachment.effectiveMass.toFixed(4)} kg`);
    within(first, expected, 2e-3, 'cable force at release');
    // Torque = r x F exactly as applied, r = (a, hy) from the centre of mass; what is measured is one float32 velocity: 1e-5.
    within(alpha, torque / inertia, 1e-5, 'angular acceleration = (r x F) / I');
    // The cable sees the body point's effective mass plus its own 0.025 kg end mass; 1e-3 covers how the two combine off-axis.
    within(attachment.effectiveMass, 1 / (1 / mass + a * a / inertia) + 0.025, 1e-3, 'effective mass at the attachment');
    // Equilibrium: the line from the attachment to the centre of mass is vertical, so the box has turned by atan(a/hy).
    world.setDamping(body, 1.5, 3);
    run(world, coupling, 12 * HZ);
    // A cable this stiff turns one float32 ulp of the body's position (1.2e-7 m) into force noise, so the force is a half-second mean.
    let restForce = 0; run(world, coupling, HZ / 2, () => { restForce += Math.hypot(...attachment.force) / (HZ / 2); });
    const state = world.getState(body), angle = 2 * Math.atan2(state.rotation[2], state.rotation[3]), node = cable.inspect().positions;
    t.diagnostic(`rest: turned ${angle.toFixed(6)} rad (atan(a/hy) = ${Math.atan2(a, hy).toFixed(6)}); centre of mass x ${sci(state.position[0])}, attachment x ${sci(node[3])}; cable force ${restForce.toFixed(4)} N (m g ${(mass * G).toFixed(4)})`);
    // 1e-3 rad and 1e-4 m: what is left of the damped swing after 12 s.
    near(angle, Math.atan2(a, hy), 1e-3, 'rotation at rest');
    near(state.position[0], node[3], 1e-4, 'centre of mass under the attachment');
    within(restForce, mass * G, 1e-4, 'cable force at rest');
  } finally { world.dispose(); }
});

/** Lowest root of the clamped beam with a tip point mass: 1 + cos(l) cosh(l) + mu l (cos(l) sinh(l) - sin(l) cosh(l)) = 0. */
function tipMassRoot(mu) {
  const f = l => 1 + Math.cos(l) * Math.cosh(l) + mu * l * (Math.cos(l) * Math.sinh(l) - Math.sin(l) * Math.cosh(l));
  let lo = 0.1, hi = 1.8751;
  for (let i = 0; i < 200; i++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

test('a body clamped to a cantilever tip: static deflection and reactions', async t => {
  // 2 m cantilever (EI 6000 N m^2, 4 kg) with a 4.19 kg ball clamped to its tip, also pinned for comparison.
  // Cubic elements are exact for a tip load and for uniform weight, so the deflection tolerance is the solver's:
  // 1e-6 relative (CG stops at 1e-9 N; settling at drag 200 /s leaves less). Reactions are window means: 1e-5.
  const L = 2, segments = 8, EI = soft.youngModulus * soft.iz, beamMass = soft.density * soft.area * L, radius = 0.1;
  for (const mode of ['clamped', 'pinned']) {
    const world = await newWorld();
    try {
      const frame = new FrameRuntime(beam({section: soft, segments, length: L, drag: 200, support: 'cantilever'}));
      const body = sphere(world, radius, 1000, [L, 0, 0]);
      const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
      const attachment = coupling.attachFrameToBody(frame, segments, body, {mode, inertia: {kind: 'sphere', radius}});
      run(world, coupling, 4 * HZ);
      let force = 0, reaction = 0, moment = 0; const window = HZ / 2;
      run(world, coupling, window, () => { const s = frame.inspect(); force += attachment.force[1] / window; reaction += s.supportReactions[1] / window; moment += s.supportReactions[5] / window; });
      const snapshot = frame.inspect(), tip = snapshot.displacements[6 * segments + 1], state = world.getState(body);
      const expected = -(mass * G * L ** 3 / (3 * EI) + beamMass / L * G * L ** 4 / (8 * EI));
      t.diagnostic(`${mode}: tip ${tip.toFixed(8)} m (expected ${expected.toFixed(8)}, error ${sci(rel(tip, expected))}); body ${sci(state.position[1] - tip)} m from the node; force on body ${force.toFixed(5)} N (m g ${(mass * G).toFixed(5)}); wall force ${reaction.toFixed(4)} N, wall moment ${moment.toFixed(4)} N m (expected ${((mass + beamMass) * G).toFixed(4)}, ${(mass * G * L + beamMass * G * L / 2).toFixed(4)})`);
      within(tip, expected, 1e-6, `${mode}: tip deflection m g L^3/(3 E I) + w L^4/(8 E I)`);
      // The body sits on the node: float32 position (2.4e-7 m near x = 2) plus the Baumgarte remainder.
      near(state.position[1], tip, 1e-6, `${mode}: body on the node`);
      within(force, mass * G, 1e-5, `${mode}: force on the body = m g`);
      within(reaction, (mass + beamMass) * G, 1e-5, `${mode}: wall force = total weight`);
      within(moment, mass * G * L + beamMass * G * L / 2, 1e-5, `${mode}: wall moment`);
    } finally { world.dispose(); }
  }
});

test('a body clamped to a cantilever tip: fundamental frequency and energy over 66 periods', async t => {
  // Released from the undeformed beam, the tip swings about its static deflection.
  // f = sqrt(3 E I / ((m + 0.2357 m_beam) L^3)) / (2 pi) is Rayleigh's estimate; the exact root for a tip point mass is
  // 0.02% lower at this mass ratio. The ball's own rotary inertia (not in either formula) lowers f by a further 0.09%,
  // and the midpoint rule by (omega dt)^2/12 = 0.06%. Tolerance 0.5% against Rayleigh, 0.3% against the exact root.
  const L = 2, segments = 8, EI = soft.youngModulus * soft.iz, beamMass = soft.density * soft.area * L, radius = 0.1, world = await newWorld();
  try {
    const frame = new FrameRuntime(beam({section: soft, segments, length: L, drag: 0, support: 'cantilever'}));
    const body = sphere(world, radius, 1000, [L, 0, 0]);
    const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
    const attachment = coupling.attachFrameToBody(frame, segments, body, {mode: 'clamped', inertia: {kind: 'sphere', radius}});
    const view = frame.couplingViews().displacements, ys = [], energy = [coupling.diagnostics().total];
    let gap = 0;
    run(world, coupling, 20 * HZ, i => { ys.push(view[6 * segments + 1]); gap = Math.max(gap, attachment.gap); if (i % 16 === 15) energy.push(coupling.diagnostics().total); });
    const {hertz, periods} = frequency(ys, DT);
    const rayleigh = Math.sqrt(3 * EI / ((mass + 0.2357 * beamMass) * L ** 3)) / (2 * Math.PI);
    const exact = tipMassRoot(mass / beamMass) ** 2 / (2 * Math.PI * L * L) * Math.sqrt(EI / (soft.density * soft.area));
    // Energy scale: the swing's own energy, (1/2) k delta^2 with delta the static deflection.
    const delta = (Math.max(...ys) - Math.min(...ys)) / 2, scale = 0.5 * 3 * EI / L ** 3 * delta * delta;
    const mean = energy.reduce((a, b) => a + b, 0) / energy.length, spread = Math.max(...energy.map(e => Math.abs(e - energy[0])));
    const half = energy.length >> 1, early = energy.slice(0, half).reduce((a, b) => a + b, 0) / half, late = energy.slice(half).reduce((a, b) => a + b, 0) / (energy.length - half);
    const first = Math.max(...ys.slice(0, HZ)) - Math.min(...ys.slice(0, HZ)), last = Math.max(...ys.slice(-HZ)) - Math.min(...ys.slice(-HZ));
    t.diagnostic(`frequency ${hertz.toFixed(5)} Hz over ${periods} periods (Rayleigh ${rayleigh.toFixed(5)}, error ${sci(rel(hertz, rayleigh))}; exact tip-mass root ${exact.toFixed(5)}, error ${sci(rel(hertz, exact))}); energy within ${sci(spread / scale)} of its start (swing energy ${scale.toFixed(4)} J), mean of the second half minus the first ${sci((late - early) / scale)}; swing ${first.toFixed(6)} -> ${last.toFixed(6)} m; largest gap ${sci(gap)} m; mean ${mean.toFixed(5)} J`);
    within(hertz, rayleigh, 5e-3, 'frequency against Rayleigh');
    within(hertz, exact, 3e-3, 'frequency against the exact tip-mass root');
    // The rigid solver integrates gravity with symplectic Euler: the energy error oscillates with amplitude O(m g v dt) (measured 1.6% of the
    // swing energy here) and does not drift. Asserted: within 6% at every sample, drift between halves below 0.5%, amplitude kept to 0.5%.
    assert.ok(spread <= 0.06 * scale, `energy wandered by ${spread} J`);
    assert.ok(Math.abs(late - early) <= 5e-3 * scale, `energy drifted by ${late - early} J`);
    within(last, first, 5e-3, 'swing amplitude after 66 periods');
    // The body stays on the node: float32 pose and the O(dt^2 a) difference between the two integrators.
    near(gap, 0, 5e-5, 'gap between body and node');
  } finally { world.dispose(); }
});

test('a simply supported beam with a body pinned at midspan: deflection m g L^3/(48 E I), reactions m g/2 each plus beam weight', async t => {
  // 4 m span of the soft section, 8 elements, a 14.1 kg ball pinned to the middle node. Cubic elements are exact for both
  // loads. Deflection 1e-6 relative; reactions 1e-5 as means over half a second (the midpoint rule's stiff modes ring).
  const L = 4, segments = 8, EI = soft.youngModulus * soft.iz, weight = soft.density * soft.area * G, radius = 0.15, world = await newWorld();
  try {
    const frame = new FrameRuntime(beam({section: soft, segments, length: L, drag: 40, support: 'simple'}));
    const body = sphere(world, radius, 1000, [L / 2, 0, 0]);
    const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
    const attachment = coupling.attachFrameToBody(frame, segments / 2, body, {mode: 'pinned', inertia: {kind: 'sphere', radius}});
    run(world, coupling, 5 * HZ);
    let left = 0, right = 0, force = 0; const window = HZ / 2;
    run(world, coupling, window, () => { const s = frame.inspect(); left += s.supportReactions[1] / window; right += s.supportReactions[6 * segments + 1] / window; force += attachment.force[1] / window; });
    const middle = frame.inspect().displacements[6 * (segments / 2) + 1], expected = -(mass * G * L ** 3 / (48 * EI) + 5 * weight * L ** 4 / (384 * EI)), each = mass * G / 2 + weight * L / 2;
    t.diagnostic(`midspan ${middle.toFixed(8)} m (expected ${expected.toFixed(8)}, error ${sci(rel(middle, expected))}); reactions ${left.toFixed(5)}, ${right.toFixed(5)} N (expected ${each.toFixed(5)} each); force on body ${force.toFixed(5)} N (m g ${(mass * G).toFixed(5)})`);
    within(middle, expected, 1e-6, 'midspan deflection');
    within(left, each, 1e-5, 'left reaction'); within(right, each, 1e-5, 'right reaction');
    within(force, mass * G, 1e-5, 'force on the body');
  } finally { world.dispose(); }
});

/** Hang a ball from one stiff cable segment and report how far it strays in two seconds. */
async function hangLight(scheme, density, EA) {
  const world = await newWorld();
  try {
    const cable = new CompliantCableRuntime(hangingCableDefinition({segments: 1, length: 1, linearDensity: 0.05, tipMass: 0, axialRigidity: EA, config: cableConfig()}));
    const body = sphere(world, 0.01, density, [0, -1, 0]);
    const mass = world.getState(body).mass, coupling = new StructureCoupling(world, {scheme});
    const attachment = coupling.attachCableToBody(cable, 1, body, {inertia: {kind: 'sphere', radius: 0.01}});
    let stray = 0, failed = false;
    try { run(world, coupling, 2 * HZ, () => { const y = world.getState(body).position[1]; stray = Math.max(stray, Number.isFinite(y) ? Math.abs(y + 1) : Infinity); }); } catch { failed = true; }
    return {mass, stiffness: DT * DT * EA / mass, stray, failed, tension: Math.hypot(...attachment.force) / (mass * G)};
  } finally { world.dispose(); }
}
/** Clamp a ball to the tip of the soft 2 m cantilever and report how far it strays in two seconds. */
async function tipLight(scheme, density) {
  const world = await newWorld();
  try {
    const frame = new FrameRuntime(beam({section: soft, segments: 8, length: 2, drag: 0, support: 'cantilever'}));
    const body = sphere(world, 0.02, density, [2, 0, 0]);
    const mass = world.getState(body).mass, coupling = new StructureCoupling(world, {scheme});
    coupling.attachFrameToBody(frame, 8, body, {mode: 'clamped', inertia: {kind: 'sphere', radius: 0.02}});
    let stray = 0, failed = false;
    try { run(world, coupling, 2 * HZ, () => { const y = world.getState(body).position[1]; stray = Math.max(stray, Number.isFinite(y) ? Math.abs(y) : Infinity); }); } catch { failed = true; }
    return {mass, stray, failed};
  } finally { world.dispose(); }
}

test('a light body on a stiff structure: naive staggering blows up, the coupling does not', async t => {
  // Naive staggering (the body's motion drives the structure, the structure's reaction returns to the body) is an explicit
  // step of a spring of stiffness k on the body's mass m: unstable once dt^2 k / m exceeds about 4.
  // 1 gram on a cable of EA 1e7 N has dt^2 k / m = 1.7e5.
  const naive = await hangLight('naive-staggered', 240, 1e7), implicit = await hangLight('implicit', 240, 1e7);
  t.diagnostic(`cable, m = ${sci(naive.mass)} kg, dt^2 k/m = ${sci(naive.stiffness)}: naive strays ${sci(naive.stray)} m${naive.failed ? ' and fails' : ''} (tension ${sci(naive.tension)} m g); coupled strays ${sci(implicit.stray)} m (tension ${implicit.tension.toFixed(6)} m g)`);
  assert.ok(naive.failed || naive.stray > 0.1, 'naive staggering should be unstable here');
  // Coupled: the ball stays within a float32 ulp of where it hangs (stretch m g L/EA = 1e-9 m) and the tension is m g to 1e-5.
  assert.ok(!implicit.failed && implicit.stray < 1e-6, `coupled scheme strayed ${implicit.stray} m`);
  near(implicit.tension, 1, 1e-5, 'coupled tension / m g');

  const naiveTip = await tipLight('naive-staggered', 1000), implicitTip = await tipLight('implicit', 1000);
  // Self-weight deflection of the cantilever is 6.5 mm and it swings to twice that.
  t.diagnostic(`frame, m = ${sci(naiveTip.mass)} kg on a 4 kg cantilever: naive strays ${sci(naiveTip.stray)} m${naiveTip.failed ? ' and fails' : ''}; coupled strays ${sci(implicitTip.stray)} m (the beam's own swing)`);
  assert.ok(naiveTip.failed || naiveTip.stray > 0.1, 'naive staggering on the frame should be unstable here');
  assert.ok(!implicitTip.failed && implicitTip.stray < 0.014, `coupled scheme strayed ${implicitTip.stray} m`);

  // Measured stability map of the coupled scheme: 9 decades of mass, cables up to EA = 1e9 N. All must hold.
  const rows = [];
  for (const density of [1e-3, 1, 1e3, 2e5]) for (const EA of [1e3, 1e6, 1e9]) {
    const r = await hangLight('implicit', density, EA);
    rows.push(`m ${sci(r.mass)} kg, EA ${sci(EA)} N, dt^2 k/m ${sci(r.stiffness)}: ${r.failed ? 'FAILED' : `stray ${sci(r.stray)} m`}`);
    // The ball may bounce on a soft cable (the static stretch (m + cable end mass) g L / EA, doubled when released, is the bound), never more.
    assert.ok(!r.failed && r.stray <= 2.05 * (r.mass + 0.025) * G / EA + 1e-6, `coupled cable unstable at m = ${r.mass}, EA = ${EA}: ${r.stray}`);
  }
  for (const density of [1e-3, 1, 1e5]) {
    const r = await tipLight('implicit', density);
    rows.push(`frame tip, m ${sci(r.mass)} kg: ${r.failed ? 'FAILED' : `stray ${sci(r.stray)} m`}`);
    const bound = 2.05 * (r.mass * G * 8 / (3 * 6000) + 2 * G * 16 / (8 * 6000));
    assert.ok(!r.failed && r.stray <= bound + 1e-6, `coupled frame unstable at m = ${r.mass}: ${r.stray} > ${bound}`);
  }
  for (const row of rows) t.diagnostic(row);
});

test('a body on a cable on a frame: the chain carries the weight down to the wall', async t => {
  // A 4.19 kg ball hangs on a 1 m cable (0.2 kg) from the tip of the soft cantilever. Statics: tension m g at the ball,
  // tip load (m + m_cable) g, deflection (m + m_cable) g L^3/(3 E I) + w L^4/(8 E I). Tolerances as above; the tip also
  // carries the cable's lumped end mass through the attachment, so this checks that bookkeeping.
  const L = 2, segments = 8, EI = soft.youngModulus * soft.iz, beamMass = soft.density * soft.area * L, radius = 0.1, world = await newWorld();
  try {
    const frame = new FrameRuntime(beam({section: soft, segments, length: L, drag: 200, support: 'cantilever'}));
    const length = 1, rho = 0.2, parts = 2, positions = [], masses = [], constraints = [];
    for (let i = 0; i <= parts; i++) { positions.push(L, -length * i / parts, 0); masses.push(rho * length / parts * (i === 0 || i === parts ? 0.5 : 1)); if (i) constraints.push({a: i - 1, b: i, restLength: length / parts, compliance: length / (parts * 1e6)}); }
    const cable = new CompliantCableRuntime({config: cableConfig(), positions, masses, constraints});
    const body = sphere(world, radius, 1000, [L, -length, 0], {linearDamping: 4});
    const mass = world.getState(body).mass, coupling = new StructureCoupling(world);
    const top = coupling.attachCableToFrame(cable, 0, frame, segments);
    const bottom = coupling.attachCableToBody(cable, parts, body, {inertia: {kind: 'sphere', radius}});
    run(world, coupling, 5 * HZ);
    let pull = 0, hold = 0, reaction = 0; const window = HZ / 2;
    run(world, coupling, window, () => { pull += top.force[1] / window; hold += bottom.force[1] / window; reaction += frame.inspect().supportReactions[1] / window; });
    const tip = frame.inspect().displacements[6 * segments + 1], expected = -((mass + rho * length) * G * L ** 3 / (3 * EI) + beamMass / L * G * L ** 4 / (8 * EI));
    t.diagnostic(`tip ${tip.toFixed(8)} m (expected ${expected.toFixed(8)}, error ${sci(rel(tip, expected))}); cable on tip ${pull.toFixed(5)} N (expected ${(-(mass + rho * length) * G).toFixed(5)}); cable on ball ${hold.toFixed(5)} N (expected ${(mass * G).toFixed(5)}); wall ${reaction.toFixed(4)} N (expected ${((mass + rho * length + beamMass) * G).toFixed(4)})`);
    // 2e-5: the tip deflection now also carries the cable's float32-noisy pull (the ball's pose feeds a 1e6 N cable).
    within(tip, expected, 2e-5, 'tip deflection under ball + cable');
    within(pull, -(mass + rho * length) * G, 2e-5, 'cable pull on the tip = weight of ball + cable');
    // The cable's lumped end mass rides on the ball; the attachment force is net of its weight.
    within(hold, mass * G, 2e-5, 'net cable force on the ball = m g');
    within(reaction, (mass + rho * length + beamMass) * G, 2e-5, 'wall reaction = everything');
  } finally { world.dispose(); }
});

test('a kinematic body drives a frame node: a propped cantilever with a raised support', async t => {
  // A kinematic hook pinned to the tip of the soft cantilever is raised by d = 10 mm in one second and held. The tip follows
  // the hook, and the hook carries the propped-cantilever reaction R = 3 E I d / L^3 + 3 w L / 8 (the body feels -R).
  // Tolerances: tip position 1e-6 m (float32 hook pose near x = 2); force 2e-5 as a half-second mean, after 2 s at drag 50 /s.
  const L = 2, segments = 8, EI = soft.youngModulus * soft.iz, weight = soft.density * soft.area * G, world = await newWorld();
  try {
    const frame = new FrameRuntime(beam({section: soft, segments, length: L, drag: 50, support: 'cantilever'}));
    const hook = world.createBody({shape: {kind: 'sphere', radius: 0.05}, type: 'kinematic', position: [L, 0, 0]});
    const coupling = new StructureCoupling(world);
    const attachment = coupling.attachFrameToBody(frame, segments, hook, {mode: 'pinned', inertia: {kind: 'locked'}});
    let y = 0, lag = 0;
    for (let i = 0; i < HZ; i++) { y += 0.01 * DT; world.moveKinematic(hook, [L, y, 0]); coupling.step(); world.step(); lag = Math.max(lag, attachment.gap); }
    world.setVelocity(hook, [0, 0, 0]);
    run(world, coupling, 2 * HZ);
    let force = 0; const window = HZ / 2;
    run(world, coupling, window, () => { force += attachment.force[1] / window; });
    const tip = frame.inspect().displacements[6 * segments + 1], hookY = world.getState(hook).position[1], expected = -(3 * EI * hookY / L ** 3 + 3 * weight * L / 8);
    t.diagnostic(`hook at ${hookY.toFixed(8)} m, tip at ${tip.toFixed(8)} m; force on the hook ${force.toFixed(5)} N (expected ${expected.toFixed(5)}, error ${sci(rel(force, expected))}); largest lag while moving ${sci(lag)} m`);
    near(tip, hookY, 1e-6, 'the tip follows the hook');
    within(force, expected, 2e-5, 'propped-cantilever reaction');
    // While the hook moves at 0.01 m/s the node trails it by v dt / beta = 2.1e-4 m at most (velocity constraint, Baumgarte 0.2).
    assert.ok(lag < 2.5e-4, `the node trailed the hook by ${lag} m`);
  } finally { world.dispose(); }
});

/** A cable-stayed span: an 8 m steel deck on a pin and a roller, two stays from a tower top (a fixed point 3 m above
 * midspan) to the deck at x = 2 and x = 6, and a ball pinned to a deck node. */
async function staySpan(world, {drag}) {
  const L = 8, segments = 8, towerX = 4, towerY = 3, stayEA = 5e6, stayRho = 0.2, radius = 0.15;
  const frame = new FrameRuntime(beam({section: steel, segments, length: L, drag, support: 'simple'}));
  const coupling = new StructureCoupling(world);
  const stays = [2, 6].map(x => {
    const length = Math.hypot(x - towerX, towerY);
    const cable = new CompliantCableRuntime({config: cableConfig({maxIterations: 64, forceTolerance: 1e-9, residualTolerance: 1e-12}),
      positions: [towerX, towerY, 0, x, 0, 0], masses: [stayRho * length / 2, stayRho * length / 2], pinned: [1, 0], constraints: [{a: 0, b: 1, restLength: length, compliance: length / stayEA}]});
    return {cable, length, x, attachment: coupling.attachCableToFrame(cable, 1, frame, x), endMass: stayRho * length / 2};
  });
  const body = sphere(world, radius, 1000, [1, 0, 0]);
  const mass = world.getState(body).mass;
  const weight = (mass + steel.density * steel.area * L + stays.reduce((sum, s) => sum + stayRho * s.length, 0)) * G;
  return {L, segments, towerX, towerY, stayEA, radius, frame, coupling, stays, body, mass, weight};
}
/** Hand statics by the flexibility method: the deck is a simply supported beam (influence function of a point load,
 * self-weight deflection, axial shortening from the stays' horizontal pulls), each stay a spring L/EA along its chord.
 * Two unknown tensions from two compatibility equations: stay stretch = shortening of its chord. */
function stayStatics(span, loadX) {
  const {L, towerX, towerY, stayEA, mass} = span, EI = steel.youngModulus * steel.iz, EA = steel.youngModulus * steel.area, w = steel.density * steel.area * G;
  const influence = (x, a) => { const b = L - a; return x <= a ? b * x * (L * L - b * b - x * x) / (6 * L * EI) : a * (L - x) * (L * L - a * a - (L - x) ** 2) / (6 * L * EI); };
  const self = x => w * x * (L ** 3 - 2 * L * x * x + x ** 3) / (24 * EI);
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

test('a cable-stayed span carrying a body along the deck: stay forces and deflection match hand statics, reactions carry the weight', async t => {
  // The 14.1 kg ball is pinned to each interior deck node in turn (detached, moved, re-attached, left to settle 2 s).
  // Everything measured is a mean over the last quarter second. Tolerances: stay tension 2e-4 relative and deflection
  // under the load 2e-4 relative + 1e-7 m against the flexibility-method solution, whose own error is its linearised stay
  // geometry (the deck moves about 1 mm under 3.6 m stays: 3e-4 of the stretch at most); total vertical reaction 5e-5 of
  // the 1385 N total weight at every position (what the deck's ringing leaves in a quarter-second mean).
  const world = await newWorld();
  try {
    const span = await staySpan(world, {drag: 60}), {frame, coupling, stays, body, segments, radius} = span;
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
      t.diagnostic(`ball at x = ${node} m: stays ${tension.map(v => v.toFixed(3))} N (hand ${hand.tensions.map(v => v.toFixed(3))}); deflection under the ball ${sci(deflection)} m (hand ${sci(hand.deflection(node))}); total reaction ${reaction.toFixed(4)} N (weight ${span.weight.toFixed(4)})`);
      tension.forEach((value, i) => { worstTension = Math.max(worstTension, Math.abs(rel(value, hand.tensions[i]))); within(value, hand.tensions[i], 2e-4, `stay ${i} tension with the ball at ${node} m`); });
      worstDeflection = Math.max(worstDeflection, Math.abs(rel(deflection, hand.deflection(node))));
      near(deflection, hand.deflection(node), 2e-4 * Math.abs(hand.deflection(node)) + 1e-7, `deck deflection under the ball at ${node} m`);
      worstReaction = Math.max(worstReaction, Math.abs(rel(reaction, span.weight)));
      within(reaction, span.weight, 5e-5, `total vertical reaction with the ball at ${node} m`);
    }
    t.diagnostic(`worst over 7 positions: tension ${sci(worstTension)}, deflection ${sci(worstDeflection)}, reaction ${sci(worstReaction)}`);
  } finally { world.dispose(); }
});

test('determinism: a mixed scene repeats bit for bit', async t => {
  // The stayed span with the ball at x = 3 m plus a second ball swinging on a cable from the deck: every kind of attachment.
  const once = async () => {
    const world = await newWorld();
    try {
      const span = await staySpan(world, {drag: 0}), {frame, coupling, stays, body, radius} = span;
      world.setTransform(body, [3, 0, 0]);
      coupling.attachFrameToBody(frame, 3, body, {mode: 'clamped', inertia: {kind: 'sphere', radius}});
      const cable = new CompliantCableRuntime({config: cableConfig(), positions: [5, 0, 0, 5.3, -0.4, 0, 5.6, -0.8, 0], masses: [0.05, 0.1, 0.05],
        constraints: [{a: 0, b: 1, restLength: 0.5, compliance: 0.5 / 1e5}, {a: 1, b: 2, restLength: 0.5, compliance: 0.5 / 1e5}]});
      const swing = world.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.05, 0.08]}, position: [5.6, -0.85, 0], density: 800, neverSleeps: true});
      coupling.attachCableToFrame(cable, 0, frame, 5);
      coupling.attachCableToBody(cable, 2, swing, {inertia: {kind: 'box', halfExtents: [0.1, 0.05, 0.08]}});
      run(world, coupling, HZ);
      const f = frame.inspect(), parts = [f.displacements, f.velocities, cable.inspect().positions, cable.inspect().velocities, ...stays.map(s => s.cable.inspect().positions)];
      for (const b of [body, swing]) { const s = world.getState(b); parts.push(Float64Array.from([...s.position, ...s.rotation, ...s.linearVelocity, ...s.angularVelocity])); }
      return {bytes: Buffer.concat(parts.map(p => Buffer.from(p.buffer, p.byteOffset, p.byteLength))), hash: world.exactHash(), energy: coupling.diagnostics().total, tick: coupling.tick};
    } finally { world.dispose(); }
  };
  const a = await once(), b = await once();
  t.diagnostic(`${a.bytes.length} bytes of frame, cable and body state after ${a.tick} steps; world hash ${a.hash}`);
  assert.ok(a.bytes.equals(b.bytes), 'frame, cable and body state must repeat bit for bit');
  assert.equal(a.hash, b.hash); assert.equal(a.energy, b.energy);
  assert.ok(Number.isFinite(a.energy));
});

test('the API refuses what it cannot couple', async () => {
  const world = await newWorld();
  try {
    assert.equal(typeof STRUCTURE_COUPLING_BACKEND, 'string');
    assert.throws(() => new StructureCoupling({}), TypeError);
    assert.throws(() => new StructureCoupling(world, {dt: 1 / 60}), /world fixed step/);
    assert.throws(() => new StructureCoupling(world, {baumgarte: 3}), /baumgarte/);
    const coupling = new StructureCoupling(world), body = sphere(world, 0.1, 1000, [0, -1, 0]), inertia = {kind: 'sphere', radius: 0.1};
    const cable = () => new CompliantCableRuntime(hangingCableDefinition({segments: 2, length: 1, linearDensity: 0.1, tipMass: 0, axialRigidity: 1e4, config: cableConfig()}));
    assert.throws(() => coupling.addCable(new CompliantCableRuntime(hangingCableDefinition({segments: 2, length: 1, linearDensity: 0.1, tipMass: 0, axialRigidity: 1e4, config: cableConfig({dt: 1 / 120})}))), /cable dt/);
    assert.throws(() => coupling.addFrame(new FrameRuntime({...beam({section: soft, segments: 2, length: 1, drag: 0, support: 'cantilever'}), config: frameConfig(0, {substeps: 2})})), /substeps = 1/);
    const c = cable();
    assert.throws(() => coupling.attachCableToBody(c, 0, body, {inertia}), /free cable node/, 'a fixed anchor cannot be attached');
    assert.throws(() => coupling.attachCableToBody(c, 9, body, {inertia}), /out of range/);
    assert.throws(() => coupling.attachCableToBody(c, 2, body, {}), /inertia/);
    const attachment = coupling.attachCableToBody(c, 2, body, {inertia});
    assert.throws(() => coupling.attachCableToBody(c, 2, body, {inertia}), /already attached/);
    assert.equal(coupling.reports.length, 1);
    // Detaching gives the node its own mass back; destroying a body detaches it.
    coupling.step(); world.step();
    assert.ok(c.couplingViews().masses[2] > 1, 'the attached node carries the effective mass');
    coupling.detach(attachment);
    assert.equal(c.couplingViews().masses[2], 0.025); assert.equal(attachment.attached, false); assert.equal(coupling.reports.length, 0);
    const again = coupling.attachCableToBody(c, 2, body, {inertia});
    world.destroyBody(body); coupling.step(); world.step();
    assert.equal(again.attached, false); assert.equal(coupling.reports.length, 0);
    assert.equal(c.couplingViews().masses[2], 0.025);
  } finally { world.dispose(); }
});
