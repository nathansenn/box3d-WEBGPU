/**
 * Runs the granular validation set-ups against the GPU from a worker.
 *
 * The set-ups are synchronous code (packages/box3d-kit/test/granular-scenarios.mjs). The GPU is asynchronous. Here the
 * proxy's remote posts a request to the page, which owns the device, and blocks on a shared buffer (Atomics.wait) until
 * the page has taken the steps and written the grains and walls into shared arrays. The page must be cross-origin
 * isolated for the shared buffers (scripts/gpu-compute-browser-check.mjs serves it so).
 */
import * as scenarios from '../../../packages/box3d-kit/test/granular-scenarios.mjs';
import * as granularModule from '../granular.ts';
import {DEM_WALL} from './granular-wgsl.ts';
import {runGranularCases} from './granular-cases.ts';
import {granularProxy,type DemFrame,type DemRemote} from './granular-proxy.ts';
import type {DemSetup,DemStats} from './granular-f32.ts';

const scope=self as unknown as {postMessage(message:unknown):void;onmessage:((event:MessageEvent)=>void)|null};
let nextId=1;
const STAT_KEYS=['steps','contacts','wallContacts','overlap','maxOverlap','removed','bucketOverflow','historyOverflow'] as const;

function pageRemote():DemRemote {
  const id=nextId++;
  let control:Int32Array|null=null,pos:Float32Array,vel:Float32Array,spin:Float32Array,walls:Float32Array,stats:Float64Array,message:Uint8Array;
  const call=(body:Record<string,unknown>):void=>{
    const c=control!;
    Atomics.store(c,0,0);
    scope.postMessage({type:'dem',id,...body});
    while(Atomics.load(c,0)===0)Atomics.wait(c,0,0,1000);
    if(Atomics.load(c,0)===2){const length=Atomics.load(c,1);throw new Error(`GPU backend: ${new TextDecoder().decode(message.slice(0,length))}`);}
  };
  return {
    create(setup:DemSetup){
      const shared=(bytes:number):SharedArrayBuffer=>new SharedArrayBuffer(Math.max(8,bytes));
      const buffers={control:shared(8),pos:shared(16*setup.capacity),vel:shared(16*setup.capacity),spin:shared(16*setup.capacity),walls:shared(DEM_WALL.stride*(setup.wallCount+1)),stats:shared(8*STAT_KEYS.length),message:shared(2048)};
      control=new Int32Array(buffers.control);pos=new Float32Array(buffers.pos);vel=new Float32Array(buffers.vel);spin=new Float32Array(buffers.spin);walls=new Float32Array(buffers.walls);stats=new Float64Array(buffers.stats);message=new Uint8Array(buffers.message);
      call({op:'create',setup,buffers});
    },
    upload(setup:DemSetup,what){call({op:'upload',what,count:setup.count,pos:what.grains?setup.pos:null,vel:what.grains?setup.vel:null,spin:what.grains?setup.spin:null,walls:what.walls?setup.walls:null});},
    step(count:number){call({op:'step',count});},
    read():DemFrame {
      const s=Object.fromEntries(STAT_KEYS.map((key,k)=>[key,stats[k]])) as unknown as DemStats;
      return {pos,vel,spin,walls,stats:s};
    },
    destroy(){scope.postMessage({type:'dem',id,op:'destroy'});},
  };
}

scope.onmessage=(event:MessageEvent):void=>{
  const data=event.data as {type:string;only?:string[];quick?:boolean;historySlots?:number};
  if(data.type!=='run')return;
  try{
    const K={...(granularModule as unknown as Record<string,unknown>),Granular:granularProxy(pageRemote,data.historySlots?{historySlots:data.historySlots}:{})};
    const result=runGranularCases(scenarios,K,{only:data.only,quick:data.quick,progress:name=>scope.postMessage({type:'progress',name})});
    scope.postMessage({type:'done',result});
  }catch(error){scope.postMessage({type:'failed',message:error instanceof Error?`${error.message}\n${error.stack??''}`:String(error)});}
};
export const DEM_STAT_KEYS=STAT_KEYS;
