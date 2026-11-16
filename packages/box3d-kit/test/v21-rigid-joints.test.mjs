// Joints of the rigid core beyond the first six: motor, parallel and filter joints, force and torque thresholds with
// joint events, breakable joints, the per-type details, and their checkpoints, replay and worker transport. Every
// number is measured on the real engine through the built kit; the set-ups are in rigid-core-scenarios.mjs and
// docs/VALIDATION.md has the same cases as registry rows.
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import * as K from 'box3d-webgpu-kit';
import {connectWorld} from 'box3d-webgpu-kit/worker';
import * as S from './rigid-core-scenarios.mjs';

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);

test('a breakable weld breaks when the force, or the torque, it carries reaches its threshold', async t => {
  const force = await S.breakableWeld(K), torque = await S.breakableWeld(K, {arm: 0.5, threshold: 100});
  t.diagnostic(`force threshold ${force.threshold} N: carried ${force.carriedBefore.toFixed(2)} N the step before, broke at ${force.load.toFixed(2)} N (one ramp step is ${force.resolution} N)`);
  t.diagnostic(`torque threshold ${torque.threshold} N m: carried ${torque.carriedBefore.toFixed(3)} N m the step before, broke at ${torque.load.toFixed(3)} N m (one ramp step is ${torque.resolution} N m)`);
  for (const r of [force, torque]) {
    assert.ok(r.broke);
    // The weld held one step below the threshold and broke within two ramp steps of it.
    assert.ok(r.carriedBefore < r.threshold + 2 * r.resolution, `still whole at ${r.carriedBefore}`);
    near(r.load, r.threshold, 3 * r.resolution, 'breaking load');
    within(r.reported, r.carriedBefore, 2e-3, 'the force the joint reports is the load it carries');
    // One event, 'joint-break', with the joint, its bodies and the load; and the block falls.
    assert.equal(r.events.length, 1); assert.equal(r.events[0].kind, 'joint-break');
    assert.equal(r.events[0].bodyA, null, 'the world anchor'); assert.ok(r.events[0].bodyB);
    near(r.fallingSpeed, S.G * 0.25, 0.05, 'falling at g after the break');
  }
  within(Math.hypot(...force.events[0].force), force.threshold, 0.01, 'the event carries the force at the break');
  within(Math.hypot(...torque.events[0].torque), torque.threshold, 0.01, 'the event carries the torque at the break');
});

test('a threshold without `breakable` reports joint-overload in every step it is exceeded, and the joint stays', async () => {
  const r = await S.overloadEvents(K);
  assert.equal(r.quiet, 0, 'no event while the weld carries one weight against a threshold of two');
  assert.equal(r.loud, r.steps, 'one event per step while it carries 2.5 weights');
  assert.equal(r.after, 0, 'and none after the load is gone');
  assert.ok(r.alive);
  for (const event of r.ticks) { within(event.force, 2.5 * r.weight, 0.01, 'event force'); assert.ok(event.sameJoint && event.bodyB && event.bodyA === null); }
  within(r.details.forceThreshold, 2 * r.weight, 1e-6, 'threshold read back'); assert.equal(r.details.breakable, false);
});

test('motor joint: velocity drives ramp at F / m and torque / I and hold their targets; springs oscillate at their frequency', async t => {
  const r = await S.motorJoint(K);
  t.diagnostic(`linear: reached ${r.speed} m/s after ${r.reachedAt.toFixed(4)} s (m v / F = ${r.rampTime.toFixed(4)} s), holds ${r.held}; spin: ${r.spin} rad/s after ${r.spinReachedAt.toFixed(4)} s (I w / tau = ${r.spinRampTime.toFixed(4)} s)`);
  t.diagnostic(`spring: period ${r.period.toFixed(5)} s (1 / f = ${(1 / r.hertz).toFixed(5)} s), amplitude ${r.lateAmplitude.toFixed(3)} of ${r.x0} m after 6 s; critically damped ${r.dampedX.toFixed(5)} m after one period (exact ${r.dampedExact.toFixed(5)})`);
  near(r.reachedAt, r.rampTime, 2 * S.DT, 'time to reach the speed'); within(r.midSpeed, r.speed / 2, 5e-3, 'half way up the ramp');
  within(r.held, r.speed, 1e-4, 'held speed');
  near(r.spinReachedAt, r.spinRampTime, 2 * S.DT, 'time to reach the spin'); within(r.heldSpin, r.spin, 1e-4, 'held spin');
  assert.ok(r.drift < 1e-3, 'the linear spring holds the spinning body in place');
  assert.deepEqual(r.details.angularVelocity, [0, 4, 0]); assert.equal(r.details.type, 'motor');
  within(r.period, 1 / r.hertz, 2e-3, 'spring period');
  assert.ok(r.lateAmplitude > 0.5 * r.x0, 'an undamped spring keeps most of its swing (the integrator is implicit)');
  near(r.dampedX, r.dampedExact, 2e-3, 'critically damped return');
});

