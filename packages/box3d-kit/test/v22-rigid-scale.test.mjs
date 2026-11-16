// The rigid core at scale: a pyramid of boxes 20 rows high, a pile of 5,000 bodies, a pile of 1,000 convex hulls and a
// pile of 60 ragdolls, each required to stay finite, inside its pit, no faster than free fall allows, with bounded
// overlap, and to lose the energy of the fall; and the same pile stepped on 1, 2 and 4 threads (loadBox3D({threads})), required to
// give the same state bit for bit. The set-ups are in rigid-core-scenarios.mjs. Step times are reported as
// diagnostics and never asserted: scripts/rigid-scale-benchmark.mjs measures them.
import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import * as index from 'box3d-webgpu-kit';
import * as sceneModule from 'box3d-webgpu-kit/scene';
import * as S from './rigid-core-scenarios.mjs';

const K = {...index, ...sceneModule};
const near = (actual, expected, tolerance, label) => assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const clock = () => performance.now();

/** One pile in a child process (rigid-scale-child.mjs), which exits by itself: see there. */
const child = spec => new Promise((resolve, reject) => {
  const run = spawn(process.execPath, [fileURLToPath(new URL('./rigid-scale-child.mjs', import.meta.url)), JSON.stringify(spec)], {stdio: ['ignore', 'pipe', 'pipe']});
  let out = '', err = '', done = false;
  const finish = () => {
    if (done) return; done = true; clearTimeout(timer);
    const line = out.split('\n').find(text => text.startsWith('RESULT '));
    if (line) resolve(JSON.parse(line.slice(7))); else reject(new Error(`the child printed no result (threads ${spec.threads}): ${err.slice(-600) || out.slice(-300)}`));
  };
  const timer = setTimeout(() => { run.kill('SIGKILL'); finish(); }, 240000);
  run.stdout.on('data', chunk => { out += chunk; if (out.includes('RESULT ') && out.endsWith('\n')) { setTimeout(() => { run.kill('SIGKILL'); }, 5000).unref(); } });
  run.stderr.on('data', chunk => { err += chunk; });
  run.on('close', finish); run.on('error', reject);
});

test('a pyramid of boxes 20 rows high stands: 210 boxes, top within 20 slops of (rows - 1/2) side, contacts carrying m g n (n + 1)(n + 2) / 6', async t => {
  const r = await S.boxPyramid(K, {rows: 20});
  t.diagnostic(`top at ${r.topHeight} m (ideal ${r.exactTopHeight}); sunk at most ${r.sunk} m; drift ${r.drift} m; tilt ${r.tilt} rad; fastest in the second half ${r.fastestLate} m/s; asleep at ${r.asleepAt} s; contact force ${r.normalForce} N (${r.exactNormalForce}); ${r.pairs} pairs`);
  assert.equal(r.boxes, 210);
  // Every resting contact sinks by up to one linear slop (5 mm), and the top box stands on 19 of them.
  assert.ok(r.exactTopHeight - r.topHeight >= 0 && r.exactTopHeight - r.topHeight < 20 * S.LINEAR_SLOP, `top height, got ${r.topHeight}`);
  assert.ok(r.sunk < 20 * S.LINEAR_SLOP, `no box sank more than its stack of slops, got ${r.sunk}`);
  assert.ok(r.drift < 0.02, `no box left its place by more than 2 cm, got ${r.drift}`); assert.ok(r.tilt < 0.02, `no box tilted, got ${r.tilt} rad`);
  assert.ok(r.fastestLate < 0.02, `at rest in the second half of the run, fastest ${r.fastestLate} m/s`);
  assert.ok(r.asleepAt !== null && r.asleepAt < 10, `the pyramid falls asleep, got ${r.asleepAt}`);
  // Every layer carries the weight above it: the vertical sum is m g n (n + 1)(n + 2) / 6. A pyramid of boxes is statically
  // indeterminate, and the side contacts between neighbours carry lateral forces that statics does not fix (+1.1% at
  // 20 rows), so the total is only bounded: all the weight is carried, and nothing runs away.
  assert.ok(r.normalForce >= 0.999 * r.exactNormalForce && r.normalForce <= 1.03 * r.exactNormalForce, `force carried by all contacts: ${r.normalForce} against ${r.exactNormalForce}`);
  assert.equal(r.pairs, r.exactPairs, 'one contact pair under every box and one between each box and the two below it');
  assert.ok(r.deepest <= 1.5 * S.LINEAR_SLOP, `overlap, got ${r.deepest}`);
  assert.equal((await S.boxPyramid(K, {rows: 20})).hash, r.hash, 'the same every time');
});

