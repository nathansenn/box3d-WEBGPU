import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { create, globals } from 'webgpu';

Object.assign(globalThis, globals);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const WIDTH = Number(process.env.GPU_BENCH_WIDTH ?? 1920);
const HEIGHT = Number(process.env.GPU_BENCH_HEIGHT ?? 1080);
const INSTANCE_COUNT = Number(process.env.GPU_BENCH_INSTANCES ?? 4096);
const WARMUP_FRAMES = Number(process.env.GPU_BENCH_WARMUPS ?? 48);
const BATCHES = Number(process.env.GPU_BENCH_BATCHES ?? 13);
const FRAMES_PER_BATCH = Number(process.env.GPU_BENCH_FRAMES_PER_BATCH ?? 24);
const OUTPUT_FORMAT = 'bgra8unorm';
const HDR_FORMAT = 'rgba16float';
const DEPTH_FORMAT = 'depth24plus';
const SHADOW_FORMAT = 'depth32float';

const qualityCases = [
  { shadowSize: 0, pcfTaps: 0, label: 'shadow-off' },
  { shadowSize: 1024, pcfTaps: 1, label: 'shadow-1024-pcf1' },
  { shadowSize: 1024, pcfTaps: 9, label: 'shadow-1024-pcf9' },
  { shadowSize: 2048, pcfTaps: 9, label: 'shadow-2048-pcf9' },
].flatMap((shadow) => [1, 2, 4].map((sampleCount) => ({ ...shadow, sampleCount })));

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
  return { median: median(values), mad: mad(values), min: Math.min(...values), max: Math.max(...values) };
}

function normalize3([x, y, z]) {
  const inverseLength = 1 / Math.hypot(x, y, z);
  return [x * inverseLength, y * inverseLength, z * inverseLength];
}

function cross3([ax, ay, az], [bx, by, bz]) {
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function dot3([ax, ay, az], [bx, by, bz]) {
  return ax * bx + ay * by + az * bz;
}

function lookAt(eye, target, up) {
  const z = normalize3([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  const x = normalize3(cross3(up, z));
  const y = cross3(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot3(x, eye), -dot3(y, eye), -dot3(z, eye), 1,
  ]);
}

function orthographic(left, right, bottom, top, near, far) {
  return new Float32Array([
    2 / (right - left), 0, 0, 0,
    0, 2 / (top - bottom), 0, 0,
    0, 0, 1 / (near - far), 0,
    -(right + left) / (right - left),
    -(top + bottom) / (top - bottom),
    near / (near - far),
    1,
  ]);
}

function multiply4(a, b) {
  const result = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      result[column * 4 + row] =
        a[row] * b[column * 4] +
        a[4 + row] * b[column * 4 + 1] +
        a[8 + row] * b[column * 4 + 2] +
        a[12 + row] * b[column * 4 + 3];
    }
  }
  return result;
}

function createCubeVertices() {
  const faces = [
    [[1, 0, 0], [[1, -1, -1], [1, 1, -1], [1, 1, 1], [1, -1, 1]]],
    [[-1, 0, 0], [[-1, -1, 1], [-1, 1, 1], [-1, 1, -1], [-1, -1, -1]]],
    [[0, 1, 0], [[-1, 1, -1], [-1, 1, 1], [1, 1, 1], [1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, 1], [-1, -1, -1], [1, -1, -1], [1, -1, 1]]],
    [[0, 0, 1], [[1, -1, 1], [1, 1, 1], [-1, 1, 1], [-1, -1, 1]]],
    [[0, 0, -1], [[-1, -1, -1], [-1, 1, -1], [1, 1, -1], [1, -1, -1]]],
  ];
  const data = [];
  for (const [normal, corners] of faces) {
    for (const index of [0, 1, 2, 0, 2, 3]) data.push(...corners[index].map((x) => x * 0.34), ...normal);
  }
  return new Float32Array(data);
}

