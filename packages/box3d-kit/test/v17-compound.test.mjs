// Compound bodies (several shapes on one body) and explicit mass data (mass, centre of mass, inertia tensor),
// from the native bridge to the kit, the scene format, record and replay, the worker, the Lab's loader and robot import.
// Every dynamic check compares a run of the engine with a closed form; the tolerance is stated beside each one and
// the measured number is printed as a diagnostic. docs/VALIDATION.md has the same cases as registry rows.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import {createWorld} from 'box3d-webgpu-kit';
import {connectWorld} from 'box3d-webgpu-kit/worker';
import {
  SCENE_VERSION, SCENE_VERSIONS, SCENE_LIMITS, EXAMPLE_SCENES, SceneBuilder, validateScene, normalizeScene, canonicalize, sceneHash, loadScene, saveScene, sceneWorldOptions,
  encodeSceneLink, encodeSceneLinkSync, decodeSceneLink,
} from 'box3d-webgpu-kit/scene';
import {parseURDF, parseMJCF, robotToScene, robotReport, spawnRobot, sixDofArmURDF, doublePendulumURDF, EXAMPLE_ROBOTS} from 'box3d-webgpu-kit/robot';
import {NativeWorldPool} from '../dist/core/native-world.js';
import {loadLabScene} from '../../../src/lab/scene-host.ts';

const G = 9.81, HZ = 240, SUB = 4;
const si = (extra = {}) => createWorld({step: 1 / HZ, subSteps: SUB, gravity: [0, -G, 0], ...extra});
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const rel = (actual, expected) => actual / expected - 1;
/** Mean time between downward zero crossings of a sampled signal. */
const periodOf = samples => {
  const crossings = [];
  for (let i = 1; i < samples.length; i++) if (samples[i - 1] > 0 && samples[i] <= 0) crossings.push((i - 1 + samples[i - 1] / (samples[i - 1] - samples[i])) / HZ);
  return (crossings.at(-1) - crossings[0]) / (crossings.length - 1);
};
const sphereMass = (r, rho = 1000) => rho * 4 / 3 * Math.PI * r ** 3;
// 3 x 3 symmetric matrices as [xx, yy, zz, xy, xz, yz], the order the API uses.
const full = ([xx, yy, zz, xy, xz, yz]) => [[xx, xy, xz], [xy, yy, yz], [xz, yz, zz]];
const mulV = (m, v) => m.map(row => row[0] * v[0] + row[1] * v[1] + row[2] * v[2]);
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function inverse(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m, det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [[(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det], [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det], [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]];
}
const rotate = ([x, y, z, w], v) => {
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]];
};
/** Eigenvalues of a symmetric 3 x 3 matrix, ascending (Jacobi sweeps). */
function principal(six) {
  const a = full(six).map(row => [...row]);
  for (let sweep = 0; sweep < 60; sweep++) for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
    if (Math.abs(a[p][q]) < 1e-300) continue;
    const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]), t = Math.sign(theta || 1) / (Math.abs(theta) + Math.hypot(theta, 1)), c = 1 / Math.hypot(t, 1), s = t * c;
    for (let k = 0; k < 3; k++) { const x = a[k][p], y = a[k][q]; a[k][p] = c * x - s * y; a[k][q] = s * x + c * y; }
    for (let k = 0; k < 3; k++) { const x = a[p][k], y = a[q][k]; a[p][k] = c * x - s * y; a[q][k] = s * x + c * y; }
  }
  return [a[0][0], a[1][1], a[2][2]].sort((x, y) => x - y);
}

const dumbbell = (r, d) => ({kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: r}, position: [-d, 0, 0]}, {shape: {kind: 'sphere', radius: r}, position: [d, 0, 0]}]});
// A base slab with a tall post on its -x end: an L whose centre of mass is far from the middle of its footprint.
const L_BASE = [0.5, 0.1, 0.3], L_POST = [0.1, 1.0, 0.3], L_POST_AT = [-0.4, 1.2, 0];
const lShape = () => ({kind: 'compound', shapes: [{shape: {kind: 'box', halfExtents: L_BASE}, position: [0, 0.1, 0]}, {shape: {kind: 'box', halfExtents: L_POST}, position: L_POST_AT}]});
function lShapeMass(rho = 1000) {
  const m1 = rho * 8 * L_BASE[0] * L_BASE[1] * L_BASE[2], m2 = rho * 8 * L_POST[0] * L_POST[1] * L_POST[2], m = m1 + m2;
  const c = [m2 * L_POST_AT[0] / m, (m1 * 0.1 + m2 * L_POST_AT[1]) / m, 0], d1 = [-c[0], 0.1 - c[1]], d2 = [L_POST_AT[0] - c[0], L_POST_AT[1] - c[1]];
  const box = (mass, h) => [mass * (h[1] ** 2 + h[2] ** 2) / 3, mass * (h[0] ** 2 + h[2] ** 2) / 3, mass * (h[0] ** 2 + h[1] ** 2) / 3];
  const a = box(m1, L_BASE), b = box(m2, L_POST);
  return {mass: m, center: c, inertia: [a[0] + m1 * d1[1] ** 2 + b[0] + m2 * d2[1] ** 2, a[1] + m1 * d1[0] ** 2 + b[1] + m2 * d2[0] ** 2, a[2] + m1 * (d1[0] ** 2 + d1[1] ** 2) + b[2] + m2 * (d2[0] ** 2 + d2[1] ** 2),
    -(m1 * d1[0] * d1[1] + m2 * d2[0] * d2[1]), 0, 0]};
}

