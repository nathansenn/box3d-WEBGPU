/**
 * Discrete-element grains on the GPU: the contact laws of granular.ts (linear and Hertz normal force with the same
 * damping coefficient, tangential spring with history under Coulomb's cap, rolling resistance, walls, velocity Verlet)
 * as WebGPU compute passes in float32 (granular-wgsl.ts). The float64 solver stays the reference; this backend is opt-in.
 *
 * Capacities, fixed when the backend is built (granular-f32.ts, `DemOptions`):
 *  - contact history: K slots per grain (default 10), keyed by the neighbour. A contact that finds no free slot is
 *    evaluated without history that step and counted (`stats.historyOverflow`); the run goes on.
 *  - hash grid: 2 x capacity buckets (rounded up to a power of two) of M grains (default 12, more for wide size
 *    ranges). A grain that finds its bucket full is invisible to its neighbours that step: `sync()` throws
 *    GPU_CAPACITY when that has happened, because the forces were then wrong.
 *  - at most 16 walls.
 * Memory: capacity x (80 + 32 K) bytes (64 K with rolling friction) + 8 (1 + M) x buckets.
 *
 * The state stays on the GPU. `positionBuffer` (x, y, z, radius per grain; a removed grain has its radius negated) can be
 * bound by a renderer. `readWalls()` brings back the walls' forces and impulses (a few hundred bytes per wall): that is
 * all a coupling to rigid bodies needs each step. `read()` brings back the grains.
 * `checkpoint()` and `restoreCheckpoint()` save and put back the state as bytes (the format GranularF32 shares).
 * Not here: the energy ledger (dissipated work).
 */
import {EngineError} from '../contracts.ts';
import {Granular,GranularCoupling} from '../granular.ts';
import {GpuCompute,GpuProgram} from './compute.ts';
import {demParams,demSetup,packDemGrains,packDemWalls,readDemWall,readGranularCheckpoint,writeGranularCheckpoint,type DemOptions,type DemSetup,type DemStats} from './granular-f32.ts';
import {DEM_BLOCK,DEM_EMPTY,DEM_METER_BUCKET_OVERFLOW,DEM_METER_CONTACTS,DEM_METER_FLAGS,DEM_METER_HISTORY_OVERFLOW,DEM_METER_OVERLAP,DEM_METER_REMOVED,DEM_METER_SLOTS,DEM_PARAMS,DEM_WALL,demShaders} from './granular-wgsl.ts';

/** The solver id of the grains on WebGPU compute (float32). */
export const GRANULAR_GPU_SOLVER_ID='granular-dem-hash-grid-webgpu-f32-v1';
const BLOCK=256;

/** Bytes of each storage buffer a set of `capacity` grains needs, and the largest (what the device must be able to bind). */
export function demMemory(capacity:number,options:{readonly historySlots?:number;readonly bucketSlots?:number;readonly tableSize?:number;readonly rolling?:boolean;readonly walls?:number}={}):{grains:number;forces:number;history:number;grid:number;sums:number;total:number;largest:number} {
  let T=options.tableSize??64;if(options.tableSize===undefined)while(T<2*capacity)T*=2;
  const K=options.historySlots??10,M=options.bucketSlots??12,grains=16*capacity,forces=32*capacity,history=16*(options.rolling?2:1)*K*capacity,grid=4*T*(1+M),sums=16*(2*(options.walls??0)+1)*Math.ceil(capacity/DEM_BLOCK);
  return {grains,forces,history,grid,sums,total:3*grains+forces+2*history+grid+sums,largest:Math.max(grains,forces,history,grid,sums)};
}

export interface GpuGranularSnapshot {readonly time:number;readonly steps:number;readonly count:number;
  /** (x, y, z, radius or -radius when removed), (v, mass), (omega, 1 / I) per grain; the walls (DEM_WALL elements). */
  readonly pos:Float32Array;readonly vel:Float32Array;readonly spin:Float32Array;readonly walls:Float32Array;readonly meter:Uint32Array}

