// Scene queries of the rigid core: rays, sweeps and overlaps against closed forms, the batched ray call, capsule
// queries, filters, and the same calls through the worker. Every number is measured on the real engine through the
// built kit; the set-ups are in rigid-core-scenarios.mjs and docs/VALIDATION.md has the same cases as registry rows.
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import * as index from 'box3d-webgpu-kit';
import {connectWorld} from 'box3d-webgpu-kit/worker';
import * as S from './rigid-core-scenarios.mjs';

const K = index;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);

test('rays against a sphere, an oriented box and an oriented capsule: hit points and normals match the closed forms', async t => {
  for (const kind of ['sphere', 'box', 'capsule']) {
    const r = await S.rayAccuracy(K, kind);
    t.diagnostic(`${kind}: ${r.compared} hits compared of ${r.count} rays (${r.skipped} grazing rays left out): point error ${r.pointError.toExponential(2)} m, normal error ${r.normalError.toExponential(2)}`);
    assert.equal(r.disagreements, 0, `${kind}: the engine and the closed form agree on which rays hit`);
    assert.ok(r.compared > 400, `${kind}: enough rays hit (${r.compared})`);
    assert.ok(r.pointError <= 5e-5, `${kind}: hit point within 0.05 mm (got ${r.pointError})`);
    assert.ok(r.normalError <= 1e-4, `${kind}: unit normal within 1e-4 (got ${r.normalError})`);
  }
});

test('sweeps: at the reported time of impact a flat shape is one linear slop short and a rounded one at most one slop inside', async t => {
  const r = await S.sweepAccuracy(K);
  for (const key of ['sphereSphere', 'capsuleSphere', 'sphereFace', 'boxFace', 'capsuleFace']) t.diagnostic(`${key}: gap ${r[key].min.toExponential(3)} .. ${r[key].max.toExponential(3)} m over ${r[key].count} sweeps`);
  assert.equal(r.misses, 0, 'every sweep hits');
  // A box has no radius: Box3D stops it one linear slop (5 mm) before the surface.
  near(r.boxFace.min, S.LINEAR_SLOP, 2e-4, 'box onto a face, earliest'); near(r.boxFace.max, S.LINEAR_SLOP, 2e-4, 'box onto a face, latest');
  // A shape with a radius is allowed to encroach by the linear slop: exactly that onto a face, up to that onto a curve.
  for (const key of ['sphereFace', 'capsuleFace']) { near(r[key].min, -S.LINEAR_SLOP, 2e-4, `${key}, deepest`); near(r[key].max, -S.LINEAR_SLOP, 2e-4, `${key}, shallowest`); }
  for (const key of ['sphereSphere', 'capsuleSphere']) {
    assert.ok(r[key].min >= -S.LINEAR_SLOP - 2e-4, `${key}: never more than one slop inside (${r[key].min})`);
    assert.ok(r[key].max <= 0, `${key}: never reported before touching (${r[key].max})`);
  }
});

test('overlaps: sphere, box, capsule and broad-phase counts on a lattice equal the counts of lattice points, with and without a mask', async t => {
  const r = await S.overlapCounts(K);
  t.diagnostic(`sphere ${r.sphere}/${r.sphereExact}, box ${r.box}/${r.boxExact}, capsule ${r.capsule}/${r.capsuleExact}, masked ${r.masked}/${r.maskedExact}, bounds ${r.aabb}/${r.aabbExact}; closest call ${(r.margin * 1000).toFixed(1)} mm`);
  assert.ok(r.margin > 2e-3, `no lattice sphere is within 2 mm of a query boundary (${r.margin})`);
  assert.equal(r.sphere, r.sphereExact);
  assert.equal(r.box, r.boxExact);
  assert.equal(r.capsule, r.capsuleExact);
  assert.equal(r.masked, r.maskedExact);
  assert.equal(r.aabb, r.aabbExact);
  assert.ok(r.sphereExact > 40 && r.boxExact > 30 && r.capsuleExact > 20 && r.maskedExact > 10 && r.maskedExact < r.sphereExact);
});

test('raycastBatch: 4,096 rays in one call agree bit for bit with 4,096 single raycasts, on every shape kind', async t => {
  const r = await S.batchAgreement(K);
  t.diagnostic(`${r.hits} of ${r.count} rays hit (${r.triangleHits} on the mesh or the height field); one batch call ${r.batchMs.toFixed(2)} ms, ${r.count} single calls ${r.singleMs.toFixed(2)} ms`);
  assert.equal(r.mismatches, 0);
  assert.equal(r.hitCount, r.hits);
  assert.ok(r.hits > 500 && r.hits < r.count && r.triangleHits > 50, `hits ${r.hits}, on triangles ${r.triangleHits}`);
});

