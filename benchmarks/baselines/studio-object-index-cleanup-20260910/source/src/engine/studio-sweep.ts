import { EngineError, integer, onlyKeys, record, type EngineCapabilities } from './contracts.ts';
import { createStudioClient, type StudioClient, type StudioTransportOptions } from './studio-client.ts';
import { validateStudioCommand, validateStudioOptions, type StudioCommand, type StudioCreateOptions } from './studio-runtime.ts';
import type { FailureEvent, Response, StudioCheckpoint } from '../studio/physics.ts';

export interface StudioSweepCase {
  id: string;
  options: StudioCreateOptions;
  ticks: number;
  commands?: readonly StudioCommand[];
}
export interface StudioSweepSample { tick: number; response: Response }
export interface StudioSweepResult {
  id: string;
  status: 'completed' | 'cancelled' | 'failed';
  requestedTicks: number;
  completedTicks: number;
  completionReason: 'tick-limit' | 'press-complete' | 'cancelled' | 'error';
  samples: StudioSweepSample[];
  events: FailureEvent[];
  final: Response | null;
  checkpoint?: StudioCheckpoint;
  capabilities?: EngineCapabilities;
  transport?: 'worker' | 'sync';
  error?: string;
  wallMs: number;
  simMs: number;
}
export interface StudioSweepOptions {
  concurrency?: number;
  batchTicks?: number;
  /** A multiple of the engine's 12-tick recording cadence. */
  sampleEveryTicks?: number;
  includeCheckpoint?: boolean;
  /** Stream checkpoints to onResult without retaining every specimen in memory. */
  retainCheckpoints?: boolean;
  signal?: AbortSignal;
  transport?: StudioTransportOptions;
  /** Awaited per case, providing backpressure for disk/database sinks. */
  onResult?: (result: StudioSweepResult, index: number) => void | Promise<void>;
  onProgress?: (progress: { id: string; index: number; tick: number; requestedTicks: number }) => void;
}

export function validateStudioSweep(value: unknown): StudioSweepCase[] {
  if(!Array.isArray(value)||value.length===0||value.length>512)throw new EngineError('INVALID_PAYLOAD','A sweep requires 1–512 cases.');
  const ids=new Set<string>();let totalTicks=0;
  const cases=value.map((raw,index)=>{
    const c=record(raw,`cases[${index}]`);onlyKeys(c,['id','options','ticks','commands'],'case');
    if(typeof c.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(c.id)||ids.has(c.id))throw new EngineError('INVALID_PAYLOAD','Case IDs must be unique safe names of at most 80 characters.');
    ids.add(c.id);
    const options=validateStudioOptions(c.options);
    if(options.initialCheckpoint!==undefined)throw new EngineError('INVALID_PAYLOAD','Parameter sweeps start from a fresh specimen; use the runtime API to resume checkpoints.');
    const ticks=integer(c.ticks,'case.ticks',1,72000);totalTicks+=ticks;
    if(c.commands!==undefined&&(!Array.isArray(c.commands)||c.commands.length>64))throw new EngineError('INVALID_PAYLOAD','At most 64 commands per case are supported.');
    let previous=0;
    const commands=((c.commands??[]) as unknown[]).map(rawCommand=>{
      const command=validateStudioCommand(rawCommand);
      if(command.tick<previous||command.tick>ticks)throw new EngineError('INVALID_PAYLOAD','Case commands must be ordered within the requested run.');
      previous=command.tick;return command;
    });
    return {id:c.id,options,ticks,commands};
  });
  if(totalTicks>500000)throw new EngineError('INVALID_PAYLOAD','Sweep exceeds 500000 total ticks; split it into separate runs.');
  return cases;
}

