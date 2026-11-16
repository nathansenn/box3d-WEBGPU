// Validates the Lab renderer's simulation layers (src/webgpu/simulation-layers.ts) on Dawn's null backend: the three
// shaders compile against the renderer's own scene-uniform struct without errors or warnings, and the pipelines for both
// sample counts and the bind groups are created without a validation error. Part of `npm run test:gpu`. A plain script,
// like scripts/webgpu-pipeline-test.mjs: Dawn's render pipelines do not survive node:test's process shutdown.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {create, globals} from 'webgpu';
Object.assign(globalThis, globals);
const {createGrainLayer, createHeightFieldLayers, createPlaneLayer, GRAIN_LAYER_WGSL, HEIGHT_FIELD_LAYER_WGSL, PLANE_LAYER_WGSL} = await import('../src/webgpu/simulation-layers.ts');
const rendererSource = fs.readFileSync(new URL('../src/webgpu/renderer.ts', import.meta.url), 'utf8');
const sceneUniformStruct = /const sceneUniformStruct = \/\* wgsl \*\/ `([\s\S]*?)`;/.exec(rendererSource)?.[1];
assert.ok(sceneUniformStruct, 'renderer.ts must contain sceneUniformStruct');
let gpu = create(['backend=null']);
const device = await (await gpu.requestAdapter()).requestDevice();
const uncaptured = [];
device.addEventListener('uncapturederror', event => uncaptured.push(event.error.message));
// The renderer's scene layout has more entries (shadow map, atlases); the layers use the uniform only.
const sceneBindGroupLayout = device.createBindGroupLayout({entries: [{binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: {type: 'uniform'}}]});
const target = {device, sceneBindGroupLayout, colorFormat: 'rgba16float', depthFormat: 'depth24plus', sceneUniformStruct};
for (const [name, code] of [['grains', GRAIN_LAYER_WGSL(target)], ['height field', HEIGHT_FIELD_LAYER_WGSL(target)], ['plane', PLANE_LAYER_WGSL(target)]]) {
  const info = await device.createShaderModule({code}).getCompilationInfo();
  assert.deepEqual(info.messages.map(m => `${name} ${m.type} ${m.lineNum}: ${m.message}`), [], `${name} layer shader`);
}
const storage = bytes => device.createBuffer({size: bytes, usage: GPUBufferUsage.STORAGE});
device.pushErrorScope('validation');
const grains = createGrainLayer(target, storage(16 * 1000), 1000, {radiusScale: 1.5});
const field = createHeightFieldLayers(target, storage(16 * 256 * 128), storage(16 * 256 * 128), {cells: [256, 128], origin: [0, 0], spacing: [2, 2]});
const plane = createPlaneLayer(target, {rect: [-1, -1, 4, 2], gridSize: 0.5});
const error = await device.popErrorScope();
assert.equal(error, null, `layer pipelines and bind groups: ${error?.message ?? ''}`);
assert.equal(field.vertices, 6 * 255 * 127);
await device.queue.onSubmittedWorkDone();
assert.deepEqual(uncaptured, []);
grains.destroy(); field.terrain.destroy(); plane.destroy();
console.log('Dawn null-backend validation passed: grain, height-field (terrain and water) and plane layers, 1x and 4x pipelines.');
device.destroy();
gpu = null;
