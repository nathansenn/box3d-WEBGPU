#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { create, globals } from 'webgpu';

Object.assign(globalThis, globals);

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const archivePath = process.env.RENDERER_HOTPATH_BASELINE_ARCHIVE
  ? path.resolve(process.env.RENDERER_HOTPATH_BASELINE_ARCHIVE)
  : path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz');
const outputBasename = process.env.RENDERER_HOTPATH_OUTPUT ?? 'renderer-hotpath-metal';
if (!/^[a-z0-9][a-z0-9._-]*$/i.test(outputBasename)) throw new Error('RENDERER_HOTPATH_OUTPUT must be a safe basename');
const resultsPath = path.join(root, `benchmarks/results/${outputBasename}.json`);
const reportPath = path.join(root, `benchmarks/results/${outputBasename}.md`);
const expected = {
  archiveSha256: process.env.RENDERER_HOTPATH_BASELINE_ARCHIVE_SHA256 ?? 'dea18ff88e86568e5449c9dece5610d0dfadf38d901eef1c1e39155c64e8c3f5',
  baselineRendererSha256: process.env.RENDERER_HOTPATH_BASELINE_RENDERER_SHA256 ?? 'e12869557c9809cdf562fc5ead456121ac189013793b0b15c6236f2a4793e240',
  pcfRendererSha256: '121e89c29564231ccab50f8bf37318f3c31c754c91decc69ef3c604ac828e8d6',
  ktx2Sha256: '8d9074f9414a508459644205f288b8d1fc7840d76017eb87096555efbcc32ca6',
};

const config = {
  backend: process.env.RENDERER_HOTPATH_BACKEND ?? 'metal',
  width: positiveInteger('RENDERER_HOTPATH_WIDTH', 1920),
  height: positiveInteger('RENDERER_HOTPATH_HEIGHT', 1080),
  rigidInstances: positiveInteger('RENDERER_HOTPATH_RIGID_INSTANCES', 4096),
  waterRigidInstances: positiveInteger('RENDERER_HOTPATH_WATER_INSTANCES', 1024),
  warmupFrames: positiveInteger('RENDERER_HOTPATH_WARMUPS', 100),
  batches: positiveInteger('RENDERER_HOTPATH_BATCHES', 21),
  framesPerBatch: positiveInteger('RENDERER_HOTPATH_FRAMES_PER_BATCH', 100),
  bootstrapSamples: positiveInteger('RENDERER_HOTPATH_BOOTSTRAPS', 20_000),
  shadowMapSize: 2048,
  sampleCount: 4,
};

