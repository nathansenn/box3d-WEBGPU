import {EngineError,finite,integer,onlyKeys,record,validateTickBatch,type EngineCapabilities,type EngineRuntime,type FixedTickCommand,type FixedTickStep} from './contracts.ts';
import {frameElementMatrices,frameTransverseSlope,type FrameElement,type FrameElementMatrices} from './frame-element.ts';

export const FRAME_BACKEND='frame-eb-midpoint-js-f64-v1';
export interface FrameConfig {
  dt:number;substeps:number;maxIterations:number;drag:number;gravity:readonly [number,number,number];
  forceTolerance:number;momentTolerance:number;impulseTolerance:number;angularImpulseTolerance:number;
}
export interface FrameDefinition {
  config:FrameConfig;positions:ArrayLike<number>;elements:readonly FrameElement[];
  /** Per node: translation x/y/z then rotation x/y/z. Fixed DOFs stay at zero. */
  fixed?:ArrayLike<number>;displacements?:ArrayLike<number>;velocities?:ArrayLike<number>;forces?:ArrayLike<number>;
  pointMasses?:ArrayLike<number>;pointInertias?:ArrayLike<number>;
}
export interface FrameCommand extends FixedTickCommand {type:'force'|'impulse';node:number;value:readonly [number,number,number,number,number,number]}
export type FrameStepRequest=FixedTickStep<FrameCommand>;
interface SolveStats {iterations:number;converged:boolean;forceResidual:number;momentResidual:number;reason:'converged'|'iteration-limit'|'singular-or-indefinite'}
interface Work {matrixProducts:number;elementVisits:number}
export interface FrameKinematics {maxRotation:number;maxAxialStrain:number;maxTransverseSlope:number;linearKinematicsExceeded:boolean}
export interface FrameDiagnostics extends Work,FrameKinematics {
  time:number;mass:number;kineticEnergy:number;elasticEnergy:number;gravitationalEnergy:number;externalWork:number;dragDissipation:number;
  linearMomentum:[number,number,number];linearizedAngularMomentum:[number,number,number];
  maxForceResidual:number;maxMomentResidual:number;maxImpulseResidual:number;maxAngularImpulseResidual:number;maxIterationsUsed:number;unconvergedSolves:number;
}
export interface FrameSnapshot {
  backend:typeof FRAME_BACKEND;tick:number;positions:Float64Array;displacements:Float64Array;velocities:Float64Array;
  /** Last substep midpoint reactions; translation N, rotation N m. */
  supportReactions:Float64Array;reactionTime:number;
  /** Local K_e*u_e strain-energy gradients, not equilibrated section tractions. */
  elementElasticForces:Float64Array;
  impulses:{support:Float64Array;applied:Float64Array;drag:Float64Array};diagnostics:FrameDiagnostics;
}
export interface FrameStaticSolution extends SolveStats,Work,FrameKinematics {
  displacements:Float64Array;positions:Float64Array;supportReactions:Float64Array;elasticEnergy:number;
  /** Local equilibrated member end actions: K_e*u_e minus consistent gravity.
   * Point loads and point-mass gravity act at joints, outside the element. */
  elementEndForces:Float64Array;
}
export interface FrameCheckpoint {
  format:'box3d-frame-checkpoint';version:1;backend:typeof FRAME_BACKEND;
  definition:{config:FrameConfig;positions:number[];elements:FrameElement[];fixed:number[];pointMasses:number[];pointInertias:number[]};
  state:{tick:number;displacements:number[];velocities:number[];forces:number[];reactions:number[];reactionTime:number;supportImpulse:number[];appliedImpulse:number[];dragImpulse:number[];externalWork:number;dragDissipation:number;
    maxForceResidual:number;maxMomentResidual:number;maxImpulseResidual:number;maxAngularImpulseResidual:number;maxIterationsUsed:number;unconvergedSolves:number;matrixProducts:number;elementVisits:number};
}
const MAX_NODES=4096,MAX_ELEMENTS=8192,MAX_ELEMENT_VISITS=2_000_000;
const zero=(x:number)=>x===0?0:x;
function array(value:unknown,count:number,label:string,min=-1e100,max=1e100):Float64Array {
  if(!Array.isArray(value)&&!(value instanceof Float64Array)&&!(value instanceof Float32Array)&&!(value instanceof Uint8Array))throw new EngineError('INVALID_PAYLOAD',`${label} needs a numeric array.`);
  if(value.length!==count)throw new EngineError('INVALID_PAYLOAD',`${label} has the wrong length.`);
  return Float64Array.from(value,(v,i)=>zero(finite(v,`${label}[${i}]`,min,max)));
}
function configuration(value:unknown):FrameConfig {
  const c=record(value,'config');onlyKeys(c,['dt','substeps','maxIterations','drag','gravity','forceTolerance','momentTolerance','impulseTolerance','angularImpulseTolerance'],'config');
  const gravity=Object.freeze(Array.from(array(c.gravity,3,'gravity',-1e5,1e5))) as unknown as readonly [number,number,number];
  return Object.freeze({dt:finite(c.dt,'dt',1e-6,1/30),substeps:integer(c.substeps,'substeps',1,16),maxIterations:integer(c.maxIterations,'maxIterations',1,1024),drag:zero(finite(c.drag,'drag',0,1000)),gravity,
    forceTolerance:finite(c.forceTolerance,'forceTolerance',1e-14,1),momentTolerance:finite(c.momentTolerance,'momentTolerance',1e-14,1),impulseTolerance:finite(c.impulseTolerance,'impulseTolerance',1e-16,1),angularImpulseTolerance:finite(c.angularImpulseTolerance,'angularImpulseTolerance',1e-16,1)});
}
const work=():Work=>({matrixProducts:0,elementVisits:0});

