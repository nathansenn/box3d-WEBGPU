// Defects the fuzzers found in the native side (Box3D, or the C bridge wasm/box3d_web.c), which this work does not change.
//
// Each test states the correct behaviour and is marked `todo` with the report, so it runs in the gate, shows as an
// expected failure, and does not fail the run. When the native side is fixed the test passes: remove the `todo`, and
// the TypeScript guard named in the report can be relaxed. Severity: how bad it is for a caller who meets it.
//
//   ND-1  high    Box3D's step does not return for a dynamic box with half extents of about 1.5 km or more (or a dynamic
//                 hull cube of about 100 km) resting on another body; static and kinematic boxes up to 100 km step normally.
//                 Guard: a dynamic body's convex shapes are limited to 1 km (RIGID_LIMITS.shape); static and kinematic ones may
//                 reach RIGID_LIMITS.extent, and such a body cannot be made dynamic, so the kit cannot reach it.
//   ND-2  high    Joints that contradict each other on one body (a hinge to a far anchor, a wheel joint and a second
//                 wheel joint to the world with limits, spring and motor) give NaN velocities within four steps.
//                 Box3D logs "unstable" and continues. Guard: none possible before the step; PhysicsWorld records the
//                 tick in stats().nonFiniteSince and, with {strict: true}, throws NUMERICAL_FAILURE at that step.
//   ND-3  medium  b3w_world_restore keeps the world's own handle table whenever the world has no more bodies than the
//                 checkpoint ("keepHandles"). After a body was destroyed since the checkpoint, rows have moved, so the
//                 restore gives the checkpoint's bodies to the wrong handles: a kept handle then names another body
//                 and the destroyed body's handle stays dead. Physics state is exact; only handles are wrong.
//                 Guard: none in TypeScript; docs/CHECKPOINTS.md tells callers to read handles again with bodyAt().
//   ND-4  low     Overlap queries report one hit per shape, so a compound body counts once per overlapping child:
//                 `totalHits` and `overflow` count shapes, and a limit can be used up by one body.
//                 Guard: the adapter merges the repeats (it used to throw INVALID_BACKEND, fixed here), but with a
//                 limit below the shape count `overflow` is still true for a single body.
//   ND-5  high    Jointed mechanisms diverge inside Box3D in about one random program in 150 (4 of 603 with the
//                 default seed base), with every input in range and no diagnose() warning: speeds pass 1e6 m/s within a
//                 few steps and then become NaN. Far more often when a joint frame is far from its body (the
//                 `joint-lever` rule) or one end of a joint is teleported metres away, which the programs therefore
//                 avoid. Guard: as for ND-2; world-fuzz.test.mjs counts the caught divergences against a 3 % allowance.
//   ND-6  low     The first restore of a checkpoint can change it: checkpoint, restore that checkpoint, checkpoint
//                 again, and 35-36 bytes differ (from byte 8 on) in a world where a body was destroyed and two more
//                 created before a spherical joint was made. Body states are equal, a second restore is byte-exact and
//                 the next step is identical, so only byte comparisons of checkpoints see it. Present in 797cd68 and in
//                 c059041 alike. Guard: none needed for physics; world-misuse.test.mjs takes its baseline after one
//                 restore. Found by the misuse table after the rigid-core merge added bodies to its scene.
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativePool} from './lib/scene-gen.mjs';

const pool = await nativePool();
const finite = values => values.every(Number.isFinite);
const cube = h => [-h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h, -h, -h, h, h, -h, h, h, h, h, -h, h, h];

test('ND-1: a step with a 5 km cube resting in the ground returns', {todo: 'Box3D: the step loops for a box with half extents >= about 5 km in contact with another box'}, () => {
  // In a child process with a time limit: the defect is a step that never returns. The raw export is called because the
  // adapter refuses a shape this large.
  const script = `
    import {nativePool} from ${JSON.stringify(new URL('./lib/scene-gen.mjs', import.meta.url).href)};
    const world = (await nativePool()).createWorld();
    world.resetWorld({ground: true});
    world.mod._b3w_world_launch_projectile_handle(world.handle, 0, 6, 0, 0, 0, 0, 5000);
    world.step(1 / 60, 4); world.step(1 / 60, 4);
    console.log('returned');`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {cwd: fileURLToPath(new URL('../..', import.meta.url)), timeout: 20000, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}});
  assert.equal(child.error?.code, undefined, `the step did not return within 20 s (${child.error?.code})`);
  assert.match(child.stdout, /returned/);
});

