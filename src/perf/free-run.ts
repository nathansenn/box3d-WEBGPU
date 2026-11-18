/**
 * Wall-clock pacing for a solver that runs free of the renderer (in its own worker).
 *
 * The solver advances whole fixed ticks toward `speed` x wall time. It never runs ahead of that target, and it never
 * owes more than `maxLagSeconds` of simulated time: a backlog beyond that is dropped from the schedule (the solver
 * then runs slower than real time) and counted in `lagSeconds` and `overloads`. Ticks themselves are never skipped,
 * so the result of a run depends only on the fixed step and the ticks at which commands were applied.
 */
export class FreeRunPacer {
  readonly stepSeconds:number;
  readonly maxLagTicks:number;
  speed:number;
  /** Simulated seconds the schedule dropped because the solver could not keep up. */
  lagSeconds=0;
  overloads=0;
  private anchorMs:number;private anchorTick:number;
  constructor(stepSeconds:number,options:{speed:number;maxLagSeconds:number;tick:number;nowMs:number}){
    if(!Number.isFinite(stepSeconds)||stepSeconds<=0)throw new RangeError('Invalid fixed step');
    if(!Number.isFinite(options.speed)||options.speed<=0||options.speed>16)throw new RangeError('Run speed must be in (0, 16]');
    if(!Number.isFinite(options.maxLagSeconds)||options.maxLagSeconds<stepSeconds||options.maxLagSeconds>60)throw new RangeError('Maximum lag must be between one step and 60 s');
    if(!Number.isSafeInteger(options.tick)||options.tick<0||!Number.isFinite(options.nowMs))throw new RangeError('Invalid pacer origin');
    this.stepSeconds=stepSeconds;this.speed=options.speed;this.maxLagTicks=Math.max(1,Math.round(options.maxLagSeconds/stepSeconds));
    this.anchorMs=options.nowMs;this.anchorTick=options.tick;
  }
  /** The tick the schedule has reached at `nowMs`. */
  private target(nowMs:number):number {return this.anchorTick+Math.floor(Math.max(0,nowMs-this.anchorMs)/1000*this.speed/this.stepSeconds+1e-9);}
  /** Ticks owed at `nowMs` for a solver at `tick`, never more than the lag bound. */
  due(nowMs:number,tick:number):number {
    const owed=this.target(nowMs)-tick;
    if(owed>this.maxLagTicks){
      // Re-anchor so exactly maxLagTicks are owed; the rest of the backlog is dropped and reported.
      this.lagSeconds+=(owed-this.maxLagTicks)*this.stepSeconds;this.overloads++;
      this.anchorTick=tick+this.maxLagTicks;this.anchorMs=nowMs;return this.maxLagTicks;
    }
    return Math.max(0,owed);
  }
  /** Wall time (ms) at which the tick after `tick` falls due. */
  nextDueMs(tick:number):number {return this.anchorMs+Math.max(0,tick+1-this.anchorTick)*this.stepSeconds/this.speed*1000;}
  /** A new speed takes effect from `tick` at `nowMs`, without a catch-up burst. */
  retime(nowMs:number,tick:number,speed:number):void {
    if(!Number.isFinite(speed)||speed<=0||speed>16)throw new RangeError('Run speed must be in (0, 16]');
    this.speed=speed;this.anchorMs=nowMs;this.anchorTick=tick;
  }
}
