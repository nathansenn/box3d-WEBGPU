import type {GpuWaterFields} from './linear-water.ts';
import {GpuStartupBudget} from './startup-budget.ts';

const shader=/* wgsl */ `
struct Params { count:u32, groups:u32, pad0:u32, pad1:u32 };
struct Stats { sums:vec4<f32>, bounds:vec4<f32> };
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var<storage,read> eta:array<f32>;
@group(0) @binding(2) var<storage,read> u:array<f32>;
@group(0) @binding(3) var<storage,read> v:array<f32>;
@group(0) @binding(4) var<storage,read_write> partials:array<Stats>;
@group(0) @binding(5) var<storage,read_write> result:Stats;
var<workgroup> scratch:array<Stats,64>;
fn emptyStats()->Stats {return Stats(vec4<f32>(0),vec4<f32>(3.402823e38,-3.402823e38,0,0));}
fn combine(a:Stats,b:Stats)->Stats {return Stats(vec4<f32>(a.sums.xyz+b.sums.xyz,max(a.sums.w,b.sums.w)),vec4<f32>(min(a.bounds.x,b.bounds.x),max(a.bounds.y,b.bounds.y),0,0));}
fn reduce(lane:u32) {
  workgroupBarrier();
  for(var stride=32u;stride>0u;stride/=2u){
    if(lane<stride){scratch[lane]=combine(scratch[lane],scratch[lane+stride]);}
    workgroupBarrier();
  }
}
@compute @workgroup_size(64)
fn cells(@builtin(global_invocation_id) global:vec3<u32>,@builtin(local_invocation_id) local:vec3<u32>,@builtin(workgroup_id) group:vec3<u32>) {
  let id=global.x;let lane=local.x;var stats=emptyStats();
  if(id<params.count){let h=eta[id];let speed2=u[id]*u[id]+v[id]*v[id];stats=Stats(vec4<f32>(h,h*h,speed2,speed2),vec4<f32>(h,h,0,0));}
  scratch[lane]=stats;reduce(lane);if(lane==0u){partials[group.x]=scratch[0];}
}
@compute @workgroup_size(64)
fn finish(@builtin(local_invocation_id) local:vec3<u32>) {
  let lane=local.x;var stats=emptyStats();
  for(var i=lane;i<params.groups;i+=64u){stats=combine(stats,partials[i]);}
  scratch[lane]=stats;reduce(lane);if(lane==0u){result=scratch[0];}
}
`;

interface Readback extends GPUBuffer {mapAsync(mode:number):Promise<void>;getMappedRange():ArrayBuffer;unmap():void}
interface CopyEncoder extends GPUCommandEncoder {copyBufferToBuffer(source:GPUBuffer,sourceOffset:number,dest:GPUBuffer,destOffset:number,size:number):void}
export interface WaterTelemetry {
  readonly backend:string;readonly tick:number;readonly time:number;readonly cells:number;
  readonly requestedAtMs:number;readonly completedAtMs:number;readonly readbackBytes:32;
  readonly volumePerturbation:number;readonly heightRms:number;readonly velocityRms:number;
  readonly maxSpeed:number;readonly minElevation:number;readonly maxElevation:number;
  /** Same normalized grid-average proxy as the reference model, not joules. */
  readonly energyProxy:number;
}