/** Linear 3D prismatic frames with consistent mass and implicit midpoint dynamics.
 * Small-strain/small-rotation elasticity; no buckling, yielding, contact or shear.
 * Element matrix products avoid allocating a dense global system.
 */
export class FrameRuntime implements EngineRuntime<FrameStepRequest,FrameSnapshot> {
  readonly capabilities:EngineCapabilities;readonly config:FrameConfig;
  private initial:Float64Array;private elements:FrameElementMatrices[];private fixed:Uint8Array;private pointMass:Float64Array;private pointInertia:Float64Array;
  private u:Float64Array;private v:Float64Array;private forces:Float64Array;private gravityForce:Float64Array;private diagonalMass:Float64Array;private diagonalStiffness:Float64Array;
  private reactions:Float64Array;private supportImpulse:Float64Array;private appliedImpulse:Float64Array;private dragImpulse:Float64Array;
  private rhs:Float64Array;private mid:Float64Array;private product:Float64Array;private temp:Float64Array;private residual:Float64Array;private direction:Float64Array;private preconditioned:Float64Array;private ap:Float64Array;
  private currentTick=0;private disposed=false;private failed=false;private reactionTime=0;private totalMass=0;private externalWork=0;private dragDissipation=0;
  private maxForceResidual=0;private maxMomentResidual=0;private maxImpulseResidual=0;private maxAngularImpulseResidual=0;private maxIterationsUsed=0;private unconvergedSolves=0;private lastWork=work();

