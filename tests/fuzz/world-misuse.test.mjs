// API misuse of the rigid world (docs/ROBUSTNESS.md, docs/ERRORS.md).
//
// Every public method of the kit's PhysicsWorld has a row below with valid arguments. For each row the harness
// (lib/misuse.mjs) replaces one leaf of the arguments at a time with every hostile value of its kind (NaN, infinities,
// values outside float32, zero and negative sizes, wrong types, wrong vector shapes, destroyed handles, handles of
// another world, forged handles, unknown names) and requires: a refusal is an EngineError of the taxonomy and leaves
// the world's checkpoint byte-identical; an accepted value leaves every number finite after two more steps. A raw
// TypeError, a WASM trap or a changed world after a refusal fails the test. A public method without a row fails it too.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {kit, taxonomy} from './lib/kit.mjs';
import {hashBytes} from './lib/rng.mjs';
import {runRecipe} from './lib/misuse.mjs';
import {publicMethods} from './lib/api.mjs';

const {createWorld, PhysicsWorld, ENGINE_ERRORS} = kit;
const tax = taxonomy(ENGINE_ERRORS);
const world = await createWorld({gravity: [0, -9.81, 0]}), other = await createWorld({gravity: [0, -9.81, 0]});
test.after(() => { world.dispose(); other.dispose(); });

// One scene with every kind of thing a call can name. build() makes it again after a call that resets the world:
// a reset starts a new generation of handles, so a checkpoint restored afterwards does not bring the old handles back.
let box, ball, mover, post, wheelBody, dead, hinge, wheel, deadJoint, base;
const foreign = other.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 1, 0]});
const foreignJoint = other.createJoint({type: 'weld', bodyA: foreign, bodyB: null});
const handles = new Map();
function build() {
  world.reset({gravity: [0, -9.81, 0]});
  box = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0, 2, 0]});
  ball = world.createBody({shape: {kind: 'sphere', radius: 0.4}, position: [2, 3, 0], hitEvents: true});
  mover = world.createBody({shape: {kind: 'capsule', radius: 0.2, halfLength: 0.4}, type: 'kinematic', position: [-2, 1, 0]});
  post = world.createBody({shape: {kind: 'box', halfExtents: [0.2, 1, 0.2]}, type: 'static', position: [4, 1, 0]});
  wheelBody = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 0.3, 3]});
  dead = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 9, 0]});
  world.destroyBody(dead);
  hinge = world.createJoint({type: 'revolute', bodyA: post, bodyB: box, frameA: {position: [0, 1, 0]}, limits: {lower: -1, upper: 1}, motor: {speed: 1, maxForce: 10}, spring: {hertz: 2, dampingRatio: 0.5}});
  wheel = world.createJoint({type: 'wheel', bodyA: box, bodyB: wheelBody, frameA: {position: [0, -0.5, 0]}});
  deadJoint = world.createJoint({type: 'weld', bodyA: box, bodyB: ball});
  world.destroyJoint(deadJoint);
  for (let i = 0; i < 5; i++) world.step();
  world.setUserData(box, 'crate');
  const bodyHostiles = [['a destroyed body', dead], ['a body of another world', foreign], ['a joint in place of a body', hinge]];
  const jointHostiles = [['a destroyed joint', deadJoint], ['a joint of another world', foreignJoint], ['a body in place of a joint', box]];
  handles.clear();
  for (const h of [box, ball, mover, post, wheelBody]) handles.set(h, bodyHostiles);
  for (const h of [hinge, wheel]) handles.set(h, jointHostiles);
  base = world.checkpoint();
}
build();
const POSITIVE = /(radius|halfExtents|halfLength|halfSize|spacing|mass|inertia\.[012]|countX|countZ)$/;

const states = () => { const out = []; for (let row = 0; row < world.bodyCount(); row++) out.push(world.getState(world.bodyAt(row))); return out; };
const subject = {
  digest: () => `${hashBytes(world.checkpoint())}:${world.bodyCount()}:${world.tick}:${String(world.getUserData(box))}:${world.isRecording}`,
  restore: () => { world.restoreCheckpoint(base); world.setUserData(box, 'crate'); },
  health: () => {
    const check = when => {
      for (const [row, state] of states().entries()) for (const [key, value] of Object.entries(state)) {
        const numbers = Array.isArray(value) ? value : typeof value === 'number' ? [value] : [];
        if (!numbers.every(Number.isFinite)) throw new Error(`body row ${row} ${key} is not finite ${when}: ${JSON.stringify(value)}`);
      }
      const m = world.matrices();
      for (let i = 0; i < m.length; i++) if (!Number.isFinite(m[i])) throw new Error(`matrix value ${i} is not finite ${when}`);
    };
    check('right after the call'); world.step(); world.step(); check('two steps later');
  },
};

