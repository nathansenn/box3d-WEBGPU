// General rigid bodies, joints and events, checked against closed-form physics.
// Every world here is built with reset()/createBody(), in SI units.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld, axisRotation, toQuat} from 'box3d-webgpu-kit';
import {createShapeMeshes, syncShapeMeshes} from 'box3d-webgpu-kit/three';
import {Worker} from 'node:worker_threads';
import {connectWorld} from 'box3d-webgpu-kit/worker';

const G = 9.81, HZ = 240, SUB = 4;
const si = (extra = {}) => createWorld({step: 1 / HZ, subSteps: SUB, gravity: [0, -G, 0], ...extra});
const run = (world, seconds) => { for (let i = 0; i < Math.round(seconds * HZ); i++) world.step(); };
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);

test('free fall follows y = h - g t^2 / 2 and mass is density x volume for each shape', async () => {
  const world = await si({ground: false});
  try {
    assert.deepEqual(world.gravity().map(v => +v.toFixed(4)), [0, -9.81, 0], 'SI gravity by default');
    const sphere = world.createBody({shape: {kind: 'sphere', radius: 0.25}, position: [0, 100, 0]});
    const box = world.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.2, 0.3]}, position: [5, 100, 0], density: 2700});
    const capsule = world.createBody({shape: {kind: 'capsule', radius: 0.3, halfLength: 0.5}, position: [10, 100, 0], density: 500});
    within(world.getState(sphere).mass, 1000 * 4 / 3 * Math.PI * 0.25 ** 3, 1e-5, 'sphere mass');
    within(world.getState(box).mass, 2700 * 0.2 * 0.4 * 0.6, 1e-5, 'box mass');
    within(world.getState(capsule).mass, 500 * (Math.PI * 0.09 * 1 + 4 / 3 * Math.PI * 0.027), 1e-5, 'capsule mass');
    const t = 2, dt = 1 / (HZ * SUB);
    run(world, t);
    for (const [name, body] of [['sphere', sphere], ['box', box], ['capsule', capsule]]) {
      const state = world.getState(body);
      within(state.linearVelocity[1], -G * t, 1e-4, `${name} speed`);
      // Semi-implicit Euler falls g t dt / 2 further than the continuum answer; allow exactly that.
      near(state.position[1], 100 - 0.5 * G * t * t, 0.5 * G * t * dt + 1e-3, `${name} height`);
    }
    assert.deepEqual(world.bodyKinds(), ['sphere', 'box', 'capsule']);
    world.destroyBody(sphere);
    assert.deepEqual(world.bodyKinds(), ['capsule', 'box'], 'kinds follow rows when the last row fills the gap');
    assert.equal(world.createBody({shape: {kind: 'box', halfExtents: [1, 1, 1]}, position: [0, 0, 0], type: 'static'}) !== null, true);
    assert.throws(() => world.createBody({shape: {kind: 'sphere', radius: 0}, position: [0, 0, 0]}), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.createBody({shape: {kind: 'cone', radius: 1}, position: [0, 0, 0]}), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.createBody({shape: {kind: 'capsule', radius: 0.1, halfLength: 0}, position: [0, 0, 0]}), e => e.code === 'INVALID_PAYLOAD');
  } finally { world.dispose(); }
});

test('a hinged sphere swings with the compound-pendulum period and keeps its amplitude', async () => {
  const world = await si({ground: false});
  try {
    const L = 2, r = 0.1, theta0 = 0.1, pivot = [0, 10, 0];
    const bob = world.createBody({shape: {kind: 'sphere', radius: r}, position: [L * Math.sin(theta0), pivot[1] - L * Math.cos(theta0), 0], neverSleeps: true});
    const hinge = world.createJoint({type: 'revolute', bodyA: null, bodyB: bob, frameA: {position: pivot}, frameB: {position: [-L * Math.sin(theta0), L * Math.cos(theta0), 0]}});
    let previous = theta0, lateAmplitude = 0;
    const crossings = [];
    for (let i = 1; i <= HZ * 30; i++) {
      world.step();
      const p = world.getState(bob).position, theta = Math.atan2(p[0], pivot[1] - p[1]);
      if (previous > 0 && theta <= 0) crossings.push((i - 1 + previous / (previous - theta)) / HZ);
      previous = theta;
      if (i > HZ * 25) lateAmplitude = Math.max(lateAmplitude, Math.abs(theta));
    }
    const period = (crossings.at(-1) - crossings[0]) / (crossings.length - 1);
    // T = 2 pi sqrt(I / (m g L)) with I = m (L^2 + 2 r^2 / 5), times the finite-amplitude factor 1 + theta0^2 / 16.
    const exact = 2 * Math.PI * Math.sqrt((L * L + 0.4 * r * r) / (G * L)) * (1 + theta0 * theta0 / 16);
    within(period, exact, 1e-3, 'period');
    within(lateAmplitude, theta0, 0.01, 'amplitude after 25 s (no energy drift)');
    const state = world.getJointState(hinge);
    assert.equal(state.type, 'revolute');
    // The hinge carries about the bob's weight.
    within(Math.hypot(...state.force), world.getState(bob).mass * G, 0.05, 'hinge force');
  } finally { world.dispose(); }
});

