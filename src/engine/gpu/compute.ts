/**
 * A small WebGPU compute framework for the simulation backends (docs/GPU_COMPUTE.md).
 *
 *  - `acquireGpuCompute` asks for an adapter and a device, checks the limits a backend needs (storage buffers per stage,
 *    storage-buffer binding size, workgroups per dimension) and raises the device's limits to the adapter's where a
 *    backend asks for more than the default. No adapter, or one that is too small, throws GPU_UNAVAILABLE.
 *  - `GpuCompute` wraps a device: shader modules and pipelines are created inside error scopes, and a compile or
 *    validation error becomes an EngineError (GPU_SHADER, GPU_VALIDATION) that carries the compiler's lines; buffers are
 *    read back with `mapAsync`; the device's `lost` promise sets `lost` and calls the listeners, after which every call
 *    throws GPU_DEVICE_LOST.
 *  - `GpuProgram` is an ordered list of dispatches. They are encoded into one compute pass in list order; WebGPU runs
 *    the dispatches of a pass in the order they were encoded, each seeing the writes of the ones before it.
 *  - `PingPong` is a pair of buffers with the roles "read" and "write" that swap.
 *
 * The framework owns no solver knowledge. It follows src/webgpu/water-compute.ts (error scopes popped before any await,
 * staging buffers for readback, the caller owns submission) and shares nothing with the renderer but the device.
 */
import {EngineError} from '../contracts.ts';

/** Limits a backend needs of a device: storage buffers per stage, the largest storage binding, workgroups per dimension, invocations per workgroup. */
export interface GpuComputeNeeds {
  /** Storage buffers bound in one compute stage. WebGPU guarantees 8. */
  readonly storageBuffers?:number;
  /** Bytes of the largest storage buffer. WebGPU guarantees 134 217 728 (128 MiB). */
  readonly storageBytes?:number;
  /** Largest dispatch count along one dimension. WebGPU guarantees 65 535. */
  readonly workgroups?:number;
  /** Invocations in one workgroup. WebGPU guarantees 256. */
  readonly invocations?:number;
}
/** The adapter a GpuCompute runs on (vendor, architecture, device, whether it is a software adapter) and its limits. */
export interface GpuComputeInfo {readonly vendor:string;readonly architecture:string;readonly device:string;readonly description:string;
  /** True for a software adapter (SwiftShader, llvmpipe, WARP): results are valid, timings say nothing about a GPU. */
  readonly software:boolean;
  readonly limits:{readonly storageBuffers:number;readonly storageBytes:number;readonly bufferBytes:number;readonly workgroups:number;readonly invocations:number}}
/** What `acquireGpuCompute` needs: the limits to check, and the GPU object to ask (default navigator.gpu). */
export interface GpuAcquireOptions extends GpuComputeNeeds {
  /** The WebGPU entry point. Default `navigator.gpu`. */
  readonly gpu?:GPU;
  readonly powerPreference?:GPUPowerPreference;
  readonly label?:string;
}
const unavailable=(message:string):never=>{throw new EngineError('GPU_UNAVAILABLE',message);};

/** True when this JavaScript environment has a WebGPU entry point (a device may still be refused). */
export const gpuComputeSupported=():boolean=>typeof navigator!=='undefined'&&!!(navigator as Navigator&{gpu?:GPU}).gpu;

