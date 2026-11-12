/**
 * Calibrated cloth: a triangle-mesh membrane and plate in SI units, float64, JavaScript.
 *
 *  - Membrane: constant-strain triangles with the St. Venant-Kirchhoff plane-stress law,
 *    S = Y / (1 - nu^2) [(1 - nu) E + nu tr(E) 1], Y = E t (N/m), E the Green strain. `membrane: 'spring'`
 *    replaces it by edge springs (k = Y sum(A) / L^2) for comparison: springs cannot be given a Poisson ratio.
 *  - Bending: the Koiter plate energy (D/2) [nu tr(L)^2 + (1 - nu) tr(L^2)], D = E t^3 / (12 (1 - nu^2)), on the
 *    triangle-averaged shape operator L = sum over the triangle's interior edges of (theta - theta0) |e| / (2 A) t (x) t,
 *    theta the dihedral angle and t the in-plane normal of the edge. Exact for constant curvature on structured
 *    meshes; not convergent on arbitrary meshes (measured in docs/CLOTH.md). `bending: 'hinge'` is the plain
 *    hinge energy, which fixes nu = 1/3 and depends on the mesh.
 *  - Time: backward Euler written as a minimisation (inertia + elastic + contact energy) and solved by Newton
 *    with a positive-definite Hessian, block-Jacobi preconditioned conjugate gradients and a line search, to a
 *    force tolerance. Stiffness never depends on an iteration count. `integrator: 'midpoint'` is the implicit
 *    midpoint rule for smooth problems without contact.
 *  - Rigid bodies: box, sphere, capsule and plane by their exact signed distance, found along each node's path
 *    relative to the body (sphere tracing), with Coulomb friction (a stick spring capped at mu N). A dynamic body is
 *    six unknowns of the same solve with the inertia the rigid step gives it, so contact and attachments are
 *    implicit in both sides; the forces are then handed to the rigid world, equal and opposite.
 *  - Self-collision: point-triangle and edge-edge repulsion inside the collision thickness, from a spatial hash.
 *
 * Deterministic; no allocation in `step()`. See docs/CLOTH.md for the equations, validation and limits.
 */
