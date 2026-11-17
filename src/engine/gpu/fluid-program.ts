/**
 * The algorithm of the GPU fluid backend as one program of kernel calls (fluid-kernels.ts), shared by the GPU
 * (fluid-gpu.ts) and the float32 CPU reference (fluid-f32.ts), so that the two cannot drift apart.
 *
 * A step is the float64 solver's (fluid.ts) incremental projection without obstacles:
 *   fill the ghosts; advect (central or upwind, Adams-Bashforth 2); the predictor with grad p^n, gravity and the
 *   explicit part of the viscosity; the implicit part (Crank-Nicolson or backward Euler) by conjugate gradients with
 *   the Jacobi preconditioner, component by component; the outflows; the projection by conjugate gradients with the
 *   Jacobi preconditioner (the float64 solver uses MIC(0) or multigrid); the pressure update.
 * Every solve stops on the float64 solver's tests (max |r| against the tolerance), checked on the GPU; the host reads the
 * 48 scalars every BATCH iterations to see whether to go on. `program()` is a generator: it yields the kernel calls,
 * region clears and the points where it needs the scalars, which the executor sends back.
 */
import {EngineError} from '../contracts.ts';
import {checkpointError,readCheckpoint,writeCheckpoint,type StateObject} from '../checkpoint.ts';
import type {Fluid,FluidBackendDescription,FluidObstacleBand} from '../fluid.ts';
import {FLUID_PASS,SCALAR_ALPHA,SCALAR_BETA,SCALAR_PCHECK,SCALAR_PEND,SCALAR_PSTART,SCALAR_VCHECK,SCALAR_VSTART,SLOT_BMAX,SLOT_DONE,SLOT_DOT,SLOT_IT,SLOT_RMAX,SLOT_RZ,SLOT_RZNEW,SOLVE_SLOTS,groupSize,type KernelName} from './fluid-kernels.ts';

/** Conjugate-gradient iterations between two reads of the scalars. */
export const FLUID_BATCH=16;
/** Scalar slots: the pressure solve, the three viscous solves, then the statistics. */
export const S_PRESSURE=0,S_VISCOUS=SOLVE_SLOTS,S_SUM=4*SOLVE_SLOTS,S_VMAX=S_SUM+1,S_COMPONENT_MAX=S_SUM+2,S_DIVMAX=S_SUM+5,S_UNCONVERGED=S_SUM+6,S_VISCOUS_IT=S_SUM+7,FLUID_SCALARS=64;
/** At most this many obstacles on the GPU (the per-obstacle sums take 36 scalars each). */
export const FLUID_MAX_OBSTACLES=1024;

export interface FluidOp {readonly kernel:KernelName;readonly block:number;readonly n:number;readonly groups:readonly [number,number]}
export type FluidCommand=
  |{readonly type:'op';readonly op:FluidOp}
  |{readonly type:'clear';readonly offset:number;readonly length:number}
  |{readonly type:'sync'};

export interface FluidBackendOptions {
  /** max |div u| h / max |u| the projection stops at. Default the fluid's, but not below 2e-6 (float32 cannot do better). */
  readonly pressureTolerance?:number;
  /**
   * The implicit viscous solves stop when max |r| is below this fraction of its value at the start of the solve
   * (default 1e-6), or below half the rounding of b - M x, 2^-25 (1 + 12 k) max |b|, k = theta dt nu / h^2 (float32
   * resolves nothing smaller). The float64 solver's own rule, a
   * fraction of max |b|, would stop a float32 run early: near a steady state the change of a step is below 1e-6 of b,
   * and a solve with nothing left to do freezes the state short of the steady one.
   */
  readonly viscousReduction?:number;
  /** The floor of the viscous stopping rule in units of the rounding of b - M x, 2^-24 (1 + 12 k) max |b|. Default 0.5. */
  readonly viscousFloor?:number;
  /**
   * Room for obstacle faces (the faces within 1.5 cells of an obstacle's surface, over the three components). Default
   * twice the number at the start plus 64 per obstacle; a move that needs more throws GPU_CAPACITY.
   */
  readonly obstacleCapacity?:number;
}
export interface FluidPlan {
  readonly description:FluidBackendDescription;
  readonly P:number;readonly N:number;
  /** Offsets in F (floats) and I (words) and their sizes. */
  readonly F:Record<string,number>;readonly I:Record<string,number>;readonly floats:number;readonly words:number;
  /** Initial contents of F (the constant parts) and I. */
  readonly initialF:Float32Array;readonly initialI:Uint32Array;
  /** Parameter blocks, FLUID_PASS.size bytes each at a stride of 256. */
  readonly blocks:ArrayBuffer;blockCount:number;
  readonly pressureTolerance:number;readonly viscousReduction:number;readonly viscousFloor:number;readonly maxIterations:number;
  readonly implicit:boolean;readonly advect:boolean;
  /** Obstacles, room for their band entries, and the number of scalars (64 plus 36 per obstacle). */
  readonly obstacles:number;readonly obstacleCapacity:number;readonly scalars:number;
}
/** Scalar slots of the obstacle sums: (component c, obstacle o, q) at base + 4 (c O + o) + q. */
export const obstacleSlots=(obstacles:number):{J:number;M:number;Mstart:number}=>({J:FLUID_SCALARS,M:FLUID_SCALARS+12*obstacles,Mstart:FLUID_SCALARS+24*obstacles});
/** The band as the program uploads it: entries (I at obe), their floats (F at obf) and the header with the segments (I at obh). */
export interface FluidBandUpload {readonly entries:Uint32Array;readonly floats:Float32Array;readonly header:Uint32Array;readonly fresh:boolean}
export const BLOCK_STRIDE=256,MAX_BLOCKS=1024;

