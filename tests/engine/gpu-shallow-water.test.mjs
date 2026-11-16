// The GPU shallow-water backend (src/engine/gpu/shallow-water-*.ts), as far as the gate can test it (no shader runs here):
//  - the shader compiles (Dawn's null backend) and a whole run encodes without a validation error, with every feature on;
//  - the dispatch order of a step (friction, measurement, then stage and finish per substep) and the parameter blocks;
//  - the float32 CPU reference of the same algorithm (ShallowWaterF32) against every closed form of the float64 solver's
//    validation that the backend covers, with the float64 tolerance except where float32 forces a looser one
//    (src/engine/gpu/shallow-water-cases.ts says which and why), against the float64 solver on short runs, its volume
//    budget and its repeatability;
//  - the fall back to the float64 solver when the device is lost, and when there is no device.
// The GPU itself is compared with this reference in a browser: scripts/gpu-compute-browser-check.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {create, globals} from 'webgpu';
import {installGpuGlobals, mockDevice} from './fixtures/gpu-mock.mjs';
Object.assign(globalThis, globals);
installGpuGlobals();
const S = await import('../../packages/box3d-kit/test/shallow-water-scenarios.mjs');
const {ShallowWater} = await import('../../src/engine/shallow-water.ts');
const {GpuCompute} = await import('../../src/engine/gpu/compute.ts');
const {SHALLOW_WATER_WGSL, SW_PARAMS, SW_MANNING, SW_SOIL, SW_RAIN, SW_COUNT_WET} = await import('../../src/engine/gpu/shallow-water-wgsl.ts');
const {ShallowWaterF32, planShallowWaterSubsteps} = await import('../../src/engine/gpu/shallow-water-f32.ts');
const {GpuShallowWater, ShallowWaterRunner} = await import('../../src/engine/gpu/shallow-water-gpu.ts');
const {runShallowWaterCases} = await import('../../src/engine/gpu/shallow-water-cases.ts');
const {f32Backend, shallowWaterDifference} = await import('../../src/engine/gpu/shallow-water-validation.ts');
const {SHALLOW_WATER_SETUPS, floodValley} = await import('../../src/engine/gpu/shallow-water-setups.ts');

const dawn = create(['backend=null']);

test('the shader compiles without errors or warnings, and a run with every feature encodes without a validation error', async () => {
  const adapter = await dawn.requestAdapter(), device = await adapter.requestDevice(), uncaptured = [];
  device.addEventListener('uncapturederror', event => uncaptured.push(event.error.message));
  const module = device.createShaderModule({code: SHALLOW_WATER_WGSL});
  assert.deepEqual((await module.getCompilationInfo()).messages.map(m => `${m.type} ${m.lineNum}: ${m.message}`), []);
  const compute = new GpuCompute(device, adapter.info);
  // The null backend runs nothing and reads back arbitrary bytes, so only the encoding is checked here: with face speeds
  // from an earlier step, the readbacks are never interpreted before the run ends.
  for (const name of ['everything', 'pier', 'thacker']) {
    const solver = await GpuShallowWater.create(compute, new ShallowWater(SHALLOW_WATER_SETUPS[name]().options), {rateLatency: 1000});
    await solver.step(3);
    await compute.read([{buffer: solver.stateBuffer, size: 16}]);
    assert.equal(solver.steps, 3);
    solver.destroy();
  }
  assert.deepEqual(uncaptured, []);
  device.destroy();
});

