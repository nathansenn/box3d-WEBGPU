// Rigid bodies <-> water, checked against closed-form answers. SI units throughout.
// Every tolerance below says where it comes from; the measured values are printed as diagnostics
// and recorded in docs/WATER_COUPLING.md.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld} from 'box3d-webgpu-kit';
import {WaterCoupling, WATER_COUPLING_BACKEND} from 'box3d-webgpu-kit/coupling';
import {createClosedWaterArrays, stepClosedWaterCpu} from 'box3d-webgpu-kit/water';

const G = 9.81, RHO = 1000, HZ = 240, SUB = 4, DT = 1 / HZ;
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const rel = (actual, expected) => (actual - expected) / expected;
const sci = value => value.toExponential(2);

/** A square basin centred on the world origin with its floor at y = 0. `floor` adds a static slab under it. */
async function scene({cells, cell, depth, floor = false, waterDrag = 0, hz = HZ}) {
  const world = await createWorld({step: 1 / hz, subSteps: SUB, ground: false});
  const side = cells * cell;
  if (floor) world.createBody({shape: {kind: 'box', halfExtents: [side / 2, 0.5, side / 2]}, type: 'static', position: [0, -0.5, 0]});
  const water = new WaterCoupling(world, {cols: cells, rows: cells, dx: cell, dz: cell, restDepth: depth, origin: [-side / 2, 0, -side / 2], waterDrag});
  return {world, water, area: side * side, depth, hz};
}
/** The documented order: coupling first, then the rigid step. */
function run({world, water, hz}, seconds, each) {
  const steps = Math.round(seconds * hz);
  for (let i = 1; i <= steps; i++) { water.step(); world.step(); if (each) each(i); }
}
const add = ({world, water}, shape, body, options) => {
  const handle = world.createBody({shape, ...body});
  return {handle, shape, report: water.attach(handle, shape, options)};
};
/** Height h of the spherical cap that holds `fraction` of a sphere of radius r: h^2 (3r - h) = 4 fraction r^3. */
function capHeight(r, fraction) {
  let lo = 0, hi = 2 * r;
  for (let i = 0; i < 200; i++) { const h = (lo + hi) / 2; if (h * h * (3 * r - h) < 4 * fraction * r ** 3) lo = h; else hi = h; }
  return (lo + hi) / 2;
}

test('Archimedes: a box, a sphere and a capsule float with submerged fraction rho_b / rho_w', async t => {
  // 16 m x 16 m x 2 m basin. Bottom friction 0.5 /s and 400 N s/m of linear drag only make the release
  // transient die out; neither acts at rest. Tolerance 1e-4 on the fraction: the submerged volume is exact
  // geometry, so what is left after 30 s is the residual bobbing plus float32 mass and pose (about 1e-6).
  const s = await scene({cells: 32, cell: 0.5, depth: 2, waterDrag: 0.5});
  try {
    const box = add(s, {kind: 'box', halfExtents: [0.5, 0.3, 0.5]}, {position: [-4, 2.05, -4], density: 600}, {linearDrag: 400});
    const ball = add(s, {kind: 'sphere', radius: 0.4}, {position: [4, 2.2, -4], density: 300}, {linearDrag: 400});
    // Axis horizontal (local y turned onto world x): at rho_b = rho_w / 2 the axis lies in the waterline.
    const pill = add(s, {kind: 'capsule', radius: 0.25, halfLength: 0.5}, {position: [0, 2.1, 4], density: 500, rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2]}, {linearDrag: 400});
    run(s, 30);
    const level = body => s.depth + s.water.elevationAt(...[0, 2].map(i => s.world.getState(body.handle).position[i]));
    for (const [name, body, density] of [['box', box, 600], ['sphere', ball, 300], ['capsule', pill, 500]]) {
      const state = s.world.getState(body.handle);
      t.diagnostic(`${name}: submerged fraction ${body.report.submergedFraction.toFixed(7)} (expected ${density / RHO}), error ${sci(body.report.submergedFraction - density / RHO)}, speed ${sci(Math.hypot(...state.linearVelocity))} m/s`);
      near(body.report.submergedFraction, density / RHO, 1e-4, `${name} submerged fraction`);
      // Buoyancy carries the weight.
      within(body.report.buoyancy[1], state.mass * G, 1e-4, `${name} buoyancy = weight`);
    }
    // The same answer as a draught, measured from poses: tolerance 1 mm on bodies 0.5 to 0.8 m tall.
    const boxDraught = level(box) - (s.world.getState(box.handle).position[1] - 0.3);
    near(boxDraught, 0.6 * 0.6, 1e-3, 'box draught = (rho_b / rho_w) x height');
    const ballDraught = level(ball) - (s.world.getState(ball.handle).position[1] - 0.4);
    near(ballDraught, capHeight(0.4, 0.3), 1e-3, 'sphere draught from the cap-volume formula');
    near(s.world.getState(pill.handle).position[1], level(pill), 1e-3, 'half-density capsule floats with its axis in the waterline');
    t.diagnostic(`draught: box ${boxDraught.toFixed(5)} m (expected 0.36), sphere ${ballDraught.toFixed(5)} m (expected ${capHeight(0.4, 0.3).toFixed(5)})`);
  } finally { s.world.dispose(); }
});

