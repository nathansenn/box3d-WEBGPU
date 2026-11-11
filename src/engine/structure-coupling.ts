import {EngineError} from './contracts.ts';
import type {CompliantCableRuntime} from './compliant-cable.ts';
import type {FrameRuntime} from './frame-runtime.ts';

/** Two-way coupling of rigid bodies with cables (compliant-cable.ts) and frames (frame-runtime.ts).
 *
 * Every attachment is solved with the effective mass of BOTH sides, so a light body on a stiff
 * structure is stable at any step:
 *
 *  - Cable <-> body or frame node ("proxy"): the attached cable node is driven to the attachment
 *    point each step and given that point's effective mass along the cable, 1 / (d^T G d), with G the
 *    carrier's impulse response. The cable's own implicit solve then finds the tension; the impulse
 *    the carrier needs to follow the node is applied to it, equal and opposite to what the cable felt.
 *  - Frame <-> body ("Schur"): pinned (3 equations) or clamped (6) velocity constraints between a body
 *    point and a frame node, solved exactly for the interface impulses with the dense interface
 *    matrix S = G_body + A^-1, A = M (1 + c h/2) + (h^2/4) K being the frame's midpoint operator. The
 *    impulse reaches the body as two half kicks around world.step(), which makes the body's share of
 *    the interface work a midpoint rule like the frame's: no first-order energy loss.
 *
 * Attachments that share a body or a frame are coupled by one Gauss-Seidel sweep per step (cables in
 * the order they were added, then all frame <-> body constraints together), with last step's impulses
 * standing in for the ones not yet computed. SI units, float64 (the rigid solver's own state is
 * float32). See docs/STRUCTURE_COUPLING.md for the equations, measured stability limits and validation.
 */
export const STRUCTURE_COUPLING_BACKEND='rigid-structure-coupling-schur-proxy-js-f64-v1';

export type StructureVec3=readonly [number,number,number];
export interface StructureBodyState {
  readonly position:StructureVec3;
  readonly rotation:readonly [number,number,number,number];
  readonly linearVelocity:StructureVec3;
  readonly angularVelocity:StructureVec3;
  readonly mass:number;
  readonly type:string;
}
/** The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it. */
export interface StructureWorld<B> {
  gravity():readonly number[];
  getState(body:B):StructureBodyState;
  /** Force in newtons acting over the next step, at the centre of mass when no point is given. */
  applyForce(body:B,force:StructureVec3,point?:StructureVec3):void;
  applyTorque(body:B,torque:StructureVec3):void;
  /** Impulse in N s at the centre of mass, applied to the velocity at once. */
  applyImpulse(body:B,impulse:StructureVec3):void;
  applyAngularImpulse(body:B,impulse:StructureVec3):void;
  isAlive?(body:B):boolean;
  readonly loop?:{readonly step:number};
  /** Solver substeps per step; used to predict where the rigid solver puts a falling body. */
  readonly subSteps?:number;
}
/** Rotational inertia of a body about its centre of mass, in its own axes. The world reports mass but
 * not inertia, so say what the body is. `locked` is a body that cannot rotate (lockRotation). */
export type StructureInertia=
  |{readonly kind:'box';readonly halfExtents:StructureVec3}
  |{readonly kind:'sphere';readonly radius:number}
  /** Axis along the body's local Y; halfLength is half the distance between the cap centres. */
  |{readonly kind:'capsule';readonly radius:number;readonly halfLength:number}
  /** Principal moments in kg m^2 about the body's local x, y, z. */
  |{readonly kind:'principal';readonly moments:StructureVec3}
  |{readonly kind:'locked'};

export interface StructureCouplingOptions {
  /** Fixed step in seconds. Must equal the world's fixed step and every structure's dt; defaults to world.loop.step. */
  readonly dt?:number;
  /** Fraction of a frame <-> body position gap removed per step (Baumgarte), 0 < beta < 2. Default 0.2. */
  readonly baumgarte?:number;
  /** 'implicit' (default) uses both sides' effective mass. 'naive-staggered' ignores the body's and lets
   * the body's motion drive the structure; it exists to demonstrate the instability, do not use it. */
  readonly scheme?:'implicit'|'naive-staggered';
}
export interface BodyAttachOptions {
  readonly inertia:StructureInertia;
  /** Attachment point in the body's local frame (origin at the centre of mass). Default: where the
   * structure node is now. */
  readonly localPoint?:StructureVec3;
  /** The body's gravity scale, if it is not 1. */
  readonly gravityScale?:number;
}
export interface FrameBodyAttachOptions extends BodyAttachOptions {
  /** 'pinned' transmits forces only; 'clamped' forces and moments. Default 'pinned'. */
  readonly mode?:'pinned'|'clamped';
}
/** Live report of one attachment, updated in place by every step(). */
export interface StructureAttachment {
  readonly id:number;
  readonly kind:'cable-body'|'cable-frame'|'frame-body';
  readonly mode:'cable'|'pinned'|'clamped';
  /** Mean force over the last step that the structure (cable, or frame for frame-body) put on the
   * carrier (the body, or the frame node for cable-frame), in newtons, world axes. */
  readonly force:[number,number,number];
  /** Mean moment on the body over the last step (clamped only), N m. */
  readonly moment:[number,number,number];
  /** Cable attachments: tension of the cable at the node (magnitude of its segments' pull), N. `force`
   * differs from it by the weight and inertia of the node's own lumped mass, which rides on the carrier.
   * Frame attachments: magnitude of `force`. */
  tension:number;
  /** Distance between the body point and the structure node before the last step, metres. */
  gap:number;
  /** Effective mass along the cable that the cable saw at this attachment in the last step, kg. */
  effectiveMass:number;
  attached:boolean;
}
export interface StructureDiagnostics {
  /** Rigid bodies: translational + rotational kinetic energy and -m g.x, J. */
  bodyKinetic:number;bodyPotential:number;
  cableKinetic:number;cableElastic:number;cablePotential:number;
  frameKinetic:number;frameElastic:number;framePotential:number;
  total:number;
  /** Linear momentum of attached bodies + cables + frames, kg m/s. */
  momentum:[number,number,number];
  /** Mass of attached bodies + cables + frames, kg. */
  mass:number;
}

