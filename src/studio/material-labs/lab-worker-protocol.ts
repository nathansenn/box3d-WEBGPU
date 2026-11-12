import {createModel,DT,type LabFrame,type LabModel} from './models';
import type {LabId,LabSettings} from './catalog';

/** Live stepping of the flow labs (liquid, granular), the elastomer and the concrete labs off the main thread; one model and one generation per worker. */
export type LabWorkerRequest={type:'reset';generation:number;lab:LabId;settings:Partial<LabSettings>}|{type:'step';generation:number;request:number;ticks:number;release:boolean};
export type LabWorkerResponse={type:'frame';generation:number;request:number;frame:LabFrame;cpuMs:number}|{type:'error';generation:number;request:number;message:string};
export const LAB_WORKER_MAX_TICKS=8;
export const isLabWorkerRequest=(value:unknown):value is LabWorkerRequest=>typeof value==='object'&&value!==null&&((value as {type?:unknown}).type==='reset'||(value as {type?:unknown}).type==='step');
export function labWorkerHandler():(message:LabWorkerRequest)=>LabWorkerResponse|null {
  let model:LabModel|undefined,generation=-1,lastRequest=0;
  return message=>{
    const request=message.type==='step'?message.request:0;
    try{
      if(!Number.isSafeInteger(message.generation)||message.generation<0)throw new Error('Invalid lab worker generation');
      if(message.type==='reset'){
        if(message.generation<=generation)return null;
        if(message.lab!=='liquid'&&message.lab!=='granular'&&message.lab!=='rubber'&&message.lab!=='concrete')throw new Error('The lab worker runs the liquid, granular, elastomer and concrete labs only');
        const start=performance.now();model=createModel(message.lab,message.settings);generation=message.generation;lastRequest=0;
        return {type:'frame',generation,request:0,frame:model.snapshot(),cpuMs:performance.now()-start};
      }
      if(message.generation!==generation)return null;
      if(!model)throw new Error('Lab worker is not initialized');
      if(!Number.isSafeInteger(request)||request<=lastRequest)throw new Error('Lab worker request is stale');
      if(!Number.isInteger(message.ticks)||message.ticks<1||message.ticks>LAB_WORKER_MAX_TICKS||typeof message.release!=='boolean')throw new Error('Invalid lab worker step batch');
      if(message.release)model.release();
      const start=performance.now();
      // One call per batch: the solvers take their own substeps (the flume and the grains by their stable step).
      model.step(message.ticks*DT);lastRequest=request;
      return {type:'frame',generation,request,frame:model.snapshot(),cpuMs:performance.now()-start};
    }catch(error){return {type:'error',generation:message.generation,request,message:error instanceof Error?error.message:'Simulation failed'};}
  };
}
