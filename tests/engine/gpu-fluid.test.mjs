// The GPU fluid backend (src/engine/gpu/fluid-*.ts), as far as the gate can test it (no shader runs here):
//  - the shader compiles on Dawn without errors or warnings, and a step with every kind of side encodes without a
//    validation error;
//  - GpuFluid driven through a stand-in device that runs each dispatch with the float32 kernels on the CPU gives the
//    float32 reference's bits: the encoding (dispatch order, parameter blocks, clears, region offsets, readbacks) is the
//    program's;
//  - the float32 reference against every closed form of the float64 validation the backend covers, with the float64
//    tolerance except where float32 forces a looser one (src/engine/gpu/fluid-cases.ts says which and why), against the
//    float64 solver on short runs, and repeatability;
//  - the fall back to the float64 solver when the device is lost, and the guard against a device that never reports a
//    stopped solve.
// The GPU itself is compared with this reference in a browser: scripts/gpu-compute-browser-check.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {create, globals} from 'webgpu';
import {installGpuGlobals, mockDevice} from './fixtures/gpu-mock.mjs';
Object.assign(globalThis, globals);
installGpuGlobals();
const S = await import('../../packages/box3d-kit/test/fluid-scenarios.mjs');
const M = await import('../../src/engine/fluid.ts');
const {GpuCompute} = await import('../../src/engine/gpu/compute.ts');
const {FLUID_WGSL, FLUID_PASS, runKernelF32} = await import('../../src/engine/gpu/fluid-kernels.ts');
const {FluidProgram} = await import('../../src/engine/gpu/fluid-program.ts');
const {FluidF32} = await import('../../src/engine/gpu/fluid-f32.ts');
const {GpuFluid, FluidRunner} = await import('../../src/engine/gpu/fluid-gpu.ts');
const {fluidProxy, fluidF32Remote} = await import('../../src/engine/gpu/fluid-proxy.ts');
const {runFluidCases} = await import('../../src/engine/gpu/fluid-cases.ts');
const {FLUID_SETUPS} = await import('../../src/engine/gpu/fluid-setups.ts');

/** A stand-in device whose dispatches run the float32 kernels on its own buffers. */
function cpuDevice() {
  return mockDevice({execute(c) {
    const [uniform, F, I, Sb] = c.group.buffers, at = c.offsets[0], view = new DataView(uniform.data, at, FLUID_PASS.size);
    const u = new Uint32Array(16), f = new Float32Array(8);
    for (let k = 0; k < 16; k++) u[k] = view.getUint32(4 * k, true);
    for (let k = 0; k < 8; k++) f[k] = view.getFloat32(64 + 4 * k, true);
    runKernelF32(c.entryPoint, {u, f}, new Float32Array(F.data), new Uint32Array(I.data), new Float32Array(Sb.data));
  }});
}
const dawn = create(['backend=null']);
const bits = (...arrays) => { const h = createHash('sha256'); for (const a of arrays) h.update(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)); return h.digest('hex'); };

test('the shader compiles, and steps with every kind of side encode without a validation error', async () => {
  const adapter = await dawn.requestAdapter(), device = await adapter.requestDevice(), uncaptured = [];
  device.addEventListener('uncapturederror', event => uncaptured.push(event.error.message));
  assert.deepEqual((await device.createShaderModule({code: FLUID_WGSL}).getCompilationInfo()).messages.map(m => `${m.type} ${m.lineNum}: ${m.message}`), []);
  // The null backend runs nothing and maps back undefined memory: every scalar read is handed over as "stopped" (1),
  // so each solve encodes one batch and the step goes on. The copies and maps are still submitted and awaited.
  class NullBackendCompute extends GpuCompute {
    async read(sources) { return (await super.read(sources)).map(bytes => new Float32Array(bytes.byteLength / 4).fill(1).buffer); }
  }
  const compute = new NullBackendCompute(device, adapter.info);
  for (const name of Object.keys(FLUID_SETUPS)) {
    const gpu = await GpuFluid.create(compute, FLUID_SETUPS[name]().fluid);
    await gpu.step(2); await gpu.project(); await gpu.read();
    assert.equal(gpu.stats.steps, 2);
    gpu.destroy();
  }
  assert.deepEqual(uncaptured, []);
  device.destroy();
});

test('GpuFluid on a device that runs the float32 kernels gives the float32 reference bits', async () => {
  for (const [name, make] of Object.entries(FLUID_SETUPS)) {
    const {steps} = make(), gpu = await GpuFluid.create(new GpuCompute(cpuDevice()), make().fluid);
    await gpu.step(steps);
    const s = await gpu.read(), r = new FluidF32(make().fluid);
    r.step(steps);
    assert.equal(bits(s.u, s.v, s.w, s.p), bits(r.velocity(0), r.velocity(1), r.velocity(2), r.pressure()), name);
    assert.equal(gpu.stats.pressureIterations, r.stats.pressureIterations);
    assert.equal(gpu.stats.viscousIterations, r.stats.viscousIterations);
    assert.ok(gpu.stats.pressureIterations > 0, `${name}: the projection iterated`);
    gpu.destroy();
  }
});

