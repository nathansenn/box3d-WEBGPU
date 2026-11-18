// The WebGPU compute framework (src/engine/gpu/), as far as it can be tested without running a shader:
//  - struct layouts: the offsets against hand-computed tables of the WGSL alignment rules, and the sizes against the
//    shader compiler (Dawn's null backend validates bindings: a buffer of exactly `size` bytes binds, one four bytes
//    shorter is refused), for every prefix of each struct, so that a wrong offset cannot hide;
//  - the WGSL preprocessor: includes, definitions, conditionals and its errors;
//  - shader and validation errors arrive as EngineError with the compiler's line; device loss raises GPU_DEVICE_LOST;
//  - dispatches run in the order they were added; readback returns what was written.
// Shader execution is checked in a browser: scripts/gpu-compute-browser-check.mjs (docs/GPU_COMPUTE.md).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDawnGpu, globals} from '../../scripts/dawn-gpu.mjs';
import {installGpuGlobals, mockDevice} from './fixtures/gpu-mock.mjs';
Object.assign(globalThis, globals);
installGpuGlobals();
const {defineStruct} = await import('../../src/engine/gpu/layout.ts');
const {preprocessWgsl, wgslFloat} = await import('../../src/engine/gpu/wgsl.ts');
const {GpuCompute, GpuProgram, PingPong, acquireGpuCompute} = await import('../../src/engine/gpu/compute.ts');
const {SW_PARAMS} = await import('../../src/engine/gpu/shallow-water-wgsl.ts');
const {DEM_PARAMS, DEM_WALL} = await import('../../src/engine/gpu/granular-wgsl.ts');

const dawn = createDawnGpu(['backend=null']);
const adapter = await dawn.requestAdapter();
const nullDevice = await adapter.requestDevice();
const uncaptured = [];
nullDevice.addEventListener('uncapturederror', event => uncaptured.push(event.error.message));
test.after(() => { nullDevice.destroy(); });

const offsets = struct => Object.fromEntries(struct.fields.map(f => [f.name, f.offset]));

