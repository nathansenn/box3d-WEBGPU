import {glassWorkerState,type GlassWorkerRequest,type GlassWorkerResponse} from './glass-worker-protocol';
import {loadFragmentPool} from './glass-fragments';
import type {NativeWorldPool} from '../../engine/native-world';
import {labRunRouter} from './lab-run-host';
const scope=globalThis as unknown as {onmessage:(event:MessageEvent<unknown>)=>void;postMessage:(message:unknown,transfer:Transferable[])=>void};
// The fragments' Box3D world: loaded once, from the URLs the first reset names. Messages wait while it loads; if it does
// not load, the lab runs without contacts between fragments (as before) and says so in the console.
let pool:NativeWorldPool|undefined;const waiting:unknown[]=[];
const route=labRunRouter(glassWorkerState(()=>pool),(message,transfer=[])=>scope.postMessage(message,transfer),
  (response:GlassWorkerResponse)=>response.type==='frame'?[response.frame.positions.buffer,response.frame.rotations.buffer,response.frame.damage.buffer,...(response.frame.cracks?[response.frame.cracks.buffer]:[])] as Transferable[]:[]);
let phase:'idle'|'loading'|'done'='idle';
scope.onmessage=event=>{
  const data=event.data as GlassWorkerRequest;
  if(phase==='idle'&&data?.type==='reset'&&data.box3d){
    phase='loading';
    loadFragmentPool(data.box3d.module,data.box3d.wasm).then(p=>{pool=p;},error=>{console.warn('Glass fragments run without Box3D contacts:',error instanceof Error?error.message:error);})
      .finally(()=>{phase='done';for(const message of waiting.splice(0))route(message);});
  }
  if(phase==='loading'){waiting.push(event.data);return;}
  route(event.data);
};

