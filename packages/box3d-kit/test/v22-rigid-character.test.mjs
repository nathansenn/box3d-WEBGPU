// The capsule character (box3d-webgpu-kit/gameplay, CapsuleCharacterController) on Box3D's character mover:
// speed on flat ground, the slope limit, the step height, stairs, jumping, thin walls, moving platforms, pushing,
// checkpoints and replay. Every number is measured on the real engine through the built kit; the set-ups are in
// rigid-core-scenarios.mjs and docs/VALIDATION.md has the same cases as registry rows.
import assert from 'node:assert/strict';
import test from 'node:test';
import {fileURLToPath} from 'node:url';
import {Worker} from 'node:worker_threads';
import * as index from 'box3d-webgpu-kit';
import * as gameplay from 'box3d-webgpu-kit/gameplay';
import {connectWorld} from 'box3d-webgpu-kit/worker';
import * as S from './rigid-core-scenarios.mjs';

const K = {...index, ...gameplay};
const {CapsuleCharacterController} = gameplay;
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);

test('flat ground: the character walks at the commanded speed, stays grounded and keeps its feet on the floor', async t => {
  const r = await S.characterFlat(K);
  t.diagnostic(`speed ${r.speed} m/s for ${r.commanded}; feet ${r.feetMin.toExponential(2)} .. ${r.feetMax.toExponential(2)} m; ${r.airborne} airborne steps`);
  within(r.speed, r.commanded, 1e-3, 'speed');
  assert.equal(r.airborne, 0);
  near(r.feetMin, 0, 1e-3, 'lowest feet'); near(r.feetMax, 0, 1e-3, 'highest feet');
  assert.ok(r.drift < 1e-6, 'no sideways drift');
});

test('slope limit: ramps below maxSlopeDegrees are climbed at the commanded speed along the ramp, steeper ones are walls', async t => {
  for (const limit of [45, 30]) {
    const r = await S.characterSlopeLimit(K, limit);
    t.diagnostic(`limit ${limit} deg: steepest climbed ${r.steepestClimbed} deg, shallowest refused ${r.shallowestRefused} deg`);
    assert.ok(r.steepestClimbed < r.shallowestRefused, 'no ramp steeper than a refused one is climbed');
    near(r.steepestClimbed, limit, 0.75, 'steepest ramp climbed');
    near(r.shallowestRefused, limit, 0.75, 'shallowest ramp refused');
    for (const row of r.rows) {
      if (row.climbed > 1) within(row.alongSpeed, 2, 2e-3, `speed along a ${row.degrees} deg ramp`);
      // A ramp exactly at the limit is on the edge of float32: refused, but the capsule may creep a few centimetres up its foot.
      else if (row.degrees >= limit + 0.5) assert.ok(row.climbed < 0.01 && row.grounded, `a ${row.degrees} deg ramp is not climbed at all (${row.climbed} m), and the character stays on its feet`);
      else assert.ok(row.climbed < 0.1, `a ramp at the limit is not climbed (${row.climbed} m)`);
    }
  }
});

