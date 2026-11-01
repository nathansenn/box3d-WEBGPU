import {
  ExecutionGraph, assertResourceContract, assertValueContract, validateResourceDescriptor,
  type TextureResourceDescriptor,
} from '../src/runtime/execution-graph.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function equal(actual: unknown, expected: unknown, label: string): void {
  assert(Object.is(actual, expected), label + ': expected ' + String(expected) + ', got ' + String(actual));
}
function throws(operation: () => unknown, text: string): void {
  let caught: unknown;
  try { operation(); } catch (error) { caught = error; }
  assert(caught instanceof Error && caught.message.includes(text),
    'Expected error containing ' + text + ', got ' + String(caught));
}
let passed = 0;
function test(name: string, operation: () => void): void {
  try { operation(); passed++; }
  catch (error) { throw new Error(name + ': ' + (error instanceof Error ? error.message : String(error))); }
}

test('deterministic diamond recomputation and unrelated branch reuse', () => {
  const graph = new ExecutionGraph(0);
  const x = graph.input<number>('x'); const y = graph.input<number>('y');
  const order: string[] = [];
  const shared = graph.node({ id: 'shared', dependencies: [x], compute: ctx => { order.push('shared'); return ctx.read(x) * 2; } });
  const left = graph.node({ id: 'left', dependencies: [shared], compute: ctx => { order.push('left'); return ctx.read(shared) + 1; } });
  const right = graph.node({ id: 'right', dependencies: [shared], compute: ctx => { order.push('right'); return ctx.read(shared) + 2; } });
  const sum = graph.node({ id: 'sum', dependencies: [left, right], compute: ctx => { order.push('sum'); return ctx.read(left) + ctx.read(right); } });
  const unrelated = graph.node({ id: 'unrelated', dependencies: [y], compute: ctx => { order.push('unrelated'); return ctx.read(y) + 10; } });
  graph.setInput(x, 2, { generation: 0, version: 0 }); graph.setInput(y, 3, { generation: 0, version: 0 });
  equal(graph.evaluate(sum), 11, 'diamond result');
  equal(order.join(','), 'shared,left,right,sum', 'single shared evaluation and deterministic order');
  equal(graph.evaluate(unrelated), 13, 'unrelated result'); const revision = graph.revision(unrelated);
  order.length = 0;
  equal(graph.setInput(x, 2, { generation: 0, version: 0 }), false, 'unchanged source');
  equal(graph.evaluate(sum), 11, 'cached target'); equal(order.length, 0, 'no cached callbacks');
  graph.setInput(x, 4, { generation: 0, version: 1 });
  equal(graph.evaluate(sum), 19, 'changed ancestor'); graph.evaluate(unrelated);
  equal(order.join(','), 'shared,left,right,sum', 'unrelated branch reused');
  equal(graph.revision(unrelated), revision, 'unrelated revision retained');
});

test('generation changes reject stale data and invalidate reused memory', () => {
  const graph = new ExecutionGraph('scene-a');
  const data = graph.input<Float32Array>('state', { shape: [2], units: 'm', precision: 'f32' });
  const sum = graph.node({ id: 'sum', dependencies: [data], compute: ctx => ctx.read(data)[0] + ctx.read(data)[1] });
  const reused = new Float32Array([2, 3]);
  graph.setInput(data, reused, { generation: 'scene-a', version: 7 });
  equal(graph.evaluate(sum), 5, 'old scene'); equal(graph.setGeneration('scene-b'), true, 'new generation');
  equal(graph.revision(sum), 0, 'old publication cleared');
  throws(() => graph.evaluate(sum), 'has not been published');
  throws(() => graph.setInput(data, reused, { generation: 'scene-a', version: 8 }), 'stale generation');
  reused[0] = 20; graph.setInput(data, reused, { generation: 'scene-b', version: 0 });
  equal(graph.evaluate(sum), 23, 'reused memory rechecked');
  equal(graph.setGeneration('scene-b'), false, 'same generation no reset');
  throws(() => graph.setGeneration('scene-a'), 'cannot be reused');
  equal(graph.generation, 'scene-b', 'rejected reuse keeps generation');
});

