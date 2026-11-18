// Checkpoints of the GPU backends and the asynchronous stage of the Simulation (docs/GPU_COMPUTE.md, "Checkpoints" and
// "Scene sections on the GPU"), as far as the gate can test them (no shader runs here):
//  - each float32 reference (FluidF32, ShallowWaterF32, GranularF32): a run checkpointed at step N, restored into a fresh
//    reference built from the same start and taken on to step N + M gives the bits of a run taken straight to N + M;
//  - the fluid on a stand-in device that runs its kernels on the CPU: a GPU checkpoint restored into the reference, and
//    a reference checkpoint restored into the GPU, carry on with the same bits (the format is shared);
//  - shallow water and grains on a stand-in device that runs nothing: the bytes a reference checkpoint puts on the GPU
//    come back out of a GPU checkpoint unchanged; a GpuShallowWater with face speeds on their way refuses;
//  - scene sections with backend 'gpu' (the float32 reference standing in for the GPU): the scene format, the refusals
//    (no backends, step() instead of stepAsync(), a stale save), two runs with the same bits, a checkpoint resumed in a
//    fresh world with the bits of a straight run, and the rigid and CPU scenes unchanged.
// That a GPU checkpoint restores bit-exactly on a GPU is checked in the browser: scripts/gpu-compute-browser-check.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {installGpuGlobals, mockDevice} from './fixtures/gpu-mock.mjs';
installGpuGlobals();
const {GpuCompute} = await import('../../src/engine/gpu/compute.ts');
const {FLUID_PASS, runKernelF32} = await import('../../src/engine/gpu/fluid-kernels.ts');
const {FluidF32} = await import('../../src/engine/gpu/fluid-f32.ts');
const {GpuFluid} = await import('../../src/engine/gpu/fluid-gpu.ts');
const {FLUID_SETUPS} = await import('../../src/engine/gpu/fluid-setups.ts');
const {ShallowWater} = await import('../../src/engine/shallow-water.ts');
const {ShallowWaterF32} = await import('../../src/engine/gpu/shallow-water-f32.ts');
const {GpuShallowWater} = await import('../../src/engine/gpu/shallow-water-gpu.ts');
const {SHALLOW_WATER_SETUPS} = await import('../../src/engine/gpu/shallow-water-setups.ts');
const {GranularF32} = await import('../../src/engine/gpu/granular-f32.ts');
const {GpuGranular} = await import('../../src/engine/gpu/granular-gpu.ts');
const {GRANULAR_SETUPS} = await import('../../src/engine/gpu/granular-setups.ts');
const {gpuSceneBackends} = await import('../../src/engine/gpu/scene-backends.ts');
const {NativeWorldPool} = await import('../../src/engine/native-world.ts');
const {resumeSimulationScene, simulationCheckpointInfo} = await import('../../src/engine/simulation.ts');
const {LabSceneHost, loadLabScene} = await import('../../src/lab/scene-host.ts');
const {sceneWorldOptions} = await import('../../src/engine/scene-format.ts');
const {normalizeScene, sceneHash, validateScene, damBreakValleyScene, hopperSeesawScene} = await import('../../src/engine/scene-format.ts');
const {readCheckpoint} = await import('../../src/engine/checkpoint.ts');

/** The state of a fluid program (velocity with ghosts, previous advection, pressure): the work arrays' room for obstacle faces depends on the band at construction. */
const state = r => { const p = r.program.plan; return [r.F.subarray(p.F.vel, p.F.vel + 3 * p.P), r.F.subarray(p.F.prev, p.F.prev + 3 * p.P), r.F.subarray(p.F.p, p.F.p + p.N)]; };
const bits = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
function cpuDevice() {
  return mockDevice({execute(c) {
    const [uniform, F, I, Sb] = c.group.buffers, view = new DataView(uniform.data, c.offsets[0], FLUID_PASS.size), u = new Uint32Array(16), f = new Float32Array(8);
    for (let k = 0; k < 16; k++) u[k] = view.getUint32(4 * k, true);
    for (let k = 0; k < 8; k++) f[k] = view.getFloat32(64 + 4 * k, true);
    runKernelF32(c.entryPoint, {u, f}, new Float32Array(F.data), new Uint32Array(I.data), new Float32Array(Sb.data));
  }});
}