const CAP=1e9,MAX_UNKNOWNS=96;
const fail=(message:string):never=>{throw new EngineError('INVALID_PAYLOAD',message);};
function vec3(value:unknown,label:string):[number,number,number] {
  const v=value as ArrayLike<number>;
  if(!v||v.length!==3||!Number.isFinite(v[0])||!Number.isFinite(v[1])||!Number.isFinite(v[2]))fail(`${label} must be three finite numbers.`);
  return [v[0],v[1],v[2]];
}
/** Principal moments of inertia (body axes, kg m^2) of a body of the given mass, or null for a locked body. */
export function principalMoments(inertia:StructureInertia,mass:number):[number,number,number]|null {
  const positive=(x:number,label:string)=>Number.isFinite(x)&&x>0?x:fail(`${label} must be positive.`);
  if(!inertia||typeof inertia!=='object')return fail('An attachment needs the body inertia: {kind: box | sphere | capsule | principal | locked}.');
  switch(inertia.kind){
    case 'locked':return null;
    case 'box':{const [x,y,z]=vec3(inertia.halfExtents,'halfExtents').map(v=>positive(v,'halfExtents'));return [mass/3*(y*y+z*z),mass/3*(x*x+z*z),mass/3*(x*x+y*y)];}
    case 'sphere':{const r=positive(inertia.radius,'radius');return [.4*mass*r*r,.4*mass*r*r,.4*mass*r*r];}
    case 'capsule':{
      const r=positive(inertia.radius,'radius'),hl=positive(inertia.halfLength,'halfLength'),vc=2*hl*r*r,vs=4/3*r*r*r,mc=mass*vc/(vc+vs),ms=mass-mc;
      const axial=mc*r*r/2+ms*.4*r*r,cross=mc*(r*r/4+hl*hl/3)+ms*(.4*r*r+hl*hl+.75*hl*r);return [cross,axial,cross];
    }
    case 'principal':{const m=vec3(inertia.moments,'moments');m.forEach(v=>positive(v,'moments'));return m;}
    default:return fail('Unknown inertia kind.');
  }
}

class BodyCarrier<B> {
  readonly atts:Attachment<B>[]=[];
  readonly x=new Float64Array(3);readonly q=new Float64Array(4);readonly v=new Float64Array(3);readonly w=new Float64Array(3);
  readonly R=new Float64Array(9);readonly invI=new Float64Array(9);
  /** Inverse of the 6x6 mass matrix of the body plus the cable end masses riding on it, about the centre of mass, world axes. */
  readonly Minv=new Float64Array(36);
  /** Twist change (V then omega) of the last step's interface solve. */
  readonly tw=new Float64Array(6);
  /** Closing half of last step's frame <-> body impulse, applied at the start of the next step. */
  readonly pendingP=new Float64Array(3);readonly pendingL=new Float64Array(3);
  mass=0;invM=0;dynamic=false;hasPending=false;
  constructor(readonly body:B,readonly moments:[number,number,number]|null,public gravityScale:number){}
}
class FrameCarrier<B> {
  readonly atts:Attachment<B>[]=[];
  readonly views:ReturnType<FrameRuntime['couplingViews']>;
  /** Attached nodes; node slots[s] owns interface degrees of freedom 6s..6s+5. */
  slots:number[]=[];cols:Float64Array[]=[];
  /** W: block of A^-1 on the interface. P = (1 + W M_r)^-1 and Waug = P W fold in the cable end masses M_r riding on the nodes. */
  W=new Float64Array(0);P=new Float64Array(0);Waug=new Float64Array(0);
  lam=new Float64Array(0);d0=new Float64Array(0);pd0=new Float64Array(0);dv=new Float64Array(0);rider=new Float64Array(0);
  readonly extra:Float64Array;mid:Float64Array;
  constructor(readonly frame:FrameRuntime){this.views=frame.couplingViews();this.extra=new Float64Array(this.views.displacements.length);this.mid=this.extra;}
  slot(node:number):number {
    let s=this.slots.indexOf(node);if(s>=0)return s;
    s=this.slots.length;const size=this.views.displacements.length,fresh:Float64Array[]=[];
    for(let k=0;k<6;k++){const col=new Float64Array(size);if(!this.frame.solveCoupledOperator(6*node+k,col))throw new EngineError('NUMERICAL_FAILURE','The frame solver did not converge on its interface response; raise the frame maxIterations.');fresh.push(col);}
    this.slots.push(node);this.cols.push(...fresh);
    const n=6*this.slots.length,W=new Float64Array(n*n);
    for(let a=0;a<n;a++)for(let b=0;b<n;b++)W[a*n+b]=this.cols[b][6*this.slots[Math.floor(a/6)]+a%6];
    // A^-1 is symmetric; remove the CG round-off so the interface matrix is too.
    for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)W[a*n+b]=W[b*n+a]=.5*(W[a*n+b]+W[b*n+a]);
    this.W=W;this.lam=new Float64Array(n);this.d0=new Float64Array(n);this.pd0=new Float64Array(n);this.dv=new Float64Array(n);this.rider=new Float64Array(n);
    this.rebuild();return s;
  }
  /** Recompute P and Waug for the current cable end masses. Called when attachments change, never in step(). */
  rebuild():void {
    const n=this.lam.length,W=this.W,rider=this.rider,A=new Float64Array(n*n),P=new Float64Array(n*n);
    rider.fill(0);for(const a of this.atts)if(a.kind==='cable-frame')for(let k=0;k<3;k++)rider[6*a.slot+k]+=a.nodeMass;
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){A[i*n+j]=(i===j?1:0)+W[i*n+j]*rider[j];P[i*n+j]=i===j?1:0;}
    // Gauss-Jordan with partial pivoting; 1 + W M_r is a small, well-conditioned perturbation of the identity.
    for(let c=0;c<n;c++){
      let pivot=c;for(let r=c+1;r<n;r++)if(Math.abs(A[r*n+c])>Math.abs(A[pivot*n+c]))pivot=r;
      if(!(Math.abs(A[pivot*n+c])>1e-300))throw new EngineError('NUMERICAL_FAILURE','Singular frame interface matrix.');
      if(pivot!==c)for(let k=0;k<n;k++){let x=A[c*n+k];A[c*n+k]=A[pivot*n+k];A[pivot*n+k]=x;x=P[c*n+k];P[c*n+k]=P[pivot*n+k];P[pivot*n+k]=x;}
      const d=A[c*n+c];for(let k=0;k<n;k++){A[c*n+k]/=d;P[c*n+k]/=d;}
      for(let r=0;r<n;r++){if(r===c)continue;const f=A[r*n+c];if(f===0)continue;for(let k=0;k<n;k++){A[r*n+k]-=f*A[c*n+k];P[r*n+k]-=f*P[c*n+k];}}
    }
    const Waug=new Float64Array(n*n);
    for(let i=0;i<n;i++)for(let j=0;j<n;j++){let sum=0;for(let k=0;k<n;k++)sum+=P[i*n+k]*W[k*n+j];Waug[i*n+j]=sum;}
    for(let a=0;a<n;a++)for(let b=a+1;b<n;b++)Waug[a*n+b]=Waug[b*n+a]=.5*(Waug[a*n+b]+Waug[b*n+a]);
    this.P=P;this.Waug=Waug;
  }
}
class CableCarrier<B> {
  readonly atts:Attachment<B>[]=[];
  readonly views:ReturnType<CompliantCableRuntime['couplingViews']>;
  readonly edges:{a:number;b:number}[];
  constructor(readonly cable:CompliantCableRuntime){this.views=cable.couplingViews();this.edges=cable.checkpoint().definition.constraints.map(e=>({a:e.a,b:e.b}));}
}
class Attachment<B> implements StructureAttachment {
  readonly force:[number,number,number]=[0,0,0];readonly moment:[number,number,number]=[0,0,0];
  tension=0;gap=0;effectiveMass=0;attached=true;
  /** Impulse over the step on the carrier: the body (linear at the point, then angular), or the frame node for cable-frame. */
  readonly J=new Float64Array(6);
  /** Cable attachments: impulse of the cable's segments on the node over the step. */
  readonly Jc=new Float64Array(3);
  readonly local=new Float64Array(3);readonly r=new Float64Array(3);
  readonly v0=new Float64Array(3);readonly dvFree=new Float64Array(3);
  /** Clamped: body rotation and node rotation when attached. */
  readonly q0=new Float64Array(4);readonly theta0=new Float64Array(3);
  neighbours:number[]=[];nodeMass=0;slot=-1;rows=3;offset=0;
  constructor(readonly id:number,readonly kind:StructureAttachment['kind'],readonly mode:StructureAttachment['mode'],
    readonly cable:CableCarrier<B>|null,readonly cableNode:number,readonly frame:FrameCarrier<B>|null,readonly frameNode:number,readonly body:BodyCarrier<B>|null){}
}