function positiveInteger(name, fallback) {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer`);
  return value;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function archiveText(entry) {
  return execFileSync('tar', ['-xOzf', archivePath, entry], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
}

function replaceExact(source, before, after, expectedCount, label) {
  const count = source.split(before).length - 1;
  assert.equal(count, expectedCount, `${label}: expected ${expectedCount} exact source matches, found ${count}`);
  return source.split(before).join(after);
}

function applyPcfEdit(source) {
  const before = `  let centerVisibility = textureSampleCompareLevel(shadowMap, shadowSampler, uv, referenceDepth);\n  if (scene.qualityModes.x < 1.5) {\n    return mix(1.0, centerVisibility, inBounds);\n  }`;
  const after = `  if (scene.qualityModes.x < 1.5) {\n    let centerVisibility = textureSampleCompareLevel(shadowMap, shadowSampler, uv, referenceDepth);\n    return mix(1.0, centerVisibility, inBounds);\n  }`;
  return replaceExact(source, before, after, 4, 'PCF center-sample edit');
}

function applyFogEdit(source) {
  let count = 0;
  const result = source.replace(
    /  let distanceToCamera = length\(scene\.cameraPosTime\.xyz - input\.worldPos\);\n  let fogAmount = 1\.0 - exp\(-scene\.fogColorDensity\.w \* distanceToCamera \* distanceToCamera \* (0\.018|0\.014)\);/g,
    (_match, factor) => {
      count++;
      return `  let cameraDelta = scene.cameraPosTime.xyz - input.worldPos;\n  let distanceSquared = dot(cameraDelta, cameraDelta);\n  let fogAmount = 1.0 - exp(-scene.fogColorDensity.w * distanceSquared * ${factor});`;
    },
  );
  assert.equal(count, 5, `squared-distance fog edit: expected 5 exact source matches, found ${count}`);
  return result;
}

function applyDepthDiscardEdit(source) {
  const before = `        view: this.depthView,\n        depthClearValue: 1,\n        depthLoadOp: 'clear',\n        depthStoreOp: 'store',`;
  const after = `        view: this.depthView,\n        depthClearValue: 1,\n        depthLoadOp: 'clear',\n        depthStoreOp: 'discard',`;
  return replaceExact(source, before, after, 1, 'HDR depth discard edit');
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function mad(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function stats(values) {
  return {
    median: median(values),
    mad: mad(values),
    min: Math.min(...values),
    max: Math.max(...values),
  };
}

function seedFrom(label) {
  const digest = crypto.createHash('sha256').update(label).digest();
  return digest.readUInt32LE(0) || 0x6d2b79f5;
}

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function quantile(sorted, probability) {
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  const weight = position - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function pairedSpeedup(label, baselineSamples, variantSamples, bootstrapSamples = config.bootstrapSamples) {
  assert.equal(baselineSamples.length, variantSamples.length);
  const logRatios = baselineSamples.map((value, index) => Math.log(value / variantSamples[index]));
  const point = Math.exp(logRatios.reduce((sum, value) => sum + value, 0) / logRatios.length);
  const random = randomGenerator(seedFrom(label));
  const bootstrap = new Float64Array(bootstrapSamples);
  for (let sample = 0; sample < bootstrapSamples; sample++) {
    let total = 0;
    for (let i = 0; i < logRatios.length; i++) total += logRatios[Math.floor(random() * logRatios.length)];
    bootstrap[sample] = Math.exp(total / logRatios.length);
  }
  bootstrap.sort();
  return {
    geometricMean: point,
    ratioOfMedians: median(baselineSamples) / median(variantSamples),
    ci95: [quantile(bootstrap, 0.025), quantile(bootstrap, 0.975)],
    pairedLogRatios: logRatios,
  };
}

function aggregateSpeedup(label, experiments) {
  const baseline = [];
  const variant = [];
  for (const experiment of experiments) {
    baseline.push(...experiment.baselineMsPerFrame);
    variant.push(...experiment.variantMsPerFrame);
  }
  return pairedSpeedup(label, baseline, variant);
}

function normalize3([x, y, z]) {
  const length = Math.hypot(x, y, z);
  return length > 1e-12 ? [x / length, y / length, z / length] : [0, 0, 0];
}

function subtract3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function scale3(a, scalar) {
  return [a[0] * scalar, a[1] * scalar, a[2] * scalar];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function lookAt(eye, target, up) {
  const z = normalize3(subtract3(eye, target));
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

function perspective(fovy, aspect, near, far) {
  const f = 1 / Math.tan(fovy * 0.5);
  const nf = 1 / (near - far);
  const out = new Float32Array(16);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = far * nf;
  out[11] = -1;
  out[14] = far * near * nf;
  return out;
}

function orthographic(left, right, bottom, top, near, far) {
  const out = new Float32Array(16);
  out[0] = 2 / (right - left);
  out[5] = 2 / (top - bottom);
  out[10] = 1 / (near - far);
  out[12] = -(right + left) / (right - left);
  out[13] = -(top + bottom) / (top - bottom);
  out[14] = near / (near - far);
  out[15] = 1;
  return out;
}

function multiply4(a, b) {
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      out[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }
  return out;
}

function createGridIndices(cols, rows) {
  const indices = new Uint16Array((cols - 1) * (rows - 1) * 6);
  let cursor = 0;
  for (let row = 0; row < rows - 1; row++) {
    for (let col = 0; col < cols - 1; col++) {
      const a = row * cols + col;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      indices[cursor++] = a;
      indices[cursor++] = c;
      indices[cursor++] = b;
      indices[cursor++] = b;
      indices[cursor++] = c;
      indices[cursor++] = d;
    }
  }
  return indices;
}

function createRigidSource(count) {
  const matrices = new Float32Array(count * 16);
  const colors = new Float32Array(count * 4);
  for (let index = 0; index < count; index++) {
    const col = index & 63;
    const row = index >> 6;
    const matrix = index * 16;
    const x = (col - 31.5) * 0.51;
    const y = 0.35 + row * 0.49;
    const z = Math.sin(col * 0.31) * 0.22 + Math.cos(row * 0.23) * 0.16;
    matrices[matrix] = 0.235;
    matrices[matrix + 5] = 0.225;
    matrices[matrix + 10] = 0.235;
    matrices[matrix + 12] = x;
    matrices[matrix + 13] = y;
    matrices[matrix + 14] = z;
    matrices[matrix + 15] = 1;
    const color = index * 4;
    const hue = ((col * 5 + row * 3) & 63) / 63;
    colors[color] = 0.06 + hue * 0.82;
    colors[color + 1] = 0.18 + (1 - hue) * 0.38;
    colors[color + 2] = 0.35 + Math.sin(index * 0.013) * 0.18 + 0.18;
    colors[color + 3] = 1;
  }
  const heap = new Float32Array(matrices.length + colors.length);
  heap.set(matrices, 0);
  heap.set(colors, matrices.length);
  return {
    HEAPF32: heap,
    frameVersion: () => 1,
    colorVersion: () => 1,
    _b3w_matrices_ptr: () => 0,
    _b3w_colors_ptr: () => matrices.byteLength,
    _b3w_body_count: () => count,
    _b3w_max_bodies: () => count,
  };
}

function createClothSurface() {
  const cols = 128;
  const rows = 128;
  const vertexCount = cols * rows;
  const positions = new Float32Array(vertexCount * 3);
  const restPositions = new Float32Array(vertexCount * 3);
  const strain = new Float32Array(vertexCount);
  for (let row = 0; row < rows; row++) {
    const v = row / (rows - 1);
    for (let col = 0; col < cols; col++) {
      const u = col / (cols - 1);
      const index = row * cols + col;
      const offset = index * 3;
      const x = (u - 0.5) * 31;
      const y = 0.6 + (1 - v) * 23;
      positions[offset] = x;
      positions[offset + 1] = y;
      positions[offset + 2] = Math.sin(u * Math.PI * 8) * Math.sin(v * Math.PI * 3) * 0.72;
      restPositions[offset] = x;
      restPositions[offset + 1] = y;
      restPositions[offset + 2] = 0;
      strain[index] = 0.12 + 0.58 * Math.abs(Math.sin(u * Math.PI * 5) * Math.cos(v * Math.PI * 4));
    }
  }
  const indices = createGridIndices(cols, rows);
  return {
    path: 'gpu-cloth',
    material: 'cloth',
    positions,
    restPositions,
    strain,
    indices,
    vertexCount,
    indexCount: indices.length,
    topologyVersion: 1,
    frameVersion: 1,
    cols,
    rows,
    baseColorA: [0.045, 0.21, 0.82, 1],
    baseColorB: [0.92, 0.055, 0.025, 1],
  };
}

function createWaterSurface() {
  const cols = 128;
  const rows = 128;
  const vertexCount = cols * rows;
  const eta = new Float32Array(vertexCount);
  const u = new Float32Array(vertexCount);
  const v = new Float32Array(vertexCount);
  for (let row = 0; row < rows; row++) {
    const nz = row / (rows - 1) * 2 - 1;
    for (let col = 0; col < cols; col++) {
      const nx = col / (cols - 1) * 2 - 1;
      const index = row * cols + col;
      const radial = Math.hypot(nx, nz);
      eta[index] = Math.sin(radial * 28 - 2.4) * Math.exp(-radial * 1.35) * 0.54 + Math.sin(nx * 14 + nz * 9) * 0.08;
      u[index] = Math.cos(nz * 9) * 0.38 - nz * 0.16;
      v[index] = Math.sin(nx * 8) * 0.34 + nx * 0.14;
    }
  }
  const indices = createGridIndices(cols, rows);
  return {
    path: 'gpu-water',
    material: 'water',
    eta,
    u,
    v,
    indices,
    vertexCount,
    indexCount: indices.length,
    topologyVersion: 1,
    frameVersion: 1,
    cols,
    rows,
    width: 34,
    depth: 34,
    baseY: 0,
  };
}

function makeSceneState(scene, taps) {
  const cameraByScene = {
    rigid: { eye: [0, 15.7, 37.5], target: [0, 15.7, 0], extent: 36 },
    cloth: { eye: [0, 12.2, 32], target: [0, 12.2, 0], extent: 34 },
    water: { eye: [25, 21, 28], target: [0, 1.5, 0], extent: 42 },
  };
  const camera = cameraByScene[scene];
  const lightDirection = normalize3([0.42, -0.84, 0.34]);
  const projection = perspective((58 * Math.PI) / 180, config.width / config.height, 0.08, 360);
  const view = lookAt(camera.eye, camera.target, [0, 1, 0]);
  const lightEye = subtract3(camera.target, scale3(lightDirection, 92));
  const lightView = lookAt(lightEye, camera.target, [0, 1, 0]);
  const lightProjection = orthographic(-camera.extent, camera.extent, -camera.extent, camera.extent, 0.1, 190);
  return {
    viewProjection: multiply4(projection, view),
    lightViewProjection: multiply4(lightProjection, lightView),
    cameraPosition: camera.eye,
    lightDirection,
    fogColor: [0.055, 0.085, 0.14],
    timeSeconds: 17.25,
    quality: {
      id: 'cinematic',
      label: `Metal ${taps}-tap qualification`,
      exposure: 1.1,
      bloomStrength: 0.5,
      fogDensity: 0.006,
      shadowStrength: 1,
      effectBudget: 0,
      resolutionScale: 1,
      sampleCount: config.sampleCount,
      shadowMapSize: config.shadowMapSize,
      shadowTapCount: taps,
    },
  };
}

function createCanvas(width, height) {
  let device = null;
  let format = null;
  let outputTexture = null;
  let textureWidth = 0;
  let textureHeight = 0;
  const canvas = {
    clientWidth: width,
    clientHeight: height,
    width: 0,
    height: 0,
    getContext(kind) {
      return kind === 'webgpu' ? context : null;
    },
  };
  const context = {
    configure(options) {
      device = options.device;
      format = options.format;
    },
    getCurrentTexture() {
      assert.ok(device && format, 'canvas must be configured before getCurrentTexture');
      if (!outputTexture || textureWidth !== canvas.width || textureHeight !== canvas.height) {
        outputTexture?.destroy();
        textureWidth = Math.max(1, canvas.width);
        textureHeight = Math.max(1, canvas.height);
        outputTexture = device.createTexture({
          label: 'Renderer hot-path persistent swapchain texture',
          size: [textureWidth, textureHeight],
          format,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
      }
      return outputTexture;
    },
  };
  return {
    canvas,
    context,
    outputTexture: () => outputTexture,
    format: () => format,
    destroy: () => outputTexture?.destroy(),
  };
}

function compileRenderer(tempRoot, label, rendererSource, ktx2Source) {
  const moduleRoot = path.join(tempRoot, label);
  const webgpuDir = path.join(moduleRoot, 'webgpu');
  const assetsDir = path.join(moduleRoot, 'assets');
  fs.mkdirSync(webgpuDir, { recursive: true });
  fs.mkdirSync(assetsDir, { recursive: true });
  let rendererJavaScript = ts.transpileModule(rendererSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ES2022,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: 'renderer.ts',
  }).outputText;
  rendererJavaScript = rendererJavaScript.replace('../assets/ktx2.js', '../assets/ktx2.mjs');
  const ktx2JavaScript = ts.transpileModule(ktx2Source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
    fileName: 'ktx2.ts',
  }).outputText;
  const rendererPath = path.join(webgpuDir, 'renderer.mjs');
  fs.writeFileSync(rendererPath, rendererJavaScript);
  fs.writeFileSync(path.join(assetsDir, 'ktx2.mjs'), ktx2JavaScript);
  return rendererPath;
}

async function createRenderer(rendererPath, label) {
  const canvasHarness = createCanvas(config.width, config.height);
  const { WebGPURenderer } = await import(`${pathToFileURL(rendererPath).href}?label=${label}&t=${Date.now()}`);
  const renderer = await WebGPURenderer.create(canvasHarness.canvas, config.rigidInstances);
  const errors = [];
  renderer.device.addEventListener?.('uncapturederror', (event) => {
    errors.push(event.error?.message ?? String(event.error));
  });
  return { renderer, canvasHarness, errors };
}

function configureScene(runtime, scene, taps, fixtures) {
  const { renderer } = runtime;
  renderer.writeSceneUniforms(makeSceneState(scene, taps));
  renderer.uploadSurface(null);
  if (scene === 'rigid') {
    renderer.uploadInstances(fixtures.rigid, config.rigidInstances);
    return config.rigidInstances;
  }
  if (scene === 'cloth') {
    renderer.uploadSurface(fixtures.cloth);
    return 0;
  }
  renderer.uploadInstances(fixtures.rigid, config.waterRigidInstances);
  renderer.uploadSurface(fixtures.water);
  return config.waterRigidInstances;
}

const EMPTY_LINES = Object.freeze([]);
const LINE_FRAME_VERSION = 1;

async function renderFrames(runtime, instanceCount, frames) {
  for (let frame = 0; frame < frames; frame++) {
    runtime.renderer.render(instanceCount, EMPTY_LINES, LINE_FRAME_VERSION);
  }
  await runtime.renderer.device.queue.onSubmittedWorkDone();
}

async function measureFrames(runtime, instanceCount, frames) {
  const start = performance.now();
  await renderFrames(runtime, instanceCount, frames);
  return (performance.now() - start) / frames;
}

async function readOutput(runtime) {
  const texture = runtime.canvasHarness.outputTexture();
  assert.ok(texture, 'renderer must produce a swapchain texture before readback');
  const bytesPerPixel = 4;
  const unpaddedBytesPerRow = config.width * bytesPerPixel;
  const bytesPerRow = Math.ceil(unpaddedBytesPerRow / 256) * 256;
  const buffer = runtime.renderer.device.createBuffer({
    label: 'Renderer hot-path pixel readback',
    size: bytesPerRow * config.height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = runtime.renderer.device.createCommandEncoder({ label: 'Renderer hot-path readback encoder' });
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow, rowsPerImage: config.height },
    [config.width, config.height, 1],
  );
  runtime.renderer.device.queue.submit([encoder.finish()]);
  await runtime.renderer.device.queue.onSubmittedWorkDone();
  await buffer.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(buffer.getMappedRange());
  const packed = new Uint8Array(unpaddedBytesPerRow * config.height);
  for (let row = 0; row < config.height; row++) {
    packed.set(mapped.subarray(row * bytesPerRow, row * bytesPerRow + unpaddedBytesPerRow), row * unpaddedBytesPerRow);
  }
  buffer.unmap();
  buffer.destroy();
  return packed;
}

function pixelDifference(baseline, variant) {
  assert.equal(baseline.length, variant.length);
  let differingBytes = 0;
  let differingPixels = 0;
  let maximumChannelError = 0;
  let squaredError = 0;
  for (let index = 0; index < baseline.length; index += 4) {
    let pixelDiffers = false;
    for (let channel = 0; channel < 4; channel++) {
      const error = Math.abs(baseline[index + channel] - variant[index + channel]);
      if (error > 0) {
        differingBytes++;
        pixelDiffers = true;
      }
      maximumChannelError = Math.max(maximumChannelError, error);
      squaredError += error * error;
    }
    if (pixelDiffers) differingPixels++;
  }
  const pixelCount = baseline.length / 4;
  return {
    baselineSha256: sha256(baseline),
    variantSha256: sha256(variant),
    exact: differingBytes === 0,
    differingBytes,
    differingPixels,
    differingPixelRatio: differingPixels / pixelCount,
    maximumChannelError,
    rmse: Math.sqrt(squaredError / baseline.length),
  };
}

function fidelityPassed(fidelity) {
  return fidelity.maximumChannelError <= 2 && fidelity.rmse <= 0.1 && fidelity.differingPixelRatio <= 0.01;
}

async function runExperiment({ candidate, role, scene, taps }, baseline, variant, fixtures, experimentIndex) {
  const baselineCount = configureScene(baseline, scene, taps, fixtures);
  const variantCount = configureScene(variant, scene, taps, fixtures);
  assert.equal(baselineCount, variantCount);

  if (experimentIndex & 1) {
    await renderFrames(variant, variantCount, config.warmupFrames);
    await renderFrames(baseline, baselineCount, config.warmupFrames);
  } else {
    await renderFrames(baseline, baselineCount, config.warmupFrames);
    await renderFrames(variant, variantCount, config.warmupFrames);
  }

  const baselineMsPerFrame = [];
  const variantMsPerFrame = [];
  for (let batch = 0; batch < config.batches; batch++) {
    if (batch & 1) {
      variantMsPerFrame.push(await measureFrames(variant, variantCount, config.framesPerBatch));
      baselineMsPerFrame.push(await measureFrames(baseline, baselineCount, config.framesPerBatch));
    } else {
      baselineMsPerFrame.push(await measureFrames(baseline, baselineCount, config.framesPerBatch));
      variantMsPerFrame.push(await measureFrames(variant, variantCount, config.framesPerBatch));
    }
  }

  await renderFrames(baseline, baselineCount, 1);
  await renderFrames(variant, variantCount, 1);
  const [baselinePixels, variantPixels] = await Promise.all([readOutput(baseline), readOutput(variant)]);
  const fidelity = pixelDifference(baselinePixels, variantPixels);
  const speedup = pairedSpeedup(`${candidate}/${scene}/${taps}`, baselineMsPerFrame, variantMsPerFrame);
  return {
    candidate,
    role,
    scene,
    shadowTapCount: taps,
    instanceCount: baselineCount,
    baselineMsPerFrame,
    variantMsPerFrame,
    baselineStats: stats(baselineMsPerFrame),
    variantStats: stats(variantMsPerFrame),
    speedup: {
      geometricMean: speedup.geometricMean,
      ratioOfMedians: speedup.ratioOfMedians,
      ci95: speedup.ci95,
    },
    fidelity,
    fidelityPassed: fidelityPassed(fidelity),
  };
}

function classifyCandidate(candidate, experiments) {
  const changed = experiments.filter((experiment) => experiment.role === 'changed');
  const controls = experiments.filter((experiment) => experiment.role === 'control');
  const aggregate = aggregateSpeedup(`${candidate}/changed`, changed);
  const controlAggregate = controls.length ? aggregateSpeedup(`${candidate}/controls`, controls) : null;
  const fidelityOk = experiments.every((experiment) => experiment.fidelityPassed);
  let decision;
  let reason;
  if (!fidelityOk) {
    decision = 'revert-correctness';
    reason = 'Rendered output exceeded the bounded pixel-equivalence gate.';
  } else if (controlAggregate && controlAggregate.ci95[1] < 0.995) {
    decision = 'revert-control-regression';
    reason = 'The unchanged control path showed a stable regression.';
  } else if (aggregate.ci95[0] > 1 && aggregate.geometricMean > 1.003) {
    decision = 'keep';
    reason = 'Changed workloads showed a confidence-bounded gain above the 0.3% practical floor.';
  } else if (aggregate.ci95[1] < 1) {
    decision = 'revert-regression';
    reason = 'Changed workloads were stably slower than the exact baseline.';
  } else {
    decision = 'revert-no-stable-benefit';
    reason = 'The measured effect did not clear the predeclared stable-benefit gate.';
  }
  return {
    candidate,
    changedExperimentCount: changed.length,
    controlExperimentCount: controls.length,
    changedAggregate: {
      geometricMean: aggregate.geometricMean,
      ratioOfMedians: aggregate.ratioOfMedians,
      ci95: aggregate.ci95,
    },
    controlAggregate: controlAggregate ? {
      geometricMean: controlAggregate.geometricMean,
      ratioOfMedians: controlAggregate.ratioOfMedians,
      ci95: controlAggregate.ci95,
    } : null,
    fidelityPassed: fidelityOk,
    decision,
    reason,
  };
}

function formatMs(value) {
  return value.toFixed(4);
}

function formatSpeedup(value) {
  return `${value.toFixed(4)}×`;
}

function makeMarkdown(result) {
  const lines = [
    '# Renderer hot-path Metal benchmark',
    '',
    `Generated: ${result.generatedAt}`,
    '',
    '## Scope and integrity',
    '',
    `- Backend: **${result.environment.backend}** on ${result.environment.platform}/${result.environment.arch}`,
    `- Resolution: **${result.environment.width} × ${result.environment.height}**, ${result.environment.sampleCount}× MSAA, ${result.environment.shadowMapSize}² shadow map`,
    `- Material texture: **${result.environment.materialTextureInfo.source}** (${result.environment.materialTextureInfo.sourceBytes} payload bytes)`,
    '- Baseline and variant renderer modules share one Metal `GPUDevice` to remove cross-device offsets.',
    `- Exact archived v1.10 renderer: \`${result.sourceIntegrity.baselineRendererSha256}\``,
    `- Workspace renderer at measurement: \`${result.sourceIntegrity.workspaceRendererSha256}\` (${result.sourceIntegrity.workspaceRendererVariant})`,
    '- Candidate-source isolation: **passed** (mechanically derived from the exact archive: 4 PCF moves, 5 fog rewrites, and 1 depth-store change).',
    `- Timing: ${result.environment.batches} alternating paired batches × ${result.environment.framesPerBatch} frames; every batch ends with \`queue.onSubmittedWorkDone()\`.`,
    '',
    '## Candidate verdicts',
    '',
    '| Candidate | Changed-path speedup | Paired 95% interval | Controls | Fidelity | Decision |',
    '|---|---:|---:|---:|---:|---|',
  ];
  for (const summary of result.candidateSummaries) {
    const controls = summary.controlAggregate
      ? `${formatSpeedup(summary.controlAggregate.geometricMean)} [${summary.controlAggregate.ci95.map((value) => value.toFixed(4)).join(', ')}]`
      : 'n/a';
    lines.push(`| ${summary.candidate} | ${formatSpeedup(summary.changedAggregate.geometricMean)} | ${summary.changedAggregate.ci95.map((value) => value.toFixed(4)).join('–')} | ${controls} | ${summary.fidelityPassed ? 'pass' : 'fail'} | **${summary.decision}** |`);
  }
  lines.push(
    '',
    '## Per-workload results',
    '',
    '| Candidate | Scene | Taps | Role | Baseline ms | Variant ms | Speedup | Paired 95% interval | Max pixel error | RMSE |',
    '|---|---|---:|---|---:|---:|---:|---:|---:|---:|',
  );
  for (const experiment of result.experiments) {
    lines.push(`| ${experiment.candidate} | ${experiment.scene} | ${experiment.shadowTapCount} | ${experiment.role} | ${formatMs(experiment.baselineStats.median)} | ${formatMs(experiment.variantStats.median)} | ${formatSpeedup(experiment.speedup.geometricMean)} | ${experiment.speedup.ci95.map((value) => value.toFixed(4)).join('–')} | ${experiment.fidelity.maximumChannelError} | ${experiment.fidelity.rmse.toFixed(6)} |`);
  }
  lines.push(
    '',
    '## Interpretation',
    '',
    ...result.candidateSummaries.map((summary) => `- **${summary.candidate}: ${summary.decision}.** ${summary.reason}`),
    '',
    'The measurements use the actual production `WebGPURenderer` source transpiled directly from the archived baseline and mechanically derived variants. Wall time includes JavaScript command encoding, submission, Metal execution, and queue completion; it is intentionally not represented as a pure shader timestamp.',
    '',
    '## Reproduce',
    '',
    '```bash',
    `RENDERER_HOTPATH_CANDIDATES=${result.environment.selectedCandidates.join(',')} \\`,
    `RENDERER_HOTPATH_WARMUPS=${result.environment.warmupFrames} \\`,
    `RENDERER_HOTPATH_BATCHES=${result.environment.batches} \\`,
    `RENDERER_HOTPATH_FRAMES_PER_BATCH=${result.environment.framesPerBatch} \\`,
    `RENDERER_HOTPATH_OUTPUT=${result.environment.outputBasename} \\`,
    'node benchmarks/renderer-hotpath-metal.mjs',
    '```',
    '',
    'Environment overrides: `RENDERER_HOTPATH_WIDTH`, `RENDERER_HOTPATH_HEIGHT`, `RENDERER_HOTPATH_WARMUPS`, `RENDERER_HOTPATH_BATCHES`, `RENDERER_HOTPATH_FRAMES_PER_BATCH`, and `RENDERER_HOTPATH_BOOTSTRAPS`.',
    '',
  );
  return lines.join('\n');
}