test('fluid: a checkpoint resumes with the bits of a straight run, on the reference and across the GPU and the reference', async () => {
  for (const [name, make] of Object.entries(FLUID_SETUPS)) {
    const {steps} = make(), half = Math.floor(steps / 2);
    const drive = async (setup, backend, from, to) => { for (let k = from; k < to; k++) { setup.beforeStep?.(setup.fluid, k); await backend.step(); } };
    const straight = make(), r = new FluidF32(straight.fluid);
    await drive(straight, r, 0, steps);
    // Reference to reference. The obstacles' poses and forces belong to the Fluid: it is checkpointed with its own saveState.
    const a = make(), ra = new FluidF32(a.fluid);
    await drive(a, ra, 0, half);
    const bytes = ra.checkpoint(), host = a.fluid.saveState();
    const b = make(); b.fluid.restoreState(host); const rb = new FluidF32(b.fluid); rb.restoreCheckpoint(bytes);
    await drive(b, rb, half, steps);
    assert.equal(bits(...state(rb)), bits(...state(r)), `${name}: reference resumed`);
    // GPU (stand-in device) checkpoint into the reference, and reference checkpoint into the GPU.
    const c = make(), gc = await GpuFluid.create(new GpuCompute(cpuDevice()), c.fluid);
    await drive(c, gc, 0, half);
    const gbytes = await gc.checkpoint(), ghost = c.fluid.saveState();
    assert.equal(bits(gbytes), bits(bytes), `${name}: the GPU writes the reference's checkpoint bytes`);
    const d = make(); d.fluid.restoreState(ghost); const rd = new FluidF32(d.fluid); rd.restoreCheckpoint(gbytes);
    await drive(d, rd, half, steps);
    assert.equal(bits(...state(rd)), bits(...state(r)), `${name}: a GPU checkpoint carried on by the reference`);
    const e = make(); e.fluid.restoreState(host); const ge = await GpuFluid.create(new GpuCompute(cpuDevice()), e.fluid); ge.restoreCheckpoint(bytes);
    await drive(e, ge, half, steps);
    const s = await ge.read();
    assert.equal(bits(s.u, s.v, s.w, s.p), bits(r.velocity(0), r.velocity(1), r.velocity(2), r.pressure()), `${name}: a reference checkpoint carried on by the GPU`);
    for (let o = 0; o < straight.fluid.obstacleCount; o++) assert.equal(bits(e.fluid.obstacleForce(o), d.fluid.obstacleForce(o)), bits(straight.fluid.obstacleForce(o), straight.fluid.obstacleForce(o)), `${name}: obstacle force`);
    gc.destroy(); ge.destroy();
  }
  // Another grid is refused.
  const other = new FluidF32(FLUID_SETUPS['cavity-3d']().fluid);
  assert.throws(() => other.restoreCheckpoint(new FluidF32(FLUID_SETUPS['taylor-green']().fluid).checkpoint()), e => e.code === 'CHECKPOINT_MISMATCH');
});

