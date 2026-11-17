/**
 * Shallow water on the GPU: the scheme of shallow-water.ts (hydrostatic reconstruction, MUSCL with minmod, HLL, Heun,
 * split rain, Green-Ampt and Manning friction) as WebGPU compute passes in float32 (shallow-water-wgsl.ts).
 *
 * `GpuShallowWater.create(compute, water)` mirrors a `ShallowWater`: its grid, bed, sides, soil, friction and present
 * state. The float64 solver stays the reference; this backend is opt-in.
 *
 * A step is: choose the number of equal substeps from the largest face speed, then per substep three dispatches (half a
 * step of friction when there is friction; first stage; second stage with rain, infiltration and friction), all encoded
 * into one command buffer. The face speed comes from a measuring pass and a 32-byte readback before the step
 * (`rateLatency: 0`, the default: what the validation uses), or from the substeps of an earlier step
 * (`rateLatency: L >= 1`: no pass and no wait unless that readback is late; the speed is `L` steps old, so `safety`,
 * default 1.25 then, widens the margin, and `stats.courant` reports what the substeps really ran at).
 *
 * The state stays on the GPU: `stateBuffer` (h, hu, hv, carry per cell) and `fixedBuffer` (bed, n, K, psi*eta) can be
 * bound by a renderer. `read()` brings the state back; `pull(water)` writes it into a ShallowWater.
 * `checkpoint()` and `restoreCheckpoint()` save and put back the state as bytes (the format ShallowWaterF32 shares).
 * Not here: coupled rigid bodies and point sources (addVolume, removeVolume); use the float64 solver for those.
 */
import {EngineError} from '../contracts.ts';
import {ShallowWater} from '../shallow-water.ts';
import {GpuCompute,GpuProgram,type GpuDispatch} from './compute.ts';
import {planShallowWaterSubsteps,readShallowWaterCheckpoint,shallowWaterSetup,writeShallowWaterCheckpoint,type ShallowWaterF32Stats,type ShallowWaterSetup} from './shallow-water-f32.ts';
import {SHALLOW_WATER_WGSL,SW_COUNT_WET,SW_MANNING,SW_METER_FLAGS,SW_METER_MEASURE_X,SW_METER_MEASURE_Z,SW_METER_RATE_X,SW_METER_RATE_Z,SW_METER_SLOTS,SW_METER_WET,SW_PARAMS,SW_RAIN,SW_SKIP_Z,SW_SOIL,SW_SOLID} from './shallow-water-wgsl.ts';

export const SHALLOW_WATER_GPU_SOLVER_ID='shallow-water-hr-muscl-hll-webgpu-f32-v1';
/** Bytes between two parameter blocks (the smallest uniform offset alignment WebGPU guarantees). */
const BLOCK=256,MAX_BLOCKS=128;

export interface GpuShallowWaterOptions {
  /** 0 (default): measure the face speeds before every step and wait for them. L >= 1: use the speeds of the step L before. */
  readonly rateLatency?:number;
  /** Factor on the face speed when the substeps are chosen. Default 1 with rateLatency 0, else 1.25. */
  readonly safety?:number;
  /**
   * With rateLatency >= 1 only. true (default): a step waits for the face speeds of the step `rateLatency` before it, so a
   * run is repeatable. false: a step never waits; it uses the newest face speeds that have arrived, however old (a frame
   * loop that must not block: the substep counts then depend on timing, so two runs can differ; raise `safety`).
   */
  readonly rateWait?:boolean;
}
export interface GpuShallowWaterSnapshot {
  readonly time:number;readonly steps:number;
  /** (h, hu, hv, carry) and (infiltrated, scratch, side volume, its carry) per cell. */
  readonly state:Float32Array;readonly aux:Float32Array;
}
interface Meter {rateX:number;rateZ:number;wet:number;flags:number;measureX:number;measureZ:number}

