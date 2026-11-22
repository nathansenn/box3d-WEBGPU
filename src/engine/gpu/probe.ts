/**
 * The GPU compute check page (gpu-probe.html) and the API scripts/gpu-compute-browser-check.mjs drives:
 * `window.box3dGpu`. Everything here runs the real backends on the visitor's device and returns plain data.
 */
import * as swScenarios from '../../../packages/box3d-kit/test/shallow-water-scenarios.mjs';
import {ShallowWater,type ShallowWaterOptions} from '../shallow-water.ts';
import {SHALLOW_WATER_SETUPS,floodValley} from './shallow-water-setups.ts';
import {EngineError} from '../contracts.ts';
import {acquireGpuCompute,gpuComputeSupported,type GpuCompute,type GpuComputeInfo} from './compute.ts';
import {NativeWorldPool} from '../native-world.ts';
import {loadLabScene} from '../../lab/scene-host.ts';
import {gpuSceneBackends} from './scene-backends.ts';
import {couplingRowChecks,runCouplingRows,type CouplingRowLoad,type CouplingRowsResult} from './coupling-scenes.ts';
import {GpuShallowWater,ShallowWaterRunner} from './shallow-water-gpu.ts';
import {ShallowWaterF32} from './shallow-water-f32.ts';
import {runShallowWaterCases,type GpuCaseRow} from './shallow-water-cases.ts';
import {gpuBackend,shallowWaterDifference} from './shallow-water-validation.ts';
import {Granular} from '../granular.ts';
import {GpuGranular,GranularRunner,demMemory,type GpuGranularSnapshot} from './granular-gpu.ts';
import {GranularF32,readDemWall,type DemSetup,type DemStats} from './granular-f32.ts';
import {GRANULAR_SETUPS,sandAvalanche} from './granular-setups.ts';
import type {GranularCaseRun} from './granular-cases.ts';
import {Fluid} from '../fluid.ts';
import {GpuFluid,FluidRunner} from './fluid-gpu.ts';
import {FluidF32} from './fluid-f32.ts';
import {FLUID_SETUPS,cavity3d,sphereArray} from './fluid-setups.ts';
import type {FluidCaseRun} from './fluid-cases.ts';

function fnv(...arrays:ArrayBufferView[]):string {
  let a=0x811c9dc5,b=0xcbf29ce4;
  for(const array of arrays){const bytes=new Uint8Array(array.buffer,array.byteOffset,array.byteLength);for(let i=0;i<bytes.length;i++){a=Math.imul(a^bytes[i],0x01000193)>>>0;b=Math.imul(b^bytes[i],0x01000197)>>>0;}}
  return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');
}
async function gpuFrame(compute:GpuCompute,options:ShallowWaterOptions,steps:number,gpuOptions:{rateLatency?:number}={}) {
  const solver=await GpuShallowWater.create(compute,new ShallowWater(options),gpuOptions);
  await solver.step(steps);
  const snap=await solver.read();await solver.sync();
  const n=solver.cells,h=new Float64Array(n),qx=new Float64Array(n),qz=new Float64Array(n);
  for(let c=0;c<n;c++){h[c]=snap.state[4*c]+snap.state[4*c+3];qx[c]=snap.state[4*c+1];qz[c]=snap.state[4*c+2];}
  const budget=solver.budget(snap),out={h,qx,qz,hash:fnv(snap.state,snap.aux),substeps:solver.stats.totalSubsteps,maxCourant:solver.maxCourant,budget,volumeRelative:Math.abs(budget.error)/Math.max(budget.volume,1e-300)};
  solver.destroy();return out;
}
function f32Frame(options:ShallowWaterOptions,steps:number) {
  const solver=new ShallowWaterF32(new ShallowWater(options));solver.step(steps);
  const n=solver.cells,h=new Float64Array(n),qx=new Float64Array(n),qz=new Float64Array(n);
  for(let c=0;c<n;c++){h[c]=solver.depth(c);qx[c]=solver.state[4*c+1];qz[c]=solver.state[4*c+2];}
  return {h,qx,qz,substeps:solver.stats.totalSubsteps};
}
function f64Frame(options:ShallowWaterOptions,steps:number) {const w=new ShallowWater(options);w.step(steps);return {h:w.h,qx:w.qx,qz:w.qz,substeps:w.stats.totalSubsteps};}

export interface ShallowWaterAgreement {name:string;steps:number;cells:number;substeps:{gpu:number;f32:number;f64:number};
  /** Largest difference over the largest value: depth and discharge, GPU against the float32 reference and against float64. */
  gpuVsF32:{depth:number;discharge:number};gpuVsF64:{depth:number;discharge:number};
  repeat:{identical:boolean;hash:string};volumeRelative:number;maxCourant:number;
  /** The same run with the face speeds two steps old (rateLatency 2). */
  latency:{substeps:number;maxCourant:number;vsSync:{depth:number;discharge:number}}}

const ratio=(d:{depth:number;discharge:number;maxDepth:number;maxDischarge:number})=>({depth:d.depth/Math.max(d.maxDepth,1e-300),discharge:d.discharge/Math.max(d.maxDischarge,1e-300)});

async function shallowWaterAgreement(compute:GpuCompute,progress:(text:string)=>void):Promise<ShallowWaterAgreement[]> {
  const out:ShallowWaterAgreement[]=[];
  for(const [name,make] of Object.entries(SHALLOW_WATER_SETUPS)){
    progress(`shallow water: agreement on "${name}"`);
    const {options,steps}=make();
    const a=await gpuFrame(compute,options,steps),b=await gpuFrame(compute,options,steps),r=f32Frame(options,steps),d=f64Frame(options,steps),late=await gpuFrame(compute,options,steps,{rateLatency:2});
    out.push({name,steps,cells:a.h.length,substeps:{gpu:a.substeps,f32:r.substeps,f64:d.substeps},gpuVsF32:ratio(shallowWaterDifference(a,r)),gpuVsF64:ratio(shallowWaterDifference(a,d)),
      repeat:{identical:a.hash===b.hash,hash:a.hash},volumeRelative:a.volumeRelative,maxCourant:a.maxCourant,latency:{substeps:late.substeps,maxCourant:late.maxCourant,vsSync:ratio(shallowWaterDifference(late,a))}});
  }
  return out;
}

