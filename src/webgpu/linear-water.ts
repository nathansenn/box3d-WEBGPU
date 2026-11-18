import {createLinearWaterArrays,validateLinearWaterConfig,type LinearWaterArrays,type LinearWaterConfig} from '../engine/linear-water.ts';
import {closedWaterCoefficients,copyClosedWaterArrays} from '../engine/closed-water.ts';
import {closedWaterShader} from './closed-water-shader.ts';
import type {EngineCapabilities} from '../engine/contracts.ts';
import {WaterTelemetryReader,type WaterTelemetry} from './water-telemetry.ts';
import {GpuStartupBudget,type GpuStartupOptions} from './startup-budget.ts';

export const GPU_LINEAR_WATER_BACKEND='linear-water-webgpu-f32-v1';
export const GPU_CLOSED_WATER_BACKEND='linear-water-closed-cgrid-webgpu-f32-v1';
export type GpuWaterBackend=typeof GPU_LINEAR_WATER_BACKEND|typeof GPU_CLOSED_WATER_BACKEND;
export const linearWaterShader=/* wgsl */ `
struct Params { cols:u32, rows:u32, count:u32, padding:u32, decay:f32, px:f32, pz:f32, cx:f32, cz:f32, pad0:f32, pad1:f32, pad2:f32 };
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> eta:array<f32>;
@group(0) @binding(2) var<storage,read> u:array<f32>;
@group(0) @binding(3) var<storage,read> v:array<f32>;
@group(0) @binding(4) var<storage,read_write> nextEta:array<f32>;
@group(0) @binding(5) var<storage,read_write> nextU:array<f32>;
@group(0) @binding(6) var<storage,read_write> nextV:array<f32>;

@compute @workgroup_size(64)
fn velocity(@builtin(global_invocation_id) global:vec3<u32>) {
  let i=global.x; if(i>=params.count){return;}
  let x=i%params.cols; let z=i/params.cols;
  if(x==0u||z==0u||x+1u==params.cols||z+1u==params.rows){return;}
  nextU[i]=u[i]*params.decay-(eta[i+1u]-eta[i-1u])*params.px;
  nextV[i]=v[i]*params.decay-(eta[i+params.cols]-eta[i-params.cols])*params.pz;
}
@compute @workgroup_size(64)
fn continuity(@builtin(global_invocation_id) global:vec3<u32>) {
  let i=global.x; if(i>=params.count){return;}
  let x=i%params.cols; let z=i/params.cols;
  if(x==0u||z==0u||x+1u==params.cols||z+1u==params.rows){return;}
  nextEta[i]=clamp(eta[i]-(nextU[i+1u]-nextU[i-1u])*params.cx-(nextV[i+params.cols]-nextV[i-params.cols])*params.cz,-1.65,1.65);
}
@compute @workgroup_size(64)
fn horizontalBoundary(@builtin(global_invocation_id) global:vec3<u32>) {
  let x=global.x;if(x>=params.cols){return;}
  // The following vertical dispatch overwrites corners after these rows.
  // Corners read stale destination edge cells here, exactly as the CPU reference.
  let bottom=(params.rows-1u)*params.cols+x;let inner=(params.rows-2u)*params.cols+x;
  nextEta[x]=nextEta[params.cols+x]*.92;nextU[x]=nextU[params.cols+x]*.78;nextV[x]=-nextV[params.cols+x]*.18;
  nextEta[bottom]=nextEta[inner]*.92;nextU[bottom]=nextU[inner]*.78;nextV[bottom]=-nextV[inner]*.18;
}
@compute @workgroup_size(64)
fn verticalBoundary(@builtin(global_invocation_id) global:vec3<u32>) {
  let z=global.x;if(z>=params.rows){return;}
  let left=z*params.cols;let right=left+params.cols-1u;
  nextEta[left]=nextEta[left+1u]*.92;nextU[left]=-nextU[left+1u]*.18;nextV[left]=nextV[left+1u]*.78;
  nextEta[right]=nextEta[right-1u]*.92;nextU[right]=-nextU[right-1u]*.18;nextV[right]=nextV[right-1u]*.78;
}
`;

