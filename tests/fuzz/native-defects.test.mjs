// Defects the fuzzers found in the native side (Box3D, or the C bridge wasm/box3d_web.c).
//
// Each test states the correct behaviour. ND-1 to ND-5 are fixed in the C bridge (docs/RIGID_CORE.md, section 10;
// packages/box3d-kit/test/v22-rigid-native.test.mjs checks the fixes in more detail) and their tests are ordinary
// tests. ND-6 is still open: its test is marked `todo` with the report, so it runs in the gate, shows as an expected
// failure, and does not fail the run; when it passes, remove the `todo`. Severity: how bad it is for a caller who meets it.
//
//   ND-1  high    Box3D's step does not return for a dynamic box with half extents of about 1.5 km or more (or a dynamic
//                 hull cube of about 100 km) resting on another body; static and kinematic boxes up to 100 km step normally.
//                 Fixed in the bridge: it refuses a dynamic body's convex shape beyond 1 km on every creation path, and
//                 making such a body dynamic. The TypeScript guard (RIGID_LIMITS.shape, setBodyType) stays in front of it.
//   ND-2  high    Joints that contradict each other on one body (a hinge to a far anchor, a wheel joint and a second
//                 wheel joint to the world with limits, spring and motor) gave NaN velocities within four steps.
//                 Fixed in the bridge: a body a step leaves non-finite or impossibly fast is put back at its pose of the
//                 step before, at rest ('body-contained' event, containedTotal()). The kit counts it in
//                 stats().contained, diagnose() reports the rule `body-contained`, and {strict: true} throws NUMERICAL_FAILURE.
//   ND-3  medium  b3w_world_restore kept the world's own handle table whenever the world had no more bodies than the
//                 checkpoint, so after a destroy kept handles named other bodies. Fixed: a checkpoint this world wrote
//                 since its last reset is restored with b3w_world_restore_ex and its own handle table.
//   ND-4  low     Overlap queries reported one hit per shape, so a compound body counted once per overlapping child.
//                 Fixed: the bridge counts bodies.
//   ND-5  high    Jointed mechanisms diverged inside Box3D in about one random program in 150 with every input in range.
//                 Fixed as far as the bridge can: the containment of ND-2 also bounds spin (ten times Box3D's quarter
//                 turn per step), so the world stays finite; a mechanism that still runs away is contained and reported.
//   ND-6  low     The first restore of a checkpoint can change it: checkpoint, restore that checkpoint, checkpoint
//                 again, and 36 bytes differ (the 32-byte digest of the kit's header and 4 bytes of the native payload) in
//                 a world where a body was destroyed and two more created before a spherical joint was made. Body states
//                 are equal, a second restore is byte-exact and the next step is identical, so only byte comparisons of
//                 checkpoints see it. Present in 797cd68 and in c059041 alike, and with b3w_world_restore_ex (ND-3) as with
//                 b3w_world_restore. Guard: none needed for physics; world-misuse.test.mjs takes its baseline after one
//                 restore. Found by the misuse table after the rigid-core merge added bodies to its scene.
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {nativePool} from './lib/scene-gen.mjs';

const pool = await nativePool();
const finite = values => values.every(Number.isFinite);
const cube = h => [-h, -h, -h, h, -h, -h, h, h, -h, -h, h, -h, -h, -h, h, h, -h, h, h, h, h, -h, h, h];

test('ND-1: a step with a 5 km cube resting in the ground returns (the bridge refuses the cube)', () => {
  // In a child process with a time limit: the defect is a step that never returns. The raw export is called because the
  // adapter refuses a shape this large.
  const script = `
    import {nativePool} from ${JSON.stringify(new URL('./lib/scene-gen.mjs', import.meta.url).href)};
    const world = (await nativePool()).createWorld();
    world.resetWorld({ground: true});
    const token = world.mod._b3w_world_launch_projectile_handle(world.handle, 0, 6, 0, 0, 0, 0, 5000);
    world.step(1 / 60, 4); world.step(1 / 60, 4);
    console.log('returned ' + token);`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {cwd: fileURLToPath(new URL('../..', import.meta.url)), timeout: 20000, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}});
  assert.equal(child.error?.code, undefined, `the step did not return within 20 s (${child.error?.code})`);
  assert.match(child.stdout, /returned 0\b/, `the 5 km dynamic cube is refused (no handle): ${child.stdout}${child.stderr}`);
});

