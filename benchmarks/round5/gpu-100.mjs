/** Actual-renderer 100-condition campaign. Execute only the prepared bundle. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';
import { join, resolve } from 'node:path';
import { openRuntime } from './hardware-runtime.mjs';
import { balancedOrders, median, qualifyCases } from './statistics.mjs';
import { WebGPURenderer, getUncapturedGpuErrors } from './emitted/webgpu/renderer.mjs';
import { createDirtyRecordTracker } from './emitted/webgpu/dirty-record-tracker.mjs';
import { mat4Perspective, mat4LookAt, mat4Multiply } from './emitted/math.mjs';
import { buildPlan, PROTOCOL, QUALITY, SEEDS, UPLOAD_POLICY } from './plan.mjs';
import { createFixture } from './producer-fixtures.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const emit = data => console.log('BOX3D_R5 ' + JSON.stringify({ at: new Date().toISOString(), ...data }));
const { width: WIDTH, height: HEIGHT, framesPerWindow: FRAMES, pairsPerSet: PAIRS } = PROTOCOL;
const json = value => JSON.stringify(value, null, 2) + '\n';
function words(source, kind, count) {
  const pointer = Number(kind === 'matrices' ? source._b3w_matrices_ptr() : source._b3w_colors_ptr());
  return new Uint32Array(source.HEAPF32.buffer, source.HEAPF32.byteOffset + pointer, count * (kind === 'matrices' ? 16 : 4));
}
function sceneUniforms() {
  const eye = [31, 28, 43], light = [24, 42, 26];
  const ortho = new Float32Array([1 / 32, 0, 0, 0, 0, 1 / 32, 0, 0, 0, 0, -1 / 130, 0, 0, 0, -.1 / 130, 1]);
  return { viewProjection: mat4Multiply(mat4Perspective(Math.PI / 3, WIDTH / HEIGHT, .1, 240), mat4LookAt(eye, [0, 3, 0], [0, 1, 0])),
    lightViewProjection: mat4Multiply(ortho, mat4LookAt(light, [0, 0, 0], [0, 1, 0])),
    cameraPosition: eye, lightDirection: [-.437, -.765, -.474], fogColor: [.055, .085, .14], timeSeconds: 1.25, quality: QUALITY };
}
const plan = buildPlan();
if (process.argv.includes('--validate-plan')) {
  emit({ event: 'plan-valid', cases: plan.cases.length, workloads: 20, protocol: PROTOCOL });
} else {
  await main();
}

async function main() {
  assert.ok(process.env.BOX3D_R5_OUTPUT, 'BOX3D_R5_OUTPUT must name a fresh results directory');
  const output = resolve(process.env.BOX3D_R5_OUTPUT), deadline = Date.parse(process.env.BOX3D_R5_DEADLINE ?? '');
  assert.ok(Number.isFinite(deadline) && deadline > Date.now() && deadline - Date.now() <= 2700_000, 'A fresh deadline within 45 minutes is required');
  const guard = () => { if (Date.now() >= deadline) throw new Error('Round 5 bounded deadline reached'); };
  await mkdir(output, { mode: 0o700 }); await mkdir(join(output, 'cases'), { mode: 0o700 });
  const startedAt = new Date().toISOString(), originalGlobals = Object.fromEntries(['window', 'fetch'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const results = { schema: 'box3d.round5.results/1', status: 'running', startedAt, protocol: PROTOCOL,
    sourceCommit: process.env.BOX3D_R5_COMMIT ?? null, branch: process.env.BOX3D_R5_BRANCH ?? null,
    planSha256: hash(json(plan)), cases: [], validationErrors: [], limitations: [
      'Two seeded sets are measured consecutively on the same GPU session; they do not establish independence across hardware or days.',
      'Complete-frame timing serializes queue completion each frame; browser presentation, networking and interactive frame pacing are outside scope.',
      'Native candidates discover changes through exhaustive per-record comparison, not native producer-owned metadata.',
      'The fixed sparse planner was selected descriptively from Round 4; the new 100-condition family evaluates tracker representations.'
    ] };
  let runtime, renderer, disposing = false, deviceLoss = null, activeEntry = null;
  const fixtures = new Map(), initialErrorCount = getUncapturedGpuErrors().count;
  const saveResults = () => writeFile(join(output, 'results.json'), json(results));
  try {
    await writeFile(join(output, 'plan.json'), json(plan));
    const sourceBytes = await readFile(new URL('./source-manifest.json', import.meta.url));
    const sourceManifest = JSON.parse(sourceBytes);
    if (results.sourceCommit) assert.equal(sourceManifest.commit, results.sourceCommit, 'Prepared source commit differs from requested commit');
    assert.equal(sourceManifest.dirty, false, 'Paid qualification requires a clean source tree');
    results.sourceCommit = sourceManifest.commit; results.sourceManifestSha256 = hash(sourceBytes);
    await writeFile(join(output, 'source-manifest.json'), sourceBytes);
    emit({ event: 'start', commit: results.sourceCommit, cases: 100, setsPerCase: 2, pairsPerSet: PAIRS, framesPerWindow: FRAMES, deadline: new Date(deadline).toISOString() });
    guard(); runtime = await openRuntime({ width: WIDTH, height: HEIGHT, highResolutionTimestamps: true });
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
    Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => { throw new Error('Campaign uses identical deterministic procedural textures.'); } });
    Object.assign(runtime.canvas, { width: WIDTH, height: HEIGHT, clientWidth: WIDTH, clientHeight: HEIGHT });
    renderer = await WebGPURenderer.create(runtime.canvas, 16384, { gpuTiming: { enabled: true, sampleEveryFrames: 1, ringSize: 8 }, instancePartitioning: false });
    const device = renderer.device;
    device.addEventListener?.('uncapturederror', event => results.validationErrors.push(event.error?.message ?? String(event.error)));
    void device.lost.then(info => { if (!disposing) deviceLoss = { reason: info.reason, message: info.message }; });
    renderer.writeSceneUniforms(sceneUniforms()); assert.deepEqual(renderer.viewport(), [WIDTH, HEIGHT]);
    assert.equal(renderer.gpuTimingInfo().status, 'ready', 'Actual renderer timestamp queries are required');
    const healthy = () => { guard(); assert.equal(deviceLoss, null, 'GPU device lost'); assert.equal(renderer.isLost(), false); assert.equal(results.validationErrors.length, 0, results.validationErrors.join('; ')); assert.equal(getUncapturedGpuErrors().count, initialErrorCount); };
    async function settle(target) {
      for (let i = 0; i < 300; i++) {
        const info = renderer.gpuTimingInfo();
        if (info.status === 'error' || info.failedSamples > 0) throw new Error('Renderer timestamp failure: ' + JSON.stringify(info));
        if (!info.pendingSamples && info.latest?.frameId >= target) {
          assert.equal(info.status, 'ready'); assert.equal(info.failedSamples, 0);
          for (const name of ['main', 'post']) assert.ok(Number.isFinite(info.latest.passMs[name]) && info.latest.passMs[name] > 0, 'Missing/nonpositive GPU timestamp: ' + name);
          for (const name of ['compute', 'shadow']) if (info.latest.passMs[name] !== null) assert.ok(Number.isFinite(info.latest.passMs[name]) && info.latest.passMs[name] >= 0, 'Invalid optional GPU timestamp: ' + name);
          assert.ok(Number.isFinite(info.latest.totalPassMs) && info.latest.totalPassMs > 0);
          return { frameId: info.latest.frameId, passMs: { ...info.latest.passMs }, totalPassMs: info.latest.totalPassMs };
        }
        await pause(2); healthy();
      }
      throw new Error('Actual renderer timestamp results did not settle');
    }
    async function readGpu(buffer, size) {
      const staging = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const encoder = device.createCommandEncoder(); encoder.copyBufferToBuffer(buffer, 0, staging, 0, size); device.queue.submit([encoder.finish()]);
        await staging.mapAsync(GPUMapMode.READ); return Buffer.from(new Uint8Array(staging.getMappedRange()));
      } finally { staging.unmap(); staging.destroy(); }
    }
    async function pixels() {
      const bytesPerRow = Math.ceil(WIDTH * 4 / 256) * 256, size = bytesPerRow * HEIGHT;
      const buffer = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: renderer.context.getCurrentTexture() }, { buffer, bytesPerRow }, [WIDTH, HEIGHT]);
        device.queue.submit([encoder.finish()]); await buffer.mapAsync(GPUMapMode.READ); return Buffer.from(new Uint8Array(buffer.getMappedRange()));
      } finally { buffer.unmap(); buffer.destroy(); }
    }
    async function exactStreams(fixture) {
      const evidence = {}, arrays = {};
      for (const [name, stride] of [['matrices', 64], ['colors', 16]]) {
        const actual = await readGpu(name === 'matrices' ? renderer.matrixBuffer : renderer.colorBuffer, fixture.count * stride);
        const cpu = words(fixture.source, name, fixture.count), expected = Buffer.from(cpu.buffer, cpu.byteOffset, cpu.byteLength);
        assert.ok(actual.equals(expected), 'Full actual GPU stream mismatch: ' + name);
        arrays[name] = actual; evidence[name] = { bytes: actual.length, records: fixture.count, sha256: hash(actual), expectedCpuSha256: hash(expected), exactCpuParity: true };
      }
      return { evidence, arrays };
    }
    async function popScopes() {
      const oom = await device.popErrorScope(), validation = await device.popErrorScope();
      assert.equal(oom, null, oom?.message); assert.equal(validation, null, validation?.message); healthy();
    }
    device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
    // Exercise compute before identity finalization, so lazily mapped compute
    // driver libraries participate in the same identity as render/presentation.
    const marker = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    try {
      const module = device.createShaderModule({ code: '@group(0) @binding(0) var<storage, read_write> value: array<u32>; @compute @workgroup_size(1) fn main() { value[0] = 0xb3d0005u; }' });
      const pipeline = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
      const binding = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: marker } }] });
      const encoder = device.createCommandEncoder(), pass = encoder.beginComputePass();
      pass.setPipeline(pipeline); pass.setBindGroup(0, binding); pass.dispatchWorkgroups(1); pass.end(); device.queue.submit([encoder.finish()]);
      const actual = await readGpu(marker, 4); assert.equal(actual.readUInt32LE(0), 0xb3d0005, 'Physical compute marker mismatch');
      results.computeProof = { expected: 0xb3d0005, actual: actual.readUInt32LE(0), sha256: hash(actual) };
    } finally { marker.destroy(); }
    renderer.render(0, []); await device.queue.onSubmittedWorkDone();
    results.preflightGpuTiming = await settle(renderer.gpuTimingInfo().frames);
    const background = await pixels(); await popScopes(); await runtime.finalizeIdentity();
    results.hardwareBefore = { ...runtime.meta, telemetry: await runtime.sampleTelemetry() };
    await writeFile(join(output, 'hardware-before.json'), json(results.hardwareBefore));
    await saveResults();
    const { default: nativeFactory } = await import('./native/box3d.js');
    const wasmBinary = await readFile(new URL('./native/box3d.wasm', import.meta.url));
    results.nativeWasmSha256 = hash(wasmBinary);
    function nonblank(bytes) {
      let changed = 0, min = 255, max = 0;
      for (let i = 0; i < bytes.length; i += 4) {
        if (bytes[i] !== background[i] || bytes[i + 1] !== background[i + 1] || bytes[i + 2] !== background[i + 2]) changed++;
        min = Math.min(min, bytes[i], bytes[i + 1], bytes[i + 2]); max = Math.max(max, bytes[i], bytes[i + 1], bytes[i + 2]);
      }
      assert.ok(changed > 64 && max - min > 4, 'Rendered fixture is blank or background only');
      return { changedPixelsFromEmptyScene: changed, rgbRange: [min, max], bytes: bytes.length, sha256: hash(bytes) };
    }
    async function measure(fixture, candidate, mode, seed, pairIndex, capture) {
      healthy(); await fixture.reset(seed, pairIndex);
      assert.ok(Number.isInteger(fixture.count) && fixture.count > 0 && fixture.count <= 16384, 'Fixture exceeds renderer capacity');
      const count = fixture.count; renderer.invalidateDynamicCaches(); renderer.uploadInstances(fixture.source, count); renderer.render(count, []);
      await device.queue.onSubmittedWorkDone(); await settle(renderer.gpuTimingInfo().frames);
      let uploadedBytes = 0, expectedBaselineBytes = 0; const trackingFrames = [], start = performance.now();
      for (let frame = 0; frame < FRAMES; frame++) {
        guard(); const previousFrameVersion = fixture.source.frameVersion(), previousColorVersion = fixture.source.colorVersion();
        const dirty = fixture.step(frame, candidate, mode);
        expectedBaselineBytes += (previousFrameVersion !== fixture.source.frameVersion() ? count * 64 : 0)
          + (previousColorVersion !== fixture.source.colorVersion() ? count * 16 : 0);
        assert.equal(fixture.count, count, 'Body count changed inside a fixed window');
        if (candidate) {
          assert.ok(dirty, 'Candidate must return explicit dirty evidence'); dirty.uploadPolicy = UPLOAD_POLICY;
          // Fixture evidence owns scalars, never the tracker's borrowed span list.
          // Constructing and retaining these diagnostics is charged to the candidate.
          trackingFrames.push(dirty.trackingEvidence);
        }
        uploadedBytes += renderer.uploadInstances(fixture.source, count, dirty); renderer.render(count, []); await device.queue.onSubmittedWorkDone();
      }
      const wallMs = performance.now() - start; assert.ok(Number.isFinite(wallMs) && wallMs > 0);
      const gpuLastFrame = await settle(renderer.gpuTimingInfo().frames); healthy();
      const measurement = { wallMs, perFrameMs: wallMs / FRAMES, uploadedBytes, expectedBaselineBytes, bodyCount: count, gpuLastFrame, trackingFrames };
      if (!candidate) assert.equal(uploadedBytes, expectedBaselineBytes, 'Baseline must fully upload changed-version streams and retain unchanged-version caches');
      if (!capture) return { measurement };
      const bytes = await pixels(), streams = await exactStreams(fixture);
      const evidence = { pixels: nonblank(bytes), streams: streams.evidence }; healthy();
      return { measurement, evidence, bytes, arrays: streams.arrays };
    }
    for (const [executionIndex, id] of plan.executionOrder.entries()) {
      healthy(); const definition = plan.cases.find(row => row.id === id), workload = definition.workload;
      if (!fixtures.has(workload.id)) fixtures.set(workload.id, await createFixture(workload, {
        trackerFactory: createDirtyRecordTracker, nativeFactory, wasmBinary, framesPerWindow: FRAMES, pairsPerSet: PAIRS, seeds: SEEDS
      }));
      const fixture = fixtures.get(workload.id);
      const entry = { ...definition, executionIndex, status: 'running', startedAt: new Date().toISOString(),
        producerDefinition: fixture.definition ?? workload, sets: [], parityPairs: 0 };
      activeEntry = entry; results.cases.push(entry);
      device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
      for (let warm = 0; warm < PROTOCOL.warmupWindowsPerArm; warm++) {
        for (const candidate of warm % 2 ? [true, false] : [false, true]) await measure(fixture, candidate, definition.mode, SEEDS[0], 0, false);
      }
      for (const [setIndex, seed] of SEEDS.entries()) {
        const orderSeed = (seed ^ (Number(id.slice(3)) * 0x9e3779b1)) >>> 0;
        const orders = balancedOrders(PAIRS, orderSeed), set = { seed, orderSeed, pairs: [] }; entry.sets.push(set);
        for (let pairIndex = 0; pairIndex < PAIRS; pairIndex++) {
          const order = orders[pairIndex] ? ['candidate', 'baseline'] : ['baseline', 'candidate'];
          const capture = pairIndex === 0 || pairIndex === PAIRS - 1, arms = {};
          for (const arm of order) arms[arm] = await measure(fixture, arm === 'candidate', definition.mode, seed, pairIndex, capture);
          const pair = { pair: pairIndex, order, baselineMs: arms.baseline.measurement.wallMs, candidateMs: arms.candidate.measurement.wallMs,
            baseline: arms.baseline.measurement, candidate: arms.candidate.measurement };
          if (capture) {
            assert.ok(arms.baseline.bytes.equals(arms.candidate.bytes), 'Exact full-pixel mismatch: ' + id);
            for (const name of ['matrices', 'colors']) assert.ok(arms.baseline.arrays[name].equals(arms.candidate.arrays[name]), 'Opposite-arm full GPU buffer mismatch: ' + id + '/' + name);
            assert.deepEqual(arms.baseline.evidence.streams, arms.candidate.evidence.streams, 'CPU replay changed between paired arms');
            pair.parity = { exactAllPixels: true, exactFullBuffers: true, baseline: arms.baseline.evidence, candidate: arms.candidate.evidence }; entry.parityPairs++;
          }
          set.pairs.push(pair);
        }
        emit({ event: 'set', id, workload: workload.id, mode: definition.mode, set: setIndex + 1, pairs: set.pairs.length,
          medianSpeedup: median(set.pairs.map(pair => pair.baselineMs / pair.candidateMs)) });
      }
      await popScopes(); entry.status = 'measured'; entry.finishedAt = new Date().toISOString();
      await writeFile(join(output, 'cases', id + '.json'), json(entry)); activeEntry = null;
      await saveResults(); emit({ event: 'case', id, completed: executionIndex + 1, expected: 100, parityPairs: entry.parityPairs });
    }
    results.cases = qualifyCases(results.cases, { expectedCases: 100, pairsPerSet: PAIRS, alpha: .05, minRatio: 1.03, maxP95Ratio: 1.10 });
    for (const entry of results.cases) await writeFile(join(output, 'cases', entry.id + '.json'), json(entry));
    results.statusCounts = Object.fromEntries(['qualified', 'regression', 'mixed', 'tail-rejected', 'unresolved'].map(status => [status, results.cases.filter(row => row.status === status).length]));
    results.measuredPairs = results.cases.reduce((total, row) => total + row.sets.reduce((sum, set) => sum + set.pairs.length, 0), 0);
    results.exactParityPairs = results.cases.reduce((total, row) => total + row.parityPairs, 0);
    assert.equal(results.measuredPairs, 6400); assert.equal(results.exactParityPairs, 400); healthy();
    await runtime.refreshDriverEvidence(); const afterIdentity = await runtime.finalizeIdentity();
    assert.deepEqual(afterIdentity, results.hardwareBefore.identity, 'Runtime identity drifted during campaign');
    results.hardwareAfter = { ...runtime.meta, telemetry: await runtime.sampleTelemetry() };
    await writeFile(join(output, 'hardware-after.json'), json(results.hardwareAfter));
    results.status = 'passed'; results.finishedAt = new Date().toISOString();
    emit({ event: 'final', status: results.status, cases: results.cases.length, measuredPairs: results.measuredPairs, exactParityPairs: results.exactParityPairs, statusCounts: results.statusCounts });
  } catch (error) {
    results.status = 'failed'; results.error = String(error.stack ?? error);
    if (activeEntry) { activeEntry.status = 'failed'; activeEntry.error = results.error; await writeFile(join(output, 'cases', activeEntry.id + '.json'), json(activeEntry)); }
    emit({ event: 'failed', error: String(error.message ?? error), completedCases: results.cases.filter(row => row.status !== 'running' && row.status !== 'failed').length });
    process.exitCode = 1;
  } finally {
    results.finishedAt ??= new Date().toISOString(); results.deviceLoss = deviceLoss;
    await saveResults(); disposing = true; renderer?.destroy();
    for (const fixture of fixtures.values()) fixture.close?.(); runtime?.close();
    for (const [key, descriptor] of Object.entries(originalGlobals)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
}
