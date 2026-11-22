// Flow sections with backend 'gpu' (docs/GPU_COMPUTE.md, "Scene sections on the GPU"; docs/SCENE_FORMAT.md): the three
// fluid example scenes (a ball settling in syrup, coupled two-way; a static cylinder in a channel with an inflow and an
// outflow; a lid-driven cube without bodies), each with backend 'gpu', as far as the gate can run them (no shader runs):
//  - the scene format: the field is accepted on a flow and refused on a free-surface tank; 'cpu' is the default and is
//    left out of the normal form, so no CPU scene's hash moves (every example scene is hashed before and after);
//  - on the float32 reference (gpuSceneBackends('reference')): two runs give the same bits; a checkpoint taken at step N
//    and resumed in a fresh world reaches step M with the straight run's bits; a save is refused until a pull;
//  - on a stand-in device that runs the fluid kernels on the CPU (the GpuFluid path of the section: its encoding,
//    parameter blocks, readbacks and the obstacles' band uploads): the reference's bits, the world included;
//  - against the float64 scene (backend 'cpu'): the same flow and ball to float32 accuracy.
// That the GPU gives the reference's bits is checked on SwiftShader by scripts/lab-gpu-browser-check.mjs.
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
const {gpuSceneBackends} = await import('../../src/engine/gpu/scene-backends.ts');
const {NativeWorldPool} = await import('../../src/engine/native-world.ts');
const {simulationCheckpointInfo, resumeSimulationScene} = await import('../../src/engine/simulation.ts');
const {LabSceneHost, loadLabScene} = await import('../../src/lab/scene-host.ts');
const F = await import('../../src/engine/scene-format.ts');
const {normalizeScene, sceneHash, validateScene, sceneWorldOptions, sphereSettlingScene, flowPastCylinderScene, cavityFlowScene, damBreakScene, EXAMPLE_SCENES, COUPLED_EXAMPLE_SCENES} = F;

const bits = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };
function cpuDevice() {
  return mockDevice({execute(c) {
    const [uniform, Fb, I, Sb] = c.group.buffers, view = new DataView(uniform.data, c.offsets[0], FLUID_PASS.size), u = new Uint32Array(16), f = new Float32Array(8);
    for (let k = 0; k < 16; k++) u[k] = view.getUint32(4 * k, true);
    for (let k = 0; k < 8; k++) f[k] = view.getFloat32(64 + 4 * k, true);
    runKernelF32(c.entryPoint, {u, f}, new Float32Array(Fb.data), new Uint32Array(I.data), new Float32Array(Sb.data));
  }});
}
const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));
const withWorld = async run => { const world = pool.createWorld(); try { world.retainBodyShapes(true); return await run(world); } finally { world.destroy(); } };

const onGpu = (scene, backend = 'gpu') => ({...scene, fluids: scene.fluids.map(f => ({...f, ...(backend ? {backend} : {})}))});
/** The three flows, small enough for the gate: steps, and where the checkpoint is taken. */
const SCENES = {
  'sphere-settling': {scene: () => sphereSettlingScene(), steps: 16, at: 7},
  'flow-past-cylinder': {scene: () => flowPastCylinderScene(), steps: 10, at: 4},
  'cavity-flow': {scene: () => cavityFlowScene({cells: 8}), steps: 10, at: 4},
};
/** Fluid fields (padded, with the ghosts) and the world's exact hash after a pull. */
const fingerprint = loaded => {
  const parts = [];
  for (const runtime of loaded.fluids.values()) parts.push(runtime.flow.u, runtime.flow.v, runtime.flow.w, runtime.flow.p);
  return bits(...parts) + ':' + loaded.simulation.world.exactHash().toString(16);
};
async function run(scene, steps, {gpu, checkpointAt = -1} = {}) {
  return withWorld(async world => {
    const loaded = loadLabScene(world, scene, gpu ? {gpu} : {});
    let saved = null;
    for (let i = 1; i <= steps; i++) {
      if (gpu) await loaded.simulation.stepAsync(); else loaded.simulation.step();
      if (i === checkpointAt) saved = await loaded.simulation.checkpointAsync();
    }
    if (gpu) await loaded.simulation.pullAsync();
    const ball = loaded.bodies.get('ball');
    const out = {hash: fingerprint(loaded), saved, diagnostics: loaded.simulation.diagnostics().subsystems, velocity: ball ? [...world.bodyState(ball).linearVelocity] : null,
      fields: [...loaded.fluids.values()].map(r => [Float64Array.from(r.flow.u), Float64Array.from(r.flow.v), Float64Array.from(r.flow.w)])};
    loaded.simulation.dispose();
    return out;
  });
}

test('flow sections: backend in the scene format; no CPU scene changes its hash', () => {
  for (const [name, {scene}] of Object.entries(SCENES)) {
    const s = scene();
    assert.deepEqual(validateScene(onGpu(s)), [], name);
    assert.equal(normalizeScene(onGpu(s)).fluids[0].backend, 'gpu');
    assert.equal(sceneHash(onGpu(s, 'cpu')), sceneHash(s), `${name}: 'cpu' is the default and is left out`);
    assert.equal(normalizeScene(onGpu(s, 'cpu')).fluids[0].backend, undefined);
    assert.notEqual(sceneHash(onGpu(s)), sceneHash(s));
  }
  assert.match(validateScene(onGpu(damBreakScene())).map(e => e.message).join(), /free-surface tank has no GPU backend/);
  assert.match(validateScene({...sphereSettlingScene(), fluids: sphereSettlingScene().fluids.map(f => ({...f, backend: 'tpu'}))}).map(e => e.message).join(), /'cpu' or 'gpu'/);
  // Every example scene keeps the hash it has with this field unknown to it: its normal form has no backend.
  for (const [id, make] of Object.entries({...EXAMPLE_SCENES, ...COUPLED_EXAMPLE_SCENES})) { const s = make(); assert.ok(!JSON.stringify(normalizeScene(s)).includes('"backend"'), id); }
});