test('ND-2: joints that contradict each other stay finite', {todo: 'Box3D: an over-constrained body with a limited wheel joint to the world gets NaN velocities'}, () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: true});
    const box = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0, 2, 0]});
    const wheel = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 0.3, 3]});
    world.createJoint({type: 'revolute', bodyA: null, bodyB: box, frameA: {position: [4, 2, 0]}});
    world.createJoint({type: 'wheel', bodyA: box, bodyB: wheel, frameA: {position: [0, -0.5, 0]}});
    world.createJoint({type: 'wheel', bodyA: box, bodyB: null, frameA: {position: [0, 0.5, 0]}, frameB: {position: [0, -0.5, 0]}, limits: {lower: -0.2, upper: 0.2}, spring: {hertz: 4, dampingRatio: 0.7}, motor: {speed: 3, maxForce: 20}});
    for (let step = 0; step < 30; step++) {
      world.step(1 / 60, 4);
      const state = world.bodyState(box);
      assert.ok(finite([...state.position, ...state.linearVelocity, ...state.angularVelocity]), `the box is not finite after step ${step + 1}: ${JSON.stringify(state.position)}`);
    }
  } finally { world.destroy(); }
});

test('ND-3: after a destroy, restoring an earlier checkpoint leaves kept handles on their own bodies', {todo: 'bridge: b3w_world_restore keeps the handle table by row although a destroy moved the rows'}, () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: true});
    const make = x => world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [x, 1, 0], type: 'static'});
    const a = make(1), b = make(2), c = make(3);
    world.step(1 / 60, 4);
    const saved = world.checkpoint();
    world.destroyBody(a);            // the last row (c) moves into a's row
    world.restoreCheckpoint(saved);
    assert.notEqual(world.bodyIndex(a), null, 'the body destroyed after the checkpoint is alive again under its handle');
    assert.equal(world.bodyState(a).position[0], 1, 'handle a names the body at x = 1');
    assert.equal(world.bodyState(b).position[0], 2, 'handle b names the body at x = 2');
    assert.equal(world.bodyState(c).position[0], 3, 'handle c names the body at x = 3');
  } finally { world.destroy(); }
});

test('ND-4: an overlap query counts a compound body once', {todo: 'bridge: overlap callbacks report one hit per shape, so totals and overflow count shapes'}, () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: false});
    world.createBody({shape: {kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: 0.2}, position: [0.3, 0, 0]}, {shape: {kind: 'sphere', radius: 0.2}, position: [-0.3, 0, 0]}, {shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}}]}, position: [0, 2, 0], type: 'static'});
    const [result] = world.queryBatch([{kind: 'sphere-overlap', origin: [0, 2, 0], radius: 3, limit: 1}]);
    assert.equal(result.hits.length, 1);
    assert.deepEqual({totalHits: result.totalHits, overflow: result.overflow}, {totalHits: 1, overflow: false}, 'one body overlaps, so nothing overflowed a limit of 1');
  } finally { world.destroy(); }
});

test('ND-5: a random program of in-range operations with joints stays finite', {todo: 'Box3D: a jointed mechanism built by fuzz seed 21702374 diverges with all inputs in range'}, async () => {
  const {kit} = await import('./lib/kit.mjs'), {rng} = await import('./lib/rng.mjs'), {WorldSession, checkInvariants} = await import('./lib/world-program.mjs');
  const world = await kit.createWorld({strict: true, gravity: [0, -9.81, 0]});
  try {
    const seed = 21702374, r = rng(seed), session = new WorldSession(world, r);
    world.reset({gravity: [0, -9.81, 0], seed});
    for (let i = 0; i < 260; i++) { session.op(); if (r.bool(0.55)) session.step(r.int(1, 4)); }
    checkInvariants(world, session.graveyard);
    assert.equal(world.stats().nonFiniteSince, null);
  } finally { world.dispose(); }
});

