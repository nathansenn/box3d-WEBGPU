// The wheel-joint vehicle (box3d-webgpu-kit/gameplay, Vehicle): static sag, heave frequency and damping, top speed
// against drag, the Ackermann turning circle, braking distance, a drive over terrain with a checkpoint, and replay.
// Every number is measured on the real engine through the built kit; the set-ups are in rigid-core-scenarios.mjs
// and docs/VALIDATION.md has the same cases as registry rows.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as index from 'box3d-webgpu-kit';
import * as gameplay from 'box3d-webgpu-kit/gameplay';
import * as S from './rigid-core-scenarios.mjs';

const K = {...index, ...gameplay};
const {Vehicle} = gameplay;
const within = (actual, expected, fraction, label) => assert.ok(Math.abs(actual - expected) <= Math.abs(expected) * fraction, `${label}: got ${actual}, expected ${expected} ± ${fraction * 100}%`);
const WHEELS = [{position: [1.3, -0.25, -0.8]}, {position: [1.3, -0.25, 0.8]}, {position: [-1.3, -0.25, -0.8]}, {position: [-1.3, -0.25, 0.8]}];
const car = (world, extra = {}) => new Vehicle(world, {position: [0, 0.6, 0], chassisHalfExtents: [1.6, 0.25, 0.75], chassisMass: 1200, wheels: WHEELS, suspension: {stiffness: 60000, damping: 4000}, ...extra});

test('static sag: each spring is compressed by its wheel load over the stiffness, M g / (4 k), and by the axle loads when the centre of mass is forward', async t => {
  const r = await S.vehicleSag(K);
  t.diagnostic(`even: ${r.even.map(v => (v * 1000).toFixed(3))} mm (exact ${(r.exact * 1000).toFixed(3)}); nose-heavy: front ${(r.nose[0] * 1000).toFixed(2)} mm (exact ${(r.exactFront * 1000).toFixed(2)}), rear ${(r.nose[2] * 1000).toFixed(2)} mm (exact ${(r.exactRear * 1000).toFixed(2)})`);
  for (const sag of r.even) within(sag, r.exact, 1e-3, 'sag');
  within(r.nose[0], r.exactFront, 5e-3, 'front sag'); within(r.nose[1], r.exactFront, 5e-3, 'front sag');
  within(r.nose[2], r.exactRear, 5e-3, 'rear sag'); within(r.nose[3], r.exactRear, 5e-3, 'rear sag');
  assert.equal(r.stiffness, 60000); assert.ok(Math.abs(r.wheelbase - 2.6) < 1e-12 && Math.abs(r.track - 1.6) < 1e-12);
  assert.ok(r.speed < 1e-3, 'the car is at rest');
});

test('heave: the chassis bounces at sqrt(4 k / M) / (2 pi), and dampers give zeta = 4 c / (2 sqrt(4 k M))', async t => {
  const stiff = await S.vehicleHeave(K), soft = await S.vehicleHeave(K, {mass: 800, stiffness: 20000}), damped = await S.vehicleHeave(K, {damping: 2000});
  t.diagnostic(`1200 kg on 4 x 60 kN/m: ${stiff.frequency.toFixed(4)} Hz (exact ${stiff.exact.toFixed(4)}), numerical damping ratio ${stiff.zeta.toFixed(4)}`);
  t.diagnostic(`800 kg on 4 x 20 kN/m: ${soft.frequency.toFixed(4)} Hz (exact ${soft.exact.toFixed(4)}), numerical damping ratio ${soft.zeta.toFixed(4)}`);
  t.diagnostic(`with 2 kN s/m dampers: damping ratio ${damped.zeta.toFixed(4)} (exact ${damped.exactZeta.toFixed(4)})`);
  within(stiff.frequency, stiff.exact, 0.015, 'heave frequency'); within(soft.frequency, soft.exact, 0.015, 'heave frequency of the soft car');
  // The tyre contact is a stiff spring in series, so the measured frequency is the lower one.
  assert.ok(stiff.frequency < stiff.exact && soft.frequency < soft.exact);
  assert.ok(stiff.zeta < 0.03 && soft.zeta < 0.03, 'an undamped suspension loses little to the integrator');
  assert.ok(Math.abs(damped.zeta - damped.exactZeta) < 0.02, `damping ratio ${damped.zeta}, exact ${damped.exactZeta}`);
});

test('top speed: drive torque against drag balances at sqrt(8 tau / (R rho CdA)), approached from below and from above', async t => {
  for (const options of [{}, {torque: 80, dragArea: 0.8}, {torque: 20, dragArea: 2}]) {
    const r = await S.vehicleTopSpeed(K, options);
    t.diagnostic(`tau ${r.torque} N m, CdA ${r.dragArea} m^2: exact ${r.exact.toFixed(3)} m/s; from below ${r.below.toFixed(3)}, from above ${r.above.toFixed(3)}; wheel slip ${(r.slip[0] * 100).toFixed(2)}%`);
    within(r.below, r.exact, 0.01, 'top speed from below'); within(r.above, r.exact, 0.01, 'top speed from above');
    assert.ok(r.above - r.below < 0.004 * r.exact, 'both runs end at the same speed');
    assert.ok(r.sideways < 5, 'the car runs straight');
  }
});

