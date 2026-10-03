import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { create, globals } from 'webgpu';

Object.assign(globalThis, globals);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendererSource = fs.readFileSync(path.join(root, 'src/webgpu/renderer.ts'), 'utf8');
const engineSourceIdentity=['src/webgpu/renderer.ts','src/webgpu/gpu-timing.ts','src/webgpu/shadow-cache.ts','src/webgpu/instance-partition.ts',
  'src/webgpu/resident-water-surface.ts','src/webgpu/linear-water.ts','src/webgpu/water-telemetry.ts','src/webgpu/startup-budget.ts',
  'src/engine/linear-water.ts','src/engine/closed-water.ts','src/webgpu/closed-water-shader.ts','src/engine/contracts.ts','src/assets/ktx2.ts','scripts/webgpu-renderer-runtime-test.mjs']
  .map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex')}));
const rendererSha256 = crypto.createHash('sha256').update(rendererSource).digest('hex');
const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'box3d-webgpu-runtime-'));
process.once('exit', () => fs.rmSync(runtimeDir, { recursive: true, force: true }));
const runtimeWebgpuDir = path.join(runtimeDir, 'webgpu');
const runtimeAssetsDir = path.join(runtimeDir, 'assets');
fs.mkdirSync(runtimeWebgpuDir, { recursive: true });
fs.mkdirSync(runtimeAssetsDir, { recursive: true });
const runtimeModulePath = path.join(runtimeWebgpuDir, 'renderer-runtime.mjs');
let transpiledRenderer = ts.transpileModule(rendererSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
  fileName: 'renderer.ts',
}).outputText;
transpiledRenderer = transpiledRenderer.replace('../assets/ktx2.js', '../assets/ktx2.mjs').replace('./gpu-timing.js', './gpu-timing.mjs').replace('./shadow-cache.js', './shadow-cache.mjs').replace('./instance-partition.js', './instance-partition.mjs').replace('./resident-water-surface.js','./resident-water-surface.mjs').replace('./startup-budget.js','./startup-budget.mjs');
fs.writeFileSync(path.join(runtimeWebgpuDir, 'startup-budget.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'src/webgpu/startup-budget.ts'), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},fileName:'startup-budget.ts'}).outputText);
fs.writeFileSync(path.join(runtimeWebgpuDir, 'resident-water-surface.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'src/webgpu/resident-water-surface.ts'), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},fileName:'resident-water-surface.ts'}).outputText);
fs.writeFileSync(path.join(runtimeWebgpuDir, 'instance-partition.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'src/webgpu/instance-partition.ts'), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},fileName:'instance-partition.ts'}).outputText);
fs.writeFileSync(path.join(runtimeWebgpuDir, 'shadow-cache.mjs'), ts.transpileModule(fs.readFileSync(path.join(root, 'src/webgpu/shadow-cache.ts'), 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},fileName:'shadow-cache.ts'}).outputText);
fs.writeFileSync(runtimeModulePath, transpiledRenderer);
fs.writeFileSync(path.join(runtimeWebgpuDir, 'gpu-timing.mjs'), ts.transpileModule(
  fs.readFileSync(path.join(root, 'src/webgpu/gpu-timing.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    fileName: 'gpu-timing.ts',
  },
).outputText);
const ktx2Source = fs.readFileSync(path.join(root, 'src/assets/ktx2.ts'), 'utf8');
const transpiledKtx2 = ts.transpileModule(ktx2Source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  fileName: 'ktx2.ts',
}).outputText;
fs.writeFileSync(path.join(runtimeAssetsDir, 'ktx2.mjs'), transpiledKtx2);

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
const renderer = await WebGPURenderer.create(canvas, maxRigidBodies, {
  gpuTiming: process.env.WEBGPU_GPU_TIMING === '0' ? false : { sampleEveryFrames: 1 },
  instancePartitioning: process.env.WEBGPU_INSTANCE_PARTITION === '1',
});
const initialTimingStatus = renderer.gpuTimingInfo().status;
async function settleTiming() {
  for (let attempt = 0; attempt < 100 && renderer.gpuTimingInfo().pendingSamples > 0; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return renderer.gpuTimingInfo();
}
async function readPresentedPixels() {
  const bytesPerRow=Math.ceil(canvas.width*4/256)*256;
  const buffer=renderer.device.createBuffer({label:'shadow reuse pixel qualification',size:bytesPerRow*canvas.height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  try{
    const encoder=renderer.device.createCommandEncoder();
    encoder.copyTextureToBuffer({texture:currentTexture},{buffer,bytesPerRow},[canvas.width,canvas.height]);
    renderer.device.queue.submit([encoder.finish()]);await buffer.mapAsync(GPUMapMode.READ);
    return new Uint8Array(buffer.getMappedRange()).slice();
  }finally{buffer.unmap();buffer.destroy();}
}
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
  _b3w_body_count: () => maxRigidBodies,
  _b3w_max_bodies: () => maxRigidBodies,
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
const firstShadowCount=renderer.shadowCacheInfo().rendered;
renderer.render(2, []);await renderer.device.queue.onSubmittedWorkDone();
assert.equal(renderer.shadowCacheInfo().rendered,firstShadowCount,'unchanged casters must reuse their shadow map');
assert.ok(renderer.shadowCacheInfo().reused>0);
const cachedShadowPixels=dawnBackend==='null'?null:await readPresentedPixels();
if(initialTimingStatus==='ready'&&dawnBackend!=='null'){
  const cachedTiming=await settleTiming();
  assert.equal(cachedTiming.latest.passMs.shadow,null,'cached shadow pass must be absent, not a fabricated zero duration');
}
renderer.invalidateDynamicCaches();renderer.uploadInstances(source,1);renderer.uploadEffects(effectMatrices,effectColors,1,1,2);
renderer.render(2, []);await renderer.device.queue.onSubmittedWorkDone();
assert.equal(renderer.shadowCacheInfo().rendered,firstShadowCount+1,'scene invalidation must regenerate shadow depth');
if(cachedShadowPixels){
  assert.deepEqual(await readPresentedPixels(),cachedShadowPixels,'cached and regenerated shadow maps must produce identical presented pixels');
  console.log(`Shadow reuse pixels: ${JSON.stringify({width:canvas.width,height:canvas.height,sha256:crypto.createHash('sha256').update(cachedShadowPixels).digest('hex'),cache:renderer.shadowCacheInfo()})}`);
}

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
  topologyVersion: 1,
  frameVersion: 3,
  cols: 2,
  rows: 2,
  baseColorA: [0.08, 0.28, 0.9, 1],
  baseColorB: [0.82, 0.06, 0.035, 1],
};
assert.equal(renderer.uploadSurface(gpuClothFrame), 4 * 24 + surfaceIndices.byteLength, 'first GPU cloth frame must upload current/rest positions and refresh topology after the sheet topology version changes');
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
if (initialTimingStatus === 'ready' && dawnBackend !== 'null') await settleTiming();
renderer.render(4, []);
await renderer.device.queue.onSubmittedWorkDone();
if (initialTimingStatus === 'ready' && dawnBackend !== 'null') {
  const ropeTiming = await settleTiming();
  assert.equal(ropeTiming.status, 'ready', ropeTiming.reason);
  for (const name of ['compute', 'shadow', 'main', 'post']) {
    assert.equal(typeof ropeTiming.latest?.passMs[name], 'number', `${name} must produce a real GPU duration`);
    assert.ok(ropeTiming.latest.passMs[name] >= 0);
  }
  console.log(`All-pass GPU timing: ${JSON.stringify(ropeTiming.latest)}`);
}
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
  topologyVersion: 1,
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

// Timestamp readbacks settle independently from queue completion. Yield to their
// callbacks here in the test harness only; production rendering never waits.
if(process.env.WEBGPU_WATER_EVIDENCE) {
  assert.notEqual(dawnBackend,'null','Resident water evidence requires a physical GPU.');
  const {GpuLinearWater}=await import('../src/webgpu/linear-water.ts');
  const {createLinearWaterArrays}=await import('../src/engine/linear-water.ts');
  const {createClosedWaterArrays}=await import('../src/engine/closed-water.ts');
  const closed=process.env.WEBGPU_WATER_MODEL==='closed';
  const config={cols:32,rows:24,dt:1/600,gravity:9.81,meanDepth:1.5,drag:.28,dx:2/31,dz:2/23};
  const initial=createLinearWaterArrays(config);
  for(let i=0;i<initial.eta.length;i++)initial.eta[i]=Math.sin(i%32*.27)*Math.cos(Math.floor(i/32)*.31)*.08;
  const solver=closed?await GpuLinearWater.createClosed(renderer.device,config,createClosedWaterArrays(config,{eta:initial.eta})):await GpuLinearWater.create(renderer.device,config,initial),cases=[];
  const indices=new Uint16Array(31*23*6);let offset=0;
  for(let z=0;z<23;z++)for(let x=0;x<31;x++){const a=z*32+x;indices.set([a,a+32,a+1,a+1,a+32,a+33],offset);offset+=6;}
  const view=[.85,0,0,0, 0,.75,.1,0, 0,.5,.2,0, 0,0,.5,1];
  renderer.writeSceneUniforms({viewProjection:view,lightViewProjection:identity,cameraPosition:[0,4,8],lightDirection:[.42,-.84,.34],fogColor:[.055,.085,.14],timeSeconds:2,
    quality:{...quality,sampleCount:1,shadowMapSize:1024,shadowTapCount:1,resolutionScale:1}});
  try {
    for(const ticks of [1,2,17]){
      renderer.useGpuWater(solver);solver.step(ticks);renderer.render(0,[]);await renderer.device.queue.onSubmittedWorkDone();
      const residentPixels=await readPresentedPixels(),checkpoint=await solver.checkpoint();
      let u=checkpoint.state.u,v=checkpoint.state.v;
      if(closed){
        u=new Float32Array(32*24);v=new Float32Array(32*24);
        for(let i=0;i<u.length;i++){u[i]=.5*(checkpoint.state.u[i]+(i%32?checkpoint.state.u[i-1]:0));v[i]=.5*(checkpoint.state.v[i]+(i>=32?checkpoint.state.v[i-32]:0));}
      }
      const frame={path:'gpu-water',material:'water',eta:checkpoint.state.eta,u,v,indices,vertexCount:32*24,indexCount:indices.length,
        cols:32,rows:24,width:2,depth:2,baseY:0,frameVersion:solver.tick,topologyVersion:1};
      renderer.uploadSurface(frame);renderer.render(0,[]);await renderer.device.queue.onSubmittedWorkDone();
      assert.deepEqual(await readPresentedPixels(),residentPixels,'Direct GPU numerical buffers must match the same fields uploaded by CPU.');
      assert.equal(solver.alive,true,'Switching the renderer must preserve the borrowed solver.');
      cases.push({tick:solver.tick,pixelsSha256:crypto.createHash('sha256').update(residentPixels).digest('hex')});
    }
    assert.ok(new Set(cases.map(c=>c.pixelsSha256)).size>1,'The numerical updates must change visible water pixels.');
    const large=await (closed?GpuLinearWater.createClosed:GpuLinearWater.create)(renderer.device,{...config,cols:512,rows:512});
    try {
      assert.throws(()=>renderer.useGpuWater(large),/renderStride/);
      renderer.useGpuWater(large,{renderStride:8});large.step(1);renderer.render(0,[]);await renderer.device.queue.onSubmittedWorkDone();
      assert.deepEqual(renderer.gpuWaterInfo(),{mode:'gpu-numerical',model:large.backend,solverCells:512*512,meshVertices:65*65,renderStride:8});
      const info=renderer.gpuWaterInfo();renderer.useGpuWater(null);assert.equal(large.alive,true);
      cases.push({largeField:info,uint32Indices:true});
    }finally{renderer.useGpuWater(null);large.destroy();}
    renderer.useGpuWater(solver);solver.destroy();assert.throws(()=>renderer.render(0,[]),/destroyed/);renderer.useGpuWater(null);
    await settleTiming();assert.deepEqual(runtimeErrors,[]);
    fs.writeFileSync(path.resolve(process.env.WEBGPU_WATER_EVIDENCE),JSON.stringify({schema:'box3d.resident-water-qualification/1',status:'passed',dawnBackend,model:solver.backend,rendererSha256,sources:engineSourceIdentity,cases,
      scope:closed?'Closed C-grid rendered directly; exact pixels against independent CPU face-to-center velocity interpolation. Large-field rendering uses explicit stride.':'GPU numerical fields rendered directly; exact pixels against CPU-uploaded copies of the same float32 fields. Large-field rendering uses explicit mesh stride; numerical grid unchanged.'},null,2)+'\n',{flag:'wx'});
  }finally{renderer.useGpuWater(null);solver.destroy();}
}
if (process.env.WEBGPU_PARTITION_EVIDENCE) {
  assert.notEqual(dawnBackend, 'null', 'Partition evidence requires a physical GPU backend.');
  const evidence = { schema:'box3d.instance-partition-qualification/1', backend:dawnBackend,
    capturedAt:new Date().toISOString(), rendererSha256,sources:engineSourceIdentity,
    partitionSha256:crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'src/webgpu/instance-partition.ts'))).digest('hex'),
    mode:renderer.instancePartitionInfo().mode, cases:[], timings:[], errors:runtimeErrors };
  const tags = [1,-1,-4,-6,-2,-4.49,-5.99,-3.4,0];
  const colorsStart=maxRigidBodies*16;
  const partition = renderer.instancePartition;
  async function readU32(buffer, size) {
    const staging=renderer.device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try {
      const encoder=renderer.device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,0,staging,0,size);
      renderer.device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);
      return new Uint32Array(staging.getMappedRange()).slice();
    } finally { staging.unmap();staging.destroy(); }
  }
  renderer.uploadSurface(null);renderer.uploadRopeGrid(null,0);
  canvas.clientWidth=256;canvas.clientHeight=192;
  for(const sampleCount of [1,4])for(const count of [0,1,63,64,65,127,128,129,4096]) {
    const opaque=[],transparent=[];
    for(let id=0;id<count;id++) {
      const x=(id%32)/16-.97,y=Math.floor(id/32)%16/8-.94,z=.2+(Math.floor(id/512)%8)*.055;
      heap.set([.035,0,0,0, 0,.055,0,0, 0,0,.025,0, x,y,z,1],id*16);
      const alpha=tags[id%tags.length];heap.set([.25+(id%3)*.2,.52,.66,alpha],colorsStart+id*4);
      const material=Math.round(Math.max(-alpha,0));(material===4||material===6?transparent:opaque).push(id);
    }
    rigidFrameVersion++;rigidColorVersion++;
    renderer.invalidateDynamicCaches();renderer.uploadInstances(source,count);
    renderer.writeSceneUniforms({viewProjection:identity,lightViewProjection:identity,cameraPosition:[0,4,8],lightDirection:[.42,-.84,.34],fogColor:[.055,.085,.14],timeSeconds:2,
      quality:{...quality,sampleCount,shadowMapSize:1024,shadowTapCount:1,resolutionScale:1}});
    renderer.render(count,[]);await renderer.device.queue.onSubmittedWorkDone();
    const pixels=await readPresentedPixels();
    if(partition) {
      assert.deepEqual([...await readU32(partition.indirectBuffer,32)],[36,opaque.length,0,0,36,transparent.length,0,0]);
      if(opaque.length)assert.deepEqual([...await readU32(partition.buffers[3],opaque.length*4)],opaque,'Opaque IDs must retain exact original order.');
      if(transparent.length)assert.deepEqual([...await readU32(partition.buffers[4],transparent.length*4)],transparent,'Transparent IDs must retain exact original blend order.');
      const builds=renderer.instancePartitionInfo().builds;
      renderer.render(count,[]);await renderer.device.queue.onSubmittedWorkDone();
      assert.equal(renderer.instancePartitionInfo().builds,builds,'A cached material list must not be rebuilt.');
      assert.deepEqual(await readPresentedPixels(),pixels,'Cached partition must reproduce its first frame.');
    }
    evidence.cases.push({count,sampleCount,opaque:opaque.length,transparent:transparent.length,pixelsSha256:crypto.createHash('sha256').update(pixels).digest('hex')});
  }
  // This is a GPU component timing probe, not an interactive/browser capacity gate.
  // Every measured frame includes main/post work; changed cases include partition compute.
  for(const count of [128,4096])for(const changed of [false,true]) {
    rigidFrameVersion++;rigidColorVersion++;renderer.uploadInstances(source,count);
    for(let frame=0;frame<24;frame++) {
      if(changed){rigidColorVersion++;renderer.uploadInstances(source,count);}
      renderer.render(count,[]);await renderer.device.queue.onSubmittedWorkDone();await settleTiming();
    }
    const samples=[];
    for(let frame=0;frame<48;frame++) {
      if(changed){rigidColorVersion++;renderer.uploadInstances(source,count);}
      renderer.render(count,[]);await renderer.device.queue.onSubmittedWorkDone();
      const timing=await settleTiming();
      if(timing.status==='ready'&&timing.latest?.frameId===timing.frames)samples.push(timing.latest.totalPassMs);
    }
    evidence.timings.push({count,changed,samples,totalPassMsScope:'GPU compute/shadow/main/post passes; excludes browser scheduling and physics'});
  }
  assert.deepEqual(runtimeErrors,[]);
  evidence.partition=renderer.instancePartitionInfo();
  evidence.timing=renderer.gpuTimingInfo();
  evidence.timingQualified=evidence.timings.every(timing=>timing.samples.length===48)&&evidence.timing.status==='ready';
  fs.writeFileSync(path.resolve(process.env.WEBGPU_PARTITION_EVIDENCE),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});
}
if (process.env.WEBGPU_NATIVE_WORLD_EVIDENCE) {
  assert.notEqual(dawnBackend,'null','Native world pixel evidence requires a physical GPU.');
  const {NativeWorldPool}=await import('../src/engine/native-world.ts');
  const {mat4Perspective,mat4LookAt,mat4Multiply}=await import('../src/math.ts');
  const artifactDirectory=path.resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR??path.join(root,'public/box3d'));
  const {default:factory}=await import(pathToFileURL(path.join(artifactDirectory,'box3d.js')));
  const mod=await factory({wasmBinary:fs.readFileSync(path.join(artifactDirectory,'box3d.wasm'))});
  const pool=new NativeWorldPool(mod),a=pool.createWorld(),b=pool.createWorld(),cases=[];
  let allocation=0;
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  try {
    a.createScene({id:0},1,42);b.createScene({id:0},1,42);a.kick(2);b.kick(18);
    for(let i=0;i<60;i++){a.step(1/60,4);b.step(1/60,4);}
    assert.equal(a.bodyCount(),b.bodyCount());assert.equal(a.frameVersion(),b.frameVersion());assert.equal(a.colorVersion(),b.colorVersion());
    assert.equal(a.HEAPF32.buffer,b.HEAPF32.buffer,'worlds share a module heap');
    renderer.invalidateDynamicCaches();renderer.uploadSurface(null);renderer.uploadRopeGrid(null,0);
    const eye=[18,14,24],view=mat4Multiply(mat4Perspective(Math.PI/3,96/64,.1,200),mat4LookAt(eye,[0,4,0],[0,1,0]));
    renderer.writeSceneUniforms({viewProjection:view,lightViewProjection:identity,cameraPosition:eye,
      lightDirection:[.42,-.84,.34],fogColor:[.055,.085,.14],timeSeconds:2,
      quality:{...quality,sampleCount:1,shadowMapSize:1024,shadowTapCount:1,resolutionScale:1,shadowStrength:0}});
    const count=a.bodyCount(),fullBytes=count*80;
    async function draw(world,expectedBytes,label){
      const bytes=renderer.uploadInstances(world,count);assert.equal(bytes,expectedBytes,label+' upload bytes');
      renderer.render(count,[]);await renderer.device.queue.onSubmittedWorkDone();
      const pixels=await readPresentedPixels();cases.push({label,uploadBytes:bytes,pixelsSha256:sha(pixels)});return pixels;
    }
    const first=await draw(a,fullBytes,'world A'),second=await draw(b,fullBytes,'world B, equal revisions and heap');
    assert.notDeepEqual(second,first,'switching worlds must visibly change the native scene');
    assert.deepEqual(await draw(a,fullBytes,'return to world A'),first);
    assert.deepEqual(await draw(a,0,'unchanged world A'),first);
    const copiedHeap=new Float32Array(count*20);
    copiedHeap.set(a.HEAPF32.subarray(Number(a._b3w_matrices_ptr())/4,Number(a._b3w_matrices_ptr())/4+count*16));
    copiedHeap.set(a.HEAPF32.subarray(Number(a._b3w_colors_ptr())/4,Number(a._b3w_colors_ptr())/4+count*4),count*16);
    const copy={HEAPF32:copiedHeap,_b3w_matrices_ptr:()=>0,_b3w_colors_ptr:()=>count*16*4,_b3w_body_count:()=>count,_b3w_max_bodies:()=>count,frameVersion:()=>1,colorVersion:()=>1};
    assert.deepEqual(await draw(copy,fullBytes,'independent copied streams'),first);
    await draw(a,fullBytes,'world A before heap growth');const oldHeap=a.HEAPF32;
    allocation=mod._malloc(oldHeap.byteLength+1024*1024);assert.ok(allocation>0);assert.notEqual(a.HEAPF32.buffer,oldHeap.buffer);
    assert.deepEqual(await draw(a,fullBytes,'world A after heap growth'),first);
    b.destroy();assert.deepEqual(await draw(a,0,'world A after sibling destruction'),first);
    assert.throws(()=>renderer.uploadInstances(b,count),error=>error.code==='DISPOSED');
    await settleTiming();assert.deepEqual(runtimeErrors,[]);
    const adapter=await navigator.gpu.requestAdapter();
    const info=adapter?.info??{};
    const adapterIdentity={vendor:info.vendor??null,architecture:info.architecture??null,device:info.device??null,
      description:info.description??null,isFallbackAdapter:info.isFallbackAdapter??adapter?.isFallbackAdapter??null};
    assert.equal(adapterIdentity.isFallbackAdapter,false,'Native world evidence requires a physical adapter identity.');
    const sources=[...engineSourceIdentity,...['src/engine/native-world.ts','src/math.ts'].map(file=>({file,sha256:sha(fs.readFileSync(path.join(root,file)))}))];
    const artifacts=['box3d.js','box3d.wasm'].map(file=>({file,sha256:sha(fs.readFileSync(path.join(artifactDirectory,file)))}));
    fs.writeFileSync(path.resolve(process.env.WEBGPU_NATIVE_WORLD_EVIDENCE),JSON.stringify({schema:'box3d.native-world-renderer-qualification/1',
      status:'passed',dawnBackend,adapter:adapterIdentity,sources,artifacts,bodyCount:count,cases,
      uncapturedWebGpuErrors:runtimeErrors.length,scope:'Exact rendered pixels for world switching, copied streams, heap growth and sibling destruction. No frame-speed claim.'},null,2)+'\n',{flag:'wx'});
  }finally{if(allocation)mod._free(allocation);pool.destroy();}
}
if (process.env.WEBGPU_NATIVE_RECYCLING_EVIDENCE) {
  const {qualifyNativeRecycling}=await import('./native-recycling-renderer-qualify.mjs');
  await qualifyNativeRecycling({renderer,canvas,readPresentedPixels,settleTiming,runtimeErrors,root,dawnBackend,engineSourceIdentity,quality});
}
if (process.env.WEBGPU_NATIVE_CAPACITY_EVIDENCE) {
  const {qualifyNativeCapacity}=await import('./native-capacity-renderer-qualify.mjs');
  await qualifyNativeCapacity({renderer,canvas,readPresentedPixels,settleTiming,runtimeErrors,root,dawnBackend,engineSourceIdentity,quality});
}
if (initialTimingStatus === 'ready') {
  const timing = await settleTiming();
  if (dawnBackend !== 'null') {
    assert.equal(timing.status, 'ready', timing.reason);
    assert.ok(timing.completedSamples > 0, 'physical GPU must resolve real pass timestamps');
    assert.equal(typeof timing.latest.passMs.main, 'number');
    assert.equal(typeof timing.latest.passMs.post, 'number');
    assert.ok(timing.latest.passMs.main >= 0 && timing.latest.passMs.post >= 0);
    assert.equal(timing.pendingSamples, 0, 'timestamp readbacks must settle');
  }
}
console.log(`GPU timing diagnostics: ${JSON.stringify(renderer.gpuTimingInfo())}`);
console.log(`✅ Actual WebGPURenderer runtime test passed on Dawn ${dawnBackend}: rigid shadows, packed/GPU cloth and GPU water, GPU-compute rope reconstruction, exact paused-frame upload caches, debug lines, resize, empty frame, and clean Dawn error stream`);

currentTexture?.destroy();
renderer.dispose();
renderer.destroy();
assert.equal(renderer.isDisposed(), true);
assert.equal(renderer.gpuTimingInfo().status, 'disposed');
assert.throws(() => renderer.render(0, []), /disposed/);
Object.defineProperty(globalThis, 'navigator', { configurable: true, value: {} });
gpu = null;