export interface DeviceLossResult {backendBefore:string;backendAfter:string;reason:string;stepsRerun:number;resumedFrom:number;time:number;steps:number;
  /** Largest depth difference over the largest depth against a float64 run of the same steps. */
  vsF64:number}
/** Lose the device in the middle of a run: the runner carries on with the float64 solver from the last snapshot. */
async function shallowWaterDeviceLoss():Promise<DeviceLossResult> {
  const compute=await acquireGpuCompute({label:'box3d device-loss check'}),{options}=SHALLOW_WATER_SETUPS.everything();
  const water=new ShallowWater(options),runner=await ShallowWaterRunner.create(water,compute,{snapshotEvery:5});
  const before=runner.backend;
  await runner.step(12);
  compute.device.destroy();
  await compute.device.lost;
  await runner.step(8);
  const reference=new ShallowWater(options);reference.step(20);
  const d=shallowWaterDifference(water,reference);
  return {backendBefore:before,backendAfter:runner.backend,reason:runner.fallback?.reason??'',stepsRerun:runner.fallback?.stepsRerun??-1,resumedFrom:runner.fallback?.resumedFrom??-1,time:runner.time,steps:runner.steps,vsF64:d.depth/d.maxDepth};
}

export interface BenchRow {backend:string;size:string;elements:number;steps:number;substeps:number;msPerStep:number;elementUpdatesPerSecond:number;cpuMsPerStep:number|null;speedup:number|null}
/** A flood over a valley: time `steps` steps on the GPU (face speeds two steps old, one wait at the end) and on the CPU. */
async function shallowWaterBenchmark(compute:GpuCompute,sizes:readonly number[],steps:number,cpuLimit:number,progress:(text:string)=>void):Promise<BenchRow[]> {
  const rows:BenchRow[]=[];
  for(const n of sizes){
    progress(`shallow water: timing ${n} x ${n}`);
    const options=floodValley(n);
    const solver=await GpuShallowWater.create(compute,new ShallowWater(options),{rateLatency:2});
    await solver.step(3);await solver.read();
    const before=solver.stats.totalSubsteps,t0=performance.now();
    await solver.step(steps);await solver.sync();
    await solver.compute.read([{buffer:solver.stateBuffer,size:16}]);
    const ms=(performance.now()-t0)/steps,substeps=solver.stats.totalSubsteps-before;
    solver.destroy();
    let cpu:number|null=null;
    if(n*n<=cpuLimit){const w=new ShallowWater(options);w.step(3);const c0=performance.now(),k=Math.max(2,Math.min(steps,Math.round(2e6/(n*n))));w.step(k);cpu=(performance.now()-c0)/k;}
    rows.push({backend:'shallow water',size:`${n} x ${n}`,elements:n*n,steps,substeps,msPerStep:ms,elementUpdatesPerSecond:n*n*substeps/(ms*steps/1000),cpuMsPerStep:cpu,speedup:cpu===null?null:cpu/ms});
  }
  return rows;
}
// ---- grains -------------------------------------------------------------------------------------------------------------
export interface GranularAgreement {name:string;steps:number;grains:number;walls:number;
  /** Largest position difference over the mean radius, and largest velocity difference over the largest speed. */
  gpuVsF32:{position:number;velocity:number};gpuVsF64:{position:number;velocity:number};
  /** |change of the grains' momentum + the walls' impulses - M g t| over M |g| t (grains that left the bounds are in neither). */
  momentumRelative:number;
  repeat:{identical:boolean;hash:string};stats:DemStats}