test('sliding friction stops a box after v^2 / (2 mu g) and a bounce returns e^2 of the drop height', async () => {
  const world = await si({ground: false});
  try {
    const mu = 0.5, v0 = 6;
    world.createBody({shape: {kind: 'box', halfExtents: [50, 0.5, 5]}, type: 'static', position: [0, -0.5, 0], friction: mu});
    const slider = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.1, 0.5]}, position: [0, 0.1, 0], friction: mu, lockRotation: true, linearVelocity: [v0, 0, 0]});
    run(world, 5);
    const state = world.getState(slider);
    within(state.position[0], v0 * v0 / (2 * mu * G), 0.01, 'stopping distance');
    near(state.position[1], 0.1, 0.006, 'rests on the floor (within contact slop)');
    assert.equal(state.awake, false, 'a stopped body goes to sleep');

    const e = 0.5, drop = 5, radius = 0.2;
    const ball = world.createBody({shape: {kind: 'sphere', radius}, position: [20, drop + radius, 0], restitution: e});
    let rising = false, peak = 0;
    for (let i = 0; i < HZ * 4; i++) {
      world.step();
      const s = world.getState(ball);
      if (s.linearVelocity[1] > 0) rising = true;
      if (rising) peak = Math.max(peak, s.position[1] - radius);
      if (rising && s.linearVelocity[1] < -0.5) break;
    }
    within(peak, e * e * drop, 0.02, 'rebound height');
  } finally { world.dispose(); }
});

test('an elastic collision conserves momentum and kinetic energy', async () => {
  const world = await si({ground: false, gravity: [0, 0, 0]});
  try {
    const a = world.createBody({shape: {kind: 'sphere', radius: 0.5}, position: [-3, 0, 0], linearVelocity: [4, 0, 0], restitution: 1, friction: 0});
    const b = world.createBody({shape: {kind: 'sphere', radius: 0.25}, position: [0, 0.1, 0], restitution: 1, friction: 0});
    const sum = () => {
      const sa = world.getState(a), sb = world.getState(b), v2 = s => s.linearVelocity.reduce((t, v) => t + v * v, 0);
      return {p: [0, 1, 2].map(i => sa.mass * sa.linearVelocity[i] + sb.mass * sb.linearVelocity[i]), ke: 0.5 * sa.mass * v2(sa) + 0.5 * sb.mass * v2(sb)};
    };
    const before = sum();
    run(world, 2);
    const after = sum();
    assert.ok(world.getState(b).linearVelocity[0] > 1, 'the small sphere was struck');
    within(after.p[0], before.p[0], 1e-4, 'momentum x');
    near(after.p[1], 0, before.p[0] * 1e-4, 'momentum y');
    within(after.ke, before.ke, 1e-3, 'kinetic energy');
  } finally { world.dispose(); }
});