test('shallow water: a checkpoint of the reference resumes with the bits of a straight run; the GPU gives the bytes back', async () => {
  for (const [name, make] of Object.entries(SHALLOW_WATER_SETUPS)) {
    const {options, steps} = make(), half = Math.floor(steps / 2);
    const straight = new ShallowWaterF32(new ShallowWater(options)); straight.step(steps);
    const a = new ShallowWaterF32(new ShallowWater(options)); a.step(half);
    const bytes = a.checkpoint(), b = new ShallowWaterF32(new ShallowWater(options));
    b.restoreCheckpoint(bytes); b.step(steps - half);
    assert.equal(bits(b.state, b.aux), bits(straight.state, straight.aux), `${name}: resumed`);
    assert.equal(b.volumeError(), straight.volumeError(), `${name}: the budget carries over`);
    const gpu = await GpuShallowWater.create(new GpuCompute(mockDevice()), new ShallowWater(options));
    gpu.restoreCheckpoint(bytes);
    const back = readCheckpoint(await gpu.checkpoint(), 'gpu-shallow-water'), saved = readCheckpoint(bytes, 'gpu-shallow-water');
    assert.equal(bits(back.state, back.aux), bits(saved.state, saved.aux), `${name}: GPU round trip`);
    assert.equal(back.time, saved.time); assert.equal(back.steps, saved.steps); assert.equal(back.lastSub, saved.lastSub);
    gpu.destroy();
  }
  const {options} = SHALLOW_WATER_SETUPS.thacker(), late = await GpuShallowWater.create(new GpuCompute(mockDevice()), new ShallowWater(options), {rateLatency: 1});
  await assert.rejects(late.checkpoint(), /rateLatency 0/);
});

test('grains: a checkpoint of the reference resumes with the bits of a straight run; the GPU gives the bytes back', async () => {
  for (const [name, make] of Object.entries(GRANULAR_SETUPS)) {
    const steps = 120, half = 50;
    const straight = new GranularF32(make().granular); straight.step(steps);
    const a = new GranularF32(make().granular); a.step(half);
    const bytes = a.checkpoint(), b = new GranularF32(make().granular);
    b.restoreCheckpoint(bytes); b.step(steps - half);
    assert.equal(bits(b.pos, b.vel, b.spin, b.ft, b.wallF), bits(straight.pos, straight.vel, straight.spin, straight.ft, straight.wallF), `${name}: resumed`);
    assert.deepEqual(b.stats, straight.stats, `${name}: statistics`);
    const gpu = await GpuGranular.fromGranular(new GpuCompute(mockDevice()), make().granular);
    gpu.restoreCheckpoint(bytes);
    const back = readCheckpoint(await gpu.checkpoint(), 'gpu-granular'), saved = readCheckpoint(bytes, 'gpu-granular');
    for (const key of ['pos', 'vel', 'spin', 'ft', 'history', 'walls', 'meter']) assert.equal(bits(back[key]), bits(saved[key]), `${name}: GPU round trip of ${key}`);
    gpu.destroy();
  }
});

// ---- scene sections on the GPU (the float32 reference standing in) ------------------------------------------------
const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));
const withWorld = async run => { const world = pool.createWorld(); try { world.retainBodyShapes(true); return await run(world); } finally { world.destroy(); } };
const loadSimulationScene = (native, scene, options) => loadLabScene(native, scene, options);
/** A valley of water without floating crates, and the hopper of grains over a see-saw, both with backend 'gpu' (or as given). */
function gpuScene(backend = 'gpu') {
  const valley = damBreakValleyScene(), hopper = hopperSeesawScene({count: 60});
  return {...hopper, bodies: [...hopper.bodies, ...valley.bodies.filter(b => b.id === 'valley')], grains: hopper.grains.map(g => ({...g, ...(backend ? {backend} : {})})),
    shallowWater: valley.shallowWater.map(w => ({...w, bodies: [], ...(backend ? {backend} : {})}))};
}
const reference = gpuSceneBackends('reference');
async function sceneRun(scene, steps, {checkpointAt = -1} = {}) {
  return withWorld(async world => {
    const loaded = loadSimulationScene(world, scene, {gpu: reference});
    let saved = null;
    for (let i = 1; i <= steps; i++) { await loaded.simulation.stepAsync(); if (i === checkpointAt) saved = await loaded.simulation.checkpointAsync(); }
    await loaded.simulation.pullAsync();
    const dem = loaded.grains.values().next().value.granular, water = loaded.shallowWater.values().next().value.water;
    const out = {hash: bits(dem.positions, dem.velocities, water.h, water.qx, water.qz) + ':' + loaded.simulation.world.exactHash().toString(16), saved, scene: loaded.builder.toJSON(), diagnostics: loaded.simulation.diagnostics().subsystems};
    loaded.simulation.dispose();
    return out;
  });
}