function grainDifference(pos:Float32Array,vel:Float32Array,n:number,x:ArrayLike<number>,v:ArrayLike<number>,stride:number,radius:number):{position:number;velocity:number} {
  let dp=0,dv=0,top=0;
  for(let i=0;i<n;i++){
    if(pos[4*i+3]<=0)continue;
    for(let k=0;k<3;k++){dp=Math.max(dp,Math.abs(pos[4*i+k]-x[stride*i+k]));dv=Math.max(dv,Math.abs(vel[4*i+k]-v[stride*i+k]));top=Math.max(top,Math.abs(vel[4*i+k]));}
  }
  return {position:dp/radius,velocity:dv/Math.max(top,1e-300)};
}
function momentumBalance(start:Granular,snap:GpuGranularSnapshot,steps:number):number {
  // Only meaningful while no grain has left and no wall moves on its own account; it is reported for the box.
  const n=snap.count,g=start.gravity,t=steps*start.dt;let mass=0;const p=[0,0,0],p0=start.linearMomentum([0,0,0]);
  for(let i=0;i<n;i++){if(snap.pos[4*i+3]<=0)return NaN;const m=snap.vel[4*i+3];mass+=m;for(let k=0;k<3;k++)p[k]+=m*snap.vel[4*i+k];}
  const impulse=[0,0,0];for(let w=0;w<start.wallCount;w++){const wall=readDemWall(snap.walls,w);for(let k=0;k<3;k++)impulse[k]+=wall.impulse[k];}
  let worst=0;for(let k=0;k<3;k++)worst=Math.max(worst,Math.abs(p[k]-p0[k]+impulse[k]-mass*g[k]*t));
  return worst/(mass*Math.hypot(g[0],g[1],g[2])*t);
}
async function granularAgreement(compute:GpuCompute,progress:(text:string)=>void):Promise<GranularAgreement[]> {
  const out:GranularAgreement[]=[];
  for(const [name,make] of Object.entries(GRANULAR_SETUPS)){
    progress(`grains: agreement on "${name}"`);
    const {granular,steps}=make(),radius=granular.radii.subarray(0,granular.grainCount).reduce((a,b)=>a+b,0)/granular.grainCount;
    const run=async():Promise<{snap:GpuGranularSnapshot;stats:DemStats}>=>{const gpu=await GpuGranular.fromGranular(compute,make().granular);await gpu.step(steps);const snap=await gpu.read(),stats={...gpu.stats};gpu.destroy();return {snap,stats};};
    const a=await run(),b=await run();
    const f32=new GranularF32(make().granular);f32.step(steps);
    const f64=make().granular;f64.step(steps);
    out.push({name,steps,grains:granular.grainCount,walls:granular.wallCount,gpuVsF32:grainDifference(a.snap.pos,a.snap.vel,a.snap.count,f32.pos,f32.vel,4,radius),gpuVsF64:grainDifference(a.snap.pos,a.snap.vel,a.snap.count,f64.positions,f64.velocities,3,radius),
      momentumRelative:momentumBalance(granular,a.snap,steps),repeat:{identical:fnv(a.snap.pos,a.snap.vel,a.snap.spin,a.snap.walls)===fnv(b.snap.pos,b.snap.vel,b.snap.spin,b.snap.walls),hash:fnv(a.snap.pos,a.snap.vel,a.snap.spin,a.snap.walls)},stats:a.stats});
  }
  return out;
}
async function granularDeviceLoss():Promise<DeviceLossResult> {
  const compute=await acquireGpuCompute({label:'box3d device-loss check'}),{granular}=GRANULAR_SETUPS['bead-box']();
  const runner=await GranularRunner.create(granular,compute,{snapshotEvery:100}),before=runner.backend;
  await runner.step(250);
  compute.device.destroy();
  await compute.device.lost;
  await runner.step(150);
  const reference=GRANULAR_SETUPS['bead-box']().granular;reference.step(400);
  // Trajectories of many grains part ways; what must agree is the bulk: the height of the centre of mass.
  const height=(g:Granular):number=>{let s=0,m=0;for(let i=0;i<g.grainCount;i++){s+=g.masses[i]*g.positions[3*i+1];m+=g.masses[i];}return s/m;};
  return {backendBefore:before,backendAfter:runner.backend,reason:runner.fallback?.reason??'',stepsRerun:runner.fallback?.stepsRerun??-1,resumedFrom:runner.fallback?.resumedFrom??-1,time:runner.time,steps:runner.steps,vsF64:Math.abs(height(granular)/height(reference)-1)};
}
/** The closed-form set-ups on the GPU, run from a worker that blocks on this page (scenario-worker.ts). */
function granularCasesOnGpu(compute:GpuCompute,options:{only?:readonly string[];quick?:boolean},progress:(text:string)=>void):Promise<GranularCaseRun> {
  if(typeof SharedArrayBuffer==='undefined'||!(globalThis as {crossOriginIsolated?:boolean}).crossOriginIsolated)return Promise.reject(new EngineError('GPU_UNAVAILABLE','The granular closed-form cases need a cross-origin isolated page (SharedArrayBuffer): open the page through scripts/gpu-compute-browser-check.mjs.'));
  const worker=new Worker(new URL('./scenario-worker.ts',import.meta.url),{type:'module'});
  const solvers=new Map<number,{gpu:GpuGranular;control:Int32Array;pos:Float32Array;vel:Float32Array;spin:Float32Array;walls:Float32Array;stats:Float64Array;message:Uint8Array}>();
  const KEYS=['steps','contacts','wallContacts','overlap','maxOverlap','removed','bucketOverflow','historyOverflow'] as const;
  return new Promise<GranularCaseRun>((resolve,reject)=>{
    const finish=(work:()=>void):void=>{for(const s of solvers.values())s.gpu.destroy();solvers.clear();worker.terminate();work();};
    let chain=Promise.resolve();
    const handle=async(data:Record<string,any>):Promise<void>=>{
      const id=data.id as number;
      if(data.op==='destroy'){solvers.get(id)?.gpu.destroy();solvers.delete(id);return;}
      let entry=solvers.get(id);
      const B=data.buffers as Record<string,SharedArrayBuffer>|undefined;
      const control=entry?entry.control:new Int32Array(B!.control),message=entry?entry.message:new Uint8Array(B!.message);
      try{
        if(data.op==='create'){
          const gpu=await GpuGranular.create(compute,data.setup as DemSetup);
          entry={gpu,control,message,pos:new Float32Array(B!.pos),vel:new Float32Array(B!.vel),spin:new Float32Array(B!.spin),walls:new Float32Array(B!.walls),stats:new Float64Array(B!.stats)};
          solvers.set(id,entry);
        }else if(data.op==='upload'){
          const gpu=entry!.gpu,setup=gpu.setup;
          if(data.pos){setup.pos.set(data.pos as Float32Array);setup.vel.set(data.vel as Float32Array);setup.spin.set(data.spin as Float32Array);setup.count=data.count as number;}
          if(data.walls)new Uint8Array(setup.walls).set(new Uint8Array(data.walls as ArrayBuffer));
          gpu.upload(data.what as {grains:boolean;walls:boolean});
        }else if(data.op==='step'){
          const e=entry!;await e.gpu.step(data.count as number);
          const snap=await e.gpu.read();
          e.pos.set(snap.pos.subarray(0,4*snap.count));e.vel.set(snap.vel.subarray(0,4*snap.count));e.spin.set(snap.spin.subarray(0,4*snap.count));e.walls.set(snap.walls);
          KEYS.forEach((key,k)=>{e.stats[k]=e.gpu.stats[key];});
        }
        Atomics.store(control,0,1);
      }catch(error){
        const text=new TextEncoder().encode(error instanceof Error?error.message:String(error)).slice(0,2000);
        message.set(text);Atomics.store(control,1,text.length);Atomics.store(control,0,2);
      }
      Atomics.notify(control,0);
    };
    worker.onmessage=(event:MessageEvent):void=>{
      const data=event.data as Record<string,any>;
      if(data.type==='progress')progress(`grains: closed-form set-up "${data.name}"`);
      else if(data.type==='done')finish(()=>resolve(data.result as GranularCaseRun));
      else if(data.type==='failed')finish(()=>reject(new Error(data.message as string)));
      else if(data.type==='dem')chain=chain.then(()=>handle(data));
    };
    worker.onerror=(event):void=>finish(()=>reject(new Error(`The scenario worker failed: ${event.message}`)));
    worker.postMessage({type:'run',only:options.only,quick:options.quick});
  });
}
/** A sand avalanche behind its gate, then released: time `steps` steps on the GPU (one wait at the end) and on the CPU. */
async function granularBenchmark(sizes:readonly number[],steps:number,cpuLimit:number,progress:(text:string)=>void):Promise<BenchRow[]> {
  const rows:BenchRow[]=[];
  for(const count of sizes){
    progress(`grains: timing ${count}`);
    const made=sandAvalanche(count),n=made.granular.grainCount,memory=demMemory(n,{rolling:true,walls:made.granular.wallCount});
    let compute:GpuCompute;
    try{compute=await acquireGpuCompute({label:'box3d grain timing',storageBytes:memory.largest});}
    catch(error){rows.push({backend:`grains (skipped: ${error instanceof Error?error.message:String(error)})`,size:String(n),elements:n,steps:0,substeps:0,msPerStep:NaN,elementUpdatesPerSecond:NaN,cpuMsPerStep:null,speedup:null});continue;}
    const gpu=await GpuGranular.fromGranular(compute,made.granular);
    await gpu.step(20);await gpu.sync();
    const t0=performance.now();await gpu.step(steps);await gpu.sync();
    const ms=(performance.now()-t0)/steps;
    gpu.destroy();compute.destroy();compute.device.destroy();
    let cpu:number|null=null;
    if(n<=cpuLimit){const g=sandAvalanche(count).granular;g.step(20);const k=Math.max(5,Math.min(steps,Math.round(4e5/n))),c0=performance.now();g.step(k);cpu=(performance.now()-c0)/k;}
    rows.push({backend:`grains (${made.stepsPerSecond} steps per simulated second)`,size:String(n),elements:n,steps,substeps:steps,msPerStep:ms,elementUpdatesPerSecond:n/(ms/1000),cpuMsPerStep:cpu,speedup:cpu===null?null:cpu/ms});
  }
  return rows;
}

