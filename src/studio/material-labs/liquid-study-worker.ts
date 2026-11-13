import {runStudyCase,type StudyMessage,type StudyRequest} from './liquid-analysis';
import {isLabWorkerRequest,labWorkerHandler,type LabWorkerRequest} from './lab-worker-protocol';
import {useTrayExecutor} from './granular-si';
import {GranularThreads,spawnGranularWorker} from '../../engine/granular-parallel';
const scope=globalThis as unknown as {onmessage:(event:MessageEvent<StudyRequest|LabWorkerRequest>)=>void;postMessage:(message:unknown,transfer?:Transferable[])=>void};
const send=(message:StudyMessage)=>scope.postMessage(message);
const live=labWorkerHandler();
/**
 * Helper threads for the granular tray's contacts (granular-parallel.ts), started once, before the first granular reset
 * that asks for them, when this worker may block on shared memory (a cross-origin isolated page). Lab requests are
 * handled in order behind that start. Results are the same to the bit with or without them.
 */
let threads:Promise<void>|null=null,queue:Promise<void>=Promise.resolve();
const startThreads=(count:number):Promise<void>=>threads??=(GranularThreads.available()?GranularThreads.create(count,spawnGranularWorker).then(pool=>useTrayExecutor(pool),()=>useTrayExecutor(null)):Promise.resolve());
const handleLab=(data:LabWorkerRequest):void=>{
  const response=live(data);if(!response)return;
  const transfer=response.type==='frame'?[response.frame.positions.buffer,response.frame.rotations.buffer,response.frame.damage.buffer,...(response.frame.curve?[response.frame.curve.buffer]:[])]:[];
  scope.postMessage(response,transfer as Transferable[]);
};
/** The flow labs' worker: live stepping of the liquid and granular labs, and the liquid lab's three-case comparisons. */
scope.onmessage=event=>{
  const data=event.data;
  if(isLabWorkerRequest(data)){
    if(data.type==='reset'&&data.lab==='granular'&&(data.threads??1)>1)queue=queue.then(()=>startThreads(Math.min(4,data.threads!)));
    queue=queue.then(()=>handleLab(data));return;
  }
  try {
    const {cases,key,section}=data;
    if(cases.length!==3)throw new Error('A comparison requires exactly three cases.');
    for(let index=0;index<cases.length;index++){
      const run=runStudyCase(cases[index],index,key,section);let step=run.next();
      while(!step.done){send({type:'progress',index,time:step.value,duration:cases[index].runSeconds??18});step=run.next();}
      send({type:'result',result:step.value});
    }
    send({type:'complete'});
  }catch(error){send({type:'error',message:error instanceof Error?error.message:'The comparison could not finish.'});}
};
