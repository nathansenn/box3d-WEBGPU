import assert from 'node:assert/strict';
import test from 'node:test';
// Import by package name so the test exercises the published `exports` map.
import {createWorld, loadBox3D, PhysicsWorld, FixedStepLoop, EngineError} from 'box3d-webgpu-kit';
import {syncInstancedMesh} from 'box3d-webgpu-kit/three';

const run = (world, seconds) => { let steps = 0; for (let t = 0; t < seconds * 60; t++) steps += world.update(1 / 60).steps; return steps; };

test('empty arena: only the static ground, top face at y = 0', async () => {
  const world = await createWorld();
  try {
    assert.equal(world.bodyCount(), 1);
    const hit = world.raycast([0, 10, 0], [0, -20, 0]);
    assert.ok(hit, 'ray must hit the ground');
    assert.ok(Math.abs(hit.point[1]) < 1e-3, `ground top at ${hit.point[1]}`);
  } finally { world.dispose(); }
});

test('a dropped cube falls, lands on the ground and reports a valid pose', async () => {
  const world = await createWorld();
  try {
    const box = world.spawnBox({position: [0, 5, 0], halfSize: 0.5});
    assert.ok(box);
    const start = world.getPose(box);
    assert.deepEqual(start.halfExtents.map(v => +v.toFixed(4)), [0.5, 0.5, 0.5]);
    run(world, 0.25);
    assert.ok(world.getPose(box).position[1] < start.position[1] - 0.2, 'gravity moves the cube down');
    run(world, 3);
    const rest = world.getPose(box);
    assert.ok(Math.abs(rest.position[1] - 0.5) < 0.05, `cube rests on the ground, y=${rest.position[1]}`);
    const q = rest.rotation;
    assert.ok(Math.abs(Math.hypot(...q) - 1) < 1e-4, 'rotation is a unit quaternion');
    const hit = world.raycast([0, 10, 0], [0, -20, 0]);
    assert.ok(hit && Math.abs(hit.point[1] - 1) < 0.05, 'ray hits the cube top first');
    assert.equal(world.overlapSphere([0, 0.5, 0], 0.2).length, 1);
  } finally { world.dispose(); }
});

test('destroyed handles go stale and never alias new bodies', async () => {
  const world = await createWorld();
  try {
    const a = world.spawnBox({position: [0, 2, 0]});
    assert.equal(world.destroyBody(a), true);
    assert.equal(world.destroyBody(a), false);
    assert.equal(world.isAlive(a), false);
    assert.equal(world.getPose(a), null);
    const b = world.spawnBox({position: [0, 2, 0]});
    assert.equal(world.isAlive(b), true);
    assert.equal(world.isAlive(a), false);
    assert.throws(() => world.applyImpulse(a, [0, 1, 0]), e => e instanceof EngineError && e.code === 'STALE_BODY');
  } finally { world.dispose(); }
});

function scenario(world) {
  for (let i = 0; i < 12; i++) world.spawnBox({position: [(i % 4) - 1.5, 1 + Math.floor(i / 4) * 1.2, 0], halfSize: 0.45});
  const thrown = world.spawnBox({position: [-8, 1.5, 0], impulse: [40, 5, 0], halfSize: 0.4});
  for (let t = 0; t < 180; t++) {
    if (t === 90) world.explode([0, 0, 0], 6, 5);
    world.step();
  }
  return {hash: world.replayHash(), thrown: world.getPose(thrown).position.slice(), matrices: Array.from(world.matrices())};
}

test('simulation is deterministic across worlds and after reset', async () => {
  const pool = await loadBox3D();
  const a = new PhysicsWorld(pool).resetArena(), b = new PhysicsWorld(pool).resetArena();
  try {
    const first = scenario(a), second = scenario(b);
    assert.equal(first.hash, second.hash);
    assert.deepEqual(first.thrown, second.thrown);
    assert.deepEqual(first.matrices, second.matrices, 'bit-identical float32 transforms');
    assert.ok(first.thrown[0] > -7, 'thrown cube actually moved');
    a.resetArena();
    assert.equal(a.bodyCount(), 1, 'reset leaves only the ground');
    assert.deepEqual(scenario(a), first, 'replay after reset is bit-identical');
  } finally { a.dispose(); b.dispose(); pool.destroy(); }
});

test('fixed-step loop runs whole steps, reports alpha and caps catch-up', () => {
  const loop = new FixedStepLoop({step: 1 / 60, maxSteps: 3});
  let ticks = 0;
  let r = loop.advance(1 / 120, () => ticks++);
  assert.equal(r.steps, 0); assert.ok(Math.abs(r.alpha - 0.5) < 1e-9);
  r = loop.advance(1 / 120, () => ticks++);
  assert.equal(r.steps, 1);
  r = loop.advance(10, () => ticks++);
  assert.equal(r.steps, 3); assert.ok(r.droppedSeconds > 9);
  assert.equal(loop.advance(NaN, () => ticks++).steps, 0);
  assert.equal(ticks, 4);
  assert.throws(() => new FixedStepLoop({step: 0.1}), RangeError);
});

test('three adapter copies transforms and colors, and skips unchanged frames', async () => {
  const world = await createWorld();
  try {
    world.spawnBox({position: [0, 3, 0]});
    const capacity = 8, attr = n => ({array: new Float32Array(capacity * n), needsUpdate: false});
    const mesh = {count: 0, instanceMatrix: attr(16), instanceColor: attr(3)};
    assert.equal(syncInstancedMesh(world, mesh), 2);
    assert.deepEqual(Array.from(mesh.instanceMatrix.array.subarray(0, 32)), Array.from(world.matrices()));
    assert.ok(mesh.instanceColor.array[3] > 0, 'cube color copied');
    mesh.instanceMatrix.needsUpdate = false;
    syncInstancedMesh(world, mesh);
    assert.equal(mesh.instanceMatrix.needsUpdate, false, 'no upload when nothing moved');
    world.step();
    syncInstancedMesh(world, mesh);
    assert.equal(mesh.instanceMatrix.needsUpdate, true);
  } finally { world.dispose(); }
});

test('a module hosts several isolated worlds up to its capacity', async () => {
  const pool = await loadBox3D();
  try {
    const worlds = Array.from({length: pool.capacity}, () => new PhysicsWorld(pool));
    assert.throws(() => new PhysicsWorld(pool), e => e.code === 'WORLD_CAPACITY');
    worlds.forEach(w => w.dispose());
    assert.equal(pool.size, 0);
  } finally { pool.destroy(); }
});

test('createBodyMesh works with the real three.js InstancedMesh', async t => {
  let THREE;
  try { THREE = await import('three'); } catch { t.skip('three is not installed next to the repo'); return; }
  const {createBodyMesh} = await import('box3d-webgpu-kit/three');
  const world = await createWorld();
  try {
    world.spawnBox({position: [1, 2, 3], halfSize: 0.25});
    const mesh = createBodyMesh(THREE, world);
    assert.ok(mesh instanceof THREE.InstancedMesh);
    assert.equal(mesh.count, 2);
    const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
    mesh.getMatrixAt(1, m); m.decompose(p, q, s);
    assert.deepEqual(p.toArray().map(v => +v.toFixed(3)), [1, 2, 3]);
    assert.deepEqual(s.toArray().map(v => +v.toFixed(3)), [0.25, 0.25, 0.25]);
    assert.equal(mesh.geometry.parameters.width, 2, 'unit geometry is 2x2x2');
  } finally { world.dispose(); }
});