// ---- incompressible flow ----------------------------------------------------------------------------------------------
export interface FluidAgreement {name:string;steps:number;cells:number;
  /** Largest velocity difference over the largest speed; largest pressure difference over the largest |p|. */
  gpuVsF32:{velocity:number;pressure:number};gpuVsF64:{velocity:number;pressure:number};
  /** Largest relative divergence the GPU left (max |div u| h / max |u|). */
  divergence:number;pressureIterations:number;viscousIterations:number;repeat:{identical:boolean;hash:string};
  /** With an obstacle: its force after the last step on the GPU, and the differences over its magnitude (the bits: 0 when identical). */
  force?:{gpu:number[];vsF32:number;vsF64:number;identicalToF32:boolean}}
function fluidDifference(a:{u:ArrayLike<number>;v:ArrayLike<number>;w:ArrayLike<number>;p:ArrayLike<number>},b:{u:ArrayLike<number>;v:ArrayLike<number>;w:ArrayLike<number>;p:ArrayLike<number>}):{velocity:number;pressure:number} {
  let dv=0,top=0,dp=0,ptop=0;
  for(const k of ['u','v','w'] as const){const x=a[k],y=b[k];for(let i=0;i<y.length;i++){dv=Math.max(dv,Math.abs(x[i]-y[i]));top=Math.max(top,Math.abs(y[i]));}}
  for(let i=0;i<b.p.length;i++){dp=Math.max(dp,Math.abs(a.p[i]-b.p[i]));ptop=Math.max(ptop,Math.abs(b.p[i]));}
  return {velocity:dv/Math.max(top,1e-300),pressure:ptop>0?dp/ptop:dp};
}
async function fluidAgreement(compute:GpuCompute,progress:(text:string)=>void):Promise<FluidAgreement[]> {
  const out:FluidAgreement[]=[];
  const forceOf=(f:Fluid):number[]=>f.obstacleCount?[...f.obstacleForce(0),...f.obstacleTorque(0)]:[];
  const gap=(a:number[],b:number[]):number=>Math.hypot(...a.slice(0,3).map((x,k)=>x-b[k]))/Math.max(Math.hypot(...b.slice(0,3)),1e-300);
  for(const [name,make] of Object.entries(FLUID_SETUPS)){
    progress(`fluid: agreement on "${name}"`);
    const {fluid,steps}=make();
    const run=async()=>{const setup=make(),gpu=await GpuFluid.create(compute,setup.fluid);for(let k=0;k<steps;k++){setup.beforeStep?.(setup.fluid,k);await gpu.step();}const s=await gpu.read(),stats={...gpu.stats};gpu.destroy();return {s,stats,force:forceOf(setup.fluid)};};
    const a=await run(),b=await run();
    const ref=make(),r=new FluidF32(ref.fluid);for(let k=0;k<steps;k++){ref.beforeStep?.(ref.fluid,k);r.step();}
    const f64=make();for(let k=0;k<steps;k++){f64.beforeStep?.(f64.fluid,k);f64.fluid.step();}
    const rf=forceOf(ref.fluid),ff=forceOf(f64.fluid);
    out.push({name,steps,cells:fluid.cells,gpuVsF32:fluidDifference(a.s,{u:r.velocity(0),v:r.velocity(1),w:r.velocity(2),p:r.pressure()}),gpuVsF64:fluidDifference(a.s,{u:f64.fluid.u,v:f64.fluid.v,w:f64.fluid.w,p:f64.fluid.p}),
      divergence:a.stats.divergence,pressureIterations:a.stats.pressureIterations,viscousIterations:a.stats.viscousIterations,
      repeat:{identical:fnv(a.s.u,a.s.v,a.s.w,a.s.p)===fnv(b.s.u,b.s.v,b.s.w,b.s.p)&&a.force.every((x,k)=>Object.is(x,b.force[k])),hash:fnv(a.s.u,a.s.v,a.s.w,a.s.p)},
      ...(a.force.length?{force:{gpu:a.force,vsF32:gap(a.force,rf),vsF64:gap(a.force,ff),identicalToF32:a.force.every((x,k)=>Object.is(x,rf[k]))}}:{})});
  }
  return out;
}
async function fluidDeviceLoss():Promise<DeviceLossResult> {
  const compute=await acquireGpuCompute({label:'box3d device-loss check'}),{fluid}=FLUID_SETUPS['taylor-green']();
  const runner=await FluidRunner.create(fluid,compute,{snapshotEvery:5}),before=runner.backend;
  await runner.step(12);
  compute.device.destroy();await compute.device.lost;
  await runner.step(8);
  const reference=FLUID_SETUPS['taylor-green']().fluid;reference.step(20);
  const d=fluidDifference(fluid,reference);
  return {backendBefore:before,backendAfter:runner.backend,reason:runner.fallback?.reason??'',stepsRerun:runner.fallback?.stepsRerun??-1,resumedFrom:runner.fallback?.resumedFrom??-1,time:runner.time,steps:runner.steps,vsF64:d.velocity};
}
function fluidCasesOnGpu(compute:GpuCompute,options:{only?:readonly string[];quick?:boolean},progress:(text:string)=>void):Promise<FluidCaseRun> {
  if(typeof SharedArrayBuffer==='undefined'||!(globalThis as {crossOriginIsolated?:boolean}).crossOriginIsolated)return Promise.reject(new EngineError('GPU_UNAVAILABLE','The fluid closed-form cases need a cross-origin isolated page (SharedArrayBuffer).'));
  const worker=new Worker(new URL('./fluid-scenario-worker.ts',import.meta.url),{type:'module'});
  const solvers=new Map<number,{gpu:GpuFluid;control:Int32Array;vel:Float32Array;pressure:Float32Array;stats:Float64Array;sums:Float64Array;message:Uint8Array}>();
  return new Promise<FluidCaseRun>((resolve,reject)=>{
    const finish=(work:()=>void):void=>{for(const e of solvers.values())e.gpu.destroy();solvers.clear();worker.terminate();work();};
    let chain=Promise.resolve();
    const handle=async(data:Record<string,any>):Promise<void>=>{
      const id=data.id as number;
      if(data.op==='destroy'){solvers.get(id)?.gpu.destroy();solvers.delete(id);return;}
      let entry=solvers.get(id);const B=data.buffers as Record<string,SharedArrayBuffer>|undefined;
      const control=entry?entry.control:new Int32Array(B!.control),message=entry?entry.message:new Uint8Array(B!.message);
      try{
        if(data.op==='create'){
          const gpu=await GpuFluid.create(compute,data.source,{velocity:data.velocity,pressure:data.pressure,time:data.time},data.options);
          entry={gpu,control,message,vel:new Float32Array(B!.vel),pressure:new Float32Array(B!.pressure),stats:new Float64Array(B!.stats),sums:new Float64Array(B!.sums)};solvers.set(id,entry);
        }else if(data.op==='load')entry!.gpu.load(data.velocity,data.pressure);
        else if(data.op==='step'){
          if(data.band)entry!.gpu.setObstacles(data.band);
          await entry!.gpu.step(data.count as number);
          const sums=entry!.gpu.obstacleSums;
          if(sums){const O=sums.J.length/6;entry!.sums.set(sums.J,0);entry!.sums.set(sums.M,6*O);if(sums.Mstart)entry!.sums.set(sums.Mstart,12*O);entry!.sums[18*O]=sums.Mstart?1:0;}
        }
        else if(data.op==='project')await entry!.gpu.project();
        const e=entry!,s=await e.gpu.read(),P=e.gpu.padded;
        e.vel.set(s.u,0);e.vel.set(s.v,P);e.vel.set(s.w,2*P);e.pressure.set(s.p);
        const st=e.gpu.stats;e.stats[0]=st.pressureIterations;e.stats[1]=st.viscousIterations;e.stats[2]=st.divergence;e.stats[3]=st.unconverged;
        Atomics.store(control,0,1);
      }catch(error){const text=new TextEncoder().encode(error instanceof Error?error.message:String(error)).slice(0,2000);message.set(text);Atomics.store(control,1,text.length);Atomics.store(control,0,2);}
      Atomics.notify(control,0);
    };
    worker.onmessage=(event:MessageEvent):void=>{
      const data=event.data as Record<string,any>;
      if(data.type==='progress')progress(`fluid: closed-form set-up "${data.name}"`);
      else if(data.type==='done')finish(()=>resolve(data.result as FluidCaseRun));
      else if(data.type==='failed')finish(()=>reject(new Error(data.message as string)));
      else if(data.type==='fluid')chain=chain.then(()=>handle(data));
    };
    worker.onerror=(event):void=>finish(()=>reject(new Error(`The fluid worker failed: ${event.message}`)));
    worker.postMessage({type:'run',only:options.only,quick:options.quick});
  });
}
/**
 * Per size n: a cubic lid-driven cavity of n^3 cells (backward Euler) and the flow through a periodic array of spheres
 * (one fixed sphere of radius 0.15 L, its band uploaded every step, backward Euler): ms per step on the GPU and on the
 * float64 solver.
 */
