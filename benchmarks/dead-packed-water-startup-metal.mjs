import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import { create, globals } from 'webgpu';

const scriptPath = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(scriptPath), '..');
const baselineArchive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz');
const resultPath = path.join(root, 'benchmarks/results/dead-packed-water-startup-metal.json');

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function mad(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

function replaceOnce(source, search, replacement, label) {
  const first = source.indexOf(search);
  assert.notEqual(first, -1, `missing ${label}`);
  assert.equal(source.indexOf(search, first + search.length), -1, `ambiguous ${label}`);
  return `${source.slice(0, first)}${replacement}${source.slice(first + search.length)}`;
}

/** Rebuild the exact pre-edit startup topology from the current source. The
 * only injected work is the archived packed-water WGSL module, its 1x/4x
 * pipelines, and its unreachable dispatch branch. This avoids conflating the
 * comparison with any other renderer improvement made after v1.10. */
function addDeadPackedWaterControl(currentSource, archivedSource) {
  const shaderStart = archivedSource.indexOf('const waterShader = /* wgsl */ `');
  const shaderEnd = archivedSource.indexOf('const gpuClothShadowShader = /* wgsl */ `', shaderStart);
  assert.ok(shaderStart >= 0 && shaderEnd > shaderStart, 'archived packed-water WGSL block must exist');
  const waterShaderBlock = archivedSource.slice(shaderStart, shaderEnd);

  const descriptorStart = archivedSource.indexOf('    const waterDescriptor: GPURenderPipelineDescriptor = {');
  const descriptorEnd = archivedSource.indexOf('    const gpuClothDescriptor: GPURenderPipelineDescriptor = {', descriptorStart);
  assert.ok(descriptorStart >= 0 && descriptorEnd > descriptorStart, 'archived packed-water descriptor must exist');
  const waterDescriptorBlock = archivedSource.slice(descriptorStart, descriptorEnd);

  let source = currentSource;
  source = replaceOnce(
    source,
    'const gpuClothShadowShader = /* wgsl */ `',
    `${waterShaderBlock}const gpuClothShadowShader = /* wgsl */ \``,
    'GPU cloth shadow shader insertion point',
  );
  source = replaceOnce(
    source,
    '  cloth: GPURenderPipeline;\n',
    '  cloth: GPURenderPipeline;\n  water: GPURenderPipeline;\n',
    'main pipeline type insertion point',
  );
  source = replaceOnce(
    source,
    "    const clothModule = device.createShaderModule({ label: 'AAA woven cloth shader', code: clothShader });\n",
    "    const clothModule = device.createShaderModule({ label: 'AAA woven cloth shader', code: clothShader });\n    const waterModule = device.createShaderModule({ label: 'AAA interactive water shader', code: waterShader });\n",
    'water shader module insertion point',
  );
  source = replaceOnce(
    source,
    "      validateShaderModule(clothModule, 'Woven cloth shader'),\n",
    "      validateShaderModule(clothModule, 'Woven cloth shader'),\n      validateShaderModule(waterModule, 'Interactive water shader'),\n",
    'water shader validation insertion point',
  );
  source = replaceOnce(
    source,
    '    const gpuClothDescriptor: GPURenderPipelineDescriptor = {',
    `${waterDescriptorBlock}    const gpuClothDescriptor: GPURenderPipelineDescriptor = {`,
    'water pipeline descriptor insertion point',
  );
  source = replaceOnce(
    source,
    '      clothDescriptor,\n      gpuClothDescriptor,',
    '      clothDescriptor,\n      waterDescriptor,\n      gpuClothDescriptor,',
    'main descriptor insertion point',
  );
  source = replaceOnce(
    source,
    '      cloth: pipelinesForSampleCount[2]!,\n      gpuCloth: pipelinesForSampleCount[3]!,\n      gpuWater: pipelinesForSampleCount[4]!,\n      line: pipelinesForSampleCount[5]!,',
    '      cloth: pipelinesForSampleCount[2]!,\n      water: pipelinesForSampleCount[3]!,\n      gpuCloth: pipelinesForSampleCount[4]!,\n      gpuWater: pipelinesForSampleCount[5]!,\n      line: pipelinesForSampleCount[6]!,',
    'main pipeline mapping insertion point',
  );
  source = replaceOnce(
    source,
    '        mainPass.setPipeline(this.mainPipelines.cloth);\n        mainPass.setVertexBuffer(0, this.surfaceVertexBuffer);',
    "        mainPass.setPipeline(this.surfaceMaterial === 'cloth' ? this.mainPipelines.cloth : this.mainPipelines.water);\n        mainPass.setVertexBuffer(0, this.surfaceVertexBuffer);",
    'packed-water dispatch insertion point',
  );
  return source;
}

function instrumentGpu(rawGpu, counts) {
  const wrapDevice = (rawDevice) => new Proxy(rawDevice, {
    get(target, property) {
      if (property === 'createShaderModule') return (...args) => {
        counts.shaderModules++;
        return target.createShaderModule(...args);
      };
      if (property === 'createRenderPipeline') return (...args) => {
        counts.renderPipelines++;
        return target.createRenderPipeline(...args);
      };
      if (property === 'createRenderPipelineAsync') return (...args) => {
        counts.renderPipelines++;
        return target.createRenderPipelineAsync(...args);
      };
      if (property === 'createComputePipeline') return (...args) => {
        counts.computePipelines++;
        return target.createComputePipeline(...args);
      };
      if (property === 'createComputePipelineAsync') return (...args) => {
        counts.computePipelines++;
        return target.createComputePipelineAsync(...args);
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const wrapAdapter = (rawAdapter) => new Proxy(rawAdapter, {
    get(target, property) {
      if (property === 'requestDevice') return async (...args) => wrapDevice(await target.requestDevice(...args));
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  return new Proxy(rawGpu, {
    get(target, property) {
      if (property === 'requestAdapter') return async (...args) => {
        const adapter = await target.requestAdapter(...args);
        return adapter ? wrapAdapter(adapter) : null;
      };
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

function fnv1a(bytes, width, height, bytesPerRow) {
  let hash = 0x811c9dc5;
  for (let y = 0; y < height; y++) {
    const rowStart = y * bytesPerRow;
    for (let x = 0; x < width * 4; x++) {
      hash ^= bytes[rowStart + x];
      hash = Math.imul(hash, 0x01000193);
    }
  }
  return hash >>> 0;
}

async function readTextureHash(device, texture, width, height) {
  const bytesPerRow = Math.ceil(width * 4 / 256) * 256;
  const buffer = device.createBuffer({
    label: 'dead packed-water benchmark readback',
    size: bytesPerRow * height,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder();
  encoder.copyTextureToBuffer(
    { texture },
    { buffer, bytesPerRow, rowsPerImage: height },
    [width, height, 1],
  );
  device.queue.submit([encoder.finish()]);
  await buffer.mapAsync(GPUMapMode.READ);
  const bytes = new Uint8Array(buffer.getMappedRange());
  const hash = fnv1a(bytes, width, height, bytesPerRow);
  buffer.unmap();
  buffer.destroy();
  return hash;
}

async function runChild(variant, archivedRendererPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-packed-water-startup-'));
  try {
    const webgpuDir = path.join(tempDir, 'webgpu');
    const assetsDir = path.join(tempDir, 'assets');
    fs.mkdirSync(webgpuDir, { recursive: true });
    fs.mkdirSync(assetsDir, { recursive: true });
    const currentSource = fs.readFileSync(path.join(root, 'src/webgpu/renderer.ts'), 'utf8');
    const archivedSource = fs.readFileSync(archivedRendererPath, 'utf8');
    const rendererSource = variant === 'control'
      ? addDeadPackedWaterControl(currentSource, archivedSource)
      : currentSource;
    const ktx2Source = fs.readFileSync(path.join(root, 'src/assets/ktx2.ts'), 'utf8');
    const transpile = (source, fileName) => ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ES2022,
        importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
      },
      fileName,
    }).outputText;
    const rendererPath = path.join(webgpuDir, 'renderer.mjs');
    fs.writeFileSync(rendererPath, transpile(rendererSource, 'renderer.ts').replace('../assets/ktx2.js', '../assets/ktx2.mjs'));
    fs.writeFileSync(path.join(assetsDir, 'ktx2.mjs'), transpile(ktx2Source, 'ktx2.ts'));

    Object.assign(globalThis, globals);
    const counts = { shaderModules: 0, renderPipelines: 0, computePipelines: 0 };
    const rawGpu = create(['backend=metal']);
    const gpu = instrumentGpu(rawGpu, counts);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => { throw new Error('benchmark intentionally selects deterministic procedural texture fallback'); },
    });
    console.warn = () => {};

    let configuredDevice;
    let configuredFormat;
    let currentTexture;
    const canvas = {
      clientWidth: 128,
      clientHeight: 96,
      width: 0,
      height: 0,
      getContext(kind) { return kind === 'webgpu' ? context : null; },
    };
    const context = {
      configure(options) {
        configuredDevice = options.device;
        configuredFormat = options.format;
      },
      getCurrentTexture() {
        currentTexture?.destroy();
        currentTexture = configuredDevice.createTexture({
          label: 'dead packed-water benchmark swapchain',
          size: [Math.max(1, canvas.width), Math.max(1, canvas.height)],
          format: configuredFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
        });
        return currentTexture;
      },
    };

    const { WebGPURenderer } = await import(`${pathToFileURL(rendererPath).href}?variant=${variant}&v=${Date.now()}`);
    const start = performance.now();
    const renderer = await WebGPURenderer.create(canvas, 64);
    await renderer.device.queue.onSubmittedWorkDone();
    const createMs = performance.now() - start;
    const startupCounts = { ...counts };
    const errors = [];
    renderer.device.addEventListener?.('uncapturederror', (event) => errors.push(event.error?.message ?? String(event.error)));

    const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
    renderer.writeSceneUniforms({
      viewProjection: identity,
      lightViewProjection: identity,
      cameraPosition: [0, 2, 5],
      lightDirection: [0.42, -0.84, 0.34],
      fogColor: [0.055, 0.085, 0.14],
      timeSeconds: 1,
      quality: {
        id: 'cinematic', label: 'Cinematic', exposure: 1.1, bloomStrength: 0.5,
        fogDensity: 0.006, shadowStrength: 1, effectBudget: 64, resolutionScale: 1,
        sampleCount: 4, shadowMapSize: 2048, shadowTapCount: 9,
      },
    });

    const packedVertices = new Uint8Array(4 * 24);
    const packedView = new DataView(packedVertices.buffer);
    const positions = [[-0.75, -0.25, 0], [0.75, -0.25, 0], [-0.75, 0.75, 0], [0.75, 0.75, 0]];
    for (let index = 0; index < positions.length; index++) {
      const offset = index * 24;
      packedView.setFloat32(offset, positions[index][0], true);
      packedView.setFloat32(offset + 4, positions[index][1], true);
      packedView.setFloat32(offset + 8, positions[index][2], true);
      packedView.setInt16(offset + 12, 0, true);
      packedView.setInt16(offset + 14, 0, true);
      packedView.setUint8(offset + 16, 40 + index * 25);
      packedView.setUint8(offset + 17, 100 + index * 20);
      packedView.setUint8(offset + 18, 220);
      packedView.setUint8(offset + 19, 96 + index * 20);
      packedView.setUint16(offset + 20, (index & 1) ? 65535 : 0, true);
      packedView.setUint16(offset + 22, index > 1 ? 65535 : 0, true);
    }
    const indices = new Uint16Array([0, 1, 2, 1, 3, 2]);
    const packedBytes = renderer.uploadSurface({
      path: 'packed', material: 'cloth', vertices: packedVertices, indices,
      vertexStride: 24, vertexCount: 4, indexCount: 6, topologyVersion: 1, frameVersion: 1,
    });
    assert.equal(packedBytes, packedVertices.byteLength + indices.byteLength);
    const packedRenderMs = renderer.render(0, []);
    await renderer.device.queue.onSubmittedWorkDone();
    const packedHash = await readTextureHash(renderer.device, currentTexture, canvas.width, canvas.height);

    const gpuWater = {
      path: 'gpu-water', material: 'water',
      eta: new Float32Array([0, 0.08, -0.04, 0.02]),
      u: new Float32Array([0.1, 0.2, 0.1, 0]),
      v: new Float32Array([0, -0.1, 0.1, 0.2]),
      indices, vertexCount: 4, indexCount: 6, topologyVersion: 1, frameVersion: 2,
      cols: 2, rows: 2, width: 1.4, depth: 1.4, baseY: 0.1,
    };
    const waterBytes = renderer.uploadSurface(gpuWater);
    assert.equal(waterBytes, 4 * 12);
    const waterRenderMs = renderer.render(0, []);
    await renderer.device.queue.onSubmittedWorkDone();
    const waterHash = await readTextureHash(renderer.device, currentTexture, canvas.width, canvas.height);
    assert.ok(Number.isFinite(packedRenderMs) && packedRenderMs >= 0);
    assert.ok(Number.isFinite(waterRenderMs) && waterRenderMs >= 0);
    assert.deepEqual(errors, []);
    assert.equal(counts.shaderModules, startupCounts.shaderModules, 'rendering must not lazily create shader modules');
    assert.equal(counts.renderPipelines, startupCounts.renderPipelines, 'rendering must not lazily create pipelines');

    currentTexture?.destroy();
    renderer.device.destroy();
    process.stdout.write(`${JSON.stringify({
      variant, createMs, startupCounts,
      runtime: { packedBytes, waterBytes, packedRenderMs, waterRenderMs, packedHash, waterHash, uncapturedErrors: errors },
    })}\n`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--child') {
  await runChild(process.argv[3], path.resolve(process.argv[4]));
} else {
  assert.ok(fs.existsSync(baselineArchive), `missing archived v1.10 source: ${baselineArchive}`);
  const baselineTemp = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-packed-water-v110-'));
  try {
    execFileSync('tar', ['-xzf', baselineArchive, '-C', baselineTemp]);
    const archivedRendererPath = path.join(baselineTemp, 'src/webgpu/renderer.ts');
    assert.ok(fs.existsSync(archivedRendererPath), 'archived renderer source must exist');
    const samples = Math.max(5, Number(process.env.DEAD_WATER_STARTUP_SAMPLES ?? 9));
    const measurements = { control: [], optimized: [] };
    const runtimeResults = { control: [], optimized: [] };
    for (let sample = 0; sample < samples; sample++) {
      const order = sample & 1 ? ['optimized', 'control'] : ['control', 'optimized'];
      for (const variant of order) {
        const output = execFileSync(process.execPath, [scriptPath, '--child', variant, archivedRendererPath], {
          encoding: 'utf8', env: process.env, maxBuffer: 2 * 1024 * 1024,
        }).trim();
        const result = JSON.parse(output);
        measurements[variant].push(result.createMs);
        runtimeResults[variant].push(result);
      }
    }

    const controlCounts = runtimeResults.control[0].startupCounts;
    const optimizedCounts = runtimeResults.optimized[0].startupCounts;
    for (const result of [...runtimeResults.control, ...runtimeResults.optimized]) {
      assert.deepEqual(result.startupCounts, result.variant === 'control' ? controlCounts : optimizedCounts);
      assert.equal(result.runtime.uncapturedErrors.length, 0);
    }
    const controlHashes = runtimeResults.control.map(({ runtime }) => [runtime.packedHash, runtime.waterHash]);
    const optimizedHashes = runtimeResults.optimized.map(({ runtime }) => [runtime.packedHash, runtime.waterHash]);
    for (const hashes of [...controlHashes, ...optimizedHashes]) assert.deepEqual(hashes, controlHashes[0]);

    const pipelineReduction = {
      shaderModules: controlCounts.shaderModules - optimizedCounts.shaderModules,
      renderPipelines: controlCounts.renderPipelines - optimizedCounts.renderPipelines,
      computePipelines: controlCounts.computePipelines - optimizedCounts.computePipelines,
    };
    assert.deepEqual(pipelineReduction, { shaderModules: 1, renderPipelines: 2, computePipelines: 0 });
    const controlMedian = median(measurements.control);
    const optimizedMedian = median(measurements.optimized);
    const evidence = {
      passed: true,
      comparison: 'current renderer plus archived dead packed-water path vs current renderer',
      backend: 'Dawn Metal',
      freshProcessSamplesPerVariant: samples,
      pipelineReduction,
      baselineStartupMedianMs: controlMedian,
      optimizedStartupMedianMs: optimizedMedian,
      startupSpeedup: controlMedian / optimizedMedian,
      startupReductionPercent: (1 - optimizedMedian / controlMedian) * 100,
      startup: {
        controlWithDeadPackedWater: { samplesMs: measurements.control, medianMs: controlMedian, madMs: mad(measurements.control) },
        optimizedWithoutDeadPackedWater: { samplesMs: measurements.optimized, medianMs: optimizedMedian, madMs: mad(measurements.optimized) },
      },
      resourceCounts: { control: controlCounts, optimized: optimizedCounts },
      exactRuntimeValidation: {
        samplesPerVariant: samples,
        packedClothUploadBytes: runtimeResults.optimized[0].runtime.packedBytes,
        gpuWaterUploadBytes: runtimeResults.optimized[0].runtime.waterBytes,
        packedClothPixelHash: runtimeResults.optimized[0].runtime.packedHash,
        gpuWaterPixelHash: runtimeResults.optimized[0].runtime.waterHash,
        controlAndOptimizedPixelHashesExact: true,
        uncapturedWebGpuErrors: 0,
      },
      retentionGate: {
        startupMeasurablyFaster: optimizedMedian + mad(measurements.optimized) < controlMedian - mad(measurements.control),
        resourceAndPipelineWorkStrictlyEliminated: true,
        retainedBecause: 'one WGSL module and two render pipelines are strictly eliminated with exact rendered-frame hashes',
      },
    };
    fs.mkdirSync(path.dirname(resultPath), { recursive: true });
    fs.writeFileSync(resultPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
    console.log(`Wrote ${resultPath}`);
  } finally {
    fs.rmSync(baselineTemp, { recursive: true, force: true });
  }
}