test('a compound body has the summed mass, centre of mass and parallel-axis inertia of its shapes', async t => {
  const world = await si({ground: false});
  try {
    const r = 0.1, d = 0.4, m = sphereMass(r);
    const bar = world.createBody({shape: dumbbell(r, d), position: [0, 5, 0]});
    const data = world.getMassData(bar);
    assert.deepEqual([data.explicit, data.shapeCount, world.bodyKinds()], [false, 2, ['compound']]);
    within(data.mass, 2 * m, 2e-7, 'dumbbell mass');
    within(world.getState(bar).mass, 2 * m, 2e-7, 'the same mass in the body state');
    data.center.forEach((v, i) => near(v, 0, 1e-9, `dumbbell centre ${i}`));
    // About the bar's axis the spheres only spin; across it each adds m d^2 (parallel axes).
    const along = 2 * 0.4 * m * r * r, across = 2 * (0.4 * m * r * r + m * d * d);
    within(data.inertia[0], along, 2e-7, 'Ixx = 2 (2/5 m r^2)');
    within(data.inertia[1], across, 2e-7, 'Iyy = 2 (2/5 m r^2 + m d^2)');
    within(data.inertia[2], across, 2e-7, 'Izz');
    data.inertia.slice(3).forEach((v, i) => near(v, 0, 1e-9, `product of inertia ${i}`));
    t.diagnostic(`dumbbell: mass ${data.mass} (closed form ${2 * m}), Iyy ${data.inertia[1]} (${across}, ${rel(data.inertia[1], across).toExponential(2)})`);

    // An L of two boxes: the centre of mass is off the origin and the tensor has a product of inertia.
    const bracket = world.createBody({shape: lShape(), position: [3, 5, 0]}), got = world.getMassData(bracket), want = lShapeMass();
    within(got.mass, want.mass, 2e-7, 'L mass');
    got.center.forEach((v, i) => near(v, want.center[i], 2e-7, `L centre of mass ${i}`));
    got.inertia.forEach((v, i) => near(v, want.inertia[i], 3e-7 * want.inertia[2], `L inertia ${i}`));
    t.diagnostic(`L shape: centre of mass [${got.center.join(', ')}] (closed form [${want.center.join(', ')}]), Ixy ${got.inertia[3]} (${want.inertia[3]})`);

    // Per-shape density, a rotated box, a capsule lying along x, and a hull: every kind a compound may hold.
    const q90z = [0, 0, Math.SQRT1_2, Math.SQRT1_2], cube = [];
    for (const x of [-0.1, 0.1]) for (const y of [-0.1, 0.1]) for (const z of [-0.1, 0.1]) cube.push(x, y, z);
    const mixed = world.createBody({position: [6, 5, 0], density: 500, shape: {kind: 'compound', shapes: [
      {shape: {kind: 'box', halfExtents: [0.3, 0.1, 0.05]}, rotation: q90z, density: 2000},     // turned a quarter about z: 0.2 x 0.6 x 0.1
      {shape: {kind: 'capsule', radius: 0.05, halfLength: 0.2}, position: [0, 0.5, 0], rotation: q90z},   // its axis now along x
      {shape: {kind: 'hull', points: cube}, position: [0, -0.5, 0], density: 0},   // collides, adds no mass
    ]}});
    const mBox = 2000 * 0.6 * 0.2 * 0.1, r2 = 0.05, h = 0.4, mCyl = 500 * Math.PI * r2 * r2 * h, mCaps = 500 * 4 / 3 * Math.PI * r2 ** 3, mCap = mCyl + mCaps;
    const mix = world.getMassData(mixed), cy = mCap * 0.5 / (mBox + mCap);
    assert.equal(mix.shapeCount, 3);
    within(mix.mass, mBox + mCap, 3e-7, 'mixed mass: the box at its own density, the capsule at the body\'s, the hull at zero');
    near(mix.center[1], cy, 2e-7, 'mixed centre of mass');
    // About y: the turned box is 0.2 wide in x and 0.1 deep in z; the capsule's axis is along x.
    const hemi = mCaps / 2, capAcross = mCyl * (h * h / 12 + r2 * r2 / 4) + 2 * hemi * (0.4 * r2 * r2 + h * h / 4 + 3 * h * r2 / 8);
    const iyy = mBox * (0.2 ** 2 + 0.1 ** 2) / 12 + capAcross;
    within(mix.inertia[1], iyy, 1e-5, 'mixed Iyy: no parallel-axis term, both centres are on the y axis');
    const ixx = mBox * (0.6 ** 2 + 0.1 ** 2) / 12 + mBox * cy * cy + (mCyl * r2 * r2 / 2 + 2 * hemi * 0.4 * r2 * r2) + mCap * (0.5 - cy) ** 2;
    within(mix.inertia[0], ixx, 1e-5, 'mixed Ixx: the capsule about its own axis, plus parallel axes');
    // Where the shapes are: rays straight down find the top of each child at its local pose.
    const top = x => world.raycast([6 + x, 9, 0], [0, -10, 0])?.point[1];
    near(top(0), 5 + 0.5 + 0.05, 1e-4, 'the capsule lies along x at y = +0.5');
    near(top(0.24), 5 + 0.5 + Math.sqrt(0.05 ** 2 - 0.04 ** 2), 1e-4, 'on its round end');
    near(world.raycast([6, 5.28, 0.5], [0, 0, -1])?.point[2], 0.05, 1e-4, 'the box is 0.1 deep and reaches y = +0.3 after its quarter turn');
    assert.equal(world.raycast([6, 5.32, 0.5], [0, 0, -1]), null, 'and no further');
    assert.equal(world.raycast([6.15, 5.2, 0.5], [0, 0, -1]), null, 'and is only 0.2 wide');
    near(world.raycast([6, 2, 0], [0, 10, 0])?.point[1], 5 - 0.6, 1e-4, 'the massless hull is there to be hit');

    // What is refused, by name, before anything is created.
    const bad = (shape, pattern) => assert.throws(() => world.createBody({shape, position: [0, 0, 0]}), error => { assert.equal(error.code, 'INVALID_PAYLOAD'); assert.match(error.message, pattern); return true; });
    const count = world.bodyCount();
    bad({kind: 'compound', shapes: []}, /compound shape count/);
    bad({kind: 'compound'}, /needs a `shapes` array/);
    bad({kind: 'compound', shapes: Array.from({length: 65}, () => ({shape: {kind: 'sphere', radius: 0.1}}))}, /compound shape count/);
    bad({kind: 'compound', shapes: [{shape: {kind: 'mesh', vertices: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 1, 2]}}]}, /compound shape 0: shape\.kind must be 'box', 'sphere', 'capsule' or 'hull'/);
    bad({kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: 0.1}}, {shape: {kind: 'box', halfExtents: [1, 0, 1]}}]}, /compound shape 1 half extent y/);
    bad({kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: 0.1}, rotation: [0, 0, 0, 0]}]}, /rotation must be a non-zero quaternion/);
    bad({kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: 0.1}, density: -1}]}, /compound shape 0 density/);
    bad({kind: 'compound', shapes: [{shape: {kind: 'hull', points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]}}]}, /rejected the body descriptor/);   // four points in one plane: no hull
    assert.equal(world.bodyCount(), count, 'a refused compound leaves nothing behind');
    // 64 shapes are allowed, and a filter set afterwards reaches every one of them.
    const many = world.createBody({position: [20, 5, 0], shape: {kind: 'compound', shapes: Array.from({length: 64}, (_, i) => ({shape: {kind: 'sphere', radius: 0.05}, position: [i * 0.2, 0, 0]}))}});
    assert.equal(world.getMassData(many).shapeCount, 64);
    assert.ok(world.raycast([20 + 63 * 0.2, 9, 0], [0, -10, 0]), 'the last sphere is hit');
    world.setCollisionFilter(many, 2n, 2n);
    assert.equal(world.raycast([20 + 63 * 0.2, 9, 0], [0, -10, 0], {filter: {categoryBits: 1n, maskBits: 1n}}), null, 'not after its filter moved to another category');
  } finally { world.dispose(); }
});

test('a dumbbell spins up at torque / (2 m d^2 + 2 (2/5) m r^2) and swings as a physical pendulum', async t => {
  const world = await si({ground: false, gravity: [0, 0, 0]});
  try {
    const r = 0.1, d = 0.4, m = sphereMass(r), inertia = 2 * (0.4 * m * r * r + m * d * d), torque = 3, seconds = 2;
    const bar = world.createBody({shape: dumbbell(r, d), position: [0, 5, 0], neverSleeps: true});
    for (let i = 0; i < seconds * HZ; i++) { world.applyTorque(bar, [0, 0, torque]); world.step(); }
    const omega = world.getState(bar).angularVelocity[2], expected = torque * seconds / inertia;
    within(omega, expected, 1e-4, 'angular velocity after 2 s of constant torque');
    // Two point masses would give torque t / (2 m d^2): the spheres' own inertia is 2.4% of the total and is there.
    assert.ok(Math.abs(rel(omega, torque * seconds / (2 * m * d * d))) > 0.02, 'the spheres\' own inertia shows');
    t.diagnostic(`spin-up: omega ${omega} rad/s, closed form ${expected} (${rel(omega, expected).toExponential(2)})`);
  } finally { world.dispose(); }
  const swing = await si({ground: false});
  try {
    // Two spheres at l1 and l2 below a hinge through the body origin: T = 2 pi sqrt(I / (M g l)) (1 + theta0^2 / 16).
    const r = 0.1, l1 = 0.5, l2 = 1.2, m = sphereMass(r), theta0 = 0.05, pivot = [0, 10, 0];
    const body = swing.createBody({shape: {kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: r}, position: [0, -l1, 0]}, {shape: {kind: 'sphere', radius: r}, position: [0, -l2, 0]}]},
      position: pivot, rotation: [0, 0, Math.sin(theta0 / 2), Math.cos(theta0 / 2)], neverSleeps: true});
    swing.createJoint({type: 'revolute', bodyA: null, bodyB: body, frameA: {position: pivot}});
    const samples = [];
    for (let i = 0; i < HZ * 30; i++) { swing.step(); const q = swing.getState(body).rotation; samples.push(2 * Math.atan2(q[2], q[3])); }
    const about = 2 * 0.4 * m * r * r + m * (l1 * l1 + l2 * l2), expected = 2 * Math.PI * Math.sqrt(about / (m * G * (l1 + l2))) * (1 + theta0 * theta0 / 16), measured = periodOf(samples);
    within(measured, expected, 1e-4, 'physical-pendulum period');
    // One sphere of the same total mass at the centre of mass would swing 8% faster.
    assert.ok(Math.abs(rel(measured, 2 * Math.PI * Math.sqrt((l1 + l2) / 2 / G))) > 0.05, 'not the period of a point mass at the centre of mass');
    within(Math.max(...samples.slice(-HZ * 4).map(Math.abs)), theta0, 0.01, 'amplitude after 26 s');
    t.diagnostic(`pendulum: period ${measured} s, closed form ${expected} s (${rel(measured, expected).toExponential(2)})`);
  } finally { swing.dispose(); }
});

