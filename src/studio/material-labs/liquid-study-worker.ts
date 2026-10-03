import {runStudyCase,type StudyMessage,type StudyRequest} from './liquid-analysis';
const send=(message:StudyMessage)=>self.postMessage(message);
self.onmessage=(event:MessageEvent<StudyRequest>)=>{
  try {
    const {cases,key,section}=event.data;
    if(cases.length!==3)throw new Error('A comparison requires exactly three cases.');
    for(let index=0;index<cases.length;index++){
      const run=runStudyCase(cases[index],index,key,section);let step=run.next();
      while(!step.done){send({type:'progress',index,time:step.value,duration:cases[index].runSeconds??18});step=run.next();}
      send({type:'result',result:step.value});
    }
    send({type:'complete'});
  }catch(error){send({type:'error',message:error instanceof Error?error.message:'The comparison could not finish.'});}
};