test('Archimedes: a body denser than water sinks to the basin floor and stays fully submerged', async t => {
  // The floor is a static box in the rigid world whose top face is the basin floor (y = 0); the water
  // solver itself has no contact. Tolerance on the resting height: Box3D's contact slop (5 mm) plus 1 mm.
  const s = await scene({cells: 16, cell: 0.5, depth: 2, floor: true});
  try {
    const half = 0.3, volume = (2 * half) ** 3;
    const brick = add(s, {kind: 'box', halfExtents: [half, half, half]}, {position: [0, 2.6, 0], density: 2500});
    run(s, 8);
    const state = s.world.getState(brick.handle);
    near(state.position[1], half, 0.006, 'rests on the floor');
    assert.ok(Math.hypot(...state.linearVelocity) < 1e-3, 'at rest');
    near(brick.report.submergedFraction, 1, 1e-12, 'fully submerged');
    within(brick.report.buoyancy[1], RHO * s.water.gravity() * volume, 1e-12, 'buoyancy of the whole volume still acts');
    // The bathtub rise is an identity of the volume source, to float64 roundoff.
    near(s.water.meanElevation(), volume / s.area, 1e-12, 'mean level rose by V / A');
    t.diagnostic(`rest height ${state.position[1].toFixed(5)} m (expected ${half}), mean level error ${sci(s.water.meanElevation() - volume / s.area)} m`);
  } finally { s.world.dispose(); }
});

test('volume: water + displaced volume is constant while a body is lowered in and bobs, and the level rises by V / A', async t => {
  const s = await scene({cells: 32, cell: 0.5, depth: 2, waterDrag: 0.5});
  try {
    const shape = {kind: 'box', halfExtents: [0.6, 0.4, 0.6]};
    const float = add(s, shape, {position: [0, 3.2, 0], density: 550}, {linearDrag: 3000});
    const initial = s.water.waterVolume();
    assert.equal(initial, s.area * s.depth, 'the body starts dry');
    let worst = 0, deepest = 0;
    run(s, 30, () => {
      worst = Math.max(worst, Math.abs(s.water.waterVolume() - initial));
      deepest = Math.max(deepest, float.report.submergedFraction);
    });
    assert.ok(deepest > 0.75, `the drop overshoots the floating draught (deepest fraction ${deepest})`);
    // 512 m^3 summed over 1024 cells in float64: one ulp of the total is 1.1e-13 m^3. Allow 1e-12 relative.
    assert.ok(worst <= 1e-12 * initial, `water volume drifted by ${worst} m^3`);
    near(s.water.surfaceVolume() - initial, s.water.displacedVolume(), 1e-12 * initial, 'surface volume = water + displaced');
    // Bathtub: at rest the displaced volume is m / rho_w (Archimedes), so the mean level is m / (rho_w A).
    // Tolerance 1e-4: what is left of the bobbing after 30 s (3000 N s/m of linear drag is there to settle it).
    const mass = s.world.getState(float.handle).mass;
    within(s.water.meanElevation(), mass / (RHO * s.area), 1e-4, 'mean level = m / (rho_w A)');
    t.diagnostic(`max |water volume change| ${sci(worst)} m^3 of ${initial} m^3 (${sci(worst / initial)} relative); mean level ${s.water.meanElevation().toFixed(9)} m, expected ${(mass / (RHO * s.area)).toFixed(9)} m`);

    // A kinematic sphere pushed all the way under adds exactly its own volume to the displaced volume
    // (the floating box keeps answering the plunger's waves, so the two are summed).
    const radius = 0.5, ball = add(s, {kind: 'sphere', radius}, {position: [5, 2.6, 5], type: 'kinematic'});
    s.world.setVelocity(ball.handle, [0, -0.5, 0]);
    run(s, 3);
    s.world.setVelocity(ball.handle, [0, 0, 0]);
    run(s, 1);
    near(ball.report.submergedFraction, 1, 1e-12, 'plunger fully under');
    within(ball.report.submergedVolume, 4 / 3 * Math.PI * radius ** 3, 1e-12, 'the whole sphere is displaced volume');
    near(s.water.surfaceVolume() - initial, ball.report.submergedVolume + float.report.submergedVolume, 1e-12 * initial, 'the surface rose by the displaced volume of both bodies');
    near(s.water.waterVolume(), initial, 1e-12 * initial, 'water volume unchanged by the plunger');
  } finally { s.world.dispose(); }
});