const groupsFor=(k:KernelName,n:number):[number,number]=>{const g=Math.max(1,Math.ceil(n/groupSize(k)));const x=Math.min(g,65535);return [x,Math.ceil(g/x)];};

/** What the program takes from a Fluid: plain data, so that it can be sent to another thread or page. */
export interface FluidProgramSource {
  readonly description:FluidBackendDescription;readonly cells:number;readonly h:number;readonly density:number;readonly nu:number;readonly dt:number;readonly theta:number;
  readonly gravity:readonly number[];readonly bodyForce:readonly number[];readonly advection:'central'|'upwind'|'none';
  readonly pressureTolerance:number;readonly maxIterations:number;
  /** Number of obstacles and of their band entries at the start (0 and 0 without). */
  readonly obstacles?:number;readonly obstacleFaces?:number;
}
export function fluidProgramSource(fluid:Fluid):FluidProgramSource {
  let obstacleFaces=0;
  if(fluid.obstacleCount>0){const band=fluid.backendObstacleBand();for(const c of band.components)obstacleFaces+=c.face.length;}
  return {description:fluid.backendDescription(),cells:fluid.cells,h:fluid.h,density:fluid.density,nu:fluid.nu,dt:fluid.dt,theta:fluid.theta,gravity:Array.from(fluid.gravity),bodyForce:Array.from(fluid.bodyForce),
    advection:fluid.advection,pressureTolerance:fluid.pressureTolerance,maxIterations:fluid.maxIterations,obstacles:fluid.obstacleCount,obstacleFaces};
}