export class GpuShallowWater {
  readonly solver=SHALLOW_WATER_GPU_SOLVER_ID;
  readonly nx:number;readonly nz:number;readonly dx:number;readonly dz:number;
  readonly stats:ShallowWaterF32Stats={substeps:0,totalSubsteps:0,courant:0,maxWaveSpeed:0,wetCells:0};
  /** Largest Courant number any step ran at, and steps that ran above 0.5 (where depths can go negative). */
  maxCourant=0;courantExceeded=0;
  rainVolume=0;
  initialVolume:number;
  dt:number;time:number;steps=0;
  readonly rateLatency:number;readonly safety:number;readonly rateWait:boolean;
  private readonly arrived:{meter:Meter;sub:number}[]=[];private readonly outstanding=new Set<Promise<void>>();
  private infiltratedAtStart:number;
  private lastSub=0;
  private readonly pending:Promise<Meter>[]=[];
  private latest:Meter;
  private readonly blocks=new ArrayBuffer(BLOCK*MAX_BLOCKS);
  private encodedSub=0;
  private destroyed=false;

  readonly compute:GpuCompute;readonly water:ShallowWater;readonly setup:ShallowWaterSetup;
  /** (h, hu, hv, carry) per cell, x fastest: the present state between steps. */
  readonly stateBuffer:GPUBuffer;
  /** (bed, Manning n, K or -1 for solid, psi * eta) per cell. */
  readonly fixedBuffer:GPUBuffer;
  private readonly stageBuffer:GPUBuffer;private readonly auxBuffer:GPUBuffer;private readonly meterBuffer:GPUBuffer;private readonly paramBuffer:GPUBuffer;
  private readonly pipelines:Record<'measure'|'lead'|'stage'|'finish',GPUComputePipeline>;private readonly forward:GPUBindGroup;private readonly backward:GPUBindGroup;

  private constructor(compute:GpuCompute,water:ShallowWater,setup:ShallowWaterSetup,options:GpuShallowWaterOptions,stateBuffer:GPUBuffer,stageBuffer:GPUBuffer,fixedBuffer:GPUBuffer,auxBuffer:GPUBuffer,meterBuffer:GPUBuffer,paramBuffer:GPUBuffer,
    pipelines:Record<'measure'|'lead'|'stage'|'finish',GPUComputePipeline>,forward:GPUBindGroup,backward:GPUBindGroup,first:Meter) {
    this.compute=compute;this.water=water;this.setup=setup;this.stateBuffer=stateBuffer;this.stageBuffer=stageBuffer;this.fixedBuffer=fixedBuffer;this.auxBuffer=auxBuffer;this.meterBuffer=meterBuffer;this.paramBuffer=paramBuffer;
    this.pipelines=pipelines;this.forward=forward;this.backward=backward;
    this.nx=setup.nx;this.nz=setup.nz;this.dx=setup.dx;this.dz=setup.dz;this.dt=water.dt;this.time=water.time;
    this.rateLatency=Math.max(0,Math.floor(options.rateLatency??0));this.safety=options.safety??(this.rateLatency>0?1.25:1);this.rateWait=options.rateWait??true;
    this.latest=first;
    let v=0,F=0;for(let c=0;c<setup.state.length;c+=4){v+=setup.state[c];F+=setup.aux[c];}
    this.initialVolume=v*this.dx*this.dz;this.infiltratedAtStart=F;
    let wet=0;for(let c=0;c<setup.state.length;c+=4)if(setup.state[c]>Math.fround(setup.dryDepth))wet++;
    this.stats.wetCells=wet;
  }

