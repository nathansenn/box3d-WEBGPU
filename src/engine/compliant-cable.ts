import {EngineError,finite,integer,onlyKeys,record,validateTickBatch,type EngineCapabilities,type EngineRuntime,type FixedTickCommand,type FixedTickStep} from './contracts.ts';
import {captureFields,restoreFields,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';
import {EnvelopeMatrix} from './envelope-matrix.ts';

export const COMPLIANT_CABLE_BACKEND='cable-xpbd-js-f64-v1';
export const PROXIMAL_CABLE_BACKEND='cable-proximal-js-f64-v2';
export const NEWTON_CABLE_BACKEND='cable-newton-js-f64-v1';
type CableBackend=typeof COMPLIANT_CABLE_BACKEND|typeof PROXIMAL_CABLE_BACKEND|typeof NEWTON_CABLE_BACKEND;
export interface CableConstraint {a:number;b:number;restLength:number;/** Metres per newton; zero is inextensible. */ compliance:number}
export interface CableConfig {dt:number;substeps:number;maxIterations:number;residualTolerance:number;/** Mass-proportional velocity damping, inverse seconds. */ drag:number;gravity:readonly [number,number,number];/** Omit to retain the original XPBD backend. 'newton' solves the same implicit step as 'proximal' by Newton's method with a direct solve (elastic links only). */ solver?:'proximal'|'newton';/** Required for proximal and Newton solves, in newtons. */ forceTolerance?:number}
export interface CableDefinition {
  config:CableConfig; positions:ArrayLike<number>; masses:ArrayLike<number>;
  pinned?:ArrayLike<number>; velocities?:ArrayLike<number>; forces?:ArrayLike<number>; constraints:readonly CableConstraint[];
}
export interface CableCommand extends FixedTickCommand {type:'force'|'impulse';node:number;value:readonly [number,number,number]}
export type CableStepRequest=FixedTickStep<CableCommand>;
export interface CableDiagnostics {
  time:number; mass:number;kineticEnergy:number;elasticEnergy:number;gravitationalEnergy:number;
  externalWork:number;dragDissipation:number;momentum:[number,number,number];
  maxStrain:number;maxTension:number;maxResidual:number;maxImplicitForceResidual:number;unconvergedSubsteps:number;
  maxIterationsUsed:number;constraintProjections:number;residualEvaluations:number;
  /** Vector constraint residual converted to an edge correction force (v2). */
  maxConstraintForceResidual?:number;
}
export interface CableSnapshot {
  backend:CableBackend;tick:number;positions:Float64Array;velocities:Float64Array;
  tensions:Float64Array;supportReactions:Float64Array;diagnostics:CableDiagnostics;
  /** Actual accumulated impulses during the last complete tick, N s (v2 only). */
  impulses?:{support:Float64Array;applied:[number,number,number];drag:[number,number,number]};
}
export interface CableCheckpoint {
  format:'box3d-compliant-cable';version:1|2;backend:CableBackend;
  definition:{config:CableConfig;positions:number[];masses:number[];pinned:number[];constraints:CableConstraint[]};
  state:{tick:number;positions:number[];velocities:number[];forces:number[];multipliers:number[];
    externalWork:number;dragDissipation:number;maxResidual:number;maxImplicitForceResidual:number;unconvergedSubsteps:number;
    maxIterationsUsed:number;constraintProjections:number;residualEvaluations:number;
    maxConstraintForceResidual?:number;vectorMultipliers?:number[];impulses?:{support:number[];applied:[number,number,number];drag:[number,number,number]}};
}

const MAX_NODES=16384,MAX_LINKS=65536,MAX_PROJECTIONS_PER_BATCH=16_000_000;
const canonicalZero=(value:number):number=>value===0?0:value;
function vector(value:unknown,label:string):[number,number,number] {
  if(!Array.isArray(value)||value.length!==3)throw new EngineError('INVALID_PAYLOAD',`${label} must have three components.`);
  return value.map((v,i)=>canonicalZero(finite(v,`${label}[${i}]`,-1e9,1e9))) as [number,number,number];
}
function numbers(value:unknown,count:number,label:string,min=-1e100,max=1e100):Float64Array {
  if(!Array.isArray(value)&&!(value instanceof Float64Array)&&!(value instanceof Float32Array)&&!(value instanceof Uint8Array))throw new EngineError('INVALID_PAYLOAD',`${label} must be a numeric array.`);
  if(value.length!==count)throw new EngineError('INVALID_PAYLOAD',`${label} has the wrong length.`);
  const result=new Float64Array(count);
  for(let i=0;i<count;i++)result[i]=canonicalZero(finite(value[i],`${label}[${i}]`,min,max));
  return result;
}
function config(value:unknown):CableConfig {
  const c=record(value,'config');onlyKeys(c,['dt','substeps','maxIterations','residualTolerance','drag','gravity','solver','forceTolerance'],'config');
  if(c.solver!==undefined&&c.solver!=='proximal'&&c.solver!=='newton')throw new EngineError('INVALID_PAYLOAD','Unknown cable solver.');
  if(c.solver===undefined&&c.forceTolerance!==undefined)throw new EngineError('INVALID_PAYLOAD','Force tolerance requires the proximal solver.');
  return Object.freeze({dt:finite(c.dt,'dt',1e-6,1/30),substeps:integer(c.substeps,'substeps',1,16),maxIterations:integer(c.maxIterations,'maxIterations',1,c.solver!==undefined?4096:256),
    residualTolerance:canonicalZero(finite(c.residualTolerance,'residualTolerance',0,1e-2)),drag:canonicalZero(finite(c.drag,'drag',0,1000)),gravity:Object.freeze(vector(c.gravity,'gravity')),
    ...(c.solver==='proximal'?{solver:'proximal' as const,forceTolerance:canonicalZero(finite(c.forceTolerance,'forceTolerance',0,1))}:{}),
    ...(c.solver==='newton'?{solver:'newton' as const,forceTolerance:canonicalZero(finite(c.forceTolerance,'forceTolerance',0,1))}:{})});
}

/** SI, tension-only axial cables. Fixed anchors exchange reactions with an external support.
 * XPBD multipliers reset per substep and accumulate only across that substep's iterations.
 * Constitutive compliance is independent of solve settings; finite solve/integration error is reported.
 */
/** What an exact checkpoint of a CompliantCableRuntime holds: every field. */
const STATE_FIELDS:FieldOptions={label:'CompliantCableRuntime',skip:[]};

export class CompliantCableRuntime implements EngineRuntime<CableStepRequest,CableSnapshot> {
  readonly capabilities:EngineCapabilities;
  readonly config:CableConfig;
  readonly backend:CableBackend;
  private initial:Float64Array;
  private mass:Float64Array;
  private pinned:Uint8Array;
  private edges:readonly Readonly<CableConstraint>[];
  private invMass:Float64Array;
  private p:Float64Array;private v:Float64Array;private force:Float64Array;private lambda:Float64Array;
  private previous:Float64Array;private predicted:Float64Array;private forceResidual:Float64Array;
  private vectorMultipliers:Float64Array;private supportImpulse:Float64Array;
  private appliedImpulse:[number,number,number]=[0,0,0];private dragImpulse:[number,number,number]=[0,0,0];
  private currentTick=0;private disposed=false;private failed=false;
  private externalWork=0;private dragDissipation=0;private maxResidual=0;private maxImplicitForceResidual=0;private unconvergedSubsteps=0;
  private maxIterationsUsed=0;private constraintProjections=0;private residualEvaluations=0;
  private maxConstraintForceResidual=0;

  constructor(input:CableDefinition) {
    const d=record(input,'definition');onlyKeys(d,['config','positions','masses','pinned','velocities','forces','constraints'],'definition');
    this.config=config(d.config);
    this.backend=this.config.solver==='proximal'?PROXIMAL_CABLE_BACKEND:this.config.solver==='newton'?NEWTON_CABLE_BACKEND:COMPLIANT_CABLE_BACKEND;
    const count=integer((d.masses as ArrayLike<number>)?.length,'node count',1,MAX_NODES);
    this.mass=numbers(d.masses,count,'masses',1e-9,1e12);
    this.initial=numbers(d.positions,count*3,'positions',-1e9,1e9);this.p=this.initial.slice();
    const fixed=d.pinned===undefined?new Float64Array(count):numbers(d.pinned,count,'pinned',0,1);
    if(!fixed.every(v=>v===0||v===1))throw new EngineError('INVALID_PAYLOAD','Pinned flags must be zero or one.');
    this.pinned=Uint8Array.from(fixed);
    this.v=d.velocities===undefined?new Float64Array(count*3):numbers(d.velocities,count*3,'velocities',-1e9,1e9);
    this.force=d.forces===undefined?new Float64Array(count*3):numbers(d.forces,count*3,'forces',-1e9,1e9);
    for(let i=0;i<count;i++)if(this.pinned[i]&&(this.v[3*i]!==0||this.v[3*i+1]!==0||this.v[3*i+2]!==0))throw new EngineError('INVALID_PAYLOAD','Fixed anchors cannot have velocity.');
    if(!Array.isArray(d.constraints)||d.constraints.length>MAX_LINKS)throw new EngineError('INVALID_PAYLOAD','Invalid constraint count.');
    this.edges=Object.freeze(d.constraints.map((value,i)=>{
      const e=record(value,`constraint ${i}`);onlyKeys(e,['a','b','restLength','compliance'],`constraint ${i}`);
      const a=canonicalZero(integer(e.a,'a',0,count-1)),b=canonicalZero(integer(e.b,'b',0,count-1));
      if(a===b)throw new EngineError('INVALID_PAYLOAD','A constraint needs two different nodes.');
      const restLength=finite(e.restLength,'restLength',1e-9,1e9),compliance=canonicalZero(finite(e.compliance,'compliance',0,1e12));
      if(compliance>0&&compliance<1e-18)throw new EngineError('INVALID_PAYLOAD','Positive compliance must be at least 1e-18 m/N.');
      if(this.pinned[a]&&this.pinned[b]&&compliance===0&&Math.hypot(...[0,1,2].map(k=>this.p[3*b+k]-this.p[3*a+k]))>restLength)throw new EngineError('INVALID_PAYLOAD','Stretched fixed endpoints cannot satisfy an inextensible cable.');
      return Object.freeze({a,b,restLength,compliance});
    }));
    if(this.edges.length*this.config.substeps*(this.config.maxIterations+(this.config.solver?1:0))>MAX_PROJECTIONS_PER_BATCH)throw new EngineError('WORK_LIMIT','One tick exceeds the bounded CPU projection budget.');
    if(this.config.solver==='newton'){
      if(this.edges.some(e=>e.compliance===0))throw new EngineError('INVALID_PAYLOAD','The Newton cable solver needs elastic links (compliance > 0).');
      if(count-this.pinned.reduce((a,b)=>a+b,0)>2048)throw new EngineError('WORK_LIMIT','The Newton cable solver takes at most 2048 free nodes.');
    }
    this.invMass=Float64Array.from(this.mass,(m,i)=>this.pinned[i]?0:1/m);
    this.lambda=new Float64Array(this.edges.length);this.previous=new Float64Array(count*3);this.predicted=new Float64Array(count*3);this.forceResidual=new Float64Array(count*3);
    this.vectorMultipliers=new Float64Array(this.config.solver?this.edges.length*3:0);this.supportImpulse=new Float64Array(this.config.solver?count*3:0);
    this.capabilities=Object.freeze({adapter:'particle-network',models:Object.freeze([Object.freeze({id:this.backend,name:'Compliant axial cable',implementation:'javascript',calibration:'uncalibrated-physical'})]),fixedDt:this.config.dt,deterministicCommands:true,checkpoint:true,worker:false,gpuReadback:false,snapshotOwnership:'numeric-copy'});
  }
  get tick():number{return this.currentTick;}
  private alive():void {if(this.disposed)throw new EngineError('DISPOSED','Cable runtime is destroyed.');if(this.failed)throw new EngineError('NUMERICAL_FAILURE','Cable runtime failed; restore a valid checkpoint before continuing.');}
  private command(value:unknown):CableCommand {
    const c=record(value,'command');onlyKeys(c,['tick','type','node','value'],'command');
    if(c.type!=='force'&&c.type!=='impulse')throw new EngineError('INVALID_PAYLOAD','Unknown cable command.');
    const node=integer(c.node,'node',0,this.mass.length-1);
    if(c.type==='impulse'&&this.pinned[node])throw new EngineError('INVALID_PAYLOAD','Cannot impart velocity to a fixed anchor.');
    return {tick:integer(c.tick,'command.tick',1),type:c.type,node,value:vector(c.value,'command.value')};
  }
  step(request:CableStepRequest):CableSnapshot {
    this.alive();const r=record(request,'step');onlyKeys(r,['ticks','commands'],'step');
    const {ticks,commands}=validateTickBatch(this.tick,r.ticks,r.commands,v=>this.command(v));
    if(ticks*this.edges.length*this.config.substeps*(this.config.maxIterations+(this.config.solver?1:0))>MAX_PROJECTIONS_PER_BATCH)throw new EngineError('WORK_LIMIT','Split the request into smaller tick batches.');
    let cursor=0;
    for(let t=0;t<ticks;t++) {
      if(this.config.solver){this.supportImpulse.fill(0);this.appliedImpulse.fill(0);this.dragImpulse.fill(0);this.maxConstraintForceResidual=0;}
      while(commands[cursor]?.tick===this.tick+1) {
        const c=commands[cursor++],i=3*c.node;
        for(let k=0;k<3;k++)if(c.type==='force')this.force[i+k]=c.value[k];else {
          const before=this.v[i+k];this.v[i+k]+=c.value[k]/this.mass[c.node];
          this.externalWork+=.5*this.mass[c.node]*(this.v[i+k]**2-before**2);
          if(this.config.solver)this.appliedImpulse[k]+=c.value[k];
        }
      }
      this.maxResidual=0;this.maxImplicitForceResidual=0;this.unconvergedSubsteps=0;this.maxIterationsUsed=0;this.constraintProjections=0;this.residualEvaluations=0;
      for(let s=0;s<this.config.substeps;s++)this.substep();
      this.currentTick++;
    }
    return this.inspect();
  }
  private residual(alphaScale:number):number {
    let maximum=0;
    for(let j=0;j<this.edges.length;j++) {
      const e=this.edges[j],a=e.a*3,b=e.b*3;
      const c=Math.hypot(this.p[b]-this.p[a],this.p[b+1]-this.p[a+1],this.p[b+2]-this.p[a+2])-e.restLength;
      const r=this.lambda[j]<0?Math.abs(c+e.compliance*alphaScale*this.lambda[j]):Math.max(c,0);
      maximum=Math.max(maximum,r/e.restLength);this.residualEvaluations++;
    }
    return maximum;
  }
  private substep():void {
    const {dt,substeps,drag,gravity,maxIterations,residualTolerance}=this.config,h=dt/substeps,alphaScale=1/(h*h),damping=1/(1+drag*h);
    this.previous.set(this.p);this.lambda.fill(0);
    for(let i=0;i<this.mass.length;i++)for(let k=0;k<3;k++) {
      const j=3*i+k;
      if(this.pinned[i]){this.p[j]=this.initial[j];continue;}
      // Implicit mass-proportional drag scales both external and constraint response.
      this.p[j]+=h*damping*(this.v[j]+h*(gravity[k]+this.force[j]*this.invMass[i]));
    }
    this.predicted.set(this.p);
    const proximal=this.config.solver==='proximal',newton=this.config.solver==='newton',vector=proximal||newton;
    let residual=0,iterations=0,implicitResidual=0,constraintForceResidual=0;
    if(proximal)({residual,iterations,implicitResidual,constraintForceResidual}=this.solveProximal(h,damping));
    else if(newton)({residual,iterations,implicitResidual,constraintForceResidual}=this.solveNewton(h,damping));
    else residual=this.residual(alphaScale);
    while(!vector&&iterations<maxIterations&&residual>residualTolerance) {
      for(let j=0;j<this.edges.length;j++) {
        const e=this.edges[j],a=e.a*3,b=e.b*3,dx=this.p[b]-this.p[a],dy=this.p[b+1]-this.p[a+1],dz=this.p[b+2]-this.p[a+2],length=Math.hypot(dx,dy,dz);
        const wa=this.invMass[e.a]*damping,wb=this.invMass[e.b]*damping,alpha=e.compliance*alphaScale,denominator=wa+wb+alpha;
        this.constraintProjections++;
        if(length===0){this.lambda[j]=0;continue;}
        if(denominator===0)continue;
        const next=Math.min(0,this.lambda[j]-(length-e.restLength+alpha*this.lambda[j])/denominator),delta=(next-this.lambda[j])/length;
        this.lambda[j]=canonicalZero(next);
        this.p[a]-=wa*delta*dx;this.p[a+1]-=wa*delta*dy;this.p[a+2]-=wa*delta*dz;
        this.p[b]+=wb*delta*dx;this.p[b+1]+=wb*delta*dy;this.p[b+2]+=wb*delta*dz;
      }
      iterations++;residual=this.residual(alphaScale);
    }
    if(!Number.isFinite(residual)||!this.p.every(Number.isFinite)){this.p.set(this.previous);this.failed=true;throw new EngineError('NUMERICAL_FAILURE','Cable projection produced a nonfinite state.');}
    // XPBD neglects gradient variation in the inertial equation. Report that
    // approximation separately from the constitutive/complementarity residual.
    if(!vector){
    for(let i=0;i<this.mass.length;i++)for(let k=0;k<3;k++)this.forceResidual[3*i+k]=this.mass[i]/damping*(this.p[3*i+k]-this.predicted[3*i+k])*alphaScale;
    for(let j=0;j<this.edges.length;j++) {
      const e=this.edges[j],a=3*e.a,b=3*e.b,length=Math.hypot(this.p[b]-this.p[a],this.p[b+1]-this.p[a+1],this.p[b+2]-this.p[a+2]);
      if(length>0)for(let k=0;k<3;k++){const f=this.lambda[j]*alphaScale*(this.p[b+k]-this.p[a+k])/length;this.forceResidual[a+k]+=f;this.forceResidual[b+k]-=f;}
    }
    for(let i=0;i<this.mass.length;i++)if(!this.pinned[i])this.maxImplicitForceResidual=Math.max(this.maxImplicitForceResidual,Math.hypot(this.forceResidual[3*i],this.forceResidual[3*i+1],this.forceResidual[3*i+2]));
    }else this.maxImplicitForceResidual=Math.max(this.maxImplicitForceResidual,implicitResidual);
    for(let i=0;i<this.mass.length;i++)for(let k=0;k<3;k++) {
      const j=3*i+k,dx=this.p[j]-this.previous[j];this.p[j]=canonicalZero(this.p[j]);this.v[j]=this.pinned[i]?0:canonicalZero(dx/h);
      // Gravity is accounted for by gravitational potential energy, not twice as work.
      this.externalWork+=this.force[j]*dx;
      this.dragDissipation+=drag*this.mass[i]*this.v[j]**2*h;
      if(vector){
        const applied=h*(this.force[j]+this.mass[i]*gravity[k]);this.appliedImpulse[k]+=applied;
        this.dragImpulse[k]-=h*drag*this.mass[i]*this.v[j];
        if(this.pinned[i])this.supportImpulse[j]-=applied;
      }
    }
    this.maxResidual=Math.max(this.maxResidual,residual);this.maxIterationsUsed=Math.max(this.maxIterationsUsed,iterations);
    this.maxConstraintForceResidual=Math.max(this.maxConstraintForceResidual,constraintForceResidual);
    if(residual>residualTolerance||(vector&&Math.max(implicitResidual,constraintForceResidual)>this.config.forceTolerance!))this.unconvergedSubsteps++;
  }
  /** Exact vector block minimizations of the convex implicit-step dual.
   * Remove an edge's previous vector correction before its radial proximal solve.
   * Unlike scalar XPBD, this also updates the direction of the accumulated force.
   * Zero compliance uses the closed-ball projection (inextensible tension-only).
   */
  private solveProximal(h:number,damping:number):{residual:number;iterations:number;implicitResidual:number;constraintForceResidual:number} {
    const q=this.vectorMultipliers,scale=1/(h*h);
    // A warm start is valid only if positions receive the matching corrections.
    // This preserves p = predicted + W B q. Persist q in the full checkpoint.
    for(let j=0;j<this.edges.length;j++){
      if(q[3*j]===0&&q[3*j+1]===0&&q[3*j+2]===0)continue;
      const e=this.edges[j],wa=this.invMass[e.a]*damping,wb=this.invMass[e.b]*damping;
      for(let k=0;k<3;k++){this.p[3*e.a+k]+=wa*q[3*j+k];this.p[3*e.b+k]-=wb*q[3*j+k];}
      this.constraintProjections++;
    }
    const measure=():{residual:number;implicitResidual:number;constraintForceResidual:number}=>{
      let residual=0,implicitResidual=0,constraintForceResidual=0;
      for(let i=0;i<this.mass.length;i++)for(let k=0;k<3;k++)this.forceResidual[3*i+k]=this.mass[i]/damping*(this.p[3*i+k]-this.predicted[3*i+k])*scale;
      for(let j=0;j<this.edges.length;j++){
        const e=this.edges[j],a=3*e.a,b=3*e.b,u=3*j;
        const dx=this.p[b]-this.p[a],dy=this.p[b+1]-this.p[a+1],dz=this.p[b+2]-this.p[a+2],length=Math.hypot(dx,dy,dz),magnitude=Math.hypot(q[u],q[u+1],q[u+2]);
        let gap=0;
        if(magnitude>0){
          const factor=e.restLength/magnitude+e.compliance*scale;
          gap=Math.hypot(dx-factor*q[u],dy-factor*q[u+1],dz-factor*q[u+2]);
        }else gap=Math.max(length-e.restLength,0);
        residual=Math.max(residual,gap/e.restLength);
        const response=(this.invMass[e.a]+this.invMass[e.b])*damping+e.compliance*scale;
        // A small position tolerance alone can leave O(gap/h^2) force jitter on
        // hard cables. Also bound the equivalent remaining edge correction in N.
        constraintForceResidual=Math.max(constraintForceResidual,response>0?gap*scale/response:gap>0?Infinity:0);
        // Use the actual constitutive force for elastic links, independently of q.
        // For a hard link the dual magnitude estimates tension; its direction is
        // checked by the vector KKT residual above.
        const tension=e.compliance>0?Math.max(length-e.restLength,0)/e.compliance:magnitude*scale;
        this.lambda[j]=canonicalZero(-tension/scale);
        if(length>0)for(let k=0;k<3;k++){
          const f=tension*(this.p[b+k]-this.p[a+k])/length;
          this.forceResidual[a+k]-=f;this.forceResidual[b+k]+=f;
        }
        this.residualEvaluations++;
      }
      for(let i=0;i<this.mass.length;i++)if(!this.pinned[i])implicitResidual=Math.max(implicitResidual,Math.hypot(this.forceResidual[3*i],this.forceResidual[3*i+1],this.forceResidual[3*i+2]));
      return {residual,implicitResidual,constraintForceResidual};
    };
    let {residual,implicitResidual,constraintForceResidual}=measure(),iterations=0;
    while(iterations<this.config.maxIterations&&(residual>this.config.residualTolerance||Math.max(implicitResidual,constraintForceResidual)>this.config.forceTolerance!)){
      for(let j=0;j<this.edges.length;j++){
        const e=this.edges[j],a=3*e.a,b=3*e.b,u=3*j,wa=this.invMass[e.a]*damping,wb=this.invMass[e.b]*damping,w=wa+wb;
        const dx=this.p[b]-this.p[a]+w*q[u],dy=this.p[b+1]-this.p[a+1]+w*q[u+1],dz=this.p[b+2]-this.p[a+2]+w*q[u+2],length=Math.hypot(dx,dy,dz),denominator=w+e.compliance*scale;
        const factor=length>e.restLength&&denominator>0?(length-e.restLength)/(denominator*length):0;
        for(let k=0;k<3;k++){
          const next=factor*(k===0?dx:k===1?dy:dz),change=next-q[u+k];q[u+k]=next;
          this.p[a+k]+=wa*change;this.p[b+k]-=wb*change;
        }
        this.constraintProjections++;
      }
      iterations++;({residual,implicitResidual,constraintForceResidual}=measure());
    }
    if(!Number.isFinite(implicitResidual)||!Number.isFinite(constraintForceResidual)||!q.every(Number.isFinite)){this.p.set(this.previous);this.failed=true;throw new EngineError('NUMERICAL_FAILURE','Cable vector solve produced a nonfinite state.');}
    for(let j=0;j<this.edges.length;j++){
      const e=this.edges[j];for(let k=0;k<3;k++){
        const impulse=q[3*j+k]/h;
        if(this.pinned[e.a])this.supportImpulse[3*e.a+k]-=impulse;
        if(this.pinned[e.b])this.supportImpulse[3*e.b+k]+=impulse;
      }
    }
    return {residual,iterations,implicitResidual,constraintForceResidual};
  }
  /** The same backward-Euler step as solveProximal, solved in the primal: minimise
   *   sum_free m (1 + r h) / (2 h^2) |x - p*|^2 + sum_links max(|xb - xa| - L, 0)^2 / (2 alpha)
   * by Newton's method. The Hessian is the mass term plus, for each taut link, (1 / alpha) ((1 - L/l) I + (L/l) n n^T)
   * (axial and geometric stiffness); it is factorised directly (free nodes in Cuthill-McKee order, envelope
   * Cholesky) and the factor is kept while it still converges well. A backtracking line search on the same function
   * keeps every step a descent step when links go slack or taut. It stops when the largest implicit force residual
   * is below forceTolerance. Elastic links only.
   *
   * Coupled nodes (coupleNodes(), for structure-coupling.ts): their inertia term is replaced, for one tick, by
   * (1/2) (x - x*)^T S (x - x*) over all of them together: S is the stiffness with which a carrier resists moving
   * those nodes from where it would go without this cable (x*), so the cable and its carrier are solved as one. */
  private newton?:{index:Int32Array;coupled:Int32Array;matrix:EnvelopeMatrix;step:Float64Array;saved:Float64Array;version:number;valid:boolean};
  private couple?:{nodes:Int32Array;stiffness:Float64Array;targets:Float64Array;version:number};
  private released?:Uint8Array;
  /** Newton backend: from the next tick on, link `index` carries nothing, as if it had been cut (its two nodes and
   * their masses stay). Not part of checkpoints. */
  releaseLink(index:number):void {
    this.alive();if(this.config.solver!=='newton')throw new EngineError('INVALID_PAYLOAD','Only the Newton cable solver can release a link.');
    if(!(Number.isInteger(index)&&index>=0&&index<this.edges.length))throw new EngineError('INVALID_PAYLOAD','Link index out of range.');
    (this.released??=new Uint8Array(this.edges.length))[index]=1;if(this.newton)this.newton.valid=false;
  }
  isReleased(index:number):boolean {return this.released?.[index]===1;}
  /** Coupling hook (Newton backend, one substep): for the next advance() only, the given free nodes start at
   * `positions` with `velocities` and, instead of their own inertia, are held towards `targets` by the dense
   * symmetric positive definite `stiffness` (3m x 3m, N/m, m = nodes.length). `version` must change whenever the
   * node list or the stiffness changes. */
  coupleNodes(nodes:Int32Array,stiffness:Float64Array,targets:Float64Array,positions:Float64Array,velocities:Float64Array,version:number):void {
    this.alive();
    if(this.config.solver!=='newton'||this.config.substeps!==1)throw new EngineError('INVALID_PAYLOAD','Coupled nodes need the Newton solver with one substep.');
    const m=nodes.length;
    if(stiffness.length!==9*m*m||targets.length!==3*m||positions.length!==3*m||velocities.length!==3*m)throw new EngineError('INVALID_PAYLOAD','Coupled node arrays have the wrong length.');
    for(let i=0;i<m;i++){
      const node=nodes[i];if(!(node>=0&&node<this.mass.length)||this.pinned[node])throw new EngineError('INVALID_PAYLOAD','Coupled nodes must be free cable nodes.');
      for(let k=0;k<3;k++){this.p[3*node+k]=positions[3*i+k];this.v[3*node+k]=velocities[3*i+k];}
    }
    this.couple={nodes,stiffness,targets,version};
  }
  private solveNewton(h:number,damping:number):{residual:number;iterations:number;implicitResidual:number;constraintForceResidual:number} {
    const scale=1/(h*h),count=this.mass.length,couple=this.couple,version=couple?couple.version:-1;
    if(couple)for(let i=0;i<couple.nodes.length;i++){const node=couple.nodes[i];for(let k=0;k<3;k++)this.p[3*node+k]=this.predicted[3*node+k]=couple.targets[3*i+k];}
    if(!this.newton||this.newton.version!==version){
      // Cuthill-McKee order of the free nodes keeps the factor's envelope narrow for chains and trees; coupled nodes go last.
      const neighbours:number[][]=Array.from({length:count},()=>[]),isCoupled=new Uint8Array(count);
      if(couple)for(const node of couple.nodes)isCoupled[node]=1;
      for(const e of this.edges)if(!this.pinned[e.a]&&!this.pinned[e.b]){neighbours[e.a].push(e.b);neighbours[e.b].push(e.a);}
      const index=new Int32Array(count).fill(-1);let next=0;
      const free=Array.from({length:count},(_,i)=>i).filter(i=>!this.pinned[i]&&!isCoupled[i]).sort((a,b)=>neighbours[a].length-neighbours[b].length||a-b);
      for(const start of free){
        if(index[start]>=0)continue;
        const queue=[start];index[start]=next++;
        for(let head=0;head<queue.length;head++)for(const j of [...neighbours[queue[head]]].sort((a,b)=>neighbours[a].length-neighbours[b].length||a-b))if(index[j]<0&&!isCoupled[j]){index[j]=next++;queue.push(j);}
      }
      const coupled=couple?Int32Array.from(couple.nodes,node=>{index[node]=next++;return node;}):new Int32Array(0);
      const n=3*next,first=Int32Array.from({length:n},(_,i)=>i-i%3);
      for(const e of this.edges){
        const a=index[e.a],b=index[e.b];if(a<0||b<0)continue;
        const lo=3*Math.min(a,b);for(const node of [a,b])for(let k=0;k<3;k++)first[3*node+k]=Math.min(first[3*node+k],lo);
      }
      if(couple){const lo=3*index[coupled[0]];for(const node of coupled)for(let k=0;k<3;k++)first[3*index[node]+k]=Math.min(first[3*index[node]+k],lo);}
      this.newton={index,coupled,matrix:new EnvelopeMatrix(n,first),step:new Float64Array(n),saved:new Float64Array(this.p.length),version,valid:false};
    }
    const state=this.newton,{index,matrix,step,saved}=state,a=matrix.a,n=matrix.n,lambda=this.lambda,m=couple?couple.nodes.length:0,released=this.released;
    const isCoupled=(i:number)=>couple!==undefined&&index[i]>=n/3-m;
    const coupledForce=new Float64Array(3*m),scratch=new Float64Array(3*m);
    const gradient=():number=>{
      for(let i=0;i<count;i++)for(let k=0;k<3;k++)this.forceResidual[3*i+k]=isCoupled(i)?0:this.mass[i]/damping*(this.p[3*i+k]-this.predicted[3*i+k])*scale;
      if(couple){
        const S=couple.stiffness,d=scratch;
        for(let i=0;i<m;i++)for(let k=0;k<3;k++)d[3*i+k]=this.p[3*couple.nodes[i]+k]-couple.targets[3*i+k];
        for(let r=0;r<3*m;r++){let sum=0;const row=r*3*m;for(let c=0;c<3*m;c++)sum+=S[row+c]*d[c];coupledForce[r]=sum;this.forceResidual[3*couple.nodes[(r-r%3)/3]+r%3]+=sum;}
      }
      for(let j=0;j<this.edges.length;j++){
        const e=this.edges[j],ea=3*e.a,eb=3*e.b,dx=this.p[eb]-this.p[ea],dy=this.p[eb+1]-this.p[ea+1],dz=this.p[eb+2]-this.p[ea+2],length=Math.hypot(dx,dy,dz);
        const tension=released?.[j]?0:Math.max(length-e.restLength,0)/e.compliance;lambda[j]=canonicalZero(-tension/scale);
        if(length>0&&tension>0){const f=tension/length;this.forceResidual[ea]-=f*dx;this.forceResidual[ea+1]-=f*dy;this.forceResidual[ea+2]-=f*dz;this.forceResidual[eb]+=f*dx;this.forceResidual[eb+1]+=f*dy;this.forceResidual[eb+2]+=f*dz;}
        this.residualEvaluations++;
      }
      let worst=0;for(let i=0;i<count;i++)if(!this.pinned[i])worst=Math.max(worst,Math.hypot(this.forceResidual[3*i],this.forceResidual[3*i+1],this.forceResidual[3*i+2]));
      return worst;
    };
    const assemble=()=>{
      a.fill(0);
      for(let i=0;i<count;i++){const r=index[i];if(r<0||isCoupled(i))continue;const mass=this.mass[i]/damping*scale;for(let k=0;k<3;k++)a[(3*r+k)*n+3*r+k]+=mass;}
      if(couple){const S=couple.stiffness,base=n-3*m;for(let r=0;r<3*m;r++)for(let c=0;c<=r;c++)a[(base+r)*n+base+c]+=S[r*3*m+c];}
      for(let j=0;j<this.edges.length;j++){
        const e=this.edges[j],ea=3*e.a,eb=3*e.b,dx=this.p[eb]-this.p[ea],dy=this.p[eb+1]-this.p[ea+1],dz=this.p[eb+2]-this.p[ea+2],length=Math.hypot(dx,dy,dz);
        if(released?.[j]||!(length>e.restLength))continue;
        const d=[dx/length,dy/length,dz/length],ratio=e.restLength/length,stiff=1/e.compliance,ia=index[e.a],ib=index[e.b];
        for(let r=0;r<3;r++)for(let c=0;c<3;c++){
          const value=stiff*((r===c?1-ratio:0)+ratio*d[r]*d[c]);
          if(ia>=0&&c<=r)a[(3*ia+r)*n+3*ia+c]+=value;
          if(ib>=0&&c<=r)a[(3*ib+r)*n+3*ib+c]+=value;
          if(ia>=0&&ib>=0){const hi=Math.max(ia,ib),lo=Math.min(ia,ib);a[(3*hi+r)*n+3*lo+c]-=value;}
        }
      }
      matrix.factor();state.valid=fresh=true;assemblies++;
    };
    let implicit=gradient(),iterations=0,fresh=false,assemblies=0;
    // The factor is kept from step to step and refreshed when it stops converging fast.
    if(!state.valid)assemble();
    while(iterations<this.config.maxIterations&&implicit>this.config.forceTolerance!){
      for(let i=0;i<count;i++){const r=index[i];if(r<0)continue;for(let k=0;k<3;k++)step[3*r+k]=-this.forceResidual[3*i+k];}
      matrix.solve(step);
      // Take the Newton step; halve it while it would more than double the residual (a link going slack or taut).
      saved.set(this.p);
      let t=1,nextResidual=Infinity;
      for(let tries=0;tries<12;tries++,t/=2){
        for(let i=0;i<count;i++){const r=index[i];if(r<0)continue;for(let k=0;k<3;k++)this.p[3*i+k]=saved[3*i+k]+t*step[3*r+k];}
        nextResidual=gradient();if(nextResidual<=2*implicit)break;
      }
      this.constraintProjections+=this.edges.length;iterations++;
      if(!(nextResidual<implicit)){
        // No progress: go back and refresh the factor at the current geometry (links may have gone slack or taut).
        this.p.set(saved);implicit=gradient();
        if(fresh||assemblies>=8)break;
        assemble();continue;
      }
      // Slow progress: the kept factor is out of date; refresh it.
      const slow=!(nextResidual<.1*implicit);implicit=nextResidual;fresh=false;
      if(slow&&assemblies<8&&implicit>this.config.forceTolerance!)assemble();
    }
    if(!Number.isFinite(implicit)||!this.p.every(Number.isFinite)){this.p.set(this.previous);this.failed=true;throw new EngineError('NUMERICAL_FAILURE','Cable Newton solve produced a nonfinite state.');}
    for(let j=0;j<this.edges.length;j++){
      const e=this.edges[j],ea=3*e.a,eb=3*e.b,dx=this.p[eb]-this.p[ea],dy=this.p[eb+1]-this.p[ea+1],dz=this.p[eb+2]-this.p[ea+2],length=Math.hypot(dx,dy,dz);
      const tension=released?.[j]?0:Math.max(length-e.restLength,0)/e.compliance;if(!(length>0)||tension===0)continue;
      for(let k=0;k<3;k++){const impulse=h*tension*(k===0?dx:k===1?dy:dz)/length;if(this.pinned[e.a])this.supportImpulse[ea+k]-=impulse;if(this.pinned[e.b])this.supportImpulse[eb+k]+=impulse;}
    }
    if(couple)this.coupledForce=coupledForce;
    this.couple=undefined;
    return {residual:0,iterations,implicitResidual:implicit,constraintForceResidual:0};
  }
  /** After an advance() with coupled nodes: S (x - x*) at the end of the step, three per coupled node in the order
   * given, N. At the answer it is the pull of the cable's links on those nodes. */
  coupledForce=new Float64Array(0);
  // ---- Coupling hooks (structure-coupling.ts). Additions only: step() and its numerics are untouched. ----
  /** One tick with no commands, no validation and no snapshot. The same per-tick sequence as step(). */
  advance():void {
    this.alive();
    if(this.config.solver){this.supportImpulse.fill(0);this.appliedImpulse.fill(0);this.dragImpulse.fill(0);this.maxConstraintForceResidual=0;}
    this.maxResidual=0;this.maxImplicitForceResidual=0;this.unconvergedSubsteps=0;this.maxIterationsUsed=0;this.constraintProjections=0;this.residualEvaluations=0;
    for(let s=0;s<this.config.substeps;s++)this.substep();
    this.currentTick++;
  }
  /** Live state arrays for a coupler to READ without copying. Write only through driveNode(). */
  couplingViews():{positions:Float64Array;velocities:Float64Array;masses:Float64Array;pinned:Uint8Array} {
    this.alive();return {positions:this.p,velocities:this.v,masses:this.mass,pinned:this.pinned};
  }
  /** Overwrite one free node's position, velocity, mass and applied force. A coupler uses this to make
   * the node stand for an attachment point with that point's effective mass. */
  driveNode(node:number,px:number,py:number,pz:number,vx:number,vy:number,vz:number,mass:number,fx:number,fy:number,fz:number):void {
    this.alive();
    if(!(node>=0&&node<this.mass.length)||this.pinned[node])throw new EngineError('INVALID_PAYLOAD','driveNode needs a free cable node.');
    if(!(mass>=1e-9&&mass<=1e12)||!Number.isFinite(px+py+pz+vx+vy+vz+fx+fy+fz))throw new EngineError('INVALID_PAYLOAD','driveNode needs finite state and a mass within 1e-9..1e12 kg.');
    const j=3*node;this.p[j]=px;this.p[j+1]=py;this.p[j+2]=pz;this.v[j]=vx;this.v[j+1]=vy;this.v[j+2]=vz;
    this.mass[node]=mass;this.invMass[node]=1/mass;this.force[j]=fx;this.force[j+1]=fy;this.force[j+2]=fz;
  }
  inspect():CableSnapshot {
    this.alive();const h=this.config.dt/this.config.substeps,scale=1/(h*h),tensions=Float64Array.from(this.lambda,v=>v<0?-v*scale:0),reactions=new Float64Array(this.p.length);
    let mass=0,kineticEnergy=0,elasticEnergy=0,gravitationalEnergy=0,maxStrain=0,maxTension=0;
    const momentum:[number,number,number]=[0,0,0];
    for(let i=0;i<this.mass.length;i++) {
      mass+=this.mass[i];
      for(let k=0;k<3;k++) {
        const j=3*i+k;kineticEnergy+=.5*this.mass[i]*this.v[j]**2;gravitationalEnergy-=this.mass[i]*this.config.gravity[k]*this.p[j];momentum[k]+=this.mass[i]*this.v[j];
        if(this.pinned[i])reactions[j]=-(this.force[j]+this.mass[i]*this.config.gravity[k]);
      }
    }
    for(let i=0;i<this.edges.length;i++) {
      const e=this.edges[i],a=3*e.a,b=3*e.b,dx=this.p[b]-this.p[a],dy=this.p[b+1]-this.p[a+1],dz=this.p[b+2]-this.p[a+2],length=Math.hypot(dx,dy,dz),extension=Math.max(length-e.restLength,0);
      if(e.compliance>0)elasticEnergy+=.5*extension*extension/e.compliance;
      maxStrain=Math.max(maxStrain,extension/e.restLength);maxTension=Math.max(maxTension,tensions[i]);
      if(length>0)for(let k=0;k<3;k++) {
        const f=tensions[i]*(this.p[b+k]-this.p[a+k])/length;
        if(this.pinned[e.a])reactions[a+k]-=f;if(this.pinned[e.b])reactions[b+k]+=f;
      }
    }
    for(let i=0;i<reactions.length;i++)reactions[i]=canonicalZero(reactions[i]);
    return {backend:this.backend,tick:this.tick,positions:this.p.slice(),velocities:this.v.slice(),tensions,supportReactions:reactions,
      ...(this.config.solver?{impulses:{support:this.supportImpulse.slice(),applied:this.appliedImpulse.map(canonicalZero) as [number,number,number],drag:this.dragImpulse.map(canonicalZero) as [number,number,number]}}:{}),
      diagnostics:{time:this.tick*this.config.dt,mass,kineticEnergy,elasticEnergy,gravitationalEnergy,externalWork:this.externalWork,dragDissipation:this.dragDissipation,momentum,maxStrain,maxTension,maxResidual:this.maxResidual,maxImplicitForceResidual:this.maxImplicitForceResidual,unconvergedSubsteps:this.unconvergedSubsteps,maxIterationsUsed:this.maxIterationsUsed,constraintProjections:this.constraintProjections,residualEvaluations:this.residualEvaluations,...(this.config.solver?{maxConstraintForceResidual:this.maxConstraintForceResidual}:{})}};
  }
  checkpoint():CableCheckpoint {
    this.alive();return {format:'box3d-compliant-cable',version:this.config.solver?2:1,backend:this.backend,
      definition:{config:{...this.config,gravity:[...this.config.gravity]},positions:Array.from(this.initial),masses:Array.from(this.mass),pinned:Array.from(this.pinned),constraints:this.edges.map(e=>({...e}))},
      state:{tick:this.tick,positions:Array.from(this.p),velocities:Array.from(this.v),forces:Array.from(this.force),multipliers:Array.from(this.lambda),externalWork:this.externalWork,dragDissipation:this.dragDissipation,maxResidual:this.maxResidual,maxImplicitForceResidual:this.maxImplicitForceResidual,unconvergedSubsteps:this.unconvergedSubsteps,maxIterationsUsed:this.maxIterationsUsed,constraintProjections:this.constraintProjections,residualEvaluations:this.residualEvaluations,
        ...(this.config.solver?{maxConstraintForceResidual:this.maxConstraintForceResidual,vectorMultipliers:Array.from(this.vectorMultipliers,canonicalZero),impulses:{support:Array.from(this.supportImpulse,canonicalZero),applied:this.appliedImpulse.map(canonicalZero) as [number,number,number],drag:this.dragImpulse.map(canonicalZero) as [number,number,number]}}:{})}};
  }
  static fromCheckpoint(value:unknown):CompliantCableRuntime {
    const c=record(value,'checkpoint');onlyKeys(c,['format','version','backend','definition','state'],'checkpoint');
    if(c.format!=='box3d-compliant-cable'||!((c.version===1&&c.backend===COMPLIANT_CABLE_BACKEND)||(c.version===2&&(c.backend===PROXIMAL_CABLE_BACKEND||c.backend===NEWTON_CABLE_BACKEND))))throw new EngineError('INVALID_PAYLOAD','Unsupported cable checkpoint.');
    const runtime=new CompliantCableRuntime(c.definition as CableDefinition);
    try {
      if(runtime.backend!==c.backend)throw new EngineError('INVALID_PAYLOAD','Checkpoint solver and backend disagree.');
      const s=record(c.state,'state');onlyKeys(s,['tick','positions','velocities','forces','multipliers','externalWork','dragDissipation','maxResidual','maxImplicitForceResidual','unconvergedSubsteps','maxIterationsUsed','constraintProjections','residualEvaluations',...(runtime.config.solver?['impulses','vectorMultipliers','maxConstraintForceResidual']:[])],'state');
      runtime.currentTick=canonicalZero(integer(s.tick,'tick'));runtime.p=numbers(s.positions,runtime.p.length,'positions');runtime.v=numbers(s.velocities,runtime.v.length,'velocities');
      runtime.force=numbers(s.forces,runtime.force.length,'forces',-1e9,1e9);runtime.lambda=numbers(s.multipliers,runtime.edges.length,'multipliers',-1e100,0);
      for(let i=0;i<runtime.mass.length;i++)if(runtime.pinned[i])for(let k=0;k<3;k++)if(runtime.p[3*i+k]!==runtime.initial[3*i+k]||runtime.v[3*i+k]!==0)throw new EngineError('INVALID_PAYLOAD','Checkpoint moved a fixed anchor.');
      runtime.externalWork=canonicalZero(finite(s.externalWork,'externalWork'));runtime.dragDissipation=canonicalZero(finite(s.dragDissipation,'dragDissipation',0));runtime.maxResidual=canonicalZero(finite(s.maxResidual,'maxResidual',0));runtime.maxImplicitForceResidual=canonicalZero(finite(s.maxImplicitForceResidual,'maxImplicitForceResidual',0));
      runtime.unconvergedSubsteps=canonicalZero(integer(s.unconvergedSubsteps,'unconvergedSubsteps',0,runtime.config.substeps));runtime.maxIterationsUsed=canonicalZero(integer(s.maxIterationsUsed,'maxIterationsUsed',0,runtime.config.maxIterations));
      runtime.constraintProjections=canonicalZero(integer(s.constraintProjections,'constraintProjections',0,MAX_PROJECTIONS_PER_BATCH));runtime.residualEvaluations=canonicalZero(integer(s.residualEvaluations,'residualEvaluations',0,MAX_PROJECTIONS_PER_BATCH+runtime.edges.length*runtime.config.substeps));
      if(runtime.config.solver){
        runtime.maxConstraintForceResidual=canonicalZero(finite(s.maxConstraintForceResidual,'maxConstraintForceResidual',0));
        runtime.vectorMultipliers=numbers(s.vectorMultipliers,runtime.edges.length*3,'vector multipliers');
        const impulses=record(s.impulses,'impulses');onlyKeys(impulses,['support','applied','drag'],'impulses');
        runtime.supportImpulse=numbers(impulses.support,runtime.p.length,'support impulses');
        runtime.appliedImpulse=Array.from(numbers(impulses.applied,3,'applied impulse')) as [number,number,number];runtime.dragImpulse=Array.from(numbers(impulses.drag,3,'drag impulse')) as [number,number,number];
        for(let i=0;i<runtime.mass.length;i++)if(!runtime.pinned[i]&&runtime.supportImpulse.subarray(3*i,3*i+3).some(v=>v!==0))throw new EngineError('INVALID_PAYLOAD','Free nodes cannot have support impulses.');
      }
      return runtime;
    }catch(error){runtime.destroy();throw error;}
  }
  /** Every field a later tick reads, as a state tree (checkpoint.ts), for exact checkpoints. Unlike `checkpoint()` it is
   * restored in place (`restoreState`), so a coupling that holds this runtime keeps holding it. */
  saveState():StateObject {return captureFields(this,STATE_FIELDS);}
  /** Put back a state from `saveState()` of a runtime with the same definition. */
  restoreState(state:StateValue):void {restoreFields(this,state,STATE_FIELDS);}
  destroy():void {if(this.disposed)return;this.disposed=true;this.p=new Float64Array();this.v=new Float64Array();this.force=new Float64Array();this.lambda=new Float64Array();this.initial=new Float64Array();this.mass=new Float64Array();this.pinned=new Uint8Array();this.invMass=new Float64Array();this.edges=[];this.previous=new Float64Array();this.predicted=new Float64Array();this.forceResidual=new Float64Array();this.vectorMultipliers=new Float64Array();this.supportImpulse=new Float64Array();}
}

/** Lumped masses and segment compliance preserve total mass and EA as resolution changes. */
export function hangingCableDefinition(input:{segments:number;length:number;linearDensity:number;tipMass:number;axialRigidity:number;config:CableConfig}):CableDefinition {
  const n=integer(input.segments,'segments',1,MAX_NODES-1),length=finite(input.length,'length',1e-5,1e6),density=finite(input.linearDensity,'linearDensity',1e-8,1e6),tipMass=finite(input.tipMass,'tipMass',0,1e9),ea=finite(input.axialRigidity,'axialRigidity',1e-6,1e12);
  finite(length/n,'segment length',1e-9,1e9);finite(density*length/(2*n),'endpoint mass',1e-9,1e12);finite(length/(n*ea),'segment compliance',1e-18,1e12);config(input.config);
  const positions=new Float64Array((n+1)*3),masses=new Float64Array(n+1),pinned=new Uint8Array(n+1),constraints:CableConstraint[]=[];
  for(let i=0;i<=n;i++){positions[3*i+1]=-length*i/n;masses[i]=density*length/n*(i===0||i===n?.5:1);if(i>0)constraints.push({a:i-1,b:i,restLength:length/n,compliance:length/(n*ea)});}
  masses[n]+=tipMass;pinned[0]=1;return {config:input.config,positions,masses,pinned,constraints};
}