test('joints: motor speed, prismatic limits, distance length, weld, spring, steering and lifetime', async () => {
  const world = await si({ground: false, gravity: [0, 0, 0]});
  try {
    const rotor = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.1]}, position: [0, 0, 0]});
    const motor = world.createJoint({type: 'revolute', bodyA: null, bodyB: rotor, motor: {speed: 2, maxForce: 1e6}});
    run(world, 1);
    within(world.getState(rotor).angularVelocity[2], 2, 1e-3, 'motor speed about the frame z axis');
    within(world.getJointState(motor).value, 2, 0.01, 'angle after 1 s at 2 rad/s');
    world.setJointMotor(motor, {speed: -1, maxForce: 1e6});
    run(world, 0.5);
    within(world.getState(rotor).angularVelocity[2], -1, 1e-3, 'reversed motor');
    world.setJointMotor(motor, null);
    world.setJointLimits(motor, {lower: -0.25, upper: 0.25});
    run(world, 2);
    assert.ok(Math.abs(world.getJointState(motor).value) <= 0.26, 'limits hold the hinge');

    // A hinge about the world y axis: axisRotation aims the frame's z axis.
    const door = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 1, 0.05]}, position: [10, 0, 0]});
    const q = axisRotation([0, 1, 0]);
    world.createJoint({type: 'revolute', bodyA: null, bodyB: door, frameA: {position: [10, 0, 0], rotation: q}, frameB: {rotation: q}, motor: {speed: 1.5, maxForce: 1e6}});
    run(world, 1);
    const spin = world.getState(door).angularVelocity;
    within(spin[1], 1.5, 1e-3, 'hinge turns about y');
    near(Math.hypot(spin[0], spin[2]), 0, 1e-3, 'and only about y');

    const slider = world.createBody({shape: {kind: 'box', halfExtents: [0.2, 0.2, 0.2]}, position: [20, 0, 0], linearVelocity: [3, 4, 0]});
    const rail = world.createJoint({type: 'prismatic', bodyA: null, bodyB: slider, frameA: {position: [20, 0, 0]}, limits: {lower: -1, upper: 1}});
    let travel = 0, offAxis = 0;
    for (let i = 0; i < HZ * 2; i++) {
      world.step();
      const p = world.getState(slider).position;
      travel = Math.max(travel, Math.abs(p[0] - 20)); offAxis = Math.max(offAxis, Math.abs(p[1]), Math.abs(p[2]));
    }
    near(travel, 1, 0.01, 'prismatic travel stops at the limit');
    assert.ok(offAxis < 0.01, `stays on the rail (off-axis ${offAxis})`);
    assert.equal(world.getJointState(rail).type, 'prismatic');

    const orbiter = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [30, 0, 3], linearVelocity: [2, 0, 0]});
    const tether = world.createJoint({type: 'distance', bodyA: null, bodyB: orbiter, frameA: {position: [30, 0, 0]}, length: 3});
    let worst = 0;
    for (let i = 0; i < HZ * 3; i++) { world.step(); worst = Math.max(worst, Math.abs(world.getJointState(tether).value - 3)); }
    assert.ok(worst < 0.01, `a rigid distance joint keeps its length (error ${worst})`);
    // Circular motion: tension = m v^2 / r.
    const m = world.getState(orbiter).mass, speed = Math.hypot(...world.getState(orbiter).linearVelocity);
    within(speed, 2, 0.01, 'orbit speed is preserved');
    within(Math.hypot(...world.getJointState(tether).force), m * speed * speed / 3, 0.02, 'tether tension');

    const left = world.createBody({shape: {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, position: [40, 0, 0]});
    const right = world.createBody({shape: {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, position: [41, 0, 0]});
    const weld = world.createJoint({type: 'weld', bodyA: left, bodyB: right, frameA: {position: [0.5, 0, 0]}, frameB: {position: [-0.5, 0, 0]}});
    world.applyImpulseAt(left, [0, 0, 80], [40, 0.3, 0]);
    run(world, 2);
    const pl = world.getState(left).position, pr = world.getState(right).position;
    near(Math.hypot(pl[0] - pr[0], pl[1] - pr[1], pl[2] - pr[2]), 1, 1e-3, 'welded bodies keep their spacing while tumbling');

    const mass = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [50, 0, 0.5], neverSleeps: true});
    const spring = world.createJoint({type: 'prismatic', bodyA: null, bodyB: mass, frameA: {position: [50, 0, 0], rotation: axisRotation([0, 0, 1], 'x')}, frameB: {rotation: axisRotation([0, 0, 1], 'x')}, spring: {hertz: 2, dampingRatio: 0, target: 0}});
    let last = 0.5, firstReturn = 0;
    for (let i = 1; i <= HZ * 2 && firstReturn === 0; i++) {
      world.step();
      const z = world.getState(mass).position[2];
      if (last > 0 && z <= 0) firstReturn = (i - 1 + last / (last - z)) / HZ;
      last = z;
    }
    within(firstReturn, 1 / (4 * 2), 0.02, 'a 2 Hz spring crosses its rest point after a quarter period');
    assert.throws(() => world.setJointSteering(spring, {angle: 0.2, hertz: 5, dampingRatio: 1, maxTorque: 10}), e => e.code === 'UNSUPPORTED_JOINT');

    assert.equal(world.isJointAlive(weld), true);
    world.destroyBody(right);
    assert.equal(world.isJointAlive(weld), false, 'a joint dies with its body');
    assert.throws(() => world.getJointState(weld), e => e.code === 'STALE_JOINT');
    assert.equal(world.destroyJoint(tether), true);
    assert.equal(world.destroyJoint(tether), false);
    assert.throws(() => world.createJoint({type: 'weld', bodyA: left, bodyB: left}), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.createJoint({type: 'distance', bodyA: null, bodyB: left}), e => e.code === 'INVALID_PAYLOAD', 'distance needs a length');
    world.reset({ground: false});
    assert.throws(() => world.isJointAlive(motor), e => e.code === 'INVALID_PAYLOAD', 'joints of an earlier scene are rejected');
  } finally { world.dispose(); }
});

test('a wheel joint carries a chassis on its suspension, drives and steers', async () => {
  const world = await si();
  try {
    const chassis = world.createBody({shape: {kind: 'box', halfExtents: [1, 0.25, 0.5]}, position: [0, 1, 0], density: 200});
    const wheels = [], joints = [];
    // Wheel axis (frame B z) and suspension axis (frame A x) must be aimed: axle along world z, travel along world y.
    const suspension = axisRotation([0, 1, 0], 'x');
    for (const [x, z] of [[-0.8, -0.7], [-0.8, 0.7], [0.8, -0.7], [0.8, 0.7]]) {
      const wheel = world.createBody({shape: {kind: 'sphere', radius: 0.35}, position: [x, 0.5, z], friction: 1, density: 300});
      wheels.push(wheel);
      joints.push(world.createJoint({type: 'wheel', bodyA: chassis, bodyB: wheel, frameA: {position: [x, -0.5, z], rotation: suspension}, frameB: {rotation: suspension},
        spring: {hertz: 4, dampingRatio: 0.7}, limits: {lower: -0.3, upper: 0.3}, motor: {speed: 0, maxForce: 400}}));
    }
    run(world, 2);
    const rest = world.getState(chassis);
    assert.ok(rest.position[1] > 0.6 && rest.position[1] < 1.1, `chassis rides on its suspension (y = ${rest.position[1]})`);
    near(rest.position[0], 0, 0.05, 'and stays put with the motors holding');
    for (const joint of joints) world.setJointMotor(joint, {speed: 8, maxForce: 400});
    run(world, 3);
    const driven = world.getState(chassis);
    assert.ok(Math.abs(driven.position[0]) > 2, `the driven wheels move the car (x = ${driven.position[0]})`);
    assert.equal(world.getJointState(joints[0]).type, 'wheel');
    world.setJointSteering(joints[2], {angle: 0.4, hertz: 10, dampingRatio: 1, maxTorque: 1e4});
    world.setJointSteering(joints[3], {angle: 0.4, hertz: 10, dampingRatio: 1, maxTorque: 1e4});
    run(world, 3);
    assert.ok(Math.abs(world.getState(chassis).position[2] - driven.position[2]) > 0.5, 'steering turns the car off its straight line');
  } finally { world.dispose(); }
});

