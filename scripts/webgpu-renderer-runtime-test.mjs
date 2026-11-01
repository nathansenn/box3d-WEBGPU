import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { create, globals } from 'webgpu';
import { emitTypeScriptModuleTree } from './emit-typescript-module-tree.mjs';

Object.assign(globalThis, globals);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererSource = fs.readFileSync(path.join(root, 'src/webgpu/renderer.ts'), 'utf8');
const rendererSha256 = crypto.createHash('sha256').update(rendererSource).digest('hex');
const runtimeDir = path.join(root, '.test-build');
// Node's ESM loader needs the complete runtime tree and explicit extensions;
// emitting only renderer/ktx2 omits the planner and its execution graph.
const { entryPath: runtimeModulePath } = emitTypeScriptModuleTree({
  sourceRoot: path.join(root, 'src'),
  outputRoot: runtimeDir,
  entry: 'webgpu/renderer.ts',
  sourceOverrides: { 'webgpu/renderer.ts': rendererSource },
});

const dawnBackend = process.env.WEBGPU_DAWN_BACKEND ?? 'null';
let gpu = create([`backend=${dawnBackend}`]);
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { gpu },
});
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { devicePixelRatio: 1 },
});
Object.defineProperty(globalThis, 'fetch', {
  configurable: true,
  value: async () => { throw new Error('Runtime test intentionally uses the procedural KTX2 fallback.'); },
});

let configuredDevice;
let configuredFormat;
let currentTexture;
const canvas = {
  clientWidth: 96,
  clientHeight: 64,
  width: 0,
  height: 0,
  getContext(kind) {
    return kind === 'webgpu' ? context : null;
  },
};
const context = {
  configure(options) {
    configuredDevice = options.device;
    configuredFormat = options.format;
  },
  getCurrentTexture() {
    currentTexture?.destroy();
    assert.ok(configuredDevice, 'canvas context must be configured before rendering');
    assert.ok(configuredFormat, 'canvas context must have a preferred format');
    currentTexture = configuredDevice.createTexture({
      label: 'AAA test swapchain texture',
      size: [Math.max(1, canvas.width), Math.max(1, canvas.height)],
      format: configuredFormat,
      usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
    });
    return currentTexture;
  },
};

const { WebGPURenderer } = await import(`${pathToFileURL(runtimeModulePath).href}?v=${Date.now()}`);
const maxRigidBodies = 4096;
const renderer = await WebGPURenderer.create(canvas, maxRigidBodies);
const runtimeErrors = [];
renderer.device.addEventListener?.('uncapturederror', (event) => {
  runtimeErrors.push(event.error?.message ?? String(event.error));
});
const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const quality = {
  id: 'cinematic',
  label: 'Cinematic',
  exposure: 1.1,
  bloomStrength: 0.5,
  fogDensity: 0.006,
  shadowStrength: 1,
  effectBudget: 64,
  resolutionScale: 1,
  sampleCount: 4,
  shadowMapSize: 2048,
  shadowTapCount: 9,
};
renderer.writeSceneUniforms({
  viewProjection: identity,
  lightViewProjection: identity,
  cameraPosition: [0, 4, 8],
  lightDirection: [0.42, -0.84, 0.34],
  fogColor: [0.055, 0.085, 0.14],
  timeSeconds: 1,
  quality,
});
assert.deepEqual(
  renderer.qualityConfiguration(),
  { sampleCount: 4, shadowMapSize: 2048, shadowTapCount: 9 },
  'cinematic quality must select the validated 4x/2048/PCF9 path',
);
const heap = new Float32Array(maxRigidBodies * 20);
heap.set(identity, 0);
heap.set([0.38, 0.78, 0.90, -4], maxRigidBodies * 16);
let rigidFrameVersion = 1;
let rigidColorVersion = 1;
const source = {
  HEAPF32: heap,
  frameVersion: () => rigidFrameVersion,
  colorVersion: () => rigidColorVersion,
  _b3w_matrices_ptr: () => 0,
  _b3w_colors_ptr: () => maxRigidBodies * 16 * Float32Array.BYTES_PER_ELEMENT,
};
assert.equal(renderer.uploadInstances(source, 1), 20 * Float32Array.BYTES_PER_ELEMENT);
assert.equal(renderer.uploadInstances(source, 1), 0, 'an unchanged rigid frame must not perform queue writes');
rigidFrameVersion++;
assert.equal(renderer.uploadInstances(source, 1), 16 * Float32Array.BYTES_PER_ELEMENT, 'a transform-only rigid frame must upload only its matrix');
rigidColorVersion++;
assert.equal(renderer.uploadInstances(source, 1), 4 * Float32Array.BYTES_PER_ELEMENT, 'a color-only rigid frame must upload only its material');
rigidFrameVersion++;
rigidColorVersion++;
assert.equal(renderer.uploadInstances(source, 1), 20 * Float32Array.BYTES_PER_ELEMENT, 'a fully changed rigid frame must upload both streams');

