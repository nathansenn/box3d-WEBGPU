// Continuous collision of the rigid core: a small fast ball against a thin static wall with the world's continuous
// collision off and on, and against a thin free plate without and with the bullet flag. The set-ups are in
// rigid-core-scenarios.mjs and docs/VALIDATION.md has the same cases as registry rows.
import assert from 'node:assert/strict';
import test from 'node:test';
import * as K from 'box3d-webgpu-kit';
import * as S from './rigid-core-scenarios.mjs';

test('a 5 cm ball against a 2 cm wall at 60 Hz: discrete stepping loses the shots the window model predicts, continuous collision loses none', async t => {
  const r = await S.bulletThroughWall(K);
  for (const row of r.rows) t.diagnostic(`${row.speed} m/s (${row.travelPerStep} m per step): through the wall ${row.through.off} of ${row.phases} without, ${row.through.on} with continuous collision; predicted without: ${row.predictedThrough}`);
  assert.equal(r.throughWithCcd, 0, 'no ball passes with continuous collision');
  for (const row of r.rows) {
    assert.ok(row.through.off >= row.phases / 2, `${row.speed} m/s: most balls tunnel without it (${row.through.off})`);
    assert.ok(Math.abs(row.through.off - row.predictedThrough) <= 1, `${row.speed} m/s: ${row.through.off} tunnelled, the window model predicts ${row.predictedThrough}`);
  }
  assert.ok(Math.abs(r.throughWithout - r.predictedWithout) <= 3, `in total ${r.throughWithout} of ${r.shots}, predicted ${r.predictedWithout}`);
});

test('the bullet flag: a ball passes through a thin free plate without it and is stopped with it, and momentum is conserved', async t => {
  const r = await S.bulletAgainstDynamic(K);
  t.diagnostic(`without: passed ${r.plain.passed}; with: passed ${r.bullet.passed}, common speed ${r.bullet.plateSpeed} m/s, momentum ${r.bullet.momentumAfter} of ${r.bullet.momentumBefore} kg m/s`);
  assert.equal(r.plain.passed, true, 'dynamic against dynamic is not swept by default');
  assert.equal(r.plain.flag, false); assert.equal(r.bullet.flag, true);
  assert.equal(r.bullet.passed, false, 'a bullet is swept against moving bodies too');
  const [mb, mp] = r.bullet.masses, common = mb * r.speed / (mb + mp);
  assert.ok(Math.abs(r.bullet.momentumAfter / r.bullet.momentumBefore - 1) < 1e-4, 'momentum is conserved');
  assert.ok(Math.abs(r.bullet.plateSpeed / common - 1) < 1e-3 && Math.abs(r.bullet.ballSpeed / common - 1) < 1e-3, `without restitution both move at m v / (m + M) = ${common}`);
});

test('continuous collision is a world setting and the bullet flag a body flag: defaults, setters, descriptors, checkpoints', async () => {
  const world = await K.createWorld({step: 1 / 60, subSteps: 4, gravity: [0, 0, 0], ground: false});
  try {
    assert.equal(world.settings().continuous, true, 'on by default');
    world.configure({continuous: false});
    assert.equal(world.settings().continuous, false);
    const a = world.createBody({shape: {kind: 'sphere', radius: 0.05}, position: [0, 0, 0], bullet: true});
    const b = world.createBody({shape: {kind: 'sphere', radius: 0.05}, position: [1, 0, 0]});
    assert.equal(world.getBodyFlags(a).bullet, true); assert.equal(world.getBodyFlags(b).bullet, false);
    world.setBullet(b, true); world.setBullet(a, false);
    assert.equal(world.getBodyFlags(a).bullet, false); assert.equal(world.getBodyFlags(b).bullet, true);
    // Both travel in a checkpoint.
    const bytes = world.checkpoint();
    world.configure({continuous: true}); world.setBullet(b, false);
    world.restoreCheckpoint(bytes);
    assert.equal(world.settings().continuous, false); assert.equal(world.getBodyFlags(b).bullet, true);
    // A reset world has the defaults again.
    world.reset({ground: false});
    assert.equal(world.settings().continuous, true);
    assert.throws(() => world.configure({continuous: 1}), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => world.configure({nope: true}), e => e.code === 'INVALID_PAYLOAD');
  } finally { world.dispose(); }
});