export class StructureCoupling<B> {
  readonly backend=STRUCTURE_COUPLING_BACKEND;
  readonly dt:number;readonly baumgarte:number;readonly scheme:'implicit'|'naive-staggered';
  /** Completed coupling steps. */
  tick=0;
  private readonly world:StructureWorld<B>;
  private readonly bodies=new Map<B,BodyCarrier<B>>();
  private readonly bodyList:BodyCarrier<B>[]=[];
  private readonly cables:CableCarrier<B>[]=[];
  private readonly frames:FrameCarrier<B>[]=[];
  private readonly attachments:Attachment<B>[]=[];
  private readonly frameBody:Attachment<B>[]=[];
  private nextId=1;
  private readonly g=new Float64Array(3);
  // Scratch: nothing below is allocated in step().
  private readonly S=new Float64Array(MAX_UNKNOWNS*MAX_UNKNOWNS);private readonly rhs=new Float64Array(MAX_UNKNOWNS);
  private readonly rowsT=new Float64Array(MAX_UNKNOWNS*6);private readonly rowsM=new Float64Array(MAX_UNKNOWNS*6);
  private readonly t3=new Float64Array(3);private readonly t3b=new Float64Array(3);private readonly t6=new Float64Array(6);private readonly p3=new Float64Array(3);
  private readonly G3=new Float64Array(9);private readonly M6=new Float64Array(36);private readonly t6b=new Float64Array(6);
  private readonly out3:[number,number,number]=[0,0,0];

  constructor(world:StructureWorld<B>,options:StructureCouplingOptions={}) {
    if(!world||typeof world.getState!=='function'||typeof world.applyForce!=='function'||typeof world.applyTorque!=='function'||typeof world.applyImpulse!=='function'||typeof world.applyAngularImpulse!=='function'||typeof world.gravity!=='function')
      throw new TypeError('StructureCoupling needs a world with gravity(), getState(), applyForce(), applyTorque(), applyImpulse() and applyAngularImpulse().');
    const worldStep=world.loop?.step,dt=options.dt??worldStep;
    if(!(typeof dt==='number'&&Number.isFinite(dt)&&dt>=1e-6&&dt<=1/30))fail('dt must be a fixed step between 1e-6 and 1/30 s.');
    if(worldStep!==undefined&&Math.abs(worldStep-dt!)>1e-12)fail('dt must equal the world fixed step.');
    const beta=options.baumgarte??.2;if(!(beta>0&&beta<2))fail('baumgarte must be between 0 and 2.');
    if(options.scheme!==undefined&&options.scheme!=='implicit'&&options.scheme!=='naive-staggered')fail('Unknown coupling scheme.');
    this.world=world;this.dt=dt!;this.baumgarte=beta;this.scheme=options.scheme??'implicit';
  }

  /** Hand a cable to the coupling, which steps it from now on (do not call cable.step() yourself). */
  addCable(cable:CompliantCableRuntime):this {
    if(this.cables.some(c=>c.cable===cable))return this;
    if(Math.abs(cable.config.dt-this.dt)>1e-12)fail('The cable dt must equal the coupling dt.');
    if(cable.config.drag>0&&cable.config.substeps!==1)fail('A coupled cable with drag needs substeps = 1.');
    this.cables.push(new CableCarrier<B>(cable));return this;
  }
  /** Hand a frame to the coupling, which steps it from now on. The frame needs substeps = 1. */
  addFrame(frame:FrameRuntime):this {
    if(this.frames.some(f=>f.frame===frame))return this;
    if(Math.abs(frame.config.dt-this.dt)>1e-12)fail('The frame dt must equal the coupling dt.');
    if(frame.config.substeps!==1)fail('A coupled frame needs substeps = 1.');
    this.frames.push(new FrameCarrier<B>(frame));return this;
  }
  private cableCarrier(cable:CompliantCableRuntime):CableCarrier<B> {this.addCable(cable);return this.cables.find(c=>c.cable===cable)!;}
  private frameCarrier(frame:FrameRuntime):FrameCarrier<B> {this.addFrame(frame);return this.frames.find(f=>f.frame===frame)!;}
  private bodyCarrier(body:B,options:BodyAttachOptions):BodyCarrier<B> {
    const state=this.world.getState(body),scale=options.gravityScale??1;
    if(!Number.isFinite(scale))fail('gravityScale must be finite.');
    let carrier=this.bodies.get(body);
    if(!carrier){
      const moments=state.type==='dynamic'?principalMoments(options.inertia,state.mass):null;
      carrier=new BodyCarrier<B>(body,moments,scale);this.bodies.set(body,carrier);this.bodyList.push(carrier);
    }
    this.readBody(carrier);return carrier;
  }
  private cableNode(carrier:CableCarrier<B>,node:number):number[] {
    const count=carrier.views.masses.length;
    if(!Number.isInteger(node)||node<0||node>=count)fail('Cable node out of range.');
    if(this.attachments.some(a=>a.cable===carrier&&a.cableNode===node))fail('That cable node is already attached.');
    if(carrier.views.pinned[node])fail('A fixed anchor cannot be attached: attach a free cable node.');
    const neighbours=carrier.edges.filter(e=>e.a===node||e.b===node).map(e=>e.a===node?e.b:e.a);
    if(neighbours.length===0)fail('That cable node has no segment.');
    return neighbours;
  }
  private register(att:Attachment<B>):StructureAttachment {
    this.attachments.push(att);att.cable?.atts.push(att);att.frame?.atts.push(att);att.body?.atts.push(att);
    if(att.kind==='cable-frame')att.frame!.rebuild();
    if(att.kind==='frame-body'){
      this.frameBody.push(att);let n=0;for(const a of this.frameBody)n+=a.rows;
      if(n>MAX_UNKNOWNS){this.detach(att);fail(`At most ${MAX_UNKNOWNS} frame <-> body constraint equations are supported.`);}
    }
    return att;
  }
  private localPoint(att:Attachment<B>,body:BodyCarrier<B>,options:BodyAttachOptions,nodeX:number,nodeY:number,nodeZ:number):void {
    if(options.localPoint!==undefined){const p=vec3(options.localPoint,'localPoint');att.local.set(p);return;}
    // World offset from the centre of mass, turned into body axes: local = R^T (node - x).
    const dx=nodeX-body.x[0],dy=nodeY-body.x[1],dz=nodeZ-body.x[2],R=body.R;
    att.local[0]=R[0]*dx+R[3]*dy+R[6]*dz;att.local[1]=R[1]*dx+R[4]*dy+R[7]*dz;att.local[2]=R[2]*dx+R[5]*dy+R[8]*dz;
  }

