/**
 * Runs the shallow-water validation set-ups (packages/box3d-kit/test/shallow-water-scenarios.mjs, the ones the float64
 * solver is tested with) on another backend, unchanged.
 *
 * A set-up builds a `ShallowWater`, steps it and measures it against a closed form. `runShallowWaterScenario` runs the
 * set-up three times: once with a stand-in that only counts the steps of each solver the set-up builds; then the real
 * backend (float32 on the CPU, or WebGPU) for that many steps, keeping the state after every step; then the set-up again
 * on a ShallowWater that replays those states. The measurement code is therefore the float64 test's own.
 * A set-up that couples rigid bodies cannot be replayed (the backend does not couple bodies).
 */
import {ShallowWater,type ShallowWaterOptions} from '../shallow-water.ts';
import * as shallowWaterModule from '../shallow-water.ts';
import {ShallowWaterF32} from './shallow-water-f32.ts';
import {GpuShallowWater} from './shallow-water-gpu.ts';
import type {GpuCompute} from './compute.ts';

interface Frame {h:Float64Array;qx:Float64Array;qz:Float64Array;infiltrated:Float64Array;time:number;substeps:number;totalSubsteps:number;courant:number;maxWaveSpeed:number;wet:number;
  inflow:number;rain:number;infiltratedVolume:number;clipped:number;error:number;volume:number}
/** Something that advances one step and returns the state after it. */
export interface ShallowWaterRecorder {step():Promise<Frame>|Frame;finish?():Promise<void>|void;readonly maxCourant?:number}
export type ShallowWaterBackendFactory=(water:ShallowWater)=>Promise<ShallowWaterRecorder>|ShallowWaterRecorder;

/** The float32 CPU reference as a recorder. */
export const f32Backend:ShallowWaterBackendFactory=water=>{
  const solver=new ShallowWaterF32(water),n=solver.cells;let worst=0;
  return {
    get maxCourant(){return worst;},
    step(){
      solver.step();if(solver.stats.courant>worst)worst=solver.stats.courant;
      const h=new Float64Array(n),qx=new Float64Array(n),qz=new Float64Array(n),infiltrated=new Float64Array(n),U=solver.state,A=solver.aux;
      for(let c=0;c<n;c++){h[c]=Math.max(0,U[4*c]+U[4*c+3]);qx[c]=U[4*c+1];qz[c]=U[4*c+2];infiltrated[c]=A[4*c];}
      const L=solver.ledger();
      return {h,qx,qz,infiltrated,time:solver.time,...solver.stats,wet:solver.stats.wetCells,inflow:L.inflow,rain:L.rain,infiltratedVolume:L.infiltrated,clipped:L.clipped,error:solver.volumeError(),volume:solver.volume()};
    },
  };
};
/** The WebGPU backend as a recorder (one full readback per step: for validation, not for speed). */
export const gpuBackend=(compute:GpuCompute,options:{readonly rateLatency?:number;readonly safety?:number}={}):ShallowWaterBackendFactory=>async water=>{
  const solver=await GpuShallowWater.create(compute,water,options),n=solver.cells;
  return {
    get maxCourant(){return solver.maxCourant;},
    async step(){
      await solver.step();
      const snap=await solver.read();await solver.sync();
      const h=new Float64Array(n),qx=new Float64Array(n),qz=new Float64Array(n),infiltrated=new Float64Array(n),U=snap.state,A=snap.aux;
      for(let c=0;c<n;c++){h[c]=Math.max(0,U[4*c]+U[4*c+3]);qx[c]=U[4*c+1];qz[c]=U[4*c+2];infiltrated[c]=A[4*c];}
      const B=solver.budget(snap);
      return {h,qx,qz,infiltrated,time:snap.time,...solver.stats,wet:solver.stats.wetCells,inflow:B.inflow,rain:B.rain,infiltratedVolume:B.infiltrated,clipped:B.clipped,error:B.error,volume:B.volume};
    },
    finish(){solver.destroy();},
  };
};

type Kit=Record<string,unknown>&{ShallowWater:typeof ShallowWater};
export interface ShallowWaterScenarioRun<R> {readonly result:R;readonly steps:number;readonly substeps:number;readonly maxCourant:number;readonly seconds:number}
/**
 * Run `scenario(K)` (a function of shallow-water-scenarios.mjs, already bound to its arguments) on `backend`.
 * `K` is given the closed forms of shallow-water.ts and a ShallowWater that replays the backend.
 */