renderer.invalidateDynamicCaches();
const rigidInitialBytes4096 = renderer.uploadInstances(source, maxRigidBodies);
assert.equal(
  rigidInitialBytes4096,
  maxRigidBodies * 20 * Float32Array.BYTES_PER_ELEMENT,
  'the initial 4,096-body upload must include matrices and materials',
);
rigidFrameVersion++;
const rigidTransformBytes4096 = renderer.uploadInstances(source, maxRigidBodies);
assert.equal(
  rigidTransformBytes4096,
  maxRigidBodies * 16 * Float32Array.BYTES_PER_ELEMENT,
  'an active 4,096-body native frame must upload matrices only',
);
rigidColorVersion++;
const rigidColorBytes4096 = renderer.uploadInstances(source, maxRigidBodies);
assert.equal(
  rigidColorBytes4096,
  maxRigidBodies * 4 * Float32Array.BYTES_PER_ELEMENT,
  'a 4,096-body material revision must upload colors only',
);
const rigidSettledBytes4096 = renderer.uploadInstances(source, maxRigidBodies);
assert.equal(rigidSettledBytes4096, 0, 'a settled 4,096-body frame must upload zero bytes');
// Return to the one-body draw used by the complete frame submission below.
assert.equal(renderer.uploadInstances(source, 1), 20 * Float32Array.BYTES_PER_ELEMENT);

const effectMatrices = new Float32Array(identity);
const effectColors = new Float32Array([0.53, 0.49, 0.42, -6]);
assert.equal(renderer.uploadEffects(effectMatrices, effectColors, 1, 1, 1), 20 * Float32Array.BYTES_PER_ELEMENT);
assert.equal(renderer.uploadEffects(effectMatrices, effectColors, 1, 1, 1), 0, 'an unchanged effect frame must not perform queue writes');
assert.equal(renderer.uploadEffects(effectMatrices, effectColors, 1, 1, 2), 20 * Float32Array.BYTES_PER_ELEMENT, 'a changed effect frame must upload');
const firstRenderMs = renderer.render(2, [{
  ax: -1, ay: 0, az: 0,
  bx: 1, by: 0, bz: 0,
  r: 1, g: 0.5, b: 0.2, a: 0.8,
}]);
assert.ok(Number.isFinite(firstRenderMs) && firstRenderMs >= 0, 'actual renderer must submit the shadow/HDR/post frame');
await renderer.device.queue.onSubmittedWorkDone();
assert.deepEqual(renderer.viewport(), [96, 64]);
assert.ok(renderer.uploadedMegabytes() > 0, 'actual renderer must account for instance uploads');

const surfaceVertices = new Uint8Array(4 * 24);
const surfaceView = new DataView(surfaceVertices.buffer);
const surfacePositions = [[-1.5, 2.2, -1.5], [1.5, 2.2, -1.5], [-1.5, 2.2, 1.5], [1.5, 2.2, 1.5]];
for (let i = 0; i < surfacePositions.length; i++) {
  const offset = i * 24;
  surfaceView.setFloat32(offset, surfacePositions[i][0], true);
  surfaceView.setFloat32(offset + 4, surfacePositions[i][1], true);
  surfaceView.setFloat32(offset + 8, surfacePositions[i][2], true);
  surfaceView.setInt16(offset + 12, 0, true);
  surfaceView.setInt16(offset + 14, 0, true);
  surfaceView.setUint8(offset + 16, 30 + i * 20);
  surfaceView.setUint8(offset + 17, 110 + i * 20);
  surfaceView.setUint8(offset + 18, 225);
  surfaceView.setUint8(offset + 19, 64 + i * 40);
  surfaceView.setUint16(offset + 20, (i & 1) ? 65535 : 0, true);
  surfaceView.setUint16(offset + 22, (i > 1) ? 65535 : 0, true);
}
const surfaceIndices = new Uint16Array([0, 2, 1, 1, 2, 3]);
const clothBytes = renderer.uploadSurface({
  path: 'packed',
  material: 'cloth',
  vertices: surfaceVertices,
  indices: surfaceIndices,
  vertexStride: 24,
  vertexCount: 4,
  indexCount: 6,
  topologyVersion: 1,
  frameVersion: 1,
});
assert.equal(clothBytes, surfaceVertices.byteLength + surfaceIndices.byteLength);
const clothRenderMs = renderer.render(1, []);
assert.ok(Number.isFinite(clothRenderMs) && clothRenderMs >= 0, 'actual renderer must submit a cloth shadow/surface frame');
await renderer.device.queue.onSubmittedWorkDone();