test('a step is friction, measurement, then stage and finish per substep, each with its own parameter block', async () => {
  const device = mockDevice(), compute = new GpuCompute(device), {options} = SHALLOW_WATER_SETUPS.everything();
  const solver = await GpuShallowWater.create(compute, new ShallowWater(options));
  await solver.step();
  // Nothing ran (the stand-in device has no shaders): the meter reads zero speed, so one substep; no friction before the
  // very first measurement (the first substep leads with its own length instead).
  assert.deepEqual(device.dispatches.map(d => `${d.entryPoint} ${d.group.split(' ').at(-1)} ${d.offsets[0]}`), ['measure forward 0', 'lead backward 0', 'stage forward 0', 'finish backward 0']);
  assert.deepEqual(device.dispatches[2].workgroups, [6, 4, 1], '48 x 32 cells in 8 x 8 workgroups');
  device.dispatches.length = 0;
  await solver.step();
  assert.deepEqual(device.dispatches.map(d => d.entryPoint), ['lead', 'measure', 'stage', 'finish'], 'later steps lead with the friction before the measurement, as the float64 solver does');
  // With a speed in the meter the step is split, and every substep reads its own block.
  const plan = planShallowWaterSubsteps(0.05, 6, 3, {dx: 0.25, dz: 0.25, nz: 32, cfl: 0.45, maxSubsteps: 100000});
  assert.equal(plan.substeps, 4); assert.equal(plan.sub, 0.0125);
  assert.equal(planShallowWaterSubsteps(0.05, 6, 3, {dx: 0.25, dz: 0.25, nz: 1, cfl: 0.45, maxSubsteps: 100}).substeps, 3, 'one row: the z speed does not count');
  assert.equal(planShallowWaterSubsteps(0.05, 6, 3, {dx: 0.25, dz: 0.25, nz: 32, cfl: 0.45, maxSubsteps: 100}, 1.25).substeps, 5, 'the safety factor widens the margin');
  assert.throws(() => planShallowWaterSubsteps(1, 600, 0, {dx: 0.01, dz: 0.01, nz: 1, cfl: 0.45, maxSubsteps: 1000}), e => e.code === 'UNSTABLE_TIME_STEP');
  assert.equal(SW_PARAMS.field('sides').offset, 80);

  assert.ok(SW_MANNING === 1 && SW_SOIL === 2 && SW_RAIN === 32 && SW_COUNT_WET === 16);
  solver.destroy();
});

test('with face speeds from an earlier step, a step waits for no readback but the one that is due', async () => {
  const device = mockDevice(), compute = new GpuCompute(device), {options} = SHALLOW_WATER_SETUPS.thacker();
  const solver = await GpuShallowWater.create(compute, new ShallowWater(options), {rateLatency: 2});
  assert.equal(solver.safety, 1.25);
  device.dispatches.length = 0;
  await solver.step(5);
  assert.deepEqual([...new Set(device.dispatches.map(d => d.entryPoint))], ['stage', 'finish'], 'no measuring pass after the one at creation');
  await solver.sync();
  assert.equal(solver.steps, 5);
  // rateWait false: nothing is awaited inside a step, and at most four readbacks are on their way.
  const free = await GpuShallowWater.create(compute, new ShallowWater(options), {rateLatency: 2, rateWait: false, safety: 1.5});
  const copies = device.submitted.filter(t => t === 'copy').length;
  let settled = false;
  const run = free.step(12).then(() => { settled = true; });
  await Promise.resolve(); await Promise.resolve();
  await run;
  assert.equal(settled, true); assert.equal(free.steps, 12);
  assert.ok(device.submitted.filter(t => t === 'copy').length - copies <= 12, 'a readback is issued only while fewer than four are outstanding');
  await free.sync();
  assert.equal(free.rateWait, false); assert.equal(free.safety, 1.5);
});

let cases;
test('float32 reference: every closed form of the float64 validation that the backend covers', {timeout: 600000}, async () => {
  cases = await runShallowWaterCases(S, f32Backend);
  for (const row of cases.rows) assert.equal(row.pass, true, `${row.id}: ${row.value} against ${row.reference} (${row.tolerance.kind} ${row.tolerance.value})`);
  assert.equal(cases.rows.length, 22);
  // Only the lake at rest and the volume budget need a looser tolerance than float64.
  assert.deepEqual(cases.rows.filter(r => r.tolerance.value !== r.float64.value).map(r => r.id), ['shallow-water.lake.immersed', 'shallow-water.lake.emerged', 'shallow-water.lake.level', 'shallow-water.volume.budget']);
});
test('float32 reference: volume budget of every set-up, and the Courant number of the first stage', () => {
  for (const [name, run] of Object.entries(cases.runs)) {
    if (run.volumeError !== null) assert.ok(Math.abs(run.volumeError) <= 1e-6, `${name}: relative volume budget error ${run.volumeError}`);
    assert.ok(run.maxCourant <= 0.5, `${name}: Courant number ${run.maxCourant}`);
  }
});

