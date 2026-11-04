import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { openRuntime } from './hardware-runtime.mjs';
import { planSparseRecordUpload } from './sparse-upload.mjs';
import { balancedOrders, median, qualifyCases } from './statistics.mjs';
import { qualifyRenderer } from './renderer-qualification.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const root = process.env.BOX3D_R4_OUTPUT, deadline = Date.parse(process.env.BOX3D_R4_DEADLINE || '');
const emit = event => console.log('BOX3D_R4 ' + JSON.stringify({ at: new Date().toISOString(), ...event }));
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
const guard = () => { if (stopping || !Number.isFinite(deadline) || Date.now() >= deadline) throw new Error('Benchmark deadline reached'); };
const policies = [];
for (const callPenaltyBytes of [0, 256, 1024, 4096, 16384])
  for (const maxCalls of [1, 2, 4, 8, 16])
    for (const maxCoverageFraction of [0.25, 0.5, 0.75, 1])
      policies.push({ id: 'R4-' + String(policies.length + 1).padStart(3, '0'),
        options: { costCoalescing: true, callPenaltyBytes, maxCalls, maxCoverageFraction,
          minSavingsBytes: 4096, maxPlanningSpans: 256, gapRecords: 0 } });
assert.equal(policies.length, 100);
assert.equal(new Set(policies.map(p => JSON.stringify(p.options))).size, 100);
const workloads = [
  { name: 'matrix-contiguous', count: 65536, blocks: 1, blockSize: 128, matrix: true, color: false },
  { name: 'matrix-clustered', count: 65536, blocks: 16, blockSize: 32, matrix: true, color: false },
  { name: 'matrix-fragmented', count: 65536, blocks: 1024, blockSize: 1, matrix: true, color: false },
  { name: 'dual-contiguous', count: 32768, blocks: 1, blockSize: 256, matrix: true, color: true },
];
const width = 256, height = 256, frames = 4, pairsPerSet = 24, seeds = [0x1ad0f5, 0x72e391];
const shader = [
  '@group(0) @binding(0) var<storage, read> models: array<mat4x4<f32>>;',
  '@group(0) @binding(1) var<storage, read> colors: array<vec4<f32>>;',
  'struct Out { @builtin(position) pos:vec4<f32>, @location(0) color:vec4<f32> };',
  '@vertex fn vs(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32)->Out {',
  ' let p=array<vec2<f32>,3>(vec2<f32>(-1.,-1.),vec2<f32>(1.,-1.),vec2<f32>(0.,1.));',
  ' var o:Out; o.pos=models[i]*vec4<f32>(p[v],0.,1.);o.color=colors[i];return o;}',
  '@fragment fn fs(i:Out)->@location(0) vec4<f32>{return i.color;}',
].join('\n');
function state(count, seed) {
  const m = new Float32Array(count * 16), c = new Float32Array(count * 4);
  const columns = Math.ceil(Math.sqrt(count)), scale = 0.84 / columns;
  for (let i = 0; i < count; i++) {
    const o = i * 16; m[o] = m[o + 5] = scale; m[o + 10] = m[o + 15] = 1;
    m[o + 12] = -0.95 + 1.9 * ((i % columns) + 0.5) / columns;
    m[o + 13] = -0.95 + 1.9 * (Math.floor(i / columns) + 0.5) / columns;
    c[i * 4] = ((i * 7 + seed) % 251) / 251; c[i * 4 + 1] = ((i * 23 + seed) % 247) / 247;
    c[i * 4 + 2] = ((i * 41 + seed) % 239) / 239; c[i * 4 + 3] = 1;
  }
  return { m, c };
}
// Candidate-only dirty metadata construction is included in the measured window.
function mutate(data, spec, frame, seed, needMetadata) {
  const spans = needMetadata ? [] : null, stride = Math.floor(spec.count / spec.blocks);
  const shift = (seed + frame * 7) % Math.max(1, stride - spec.blockSize);
  for (let b = 0; b < spec.blocks; b++) {
    const start = b * stride + shift;
    if (spans) spans.push({ start, count: spec.blockSize });
    for (let i = start; i < start + spec.blockSize; i++) {
      if (spec.matrix) data.m[i * 16 + 12] += Math.fround(0.00007 * ((frame % 3) + 1));
      if (spec.color) data.c[i * 4] = Math.fround((data.c[i * 4] + 0.017) % 1);
    }
  }
  return spans;
}
async function main() {
  guard();
  if (!root || deadline - Date.now() > 45 * 60_000) throw new Error('Explicit output and deadline <=45 minutes required');
  await mkdir(root, { recursive: false, mode: 0o700 }); await mkdir(root + '/cases', { mode: 0o700 });
  const sourceManifest = JSON.parse(await readFile(new URL('./source-manifest.json', import.meta.url), 'utf8'));
  const plan = { schema: 'box3d.round4.100.v1', createdAt: new Date().toISOString(), deadline: new Date(deadline).toISOString(),
    policies, workloads, seeds, frames, pairsPerSet, sets: 2, directionalHolmFamily: 400, minimumSpeedup: 1.03, tailLimit: 1.10, sourceManifest,
    scope: '100 distinct upload policies; four controlled producer workloads per policy. Native Vulkan fixture followed by actual Box3D renderer/native scene confirmation.',
    primaryMetric: 'CPU mutation, candidate-only dirty metadata, planning, writes, render submission and queue completion per frame; excludes readback mapping, reset/allocation and compilation.',
    gpuMetric: 'Timestamp-query render-pass duration only; excludes uploads/copy gaps. Not browser presentation latency or whole-game FPS.',
    orders: 'Seeded balanced shuffle of AB/BA, 12 of each per 24-pair set.' };
  await writeFile(root + '/plan.json', JSON.stringify(plan, null, 2));
  emit({ event: 'start', policies: 100, planSha256: sha(JSON.stringify(plan)), deadline: plan.deadline });
  const runtime = await openRuntime({ width, height, packageRoot: process.env.WEBGPU_PACKAGE_ROOT });
  let device, intentionalDestroy = false, fatal = null, pixelChecks = 0, bufferChecks = 0;
  const uncaptured = [];
  try {
    const adapter = await navigator.gpu.requestAdapter();
    device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
    device.addEventListener('uncapturederror', event => { uncaptured.push(event.error.message); });
    void device.lost.then(info => { if (!intentionalDestroy) fatal = 'Device lost: ' + info.message; });
    const check = () => { guard(); if (fatal || uncaptured.length) throw new Error(fatal || uncaptured.join('\n')); };
    const context = runtime.canvas.getContext('webgpu'); context.configure({ device, format: 'rgba8unorm' });
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code: shader }), diagnostics = await module.getCompilationInfo();
    assert.equal(diagnostics.messages.filter(m => m.type === 'error').length, 0, 'shader must compile');
    const pipeline = device.createRenderPipeline({ layout: 'auto',
      vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba8unorm' }] },
      primitive: { topology: 'triangle-list' } });
    const query = device.createQuerySet({ type: 'timestamp', count: 2 });
    const resolve = device.createBuffer({ size: 16, usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC });
    const readback = device.createBuffer({ size: frames * 16, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    function target() {
      const usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC;
      const m = device.createBuffer({ size: 65536 * 64, usage }), c = device.createBuffer({ size: 65536 * 16, usage });
      const bind = device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
        entries: [{ binding: 0, resource: { buffer: m } }, { binding: 1, resource: { buffer: c } }] });
      return { m, c, bind };
    }
    const targets = [target(), target()];
    assert.equal(await device.popErrorScope(), null, 'GPU initialization must validate');
    function draw(t, count, frame) {
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginRenderPass({ colorAttachments: [{ view: context.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
        timestampWrites: { querySet: query, beginningOfPassWriteIndex: 0, endOfPassWriteIndex: 1 } });
      pass.setPipeline(pipeline); pass.setBindGroup(0, t.bind); pass.draw(3, count); pass.end();
      // Resolve in the command buffer that writes the queries, then preserve
      // each frame's copied values before the query set is reused.
      encoder.resolveQuerySet(query, 0, 2, resolve, 0);
      encoder.copyBufferToBuffer(resolve, 0, readback, frame * 16, 16);
      device.queue.submit([encoder.finish()]);
    }
    async function bufferBytes(source, size) {
      const b = device.createBuffer({ size, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyBufferToBuffer(source, 0, b, 0, size); device.queue.submit([encoder.finish()]);
        await b.mapAsync(GPUMapMode.READ); return Buffer.from(new Uint8Array(b.getMappedRange()));
      } finally { b.unmap(); b.destroy(); }
    }
    async function capture(t, data, spec) {
      const b = device.createBuffer({ size: width * height * 4, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      let pixels;
      try {
        const encoder = device.createCommandEncoder();
        encoder.copyTextureToBuffer({ texture: context.getCurrentTexture() },
          { buffer: b, bytesPerRow: width * 4 }, [width, height]); device.queue.submit([encoder.finish()]);
        await b.mapAsync(GPUMapMode.READ); pixels = Buffer.from(new Uint8Array(b.getMappedRange()));
      } finally { b.unmap(); b.destroy(); }
      const unique = new Set();
      for (let i = 0; i < pixels.length; i += 4) unique.add(pixels.readUInt32LE(i));
      assert.ok(unique.size > 16, 'render must contain many non-background pixels');
      const m = await bufferBytes(t.m, spec.count * 64), c = await bufferBytes(t.c, spec.count * 16);
      assert.equal(sha(m), sha(Buffer.from(data.m.buffer)), 'all GPU matrices must match CPU source');
      assert.equal(sha(c), sha(Buffer.from(data.c.buffer)), 'all GPU colors must match CPU source');
      bufferChecks += 2; pixelChecks++;
      return { pixelSha256: sha(pixels), matrixSha256: sha(m), colorSha256: sha(c), uniqueColors: unique.size };
    }
    async function run(spec, policy, candidate, seed, firstFrame, readPixels) {
      check();
      const data = state(spec.count, seed), t = targets[candidate ? 1 : 0];
      device.queue.writeBuffer(t.m, 0, data.m); device.queue.writeBuffer(t.c, 0, data.c);
      await device.queue.onSubmittedWorkDone();
      let bytes = 0, calls = 0, plannerMs = 0;
      const begun = performance.now();
      for (let frame = 0; frame < frames; frame++) {
        const spans = mutate(data, spec, frame + firstFrame, seed, candidate);
        for (const [key, changed, recordBytes] of [['m', spec.matrix, 64], ['c', spec.color, 16]]) {
          if (!changed) continue;
          const start = performance.now();
          const p = candidate ? planSparseRecordUpload(spec.count, recordBytes, spans, policy.options) : null;
          plannerMs += performance.now() - start;
          const ranges = p?.spans ?? [{ start: 0, count: spec.count }];
          for (const span of ranges) {
            const offset = span.start * recordBytes, length = span.count * recordBytes;
            device.queue.writeBuffer(t[key], offset, data[key].buffer, offset, length); bytes += length; calls++;
          }
        }
        draw(t, spec.count, frame);
      }
      const encodeEnd = performance.now();
      await device.queue.onSubmittedWorkDone();
      const ms = (performance.now() - begun) / frames;
      await readback.mapAsync(GPUMapMode.READ);
      const queries = [...new BigUint64Array(readback.getMappedRange())]; readback.unmap();
      const gpuMs = [];
      for (let frame = 0; frame < frames; frame++) {
        const delta = queries[2 * frame + 1] - queries[2 * frame];
        assert.ok(delta > 0n && delta < 5_000_000_000n,
          `valid nonzero GPU timestamps required: frame=${frame} queries=${queries.map(String).join(',')}`);
        gpuMs.push(Number(delta) / 1e6);
      }
      check();
      return { ms, cpuEncodeMs: (encodeEnd - begun) / frames, plannerMs: plannerMs / frames,
        gpuMs, queryNs: queries.map(String), bytes: bytes / frames, calls: calls / frames,
        capture: readPixels ? await capture(t, data, spec) : null };
    }
    // Exercise and verify compute as well as render before hashing lazy-loaded
    // native driver libraries. This untimed marker is not a performance sample.
    const marker = device.createBuffer({ size: 4, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC });
    device.pushErrorScope('validation');
    const computeModule = device.createShaderModule({ code:
      '@group(0) @binding(0) var<storage,read_write> value:array<u32>; @compute @workgroup_size(1) fn main(){ value[0]=0xb3d0004u; }' });
    const computePipeline = device.createComputePipeline({ layout: 'auto', compute: { module: computeModule, entryPoint: 'main' } });
    const computeBind = device.createBindGroup({ layout: computePipeline.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: marker } }] });
    const computeEncoder = device.createCommandEncoder(), computePass = computeEncoder.beginComputePass();
    computePass.setPipeline(computePipeline); computePass.setBindGroup(0, computeBind); computePass.dispatchWorkgroups(1); computePass.end();
    device.queue.submit([computeEncoder.finish()]);
    assert.equal((await bufferBytes(marker, 4)).readUInt32LE(0), 0xb3d0004, 'native compute must execute correctly');
    assert.equal(await device.popErrorScope(), null); marker.destroy();
    await run(workloads[0], policies[0], false, seeds[0], 0, true);
    await runtime.finalizeIdentity();
    await writeFile(root + '/hardware.json', JSON.stringify(runtime.meta, null, 2));
    const hardwareBefore = await runtime.sampleTelemetry(), cases = [];
    const order = [...policies].sort((a, b) => sha(a.id + ':20261105').localeCompare(sha(b.id + ':20261105')));
    for (const policy of order) {
      check(); device.pushErrorScope('validation');
      for (let w = 0; w < workloads.length; w++) {
        await run(workloads[w], policy, false, 0x71922, w, false);
        await run(workloads[w], policy, true, 0x71922, w, false);
      }
      const row = { id: policy.id, policy: policy.options, sets: [] };
      for (let set = 0; set < seeds.length; set++) {
        const pairs = [], orders = balancedOrders(pairsPerSet, seeds[set] ^ Number(policy.id.slice(3)));
        for (let pair = 0; pair < pairsPerSet; pair++) {
          const spec = workloads[pair % workloads.length], seed = seeds[set] + pair * 109, values = {};
          for (const candidate of (orders[pair] ? [true, false] : [false, true]))
            values[candidate ? 'candidate' : 'baseline'] = await run(spec, policy, candidate, seed, pair * frames, pair < workloads.length);
          if (values.baseline.capture) assert.equal(values.baseline.capture.pixelSha256, values.candidate.capture.pixelSha256,
            'full/sparse rendered pixels must be bit-exact');
          pairs.push({ workload: spec.name, candidateFirst: orders[pair], baselineMs: values.baseline.ms,
            candidateMs: values.candidate.ms, baseline: values.baseline, candidate: values.candidate });
        }
        row.sets.push({ seed: seeds[set], pairs });
      }
      assert.equal(await device.popErrorScope(), null, 'each complete case must validate');
      cases.push(row);
      const text = JSON.stringify(row);
      await writeFile(root + '/cases/' + row.id + '.json', text + '\n');
      emit({ event: 'case', id: row.id, completed: cases.length, sha256: sha(text + '\n'),
        medianSpeedup: row.sets.map(s => median(s.pairs.map(p => p.baselineMs / p.candidateMs))) });
    }
    cases.sort((a, b) => a.id.localeCompare(b.id));
    const qualified = qualifyCases(cases);
    const summary = { schema: 'box3d.round4.100.result.v1', completedAt: new Date().toISOString(),
      cases: qualified, pixelChecks, bufferChecks, uncaptured, hardware: runtime.meta, hardwareBefore,
      hardwareAfter: await runtime.sampleTelemetry(), sourceManifest, planSha256: sha(JSON.stringify(plan)) };
    await writeFile(root + '/gpu-100.json', JSON.stringify(summary, null, 2));
    const ranked = [...cases].sort((a, b) => median(b.sets.flatMap(s => s.pairs.map(p => p.baselineMs / p.candidateMs))) -
      median(a.sets.flatMap(s => s.pairs.map(p => p.baselineMs / p.candidateMs))));
    const selected = ranked.slice(0, 3).map(r => ({ id: r.id, options: r.policy }));
    emit({ event: 'gpu100-finished', pixelChecks, bufferChecks, selected,
      statuses: qualified.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {}) });
    targets.forEach(t => { t.m.destroy(); t.c.destroy(); });
    query.destroy(); resolve.destroy(); readback.destroy();
    intentionalDestroy = true; device.destroy(); device = null;
    await qualifyRenderer({ runtime, outputRoot: root, guard, emit, policies: selected });
    emit({ event: 'complete', cases: 100, outputRoot: root });
  } finally { intentionalDestroy = true; device?.destroy(); runtime.close(); }
}
main().catch(async error => {
  emit({ event: 'failed', error: error.stack || String(error) });
  if (root) await writeFile(root + '/failure.json', JSON.stringify({ error: error.stack || String(error) })).catch(() => {});
  process.exitCode = 1;
});
