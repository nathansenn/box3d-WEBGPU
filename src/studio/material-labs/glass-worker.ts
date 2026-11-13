import {glassWorkerState,type GlassWorkerResponse} from './glass-worker-protocol';
import {labRunRouter} from './lab-run-host';
const scope=globalThis as unknown as {onmessage:(event:MessageEvent<unknown>)=>void;postMessage:(message:unknown,transfer:Transferable[])=>void};
const route=labRunRouter(glassWorkerState(),(message,transfer=[])=>scope.postMessage(message,transfer),
  (response:GlassWorkerResponse)=>response.type==='frame'?[response.frame.positions.buffer,response.frame.rotations.buffer,response.frame.damage.buffer,...(response.frame.cracks?[response.frame.cracks.buffer]:[])] as Transferable[]:[]);
scope.onmessage=event=>route(event.data);