import {EngineError} from './contracts.ts';
import {captureFields,checkpointError,eachElement,holder,restoreFields,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';
import {principalMoments,type StructureInertia} from './structure-coupling.ts';
import type {Subsystem} from './simulation.ts';

export const CLOTH_SOLVER_ID='cloth-stvk-koiter-newton-pcg-js-f64-v1';
export const CLOTH_COUPLING_BACKEND='rigid-cloth-coupling-monolithic-js-f64-v1';
export const CLOTH_MAX_NODES=65536;

export type ClothVec3=readonly [number,number,number];
export interface ClothMaterial {
  /** Mass per area, kg/m^2. */
  readonly arealDensity:number;
  /** Young's modulus, Pa. */
  readonly youngModulus:number;
  /** Thickness, m. Membrane stiffness is Y = E t. */
  readonly thickness:number;
  readonly poissonRatio:number;
  /** 'stvk' (default): constant-strain triangles. 'spring': edge springs, for comparison only. */
  readonly membrane?:'stvk'|'spring';
  /** 'koiter' (default), 'hinge' (plain hinge energy, nu fixed at 1/3) or 'none'. */
  readonly bending?:'koiter'|'hinge'|'none';
  /** Bending stiffness D in N m. Default E t^3 / (12 (1 - nu^2)). Woven fabric bends far more easily than a plate of its thickness: measure it and set it. */
  readonly bendingStiffness?:number;
}
export interface ClothConfig {
  /** Fixed step, s. */
  readonly dt:number;
  readonly gravity?:ClothVec3;
  readonly integrator?:'backward-euler'|'midpoint';
  /** Mass-proportional damping, 1/s. */
  readonly drag?:number;
  /** Newton iterations per step at most. Default 60 (a step at rest takes one or two; an impact with many contacts changing can take tens). A step that stops here is counted in `stats.unconvergedSteps`. */
  readonly maxNewtonIterations?:number;
  /** Largest residual force on a degree of freedom, as a fraction of the largest load, inertia or internal force on a node. Default 1e-6. */
  readonly residualTolerance?:number;
  /** Added to the tolerance above, N. Default 0. */
  readonly forceTolerance?:number;
  /** Conjugate-gradient iterations per Newton iteration at most. Default 600. */
  readonly maxCgIterations?:number;
  /** Relative residual at which the conjugate gradients stop. Default 1e-2 (an inexact Newton step; the Newton iteration, not this, sets the accuracy). */
  readonly cgTolerance?:number;
}
export interface ClothContactOptions {
  /** Distance kept between the cloth's mid-surface and a body, m. Default thickness / 2. */
  readonly offset?:number;
  /** Penalty stiffness per node, N/m. Default 10 Y + 100 m / dt^2. The force a contact carries is exact at rest; the stiffness sets the depth, force / stiffness. */
  readonly stiffness?:number;
  /** Nodes closer than offset + skin to a body at the start of a step get a contact plane. Default offset / 2 + 1e-5 m. */
  readonly skin?:number;
}
export interface ClothSelfCollisionOptions {
  /** Distance below which two parts of the cloth repel, m. Must be less than half the smallest triangle height. */
  readonly thickness:number;
  /** Penalty stiffness per pair, N/m. Default: the contact stiffness. */
  readonly stiffness?:number;
  /** Most pairs held at once. Default 24 per node. */
  readonly capacity?:number;
}
export interface ClothDefinition {
  /** Node positions, xyz. */
  readonly positions:ArrayLike<number>;
  /** Node index triples, counter-clockwise, consistently oriented. */
  readonly triangles:ArrayLike<number>;
  /** Stress-free positions. Default: `positions`. Give a smaller sheet here to start pre-tensioned. */
  readonly restPositions?:ArrayLike<number>;
  readonly velocities?:ArrayLike<number>;
  readonly material:ClothMaterial;
  readonly config:ClothConfig;
  /** Nodes held where they start. */
  readonly pinned?:ArrayLike<number>;
  /** Mass added to nodes, kg (one value per node). */
  readonly extraMass?:ArrayLike<number>;
  readonly contact?:ClothContactOptions;
  readonly selfCollision?:ClothSelfCollisionOptions;
}
export type ClothShape=
  |{readonly kind:'box';readonly halfExtents:ClothVec3}
  |{readonly kind:'sphere';readonly radius:number}
  /** Axis along the body's local Y; halfLength is half the distance between the cap centres. */
  |{readonly kind:'capsule';readonly radius:number;readonly halfLength:number}
  /** The half space below the plane through the body position with this local normal. Static or kinematic bodies only. */
  |{readonly kind:'plane';readonly normal:ClothVec3};
export interface ClothBodyState {
  readonly position:ArrayLike<number>;
  readonly rotation:ArrayLike<number>;
  readonly linearVelocity?:ArrayLike<number>;
  readonly angularVelocity?:ArrayLike<number>;
}
export interface ClothBodyOptions extends ClothBodyState {
  readonly shape:ClothShape;
  readonly type:'static'|'kinematic'|'dynamic';
  /** Dynamic bodies: kg. */
  readonly mass?:number;
  /** Dynamic bodies: rotational inertia. Default: that of the shape with uniform density. */
  readonly inertia?:StructureInertia;
  /** Coulomb coefficient between this body and the cloth. Default 0. */
  readonly friction?:number;
  /** False: nodes attach to the body but do not collide with it. Default true. */
  readonly collide?:boolean;
  /** Dynamic bodies. False: the cloth feels the body, the body does not feel the cloth. Default true. */
  readonly twoWay?:boolean;
  readonly gravityScale?:number;
}
export interface ClothStats {
  steps:number;newtonIterations:number;cgIterations:number;lineSearchHalvings:number;unconvergedSteps:number;
  /** Largest residual force after the last step, N, and the tolerance it was held to. */
  residual:number;tolerance:number;
  /** Nodes pressing on a body, and self-collision pairs pressing, after the last step. */
  contacts:number;selfPairs:number;
  /** Self-collision pairs that could not be stored. */
  droppedPairs:number;
}
export interface ClothStaticResult {converged:boolean;iterations:number;residual:number;tolerance:number}
export interface ClothGrid {positions:Float64Array;triangles:Uint32Array;nx:number;ny:number;node(i:number,j:number):number}

const fail=(message:string):never=>{throw new EngineError('INVALID_PAYLOAD',message);};
const num=(value:unknown,label:string,min:number,max:number):number=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${label} must be a number in [${min}, ${max}].`);
  return value as number;
};
const FREE=0,PINNED=1,ATTACHED=2;
const SLOTS=2;

/**
 * A rectangle of (nx + 1) x (ny + 1) nodes spanned by `u` and `v` from `origin` (default: the x-y plane), node (i, j) at
 * index i + (nx + 1) j. `diagonal`: 'uniform' cuts every cell the same way, 'alternate' in a union-jack pattern.
 * `jitter` moves interior nodes by up to that fraction of a cell (a seeded generator, so the mesh is repeatable).
 */
export function clothGrid(options:{readonly nx:number;readonly ny:number;readonly u:ClothVec3;readonly v:ClothVec3;readonly origin?:ClothVec3;readonly diagonal?:'uniform'|'alternate';readonly jitter?:number;readonly seed?:number}):ClothGrid {
  const {nx,ny,u,v}=options,o=options.origin??[0,0,0],jitter=options.jitter??0;
  if(!Number.isInteger(nx)||!Number.isInteger(ny)||nx<1||ny<1||(nx+1)*(ny+1)>CLOTH_MAX_NODES)fail('clothGrid: nx and ny must be positive integers within the node limit.');
  if(!(jitter>=0&&jitter<.5))fail('clothGrid: jitter must be in [0, 0.5).');
  const positions=new Float64Array(3*(nx+1)*(ny+1)),triangles=new Uint32Array(6*nx*ny),node=(i:number,j:number)=>i+(nx+1)*j;
  let seed=(options.seed??1)>>>0;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296-.5;};
  for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++){
    let a=i/nx,b=j/ny;
    if(jitter>0&&i>0&&i<nx&&j>0&&j<ny){a+=2*jitter*random()/nx;b+=2*jitter*random()/ny;}
    for(let k=0;k<3;k++)positions[3*node(i,j)+k]=o[k]+a*u[k]+b*v[k];
  }
  let t=0;
  for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const a=node(i,j),b=node(i+1,j),c=node(i+1,j+1),d=node(i,j+1);
    if(options.diagonal==='alternate'&&((i+j)&1)===1){triangles[t++]=a;triangles[t++]=b;triangles[t++]=d;triangles[t++]=b;triangles[t++]=c;triangles[t++]=d;}
    else{triangles[t++]=a;triangles[t++]=b;triangles[t++]=c;triangles[t++]=a;triangles[t++]=c;triangles[t++]=d;}
  }
  return {positions,triangles,nx,ny,node};
}

class ClothBody {
  type=0;shape=0;
  /** Shape numbers: box half extents, or radius and half length, or the plane's local normal. */
  readonly dim=new Float64Array(3);
  bound=Infinity;mass=0;moments:[number,number,number]|null=null;friction=0;collide=true;twoWay=true;gravityScale=1;
  readonly x=new Float64Array(3);readonly q=new Float64Array([0,0,0,1]);readonly R=new Float64Array(9);
  readonly v=new Float64Array(3);readonly w=new Float64Array(3);
  /** World inertia and its inverse at the start of the step. */
  readonly Iw=new Float64Array(9);readonly Iinv=new Float64Array(9);
  /** Force and torque on the body from everything the cloth does not know of (supports, joints), N and N m. */
  readonly external=new Float64Array(6);
  /** Free displacement and rotation of the step. */
  readonly free=new Float64Array(6);
  /** Force and torque the cloth put on the body in the last step, about its centre of mass. */
  readonly force=new Float64Array(3);readonly torque=new Float64Array(3);
  /** Rotation of the step at the present iterate, exp([theta]x), and the left Jacobian J with d(exp([theta]x) r) = (J dtheta) x (exp r). */
  readonly Rt=new Float64Array(9);readonly Jl=new Float64Array(9);readonly tq=new Float64Array(3);
  /** True when the body's six unknowns are part of the solve. */
  solved=false;contacts=0;attached=0;
}

function quatToMatrix(q:ArrayLike<number>,R:Float64Array):void {
  let x=q[0],y=q[1],z=q[2],w=q[3];const n=Math.hypot(x,y,z,w)||1;x/=n;y/=n;z/=n;w/=n;
  R[0]=1-2*(y*y+z*z);R[1]=2*(x*y-z*w);R[2]=2*(x*z+y*w);
  R[3]=2*(x*y+z*w);R[4]=1-2*(x*x+z*z);R[5]=2*(y*z-x*w);
  R[6]=2*(x*z-y*w);R[7]=2*(y*z+x*w);R[8]=1-2*(x*x+y*y);
}
/** Inverse of a symmetric positive-definite 3x3 given as xx, xy, xz, yy, yz, zz; writes 9 numbers. */
function invertSym(a:number,b:number,c:number,d:number,e:number,f:number,out:Float64Array,o:number):void {
  const A=d*f-e*e,B=c*e-b*f,C=b*e-c*d,det=a*A+b*B+c*C,s=det>1e-300?1/det:0;
  out[o]=A*s;out[o+1]=B*s;out[o+2]=C*s;out[o+3]=B*s;out[o+4]=(a*f-c*c)*s;out[o+5]=(b*c-a*e)*s;out[o+6]=C*s;out[o+7]=(b*c-a*e)*s;out[o+8]=(a*d-b*b)*s;
}

/** A cloth. Step it alone with `step()`, or hand it to a `ClothCoupling` to exchange forces with a rigid world. */
/** What an exact checkpoint of a Cloth holds: every field (state, contact and self-contact records, solver vectors and
 * statistics); the bodies it touches keep their identity. */
const CLOTH_FIELDS:FieldOptions={label:'Cloth',nested:{bodies:eachElement({label:'Cloth body'})}};
/** What an exact checkpoint of a ClothCoupling holds: the cloth and the coupled bodies' records. */
const CLOTH_COUPLING_FIELDS:FieldOptions={label:'ClothCoupling',skip:['world','byBody'],nested:{cloth:holder,list:eachElement({label:'ClothCoupling body'})}};

export class Cloth {
  /** Everything a later step reads, as a state tree (checkpoint.ts), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,CLOTH_FIELDS);}
  /** Put back a state from `saveState()` of a cloth built from the same mesh, material and settings, touching the same bodies. */
  restoreState(state:StateValue):void {restoreFields(this,state,CLOTH_FIELDS);}

  readonly solver=CLOTH_SOLVER_ID;
  readonly nodeCount:number;readonly triangleCount:number;readonly edgeCount:number;readonly hingeCount:number;
  readonly dt:number;readonly integrator:'backward-euler'|'midpoint';
  readonly gravity:Float64Array;
  /** Y = E t, N/m, and D, N m. */
  readonly membraneStiffness:number;readonly bendingStiffness:number;readonly poissonRatio:number;
  readonly membraneModel:'stvk'|'spring';readonly bendingModel:'koiter'|'hinge'|'none';
  /** Live state. Read them; write through the methods. */
  readonly positions:Float64Array;readonly velocities:Float64Array;readonly masses:Float64Array;
  readonly triangles:Uint32Array;readonly edges:Uint32Array;
  /** Force the supports put on pinned and prescribed nodes in the last step or static solve, N (zero elsewhere). */
  readonly reactions:Float64Array;
  readonly stats:ClothStats={steps:0,newtonIterations:0,cgIterations:0,lineSearchHalvings:0,unconvergedSteps:0,residual:0,tolerance:0,contacts:0,selfPairs:0,droppedPairs:0};
  /** Work done on the cloth by point forces, pressure, wind, moving supports and bodies since it was made, J. */
  externalWork=0;
  time=0;
  /** Mass-proportional damping, 1/s. May be changed between steps. */
  drag:number;
  /** 'implicit' (default) or 'naive-staggered': bodies are then moved as if the cloth were not there and handed its force afterwards. For demonstrations of why that fails. */
  scheme:'implicit'|'naive-staggered'='implicit';
  /** How far the rigid step moves a body per unit of force: x += h v + bodyStepFactor h^2 a. 1 is backward Euler; a ClothCoupling sets (n + 1) / (2 n) for n substeps. */
  bodyStepFactor=1;

  private readonly maxNewton:number;private readonly maxCg:number;private readonly cgTol:number;
  private readonly resTol:number;private readonly forceTol:number;
  private readonly kind:Uint8Array;private readonly target:Float64Array;private readonly x0:Float64Array;private readonly xt:Float64Array;
  private readonly vLast:Float64Array;private lastStep=0;
  private readonly attBody:Int32Array;private readonly attLocal:Float64Array;private readonly attR:Float64Array;
  /** Dead loads of the step (gravity, point forces, wind, pressure of the last iterate), and the user's point forces. */
  private readonly fext:Float64Array;private readonly pointForce:Float64Array;private readonly follower:Float64Array;
  private pressure=0;private windOn=false;private readonly wind=new Float64Array(5);
  // Membrane.
  private readonly triInv:Float64Array;private readonly triArea:Float64Array;private readonly triLin:Float64Array;
  private readonly edgeRest:Float64Array;private readonly edgeK:Float64Array;private readonly edgeLin:Float64Array;
  // Bending.
  private readonly hinge:Uint32Array;private readonly hingeRest:Float64Array;private readonly hingeNbr:Int32Array;private readonly hingeB:Float64Array;
  private readonly hingeGrad:Float64Array;private readonly hingePhi:Float64Array;
  // Unknowns: 3 per node, then 6 per body.
  private size:number;private y:Float64Array;private G:Float64Array;private trial:Float64Array;
  private cgR:Float64Array;private cgZ:Float64Array;private cgP:Float64Array;private cgA:Float64Array;private cgE:Float64Array;
  private readonly diag:Float64Array;private readonly pinv:Float64Array;private bodyPinv=new Float64Array(0);private bodyDiag=new Float64Array(0);
  private readonly fabs:Float64Array;
  // Step parameters (dynamics, or the proximal step of a static solve).
  private ih2=0;private dragRate=0;private alpha=1;private energyStored=0;
  // Bodies and contacts.
  private readonly bodies:ClothBody[]=[];
  private readonly contactOffset:number;private readonly contactSkin:number;private readonly contactK:number|null;private readonly youngT:number;
  private readonly cBody:Int32Array;private readonly cData:Float64Array;private readonly cLin:Float64Array;private readonly cKeep:Uint8Array;
  // Self-collision.
  private readonly selfOn:boolean;private readonly selfThickness:number;private readonly selfK:number|null;private readonly pairCap:number;
  private pairCount=0;private readonly pairNodes:Int32Array;private readonly pairW:Float64Array;private readonly pairN:Float64Array;private readonly pairOn:Uint8Array;
  private readonly pairKeys:Float64Array;private readonly cellStart:Int32Array;private readonly cellNodes:Int32Array;private readonly cellMask:number;
  private readonly nodeEdgeStart:Int32Array;private readonly nodeEdges:Int32Array;private readonly maxEdge:number;
  private readonly detectAt:Float64Array;
  private readonly sn=new Float64Array(3);private readonly bary=new Float64Array(4);

  constructor(definition:ClothDefinition) {
    if(!definition||typeof definition!=='object')fail('A cloth needs {positions, triangles, material, config}.');
    const m=definition.material,c=definition.config;
    if(!m||!c)fail('A cloth needs a material and a config.');
    const n=definition.positions.length/3,T=definition.triangles.length/3;
    if(!Number.isInteger(n)||n<3||n>CLOTH_MAX_NODES)fail(`positions must hold 3 to ${CLOTH_MAX_NODES} nodes.`);
    if(!Number.isInteger(T)||T<1)fail('triangles must hold index triples.');
    const rho=num(m.arealDensity,'arealDensity',1e-9,1e6),E=num(m.youngModulus,'youngModulus',0,1e13),t=num(m.thickness,'thickness',1e-7,10),nu=num(m.poissonRatio,'poissonRatio',-.99,.499);
    this.membraneModel=m.membrane??'stvk';this.bendingModel=m.bending??'koiter';
    if(this.membraneModel!=='stvk'&&this.membraneModel!=='spring')fail("membrane must be 'stvk' or 'spring'.");
    if(this.bendingModel!=='koiter'&&this.bendingModel!=='hinge'&&this.bendingModel!=='none')fail("bending must be 'koiter', 'hinge' or 'none'.");
    const Y=E*t,D=m.bendingStiffness===undefined?E*t*t*t/(12*(1-nu*nu)):num(m.bendingStiffness,'bendingStiffness',0,1e12);
    this.membraneStiffness=Y;this.bendingStiffness=this.bendingModel==='none'?0:D;this.poissonRatio=nu;this.youngT=Y;
    this.dt=num(c.dt,'dt',1e-7,10);this.integrator=c.integrator??'backward-euler';
    if(this.integrator!=='backward-euler'&&this.integrator!=='midpoint')fail("integrator must be 'backward-euler' or 'midpoint'.");
    const g=c.gravity??[0,-9.81,0];this.gravity=new Float64Array([num(g[0],'gravity',-1e6,1e6),num(g[1],'gravity',-1e6,1e6),num(g[2],'gravity',-1e6,1e6)]);
    this.drag=c.drag===undefined?0:num(c.drag,'drag',0,1e6);
    this.maxNewton=c.maxNewtonIterations===undefined?60:num(c.maxNewtonIterations,'maxNewtonIterations',1,10000);
    this.maxCg=c.maxCgIterations===undefined?600:num(c.maxCgIterations,'maxCgIterations',1,1e6);
    this.cgTol=c.cgTolerance===undefined?1e-2:num(c.cgTolerance,'cgTolerance',1e-14,.5);
    this.resTol=c.residualTolerance===undefined?1e-6:num(c.residualTolerance,'residualTolerance',0,1);
    this.forceTol=c.forceTolerance===undefined?0:num(c.forceTolerance,'forceTolerance',0,1e9);
    this.nodeCount=n;this.triangleCount=T;
    const x=this.positions=new Float64Array(3*n),X=new Float64Array(3*n);
    for(let i=0;i<3*n;i++){x[i]=num(definition.positions[i],'positions',-1e9,1e9);X[i]=definition.restPositions?num(definition.restPositions[i],'restPositions',-1e9,1e9):x[i];}
    if(definition.restPositions&&definition.restPositions.length!==3*n)fail('restPositions has the wrong length.');
    this.velocities=new Float64Array(3*n);
    if(definition.velocities){if(definition.velocities.length!==3*n)fail('velocities has the wrong length.');for(let i=0;i<3*n;i++)this.velocities[i]=num(definition.velocities[i],'velocities',-1e9,1e9);}
    const tri=this.triangles=new Uint32Array(3*T);
    for(let i=0;i<3*T;i++){const v=definition.triangles[i];if(!Number.isInteger(v)||v<0||v>=n)fail(`triangles[${i}] is not a node.`);tri[i]=v;}
    // Rest geometry of the triangles, lumped masses.
    const masses=this.masses=new Float64Array(n),inv=this.triInv=new Float64Array(3*T),area=this.triArea=new Float64Array(T);
    let minHeight=Infinity;
    for(let k=0;k<T;k++){
      const a=3*tri[3*k],b=3*tri[3*k+1],cc=3*tri[3*k+2];
      if(a===b||b===cc||a===cc)fail(`Triangle ${k} repeats a node.`);
      const ux=X[b]-X[a],uy=X[b+1]-X[a+1],uz=X[b+2]-X[a+2],vx=X[cc]-X[a],vy=X[cc+1]-X[a+1],vz=X[cc+2]-X[a+2];
      const l1=Math.hypot(ux,uy,uz),d=(ux*vx+uy*vy+uz*vz)/(l1||1),h2=Math.sqrt(Math.max(0,vx*vx+vy*vy+vz*vz-d*d)),A=.5*l1*h2;
      if(!(A>1e-18)||!(h2>1e-9*l1))fail(`Triangle ${k} has no area in the rest shape.`);
      // Rows of Dm^-1 for Dm = [[l1, d], [0, h2]]: the gradients of the shape functions of b and c.
      inv[3*k]=1/l1;inv[3*k+1]=-d/(l1*h2);inv[3*k+2]=1/h2;area[k]=A;
      const share=rho*A/3;masses[a/3]+=share;masses[b/3]+=share;masses[cc/3]+=share;
      const l2=Math.hypot(vx,vy,vz),l3=Math.hypot(vx-ux,vy-uy,vz-uz);minHeight=Math.min(minHeight,2*A/Math.max(l1,l2,l3));
    }
    if(definition.extraMass){if(definition.extraMass.length!==n)fail('extraMass needs one value per node.');for(let i=0;i<n;i++)masses[i]+=num(definition.extraMass[i],'extraMass',0,1e9);}
    for(let i=0;i<n;i++)if(!(masses[i]>0))fail(`Node ${i} belongs to no triangle.`);
    // Edges: each with the triangle that runs along it (A) and the one that runs against it (B).
    const edgeOf=new Map<number,number>(),ea:number[]=[],eb:number[]=[],eA:number[]=[],eB:number[]=[],eoA:number[]=[],eoB:number[]=[];
    const triEdge=new Int32Array(3*T);
    for(let k=0;k<T;k++)for(let s=0;s<3;s++){
      const i=tri[3*k+s],j=tri[3*k+(s+1)%3],o=tri[3*k+(s+2)%3],key=Math.min(i,j)*n+Math.max(i,j);
      let e=edgeOf.get(key);
      if(e===undefined){e=ea.length;edgeOf.set(key,e);ea.push(i);eb.push(j);eA.push(k);eB.push(-1);eoA.push(o);eoB.push(-1);}
      else{
        if(eB[e]!==-1)fail(`More than two triangles share the edge ${Math.min(i,j)}-${Math.max(i,j)}.`);
        if(ea[e]!==j||eb[e]!==i)fail(`Triangles ${eA[e]} and ${k} are not consistently oriented.`);
        eB[e]=k;eoB[e]=o;
      }
      triEdge[3*k+s]=e;
    }
    const Ecount=this.edgeCount=ea.length,edges=this.edges=new Uint32Array(2*Ecount);
    this.edgeRest=new Float64Array(Ecount);this.edgeK=new Float64Array(Ecount);this.edgeLin=new Float64Array(4*Ecount);
    let maxEdge=0;
    for(let e=0;e<Ecount;e++){
      edges[2*e]=ea[e];edges[2*e+1]=eb[e];
      const L=Math.hypot(X[3*ea[e]]-X[3*eb[e]],X[3*ea[e]+1]-X[3*eb[e]+1],X[3*ea[e]+2]-X[3*eb[e]+2]);
      this.edgeRest[e]=L;maxEdge=Math.max(maxEdge,L);
      // Edge springs (comparison model): k = Y sum(A) / L^2 (Van Gelder), which gives the right modulus on an equilateral mesh and nu = 1/3 there.
      this.edgeK[e]=Y*(area[eA[e]]+(eB[e]>=0?area[eB[e]]:0))/(L*L);
    }
    this.maxEdge=maxEdge;
    // Hinges: interior edges, nodes [edge start, edge end, opposite in A, opposite in B].
    const hingeOf=new Int32Array(Ecount).fill(-1);let H=0;
    for(let e=0;e<Ecount;e++)if(eB[e]>=0)hingeOf[e]=H++;
    if(this.bendingModel==='none'||!(this.bendingStiffness>0))H=0;
    this.hingeCount=H;
    const hinge=this.hinge=new Uint32Array(4*H),hingeNbr=this.hingeNbr=new Int32Array(4*H).fill(-1),hingeB=this.hingeB=new Float64Array(5*H);
    this.hingeRest=new Float64Array(H);this.hingeGrad=new Float64Array(12*H);this.hingePhi=new Float64Array(H);
    if(H>0){
      for(let e=0;e<Ecount;e++){const hh=hingeOf[e];if(hh<0)continue;hinge[4*hh]=ea[e];hinge[4*hh+1]=eb[e];hinge[4*hh+2]=eoA[e];hinge[4*hh+3]=eoB[e];}
      // A triangle whose three nodes are held from the start is a wall: it stores no bending energy, and the angle of an
      // edge between it and a free triangle counts twice in the free one (the wall is that triangle's mirror image). That
      // is what makes a clamped edge second-order accurate; without it the clamp is too soft by a whole half cell.
      const held=new Uint8Array(n),wall=new Uint8Array(T);
      if(definition.pinned)for(const i of Array.from(definition.pinned))if(Number.isInteger(i)&&i>=0&&i<n)held[i]=1;
      for(let k=0;k<T;k++)wall[k]=held[tri[3*k]]&held[tri[3*k+1]]&held[tri[3*k+2]];
      const weight=(e:number,k:number)=>wall[eA[e]===k?eB[e]:eA[e]]?2:1;
      for(let k=0;k<T;k++)for(let s=0;s<3;s++){
        if(wall[k])continue;
        const e=triEdge[3*k+s],he=hingeOf[e];if(he<0)continue;
        const Le=this.edgeRest[e],we=weight(e,k);
        if(this.bendingModel==='hinge'){hingeB[5*he]+=we*we*D*8/9*Le*Le/(area[eA[e]]+area[eB[e]])/2;continue;}
        hingeB[5*he]+=we*we*D*Le*Le/(4*area[k]);
        for(let q=1;q<3;q++){
          const f=triEdge[3*k+(s+q)%3],hf=hingeOf[f];if(hf<0)continue;
          const Lf=this.edgeRest[f];let dot=0;
          for(let d=0;d<3;d++)dot+=(X[3*eb[e]+d]-X[3*ea[e]+d])*(X[3*eb[f]+d]-X[3*ea[f]+d]);
          const cos=dot/(Le*Lf);
          // Slots 0, 1 are the other edges of triangle A, slots 2, 3 those of triangle B.
          const slot=(eA[e]===k?0:2)+q-1;
          hingeNbr[4*he+slot]=hf;hingeB[5*he+1+slot]=we*weight(f,k)*D*Le*Lf/(4*area[k])*(nu+(1-nu)*cos*cos);
        }
      }
      for(let hh=0;hh<H;hh++)this.hingeRest[hh]=this.dihedral(X,hh,false);
    }
    this.triLin=new Float64Array(9*T);
    this.kind=new Uint8Array(n);this.target=new Float64Array(3*n);this.x0=new Float64Array(3*n);this.xt=new Float64Array(3*n);this.vLast=new Float64Array(3*n);
    this.attBody=new Int32Array(n).fill(-1);this.attLocal=new Float64Array(3*n);this.attR=new Float64Array(3*n);
    this.fext=new Float64Array(3*n);this.pointForce=new Float64Array(3*n);this.follower=new Float64Array(3*n);this.reactions=new Float64Array(3*n);
    this.size=3*n;this.y=new Float64Array(3*n);this.G=new Float64Array(3*n);this.trial=new Float64Array(3*n);
    this.cgR=new Float64Array(3*n);this.cgZ=new Float64Array(3*n);this.cgP=new Float64Array(3*n);this.cgA=new Float64Array(3*n);this.cgE=new Float64Array(3*n);
    this.diag=new Float64Array(6*n);this.pinv=new Float64Array(9*n);this.fabs=new Float64Array(n);
    if(definition.pinned)for(const i of Array.from(definition.pinned)){if(!Number.isInteger(i)||i<0||i>=n)fail(`pinned: ${i} is not a node.`);this.kind[i]=PINNED;this.target[3*i]=x[3*i];this.target[3*i+1]=x[3*i+1];this.target[3*i+2]=x[3*i+2];}
    const co=definition.contact??{};
    this.contactOffset=co.offset===undefined?t/2:num(co.offset,'contact.offset',0,10);
    this.contactSkin=co.skin===undefined?this.contactOffset/2+1e-5:num(co.skin,'contact.skin',1e-9,10);
    this.contactK=co.stiffness===undefined?null:num(co.stiffness,'contact.stiffness',1e-9,1e15);
    this.cBody=new Int32Array(SLOTS*n).fill(-1);this.cData=new Float64Array(14*SLOTS*n);this.cLin=new Float64Array(12*SLOTS*n);this.cKeep=new Uint8Array(SLOTS*n);
    const sc=definition.selfCollision;
    this.selfOn=!!sc;this.selfThickness=sc?num(sc.thickness,'selfCollision.thickness',1e-9,10):0;
    if(sc&&!(this.selfThickness<.5*minHeight))fail(`selfCollision.thickness ${this.selfThickness} m must be less than half the smallest triangle height (${minHeight} m): neighbouring nodes would repel in the rest shape.`);
    this.selfK=sc&&sc.stiffness!==undefined?num(sc.stiffness,'selfCollision.stiffness',1e-9,1e15):null;
    this.pairCap=sc?(sc.capacity===undefined?24*n:num(sc.capacity,'selfCollision.capacity',1,1e7)):0;
    this.pairNodes=new Int32Array(4*this.pairCap);this.pairW=new Float64Array(4*this.pairCap);this.pairN=new Float64Array(3*this.pairCap);this.pairOn=new Uint8Array(this.pairCap);
    let keys=1;while(keys<4*this.pairCap)keys*=2;
    this.pairKeys=new Float64Array(sc?keys:0);
    let cells=1;while(cells<2*n)cells*=2;
    this.cellMask=cells-1;this.cellStart=new Int32Array(sc?cells+1:0);this.cellNodes=new Int32Array(sc?n:0);this.detectAt=new Float64Array(sc?3*n:0);
    this.nodeEdgeStart=new Int32Array(sc?n+1:0);this.nodeEdges=new Int32Array(sc?2*Ecount:0);
    if(sc){
      const s=this.nodeEdgeStart;
      for(let e=0;e<Ecount;e++){s[ea[e]+1]++;s[eb[e]+1]++;}
      for(let i=0;i<n;i++)s[i+1]+=s[i];
      const fill=new Int32Array(n);
      for(let e=0;e<Ecount;e++){this.nodeEdges[s[ea[e]]+fill[ea[e]]++]=e;this.nodeEdges[s[eb[e]]+fill[eb[e]]++]=e;}
    }
    this.x0.set(x);
  }

  /** Total mass, kg. */
  mass():number {let s=0;for(let i=0;i<this.nodeCount;i++)s+=this.masses[i];return s;}

  // ---------------------------------------------------------------------------------------------
  // Supports and loads.
  // ---------------------------------------------------------------------------------------------
  private node(i:number):number {if(!Number.isInteger(i)||i<0||i>=this.nodeCount)fail(`${i} is not a node.`);return i;}
  /** Hold a node where it is, or at `position`: it moves there over the next step and stays. */
  pin(node:number,position?:ArrayLike<number>):void {
    const i=this.node(node);
    if(this.kind[i]===ATTACHED)fail(`Node ${i} is attached to a body: detach it first.`);
    this.kind[i]=PINNED;this.clearContacts(i);
    for(let k=0;k<3;k++)this.target[3*i+k]=position?num(position[k],'position',-1e9,1e9):this.positions[3*i+k];
  }
  /** Let a pinned or attached node go. */
  release(node:number):void {const i=this.node(node);if(this.kind[i]===ATTACHED)this.bodies[this.attBody[i]].attached--;this.kind[i]=FREE;this.attBody[i]=-1;}
  isPinned(node:number):boolean {return this.kind[this.node(node)]===PINNED;}
  /** A force on a node that stays until it is changed, N. */
  setNodalForce(node:number,force:ArrayLike<number>):void {const i=this.node(node);for(let k=0;k<3;k++)this.pointForce[3*i+k]=num(force[k],'force',-1e12,1e12);}
  /** Uniform pressure on the side the triangle normals point away from, Pa: each triangle is pushed along its normal by p A. It follows the surface. */
  setPressure(pascal:number):void {this.pressure=num(pascal,'pressure',-1e12,1e12);}
  /** Wind as a normal-pressure model, not aerodynamics: each triangle feels (1/2) rho C (u.n) |u.n| A along its normal n, u being the wind relative to the triangle. Evaluated at the start of each step. `null` turns it off. */
  setWind(wind:{readonly velocity:ArrayLike<number>;readonly airDensity?:number;readonly coefficient?:number}|null):void {
    this.windOn=!!wind;if(!wind)return;
    for(let k=0;k<3;k++)this.wind[k]=num(wind.velocity[k],'wind.velocity',-1e4,1e4);
    this.wind[3]=wind.airDensity===undefined?1.225:num(wind.airDensity,'wind.airDensity',0,1e5);this.wind[4]=wind.coefficient===undefined?1:num(wind.coefficient,'wind.coefficient',0,1e3);
  }
  private clearContacts(i:number):void {for(let s=0;s<SLOTS;s++)this.cBody[SLOTS*i+s]=-1;}

  // ---------------------------------------------------------------------------------------------
  // Rigid bodies.
  // ---------------------------------------------------------------------------------------------
  /** Add a rigid body the cloth collides with or is attached to. Returns its index. Not for the hot path: it resizes the solver's vectors. */
  addBody(options:ClothBodyOptions):number {
    if(this.integrator==='midpoint')fail('The midpoint integrator has no contact or bodies: use backward-euler.');
    const b=new ClothBody(),s=options.shape;
    if(!s||typeof s!=='object')fail('A body needs a shape.');
    b.type=options.type==='static'?0:options.type==='kinematic'?1:options.type==='dynamic'?2:fail("type must be 'static', 'kinematic' or 'dynamic'.");
    let inertia:StructureInertia;
    if(s.kind==='box'){b.shape=0;for(let k=0;k<3;k++)b.dim[k]=num(s.halfExtents[k],'halfExtents',1e-9,1e9);b.bound=Math.hypot(b.dim[0],b.dim[1],b.dim[2]);inertia={kind:'box',halfExtents:[b.dim[0],b.dim[1],b.dim[2]]};}
    else if(s.kind==='sphere'){b.shape=1;b.dim[0]=num(s.radius,'radius',1e-9,1e9);b.bound=b.dim[0];inertia={kind:'sphere',radius:b.dim[0]};}
    else if(s.kind==='capsule'){b.shape=2;b.dim[0]=num(s.radius,'radius',1e-9,1e9);b.dim[1]=num(s.halfLength,'halfLength',1e-9,1e9);b.bound=b.dim[0]+b.dim[1];inertia={kind:'capsule',radius:b.dim[0],halfLength:b.dim[1]};}
    else if(s.kind==='plane'){
      if(b.type===2)fail('A plane cannot be a dynamic body.');
      const l=Math.hypot(s.normal[0],s.normal[1],s.normal[2]);if(!(l>0))fail('plane.normal must not be zero.');
      b.shape=3;for(let k=0;k<3;k++)b.dim[k]=s.normal[k]/l;inertia={kind:'locked'};
    }else return fail('Supported shapes: box, sphere, capsule, plane. Hulls, triangle meshes and height fields are not.');
    b.friction=options.friction===undefined?0:num(options.friction,'friction',0,100);
    b.collide=options.collide??true;b.twoWay=options.twoWay??true;b.gravityScale=options.gravityScale===undefined?1:num(options.gravityScale,'gravityScale',-1e3,1e3);
    if(b.type===2){b.mass=num(options.mass,'mass',1e-12,1e15);b.moments=principalMoments(options.inertia??inertia,b.mass);}
    this.bodies.push(b);this.setBodyState(this.bodies.length-1,options);
    const size=3*this.nodeCount+6*this.bodies.length,grow=(old:Float64Array)=>{const a=new Float64Array(size);a.set(old.subarray(0,3*this.nodeCount));return a;};
    this.size=size;this.y=grow(this.y);this.G=grow(this.G);this.trial=grow(this.trial);this.cgR=grow(this.cgR);this.cgZ=grow(this.cgZ);this.cgP=grow(this.cgP);this.cgA=grow(this.cgA);this.cgE=grow(this.cgE);
    this.bodyPinv=new Float64Array(18*this.bodies.length);this.bodyDiag=new Float64Array(12*this.bodies.length);
    return this.bodies.length-1;
  }
  get bodyCount():number {return this.bodies.length;}
  private body(index:number):ClothBody {const b=this.bodies[index];if(!b)fail(`${index} is not a body of this cloth.`);return b;}
  /** Tell the cloth where a body is and how it moves, before a step. A kinematic body moves with its velocity through the step. */
  setBodyState(index:number,state:ClothBodyState):void {
    const b=this.body(index);
    for(let k=0;k<3;k++){b.x[k]=state.position[k];b.v[k]=state.linearVelocity?state.linearVelocity[k]:0;b.w[k]=state.angularVelocity?state.angularVelocity[k]:0;}
    for(let k=0;k<4;k++)b.q[k]=state.rotation[k];
    quatToMatrix(b.q,b.R);
    if(b.type===0){b.v.fill(0);b.w.fill(0);}
  }
  /** The force and torque on a body from what the cloth cannot see (its supports and joints), so that the cloth predicts its motion correctly. A ClothCoupling estimates it every step. */
  setBodyExternalLoad(index:number,force:ArrayLike<number>,torque:ArrayLike<number>,torqueOffset=0):void {const b=this.body(index);for(let k=0;k<3;k++){b.external[k]=force[k];b.external[3+k]=torque[torqueOffset+k];}}
  setBodyMass(index:number,mass:number):void {const b=this.body(index);if(b.type===2&&mass!==b.mass&&b.moments){const s=mass/b.mass;b.moments[0]*=s;b.moments[1]*=s;b.moments[2]*=s;b.mass=mass;}}
  /** Force (N) and torque about the centre of mass (N m) that the cloth put on the body in the last step. Apply them to the body over the next rigid step. */
  bodyForce(index:number):Float64Array {return this.body(index).force;}
  bodyTorque(index:number):Float64Array {return this.body(index).torque;}
  bodyTwoWay(index:number):boolean {const b=this.body(index);return b.type===2&&b.twoWay;}
  bodyGravityScale(index:number):number {return this.body(index).gravityScale;}
  /** out[3..5] = I dw for the body's world inertia at its present rotation (zero for a body that cannot turn). */
  bodyAngularMomentumChange(index:number,dx:number,dy:number,dz:number,out:Float64Array):void {
    const b=this.body(index),R=b.R,mo=b.moments;
    for(let r=0;r<3;r++){
      let s=0;
      if(mo)for(let c=0;c<3;c++){const d=c===0?dx:c===1?dy:dz;for(let k=0;k<3;k++)s+=R[3*r+k]*mo[k]*R[3*c+k]*d;}
      out[3+r]=s;
    }
  }
  /** Nodes pressing on the body after the last step. */
  bodyContacts(index:number):number {return this.body(index).contacts;}
  /** Fix a node to a point of a body. `localPoint` is in the body's axes from its centre; default: where the node is now. */
  attach(node:number,bodyIndex:number,localPoint?:ArrayLike<number>):void {
    const i=this.node(node),b=this.body(bodyIndex),R=b.R;
    if(this.kind[i]===ATTACHED)this.bodies[this.attBody[i]].attached--;
    this.kind[i]=ATTACHED;this.attBody[i]=bodyIndex;b.attached++;this.clearContacts(i);
    if(localPoint)for(let k=0;k<3;k++)this.attLocal[3*i+k]=num(localPoint[k],'localPoint',-1e9,1e9);
    else{
      const dx=this.positions[3*i]-b.x[0],dy=this.positions[3*i+1]-b.x[1],dz=this.positions[3*i+2]-b.x[2];
      this.attLocal[3*i]=R[0]*dx+R[3]*dy+R[6]*dz;this.attLocal[3*i+1]=R[1]*dx+R[4]*dy+R[7]*dz;this.attLocal[3*i+2]=R[2]*dx+R[5]*dy+R[8]*dz;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Energies and reports.
  // ---------------------------------------------------------------------------------------------
  kineticEnergy():number {let e=0;const v=this.velocities;for(let i=0;i<this.nodeCount;i++)e+=.5*this.masses[i]*(v[3*i]*v[3*i]+v[3*i+1]*v[3*i+1]+v[3*i+2]*v[3*i+2]);return e;}
  /** -sum m g.x, J. */
  gravitationalEnergy():number {let e=0;const x=this.positions,g=this.gravity;for(let i=0;i<this.nodeCount;i++)e-=this.masses[i]*(g[0]*x[3*i]+g[1]*x[3*i+1]+g[2]*x[3*i+2]);return e;}
  membraneEnergy():number {this.fabs.fill(0);return this.membrane(this.positions,null);}
  bendingEnergy():number {return this.bend(this.positions,null);}
  /** Elastic energy held in the contact springs (normal, stick and self-collision) after the last step, J. Small: force^2 / (2 stiffness) per contact. */
  contactEnergy():number {return this.energyStored;}
  /** Kinetic + membrane + bending + gravitational + contact-spring energy, J. */
  totalEnergy():number {return this.kineticEnergy()+this.membraneEnergy()+this.bendingEnergy()+this.gravitationalEnergy()+this.energyStored;}
  linearMomentum(out:number[]|Float64Array=[0,0,0]):number[]|Float64Array {
    out[0]=out[1]=out[2]=0;for(let i=0;i<this.nodeCount;i++)for(let k=0;k<3;k++)out[k]+=this.masses[i]*this.velocities[3*i+k];return out;
  }
  /** Sum of the support reactions, N. */
  totalReaction(out:number[]|Float64Array=[0,0,0]):number[]|Float64Array {
    out[0]=out[1]=out[2]=0;for(let i=0;i<this.nodeCount;i++)if(this.kind[i]===PINNED)for(let k=0;k<3;k++)out[k]+=this.reactions[3*i+k];return out;
  }
  /** Second Piola-Kirchhoff membrane stress resultants of a triangle in its rest axes (first axis along its first edge): [S11, S22, S12, E11, E22, E12], N/m and strain. */
  triangleStress(triangle:number,out:number[]|Float64Array=[0,0,0,0,0,0]):number[]|Float64Array {
    if(!Number.isInteger(triangle)||triangle<0||triangle>=this.triangleCount)fail(`${triangle} is not a triangle.`);
    const x=this.positions,tri=this.triangles,inv=this.triInv,k=triangle,a=3*tri[3*k],b=3*tri[3*k+1],c=3*tri[3*k+2],i0=inv[3*k],i1=inv[3*k+1],i2=inv[3*k+2];
    let e11=-.5,e22=-.5,e12=0;
    for(let d=0;d<3;d++){const u=x[b+d]-x[a+d],v=x[c+d]-x[a+d],f1=u*i0,f2=u*i1+v*i2;e11+=.5*f1*f1;e22+=.5*f2*f2;e12+=.5*f1*f2;}
    const nu=this.poissonRatio,Yv=this.membraneStiffness/(1-nu*nu);
    out[0]=Yv*(e11+nu*e22);out[1]=Yv*(e22+nu*e11);out[2]=Yv*(1-nu)*e12;out[3]=e11;out[4]=e22;out[5]=e12;return out;
  }
  /** Smallest distance between two parts of the cloth that do not share a node (node to triangle), m. O(nodes x triangles): for tests and reports. */
  minimumSelfDistance():number {
    const x=this.positions,tri=this.triangles,w=this.bary;let best=Infinity;
    for(let k=0;k<this.triangleCount;k++){
      const a=tri[3*k],b=tri[3*k+1],c=tri[3*k+2];
      for(let p=0;p<this.nodeCount;p++){
        if(p===a||p===b||p===c)continue;
        this.closestOnTriangle(x,p,a,b,c);
        let d2=0;for(let d=0;d<3;d++){const s=x[3*p+d]-w[0]*x[3*a+d]-w[1]*x[3*b+d]-w[2]*x[3*c+d];d2+=s*s;}
        if(d2<best)best=d2;
      }
    }
    return Math.sqrt(best);
  }

  // ---------------------------------------------------------------------------------------------
  // Elastic energies. Each returns its energy; with G it adds the gradient and stores the linearisation.
  // ---------------------------------------------------------------------------------------------
  private membrane(x:Float64Array,G:Float64Array|null):number {
    const fabs=this.fabs;let energy=0;
    if(this.membraneModel==='spring'){
      const edges=this.edges,rest=this.edgeRest,K=this.edgeK,lin=this.edgeLin;
      for(let e=0;e<this.edgeCount;e++){
        const a=3*edges[2*e],b=3*edges[2*e+1],dx=x[b]-x[a],dy=x[b+1]-x[a+1],dz=x[b+2]-x[a+2],l=Math.hypot(dx,dy,dz)||1e-300,s=l-rest[e],k=K[e];
        energy+=.5*k*s*s;
        if(G){
          const f=k*s/l;G[a]-=f*dx;G[a+1]-=f*dy;G[a+2]-=f*dz;G[b]+=f*dx;G[b+1]+=f*dy;G[b+2]+=f*dz;
          fabs[a/3]+=Math.abs(k*s);fabs[b/3]+=Math.abs(k*s);
          lin[4*e]=dx/l;lin[4*e+1]=dy/l;lin[4*e+2]=dz/l;lin[4*e+3]=Math.max(0,k*s/l);
        }
      }
      return energy;
    }
    const tri=this.triangles,inv=this.triInv,area=this.triArea,lin=this.triLin,nu=this.poissonRatio,Yv=this.membraneStiffness/(1-nu*nu),mu2=Yv*(1-nu);
    for(let k=0;k<this.triangleCount;k++){
      const a=3*tri[3*k],b=3*tri[3*k+1],c=3*tri[3*k+2],i0=inv[3*k],i1=inv[3*k+1],i2=inv[3*k+2],A=area[k];
      const ux=x[b]-x[a],uy=x[b+1]-x[a+1],uz=x[b+2]-x[a+2],vx=x[c]-x[a],vy=x[c+1]-x[a+1],vz=x[c+2]-x[a+2];
      const f1x=ux*i0,f1y=uy*i0,f1z=uz*i0,f2x=ux*i1+vx*i2,f2y=uy*i1+vy*i2,f2z=uz*i1+vz*i2;
      const e11=.5*(f1x*f1x+f1y*f1y+f1z*f1z-1),e22=.5*(f2x*f2x+f2y*f2y+f2z*f2z-1),e12=.5*(f1x*f2x+f1y*f2y+f1z*f2z);
      const s11=Yv*(e11+nu*e22),s22=Yv*(e22+nu*e11),s12=mu2*e12;
      energy+=.5*A*(s11*e11+s22*e22+2*s12*e12);
      if(!G)continue;
      // P = F S (3x2); force on node n is -A P g_n with g_b = (i0, i1), g_c = (0, i2), g_a = -g_b - g_c.
      const p1x=f1x*s11+f2x*s12,p1y=f1y*s11+f2y*s12,p1z=f1z*s11+f2z*s12,p2x=f1x*s12+f2x*s22,p2y=f1y*s12+f2y*s22,p2z=f1z*s12+f2z*s22;
      const bx=A*(p1x*i0+p2x*i1),by=A*(p1y*i0+p2y*i1),bz=A*(p1z*i0+p2z*i1),cx=A*p2x*i2,cy=A*p2y*i2,cz=A*p2z*i2;
      G[b]+=bx;G[b+1]+=by;G[b+2]+=bz;G[c]+=cx;G[c+1]+=cy;G[c+2]+=cz;G[a]-=bx+cx;G[a+1]-=by+cy;G[a+2]-=bz+cz;
      const nb=Math.abs(bx)+Math.abs(by)+Math.abs(bz),nc=Math.abs(cx)+Math.abs(cy)+Math.abs(cz);fabs[b/3]+=nb;fabs[c/3]+=nc;fabs[a/3]+=nb+nc;
      // Stress with its compressive part removed, for a positive-definite geometric stiffness.
      const mean=.5*(s11+s22),dev=Math.hypot(.5*(s11-s22),s12),hi=mean+dev,lo=mean-dev;
      let t11=s11,t22=s22,t12=s12;
      if(hi<=0){t11=t22=t12=0;}
      else if(lo<0){
        // Keep hi along its eigenvector (cos, sin).
        const ex=s12,ey=hi-s11,el=Math.hypot(ex,ey);let cx2=1,sx2=0;
        if(el>1e-300){cx2=ex/el;sx2=ey/el;}else if(s22>s11){cx2=0;sx2=1;}
        t11=hi*cx2*cx2;t22=hi*sx2*sx2;t12=hi*cx2*sx2;
      }
      const o=9*k;lin[o]=f1x;lin[o+1]=f1y;lin[o+2]=f1z;lin[o+3]=f2x;lin[o+4]=f2y;lin[o+5]=f2z;lin[o+6]=t11;lin[o+7]=t22;lin[o+8]=t12;
    }
    return energy;
  }
  private membraneProduct(p:Float64Array,out:Float64Array):void {
    if(this.membraneModel==='spring'){
      const edges=this.edges,K=this.edgeK,lin=this.edgeLin;
      for(let e=0;e<this.edgeCount;e++){
        const a=3*edges[2*e],b=3*edges[2*e+1],dx=p[b]-p[a],dy=p[b+1]-p[a+1],dz=p[b+2]-p[a+2],nx=lin[4*e],ny=lin[4*e+1],nz=lin[4*e+2],g=lin[4*e+3];
        const along=(K[e]-g)*(dx*nx+dy*ny+dz*nz),fx=along*nx+g*dx,fy=along*ny+g*dy,fz=along*nz+g*dz;
        out[a]-=fx;out[a+1]-=fy;out[a+2]-=fz;out[b]+=fx;out[b+1]+=fy;out[b+2]+=fz;
      }
      return;
    }
    const tri=this.triangles,inv=this.triInv,area=this.triArea,lin=this.triLin,nu=this.poissonRatio,Yv=this.membraneStiffness/(1-nu*nu),mu2=Yv*(1-nu);
    for(let k=0;k<this.triangleCount;k++){
      const a=3*tri[3*k],b=3*tri[3*k+1],c=3*tri[3*k+2],i0=inv[3*k],i1=inv[3*k+1],i2=inv[3*k+2],A=area[k],o=9*k;
      const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
      const d1x=ux*i0,d1y=uy*i0,d1z=uz*i0,d2x=ux*i1+vx*i2,d2y=uy*i1+vy*i2,d2z=uz*i1+vz*i2;
      const f1x=lin[o],f1y=lin[o+1],f1z=lin[o+2],f2x=lin[o+3],f2y=lin[o+4],f2z=lin[o+5],t11=lin[o+6],t22=lin[o+7],t12=lin[o+8];
      const e11=f1x*d1x+f1y*d1y+f1z*d1z,e22=f2x*d2x+f2y*d2y+f2z*d2z,e12=.5*(f1x*d2x+f1y*d2y+f1z*d2z+f2x*d1x+f2y*d1y+f2z*d1z);
      const s11=Yv*(e11+nu*e22),s22=Yv*(e22+nu*e11),s12=mu2*e12;
      const p1x=d1x*t11+d2x*t12+f1x*s11+f2x*s12,p1y=d1y*t11+d2y*t12+f1y*s11+f2y*s12,p1z=d1z*t11+d2z*t12+f1z*s11+f2z*s12;
      const p2x=d1x*t12+d2x*t22+f1x*s12+f2x*s22,p2y=d1y*t12+d2y*t22+f1y*s12+f2y*s22,p2z=d1z*t12+d2z*t22+f1z*s12+f2z*s22;
      const bx=A*(p1x*i0+p2x*i1),by=A*(p1y*i0+p2y*i1),bz=A*(p1z*i0+p2z*i1),cx=A*p2x*i2,cy=A*p2y*i2,cz=A*p2z*i2;
      out[b]+=bx;out[b+1]+=by;out[b+2]+=bz;out[c]+=cx;out[c+1]+=cy;out[c+2]+=cz;out[a]-=bx+cx;out[a+1]-=by+cy;out[a+2]-=bz+cz;
    }
  }
  private membraneDiagonal():void {
    const D=this.diag;
    if(this.membraneModel==='spring'){
      const edges=this.edges,K=this.edgeK,lin=this.edgeLin;
      for(let e=0;e<this.edgeCount;e++){
        const nx=lin[4*e],ny=lin[4*e+1],nz=lin[4*e+2],g=lin[4*e+3],s=K[e]-g;
        for(let q=0;q<2;q++){const o=6*edges[2*e+q];D[o]+=s*nx*nx+g;D[o+1]+=s*nx*ny;D[o+2]+=s*nx*nz;D[o+3]+=s*ny*ny+g;D[o+4]+=s*ny*nz;D[o+5]+=s*nz*nz+g;}
      }
      return;
    }
    const tri=this.triangles,inv=this.triInv,area=this.triArea,lin=this.triLin,nu=this.poissonRatio,Yv=this.membraneStiffness/(1-nu*nu),mu=.5*Yv*(1-nu);
    for(let k=0;k<this.triangleCount;k++){
      const i0=inv[3*k],i1=inv[3*k+1],i2=inv[3*k+2],A=area[k],o=9*k;
      const f1x=lin[o],f1y=lin[o+1],f1z=lin[o+2],f2x=lin[o+3],f2y=lin[o+4],f2z=lin[o+5],t11=lin[o+6],t22=lin[o+7],t12=lin[o+8];
      for(let q=0;q<3;q++){
        const g1=q===0?-i0:q===1?i0:0,g2=q===0?-i1-i2:q===1?i1:i2,d=6*tri[3*k+q];
        const c11=A*(Yv*g1*g1+mu*g2*g2),c22=A*(Yv*g2*g2+mu*g1*g1),c12=A*(Yv*nu+mu)*g1*g2,geo=A*(t11*g1*g1+2*t12*g1*g2+t22*g2*g2);
        D[d]+=c11*f1x*f1x+c22*f2x*f2x+2*c12*f1x*f2x+geo;
        D[d+1]+=c11*f1x*f1y+c22*f2x*f2y+c12*(f1x*f2y+f2x*f1y);
        D[d+2]+=c11*f1x*f1z+c22*f2x*f2z+c12*(f1x*f2z+f2x*f1z);
        D[d+3]+=c11*f1y*f1y+c22*f2y*f2y+2*c12*f1y*f2y+geo;
        D[d+4]+=c11*f1y*f1z+c22*f2y*f2z+c12*(f1y*f2z+f2y*f1z);
        D[d+5]+=c11*f1z*f1z+c22*f2z*f2z+2*c12*f1z*f2z+geo;
      }
    }
  }
  /** Dihedral angle of a hinge; with `store`, its gradient goes to hingeGrad. */
  private dihedral(x:Float64Array,hh:number,store:boolean):number {
    const hinge=this.hinge,i0=3*hinge[4*hh],i1=3*hinge[4*hh+1],i2=3*hinge[4*hh+2],i3=3*hinge[4*hh+3];
    const ex=x[i1]-x[i0],ey=x[i1+1]-x[i0+1],ez=x[i1+2]-x[i0+2];
    const ax=x[i2]-x[i0],ay=x[i2+1]-x[i0+1],az=x[i2+2]-x[i0+2],bx=x[i3]-x[i0],by=x[i3+1]-x[i0+1],bz=x[i3+2]-x[i0+2];
    // nA = e x a, nB = b x e: both along the surface normal of a flat, consistently oriented pair.
    const nAx=ey*az-ez*ay,nAy=ez*ax-ex*az,nAz=ex*ay-ey*ax,nBx=by*ez-bz*ey,nBy=bz*ex-bx*ez,nBz=bx*ey-by*ex;
    const le=Math.hypot(ex,ey,ez)||1e-300,cx=nAy*nBz-nAz*nBy,cy=nAz*nBx-nAx*nBz,cz=nAx*nBy-nAy*nBx;
    const theta=Math.atan2((cx*ex+cy*ey+cz*ez)/le,nAx*nBx+nAy*nBy+nAz*nBz);
    if(store){
      const g=this.hingeGrad,o=12*hh,qa=le/(nAx*nAx+nAy*nAy+nAz*nAz||1e-300),qb=le/(nBx*nBx+nBy*nBy+nBz*nBz||1e-300);
      // d theta / d x2 = -|e| nA / |nA|^2, d theta / d x3 = -|e| nB / |nB|^2; the edge nodes take the rest so that the sum and the moment vanish.
      const ta=(ax*ex+ay*ey+az*ez)/(le*le),tb=(bx*ex+by*ey+bz*ez)/(le*le);
      const g2x=-qa*nAx,g2y=-qa*nAy,g2z=-qa*nAz,g3x=-qb*nBx,g3y=-qb*nBy,g3z=-qb*nBz;
      g[o+6]=g2x;g[o+7]=g2y;g[o+8]=g2z;g[o+9]=g3x;g[o+10]=g3y;g[o+11]=g3z;
      g[o+3]=-ta*g2x-tb*g3x;g[o+4]=-ta*g2y-tb*g3y;g[o+5]=-ta*g2z-tb*g3z;
      g[o]=-(1-ta)*g2x-(1-tb)*g3x;g[o+1]=-(1-ta)*g2y-(1-tb)*g3y;g[o+2]=-(1-ta)*g2z-(1-tb)*g3z;
    }
    return theta;
  }
  private bend(x:Float64Array,G:Float64Array|null):number {
    const H=this.hingeCount;if(H===0)return 0;
    const phi=this.hingePhi,rest=this.hingeRest,nbr=this.hingeNbr,B=this.hingeB,hinge=this.hinge,grad=this.hingeGrad;
    for(let hh=0;hh<H;hh++){let d=this.dihedral(x,hh,G!==null)-rest[hh];if(d>Math.PI)d-=2*Math.PI;else if(d<-Math.PI)d+=2*Math.PI;phi[hh]=d;}
    let energy=0;
    for(let hh=0;hh<H;hh++){
      let m=B[5*hh]*phi[hh];
      for(let s=0;s<4;s++){const f=nbr[4*hh+s];if(f>=0)m+=B[5*hh+1+s]*phi[f];}
      energy+=.5*m*phi[hh];
      if(G)for(let q=0;q<4;q++){const n=3*hinge[4*hh+q],o=12*hh+3*q;G[n]+=m*grad[o];G[n+1]+=m*grad[o+1];G[n+2]+=m*grad[o+2];}
    }
    return energy;
  }
  /** Gauss-Newton bending stiffness: J^T B J with J the angle gradients. The second derivative of the angle is left out. */
  private bendProduct(p:Float64Array,out:Float64Array):void {
    const H=this.hingeCount;if(H===0)return;
    const a=this.hingePhi,nbr=this.hingeNbr,B=this.hingeB,hinge=this.hinge,grad=this.hingeGrad;
    for(let hh=0;hh<H;hh++){
      let s=0;
      for(let q=0;q<4;q++){const n=3*hinge[4*hh+q],o=12*hh+3*q;s+=grad[o]*p[n]+grad[o+1]*p[n+1]+grad[o+2]*p[n+2];}
      a[hh]=s;
    }
    for(let hh=0;hh<H;hh++){
      let m=B[5*hh]*a[hh];
      for(let s=0;s<4;s++){const f=nbr[4*hh+s];if(f>=0)m+=B[5*hh+1+s]*a[f];}
      for(let q=0;q<4;q++){const n=3*hinge[4*hh+q],o=12*hh+3*q;out[n]+=m*grad[o];out[n+1]+=m*grad[o+1];out[n+2]+=m*grad[o+2];}
    }
  }
  private bendDiagonal():void {
    const D=this.diag,B=this.hingeB,hinge=this.hinge,grad=this.hingeGrad;
    for(let hh=0;hh<this.hingeCount;hh++){
      const k=B[5*hh];
      for(let q=0;q<4;q++){const d=6*hinge[4*hh+q],o=12*hh+3*q,gx=grad[o],gy=grad[o+1],gz=grad[o+2];D[d]+=k*gx*gx;D[d+1]+=k*gx*gy;D[d+2]+=k*gx*gz;D[d+3]+=k*gy*gy;D[d+4]+=k*gy*gz;D[d+5]+=k*gz*gz;}
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Contact with rigid bodies.
  // ---------------------------------------------------------------------------------------------
  /** Signed distance of a point in the body's own axes; the outward normal goes to this.sn. */
  private sdf(b:ClothBody,px:number,py:number,pz:number):number {
    const n=this.sn,d=b.dim;
    if(b.shape===3){n[0]=d[0];n[1]=d[1];n[2]=d[2];return px*d[0]+py*d[1]+pz*d[2];}
    if(b.shape===1||b.shape===2){
      if(b.shape===2)py-=py>d[1]?d[1]:py<-d[1]?-d[1]:py;
      const l=Math.hypot(px,py,pz);
      if(l>1e-12){n[0]=px/l;n[1]=py/l;n[2]=pz/l;}else{n[0]=1;n[1]=0;n[2]=0;}
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
  private contactStiffness(i:number):number {return this.contactK??(10*this.youngT+100*this.masses[i]*this.ih2);}
  private newSlot(i:number,bi:number):number {
    for(let s=0;s<SLOTS;s++)if(this.cBody[SLOTS*i+s]===bi)return SLOTS*i+s;
    for(let s=0;s<SLOTS;s++)if(this.cBody[SLOTS*i+s]<0){
      const slot=SLOTS*i+s,o=14*slot;this.cBody[slot]=bi;this.cData[o+9]=NaN;this.cData[o+12]=0;return slot;
    }
    return -1;
  }
  /** Write a slot's plane: normal and surface point in the body's own axes; the friction anchor is kept if it has one. */
  private setPlane(slot:number,nx:number,ny:number,nz:number,qx:number,qy:number,qz:number,ax:number,ay:number,az:number):void {
    const c=this.cData,o=14*slot;
    c[o]=nx;c[o+1]=ny;c[o+2]=nz;c[o+3]=qx;c[o+4]=qy;c[o+5]=qz;
    if(Number.isNaN(c[o+9])){c[o+9]=ax;c[o+10]=ay;c[o+11]=az;}
    this.cKeep[slot]=1;
  }
  /** Start of a step: contact planes for the nodes that are within the skin of a body; other slots are dropped. */
  private beginContacts():void {
    const n=this.nodeCount,x=this.x0,keep=this.cKeep,cBody=this.cBody,sn=this.sn,reach=this.contactOffset+this.contactSkin;
    keep.fill(0);
    for(let bi=0;bi<this.bodies.length;bi++){
      const b=this.bodies[bi];if(!b.collide)continue;
      const R=b.R,far=b.bound+reach,far2=far*far;
      for(let i=0;i<n;i++){
        if(this.kind[i]!==FREE)continue;
        const dx=x[3*i]-b.x[0],dy=x[3*i+1]-b.x[1],dz=x[3*i+2]-b.x[2];
        if(dx*dx+dy*dy+dz*dz>far2)continue;
        const lx=R[0]*dx+R[3]*dy+R[6]*dz,ly=R[1]*dx+R[4]*dy+R[7]*dz,lz=R[2]*dx+R[5]*dy+R[8]*dz,phi=this.sdf(b,lx,ly,lz);
        if(phi-this.contactOffset>=this.contactSkin)continue;
        const slot=this.newSlot(i,bi);if(slot<0)continue;
        this.setPlane(slot,sn[0],sn[1],sn[2],lx-phi*sn[0],ly-phi*sn[1],lz-phi*sn[2],lx,ly,lz);
      }
    }
    for(let s=0;s<SLOTS*n;s++)if(!keep[s])cBody[s]=-1;
  }
  /** During the solve: a node whose path relative to a body enters it gets a plane where it enters. Returns the number added. */
  private detectContacts(y:Float64Array):number {
    const n=this.nodeCount,x0=this.x0,sn=this.sn,off=this.contactOffset,tail=3*n;let added=0;
    for(let bi=0;bi<this.bodies.length;bi++){
      const b=this.bodies[bi];if(!b.collide)continue;
      const R=b.R,t=tail+6*bi,cx=b.x[0]+y[t],cy=b.x[1]+y[t+1],cz=b.x[2]+y[t+2],tx=y[t+3],ty=y[t+4],tz=y[t+5];
      const moved=Math.hypot(y[t],y[t+1],y[t+2])+Math.hypot(tx,ty,tz)*b.bound;
      for(let i=0;i<n;i++){
        if(this.kind[i]!==FREE)continue;
        if(this.cBody[SLOTS*i]===bi||this.cBody[SLOTS*i+1]===bi)continue;
        const ex=y[3*i]-cx,ey=y[3*i+1]-cy,ez=y[3*i+2]-cz;
        if(b.shape!==3){
          const far=b.bound+off+moved+Math.hypot(y[3*i]-x0[3*i],y[3*i+1]-x0[3*i+1],y[3*i+2]-x0[3*i+2]);
          if(ex*ex+ey*ey+ez*ez>far*far)continue;
        }
        // Body-frame coordinates at the start and now (rotation linearised: s = e - theta x e).
        const sx=ex-(ty*ez-tz*ey),sy=ey-(tz*ex-tx*ez),sz=ez-(tx*ey-ty*ex);
        const ax=x0[3*i]-b.x[0],ay=x0[3*i+1]-b.x[1],az=x0[3*i+2]-b.x[2];
        const p0x=R[0]*ax+R[3]*ay+R[6]*az,p0y=R[1]*ax+R[4]*ay+R[7]*az,p0z=R[2]*ax+R[5]*ay+R[8]*az;
        const p1x=R[0]*sx+R[3]*sy+R[6]*sz,p1y=R[1]*sx+R[4]*sy+R[7]*sz,p1z=R[2]*sx+R[5]*sy+R[8]*sz;
        const dx=p1x-p0x,dy=p1y-p0y,dz=p1z-p0z,len=Math.hypot(dx,dy,dz);
        // Sphere tracing: the signed distance is 1-Lipschitz, so stepping by it never jumps over the surface.
        let s=0,px=p0x,py=p0y,pz=p0z,phi=this.sdf(b,px,py,pz)-off,hit=phi<1e-9;
        for(let it=0;!hit&&it<48&&len>0;it++){
          s+=phi/len;if(s>=1)break;
          px=p0x+s*dx;py=p0y+s*dy;pz=p0z+s*dz;phi=this.sdf(b,px,py,pz)-off;hit=phi<1e-7*(1+b.dim[0]);
        }
        if(!hit){phi=this.sdf(b,p1x,p1y,p1z)-off;if(phi>=0)continue;px=p1x;py=p1y;pz=p1z;}
        const slot=this.newSlot(i,bi);if(slot<0)continue;
        const d=phi+off;
        this.setPlane(slot,sn[0],sn[1],sn[2],px-d*sn[0],py-d*sn[1],pz-d*sn[2],px,py,pz);added++;
      }
    }
    return added;
  }
  /** Contact energy: a one-sided spring along each plane's normal and a stick spring across it, capped at mu times the normal force of the last iterate. */
  private contacts(y:Float64Array,G:Float64Array|null):number {
    const n=this.nodeCount,cBody=this.cBody,c=this.cData,lin=this.cLin,off=this.contactOffset,tail=3*n;let energy=0;
    for(let slot=0;slot<SLOTS*n;slot++){
      const bi=cBody[slot];if(bi<0)continue;
      const i=(slot/SLOTS)|0,b=this.bodies[bi],R=b.R,o=14*slot,l=12*slot,t=tail+6*bi,k=this.contactStiffness(i);
      const tx=y[t+3],ty=y[t+4],tz=y[t+5];
      // Plane in world axes at the start of the step.
      const nx=R[0]*c[o]+R[1]*c[o+1]+R[2]*c[o+2],ny=R[3]*c[o]+R[4]*c[o+1]+R[5]*c[o+2],nz=R[6]*c[o]+R[7]*c[o+1]+R[8]*c[o+2];
      const qx=R[0]*c[o+3]+R[1]*c[o+4]+R[2]*c[o+5],qy=R[3]*c[o+3]+R[4]*c[o+4]+R[5]*c[o+5],qz=R[6]*c[o+3]+R[7]*c[o+4]+R[8]*c[o+5];
      const ex=y[3*i]-b.x[0]-y[t],ey=y[3*i+1]-b.x[1]-y[t+1],ez=y[3*i+2]-b.x[2]-y[t+2];
      const sx=ex-(ty*ez-tz*ey),sy=ey-(tz*ex-tx*ez),sz=ez-(tx*ey-ty*ex);
      const d=nx*(sx-qx)+ny*(sy-qy)+nz*(sz-qz)-off;
      // n(theta) = n + theta x n, and n x e for the torque.
      const mx=nx+(ty*nz-tz*ny),my=ny+(tz*nx-tx*nz),mz=nz+(tx*ny-ty*nx),rx=ny*ez-nz*ey,ry=nz*ex-nx*ez,rz=nx*ey-ny*ex;
      c[o+13]=d;
      if(G){lin[l]=d<0?k:0;lin[l+1]=mx;lin[l+2]=my;lin[l+3]=mz;lin[l+4]=rx;lin[l+5]=ry;lin[l+6]=rz;lin[l+7]=0;lin[l+8]=0;}
      if(d<0){
        energy+=.5*k*d*d;this.energyStored+=.5*k*d*d;
        if(G){
          const f=k*d;G[3*i]+=f*mx;G[3*i+1]+=f*my;G[3*i+2]+=f*mz;G[t]-=f*mx;G[t+1]-=f*my;G[t+2]-=f*mz;G[t+3]+=f*rx;G[t+4]+=f*ry;G[t+5]+=f*rz;
        }
      }
      const cap=b.friction*c[o+12];
      if(!(cap>0))continue;
      // Tangential offset from the anchor, in the body frame.
      const ax=R[0]*c[o+9]+R[1]*c[o+10]+R[2]*c[o+11],ay=R[3]*c[o+9]+R[4]*c[o+10]+R[5]*c[o+11],az=R[6]*c[o+9]+R[7]*c[o+10]+R[8]*c[o+11];
      let wx=sx-ax,wy=sy-ay,wz=sz-az;const wn=wx*nx+wy*ny+wz*nz;wx-=wn*nx;wy-=wn*ny;wz-=wn*nz;
      const w=Math.hypot(wx,wy,wz);
      if(w===0)continue;
      let fx:number,fy:number,fz:number;
      this.energyStored+=k*w<=cap?.5*k*w*w:.5*cap*cap/k;
      if(k*w<=cap){energy+=.5*k*w*w;fx=k*wx;fy=k*wy;fz=k*wz;if(G){lin[l+7]=k;lin[l+8]=0;}}
      else{energy+=cap*w-.5*cap*cap/k;fx=cap*wx/w;fy=cap*wy/w;fz=cap*wz/w;if(G){lin[l+7]=cap/w;lin[l+8]=-cap/w;lin[l+9]=wx/w;lin[l+10]=wy/w;lin[l+11]=wz/w;}}
      if(G){
        // Node: (1 + [theta]x) f. Body: the opposite force, and the torque f x e.
        const gx=fx+(ty*fz-tz*fy),gy=fy+(tz*fx-tx*fz),gz=fz+(tx*fy-ty*fx);
        G[3*i]+=gx;G[3*i+1]+=gy;G[3*i+2]+=gz;G[t]-=gx;G[t+1]-=gy;G[t+2]-=gz;
        G[t+3]+=fy*ez-fz*ey;G[t+4]+=fz*ex-fx*ez;G[t+5]+=fx*ey-fy*ex;
      }
    }
    return energy;
  }
  private contactProduct(p:Float64Array,out:Float64Array):void {
    const n=this.nodeCount,cBody=this.cBody,c=this.cData,lin=this.cLin,y=this.y,tail=3*n;
    for(let slot=0;slot<SLOTS*n;slot++){
      const bi=cBody[slot];if(bi<0)continue;
      const l=12*slot,k=lin[l],a=lin[l+7];if(k===0&&a===0)continue;
      const i=(slot/SLOTS)|0,b=this.bodies[bi],t=tail+6*bi;
      const dx=p[3*i]-p[t],dy=p[3*i+1]-p[t+1],dz=p[3*i+2]-p[t+2],ox=p[t+3],oy=p[t+4],oz=p[t+5];
      if(k!==0){
        const mx=lin[l+1],my=lin[l+2],mz=lin[l+3],rx=lin[l+4],ry=lin[l+5],rz=lin[l+6],f=k*(mx*dx+my*dy+mz*dz+rx*ox+ry*oy+rz*oz);
        out[3*i]+=f*mx;out[3*i+1]+=f*my;out[3*i+2]+=f*mz;out[t]-=f*mx;out[t+1]-=f*my;out[t+2]-=f*mz;out[t+3]+=f*rx;out[t+4]+=f*ry;out[t+5]+=f*rz;
      }
      if(a!==0){
        const R=b.R,o=14*slot,nx=R[0]*c[o]+R[1]*c[o+1]+R[2]*c[o+2],ny=R[3]*c[o]+R[4]*c[o+1]+R[5]*c[o+2],nz=R[6]*c[o]+R[7]*c[o+1]+R[8]*c[o+2];
        const tx=y[t+3],ty=y[t+4],tz=y[t+5],ex=y[3*i]-b.x[0]-y[t],ey=y[3*i+1]-b.x[1]-y[t+1],ez=y[3*i+2]-b.x[2]-y[t+2];
        // ds = d - theta x d + e x omega, then its tangential part.
        let sx=dx-(ty*dz-tz*dy)+(ey*oz-ez*oy),sy=dy-(tz*dx-tx*dz)+(ez*ox-ex*oz),sz=dz-(tx*dy-ty*dx)+(ex*oy-ey*ox);
        const sn=sx*nx+sy*ny+sz*nz;sx-=sn*nx;sy-=sn*ny;sz-=sn*nz;
        const bb=lin[l+8],along=bb*(lin[l+9]*sx+lin[l+10]*sy+lin[l+11]*sz),fx=a*sx+along*lin[l+9],fy=a*sy+along*lin[l+10],fz=a*sz+along*lin[l+11];
        const gx=fx+(ty*fz-tz*fy),gy=fy+(tz*fx-tx*fz),gz=fz+(tx*fy-ty*fx);
        out[3*i]+=gx;out[3*i+1]+=gy;out[3*i+2]+=gz;out[t]-=gx;out[t+1]-=gy;out[t+2]-=gz;
        out[t+3]+=fy*ez-fz*ey;out[t+4]+=fz*ex-fx*ez;out[t+5]+=fx*ey-fy*ex;
      }
    }
  }
  private contactDiagonal():void {
    const n=this.nodeCount,cBody=this.cBody,lin=this.cLin,D=this.diag,BD=this.bodyDiag,y=this.y,tail=3*n;
    for(let slot=0;slot<SLOTS*n;slot++){
      const bi=cBody[slot];if(bi<0)continue;
      const l=12*slot,k=lin[l],a=lin[l+7];if(k===0&&a===0)continue;
      const i=(slot/SLOTS)|0,d=6*i,bd=12*bi,mx=lin[l+1],my=lin[l+2],mz=lin[l+3],rx=lin[l+4],ry=lin[l+5],rz=lin[l+6];
      D[d]+=k*mx*mx+a;D[d+1]+=k*mx*my;D[d+2]+=k*mx*mz;D[d+3]+=k*my*my+a;D[d+4]+=k*my*mz;D[d+5]+=k*mz*mz+a;
      BD[bd]+=k*mx*mx+a;BD[bd+1]+=k*mx*my;BD[bd+2]+=k*mx*mz;BD[bd+3]+=k*my*my+a;BD[bd+4]+=k*my*mz;BD[bd+5]+=k*mz*mz+a;
      const b=this.bodies[bi],t=tail+6*bi,ex=y[3*i]-b.x[0]-y[t],ey=y[3*i+1]-b.x[1]-y[t+1],ez=y[3*i+2]-b.x[2]-y[t+2],e2=ex*ex+ey*ey+ez*ez;
      BD[bd+6]+=k*rx*rx+a*(e2-ex*ex);BD[bd+7]+=k*rx*ry-a*ex*ey;BD[bd+8]+=k*rx*rz-a*ex*ez;BD[bd+9]+=k*ry*ry+a*(e2-ey*ey);BD[bd+10]+=k*ry*rz-a*ey*ez;BD[bd+11]+=k*rz*rz+a*(e2-ez*ez);
    }
  }
  /** After an iterate: the normal force of every contact becomes the friction cap of the next. Returns the largest change of a friction limit, N. */
  private updateFrictionCaps():number {
    const n=this.nodeCount,cBody=this.cBody,c=this.cData;let change=0;
    for(let slot=0;slot<SLOTS*n;slot++){
      if(cBody[slot]<0)continue;
      const o=14*slot,d=c[o+13],force=d<0?-this.contactStiffness((slot/SLOTS)|0)*d:0,mu=this.bodies[cBody[slot]].friction;
      if(mu>0)change=Math.max(change,mu*Math.abs(force-c[o+12]));
      c[o+12]=force;
    }
    return change;
  }
  /** End of a step: a contact that slid drags its anchor along, so that the stick spring stays at the friction limit. */
  private endContacts():void {
    const n=this.nodeCount,cBody=this.cBody,c=this.cData,y=this.y,tail=3*n;let pressing=0;
    for(let bi=0;bi<this.bodies.length;bi++)this.bodies[bi].contacts=0;
    for(let slot=0;slot<SLOTS*n;slot++){
      const bi=cBody[slot];if(bi<0)continue;
      const i=(slot/SLOTS)|0,b=this.bodies[bi],R=b.R,o=14*slot,t=tail+6*bi,k=this.contactStiffness(i);
      if(c[o+13]<0){b.contacts++;pressing++;}
      const tx=y[t+3],ty=y[t+4],tz=y[t+5],ex=y[3*i]-b.x[0]-y[t],ey=y[3*i+1]-b.x[1]-y[t+1],ez=y[3*i+2]-b.x[2]-y[t+2];
      const sx=ex-(ty*ez-tz*ey),sy=ey-(tz*ex-tx*ez),sz=ez-(tx*ey-ty*ex);
      // Body-local coordinates of the node, and of its offset from the anchor.
      const lx=R[0]*sx+R[3]*sy+R[6]*sz,ly=R[1]*sx+R[4]*sy+R[7]*sz,lz=R[2]*sx+R[5]*sy+R[8]*sz;
      const cap=b.friction*c[o+12];
      if(!(cap>0)||c[o+13]>=0){c[o+9]=lx;c[o+10]=ly;c[o+11]=lz;continue;}
      let wx=lx-c[o+9],wy=ly-c[o+10],wz=lz-c[o+11];const wn=wx*c[o]+wy*c[o+1]+wz*c[o+2];wx-=wn*c[o];wy-=wn*c[o+1];wz-=wn*c[o+2];
      const w=Math.hypot(wx,wy,wz);
      if(k*w>cap){const s=1-cap/(k*w);c[o+9]+=s*wx;c[o+10]+=s*wy;c[o+11]+=s*wz;}
    }
    this.stats.contacts=pressing;
  }

  // ---------------------------------------------------------------------------------------------
  // Self-collision.
  // ---------------------------------------------------------------------------------------------
  private closestOnTriangle(x:Float64Array,p:number,a:number,b:number,c:number):void {
    const w=this.bary,pa=3*a,pb=3*b,pc=3*c,pp=3*p;
    const abx=x[pb]-x[pa],aby=x[pb+1]-x[pa+1],abz=x[pb+2]-x[pa+2],acx=x[pc]-x[pa],acy=x[pc+1]-x[pa+1],acz=x[pc+2]-x[pa+2];
    const apx=x[pp]-x[pa],apy=x[pp+1]-x[pa+1],apz=x[pp+2]-x[pa+2],d1=abx*apx+aby*apy+abz*apz,d2=acx*apx+acy*apy+acz*apz;
    if(d1<=0&&d2<=0){w[0]=1;w[1]=0;w[2]=0;return;}
    const bpx=x[pp]-x[pb],bpy=x[pp+1]-x[pb+1],bpz=x[pp+2]-x[pb+2],d3=abx*bpx+aby*bpy+abz*bpz,d4=acx*bpx+acy*bpy+acz*bpz;
    if(d3>=0&&d4<=d3){w[0]=0;w[1]=1;w[2]=0;return;}
    const vc=d1*d4-d3*d2;
    if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);w[0]=1-v;w[1]=v;w[2]=0;return;}
    const cpx=x[pp]-x[pc],cpy=x[pp+1]-x[pc+1],cpz=x[pp+2]-x[pc+2],d5=abx*cpx+aby*cpy+abz*cpz,d6=acx*cpx+acy*cpy+acz*cpz;
    if(d6>=0&&d5<=d6){w[0]=0;w[1]=0;w[2]=1;return;}
    const vb=d5*d2-d1*d6;
    if(vb<=0&&d2>=0&&d6<=0){const v=d2/(d2-d6);w[0]=1-v;w[1]=0;w[2]=v;return;}
    const va=d3*d6-d5*d4;
    if(va<=0&&d4-d3>=0&&d5-d6>=0){const v=(d4-d3)/(d4-d3+d5-d6);w[0]=0;w[1]=1-v;w[2]=v;return;}
    const s=1/(va+vb+vc);w[1]=vb*s;w[2]=vc*s;w[0]=1-w[1]-w[2];
  }
  private cellOf(x:number,y:number,z:number,inverse:number):number {
    return (Math.imul(Math.floor(x*inverse),73856093)^Math.imul(Math.floor(y*inverse),19349663)^Math.imul(Math.floor(z*inverse),83492791))&this.cellMask;
  }
  /** Store a pair of four nodes with weights summing to zero (d = sum w x is the vector between the two closest points) if it is closer than the thickness or has changed sides since the start of the step. */
  private addPair(y:Float64Array,key:number,i0:number,i1:number,i2:number,i3:number,w0:number,w1:number,w2:number,w3:number,reach2:number):number {
    const x0=this.x0;let dx=0,dy=0,dz=0,sx=0,sy=0,sz=0;
    dx=w0*y[3*i0]+w1*y[3*i1]+w2*y[3*i2]+w3*y[3*i3];dy=w0*y[3*i0+1]+w1*y[3*i1+1]+w2*y[3*i2+1]+w3*y[3*i3+1];dz=w0*y[3*i0+2]+w1*y[3*i1+2]+w2*y[3*i2+2]+w3*y[3*i3+2];
    const d2=dx*dx+dy*dy+dz*dz;if(d2>=reach2)return 0;
    sx=w0*x0[3*i0]+w1*x0[3*i1]+w2*x0[3*i2]+w3*x0[3*i3];sy=w0*x0[3*i0+1]+w1*x0[3*i1+1]+w2*x0[3*i2+1]+w3*x0[3*i3+1];sz=w0*x0[3*i0+2]+w1*x0[3*i1+2]+w2*x0[3*i2+2]+w3*x0[3*i3+2];
    // Kept from 1.4 thicknesses: a pair is then already listed when it comes within the thickness between two searches.
    const crossed=dx*sx+dy*sy+dz*sz<0,near=1.4*this.selfThickness;
    if(!crossed&&d2>=near*near)return 0;
    // Deduplicate.
    const keys=this.pairKeys,mask=keys.length-1;let slot=(Math.imul(key|0,-1640531527)^Math.imul((key/4294967296)|0,40503))&mask;
    while(keys[slot]!==0){if(keys[slot]===key+1)return 0;slot=(slot+1)&mask;}
    if(this.pairCount>=this.pairCap){this.stats.droppedPairs++;return 0;}
    keys[slot]=key+1;
    const q=this.pairCount++,d=Math.sqrt(d2),s=Math.hypot(sx,sy,sz);
    let nx:number,ny:number,nz:number;
    if(d>1e-12){const sign=crossed?-1/d:1/d;nx=dx*sign;ny=dy*sign;nz=dz*sign;}
    else if(s>1e-12){nx=sx/s;ny=sy/s;nz=sz/s;}
    else{nx=0;ny=1;nz=0;}
    this.pairNodes[4*q]=i0;this.pairNodes[4*q+1]=i1;this.pairNodes[4*q+2]=i2;this.pairNodes[4*q+3]=i3;
    this.pairW[4*q]=w0;this.pairW[4*q+1]=w1;this.pairW[4*q+2]=w2;this.pairW[4*q+3]=w3;this.pairN[3*q]=nx;this.pairN[3*q+1]=ny;this.pairN[3*q+2]=nz;this.pairOn[q]=0;
    return 1;
  }
  /** Find point-triangle and edge-edge pairs near each other in the iterate. Pairs are only added during a step. */
  private detectSelf(y:Float64Array):number {
    const n=this.nodeCount,tau=this.selfThickness,x0=this.x0,start=this.cellStart,nodes=this.cellNodes,tri=this.triangles,edges=this.edges,w=this.bary;
    let moved=0;
    for(let i=0;i<3*n;i++){const d=Math.abs(y[i]-x0[i]);if(d>moved)moved=d;}
    // Search distance: the thickness, plus the room a pair can have crossed in this step.
    const reach=1.4*tau+Math.min(2*1.7320508*moved,this.maxEdge),reach2=reach*reach,size=Math.max(this.maxEdge,2*reach),inverse=1/size;
    // Counting sort of the nodes by cell (ascending node index inside a cell).
    start.fill(0);
    for(let i=0;i<n;i++)start[this.cellOf(y[3*i],y[3*i+1],y[3*i+2],inverse)+1]++;
    for(let c=0;c<=this.cellMask;c++)start[c+1]+=start[c];
    for(let i=n-1;i>=0;i--){const c=this.cellOf(y[3*i],y[3*i+1],y[3*i+2],inverse);nodes[--start[c+1]]=i;}
    // start[c + 1] now holds the start of cell c: shift back.
    for(let c=0;c<=this.cellMask;c++)start[c]=start[c+1];
    start[this.cellMask+1]=n;
    let added=0;
    const T=this.triangleCount,E=this.edgeCount;
    for(let k=0;k<T;k++){
      const a=tri[3*k],b=tri[3*k+1],c=tri[3*k+2];
      let lox=Infinity,loy=Infinity,loz=Infinity,hix=-Infinity,hiy=-Infinity,hiz=-Infinity;
      for(let q=0;q<3;q++){const v=3*tri[3*k+q];if(y[v]<lox)lox=y[v];if(y[v]>hix)hix=y[v];if(y[v+1]<loy)loy=y[v+1];if(y[v+1]>hiy)hiy=y[v+1];if(y[v+2]<loz)loz=y[v+2];if(y[v+2]>hiz)hiz=y[v+2];}
      const ix0=Math.floor((lox-reach)*inverse),ix1=Math.floor((hix+reach)*inverse),iy0=Math.floor((loy-reach)*inverse),iy1=Math.floor((hiy+reach)*inverse),iz0=Math.floor((loz-reach)*inverse),iz1=Math.floor((hiz+reach)*inverse);
      for(let ix=ix0;ix<=ix1;ix++)for(let iy=iy0;iy<=iy1;iy++)for(let iz=iz0;iz<=iz1;iz++){
        const cell=(Math.imul(ix,73856093)^Math.imul(iy,19349663)^Math.imul(iz,83492791))&this.cellMask;
        for(let s=start[cell];s<start[cell+1];s++){
          const p=nodes[s];if(p===a||p===b||p===c)continue;
          const px=y[3*p],py=y[3*p+1],pz=y[3*p+2];
          if(px<lox-reach||px>hix+reach||py<loy-reach||py>hiy+reach||pz<loz-reach||pz>hiz+reach)continue;
          this.closestOnTriangle(y,p,a,b,c);
          added+=this.addPair(y,2*(p*T+k),p,a,b,c,1,-w[0],-w[1],-w[2],reach2);
        }
      }
    }
    const es=this.nodeEdgeStart,ne=this.nodeEdges;
    for(let e=0;e<E;e++){
      const a=edges[2*e],b=edges[2*e+1],a3=3*a,b3=3*b;
      const lox=Math.min(y[a3],y[b3])-reach,hix=Math.max(y[a3],y[b3])+reach,loy=Math.min(y[a3+1],y[b3+1])-reach,hiy=Math.max(y[a3+1],y[b3+1])+reach,loz=Math.min(y[a3+2],y[b3+2])-reach,hiz=Math.max(y[a3+2],y[b3+2])+reach;
      const d1x=y[b3]-y[a3],d1y=y[b3+1]-y[a3+1],d1z=y[b3+2]-y[a3+2],aa=d1x*d1x+d1y*d1y+d1z*d1z;
      const ix0=Math.floor(lox*inverse),ix1=Math.floor(hix*inverse),iy0=Math.floor(loy*inverse),iy1=Math.floor(hiy*inverse),iz0=Math.floor(loz*inverse),iz1=Math.floor(hiz*inverse);
      for(let ix=ix0;ix<=ix1;ix++)for(let iy=iy0;iy<=iy1;iy++)for(let iz=iz0;iz<=iz1;iz++){
        const cell=(Math.imul(ix,73856093)^Math.imul(iy,19349663)^Math.imul(iz,83492791))&this.cellMask;
        for(let s=start[cell];s<start[cell+1];s++){
          const p=nodes[s];if(p===a||p===b)continue;
          const px=y[3*p],py=y[3*p+1],pz=y[3*p+2];
          if(px<lox||px>hix||py<loy||py>hiy||pz<loz||pz>hiz)continue;
          for(let q=es[p];q<es[p+1];q++){
            const f=ne[q];if(f<=e)continue;
            const c=edges[2*f],d=edges[2*f+1];if(c===a||c===b||d===a||d===b)continue;
            const c3=3*c,d3=3*d,d2x=y[d3]-y[c3],d2y=y[d3+1]-y[c3+1],d2z=y[d3+2]-y[c3+2],rx=y[a3]-y[c3],ry=y[a3+1]-y[c3+1],rz=y[a3+2]-y[c3+2];
            const ee=d2x*d2x+d2y*d2y+d2z*d2z,ff=d2x*rx+d2y*ry+d2z*rz,cc=d1x*rx+d1y*ry+d1z*rz,bb=d1x*d2x+d1y*d2y+d1z*d2z,den=aa*ee-bb*bb;
            // Only crossings of the two interiors: the ends are point-triangle pairs.
            if(!(den>1e-12*aa*ee))continue;
            const u=(bb*ff-cc*ee)/den,v=(bb*u+ff)/ee;
            if(!(u>0&&u<1&&v>0&&v<1))continue;
            added+=this.addPair(y,2*(e*E+f)+1,a,b,c,d,1-u,u,v-1,-v,reach2);
          }
        }
      }
    }
    const at=this.detectAt;for(let i=0;i<3*n;i++)at[i]=y[i];
    return added;
  }
  private selfStiffness():number {return this.selfK??this.contactK??(10*this.youngT+100*this.meanMass*this.ih2);}
  private meanMass=0;
  private selfEnergy(y:Float64Array,G:Float64Array|null):number {
    const k=this.selfStiffness(),tau=this.selfThickness,nodes=this.pairNodes,W=this.pairW,N=this.pairN,on=this.pairOn;let energy=0;
    for(let q=0;q<this.pairCount;q++){
      const nx=N[3*q],ny=N[3*q+1],nz=N[3*q+2];let gap=0;
      for(let s=0;s<4;s++){const i=3*nodes[4*q+s];gap+=W[4*q+s]*(nx*y[i]+ny*y[i+1]+nz*y[i+2]);}
      const d=gap-tau;
      if(G)on[q]=d<0?1:0;
      if(d>=0)continue;
      energy+=.5*k*d*d;
      if(G)for(let s=0;s<4;s++){const i=3*nodes[4*q+s],f=k*d*W[4*q+s];G[i]+=f*nx;G[i+1]+=f*ny;G[i+2]+=f*nz;}
    }
    return energy;
  }
  private selfProduct(p:Float64Array,out:Float64Array):void {
    const k=this.selfStiffness(),nodes=this.pairNodes,W=this.pairW,N=this.pairN,on=this.pairOn;
    for(let q=0;q<this.pairCount;q++){
      if(!on[q])continue;
      const nx=N[3*q],ny=N[3*q+1],nz=N[3*q+2];let a=0;
      for(let s=0;s<4;s++){const i=3*nodes[4*q+s];a+=W[4*q+s]*(nx*p[i]+ny*p[i+1]+nz*p[i+2]);}
      for(let s=0;s<4;s++){const i=3*nodes[4*q+s],f=k*a*W[4*q+s];out[i]+=f*nx;out[i+1]+=f*ny;out[i+2]+=f*nz;}
    }
  }
  private selfDiagonal():void {
    const k=this.selfStiffness(),nodes=this.pairNodes,W=this.pairW,N=this.pairN,on=this.pairOn,D=this.diag;
    for(let q=0;q<this.pairCount;q++){
      if(!on[q])continue;
      const nx=N[3*q],ny=N[3*q+1],nz=N[3*q+2];
      for(let s=0;s<4;s++){const d=6*nodes[4*q+s],f=k*W[4*q+s]*W[4*q+s];D[d]+=f*nx*nx;D[d+1]+=f*nx*ny;D[d+2]+=f*nx*nz;D[d+3]+=f*ny*ny;D[d+4]+=f*ny*nz;D[d+5]+=f*nz*nz;}
    }
  }

  // ---------------------------------------------------------------------------------------------
  // The minimisation of one step.
  // ---------------------------------------------------------------------------------------------
  /** Put the nodes that follow a body where the body unknowns say they are: x = c + exp([theta]x) r, the exact rotation. */
  private placeAttached(y:Float64Array):void {
    const n=this.nodeCount,tail=3*n,r=this.attR;
    for(let bi=0;bi<this.bodies.length;bi++){
      const b=this.bodies[bi];if(b.attached===0)continue;
      const t=tail+6*bi,x=y[t+3],yy=y[t+4],z=y[t+5],a2=x*x+yy*yy+z*z,a=Math.sqrt(a2),R=b.Rt,J=b.Jl;
      // Rodrigues: R = 1 + s K + c K^2, J = 1 + c K + d K^2 with K = [theta]x.
      const s1=a>1e-4?Math.sin(a)/a:1-a2/6,c1=a>1e-4?(1-Math.cos(a))/a2:.5-a2/24,d1=a>1e-4?(a-Math.sin(a))/(a2*a):1/6-a2/120;
      for(let q=0;q<2;q++){
        const M=q===0?R:J,p=q===0?s1:c1,w=q===0?c1:d1;
        M[0]=1-w*(yy*yy+z*z);M[1]=-p*z+w*x*yy;M[2]=p*yy+w*x*z;M[3]=p*z+w*x*yy;M[4]=1-w*(x*x+z*z);M[5]=-p*x+w*yy*z;M[6]=-p*yy+w*x*z;M[7]=p*x+w*yy*z;M[8]=1-w*(x*x+yy*yy);
      }
    }
    for(let i=0;i<n;i++){
      if(this.kind[i]!==ATTACHED)continue;
      const bi=this.attBody[i],b=this.bodies[bi],t=tail+6*bi,rx=r[3*i],ry=r[3*i+1],rz=r[3*i+2],R=b.Rt;
      y[3*i]=b.x[0]+y[t]+R[0]*rx+R[1]*ry+R[2]*rz;y[3*i+1]=b.x[1]+y[t+1]+R[3]*rx+R[4]*ry+R[5]*rz;y[3*i+2]=b.x[2]+y[t+2]+R[6]*rx+R[7]*ry+R[8]*rz;
    }
  }
  /** Loads that follow the surface: pressure, from the iterate. */
  private followerLoads(y:Float64Array):void {
    const f=this.follower,p=this.pressure;f.fill(0);
    if(p===0)return;
    const tri=this.triangles;
    for(let k=0;k<this.triangleCount;k++){
      const a=3*tri[3*k],b=3*tri[3*k+1],c=3*tri[3*k+2],ux=y[b]-y[a],uy=y[b+1]-y[a+1],uz=y[b+2]-y[a+2],vx=y[c]-y[a],vy=y[c+1]-y[a+1],vz=y[c+2]-y[a+2];
      const fx=p/6*(uy*vz-uz*vy),fy=p/6*(uz*vx-ux*vz),fz=p/6*(ux*vy-uy*vx);
      f[a]+=fx;f[a+1]+=fy;f[a+2]+=fz;f[b]+=fx;f[b+1]+=fy;f[b+2]+=fz;f[c]+=fx;f[c+1]+=fy;f[c+2]+=fz;
    }
  }
  /** Energy of the step at y, with its gradient in this.G (reduced: zero at held nodes and unknowns, attached nodes folded into their body). */
  private evaluate(y:Float64Array,gradient:boolean):number {
    const n=this.nodeCount,tail=3*n,G=gradient?this.G:null,m=this.masses,xt=this.xt,x0=this.x0,fext=this.fext,fol=this.follower,ih2=this.ih2,dr=this.dragRate;
    let energy=0;
    if(G)G.fill(0);
    for(let i=0;i<n;i++){
      const o=3*i;
      for(let k=0;k<3;k++){
        const f=fext[o+k]+fol[o+k];energy-=f*y[o+k];if(G)G[o+k]-=f;
      }
      if(this.kind[i]===PINNED)continue;
      const mi=m[i]*ih2,di=m[i]*dr;
      for(let k=0;k<3;k++){
        const a=y[o+k]-xt[o+k],d=y[o+k]-x0[o+k];energy+=.5*mi*a*a+.5*di*d*d;if(G)G[o+k]+=mi*a+di*d;
      }
    }
    if(G)this.fabs.fill(0);
    energy+=this.membrane(y,G)+this.bend(y,G);
    this.energyStored=0;
    if(this.bodies.length>0)energy+=this.contacts(y,G);
    if(this.pairCount>0){const e=this.selfEnergy(y,G);energy+=e;this.energyStored+=e;}
    if(G)this.reduce(G,true);
    // The bodies' own inertia: the rigid step moves a body by h v + alpha h^2 a.
    const s=this.ih2/this.alpha;
    for(let bi=0;bi<this.bodies.length;bi++){
      const b=this.bodies[bi];if(!b.solved)continue;
      const t=tail+6*bi,I=b.Iw,f=b.free,ax=y[t]-f[0],ay=y[t+1]-f[1],az=y[t+2]-f[2],wx=y[t+3]-f[3],wy=y[t+4]-f[4],wz=y[t+5]-f[5];
      const lx=I[0]*wx+I[1]*wy+I[2]*wz,ly=I[3]*wx+I[4]*wy+I[5]*wz,lz=I[6]*wx+I[7]*wy+I[8]*wz;
      energy+=.5*s*(b.mass*(ax*ax+ay*ay+az*az)+wx*lx+wy*ly+wz*lz);
      if(G){G[t]+=s*b.mass*ax;G[t+1]+=s*b.mass*ay;G[t+2]+=s*b.mass*az;G[t+3]+=s*lx;G[t+4]+=s*ly;G[t+5]+=s*lz;}
    }
    return energy;
  }
  /** Fold a full vector into the unknowns. With `record`, keep the support reactions and the forces on the bodies. */
  private reduce(G:Float64Array,record:boolean):void {
    const n=this.nodeCount,tail=3*n,r=this.attR;
    for(let bi=0;bi<this.bodies.length;bi++){const q=this.bodies[bi].tq;q[0]=q[1]=q[2]=0;}
    for(let i=0;i<n;i++){
      const kind=this.kind[i];if(kind===FREE)continue;
      const o=3*i;
      if(kind===ATTACHED){
        // Force on the body, and the moment about its centre with the rotated lever arm.
        const bi=this.attBody[i],b=this.bodies[bi],t=tail+6*bi,R=b.Rt,q=b.tq,gx=G[o],gy=G[o+1],gz=G[o+2],ax=r[o],ay=r[o+1],az=r[o+2];
        const rx=R[0]*ax+R[1]*ay+R[2]*az,ry=R[3]*ax+R[4]*ay+R[5]*az,rz=R[6]*ax+R[7]*ay+R[8]*az;
        G[t]+=gx;G[t+1]+=gy;G[t+2]+=gz;q[0]+=ry*gz-rz*gy;q[1]+=rz*gx-rx*gz;q[2]+=rx*gy-ry*gx;
      }else if(record){this.reactions[o]=G[o];this.reactions[o+1]=G[o+1];this.reactions[o+2]=G[o+2];}
      G[o]=G[o+1]=G[o+2]=0;
    }
    for(let bi=0;bi<this.bodies.length;bi++){
      const b=this.bodies[bi],t=tail+6*bi,q=b.tq,J=b.Jl;
      // The physical moment goes to the body; the gradient with respect to the rotation vector is J^T times it.
      if(record){b.force[0]=-G[t];b.force[1]=-G[t+1];b.force[2]=-G[t+2];b.torque[0]=-G[t+3]-q[0];b.torque[1]=-G[t+4]-q[1];b.torque[2]=-G[t+5]-q[2];}
      if(!b.solved){G[t]=G[t+1]=G[t+2]=G[t+3]=G[t+4]=G[t+5]=0;continue;}
      if(b.attached>0){G[t+3]+=J[0]*q[0]+J[3]*q[1]+J[6]*q[2];G[t+4]+=J[1]*q[0]+J[4]*q[1]+J[7]*q[2];G[t+5]+=J[2]*q[0]+J[5]*q[1]+J[8]*q[2];}
    }
  }
  /** out = H p for the Hessian stored by the last evaluate with a gradient. p is in the unknowns. */
  private product(p:Float64Array,out:Float64Array):void {
    const n=this.nodeCount,tail=3*n,e=this.cgE,r=this.attR,m=this.masses,s=this.ih2+this.dragRate;
    e.set(p);
    for(let i=0;i<n;i++){
      if(this.kind[i]!==ATTACHED)continue;
      // dx = dc + (J dtheta) x (R r).
      const b=this.bodies[this.attBody[i]],t=tail+6*this.attBody[i],R=b.Rt,J=b.Jl,ax=r[3*i],ay=r[3*i+1],az=r[3*i+2],px=p[t+3],py=p[t+4],pz=p[t+5];
      const rx=R[0]*ax+R[1]*ay+R[2]*az,ry=R[3]*ax+R[4]*ay+R[5]*az,rz=R[6]*ax+R[7]*ay+R[8]*az;
      const tx=J[0]*px+J[1]*py+J[2]*pz,ty=J[3]*px+J[4]*py+J[5]*pz,tz=J[6]*px+J[7]*py+J[8]*pz;
      e[3*i]=p[t]+ty*rz-tz*ry;e[3*i+1]=p[t+1]+tz*rx-tx*rz;e[3*i+2]=p[t+2]+tx*ry-ty*rx;
    }
    out.fill(0);
    for(let i=0;i<n;i++){if(this.kind[i]===PINNED)continue;const a=m[i]*s,o=3*i;out[o]=a*e[o];out[o+1]=a*e[o+1];out[o+2]=a*e[o+2];}
    this.membraneProduct(e,out);this.bendProduct(e,out);
    if(this.bodies.length>0)this.contactProduct(e,out);
    if(this.pairCount>0)this.selfProduct(e,out);
    this.reduce(out,false);
    const sb=this.ih2/this.alpha;
    for(let bi=0;bi<this.bodies.length;bi++){
      const b=this.bodies[bi];if(!b.solved)continue;
      const t=tail+6*bi,I=b.Iw,wx=p[t+3],wy=p[t+4],wz=p[t+5];
      out[t]+=sb*b.mass*p[t];out[t+1]+=sb*b.mass*p[t+1];out[t+2]+=sb*b.mass*p[t+2];
      out[t+3]+=sb*(I[0]*wx+I[1]*wy+I[2]*wz);out[t+4]+=sb*(I[3]*wx+I[4]*wy+I[5]*wz);out[t+5]+=sb*(I[6]*wx+I[7]*wy+I[8]*wz);
    }
  }
  /** Inverse 3x3 blocks of the Hessian's diagonal: one per node, two per body (translation, rotation). */
  private precondition():void {
    const n=this.nodeCount,D=this.diag,BD=this.bodyDiag,m=this.masses,s=this.ih2+this.dragRate,r=this.attR;
    D.fill(0);BD.fill(0);
    this.membraneDiagonal();this.bendDiagonal();
    if(this.bodies.length>0)this.contactDiagonal();
    if(this.pairCount>0)this.selfDiagonal();
    for(let i=0;i<n;i++){
      const d=6*i,a=m[i]*s;
      if(this.kind[i]===PINNED)continue;
      D[d]+=a;D[d+3]+=a;D[d+5]+=a;
      if(this.kind[i]===ATTACHED){
        // The node's block seen from its body: D for the translation, [r]x^T D [r]x for the rotation.
        const bd=12*this.attBody[i],rx=r[3*i],ry=r[3*i+1],rz=r[3*i+2],xx=D[d],xy=D[d+1],xz=D[d+2],yy=D[d+3],yz=D[d+4],zz=D[d+5];
        BD[bd]+=xx;BD[bd+1]+=xy;BD[bd+2]+=xz;BD[bd+3]+=yy;BD[bd+4]+=yz;BD[bd+5]+=zz;
        // Columns of D [r]x, with [r]x = [[0, -rz, ry], [rz, 0, -rx], [-ry, rx, 0]].
        const c00=xy*rz-xz*ry,c01=xz*rx-xx*rz,c02=xx*ry-xy*rx,c10=yy*rz-yz*ry,c11=yz*rx-xy*rz,c12=xy*ry-yy*rx,c20=yz*rz-zz*ry,c21=zz*rx-xz*rz,c22=xz*ry-yz*rx;
        // [r]x^T (D [r]x): row a of [r]x^T is column a of [r]x.
        BD[bd+6]+=rz*c10-ry*c20;BD[bd+7]+=rz*c11-ry*c21;BD[bd+8]+=rz*c12-ry*c22;BD[bd+9]+=rx*c21-rz*c01;BD[bd+10]+=rx*c22-rz*c02;BD[bd+11]+=ry*c02-rx*c12;
        continue;
      }
      invertSym(D[d],D[d+1],D[d+2],D[d+3],D[d+4],D[d+5],this.pinv,9*i);
    }
    const sb=this.ih2/this.alpha;
    for(let bi=0;bi<this.bodies.length;bi++){
      const b=this.bodies[bi];if(!b.solved)continue;
      const bd=12*bi,I=b.Iw,ma=sb*b.mass;
      invertSym(BD[bd]+ma,BD[bd+1],BD[bd+2],BD[bd+3]+ma,BD[bd+4],BD[bd+5]+ma,this.bodyPinv,18*bi);
      invertSym(BD[bd+6]+sb*I[0],BD[bd+7]+sb*I[1],BD[bd+8]+sb*I[2],BD[bd+9]+sb*I[4],BD[bd+10]+sb*I[5],BD[bd+11]+sb*I[8],this.bodyPinv,18*bi+9);
    }
  }
  private applyPreconditioner(r:Float64Array,z:Float64Array):void {
    const n=this.nodeCount,P=this.pinv,tail=3*n;
    for(let i=0;i<n;i++){
      const o=3*i;
      if(this.kind[i]!==FREE){z[o]=z[o+1]=z[o+2]=0;continue;}
      const q=9*i,a=r[o],b=r[o+1],c=r[o+2];
      z[o]=P[q]*a+P[q+1]*b+P[q+2]*c;z[o+1]=P[q+3]*a+P[q+4]*b+P[q+5]*c;z[o+2]=P[q+6]*a+P[q+7]*b+P[q+8]*c;
    }
    const BP=this.bodyPinv;
    for(let bi=0;bi<this.bodies.length;bi++){
      const t=tail+6*bi;
      if(!this.bodies[bi].solved){z[t]=z[t+1]=z[t+2]=z[t+3]=z[t+4]=z[t+5]=0;continue;}
      for(let h=0;h<2;h++){
        const q=18*bi+9*h,o=t+3*h,a=r[o],b=r[o+1],c=r[o+2];
        z[o]=BP[q]*a+BP[q+1]*b+BP[q+2]*c;z[o+1]=BP[q+3]*a+BP[q+4]*b+BP[q+5]*c;z[o+2]=BP[q+6]*a+BP[q+7]*b+BP[q+8]*c;
      }
    }
  }
  /** Preconditioned conjugate gradients for H p = -G. The result is in cgP's companion, this.trial; returns its slope G.p. */
  private solveDirection():number {
    const size=this.size,G=this.G,x=this.trial,r=this.cgR,z=this.cgZ,p=this.cgP,A=this.cgA;
    x.fill(0);
    for(let i=0;i<size;i++)r[i]=-G[i];
    this.applyPreconditioner(r,z);
    let rz=0;for(let i=0;i<size;i++){p[i]=z[i];rz+=r[i]*z[i];}
    const stop=this.cgTol*this.cgTol*rz;
    for(let it=0;it<this.maxCg&&rz>stop&&rz>0;it++){
      this.product(p,A);this.stats.cgIterations++;
      let pAp=0;for(let i=0;i<size;i++)pAp+=p[i]*A[i];
      if(!(pAp>0))break;
      const a=rz/pAp;
      for(let i=0;i<size;i++){x[i]+=a*p[i];r[i]-=a*A[i];}
      this.applyPreconditioner(r,z);
      let next=0;for(let i=0;i<size;i++)next+=r[i]*z[i];
      const beta=next/rz;rz=next;
      for(let i=0;i<size;i++)p[i]=z[i]+beta*p[i];
    }
    let slope=0;for(let i=0;i<size;i++)slope+=G[i]*x[i];
    return slope;
  }
  /** Largest gradient entry (a force, or a body torque divided by the body's size), N. */
  private residual():number {
    const n=this.nodeCount,G=this.G;let worst=0;
    for(let i=0;i<3*n;i++){const a=Math.abs(G[i]);if(a>worst)worst=a;}
    for(let bi=0;bi<this.bodies.length;bi++){
      const b=this.bodies[bi],t=3*n+6*bi,arm=Number.isFinite(b.bound)&&b.bound>0?b.bound:1;
      for(let k=0;k<3;k++){worst=Math.max(worst,Math.abs(G[t+k]),Math.abs(G[t+3+k])/arm);}
    }
    return worst;
  }
  /** Minimise the step energy from this.y. Returns true when the residual met the tolerance. */
  private minimise():boolean {
    const size=this.size,n=this.nodeCount,y=this.y,trial=this.trial,cgA=this.cgA,m=this.masses,xt=this.xt,x0=this.x0,fext=this.fext,stats=this.stats;
    // Force scale of the step: loads, inertia and (below) internal forces.
    let scale=0;
    for(let i=0;i<n;i++){
      const o=3*i,f=Math.abs(fext[o])+Math.abs(fext[o+1])+Math.abs(fext[o+2])+m[i]*this.ih2*(Math.abs(xt[o]-x0[o])+Math.abs(xt[o+1]-x0[o+1])+Math.abs(xt[o+2]-x0[o+2]));
      if(f>scale)scale=f;
    }
    for(let bi=0;bi<this.bodies.length;bi++){const b=this.bodies[bi];if(b.solved)scale=Math.max(scale,b.mass*this.ih2/this.alpha*(Math.abs(b.free[0])+Math.abs(b.free[1])+Math.abs(b.free[2])));}
    let reach=0;for(let i=0;i<3*n;i++){const a=Math.abs(y[i]);if(a>reach)reach=a;}
    const floor=3.6e-15*this.youngT/(1-this.poissonRatio*this.poissonRatio)*reach;
    let converged=false,tolerance=0,worst=0,detected=false,held=false,lastChange=Infinity;
    for(let it=0;;it++){
      this.placeAttached(y);
      this.followerLoads(y);
      let added=this.bodies.length>0?this.detectContacts(y):0;
      if(this.selfOn){
        let moved=0;
        if(detected){const at=this.detectAt;for(let i=0;i<3*n;i++){const d=Math.abs(y[i]-at[i]);if(d>moved)moved=d;}}
        if(!detected||moved>.1*this.selfThickness){added+=this.detectSelf(y);detected=true;}
      }
      let energy=this.evaluate(y,true);
      // Friction limits follow the normal forces from iterate to iterate while that settles (the change at least halves
      // each time after the eighth iterate), and are held for the rest of the step once it does not: the limits of a
      // contact about to slip can otherwise flip between two states for ever. Settled, the limit is mu N of the
      // solution itself; held, it is that of the iterate where it was stopped.
      let change=0;
      if(this.bodies.length>0&&!held){change=this.updateFrictionCaps();if(it>=8&&change>.5*lastChange&&change>tolerance)held=true;lastChange=change;}
      if(change>0)energy=this.evaluate(y,true);
      let internal=0;for(let i=0;i<n;i++)if(this.fabs[i]>internal)internal=this.fabs[i];
      // The last term is the rounding of the membrane forces, about eps Y |x|: no residual can be asked to go below it.
      tolerance=this.resTol*Math.max(scale,internal)+this.forceTol+floor;worst=this.residual();
      if(worst<=tolerance&&added===0&&(held||change<=tolerance)){converged=true;break;}
      if(it>=this.maxNewton)break;
      stats.newtonIterations++;
      this.precondition();
      const slope=this.solveDirection();
      if(!(slope<0)){converged=worst<=tolerance;break;}
      // Backtracking line search on the step energy. trial holds the direction; cgA becomes the candidate.
      let step=1,accepted=false;
      for(let ls=0;ls<40;ls++){
        for(let i=0;i<size;i++)cgA[i]=y[i]+step*trial[i];
        this.placeAttached(cgA);
        const e=this.evaluate(cgA,false);
        if(e<=energy+1e-4*step*slope||(ls>0&&Math.abs(step*slope)<=1e-13*(Math.abs(energy)+1e-300))){accepted=true;break;}
        step*=.5;stats.lineSearchHalvings++;
      }
      if(!accepted){this.placeAttached(y);this.evaluate(y,true);break;}
      y.set(cgA);
    }
    stats.residual=worst;stats.tolerance=tolerance;
    return converged;
  }
  /** Dead loads of a step: gravity, point forces and wind. */
  private deadLoads():void {
    const n=this.nodeCount,f=this.fext,g=this.gravity,m=this.masses,p=this.pointForce;
    for(let i=0;i<n;i++)for(let k=0;k<3;k++)f[3*i+k]=m[i]*g[k]+p[3*i+k];
    if(!this.windOn)return;
    const tri=this.triangles,x=this.positions,v=this.velocities,w=this.wind,q=.5*w[3]*w[4];
    for(let k=0;k<this.triangleCount;k++){
      const a=3*tri[3*k],b=3*tri[3*k+1],c=3*tri[3*k+2],ux=x[b]-x[a],uy=x[b+1]-x[a+1],uz=x[b+2]-x[a+2],vx=x[c]-x[a],vy=x[c+1]-x[a+1],vz=x[c+2]-x[a+2];
      let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const l=Math.hypot(nx,ny,nz)||1e-300,A=.5*l;nx/=l;ny/=l;nz/=l;
      const un=(w[0]-(v[a]+v[b]+v[c])/3)*nx+(w[1]-(v[a+1]+v[b+1]+v[c+1])/3)*ny+(w[2]-(v[a+2]+v[b+2]+v[c+2])/3)*nz,s=q*un*Math.abs(un)*A/3;
      f[a]+=s*nx;f[a+1]+=s*ny;f[a+2]+=s*nz;f[b]+=s*nx;f[b+1]+=s*ny;f[b+2]+=s*nz;f[c]+=s*nx;f[c+1]+=s*ny;f[c+2]+=s*nz;
    }
  }
  /** Set up one backward-Euler step of length h (or a proximal step of a static solve when `still`), solve it, and leave the result in this.y. */
  private implicitStep(h:number,still:boolean):boolean {
    const n=this.nodeCount,tail=3*n,x=this.positions,v=this.velocities,x0=this.x0,xt=this.xt,y=this.y,g=this.gravity,vl=this.vLast;
    this.ih2=1/(h*h);this.dragRate=still?0:this.drag/h;this.alpha=still?1:this.bodyStepFactor;
    let mean=0;for(let i=0;i<n;i++)mean+=this.masses[i];this.meanMass=mean/n;
    x0.set(x);
    for(let bi=0;bi<this.bodies.length;bi++){
      const b=this.bodies[bi],R=b.R,I=b.Iw,J=b.Iinv,f=b.free,t=tail+6*bi;
      b.solved=b.type===2&&b.twoWay&&this.scheme==='implicit';
      if(b.type===2){
        const mo=b.moments;
        for(let r=0;r<3;r++)for(let c=0;c<3;c++){
          let s=0,si=0;
          if(mo)for(let k=0;k<3;k++){s+=R[3*r+k]*mo[k]*R[3*c+k];si+=R[3*r+k]/mo[k]*R[3*c+k];}
          I[3*r+c]=mo?s:(r===c?1e30:0);J[3*r+c]=si;
        }
        const a=this.alpha*h*h,e=b.external;
        for(let k=0;k<3;k++){
          f[k]=(still?0:h*b.v[k])+a*(g[k]*b.gravityScale+e[k]/b.mass);
          f[3+k]=(still?0:h*b.w[k])+a*(J[3*k]*e[3]+J[3*k+1]*e[4]+J[3*k+2]*e[5]);
        }
      }else for(let k=0;k<3;k++){f[k]=still?0:h*b.v[k];f[3+k]=still?0:h*b.w[k];}
      // A prescribed body moves by its free motion. A solved one starts the iteration where last step's cloth force
      // would put it (at rest on the cloth that is exactly where it is), which is only a first guess.
      for(let k=0;k<6;k++)y[t+k]=still?0:f[k];
      if(b.solved&&!still){
        const a=this.alpha*h*h,F=b.force,T=b.torque;
        for(let k=0;k<3;k++){y[t+k]+=a*F[k]/b.mass;y[t+3+k]+=a*(J[3*k]*T[0]+J[3*k+1]*T[1]+J[3*k+2]*T[2]);}
      }
    }
    // Attached nodes ride on their body: snap them to it and give them its velocity.
    for(let i=0;i<n;i++){
      if(this.kind[i]!==ATTACHED)continue;
      const b=this.bodies[this.attBody[i]],R=b.R,l=this.attLocal,o=3*i;
      const rx=R[0]*l[o]+R[1]*l[o+1]+R[2]*l[o+2],ry=R[3]*l[o]+R[4]*l[o+1]+R[5]*l[o+2],rz=R[6]*l[o]+R[7]*l[o+1]+R[8]*l[o+2];
      this.attR[o]=rx;this.attR[o+1]=ry;this.attR[o+2]=rz;
      x0[o]=b.x[0]+rx;x0[o+1]=b.x[1]+ry;x0[o+2]=b.x[2]+rz;
      v[o]=still?0:b.v[0]+b.w[1]*rz-b.w[2]*ry;v[o+1]=still?0:b.v[1]+b.w[2]*rx-b.w[0]*rz;v[o+2]=still?0:b.v[2]+b.w[0]*ry-b.w[1]*rx;
    }
    for(let i=0;i<n;i++){
      const o=3*i;
      if(this.kind[i]===PINNED){for(let k=0;k<3;k++){xt[o+k]=this.target[o+k];y[o+k]=this.target[o+k];}continue;}
      // The inertial target is x + h v. The iteration starts one better, at x + h v + h (v - v_last): last step's
      // acceleration again, which is nothing at rest and gravity in free fall (not for a node in contact, whose
      // acceleration is not smooth). A first guess only.
      for(let k=0;k<3;k++){xt[o+k]=x0[o+k]+(still?0:h*v[o+k]);y[o+k]=xt[o+k]+(still||this.kind[i]!==FREE||h!==this.lastStep||this.cBody[SLOTS*i]>=0||this.cBody[SLOTS*i+1]>=0?0:h*(v[o+k]-vl[o+k]));}
    }
    if(!still){vl.set(v);this.lastStep=h;}
    this.reactions.fill(0);
    this.deadLoads();
    if(this.bodies.length>0)this.beginContacts();
    if(this.selfOn){this.pairCount=0;this.pairKeys.fill(0);}
    return this.minimise();
  }
  /** Work of the loads and supports over the displacement of the step. */
  private countWork():void {
    const n=this.nodeCount,y=this.y,x0=this.x0,f=this.fext,fol=this.follower,g=this.gravity,m=this.masses,R=this.reactions;let work=0;
    for(let i=0;i<n;i++)for(let k=0;k<3;k++){
      const o=3*i+k,d=y[o]-x0[o];
      work+=(f[o]-m[i]*g[k]+fol[o])*d;
      if(this.kind[i]===PINNED)work+=R[o]*d;
    }
    for(let bi=0;bi<this.bodies.length;bi++){
      const b=this.bodies[bi],t=3*n+6*bi;
      for(let k=0;k<3;k++)work-=b.force[k]*y[t+k]+b.torque[k]*y[t+3+k];
    }
    this.externalWork+=work;
  }
  /** Advance by `count` steps of dt. */
  step(count=1):void {
    if(!Number.isInteger(count)||count<0)fail('step: count must be a non-negative integer.');
    const n=this.nodeCount,x=this.positions,v=this.velocities,x0=this.x0,y=this.y,h=this.dt;
    for(let s=0;s<count;s++){
      if(this.integrator==='midpoint'){
        // Implicit midpoint: a backward-Euler half step gives the midpoint; reflect through it.
        const ok=this.implicitStep(h/2,false);
        for(let i=0;i<n;i++){
          const o=3*i;
          if(this.kind[i]===PINNED){for(let k=0;k<3;k++){v[o+k]=(y[o+k]-x0[o+k])/h;x[o+k]=y[o+k];}continue;}
          for(let k=0;k<3;k++){const mid=y[o+k];v[o+k]=4*(mid-x0[o+k])/h-v[o+k];x[o+k]=2*mid-x0[o+k];y[o+k]=x[o+k];}
        }
        this.countWork();
        if(!ok)this.stats.unconvergedSteps++;
      }else{
        const ok=this.implicitStep(h,false);
        for(let i=0;i<3*n;i++){v[i]=(y[i]-x0[i])/h;x[i]=y[i];}
        if(this.bodies.length>0)this.endContacts();
        this.countWork();
        if(!ok)this.stats.unconvergedSteps++;
      }
      let pressing=0;for(let q=0;q<this.pairCount;q++)pressing+=this.pairOn[q];
      this.stats.selfPairs=pressing;this.stats.steps++;this.time+=h;
    }
  }
  /**
   * Find the equilibrium of the present loads, supports and contacts: velocities become zero. Proximal Newton: each outer
   * iteration minimises the potential energy plus (m / (2 s^2)) |x - x_k|^2 with the pseudo step s, which keeps the
   * problem well posed where the cloth has no stiffness (a slack direction, a free body). Dynamic bodies take part with
   * their weight. Not for the hot path.
   */
  solveStatic(options:{readonly pseudoStep?:number;readonly maxIterations?:number}={}):ClothStaticResult {
    const n=this.nodeCount,x=this.positions,y=this.y,x0=this.x0,m=this.masses;
    const s=options.pseudoStep===undefined?1e3:num(options.pseudoStep,'pseudoStep',1e-6,1e9),max=options.maxIterations===undefined?200:num(options.maxIterations,'maxIterations',1,1e6);
    this.velocities.fill(0);
    let converged=false,iterations=0,residual=0,tolerance=0;
    for(let outer=0;outer<max;outer++){
      iterations++;
      const ok=this.implicitStep(s,true);
      // The proximal force m (x - x_k) / s^2 is what separates this state from equilibrium.
      residual=0;
      for(let i=0;i<n;i++)if(this.kind[i]!==PINNED)for(let k=0;k<3;k++){const f=m[i]*this.ih2*Math.abs(y[3*i+k]-x0[3*i+k]);if(f>residual)residual=f;}
      for(let bi=0;bi<this.bodies.length;bi++){
        const b=this.bodies[bi];if(!b.solved)continue;
        const t=3*n+6*bi;
        for(let k=0;k<3;k++){residual=Math.max(residual,b.mass*this.ih2*Math.abs(y[t+k]));b.x[k]+=y[t+k];}
        // The (small) rotation: q <- q + (1/2) theta q.
        const q=b.q,tx=.5*y[t+3],ty=.5*y[t+4],tz=.5*y[t+5],qx=q[0],qy=q[1],qz=q[2],qw=q[3];
        q[0]=qx+tx*qw+ty*qz-tz*qy;q[1]=qy+ty*qw+tz*qx-tx*qz;q[2]=qz+tz*qw+tx*qy-ty*qx;q[3]=qw-tx*qx-ty*qy-tz*qz;
        const l=Math.hypot(q[0],q[1],q[2],q[3]);q[0]/=l;q[1]/=l;q[2]/=l;q[3]/=l;quatToMatrix(q,b.R);
      }
      for(let i=0;i<3*n;i++)x[i]=y[i];
      if(this.bodies.length>0)this.endContacts();
      tolerance=this.stats.tolerance;
      if(ok&&residual<=tolerance){converged=true;break;}
    }
    this.velocities.fill(0);
    return {converged,iterations,residual:Math.max(residual,this.stats.residual),tolerance};
  }
  /** Position of a body after a static solve (the solve moves dynamic bodies). */
  bodyPosition(index:number):Float64Array {return this.body(index).x;}
}

// -------------------------------------------------------------------------------------------------
// Coupling to a rigid world.
// -------------------------------------------------------------------------------------------------

/** The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it. */
export interface ClothWorld<B> {
  gravity():readonly number[];
  getState(body:B):{readonly position:readonly number[];readonly rotation:readonly number[];readonly linearVelocity:readonly number[];readonly angularVelocity:readonly number[];readonly mass:number;readonly type:string};
  /** Force in newtons acting over the next step, at the centre of mass when no point is given. */
  applyForce(body:B,force:ClothVec3,point?:ClothVec3):void;
  applyTorque(body:B,torque:ClothVec3):void;
  isAlive?(body:B):boolean;
  readonly loop?:{readonly step:number};
  /** Solver substeps per step: with n of them the rigid step moves a body by h v + (n + 1) / (2 n) h^2 a. */
  readonly subSteps?:number;
}
export interface ClothColliderOptions {
  /** The world cannot report shapes: say what the body is. */
  readonly shape:ClothShape;
  /** Coulomb coefficient between the body and the cloth. Default 0. */
  readonly friction?:number;
  /** Rotational inertia of a dynamic body. Default: that of the shape with uniform density. */
  readonly inertia?:StructureInertia;
  readonly collide?:boolean;
  readonly twoWay?:boolean;
  readonly gravityScale?:number;
}
export interface ClothCouplingOptions {
  /** 'implicit' (default): bodies are unknowns of the cloth solve. 'naive-staggered': the cloth is solved against the bodies' free motion and its force handed to them; it exists to show the instability, do not use it. */
  readonly scheme?:'implicit'|'naive-staggered';
  /** Estimate, from how each body actually moved in the last rigid step, the force its supports and joints put on it, and let the cloth count on it. Default true. Without it a body resting on the ground is seen as falling. */
  readonly estimateSupports?:boolean;
}
export interface ClothCouplingDiagnostics {
  clothKinetic:number;clothMembrane:number;clothBending:number;clothPotential:number;
  /** Translational kinetic energy and -m g.x of the coupled dynamic bodies, J. Their rotational energy is not counted. */
  bodyKinetic:number;bodyPotential:number;total:number;
  /** Linear momentum of the cloth and the coupled dynamic bodies, kg m/s. */
  momentum:[number,number,number];
  mass:number;
}
interface CoupledBody<B> {readonly body:B|null;readonly index:number;readonly prevV:Float64Array;readonly prevW:Float64Array;seen:boolean;dynamic:boolean;contact:boolean}

/**
 * Two-way coupling of a Cloth with a rigid world. Call `step()` immediately before `world.step()`: it reads the bodies,
 * advances the cloth by one step with the dynamic bodies as unknowns of the same solve, and gives each body the force and
 * torque the cloth put on it, to act through the rigid step. What the cloth feels and what the bodies get are the same
 * numbers with opposite signs.
 */
export class ClothCoupling<B> {
  /** Everything a later step reads, as a state tree (checkpoint.ts), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,CLOTH_COUPLING_FIELDS);}
  /** Put back a state from `saveState()` of a coupling set up the same way (same cloth, bodies, planes and attachments, in the same order). */
  restoreState(state:StateValue):void {restoreFields(this,state,CLOTH_COUPLING_FIELDS);}

  readonly backend=CLOTH_COUPLING_BACKEND;
  readonly world:ClothWorld<B>;readonly cloth:Cloth;readonly dt:number;readonly scheme:'implicit'|'naive-staggered';readonly estimateSupports:boolean;
  private readonly list:CoupledBody<B>[]=[];private readonly byBody=new Map<B,CoupledBody<B>>();
  private readonly load=new Float64Array(6);private readonly out:[number,number,number]=[0,0,0];
  private readonly state={position:[0,0,0] as number[]|readonly number[],rotation:[0,0,0,1] as number[]|readonly number[],linearVelocity:[0,0,0] as number[]|readonly number[],angularVelocity:[0,0,0] as number[]|readonly number[]};
  steps=0;

  constructor(world:ClothWorld<B>,cloth:Cloth,options:ClothCouplingOptions={}) {
    if(!world||typeof world.getState!=='function'||typeof world.applyForce!=='function'||typeof world.applyTorque!=='function'||typeof world.gravity!=='function')
      throw new TypeError('ClothCoupling needs a world with gravity(), getState(), applyForce() and applyTorque().');
    if(!(cloth instanceof Cloth))throw new TypeError('ClothCoupling needs a Cloth.');
    if(cloth.integrator!=='backward-euler')fail('A coupled cloth needs the backward-euler integrator.');
    this.world=world;this.cloth=cloth;this.dt=cloth.dt;
    if(world.loop&&Math.abs(world.loop.step-cloth.dt)>1e-12)fail(`The cloth steps at ${cloth.dt} s but the world at ${world.loop.step} s: they must be equal.`);
    this.scheme=options.scheme??'implicit';
    if(this.scheme!=='implicit'&&this.scheme!=='naive-staggered')fail("scheme must be 'implicit' or 'naive-staggered'.");
    this.estimateSupports=options.estimateSupports??true;
    cloth.scheme=this.scheme;
    const sub=world.subSteps;cloth.bodyStepFactor=sub!==undefined&&sub>0?(sub+1)/(2*sub):1;
  }
  /** Let the cloth collide with a body of the world, and (for a dynamic body) push it. Returns the body's index in the cloth. */
  addBody(body:B,options:ClothColliderOptions):number {
    if(this.byBody.has(body))fail('That body is already coupled to this cloth.');
    const s=this.world.getState(body);
    if(s.type!=='static'&&s.type!=='kinematic'&&s.type!=='dynamic')fail(`Unknown body type "${s.type}".`);
    const index=this.cloth.addBody({...options,type:s.type as 'static'|'kinematic'|'dynamic',mass:s.type==='dynamic'?s.mass:undefined,position:s.position,rotation:s.rotation,linearVelocity:s.linearVelocity,angularVelocity:s.angularVelocity});
    const entry:CoupledBody<B>={body,index,prevV:new Float64Array(3),prevW:new Float64Array(3),seen:false,dynamic:s.type==='dynamic',contact:false};
    this.list.push(entry);this.byBody.set(body,entry);return index;
  }
  /** A fixed plane that is not a body of the world (the ground): the half space behind `normal` through `point`. */
  addPlane(options:{readonly normal:ClothVec3;readonly point?:ClothVec3;readonly friction?:number}):number {
    const index=this.cloth.addBody({shape:{kind:'plane',normal:options.normal},type:'static',position:options.point??[0,0,0],rotation:[0,0,0,1],friction:options.friction});
    this.list.push({body:null,index,prevV:new Float64Array(3),prevW:new Float64Array(3),seen:false,dynamic:false,contact:false});return index;
  }
  private entry(body:B):CoupledBody<B> {const e=this.byBody.get(body);if(!e)fail('That body is not coupled to this cloth: addBody() it first.');return e as CoupledBody<B>;}
  /** Index of a coupled body in the cloth, for `cloth.bodyForce(index)` and the like. */
  indexOf(body:B):number {return this.entry(body).index;}
  /** Fix a cloth node to a point of a coupled body (body axes, from its centre of mass; default: where the node is now). */
  attach(node:number,body:B,localPoint?:ArrayLike<number>):void {
    const e=this.entry(body),s=this.world.getState(body);
    this.cloth.setBodyState(e.index,s);this.cloth.attach(node,e.index,localPoint);
  }
  detach(node:number):void {this.cloth.release(node);}
  /** Force (N) and torque about the centre of mass (N m) the cloth put on the body in the last step. Live arrays. */
  force(body:B):Float64Array {return this.cloth.bodyForce(this.entry(body).index);}
  torque(body:B):Float64Array {return this.cloth.bodyTorque(this.entry(body).index);}
  /** Advance the cloth one step against the bodies as they are now and hand them its forces. Call immediately before world.step(). */
  step():void {
    const world=this.world,cloth=this.cloth,h=this.dt,g=world.gravity(),load=this.load,out=this.out;
    for(let i=0;i<this.list.length;i++){
      const e=this.list[i];if(e.body===null)continue;
      if(world.isAlive&&!world.isAlive(e.body))continue;
      const s=world.getState(e.body);
      cloth.setBodyState(e.index,s);
      if(!e.dynamic)continue;
      cloth.setBodyMass(e.index,s.mass);
      load.fill(0);
      if(this.estimateSupports&&e.seen){
        // What moved the body in the last rigid step, less gravity and less what the cloth applied, is its supports and joints.
        const F=cloth.bodyForce(e.index),T=cloth.bodyTorque(e.index),v=s.linearVelocity,w=s.angularVelocity,scale=cloth.bodyGravityScale(e.index);
        for(let k=0;k<3;k++)load[k]=s.mass*((v[k]-e.prevV[k])/h-Number(g[k])*scale)-F[k];
        cloth.bodyAngularMomentumChange(e.index,w[0]-e.prevW[0],w[1]-e.prevW[1],w[2]-e.prevW[2],load);
        for(let k=0;k<3;k++)load[3+k]=load[3+k]/h-T[k];
      }
      cloth.setBodyExternalLoad(e.index,load,load,3);
      for(let k=0;k<3;k++){e.prevV[k]=s.linearVelocity[k];e.prevW[k]=s.angularVelocity[k];}
      e.seen=true;
    }
    cloth.step(1);
    for(let i=0;i<this.list.length;i++){
      const e=this.list[i];if(e.body===null||!e.dynamic)continue;
      if(!cloth.bodyTwoWay(e.index))continue;
      if(world.isAlive&&!world.isAlive(e.body))continue;
      const F=cloth.bodyForce(e.index),T=cloth.bodyTorque(e.index);
      if(F[0]!==0||F[1]!==0||F[2]!==0){out[0]=F[0];out[1]=F[1];out[2]=F[2];world.applyForce(e.body,out);}
      if(T[0]!==0||T[1]!==0||T[2]!==0){out[0]=T[0];out[1]=T[1];out[2]=T[2];world.applyTorque(e.body,out);}
    }
    this.steps++;
  }
  /** Bodies whose contact with the cloth began or ended in the last step: calls `each(body, index, touching)`. */
  contactChanges(each:(body:B|null,index:number,touching:boolean)=>void):void {
    for(let i=0;i<this.list.length;i++){
      const e=this.list[i],now=this.cloth.bodyContacts(e.index)>0;
      if(now!==e.contact){e.contact=now;each(e.body,e.index,now);}
    }
  }
  /** Energies and momentum of the cloth and the coupled dynamic bodies. Allocates; not for the hot path. */
  diagnostics():ClothCouplingDiagnostics {
    const cloth=this.cloth,g=this.world.gravity(),momentum=cloth.linearMomentum([0,0,0]) as [number,number,number];
    const d:ClothCouplingDiagnostics={clothKinetic:cloth.kineticEnergy(),clothMembrane:cloth.membraneEnergy(),clothBending:cloth.bendingEnergy(),clothPotential:cloth.gravitationalEnergy(),bodyKinetic:0,bodyPotential:0,total:0,momentum,mass:cloth.mass()};
    for(const e of this.list){
      if(e.body===null||!e.dynamic)continue;
      if(this.world.isAlive&&!this.world.isAlive(e.body))continue;
      const s=this.world.getState(e.body),v=s.linearVelocity,x=s.position;
      d.bodyKinetic+=.5*s.mass*(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);d.bodyPotential-=s.mass*(Number(g[0])*x[0]+Number(g[1])*x[1]+Number(g[2])*x[2]);d.mass+=s.mass;
      for(let k=0;k<3;k++)momentum[k]+=s.mass*v[k];
    }
    d.total=d.clothKinetic+d.clothMembrane+d.clothBending+d.clothPotential+d.bodyKinetic+d.bodyPotential;
    return d;
  }
}

/** Where the cloth runs inside its stage of a Simulation: after the structure coupling (100), before the water (200). */
export const CLOTH_SUBSYSTEM_ORDER=150;

/**
 * A cloth as a subsystem of the one stepping loop (simulation.ts).
 *  - A `ClothCoupling`: couple stage, order 150. It exchanges forces with the rigid step, so its dt must equal the
 *    simulation step.
 *  - A bare `Cloth` (no world): post stage; its dt may be the step, a whole fraction of it or a whole multiple.
 * Energy: kinetic + membrane + bending + gravitational + contact-spring energy of the cloth, with the work of loads, moving supports and
 * bodies as `exchanged`; the bodies themselves are not counted (track them with `simulation.trackBody`). Numerical
 * damping, drag and friction make `total - exchanged` fall.
 * Events, emitted at the end of a step: 'contact-begin' and 'contact-end' with {body, index} when a body starts or stops
 * pressing on the cloth, and 'unconverged' with {residual, tolerance} when a step stopped at its iteration limit.
 * Tearing is not modelled, so there is no tear event.
 */
export function clothSubsystem<W,B>(target:Cloth|ClothCoupling<B>,options:{readonly id?:string;readonly order?:number}={}):Subsystem<W,B> {
  const coupling=target instanceof ClothCoupling?target:null,cloth=coupling?coupling.cloth:target as Cloth;
  if(!(cloth instanceof Cloth))throw new TypeError('clothSubsystem needs a Cloth or a ClothCoupling.');
  let unconverged=cloth.stats.unconvergedSteps;
  return {
    id:options.id??'cloth',kind:coupling?'cloth-coupling':'cloth',stage:coupling?'couple':'post',order:options.order??(coupling?CLOTH_SUBSYSTEM_ORDER:400),
    timeStep:{dt:cloth.dt,rule:coupling?'equal':'commensurate'},
    step(ctx){if(coupling)coupling.step();else cloth.step(ctx.substeps);},
    // The solver (with the coupling's records) and the event cursor.
    checkpoint(){return {state:(coupling??cloth).saveState(),unconverged};},
    restore(state){
      const s=state as {state?:StateValue;unconverged?:unknown}|null;
      if(!s||typeof s.unconverged!=='number')throw checkpointError(`Subsystem "${options.id??'cloth'}": the saved state is malformed.`);
      (coupling??cloth).restoreState(s.state);unconverged=s.unconverged;
    },
    finish(ctx){
      if(coupling)coupling.contactChanges((body,index,touching)=>ctx.emit(touching?'contact-begin':'contact-end',{body,index}));
      if(cloth.stats.unconvergedSteps!==unconverged){unconverged=cloth.stats.unconvergedSteps;ctx.emit('unconverged',{residual:cloth.stats.residual,tolerance:cloth.stats.tolerance});}
    },
    energy(){
      const kinetic=cloth.kineticEnergy(),membrane=cloth.membraneEnergy(),bending=cloth.bendingEnergy(),potential=cloth.gravitationalEnergy(),contact=cloth.contactEnergy();
      return {domain:'mechanical',total:kinetic+membrane+bending+potential+contact,exchanged:cloth.externalWork,parts:{kinetic,membrane,bending,potential,contact}};
    },
    diagnostics(){return {solver:cloth.solver,backend:coupling?coupling.backend:null,scheme:cloth.scheme,nodes:cloth.nodeCount,triangles:cloth.triangleCount,time:cloth.time,...cloth.stats};},
  };
}
