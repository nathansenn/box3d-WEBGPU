// The flow solver's step on WebGPU (src/engine/gpu/flow-gpu.ts), as far as the gate can test it (no shader runs here):
//  - the shader compiles on Dawn without errors or warnings, and steps of a tunnel with a sphere, a box, an inlet, an
//    outlet and slip sides encode and read back without a validation error (the null backend runs nothing);
//  - the float32 reference (FlowLatticeF32, the shader's operations in its order, rounded to float32) against the
//    float64 FlowLattice: velocity fields and forces after 200 steps of a turbulent tunnel, and a laminar pipe at its
//    steady state against Hagen-Poiseuille with the float64 band;
//  - the features the kernel lacks are refused with a message.
// The shader's results are not compared with the reference here: that needs a GPU (docs/GPU_COMPUTE.md).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDawnGpu, globals} from '../../scripts/dawn-gpu.mjs';
Object.assign(globalThis, globals);
const {Flow} = await import('../../src/engine/flow.ts');
const {GpuCompute} = await import('../../src/engine/gpu/compute.ts');
const {FLOW_WGSL, FlowLatticeF32, GpuFlowLattice, flowGpuSums, flowGpuSupport, FLOW_GPU_SOLVER_ID} = await import('../../src/engine/gpu/flow-gpu.ts');
const dawn = createDawnGpu(['backend=null']);

const gpuReady = {wallFunction: false, absorbSteps: 0, collision: 'regularized'};
function tunnel(extra = {}) {
  return new Flow({grid: {origin: [0, 0, 0], cell: 0.05, nx: 40, ny: 16, nz: 16}, fluid: {density: 1.2, viscosity: 1.5e-5},
    geometry: [{kind: 'sphere', center: [0.6, 0.4, 0.4], radius: 0.15, part: 'ball'}, {kind: 'box', center: [1.3, 0.3, 0.45], halfExtents: [0.1, 0.2, 0.15], rotation: [0, Math.sin(0.3), 0, Math.cos(0.3)], part: 'block'}],
    sides: {xMin: {kind: 'velocity', velocity: [8, 0, 0]}, xMax: {kind: 'pressure'}, yMin: {kind: 'wall', part: 'ground'}, yMax: 'slip', zMin: 'slip', zMax: 'slip'},
    referenceSpeed: 8, initialVelocity: [8, 0, 0], ...gpuReady, ...extra});
}

test('the flow shader compiles, and steps encode and read back without a validation error', async () => {
  assert.equal(FLOW_GPU_SOLVER_ID, 'flow-lbm-d3q19-regularized-les-webgpu-f32-v1');
  const adapter = await dawn.requestAdapter(), device = await adapter.requestDevice(), uncaptured = [];
  device.addEventListener('uncapturederror', event => uncaptured.push(event.error.message));
  assert.deepEqual((await device.createShaderModule({code: FLOW_WGSL}).getCompilationInfo()).messages.map(m => `${m.type} ${m.lineNum}: ${m.message}`), []);
  const compute = new GpuCompute(device, adapter.info), flow = tunnel();
  assert.ok(flowGpuSupport(flow.lattice).ok);
  const gpu = await GpuFlowLattice.create(compute, flow.lattice);
  gpu.step(3);
  const back = await gpu.read();
  assert.equal(back.f.length, 19 * flow.lattice.fluidCells);
  assert.equal(back.moments.length, 4 * flow.lattice.fluidCells);
  gpu.writeParams(flow.lattice); gpu.step(1); await gpu.read();
  gpu.destroy();
  assert.deepEqual(uncaptured, []);
  device.destroy(); await device.lost;
});

test('the float32 reference follows the float64 lattice: a turbulent tunnel over 200 steps, fields and forces', () => {
  const flow = tunnel(), L = flow.lattice, f32 = new FlowLatticeF32(L);
  assert.equal(flow.turbulence, 'smagorinsky');
  for (let s = 0; s < 200; s++) { L.step(); f32.step(); }
  const u = flow.latticeSpeed;
  let worst = 0;
  for (let a = 0; a < L.fluidCells; a++) worst = Math.max(worst, Math.abs(f32.moments[4 * a + 1] - L.ux[a]), Math.abs(f32.moments[4 * a + 2] - L.uy[a]), Math.abs(f32.moments[4 * a + 3] - L.uz[a]));
  assert.ok(worst / u < 2e-3, `largest velocity difference ${worst / u} of the reference speed`);
  const sums = flowGpuSums(L, f32.linkFlux);
  for (let p = 0; p < 2; p++) {
    const a = Math.hypot(sums.force[3 * p], sums.force[3 * p + 1], sums.force[3 * p + 2]), b = Math.hypot(L.partForce[3 * p], L.partForce[3 * p + 1], L.partForce[3 * p + 2]);
    assert.ok(Math.abs(a - b) <= 5e-3 * b, `force on part ${p}: ${a} against ${b}`);
  }
  let mass = 0; for (let i = 0; i < sums.patchMass.length; i++) mass += Math.abs(sums.patchMass[i] - L.patchMass[i]);
  assert.ok(mass <= 1e-3 * Math.abs(L.patchMass[0]), `mass through the openings: ${mass}`);
  console.log(`  float32 against float64 after 200 steps: velocity ${(worst / u).toExponential(2)} of U`);
});

test('the float32 reference: a laminar pipe at its steady state against Hagen-Poiseuille', () => {
  const n = 12, R = 0.5, h = 2 * R / n, nu = 0.02, g = 0.3, c = R + 0.5 * h;
  const flow = new Flow({grid: {origin: [0, 0, 0], cell: h, nx: 2, ny: n + 1, nz: n + 1}, geometry: [{kind: 'cylinder', from: [-5, c, c], to: [5, c, c], radius: R, role: 'cavity', part: 'pipe'}],
    fluid: {density: 1, viscosity: nu}, sides: {xMin: 'periodic', xMax: 'periodic'}, referenceSpeed: 1, acceleration: [g, 0, 0], ...gpuReady});
  const f32 = new FlowLatticeF32(flow.lattice);
  let last = 0, q = 0;
  for (let k = 0; k < 400; k++) {
    for (let s = 0; s < 200; s++) f32.step();
    q = 0; for (let a = 0; a < flow.lattice.fluidCells; a++) q += f32.moments[4 * a + 1];
    if (Math.abs(q - last) <= 1e-7 * Math.abs(q)) break;
    last = q;
  }
  // flow rate: the mean of u over the fluid cells of the two layers times their area, over the length
  const flowRate = q * (flow.cell / flow.dt) * h * h / 2, exact = Math.PI * R ** 4 * g / (8 * nu);
  assert.ok(Math.abs(flowRate / exact - 1) <= 0.03, `flow rate ${flowRate} against ${exact}`);
  console.log(`  float32 laminar pipe: ${(flowRate / exact - 1).toFixed(4)}`);
});

test('features the kernel does not have are refused', () => {
  for (const extra of [{wallFunction: true}, {absorbSteps: undefined}, {spongeCells: 3}]) {
    const flow = tunnel(extra), support = flowGpuSupport(flow.lattice);
    assert.equal(support.ok, false, JSON.stringify(extra));
    assert.throws(() => new FlowLatticeF32(flow.lattice), /GPU kernel does not have/);
  }
});
