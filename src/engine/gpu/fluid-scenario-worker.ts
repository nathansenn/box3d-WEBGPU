/**
 * Runs the fluid validation set-ups against the GPU from a worker: the set-ups are synchronous, so the proxy's remote
 * posts each request to the page (which owns the device, probe.ts) and blocks on a shared buffer until the page has
 * written the velocity, the pressure and the statistics back. The page must be cross-origin isolated.
 */
import * as scenarios from '../../../packages/box3d-kit/test/fluid-scenarios.mjs';
import * as fluidModule from '../fluid.ts';
import type {Fluid} from '../fluid.ts';
import {runFluidCases} from './fluid-cases.ts';
import {fluidProxy,type FluidFrame,type FluidRemote} from './fluid-proxy.ts';
import {fluidProgramSource,type FluidBackendOptions} from './fluid-program.ts';

const scope=self as unknown as {postMessage(message:unknown):void;onmessage:((event:MessageEvent)=>void)|null};
let nextId=1;
export const FLUID_STAT_KEYS=['pressureIterations','viscousIterations','divergence','unconverged'] as const;

function pageRemote():FluidRemote {
  const id=nextId++;
  let control:Int32Array|null=null,vel:Float32Array,pressure:Float32Array,stats:Float64Array,message:Uint8Array,P=0;
  const call=(body:Record<string,unknown>):void=>{
    const c=control!;
    Atomics.store(c,0,0);
    scope.postMessage({type:'fluid',id,...body});
    while(Atomics.load(c,0)===0)Atomics.wait(c,0,0,1000);
    if(Atomics.load(c,0)===2){const length=Atomics.load(c,1);throw new Error(`GPU backend: ${new TextDecoder().decode(message.slice(0,length))}`);}
  };
  return {
    create(fluid:Fluid,options:FluidBackendOptions){
      const source=fluidProgramSource(fluid);P=source.description.size;
      const shared=(bytes:number):SharedArrayBuffer=>new SharedArrayBuffer(Math.max(8,bytes));
      const buffers={control:shared(8),vel:shared(12*P),pressure:shared(4*fluid.cells),stats:shared(8*FLUID_STAT_KEYS.length),message:shared(2048)};
      control=new Int32Array(buffers.control);vel=new Float32Array(buffers.vel);pressure=new Float32Array(buffers.pressure);stats=new Float64Array(buffers.stats);message=new Uint8Array(buffers.message);
      call({op:'create',source,options,velocity:fluid.vel.map(x=>Float32Array.from(x)),pressure:Float32Array.from(fluid.p),time:fluid.time,buffers});
    },
    load(fluid:Fluid){call({op:'load',velocity:fluid.vel.map(x=>Float32Array.from(x)),pressure:Float32Array.from(fluid.p)});},
    step(count:number){call({op:'step',count});},
    project(){call({op:'project'});},
    read():FluidFrame {
      return {u:vel.subarray(0,P),v:vel.subarray(P,2*P),w:vel.subarray(2*P,3*P),p:pressure,stats:{pressureIterations:stats[0],viscousIterations:stats[1],divergence:stats[2],unconverged:stats[3]}};
    },
    destroy(){scope.postMessage({type:'fluid',id,op:'destroy'});},
  };
}

scope.onmessage=(event:MessageEvent):void=>{
  const data=event.data as {type:string;only?:string[];quick?:boolean};
  if(data.type!=='run')return;
  try{
    const K={...(fluidModule as unknown as Record<string,unknown>),Fluid:fluidProxy(pageRemote)};
    const result=runFluidCases(scenarios,K,{only:data.only,quick:data.quick,progress:name=>scope.postMessage({type:'progress',name})});
    scope.postMessage({type:'done',result});
  }catch(error){scope.postMessage({type:'failed',message:error instanceof Error?`${error.message}\n${error.stack??''}`:String(error)});}
};
