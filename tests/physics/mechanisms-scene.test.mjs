import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {buildMechanismsScene, MECHANISMS_DEFAULT_SEED} from '../../src/engine/mechanisms-scene.ts';
import {planInstanceShapes} from '../../src/webgpu/instance-shapes.ts';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const binary = await readFile(resolve(artifact, 'box3d.wasm'));
const pool = new NativeWorldPool(await factory({wasmBinary: binary}));
const HZ = 60, SUBSTEPS = 4;

const matrices = world => world.HEAPF32.slice(Number(world._b3w_matrices_ptr()) / 4, Number(world._b3w_matrices_ptr()) / 4 + world.bodyCount() * 16);
const run = (world, seconds, each) => { for (let i = 0; i < Math.round(seconds * HZ); i++) { world.step(1 / HZ, SUBSTEPS); each?.(i); } };
function rotate(q, v) {
  const [x, y, z, w] = q, tx = 2 * (y * v[2] - z * v[1]), ty = 2 * (z * v[0] - x * v[2]), tz = 2 * (x * v[1] - y * v[0]);
  return [v[0] + w * tx + y * tz - z * ty, v[1] + w * ty + z * tx - x * tz, v[2] + w * tz + x * ty - y * tx];
}
const axisOf = (world, body) => rotate(world.bodyState(body).rotation, [0, 1, 0]);
const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2])));

test('the scene is built from the general API with the bodies and joints it documents', () => {
  const world = pool.createWorld();
  try {
    const scene = buildMechanismsScene(world);
    assert.equal(scene.seed, MECHANISMS_DEFAULT_SEED);
    assert.equal(world.bodyCount(), scene.bodyCount);
    const kinds = world.bodyKinds(), count = kind => kinds.filter(k => k === kind).length;
    // 7 bobs, 4 wheels, 4 loose spheres and the paddle hub; 7 rods, 12 chain links and 4 loose capsules.
    assert.equal(count('sphere'), 16);
    assert.equal(count('capsule'), 23);
    assert.equal(count('box'), scene.bodyCount - 39);
    assert.equal(kinds[0], 'box', 'row 0 is the ground slab');
    // 7 revolute + 7 weld (pendulums), 12 spherical (chains), 1 revolute (paddle), 4 wheel + 1 weld (car).
    assert.equal(scene.jointCount, 32);
    assert.equal(scene.pendulums.length, 7);
    assert.deepEqual(scene.chains.map(chain => chain.links.length), [6, 6]);
    assert.equal(scene.car.wheels.length, 4);
    assert.deepEqual(world.gravity().map(v => Math.round(v * 100) / 100), [0, -9.81, 0], 'SI gravity');
    for (const joint of [scene.pendulums[0].hinge, scene.chains[0].joints[0], scene.mixer.hinge, scene.car.joints[0]]) assert.ok(world.jointAlive(joint));
    assert.deepEqual([scene.pendulums[0].hinge, scene.chains[1].joints[3], scene.mixer.hinge, scene.car.joints[2]].map(joint => world.jointState(joint).type),
      ['revolute', 'spherical', 'revolute', 'wheel']);
    assert.throws(() => buildMechanismsScene(world, -1), RangeError);
    assert.throws(() => buildMechanismsScene(world, 1.5), RangeError);
  } finally { world.destroy(); }
});