test('balances: floor load = water weight + buoyancy, and horizontal impulse on bodies = - impulse on the water', async t => {
  const s = await scene({cells: 32, cell: 0.5, depth: 2});
  try {
    const a = add(s, {kind: 'box', halfExtents: [0.5, 0.25, 0.5]}, {position: [-3, 2.4, 0], density: 500});
    const b = add(s, {kind: 'sphere', radius: 0.35}, {position: [3, 1.2, 1], density: 900, linearVelocity: [2, 0, -1]});
    const {water, world} = s, cellMass = RHO * s.depth * 0.5 * 0.5;
    const momentum = () => { let x = 0, z = 0; for (let i = 0; i < water.u.length; i++) { x += water.u[i]; z += water.v[i]; } return [x * cellMass, z * cellMass]; };
    // Step 1 on flat, still water: the pressure gradient is zero, so the water's momentum is exactly the reaction.
    const before = world.getState(b.handle);
    water.step();
    const push = momentum();
    assert.ok(Math.abs(water.stepImpulseOnBodies[0]) > 1, 'the moving sphere is dragged');
    within(push[0], -water.stepImpulseOnBodies[0], 1e-12, 'water x momentum = - impulse on bodies');
    within(push[1], -water.stepImpulseOnBodies[2], 1e-12, 'water z momentum = - impulse on bodies');
    world.step();
    const after = world.getState(b.handle);
    // The rigid solver delivers that impulse (float32 state: 1e-5).
    within(after.mass * (after.linearVelocity[0] - before.linearVelocity[0]), b.report.drag[0] * DT, 1e-4, 'the sphere received the drag impulse');
    let worstVertical = 0, worstHorizontal = 0;
    const initial = s.area * s.depth;
    run(s, 4, () => {
      // Hydrostatic floor load minus the weight of the water is the buoyancy the bodies were given.
      const excess = water.floorLoad() - RHO * water.gravity() * water.waterVolume();
      worstVertical = Math.max(worstVertical, Math.abs(excess - water.buoyancyTotal()) / (RHO * G * initial));
      worstHorizontal = Math.max(worstHorizontal, Math.abs(water.stepImpulseOnBodies[0] + water.stepImpulseOnWater[0]), Math.abs(water.stepImpulseOnBodies[2] + water.stepImpulseOnWater[1]));
    });
    assert.ok(a.report.submergedVolume > 0 && water.buoyancyTotal() > 0);
    // Both are sums in float64: 1e-12 of the water's weight, and 1e-9 N s on impulses of order 1 N s.
    assert.ok(worstVertical <= 1e-12, `vertical balance off by ${worstVertical} of the water weight`);
    assert.ok(worstHorizontal <= 1e-9, `horizontal impulse pair off by ${worstHorizontal} N s`);
    t.diagnostic(`vertical balance error ${sci(worstVertical)} of the water weight; horizontal impulse pair error ${sci(worstHorizontal)} N s`);
  } finally { s.world.dispose(); }
});

