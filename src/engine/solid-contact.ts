/**
 * Contact, friction and welds between a deformable solid (solid.ts) and rigid bodies, two-way.
 *
 * `SolidContact` advances a `SolidBody` by backward Euler together with the rigid bodies that touch
 * it or are welded to it. One step minimises one function of the nodal displacements u and of six
 * numbers per dynamic body (its displacement c, and dtheta: how far it turns beyond where it would turn alone):
 *
 *     Phi = W(u) - f_ext.u + sum m |u - u_free|^2 / (2 h^2)                 the solid's own step
 *         + sum_b [ m_b |c - c_free|^2 + dtheta^T I_b dtheta ] / (2 alpha h^2)   the inertia the rigid step gives a body
 *         + sum_contacts k <-gap>^2 / 2                                     one-sided springs, node against body
 *         + sum_contacts friction(|slip|)                                   a stick spring capped at mu N
 *         + sum_welds k |x - x_body|^2 / 2                                  nodes fixed to a body
 *
 * by Newton's method with a line search and conjugate gradients, to a force tolerance. Every spring
 * joins a node to a point that rides on its body, so what the solid feels and what the body gets are
 * the same numbers with opposite signs. Because the body's inertia is in the system, a light body on
 * a stiff solid and a heavy body on a soft one are both stable at any step; handing the solid's force
 * to a body that was moved without it ('naive-staggered', kept to show it) is not.
 *
 * `SolidCoupling` connects it to a rigid world: call `step()` immediately before `world.step()`.
 * `solidContactSubsystem` puts either in the one stepping loop (simulation.ts). SI units, float64.
 * See docs/SOLID_CONTACT.md for the equations, the validation and the limits.
 */