const hull = [-0.5, -0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, -0.5, -0.5, 0.5, -0.5, -0.5, -0.5, 0.5, 0.5, -0.5, 0.5, 0.5, 0.5, 0.5, -0.5, 0.5, 0.5];
const dynamicOptions = shape => ({shape, type: 'dynamic', position: [1, 4, 1], rotation: [0, 0, 0, 1], linearVelocity: [0, 1, 0], angularVelocity: [0, 0, 1], density: 800, friction: 0.5, restitution: 0.1, color: 0x336699,
  bullet: false, sensor: false, hitEvents: true, neverSleeps: false, lockRotation: false, linearDamping: 0.1, angularDamping: 0.1, gravityScale: 1, filter: {categoryBits: 1n, maskBits: 0xffffn, groupIndex: 0}});
const jointOptions = (type, extra = {}) => ({type, bodyA: box, bodyB: ball, frameA: {position: [0, 0.5, 0], rotation: [0, 0, 0, 1]}, frameB: {position: [0, -0.5, 0], rotation: [0, 0, 0, 1]}, collideConnected: false, ...extra});
const lenientAlpha = /^0$/;
// isAlive, destroyBody, getPose and the joint equivalents answer false or null for a destroyed handle: that is their job.
const deadOkHandles = () => new Map([...handles].map(([handle, hostiles]) => [handle, hostiles.filter(([why]) => !why.startsWith('a destroyed'))]));

