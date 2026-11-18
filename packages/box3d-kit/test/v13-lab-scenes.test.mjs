// The Physics Lab loads scene files with the same builder as the kit, through its own SceneHost
// (src/lab/scene-host.ts) on a NativeWorldBackend. This checks that the two paths are the same
// simulation: for every example scene, the kit's loadScene on a PhysicsWorld and the Lab's
// loadLabScene give equal exactHash and replayHash values before the first step and after
// 1, 60 and 300 steps, and equal saved scenes.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createWorld} from '../dist/index.js';
import {NativeWorldPool} from '../dist/core/native-world.js';
import {EXAMPLE_SCENES, canonicalize, encodeSceneLink, decodeSceneLink, loadScene, sceneWorldOptions} from '../dist/scene.js';
import {LabSceneHost, loadLabScene, sceneStepsPerLabTick} from '../../../src/lab/scene-host.ts';
import {EXAMPLE_SCENE_NAMES, resolveSceneRequest} from '../../../src/lab/scene-loading.ts';
import {showcaseScene} from '../../../tests/physics/lab-scene-fixtures.mjs';

const wasm = name => fileURLToPath(new URL(`../wasm/${name}`, import.meta.url));
const {default: factory} = await import(wasm('box3d.js'));
// The Lab's worlds come from a pool on the module the page loaded; here it is a second instance of the same artifact.
const labPool = new NativeWorldPool(await factory({wasmBinary: await readFile(wasm('box3d.wasm'))}));
const CHECKPOINTS = [0, 1, 60, 300];

async function viaKit(scene) {
  const world = await createWorld(sceneWorldOptions(scene));
  try {
    const loaded = loadScene(world, scene), hashes = [];
    const saved = canonicalize(loaded.builder.toJSON());
    for (const ticks of CHECKPOINTS) { while (world.tick < ticks) world.step(); hashes.push([world.exactHash(), world.replayHash()]); }
    return {hashes, saved, resumed: canonicalize(loaded.builder.toJSON()), bodies: world.bodyCount(), kinds: world.bodyKinds()};
  } finally { world.dispose(); }
}
function viaLab(scene) {
  const native = labPool.createWorld();
  try {
    native.retainBodyShapes(true);
    const loaded = loadLabScene(native, scene), host = loaded.builder.world, hashes = [];
    assert.ok(host instanceof LabSceneHost);
    const saved = canonicalize(loaded.builder.toJSON());
    for (const ticks of CHECKPOINTS) { while (host.tick < ticks) host.step(); hashes.push([host.exactHash(), host.replayHash()]); }
    return {hashes, saved, resumed: canonicalize(loaded.builder.toJSON()), bodies: native.bodyCount(), kinds: native.bodyKinds()};
  } finally { native.destroy(); }
}

test('the Lab lists exactly the kit\'s example scenes', () => {
  assert.deepEqual(EXAMPLE_SCENE_NAMES, Object.keys(EXAMPLE_SCENES));
});

for (const name of Object.keys(EXAMPLE_SCENES)) {
  test(`${name}: the Lab's scene path and the kit's loadScene are the same simulation`, async () => {
    const scene = EXAMPLE_SCENES[name]();
    const read = resolveSceneRequest({kind: 'example', name});
    assert.equal(read.ok, true);
    const kit = await viaKit(scene), lab = viaLab(read.scene);
    assert.deepEqual(lab.hashes, kit.hashes, 'exactHash and replayHash at ticks 0, 1, 60 and 300');
    assert.notDeepEqual(kit.hashes[0], kit.hashes[3], 'the scene moved, so equal hashes mean something');
    assert.equal(lab.saved, kit.saved, 'saved before the first step');
    assert.equal(lab.saved, canonicalize(scene), 'which is the scene itself');
    assert.equal(lab.resumed, kit.resumed, 'saved after 300 steps: the same poses and velocities');
    assert.deepEqual([lab.bodies, lab.kinds], [kit.bodies, kit.kinds]);
    assert.ok(Number.isInteger(sceneStepsPerLabTick(scene.world.step)));
  });
}

test('a scene with hulls, a mesh and a height field, opened from a share link, matches too', async () => {
  const scene = showcaseScene(), link = await encodeSceneLink(scene);
  const read = resolveSceneRequest({kind: 'link', text: `https://example.org/lab.html?scene=${link}`});
  assert.equal(read.ok, true);
  const kit = await viaKit(decodeSceneLink(link)), lab = viaLab(read.scene);
  assert.deepEqual(lab.hashes, kit.hashes);
  assert.equal(lab.resumed, kit.resumed);
  assert.deepEqual(lab.kinds.slice(0, 3), ['heightfield', 'mesh', 'hull']);
});