test('shape kinds reach the renderer as a versioned byte stream', () => {
  const world = pool.createWorld();
  try {
    world.createScene({id: 0}, 1, 77);
    assert.equal(world.shapeKinds(), null, 'a recipe scene has only boxes and reports no kinds');
    assert.equal(planInstanceShapes(world.shapeKinds(), world.bodyCount()), null);
    const recipeVersion = world.shapeVersion();
    buildMechanismsScene(world, 9);
    assert.notEqual(world.shapeVersion(), recipeVersion, 'replacing the scene changes the shape version');
    const rows = world.shapeKinds();
    assert.ok(rows instanceof Uint8Array && rows.length === world.bodyCount());
    assert.deepEqual(Array.from(rows, kind => ['box', 'sphere', 'capsule'][kind]), world.bodyKinds());
    assert.equal(world.shapeKinds(), rows, 'unchanged kinds are not read from the bridge again');
    const version = world.shapeVersion();
    world.step(1 / HZ, SUBSTEPS);
    assert.equal(world.shapeVersion(), version, 'stepping does not change the shape version');
    assert.equal(world.shapeKinds(), rows);
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [0, 9, -9]});
    assert.notEqual(world.shapeVersion(), version, 'creating a body changes the shape version');
    assert.equal(world.shapeKinds().at(-1), 1);
    const plan = planInstanceShapes(world.shapeKinds(), world.bodyCount());
    assert.deepEqual([plan.sphereCount, plan.capsuleCount], [17, 23]);
    const afterCreate = world.shapeVersion();
    world.destroyBody(ball);
    assert.notEqual(world.shapeVersion(), afterCreate, 'destroying a body changes the shape version');
    assert.equal(world.shapeKinds().length, world.bodyCount());
    // Sphere rows are scaled (r, r, r) and capsule rows (radius, halfLength, radius).
    const m = matrices(world), kinds = world.shapeKinds(), scale = (row, column) => Math.hypot(m[row * 16 + column * 4], m[row * 16 + column * 4 + 1], m[row * 16 + column * 4 + 2]);
    for (let row = 0; row < kinds.length; row++) {
      if (kinds[row] === 1) assert.ok(Math.abs(scale(row, 0) - scale(row, 1)) < 1e-5 && Math.abs(scale(row, 0) - scale(row, 2)) < 1e-5);
      if (kinds[row] === 2) assert.ok(Math.abs(scale(row, 0) - scale(row, 2)) < 1e-5);
    }
    world.createScene({id: 0}, 1, 77);
    assert.equal(world.shapeKinds(), null, 'returning to a recipe clears the kinds');
  } finally { world.destroy(); }
});

test('the same seed gives the same scene and trajectory; another seed gives another', () => {
  const a = pool.createWorld(), b = pool.createWorld(), c = pool.createWorld();
  try {
    buildMechanismsScene(a, 1234); buildMechanismsScene(b, 1234); buildMechanismsScene(c, 1235);
    assert.deepEqual(matrices(a), matrices(b));
    assert.notDeepEqual(matrices(a), matrices(c));
    for (let tick = 0; tick < 4 * HZ; tick++) {
      a.step(1 / HZ, SUBSTEPS); b.step(1 / HZ, SUBSTEPS); c.step(1 / HZ, SUBSTEPS);
      if (tick % 60 === 59) { assert.deepEqual(matrices(a), matrices(b), `tick ${tick}`); assert.equal(a.replayHash(), b.replayHash()); }
    }
    assert.notEqual(a.replayHash(), c.replayHash());
    // Rebuilding in a used world gives the fresh result again.
    buildMechanismsScene(b, 1234); const fresh = pool.createWorld();
    try {
      buildMechanismsScene(fresh, 1234);
      run(b, 1); run(fresh, 1);
      assert.deepEqual(matrices(b), matrices(fresh));
    } finally { fresh.destroy(); }
  } finally { a.destroy(); b.destroy(); c.destroy(); }
});