test('motor joint spring under gravity: the sag is g / (2 pi f)^2 whatever the mass', async t => {
  const r = await S.motorSpringSag(K);
  t.diagnostic(`sag ${r.sags.map(v => (v * 1000).toFixed(3))} mm for 64 kg and 512 kg; exact ${(r.exact * 1000).toFixed(3)} mm`);
  for (const sag of r.sags) within(sag, r.exact, 2e-3, 'sag');
});

test('parallel joint: a tilted body swings about the aligned axis at the spring frequency', async t => {
  const r = await S.parallelJoint(K);
  t.diagnostic(`period ${r.period.toFixed(5)} s (exact ${r.exact}); amplitude ${r.lateAmplitude.toFixed(4)} of ${r.tilt} rad after 6 s`);
  within(r.period, r.exact, 3e-3, 'period');
  assert.ok(r.lateAmplitude > 0.5 * r.tilt && r.lateAmplitude <= r.tilt * 1.001);
  assert.equal(r.details.type, 'parallel'); assert.equal(r.details.springHertz, 1); assert.equal(r.details.maxTorque, 1e6);
  assert.ok(r.position < 1e-6, 'a parallel joint constrains direction only: the free body stays where it is');
});

test('filter joint: the two bodies pass through each other, and collide again as soon as it is removed', async () => {
  const r = await S.filterJoint(K);
  near(r.filtered.distance, 0.4, 1e-6, 'overlapping boxes stay where they are'); assert.equal(r.filtered.type, 'filter');
  assert.ok(r.plain.distance > 1.0, 'without the joint they are pushed apart');
  near(r.filtered.afterRemoval, r.plain.distance, 1e-3, 'after removal they separate as if it had never been there');
});

test('checkpoints and replay hold breakable flags, thresholds, drives, bullets and world settings: a weld breaks at the same tick after a restore', async t => {
  const r = await S.jointCheckpoint(K);
  t.diagnostic(`weld broke at tick ${r.brokeA} in the uninterrupted run and ${r.brokeB} in the restored one; ${r.mismatches} of ${r.steps} later steps differ`);
  assert.ok(r.aliveAtCheckpoint && r.brokeA !== null, 'the weld was whole at the checkpoint and broke after it');
  assert.equal(r.brokeB, r.brokeA);
  assert.equal(r.mismatches, 0);
  assert.deepEqual(r.settingsRestored, r.settingsAtCheckpoint);
  assert.equal(r.settingsRestored.contactHertz, 45); assert.equal(r.settingsRestored.maximumLinearSpeed, 120); assert.equal(r.settingsRestored.restitutionThreshold, 0.5);
  assert.ok(r.breakableRestored && r.bulletRestored);
  assert.ok(r.replay.matches && r.replay.checkpointsCompared >= 10, 'the recorded session replays bit for bit');
  assert.equal(r.replay.finalHash, r.finalHash);
  for (const method of ['configure', 'createJoint', 'applyForce']) assert.ok(r.calls.includes(method), `${method} is in the log`);
});

