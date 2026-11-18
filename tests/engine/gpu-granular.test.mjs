// The GPU discrete-element backend (src/engine/gpu/granular-*.ts), as far as the gate can test it (no shader runs here):
//  - the five shader modules compile (Dawn's null backend), with and without rolling histories, and a run with every wall
//    shape encodes without a validation error;
//  - the dispatch order of a step and the alternation of the two history buffers;
//  - the float32 CPU reference of the same algorithm (GranularF32), driven through the proxy by the float64 solver's own
//    validation set-ups: the closed forms that take seconds (src/engine/gpu/granular-cases.ts says which need a looser
//    tolerance than float64 and why), against the float64 solver on short runs, the momentum balance with the walls'
//    impulses, repeatability, and what happens when the history slots or the hash buckets run out;
//  - the coupling to a rigid body with the forces read back each step or one step late;
//  - the fall back to the float64 solver when the device is lost, and when there is no device.
// The GPU itself is compared with this reference in a browser: scripts/gpu-compute-browser-check.mjs.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createDawnGpu, globals} from '../../scripts/dawn-gpu.mjs';
import {installGpuGlobals, mockDevice} from './fixtures/gpu-mock.mjs';
Object.assign(globalThis, globals);
installGpuGlobals();
const S = await import('../../packages/box3d-kit/test/granular-scenarios.mjs');
const G = await import('../../src/engine/granular.ts');
const {Granular, GranularCoupling, granularLattice} = G;
const {GpuCompute} = await import('../../src/engine/gpu/compute.ts');
const {demShaders, DEM_WALL, DEM_PARAMS, DEM_BLOCK} = await import('../../src/engine/gpu/granular-wgsl.ts');
const {GranularF32, demSetup, packDemWalls, readDemWall} = await import('../../src/engine/gpu/granular-f32.ts');
const {GpuGranular, GranularRunner, GpuGranularCoupling, demMemory, applyDemSnapshot} = await import('../../src/engine/gpu/granular-gpu.ts');
const {granularProxy, f32Remote} = await import('../../src/engine/gpu/granular-proxy.ts');
const {runGranularCases} = await import('../../src/engine/gpu/granular-cases.ts');
const {GRANULAR_SETUPS, beadBox, hopperMixer, sandAvalanche} = await import('../../src/engine/gpu/granular-setups.ts');

const dawn = createDawnGpu(['backend=null']);

test('the shaders compile without errors or warnings, and a run with every wall shape encodes without a validation error', async () => {
  const adapter = await dawn.requestAdapter(), device = await adapter.requestDevice(), uncaptured = [];
  device.addEventListener('uncapturederror', event => uncaptured.push(event.error.message));
  for (const rolling of [false, true]) for (const [name, code] of Object.entries(demShaders({historySlots: 10, bucketSlots: 12, rolling}))) {
    const info = await device.createShaderModule({code}).getCompilationInfo();
    assert.deepEqual(info.messages.map(m => `${name} ${m.type} ${m.lineNum}: ${m.message}`), []);
  }
  const compute = new GpuCompute(device, adapter.info);
  for (const make of [hopperMixer, beadBox]) {
    const solver = await GpuGranular.fromGranular(compute, make());
    await solver.step(5);
    solver.upload({grains: true, walls: true});
    await compute.read([{buffer: solver.positionBuffer, size: 16}]);
    assert.equal(solver.stats.steps, 5);
    solver.destroy();
  }
  assert.deepEqual(uncaptured, []);
  device.destroy();
});

