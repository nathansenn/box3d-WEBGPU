/**
 * The GPU fluid program (fluid-program.ts) executed on the CPU in float32, kernel by kernel (fluid-kernels.ts
 * runKernelF32), with the same parameter blocks. It checks the shader logic and runs the validation in the gate.
 * Synchronous.
 */
import {Fluid,type FluidObstacleBand} from '../fluid.ts';
import {FLUID_PASS,KERNELS,runKernelF32,type KernelName,type PassValues} from './fluid-kernels.ts';
import {BLOCK_STRIDE,FluidProgram,fluidStepStats,type FluidBackendOptions,type FluidCommand} from './fluid-program.ts';

export const FLUID_F32_SOLVER_ID='fluid-mac-projection-jacobi-pcg-f32-reference-v1';

export class FluidF32 {
  readonly solver=FLUID_F32_SOLVER_ID;
  readonly program:FluidProgram;readonly fluid:Fluid;
  readonly F:Float32Array;readonly I:Uint32Array;readonly S:Float32Array;
  /** The obstacle sums of the last step (null without obstacles): see FluidProgram.obstacleSums. */
  obstacleSums:{J:Float64Array;M:Float64Array;Mstart:Float64Array|null}|null=null;
  readonly stats={steps:0,pressureIterations:0,viscousIterations:0,divergence:0,unconverged:0};
  time:number;
  private readonly passes:PassValues[]=[];
  constructor(fluid:Fluid,options:FluidBackendOptions={}) {
    this.fluid=fluid;this.program=new FluidProgram(fluid,options);
    const p=this.program.plan;
    this.F=Float32Array.from(p.initialF);this.I=Uint32Array.from(p.initialI);this.S=new Float32Array(p.scalars);
    this.program.load(this.F,fluid.vel,fluid.p);this.time=fluid.time;
  }
  /** The obstacles' band for the next step (Fluid.backendObstacleBand). `step()` sets it itself from the fluid it was built from. */
  setObstacles(band:FluidObstacleBand):void {
    const p=this.program.plan,b=this.program.setBand(band);
    this.I.set(b.entries,p.I.obe);this.F.set(b.floats,p.F.obf);this.I.set(b.header,p.I.obh);
  }
  private pass(block:number):PassValues {
    let v=this.passes[block];
    if(!v){
      const view=new DataView(this.program.plan.blocks,block*BLOCK_STRIDE,FLUID_PASS.size),u=new Uint32Array(16),f=new Float32Array(8);
      for(let k=0;k<16;k++)u[k]=view.getUint32(4*k,true);for(let k=0;k<8;k++)f[k]=view.getFloat32(64+4*k,true);
      v=this.passes[block]={u,f};
    }
    return v;
  }
  /** Run a program to its end. */
  run(program:Generator<FluidCommand,void,Float32Array>):void {
    let next=program.next();
    while(!next.done){
      const cmd=next.value;
      if(cmd.type==='op')runKernelF32(cmd.op.kernel as KernelName,this.pass(cmd.op.block),this.F,this.I,this.S);
      else if(cmd.type==='clear')this.F.fill(0,cmd.offset,cmd.offset+cmd.length);
      next=program.next(this.S);
    }
  }
  /**
   * Take `count` steps. With obstacles, each step takes the band of the fluid it was built from at its present poses
   * (call setObstacleState on that fluid between steps to move them) and hands it the sums, which set its obstacle
   * forces (Fluid.obstacleForce) as a step of the float64 solver does.
   */
  step(count=1):void {
    const obstacles=this.program.plan.obstacles>0;
    for(let s=0;s<count;s++){
      if(obstacles)this.setObstacles(this.fluid.backendObstacleBand());
      this.run(this.program.step());
      if(obstacles){const sums=this.obstacleSums=this.program.obstacleSums(this.S);this.fluid.finishBackendObstacles(sums.J,sums.M,sums.Mstart);}
      const st=fluidStepStats(this.S);
      this.stats.steps++;this.stats.pressureIterations=st.pressureIterations;this.stats.viscousIterations=st.viscousIterations;this.stats.divergence=st.divergence;if(st.unconverged)this.stats.unconverged++;
      this.time+=this.fluid.dt;
    }
  }
  project():void {this.run(this.program.projectOnly());}
  /** Load the fluid's present velocity and pressure (after it was changed from outside). */
  reload():void {this.program.load(this.F,this.fluid.vel,this.fluid.p);}
  /** The velocity component c (padded, as Fluid stores it) and the pressure, as views of F. */
  velocity(c:number):Float32Array {const p=this.program.plan;return this.F.subarray(p.F.vel+c*p.P,p.F.vel+(c+1)*p.P);}
  pressure():Float32Array {const p=this.program.plan;return this.F.subarray(p.F.p,p.F.p+p.N);}
}
export {KERNELS};