const sheetBytes = renderer.uploadSurface({
  path: 'packed',
  material: 'sheet',
  vertices: surfaceVertices,
  indices: surfaceIndices,
  vertexStride: 24,
  vertexCount: 4,
  indexCount: 6,
  topologyVersion: 2,
  frameVersion: 2,
});
assert.equal(sheetBytes, surfaceVertices.byteLength + surfaceIndices.byteLength, 'sheet skin must upload packed vertices and topology');
const sheetRenderMs = renderer.render(1, []);
assert.ok(Number.isFinite(sheetRenderMs) && sheetRenderMs >= 0, 'actual renderer must submit an interpolated sheet frame');
await renderer.device.queue.onSubmittedWorkDone();

const gpuClothPositions = new Float32Array(surfacePositions.flat());
const gpuClothRestPositions = new Float32Array(surfacePositions.flat());
const gpuClothFrame = {
  path: 'gpu-cloth',
  material: 'cloth',
  positions: gpuClothPositions,
  restPositions: gpuClothRestPositions,
  indices: surfaceIndices,
  vertexCount: 4,
  indexCount: 6,
  // The sheet frame already published this unchanged index array at version 2.
  topologyVersion: 2,
  frameVersion: 3,
  cols: 2,
  rows: 2,
  baseColorA: [0.08, 0.28, 0.9, 1],
  baseColorB: [0.82, 0.06, 0.035, 1],
};
assert.equal(renderer.uploadSurface(gpuClothFrame), 4 * 24, 'first GPU cloth frame must upload current and immutable rest positions when topology is cached');
const beforePausedCloth = renderer.uploadedMegabytes();
assert.equal(renderer.uploadSurface(gpuClothFrame), 0, 'unchanged GPU cloth must skip every state and topology upload');
assert.equal(renderer.uploadedMegabytes(), beforePausedCloth, 'unchanged GPU cloth must add zero accounted upload bytes');
const gpuClothRenderMs = renderer.render(1, []);
assert.ok(Number.isFinite(gpuClothRenderMs) && gpuClothRenderMs >= 0, 'actual renderer must submit GPU-resident cloth and its shadow');
await renderer.device.queue.onSubmittedWorkDone();
gpuClothPositions[4] += 0.08;
gpuClothFrame.frameVersion++;
assert.equal(renderer.uploadSurface(gpuClothFrame), 4 * 12, 'changed GPU cloth must upload only 12 bytes of current position state per vertex');
assert.equal(renderer.uploadSurface(gpuClothFrame), 0, 'repeated changed GPU cloth frame must remain cached');
const gpuClothUpdateRenderMs = renderer.render(1, []);
assert.ok(Number.isFinite(gpuClothUpdateRenderMs) && gpuClothUpdateRenderMs >= 0, 'actual renderer must submit an updated GPU cloth frame');
await renderer.device.queue.onSubmittedWorkDone();

const ropePositions = new Float32Array([
  -1.2, 4.0, 0.0,
   0.0, 3.0, 0.2,
   1.2, 2.1, 0.0,
]);
const ropeSegments = new Float32Array([
  0, 1, 1 / Math.hypot(1.2, -1.0, 0.2), 0.08, 0.24, 0.32, 0.42, 1,
  1, 2, 1 / Math.hypot(1.2, -0.9, -0.2), 0.08, 0.36, 0.24, 0.16, 1,
]);
const ropeGrid = {
  presentation: 'rope',
  positions: ropePositions,
  segments: ropeSegments,
  nodeCount: 3,
  segmentCount: 2,
  topologyVersion: 1,
  frameVersion: 1,
};
const expectedRopeBytes = ropePositions.byteLength + ropeSegments.byteLength + 16;
assert.equal(renderer.uploadRopeGrid(ropeGrid, 1), expectedRopeBytes, 'first GPU-rope upload must include nodes, topology, and compute uniforms');
const beforePausedRope = renderer.uploadedMegabytes();
assert.equal(renderer.uploadRopeGrid(ropeGrid, 1), 0, 'unchanged GPU-rope state must not upload or redispatch');
assert.equal(renderer.uploadedMegabytes(), beforePausedRope, 'unchanged GPU rope must add zero accounted upload bytes');
const gpuRopeRenderMs = renderer.render(3, []);
assert.ok(Number.isFinite(gpuRopeRenderMs) && gpuRopeRenderMs >= 0, 'actual renderer must submit a GPU-computed rope frame');
await renderer.device.queue.onSubmittedWorkDone();

ropePositions[4] -= 0.12;
ropeGrid.frameVersion++;
assert.equal(renderer.uploadRopeGrid(ropeGrid, 1), ropePositions.byteLength, 'changed GPU-rope state must upload only node positions');
assert.equal(renderer.uploadRopeGrid(ropeGrid, 1), 0, 'repeated changed GPU-rope frame must be cached');
renderer.render(3, []);
await renderer.device.queue.onSubmittedWorkDone();
assert.equal(renderer.uploadRopeGrid(ropeGrid, 2), 16, 'moving the GPU-rope instance range must update only compute uniforms');
renderer.render(4, []);
await renderer.device.queue.onSubmittedWorkDone();
ropeGrid.presentation = 'material';
assert.equal(renderer.uploadRopeGrid(ropeGrid, 2), 16, 'switching to signed material-strain presentation must update only compute uniforms');
const gpuMaterialRenderMs = renderer.render(4, []);
assert.ok(Number.isFinite(gpuMaterialRenderMs) && gpuMaterialRenderMs >= 0, 'actual renderer must submit a GPU-computed material lattice frame');
await renderer.device.queue.onSubmittedWorkDone();
renderer.uploadRopeGrid(null, 0);