async function fluidBenchmark(compute:GpuCompute,sizes:readonly number[],steps:number,cpuLimit:number,progress:(text:string)=>void):Promise<BenchRow[]> {
  const rows:BenchRow[]=[];
  const cases:[string,(n:number)=>Fluid][]=[['cavity',cavity3d],['sphere array',sphereArray]];
  for(const n of sizes)for(const [label,make] of cases){
    progress(`fluid: timing ${label} ${n}^3`);
    let gpu:GpuFluid;
    try{gpu=await GpuFluid.create(compute,make(n));}
    catch(error){rows.push({backend:`fluid ${label} (skipped: ${error instanceof Error?error.message:String(error)})`,size:`${n}^3`,elements:n**3,steps:0,substeps:0,msPerStep:NaN,elementUpdatesPerSecond:NaN,cpuMsPerStep:null,speedup:null});continue;}
    await gpu.step(3);
    const t0=performance.now();await gpu.step(steps);const ms=(performance.now()-t0)/steps,it=gpu.stats.pressureIterations,vit=gpu.stats.viscousIterations;
    gpu.destroy();
    let cpu:number|null=null;
    if(n**3<=cpuLimit){const f=make(n);f.step(3);const c0=performance.now();f.step(Math.max(2,Math.min(steps,4)));cpu=(performance.now()-c0)/Math.max(2,Math.min(steps,4));}
    rows.push({backend:`fluid ${label} (${it} pressure, ${vit} viscous iterations a step)`,size:`${n}^3`,elements:n**3,steps,substeps:steps,msPerStep:ms,elementUpdatesPerSecond:n**3/(ms/1000),cpuMsPerStep:cpu,speedup:cpu===null?null:cpu/ms});
  }
  return rows;
}