test('heave: a floating spar oscillates with T = 2 pi sqrt(m / (rho_w g A_waterplane))', async t => {
  // 0.5 m x 0.5 m x 4 m spar, draught 2.4 m, in a 32 m x 32 m basin 4 m deep; drag off; rotation locked
  // (an upright spar is not stable). The closed form has no added mass and no wave radiation. This model has no
  // added-mass term either, but its water does answer the spar's volume source, so the measured period is
  // not exactly the closed form. Tolerance 1%: the spar is slender (omega R / c = 0.08 with R = 0.25 m,
  // c = sqrt(g H) = 6.3 m/s), which bounds that feedback at the per-cent level; time resolution adds
  // dt / (4 T) = 3e-4. A squat body in shallow water does not meet this (see docs/WATER_COUPLING.md).
  const s = await scene({cells: 64, cell: 0.5, depth: 4});
  try {
    const half = [0.25, 2, 0.25], density = 600, amplitude = 0.1;
    const rest = s.depth - 2 * half[1] * density / RHO + half[1];
    const spar = add(s, {kind: 'box', halfExtents: half}, {position: [0, rest + amplitude, 0], density, lockRotation: true}, {dragCoefficient: 0});
    const mass = s.world.getState(spar.handle).mass, exact = 2 * Math.PI * Math.sqrt(mass / (RHO * G * 4 * half[0] * half[2]));
    const crossings = [], peaks = [];
    let previous = amplitude, older = amplitude;
    run(s, 14, i => {
      const y = s.world.getState(spar.handle).position[1] - rest - s.water.meanElevation();
      if (previous > 0 && y <= 0) crossings.push((i - 1 + previous / (previous - y)) / HZ);
      if (previous > older && previous >= y) peaks.push(previous);
      older = previous; previous = y;
    });
    const period = (crossings.at(-1) - crossings[0]) / (crossings.length - 1);
    assert.ok(crossings.length >= 4, 'at least three full periods');
    t.diagnostic(`heave period ${period.toFixed(5)} s, closed form ${exact.toFixed(5)} s, error ${(100 * rel(period, exact)).toFixed(3)}% over ${crossings.length - 1} periods; peaks ${peaks.map(p => p.toFixed(4)).join(', ')} m`);
    within(period, exact, 0.01, 'heave period');
    // Nothing feeds the oscillation: the amplitude never grows (float32 pose noise allowed: 1e-5 m).
    for (let i = 1; i < peaks.length; i++) assert.ok(peaks[i] <= peaks[i - 1] + 1e-5, `peak ${i} grew: ${peaks[i - 1]} -> ${peaks[i]}`);
    assert.ok(peaks.at(-1) > 0.8 * amplitude, 'and it is not artificially damped');
  } finally { s.world.dispose(); }
});

test('terminal velocity: a sinking sphere settles where weight - buoyancy = quadratic drag', async t => {
  // Fully submerged, so the displaced volume is constant and the water stays still.
  // v_t = sqrt(2 (m - rho_w V) g / (rho_w C_d pi r^2)) with the default C_d = 0.47 and reference area pi r^2.
  // Tolerance 1e-3: v / v_t = tanh(t / tau) is within 4e-5 of 1 after 4.5 s (tau = 0.84 s); the rest is float32 state.
  const s = await scene({cells: 16, cell: 1, depth: 6});
  try {
    const radius = 0.1, volume = 4 / 3 * Math.PI * radius ** 3;
    const ball = add(s, {kind: 'sphere', radius}, {position: [0, 5.5, 0], density: 1100});
    const mass = s.world.getState(ball.handle).mass;
    const exact = Math.sqrt(2 * (mass - RHO * volume) * G / (RHO * 0.47 * Math.PI * radius * radius));
    run(s, 4.5);
    const state = s.world.getState(ball.handle);
    assert.ok(state.position[1] > 1, 'still above the floor');
    near(ball.report.submergedFraction, 1, 1e-12, 'fully submerged');
    t.diagnostic(`terminal speed ${(-state.linearVelocity[1]).toFixed(6)} m/s, closed form ${exact.toFixed(6)} m/s, error ${sci(rel(-state.linearVelocity[1], exact))}`);
    within(-state.linearVelocity[1], exact, 1e-3, 'terminal speed');
    within(-ball.report.drag[1], -(mass * G - RHO * G * volume), 1e-3, 'drag balances weight - buoyancy');
  } finally { s.world.dispose(); }
});