/** Discrete-element grains on WebGPU compute, in float32: hash-grid neighbours, contact histories, walls of every shape. */
export class GpuGranular {
  readonly solver=GRANULAR_GPU_SOLVER_ID;
  readonly compute:GpuCompute;readonly setup:DemSetup;
  /** (x, y, z, radius) per grain; a removed grain has its radius negated. */
  readonly positionBuffer:GPUBuffer;
  readonly stats:DemStats={steps:0,contacts:0,wallContacts:0,overlap:0,maxOverlap:0,removed:0,bucketOverflow:0,historyOverflow:0};
  time=0;
  private readonly vel:GPUBuffer;private readonly spin:GPUBuffer;private readonly ft:GPUBuffer;private readonly history:[GPUBuffer,GPUBuffer];private readonly grid:GPUBuffer;
  private readonly walls:GPUBuffer;private readonly sums:GPUBuffer;private readonly meter:GPUBuffer;private readonly params:GPUBuffer;
  private readonly pipelines:Record<'wallOpen'|'integrate'|'sort'|'pairs'|'wallContacts'|'wallClose',GPUComputePipeline>;
  private readonly groups:{integrate:GPUBindGroup;sort:GPUBindGroup;pairs:[GPUBindGroup,GPUBindGroup];walls:[GPUBindGroup,GPUBindGroup];wallStep:GPUBindGroup};
  private parity=0;private destroyed=false;