  constructor(input:FrameDefinition){
    const d=record(input,'definition');onlyKeys(d,['config','positions','elements','fixed','displacements','velocities','forces','pointMasses','pointInertias'],'definition');this.config=configuration(d.config);
    const count=integer((d.positions as ArrayLike<number>)?.length/3,'node count',2,MAX_NODES),size=6*count;
    this.initial=array(d.positions,3*count,'positions',-1e6,1e6);
    if(!Array.isArray(d.elements)||d.elements.length>MAX_ELEMENTS)throw new EngineError('INVALID_PAYLOAD','Invalid frame element count.');
    this.elements=d.elements.map(e=>frameElementMatrices(e,this.initial));
    const flags=d.fixed===undefined?new Float64Array(size):array(d.fixed,size,'fixed',0,1);
    if(!flags.every(v=>v===0||v===1))throw new EngineError('INVALID_PAYLOAD','Fixed flags must be zero or one.');
    this.fixed=Uint8Array.from(flags);
    this.pointMass=d.pointMasses===undefined?new Float64Array(count):array(d.pointMasses,count,'pointMasses',0,1e12);
    this.pointInertia=d.pointInertias===undefined?new Float64Array(3*count):array(d.pointInertias,3*count,'pointInertias',0,1e18);
    this.u=d.displacements===undefined?new Float64Array(size):array(d.displacements,size,'displacements',-1e6,1e6);
    this.v=d.velocities===undefined?new Float64Array(size):array(d.velocities,size,'velocities',-1e9,1e9);
    this.forces=d.forces===undefined?new Float64Array(size):array(d.forces,size,'forces',-1e12,1e12);
    for(let j=0;j<size;j++)if(this.fixed[j]&&(this.u[j]!==0||this.v[j]!==0))throw new EngineError('INVALID_PAYLOAD','Fixed degrees of freedom cannot move.');
    this.diagonalMass=new Float64Array(size);this.diagonalStiffness=new Float64Array(size);
    for(let i=0;i<count;i++){this.totalMass+=this.pointMass[i];for(let k=0;k<6;k++)this.diagonalMass[6*i+k]=k<3?this.pointMass[i]:this.pointInertia[3*i+k-3];}
    for(const e of this.elements){this.totalMass+=e.mass;for(let j=0;j<12;j++){this.diagonalMass[e.dofs[j]]+=e.massMatrix[13*j];this.diagonalStiffness[e.dofs[j]]+=e.stiffness[13*j];}}
    if(!this.diagonalMass.every(v=>Number.isFinite(v)&&v>0))throw new EngineError('INVALID_PAYLOAD','Every frame degree of freedom needs positive mass inertia.');
    this.reactions=new Float64Array(size);this.supportImpulse=new Float64Array(size);this.appliedImpulse=new Float64Array(size);this.dragImpulse=new Float64Array(size);
    this.rhs=new Float64Array(size);this.mid=new Float64Array(size);this.product=new Float64Array(size);this.temp=new Float64Array(size);this.residual=new Float64Array(size);this.direction=new Float64Array(size);this.preconditioned=new Float64Array(size);this.ap=new Float64Array(size);
    this.gravityForce=new Float64Array(size);for(let i=0;i<count;i++)for(let k=0;k<3;k++)this.temp[6*i+k]=this.config.gravity[k];this.multiply(1,0,this.temp,this.gravityForce);
    this.checkWork(this.config.substeps);
    this.capabilities=Object.freeze({adapter:'frame-network',models:Object.freeze([Object.freeze({id:FRAME_BACKEND,name:'Linear Euler-Bernoulli frame',implementation:'javascript',calibration:'uncalibrated-physical'})]),fixedDt:this.config.dt,deterministicCommands:true,checkpoint:true,worker:false,gpuReadback:false,snapshotOwnership:'numeric-copy'});
  }
  get tick():number{return this.currentTick;}
  private alive():void{if(this.disposed)throw new EngineError('DISPOSED','Frame runtime is destroyed.');if(this.failed)throw new EngineError('NUMERICAL_FAILURE','Frame runtime failed; restore a valid checkpoint.');}
  private checkWork(solves:number):void{
    // A solve includes restart/recomputed residual products and impulse accounting.
    if(solves*Math.max(this.elements.length,1)*(2*this.config.maxIterations+8)>MAX_ELEMENT_VISITS)throw new EngineError('WORK_LIMIT','Split the frame request into smaller batches or reduce its solve budget.');
  }
  private multiply(m:number,k:number,x:Float64Array,out:Float64Array,counter?:Work):void{
    out.fill(0);
    if(m!==0)for(let i=0;i<this.pointMass.length;i++)for(let j=0;j<6;j++)out[6*i+j]=m*(j<3?this.pointMass[i]:this.pointInertia[3*i+j-3])*x[6*i+j];
    for(const e of this.elements)for(let i=0;i<12;i++){
      let sum=0;for(let j=0;j<12;j++)sum+=(m*e.massMatrix[12*i+j]+k*e.stiffness[12*i+j])*x[e.dofs[j]];out[e.dofs[i]]+=sum;
    }
    if(counter){counter.matrixProducts++;counter.elementVisits+=this.elements.length;}
  }
  private dot(a:Float64Array,b:Float64Array,free=false):number{let sum=0;for(let j=0;j<a.length;j++)if(!free||!this.fixed[j])sum+=a[j]*b[j];return sum;}
  private norms(values:Float64Array,scale=1):[number,number]{
    let force=0,moment=0;for(let i=0;i<values.length;i+=6){let f=0,t=0;for(let k=0;k<6;k++)if(!this.fixed[i+k]){const q=values[i+k]*scale;if(k<3)f+=q*q;else t+=q*q;}force=Math.max(force,Math.sqrt(f));moment=Math.max(moment,Math.sqrt(t));}return [force,moment];
  }
  private solve(m:number,k:number,rhs:Float64Array,x:Float64Array,scale:number,forceTolerance:number,momentTolerance:number,counter:Work):SolveStats{
    const r=this.residual,z=this.preconditioned,p=this.direction,ap=this.ap;let iterations=0,reason:SolveStats['reason']='iteration-limit';
    for(let j=0;j<x.length;j++)if(this.fixed[j])x[j]=0;
    const refresh=()=>{this.multiply(m,k,x,ap,counter);for(let j=0;j<x.length;j++)r[j]=this.fixed[j]?0:rhs[j]-ap[j];return this.norms(r,scale);};
    let [forceResidual,momentResidual]=refresh(),rz=0,restart=true;
    while(iterations<this.config.maxIterations){
      if(forceResidual<=forceTolerance&&momentResidual<=momentTolerance){reason='converged';break;}
      for(let j=0;j<x.length;j++){
        const diagonal=m*this.diagonalMass[j]+k*this.diagonalStiffness[j];
        if(!this.fixed[j]&&!(diagonal>0)){reason='singular-or-indefinite';break;}
        z[j]=this.fixed[j]?0:r[j]/diagonal;
      }
      if(reason==='singular-or-indefinite')break;
      const nextRz=this.dot(r,z,true),beta=restart?0:nextRz/rz;
      for(let j=0;j<x.length;j++)p[j]=restart?z[j]:z[j]+beta*p[j];rz=nextRz;restart=false;
      this.multiply(m,k,p,ap,counter);const denominator=this.dot(p,ap,true);
      if(!(denominator>0)||!Number.isFinite(denominator)){reason='singular-or-indefinite';break;}
      const alpha=rz/denominator;
      for(let j=0;j<x.length;j++)if(!this.fixed[j]){x[j]+=alpha*p[j];r[j]-=alpha*ap[j];}
      iterations++;[forceResidual,momentResidual]=this.norms(r,scale);
      // Verify apparent convergence against A*x. Restart only after that check:
      // fixed short restart intervals discard useful conjugate directions in
      // slender static beams, whose low bending modes are poorly conditioned.
      if(forceResidual<=forceTolerance&&momentResidual<=momentTolerance){[forceResidual,momentResidual]=refresh();restart=true;}
    }
    [forceResidual,momentResidual]=refresh();
    if(!x.every(Number.isFinite)||!Number.isFinite(forceResidual)||!Number.isFinite(momentResidual))throw new EngineError('NUMERICAL_FAILURE','Nonfinite frame linear solve.');
    const converged=forceResidual<=forceTolerance&&momentResidual<=momentTolerance;
    return {iterations,converged,forceResidual,momentResidual,reason:converged?'converged':reason};
  }
  private command(value:unknown):FrameCommand{
    const c=record(value,'command');onlyKeys(c,['tick','type','node','value'],'command');if(c.type!=='force'&&c.type!=='impulse')throw new EngineError('INVALID_PAYLOAD','Unknown frame command.');
    const node=integer(c.node,'node',0,this.pointMass.length-1),v=array(c.value,6,'command.value',-1e12,1e12),values:FrameCommand['value']=[v[0],v[1],v[2],v[3],v[4],v[5]];
    if(c.type==='impulse'&&values.some((v,k)=>v!==0&&this.fixed[6*node+k]))throw new EngineError('INVALID_PAYLOAD','Cannot apply an impulse to a fixed degree of freedom.');
    return {tick:integer(c.tick,'command.tick',1),type:c.type,node,value:values};
  }
  step(request:FrameStepRequest):FrameSnapshot{
    this.alive();const input=record(request,'step');onlyKeys(input,['ticks','commands'],'step');const {ticks,commands}=validateTickBatch(this.tick,input.ticks,input.commands,v=>this.command(v));
    this.checkWork(ticks*this.config.substeps+commands.filter(c=>c.type==='impulse').length);
    let cursor=0;
    try{for(let tick=0;tick<ticks;tick++){
      this.lastWork=work();this.maxForceResidual=0;this.maxMomentResidual=0;this.maxImpulseResidual=0;this.maxAngularImpulseResidual=0;this.maxIterationsUsed=0;this.unconvergedSolves=0;
      this.supportImpulse.fill(0);this.appliedImpulse.fill(0);this.dragImpulse.fill(0);
      while(commands[cursor]?.tick===this.tick+1){const c=commands[cursor++];if(c.type==='force')for(let k=0;k<6;k++)this.forces[6*c.node+k]=c.value[k];else this.impulse(c);}
      for(let s=0;s<this.config.substeps;s++)this.substep(s);
      this.currentTick++;
    }}catch(error){if(error instanceof EngineError&&error.code==='NUMERICAL_FAILURE')this.failed=true;throw error;}
    return this.inspect();
  }
  private impulse(c:FrameCommand):void{
    this.rhs.fill(0);this.mid.fill(0);for(let k=0;k<6;k++)this.rhs[6*c.node+k]=c.value[k];
    const solved=this.solve(1,0,this.rhs,this.mid,1,this.config.impulseTolerance,this.config.angularImpulseTolerance,this.lastWork);
    this.maxImpulseResidual=Math.max(this.maxImpulseResidual,solved.forceResidual);this.maxAngularImpulseResidual=Math.max(this.maxAngularImpulseResidual,solved.momentResidual);this.maxIterationsUsed=Math.max(this.maxIterationsUsed,solved.iterations);if(!solved.converged)this.unconvergedSolves++;
    this.multiply(1,0,this.v,this.temp,this.lastWork);const before=.5*this.dot(this.v,this.temp);
    for(let j=0;j<this.v.length;j++)this.v[j]=zero(this.v[j]+this.mid[j]);
    this.multiply(1,0,this.v,this.temp,this.lastWork);this.externalWork+=.5*this.dot(this.v,this.temp)-before;
    this.multiply(1,0,this.mid,this.product,this.lastWork);
    for(let j=0;j<this.v.length;j++){this.appliedImpulse[j]+=this.rhs[j];if(this.fixed[j])this.supportImpulse[j]+=this.product[j]-this.rhs[j];}
  }
  private substep(index:number):void{
    const h=this.config.dt/this.config.substeps,m=1+this.config.drag*h/2,k=h*h/4;
    this.multiply(1,0,this.v,this.rhs,this.lastWork);this.multiply(0,1,this.u,this.product,this.lastWork);
    for(let j=0;j<this.u.length;j++){this.rhs[j]+=h/2*(this.forces[j]+this.gravityForce[j]-this.product[j]);this.mid[j]=this.v[j];}
    const solved=this.solve(m,k,this.rhs,this.mid,2/h,this.config.forceTolerance,this.config.momentTolerance,this.lastWork);
    this.maxForceResidual=Math.max(this.maxForceResidual,solved.forceResidual);this.maxMomentResidual=Math.max(this.maxMomentResidual,solved.momentResidual);this.maxIterationsUsed=Math.max(this.maxIterationsUsed,solved.iterations);if(!solved.converged)this.unconvergedSolves++;
    this.multiply(m,k,this.mid,this.product,this.lastWork);this.multiply(1,0,this.mid,this.temp,this.lastWork);
    this.dragDissipation+=h*this.config.drag*this.dot(this.mid,this.temp);
    for(let j=0;j<this.u.length;j++){
      const du=h*this.mid[j];this.externalWork+=this.forces[j]*du;
      this.reactions[j]=this.fixed[j]?zero((this.product[j]-this.rhs[j])*2/h):0;
      this.supportImpulse[j]+=h*this.reactions[j];this.appliedImpulse[j]+=h*(this.forces[j]+this.gravityForce[j]);this.dragImpulse[j]-=h*this.config.drag*this.temp[j];
      this.u[j]=zero(this.u[j]+du);this.v[j]=zero(2*this.mid[j]-this.v[j]);
    }
    if(!this.u.every(Number.isFinite)||!this.v.every(Number.isFinite)||!Number.isFinite(this.externalWork)||!Number.isFinite(this.dragDissipation))throw new EngineError('NUMERICAL_FAILURE','Frame integration produced nonfinite state.');
    this.reactionTime=this.tick*this.config.dt+(index+.5)*h;
  }
  /** Static analysis is pure: it does not reset, settle or advance the runtime. */
  solveStatic(forces?:ArrayLike<number>):FrameStaticSolution{
    this.alive();this.checkWork(1);const applied=forces===undefined?this.forces:array(forces,this.u.length,'static forces',-1e12,1e12),rhs=Float64Array.from(applied,(v,j)=>v+this.gravityForce[j]),solution=new Float64Array(this.u.length),counter=work();
    const solved=this.solve(0,1,rhs,solution,1,this.config.forceTolerance,this.config.momentTolerance,counter),product=new Float64Array(solution.length);this.multiply(0,1,solution,product,counter);
    const endForces=this.elasticElementForces(solution),gravity=new Float64Array(12);
    this.elements.forEach((e,index)=>{
      // Distributed weight has nodal moments as well as nodal forces. Recover
      // equilibrated end actions before reporting a free-end force or moment.
      for(let i=0;i<12;i++){let value=0;for(let j=0;j<12;j++)if(j%6<3)value+=e.massMatrix[12*i+j]*this.config.gravity[j%6];gravity[i]=value;}
      for(let i=0;i<12;i++){let local=0;for(let j=0;j<3;j++)local+=e.basis[3*(i%3)+j]*gravity[i-i%3+j];endForces[12*index+i]=zero(endForces[12*index+i]-local);}
    });
    return {...solved,...counter,...this.kinematics(solution),displacements:solution,positions:this.positions(solution),supportReactions:Float64Array.from(product,(v,j)=>this.fixed[j]?zero(v-rhs[j]):0),elasticEnergy:.5*this.dot(solution,product),elementEndForces:endForces};
  }
  private positions(u:Float64Array):Float64Array{return Float64Array.from(this.initial,(v,j)=>zero(v+u[6*Math.floor(j/3)+j%3]));}
  private localDisplacement(e:FrameElementMatrices,u:Float64Array,local:Float64Array):void{
    for(let i=0;i<12;i++){let value=0;for(let j=0;j<3;j++)value+=e.basis[3*(i%3)+j]*u[e.dofs[i-i%3+j]];local[i]=value;}
  }
  private elasticElementForces(u:Float64Array):Float64Array{
    const forces=new Float64Array(this.elements.length*12),local=new Float64Array(12);
    this.elements.forEach((e,index)=>{this.localDisplacement(e,u,local);for(let i=0;i<12;i++){let f=0;for(let j=0;j<12;j++)f+=e.localStiffness[12*i+j]*local[j];forces[12*index+i]=zero(f);}});return forces;
  }
  private kinematics(u:Float64Array):FrameKinematics{
    let maxRotation=0,maxAxialStrain=0,maxTransverseSlope=0;const local=new Float64Array(12);
    for(let i=0;i<u.length;i+=6)maxRotation=Math.max(maxRotation,Math.hypot(u[i+3],u[i+4],u[i+5]));
    for(const e of this.elements){this.localDisplacement(e,u,local);maxAxialStrain=Math.max(maxAxialStrain,Math.abs(local[6]-local[0])/e.length);maxTransverseSlope=Math.max(maxTransverseSlope,frameTransverseSlope(local,e.length));}
    return {maxRotation,maxAxialStrain,maxTransverseSlope,linearKinematicsExceeded:maxRotation>.1||maxAxialStrain>.01||maxTransverseSlope>.1};
  }
  inspect():FrameSnapshot{
    this.alive();const momentum=new Float64Array(this.u.length),elastic=new Float64Array(this.u.length);this.multiply(1,0,this.v,momentum);this.multiply(0,1,this.u,elastic);
    const linear:[number,number,number]=[0,0,0],angular:[number,number,number]=[0,0,0];
    for(let i=0;i<this.pointMass.length;i++){
      for(let k=0;k<3;k++){linear[k]+=momentum[6*i+k];angular[k]+=momentum[6*i+3+k];}
      const j=3*i,q=6*i;angular[0]+=this.initial[j+1]*momentum[q+2]-this.initial[j+2]*momentum[q+1];angular[1]+=this.initial[j+2]*momentum[q]-this.initial[j]*momentum[q+2];angular[2]+=this.initial[j]*momentum[q+1]-this.initial[j+1]*momentum[q];
    }
    return {backend:FRAME_BACKEND,tick:this.tick,positions:this.positions(this.u),displacements:this.u.slice(),velocities:this.v.slice(),supportReactions:this.reactions.slice(),reactionTime:this.reactionTime,elementElasticForces:this.elasticElementForces(this.u),impulses:{support:this.supportImpulse.slice(),applied:this.appliedImpulse.slice(),drag:this.dragImpulse.slice()},
      diagnostics:{time:this.tick*this.config.dt,mass:this.totalMass,kineticEnergy:.5*this.dot(this.v,momentum),elasticEnergy:.5*this.dot(this.u,elastic),gravitationalEnergy:zero(-this.dot(this.gravityForce,this.u)),externalWork:this.externalWork,dragDissipation:this.dragDissipation,linearMomentum:linear.map(zero) as [number,number,number],linearizedAngularMomentum:angular.map(zero) as [number,number,number],maxForceResidual:this.maxForceResidual,maxMomentResidual:this.maxMomentResidual,maxImpulseResidual:this.maxImpulseResidual,maxAngularImpulseResidual:this.maxAngularImpulseResidual,maxIterationsUsed:this.maxIterationsUsed,unconvergedSolves:this.unconvergedSolves,...this.lastWork,...this.kinematics(this.u)}};
  }
  checkpoint():FrameCheckpoint{
    this.alive();return {format:'box3d-frame-checkpoint',version:1,backend:FRAME_BACKEND,definition:{config:{...this.config,gravity:[...this.config.gravity]},positions:Array.from(this.initial),elements:this.elements.map(e=>({...e.definition,up:[...e.definition.up]})),fixed:Array.from(this.fixed),pointMasses:Array.from(this.pointMass),pointInertias:Array.from(this.pointInertia)},
      state:{tick:this.tick,displacements:Array.from(this.u),velocities:Array.from(this.v),forces:Array.from(this.forces),reactions:Array.from(this.reactions),reactionTime:this.reactionTime,supportImpulse:Array.from(this.supportImpulse,zero),appliedImpulse:Array.from(this.appliedImpulse,zero),dragImpulse:Array.from(this.dragImpulse,zero),externalWork:zero(this.externalWork),dragDissipation:zero(this.dragDissipation),maxForceResidual:this.maxForceResidual,maxMomentResidual:this.maxMomentResidual,maxImpulseResidual:this.maxImpulseResidual,maxAngularImpulseResidual:this.maxAngularImpulseResidual,maxIterationsUsed:this.maxIterationsUsed,unconvergedSolves:this.unconvergedSolves,...this.lastWork}};
  }
  static fromCheckpoint(value:unknown):FrameRuntime{
    const c=record(value,'checkpoint');onlyKeys(c,['format','version','backend','definition','state'],'checkpoint');if(c.format!=='box3d-frame-checkpoint'||c.version!==1||c.backend!==FRAME_BACKEND)throw new EngineError('INVALID_PAYLOAD','Unsupported frame checkpoint.');
    const runtime=new FrameRuntime(c.definition as FrameDefinition);
    try{
      const s=record(c.state,'state');onlyKeys(s,['tick','displacements','velocities','forces','reactions','reactionTime','supportImpulse','appliedImpulse','dragImpulse','externalWork','dragDissipation','maxForceResidual','maxMomentResidual','maxImpulseResidual','maxAngularImpulseResidual','maxIterationsUsed','unconvergedSolves','matrixProducts','elementVisits'],'state');runtime.currentTick=zero(integer(s.tick,'tick'));const size=runtime.u.length;
      runtime.u=array(s.displacements,size,'displacements');runtime.v=array(s.velocities,size,'velocities');runtime.forces=array(s.forces,size,'forces',-1e12,1e12);runtime.reactions=array(s.reactions,size,'reactions');runtime.supportImpulse=array(s.supportImpulse,size,'supportImpulse');runtime.appliedImpulse=array(s.appliedImpulse,size,'appliedImpulse');runtime.dragImpulse=array(s.dragImpulse,size,'dragImpulse');
      for(let j=0;j<size;j++){if(runtime.fixed[j]&&(runtime.u[j]!==0||runtime.v[j]!==0))throw new EngineError('INVALID_PAYLOAD','Checkpoint moved a fixed degree of freedom.');if(!runtime.fixed[j]&&(runtime.reactions[j]!==0||runtime.supportImpulse[j]!==0))throw new EngineError('INVALID_PAYLOAD','Unsupported degree of freedom has a support reaction.');}
      runtime.reactionTime=zero(finite(s.reactionTime,'reactionTime',0,runtime.tick*runtime.config.dt));runtime.externalWork=zero(finite(s.externalWork,'externalWork'));runtime.dragDissipation=zero(finite(s.dragDissipation,'dragDissipation',0));
      for(const key of ['maxForceResidual','maxMomentResidual','maxImpulseResidual','maxAngularImpulseResidual'] as const)runtime[key]=zero(finite(s[key],key,0));
      runtime.maxIterationsUsed=zero(integer(s.maxIterationsUsed,'maxIterationsUsed',0,runtime.config.maxIterations));runtime.unconvergedSolves=zero(integer(s.unconvergedSolves,'unconvergedSolves',0,runtime.config.substeps+64));runtime.lastWork={matrixProducts:zero(integer(s.matrixProducts,'matrixProducts',0,MAX_ELEMENT_VISITS)),elementVisits:zero(integer(s.elementVisits,'elementVisits',0,MAX_ELEMENT_VISITS))};return runtime;
    }catch(error){runtime.destroy();throw error;}
  }
  destroy():void{if(this.disposed)return;this.disposed=true;this.elements=[];this.fixed=new Uint8Array();for(const key of ['initial','pointMass','pointInertia','u','v','forces','gravityForce','diagonalMass','diagonalStiffness','reactions','supportImpulse','appliedImpulse','dragImpulse','rhs','mid','product','temp','residual','direction','preconditioned','ap'] as const)this[key]=new Float64Array();}
}
