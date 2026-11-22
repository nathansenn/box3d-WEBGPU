/**
 * The subsystems a scene section with `backend: 'gpu'` runs as (shallow water, grains and flows): pass
 * `gpuSceneBackends(compute)` as the `gpu` option of loadSimulationScene / buildSceneSimulation / resumeSimulationScene.
 *
 * They are asynchronous: they step in `await simulation.stepAsync()` (in their place in the stage order: grains in the
 * couple stage, before the rigid step, waiting for the walls' sums; a flow with bodies in the couple stage, waiting for
 * the obstacles' sums, one without in the post stage; shallow water in the post stage) and checkpoint in
 * `await simulation.checkpointAsync()`. `simulation.step()` refuses a simulation that has one.
 *
 * The backend is built from the float64 solver the scene loader made (the starting state) at the first asynchronous
 * step, so loading stays synchronous. After that the float64 solver is a mirror: the grains' walls and coupled bodies
 * (the coupling runs on the CPU), the flow's obstacles (their geometry in float64, their poses and forces: the backend
 * takes their band from it before each step and hands it their sums after), and nothing for the shallow water.
 * `await simulation.pullAsync()` writes the GPU state
 * into the mirrors (for reading them, or saving the scene: a save of a section whose state was not pulled since its last
 * step is refused).
 *
 * `gpuSceneBackends('reference')` runs the same float32 programs on the CPU (ShallowWaterF32, GranularF32, FluidF32): no device,
 * slower than the float64 solvers, and the bits SwiftShader's GPU gives (docs/GPU_COMPUTE.md, where the agreement is
 * "identical"). Determinism: a run repeats bit for bit on the same device and browser, and a checkpoint taken on one
 * backend restores on either (the formats are shared); results are float32 and are not the float64 solvers' bits.
 */
import {EngineError} from '../contracts.ts';
import {checkpointError,type StateValue} from '../checkpoint.ts';
import {GRANULAR_SUBSYSTEM_ORDER,GranularCoupling} from '../granular.ts';
import {ShallowWater} from '../shallow-water.ts';
// Types only: ./gpu of the kit then does not load the flow solver for a page that runs no flow (40 KiB of gzip).
import type {Fluid,FluidCoupling} from '../fluid.ts';
import {GpuFluid} from './fluid-gpu.ts';
import {FluidF32} from './fluid-f32.ts';
import type {FluidBackendOptions} from './fluid-program.ts';
import type {SceneGpuBackends,Simulation,SimulationWorld,Subsystem,StepContext} from '../simulation.ts';
import type {GpuCompute} from './compute.ts';
import {GpuGranular,GpuGranularCoupling,applyDemSnapshot} from './granular-gpu.ts';
import {GranularF32,demSetup,readDemWall} from './granular-f32.ts';
import {GpuShallowWater} from './shallow-water-gpu.ts';
import {ShallowWaterF32} from './shallow-water-f32.ts';

/** Where a flow with bodies runs in the couple stage: FLUID_SUBSYSTEM_ORDER of fluid.ts (as fluidSubsystem). */
const FLUID_COUPLING_ORDER=180;
/** The tag of a GPU section's state in a simulation checkpoint. */
export const GPU_SCENE_BACKEND='scene-section-gpu-f32-v1';

/** What `pullAsync` and the scene save need of a GPU section. */
export interface GpuSceneSubsystem<W,B> extends Subsystem<W,B> {
  /** True when the GPU state has moved on since the last pull into the float64 mirror. */
  stale():boolean;
  /** Where the section runs now: on the device, or on the float32 reference (from the start, or since useReference()). */
  readonly backend:'gpu'|'reference';
  /**
   * Run on the float32 reference from now on (after a device loss): the device's backend is dropped and the next step
   * builds the reference from the float64 mirror. Restore a checkpoint before the next step (GpuSceneRunner does): the
   * mirror does not hold the GPU state.
   */
  useReference():void;
}

const refuseSync=(id:string):never=>{throw new EngineError('UNSUPPORTED_BACKEND',`Subsystem "${id}" runs on the GPU: advance the simulation with await simulation.stepAsync() and checkpoint it with await simulation.checkpointAsync().`);};