  private constructor(compute:GpuCompute,setup:DemSetup,buffers:{pos:GPUBuffer;vel:GPUBuffer;spin:GPUBuffer;ft:GPUBuffer;history:[GPUBuffer,GPUBuffer];grid:GPUBuffer;walls:GPUBuffer;sums:GPUBuffer;meter:GPUBuffer;params:GPUBuffer},
    pipelines:GpuGranular['pipelines'],groups:GpuGranular['groups']) {
    this.compute=compute;this.setup=setup;this.positionBuffer=buffers.pos;this.vel=buffers.vel;this.spin=buffers.spin;this.ft=buffers.ft;this.history=buffers.history;this.grid=buffers.grid;
    this.walls=buffers.walls;this.sums=buffers.sums;this.meter=buffers.meter;this.params=buffers.params;this.pipelines=pipelines;this.groups=groups;
  }
  /** From a Granular (its grains, walls and settings as they are now). */
  static fromGranular(compute:GpuCompute,granular:Granular,options:DemOptions={}):Promise<GpuGranular> {
    return GpuGranular.create(compute,demSetup(granular,options)).then(solver=>{solver.time=granular.time;return solver;});
  }
  static async create(compute:GpuCompute,setup:DemSetup):Promise<GpuGranular> {
    const C=setup.capacity,L=compute.device.limits,memory=demMemory(C,{historySlots:setup.K,bucketSlots:setup.M,tableSize:setup.T,rolling:setup.rolling,walls:setup.wallCount});
    if(memory.largest>L.maxStorageBufferBindingSize)throw new EngineError('GPU_UNAVAILABLE',`${C} grains need a storage buffer of ${memory.largest} bytes; this device binds at most ${L.maxStorageBufferBindingSize}.`);
    if(Math.ceil(C/64)>L.maxComputeWorkgroupsPerDimension)throw new EngineError('GPU_UNAVAILABLE',`${C} grains need more workgroups than this device dispatches.`);
    const sources=demShaders({historySlots:setup.K,bucketSlots:setup.M,rolling:setup.rolling});
    const modules=await Promise.all((['integrate','sort','pairs','walls','wallStep'] as const).map(name=>compute.module(`granular ${name}`,sources[name])));
    const [mIntegrate,mSort,mPairs,mWalls,mWallStep]=modules;
    const layouts={
      integrate:compute.layout('granular integrate',['uniform-dynamic','write','write','write','read','write','write']),
      sort:compute.layout('granular sort',['uniform-dynamic','write']),
      pairs:compute.layout('granular pairs',['uniform-dynamic','read','read','read','read','read','write','write','write']),
      walls:compute.layout('granular walls',['uniform-dynamic','read','write','write','write','read','write','read','write']),
      wallStep:compute.layout('granular wall step',['uniform-dynamic','write','read']),
    };
    const pl=(layout:GPUBindGroupLayout):GPUPipelineLayout=>compute.device.createPipelineLayout({bindGroupLayouts:[layout]});
    const [wallOpen,integrate,sort,pairs,wallContacts,wallClose]=await Promise.all([
      compute.pipeline('granular wallOpen',mWallStep,'wallOpen',pl(layouts.wallStep)),compute.pipeline('granular integrate',mIntegrate,'integrate',pl(layouts.integrate)),compute.pipeline('granular sort',mSort,'sort',pl(layouts.sort)),
      compute.pipeline('granular pairs',mPairs,'pairs',pl(layouts.pairs)),compute.pipeline('granular wallContacts',mWalls,'wallContacts',pl(layouts.walls)),compute.pipeline('granular wallClose',mWallStep,'wallClose',pl(layouts.wallStep))]);
    const empty=new Uint32Array(4*setup.HS*setup.K*C).fill(DEM_EMPTY);
    const b={pos:compute.storage('granular positions',16*C,setup.pos),vel:compute.storage('granular velocities',16*C,setup.vel),spin:compute.storage('granular spins',16*C,setup.spin),ft:compute.storage('granular forces',32*C,setup.ft),
      history:[compute.storage('granular history A',empty.byteLength,empty),compute.storage('granular history B',empty.byteLength,empty)] as [GPUBuffer,GPUBuffer],grid:compute.storage('granular grid',memory.grid),
      walls:compute.storage('granular walls',DEM_WALL.stride*(setup.wallCount+1),setup.walls),sums:compute.storage('granular wall sums',memory.sums),meter:compute.storage('granular meter',4*DEM_METER_SLOTS),
      params:compute.buffer('granular parameters',2*BLOCK,GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST)};
    const P={buffer:b.params,size:DEM_PARAMS.size};
    const groups=await compute.scoped('granular bind groups',()=>({
      integrate:compute.bind('granular integrate',layouts.integrate,[P,b.pos,b.vel,b.spin,b.ft,b.grid,b.meter]),
      sort:compute.bind('granular sort',layouts.sort,[P,b.grid]),
      pairs:[0,1].map(k=>compute.bind(`granular pairs ${k}`,layouts.pairs,[P,b.pos,b.vel,b.spin,b.grid,b.history[k],b.history[1-k],b.ft,b.meter])) as [GPUBindGroup,GPUBindGroup],
      walls:[0,1].map(k=>compute.bind(`granular walls ${k}`,layouts.walls,[P,b.pos,b.vel,b.spin,b.ft,b.history[k],b.history[1-k],b.walls,b.sums])) as [GPUBindGroup,GPUBindGroup],
      wallStep:compute.bind('granular wall step',layouts.wallStep,[P,b.walls,b.sums]),
    }));
    const solver=new GpuGranular(compute,setup,b,{wallOpen,integrate,sort,pairs,wallContacts,wallClose},groups);
    solver.writeParams();
    solver.submit(1,0);
    return solver;
  }