export interface GpuWaterFields {
  readonly backend:GpuWaterBackend;
  readonly owner:GpuLinearWater;
  readonly device:GPUDevice;
  readonly eta:GPUBuffer;readonly u:GPUBuffer;readonly v:GPUBuffer;
  readonly cols:number;readonly rows:number;readonly tick:number;readonly time:number;
}
interface ReadableBuffer extends GPUBuffer {
  mapAsync(mode:number):Promise<void>;getMappedRange():ArrayBuffer;unmap():void;
}
interface CopyEncoder extends GPUCommandEncoder {
  copyBufferToBuffer(source:GPUBuffer,sourceOffset:number,destination:GPUBuffer,destinationOffset:number,size:number):void;
}
export interface GpuWaterCheckpoint {backend:GpuWaterBackend;version:1;tick:number;config:Readonly<LinearWaterConfig>;state:LinearWaterArrays}
export type GpuWaterCreateOptions=GpuStartupOptions;

/** GPU numerical field only; no implicit substitution for the authored interactive water studies. */
export class GpuLinearWater {
  readonly backend:GpuWaterBackend;
  readonly velocityLayout:'cell-centered'|'east-north-faces';
  readonly config:Readonly<LinearWaterConfig>;
  readonly capabilities:EngineCapabilities;
  readonly device:GPUDevice;
  private readonly fields:GPUBuffer[];
  private readonly params:GPUBuffer;
  private readonly groups:GPUBindGroup[];
  private readonly pipelines:GPUComputePipeline[];
  private parity=0;
  private currentTick=0;
  private destroyed=false;
  private loss:string|null=null;
  private readback:ReadableBuffer|null=null;
  private telemetryReader:Promise<WaterTelemetryReader>|null=null;
  private telemetryPending=false;

