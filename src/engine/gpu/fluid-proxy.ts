/**
 * A Fluid whose steps and projections are taken by another backend (the float32 CPU reference, or the GPU through a
 * worker), so that the float64 solver's validation set-ups run on that backend unchanged.
 *
 * `fluidProxy(remote)` returns a class to use in place of `Fluid`. It is a real Fluid: it is built, given a velocity or
 * a pressure, and measured as usual. `step()` and `project()` hand the present velocity and pressure to the remote
 * (once, and again whenever they were set from outside), let it work, and copy the velocity (with its ghosts) and the
 * pressure back, with the time and the solve statistics. Obstacles are refused: the backend has none. The energy ledger
 * (dissipated, work) stays zero.
 */
import {Fluid,type FluidObstacleOptions,type FluidOptions} from '../fluid.ts';
import {EngineError} from '../contracts.ts';
import {FluidF32} from './fluid-f32.ts';
import type {FluidBackendOptions} from './fluid-program.ts';

export interface FluidFrame {readonly u:Float32Array;readonly v:Float32Array;readonly w:Float32Array;readonly p:Float32Array;readonly stats:{pressureIterations:number;viscousIterations:number;divergence:number;unconverged:number}}
export interface FluidRemote {
  create(fluid:Fluid,options:FluidBackendOptions):void;
  /** The fluid's velocity and pressure were set from outside: take them (the next step advects by forward Euler). */
  load(fluid:Fluid):void;
  step(count:number):void;
  project():void;
  read():FluidFrame;
  destroy?():void;
}
export const fluidF32Remote=():FluidRemote=>{
  let solver:FluidF32|null=null;
  return {
    create(fluid,options){solver=new FluidF32(fluid,options);},
    load(){solver!.reload();},
    step(count){solver!.step(count);},
    project(){solver!.project();},
    read(){const s=solver!;return {u:s.velocity(0),v:s.velocity(1),w:s.velocity(2),p:s.pressure(),stats:s.stats};},
  };
};

export function fluidProxy(remote:()=>FluidRemote,options:FluidBackendOptions={}):typeof Fluid {
  return class FluidProxy extends Fluid {
    #remote:FluidRemote|null=null;#dirty=true;
    /** Statistics of the backend. */
    backendStats:FluidFrame['stats']|null=null;
    constructor(init:FluidOptions) {super(init);}
    override addObstacle(_options:FluidObstacleOptions):number {throw new EngineError('INVALID_ARGUMENT','The GPU fluid backend has no obstacles.');}
    override setVelocity(field:(x:number,y:number,z:number)=>ArrayLike<number>):void {super.setVelocity(field);this.#dirty=true;}
    override setPressure(field:(x:number,y:number,z:number)=>number):void {super.setPressure(field);this.#dirty=true;}
    override setState(state:Parameters<Fluid['setState']>[0]):void {super.setState(state);this.#dirty=true;}
    #ready():FluidRemote {
      if(!this.#remote){this.#remote=remote();this.#remote.create(this,options);this.#dirty=false;}
      else if(this.#dirty){this.#remote.load(this);this.#dirty=false;}
      return this.#remote;
    }
    #absorb():void {
      const frame=this.#remote!.read();
      this.u.set(frame.u);this.v.set(frame.v);this.w.set(frame.w);this.p.set(frame.p);
      const st=this.stats,b=frame.stats;st.pressureIterations=b.pressureIterations;st.viscousIterations=b.viscousIterations;st.divergence=b.divergence;st.unconverged=b.unconverged;
      this.backendStats={...b};
    }
    override project():void {this.#ready().project();this.#absorb();}
    override step(count=1):void {
      if(count<=0)return;
      this.#ready().step(count);this.#absorb();
      this.time+=count*this.dt;this.stats.steps+=count;
    }
  };
}
