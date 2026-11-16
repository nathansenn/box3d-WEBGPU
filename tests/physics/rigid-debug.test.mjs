// The Physics Lab's rigid debug draw (src/lab/rigid-debug.ts): the address parameter, the engine options, the
// conversion of Box3D's debug vertices into the renderers' line records, and the overlay's caching. Runs on the real
// engine artifact; nothing here needs a browser.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {
  RIGID_DEBUG_LAYERS, RIGID_DEBUG_LINE_LIMIT, RIGID_DEBUG_OFF, RigidDebugOverlay, debugLinesToOverlay, parseRigidDebugParam, rigidDebugOptions, rigidDebugParam,
} from '../../src/lab/rigid-debug.ts';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));

test('?debug= is read into a state and written back', () => {
  for (const off of [null, undefined, '', '0', 'off', 'false', 'no', 'nonsense', ' ']) assert.equal(parseRigidDebugParam(off), RIGID_DEBUG_OFF, String(off));
  const on = parseRigidDebugParam('1');
  assert.deepEqual(on, {enabled: true, layers: {contacts: true, normals: true, joints: true, bounds: false, mass: true, islands: false}});
  assert.deepEqual(parseRigidDebugParam('TRUE'), on); assert.deepEqual(parseRigidDebugParam('on'), on);
  assert.equal(rigidDebugParam(on), '1'); assert.equal(rigidDebugParam(RIGID_DEBUG_OFF), null);
  const some = parseRigidDebugParam('joints, bounds');
  assert.deepEqual(some.layers, {contacts: false, normals: false, joints: true, bounds: true, mass: false, islands: false});
  assert.equal(rigidDebugParam(some), 'joints,bounds');
  const all = parseRigidDebugParam('all');
  assert.ok(RIGID_DEBUG_LAYERS.every(layer => all.layers[layer])); assert.equal(rigidDebugParam(all), 'all');
  // Every state the panel can show survives a round trip through the address.
  for (let bits = 1; bits < 1 << RIGID_DEBUG_LAYERS.length; bits++) {
    const state = {enabled: true, layers: Object.fromEntries(RIGID_DEBUG_LAYERS.map((layer, i) => [layer, (bits >> i & 1) === 1]))};
    assert.deepEqual(parseRigidDebugParam(rigidDebugParam(state)), state);
  }
  assert.equal(rigidDebugParam({enabled: true, layers: Object.fromEntries(RIGID_DEBUG_LAYERS.map(layer => [layer, false]))}), null, 'no layer is the same as off');
  // Normals need the contact points they start from.
  assert.equal(rigidDebugOptions(parseRigidDebugParam('normals')).contacts, true);
  assert.equal(rigidDebugOptions(parseRigidDebugParam('joints')).contacts, false);
});

test('the engine draws a known scene as the expected lines, and the overlay asks again only when something changed', () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: true, gravity: [0, -9.81, 0]});
    const a = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0, 0.5, 0]});
    const b = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [3, 2, 0]});
    world.createJoint({type: 'revolute', bodyA: null, bodyB: b, frameA: {position: [3, 3, 0]}, frameB: {position: [0, 1, 0]}});
    for (let i = 0; i < 30; i++) world.step(1 / 240, 4);
    // Bounds only: 12 edges for each of the three shapes (ground, box, ball).
    const bounds = world.debugLines(rigidDebugOptions(parseRigidDebugParam('bounds')));
    assert.equal(bounds.vertexCount, 3 * 24);
    const lines = debugLinesToOverlay(bounds);
    assert.equal(lines.length, 36);
    for (const line of lines) {
      for (const key of ['ax', 'ay', 'az', 'bx', 'by', 'bz']) assert.ok(Number.isFinite(line[key]), key);
      for (const key of ['r', 'g', 'b']) assert.ok(line[key] >= 0.18 && line[key] <= 1, 'colours are lifted off black and stay in range');
      assert.equal(line.a, 0.95);
    }
    // The box's bounds are among them: an edge along x at its top, 1 m long (plus Box3D's bounds margin).
    assert.ok(lines.some(line => Math.abs(line.ay - line.by) < 1e-6 && Math.abs(line.az - line.bz) < 1e-6 && Math.abs(Math.abs(line.bx - line.ax) - 1) < 0.3 && line.ay > 0.9 && line.ay < 1.2));
    // Records are reused: a second conversion into the same array keeps its objects and its length follows the input.
    const first = lines[0];
    assert.equal(debugLinesToOverlay(bounds, lines)[0], first);
    assert.equal(debugLinesToOverlay({positions: bounds.positions, colors: bounds.colors, vertexCount: 4}, lines).length, 2);
    assert.equal(debugLinesToOverlay(bounds, [], 5).length, 5, 'the limit cuts the list');
    assert.ok(RIGID_DEBUG_LINE_LIMIT >= 10000);

    // The overlay: contact points of the resting box (four of them), joints and mass centres with ?debug=1.
    const overlay = new RigidDebugOverlay(), state = parseRigidDebugParam('1');
    let calls = 0;
    const counted = {supportsRigidCore: true, debugLines: options => { calls++; return world.debugLines(options); }};
    const drawn = overlay.update(counted, state, world.frameVersion());
    assert.ok(drawn.length > 12 && overlay.vertexCount === drawn.length * 2 && !overlay.truncated);
    const version = overlay.version;
    assert.equal(overlay.update(counted, state, world.frameVersion()), drawn);
    assert.equal(calls, 1, 'the same frame and layers: the engine is not asked again'); assert.equal(overlay.version, version);
    world.step(1 / 240, 4);
    overlay.update(counted, state, world.frameVersion());
    assert.equal(calls, 2, 'after a step it is'); assert.notEqual(overlay.version, version);
    overlay.update(counted, parseRigidDebugParam('bounds'), world.frameVersion());
    assert.equal(calls, 3, 'and after a change of layers'); assert.equal(overlay.lines.length, 36);
    // Off, no world, or an artifact without the calls: no lines, and the version says so once.
    const before = overlay.version;
    assert.equal(overlay.update(counted, RIGID_DEBUG_OFF, world.frameVersion()).length, 0);
    assert.notEqual(overlay.version, before);
    const off = overlay.version;
    assert.equal(overlay.update(null, state, 1).length, 0);
    assert.equal(overlay.update({supportsRigidCore: false, debugLines: () => { throw new Error('must not be called'); }}, state, 2).length, 0);
    assert.equal(overlay.version, off, 'staying off changes nothing');
    // Drawing never moves the world.
    const hash = world.replayHash();
    world.debugLines({joints: true, jointExtras: true, bounds: true, mass: true, contacts: true, contactNormals: true, contactForces: true, frictionForces: true, islands: true, graphColors: true});
    assert.equal(world.replayHash(), hash);
    void a;
  } finally { world.destroy(); }
});
