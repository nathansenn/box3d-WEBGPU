/** A helper thread of the discrete element solver (granular-parallel.ts): a browser module worker or a Node worker thread. */
import {granularWorkerMain} from './granular-parallel.ts';

const scope=globalThis as unknown as {postMessage?:(m:unknown)=>void;addEventListener?:(type:string,l:(e:{data:unknown})=>void)=>void;process?:{versions?:{node?:string}}};
if(scope.process?.versions?.node){
  // No top-level await: browser bundles build workers as classic scripts.
  const name='node:worker_threads';
  void (import(/* @vite-ignore */ name) as Promise<{parentPort:{postMessage(m:unknown):void;on(e:string,l:(m:unknown)=>void):void}}>).then(({parentPort})=>{
    const handle=granularWorkerMain(m=>parentPort.postMessage(m));
    parentPort.on('message',handle);
  });
}else{
  const handle=granularWorkerMain(m=>scope.postMessage!(m));
  scope.addEventListener!('message',e=>handle(e.data));
}