/** An adapter and a device for compute, with the limits `needs` asks for. Throws GPU_UNAVAILABLE with the reason. */
export async function acquireGpuCompute(options:GpuAcquireOptions={}):Promise<GpuCompute> {
  const gpu=options.gpu??(typeof navigator!=='undefined'?(navigator as Navigator&{gpu?:GPU}).gpu:undefined);
  if(!gpu)return unavailable('This environment has no WebGPU (navigator.gpu is missing).');
  let adapter:GPUAdapter|null=null;
  try{adapter=await gpu.requestAdapter({powerPreference:options.powerPreference??'high-performance'});}catch(error){return unavailable(`WebGPU refused an adapter: ${error instanceof Error?error.message:String(error)}`);}
  if(!adapter)return unavailable('WebGPU returned no adapter.');
  const L=adapter.limits,need={storageBuffers:options.storageBuffers??8,storageBytes:options.storageBytes??0,workgroups:options.workgroups??1,invocations:options.invocations??64};
  if(L.maxStorageBuffersPerShaderStage<need.storageBuffers)unavailable(`The adapter binds ${L.maxStorageBuffersPerShaderStage} storage buffers per stage; ${need.storageBuffers} are needed.`);
  if(Math.min(L.maxStorageBufferBindingSize,L.maxBufferSize)<need.storageBytes)unavailable(`The adapter's largest storage buffer is ${Math.min(L.maxStorageBufferBindingSize,L.maxBufferSize)} bytes; ${need.storageBytes} are needed.`);
  if(L.maxComputeWorkgroupsPerDimension<need.workgroups)unavailable(`The adapter dispatches ${L.maxComputeWorkgroupsPerDimension} workgroups per dimension; ${need.workgroups} are needed.`);
  if(L.maxComputeInvocationsPerWorkgroup<need.invocations)unavailable(`The adapter runs ${L.maxComputeInvocationsPerWorkgroup} invocations per workgroup; ${need.invocations} are needed.`);
  // Ask only for what exceeds the defaults, so that the device is the portable one whenever that is enough.
  const requiredLimits:Record<string,number>={};
  if(need.storageBuffers>8)requiredLimits.maxStorageBuffersPerShaderStage=need.storageBuffers;
  if(need.storageBytes>134217728){requiredLimits.maxStorageBufferBindingSize=need.storageBytes;requiredLimits.maxBufferSize=Math.max(268435456,need.storageBytes);}
  if(need.workgroups>65535)requiredLimits.maxComputeWorkgroupsPerDimension=need.workgroups;
  if(need.invocations>256)requiredLimits.maxComputeInvocationsPerWorkgroup=need.invocations;
  let device:GPUDevice;
  try{device=await adapter.requestDevice({label:options.label??'box3d compute',requiredLimits});}catch(error){return unavailable(`WebGPU refused a device: ${error instanceof Error?error.message:String(error)}`);}
  const info=(adapter as GPUAdapter&{info?:GPUAdapterInfo}).info;
  return new GpuCompute(device,info);
}

export interface GpuDispatch {readonly pipeline:GPUComputePipeline;readonly bindGroups:readonly GPUBindGroup[];
  /** Workgroup counts along x, y, z. A count of 0 skips the dispatch. */
  readonly workgroups:readonly [number,number?,number?];
  /** Dynamic offsets of bind group 0, when its layout has any. */
  readonly offsets?:readonly number[];
  readonly label?:string}

/** Dispatches that run in list order. */
export class GpuProgram {
  readonly dispatches:GpuDispatch[]=[];
  add(dispatch:GpuDispatch):this {this.dispatches.push(dispatch);return this;}
  /** Encode every dispatch into one compute pass, in order. Nothing is submitted. */
  encode(encoder:GPUCommandEncoder,label='compute'):void {
    if(this.dispatches.length===0)return;
    const pass=encoder.beginComputePass({label});
    for(const d of this.dispatches){
      const [x,y=1,z=1]=d.workgroups;if(x<1||y<1||z<1)continue;
      pass.setPipeline(d.pipeline);
      for(let g=0;g<d.bindGroups.length;g++){if(g===0&&d.offsets)pass.setBindGroup(0,d.bindGroups[0],d.offsets as number[]);else pass.setBindGroup(g,d.bindGroups[g]);}
      pass.dispatchWorkgroups(x,y,z);
    }
    pass.end();
  }
}

/** Two buffers of the same size: one is read while the other is written, then they swap. */
export class PingPong {
  private flip=0;
  readonly a:GPUBuffer;readonly b:GPUBuffer;
  constructor(a:GPUBuffer,b:GPUBuffer) {this.a=a;this.b=b;}
  get read():GPUBuffer {return this.flip===0?this.a:this.b;}
  get write():GPUBuffer {return this.flip===0?this.b:this.a;}
  /** 0 while `a` is the one to read. */
  get parity():0|1 {return this.flip as 0|1;}
  swap():void {this.flip^=1;}
  destroy():void {this.a.destroy();this.b.destroy();}
}