test('scene sections with backend gpu: format, refusals, repeatable runs, and a checkpoint resumed in a fresh world', {timeout: 600000}, async () => {
  const scene = gpuScene();
  assert.deepEqual(validateScene(scene), []);
  assert.equal(normalizeScene(scene).grains[0].backend, 'gpu'); assert.equal(normalizeScene(scene).shallowWater[0].backend, 'gpu');
  // 'cpu' is the default: it is left out of the normal form, so the hash of every existing scene is unchanged.
  assert.equal(sceneHash(gpuScene('cpu')), sceneHash(gpuScene(null)));
  assert.notEqual(sceneHash(scene), sceneHash(gpuScene(null)));
  assert.match(validateScene({...scene, shallowWater: damBreakValleyScene().shallowWater.map(w => ({...w, backend: 'gpu'}))}).map(e => e.message).join(), /no bodies/);
  assert.match(validateScene({...scene, grains: scene.grains.map(g => ({...g, backend: 'tpu'}))}).map(e => e.message).join(), /'cpu' or 'gpu'/);
  await withWorld(async world => {
    assert.throws(() => loadSimulationScene(world, scene), e => e.code === 'GPU_UNAVAILABLE' && /gpuSceneBackends/.test(e.message));
  });
  await withWorld(async world => {
    const loaded = loadSimulationScene(world, scene, {gpu: reference});
    assert.equal(loaded.simulation.isAsync, true);
    assert.throws(() => loaded.simulation.step(), /stepAsync/);
    await loaded.simulation.stepAsync();
    assert.throws(() => loaded.simulation.checkpoint(), /checkpointAsync/);
    assert.throws(() => loaded.builder.toJSON(), /pullAsync/);
    await loaded.simulation.pullAsync();
    assert.ok(loaded.builder.toJSON().grains, 'saved after a pull');
    loaded.simulation.dispose();
  });
  const steps = 40, at = 15, a = await sceneRun(scene, steps, {checkpointAt: at}), b = await sceneRun(scene, steps);
  assert.equal(a.hash, b.hash, 'two runs give the same bits');
  assert.equal(a.diagnostics['valley-water'].backend, 'gpu-reference');
  assert.ok(a.diagnostics[scene.grains[0].id].steps > 0);
  const resumed = await withWorld(async world => {
    const host = new LabSceneHost(world, sceneWorldOptions(normalizeScene(JSON.parse(simulationCheckpointInfo(a.saved).scene))));
    const loaded = resumeSimulationScene(host, a.saved, {gpu: reference});
    assert.equal(loaded.simulation.tick, at);
    for (let i = at; i < steps; i++) await loaded.simulation.stepAsync();
    await loaded.simulation.pullAsync();
    const dem = loaded.grains.values().next().value.granular, water = loaded.shallowWater.values().next().value.water;
    const hash = bits(dem.positions, dem.velocities, water.h, water.qx, water.qz) + ':' + loaded.simulation.world.exactHash().toString(16);
    loaded.simulation.dispose();
    return hash;
  });
  assert.equal(resumed, a.hash, 'a checkpoint resumed in a fresh world carries on with the bits of the straight run');
  // The same scene on the CPU is unchanged by the asynchronous stage: stepAsync gives step()'s bits.
  const cpuScene = gpuScene(null);
  const viaStep = await withWorld(async world => { const l = loadSimulationScene(world, cpuScene); for (let i = 0; i < 20; i++) l.simulation.step(); const h = l.simulation.world.exactHash().toString(16); l.simulation.dispose(); return h; });
  const viaAsync = await withWorld(async world => { const l = loadSimulationScene(world, cpuScene); for (let i = 0; i < 20; i++) await l.simulation.stepAsync(); const h = l.simulation.world.exactHash().toString(16); l.simulation.dispose(); return h; });
  assert.equal(viaAsync, viaStep);
});