test('reaction: a dropped body makes waves, and body + water energy never exceeds the initial energy', async t => {
  // E = body kinetic + m g y + water kinetic + water potential (which includes the work of displacing water).
  // A 0.4 m sphere of density 500 falls 1.5 m into a 16 m x 16 m x 2 m basin.
  const radius = 0.4, drop = 1.5, volume = 4 / 3 * Math.PI * radius ** 3;
  const dropRun = async (hz, options) => {
    const s = await scene({cells: 32, cell: 0.5, depth: 2, hz});
    try {
      const ball = add(s, {kind: 'sphere', radius}, {position: [0, s.depth + radius + drop, 0], density: 500, lockRotation: true}, options);
      const mass = s.world.getState(ball.handle).mass, g = s.water.gravity();
      const energy = () => {
        const state = s.world.getState(ball.handle), v = state.linearVelocity;
        return 0.5 * mass * (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) + mass * g * state.position[1] + s.water.waterKineticEnergy() + s.water.waterPotentialEnergy();
      };
      const initial = energy(), result = {scale: mass * g * drop, excess: -Infinity, deficit: 0, probe: 0, calm: true, wave: 0, final: 0};
      run(s, 8, () => {
        result.final = energy() - initial;
        result.excess = Math.max(result.excess, result.final);
        result.deficit = Math.min(result.deficit, result.final);
        if (ball.report.submergedVolume === 0 && result.probe === 0) result.calm &&= s.water.eta.every(value => value === 0);
        result.probe = Math.max(result.probe, Math.abs(s.water.elevationAt(5, 0)));
        result.wave = Math.max(result.wave, s.water.waterKineticEnergy());
      });
      return result;
    } finally { s.world.dispose(); }
  };
  // With the default drag the total only ever falls: no step may end above the initial energy.
  const damped = await dropRun(HZ, {});
  t.diagnostic(`default drag: max (E - E0) = ${damped.excess.toFixed(3)} J, final E - E0 = ${damped.final.toFixed(1)} J of ${damped.scale.toFixed(1)} J in play (m g h); peak water kinetic energy ${damped.wave.toFixed(1)} J; max |eta| 5 m away ${damped.probe.toFixed(4)} m`);
  assert.ok(damped.calm, 'the water is exactly still until the body touches it');
  assert.ok(damped.probe > 1e-3, `waves reach a probe 5 m from the impact (max |eta| ${damped.probe})`);
  assert.ok(damped.wave > 0.01 * damped.scale, 'the water took a measurable share of the energy');
  assert.ok(damped.excess <= 0, `energy rose by ${damped.excess} J above its initial value`);
  assert.ok(damped.final < -0.2 * damped.scale, 'drag dissipated energy');
  // With drag off nothing dissipates on purpose, so this is the test of the exchange itself. Two first-order
  // effects remain. (1) The energy terms are sampled half a step apart (body state at t + dt, displaced volume
  // at the half-step pose, face velocities at t + dt/2), so E can read above E0 by up to one step of the
  // largest power in the exchange, rho g V v_impact dt. (2) The body's own rise of the water level is solved
  // within the step (backward in time), which loses energy in proportion to dt. So: the excess is bounded by
  // (1) at 240 Hz, and both the excess and the deficit halve (within 10%) from 240 Hz to 480 Hz, i.e. the
  // exchange conserves energy in the limit and never creates it beyond the sampling offset.
  const coarse = await dropRun(HZ, {dragCoefficient: 0}), fine = await dropRun(2 * HZ, {dragCoefficient: 0});
  const bound = RHO * G * volume * Math.sqrt(2 * G * drop) * DT;
  t.diagnostic(`no drag, 240 Hz: E - E0 in [${coarse.deficit.toFixed(2)}, ${coarse.excess.toFixed(2)}] J, final ${coarse.final.toFixed(2)} J (bound on the excess ${bound.toFixed(1)} J = ${(100 * bound / coarse.scale).toFixed(1)}% of m g h = ${coarse.scale.toFixed(1)} J)`);
  t.diagnostic(`no drag, 480 Hz: E - E0 in [${fine.deficit.toFixed(2)}, ${fine.excess.toFixed(2)}] J, final ${fine.final.toFixed(2)} J; ratios ${(coarse.excess / fine.excess).toFixed(3)} and ${(coarse.deficit / fine.deficit).toFixed(3)}`);
  assert.ok(coarse.excess <= bound, `energy rose ${coarse.excess} J above its initial value (bound ${bound} J)`);
  assert.ok(coarse.final < 0 && fine.final < 0, 'the run ends below its initial energy');
  near(coarse.excess / fine.excess, 2, 0.2, 'the energy excess is first order in dt');
  near(coarse.deficit / fine.deficit, 2, 0.2, 'the energy deficit is first order in dt');
});