test('a step is wall opening, integration, bucket sort, pairs, walls, wall closing; the history buffers alternate', async () => {
  const device = mockDevice(), compute = new GpuCompute(device), granular = beadBox([4, 4, 4]);
  const solver = await GpuGranular.fromGranular(compute, granular);
  const names = ['wallOpen', 'integrate', 'sort', 'pairs', 'wallContacts', 'wallClose'];
  // Creation evaluates the forces once without moving anything: parameter block 0 (h = 0).
  assert.deepEqual(device.dispatches.map(d => `${d.entryPoint} ${d.offsets[0]}`), names.map(n => `${n} 0`));
  assert.equal(new Float32Array(device.dispatches.length).length, 6);
  device.dispatches.length = 0;
  await solver.step(3);
  assert.deepEqual(device.dispatches.map(d => d.entryPoint), [...names, ...names, ...names]);
  assert.ok(device.dispatches.every(d => d.offsets[0] === 256), 'steps read the second parameter block (h = dt)');
  assert.deepEqual(device.dispatches.filter(d => d.entryPoint === 'pairs').map(d => d.group), ['granular pairs 1', 'granular pairs 0', 'granular pairs 1'], 'what a step wrote is what the next reads');
  assert.deepEqual(device.dispatches.filter(d => d.entryPoint === 'wallContacts').map(d => d.group), ['granular walls 1', 'granular walls 0', 'granular walls 1']);
  const n = granular.grainCount, s = solver.setup;
  assert.deepEqual(device.dispatches[1].workgroups, [Math.ceil(n / 64), 1, 1]);
  assert.deepEqual(device.dispatches[2].workgroups, [s.T / 64, 1, 1]);
  assert.deepEqual(device.dispatches[4].workgroups, [Math.ceil(Math.ceil(n / DEM_BLOCK) / 4), 1, 1]);
  assert.deepEqual(device.dispatches[5].workgroups, [granular.wallCount + 1, 1, 1], 'one more than the walls: the statistics');
  assert.equal(device.submitted.filter(t => t === 'clear').length, 2 * 4, 'bucket counts and the per-step meter slots are cleared before every evaluation');
  solver.destroy();
});

test('layouts, capacities and memory', () => {
  assert.equal(DEM_WALL.stride, 288); assert.equal(DEM_PARAMS.size, 128);
  const g = hopperMixer(), s = demSetup(g);
  assert.equal(s.K, 10); assert.equal(s.M, 12); assert.equal(s.HS, 2, 'rolling friction: two words per history slot');
  assert.equal(s.T & (s.T - 1), 0); assert.ok(s.T >= 2 * g.capacity);
  assert.equal(demSetup(g, {historySlots: 6, bucketSlots: 20, tableSize: 4096}).T, 4096);
  assert.throws(() => demSetup(g, {tableSize: 1000}), /power of two/);
  // Every field of every wall survives the packing (float32 of the float64 value).
  const d = g.backendDescription();
  for (let k = 0; k < g.wallCount; k++) {
    const w = readDemWall(s.walls, k);
    assert.deepEqual(w.position, d.walls[k].position.map(Math.fround)); assert.deepEqual(w.angularVelocity, d.walls[k].angularVelocity.map(Math.fround));
    assert.deepEqual(DEM_WALL.read(s.walls, k).shape, d.walls[k].shape);
  }
  const m = demMemory(1_000_000);
  assert.equal(m.history, 160_000_000); assert.equal(m.grid, 4 * 2 ** 21 * 13);
  assert.ok(m.largest > 134217728, 'a million grains with ten history slots need more than the default binding size');
  assert.ok(demMemory(1_000_000, {historySlots: 8}).largest <= 134217728);
  assert.throws(() => { const big = new Granular({material: {density: 1, restitution: 1, friction: 0}, config: {law: 'linear', normalStiffness: 1, dt: 1e-9, capacity: 4}}); for (let k = 0; k < 17; k++) big.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}}); demSetup(big); }, /at most 16 walls/);
});

let cases;
test('float32 reference through the proxy: the closed forms of the float64 validation that take seconds', {timeout: 600000}, () => {
  cases = runGranularCases(S, {...G, Granular: granularProxy(f32Remote)}, {quick: true});
  for (const row of cases.rows) assert.equal(row.pass, true, `${row.id}: ${row.value} against ${row.reference} (${row.tolerance.kind} ${row.tolerance.value})`);
  assert.equal(cases.rows.length, 17);
  assert.deepEqual(cases.rows.filter(r => r.tolerance.value !== r.float64.value).map(r => r.id), ['granular.hertz.duration', 'granular.hertz.duration-order', 'granular.incline.sliding', 'granular.free-wall.momentum']);
  // The two grains of an impact get exactly opposite forces: the momentum does not change by one bit.
  assert.equal(cases.rows.find(r => r.id === 'granular.momentum.impact').value, 0);
});