test('ND-2: joints that contradict each other stay finite, and every containment is reported', () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: true});
    const box = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0, 2, 0]});
    const wheel = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 0.3, 3]});
    world.createJoint({type: 'revolute', bodyA: null, bodyB: box, frameA: {position: [4, 2, 0]}});
    world.createJoint({type: 'wheel', bodyA: box, bodyB: wheel, frameA: {position: [0, -0.5, 0]}});
    world.createJoint({type: 'wheel', bodyA: box, bodyB: null, frameA: {position: [0, 0.5, 0]}, frameB: {position: [0, -0.5, 0]}, limits: {lower: -0.2, upper: 0.2}, spring: {hertz: 4, dampingRatio: 0.7}, motor: {speed: 3, maxForce: 20}});
    const before = world.containedTotal();
    let events = 0;
    for (let step = 0; step < 30; step++) {
      world.step(1 / 60, 4);
      events += world.collectEvents().events.filter(event => event.kind === 'body-contained').length;
      const state = world.bodyState(box);
      assert.ok(finite([...state.position, ...state.linearVelocity, ...state.angularVelocity]), `the box is not finite after step ${step + 1}: ${JSON.stringify(state.position)}`);
    }
    // What keeps it finite is the bridge's containment, which is never silent.
    assert.ok(events > 0 && world.containedTotal() - before === events, `contained ${world.containedTotal() - before} times, ${events} events`);
  } finally { world.destroy(); }
});

test('ND-3: after a destroy, restoring an earlier checkpoint leaves kept handles on their own bodies', () => {
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

test('ND-4: an overlap query counts a compound body once', () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: false});
    world.createBody({shape: {kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: 0.2}, position: [0.3, 0, 0]}, {shape: {kind: 'sphere', radius: 0.2}, position: [-0.3, 0, 0]}, {shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}}]}, position: [0, 2, 0], type: 'static'});
    const [result] = world.queryBatch([{kind: 'sphere-overlap', origin: [0, 2, 0], radius: 3, limit: 1}]);
    assert.equal(result.hits.length, 1);
    assert.deepEqual({totalHits: result.totalHits, overflow: result.overflow}, {totalHits: 1, overflow: false}, 'one body overlaps, so nothing overflowed a limit of 1');
  } finally { world.destroy(); }
});

test('ND-5: a random program of in-range operations with joints stays finite', async () => {
  const {kit} = await import('./lib/kit.mjs'), {rng} = await import('./lib/rng.mjs'), {WorldSession, checkInvariants} = await import('./lib/world-program.mjs');
  const world = await kit.createWorld({strict: true, gravity: [0, -9.81, 0]});
  try {
    const seed = 21702374, r = rng(seed), session = new WorldSession(world, r);
    world.reset({gravity: [0, -9.81, 0], seed});
    for (let i = 0; i < 260; i++) { session.op(); if (r.bool(0.55)) session.step(r.int(1, 4)); }
    checkInvariants(world, session.graveyard);
    assert.deepEqual([world.stats().nonFiniteSince, world.stats().contained], [null, 0]);
  } finally { world.dispose(); }
  // The four seeds on record, in a lenient world: finite with every invariant, and what the bridge contained (one of
  // them still runs away and is contained) is counted, one event each.
  for (const seed of [21702374, 21741969, 20427415, 20878798]) {
    const lenient = await kit.createWorld({gravity: [0, -9.81, 0]});
    try {
      const r = rng(seed), session = new WorldSession(lenient, r);
      lenient.reset({gravity: [0, -9.81, 0], seed});
      let events = 0;
      lenient.onEvent(event => { if (event.kind === 'body-contained') events++; });
      for (let i = 0; i < 260; i++) { session.op(); if (r.bool(0.55)) session.step(r.int(1, 4)); }
      checkInvariants(lenient, session.graveyard);
      assert.equal(lenient.stats().nonFiniteSince, null, `seed ${seed}`);
      assert.equal(lenient.stats().contained, events, `seed ${seed}: one event per containment`);
    } finally { lenient.dispose(); }
  }
});

test('ND-6: restoring a checkpoint and taking it again gives the same bytes', {todo: 'bridge or Box3D: the first restore rewrites 4 bytes of the native checkpoint (36 with the header digest) after a destroyed body slot was reused; not changed by the ND-3 fix'}, async () => {
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
