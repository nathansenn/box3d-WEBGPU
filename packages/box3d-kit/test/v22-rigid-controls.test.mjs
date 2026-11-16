// World controls and introspection of the rigid core: sleeping, restitution and hit thresholds, the speed limit,
// the contact push-out speed, motion locks, Box3D's explosion, the step profile and counters, contact statistics and
// debug-draw lines. The set-ups are in rigid-core-scenarios.mjs and docs/VALIDATION.md has the same cases as rows.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as K from 'box3d-webgpu-kit';
import * as S from './rigid-core-scenarios.mjs';

const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);

test("explosion: a sphere takes P pi r^2 / m, half of it half way across the falloff, nothing beyond; a box takes P times its facing area", async t => {
  const r = await S.explosion(K);
  t.diagnostic(`sphere ${r.near} m/s (exact ${r.exactNear}); in the falloff ${r.mid} (exact ${r.exactMid}); box ${r.box} (exact ${r.exactBox})`);
  within(r.near, r.exactNear, 1e-5, 'sphere inside the radius'); within(r.mid, r.exactMid, 1e-5, 'sphere half way across the falloff'); within(r.box, r.exactBox, 1e-5, 'box face-on');
  assert.equal(r.far, 0, 'nothing beyond radius + falloff'); assert.equal(r.masked, 0, 'the mask leaves other categories alone');
  assert.ok(r.sideways < 1e-7, 'the push is radial');
});

test('world settings: sleeping, restitution and hit thresholds, the speed limit and motion locks do what they say', async t => {
  const r = await S.worldSettings(K);
  t.diagnostic(`asleep after ${r.asleepAfter} s; bounce ${r.bounce} m (e^2 h = ${r.exactBounce}); hit at ${r.hitSpeed} m/s (sqrt(2 g h) = ${r.exactHitSpeed}); speed limit ${r.limited} m/s`);
  // Box3D's defaults; the recycle distance is 10 linear slops, computed in float32.
  const {contactRecycleDistance, ...rest} = r.defaults;
  assert.deepEqual(rest, {sleeping: true, continuous: true, speculative: true, warmStarting: true, restitutionThreshold: 1, hitEventThreshold: 1, contactHertz: 30, contactDampingRatio: 10,
    contactPushSpeed: 3, maximumLinearSpeed: 400});
  near(contactRecycleDistance, 0.05, 1e-7, 'contact recycle distance');
  assert.ok(r.asleepAfter > 0.3 && r.asleepAfter < 1.5, `a resting box falls asleep (${r.asleepAfter} s)`); assert.equal(r.awakeWhenAsleep, 0);
  assert.equal(r.awakeWithSleepingOff, true, 'sleeping off: it wakes and stays awake');
  assert.equal(r.awakeWithBodySleepOff, true, 'setSleep(enabled: false): this body stays awake'); assert.equal(r.asleepAgain, true);
  // Landing at 1.98 m/s, above the default threshold of 1 m/s: a bounce of e^2 h and a hit event at the landing speed.
  within(r.bounce, r.exactBounce, 0.05, 'bounce height'); within(r.hitSpeed, r.exactHitSpeed, 0.02, 'hit speed');
  // The same drop with both thresholds at 3 m/s: no bounce, no event.
  assert.ok(r.bounceBelow < 1e-4 && r.hitsBelow === 0);
  // Landing at 0.77 m/s: nothing at the default thresholds, a bounce and an event with them at 0.5 m/s.
  assert.ok(r.slowDefaultBounce < 1e-4 && r.slowDefaultHits === 0);
  assert.ok(r.slowBounce > 0.6 * r.exactSlowBounce && r.slowBounce < 1.1 * r.exactSlowBounce && r.slowHits === 1, `slow bounce ${r.slowBounce} of ${r.exactSlowBounce}`);
  within(r.limited, 20, 1e-5, 'speed limit');
  assert.ok(r.lockedDrop === 0 && r.lockedSpin === 0 && r.lockedSlide > 0.1, 'locked in y and in rotation, free in x');
  assert.deepEqual(r.flags.locks, {linearX: false, linearY: true, linearZ: false, angularX: true, angularY: true, angularZ: true});
  assert.equal(r.settings.maximumLinearSpeed, 20); assert.equal(r.settings.restitutionThreshold, 0.5);
});

test('contact push-out speed: an embedded ball leaves the ground at the set speed and no faster', async t => {
  const rows = await S.pushOutSpeed(K);
  for (const r of rows) {
    t.diagnostic(`setting ${r.speed} m/s: fastest ${r.fastest.toFixed(4)} m/s, out after ${r.outAt.toFixed(3)} s (0.29 m at the set speed takes ${r.shortest.toFixed(3)} s)`);
    assert.ok(r.fastest <= r.speed * 1.001, `never faster than the setting (${r.fastest})`);
    within(r.fastest, r.speed, 0.01, 'and it reaches the setting');
    assert.ok(r.outAt >= r.shortest && r.outAt < r.shortest + 0.1);
    near(r.rest, 0.5, 1e-3, 'it ends resting on the ground');
  }
});