  get count():number {return this.setup.count;}
  get capacity():number {return this.setup.capacity;}
  private alive():void {if(this.destroyed)throw new EngineError('GPU_DEVICE_LOST','This GpuGranular has been destroyed.');this.compute.assertAlive();}
  /** Block 0 evaluates the forces without moving anything (h = 0); block 1 is a step. */
  private writeParams():void {
    const data=new ArrayBuffer(2*BLOCK);
    DEM_PARAMS.write(new DataView(data,0,BLOCK),demParams(this.setup,0));DEM_PARAMS.write(new DataView(data,BLOCK,BLOCK),demParams(this.setup,this.setup.dt));
    this.compute.device.queue.writeBuffer(this.params,0,data);
  }
  /** Encode and submit `count` evaluations with parameter block `block`. */
  private submit(count:number,block:number):void {
    const s=this.setup,device=this.compute.device,n=s.count,offsets=[block*BLOCK],blocks=Math.ceil(n/DEM_BLOCK),buckets=Math.ceil(s.T/64),gx=Math.min(buckets,32768),gy=Math.ceil(buckets/gx);
    for(let done=0;done<count;){
      const chunk=Math.min(64,count-done),encoder=device.createCommandEncoder({label:'granular steps'});
      for(let k=0;k<chunk;k++){
        // The bucket counts and the per-step meter slots start at zero.
        encoder.clearBuffer(this.grid,0,4*s.T);encoder.clearBuffer(this.meter,4*DEM_METER_CONTACTS,8);
        new GpuProgram()
          .add({pipeline:this.pipelines.wallOpen,bindGroups:[this.groups.wallStep],workgroups:[s.wallCount],offsets})
          .add({pipeline:this.pipelines.integrate,bindGroups:[this.groups.integrate],workgroups:[Math.ceil(n/64)],offsets})
          .add({pipeline:this.pipelines.sort,bindGroups:[this.groups.sort],workgroups:[gx,gy],offsets})
          .add({pipeline:this.pipelines.pairs,bindGroups:[this.groups.pairs[this.parity]],workgroups:[Math.ceil(n/64)],offsets})
          .add({pipeline:this.pipelines.wallContacts,bindGroups:[this.groups.walls[this.parity]],workgroups:[Math.ceil(blocks/4)],offsets})
          .add({pipeline:this.pipelines.wallClose,bindGroups:[this.groups.wallStep],workgroups:[s.wallCount+1],offsets})
          .encode(encoder,'granular step');
        this.parity^=1;
      }
      device.queue.submit([encoder.finish()]);
      done+=chunk;
    }
  }
  /** Take `count` steps. Resolves when they are submitted; `sync()`, `read()` or `readWalls()` wait for them. */
  async step(count=1):Promise<void> {
    this.alive();
    if(!Number.isInteger(count)||count<0)throw new EngineError('INVALID_PAYLOAD','step(count) needs a whole number of steps.');
    this.submit(count,1);
    this.time+=count*this.setup.dt;this.stats.steps+=count;
  }
  /**
   * The setup's buffers were written (grains added or removed with `packDemGrains`, walls moved with `packDemWalls`):
   * upload them and evaluate the forces again. The contact histories are kept. `walls: 'state'` uploads the walls with
   * their forces and impulses (a coupling that reset the impulses), `walls: true` keeps what the GPU holds of those.
   */
  upload(what:{readonly grains?:boolean;readonly walls?:boolean}={grains:true,walls:true}):void {
    this.alive();
    const s=this.setup,c=this.compute;
    if(what.grains){c.write(this.positionBuffer,s.pos);c.write(this.vel,s.vel);c.write(this.spin,s.spin);this.writeParams();}
    if(what.walls)c.write(this.walls,s.walls);
    this.submit(1,0);
  }
  /** Upload the walls only, without evaluating the forces again (a coupling does this every rigid step). */
  uploadWalls():void {this.alive();this.compute.write(this.walls,this.setup.walls);}
  private book(meter:Uint32Array,walls:Float32Array):void {
    const st=this.stats,f=new Float32Array(meter.buffer,meter.byteOffset,meter.length),stat=readDemWall(walls,this.setup.wallCount);
    st.bucketOverflow=meter[DEM_METER_BUCKET_OVERFLOW];st.historyOverflow=meter[DEM_METER_HISTORY_OVERFLOW]+stat.force[0];st.removed=meter[DEM_METER_REMOVED];
    st.contacts=meter[DEM_METER_CONTACTS]/2;st.wallContacts=stat.force[2];st.overlap=Math.max(f[DEM_METER_OVERLAP],stat.force[1]);if(st.overlap>st.maxOverlap)st.maxOverlap=st.overlap;
    if(meter[DEM_METER_FLAGS]&1)throw new EngineError('UNSTABLE_TIME_STEP',`GpuGranular: a grain has no finite position at t = ${this.time} s: the run diverged.`);
    if(st.bucketOverflow>0)throw new EngineError('GPU_CAPACITY',`GpuGranular: ${st.bucketOverflow} times a grain found its hash bucket full (${this.setup.M} grains per bucket, ${this.setup.T} buckets): contacts were missed. Build the backend with more bucketSlots or a larger tableSize.`);
  }
  /** Wait for the steps submitted and return the walls (forces, impulses, poses) and the statistics. */
  async readWalls():Promise<Float32Array> {
    this.alive();
    const [walls,meter]=await this.compute.read([{buffer:this.walls},{buffer:this.meter}]);
    const out=new Float32Array(walls);this.book(new Uint32Array(meter),out);return out;
  }
  async sync():Promise<void> {await this.readWalls();}
  /** The grains and the walls now. */
  async read():Promise<GpuGranularSnapshot> {
    this.alive();
    const time=this.time,steps=this.stats.steps,n=this.setup.count,bytes=16*Math.max(1,n);
    const [pos,vel,spin,walls,meter]=await this.compute.read([{buffer:this.positionBuffer,size:bytes},{buffer:this.vel,size:bytes},{buffer:this.spin,size:bytes},{buffer:this.walls},{buffer:this.meter}]);
    const snapshot={time,steps,count:n,pos:new Float32Array(pos),vel:new Float32Array(vel),spin:new Float32Array(spin),walls:new Float32Array(walls),meter:new Uint32Array(meter)};
    this.book(snapshot.meter,snapshot.walls);
    return snapshot;
  }
  /** An exact checkpoint of the state (the format GranularF32 writes and reads too): waits for the steps submitted. */
  async checkpoint():Promise<Uint8Array> {
    this.alive();
    const C=this.setup.capacity,old=this.history[this.parity];
    const [pos,vel,spin,ft,history,walls,meter]=await this.compute.read([{buffer:this.positionBuffer},{buffer:this.vel},{buffer:this.spin},{buffer:this.ft},{buffer:old},{buffer:this.walls},{buffer:this.meter}]);
    const m=new Uint32Array(meter);this.book(m,new Float32Array(walls));
    const kept=new Uint32Array(DEM_METER_SLOTS);for(const k of [DEM_METER_BUCKET_OVERFLOW,DEM_METER_HISTORY_OVERFLOW,DEM_METER_REMOVED])kept[k]=m[k];
    return writeGranularCheckpoint(this.setup,{pos:new Float32Array(pos,0,4*C),vel:new Float32Array(vel,0,4*C),spin:new Float32Array(spin,0,4*C),ft:new Float32Array(ft,0,8*C),history:new Uint32Array(history),
      walls:new Uint8Array(walls),meter:kept,time:this.time,stats:this.stats});
  }
  /** Put back a checkpoint (from GpuGranular or GranularF32); later steps give the bits the run it was taken from gives. */
  restoreCheckpoint(bytes:Uint8Array):void {
    this.alive();
    const s=readGranularCheckpoint(this.setup,bytes),c=this.compute;
    c.write(this.positionBuffer,s.pos);c.write(this.vel,s.vel);c.write(this.spin,s.spin);c.write(this.ft,s.ft);
    this.parity=0;c.write(this.history[0],s.history);c.write(this.history[1],new Uint32Array(s.history.length).fill(DEM_EMPTY));
    c.write(this.walls,s.walls);new Uint8Array(this.setup.walls).set(s.walls);c.write(this.meter,s.meter);
    this.setup.pos.set(s.pos);this.setup.vel.set(s.vel);this.setup.spin.set(s.spin);this.setup.ft.set(s.ft);
    this.time=s.time;Object.assign(this.stats,s.stats);
  }
  /**
   * Write a snapshot (or the present state) into a Granular with the same grains and walls: positions, velocities,
   * spins, removed grains, the moving walls' poses and every wall's force and impulse. The Granular can then carry on in
   * float64; its tangential springs start from zero (the histories do not cross over).
   */
  async pull(target:Granular,snapshot?:GpuGranularSnapshot):Promise<GpuGranularSnapshot> {
    const snap=snapshot??await this.read();
    applyDemSnapshot(target,snap);
    return snap;
  }
  destroy():void {
    if(this.destroyed)return;this.destroyed=true;
    for(const buffer of [this.positionBuffer,this.vel,this.spin,this.ft,...this.history,this.grid,this.walls,this.sums,this.meter,this.params])this.compute.release(buffer);
  }
}

