import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import ts from 'typescript';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const moduleUrl = (source, fileName) => `data:text/javascript;base64,${Buffer.from(ts.transpileModule(source, {
  fileName, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText + `\n//# sourceURL=${fileName}\n`).toString('base64')}`;
const timingUrl = moduleUrl(fs.readFileSync(path.join(root, 'src/webgpu/gpu-timing.ts'), 'utf8'), 'gpu-timing.ts');
const { GpuPassTimer } = await import(timingUrl);
const assetsUrl = moduleUrl(fs.readFileSync(path.join(root, 'src/assets/ktx2.ts'), 'utf8'), 'ktx2.ts');
const rendererSource = fs.readFileSync(path.join(root, 'src/webgpu/renderer.ts'), 'utf8');
const shadowUrl=moduleUrl(fs.readFileSync(path.join(root,'src/webgpu/shadow-cache.ts'),'utf8'),'shadow-cache.ts');
const partitionUrl=moduleUrl(fs.readFileSync(path.join(root,'src/webgpu/instance-partition.ts'),'utf8'),'instance-partition.ts');
const residentWaterUrl=moduleUrl(fs.readFileSync(path.join(root,'src/webgpu/resident-water-surface.ts'),'utf8'),'resident-water-surface.ts');
const startupUrl=moduleUrl(fs.readFileSync(path.join(root,'src/webgpu/startup-budget.ts'),'utf8'),'startup-budget.ts');
const { WebGPURenderer } = await import(moduleUrl(rendererSource.replace('./gpu-timing.js', timingUrl).replace('./shadow-cache.js',shadowUrl).replace('./instance-partition.js',partitionUrl).replace('./resident-water-surface.js',residentWaterUrl).replace('./startup-budget.js',startupUrl).replace('../assets/ktx2.js', assetsUrl), 'renderer.ts'));

globalThis.GPUBufferUsage = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
globalThis.GPUTextureUsage = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
globalThis.GPUShaderStage = { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 };

const flush = async () => { await Promise.resolve(); await Promise.resolve(); };
function fakeDevice({ supported = true, failBuffer = -1, syncMapFailure = false } = {}) {
  const resources = [], readbacks = [], encoders = [];
  let bufferCalls = 0;
  const resource = (kind, descriptor) => {
    const value = { kind, descriptor, destroys: 0, destroy() { this.destroys++; } };
    resources.push(value);
    return value;
  };
  const device = {
    resources, readbacks, encoders, destroys: 0,
    features: new Set(supported ? ['timestamp-query', 'texture-compression-bc'] : []),
    queue: {
      submissions: 0, writes: 0,
      writeBuffer() { this.writes++; }, writeTexture() { this.writes++; },
      submit() { this.submissions++; },
      get onSubmittedWorkDone() { throw new Error('A timing frame must never wait on the whole queue'); },
    },
    createQuerySet(descriptor) { return resource('query', descriptor); },
    createBuffer(descriptor) {
      if (++bufferCalls === failBuffer) throw new Error('test allocation failed');
      const buffer = resource('buffer', descriptor);
      if (descriptor.usage & GPUBufferUsage.MAP_READ) {
        Object.assign(buffer, {
          data: new ArrayBuffer(descriptor.size), maps: 0, unmaps: 0,
          mapAsync(mode, offset, size) {
            this.maps++;
            assert.deepEqual([mode, offset, size], [1, 0, 64]);
            if (syncMapFailure) throw new Error('sync map failure');
            return new Promise((resolve, reject) => { this.resolveMap = resolve; this.rejectMap = reject; });
          },
          getMappedRange() { return this.data; },
          unmap() { this.unmaps++; },
        });
        readbacks.push(buffer);
      }
      return buffer;
    },
    createTexture(descriptor) {
      const texture = resource('texture', descriptor);
      texture.createView = () => ({ texture });
      return texture;
    },
    createSampler: (descriptor) => ({ descriptor }),
    createBindGroup: (descriptor) => ({ descriptor }),
    createBindGroupLayout: (descriptor) => ({ descriptor }),
    createPipelineLayout: (descriptor) => ({ descriptor }),
    createRenderPipeline: (descriptor) => ({ descriptor }),
    createComputePipeline: (descriptor) => ({ descriptor }),
    createShaderModule: (descriptor) => ({ descriptor, async getCompilationInfo() { return { messages: [] }; } }),
    createCommandEncoder() {
      const encoder = fakeEncoder();
      encoders.push(encoder);
      return encoder;
    },
    destroy() { this.destroys++; },
  };
  return device;
}