function shaderSource(pcfTaps) {
  const shadowExpression = pcfTaps === 0
    ? 'return 1.0;'
    : pcfTaps === 1
      ? `
  let sampled = textureSampleCompareLevel(shadowTexture, shadowSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), depth);
  return select(1.0, sampled, inBounds);`
      : `
  var visibility = 0.0;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let offset = vec2f(f32(x), f32(y)) * scene.params.x;
      visibility += textureSampleCompareLevel(shadowTexture, shadowSampler, clamp(uv + offset, vec2f(0.0), vec2f(1.0)), depth);
    }
  }
  return select(1.0, visibility / 9.0, inBounds);`;

  return /* wgsl */`
struct Scene {
  viewProjection: mat4x4f,
  lightViewProjection: mat4x4f,
  cameraPosition: vec4f,
  lightDirection: vec4f,
  params: vec4f,
};

@group(0) @binding(0) var<uniform> scene: Scene;
@group(0) @binding(1) var shadowTexture: texture_depth_2d;
@group(0) @binding(2) var shadowSampler: sampler_comparison;

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @builtin(instance_index) instanceIndex: u32,
};

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) worldPosition: vec3f,
  @location(1) normal: vec3f,
  @location(2) shadowPosition: vec4f,
  @location(3) color: vec3f,
};

fn instanceOffset(index: u32) -> vec3f {
  let x = f32(index & 63u) - 31.5;
  let z = f32((index >> 6u) & 63u) - 31.5;
  let wave = sin(x * 0.31) * cos(z * 0.27);
  return vec3f(x * 0.76, 0.75 + wave * 0.75, z * 0.76);
}

fn worldPosition(position: vec3f, index: u32) -> vec3f {
  if (index == u32(scene.params.y)) {
    return position * vec3f(76.0, 0.12, 76.0) + vec3f(0.0, -0.28, 0.0);
  }
  return position + instanceOffset(index);
}

@vertex fn vsMain(input: VertexInput) -> VertexOutput {
  let world = worldPosition(input.position, input.instanceIndex);
  var output: VertexOutput;
  output.position = scene.viewProjection * vec4f(world, 1.0);
  output.worldPosition = world;
  output.normal = input.normal;
  output.shadowPosition = scene.lightViewProjection * vec4f(world, 1.0);
  let hue = f32(input.instanceIndex & 31u) / 31.0;
  output.color = mix(vec3f(0.055, 0.25, 0.82), vec3f(0.95, 0.24, 0.045), hue);
  return output;
}

@vertex fn vsShadow(input: VertexInput) -> @builtin(position) vec4f {
  let world = worldPosition(input.position, input.instanceIndex);
  return scene.lightViewProjection * vec4f(world, 1.0);
}

fn shadowVisibility(shadowPosition: vec4f) -> f32 {
  let projected = shadowPosition.xyz / shadowPosition.w;
  let uv = projected.xy * vec2f(0.5, -0.5) + vec2f(0.5);
  let depth = projected.z - 0.0012;
  let inBounds = all(uv >= vec2f(0.0)) && all(uv <= vec2f(1.0)) && depth >= 0.0 && depth <= 1.0;
  ${shadowExpression}
}

@fragment fn fsMain(input: VertexOutput) -> @location(0) vec4f {
  let normal = normalize(input.normal);
  let light = normalize(-scene.lightDirection.xyz);
  let view = normalize(scene.cameraPosition.xyz - input.worldPosition);
  let halfVector = normalize(light + view);
  let diffuse = max(dot(normal, light), 0.0);
  let specular = pow(max(dot(normal, halfVector), 0.0), 48.0);
  let shadow = shadowVisibility(input.shadowPosition);
  let ambient = 0.065 + 0.06 * max(normal.y, 0.0);
  let lit = input.color * (ambient + diffuse * shadow * 1.35) + vec3f(specular * shadow * 1.75);
  return vec4f(lit, 1.0);
}
`;
}

const postShader = /* wgsl */`
@group(0) @binding(0) var hdrTexture: texture_2d<f32>;
@group(0) @binding(1) var hdrSampler: sampler;

struct PostOutput {
  @builtin(position) position: vec4f,
  @location(0) uv: vec2f,
};

@vertex fn vsPost(@builtin(vertex_index) index: u32) -> PostOutput {
  let positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  var output: PostOutput;
  output.position = vec4f(positions[index], 0.0, 1.0);
  output.uv = positions[index] * vec2f(0.5, -0.5) + vec2f(0.5);
  return output;
}

fn aces(color: vec3f) -> vec3f {
  let a = 2.51;
  let b = 0.03;
  let c = 2.43;
  let d = 0.59;
  let e = 0.14;
  return clamp((color * (a * color + b)) / (color * (c * color + d) + e), vec3f(0.0), vec3f(1.0));
}

@fragment fn fsPost(input: PostOutput) -> @location(0) vec4f {
  let hdr = textureSampleLevel(hdrTexture, hdrSampler, input.uv, 0.0).rgb;
  let centered = input.uv * 2.0 - vec2f(1.0);
  let vignette = clamp(1.0 - dot(centered, centered) * 0.16, 0.55, 1.0);
  let mapped = pow(aces(hdr * 1.12) * vignette, vec3f(1.0 / 2.2));
  return vec4f(mapped, 1.0);
}
`;

