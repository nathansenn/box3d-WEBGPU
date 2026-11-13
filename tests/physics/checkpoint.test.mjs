// Exact checkpoints as the Physics Lab takes them (src/lab/scene-host.ts, docs/CHECKPOINTS.md): a scene loaded with
// loadLabScene, its Simulation checkpointed, and the checkpoint resumed in another world that the page has used before
// (the Lab keeps one native world and loads every scene into it, so its body handles carry other generations than a
// fresh world's). The resumed run must continue bit for bit: the same rigid transforms and body states, and the same
// state of every solver. The kit's own tests (packages/box3d-kit/test/v19-checkpoint.test.mjs) cover fresh worlds, a
// fresh process and the refusals.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {COUPLED_EXAMPLE_SCENES, EXAMPLE_SCENES, normalizeScene, sceneWorldOptions} from '../../src/engine/scene-format.ts';
import {resumeSimulationScene, simulationCheckpointInfo} from '../../src/engine/simulation.ts';
import {decodeState, encodeState, readCheckpoint, CHECKPOINT_ERROR} from '../../src/engine/checkpoint.ts';
import {LabSceneHost, exactTransformHash, loadLabScene} from '../../src/lab/scene-host.ts';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const makePool = async () => new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));
const poolA = await makePool(), poolB = await makePool();
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const solverBytes = bytes => encodeState(readCheckpoint(bytes, 'simulation').subsystems);
const bodyStates = native => Array.from({length: native.bodyCount()}, (_, row) => native.bodyState(native.bodyHandle(row)));

const SCENES = {...EXAMPLE_SCENES, ...COUPLED_EXAMPLE_SCENES};
const STEPS = {'hopper-seesaw': 40, 'rubber-pad': 60, trampoline: 60, 'notched-beam': 60, 'quenched-plate': 60, 'sphere-settling': 30, 'cavity-flow': 30, 'flow-past-cylinder': 30, 'dam-break': 60};

test('a Lab scene resumes bit for bit in a world the page has used for other scenes', () => {
  // One world per pool, as the Lab keeps one, used for a run of other scenes first.
  const a = poolA.createWorld(), b = poolB.createWorld();
  try {
    for (const name of ['domino-run', 'buoy-and-crates']) { const used = loadLabScene(b, SCENES[name]()); for (let i = 0; i < 30; i++) used.simulation.step(); used.simulation.dispose(); }
    for (const [name, make] of Object.entries(SCENES)) {
      const steps = STEPS[name] ?? 120;
      const run = loadLabScene(a, make());
      for (let i = 0; i < steps; i++) run.simulation.step();
      const saved = run.simulation.checkpoint();
      for (let i = 0; i < steps; i++) run.simulation.step();
      const expected = run.simulation.checkpoint();
      // A fresh page reads the scene from the checkpoint and builds its world from the scene's settings.
      const scene = normalizeScene(JSON.parse(simulationCheckpointInfo(saved).scene));
      const resumed = resumeSimulationScene(new LabSceneHost(b, sceneWorldOptions(scene)), saved);
      assert.ok(same(solverBytes(resumed.simulation.checkpoint()), solverBytes(saved)), `${name}: the solvers' state is restored exactly`);
      // The handles the scene build made in this world stay valid after the restore.
      for (const [id, body] of resumed.bodies) assert.notEqual(b.bodyIndex(body), null, `${name}: body ${id} keeps its handle`);
      for (let i = 0; i < steps; i++) resumed.simulation.step();
      assert.equal(exactTransformHash(b), exactTransformHash(a), `${name}: rigid transforms`);
      assert.deepEqual(bodyStates(b), bodyStates(a), `${name}: body states`);
      assert.ok(same(solverBytes(resumed.simulation.checkpoint()), solverBytes(expected)), `${name}: every solver's state after ${steps} more steps`);
      run.simulation.dispose(); resumed.simulation.dispose();
    }
  } finally { a.destroy(); b.destroy(); }
});

test('the encoding keeps every number bit for bit and refuses what it did not write', () => {
  const tree = {a: -0, b: NaN, c: 2 ** 53 + 2, d: 1e-310, e: [1, -1, 0x7fffffff, -0x80000000, 0x80000000], f: new Float32Array([1.5, -0]), g: new Int32Array([7]), h: 12n, i: null, j: 'x', k: true};
  const back = decodeState(encodeState(tree));
  assert.ok(Object.is(back.a, -0) && Number.isNaN(back.b) && back.c === tree.c && back.d === tree.d);
  assert.deepEqual(back.e, tree.e);
  assert.ok(back.f instanceof Float32Array && Object.is(back.f[1], -0) && back.g instanceof Int32Array && back.h === 12n);
  assert.ok(same(encodeState(back), encodeState(tree)), 'equal trees give equal bytes');
  assert.throws(() => decodeState(new Uint8Array([99])), error => error.code === CHECKPOINT_ERROR);
  assert.throws(() => decodeState(new Uint8Array([...encodeState(tree), 0])), error => error.code === CHECKPOINT_ERROR);
});