test('a step: ghosts, advection, predictor, viscous solves, projection; the solves are read every 16 iterations', () => {
  const program = new FluidProgram(FLUID_SETUPS['cavity-3d']().fluid), kernels = [], S = new Float32Array(64).fill(1);
  const gen = program.step();
  let next = gen.next(), syncs = 0;
  while (!next.done) { if (next.value.type === 'op') kernels.push(next.value.op.kernel); else if (next.value.type === 'sync') syncs++; next = gen.next(S); }
  const first = k => kernels.indexOf(k);
  assert.ok(first('ghosts') < first('advect') && first('advect') < first('predict') && first('predict') < first('viscB') && first('viscB') < first('divergence'));
  assert.equal(kernels.filter(k => k === 'viscB').length, 3, 'one implicit solve per component');
  assert.equal(syncs, 3 + 1, 'one read per viscous solve (stopped at once here) and one for the projection');
  assert.ok(program.blockCount < 300);
});

let cases;
test('float32 reference: every closed form of the float64 validation the backend covers', {timeout: 900000}, () => {
  cases = runFluidCases(S, {...M, Fluid: fluidProxy(fluidF32Remote)});
  for (const row of cases.rows) assert.equal(row.pass, true, `${row.id}: ${row.value} against ${row.reference} (${row.tolerance.kind} ${row.tolerance.value})`);
  assert.equal(cases.rows.length, 17);
  assert.deepEqual(cases.rows.filter(r => r.tolerance.value !== r.float64.value).map(r => r.id),
    ['fluid.projection.divergence', 'fluid.poiseuille.profile', 'fluid.couette.profile', 'fluid.channel.mass']);
});
test('float32 reference against the float64 solver on short runs; a repeated run gives the same bytes', () => {
  for (const [name, make] of Object.entries(FLUID_SETUPS)) {
    const {steps} = make(), a = make().fluid, b = new FluidF32(make().fluid);
    a.step(steps); b.step(steps);
    let dv = 0, top = 0;
    for (let c = 0; c < 3; c++) { const x = b.velocity(c); for (let i = 0; i < x.length; i++) { dv = Math.max(dv, Math.abs(x[i] - a.vel[c][i])); top = Math.max(top, Math.abs(a.vel[c][i])); } }
    assert.ok(dv / top < 2e-5, `${name}: velocity differs by ${dv / top} of the largest`);
    assert.ok(b.stats.divergence < 3e-6, `${name}: divergence ${b.stats.divergence}`);
    const again = new FluidF32(make().fluid); again.step(steps);
    assert.equal(bits(again.F), bits(b.F));
  }
});

test('a device lost in mid-run: the float64 solver carries on from the last snapshot; a device that never stops a solve is refused', async () => {
  const device = cpuDevice(), compute = new GpuCompute(device), {fluid} = FLUID_SETUPS['taylor-green']();
  const runner = await FluidRunner.create(fluid, compute, {snapshotEvery: 5});
  assert.equal(runner.backend, 'gpu');
  await runner.step(12);
  assert.equal(runner.steps, 12); assert.equal(fluid.stats.steps, 0, 'the CPU solver only holds snapshots');
  device.destroy(); await device.lost;
  await runner.step(8);
  assert.equal(runner.backend, 'cpu'); assert.equal(runner.steps, 20); assert.equal(runner.fallback.stepsRerun, 2);
  assert.ok(Math.abs(fluid.time - 20 * fluid.dt) < 1e-12);
  const reference = FLUID_SETUPS['taylor-green']().fluid; reference.step(20);
  let d = 0; for (let c = 0; c < 2; c++) for (let i = 0; i < reference.vel[c].length; i++) d = Math.max(d, Math.abs(reference.vel[c][i] - fluid.vel[c][i]));
  assert.ok(d < 1e-5, `the run ends ${d} m/s from a float64 run`);
  const none = await FluidRunner.create(FLUID_SETUPS['taylor-green']().fluid, null);
  assert.equal(none.backend, 'cpu'); await none.step(2); assert.equal(none.steps, 2);
  // A device whose scalars always read zero never reports a stopped solve: refused after maxIterations, not looped on.
  const silent = await GpuFluid.create(new GpuCompute(mockDevice()), FLUID_SETUPS['taylor-green']().fluid);
  await assert.rejects(silent.step(), e => e.code === 'GPU_VALIDATION' && /without stopping/.test(e.message));
  const withSphere = FLUID_SETUPS['taylor-green']().fluid; withSphere.addObstacle({shape: {kind: 'sphere', radius: 0.5}, position: [3, 3, 0.1]});
  assert.throws(() => withSphere.backendDescription(), /obstacles/);
});
