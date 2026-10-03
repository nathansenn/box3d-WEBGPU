import assert from 'node:assert/strict';
import test from 'node:test';
import {Worker} from 'node:worker_threads';
import {createWorld, pauseOnHidden, FixedStepLoop, EngineError} from 'box3d-webgpu-kit';
import {syncInstancedMesh} from 'box3d-webgpu-kit/three';
import {connectWorld} from 'box3d-webgpu-kit/worker';

const close = (a, b, eps = 1e-5) => Math.abs(a - b) <= eps;

test('interpolatedMatrices blends the last two steps and preserves box size', async () => {
  const world = await createWorld();
  try {
    const box = world.spawnBox({position: [0, 6, 0], impulse: [3, 0, 0], halfSize: 0.4});
    for (let i = 0; i < 20; i++) world.step();
    const row = 1, before = world.matrices().slice(row * 16, row * 16 + 16);
    world.step();
    const after = world.matrices().slice(row * 16, row * 16 + 16);
    const at = alpha => world.interpolatedMatrices(alpha).slice(row * 16, row * 16 + 16);
    assert.deepEqual(Array.from(at(1)), Array.from(after), 'alpha 1 is the latest step');
    at(0).forEach((v, k) => assert.ok(close(v, before[k]), `alpha 0 matches the previous step at ${k}`));
    const mid = at(0.5);
    for (const k of [12, 13, 14]) assert.ok(close(mid[k], (before[k] + after[k]) / 2), 'position is lerped');
    assert.ok(close(Math.hypot(mid[0], mid[1], mid[2]), 0.4, 1e-4), 'rotation stays orthonormal and scaled by half extent');
    assert.ok(before[13] - after[13] > 1e-3, 'the body really moved between steps');
    world.destroyBody(world.spawnBox({position: [5, 5, 5]}));
    assert.deepEqual(Array.from(world.interpolatedMatrices(0.5)), Array.from(world.matrices()), 'after a destroy, rows may have moved: draw latest');
    assert.ok(world.getPose(box));
  } finally { world.dispose(); }
});

test('three adapter renders interpolated transforms when given alpha', async () => {
  const world = await createWorld();
  try {
    world.spawnBox({position: [0, 6, 0]});
    for (let i = 0; i < 10; i++) world.step();
    const mesh = {count: 0, instanceMatrix: {array: new Float32Array(16 * 4), needsUpdate: false}, instanceColor: null};
    syncInstancedMesh(world, mesh, {alpha: 0.25});
    assert.deepEqual(Array.from(mesh.instanceMatrix.array.subarray(0, 32)), Array.from(world.interpolatedMatrices(0.25)));
    assert.notDeepEqual(Array.from(mesh.instanceMatrix.array.subarray(16, 32)), Array.from(world.matrices().subarray(16, 32)));
  } finally { world.dispose(); }
});

test('user data turns query hits back into game entities and is cleared on destroy and reset', async () => {
  const world = await createWorld();
  try {
    const crate = world.spawnBox({position: [0, 0.5, 0]});
    world.setUserData(crate, {name: 'crate', hp: 3});
    const hit = world.raycast([0, 10, 0], [0, -20, 0]);
    assert.equal(world.getUserData(hit.body).name, 'crate', 'a fresh hit handle resolves to the same entity');
    const ground = world.bodyAt(0);
    world.setUserData(ground, 'ground');
    world.destroyBody(crate);
    assert.equal(world.getUserData(crate), undefined);
    assert.throws(() => world.setUserData(crate, 1), e => e.code === 'STALE_BODY');
    world.resetArena();
    assert.equal(world.getUserData(world.bodyAt(0)), undefined);
  } finally { world.dispose(); }
});

test('sphereCast, boxCast and overlapBox find a resting cube', async () => {
  const world = await createWorld();
  try {
    const cube = world.spawnBox({position: [0, 0.5, 0], halfSize: 0.5});
    for (let i = 0; i < 60; i++) world.step();
    const sphere = world.sphereCast([0, 10, 0], 0.25, [0, -20, 0]);
    assert.ok(sphere && sphere.body.token === cube.token, 'sphere cast hits the cube');
    assert.ok(close(sphere.point[1], 1, 0.05), `contact at cube top, y=${sphere.point[1]}`);
    const box = world.boxCast([0, 10, 0], [0.1, 0.1, 0.1], [0, -20, 0]);
    assert.ok(box && box.body.token === cube.token);
    assert.deepEqual(world.overlapBox([0, 0.5, 0], [0.2, 0.2, 0.2]).map(b => b.token), [cube.token]);
    assert.equal(world.overlapBox([10, 5, 10], [0.2, 0.2, 0.2]).length, 0);
    assert.equal(world.raycast([0, 10, 0], [0, -20, 0], {filter: {bodies: 'static'}}).body.token, world.bodyAt(0).token, 'filters reach the native query');
  } finally { world.dispose(); }
});

test('stats report ticks, timings and capacity; capacity can be reserved up front', async () => {
  const world = await createWorld({capacity: 16384});
  try {
    assert.ok(world.stats().capacity >= 16384);
    world.spawnBox({position: [0, 3, 0]});
    world.update(1 / 30);
    const s = world.stats();
    assert.equal(s.tick, 2);
    assert.equal(s.bodies, 2);
    assert.ok(s.lastStepMs >= 0 && s.lastUpdateMs >= s.lastStepMs);
    assert.ok(s.awake >= 1);
    world.update(10);
    assert.ok(world.stats().droppedSeconds > 9);
  } finally { world.dispose(); }
});