function fakeEncoder() {
  const pass = () => ({ setPipeline() {}, setBindGroup() {}, setVertexBuffer() {}, setIndexBuffer() {}, draw() {}, drawIndirect() {}, drawIndexed() {}, dispatchWorkgroups() {}, end() {} });
  return {
    resolves: [], copies: [], passes: [],
    beginRenderPass(descriptor) { this.passes.push(descriptor); return pass(); },
    beginComputePass(descriptor) { this.passes.push(descriptor); return pass(); },
    resolveQuerySet(...args) { this.resolves.push(args); },
    copyBufferToBuffer(...args) { this.copies.push(args); },
    finish() { return {}; },
  };
}

function submit(timer, passes = ['main', 'post']) {
  const frame = timer.beginFrame();
  assert.ok(frame);
  const encoder = fakeEncoder();
  for (const pass of passes) assert.ok(timer.timestampWrites(frame, pass));
  timer.resolveFrame(encoder, frame);
  timer.submitFrame(frame);
  assert.equal(encoder.resolves.length, 1);
  assert.equal(encoder.copies.length, 1);
  return frame;
}

async function complete(device, frame, values = [1n, 1000001n, 2000001n, 3000001n, 4000001n, 6000001n, 7000001n, 7500001n]) {
  const buffer = device.readbacks[frame.slotIndex];
  new BigUint64Array(buffer.data).set(values);
  buffer.resolveMap();
  await flush();
}

test('unsupported and disabled timers allocate nothing and publish no fabricated result', () => {
  for (const [supported, enabled, status] of [[false, true, 'unsupported'], [true, false, 'disabled']]) {
    const device = fakeDevice({ supported });
    const timer = new GpuPassTimer(device, { enabled });
    assert.equal(timer.info().status, status);
    assert.equal(timer.info().latest, null);
    assert.equal(timer.beginFrame(), null);
    assert.equal(timer.timestampWrites(null, 'main'), undefined);
    timer.resolveFrame(fakeEncoder(), null);
    timer.submitFrame(null);
    assert.equal(device.resources.length, 0);
    timer.dispose();
    timer.dispose();
  }
});

test('default sampling cadence is first frame then every 30; ring limits stay bounded', () => {
  const device = fakeDevice();
  const timer = new GpuPassTimer(device);
  assert.equal(timer.info().ringSize, 3);
  const first = timer.beginFrame();
  assert.equal(first.frameId, 1);
  timer.discardFrame(first);
  for (let frame = 2; frame <= 30; frame++) assert.equal(timer.beginFrame(), null);
  assert.equal(timer.beginFrame().frameId, 31);
  assert.equal(device.resources.length, 9);
  timer.dispose();
  const bounded = new GpuPassTimer(fakeDevice(), { ringSize: Infinity, sampleEveryFrames: NaN });
  assert.equal(bounded.info().ringSize, 3);
  assert.equal(bounded.info().sampleEveryFrames, 30);
  bounded.dispose();
  const clamped = new GpuPassTimer(fakeDevice(), { ringSize: 100, sampleEveryFrames: 0 });
  assert.equal(clamped.info().ringSize, 8);
  assert.equal(clamped.info().sampleEveryFrames, 1);
  clamped.dispose();
});

test('async ring drops saturated samples, reuses slots only after map completion, and handles out-of-order results', async () => {
  const device = fakeDevice();
  const timer = new GpuPassTimer(device, { sampleEveryFrames: 1 });
  const first = submit(timer, ['compute', 'shadow', 'main', 'post']);
  const second = submit(timer);
  const third = submit(timer);
  assert.equal(timer.info().latest, null, 'queue submission must not be published as a GPU result');
  for (let index = 0; index < 20; index++) assert.equal(timer.beginFrame(), null);
  assert.equal(timer.info().droppedSamples, 20);
  assert.equal(timer.info().pendingSamples, 3);
  assert.equal(device.resources.length, 9, 'busy ring must not grow');
  await complete(device, second);
  assert.equal(timer.info().latest.frameId, second.frameId);
  assert.deepEqual(timer.info().latest.passMs, { compute: null, shadow: null, main: 2, post: 0.5 });
  assert.equal(timer.info().latest.totalPassMs, 2.5);
  await complete(device, first);
  assert.equal(timer.info().latest.frameId, second.frameId, 'late older result must not rewind diagnostics');
  const reused = submit(timer, ['post']);
  timer.discardFrame(first);
  timer.submitFrame(reused);
  assert.equal(device.readbacks[reused.slotIndex].maps, 2, 'duplicate submit is ignored');
  await complete(device, reused);
  assert.deepEqual(timer.info().latest.passMs, { compute: null, shadow: null, main: null, post: 0.5 });
  assert.equal(timer.info().completedSamples, 3);
  await complete(device, third);
  timer.dispose();
  assert.ok(device.resources.every((resource) => resource.destroys === 1));
});

