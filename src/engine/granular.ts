/**
 * Granular media by the discrete element method (float64, JavaScript, deterministic). SI units.
 *
 * Grains are spheres of any radius with three translational and three rotational degrees of freedom. Two grains, or a
 * grain and a wall, interact only while they overlap by delta > 0, through
 *
 *   normal      'hertz':  F_n = (4/3) E* sqrt(R*) delta^(3/2) + alpha sqrt(m* k_H) delta^(1/4) d(delta)/dt
 *               'linear': F_n = k_n delta + alpha sqrt(m* k_n) d(delta)/dt
 *               never attractive: F_n is clamped at zero. alpha is solved numerically at construction so that a
 *               two-body impact rebounds with the restitution asked for (both laws give a restitution independent of
 *               the impact speed).
 *   tangential  a spring with history, F_t = -k_t xi - c_t v_t, capped by Coulomb's law |F_t| <= mu F_n. xi is the
 *               tangential displacement since the contact began, turned with the contact normal and cut back when the
 *               contact slides. 'hertz' uses the Mindlin no-slip stiffness k_t = 8 G* sqrt(R* delta); 'linear' a constant
 *               k_t (2/7 k_n by default).
 *   rolling     an elastic-plastic rolling spring: M_r = -k_r theta, k_r = k_t R*^2, capped by |M_r| <= mu_r R* F_n, with
 *               theta the accumulated relative rolling rotation.
 *
 * Time integration is velocity Verlet with one force evaluation per step, the contact forces being evaluated at the
 * new positions with the half-step velocities. The step must be a fraction of the shortest contact time: for 'hertz'
 * the Rayleigh time of the smallest grain, for 'linear' the contact duration pi sqrt(m* / k_n) of the lightest pair.
 * `addGrain` refuses a grain for which the configured step exceeds the limit, unless `allowUnstable` is set, in which
 * case `stats.unstable` is raised.
 *
 * Walls are planes, boxes, spheres, capsules and thin shells of revolution (cylinder, cone, annular plate: a silo with
 * a hopper and an orifice). A wall is static, kinematic (it moves as told) or dynamic (it has mass and inertia and is
 * integrated with the grains). Every wall accumulates the force, torque and impulse the grains put on it.
 *
 * Neighbours come from a uniform cell grid rebuilt when a grain has moved half the skin; grains are visited in index
 * order and cells in a fixed order, so repeat runs are bit-identical. A step uses only +, -, *, / and the square root,
 * which IEEE 754 rounds the same way everywhere.
 *
 * `GranularCoupling` joins the grains to a rigid world: each rigid step it copies the coupled bodies in as dynamic
 * walls, advances the grains by a whole number of their own steps with those bodies integrated alongside, and hands the
 * world the mean force and torque of the step. What the grains feel and what the bodies get are the same numbers with
 * opposite signs. `granularSubsystem` plugs either into the one stepping loop (simulation.ts).
 *
 * See docs/GRANULAR.md for the equations, the validation against closed forms and the limits.
 */
