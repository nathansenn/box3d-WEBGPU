export interface GpuStartupOptions {
  onStartupProgress?:(stage:string)=>void;
  /** Total initialization budget. Does not limit an already running renderer. */
  startupTimeoutMs?:number;
  /** Cancels initialization only; ownership passes to the caller on success. */
  signal?:AbortSignal;
}

/** Bounds asynchronous driver calls, including drivers that never settle a promise. */
export class GpuStartupBudget {
  private readonly deadline:number;
  private readonly options:GpuStartupOptions;
  private readonly label:string;
  private failure:Error|null=null;
  constructor(options:GpuStartupOptions={},label='GPU') {
    this.options=options;this.label=label;
    const milliseconds=options.startupTimeoutMs??30000;
    if(!Number.isFinite(milliseconds)||milliseconds<1||milliseconds>120000)throw new RangeError('GPU startup timeout must be 1–120000 ms.');
    this.deadline=performance.now()+milliseconds;
  }
  check(stage:string):void {
    if(this.failure)throw this.failure;
    if(this.options.signal?.aborted){this.failure=new Error(`${this.label} startup cancelled during ${stage}.`);this.failure.name='AbortError';throw this.failure;}
    if(performance.now()>=this.deadline){this.failure=new Error(`${this.label} startup timed out during ${stage}.`);throw this.failure;}
  }
  async wait<T>(stage:string,start:()=>Promise<T>|T,discardLate?:(value:T)=>void):Promise<T> {
    this.check(stage);this.options.onStartupProgress?.(stage);this.check(stage);
    const signal=this.options.signal;
    return await new Promise<T>((resolve,reject)=>{
      let settled=false;
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);};
      const fail=(error:unknown)=>{
        if(settled)return;settled=true;cleanup();
        this.failure=error instanceof Error?error:new Error(String(error));reject(this.failure);
      };
      const abort=()=>{const error=new Error(`${this.label} startup cancelled during ${stage}.`);error.name='AbortError';fail(error);};
      const timer=setTimeout(()=>fail(new Error(`${this.label} startup timed out during ${stage}.`)),Math.max(1,this.deadline-performance.now()));
      signal?.addEventListener('abort',abort,{once:true});
      // Recheck in the microtask so immediate cancellation cannot start work.
      void Promise.resolve().then(()=>{this.check(stage);return start();}).then(value=>{
        if(settled){discardLate?.(value);return;}
        try{this.check(stage);}catch(error){discardLate?.(value);fail(error);return;}
        settled=true;cleanup();resolve(value);
      },fail).catch(fail);
    });
  }
}
