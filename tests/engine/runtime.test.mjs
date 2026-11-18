import assert from 'node:assert/strict';
import test from 'node:test';
import { FailureSimulation, FIXED_DT } from '../../src/studio/physics.ts';
import { createStudioRuntime, cloneStudioSnapshot } from '../../src/engine/studio-runtime.ts';
import { createWorkbenchRuntime } from '../../src/engine/workbench-runtime.ts';

for (const study of ['canopy', 'plate', 'bridge']) test(`Studio ${study}: exact original solver and 12-tick recordings across different batch sizes`, () => {
  const controls = { targetLoad: 4, strength: 1.15, wind: .4 };
  const reference = new FailureSimulation(study);
  Object.assign(reference, controls);
  const runtime = createStudioRuntime({ study, controls });
  const expectedSamples = [], actualSamples = [], actualEvents = [];
  let tick = 0;
  for (const ticks of [5, 7, 1, 35, 48]) {
    const commands = [{ tick: tick + 1, type: 'controls', values: { wind: tick / 100, targetLoad: tick >= 48 ? 2 : 4 } }];
    Object.assign(reference, commands[0].values);
    for (let i = 0; i < ticks; i++) {
      reference.step(FIXED_DT); tick++;
      if (tick % 12 === 0) expectedSamples.push({ tick, snapshot: reference.snapshot() });
    }
    const result = runtime.step({ ticks, commands });
    assert.equal(result.completedTicks, ticks);
    assert.deepEqual(result.liveSnapshot, reference.snapshot());
    actualSamples.push(...result.recordingSamples);
    actualEvents.push(...result.eventDelta);
    result.release();
  }
  assert.deepEqual(actualSamples, expectedSamples);
  assert.deepEqual(actualEvents, reference.events);
  assert.deepEqual(runtime.exportCheckpoint(), reference.exportCheckpoint());
  assert.equal(runtime.capabilities.models[0].id, 'studio-pbd-js-v1');
  runtime.destroy();
});

test('Studio validates all commands and checkpoint resets before state mutation', () => {
  const runtime = createStudioRuntime({ study: 'bridge' });
  const before = runtime.exportCheckpoint();
  const bad = [
    { ticks: -1 }, { ticks: 1.5 }, { ticks: 121 }, { ticks: 1, extra: true },
    { ticks: 2, commands: [{ tick: 1, type: 'controls', values: { targetLoad: 4 } }, { tick: 2, type: 'controls', values: { strength: NaN } }] },
    { ticks: 2, commands: [{ tick: 2, type: 'controls', values: {} }, { tick: 1, type: 'controls', values: {} }] },
    { ticks: 0, commands: [{ tick: 1, type: 'controls', values: {} }] },
    { ticks: 1, commands: [{ tick: 1, type: 'controls', values: { wind: 1, sneaky: 2 } }] },
  ];
  for (const request of bad) {
    assert.throws(() => runtime.step(request), { code: 'INVALID_PAYLOAD' });
    assert.deepEqual(runtime.exportCheckpoint(), before);
  }
  assert.throws(() => runtime.reset({ study: 'plate', initialCheckpoint: before }));
  assert.deepEqual(runtime.exportCheckpoint(), before);
  runtime.destroy();
});

test('Studio outstanding loans are stable, bounded, explicitly recycled, and reset-safe', () => {
  const runtime = createStudioRuntime({ study: 'bridge', controls: { targetLoad: 4 } });
  const first = runtime.inspect(), saved = cloneStudioSnapshot(first.liveSnapshot);
  const buffer = first.liveSnapshot.positions.buffer;
  const second = runtime.step({ ticks: 12 }), recorded = cloneStudioSnapshot(second.recordingSamples[0].snapshot);
  const third = runtime.inspect();
  const before = runtime.exportCheckpoint();
  assert.throws(() => runtime.step({ ticks: 1 }), { code: 'BACKPRESSURE' });
  assert.deepEqual(runtime.exportCheckpoint(), before);
  assert.deepEqual(first.liveSnapshot, saved);
  first.release(); first.release();
  const fourth = runtime.step({ ticks: 1 });
  assert.equal(fourth.liveSnapshot.positions.buffer, buffer);
  assert.deepEqual(second.recordingSamples[0].snapshot, recorded);
  const secondSaved = cloneStudioSnapshot(second.liveSnapshot);
  const reset = runtime.reset({ study: 'canopy' });
  assert.deepEqual(second.liveSnapshot, secondSaved);
  second.release(); third.release(); fourth.release();
  assert.deepEqual(runtime.poolStats(), { allocated: 1, free: 0, outstanding: 1 });
  reset.release();
  runtime.destroy();
  assert.throws(() => runtime.inspect(), { code: 'DISPOSED' });
});

test('Studio full checkpoint restores exact future trajectory and exported copies never drift', () => {
  const source = createStudioRuntime({ study: 'bridge', controls: { targetLoad: 4, wind: .35 } });
  const warm = source.step({ ticks: 120 }); warm.release();
  const checkpoint = source.exportCheckpoint(), immutableJSON = JSON.stringify(checkpoint);
  const resumed = createStudioRuntime({ study: 'bridge', initialCheckpoint: checkpoint });
  for (let i = 0; i < 5; i++) {
    const request = { ticks: 120, commands: [{ tick: source.tick + 1, type: 'controls', values: { strength: i > 2 ? .7 : 1 } }] };
    const a = source.step(request), b = resumed.step(request);
    assert.deepEqual(a.liveSnapshot, b.liveSnapshot);
    assert.deepEqual(a.recordingSamples, b.recordingSamples);
    a.release(); b.release();
  }
  assert.equal(JSON.stringify(checkpoint), immutableJSON);
  assert.deepEqual(source.exportCheckpoint(), resumed.exportCheckpoint());
  source.destroy(); resumed.destroy();
});