test('kinematic bodies, setters, forces, gravity control and collision filters', async () => {
  const world = await si({ground: false, gravity: [0, 0, 0]});
  try {
    const pusher = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, type: 'kinematic', position: [0, 0, 0], linearVelocity: [1, 0, 0]});
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.5}, position: [2, 0, 0]});
    run(world, 2);
    within(world.getState(pusher).position[0], 2, 1e-4, 'a kinematic body moves at exactly its velocity');
    assert.ok(world.getState(ball).position[0] >= 2.99, 'and pushes a dynamic body ahead of it');
    assert.equal(world.getState(pusher).type, 'kinematic');
    world.setVelocity(pusher, [0, 0, 0]);
    world.moveKinematic(pusher, [2, 3, 0], toQuat({x: 0, y: 0, z: 0, w: 1}), 0.5);
    run(world, 0.5);
    near(world.getState(pusher).position[1], 3, 1e-3, 'moveKinematic reaches its target on time');
    // moveKinematic sets a velocity, and a kinematic body keeps moving until told otherwise.
    world.setVelocity(pusher, [0, 0, 0]);

    // F = m a: a constant force for 1 s from rest gives v = F t / m.
    const cart = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0, 20, 0], density: 100});
    const m = world.getState(cart).mass;
    for (let i = 0; i < HZ; i++) { world.applyForce(cart, [50, 0, 0]); world.step(); }
    within(world.getState(cart).linearVelocity[0], 50 / m, 1e-3, 'F = m a');
    // Torque about a principal axis: alpha = tau / I, I = m (a^2 + b^2) / 12 for a box.
    const inertia = m * (1 + 1) / 12;
    for (let i = 0; i < HZ; i++) { world.applyTorque(cart, [0, 5, 0]); world.step(); }
    within(world.getState(cart).angularVelocity[1], 5 / inertia, 1e-3, 'tau = I alpha');
    world.setVelocity(cart, [0, 0, 0], [0, 0, 0]);
    world.applyAngularImpulse(cart, [0, 0, inertia * 2]);
    within(world.getState(cart).angularVelocity[2], 2, 1e-3, 'angular impulse');

    world.setTransform(cart, [0, 50, 0], [0, 0, Math.SQRT1_2, Math.SQRT1_2]);
    const moved = world.getState(cart), pose = world.getPose(cart);
    near(moved.position[1], 50, 1e-5, 'teleport');
    near(moved.rotation[2], Math.SQRT1_2, 1e-5, 'teleport rotation');
    near(pose.position[1], 50, 1e-5, 'the render row follows a teleport at once');

    world.setGravity([0, -G, 0]);
    world.setVelocity(cart, [0, 0, 0]);
    const floater = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [10, 50, 0], gravityScale: 0});
    const feather = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [12, 50, 0]});
    world.setGravityScale(feather, 0.5);
    world.setBodyType(pusher, 'static');
    run(world, 1);
    within(world.getState(cart).linearVelocity[1], -G, 1e-3, 'setGravity takes effect');
    near(world.getState(floater).linearVelocity[1], 0, 1e-6, 'gravityScale 0 floats');
    within(world.getState(feather).linearVelocity[1], -G / 2, 1e-3, 'gravityScale 0.5');
    assert.equal(world.getState(pusher).type, 'static');
    near(world.getState(pusher).position[1], 3, 1e-5, 'a body made static stays put');

    // Filters: the ghost shares no category/mask bit with the wall, the solid one does.
    world.setGravity([0, 0, 0]);
    world.createBody({shape: {kind: 'box', halfExtents: [0.1, 2, 2]}, type: 'static', position: [100, 0, 0], filter: {categoryBits: 1n, maskBits: 1n}});
    const ghost = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [97, 0, 0.5], linearVelocity: [3, 0, 0], filter: {categoryBits: 2n, maskBits: 2n}});
    const solid = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [97, 0, -0.5], linearVelocity: [3, 0, 0], filter: {categoryBits: 1n, maskBits: 1n}});
    run(world, 2);
    within(world.getState(ghost).position[0], 103, 1e-3, 'the filtered body passes through');
    assert.ok(world.getState(solid).position[0] < 99.7, 'the unfiltered body is stopped');
    world.setCollisionFilter(ghost, 1n, 1n);
    world.setVelocity(ghost, [-3, 0, 0]);
    run(world, 2);
    assert.ok(world.getState(ghost).position[0] > 100.3, 'after setCollisionFilter it collides too');

    world.destroyBody(cart);
    assert.throws(() => world.getState(cart), e => e.code === 'STALE_BODY');
    assert.throws(() => world.setVelocity(cart, [0, 0, 0]), e => e.code === 'STALE_BODY');
    assert.throws(() => world.setVelocity(ball, [NaN, 0, 0]), e => e.code === 'INVALID_PAYLOAD');
  } finally { world.dispose(); }
});