  static async create(compute:GpuCompute,water:ShallowWater,options:GpuShallowWaterOptions={}):Promise<GpuShallowWater> {
    const setup=shallowWaterSetup(water),n=setup.nx*setup.nz,L=compute.device.limits;
    if(16*n>L.maxStorageBufferBindingSize)throw new EngineError('GPU_UNAVAILABLE',`${n} cells need a storage buffer of ${16*n} bytes; this device binds at most ${L.maxStorageBufferBindingSize}.`);
    if(Math.ceil(Math.max(setup.nx,setup.nz)/8)>L.maxComputeWorkgroupsPerDimension)throw new EngineError('GPU_UNAVAILABLE','The grid needs more workgroups along one dimension than this device dispatches.');
    const module=await compute.module('shallow water',SHALLOW_WATER_WGSL);
    const layout=compute.layout('shallow water',['uniform-dynamic','read','write','read','write','write']);
    const pipelineLayout=compute.device.createPipelineLayout({label:'shallow water',bindGroupLayouts:[layout]});
    const names=['measure','lead','stage','finish'] as const;
    const built=await Promise.all(names.map(name=>compute.pipeline(`shallow water ${name}`,module,name,pipelineLayout)));
    const pipelines=Object.fromEntries(names.map((name,k)=>[name,built[k]])) as Record<typeof names[number],GPUComputePipeline>;
    const state=compute.storage('shallow water state',16*n,setup.state),stage=compute.storage('shallow water stage',16*n,setup.state);
    const fixed=compute.storage('shallow water bed',16*n,setup.fixed),aux=compute.storage('shallow water sums',16*n,setup.aux);
    const meter=compute.storage('shallow water meter',4*SW_METER_SLOTS,new Uint32Array(SW_METER_SLOTS));
    const params=compute.buffer('shallow water parameters',BLOCK*MAX_BLOCKS,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST);
    const window={buffer:params,size:SW_PARAMS.size};
    const [forward,backward]=await compute.scoped('shallow water bind groups',()=>[
      compute.bind('shallow water forward',layout,[window,state,stage,fixed,aux,meter]),
      compute.bind('shallow water backward',layout,[window,stage,state,fixed,aux,meter])]);
    const solver=new GpuShallowWater(compute,water,setup,options,state,stage,fixed,aux,meter,params,pipelines,forward,backward,{rateX:0,rateZ:0,wet:0,flags:0,measureX:0,measureZ:0});
    if(solver.rateLatency>0)solver.latest=await solver.measure();
    return solver;
  }

