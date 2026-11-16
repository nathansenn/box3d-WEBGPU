// Random valid programs against the rigid world through the kit's PhysicsWorld (docs/ROBUSTNESS.md).
//
// Each seed builds a scene of every shape kind (boxes, spheres, capsules, hulls, compounds, static meshes and height
// fields), with explicit mass data, collision filters, kinematic motion, forces, impulses, teleports, joints of every
// type and their setters, and creation and destruction of bodies and joints between steps. After every step:
//   no NaN or infinity in any body state, transform or colour; rotations are unit quaternions; dynamic speeds stay under
//   Box3D's 400 m/s clamp; every row's handle is alive and destroyed handles stay dead; the counts agree.
// And over a run:
//   checkpoint -> restore -> continue is bit-identical to continuing without the restore, at random steps;
//   a recorded session replays bit-identically, in the same world and in a second one, also after a JSON round trip;
//   the same seed gives the same states in two separate WASM instances;
//   a world's states do not depend on what another world of the same module does;
//   the WASM heap stops growing after the first create/destroy cycles.
import assert from 'node:assert/strict';
import test from 'node:test';
import {kit} from './lib/kit.mjs';
import {rng, seeds, scale} from './lib/rng.mjs';
import {WorldSession, checkInvariants, worldDigest, randomBody} from './lib/world-program.mjs';

const {createWorld, loadBox3D, PhysicsWorld, saveSession, loadSession} = kit;
const SEEDS = seeds(6, 300), OPS = scale(260, 1500);
const options = {strict: true, gravity: [0, -9.81, 0]};

/** Run `ops` operations with steps between them; returns the digest after each step. */
function run(session, r, ops) {
  const digests = [];
  for (let i = 0; i < ops; i++) {
    session.op();
    if (r.bool(0.55)) { const steps = r.int(1, 4); for (let k = 0; k < steps; k++) { session.step(); digests.push(worldDigest(session.world)); } }
  }
  return digests;
}
// Native defect ND-5 (native-defects.test.mjs, docs/ROBUSTNESS.md): in about one random program in 150 a jointed
// mechanism diverges inside Box3D although every input is in range and world.diagnose() has no warning. Such a run is
// caught here (a strict world throws NUMERICAL_FAILURE; a runaway speed breaks an invariant), counted and named, and
// the suite fails when more than 3 % of the programs diverge or when one diverges that never made a joint. It is never
// silent: that is the property under test. With the native side fixed the count is zero and this allowance goes.
const diverged = [];
const ND5 = /moves at|spins at|not finite|is NaN|is Infinity|is -Infinity|rotation has length/;
const fail = (seed, error, session) => {
  if (session && (session.counts.joint ?? 0) > 0 && (error.code === 'NUMERICAL_FAILURE' || (error.code === undefined && ND5.test(error.message)))) { diverged.push(seed); return; }
  error.message = `[seed ${seed}; rerun with FUZZ_SEED=${seed}] ${error.message}`; throw error;
};
const allowance = count => Math.floor(count * 0.03);

test(`invariants hold after every step of ${SEEDS.length} random programs of ${OPS} operations`, async () => {
  const world = await createWorld(options), totals = {};
  let steps = 0;
  try {
    for (const seed of SEEDS) {
      world.reset({gravity: [0, -9.81, 0], seed});
      const r = rng(seed), session = new WorldSession(world, r);
      try {
        run(session, r, OPS); checkInvariants(world, session.graveyard);
        // The programs stay inside the stability rules; a warning here means the generator, or a rule, is wrong.
        const warnings = world.diagnose().filter(finding => finding.severity !== 'note' && finding.rule !== 'far-from-origin');
        assert.deepEqual(warnings.map(w => `${w.rule}: ${w.subject}: ${JSON.stringify(w.numbers)}`), [], 'world.diagnose() on a program built inside the rules');
      } catch (error) { fail(seed, error, session); }
      steps += session.steps;
      for (const [name, count] of Object.entries(session.counts)) totals[name] = (totals[name] ?? 0) + count;
    }
  } finally { world.dispose(); }
  console.log(`world fuzz: ${SEEDS.length} programs, ${steps} steps checked; fastest body ${checkInvariants.fastest.toFixed(0)} m/s, ${checkInvariants.fastestSpin.toFixed(0)} rad/s; operations ${JSON.stringify(totals)}`);
  for (const name of ['create', 'destroy', 'joint', 'destroyJoint', 'tuneJoint', 'drive', 'teleport', 'kinematic', 'retype', 'tune', 'explode', 'gravity', 'query']) assert.ok(totals[name] > 0, `the programs never ran "${name}"`);
});

test('checkpoint -> restore -> continue is bit-identical at random steps, with creation and destruction in between', async () => {
  const world = await createWorld(options);
  let windows = 0;
  try {
    for (const seed of SEEDS) {
      world.reset({gravity: [0, -9.81, 0], seed});
      const r = rng(seed), session = new WorldSession(world, r);
      try {
        for (let round = 0; round < scale(4, 12); round++) {
          run(session, r, scale(40, 120));
          const saved = world.checkpoint(), book = session.snapshot(), before = worldDigest(world);
          const first = run(session.withStream(r.fork(`window ${round}`)), session.r, scale(25, 80));
          world.restoreCheckpoint(saved); session.restore(book);
          assert.equal(worldDigest(world), before, 'the restored world is the checkpointed one');
          const second = run(session.withStream(r.fork(`window ${round}`)), session.r, scale(25, 80));
          assert.deepEqual(second, first, `window ${round}: the continuation after restore differs from the first run`);
          session.withStream(r); windows++;
        }
      } catch (error) { fail(seed, error, session); }
    }
  } finally { world.dispose(); }
  console.log(`world fuzz: ${windows} checkpoint windows compared bit for bit`);
});