test('contact, hit and sensor events arrive after the step that caused them', async () => {
  const world = await si();
  try {
    const events = [];
    const stop = world.onEvent(event => events.push(event));
    const drop = 2, radius = 0.2;
    const ball = world.createBody({shape: {kind: 'sphere', radius}, position: [0, drop + radius, 0], hitEvents: true});
    const gate = world.createBody({shape: {kind: 'box', halfExtents: [1, 0.25, 1]}, type: 'static', position: [0, 1.2, 0], sensor: true});
    const ground = world.bodyAt(0);
    run(world, 2);
    const kinds = events.map(e => e.kind);
    assert.deepEqual(kinds.filter(k => k.startsWith('sensor')), ['sensor-begin', 'sensor-end'], 'the ball falls through the sensor once');
    const sensor = events.find(e => e.kind === 'sensor-begin');
    assert.equal(sensor.bodyA.token, gate.token, 'A is the sensor');
    assert.equal(sensor.bodyB.token, ball.token, 'B is the visitor');
    const begin = events.find(e => e.kind === 'contact-begin');
    assert.deepEqual([begin.bodyA.token, begin.bodyB.token].sort(), [ball.token, ground.token].sort(), 'the ball touches the ground');
    const hit = events.find(e => e.kind === 'hit');
    within(hit.approachSpeed, Math.sqrt(2 * G * drop), 0.02, 'hit speed is sqrt(2 g h)');
    near(hit.point[1], 0, 0.02, 'hit point is on the ground');
    near(Math.abs(hit.normal[1]), 1, 1e-3, 'hit normal is vertical');
    assert.ok(kinds.indexOf('sensor-begin') < kinds.indexOf('contact-begin'), 'events keep their order');
    assert.equal(world.droppedEvents, 0);
    events.length = 0;
    world.applyImpulse(ball, [0, world.getState(ball).mass * 3, 0]);
    run(world, 0.25);
    const end = events.find(e => e.kind === 'contact-end');
    assert.deepEqual([end.bodyA.token, end.bodyB.token].sort(), [ball.token, ground.token].sort(), 'leaving the ground ends the contact');
    run(world, 2);
    events.length = 0;
    world.destroyBody(ball);
    world.step();
    assert.equal(events.length, 0, 'Box3D reports no contact-end for a destroyed body; destroyBody() is your signal');
    stop();
    events.length = 0;
    world.createBody({shape: {kind: 'sphere', radius}, position: [3, 0.5, 0]});
    run(world, 1);
    assert.equal(events.length, 0, 'a removed listener hears nothing');
  } finally { world.dispose(); }
});

test('the classic arena is unchanged, and recordings of general worlds replay bit for bit', async () => {
  const world = await createWorld();
  try {
    assert.deepEqual(world.gravity().map(v => +v.toFixed(4)), [0, -10, 0], 'the arena keeps its original gravity');
    assert.deepEqual(world.bodyKinds(), ['box']);
    world.startRecording();
    world.spawnBox({position: [0, 3, 0]});
    for (let i = 0; i < 60; i++) world.step();
    const classic = world.stopRecording();
    assert.equal(classic.version, 1, 'a classic recording keeps log version 1');
    assert.equal(world.replay(classic), true);

    // An SI recording that uses every kind of call: bodies of each shape, joints, setters, forces, destruction.
    world.startRecording({world: {gravity: [0, -9.81, 0]}, checkpointEvery: 30});
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 3, 0], restitution: 0.4});
    const pill = world.createBody({shape: {kind: 'capsule', radius: 0.2, halfLength: 0.4}, position: [1, 2, 0], filter: {categoryBits: 3n, maskBits: 0xffffn}});
    const rock = world.createBody({shape: {kind: 'hull', points: new Float32Array([1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]).map(v => v * 0.4)}, position: [-2, 4, 0]});
    world.createBody({shape: {kind: 'mesh', vertices: [3, 0, -2, 9, 2, -2, 9, 2, 2, 3, 0, 2], indices: [0, 2, 1, 0, 3, 2]}, position: [0, 0, 0]});
    const arm = world.createBody({shape: {kind: 'box', halfExtents: [0.6, 0.1, 0.1]}, position: [-5, 2, 0]});
    const hinge = world.createJoint({type: 'revolute', bodyA: null, bodyB: arm, frameA: {position: [-5.6, 2, 0]}, frameB: {position: [-0.6, 0, 0]}, motor: {speed: 3, maxForce: 500}});
    const rope = world.createJoint({type: 'distance', bodyA: ball, bodyB: pill, length: 1.5, spring: {hertz: 3, dampingRatio: 0.2}});
    for (let i = 0; i < 90; i++) {
      if (i === 20) { world.applyForce(ball, [40, 0, 0], [0, 3.2, 0]); world.setJointMotor(hinge, {speed: -2, maxForce: 500}); }
      if (i === 40) { world.setVelocity(rock, [0, 6, 0], [1, 0, 2]); world.setGravity([0, -3, 0]); world.setCollisionFilter(pill, 1n, 0xffffn, -1); }
      if (i === 60) { world.destroyJoint(rope); world.destroyBody(rock); world.setJointLimits(hinge, {lower: -1, upper: 1}); world.applyTorque(arm, [0, 0, 30]); }
      world.step();
    }
    const expected = world.exactHash();
    const log = JSON.parse(JSON.stringify(world.stopRecording()));
    assert.equal(log.version, 2);
    assert.deepEqual(log.world, {ground: true, gravity: [0, -9.81, 0]});
    assert.ok(log.commands.some(c => c.op === 'call' && c.method === 'createJoint'), 'general calls are logged');
    assert.ok(log.commands.some(c => c.op === 'destroyBody'), 'beside the classic commands');
    world.resetArena();
    const report = world.replayDetailed(log);
    assert.deepEqual([report.matches, report.divergence, report.finalHash, report.checkpointsCompared], [true, null, expected, 3], 'the JSON round-tripped log replays exactly');
    assert.deepEqual(world.gravity().map(v => +v.toFixed(4)), [0, -3, 0], 'including the gravity change');
    // A tampered log is caught at the first checkpoint after the change.
    const bent = structuredClone(log);
    bent.commands.find(c => c.method === 'setVelocity').args[1] = [0, 6.001, 0];
    const diverged = world.replayDetailed(bent);
    assert.deepEqual([diverged.matches, diverged.divergence], [false, {from: 30, to: 60}]);
    assert.throws(() => world.replayDetailed({...log, commands: [{t: 0, op: 'call', method: 'dispose', args: []}]}), e => e.code === 'INVALID_PAYLOAD', 'only whitelisted methods replay');
    // A joint made before recording cannot be named by the log.
    world.reset();
    const early = world.createJoint({type: 'weld', bodyA: null, bodyB: world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [0, 1, 0]})});
    world.startRecording({world: {}});
    assert.throws(() => world.setJointSpring(early, null), e => e.code === 'INVALID_PAYLOAD' || e.code === 'INVALID_STATE');
    world.stopRecording();
  } finally { world.dispose(); }
});