function frames(options, steps) {
  const w = new ShallowWater(options), r = new ShallowWaterF32(new ShallowWater(options));
  w.step(steps); r.step(steps);
  const n = r.cells, h = new Float64Array(n), qx = new Float64Array(n), qz = new Float64Array(n);
  for (let c = 0; c < n; c++) { h[c] = r.depth(c); qx[c] = r.state[4 * c + 1]; qz[c] = r.state[4 * c + 2]; }
  return {w, r, f32: {h, qx, qz}};
}
test('float32 reference against the float64 solver on short runs: depth within 2e-6 of the largest depth', () => {
  for (const [name, make] of Object.entries(SHALLOW_WATER_SETUPS)) {
    const {options, steps} = make(), {w, r, f32} = frames(options, steps), d = shallowWaterDifference(f32, w);
    assert.ok(d.depth / d.maxDepth < 2e-6, `${name}: depth differs by ${d.depth / d.maxDepth} of the largest`);
    assert.ok(d.discharge / d.maxDischarge < 2e-5, `${name}: discharge differs by ${d.discharge / d.maxDischarge} of the largest`);
    assert.ok(Math.abs(r.volumeError()) / r.volume() < 1e-7, `${name}: volume budget ${r.volumeError() / r.volume()}`);
    assert.ok(Math.abs(w.time - r.time) < 1e-9);
  }
});
test('float32 reference: a repeated run gives the same bytes; rain into deep water is not lost', () => {
  const hash = () => { const {options, steps} = SHALLOW_WATER_SETUPS.everything(), r = new ShallowWaterF32(new ShallowWater(options)); r.step(steps); return createHash('sha256').update(new Uint8Array(r.state.buffer)).update(new Uint8Array(r.aux.buffer)).digest('hex'); };
  assert.equal(hash(), hash());
  // 10 m of water, rain of 1e-7 m per step: below half a unit in the last place of the depth (4.8e-7 m), so a plain
  // float32 sum would never change. The carry keeps it: after 1000 steps the volume has grown by the rain to 1e-6 of it.
  const water = new ShallowWater({cells: [4, 4], spacing: 1, depth: () => 10, rain: 1e-6, dt: 0.1}), r = new ShallowWaterF32(water);
  r.step(1000);
  const gained = r.volume() - r.initialVolume, exact = 1e-6 * 100 * 16;
  assert.ok(Math.abs(gained - exact) < 1e-6 * exact, `gained ${gained} m^3 of ${exact}`);
  assert.ok(Math.abs(r.state[0] - 10.0001) < 2e-6 && r.state[0] > 10, 'the depth itself moved once the carry reached a unit in the last place');
});

test('a device lost in mid-run: the float64 solver carries on from the last snapshot at the same step count', async () => {
  const device = mockDevice(), compute = new GpuCompute(device), {options} = SHALLOW_WATER_SETUPS.everything();
  const water = new ShallowWater(options), runner = await ShallowWaterRunner.create(water, compute, {snapshotEvery: 5});
  assert.equal(runner.backend, 'gpu'); assert.equal(runner.fallback, null);
  await runner.step(12);
  assert.equal(runner.steps, 12); assert.equal(water.steps, 10, 'the CPU solver holds the snapshot of step 10');
  device.destroy(); await device.lost;
  await runner.step(8);
  assert.equal(runner.backend, 'cpu'); assert.equal(runner.gpu, null);
  assert.equal(runner.steps, 20); assert.equal(water.steps, 20);
  assert.equal(runner.fallback.stepsRerun, 2); assert.match(runner.fallback.reason, /lost|destroyed/);
  assert.ok(Math.abs(runner.time - 20 * options.dt) < 1e-12);
  // The stand-in device ran no shader, so the snapshot of step 10 is the start state: the run is the float64 solver's
  // from there, 10 steps on (the real thing, with a real snapshot, is checked in the browser).
  // (The start state went through the device's float32 buffers.)
  const reference = new ShallowWater(options); for (let c = 0; c < reference.cells; c++) reference.h[c] = Math.fround(reference.h[c]);
  reference.step(10);
  assert.deepEqual(water.h, reference.h); assert.deepEqual(water.qx, reference.qx);
});
test('no device, or one that cannot hold the grid: the run starts on the CPU and says why', async () => {
  const {options} = SHALLOW_WATER_SETUPS.ritter();
  const none = await ShallowWaterRunner.create(new ShallowWater(options), null);
  assert.equal(none.backend, 'cpu'); assert.match(none.fallback.reason, /not available/);
  await none.step(3); assert.equal(none.steps, 3);
  const small = new GpuCompute(mockDevice({limits: {maxStorageBufferBindingSize: 1024}}));
  const refused = await ShallowWaterRunner.create(new ShallowWater(options), small);
  assert.equal(refused.backend, 'cpu'); assert.match(refused.fallback.reason, /storage buffer of 3200 bytes/);
});
test('the example at scale: a valley of a million cells is a valid set-up', () => {
  const options = floodValley(64), w = new ShallowWater(options);
  assert.ok(w.volume() > 0 && w.stats.wetCells > 0 && w.stats.wetCells < w.cells);
  assert.deepEqual(floodValley(1024).cells, [1024, 1024]);
});