test('a real equal nonzero timestamp pair is a valid quantized zero duration', async () => {
  const device = fakeDevice();
  const timer = new GpuPassTimer(device, { sampleEveryFrames: 1 });
  const frame = submit(timer, ['main']);
  await complete(device, frame, [0n, 0n, 0n, 0n, 42n, 42n, 0n, 0n]);
  assert.equal(timer.info().latest.passMs.main, 0);
  assert.equal(timer.info().status, 'ready');
  timer.dispose();
});

test('invalid timestamp data reports an error instead of zero timing and stops further sampling', async () => {
  for (const [start, end] of [[0n, 0n], [10n, 9n], [1n, BigInt(Number.MAX_SAFE_INTEGER) + 2n]]) {
    const device = fakeDevice();
    const timer = new GpuPassTimer(device, { sampleEveryFrames: 1 });
    const frame = submit(timer, ['main']);
    await complete(device, frame, [0n, 0n, 0n, 0n, start, end, 0n, 0n]);
    assert.equal(timer.info().status, 'error');
    assert.match(timer.info().reason, /Invalid GPU timestamp pair/);
    assert.equal(timer.info().latest, null);
    assert.equal(timer.info().failedSamples, 1);
    assert.equal(timer.info().pendingSamples, 0);
    assert.equal(timer.beginFrame(), null);
    timer.dispose();
  }
});

test('readback rejection and synchronous mapping failure are contained', async () => {
  for (const syncMapFailure of [false, true]) {
    const device = fakeDevice({ syncMapFailure });
    const timer = new GpuPassTimer(device, { sampleEveryFrames: 1 });
    const frame = submit(timer);
    if (!syncMapFailure) device.readbacks[frame.slotIndex].rejectMap(new Error('readback rejected'));
    await flush();
    assert.equal(timer.info().status, 'error');
    assert.equal(timer.info().failedSamples, 1);
    assert.equal(timer.info().latest, null);
    assert.equal(timer.info().pendingSamples, 0);
    timer.dispose();
  }
});

test('partial allocation and encoder failures release safely without unbounded retry', () => {
  const failedDevice = fakeDevice({ failBuffer: 3 });
  const allocation = new GpuPassTimer(failedDevice);
  assert.equal(allocation.info().status, 'error');
  assert.ok(failedDevice.resources.every((resource) => resource.destroys === 1));
  allocation.dispose();
  assert.ok(failedDevice.resources.every((resource) => resource.destroys === 1));
  const timer = new GpuPassTimer(fakeDevice(), { sampleEveryFrames: 1 });
  const frame = timer.beginFrame();
  timer.timestampWrites(frame, 'main');
  timer.resolveFrame({ resolveQuerySet() { throw new Error('encoder failed'); } }, frame);
  timer.submitFrame(frame);
  assert.equal(timer.info().status, 'error');
  assert.equal(timer.info().pendingSamples, 0);
  assert.equal(timer.info().submittedSamples, 0);
  timer.dispose();
});

test('disposal ignores late successful and rejected maps and destroys each timing resource exactly once', async () => {
  const device = fakeDevice();
  const timer = new GpuPassTimer(device, { sampleEveryFrames: 1 });
  const first = submit(timer), second = submit(timer);
  timer.dispose();
  timer.dispose();
  const disposed = timer.info();
  await complete(device, first);
  device.readbacks[second.slotIndex].rejectMap(new Error('AbortError after destroy'));
  await flush();
  assert.deepEqual(timer.info(), disposed);
  assert.equal(disposed.status, 'disposed');
  assert.equal(disposed.latest, null);
  assert.equal(disposed.pendingSamples, 0);
  assert.ok(device.resources.every((resource) => resource.destroys === 1));
  assert.equal(timer.beginFrame(), null);
});