function bufferWithData(device, label, data, usage) {
  const buffer = device.createBuffer({ label, size: Math.max(4, (data.byteLength + 3) & ~3), usage, mappedAtCreation: true });
  new Uint8Array(buffer.getMappedRange()).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  buffer.unmap();
  return buffer;
}

async function createCase(device, config, shared) {
  const shadowExtent = Math.max(1, config.shadowSize);
  const shadowTexture = device.createTexture({
    label: `${config.label} shadow`,
    size: [shadowExtent, shadowExtent],
    format: SHADOW_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const depthTexture = device.createTexture({
    label: `${config.sampleCount}x depth`,
    size: [WIDTH, HEIGHT],
    sampleCount: config.sampleCount,
    format: DEPTH_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  });
  const hdrTexture = device.createTexture({
    label: 'resolved HDR',
    size: [WIDTH, HEIGHT],
    format: HDR_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
  });
  const msaaTexture = config.sampleCount > 1 ? device.createTexture({
    label: `${config.sampleCount}x HDR`,
    size: [WIDTH, HEIGHT],
    sampleCount: config.sampleCount,
    format: HDR_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT,
  }) : null;
  const outputTexture = device.createTexture({
    label: 'post output',
    size: [WIDTH, HEIGHT],
    format: OUTPUT_FORMAT,
    usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
  });

  const sceneModule = device.createShaderModule({ label: `${config.label} scene shader`, code: shaderSource(config.pcfTaps) });
  const postModule = device.createShaderModule({ label: 'post shader', code: postShader });
  const [scenePipeline, shadowPipeline, postPipeline] = await Promise.all([
    device.createRenderPipelineAsync({
      label: `${config.sampleCount}x ${config.label} scene pipeline`,
      layout: shared.scenePipelineLayout,
      vertex: {
        module: sceneModule,
        entryPoint: 'vsMain',
        buffers: [{ arrayStride: 24, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
        ] }],
      },
      fragment: { module: sceneModule, entryPoint: 'fsMain', targets: [{ format: HDR_FORMAT }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: DEPTH_FORMAT, depthWriteEnabled: true, depthCompare: 'less' },
      multisample: { count: config.sampleCount },
    }),
    device.createRenderPipelineAsync({
      label: `${config.label} shadow pipeline`,
      layout: shared.shadowPipelineLayout,
      vertex: {
        module: sceneModule,
        entryPoint: 'vsShadow',
        buffers: [{ arrayStride: 24, attributes: [
          { shaderLocation: 0, offset: 0, format: 'float32x3' },
          { shaderLocation: 1, offset: 12, format: 'float32x3' },
        ] }],
      },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: {
        format: SHADOW_FORMAT,
        depthWriteEnabled: true,
        depthCompare: 'less',
        depthBias: 2,
        depthBiasSlopeScale: 1.5,
      },
    }),
    device.createRenderPipelineAsync({
      label: 'HDR post pipeline',
      layout: shared.postPipelineLayout,
      vertex: { module: postModule, entryPoint: 'vsPost' },
      fragment: { module: postModule, entryPoint: 'fsPost', targets: [{ format: OUTPUT_FORMAT }] },
      primitive: { topology: 'triangle-list' },
    }),
  ]);

  const sceneBindGroup = device.createBindGroup({
    label: `${config.label} scene bind group`,
    layout: shared.sceneBindGroupLayout,
    entries: [
      { binding: 0, resource: { buffer: shared.uniformBuffer } },
      { binding: 1, resource: shadowTexture.createView() },
      { binding: 2, resource: shared.shadowSampler },
    ],
  });
  const postBindGroup = device.createBindGroup({
    label: 'post bind group',
    layout: shared.postBindGroupLayout,
    entries: [
      { binding: 0, resource: hdrTexture.createView() },
      { binding: 1, resource: shared.postSampler },
    ],
  });

  return {
    ...config,
    scenePipeline,
    shadowPipeline,
    postPipeline,
    sceneBindGroup,
    postBindGroup,
    shadowView: shadowTexture.createView(),
    depthView: depthTexture.createView(),
    hdrView: hdrTexture.createView(),
    msaaView: msaaTexture?.createView() ?? null,
    outputTexture,
    outputView: outputTexture.createView(),
    destroy() {
      shadowTexture.destroy();
      depthTexture.destroy();
      hdrTexture.destroy();
      msaaTexture?.destroy();
      outputTexture.destroy();
    },
  };
}

function encodeFrame(encoder, resources, shared, timestampWrites) {
  const firstPassQuery = timestampWrites ? timestampWrites.base : 0;
  let queryOffset = 0;
  if (resources.shadowSize > 0) {
    const pass = encoder.beginRenderPass({
      label: 'shadow pass',
      colorAttachments: [],
      depthStencilAttachment: {
        view: resources.shadowView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
      timestampWrites: timestampWrites ? {
        querySet: timestampWrites.querySet,
        beginningOfPassWriteIndex: firstPassQuery,
        endOfPassWriteIndex: firstPassQuery + 1,
      } : undefined,
    });
    pass.setPipeline(resources.shadowPipeline);
    pass.setBindGroup(0, shared.shadowBindGroup);
    pass.setVertexBuffer(0, shared.vertexBuffer);
    pass.draw(36, INSTANCE_COUNT + 1);
    pass.end();
    queryOffset = 2;
  }

  const scenePass = encoder.beginRenderPass({
    label: 'HDR scene pass',
    colorAttachments: [{
      view: resources.msaaView ?? resources.hdrView,
      resolveTarget: resources.msaaView ? resources.hdrView : undefined,
      clearValue: { r: 0.008, g: 0.016, b: 0.035, a: 1 },
      loadOp: 'clear',
      storeOp: resources.msaaView ? 'discard' : 'store',
    }],
    depthStencilAttachment: {
      view: resources.depthView,
      depthClearValue: 1,
      depthLoadOp: 'clear',
      depthStoreOp: 'discard',
    },
    timestampWrites: timestampWrites ? {
      querySet: timestampWrites.querySet,
      beginningOfPassWriteIndex: firstPassQuery + queryOffset,
      endOfPassWriteIndex: firstPassQuery + queryOffset + 1,
    } : undefined,
  });
  scenePass.setPipeline(resources.scenePipeline);
  scenePass.setBindGroup(0, resources.sceneBindGroup);
  scenePass.setVertexBuffer(0, shared.vertexBuffer);
  scenePass.draw(36, INSTANCE_COUNT + 1);
  scenePass.end();

  const postPass = encoder.beginRenderPass({
    label: 'post pass',
    colorAttachments: [{
      view: resources.outputView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
    timestampWrites: timestampWrites ? {
      querySet: timestampWrites.querySet,
      beginningOfPassWriteIndex: firstPassQuery + queryOffset + 2,
      endOfPassWriteIndex: firstPassQuery + queryOffset + 3,
    } : undefined,
  });
  postPass.setPipeline(resources.postPipeline);
  postPass.setBindGroup(0, resources.postBindGroup);
  postPass.draw(3);
  postPass.end();
}

function submitBatch(device, resources, shared, frameCount, measured) {
  const queriesPerFrame = resources.shadowSize > 0 ? 6 : 4;
  const queryCount = queriesPerFrame * frameCount;
  const querySet = measured ? device.createQuerySet({ label: 'frame timestamps', type: 'timestamp', count: queryCount }) : null;
  const resolveBuffer = measured ? device.createBuffer({
    label: 'timestamp resolve',
    size: queryCount * 8,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  }) : null;
  const readBuffer = measured ? device.createBuffer({
    label: 'timestamp readback',
    size: queryCount * 8,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  }) : null;

  const encodeStart = performance.now();
  const encoder = device.createCommandEncoder({ label: 'quality benchmark batch' });
  for (let frame = 0; frame < frameCount; frame++) {
    encodeFrame(encoder, resources, shared, measured ? { querySet, base: frame * queriesPerFrame } : null);
  }
  if (measured) {
    encoder.resolveQuerySet(querySet, 0, queryCount, resolveBuffer, 0);
    encoder.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, queryCount * 8);
  }
  const commandBuffer = encoder.finish();
  const encodeEnd = performance.now();
  const submitStart = performance.now();
  device.queue.submit([commandBuffer]);
  const submitEnd = performance.now();

  return {
    queriesPerFrame,
    querySet,
    resolveBuffer,
    readBuffer,
    encodeMsPerFrame: (encodeEnd - encodeStart) / frameCount,
    submitMsPerFrame: (submitEnd - submitStart) / frameCount,
  };
}

function isolatedTimestampWrites(querySet, first, last) {
  if (!first && !last) return undefined;
  return {
    querySet,
    beginningOfPassWriteIndex: first ? 0 : undefined,
    endOfPassWriteIndex: last ? 1 : undefined,
  };
}

function encodeIsolatedPass(encoder, kind, resources, shared, timestampWrites) {
  if (kind === 'shadow') {
    const pass = encoder.beginRenderPass({
      label: 'isolated shadow pass',
      colorAttachments: [],
      depthStencilAttachment: {
        view: resources.shadowView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'store',
      },
      timestampWrites,
    });
    pass.setPipeline(resources.shadowPipeline);
    pass.setBindGroup(0, shared.shadowBindGroup);
    pass.setVertexBuffer(0, shared.vertexBuffer);
    pass.draw(36, INSTANCE_COUNT + 1);
    pass.end();
    return;
  }
  if (kind === 'scene') {
    const pass = encoder.beginRenderPass({
      label: 'isolated HDR scene pass',
      colorAttachments: [{
        view: resources.msaaView ?? resources.hdrView,
        resolveTarget: resources.msaaView ? resources.hdrView : undefined,
        clearValue: { r: 0.008, g: 0.016, b: 0.035, a: 1 },
        loadOp: 'clear',
        storeOp: resources.msaaView ? 'discard' : 'store',
      }],
      depthStencilAttachment: {
        view: resources.depthView,
        depthClearValue: 1,
        depthLoadOp: 'clear',
        depthStoreOp: 'discard',
      },
      timestampWrites,
    });
    pass.setPipeline(resources.scenePipeline);
    pass.setBindGroup(0, resources.sceneBindGroup);
    pass.setVertexBuffer(0, shared.vertexBuffer);
    pass.draw(36, INSTANCE_COUNT + 1);
    pass.end();
    return;
  }
  const pass = encoder.beginRenderPass({
    label: 'isolated post pass',
    colorAttachments: [{
      view: resources.outputView,
      clearValue: { r: 0, g: 0, b: 0, a: 1 },
      loadOp: 'clear',
      storeOp: 'store',
    }],
    timestampWrites,
  });
  pass.setPipeline(resources.postPipeline);
  pass.setBindGroup(0, resources.postBindGroup);
  pass.draw(3);
  pass.end();
}

function submitIsolatedPassBatch(device, kind, resources, shared, passCount) {
  const querySet = device.createQuerySet({ label: `isolated ${kind} timestamps`, type: 'timestamp', count: 2 });
  const resolveBuffer = device.createBuffer({
    label: `isolated ${kind} timestamp resolve`,
    size: 16,
    usage: GPUBufferUsage.QUERY_RESOLVE | GPUBufferUsage.COPY_SRC,
  });
  const readBuffer = device.createBuffer({
    label: `isolated ${kind} timestamp readback`,
    size: 16,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: `isolated ${kind} benchmark batch` });
  for (let pass = 0; pass < passCount; pass++) {
    encodeIsolatedPass(
      encoder,
      kind,
      resources,
      shared,
      isolatedTimestampWrites(querySet, pass === 0, pass === passCount - 1),
    );
  }
  encoder.resolveQuerySet(querySet, 0, 2, resolveBuffer, 0);
  encoder.copyBufferToBuffer(resolveBuffer, 0, readBuffer, 0, 16);
  device.queue.submit([encoder.finish()]);
  return { querySet, resolveBuffer, readBuffer, passCount };
}

async function readIsolatedPassBatch(batch) {
  await batch.readBuffer.mapAsync(GPUMapMode.READ);
  const timestamps = new BigUint64Array(batch.readBuffer.getMappedRange().slice(0));
  batch.readBuffer.unmap();
  const millisecondsPerPass = Number(timestamps[1] - timestamps[0]) / (1e6 * batch.passCount);
  batch.querySet.destroy();
  batch.resolveBuffer.destroy();
  batch.readBuffer.destroy();
  return millisecondsPerPass;
}

async function measureIsolatedPass(device, kind, resources, shared) {
  if (kind === 'shadow' && resources.shadowSize === 0) return stats([0]);
  const batches = Array.from({ length: BATCHES }, () =>
    submitIsolatedPassBatch(device, kind, resources, shared, FRAMES_PER_BATCH));
  return stats(await Promise.all(batches.map(readIsolatedPassBatch)));
}

async function readBatch(batch, resources, frameCount) {
  await batch.readBuffer.mapAsync(GPUMapMode.READ);
  const timestamps = new BigUint64Array(batch.readBuffer.getMappedRange().slice(0));
  batch.readBuffer.unmap();
  const shadow = [];
  const scene = [];
  const post = [];
  const total = [];
  const frameSpan = [];
  for (let frame = 0; frame < frameCount; frame++) {
    const base = frame * batch.queriesPerFrame;
    const frameEnd = base + batch.queriesPerFrame - 1;
    frameSpan.push(Number(timestamps[frameEnd] - timestamps[base]) / 1e6);
    let cursor = base;
    let shadowMs = 0;
    if (resources.shadowSize > 0) {
      shadowMs = Number(timestamps[cursor + 1] - timestamps[cursor]) / 1e6;
      cursor += 2;
      shadow.push(shadowMs);
    }
    const sceneMs = Number(timestamps[cursor + 1] - timestamps[cursor]) / 1e6;
    const postMs = Number(timestamps[cursor + 3] - timestamps[cursor + 2]) / 1e6;
    scene.push(sceneMs);
    post.push(postMs);
    total.push(shadowMs + sceneMs + postMs);
  }
  const batchAverages = {
    shadow: shadow.reduce((sum, value) => sum + value, 0) / frameCount,
    scene: scene.reduce((sum, value) => sum + value, 0) / frameCount,
    post: post.reduce((sum, value) => sum + value, 0) / frameCount,
    passSum: total.reduce((sum, value) => sum + value, 0) / frameCount,
    frameSpan: Number(timestamps[timestamps.length - 1] - timestamps[0]) / (1e6 * frameCount),
  };
  batch.querySet.destroy();
  batch.resolveBuffer.destroy();
  batch.readBuffer.destroy();
  return { shadow, scene, post, total, frameSpan, batchAverages };
}

async function validatePixels(device, resources, shared) {
  const bytesPerRow = 256;
  const readback = device.createBuffer({
    label: 'pixel validation readback',
    size: bytesPerRow * 16,
    usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
  });
  const encoder = device.createCommandEncoder({ label: 'pixel validation frame' });
  encodeFrame(encoder, resources, shared, null);
  encoder.copyTextureToBuffer(
    { texture: resources.outputTexture, origin: [Math.floor(WIDTH / 2) - 8, Math.floor(HEIGHT / 2) - 8] },
    { buffer: readback, bytesPerRow, rowsPerImage: 16 },
    [16, 16, 1],
  );
  device.queue.submit([encoder.finish()]);
  await readback.mapAsync(GPUMapMode.READ);
  const mapped = new Uint8Array(readback.getMappedRange());
  const colors = new Set();
  let maximumRgb = 0;
  let alphaMinimum = 255;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const offset = y * bytesPerRow + x * 4;
      maximumRgb = Math.max(maximumRgb, mapped[offset], mapped[offset + 1], mapped[offset + 2]);
      alphaMinimum = Math.min(alphaMinimum, mapped[offset + 3]);
      colors.add(`${mapped[offset]},${mapped[offset + 1]},${mapped[offset + 2]},${mapped[offset + 3]}`);
    }
  }
  readback.unmap();
  readback.destroy();
  assert.ok(maximumRgb > 32, `rendered center must contain lit scene pixels (max=${maximumRgb})`);
  assert.ok(colors.size >= 4, `rendered center must contain visual variation (unique=${colors.size})`);
  assert.ok(alphaMinimum > 200, `post output must remain opaque (minimum alpha=${alphaMinimum})`);
  return { maximumRgb, uniqueColors: colors.size, alphaMinimum };
}

async function benchmarkCase(device, config, shared) {
  const resources = await createCase(device, config, shared);
  const warmup = submitBatch(device, resources, shared, WARMUP_FRAMES, false);
  await device.queue.onSubmittedWorkDone();
  void warmup;

  const batches = [];
  for (let batch = 0; batch < BATCHES; batch++) {
    batches.push(submitBatch(device, resources, shared, FRAMES_PER_BATCH, true));
  }
  const gpuBatches = await Promise.all(batches.map((batch) => readBatch(batch, resources, FRAMES_PER_BATCH)));
  // Keep query-set pressure bounded. Dawn Metal accepts asynchronous readback
  // for each pass batch, while issuing all three pass families concurrently
  // can exceed its transient query allocation budget.
  const isolatedShadow = await measureIsolatedPass(device, 'shadow', resources, shared);
  const isolatedScene = await measureIsolatedPass(device, 'scene', resources, shared);
  const isolatedPost = await measureIsolatedPass(device, 'post', resources, shared);
  const pixelEvidence = await validatePixels(device, resources, shared);
  await device.queue.onSubmittedWorkDone();

  const result = {
    label: `${config.sampleCount}x/${config.label}`,
    sampleCount: config.sampleCount,
    shadowSize: config.shadowSize,
    pcfTaps: config.pcfTaps,
    frames: BATCHES * FRAMES_PER_BATCH,
    gpuMs: {
      shadow: isolatedShadow,
      scene: isolatedScene,
      post: isolatedPost,
      passSum: {
        median: isolatedShadow.median + isolatedScene.median + isolatedPost.median,
        mad: isolatedShadow.mad + isolatedScene.mad + isolatedPost.mad,
        min: isolatedShadow.min + isolatedScene.min + isolatedPost.min,
        max: isolatedShadow.max + isolatedScene.max + isolatedPost.max,
      },
      frameSpan: stats(gpuBatches.map((batch) => batch.batchAverages.frameSpan)),
    },
    cpuMs: {
      encodePerFrame: stats(batches.map((batch) => batch.encodeMsPerFrame)),
      submitPerFrame: stats(batches.map((batch) => batch.submitMsPerFrame)),
    },
    pixelEvidence,
  };
  resources.destroy();
  return result;
}

function format(value) {
  return value.toFixed(3);
}

async function main() {
  assert.ok(WIDTH > 0 && HEIGHT > 0, 'benchmark dimensions must be positive');
  assert.ok(INSTANCE_COUNT > 0, 'instance count must be positive');
  assert.ok(BATCHES >= 3 && FRAMES_PER_BATCH >= 2, 'benchmark needs multiple batches and frames');

  const gpu = create(['backend=metal']);
  const adapter = await gpu.requestAdapter({ powerPreference: 'high-performance' });
  assert.ok(adapter, 'Dawn Metal adapter must be available');
  assert.ok(adapter.features.has('timestamp-query'), 'Metal adapter must support timestamp-query');
  const device = await adapter.requestDevice({ requiredFeatures: ['timestamp-query'] });
  const uncapturedErrors = [];
  device.addEventListener?.('uncapturederror', (event) => uncapturedErrors.push(event.error?.message ?? String(event.error)));
  device.pushErrorScope('internal');
  device.pushErrorScope('out-of-memory');
  device.pushErrorScope('validation');

  const sceneBindGroupLayout = device.createBindGroupLayout({
    label: 'scene bind group layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: 'uniform' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'depth' } },
      { binding: 2, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'comparison' } },
    ],
  });
  const shadowBindGroupLayout = device.createBindGroupLayout({
    label: 'shadow bind group layout',
    entries: [{ binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: 'uniform' } }],
  });
  const postBindGroupLayout = device.createBindGroupLayout({
    label: 'post bind group layout',
    entries: [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: 'float' } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' } },
    ],
  });
  const uniformBuffer = device.createBuffer({ label: 'scene uniforms', size: 192, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const viewProjection = multiply4(
    orthographic(-31.5, 31.5, -18, 18, 0.1, 120),
    lookAt([35, 31, 35], [0, 0, 0], [0, 1, 0]),
  );
  const lightViewProjection = multiply4(
    orthographic(-35, 35, -35, 35, 0.1, 110),
    lookAt([28, 48, 22], [0, 0, 0], [0, 1, 0]),
  );
  const uniformData = new Float32Array(44);
  uniformData.set(viewProjection, 0);
  uniformData.set(lightViewProjection, 16);
  uniformData.set([35, 31, 35, 1], 32);
  uniformData.set(normalize3([0.42, -0.84, 0.34]).concat(0), 36);
  uniformData[41] = INSTANCE_COUNT;
  device.queue.writeBuffer(uniformBuffer, 0, uniformData);
  const vertexBuffer = bufferWithData(device, 'cube vertices', createCubeVertices(), GPUBufferUsage.VERTEX);
  const shadowSampler = device.createSampler({ compare: 'less-equal', minFilter: 'linear', magFilter: 'linear' });
  const postSampler = device.createSampler({ minFilter: 'linear', magFilter: 'linear' });
  const shadowBindGroup = device.createBindGroup({
    label: 'shadow bind group',
    layout: shadowBindGroupLayout,
    entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
  });
  const shared = {
    sceneBindGroupLayout,
    shadowBindGroupLayout,
    postBindGroupLayout,
    scenePipelineLayout: device.createPipelineLayout({ bindGroupLayouts: [sceneBindGroupLayout] }),
    shadowPipelineLayout: device.createPipelineLayout({ bindGroupLayouts: [shadowBindGroupLayout] }),
    postPipelineLayout: device.createPipelineLayout({ bindGroupLayouts: [postBindGroupLayout] }),
    uniformBuffer,
    vertexBuffer,
    shadowSampler,
    postSampler,
    shadowBindGroup,
  };

  console.log(`WebGPU physical-GPU quality benchmark: ${WIDTH}x${HEIGHT}, ${INSTANCE_COUNT} instanced cubes, ${WARMUP_FRAMES} warmups + ${BATCHES * FRAMES_PER_BATCH} measured frames/case`);
  console.log(`Adapter features: timestamp-query=${adapter.features.has('timestamp-query')}, backend=Metal`);
  const results = [];
  const unsupportedCases = [];
  for (const config of qualityCases) {
    // Core WebGPU exposes 1x and 4x render targets. Dawn Metal correctly
    // rejects 2x pipelines, so record that capability result explicitly.
    if (config.sampleCount === 2) {
      unsupportedCases.push({ ...config, reason: 'WebGPU/Dawn Metal does not support sampleCount=2 render pipelines' });
      console.log(`${`2x/${config.label}`.padEnd(25)} unsupported by WebGPU/Dawn Metal`);
      continue;
    }
    uniformData[40] = config.shadowSize > 0 ? 1 / config.shadowSize : 1;
    device.queue.writeBuffer(uniformBuffer, 0, uniformData);
    const result = await benchmarkCase(device, config, shared);
    results.push(result);
    console.log(`${result.label.padEnd(25)} GPU ${format(result.gpuMs.frameSpan.median)} ms span / ${format(result.gpuMs.passSum.median)} ms pass sum (shadow ${format(result.gpuMs.shadow.median)}, scene ${format(result.gpuMs.scene.median)}, post ${format(result.gpuMs.post.median)}) | CPU encode ${format(result.cpuMs.encodePerFrame.median)} ms, submit ${format(result.cpuMs.submitPerFrame.median)} ms`);
  }

  const validationError = await device.popErrorScope();
  const outOfMemoryError = await device.popErrorScope();
  const internalError = await device.popErrorScope();
  assert.equal(validationError, null, `WebGPU validation error: ${validationError?.message}`);
  assert.equal(outOfMemoryError, null, `WebGPU out-of-memory error: ${outOfMemoryError?.message}`);
  assert.equal(internalError, null, `WebGPU internal error: ${internalError?.message}`);
  assert.deepEqual(uncapturedErrors, [], `uncaptured WebGPU errors: ${uncapturedErrors.join('\n')}`);

  const baseline = results.find((result) => result.sampleCount === 1 && result.shadowSize === 0);
  for (const result of results) {
    result.relativeTo1xNoShadow = result.gpuMs.frameSpan.median / baseline.gpuMs.frameSpan.median;
  }
  const grouped = Object.fromEntries([1, 4].map((sampleCount) => [sampleCount, Object.fromEntries(
    results.filter((result) => result.sampleCount === sampleCount).map((result) => [result.label.split('/')[1], result]),
  )]));
  const recommendations = {
    performance: '1x MSAA, shadows off',
    balanced: '1x MSAA, 1024 shadow, 1-tap comparison (2x is unsupported by core WebGPU/Dawn Metal)',
    cinematic: '4x MSAA, 2048 shadow, 9-tap PCF',
  };

  console.log('\nMedian whole-frame GPU span / MAD and multiplier versus 1x no-shadow:');
  console.table(results.map((result) => ({
    case: result.label,
    'GPU ms': Number(result.gpuMs.frameSpan.median.toFixed(4)),
    'MAD ms': Number(result.gpuMs.frameSpan.mad.toFixed(4)),
    'vs baseline': Number(result.relativeTo1xNoShadow.toFixed(3)),
    'CPU encode ms': Number(result.cpuMs.encodePerFrame.median.toFixed(4)),
    'CPU submit ms': Number(result.cpuMs.submitPerFrame.median.toFixed(4)),
  })));
  console.log('Recommended presets from measured costs:', recommendations);
  const evidence = {
    environment: {
      backend: 'Metal',
      width: WIDTH,
      height: HEIGHT,
      instanceCount: INSTANCE_COUNT,
      warmupFrames: WARMUP_FRAMES,
      measuredFramesPerCase: BATCHES * FRAMES_PER_BATCH,
      asynchronousReadbackBatches: BATCHES,
      timestampQuery: true,
      isolatedPassMeasurement: true,
      uncapturedErrors,
      unsupportedCases,
    },
    results,
    recommendations,
  };
  const outputPath = path.join(root, 'benchmarks/results/webgpu-quality-metal.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(`Wrote ${outputPath}`);
  console.log('BENCHMARK_JSON=' + JSON.stringify(evidence));

  vertexBuffer.destroy();
  uniformBuffer.destroy();
  device.destroy();
}

await main();