test('exactHash catches sub-millimetre divergence that replayHash cannot', async () => {
  const run = async nudge => {
    const world = await createWorld();
    const b = world.spawnBox({position: [0, 3, 0]});
    for (let i = 0; i < 30; i++) world.step();
    if (nudge) world.applyImpulse(b, [0.001, 0, 0]);
    for (let i = 0; i < 30; i++) world.step();
    const out = {exact: world.exactHash(), coarse: world.replayHash()};
    world.dispose();
    return out;
  };
  const clean = await run(false), nudged = await run(true);
  assert.equal(clean.coarse, nudged.coarse, 'the 1 mm hash misses it (documented)');
  assert.notEqual(clean.exact, nudged.exact, 'the exact hash sees it');
  assert.equal(clean.exact, (await run(false)).exact, 'and is stable across identical runs');
});

test('recorded sessions replay bit-for-bit, survive JSON, and detect tampering', async () => {
  const world = await createWorld({seed: 99});
  const other = await createWorld({seed: 5});
  try {
    world.startRecording();
    const boxes = [];
    for (let i = 0; i < 8; i++) boxes.push(world.spawnBox({position: [i - 4, 1 + (i % 3), 0], halfSize: 0.4}));
    for (let t = 0; t < 200; t++) {
      if (t === 30) world.applyImpulse(boxes[2], [0, 20, 0]);
      if (t === 60) world.destroyBody(boxes[0]);
      if (t === 90) world.explode([0, 0, 0], 10, 6);
      if (t === 120) world.spawnBox({position: [0, 8, 0], impulse: [0, -10, 0]});
      world.update(1 / 60);
    }
    const log = JSON.parse(JSON.stringify(world.stopRecording()));
    assert.equal(log.commands.length, 12, '9 spawns + impulse + destroy + explode');
    assert.equal(other.replay(log), true, 'another world reproduces the exact final state');
    assert.equal(other.exactHash(), world.exactHash());
    const tampered = {...log, commands: log.commands.map(c => c.op === 'explode' ? {...c, strength: 10.001} : c)};
    assert.equal(other.replay(tampered), false);
    const slow = await createWorld({step: 1 / 120});
    try { assert.throws(() => slow.replay(log), e => e.code === 'INVALID_PAYLOAD'); } finally { slow.dispose(); }
  } finally { world.dispose(); other.dispose(); }
});

test('recording refuses resets it cannot capture', async () => {
  const world = await createWorld();
  try {
    world.startRecording();
    assert.throws(() => world.resetArena(), e => e.code === 'INVALID_STATE');
    assert.throws(() => world.loadPreset(0), e => e.code === 'INVALID_STATE');
    world.stopRecording();
    assert.throws(() => world.stopRecording(), e => e.code === 'INVALID_STATE');
  } finally { world.dispose(); }
});

test('pauseOnHidden resets the accumulator on visibility changes', () => {
  const listeners = new Map();
  const doc = {addEventListener: (t, f) => listeners.set(t, f), removeEventListener: t => listeners.delete(t)};
  const loop = new FixedStepLoop();
  loop.advance(1 / 120, () => {});
  const off = pauseOnHidden(loop, doc);
  listeners.get('visibilitychange')();
  assert.equal(loop.advance(1 / 120, () => {}).steps, 0, 'the half step accumulated before hiding was discarded');
  off();
  assert.equal(listeners.size, 0);
  assert.equal(typeof pauseOnHidden(loop, undefined), 'function', 'no-op without a document');
});

test('a worker-hosted world streams frames, resolves bodies and matches a local world exactly', async () => {
  const remote = await connectWorld(new Worker(new URL('./fixtures/physics.worker.mjs', import.meta.url)), {seed: 3});
  const local = await createWorld({seed: 3});
  try {
    assert.equal(remote.bodyCount(), 1, 'init frame carries the ground');
    const crate = await remote.spawnBox({position: [0, 4, 0]});
    local.spawnBox({position: [0, 4, 0]});
    remote.setUserData(crate, 'crate');
    let frame;
    for (let i = 0; i < 180; i++) { frame = await remote.update(1 / 60); local.update(1 / 60); }
    assert.equal(frame.bodies, 2);
    assert.equal(remote.matrices().length, 32);
    assert.equal(await remote.exactHash(), local.exactHash(), 'worker and main-thread simulations are identical');
    assert.ok(close((await remote.getPose(crate)).position[1], 0.5, 0.05));
    const hit = await remote.raycast([0, 10, 0], [0, -20, 0]);
    assert.equal(remote.getUserData(hit.body), 'crate');
    const mesh = {count: 0, instanceMatrix: {array: new Float32Array(16 * 8), needsUpdate: false}, instanceColor: {array: new Float32Array(3 * 8), needsUpdate: false}};
    assert.equal(syncInstancedMesh(remote, mesh), 2, 'RemoteWorld drives the three adapter');
    assert.ok(mesh.instanceColor.array[3] > 0, 'colors arrived');
    assert.equal(await remote.destroyBody(crate), true);
    assert.equal(remote.bodyCount(), 1);
    await assert.rejects(remote.applyImpulse(crate, [0, 1, 0]), e => e instanceof EngineError && e.code === 'STALE_BODY');
    assert.equal((await remote.stats()).bodies, 1);
  } finally { await remote.dispose(); local.dispose(); }
  await assert.rejects(remote.stats(), e => e.code === 'DISPOSED');
});
