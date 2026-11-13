import type {LabFrame} from './models';
import {LabRunChannel,type LabRunFrame,type LabRunOptions,type LabRunState} from './lab-run';
import type {LabId,LabSettings} from './catalog';
import {LAB_WORKER_MAX_TICKS,type LabWorkerRequest,type LabWorkerResponse} from './lab-worker-protocol';

/** Steps a flow lab in the flow worker; at most one batch in flight. Reset or disposal terminates only this client. */
export class LabWorkerClient {
  private worker:Worker;private disposed=false;private request=0;private initialized=false;
  private pending=0;private releasePending=false;private sentAt=0;private sentTicks=0;private costPerTick=0;
  private stepCpu=0;
  private readonly runs=new LabRunChannel(message=>this.send(message as never));
  /** Solver CPU time over simulated time of the last batches or run frames (below 1: faster than real time). */
  get cpuPerSimulated():number {return this.runs.cpuPerSimulated||this.stepCpu;}
  constructor(lab:LabId,settings:LabSettings,private receive:(frame:LabFrame,history?:LabFrame[],run?:LabRunState)=>void,private failure:(message:string)=>void,private clock=()=>performance.now()){
    this.worker=new Worker(new URL('./liquid-study-worker.ts',import.meta.url),{type:'module',name:'BOX3D flow solver'});
    this.worker.onmessage=(event:MessageEvent<LabWorkerResponse>)=>{
      if(this.disposed)return;const response=event.data;
      if(response.generation!==0)return;
      if(response.type==='error'){this.fail(response.message);return;}
      if(response.request===0){this.initialized=true;return;}
      if(this.runs.owns(response)){this.runs.accept(response as unknown as LabRunFrame,(frame,history,run)=>this.receive(frame,history,run));return;}
      if(response.request!==this.pending)return;
      const cost=Math.max(0,this.clock()-this.sentAt)/this.sentTicks;
      if(Number.isFinite(cost))this.costPerTick=Math.max(cost,this.costPerTick*.75);
      const ratio=response.cpuMs/(this.sentTicks*1000/120);this.stepCpu=this.stepCpu?this.stepCpu*.8+ratio*.2:ratio;
      this.pending=0;this.receive(response.frame);
    };
    this.worker.onerror=event=>{event.preventDefault();this.fail(event.message||'Flow solver worker failed');};
    this.worker.onmessageerror=()=>this.fail('Flow solver frame could not be decoded');
    this.send({type:'reset',generation:0,lab,settings});
  }
  get ready():boolean {return this.initialized&&!this.disposed;}
  /** Batches aim at about 50 ms of solver work. */
  get maxBatchTicks():number {return Math.max(1,Math.min(LAB_WORKER_MAX_TICKS,Math.floor(50/(this.costPerTick||1))));}
  /** True while the worker runs free (lab-run.ts); step() is refused until the run's last frame arrives. */
  get running():boolean {return this.runs.running;}
  /** Starts a free run toward wall time; frames arrive through `receive` with their history samples and run state. */
  run(options:LabRunOptions):boolean {
    if(this.disposed||!this.initialized||this.pending||this.runs.running)return false;
    this.runs.start(++this.request,options,this.releasePending);this.releasePending=false;return true;
  }
  /** Stops the run at its current tick; its last frame arrives through `receive` with run.running false. */
  pause():void {if(!this.disposed)this.runs.pause(++this.request);}
  setSpeed(speed:number):void {if(!this.disposed)this.runs.setSpeed(speed);}
  step(ticks:number):boolean {
    if(this.disposed||!this.initialized||this.pending||this.runs.running)return false;
    this.pending=++this.request;this.sentAt=this.clock();this.sentTicks=ticks;this.send({type:'step',generation:0,request:this.request,ticks,release:this.releasePending});this.releasePending=false;return true;
  }
  release():void {if(!this.runs.release())this.releasePending=true;}
  dispose():void {if(this.disposed)return;this.disposed=true;this.worker.terminate();}
  private send(message:LabWorkerRequest|import('./lab-run').LabRunRequest):void {this.worker.postMessage(message);}
  private fail(message:string):void {this.dispose();this.failure(message);}
}