const gpuWaterFrame = {
  path: 'gpu-water',
  material: 'water',
  eta: new Float32Array([0, 0.1, -0.05, 0.02]),
  u: new Float32Array([0.1, 0.2, 0.1, 0]),
  v: new Float32Array([0, -0.1, 0.1, 0.2]),
  indices: surfaceIndices,
  vertexCount: 4,
  indexCount: 6,
  topologyVersion: 2,
  frameVersion: 4,
  cols: 2,
  rows: 2,
  width: 4,
  depth: 4,
  baseY: 1.5,
};
assert.equal(renderer.uploadSurface(gpuWaterFrame), 4 * 12, 'GPU water must upload exactly 12 bytes per cell when topology is cached');
const beforePausedWater = renderer.uploadedMegabytes();
assert.equal(renderer.uploadSurface(gpuWaterFrame), 0, 'unchanged GPU water must skip every state and topology upload');
assert.equal(renderer.uploadedMegabytes(), beforePausedWater, 'unchanged GPU water must add zero accounted upload bytes');
const gpuWaterRenderMs = renderer.render(1, []);
assert.ok(Number.isFinite(gpuWaterRenderMs) && gpuWaterRenderMs >= 0, 'actual renderer must submit GPU-resident shallow water');
await renderer.device.queue.onSubmittedWorkDone();

// Persistent WASM memory keeps one ArrayBuffer while different state views can
// move to different offsets. Equal per-scene frame versions must not hide that
// change from the upload cache.
const sharedWaterState = new Float32Array(24);
sharedWaterState.set([
  0, 0.1, -0.05, 0.02,
  0.1, 0.2, 0.1, 0,
  0, -0.1, 0.1, 0.2,
  0.8, 0.7, 0.6, 0.5,
  -0.2, -0.1, 0.1, 0.2,
  0.3, 0.2, 0.1, 0,
]);
const sharedWaterFrameA = {
  ...gpuWaterFrame,
  eta: sharedWaterState.subarray(0, 4),
  u: sharedWaterState.subarray(4, 8),
  v: sharedWaterState.subarray(8, 12),
  frameVersion: 5,
};
const sharedWaterFrameB = {
  ...gpuWaterFrame,
  eta: sharedWaterState.subarray(12, 16),
  u: sharedWaterState.subarray(16, 20),
  v: sharedWaterState.subarray(20, 24),
  frameVersion: 5,
};
assert.equal(renderer.uploadSurface(sharedWaterFrameA), 4 * 12, 'first shared-buffer water view must upload');
assert.equal(renderer.uploadSurface(sharedWaterFrameB), 4 * 12, 'same-buffer water views at new offsets must upload');
assert.equal(renderer.uploadSurface(sharedWaterFrameB), 0, 'an unchanged offset-qualified water view must remain cached');

// A paused same-size scene can reuse the exact WASM offsets and restart its
// local frame version. The app invalidates dynamic caches at scene creation so
// the replacement state and static topology are uploaded immediately.
sharedWaterFrameB.eta[0] += 0.25;
renderer.invalidateDynamicCaches();
assert.equal(
  renderer.uploadSurface(sharedWaterFrameB),
  4 * 12 + surfaceIndices.byteLength,
  'scene invalidation must refresh same-size paused water state and topology',
);
assert.equal(renderer.uploadSurface(sharedWaterFrameB), 0, 'refreshed paused water state must cache normally');

const softMatrices = new Float32Array(identity);
const softColors = new Float32Array([0.2, 0.8, 1, 1]);
assert.equal(renderer.uploadSoftInstances(softMatrices, softColors, 1, 1, 8), 20 * Float32Array.BYTES_PER_ELEMENT);
const beforePausedSoftInstances = renderer.uploadedMegabytes();
assert.equal(renderer.uploadSoftInstances(softMatrices, softColors, 1, 1, 8), 0, 'unchanged soft-instance stream must skip GPU writes');
assert.equal(renderer.uploadedMegabytes(), beforePausedSoftInstances, 'unchanged soft instances must add zero accounted upload bytes');
assert.equal(renderer.uploadSoftInstances(softMatrices, softColors, 1, 1, 9), 20 * Float32Array.BYTES_PER_ELEMENT, 'new soft frame version must upload the stream');
softMatrices[12] = 3;
renderer.invalidateDynamicCaches();
assert.equal(
  renderer.uploadSoftInstances(softMatrices, softColors, 1, 1, 9),
  20 * Float32Array.BYTES_PER_ELEMENT,
  'scene invalidation must refresh same-size paused rope instances',
);
assert.equal(renderer.uploadSoftInstances(softMatrices, softColors, 1, 1, 9), 0, 'refreshed paused rope stream must cache normally');