const candidatePlans = [
  ...(process.env.RENDERER_HOTPATH_WORKSPACE_ONLY === '1' ? [{
    id: 'workspace-current',
    cases: [
      { scene: 'rigid', taps: 1, role: 'changed' },
      { scene: 'cloth', taps: 1, role: 'control' },
      { scene: 'water', taps: 1, role: 'control' },
      { scene: 'rigid', taps: 9, role: 'changed' },
      { scene: 'cloth', taps: 9, role: 'control' },
      { scene: 'water', taps: 9, role: 'control' },
    ],
  }] : []),
  {
    id: 'pcf-center-sample',
    cases: [
      { scene: 'rigid', taps: 1, role: 'control' },
      { scene: 'rigid', taps: 9, role: 'changed' },
      { scene: 'cloth', taps: 9, role: 'changed' },
      { scene: 'water', taps: 9, role: 'changed' },
    ],
  },
  {
    id: 'squared-distance-fog',
    cases: [
      { scene: 'rigid', taps: 1, role: 'changed' },
      { scene: 'cloth', taps: 1, role: 'changed' },
      { scene: 'water', taps: 1, role: 'changed' },
    ],
  },
  {
    id: 'hdr-depth-discard',
    cases: [
      { scene: 'rigid', taps: 1, role: 'changed' },
      { scene: 'cloth', taps: 1, role: 'changed' },
      { scene: 'water', taps: 1, role: 'changed' },
    ],
  },
  {
    id: 'three-edit-combined-candidate',
    cases: [
      { scene: 'rigid', taps: 1, role: 'changed' },
      { scene: 'cloth', taps: 1, role: 'changed' },
      { scene: 'water', taps: 1, role: 'changed' },
      { scene: 'rigid', taps: 9, role: 'changed' },
      { scene: 'cloth', taps: 9, role: 'changed' },
      { scene: 'water', taps: 9, role: 'changed' },
    ],
  },
];