  get cells():number {return this.nx*this.nz;}
  private alive():void {if(this.destroyed)throw new EngineError('GPU_DEVICE_LOST','This GpuShallowWater has been destroyed.');this.compute.assertAlive();}
  private groups():[number,number] {return [Math.ceil(this.nx/8),Math.ceil(this.nz/8)];}
  private flags(last:boolean,rain:boolean):number {
    const s=this.setup;return (s.hasManning?SW_MANNING:0)|(s.hasSoil?SW_SOIL:0)|(s.skipZ?SW_SKIP_Z:0)|(s.hasSolid?SW_SOLID:0)|(last?SW_COUNT_WET:0)|(rain?SW_RAIN:0);
  }
  private writeBlock(index:number,sub:number,last:boolean):void {
    const s=this.setup,water=this.water,rain=sub>0?water.rainAt(this.encodedTime+.5*sub)*sub:0,rainDepth=Math.fround(rain);
    SW_PARAMS.write(new DataView(this.blocks,index*BLOCK,BLOCK),{nx:s.nx,nz:s.nz,order:s.order,flags:this.flags(last,rainDepth>0),dx:s.dx,dz:s.dz,dt:sub,g:s.gravity,dry:s.dryDepth,
      rain:rainDepth,rainU:rain*water.rainVelocity[0],rainV:rain*water.rainVelocity[1],leadDt:.5*(this.encodedSub>0?this.encodedSub:sub),trailDt:.5*sub,viscosity:s.viscosity,ox:s.origin[0],oz:s.origin[1],sides:s.sides});
    if(rainDepth>0)this.rainVolume+=rainDepth*s.wetArea;
  }
  private encodedTime=0;private led=false;
  private decode(bytes:ArrayBuffer):Meter {
    const u=new Uint32Array(bytes),v=new Float32Array(bytes);
    return {rateX:v[SW_METER_RATE_X],rateZ:v[SW_METER_RATE_Z],wet:u[SW_METER_WET],flags:u[SW_METER_FLAGS],measureX:v[SW_METER_MEASURE_X],measureZ:v[SW_METER_MEASURE_Z]};
  }
  /** Run the measuring pass on the present state and wait for the face speeds. */
  private async measure():Promise<Meter> {
    this.alive();
    const device=this.compute.device,[gx,gz]=this.groups();
    this.encodedTime=this.time;this.writeBlock(0,0,false);
    device.queue.writeBuffer(this.paramBuffer,0,this.blocks,0,BLOCK);
    const encoder=device.createCommandEncoder({label:'shallow water measure'});
    // Only the measuring slots are cleared: the substep slots still hold the last step's values.
    encoder.clearBuffer(this.meterBuffer,4*SW_METER_MEASURE_X,8);
    const program=new GpuProgram();
    // The leading half of the friction comes before the measurement, as in the float64 solver; the first substep then skips it.
    if(this.setup.hasManning&&this.encodedSub>0&&!this.led){program.add({pipeline:this.pipelines.lead,bindGroups:[this.backward],workgroups:[gx,gz],offsets:[0]});this.led=true;}
    program.add({pipeline:this.pipelines.measure,bindGroups:[this.forward],workgroups:[gx,gz],offsets:[0]}).encode(encoder,'shallow water measure');
    device.queue.submit([encoder.finish()]);
    const [bytes]=await this.compute.read([{buffer:this.meterBuffer}]);
    return this.decode(bytes);
  }
  /** Book the substep meter of a finished step into the statistics. */
  private book(meter:Meter,sub:number):void {
    const rate=meter.rateX/this.dx+(this.nz>1?meter.rateZ/this.dz:0),courant=sub*rate;
    this.stats.courant=courant;this.stats.maxWaveSpeed=Math.max(meter.rateX,meter.rateZ);this.stats.wetCells=meter.wet;
    if(courant>this.maxCourant)this.maxCourant=courant;
    if(courant>.5)this.courantExceeded++;
    if(meter.flags&1)throw new EngineError('UNSTABLE_TIME_STEP',`GpuShallowWater: a depth is not a number at t = ${this.time} s (the last step ran at Courant number ${courant.toPrecision(3)}).`);
  }
  private lastPlanSub=0;private unbooked=false;

