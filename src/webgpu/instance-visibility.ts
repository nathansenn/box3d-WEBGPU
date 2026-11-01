/** Optional stable visibility for the renderer's [-1,1]^3 cube. */
export const INSTANCE_VISIBILITY_WORKGROUP_SIZE = 64;
export const INSTANCE_VISIBILITY_VERTEX_COUNT = 36;
export const INSTANCE_VISIBILITY_MARGIN = 64 * 2 ** -23;
export const INSTANCE_MATERIAL_MARGIN = 8 * 2 ** -23;
const MAX_CULL_COMPONENT = 1e15;
const PARAMETER_BYTES = 144;
const INDIRECT_BYTES = 48;

export interface InstanceMaterialPasses {
  readonly opaque: boolean;
  readonly transparent: boolean;
  readonly shadow: boolean;
}

/** WGSL round uses ties-to-even; Math.round does not. */
function roundEven(value: number): number {
  const low = Math.floor(value);
  return value - low === 0.5 ? low + (low % 2) : Math.floor(value + 0.5);
}

/** Allocation-free renderer material mask: opaque=1, transparent=2, shadow=4. */
export function classifyInstanceMaterialMask(alpha: number): number {
  alpha = Math.fround(alpha);
  const magnitude = Math.max(-alpha, 0);
  if (!Number.isFinite(alpha) || magnitude >= 4294967296) return 7;
  const margin = INSTANCE_MATERIAL_MARGIN * Math.max(1, Math.abs(alpha));
  const uncertain = Math.abs(magnitude - 3.5) <= margin || Math.abs(magnitude - 4.5) <= margin ||
    Math.abs(magnitude - 5.5) <= margin || Math.abs(magnitude - 6.5) <= margin;
  const material = roundEven(magnitude);
  const transparent = material === 4 || material === 6;
  let mask = uncertain ? 3 : transparent ? 2 : 1;
  if ((mask & 1) !== 0 && alpha <= Math.fround(1.001) + margin) mask |= 4;
  return mask;
}

/** Same material predicates as the renderer, retaining uncertain boundaries. */
export function classifyInstanceMaterial(alpha: number): InstanceMaterialPasses {
  const mask = classifyInstanceMaterialMask(alpha);
  return { opaque: (mask & 1) !== 0, transparent: (mask & 2) !== 0, shadow: (mask & 4) !== 0 };
}

/**
 * CPU diagnostic version of the homogeneous-plane test. Matrices are column
 * major and z clips to [0,w]. Tests compare against all eight transformed corners.
 * The f32 margin is a conservative numerical guard, not a proof for every backend.
 */
export function isCubeVisibleConservative(model: ArrayLike<number>, viewProjection: ArrayLike<number>): boolean {
  if (model.length < 16 || viewProjection.length < 16) throw new RangeError('Visibility matrices require 16 components.');
  const m = Array.from({ length: 16 }, (_, i) => Math.fround(model[i]));
  const v = Array.from({ length: 16 }, (_, i) => Math.fround(viewProjection[i]));
  if ([...m, ...v].some(value => !Number.isFinite(value) || Math.abs(value) > MAX_CULL_COMPONENT)) return true;
  const clip = new Float32Array(16), bound = new Float32Array(4), magnitude = new Float32Array(4);
  const f = Math.fround;
  for (let row = 0; row < 4; row++) {
    magnitude[row] = f(f(f(Math.abs(m[row]) + Math.abs(m[4 + row])) + Math.abs(m[8 + row])) + Math.abs(m[12 + row]));
  }
  for (let row = 0; row < 4; row++) {
    let b = 0;
    for (let k = 0; k < 4; k++) b = f(b + f(Math.abs(v[k * 4 + row]) * magnitude[k]));
    bound[row] = b;
    for (let column = 0; column < 4; column++) {
      let value = 0;
      for (let k = 0; k < 4; k++) value = f(value + f(v[k * 4 + row] * m[column * 4 + k]));
      clip[column * 4 + row] = value;
    }
  }
  const plane = (axis: number, sign: number, includeW: boolean): boolean => {
    const p = Array.from({ length: 4 }, (_, column) => f((includeW ? clip[column * 4 + 3] : 0) + sign * clip[column * 4 + axis]));
    const radius = f(f(Math.abs(p[0]) + Math.abs(p[1])) + Math.abs(p[2]));
    const errorBound = f((includeW ? bound[3] : 0) + bound[axis]);
    return f(p[3] + radius) >= -f(INSTANCE_VISIBILITY_MARGIN * Math.max(1, errorBound));
  };
  return plane(0, 1, true) && plane(0, -1, true) && plane(1, 1, true) && plane(1, -1, true)
    && plane(2, 1, false) && plane(2, -1, true);
}