export class FluidProgram {
  readonly plan:FluidPlan;
  /** True once a step has stored its advection (the next uses Adams-Bashforth). */
  hasPrev=false;
  /** The band of the obstacles as last set (null without obstacles). */
  band:FluidBandUpload|null=null;
  private unknownAt:Int32Array[]=[];
  private readonly ops=new Map<string,FluidOp>();
  private readonly view:DataView;
  private readonly fluid:FluidProgramSource;
  constructor(source:Fluid|FluidProgramSource,options:FluidBackendOptions={}) {
    const fluid=this.fluid='description' in source?source:fluidProgramSource(source);
    const d=fluid.description,P=d.size,N=fluid.cells,C=d.components;
    const F:Record<string,number>={},I:Record<string,number>={};let floats=0,words=0;
    const f=(name:string,size:number):number=>{F[name]=floats;floats+=Math.max(1,size);return F[name];};
    const w=(name:string,size:number):number=>{I[name]=words;words+=Math.max(1,size);return I[name];};
    const maxList=Math.max(N,...C.map(c=>c.unknown.length));
    f('vel',3*P);f('adv',3*P);f('prev',3*P);f('rhs',3*P);f('gp',3*P);
    for(let c=0;c<3;c++){f(`ga${c}`,C[c].ghostA.length);f(`gb${c}`,C[c].ghostB.length);f(`fix${c}`,C[c].fixedValues.length);f(`wl${c}`,C[c].gradWL.length);f(`wh${c}`,C[c].gradWH.length);}
    for(const name of ['p','phi','r','z','d','ad','invDiag','diag','tmp'])f(name,N);
    f('vx',P);f('vd',P);for(const name of ['vb','vr','vz','vq'])f(name,maxList);
    f('part',Math.ceil(maxList/256)+1);
    for(let c=0;c<3;c++){w(`unk${c}`,C[c].unknown.length);w(`cop${c}`,C[c].copies.length);w(`out${c}`,C[c].outflows.length);w(`fixf${c}`,C[c].fixedFaces.length);w(`gh${c}`,2*C[c].ghostDst.length);w(`grad${c}`,3*C[c].gradFace.length);}
    w('pad',N);w('nbr',6*N);
    const obstacles=fluid.obstacles??0;
    if(obstacles>FLUID_MAX_OBSTACLES)throw new EngineError('GPU_CAPACITY',`At most ${FLUID_MAX_OBSTACLES} obstacles on the GPU.`);
    const obstacleCapacity=obstacles>0?Math.max(1,Math.floor(options.obstacleCapacity??2*(fluid.obstacleFaces??0)+64*obstacles)):0;
    if(obstacles>0){f('obf',6*obstacleCapacity);f('obv',obstacleCapacity);f('obc',obstacleCapacity);f('obr',obstacleCapacity);w('obe',4*obstacleCapacity);w('obh',6+6*obstacles);}
    const initialF=new Float32Array(floats),initialI=new Uint32Array(words),Ii=new Int32Array(initialI.buffer);
    for(let c=0;c<3;c++){
      const k=C[c];
      initialF.set(k.ghostA,F[`ga${c}`]);initialF.set(k.ghostB,F[`gb${c}`]);initialF.set(k.fixedValues,F[`fix${c}`]);initialF.set(k.gradWL,F[`wl${c}`]);initialF.set(k.gradWH,F[`wh${c}`]);
      initialI.set(k.unknown,I[`unk${c}`]);initialI.set(k.copies,I[`cop${c}`]);initialI.set(k.outflows,I[`out${c}`]);initialI.set(k.fixedFaces,I[`fixf${c}`]);
      for(let q=0;q<k.ghostDst.length;q++){initialI[I[`gh${c}`]+2*q]=k.ghostDst[q];initialI[I[`gh${c}`]+2*q+1]=k.ghostSrc[q];}
      for(let q=0;q<k.gradFace.length;q++){const b=I[`grad${c}`]+3*q;initialI[b]=k.gradFace[q];initialI[b+1]=k.gradLow[q];initialI[b+2]=k.gradHigh[q];}
    }
    initialI.set(d.cellPad,I.pad);Ii.set(d.nbr,I.nbr);
    for(let c=0;c<N;c++){initialF[F.diag+c]=d.diag[c];initialF[F.invDiag+c]=d.diag[c]>0?1/d.diag[c]:0;}
    const maxIterations=fluid.maxIterations;
    if(maxIterations>2**24)throw new EngineError('INVALID_PAYLOAD','maxIterations above 2^24 cannot be counted in float32.');
    this.plan={description:d,P,N,F,I,floats,words,initialF,initialI,blocks:new ArrayBuffer(BLOCK_STRIDE*MAX_BLOCKS),blockCount:0,
      pressureTolerance:Math.max(options.pressureTolerance??fluid.pressureTolerance,2e-6),viscousReduction:options.viscousReduction??1e-6,viscousFloor:options.viscousFloor??0.5,maxIterations,
      implicit:fluid.theta>0&&fluid.nu>0,advect:fluid.advection!=='none',obstacles,obstacleCapacity,scalars:FLUID_SCALARS+36*obstacles};
    if(obstacles>0){
      this.unknownAt=d.components.map(k=>{const at=new Int32Array(P).fill(-1);k.unknown.forEach((f,i)=>{at[f]=i;});return at;});
      // No band until one is set: every component empty.
      this.band={entries:new Uint32Array(0),floats:new Float32Array(0),header:new Uint32Array(6+6*obstacles),fresh:false};
    }
    this.view=new DataView(this.plan.blocks);
    if(4*floats>2**31||4*words>2**31)throw new EngineError('GPU_UNAVAILABLE','The fluid grid is too large for one storage buffer.');
  }
  /** The op for a kernel with these parameters (one parameter block per distinct call). */
  op(kernel:KernelName,u:readonly number[],fv:readonly number[]=[]):FluidCommand {
    const key=`${kernel}|${u.join(',')}|${fv.join(',')}`;
    let op=this.ops.get(key);
    if(!op){
      const plan=this.plan;if(plan.blockCount>=MAX_BLOCKS)throw new EngineError('GPU_CAPACITY','The fluid program needs more parameter blocks than it has room for.');
      const values:Record<string,number>={};u.forEach((v,k)=>{values[`u${k}`]=v;});fv.forEach((v,k)=>{values[`f${k}`]=v;});
      FLUID_PASS.write(new DataView(plan.blocks,plan.blockCount*BLOCK_STRIDE,FLUID_PASS.size),values);
      const n=kernel==='scalar'||kernel==='finish'?1:u[0];
      op={kernel,block:plan.blockCount++,n,groups:kernel==='scalar'||kernel==='finish'?[1,1]:kernel==='segSum'?[u[0],1]:groupsFor(kernel,u[0])};
      this.ops.set(key,op);
    }
    return {type:'op',op};
  }
  get blockCount():number {return this.plan.blockCount;}

