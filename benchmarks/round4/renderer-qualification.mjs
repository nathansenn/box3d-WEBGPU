/** Complete-frame qualification; offscreen native WebGPU, not browser FPS. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import { join } from 'node:path';
import { WebGPURenderer, getUncapturedGpuErrors } from './emitted/webgpu/renderer.mjs';
import { mat4Perspective, mat4LookAt, mat4Multiply } from './emitted/math.mjs';
import { median, balancedOrders } from './statistics.mjs';

const WIDTH = 1920, HEIGHT = 1080, FRAMES = 4, PAIRS = 12;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const quality = Object.freeze({ id: 'cinematic', label: 'Fixed qualification quality', exposure: 1.1,
  bloomStrength: .12, fogDensity: .002, shadowStrength: .85, effectBudget: 64,
  resolutionScale: 1, sampleCount: 4, shadowMapSize: 2048, shadowTapCount: 9 });
function uniforms() {
  const eye = [31, 28, 43], light = [24, 42, 26];
  const ortho = new Float32Array([1 / 32, 0, 0, 0, 0, 1 / 32, 0, 0, 0, 0, -1 / 130, 0, 0, 0, -.1 / 130, 1]);
  return { viewProjection: mat4Multiply(mat4Perspective(Math.PI / 3, WIDTH / HEIGHT, .1, 240), mat4LookAt(eye, [0, 3, 0], [0, 1, 0])),
    lightViewProjection: mat4Multiply(ortho, mat4LookAt(light, [0, 0, 0], [0, 1, 0])),
    cameraPosition: eye, lightDirection: [-.437, -.765, -.474], fogColor: [.055, .085, .14], timeSeconds: 1.25, quality };
}
function synthetic(pattern) {
  const count = 4096, heap = new Float32Array(count * 20), matrices = heap.subarray(0, count * 16), colors = heap.subarray(count * 16);
  let frameVersion = 0, colorVersion = 0;
  for (let i = 0; i < count; i++) {
    const o = i * 16; matrices[o] = matrices[o + 10] = .19; matrices[o + 5] = .2 + (i % 7) * .03; matrices[o + 15] = 1;
    matrices[o + 12] = ((i - 1) % 64 - 31.5) * .48; matrices[o + 13] = matrices[o + 5]; matrices[o + 14] = (Math.floor((i - 1) / 64) - 31.5) * .48;
    colors.set([.2 + (i % 11) * .05, .25 + (i % 7) * .07, .32 + (i % 5) * .09, -2], i * 4);
  }
  matrices.set([18, 0, 0, 0, 0, .2, 0, 0, 0, 0, 18, 0, 0, -.3, 0, 1], 0); colors.set([.35, .39, .43, -5], 0);
  const initial = heap.slice(), source = { HEAPF32: heap, frameVersion: () => frameVersion, colorVersion: () => colorVersion,
    _b3w_matrices_ptr: () => 0, _b3w_colors_ptr: () => count * 64, _b3w_body_count: () => count, _b3w_max_bodies: () => count };
  return { id: 'producer-' + pattern, scope: 'Synthetic deterministic rigid producer through actual renderer; not native physics', count, source,
    reset() { heap.set(initial); frameVersion++; colorVersion++; },
    step(frame, candidate) {
      const previousFrameVersion = frameVersion, previousColorVersion = colorVersion, recolor = frame % 2 === 0, spans = candidate ? [] : null;
      for (let j = 0; j < 64; j++) {
        const offset = pattern === 'contiguous' ? j : pattern === 'clustered' ? (j % 4) * 1023 + Math.floor(j / 4) : j * 199;
        const id = 1 + ((73 + frame * 23 + offset) % (count - 1)), o = id * 16;
        matrices[o + 13] += .003 * (1 + (id + frame) % 5); matrices[o + 12] += .001 * (1 + frame % 3);
        if (recolor) colors[id * 4] = (colors[id * 4] + .017) % .95;
        if (candidate) spans.push({ start: id, count: 1 });
      }
      frameVersion++; if (recolor) colorVersion++;
      return candidate ? { previousFrameVersion, previousColorVersion, frameVersion, colorVersion, matrices: spans, colors: recolor ? spans : [] } : undefined;
    } };
}
function words(source, kind, count) {
  const pointer = Number(kind === 'matrices' ? source._b3w_matrices_ptr() : source._b3w_colors_ptr()), n = count * (kind === 'matrices' ? 16 : 4);
  return new Uint32Array(source.HEAPF32.buffer, source.HEAPF32.byteOffset + pointer, n);
}
function exactDirty(current, previous, stride) {
  const spans = []; let start = -1;
  for (let i = 0; i < current.length / stride; i++) {
    let changed = false; for (let j = 0; j < stride; j++) if (current[i * stride + j] !== previous[i * stride + j]) { changed = true; break; }
    if (changed && start < 0) start = i;
    if (!changed && start >= 0) { spans.push({ start, count: i - start }); start = -1; }
  }
  if (start >= 0) spans.push({ start, count: current.length / stride - start });
  previous.set(current); return spans;
}
async function nativeFixture() {
  const { default: factory } = await import('./native/box3d.js');
  const wasm = await readFile(new URL('./native/box3d.wasm', import.meta.url)), mod = await factory({ wasmBinary: wasm });
  for (const name of ['_b3w_create_scene', '_b3w_step', '_b3w_transform_version', '_b3w_color_version', '_b3w_matrices_ptr', '_b3w_colors_ptr']) assert.equal(typeof mod[name], 'function', 'Native export missing: ' + name);
  let count = 0, previousMatrices, previousColors;
  const source = { get HEAPF32() { return mod.HEAPF32; }, frameVersion: () => mod._b3w_transform_version(), colorVersion: () => mod._b3w_color_version(),
    _b3w_matrices_ptr: () => mod._b3w_matrices_ptr(), _b3w_colors_ptr: () => mod._b3w_colors_ptr(), _b3w_body_count: () => mod._b3w_body_count(), _b3w_max_bodies: () => mod._b3w_max_bodies() };
  return { id: 'native-box3d-stack', scope: 'Actual checked-in Box3D WebAssembly scene 0; candidate exact matrix/color scan and snapshot update are timed', source,
    get count() { return count; }, native: { sceneId: 0, stress: 1, seed: 42, dt: 1 / 60, substeps: 4, preStepFrames: 12, wasmSha256: hash(wasm) },
    reset() {
      count = mod._b3w_create_scene(0, 1, 42); assert.ok(count > 0 && count <= 4096);
      for (let i = 0; i < 12; i++) mod._b3w_step(1 / 60, 4);
      previousMatrices = words(source, 'matrices', count).slice(); previousColors = words(source, 'colors', count).slice();
    },
    step(_frame, candidate) {
      const previousFrameVersion = source.frameVersion(), previousColorVersion = source.colorVersion(); mod._b3w_step(1 / 60, 4);
      if (!candidate) return undefined;
      return { previousFrameVersion, previousColorVersion, frameVersion: source.frameVersion(), colorVersion: source.colorVersion(),
        matrices: exactDirty(words(source, 'matrices', count), previousMatrices, 16), colors: exactDirty(words(source, 'colors', count), previousColors, 4) };
    }, destroy() { mod._b3w_destroy?.(); } };
}
function selectPolicies(policies) {
  const selected = [{ id: 'default', options: {} }], seen = new Set(['{}']);
  for (const [index, item] of (policies ?? []).entries()) {
    const options = item.options ?? item.policy ?? Object.fromEntries(Object.entries(item).filter(([key]) => key !== 'id' && key !== 'name'));
    const key = JSON.stringify(Object.fromEntries(Object.entries(options).sort(([a], [b]) => a.localeCompare(b))));
    if (!seen.has(key)) { selected.push({ id: item.id ?? item.name ?? 'candidate-' + index, options }); seen.add(key); }
    if (selected.length === 4) break;
  }
  return selected;
}
export async function qualifyRenderer({ runtime, outputRoot, guard, emit, policies }) {
  guard(); const selected = selectPolicies(policies), output = join(outputRoot, 'renderer-qualification.json');
  const savedGlobals = Object.fromEntries(['window', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let renderer, native, disposing = false, deviceLoss = null; const errors = [], initialErrors = getUncapturedGpuErrors().count;
  const result = { schema: 'box3d.round4.renderer/1', status: 'running', startedAt: new Date().toISOString(),
    protocol: { resolution: [WIDTH, HEIGHT], quality, framesPerWindow: FRAMES, measuredPairs: PAIRS, order: 'seeded balanced shuffle: six AB and six BA pairs', warmupWindowsPerArm: 2,
      timing: 'CPU producer mutation or native step, candidate metadata generation/scan, actual upload planning, shadow/HDR/post render, and queue completion for four serialized frames',
      excluded: 'Scene reset, initial full upload/render, compilation, pixel/buffer readbacks, timing-result drain and file writes; no browser compositor or interactive FPS',
      materials: 'Deterministic procedural texture fallback, identical shader and material quality in both arms', nativeDirtyCost: 'Exhaustive uint32 comparisons of all matrix/color words plus previous-snapshot copies are inside candidate timing' },
    policies: selected, sources: {}, cases: [], validationErrors: errors };
  try {
    await mkdir(outputRoot, { recursive: true });
    for (const file of ['renderer-qualification.mjs', 'emitted/webgpu/renderer.mjs', 'emitted/webgpu/sparse-upload.mjs', 'emitted/webgpu/gpu-timing.mjs', 'native/box3d.js', 'native/box3d.wasm']) result.sources[file] = hash(await readFile(new URL('./' + file, import.meta.url)));
    emit({ event: 'renderer-start', resolution: [WIDTH, HEIGHT], policies: selected.map(policy => policy.id), expectedCases: selected.length * 4 });
    native = await nativeFixture();
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => { throw new Error('Qualification uses identical deterministic procedural textures.'); } });
    Object.assign(runtime.canvas, { width: WIDTH, height: HEIGHT, clientWidth: WIDTH, clientHeight: HEIGHT });
    renderer = await WebGPURenderer.create(runtime.canvas, 4096, { gpuTiming: { enabled: true, sampleEveryFrames: 1, ringSize: 8 }, instancePartitioning: false });
    const device = renderer.device; device.addEventListener?.('uncapturederror', event => errors.push(event.error?.message ?? String(event.error)));
    void device.lost.then(info => { if (!disposing) deviceLoss = info; });
    renderer.writeSceneUniforms(uniforms()); assert.deepEqual(renderer.viewport(), [WIDTH, HEIGHT]);
    assert.equal(renderer.gpuTimingInfo().status, 'ready', 'Actual renderer timestamp queries are required');
    const healthy = () => { guard(); assert.equal(deviceLoss, null, 'GPU device lost'); assert.equal(renderer.isLost(), false); assert.equal(errors.length, 0, errors.join('; ')); assert.equal(getUncapturedGpuErrors().count, initialErrors); };
    async function settle(target) {
      for (let i = 0; i < 200; i++) { const info = renderer.gpuTimingInfo(); if (info.status === 'error' || info.failedSamples > 0) throw new Error('Actual renderer timing failed: ' + JSON.stringify(info)); if (!info.pendingSamples && info.latest?.frameId >= target) { assert.equal(info.status, 'ready'); assert.equal(info.failedSamples, 0); assert.ok(Number.isFinite(info.latest.passMs.main) && Number.isFinite(info.latest.passMs.post)); return info; } await pause(2); healthy(); }
      throw new Error('Actual renderer timestamp results did not settle');
    }
    async function readGpu(buffer, size) {
      const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try { const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(buffer, 0, staging, 0, size); device.queue.submit([encoder.finish()]); await staging.mapAsync(GPUMapMode.READ); return Buffer.from(new Uint8Array(staging.getMappedRange())); }
      finally { staging.unmap(); staging.destroy(); }
    }
    async function pixels() {
      const stride = Math.ceil(WIDTH * 4 / 256) * 256, buffer = device.createBuffer({ size: stride * HEIGHT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try { const encoder = device.createCommandEncoder(); encoder.copyTextureToBuffer({ texture: renderer.context.getCurrentTexture() }, { buffer, bytesPerRow: stride }, [WIDTH, HEIGHT]); device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ); return Buffer.from(new Uint8Array(buffer.getMappedRange())); }
      finally { buffer.unmap(); buffer.destroy(); }
    }
    async function exactStreams(fixture) {
      const answer = {};
      for (const [name, stride] of [['matrices', 64], ['colors', 16]]) {
        const actual = await readGpu(name === 'matrices' ? renderer.matrixBuffer : renderer.colorBuffer, fixture.count * stride), cpu = words(fixture.source, name, fixture.count);
        assert.ok(actual.equals(Buffer.from(cpu.buffer, cpu.byteOffset, cpu.byteLength)), 'Actual renderer GPU stream mismatch: ' + name); answer[name + 'Sha256'] = hash(actual);
      }
      return answer;
    }
    device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
    renderer.render(0, []); await device.queue.onSubmittedWorkDone(); await settle(renderer.gpuTimingInfo().frames);
    const background = await pixels(); await runtime.finalizeIdentity(); result.hardware = { ...runtime.meta, resolution: { width: WIDTH, height: HEIGHT } };
    function nonblank(bytes) {
      let changed = 0, min = 255, max = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        if (bytes[i] !== background[i] || bytes[i + 1] !== background[i + 1] || bytes[i + 2] !== background[i + 2]) changed++;
        min = Math.min(min, bytes[i], bytes[i + 1], bytes[i + 2]); max = Math.max(max, bytes[i], bytes[i + 1], bytes[i + 2]);
      }
      assert.ok(changed > 64 && max - min > 4, 'Rendered fixture is blank or background only'); return { changedPixelsFromEmptyScene: changed, rgbRange: [min, max], sha256: hash(bytes) };
    }
    async function window(fixture, candidate, policy, seed, capture) {
      healthy(); fixture.reset(); renderer.invalidateDynamicCaches(); renderer.uploadInstances(fixture.source, fixture.count); renderer.render(fixture.count, []);
      await device.queue.onSubmittedWorkDone(); await settle(renderer.gpuTimingInfo().frames);
      let uploadedBytes = 0; const start = performance.now();
      for (let frame = 0; frame < FRAMES; frame++) {
        guard(); const dirty = fixture.step(seed + frame, candidate); if (dirty) dirty.uploadPolicy = policy.options;
        uploadedBytes += renderer.uploadInstances(fixture.source, fixture.count, dirty); renderer.render(fixture.count, []); await device.queue.onSubmittedWorkDone();
      }
      const wallMs = performance.now() - start, gpu = await settle(renderer.gpuTimingInfo().frames); healthy();
      const measurement = { wallMs, perFrameMs: wallMs / FRAMES, uploadedBytes, gpuLastFrame: gpu.latest, gpuCompletedSamples: gpu.completedSamples, bodyCount: fixture.count };
      if (!capture) return { measurement };
      const bytes = await pixels(), evidence = { ...nonblank(bytes), streams: await exactStreams(fixture) }; healthy();
      return { measurement, evidence, bytes };
    }
    for (const fixture of [synthetic('contiguous'), synthetic('clustered'), synthetic('scattered'), native]) {
      for (const policy of selected) {
        healthy(); const entry = { fixture: fixture.id, scope: fixture.scope, native: fixture.native ?? null, policy, status: 'running', pairs: [] }; result.cases.push(entry);
        for (let warm = 0; warm < 2; warm++) for (const candidate of warm % 2 ? [true, false] : [false, true]) await window(fixture, candidate, policy, 0, false);
        const pairedOrders = balancedOrders(PAIRS, 0x43121);
        for (let pair = 0; pair < PAIRS; pair++) {
          const order = pairedOrders[pair] ? ['candidate', 'full'] : ['full', 'candidate'], arms = {};
          for (const arm of order) arms[arm] = await window(fixture, arm === 'candidate', policy, pair * FRAMES, true);
          assert.ok(arms.full.bytes.equals(arms.candidate.bytes), 'Exact pixel mismatch: ' + fixture.id + '/' + policy.id);
          assert.deepEqual(arms.full.evidence.streams, arms.candidate.evidence.streams, 'Producer replay mismatch');
          entry.pairs.push({ pair, order, full: arms.full.measurement, candidate: arms.candidate.measurement,
            ratio: arms.full.measurement.wallMs / arms.candidate.measurement.wallMs,
            pixelEvidence: { exactParity: true, full: arms.full.evidence, candidate: arms.candidate.evidence } });
        }
        entry.status = 'passed'; entry.medianRatio = median(entry.pairs.map(pair => pair.ratio));
        entry.fullMedianFrameMs = median(entry.pairs.map(pair => pair.full.perFrameMs)); entry.candidateMedianFrameMs = median(entry.pairs.map(pair => pair.candidate.perFrameMs));
        entry.scopeOfRatio = 'Descriptive 12-pair serialized complete-frame ratio; policy selection came from earlier microbenchmarks';
        await writeFile(output, JSON.stringify(result, null, 2) + '\n');
        emit({ event: 'renderer-case', fixture: fixture.id, policy: policy.id, pairs: PAIRS, pixelParity: true, medianRatio: entry.medianRatio });
      }
    }
    const oom = await device.popErrorScope(), validation = await device.popErrorScope(); assert.equal(oom, null); assert.equal(validation, null); healthy();
    result.status = 'passed'; result.exactPixelPairs = result.cases.reduce((sum, row) => sum + row.pairs.length, 0); result.finishedAt = new Date().toISOString();
    emit({ event: 'renderer-final', status: result.status, cases: result.cases.length, exactPixelPairs: result.exactPixelPairs }); return result;
  } catch (error) {
    result.status = 'failed'; result.error = String(error.stack ?? error); emit({ event: 'renderer-failed', error: String(error.message ?? error) }); throw error;
  } finally {
    result.finishedAt ??= new Date().toISOString(); result.deviceLoss = deviceLoss;
    await writeFile(output, JSON.stringify(result, null, 2) + '\n'); disposing = true; renderer?.destroy(); native?.destroy();
    for (const [key, descriptor] of Object.entries(savedGlobals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
}