test('an L-shaped compound tips when its centre of mass passes over the edge of its base, and rests when it does not', async t => {
  // Gravity is tilted by `angle` towards -x, which is the slab under the post. The body turns over its -x bottom edge
  // once the centre of mass is beyond it: tan(critical) = (0.5 + cx) / cy.
  const want = lShapeMass(), critical = Math.atan2(0.5 + want.center[0], want.center[1]);
  const tilt = async (angle, seconds = 4) => {
    const world = await si({gravity: [-G * Math.sin(angle), -G * Math.cos(angle), 0]});
    try {
      const body = world.createBody({shape: lShape(), position: [0, 0.0005, 0], friction: 2, neverSleeps: true});
      for (let i = 0; i < seconds * HZ; i++) world.step();
      const state = world.getState(body);
      return {turned: 2 * Math.atan2(state.rotation[2], state.rotation[3]), slid: state.position[0], speed: Math.hypot(...state.linearVelocity, ...state.angularVelocity)};
    } finally { world.dispose(); }
  };
  const degrees = v => v * 180 / Math.PI, margin = 0.5 * Math.PI / 180;
  const below = await tilt(critical - margin), above = await tilt(critical + margin);
  assert.ok(Math.abs(below.turned) < 0.002 && Math.abs(below.slid) < 0.002, `0.5 degrees below the critical angle it stays: turned ${below.turned} rad, moved ${below.slid} m`);
  assert.ok(above.turned > 0.5, `0.5 degrees above it tips over: turned ${above.turned} rad`);
  // Bisect for the angle at which the engine's body tips.
  let low = critical - margin, high = critical + margin;
  for (let i = 0; i < 6; i++) { const mid = (low + high) / 2; if ((await tilt(mid, 8)).turned > 0.2) high = mid; else low = mid; }
  const measured = (low + high) / 2;
  near(degrees(measured), degrees(critical), 0.1, 'tipping angle in degrees');
  // The middle of the footprint is not the centre of mass: a uniform block of the same outline would tip at another angle.
  assert.ok(Math.abs(degrees(critical) - degrees(Math.atan2(0.5, 1.1))) > 5, 'the L is told apart from its bounding box');
  t.diagnostic(`tipping: critical angle ${degrees(critical).toFixed(3)} degrees from the centre of mass, engine tips between ${degrees(low).toFixed(3)} and ${degrees(high).toFixed(3)}`);
});

test('a compound resting on the ground stays at rest and goes to sleep', async t => {
  const world = await si();
  try {
    const body = world.createBody({shape: lShape(), position: [0, 0.0005, 0]});
    const table = world.createBody({position: [4, 0.4005, 0], shape: {kind: 'compound', shapes: [
      {shape: {kind: 'box', halfExtents: [0.5, 0.04, 0.3]}, position: [0, 0.36, 0]},
      ...[[-0.45, -0.25], [0.45, -0.25], [-0.45, 0.25], [0.45, 0.25]].map(([x, z]) => ({shape: {kind: 'capsule', radius: 0.04, halfLength: 0.32}, position: [x, -0.04, z]})),
    ]}});
    const start = [body, table].map(one => world.getState(one));
    let fastest = 0;
    for (let i = 0; i < HZ * 6; i++) {
      world.step();
      if (i >= HZ) for (const one of [body, table]) { const s = world.getState(one); fastest = Math.max(fastest, Math.hypot(...s.linearVelocity), Math.hypot(...s.angularVelocity)); }
    }
    const moved = [body, table].map((one, k) => { const s = world.getState(one); return Math.hypot(...s.position.map((v, i) => v - start[k].position[i])); });
    assert.ok(Math.max(...moved) < 1e-3, `moved ${moved} m in 6 s`);
    assert.ok(fastest < 1e-3, `largest speed after the first second ${fastest}`);
    assert.deepEqual([world.getState(body).awake, world.getState(table).awake], [false, false], 'both went to sleep');
    // New mass data wake a sleeping body: with its centre of mass moved it may no longer balance where it sleeps.
    world.setMassData(body, {mass: 300, center: [-0.45, 0.8, 0], inertia: [100, 20, 110, 0, 0, 0]});
    assert.equal(world.getState(body).awake, true, 'setMassData wakes the body');
    world.resetMassData(table);
    assert.equal(world.getState(table).awake, true, 'so does resetMassData');
    t.diagnostic(`rest: L moved ${moved[0].toExponential(2)} m, table on four capsule legs ${moved[1].toExponential(2)} m; largest speed after 1 s ${fastest}`);
  } finally { world.dispose(); }
});

test('explicit mass data: a body spins up at I^-1 torque, accelerates at F / m, and keeps the values across a type change', async t => {
  const world = await si({ground: false, gravity: [0, 0, 0]});
  try {
    // A sphere whose shape says 4.19 kg and 0.0168 kg m^2 is told otherwise.
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.1}, position: [0, 5, 0], neverSleeps: true});
    world.setMassData(ball, {mass: 7, inertia: [2, 3, 5, 0, 0, 0]});
    assert.deepEqual(world.getMassData(ball), {mass: 7, center: [0, 0, 0], inertia: [2, 3, 5, 0, 0, 0], explicit: true, shapeCount: 1});
    assert.equal(world.getState(ball).mass, 7);
    for (let i = 0; i < HZ; i++) { world.applyForce(ball, [14, 0, 0]); world.applyTorque(ball, [0, 6, 0]); world.step(); }
    const state = world.getState(ball);
    within(state.linearVelocity[0], 14 / 7, 1e-4, 'v = F t / m');
    within(state.angularVelocity[1], 6 / 3, 1e-4, 'omega = torque t / Iyy, about a principal axis');
    t.diagnostic(`explicit: v ${state.linearVelocity[0]} m/s (2), omega ${state.angularVelocity[1]} rad/s (2)`);
    // Box3D drops an explicit mass when the body type changes; the bridge puts it back.
    world.setBodyType(ball, 'kinematic');
    assert.equal(world.getMassData(ball).mass, 0, 'a kinematic body has no mass');
    world.setBodyType(ball, 'dynamic');
    assert.deepEqual(world.getMassData(ball).inertia, [2, 3, 5, 0, 0, 0], 'the values are back');
    world.resetMassData(ball);
    const shape = world.getMassData(ball);
    assert.equal(shape.explicit, false);
    within(shape.mass, sphereMass(0.1), 2e-7, 'resetMassData returns to the shape');
    within(shape.inertia[0], 0.4 * sphereMass(0.1) * 0.01, 2e-7, 'and its inertia');

    // A full tensor, given at creation. The reference is Euler's equations, I w' = torque - w x (I w), integrated with RK4.
    const six = [0.5, 0.8, 1.1, 0.1, -0.05, 0.2], body = world.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}, position: [3, 9, 0], neverSleeps: true, massData: {mass: 3, inertia: six}});
    const tensor = full(six), inv = inverse(tensor), torqueBody = [0.3, -0.2, 0.25], seconds = 2;
    // The torque is fixed in the body: each step it is turned into the world by the body's rotation.
    for (let i = 0; i < seconds * HZ; i++) { world.applyTorque(body, rotate(world.getState(body).rotation, torqueBody)); world.step(); }
    const end = world.getState(body), q = end.rotation, omegaBody = rotate([-q[0], -q[1], -q[2], q[3]], end.angularVelocity);
    const rate = w => mulV(inv, torqueBody.map((v, i) => v - cross(w, mulV(tensor, w))[i]));
    let w = [0, 0, 0];
    const dt = 1 / (HZ * 16);
    for (let i = 0; i < seconds * HZ * 16; i++) {
      const k1 = rate(w), k2 = rate(w.map((v, j) => v + dt / 2 * k1[j])), k3 = rate(w.map((v, j) => v + dt / 2 * k2[j])), k4 = rate(w.map((v, j) => v + dt * k3[j]));
      w = w.map((v, j) => v + dt / 6 * (k1[j] + 2 * k2[j] + 2 * k3[j] + k4[j]));
    }
    const error = Math.hypot(...omegaBody.map((v, i) => v - w[i])) / Math.hypot(...w);
    assert.ok(error < 2e-3, `angular velocity in body axes ${omegaBody} against Euler's equations ${w}: ${error}`);
    // The first instants are I^-1 torque exactly; a diagonal tensor with the same moments would miss the cross terms.
    const cold = world.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}, position: [6, 9, 0], neverSleeps: true, massData: {mass: 3, inertia: six}});
    for (let i = 0; i < 12; i++) { world.applyTorque(cold, [0.3, 0, 0]); world.step(); }
    const early = world.getState(cold).angularVelocity, alpha = mulV(inv, [0.3, 0, 0]).map(v => v * 12 / HZ);
    early.forEach((v, i) => near(v, alpha[i], 2e-4 * Math.hypot(...alpha), `omega ${i} after 0.05 s: the off-diagonal terms couple the axes`));
    assert.ok(Math.abs(early[1]) > 0.1 * Math.abs(early[0]), 'a torque about x turns the body about y as well');
    t.diagnostic(`full tensor: after 2 s body-axis omega [${omegaBody.map(v => v.toFixed(5)).join(', ')}], Euler's equations [${w.map(v => v.toFixed(5)).join(', ')}] (relative difference ${error.toExponential(2)}); after 0.05 s [${early.join(', ')}] against I^-1 torque t [${alpha.join(', ')}]`);

    // What is refused.
    const refuse = (data, pattern) => assert.throws(() => world.setMassData(ball, data), e => { assert.equal(e.code, 'INVALID_PAYLOAD'); assert.match(e.message, pattern); return true; });
    refuse({mass: 0, inertia: [1, 1, 1, 0, 0, 0]}, /mass/);
    refuse({mass: 1, inertia: [1, 1, 1, 2, 0, 0]}, /positive-definite/);
    refuse({mass: 1, inertia: [1, 1, 0, 0, 0, 0]}, /Izz/);
    refuse({mass: 1, inertia: [1, 1, 1]}, /\[Ixx, Iyy, Izz, Ixy, Ixz, Iyz\]/);
    refuse({mass: 1, center: [0, NaN, 0], inertia: [1, 1, 1, 0, 0, 0]}, /centre of mass y/);
    assert.equal(world.getMassData(ball).explicit, false, 'a refused call changes nothing');
    world.destroyBody(ball);
    assert.throws(() => world.setMassData(ball, {mass: 1, inertia: [1, 1, 1, 0, 0, 0]}), e => e.code === 'STALE_BODY' || e.code === 'INVALID_PAYLOAD');
    // A body with locked rotation takes the mass and keeps no inertia.
    const locked = world.createBody({shape: {kind: 'sphere', radius: 0.1}, position: [9, 5, 0], lockRotation: true, massData: {mass: 2, inertia: [1, 1, 1, 0, 0, 0]}});
    assert.deepEqual([world.getMassData(locked).mass, world.getMassData(locked).inertia], [2, [0, 0, 0, 0, 0, 0]]);
    world.applyTorque(locked, [0, 5, 0]); world.step();
    assert.deepEqual(world.getState(locked).angularVelocity, [0, 0, 0]);
  } finally { world.dispose(); }
});

