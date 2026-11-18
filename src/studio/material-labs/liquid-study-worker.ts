import {runStudyCase,type StudyMessage,type StudyRequest} from './liquid-analysis';
import {isLabWorkerRequest,labWorkerState,type LabWorkerRequest,type LabWorkerResponse} from './lab-worker-protocol';
import {isLabRunRequest,type LabRunRequest} from './lab-run';
import {labRunRouter} from './lab-run-host';
const scope=globalThis as unknown as {onmessage:(event:MessageEvent<StudyRequest|LabWorkerRequest|LabRunRequest>)=>void;postMessage:(message:unknown,transfer?:Transferable[])=>void};
const send=(message:StudyMessage)=>scope.postMessage(message);
const live=labRunRouter(labWorkerState(),(message,transfer)=>scope.postMessage(message,transfer),
  (response:LabWorkerResponse)=>response.type==='frame'?[response.frame.positions.buffer,response.frame.rotations.buffer,response.frame.damage.buffer,...(response.frame.curve?[response.frame.curve.buffer]:[])] as Transferable[]:[]);
/** The flow labs' worker: live stepping of the liquid and granular labs, and the liquid lab's three-case comparisons. */
scope.onmessage=event=>{
  const data=event.data;
  if(isLabWorkerRequest(data)||isLabRunRequest(data)){live(data);return;}
  try {
    const {cases,key,section}=data as StudyRequest;
    if(cases.length!==3)throw new Error('A comparison requires exactly three cases.');
    for(let index=0;index<cases.length;index++){
      const run=runStudyCase(cases[index],index,key,section);let step=run.next();
      while(!step.done){send({type:'progress',index,time:step.value,duration:cases[index].runSeconds??18});step=run.next();}
      send({type:'result',result:step.value});
    }
    send({type:'complete'});
  }catch(error){send({type:'error',message:error instanceof Error?error.message:'The comparison could not finish.'});}
};