const meanRadius = g => g.radii.subarray(0, g.grainCount).reduce((a, b) => a + b, 0) / g.grainCount;
function difference(f32, g) {
  let worst = 0;
  for (let i = 0; i < g.grainCount; i++) { if (f32.pos[4 * i + 3] <= 0) continue; for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(f32.pos[4 * i + k] - g.positions[3 * i + k])); }
  return worst / meanRadius(g);
}
test('float32 reference against the float64 solver on short runs, with every wall shape', () => {
  for (const [name, make] of Object.entries(GRANULAR_SETUPS)) {
    const a = make().granular, b = new GranularF32(make().granular);
    a.step(150); b.step(150);
    assert.ok(difference(b, a) < 2e-3, `${name}: positions differ by ${difference(b, a)} radii after 150 steps`);
    assert.equal(b.stats.contacts, a.stats.contacts, `${name}: touching pairs`);
    assert.equal(b.stats.wallContacts, a.stats.wallContacts, `${name}: wall contacts`);
    assert.equal(b.stats.historyOverflow, 0); assert.equal(b.stats.bucketOverflow, 0);
    for (let k = 0; k < a.wallCount; k++) {
      const w = readDemWall(b.wallF, k), f = a.wallForce(k), scale = Math.max(1e-3, Math.hypot(...f));
      assert.ok(Math.hypot(w.force[0] - f[0], w.force[1] - f[1], w.force[2] - f[2]) / scale < 0.02, `${name}: force on wall ${k}`);
      assert.equal(w.contacts, a.wallContacts(k));
    }
  }
});
test('float32 reference: the grains\' momentum changes by gravity and the walls\' impulses; a repeated run gives the same bytes', () => {
  const start = beadBox(), b = new GranularF32(beadBox()), steps = 600, t = steps * start.dt;
  b.step(steps);
  const p = [0, 0, 0], impulse = [0, 0, 0]; let mass = 0;
  for (let i = 0; i < b.count; i++) { const m = b.vel[4 * i + 3]; mass += m; for (let k = 0; k < 3; k++) p[k] += m * b.vel[4 * i + k]; }
  for (let w = 0; w < start.wallCount; w++) { const wall = readDemWall(b.wallF, w); for (let k = 0; k < 3; k++) impulse[k] += wall.impulse[k]; }
  const g = start.gravity, worst = Math.max(...[0, 1, 2].map(k => Math.abs(p[k] + impulse[k] - mass * g[k] * t))) / (mass * 9.81 * t);
  assert.ok(worst < 2e-5, `momentum balance ${worst}`);
  assert.ok(b.stats.contacts > 100 && b.stats.wallContacts > 30, 'the beads have landed');
  const hash = () => { const r = new GranularF32(hopperMixer()); r.step(300); return createHash('sha256').update(new Uint8Array(r.pos.buffer)).update(new Uint8Array(r.vel.buffer)).update(new Uint8Array(r.spin.buffer)).update(new Uint8Array(r.wallF.buffer)).digest('hex') + r.stats.removed; };
  assert.equal(hash(), hash());
});
test('capacity: a contact without a free history slot goes on without history and is counted; a full bucket is counted', () => {
  const few = new GranularF32(beadBox(), {historySlots: 2}); few.step(600);
  assert.ok(few.stats.historyOverflow > 0, 'two slots are not enough for a packed bed');
  let top = 0; for (let i = 0; i < few.count; i++) top = Math.max(top, few.pos[4 * i + 1]);
  assert.ok(top < 0.2 && Number.isFinite(top), 'the run goes on: the bed still stands in its box');
  const full = new GranularF32(beadBox()); full.step(600);
  assert.equal(full.stats.historyOverflow, 0); assert.equal(full.stats.bucketOverflow, 0);
  const tight = new GranularF32(beadBox(), {bucketSlots: 1, tableSize: 64}); tight.step(5);
  assert.ok(tight.stats.bucketOverflow > 0, '64 buckets of one grain cannot hold 360 grains');
});