test('an explicit centre of mass: a hinged sphere swings with the period its stated mass data imply, and setting them keeps the motion', async t => {
  const world = await si({ground: false});
  try {
    // A sphere hinged through its own centre has no restoring torque. Told that its centre of mass is d below the
    // hinge with inertia I about that centre, it is a physical pendulum: T = 2 pi sqrt((I + m d^2) / (m g d)).
    const m = 2, d = 0.3, about = 0.05, theta0 = 0.05, pivot = [0, 10, 0];
    const body = world.createBody({shape: {kind: 'sphere', radius: 0.1}, position: pivot, rotation: [0, 0, Math.sin(theta0 / 2), Math.cos(theta0 / 2)], neverSleeps: true,
      massData: {mass: m, center: [0, -d, 0], inertia: [about, about, about, 0, 0, 0]}});
    world.createJoint({type: 'revolute', bodyA: null, bodyB: body, frameA: {position: pivot}});
    const samples = [];
    for (let i = 0; i < HZ * 20; i++) { world.step(); const q = world.getState(body).rotation; samples.push(2 * Math.atan2(q[2], q[3])); }
    const expected = 2 * Math.PI * Math.sqrt((about + m * d * d) / (m * G * d)) * (1 + theta0 * theta0 / 16), measured = periodOf(samples);
    within(measured, expected, 1e-4, 'period from the stated centre of mass and inertia');
    near(Math.hypot(...world.getState(body).position.map((v, i) => v - pivot[i])), 0, 1e-4, 'the body origin stays on the hinge');
    t.diagnostic(`explicit centre of mass: period ${measured} s, closed form ${expected} s (${rel(measured, expected).toExponential(2)})`);

    // Moving the centre of mass under a spinning body in free flight: the origin keeps its velocity, the pose is untouched.
    world.setGravity([0, 0, 0]);
    const spinner = world.createBody({shape: {kind: 'box', halfExtents: [0.2, 0.1, 0.1]}, position: [5, 5, 0], linearVelocity: [1, 0, 0], angularVelocity: [0, 0, 2], neverSleeps: true});
    const before = world.getState(spinner);
    world.setMassData(spinner, {mass: 4, center: [0.5, 0, 0], inertia: [0.1, 0.2, 0.2, 0, 0, 0]});
    const after = world.getState(spinner);
    assert.deepEqual([after.position, after.rotation, after.angularVelocity], [before.position, before.rotation, before.angularVelocity]);
    // The state reports the velocity of the centre of mass: v_origin + w x r = [1, 0, 0] + [0, 0, 2] x [0.5, 0, 0].
    after.linearVelocity.forEach((v, i) => near(v, [1, 1, 0][i], 1e-6, `centre-of-mass velocity ${i}`));
    for (let i = 0; i < HZ; i++) world.step();
    // With no force the centre of mass moves in a straight line at that velocity, and the origin circles it.
    const later = world.getState(spinner), centre = rotate(later.rotation, [0.5, 0, 0]).map((v, i) => v + later.position[i]);
    centre.forEach((v, i) => near(v, [5.5 + 1, 5 + 1, 0][i], 2e-4, `centre of mass after 1 s, axis ${i}`));
    within(later.angularVelocity[2], 2, 1e-5, 'spin kept');
  } finally { world.dispose(); }
});

test('recordings with compound bodies and mass data replay bit for bit, and a worker-hosted world agrees with a local one', async () => {
  const world = await createWorld();
  try {
    world.startRecording({world: {gravity: [0, -9.81, 0]}, checkpointEvery: 30});
    const bar = world.createBody({shape: dumbbell(0.15, 0.5), position: [0, 3, 0], rotation: [0, 0, 0.3, 0.954], restitution: 0.2});
    const bracket = world.createBody({shape: lShape(), position: [3, 0.5, 0], angularVelocity: [0, 1, 0]});
    const heavy = world.createBody({shape: {kind: 'box', halfExtents: [0.2, 0.2, 0.2]}, position: [-3, 2, 0], massData: {mass: 50, center: [0.1, 0, 0], inertia: [1, 2, 3, 0.1, 0, 0]}});
    const hinge = world.createJoint({type: 'revolute', bodyA: null, bodyB: heavy, frameA: {position: [-3, 2.4, 0]}, frameB: {position: [0, 0.4, 0]}});
    for (let i = 0; i < 120; i++) {
      if (i === 20) world.setMassData(bar, {mass: 9, center: [0.2, 0, 0], inertia: [0.3, 2, 2, 0, 0, 0]});
      if (i === 45) { world.applyTorque(bracket, [0, 0, 400]); world.setJointMotor(hinge, {speed: 1, maxForce: 100}); }
      if (i === 70) world.resetMassData(bar);
      if (i === 90) world.setMassData(heavy, {mass: 5, inertia: [0.1, 0.1, 0.1, 0, 0, 0]});
      world.step();
    }
    const expected = world.exactHash(), log = JSON.parse(JSON.stringify(world.stopRecording()));
    assert.equal(log.version, 2);
    assert.deepEqual(log.commands.filter(c => c.op === 'call').map(c => c.method), ['createBody', 'createBody', 'createBody', 'createJoint', 'setMassData', 'applyTorque', 'setJointMotor', 'resetMassData', 'setMassData']);
    assert.deepEqual(log.commands[0].args[0].shape.shapes.length, 2, 'the compound shape is in the log as plain JSON');
    world.resetArena();
    const report = world.replayDetailed(log);
    assert.deepEqual([report.matches, report.divergence, report.finalHash, report.checkpointsCompared], [true, null, expected, 4]);
    // A log whose mass data were changed diverges, so the replay really applies them.
    const bent = structuredClone(log);
    bent.commands.find(c => c.method === 'setMassData').args[1].mass = 9.5;
    assert.equal(world.replayDetailed(bent).matches, false);
  } finally { world.dispose(); }

  const script = async target => {
    await target.reset({ground: true});
    const bar = await target.createBody({shape: dumbbell(0.15, 0.5), position: [0, 3, 0], rotation: [0, 0, 0.3, 0.954]});
    const heavy = await target.createBody({shape: {kind: 'box', halfExtents: [0.2, 0.2, 0.2]}, position: [-3, 2, 0], massData: {mass: 50, center: [0.1, 0, 0], inertia: [1, 2, 3, 0.1, 0, 0]}});
    for (let i = 0; i < 150; i++) {
      if (i === 40) await target.setMassData(bar, {mass: 9, center: [0.2, 0, 0], inertia: [0.3, 2, 2, 0, 0, 0]});
      if (i === 100) await target.resetMassData(heavy);
      await (target.stepOnce ? target.stepOnce() : target.step());
    }
    return {hash: await target.exactHash(), bar: await target.getMassData(bar), heavy: await target.getMassData(heavy), state: await target.getState(bar)};
  };
  const local = await si();
  const remote = await connectWorld(new Worker(new URL('./fixtures/physics.worker.mjs', import.meta.url)), {step: 1 / HZ, subSteps: SUB, gravity: [0, -9.81, 0], sharedMemory: false});
  try {
    const [here, there] = [await script(local), await script(remote)];
    assert.equal(there.hash, here.hash, 'worker and main thread agree bit for bit');
    assert.deepEqual([there.bar, there.heavy, there.state], [here.bar, here.heavy, here.state]);
    assert.deepEqual([there.bar.explicit, there.bar.shapeCount, there.heavy.explicit], [true, 2, false]);
    assert.deepEqual([...remote.bodyKinds()], ['box', 'compound', 'box'], 'the compound row kind arrives with the frames');
  } finally { local.dispose(); await remote.dispose(); }
});

