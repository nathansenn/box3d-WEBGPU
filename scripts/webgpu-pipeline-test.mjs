import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { create, globals } from 'webgpu';

Object.assign(globalThis, globals);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererSource = fs.readFileSync(path.join(root, 'src/webgpu/renderer.ts'), 'utf8');
const visibilitySource = fs.readFileSync(path.join(root, 'src/webgpu/instance-visibility.ts'), 'utf8');
const shaderPattern = /const\s+(\w+)\s*=\s*\/\*\s*wgsl\s*\*\/\s*`([\s\S]*?)`;/g;
const shaderSources = new Map([...`${rendererSource}\n${visibilitySource}`.matchAll(shaderPattern)].map((match) => [match[1], match[2]]));
const uniformStruct = shaderSources.get('sceneUniformStruct');
const packedSurfaceDecode = shaderSources.get('packedSurfaceDecode');
assert.ok(uniformStruct, 'renderer must contain sceneUniformStruct WGSL');
assert.ok(packedSurfaceDecode, 'renderer must contain packedSurfaceDecode WGSL');

function shader(name) {
  let source = shaderSources.get(name);
  assert.ok(source, `renderer must contain ${name} WGSL`);
  for (let pass = 0; pass < 8 && source.includes('${'); pass++) {
    source = source.replace(/\$\{(\w+)\}/g, (match, dependency) => shaderSources.get(dependency) ?? match);
  }
  assert.equal(source.includes('${'), false, `${name} must resolve all embedded WGSL snippets`);
  return source;
}

let gpu = create(['backend=null']);
const adapter = await gpu.requestAdapter();
assert.ok(adapter, 'Dawn null backend must return an adapter');
const device = await adapter.requestDevice();
const uncapturedErrors = [];
device.addEventListener?.('uncapturederror', (event) => {
  uncapturedErrors.push(event.error?.message ?? String(event.error));
});

async function checked(label, operation) {
  device.pushErrorScope('validation');
  let value;
  let thrown;
  try {
    value = await operation();
  } catch (error) {
    thrown = error;
  }
  const scopedError = await device.popErrorScope();
  assert.equal(thrown, undefined, `${label} threw: ${thrown?.message ?? thrown ?? ''}`);
  assert.equal(scopedError, null, `${label} validation error: ${scopedError?.message ?? ''}`);
  return value;
}