test('device loss reports an error and an explicit later dispose ignores the device-loss callback', async () => {
  const device = fakeDevice();
  let lose;
  device.lost = new Promise((resolve) => { lose = resolve; });
  const timer = new GpuPassTimer(device);
  lose({ reason: 'unknown', message: 'test device lost' });
  await flush();
  assert.equal(timer.info().status, 'error');
  assert.match(timer.info().reason, /test device lost/);
  assert.equal(timer.beginFrame(), null);
  timer.dispose();
  const secondDevice = fakeDevice();
  let destroy;
  secondDevice.lost = new Promise((resolve) => { destroy = resolve; });
  const disposed = new GpuPassTimer(secondDevice);
  disposed.dispose();
  destroy({ reason: 'destroyed', message: '' });
  await flush();
  assert.equal(disposed.info().status, 'disposed');
  assert.equal(disposed.info().failedSamples, 0);
});

const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
async function fakeRenderer({ supported = true, gpuTiming = { sampleEveryFrames: 1 }, rejectTimestampFeature = false, lostPromise, instancePartitioning = false } = {}) {
  const device = fakeDevice({ supported });
  if (lostPromise) device.lost = lostPromise;
  const requests = [];
  const adapter = {
    features: new Set(['texture-compression-bc', ...(supported ? ['timestamp-query'] : [])]),
    async requestDevice(descriptor) {
      requests.push(descriptor);
      if (rejectTimestampFeature && descriptor.requiredFeatures.includes('timestamp-query')) throw new Error('Optional feature rejected');
      device.features = new Set(descriptor.requiredFeatures);
      return device;
    },
  };
  const context = { unconfigures: 0, configure() {}, unconfigure() { this.unconfigures++; }, getCurrentTexture: () => ({ createView: () => ({}) }) };
  const canvas = { clientWidth: 64, clientHeight: 48, width: 0, height: 0, getContext: () => context };
  const saved = ['navigator', 'window', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]);
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { gpu: { requestAdapter: async () => adapter, getPreferredCanvasFormat: () => 'bgra8unorm' } } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { devicePixelRatio: 1 } });
  Object.defineProperty(globalThis, 'fetch', { configurable: true, value: async () => { throw 'deterministic test fallback'; } });
  const renderer = await WebGPURenderer.create(canvas, 16, { gpuTiming, instancePartitioning });
  return { renderer, device, context, requests, restore() { for (const [key, descriptor] of saved) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } } };
}