interface SwBackend {step(count:number):Promise<void>;checkpoint():Promise<Uint8Array>;restoreCheckpoint(bytes:Uint8Array):void;pull(target:ShallowWater):Promise<void>;stats:{wetCells:number;substeps:number;totalSubsteps:number};time:number;steps:number;solver:string;destroy():void}
function shallowWaterBackend(compute:GpuCompute|'reference',water:ShallowWater):Promise<SwBackend> {
  if(compute==='reference'){
    const r=new ShallowWaterF32(water);
    return Promise.resolve({step:async(count:number)=>{r.step(count);},checkpoint:async()=>r.checkpoint(),restoreCheckpoint:(b:Uint8Array)=>r.restoreCheckpoint(b),
      pull:async(target:ShallowWater)=>{
        const n=r.cells;for(let c=0;c<n;c++){target.h[c]=Math.max(0,r.state[4*c]+r.state[4*c+3]);target.qx[c]=r.state[4*c+1];target.qz[c]=r.state[4*c+2];target.infiltrated[c]=r.aux[4*c];}
        target.time=r.time;target.steps=r.steps;
      },
      get stats(){return r.stats;},get time(){return r.time;},get steps(){return r.steps;},solver:r.solver,destroy(){}});
  }
  return GpuShallowWater.create(compute,water).then(g=>({step:(count:number)=>g.step(count).then(()=>g.sync()),checkpoint:()=>g.checkpoint(),restoreCheckpoint:(b:Uint8Array)=>g.restoreCheckpoint(b),
    pull:async(target:ShallowWater)=>{await g.pull(target);},get stats(){return g.stats;},get time(){return g.time;},get steps(){return g.steps;},solver:g.solver,destroy:()=>g.destroy()}));
}

/** A GPU (or float32 reference) shallow-water section: post stage, commensurate step, as shallowWaterSubsystem without bodies. */
export function gpuShallowWaterSubsystem<W,B>(device:GpuCompute|'reference',water:ShallowWater,options:{readonly id?:string;readonly order?:number}={}):GpuSceneSubsystem<W,B> {
  const id=options.id??'shallow-water';let compute=device;
  let backend:SwBackend|null=null,pending:Uint8Array|null=null,stale=false,wet=water.stats.wetCells;
  const ready=async():Promise<SwBackend>=>{
    if(!backend){backend=await shallowWaterBackend(compute,water);if(pending){backend.restoreCheckpoint(pending);pending=null;}}
    return backend;
  };
  return {
    id,kind:'shallow-water-gpu',stage:'post',order:options.order??530,get backend(){return compute==='reference'?'reference' as const:'gpu' as const;},
    useReference(){compute='reference';try{backend?.destroy();}catch{/* the device is gone */}backend=null;},
    timeStep:{dt:water.dt,rule:'commensurate'},
    step(){refuseSync(id);},
    async stepAsync(ctx:StepContext<W>){const b=await ready();await b.step(ctx.substeps);stale=true;},
    finish(ctx){
      if(!backend)return;
      const now=backend.stats.wetCells;
      if(Math.abs(now-wet)>.1*Math.max(wet,1)){ctx.emit('wet-cells',{wet:now,before:wet});wet=now;}
    },
    checkpoint(){return refuseSync(id);},
    async checkpointAsync(){const b=await ready();return {backend:GPU_SCENE_BACKEND,bytes:await b.checkpoint(),wet};},
    restore(state:StateValue){
      const s=state as {backend?:unknown;bytes?:unknown;wet?:unknown}|null;
      if(!s||s.backend!==GPU_SCENE_BACKEND||!(s.bytes instanceof Uint8Array)||typeof s.wet!=='number')throw checkpointError(`Subsystem "${id}": the saved state is not one of a GPU shallow-water section.`);
      if(backend)backend.restoreCheckpoint(s.bytes);else pending=s.bytes;
      wet=s.wet;stale=true;
    },
    async pullAsync(){if(backend&&stale){await backend.pull(water);}stale=false;},
    stale:()=>stale,
    diagnostics(){return {solver:backend?.solver??null,backend:compute==='reference'?'gpu-reference':'gpu',cells:water.cells,time:backend?.time??water.time,steps:backend?.steps??0,dt:water.dt,...(backend?backend.stats:{})};},
    dispose(){backend?.destroy();backend=null;},
  };
}

interface DemBackend {coupling:GpuGranularCoupling<unknown>;checkpoint():Promise<Uint8Array>;restoreCheckpoint(bytes:Uint8Array):void;pull():Promise<void>;stats:{steps:number;contacts:number;removed:number;historyOverflow:number};solver:string;destroy():void}