const compoundScene = () => ({
  format: 'box3d-scene', version: 2,
  world: {step: 1 / 120, subSteps: 4},
  materials: {steel: {density: 7800, friction: 0.4, restitution: 0.1}},
  bodies: [
    {id: 'hammer', position: [0, 2, 0], rotationEuler: [0, 0, 20], material: 'steel', shape: {kind: 'compound', shapes: [
      {shape: {kind: 'capsule', radius: 0.02, halfLength: 0.25}, density: 600, friction: 0.9},                          // a wooden handle along y
      {shape: {kind: 'box', halfExtents: [0.08, 0.04, 0.04]}, position: [0, 0.29, 0]},                                    // the steel head, from the material
      {shape: {kind: 'hull', points: [0.08, -0.04, -0.04, 0.08, 0.04, -0.04, 0.08, -0.04, 0.04, 0.08, 0.04, 0.04, 0.14, 0, 0]}, position: [0, 0.29, 0], rotationEuler: [0, 180, 0]},   // a claw on the other side
    ]}},
    {id: 'flywheel', position: [2, 1, 0], shape: {kind: 'sphere', radius: 0.2}, massData: {mass: 12, inertia: [0.9, 0.9, 1.6, 0, 0, 0]}, angularVelocity: [0, 0, 6]},
    {id: 'crate', position: [-2, 0.5, 0], shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, massData: {mass: 30, center: [0, -0.3, 0], inertia: [4, 5, 4, 0.2, 0, -0.1]}},
  ],
  joints: [{id: 'axle', type: 'revolute', bodyA: null, bodyB: 'flywheel', frameA: {position: [2, 1, 0]}}],
});