test('the three.js shape adapter draws boxes, spheres and exact capsules', async () => {
  // Structural stand-ins for the three classes the adapter touches.
  class Attribute { constructor(array) { this.array = array; this.needsUpdate = false; } }
  class Mesh { constructor(geometry, material, count) { this.geometry = geometry; this.count = count; this.instanceMatrix = new Attribute(new Float32Array(count * 16)); this.instanceColor = null; } }
  const geometry = name => class { constructor(...args) { this.name = name; this.args = args; } };
  const THREE = {BoxGeometry: geometry('box'), SphereGeometry: geometry('sphere'), CylinderGeometry: geometry('cylinder'), MeshStandardMaterial: class {},
    InstancedMesh: Mesh, InstancedBufferAttribute: Attribute, Group: class { constructor() { this.children = []; } add(...objects) { this.children.push(...objects); } }};
  const world = await si({ground: false, gravity: [0, 0, 0]});
  try {
    world.createBody({shape: {kind: 'box', halfExtents: [1, 2, 3]}, position: [0, 0, 0], color: 0xff0000});
    world.createBody({shape: {kind: 'sphere', radius: 0.5}, position: [5, 0, 0], color: 0x00ff00});
    // Lying along world x: local y rotated onto x.
    world.createBody({shape: {kind: 'capsule', radius: 0.25, halfLength: 1.5}, position: [10, 0, 0], rotation: [0, 0, -Math.SQRT1_2, Math.SQRT1_2], color: 0x0000ff});
    const meshes = createShapeMeshes(THREE, world, undefined, 8);
    assert.equal(meshes.group.children.length, 3);
    assert.deepEqual([meshes.boxes.count, meshes.spheres.count, meshes.cylinders.count], [1, 3, 1], 'one box, one sphere plus two caps, one cylinder');
    assert.deepEqual(meshes.cylinders.geometry.args.slice(0, 3), [1, 1, 2], 'unit cylinder, scaled per instance');
    const s = meshes.spheres.instanceMatrix.array, column = (o, c) => Math.hypot(s[o + c * 4], s[o + c * 4 + 1], s[o + c * 4 + 2]);
    for (const cap of [1, 2]) for (const c of [0, 1, 2]) near(column(cap * 16, c), 0.25, 1e-6, `cap ${cap} axis ${c} has the capsule radius`);
    near(s[16 + 12], 11.5, 1e-5, 'one cap at the +x end'); near(s[32 + 12], 8.5, 1e-5, 'the other at the -x end');
    near(s[16 + 13], 0, 1e-5, 'caps stay on the axis');
    assert.deepEqual([...meshes.spheres.instanceColor.array.slice(0, 9)], [0, 1, 0, 0, 0, 1, 0, 0, 1], 'caps take the capsule color');
    const before = meshes.boxes.instanceMatrix.needsUpdate = false;
    assert.equal(syncShapeMeshes(world, meshes), 3);
    assert.equal(meshes.boxes.instanceMatrix.needsUpdate, before, 'an unchanged world is not copied again');
    world.setVelocity(world.bodyAt(1), [1, 0, 0]);
    world.step();
    syncShapeMeshes(world, meshes);
    assert.ok(s[12] > 5, 'the sphere moved and was re-synced');
  } finally { world.dispose(); }
});

