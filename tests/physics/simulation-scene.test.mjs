// Scenes with coupled sections (src/engine/scene-format.ts) need a Simulation (src/engine/simulation.ts).
// The core loadScene builds rigid bodies and joints only, so it must refuse such a scene outright rather
// than build its rigid part and drop the rest. The Simulation itself is tested against the built kit in
// packages/box3d-kit/test/v14-simulation.test.mjs (npm run test:kit).
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {COUPLED_EXAMPLE_SCENES, EXAMPLE_SCENES, loadScene, normalizeScene, sceneHasCoupling, validateScene} from '../../src/engine/scene-format.ts';
import {exactTransformHash, loadLabScene} from '../../src/lab/scene-host.ts';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));

test('the coupled example scenes are valid, and are kept apart from the scenes every loader can open', () => {
  for (const [name, make] of Object.entries(COUPLED_EXAMPLE_SCENES)) {
    assert.deepEqual(validateScene(make()), [], name);
    assert.equal(sceneHasCoupling(normalizeScene(make())), true, name);
    assert.equal(name in EXAMPLE_SCENES, false, `${name} is not offered to rigid-only loaders`);
  }
  for (const make of Object.values(EXAMPLE_SCENES)) assert.equal(sceneHasCoupling(normalizeScene(make())), false);
});

test('the core loader refuses a scene with coupled sections and leaves the world as it was', () => {
  const world = pool.createWorld();
  try {
    world.retainBodyShapes(true);
    loadLabScene(world, EXAMPLE_SCENES['domino-run']());
    const before = exactTransformHash(world), bodies = world.bodyCount();
    for (const [name, make] of Object.entries(COUPLED_EXAMPLE_SCENES)) {
      // A rigid-only host: what the core loadScene is for. The Lab's own loader builds coupled scenes (lab-coupled-scenes.test.mjs).
      assert.throws(() => loadScene({}, make()), error => {
        assert.equal(error.code, 'INVALID_STATE', name);
        assert.match(error.message, /has coupled sections.*builds rigid bodies and joints only.*loadSimulationScene/, name);
        return true;
      });
      assert.equal(world.bodyCount(), bodies, `${name}: the scene on screen is untouched`);
      assert.equal(exactTransformHash(world), before);
    }
  } finally { world.destroy(); }
});