test('raw renderer pass descriptors, quality replacement, and complete idempotent teardown preserve resource ownership', async () => {
  const fixture = await fakeRenderer();
  const { renderer, device, context } = fixture;
  try {
    renderer.writeSceneUniforms({ viewProjection: identity, lightViewProjection: identity, cameraPosition: [0, 4, 8], lightDirection: [0, -1, 0], fogColor: [0, 0, 0], timeSeconds: 0,
      quality: { sampleCount: 1, shadowMapSize: 1024, shadowTapCount: 1, shadowStrength: 1, resolutionScale: 1, exposure: 1, bloomStrength: 0, fogDensity: 0 } });
    renderer.uploadRopeGrid({ presentation: 'rope', positions: new Float32Array([0, 0, 0, 1, 1, 1]), segments: new Float32Array([0, 1, 1, .1, 1, 1, 1, 1]), nodeCount: 2, segmentCount: 1, topologyVersion: 1, frameVersion: 1 }, 0);
    const originalSubmit = device.queue.submit;
    device.queue.submit = () => { throw new Error('test submission failed'); };
    assert.throws(() => renderer.render(1, []), /test submission failed/);
    assert.equal(renderer.gpuTimingInfo().pendingSamples, 0, 'abandoned encoder must release its timing slot');
    device.queue.submit = originalSubmit;
    assert.ok(Number.isFinite(renderer.render(1, [])));
    const passes = device.encoders.at(-1).passes;
    assert.equal(passes.length, 4);
    assert.deepEqual(passes.map((pass) => pass.timestampWrites.beginningOfPassWriteIndex), [0, 2, 4, 6]);
    assert.equal(renderer.gpuTimingInfo().pendingSamples, 1);
    assert.equal(renderer.gpuTimingInfo().latest, null);
    assert.ok(device.resources.some((resource) => resource.destroys === 1), 'quality switch must release replaced attachments');
    renderer.dispose();
    renderer.destroy();
    assert.equal(renderer.isDisposed(), true);
    assert.equal(renderer.gpuTimingInfo().status, 'disposed');
    assert.equal(device.destroys, 1);
    assert.equal(context.unconfigures, 1);
    for (const resource of device.resources) assert.equal(resource.destroys, 1, resource.descriptor.label);
    assert.equal(renderer.matrixBuffer, null);
    assert.equal(renderer.mainPipelines, null);
    assert.equal(renderer.sceneBindGroup, null);
    assert.equal(renderer.materialAtlasSurfaceView, null);
    assert.deepEqual(renderer.viewport(), [0, 0]);
    for (const invoke of [() => renderer.render(0, []), () => renderer.resize(), () => renderer.writeSceneUniforms({}), () => renderer.uploadInstances({}, 0), () => renderer.uploadEffects(null, null, 0, 0, 0), () => renderer.uploadSoftInstances(null, null, 0, 0, 0), () => renderer.uploadSurface(null), () => renderer.uploadRopeGrid(null, 0)]) assert.throws(invoke, /disposed/);
    device.readbacks.find((buffer) => buffer.rejectMap)?.rejectMap(new Error('destroy canceled mapping'));
    await flush();
    assert.equal(renderer.gpuTimingInfo().failedSamples, 0);
  } finally { renderer.dispose(); fixture.restore(); }
});

test('raw renderer explicit disable and optional-feature fallback retain compression support', async () => {
  for (const options of [{ gpuTiming: false }, { rejectTimestampFeature: true }, { supported: false }]) {
    const fixture = await fakeRenderer(options);
    try {
      const info = fixture.renderer.gpuTimingInfo();
      assert.equal(info.status, options.gpuTiming === false ? 'disabled' : 'unsupported');
      assert.equal(info.latest, null);
      assert.ok(fixture.requests.every((request) => request.requiredFeatures.includes('texture-compression-bc')));
      if (options.rejectTimestampFeature) assert.equal(fixture.requests.length, 2);
      assert.equal(fixture.device.readbacks.length, 0);
      fixture.renderer.render(0, []);
      assert.ok(fixture.device.encoders[0].passes.every((pass) => pass.timestampWrites === undefined));
    } finally { fixture.renderer.dispose(); fixture.restore(); }
  }
});

test('renderer loss subscriptions handle early removal, late registration, and intentional disposal', async () => {
  let lose;
  const lostPromise = new Promise((resolve) => { lose = resolve; });
  const fixture = await fakeRenderer({ lostPromise });
  try {
    const events = [];
    const removed = fixture.renderer.onDeviceLost(() => events.push('removed'));
    removed();
    fixture.renderer.onDeviceLost((info) => {
      events.push(info.message);
      fixture.renderer.onDeviceLost(() => events.push('registered-during-notification'));
    });
    lose({ reason: 'unknown', message: 'simulated device loss' });
    await flush();
    assert.deepEqual(events, ['simulated device loss', 'registered-during-notification']);
    const lateRemoved = fixture.renderer.onDeviceLost(() => events.push('late-removed'));
    lateRemoved();
    fixture.renderer.onDeviceLost(() => events.push('late'));
    assert.equal(events.length, 2, 'late callbacks must not run inside registration');
    await flush();
    assert.deepEqual(events, ['simulated device loss', 'registered-during-notification', 'late']);
    fixture.renderer.onDeviceLost(() => events.push('disposed-before-callback'));
    fixture.renderer.dispose();
    await flush();
    assert.equal(events.length, 3);
    assert.equal(fixture.renderer.gpuTimingInfo().status, 'disposed');
  } finally { fixture.renderer.dispose(); fixture.restore(); }

  let intentionalDestroy;
  const disposedFixture = await fakeRenderer({ lostPromise: new Promise((resolve) => { intentionalDestroy = resolve; }) });
  let called = false;
  disposedFixture.renderer.onDeviceLost(() => { called = true; });
  disposedFixture.renderer.dispose();
  intentionalDestroy({ reason: 'destroyed', message: '' });
  await flush();
  assert.equal(called, false);
  disposedFixture.restore();
});

