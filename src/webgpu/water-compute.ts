import {
  createWaterReference, validateWaterGrid, validateWaterStepParams,
  type WaterFields, type WaterGrid, type WaterSnapshot, type WaterStepParams,
} from '../soft/water-reference';

/** Ordered dispatches retain the production solver's destination-boundary history. */
export const WATER_COMPUTE_WGSL = /* wgsl */ `
struct Params { grid: vec4<u32>, physics: vec4<f32>, spacing: vec4<f32> };
@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> eta: array<f32>;
@group(0) @binding(2) var<storage, read> u: array<f32>;
@group(0) @binding(3) var<storage, read> v: array<f32>;
@group(0) @binding(4) var<storage, read_write> nextEta: array<f32>;
@group(0) @binding(5) var<storage, read_write> nextU: array<f32>;
@group(0) @binding(6) var<storage, read_write> nextV: array<f32>;

@compute @workgroup_size(8, 8)
fn velocities(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x + 1u; let z = id.y + 1u; let cols = params.grid.x;
  if (x >= cols - 1u || z >= params.grid.y - 1u) { return; }
  let i = z * cols + x;
  let dt = params.physics.x;
  let decay = 1.0 - params.physics.w * dt;
  let pressureX = params.physics.y * dt * params.spacing.x;
  let pressureZ = params.physics.y * dt * params.spacing.y;
  nextU[i] = u[i] * decay - (eta[i + 1u] - eta[i - 1u]) * pressureX;
  nextV[i] = v[i] * decay - (eta[i + cols] - eta[i - cols]) * pressureZ;
}
@compute @workgroup_size(8, 8)
fn heights(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x + 1u; let z = id.y + 1u; let cols = params.grid.x;
  if (x >= cols - 1u || z >= params.grid.y - 1u) { return; }
  let i = z * cols + x;
  let continuityX = params.physics.z * params.physics.x * params.spacing.x;
  let continuityZ = params.physics.z * params.physics.x * params.spacing.y;
  // Boundary neighbors retain destination history until the following passes.
  let value = eta[i]
    - (nextU[i + 1u] - nextU[i - 1u]) * continuityX
    - (nextV[i + cols] - nextV[i - cols]) * continuityZ;
  nextEta[i] = clamp(value, -1.65, 1.65);
}
@compute @workgroup_size(64)
fn boundaryRows(@builtin(global_invocation_id) id: vec3<u32>) {
  let x = id.x; let cols = params.grid.x; let rows = params.grid.y;
  if (x >= cols) { return; }
  nextEta[x] = nextEta[cols + x] * 0.92;
  nextU[x] = nextU[cols + x] * 0.78;
  nextV[x] = -nextV[cols + x] * 0.18;
  let bottom = (rows - 1u) * cols + x;
  let inner = (rows - 2u) * cols + x;
  nextEta[bottom] = nextEta[inner] * 0.92;
  nextU[bottom] = nextU[inner] * 0.78;
  nextV[bottom] = -nextV[inner] * 0.18;
}
@compute @workgroup_size(64)
fn boundaryColumns(@builtin(global_invocation_id) id: vec3<u32>) {
  let z = id.x; let cols = params.grid.x;
  if (z >= params.grid.y) { return; }
  let left = z * cols; let right = left + cols - 1u;
  // This pass owns corners, after their row-neighbor values are ready.
  nextEta[left] = nextEta[left + 1u] * 0.92;
  nextU[left] = -nextU[left + 1u] * 0.18;
  nextV[left] = nextV[left + 1u] * 0.78;
  nextEta[right] = nextEta[right - 1u] * 0.92;
  nextU[right] = -nextU[right - 1u] * 0.18;
  nextV[right] = nextV[right - 1u] * 0.78;
}
`;

export interface WaterGpuBuffers { readonly eta: GPUBuffer; readonly u: GPUBuffer; readonly v: GPUBuffer; }
export interface WaterStepTimestamps { readonly querySet: GPUQuerySet; readonly beginIndex?: number; readonly endIndex?: number; }
type Parity = 0 | 1;
type PipelineSet = readonly [GPUComputePipeline, GPUComputePipeline, GPUComputePipeline, GPUComputePipeline];
interface ParameterSet { readonly buffer: GPUBuffer; readonly groups: readonly [GPUBindGroup, GPUBindGroup]; }
const PARAMETER_BYTES = 48;
const MAX_PARAMETER_SETS = 256;
const ENTRY_POINTS = ['velocities', 'heights', 'boundaryRows', 'boundaryColumns'] as const;