test('righting torque: a heeled box feels rho g V GZ (wall-sided formula) and returns upright', async t => {
  const half = [0.5, 0.15, 0.5], density = 500, width = 2 * half[0], height = 2 * half[1], draught = height * density / RHO;
  const tilt = angle => [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)];
  // Signed angle of the box's local y axis from vertical, about world z.
  const heel = state => { const [x, y, z, w] = state.rotation; return Math.atan2(2 * (z * w - x * y), 1 - 2 * (x * x + z * z)); };
  {
    // Static check. With rho_b = rho_w / 2 the centre of the box is in the waterline, so heeling about it keeps
    // the displaced volume. Wall-sided ships: GZ = sin(theta) (GM + BM tan^2(theta) / 2), BM = w^2 / (12 d),
    // GM = BM - (h - d) / 2. The clipped volume is exact, so the tolerance is float32 pose only: 1e-5.
    const s = await scene({cells: 16, cell: 0.5, depth: 2});
    try {
      const angle = 0.1, box = add(s, {kind: 'box', halfExtents: half}, {position: [0, s.depth, 0], density, rotation: tilt(angle)});
      s.water.step();
      const state = s.world.getState(box.handle), r = [0, 1, 2].map(i => box.report.centre[i] - state.position[i]);
      const torque = r[0] * box.report.buoyancy[1] - r[1] * box.report.buoyancy[0];
      const BM = width * width / (12 * draught), GM = BM - (height - draught) / 2, GZ = Math.sin(angle) * (GM + 0.5 * BM * Math.tan(angle) ** 2);
      const exact = -RHO * G * (width * width * draught) * GZ;
      t.diagnostic(`righting torque ${torque.toFixed(4)} N m, closed form ${exact.toFixed(4)} N m, error ${sci(rel(torque, exact))}`);
      within(box.report.submergedVolume, width * width * draught, 1e-6, 'heeling about the waterline keeps the displaced volume');
      within(torque, exact, 1e-5, 'righting torque');
    } finally { s.world.dispose(); }
  }
  // Roll period at 0.05 rad with drag off: T = 2 pi sqrt(I / (rho g V GM)), I = m (w^2 + h^2) / 12.
  // A roll about the centre changes neither the displaced volume nor where it is returned, so the water does
  // not answer and this is the rigid solver integrating the exact torque. Tolerance 1%: the GZ curve stiffens by
  // BM tan^2(theta) / (2 GM) = 0.15% at 0.05 rad, heave and sway couple in at second order, and Box3D's soft
  // step integrates rotation at 1/960 s.
  {
    const s = await scene({cells: 32, cell: 0.5, depth: 2});
    try {
      const box = add(s, {kind: 'box', halfExtents: half}, {position: [0, s.depth, 0], density, rotation: tilt(0.05)}, {dragCoefficient: 0});
      const mass = s.world.getState(box.handle).mass, BM = width * width / (12 * draught), GM = BM - (height - draught) / 2;
      const exact = 2 * Math.PI * Math.sqrt(mass * (width * width + height * height) / 12 / (RHO * G * width * width * draught * GM));
      const crossings = [];
      let previous = 0.05, peak = 0;
      run(s, 8, i => {
        const angle = heel(s.world.getState(box.handle));
        if (previous > 0 && angle <= 0) crossings.push((i - 1 + previous / (previous - angle)) / HZ);
        previous = angle;
        if (i > 6 * HZ) peak = Math.max(peak, Math.abs(angle));
      });
      const period = (crossings.at(-1) - crossings[0]) / (crossings.length - 1);
      t.diagnostic(`roll period ${period.toFixed(5)} s, closed form ${exact.toFixed(5)} s, error ${(100 * rel(period, exact)).toFixed(3)}% over ${crossings.length - 1} periods; amplitude after 6 s ${peak.toFixed(5)} rad`);
      within(period, exact, 0.01, 'roll period');
      assert.ok(peak <= 0.05 + 1e-4, `the roll does not grow (${peak} rad)`);
    } finally { s.world.dispose(); }
  }
  // Released at 0.3 rad (17 degrees) with the default quadratic drag, each swing is smaller than the last.
  // Quadratic drag alone leaves a slowly decaying small roll, so "upright" is asserted with a linear
  // rotational drag of 60 N m s/rad (damping ratio about 0.3): below 1e-3 rad after 6 s.
  for (const [label, options, limit] of [['default drag', {}, null], ['with angularDrag 60', {angularDrag: 60}, 1e-3]]) {
    const s = await scene({cells: 32, cell: 0.5, depth: 2});
    try {
      const box = add(s, {kind: 'box', halfExtents: half}, {position: [0, s.depth, 0], density, rotation: tilt(0.3)}, options);
      const peaks = [];
      let late = 0, crossed = false, previous = 0.3, older = 0.3;
      run(s, 8, i => {
        const angle = heel(s.world.getState(box.handle));
        crossed ||= angle < 0;
        if (Math.abs(previous) > Math.abs(older) && Math.abs(previous) >= Math.abs(angle)) peaks.push(Math.abs(previous));
        older = previous; previous = angle;
        if (i > 6 * HZ) late = Math.max(late, Math.abs(angle));
      });
      t.diagnostic(`${label}: heel after 6 s ${late.toExponential(2)} rad from 0.3 rad; swing peaks ${peaks.slice(0, 6).map(p => p.toFixed(4)).join(', ')} rad`);
      assert.ok(crossed, 'the box swings back through upright');
      assert.ok(peaks[0] < 0.3, 'the first swing is smaller than the release angle');
      for (let i = 1; i < Math.min(peaks.length, 6); i++) assert.ok(peaks[i] < peaks[i - 1], `swing ${i} grew: ${peaks[i - 1]} -> ${peaks[i]}`);
      if (limit !== null) assert.ok(late < limit, `still heeled by ${late} rad`);
      else assert.ok(late < 0.15, `default drag has at least halved the roll (${late} rad)`);
      near(box.report.submergedFraction, density / RHO, 2e-3, 'and floats at its Archimedes draught');
    } finally { s.world.dispose(); }
  }
});