const balancedQuality = {
  ...quality,
  id: 'balanced',
  label: 'Balanced',
  shadowStrength: 0.68,
  resolutionScale: 0.85,
  sampleCount: 1,
  shadowMapSize: 1024,
  shadowTapCount: 1,
};
renderer.writeSceneUniforms({
  viewProjection: identity,
  lightViewProjection: identity,
  cameraPosition: [0, 4, 8],
  lightDirection: [0.42, -0.84, 0.34],
  fogColor: [0.055, 0.085, 0.14],
  timeSeconds: 1.5,
  quality: balancedQuality,
});
assert.deepEqual(
  renderer.qualityConfiguration(),
  { sampleCount: 1, shadowMapSize: 1024, shadowTapCount: 1 },
  'balanced quality must select the physical-GPU-qualified 1x/1024/PCF1 path',
);
renderer.invalidateDynamicCaches();
assert.ok(renderer.uploadInstances(source, 1) > 0, 'balanced frame must refresh a rigid instance');
assert.ok(renderer.uploadSurface(gpuClothFrame) > 0, 'balanced frame must refresh GPU cloth state');
const balancedClothMs = renderer.render(1, [{
  ax: -0.5, ay: 0, az: 0,
  bx: 0.5, by: 1, bz: 0,
  r: 0.2, g: 0.8, b: 1, a: 1,
}]);
assert.ok(Number.isFinite(balancedClothMs) && balancedClothMs >= 0, 'balanced path must submit rigid, GPU cloth, line, shadow, HDR, and post work');
await renderer.device.queue.onSubmittedWorkDone();
assert.ok(renderer.uploadSurface(gpuWaterFrame) > 0, 'balanced frame must upload GPU water state');
const balancedWaterMs = renderer.render(1, []);
assert.ok(Number.isFinite(balancedWaterMs) && balancedWaterMs >= 0, 'balanced path must submit GPU water with the 1x pipeline set');
await renderer.device.queue.onSubmittedWorkDone();

renderer.writeSceneUniforms({
  viewProjection: identity,
  lightViewProjection: identity,
  cameraPosition: [0, 4, 8],
  lightDirection: [0.42, -0.84, 0.34],
  fogColor: [0.055, 0.085, 0.14],
  timeSeconds: 2,
  quality: {
    ...quality,
    id: 'performance',
    label: 'Performance',
    shadowStrength: 0,
    resolutionScale: 0.7,
    sampleCount: 1,
    shadowMapSize: 1024,
    shadowTapCount: 1,
  },
});
assert.deepEqual(
  renderer.qualityConfiguration(),
  { sampleCount: 1, shadowMapSize: 1024, shadowTapCount: 1 },
  'performance quality must select the physical-GPU-qualified 1x/1024/PCF1 path',
);
renderer.uploadSurface(null);
const secondRenderMs = renderer.render(0, []);
assert.ok(Number.isFinite(secondRenderMs) && secondRenderMs >= 0, 'actual renderer must submit a zero-instance/no-shadow frame');
await renderer.device.queue.onSubmittedWorkDone();
assert.deepEqual(renderer.viewport(), [67, 44]);
assert.deepEqual(runtimeErrors, [], 'actual WebGPURenderer emitted no uncaptured WebGPU errors');

// Candidate resources stay opt-in. A failed pipeline must release the visibility
// buffers allocated alongside it, and a later explicit retry must succeed.
assert.deepEqual(renderer.renderingDiagnostics().optimizations, {
  vertexMaterialRejection: true, shadowPcfFetch: true, shadowCache: true, computeVisibility: false,
}, 'default rendering keeps compute compaction opt-in');
const adaptiveOriginalAlpha = heap[maxRigidBodies * 16 + 3];
heap[maxRigidBodies * 16 + 3] = -2;
rigidColorVersion++; renderer.uploadInstances(source, 1);
renderer.uploadEffects(effectMatrices, effectColors, 0, 0, 99);
renderer.uploadSoftInstances(softMatrices, softColors, 0, 0, 99);
renderer.uploadRopeGrid(null, 0);
renderer.render(1, []);
assert.equal(renderer.renderingDiagnostics().optimizations.vertexMaterialRejection, true,
  'adaptive execution preserves the requested option');
assert.equal(renderer.renderingDiagnostics().effectiveVertexMaterialRejection, false,
  'opaque-only direct frames avoid the per-vertex classifier');