test('joint setters, details by type and refusals', async () => {
  const world = await S.newWorld(K, {gravity: [0, 0, 0]});
  try {
    const a = world.createBody({shape: {kind: 'box', halfExtents: [0.2, 0.2, 0.2]}, position: [0, 0, 0], neverSleeps: true});
    const b = world.createBody({shape: {kind: 'box', halfExtents: [0.2, 0.2, 0.2]}, position: [1, 0, 0], neverSleeps: true});
    // Spherical: an angular motor turns B about the joint at the stated rate; a cone limit is read back.
    const ball = world.createJoint({type: 'spherical', bodyA: null, bodyB: b, frameA: {position: [1, 0, 0]}});
    world.setJointAngularMotor(ball, {velocity: [0, 0, 2], maxTorque: 1e4});
    S.run(world, 1);
    within(world.getState(b).angularVelocity[2], 2, 1e-3, 'spherical motor speed');
    world.setJointAngularMotor(ball, null);
    world.setJointConeLimit(ball, 0.5);
    near(world.getJointDetails(ball).coneLimit, 0.5, 1e-6, 'cone limit');
    world.setJointTargetRotation(ball, [0, 0, Math.sin(0.25), Math.cos(0.25)]);
    assert.throws(() => world.setJointTargetRotation(ball, [0, 0, 0, 0]), e => e.code === 'INVALID_PAYLOAD');
    // Thresholds can be set, changed and removed later.
    const weld = world.createJoint({type: 'weld', bodyA: null, bodyB: a});
    assert.deepEqual([world.getJointDetails(weld).forceThreshold, world.getJointDetails(weld).breakable], [0, false]);
    world.setJointThresholds(weld, {force: 10, torque: 5, breakable: true});
    let d = world.getJointDetails(weld);
    assert.deepEqual([d.forceThreshold, d.torqueThreshold, d.breakable], [10, 5, true]);
    world.setJointThresholds(weld, null);
    d = world.getJointDetails(weld);
    assert.deepEqual([d.forceThreshold, d.torqueThreshold, d.breakable], [0, 0, false]);
    assert.throws(() => world.setJointThresholds(weld, {breakable: true}), e => e.code === 'INVALID_PAYLOAD', 'breakable needs a threshold');
    assert.throws(() => world.createJoint({type: 'weld', bodyA: a, bodyB: b, thresholds: {breakable: true}}), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.createJoint({type: 'weld', bodyA: a, bodyB: b, thresholds: {force: -1}}), e => e.code === 'INVALID_PAYLOAD');
    // Each setter refuses the joint types it does not apply to, and changes nothing.
    assert.throws(() => world.setJointDrive(weld, {maxForce: 1}), e => e.code === 'UNSUPPORTED_JOINT');
    assert.throws(() => world.setJointSteeringLimits(weld, {lower: -1, upper: 1}), e => e.code === 'UNSUPPORTED_JOINT');
    assert.throws(() => world.setJointParallelSpring(weld, {hertz: 1, dampingRatio: 0, maxTorque: 1}), e => e.code === 'UNSUPPORTED_JOINT');
    assert.throws(() => world.setJointConeLimit(weld, 0.2), e => e.code === 'UNSUPPORTED_JOINT');
    assert.throws(() => world.createJoint({type: 'weld', bodyA: a, bodyB: b, drive: {maxForce: 1}}), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.createJoint({type: 'revolute', bodyA: a, bodyB: b, steering: {angle: 0, hertz: 1, dampingRatio: 1, maxTorque: 1}}), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.createJoint({type: 'motor', bodyA: a, bodyB: b, drive: {maxForce: -5}}), e => e.code === 'INVALID_PAYLOAD');
    assert.equal(world.profile().counters.joints, 2, 'refused joints leave nothing behind');
    // Collide-connected can be switched after creation.
    world.setJointCollideConnected(weld, true);
    // Wheel: steering limits clamp the angle the steering spring reaches; details report spin, steering and travel.
    const chassis = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.2, 0.3]}, type: 'static', position: [0, 5, 0]});
    const wheel = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 4.5, 0], neverSleeps: true});
    const frame = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
    const axle = world.createJoint({type: 'wheel', bodyA: chassis, bodyB: wheel, frameA: {position: [0, -0.5, 0], rotation: frame}, frameB: {rotation: frame}, spring: {hertz: 5, dampingRatio: 1},
      limits: {lower: -0.1, upper: 0.1}, motor: {speed: 3, maxForce: 1e4}, steering: {angle: 1.0, hertz: 10, dampingRatio: 1, maxTorque: 1e4, limits: {lower: -0.3, upper: 0.3}}});
    S.run(world, 1.5);
    d = world.getJointDetails(axle);
    // The steering spring keeps pushing towards 1 rad, and Box3D's limit yields a little under that push (0.017 rad here).
    near(d.steeringAngle, 0.3, 0.03, 'steering stops at its limit'); near(d.targetSteeringAngle, 1.0, 1e-6, 'target read back');
    within(d.spinSpeed, 3, 1e-3, 'spin speed'); near(d.suspension, 0, 1e-3, 'suspension travel'); assert.deepEqual([d.lowerLimit, d.upperLimit].map(v => Math.round(v * 1e6) / 1e6), [-0.1, 0.1]);
    world.setJointSteeringLimits(axle, {lower: -0.8, upper: 0.8});
    S.run(world, 1.5);
    near(world.getJointDetails(axle).steeringAngle, 0.8, 0.03, 'wider limits, larger angle');
    world.setJointSteeringLimits(axle, null);
    S.run(world, 1.5);
    near(world.getJointDetails(axle).steeringAngle, 1.0, 5e-3, 'no limits: the target');
    // Revolute, prismatic and distance details.
    const hinge = world.createJoint({type: 'revolute', bodyA: null, bodyB: a, limits: {lower: -0.4, upper: 0.6}, motor: {speed: 0.5, maxForce: 1e3}});
    world.destroyJoint(weld);
    S.run(world, 0.5);
    d = world.getJointDetails(hinge);
    within(d.angle, 0.25, 0.02, 'hinge angle'); near(d.lowerLimit, -0.4, 1e-6, 'lower'); near(d.upperLimit, 0.6, 1e-6, 'upper'); near(d.motorSpeed, 0.5, 1e-6, 'motor speed');
    assert.ok(d.linearSeparation < 1e-3 && d.stiffness.hertz === 60 && d.stiffness.dampingRatio === 2);
  } finally { world.dispose(); }
});

