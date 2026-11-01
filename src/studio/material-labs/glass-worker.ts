import {glassWorkerHandler,type GlassWorkerRequest} from './glass-worker-protocol';
const handle=glassWorkerHandler();
const scope=globalThis as unknown as {onmessage:(event:MessageEvent<GlassWorkerRequest>)=>void;postMessage:(message:unknown,transfer:Transferable[])=>void};
scope.onmessage=event=>{
  const response=handle(event.data);if(!response)return;
  const transfer=response.type==='frame'?[response.frame.positions.buffer,response.frame.rotations.buffer,response.frame.damage.buffer]:[];
  scope.postMessage(response,transfer as Transferable[]);
};