test('convex hulls: mass is density x volume and a hull rests on its face', async () => {
  const world = await si();
  try {
    const corners = [];
    for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) for (const z of [-0.5, 0.5]) corners.push(x, y, z);
    const cube = world.createBody({shape: {kind: 'hull', points: [...corners, 0, 0, 0]}, position: [0, 0.6, 0], density: 800});
    within(world.getState(cube).mass, 800, 1e-5, 'unit cube hull (the interior point is ignored)');
    const octahedron = world.createBody({shape: {kind: 'hull', points: [1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1]}, position: [5, 30, 0]});
    within(world.getState(octahedron).mass, 1000 * 4 / 3, 1e-5, 'octahedron volume 4/3');
    run(world, 2);
    near(world.getState(cube).position[1], 0.5, 0.006, 'the cube hull rests on the ground (within contact slop)');
    assert.deepEqual(world.bodyKinds(), ['box', 'hull', 'hull']);
    // A dense rounded cloud exceeds Box3D's hull size; the bridge thins it to an inscribed hull.
    const cloud = [];
    for (let i = 0; i < 400; i++) { const y = 1 - 2 * (i + 0.5) / 400, r = Math.sqrt(1 - y * y), phi = i * 2.399963229728653; cloud.push(Math.cos(phi) * r, y, Math.sin(phi) * r); }
    const ball = world.createBody({shape: {kind: 'hull', points: cloud}, position: [10, 30, 0]});
    const sphereMass = 1000 * 4 / 3 * Math.PI, ballMass = world.getState(ball).mass;
    assert.ok(ballMass < sphereMass && ballMass > 0.8 * sphereMass, `a 400-point sphere cloud becomes an inscribed hull (mass ${ballMass} of ${sphereMass})`);
    assert.throws(() => world.createBody({shape: {kind: 'hull', points: [0, 0, 0, 1, 0, 0, 0, 1, 0]}, position: [0, 0, 0]}), e => e.code === 'INVALID_PAYLOAD', 'needs 4 points');
    assert.throws(() => world.createBody({shape: {kind: 'hull', points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 5]}, position: [0, 0, 0]}), e => e.code === 'INVALID_PAYLOAD', 'triples only');
  } finally { world.dispose(); }
});

test('a triangle-mesh incline: sliding at g sin(theta) and rolling at 5/7 of it', async () => {
  const world = await si({ground: false});
  try {
    const theta = 0.3, length = 40, half = 4, c = Math.cos(theta), s = Math.sin(theta), r = 0.25, t = 2;
    const ramp = (z, friction) => world.createBody({
      shape: {kind: 'mesh', vertices: [0, 0, z - half, length * c, -length * s, z - half, length * c, -length * s, z + half, 0, 0, z + half], indices: [0, 2, 1, 0, 3, 2]},
      position: [0, 0, 0], friction, type: 'dynamic',
    });
    const start = z => [c + r * s, -s + r * c, z]; // touching the incline 1 m down from its top edge
    const ice = ramp(0, 0);
    assert.equal(world.getState(ice).type, 'static', 'a mesh body is always static');
    const slider = world.createBody({shape: {kind: 'sphere', radius: r}, position: start(0), friction: 0});
    ramp(20, 1);
    const roller = world.createBody({shape: {kind: 'sphere', radius: r}, position: start(20), friction: 1});
    run(world, t);
    const sliding = world.getState(slider), rolling = world.getState(roller);
    within(Math.hypot(...sliding.linearVelocity), G * s * t, 1e-3, 'frictionless: v = g sin(theta) t');
    near(Math.hypot(...sliding.angularVelocity), 0, 1e-3, 'and no spin');
    near(sliding.position[0] * s + sliding.position[1] * c, r, 0.006, 'it stays on the surface (within contact slop)');
    // A solid sphere rolling without slipping: a = (5/7) g sin(theta). The solver lets it slip slightly.
    within(Math.hypot(...rolling.linearVelocity), 5 / 7 * G * s * t, 0.01, 'rolling: v = (5/7) g sin(theta) t');
    within(Math.abs(rolling.angularVelocity[2]) * r, Math.hypot(...rolling.linearVelocity), 0.02, 'rolling: v = omega r');
    assert.deepEqual(world.bodyKinds().slice(0, 2), ['mesh', 'sphere']);
    assert.throws(() => world.createBody({shape: {kind: 'mesh', vertices: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 1, 3]}, position: [0, 0, 0]}), e => e.code === 'INVALID_PAYLOAD', 'index out of range');
    assert.equal(world.destroyBody(ice), true, 'a mesh body can be destroyed');
    run(world, 0.5);
    assert.ok(world.getState(slider).position[1] < sliding.position[1] - 1, 'and the sphere then falls freely');
  } finally { world.dispose(); }
});