// ---- checkpoints -------------------------------------------------------------------------------------------------------
export interface CheckpointCheck {backend:string;setup:string;steps:number;at:number;bytes:number;
  /** A GPU run checkpointed at `at`, restored into a fresh GPU backend and taken on: the same bits as the straight GPU run. */
  gpuResumed:boolean;
  /** The same checkpoint restored into the float32 reference and taken on: the same bits as the straight GPU run (the reference and the GPU agree bit for bit on this set-up). */
  referenceResumed:boolean;
  /** The largest difference between the reference's continuation and the GPU's, over the largest value (0 when identical). */
  referenceDifference:number}
const maxDiff=(a:ArrayLike<number>,b:ArrayLike<number>):number=>{let d=0,t=0;for(let i=0;i<b.length;i++){d=Math.max(d,Math.abs(a[i]-b[i]));t=Math.max(t,Math.abs(b[i]));}return t>0?d/t:d;};
async function checkpointChecks(compute:GpuCompute,progress:(text:string)=>void):Promise<CheckpointCheck[]> {
  const out:CheckpointCheck[]=[];
  {
    progress('checkpoints: shallow water (Thacker)');
    const {options,steps}=SHALLOW_WATER_SETUPS.thacker(),at=Math.floor(steps/2);
    const straight=await GpuShallowWater.create(compute,new ShallowWater(options));await straight.step(steps);const s=await straight.read();straight.destroy();
    const a=await GpuShallowWater.create(compute,new ShallowWater(options));await a.step(at);const bytes=await a.checkpoint();a.destroy();
    const b=await GpuShallowWater.create(compute,new ShallowWater(options));b.restoreCheckpoint(bytes);await b.step(steps-at);const sb=await b.read();b.destroy();
    const r=new ShallowWaterF32(new ShallowWater(options));r.restoreCheckpoint(bytes);r.step(steps-at);
    out.push({backend:'shallow water',setup:'thacker',steps,at,bytes:bytes.length,gpuResumed:fnv(sb.state,sb.aux)===fnv(s.state,s.aux),referenceResumed:fnv(r.state,r.aux)===fnv(s.state,s.aux),referenceDifference:maxDiff(r.state,s.state)});
  }
  {
    progress('checkpoints: grains (bead box)');
    const steps=400,at=150,make=():Granular=>GRANULAR_SETUPS['bead-box']().granular;
    const straight=await GpuGranular.fromGranular(compute,make());await straight.step(steps);const s=await straight.read();straight.destroy();
    const a=await GpuGranular.fromGranular(compute,make());await a.step(at);const bytes=await a.checkpoint();a.destroy();
    const b=await GpuGranular.fromGranular(compute,make());b.restoreCheckpoint(bytes);await b.step(steps-at);const sb=await b.read();b.destroy();
    const r=new GranularF32(make());r.restoreCheckpoint(bytes);r.step(steps-at);
    const n=4*s.count;
    out.push({backend:'grains',setup:'bead-box',steps,at,bytes:bytes.length,gpuResumed:fnv(sb.pos,sb.vel,sb.spin)===fnv(s.pos,s.vel,s.spin),referenceResumed:fnv(r.pos.subarray(0,n),r.vel.subarray(0,n),r.spin.subarray(0,n))===fnv(s.pos,s.vel,s.spin),referenceDifference:maxDiff(r.pos.subarray(0,n),s.pos)});
  }
  for(const name of ['cavity-3d','moving-sphere']){
    progress(`checkpoints: fluid (${name})`);
    const make=FLUID_SETUPS[name],{steps}=make(),at=Math.floor(steps/2);
    const drive=async(setup:ReturnType<typeof make>,step:()=>Promise<void>|void,from:number,to:number)=>{for(let k=from;k<to;k++){setup.beforeStep?.(setup.fluid,k);await step();}};
    const st=make(),straight=await GpuFluid.create(compute,st.fluid);await drive(st,()=>straight.step(),0,steps);const s=await straight.read();straight.destroy();
    const a=make(),ga=await GpuFluid.create(compute,a.fluid);await drive(a,()=>ga.step(),0,at);const bytes=await ga.checkpoint(),host=a.fluid.saveState();ga.destroy();
    const b=make();b.fluid.restoreState(host);const gb=await GpuFluid.create(compute,b.fluid);gb.restoreCheckpoint(bytes);await drive(b,()=>gb.step(),at,steps);const sb=await gb.read();gb.destroy();
    const c=make();c.fluid.restoreState(host);const r=new FluidF32(c.fluid);r.restoreCheckpoint(bytes);await drive(c,()=>r.step(),at,steps);
    const ru=r.velocity(0),rv=r.velocity(1),rw=r.velocity(2),rp=r.pressure();
    out.push({backend:'fluid',setup:name,steps,at,bytes:bytes.length,gpuResumed:fnv(sb.u,sb.v,sb.w,sb.p)===fnv(s.u,s.v,s.w,s.p),
      referenceResumed:fnv(ru,rv,rw,rp)===fnv(s.u,s.v,s.w,s.p),referenceDifference:Math.max(maxDiff(ru,s.u),maxDiff(rv,s.v),maxDiff(rw,s.w))});
  }
  return out;
}