/** A GPU (or float32 reference) grain section: the coupling's begin and finish on the CPU, the grain steps on the backend; couple stage, as granularSubsystem of a coupling. */
export function gpuGranularSubsystem<W,B>(device:GpuCompute|'reference',coupling:GranularCoupling<B>,options:{readonly id?:string;readonly order?:number}={}):GpuSceneSubsystem<W,B> {
  const id=options.id??'granular',dem=coupling.granular;let compute=device;
  let backend:DemBackend|null=null,pending:Uint8Array|null=null,stale=false;
  const ready=async():Promise<DemBackend>=>{
    if(backend)return backend;
    if(compute==='reference'){
      const setup=demSetup(dem),f32=new GranularF32(setup);
      f32.time=dem.time;
      const stand={setup,uploadWalls(){},async step(count:number){f32.step(count);},async readWalls(){return f32.wallF.slice();}};
      backend={coupling:new GpuGranularCoupling(coupling as GranularCoupling<unknown>,stand),checkpoint:async()=>f32.checkpoint(),restoreCheckpoint:b=>f32.restoreCheckpoint(b),
        pull:async()=>applyDemSnapshot(dem,{count:f32.count,time:f32.time,pos:f32.pos,vel:f32.vel,spin:f32.spin,walls:f32.wallF}),get stats(){return f32.stats;},solver:f32.solver,destroy(){}};
    }else{
      const g=await GpuGranular.fromGranular(compute,dem);
      backend={coupling:new GpuGranularCoupling(coupling as GranularCoupling<unknown>,g),checkpoint:()=>g.checkpoint(),restoreCheckpoint:b=>g.restoreCheckpoint(b),
        pull:async()=>{await g.pull(dem);},get stats(){return g.stats;},solver:g.solver,destroy:()=>g.destroy()};
    }
    if(pending){backend.restoreCheckpoint(pending);pending=null;}
    return backend;
  };
  return {
    id,kind:'granular-gpu',stage:'couple',order:options.order??GRANULAR_SUBSYSTEM_ORDER,get backend(){return compute==='reference'?'reference' as const:'gpu' as const;},
    useReference(){compute='reference';try{backend?.destroy();}catch{/* the device is gone */}backend=null;},
    timeStep:{dt:coupling.dt,rule:'equal'},
    step(){refuseSync(id);},
    async stepAsync(){const b=await ready();await b.coupling.step();stale=true;},
    checkpoint(){return refuseSync(id);},
    // The backend's bytes and the coupling's own records (the walls' poses and loads, the bodies), which live on the CPU.
    async checkpointAsync(){const b=await ready();return {backend:GPU_SCENE_BACKEND,bytes:await b.checkpoint(),coupling:coupling.saveState()};},
    restore(state:StateValue){
      const s=state as {backend?:unknown;bytes?:unknown;coupling?:StateValue}|null;
      if(!s||s.backend!==GPU_SCENE_BACKEND||!(s.bytes instanceof Uint8Array))throw checkpointError(`Subsystem "${id}": the saved state is not one of a GPU grain section.`);
      coupling.restoreState(s.coupling);
      if(backend)backend.restoreCheckpoint(s.bytes);else pending=s.bytes;
      stale=true;
    },
    async pullAsync(){if(backend&&stale)await backend.pull();stale=false;},
    stale:()=>stale,
    diagnostics(){
      const walls=dem.wallCount;
      return {solver:backend?.solver??null,backend:compute==='reference'?'gpu-reference':'gpu',grains:dem.grainCount,walls,time:dem.time,substeps:coupling.substeps,...(backend?backend.stats:{})};
    },
    dispose(){backend?.destroy();backend=null;},
  };
}

interface FlowBackend {step(count:number):Promise<void>;checkpoint():Promise<Uint8Array>;restoreCheckpoint(bytes:Uint8Array):void;pull():Promise<void>;
  stats:{steps:number;pressureIterations:number;viscousIterations:number;divergence:number;unconverged:number};time:number;solver:string;destroy():void}

/**
 * A GPU (or float32 reference) flow: a FluidCoupling (couple stage, order 180, the rigid step) whose fluid steps run on
 * the backend, or a bare Fluid (post stage, commensurate step), as fluidSubsystem. The backend is built from the Fluid,
 * which keeps the obstacles: before each fluid step the backend takes their band at the poses the coupling set, after it
 * the coupling reads their forces (Fluid.finishBackendObstacles). The room for obstacle faces is fixed when the section
 * is built (twice the band at the scene's start plus 64 per obstacle), so a resumed run has the same room as a straight
 * one; a move that needs more throws GPU_CAPACITY. No energy ledger (the backend sums no dissipation); events:
 * 'unconverged' when a solve stopped at its iteration limit.
 */
