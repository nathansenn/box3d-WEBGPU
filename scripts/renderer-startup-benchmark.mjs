import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { create, globals } from 'webgpu';
import { emitTypeScriptModuleTree } from './emit-typescript-module-tree.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const currentRoot = path.resolve(path.dirname(scriptPath), '..');
// Dawn backend for the physical adapter; Metal on macOS (the default), Vulkan on Linux GPU hosts.
const dawnBackend = process.env.WEBGPU_DAWN_BACKEND ?? 'metal';

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length & 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) * 0.5;
}

function mad(values) {
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

async function childMain(root) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-renderer-startup-'));
  try {
    const { entryPath: rendererPath } = emitTypeScriptModuleTree({
      sourceRoot: path.join(root, 'src'),
      outputRoot: tempDir,
      entry: 'webgpu/renderer.ts',
    });

    Object.assign(globalThis, globals);
    const gpu = create([`backend=${dawnBackend}`]);
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu } });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: async () => { throw new Error('startup benchmark uses deterministic procedural texture fallback'); },
    });
    console.warn = () => {};

    let configuredDevice;
    let configuredFormat;
    let currentTexture;
    const canvas = {
      clientWidth: 1280,
      clientHeight: 720,
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
          size: [Math.max(1, canvas.width), Math.max(1, canvas.height)],
          format: configuredFormat,
          usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        return currentTexture;
      },
    };

    const { WebGPURenderer } = await import(`${pathToFileURL(rendererPath).href}?v=${Date.now()}`);
    const start = performance.now();
    const renderer = await WebGPURenderer.create(canvas, 4096);
    await renderer.device.queue.onSubmittedWorkDone();
    const createMs = performance.now() - start;
    const errors = [];
    renderer.device.addEventListener?.('uncapturederror', (event) => errors.push(event.error?.message ?? String(event.error)));
    assert.deepEqual(errors, []);
    if (renderer.dispose) renderer.dispose();
    else renderer.device.destroy();
    process.stdout.write(`${JSON.stringify({ createMs })}\n`);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

if (process.argv[2] === '--child') {
  await childMain(path.resolve(process.argv[3]));
} else {
  const baselineArchive = path.join(currentRoot, 'benchmarks/baselines/box3d-webgpu-v1.9.0-integration-source.tar.gz');
  const baselineTemp = process.env.RENDERER_BASELINE_ROOT ? null : fs.mkdtempSync(path.join(os.tmpdir(), 'webphysics-renderer-baseline-'));
  const baselineRoot = process.env.RENDERER_BASELINE_ROOT ? path.resolve(process.env.RENDERER_BASELINE_ROOT) : baselineTemp;
  if (baselineTemp) execFileSync('tar', ['-xzf', baselineArchive, '-C', baselineTemp]);
  const samples = Math.max(3, Number(process.env.RENDERER_STARTUP_SAMPLES ?? 5));
  try {
    for (const sourceRoot of [baselineRoot, currentRoot]) {
      if (!fs.existsSync(path.join(sourceRoot, 'src/webgpu/renderer.ts'))) throw new Error(`Renderer source is missing in ${sourceRoot}`);
    }
    const measured = { baseline: [], optimized: [] };
    for (let sample = 0; sample < samples; sample++) {
      const order = sample & 1
        ? [['optimized', currentRoot], ['baseline', baselineRoot]]
        : [['baseline', baselineRoot], ['optimized', currentRoot]];
      for (const [label, sourceRoot] of order) {
        const output = execFileSync(process.execPath, [scriptPath, '--child', sourceRoot], {
          encoding: 'utf8',
          env: process.env,
          maxBuffer: 1024 * 1024,
        }).trim();
        measured[label].push(JSON.parse(output).createMs);
      }
    }
    const baselineMedian = median(measured.baseline);
    const optimizedMedian = median(measured.optimized);
    const rendererSha256 = crypto.createHash('sha256')
      .update(fs.readFileSync(path.join(currentRoot, 'src/webgpu/renderer.ts')))
      .digest('hex');
    const evidence = {
      rendererSha256,
      environment: { backend: dawnBackend, samples, canvas: [1280, 720], maxInstances: 4096, freshProcesses: true },
      baseline: {
        source: process.env.RENDERER_BASELINE_ROOT ?? path.relative(currentRoot, baselineArchive),
        samplesMs: measured.baseline,
        medianMs: baselineMedian,
        madMs: mad(measured.baseline),
      },
      optimized: { root: currentRoot, samplesMs: measured.optimized, medianMs: optimizedMedian, madMs: mad(measured.optimized) },
      optimizedOverBaseline: optimizedMedian / baselineMedian,
    };
    const outputPath = path.join(currentRoot, process.env.RENDERER_STARTUP_OUT ?? `benchmarks/results/renderer-startup-${dawnBackend}.json`);
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(JSON.stringify(evidence, null, 2));
    console.log(`Wrote ${outputPath}`);
  } finally {
    if (baselineTemp) fs.rmSync(baselineTemp, { recursive: true, force: true });
  }
}