  /** Attach a free cable node to a point fixed on a body. The node follows the point; the cable's pull
   * acts on the body there, so off-centre it also turns the body. Static and kinematic bodies are
   * moving anchors: they feel nothing. */
  attachCableToBody(cable:CompliantCableRuntime,node:number,body:B,options:BodyAttachOptions):StructureAttachment {
    const cc=this.cableCarrier(cable),neighbours=this.cableNode(cc,node),bc=this.bodyCarrier(body,options);
    const att=new Attachment<B>(this.nextId++,'cable-body','cable',cc,node,null,-1,bc);
    att.neighbours=neighbours;att.nodeMass=cc.views.masses[node];
    const p=cc.views.positions;this.localPoint(att,bc,options,p[3*node],p[3*node+1],p[3*node+2]);
    cable.driveNode(node,p[3*node],p[3*node+1],p[3*node+2],cc.views.velocities[3*node],cc.views.velocities[3*node+1],cc.views.velocities[3*node+2],att.nodeMass,0,0,0);
    return this.register(att);
  }
  /** Attach a free cable node to a frame node: the cable pulls on the frame, the frame carries the cable end. */
  attachCableToFrame(cable:CompliantCableRuntime,node:number,frame:FrameRuntime,frameNode:number):StructureAttachment {
    const cc=this.cableCarrier(cable),neighbours=this.cableNode(cc,node),fc=this.frameCarrier(frame);
    if(!Number.isInteger(frameNode)||frameNode<0||6*frameNode>=fc.views.displacements.length)fail('Frame node out of range.');
    const att=new Attachment<B>(this.nextId++,'cable-frame','cable',cc,node,fc,frameNode,null);
    att.neighbours=neighbours;att.nodeMass=cc.views.masses[node];
    const p=cc.views.positions,v=cc.views.velocities;
    cable.driveNode(node,p[3*node],p[3*node+1],p[3*node+2],v[3*node],v[3*node+1],v[3*node+2],att.nodeMass,0,0,0);
    att.slot=fc.slot(frameNode);return this.register(att);
  }
  /** Attach a frame node to a point fixed on a body: 'pinned' (forces only, the body may turn about the
   * node) or 'clamped' (forces and moments, the body turns with the node). A kinematic body prescribes
   * the node's motion. */
  attachFrameToBody(frame:FrameRuntime,frameNode:number,body:B,options:FrameBodyAttachOptions):StructureAttachment {
    const mode=options.mode??'pinned';if(mode!=='pinned'&&mode!=='clamped')fail('mode must be pinned or clamped.');
    const fc=this.frameCarrier(frame);
    if(!Number.isInteger(frameNode)||frameNode<0||6*frameNode>=fc.views.displacements.length)fail('Frame node out of range.');
    const bc=this.bodyCarrier(body,options),att=new Attachment<B>(this.nextId++,'frame-body',mode,null,-1,fc,frameNode,bc);
    att.rows=mode==='clamped'?6:3;
    const {rest,displacements:u}=fc.views;
    this.localPoint(att,bc,options,rest[3*frameNode]+u[6*frameNode],rest[3*frameNode+1]+u[6*frameNode+1],rest[3*frameNode+2]+u[6*frameNode+2]);
    att.q0.set(bc.q);for(let k=0;k<3;k++)att.theta0[k]=u[6*frameNode+3+k];
    att.slot=fc.slot(frameNode);return this.register(att);
  }
  /** Remove an attachment. A cable node gets its own mass back and is free again. */
  detach(attachment:StructureAttachment):void {
    const att=attachment as Attachment<B>,index=this.attachments.indexOf(att);if(index<0)return;
    this.attachments.splice(index,1);att.attached=false;
    const drop=(list:Attachment<B>[]|undefined)=>{if(!list)return;const i=list.indexOf(att);if(i>=0)list.splice(i,1);};
    drop(att.cable?.atts);drop(att.frame?.atts);drop(att.body?.atts);drop(this.frameBody);
    if(att.kind==='cable-frame')att.frame!.rebuild();
    if(att.cable){const n=att.cableNode,p=att.cable.views.positions,v=att.cable.views.velocities;att.cable.cable.driveNode(n,p[3*n],p[3*n+1],p[3*n+2],v[3*n],v[3*n+1],v[3*n+2],att.nodeMass,0,0,0);}
    const body=att.body;
    if(body&&body.atts.length===0){
      if(body.hasPending&&this.alive(body))this.kick(body);
      this.bodies.delete(body.body);this.bodyList.splice(this.bodyList.indexOf(body),1);
    }
  }
  /** Live reports of all current attachments. */
  get reports():readonly StructureAttachment[] {return this.attachments;}

