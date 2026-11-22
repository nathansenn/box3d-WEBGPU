// Scene sections on the GPU in the Physics Lab (src/lab/gpu-scene.ts), the code path the page uses, run in node against
// the real WASM world with the float32 reference standing in for the GPU (node has no WebGPU device):
//  - what `?gpu=` asks for, which scenes have GPU sections, the GPU examples (the coupled examples with backend 'gpu');
//  - the plan: the reference, the CPU without the backend fields (no device, or ?gpu=off) with the reason;
//  - CoupledSceneView with a LabGpuStepper: the Lab's clock starts a step only when none is on its way (the others are
//    counted as skipped); after the steps the view's state hash is that of the same scene stepped on the reference by
//    hand; a step pulls the GPU state into the arrays the view draws;
//  - with the backend fields dropped the scene is the CPU example, hash and all.
// The GPU itself, the numbers against this reference and a forced device loss: scripts/lab-gpu-browser-check.mjs.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {COUPLED_EXAMPLE_SCENES, sceneHash} from '../../src/engine/scene-format.ts';
import {gpuSceneBackends} from '../../src/engine/gpu/scene-backends.ts';
import {loadLabScene} from '../../src/lab/scene-host.ts';
import {CoupledSceneView, coupledStateHash} from '../../src/lab/coupled-scene.ts';
import {GPU_EXAMPLE_NAMES, GPU_EXAMPLE_SCENES, LAB_EXAMPLE_SCENES, resolveSceneRequest} from '../../src/lab/scene-loading.ts';
import {LabGpu, LabGpuStepper, labGpuRequest, sceneHasGpuSections, withoutGpuSections} from '../../src/lab/gpu-scene.ts';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));
const withWorld = async run => { const world = pool.createWorld(); try { world.retainBodyShapes(true); return await run(world); } finally { world.destroy(); } };

test('the address, the GPU examples and the plan', async () => {
  assert.equal(labGpuRequest(''), 'auto'); assert.equal(labGpuRequest('?gpu=off'), 'off'); assert.equal(labGpuRequest('?gpu=cpu'), 'off');
  assert.equal(labGpuRequest('?gpu=reference'), 'reference'); assert.equal(labGpuRequest('?gpu=1'), 'auto');
  assert.deepEqual(GPU_EXAMPLE_NAMES, ['sphere-settling-gpu', 'hopper-seesaw-gpu']);
  for (const name of GPU_EXAMPLE_NAMES) {
    const scene = GPU_EXAMPLE_SCENES[name](), cpuName = name.replace(/-gpu$/, '');
    assert.ok(Object.hasOwn(LAB_EXAMPLE_SCENES, name));
    assert.ok(sceneHasGpuSections(scene), name);
    assert.ok(!sceneHasGpuSections(COUPLED_EXAMPLE_SCENES[cpuName]()));
    assert.equal(sceneHash(withoutGpuSections(scene)), sceneHash(COUPLED_EXAMPLE_SCENES[cpuName]()), `${name} without its backend fields is ${cpuName}`);
    const read = resolveSceneRequest({kind: 'example', name});
    assert.ok(read.ok, name);
  }
  const scene = GPU_EXAMPLE_SCENES['sphere-settling-gpu']();
  const reference = new LabGpu('reference').plan(scene);
  assert.equal(reference.mode, 'reference'); assert.ok(reference.options.gpu); assert.equal(reference.scene, scene);
  const off = new LabGpu('off').plan(scene);
  assert.equal(off.mode, 'cpu'); assert.ok(!sceneHasGpuSections(off.scene)); assert.match(off.reason, /gpu=off/);
  // Node has no navigator.gpu: the device is refused and the scene runs on the CPU, with the reason.
  const auto = new LabGpu('auto');
  await auto.prepare();
  const plan = auto.plan(scene);
  assert.equal(plan.mode, 'cpu'); assert.equal(auto.compute, null); assert.ok(plan.reason && plan.reason.length > 10, plan.reason);
});

test('the Lab steps a GPU scene one step at a time and draws the pulled state; the bits are those of the reference', {timeout: 600000}, async () => {
  for (const [name, steps] of [['sphere-settling-gpu', 6], ['hopper-seesaw-gpu', 6]]) {
    const scene = GPU_EXAMPLE_SCENES[name]();
    const byHand = await withWorld(async world => {
      const loaded = loadLabScene(world, scene, {gpu: gpuSceneBackends('reference')});
      for (let i = 0; i < steps; i++) await loaded.simulation.stepAsync();
      await loaded.simulation.pullAsync();
      const hash = coupledStateHash(loaded); loaded.simulation.dispose(); return hash;
    });
    const viaLab = await withWorld(async world => {
      const lab = new LabGpu('reference'), plan = lab.plan(scene), loaded = loadLabScene(world, plan.scene, plan.options);
      const stepper = new LabGpuStepper(loaded.simulation, lab, plan.mode, {snapshotEvery: 4}), view = new CoupledSceneView(loaded, world, stepper);
      let drawn = 0;
      stepper.onStep = () => { drawn++; };
      const before = view.stateHash();
      // Three ticks of the clock while the first step is on its way: one step, two skipped.
      view.step(); view.step(); view.step();
      assert.equal(stepper.busy, true);
      await stepper.settle();
      assert.equal(loaded.simulation.tick, 1);
      assert.equal(stepper.state().skipped, 2);
      assert.notEqual(view.stateHash(), before, 'the step was pulled into the arrays the view draws');
      assert.equal(view.sync(), true);
      await stepper.advance(steps - 1);
      const state = stepper.state();
      assert.equal(state.mode, 'reference'); assert.equal(state.steps, steps); assert.equal(state.fallback, null); assert.equal(state.failed, null);
      assert.ok(state.checkpointTick === -1, 'the reference takes no checkpoints: there is no device to lose');
      assert.match(stepper.readout(), /float32 CPU reference/);
      assert.equal(drawn, steps);
      assert.ok(Number.isFinite(view.readout().stepMs));
      const hash = view.stateHash(); view.dispose(); loaded.simulation.dispose(); return hash;
    });
    assert.equal(viaLab, byHand, `${name}: the Lab's steps give the bits of the reference stepped by hand`);
  }
});