test('flow sections on the float32 reference: refusals, repeatable runs, a checkpoint resumed in a fresh world', {timeout: 900000}, async () => {
  const reference = gpuSceneBackends('reference');
  await withWorld(async world => {
    const scene = onGpu(sphereSettlingScene());
    assert.throws(() => loadLabScene(world, scene), e => e.code === 'GPU_UNAVAILABLE');
    assert.throws(() => loadLabScene(world, scene, {gpu: {grains: reference.grains, shallowWater: reference.shallowWater}}), e => e.code === 'GPU_UNAVAILABLE' && /flows/.test(e.message));
    const cpu = loadLabScene(world, sphereSettlingScene()), plan = cpu.simulation.order().map(row => `${row.stage} ${row.id} ${row.order}`);
    cpu.simulation.dispose();
    const loaded = loadLabScene(world, scene, {gpu: reference});
    assert.deepEqual(loaded.simulation.order().map(row => `${row.stage} ${row.id} ${row.order}`), plan, 'the GPU flow steps where the CPU flow does');
    assert.equal(loaded.simulation.isAsync, true);
    assert.throws(() => loaded.simulation.step(), /stepAsync/);
    await loaded.simulation.stepAsync();
    assert.throws(() => loaded.builder.toJSON(), /pullAsync/);
    await loaded.simulation.pullAsync();
    const saved = loaded.builder.toJSON();
    assert.equal(saved.fluids[0].backend, 'gpu');
    assert.ok(saved.fluids[0].u.some(x => x !== 0), 'the save writes the pulled flow');
    loaded.simulation.dispose();
  });
  for (const [name, {scene, steps, at}] of Object.entries(SCENES)) {
    const s = onGpu(scene()), a = await run(s, steps, {gpu: reference, checkpointAt: at}), b = await run(s, steps, {gpu: reference});
    assert.equal(a.hash, b.hash, `${name}: two runs give the same bits`);
    const id = s.fluids[0].id;
    assert.equal(a.diagnostics[id].backend, 'gpu-reference');
    assert.equal(a.diagnostics[id].steps, steps * (s.fluids[0].substeps ?? 1));
    assert.equal(simulationCheckpointInfo(a.saved).tick, at);
    const resumed = await withWorld(async world => {
      const host = new LabSceneHost(world, sceneWorldOptions(normalizeScene(JSON.parse(simulationCheckpointInfo(a.saved).scene))));
      const loaded = resumeSimulationScene(host, a.saved, {gpu: reference});
      assert.equal(loaded.simulation.tick, at);
      for (let i = at; i < steps; i++) await loaded.simulation.stepAsync();
      await loaded.simulation.pullAsync();
      const hash = fingerprint(loaded);
      loaded.simulation.dispose();
      return hash;
    });
    assert.equal(resumed, a.hash, `${name}: resumed at step ${at} in a fresh world, step ${steps} has the bits of the straight run`);
  }
});

test('flow sections through GpuFluid on a device that runs the kernels give the reference bits; both agree with float64', {timeout: 900000}, async () => {
  for (const [name, {scene, steps}] of Object.entries(SCENES)) {
    const s = onGpu(scene());
    const ref = await run(s, steps, {gpu: gpuSceneBackends('reference')});
    const gpu = await run(s, steps, {gpu: gpuSceneBackends(new GpuCompute(cpuDevice()))});
    assert.equal(gpu.hash, ref.hash, `${name}: the GpuFluid path gives the reference's bits, the rigid world included`);
    assert.equal(gpu.diagnostics[s.fluids[0].id].backend, 'gpu');
    const cpu = await run(onGpu(scene(), null), steps);
    // float32 against float64: the largest face-velocity difference over the largest speed, and the ball's velocity.
    let top = 0, diff = 0;
    for (let c = 0; c < 3; c++) { const x = ref.fields[0][c], y = cpu.fields[0][c]; for (let i = 0; i < x.length; i++) { top = Math.max(top, Math.abs(y[i])); diff = Math.max(diff, Math.abs(x[i] - y[i])); } }
    console.log(`${name}: ${steps} steps, max |u_f32 - u_f64| / max |u_f64| = ${(diff / top).toExponential(2)}${ref.velocity ? `, ball v_y ${ref.velocity[1].toPrecision(7)} (float32) against ${cpu.velocity[1].toPrecision(7)} (float64)` : ''}`);
    // The bound: the float32 projection stops at a divergence of 2e-6 of the largest speed and every face velocity is
    // rounded to 6e-8 of itself per operation; over 10 to 20 steps the GPU agreement table of docs/GPU_COMPUTE.md
    // measures 4e-7 to 5.6e-6 against float64. 1e-5 is that largest measured value with a margin of two.
    assert.ok(top > 0 && diff / top < 1e-5, `${name}: the float32 flow is within 1e-5 of the float64 flow (${diff / top})`);
    if (ref.velocity) assert.ok(Math.abs(ref.velocity[1] - cpu.velocity[1]) <= 1e-5 * Math.abs(cpu.velocity[1]), `${name}: the ball's velocity`);
  }
});