export async function runShallowWaterScenario<R>(scenario:(K:Kit)=>R,backend:ShallowWaterBackendFactory):Promise<ShallowWaterScenarioRun<R>> {
  const base=shallowWaterModule as unknown as Kit;
  // 1. Count the steps of each solver the set-up builds.
  const built:{options:ShallowWaterOptions;steps:number}[]=[];
  class Counting extends ShallowWater {
    private readonly entry:{options:ShallowWaterOptions;steps:number};
    constructor(options:ShallowWaterOptions) {super(options);this.entry={options,steps:0};built.push(this.entry);}
    override step(count=1):void {this.entry.steps+=count;this.time+=count*this.dt;}
    override advance():void {throw new Error('A replayed set-up must use step().');}
  }
  try{scenario({...base,ShallowWater:Counting as unknown as typeof ShallowWater});}catch{/* the counting pass's results are meaningless */}
  // 2. Run the backend for those steps, keeping every state.
  const started=performance.now(),runs:Frame[][]=[];let substeps=0,steps=0,maxCourant=0;
  for(const entry of built){
    const recorder=await backend(new ShallowWater(entry.options)),frames:Frame[]=[];
    for(let s=0;s<entry.steps;s++)frames.push(await recorder.step());
    await recorder.finish?.();
    runs.push(frames);steps+=entry.steps;substeps+=frames.length?frames[frames.length-1].totalSubsteps:0;maxCourant=Math.max(maxCourant,recorder.maxCourant??0);
  }
  const seconds=(performance.now()-started)/1000;
  // 3. Replay.
  let next=0;
  class Replay extends ShallowWater {
    private readonly frames:Frame[];private at=0;
    constructor(options:ShallowWaterOptions) {super(options);this.frames=runs[next++];}
    override step(count=1):void {
      for(let k=0;k<count;k++){
        const frame=this.frames[this.at++];if(!frame)throw new Error('The replay ran past the recorded steps.');
        this.h.set(frame.h);this.qx.set(frame.qx);this.qz.set(frame.qz);this.infiltrated.set(frame.infiltrated);this.time=frame.time;this.steps++;
        const S=this.stats,L=this.ledger;
        S.substeps=frame.substeps;S.totalSubsteps=frame.totalSubsteps;S.courant=frame.courant;S.maxWaveSpeed=frame.maxWaveSpeed;S.wetCells=frame.wet;
        // The budget error of the replayed solver is the backend's own: what the copy to float64 changed goes to `clipped`.
        L.inflow=frame.inflow;L.rain=frame.rain;L.infiltrated=frame.infiltratedVolume;L.sources=0;L.displaced=0;L.clipped=0;
        L.clipped=this.volumeError()-frame.error;
      }
    }
    override advance():void {throw new Error('A replayed set-up must use step().');}
  }
  const result=scenario({...base,ShallowWater:Replay as unknown as typeof ShallowWater});
  return {result,steps,substeps,maxCourant,seconds};
}

/** Largest |a - b| of the depth and of the discharges over two frames, with the largest depth and discharge of `b`. */
export function shallowWaterDifference(a:{h:ArrayLike<number>;qx:ArrayLike<number>;qz:ArrayLike<number>},b:{h:ArrayLike<number>;qx:ArrayLike<number>;qz:ArrayLike<number>}):{depth:number;discharge:number;maxDepth:number;maxDischarge:number} {
  let depth=0,discharge=0,maxDepth=0,maxDischarge=0;
  for(let c=0;c<b.h.length;c++){
    depth=Math.max(depth,Math.abs(a.h[c]-b.h[c]));discharge=Math.max(discharge,Math.abs(a.qx[c]-b.qx[c]),Math.abs(a.qz[c]-b.qz[c]));
    maxDepth=Math.max(maxDepth,Math.abs(b.h[c]));maxDischarge=Math.max(maxDischarge,Math.abs(b.qx[c]),Math.abs(b.qz[c]));
  }
  return {depth,discharge,maxDepth,maxDischarge};
}
