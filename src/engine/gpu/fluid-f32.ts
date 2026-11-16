/**
 * The GPU fluid program (fluid-program.ts) executed on the CPU in float32, kernel by kernel (fluid-kernels.ts
 * runKernelF32), with the same parameter blocks. It checks the shader logic and runs the validation in the gate.
 * Synchronous.
 */
import {Fluid} from '../fluid.ts';
import {FLUID_PASS,KERNELS,runKernelF32,type KernelName,type PassValues} from './fluid-kernels.ts';
import {BLOCK_STRIDE,FLUID_SCALARS,FluidProgram,fluidStepStats,type FluidBackendOptions,type FluidCommand} from './fluid-program.ts';

export const FLUID_F32_SOLVER_ID='fluid-mac-projection-jacobi-pcg-f32-reference-v1';

export class FluidF32 {
  readonly solver=FLUID_F32_SOLVER_ID;
  readonly program:FluidProgram;readonly fluid:Fluid;
  readonly F:Float32Array;readonly I:Uint32Array;readonly S=new Float32Array(FLUID_SCALARS);
  readonly stats={steps:0,pressureIterations:0,viscousIterations:0,divergence:0,unconverged:0};
  time:number;
  private readonly passes:PassValues[]=[];
  constructor(fluid:Fluid,options:FluidBackendOptions={}) {
    this.fluid=fluid;this.program=new FluidProgram(fluid,options);
    const p=this.program.plan;
    this.F=Float32Array.from(p.initialF);this.I=Uint32Array.from(p.initialI);
    this.program.load(this.F,fluid.vel,fluid.p);this.time=fluid.time;
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
  step(count=1):void {
    for(let s=0;s<count;s++){
      this.run(this.program.step());
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