export function gpuFluidSubsystem<W,B>(device:GpuCompute|'reference',target:Fluid|FluidCoupling<B>,options:{readonly id?:string;readonly order?:number;readonly backend?:FluidBackendOptions}={}):GpuSceneSubsystem<W,B> {
  // A FluidCoupling holds its fluid; a Fluid describes itself to a backend (no instanceof: see the import above).
  const coupling='fluid' in target&&'substeps' in target?target as FluidCoupling<B>:null,fluid=coupling?coupling.fluid:target as Fluid;let compute=device;
  if(!fluid||typeof (fluid as {backendObstacleBand?:unknown}).backendObstacleBand!=='function')throw new EngineError('INVALID_PAYLOAD','gpuFluidSubsystem needs a Fluid or a FluidCoupling.');
  const id=options.id??'fluid';
  let faces=0;
  if(fluid.obstacleCount>0){const band=fluid.backendObstacleBand();for(const c of band.components)faces+=c.face.length;}
  const backendOptions:FluidBackendOptions={...(fluid.obstacleCount>0?{obstacleCapacity:2*faces+64*fluid.obstacleCount}:{}),...options.backend};
  let backend:FlowBackend|null=null,pending:Uint8Array|null=null,stale=false,unconverged=0;
  const ready=async():Promise<FlowBackend>=>{
    if(backend)return backend;
    if(compute==='reference'){
      const r=new FluidF32(fluid,backendOptions);
      backend={step:async(count:number)=>{r.step(count);},checkpoint:async()=>r.checkpoint(),restoreCheckpoint:b=>r.restoreCheckpoint(b),
        pull:async()=>{fluid.u.set(r.velocity(0));fluid.v.set(r.velocity(1));fluid.w.set(r.velocity(2));fluid.p.set(r.pressure());fluid.time=r.time;},
        get stats(){return r.stats;},get time(){return r.time;},solver:r.solver,destroy(){}};
    }else{
      const g=await GpuFluid.create(compute,fluid,null,backendOptions);
      backend={step:(count:number)=>g.step(count),checkpoint:()=>g.checkpoint(),restoreCheckpoint:b=>g.restoreCheckpoint(b),pull:()=>g.pull(fluid),
        get stats(){return g.stats;},get time(){return g.time;},solver:g.solver,destroy:()=>g.destroy()};
    }
    if(pending){backend.restoreCheckpoint(pending);pending=null;}
    return backend;
  };
  return {
    id,kind:coupling?'fluid-coupling-gpu':'fluid-gpu',stage:coupling?'couple':'post',order:options.order??(coupling?FLUID_COUPLING_ORDER:510),get backend(){return compute==='reference'?'reference' as const:'gpu' as const;},
    useReference(){compute='reference';try{backend?.destroy();}catch{/* the device is gone */}backend=null;},
    timeStep:{dt:coupling?coupling.dt:fluid.dt,rule:coupling?'equal':'commensurate'},
    validate(){fluid.checkTimeStep();},
    step(){refuseSync(id);},
    async stepAsync(ctx:StepContext<W>){
      const b=await ready();
      if(coupling)await coupling.stepAsync(count=>b.step(count));else await b.step(ctx.substeps);
      stale=true;
    },
    finish(ctx){
      if(!backend)return;
      const now=backend.stats.unconverged;
      if(now!==unconverged){ctx.emit('unconverged',{iterations:backend.stats.pressureIterations,divergence:backend.stats.divergence});unconverged=now;}
    },
    checkpoint(){return refuseSync(id);},
    // The backend's bytes and, on the CPU, the obstacles' poses, forces and momentum records with the coupling's (the
    // Fluid's own field in that state is not the flow: the flow is in the bytes).
    async checkpointAsync(){const b=await ready();return {backend:GPU_SCENE_BACKEND,bytes:await b.checkpoint(),host:(coupling??fluid).saveState(),unconverged};},
    restore(state:StateValue){
      const s=state as {backend?:unknown;bytes?:unknown;host?:StateValue;unconverged?:unknown}|null;
      if(!s||s.backend!==GPU_SCENE_BACKEND||!(s.bytes instanceof Uint8Array)||typeof s.unconverged!=='number')throw checkpointError(`Subsystem "${id}": the saved state is not one of a GPU flow section.`);
      (coupling??fluid).restoreState(s.host);
      if(backend)backend.restoreCheckpoint(s.bytes);else pending=s.bytes;
      unconverged=s.unconverged;stale=true;
    },
    async pullAsync(){if(backend&&stale)await backend.pull();stale=false;},
    stale:()=>stale,
    diagnostics(){return {solver:backend?.solver??null,backend:compute==='reference'?'gpu-reference':'gpu',cells:fluid.cells,time:backend?.time??fluid.time,dt:fluid.dt,substeps:coupling?coupling.substeps:1,obstacles:fluid.obstacleCount,...(backend?backend.stats:{})};},
    dispose(){backend?.destroy();backend=null;},
  };
}

