/** Stable material partitioning. Original instance order is retained in both lists. */
export const partitionVertexBindings = /* wgsl */ `
@group(1) @binding(0) var<storage, read> partitionMatrices : array<mat4x4<f32>>;
@group(1) @binding(1) var<storage, read> partitionColors : array<vec4<f32>>;
@group(1) @binding(2) var<storage, read> partitionIds : array<u32>;
`;

export const partitionVertexEntry = /* wgsl */ `
@vertex
fn vsPartitioned(@location(0) position : vec3<f32>, @location(1) normal : vec3<f32>,
                 @builtin(instance_index) instance : u32) -> VertexOut {
  let id = partitionIds[instance];
  let model = partitionMatrices[id];
  return vertexForInstance(VertexIn(position, normal, model[0], model[1], model[2], model[3], partitionColors[id]));
}
`;

// Three dispatches form global synchronization boundaries. Atomics are not used
// to assign output slots: their unspecified execution order would change blending.
export const instancePartitionShader = /* wgsl */ `
struct Params { count : u32, groups : u32, vertices : u32, padding : u32 };
@group(0) @binding(0) var<uniform> params : Params;
@group(0) @binding(1) var<storage, read> colors : array<vec4<f32>>;
@group(0) @binding(2) var<storage, read_write> ranks : array<u32>;
@group(0) @binding(3) var<storage, read_write> groups : array<u32>;
@group(0) @binding(4) var<storage, read_write> opaqueIds : array<u32>;
@group(0) @binding(5) var<storage, read_write> transparentIds : array<u32>;
@group(0) @binding(6) var<storage, read_write> draws : array<u32>;
var<workgroup> prefix : array<u32, 64>;

fn isTransparent(id : u32) -> bool {
  let material = i32(round(max(-colors[id].a, 0.0)));
  return material == 4 || material == 6;
}

@compute @workgroup_size(64)
fn localRanks(@builtin(global_invocation_id) global : vec3<u32>,
             @builtin(local_invocation_id) local : vec3<u32>,
             @builtin(workgroup_id) group : vec3<u32>) {
  let id = global.x;
  let lane = local.x;
  var flag = 0u;
  if (id < params.count) { flag = select(0u, 1u, isTransparent(id)); }
  prefix[lane] = flag;
  workgroupBarrier();
  for (var stride = 1u; stride < 64u; stride *= 2u) {
    var add = 0u;
    if (lane >= stride) { add = prefix[lane - stride]; }
    workgroupBarrier();
    prefix[lane] += add;
    workgroupBarrier();
  }
  if (id < params.count) { ranks[id] = prefix[lane] - flag; }
  if (lane == 63u) { groups[group.x] = prefix[lane]; }
}

@compute @workgroup_size(1)
fn groupOffsets() {
  var total = 0u;
  for (var group = 0u; group < params.groups; group++) {
    let size = groups[group];
    groups[group] = total;
    total += size;
  }
  draws[0] = params.vertices; draws[1] = params.count - total; draws[2] = 0u; draws[3] = 0u;
  draws[4] = params.vertices; draws[5] = total; draws[6] = 0u; draws[7] = 0u;
}

@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) global : vec3<u32>) {
  let id = global.x;
  if (id >= params.count) { return; }
  let before = groups[id / 64u] + ranks[id];
  if (isTransparent(id)) { transparentIds[before] = id; }
  else { opaqueIds[id - before] = id; }
}
`;

export class InstancePartition {
  readonly vertexLayout: GPUBindGroupLayout;
  readonly opaqueBindGroup: GPUBindGroup;
  readonly transparentBindGroup: GPUBindGroup;
  readonly indirectBuffer: GPUBuffer;
  private dirty = true;
  private count = -1;
  private disposed = false;
  private readonly params = new Uint32Array(4);
  builds = 0;
  reuses = 0;
  readonly capacity: number;
  private readonly device: GPUDevice;
  private readonly buffers: GPUBuffer[];
  private readonly pipelines: GPUComputePipeline[];
  private readonly computeBindGroup: GPUBindGroup;
  private readonly computeLayout: GPUBindGroupLayout;

  private constructor(device: GPUDevice, capacity: number,
    buffers: GPUBuffer[], pipelines: GPUComputePipeline[],
    computeBindGroup: GPUBindGroup, vertexLayout: GPUBindGroupLayout,
    opaqueBindGroup: GPUBindGroup, transparentBindGroup: GPUBindGroup, computeLayout: GPUBindGroupLayout) {
    this.device = device; this.capacity = capacity; this.buffers = buffers;
    this.pipelines = pipelines; this.computeBindGroup = computeBindGroup;
    this.vertexLayout = vertexLayout;
    this.computeLayout = computeLayout;
    this.opaqueBindGroup = opaqueBindGroup;
    this.transparentBindGroup = transparentBindGroup;
    this.indirectBuffer = buffers[5]!;
  }