/** Write a float32 backend's grains and walls into a Granular (see `GpuGranular.pull`). */
export function applyDemSnapshot(target:Granular,snap:{readonly count:number;readonly time:number;readonly pos:Float32Array;readonly vel:Float32Array;readonly spin:Float32Array;readonly walls:Float32Array}):void {
  if(target.grainCount!==snap.count)throw new EngineError('INVALID_PAYLOAD','The Granular does not hold the grains of the snapshot.');
  const x=target.positions,v=target.velocities,w=target.angularVelocities;
  for(let i=0;i<snap.count;i++){
    if(snap.pos[4*i+3]<=0){if(target.alive[i])target.removeGrain(i);continue;}
    for(let k=0;k<3;k++){x[3*i+k]=snap.pos[4*i+k];v[3*i+k]=snap.vel[4*i+k];w[3*i+k]=snap.spin[4*i+k];}
  }
  const description=target.backendDescription();
  for(let k=0;k<target.wallCount;k++){
    const wall=readDemWall(snap.walls,k);
    if(description.walls[k].type!==0)target.setWallState(k,wall);
    target.setWallLoads(k,wall);
  }
  target.time=snap.time;target.touch();
}

/** Options of GranularRunner: the backend's capacities and how often a snapshot is kept in the float64 solver for a fall back. */
export interface GranularRunnerOptions extends DemOptions {
  /** Steps between the readbacks kept for a fall back to the CPU. Default 240; 0: none. */
  readonly snapshotEvery?:number;
}
/**
 * A grain run that starts on the GPU and carries on with the float64 solver when the device is lost (or was never
 * there). `granular` is the Granular the run was built from; while the GPU runs it only receives the snapshots.
 */