type TypedArray=Float32Array|Uint32Array|Int32Array|Uint8Array;
/** A WebGPU device for compute: buffers, shader modules and pipelines inside error scopes, readback, and device loss as GPU_DEVICE_LOST. */
export class GpuCompute {
  readonly info:GpuComputeInfo;
  private lostMessage:string|null=null;
  private readonly listeners:((reason:string)=>void)[]=[];
  private readonly owned=new Set<GPUBuffer>();
  readonly device:GPUDevice;
  constructor(device:GPUDevice,adapterInfo?:Partial<GPUAdapterInfo>|null) {
    this.device=device;
    const L=device.limits,text=(value:unknown):string=>typeof value==='string'?value:'';
    const vendor=text(adapterInfo?.vendor),architecture=text(adapterInfo?.architecture),name=text(adapterInfo?.device),description=text(adapterInfo?.description);
    const software=/swiftshader|llvmpipe|lavapipe|warp|software|null/i.test(`${vendor} ${architecture} ${name} ${description}`);
    this.info=Object.freeze({vendor,architecture,device:name,description,software,limits:Object.freeze({storageBuffers:L.maxStorageBuffersPerShaderStage,storageBytes:L.maxStorageBufferBindingSize,bufferBytes:L.maxBufferSize,workgroups:L.maxComputeWorkgroupsPerDimension,invocations:L.maxComputeInvocationsPerWorkgroup})});
    void device.lost.then(lost=>{
      this.lostMessage=lost?.message||'The WebGPU device was lost.';
      for(const listener of this.listeners.splice(0))try{listener(this.lostMessage);}catch{/* a listener's failure must not stop the others */}
    });
  }
  /** True once the device is lost; every later call throws GPU_DEVICE_LOST. */
  get lost():boolean {return this.lostMessage!==null;}
  get lossReason():string|null {return this.lostMessage;}
  /** Call `listener` when the device is lost (at once when it already is). */
  onLost(listener:(reason:string)=>void):void {if(this.lostMessage!==null)listener(this.lostMessage);else this.listeners.push(listener);}
  assertAlive():void {if(this.lostMessage!==null)throw new EngineError('GPU_DEVICE_LOST',`The WebGPU device was lost: ${this.lostMessage}`);}

  /** A buffer this object destroys with `destroy()`. `data` fills it from offset 0. */
  buffer(label:string,size:number,usage:GPUBufferUsageFlags,data?:ArrayBufferView|ArrayBuffer):GPUBuffer {
    this.assertAlive();
    const bytes=Math.max(4,Math.ceil(size/4)*4);
    if(bytes>this.device.limits.maxBufferSize)throw new EngineError('GPU_UNAVAILABLE',`${label} needs ${bytes} bytes; this device's largest buffer is ${this.device.limits.maxBufferSize}.`);
    const buffer=this.device.createBuffer({label,size:bytes,usage});
    this.owned.add(buffer);
    if(data)this.write(buffer,data);
    return buffer;
  }
  /** A storage buffer that can also be copied from and to. */
  storage(label:string,size:number,data?:ArrayBufferView|ArrayBuffer):GPUBuffer {
    if(size>this.device.limits.maxStorageBufferBindingSize)throw new EngineError('GPU_UNAVAILABLE',`${label} needs ${size} bytes; this device binds storage buffers of at most ${this.device.limits.maxStorageBufferBindingSize}.`);
    return this.buffer(label,size,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,data);
  }
  write(buffer:GPUBuffer,data:ArrayBufferView|ArrayBuffer,offset=0):void {
    this.assertAlive();
    if(data instanceof ArrayBuffer)this.device.queue.writeBuffer(buffer,offset,data);
    else this.device.queue.writeBuffer(buffer,offset,data.buffer as ArrayBuffer,data.byteOffset,data.byteLength);
  }
  release(buffer:GPUBuffer):void {if(this.owned.delete(buffer))buffer.destroy();}

