/**
 * The contact kernels of the discrete element solver on several threads, over shared memory (SharedArrayBuffer).
 *
 *   const threads = await GranularThreads.create(4, spawnGranularWorker); // or nodeGranularWorker in Node
 *   granular.useExecutor(threads);
 *
 * Each step, the grains are cut into as many runs of consecutive grains as there are threads, of about equal work
 * (pairs plus wall candidates); every thread evaluates the contacts of its run into the contacts' own slots
 * (granular-kernels.ts, demContacts), then the force and torque on each grain of its run (demGather). The calling
 * thread takes the first run and then adds the ledger terms in the one fixed order. No sum depends on how the grains
 * were cut, so the results are those of the single thread to the bit, for any number of threads
 * (tests/engine/granular-parallel.test.mjs).
 *
 * The calling thread blocks while the others work (Atomics.wait): run it in a worker or in Node, not on a page's main
 * thread, where `GranularThreads.available()` says no. Shared memory needs a cross-origin isolated page (COOP and
 * COEP headers; vite.config.ts sets them). The helper threads spin for a short while between steps, then sleep.
 */
import {DEM_ARRAYS,demContacts,demGather,demScratch,type DemArrayName,type DemContext,type DemExecutor} from './granular-kernels.ts';

/** What a helper thread needs from its host: post a message to it, hear from it, end it. */
export interface GranularWorkerHandle {
  postMessage(message:unknown):void;
  onMessage(listener:(message:unknown)=>void):void;
  terminate():void;
}
export type GranularWorkerFactory=()=>GranularWorkerHandle|Promise<GranularWorkerHandle>;

// Control block (Int32): task, sequence, done count, buffer generation, error; for each array of the context its buffer's
// number and length; then a run [start, end) per thread.
const NAMES=Object.keys(DEM_ARRAYS) as DemArrayName[];
const C_TASK=0,C_SEQ=1,C_DONE=2,C_GEN=3,C_ERROR=4,C_IDS=8,C_LENS=C_IDS+NAMES.length,C_RANGES=C_LENS+NAMES.length;
export const GRANULAR_TASK_CONTACTS=1,GRANULAR_TASK_GATHER=2;
/** Spins of a waiting thread before it sleeps (some microseconds). */
const SPIN=4000;

type Shared=Float64Array|Int32Array|Uint8Array;
const make=(type:'f64'|'i32'|'u8',buffer:SharedArrayBuffer):Shared=>type==='f64'?new Float64Array(buffer):type==='i32'?new Int32Array(buffer):new Uint8Array(buffer);

