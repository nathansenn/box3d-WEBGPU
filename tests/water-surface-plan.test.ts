import { WaterSurfacePlanner, type WaterSurfaceDescription } from '../src/webgpu/water-surface-plan.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, label: string): void {
  assert(Object.is(actual, expected), `${label}: expected ${String(expected)}, got ${String(actual)}`);
}
function throws(operation: () => unknown, text: string): void {
  let caught: unknown;
  try { operation(); } catch (error) { caught = error; }
  assert(caught instanceof Error && caught.message.includes(text),
    `Expected error containing ${text}, got ${String(caught)}`);
}
function surface(overrides: Partial<WaterSurfaceDescription> = {}): WaterSurfaceDescription {
  return {
    indices: new Uint16Array([0, 1, 2, 2, 5, 8]),
    vertexCount: 9, indexCount: 6, topologyVersion: 0, frameVersion: 0,
    cols: 3, rows: 3, width: 8.25, depth: 6.5, baseY: -1.125,
    ...overrides,
  };
}
let passed = 0;
function test(name: string, operation: () => void): void {
  try { operation(); passed++; }
  catch (error) { throw new Error(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}

test('packs the uniform ABI and checks only active triangle indices', () => {
  const planner = new WaterSurfacePlanner();
  const description = surface({ indices: new Uint16Array([0, 1, 4, 65535, 65535, 65535]), indexCount: 3 });
  const plan = planner.resolve(description);
  equal(plan.indexCount, 3, 'active index count');
  equal(plan.maxIndex, 4, 'unused trailing storage does not become geometry');
  equal(plan.params.byteLength, 64, 'uniform allocation size');
  const view = new DataView(plan.params.buffer, plan.params.byteOffset, plan.params.byteLength);
  equal(view.getUint32(0, true), 3, 'columns');
  equal(view.getUint32(4, true), 3, 'rows');
  equal(view.getUint32(8, true), 9, 'vertex count');
  equal(view.getFloat32(16, true), Math.fround(description.width), 'width');
  equal(view.getFloat32(20, true), Math.fround(description.depth), 'depth');
  equal(view.getFloat32(24, true), Math.fround(description.baseY), 'elevation');
  for (const offset of [12, 28, 32, 36, 40, 44, 48, 52, 56, 60]) {
    equal(view.getUint32(offset, true), 0, `zero uniform padding at ${offset}`);
  }
});

test('unchanged metadata stays cached across simulation frame versions', () => {
  const planner = new WaterSurfacePlanner();
  const description = surface();
  const first = planner.resolve(description);
  const before = planner.stats();
  equal(planner.resolve(description), first, 'same description reuses plan');
  equal(planner.resolve({ ...description, frameVersion: 500 }), first, 'state advance reuses metadata plan');
  const after = planner.stats();
  equal(after.nodesComputed, before.nodesComputed, 'no metadata node reruns');
  equal(after.sourceUpdates, before.sourceUpdates, 'frame version is not a metadata input');
  equal(after.cacheHits - before.cacheHits, 2, 'both target evaluations hit cache');
});

test('layout edits rebuild parameters while retaining checked topology', () => {
  const planner = new WaterSurfacePlanner();
  const description = surface();
  const first = planner.resolve(description);
  const before = planner.stats();
  const next = planner.resolve({ ...description, width: 12.5, baseY: 4.25 });
  assert(next !== first && next.params !== first.params, 'changed layout must publish new parameters');
  equal(new DataView(next.params.buffer).getFloat32(16, true), 12.5, 'new width');
  equal(new DataView(next.params.buffer).getFloat32(24, true), 4.25, 'new elevation');
  equal(next.maxIndex, first.maxIndex, 'unchanged topology result');
  equal(planner.stats().sourceUpdates - before.sourceUpdates, 1, 'only layout changes');
  equal(planner.stats().nodesComputed - before.nodesComputed, 2, 'parameters and plan recompute without topology scan');
});

test('topology version changes rescan in-place edits without repacking parameters', () => {
  const planner = new WaterSurfacePlanner();
  const description = surface({ indices: new Uint16Array([0, 1, 2]), indexCount: 3 });
  const first = planner.resolve(description);
  const before = planner.stats();
  description.indices[2] = 7;
  const next = planner.resolve({ ...description, topologyVersion: 1 });
  equal(next.params, first.params, 'layout parameters retained');
  equal(next.maxIndex, 7, 'new in-place topology observed');
  equal(planner.stats().sourceUpdates - before.sourceUpdates, 1, 'only topology changes');
  equal(planner.stats().nodesComputed - before.nodesComputed, 2, 'topology and plan recompute');
});

test('new index views and active index counts invalidate topology', () => {
  const planner = new WaterSurfacePlanner();
  const backing = new Uint16Array([0, 1, 2, 5, 7, 8]);
  const description = surface({ indices: backing.subarray(0, 3), indexCount: 3 });
  const first = planner.resolve(description);
  const replacement = planner.resolve({ ...description, indices: backing.subarray(3, 6) });
  equal(replacement.params, first.params, 'new index view does not change layout');
  equal(replacement.maxIndex, 8, 'new byte-offset view is read');
  const full = { ...description, indices: backing, indexCount: 6 };
  equal(planner.resolve(full).maxIndex, 8, 'full active range');
  const shortened = planner.resolve({ ...full, indexCount: 3 });
  equal(shortened.indexCount, 3, 'shortened active count');
  equal(shortened.maxIndex, 2, 'removed triangles no longer affect bounds');
});

test('a generation reset rechecks reused storage and restarted scene versions', () => {
  const planner = new WaterSurfacePlanner();
  const description = surface({ indices: new Uint16Array([0, 1, 2]), indexCount: 3 });
  const first = planner.resolve(description);
  const before = planner.stats();
  description.indices[2] = 8;
  planner.invalidate();
  equal(planner.generation, 1, 'new scene generation');
  const next = planner.resolve(description);
  assert(next !== first && next.params !== first.params, 'old generation publications discarded');
  equal(next.maxIndex, 8, 'reused memory rescanned even with restarted version zero');
  const after = planner.stats();
  equal(after.generationChanges - before.generationChanges, 1, 'one generation transition');
  equal(after.sourceUpdates - before.sourceUpdates, 2, 'both descriptors republished');
  equal(after.nodesComputed - before.nodesComputed, 3, 'entire plan rebuilt');
  equal(planner.resolve(description), next, 'new generation can cache again');
});

test('shrinking the grid revalidates retained triangle indices', () => {
  const planner = new WaterSurfacePlanner();
  const description = surface();
  planner.resolve(description);
  const smaller = { ...description, cols: 2, rows: 2, vertexCount: 4 };
  throws(() => planner.resolve(smaller), 'index exceeds the vertex count');
  const recovered = planner.resolve({ ...smaller, indices: new Uint16Array([0, 1, 3]), indexCount: 3 });
  equal(recovered.maxIndex, 3, 'valid smaller topology recovers');
  equal(new DataView(recovered.params.buffer).getUint32(8, true), 4, 'smaller vertex count packed');
});

test('invalid topology cannot poison a cached valid plan or a subsequent retry', () => {
  const planner = new WaterSurfacePlanner();
  const description = surface({ indices: new Uint16Array([0, 1, 2]), indexCount: 3 });
  const original = planner.resolve(description);
  description.indices[2] = 9;
  const invalid = { ...description, topologyVersion: 1 };
  throws(() => planner.resolve(invalid), 'index exceeds the vertex count');
  throws(() => planner.resolve(invalid), 'index exceeds the vertex count');
  equal(planner.stats().failures, 2, 'failed results are retried, not cached');
  // A failed node remains dirty. Repairing its existing input is observed on retry.
  description.indices[2] = 4;
  const recovered = planner.resolve(invalid);
  equal(recovered.maxIndex, 4, 'retry sees repaired topology');
  equal(recovered.params, original.params, 'independent valid layout remains cached');
  equal(planner.resolve(invalid), recovered, 'successful retry publishes a reusable plan');
});

test('rejects malformed triangle counts, element types and out-of-range indices', () => {
  const invalid: Partial<WaterSurfaceDescription>[] = [
    { indexCount: 0 }, { indexCount: -3 }, { indexCount: 1.5 }, { indexCount: 4 },
    { indexCount: Number.NaN }, { indexCount: Number.POSITIVE_INFINITY }, { indexCount: 9 },
    { indices: new Uint16Array(98307), indexCount: 98307 },
    { indices: new Uint32Array([0, 1, 2]) as unknown as Uint16Array, indexCount: 3 },
  ];
  for (const overrides of invalid) {
    throws(() => new WaterSurfacePlanner().resolve(surface(overrides)), 'invalid triangle indices');
  }
  throws(() => new WaterSurfacePlanner().resolve(surface({ indices: new Uint16Array([0, 1, 9]), indexCount: 3 })),
    'index exceeds the vertex count');
});

test('rejects invalid grid sizes and extents before publishing parameters', () => {
  for (const overrides of [
    { cols: 1 }, { rows: 1 }, { cols: 3.5 }, { rows: Number.NaN }, { vertexCount: 8 },
    { cols: 129, rows: 128, vertexCount: 16512 },
  ]) {
    throws(() => new WaterSurfacePlanner().resolve(surface(overrides)), 'invalid grid shape');
  }
  for (const overrides of [
    { width: 0 }, { depth: -1 }, { width: Number.NaN }, { depth: Number.POSITIVE_INFINITY },
    { baseY: Number.NEGATIVE_INFINITY }, { width: Number.MAX_VALUE }, { baseY: Number.MAX_VALUE },
    { width: Number.MIN_VALUE }, { depth: Number.MIN_VALUE },
  ]) {
    throws(() => new WaterSurfacePlanner().resolve(surface(overrides)), 'finite f32 extents');
  }
});

console.log(`water surface plan: ${passed} tests passed`);