test('Studio press stops at the exact original Complete tick and reports partial completion', () => {
  const press = { stroke: 5, hold: 0, strikeSpeed: 250 };
  const original = new FailureSimulation('plate', press); original.targetLoad = 5;
  let expectedTick = 0;
  while (original.pressCycle !== 'Complete' && expectedTick < 1200) { original.step(); expectedTick++; }
  assert.equal(original.pressCycle, 'Complete');
  const runtime = createStudioRuntime({ study: 'plate', press, controls: { targetLoad: 5 } });
  let result;
  do { result?.release(); result = runtime.step({ ticks: 120 }); } while (!result.completed && runtime.tick < 1200);
  assert.equal(result.completionReason, 'press-complete');
  assert.equal(result.tick, expectedTick);
  assert.deepEqual(result.liveSnapshot, original.snapshot());
  result.release();
  const after = runtime.step({ ticks: 1 });
  assert.equal(after.completedTicks, 0);
  assert.equal(after.tick, expectedTick);
  after.release(); runtime.destroy();
});

test('Studio time boundary stops without consuming extra fixed ticks or samples', () => {
  const runtime = createStudioRuntime({ study: 'bridge' });
  const result = runtime.step({ ticks: 120, stopAtTime: .1 });
  // Match the original accumulated floating-point simulation clock comparison.
  const original = new FailureSimulation('bridge'); let ticks = 0;
  while (original.time < .1) { original.step(); ticks++; }
  assert.equal(result.tick, ticks);
  assert.equal(result.completionReason, 'time-limit');
  assert.deepEqual(result.liveSnapshot, original.snapshot());
  result.release(); runtime.destroy();
});

function workbenchFakes(isWasm = false) {
  const calls = []; let rigidTick = 0, softTick = 0, reads = 0;
  const backend = { name: isWasm ? 'Box3D WASM' : 'JS fallback physics', isWasm,
    step(dt, subSteps) { calls.push(['rigid-step', dt, subSteps]); rigidTick++; },
    bodyCount() { reads++; return 3; }, dynamicCount() { reads++; return 2; }, replayHash() { reads++; return rigidTick; },
    kick(strength) { calls.push(['rigid-kick', strength]); }, destroy() { calls.push(['rigid-destroy']); },
    syncTransforms() { throw new Error('Runtime must not build presentation transforms'); },
  };
  const soft = { kind: () => 'cloth', label: () => 'Cloth',
    step(dt, subSteps) { calls.push(['soft-step', dt, subSteps]); softTick++; },
    readTelemetry() { reads++; return { kind: 'cloth', label: 'Cloth', nodeCount: 9, constraintCount: 12, brokenCount: 0, energy: softTick, hash: softTick, frameVersion: softTick, material: { peakDamage: softTick / 100 } }; },
    kick(strength) { calls.push(['soft-kick', strength]); }, destroy() { calls.push(['soft-destroy']); },
    buildFrame() { throw new Error('Runtime must not build a render frame'); },
  };
  return { backend, soft, calls, reads: () => reads };
}

test('Workbench preserves injected models, command order and dt; telemetry is opt-in and owned', () => {
  const fakes = workbenchFakes();
  const runtime = createWorkbenchRuntime({ ...fakes, softKernelVariant: 'simd' });
  const first = runtime.step({ ticks: 2, subSteps: 3, commands: [{ tick: 2, type: 'kick', strength: 4 }] });
  assert.equal(first.telemetry, null); assert.deepEqual(first.samples, []); assert.equal(fakes.reads(), 0);
  assert.deepEqual(fakes.calls, [
    ['rigid-step', 1 / 60, 3], ['soft-step', 1 / 60, 3], ['rigid-kick', 4], ['soft-kick', 4],
    ['rigid-step', 1 / 60, 3], ['soft-step', 1 / 60, 3],
  ]);
  const recorded = runtime.step({ ticks: 2, captureTelemetry: true });
  assert.deepEqual(recorded.samples.map(s => s.tick), [3, 4]);
  const saved = JSON.stringify(recorded.samples);
  runtime.step({ ticks: 1, captureTelemetry: true });
  assert.equal(JSON.stringify(recorded.samples), saved);
  assert.equal(recorded.capabilities.models[0].id, 'workbench-js-rigid-fallback-v1');
  assert.equal(recorded.capabilities.models[1].implementation, 'wasm-simd');
  assert.equal(recorded.capabilities.gpuReadback, false);
  assert.notEqual(recorded.capabilities.models[1].id, 'studio-pbd-js-v1');
  const count = fakes.calls.length;
  assert.throws(() => runtime.step({ ticks: 1, commands: [{ tick: 6, type: 'kick', strength: NaN }] }));
  assert.equal(fakes.calls.length, count); assert.equal(runtime.tick, 5);
  runtime.resetClock(); assert.equal(runtime.tick, 0);
  runtime.destroy(); assert.equal(fakes.calls.length, count);
  assert.throws(() => runtime.step({ ticks: 1 }), { code: 'DISPOSED' });
  const owned = workbenchFakes(true);
  const native = createWorkbenchRuntime({ ...owned, ownsResources: true });
  assert.equal(native.capabilities.models[0].id, 'workbench-box3d-wasm-v1');
  native.destroy(); native.destroy();
  assert.deepEqual(owned.calls, [['soft-destroy'], ['rigid-destroy']]);
});