export class GranularRunner {
  backend:'gpu'|'cpu';
  fallback:{reason:string;atTime:number;resumedFrom:number;stepsRerun:number}|null=null;
  readonly granular:Granular;gpu:GpuGranular|null;
  private readonly every:number;private sinceSnapshot=0;private snapshotSteps=0;private stepsTaken=0;
  private constructor(granular:Granular,gpu:GpuGranular|null,every:number,reason:string|null) {
    this.granular=granular;this.gpu=gpu;this.every=every;this.backend=gpu?'gpu':'cpu';
    if(!gpu)this.fallback={reason:reason??'WebGPU compute is not available.',atTime:granular.time,resumedFrom:granular.time,stepsRerun:0};
  }
  static async create(granular:Granular,compute:GpuCompute|null,options:GranularRunnerOptions={}):Promise<GranularRunner> {
    let gpu:GpuGranular|null=null,reason:string|null=null;
    if(compute){try{gpu=await GpuGranular.fromGranular(compute,granular,options);}catch(error){if(!(error instanceof EngineError)||!error.code.startsWith('GPU_'))throw error;reason=error.message;}}
    return new GranularRunner(granular,gpu,options.snapshotEvery??240,reason);
  }
  get steps():number {return this.stepsTaken;}
  get time():number {return this.gpu?this.gpu.time:this.granular.time;}
  async step(count=1):Promise<void> {
    let left=count;
    while(left>0&&this.gpu){
      const chunk=this.every>0?Math.min(left,this.every-this.sinceSnapshot):left;
      try{await this.gpu.step(chunk);}
      catch(error){if(!(error instanceof EngineError)||error.code!=='GPU_DEVICE_LOST')throw error;this.fallBack(error.message);break;}
      left-=chunk;this.stepsTaken+=chunk;this.sinceSnapshot+=chunk;
      if(this.every>0&&this.sinceSnapshot>=this.every)await this.snapshot();
    }
    // Whatever is left (all of it once the device is gone) runs on the CPU.
    if(left>0){this.granular.step(left);this.stepsTaken+=left;}
  }
  async snapshot():Promise<void> {
    if(!this.gpu)return;
    try{await this.gpu.pull(this.granular);this.snapshotSteps=this.stepsTaken;this.sinceSnapshot=0;}
    catch(error){if(!(error instanceof EngineError)||error.code!=='GPU_DEVICE_LOST')throw error;this.fallBack(error.message);}
  }
  private fallBack(reason:string):void {
    const gpu=this.gpu!,from=this.granular.time,rerun=this.stepsTaken-this.snapshotSteps;
    this.gpu=null;this.backend='cpu';gpu.destroy();
    this.granular.step(rerun);
    this.fallback={reason,atTime:this.granular.time,resumedFrom:from,stepsRerun:rerun};
  }
  destroy():void {this.gpu?.destroy();this.gpu=null;}
}