test('stale versions reject atomically and replacement identity invalidates', () => {
  const graph = new ExecutionGraph(); const input = graph.input<Float32Array>('input');
  const output = graph.node({ id: 'output', dependencies: [input], compute: ctx => ctx.read(input)[0] });
  graph.setInput(input, new Float32Array([7]), { generation: 0, version: 2 }); graph.evaluate(output);
  const revision = graph.revision(input);
  throws(() => graph.setInput(input, new Float32Array([9]), { generation: 0, version: 1 }), 'stale version');
  equal(graph.revision(input), revision, 'failed update retained revision');
  equal(graph.evaluate(output), 7, 'failed update retained value');
  graph.setInput(input, new Float32Array([11]), { generation: 0, version: 2 });
  equal(graph.evaluate(output), 11, 'same version new identity invalidates');
});

test('failed recomputation never publishes and retries without cache poisoning', () => {
  const graph = new ExecutionGraph(); const input = graph.input<number>('input');
  let failNext = false;
  const unstable = graph.node({ id: 'unstable', dependencies: [input], compute: ctx => {
    if (failNext) { failNext = false; throw new Error('planned failure'); }
    return ctx.read(input) * 3;
  } });
  const downstream = graph.node({ id: 'downstream', dependencies: [unstable], compute: ctx => ctx.read(unstable) + 1 });
  graph.setInput(input, 2, { generation: 0, version: 0 }); equal(graph.evaluate(downstream), 7, 'initial');
  const revision = graph.revision(unstable); const childRevision = graph.revision(downstream);
  graph.setInput(input, 4, { generation: 0, version: 1 }); failNext = true;
  throws(() => graph.evaluate(downstream), 'planned failure');
  equal(graph.revision(unstable), revision, 'failure did not publish node');
  equal(graph.revision(downstream), childRevision, 'failure did not publish dependent');
  equal(graph.evaluate(downstream), 13, 'retry uses current inputs');
  equal(graph.stats().failures, 1, 'failure counter');
});

test('output validation failure is not cached', () => {
  const graph = new ExecutionGraph(); let valid = false;
  const node = graph.node({ id: 'array', dependencies: [], contract: { shape: [2] },
    compute: () => new Float32Array(valid ? [1, 2] : [1]) });
  throws(() => graph.evaluate(node), 'flat array length');
  equal(graph.revision(node), 0, 'invalid output not published');
  valid = true; equal(graph.evaluate(node).length, 2, 'valid retry');
});

test('declared input metadata and frozen descriptor copies', () => {
  const graph = new ExecutionGraph(); const shape = [2];
  const input = graph.input<Float32Array>('input', { shape, units: 'm', precision: 'f32' });
  shape[0] = 99;
  throws(() => graph.node({ id: 'bad', dependencies: [{ input, expects: { units: 's' } }], compute: () => 0 }), 'units mismatch');
  throws(() => graph.node({ id: 'bad', dependencies: [{ input, expects: { precision: 'f16' } }], compute: () => 0 }), 'precision mismatch');
  const node = graph.node({ id: 'bad', dependencies: [{ input, expects: { shape: [2], units: 'm', precision: 'f32' } }], compute: ctx => ctx.read(input)[0] });
  throws(() => graph.setInput(input, new Float32Array(3), { generation: 0, version: 0 }), 'flat array length');
  graph.setInput(input, new Float32Array([5, 6]), { generation: 0, version: 0 });
  equal(graph.evaluate(node), 5, 'failed registrations did not reserve id');
  throws(() => assertValueContract({ shape: [2, 3] }, { shape: [6] }), 'shape mismatch');
});