const PARAMS_WGSL = /* wgsl */ `
struct Params {
  camera : mat4x4<f32>, light : mat4x4<f32>,
  counts : vec4<u32>, // input count, active group count, capacity, reserved
};
@group(0) @binding(0) var<uniform> params : Params;
`;

export const INSTANCE_MATERIAL_WGSL = /* wgsl */ `
fn finite4(value : vec4<f32>) -> bool {
  return all((bitcast<vec4<u32>>(value) & vec4<u32>(0x7f800000u)) != vec4<u32>(0x7f800000u));
}
fn materialPassMask(alpha : f32) -> u32 {
  let magnitude = max(-alpha, 0.0);
  if (!finite4(vec4<f32>(alpha)) || magnitude >= 4294967296.0) { return 7u; }
  let margin = 0.00000095367431640625 * max(1.0, abs(alpha));
  let nearBoundary = any(abs(vec4<f32>(magnitude) - vec4<f32>(3.5, 4.5, 5.5, 6.5)) <= vec4<f32>(margin));
  let materialId = u32(round(magnitude));
  let transparent = materialId == 4u || materialId == 6u;
  var mask = select(1u, 2u, transparent);
  if (nearBoundary) { mask = 3u; }
  if ((mask & 1u) != 0u && alpha <= 1.001 + margin) { mask = mask | 4u; }
  return mask;
}
`;

