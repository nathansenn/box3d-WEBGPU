import {LabRunLoop,frameTransfers,isLabRunRequest,type LabRunModel,type LabRunRequest} from './lab-run';
import type {LabFrame} from './lab-model';

type Post=(message:unknown,transfer?:Transferable[])=>void;
/** Routes a lab worker's messages: free-run messages (lab-run.ts) to the run loop, the rest to the stepping handler. A
 * reset or a step while running ends the run first; a pause without a run answers with the current frame. */
export function labRunRouter<Q extends {type:string;generation:number},R>(state:{handle:(message:Q)=>R|null;current():{model:LabRunModel;generation:number}|undefined},post:Post,transfers:(response:R)=>Transferable[]):(data:unknown)=>void {
  let loop:LabRunLoop|undefined;
  const fail=(generation:number,request:number,message:string)=>post({type:'error',generation,request,message});
  const schedule=(task:()=>void,delayMs:number)=>{const timer=setTimeout(task,delayMs);return()=>clearTimeout(timer);};
  return data=>{
    if(isLabRunRequest(data)){
      const message=data as LabRunRequest,current=state.current();
      if(!current||message.generation!==current.generation)return;
      if(message.type==='run'){
        loop?.close();
        try{loop=new LabRunLoop(current.model,message,{now:()=>performance.now(),schedule,post:(frame,transfer)=>post(frame,transfer),fail:text=>{loop=undefined;fail(message.generation,message.request,text);}});}
        catch(error){fail(message.generation,message.request,error instanceof Error?error.message:'Invalid lab run');}
        return;
      }
      if(message.type==='pause'){
        if(loop?.active){loop.pause(message.request);return;}
        const frame:LabFrame=current.model.snapshot();
        post({type:'frame',generation:message.generation,request:message.request,frame,cpuMs:0,history:[],run:{running:false,stopReason:'pause',lagSeconds:0,overloads:0,sequence:0,nextSample:Infinity,ticks:0}},frameTransfers([frame]));
        return;
      }
      if(message.type==='run-update'){loop?.update(message);return;}
      loop?.ack(message.sequence);return;
    }
    if(loop?.active){loop.close();loop=undefined;}
    const response=state.handle(data as Q);if(!response)return;
    post(response,transfers(response));
  };
}
