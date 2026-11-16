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

test('hull cache and capacity: a hull pile gives the same state whether its hulls come from the cache or not, and whatever capacity was reserved', async () => {
  let a = 3; const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const cloud = () => { const p = []; for (let i = 0; i < 14; i++) { const u = 2 * rnd() - 1, f = 2 * Math.PI * rnd(), s = Math.sqrt(1 - u * u), r = 0.25 + 0.1 * rnd(); p.push(r * s * Math.cos(f), r * u, r * s * Math.sin(f)); } return p; };
  const shapes = Array.from({length: 6}, cloud), others = Array.from({length: 40}, cloud);
  const pile = async ({capacity, warm}) => {
    const world = await K.createWorld({step: 1 / 60, subSteps: 4, gravity: [0, -9.81, 0], ground: true, ...(capacity ? {capacity} : {})});
    try {
      // warm: fill the bridge's 32-entry hull cache with other shapes, then reset the world (the cache belongs to the
      // native context and survives), so that every hull of the pile is computed again. Without warm the pile's own
      // shapes are created first and then reset away, so that its hulls come from the cache. Both worlds are reset once.
      for (const [i, points] of (warm ? others : shapes).entries()) world.createBody({shape: {kind: 'hull', points}, position: [100 + 2 * i, 5, 0]});
      world.reset({gravity: [0, -9.81, 0], ground: true});
      const bodies = [];
      for (let i = 0; i < 300; i++) bodies.push(world.createBody({shape: {kind: 'hull', points: shapes[i % shapes.length]}, position: [(i % 10) * 0.8 - 4, 0.5 + Math.floor(i / 100) * 0.8, (Math.floor(i / 10) % 10) * 0.8 - 4]}));
      const mass = world.getState(bodies[7]).mass;
      for (let i = 0; i < 120; i++) world.step();
      return {hash: world.exactHash(), replay: world.replayHash(), mass};
    } finally { world.dispose(); }
  };
  const plain = await pile({}), warmed = await pile({warm: true}), large = await pile({capacity: 20000}), both = await pile({capacity: 65536, warm: true});
  assert.deepEqual(warmed, plain, 'hulls computed again or taken from the cache: the same pile');
  assert.deepEqual(large, plain, 'a reserved capacity of 20,000 bodies (passed to Box3D as its world capacity) changes nothing');
  assert.deepEqual(both, plain, 'nor does 65,536 with a cold cache');
});

test('jointStiffness and contactStiffness: match-substeps sets the caps of Box3D, the defaults change nothing, and the static error falls as 1 / f^2', async t => {
  // At 4 sub-steps of 1/60 s the caps are Box3D's defaults: the same simulation, hash for hash, with the options or without.
  const plainChain = await S.chainStretch(K, {subSteps: 4}), matchChain = await S.chainStretch(K, {subSteps: 4, options: {jointStiffness: 'match-substeps'}});
  assert.equal(matchChain.stretch, plainChain.stretch); assert.deepEqual(matchChain.defaults, {hertz: 60, dampingRatio: 2});
  const plainStack = await S.heavyStack(K, {subSteps: 4}), matchStack = await S.heavyStack(K, {subSteps: 4, options: {contactStiffness: 'match-substeps', jointStiffness: {hertz: 60}}});
  assert.equal(matchStack.deepest, plainStack.deepest); assert.equal(plainStack.defaults, null);
  // At 8 and 16 sub-steps: a quarter (joints) and an eighth (contacts) of the sub-step rate.
  const chain8 = await S.chainStretch(K, {subSteps: 8}), match8 = await S.chainStretch(K, {subSteps: 8, options: {jointStiffness: 'match-substeps'}});
  const match16 = await S.chainStretch(K, {subSteps: 16, options: {jointStiffness: 'match-substeps'}});
  assert.equal(match8.jointHertz, 120); assert.equal(match16.jointHertz, 240); assert.equal(chain8.jointHertz, 60);
  const stack8 = await S.heavyStack(K, {subSteps: 8}), stackMatch8 = await S.heavyStack(K, {subSteps: 8, options: {contactStiffness: 'match-substeps'}});
  const stack16 = await S.heavyStack(K, {subSteps: 16}), stackMatch16 = await S.heavyStack(K, {subSteps: 16, options: {contactStiffness: 'match-substeps'}});
  assert.equal(stackMatch8.settings.contactHertz, 60); assert.equal(stackMatch16.settings.contactHertz, 120); assert.equal(stack8.settings.contactHertz, 30);
  t.diagnostic(`chain stretch at 8 sub-steps ${chain8.stretch} -> ${match8.stretch} (1/f^2 predicts ${chain8.stretch / 4}); at 16 ${match16.stretch}; stack overlap at 8 ${stack8.deepest} -> ${stackMatch8.deepest} (predicted ${stack8.deepest / 4}), at 16 ${stack16.deepest} -> ${stackMatch16.deepest} (predicted ${stack16.deepest / 16})`);
  // A soft constraint holds a static load with an error proportional to 1 / f^2.
  within(match8.stretch, chain8.stretch / 4, 0.05, 'chain stretch at twice the joint frequency');
  within(stackMatch8.deepest, stack8.deepest / 4, 0.05, 'contact overlap at twice the contact frequency');
  within(stackMatch16.deepest, stack16.deepest / 16, 0.05, 'contact overlap at four times the contact frequency');
  assert.ok(match16.stretch < match8.stretch / 2, 'still stiffer at 16 sub-steps');
});

test('jointStiffness and contactStiffness: checked, recorded so that a replay in a plain world matches, and a joint keeps its own stiffness', async () => {
  for (const bad of [{jointStiffness: 'stiff'}, {jointStiffness: {hertz: 0}}, {jointStiffness: {dampingRatio: 1}}, {jointStiffness: {hertz: 60, pushSpeed: 1}}, {contactStiffness: {hertz: -1}}, {contactStiffness: {hertz: 30, wobble: 1}}]) {
    await assert.rejects(K.createWorld(bad), error => error.code === 'INVALID_PAYLOAD', JSON.stringify(bad));
  }
  const options = {step: 1 / 60, subSteps: 8, gravity: [0, -S.G, 0], ground: true, jointStiffness: 'match-substeps', contactStiffness: 'match-substeps'};
  const world = await K.createWorld(options), plain = await K.createWorld({step: 1 / 60, subSteps: 8, gravity: [0, -S.G, 0], ground: true});
  try {
    world.startRecording({world: {ground: true, gravity: [0, -S.G, 0]}});
    const a = world.createBody({shape: {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, position: [0, 2, 0]});
    const b = world.createBody({shape: {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, position: [0, 1, 0], density: 5000});
    const j1 = world.createJoint({type: 'revolute', bodyA: null, bodyB: a, frameA: {position: [0, 2.5, 0]}, frameB: {position: [0, 0.5, 0]}});
    const j2 = world.createJoint({type: 'distance', bodyA: a, bodyB: b, length: 1, stiffness: {hertz: 30, dampingRatio: 1}});
    assert.equal(world.getJointDetails(j1).stiffness.hertz, 120, 'the default'); assert.equal(world.getJointDetails(j2).stiffness.hertz, 30, 'a joint\'s own stiffness wins');
    for (let i = 0; i < 90; i++) world.step();
    const log = world.stopRecording();
    assert.ok(log.commands.some(command => command.method === 'configure'), 'the contact settings are in the log');
    assert.equal(plain.replay(log), true, 'a world created without the options replays it exactly');
    assert.equal(plain.exactHash(), log.finalHash);
    assert.equal(plain.settings().contactHertz, 60);
  } finally { world.dispose(); plain.dispose(); }
});