// What "stable" means for a pile, and why these numbers:
// - every body finite and inside its pit, and nothing ever faster than free fall from the top of the drop;
// - the kinetic energy left at the end is a vanishing share of what the fall released (an explosion or a slow
//   energy gain would show here);
// - contacts overlap at the end by at most `depth` (Box3D's soft contacts at 30 Hz sink under load; at rest a
//   pile of rigid shapes sits within a few linear slops). During the first impacts at 60 Hz overlaps reach
//   10 to 16 cm (bodies arrive at up to 7 m/s, 12 cm per step) and are pushed out at 3 m/s; that is bounded too.
// Large piles do not all fall asleep within 10 s (contact jitter of a few cm/s keeps one big island awake), so
// sleep is reported, not required.
const stable = (r, label, {depth, kinetic = 1e-4, fastest = 1}) => {
  assert.equal(r.bad, 0, `${label}: every body finite`); assert.equal(r.outside, 0, `${label}: every body inside the pit`);
  assert.ok(r.fastestEver <= r.freeFall * 1.05, `${label}: nothing ever moved faster than free fall from the top (${r.freeFall} m/s), got ${r.fastestEver}`);
  assert.ok(r.kinetic <= kinetic * r.released, `${label}: kinetic energy left ${r.kinetic} J of ${r.released} J released`);
  assert.ok(r.fastest < fastest, `${label}: fastest body at the end ${r.fastest} m/s`);
  assert.ok(r.deepest < depth, `${label}: overlap at the end under ${depth} m, got ${r.deepest}`);
  assert.ok(r.deepestEver < 0.25, `${label}: overlap during the impacts under 0.25 m, got ${r.deepestEver}`);
};

test('a pile of 5,000 spheres, boxes and capsules falls into a pit and comes to rest: nothing escapes, nothing explodes, overlap bounded', async t => {
  const r = await S.pile(K, {count: 5000, seconds: 10, clock});
  t.diagnostic(`5,000 bodies, ${r.tick} steps: fastest ever ${r.fastestEver} m/s (free fall ${r.freeFall}); kinetic energy left ${r.kinetic} J of ${r.released} J released; overlap at the end ${r.deepest} m, during the impacts ${r.deepestEver} m; fastest at the end ${r.fastest} m/s; ${r.awake} awake; ${r.pairs} contact pairs; step median ${r.medianStepMs} ms, worst ${r.worstStepMs} ms (one thread; not asserted)`);
  assert.equal(r.count, 5000);
  stable(r, '5,000-body pile', {depth: 0.02});
});

test('a pile of 1,000 convex hulls comes to rest the same way', async t => {
  const r = await S.pile(K, {count: 1000, kind: 'hull', seconds: 10, clock});
  t.diagnostic(`1,000 hulls, ${r.tick} steps: fastest ever ${r.fastestEver} m/s (free fall ${r.freeFall}); kinetic energy left ${r.kinetic} J of ${r.released} J; overlap at the end ${r.deepest} m, during the impacts ${r.deepestEver} m; ${r.awake} awake; step median ${r.medianStepMs} ms, worst ${r.worstStepMs} ms (not asserted)`);
  stable(r, '1,000-hull pile', {depth: 0.02});
  assert.equal(r.awake, 0, 'the hull pile falls asleep');
});

