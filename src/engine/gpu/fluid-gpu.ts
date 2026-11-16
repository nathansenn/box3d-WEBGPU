/**
 * Incompressible flow on the GPU: the program of fluid-program.ts (the float64 solver's projection method without
 * obstacles, with Jacobi-preconditioned conjugate gradients for the pressure and the implicit viscosity) run as WebGPU
 * compute dispatches in float32 (fluid-kernels.ts). The float64 solver (fluid.ts) stays the reference; this backend is
 * opt-in.
 *
 * Everything lives in three storage buffers (`F` data, `I` indices, `S` scalars) and one buffer of parameter blocks
 * read with dynamic offsets. A step submits its dispatches in order; the host reads the 64 scalars (256 bytes) every
 * 16 conjugate-gradient iterations to see whether a solve has stopped. `dataBuffer` with `regions` lets a renderer draw
 * the velocity or the pressure without reading them back.
 * Not on the GPU: obstacles and coupled bodies, the energy ledger, checkpoints, the free surface.
 */
import {EngineError} from '../contracts.ts';
import type {Fluid} from '../fluid.ts';
import {GpuCompute,GpuProgram} from './compute.ts';
import {FLUID_PASS,FLUID_WGSL,KERNELS,type KernelName} from './fluid-kernels.ts';
import {BLOCK_STRIDE,FLUID_SCALARS,FluidProgram,fluidProgramSource,fluidStepStats,MAX_BLOCKS,type FluidBackendOptions,type FluidCommand,type FluidProgramSource} from './fluid-program.ts';

export const FLUID_GPU_SOLVER_ID='fluid-mac-projection-jacobi-pcg-webgpu-f32-v1';
/** Bytes of the three buffers a fluid of this description needs (the largest must fit one storage binding). */
export function fluidMemory(source:Fluid|FluidProgramSource):{data:number;indices:number} {
  const p=new FluidProgram(source).plan;return {data:4*p.floats,indices:4*p.words};
}

export class GpuFluid {
  readonly solver=FLUID_GPU_SOLVER_ID;
  readonly compute:GpuCompute;readonly program:FluidProgram;
  /** The float data: the velocity components at `regions.vel + c * padded`, the pressure at `regions.p` (floats). */
  readonly dataBuffer:GPUBuffer;
  readonly stats={steps:0,pressureIterations:0,viscousIterations:0,divergence:0,unconverged:0};
  time:number;readonly dt:number;
  private readonly indexBuffer:GPUBuffer;private readonly scalarBuffer:GPUBuffer;private readonly blockBuffer:GPUBuffer;
  private readonly pipelines:Map<KernelName,GPUComputePipeline>;private readonly group:GPUBindGroup;
  private written=0;private destroyed=false;private lastScalars:Float32Array|null=null;