test('texture sample and format binding errors reject before execution', () => {
  const graph = new ExecutionGraph();
  const depth = graph.resource('depth', { kind: 'texture', width: 64, height: 32, format: 'depth24plus', sampleCount: 4 });
  throws(() => graph.node({ id: 'sample', dependencies: [], reads: [{ resource: depth, expects: { kind: 'texture', sampleCount: 1 } }], compute: () => 0 }), 'sampleCount mismatch');
  throws(() => assertResourceContract(depth.descriptor, { kind: 'texture', format: 'rgba16float' }), 'format mismatch');
  graph.node({ id: 'sample', dependencies: [], reads: [{ resource: depth, expects: { kind: 'texture', format: 'depth24plus', sampleCount: 4 } }], compute: () => 0 });
  throws(() => validateResourceDescriptor({ kind: 'texture', width: 1, height: 1, format: 'rgba8unorm', sampleCount: 2 } as unknown as TextureResourceDescriptor), 'sampleCount');
});

test('unordered resource writers/readers reject, declared order and read sharing pass', () => {
  const graph = new ExecutionGraph();
  const resource = graph.resource('state', { kind: 'buffer', byteLength: 16, precision: 'f32' });
  const writes = graph.node({ id: 'write', dependencies: [], writes: [resource], compute: () => 4 });
  throws(() => graph.node({ id: 'race', dependencies: [], writes: [resource], compute: () => 1 }), 'unordered resource conflict');
  throws(() => graph.node({ id: 'race', dependencies: [], reads: [resource], compute: () => 1 }), 'unordered resource conflict');
  const readA = graph.node({ id: 'readA', dependencies: [writes], reads: [resource], compute: ctx => ctx.read(writes) + 1 });
  const readB = graph.node({ id: 'readB', dependencies: [writes], reads: [resource], compute: ctx => ctx.read(writes) + 2 });
  throws(() => graph.node({ id: 'race', dependencies: [writes], writes: [resource], compute: () => 1 }), 'unordered resource conflict');
  const ordered = graph.node({ id: 'ordered', dependencies: [readA, readB], writes: [resource], compute: ctx => ctx.read(readA) + ctx.read(readB) });
  equal(graph.evaluate(ordered), 11, 'ordered access works');
});

test('explicit input invalidation reaches descendants and preserves unrelated caches', () => {
  const graph = new ExecutionGraph(); const input = graph.input<Float32Array>('input');
  const data = new Float32Array([1]);
  const a = graph.node({ id: 'a', dependencies: [input], compute: ctx => ctx.read(input)[0] });
  const b = graph.node({ id: 'b', dependencies: [a], compute: ctx => ctx.read(a) + 1 });
  const other = graph.node({ id: 'other', dependencies: [], compute: () => 9 });
  graph.setInput(input, data, { generation: 0, version: 0 }); graph.evaluate(b); graph.evaluate(other);
  const revision = graph.revision(other);
  data[0] = 12; graph.invalidate(input);
  equal(graph.evaluate(b), 13, 'in-place mutation observed'); equal(graph.revision(other), revision, 'unrelated revision retained');
  graph.invalidate(); graph.evaluate(other); assert(graph.revision(other) > revision, 'global invalidation rebuilds computed nodes');
});

test('hidden dependencies, reentrant mutations and foreign handles reject', () => {
  const graph = new ExecutionGraph(); const input = graph.input<number>('input');
  graph.setInput(input, 1, { generation: 0, version: 0 });
  const hidden = graph.node({ id: 'hidden', dependencies: [], compute: ctx => ctx.read(input) });
  throws(() => graph.evaluate(hidden), 'undeclared dependency');
  const mutator = graph.node({ id: 'mutator', dependencies: [input], compute: () => graph.setInput(input, 2, { generation: 0, version: 1 }) });
  throws(() => graph.evaluate(mutator), 'mutations or nested evaluation');
  const foreign = new ExecutionGraph().input<number>('input');
  throws(() => graph.evaluate(foreign), 'foreign or unknown');
  const asyncNode = graph.node({ id: 'async', dependencies: [], compute: () => Promise.resolve(1) });
  throws(() => graph.evaluate(asyncNode), 'must be synchronous');
  equal(graph.revision(asyncNode), 0, 'promise not cached');
});

console.log('execution graph: ' + passed + ' tests passed');
