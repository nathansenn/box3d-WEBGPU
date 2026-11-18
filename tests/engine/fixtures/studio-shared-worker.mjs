import {parentPort,workerData} from 'node:worker_threads';
import {createStudioWorkerDispatcher} from '../../../src/engine/studio-dispatcher.ts';
const dispatcher=createStudioWorkerDispatcher((message,transfer)=>parentPort.postMessage(message,transfer));
parentPort.on('message',message=>{
  if(workerData?.denyShared&&message.snapshots==='shared'){
    parentPort.postMessage({v:1,id:message.id,generation:message.generation,type:'error',code:'SHARED_UNAVAILABLE',message:'Shared memory unavailable in this worker fixture.'});
  }else dispatcher.handle(message);
});
