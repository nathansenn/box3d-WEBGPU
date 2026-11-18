/**
 * The subsystems a scene section with `backend: 'gpu'` runs as (shallow water and grains): pass
 * `gpuSceneBackends(compute)` as the `gpu` option of loadSimulationScene / buildSceneSimulation / resumeSimulationScene.
 *
 * They are asynchronous: they step in `await simulation.stepAsync()` (in their place in the stage order: grains in the
 * couple stage, before the rigid step, waiting for the walls' sums; shallow water in the post stage) and checkpoint in
 * `await simulation.checkpointAsync()`. `simulation.step()` refuses a simulation that has one.
 *
 * The backend is built from the float64 solver the scene loader made (the starting state) at the first asynchronous
 * step, so loading stays synchronous. After that the float64 solver is a mirror: the grains' walls and coupled bodies
 * (the coupling runs on the CPU), and nothing for the shallow water. `await simulation.pullAsync()` writes the GPU state
 * into the mirrors (for reading them, or saving the scene: a save of a section whose state was not pulled since its last
 * step is refused).
 *
 * `gpuSceneBackends('reference')` runs the same float32 programs on the CPU (ShallowWaterF32, GranularF32): no device,
 * slower than the float64 solvers, and the bits SwiftShader's GPU gives (docs/GPU_COMPUTE.md, where the agreement is
 * "identical"). Determinism: a run repeats bit for bit on the same device and browser, and a checkpoint taken on one
 * backend restores on either (the formats are shared); results are float32 and are not the float64 solvers' bits.
 */
import {EngineError} from '../contracts.ts';
import {checkpointError,type StateValue} from '../checkpoint.ts';
import {GRANULAR_SUBSYSTEM_ORDER,GranularCoupling} from '../granular.ts';
import {ShallowWater} from '../shallow-water.ts';
import type {SceneGpuBackends,Subsystem,StepContext} from '../simulation.ts';
import type {GpuCompute} from './compute.ts';
import {GpuGranular,GpuGranularCoupling,applyDemSnapshot} from './granular-gpu.ts';
import {GranularF32,demSetup,readDemWall} from './granular-f32.ts';
import {GpuShallowWater} from './shallow-water-gpu.ts';
import {ShallowWaterF32} from './shallow-water-f32.ts';

/** The tag of a GPU section's state in a simulation checkpoint. */
export const GPU_SCENE_BACKEND='scene-section-gpu-f32-v1';

/** What `pullAsync` and the scene save need of a GPU section. */
export interface GpuSceneSubsystem<W,B> extends Subsystem<W,B> {
  /** True when the GPU state has moved on since the last pull into the float64 mirror. */
  stale():boolean;
  readonly backend:'gpu'|'reference';
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
export function gpuShallowWaterSubsystem<W,B>(compute:GpuCompute|'reference',water:ShallowWater,options:{readonly id?:string;readonly order?:number}={}):GpuSceneSubsystem<W,B> {
  const id=options.id??'shallow-water';
  let backend:SwBackend|null=null,pending:Uint8Array|null=null,stale=false,wet=water.stats.wetCells;
  const ready=async():Promise<SwBackend>=>{
    if(!backend){backend=await shallowWaterBackend(compute,water);if(pending){backend.restoreCheckpoint(pending);pending=null;}}
    return backend;
  };
  return {
    id,kind:'shallow-water-gpu',stage:'post',order:options.order??530,backend:compute==='reference'?'reference':'gpu',
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
export function gpuGranularSubsystem<W,B>(compute:GpuCompute|'reference',coupling:GranularCoupling<B>,options:{readonly id?:string;readonly order?:number}={}):GpuSceneSubsystem<W,B> {
  const id=options.id??'granular',dem=coupling.granular;
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
    id,kind:'granular-gpu',stage:'couple',order:options.order??GRANULAR_SUBSYSTEM_ORDER,backend:compute==='reference'?'reference':'gpu',
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

/** The `gpu` option of the scene loaders: GPU subsystems for the sections that say backend: 'gpu'. */
export function gpuSceneBackends<W,B>(compute:GpuCompute|'reference'):SceneGpuBackends<W,B> {
  return {
    shallowWater:(water,info)=>gpuShallowWaterSubsystem<W,B>(compute,water,{id:info.id}),
    grains:(coupling,info)=>gpuGranularSubsystem<W,B>(compute,coupling,{id:info.id}),
  };
}
export {readDemWall};