// name -> rows. `args` builds fresh valid arguments; `hints` says what each leaf must refuse.
const ROWS = {
  // A seed is any finite number, reduced modulo 2^32.
  resetArena: [{resets: true, args: () => [7], hints: {wide: /^0$/}}],
  loadPreset: [{resets: true, args: () => [3, 1, 7], hints: {integer: /^0$/, positive: /^1$/, wide: /^2$/}}],
  reset: [{resets: true, args: () => [{ground: true, gravity: [0, -9.81, 0], seed: 3}], hints: {wide: /seed$/}}],
  setGravity: [{args: () => [[0, -3, 0]]}],
  gravity: [{args: () => []}],
  createBody: [
    {args: () => [dynamicOptions({kind: 'box', halfExtents: [0.3, 0.4, 0.5]})], hints: {positive: POSITIVE, integer: /color$|groupIndex$/}},
    {args: () => [dynamicOptions({kind: 'sphere', radius: 0.3})], hints: {positive: POSITIVE}},
    {args: () => [dynamicOptions({kind: 'capsule', radius: 0.2, halfLength: 0.5})], hints: {positive: POSITIVE}},
    {args: () => [dynamicOptions({kind: 'hull', points: hull})], hints: {positive: /^$/}},
    {args: () => [{shape: {kind: 'compound', shapes: [{shape: {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, position: [0.4, 0, 0], rotation: [0, 0, 0, 1], density: 500, friction: 0.4, restitution: 0.1}, {shape: {kind: 'sphere', radius: 0.25}, position: [-0.4, 0, 0]}, {shape: {kind: 'hull', points: hull}}]}, position: [1, 5, 1]}], hints: {positive: POSITIVE}},
    {args: () => [{shape: {kind: 'mesh', vertices: [0, 0, 0, 4, 0, 0, 4, 0, 4, 0, 0, 4, 2, 1, 2], indices: [0, 4, 1, 1, 4, 2, 2, 4, 3, 3, 4, 0]}, position: [8, 0, 8]}], hints: {integer: /indices/}},
    {args: () => [{shape: {kind: 'heightfield', heights: [0, 0.1, 0.2, 0.1, 0.3, 0.1, 0, 0.2, 0.1], countX: 3, countZ: 3, spacing: [1, 1]}, position: [-9, 0, -9]}], hints: {positive: POSITIVE, integer: /count[XZ]$/}},
    {args: () => [{shape: {kind: 'sphere', radius: 0.3}, position: [3, 3, 3], massData: {mass: 2, center: [0, 0.1, 0], inertia: [0.1, 0.1, 0.1, 0, 0, 0]}}], hints: {positive: POSITIVE}},
  ],
  setMassData: [{args: () => [box, {mass: 3, center: [0, 0.1, 0], inertia: [0.5, 0.6, 0.7, 0.01, 0, 0]}], hints: {positive: /mass$|inertia\.[012]$/}}],
  resetMassData: [{args: () => [box]}],
  getMassData: [{args: () => [box]}],
  getState: [{args: () => [box]}],
  setTransform: [{args: () => [box, [1, 3, 1], [0, 0.7071067811865476, 0, 0.7071067811865476]]}],
  setVelocity: [{args: () => [box, [1, 0, 0], [0, 1, 0]]}],
  moveKinematic: [{args: () => [mover, [-2, 1.5, 0], [0, 0, 0, 1], 1 / 60], hints: {positive: /^3$/}}],
  setBodyType: [{args: () => [box, 'kinematic']}],
  setAwake: [{args: () => [box, false]}],
  setGravityScale: [{args: () => [box, 0.5]}],
  setDamping: [{args: () => [box, 0.2, 0.3]}],
  setCollisionFilter: [{args: () => [box, 2n, 0xffn, -1], hints: {integer: /^3$/}}],
  applyForce: [{args: () => [box, [0, 50, 0], [0.1, 2, 0]]}, {args: () => [box, [0, 50, 0]]}],
  applyTorque: [{args: () => [box, [0, 5, 0]]}],
  applyImpulseAt: [{args: () => [box, [0, 5, 0], [0.1, 2, 0]]}],
  applyAngularImpulse: [{args: () => [box, [0, 1, 0]]}],
  applyImpulse: [{args: () => [box, [0, 5, 0]]}],
  explode: [{args: () => [[0, 1, 0], 20, 5]}],
  createJoint: [
    {args: () => [jointOptions('weld', {spring: {hertz: 5, dampingRatio: 0.7}, stiffness: {hertz: 30, dampingRatio: 2}})], hints: {positive: /stiffness\.hertz$/}},
    {args: () => [jointOptions('revolute', {limits: {lower: -1, upper: 1}, motor: {speed: 1, maxForce: 10}, spring: {hertz: 2, dampingRatio: 0.5, target: 0.1}})]},
    {args: () => [jointOptions('spherical', {coneAngle: 0.5, limits: {lower: -0.5, upper: 0.5}})]},
    {args: () => [jointOptions('prismatic', {limits: {lower: -1, upper: 1}, motor: {speed: 0.5, maxForce: 100}})]},
    {args: () => [jointOptions('distance', {length: 1.5, limits: {lower: 1, upper: 2}})], hints: {positive: /length$/}},
    // With bodyB null this row would add a third, contradicting joint to the box: the known Box3D defect ND-2
    // (tests/fuzz/native-defects.test.mjs), where joints that cannot all hold give NaN. It is left out here by name.
    {args: () => [jointOptions('wheel', {limits: {lower: -0.2, upper: 0.2}, spring: {hertz: 4, dampingRatio: 0.7}, motor: {speed: 3, maxForce: 20}})], known: /bodyB = null/},
    {args: () => [{type: 'revolute', bodyA: null, bodyB: box}]},
  ],
  isJointAlive: [{deadOk: true, args: () => [hinge]}],
  destroyJoint: [{deadOk: true, args: () => [hinge]}],
  setJointMotor: [{args: () => [hinge, {speed: 2, maxForce: 30}]}],
  setJointLimits: [{args: () => [hinge, {lower: -0.5, upper: 0.5}]}],
  setJointSpring: [{args: () => [hinge, {hertz: 3, dampingRatio: 0.4, target: 0.2}]}],
  setJointStiffness: [{args: () => [hinge, 40, 1.5], hints: {positive: /^1$/}}],
  setJointSteering: [{args: () => [wheel, {angle: 0.2, hertz: 5, dampingRatio: 0.7, maxTorque: 50}]}],
  getJointState: [{args: () => [hinge]}],
  onEvent: [{args: () => [() => {}], undo: off => off()}],
  onStep: [{args: () => [() => {}], undo: off => off()}],
  bodyKinds: [{args: () => []}],
  spawnBox: [{args: () => [{position: [0, 6, 0], halfSize: 0.4, impulse: [0, 1, 0]}], hints: {positive: /halfSize$/}}],
  isAlive: [{deadOk: true, args: () => [box]}],
  // Rebuilt, not restored, afterwards: restoring a checkpoint into a world that destroyed a body since leaves the
  // handles naming other bodies (native defect ND-3, tests/fuzz/native-defects.test.mjs).
  destroyBody: [{deadOk: true, resets: true, args: () => [ball]}],
  setUserData: [{args: () => [box, 'tag'], hints: {lenient: /^1$/}}],
  // A plain lookup: anything that is not a live body of this world has no data.
  getUserData: [{args: () => [box], hints: {lenient: /^0$/}}],
  bodyAt: [{args: () => [1], hints: {integer: /^0$/}}],
  step: [{args: () => []}],
  // Time is the caller's wall clock: a negative, zero or huge frame time is clamped by the fixed-step loop, never refused.
  update: [{args: () => [1 / 60], hints: {lenient: /^0$/}}],
  // Documented: alpha outside [0, 1] is clamped and a non-finite alpha shows the latest transforms.
  interpolatedMatrices: [{args: () => [0.5], hints: {lenient: lenientAlpha}}],
  raycast: [{args: () => [[0, 10, 0], [0, -20, 0], {filter: {bodies: 'all', categoryBits: 1n, maskBits: 0xffffn, ignoreBody: ball}, limit: 4}], hints: {integer: /limit$/, positive: /limit$/}}],
  sphereCast: [{args: () => [[0, 10, 0], 0.3, [0, -20, 0], {limit: 2}], hints: {positive: /^1$|limit$/, integer: /limit$/}}],
  boxCast: [{args: () => [[0, 10, 0], [0.3, 0.3, 0.3], [0, -20, 0], {limit: 2}], hints: {positive: /^1$|limit$/, integer: /limit$/}}],
  // The third argument is options or, for short, the limit itself.
  overlapSphere: [{args: () => [[0, 1, 0], 3, {limit: 8}], hints: {positive: /^1$|limit$/, integer: /limit$/, lenient: /^2$/}}, {args: () => [[0, 1, 0], 3, 8], hints: {positive: /^1$/, lenient: /^2$/}}],
  overlapBox: [{args: () => [[0, 1, 0], [3, 3, 3], {limit: 8}], hints: {positive: /^1$|limit$/, integer: /limit$/}}],
  getPose: [{deadOk: true, args: () => [box]}],
  matrices: [{args: () => []}], colors: [{args: () => []}], bodyCount: [{args: () => []}], awakeCount: [{args: () => []}],
  replayHash: [{args: () => []}], exactHash: [{args: () => []}], transformVersion: [{args: () => []}], colorVersion: [{args: () => []}], stats: [{args: () => []}],
  checkpoint: [{args: () => []}], diagnose: [{args: () => []}],
};
// Covered by their own tests below, because their inputs are files and logs rather than values.
const OWN_TESTS = ['restoreCheckpoint', 'startRecording', 'stopRecording', 'replay', 'replayDetailed', 'dispose'];

test('every public PhysicsWorld method has a misuse row', () => {
  const declared = publicMethods('world.d.ts', 'PhysicsWorld'), runtime = Object.getOwnPropertyNames(PhysicsWorld.prototype);
  assert.ok(declared.length > 60, `the declaration parser found ${declared.length} methods`);
  const missing = declared.filter(name => runtime.includes(name) && typeof Object.getOwnPropertyDescriptor(PhysicsWorld.prototype, name).value === 'function' && !(name in ROWS) && !OWN_TESTS.includes(name));
  assert.deepEqual(missing, [], `add misuse rows for: ${missing.join(', ')}`);
  for (const name of Object.keys(ROWS)) assert.ok(declared.includes(name), `${name} has a row but is not a public method`);
});

const totals = {tried: 0, refused: 0, accepted: 0};
for (const [name, rows] of Object.entries(ROWS)) {
  test(`PhysicsWorld.${name}: hostile arguments are refused cleanly or accepted safely`, () => {
    for (const [index, row] of rows.entries()) {
      const restore = row.resets ? build : subject.restore;
      restore();
      const result = runRecipe({name: rows.length > 1 ? `${name}#${index + 1}` : name, args: row.args, hints: {handles: row.deadOk ? deadOkHandles() : handles, ...row.hints}, call: (...args) => world[name](...args), undo: row.undo}, {...subject, restore}, tax);
      totals.tried += result.tried; totals.refused += result.refused; totals.accepted += result.accepted;
      const failures = result.failures.filter(line => !(row.known?.test(line)));
      assert.deepEqual(failures.slice(0, 25), [], `${failures.length} of ${result.tried} hostile calls broke the contract`);
      // The valid call itself must work, or the row tests nothing.
      restore();
      assert.doesNotThrow(() => { const returned = world[name](...row.args()); row.undo?.(returned); }, `the valid ${name} call of this row`);
      restore();
    }
  });
}
test('misuse totals', () => {
  console.log(`world misuse: ${totals.tried} hostile calls over ${Object.keys(ROWS).length} methods; ${totals.refused} refused, ${totals.accepted} accepted with the world healthy`);
  assert.ok(totals.tried > 5000);
});

test('restoreCheckpoint refuses damaged, truncated and foreign checkpoints and changes nothing', () => {
  build();
  const good = world.checkpoint(), before = subject.digest();
  const refuse = (bytes, what) => {
    let thrown; try { world.restoreCheckpoint(bytes); } catch (error) { thrown = error; }
    assert.ok(thrown, `${what}: accepted`);
    assert.equal(tax.problem(thrown), null, `${what}: ${tax.problem(thrown)}`);
    assert.equal(subject.digest(), before, `${what}: refused but the world changed`);
  };
  for (const cut of [0, 1, 7, 8, 16, 31, 32, 64, good.length >> 1, good.length - 1]) refuse(good.slice(0, cut), `truncated to ${cut} bytes`);
  for (let i = 0; i < good.length; i += Math.max(1, Math.floor(good.length / 257))) { const bad = good.slice(); bad[i] ^= 0x40; refuse(bad, `bit flipped at byte ${i}`); }
  const longer = new Uint8Array(good.length + 5); longer.set(good); refuse(longer, 'five trailing bytes');
  for (const bad of [null, undefined, 7, 'x', {}, [], new Float32Array(8), new ArrayBuffer(64), good.buffer.slice(0, 16), new Uint8Array(1 << 20)]) refuse(bad, `a ${bad === null ? 'null' : bad?.constructor?.name ?? typeof bad}`);
  refuse(other.checkpoint().slice(0, 40), 'a truncated checkpoint of another world');
  world.restoreCheckpoint(good);
  assert.equal(subject.digest(), before);
});

test('replay refuses malformed logs with an EngineError and never runs unbounded work', () => {
  const session = () => {
    world.startRecording({checkpointEvery: 4, world: {ground: true, gravity: [0, -9.81, 0]}});
    const a = world.createBody({shape: {kind: 'box', halfExtents: [0.4, 0.4, 0.4]}, position: [0, 3, 0]});
    const b = world.spawnBox({position: [0.2, 5, 0], halfSize: 0.3});
    const joint = world.createJoint({type: 'distance', bodyA: a, bodyB: b, length: 2});
    for (let i = 0; i < 6; i++) world.step();
    world.applyImpulse(a, [1, 0, 0]); world.explode([0, 0, 0], 5, 4); world.setJointSpring(joint, {hertz: 2, dampingRatio: 0.3});
    for (let i = 0; i < 6; i++) world.step();
    world.destroyBody(b);
    for (let i = 0; i < 4; i++) world.step();
    return world.stopRecording();
  };
  const log = JSON.parse(JSON.stringify(session()));
  assert.equal(world.replay(log), true, 'the unmodified log replays exactly');
  // A replay resets the world before it runs the log, so a log refused part-way leaves the world it reached; a log refused
  // by the shape check leaves the world untouched (tested with the plain list below).
  const replaySubject = {digest: () => 'reset by replay', restore: () => world.reset({gravity: [0, -9.81, 0]}), health: subject.health};
  // Step counts in a log are trusted to be the recorded ones only up to the stated bound; beyond it the log is refused.
  const result = runRecipe({name: 'replayDetailed', args: () => [log], hints: {integer: /ticks$|\.t$|seed$|subSteps$|row$|checkpoints\.\d+\.[01]$|finalHash$|version$/, lenient: /finalHash$|checkpoints\.\d+\.1$|\.args|halfSize$|strength$|radius$|impulse|position|center|gravity/}, call: bad => world.replayDetailed(bad)}, replaySubject, tax);
  assert.deepEqual(result.failures.slice(0, 25), [], `${result.failures.length} of ${result.tried} hostile logs broke the contract`);
  for (const bad of [null, undefined, 7, 'log', [], {}, {version: 2}, {...log, commands: 'x'}, {...log, ticks: 1e15}, {...log, ticks: -1}, {...log, commands: [{t: 0, op: 'call', method: 'dispose', args: []}]},
    {...log, commands: [{t: 0, op: 'call', method: 'constructor', args: []}]}, {...log, commands: [{t: 0, op: 'call', method: '__proto__', args: []}]}, {...log, commands: [{t: 0, op: 'nope'}]},
    {...log, commands: [{t: 5, op: 'destroyBody', row: 99}]}, {...log, commands: [{t: 0, op: 'call', method: 'createJoint', args: [{type: 'weld', bodyA: {$body: 99}, bodyB: {$joint: 4}}]}]}]) {
    let thrown; try { world.replayDetailed(bad); } catch (error) { thrown = error; }
    assert.ok(thrown, `replayDetailed(${JSON.stringify(bad)?.slice(0, 80)}) was accepted`);
    assert.equal(tax.problem(thrown), null, `replayDetailed(${JSON.stringify(bad)?.slice(0, 80)}): ${tax.problem(thrown)}`);
    assert.equal(world.isRecording, false);
  }
  build();
  const untouched = subject.digest();
  for (const bad of [null, 7, {}, {...log, ticks: Infinity}, {...log, commands: [{t: 0, op: 'call', method: 'dispose', args: []}]}, {...log, checkpoints: 'x'}]) {
    assert.throws(() => world.replayDetailed(bad), error => tax.problem(error) === null);
    assert.equal(subject.digest(), untouched, 'a log refused by its shape leaves the world untouched');
  }
  for (const bad of [{checkpointEvery: -1}, {checkpointEvery: 1.5}, {checkpointEvery: NaN}, {checkpointEvery: 'x'}, {world: {gravity: [NaN, 0, 0]}}, {world: 7}, 7, 'x']) {
    let thrown; try { world.startRecording(bad); } catch (error) { thrown = error; }
    assert.ok(thrown, `startRecording(${JSON.stringify(bad)}) was accepted`);
    assert.equal(tax.problem(thrown), null, `startRecording(${JSON.stringify(bad)}): ${tax.problem(thrown)}`);
    assert.equal(world.isRecording, false, `startRecording(${JSON.stringify(bad)}) left a recording running`);
  }
  assert.throws(() => world.stopRecording(), error => tax.problem(error) === null && error.code === 'INVALID_STATE');
});

test('a disposed world refuses every call with DISPOSED', async () => {
  const gone = await createWorld({gravity: [0, -9.81, 0]});
  const body = gone.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 1, 0]});
  gone.dispose();
  for (const [name, rows] of Object.entries(ROWS)) {
    if (['onEvent', 'onStep', 'getUserData', 'interpolatedMatrices'].includes(name)) continue; // listeners and plain maps: nothing native to refuse
    const args = name === 'gravity' || rows[0].args().length === 0 ? [] : rows[0].args().map(arg => handles.has(arg) ? body : arg);
    assert.throws(() => gone[name](...args), error => tax.problem(error) === null && ['DISPOSED', 'INVALID_PAYLOAD'].includes(error.code), `${name} on a disposed world`);
  }
  assert.doesNotThrow(() => gone.dispose(), 'dispose twice');
});

test('the public API listing names the taxonomy', () => {
  const api = readFileSync(new URL('../../packages/box3d-kit/api/public-api.txt', import.meta.url), 'utf8');
  for (const name of ['ENGINE_ERRORS', 'isEngineError', 'explainError', 'EngineErrorCode']) assert.ok(api.includes(name), `${name} is exported`);
});
