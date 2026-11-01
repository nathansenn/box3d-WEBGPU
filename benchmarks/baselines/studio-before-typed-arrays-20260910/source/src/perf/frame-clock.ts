/** Fixed ticks remain contiguous even when the display falls behind wall time. */
export class FixedFrameClock {
  readonly stepSeconds:number;
  readonly maxSteps:number;
  accumulator=0;
  lagSeconds=0;
  overloads=0;
  private lastMs:number|undefined;
  constructor(stepSeconds:number,maxSteps:number){
    if(!Number.isFinite(stepSeconds)||stepSeconds<=0||!Number.isSafeInteger(maxSteps)||maxSteps<1)throw new RangeError('Invalid fixed-frame budget');
    this.stepSeconds=stepSeconds;this.maxSteps=maxSteps;
  }
  advance(nowMs:number,speed=1,running=true):number {
    if(!Number.isFinite(nowMs)||!Number.isFinite(speed)||speed<0)throw new RangeError('Invalid frame clock input');
    const elapsed=this.lastMs===undefined?0:Math.max(0,(nowMs-this.lastMs)/1000);this.lastMs=nowMs;
    if(!running){this.accumulator=0;return elapsed;}
    const incoming=elapsed*speed,budget=this.stepSeconds*this.maxSteps;
    this.accumulator+=incoming;
    if(this.accumulator>budget){this.lagSeconds+=this.accumulator-budget;this.accumulator=budget;this.overloads++;}
    return elapsed;
  }
  takeSteps():number {
    const steps=Math.min(this.maxSteps,Math.floor((this.accumulator+1e-12)/this.stepSeconds));
    this.accumulator=Math.max(0,this.accumulator-steps*this.stepSeconds);return steps;
  }
  reset(clearLag=false):void {this.accumulator=0;this.lastMs=undefined;if(clearLag){this.lagSeconds=0;this.overloads=0;}}
}

/** Sampling allocates no arrays; sorting is reserved for low-frequency diagnostics. */
export class StageTimings {
  readonly capacity:number;
  private readonly stages=new Map<string,{values:Float64Array;head:number;count:number}>();
  constructor(names:readonly string[],capacity=240){
    if(!Number.isSafeInteger(capacity)||capacity<1)throw new RangeError('Invalid timing capacity');
    this.capacity=capacity;for(const name of names)this.stages.set(name,{values:new Float64Array(capacity),head:0,count:0});
  }
  sample(name:string,milliseconds:number):void {
    const stage=this.stages.get(name);if(!stage)throw new RangeError(`Unknown timing stage: ${name}`);
    if(!Number.isFinite(milliseconds)||milliseconds<0)return;
    stage.values[stage.head]=milliseconds;stage.head=(stage.head+1)%this.capacity;stage.count=Math.min(this.capacity,stage.count+1);
  }
  reset():void {for(const stage of this.stages.values()){stage.head=0;stage.count=0;}}
  inspect():Record<string,{count:number;p50:number|null;p95:number|null;p99:number|null}> {
    const result:Record<string,{count:number;p50:number|null;p95:number|null;p99:number|null}>={};
    for(const [name,stage] of this.stages){
      const values=Array.from(stage.values.subarray(0,stage.count)).sort((a,b)=>a-b);
      const percentile=(p:number)=>values.length?values[Math.max(0,Math.ceil(values.length*p)-1)]:null;
      result[name]={count:stage.count,p50:percentile(.5),p95:percentile(.95),p99:percentile(.99)};
    }
    return result;
  }
}
