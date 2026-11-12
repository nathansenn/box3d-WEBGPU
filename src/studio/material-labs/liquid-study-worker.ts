import {runStudyCase,type StudyMessage,type StudyRequest} from './liquid-analysis';
import {isLabWorkerRequest,labWorkerHandler,type LabWorkerRequest} from './lab-worker-protocol';
const scope=globalThis as unknown as {onmessage:(event:MessageEvent<StudyRequest|LabWorkerRequest>)=>void;postMessage:(message:unknown,transfer?:Transferable[])=>void};
const send=(message:StudyMessage)=>scope.postMessage(message);
const live=labWorkerHandler();
/** The flow labs' worker: live stepping of the liquid and granular labs, and the liquid lab's three-case comparisons. */
scope.onmessage=event=>{
  const data=event.data;
  if(isLabWorkerRequest(data)){
    const response=live(data);if(!response)return;
    const transfer=response.type==='frame'?[response.frame.positions.buffer,response.frame.rotations.buffer,response.frame.damage.buffer]:[];
    scope.postMessage(response,transfer as Transferable[]);return;
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