test('profile, counters, contact statistics and debug lines of a known scene are exact', async t => {
  const r = await S.introspection(K);
  const c = r.profile.counters, ms = r.profile.milliseconds;
  t.diagnostic(`48 boxes in 16 stacks: ${c.contacts} contacts, ${c.islands} islands, ${r.stats.points} contact points, deepest overlap ${(r.stats.deepestPenetration * 1000).toFixed(2)} mm, normal force ${r.normalForce.toFixed(1)} N (exact ${r.exactNormalForce.toFixed(1)})`);
  t.diagnostic(`last step ${ms.step.toFixed(3)} ms: collide ${ms.collide.toFixed(3)}, solve ${ms.solve.toFixed(3)} (constraints ${ms.constraints.toFixed(3)})`);
  // 48 boxes, the hinged ball, the ground and the hidden anchor of the world-side hinge.
  assert.deepEqual([c.bodies, c.shapes, c.joints, c.contacts, c.islands, c.awakeBodies], [51, 50, 1, 48, 17, 49]);
  assert.equal(r.awake, 49);
  assert.deepEqual([r.stats.pairs, r.stats.points], [48, 192], '16 ground contacts and 32 between boxes, four points each');
  assert.ok(r.stats.deepestPenetration < 2 * S.LINEAR_SLOP && r.stats.meanPenetration <= r.stats.deepestPenetration);
  // Each stack carries 3 + 2 + 1 box weights on its three contacts.
  within(r.normalForce, r.exactNormalForce, 1e-3, 'total normal force');
  within(r.stats.largestNormalForce, 3 * r.mass * S.G / 4, 0.05, 'the largest point force is a quarter of three box weights');
  for (const [name, value] of Object.entries(ms)) assert.ok(Number.isFinite(value) && value >= 0, `${name} time`);
  assert.ok(ms.step >= ms.solve && ms.solve >= ms.constraints, 'stage times nest');
  // Debug lines: 12 edges per shape bound, 3 lines per contact point, as vertex pairs.
  assert.equal(r.boundsVertices, 50 * 24); assert.equal(r.contactVertices, 192 * 6); assert.equal(r.regionVertices, 4 * 24, 'the region holds one stack and the ground');
  assert.ok(r.jointVertices > 0 && r.jointVertices % 2 === 0 && r.allVertices > r.boundsVertices + r.contactVertices && !r.truncated);
  assert.ok(r.finite && r.colours, 'positions are finite and colours are in 0..1');
  assert.ok(r.low > -0.05 && r.high < 1.05, 'contact marks lie on the three contact levels');
  assert.ok(r.unchanged, 'reading profile, statistics and debug lines does not change the world');
});

test('settings and flags refuse bad values and are recorded for replay', async () => {
  const world = await S.newWorld(K, {ground: true}), twin = await S.newWorld(K);
  try {
    for (const bad of [{restitutionThreshold: -1}, {contactHertz: NaN}, {maximumLinearSpeed: 0}, {sleeping: 'yes'}, {gravity: 1}]) assert.throws(() => world.configure(bad), e => e.code === 'INVALID_PAYLOAD', JSON.stringify(bad));
    assert.throws(() => world.explodeArea({center: [0, 0, 0], radius: -1, impulsePerArea: 1}), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.debugLines({jointScale: -1}), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.debugLines({region: {min: [1, 0, 0], max: [0, 1, 1]}}), e => e.code === 'INVALID_PAYLOAD');
    const body = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [0, 1, 0]});
    assert.throws(() => world.setSleep(body, {threshold: -1}), e => e.code === 'INVALID_PAYLOAD');
    world.destroyBody(body);
    assert.throws(() => world.setBullet(body, true), e => e.code === 'STALE_BODY');
    assert.throws(() => world.getBodyFlags(body), e => e.code === 'STALE_BODY');

    world.startRecording({world: {ground: true, gravity: [0, -S.G, 0]}});
    world.configure({restitutionThreshold: 0.2, contactPushSpeed: 1, sleeping: false});
    const a = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [0, 2, 0], restitution: 0.6});
    const b = world.createBody({shape: {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, position: [1.5, 0.3, 0]});
    world.setBullet(a, true); world.setSleep(b, {enabled: false}); world.setMotionLocks(b, {angularY: true});
    for (let i = 0; i < 240; i++) { if (i === 120) world.explodeArea({center: [0.7, 0, 0], radius: 2, falloff: 1, impulsePerArea: 300}); world.step(); }
    const log = JSON.parse(JSON.stringify(world.stopRecording()));
    const calls = log.commands.filter(command => command.op === 'call').map(command => command.method);
    for (const method of ['configure', 'setBullet', 'setSleep', 'setMotionLocks', 'explodeArea']) assert.ok(calls.includes(method), `${method} is in the log`);
    assert.ok(twin.replayDetailed(log).matches, 'the session replays bit for bit');
    assert.equal(twin.settings().contactPushSpeed, 1, 'and leaves the same settings');
  } finally { world.dispose(); twin.dispose(); }
});