// A rigid world of one box that only translates: enough to drive the coupling.
function oneBodyWorld(step, body) {
  return {loop: {step}, gravity: () => [0, -9.81, 0],
    getState: () => ({position: [...body.x], rotation: [0, 0, 0, 1], linearVelocity: [...body.v], angularVelocity: [0, 0, 0], mass: body.mass, type: 'dynamic'}),
    applyForce(_b, f) { for (let k = 0; k < 3; k++) body.f[k] += f[k]; }, applyTorque() {},
    step() { for (let k = 0; k < 3; k++) { body.v[k] += step * (body.f[k] / body.mass + (k === 1 ? -9.81 : 0)); body.x[k] += step * body.v[k]; body.f[k] = 0; } }};
}
async function blockOnBed(latency, blockMass, HZ = 240) {
  const R = 0.005, pitch = 2.2 * R, n = [6, 4, 6], w = n[0] * pitch, d = n[2] * pitch, half = [0.3 * w, 0.01, 0.3 * d];
  const material = {density: 2500, restitution: 0.3, friction: 0.5, rollingFriction: 0.05}, mass = 2500 * Math.PI / 6 * (2 * R) ** 3, config = {law: 'linear', normalStiffness: 4000 * mass * 9.81 / (2 * R)};
  const critical = new Granular({material, config: {...config, dt: 1e-12, capacity: 1}}).criticalTimeFor(0.9 * R), dt = 1 / HZ / Math.ceil(1 / HZ / (0.12 * critical));
  const lattice = granularLattice({min: [0, 0, 0], max: [w, n[1] * pitch, d], radius: [0.9 * R, 1.1 * R], gap: 0, jitter: 1, seed: 7});
  const g = new Granular({material, config: {...config, dt, capacity: lattice.count}});
  const floor = g.addWall({shape: {kind: 'plane', normal: [0, 1, 0]}});
  g.addWall({shape: {kind: 'plane', normal: [1, 0, 0]}, friction: 0}); g.addWall({shape: {kind: 'plane', normal: [-1, 0, 0]}, position: [w, 0, 0], friction: 0});
  g.addWall({shape: {kind: 'plane', normal: [0, 0, 1]}, friction: 0}); g.addWall({shape: {kind: 'plane', normal: [0, 0, -1]}, position: [0, 0, d], friction: 0});
  g.addGrains(lattice.positions, lattice.radii);
  const body = {x: [w / 2, n[1] * pitch + 0.02, d / 2], v: [0, 0, 0], f: [0, 0, 0], mass: blockMass}, world = oneBodyWorld(1 / HZ, body);
  const coupling = new GranularCoupling(world, g);
  coupling.addBody(body, {shape: {kind: 'box', halfExtents: half}});
  // The float32 reference stands in for the GPU: it works on the same buffers the GPU would be uploaded from.
  const setup = demSetup(g), f32 = new GranularF32(setup);
  const stand = {setup, uploadWalls() {}, async step(count) { f32.step(count); }, async readWalls() { return f32.wallF.slice(); }};
  const gpu = new GpuGranularCoupling(coupling, stand, {latency});
  const steps = Math.round(0.9 * HZ), window = Math.round(0.2 * HZ);
  let force = 0, base = 0, lowest = Infinity;
  for (let i = 0; i < steps; i++) {
    await gpu.step(); world.step();
    lowest = Math.min(lowest, body.x[1]);
    if (i >= steps - window) { force += coupling.force(body)[1] / window; base -= readDemWall(f32.wallF, floor).impulse[1] * HZ / window; }
  }
  let grains = 0; for (let i = 0; i < f32.count; i++) grains += f32.vel[4 * i + 3];
  return {force, weight: body.mass * 9.81, base, total: (body.mass + grains) * 9.81, speed: Math.hypot(...body.v), height: body.x[1], lowest, substeps: coupling.substeps};
}
test('coupling to a rigid body: the bed carries the block\'s weight, with the forces of this step or of the step before', {timeout: 600000}, async () => {
  // With the forces read back every rigid step, a light block (0.06 kg) rests on the bed.
  const light = await blockOnBed(0, 0.06);
  assert.ok(Math.abs(light.force / light.weight - 1) < 2e-3, `the bed pushes the light block with ${light.force} N of ${light.weight}`);
  assert.ok(Math.abs(light.base / light.total - 1) < 2e-3, `the floor carries ${light.base} N of ${light.total}`);
  assert.ok(light.speed < 2e-3, `the light block has come to rest (${light.speed} m/s)`);
  // With the forces one rigid step late, that block is thrown off: the delay on a stiff contact needs m >> k h^2
  // (about 1.7 kg at 240 Hz under this block). At 960 Hz (k h^2 = 0.1 kg) a block of 0.5 kg rests either way.
  const thrown = await blockOnBed(1, 0.06);
  assert.ok(thrown.speed > 0.1 || thrown.height < 0, 'the light block does not rest with delayed forces at 240 Hz: the documented limit');
  const now = await blockOnBed(0, 0.5, 960), late = await blockOnBed(1, 0.5, 960);
  for (const [name, r] of [['latency 0', now], ['latency 1', late]]) {
    assert.ok(Math.abs(r.force / r.weight - 1) < 5e-3, `${name}: the bed pushes the block with ${r.force} N of ${r.weight}`);
    assert.ok(Math.abs(r.base / r.total - 1) < 5e-3, `${name}: the floor carries ${r.base} N of ${r.total}`);
    assert.ok(r.speed < 5e-3, `${name}: the block has come to rest (${r.speed} m/s)`);
  }
  assert.ok(Math.abs(late.height - now.height) < 0.002, `resting heights ${now.height} and ${late.height}`);
});