test('the mechanisms do what they are for', () => {
  const world = pool.createWorld();
  try {
    const scene = buildMechanismsScene(world);
    const bobAngle = pendulum => { const p = world.bodyState(pendulum.bob).position; return Math.atan2(p[2] - pendulum.pivot[2], pendulum.pivot[1] - p[1]); };
    const release = scene.pendulums.map(bobAngle), swing = scene.pendulums.map(() => ({min: Infinity, max: -Infinity}));
    const maxBend = scene.chains.map(() => 0);
    let paddleTurn = 0, paddleAngle = world.jointState(scene.mixer.hinge).value;
    run(world, 12, tick => {
      scene.pendulums.forEach((pendulum, i) => {
        const p = world.bodyState(pendulum.bob).position, reach = Math.hypot(p[0] - pendulum.pivot[0], p[1] - pendulum.pivot[1], p[2] - pendulum.pivot[2]);
        assert.ok(Math.abs(reach - pendulum.length) < 0.03 * pendulum.length, `pendulum ${i} keeps its length (${reach} of ${pendulum.length})`);
        assert.ok(Math.abs(p[0] - pendulum.pivot[0]) < 0.05, `pendulum ${i} swings in its hinge plane`);
        if (tick >= 8 * HZ) { const angle = bobAngle(pendulum); swing[i].min = Math.min(swing[i].min, angle); swing[i].max = Math.max(swing[i].max, angle); }
      });
      scene.chains.forEach((chain, c) => {
        for (let i = 1; i < chain.links.length; i++) maxBend[c] = Math.max(maxBend[c], angleBetween(axisOf(world, chain.links[i - 1]), axisOf(world, chain.links[i])));
      });
      const angle = world.jointState(scene.mixer.hinge).value;
      let delta = angle - paddleAngle; if (delta > Math.PI) delta -= 2 * Math.PI; if (delta < -Math.PI) delta += 2 * Math.PI;
      paddleTurn += delta; paddleAngle = angle;
    });
    // Revolute joints: free hinges, so the wave is still swinging near its release amplitude after 8 s.
    swing.forEach((range, i) => {
      assert.ok(range.max > 0.75 * release[i] && range.min < -0.75 * release[i], `pendulum ${i} still swings between ${range.min} and ${range.max} (released at ${release[i]})`);
    });
    // Spherical joints: the cone limit holds (it is a soft limit, so allow a small overshoot).
    scene.chains.forEach((chain, c) => assert.ok(maxBend[c] < chain.coneAngle + 0.12, `chain ${c} bent ${maxBend[c]} against a ${chain.coneAngle} rad cone`));
    assert.ok(maxBend[0] > 0.2 && maxBend[1] > maxBend[0] + 0.3, `the wider cone bends further (${maxBend})`);
    // Motor-driven hinge: the paddle keeps turning at about the motor speed against the loose bodies.
    assert.ok(paddleTurn > 0.8 * scene.mixer.speed * 12 && paddleTurn < 1.05 * scene.mixer.speed * 12, `paddle turned ${paddleTurn} rad in 12 s at ${scene.mixer.speed} rad/s`);
    for (const body of scene.mixer.loose) { const p = world.bodyState(body).position; assert.ok(Math.abs(p[0] - 3.6) < 2.3 && Math.abs(p[2] - 2.2) < 2.3 && p[1] > 0 && p[1] < 1.2, `a stirred body stays in the pen (${p})`); }
    // Wheel joints: the car has driven over every plank, upright, and is held by the end stop.
    const chassis = world.bodyState(scene.car.chassis);
    assert.ok(chassis.position[0] > Math.max(...scene.car.plankX) + 2, `the car passed the planks (x = ${chassis.position[0]})`);
    assert.ok(chassis.position[0] < scene.car.stopX, 'and stopped at the end stop');
    assert.ok(rotate(chassis.rotation, [0, 1, 0])[1] > 0.95, 'upright');
    assert.ok(chassis.position[1] > 0.55 && chassis.position[1] < 1.0, `riding on its suspension (y = ${chassis.position[1]})`);
    for (const wheel of scene.car.wheels) assert.ok(Math.abs(world.bodyState(wheel).position[1] - 0.38) < 0.08, 'wheels are on the ground');
    assert.ok(matrices(world).every(Number.isFinite));
  } finally { world.destroy(); }
});

test('the car climbs the planks rather than pushing them away', () => {
  const world = pool.createWorld();
  try {
    const scene = buildMechanismsScene(world);
    let highest = 0;
    run(world, 7, () => { for (const wheel of scene.car.wheels) highest = Math.max(highest, world.bodyState(wheel).position[1]); });
    assert.ok(highest > 0.38 + 0.06, `a wheel rose to ${highest} m while crossing`);
    scene.car.planks.forEach((plank, i) => assert.ok(Math.abs(world.bodyState(plank).position[0] - scene.car.plankX[i]) < 1.2, `plank ${i} stayed near where it was laid`));
  } finally { world.destroy(); }
});