/** Independent worker-owned specimens; scheduling never changes fixed simulation ticks. */
export async function runStudioSweep(input: readonly StudioSweepCase[], options: StudioSweepOptions = {}): Promise<StudioSweepResult[]> {
  const cases=validateStudioSweep(input);
  const concurrency=integer(options.concurrency??2,'concurrency',1,4);
  const batchTicks=integer(options.batchTicks??24,'batchTicks',1,120);
  const sampleEveryTicks=integer(options.sampleEveryTicks??120,'sampleEveryTicks',12,72000);
  if(sampleEveryTicks%12!==0)throw new EngineError('INVALID_PAYLOAD','sampleEveryTicks must be a multiple of 12.');
  if(options.includeCheckpoint!==undefined&&typeof options.includeCheckpoint!=='boolean')throw new EngineError('INVALID_PAYLOAD','includeCheckpoint must be boolean.');
  if(options.retainCheckpoints!==undefined&&typeof options.retainCheckpoints!=='boolean')throw new EngineError('INVALID_PAYLOAD','retainCheckpoints must be boolean.');
  if(options.includeCheckpoint&&options.retainCheckpoints===false&&!options.onResult)throw new EngineError('INVALID_PAYLOAD','Streaming checkpoints requires an onResult sink.');
  if(options.includeCheckpoint&&cases.length>64&&options.retainCheckpoints!==false)throw new EngineError('INVALID_PAYLOAD','Sweeps above 64 cases must stream checkpoints to an onResult sink.');
  const results=new Array<StudioSweepResult>(cases.length), clients=new Set<StudioClient>();
  let next=0,stopped=false;
  const stop=()=>{stopped=true;for(const client of clients)void client.destroy();};
  options.signal?.addEventListener('abort',stop,{once:true});
  if(options.signal?.aborted)stop();
  const run=async(index:number)=>{
    const c=cases[index],start=performance.now();
    const result:StudioSweepResult={id:c.id,status:'cancelled',requestedTicks:c.ticks,completedTicks:0,completionReason:'cancelled',samples:[],events:[],final:null,wallMs:0,simMs:0};
    let client:StudioClient|undefined;
    try {
      if(stopped)return result;
      client=await createStudioClient(c.options,options.transport);
      clients.add(client);
      if(stopped)return result;
      result.capabilities=client.capabilities;result.transport=client.mode;
      const initial=await client.inspect();
      try{result.final={...initial.liveSnapshot.response};result.samples.push({tick:0,response:{...result.final}});}finally{initial.release();}
      let commandIndex=0;
      while(!stopped&&client.tick<c.ticks){
        const ticks=Math.min(batchTicks,c.ticks-client.tick),commands:StudioCommand[]=[];
        while(c.commands?.[commandIndex]&&c.commands[commandIndex].tick<=client.tick+ticks)commands.push(c.commands[commandIndex++]);
        const step=await client.step({ticks,commands});
        try{
          result.completedTicks=step.tick;result.simMs+=step.simMs;
          result.final={...step.liveSnapshot.response};
          for(const sample of step.recordingSamples)if(sample.tick%sampleEveryTicks===0)result.samples.push({tick:sample.tick,response:{...sample.snapshot.response}});
          result.events.push(...step.eventDelta.map(event=>({...event})));
          if(step.completed||step.tick===c.ticks){
            result.status='completed';result.completionReason=step.completionReason==='press-complete'?'press-complete':'tick-limit';
          }
        }finally{step.release();}
        options.onProgress?.({id:c.id,index,tick:result.completedTicks,requestedTicks:c.ticks});
        if(result.status==='completed')break;
        // Also gives synchronous fallback a cancellation opportunity between bounded batches.
        await new Promise<void>(resolve=>setTimeout(resolve,0));
      }
      if(stopped){result.status='cancelled';result.completionReason='cancelled';}
      else if(result.status==='completed'&&options.includeCheckpoint)result.checkpoint=await client.exportCheckpoint();
    }catch(error){
      result.status=stopped?'cancelled':'failed';result.completionReason=stopped?'cancelled':'error';
      if(!stopped)result.error=error instanceof Error?error.message:String(error);
    }finally{
      if(result.final&&result.samples.at(-1)?.tick!==result.completedTicks)result.samples.push({tick:result.completedTicks,response:{...result.final}});
      if(client){clients.delete(client);await client.destroy();}
      result.wallMs=performance.now()-start;
    }
    return result;
  };
  const lane=async()=>{
    for(;;){
      const index=next++;if(index>=cases.length)return;
      const result=await run(index);results[index]=result;
      try{await options.onResult?.(result,index);}catch(error){stop();throw error;}
      if(options.retainCheckpoints===false){const {checkpoint:_checkpoint,...summary}=result;results[index]=summary;}
    }
  };
  try{
    const lanes=await Promise.allSettled(Array.from({length:Math.min(concurrency,cases.length)},lane));
    const failed=lanes.find((lane):lane is PromiseRejectedResult=>lane.status==='rejected');
    if(failed)throw failed.reason;
    return results;
  }finally{
    options.signal?.removeEventListener('abort',stop);
    await Promise.allSettled([...clients].map(client=>client.destroy()));
  }
}
