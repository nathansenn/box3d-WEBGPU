import {GlassModel,DT,type LabFrame} from './models';
import {GLASS_REFINEMENT} from './glass-si';
import type {NativeWorldPool} from '../../engine/native-world';
import type {LabSettings} from './catalog';

/** `box3d`: where the page serves box3d.js and box3d.wasm; the worker loads them once, for the fragments' rigid world. */
export type GlassWorkerRequest={type:'reset';generation:number;settings:Partial<LabSettings>;box3d?:{module:string;wasm:string};fineCracks?:boolean}|{type:'step';generation:number;request:number;ticks:number;release:boolean};
export type GlassWorkerResponse={type:'frame';generation:number;request:number;frame:LabFrame}|{type:'error';generation:number;request:number;message:string};
/** One model and one generation per worker. Frames own their transferable buffers. */
export function glassWorkerHandler(fragments?:()=>NativeWorldPool|undefined): (message:GlassWorkerRequest)=>GlassWorkerResponse|null {return glassWorkerState(fragments).handle;}
/** The handler and its current model and generation (the free run, lab-run.ts, steps that model). `fragments`: the Box3D
 * pool for the released fragments, when it has loaded (glass-fragments.ts); each model gets its own world in it. */
export function glassWorkerState(fragments:()=>NativeWorldPool|undefined=()=>undefined):{handle:(message:GlassWorkerRequest)=>GlassWorkerResponse|null;current():{model:GlassModel;generation:number}|undefined} {
  let model:GlassModel|undefined,generation=-1,lastRequest=0;
  const current=()=>model?{model,generation}:undefined;
  return {current,handle:message=>{
    const request=message.type==='step'?message.request:0;
    try{
      if(!Number.isSafeInteger(message.generation)||message.generation<0)throw new Error('Invalid glass worker generation');
      if(message.type==='reset'){
        if(message.generation<=generation)return null;
        const pool=fragments(),next=new GlassModel(message.settings,{...(pool?{fragments:pool}:{}),...(message.fineCracks?{refine:GLASS_REFINEMENT}:{})});model?.dispose();model=next;generation=message.generation;lastRequest=0;
        return {type:'frame',generation,request:0,frame:model.snapshot()};
      }
      if(message.type!=='step')throw new Error('Invalid glass worker request');
      if(message.generation!==generation)return null;
      if(!model)throw new Error('Glass worker is not initialized');
      if(!Number.isSafeInteger(request)||request<=lastRequest)throw new Error('Glass worker request is stale');
      if(!Number.isInteger(message.ticks)||message.ticks<1||message.ticks>4||typeof message.release!=='boolean')throw new Error('Invalid glass worker step batch');
      if(message.release)model.release();
      for(let i=0;i<message.ticks;i++)model.step(DT);lastRequest=request;
      return {type:'frame',generation,request,frame:model.snapshot()};
    }catch(error){return {type:'error',generation:message.generation,request,message:error instanceof Error?error.message:'Glass simulation failed'};}
  }};
}