test('a pile of 60 ragdolls (600 bodies, 540 joints with limits): no joint comes apart, nothing escapes, the energy dies away; stiffer at 8 sub-steps with match-substeps', async t => {
  const r = await S.ragdollPile(K, {count: 60, seconds: 10});
  t.diagnostic(`60 ragdolls: joint separation at worst ${r.worstSeparation} m, at the end ${r.endSeparation} m; kinetic energy left ${r.kinetic} J of ${r.released} J; overlap at the end ${r.deepest} m, during the impacts ${r.deepestEver} m; fastest at the end ${r.fastest} m/s; ${r.awake} awake`);
  assert.equal(r.joints, 540);
  // A ragdoll limb wedged between a wall, the floor and its neighbours jitters at up to about half a metre per second
  // without going anywhere; at 4 sub-steps its joints (60 Hz) and contacts (30 Hz) are soft enough to hold limbs
  // a few centimetres into each other under the pile's weight.
  stable(r, 'ragdoll pile', {depth: 0.08});
  assert.ok(r.worstSeparation < 0.05, `no joint ever opened by 5 cm, worst ${r.worstSeparation}`); assert.ok(r.endSeparation < 0.02, `joints within 2 cm at the end, worst ${r.endSeparation}`);
  const stiff = await S.ragdollPile(K, {count: 60, seconds: 10, worldOptions: {subSteps: 8, jointStiffness: 'match-substeps', contactStiffness: 'match-substeps'}});
  t.diagnostic(`at 8 sub-steps with match-substeps: separation at the end ${stiff.endSeparation} m, overlap at the end ${stiff.deepest} m, kinetic ${stiff.kinetic} J, fastest ${stiff.fastest} m/s`);
  stable(stiff, 'ragdoll pile, 8 sub-steps, match-substeps', {depth: 0.02, fastest: 2});
  assert.ok(stiff.endSeparation < 0.005, `stiffer joints at 8 sub-steps: within 5 mm, got ${stiff.endSeparation}`);
});

test('threads: a 1,500-body pile gives the same exactHash and replayHash on 1, 2 and 4 threads, at four moments of the fall', async t => {
  const spec = {count: 1500, seconds: 4, marks: [1, 60, 120, 240]};
  const [one, two, four, idle] = [await child({...spec, threads: 1}), await child({...spec, threads: 2}), await child({...spec, threads: 4}), await child({...spec, threads: 2, threshold: 1000000})];
  t.diagnostic(`exactHash ${one.hash} on 1 thread; threads used at most: ${two.mostThreads} of 2, ${four.mostThreads} of 4, ${idle.mostThreads} with the threshold out of reach`);
  assert.deepEqual([one.threads, two.threads, four.threads], [1, 2, 4]);
  assert.equal(two.mostThreads, 2, 'the pile was stepped on 2 threads'); assert.equal(four.mostThreads, 4, 'and on 4'); assert.equal(idle.mostThreads, 1, 'below the threshold a world stays on one thread');
  assert.equal(Object.keys(one.hashes).length, 4);
  for (const [label, other] of [['2 threads', two], ['4 threads', four], ['the pthread artifact on one thread', idle]]) {
    assert.deepEqual(other.hashes, one.hashes, `${label}: state at steps 1, 60, 120 and 240`);
    assert.deepEqual([other.hash, other.replayHash], [one.hash, one.replayHash], `${label}: final state`);
  }
  assert.equal(one.bad + one.outside, 0);
});

test('threads: the option is checked, and the single-threaded default says so', async () => {
  for (const threads of [0, 1.5, 33, -2, NaN]) await assert.rejects(K.createWorld({threads}), error => error.code === 'INVALID_PAYLOAD' && /threads must be a whole number from 1 to 32/.test(error.message), String(threads));
  await assert.rejects(K.createWorld({threads: 2, threadThreshold: -1}), error => error.code === 'INVALID_PAYLOAD');
  const world = await K.createWorld();
  try { assert.deepEqual([world.threading.threads, world.threading.lastStepThreads()], [1, 1]); assert.equal(K.box3dThreading(await K.loadBox3D()).threads, 1); } finally { world.dispose(); }
  assert.match(K.BUILD_INFO.threadedWasmSha256, /^[0-9a-f]{64}$/); assert.ok(K.BUILD_INFO.threadedWasmBytes > 100000);
});