test('determinism: the same run twice gives bit-identical bodies and water', async () => {
  const once = async () => {
    const s = await scene({cells: 24, cell: 0.5, depth: 2, floor: true});
    try {
      const bodies = [
        add(s, {kind: 'box', halfExtents: [0.4, 0.2, 0.6]}, {position: [-2, 3, 0], density: 400, rotation: [0.1, 0.2, 0.3, 0.927]}),
        add(s, {kind: 'sphere', radius: 0.3}, {position: [1, 4, 1], density: 700, linearVelocity: [1, 0, 0]}),
        add(s, {kind: 'capsule', radius: 0.2, halfLength: 0.5}, {position: [2, 2.5, -2], density: 1800, angularVelocity: [0, 0, 2]}),
      ];
      run(s, 3);
      return {
        states: bodies.map(body => s.world.getState(body.handle)), hash: s.world.exactHash(),
        water: [s.water.eta, s.water.u, s.water.v].map(field => Buffer.from(field.buffer.slice(0)).toString('hex')),
        submerged: bodies.map(body => body.report.submergedVolume), maxEta: Math.max(...s.water.eta),
      };
    } finally { s.world.dispose(); }
  };
  const first = await once(), second = await once();
  assert.ok(first.maxEta > 1e-3 && first.submerged.every(v => v > 0), 'the run is not trivial');
  assert.deepEqual(second.states, first.states);
  assert.equal(second.hash, first.hash);
  assert.deepEqual(second.water, first.water);
  assert.deepEqual(second.submerged, first.submerged);
});