test('renderer rejects a stalled device request and destroys the device if it arrives after timeout', async () => {
  const original=Object.getOwnPropertyDescriptor(globalThis,'navigator');
  const device=fakeDevice();let resolveDevice,requests=0;
  const pending=new Promise(resolve=>{resolveDevice=resolve;});
  const adapter={features:new Set(),requestDevice(){requests++;return pending;}};
  Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{requestAdapter:async()=>adapter}}});
  try {
    await assert.rejects(WebGPURenderer.create({getContext:()=>({})},1,{startupTimeoutMs:20}),/timed out during Creating graphics device/);
    assert.equal(requests,1);assert.equal(device.destroys,0);
    resolveDevice(device);for(let i=0;i<8;i++)await Promise.resolve();assert.equal(device.destroys,1);
    assert.equal(device.resources.length,0);
  }finally{if(original)Object.defineProperty(globalThis,'navigator',original);else delete globalThis.navigator;}
});

function allocationScopes(device, { deferred = false, errorFilter = null } = {}) {
  const stack = [], pops = [], events = [];
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  device.pushErrorScope = filter => { stack.push(filter); events.push('push:' + filter); };
  device.popErrorScope = () => {
    const filter = stack.pop(); assert.ok(filter, 'balanced error scopes'); events.push('pop:' + filter);
    let resolve;
    const promise = deferred ? new Promise(done => { resolve = done; }) : Promise.resolve(filter === errorFilter ? { message: 'injected ' + filter } : null);
    pops.push({ filter, resolve }); if (pops.length === 2) ready(); return promise;
  };
  return { stack, pops, events, started, complete() { for (const pop of pops) pop.resolve?.(null); } };
}
function rigidSource(count = 16) {
  return { HEAPF32: new Float32Array(count * 20), _b3w_matrices_ptr: () => 0, _b3w_colors_ptr: () => count * 64,
    _b3w_body_count: () => count, _b3w_max_bodies: () => count, frameVersion: () => 1, colorVersion: () => 1 };
}

test('renderer growth preserves stream copies and rope bindings, reuses partition pipelines and releases replaced storage once', async () => {
  for (const instancePartitioning of [false, true]) {
    const fixture = await fakeRenderer({ gpuTiming: false, instancePartitioning });
    const { renderer, device } = fixture;
    try {
      const scopes = allocationScopes(device, { deferred: true });
      const original = [renderer.matrixBuffer, renderer.colorBuffer], partition = renderer.instancePartition;
      const pipelines = partition ? [...partition.pipelines] : null;
      const source = rigidSource(); assert.equal(renderer.uploadInstances(source, 16), 1280);
      const reservation = renderer.reserveInstanceCapacity(4096);
      await scopes.started;
      assert.equal(renderer.maxInstances, 16); assert.equal(renderer.instanceCapacityInfo().pending, true);
      assert.deepEqual(scopes.events, ['push:out-of-memory', 'push:validation', 'pop:validation', 'pop:out-of-memory']);
      assert.equal(scopes.stack.length, 0); assert.equal(device.queue.submissions, 0, 'validate allocation before submitting copy');
      source.frameVersion = () => 2; assert.equal(renderer.uploadInstances(source, 16), 1024, 'old buffers remain writable during validation');
      assert.equal(original[0].destroys, 0); scopes.complete();
      assert.equal(await reservation, 4096); assert.equal(renderer.maxInstances, 4096);
      assert.equal(device.queue.submissions, 1); assert.equal(renderer.instanceCapacityInfo().pending, false);
      assert.equal(renderer.uploadInstances(source, 16), 0, 'growth retains uploaded stream cache because GPU copy preserves it');
      const copies = device.encoders[0].copies;
      assert.deepEqual(copies, [[original[0], 0, renderer.matrixBuffer, 0, 16 * 64], [original[1], 0, renderer.colorBuffer, 0, 16 * 16]]);
      assert.ok(original.every(buffer => buffer.destroys === 1));
      assert.equal(renderer.ropeComputeBindGroup.descriptor.entries[3].resource.buffer, renderer.matrixBuffer);
      assert.equal(renderer.ropeComputeBindGroup.descriptor.entries[4].resource.buffer, renderer.colorBuffer);
      if (partition) {
        const replacement = renderer.instancePartition;
        assert.equal(replacement.capacity, 4096); assert.equal(replacement.vertexLayout, partition.vertexLayout);
        assert.deepEqual(replacement.pipelines, pipelines); assert.equal(partition.pipelines.length, 0);
        assert.equal(replacement.opaqueBindGroup.descriptor.entries[0].resource.buffer, renderer.matrixBuffer);
        assert.equal(replacement.computeBindGroup.descriptor.entries[1].resource.buffer, renderer.colorBuffer);
        assert.equal(replacement.needsUpdate(16), true); renderer.render(16, []);
        assert.equal(replacement.builds, 1, 'replacement partition rebuilds against new streams');
      }
      const allocations = device.resources.length;
      assert.equal(await renderer.reserveInstanceCapacity(1), 4096); assert.equal(device.resources.length, allocations);
      allocationScopes(device); assert.equal(await renderer.reserveInstanceCapacity(4097), 16384);
      renderer.dispose(); assert.ok(device.resources.every(resource => resource.destroys === 1));
    } finally { renderer.dispose(); fixture.restore(); }
  }
});

