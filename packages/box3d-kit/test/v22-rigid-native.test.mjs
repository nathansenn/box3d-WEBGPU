// Native defects found by fuzzing (docs/ROBUSTNESS.md, ND-1 to ND-5), fixed in the C bridge (wasm/box3d_web.c) and
// checked here on the shipped artifact through the kit's own NativeWorldBackend. Each test is the defect's report
// turned into a requirement.
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {NativeWorldPool} from '../dist/core/native-world.js';

const wasm = name => fileURLToPath(new URL(`../wasm/${name}`, import.meta.url));
const {default: factory} = await import(wasm('box3d.js'));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(wasm('box3d.wasm'))}));
const finite = values => values.every(Number.isFinite);

test('ND-1: a dynamic convex shape above 1 km is refused by the bridge, so the step that used to loop for ever returns', () => {
  // In a child process with a time limit, through the raw export the fuzzer used (a 5 km cube resting in the ground).
  const script = `
    import {readFile} from 'node:fs/promises';
    import {NativeWorldPool} from ${JSON.stringify(new URL('../dist/core/native-world.js', import.meta.url).href)};
    const {default: factory} = await import(${JSON.stringify(new URL('../wasm/box3d.js', import.meta.url).href)});
    const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(${JSON.stringify(wasm('box3d.wasm'))})}));
    const world = pool.createWorld();
    world.resetWorld({ground: true});
    const token = world.mod._b3w_world_launch_projectile_handle(world.handle, 0, 6, 0, 0, 0, 0, 5000);
    for (let i = 0; i < 30; i++) world.step(1 / 60, 4);
    console.log('returned', String(token));`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', script], {timeout: 60000, encoding: 'utf8', env: {...process.env, NODE_OPTIONS: ''}});
  assert.equal(child.error?.code, undefined, `the steps did not return within 60 s (${child.error?.code})`);
  assert.match(child.stdout, /returned 0/, `the 5 km cube is refused: ${child.stdout}${child.stderr}`);
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: true});
    const refused = (shape, label) => assert.throws(() => world.createBody({shape, position: [0, 6, 0]}), error => error.code === 'INVALID_PAYLOAD', label);
    refused({kind: 'box', halfExtents: [1001, 1, 1]}, 'a dynamic box half extent above 1 km');
    refused({kind: 'hull', points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1500]}, 'a dynamic hull point 1.5 km from the body origin');
    refused({kind: 'compound', shapes: [{shape: {kind: 'box', halfExtents: [2000, 1, 1]}}]}, 'a dynamic compound box child above 1 km');
    refused({kind: 'compound', shapes: [{shape: {kind: 'box', halfExtents: [1, 1, 1]}, position: [1200, 0, 0]}]}, 'a dynamic compound box child 1.2 km from the body origin');
    assert.equal(world.launchProjectileBody(0, 6, 0, 0, 0, 0, 5000), null, 'the projectile export');
    // Static and kinematic bodies of any size are fine: a 20 km road and a 5 km kinematic slab, with boxes landing on them.
    const road = world.createBody({shape: {kind: 'box', halfExtents: [20000, 1, 20000]}, type: 'static', position: [0, -1, 0]});
    world.createBody({shape: {kind: 'box', halfExtents: [5000, 1, 5000]}, type: 'kinematic', position: [0, 40, 0]});
    const boxes = [0, 1, 2].map(i => world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [i * 2, 3 + 40 * (i % 2), 0], linearVelocity: [0, -10, 0]}));
    // Making a large body dynamic is refused for the same reason.
    assert.throws(() => world.setBodyType(road, 'dynamic'), error => error.code === 'INVALID_PAYLOAD', 'a 20 km slab cannot become dynamic');
    // At the limit: a 1 km dynamic cube landing at 200 m/s, deep in the ground, steps normally.
    const big = world.createBody({shape: {kind: 'box', halfExtents: [1000, 1000, 1000]}, position: [0, 6, 3000], linearVelocity: [0, -200, 0]});
    for (let i = 0; i < 30; i++) world.step(1 / 60, 4);
    for (const body of [big, ...boxes]) { const state = world.bodyState(body); assert.ok(finite([...state.position, ...state.linearVelocity]), 'finite'); }
    // Spheres and capsules have no polytope contact and are not limited by the bridge.
    assert.ok(world.createBody({shape: {kind: 'sphere', radius: 5000}, position: [0, 9000, 0]}));
  } finally { world.destroy(); }
});

