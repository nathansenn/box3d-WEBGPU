import type {LabFrame} from './models';
import type {LabId,LabSettings} from './catalog';
import {LAB_WORKER_MAX_TICKS,type LabWorkerRequest,type LabWorkerResponse} from './lab-worker-protocol';

/** Steps a flow lab in the flow worker; at most one batch in flight. Reset or disposal terminates only this client. */
export class LabWorkerClient {
  private worker:Worker;private disposed=false;private request=0;private initialized=false;
  private pending=0;private releasePending=false;private sentAt=0;private sentTicks=0;private costPerTick=0;
  /** Solver CPU time over simulated time of the last batches (below 1: faster than real time). */
  cpuPerSimulated=0;
  constructor(lab:LabId,settings:LabSettings,private receive:(frame:LabFrame)=>void,private failure:(message:string)=>void,private clock=()=>performance.now()){
    this.worker=new Worker(new URL('./liquid-study-worker.ts',import.meta.url),{type:'module',name:'BOX3D flow solver'});
    this.worker.onmessage=(event:MessageEvent<LabWorkerResponse>)=>{
      if(this.disposed)return;const response=event.data;
      if(response.generation!==0)return;
      if(response.type==='error'){this.fail(response.message);return;}
      if(response.request===0){this.initialized=true;return;}
      if(response.request!==this.pending)return;
      const cost=Math.max(0,this.clock()-this.sentAt)/this.sentTicks;
      if(Number.isFinite(cost))this.costPerTick=Math.max(cost,this.costPerTick*.75);
      const ratio=response.cpuMs/(this.sentTicks*1000/120);this.cpuPerSimulated=this.cpuPerSimulated?this.cpuPerSimulated*.8+ratio*.2:ratio;
      this.pending=0;this.receive(response.frame);
    };
    this.worker.onerror=event=>{event.preventDefault();this.fail(event.message||'Flow solver worker failed');};
    this.worker.onmessageerror=()=>this.fail('Flow solver frame could not be decoded');
    this.send({type:'reset',generation:0,lab,settings});
  }
  get ready():boolean {return this.initialized&&!this.disposed;}
  /** Batches aim at about 50 ms of solver work. */
  get maxBatchTicks():number {return Math.max(1,Math.min(LAB_WORKER_MAX_TICKS,Math.floor(50/(this.costPerTick||1))));}
  step(ticks:number):boolean {
    if(this.disposed||!this.initialized||this.pending)return false;
    this.pending=++this.request;this.sentAt=this.clock();this.sentTicks=ticks;this.send({type:'step',generation:0,request:this.request,ticks,release:this.releasePending});this.releasePending=false;return true;
  }
  release():void {this.releasePending=true;}
  dispose():void {if(this.disposed)return;this.disposed=true;this.worker.terminate();}
  private send(message:LabWorkerRequest):void {this.worker.postMessage(message);}
  private fail(message:string):void {this.dispose();this.failure(message);}
}