  /**
   * Run `work` inside validation and out-of-memory error scopes. The scopes are popped before anything is awaited, so
   * that another user of the device cannot change which scope owns an error. Throws GPU_VALIDATION (or GPU_OUT_OF_MEMORY).
   */
  async scoped<T>(label:string,work:()=>T|Promise<T>):Promise<T> {
    this.assertAlive();
    const device=this.device;
    device.pushErrorScope('validation');device.pushErrorScope('out-of-memory');
    let result:T|Promise<T>|undefined,thrown:unknown;
    try{result=work();}catch(error){thrown=error;}
    const memory=device.popErrorScope(),validation=device.popErrorScope();
    const [value,memoryError,validationError]=await Promise.allSettled([Promise.resolve(result),memory,validation]);
    const lost=this.lostMessage;
    if(lost!==null)throw new EngineError('GPU_DEVICE_LOST',`${label}: the WebGPU device was lost: ${lost}`);
    if(validationError.status==='fulfilled'&&validationError.value)throw new EngineError('GPU_VALIDATION',`${label}: ${validationError.value.message}`);
    if(memoryError.status==='fulfilled'&&memoryError.value)throw new EngineError('GPU_OUT_OF_MEMORY',`${label}: ${memoryError.value.message}`);
    if(thrown!==undefined)throw thrown instanceof EngineError?thrown:new EngineError('GPU_VALIDATION',`${label}: ${thrown instanceof Error?thrown.message:String(thrown)}`);
    if(value.status==='rejected')throw value.reason instanceof EngineError?value.reason:new EngineError('GPU_VALIDATION',`${label}: ${value.reason instanceof Error?value.reason.message:String(value.reason)}`);
    return value.value as T;
  }
  /** Compile WGSL. A compile error throws GPU_SHADER with every message as `line:column text`. */
  async module(label:string,code:string):Promise<GPUShaderModule> {
    this.assertAlive();
    this.device.pushErrorScope('validation');
    const module=this.device.createShaderModule({label,code});
    const scope=this.device.popErrorScope();
    const [info,error]=await Promise.all([module.getCompilationInfo?module.getCompilationInfo():Promise.resolve({messages:[]} as unknown as GPUCompilationInfo),scope]);
    const errors=info.messages.filter(m=>m.type==='error');
    if(errors.length){
      const lines=code.split('\n');
      throw new EngineError('GPU_SHADER',`${label} does not compile:\n${errors.map(m=>`${m.lineNum}:${m.linePos} ${m.message}\n    ${(lines[m.lineNum-1]??'').trim()}`).join('\n')}`);
    }
    if(error)throw new EngineError('GPU_SHADER',`${label}: ${error.message}`);
    return module;
  }
  /** A compute pipeline for one entry point. A layout or entry-point mismatch throws GPU_VALIDATION. */
  async pipeline(label:string,module:GPUShaderModule,entryPoint:string,layout:GPUPipelineLayout|'auto'='auto'):Promise<GPUComputePipeline> {
    return this.scoped(label,()=>{
      const descriptor:GPUComputePipelineDescriptor={label,layout,compute:{module,entryPoint}};
      return this.device.createComputePipelineAsync?this.device.createComputePipelineAsync(descriptor):this.device.createComputePipeline(descriptor);
    });
  }
  /** A bind-group layout of buffers for the compute stage: 'uniform', 'uniform-dynamic', 'read' (read-only storage) or 'write' (storage). */
  layout(label:string,bindings:readonly ('uniform'|'uniform-dynamic'|'read'|'write')[]):GPUBindGroupLayout {
    this.assertAlive();
    return this.device.createBindGroupLayout({label,entries:bindings.map((kind,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,
      buffer:kind==='uniform'?{type:'uniform' as const}:kind==='uniform-dynamic'?{type:'uniform' as const,hasDynamicOffset:true}:{type:kind==='read'?'read-only-storage' as const:'storage' as const}}))});
  }
  /** A bind group of whole buffers (or {buffer, size} for a dynamic-offset uniform window) in binding order. */
  bind(label:string,layout:GPUBindGroupLayout,buffers:readonly (GPUBuffer|{readonly buffer:GPUBuffer;readonly size:number})[]):GPUBindGroup {
    this.assertAlive();
    return this.device.createBindGroup({label,layout,entries:buffers.map((entry,binding)=>({binding,resource:'buffer' in entry?{buffer:entry.buffer,offset:0,size:entry.size}:{buffer:entry}}))});
  }

  /**
   * Copy `size` bytes of each buffer from `offset` and wait for them. Everything submitted before this call has run by
   * the time it resolves, so this is also how a caller waits for the GPU. Throws GPU_DEVICE_LOST when the device goes
   * while waiting.
   */
  async read(sources:readonly {readonly buffer:GPUBuffer;readonly offset?:number;readonly size?:number}[]):Promise<ArrayBuffer[]> {
    this.assertAlive();
    const device=this.device,staging:GPUBuffer[]=[],encoder=device.createCommandEncoder({label:'compute readback'});
    try{
      for(const s of sources){
        const offset=s.offset??0,size=Math.ceil((s.size??s.buffer.size-offset)/4)*4;
        const target=device.createBuffer({label:'compute readback staging',size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
        staging.push(target);encoder.copyBufferToBuffer(s.buffer,offset,target,0,size);
      }
      device.queue.submit([encoder.finish()]);
      try{await Promise.all(staging.map(b=>b.mapAsync(GPUMapMode.READ)));}
      catch(error){if(this.lostMessage===null)await Promise.race([device.lost,new Promise(resolve=>setTimeout(resolve,50))]);
        throw new EngineError(this.lostMessage!==null?'GPU_DEVICE_LOST':'GPU_VALIDATION',`Readback failed: ${this.lostMessage??(error instanceof Error?error.message:String(error))}`);}
      this.assertAlive();
      return staging.map(b=>b.getMappedRange().slice(0));
    }finally{for(const b of staging){try{b.unmap();}catch{/* never mapped */}b.destroy();}}
  }
  async readTyped<T extends TypedArray>(buffer:GPUBuffer,Type:{new(buffer:ArrayBuffer):T},offset=0,size?:number):Promise<T> {
    const [bytes]=await this.read([{buffer,offset,size}]);return new Type(bytes);
  }
  /** Destroy the buffers made here. The device is the caller's. */
  destroy():void {for(const buffer of this.owned)buffer.destroy();this.owned.clear();}
}