/**
 * Two-way coupling of GPU grains with a rigid world, on the CPU: `coupling` is the float64 solver's GranularCoupling on
 * the Granular the GPU backend was built from (the "mirror"). Each rigid step: the bodies are copied into the mirror's
 * walls and uploaded (a few hundred bytes per wall), the GPU takes the grain substeps with the dynamic bodies integrated
 * alongside as in the float64 solver, the walls' impulses are read back (the per-wall sums are reduced on the GPU) and
 * the bodies are handed the mean force and torque.
 *
 * `latency: 0` (default) waits for that readback before `world.step()`: the bodies get the forces of this step, as in the
 * float64 coupling. `latency: 1` does not wait: the bodies get the forces of the previous rigid step. That is a delayed
 * feedback on a stiff contact and is stable only for a heavy body: with the contact stiffness k under the body (the sum
 * over its touching grains) and the rigid step h, the body's mass must be well above k h^2 (a body of 0.06 kg on a bed of
 * k = 1e5 N/m at 240 Hz, k h^2 = 1.7 kg, is thrown off the bed; one of 6 kg rests as with latency 0). Use latency 0 unless
 * the frame loop must not wait: the readback is 288 bytes per wall.
 */
export class GpuGranularCoupling<B> {
  readonly coupling:GranularCoupling<B>;readonly gpu:Pick<GpuGranular,'setup'|'uploadWalls'|'step'|'readWalls'>;readonly latency:0|1;
  private pending:Promise<Float32Array>|null=null;
  steps=0;
  constructor(coupling:GranularCoupling<B>,gpu:Pick<GpuGranular,'setup'|'uploadWalls'|'step'|'readWalls'>,options:{readonly latency?:0|1}={}) {this.coupling=coupling;this.gpu=gpu;this.latency=options.latency??0;}
  /** The walls as the GPU left them, into the mirror: the poses of the walls that move, every wall's force and impulse. */
  private apply(walls:Float32Array):void {
    const dem=this.coupling.granular,description=dem.backendDescription();
    for(let k=0;k<dem.wallCount;k++){
      const wall=readDemWall(walls,k);
      if(description.walls[k].type!==0)dem.setWallState(k,wall);
      dem.setWallLoads(k,wall);
    }
  }
  /** Call immediately before `world.step()`. */
  async step():Promise<void> {
    const c=this.coupling,dem=c.granular,gpu=this.gpu;
    if(this.latency===1){
      const walls=this.pending?await this.pending:null;
      if(walls){
        this.apply(walls);
        // `begin` reads the force the world applied in its last step (to estimate the supports) and zeroes the impulses;
        // `finish` then hands over the impulses of the grain steps just read.
        const kept=Array.from({length:dem.wallCount},(_,k)=>[Float64Array.from(dem.wallImpulse(k)),Float64Array.from(dem.wallAngularImpulse(k))]);
        c.begin();
        kept.forEach(([p,l],k)=>{dem.wallImpulse(k).set(p);dem.wallAngularImpulse(k).set(l);});
        c.finish();
        dem.resetWallImpulses();
      }else c.begin();
    }else c.begin();
    packDemWalls(dem.backendDescription(),gpu.setup.walls,true);
    gpu.uploadWalls();
    await gpu.step(c.substeps);
    if(this.latency===0){this.apply(await gpu.readWalls());c.finish();}
    else{this.pending=gpu.readWalls();this.pending.catch(()=>{});}
    this.steps++;
  }
}
export {packDemGrains,packDemWalls};