test('a device lost in mid-run: the float64 solver carries on from the last snapshot; no device starts on the CPU', async () => {
  const device = mockDevice(), compute = new GpuCompute(device), granular = beadBox([4, 4, 4]);
  const runner = await GranularRunner.create(granular, compute, {snapshotEvery: 100});
  assert.equal(runner.backend, 'gpu');
  await runner.step(250);
  assert.equal(runner.steps, 250); assert.ok(Math.abs(granular.time - 200 * granular.dt) < 1e-12, 'the CPU solver holds the snapshot of step 200');
  device.destroy(); await device.lost;
  await runner.step(150);
  assert.equal(runner.backend, 'cpu'); assert.equal(runner.steps, 400); assert.equal(runner.fallback.stepsRerun, 50);
  assert.match(runner.fallback.reason, /lost|destroyed/);
  // The stand-in device ran no shader: the snapshot is the start state, from which the CPU ran the 50 + 150 steps.
  // (The start state went through the device's float32 buffers.)
  const reference = beadBox([4, 4, 4]); for (let k = 0; k < reference.positions.length; k++) reference.positions[k] = Math.fround(reference.positions[k]);
  reference.touch(); reference.step(200);
  assert.deepEqual(granular.positions, reference.positions);
  const none = await GranularRunner.create(beadBox([3, 3, 3]), null);
  assert.equal(none.backend, 'cpu'); await none.step(10); assert.equal(none.steps, 10);
  const refused = await GranularRunner.create(beadBox([3, 3, 3]), new GpuCompute(mockDevice({limits: {maxStorageBufferBindingSize: 4096}})));
  assert.equal(refused.backend, 'cpu'); assert.match(refused.fallback.reason, /storage buffer/);
});
test('a snapshot written into a Granular: positions, removed grains, wall poses and loads', () => {
  const g = hopperMixer(), f32 = new GranularF32(hopperMixer());
  f32.step(400);
  f32.pos[3] = -f32.pos[3];
  applyDemSnapshot(g, {count: f32.count, time: f32.time, pos: f32.pos, vel: f32.vel, spin: f32.spin, walls: f32.wallF});
  assert.equal(g.alive[0], 0); assert.equal(g.stats.removed, f32.stats.removed + 1, 'the grains the backend removed, and the one marked here');
  assert.equal(g.positions[3 * 5 + 1], f32.pos[4 * 5 + 1]);
  assert.deepEqual([...g.wallPosition(5)], readDemWall(f32.wallF, 5).position, 'the free sphere is where the backend left it');
  assert.deepEqual([...g.wallImpulse(1)], readDemWall(f32.wallF, 1).impulse);
  assert.ok(Math.abs(g.time - f32.time) < 1e-12);
  g.step(10);
  assert.ok(Number.isFinite(g.kineticEnergy()));
});
test('the example at scale: an avalanche of a hundred thousand grains is a valid set-up within the default limits', () => {
  const small = sandAvalanche(2000);
  assert.ok(Math.abs(small.granular.grainCount / 2000 - 1) < 0.2);
  assert.ok(small.granular.timeStepFraction <= 0.2, 'the step is inside the stability limit');
  assert.equal(small.stepsPerSecond % 60, 0);
  const m = demMemory(100_000, {rolling: true, walls: 5});
  assert.ok(m.largest <= 134217728 && m.total < 200e6, `${m.total} bytes for 100 000 grains`);
});
