import {FreeRunPacer} from '../../perf/free-run';
import {DT,type LabFrame} from './lab-model';

/**
 * Free run of a material lab in its worker (the flow worker or the glass worker). The worker advances fixed DT ticks
 * toward `speed` x wall time on its own schedule, records the history samples itself and publishes its newest frame at
 * most every LAB_RUN_PUBLISH_MS; the page draws the newest frame it has. Frames carry a sequence that the page
 * acknowledges: with LAB_RUN_MAX_UNACKED frames unacknowledged the worker keeps stepping and holds its history, up to
 * LAB_RUN_MAX_HELD_SECONDS of simulated time, then waits. Every tick is model.step(DT), so a run's result does not depend
 * on how fast the page draws or how the worker slices its work.
 */
export type LabRunRequest=
  |{type:'run';generation:number;request:number;speed:number;end:number;maxLag:number;release:boolean;sampleEvery:number;nextSample:number}
  |{type:'pause';generation:number;request:number}
  |{type:'run-update';generation:number;speed?:number;release?:boolean}
  |{type:'ack';generation:number;sequence:number};
export interface LabRunState {running:boolean;stopReason:'end'|'pause'|null;lagSeconds:number;overloads:number;sequence:number;nextSample:number;ticks:number}
export interface LabRunFrame {type:'frame';generation:number;request:number;frame:LabFrame;cpuMs:number;history:LabFrame[];run:LabRunState}
export const LAB_RUN_PUBLISH_MS=33,LAB_RUN_SLICE_MS=24,LAB_RUN_MAX_UNACKED=2,LAB_RUN_MAX_HELD_SECONDS=5;
export const isLabRunRequest=(value:unknown):value is LabRunRequest=>typeof value==='object'&&value!==null&&['run','pause','run-update','ack'].includes((value as {type?:unknown}).type as string);

export interface LabRunModel {frame:LabFrame;step(dt?:number):void;snapshot():LabFrame;release():void}
export interface LabRunHost {now():number;schedule(task:()=>void,delayMs:number):()=>void;post(message:LabRunFrame,transfer:Transferable[]):void;fail(message:string):void}
/** Buffers of a frame and of its history, for transfer. */
export function frameTransfers(frames:readonly LabFrame[]):Transferable[] {
  const out=new Set<ArrayBufferLike>();
  for(const f of frames)for(const value of Object.values(f))if(ArrayBuffer.isView(value))out.add(value.buffer);
  return [...out] as Transferable[];
}