export class GranularThreads implements DemExecutor {
  /** True where the calling thread may block on shared memory (Node, or a worker of a cross-origin isolated page). */
  static available():boolean {
    if(typeof SharedArrayBuffer!=='function'||typeof Atomics!=='object')return false;
    const g=globalThis as {crossOriginIsolated?:boolean;document?:unknown};
    if(g.document!==undefined)return false;
    if(g.crossOriginIsolated===false)return false;
    try{Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,1,0);return true;}catch{return false;}
  }
  /** Start `threads - 1` helper threads (the calling thread is the first) and wait until they are ready. */
  static async create(threads:number,factory:GranularWorkerFactory):Promise<GranularThreads> {
    if(!Number.isInteger(threads)||threads<1||threads>64)throw new RangeError('threads must be an integer in [1, 64].');
    if(!GranularThreads.available())throw new Error('GranularThreads needs SharedArrayBuffer and a thread that may block (a worker, or Node).');
    const control=new Int32Array(new SharedArrayBuffer(4*(C_RANGES+2*threads)));
    const workers:GranularWorkerHandle[]=[];
    try{
      for(let t=1;t<threads;t++){
        const worker=await factory();workers.push(worker);
        await new Promise<void>((resolve,reject)=>{
          worker.onMessage(message=>{const m=message as {type?:string;error?:string};if(m.type==='ready')resolve();else if(m.type==='error')reject(new Error(m.error));});
          worker.postMessage({type:'init',control,index:t});
        });
      }
    }catch(error){for(const w of workers)w.terminate();throw error;}
    return new GranularThreads(threads,control,workers);
  }

  readonly threads:number;
  private readonly control:Int32Array;private readonly workers:GranularWorkerHandle[];
  private readonly ids=new Map<ArrayBufferLike,number>();private generation=0;private readonly scratch=demScratch();private disposed=false;
  private constructor(threads:number,control:Int32Array,workers:GranularWorkerHandle[]){this.threads=threads;this.control=control;this.workers=workers;}

  share<T extends Shared>(array:T):T {
    const Ctor=array.constructor as new (buffer:SharedArrayBuffer,offset:number,length:number)=>T;
    const out=new Ctor(new SharedArrayBuffer(Math.max(8,array.byteLength+7&~7)),0,array.length);
    out.set(array as never);return out;
  }
  /**
   * Name, for the helpers, the buffer and length of every array of the context. A buffer they have not seen yet (a list
   * grew) is sent by message first; the double-buffered neighbour lists then only switch between buffers they know.
   */
  private publish(ctx:DemContext):void {
    const c=this.control;let fresh:{id:number;buffer:ArrayBufferLike;type:string}[]|null=null;
    for(let q=0;q<NAMES.length;q++){
      const key=NAMES[q],a=ctx[key] as Shared;
      if(!(a.buffer instanceof SharedArrayBuffer))throw new Error(`granular: ${key} is not in shared memory.`);
      let id=this.ids.get(a.buffer);
      if(id===undefined){id=this.ids.size+1;this.ids.set(a.buffer,id);(fresh??=[]).push({id,buffer:a.buffer,type:DEM_ARRAYS[key]});}
      c[C_IDS+q]=id;c[C_LENS+q]=a.length;
    }
    if(!fresh)return;
    this.generation++;
    for(const w of this.workers)w.postMessage({type:'buffers',generation:this.generation,buffers:fresh});
    Atomics.store(c,C_GEN,this.generation);
  }
  run(task:'contacts'|'gather',ctx:DemContext,n:number):void {
    if(this.disposed)throw new Error('GranularThreads was disposed.');
    const T=this.threads,c=this.control;
    if(T===1||n<2*T){if(task==='contacts')demContacts(ctx,0,n,this.scratch);else demGather(ctx,0,n);return;}
    this.publish(ctx);
    // Runs of about equal work: pairs and wall candidates (the work before grain i is pairStart[i] + wallStart[i]).
    const ps=ctx.pairStart,ws=ctx.wallStart,total=ps[n]+ws[n]+n;
    let lo=0;
    for(let t=0;t<T;t++){
      let hi=n;
      if(t<T-1){
        const target=total*(t+1)/T;let a=lo,b=n;
        while(a<b){const mid=(a+b)>>1;if(ps[mid]+ws[mid]+mid<target)a=mid+1;else b=mid;}
        hi=a;
      }
      c[C_RANGES+2*t]=lo;c[C_RANGES+2*t+1]=hi;lo=hi;
    }
    Atomics.store(c,C_DONE,0);Atomics.store(c,C_ERROR,0);
    Atomics.store(c,C_TASK,task==='contacts'?GRANULAR_TASK_CONTACTS:GRANULAR_TASK_GATHER);
    Atomics.add(c,C_SEQ,1);Atomics.notify(c,C_SEQ);
    const i0=c[C_RANGES],i1=c[C_RANGES+1];
    if(task==='contacts')demContacts(ctx,i0,i1,this.scratch);else demGather(ctx,i0,i1);
    for(let spins=0;;spins++){
      const done=Atomics.load(c,C_DONE);
      if(done>=T-1)break;
      if(spins>SPIN)Atomics.wait(c,C_DONE,done,50);
    }
    if(Atomics.load(c,C_ERROR))throw new Error('granular: a helper thread failed (see its console).');
  }
  dispose():void {if(this.disposed)return;this.disposed=true;for(const w of this.workers)w.terminate();}
}

/**
 * The helper thread's side. `post` sends to the host. Returns the message handler. Runs whichever task the control
 * block names on the thread's run, then counts itself done.
 */