test('step height: ledges up to stepHeight are stepped onto, taller ones block, and stairs are walked up and down', async t => {
  for (const stepHeight of [0.35, 0.2]) {
    const r = await S.characterStepLimit(K, stepHeight);
    t.diagnostic(`step height ${stepHeight} m: tallest ledge climbed ${r.tallestClimbed.toFixed(3)} m, lowest refused ${r.lowestRefused.toFixed(3)} m`);
    assert.ok(r.tallestClimbed < r.lowestRefused);
    near(r.tallestClimbed, stepHeight, 0.006, 'tallest ledge climbed');
    near(r.lowestRefused, stepHeight, 0.011, 'lowest ledge refused');
  }
  const stairs = await S.characterStairs(K);
  t.diagnostic(`stairs: reached ${stairs.top} m of ${stairs.expectedTop} m in ${stairs.steps} steps; ${stairs.airborneDown} of ${stairs.stepsDown} steps of the way down in the air`);
  near(stairs.top, stairs.expectedTop, 2e-3, 'top of the stairs');
  assert.equal(stairs.steps, stairs.count, 'one step per stair');
  assert.equal(stairs.airborneDown, 0, 'grounded all the way down');
  near(stairs.endFeet, 0, 2e-3, 'back on the floor'); assert.ok(stairs.endX > stairs.far);
  // A ledge lower than radius (1 - cos(maxSlope)) is ridden over by the round bottom, with stepping switched off.
  const bump = await S.characterStep(K, 0.08, 0);
  assert.ok(bump.onTop && !bump.stepped, 'a low bump needs no step');
  const blocked = await S.characterStep(K, 0.2, 0);
  assert.ok(!blocked.onTop, 'stepHeight 0 switches stepping off');
});

test('jump: the apex is v^2 / (2 g) and the flight lasts 2 v / g', async t => {
  const r = await S.characterJump(K, 5);
  t.diagnostic(`apex ${r.apex} m (exact ${r.exactApex}); air time ${r.airTime} s (exact ${r.exactAirTime})`);
  near(r.apex, r.exactApex, 1e-3, 'apex');
  near(r.airTime, r.exactAirTime, S.DT, 'air time');
});

test('thin walls: a 1 cm wall stops the character at 10 to 300 m/s, 5 m per step at the top speed', async t => {
  const r = await S.characterThinWall(K);
  t.diagnostic(r.result.map(row => `${row.speed} m/s: ${(row.pastFace * 1000).toFixed(2)} mm past the face`).join('; '));
  // The mover's cast lets the capsule encroach by Box3D's linear slop and no further.
  for (const row of r.result) assert.ok(row.pastFace <= S.LINEAR_SLOP + 1e-4 && row.pastFace > -0.01, `${row.speed} m/s: ${row.pastFace}`);
  assert.ok(r.worst < r.thickness, 'never as far in as the wall is thick');
});

test('moving platforms: a standing character takes the velocity of the kinematic body under it, sideways and upwards', async t => {
  const r = await S.characterPlatform(K);
  t.diagnostic(`carried at ${r.carried.map(v => v.toFixed(5))} m/s on a platform moving at ${r.platformVelocity}; slip ${r.slip.toExponential(2)} m in 2 s; rose ${r.rise} m with the platform's ${r.platformRise} m`);
  within(r.carried[0], r.platformVelocity[0], 1e-3, 'carried x'); within(r.carried[1], r.platformVelocity[1], 1e-3, 'carried z');
  assert.ok(r.slip < 1e-3, `slip ${r.slip}`);
  within(r.rise, r.platformRise, 1e-3, 'rise'); assert.equal(r.lostGround, 0);
  // One step of lag: the platform moved before the character followed.
  near(r.standingError, 0, 1.2 / S.HZ, 'feet on the platform');
});

test('pushing: a box lighter than maxPushForce / (mu g) is pushed at walking speed, a heavier one stops the character', async t => {
  const light = await S.characterPush(K, 0.5), heavy = await S.characterPush(K, 2), off = await S.characterPush(K, 0.5, {force: 0});
  t.diagnostic(`limit ${light.limitMass.toFixed(1)} kg: a ${light.mass.toFixed(1)} kg box moves at ${light.boxSpeed.toFixed(4)} m/s (walking ${light.speed}); a ${heavy.mass.toFixed(1)} kg box at ${heavy.boxSpeed.toFixed(5)} m/s`);
  within(light.boxSpeed, light.speed, 0.02, 'light box speed'); within(light.characterSpeed, light.speed, 0.02, 'character behind the light box');
  assert.ok(heavy.boxSpeed < 0.01 * heavy.speed && heavy.characterSpeed < 0.01 * heavy.speed, 'the heavy box and the character behind it stand still');
  assert.ok(Math.abs(off.boxSpeed) < 1e-6 && off.characterSpeed < 1e-3, 'maxPushForce 0: the box is a wall');
});