const shaderNames = [
  'shadowShader',
  'surfaceShadowShader',
  'gpuClothShadowShader',
  'skyShader',
  'solidShader',
  'clothShader',
  'gpuClothShader',
  'gpuWaterShader',
  'lineShader',
  'postShader',
  'ropeComputeShader',
  'INSTANCE_CLASSIFY_WGSL',
  'INSTANCE_PREFIX_WGSL',
  'INSTANCE_SCATTER_WGSL',
];
const modules = {};
for (const name of shaderNames) {
  const module = device.createShaderModule({ label: name, code: shader(name) });
  const info = await module.getCompilationInfo();
  const errors = info.messages.filter((message) => message.type === 'error');
  const warnings = info.messages.filter((message) => message.type === 'warning');
  assert.deepEqual(
    errors.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`),
    [],
    `${name} must compile without WGSL errors`,
  );
  assert.deepEqual(
    warnings.map((message) => `${message.lineNum}:${message.linePos} ${message.message}`),
    [],
    `${name} must compile without WGSL warnings`,
  );
  modules[name] = module;
}

const shadowBindGroupLayout = device.createBindGroupLayout({
  label: 'AAA shadow uniform layout test',
  entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
});
const shadowLayout = device.createPipelineLayout({ bindGroupLayouts: [shadowBindGroupLayout] });
const sceneBindGroupLayout = device.createBindGroupLayout({
  label: 'AAA scene layout test',
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth', viewDimension: '2d' } },
    { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    { binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
    { binding: 4, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: 5, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
    { binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
    { binding: 7, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
  ],
});
const sceneLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneBindGroupLayout] });
const gpuClothBindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
  ],
});
const gpuClothSceneLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneBindGroupLayout, gpuClothBindGroupLayout] });
const gpuClothShadowLayout = device.createPipelineLayout({ bindGroupLayouts: [shadowBindGroupLayout, gpuClothBindGroupLayout] });
const gpuWaterBindGroupLayout = device.createBindGroupLayout({
  entries: [
    { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } },
  ],
});
const gpuWaterSceneLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneBindGroupLayout, gpuWaterBindGroupLayout] });
const ropeComputeBindGroupLayout = device.createBindGroupLayout({
  label: 'AAA GPU rope compute layout test',
  entries: [
    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' } },
    { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
    { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' } },
  ],
});
const ropeComputeLayout = device.createPipelineLayout({ bindGroupLayouts: [ropeComputeBindGroupLayout] });
const postBindGroupLayout = device.createBindGroupLayout({
  label: 'AAA post layout test',
  entries: [
    { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float', viewDimension: '2d' } },
    { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    { binding: 2, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
  ],
});
const postLayout = device.createPipelineLayout({ bindGroupLayouts: [postBindGroupLayout] });

const instanceVertexBuffers = [
  {
    arrayStride: 6 * 4,
    stepMode: 'vertex',
    attributes: [
      { shaderLocation: 0, offset: 0, format: 'float32x3' },
      { shaderLocation: 1, offset: 3 * 4, format: 'float32x3' },
    ],
  },
  {
    arrayStride: 16 * 4,
    stepMode: 'instance',
    attributes: [
      { shaderLocation: 2, offset: 0, format: 'float32x4' },
      { shaderLocation: 3, offset: 4 * 4, format: 'float32x4' },
      { shaderLocation: 4, offset: 8 * 4, format: 'float32x4' },
      { shaderLocation: 5, offset: 12 * 4, format: 'float32x4' },
    ],
  },
  {
    arrayStride: 4 * 4,
    stepMode: 'instance',
    attributes: [{ shaderLocation: 6, offset: 0, format: 'float32x4' }],
  },
];
const surfaceVertexBuffers = [{
  arrayStride: 24,
  stepMode: 'vertex',
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'snorm16x2' },
    { shaderLocation: 2, offset: 16, format: 'unorm8x4' },
    { shaderLocation: 3, offset: 20, format: 'unorm16x2' },
  ],
}];

const shadowPipeline = await checked('shadow render pipeline', () => device.createRenderPipelineAsync({
  label: 'AAA shadow map pipeline test',
  layout: shadowLayout,
  vertex: { module: modules.shadowShader, entryPoint: 'vsMain', buffers: instanceVertexBuffers },
  fragment: { module: modules.shadowShader, entryPoint: 'fsMain', targets: [] },
  primitive: { topology: 'triangle-list', cullMode: 'front' },
  depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
}));
const surfaceShadowPipeline = await checked('cloth surface shadow pipeline', () => device.createRenderPipelineAsync({
  label: 'AAA surface shadow pipeline test',
  layout: shadowLayout,
  vertex: { module: modules.surfaceShadowShader, entryPoint: 'vsMain', buffers: surfaceVertexBuffers },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
}));
const gpuClothShadowPipeline = await checked('GPU cloth shadow pipeline', () => device.createRenderPipelineAsync({
  label: 'AAA GPU cloth shadow pipeline test',
  layout: gpuClothShadowLayout,
  vertex: { module: modules.gpuClothShadowShader, entryPoint: 'vsMain' },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
}));
const skyPipeline = await checked('sky render pipeline', () => device.createRenderPipelineAsync({
  label: 'AAA atmospheric sky pipeline test',
  layout: sceneLayout,
  vertex: { module: modules.skyShader, entryPoint: 'vsMain' },
  fragment: { module: modules.skyShader, entryPoint: 'fsMain', targets: [{ format: 'rgba16float' }] },
  primitive: { topology: 'triangle-list' },
  depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' },
  multisample: { count: 4 },
}));
const solidPipeline = await checked('PBR solid render pipeline', () => device.createRenderPipelineAsync({
  label: 'AAA solid pipeline test',
  layout: sceneLayout,
  vertex: { module: modules.solidShader, entryPoint: 'vsMain', buffers: instanceVertexBuffers },
  fragment: { module: modules.solidShader, entryPoint: 'fsMain', targets: [{ format: 'rgba16float' }] },
  primitive: { topology: 'triangle-list', cullMode: 'back' },
  depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less' },
  multisample: { count: 4 },
}));
const transparentSolidPipeline = await checked('translucent glass/material-particle render pipeline', () => device.createRenderPipelineAsync({
  label: 'AAA transparent solid pipeline test',
  layout: sceneLayout,
  vertex: { module: modules.solidShader, entryPoint: 'vsTransparent', buffers: instanceVertexBuffers },
  fragment: {
    module: modules.solidShader,
    entryPoint: 'fsTransparent',
    targets: [{
      format: 'rgba16float',
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
    }],
  },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
  multisample: { count: 4 },
}));
const clothPipeline = await checked('dynamic cloth render pipeline', () => device.createRenderPipelineAsync({
  label: 'AAA cloth pipeline test',
  layout: sceneLayout,
  vertex: { module: modules.clothShader, entryPoint: 'vsMain', buffers: surfaceVertexBuffers },
  fragment: { module: modules.clothShader, entryPoint: 'fsMain', targets: [{ format: 'rgba16float' }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
  multisample: { count: 4 },
}));
const gpuClothPipeline = await checked('GPU-resident cloth render pipeline', () => device.createRenderPipelineAsync({
  label: 'AAA GPU cloth pipeline test',
  layout: gpuClothSceneLayout,
  vertex: { module: modules.gpuClothShader, entryPoint: 'vsMain' },
  fragment: { module: modules.gpuClothShader, entryPoint: 'fsMain', targets: [{ format: 'rgba16float' }] },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: 'depth24plus', depthWriteEnabled: true, depthCompare: 'less-equal' },
  multisample: { count: 4 },
}));
const gpuWaterPipeline = await checked('GPU-resident water render pipeline', () => device.createRenderPipelineAsync({
  label: 'AAA GPU water pipeline test',
  layout: gpuWaterSceneLayout,
  vertex: { module: modules.gpuWaterShader, entryPoint: 'vsMain' },
  fragment: {
    module: modules.gpuWaterShader,
    entryPoint: 'fsMain',
    targets: [{
      format: 'rgba16float',
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
    }],
  },
  primitive: { topology: 'triangle-list', cullMode: 'none' },
  depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
  multisample: { count: 4 },
}));
const linePipeline = await checked('line/effect render pipeline', () => device.createRenderPipelineAsync({
  label: 'AAA line pipeline test',
  layout: sceneLayout,
  vertex: {
    module: modules.lineShader,
    entryPoint: 'vsMain',
    buffers: [{
      arrayStride: 7 * 4,
      stepMode: 'vertex',
      attributes: [
        { shaderLocation: 0, offset: 0, format: 'float32x3' },
        { shaderLocation: 1, offset: 3 * 4, format: 'float32x4' },
      ],
    }],
  },
  fragment: {
    module: modules.lineShader,
    entryPoint: 'fsMain',
    targets: [{
      format: 'rgba16float',
      blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      },
    }],
  },
  primitive: { topology: 'line-list' },
  depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less-equal' },
  multisample: { count: 4 },
}));
const postPipeline = await checked('post-process render pipeline', () => device.createRenderPipelineAsync({
  label: 'AAA post pipeline test',
  layout: postLayout,
  vertex: { module: modules.postShader, entryPoint: 'vsMain' },
  fragment: { module: modules.postShader, entryPoint: 'fsMain', targets: [{ format: 'rgba8unorm' }] },
  primitive: { topology: 'triangle-list' },
}));
await checked('BGRA post-process pipeline compatibility', () => device.createRenderPipelineAsync({
  label: 'AAA BGRA post pipeline test',
  layout: postLayout,
  vertex: { module: modules.postShader, entryPoint: 'vsMain' },
  fragment: { module: modules.postShader, entryPoint: 'fsMain', targets: [{ format: 'bgra8unorm' }] },
  primitive: { topology: 'triangle-list' },
}));

const ropeComputePipeline = await checked('GPU rope compute pipeline', () => device.createComputePipelineAsync({
  label: 'AAA GPU rope compute pipeline test',
  layout: ropeComputeLayout,
  compute: { module: modules.ropeComputeShader, entryPoint: 'csMain' },
}));

// The optional visibility path is prepared lazily in production. Validate all
// its entrypoints here even when ordinary renderer tests use direct draws.
for (const [name, entryPoint] of [
  ['INSTANCE_CLASSIFY_WGSL', 'classify'],
  ['INSTANCE_PREFIX_WGSL', 'prefix'],
  ['INSTANCE_SCATTER_WGSL', 'scatter'],
]) {
  await checked(`visibility ${entryPoint} compute pipeline`, () => device.createComputePipelineAsync({
    layout: 'auto', compute: { module: modules[name], entryPoint },
  }));
}
const visibilityVertexLayout = device.createBindGroupLayout({
  entries: [0, 1, 2].map((binding) => ({
    binding, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' },
  })),
});
const visibleSceneLayout = device.createPipelineLayout({ bindGroupLayouts: [sceneBindGroupLayout, visibilityVertexLayout] });
const visibleShadowLayout = device.createPipelineLayout({ bindGroupLayouts: [shadowBindGroupLayout, visibilityVertexLayout] });
await checked('indirect shadow vertex pulling pipeline', () => device.createRenderPipelineAsync({
  layout: visibleShadowLayout,
  vertex: { module: modules.shadowShader, entryPoint: 'vsVisible', buffers: [instanceVertexBuffers[0]] },
  fragment: { module: modules.shadowShader, entryPoint: 'fsMain', targets: [] },
  primitive: { topology: 'triangle-list', cullMode: 'front' },
  depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less' },
}));
for (const sampleCount of [1, 4]) for (const transparent of [false, true]) {
  await checked(`indirect ${transparent ? 'transparent' : 'opaque'} ${sampleCount}x pipeline`, () => device.createRenderPipelineAsync({
    layout: visibleSceneLayout,
    vertex: { module: modules.solidShader, entryPoint: transparent ? 'vsVisibleTransparent' : 'vsVisibleOpaque', buffers: [instanceVertexBuffers[0]] },
    fragment: {
      module: modules.solidShader, entryPoint: transparent ? 'fsTransparent' : 'fsMain',
      targets: [{ format: 'rgba16float', ...(transparent ? { blend: {
        color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha', operation: 'add' },
        alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' },
      } } : {}) }],
    },
    primitive: { topology: 'triangle-list', cullMode: transparent ? 'none' : 'back' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: !transparent, depthCompare: transparent ? 'less-equal' : 'less' },
    multisample: { count: sampleCount },
  }));
}

const uniformBuffer = device.createBuffer({ size: 56 * 4, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const vertexBuffer = device.createBuffer({ size: 36 * 6 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const matrixBuffer = device.createBuffer({ size: 4 * 16 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE });
const colorBuffer = device.createBuffer({ size: 4 * 4 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.STORAGE });
const lineBuffer = device.createBuffer({ size: 2 * 7 * 4, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const surfaceVertexBuffer = device.createBuffer({ size: 4 * 24, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
const surfaceIndexBuffer = device.createBuffer({ size: 6 * 2, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST });
const clothPositionBuffer = device.createBuffer({ size: 4 * 3 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const clothRestPositionBuffer = device.createBuffer({ size: 4 * 3 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const clothParamsBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const waterEtaBuffer = device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const waterUBuffer = device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const waterVBuffer = device.createBuffer({ size: 4 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const waterParamsBuffer = device.createBuffer({ size: 64, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const ropeUniformBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
const ropePositionBuffer = device.createBuffer({ size: 3 * 3 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
const ropeSegmentBuffer = device.createBuffer({ size: 2 * 8 * 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });

device.queue.writeBuffer(matrixBuffer, 0, new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]));
device.queue.writeBuffer(colorBuffer, 0, new Float32Array([0.38, 0.78, 0.90, -4]));
device.queue.writeBuffer(ropeUniformBuffer, 0, new Uint32Array([1, 2, 3, 0]));
device.queue.writeBuffer(ropePositionBuffer, 0, new Float32Array([
  -1.2, 4.0, 0.0,
   0.0, 3.0, 0.2,
   1.2, 2.1, 0.0,
]));
device.queue.writeBuffer(ropeSegmentBuffer, 0, new Float32Array([
  0, 1, 1 / Math.hypot(1.2, -1.0, 0.2), 0.08, 0.24, 0.32, 0.42, 1,
  1, 2, 1 / Math.hypot(1.2, -0.9, -0.2), 0.08, 0.36, 0.24, 0.16, 1,
]));
device.queue.writeBuffer(uniformBuffer, 0, new Float32Array(56));
device.queue.writeBuffer(lineBuffer, 0, new Float32Array(14));
const packedSurface = new Uint8Array(4 * 24);
const packedView = new DataView(packedSurface.buffer);
const packedPositions = [[-1, 2, -1], [1, 2, -1], [-1, 2, 1], [1, 2, 1]];
for (let i = 0; i < packedPositions.length; i++) {
  const offset = i * 24;
  packedView.setFloat32(offset, packedPositions[i][0], true);
  packedView.setFloat32(offset + 4, packedPositions[i][1], true);
  packedView.setFloat32(offset + 8, packedPositions[i][2], true);
  packedView.setInt16(offset + 12, 0, true);
  packedView.setInt16(offset + 14, 0, true);
  packedView.setUint8(offset + 16, 30 + i * 20);
  packedView.setUint8(offset + 17, 120 + i * 15);
  packedView.setUint8(offset + 18, 220);
  packedView.setUint8(offset + 19, 64 + i * 40);
  packedView.setUint16(offset + 20, (i & 1) ? 65535 : 0, true);
  packedView.setUint16(offset + 22, (i > 1) ? 65535 : 0, true);
}
device.queue.writeBuffer(surfaceVertexBuffer, 0, packedSurface);
device.queue.writeBuffer(surfaceIndexBuffer, 0, new Uint16Array([0, 2, 1, 1, 2, 3]));
device.queue.writeBuffer(clothPositionBuffer, 0, new Float32Array(packedPositions.flat()));
device.queue.writeBuffer(clothRestPositionBuffer, 0, new Float32Array(packedPositions.flat()));
const clothParams = new ArrayBuffer(64);
new Uint32Array(clothParams).set([2, 2, 4, 0]);
new Float32Array(clothParams).set([0.08, 0.25, 0.85, 1, 0.75, 0.06, 0.04, 1], 4);
device.queue.writeBuffer(clothParamsBuffer, 0, clothParams);
device.queue.writeBuffer(waterEtaBuffer, 0, new Float32Array([0, 0.1, -0.05, 0.02]));
device.queue.writeBuffer(waterUBuffer, 0, new Float32Array([0.1, 0.2, 0.1, 0]));
device.queue.writeBuffer(waterVBuffer, 0, new Float32Array([0, -0.1, 0.1, 0.2]));
const waterParams = new ArrayBuffer(64);
new Uint32Array(waterParams).set([2, 2, 4, 0]);
new Float32Array(waterParams).set([4, 4, 1.5, 0], 4);
device.queue.writeBuffer(waterParamsBuffer, 0, waterParams);

const shadowTexture = device.createTexture({
  size: [64, 64],
  format: 'depth32float',
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});
const shadowView = shadowTexture.createView();
const shadowSampler = device.createSampler({
  compare: 'less',
  magFilter: 'linear',
  minFilter: 'linear',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge',
});
const linearSampler = device.createSampler({
  magFilter: 'linear',
  minFilter: 'linear',
  addressModeU: 'clamp-to-edge',
  addressModeV: 'clamp-to-edge',
});
const materialTexture = device.createTexture({
  size: [4, 4],
  format: 'r8unorm',
  usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
device.queue.writeTexture(
  { texture: materialTexture },
  new Uint8Array([0, 32, 64, 96, 32, 64, 96, 128, 64, 96, 128, 160, 96, 128, 160, 192]),
  { bytesPerRow: 4, rowsPerImage: 4 },
  [4, 4, 1],
);
const materialSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const atlasAlbedoTexture = device.createTexture({
  size: [4, 4], format: 'rgba8unorm-srgb', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
const atlasSurfaceTexture = device.createTexture({
  size: [4, 4], format: 'rgba8unorm', usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
});
const atlasPixels = new Uint8Array(4 * 4 * 4).fill(160);
for (let i = 3; i < atlasPixels.length; i += 4) atlasPixels[i] = 210;
device.queue.writeTexture({ texture: atlasAlbedoTexture }, atlasPixels, { bytesPerRow: 16, rowsPerImage: 4 }, [4, 4, 1]);
device.queue.writeTexture({ texture: atlasSurfaceTexture }, atlasPixels, { bytesPerRow: 16, rowsPerImage: 4 }, [4, 4, 1]);
const atlasSampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const shadowBindGroup = device.createBindGroup({
  layout: shadowBindGroupLayout,
  entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
});
const sceneBindGroup = device.createBindGroup({
  layout: sceneBindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: shadowView },
    { binding: 2, resource: shadowSampler },
    { binding: 3, resource: materialTexture.createView() },
    { binding: 4, resource: materialSampler },
    { binding: 5, resource: atlasAlbedoTexture.createView() },
    { binding: 6, resource: atlasSurfaceTexture.createView() },
    { binding: 7, resource: atlasSampler },
  ],
});
const gpuClothBindGroup = device.createBindGroup({
  layout: gpuClothBindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: clothPositionBuffer } },
    { binding: 1, resource: { buffer: clothRestPositionBuffer } },
    { binding: 2, resource: { buffer: clothParamsBuffer } },
  ],
});
const gpuWaterBindGroup = device.createBindGroup({
  layout: gpuWaterBindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: waterEtaBuffer } },
    { binding: 1, resource: { buffer: waterUBuffer } },
    { binding: 2, resource: { buffer: waterVBuffer } },
    { binding: 3, resource: { buffer: waterParamsBuffer } },
  ],
});
const ropeComputeBindGroup = device.createBindGroup({
  layout: ropeComputeBindGroupLayout,
  entries: [
    { binding: 0, resource: { buffer: ropeUniformBuffer } },
    { binding: 1, resource: { buffer: ropePositionBuffer } },
    { binding: 2, resource: { buffer: ropeSegmentBuffer } },
    { binding: 3, resource: { buffer: matrixBuffer } },
    { binding: 4, resource: { buffer: colorBuffer } },
  ],
});
const hdrTexture = device.createTexture({
  size: [64, 64],
  format: 'rgba16float',
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});
const msaaTexture = device.createTexture({
  size: [64, 64],
  sampleCount: 4,
  format: 'rgba16float',
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});
const depthTexture = device.createTexture({
  size: [64, 64],
  sampleCount: 4,
  format: 'depth24plus',
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});
const outputTexture = device.createTexture({
  size: [64, 64],
  format: 'rgba8unorm',
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
});
const postBindGroup = device.createBindGroup({
  layout: postBindGroupLayout,
  entries: [
    { binding: 0, resource: hdrTexture.createView() },
    { binding: 1, resource: linearSampler },
    { binding: 2, resource: { buffer: uniformBuffer } },
  ],
});

await checked('complete offscreen rigid + cloth + rope + water frame', async () => {
  const encoder = device.createCommandEncoder({ label: 'AAA complete hybrid frame test' });
  const ropePass = encoder.beginComputePass({ label: 'AAA GPU rope compute pass test' });
  ropePass.setPipeline(ropeComputePipeline);
  ropePass.setBindGroup(0, ropeComputeBindGroup);
  ropePass.dispatchWorkgroups(1);
  ropePass.end();
  const shadowPass = encoder.beginRenderPass({
    colorAttachments: [],
    depthStencilAttachment: {
      view: shadowView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  shadowPass.setBindGroup(0, shadowBindGroup);
  shadowPass.setPipeline(shadowPipeline);
  shadowPass.setVertexBuffer(0, vertexBuffer);
  shadowPass.setVertexBuffer(1, matrixBuffer);
  shadowPass.setVertexBuffer(2, colorBuffer);
  shadowPass.draw(36, 3);
  shadowPass.setPipeline(surfaceShadowPipeline);
  shadowPass.setVertexBuffer(0, surfaceVertexBuffer);
  shadowPass.setIndexBuffer(surfaceIndexBuffer, 'uint16');
  shadowPass.drawIndexed(6, 1);
  shadowPass.setPipeline(gpuClothShadowPipeline);
  shadowPass.setBindGroup(1, gpuClothBindGroup);
  shadowPass.drawIndexed(6, 1);
  shadowPass.end();

  const mainPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: msaaTexture.createView(),
      resolveTarget: hdrTexture.createView(),
      clearValue: { r: 0.003, g: 0.006, b: 0.015, a: 1 },
      loadOp: 'clear',
      storeOp: 'discard',
    }],
    depthStencilAttachment: {
      view: depthTexture.createView(),
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'store',
    },
  });
  mainPass.setBindGroup(0, sceneBindGroup);
  mainPass.setPipeline(skyPipeline);
  mainPass.draw(3, 1);
  mainPass.setPipeline(solidPipeline);
  mainPass.setVertexBuffer(0, vertexBuffer);
  mainPass.setVertexBuffer(1, matrixBuffer);
  mainPass.setVertexBuffer(2, colorBuffer);
  mainPass.draw(36, 3);
  mainPass.setVertexBuffer(0, surfaceVertexBuffer);
  mainPass.setIndexBuffer(surfaceIndexBuffer, 'uint16');
  mainPass.setPipeline(clothPipeline);
  mainPass.drawIndexed(6, 1);
  mainPass.setPipeline(gpuClothPipeline);
  mainPass.setBindGroup(1, gpuClothBindGroup);
  mainPass.drawIndexed(6, 1);
  mainPass.setPipeline(gpuWaterPipeline);
  mainPass.setBindGroup(1, gpuWaterBindGroup);
  mainPass.drawIndexed(6, 1);
  mainPass.setPipeline(transparentSolidPipeline);
  mainPass.setBindGroup(0, sceneBindGroup);
  mainPass.setVertexBuffer(0, vertexBuffer);
  mainPass.setVertexBuffer(1, matrixBuffer);
  mainPass.setVertexBuffer(2, colorBuffer);
  mainPass.draw(36, 3);
  mainPass.setPipeline(linePipeline);
  mainPass.setVertexBuffer(0, lineBuffer);
  mainPass.draw(2, 1);
  mainPass.end();

  const postPass = encoder.beginRenderPass({
    colorAttachments: [{
      view: outputTexture.createView(),
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
  });
  postPass.setPipeline(postPipeline);
  postPass.setBindGroup(0, postBindGroup);
  postPass.draw(3, 1);
  postPass.end();

  device.queue.submit([encoder.finish()]);
  await device.queue.onSubmittedWorkDone();
});

assert.deepEqual(uncapturedErrors, [], 'Dawn emitted no uncaptured WebGPU errors');
console.log(`✅ Dawn null-backend validation passed: ${shaderNames.length} shaders, stable visibility compute, indirect vertex pulling, blended glass/dust, GPU rope/cloth/water, HDR/MSAA, and offscreen command encoding (no numerical GPU execution)`);

device.destroy();
gpu = null;