/** Exported to let the GPU harness validate the actual production shaders. */
export const INSTANCE_CLASSIFY_WGSL = /* wgsl */ `
${PARAMS_WGSL}
${INSTANCE_MATERIAL_WGSL}
@group(0) @binding(1) var<storage, read> models : array<mat4x4<f32>>;
@group(0) @binding(2) var<storage, read> colors : array<vec4<f32>>;
@group(0) @binding(3) var<storage, read_write> metadata : array<vec4<u32>>;
@group(0) @binding(4) var<storage, read_write> groupCounts : array<vec4<u32>>;
var<workgroup> scan : array<vec4<u32>, 64>;

fn suitableMatrix(value : mat4x4<f32>) -> bool {
  // Retain extreme magnitudes before products can overflow under finite-math assumptions.
  for (var i = 0u; i < 4u; i++) {
    if (!finite4(value[i]) || any(abs(value[i]) > vec4<f32>(1e15))) { return false; }
  }
  return true;
}
fn passesPlane(plane : vec4<f32>, magnitude : f32) -> bool {
  let radius = abs(plane.x) + abs(plane.y) + abs(plane.z);
  // Absolute-product scale retains cancellation error discarded by clip coefficients.
  let margin = 0.00000762939453125 * max(1.0, magnitude);
  return plane.w + radius >= -margin;
}
fn cubeVisible(model : mat4x4<f32>, view : mat4x4<f32>) -> bool {
  if (!suitableMatrix(model) || !suitableMatrix(view)) { return true; }
  let clip = view * model;
  let modelMagnitude = abs(model[0]) + abs(model[1]) + abs(model[2]) + abs(model[3]);
  let viewMagnitude = mat4x4<f32>(abs(view[0]), abs(view[1]), abs(view[2]), abs(view[3]));
  let bound = viewMagnitude * modelMagnitude;
  let x = vec4<f32>(clip[0].x, clip[1].x, clip[2].x, clip[3].x);
  let y = vec4<f32>(clip[0].y, clip[1].y, clip[2].y, clip[3].y);
  let z = vec4<f32>(clip[0].z, clip[1].z, clip[2].z, clip[3].z);
  let w = vec4<f32>(clip[0].w, clip[1].w, clip[2].w, clip[3].w);
  return passesPlane(w + x, bound.w + bound.x) && passesPlane(w - x, bound.w + bound.x)
    && passesPlane(w + y, bound.w + bound.y) && passesPlane(w - y, bound.w + bound.y)
    && passesPlane(z, bound.z) && passesPlane(w - z, bound.w + bound.z);
}
@compute @workgroup_size(64)
fn classify(@builtin(global_invocation_id) id : vec3<u32>, @builtin(local_invocation_id) local : vec3<u32>,
            @builtin(workgroup_id) group : vec3<u32>) {
  let index = id.x; let lane = local.x;
  var flags = vec4<u32>(0u);
  if (index < params.counts.x) {
    let model = models[index];
    let mask = materialPassMask(colors[index].a);
    if ((mask & 3u) != 0u && cubeVisible(model, params.camera)) {
      flags.x = select(0u, 1u, (mask & 1u) != 0u);
      flags.y = select(0u, 1u, (mask & 2u) != 0u);
    }
    if ((mask & 4u) != 0u && cubeVisible(model, params.light)) { flags.z = 1u; }
  }
  scan[lane] = flags;
  workgroupBarrier();
  for (var offset = 1u; offset < 64u; offset = offset * 2u) {
    var previous = vec4<u32>(0u);
    if (lane >= offset) { previous = scan[lane - offset]; }
    workgroupBarrier();
    scan[lane] = scan[lane] + previous;
    workgroupBarrier();
  }
  if (index < params.counts.x) {
    let rank = scan[lane] - flags;
    metadata[index] = vec4<u32>(flags.x | (flags.y << 1u) | (flags.z << 2u), rank.x, rank.y, rank.z);
  }
  if (lane == 63u) { groupCounts[group.x] = scan[63]; }
}
`;