/** What a GpuSceneRunner did when the device was lost. */
export interface GpuSceneFallback {
  readonly reason:string;
  /** The simulation tick the lost step started from, and the tick of the checkpoint the run carried on from. */
  readonly atTick:number;readonly resumedFrom:number;
  /** Steps taken again on the reference to get back to `atTick`. */
  readonly stepsRerun:number;
}
const isLoss=(error:unknown):error is EngineError=>error instanceof EngineError&&error.code==='GPU_DEVICE_LOST';
const isGpuSection=(s:unknown):s is GpuSceneSubsystem<unknown,unknown>=>typeof (s as {useReference?:unknown}).useReference==='function'&&typeof (s as {stale?:unknown}).stale==='function';

/**
 * Steps a simulation with GPU sections and carries on with the float32 reference when the device is lost. It takes a
 * checkpoint of the whole simulation (`checkpointAsync`: the world, every section, the clock) before its first step and
 * then every `snapshotEvery` steps; on GPU_DEVICE_LOST during a step or a checkpoint every GPU section switches to the
 * reference (`useReference`), the last checkpoint is restored and the steps since it are taken again, then the step that
 * failed. The reference runs the GPU's program, so the run goes on with the bits it would have had on the device
 * wherever the two agree bit for bit (docs/GPU_COMPUTE.md); a fall back costs the steps since the checkpoint.
 */
export class GpuSceneRunner<W extends SimulationWorld<B>,B> {
  readonly simulation:Simulation<W,B>;readonly snapshotEvery:number;
  fallback:GpuSceneFallback|null=null;
  private snapshot:Uint8Array|null=null;private snapshotTick=-1;
  constructor(simulation:Simulation<W,B>,options:{readonly snapshotEvery?:number}={}) {
    this.simulation=simulation;this.snapshotEvery=Math.max(1,Math.floor(options.snapshotEvery??30));
  }
  /** The sections that run on the GPU or its reference. */
  get sections():GpuSceneSubsystem<W,B>[] {return this.simulation.subsystems().filter(isGpuSection) as GpuSceneSubsystem<W,B>[];}
  /** 'gpu' while any section runs on the device, else 'reference'. */
  get backend():'gpu'|'reference' {return this.sections.some(s=>s.backend==='gpu')?'gpu':'reference';}
  /** The tick of the checkpoint a fall back would carry on from (-1 before the first). */
  get checkpointTick():number {return this.snapshotTick;}
  /** One step of the simulation (`stepAsync`), with a checkpoint first when one is due. */
  async step():Promise<void> {
    const sim=this.simulation;
    if(this.backend==='gpu'&&(this.snapshot===null||sim.tick-this.snapshotTick>=this.snapshotEvery)){
      try{this.snapshot=await sim.checkpointAsync();this.snapshotTick=sim.tick;}
      catch(error){if(!isLoss(error))throw error;await this.fallBack(error.message);}
    }
    try{await sim.stepAsync();}
    catch(error){if(!isLoss(error))throw error;await this.fallBack(error.message);await sim.stepAsync();}
  }
  private async fallBack(reason:string):Promise<void> {
    const sim=this.simulation,at=sim.tick;
    for(const s of this.sections)s.useReference();
    if(this.snapshot===null){
      // Lost before the first checkpoint: nothing has stepped on the device, the mirrors hold the start.
      if(at!==0)throw new EngineError('GPU_DEVICE_LOST',`The device was lost at step ${at} before a checkpoint was taken: ${reason}`);
      this.fallback={reason,atTick:at,resumedFrom:0,stepsRerun:0};return;
    }
    sim.restore(this.snapshot);
    const from=sim.tick;
    while(sim.tick<at)await sim.stepAsync();
    this.fallback={reason,atTick:at,resumedFrom:from,stepsRerun:at-from};
  }
}

/** The `gpu` option of the scene loaders: GPU subsystems for the sections that say backend: 'gpu'. */
export function gpuSceneBackends<W,B>(compute:GpuCompute|'reference'):SceneGpuBackends<W,B> {
  return {
    shallowWater:(water,info)=>gpuShallowWaterSubsystem<W,B>(compute,water,{id:info.id}),
    grains:(coupling,info)=>gpuGranularSubsystem<W,B>(compute,coupling,{id:info.id}),
    fluid:(target,info)=>gpuFluidSubsystem<W,B>(compute,target,{id:info.id}),
  };
}
export {readDemWall};