import {EngineError} from './contracts.ts';
import {captureFields,checkpointError,eachElement,holder,restoreFields,type FieldHandler,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';
import {SolidBody,type SolidKernel} from './solid.ts';
import {principalMoments,type StructureInertia} from './structure-coupling.ts';
import type {Subsystem} from './simulation.ts';

export const SOLID_CONTACT_SOLVER_ID='solid-contact-penalty-newton-pcg-js-f64-v1';
export const SOLID_COUPLING_BACKEND='rigid-solid-coupling-monolithic-js-f64-v1';

export type SolidContactVec3=readonly [number,number,number];
export type SolidContactShape=
  |{readonly kind:'box';readonly halfExtents:SolidContactVec3}
  |{readonly kind:'sphere';readonly radius:number}
  /** Axis along the body's local Y; halfLength is half the distance between the cap centres. */
  |{readonly kind:'capsule';readonly radius:number;readonly halfLength:number}
  /** The half space behind the plane through the body position with this local normal. Static or kinematic bodies only. */
  |{readonly kind:'plane';readonly normal:SolidContactVec3};
export interface SolidContactBodyState {
  readonly position:ArrayLike<number>;
  readonly rotation:ArrayLike<number>;
  readonly linearVelocity?:ArrayLike<number>;
  readonly angularVelocity?:ArrayLike<number>;
}
export interface SolidContactBodyOptions extends SolidContactBodyState {
  readonly shape:SolidContactShape;
  readonly type:'static'|'kinematic'|'dynamic';
  /** Dynamic bodies: kg. */
  readonly mass?:number;
  /** Dynamic bodies: rotational inertia. Default: that of the shape with uniform density. */
  readonly inertia?:StructureInertia;
  /** Coulomb coefficient between this body and the solid. Default 0. */
  readonly friction?:number;
  /** False: nodes can be welded to the body but do not collide with it. Default true. */
  readonly collide?:boolean;
  /** Dynamic bodies. False: the solid feels the body, the body does not feel the solid. Default true. */
  readonly twoWay?:boolean;
  readonly gravityScale?:number;
}
export interface SolidContactOptions {
  /** Contact and weld springs are this many times stiffer than one layer of elements:
   * k = stiffnessScale (lambda + 2 mu) A / l per node, A the node's share of the surface and l the mean
   * element size. The force a resting contact carries does not depend on it; the depth does: a contact
   * under pressure p is p l / (stiffnessScale (lambda + 2 mu)) deep. Default 100. */
  readonly stiffnessScale?:number;
  /** Nodes closer to a body than this at the start of a step, plus the distance they can close in the step,
   * get a contact plane. Default: half the mean element size. */
  readonly skin?:number;
  /** Most solves per step while the friction limits mu N settle. Default 12. */
  readonly frictionPasses?:number;
  /** The limits have settled when none changes by more than this fraction of the largest. Default 1e-4. */
  readonly frictionTolerance?:number;
  /** 'implicit' (default): dynamic bodies are unknowns of the solid's solve. 'naive-staggered': the solid is solved
   * against the bodies' free motion and its force handed to them; it exists to show the instability, do not use it. */
  readonly scheme?:'implicit'|'naive-staggered';
  /** Acceleration of gravity on the bodies when no world states it, m/s^2. Default: the solid's own gravity. */
  readonly gravity?:SolidContactVec3;
}
export interface SolidContactStats {
  converged:boolean;newtonIterations:number;linearIterations:number;
  /** 2-norm of the unbalanced force on the unknowns after the last solve, N, and what the relative tolerance is measured against. */
  residual:number;reference:number;
  /** Solves the last step took while the friction limits settled. */
  frictionPasses:number;
  /** Steps that stopped at an iteration limit, or with friction limits still changing, since construction. */
  unconvergedSteps:number;
  /** Nodes pressing on a body after the last step. */
  contacts:number;
}
export interface SolidStaticContactResult {converged:boolean;passes:number;residual:number;change:number}

const fail=(message:string):never=>{throw new EngineError('INVALID_PAYLOAD',message);};
function num(value:unknown,label:string,min:number,max:number):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${label} must be a number from ${min} to ${max}.`);
  return value as number;
}
const STATIC=0,KINEMATIC=1,DYNAMIC=2;
/** A contact needs the body's outward normal and the node's outward normal to be opposed by at least this cosine. */
const FACING=.2;

class ContactBody {
  type=STATIC;shape=0;
  /** Box half extents, or radius and half length, or the plane's local normal. */
  readonly dim=new Float64Array(3);
  bound=Infinity;mass=0;moments:[number,number,number]|null=null;friction=0;collide=true;twoWay=true;gravityScale=1;
  readonly x=new Float64Array(3);readonly q=new Float64Array([0,0,0,1]);readonly R=new Float64Array(9);
  readonly v=new Float64Array(3);readonly w=new Float64Array(3);
  /** Where the step is linearised: the body's position at the start and its rotation after its free turn. */
  readonly xp=new Float64Array(3);readonly Rp=new Float64Array(9);
  /** World inertia at the start of the step and its inverse. */
  readonly Iw=new Float64Array(9);readonly Iinv=new Float64Array(9);
  /** Force and torque on the body from what the solid cannot see (supports, joints), N and N m. */
  readonly external=new Float64Array(6);
  /** Free displacement and rotation of the step. */
  readonly free=new Float64Array(6);
  /** Linear term of the body's part of Phi (statics: its weight). */
  readonly load=new Float64Array(6);
  /** Force and torque about the centre of mass that the solid put on the body in the last step. */
  readonly force=new Float64Array(3);readonly torque=new Float64Array(3);
  /** Displacement and rotation vector of the last step as the solve found them. */
  readonly motion=new Float64Array(6);
  /** True when the body's six numbers are unknowns of the solve; `turns` when the last three are. */
  solved=false;turns=false;contacts=0;touching=false;welds=0;
}

function quatToMatrix(q:ArrayLike<number>,R:Float64Array):void {
  let x=q[0],y=q[1],z=q[2],w=q[3];const n=Math.hypot(x,y,z,w)||1;x/=n;y/=n;z/=n;w/=n;
  R[0]=1-2*(y*y+z*z);R[1]=2*(x*y-z*w);R[2]=2*(x*z+y*w);
  R[3]=2*(x*y+z*w);R[4]=1-2*(x*x+z*z);R[5]=2*(y*z-x*w);
  R[6]=2*(x*z-y*w);R[7]=2*(y*z+x*w);R[8]=1-2*(x*x+y*y);
}
/** out = exp([t]x) (Rodrigues). */
function rotationOf(tx:number,ty:number,tz:number,out:Float64Array):void {
  const a2=tx*tx+ty*ty+tz*tz,a=Math.sqrt(a2),s=a>1e-8?Math.sin(a)/a:1-a2/6,c=a>1e-8?(1-Math.cos(a))/a2:.5-a2/24;
  out[0]=1-c*(ty*ty+tz*tz);out[1]=c*tx*ty-s*tz;out[2]=c*tx*tz+s*ty;
  out[3]=c*tx*ty+s*tz;out[4]=1-c*(tx*tx+tz*tz);out[5]=c*ty*tz-s*tx;
  out[6]=c*tx*tz-s*ty;out[7]=c*ty*tz+s*tx;out[8]=1-c*(tx*tx+ty*ty);
}
/** q <- exp([t]x) q, normalised. */
function rotateQuat(q:Float64Array,tx:number,ty:number,tz:number):void {
  const a=Math.hypot(tx,ty,tz),s=a>1e-8?Math.sin(a/2)/a:.5,dw=Math.cos(a/2),dx=s*tx,dy=s*ty,dz=s*tz,x=q[0],y=q[1],z=q[2],w=q[3];
  let nx=dw*x+dx*w+dy*z-dz*y,ny=dw*y-dx*z+dy*w+dz*x,nz=dw*z+dx*y-dy*x+dz*w,nw=dw*w-dx*x-dy*y-dz*z;
  const n=Math.hypot(nx,ny,nz,nw)||1;nx/=n;ny/=n;nz/=n;nw/=n;q[0]=nx;q[1]=ny;q[2]=nz;q[3]=nw;
}
/** Inverse of a symmetric positive-definite 3x3 (row major, 9 numbers). */
function invert3(a:Float64Array,out:Float64Array):void {
  const A=a[4]*a[8]-a[5]*a[7],B=a[5]*a[6]-a[3]*a[8],C=a[3]*a[7]-a[4]*a[6],det=a[0]*A+a[1]*B+a[2]*C,s=Math.abs(det)>1e-300?1/det:0;
  out[0]=A*s;out[1]=(a[2]*a[7]-a[1]*a[8])*s;out[2]=(a[1]*a[5]-a[2]*a[4])*s;
  out[3]=B*s;out[4]=(a[0]*a[8]-a[2]*a[6])*s;out[5]=(a[2]*a[3]-a[0]*a[5])*s;
  out[6]=C*s;out[7]=(a[1]*a[6]-a[0]*a[7])*s;out[8]=(a[0]*a[4]-a[1]*a[3])*s;
}

/**
 * A deformable solid in contact with rigid bodies. Build the `SolidBody` as usual (backward Euler), hand it over,
 * add bodies, and from then on step it here, not with `solid.step()`.
 *
 * Without a world the bodies are this object's own: `step()` moves the dynamic ones by backward Euler with the
 * force and torque of the solve. A `SolidCoupling` reads them from a rigid world instead and hands the forces to it.
 */
/** The weld map (node to weld index) as pairs. */
const weldMap:FieldHandler={
  capture:value=>Array.from(value as Map<number,number>,([node,index])=>[node,index]),
  restore:(value,state)=>{const map=value as Map<number,number>;map.clear();for(const pair of state as number[][])map.set(pair[0],pair[1]);},
};
/** What an exact checkpoint of a SolidContact holds: every field but the solid (saved by whoever owns it), its kernel (part of
 * the solid) and the views into its own work vectors; the bodies it holds keep their identity. */
const CONTACT_FIELDS:FieldOptions={label:'SolidContact',skip:['solid','k','views'],nested:{bodies:eachElement({label:'SolidContact body'}),welded:weldMap}};
/** What an exact checkpoint of a SolidCoupling holds: the solid, the contact solver and the coupled bodies' records. */
const SOLID_COUPLING_FIELDS:FieldOptions={label:'SolidCoupling',skip:['world','byBody'],nested:{solid:holder,contact:holder,list:eachElement({label:'SolidCoupling body'})}};

export class SolidContact {
  /** Everything a later step reads, as a state tree (checkpoint.ts), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,CONTACT_FIELDS);}
  /** Put back a state from `saveState()` of a contact solver set up the same way (same solid, bodies, planes and welds). */
  restoreState(state:StateValue):void {restoreFields(this,state,CONTACT_FIELDS);}

  readonly solver=SOLID_CONTACT_SOLVER_ID;
  readonly solid:SolidBody;readonly dt:number;readonly stiffnessScale:number;readonly skin:number;readonly frictionPasses:number;readonly frictionTolerance:number;
  scheme:'implicit'|'naive-staggered';
  /** The rigid step moves a body by h v + alpha h^2 a. 1 for this object's own bodies; a SolidCoupling sets (n + 1) / (2 n) for n substeps. */
  bodyStepFactor=1;
  /** False when a world integrates the bodies (SolidCoupling). */
  integrateBodies=true;
  /** Acceleration of gravity on the bodies, m/s^2. */
  readonly bodyGravity=new Float64Array(3);
  readonly stats:SolidContactStats={converged:true,newtonIterations:0,linearIterations:0,residual:0,reference:0,frictionPasses:0,unconvergedSteps:0,contacts:0};
  /** Work the bodies have done on the solid through contact and welds since construction, J. */
  externalWork=0;
  /** Surface nodes of the solid, and each one's share of the surface area, m^2. */
  readonly surfaceNodes:Uint32Array;readonly surfaceArea:Float64Array;
  /** Mean element size (6 V)^(1/3), m. */
  readonly elementSize:number;
  /** Force the bodies put on each node in the last solve (contact, friction and welds), N. */
  readonly nodeForce:Float64Array;
  private readonly k:SolidKernel;private readonly n3:number;private readonly bodies:ContactBody[]=[];
  private size:number;
  private z:Float64Array;private G:Float64Array;private Gt:Float64Array;private trial:Float64Array;private cgX:Float64Array;private cgR:Float64Array;private cgZ:Float64Array;private cgP:Float64Array;private cgA:Float64Array;private diag:Float64Array;
  private views!:{zu:Float64Array;tu:Float64Array;pu:Float64Array;au:Float64Array};
  private readonly fint:Float64Array;private readonly u0:Float64Array;private readonly target:Float64Array;private readonly work:Float64Array;private readonly work2:Float64Array;
  /** Stiffness per unit of facing area, N/m^3, the outward area vector of every node at the start of the step, and the stiffness of each contact slot. */
  private readonly kArea:number;private readonly areaVector:Float64Array;private kc=new Float64Array(0);
  // Contacts: slot c = (surface index) * bodyCount + body.
  private cand=new Uint8Array(0);private act=new Uint8Array(0);private cn=new Float64Array(0);private ca=new Float64Array(0);private cr=new Float64Array(0);private cForce=new Float64Array(0);
  /** Gap, friction offset and weld offset at the start of the step. The solve adds increments to them, so that the rounding of
   * (position - plane point) is made once per step and not at every iterate. */
  private g0=new Float64Array(0);private f0=new Float64Array(0);private w0=new Float64Array(0);
  private fHas=new Uint8Array(0);private fl=new Float64Array(0);private fa=new Float64Array(0);private fr=new Float64Array(0);private fcap=new Float64Array(0);private fmode=new Uint8Array(0);private fs=new Float64Array(0);private fsl=new Float64Array(0);
  private list=new Uint32Array(0);private listCount=0;
  // Welds.
  private readonly wNode:number[]=[];private readonly wBody:number[]=[];private readonly wLocal:number[]=[];private readonly wK:number[]=[];private wa=new Float64Array(0);private wr=new Float64Array(0);
  private readonly welded=new Map<number,number>();
  private blocks=new Float64Array(0);private readonly m6=new Float64Array(36);private readonly v6=new Float64Array(6);
  private cm=0;private cd=0;private reference=0;private referenceInertia=0;private h=0;private staticMode=false;private fext:Float64Array;
  private readonly sn=[0,0,0];private all=false;private warm=false;

  constructor(solid:SolidBody,options:SolidContactOptions={}) {
    if(!(solid instanceof SolidBody))throw new TypeError('SolidContact needs a SolidBody.');
    if(solid.integrator!=='backward-euler')fail('A solid in contact needs the backward-euler integrator.');
    this.solid=solid;this.dt=solid.dt;this.k=solid.kernel();
    this.stiffnessScale=options.stiffnessScale===undefined?100:num(options.stiffnessScale,'stiffnessScale',1e-3,1e9);
    this.frictionPasses=options.frictionPasses===undefined?12:num(options.frictionPasses,'frictionPasses',1,1000);
    this.frictionTolerance=options.frictionTolerance===undefined?1e-4:num(options.frictionTolerance,'frictionTolerance',0,1);
    this.scheme=options.scheme??'implicit';
    if(this.scheme!=='implicit'&&this.scheme!=='naive-staggered')fail("scheme must be 'implicit' or 'naive-staggered'.");
    const g=options.gravity??this.k.gravity;for(let i=0;i<3;i++)this.bodyGravity[i]=num(g[i],'gravity',-1e5,1e5);
    const n3=this.n3=3*solid.nodeCount,X=solid.referencePositions,faces=solid.faces,area=new Float64Array(solid.nodeCount);
    for(let f=0;f<faces.length;f+=3){
      const a=3*faces[f],b=3*faces[f+1],c=3*faces[f+2],ux=X[b]-X[a],uy=X[b+1]-X[a+1],uz=X[b+2]-X[a+2],vx=X[c]-X[a],vy=X[c+1]-X[a+1],vz=X[c+2]-X[a+2];
      const share=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)/6;area[faces[f]]+=share;area[faces[f+1]]+=share;area[faces[f+2]]+=share;
    }
    const surface:number[]=[];for(let i=0;i<solid.nodeCount;i++)if(area[i]>0)surface.push(i);
    this.surfaceNodes=Uint32Array.from(surface);this.surfaceArea=Float64Array.from(surface,i=>area[i]);
    this.elementSize=Math.cbrt(6*solid.referenceVolume/solid.tetCount);
    this.skin=options.skin===undefined?.5*this.elementSize:num(options.skin,'skin',0,1e6);
    this.kArea=this.stiffnessScale*(solid.lambda+2*solid.mu)/this.elementSize;this.areaVector=new Float64Array(n3);
    this.size=n3;const f=()=>new Float64Array(n3);
    this.z=f();this.G=f();this.Gt=f();this.trial=f();this.cgX=f();this.cgR=f();this.cgZ=f();this.cgP=f();this.cgA=f();this.diag=f();
    this.fint=f();this.u0=f();this.target=f();this.work=f();this.work2=f();this.nodeForce=f();this.fext=this.k.loads();
    this.makeViews();
  }
  private makeViews():void {const n=this.n3;this.views={zu:this.z.subarray(0,n),tu:this.trial.subarray(0,n),pu:this.cgP.subarray(0,n),au:this.cgA.subarray(0,n)};}

  // ---- Bodies ----

  /** Add a rigid body the solid collides with or is welded to. Returns its index. */
  addBody(options:SolidContactBodyOptions):number {
    const b=new ContactBody(),s=options.shape;
    if(!s||typeof s!=='object')fail('A body needs a shape.');
    b.type=options.type==='static'?STATIC:options.type==='kinematic'?KINEMATIC:options.type==='dynamic'?DYNAMIC:fail("type must be 'static', 'kinematic' or 'dynamic'.");
    let inertia:StructureInertia;
    if(s.kind==='box'){b.shape=0;for(let i=0;i<3;i++)b.dim[i]=num(s.halfExtents[i],'halfExtents',1e-9,1e9);b.bound=Math.hypot(b.dim[0],b.dim[1],b.dim[2]);inertia={kind:'box',halfExtents:[b.dim[0],b.dim[1],b.dim[2]]};}
    else if(s.kind==='sphere'){b.shape=1;b.dim[0]=num(s.radius,'radius',1e-9,1e9);b.bound=b.dim[0];inertia={kind:'sphere',radius:b.dim[0]};}
    else if(s.kind==='capsule'){b.shape=2;b.dim[0]=num(s.radius,'radius',1e-9,1e9);b.dim[1]=num(s.halfLength,'halfLength',1e-9,1e9);b.bound=b.dim[0]+b.dim[1];inertia={kind:'capsule',radius:b.dim[0],halfLength:b.dim[1]};}
    else if(s.kind==='plane'){
      if(b.type===DYNAMIC)fail('A plane cannot be a dynamic body.');
      const l=Math.hypot(s.normal[0],s.normal[1],s.normal[2]);if(!(l>0))fail('plane.normal must not be zero.');
      b.shape=3;for(let i=0;i<3;i++)b.dim[i]=s.normal[i]/l;b.bound=0;inertia={kind:'locked'};
    }else return fail('Supported shapes: box, sphere, capsule, plane. Hulls, triangle meshes and height fields are not.');
    b.friction=options.friction===undefined?0:num(options.friction,'friction',0,100);
    b.collide=options.collide??true;b.twoWay=options.twoWay??true;b.gravityScale=options.gravityScale===undefined?1:num(options.gravityScale,'gravityScale',-1e3,1e3);
    if(b.type===DYNAMIC){b.mass=num(options.mass,'mass',1e-12,1e15);b.moments=principalMoments(options.inertia??inertia,b.mass);}
    const old=this.bodies.length,ns=this.surfaceNodes.length;
    this.bodies.push(b);this.setBodyState(old,options);
    // Regrow the per-contact arrays with the new body count, keeping friction anchors.
    const nb=old+1,slots=ns*nb,keep8=(a:Uint8Array)=>{const o=new Uint8Array(slots);for(let s2=0;s2<ns;s2++)for(let j=0;j<old;j++)o[s2*nb+j]=a[s2*old+j];return o;};
    const keep=(a:Float64Array,w:number)=>{const o=new Float64Array(w*slots);for(let s2=0;s2<ns;s2++)for(let j=0;j<old;j++)for(let q=0;q<w;q++)o[w*(s2*nb+j)+q]=a[w*(s2*old+j)+q];return o;};
    this.fHas=keep8(this.fHas);this.fl=keep(this.fl,3);this.cForce=keep(this.cForce,1);
    this.cand=new Uint8Array(slots);this.act=new Uint8Array(slots);this.fmode=new Uint8Array(slots);
    this.cn=new Float64Array(3*slots);this.ca=new Float64Array(3*slots);this.cr=new Float64Array(3*slots);this.fa=new Float64Array(3*slots);this.fr=new Float64Array(3*slots);this.fs=new Float64Array(3*slots);
    this.fcap=new Float64Array(slots);this.fsl=new Float64Array(slots);this.kc=new Float64Array(slots);this.g0=new Float64Array(slots);this.f0=new Float64Array(3*slots);this.list=new Uint32Array(slots);this.listCount=0;
    const size=this.size=this.n3+6*nb,grow=(a:Float64Array)=>{const o=new Float64Array(size);o.set(a.subarray(0,this.n3));return o;};
    this.z=grow(this.z);this.G=grow(this.G);this.Gt=grow(this.Gt);this.trial=grow(this.trial);this.cgX=grow(this.cgX);this.cgR=grow(this.cgR);this.cgZ=grow(this.cgZ);this.cgP=grow(this.cgP);this.cgA=grow(this.cgA);this.diag=grow(this.diag);
    this.blocks=new Float64Array(36*nb);this.makeViews();
    return old;
  }
  get bodyCount():number {return this.bodies.length;}
  private body(index:number):ContactBody {const b=this.bodies[index];if(!b)fail(`${index} is not a body of this contact.`);return b;}
  /** Tell the solver where a body is and how it moves, before a step. A kinematic body moves with its velocity through the step. */
  setBodyState(index:number,state:SolidContactBodyState):void {
    const b=this.body(index);
    for(let i=0;i<3;i++){b.x[i]=state.position[i];b.v[i]=state.linearVelocity?state.linearVelocity[i]:0;b.w[i]=state.angularVelocity?state.angularVelocity[i]:0;}
    for(let i=0;i<4;i++)b.q[i]=state.rotation[i];
    quatToMatrix(b.q,b.R);
    if(b.type===STATIC){b.v.fill(0);b.w.fill(0);}
  }
  /** Force and torque on a body from what the solid cannot see (its supports, joints and other loads). */
  setBodyExternalLoad(index:number,force:ArrayLike<number>,torque:ArrayLike<number>,torqueOffset=0):void {const b=this.body(index);for(let i=0;i<3;i++){b.external[i]=force[i];b.external[3+i]=torque[torqueOffset+i];}}
  setBodyMass(index:number,mass:number):void {const b=this.body(index);if(b.type===DYNAMIC&&mass!==b.mass&&mass>0){if(b.moments){const s=mass/b.mass;b.moments[0]*=s;b.moments[1]*=s;b.moments[2]*=s;}b.mass=mass;}}
  /** Force (N) and torque about the centre of mass (N m) the solid put on the body in the last step. Live arrays. */
  bodyForce(index:number):Float64Array {return this.body(index).force;}
  bodyTorque(index:number):Float64Array {return this.body(index).torque;}
  bodyTwoWay(index:number):boolean {const b=this.body(index);return b.type===DYNAMIC&&b.twoWay;}
  bodyGravityScale(index:number):number {return this.body(index).gravityScale;}
  bodyMass(index:number):number {return this.body(index).mass;}
  /** Displacement (m) and rotation vector (rad) the last step gave the body. Live array of six. */
  bodyMotion(index:number):Float64Array {return this.body(index).motion;}
  /** Nodes pressing on the body after the last step. */
  bodyContacts(index:number):number {return this.body(index).contacts;}
  /** Position, rotation quaternion and velocities of a body as this object holds them. Live arrays. */
  bodyPosition(index:number):Float64Array {return this.body(index).x;}
  bodyRotation(index:number):Float64Array {return this.body(index).q;}
  bodyVelocity(index:number):Float64Array {return this.body(index).v;}
  bodyAngularVelocity(index:number):Float64Array {return this.body(index).w;}
  /** out[3..5] = I dw for the body's world inertia at its present rotation (zero for a body that cannot turn). */
  bodyAngularMomentumChange(index:number,dx:number,dy:number,dz:number,out:Float64Array):void {
    const b=this.body(index),R=b.R,mo=b.moments;
    for(let r=0;r<3;r++){
      let s=0;
      if(mo)for(let c=0;c<3;c++){const d=c===0?dx:c===1?dy:dz;for(let j=0;j<3;j++)s+=R[3*r+j]*mo[j]*R[3*c+j]*d;}
      out[3+r]=s;
    }
  }

  // ---- Welds ----

  /** Fix nodes to a body, each at the point of the body where it is now. The weld is a spring of the contact
   * stiffness in all three directions, so the node follows the body within force / stiffness. */
  weld(nodes:ArrayLike<number>,bodyIndex:number):void {
    const b=this.body(bodyIndex),X=this.solid.referencePositions,u=this.solid.displacements,R=b.R,kd=this.k.stiffnessDiagonal;
    for(const raw of Array.from(nodes)){
      const i=raw;if(!Number.isInteger(i)||i<0||i>=this.solid.nodeCount)fail(`${i} is not a node.`);
      if(this.welded.has(i))fail(`Node ${i} is already welded.`);
      const dx=X[3*i]+u[3*i]-b.x[0],dy=X[3*i+1]+u[3*i+1]-b.x[1],dz=X[3*i+2]+u[3*i+2]-b.x[2];
      this.welded.set(i,this.wNode.length);this.wNode.push(i);this.wBody.push(bodyIndex);
      this.wLocal.push(R[0]*dx+R[3]*dy+R[6]*dz,R[1]*dx+R[4]*dy+R[7]*dz,R[2]*dx+R[5]*dy+R[8]*dz);
      this.wK.push(this.stiffnessScale*Math.max(kd[3*i],kd[3*i+1],kd[3*i+2]));b.welds++;
    }
    this.wa=new Float64Array(3*this.wNode.length);this.wr=new Float64Array(3*this.wNode.length);this.w0=new Float64Array(3*this.wNode.length);
  }
  /** Remove the welds of the given nodes. */
  unweld(nodes:ArrayLike<number>):void {
    for(const i of Array.from(nodes)){
      const at=this.welded.get(i);if(at===undefined)continue;
      this.bodies[this.wBody[at]].welds--;
      this.wNode.splice(at,1);this.wBody.splice(at,1);this.wLocal.splice(3*at,3);this.wK.splice(at,1);this.welded.delete(i);
      for(const [node,index] of this.welded)if(index>at)this.welded.set(node,index-1);
    }
    this.wa=new Float64Array(3*this.wNode.length);this.wr=new Float64Array(3*this.wNode.length);this.w0=new Float64Array(3*this.wNode.length);
  }
  get weldCount():number {return this.wNode.length;}

  // ---- Geometry ----

  /** Signed distance of a point in the body's own frame; the outward unit normal goes to this.sn. */
  private sdf(b:ContactBody,px:number,py:number,pz:number):number {
    const n=this.sn,d=b.dim;
    if(b.shape===3){n[0]=d[0];n[1]=d[1];n[2]=d[2];return px*d[0]+py*d[1]+pz*d[2];}
    if(b.shape===1||b.shape===2){
      if(b.shape===2)py-=py>d[1]?d[1]:py<-d[1]?-d[1]:py;
      const l=Math.hypot(px,py,pz);
      if(l>1e-12){n[0]=px/l;n[1]=py/l;n[2]=pz/l;}else{n[0]=0;n[1]=1;n[2]=0;}
      return l-d[0];
    }
    const qx=Math.abs(px)-d[0],qy=Math.abs(py)-d[1],qz=Math.abs(pz)-d[2];
    if(qx<=0&&qy<=0&&qz<=0){
      n[0]=n[1]=n[2]=0;
      if(qx>=qy&&qx>=qz){n[0]=px<0?-1:1;return qx;}
      if(qy>=qz){n[1]=py<0?-1:1;return qy;}
      n[2]=pz<0?-1:1;return qz;
    }
    const ox=qx>0?qx:0,oy=qy>0?qy:0,oz=qz>0?qz:0,l=Math.hypot(ox,oy,oz);
    n[0]=(px<0?-ox:ox)/l;n[1]=(py<0?-oy:oy)/l;n[2]=(pz<0?-oz:oz)/l;return l;
  }

  /** Free motion of every body for a step of h, the pose it leads to, and the contact planes, friction anchors and weld targets there. */
  private prepare(h:number,still:boolean):void {
    const alpha=this.bodyStepFactor,g=this.bodyGravity,nb=this.bodies.length,X=this.solid.referencePositions,u=this.solid.displacements,v=this.solid.velocities,naive=this.scheme==='naive-staggered';
    for(let j=0;j<nb;j++){
      const b=this.bodies[j],R=b.R,Iw=b.Iw,mo=b.moments;
      b.solved=b.type===DYNAMIC&&!naive;b.turns=b.solved&&mo!==null;
      b.free.fill(0);b.load.fill(0);
      if(b.type===DYNAMIC&&mo){
        for(let r=0;r<3;r++)for(let c=0;c<3;c++)Iw[3*r+c]=R[3*r]*mo[0]*R[3*c]+R[3*r+1]*mo[1]*R[3*c+1]+R[3*r+2]*mo[2]*R[3*c+2];
        invert3(Iw,b.Iinv);
      }else{Iw.fill(0);b.Iinv.fill(0);}
      if(still){
        // Statics: linearise at the present pose; the weight is a load and the inertia a proximal term.
        if(b.type===DYNAMIC)for(let i=0;i<3;i++){b.load[i]=b.mass*g[i]*b.gravityScale+b.external[i];b.load[3+i]=b.external[3+i];}
      }else if(b.type===KINEMATIC){for(let i=0;i<3;i++){b.free[i]=h*b.v[i];b.free[3+i]=h*b.w[i];}}
      else if(b.type===DYNAMIC){
        const e=b.external,I=b.Iinv;
        for(let i=0;i<3;i++){
          b.free[i]=h*b.v[i]+alpha*h*h*(g[i]*b.gravityScale+e[i]/b.mass);
          b.free[3+i]=h*b.w[i]+alpha*h*h*(I[3*i]*e[3]+I[3*i+1]*e[4]+I[3*i+2]*e[5]);
        }
      }
      // Planes, anchors and weld targets are taken where the body is now, turned by its free rotation. The body's first
      // three unknowns are its whole displacement of the step, so a body at rest has unknowns near zero and nothing cancels.
      for(let i=0;i<3;i++)b.xp[i]=b.x[i];
      rotationOf(b.free[3],b.free[4],b.free[5],this.m6);
      const E=this.m6,Rp=b.Rp;
      for(let r=0;r<3;r++)for(let c=0;c<3;c++)Rp[3*r+c]=E[3*r]*R[c]+E[3*r+1]*R[3+c]+E[3*r+2]*R[6+c];
    }
    // Contact planes: one per node and body, from where the node is against the body at the start of the step.
    const surface=this.surfaceNodes,n=this.sn,av=this.areaVector,faces=this.solid.faces;this.listCount=0;
    if(nb>0){
      // Outward area vector of every surface node in the present shape: a third of each face it belongs to.
      av.fill(0);
      for(let f=0;f<faces.length;f+=3){
        const a=3*faces[f],b=3*faces[f+1],c=3*faces[f+2],ax=X[a]+u[a],ay=X[a+1]+u[a+1],az=X[a+2]+u[a+2];
        const ux=X[b]+u[b]-ax,uy=X[b+1]+u[b+1]-ay,uz=X[b+2]+u[b+2]-az,vx=X[c]+u[c]-ax,vy=X[c+1]+u[c+1]-ay,vz=X[c+2]+u[c+2]-az;
        const fx=(uy*vz-uz*vy)/6,fy=(uz*vx-ux*vz)/6,fz=(ux*vy-uy*vx)/6;
        av[a]+=fx;av[a+1]+=fy;av[a+2]+=fz;av[b]+=fx;av[b+1]+=fy;av[b+2]+=fz;av[c]+=fx;av[c+1]+=fy;av[c+2]+=fz;
      }
    }
    for(let s=0;s<surface.length;s++){
      const i=3*surface[s],px=X[i]+u[i],py=X[i+1]+u[i+1],pz=X[i+2]+u[i+2],speed=still?0:h*Math.hypot(v[i],v[i+1],v[i+2]);
      for(let j=0;j<nb;j++){
        const b=this.bodies[j],c=s*nb+j;this.cand[c]=0;this.act[c]=0;this.fmode[c]=0;
        if(!b.collide){this.fHas[c]=0;this.cForce[c]=0;continue;}
        const R=b.R,dx=px-b.x[0],dy=py-b.x[1],dz=pz-b.x[2],lx=R[0]*dx+R[3]*dy+R[6]*dz,ly=R[1]*dx+R[4]*dy+R[7]*dz,lz=R[2]*dx+R[5]*dy+R[8]*dz;
        let d=this.sdf(b,lx,ly,lz);
        // A body's face can only press on a node whose own surface is turned towards it. Without this test the side of a
        // box sliding on the solid catches every node ahead of it that stands a contact depth above its lower face.
        const al=Math.hypot(av[i],av[i+1],av[i+2]);
        if(al>0){
          const ux=(R[0]*av[i]+R[3]*av[i+1]+R[6]*av[i+2])/al,uy=(R[1]*av[i]+R[4]*av[i+1]+R[7]*av[i+2])/al,uz=(R[2]*av[i]+R[5]*av[i+1]+R[8]*av[i+2])/al;
          let face=false;
          if(b.shape===0){
            // A box. A node inside it (or on its surface) leaves through the nearest of the faces its own surface is turned
            // towards. A node outside can only meet a face it is in front of, within that face's outline.
            // The outline is taken a tenth of an element wider, so that a node on the box's edge stays under the face when the
            // solid bulges sideways under the load.
            const tol=.1*this.elementSize,inside=Math.max(Math.abs(lx)-b.dim[0],Math.abs(ly)-b.dim[1],Math.abs(lz)-b.dim[2])<=tol;let best=-Infinity,axis=-1,sign=0;
            for(let a=0;a<3;a++){
              const p=a===0?lx:a===1?ly:lz,t=a===0?ux:a===1?uy:uz,p1=a===0?ly:lx,p2=a===2?ly:lz,d1=a===0?b.dim[1]:b.dim[0],d2=a===2?b.dim[1]:b.dim[2];
              if(Math.abs(p1)>d1+tol||Math.abs(p2)>d2+tol)continue;
              const front=p-b.dim[a],back=-p-b.dim[a];
              if(-t>=FACING&&(inside||front>0)&&front>best){best=front;axis=a;sign=1;}
              if(t>=FACING&&(inside||back>0)&&back>best){best=back;axis=a;sign=-1;}
            }
            if(axis>=0){face=true;d=best;n[0]=n[1]=n[2]=0;n[axis]=sign;}
          }
          if(!face&&-(n[0]*ux+n[1]*uy+n[2]*uz)<FACING){this.fHas[c]=0;this.cForce[c]=0;continue;}
        }
        const f=b.free,reach=this.skin+(still?this.elementSize:1.5*(speed+Math.hypot(f[0],f[1],f[2])+Math.hypot(f[3],f[4],f[5])*(b.bound<Infinity?b.bound+Math.abs(d):0)));
        if(d>reach){this.fHas[c]=0;this.cForce[c]=0;continue;}
        this.cand[c]=1;this.list[this.listCount++]=c;
        const Rp=b.Rp,qx=lx-d*n[0],qy=ly-d*n[1],qz=lz-d*n[2],o=3*c;
        for(let r=0;r<3;r++){
          this.cn[o+r]=Rp[3*r]*n[0]+Rp[3*r+1]*n[1]+Rp[3*r+2]*n[2];
          this.cr[o+r]=Rp[3*r]*qx+Rp[3*r+1]*qy+Rp[3*r+2]*qz;this.ca[o+r]=b.xp[r]+this.cr[o+r];
        }
        // The spring's stiffness goes with the area the node turns towards the body (its outward area against the body's
        // normal at the start of the step), so that a uniform pressure is a uniform depth; never below a tenth of its whole share.
        const wx=R[0]*n[0]+R[1]*n[1]+R[2]*n[2],wy=R[3]*n[0]+R[4]*n[1]+R[5]*n[2],wz=R[6]*n[0]+R[7]*n[1]+R[8]*n[2];
        this.kc[c]=this.kArea*Math.max(-(av[i]*wx+av[i+1]*wy+av[i+2]*wz),.1*this.surfaceArea[s]);
        if(!this.fHas[c]){this.fl[o]=lx;this.fl[o+1]=ly;this.fl[o+2]=lz;this.cForce[c]=0;}
        for(let r=0;r<3;r++){this.fr[o+r]=Rp[3*r]*this.fl[o]+Rp[3*r+1]*this.fl[o+1]+Rp[3*r+2]*this.fl[o+2];this.fa[o+r]=b.xp[r]+this.fr[o+r];}
        this.g0[c]=this.cn[o]*(px-this.ca[o])+this.cn[o+1]*(py-this.ca[o+1])+this.cn[o+2]*(pz-this.ca[o+2]);
        this.f0[o]=px-this.fa[o];this.f0[o+1]=py-this.fa[o+1];this.f0[o+2]=pz-this.fa[o+2];
        this.fcap[c]=b.friction*this.cForce[c];
      }
    }
    for(let w=0;w<this.wNode.length;w++){
      const b=this.bodies[this.wBody[w]],Rp=b.Rp,l=this.wLocal;
      for(let r=0;r<3;r++){this.wr[3*w+r]=Rp[3*r]*l[3*w]+Rp[3*r+1]*l[3*w+1]+Rp[3*r+2]*l[3*w+2];this.wa[3*w+r]=b.xp[r]+this.wr[3*w+r];}
      const i=3*this.wNode[w];for(let r=0;r<3;r++)this.w0[3*w+r]=X[i+r]+u[i+r]-this.wa[3*w+r];
    }
  }

  // ---- The function being minimised ----

  /** Energy of the contact, friction and weld springs at y; adds its gradient to G and records what the Hessian needs. */
  private springs(y:Float64Array,G:Float64Array|null):number {
    const u0=this.u0,nb=this.bodies.length,n3=this.n3,surface=this.surfaceNodes;let energy=0;
    for(let q=0;q<this.listCount;q++){
      const c=this.list[q],j=c%nb,s=(c-j)/nb,i=3*surface[s],o=3*c,ob=n3+6*j,k=this.kc[c],b=this.bodies[j];
      // The node's and the body's increments of the step; d = x - a - dc - dtheta x r = d0 + increments.
      const cx=y[ob],cy=y[ob+1],cz=y[ob+2],tx=y[ob+3],ty=y[ob+4],tz=y[ob+5],px=y[i]-u0[i]-cx,py=y[i+1]-u0[i+1]-cy,pz=y[i+2]-u0[i+2]-cz;
      const nx=this.cn[o],ny=this.cn[o+1],nz=this.cn[o+2],rx=this.cr[o],ry=this.cr[o+1],rz=this.cr[o+2];
      const gap=this.g0[c]+nx*(px-(ty*rz-tz*ry))+ny*(py-(tz*rx-tx*rz))+nz*(pz-(tx*ry-ty*rx));
      if(gap<0){
        this.act[c]=1;energy+=.5*k*gap*gap;
        if(G){
          const w=k*gap,wx=w*nx,wy=w*ny,wz=w*nz;G[i]+=wx;G[i+1]+=wy;G[i+2]+=wz;
          if(b.solved||this.all){G[ob]-=wx;G[ob+1]-=wy;G[ob+2]-=wz;G[ob+3]-=ry*wz-rz*wy;G[ob+4]-=rz*wx-rx*wz;G[ob+5]-=rx*wy-ry*wx;}
        }
      }else this.act[c]=0;
      const cap=this.fcap[c];
      if(cap>0){
        const ax=this.fr[o],ay=this.fr[o+1],az=this.fr[o+2];
        let sx=this.f0[o]+px-(ty*az-tz*ay),sy=this.f0[o+1]+py-(tz*ax-tx*az),sz=this.f0[o+2]+pz-(tx*ay-ty*ax);
        const along=nx*sx+ny*sy+nz*sz;sx-=along*nx;sy-=along*ny;sz-=along*nz;
        const slip=Math.hypot(sx,sy,sz);let wx:number,wy:number,wz:number;
        if(k*slip<=cap){this.fmode[c]=1;energy+=.5*k*slip*slip;wx=k*sx;wy=k*sy;wz=k*sz;}
        else{
          this.fmode[c]=2;energy+=cap*slip-.5*cap*cap/k;const inv=1/slip;
          this.fs[o]=sx*inv;this.fs[o+1]=sy*inv;this.fs[o+2]=sz*inv;this.fsl[c]=slip;wx=cap*sx*inv;wy=cap*sy*inv;wz=cap*sz*inv;
        }
        if(G){
          G[i]+=wx;G[i+1]+=wy;G[i+2]+=wz;
          if(b.solved||this.all){G[ob]-=wx;G[ob+1]-=wy;G[ob+2]-=wz;G[ob+3]-=ay*wz-az*wy;G[ob+4]-=az*wx-ax*wz;G[ob+5]-=ax*wy-ay*wx;}
        }
      }else this.fmode[c]=0;
    }
    for(let w=0;w<this.wNode.length;w++){
      const i=3*this.wNode[w],j=this.wBody[w],ob=n3+6*j,k=this.wK[w],b=this.bodies[j],rx=this.wr[3*w],ry=this.wr[3*w+1],rz=this.wr[3*w+2];
      const tx=y[ob+3],ty=y[ob+4],tz=y[ob+5];
      const dx=this.w0[3*w]+y[i]-u0[i]-y[ob]-(ty*rz-tz*ry),dy=this.w0[3*w+1]+y[i+1]-u0[i+1]-y[ob+1]-(tz*rx-tx*rz),dz=this.w0[3*w+2]+y[i+2]-u0[i+2]-y[ob+2]-(tx*ry-ty*rx);
      energy+=.5*k*(dx*dx+dy*dy+dz*dz);
      if(G){
        const wx=k*dx,wy=k*dy,wz=k*dz;G[i]+=wx;G[i+1]+=wy;G[i+2]+=wz;
        if(b.solved||this.all){G[ob]-=wx;G[ob+1]-=wy;G[ob+2]-=wz;G[ob+3]-=ry*wz-rz*wy;G[ob+4]-=rz*wx-rx*wz;G[ob+5]-=rx*wy-ry*wx;}
      }
    }
    return energy;
  }

  /** Phi at y and its gradient on the free unknowns. Infinity when an element is inverted. */
  private objective(y:Float64Array,G:Float64Array,yu:Float64Array):number {
    const k=this.k,fint=this.fint,fext=this.fext,n3=this.n3,cm=this.cm,cd=this.cd,mass=this.solid.nodalMass,alpha=k.massDamping,beta=k.stiffnessDamping;
    let phi=k.energy(yu,fint,true),internal=0,external=0;
    if(!(phi<Infinity))return Infinity;
    for(let j=0;j<n3;j++){phi-=fext[j]*y[j];G[j]=fint[j]-fext[j];internal+=fint[j]*fint[j];external+=fext[j]*fext[j];}
    if(cm>0)for(let j=0;j<n3;j++){const d=y[j]-this.target[j],md=cm*mass[(j-j%3)/3]*d;phi+=.5*md*d;G[j]+=md;}
    if(cd>0){
      const d=this.work;for(let j=0;j<n3;j++)d[j]=y[j]-this.u0[j];
      if(alpha>0)for(let j=0;j<n3;j++){const md=cd*alpha*mass[(j-j%3)/3]*d[j];phi+=.5*md*d[j];G[j]+=md;}
      if(beta>0){k.dampingProduct(d,this.work2);for(let j=0;j<n3;j++){const kd=cd*beta*this.work2[j];phi+=.5*kd*d[j];G[j]+=kd;}}
    }
    const scale=this.bodyScale();
    for(let j=0;j<this.bodies.length;j++){
      const b=this.bodies[j],o=n3+6*j;
      for(let q=0;q<6;q++)G[o+q]=0;
      if(!b.solved)continue;
      const m=b.mass*scale,I=b.Iw,L=b.load;
      for(let q=0;q<3;q++){const d=y[o+q]-b.free[q],md=m*d;phi+=.5*md*d-L[q]*y[o+q];G[o+q]=md-L[q];}
      if(b.turns)for(let q=0;q<3;q++){const It=scale*(I[3*q]*y[o+3]+I[3*q+1]*y[o+4]+I[3*q+2]*y[o+5]);phi+=.5*It*y[o+3+q]-L[3+q]*y[o+3+q];G[o+3+q]=It-L[3+q];}
    }
    phi+=this.springs(y,G);
    for(let j=0;j<n3;j++)if(k.fixed[j])G[j]=0;
    for(let j=0;j<this.bodies.length;j++){const b=this.bodies[j],o=n3+6*j;if(!b.solved)for(let q=0;q<6;q++)G[o+q]=0;else if(!b.turns)for(let q=3;q<6;q++)G[o+q]=0;}
    this.reference=Math.max(Math.sqrt(internal),Math.sqrt(external),this.referenceInertia);
    return phi;
  }
  /** 1 / (alpha h^2): what multiplies a body's mass and inertia in Phi. */
  private bodyScale():number {return this.staticMode?this.cm:1/(this.bodyStepFactor*this.h*this.h);}

  /** out = H p: the solid's tangent, inertia and damping, the bodies' inertia, and the springs. */
  private product(p:Float64Array,out:Float64Array,pu:Float64Array,ou:Float64Array,kScale:number,mScale:number):void {
    const k=this.k,n3=this.n3,nb=this.bodies.length,mass=this.solid.nodalMass,surface=this.surfaceNodes;
    k.tangentProduct(pu,ou);
    for(let j=0;j<n3;j++)out[j]=kScale*out[j]+mScale*mass[(j-j%3)/3]*p[j];
    const scale=this.bodyScale();
    for(let j=0;j<nb;j++){
      const b=this.bodies[j],o=n3+6*j;
      if(!b.solved){for(let q=0;q<6;q++)out[o+q]=0;continue;}
      const m=b.mass*scale,I=b.Iw;
      for(let q=0;q<3;q++){out[o+q]=m*p[o+q];out[o+3+q]=b.turns?scale*(I[3*q]*p[o+3]+I[3*q+1]*p[o+4]+I[3*q+2]*p[o+5]):0;}
    }
    for(let q=0;q<this.listCount;q++){
      const c=this.list[q],mode=this.fmode[c];if(!this.act[c]&&mode===0)continue;
      const j=c%nb,s=(c-j)/nb,i=3*surface[s],o=3*c,ob=n3+6*j,ks=this.kc[c],b=this.bodies[j],live=b.solved;
      const cx=live?p[ob]:0,cy=live?p[ob+1]:0,cz=live?p[ob+2]:0,tx=live?p[ob+3]:0,ty=live?p[ob+4]:0,tz=live?p[ob+5]:0,px=p[i]-cx,py=p[i+1]-cy,pz=p[i+2]-cz;
      const nx=this.cn[o],ny=this.cn[o+1],nz=this.cn[o+2];
      if(this.act[c]){
        const rx=this.cr[o],ry=this.cr[o+1],rz=this.cr[o+2],w=ks*(nx*(px-(ty*rz-tz*ry))+ny*(py-(tz*rx-tx*rz))+nz*(pz-(tx*ry-ty*rx))),wx=w*nx,wy=w*ny,wz=w*nz;
        out[i]+=wx;out[i+1]+=wy;out[i+2]+=wz;
        if(live){out[ob]-=wx;out[ob+1]-=wy;out[ob+2]-=wz;out[ob+3]-=ry*wz-rz*wy;out[ob+4]-=rz*wx-rx*wz;out[ob+5]-=rx*wy-ry*wx;}
      }
      if(mode!==0){
        const ax=this.fr[o],ay=this.fr[o+1],az=this.fr[o+2];
        let sx=px-(ty*az-tz*ay),sy=py-(tz*ax-tx*az),sz=pz-(tx*ay-ty*ax);
        const along=nx*sx+ny*sy+nz*sz;sx-=along*nx;sy-=along*ny;sz-=along*nz;
        let wx:number,wy:number,wz:number;
        if(mode===1){wx=ks*sx;wy=ks*sy;wz=ks*sz;}
        else{const ex=this.fs[o],ey=this.fs[o+1],ez=this.fs[o+2],dot=ex*sx+ey*sy+ez*sz,f=this.fcap[c]/this.fsl[c];wx=f*(sx-dot*ex);wy=f*(sy-dot*ey);wz=f*(sz-dot*ez);}
        out[i]+=wx;out[i+1]+=wy;out[i+2]+=wz;
        if(live){out[ob]-=wx;out[ob+1]-=wy;out[ob+2]-=wz;out[ob+3]-=ay*wz-az*wy;out[ob+4]-=az*wx-ax*wz;out[ob+5]-=ax*wy-ay*wx;}
      }
    }
    for(let w=0;w<this.wNode.length;w++){
      const i=3*this.wNode[w],j=this.wBody[w],ob=n3+6*j,ks=this.wK[w],live=this.bodies[j].solved,rx=this.wr[3*w],ry=this.wr[3*w+1],rz=this.wr[3*w+2];
      const tx=live?p[ob+3]:0,ty=live?p[ob+4]:0,tz=live?p[ob+5]:0;
      const wx=ks*(p[i]-(live?p[ob]:0)-(ty*rz-tz*ry)),wy=ks*(p[i+1]-(live?p[ob+1]:0)-(tz*rx-tx*rz)),wz=ks*(p[i+2]-(live?p[ob+2]:0)-(tx*ry-ty*rx));
      out[i]+=wx;out[i+1]+=wy;out[i+2]+=wz;
      if(live){out[ob]-=wx;out[ob+1]-=wy;out[ob+2]-=wz;out[ob+3]-=ry*wz-rz*wy;out[ob+4]-=rz*wx-rx*wz;out[ob+5]-=rx*wy-ry*wx;}
    }
    for(let j=0;j<n3;j++)if(k.fixed[j])out[j]=0;
    for(let j=0;j<nb;j++){const b=this.bodies[j],o=n3+6*j;if(b.solved&&!b.turns)for(let q=3;q<6;q++)out[o+q]=0;}
  }

  /** Adds B^T K B to body j's 6x6 block for a spring with 3x3 stiffness K (row major) and arm r; B = [-1, [r]x]. */
  private addBlock(j:number,K:number[],rx:number,ry:number,rz:number):void {
    // Columns of B: -e_q for q < 3, r x e_q for the rotation.
    const B=[-1,0,0,0,rz,-ry, 0,-1,0,-rz,0,rx, 0,0,-1,ry,-rx,0],blocks=this.blocks,o=36*j;
    for(let a=0;a<6;a++)for(let c=a;c<6;c++){
      let s=0;
      for(let r=0;r<3;r++){const kb=K[3*r]*B[c]+K[3*r+1]*B[6+c]+K[3*r+2]*B[12+c];s+=B[6*r+a]*kb;}
      blocks[o+6*a+c]+=s;if(c!==a)blocks[o+6*c+a]+=s;
    }
  }
  /** Diagonal of H for the nodes, and the inverse of each solved body's 6x6 block. */
  private precondition(kScale:number,mScale:number):void {
    const k=this.k,n3=this.n3,nb=this.bodies.length,mass=this.solid.nodalMass,diag=this.diag,kd=k.stiffnessDiagonal,surface=this.surfaceNodes,blocks=this.blocks,K=[0,0,0,0,0,0,0,0,0];
    for(let j=0;j<n3;j++)diag[j]=kScale*kd[j]+mScale*mass[(j-j%3)/3];
    blocks.fill(0);const scale=this.bodyScale();
    for(let j=0;j<nb;j++){
      const b=this.bodies[j],o=36*j;if(!b.solved)continue;
      for(let q=0;q<3;q++)blocks[o+7*q]=b.mass*scale;
      for(let r=0;r<3;r++)for(let c=0;c<3;c++)blocks[o+6*(3+r)+3+c]=scale*b.Iw[3*r+c];
    }
    for(let q=0;q<this.listCount;q++){
      const c=this.list[q],mode=this.fmode[c];if(!this.act[c]&&mode===0)continue;
      const j=c%nb,s=(c-j)/nb,i=3*surface[s],o=3*c,ks=this.kc[c],live=this.bodies[j].solved,nx=this.cn[o],ny=this.cn[o+1],nz=this.cn[o+2];
      if(this.act[c]){
        diag[i]+=ks*nx*nx;diag[i+1]+=ks*ny*ny;diag[i+2]+=ks*nz*nz;
        if(live){K[0]=ks*nx*nx;K[1]=K[3]=ks*nx*ny;K[2]=K[6]=ks*nx*nz;K[4]=ks*ny*ny;K[5]=K[7]=ks*ny*nz;K[8]=ks*nz*nz;this.addBlock(j,K,this.cr[o],this.cr[o+1],this.cr[o+2]);}
      }
      if(mode!==0){
        // Stick: k (1 - n n^T). Slip: (cap / |s|) (1 - n n^T - e e^T).
        const f=mode===1?ks:this.fcap[c]/this.fsl[c],ex=mode===1?0:this.fs[o],ey=mode===1?0:this.fs[o+1],ez=mode===1?0:this.fs[o+2];
        K[0]=f*(1-nx*nx-ex*ex);K[1]=K[3]=-f*(nx*ny+ex*ey);K[2]=K[6]=-f*(nx*nz+ex*ez);K[4]=f*(1-ny*ny-ey*ey);K[5]=K[7]=-f*(ny*nz+ey*ez);K[8]=f*(1-nz*nz-ez*ez);
        diag[i]+=K[0];diag[i+1]+=K[4];diag[i+2]+=K[8];
        if(live)this.addBlock(j,K,this.fr[o],this.fr[o+1],this.fr[o+2]);
      }
    }
    for(let w=0;w<this.wNode.length;w++){
      const i=3*this.wNode[w],j=this.wBody[w],ks=this.wK[w];diag[i]+=ks;diag[i+1]+=ks;diag[i+2]+=ks;
      if(this.bodies[j].solved){K[0]=K[4]=K[8]=ks;K[1]=K[2]=K[3]=K[5]=K[6]=K[7]=0;this.addBlock(j,K,this.wr[3*w],this.wr[3*w+1],this.wr[3*w+2]);}
    }
    // Invert each block in place (Gauss-Jordan; the block is symmetric positive definite). A body that cannot turn keeps a unit rotation block.
    const a=this.m6;
    for(let j=0;j<nb;j++){
      const b=this.bodies[j],o=36*j;if(!b.solved)continue;
      if(!b.turns)for(let r=0;r<6;r++)for(let c=0;c<6;c++)if(r>=3||c>=3)blocks[o+6*r+c]=r===c?1:0;
      for(let q=0;q<36;q++)a[q]=blocks[o+q];
      for(let q=0;q<36;q++)blocks[o+q]=q%7===0?1:0;
      for(let col=0;col<6;col++){
        const pivot=a[7*col];if(!(pivot>0)){for(let q=0;q<36;q++)blocks[o+q]=0;break;}
        const inv=1/pivot;
        for(let c=0;c<6;c++){a[6*col+c]*=inv;blocks[o+6*col+c]*=inv;}
        for(let r=0;r<6;r++){
          if(r===col)continue;const f=a[6*r+col];if(f===0)continue;
          for(let c=0;c<6;c++){a[6*r+c]-=f*a[6*col+c];blocks[o+6*r+c]-=f*blocks[o+6*col+c];}
        }
      }
    }
  }
  private applyPreconditioner(r:Float64Array,z:Float64Array):void {
    const n3=this.n3,diag=this.diag,blocks=this.blocks;
    for(let j=0;j<n3;j++)z[j]=r[j]/diag[j];
    for(let j=0;j<this.bodies.length;j++){
      const o=n3+6*j,bo=36*j;
      for(let a=0;a<6;a++){let s=0;for(let c=0;c<6;c++)s+=blocks[bo+6*a+c]*r[o+c];z[o+a]=s;}
    }
  }
  private norm(a:Float64Array):number {let s=0;for(let j=0;j<a.length;j++)s+=a[j]*a[j];return Math.sqrt(s);}

  /** Preconditioned conjugate gradients for H x = -G. Returns the iteration count, negative when it met a direction without curvature. */
  private conjugateGradient(G:Float64Array,target:number,kScale:number,mScale:number):number {
    const x=this.cgX,r=this.cgR,z=this.cgZ,p=this.cgP,ap=this.cgA,size=this.size,limit=this.k.maxLinearIterations;let rz=0,iterations=0;
    for(let j=0;j<size;j++){x[j]=0;r[j]=-G[j];}
    this.applyPreconditioner(r,z);
    for(let j=0;j<size;j++){p[j]=z[j];rz+=r[j]*z[j];}
    while(iterations<limit&&this.norm(r)>target){
      this.product(p,ap,this.views.pu,this.views.au,kScale,mScale);let curvature=0;
      for(let j=0;j<size;j++)curvature+=p[j]*ap[j];
      if(!(curvature>0)||!Number.isFinite(curvature)){if(iterations===0)x.set(z);return -iterations-1;}
      const step=rz/curvature;let next=0;
      for(let j=0;j<size;j++){x[j]+=step*p[j];r[j]-=step*ap[j];}
      this.applyPreconditioner(r,z);
      for(let j=0;j<size;j++)next+=r[j]*z[j];
      const ratio=next/rz;rz=next;iterations++;
      for(let j=0;j<size;j++)p[j]=z[j]+ratio*p[j];
    }
    return iterations;
  }

  /** Newton's method on Phi from the present z. Adds to the iteration counts in `stats`. */
  private minimise():boolean {
    const st=this.stats,k=this.k,size=this.size,z=this.z,kScale=1+this.cd*k.stiffnessDamping,mScale=this.cm+this.cd*k.massDamping,volume=this.solid.mu*this.solid.referenceVolume;
    let phi=this.objective(z,this.G,this.views.zu),residual=this.norm(this.G),reference=0,iterations=0;
    // The force scale is that of the state the step starts from and of the present iterate. Forces met on the way (a
    // starting guess that puts a body deep in a stiff solid) are not part of it.
    const first=this.reference;
    if(!(phi<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted at the start of the solve. Use a smaller time step or a softer contact.');
    st.converged=false;
    for(;;){
      // The springs' forces belong to the force scale: a body at rest on the solid carries its weight through them.
      let spring=0;for(let j=0;j<this.bodies.length;j++){const b=this.bodies[j];if(b.solved)for(let q=0;q<3;q++){const m=b.mass*this.bodyScale()*(z[this.n3+6*j+q]-b.free[q])-b.load[q];spring+=m*m;}}
      reference=Math.max(first,this.reference,Math.sqrt(spring));
      const tolerance=k.forceTolerance+k.tolerance*reference+this.rounding(z);st.residual=residual;st.reference=reference;
      if(residual<=tolerance){st.converged=true;break;}
      if(iterations>=k.maxNewtonIterations)break;
      iterations++;st.newtonIterations++;
      this.precondition(kScale,mScale);
      const inner=this.conjugateGradient(this.G,Math.max(.1*tolerance,Math.min(.1,Math.sqrt(residual/reference))*residual),kScale,mScale);
      st.linearIterations+=Math.abs(inner);
      const x=this.cgX;let slope=0;for(let j=0;j<size;j++)slope+=this.G[j]*x[j];
      if(!(slope<0))break;
      let accepted=false,trialPhi=0,trialResidual=0;
      for(let search=0,t=1;search<48;search++,t*=.5){
        for(let j=0;j<size;j++)this.trial[j]=z[j]+t*x[j];
        trialPhi=this.objective(this.trial,this.Gt,this.views.tu);
        if(!(trialPhi<Infinity))continue;
        trialResidual=this.norm(this.Gt);
        if(trialPhi<=phi+1e-4*t*slope||(trialResidual<residual&&Math.abs(trialPhi-phi)<=1e-10*Math.max(Math.abs(phi),Math.abs(trialPhi))+1e-14*volume)){accepted=true;break;}
      }
      if(!accepted)break;
      if(!Number.isFinite(trialPhi)||!Number.isFinite(trialResidual))throw new EngineError('NUMERICAL_FAILURE','The contact solve produced a nonfinite state.');
      z.set(this.trial);const swap=this.G;this.G=this.Gt;this.Gt=swap;phi=trialPhi;residual=trialResidual;
    }
    return st.converged;
  }

  /** What rounding leaves of the spring forces, N. A gap is the start gap plus the node's and the body's increments of the
   * step, and those cancel to the contact depth: a spring of stiffness k cannot resolve its force below
   * k * (largest increment) * 2^-52. For ordinary stiffness this is far below the tolerance; for a steel block under a
   * body of a few grams it is the limit. */
  private rounding(z:Float64Array):number {
    const nb=this.bodies.length,n3=this.n3;let stiff=0,active=0,travel=0;
    for(let q=0;q<this.listCount;q++){const c=this.list[q];if(this.act[c]||this.fmode[c]!==0){active++;if(this.kc[c]>stiff)stiff=this.kc[c];}}
    for(let w=0;w<this.wK.length;w++){active++;if(this.wK[w]>stiff)stiff=this.wK[w];}
    if(active===0)return 0;
    for(let j=0;j<nb;j++){const b=this.bodies[j],o=n3+6*j;travel=Math.max(travel,Math.hypot(z[o],z[o+1],z[o+2])+Math.hypot(z[o+3],z[o+4],z[o+5])*(b.bound<Infinity?b.bound:0));}
    for(let q=0;q<this.listCount;q++){const c=this.list[q];if(!this.act[c])continue;const i=3*this.surfaceNodes[(c-c%nb)/nb];travel=Math.max(travel,Math.abs(z[i]-this.u0[i]),Math.abs(z[i+1]-this.u0[i+1]),Math.abs(z[i+2]-this.u0[i+2]));}
    return 4*2.220446049250313e-16*stiff*travel*Math.sqrt(active);
  }
  /** Normal forces of the present z, and how far the friction limits mu N are from the ones in use (largest change and largest limit, through `this.v6`). With `apply` the new limits replace them. */
  private updateCaps(apply:boolean):void {
    const u0=this.u0,z=this.z,nb=this.bodies.length,n3=this.n3;let change=0,largest=0;
    for(let q=0;q<this.listCount;q++){
      const c=this.list[q],j=c%nb,s=(c-j)/nb,i=3*this.surfaceNodes[s],o=3*c,ob=n3+6*j,b=this.bodies[j];
      const tx=z[ob+3],ty=z[ob+4],tz=z[ob+5],rx=this.cr[o],ry=this.cr[o+1],rz=this.cr[o+2];
      const gap=this.g0[c]+this.cn[o]*(z[i]-u0[i]-z[ob]-(ty*rz-tz*ry))+this.cn[o+1]*(z[i+1]-u0[i+1]-z[ob+1]-(tz*rx-tx*rz))+this.cn[o+2]*(z[i+2]-u0[i+2]-z[ob+2]-(tx*ry-ty*rx));
      const force=gap<0?-this.kc[c]*gap:0,cap=b.friction*force;
      this.cForce[c]=force;change=Math.max(change,Math.abs(cap-this.fcap[c]));largest=Math.max(largest,cap);if(apply)this.fcap[c]=cap;
    }
    this.v6[0]=change;this.v6[1]=largest;
  }

  /** One solve of the present step: Newton passes until the friction limits stop changing. */
  private solve():boolean {
    const st=this.stats;st.newtonIterations=0;st.linearIterations=0;st.frictionPasses=0;
    let ok=true,settled=false,friction=false;
    for(let j=0;j<this.bodies.length;j++)if(this.bodies[j].friction>0&&this.bodies[j].collide)friction=true;
    for(let pass=0;pass<this.frictionPasses;pass++){
      ok=this.minimise();st.frictionPasses++;
      // The limits in use stay as they are once they have settled, so that the forces reported are those of the solve.
      this.updateCaps(false);
      if(!friction||this.v6[0]<=this.frictionTolerance*this.v6[1]+1e-300){settled=true;break;}
      if(pass+1<this.frictionPasses)this.updateCaps(true);
    }
    return ok&&settled;
  }

  /** Forces on the bodies and the nodes from the springs of the converged state; friction anchors of sliding contacts are dragged along. */
  private collect(h:number,still:boolean):void {
    const X=this.solid.referencePositions,z=this.z,nb=this.bodies.length,n3=this.n3,nf=this.nodeForce,G=this.Gt;let contacts=0;
    // The springs' gradient alone, with every body's entries filled in.
    for(let j=0;j<nb;j++)this.bodies[j].contacts=0;
    G.fill(0);this.all=true;this.springs(z,G);this.all=false;
    for(let j=0;j<nb;j++){const b=this.bodies[j],o=n3+6*j;for(let q=0;q<3;q++){b.force[q]=-G[o+q];b.torque[q]=-G[o+3+q];}}
    for(let j=0;j<n3;j++)nf[j]=-G[j];
    for(let q=0;q<this.listCount;q++){
      const c=this.list[q],j=c%nb,s=(c-j)/nb,o=3*c,b=this.bodies[j],force=this.cForce[c];
      if(!(force>0)){this.fHas[c]=0;continue;}
      b.contacts++;contacts++;this.fHas[c]=1;
      if(this.fmode[c]===2){
        // Sliding: the anchor follows the node until the spring is back at its limit.
        const cap=this.fcap[c],ks=this.kc[c],shift=this.fsl[c]-cap/ks,Rp=b.Rp,ex=this.fs[o],ey=this.fs[o+1],ez=this.fs[o+2];
        this.fl[o]+=shift*(Rp[0]*ex+Rp[3]*ey+Rp[6]*ez);this.fl[o+1]+=shift*(Rp[1]*ex+Rp[4]*ey+Rp[7]*ez);this.fl[o+2]+=shift*(Rp[2]*ex+Rp[5]*ey+Rp[8]*ez);
      }else if(this.fmode[c]===0&&b.friction>0){
        // First touch: anchor where the node is now.
        const i=3*this.surfaceNodes[s],ob=n3+6*j,Rp=b.Rp,dx=X[i]+z[i]-z[ob]-b.xp[0],dy=X[i+1]+z[i+1]-z[ob+1]-b.xp[1],dz=X[i+2]+z[i+2]-z[ob+2]-b.xp[2];
        this.fl[o]=Rp[0]*dx+Rp[3]*dy+Rp[6]*dz;this.fl[o+1]=Rp[1]*dx+Rp[4]*dy+Rp[7]*dz;this.fl[o+2]=Rp[2]*dx+Rp[5]*dy+Rp[8]*dz;
      }
    }
    this.stats.contacts=contacts;
    // Work of the bodies on the solid: minus the force on each body times how far it went.
    for(let j=0;j<nb;j++){
      const b=this.bodies[j],o=n3+6*j;let work=0;
      for(let q=0;q<3;q++){b.motion[q]=z[o+q];b.motion[3+q]=b.free[3+q]+z[o+3+q];work-=b.force[q]*b.motion[q]+b.torque[q]*b.motion[3+q];}
      this.externalWork+=work;
    }
    if(!still&&!this.integrateBodies)return;
    // This object's own bodies: move them.
    for(let j=0;j<nb;j++){
      const b=this.bodies[j],o=n3+6*j;if(b.type===STATIC)continue;
      const tx=b.free[3]+z[o+3],ty=b.free[4]+z[o+4],tz=b.free[5]+z[o+5];
      for(let q=0;q<3;q++)b.x[q]+=z[o+q];
      rotateQuat(b.q,tx,ty,tz);quatToMatrix(b.q,b.R);
      if(b.type!==DYNAMIC||still)continue;
      const g=this.bodyGravity,I=b.Iinv,live=b.twoWay?1:0;
      for(let q=0;q<3;q++){
        b.v[q]+=h*(g[q]*b.gravityScale+(live*b.force[q]+b.external[q])/b.mass);
        b.w[q]+=h*(I[3*q]*(live*b.torque[0]+b.external[3])+I[3*q+1]*(live*b.torque[1]+b.external[4])+I[3*q+2]*(live*b.torque[2]+b.external[5]));
      }
    }
  }

  // ---- Stepping ----

  /** Advance the solid, and this object's own dynamic bodies, by `count` backward-Euler steps of the solid's dt. */
  step(count=1):void {
    if(!Number.isInteger(count)||count<0)fail('count must be a whole number.');
    const k=this.k,h=this.dt,n3=this.n3,solid=this.solid,u=solid.displacements,v=solid.velocities,mass=solid.nodalMass,z=this.z;
    this.fext=k.loads();k.applyConstraints();
    for(let s=0;s<count;s++){
      this.h=h;this.staticMode=false;this.cm=1/(h*h);this.cd=k.massDamping>0||k.stiffnessDamping>0?1/h:0;
      let inertia=0;
      for(let j=0;j<n3;j++){this.u0[j]=u[j];this.target[j]=u[j]+h*v[j];const mv=this.cm*mass[(j-j%3)/3]*h*v[j];inertia+=mv*mv;z[j]=u[j];}
      this.referenceInertia=Math.sqrt(inertia);
      k.holdDampingTangent();
      this.prepare(h,false);
      // A body starts where the last step left it against its free motion: for a body at rest on the solid that is the answer.
      for(let j=0;j<this.bodies.length;j++){
        const b=this.bodies[j],o=n3+6*j;
        if(!b.solved||!this.warm){for(let q=0;q<3;q++){z[o+q]=b.free[q];z[o+3+q]=0;}}
        else if(!b.turns)for(let q=3;q<6;q++)z[o+q]=0;
      }
      this.warm=true;
      const ok=this.solve();
      if(!ok)this.stats.unconvergedSteps++;
      for(let j=0;j<n3;j++){u[j]=z[j];v[j]=k.fixed[j]?0:(z[j]-this.u0[j])/h;if(!Number.isFinite(u[j]))throw new EngineError('NUMERICAL_FAILURE','The contact step produced a nonfinite state.');}
      this.collect(h,false);
      k.advance(this.stats.converged);
    }
  }

  /** Static equilibrium of the solid and the bodies under the present loads, constraints and contacts, by proximal
   * steps: each minimises the potential energy plus m |x - x_k|^2 / (2 s^2) with the pseudo step `s`, which keeps the
   * problem well posed for a body or a solid that only contact holds. Contact planes are taken afresh every pass.
   * Dynamic bodies take part with their weight and are moved; start them touching, or nearly touching, the solid.
   * The solution becomes the state, at rest. */
  solveStatic(options:{readonly pseudoStep?:number;readonly maxPasses?:number;readonly tolerance?:number}={}):SolidStaticContactResult {
    const s=options.pseudoStep===undefined?1e3:num(options.pseudoStep,'pseudoStep',1e-9,1e12),limit=options.maxPasses===undefined?60:num(options.maxPasses,'maxPasses',1,100000),tolerance=options.tolerance===undefined?1e-9:num(options.tolerance,'tolerance',0,1);
    const k=this.k,n3=this.n3,solid=this.solid,u=solid.displacements,z=this.z;
    this.fext=k.loads();k.applyConstraints();solid.velocities.fill(0);
    for(const b of this.bodies){b.v.fill(0);b.w.fill(0);}
    let passes=0,change=Infinity,converged=false,ok=false;
    while(passes<limit){
      this.h=s;this.staticMode=true;this.cm=1/(s*s);this.cd=0;this.referenceInertia=0;
      for(let j=0;j<n3;j++){this.u0[j]=u[j];this.target[j]=u[j];z[j]=u[j];}
      for(let j=n3;j<this.size;j++)z[j]=0;
      this.prepare(s,true);
      ok=this.solve();passes++;
      let moved=0,scale=0;
      for(let j=0;j<n3;j++){moved=Math.max(moved,Math.abs(z[j]-this.u0[j]));scale=Math.max(scale,Math.abs(z[j]));u[j]=z[j];}
      for(let j=n3;j<this.size;j++){moved=Math.max(moved,Math.abs(z[j])*((j-n3)%6<3?1:this.elementSize));}
      this.collect(s,true);
      change=moved;
      if(ok&&moved<=tolerance*Math.max(scale,this.elementSize*1e-3)){converged=true;break;}
    }
    this.staticMode=false;this.warm=false;solid.velocities.fill(0);
    // A plastic solid keeps the state this solve reached as one increment from where it started.
    k.commit();
    return {converged,passes,residual:this.stats.residual,change};
  }

  // ---- Outputs ----

  /** Energy stored in the contact, friction and weld springs after the last solve, J. */
  contactEnergy():number {return this.listCount>0||this.wNode.length>0?this.springs(this.z,null):0;}
  /** Depth of the deepest contact after the last solve, m. */
  maxPenetration():number {
    let deepest=0;const nb=this.bodies.length;
    for(let q=0;q<this.listCount;q++){const c=this.list[q],s=(c-c%nb)/nb;if(this.cForce[c]>0)deepest=Math.max(deepest,this.cForce[c]/this.kc[c]);}
    return deepest;
  }
  /** Linear momentum of the solid plus this object's dynamic bodies, kg m/s. */
  linearMomentum(out:number[]|Float64Array=[0,0,0]):number[]|Float64Array {
    const v=this.solid.velocities,m=this.solid.nodalMass;out[0]=out[1]=out[2]=0;
    for(let i=0;i<this.solid.nodeCount;i++)for(let q=0;q<3;q++)out[q]+=m[i]*v[3*i+q];
    for(const b of this.bodies)if(b.type===DYNAMIC)for(let q=0;q<3;q++)out[q]+=b.mass*b.v[q];
    return out;
  }
}

// -------------------------------------------------------------------------------------------------
// Coupling to a rigid world.
// -------------------------------------------------------------------------------------------------

/** The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it. */
export interface SolidWorld<B> {
  gravity():readonly number[];
  getState(body:B):{readonly position:readonly number[];readonly rotation:readonly number[];readonly linearVelocity:readonly number[];readonly angularVelocity:readonly number[];readonly mass:number;readonly type:string};
  /** Force in newtons acting over the next step, at the centre of mass when no point is given. */
  applyForce(body:B,force:SolidContactVec3,point?:SolidContactVec3):void;
  applyTorque(body:B,torque:SolidContactVec3):void;
  isAlive?(body:B):boolean;
  readonly loop?:{readonly step:number};
  /** Solver substeps per step: with n of them the rigid step moves a body by h v + (n + 1) / (2 n) h^2 a. */
  readonly subSteps?:number;
}
export interface SolidColliderOptions {
  /** The world cannot report shapes: say what the body is. */
  readonly shape:SolidContactShape;
  /** Coulomb coefficient between the body and the solid. Default 0. */
  readonly friction?:number;
  /** Rotational inertia of a dynamic body. Default: that of the shape with uniform density. */
  readonly inertia?:StructureInertia;
  readonly collide?:boolean;
  readonly twoWay?:boolean;
  readonly gravityScale?:number;
}
export interface SolidCouplingOptions extends SolidContactOptions {
  /** Estimate, from how each body actually moved in the last rigid step, the force its other contacts and joints put
   * on it, and let the solid count on it. Default true. Without it a body resting on rigid ground is seen as falling. */
  readonly estimateSupports?:boolean;
}
export interface SolidCouplingDiagnostics {
  solidKinetic:number;solidStrain:number;solidPotential:number;contact:number;
  /** Translational kinetic energy and -m g.x of the coupled dynamic bodies, J. Their rotational energy is not counted. */
  bodyKinetic:number;bodyPotential:number;total:number;
  /** Linear momentum of the solid and the coupled dynamic bodies, kg m/s. */
  momentum:[number,number,number];
  mass:number;
}
interface CoupledBody<B> {readonly body:B|null;readonly index:number;readonly prevV:Float64Array;readonly prevW:Float64Array;readonly x:Float64Array;readonly q:Float64Array;seen:boolean;dynamic:boolean;contact:boolean}
/** True when a float32 value of the world is the float64 value the solve expected, to within `ulps` of float32 rounding. */
function sameFloat32(world:number,expected:number,ulps:number):boolean {return Math.abs(world-expected)<=ulps*1.1920928955078125e-7*Math.max(Math.abs(world),1e-3);}

// The rigid world works in float32 and refuses a nonzero component too small for one (below about
// 1.4e-45). Such a component is round-off of the solve, so hand over an exact zero instead.
function flush(value:number):number {return Math.fround(value)===0?0:value;}

/**
 * Two-way coupling of a deformable solid with a rigid world. Call `step()` immediately before `world.step()`: it reads
 * the bodies, advances the solid by one step with the dynamic bodies as unknowns of the same solve, and gives each
 * body the force and torque the solid put on it, to act through the rigid step.
 */
export class SolidCoupling<B> {
  /** Everything a later step reads, as a state tree (checkpoint.ts), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,SOLID_COUPLING_FIELDS);}
  /** Put back a state from `saveState()` of a coupling set up the same way (same solid, bodies, planes and welds, in the same order). */
  restoreState(state:StateValue):void {restoreFields(this,state,SOLID_COUPLING_FIELDS);}

  readonly backend=SOLID_COUPLING_BACKEND;
  readonly world:SolidWorld<B>;readonly contact:SolidContact;readonly solid:SolidBody;readonly dt:number;readonly estimateSupports:boolean;
  private readonly list:CoupledBody<B>[]=[];private readonly byBody=new Map<B,CoupledBody<B>>();
  private readonly load=new Float64Array(6);private readonly out:[number,number,number]=[0,0,0];
  steps=0;

  constructor(world:SolidWorld<B>,solid:SolidBody,options:SolidCouplingOptions={}) {
    if(!world||typeof world.getState!=='function'||typeof world.applyForce!=='function'||typeof world.applyTorque!=='function'||typeof world.gravity!=='function')
      throw new TypeError('SolidCoupling needs a world with gravity(), getState(), applyForce() and applyTorque().');
    const {estimateSupports,...rest}=options,g=world.gravity();
    this.contact=new SolidContact(solid,{...rest,gravity:[Number(g[0]),Number(g[1]),Number(g[2])]});
    this.world=world;this.solid=solid;this.dt=solid.dt;
    if(world.loop&&Math.abs(world.loop.step-solid.dt)>1e-12)fail(`The solid steps at ${solid.dt} s but the world at ${world.loop.step} s: they must be equal.`);
    this.estimateSupports=estimateSupports??true;
    this.contact.integrateBodies=false;
    const sub=world.subSteps;this.contact.bodyStepFactor=sub!==undefined&&sub>0?(sub+1)/(2*sub):1;
  }
  /** Let the solid collide with a body of the world, and (for a dynamic body) push it. Returns the body's index in the contact solver. */
  addBody(body:B,options:SolidColliderOptions):number {
    if(this.byBody.has(body))fail('That body is already coupled to this solid.');
    const s=this.world.getState(body);
    if(s.type!=='static'&&s.type!=='kinematic'&&s.type!=='dynamic')fail(`Unknown body type "${s.type}".`);
    const index=this.contact.addBody({...options,type:s.type as 'static'|'kinematic'|'dynamic',mass:s.type==='dynamic'?s.mass:undefined,position:s.position,rotation:s.rotation,linearVelocity:s.linearVelocity,angularVelocity:s.angularVelocity});
    const entry:CoupledBody<B>={body,index,prevV:new Float64Array(3),prevW:new Float64Array(3),x:new Float64Array(3),q:new Float64Array([0,0,0,1]),seen:false,dynamic:s.type==='dynamic',contact:false};
    this.list.push(entry);this.byBody.set(body,entry);return index;
  }
  /** A fixed plane that is not a body of the world (the ground): the half space behind `normal` through `point`. */
  addPlane(options:{readonly normal:SolidContactVec3;readonly point?:SolidContactVec3;readonly friction?:number}):number {
    const index=this.contact.addBody({shape:{kind:'plane',normal:options.normal},type:'static',position:options.point??[0,0,0],rotation:[0,0,0,1],friction:options.friction});
    this.list.push({body:null,index,prevV:new Float64Array(3),prevW:new Float64Array(3),x:new Float64Array(3),q:new Float64Array([0,0,0,1]),seen:false,dynamic:false,contact:false});return index;
  }
  private entry(body:B):CoupledBody<B> {const e=this.byBody.get(body);if(!e)fail('That body is not coupled to this solid: addBody() it first.');return e as CoupledBody<B>;}
  indexOf(body:B):number {return this.entry(body).index;}
  /** Fix solid nodes to a coupled body, each at the point of the body where it is now. Two-way for a dynamic body. */
  weld(nodes:ArrayLike<number>,body:B):void {
    const e=this.entry(body);this.contact.setBodyState(e.index,this.world.getState(body));this.contact.weld(nodes,e.index);
  }
  unweld(nodes:ArrayLike<number>):void {this.contact.unweld(nodes);}
  /** Force (N) and torque about the centre of mass (N m) the solid put on the body in the last step. Live arrays. */
  force(body:B):Float64Array {return this.contact.bodyForce(this.entry(body).index);}
  torque(body:B):Float64Array {return this.contact.bodyTorque(this.entry(body).index);}
  /** Advance the solid one step against the bodies as they are now and hand them its forces. Call immediately before world.step(). */
  step():void {
    const world=this.world,contact=this.contact,h=this.dt,g=world.gravity(),load=this.load,out=this.out;
    for(let q=0;q<3;q++)contact.bodyGravity[q]=Number(g[q]);
    for(let i=0;i<this.list.length;i++){
      const e=this.list[i];if(e.body===null)continue;
      if(world.isAlive&&!world.isAlive(e.body))continue;
      const s=world.getState(e.body);
      contact.setBodyState(e.index,s);
      if(!e.dynamic)continue;
      if(e.seen){
        // The world keeps float32 positions: a body at 0.1 m is known to 7e-9 m, which a stiff contact turns into a large
        // force. Where the world put the body where the last solve said it would go, to within that rounding, keep the
        // float64 value; anything else that moved it shows as a larger difference and the world's value is taken.
        const x=contact.bodyPosition(e.index),q=contact.bodyRotation(e.index);let same=true;
        for(let k=0;k<3;k++)if(!sameFloat32(s.position[k],e.x[k],4))same=false;
        for(let k=0;k<4;k++)if(!sameFloat32(s.rotation[k],e.q[k],4))same=false;
        if(same){for(let k=0;k<3;k++)x[k]=e.x[k];for(let k=0;k<4;k++)q[k]=e.q[k];contact.setBodyState(e.index,{position:x,rotation:q,linearVelocity:s.linearVelocity,angularVelocity:s.angularVelocity});}
      }
      contact.setBodyMass(e.index,s.mass);
      load.fill(0);
      if(this.estimateSupports&&e.seen){
        // What moved the body in the last rigid step, less gravity and less what the solid applied, is its other contacts and joints.
        const F=contact.bodyForce(e.index),T=contact.bodyTorque(e.index),v=s.linearVelocity,w=s.angularVelocity,scale=contact.bodyGravityScale(e.index),live=contact.bodyTwoWay(e.index)?1:0;
        for(let q=0;q<3;q++)load[q]=s.mass*((v[q]-e.prevV[q])/h-Number(g[q])*scale)-live*F[q];
        contact.bodyAngularMomentumChange(e.index,w[0]-e.prevW[0],w[1]-e.prevW[1],w[2]-e.prevW[2],load);
        for(let q=0;q<3;q++)load[3+q]=load[3+q]/h-live*T[q];
      }
      contact.setBodyExternalLoad(e.index,load,load,3);
      for(let q=0;q<3;q++){e.prevV[q]=s.linearVelocity[q];e.prevW[q]=s.angularVelocity[q];}
      e.seen=true;
    }
    contact.step(1);
    for(let i=0;i<this.list.length;i++){
      const e=this.list[i];if(e.body===null||!e.dynamic)continue;
      // Where the solve expects the world to put the body.
      const x=contact.bodyPosition(e.index),q=contact.bodyRotation(e.index),motion=contact.bodyMotion(e.index);
      for(let k=0;k<3;k++)e.x[k]=x[k]+motion[k];
      for(let k=0;k<4;k++)e.q[k]=q[k];
      rotateQuat(e.q,motion[3],motion[4],motion[5]);
      if(!contact.bodyTwoWay(e.index))continue;
      if(world.isAlive&&!world.isAlive(e.body))continue;
      const F=contact.bodyForce(e.index),T=contact.bodyTorque(e.index);
      out[0]=flush(F[0]);out[1]=flush(F[1]);out[2]=flush(F[2]);if(out[0]!==0||out[1]!==0||out[2]!==0)world.applyForce(e.body,out);
      out[0]=flush(T[0]);out[1]=flush(T[1]);out[2]=flush(T[2]);if(out[0]!==0||out[1]!==0||out[2]!==0)world.applyTorque(e.body,out);
    }
    this.steps++;
  }
  /** Bodies whose contact with the solid began or ended in the last step: calls `each(body, index, touching)`. */
  contactChanges(each:(body:B|null,index:number,touching:boolean)=>void):void {
    for(let i=0;i<this.list.length;i++){
      const e=this.list[i],now=this.contact.bodyContacts(e.index)>0;
      if(now!==e.contact){e.contact=now;each(e.body,e.index,now);}
    }
  }
  /** Energies and momentum of the solid and the coupled dynamic bodies. Allocates; not for the hot path. */
  diagnostics():SolidCouplingDiagnostics {
    const solid=this.solid,g=this.world.gravity(),momentum:[number,number,number]=[0,0,0],v=solid.velocities,m=solid.nodalMass;
    for(let i=0;i<solid.nodeCount;i++)for(let q=0;q<3;q++)momentum[q]+=m[i]*v[3*i+q];
    const d:SolidCouplingDiagnostics={solidKinetic:solid.kineticEnergy(),solidStrain:solid.strainEnergy(),solidPotential:solid.loadPotential(),contact:this.contact.contactEnergy(),bodyKinetic:0,bodyPotential:0,total:0,momentum,mass:solid.mass};
    for(const e of this.list){
      if(e.body===null||!e.dynamic)continue;
      if(this.world.isAlive&&!this.world.isAlive(e.body))continue;
      const s=this.world.getState(e.body),bv=s.linearVelocity,x=s.position;
      d.bodyKinetic+=.5*s.mass*(bv[0]*bv[0]+bv[1]*bv[1]+bv[2]*bv[2]);d.bodyPotential-=s.mass*(Number(g[0])*x[0]+Number(g[1])*x[1]+Number(g[2])*x[2]);d.mass+=s.mass;
      for(let q=0;q<3;q++)momentum[q]+=s.mass*bv[q];
    }
    d.total=d.solidKinetic+d.solidStrain+d.solidPotential+d.contact+d.bodyKinetic+d.bodyPotential;
    return d;
  }
}

/** Where the solid coupling runs inside the couple stage of a Simulation: after the cloth (150), before the water (200). */
export const SOLID_CONTACT_SUBSYSTEM_ORDER=170;

/**
 * A solid in contact as a subsystem of the one stepping loop (simulation.ts).
 *  - A `SolidCoupling`: couple stage, order 170. It exchanges forces with the rigid step, so its dt must equal the
 *    simulation step.
 *  - A bare `SolidContact` (its own bodies, no world): post stage; its dt may be the step or a whole fraction of it.
 * Do not also register the same SolidBody with `solidSubsystem`: it would be stepped twice.
 * Energy: kinetic + strain + load potential of the solid plus the energy in the contact springs, with the work the
 * bodies did on the solid as `exchanged`; the bodies themselves are not counted (track them with
 * `simulation.trackBody`). Backward Euler and friction make `total - exchanged` fall.
 * Events, emitted at the end of a step: 'contact-begin' and 'contact-end' with {body, index} when a body starts or
 * stops pressing on the solid (SolidCoupling only), and 'unconverged' with {residual, reference}.
 */
export function solidContactSubsystem<W,B>(target:SolidContact|SolidCoupling<B>,options:{readonly id?:string;readonly order?:number}={}):Subsystem<W,B> {
  const coupling=target instanceof SolidCoupling?target:null,contact=coupling?coupling.contact:target as SolidContact;
  if(!(contact instanceof SolidContact))throw new TypeError('solidContactSubsystem needs a SolidContact or a SolidCoupling.');
  const solid=contact.solid;let unconverged=contact.stats.unconvergedSteps;
  return {
    id:options.id??'solid-contact',kind:coupling?'solid-coupling':'solid-contact',stage:coupling?'couple':'post',order:options.order??(coupling?SOLID_CONTACT_SUBSYSTEM_ORDER:300),
    timeStep:{dt:solid.dt,rule:coupling?'equal':'commensurate'},
    validate(info){if(!coupling&&info.timing.every>1)throw new EngineError('INVALID_STATE','A solid in contact cannot step less often than the simulation.');},
    step(ctx){if(coupling)coupling.step();else contact.step(ctx.substeps);},
    // The solid, the contact solver (with the coupling's records) and the event cursor.
    checkpoint(){return {state:coupling?coupling.saveState():{solid:solid.saveState(),contact:contact.saveState()},unconverged};},
    restore(state){
      const s=state as {state?:{solid?:StateValue;contact?:StateValue};unconverged?:unknown}|null;
      if(!s||!s.state||typeof s.unconverged!=='number')throw checkpointError(`Subsystem "${options.id??'solid-contact'}": the saved state is malformed.`);
      if(coupling)coupling.restoreState(s.state);else{solid.restoreState(s.state.solid);contact.restoreState(s.state.contact);}
      unconverged=s.unconverged;
    },
    finish(ctx){
      if(coupling)coupling.contactChanges((body,index,touching)=>ctx.emit(touching?'contact-begin':'contact-end',{body,index}));
      if(contact.stats.unconvergedSteps!==unconverged){unconverged=contact.stats.unconvergedSteps;ctx.emit('unconverged',{residual:contact.stats.residual,reference:contact.stats.reference});}
    },
    energy(){
      const kinetic=solid.kineticEnergy(),strain=solid.strainEnergy(),potential=solid.loadPotential(),springs=contact.contactEnergy();
      return {domain:'mechanical',total:kinetic+strain+potential+springs,exchanged:contact.externalWork,parts:{kinetic,strain,loadPotential:potential,contact:springs}};
    },
    diagnostics(){return {solver:contact.solver,backend:coupling?coupling.backend:null,scheme:contact.scheme,nodes:solid.nodeCount,elements:solid.tetCount,bodies:contact.bodyCount,welds:contact.weldCount,time:solid.time,maxPenetration:contact.maxPenetration(),...contact.stats};},
  };
}