test('scene format version 2: compound shapes and massData validate, canonicalise, travel in share links and load the same everywhere', async t => {
  assert.deepEqual([SCENE_VERSION, [...SCENE_VERSIONS], SCENE_LIMITS.compoundShapes], [2, [1, 2], 64]);
  const scene = compoundScene();
  assert.deepEqual(validateScene(scene), []);
  const normal = normalizeScene(scene), text = canonicalize(scene);
  assert.equal(normal.version, 2);
  assert.equal(canonicalize(normal), text, 'canonicalising twice changes nothing');
  assert.equal(canonicalize(JSON.parse(text)), text);
  // rotationEuler on a child becomes a quaternion, a child's own values are kept, and nothing else is added.
  const hammer = normal.bodies[0].shape.shapes;
  assert.deepEqual(Object.keys(hammer[0]).sort(), ['density', 'friction', 'shape']);
  assert.deepEqual(Object.keys(hammer[2]).sort(), ['position', 'rotation', 'shape']);
  hammer[2].rotation.forEach((v, i) => near(v, [0, 1, 0, 0][i], 1e-12, 'half a turn about y'));
  assert.deepEqual(normal.bodies[1].massData, {mass: 12, inertia: [0.9, 0.9, 1.6, 0, 0, 0]}, 'a centre at the origin is the default and is left out');
  assert.deepEqual(normal.bodies[2].massData, {mass: 30, center: [0, -0.3, 0], inertia: [4, 5, 4, 0.2, 0, -0.1]});

  // Versions. A scene without version 2 features is version 1 whatever it declares, with the text and hash it always had.
  for (const [name, make] of Object.entries(EXAMPLE_SCENES)) {
    const one = make(), declared2 = {...one, version: 2};
    assert.equal(normalizeScene(one).version, 1, `${name} is a version 1 scene`);
    assert.equal(sceneHash(declared2), sceneHash(one), `${name}: declaring version 2 without using it changes nothing`);
  }
  // The five example scenes hash as they did before version 2 existed (values from the commit before this change).
  assert.deepEqual(Object.fromEntries(Object.entries(EXAMPLE_SCENES).map(([name, make]) => [name, sceneHash(make()).slice(0, 16)])), EXAMPLE_HASHES_BEFORE);
  const problems = (change, version = 2) => { const s = compoundScene(); s.version = version; change(s); return validateScene(s).map(p => `${p.path}: ${p.message}`); };
  assert.deepEqual(problems(() => {}, 1), [
    "/bodies/0/shape/kind: a 'compound' shape needs scene version 2; this scene declares version 1",
    '/bodies/1/massData: massData needs scene version 2; this scene declares version 1',
    '/bodies/2/massData: massData needs scene version 2; this scene declares version 1',
  ]);
  assert.deepEqual(problems(s => { s.version = 3; }), ['/version: unsupported scene version 3; this build reads versions 1 and 2']);
  // Every rule of the two additions, by path.
  assert.deepEqual(problems(s => { s.bodies[0].shape.shapes = []; }), ['/bodies/0/shape/shapes: a compound holds 1 to 64 shapes, got 0']);
  assert.deepEqual(problems(s => { s.bodies[0].shape.shapes = Array.from({length: 65}, () => ({shape: {kind: 'sphere', radius: 0.1}})); }), ['/bodies/0/shape/shapes: a compound holds 1 to 64 shapes, got 65']);
  assert.deepEqual(problems(s => { s.bodies[0].shape.shapes[1].shape = {kind: 'compound', shapes: []}; }), ["/bodies/0/shape/shapes/1/shape/kind: a shape of a compound must be 'box', 'sphere', 'capsule' or 'hull', got \"compound\""]);
  assert.deepEqual(problems(s => { s.bodies[0].shape.shapes[1].shape = {kind: 'mesh', vertices: [], indices: []}; }), ["/bodies/0/shape/shapes/1/shape/kind: a shape of a compound must be 'box', 'sphere', 'capsule' or 'hull', got \"mesh\""]);
  assert.deepEqual(problems(s => { delete s.bodies[0].shape.shapes[0].shape; s.bodies[0].shape.shapes[1].color = 5; }), ['/bodies/0/shape/shapes/0/shape: is required', '/bodies/0/shape/shapes/1/color: unknown key "color"']);
  assert.deepEqual(problems(s => { s.bodies[0].shape.shapes[1].position = [0, 0]; s.bodies[0].shape.shapes[0].density = -1; s.bodies[0].shape.shapes[2].rotation = [0, 0, 0, 1]; }),
    ['/bodies/0/shape/shapes/0/density: must be >= 0, got -1', '/bodies/0/shape/shapes/1/position: must hold exactly 3 numbers, got 2', '/bodies/0/shape/shapes/2/rotationEuler: give rotation or rotationEuler, not both']);
  assert.deepEqual(problems(s => { s.bodies[0].shape.shapes[0].shape.radius = 0; }), ['/bodies/0/shape/shapes/0/shape/radius: must be >= 0.0001, got 0']);
  assert.deepEqual(problems(s => { s.bodies[1].massData = {mass: 0, inertia: [1, 1, 1, 0, 0, 0]}; }), ['/bodies/1/massData/mass: must be > 0, got 0']);
  assert.deepEqual(problems(s => { s.bodies[1].massData = {mass: 1}; }), ['/bodies/1/massData/inertia: is required']);
  assert.deepEqual(problems(s => { s.bodies[1].massData = {mass: 1, inertia: [1, 1, 1, 0, 0]}; }), ['/bodies/1/massData/inertia: must hold exactly 6 numbers, got 5']);
  assert.deepEqual(problems(s => { s.bodies[1].massData = {mass: 1, inertia: [1, 1, 1, 0, 2, 0], centre: [0, 0, 0]}; }),
    ['/bodies/1/massData/centre: unknown key "centre"', '/bodies/1/massData/inertia: must be a positive-definite tensor [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] that float32 can invert']);
  assert.deepEqual(problems(s => { s.bodies.push({id: 'floor', position: [0, 0, 0], shape: {kind: 'mesh', vertices: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 2, 1]}, massData: {mass: 1, inertia: [1, 1, 1, 0, 0, 0]}}); }),
    ['/bodies/3/massData: a mesh body is always static and takes no massData']);

  // In a coupled scene, the structure and water couplings take a body's position as its centre of mass.
  const coupled = change => { const s = compoundScene(); s.bodies.push({id: 'plain', position: [5, 1, 0], shape: {kind: 'sphere', radius: 0.2}, massData: {mass: 3, inertia: [1, 1, 1, 0, 0, 0]}}); change(s); return validateScene(s).map(p => `${p.path}: ${p.message}`); };
  const cable = (body, extra = {}) => ({id: 'line', nodes: [0, 6, 0, 0, 5, 0], masses: [1, 1], pinned: [1, 0], segments: [{a: 0, b: 1, restLength: 1, compliance: 1e-6}], attachments: [{node: 1, body, ...extra}]});
  assert.deepEqual(coupled(s => { s.cables = [cable('hammer', {inertia: {kind: 'principal', moments: [1, 1, 1]}})]; }), ["/cables/0/attachments/0/body: a compound body cannot be attached: the structure coupling takes a body's position as its centre of mass"]);
  assert.deepEqual(coupled(s => { s.cables = [cable('crate')]; }), ["/cables/0/attachments/0/body: a body whose massData has a centre off its origin cannot be attached: the structure coupling takes a body's position as its centre of mass"]);
  assert.deepEqual(coupled(s => { s.cables = [cable('plain')]; }), ['/cables/0/attachments/0/inertia: is required: the body has massData, so its inertia cannot be taken from its shape']);
  assert.deepEqual(coupled(s => { s.cables = [cable('plain', {inertia: {kind: 'principal', moments: [1, 1, 1]}})]; }), []);
  const basin = bodies => ({id: 'pool', cols: 8, rows: 8, dx: 1, dz: 1, restDepth: 1, origin: [-4, 0, -4], bodies});
  assert.deepEqual(coupled(s => { s.water = [basin([{body: 'hammer'}, {body: 'crate'}, {body: 'plain'}])]; }), [
    '/water/0/bodies/0/body: a compound body cannot float: the water couples boxes, spheres and capsules only',
    "/water/0/bodies/1/body: a body whose massData has a centre off its origin cannot float: the water coupling takes a body's position as its centre of mass",
  ]);

  // Share links, compressed and stored.
  const link = await encodeSceneLink(scene), stored = encodeSceneLinkSync(scene);
  assert.equal(canonicalize(decodeSceneLink(link)), text);
  assert.equal(canonicalize(decodeSceneLink(`https://example.org/lab.html?scene=${stored}`)), text);

  // Loading: the kit's loader, the same scene from its link, the Lab's loader on a bare native world, and the same
  // bodies made by hand with createBody all give the same hashes at ticks 0, 1, 60 and 240.
  const ticks = [0, 1, 60, 240], runs = [];
  const sample = (world, step) => { const hashes = []; let tick = 0; for (const until of ticks) { while (tick < until) { step(); tick++; } hashes.push(world.exactHash()); } return hashes; };
  let saved, resumed, massAfter;
  for (const source of [scene, decodeSceneLink(link)]) {
    const world = await createWorld(sceneWorldOptions(normal));
    try {
      const loaded = loadScene(world, source);
      assert.deepEqual(world.bodyKinds().slice(1), ['compound', 'sphere', 'box']);
      saved ??= canonicalize(saveScene(world, loaded, {state: false}));
      const data = world.getMassData(loaded.bodies.get('crate'));
      assert.deepEqual([data.explicit, data.mass, data.center.map(v => +v.toFixed(6))], [true, 30, [0, -0.3, 0]]);
      runs.push(sample(world, () => world.step()));
      resumed ??= saveScene(world, loaded);
      massAfter ??= world.getMassData(loaded.bodies.get('hammer'));
    } finally { world.dispose(); }
  }
  assert.equal(saved, text, 'the description the builder holds is the scene');
  assert.equal(resumed.version, 2);
  assert.deepEqual([resumed.bodies[0].shape, resumed.bodies[2].massData], [normal.bodies[0].shape, normal.bodies[2].massData], 'a save after 240 steps carries the shapes and the mass data it was built with');
  {
    const wasm = name => fileURLToPath(new URL(`../wasm/${name}`, import.meta.url));
    const {default: factory} = await import(wasm('box3d.js'));
    const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(wasm('box3d.wasm'))})), native = pool.createWorld();
    try {
      native.retainBodyShapes(true);
      const loaded = loadLabScene(native, scene), host = loaded.builder.world;
      runs.push(sample(host, () => host.step()));
      // The Lab draws a compound from the shapes the world kept: the validated children, at their local poses.
      const row = native.bodyIndex(loaded.bodies.get('hammer')), kept = native.bodyShape(row);
      assert.deepEqual([native.shapeKinds()[row], kept.kind, kept.shapes.length, kept.shapes[1].position], [6, 'compound', 3, [0, 0.29, 0]]);
      assert.equal(canonicalize(loaded.builder.toJSON({state: false})), text);
    } finally { native.destroy(); pool.destroy(); }
  }
  {
    const world = await createWorld(sceneWorldOptions(normal));
    try {
      world.reset({});
      const steel = scene.materials.steel, q = normal.bodies[0].rotation;
      world.createBody({position: [0, 2, 0], rotation: q, ...steel, shape: {kind: 'compound', shapes: normal.bodies[0].shape.shapes}});
      const wheel = world.createBody({position: [2, 1, 0], shape: {kind: 'sphere', radius: 0.2}, angularVelocity: [0, 0, 6]});
      world.setMassData(wheel, {mass: 12, inertia: [0.9, 0.9, 1.6, 0, 0, 0]});
      world.createBody({position: [-2, 0.5, 0], shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, massData: {mass: 30, center: {x: 0, y: -0.3, z: 0}, inertia: [4, 5, 4, 0.2, 0, -0.1]}});
      world.createJoint({type: 'revolute', bodyA: null, bodyB: wheel, frameA: {position: [2, 1, 0]}});
      runs.push(sample(world, () => world.step()));
    } finally { world.dispose(); }
  }
  assert.deepEqual(runs[1], runs[0], 'from the share link');
  assert.deepEqual(runs[2], runs[0], 'through the Lab\'s loader');
  assert.deepEqual(runs[3], runs[0], 'and built by hand: massData at creation is setMassData right after it');
  assert.notEqual(runs[0][0], runs[0][3], 'the scene moved');
  // The hammer's mass is its three shapes at their own densities: handle 600, head and claw 7800 from the material.
  const handle = 600 * (Math.PI * 0.02 ** 2 * 0.5 + 4 / 3 * Math.PI * 0.02 ** 3), head = 7800 * 0.16 * 0.08 * 0.08, claw = 7800 * (0.08 * 0.08 * 0.06 / 3);
  within(massAfter.mass, handle + head + claw, 1e-5, 'hammer mass');
  t.diagnostic(`scene: ${text.length} characters of canonical JSON, ${link.length} as a compressed link; hammer ${massAfter.mass} kg against ${handle + head + claw} by hand`);

  // The builder takes the same descriptions one at a time, in either notation, and writes version 2 only when needed.
  const world = await si();
  try {
    const builder = new SceneBuilder(world);
    assert.equal(builder.toJSON().version, 1);
    builder.addBody('bar', {shape: dumbbell(0.1, 0.4), position: {x: 0, y: 1, z: 0}});
    assert.equal(builder.toJSON().version, 2);
    builder.remove('bar');
    builder.addBody('ball', {shape: {kind: 'sphere', radius: 0.1}, position: [0, 1, 0], massData: {mass: 3, center: {x: 0, y: 0.1, z: 0}, inertia: new Float32Array([1, 1, 1, 0, 0, 0])}});
    assert.deepEqual(builder.toJSON().bodies[0].massData, {mass: 3, center: [0, 0.1, 0], inertia: [1, 1, 1, 0, 0, 0]});
    assert.throws(() => builder.addBody('bad', {shape: {kind: 'compound', shapes: [{shape: {kind: 'heightfield'}}]}, position: [0, 0, 0]}), /a shape of a compound must be/);
  } finally { world.dispose(); }
});

