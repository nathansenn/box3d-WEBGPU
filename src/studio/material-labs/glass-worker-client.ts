import type {LabFrame} from './models';
import type {LabSettings} from './catalog';
import type {GlassWorkerRequest,GlassWorkerResponse} from './glass-worker-protocol';

/** At most one batch is in flight. Reset/disposal terminates only this client. */
export class GlassWorkerClient {
  private worker:Worker;private disposed=false;private request=0;private initialized=false;
  private pending=0;private releasePending=false;
  private sentAt=0;private sentTicks=0;private costPerTick=0;
  private clock:()=>number;
  private receive:(frame:LabFrame)=>void;private failure:(message:string)=>void;
  constructor(settings:LabSettings,receive:(frame:LabFrame)=>void,failure:(message:string)=>void,clock=()=>performance.now()){
    this.receive=receive;this.failure=failure;this.clock=clock;
    this.worker=new Worker(new URL('./glass-worker.ts',import.meta.url),{type:'module',name:'BOX3D glass contacts'});
    this.worker.onmessage=(event:MessageEvent<GlassWorkerResponse>)=>{
      if(this.disposed)return;const response=event.data;
      if(response.generation!==0)return;
      if(response.type==='error'){this.fail(response.message);return;}
      if(response.request===0){this.initialized=true;return;}
      if(response.request!==this.pending)return;
      // Reduce expensive batches immediately; recover gradually as load falls.
      // This includes delivery delay, so a busy renderer also gets smaller batches.
      const cost=Math.max(0,this.clock()-this.sentAt)/this.sentTicks;
      if(Number.isFinite(cost))this.costPerTick=Math.max(cost,this.costPerTick*.75);
      this.pending=0;this.receive(response.frame);
    };
    this.worker.onerror=event=>{event.preventDefault();this.fail(event.message||'Glass collision worker failed');};
    this.worker.onmessageerror=()=>this.fail('Glass collision frame could not be decoded');
    this.send({type:'reset',generation:0,settings});
  }
  /** A cadence target, not a deadline: one fixed tick can exceed 40 ms. */
  get maxBatchTicks():number {return Math.max(1,Math.min(4,Math.floor(40/(this.costPerTick||1))));}
  step(ticks:number):boolean {
    if(this.disposed||!this.initialized||this.pending)return false;
    this.pending=++this.request;this.sentAt=this.clock();this.sentTicks=ticks;this.send({type:'step',generation:0,request:this.request,ticks,release:this.releasePending});this.releasePending=false;return true;
  }
  release():void {this.releasePending=true;}
  dispose():void {if(this.disposed)return;this.disposed=true;this.worker.terminate();}
  private send(message:GlassWorkerRequest):void {this.worker.postMessage(message);}
  private fail(message:string):void {this.dispose();this.failure(message);}
}