async function main() {
  assert.ok(fs.existsSync(archivePath), `missing exact baseline archive: ${archivePath}`);
  const archiveBuffer = fs.readFileSync(archivePath);
  assert.equal(sha256(archiveBuffer), expected.archiveSha256, 'exact v1.10 baseline archive checksum changed');

  const baselineRendererSource = archiveText('src/webgpu/renderer.ts');
  const baselineKtx2Source = archiveText('src/assets/ktx2.ts');
  const workspaceRendererSource = fs.readFileSync(path.join(root, 'src/webgpu/renderer.ts'), 'utf8');
  const optimizedKtx2Source = fs.readFileSync(path.join(root, 'src/assets/ktx2.ts'), 'utf8');
  assert.equal(sha256(baselineRendererSource), expected.baselineRendererSha256);
  assert.equal(sha256(baselineKtx2Source), expected.ktx2Sha256);
  assert.equal(sha256(optimizedKtx2Source), expected.ktx2Sha256);
  assert.equal(baselineKtx2Source, optimizedKtx2Source, 'KTX2 dependency must remain byte-identical');

  const workspaceOnly = process.env.RENDERER_HOTPATH_WORKSPACE_ONLY === '1';
  const pcfSource = workspaceOnly ? null : applyPcfEdit(baselineRendererSource);
  const fogSource = workspaceOnly ? null : applyFogEdit(baselineRendererSource);
  const depthSource = workspaceOnly ? null : applyDepthDiscardEdit(baselineRendererSource);
  const combinedSource = workspaceOnly ? null : applyDepthDiscardEdit(applyFogEdit(applyPcfEdit(baselineRendererSource)));
  if (!workspaceOnly) assert.equal(sha256(pcfSource), expected.pcfRendererSha256, 'mechanically isolated PCF candidate checksum changed');
  const workspaceRendererVariant = workspaceRendererSource === baselineRendererSource
    ? 'exact-v1.10'
    : pcfSource !== null && workspaceRendererSource === pcfSource
      ? 'pcf-candidate'
      : 'other-workspace-state';

  const variantSources = new Map([
    ['workspace-current', workspaceRendererSource],
    ['pcf-center-sample', pcfSource],
    ['squared-distance-fog', fogSource],
    ['hdr-depth-discard', depthSource],
    ['three-edit-combined-candidate', combinedSource],
  ]);

  const requestedCandidates = (process.env.RENDERER_HOTPATH_CANDIDATES ?? candidatePlans.map((plan) => plan.id).join(','))
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const unknownCandidates = requestedCandidates.filter((candidate) => !candidatePlans.some((plan) => plan.id === candidate));
  assert.deepEqual(unknownCandidates, [], `unknown renderer candidates: ${unknownCandidates.join(', ')}`);
  const selectedPlans = candidatePlans.filter((plan) => requestedCandidates.includes(plan.id));
  assert.ok(selectedPlans.length > 0, 'at least one renderer candidate must be selected');

  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'box3d-renderer-hotpath-'));
  let gpu;
  let sharedDevice;
  let baselineRuntime;
  const experiments = [];
  const runtimeErrors = [];
  const startedAt = performance.now();
  try {
    const baselineModule = compileRenderer(tempRoot, 'baseline', baselineRendererSource, baselineKtx2Source);
    const variantModules = new Map();
    for (const [label, source] of variantSources) {
      if (!requestedCandidates.includes(label)) continue;
      variantModules.set(label, compileRenderer(tempRoot, label, source, baselineKtx2Source));
    }

    gpu = create([`backend=${config.backend}`]);
    const physicalAdapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
    assert.ok(physicalAdapter, `no WebGPU adapter for ${config.backend}`);
    const supportsBc = physicalAdapter.features?.has('texture-compression-bc') ?? false;
    sharedDevice = await physicalAdapter.requestDevice({ requiredFeatures: supportsBc ? ['texture-compression-bc'] : [] });
    // Both exact renderer modules must execute on the same GPUDevice. Using a
    // device per module produced a false 14% speedup in the byte-identical
    // 1-tap control, large enough to swamp the shader edit being qualified.
    const sharedAdapter = {
      features: physicalAdapter.features,
      limits: physicalAdapter.limits,
      info: physicalAdapter.info,
      requestDevice: async () => sharedDevice,
    };
    const benchmarkGpu = {
      requestAdapter: async () => sharedAdapter,
      getPreferredCanvasFormat: () => gpu.getPreferredCanvasFormat(),
    };
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: benchmarkGpu } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async (input) => {
        const url = input instanceof URL ? input : new URL(String(input));
        const filename = path.basename(url.pathname);
        const assetPath = path.join(root, 'public/textures', filename);
        if (!/^material-noise-(bc4|r8)\.ktx2$/.test(filename) || !fs.existsSync(assetPath)) {
          return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) };
        }
        const bytes = fs.readFileSync(assetPath);
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        };
      },
    });

    const fixtures = {
      rigid: createRigidSource(config.rigidInstances),
      cloth: createClothSurface(),
      water: createWaterSurface(),
    };
    baselineRuntime = await createRenderer(baselineModule, 'baseline');
    const materialTextureInfo = baselineRuntime.renderer.materialTextureInfo();
    assert.match(materialTextureInfo.source, /^ktx2-(bc4|r8)$/, 'benchmark must use the production KTX2 material path');
    let experimentIndex = 0;
    for (const plan of selectedPlans) {
      const variantRuntime = await createRenderer(variantModules.get(plan.id), plan.id);
      assert.deepEqual(variantRuntime.renderer.materialTextureInfo(), materialTextureInfo, `${plan.id} must use the same KTX2 texture path as the baseline`);
      try {
        for (const testCase of plan.cases) {
          const experiment = await runExperiment(
            { candidate: plan.id, ...testCase },
            baselineRuntime,
            variantRuntime,
            fixtures,
            experimentIndex++,
          );
          experiments.push(experiment);
          process.stdout.write(
            `${plan.id.padEnd(27)} ${testCase.scene.padEnd(5)} ${testCase.taps}-tap ` +
            `${formatSpeedup(experiment.speedup.geometricMean)} ` +
            `[${experiment.speedup.ci95.map((value) => value.toFixed(4)).join(', ')}] ` +
            `pixels max=${experiment.fidelity.maximumChannelError}\n`,
          );
        }
      } finally {
        runtimeErrors.push(...variantRuntime.errors.map((message) => `${plan.id}: ${message}`));
        variantRuntime.canvasHarness.destroy();
      }
    }
    runtimeErrors.push(...baselineRuntime.errors.map((message) => `baseline: ${message}`));

    const candidateSummaries = selectedPlans.map((plan) =>
      classifyCandidate(plan.id, experiments.filter((experiment) => experiment.candidate === plan.id)),
    );
    const result = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      elapsedSeconds: (performance.now() - startedAt) / 1000,
      environment: {
        backend: config.backend,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        width: config.width,
        height: config.height,
        sampleCount: config.sampleCount,
        shadowMapSize: config.shadowMapSize,
        rigidInstances: config.rigidInstances,
        waterRigidInstances: config.waterRigidInstances,
        warmupFrames: config.warmupFrames,
        batches: config.batches,
        framesPerBatch: config.framesPerBatch,
        measuredFramesPerVariantPerExperiment: config.batches * config.framesPerBatch,
        bootstrapSamples: config.bootstrapSamples,
        outputBasename,
        selectedCandidates: selectedPlans.map((plan) => plan.id),
        synchronization: 'GPUQueue.onSubmittedWorkDone after every warm-up/timed batch',
        sharedGpuDeviceAcrossVariants: true,
        materialTextureInfo,
        runtimeErrors,
      },
      sourceIntegrity: {
        archivePath: path.relative(root, archivePath),
        archiveSha256: sha256(archiveBuffer),
        baselineRendererSha256: sha256(baselineRendererSource),
        workspaceRendererSha256: sha256(workspaceRendererSource),
        workspaceRendererVariant,
        ktx2Sha256: sha256(baselineKtx2Source),
        currentEqualsMechanicalPcfVariant: pcfSource === workspaceRendererSource,
        isolatedEdits: {
          pcfCenterSampleMoves: 4,
          squaredDistanceFogRewrites: 5,
          hdrDepthStoreChanges: 1,
        },
        variantSha256: Object.fromEntries(
          [...variantSources]
            .filter(([, source]) => source !== null)
            .map(([label, source]) => [label, sha256(source)]),
        ),
      },
      gates: {
        practicalSpeedupFloor: 1.003,
        stableSpeedupRequiresLowerCiAbove: 1,
        controlRegressionUpperCiBelow: 0.995,
        maximumPixelChannelError: 2,
        maximumPixelRmse: 0.1,
        maximumDifferingPixelRatio: 0.01,
      },
      candidateSummaries,
      experiments,
    };
    assert.deepEqual(runtimeErrors, [], `uncaptured WebGPU errors:\n${runtimeErrors.join('\n')}`);
    fs.mkdirSync(path.dirname(resultsPath), { recursive: true });
    fs.writeFileSync(resultsPath, `${JSON.stringify(result, null, 2)}\n`);
    fs.writeFileSync(reportPath, makeMarkdown(result));
    process.stdout.write(`\nWrote ${path.relative(root, resultsPath)}\nWrote ${path.relative(root, reportPath)}\n`);
    for (const summary of candidateSummaries) {
      process.stdout.write(`${summary.candidate}: ${summary.decision} (${formatSpeedup(summary.changedAggregate.geometricMean)})\n`);
    }
  } finally {
    baselineRuntime?.canvasHarness.destroy();
    sharedDevice?.destroy?.();
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

await main();
