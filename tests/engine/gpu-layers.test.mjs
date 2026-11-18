// The layers the Lab's WebGPU renderer draws from simulation buffers (src/webgpu/simulation-layers.ts), and the Lab's
// examples at scale (src/lab/gpu-showcase.ts), as far as the gate can test them: the draw counts follow the grid and its
// stride, each sample count has its pipeline, the renderer calls the layers inside its main pass, and the address of a
// showcase is recognised. The shaders, pipelines and bind groups are validated on Dawn by
// scripts/gpu-layers-pipeline-test.mjs (a plain script: Dawn's render pipelines do not survive node:test's shutdown),
// which `npm run test:gpu` runs after this file. What the layers draw is looked at in a browser.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {installGpuGlobals, mockDevice} from './fixtures/gpu-mock.mjs';
installGpuGlobals();
const {createGrainLayer, createHeightFieldLayers, createPlaneLayer, createFluidSliceLayer, heightFieldStride} = await import('../../src/webgpu/simulation-layers.ts');
const {gpuShowcaseRequest, GPU_SHOWCASES} = await import('../../src/lab/gpu-showcase.ts');
const {LAB_EXAMPLE_NAMES} = await import('../../src/lab/scene-loading.ts');

const rendererSource = fs.readFileSync(new URL('../../src/webgpu/renderer.ts', import.meta.url), 'utf8');
const device = mockDevice();
const target = {device, sceneBindGroupLayout: {}, colorFormat: 'rgba16float', depthFormat: 'depth24plus', sceneUniformStruct: ''};
const recorder = () => { const calls = []; return {calls, setPipeline(p) { calls.push(`pipeline ${p.samples}x`); }, setBindGroup(index) { calls.push(`group ${index}`); }, draw(vertices, instances) { calls.push(`draw ${vertices} x ${instances}`); }}; };
const storage = bytes => device.createBuffer({size: bytes, usage: GPUBufferUsage.STORAGE});