/** A one-slot asynchronous reduction/readback ring. No full-grid CPU transfer. */
export class WaterTelemetryReader {
  private readonly device:GPUDevice;
  private readonly count:number;
  private readonly buffers:GPUBuffer[];
  private readonly layout:GPUBindGroupLayout;
  private readonly pipelines:GPUComputePipeline[];
  private readonly groups=new Map<GPUBuffer,GPUBindGroup>();
  private readonly readback:Readback;
  private pending=false;
  private disposed=false;
  private constructor(device:GPUDevice,count:number,buffers:GPUBuffer[],layout:GPUBindGroupLayout,pipelines:GPUComputePipeline[]) {
    this.device=device;this.count=count;this.buffers=buffers;this.layout=layout;this.pipelines=pipelines;this.readback=buffers[3] as Readback;
  }
  static async create(device:GPUDevice,count:number):Promise<WaterTelemetryReader> {
    if(!Number.isSafeInteger(count)||count<1||count>1048576)throw new RangeError('Invalid water telemetry capacity.');
    const buffers:GPUBuffer[]=[],startup=new GpuStartupBudget({},'Water telemetry');
    try {
      const make=(label:string,size:number,usage:number)=>{const b=device.createBuffer({label,size,usage});buffers.push(b);return b;};
      const params=make('Water reduction parameters',16,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
      make('Water reduction partials',Math.ceil(count/64)*32,GPUBufferUsage.STORAGE);
      make('Water reduction result',32,GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC);
      make('Water telemetry readback',32,GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ);
      device.queue.writeBuffer(params,0,new Uint32Array([count,Math.ceil(count/64),0,0]).buffer);
      const layout=device.createBindGroupLayout({entries:['uniform','read-only-storage','read-only-storage','read-only-storage','storage','storage'].map((type,binding)=>({binding,visibility:GPUShaderStage.COMPUTE,buffer:{type:type as GPUBufferBindingType}}))});
      const module=device.createShaderModule({label:'Water telemetry reduction',code:shader}),info=await startup.wait('Validating telemetry shader',()=>module.getCompilationInfo?.());
      const errors=info?.messages.filter(message=>message.type==='error');if(errors?.length)throw new Error(errors.map(error=>error.message).join('\n'));
      const pipelineLayout=device.createPipelineLayout({bindGroupLayouts:[layout]});
      const pipelines=await startup.wait('Compiling telemetry pipelines',()=>Promise.all(['cells','finish'].map(entryPoint=>{
        const descriptor={layout:pipelineLayout,compute:{module,entryPoint}};
        return device.createComputePipelineAsync?.(descriptor)??device.createComputePipeline(descriptor);
      })));
      return new WaterTelemetryReader(device,count,buffers,layout,pipelines);
    }catch(error){for(const b of buffers)b.destroy();throw error;}
  }
  async read(fields:GpuWaterFields):Promise<WaterTelemetry> {
    if(this.disposed||!fields.owner.alive)throw new Error('Water telemetry source is disposed.');
    if(this.pending)throw new Error('Water telemetry readback is already in flight.');
    if(fields.device!==this.device||fields.cols*fields.rows!==this.count||fields.tick!==fields.owner.tick)throw new Error('Water telemetry source identity or generation mismatch.');
    this.pending=true;const requestedAtMs=performance.now();
    try {
      let group=this.groups.get(fields.eta);
      if(!group){group=this.device.createBindGroup({layout:this.layout,entries:[this.buffers[0]!,fields.eta,fields.u,fields.v,this.buffers[1]!,this.buffers[2]!].map((buffer,binding)=>({binding,resource:{buffer}}))});this.groups.set(fields.eta,group);}
      const encoder=this.device.createCommandEncoder() as CopyEncoder,pass=encoder.beginComputePass({label:'Water telemetry reduction'});
      pass.setBindGroup(0,group);pass.setPipeline(this.pipelines[0]!);pass.dispatchWorkgroups(Math.ceil(this.count/64));
      pass.setPipeline(this.pipelines[1]!);pass.dispatchWorkgroups(1);pass.end();
      encoder.copyBufferToBuffer(this.buffers[2]!,0,this.readback,0,32);this.device.queue.submit([encoder.finish()]);
      await this.readback.mapAsync(1);
      if(this.disposed||!fields.owner.alive)throw new Error('Water telemetry source was disposed during readback.');
      const values=new Float32Array(this.readback.getMappedRange());
      if(!values.every(Number.isFinite)||values[1]<0||values[2]<0||values[3]<0)throw new Error('Invalid GPU water reduction values.');
      const {dx,dz,gravity}=fields.owner.config;
      return Object.freeze({backend:fields.backend,tick:fields.tick,time:fields.time,cells:this.count,requestedAtMs,completedAtMs:performance.now(),readbackBytes:32,
        volumePerturbation:values[0]*dx*dz,heightRms:Math.sqrt(values[1]/this.count),velocityRms:Math.sqrt(values[2]/this.count),maxSpeed:Math.sqrt(values[3]),
        minElevation:values[4],maxElevation:values[5],energyProxy:(values[1]*gravity+values[2])/this.count});
    }finally{this.pending=false;if(!this.disposed)this.readback.unmap();}
  }
  destroy():void {if(this.disposed)return;this.disposed=true;for(const b of this.buffers)b.destroy();this.buffers.length=0;this.groups.clear();this.pipelines.length=0;}
}