  static async create(device: GPUDevice, capacity: number, matrices: GPUBuffer, colors: GPUBuffer): Promise<InstancePartition> {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 1048576) throw new RangeError('Invalid instance partition capacity.');
    const buffers: GPUBuffer[] = [];
    try {
      const make = (label: string, size: number, usage: number) => {
        const buffer = device.createBuffer({ label, size, usage }); buffers.push(buffer); return buffer;
      };
      const uniform = make('Instance partition parameters', 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST);
      const ranks = make('Instance partition local ranks', capacity * 4, GPUBufferUsage.STORAGE);
      const groups = make('Instance partition group offsets', Math.ceil(capacity / 64) * 4, GPUBufferUsage.STORAGE);
      const opaque = make('Opaque instance IDs', capacity * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const transparent = make('Transparent instance IDs', capacity * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC);
      const indirect = make('Partitioned indirect draws', 32, GPUBufferUsage.STORAGE | GPUBufferUsage.INDIRECT | GPUBufferUsage.COPY_SRC);
      const computeLayout = device.createBindGroupLayout({ label: 'Instance partition compute layout', entries:
        ['uniform', 'read-only-storage', 'storage', 'storage', 'storage', 'storage', 'storage'].map((type, binding) =>
          ({ binding, visibility: GPUShaderStage.COMPUTE, buffer: { type: type as GPUBufferBindingType } })) });
      const computeBindGroup = device.createBindGroup({ label: 'Instance partition compute inputs', layout: computeLayout,
        entries: [uniform, colors, ranks, groups, opaque, transparent, indirect].map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const vertexLayout = device.createBindGroupLayout({ label: 'Partitioned instance vertex layout', entries:
        [0, 1, 2].map(binding => ({ binding, visibility: GPUShaderStage.VERTEX, buffer: { type: 'read-only-storage' } })) });
      const bindVertices = (ids: GPUBuffer) => device.createBindGroup({ layout: vertexLayout,
        entries: [matrices, colors, ids].map((buffer, binding) => ({ binding, resource: { buffer } })) });
      const shader = device.createShaderModule({ label: 'Stable instance partition shader', code: instancePartitionShader });
      const diagnostics = await shader.getCompilationInfo?.();
      const errors = diagnostics?.messages.filter(message => message.type === 'error');
      if (errors?.length) throw new Error(`Instance partition shader: ${errors.map(error => error.message).join('\n')}`);
      const layout = device.createPipelineLayout({ bindGroupLayouts: [computeLayout] });
      const pipelines = await Promise.all(['localRanks', 'groupOffsets', 'scatter'].map(entryPoint => {
        const descriptor = { label: `Instance partition ${entryPoint}`, layout, compute: { module: shader, entryPoint } };
        return device.createComputePipelineAsync?.(descriptor) ?? device.createComputePipeline(descriptor);
      }));
      return new InstancePartition(device, capacity, buffers, pipelines, computeBindGroup, vertexLayout, bindVertices(opaque), bindVertices(transparent), computeLayout);
    } catch (error) { for (const buffer of buffers) buffer.destroy(); throw error; }
  }

  /** Allocate replacement storage while reusing the already compiled pipelines
   * and their exact layouts. The caller commits or disposes this replacement.
   */
  cloneForCapacity(capacity: number, matrices: GPUBuffer, colors: GPUBuffer): InstancePartition {
    if(this.disposed)throw new Error('Instance partition is disposed.');
    if(!Number.isSafeInteger(capacity)||capacity<this.capacity||capacity>1048576)throw new RangeError('Invalid instance partition growth capacity.');
    const buffers:GPUBuffer[]=[];
    try {
      const make=(label:string,size:number,usage:number)=>{
        const buffer=this.device.createBuffer({label,size,usage});buffers.push(buffer);return buffer;
      };
      const uniform=make('Instance partition parameters',16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      const ranks=make('Instance partition local ranks',capacity*4,GPUBufferUsage.STORAGE);
      const groups=make('Instance partition group offsets',Math.ceil(capacity/64)*4,GPUBufferUsage.STORAGE);
      const opaque=make('Opaque instance IDs',capacity*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
      const transparent=make('Transparent instance IDs',capacity*4,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
      make('Partitioned indirect draws',32,GPUBufferUsage.STORAGE|GPUBufferUsage.INDIRECT|GPUBufferUsage.COPY_SRC);
      const computeBindGroup=this.device.createBindGroup({label:'Grown instance partition inputs',layout:this.computeLayout,
        entries:[uniform,colors,ranks,groups,opaque,transparent,buffers[5]!].map((buffer,binding)=>({binding,resource:{buffer}}))});
      const bind=(ids:GPUBuffer)=>this.device.createBindGroup({layout:this.vertexLayout,
        entries:[matrices,colors,ids].map((buffer,binding)=>({binding,resource:{buffer}}))});
      return new InstancePartition(this.device,capacity,buffers,[...this.pipelines],computeBindGroup,this.vertexLayout,bind(opaque),bind(transparent),this.computeLayout);
    }catch(error){for(const buffer of buffers)buffer.destroy();throw error;}
  }

  invalidate(): void { this.dirty = true; }
  needsUpdate(count: number): boolean {
    if (this.disposed) throw new Error('Instance partition is disposed.');
    if (!Number.isSafeInteger(count) || count < 0 || count > this.capacity) throw new RangeError('Invalid partition instance count.');
    return this.dirty || this.count !== count;
  }
  encode(pass: GPUComputePassEncoder, count: number, vertexCount: number): void {
    if (!this.needsUpdate(count)) return;
    this.params.set([count, Math.ceil(count / 64), vertexCount, 0]);
    this.device.queue.writeBuffer(this.buffers[0]!, 0, this.params.buffer);
    pass.setBindGroup(0, this.computeBindGroup);
    for (let i = 0; i < this.pipelines.length; i++) {
      const workgroups = i === 1 ? 1 : this.params[1]!;
      if (workgroups === 0) continue;
      pass.setPipeline(this.pipelines[i]!); pass.dispatchWorkgroups(workgroups);
    }
  }
  /** Commit only once the command buffer has actually been submitted. */
  submitted(count: number, rebuilt: boolean): void {
    this.count = count; this.dirty = false;
    if (rebuilt) this.builds++; else this.reuses++;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const buffer of this.buffers) buffer.destroy();
    this.buffers.length = 0; this.pipelines.length = 0;
  }
}