  /**
   * The obstacles' band for the next step (Fluid.backendObstacleBand of the fluid this program was built from): the
   * entries grouped by component, then obstacle, then face, rounded to float32. The executor uploads `band` before it
   * runs the step.
   */
  setBand(band:FluidObstacleBand):FluidBandUpload {
    const p=this.plan,O=p.obstacles;
    if(O===0||band.obstacles!==O)throw new EngineError('INVALID_PAYLOAD',`This fluid program was built for ${O} obstacles; the band has ${band.obstacles}.`);
    let n=0;for(const k of band.components)n+=k.face.length;
    if(n>p.obstacleCapacity)throw new EngineError('GPU_CAPACITY',`The obstacles cover ${n} faces; the fluid program has room for ${p.obstacleCapacity} (FluidBackendOptions.obstacleCapacity).`);
    const entries=new Uint32Array(4*n),floats=new Float32Array(6*n),header=new Uint32Array(6+6*O),rhoDV=this.fluid.density*this.fluid.h**3;
    let e=0;
    for(let c=0;c<3;c++){
      const k=band.components[c],at=this.unknownAt[c];
      header[2*c]=e;header[2*c+1]=k.face.length;
      for(let o=0;o<O;o++){header[6+2*(c*O+o)]=e;header[6+2*(c*O+o)+1]=0;}
      for(let i=0;i<k.face.length;i++,e++){
        const f=k.face[i],pos=at[f];
        if(pos<0)throw new EngineError('INVALID_PAYLOAD',`Obstacle face ${f} of component ${c} is not an unknown face.`);
        entries.set([f,k.outFace[i],pos,k.mode[i]],4*e);
        floats.set([k.target[i],k.weight[i],rhoDV*k.alpha[i],k.arm[3*i],k.arm[3*i+1],k.arm[3*i+2]],6*e);
        header[6+2*(c*O+k.owner[i])+1]++;
      }
      // Segment starts follow the entries (grouped by obstacle in index order).
      let start=header[2*c];for(let o=0;o<O;o++){header[6+2*(c*O+o)]=start;start+=header[6+2*(c*O+o)+1];}
    }
    let fresh=false;for(let o=0;o<O;o++)if(band.fresh[o])fresh=true;
    return this.band={entries,floats,header,fresh};
  }
  /** The obstacle sums of the last step from the scalars: per obstacle six numbers each of J, M at the end and (when the band was fresh) M at the start. */
  obstacleSums(S:Float32Array):{J:Float64Array;M:Float64Array;Mstart:Float64Array|null} {
    const O=this.plan.obstacles,slots=obstacleSlots(O),read=(base:number):Float64Array=>{
      const out=new Float64Array(6*O);
      for(let o=0;o<O;o++)for(let c=0;c<3;c++){const at=base+4*(c*O+o);out[6*o+c]=S[at];for(let k=0;k<3;k++)out[6*o+3+k]+=S[at+1+k];}
      return out;
    };
    return {J:read(slots.J),M:read(slots.M),Mstart:this.band?.fresh?read(slots.Mstart):null};
  }