test('ND-2: joints that contradict each other no longer poison the world: the diverged bodies are contained, reported, and stay finite', () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: true});
    const box = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0, 2, 0]});
    const wheel = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 0.3, 3]});
    const bystander = world.createBody({shape: {kind: 'box', halfExtents: [0.4, 0.4, 0.4]}, position: [-6, 0.4, 0]});
    world.createJoint({type: 'revolute', bodyA: null, bodyB: box, frameA: {position: [4, 2, 0]}});
    world.createJoint({type: 'wheel', bodyA: box, bodyB: wheel, frameA: {position: [0, -0.5, 0]}});
    world.createJoint({type: 'wheel', bodyA: box, bodyB: null, frameA: {position: [0, 0.5, 0]}, frameB: {position: [0, -0.5, 0]}, limits: {lower: -0.2, upper: 0.2}, spring: {hertz: 4, dampingRatio: 0.7}, motor: {speed: 3, maxForce: 20}});
    const before = world.containedTotal(), events = [];
    for (let step = 0; step < 60; step++) {
      world.step(1 / 60, 4);
      events.push(...world.collectEvents().events.filter(event => event.kind === 'body-contained'));
      for (const body of [box, wheel, bystander]) {
        const state = world.bodyState(body);
        assert.ok(finite([...state.position, ...state.rotation, ...state.linearVelocity, ...state.angularVelocity]), `finite after step ${step + 1}`);
      }
    }
    assert.ok(events.length > 0 && world.containedTotal() - before === events.length, `each containment is an event (${events.length}) and counted`);
    assert.ok(events.every(event => event.bodyA !== null && (event.bodyA.token === box.token || event.bodyA.token === wheel.token)), 'only the jointed bodies diverge');
    // Each was past a bound: not finite, or faster than the smaller one, ten times Box3D's spin clamp of a quarter turn a step (471 rad/s at 60 Hz).
    assert.ok(events.every(event => !(event.speed <= 10 * 0.25 * Math.PI * 60)), 'each was not finite or past a bound');
    const still = world.bodyState(bystander);
    assert.ok(Math.abs(still.position[0] + 6) < 1e-3 && Math.abs(still.position[1] - 0.4) < 0.01, 'a body that touches nothing of it rests where it was');
  } finally { world.destroy(); }
});

test('ND-2: containment never fires in the example scenes or in the 800-scene catalog', async () => {
  const sceneModule = await import('../dist/scene.js');
  const kit = await import('../dist/index.js');
  const lists = [sceneModule.EXAMPLE_SCENES, sceneModule.RIGID_CORE_EXAMPLE_SCENES, sceneModule.COUPLED_EXAMPLE_SCENES];
  let scenes = 0;
  for (const list of lists) for (const [name, make] of Object.entries(list)) {
    const scene = make(), world = await kit.createWorld(sceneModule.sceneWorldOptions(sceneModule.normalizeScene(scene)));
    try {
      const loaded = sceneModule.loadScene(world, scene), steps = Math.min(600, Math.round(3 / world.loop.step));
      for (let i = 0; i < steps; i++) loaded.simulation.step();
      assert.equal(world.native.containedTotal(), 0, `${name}: no body was contained in ${steps} steps`);
      scenes++;
    } finally { world.dispose(); }
  }
  assert.ok(scenes >= 26, `every example ran (${scenes})`);
  const world = pool.createWorld();
  try {
    for (let id = 0; id < 800; id++) {
      world.createScene({id}, 1, 7 + id);
      for (let i = 0; i < 90; i++) world.step(1 / 60, 4);
    }
    assert.equal(world.containedTotal(), 0, 'no body was contained in 90 steps of any of the 800 recipes');
  } finally { world.destroy(); }
});