export interface GpuValidationReport {
  info:GpuComputeInfo;userAgent:string;
  shallowWater:{cases:GpuCaseRow[];runs:Record<string,unknown>;agreement:ShallowWaterAgreement[];deviceLoss:DeviceLossResult}|null;
  granular:{cases:GpuCaseRow[];runs:Record<string,unknown>;agreement:GranularAgreement[];deviceLoss:DeviceLossResult;casesSkipped:string|null}|null;
  fluid:{cases:GpuCaseRow[];runs:Record<string,unknown>;agreement:FluidAgreement[];deviceLoss:DeviceLossResult;casesSkipped:string|null}|null;
  checkpoints:CheckpointCheck[]|null;
  seconds:number;
}
export interface GpuProbeOptions {readonly only?:readonly string[];readonly progress?:(text:string)=>void;
  /** false: skip the closed-form cases. 'quick': the granular cases that take seconds only. */
  readonly cases?:boolean|'quick';readonly shallowWater?:boolean;readonly granular?:boolean;readonly fluid?:boolean;readonly checkpoints?:boolean}

async function validate(options:GpuProbeOptions={}):Promise<GpuValidationReport> {
  const progress=options.progress??(()=>{}),started=performance.now();
  const compute=await acquireGpuCompute({label:'box3d compute validation'});
  let shallowWater:GpuValidationReport['shallowWater']=null,granular:GpuValidationReport['granular']=null,fluid:GpuValidationReport['fluid']=null;
  if(options.shallowWater!==false){
    const agreement=await shallowWaterAgreement(compute,progress);
    const cases=options.cases===false?{rows:[],runs:{}}:await runShallowWaterCases(swScenarios,gpuBackend(compute),{only:options.only,progress:name=>progress(`shallow water: closed-form set-up "${name}"`)});
    progress('shallow water: device loss');
    shallowWater={cases:cases.rows,runs:cases.runs,agreement,deviceLoss:await shallowWaterDeviceLoss()};
  }
  if(options.granular!==false){
    const agreement=await granularAgreement(compute,progress);
    let cases:GranularCaseRun={rows:[],runs:{}},casesSkipped:string|null=null;
    if(options.cases!==false){try{cases=await granularCasesOnGpu(compute,{only:options.only,quick:options.cases==='quick'},progress);}catch(error){if(error instanceof EngineError&&error.code==='GPU_UNAVAILABLE')casesSkipped=error.message;else throw error;}}
    progress('grains: device loss');
    granular={cases:cases.rows,runs:cases.runs,agreement,deviceLoss:await granularDeviceLoss(),casesSkipped};
  }
  if(options.fluid!==false){
    const agreement=await fluidAgreement(compute,progress);
    let cases:FluidCaseRun={rows:[],runs:{}},casesSkipped:string|null=null;
    if(options.cases!==false){try{cases=await fluidCasesOnGpu(compute,{only:options.only,quick:options.cases==='quick'},progress);}catch(error){if(error instanceof EngineError&&error.code==='GPU_UNAVAILABLE')casesSkipped=error.message;else throw error;}}
    progress('fluid: device loss');
    fluid={cases:cases.rows,runs:cases.runs,agreement,deviceLoss:await fluidDeviceLoss(),casesSkipped};
  }
  const checkpoints=options.checkpoints===false?null:await checkpointChecks(compute,progress);
  compute.destroy();
  return {info:compute.info,userAgent:navigator.userAgent,shallowWater,granular,fluid,checkpoints,seconds:(performance.now()-started)/1000};
}
async function benchmark(options:{readonly shallowWater?:readonly number[];readonly grains?:readonly number[];readonly fluid?:readonly number[];readonly steps?:number;readonly cpuLimit?:number;readonly progress?:(text:string)=>void}={}):Promise<{info:GpuComputeInfo;rows:BenchRow[]}> {
  const compute=await acquireGpuCompute({label:'box3d compute timing',storageBytes:0}),progress=options.progress??(()=>{});
  const rows=await shallowWaterBenchmark(compute,options.shallowWater??[256,512,1024],options.steps??30,options.cpuLimit??262144,progress);
  compute.destroy();compute.device.destroy();
  rows.push(...await granularBenchmark(options.grains??[10000,100000],options.steps??30,Math.min(options.cpuLimit??262144,100000),progress));
  const fluidCompute=await acquireGpuCompute({label:'box3d fluid timing'});
  rows.push(...await fluidBenchmark(fluidCompute,options.fluid??[16,32,64],Math.max(2,Math.min(options.steps??30,10)),Math.min(options.cpuLimit??262144,40000),progress));
  fluidCompute.destroy();fluidCompute.device.destroy();
  return {info:compute.info,rows};
}

/**
 * The fluid coupling rows through the Box3D WebAssembly world on the GPU (coupling-scenes.ts): each row a scene with a
 * GPU flow and a body of the world, loaded into a world of the page's box3d.wasm by the scene loader and stepped with
 * stepAsync, the flow pulled after every step.
 */
async function couplingRows(options:{readonly progress?:(text:string)=>void}={}):Promise<{info:GpuComputeInfo;result:CouplingRowsResult;rows:ReturnType<typeof couplingRowChecks>}> {
  const base=new URL('box3d/',document.baseURI).href;
  const imported=await import(/* @vite-ignore */ `${base}box3d.js`) as {default:(options:Record<string,unknown>)=>Promise<unknown>};
  const pool=new NativeWorldPool(await imported.default({locateFile:(file:string)=>`${base}${file}`}) as ConstructorParameters<typeof NativeWorldPool>[0]);
  const compute=await acquireGpuCompute({label:'box3d coupling rows'}),backends=gpuSceneBackends(compute);
  try{
    const result=await runCouplingRows(scene=>{
      const world=pool.createWorld();world.retainBodyShapes(true);
      const loaded=loadLabScene(world,scene,{gpu:backends});
      return Object.assign(loaded as unknown as CouplingRowLoad,{dispose:()=>{loaded.simulation.dispose();world.destroy();}});
    },{progress:options.progress});
    return {info:compute.info,result,rows:couplingRowChecks(result)};
  }finally{compute.destroy();compute.device.destroy();}
}