test('checkpoint: the world checkpoint and the character state resume a walk bit for bit (a step, a platform ride, a jump, pushing)', async t => {
  const r = await S.characterCheckpoint(K);
  t.diagnostic(`${r.mismatches} of ${r.steps} later steps differ; ${r.pushes} pushes and ${r.stepped} step after the restore`);
  assert.equal(r.mismatches, 0);
  assert.ok(r.pushes > 10 && r.stepped === 1);
  assert.deepEqual(r.savedKeys, ['ground', 'inherited', 'pos', 'pushedBodies', 'steep', 'steppedFlag', 'stepping', 'vel', 'verticalSpeed', 'wanted']);
});

test('recording: the pushes of a character are in the log, so a replay without the character reproduces the world', async () => {
  const world = await S.newWorld(K), twin = await S.newWorld(K);
  try {
    world.startRecording({world: {ground: true, gravity: [0, -S.G, 0]}});
    world.createBody({shape: {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, position: [1.5, 0.3, 0], density: 100, friction: 0.4});
    const character = new CapsuleCharacterController(world, {position: [0, 0.895, 0]});
    for (let i = 0; i < 480; i++) { character.move({velocity: [1.5, 0, 0]}, S.DT); world.step(); }
    const log = JSON.parse(JSON.stringify(world.stopRecording()));
    const pushes = log.commands.filter(command => command.op === 'call' && command.method === 'applyImpulseAt').length;
    assert.ok(pushes > 50, `the log holds the pushes (${pushes})`);
    const report = twin.replayDetailed(log);
    assert.ok(report.matches, 'the replay matches every checkpoint and the final hash');
    assert.equal(twin.exactHash(), world.exactHash());
  } finally { world.dispose(); twin.dispose(); }
});

test('options, teleport, ignored bodies, ceilings and falling off a ledge', async () => {
  const world = await S.newWorld(K, {ground: true});
  try {
    for (const bad of [{radius: 0}, {height: 0.5}, {maxSlopeDegrees: 90}, {stepHeight: -1}, {maxPushForce: -1}, {position: [0, NaN, 0]}]) {
      assert.throws(() => new CapsuleCharacterController(world, {position: [0, 1, 0], ...bad}), e => e.code === 'INVALID_PAYLOAD', JSON.stringify(bad));
    }
    const character = new CapsuleCharacterController(world, {position: {x: 0, y: 0.895, z: 0}});
    assert.throws(() => character.move({velocity: [1, 0, 0]}, 0), e => e.code === 'INVALID_PAYLOAD');
    assert.throws(() => character.move({velocity: [NaN, 0, 0]}, S.DT), e => e.code === 'INVALID_PAYLOAD');
    near(character.gravity, -S.G, 1e-6, 'the world gravity by default');
    // A kinematic body that follows the character (what a game would draw) does not block it when ignored.
    const visual = world.createBody({shape: {kind: 'capsule', radius: 0.3, halfLength: 0.6}, type: 'kinematic', position: [0, 0.895, 0]});
    const blockedBy = new CapsuleCharacterController(world, {position: [0, 0.895, 0]});
    for (let i = 0; i < 120; i++) blockedBy.move({velocity: [0, 0, 0]}, S.DT);
    const own = new CapsuleCharacterController(world, {position: [0, 0.895, 0], ignoreBody: visual});
    for (let i = 0; i < 240; i++) { const s = own.move({velocity: [1, 0, 0]}, S.DT); world.moveKinematic(visual, s.position); world.step(); }
    near(own.state.position[0], 1, 0.01, 'walks 1 m in 1 s with its own body ignored');
    near(world.getState(visual).position[0], own.state.position[0], 0.01, 'the visual body follows');
    // Destroying the ignored body does not break the controller's next move: it reports the stale body.
    world.destroyBody(visual);
    assert.throws(() => own.move({velocity: [1, 0, 0]}, S.DT), e => e.code === 'STALE_BODY');

    // A ceiling 1.9 m above the floor stops a jump at once; the character lands again.
    world.createBody({shape: {kind: 'box', halfExtents: [2, 0.1, 2]}, type: 'static', position: [10, 2.0, 0]});
    const jumper = new CapsuleCharacterController(world, {position: [10, 0.895, 0]});
    for (let i = 0; i < 60; i++) jumper.move({velocity: [0, 0, 0]}, S.DT);
    let top = 0;
    for (let i = 0; i < 240; i++) top = Math.max(top, jumper.move({velocity: [0, 0, 0], jump: i === 0 ? 6 : 0}, S.DT).position[1]);
    assert.ok(top < 1.9 - 0.9 + 0.011, `the head stays under the ceiling (centre ${top})`);
    assert.ok(jumper.state.grounded, 'and the character is back on the floor');

    // Walking off a 2 m ledge: airborne until the floor, falling at g, then grounded.
    world.createBody({shape: {kind: 'box', halfExtents: [1, 1, 1]}, type: 'static', position: [20, 1, 0]});
    const faller = new CapsuleCharacterController(world, {position: [20, 2.895, 0]});
    for (let i = 0; i < 60; i++) faller.move({velocity: [0, 0, 0]}, S.DT);
    assert.ok(faller.state.grounded); near(faller.state.feet, 2, 2e-3, 'on the ledge');
    let airborne = 0, fastest = 0;
    for (let i = 0; i < 600; i++) { const s = faller.move({velocity: [2, 0, 0]}, S.DT); if (!s.grounded) airborne++; fastest = Math.min(fastest, s.velocity[1]); }
    assert.ok(faller.state.grounded); near(faller.state.feet, 0, 2e-3, 'on the floor');
    // Free fall from 2 m takes sqrt(2 h / g) = 0.639 s and ends at sqrt(2 g h) = 6.26 m/s; sliding round the edge adds a little time.
    near(-fastest, Math.sqrt(2 * S.G * 2), 0.35, 'landing speed');
    assert.ok(airborne * S.DT > 0.6 && airborne * S.DT < 0.85, `air time ${airborne * S.DT} s`);
    faller.teleport([0, 5, 5]);
    assert.deepEqual(faller.state.position, [0, 5, 5]); assert.equal(faller.state.grounded, false);
  } finally { world.dispose(); }
});

test('worker: moveCapsule in the worker gives the main-thread answer', async () => {
  const local = await S.newWorld(K, {ground: true});
  const remote = await connectWorld(new Worker(fileURLToPath(new URL('./fixtures/physics.worker.mjs', import.meta.url))), {step: S.DT, subSteps: S.SUB, gravity: [0, -S.G, 0], ground: true, sharedMemory: false});
  try {
    const wall = {shape: {kind: 'box', halfExtents: [0.05, 2, 4]}, type: 'static', position: [3, 2, 0]};
    local.createBody(wall); await remote.createBody(wall);
    const move = {position: [0, 0.9, 0], radius: 0.3, halfLength: 0.6, translation: [10, 0, 1], maxSlopeDegrees: 50};
    const a = local.moveCapsule(move), b = await remote.moveCapsule(move);
    assert.deepEqual(b.position, a.position);
    assert.equal(b.planes.length, a.planes.length);
    assert.deepEqual(b.planes.map(plane => [plane.normal, plane.bodyType, plane.wall]), a.planes.map(plane => [[...plane.normal], plane.bodyType, plane.wall]));
    assert.ok(a.position[0] < 2.66 && a.position[2] > 0.5, 'stopped by the wall and slid along it');
  } finally { local.dispose(); await remote.dispose(); }
});