export class LabRunLoop {
  private readonly pacer:FreeRunPacer;private readonly model:LabRunModel;private readonly host:LabRunHost;
  private readonly generation:number;private request:number;private readonly end:number;private readonly sampleEvery:number;
  private nextSample:number;private history:LabFrame[]=[];private ticks=0;private cpuMs=0;private heldTime=0;
  private releasePending:boolean;private sequence=0;private acked=0;private lastPublish=-Infinity;private costPerTick=1;
  private stop:LabRunState['stopReason']=null;private cancel?:()=>void;private closed=false;
  constructor(model:LabRunModel,message:Extract<LabRunRequest,{type:'run'}>,host:LabRunHost){
    if(!Number.isFinite(message.end)||message.end<0||!Number.isFinite(message.sampleEvery)||message.sampleEvery<=0||!Number.isFinite(message.nextSample)||typeof message.release!=='boolean')throw new Error('Invalid lab run request');
    this.model=model;this.host=host;this.generation=message.generation;this.request=message.request;this.end=message.end;this.sampleEvery=message.sampleEvery;
    this.nextSample=message.nextSample;this.releasePending=message.release;
    this.pacer=new FreeRunPacer(DT,{speed:message.speed,maxLagSeconds:message.maxLag,tick:0,nowMs:host.now()});
    this.wake(0);
  }
  get active():boolean {return !this.closed;}
  update(message:Extract<LabRunRequest,{type:'run-update'}>):void {
    if(this.closed||this.stop)return;
    if(message.speed!==undefined)this.pacer.retime(this.host.now(),this.ticks,message.speed);
    if(message.release)this.releasePending=true;
  }
  ack(sequence:number):void {if(Number.isSafeInteger(sequence)&&sequence>this.acked&&sequence<=this.sequence){this.acked=sequence;this.wake(0,true);}}
  /** Stops at the current tick; the next frame (request `request`) ends the run. */
  pause(request:number):void {if(this.closed)return;this.request=request;if(!this.stop)this.stop='pause';this.wake(0,true);}
  close():void {this.closed=true;this.cancel?.();this.cancel=undefined;}
  private finished(time:number):boolean {return time>=this.end-DT*1e-6;}
  private wake(delayMs:number,replace=false):void {
    if(this.closed)return;
    if(this.cancel){if(!replace)return;this.cancel();}
    this.cancel=this.host.schedule(this.pump,delayMs);
  }
  private readonly pump=():void=>{
    this.cancel=undefined;if(this.closed)return;
    try{
      const sliceStart=this.host.now(),start=this.model.frame.time;
      if(!this.stop&&this.finished(this.model.frame.time))this.stop='end';
      while(!this.stop&&this.heldTime<LAB_RUN_MAX_HELD_SECONDS){
        let due=this.pacer.due(this.host.now(),this.ticks);if(due<=0)break;
        due=Math.max(1,Math.min(due,Math.floor(LAB_RUN_SLICE_MS/2/this.costPerTick)));
        const before=this.host.now();
        for(let i=0;i<due;i++){
          if(this.releasePending){this.model.release();this.releasePending=false;}
          this.model.step(DT);this.ticks++;
          const time=this.model.frame.time,done=this.finished(time);
          if(time>=this.nextSample||done){this.history.push(this.model.snapshot());this.nextSample=time+this.sampleEvery;}
          if(done){this.stop='end';break;}
        }
        const after=this.host.now();this.cpuMs+=after-before;this.costPerTick=Math.max(.05,.7*this.costPerTick+.3*(after-before)/due);
        if(after-sliceStart>=LAB_RUN_SLICE_MS)break;
      }
      this.heldTime+=this.model.frame.time-start;
      const now=this.host.now(),changed=this.heldTime>0||this.history.length>0;
      if(this.stop||(changed&&now-this.lastPublish>=LAB_RUN_PUBLISH_MS&&this.sequence-this.acked<LAB_RUN_MAX_UNACKED)){
        const frame=this.model.snapshot(),history=this.history;this.history=[];
        const run:LabRunState={running:!this.stop,stopReason:this.stop,lagSeconds:this.pacer.lagSeconds,overloads:this.pacer.overloads,sequence:++this.sequence,nextSample:this.nextSample,ticks:this.ticks};
        this.host.post({type:'frame',generation:this.generation,request:this.request,frame,cpuMs:this.cpuMs,history,run},frameTransfers([frame,...history]));
        this.cpuMs=0;this.heldTime=0;this.lastPublish=now;
        if(this.stop){this.close();return;}
      }
      if(this.pacer.due(now,this.ticks)>0&&this.heldTime<LAB_RUN_MAX_HELD_SECONDS){this.wake(0);return;}
      // Waiting for wall time, for the publication interval, or (held) for an acknowledgement, which wakes us.
      const nextTick=this.pacer.nextDueMs(this.ticks)-now,nextPublish=this.heldTime>0?this.lastPublish+LAB_RUN_PUBLISH_MS-now:Infinity;
      this.wake(Math.max(1,Math.min(nextTick,nextPublish,100)));
    }catch(error){this.close();this.host.fail(error instanceof Error?error.message:'Simulation failed');}
  };
}

/** What a page asks of a free run. */
export interface LabRunOptions {speed:number;end:number;maxLag:number;sampleEvery:number;nextSample:number}
/** The page side of a free run: start, pause, speed and release; frames are acknowledged as they are delivered. */
export class LabRunChannel {
  private active=0;private pausing=0;private lastTicks=0;
  running=false;
  /** Solver CPU time over simulated time of the recent frames (below 1: faster than real time). */
  cpuPerSimulated=0;
  private readonly send:(message:LabRunRequest)=>void;
  constructor(send:(message:LabRunRequest)=>void){this.send=send;}
  start(request:number,options:LabRunOptions,release:boolean):void {
    this.active=request;this.pausing=0;this.running=true;this.lastTicks=0;
    this.send({type:'run',generation:0,request,release,...options});
  }
  pause(request:number):void {if(!this.running||this.pausing)return;this.pausing=request;this.send({type:'pause',generation:0,request});}
  setSpeed(speed:number):void {if(this.running&&!this.pausing)this.send({type:'run-update',generation:0,speed});}
  /** Returns false when no run is active (the caller applies the release to its next run or step). */
  release():boolean {if(!this.running||this.pausing)return false;this.send({type:'run-update',generation:0,release:true});return true;}
  /** A response this channel owns: a frame of the active run or the answer to its pause. */
  owns(response:{type:string;request:number}):boolean {return response.type==='frame'&&'run' in response&&(response.request===this.active||(this.pausing>0&&response.request===this.pausing));}
  accept(frame:LabRunFrame,deliver:(frame:LabFrame,history:LabFrame[],run:LabRunState)=>void):void {
    const run=frame.run,ticks=run.ticks-this.lastTicks;
    if(ticks>0){const ratio=frame.cpuMs/(ticks*1000*DT);this.cpuPerSimulated=this.cpuPerSimulated?this.cpuPerSimulated*.8+ratio*.2:ratio;}
    this.lastTicks=run.ticks;
    if(!run.running){this.running=false;this.active=this.pausing=0;}
    deliver(frame.frame,frame.history,run);
    if(run.running)this.send({type:'ack',generation:0,sequence:run.sequence});
  }
}