export const INSTANCE_PREFIX_WGSL = /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(1) var<storage, read> groupCounts : array<vec4<u32>>;
@group(0) @binding(2) var<storage, read_write> groupOffsets : array<vec4<u32>>;
@group(0) @binding(3) var<storage, read_write> drawArgs : array<vec4<u32>>;
var<workgroup> scan : array<vec4<u32>, 64>;
@compute @workgroup_size(64)
fn prefix(@builtin(local_invocation_id) local : vec3<u32>) {
  let lane = local.x;
  // Each lane scans a contiguous segment; a workgroup scan stitches segments.
  let segmentLength = (params.counts.y + 63u) / 64u;
  let begin = lane * segmentLength;
  let end = min(begin + segmentLength, params.counts.y);
  var total = vec4<u32>(0u);
  for (var group = begin; group < end; group++) {
    groupOffsets[group] = total;
    total = total + groupCounts[group];
  }
  scan[lane] = total;
  workgroupBarrier();
  for (var offset = 1u; offset < 64u; offset = offset * 2u) {
    var previous = vec4<u32>(0u);
    if (lane >= offset) { previous = scan[lane - offset]; }
    workgroupBarrier();
    scan[lane] = scan[lane] + previous;
    workgroupBarrier();
  }
  let preceding = scan[lane] - total;
  for (var group = begin; group < end; group++) { groupOffsets[group] = groupOffsets[group] + preceding; }
  if (lane == 63u) {
    let counts = scan[63];
    drawArgs[0] = vec4<u32>(36u, counts.x, 0u, 0u);
    drawArgs[1] = vec4<u32>(36u, counts.y, 0u, 0u);
    drawArgs[2] = vec4<u32>(36u, counts.z, 0u, 0u);
  }
}
`;

export const INSTANCE_SCATTER_WGSL = /* wgsl */ `
${PARAMS_WGSL}
@group(0) @binding(1) var<storage, read> metadata : array<vec4<u32>>;
@group(0) @binding(2) var<storage, read> groupOffsets : array<vec4<u32>>;
@group(0) @binding(3) var<storage, read_write> opaqueIds : array<u32>;
@group(0) @binding(4) var<storage, read_write> transparentIds : array<u32>;
@group(0) @binding(5) var<storage, read_write> shadowIds : array<u32>;
@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) id : vec3<u32>, @builtin(workgroup_id) group : vec3<u32>) {
  let index = id.x;
  if (index >= params.counts.x) { return; }
  let value = metadata[index]; let offset = groupOffsets[group.x];
  // One contribution per input per list; encode rejects count > capacity.
  if ((value.x & 1u) != 0u) { opaqueIds[offset.x + value.y] = index; }
  if ((value.x & 2u) != 0u) { transparentIds[offset.y + value.z] = index; }
  if ((value.x & 4u) != 0u) { shadowIds[offset.z + value.w] = index; }
}
`;

export interface InstanceVisibilityOptions {
  readonly capacity: number;
  readonly matrixBuffer: GPUBuffer;
  readonly colorBuffer: GPUBuffer;
}
export interface InstanceVisibilityFrame {
  readonly instanceCount: number;
  readonly cameraViewProj: ArrayLike<number>;
  readonly lightViewProj: ArrayLike<number>;
}
export interface InstanceVisibilityList {
  readonly ids: GPUBuffer;
  readonly indirectBuffer: GPUBuffer;
  readonly indirectOffset: number;
}
export interface InstanceVisibilityReadback {
  readonly capacity: number;
  readonly inputCount: number;
  readonly encodedFrames: number;
  readonly opaque: { readonly count: number; readonly ids: Uint32Array };
  readonly transparent: { readonly count: number; readonly ids: Uint32Array };
  readonly shadow: { readonly count: number; readonly ids: Uint32Array };
}

export function instanceVisibilityAllocation(capacity: number): {
  readonly capacity: number; readonly groups: number; readonly metadataBytes: number;
  readonly groupBytes: number; readonly indexBytes: number; readonly totalBytes: number;
} {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 0xffffffff) {
    throw new RangeError('Visibility capacity must be a positive u32 integer.');
  }
  const groups = Math.ceil(capacity / INSTANCE_VISIBILITY_WORKGROUP_SIZE);
  const metadataBytes = capacity * 16, groupBytes = groups * 16, indexBytes = capacity * 4;
  return { capacity, groups, metadataBytes, groupBytes, indexBytes,
    totalBytes: PARAMETER_BYTES + INDIRECT_BYTES + metadataBytes + groupBytes * 2 + indexBytes * 3 };
}

type PipelineSet = readonly [GPUComputePipeline, GPUComputePipeline, GPUComputePipeline];
type GroupSet = readonly [GPUBindGroup, GPUBindGroup, GPUBindGroup];

/**
 * Opt-in fixed-capacity backend. Borrowed source buffers retain their identity.
 * Encode after producers (including rope expansion) and before rendering, then
 * submit that encoder before encoding another frame. encode never submits,
 * waits, reads back, or acknowledges completion. The caller handles submission
 * errors and recreates this object after device loss. No optional features needed.
 */
export class GpuInstanceVisibility {
  readonly opaque: InstanceVisibilityList;
  readonly transparent: InstanceVisibilityList;
  readonly shadow: InstanceVisibilityList;
  private readonly uniformData = new ArrayBuffer(PARAMETER_BYTES);
  private readonly staging = new Set<GPUBuffer>();
  private encodedFrames = 0;
  private destroyed = false;
  private lossMessage: string | null = null;

  private constructor(
    private readonly device: GPUDevice,
    readonly capacity: number,
    private readonly params: GPUBuffer,
    private readonly indirect: GPUBuffer,
    private readonly ids: readonly [GPUBuffer, GPUBuffer, GPUBuffer],
    private readonly owned: readonly GPUBuffer[],
    private readonly pipelines: PipelineSet,
    private readonly groups: GroupSet,
  ) {
    this.opaque = Object.freeze({ ids: ids[0], indirectBuffer: indirect, indirectOffset: 0 });
    this.transparent = Object.freeze({ ids: ids[1], indirectBuffer: indirect, indirectOffset: 16 });
    this.shadow = Object.freeze({ ids: ids[2], indirectBuffer: indirect, indirectOffset: 32 });
    void device.lost.then(info => { this.lossMessage = info.message || 'The WebGPU device was lost.'; });
  }

  static async create(device: GPUDevice, options: InstanceVisibilityOptions): Promise<GpuInstanceVisibility> {
    const allocation = instanceVisibilityAllocation(options.capacity), limits = device.limits;
    for (const bytes of [allocation.metadataBytes, allocation.groupBytes, allocation.indexBytes]) {
      if (bytes > limits.maxBufferSize || bytes > limits.maxStorageBufferBindingSize) {
        throw new RangeError('Visibility capacity exceeds this device\'s buffer limits.');
      }
    }
    if (allocation.groups > limits.maxComputeWorkgroupsPerDimension || limits.maxComputeInvocationsPerWorkgroup < 64 ||
        limits.maxComputeWorkgroupSizeX < 64 || limits.maxComputeWorkgroupStorageSize < 1024 ||
        limits.maxStorageBuffersPerShaderStage < 5) {
      throw new RangeError('Visibility requires five storage bindings and 64-invocation compute workgroups.');
    }
    for (const [buffer, required] of [[options.matrixBuffer, options.capacity * 64],
      [options.colorBuffer, options.capacity * 16]] as const) {
      if (buffer.size < required || required > limits.maxStorageBufferBindingSize ||
          (buffer.usage & GPUBufferUsage.STORAGE) === 0) {
        throw new RangeError('Visibility source buffer does not cover capacity with STORAGE usage.');
      }
    }
    const owned: GPUBuffer[] = [];
    const makeBuffer = (label: string, size: number, usage: number): GPUBuffer => {
      const buffer = device.createBuffer({ label: `Instance visibility ${label}`, size, usage });
      owned.push(buffer); return buffer;
    };
    const pipelinePromises: Promise<GPUComputePipeline>[] = [], shaders: GPUShaderModule[] = [];
    let params: GPUBuffer | undefined, indirect: GPUBuffer | undefined;
    let ids: readonly [GPUBuffer, GPUBuffer, GPUBuffer] | undefined;
    let groups: GroupSet | undefined, failure: unknown;
    device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
    try {
      params = makeBuffer('parameters', PARAMETER_BYTES, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC);
      indirect = makeBuffer('indirect arguments', INDIRECT_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC);
      const metadata = makeBuffer('local ranks', allocation.metadataBytes, GPUBufferUsage.STORAGE);
      const counts = makeBuffer('group counts', allocation.groupBytes, GPUBufferUsage.STORAGE);
      const offsets = makeBuffer('group offsets', allocation.groupBytes, GPUBufferUsage.STORAGE);
      const indexUsage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC;
      ids = [makeBuffer('opaque IDs', allocation.indexBytes, indexUsage), makeBuffer('transparent IDs', allocation.indexBytes, indexUsage),
        makeBuffer('shadow IDs', allocation.indexBytes, indexUsage)];
      const codes = [INSTANCE_CLASSIFY_WGSL, INSTANCE_PREFIX_WGSL, INSTANCE_SCATTER_WGSL];
      const entryPoints = ['classify', 'prefix', 'scatter'];
      const bindings: readonly (readonly { readonly buffer: GPUBuffer; readonly type: 'uniform' | 'read-only-storage' | 'storage'; readonly size?: number }[])[] = [
        [{ buffer: params, type: 'uniform' },
          { buffer: options.matrixBuffer, type: 'read-only-storage', size: options.capacity * 64 },
          { buffer: options.colorBuffer, type: 'read-only-storage', size: options.capacity * 16 },
          { buffer: metadata, type: 'storage' }, { buffer: counts, type: 'storage' }],
        [{ buffer: params, type: 'uniform' }, { buffer: counts, type: 'read-only-storage' },
          { buffer: offsets, type: 'storage' }, { buffer: indirect, type: 'storage' }],
        [{ buffer: params, type: 'uniform' }, { buffer: metadata, type: 'read-only-storage' },
          { buffer: offsets, type: 'read-only-storage' }, ...ids.map(buffer => ({ buffer, type: 'storage' as const }))],
      ];
      const madeGroups: GPUBindGroup[] = [];
      for (let stage = 0; stage < 3; stage++) {
        const layout = device.createBindGroupLayout({ label: `Visibility ${entryPoints[stage]} layout`,
          entries: bindings[stage].map((binding, index) => ({ binding: index, visibility: GPUShaderStage.COMPUTE,
            buffer: { type: binding.type } })) });
        madeGroups.push(device.createBindGroup({ label: `Visibility ${entryPoints[stage]} bindings`, layout,
          entries: bindings[stage].map((binding, index) => ({ binding: index,
            resource: { buffer: binding.buffer, ...(binding.size === undefined ? {} : { size: binding.size }) } })) }));
        const shader = device.createShaderModule({ label: `Visibility ${entryPoints[stage]} shader`, code: codes[stage] });
        shaders.push(shader);
        const descriptor: GPUComputePipelineDescriptor = { label: `Visibility ${entryPoints[stage]} pipeline`,
          layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }), compute: { module: shader, entryPoint: entryPoints[stage] } };
        pipelinePromises.push(device.createComputePipelineAsync ? device.createComputePipelineAsync(descriptor)
          : Promise.resolve(device.createComputePipeline(descriptor)));
      }
      groups = madeGroups as unknown as GroupSet;
    } catch (error) { failure = error; }
    // Pop before awaiting so another shared-device user cannot change scope ownership.
    const memoryError = device.popErrorScope(), validationError = device.popErrorScope();
    const results = await Promise.allSettled([
      ...pipelinePromises, memoryError, validationError,
      ...shaders.map(shader => shader.getCompilationInfo ? shader.getCompilationInfo() : Promise.resolve({ messages: [] })),
    ]);
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') { failure ??= result.reason; continue; }
      if (i === pipelinePromises.length || i === pipelinePromises.length + 1) {
        const error = result.value as GPUError | null;
        if (error) failure ??= new Error(error.message);
      } else if (i > pipelinePromises.length + 1) {
        const errors = (result.value as GPUCompilationInfo).messages.filter(message => message.type === 'error');
        if (errors.length) failure ??= new Error(errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n'));
      }
    }
    if (failure || !params || !indirect || !ids || !groups || pipelinePromises.length !== 3) {
      for (const buffer of owned) buffer.destroy();
      throw new Error(`Unable to create GPU instance visibility: ${failure instanceof Error ? failure.message : String(failure ?? 'incomplete pipelines')}`);
    }
    const pipelines = results.slice(0, 3).map(result => (result as PromiseFulfilledResult<GPUComputePipeline>).value) as unknown as PipelineSet;
    return new GpuInstanceVisibility(device, options.capacity, params, indirect, ids, owned, pipelines, groups);
  }

  private assertUsable(): void {
    if (this.destroyed) throw new Error('GPU instance visibility has been destroyed.');
    if (this.lossMessage !== null) throw new Error(`GPU instance visibility is unavailable: ${this.lossMessage}`);
  }

  encode(encoder: GPUCommandEncoder, frame: InstanceVisibilityFrame): void {
    this.assertUsable();
    if (!Number.isSafeInteger(frame.instanceCount) || frame.instanceCount < 0 || frame.instanceCount > this.capacity) {
      throw new RangeError('Visibility instance count exceeds capacity or is not a nonnegative integer.');
    }
    if (frame.cameraViewProj.length < 16 || frame.lightViewProj.length < 16) throw new RangeError('Visibility matrices require 16 components.');
    const floats = new Float32Array(this.uniformData);
    for (let i = 0; i < 16; i++) { floats[i] = frame.cameraViewProj[i]; floats[16 + i] = frame.lightViewProj[i]; }
    const activeGroups = Math.ceil(frame.instanceCount / INSTANCE_VISIBILITY_WORKGROUP_SIZE);
    const uints = new Uint32Array(this.uniformData);
    uints[32] = frame.instanceCount; uints[33] = activeGroups; uints[34] = this.capacity; uints[35] = 0;
    this.device.queue.writeBuffer(this.params, 0, this.uniformData);
    const names = ['classify and local scan', 'group prefix and draw counts', 'stable ID scatter'];
    for (let stage = 0; stage < 3; stage++) {
      if (activeGroups === 0 && stage !== 1) continue;
      const pass = encoder.beginComputePass({ label: `Instance visibility ${names[stage]}` });
      pass.setPipeline(this.pipelines[stage]); pass.setBindGroup(0, this.groups[stage]);
      pass.dispatchWorkgroups(stage === 1 ? 1 : activeGroups); pass.end();
    }
    this.encodedFrames++;
  }

  /** Diagnostic only. Submit the encoded frame first; production never calls this. */
  async readback(): Promise<InstanceVisibilityReadback> {
    this.assertUsable();
    if (this.encodedFrames === 0) throw new Error('Encode and submit a visibility frame before readback.');
    const encodedFrames = this.encodedFrames, indexBytes = this.capacity * 4;
    const buffer = this.device.createBuffer({ label: 'Instance visibility diagnostic readback',
      size: 64 + indexBytes * 3, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
    this.staging.add(buffer);
    try {
      const encoder = this.device.createCommandEncoder({ label: 'Instance visibility diagnostic copy' });
      encoder.copyBufferToBuffer(this.indirect, 0, buffer, 0, INDIRECT_BYTES);
      encoder.copyBufferToBuffer(this.params, 128, buffer, 48, 16);
      for (let i = 0; i < 3; i++) encoder.copyBufferToBuffer(this.ids[i], 0, buffer, 64 + i * indexBytes, indexBytes);
      this.device.queue.submit([encoder.finish()]);
      await buffer.mapAsync(GPUMapMode.READ);
      this.assertUsable();
      const words = new Uint32Array(buffer.getMappedRange());
      const lists = [0, 1, 2].map(index => {
        const count = words[index * 4 + 1];
        if (count > this.capacity || count > words[12] || words[index * 4] !== INSTANCE_VISIBILITY_VERTEX_COUNT ||
            words[index * 4 + 2] !== 0 || words[index * 4 + 3] !== 0) {
          throw new Error('Visibility readback found invalid or overflowing indirect arguments.');
        }
        const begin = 16 + index * this.capacity;
        return { count, ids: words.slice(begin, begin + count) };
      });
      return { capacity: this.capacity, inputCount: words[12], encodedFrames,
        opaque: lists[0], transparent: lists[1], shadow: lists[2] };
    } finally {
      if (buffer.mapState === 'mapped') buffer.unmap();
      buffer.destroy(); this.staging.delete(buffer);
    }
  }

  /** Idempotent. Borrowed matrices/colors and the device remain alive. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const buffer of this.owned) buffer.destroy();
    for (const buffer of this.staging) buffer.destroy();
    this.staging.clear();
  }
}