  private constructor(compute:GpuCompute,program:FluidProgram,time:number,dt:number,buffers:{data:GPUBuffer;index:GPUBuffer;scalar:GPUBuffer;block:GPUBuffer},pipelines:Map<KernelName,GPUComputePipeline>,group:GPUBindGroup) {
    this.compute=compute;this.program=program;this.time=time;this.dt=dt;this.dataBuffer=buffers.data;this.indexBuffer=buffers.index;this.scalarBuffer=buffers.scalar;this.blockBuffer=buffers.block;this.pipelines=pipelines;this.group=group;
  }
  /** From a Fluid (or its plain description) and its present velocity and pressure. */
  static async create(compute:GpuCompute,fluid:Fluid|FluidProgramSource,state:{velocity:readonly ArrayLike<number>[];pressure:ArrayLike<number>;time:number}|null=null,options:FluidBackendOptions={}):Promise<GpuFluid> {
    const source='description' in fluid?fluid:fluidProgramSource(fluid),program=new FluidProgram(source,options),plan=program.plan,L=compute.device.limits;
    const given=state??('description' in fluid?null:{velocity:fluid.vel,pressure:fluid.p,time:fluid.time});
    if(!given)throw new EngineError('INVALID_ARGUMENT','A GpuFluid built from a description needs a starting state.');
    if(4*plan.floats>L.maxStorageBufferBindingSize)throw new EngineError('GPU_UNAVAILABLE',`This fluid needs a storage buffer of ${4*plan.floats} bytes; this device binds at most ${L.maxStorageBufferBindingSize}.`);
    const module=await compute.module('fluid',FLUID_WGSL);
    const layout=compute.layout('fluid',['uniform-dynamic','write','read','write']);
    const pipelineLayout=compute.device.createPipelineLayout({label:'fluid',bindGroupLayouts:[layout]});
    const built=await Promise.all(KERNELS.map(k=>compute.pipeline(`fluid ${k}`,module,k,pipelineLayout)));
    const pipelines=new Map(KERNELS.map((k,i)=>[k,built[i]]));
    const F=Float32Array.from(plan.initialF);program.load(F,given.velocity,given.pressure);
    const data=compute.storage('fluid data',4*plan.floats,F),index=compute.storage('fluid indices',4*plan.words,plan.initialI);
    const scalar=compute.storage('fluid scalars',4*FLUID_SCALARS),block=compute.buffer('fluid parameters',BLOCK_STRIDE*MAX_BLOCKS,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    const group=await compute.scoped('fluid bind group',()=>compute.bind('fluid',layout,[{buffer:block,size:FLUID_PASS.size},data,index,scalar]));
    return new GpuFluid(compute,program,given.time,source.dt,{data,index,scalar,block},pipelines,group);
  }
  get regions():Readonly<Record<string,number>> {return this.program.plan.F;}
  get padded():number {return this.program.plan.P;}
  private alive():void {if(this.destroyed)throw new EngineError('GPU_DEVICE_LOST','This GpuFluid has been destroyed.');this.compute.assertAlive();}

  /** Run a program: dispatches are encoded in order and submitted at every point where the scalars are needed. */
  private async run(program:Generator<FluidCommand,void,Float32Array>):Promise<void> {
    const device=this.compute.device,queue:FluidCommand[]=[];
    const flush=():void=>{
      if(queue.length===0)return;
      const plan=this.program.plan;
      if(plan.blockCount>this.written){device.queue.writeBuffer(this.blockBuffer,this.written*BLOCK_STRIDE,plan.blocks,this.written*BLOCK_STRIDE,(plan.blockCount-this.written)*BLOCK_STRIDE);this.written=plan.blockCount;}
      const encoder=device.createCommandEncoder({label:'fluid'});
      let pass=new GpuProgram();
      const close=():void=>{pass.encode(encoder,'fluid');pass=new GpuProgram();};
      for(const cmd of queue){
        if(cmd.type==='clear'){close();encoder.clearBuffer(this.dataBuffer,4*cmd.offset,4*cmd.length);}
        else if(cmd.type==='op'){const op=cmd.op;pass.add({pipeline:this.pipelines.get(op.kernel)!,bindGroups:[this.group],workgroups:[op.groups[0],op.groups[1]],offsets:[op.block*BLOCK_STRIDE]});}
      }
      close();device.queue.submit([encoder.finish()]);queue.length=0;
    };
    let next=program.next();
    while(!next.done){
      const cmd=next.value;
      if(cmd.type==='sync'){flush();const [bytes]=await this.compute.read([{buffer:this.scalarBuffer}]);this.lastScalars=new Float32Array(bytes);next=program.next(this.lastScalars);}
      else{queue.push(cmd);next=program.next(this.lastScalars??new Float32Array(FLUID_SCALARS));}
    }
    flush();
  }
  /** Take `count` steps; resolves when they are submitted (each waits on its own solves). */
  async step(count=1):Promise<void> {
    this.alive();
    for(let s=0;s<count;s++){
      await this.run(this.program.step());
      // The statistics of the step: the scalars as the last solve left them (read once more after the projection).
      const [bytes]=await this.compute.read([{buffer:this.scalarBuffer}]);const st=fluidStepStats(new Float32Array(bytes));
      this.stats.steps++;this.stats.pressureIterations=st.pressureIterations;this.stats.viscousIterations=st.viscousIterations;this.stats.divergence=st.divergence;if(st.unconverged)this.stats.unconverged++;
      this.time+=this.dt;
    }
  }
  /** Make the velocity divergence-free without changing the pressure. */
  async project():Promise<void> {this.alive();await this.run(this.program.projectOnly());}
  /** Replace the velocity (padded, with ghosts) and the pressure; the next step advects by forward Euler. */
  load(velocity:readonly ArrayLike<number>[],pressure:ArrayLike<number>):void {
    this.alive();
    const p=this.program.plan,F=new Float32Array(3*p.P);
    for(let c=0;c<3;c++)F.set(velocity[c],c*p.P);
    this.compute.write(this.dataBuffer,F,4*p.F.vel);this.compute.write(this.dataBuffer,Float32Array.from(pressure),4*p.F.p);
    this.program.hasPrev=false;
  }
  /** The velocity components (padded, as Fluid stores them) and the pressure. */
  async read():Promise<{u:Float32Array;v:Float32Array;w:Float32Array;p:Float32Array}> {
    this.alive();
    const p=this.program.plan,[vel,pr]=await this.compute.read([{buffer:this.dataBuffer,offset:4*p.F.vel,size:12*p.P},{buffer:this.dataBuffer,offset:4*p.F.p,size:4*p.N}]);
    const V=new Float32Array(vel);
    return {u:V.slice(0,p.P),v:V.slice(p.P,2*p.P),w:V.slice(2*p.P,3*p.P),p:new Float32Array(pr)};
  }
  /** Write the state into a Fluid with the same grid (velocity and pressure; its time). */
  async pull(target:Fluid):Promise<void> {
    const s=await this.read();target.u.set(s.u);target.v.set(s.v);target.w.set(s.w);target.p.set(s.p);target.time=this.time;
  }
  destroy():void {
    if(this.destroyed)return;this.destroyed=true;
    for(const b of [this.dataBuffer,this.indexBuffer,this.scalarBuffer,this.blockBuffer])this.compute.release(b);
  }
}

/**
 * A fluid run that starts on the GPU and carries on with the float64 solver when the device is lost (or was never
 * there): `fluid` receives a snapshot every `snapshotEvery` steps; on a loss it is stepped from the last snapshot to
 * where the GPU run had got to (its Adams-Bashforth history restarts, as after any restore).
 */
export class FluidRunner {
  backend:'gpu'|'cpu';
  fallback:{reason:string;atTime:number;resumedFrom:number;stepsRerun:number}|null=null;
  readonly fluid:Fluid;gpu:GpuFluid|null;
  private readonly every:number;private sinceSnapshot=0;private snapshotSteps=0;private stepsTaken=0;
  private constructor(fluid:Fluid,gpu:GpuFluid|null,every:number,reason:string|null) {
    this.fluid=fluid;this.gpu=gpu;this.every=every;this.backend=gpu?'gpu':'cpu';
    if(!gpu)this.fallback={reason:reason??'WebGPU compute is not available.',atTime:fluid.time,resumedFrom:fluid.time,stepsRerun:0};
  }
  static async create(fluid:Fluid,compute:GpuCompute|null,options:FluidBackendOptions&{readonly snapshotEvery?:number}={}):Promise<FluidRunner> {
    let gpu:GpuFluid|null=null,reason:string|null=null;
    if(compute){try{gpu=await GpuFluid.create(compute,fluid,null,options);}catch(error){if(!(error instanceof EngineError)||!error.code.startsWith('GPU_'))throw error;reason=error.message;}}
    return new FluidRunner(fluid,gpu,options.snapshotEvery??50,reason);
  }
  get steps():number {return this.stepsTaken;}
  get time():number {return this.gpu?this.gpu.time:this.fluid.time;}
  async step(count=1):Promise<void> {
    let left=count;
    while(left>0&&this.gpu){
      const chunk=this.every>0?Math.min(left,this.every-this.sinceSnapshot):left;
      try{await this.gpu.step(chunk);}
      catch(error){if(!(error instanceof EngineError)||error.code!=='GPU_DEVICE_LOST')throw error;this.fallBack(error.message);break;}
      left-=chunk;this.stepsTaken+=chunk;this.sinceSnapshot+=chunk;
      if(this.every>0&&this.sinceSnapshot>=this.every){
        try{await this.gpu.pull(this.fluid);this.fluid.setState(this.fluid.getState());this.snapshotSteps=this.stepsTaken;this.sinceSnapshot=0;}
        catch(error){if(!(error instanceof EngineError)||error.code!=='GPU_DEVICE_LOST')throw error;this.fallBack(error.message);}
      }
    }
    if(left>0){this.fluid.step(left);this.stepsTaken+=left;}
  }
  private fallBack(reason:string):void {
    const gpu=this.gpu!,from=this.fluid.time,rerun=this.stepsTaken-this.snapshotSteps;
    this.gpu=null;this.backend='cpu';gpu.destroy();
    this.fluid.step(rerun);
    this.fallback={reason,atTime:this.fluid.time,resumedFrom:from,stepsRerun:rerun};
  }
  destroy():void {this.gpu?.destroy();this.gpu=null;}
}