import {EngineError} from './contracts.ts';
import {captureFields,checkpointError,eachElement,holder,restoreFields,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';
import {principalMoments,type StructureInertia} from './structure-coupling.ts';
import type {Subsystem} from './simulation.ts';
import {HN,PLANE,BOX,SPHERE,CAPSULE,REVOLVED,STATIC,KINEMATIC,DYNAMIC,WALL_STRIDE,W_SHAPE,W_TYPE,W_R,W_X,W_V,W_W,W_DIM,W_CURVED,W_MASS,W_ALPHA,W_MU,W_MUR,W_REACH,
  PAIR_OUT,WALL_OUT,L_EN,L_PD,L_ET1,L_PT1,L_ET2,L_PT2,L_RATIO,P_H,P_HERTZ,P_KHERTZ,P_KMINDLIN,P_KN,P_KT,P_ALPHA,P_TDAMP,P_MU,P_MUR,P_MOVE,P_WALLS,P_COUNT,
  P_KICK,P_GX,P_GY,P_GZ,SUM_EN,SUM_ET,SUM_PD,SUM_PT,SUM_CONTACTS,SUM_WALL_CONTACTS,SUM_OVERLAP,SUM_EXCHANGE,SUM_WALLS,WALL_SUM,demSerial,demScratch,type DemContext,type DemExecutor} from './granular-kernels.ts';
export type {DemExecutor} from './granular-kernels.ts';
/** The fields the contact kernels read or write, which live in shared memory when an executor runs them on several threads. */
const SHARED_FIELDS=['positions','velocities','angularVelocities','radii','masses','pairStart','pairJ','pairH','pairOn','pairOut','wallStart','wallW','wallH','wallOn','wallSlack','wallOut',
  'wallTable','params','forces','torques','revStart','revK','alive','invMass','invInertia'] as const;

export const GRANULAR_SOLVER_ID='granular-dem-soft-sphere-verlet-js-f64-v1';
export const GRANULAR_COUPLING_BACKEND='rigid-granular-coupling-subcycled-js-f64-v1';
export const GRANULAR_MAX_GRAINS=1<<22;
/** Largest dt / critical time the solver accepts without `allowUnstable`: of the Rayleigh time for 'hertz', of the contact duration for 'linear'. */
export const GRANULAR_TIME_STEP_LIMIT=Object.freeze({hertz:0.4,linear:0.2});

export type GranularVec3=readonly [number,number,number];
export interface GranularMaterial {
  /** Density of the grain material, kg/m^3. */
  readonly density:number;
  /** Young's modulus, Pa. Needed by the 'hertz' law. */
  readonly youngModulus?:number;
  /** Poisson's ratio. Needed by the 'hertz' law. */
  readonly poissonRatio?:number;
  /** Coefficient of restitution of a two-grain impact, in [0.05, 1]. */
  readonly restitution:number;
  /** Coulomb coefficient between grains. */
  readonly friction:number;
  /** Rolling-resistance coefficient between grains: the limiting moment is rollingFriction * R* * F_n. Default 0. */
  readonly rollingFriction?:number;
}
export interface GranularConfig {
  /** Time step, s. */
  readonly dt:number;
  /** Most grains this instance will ever hold (removed grains keep their slot). */
  readonly capacity:number;
  readonly gravity?:GranularVec3;
  /** 'hertz' (default): Hertz normal law and Mindlin tangential stiffness. 'linear': constant stiffnesses, cheaper. */
  readonly law?:'hertz'|'linear';
  /** 'linear' only: normal stiffness k_n, N/m. */
  readonly normalStiffness?:number;
  /** 'linear' only: k_t / k_n. Default 2/7. */
  readonly tangentialStiffnessRatio?:number;
  /** Tangential dashpot as a fraction of the normal one's damping ratio: c_t = tangentialDamping * alpha * sqrt(m* k_t). Default 1; 0 leaves the tangential spring undamped below sliding. */
  readonly tangentialDamping?:number;
  /** Neighbour-list margin, m. Default: half the smallest radius at the first build. */
  readonly skin?:number;
  /** Accept a time step above the stability limit (see GRANULAR_TIME_STEP_LIMIT) and raise `stats.unstable` instead of throwing. */
  readonly allowUnstable?:boolean;
  /** Grains whose centre leaves this box are removed (their mass and energy are recorded). */
  readonly bounds?:{readonly min:GranularVec3;readonly max:GranularVec3};
}
export type GranularShape=
  /** The half space behind the plane through the wall position with this normal; grains live on the normal's side. */
  |{readonly kind:'plane';readonly normal:GranularVec3}
  |{readonly kind:'box';readonly halfExtents:GranularVec3}
  |{readonly kind:'sphere';readonly radius:number}
  /** Axis along the wall's local Y; halfLength is half the distance between the cap centres. */
  |{readonly kind:'capsule';readonly radius:number;readonly halfLength:number}
  /** A thin cylindrical shell about `axis` (default local Y) through the wall position, between the axial coordinates `from` and `to`. Grains touch it from either side. */
  |{readonly kind:'cylinder';readonly radius:number;readonly from:number;readonly to:number;readonly axis?:GranularVec3}
  /** A thin flat ring normal to `axis` at axial coordinate `offset` (default 0): a silo floor with an orifice of radius innerRadius. */
  |{readonly kind:'annulus';readonly innerRadius:number;readonly outerRadius:number;readonly offset?:number;readonly axis?:GranularVec3}
  /** A thin shell of revolution: the straight line from (radius r0, axial z0) to (r1, z1) turned about `axis`. A conical hopper. */
  |{readonly kind:'frustum';readonly r0:number;readonly z0:number;readonly r1:number;readonly z1:number;readonly axis?:GranularVec3};
export interface GranularWallState {
  readonly position:ArrayLike<number>;
  /** Quaternion x, y, z, w. */
  readonly rotation?:ArrayLike<number>;
  readonly linearVelocity?:ArrayLike<number>;
  readonly angularVelocity?:ArrayLike<number>;
}
export interface GranularWallOptions {
  readonly shape:GranularShape;
  /** Default 'static'. 'dynamic' needs a box, sphere or capsule and a mass. */
  readonly type?:'static'|'kinematic'|'dynamic';
  readonly position?:ArrayLike<number>;
  readonly rotation?:ArrayLike<number>;
  readonly linearVelocity?:ArrayLike<number>;
  readonly angularVelocity?:ArrayLike<number>;
  /** Dynamic walls: mass, kg, and rotational inertia (default: that of the shape with uniform density). */
  readonly mass?:number;
  readonly inertia?:StructureInertia;
  /** Dynamic walls: multiplies gravity. Default 1. */
  readonly gravityScale?:number;
  /** Grain-wall coefficients. Default: the grain material's. */
  readonly friction?:number;
  readonly rollingFriction?:number;
  readonly restitution?:number;
}
export interface GranularStats {
  steps:number;
  /** Neighbour-list builds. */
  rebuilds:number;
  /** Touching grain pairs and grain-wall contacts in the last force evaluation. */
  contacts:number;wallContacts:number;
  /** Candidate pairs in the neighbour list. */
  pairs:number;
  /** Largest overlap over the smaller radius of the pair, last step and since creation. */
  overlap:number;maxOverlap:number;
  /** Grains removed at the bounds, and their mass. */
  removed:number;removedMass:number;
  /** True when a grain was accepted above the time-step limit (`allowUnstable`). */
  unstable:boolean;
}
export interface GranularLattice {positions:Float64Array;radii:Float64Array;count:number}

const fail=(message:string):never=>{throw new EngineError('INVALID_PAYLOAD',message);};
const num=(value:unknown,label:string,min:number,max:number):number=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${label} must be a number in [${min}, ${max}].`);
  return value as number;
};
const vec=(value:ArrayLike<number>|undefined,label:string,fallback:readonly number[]):[number,number,number]=>{
  const v=value??fallback;
  if(!v||v.length<3||!Number.isFinite(v[0])||!Number.isFinite(v[1])||!Number.isFinite(v[2]))fail(`${label} must be three finite numbers.`);
  return [Number(v[0]),Number(v[1]),Number(v[2])];
};
const unit=(value:ArrayLike<number>|undefined,label:string,fallback:readonly number[]):[number,number,number]=>{
  const v=vec(value,label,fallback),l=Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
  if(!(l>1e-12))fail(`${label} must not be zero.`);
  return [v[0]/l,v[1]/l,v[2]/l];
};

// -------------------------------------------------------------------------------------------------
// Closed forms and the damping calibration.
// -------------------------------------------------------------------------------------------------

/** 2 * integral from 0 to 1 of dx / sqrt(1 - x^(5/2)) = (4/5) B(2/5, 1/2): Hertz contact duration over delta_max / v. */
export const HERTZ_DURATION_FACTOR=2.94327518432;

/** Effective modulus E* of two bodies of the same material: E / (2 (1 - nu^2)). */
export const granularEffectiveModulus=(youngModulus:number,poissonRatio:number):number=>youngModulus/(2*(1-poissonRatio*poissonRatio));
/** Effective shear modulus G* of two bodies of the same material: G / (2 (2 - nu)), G = E / (2 (1 + nu)). */
export const granularEffectiveShearModulus=(youngModulus:number,poissonRatio:number):number=>youngModulus/(4*(1+poissonRatio)*(2-poissonRatio));
/** Duration of an elastic Hertz impact: 2.943 delta_max / v with delta_max = (15 m* v^2 / (16 E* sqrt(R*)))^(2/5). */
export function hertzContactDuration(effectiveMass:number,effectiveRadius:number,effectiveModulus:number,speed:number):number {
  return HERTZ_DURATION_FACTOR*Math.pow(15*effectiveMass*speed*speed/(16*effectiveModulus*Math.sqrt(effectiveRadius)),0.4)/speed;
}
/** Time a Rayleigh surface wave takes around half a grain: pi r sqrt(rho / G) / (0.1631 nu + 0.8766). */
export function rayleighTime(radius:number,density:number,youngModulus:number,poissonRatio:number):number {
  return Math.PI*radius*Math.sqrt(density*2*(1+poissonRatio)/youngModulus)/(0.1631*poissonRatio+0.8766);
}

/** Restitution of the dimensionless impact x'' = -max(0, x^p + alpha x^((p-1)/2) x'), x(0) = 0, x'(0) = 1, by RK4. */
function impactRestitution(alpha:number,hertz:boolean):number {
  const force=(x:number,v:number):number=>{
    if(x<=0)return 0;
    const s=Math.sqrt(x),f=hertz?x*s+alpha*Math.sqrt(s)*v:x+alpha*v;
    return f>0?-f:0;
  };
  const h=1e-3;let x=0,v=1;
  for(let step=0;step<200000;step++){
    const k1x=v,k1v=force(x,v);
    const k2x=v+.5*h*k1v,k2v=force(x+.5*h*k1x,v+.5*h*k1v);
    const k3x=v+.5*h*k2v,k3v=force(x+.5*h*k2x,v+.5*h*k2v);
    const k4x=v+h*k3v,k4v=force(x+h*k3x,v+h*k3v);
    x+=h/6*(k1x+2*k2x+2*k3x+k4x);v+=h/6*(k1v+2*k2v+2*k3v+k4v);
    if(x<=0)return Math.max(0,-v);
    if(v<0&&force(x,v)===0)return -v;
  }
  return 0;
}
const dampingCache=new Map<string,number>();
/**
 * The damping coefficient alpha of the normal law that gives the restitution `e` in a two-body impact, found by
 * bisection on the integrated impact. The force is clamped at zero, so the textbook formulas, which let the contact pull
 * at the end of the impact, do not apply: the same restitution needs more damping here (for e = 0.5, 0.511 against
 * 2 zeta = 0.431 for the linear law). 'hertz': F_d = alpha sqrt(m* k_H) delta^(1/4) v; 'linear': F_d = alpha sqrt(m* k_n) v.
 */
export function granularDampingCoefficient(restitution:number,law:'hertz'|'linear'='hertz'):number {
  num(restitution,'restitution',0.05,1);
  if(law!=='hertz'&&law!=='linear')fail("law must be 'hertz' or 'linear'.");
  if(restitution===1)return 0;
  const key=`${law}:${restitution}`,known=dampingCache.get(key);
  if(known!==undefined)return known;
  let lo=0,hi=1;
  while(impactRestitution(hi,law==='hertz')>restitution&&hi<64)hi*=2;
  for(let i=0;i<48;i++){const mid=.5*(lo+hi);if(impactRestitution(mid,law==='hertz')>restitution)lo=mid;else hi=mid;}
  const alpha=.5*(lo+hi);dampingCache.set(key,alpha);return alpha;
}

/**
 * Grains on a cubic lattice filling the box [min, max]: spacing 2 * radius[1] * (1 + gap), radii drawn uniformly from
 * [radius[0], radius[1]] and centres moved by up to `jitter` of the free play, from a seeded generator (repeatable).
 */
export function granularLattice(options:{readonly min:GranularVec3;readonly max:GranularVec3;readonly radius:number|readonly [number,number];readonly gap?:number;readonly jitter?:number;readonly seed?:number;readonly inside?:(x:number,y:number,z:number,r:number)=>boolean}):GranularLattice {
  const lo=vec(options.min,'min',[0,0,0]),hi=vec(options.max,'max',[0,0,0]);
  const r0=typeof options.radius==='number'?options.radius:options.radius[0],r1=typeof options.radius==='number'?options.radius:options.radius[1];
  num(r0,'radius',1e-9,1e6);num(r1,'radius',r0,1e6);
  const gap=num(options.gap??0.05,'gap',0,10),jitter=num(options.jitter??0,'jitter',0,1),pitch=2*r1*(1+gap);
  let state=(options.seed??1)>>>0;
  const random=():number=>{state=(state+0x6D2B79F5)>>>0;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return ((t^(t>>>14))>>>0)/4294967296;};
  const n=[0,1,2].map(k=>Math.max(0,Math.floor((hi[k]-lo[k])/pitch+1e-9)));
  const total=n[0]*n[1]*n[2];
  if(total>GRANULAR_MAX_GRAINS)fail(`The lattice would hold ${total} grains: more than ${GRANULAR_MAX_GRAINS}.`);
  const positions=new Float64Array(3*total),radii=new Float64Array(total);let count=0;
  for(let j=0;j<n[1];j++)for(let k=0;k<n[2];k++)for(let i=0;i<n[0];i++){
    const r=r0+(r1-r0)*random(),play=jitter*(pitch/2-r);
    const x=lo[0]+(i+.5)*pitch+play*(2*random()-1),y=lo[1]+(j+.5)*pitch+play*(2*random()-1),z=lo[2]+(k+.5)*pitch+play*(2*random()-1);
    if(options.inside&&!options.inside(x,y,z,r))continue;
    positions[3*count]=x;positions[3*count+1]=y;positions[3*count+2]=z;radii[count++]=r;
  }
  return {positions:positions.slice(0,3*count),radii:radii.slice(0,count),count};
}

// -------------------------------------------------------------------------------------------------
// Walls.
// -------------------------------------------------------------------------------------------------

// Numbers kept per contact (HN = 13, granular-kernels.ts): tangential displacement (3), rolling rotation (3), and the last
// step's dissipative normal force (1), tangential force (3) and rolling moment (3), which make the energy ledger second
// order in the time step.

class Wall {
  shape=PLANE;type=STATIC;enabled=true;
  /** plane: local normal. box: half extents. sphere: radius. capsule: radius, half length. revolved: axis (3), r0, z0, r1, z1. */
  readonly dim=new Float64Array(7);
  readonly x=new Float64Array(3);readonly q=new Float64Array([0,0,0,1]);readonly R=new Float64Array([1,0,0,0,1,0,0,0,1]);
  readonly v=new Float64Array(3);readonly w=new Float64Array(3);
  mass=0;invMass=0;readonly invInertia=new Float64Array(3);gravityScale=1;
  /** Force and torque (about the wall position) from the grains at the last force evaluation, and their time integrals. */
  readonly force=new Float64Array(3);readonly torque=new Float64Array(3);
  readonly impulse=new Float64Array(3);readonly angularImpulse=new Float64Array(3);
  /** Sum of the normal force magnitudes and number of touching grains at the last force evaluation. */
  normalLoad=0;contacts=0;
  /** Load from outside the grains (supports, joints), N and N m, held constant over a step. */
  readonly external=new Float64Array(6);
  friction=0;rollingFriction=0;alpha=0;curved=0;
  /** Not state (rebuilt after a restore): the pose at the last force evaluation and the radius of a sphere about the
   * wall position that holds the whole surface (Infinity for a plane), which bound how far the surface moved since. */
  readonly seenX=new Float64Array(3);readonly seenQ=new Float64Array(4);seen=false;reach=Infinity;
  refresh():void {
    const q=this.q,l=Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3])||1,x=q[0]/l,y=q[1]/l,z=q[2]/l,w=q[3]/l,R=this.R;
    q[0]=x;q[1]=y;q[2]=z;q[3]=w;
    R[0]=1-2*(y*y+z*z);R[1]=2*(x*y-z*w);R[2]=2*(x*z+y*w);
    R[3]=2*(x*y+z*w);R[4]=1-2*(x*x+z*z);R[5]=2*(y*z-x*w);
    R[6]=2*(x*z-y*w);R[7]=2*(y*z+x*w);R[8]=1-2*(x*x+y*y);
  }
  /** q <- q + (h / 2) omega q, normalised. */
  rotate(h:number):void {
    const w=this.w,q=this.q,wx=w[0],wy=w[1],wz=w[2];
    if(wx===0&&wy===0&&wz===0)return;
    const x=q[0],y=q[1],z=q[2],s=q[3],k=.5*h;
    q[0]=x+k*(wx*s+wy*z-wz*y);q[1]=y+k*(wy*s+wz*x-wx*z);q[2]=z+k*(wz*s+wx*y-wy*x);q[3]=s-k*(wx*x+wy*y+wz*z);
    this.refresh();
  }
  /** omega += h * I^-1 torque, with I principal in the wall's axes (no gyroscopic term). */
  spin(h:number,tx:number,ty:number,tz:number):void {
    const R=this.R,I=this.invInertia;
    const lx=(R[0]*tx+R[3]*ty+R[6]*tz)*I[0],ly=(R[1]*tx+R[4]*ty+R[7]*tz)*I[1],lz=(R[2]*tx+R[5]*ty+R[8]*tz)*I[2];
    this.w[0]+=h*(R[0]*lx+R[1]*ly+R[2]*lz);this.w[1]+=h*(R[3]*lx+R[4]*ly+R[5]*lz);this.w[2]+=h*(R[6]*lx+R[7]*ly+R[8]*lz);
  }
}

// -------------------------------------------------------------------------------------------------
// The solver.
// -------------------------------------------------------------------------------------------------

/** Fields that only make a step cheaper and are rebuilt after a restore: not part of a checkpoint (whose bytes stay those
 * of a solver without them). */
const GRANULAR_DERIVED=['wallSlack','grainMove','pairOut','wallOut','wallTable','params','revStart','revK','scratch','context','moveScratch','executor','sums','terms'],WALL_DERIVED=['seenX','seenQ','seen','reach'];

/** What an exact checkpoint of a Granular holds: every field (grains, the tangential springs of every contact, the
 * neighbour lists, ledgers and statistics); the walls keep their identity. */
const GRANULAR_FIELDS:FieldOptions={label:'Granular',skip:GRANULAR_DERIVED,nested:{walls:eachElement({label:'Granular wall',skip:WALL_DERIVED})}};
/** What an exact checkpoint of a GranularCoupling holds: the grain set and the coupled bodies' records. */
const GRANULAR_COUPLING_FIELDS:FieldOptions={label:'GranularCoupling',skip:['world','byBody'],nested:{granular:holder,list:eachElement({label:'GranularCoupling body'})}};

export class Granular {
  /** Everything a later step reads, as a state tree (checkpoint.ts), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,GRANULAR_FIELDS);}
  /** Put back a state from `saveState()` of a grain set built the same way (same material, settings and walls; the grains themselves are restored). */
  restoreState(state:StateValue):void {
    restoreFields(this,state,GRANULAR_FIELDS);
    // The restored lists may be longer than the work space.
    const pairs=this.pairJ.length,cands=this.wallW.length;
    if(this.pairOut.length<PAIR_OUT*pairs){this.pairOut=new Float64Array(PAIR_OUT*pairs);this.revK=new Int32Array(pairs);}
    if(this.wallOut.length<WALL_OUT*cands){this.wallOut=new Float64Array(WALL_OUT*cands);this.wallSlack=new Float64Array(cands);}
    this.reverseLists();this.forgetSlack();
  }
  /** Measure every wall candidate at the next force evaluation. */
  private forgetSlack():void {this.wallSlack.fill(-Infinity);this.grainMove=0;for(const wall of this.walls)wall.seen=false;}

  readonly solver=GRANULAR_SOLVER_ID;
  readonly dt:number;readonly capacity:number;readonly law:'hertz'|'linear';
  readonly gravity:Float64Array;
  readonly material:Required<GranularMaterial>;
  /** Live state, three numbers per grain (positions m, velocities m/s, angular velocities rad/s). Call `touch()` after writing positions. */
  readonly positions:Float64Array;readonly velocities:Float64Array;readonly angularVelocities:Float64Array;
  readonly radii:Float64Array;readonly masses:Float64Array;
  /** 1 while the grain is in the simulation. */
  readonly alive:Uint8Array;
  /** Contact force and torque on each grain at the last force evaluation (gravity not included). */
  readonly forces:Float64Array;readonly torques:Float64Array;
  readonly stats:GranularStats={steps:0,rebuilds:0,contacts:0,wallContacts:0,pairs:0,overlap:0,maxOverlap:0,removed:0,removedMass:0,unstable:false};
  time=0;
  /** Energy removed by the normal dashpots, and by sliding, rolling resistance and the tangential dashpots, J. */
  dissipatedDamping=0;dissipatedFriction=0;
  /** Work done on the grains by moving walls, less the energy of removed grains, J. */
  externalWork=0;
  /** dt over the critical time of the most demanding grain so far (see GRANULAR_TIME_STEP_LIMIT). */
  timeStepFraction=0;
  /** The critical time the fraction refers to, s: Rayleigh time ('hertz') or contact duration ('linear') of the smallest grain. */
  criticalTime=Infinity;

  private n=0;private live=0;
  private readonly invMass:Float64Array;private readonly invInertia:Float64Array;
  private readonly built:Float64Array;private builtCount=0;
  private readonly hertz:boolean;private readonly kHertz:number;private readonly kMindlin:number;private readonly kn:number;private readonly kt:number;
  private readonly alpha:number;private readonly tangentialDamping:number;private readonly allowUnstable:boolean;
  private skin:number;private readonly bounds:Float64Array|null;
  private readonly walls:Wall[]=[];
  // Neighbour lists: for grain i the candidates j > i, and the candidate walls. HN history numbers per entry.
  private pairStart:Int32Array;private pairJ:Int32Array;private pairH:Float64Array;private pairOn:Uint8Array;
  private oldStart:Int32Array;private oldJ:Int32Array;private oldH:Float64Array;private oldOn:Uint8Array;
  private wallStart:Int32Array;private wallW:Int32Array;private wallH:Float64Array;private wallOn:Uint8Array;
  private oldWallStart:Int32Array;private oldWallW:Int32Array;private oldWallH:Float64Array;private oldWallOn:Uint8Array;
  private cellStart=new Int32Array(1);private cellItems:Int32Array;private cellOf:Int32Array;
  private dirty=true;private fresh=false;
  /**
   * Wall candidates far from their wall are not measured every step. For each candidate, a lower bound of
   * (distance to the wall - radius) when it was last measured, less how far the grain and the wall could have moved
   * since; while it stays positive the grain cannot touch the wall and the candidate is skipped, exactly as a measured
   * gap would be (no force, history already zero). -Infinity: measure. `grainMove` is the largest distance any grain
   * moved since the last force evaluation (an upper bound).
   */
  private wallSlack:Float64Array;private grainMove=0;
  /**
   * The contacts are evaluated by `demContacts` (granular-kernels.ts) into per-contact contributions, then summed here in
   * the order of a single loop over the pairs (grain by grain) and then the wall candidates. For each grain, the pairs
   * where it is the second grain, in list order (revStart, revK: built with the lists), come before its own: that is
   * when a single loop added them. Derived, not state.
   */
  private pairOut:Float64Array;private wallOut:Float64Array;private wallTable=new Float64Array(0);private readonly params=new Float64Array(P_COUNT);
  private revStart:Int32Array;private revK:Int32Array;private readonly scratch=demScratch();private sums=new Float64Array(0);private readonly terms=new Float64Array(8);private context:DemContext|null=null;private executor:DemExecutor|null=null;
  // Scratch of the contact kernel: normal, relative velocity, relative spin in; force, tangential force, rolling moment out.
  private readonly S=new Float64Array(18);
  private readonly gn=new Float64Array(3);private readonly gc=new Float64Array(3);
  private eNormal=0;private eTangent=0;private eTangentBefore=0;private pDamp=0;private pTangent=0;
  private rMin=Infinity;private rMax=0;

  constructor(options:{readonly material:GranularMaterial;readonly config:GranularConfig}) {
    if(!options||typeof options!=='object'||!options.material||!options.config)fail('Granular needs {material, config}.');
    const m=options.material,c=options.config;
    this.dt=num(c.dt,'config.dt',1e-12,1);
    this.capacity=num(c.capacity,'config.capacity',1,GRANULAR_MAX_GRAINS);
    if(!Number.isInteger(this.capacity))fail('config.capacity must be an integer.');
    this.law=c.law??'hertz';
    if(this.law!=='hertz'&&this.law!=='linear')fail("config.law must be 'hertz' or 'linear'.");
    this.hertz=this.law==='hertz';
    this.gravity=Float64Array.from(vec(c.gravity,'config.gravity',[0,-9.81,0]));
    const density=num(m.density,'material.density',1e-6,1e9),restitution=num(m.restitution,'material.restitution',0.05,1);
    const friction=num(m.friction,'material.friction',0,1e6),rolling=num(m.rollingFriction??0,'material.rollingFriction',0,1e6);
    let young=0,nu=0;
    if(this.hertz){
      young=num(m.youngModulus,'material.youngModulus',1e-6,1e15);nu=num(m.poissonRatio,'material.poissonRatio',-0.99,0.4999);
      if(c.normalStiffness!==undefined)fail("config.normalStiffness belongs to the 'linear' law.");
      this.kHertz=4/3*granularEffectiveModulus(young,nu);this.kMindlin=8*granularEffectiveShearModulus(young,nu);this.kn=0;this.kt=0;
    }else{
      this.kn=num(c.normalStiffness,'config.normalStiffness',1e-12,1e30);
      this.kt=this.kn*num(c.tangentialStiffnessRatio??2/7,'config.tangentialStiffnessRatio',1e-6,1e3);
      this.kHertz=0;this.kMindlin=0;young=m.youngModulus??0;nu=m.poissonRatio??0;
    }
    this.material={density,youngModulus:young,poissonRatio:nu,restitution,friction,rollingFriction:rolling};
    this.alpha=granularDampingCoefficient(restitution,this.law);
    this.tangentialDamping=num(c.tangentialDamping??1,'config.tangentialDamping',0,1e3);
    this.allowUnstable=c.allowUnstable===true;
    this.skin=c.skin===undefined?0:num(c.skin,'config.skin',1e-12,1e6);
    if(c.bounds){const lo=vec(c.bounds.min,'bounds.min',[0,0,0]),hi=vec(c.bounds.max,'bounds.max',[0,0,0]);if(!(hi[0]>lo[0]&&hi[1]>lo[1]&&hi[2]>lo[2]))fail('bounds.max must exceed bounds.min.');this.bounds=Float64Array.from([...lo,...hi]);}
    else this.bounds=null;
    const C=this.capacity;
    this.positions=new Float64Array(3*C);this.velocities=new Float64Array(3*C);this.angularVelocities=new Float64Array(3*C);
    this.forces=new Float64Array(3*C);this.torques=new Float64Array(3*C);this.built=new Float64Array(3*C);
    this.radii=new Float64Array(C);this.masses=new Float64Array(C);this.invMass=new Float64Array(C);this.invInertia=new Float64Array(C);
    this.alive=new Uint8Array(C);
    this.pairStart=new Int32Array(C+1);this.oldStart=new Int32Array(C+1);this.wallStart=new Int32Array(C+1);this.oldWallStart=new Int32Array(C+1);
    const guess=Math.max(64,8*C);
    this.pairJ=new Int32Array(guess);this.pairH=new Float64Array(HN*guess);this.pairOn=new Uint8Array(guess);
    this.oldJ=new Int32Array(guess);this.oldH=new Float64Array(HN*guess);this.oldOn=new Uint8Array(guess);
    const wallGuess=Math.max(64,2*C);
    this.wallW=new Int32Array(wallGuess);this.wallH=new Float64Array(HN*wallGuess);this.wallOn=new Uint8Array(wallGuess);
    this.oldWallW=new Int32Array(wallGuess);this.oldWallH=new Float64Array(HN*wallGuess);this.oldWallOn=new Uint8Array(wallGuess);
    this.wallSlack=new Float64Array(wallGuess).fill(-Infinity);
    this.pairOut=new Float64Array(PAIR_OUT*guess);this.wallOut=new Float64Array(WALL_OUT*wallGuess);
    this.revStart=new Int32Array(C+1);this.revK=new Int32Array(guess);
    this.cellItems=new Int32Array(C);this.cellOf=new Int32Array(C);
  }

  // ---- grains ----

  /** Grains ever added (indices run from 0 to this, removed ones included). */
  get grainCount():number {return this.n;}
  /** Grains in the simulation now. */
  get liveCount():number {return this.live;}
  /** The critical time of a grain of this radius: Rayleigh time ('hertz') or the contact duration of two such grains ('linear'). */
  criticalTimeFor(radius:number):number {
    const mat=this.material;
    if(this.hertz)return rayleighTime(radius,mat.density,mat.youngModulus,mat.poissonRatio);
    const mass=mat.density*4/3*Math.PI*radius*radius*radius;
    return Math.PI*Math.sqrt(.5*mass/this.kn);
  }
  /** The largest time step the solver accepts for a grain of this radius. */
  maxTimeStepFor(radius:number):number {return GRANULAR_TIME_STEP_LIMIT[this.law]*this.criticalTimeFor(radius);}
  addGrain(position:ArrayLike<number>,radius:number,velocity?:ArrayLike<number>,angularVelocity?:ArrayLike<number>):number {
    if(this.n>=this.capacity)fail(`This Granular holds at most ${this.capacity} grains.`);
    const p=vec(position,'position',[0,0,0]),v=vec(velocity,'velocity',[0,0,0]),w=vec(angularVelocity,'angularVelocity',[0,0,0]);
    num(radius,'radius',1e-9,1e6);
    const critical=this.criticalTimeFor(radius),fraction=this.dt/critical;
    if(fraction>GRANULAR_TIME_STEP_LIMIT[this.law]){
      if(!this.allowUnstable)throw new EngineError('UNSTABLE_TIME_STEP',`dt = ${this.dt} s is ${fraction.toFixed(3)} of the critical time ${critical.toExponential(3)} s of a grain of radius ${radius} m; the limit is ${GRANULAR_TIME_STEP_LIMIT[this.law]}. Use dt <= ${(GRANULAR_TIME_STEP_LIMIT[this.law]*critical).toExponential(3)} s, a softer or larger grain, or allowUnstable.`);
      this.stats.unstable=true;
    }
    if(fraction>this.timeStepFraction){this.timeStepFraction=fraction;this.criticalTime=critical;}
    const i=this.n++,mass=this.material.density*4/3*Math.PI*radius*radius*radius;
    this.positions.set(p,3*i);this.velocities.set(v,3*i);this.angularVelocities.set(w,3*i);
    this.radii[i]=radius;this.masses[i]=mass;this.invMass[i]=1/mass;this.invInertia[i]=1/(.4*mass*radius*radius);this.alive[i]=1;this.live++;
    if(radius<this.rMin)this.rMin=radius;
    if(radius>this.rMax)this.rMax=radius;
    this.dirty=true;this.fresh=false;return i;
  }
  /** Add many grains: `positions` holds three numbers per grain. Returns the index of the first. */
  addGrains(positions:ArrayLike<number>,radii:ArrayLike<number>|number,velocities?:ArrayLike<number>):number {
    const count=Math.floor(positions.length/3),first=this.n;
    for(let k=0;k<count;k++)this.addGrain([positions[3*k],positions[3*k+1],positions[3*k+2]],typeof radii==='number'?radii:radii[k],velocities?[velocities[3*k],velocities[3*k+1],velocities[3*k+2]]:undefined);
    return first;
  }
  /** Take a grain out of the simulation. Its energy leaves through `externalWork`. */
  removeGrain(index:number):void {
    const i=this.grain(index);if(!this.alive[i])return;
    this.externalWork-=this.grainEnergy(i);
    this.alive[i]=0;this.live--;this.stats.removed++;this.stats.removedMass+=this.masses[i];
    this.velocities.fill(0,3*i,3*i+3);this.angularVelocities.fill(0,3*i,3*i+3);this.forces.fill(0,3*i,3*i+3);this.torques.fill(0,3*i,3*i+3);
    this.dirty=true;this.fresh=false;
  }
  private grain(i:number):number {if(!Number.isInteger(i)||i<0||i>=this.n)fail(`${i} is not a grain.`);return i;}
  private grainEnergy(i:number):number {
    const v=this.velocities,w=this.angularVelocities,x=this.positions,g=this.gravity,m=this.masses[i];
    return .5*m*(v[3*i]*v[3*i]+v[3*i+1]*v[3*i+1]+v[3*i+2]*v[3*i+2])+.5/this.invInertia[i]*(w[3*i]*w[3*i]+w[3*i+1]*w[3*i+1]+w[3*i+2]*w[3*i+2])-m*(g[0]*x[3*i]+g[1]*x[3*i+1]+g[2]*x[3*i+2]);
  }
  /** Tell the solver that positions or velocities were written from outside: the neighbour list and the forces are recomputed. */
  touch():void {this.dirty=true;this.fresh=false;}

  // ---- walls ----

  get wallCount():number {return this.walls.length;}
  private wall(index:number):Wall {const w=this.walls[index];if(!w)fail(`${index} is not a wall of this Granular.`);return w;}
  addWall(options:GranularWallOptions):number {
    if(!options||typeof options!=='object'||!options.shape)fail('addWall needs {shape}.');
    const wall=new Wall(),shape=options.shape,d=wall.dim,type=options.type??'static';
    wall.type=type==='static'?STATIC:type==='kinematic'?KINEMATIC:type==='dynamic'?DYNAMIC:fail(`Unknown wall type "${type}".`);
    const revolved=(axis:GranularVec3|undefined,r0:number,z0:number,r1:number,z1:number):void=>{
      num(r0,'radius',0,1e9);num(r1,'radius',0,1e9);num(z0,'axial coordinate',-1e9,1e9);num(z1,'axial coordinate',-1e9,1e9);
      if(r0===r1&&z0===z1)fail('The generating line of a shell needs two different ends.');
      wall.shape=REVOLVED;d.set(unit(axis,'axis',[0,1,0]),0);d[3]=r0;d[4]=z0;d[5]=r1;d[6]=z1;
    };
    switch(shape.kind){
      case 'plane':wall.shape=PLANE;d.set(unit(shape.normal,'normal',[0,1,0]),0);break;
      case 'box':{wall.shape=BOX;const h=vec(shape.halfExtents,'halfExtents',[0,0,0]);for(let k=0;k<3;k++)d[k]=num(h[k],'halfExtents',1e-9,1e9);break;}
      case 'sphere':wall.shape=SPHERE;d[0]=num(shape.radius,'radius',1e-9,1e9);wall.curved=d[0];break;
      case 'capsule':wall.shape=CAPSULE;d[0]=num(shape.radius,'radius',1e-9,1e9);d[1]=num(shape.halfLength,'halfLength',0,1e9);wall.curved=d[0];break;
      case 'cylinder':revolved(shape.axis,shape.radius,shape.from,shape.radius,shape.to);break;
      case 'annulus':revolved(shape.axis,shape.innerRadius,shape.offset??0,shape.outerRadius,shape.offset??0);break;
      case 'frustum':revolved(shape.axis,shape.r0,shape.z0,shape.r1,shape.z1);break;
      default:fail(`Unknown wall shape "${(shape as {kind:string}).kind}".`);
    }
    if(wall.type===DYNAMIC){
      if(wall.shape!==BOX&&wall.shape!==SPHERE&&wall.shape!==CAPSULE)fail('A dynamic wall must be a box, a sphere or a capsule.');
      wall.mass=num(options.mass,'mass',1e-12,1e15);wall.invMass=1/wall.mass;
      const inertia=options.inertia??(wall.shape===BOX?{kind:'box',halfExtents:[d[0],d[1],d[2]]} as StructureInertia:wall.shape===SPHERE?{kind:'sphere',radius:d[0]} as StructureInertia:{kind:'capsule',radius:d[0],halfLength:d[1]} as StructureInertia);
      const moments=principalMoments(inertia,wall.mass);
      for(let k=0;k<3;k++)wall.invInertia[k]=moments?1/moments[k]:0;
      wall.gravityScale=num(options.gravityScale??1,'gravityScale',-1e6,1e6);
    }
    wall.reach=wall.shape===PLANE?Infinity:wall.shape===BOX?Math.sqrt(d[0]*d[0]+d[1]*d[1]+d[2]*d[2]):wall.shape===SPHERE?d[0]:wall.shape===CAPSULE?d[0]+d[1]:
      Math.max(Math.sqrt(d[3]*d[3]+d[4]*d[4]),Math.sqrt(d[5]*d[5]+d[6]*d[6]));
    wall.friction=num(options.friction??this.material.friction,'friction',0,1e6);
    wall.rollingFriction=num(options.rollingFriction??this.material.rollingFriction,'rollingFriction',0,1e6);
    wall.alpha=options.restitution===undefined?this.alpha:granularDampingCoefficient(options.restitution,this.law);
    this.walls.push(wall);
    this.setWallState(this.walls.length-1,{position:options.position??[0,0,0],rotation:options.rotation,linearVelocity:options.linearVelocity,angularVelocity:options.angularVelocity});
    return this.walls.length-1;
  }
  /** Place a wall and set its velocities. A static wall keeps zero velocity. */
  setWallState(index:number,state:GranularWallState):void {
    const wall=this.wall(index);
    wall.x.set(vec(state.position,'position',[0,0,0]));
    if(state.rotation){const q=state.rotation;if(q.length<4||!(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]>1e-24))fail('rotation must be a quaternion x, y, z, w.');wall.q[0]=q[0];wall.q[1]=q[1];wall.q[2]=q[2];wall.q[3]=q[3];}
    wall.refresh();
    if(wall.type!==STATIC){wall.v.set(vec(state.linearVelocity,'linearVelocity',[0,0,0]));wall.w.set(vec(state.angularVelocity,'angularVelocity',[0,0,0]));}
    else if(state.linearVelocity||state.angularVelocity){const v=vec(state.linearVelocity,'linearVelocity',[0,0,0]),w=vec(state.angularVelocity,'angularVelocity',[0,0,0]);if(v.some(c=>c!==0)||w.some(c=>c!==0))fail("A static wall cannot move: make it 'kinematic'.");}
    if(wall.type===STATIC){this.dirty=true;this.fresh=false;}
  }
  /** Velocities of a kinematic wall from now on. */
  setWallVelocity(index:number,linearVelocity:ArrayLike<number>,angularVelocity?:ArrayLike<number>):void {
    const wall=this.wall(index);if(wall.type!==KINEMATIC)fail('Only a kinematic wall takes a velocity.');
    wall.v.set(vec(linearVelocity,'linearVelocity',[0,0,0]));wall.w.set(vec(angularVelocity,'angularVelocity',[0,0,0]));
  }
  /** Switch a wall off (a gate opened, a retaining wall lifted away) or back on. */
  setWallEnabled(index:number,enabled:boolean):void {const wall=this.wall(index);if(wall.enabled!==enabled){wall.enabled=enabled;this.dirty=true;this.fresh=false;}}
  setWallMass(index:number,mass:number):void {
    const wall=this.wall(index);if(wall.type!==DYNAMIC)fail('Only a dynamic wall has a mass.');
    if(mass===wall.mass)return;
    num(mass,'mass',1e-12,1e15);const scale=wall.mass/mass;wall.mass=mass;wall.invMass=1/mass;for(let k=0;k<3;k++)wall.invInertia[k]*=scale;
  }
  /** Force (N) and moment (N m) from supports and joints on a dynamic wall, held until changed. Six numbers from `offset`. */
  setWallExternalLoad(index:number,load:ArrayLike<number>,offset=0):void {const wall=this.wall(index);for(let k=0;k<6;k++)wall.external[k]=Number(load[offset+k])||0;}
  wallPosition(index:number):Float64Array {return this.wall(index).x;}
  wallRotation(index:number):Float64Array {return this.wall(index).q;}
  wallLinearVelocity(index:number):Float64Array {return this.wall(index).v;}
  wallAngularVelocity(index:number):Float64Array {return this.wall(index).w;}
  wallMass(index:number):number {return this.wall(index).mass;}
  /** Force the grains put on the wall at the last force evaluation, N. Live array. */
  wallForce(index:number):Float64Array {return this.wall(index).force;}
  /** Moment of that force about the wall position, N m. Live array. */
  wallTorque(index:number):Float64Array {return this.wall(index).torque;}
  /** Time integral of the force and of the moment since `resetWallImpulses`, N s and N m s. Live arrays. */
  wallImpulse(index:number):Float64Array {return this.wall(index).impulse;}
  wallAngularImpulse(index:number):Float64Array {return this.wall(index).angularImpulse;}
  /** Sum of the normal-force magnitudes of the wall's contacts at the last force evaluation, N. */
  wallNormalLoad(index:number):number {return this.wall(index).normalLoad;}
  /** Grains touching the wall at the last force evaluation. */
  wallContacts(index:number):number {return this.wall(index).contacts;}
  resetWallImpulses(index?:number):void {
    for(let k=0;k<this.walls.length;k++)if(index===undefined||index===k){this.walls[k].impulse.fill(0);this.walls[k].angularImpulse.fill(0);}
  }

  // ---- diagnostics ----

  mass():number {let sum=0;for(let i=0;i<this.n;i++)if(this.alive[i])sum+=this.masses[i];return sum;}
  kineticEnergy():number {
    const v=this.velocities,w=this.angularVelocities;let sum=0;
    for(let i=0;i<this.n;i++){
      if(!this.alive[i])continue;
      sum+=.5*this.masses[i]*(v[3*i]*v[3*i]+v[3*i+1]*v[3*i+1]+v[3*i+2]*v[3*i+2])+.5/this.invInertia[i]*(w[3*i]*w[3*i]+w[3*i+1]*w[3*i+1]+w[3*i+2]*w[3*i+2]);
    }
    return sum;
  }
  /** -sum of m g.x, J. */
  gravitationalEnergy():number {
    const x=this.positions,g=this.gravity;let sum=0;
    for(let i=0;i<this.n;i++)if(this.alive[i])sum-=this.masses[i]*(g[0]*x[3*i]+g[1]*x[3*i+1]+g[2]*x[3*i+2]);
    return sum;
  }
  /** Energy stored in the normal springs, and in the tangential and rolling springs, J. */
  normalElasticEnergy():number {this.prepare();return this.eNormal;}
  tangentialElasticEnergy():number {this.prepare();return this.eTangent;}
  elasticEnergy():number {this.prepare();return this.eNormal+this.eTangent;}
  /** kinetic + gravitational + elastic, J. With the dissipated energies and less `externalWork` it is constant up to the time-stepping error. */
  mechanicalEnergy():number {return this.kineticEnergy()+this.gravitationalEnergy()+this.elasticEnergy();}
  /** mechanicalEnergy + dissipatedDamping + dissipatedFriction - externalWork: the conserved sum. */
  energyBalance():number {return this.mechanicalEnergy()+this.dissipatedDamping+this.dissipatedFriction-this.externalWork;}
  linearMomentum(out:number[]|Float64Array=[0,0,0]):number[]|Float64Array {
    const v=this.velocities;out[0]=out[1]=out[2]=0;
    for(let i=0;i<this.n;i++)if(this.alive[i]){const m=this.masses[i];out[0]+=m*v[3*i];out[1]+=m*v[3*i+1];out[2]+=m*v[3*i+2];}
    return out;
  }
  /** Angular momentum about the origin (orbital and spin), kg m^2/s. */
  angularMomentum(out:number[]|Float64Array=[0,0,0]):number[]|Float64Array {
    const v=this.velocities,x=this.positions,w=this.angularVelocities;out[0]=out[1]=out[2]=0;
    for(let i=0;i<this.n;i++)if(this.alive[i]){
      const m=this.masses[i],I=1/this.invInertia[i],a=3*i;
      out[0]+=m*(x[a+1]*v[a+2]-x[a+2]*v[a+1])+I*w[a];out[1]+=m*(x[a+2]*v[a]-x[a]*v[a+2])+I*w[a+1];out[2]+=m*(x[a]*v[a+1]-x[a+1]*v[a])+I*w[a+2];
    }
    return out;
  }
  /** Mean number of contacts per live grain (walls included) at the last force evaluation. */
  coordination():number {this.prepare();return this.live?(2*this.stats.contacts+this.stats.wallContacts)/this.live:0;}

  // ---- neighbour lists ----

  private growPairs(need:number):void {
    let size=this.pairJ.length;if(need<=size)return;
    while(size<need)size*=2;
    const J=new Int32Array(size),H=new Float64Array(HN*size),on=new Uint8Array(size);
    J.set(this.pairJ);H.set(this.pairH);on.set(this.pairOn);this.pairJ=J;this.pairH=H;this.pairOn=on;
    if(this.revK.length<size){this.revK=new Int32Array(size);this.pairOut=new Float64Array(PAIR_OUT*size);}
  }
  private growWalls(need:number):void {
    let size=this.wallW.length;if(need<=size)return;
    while(size<need)size*=2;
    const W=new Int32Array(size),H=new Float64Array(HN*size),on=new Uint8Array(size);
    W.set(this.wallW);H.set(this.wallH);on.set(this.wallOn);this.wallW=W;this.wallH=H;this.wallOn=on;
    if(this.wallSlack.length<size){const slack=new Float64Array(size);slack.set(this.wallSlack);this.wallSlack=slack;this.wallOut=new Float64Array(WALL_OUT*size);}
  }
  private rebuild():void {
    const n=this.n,x=this.positions,r=this.radii,alive=this.alive;
    if(this.skin===0&&this.rMin<Infinity)this.skin=.5*this.rMin;
    const skin=this.skin;
    // Swap: the lists of the previous build become the place to look histories up.
    let a=this.pairStart;this.pairStart=this.oldStart;this.oldStart=a;
    let b=this.pairJ;this.pairJ=this.oldJ;this.oldJ=b;
    let c=this.pairH;this.pairH=this.oldH;this.oldH=c;
    let o=this.pairOn;this.pairOn=this.oldOn;this.oldOn=o;
    a=this.wallStart;this.wallStart=this.oldWallStart;this.oldWallStart=a;
    b=this.wallW;this.wallW=this.oldWallW;this.oldWallW=b;
    c=this.wallH;this.wallH=this.oldWallH;this.oldWallH=c;
    o=this.wallOn;this.wallOn=this.oldWallOn;this.oldWallOn=o;
    const before=this.builtCount,oldStart=this.oldStart,oldJ=this.oldJ,oldH=this.oldH,oldOn=this.oldOn;
    // Cell grid over the live grains.
    let x0=Infinity,y0=Infinity,z0=Infinity,x1=-Infinity,y1=-Infinity,z1=-Infinity,live=0;
    for(let i=0;i<n;i++){
      if(!alive[i])continue;live++;
      const px=x[3*i],py=x[3*i+1],pz=x[3*i+2];
      if(px<x0)x0=px;if(px>x1)x1=px;if(py<y0)y0=py;if(py>y1)y1=py;if(pz<z0)z0=pz;if(pz>z1)z1=pz;
    }
    let cell=2*this.rMax+skin,nx=1,ny=1,nz=1;
    if(live>0){
      const limit=Math.max(4096,8*live);
      for(;;){
        nx=Math.floor((x1-x0)/cell)+1;ny=Math.floor((y1-y0)/cell)+1;nz=Math.floor((z1-z0)/cell)+1;
        if(nx*ny*nz<=limit)break;
        cell*=1.5;
      }
    }
    const cells=nx*ny*nz,inv=1/cell;
    if(this.cellStart.length<cells+1)this.cellStart=new Int32Array(cells+1);
    const start=this.cellStart,items=this.cellItems,cellOf=this.cellOf;
    start.fill(0,0,cells+1);
    for(let i=0;i<n;i++){
      if(!alive[i])continue;
      const ci=Math.floor((x[3*i]-x0)*inv)+nx*(Math.floor((x[3*i+1]-y0)*inv)+ny*Math.floor((x[3*i+2]-z0)*inv));
      cellOf[i]=ci;start[ci]++;
    }
    // Running totals give the end of each cell; filling backwards leaves the start, with the grains of a cell in rising index.
    for(let k=1;k<cells;k++)start[k]+=start[k-1];
    start[cells]=live;
    for(let i=n-1;i>=0;i--)if(alive[i])items[--start[cellOf[i]]]=i;
    let count=0;const pairStart=this.pairStart;
    for(let i=0;i<n;i++){
      pairStart[i]=count;
      if(!alive[i])continue;
      const px=x[3*i],py=x[3*i+1],pz=x[3*i+2],ri=r[i]+skin;
      const cx=Math.floor((px-x0)*inv),cy=Math.floor((py-y0)*inv),cz=Math.floor((pz-z0)*inv);
      const first=count;
      for(let dz=-1;dz<=1;dz++){
        const zz=cz+dz;if(zz<0||zz>=nz)continue;
        for(let dy=-1;dy<=1;dy++){
          const yy=cy+dy;if(yy<0||yy>=ny)continue;
          for(let dx=-1;dx<=1;dx++){
            const xx=cx+dx;if(xx<0||xx>=nx)continue;
            const ci=xx+nx*(yy+ny*zz);
            for(let s=start[ci],e=start[ci+1];s<e;s++){
              const j=items[s];if(j<=i)continue;
              const ex=px-x[3*j],ey=py-x[3*j+1],ez=pz-x[3*j+2],reach=ri+r[j];
              if(ex*ex+ey*ey+ez*ez>=reach*reach)continue;
              if(count>=this.pairJ.length)this.growPairs(count+1);
              this.pairJ[count++]=j;
            }
          }
        }
      }
      // Histories of the pairs that were already listed.
      const H=this.pairH,on=this.pairOn,J=this.pairJ;
      const os=i<before?oldStart[i]:0,oe=i<before?oldStart[i+1]:0;
      for(let k=first;k<count;k++){
        const j=J[k];let found=-1;
        for(let q=os;q<oe;q++)if(oldJ[q]===j){found=q;break;}
        if(found>=0&&oldOn[found]){on[k]=1;for(let q=0;q<HN;q++)H[HN*k+q]=oldH[HN*found+q];}
        else{on[k]=0;for(let q=0;q<HN;q++)H[HN*k+q]=0;}
      }
    }
    pairStart[n]=count;this.stats.pairs=count;
    // Wall candidates: a static wall when the grain is within the skin, a moving wall always.
    const walls=this.walls,wallStart=this.wallStart,oldWallStart=this.oldWallStart,oldWallW=this.oldWallW,oldWallH=this.oldWallH,oldWallOn=this.oldWallOn;
    let wc=0;
    for(let i=0;i<n;i++){
      wallStart[i]=wc;
      if(!alive[i])continue;
      const first=wc;
      for(let k=0;k<walls.length;k++){
        const wall=walls[k];if(!wall.enabled)continue;
        if(wall.type===STATIC&&this.wallDistance(wall,x[3*i],x[3*i+1],x[3*i+2])>=r[i]+skin)continue;
        if(wc>=this.wallW.length)this.growWalls(wc+1);
        this.wallW[wc++]=k;
      }
      const H=this.wallH,on=this.wallOn,W=this.wallW;
      const os=i<before?oldWallStart[i]:0,oe=i<before?oldWallStart[i+1]:0;
      for(let k=first;k<wc;k++){
        const id=W[k];let found=-1;
        for(let q=os;q<oe;q++)if(oldWallW[q]===id){found=q;break;}
        if(found>=0&&oldWallOn[found]){on[k]=1;for(let q=0;q<HN;q++)H[HN*k+q]=oldWallH[HN*found+q];}
        else{on[k]=0;for(let q=0;q<HN;q++)H[HN*k+q]=0;}
      }
    }
    wallStart[n]=wc;
    this.reverseLists();this.forgetSlack();
    this.built.set(x.subarray(0,3*n));this.builtCount=n;this.dirty=false;this.stats.rebuilds++;
  }
  /** For each grain, the pairs where it is the second grain, in list order (a stable counting sort of the pairs by j). */
  private reverseLists():void {
    const n=this.n,start=this.revStart,K=this.revK,J=this.pairJ,total=this.pairStart[n];
    start.fill(0,0,n+1);
    for(let k=0;k<total;k++)start[J[k]+1]++;
    for(let g=0;g<n;g++)start[g+1]+=start[g];
    for(let k=0;k<total;k++)K[start[J[k]]++]=k;
    // Each start was moved to the end of its run, the start of the next: shift back.
    for(let g=n;g>0;g--)start[g]=start[g-1];
    start[0]=0;
  }
  private moved():boolean {
    const x=this.positions,b=this.built,limit=.25*this.skin*this.skin,n=this.n,alive=this.alive;
    for(let i=0;i<n;i++){
      if(!alive[i])continue;
      const dx=x[3*i]-b[3*i],dy=x[3*i+1]-b[3*i+1],dz=x[3*i+2]-b[3*i+2],d2=dx*dx+dy*dy+dz*dz;
      if(!(d2<limit)){
        if(d2!==d2)throw new EngineError('UNSTABLE_TIME_STEP',`Grain ${i} has no finite position at t = ${this.time} s: the run diverged (dt is ${this.timeStepFraction.toFixed(3)} of the critical time).`);
        return true;
      }
    }
    return false;
  }

  // ---- geometry ----

  /** Distance from a point to the wall's surface (negative inside a solid); leaves the outward normal in gn and the nearest surface point in gc. */
  private wallDistance(wall:Wall,px:number,py:number,pz:number):number {
    const R=wall.R,o=wall.x,d=wall.dim,n=this.gn,c=this.gc;
    const ex=px-o[0],ey=py-o[1],ez=pz-o[2];
    let lx=R[0]*ex+R[3]*ey+R[6]*ez,ly=R[1]*ex+R[4]*ey+R[7]*ez,lz=R[2]*ex+R[5]*ey+R[8]*ez;
    let nx:number,ny:number,nz:number,dist:number;
    switch(wall.shape){
      case PLANE:nx=d[0];ny=d[1];nz=d[2];dist=lx*nx+ly*ny+lz*nz;break;
      case SPHERE:case CAPSULE:{
        let cy=0;
        if(wall.shape===CAPSULE){cy=ly>d[1]?d[1]:ly<-d[1]?-d[1]:ly;ly-=cy;}
        const l=Math.sqrt(lx*lx+ly*ly+lz*lz);
        if(l>1e-300){nx=lx/l;ny=ly/l;nz=lz/l;}else{nx=1;ny=0;nz=0;}
        dist=l-d[0];break;
      }
      case BOX:{
        const qx=Math.abs(lx)-d[0],qy=Math.abs(ly)-d[1],qz=Math.abs(lz)-d[2];
        if(qx<=0&&qy<=0&&qz<=0){
          nx=ny=nz=0;
          if(qx>=qy&&qx>=qz){nx=lx<0?-1:1;dist=qx;}
          else if(qy>=qz){ny=ly<0?-1:1;dist=qy;}
          else{nz=lz<0?-1:1;dist=qz;}
        }else{
          const ox=qx>0?qx:0,oy=qy>0?qy:0,oz=qz>0?qz:0;dist=Math.sqrt(ox*ox+oy*oy+oz*oz);
          nx=(lx<0?-ox:ox)/dist;ny=(ly<0?-oy:oy)/dist;nz=(lz<0?-oz:oz)/dist;
        }
        break;
      }
      default:{
        // Shell of revolution: nearest point of the generating line in the meridian half plane of the grain.
        const ax=d[0],ay=d[1],az=d[2],s=lx*ax+ly*ay+lz*az;
        let rx=lx-s*ax,ry=ly-s*ay,rz=lz-s*az;const rho=Math.sqrt(rx*rx+ry*ry+rz*rz);
        if(rho>1e-300){rx/=rho;ry/=rho;rz/=rho;}
        else if(Math.abs(ax)<.9){const l=Math.sqrt(1-ax*ax);rx=(1-ax*ax)/l;ry=-ax*ay/l;rz=-ax*az/l;}
        else{const l=Math.sqrt(1-ay*ay);rx=-ay*ax/l;ry=(1-ay*ay)/l;rz=-ay*az/l;}
        const ur=d[5]-d[3],uz=d[6]-d[4];
        let t=((rho-d[3])*ur+(s-d[4])*uz)/(ur*ur+uz*uz);t=t<0?0:t>1?1:t;
        const dr=rho-(d[3]+t*ur),ds=s-(d[4]+t*uz);dist=Math.sqrt(dr*dr+ds*ds);
        if(dist>1e-300){nx=(dr*rx+ds*ax)/dist;ny=(dr*ry+ds*ay)/dist;nz=(dr*rz+ds*az)/dist;}
        else{nx=ax;ny=ay;nz=az;}
      }
    }
    const wx=R[0]*nx+R[1]*ny+R[2]*nz,wy=R[3]*nx+R[4]*ny+R[5]*nz,wz=R[6]*nx+R[7]*ny+R[8]*nz;
    n[0]=wx;n[1]=wy;n[2]=wz;c[0]=px-dist*wx;c[1]=py-dist*wy;c[2]=pz-dist*wz;
    return dist;
  }

  // ---- forces ----

  /** Copy the walls into the table the contact kernels read. */
  private packWalls():Float64Array {
    const walls=this.walls;
    if(this.wallTable.length<WALL_STRIDE*walls.length)this.wallTable=new Float64Array(WALL_STRIDE*walls.length);
    const T=this.wallTable;
    for(let k=0;k<walls.length;k++){
      const wall=walls[k],b=WALL_STRIDE*k;
      T[b+W_SHAPE]=wall.shape;T[b+W_TYPE]=wall.type;
      for(let q=0;q<9;q++)T[b+W_R+q]=wall.R[q];
      for(let q=0;q<3;q++){T[b+W_X+q]=wall.x[q];T[b+W_V+q]=wall.v[q];T[b+W_W+q]=wall.w[q];}
      for(let q=0;q<7;q++)T[b+W_DIM+q]=wall.dim[q];
      T[b+W_CURVED]=wall.curved;T[b+W_MASS]=wall.mass;T[b+W_ALPHA]=wall.alpha;T[b+W_MU]=wall.friction;T[b+W_MUR]=wall.rollingFriction;
      T[b+W_REACH]=wall.reach<Infinity?wall.reach:0;
    }
    return T;
  }
  /** The arrays the contact kernels work on (refreshed: the lists are swapped and grown). */
  private demContext(moves:Float64Array):DemContext {
    const c=this.context??={} as DemContext,T=this.packWalls();
    if(this.executor){
      // Helper threads see shared memory only: move (once) whatever is not there yet. Values are copied unchanged.
      const self=this as unknown as Record<string,Float64Array|Int32Array|Uint8Array>,ex=this.executor;
      for(const key of SHARED_FIELDS){const a=self[key];if(!(a.buffer instanceof SharedArrayBuffer))self[key]=ex.share(a);}
      if(!(moves.buffer instanceof SharedArrayBuffer))moves=this.moveScratch=ex.share(moves);
    }
    c.x=this.positions;c.v=this.velocities;c.w=this.angularVelocities;c.r=this.radii;c.m=this.masses;
    c.pairStart=this.pairStart;c.pairJ=this.pairJ;c.pairH=this.pairH;c.pairOn=this.pairOn;c.pairOut=this.pairOut;
    c.wallStart=this.wallStart;c.wallW=this.wallW;c.wallH=this.wallH;c.wallOn=this.wallOn;c.wallSlack=this.wallSlack;c.wallOut=this.wallOut;
    c.walls=this.wallTable;c.moves=moves;c.params=this.params;
    c.f=this.forces;c.t=this.torques;c.revStart=this.revStart;c.revK=this.revK;c.alive=this.alive;c.invMass=this.invMass;c.invInertia=this.invInertia;
    void T;return c;
  }
  /**
   * Run the contact kernels on several threads (granular-parallel.ts) or, with null, on this one. The results are the
   * same to the bit either way and for any number of threads: each thread evaluates whole contacts into their own
   * slots and every sum is still taken in one fixed order. The live arrays (positions, velocities, ...) move to shared
   * memory on the next step: read them from the solver again after this call rather than keeping old references.
   */
  useExecutor(executor:DemExecutor|null):void {
    this.executor=executor;this.context=null;
    // Move the live arrays now, so that a step already under way (step(count) holds them) keeps writing where they live.
    if(executor){const self=this as unknown as Record<string,Float64Array|Int32Array|Uint8Array>;for(const key of SHARED_FIELDS){const a=self[key];if(!(a.buffer instanceof SharedArrayBuffer))self[key]=executor.share(a);}}
  }
  /** The executor the contacts run on, if any. */
  get threads():number {return this.executor?this.executor.threads:1;}
  /** Contact forces at the present positions, with the histories advanced by h (0: evaluate only); with `kick`, the closing half kick of the step too. */
  private computeForces(h:number,kick=false):void {
    const n=this.n,walls=this.walls,P=this.params;
    P[P_H]=h;P[P_HERTZ]=this.hertz?1:0;P[P_KHERTZ]=this.kHertz;P[P_KMINDLIN]=this.kMindlin;P[P_KN]=this.kn;P[P_KT]=this.kt;P[P_ALPHA]=this.alpha;
    P[P_TDAMP]=this.tangentialDamping;P[P_MU]=this.material.friction;P[P_MUR]=this.material.rollingFriction;P[P_MOVE]=this.grainMove;P[P_WALLS]=walls.length;
    P[P_GX]=this.gravity[0];P[P_GY]=this.gravity[1];P[P_GZ]=this.gravity[2];
    const ctx=this.demContext(this.wallMoves());
    this.grainMove=0;
    let eNormal:number,eTangent:number,pDamp:number,pTangent:number,contacts:number,wallContacts:number,overlap:number,exchange:number;
    if(!this.executor){
      // One thread: the single loop, summing as it goes.
      const sums=this.sums.length>=SUM_WALLS+WALL_SUM*walls.length?this.sums:(this.sums=new Float64Array(SUM_WALLS+WALL_SUM*walls.length));
      demSerial(ctx,n,this.scratch,sums,this.terms);
      eNormal=sums[SUM_EN];eTangent=sums[SUM_ET];pDamp=sums[SUM_PD];pTangent=sums[SUM_PT];contacts=sums[SUM_CONTACTS];wallContacts=sums[SUM_WALL_CONTACTS];overlap=sums[SUM_OVERLAP];exchange=sums[SUM_EXCHANGE];
      for(let k=0;k<walls.length;k++){
        const wall=walls[k],q=SUM_WALLS+WALL_SUM*k;
        for(let d=0;d<3;d++){wall.force[d]=sums[q+d];wall.torque[d]=sums[q+3+d];}
        wall.normalLoad=sums[q+6];wall.contacts=sums[q+7];
      }
      if(kick)this.kick(h);
    }else{
      // Several threads: each contact into its own slot, then the sums in the single loop's order.
      this.executor.run('contacts',ctx,n);
      ctx.params[P_KICK]=kick?1:0;
      this.executor.run('gather',ctx,n);
      const pairOn=this.pairOn,PO=this.pairOut,total=this.pairStart[n],wallStart=this.wallStart,wallW=this.wallW,wallOn=this.wallOn,WO=this.wallOut,cands=wallStart[n];
      eNormal=0;eTangent=0;pDamp=0;pTangent=0;contacts=0;wallContacts=0;overlap=0;exchange=0;
      for(let k=0;k<total;k++){
        if(!pairOn[k])continue;
        const l=PAIR_OUT*k+9;
        eNormal+=PO[l+L_EN];pDamp-=PO[l+L_PD];eTangent+=PO[l+L_ET1];pTangent+=PO[l+L_PT1];eTangent+=PO[l+L_ET2];pTangent+=PO[l+L_PT2];
        contacts++;const ratio=PO[l+L_RATIO];if(ratio>overlap)overlap=ratio;
      }
      for(let k=0;k<walls.length;k++){const wall=walls[k];wall.force.fill(0);wall.torque.fill(0);wall.normalLoad=0;wall.contacts=0;}
      for(let k=0;k<cands;k++){
        if(!wallOn[k])continue;
        const o=WALL_OUT*k,l=o+11,wall=walls[wallW[k]],F=wall.force,T=wall.torque;
        eNormal+=WO[l+L_EN];pDamp-=WO[l+L_PD];eTangent+=WO[l+L_ET1];pTangent+=WO[l+L_PT1];eTangent+=WO[l+L_ET2];pTangent+=WO[l+L_PT2];
        wallContacts++;wall.contacts++;wall.normalLoad+=WO[o+9];
        const ratio=WO[l+L_RATIO];if(ratio>overlap)overlap=ratio;
        F[0]-=WO[o];F[1]-=WO[o+1];F[2]-=WO[o+2];
        T[0]-=WO[o+6];T[1]-=WO[o+7];T[2]-=WO[o+8];
        if(wall.type!==STATIC)exchange+=WO[o+10];
      }
    }
    this.eNormal=eNormal;this.eTangent=eTangent;this.pDamp=pDamp;this.pTangent=pTangent;
    const st=this.stats;st.contacts=contacts;st.wallContacts=wallContacts;st.overlap=overlap;if(overlap>st.maxOverlap)st.maxOverlap=overlap;
    if(h>0){
      this.dissipatedDamping+=this.pDamp*h;
      this.dissipatedFriction+=-this.pTangent*h-(this.eTangent-this.eTangentBefore);
      this.externalWork+=exchange*h;
    }
    this.eTangentBefore=this.eTangent;
  }
  /**
   * For each wall, an upper bound of how far any point of its surface moved since the last force evaluation: the
   * translation plus, for a turn, 2 |q - q'| times the radius that holds the surface (a point at distance rho from the
   * centre moves 2 rho sin(theta / 2) <= 2 rho |q - q'| for unit quaternions with q . q' >= 0). Infinity for a wall
   * not seen yet or a plane that turned. Records the present pose.
   */
  private wallMoves():Float64Array {
    const walls=this.walls;
    if(this.moveScratch.length<walls.length)this.moveScratch=new Float64Array(walls.length);
    const out=this.moveScratch;
    for(let k=0;k<walls.length;k++){
      const wall=walls[k],X=wall.x,Q=wall.q,sx=wall.seenX,sq=wall.seenQ;
      let move=Infinity;
      if(wall.seen){
        const dx=X[0]-sx[0],dy=X[1]-sx[1],dz=X[2]-sx[2];
        move=Math.sqrt(dx*dx+dy*dy+dz*dz);
        if(Q[0]!==sq[0]||Q[1]!==sq[1]||Q[2]!==sq[2]||Q[3]!==sq[3]){
          const sign=Q[0]*sq[0]+Q[1]*sq[1]+Q[2]*sq[2]+Q[3]*sq[3]<0?-1:1;
          const a=Q[0]-sign*sq[0],b=Q[1]-sign*sq[1],c=Q[2]-sign*sq[2],e=Q[3]-sign*sq[3];
          move+=2*wall.reach*Math.sqrt(a*a+b*b+c*c+e*e);
        }
        move=move*(1+1e-9)+1e-12*(Math.abs(X[0])+Math.abs(X[1])+Math.abs(X[2]));
        if(!(move<Infinity))move=Infinity;
      }
      out[k]=move;
      sx[0]=X[0];sx[1]=X[1];sx[2]=X[2];sq[0]=Q[0];sq[1]=Q[1];sq[2]=Q[2];sq[3]=Q[3];wall.seen=true;
    }
    return out;
  }
  private moveScratch:Float64Array=new Float64Array(0);
  /** The closing half kick of velocity Verlet on the grains. */
  private kick(h:number):void {
    const n=this.n,hh=.5*h,g=this.gravity,gx=g[0],gy=g[1],gz=g[2],v=this.velocities,w=this.angularVelocities,f=this.forces,t=this.torques,alive=this.alive,invMass=this.invMass,invInertia=this.invInertia;
    for(let i=0;i<n;i++){
      if(!alive[i])continue;
      const a=3*i,im=invMass[i]*hh,ii=invInertia[i]*hh;
      v[a]+=f[a]*im+gx*hh;v[a+1]+=f[a+1]*im+gy*hh;v[a+2]+=f[a+2]*im+gz*hh;
      w[a]+=t[a]*ii;w[a+1]+=t[a+1]*ii;w[a+2]+=t[a+2]*ii;
    }
  }
  /** Make the neighbour list and the forces match the present state without advancing it. */
  private prepare():void {
    if(this.fresh)return;
    if(this.dirty)this.rebuild();
    this.computeForces(0);this.fresh=true;
  }

  // ---- time stepping ----

  step(count=1):void {
    if(!Number.isInteger(count)||count<0)fail('step(count) needs a whole number of steps.');
    const h=this.dt,hh=.5*h,g=this.gravity,x=this.positions,v=this.velocities,w=this.angularVelocities,f=this.forces,t=this.torques,alive=this.alive;
    const invMass=this.invMass,invInertia=this.invInertia,walls=this.walls,bounds=this.bounds,gx=g[0],gy=g[1],gz=g[2];
    for(let stepIndex=0;stepIndex<count;stepIndex++){
      this.prepare();
      const n=this.n;let fastest=0;
      for(let i=0;i<n;i++){
        if(!alive[i])continue;
        const a=3*i,im=invMass[i]*hh,ii=invInertia[i]*hh;
        v[a]+=f[a]*im+gx*hh;v[a+1]+=f[a+1]*im+gy*hh;v[a+2]+=f[a+2]*im+gz*hh;
        w[a]+=t[a]*ii;w[a+1]+=t[a+1]*ii;w[a+2]+=t[a+2]*ii;
        x[a]+=v[a]*h;x[a+1]+=v[a+1]*h;x[a+2]+=v[a+2]*h;
        const speed=Math.abs(v[a])+Math.abs(v[a+1])+Math.abs(v[a+2]);if(speed>fastest)fastest=speed;
      }
      // No grain moved farther than its velocity's 1-norm times h (plus rounding, which the slack's margin covers).
      this.grainMove+=fastest*h*(1+1e-9);if(!(this.grainMove<Infinity))this.grainMove=Infinity;
      for(let k=0;k<walls.length;k++){
        const wall=walls[k];
        const F=wall.force,T=wall.torque,P=wall.impulse,L=wall.angularImpulse;
        P[0]+=hh*F[0];P[1]+=hh*F[1];P[2]+=hh*F[2];L[0]+=hh*T[0];L[1]+=hh*T[1];L[2]+=hh*T[2];
        if(wall.type===STATIC)continue;
        if(wall.type===DYNAMIC){
          const E=wall.external,im=wall.invMass*hh,s=wall.gravityScale*hh;
          wall.v[0]+=(F[0]+E[0])*im+gx*s;wall.v[1]+=(F[1]+E[1])*im+gy*s;wall.v[2]+=(F[2]+E[2])*im+gz*s;
          wall.spin(hh,T[0]+E[3],T[1]+E[4],T[2]+E[5]);
        }
        wall.x[0]+=h*wall.v[0];wall.x[1]+=h*wall.v[1];wall.x[2]+=h*wall.v[2];
        wall.rotate(h);
      }
      if(bounds){
        for(let i=0;i<n;i++){
          if(!alive[i])continue;
          const a=3*i;
          if(x[a]<bounds[0]||x[a]>bounds[3]||x[a+1]<bounds[1]||x[a+1]>bounds[4]||x[a+2]<bounds[2]||x[a+2]>bounds[5])this.removeGrain(i);
        }
      }
      if(this.dirty||this.moved())this.rebuild();
      this.computeForces(h,true);this.fresh=true;
      for(let k=0;k<walls.length;k++){
        const wall=walls[k],F=wall.force,T=wall.torque,P=wall.impulse,L=wall.angularImpulse;
        P[0]+=hh*F[0];P[1]+=hh*F[1];P[2]+=hh*F[2];L[0]+=hh*T[0];L[1]+=hh*T[1];L[2]+=hh*T[2];
        if(wall.type!==DYNAMIC)continue;
        const E=wall.external,im=wall.invMass*hh,s=wall.gravityScale*hh;
        wall.v[0]+=(F[0]+E[0])*im+gx*s;wall.v[1]+=(F[1]+E[1])*im+gy*s;wall.v[2]+=(F[2]+E[2])*im+gz*s;
        wall.spin(hh,T[0]+E[3],T[1]+E[4],T[2]+E[5]);
      }
      this.time+=h;this.stats.steps++;
    }
  }
}

// -------------------------------------------------------------------------------------------------
// Coupling to a rigid world.
// -------------------------------------------------------------------------------------------------

/** The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it. */
export interface GranularWorld<B> {
  gravity():readonly number[];
  getState(body:B):{readonly position:readonly number[];readonly rotation:readonly number[];readonly linearVelocity:readonly number[];readonly angularVelocity:readonly number[];readonly mass:number;readonly type:string};
  /** Force in newtons acting over the next step, at the centre of mass. */
  applyForce(body:B,force:GranularVec3):void;
  applyTorque(body:B,torque:GranularVec3):void;
  isAlive?(body:B):boolean;
  readonly loop?:{readonly step:number};
}
export interface GranularColliderOptions {
  /** The world cannot report shapes: say what the body is (box, sphere or capsule for a dynamic body). */
  readonly shape:GranularShape;
  /** Rotational inertia of a dynamic body. Default: that of the shape with uniform density. */
  readonly inertia?:StructureInertia;
  readonly friction?:number;readonly rollingFriction?:number;readonly restitution?:number;
  /** False: the grains feel the body but the body is not pushed. Default true. */
  readonly twoWay?:boolean;
  readonly gravityScale?:number;
}
export interface GranularCouplingOptions {
  /** The rigid step, s, when the world has no `loop.step`. */
  readonly step?:number;
  /** Estimate, from how each body actually moved in the last rigid step, the force its supports and joints put on it, and hold it on the body's stand-in during the grain steps. Default true. */
  readonly estimateSupports?:boolean;
}
export interface GranularCouplingDiagnostics {
  grainKinetic:number;grainPotential:number;grainElastic:number;dissipatedDamping:number;dissipatedFriction:number;
  /** Translational kinetic energy and -m g.x of the coupled dynamic bodies, J. */
  bodyKinetic:number;bodyPotential:number;
  /** Linear momentum of the grains and the coupled dynamic bodies, kg m/s. */
  momentum:[number,number,number];
  mass:number;
}
interface CoupledBody<B> {readonly body:B;readonly index:number;readonly dynamic:boolean;readonly twoWay:boolean;readonly gravityScale:number;readonly prevV:Float64Array;readonly prevW:Float64Array;readonly force:Float64Array;readonly torque:Float64Array;seen:boolean;contact:boolean}

// The rigid world works in float32 and refuses a nonzero component too small for one (below about 1.4e-45): hand over an exact zero instead.
const flush=(value:number):number=>Math.fround(value)===0?0:value;

/**
 * Two-way coupling of a Granular with a rigid world. Call `step()` immediately before `world.step()`. It copies every
 * coupled body in as a wall (dynamic bodies as dynamic walls with the body's mass), advances the grains by
 * `substeps` = rigid step / grain step of their own steps, the dynamic bodies moving with them under gravity, the grain
 * forces and the estimated support load, and gives each body the mean force and torque of those steps to act through
 * the rigid step. The impulse the grains receive and the impulse the bodies are handed are the same numbers with
 * opposite signs.
 */
export class GranularCoupling<B> {
  /** Everything a later step reads, as a state tree (checkpoint.ts), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,GRANULAR_COUPLING_FIELDS);}
  /** Put back a state from `saveState()` of a coupling set up the same way (same grain set and bodies, in the same order). */
  restoreState(state:StateValue):void {restoreFields(this,state,GRANULAR_COUPLING_FIELDS);}

  readonly backend=GRANULAR_COUPLING_BACKEND;
  readonly world:GranularWorld<B>;readonly granular:Granular;
  /** The rigid step, s, and the grain steps taken in each. */
  readonly dt:number;readonly substeps:number;readonly estimateSupports:boolean;
  private readonly list:CoupledBody<B>[]=[];private readonly byBody=new Map<B,CoupledBody<B>>();
  private readonly load=new Float64Array(6);private readonly out:[number,number,number]=[0,0,0];
  steps=0;

  constructor(world:GranularWorld<B>,granular:Granular,options:GranularCouplingOptions={}) {
    if(!world||typeof world.getState!=='function'||typeof world.applyForce!=='function'||typeof world.applyTorque!=='function'||typeof world.gravity!=='function')
      throw new TypeError('GranularCoupling needs a world with gravity(), getState(), applyForce() and applyTorque().');
    if(!(granular instanceof Granular))throw new TypeError('GranularCoupling needs a Granular.');
    this.world=world;this.granular=granular;
    const step=world.loop?world.loop.step:options.step;
    this.dt=num(step,'the rigid step (world.loop.step or options.step)',1e-12,1);
    const ratio=this.dt/granular.dt,whole=Math.round(ratio);
    if(whole<1||Math.abs(ratio-whole)>1e-9*whole)fail(`The grains step at ${granular.dt} s and the world at ${this.dt} s: the world step must be a whole number of grain steps (it is ${ratio}).`);
    this.substeps=whole;this.estimateSupports=options.estimateSupports??true;
  }
  /** Let the grains collide with a body of the world, and (for a dynamic body) push it. Returns the body's wall index in the Granular. */
  addBody(body:B,options:GranularColliderOptions):number {
    if(this.byBody.has(body))fail('That body is already coupled to these grains.');
    const s=this.world.getState(body);
    if(s.type!=='static'&&s.type!=='kinematic'&&s.type!=='dynamic')fail(`Unknown body type "${s.type}".`);
    const dynamic=s.type==='dynamic',gravityScale=options.gravityScale??1;
    const index=this.granular.addWall({shape:options.shape,type:s.type as 'static'|'kinematic'|'dynamic',mass:dynamic?s.mass:undefined,inertia:options.inertia,gravityScale,friction:options.friction,rollingFriction:options.rollingFriction,restitution:options.restitution,
      position:s.position,rotation:s.rotation,linearVelocity:s.type==='static'?undefined:s.linearVelocity,angularVelocity:s.type==='static'?undefined:s.angularVelocity});
    const entry:CoupledBody<B>={body,index,dynamic,twoWay:options.twoWay??true,gravityScale,prevV:new Float64Array(3),prevW:new Float64Array(3),force:new Float64Array(3),torque:new Float64Array(3),seen:false,contact:false};
    this.list.push(entry);this.byBody.set(body,entry);return index;
  }
  private entry(body:B):CoupledBody<B> {const e=this.byBody.get(body);if(!e)fail('That body is not coupled to these grains: addBody() it first.');return e as CoupledBody<B>;}
  /** Wall index of a coupled body in the Granular. */
  indexOf(body:B):number {return this.entry(body).index;}
  /** Mean force (N) and torque about the centre of mass (N m) the grains put on the body over the last rigid step. Live arrays. */
  force(body:B):Float64Array {return this.entry(body).force;}
  torque(body:B):Float64Array {return this.entry(body).torque;}
  /** Advance the grains through one rigid step against the bodies as they are now and hand the bodies the grains' forces. */
  step():void {
    const world=this.world,dem=this.granular,h=this.dt,g=dem.gravity,load=this.load,out=this.out;
    for(let i=0;i<this.list.length;i++){
      const e=this.list[i];
      if(world.isAlive&&!world.isAlive(e.body)){dem.setWallEnabled(e.index,false);continue;}
      const s=world.getState(e.body);
      if(e.dynamic||s.type==='kinematic')dem.setWallState(e.index,s);
      if(!e.dynamic)continue;
      dem.setWallMass(e.index,s.mass);
      load.fill(0);
      if(this.estimateSupports&&e.seen){
        // What moved the body in the last rigid step, less the gravity its stand-in feels and less what the grains applied, is
        // its supports and joints (and any difference between the world's gravity and the grains').
        const v=s.linearVelocity,w=s.angularVelocity;
        for(let k=0;k<3;k++)load[k]=s.mass*((v[k]-e.prevV[k])/h-g[k]*e.gravityScale)-(e.twoWay?e.force[k]:0);
        // The angular part is left out: it would need the body's inertia in world axes at both ends of the step.
      }
      dem.setWallExternalLoad(e.index,load);
      for(let k=0;k<3;k++){e.prevV[k]=s.linearVelocity[k];e.prevW[k]=s.angularVelocity[k];}
      e.seen=true;
    }
    dem.resetWallImpulses();
    dem.step(this.substeps);
    for(let i=0;i<this.list.length;i++){
      const e=this.list[i];
      const P=dem.wallImpulse(e.index),L=dem.wallAngularImpulse(e.index);
      for(let k=0;k<3;k++){e.force[k]=P[k]/h;e.torque[k]=L[k]/h;}
      if(!e.dynamic||!e.twoWay)continue;
      if(world.isAlive&&!world.isAlive(e.body))continue;
      out[0]=flush(e.force[0]);out[1]=flush(e.force[1]);out[2]=flush(e.force[2]);
      if(out[0]!==0||out[1]!==0||out[2]!==0)world.applyForce(e.body,out);
      out[0]=flush(e.torque[0]);out[1]=flush(e.torque[1]);out[2]=flush(e.torque[2]);
      if(out[0]!==0||out[1]!==0||out[2]!==0)world.applyTorque(e.body,out);
    }
    this.steps++;
  }
  /** Bodies whose contact with the grains began or ended in the last step: calls `each(body, index, touching)`. */
  contactChanges(each:(body:B,index:number,touching:boolean)=>void):void {
    for(let i=0;i<this.list.length;i++){
      const e=this.list[i],now=this.granular.wallContacts(e.index)>0;
      if(now!==e.contact){e.contact=now;each(e.body,e.index,now);}
    }
  }
  /** Energies and momentum of the grains and the coupled dynamic bodies. Allocates; not for the hot path. */
  diagnostics():GranularCouplingDiagnostics {
    const dem=this.granular,g=this.world.gravity(),momentum=dem.linearMomentum([0,0,0]) as [number,number,number];
    const d:GranularCouplingDiagnostics={grainKinetic:dem.kineticEnergy(),grainPotential:dem.gravitationalEnergy(),grainElastic:dem.elasticEnergy(),dissipatedDamping:dem.dissipatedDamping,dissipatedFriction:dem.dissipatedFriction,bodyKinetic:0,bodyPotential:0,momentum,mass:dem.mass()};
    for(const e of this.list){
      if(!e.dynamic)continue;
      if(this.world.isAlive&&!this.world.isAlive(e.body))continue;
      const s=this.world.getState(e.body),v=s.linearVelocity,x=s.position;
      d.bodyKinetic+=.5*s.mass*(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);d.bodyPotential-=s.mass*(Number(g[0])*x[0]+Number(g[1])*x[1]+Number(g[2])*x[2]);d.mass+=s.mass;
      for(let k=0;k<3;k++)momentum[k]+=s.mass*v[k];
    }
    return d;
  }
}

/** Where the grains run inside the couple stage of a Simulation: after the structure coupling (100) and the cloth (150), before the water (200). */
export const GRANULAR_SUBSYSTEM_ORDER=160;

/**
 * Grains as a subsystem of the one stepping loop (simulation.ts).
 *  - A `GranularCoupling`: couple stage, order 160. Its time step is the rigid step (it takes `substeps` grain steps
 *    inside), so it must equal the simulation step.
 *  - A bare `Granular` (no world): post stage; its dt may be the step, a whole fraction of it or a whole multiple.
 * Registration fails when the grain step exceeds the stability limit (unless the Granular was built with
 * `allowUnstable`, which emits one 'unstable-step' event instead).
 * Energy: kinetic (translation and spin) + gravitational + elastic (normal, tangential and rolling springs) of the
 * grains, with the work of moving walls and coupled bodies, less the energy of removed grains, as `exchanged`. The parts
 * also list `dissipatedDamping` and `dissipatedFriction`: total - exchanged + the two is constant up to the
 * time-stepping error. Coupled bodies are not counted (track them with `simulation.trackBody`).
 * Events, emitted at the end of a step: 'contact-begin' and 'contact-end' with {body, index} when a coupled body starts
 * or stops touching grains, 'grains-removed' with {count, mass} when grains left the bounds, 'overlap' with {ratio} when
 * the largest overlap first exceeds a quarter of a radius, and 'unstable-step' once (see above).
 */
export function granularSubsystem<W,B>(target:Granular|GranularCoupling<B>,options:{readonly id?:string;readonly order?:number}={}):Subsystem<W,B> {
  const coupling=target instanceof GranularCoupling?target:null,dem=coupling?coupling.granular:target as Granular;
  if(!(dem instanceof Granular))throw new TypeError('granularSubsystem needs a Granular or a GranularCoupling.');
  let removed=dem.stats.removed,removedMass=dem.stats.removedMass,deep=false,warned=false;
  return {
    id:options.id??'granular',kind:coupling?'granular-coupling':'granular',stage:coupling?'couple':'post',order:options.order??(coupling?GRANULAR_SUBSYSTEM_ORDER:500),
    timeStep:{dt:coupling?coupling.dt:dem.dt,rule:coupling?'equal':'commensurate'},
    validate(){
      if(dem.timeStepFraction>GRANULAR_TIME_STEP_LIMIT[dem.law]&&!dem.stats.unstable)
        throw new EngineError('UNSTABLE_TIME_STEP',`The grain step ${dem.dt} s is ${dem.timeStepFraction.toFixed(3)} of the critical time; the limit is ${GRANULAR_TIME_STEP_LIMIT[dem.law]}.`);
    },
    step(ctx){if(coupling)coupling.step();else dem.step(ctx.substeps);},
    // The solver (with the coupling's records) and the event cursors.
    checkpoint(){return {state:(coupling??dem).saveState(),removed,removedMass,deep,warned};},
    restore(state){
      const s=state as {state?:StateValue;removed?:unknown;removedMass?:unknown;deep?:unknown;warned?:unknown}|null;
      if(!s||typeof s.removed!=='number'||typeof s.removedMass!=='number'||typeof s.deep!=='boolean'||typeof s.warned!=='boolean')throw checkpointError(`Subsystem "${options.id??'granular'}": the saved state is malformed.`);
      (coupling??dem).restoreState(s.state);removed=s.removed;removedMass=s.removedMass;deep=s.deep;warned=s.warned;
    },
    finish(ctx){
      if(coupling)coupling.contactChanges((body,index,touching)=>ctx.emit(touching?'contact-begin':'contact-end',{body,index}));
      if(dem.stats.removed!==removed){ctx.emit('grains-removed',{count:dem.stats.removed-removed,mass:dem.stats.removedMass-removedMass});removed=dem.stats.removed;removedMass=dem.stats.removedMass;}
      const now=dem.stats.overlap>0.25;
      if(now&&!deep)ctx.emit('overlap',{ratio:dem.stats.overlap});
      deep=now;
      if(dem.stats.unstable&&!warned){warned=true;ctx.emit('unstable-step',{dt:dem.dt,criticalTime:dem.criticalTime,fraction:dem.timeStepFraction});}
    },
    energy(){
      const kinetic=dem.kineticEnergy(),potential=dem.gravitationalEnergy(),elastic=dem.elasticEnergy();
      return {domain:'mechanical',total:kinetic+potential+elastic,exchanged:dem.externalWork,parts:{kinetic,potential,elastic,dissipatedDamping:dem.dissipatedDamping,dissipatedFriction:dem.dissipatedFriction}};
    },
    diagnostics(){return {solver:dem.solver,backend:coupling?coupling.backend:null,law:dem.law,grains:dem.liveCount,walls:dem.wallCount,time:dem.time,dt:dem.dt,substeps:coupling?coupling.substeps:1,timeStepFraction:dem.timeStepFraction,...dem.stats};},
  };
}