test('a save of a spinning body whose centre of mass is off its origin resumes with the same motion', async t => {
  // A scene states the velocity of the body ORIGIN; the solver holds that of the centre of mass. For an L spinning in
  // free flight the two differ by w x r, about 1.7 m/s here, so a save that wrote the solver's number would resume wrongly.
  const scene = {format: 'box3d-scene', version: 2, world: {gravity: [0, 0, 0], ground: false, step: 1 / 240, subSteps: 4}, bodies: [
    {id: 'ell', shape: lShape(), position: [0, 5, 0], linearVelocity: [1, 0, 0], angularVelocity: [0.5, 0, 2], neverSleeps: true},
    {id: 'offset', shape: {kind: 'sphere', radius: 0.2}, position: [6, 5, 0], linearVelocity: [0, 0.5, 0], angularVelocity: [0, 3, 0], massData: {mass: 2, center: [0.4, 0, 0], inertia: [1, 1, 1, 0, 0, 0]}, neverSleeps: true},
  ]};
  const first = await createWorld(sceneWorldOptions(scene)), second = await createWorld(sceneWorldOptions(scene));
  try {
    const loaded = loadScene(first, scene), ell = loaded.bodies.get('ell'), want = lShapeMass();
    // At creation the origin has the stated velocity, so the centre of mass has v + w x c.
    const vcom = first.getState(ell).linearVelocity, expected = [1 - 2 * want.center[1], 2 * want.center[0], 0.5 * want.center[1]];
    vcom.forEach((v, i) => near(v, expected[i], 2e-6, `centre-of-mass velocity ${i} at creation`));
    // Saved before the first step, the origin's velocity comes back to float32 rounding.
    const untouched = saveScene(first, loaded);
    untouched.bodies[0].linearVelocity.forEach((v, i) => near(v, [1, 0, 0][i], 1e-6, `saved origin velocity ${i}`));
    untouched.bodies[1].linearVelocity.forEach((v, i) => near(v, [0, 0.5, 0][i], 1e-6, `saved origin velocity of the offset sphere ${i}`));
    for (let i = 0; i < 100; i++) first.step();
    const saved = saveScene(first, loaded), resumed = loadScene(second, saved);
    let worst = 0, speed = 0;
    for (const id of ['ell', 'offset']) {
      const a = first.getState(loaded.bodies.get(id)), b = second.getState(resumed.bodies.get(id));
      speed = Math.max(speed, Math.hypot(...a.linearVelocity.map((v, i) => v - b.linearVelocity[i])));
      a.angularVelocity.forEach((v, i) => near(b.angularVelocity[i], v, 1e-6, `${id} angular velocity ${i} at load`));
    }
    assert.ok(speed < 5e-6, `centre-of-mass velocities at the moment of loading differ by ${speed} m/s`);
    for (let i = 0; i < 240; i++) { first.step(); second.step(); }
    for (const id of ['ell', 'offset']) {
      const a = first.getState(loaded.bodies.get(id)), b = second.getState(resumed.bodies.get(id));
      worst = Math.max(worst, Math.hypot(...a.position.map((v, i) => v - b.position[i])));
    }
    assert.ok(worst < 1e-4, `after one more second the two runs are ${worst} m apart`);
    // Written as the solver's own number, the L's velocity would have been off by |w x c|.
    assert.ok(Math.hypot(...vcom.map((v, i) => v - [1, 0, 0][i])) > 1.5, 'the two velocities really differ here');
    t.diagnostic(`resume: velocity difference at load ${speed.toExponential(2)} m/s, position difference after 1 s ${worst.toExponential(2)} m (w x c is ${Math.hypot(...vcom.map((v, i) => v - [1, 0, 0][i])).toFixed(3)} m/s)`);
  } finally { first.dispose(); second.dispose(); }
});

// sceneHash of the five example scenes at the commit before scene version 2, first 16 hex digits.
const EXAMPLE_HASHES_BEFORE = {
  'pendulum-wave': 'b81e98b7c9cf8c76', 'newtons-cradle': '0a586664671aee33', 'domino-run': 'cdf465057fdd04c5', 'terrain-car': 'c52c45ee8645661d', ragdoll: '4d2ed3154b143c11',
};

test("robot import: a link with several shapes is one compound body, and the file's inertial is what the solver holds", async t => {
  const arm = parseURDF(sixDofArmURDF()), scene = robotToScene(arm), report = robotReport(arm), link = name => report.links.find(one => one.link === name);
  assert.deepEqual(validateScene(scene), []);
  assert.equal(scene.version, 2);
  // One body per link. The tool's two boxes are one compound, so no weld and no collision group are needed.
  assert.deepEqual(scene.bodies.map(body => [body.id, body.shape.kind]), [['base', 'hull'], ['turret', 'hull'], ['upper_arm', 'box'], ['forearm', 'box'], ['wrist', 'hull'], ['hand', 'sphere'], ['tool', 'compound']]);
  assert.deepEqual(scene.joints.map(joint => joint.id), ['base.base', 'yaw', 'shoulder', 'elbow', 'forearm_roll', 'wrist_pitch', 'tool_roll']);
  assert.ok(scene.bodies.every(body => body.filter === undefined), 'no filters: joined bodies do not collide anyway');
  const tool = scene.bodies.at(-1);
  assert.deepEqual(tool.shape.shapes.map(child => [child.shape.kind, child.position ?? null]), [['box', null], ['box', [0.04, 0, 0.05]]], 'in the link\'s own axes (z up): the body\'s rotation carries the change to y up');
  assert.deepEqual([tool.userData, link('tool').bodies, tool.density], [{link: 'tool'}, ['tool'], undefined]);
  // Every link of this arm states an inertia its shapes do not have (the base apart, whose prism is 0.0026% off), so every one is set.
  assert.deepEqual(report.links.map(one => [one.link, one.inertiaSource]), [['base', 'file'], ['turret', 'file'], ['upper_arm', 'file'], ['forearm', 'file'], ['wrist', 'file'], ['hand', 'file'], ['tool', 'file']]);
  assert.deepEqual([report.maxPrincipalError, report.worstLink], [0, null]);
  assert.ok(!report.warnings.some(w => /inertia/.test(w.message)), 'no inertia warning is left');
  near(link('tool').shapesPrincipalError, 0.424, 1e-3, 'what the shapes alone would have been: 42.4%');
  near(link('tool').shapesComOffset, 0.0044, 1e-4, 'and 4.4 mm of centre-of-mass offset');
  near(link('forearm').shapesPrincipalError, 1 - 1 / 1.1, 1e-9, 'forearm: the file says 1.1 x the box');

  // In the solver: mass, centre of mass and principal moments of every link are the file's, to float32.
  const world = await si();
  try {
    const spawned = spawnRobot(world, arm);
    let worst = 0;
    for (const one of arm.links) {
      const handle = spawned.links.get(one.name), data = world.getMassData(handle.body), file = one.inertial;
      assert.equal(data.explicit, true, one.name);
      within(data.mass, file.mass, 1e-7, `${one.name} mass`);
      const wanted = principal([file.inertia[0], file.inertia[3], file.inertia[5], file.inertia[1], file.inertia[2], file.inertia[4]]), got = principal(data.inertia);
      got.forEach((v, i) => { worst = Math.max(worst, Math.abs(v / wanted[i] - 1)); within(v, wanted[i], 2e-6, `${one.name} principal moment ${i}`); });
      // The centre of mass, taken from the body frame to the link frame, is the file's <inertial><origin>.
      const inLink = rotate([-handle.frame.rotation[0], -handle.frame.rotation[1], -handle.frame.rotation[2], handle.frame.rotation[3]], data.center.map((v, i) => v - handle.frame.position[i]));
      inLink.forEach((v, i) => near(v, file.origin.xyz[i], 1e-7, `${one.name} centre of mass ${i}`));
    }
    assert.equal(world.getMassData(spawned.links.get('tool').body).shapeCount, 2);
    t.diagnostic(`six-joint arm: largest principal-moment error in the solver ${worst.toExponential(2)} (was 42.4% on the tool from shapes alone)`);
  } finally { world.dispose(); }

  // Without the file's inertia, a compound link has exactly what its welded bodies had together.
  const shapes = robotReport(arm, {inertia: 'shapes'}), welded = robotReport(arm, {inertia: 'shapes', links: 'welded'});
  assert.deepEqual([shapes.links.at(-1).bodies, welded.links.at(-1).bodies], [['tool'], ['tool', 'tool.2']]);
  assert.deepEqual(shapes.links.at(-1).principalActual, welded.links.at(-1).principalActual);
  assert.equal(shapes.links.at(-1).inertiaSource, 'shapes');
  assert.match(shapes.warnings.at(-1).message, /the bodies' inertia differs from the file's by up to 42\.\d% of a principal moment \(link "tool"\)/);
  const check = await si();
  try {
    const spawned = spawnRobot(check, arm, {inertia: 'shapes'}), data = check.getMassData(spawned.links.get('tool').body);
    assert.equal(data.explicit, false);
    principal(data.inertia).forEach((v, i) => within(v, shapes.links.at(-1).principalActual[i], 2e-6, `the solver's compound tool, principal moment ${i}, against the report's sum by hand`));
  } finally { check.dispose(); }

  // A link whose shapes already have the file's inertial gets no massData: the scene is the version 1 scene it always was.
  const pendulum = robotToScene(parseURDF(doublePendulumURDF()));
  assert.deepEqual([pendulum.version, pendulum.bodies.map(body => body.massData)], [1, [undefined, undefined]]);
  assert.deepEqual(robotReport(parseURDF(doublePendulumURDF())).links.map(one => one.inertiaSource), [undefined, 'shapes', 'shapes']);
  // Every example robot still validates, and its canonical scene loads to the hash spawnRobot gives.
  for (const [name, example] of Object.entries(EXAMPLE_ROBOTS)) {
    const robot = example.format === 'urdf' ? parseURDF(example.text()) : parseMJCF(example.text());
    assert.deepEqual(validateScene(robotToScene(robot)), [], name);
  }
  // A tensor no solid box has (a principal moment above the sum of the other two) is still a valid tensor: it is applied.
  const odd = parseURDF('<robot name="odd"><link name="a"><inertial><mass value="1"/><inertia ixx="0.01" iyy="0.01" izz="0.05"/></inertial></link></robot>');
  assert.deepEqual(robotReport(odd).warnings.map(w => [w.code, w.element]), [['note', 'link "a"']]);
  assert.deepEqual(robotToScene(odd).bodies[0].massData, {mass: 1, center: [0, 0, 0], inertia: [0.01, 0.01, 0.05, 0, 0, 0]});
  // A tensor that is not positive definite cannot be held: the shapes' inertia is used and the report says so.
  const flat = parseURDF('<robot name="flat"><link name="a"><inertial><mass value="1"/><inertia ixx="0.01" iyy="0.01" izz="-0.01"/></inertial><collision><geometry><box size="0.2 0.2 0.2"/></geometry></collision></link></robot>');
  assert.equal(robotToScene(flat).bodies[0].massData, undefined);
  assert.match(robotReport(flat).warnings[0].message, /its inertia tensor is not positive definite/);
  assert.throws(() => robotToScene(arm, {links: 'glued'}), /links must be 'compound' or 'welded'/);
  assert.throws(() => robotToScene(arm, {inertia: 'cad'}), /inertia must be 'file' or 'shapes'/);
});