const adaptiveWriteBuffer = renderer.device.queue.writeBuffer;
let unchangedFrameWrites = 0;
Object.defineProperty(renderer.device.queue, 'writeBuffer', { configurable: true, value(...args) {
  unchangedFrameWrites++;
  return adaptiveWriteBuffer.apply(this, args);
} });
try { renderer.render(1, []); }
finally { Object.defineProperty(renderer.device.queue, 'writeBuffer', { configurable: true, value: adaptiveWriteBuffer }); }
assert.equal(unchangedFrameWrites, 0, 'an unchanged effective flag must not add queue uploads');
renderer.uploadEffects(effectMatrices, effectColors, 1, 1, 99);
renderer.render(2, []);
assert.equal(renderer.renderingDiagnostics().effectiveVertexMaterialRejection, true,
  'mixed direct frames enable early material rejection');
renderer.writeSceneUniforms({
  viewProjection: identity, lightViewProjection: identity, cameraPosition: [0, 4, 8],
  lightDirection: [0.42, -0.84, 0.34], fogColor: [0.055, 0.085, 0.14], timeSeconds: 3, quality,
});
assert.equal(renderer.renderingDiagnostics().effectiveVertexMaterialRejection, true,
  'full scene-uniform writes preserve the last effective flag');
heap[maxRigidBodies * 16 + 3] = adaptiveOriginalAlpha;
rigidColorVersion++; renderer.uploadInstances(source, 1);
const visibilityAllocations = [];
const destroyedVisibilityBuffers = new Set();
const originalCreateBuffer = renderer.device.createBuffer;
const pipelineMethod = typeof renderer.device.createRenderPipelineAsync === 'function'
  ? 'createRenderPipelineAsync' : 'createRenderPipeline';
const originalCreatePipeline = renderer.device[pipelineMethod];
let failVisiblePipeline = true;
Object.defineProperty(renderer.device, 'createBuffer', { configurable: true, value(descriptor) {
  const buffer = originalCreateBuffer.call(this, descriptor);
  if (descriptor.label?.startsWith('Instance visibility ')) {
    visibilityAllocations.push(buffer);
    const destroy = buffer.destroy;
    Object.defineProperty(buffer, 'destroy', { configurable: true, value() {
      destroyedVisibilityBuffers.add(buffer);
      return destroy.call(this);
    } });
  }
  return buffer;
} });
Object.defineProperty(renderer.device, pipelineMethod, { configurable: true, value(descriptor) {
  if (failVisiblePipeline && descriptor.label?.startsWith('Visible opaque')) {
    failVisiblePipeline = false;
    const error = new Error('Injected visible pipeline preparation failure');
    if (pipelineMethod === 'createRenderPipelineAsync') return Promise.reject(error);
    throw error;
  }
  return originalCreatePipeline.call(this, descriptor);
} });
try {
  await assert.rejects(renderer.setRenderingOptimizations({ computeVisibility: true }),
    /Injected visible pipeline preparation failure/);
  assert.ok(visibilityAllocations.length > 0, 'failed preparation exercised real visibility allocation');
  assert.ok(visibilityAllocations.every(buffer => destroyedVisibilityBuffers.has(buffer)),
    'failed sibling render pipeline must release every successfully allocated visibility buffer');
  assert.equal(renderer.renderingDiagnostics().optimizations.computeVisibility, false,
    'failed preparation cannot activate an incomplete renderer');
  await renderer.setRenderingOptimizations({ computeVisibility: true });
  assert.equal(renderer.renderingDiagnostics().optimizations.computeVisibility, true,
    'explicit retry after failed preparation must create usable resources');
} finally {
  Object.defineProperty(renderer.device, 'createBuffer', { configurable: true, value: originalCreateBuffer });
  Object.defineProperty(renderer.device, pipelineMethod, { configurable: true, value: originalCreatePipeline });
}

const cacheQuality = { ...quality, sampleCount: 1, shadowMapSize: 1024, shadowStrength: 1 };
const cacheState = {
  viewProjection: identity, lightViewProjection: identity, cameraPosition: [0, 4, 8],
  lightDirection: [0.42, -0.84, 0.34], fogColor: [0.055, 0.085, 0.14], timeSeconds: 4, quality: cacheQuality,
};
renderer.writeSceneUniforms(cacheState);
renderer.uploadInstances(source, 1);
renderer.uploadEffects(effectMatrices, effectColors, 1, 1, 100);
renderer.uploadSurface(gpuClothFrame);
renderer.render(2, []);
assert.equal(renderer.renderingDiagnostics().lastSubmittedInstances.transparent, null,
  'indirect draws must not invent CPU-visible instance counts');
assert.equal(renderer.renderingDiagnostics().effectiveVertexMaterialRejection, false,
  'GPU-classified indirect frames do not repeat vertex material classification');
renderer.writeSceneUniforms({ ...cacheState, quality: { ...cacheQuality, sampleCount: 4 } });
renderer.render(2, []);