export function granularWorkerMain(post:(message:unknown)=>void):(message:unknown)=>void {
  let control:Int32Array|null=null,index=0,generation=0,seen=0,running=false;
  const ctx={} as DemContext,scratch=demScratch(),buffers=new Map<number,{buffer:SharedArrayBuffer;type:'f64'|'i32'|'u8'}>();
  const viewId=new Int32Array(NAMES.length),viewLength=new Int32Array(NAMES.length).fill(-1);
  /** Point the context at the arrays the control block names; false when a buffer has not arrived yet. */
  const bind=(c:Int32Array):boolean=>{
    for(let q=0;q<NAMES.length;q++){
      const id=c[C_IDS+q],length=c[C_LENS+q];
      if(viewId[q]===id&&viewLength[q]===length)continue;
      const b=buffers.get(id);if(!b)return false;
      (ctx as unknown as Record<string,Shared>)[NAMES[q]]=make(b.type,b.buffer).subarray(0,length);viewId[q]=id;viewLength[q]=length;
    }
    return true;
  };
  const loop=async():Promise<void>=>{
    const c=control!;
    for(;;){
      let seq=Atomics.load(c,C_SEQ);
      for(let spins=0;seq===seen&&spins<SPIN;spins++)seq=Atomics.load(c,C_SEQ);
      if(seq===seen){
        // Sleep until the next task (a futex wait: woken within microseconds). Messages wait meanwhile; the host sends one
        // only with a new buffer, and raises the generation first, so the check below lets it in.
        Atomics.wait(c,C_SEQ,seen,1000);
        if(Atomics.load(c,C_GEN)!==generation)await new Promise(r=>setTimeout(r,0));
        continue;
      }
      seen=seq;
      // A new buffer arrives by message: let it be handled first.
      while(Atomics.load(c,C_GEN)!==generation||!bind(c))await new Promise(r=>setTimeout(r,0));
      try{
        const i0=c[C_RANGES+2*index],i1=c[C_RANGES+2*index+1],task=Atomics.load(c,C_TASK);
        if(task===GRANULAR_TASK_CONTACTS)demContacts(ctx,i0,i1,scratch);else if(task===GRANULAR_TASK_GATHER)demGather(ctx,i0,i1);
      }catch(error){Atomics.store(c,C_ERROR,1);console.error(error);}
      Atomics.add(c,C_DONE,1);Atomics.notify(c,C_DONE);
    }
  };
  return (message:unknown)=>{
    const m=message as {type:string;control?:Int32Array;index?:number;generation?:number;buffers?:{id:number;buffer:SharedArrayBuffer;type:'f64'|'i32'|'u8'}[]};
    if(m.type==='init'){
      control=m.control!;index=m.index!;seen=Atomics.load(control,C_SEQ);
      post({type:'ready'});
      if(!running){running=true;void loop();}
    }else if(m.type==='buffers'){
      for(const b of m.buffers!)buffers.set(b.id,{buffer:b.buffer,type:b.type});
      generation=m.generation!;
    }
  };
}

/** A helper thread in a browser (a module worker; from a worker of a cross-origin isolated page). */
export function spawnGranularWorker():GranularWorkerHandle {
  const worker=new Worker(new URL('./granular-worker.ts',import.meta.url),{type:'module',name:'granular-helper'});
  return {postMessage:m=>worker.postMessage(m),onMessage:listener=>worker.addEventListener('message',e=>listener((e as MessageEvent).data)),terminate:()=>worker.terminate()};
}
/** A helper thread in Node (worker_threads). The process may exit while it sleeps. */
export async function nodeGranularWorker():Promise<GranularWorkerHandle> {
  const name='node:worker_threads',{Worker:NodeWorker}=await import(/* @vite-ignore */ name) as {Worker:new (url:URL)=>{postMessage(m:unknown):void;on(e:string,l:(m:unknown)=>void):void;terminate():Promise<number>;unref():void}};
  // The file name is built at run time so that a browser bundler does not copy the source as an asset.
  const file='./granular-worker'+'.ts',worker=new NodeWorker(new URL(file,import.meta.url));worker.unref();
  return {postMessage:m=>worker.postMessage(m),onMessage:listener=>worker.on('message',listener),terminate:()=>{void worker.terminate();}};
}
