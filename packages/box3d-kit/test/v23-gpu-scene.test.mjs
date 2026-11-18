// Scene sections on the GPU through the published kit (box3d-webgpu-kit/gpu with box3d-webgpu-kit/simulation):
//  - the float32 reference standing in for the GPU (gpuSceneBackends('reference')): a scene with grains over a see-saw
//    and a valley of water, both with backend 'gpu', loads with the kit's own world; two runs give the same bits; a
//    checkpoint taken at step N and resumed with resumeSimulation in a fresh world reaches step M with the bits of the
//    straight run; the refusals (no backends, step() instead of stepAsync(), a save before a pull);
//  - Dawn's null device (it compiles and validates but runs no shader): the GPU backends of the same scene build their
//    pipelines from the kit's copies of the shaders and encode a step without a validation error.
// What the shaders compute is checked against the reference in a browser: scripts/gpu-compute-browser-check.mjs and
// scripts/lab-gpu-browser-check.mjs in the repository (docs/GPU_COMPUTE.md).
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {createWorld} from 'box3d-webgpu-kit';
import {loadSimulationScene, resumeSimulation, simulationCheckpointInfo} from 'box3d-webgpu-kit/simulation';
import {damBreakValleyScene, hopperSeesawScene, sceneHash, sceneWorldOptions} from 'box3d-webgpu-kit/scene-format';
import {GpuCompute, gpuSceneBackends, GPU_SCENE_BACKEND} from 'box3d-webgpu-kit/gpu';
import {createDawnGpu} from '../../../scripts/dawn-gpu.mjs';

const bits = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
/** The hopper of grains over a see-saw and the valley of water without its crates, with backend 'gpu' (or none). */
function gpuScene(backend = 'gpu') {
  const valley = damBreakValleyScene(), hopper = hopperSeesawScene({count: 40});
  const tag = backend ? {backend} : {};
  return {...hopper, bodies: [...hopper.bodies, ...valley.bodies.filter(b => b.id === 'valley')], grains: hopper.grains.map(g => ({...g, ...tag})),
    shallowWater: valley.shallowWater.map(w => ({...w, bodies: [], ...tag}))};
}
const reference = gpuSceneBackends('reference');
const fingerprint = loaded => {
  const dem = loaded.grains.values().next().value.granular, water = loaded.shallowWater.values().next().value.water;
  return bits(dem.positions, dem.velocities, water.h, water.qx, water.qz) + ':' + loaded.simulation.world.exactHash().toString(16);
};
async function run(scene, steps, checkpointAt = -1) {
  const world = await createWorld(sceneWorldOptions(scene));
  try {
    const loaded = loadSimulationScene(world, scene, {gpu: reference});
    let saved = null;
    for (let i = 1; i <= steps; i++) { await loaded.simulation.stepAsync(); if (i === checkpointAt) saved = await loaded.simulation.checkpointAsync(); }
    await loaded.simulation.pullAsync();
    const out = {hash: fingerprint(loaded), saved, diagnostics: loaded.simulation.diagnostics().subsystems};
    loaded.simulation.dispose();
    return out;
  } finally { world.dispose(); }
}