await renderer.setRenderingOptimizations({ computeVisibility: false, shadowCache: true });
renderer.writeSceneUniforms(cacheState);
renderer.invalidateDynamicCaches();
renderer.uploadSurface(null);
renderer.uploadRopeGrid(null, 0);
renderer.uploadInstances(source, 1);
renderer.resetRenderingDiagnostics();
let shadowCacheChecks = 0;
function checkShadow(fresh, label, count = 1, callback) {
  const before = renderer.renderingDiagnostics();
  renderer.render(count, [], undefined, callback);
  const after = renderer.renderingDiagnostics();
  assert.equal(after.shadowPasses - before.shadowPasses, fresh ? 1 : 0, `${label}: shadow refresh`);
  assert.equal(after.shadowCacheHits - before.shadowCacheHits, fresh ? 0 : 1, `${label}: cache reuse`);
  shadowCacheChecks++;
}
checkShadow(true, 'initial scene');
checkShadow(false, 'unchanged scene');
renderer.writeSceneUniforms({ ...cacheState, timeSeconds: 8, cameraPosition: [2, 5, 8] });
checkShadow(false, 'camera shading and time only');
const movedCamera = [...identity]; movedCamera[12] = 0.2;
renderer.writeSceneUniforms({ ...cacheState, viewProjection: movedCamera });
checkShadow(false, 'camera frustum only');
rigidFrameVersion++; renderer.uploadInstances(source, 1);
checkShadow(true, 'rigid transforms');
rigidColorVersion++; renderer.uploadInstances(source, 1);
checkShadow(true, 'rigid material');
renderer.uploadEffects(effectMatrices, effectColors, 1, 1, 101);
checkShadow(true, 'effect instance upload', 2);
checkShadow(false, 'unchanged effects', 2);
renderer.uploadSoftInstances(softMatrices, softColors, 1, 1, 101);
checkShadow(true, 'soft instance upload', 2);
renderer.uploadSurface(gpuClothFrame);
checkShadow(true, 'cloth added', 2);
renderer.uploadSurface(gpuClothFrame);
checkShadow(false, 'unchanged cloth', 2);
renderer.uploadSurface({ ...gpuClothFrame, frameVersion: gpuClothFrame.frameVersion + 1 });
checkShadow(true, 'cloth positions', 2);
renderer.uploadSurface({ ...gpuClothFrame, frameVersion: gpuClothFrame.frameVersion + 1, baseColorA: [0.2, 0.3, 0.4, 1] });
checkShadow(true, 'cloth configuration', 2);
renderer.uploadSurface(null);
checkShadow(true, 'cloth removal', 2);
renderer.uploadRopeGrid(ropeGrid, 2);
checkShadow(true, 'GPU rope expansion', 2 + ropeGrid.segmentCount);
checkShadow(false, 'unchanged GPU rope', 2 + ropeGrid.segmentCount);
renderer.uploadRopeGrid({ ...ropeGrid, frameVersion: ropeGrid.frameVersion + 1 }, 2);
checkShadow(true, 'GPU rope state', 2 + ropeGrid.segmentCount);
const movedLight = [...identity]; movedLight[14] = 0.1;
renderer.writeSceneUniforms({ ...cacheState, lightViewProjection: movedLight });
checkShadow(true, 'light projection', 2 + ropeGrid.segmentCount);
renderer.writeSceneUniforms({ ...cacheState, quality: { ...cacheQuality, shadowMapSize: 2048 } });
checkShadow(true, 'shadow texture replacement', 2 + ropeGrid.segmentCount);
checkShadow(true, 'unknown external encoder', 2 + ropeGrid.segmentCount, () => {});
renderer.invalidateDynamicCaches();
checkShadow(true, 'scene generation reset', 2 + ropeGrid.segmentCount);
const beforeEmptyClears = renderer.renderingDiagnostics().shadowEmptyClears;
checkShadow(true, 'populated to empty transition', 0);
assert.equal(renderer.renderingDiagnostics().shadowEmptyClears, beforeEmptyClears + 1,
  'an empty scene must clear previous caster depth');
checkShadow(false, 'unchanged empty scene', 0);

// Half-integer tags use WGSL ties-to-even, not JavaScript's Math.round. The
// conservative CPU gate must keep the transparent pass available for both ties.
const originalAlpha = heap[maxRigidBodies * 16 + 3];
for (const alpha of [-4.5, -6.5]) {
  heap[maxRigidBodies * 16 + 3] = alpha;
  rigidColorVersion++; renderer.uploadInstances(source, 1);
  renderer.render(1, []);
  assert.equal(renderer.renderingDiagnostics().lastSubmittedInstances.transparent, 1,
    `material tag ${alpha} must not be suppressed by the CPU transparency gate`);
}
heap[maxRigidBodies * 16 + 3] = originalAlpha;
rigidColorVersion++; renderer.uploadInstances(source, 1);
renderer.render(1, []);