function packParameters(grid: WaterGrid, params: WaterStepParams): ArrayBuffer {
  const data = new ArrayBuffer(PARAMETER_BYTES);
  const uints = new Uint32Array(data); const floats = new Float32Array(data);
  uints[0] = grid.cols; uints[1] = grid.rows;
  floats.set([params.dt, params.gravity, params.meanDepth, params.drag], 4);
  floats.set([params.invTwoDx, params.invTwoDz], 8);
  return data;
}

/**
 * Optional fixed-grid backend. Owns its buffers, never its device.
 * encodeStep neither submits nor waits; it exposes the parity the encoded
 * commands will produce. Submit the encoder before reset/readback/destroy,
 * and do not encode competing timelines. Rendering can use currentBuffers
 * after the compute passes in the same encoder. Reset if an encoder is discarded.
 * The owner must handle asynchronous device/submission errors and reset or
 * recreate this instance after failure; encoded counters are not completion
 * or success acknowledgements. Parameter allocation is intentionally synchronous.
 */
export class GpuWaterCompute implements WaterGrid {
  readonly cols: number;
  readonly rows: number;
  readonly count: number;
  readonly byteLength: number;
  private readonly parameterSets = new Map<string, ParameterSet>();
  private readonly stagingBuffers = new Set<GPUBuffer>();
  private parity: Parity = 0;
  private stepCount = 0;
  private destroyed = false;
  private lossMessage: string | null = null;

  private constructor(
    private readonly device: GPUDevice,
    grid: WaterGrid,
    private readonly fields: readonly [WaterGpuBuffers, WaterGpuBuffers],
    private readonly pipelines: PipelineSet,
    private readonly bindGroupLayout: GPUBindGroupLayout,
  ) {
    this.cols = grid.cols; this.rows = grid.rows;
    this.count = grid.cols * grid.rows;
    this.byteLength = this.count * Float32Array.BYTES_PER_ELEMENT;
    void device.lost.then(info => { this.lossMessage = info.message || 'The WebGPU device was lost.'; });
  }