test('gpu scene sections on the float32 reference: refusals, repeatable runs, a checkpoint resumed in a fresh world', {timeout: 600000}, async () => {
  const scene = gpuScene();
  assert.notEqual(sceneHash(scene), sceneHash(gpuScene(null)));
  assert.equal(sceneHash(gpuScene('cpu')), sceneHash(gpuScene(null)), "'cpu' is the default and leaves the hash unchanged");
  {
    const world = await createWorld(sceneWorldOptions(scene));
    assert.throws(() => loadSimulationScene(world, scene), e => e.code === 'GPU_UNAVAILABLE' && /gpuSceneBackends/.test(e.message));
    const loaded = loadSimulationScene(world, scene, {gpu: reference});
    assert.equal(loaded.simulation.isAsync, true);
    assert.throws(() => loaded.simulation.step(), /stepAsync/);
    await loaded.simulation.stepAsync();
    assert.throws(() => loaded.simulation.checkpoint(), /checkpointAsync/);
    assert.throws(() => loaded.builder.toJSON(), /pullAsync/);
    await loaded.simulation.pullAsync();
    assert.ok(loaded.builder.toJSON().grains, 'saved after a pull');
    loaded.simulation.dispose(); world.dispose();
  }
  const steps = 24, at = 9, a = await run(scene, steps, at), b = await run(scene, steps);
  assert.equal(a.hash, b.hash, 'two runs give the same bits');
  assert.equal(a.diagnostics['valley-water'].backend, 'gpu-reference');
  assert.ok(a.diagnostics[scene.grains[0].id].steps > 0);
  assert.equal(simulationCheckpointInfo(a.saved).tick, at);
  const world = await createWorld(sceneWorldOptions(scene));
  try {
    const loaded = resumeSimulation(world, a.saved, {gpu: reference});
    assert.equal(loaded.simulation.tick, at);
    for (let i = at; i < steps; i++) await loaded.simulation.stepAsync();
    await loaded.simulation.pullAsync();
    assert.equal(fingerprint(loaded), a.hash, 'resumed at step 9 in a fresh world, step 24 has the bits of the straight run');
    loaded.simulation.dispose();
  } finally { world.dispose(); }
  assert.equal(typeof GPU_SCENE_BACKEND, 'string');
});

test('gpu scene sections on Dawn (null backend): the kit\'s shaders compile and a step encodes without a validation error', {timeout: 300000}, async () => {
  const dawn = createDawnGpu(['backend=null']);
  const adapter = await dawn.requestAdapter(), device = await adapter.requestDevice(), errors = [];
  device.addEventListener('uncapturederror', event => errors.push(event.error.message));
  // The null backend runs nothing and maps back undefined memory. The copies and maps are still encoded, submitted and
  // awaited; what comes back is replaced by the bytes last written to that buffer from the host (zero elsewhere: no
  // grain overflowed, no face speed; the walls as uploaded), and by ones for the flow's solver scalars (every solve
  // reports itself stopped after its first batch), so a step runs to its end. The numbers mean nothing; the encoding does.
  class NullBackendCompute extends GpuCompute {
    shadow = new Map();
    write(buffer, data, offset = 0) {
      super.write(buffer, data, offset);
      const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (!this.shadow.has(buffer)) this.shadow.set(buffer, new Uint8Array(buffer.size));
      this.shadow.get(buffer).set(bytes, offset);
    }
    async read(sources) {
      const out = await super.read(sources);
      return out.map((bytes, i) => {
        const {buffer, offset = 0} = sources[i];
        if (buffer.label === 'fluid scalars') return new Float32Array(bytes.byteLength / 4).fill(1).buffer;
        const shadow = this.shadow.get(buffer);
        return shadow ? shadow.slice(offset, offset + bytes.byteLength).buffer : new ArrayBuffer(bytes.byteLength);
      });
    }
  }
  const compute = new NullBackendCompute(device, adapter.info), scene = gpuScene();
  const world = await createWorld(sceneWorldOptions(scene));
  try {
    const loaded = loadSimulationScene(world, scene, {gpu: gpuSceneBackends(compute)});
    for (let i = 0; i < 2; i++) await loaded.simulation.stepAsync();
    await loaded.simulation.checkpointAsync();
    const d = loaded.simulation.diagnostics().subsystems;
    for (const id of Object.keys(d).filter(id => d[id].backend !== undefined && /gpu/.test(String(d[id].backend)))) {
      assert.equal(d[id].backend, 'gpu', id);
      assert.match(String(d[id].solver), /webgpu/, id);
    }
    assert.equal(Object.values(d).filter(x => x.backend === 'gpu').length, 2, 'the grains and the water run on the device');
    loaded.simulation.dispose();
  } finally { world.dispose(); device.destroy(); }
  assert.deepEqual(errors, []);
});