test('ND-6: restoring a checkpoint and taking it again gives the same bytes', {todo: 'bridge or Box3D: the first restore rewrites 35-36 bytes of the checkpoint after a destroyed body slot was reused'}, async () => {
  const {kit} = await import('./lib/kit.mjs');
  const world = await kit.createWorld({gravity: [0, -9.81, 0]});
  try {
    world.reset({gravity: [0, -9.81, 0]});
    const box = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0, 2, 0]});
    world.createBody({shape: {kind: 'sphere', radius: 0.4}, position: [2, 3, 0], hitEvents: true});
    world.createBody({shape: {kind: 'capsule', radius: 0.2, halfLength: 0.4}, type: 'kinematic', position: [-2, 1, 0]});
    const post = world.createBody({shape: {kind: 'box', halfExtents: [0.2, 1, 0.2]}, type: 'static', position: [4, 1, 0]});
    const wheelBody = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 0.3, 3]});
    world.destroyBody(world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 9, 0]}));
    world.createJoint({type: 'revolute', bodyA: post, bodyB: box, frameA: {position: [0, 1, 0]}, limits: {lower: -1, upper: 1}, motor: {speed: 1, maxForce: 10}, spring: {hertz: 2, dampingRatio: 0.5}});
    world.createJoint({type: 'wheel', bodyA: box, bodyB: wheelBody, frameA: {position: [0, -0.5, 0]}});
    const crate = world.createBody({shape: {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, position: [-4, 1.5, -3]});
    world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.1, 0.5]}, position: [4, 0.6, -3]});
    world.createJoint({type: 'spherical', bodyA: null, bodyB: crate, frameA: {position: [-4, 2, -3]}, frameB: {position: [0, 0.5, 0]}, coneAngle: 0.8});
    for (let i = 0; i < 5; i++) world.step();
    const states = () => Array.from({length: world.bodyCount()}, (_, row) => JSON.stringify(world.getState(world.bodyAt(row)))).join();
    const before = world.checkpoint(), stateBefore = states();
    world.restoreCheckpoint(before);
    // What holds today: the physical state is exact, and a second restore is byte-exact.
    assert.equal(states(), stateBefore);
    const once = world.checkpoint();
    world.restoreCheckpoint(once);
    assert.deepEqual(world.checkpoint(), once);
    // The defect: the first restore changed the bytes.
    assert.deepEqual(once, before);
  } finally { world.dispose(); }
});

test('the guards for the defects above hold', () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: true});
    // ND-1: the adapter refuses a dynamic body's convex shape beyond 1 km before Box3D sees it.
    for (const call of [() => world.launchProjectileBody(0, 6, 0, 0, 0, 0, 5000), () => world.createBody({shape: {kind: 'box', halfExtents: [1500, 1500, 1500]}, position: [0, 6, 0]}),
      () => world.createBody({shape: {kind: 'sphere', radius: 1e4}, position: [0, 6, 0]}), () => world.createBody({shape: {kind: 'hull', points: cube(2000)}, position: [0, 6, 0]}),
      () => world.createBody({shape: {kind: 'compound', shapes: [{shape: {kind: 'box', halfExtents: [1, 1, 1]}, position: [1500, 0, 0]}]}, position: [0, 6, 0]})]) {
      assert.throws(call, error => error.name === 'EngineError' && error.code === 'INVALID_PAYLOAD' && /1000/.test(error.message));
    }
    // Static and kinematic bodies step normally with large shapes, and may have them; such a body cannot be made dynamic,
    // before or after a checkpoint is restored.
    const road = world.createBody({type: 'static', shape: {kind: 'box', halfExtents: [2000, 0.5, 2000]}, position: [0, -0.5, 0]});
    const wall = world.createBody({type: 'kinematic', shape: {kind: 'box', halfExtents: [5e4, 10, 1]}, position: [0, 10, 3000]});
    const rock = world.createBody({type: 'static', shape: {kind: 'hull', points: cube(3000)}, position: [0, -3000, 9000]});
    const crate = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [10, 3, 0]});
    for (let i = 0; i < 120; i++) world.step(1 / 60, 4);
    assert.ok(Math.abs(world.bodyState(crate).position[1] - 0.5) < 0.05, `the crate rests on the 2 km road: y = ${world.bodyState(crate).position[1]}`);
    const refusedDynamic = () => { for (const big of [road, wall, rock]) assert.throws(() => world.setBodyType(big, 'dynamic'), error => error.code === 'INVALID_STATE' && /1000 m/.test(error.message)); };
    refusedDynamic();
    world.setBodyType(road, 'kinematic'); world.setBodyType(road, 'static');
    world.setBodyType(crate, 'kinematic'); world.setBodyType(crate, 'dynamic');
    const saved = world.checkpoint();
    world.restoreCheckpoint(saved);
    refusedDynamic();

    // ND-4: a compound in range is one hit, and with room in the limit the total is exact.
    const body = world.createBody({shape: {kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: 0.2}, position: [0.3, 0, 0]}, {shape: {kind: 'sphere', radius: 0.2}, position: [-0.3, 0, 0]}]}, position: [0, 2, 0]});
    for (const kind of ['sphere-overlap', 'box-overlap']) {
      const [result] = world.queryBatch([{kind, origin: [0, 2, 0], ...(kind === 'sphere-overlap' ? {radius: 1} : {halfExtents: [1, 1, 1]}), limit: 8}]);
      assert.deepEqual(result.hits.map(hit => hit.body.token), [body.token]);
      assert.deepEqual({totalHits: result.totalHits, overflow: result.overflow}, {totalHits: 1, overflow: false});
    }
  } finally { world.destroy(); }
});