test('query filters, limits and errors: body kinds, ignored bodies, all hits in order, misses, bad input', async () => {
  const world = await S.newWorld(K);
  try {
    const wall = world.createBody({shape: {kind: 'box', halfExtents: [0.1, 1, 1]}, type: 'static', position: [2, 0, 0]});
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.5}, position: [4, 0, 0], gravityScale: 0});
    const far = world.createBody({shape: {kind: 'box', halfExtents: [0.1, 1, 1]}, type: 'static', position: [6, 0, 0]});
    const ray = [0, 0, 0, 10, 0, 0];
    const all = world.raycastAll([0, 0, 0], [10, 0, 0]);
    assert.deepEqual(all.map(hit => hit.body.token), [wall.token, ball.token, far.token]);
    near(all[0].fraction, 0.19, 1e-6, 'wall'); near(all[1].fraction, 0.35, 1e-6, 'ball'); near(all[2].fraction, 0.59, 1e-6, 'far wall');
    assert.equal(world.raycastBatch(ray).bodies[0].token, wall.token);
    assert.equal(world.raycastBatch(ray, {bodies: 'dynamic'}).bodies[0].token, ball.token);
    assert.equal(world.raycastBatch(ray, {ignoreBody: wall}).bodies[0].token, ball.token);
    assert.equal(world.raycastBatch(ray, {bodies: 'static', ignoreBody: wall}).bodies[0].token, far.token);
    assert.equal(world.raycastBatch(ray, {bodies: 'none'}).hitCount, 0);
    assert.equal(world.raycastBatch(ray, {maskBits: 0n}).hitCount, 0);
    // Capsule queries take the same filters.
    assert.equal(world.capsuleCast([0, 0, 0], 0.2, 0.3, [10, 0, 0]).body.token, wall.token);
    assert.equal(world.capsuleCast([0, 0, 0], 0.2, 0.3, [10, 0, 0], {filter: {bodies: 'dynamic'}}).body.token, ball.token);
    assert.deepEqual(world.overlapCapsule([4, 0, 0], 0.2, 0.3).map(b => b.token), [ball.token]);
    assert.deepEqual(world.overlapCapsule([4, 3, 0], 0.2, 0.3), []);
    // A miss: fraction -1, null body, zeros.
    const miss = world.raycastBatch([0, 5, 0, 10, 0, 0, ...ray]);
    assert.equal(miss.count, 2); assert.equal(miss.hitCount, 1); assert.equal(miss.fractions[0], -1); assert.equal(miss.bodies[0], null); assert.equal(miss.triangles[0], -1);
    assert.equal(world.raycastBatch([]).count, 0);
    // A zero-length ray hits nothing; a destroyed ignored body is refused; malformed input is refused before anything runs.
    assert.equal(world.raycastBatch([0, 0, 0, 0, 0, 0]).hitCount, 0);
    assert.throws(() => world.raycastBatch([0, 0, 0, 1, 0]), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.raycastBatch([0, 0, 0, NaN, 0, 0]), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.raycastBatch(ray, {nope: 1}), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.capsuleCast([0, 0, 0], 0.2, 0, [1, 0, 0]), e => e.code === 'INVALID_PAYLOAD');
    world.destroyBody(far);
    assert.throws(() => world.raycastBatch(ray, {ignoreBody: far}), e => e.code === 'STALE_BODY');
    // Queries read the world only: the state hash is the same before and after.
    const before = world.exactHash();
    world.raycastBatch(ray); world.capsuleCast([0, 0, 0], 0.2, 0.3, [10, 0, 0]); world.overlapCapsule([4, 0, 0], 0.2, 0.3);
    world.step();
    const stepped = world.exactHash();
    const twin = await S.newWorld(K);
    try {
      twin.createBody({shape: {kind: 'box', halfExtents: [0.1, 1, 1]}, type: 'static', position: [2, 0, 0]});
      twin.createBody({shape: {kind: 'sphere', radius: 0.5}, position: [4, 0, 0], gravityScale: 0});
      assert.equal(twin.exactHash(), before);
      twin.step();
      assert.equal(twin.exactHash(), stepped, 'a world that was queried steps exactly like one that was not');
    } finally { twin.dispose(); }
  } finally { world.dispose(); }
});

test('worker: batched rays, capsule queries and all-hits casts give the main-thread answers', async () => {
  const local = await S.newWorld(K, {ground: true});
  const remote = await connectWorld(new Worker(fileURLToPath(new URL('./fixtures/physics.worker.mjs', import.meta.url))), {step: S.DT, subSteps: S.SUB, gravity: [0, -S.G, 0], ground: true, sharedMemory: false});
  try {
    const bodies = [{shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, type: 'static', position: [0, 0.5, 0]}, {shape: {kind: 'sphere', radius: 0.4}, type: 'static', position: [2, 1, 0]}];
    for (const body of bodies) { local.createBody(body); await remote.createBody(body); }
    const rays = [0, 5, 0, 0, -10, 0, 2, 5, 0, 0, -10, 0, 7, 5, 0, 0, -10, 0, -3, 0.5, 0, 10, 0, 0];
    const a = local.raycastBatch(rays), b = await remote.raycastBatch(rays);
    assert.deepEqual([...b.fractions], [...a.fractions]);
    assert.deepEqual([...b.points], [...a.points]);
    assert.deepEqual([...b.normals], [...a.normals]);
    assert.deepEqual(b.bodies.map(body => body?.token ?? null), a.bodies.map(body => body?.token ?? null));
    assert.equal(b.hitCount, 4);
    const ca = local.capsuleCast([2, 5, 0], 0.3, 0.5, [0, -10, 0]), cb = await remote.capsuleCast([2, 5, 0], 0.3, 0.5, [0, -10, 0]);
    assert.equal(cb.fraction, ca.fraction); assert.deepEqual(cb.point, [...ca.point]);
    assert.equal((await remote.overlapCapsule([0, 0.5, 0], 0.3, 0.5)).length, local.overlapCapsule([0, 0.5, 0], 0.3, 0.5).length);
    assert.deepEqual((await remote.raycastAll([-3, 0.5, 0], [10, 0, 0])).map(hit => hit.fraction), local.raycastAll([-3, 0.5, 0], [10, 0, 0]).map(hit => hit.fraction));
  } finally { local.dispose(); await remote.dispose(); }
});