// A diagnostic rope can animate an opaque base tag through a transparent tag.
// Changing presentation alone must refresh the CPU gate even with cached topology.
renderer.uploadInstances(source, 0);
renderer.uploadEffects(effectMatrices, effectColors, 0, 0, 102);
renderer.uploadSoftInstances(softMatrices, softColors, 0, 0, 102);
const opaqueRopeSegments = ropeSegments.slice();
for (let i = 0; i < ropeGrid.segmentCount; i++) opaqueRopeSegments[i * 8 + 7] = -5;
const opaqueRope = { ...ropeGrid, segments: opaqueRopeSegments,
  topologyVersion: ropeGrid.topologyVersion + 1, presentation: 'material' };
renderer.uploadRopeGrid(opaqueRope, 0);
renderer.render(opaqueRope.segmentCount, []);
assert.equal(renderer.renderingDiagnostics().lastSubmittedInstances.transparent, 0,
  'immutable opaque rope material needs no transparent pass');
renderer.uploadRopeGrid({ ...opaqueRope, presentation: 'rope' }, 0);
renderer.render(opaqueRope.segmentCount, []);
assert.equal(renderer.renderingDiagnostics().lastSubmittedInstances.transparent, opaqueRope.segmentCount,
  'diagnostic rope alpha animation must keep a possible transparent pass available');
renderer.uploadRopeGrid(null, 0);
renderer.uploadInstances(source, 1);
renderer.render(1, []);

// An encoded but unsubmitted shadow pass must never become a reusable cache.
const originalGetTexture = context.getCurrentTexture;
rigidFrameVersion++; renderer.uploadInstances(source, 1);
context.getCurrentTexture = () => { throw new Error('Injected post encoding failure'); };
try { assert.throws(() => renderer.render(1, []), /Injected post encoding failure/); }
finally { context.getCurrentTexture = originalGetTexture; }
checkShadow(true, 'failed main/post encoding cannot publish depth');
const originalSubmit = renderer.device.queue.submit;
Object.defineProperty(renderer.device.queue, 'submit', { configurable: true, value() {
  throw new Error('Injected submission failure');
} });
try { assert.throws(() => renderer.render(1, []), /Injected submission failure/); }
finally { Object.defineProperty(renderer.device.queue, 'submit', { configurable: true, value: originalSubmit }); }
checkShadow(true, 'failed submission invalidates depth');
await renderer.device.queue.onSubmittedWorkDone();
assert.deepEqual(runtimeErrors, [], 'optimization paths emitted no uncaptured WebGPU errors');
assert.equal(shadowCacheChecks, 25, 'all shadow dependency and failed-frame transitions ran');

if (process.env.WEBGPU_RIGID_STREAM_EVIDENCE === '1') {
  const evidence = {
    result: 'passed',
    dawnBackend,
    rendererSha256,
    bodyCount: maxRigidBodies,
    actualGpuQueueUploadBytes: {
      initial: rigidInitialBytes4096,
      transformOnly: rigidTransformBytes4096,
      colorOnly: rigidColorBytes4096,
      settledUnchanged: rigidSettledBytes4096,
    },
    activeReductionPercent: (1 - rigidTransformBytes4096 / rigidInitialBytes4096) * 100,
    uncapturedWebGpuErrors: runtimeErrors.length,
  };
  const outputPath = path.join(root, `benchmarks/results/native-rigid-upload-${dawnBackend}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`Wrote ${outputPath}`);
}

if (process.env.WEBGPU_BENCH_UPLOAD_CACHE === '1') {
  const cachedIterations = 100000;
  const changedIterations = 2000;
  renderer.invalidateDynamicCaches();
  rigidFrameVersion++;
  renderer.uploadInstances(source, 1);
  for (let i = 0; i < 1000; i++) renderer.uploadInstances(source, 1);
  let start = performance.now();
  for (let i = 0; i < cachedIterations; i++) renderer.uploadInstances(source, 1);
  const cachedNsPerCall = (performance.now() - start) * 1e6 / cachedIterations;
  start = performance.now();
  for (let i = 0; i < changedIterations; i++) {
    rigidFrameVersion++;
    renderer.uploadInstances(source, 1);
  }
  const changedNsPerCall = (performance.now() - start) * 1e6 / changedIterations;
  await renderer.device.queue.onSubmittedWorkDone();
  const evidence = {
    rendererSha256,
    uploadCacheBenchmark: {
      dawnBackend,
      cachedNsPerCall,
      changedNsPerCall,
      callSpeedup: changedNsPerCall / cachedNsPerCall,
      cachedUploadedBytes: renderer.uploadInstances(source, 1),
    },
  };
  const outputPath = path.join(root, `benchmarks/results/upload-cache-${dawnBackend}.json`);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
  console.log(`Wrote ${outputPath}`);
}

console.log(`✅ Actual WebGPURenderer command validation passed on Dawn ${dawnBackend}: rigid/cloth/water/rope paths, upload caches, lazy visibility retry/cleanup, 25 shadow-cache transitions, material boundary gates, failed-frame recovery, and clean error stream (null backend does not execute pixels)`);

currentTexture?.destroy();
renderer.device.destroy();
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
gpu = null;