test("robot import: a hinged rod whose file states 1.3 x its shape's inertia swings with the file's period", async t => {
  // The rod of v15-robot.test.mjs: 2 kg, 0.8 m, hinged at its end; the file claims 1.3 x the rod's transverse inertia.
  const m = 2, L = 0.8, w = 0.06, k = 1.3, own = m * (w * w + L * L) / 12, theta0 = 0.1;
  const urdf = `<robot name="rod"><link name="world"/>
    <joint name="hinge" type="continuous"><parent link="world"/><child link="rod"/><origin xyz="0 0 2"/><axis xyz="0 1 0"/></joint>
    <link name="rod"><inertial><origin xyz="0 0 ${-L / 2}"/><mass value="${m}"/><inertia ixx="${k * own}" ixy="0" ixz="0" iyy="${k * own}" iyz="0" izz="${m * w * w / 6}"/></inertial>
      <collision><origin xyz="0 0 ${-L / 2}"/><geometry><box size="${w} ${w} ${L}"/></geometry></collision></link></robot>`;
  const period = I => 2 * Math.PI * Math.sqrt((I + m * L * L / 4) / (m * G * L / 2)) * (1 + theta0 * theta0 / 16);
  const swing = async options => {
    const world = await si({ground: false});
    try {
      const robot = spawnRobot(world, parseURDF(urdf), {positions: {hinge: theta0}, ...options}), samples = [];
      for (let i = 0; i < HZ * 20; i++) { world.step(); samples.push(world.getJointState(robot.joints.get('hinge')).value); }
      return {period: periodOf(samples), amplitude: Math.max(...samples.slice(-HZ * 3).map(Math.abs)), report: robot.report.links.find(link => link.link === 'rod'), mass: world.getMassData(robot.links.get('rod').body)};
    } finally { world.dispose(); }
  };
  const file = await swing({}), shapes = await swing({inertia: 'shapes'});
  within(file.period, period(k * own), 1e-4, 'period with the file\'s inertia');
  within(shapes.period, period(own), 1e-4, 'period with the shape\'s inertia');
  near(file.period / shapes.period - 1, 0.03697, 1e-4, 'the two differ by the 3.70% the inertia gap predicts');
  assert.deepEqual([file.report.inertiaSource, file.report.maxPrincipalError, shapes.report.inertiaSource], ['file', 0, 'shapes']);
  near(file.report.shapesPrincipalError, 1 - 1 / k, 1e-9, 'the report keeps what the shape alone would have been');
  assert.deepEqual([file.mass.explicit, shapes.mass.explicit], [true, false]);
  within(file.amplitude, theta0, 0.01, 'amplitude after 17 s');
  t.diagnostic(`rod: period ${file.period} s with the file's inertia (closed form ${period(k * own)}, ${rel(file.period, period(k * own)).toExponential(2)}); ${shapes.period} s from the shape (${period(own)})`);
});

test('robot import: a compound link moves as one rigid body where welded bodies flex', async t => {
  // A T-shaped link of two boxes on a hinge, dropped from horizontal and caught by its joint limit. Welded, the two
  // boxes are held together by a constraint that gives a little at the stop; as a compound they cannot move at all.
  const urdf = `<robot name="tee"><link name="world"/>
    <joint name="hinge" type="revolute"><parent link="world"/><child link="tee"/><origin xyz="0 0 2"/><axis xyz="0 1 0"/><limit lower="-0.2" upper="1.2"/></joint>
    <link name="tee"><inertial><origin xyz="0.375 0 0"/><mass value="4"/><inertia ixx="0.08" ixy="0" ixz="0" iyy="0.2" iyz="0" izz="0.26"/></inertial>
      <collision><origin xyz="0.25 0 0"/><geometry><box size="0.5 0.06 0.06"/></geometry></collision>
      <collision><origin xyz="0.5 0 0"/><geometry><box size="0.06 0.5 0.06"/></geometry></collision></link></robot>`;
  const drop = async options => {
    const world = await si({ground: false});
    try {
      const robot = spawnRobot(world, parseURDF(urdf), options), bodies = [...robot.bodies.values()];
      let flex = 0;
      const rest = bodies.length > 1 ? Math.hypot(...world.getState(bodies[0]).position.map((v, i) => v - world.getState(bodies[1]).position[i])) : 0;
      for (let i = 0; i < HZ * 3; i++) {
        world.step();
        if (bodies.length > 1) flex = Math.max(flex, Math.abs(Math.hypot(...world.getState(bodies[0]).position.map((v, k) => v - world.getState(bodies[1]).position[k])) - rest));
      }
      return {bodies: bodies.length, joints: robot.allJoints.size, flex, angle: world.getJointState(robot.joints.get('hinge')).value};
    } finally { world.dispose(); }
  };
  const compound = await drop({}), welded = await drop({links: 'welded'});
  assert.deepEqual([compound.bodies, compound.joints, welded.bodies, welded.joints], [1, 1, 2, 2]);
  near(compound.angle, 1.2, 0.01, 'the compound link rests on its limit');
  near(welded.angle, 1.2, 0.01, 'so does the welded one');
  assert.ok(welded.flex > 1e-5, `the welded pair moved against each other by ${welded.flex} m`);
  t.diagnostic(`T link caught by its limit: welded boxes moved ${(welded.flex * 1000).toFixed(3)} mm against each other; the compound is one body (${compound.bodies} body, ${compound.joints} joint against ${welded.bodies} and ${welded.joints})`);
});