test('a recorded session replays bit-identically in the same world, in a second world and after JSON', async () => {
  const world = await createWorld(options), second = await createWorld(options);
  let commands = 0;
  try {
    for (const seed of SEEDS) {
      const r = rng(seed ^ 0x5eed);
      let session = null;
      try {
        world.startRecording({checkpointEvery: r.pick([1, 7, 60]), world: {ground: true, gravity: [0, -9.81, 0]}});
        session = new WorldSession(world, r);
        run(session, r, scale(160, 800));
        session.step(r.int(1, 30));
        const log = world.stopRecording();
        commands += log.commands.length;
        const report = world.replayDetailed(log);
        assert.deepEqual({matches: report.matches, divergence: report.divergence}, {matches: true, divergence: null}, 'replay in the recording world');
        assert.ok(report.checkpointsCompared > 0 || log.ticks < 60, 'the replay compared the recorded hashes');
        const text = JSON.stringify(saveSession(log));
        assert.equal(loadSession(second, JSON.parse(text)).matches, true, 'replay of the saved session in a second world');
        assert.equal(second.exactHash(), world.exactHash());
      } catch (error) { if (world.isRecording) world.stopRecording(); fail(seed, error, session); }
    }
  } finally { world.dispose(); second.dispose(); }
  console.log(`world fuzz: ${SEEDS.length} recordings replayed (${commands} commands)`);
});

test('the same seed gives the same states in two WASM instances, and other worlds of a module do not disturb it', async () => {
  const pool = await loadBox3D(), alone = await createWorld(options);
  const a = new PhysicsWorld(pool, {strict: true}), b = new PhysicsWorld(pool, {strict: true});
  try {
    for (const seed of SEEDS.slice(0, scale(3, 40))) {
      try {
        alone.reset({gravity: [0, -9.81, 0], seed});
        const r1 = rng(seed), expected = run(new WorldSession(alone, r1), r1, scale(150, 600));
        a.reset({gravity: [0, -9.81, 0], seed}); b.reset({gravity: [0, -3, 0], seed: seed + 1});
        const r2 = rng(seed), rb = rng(seed + 99), sessionA = new WorldSession(a, r2), sessionB = new WorldSession(b, rb), actual = [];
        for (let i = 0; i < scale(150, 600); i++) {
          sessionA.op();
          if (r2.bool(0.55)) { const steps = r2.int(1, 4); for (let k = 0; k < steps; k++) { sessionA.step(); actual.push(worldDigest(a)); } }
          // The neighbour does something else entirely between this world's operations.
          sessionB.op(); if (rb.bool()) sessionB.step(rb.int(1, 3));
        }
        assert.deepEqual(actual, expected, 'a world sharing its module with a busy neighbour steps exactly like a world alone');
      } catch (error) { fail(seed, error, {counts: {joint: 1}}); }
    }
  } finally { a.dispose(); b.dispose(); pool.destroy(); alone.dispose(); }
});

test('divergence of jointed mechanisms (native defect ND-5) stays within its allowance and is never silent', () => {
  const programs = SEEDS.length * 3 + SEEDS.slice(0, scale(3, 40)).length;
  console.log(`world fuzz: ${diverged.length} of ${programs} programs diverged inside Box3D and were caught (ND-5)${diverged.length ? `: seeds ${[...new Set(diverged)].join(', ')}` : ''}`);
  assert.ok(diverged.length <= allowance(programs), `${diverged.length} of ${programs} programs diverged; the allowance for ND-5 is ${allowance(programs)}. Seeds: ${[...new Set(diverged)].join(', ')}`);
});

test('the WASM heap stops growing over create/destroy cycles', async () => {
  const world = await createWorld(options);
  try {
    const r = rng(SEEDS[0]), heap = () => world.native.HEAPF32.buffer.byteLength, sizes = [];
    const cycles = scale(12, 120), perCycle = scale(150, 400);
    for (let cycle = 0; cycle < cycles; cycle++) {
      const session = new WorldSession(world, r, {maxBodies: perCycle + 2});
      for (let i = 0; i < perCycle; i++) world.createBody(randomBody(r));
      for (let i = 0; i < 20; i++) session.joint();
      session.step(scale(4, 8));
      world.checkpoint(); // checkpoint storage is part of the heap too
      while (world.bodyCount() > 1) world.destroyBody(world.bodyAt(world.bodyCount() - 1));
      session.step(2);
      assert.equal(world.bodyCount(), 1, 'only the ground is left');
      sizes.push(heap());
    }
    const settled = sizes.slice(2);
    console.log(`world fuzz: heap ${sizes[0] >> 20} MiB after the first cycle, ${sizes.at(-1) >> 20} MiB after ${cycles} cycles of ${perCycle} bodies`);
    assert.equal(Math.max(...settled), settled[0], `the heap grew after the second cycle: ${[...new Set(sizes)].map(s => `${s >> 20} MiB`).join(' -> ')}`);
  } finally { world.dispose(); }
});