test('turning circle: at low speed the rear axle turns about L / tan(delta), with Ackermann angles on the front wheels', async t => {
  for (const options of [{delta: 0.25, speed: 3}, {delta: 0.4, speed: 2}]) {
    const r = await S.vehicleTurning(K, options);
    t.diagnostic(`delta ${options.delta} rad at ${options.speed} m/s: radius ${r.radius.toFixed(4)} m (v / yaw rate), ${r.fitted.toFixed(4)} m (circle fit); exact ${r.exact.toFixed(4)} m; lateral acceleration ${r.lateral.toFixed(2)} m/s^2`);
    within(r.radius, r.exact, 0.01, 'turning radius from the yaw rate'); within(r.fitted, r.exact, 0.01, 'turning radius of the path');
    for (let i = 0; i < 4; i++) assert.ok(Math.abs(r.angles[i] - r.ackermann[i]) < 2e-3, `wheel ${i} steers to its Ackermann angle`);
    assert.ok(r.angles[0] > r.angles[1] && r.angles[1] > 0, 'the inner (left) wheel steers more, and a positive steer turns left');
    assert.ok(r.yawRate > 0);
  }
});

test('braking: with locked wheels the car stops in v^2 / (2 mu g)', async t => {
  const r = await S.vehicleBraking(K);
  t.diagnostic(`from ${r.v0.toFixed(3)} m/s on mu = 0.8: ${r.distance.toFixed(3)} m (exact ${r.exact.toFixed(3)}), ${r.stoppedAt.toFixed(3)} s (exact ${r.exactTime.toFixed(3)}); wheels locked ${(r.lockedFraction * 100).toFixed(1)}% of the time`);
  within(r.distance, r.exact, 0.01, 'stopping distance'); within(r.stoppedAt, r.exactTime, 0.01, 'stopping time');
  assert.ok(r.lockedFraction > 0.95 && r.sideways < 0.05);
});

test('terrain and checkpoints: a drive over a height field stays upright, and the world checkpoint with the vehicle state resumes it bit for bit', async t => {
  const r = await S.vehicleTerrainCheckpoint(K);
  t.diagnostic(`${r.travelled.toFixed(1)} m over the terrain, least upright ${r.minUp.toFixed(3)}; ${r.mismatches} of ${r.steps} steps after the restore differ`);
  assert.equal(r.mismatches, 0);
  assert.ok(r.travelled > 50 && r.minUp > 0.9 && r.maxHeight < 2);
  assert.deepEqual(r.savedKeys, ['brake', 'sentMotor', 'sentSteer', 'sentTorque', 'steer', 'throttle']);
});

test('controls, options, replay and removal', async () => {
  const world = await S.newWorld(K, {ground: true}), twin = await S.newWorld(K);
  try {
    for (const bad of [{chassisMass: 0}, {wheels: [WHEELS[0]]}, {suspension: {stiffness: -1, damping: 0}}, {suspension: {frequency: 2}}, {maxSteerAngle: 2}, {wheelRadius: 0}]) {
      assert.throws(() => car(world, bad), e => e.code === 'INVALID_PAYLOAD', JSON.stringify(bad));
    }
    assert.equal(world.bodyCount(), 1, 'a refused vehicle leaves nothing behind');
    // Frequency and damping ratio give the same springs as the stiffness and damping they stand for.
    const byFrequency = car(world, {suspension: {frequency: 2, dampingRatio: 0.3}});
    assert.ok(Math.abs(byFrequency.stiffness - 300 * (4 * Math.PI) ** 2) < 1e-6 && Math.abs(byFrequency.damping - 0.6 * Math.sqrt(byFrequency.stiffness * 300)) < 1e-6);
    byFrequency.destroy();
    assert.equal(world.bodyCount(), 1, 'destroy() removes the chassis and the wheels');

    world.startRecording({world: {ground: true, gravity: [0, -S.G, 0]}});
    const driven = car(world, {dragArea: 0.7});
    // Reverse, then forwards with the wheel hard over (clamped), then the brake.
    const controls = i => i < 240 ? {throttle: -0.5} : i < 720 ? {throttle: 1, steer: 3} : {brake: 1, steer: -0.2};
    let reverseSpeed = 0;
    for (let i = 0; i < 960; i++) { driven.update(controls(i)); world.step(); if (i === 239) reverseSpeed = driven.state.forwardSpeed; }
    assert.ok(reverseSpeed < -1, `reverse (${reverseSpeed} m/s)`);
    assert.ok(driven.state.speed < 0.5, 'braked to a stop');
    const log = JSON.parse(JSON.stringify(world.stopRecording()));
    const calls = log.commands.filter(command => command.op === 'call').map(command => command.method);
    // update() talks to the joints only when a setting changes: 3 phases, not 960 steps.
    assert.ok(calls.filter(method => method === 'setJointMotor').length <= 12, `motor calls: ${calls.filter(method => method === 'setJointMotor').length}`);
    assert.ok(calls.includes('setJointSteering') && calls.includes('applyForce') && calls.includes('createJoint'));
    assert.ok(twin.replayDetailed(log).matches, 'the drive replays bit for bit');
    // The steering never passes maxSteerAngle, whatever the wheel asks for.
    const limit = Math.max(...driven.ackermann(driven.maxSteerAngle).map(Math.abs));
    assert.ok(driven.ackermann(3 * driven.maxSteerAngle).every(a => Math.abs(a) <= 1.5), 'angles stay finite');
    assert.ok(limit < 1.0);
  } finally { world.dispose(); twin.dispose(); }
});
