import {parentPort} from 'node:worker_threads';
import {createStudioWorkerDispatcher} from '../../../src/engine/studio-dispatcher.ts';
const dispatcher=createStudioWorkerDispatcher((message,transfer)=>parentPort.postMessage(message,transfer));
parentPort.on('message',message=>dispatcher.handle(message));