const api={supported:gpuComputeSupported,acquire:acquireGpuCompute,validate,benchmark,couplingRows,setups:SHALLOW_WATER_SETUPS,grainSetups:GRANULAR_SETUPS,floodValley,sandAvalanche,GpuShallowWater,ShallowWater,ShallowWaterF32,ShallowWaterRunner,GpuGranular,GranularF32,GranularRunner,Granular,GpuFluid,FluidF32,FluidRunner,Fluid,fluidSetups:FLUID_SETUPS,EngineError};
export type GpuProbeApi=typeof api;
declare global {interface Window {box3dGpu?:GpuProbeApi}}

// ---- the page -----------------------------------------------------------------------------------------------------------
const number=(x:number|null|undefined,digits=3):string=>x===null||x===undefined||!Number.isFinite(x)?'–':Math.abs(x)>=1e4||(x!==0&&Math.abs(x)<1e-3)?x.toExponential(digits-1):String(Number(x.toPrecision(digits)));
function table(caption:string,head:string[],rows:(string|{text:string;cls:string})[][]):HTMLTableElement {
  const t=document.createElement('table'),c=t.createCaption();c.textContent=caption;
  const tr=t.createTHead().insertRow();for(const h of head){const th=document.createElement('th');th.textContent=h;tr.append(th);}
  const body=t.createTBody();
  for(const row of rows){const r=body.insertRow();for(const cell of row){const td=r.insertCell();if(typeof cell==='string')td.textContent=cell;else{td.textContent=cell.text;td.className=cell.cls;}}}
  return t;
}
function start():void {
  window.box3dGpu=api;
  const status=document.getElementById('status'),tables=document.getElementById('tables'),bench=document.getElementById('run-bench') as HTMLButtonElement|null,valid=document.getElementById('run-validation') as HTMLButtonElement|null;
  if(!status||!tables||!bench||!valid)return;
  const say=(text:string):void=>{status.textContent=text;};
  const describe=(info:GpuComputeInfo):string=>`${info.vendor||'unknown vendor'} ${info.architecture} ${info.device} ${info.description}`.replace(/\s+/g,' ').trim()+(info.software?' (software adapter: timings are not those of a GPU)':'');
  if(!gpuComputeSupported()){say('This browser has no WebGPU: the compute backends cannot run here. The simulations use their CPU solvers.');return;}
  const guard=async(work:()=>Promise<void>):Promise<void>=>{bench.disabled=valid.disabled=true;try{await work();}catch(error){say(`Failed: ${error instanceof Error?error.message:String(error)}`);}bench.disabled=valid.disabled=false;};
  bench.onclick=()=>guard(async()=>{
    const result=await benchmark({progress:say});
    tables.prepend(table(`Timings on ${describe(result.info)}`,['backend','size','substeps','ms per step','element updates per second','CPU ms per step','GPU / CPU'],
      result.rows.map(r=>[r.backend,r.size,String(r.substeps),number(r.msPerStep),number(r.elementUpdatesPerSecond),number(r.cpuMsPerStep),r.speedup===null?'–':`${number(r.speedup)} x`])));
    say('Timed.');
  });
  valid.onclick=()=>guard(async()=>{
    const report=await validate({progress:say});
    const tol=(t:{kind:string;value:number}):string=>`${t.kind==='upper'?'≤':t.kind==='lower'?'≥':t.kind==='absolute'?'±':'± rel'} ${number(t.value)}`;
    const rows=[...(report.shallowWater?.cases??[]),...(report.granular?.cases??[]),...(report.fluid?.cases??[])];
    tables.prepend(table(`Closed forms on ${describe(report.info)}`,['case','value','reference','tolerance','float64 tolerance',''],
      rows.map(r=>[`${r.id.split('.')[0]}: ${r.title}`,number(r.value,4),number(r.reference,4),tol(r.tolerance),tol(r.float64),{text:r.pass?'pass':'MISS',cls:r.pass?'pass':'fail'}])));
    if(report.shallowWater)tables.prepend(table('Shallow water, GPU against the CPU',['set-up','cells','steps','depth vs float32','discharge vs float32','depth vs float64','volume budget','repeat run'],
      report.shallowWater.agreement.map(a=>[a.name,String(a.cells),String(a.steps),number(a.gpuVsF32.depth),number(a.gpuVsF32.discharge),number(a.gpuVsF64.depth),number(a.volumeRelative),{text:a.repeat.identical?'identical':'DIFFERS',cls:a.repeat.identical?'pass':'fail'}])));
    if(report.fluid)tables.prepend(table('Incompressible flow, GPU against the CPU',['set-up','cells','steps','velocity vs float32','velocity vs float64','divergence left','repeat run'],
      report.fluid.agreement.map(a=>[a.name,String(a.cells),String(a.steps),number(a.gpuVsF32.velocity),number(a.gpuVsF64.velocity),number(a.divergence),{text:a.repeat.identical?'identical':'DIFFERS',cls:a.repeat.identical?'pass':'fail'}])));
    if(report.granular)tables.prepend(table('Grains, GPU against the CPU',['set-up','grains','steps','position vs float32 (radii)','position vs float64 (radii)','momentum balance','repeat run'],
      report.granular.agreement.map(a=>[a.name,String(a.grains),String(a.steps),number(a.gpuVsF32.position),number(a.gpuVsF64.position),number(a.momentumRelative),{text:a.repeat.identical?'identical':'DIFFERS',cls:a.repeat.identical?'pass':'fail'}])));
    say(`Validated in ${number(report.seconds)} s.${report.granular?.casesSkipped?` ${report.granular.casesSkipped}`:''}`);
  });
  void acquireGpuCompute({label:'box3d compute probe'}).then(compute=>{say(`Adapter: ${describe(compute.info)}`);compute.device.destroy();bench.disabled=valid.disabled=false;},error=>say(error instanceof Error?error.message:String(error)));
}
if(typeof document!=='undefined')start();
