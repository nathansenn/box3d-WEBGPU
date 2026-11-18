import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld, capabilities} from 'box3d-webgpu-kit';
import {TriggerSet, CharacterController, NATIVE_GRAVITY, MAX_QUERY_HITS} from 'box3d-webgpu-kit/gameplay';

const settle = (world, ticks = 120) => { for (let i = 0; i < ticks; i++) world.step(); };

test('triggers report enter and exit once, including bodies destroyed inside', async () => {
  const world = await createWorld();
  try {
    const zones = new TriggerSet(world, {attach: true});
    const pit = zones.add({shape: {kind: 'box', center: [0, 0.5, 0], halfExtents: [1, 0.5, 1]}, data: 'pit'});
    const orb = zones.add({shape: {kind: 'sphere', center: [6, 1, 0], radius: 1.5}, data: 'orb'});
    const log = [];
    zones.on(e => log.push(`${e.type}:${e.trigger.data}:${e.alive}`));
    const a = world.spawnBox({position: [0, 4, 0], halfSize: 0.3});
    const b = world.spawnBox({position: [6, 4, 0], halfSize: 0.3});
    settle(world);
    assert.deepEqual(log.sort(), ['enter:orb:true', 'enter:pit:true']);
    assert.deepEqual(zones.bodiesIn(pit).map(x => x.token), [a.token]);
    log.length = 0;
    zones.setShape(pit, {kind: 'box', center: [20, 0.5, 0], halfExtents: [1, 0.5, 1]});
    world.destroyBody(b);
    world.step();
    assert.deepEqual(log.sort(), ['exit:orb:false', 'exit:pit:true'], 'moved-away and destroyed bodies both exit');
    log.length = 0;
    settle(world, 30);
    assert.deepEqual(log, [], 'no repeated events while nothing changes');
    assert.throws(() => zones.add({shape: {kind: 'sphere', center: [0, 0, 0], radius: 0}}), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => new TriggerSet(world).bodiesIn(orb), e => e.code === 'INVALID_PAYLOAD', 'foreign trigger rejected');
    zones.dispose();
    world.spawnBox({position: [6, 3, 0], halfSize: 0.3});
    settle(world, 60);
    assert.deepEqual(log, [], 'dispose detaches from onStep');
  } finally { world.dispose(); }
});

test('a crowded trigger flags overflow and withholds exits it cannot confirm', async () => {
  const world = await createWorld();
  try {
    const zones = new TriggerSet(world);
    assert.equal(zones.add({shape: {kind: 'sphere', center: [0, 50, 0], radius: 1}}).limit, MAX_QUERY_HITS, 'default limit is the native ceiling');
    // Hits come back in a stable order (newest body first here), so a newer body arriving pushes an older one out of the report.
    const inside = [0, 1, 2].map(i => world.spawnBox({position: [i - 1, 0.3, 0], halfSize: 0.3}));
    const late = world.spawnBox({position: [-6, 0.3, 0], halfSize: 0.3});
    settle(world, 30);
    const room = zones.add({shape: {kind: 'box', center: [0, 1, 0], halfExtents: [2, 1, 2]}, limit: 2});
    assert.equal(zones.update().length, 2);
    assert.equal(room.overflow, true);
    const before = zones.bodiesIn(room).map(b => b.token);
    zones.setShape(room, {kind: 'box', center: [-2.5, 1, 0], halfExtents: [4.5, 1, 2]});
    const events = zones.update();
    assert.deepEqual(events.map(e => `${e.type}:${e.body.token === late.token}`), ['enter:true'], 'the arrival enters; nobody still inside exits');
    const reported = world.native.queryBatch([{kind: 'box-overlap', origin: [-2.5, 1, 0], halfExtents: [4.5, 1, 2], limit: 2, filter: {bodies: 'dynamic'}}])[0].hits.map(h => h.body.token);
    assert.ok(before.some(t => !reported.includes(t)), 'precondition: a body still inside dropped out of the report');
    assert.ok(before.every(t => zones.bodiesIn(room).some(b => b.token === t)), 'unreported bodies are kept as inside');
    world.destroyBody(inside.find(b => b.token === before[0]));
    assert.ok(zones.update().some(e => e.type === 'exit' && !e.alive), 'a destroyed body still exits while overflowing');
    assert.throws(() => zones.add({shape: {kind: 'sphere', center: [0, 0, 0], radius: 1}, limit: MAX_QUERY_HITS + 1}), e => e.code === 'INVALID_PAYLOAD');
  } finally { world.dispose(); }
});