  async step(count=1):Promise<void> {for(let s=0;s<count;s++)await this.advance(this.dt);}
  /** Advance by `duration` s. Resolves when the step is encoded and submitted (and, with rateLatency 0, measured). */
  async advance(duration:number):Promise<void> {
    this.alive();
    if(!(duration>0)||!Number.isFinite(duration))throw new EngineError('INVALID_PAYLOAD','duration must be a positive number of seconds.');
    let rateX:number,rateZ:number;
    if(this.rateLatency===0){
      const meter=await this.measure();
      if(this.unbooked){this.book(meter,this.lastPlanSub);this.unbooked=false;}
      rateX=meter.measureX;rateZ=meter.measureZ;
    }else if(!this.rateWait){
      // Whatever has arrived, newest last; nothing is waited for.
      while(this.arrived.length){const {meter,sub}=this.arrived.shift()!;this.latest={...meter,measureX:Math.max(meter.rateX,0),measureZ:Math.max(meter.rateZ,0)};this.book(meter,sub);}
      rateX=this.latest.measureX;rateZ=this.latest.measureZ;
    }else{
      // The meter of the step `rateLatency` before this one (the first steps use the measurement made at creation).
      while(this.pending.length>=this.rateLatency){const meter=await this.pending.shift()!;this.latest={...meter,measureX:Math.max(meter.rateX,0),measureZ:Math.max(meter.rateZ,0)};this.book(meter,this.bookSubs.shift()!);}
      rateX=this.latest.measureX;rateZ=this.latest.measureZ;
    }
    const s=this.setup,plan=planShallowWaterSubsteps(duration,rateX,rateZ,{dx:s.dx,dz:s.dz,nz:s.nz,cfl:s.cfl,maxSubsteps:s.maxSubsteps},this.safety);
    const device=this.compute.device,[gx,gz]=this.groups();
    this.encodedTime=this.time;
    for(let done=0;done<plan.substeps;){
      const chunk=Math.min(MAX_BLOCKS,plan.substeps-done),program=new GpuProgram();
      for(let b=0;b<chunk;b++){
        this.writeBlock(b,plan.sub,done+b===plan.substeps-1);
        const offsets=[b*BLOCK],base:Omit<GpuDispatch,'pipeline'|'bindGroups'>={workgroups:[gx,gz],offsets};
        if(s.hasManning&&!this.led)program.add({...base,pipeline:this.pipelines.lead,bindGroups:[this.backward]});
        this.led=false;
        program.add({...base,pipeline:this.pipelines.stage,bindGroups:[this.forward]});
        program.add({...base,pipeline:this.pipelines.finish,bindGroups:[this.backward]});
        this.encodedSub=plan.sub;this.encodedTime+=plan.sub;
      }
      device.queue.writeBuffer(this.paramBuffer,0,this.blocks,0,chunk*BLOCK);
      const encoder=device.createCommandEncoder({label:'shallow water step'});
      if(done===0)encoder.clearBuffer(this.meterBuffer,0,4*SW_METER_SLOTS);
      program.encode(encoder,'shallow water substeps');
      device.queue.submit([encoder.finish()]);
      done+=chunk;
    }
    this.time+=duration;this.steps++;this.lastSub=plan.sub;
    this.stats.substeps=plan.substeps;this.stats.totalSubsteps+=plan.substeps;
    if(this.rateLatency===0){this.lastPlanSub=plan.sub;this.unbooked=true;}
    else if(!this.rateWait){
      // At most four readbacks on their way: a GPU that is behind is not asked for more.
      if(this.outstanding.size<4){
        const sub=plan.sub,read:Promise<void>=this.compute.read([{buffer:this.meterBuffer}]).then(([bytes])=>{this.arrived.push({meter:this.decode(bytes),sub});},()=>{}).finally(()=>{this.outstanding.delete(read);});
        this.outstanding.add(read);
      }
    }else{this.pending.push(this.compute.read([{buffer:this.meterBuffer}]).then(([bytes])=>this.decode(bytes)));this.bookSubs.push(plan.sub);for(const p of this.pending)p.catch(()=>{});}
  }
  private readonly bookSubs:number[]=[];
  /** Wait for everything submitted and bring `stats` (Courant number, wave speed, wet cells) up to the last step. */
  async sync():Promise<void> {
    this.alive();
    if(this.rateLatency===0){
      if(!this.unbooked)return;
      const [bytes]=await this.compute.read([{buffer:this.meterBuffer}]);this.book(this.decode(bytes),this.lastPlanSub);this.unbooked=false;
    }else if(!this.rateWait){
      await Promise.all([...this.outstanding]);
      while(this.arrived.length){const {meter,sub}=this.arrived.shift()!;this.latest={...meter,measureX:Math.max(meter.rateX,0),measureZ:Math.max(meter.rateZ,0)};this.book(meter,sub);}
    }else if(this.pending.length){
      const all=await Promise.all(this.pending);
      for(let k=0;k<all.length;k++)this.book(all[k],this.bookSubs[k]);
    }
  }
  private checkpointable():void {
    if(this.rateLatency!==0)throw new EngineError('INVALID_PAYLOAD','A GpuShallowWater with rateLatency above 0 has face speeds on their way: checkpoints need rateLatency 0.');
  }
  /**
   * An exact checkpoint of the state (the format ShallowWaterF32 writes and reads too): waits for the steps submitted.
   * Needs rateLatency 0.
   */
  async checkpoint():Promise<Uint8Array> {
    this.checkpointable();await this.sync();
    const [state,aux]=await this.compute.read([{buffer:this.stateBuffer},{buffer:this.auxBuffer}]);
    return writeShallowWaterCheckpoint(this.nx,this.nz,{state:new Float32Array(state),aux:new Float32Array(aux),time:this.time,steps:this.steps,lastSub:this.encodedSub,rainVolume:this.rainVolume,stats:this.stats,
      initialVolume:this.initialVolume,infiltratedAtStart:this.infiltratedAtStart,maxCourant:this.maxCourant,courantExceeded:this.courantExceeded});
  }
  /** Put back a checkpoint (from GpuShallowWater or ShallowWaterF32); later steps give the bits the run it was taken from gives. */
  restoreCheckpoint(bytes:Uint8Array):void {
    this.alive();this.checkpointable();
    const s=readShallowWaterCheckpoint(this.nx,this.nz,bytes);
    this.compute.write(this.stateBuffer,s.state);this.compute.write(this.auxBuffer,s.aux);
    this.time=s.time;this.steps=s.steps;this.encodedSub=s.lastSub;this.lastSub=s.lastSub;this.led=false;this.unbooked=false;this.rainVolume=s.rainVolume;Object.assign(this.stats,s.stats);
    this.initialVolume=s.initialVolume;this.infiltratedAtStart=s.infiltratedAtStart;this.maxCourant=s.maxCourant;this.courantExceeded=s.courantExceeded;
  }
  /** The state now (everything submitted has run when this resolves). */
  async read():Promise<GpuShallowWaterSnapshot> {
    this.alive();
    const time=this.time,steps=this.steps,[state,aux]=await this.compute.read([{buffer:this.stateBuffer},{buffer:this.auxBuffer}]);
    return {time,steps,state:new Float32Array(state),aux:new Float32Array(aux)};
  }
  /** Volume (m^3) and the budget of a snapshot, summed in float64: volume - initial - (inflow + rain - infiltrated + clipped). */
  budget(snapshot:GpuShallowWaterSnapshot):{volume:number;inflow:number;rain:number;infiltrated:number;clipped:number;error:number} {
    let v=0,a=0,b=0;const U=snapshot.state,A=snapshot.aux,area=this.dx*this.dz;
    for(let k=0;k<U.length;k+=4){v+=U[k]+U[k+3];a+=A[k+2]+A[k+3];b+=A[k];}
    // Nothing is clipped: a depth that would go below zero leaves its shortfall in the carry.
    const volume=v*area,inflow=a,infiltrated=(b-this.infiltratedAtStart)*area,clipped=0;
    return {volume,inflow,rain:this.rainVolume,infiltrated,clipped,error:volume-this.initialVolume-(inflow+this.rainVolume-infiltrated+clipped)};
  }
  /**
   * Write a snapshot (or the present state) into a ShallowWater with the same grid: depth with its carry, discharges,
   * infiltrated depth, time and the volume ledger. That solver can then carry on in float64.
   */
  async pull(target:ShallowWater=this.water,snapshot?:GpuShallowWaterSnapshot):Promise<GpuShallowWaterSnapshot> {
    const snap=snapshot??await this.read(),U=snap.state,A=snap.aux,n=this.cells;
    if(target.nx!==this.nx||target.nz!==this.nz)throw new EngineError('INVALID_PAYLOAD','pull needs a ShallowWater with the same grid.');
    for(let c=0;c<n;c++){target.h[c]=Math.max(0,U[4*c]+U[4*c+3]);target.qx[c]=U[4*c+1];target.qz[c]=U[4*c+2];target.infiltrated[c]=A[4*c];}
    const B=this.budget(snap),L=target.ledger;
    // The float64 copy's budget error equals this backend's: the rounding of the copy goes to `clipped`.
    L.inflow=B.inflow;L.rain=B.rain;L.infiltrated=B.infiltrated;L.sources=0;L.displaced=0;L.clipped=B.clipped+(target.volume()-B.volume)-(target.initialVolume-this.initialVolume);
    target.time=snap.time;target.steps=snap.steps;
    let wet=0;for(let c=0;c<n;c++)if(target.h[c]>target.dryDepth)wet++;
    target.stats.wetCells=wet;target.stats.totalSubsteps=this.stats.totalSubsteps;
    return snap;
  }
  destroy():void {
    if(this.destroyed)return;this.destroyed=true;
    for(const buffer of [this.stateBuffer,this.stageBuffer,this.fixedBuffer,this.auxBuffer,this.meterBuffer,this.paramBuffer])this.compute.release(buffer);
  }
}