test('struct offsets follow the WGSL alignment rules', () => {
  // WGSL spec, "Alignment and Size": f32/u32/i32 align 4 size 4; vec2 align 8 size 8; vec3 align 16 size 12; vec4 align 16 size 16;
  // mat3x3f align 16 size 48; array<T, N> align of T, stride roundUp(align, size); a struct's size is rounded up to its alignment.
  const a = defineStruct('A', {x: 'f32', v: 'vec3f', y: 'f32', w: 'vec2f', n: 'u32', m: 'mat3x3f', t: 'vec4f', k: 'i32'});
  assert.deepEqual(offsets(a), {x: 0, v: 16, y: 28, w: 32, n: 40, m: 48, t: 96, k: 112});
  assert.equal(a.size, 128); assert.equal(a.align, 16);
  const b = defineStruct('B', {a: 'u32', b: {array: 'vec3f', count: 3}, c: {array: 'f32', count: 5}, d: 'vec2u'});
  assert.deepEqual(offsets(b), {a: 0, b: 16, c: 64, d: 88}); assert.equal(b.size, 96);
  const c = defineStruct('C', {a: 'f32', b: 'f32', c: 'u32'});
  assert.equal(c.size, 12); assert.equal(c.stride, 12); assert.equal(c.align, 4);
  assert.match(a.wgsl, /^struct A \{\n  x: f32,\n  v: vec3f,/);
  assert.throws(() => defineStruct('U', {a: {array: 'f32', count: 4}}, {usage: 'uniform'}), /16 bytes apart/);
  assert.throws(() => defineStruct('bad name', {a: 'f32'}), /identifier/);
  assert.throws(() => defineStruct('E', {a: 'vec5f'}), /Unknown WGSL type/);
});

test('write and read agree with the offsets, for scalars, vectors, matrices and arrays', () => {
  const s = defineStruct('S', {n: 'u32', i: 'i32', v: 'vec3f', m: 'mat3x3f', a: {array: 'vec4f', count: 2}, f: 'f32'});
  const buffer = s.create(3);
  const values = {n: 4000000000, i: -7, v: [1, 2, 3], m: [1, 2, 3, 4, 5, 6, 7, 8, 9], a: [1, 2, 3, 4, 5, 6, 7, 8], f: 0.5};
  s.write(buffer, values, 2);
  assert.deepEqual(s.read(buffer, 2), values);
  assert.deepEqual(s.read(buffer, 1).v, [0, 0, 0]);
  const view = new DataView(buffer);
  assert.equal(view.getFloat32(2 * s.stride + s.field('v').offset + 8, true), 3);
  // The second column of the matrix starts 16 bytes after the first (a vec3 column has stride 16).
  assert.equal(view.getFloat32(2 * s.stride + s.field('m').offset + 16, true), 4);
  assert.throws(() => s.write(buffer, {v: [1, 2]}), /holds 3 numbers/);
  assert.throws(() => s.write(buffer, {nope: 1}), /no field/);
  assert.throws(() => s.write(buffer, {f: 1}, 3), /outside the buffer/);
});

// The size the shader compiler gives a struct: the smallest buffer a binding of it accepts.
async function compilerAccepts(struct, bytes, usage) {
  const code = `${struct.wgsl}\n@group(0) @binding(0) var<${usage === 'uniform' ? 'uniform' : 'storage, read'}> s: ${struct.name};\n@group(0) @binding(1) var<storage, read_write> o: array<u32>;\n@compute @workgroup_size(1) fn main() { o[0] = u32(arrayLength(&o)) + bitcast<u32>(s.${struct.fields.at(-1).name}${struct.fields.at(-1).components > 1 ? '[0]' : ''}${/mat|array<vec|array<mat/.test(struct.wgsl.split('\n').at(-2)) ? '[0]' : ''}); }`;
  const module = nullDevice.createShaderModule({code});
  const info = await module.getCompilationInfo();
  assert.deepEqual(info.messages.filter(m => m.type === 'error').map(m => m.message), [], code);
  const pipeline = nullDevice.createComputePipeline({layout: 'auto', compute: {module, entryPoint: 'main'}});
  const buffer = nullDevice.createBuffer({size: bytes, usage: usage === 'uniform' ? GPUBufferUsage.UNIFORM : GPUBufferUsage.STORAGE});
  const out = nullDevice.createBuffer({size: 16, usage: GPUBufferUsage.STORAGE});
  nullDevice.pushErrorScope('validation');
  nullDevice.createBindGroup({layout: pipeline.getBindGroupLayout(0), entries: [{binding: 0, resource: {buffer}}, {binding: 1, resource: {buffer: out}}]});
  const error = await nullDevice.popErrorScope();
  buffer.destroy(); out.destroy();
  return error === null;
}
test('struct sizes agree with the shader compiler, for every prefix of each struct the backends use', async () => {
  const structs = [
    ['A', {x: 'f32', v: 'vec3f', y: 'f32', w: 'vec2f', n: 'u32', m: 'mat3x3f', t: 'vec4f', k: 'i32'}, 'storage'],
    ['B', {a: 'u32', b: {array: 'vec3f', count: 3}, c: {array: 'f32', count: 5}, d: 'vec2u'}, 'storage'],
    ['Params', Object.fromEntries(SW_PARAMS.fields.map(f => [f.name, f.type])), 'uniform'],
    ['DemParams', Object.fromEntries(DEM_PARAMS.fields.map(f => [f.name, f.type])), 'uniform'],
    ['Wall', Object.fromEntries(DEM_WALL.fields.map(f => [f.name, f.type])), 'storage'],
  ];
  let checked = 0;
  for (const [name, fields, usage] of structs) {
    const names = Object.keys(fields);
    for (let count = 1; count <= names.length; count++) {
      const prefix = defineStruct(name, Object.fromEntries(names.slice(0, count).map(n => [n, fields[n]])), {usage});
      assert.equal(await compilerAccepts(prefix, prefix.size, usage), true, `${name} with ${count} fields: ${prefix.size} bytes must bind`);
      assert.equal(await compilerAccepts(prefix, prefix.size - 4, usage), false, `${name} with ${count} fields: ${prefix.size - 4} bytes must be refused`);
      checked++;
    }
  }
  assert.ok(checked > 60);
  assert.equal(SW_PARAMS.size, 208);
  assert.deepEqual(uncaptured, []);
});

test('the WGSL preprocessor: includes, definitions, conditionals', () => {
  const includes = {math: 'fn sq(x: f32) -> f32 { return x * x; }', both: '#include "math"\nfn quad(x: f32) -> f32 { return sq(sq(x)); }'};
  const out = preprocessWgsl(['#include "both"', '#include "math"', '#define LIMIT 8', 'const n = ${COUNT}u; const h = ${H}; const limit = ${LIMIT};', '#if FAST', 'const fast = true;', '#else', 'const fast = false;', '#endif', '#ifndef FAST', 'const slow = 1;', '#endif'].join('\n'),
    {defines: {COUNT: 64, H: 0.5, FAST: false}, includes});
  assert.equal(out, ['fn sq(x: f32) -> f32 { return x * x; }\nfn quad(x: f32) -> f32 { return sq(sq(x)); }', 'const n = 64u; const h = 0.5; const limit = 8;', 'const fast = false;', 'const slow = 1;'].join('\n'));
  assert.equal(out.match(/fn sq/g).length, 1, 'a snippet is included once');
  assert.equal(preprocessWgsl('#if A\n#if B\nx\n#else\ny\n#endif\n#endif', {defines: {A: 1}}), 'y');
  assert.equal(wgslFloat(2), '2.0'); assert.equal(wgslFloat(1e-7), '1e-7'); assert.equal(wgslFloat(0.25), '0.25');
  const code = (source, options) => { try { preprocessWgsl(source, options); } catch (error) { return `${error.code}: ${error.message}`; } return 'no error'; };
  assert.match(code('${MISSING}'), /^GPU_SHADER: shader:1: \$\{MISSING\} is not defined/);
  assert.match(code('a\n#include "nope"'), /^GPU_SHADER: shader:2: there is no snippet "nope"/);
  assert.match(code('#if A\nx'), /#if without #endif/);
  assert.match(code('#endif'), /#endif without #if/);
  assert.match(code('#include "a"', {includes: {a: '#include "b"', b: '#include "a"'}}), /includes itself \(a -> b -> a\)/);
  assert.match(code('#pragma once'), /unknown directive #pragma/);
});

test('no WebGPU, no adapter, or too small an adapter is GPU_UNAVAILABLE with the reason', async () => {
  await assert.rejects(acquireGpuCompute({gpu: undefined}), e => e.code === 'GPU_UNAVAILABLE' && /no WebGPU/.test(e.message));
  await assert.rejects(acquireGpuCompute({gpu: {requestAdapter: async () => null}}), e => e.code === 'GPU_UNAVAILABLE' && /no adapter/.test(e.message));
  await assert.rejects(acquireGpuCompute({gpu: dawn, storageBuffers: 4096}), e => e.code === 'GPU_UNAVAILABLE' && /storage buffers per stage/.test(e.message));
  await assert.rejects(acquireGpuCompute({gpu: dawn, storageBytes: 2 ** 50}), e => e.code === 'GPU_UNAVAILABLE' && /largest storage buffer/.test(e.message));
  const compute = await acquireGpuCompute({gpu: dawn});
  assert.equal(compute.info.software, true, 'the null backend is not a GPU');
  assert.equal(compute.info.limits.storageBuffers >= 8, true);
  compute.device.destroy();
});

test('compile and validation errors become EngineErrors that carry the compiler message and the line', async () => {
  const compute = new GpuCompute(nullDevice, adapter.info);
  await assert.rejects(compute.module('broken', '@compute @workgroup_size(1) fn main() {\n  let x: f32 = 1u;\n}'), (e) => {
    assert.equal(e.name, 'EngineError'); assert.equal(e.code, 'GPU_SHADER');
    assert.match(e.message, /broken does not compile:\n2:\d+ .*\n {4}let x: f32 = 1u;/);
    return true;
  });
  const module = await compute.module('fine', '@group(0) @binding(0) var<storage, read_write> a: array<f32>;\n@compute @workgroup_size(4) fn main(@builtin(global_invocation_id) id: vec3u) { a[id.x] = 1.0; }');
  await assert.rejects(compute.pipeline('missing entry', module, 'nope'), e => e.code === 'GPU_VALIDATION' && /missing entry/.test(e.message));
  const layout = compute.layout('one buffer', ['uniform']);
  await assert.rejects(compute.pipeline('wrong layout', module, 'main', nullDevice.createPipelineLayout({bindGroupLayouts: [layout]})), e => e.code === 'GPU_VALIDATION');
  const pipeline = await compute.pipeline('ok', module, 'main', nullDevice.createPipelineLayout({bindGroupLayouts: [compute.layout('storage', ['write'])]}));
  assert.ok(pipeline);
  await assert.rejects(compute.scoped('bad bind group', () => compute.bind('bad', compute.layout('storage', ['write']), [compute.buffer('uniform only', 16, GPUBufferUsage.UNIFORM)])), e => e.code === 'GPU_VALIDATION' && /bad bind group/.test(e.message));
  assert.deepEqual(uncaptured, [], 'every error was caught by its scope');
});

test('dispatches run in the order they were added; readback returns what was written; buffers ping-pong', async () => {
  const device = mockDevice(), compute = new GpuCompute(device);
  const a = compute.storage('a', 16, new Float32Array([1, 2, 3, 4])), b = compute.storage('b', 16);
  const pair = new PingPong(a, b);
  assert.equal(pair.read, a); assert.equal(pair.write, b); pair.swap(); assert.equal(pair.read, b); assert.equal(pair.parity, 1); pair.swap();
  const module = await compute.module('m', ''), layout = compute.layout('l', ['read', 'write']);
  const names = ['first', 'second', 'third'], pipelines = await Promise.all(names.map(name => compute.pipeline(name, module, name, device.createPipelineLayout({bindGroupLayouts: [layout]}))));
  const forward = compute.bind('a to b', layout, [a, b]), backward = compute.bind('b to a', layout, [b, a]);
  const program = new GpuProgram().add({pipeline: pipelines[0], bindGroups: [forward], workgroups: [2, 3]}).add({pipeline: pipelines[1], bindGroups: [backward], workgroups: [0]}).add({pipeline: pipelines[2], bindGroups: [backward], workgroups: [5], offsets: [256]}).add({pipeline: pipelines[0], bindGroups: [forward], workgroups: [1]});
  const encoder = device.createCommandEncoder(); program.encode(encoder); device.queue.submit([encoder.finish()]);
  assert.deepEqual(device.dispatches, [{entryPoint: 'first', group: 'a to b', offsets: [], workgroups: [2, 3, 1]}, {entryPoint: 'third', group: 'b to a', offsets: [256], workgroups: [5, 1, 1]}, {entryPoint: 'first', group: 'a to b', offsets: [], workgroups: [1, 1, 1]}]);
  assert.deepEqual([...await compute.readTyped(a, Float32Array)], [1, 2, 3, 4]);
  compute.write(a, new Float32Array([9]), 4);
  assert.deepEqual([...new Float32Array((await compute.read([{buffer: a, offset: 4, size: 8}]))[0])], [9, 3]);
  assert.throws(() => compute.storage('huge', 2 ** 40), e => e.code === 'GPU_UNAVAILABLE');
});

test('a lost device raises GPU_DEVICE_LOST, calls the listeners once and stays lost', async () => {
  for (const make of [() => mockDevice(), async () => (await dawn.requestAdapter()).requestDevice()]) {
    const device = await make(), compute = new GpuCompute(device);
    const buffer = compute.storage('state', 64);
    let told = 0, reason = '';
    compute.onLost((message) => { told++; reason = message; });
    assert.equal(compute.lost, false);
    const pending = compute.read([{buffer}]).then(() => 'read', e => e.code);
    device.destroy();
    await device.lost;
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(compute.lost, true); assert.equal(told, 1); assert.ok(reason.length > 0);
    assert.ok(['read', 'GPU_DEVICE_LOST'].includes(await pending), 'a readback under way either finished or reports the loss');
    assert.throws(() => compute.assertAlive(), e => e.code === 'GPU_DEVICE_LOST');
    await assert.rejects(compute.read([{buffer}]), e => e.code === 'GPU_DEVICE_LOST');
    assert.throws(() => compute.storage('more', 16), e => e.code === 'GPU_DEVICE_LOST');
    let late = 0; compute.onLost(() => late++); assert.equal(late, 1, 'a listener added after the loss is told at once');
  }
});