test('grains: one quad per grain from the position buffer, for both sample counts', async () => {
  const layer = createGrainLayer(target, storage(16 * 1000), 1000, {color: [1, 0.5, 0.2], radiusScale: 1.5});
  assert.equal(layer.blended, false);
  for (const samples of [1, 4]) { const pass = recorder(); layer.draw(pass, samples); assert.deepEqual(pass.calls, [`pipeline ${samples}x`, 'group 1', 'draw 4 x 1000']); }
  layer.setCount(640); const pass = recorder(); layer.draw(pass, 1); assert.equal(pass.calls.at(-1), 'draw 4 x 640');
  layer.setCount(0); const none = recorder(); layer.draw(none, 1); assert.deepEqual(none.calls, []);
  layer.setModel(new Float32Array(16)); layer.destroy();
});
test('height field: terrain and water from the state and bed buffers, drawn every stride cells when the grid is fine', async () => {
  assert.equal(heightFieldStride([128, 128]), 1); assert.equal(heightFieldStride([513, 300]), 1); assert.equal(heightFieldStride([1024, 1024]), 2); assert.equal(heightFieldStride([4096, 2048]), 8);
  const small = createHeightFieldLayers(target, storage(16 * 64 * 48), storage(16 * 64 * 48), {cells: [64, 48], origin: [0, 0], spacing: [1, 1]});
  const large = createHeightFieldLayers(target, storage(16 * 1024 * 1024), storage(16 * 1024 * 1024), {cells: [1024, 1024], origin: [0, 0], spacing: [1, 1]});
  assert.equal(small.stride, 1); assert.equal(small.vertices, 6 * 63 * 47);
  assert.equal(large.stride, 2); assert.equal(large.vertices, 6 * 511 * 511);
  assert.equal(small.terrain.blended, false); assert.equal(small.water.blended, true, 'the water surface is drawn after everything opaque');
  const pass = recorder(); small.terrain.draw(pass, 4); small.water.draw(pass, 4);
  assert.deepEqual(pass.calls, ['pipeline 4x', 'group 1', `draw ${6 * 63 * 47} x 1`, 'pipeline 4x', 'group 1', `draw ${6 * 63 * 47} x 1`]);
  small.setModel(new Float32Array(16)); small.terrain.destroy(); large.terrain.destroy();
});
test('plane: a rectangle of four vertices', async () => {
  const layer = createPlaneLayer(target, {rect: [-1, -1, 4, 2], gridSize: 0.5});
  const pass = recorder(); layer.draw(pass, 1); assert.deepEqual(pass.calls, ['pipeline 1x', 'group 1', 'draw 4 x 1']);
  layer.destroy();
});
test('fluid slices: one quad per cell of the plane, for each normal axis', () => {
  for (const [axis, quads] of [[0, 10 * 8], [1, 12 * 8], [2, 12 * 10]]) {
    const layer = createFluidSliceLayer(target, storage(4 * 20000), {cells: [12, 10, 8], padded: [14, 12], paddedSize: 1680, velocityOffset: 0, spacing: 0.1, axis, index: 2, speedScale: 1});
    const pass = recorder(); layer.draw(pass, 4); assert.deepEqual(pass.calls, ['pipeline 4x', 'group 1', `draw ${6 * quads} x 1`]); layer.destroy();
  }
});
test('the renderer draws its simulation layers in the main pass, opaque before blended', () => {
  assert.match(rendererSource, /for \(const blended of \[false, true\]\) for \(const layer of this\.simulationLayers\) if \(layer\.blended === blended\) \{\s*mainPass\.setBindGroup\(0, this\.sceneBindGroup\);\s*layer\.draw\(mainPass, this\.sampleCount\);/);
  assert.ok(rendererSource.indexOf('layer.draw(mainPass') < rendererSource.indexOf("label: 'AAA tone mapping and bloom pass'"), 'before the post pass');
});
test('with a GPU example on screen the Lab keeps one frame on the device, and draws none while the fluid steps', () => {
  // On a slow adapter (SwiftShader) frames were queued faster than they ran; every readback of a fluid step (one per 16
  // solver iterations) then waited behind all of them, and a 16^3 cube drew no frame in 34 minutes.
  const main = fs.readFileSync(new URL('../../src/main.ts', import.meta.url), 'utf8'), showcase = fs.readFileSync(new URL('../../src/lab/gpu-showcase.ts', import.meta.url), 'utf8');
  assert.match(main, /if\(gpuShowcase&&\(gpuShowcaseFramePending\|\|gpuShowcase\.holdsFrames\?\.\(\)\)\)\{last=now;frameRequest=requestAnimationFrame\(frame\);return;\}/);
  assert.match(main, /renderer\.render\([^;]*\);\s*if \(gpuShowcase && renderer instanceof WebGPURenderer\) \{\s*gpuShowcaseFramePending = true;[\s\S]{0,120}onSubmittedWorkDone\(\)\.then\(done, done\);/);
  assert.ok(main.indexOf('gpuShowcaseFramePending||') < main.indexOf('gpuShowcase.frame(gpuShowcasePaused'), 'the check comes before the example is stepped');
  assert.match(showcase, /holdsFrames: \(\) => pending > 0/);
});
test('a showcase address is recognised, and its fall back is a real example', () => {
  assert.equal(gpuShowcaseRequest('?example=sand-avalanche-100k'), 'sand-avalanche-100k');
  assert.equal(gpuShowcaseRequest('?example=flood-valley-1m&n=128'), 'flood-valley-1m');
  assert.equal(gpuShowcaseRequest('?example=lid-cavity-262k'), 'lid-cavity-262k');
  assert.equal(gpuShowcaseRequest('?example=dam-break'), null); assert.equal(gpuShowcaseRequest(''), null);
  for (const [name, entry] of Object.entries(GPU_SHOWCASES)) {
    assert.ok(LAB_EXAMPLE_NAMES.includes(entry.fallback), `${name} falls back to ${entry.fallback}`);
    assert.ok(!LAB_EXAMPLE_NAMES.includes(name), 'a showcase is not a scene of the format');
  }
});