test('the character lands, walks, climbs a step, is blocked, jumps and pushes', async () => {
  const world = await createWorld();
  try {
    world.spawnBox({position: [3, 0.15, 0], halfSize: 0.15}); // 0.3 m ledge
    const crate = world.spawnBox({position: [3, 0.5, 5], halfSize: 0.5}); // 1 m crate
    settle(world);
    const hero = new CharacterController(world, {position: [0, 3, 0]});
    let s;
    for (let i = 0; i < 60; i++) { s = hero.move({velocity: [0, 0, 0]}, 1 / 60); world.step(); }
    assert.ok(s.grounded && Math.abs(s.position[1] - 0.92) < 0.01, `lands a skin above the ground, y=${s.position[1]}`);
    assert.equal(s.groundNormal[1], 1);
    let peak = 0;
    for (let i = 0; i < 60; i++) { s = hero.move({velocity: [3, 0, 0]}, 1 / 60); peak = Math.max(peak, s.position[1]); world.step(); }
    assert.ok(Math.abs(s.position[0] - 3) < 0.05, 'walked 3 m in 1 s');
    assert.ok(Math.abs(peak - 1.22) < 0.01 && s.grounded, 'stepped up onto the 0.3 m ledge');
    for (let i = 0; i < 30; i++) { s = hero.move({velocity: [3, 0, 0]}, 1 / 60); world.step(); }
    assert.ok(Math.abs(s.position[1] - 0.92) < 0.01 && s.grounded, 'stepped back down and stayed grounded');

    hero.teleport([3, 0.93, 2]);
    for (let i = 0; i < 60; i++) { s = hero.move({velocity: [0, 0, 3]}, 1 / 60); world.step(); }
    assert.ok(s.position[2] < 4.2 && s.position[2] > 4.1, `the 1 m crate blocks without pushStrength, z=${s.position[2]}`);
    assert.deepEqual(world.getPose(crate).position.map(v => +v.toFixed(3)), [3, 0.5, 5]);

    for (let i = 0; i < 90; i++) { s = hero.move({velocity: [0, 0, 0], jump: i === 0 ? 5 : 0}, 1 / 60); peak = i ? Math.max(peak, s.position[1]) : 0; world.step(); }
    assert.ok(Math.abs(peak - (0.92 + 25 / (2 * -NATIVE_GRAVITY[1]))) < 0.06 && s.grounded, `jump apex ${peak}`);

    const pusher = new CharacterController(world, {position: [3, 0.93, 2], pushStrength: 1});
    let pushed = 0;
    for (let i = 0; i < 60; i++) { s = pusher.move({velocity: [0, 0, 3]}, 1 / 60); pushed += s.pushed.length; world.step(); }
    assert.ok(pushed > 0 && world.getPose(crate).position[2] > 5.2, 'pushStrength shoves the crate');
    assert.throws(() => hero.move({velocity: [0, 0, 0]}, 0), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => new CharacterController(world, {position: [0, 1, 0], skin: 0}), e => e.code === 'INVALID_PAYLOAD');
  } finally { world.dispose(); }
});

test('a character spawned inside the ground climbs out; one overlapped by a dynamic body walks free', async () => {
  const world = await createWorld();
  try {
    const hero = new CharacterController(world, {position: [0, 0.8, 0]});
    const s = hero.move({velocity: [0, 0, 0]}, 1 / 60);
    assert.equal(s.stuck, false);
    assert.ok(s.position[1] > 0.9, 'raised out of the ground');
    const box = world.spawnBox({position: [0, 0.3, 0], halfSize: 0.3});
    hero.teleport([0, 0.93, 0]);
    world.step();
    let end;
    for (let i = 0; i < 30; i++) { end = hero.move({velocity: [2, 0, 0]}, 1 / 60); world.step(); }
    assert.ok(end.position[0] > 0.9, 'not trapped by a box overlapping it');
    assert.ok(world.isAlive(box));
  } finally { world.dispose(); }
});

test('controller pushes are recorded, replay matches, and onStep listeners do not double-apply', async () => {
  const run = async () => {
    const world = await createWorld({seed: 9});
    world.startRecording({checkpointEvery: 30});
    for (let i = 0; i < 6; i++) world.spawnBox({position: [2 + i * 0.7, 0.3, 0], halfSize: 0.3});
    const hero = new CharacterController(world, {position: [0, 0.93, 0], pushStrength: 2});
    const counter = {calls: 0};
    const offHero = world.onStep(() => hero.move({velocity: [4, 0, 0.3]}, world.loop.step));
    // A listener that always acts: replaying it a second time would change the result.
    const offKick = world.onStep(tick => { counter.calls++; if (tick % 20 === 0) world.applyImpulse(world.bodyAt(1), [0, 0, 0.5]); });
    for (let i = 0; i < 180; i++) world.step();
    const log = world.stopRecording();
    return {world, log, counter, off: () => { offHero(); offKick(); }, hash: world.exactHash(), impulses: log.commands.filter(c => c.op === 'applyImpulse').length};
  };
  const a = await run(), b = await run();
  try {
    assert.equal(a.hash, b.hash, 'deterministic across runs');
    assert.ok(a.impulses > 9, 'pushes and kicks became applyImpulse commands');
    const report = a.world.replayDetailed(a.log); // listeners still attached: they must not fire during replay
    assert.equal(report.matches, true, JSON.stringify(report));
    assert.equal(a.counter.calls, 180, 'listeners were silent during replay');
    a.off();
    a.world.step();
    assert.equal(a.counter.calls, 180, 'unsubscribed');
  } finally { a.world.dispose(); b.world.dispose(); }
});

test('capabilities lists gameplay and the query hit ceiling', () => {
  const caps = capabilities();
  assert.ok(caps.modules.includes('gameplay'));
  assert.equal(caps.limits.queryHitsMax, MAX_QUERY_HITS);
});