  // ---- building blocks ----
  /** Ghosts of one component in region `base` (copies, then the three passes), with or without the b terms. */
  private *fillComponent(c:number,base:number,homogeneous:boolean):Generator<FluidCommand,void,Float32Array> {
    const p=this.plan,k=p.description.components[c];
    if(k.copies.length)yield this.op('copyPairs',[k.copies.length/2,base,base,p.I[`cop${c}`]]);
    let start=0;
    for(const count of k.ghostPasses){
      if(count>0)yield this.op('ghosts',[count,base,p.I[`gh${c}`]+2*start,p.F[`ga${c}`]+start,p.F[`gb${c}`]+start,homogeneous?1:0]);
      start+=count;
    }
  }
  private *fillVelocity():Generator<FluidCommand,void,Float32Array> {for(let c=0;c<3;c++)yield* this.fillComponent(c,this.plan.F.vel+c*this.plan.P,false);}
  private *reduce(mode:number,x:number,y:number,list:number,n:number,slot:number):Generator<FluidCommand,void,Float32Array> {
    const p=this.plan;
    yield this.op('partial',[n,mode,x,y,list,p.F.part]);
    yield this.op('finish',[Math.ceil(n/256),p.F.part,slot,mode===2||mode===4?1:0]);
  }
  /** Read the scalars; true when the solve at `base` has stopped. `batches` guards against a device that never says so. */
  private *stopped(base:number,batches:number):Generator<FluidCommand,boolean,Float32Array> {
    const S=yield {type:'sync'};
    if(S[base+SLOT_DONE]!==0)return true;
    if(batches*FLUID_BATCH>this.plan.maxIterations+2*FLUID_BATCH)throw new EngineError('GPU_VALIDATION',`A fluid solve ran ${batches*FLUID_BATCH} iterations without stopping (the limit is ${this.plan.maxIterations}): the device returned no valid scalars.`);
    return false;
  }