  private constructor(device:GPUDevice,config:Readonly<LinearWaterConfig>,fields:GPUBuffer[],params:GPUBuffer,groups:GPUBindGroup[],pipelines:GPUComputePipeline[],backend:GpuWaterBackend) {
    this.backend=backend;this.velocityLayout=backend===GPU_CLOSED_WATER_BACKEND?'east-north-faces':'cell-centered';
    this.device=device;this.config=config;this.fields=fields;this.params=params;this.groups=groups;this.pipelines=pipelines;
    this.capabilities=Object.freeze({adapter:'water-field',models:Object.freeze([Object.freeze({id:this.backend,name:backend===GPU_CLOSED_WATER_BACKEND?'Closed-basin linear shallow water':'Linear water field',implementation:'webgpu-f32',calibration:backend===GPU_CLOSED_WATER_BACKEND?'uncalibrated-physical':'authored-comparative'})]),fixedDt:config.dt,deterministicCommands:true,checkpoint:true,worker:false,gpuReadback:true,snapshotOwnership:'gpu-borrow'});
    const lost=(device as GPUDevice&{lost?:Promise<{reason:string;message:string}>}).lost;
    void lost?.then(info=>{if(!this.destroyed)this.loss=`${info.reason}: ${info.message}`;},error=>{if(!this.destroyed)this.loss=String(error);});
  }
  static async create(device:GPUDevice,input:LinearWaterConfig,initial:Partial<LinearWaterArrays>={},options:GpuWaterCreateOptions={}):Promise<GpuLinearWater> {
    return GpuLinearWater.createBackend(device,input,initial,options,GPU_LINEAR_WATER_BACKEND);
  }
  /** Distinct conservative model. Prepare synchronized input with createClosedWaterArrays.
   * Raw initial velocities here are face values at t=-dt/2, as in its checkpoints.
   */
  static async createClosed(device:GPUDevice,input:LinearWaterConfig,initial:Partial<LinearWaterArrays>={},options:GpuWaterCreateOptions={}):Promise<GpuLinearWater> {
    return GpuLinearWater.createBackend(device,input,initial,options,GPU_CLOSED_WATER_BACKEND);
  }
  private static async createBackend(device:GPUDevice,input:LinearWaterConfig,initial:Partial<LinearWaterArrays>,options:GpuWaterCreateOptions,backend:GpuWaterBackend):Promise<GpuLinearWater> {
    const startup=new GpuStartupBudget(options,'GPU water');startup.check('Allocating state');
    const closed=backend===GPU_CLOSED_WATER_BACKEND;
    const config=validateLinearWaterConfig(input),state=closed?copyClosedWaterArrays(config,initial):createLinearWaterArrays(config,initial),allocated:GPUBuffer[]=[];
    try {
      options.onStartupProgress?.('Allocating GPU water state');
      const fields=Object.entries(state).map(([name,value])=>{
        const buffer=device.createBuffer({label:`GPU water ${name}`,size:value.byteLength,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC});
        allocated.push(buffer);device.queue.writeBuffer(buffer,0,value.buffer);return buffer;
      });
      const params=device.createBuffer({label:'GPU water coefficients',size:48,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST});allocated.push(params);
      const data=new ArrayBuffer(48),ints=new Uint32Array(data),floats=new Float32Array(data);
      const {cols,rows,dt,gravity,meanDepth,drag,dx,dz}=config;
      const coefficients=closed?closedWaterCoefficients(config):null;
      ints.set([cols,rows,cols*rows,0]);floats.set(coefficients?[coefficients.decay,coefficients.px,coefficients.pz,coefficients.cx,coefficients.cz]:[1-drag*dt,gravity*dt/(2*dx),gravity*dt/(2*dz),meanDepth*dt/(2*dx),meanDepth*dt/(2*dz)],4);
      device.queue.writeBuffer(params,0,data);
      const bindings=device.createBindGroupLayout({entries:['uniform','read-only-storage','read-only-storage','read-only-storage','storage','storage','storage'].map((type,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:type as GPUBufferBindingType}}))});
      const groups=[0,1].map(parity=>device.createBindGroup({layout:bindings,entries:[params,...fields.slice(parity*3,parity*3+3),...fields.slice((1-parity)*3,(1-parity)*3+3)].map((buffer,binding)=>({binding,resource:{buffer}}))}));
      const shader=device.createShaderModule({label:'GPU linear water numerical solver',code:closed?closedWaterShader:linearWaterShader});
      const info=await startup.wait('Validating GPU water shader',()=>shader.getCompilationInfo?.()),errors=info?.messages.filter(message=>message.type==='error');
      if(errors?.length)throw new Error(errors.map(error=>error.message).join('\n'));
      const layout=device.createPipelineLayout({bindGroupLayouts:[bindings]});
      const stages=closed?['velocity','continuity']:['velocity','continuity','horizontalBoundary','verticalBoundary'];
      const pipelines=await startup.wait('Compiling GPU water pipelines',()=>Promise.all(stages.map(entryPoint=>{
        const descriptor={label:`GPU water ${entryPoint}`,layout,compute:{module:shader,entryPoint}};
        return device.createComputePipelineAsync?.(descriptor)??device.createComputePipeline(descriptor);
      })));
      return new GpuLinearWater(device,config,fields,params,groups,pipelines,backend);
    }catch(error){for(const buffer of allocated)buffer.destroy();throw error;}
  }
  get tick():number{return this.currentTick;}
  get alive():boolean{return !this.destroyed&&!this.loss;}
  private assertAlive():void {if(!this.alive)throw new Error(this.destroyed?'GPU water is destroyed.':`GPU water device lost: ${this.loss}`);}
  getFields():GpuWaterFields {
    this.assertAlive();const base=this.parity*3;
    return {backend:this.backend,owner:this,device:this.device,eta:this.fields[base]!,u:this.fields[base+1]!,v:this.fields[base+2]!,cols:this.config.cols,rows:this.config.rows,tick:this.tick,time:this.tick*this.config.dt};
  }
  /** Submit fixed ticks, without CPU state readback or a queue-wide wait. */
  step(ticks=1):GpuWaterFields {
    this.assertAlive();
    if(!Number.isSafeInteger(ticks)||ticks<0||ticks>120||!Number.isSafeInteger(this.tick+ticks))throw new RangeError('GPU water batches require 0–120 fixed ticks.');
    if(!ticks)return this.getFields();
    const encoder=this.device.createCommandEncoder({label:'GPU linear water step'}),pass=encoder.beginComputePass({label:'GPU water numerical updates'});
    const {cols,rows}=this.config;let parity=this.parity;
    for(let tick=0;tick<ticks;tick++) {
      pass.setBindGroup(0,this.groups[parity]!);
      for(let stage=0;stage<this.pipelines.length;stage++) {
        pass.setPipeline(this.pipelines[stage]!);
        pass.dispatchWorkgroups(Math.ceil((stage===2?cols:stage===3?rows:cols*rows)/64));
      }
      parity=1-parity;
    }
    pass.end();this.device.queue.submit([encoder.finish()]);
    this.parity=parity;this.currentTick+=ticks;return this.getFields();
  }
  /** One bounded explicit readback. Captures both ping-pong histories needed at boundaries. */
  async checkpoint():Promise<GpuWaterCheckpoint> {
    this.assertAlive();if(this.readback)throw new Error('GPU water readback is already in flight.');
    const bytes=this.config.cols*this.config.rows*4,parity=this.parity,tick=this.tick;
    const staging=this.device.createBuffer({label:'GPU water checkpoint readback',size:bytes*6,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ}) as ReadableBuffer;
    this.readback=staging;
    try {
      const encoder=this.device.createCommandEncoder() as CopyEncoder;
      const fields=[...this.fields.slice(parity*3,parity*3+3),...this.fields.slice((1-parity)*3,(1-parity)*3+3)];
      fields.forEach((buffer,index)=>encoder.copyBufferToBuffer(buffer,0,staging,index*bytes,bytes));
      this.device.queue.submit([encoder.finish()]);await staging.mapAsync(1);this.assertAlive();
      const buffer=staging.getMappedRange(),names=['eta','u','v','nextEta','nextU','nextV'] as const;
      const state=Object.fromEntries(names.map((name,index)=>[name,new Float32Array(buffer,index*bytes,bytes/4).slice()])) as unknown as LinearWaterArrays;
      if(!Object.values(state).every(values=>values.every(Number.isFinite)))throw new Error('GPU water produced nonfinite state.');
      return {backend:this.backend,version:1,tick,config:this.config,state};
    }finally{
      if(this.readback===staging){
        this.readback=null;try{staging.unmap();}finally{staging.destroy();}
      }
    }
  }
  static async fromCheckpoint(device:GPUDevice,checkpoint:GpuWaterCheckpoint,options:GpuWaterCreateOptions={}):Promise<GpuLinearWater> {
    if(!checkpoint||![GPU_LINEAR_WATER_BACKEND,GPU_CLOSED_WATER_BACKEND].includes(checkpoint.backend)||checkpoint.version!==1||!Number.isSafeInteger(checkpoint.tick)||checkpoint.tick<0)throw new RangeError('Incompatible GPU water checkpoint.');
    const state=checkpoint.state;
    if(!state||Object.keys(state).length!==6||!['eta','u','v','nextEta','nextU','nextV'].every(key=>key in state))throw new RangeError('Incomplete GPU water checkpoint.');
    const result=await GpuLinearWater.createBackend(device,checkpoint.config,state,options,checkpoint.backend);result.currentTick=checkpoint.tick;return result;
  }
  async telemetry():Promise<WaterTelemetry> {
    this.assertAlive();if(this.telemetryPending)throw new Error('Water telemetry readback is already in flight.');
    this.telemetryPending=true;
    try {
      this.telemetryReader??=WaterTelemetryReader.create(this.device,this.config.cols*this.config.rows).then(reader=>{
        if(!this.alive){reader.destroy();this.assertAlive();}return reader;
      });
      const reader=await this.telemetryReader;this.assertAlive();return await reader.read(this.getFields());
    }finally{this.telemetryPending=false;}
  }
  destroy():void {
    if(this.destroyed)return;this.destroyed=true;
    this.readback?.destroy();this.readback=null;
    void this.telemetryReader?.then(reader=>reader.destroy(),()=>{});this.telemetryReader=null;
    for(const buffer of this.fields)buffer.destroy();this.params.destroy();
    this.fields.length=0;this.groups.length=0;this.pipelines.length=0;
  }
}