test('height-field terrain: exact heights on a plane, sliding on it, and settling in a bowl', async () => {
  const world = await si({ground: false});
  try {
    const theta = 0.2, nx = 81, nz = 9, d = 0.5, slope = Math.tan(theta), heights = [];
    for (let z = 0; z < nz; z++) for (let x = 0; x < nx; x++) heights.push((nx - 1 - x) * d * slope);
    const hill = world.createBody({shape: {kind: 'heightfield', heights, countX: nx, countZ: nz, spacing: [d, d]}, position: [100, 0, -2], friction: 0, type: 'kinematic'});
    assert.equal(world.getState(hill).type, 'static', 'a height field is always static');
    for (const x of [0.25, 10.3, 39.9]) {
      const hit = world.raycast([100 + x, 100, 0], [0, -200, 0]);
      // Heights are quantised to 16 bits over the field's range (8 m here): about 0.12 mm.
      near(hit.point[1], (40 - x) * slope, 5e-4, `terrain height at x = ${x}`);
      near(hit.normal[1], Math.cos(theta), 1e-4, 'terrain normal');
    }
    const r = 0.25, c = Math.cos(theta), s = Math.sin(theta), t = 2;
    const puck = world.createBody({shape: {kind: 'sphere', radius: r}, position: [101 + r * s, 39 * slope + r * c, 0], friction: 0});
    run(world, t);
    within(Math.hypot(...world.getState(puck).linearVelocity), G * s * t, 1e-3, 'frictionless slide down the terrain');

    const n = 41, bowl = [];
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) bowl.push(0.02 * ((x - 20) ** 2 + (z - 20) ** 2) * 0.0625);
    world.createBody({shape: {kind: 'heightfield', heights: bowl, countX: n, countZ: n, spacing: [0.25, 0.25]}, position: [200, 0, 0], friction: 0.6});
    const marble = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [203.5, 3, 6.5], friction: 0.6, linearDamping: 0.5, angularDamping: 0.5});
    run(world, 20);
    const rest = world.getState(marble);
    near(rest.position[0], 205, 0.1, 'the marble settles at the bottom of the bowl (x)');
    near(rest.position[2], 5, 0.1, 'the marble settles at the bottom of the bowl (z)');
    near(rest.position[1], 0.2, 0.01, 'resting on the lowest cell');
    assert.equal(rest.awake, false);
    assert.throws(() => world.createBody({shape: {kind: 'heightfield', heights: [0, 0, 0], countX: 2, countZ: 2, spacing: [1, 1]}, position: [0, 0, 0]}), e => e.code === 'INVALID_PAYLOAD', 'heights must match the grid');
    world.reset({ground: false});
    assert.equal(world.bodyCount(), 0, 'reset releases terrain and mesh data with the world');
  } finally { world.dispose(); }
});

test('a worker-hosted world runs the same mechanism to the same bits and reports its events', async () => {
  // The same script drives a local world and a remote one; `call` awaits either.
  const script = async world => {
    const ball = await world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 2, 0], hitEvents: true});
    const pill = await world.createBody({shape: {kind: 'capsule', radius: 0.2, halfLength: 0.4}, position: [1.5, 1, 0]});
    const arm = await world.createBody({shape: {kind: 'box', halfExtents: [0.6, 0.1, 0.1]}, position: [-4, 2, 0]});
    const hinge = await world.createJoint({type: 'revolute', bodyA: null, bodyB: arm, frameA: {position: [-4.6, 2, 0]}, frameB: {position: [-0.6, 0, 0]}, motor: {speed: 2, maxForce: 500}});
    await world.createJoint({type: 'distance', bodyA: ball, bodyB: pill, length: 1.8});
    for (let i = 0; i < 240; i++) {
      if (i === 60) { await world.applyForce(ball, [30, 0, 0]); await world.setJointMotor(hinge, {speed: -2, maxForce: 500}); }
      if (i === 120) { await world.setVelocity(pill, [0, 4, 0], [0, 0, 3]); await world.setGravity([0, -4, 0]); }
      await (world.stepOnce ? world.stepOnce() : world.step());
    }
    return {hash: await world.exactHash(), ball, hinge, state: await world.getState(ball), joint: await world.getJointState(hinge)};
  };
  const local = await si();
  const remote = await connectWorld(new Worker(new URL('./fixtures/physics.worker.mjs', import.meta.url)), {step: 1 / HZ, subSteps: SUB, gravity: [0, -9.81, 0], sharedMemory: false});
  try {
    assert.deepEqual(await remote.takeEvents(), {events: [], dropped: 0}, 'the first call starts collection');
    const [here, there] = [await script(local), await script(remote)];
    assert.equal(there.hash, here.hash, 'worker and main thread agree bit for bit');
    assert.deepEqual(there.state, here.state);
    assert.deepEqual(there.joint, here.joint);
    assert.deepEqual([...remote.bodyKinds()], ['box', 'sphere', 'capsule', 'box'], 'row shapes arrive with the frames');
    assert.equal(remote.bodyCount(), 4);
    const {events, dropped} = await remote.takeEvents();
    assert.equal(dropped, 0);
    const hit = events.find(e => e.kind === 'hit');
    assert.ok(hit && hit.approachSpeed > 1, 'the falling ball reported its impact');
    assert.ok([hit.bodyA.token, hit.bodyB.token].includes(there.ball.token), 'with the remote handle of the ball');
    assert.deepEqual((await remote.takeEvents()).events, [], 'events are handed over once');
    assert.equal(await remote.isJointAlive(there.hinge), true);
    assert.equal(await remote.destroyJoint(there.hinge), true);
    await assert.rejects(remote.getJointState(there.hinge), e => e.code === 'STALE_JOINT');
    await remote.reset({ground: false});
    assert.equal(remote.bodyCount(), 0);
    await assert.rejects(remote.getState(there.ball), e => e.code === 'STALE_BODY', 'reset forgets the old handles');
  } finally { local.dispose(); await remote.dispose(); }
});