test('failed renderer growth keeps the current streams usable and destroys every replacement allocation', async () => {
  for (const failure of ['out-of-memory', 'validation', 'buffer', 'partition', 'bind-group', 'submit', 'pop']) {
    const fixture = await fakeRenderer({ gpuTiming: false, instancePartitioning: true });
    const { renderer, device } = fixture;
    try {
      allocationScopes(device, { errorFilter: failure });
      const original = [renderer.matrixBuffer, renderer.colorBuffer, renderer.instancePartition];
      const resourceStart = device.resources.length, submit = device.queue.submit, create = device.createBuffer, bind = device.createBindGroup, pop = device.popErrorScope;
      let calls = 0;
      device.createBuffer = descriptor => {
        if (++calls === (failure === 'buffer' ? 2 : failure === 'partition' ? 5 : -1)) throw new Error('injected ' + failure);
        return create(descriptor);
      };
      if (failure === 'bind-group') device.createBindGroup = () => { throw new Error('injected bind-group'); };
      if (failure === 'submit') device.queue.submit = () => { throw new Error('injected submit'); };
      if (failure === 'pop') device.popErrorScope = () => { pop(); throw new Error('injected pop'); };
      await assert.rejects(renderer.reserveInstanceCapacity(65536), error => {
        assert.match(error.message, /injected/);
        if (failure === 'out-of-memory') assert.equal(error.code, 'ALLOCATION_FAILED');
        if (failure === 'validation') assert.equal(error.code, 'INVALID_GPU_BUFFER');
        return true;
      });
      assert.equal(renderer.maxInstances, 16); assert.deepEqual([renderer.matrixBuffer, renderer.colorBuffer, renderer.instancePartition], original);
      assert.equal(original[0].destroys, 0); assert.equal(original[1].destroys, 0);
      assert.equal(renderer.instanceCapacityInfo().pending, false);
      assert.ok(device.resources.slice(resourceStart).every(resource => resource.destroys === 1));
      device.queue.submit = submit; device.createBuffer = create; device.createBindGroup = bind; allocationScopes(device);
      assert.equal(renderer.uploadInstances(rigidSource(), 16), 1280); renderer.render(16, []);
      assert.equal(await renderer.reserveInstanceCapacity(17), 4096, 'a rejected reservation can be retried');
      renderer.dispose(); assert.ok(device.resources.every(resource => resource.destroys === 1));
    } finally { renderer.dispose(); fixture.restore(); }
  }
});