  static async create(device: GPUDevice, grid: WaterGrid, initial?: WaterFields, history?: WaterFields): Promise<GpuWaterCompute> {
    const count = validateWaterGrid(grid);
    const bytes = count * Float32Array.BYTES_PER_ELEMENT;
    const limits = device.limits;
    if (bytes > limits.maxBufferSize || bytes > limits.maxStorageBufferBindingSize) {
      throw new RangeError('Water grid exceeds this device\'s storage-buffer limit.');
    }
    const maxGroups = limits.maxComputeWorkgroupsPerDimension;
    if (Math.ceil((grid.cols - 2) / 8) > maxGroups || Math.ceil((grid.rows - 2) / 8) > maxGroups ||
        Math.ceil(grid.cols / 64) > maxGroups || Math.ceil(grid.rows / 64) > maxGroups) {
      throw new RangeError('Water grid exceeds this device\'s compute dispatch limits.');
    }
    if (limits.maxStorageBuffersPerShaderStage < 6 || limits.maxComputeInvocationsPerWorkgroup < 64 ||
        limits.maxComputeWorkgroupSizeX < 64 || limits.maxComputeWorkgroupSizeY < 8) {
      throw new RangeError('Water compute requires six storage bindings and 64-invocation workgroups.');
    }
    const state = createWaterReference(grid, initial, history);
    const owned: GPUBuffer[] = [];
    const makeFields = (label: string, data: WaterFields): WaterGpuBuffers => {
      const result = {} as Record<'eta' | 'u' | 'v', GPUBuffer>;
      for (const name of ['eta', 'u', 'v'] as const) {
        const buffer = device.createBuffer({ label: `Water ${label} ${name}`, size: bytes,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
        owned.push(buffer);
        device.queue.writeBuffer(buffer, 0, data[name].buffer as ArrayBuffer, data[name].byteOffset, bytes);
        result[name] = buffer;
      }
      return Object.freeze(result);
    };
    device.pushErrorScope('validation'); device.pushErrorScope('out-of-memory');
    let fields: readonly [WaterGpuBuffers, WaterGpuBuffers] | undefined;
    let bindGroupLayout: GPUBindGroupLayout | undefined;
    let shader: GPUShaderModule | undefined;
    const pipelinePromises: Promise<GPUComputePipeline>[] = [];
    let synchronousError: unknown;
    try {
      fields = [makeFields('A', state.current), makeFields('B', state.destination)];
      bindGroupLayout = device.createBindGroupLayout({ label: 'Water compute layout', entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'uniform' } },
        ...[1, 2, 3].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'read-only-storage' as const } })),
        ...[4, 5, 6].map(binding => ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: 'storage' as const } })),
      ] });
      const layout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      shader = device.createShaderModule({ label: 'Water four-stage solver', code: WATER_COMPUTE_WGSL });
      for (const entryPoint of ENTRY_POINTS) {
        const descriptor: GPUComputePipelineDescriptor = { label: `Water ${entryPoint}`, layout, compute: { module: shader, entryPoint } };
        pipelinePromises.push(device.createComputePipelineAsync ? device.createComputePipelineAsync(descriptor)
          : Promise.resolve(device.createComputePipeline(descriptor)));
      }
    } catch (error) { synchronousError = error; }
    // Pop before awaiting so other users of the shared device cannot change
    // which scopes own this creation's asynchronous validation results.
    const memoryError = device.popErrorScope();
    const validationError = device.popErrorScope();
    const results = await Promise.allSettled([
      ...pipelinePromises, memoryError, validationError,
      shader?.getCompilationInfo ? shader.getCompilationInfo() : Promise.resolve({ messages: [] }),
    ]);
    let failure = synchronousError;
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === 'rejected') failure ??= result.reason;
      else if (i === pipelinePromises.length || i === pipelinePromises.length + 1) {
        const error = result.value as { message: string } | null;
        if (error) failure ??= new Error(error.message);
      } else if (i === results.length - 1) {
        const info = result.value as GPUCompilationInfo;
        const errors = info.messages.filter(message => message.type === 'error');
        if (errors.length) failure ??= new Error(errors.map(message => `${message.lineNum}:${message.linePos} ${message.message}`).join('\n'));
      }
    }
    if (failure || !fields || !bindGroupLayout || pipelinePromises.length !== 4) {
      for (const buffer of owned) buffer.destroy();
      throw new Error(`Unable to create GPU water solver: ${failure instanceof Error ? failure.message : String(failure ?? 'incomplete pipelines')}`);
    }
    const pipelines = results.slice(0, 4).map(result => (result as PromiseFulfilledResult<GPUComputePipeline>).value) as unknown as PipelineSet;
    return new GpuWaterCompute(device, grid, fields, pipelines, bindGroupLayout);
  }

  private assertUsable(): void {
    if (this.destroyed) throw new Error('GPU water solver has been destroyed.');
    if (this.lossMessage !== null) throw new Error(`GPU water solver is unavailable: ${this.lossMessage}`);
  }
  get currentBuffers(): WaterGpuBuffers { this.assertUsable(); return this.fields[this.parity]; }
  /** Encoded substeps; the caller owns submission and GPU completion. */
  get steps(): number { return this.stepCount; }

  /** Upload both states after prior encoded work has been submitted. */
  reset(initial?: WaterFields, history?: WaterFields): void {
    this.assertUsable();
    const state = createWaterReference(this, initial, history);
    for (const index of [0, 1] as const) {
      const data = index === 0 ? state.current : state.destination;
      for (const name of ['eta', 'u', 'v'] as const) {
        this.device.queue.writeBuffer(this.fields[index][name], 0, data[name].buffer as ArrayBuffer, data[name].byteOffset, this.byteLength);
      }
    }
    this.parity = 0; this.stepCount = 0;
  }

  private parameters(params: WaterStepParams): ParameterSet {
    const packed = packParameters(this, params);
    const key = Array.from(new Uint32Array(packed)).join(':');
    const existing = this.parameterSets.get(key);
    if (existing) return existing;
    if (this.parameterSets.size >= MAX_PARAMETER_SETS) {
      throw new RangeError('GPU water exceeded 256 distinct timestep parameter sets; recreate the fixed-step pilot for a new schedule.');
    }
    const buffer = this.device.createBuffer({ label: 'Water immutable step parameters', size: PARAMETER_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    try {
      // Immutable uniforms avoid the last-write-wins hazard when several
      // differently parameterized steps are encoded before a single submit.
      this.device.queue.writeBuffer(buffer, 0, packed);
      const groups = ([0, 1] as const).map(parity => {
        const source = this.fields[parity]; const destination = this.fields[parity === 0 ? 1 : 0];
        return this.device.createBindGroup({ label: `Water compute parity ${parity}`, layout: this.bindGroupLayout, entries: [
          { binding: 0, resource: { buffer } },
          { binding: 1, resource: { buffer: source.eta } }, { binding: 2, resource: { buffer: source.u } },
          { binding: 3, resource: { buffer: source.v } }, { binding: 4, resource: { buffer: destination.eta } },
          { binding: 5, resource: { buffer: destination.u } }, { binding: 6, resource: { buffer: destination.v } },
        ] });
      }) as [GPUBindGroup, GPUBindGroup];
      const value: ParameterSet = { buffer, groups }; this.parameterSets.set(key, value); return value;
    } catch (error) { buffer.destroy(); throw error; }
  }

  /** No submit, readback or wait. Each pass boundary orders all workgroups. */
  encodeStep(encoder: GPUCommandEncoder, params: WaterStepParams, timestamps?: WaterStepTimestamps): void {
    this.assertUsable(); validateWaterStepParams(params);
    if (timestamps && (
      (timestamps.beginIndex === undefined && timestamps.endIndex === undefined) ||
      (timestamps.beginIndex !== undefined && (!Number.isSafeInteger(timestamps.beginIndex) || timestamps.beginIndex < 0)) ||
      (timestamps.endIndex !== undefined && (!Number.isSafeInteger(timestamps.endIndex) || timestamps.endIndex < 0)) ||
      (timestamps.beginIndex !== undefined && timestamps.beginIndex === timestamps.endIndex))) {
      throw new RangeError('Water timestamps need nonnegative integer indices; begin/end must differ when both are supplied.');
    }
    if (timestamps) {
      if (!this.device.features.has('timestamp-query') || timestamps.querySet.type !== 'timestamp') {
        throw new RangeError('Water timestamps require the timestamp-query device feature and a timestamp query set.');
      }
      if ((timestamps.beginIndex !== undefined && timestamps.beginIndex >= timestamps.querySet.count) ||
          (timestamps.endIndex !== undefined && timestamps.endIndex >= timestamps.querySet.count)) {
        throw new RangeError('Water timestamp index exceeds the query set count.');
      }
    }
    const group = this.parameters(params).groups[this.parity];
    const dispatches = [
      [Math.ceil((this.cols - 2) / 8), Math.ceil((this.rows - 2) / 8)],
      [Math.ceil((this.cols - 2) / 8), Math.ceil((this.rows - 2) / 8)],
      [Math.ceil(this.cols / 64), 1], [Math.ceil(this.rows / 64), 1],
    ];
    for (let stage = 0; stage < 4; stage++) {
      const descriptor: GPUComputePassDescriptor = { label: `Water ${ENTRY_POINTS[stage]}` };
      if (timestamps?.beginIndex !== undefined && stage === 0) descriptor.timestampWrites = { querySet: timestamps.querySet, beginningOfPassWriteIndex: timestamps.beginIndex };
      if (timestamps?.endIndex !== undefined && stage === 3) descriptor.timestampWrites = { querySet: timestamps.querySet, endOfPassWriteIndex: timestamps.endIndex };
      const pass = encoder.beginComputePass(descriptor);
      pass.setPipeline(this.pipelines[stage]); pass.setBindGroup(0, group);
      pass.dispatchWorkgroups(dispatches[stage][0], dispatches[stage][1]); pass.end();
    }
    this.parity = this.parity === 0 ? 1 : 0; this.stepCount++;
  }

  /** Diagnostic/checkpoint readback only; first submit all encoded steps. */
  async readback(): Promise<WaterSnapshot> {
    this.assertUsable();
    const count = this.count; const steps = this.stepCount;
    const fields = [this.fields[this.parity], this.fields[this.parity === 0 ? 1 : 0]];
    const staging: GPUBuffer[] = [];
    try {
      const encoder = this.device.createCommandEncoder({ label: 'Water diagnostic readback' });
      for (const values of fields) for (const name of ['eta', 'u', 'v'] as const) {
        const buffer = this.device.createBuffer({ label: `Water readback ${name}`, size: this.byteLength,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
        staging.push(buffer); this.stagingBuffers.add(buffer);
        encoder.copyBufferToBuffer(values[name], 0, buffer, 0, this.byteLength);
      }
      this.device.queue.submit([encoder.finish()]);
      await Promise.all(staging.map(buffer => buffer.mapAsync(GPUMapMode.READ)));
      this.assertUsable();
      const arrays = staging.map(buffer => new Float32Array(buffer.getMappedRange(), 0, count).slice());
      return { current: { eta: arrays[0], u: arrays[1], v: arrays[2] },
        destination: { eta: arrays[3], u: arrays[4], v: arrays[5] }, steps };
    } finally {
      for (const buffer of staging) { buffer.unmap(); buffer.destroy(); this.stagingBuffers.delete(buffer); }
    }
  }

  /** Idempotent; does not destroy the shared device or caller-owned query sets. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (const fields of this.fields) { fields.eta.destroy(); fields.u.destroy(); fields.v.destroy(); }
    for (const value of this.parameterSets.values()) value.buffer.destroy();
    for (const buffer of this.stagingBuffers) buffer.destroy();
    this.parameterSets.clear(); this.stagingBuffers.clear();
  }
}