  private obstacleOp(kernel:'oConstrain'|'oScatter'|'oZero'|'oImpulse'|'oMomentum',c:number,u:readonly number[],fv:readonly number[]=[]):FluidCommand {
    const p=this.plan;return this.op(kernel,[p.obstacleCapacity,p.I.obh,c,p.I.obe,...u],fv);
  }
  /** The momentum inside each obstacle into the scalars at `slot`. */
  private *obstacleMomentum(slot:number):Generator<FluidCommand,void,Float32Array> {
    const p=this.plan,F=p.F;
    for(let c=0;c<3;c++)yield this.obstacleOp('oMomentum',c,[F.vel+c*p.P,F.obf,F.obv]);
    yield this.op('segSum',[12*p.obstacles,p.I.obh+6,F.obv,F.obf,slot]);
  }
  private *project(updatePressure:boolean):Generator<FluidCommand,void,Float32Array> {
    const p=this.plan,F=p.F,d=p.description,N=p.N,fl=this.fluid,h=fl.h,rho=fl.density,dt=fl.dt,B=S_PRESSURE;
    yield this.op('divergence',[N,p.I.pad,F.vel,p.P,d.stride[1],d.stride[2],F.r],[-h*h*rho/dt,1/h]);
    if(d.singular){yield* this.reduce(0,F.r,0,0,N,S_SUM);yield this.op('shift',[N,F.r,S_SUM]);}
    for(let c=0;c<3;c++)yield* this.reduce(4,F.vel+c*p.P,0,p.I[`unk${c}`],d.components[c].unknown.length,S_COMPONENT_MAX+c);
    yield* this.reduce(2,F.r,0,0,N,B+SLOT_RMAX);
    yield this.op('mulArray',[N,F.z,F.r,F.invDiag]);
    yield this.op('copyRegion',[N,F.d,F.z]);
    yield* this.reduce(1,F.r,F.z,0,N,B+SLOT_RZ);
    yield this.op('scalar',[SCALAR_PSTART,B,S_COMPONENT_MAX,S_COMPONENT_MAX+1,S_COMPONENT_MAX+2,S_VMAX],[Math.max(...d.components.map(c=>c.wallSpeed)),p.pressureTolerance*rho*h/dt]);
    yield {type:'clear',offset:F.phi,length:N};
    let batches=0,running=!(yield* this.stopped(B,batches));
    while(running){
      for(let k=0;k<FLUID_BATCH;k++){
        yield this.op('applyA',[N,F.d,F.ad,F.diag,p.I.nbr]);
        yield* this.reduce(1,F.d,F.ad,0,N,B+SLOT_DOT);
        yield this.op('scalar',[SCALAR_ALPHA,B]);
        yield this.op('cgUpdate',[N,F.phi,F.d,F.r,F.ad,B+2]);
        yield* this.reduce(2,F.r,0,0,N,B+SLOT_RMAX);
        yield this.op('scalar',[SCALAR_PCHECK,B]);
        yield this.op('mulArray',[N,F.z,F.r,F.invDiag]);
        yield* this.reduce(1,F.r,F.z,0,N,B+SLOT_RZNEW);
        yield this.op('scalar',[SCALAR_BETA,B],[p.maxIterations]);
        yield this.op('cgDirection',[N,F.d,F.z,B+3]);
      }
      running=!(yield* this.stopped(B,++batches));
    }
    yield this.op('scalar',[SCALAR_PEND,B,S_UNCONVERGED]);
    if(d.singular){yield* this.reduce(0,F.phi,0,0,N,S_SUM);yield this.op('shift',[N,F.phi,S_SUM]);}
    for(let c=0;c<3;c++){const k=d.components[c];if(k.gradFace.length)yield this.op('correct',[k.gradFace.length,p.I[`grad${c}`],F.vel+c*p.P,F.phi,F[`wl${c}`],F[`wh${c}`]],[dt/rho]);}
    if(updatePressure){yield this.op('addRegion',[N,F.p,F.phi]);if(d.singular){yield* this.reduce(0,F.p,0,0,N,S_SUM);yield this.op('shift',[N,F.p,S_SUM]);}}
    yield* this.fillVelocity();
    yield this.op('divergence',[N,p.I.pad,F.vel,p.P,d.stride[1],d.stride[2],F.tmp],[1,1]);
    yield* this.reduce(2,F.tmp,0,0,N,S_DIVMAX);
  }
  /** Implicit viscosity of component c: (1 - theta dt nu L) x = rhs, the result into rhs. */
  private *viscous(c:number):Generator<FluidCommand,void,Float32Array> {
    const p=this.plan,F=p.F,d=p.description,fl=this.fluid,k=d.components[c],n=k.unknown.length,B=S_VISCOUS+SOLVE_SLOTS*c,P=p.P;
    if(n===0)return;
    const kk=fl.theta*fl.dt*fl.nu/(fl.h*fl.h),inv0=1/(1+kk*2*d.activeAxes),list=p.I[`unk${c}`],vel=F.vel+c*P,rhs=F.rhs+c*P,e=d.es;
    yield {type:'clear',offset:F.vx,length:P};
    if(k.fixedFaces.length)yield this.op('setFixed',[k.fixedFaces.length,F.vx,p.I[`fixf${c}`],F[`fix${c}`]]);
    if(k.outflows.length)yield this.op('copyPairs',[k.outflows.length/2,F.vx,vel,p.I[`out${c}`]]);
    // Obstacle faces are known values: in the right-hand side, then out of the unknowns (their residual stays zero).
    const obstacles=p.obstacles>0;
    if(obstacles)yield this.obstacleOp('oScatter',c,[F.vx,F.obc]);
    yield* this.fillComponent(c,F.vx,false);
    yield this.op('viscB',[n,list,F.vx,rhs,F.vb,e[0],e[1],e[2]],[kk]);
    if(obstacles)yield this.obstacleOp('oZero',c,[F.vb,0]);
    yield* this.reduce(2,F.vb,0,0,n,B+SLOT_BMAX);
    yield {type:'clear',offset:F.vx,length:P};yield {type:'clear',offset:F.vd,length:P};
    yield this.op('listCopy',[n,list,F.vx,vel]);
    if(obstacles)yield this.obstacleOp('oZero',c,[F.vx,1]);
    yield* this.fillComponent(c,F.vx,true);
    yield this.op('viscR',[n,list,F.vx,F.vb,F.vr,e[0],e[1],e[2]],[kk]);
    if(obstacles)yield this.obstacleOp('oZero',c,[F.vr,0]);
    yield* this.reduce(2,F.vr,0,0,n,B+SLOT_RMAX);
    // The floor: the rounding of b - M x is about 2^-24 (1 + 12 k) |x|; below a few times that nothing is resolved.
    yield this.op('scalar',[SCALAR_VSTART,B],[p.viscousReduction,p.viscousFloor*2**-24*(1+12*kk)]);
    yield this.op('mulConst',[n,F.vz,F.vr],[inv0]);
    yield this.op('scatter',[n,list,F.vd,F.vz]);
    yield* this.reduce(1,F.vr,F.vz,0,n,B+SLOT_RZ);
    let running=true,batches=0;
    while(running){
      for(let q=0;q<FLUID_BATCH;q++){
        yield* this.reduce(2,F.vr,0,0,n,B+SLOT_RMAX);
        yield this.op('scalar',[SCALAR_VCHECK,B]);
        yield* this.fillComponent(c,F.vd,true);
        yield this.op('viscQ',[n,list,F.vd,F.vq,0,e[0],e[1],e[2]],[kk]);
        if(obstacles)yield this.obstacleOp('oZero',c,[F.vq,0]);
        yield* this.reduce(3,F.vd,F.vq,list,n,B+SLOT_DOT);
        yield this.op('scalar',[SCALAR_ALPHA,B]);
        yield this.op('vUpdate',[n,list,F.vx,F.vd,F.vr,F.vq,F.vz,B+2],[inv0]);
        yield* this.reduce(1,F.vr,F.vz,0,n,B+SLOT_RZNEW);
        yield this.op('scalar',[SCALAR_BETA,B],[p.maxIterations]);
        yield this.op('vDirection',[n,list,F.vd,F.vz,B+3]);
      }
      running=!(yield* this.stopped(B,++batches));
    }
    yield this.op('listCopy',[n,list,rhs,F.vx]);
    if(obstacles)yield this.obstacleOp('oScatter',c,[rhs,F.obc]);
  }
  /** One step. */
  *step():Generator<FluidCommand,void,Float32Array> {
    const p=this.plan,F=p.F,d=p.description,fl=this.fluid,P=p.P,e=d.es,dt=fl.dt,obstacles=p.obstacles>0,slots=obstacleSlots(p.obstacles);
    yield* this.fillVelocity();
    if(obstacles&&this.band!.fresh)yield* this.obstacleMomentum(slots.Mstart);
    if(p.advect)for(let c=0;c<3;c++){const k=d.components[c];if(k.unknown.length)yield this.op('advect',[k.unknown.length,p.I[`unk${c}`],c,F.vel,F.adv+c*P,P,e[0],e[1],e[2],fl.advection==='upwind'?1:0],[1/fl.h]);}
    const explicitLap=fl.theta<1&&fl.nu>0,flags=(p.advect?1:0)|(p.advect&&this.hasPrev?2:0)|(explicitLap?4:0);
    for(let c=0;c<3;c++){
      const k=d.components[c];
      if(k.gradFace.length)yield this.op('gradient',[k.gradFace.length,p.I[`grad${c}`],F.gp+c*P,F.p,F[`wl${c}`],F[`wh${c}`]]);
      if(k.unknown.length)yield this.op('predict',[k.unknown.length,p.I[`unk${c}`],F.vel+c*P,F.adv+c*P,F.prev+c*P,F.gp+c*P,F.rhs+c*P,flags,e[0],e[1],e[2]],
        [dt,fl.gravity[c]+fl.bodyForce[c],1/fl.density,dt*(1-fl.theta)*fl.nu,1/(fl.h*fl.h)]);
      // Obstacle faces: the constrained value (through the predicted face beyond when explicit, the present one when
      // implicit) and the free value; explicit: the constrained value replaces the predicted one now.
      if(obstacles){
        yield this.obstacleOp('oConstrain',c,[(p.implicit?F.vel:F.rhs)+c*P,F.rhs+c*P,F.obf,F.obc,F.obr]);
        if(!p.implicit)yield this.obstacleOp('oScatter',c,[F.rhs+c*P,F.obc]);
      }
    }
    this.hasPrev=p.advect;
    if(p.implicit)for(let c=0;c<3;c++)yield* this.viscous(c);
    for(let c=0;c<3;c++){const k=d.components[c];if(k.unknown.length)yield this.op('listCopy',[k.unknown.length,p.I[`unk${c}`],F.vel+c*P,F.rhs+c*P]);}
    if(obstacles){
      // The constraint impulse on the fluid, u - u_free at the constrained faces (u_free with the implicit viscous term of u).
      for(let c=0;c<3;c++){
        if(p.implicit)yield* this.fillComponent(c,F.vel+c*P,false);
        yield this.obstacleOp('oImpulse',c,[F.vel+c*P,F.obr,F.obv,p.implicit?1:0,e[0],e[1],e[2]],[fl.density*fl.h**3,fl.theta*dt*fl.nu,1/(fl.h*fl.h)]);
      }
      yield this.op('segSum',[12*p.obstacles,p.I.obh+6,F.obv,F.obf,slots.J]);
    }
    for(let c=0;c<3;c++){const k=d.components[c];if(k.outflows.length)yield this.op('copyPairs',[k.outflows.length/2,F.vel+c*P,F.vel+c*P,p.I[`out${c}`]]);}
    yield* this.fillVelocity();
    yield* this.project(true);
    if(obstacles)yield* this.obstacleMomentum(slots.M);
  }
  /** Make the velocity divergence-free without changing the pressure (Fluid.project). */
  *projectOnly():Generator<FluidCommand,void,Float32Array> {
    const p=this.plan,F=p.F,d=p.description,P=p.P;
    for(let c=0;c<3;c++){const k=d.components[c];if(k.outflows.length)yield this.op('copyPairs',[k.outflows.length/2,F.vel+c*P,F.vel+c*P,p.I[`out${c}`]]);}
    yield* this.fillVelocity();
    yield* this.project(false);
  }
  /** A state into F (padded velocities with their ghosts, cell pressures); the next step starts its advection by forward Euler. */
  load(F:Float32Array,velocity:readonly ArrayLike<number>[],pressure:ArrayLike<number>):void {
    const p=this.plan;
    for(let c=0;c<3;c++)F.set(velocity[c],p.F.vel+c*p.P);
    F.set(pressure,p.F.p);this.hasPrev=false;
  }
}