test('ND-3: restoring a checkpoint this world wrote, after a destroy, gives every handle back its own body', async () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: true});
    const make = x => world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [x, 1, 0], type: 'static'});
    const a = make(1), b = make(2), c = make(3);
    world.step(1 / 60, 4);
    const saved = world.checkpoint();
    world.destroyBody(a);            // the last row (c) moves into a's row
    const d = make(4);               // a body created after the checkpoint
    world.restoreCheckpoint(saved);
    assert.notEqual(world.bodyIndex(a), null, 'the body destroyed after the checkpoint is alive again under its handle');
    assert.deepEqual([a, b, c].map(body => world.bodyState(body).position[0]), [1, 2, 3], 'each handle names its own body');
    assert.equal(world.bodyIndex(d), null, 'the body created after the checkpoint is gone');
    // Its handle stays dead also once its slot is used again, and new bodies get handles of their own.
    const e = make(5), f = make(6);
    assert.equal(world.bodyIndex(d), null); assert.ok(e.token !== d.token && f.token !== d.token);
    assert.deepEqual([e, f].map(body => world.bodyState(body).position[0]), [5, 6]);
    // A copy of the bytes (read back from a file, say) is recognised as this world's own checkpoint.
    world.destroyBody(b);
    world.restoreCheckpoint(new Uint8Array([...saved]));
    assert.equal(world.bodyState(b).position[0], 2);
    // After a reset, the same bytes are a checkpoint from elsewhere: the world built the same way keeps its own handles.
    world.resetWorld({ground: true});
    const a2 = make(1), b2 = make(2), c2 = make(3);
    world.restoreCheckpoint(saved);
    assert.deepEqual([a2, b2, c2].map(body => world.bodyState(body).position[0]), [1, 2, 3], 'a world rebuilt the same way keeps its handles');
  } finally { world.destroy(); }
  // The same through the kit's PhysicsWorld checkpoint.
  const kit = await import('../dist/index.js');
  const physics = await kit.createWorld({gravity: [0, -9.81, 0], ground: true});
  try {
    const bodies = [1, 2, 3].map(x => physics.createBody({shape: {kind: 'box', halfExtents: [0.2, 0.2, 0.2]}, position: [x, 0.2, 0]}));
    for (let i = 0; i < 10; i++) physics.step();
    const bytes = physics.checkpoint(), hash = physics.exactHash();
    physics.destroyBody(bodies[0]);
    for (let i = 0; i < 10; i++) physics.step();
    physics.restoreCheckpoint(bytes);
    assert.equal(physics.exactHash(), hash);
    assert.deepEqual(bodies.map(body => Math.round(physics.getState(body).position[0])), [1, 2, 3]);
  } finally { physics.dispose(); }
});

test('ND-4: an overlap query counts bodies, so a compound counts once in hits, totals and overflow', () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: false});
    const compound = world.createBody({shape: {kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: 0.2}, position: [0.3, 0, 0]}, {shape: {kind: 'sphere', radius: 0.2}, position: [-0.3, 0, 0]}, {shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}}]}, position: [0, 2, 0], type: 'static'});
    const [one] = world.queryBatch([{kind: 'sphere-overlap', origin: [0, 2, 0], radius: 3, limit: 1}]);
    assert.equal(one.hits.length, 1);
    assert.deepEqual({totalHits: one.totalHits, overflow: one.overflow}, {totalHits: 1, overflow: false}, 'one body overlaps, so nothing overflowed a limit of 1');
    const sphere = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [1, 2, 0], type: 'static'});
    for (const query of [{kind: 'sphere-overlap', radius: 3}, {kind: 'box-overlap', halfExtents: [3, 3, 3]}, {kind: 'aabb-candidates', halfExtents: [3, 3, 3]}, {kind: 'capsule-overlap', radius: 1.5, halfLength: 1}]) {
      const [all] = world.queryBatch([{...query, origin: [0, 2, 0], limit: 8}]), [cut] = world.queryBatch([{...query, origin: [0, 2, 0], limit: 1}]);
      assert.deepEqual(all.hits.map(hit => hit.body.token).sort(), [compound.token, sphere.token].sort(), `${query.kind}: each body once`);
      assert.deepEqual([all.totalHits, all.overflow, cut.hits.length, cut.totalHits, cut.overflow], [2, false, 1, 2, true], `${query.kind}: totals count bodies`);
    }
    // Casts still report each shape they reach: their hits differ in point and fraction.
    const [ray] = world.queryBatch([{kind: 'ray', origin: [-3, 2, 0], translation: [6, 0, 0], limit: 8}]);
    assert.ok(ray.hits.length >= 3, `a ray through the compound and the sphere reaches its shapes (${ray.hits.length})`);
  } finally { world.destroy(); }
});