test('capacity cancellation, timeout, disposal and device loss release pending buffers without committing them', async () => {
  for (const failure of ['cancel', 'timeout', 'dispose', 'loss']) {
    let lose;
    const fixture = await fakeRenderer({ gpuTiming: false, lostPromise: new Promise(resolve => { lose = resolve; }) });
    const { renderer, device } = fixture;
    try {
      const scopes = allocationScopes(device, { deferred: true }), controller = new AbortController();
      const start = device.resources.length;
      const reservation = renderer.reserveInstanceCapacity(65536, { signal: controller.signal, startupTimeoutMs: failure === 'timeout' ? 20 : 1000 });
      const rejected = assert.rejects(reservation, /cancelled|timed out|disposed|device was lost/);
      await scopes.started;
      if (failure === 'cancel') controller.abort();
      if (failure === 'dispose') renderer.dispose();
      if (failure === 'loss') { lose({ reason: 'unknown', message: 'test capacity loss' }); await flush(); }
      if (failure === 'dispose' || failure === 'loss') scopes.complete();
      await rejected; assert.equal(renderer.maxInstances, 16); assert.equal(device.queue.submissions, 0);
      scopes.complete(); await flush();
      assert.ok(device.resources.slice(start).every(resource => resource.destroys === 1));
      renderer.dispose(); assert.ok(device.resources.every(resource => resource.destroys === 1));
    } finally { renderer.dispose(); fixture.restore(); }
  }
});

test('concurrent capacity requests serialize, keep their own deadlines and survive an earlier cancellation', async () => {
  const fixture = await fakeRenderer({ gpuTiming: false }), { renderer, device } = fixture;
  try {
    const scopes = allocationScopes(device, { deferred: true }), firstController = new AbortController(), waitingController = new AbortController();
    const first = renderer.reserveInstanceCapacity(4096, { signal: firstController.signal });
    const firstRejection = assert.rejects(first, /cancelled/); await scopes.started;
    const resourceCount = device.resources.length;
    const canceledWait = renderer.reserveInstanceCapacity(65536, { signal: waitingController.signal });
    const waitRejection = assert.rejects(canceledWait, /cancelled/); waitingController.abort(); await waitRejection;
    await assert.rejects(renderer.reserveInstanceCapacity(65536, { startupTimeoutMs: 20 }), /timed out during Waiting/);
    assert.equal(device.resources.length, resourceCount); assert.equal(renderer.instanceCapacityInfo().pending, true);
    const second = renderer.reserveInstanceCapacity(65536), third = renderer.reserveInstanceCapacity(16384);
    allocationScopes(device); firstController.abort(); await firstRejection;
    assert.equal(await second, 65536); assert.equal(await third, 65536);
    assert.equal(device.queue.submissions, 1); scopes.complete(); await flush();
    renderer.dispose(); assert.ok(device.resources.every(resource => resource.destroys === 1));
  } finally { renderer.dispose(); fixture.restore(); }
});

test('capacity and stream boundaries fail before allocation or upload, while heap view relocation invalidates cached streams', async () => {
  const fixture = await fakeRenderer({ gpuTiming: false }), { renderer, device } = fixture;
  try {
    allocationScopes(device); const start = device.resources.length;
    for (const request of [-1, 0, 1.5, NaN, Infinity, 1048577]) await assert.rejects(renderer.reserveInstanceCapacity(request), RangeError);
    device.limits = { maxBufferSize: 8192, maxStorageBufferBindingSize: 4096 };
    await assert.rejects(renderer.reserveInstanceCapacity(4096), /buffer limits/);
    assert.equal(device.resources.length, start);
    const source = rigidSource(), writes = device.queue.writes;
    for (const count of [-1, 1.5, NaN, Infinity, 17]) {
      assert.throws(() => renderer.uploadInstances(source, count), RangeError);
      assert.throws(() => renderer.render(count, []), RangeError);
    }
    for (const override of [
      { _b3w_body_count: () => 17 }, { _b3w_max_bodies: () => 15 },
      { _b3w_matrices_ptr: () => -4 }, { _b3w_matrices_ptr: () => 2 }, { _b3w_matrices_ptr: () => 0x100000000 },
      { _b3w_colors_ptr: () => 1280 }, { _b3w_colors_ptr: () => NaN }, { HEAPF32: new Float32Array(1) },
    ]) assert.throws(() => renderer.uploadInstances({ ...source, ...override }, 16), RangeError);
    assert.equal(device.queue.writes, writes);
    const storage = new Float32Array(16 * 20 * 2);
    source.HEAPF32 = storage.subarray(0, 16 * 20); assert.equal(renderer.uploadInstances(source, 16), 1280);
    assert.equal(renderer.uploadInstances(source, 16), 0);
    source.HEAPF32 = storage.subarray(16 * 20); assert.equal(renderer.uploadInstances(source, 16), 1280, 'same ArrayBuffer at a new view offset is new storage');
  } finally { renderer.dispose(); fixture.restore(); }
});