/**
 * Checkpoints of the fluid program (GpuFluid and FluidF32 write and read the same bytes): the face velocities with their
 * ghosts, the previous advection (Adams-Bashforth), the pressure, whether the next step uses Adams-Bashforth, the time
 * and the statistics. Everything else in F is rewritten by a step before it is read, or constant. A checkpoint of one
 * restores into the other; the obstacles' poses and forces belong to the Fluid the backend was built from (its own
 * saveState).
 */
export const FLUID_PROGRAM_CHECKPOINT='fluid-program-f32-v1';
export interface FluidProgramState {readonly vel:Float32Array;readonly prev:Float32Array;readonly p:Float32Array;readonly hasPrev:boolean;readonly time:number;readonly stats:Readonly<Record<string,number>>}
export function writeFluidProgramCheckpoint(plan:FluidPlan,state:FluidProgramState):Uint8Array {
  return writeCheckpoint('gpu-fluid',{format:FLUID_PROGRAM_CHECKPOINT,cells:[...plan.description.cells],P:plan.P,N:plan.N,obstacles:plan.obstacles,vel:state.vel,prev:state.prev,p:state.p,hasPrev:state.hasPrev,time:state.time,stats:{...state.stats}});
}
export function readFluidProgramCheckpoint(plan:FluidPlan,bytes:Uint8Array):FluidProgramState {
  const t=readCheckpoint(bytes,'gpu-fluid') as StateObject;
  if(t.format!==FLUID_PROGRAM_CHECKPOINT)throw checkpointError(`This is a ${String(t.format)} checkpoint; this fluid program reads ${FLUID_PROGRAM_CHECKPOINT}.`);
  const cells=t.cells as number[];
  if(t.P!==plan.P||t.N!==plan.N||t.obstacles!==plan.obstacles||cells.some((c,k)=>c!==plan.description.cells[k]))throw checkpointError(`This checkpoint is of a fluid of ${cells.join(' x ')} cells with ${String(t.obstacles)} obstacles; this one has ${plan.description.cells.join(' x ')} and ${plan.obstacles}.`);
  if(!(t.vel instanceof Float32Array)||t.vel.length!==3*plan.P||!(t.prev instanceof Float32Array)||t.prev.length!==3*plan.P||!(t.p instanceof Float32Array)||t.p.length!==plan.N)throw checkpointError('The fluid checkpoint is malformed.');
  return {vel:t.vel,prev:t.prev,p:t.p,hasPrev:t.hasPrev===true,time:t.time as number,stats:t.stats as Record<string,number>};
}

/** The statistics a step leaves in the scalars. */
export function fluidStepStats(S:Float32Array):{pressureIterations:number;viscousIterations:number;divergence:number;unconverged:boolean;vmax:number} {
  const vmax=S[S_VMAX];
  return {pressureIterations:S[S_PRESSURE+SLOT_IT],viscousIterations:S[S_VISCOUS+SLOT_IT]+S[S_VISCOUS+SOLVE_SLOTS+SLOT_IT]+S[S_VISCOUS+2*SOLVE_SLOTS+SLOT_IT],
    divergence:vmax>0?S[S_DIVMAX]/vmax:0,unconverged:S[S_UNCONVERGED]>0,vmax};
}
export {SLOT_BMAX,SLOT_RZ,SLOT_RZNEW,SLOT_IT,SLOT_DONE};