export interface ShallowWaterRunnerOptions extends GpuShallowWaterOptions {
  /** Steps between the readbacks kept for a fall back to the CPU. Default 30; 0: none (a device loss then restarts from the start state). */
  readonly snapshotEvery?:number;
}
/**
 * A shallow-water run that starts on the GPU and carries on with the float64 solver when the device is lost.
 *
 * `water` is the ShallowWater the run was built from. While the GPU runs it only receives the snapshots (every
 * `snapshotEvery` steps). When the device is lost, or was never there, `water` is advanced on the CPU from the last
 * snapshot to the time the run had reached and takes over: `backend` becomes 'cpu' and `fallback` says why, when, and
 * how much simulated time was run again.
 */
export class ShallowWaterRunner {
  backend:'gpu'|'cpu';
  fallback:{reason:string;atTime:number;resumedFrom:number;stepsRerun:number}|null=null;
  private sinceSnapshot=0;private snapshotSteps=0;
  readonly water:ShallowWater;gpu:GpuShallowWater|null;private readonly every:number;
  private constructor(water:ShallowWater,gpu:GpuShallowWater|null,every:number,reason:string|null) {
    this.water=water;this.gpu=gpu;this.every=every;
    this.backend=gpu?'gpu':'cpu';this.snapshotSteps=water.steps;
    if(!gpu)this.fallback={reason:reason??'WebGPU compute is not available.',atTime:water.time,resumedFrom:water.time,stepsRerun:0};
  }
  /** `compute` null (or a GPU that refuses the grid) starts on the CPU at once. */
  static async create(water:ShallowWater,compute:GpuCompute|null,options:ShallowWaterRunnerOptions={}):Promise<ShallowWaterRunner> {
    let gpu:GpuShallowWater|null=null,reason:string|null=null;
    if(compute){try{gpu=await GpuShallowWater.create(compute,water,options);}catch(error){if(!(error instanceof EngineError)||!error.code.startsWith('GPU_'))throw error;reason=error.message;}}
    return new ShallowWaterRunner(water,gpu,options.snapshotEvery??30,reason);
  }
  get time():number {return this.gpu?this.gpu.time:this.water.time;}
  get steps():number {return this.gpu?this.gpu.steps:this.water.steps;}
  async step(count=1):Promise<void> {
    for(let s=0;s<count;s++){
      if(!this.gpu){this.water.step();continue;}
      const goal=this.gpu.steps+1;
      try{
        await this.gpu.advance(this.water.dt);
        if(this.every>0&&++this.sinceSnapshot>=this.every)await this.snapshot();
      }catch(error){
        if(!(error instanceof EngineError)||error.code!=='GPU_DEVICE_LOST')throw error;
        if(this.gpu)this.fallBack(error.message);
      }
      // A step the device was lost in is taken on the CPU.
      if(!this.gpu)while(this.water.steps<goal)this.water.step();
    }
  }
  /** Bring the GPU state into `water` now (also the state a fall back resumes from). */
  async snapshot():Promise<void> {
    if(!this.gpu)return;
    try{await this.gpu.pull(this.water);this.snapshotSteps=this.gpu.steps;this.sinceSnapshot=0;}
    catch(error){if(!(error instanceof EngineError)||error.code!=='GPU_DEVICE_LOST')throw error;this.fallBack(error.message);}
  }
  private fallBack(reason:string):void {
    const gpu=this.gpu!,target=gpu.steps,from=this.water.time,rerun=target-this.snapshotSteps;
    this.gpu=null;this.backend='cpu';gpu.destroy();
    // The CPU solver holds the last snapshot: run it to where the GPU run had got to.
    for(let k=0;k<rerun;k++)this.water.step();
    this.fallback={reason,atTime:this.water.time,resumedFrom:from,stepsRerun:rerun};
  }
  destroy():void {this.gpu?.destroy();this.gpu=null;}
}