test('worker: joint events, breakable joints and joint details cross the worker boundary', async () => {
  const remote = await connectWorld(new Worker(fileURLToPath(new URL('./fixtures/physics.worker.mjs', import.meta.url))), {step: S.DT, subSteps: S.SUB, gravity: [0, -S.G, 0], ground: false, sharedMemory: false});
  try {
    await remote.takeEvents();
    const block = await remote.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}, density: 1250, position: [0, 5, 0], neverSleeps: true});
    const weld = await remote.createJoint({type: 'weld', bodyA: null, bodyB: block, frameA: {position: [0, 5, 0]}, thresholds: {force: 50, breakable: true}});
    assert.equal((await remote.getJointDetails(weld)).breakable, true);
    for (let i = 0; i < 4; i++) await remote.stepOnce();
    const {events} = await remote.takeEvents();
    const broke = events.find(event => event.kind === 'joint-break');
    assert.ok(broke, 'the 98 N weight breaks a 50 N weld in the first step');
    assert.equal(broke.joint.token, weld.token); assert.equal(broke.bodyB.token, block.token); assert.equal(broke.bodyA, null);
    assert.equal(await remote.isJointAlive(weld), false);
    await assert.rejects(remote.getJointDetails(weld), e => e.code === 'STALE_JOINT');
    const sled = await remote.createBody({shape: {kind: 'sphere', radius: 0.25}, position: [3, 0, 0], gravityScale: 0, neverSleeps: true});
    const motor = await remote.createJoint({type: 'motor', bodyA: null, bodyB: sled, frameA: {position: [3, 0, 0]}, drive: {linearVelocity: [0, 0, 1], maxForce: 1e4}});
    await remote.setJointDrive(motor, {linearVelocity: [0, 0, 2], maxForce: 1e4});
    for (let i = 0; i < 60; i++) await remote.stepOnce();
    within((await remote.getState(sled)).linearVelocity[2], 2, 1e-3, 'motor joint in the worker');
    assert.deepEqual((await remote.getJointDetails(motor)).linearVelocity, [0, 0, 2]);
    assert.equal((await remote.settings()).continuous, true);
    await remote.configure({sleeping: false});
    assert.equal((await remote.settings()).sleeping, false);
    assert.ok((await remote.profile()).counters.bodies >= 2);
    assert.ok((await remote.debugLines({joints: true, bounds: true})).vertexCount > 0);
    assert.equal((await remote.contactStats()).pairs, 0);
  } finally { await remote.dispose(); }
});