  private alive(body:BodyCarrier<B>):boolean {return this.world.isAlive===undefined||this.world.isAlive(body.body);}
  private kick(body:BodyCarrier<B>):void {
    const o=this.out3;
    o[0]=body.pendingP[0];o[1]=body.pendingP[1];o[2]=body.pendingP[2];if(o[0]!==0||o[1]!==0||o[2]!==0)this.world.applyImpulse(body.body,o);
    o[0]=body.pendingL[0];o[1]=body.pendingL[1];o[2]=body.pendingL[2];if(o[0]!==0||o[1]!==0||o[2]!==0)this.world.applyAngularImpulse(body.body,o);
    body.pendingP.fill(0);body.pendingL.fill(0);body.hasPending=false;
  }
  private readBody(body:BodyCarrier<B>):void {
    const s=this.world.getState(body.body),R=body.R,I=body.invI;
    for(let k=0;k<3;k++){body.x[k]=s.position[k];body.v[k]=s.linearVelocity[k];body.w[k]=s.angularVelocity[k];}
    const x=s.rotation[0],y=s.rotation[1],z=s.rotation[2],w=s.rotation[3];body.q[0]=x;body.q[1]=y;body.q[2]=z;body.q[3]=w;
    R[0]=1-2*(y*y+z*z);R[1]=2*(x*y-z*w);R[2]=2*(x*z+y*w);R[3]=2*(x*y+z*w);R[4]=1-2*(x*x+z*z);R[5]=2*(y*z-x*w);R[6]=2*(x*z-y*w);R[7]=2*(y*z+x*w);R[8]=1-2*(x*x+y*y);
    body.mass=s.mass;body.dynamic=s.type==='dynamic'&&s.mass>0;body.invM=body.dynamic?1/s.mass:0;
    const m=body.moments,a=body.dynamic&&m?1/m[0]:0,b=body.dynamic&&m?1/m[1]:0,c=body.dynamic&&m?1/m[2]:0;
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)I[3*i+j]=R[3*i]*a*R[3*j]+R[3*i+1]*b*R[3*j+1]+R[3*i+2]*c*R[3*j+2];
    for(const att of body.atts){const l=att.local;for(let i=0;i<3;i++)att.r[i]=R[3*i]*l[0]+R[3*i+1]*l[1]+R[3*i+2]*l[2];}
  }
  /** Inverse 6x6 mass matrix of a body with the cable end masses that ride on it. */
  private augment(body:BodyCarrier<B>):void {
    const Minv=body.Minv,A=this.M6,R=body.R,m=body.moments;Minv.fill(0);
    if(!body.dynamic)return;
    let total=body.mass;for(const a of body.atts)if(a.kind==='cable-body')total+=a.nodeMass;
    if(!m){for(let k=0;k<3;k++)Minv[7*k]=1/total;return;}
    A.fill(0);
    for(let i=0;i<3;i++){A[7*i]=total;for(let j=0;j<3;j++)A[6*(3+i)+3+j]=R[3*i]*m[0]*R[3*j]+R[3*i+1]*m[1]*R[3*j+1]+R[3*i+2]*m[2]*R[3*j+2];}
    for(const a of body.atts){
      if(a.kind!=='cable-body')continue;
      const mm=a.nodeMass,r=a.r,rr=r[0]*r[0]+r[1]*r[1]+r[2]*r[2];
      // Point mass at r: off-diagonal blocks -m [r]x and m [r]x, rotational block m (|r|^2 - r r^T).
      A[4]+=mm*r[2];A[5]-=mm*r[1];A[9]-=mm*r[2];A[11]+=mm*r[0];A[15]+=mm*r[1];A[16]-=mm*r[0];
      A[19]-=mm*r[2];A[20]+=mm*r[1];A[24]+=mm*r[2];A[26]-=mm*r[0];A[30]-=mm*r[1];A[31]+=mm*r[0];
      for(let i=0;i<3;i++)for(let j=0;j<3;j++)A[6*(3+i)+3+j]+=mm*((i===j?rr:0)-r[i]*r[j]);
    }
    // Cholesky A = L L^T in place, then A^-1 column by column.
    for(let j=0;j<6;j++){
      let d=A[7*j];for(let k=0;k<j;k++)d-=A[6*j+k]*A[6*j+k];
      if(!(d>0))throw new EngineError('NUMERICAL_FAILURE','A coupled body has a singular mass matrix.');
      const root=Math.sqrt(d);A[7*j]=root;
      for(let i=j+1;i<6;i++){let sum=A[6*i+j];for(let k=0;k<j;k++)sum-=A[6*i+k]*A[6*j+k];A[6*i+j]=sum/root;}
    }
    const y=this.t6;
    for(let c=0;c<6;c++){
      for(let i=0;i<6;i++){let sum=i===c?1:0;for(let k=0;k<i;k++)sum-=A[6*i+k]*y[k];y[i]=sum/A[7*i];}
      for(let i=5;i>=0;i--){let sum=y[i];for(let k=i+1;k<6;k++)sum-=A[6*k+i]*y[k];y[i]=sum/A[7*i];}
      for(let i=0;i<6;i++)Minv[6*i+c]=y[i];
    }
  }
  /** Twist change (V, omega) of a body and its riders over this step from gravity and the newest estimate
   * of every interface impulse on it, except the cable pull of `exclude` and, with skipFrameBody, all
   * frame <-> body impulses. */
  private bodyTwist(body:BodyCarrier<B>,exclude:Attachment<B>|null,skipFrameBody:boolean,out:Float64Array):void {
    const h=this.dt,gs=body.dynamic?h*body.mass*body.gravityScale:0;
    let px=gs*this.g[0],py=gs*this.g[1],pz=gs*this.g[2],lx=0,ly=0,lz=0;
    for(const a of body.atts){
      let jx=0,jy=0,jz=0;
      if(a.kind==='cable-body'){
        // The end mass's weight always acts; the cable's pull unless excluded.
        const gc=a.cable!.cable.config.gravity,hm=h*a.nodeMass;jx=hm*gc[0];jy=hm*gc[1];jz=hm*gc[2];
        if(a!==exclude){jx+=a.Jc[0];jy+=a.Jc[1];jz+=a.Jc[2];}
      }else{
        if(skipFrameBody||a===exclude)continue;
        jx=a.J[0];jy=a.J[1];jz=a.J[2];if(a.rows===6){lx+=a.J[3];ly+=a.J[4];lz+=a.J[5];}
      }
      const s=a.r;px+=jx;py+=jy;pz+=jz;lx+=s[1]*jz-s[2]*jy;ly+=s[2]*jx-s[0]*jz;lz+=s[0]*jy-s[1]*jx;
    }
    const M=body.Minv;
    for(let i=0;i<6;i++)out[i]=M[6*i]*px+M[6*i+1]*py+M[6*i+2]*pz+M[6*i+3]*lx+M[6*i+4]*ly+M[6*i+5]*lz;
  }
  /** Interface impulses on a frame (cable pulls, end-mass weights, minus the frame <-> body impulses), then the
   * velocity change of every interface degree of freedom, riders included: dv = P d0 + Waug lam. */
  private frameResponse(frame:FrameCarrier<B>,exclude:Attachment<B>|null,skipFrameBody:boolean):void {
    const lam=frame.lam,n=lam.length,h=this.dt,Waug=frame.Waug,dv=frame.dv,pd0=frame.pd0;
    lam.fill(0);
    for(const a of frame.atts){
      const base=6*a.slot;
      if(a.kind==='cable-frame'){
        const gc=a.cable!.cable.config.gravity,hm=h*a.nodeMass;
        for(let k=0;k<3;k++)lam[base+k]+=hm*gc[k]+(a===exclude?0:a.Jc[k]);
      }else if(!skipFrameBody&&a!==exclude)for(let k=0;k<a.rows;k++)lam[base+k]-=a.J[k];
    }
    for(let i=0;i<n;i++){let sum=pd0[i];const row=i*n;for(let b=0;b<n;b++)sum+=Waug[row+b]*lam[b];dv[i]=sum;}
  }
  /** Velocity change (3 linear, 3 angular) of an attachment's carrier point, see bodyTwist / frameResponse. */
  private freeDv(att:Attachment<B>,carrier:'body'|'frame',exclude:Attachment<B>|null,skipFrameBody:boolean,out:Float64Array):void {
    if(carrier==='body'){
      const r=att.r;this.bodyTwist(att.body!,exclude,skipFrameBody,out);
      const wx=out[3],wy=out[4],wz=out[5];out[0]+=wy*r[2]-wz*r[1];out[1]+=wz*r[0]-wx*r[2];out[2]+=wx*r[1]-wy*r[0];return;
    }
    const frame=att.frame!;this.frameResponse(frame,exclude,skipFrameBody);
    for(let k=0;k<6;k++)out[k]=frame.dv[6*att.slot+k];
  }

  /** Advance every cable and frame by one fixed step and give the bodies this step's interface forces.
   * Call it once per fixed step, immediately BEFORE world.step(). */
  step():void {
    const h=this.dt,world=this.world,naive=this.scheme==='naive-staggered',o=this.out3,t=this.t6b;
    const gravity=world.gravity();for(let k=0;k<3;k++)this.g[k]=Number(gravity[k]);
    // 0. Bodies that were destroyed take their attachments with them.
    for(let i=this.bodyList.length-1;i>=0;i--){const body=this.bodyList[i];if(!this.alive(body)){body.hasPending=false;while(body.atts.length>0)this.detach(body.atts[body.atts.length-1]);}}
    // 1. Close last step's frame <-> body impulse (second half kick), then read the bodies at time t.
    for(const body of this.bodyList){if(body.hasPending)this.kick(body);this.readBody(body);this.augment(body);}
    // 2. Frames: midpoint velocity under their own loads only, and what it does to the interface (d0 = v_end - v, P d0 with riders).
    for(const frame of this.frames){
      const mid=frame.mid=frame.frame.beginCoupledTick(),v=frame.views.velocities,n=frame.lam.length,d0=frame.d0,P=frame.P;
      for(let a=0;a<n;a++){const dof=6*frame.slots[(a-a%6)/6]+a%6;d0[a]=2*(mid[dof]-v[dof]);}
      for(let i=0;i<n;i++){let sum=0;const row=i*n;for(let b=0;b<n;b++)sum+=P[row+b]*d0[b];frame.pd0[i]=sum;}
    }

    // 3. Cables, in the order they were added. Each attached node becomes a proxy of its carrier point.
    for(const cc of this.cables){
      const p=cc.views.positions,vel=cc.views.velocities,config=cc.cable.config,gc=config.gravity;
      for(const att of cc.atts){
        const node=att.cableNode,v0=att.v0,pos=this.p3,Gm=this.G3,free=att.dvFree;let w=0;
        // Free motion of the point (carrier + riders, without this cable's pull) and its response G to an impulse there.
        if(att.body){
          const body=att.body,r=att.r,M=body.Minv;
          for(let k=0;k<3;k++)pos[k]=body.x[k]+r[k];
          v0[0]=body.v[0]+body.w[1]*r[2]-body.w[2]*r[1];v0[1]=body.v[1]+body.w[2]*r[0]-body.w[0]*r[2];v0[2]=body.v[2]+body.w[0]*r[1]-body.w[1]*r[0];
          this.freeDv(att,'body',att,false,t);
          for(let j=0;j<3;j++){
            // Column j: impulse e_j at r is the wrench (e_j, r x e_j); the point then moves by V + omega x r.
            const cx=j===1?-r[2]:j===2?r[1]:0,cy=j===0?r[2]:j===2?-r[0]:0,cz=j===0?-r[1]:j===1?r[0]:0;
            const vx=M[j]+M[3]*cx+M[4]*cy+M[5]*cz,vy=M[6+j]+M[9]*cx+M[10]*cy+M[11]*cz,vz=M[12+j]+M[15]*cx+M[16]*cy+M[17]*cz;
            const wx=M[18+j]+M[21]*cx+M[22]*cy+M[23]*cz,wy=M[24+j]+M[27]*cx+M[28]*cy+M[29]*cz,wz=M[30+j]+M[33]*cx+M[34]*cy+M[35]*cz;
            Gm[j]=vx+wy*r[2]-wz*r[1];Gm[3+j]=vy+wz*r[0]-wx*r[2];Gm[6+j]=vz+wx*r[1]-wy*r[0];
          }
        }else{
          const frame=att.frame!,n=att.frameNode,{rest,displacements:u,velocities:fv}=frame.views,size=frame.lam.length,W=frame.Waug,base=6*att.slot;
          for(let k=0;k<3;k++){pos[k]=rest[3*n+k]+u[6*n+k];v0[k]=fv[6*n+k];}
          this.freeDv(att,'frame',att,false,t);
          for(let i=0;i<3;i++)for(let j=0;j<3;j++)Gm[3*i+j]=W[(base+i)*size+base+j];
        }
        for(let k=0;k<3;k++)free[k]=t[k];
        att.gap=Math.hypot(p[3*node]-pos[0],p[3*node+1]-pos[1],p[3*node+2]-pos[2]);
        // Inverse effective mass along each segment that meets the node; the largest keeps the solve on the soft side.
        if(!naive)for(const other of att.neighbours){
          let dx=p[3*other]-pos[0],dy=p[3*other+1]-pos[1],dz=p[3*other+2]-pos[2];const length=Math.hypot(dx,dy,dz);
          if(length===0)continue;dx/=length;dy/=length;dz/=length;
          const along=dx*(Gm[0]*dx+Gm[1]*dy+Gm[2]*dz)+dy*(Gm[3]*dx+Gm[4]*dy+Gm[5]*dz)+dz*(Gm[6]*dx+Gm[7]*dy+Gm[8]*dz);
          if(along>w)w=along;
        }
        const mass=w*CAP>1?1/w:CAP;att.effectiveMass=mass;
        // The proxy moves as the point would without this cable and resists the cable with the point's effective mass.
        cc.cable.driveNode(node,pos[0],pos[1],pos[2],v0[0],v0[1],v0[2],mass,mass*(free[0]/h-gc[0]),mass*(free[1]/h-gc[1]),mass*(free[2]/h-gc[2]));
      }
      cc.cable.advance();
      const damping=1/(1+config.drag*h);
      for(const att of cc.atts){
        // Impulse of the cable's segments on the proxy: what moved it off its free motion (drag, if any, is the cable's own).
        const node=att.cableNode,m=att.effectiveMass,Jc=att.Jc;
        for(let k=0;k<3;k++)Jc[k]=m*(vel[3*node+k]/damping-att.v0[k]-att.dvFree[k]);
        att.tension=Math.hypot(Jc[0],Jc[1],Jc[2])/h;
      }
    }

    // 4. Frame <-> body constraints, all together: S J = -(relative end velocity without J + bias).
    let n=0;for(const att of this.frameBody){att.offset=n;n+=att.rows;}
    if(n>0){
      const S=this.S,rhs=this.rhs,T=this.rowsT,M=this.rowsM,beta=this.baumgarte,sub=world.subSteps;
      for(let i=0;i<n*n;i++)S[i]=0;
      for(const att of this.frameBody){
        const body=att.body!,frame=att.frame!,r=att.r,Mi=body.Minv,node=att.frameNode,{rest,displacements:u,velocities:fv}=frame.views;
        // Rows of the body Jacobian T (constraint velocity = T [V, omega]) and of T M^-1.
        for(let i=0;i<att.rows;i++){
          const row=6*(att.offset+i);for(let k=0;k<6;k++)T[row+k]=0;
          if(i<3){T[row+i]=1;const a=(i+1)%3,b=(i+2)%3;T[row+3+a]=r[b];T[row+3+b]=-r[a];}else T[row+i]=1;
          for(let k=0;k<6;k++){let sum=0;for(let j=0;j<6;j++)sum+=Mi[6*k+j]*T[row+j];M[row+k]=sum;}
        }
        this.freeDv(att,'body',null,true,t);
        const bx=t[0],by=t[1],bz=t[2],ax=t[3],ay=t[4],az=t[5];
        this.freeDv(att,'frame',null,true,t);
        const vp0=body.v[0]+body.w[1]*r[2]-body.w[2]*r[1],vp1=body.v[1]+body.w[2]*r[0]-body.w[0]*r[2],vp2=body.v[2]+body.w[0]*r[1]-body.w[1]*r[0];
        const g0=body.x[0]+r[0]-rest[3*node]-u[6*node],g1=body.x[1]+r[1]-rest[3*node+1]-u[6*node+1],g2=body.x[2]+r[2]-rest[3*node+2]-u[6*node+2];
        att.gap=Math.hypot(g0,g1,g2);
        // The rigid solver moves a body h dv/(2 n) further than a midpoint rule would (n substeps of symplectic Euler).
        const lead=body.dynamic&&sub!==undefined&&sub>0?1/(2*sub):0;
        rhs[att.offset]=-(vp0+bx-fv[6*node]-t[0]+beta*g0/h+lead*bx);
        rhs[att.offset+1]=-(vp1+by-fv[6*node+1]-t[1]+beta*g1/h+lead*by);
        rhs[att.offset+2]=-(vp2+bz-fv[6*node+2]-t[2]+beta*g2/h+lead*bz);
        if(att.rows===6){
          // Rotation of the body since it was attached, as a world rotation vector: q * conj(q0).
          const q=body.q,q0=att.q0,w=q[3]*q0[3]+q[0]*q0[0]+q[1]*q0[1]+q[2]*q0[2];
          let x=-q[3]*q0[0]+q[0]*q0[3]-q[1]*q0[2]+q[2]*q0[1],y=-q[3]*q0[1]+q[1]*q0[3]-q[2]*q0[0]+q[0]*q0[2],z=-q[3]*q0[2]+q[2]*q0[3]-q[0]*q0[1]+q[1]*q0[0];
          const sine=Math.hypot(x,y,z),angle=2*Math.atan2(sine,Math.abs(w)),scale=sine>1e-12?angle/sine*(w<0?-1:1):2;
          x*=scale;y*=scale;z*=scale;
          rhs[att.offset+3]=-(body.w[0]+ax-fv[6*node+3]-t[3]+beta*(x-(u[6*node+3]-att.theta0[0]))/h);
          rhs[att.offset+4]=-(body.w[1]+ay-fv[6*node+4]-t[4]+beta*(y-(u[6*node+4]-att.theta0[1]))/h);
          rhs[att.offset+5]=-(body.w[2]+az-fv[6*node+5]-t[5]+beta*(z-(u[6*node+5]-att.theta0[2]))/h);
        }
      }
      for(const a of this.frameBody)for(const b of this.frameBody){
        const sameBody=a.body===b.body&&!naive,sameFrame=a.frame===b.frame;if(!sameBody&&!sameFrame)continue;
        const W=a.frame!.Waug,size=a.frame!.lam.length;
        for(let i=0;i<a.rows;i++)for(let j=0;j<b.rows;j++){
          let value=0;
          if(sameBody){const ra=6*(a.offset+i),rb=6*(b.offset+j);for(let k=0;k<6;k++)value+=T[ra+k]*M[rb+k];}
          if(sameFrame)value+=W[(6*a.slot+i)*size+6*b.slot+j];
          S[(a.offset+i)*n+b.offset+j]=value;
        }
      }
      this.solveSymmetric(n);
      for(const att of this.frameBody){
        for(let i=0;i<att.rows;i++)att.J[i]=rhs[att.offset+i];
        for(let k=0;k<3;k++){att.force[k]=att.J[k]/h;att.moment[k]=att.rows===6?att.J[3+k]/h:0;}
        att.tension=Math.hypot(att.force[0],att.force[1],att.force[2]);
      }
    }

    // 5. Bodies. With every impulse known, the body and its riders change twist by tw; each cable end then
    // hands its body the cable's pull plus the end mass's weight and inertia. Cable forces act through
    // world.step(); frame impulses as two half kicks around it.
    for(const body of this.bodyList){
      const tw=body.tw;this.bodyTwist(body,null,false,tw);
      let px=0,py=0,pz=0,lx=0,ly=0,lz=0,kx=0,ky=0,kz=0,ax=0,ay=0,az=0,cables=false,kicks=false;
      for(const att of body.atts){
        const J=att.J,r=att.r;
        if(att.kind==='cable-body'){
          const gc=att.cable!.cable.config.gravity,own=att.nodeMass,Jc=att.Jc;
          J[0]=Jc[0]+own*(h*gc[0]-(tw[0]+tw[4]*r[2]-tw[5]*r[1]));J[1]=Jc[1]+own*(h*gc[1]-(tw[1]+tw[5]*r[0]-tw[3]*r[2]));J[2]=Jc[2]+own*(h*gc[2]-(tw[2]+tw[3]*r[1]-tw[4]*r[0]));
          for(let k=0;k<3;k++)att.force[k]=J[k]/h;
        }
        const tx=r[1]*J[2]-r[2]*J[1],ty=r[2]*J[0]-r[0]*J[2],tz=r[0]*J[1]-r[1]*J[0];
        if(att.kind==='frame-body'){kicks=true;kx+=J[0];ky+=J[1];kz+=J[2];ax+=tx;ay+=ty;az+=tz;if(att.rows===6){ax+=J[3];ay+=J[4];az+=J[5];}}
        else{cables=true;px+=J[0];py+=J[1];pz+=J[2];lx+=tx;ly+=ty;lz+=tz;}
      }
      if(!body.dynamic)continue;
      if(cables){
        o[0]=px/h;o[1]=py/h;o[2]=pz/h;world.applyForce(body.body,o);
        o[0]=lx/h;o[1]=ly/h;o[2]=lz/h;if(o[0]!==0||o[1]!==0||o[2]!==0)world.applyTorque(body.body,o);
      }
      if(kicks){
        body.pendingP[0]=kx/2;body.pendingP[1]=ky/2;body.pendingP[2]=kz/2;body.pendingL[0]=ax/2;body.pendingL[1]=ay/2;body.pendingL[2]=az/2;
        this.kick(body);
        body.pendingP[0]=kx/2;body.pendingP[1]=ky/2;body.pendingP[2]=kz/2;body.pendingL[0]=ax/2;body.pendingL[1]=ay/2;body.pendingL[2]=az/2;body.hasPending=true;
      }
    }

    // 6. Frames: the interface moves by dv; each node then feels lam minus the inertia of the end masses riding on it.
    // Add that load's response to the midpoint velocity and finish the tick with it.
    for(const frame of this.frames){
      this.frameResponse(frame,null,false);
      const lam=frame.lam,dv=frame.dv,rider=frame.rider,mid=frame.mid,extra=frame.extra,size=lam.length;
      for(const att of frame.atts){
        if(att.kind!=='cable-frame')continue;
        const gc=att.cable!.cable.config.gravity,own=att.nodeMass;
        for(let k=0;k<3;k++){att.J[k]=att.Jc[k]+own*(h*gc[k]-dv[6*att.slot+k]);att.force[k]=att.J[k]/h;}
      }
      for(let a=0;a<size;a++){
        const value=lam[a]-rider[a]*dv[a],dof=6*frame.slots[(a-a%6)/6]+a%6;extra[dof]=value/h;
        if(value===0)continue;
        const col=frame.cols[a],half=value/2;for(let j=0;j<mid.length;j++)mid[j]+=half*col[j];
      }
      frame.frame.finishCoupledTick(extra);
    }
    this.tick++;
  }

  /** In-place Cholesky solve of S x = rhs for the first n unknowns. A direction with no response on
   * either side (a kinematic body on a fixed node) gets zero impulse. */
  private solveSymmetric(n:number):void {
    const S=this.S,x=this.rhs;let scale=0;
    for(let i=0;i<n;i++)scale=Math.max(scale,S[i*n+i]);
    const floor=scale*1e-13;
    for(let j=0;j<n;j++){
      let d=S[j*n+j];for(let k=0;k<j;k++)d-=S[j*n+k]*S[j*n+k];
      if(!(d>floor)){S[j*n+j]=0;for(let i=j+1;i<n;i++)S[i*n+j]=0;continue;}
      const root=Math.sqrt(d);S[j*n+j]=root;
      for(let i=j+1;i<n;i++){let s=S[i*n+j];for(let k=0;k<j;k++)s-=S[i*n+k]*S[j*n+k];S[i*n+j]=s/root;}
    }
    for(let i=0;i<n;i++){let s=x[i];for(let k=0;k<i;k++)s-=S[i*n+k]*x[k];x[i]=S[i*n+i]>0?s/S[i*n+i]:0;}
    for(let i=n-1;i>=0;i--){let s=x[i];for(let k=i+1;k<n;k++)s-=S[k*n+i]*x[k];x[i]=S[i*n+i]>0?s/S[i*n+i]:0;}
    for(let i=0;i<n;i++)if(!Number.isFinite(x[i]))throw new EngineError('NUMERICAL_FAILURE','The frame <-> body interface solve produced a nonfinite impulse.');
  }

  /** Energy and momentum of the attached bodies and every cable and frame, at the time the world and
   * the structures have reached (call it after world.step()). Body velocities include the closing
   * half impulse that step() applies at the start of the next step. A cable node that is attached
   * counts with its own mass, not the effective mass it borrows. Allocates; not for the hot path. */
  diagnostics():StructureDiagnostics {
    const g=this.world.gravity(),d:StructureDiagnostics={bodyKinetic:0,bodyPotential:0,cableKinetic:0,cableElastic:0,cablePotential:0,frameKinetic:0,frameElastic:0,framePotential:0,total:0,momentum:[0,0,0],mass:0};
    for(const body of this.bodyList){
      if(!this.alive(body))continue;this.readBody(body);if(!body.dynamic)continue;
      const I=body.invI,P=body.pendingP,L=body.pendingL,R=body.R,m=body.moments;
      const w=[0,1,2].map(i=>body.w[i]+(body.hasPending?I[3*i]*L[0]+I[3*i+1]*L[1]+I[3*i+2]*L[2]:0));
      for(let k=0;k<3;k++){
        const v=body.v[k]+(body.hasPending?body.invM*P[k]:0);
        d.bodyKinetic+=.5*body.mass*v*v;d.bodyPotential-=body.mass*body.gravityScale*Number(g[k])*body.x[k];d.momentum[k]+=body.mass*v;
        if(m){const local=R[k]*w[0]+R[3+k]*w[1]+R[6+k]*w[2];d.bodyKinetic+=.5*m[k]*local*local;}
      }
      d.mass+=body.mass;
    }
    for(const cc of this.cables){
      const s=cc.cable.inspect(),gc=cc.cable.config.gravity;
      d.cableKinetic+=s.diagnostics.kineticEnergy;d.cableElastic+=s.diagnostics.elasticEnergy;d.cablePotential+=s.diagnostics.gravitationalEnergy;d.mass+=s.diagnostics.mass;
      for(let k=0;k<3;k++)d.momentum[k]+=s.diagnostics.momentum[k];
      for(const att of cc.atts){
        // Replace the proxy (effective mass, predicted state) by the node's own mass riding on its carrier point.
        const node=att.cableNode,proxy=cc.views.masses[node],own=att.nodeMass;d.mass-=proxy-own;
        for(let k=0;k<3;k++){
          const v=s.velocities[3*node+k];d.cableKinetic-=.5*proxy*v*v;d.cablePotential+=proxy*gc[k]*s.positions[3*node+k];d.momentum[k]-=proxy*v;
          let point=0,speed=0;
          if(att.body){
            const body=att.body,r=att.r,I=body.invI,P=body.pendingP,L=body.pendingL,a=(k+1)%3,b=(k+2)%3,pend=body.hasPending?1:0;
            const wa=body.w[a]+pend*(I[3*a]*L[0]+I[3*a+1]*L[1]+I[3*a+2]*L[2]),wb=body.w[b]+pend*(I[3*b]*L[0]+I[3*b+1]*L[1]+I[3*b+2]*L[2]);
            point=body.x[k]+r[k];speed=body.v[k]+pend*body.invM*P[k]+wa*r[b]-wb*r[a];
          }else{const f=att.frame!.views,n=att.frameNode;point=f.rest[3*n+k]+f.displacements[6*n+k];speed=f.velocities[6*n+k];}
          d.cableKinetic+=.5*own*speed*speed;d.cablePotential-=own*gc[k]*point;d.momentum[k]+=own*speed;
        }
      }
    }
    for(const fc of this.frames){
      const s=fc.frame.inspect().diagnostics;d.frameKinetic+=s.kineticEnergy;d.frameElastic+=s.elasticEnergy;d.framePotential+=s.gravitationalEnergy;d.mass+=s.mass;
      for(let k=0;k<3;k++)d.momentum[k]+=s.linearMomentum[k];
    }
    d.total=d.bodyKinetic+d.bodyPotential+d.cableKinetic+d.cableElastic+d.cablePotential+d.frameKinetic+d.frameElastic+d.framePotential;
    return d;
  }
}