test('the coupled water is the closed-basin solver: without bodies it matches stepClosedWaterCpu', async t => {
  const s = await scene({cells: 24, cell: 0.5, depth: 1.5, waterDrag: 0.28});
  s.world.dispose();
  const cells = 24, eta = new Float32Array(cells * cells);
  for (let z = 0; z < cells; z++) for (let x = 0; x < cells; x++) eta[z * cells + x] = 0.03 * Math.cos(2 * Math.PI * (x + 0.5) / cells) * Math.cos(Math.PI * (z + 0.5) / cells);
  const world = {gravity: () => [0, -G, 0], getState() { throw new Error('unused'); }, applyForce() {}, applyTorque() {}, loop: {step: DT}};
  const water = new WaterCoupling(world, {cols: cells, rows: cells, dx: 0.5, dz: 0.5, restDepth: 1.5, origin: [0, 0, 0], waterDrag: 0.28, eta});
  assert.equal(water.backend, WATER_COUPLING_BACKEND);
  const config = water.waterConfig(), reference = createClosedWaterArrays(config, {eta});
  const volume = water.waterVolume();
  for (let i = 0; i < 960; i++) { water.step(); stepClosedWaterCpu(reference, config); }
  let worst = 0;
  for (let i = 0; i < eta.length; i++) worst = Math.max(worst, Math.abs(water.eta[i] - reference.eta[i]));
  // The reference stores float32: 960 steps of rounding at 0.03 m amplitude stay below 1e-5 m.
  assert.ok(worst < 1e-5, `float64 and float32 solvers differ by ${worst} m`);
  near(water.waterVolume(), volume, 1e-12 * volume, 'volume');
  const copy = createClosedWaterArrays(config);
  water.copyTo(copy);
  assert.equal(copy.eta[5], Math.fround(water.eta[5]));
  t.diagnostic(`max |eta64 - eta32| after 960 steps: ${sci(worst)} m`);
});

test('attach, detach and argument checks', async () => {
  const s = await scene({cells: 16, cell: 0.5, depth: 2});
  try {
    const {world, water} = s, shape = {kind: 'sphere', radius: 0.3};
    const body = world.createBody({shape, position: [0, 1, 0]});
    const report = water.attach(body, shape);
    assert.throws(() => water.attach(body, shape), RangeError);
    assert.throws(() => water.attach(world.createBody({shape, position: [2, 1, 0]}), {kind: 'cone', radius: 1}), RangeError);
    assert.throws(() => new WaterCoupling(world, {cols: 16, rows: 16, dx: 0.5, dz: 0.5, restDepth: 2, origin: [0, 0, 0], dt: 1 / 60}), RangeError);
    assert.throws(() => new WaterCoupling(world, {cols: 16, rows: 16, dx: 0.01, dz: 0.01, restDepth: 2, origin: [0, 0, 0]}), RangeError, 'Courant limit');
    run(s, 0.5);
    // Already wet when first seen: taken as the starting state, so the surface stays flat.
    assert.equal(report.submergedFraction, 1);
    near(water.displacedVolume(), 4 / 3 * Math.PI * 0.027, 1e-12, 'displaced volume is tracked');
    near(water.meanElevation(), 0, 1e-15, 'attaching a wet body makes no wave');
    assert.equal(water.report(body), report);
    // Destroyed bodies drop out on their own; their volume is handed back to the water.
    world.destroyBody(body);
    run(s, 0.5);
    assert.equal(water.attachedCount(), 0);
    assert.equal(water.displacedVolume(), 0);
    assert.equal(water.detach(body), false);
    assert.equal(water.tick(), 240);
    assert.equal(water.gravity(), Math.fround(9.81));
  } finally { s.world.dispose(); }
});
