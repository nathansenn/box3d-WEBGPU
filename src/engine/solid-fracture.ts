/**
 * Fracture for tetrahedral solids. SI units, float64. See docs/SOLID_FRACTURE.md.
 *
 * `FractureBody` is a small-strain solid of four-node tetrahedra (the `linear` model of
 * solid.ts: same element, same lumped mass, same thermal eigenstrain) that can break in two ways.
 *
 *  - `cohesive`: failure is localised on element faces. A face that reaches its strength gets a
 *    cohesive interface, and its nodes are duplicated where that separates the elements around
 *    them. The interface follows a bilinear traction-separation law in an effective opening
 *    delta = sqrt(<delta_n>^2 + beta^2 |delta_s|^2): traction rises to sigma_c at delta_0, then
 *    falls linearly to zero at delta_c = 2 G_c / sigma_c, so the work of separation per unit
 *    area is exactly G_c. Damage is irreversible (unloading returns to the origin) and a
 *    closing face is held by a penalty. Cracks can only follow element faces.
 *  - `crack-band`: an element softens when its largest principal stress reaches the strength
 *    (Rankine). With `regularisation: 'crack-band'` the softening strain is scaled by the
 *    element's size so that the energy per unit crack area is G_c; with 'none' it is a fixed
 *    strain and the dissipated energy depends on the mesh. An element at full damage keeps a
 *    residual stiffness and is reported as failed ("deleted").
 *
 * After fracture, `fragments()` lists the connected pieces and `handOff()` turns one into a
 * rigid-body description (a convex hull with the piece's mass and velocity). The hand-off is
 * one-way: the piece stops being simulated here.
 */
import {EngineError,finite,integer,onlyKeys,record} from './contracts.ts';
import {boxMesh,tetVolume,SOLID_MAX_NODES,SOLID_MAX_TETS,type TetMesh} from './solid-mesh.ts';
import {symmetricEigenvalues,type SolidMaterial} from './solid.ts';
import {convexHull,meshVolume,toHullShape} from './geometry.ts';
import {HeatSolver,type ThermalShockOptions} from './heat.ts';
import type {Subsystem} from './simulation.ts';

export const SOLID_FRACTURE_SOLVER_ID='solid-fracture-czm-js-f64-v1';
export type FractureModel='cohesive'|'crack-band'|'none';
export type FractureIntegrator='backward-euler'|'midpoint'|'explicit';

export interface FractureLaw {
  /** `cohesive`: interfaces on element faces. `crack-band`: Rankine softening of elements. `none`: elastic. */
  model:FractureModel;
  /** Tensile strength sigma_c in Pa. */
  strength:number;
  /** Fracture energy G_c in J/m^2. */
  toughness:number;
  /** Cohesive: weight beta of the sliding opening in the effective opening. The shear strength is
   * beta * sigma_c and the mode II fracture energy is G_c. Default 1. */
  shearWeight?:number;
  /** Cohesive: delta_0 / delta_c, the share of the critical opening spent on the rising branch.
   * Smaller is stiffer before the peak (initial stiffness sigma_c / delta_0). Default 0.02. */
  initialOpeningRatio?:number;
  /** Cohesive: `on-demand` inserts an interface when the traction on a face reaches its strength;
   * `manual` only where `insertCohesive` or `precrack` put one. Default 'on-demand'. */
  insertion?:'on-demand'|'manual';
  /** Cohesive, on-demand: an interface is inserted when the effective traction on a face reaches this
   * share of the face's strength. The traction is read from the mean stress of the two elements, which
   * under-reads the peak at a crack tip on a coarse mesh; a value below 1 inserts earlier and lets the
   * interface law decide. The inserted interface is undamaged either way. Default 1. */
  insertionThreshold?:number;
  /** Crack band: 'crack-band' scales the softening by the element size (energy per crack area G_c);
   * 'none' uses the fixed `failureStrain`, which makes the dissipated energy mesh-dependent. Default 'crack-band'. */
  regularisation?:'crack-band'|'none';
  /** Crack band without regularisation: the strain at which the stress reaches zero. */
  failureStrain?:number;
  /** Crack band: share of the stiffness a fully damaged element keeps. Default 1e-9. */
  residualStiffness?:number;
}
export interface FractureConfig {
  /** Time step in seconds. Default 1/240. */
  dt?:number;
  integrator?:FractureIntegrator;
  /** Mass-proportional damping, 1/s. */
  massDamping?:number;
  gravity?:readonly [number,number,number];
  /** Relative force residual of a solve, as in solid.ts. Defaults 1e-10 and 0 N. */
  tolerance?:number;forceTolerance?:number;
  maxNewtonIterations?:number;maxLinearIterations?:number;
  /** The explicit integrator refuses a step above this share of its limit. Default 0.9. */
  explicitSafety?:number;
  /** Most rounds of "solve, then insert the faces that reached their strength" in one static solve or implicit step. Default 200. */
  maxInsertionSweeps?:number;
  /** Crack band: most rounds of "solve with frozen damage, then update the damage" in one solve. Default 400. */
  maxDamageIterations?:number;
}
export interface FractureDefinition {mesh:TetMesh|{positions:ArrayLike<number>;tets:ArrayLike<number>};material:SolidMaterial;fracture:FractureLaw;config?:FractureConfig}
export interface FractureSolveStats {
  converged:boolean;reason:'converged'|'iteration-limit'|'line-search'|'singular-or-indefinite'|'diverged';
  newtonIterations:number;linearIterations:number;residual:number;reference:number;
  /** Rounds of interface insertion and faces inserted in the last solve or step. */
  sweeps:number;insertedFaces:number;
  /** Crack band: frozen-damage rounds in the last solve or step. */
  damageIterations:number;
}
export interface CrackEvent {
  /** Body time in seconds (steps * dt). Static solves do not advance it. */
  time:number;
  /** Count of static solves and time steps so far; orders events from statics. */
  step:number;
  /** `initiated`: an interface was inserted on a face. `opened`: a face lost all traction.
   * `element-failed`: a crack-band element reached full damage. */
  kind:'initiated'|'opened'|'element-failed';
  /** Interior face index, or -1. */
  face:number;
  /** Element index, or -1. */
  element:number;
  /** I: opening. II: sliding. Decided by `modeMix`: above 0.9 is I, below 0.1 is II. */
  mode:'I'|'II'|'mixed';
  /** Share of the normal part in the effective traction (initiated) or opening (opened), 0 to 1. */
  modeMix:number;
  /** Energy dissipated by this face or element so far, J. Zero for `initiated`. */
  energy:number;
  /** Face area in m^2, or the element volume divided by its band width. */
  area:number;
}
export interface FractureEnergy {
  /** Elastic strain energy of the elements, J. */
  strain:number;
  /** Recoverable energy stored in the interfaces (cohesive springs and the contact penalty), J. */
  interface:number;
  kinetic:number;
  /** Energy dissipated by fracture, J: a function of the damage state for interfaces, summed incrementally for elements. */
  dissipated:number;
  /** Energy removed by mass damping, J. */
  damping:number;
  /** Energy released in static solves when a new interface adds its compliance at a face that already
   * carries traction, J: T_before T_after / (2 K) per unit area, which is `initialOpeningRatio` * G_c
   * for an interface inserted at its strength. In dynamics this energy becomes motion and is not booked here. */
  relaxation:number;
  /** Work of loads and prescribed displacements, J. */
  externalWork:number;
  /** externalWork - (strain + interface + kinetic + dissipated + damping + relaxation). Zero for an exact ledger. */
  balance:number;
}
export interface Fragment {
  /** Position in the list: fragments are ordered by their lowest element index. */
  index:number;
  tets:Uint32Array;nodes:Uint32Array;
  /** Sum of the lumped masses of its nodes, kg. */
  mass:number;volume:number;
  centerOfMass:[number,number,number];
  /** Linear momentum, kg m/s. */
  linearMomentum:[number,number,number];
  /** Angular momentum about the centre of mass, kg m^2/s. */
  angularMomentum:[number,number,number];
  /** Inertia of the lumped masses about the centre of mass, [xx, yy, zz, yz, xz, xy], kg m^2. */
  inertia:[number,number,number,number,number,number];
  /** True when the fragment was already handed off. */
  handedOff:boolean;
}
export interface FragmentRigidBody {
  /** Convex hull of the fragment's nodes, relative to `position`. Ready for `PhysicsWorld.createBody`. */
  shape:{kind:'hull';points:Float32Array};
  /** The fragment's centre of mass, m. */
  position:[number,number,number];
  linearVelocity:[number,number,number];
  angularVelocity:[number,number,number];
  /** mass / hullVolume, so that a world that derives mass from shape and density gets `mass`. */
  density:number;
  mass:number;hullVolume:number;
  /** density * hullVolume * linearVelocity: what the rigid body carries. */
  linearMomentum:[number,number,number];
  type:'dynamic';
}

const zero=(x:number)=>x===0?0:x;
const payload=(message:string)=>new EngineError('INVALID_PAYLOAD',message);
function numbers(value:unknown,count:number,label:string,min=-1e100,max=1e100):Float64Array {
  if(!Array.isArray(value)&&!(value instanceof Float64Array)&&!(value instanceof Float32Array))throw payload(`${label} needs a numeric array.`);
  if(value.length!==count)throw payload(`${label} has the wrong length.`);
  return Float64Array.from(value,(v,i)=>zero(finite(v,`${label}[${i}]`,min,max)));
}
function indexList(value:unknown,limit:number,label:string):number[] {
  if(value===null||typeof value!=='object'||typeof (value as ArrayLike<number>).length!=='number')throw payload(`${label} needs an index array.`);
  return Array.from(value as ArrayLike<number>,(v,i)=>integer(v,`${label}[${i}]`,0,limit-1));
}

/** A box split into tetrahedra with the cell planes at the given coordinates, for meshes that are
 * fine where a crack runs and coarse elsewhere. Each list is strictly increasing, in metres. */
export function gradedBoxMesh(options:{x:ArrayLike<number>;y:ArrayLike<number>;z:ArrayLike<number>;pattern?:'alternating5'|'kuhn6'}):TetMesh {
  const o=record(options,'graded box mesh');onlyKeys(o,['x','y','z','pattern'],'graded box mesh');
  const axes=[o.x,o.y,o.z].map((list,a)=>{
    const values=numbers(Array.from(list as ArrayLike<number>),(list as ArrayLike<number>).length,'xyz'[a],-1e6,1e6);
    if(values.length<2)throw payload('Each axis needs at least two planes.');
    for(let i=1;i<values.length;i++)if(!(values[i]>values[i-1]))throw payload(`${'xyz'[a]} must be strictly increasing.`);
    return values;
  });
  const cells:[number,number,number]=[axes[0].length-1,axes[1].length-1,axes[2].length-1];
  const mesh=boxMesh({size:[1,1,1],cells,...(o.pattern===undefined?{}:{pattern:o.pattern as 'alternating5'|'kuhn6'})});
  for(let k=0,n=0;k<=cells[2];k++)for(let j=0;j<=cells[1];j++)for(let i=0;i<=cells[0];i++,n++){mesh.positions[3*n]=axes[0][i];mesh.positions[3*n+1]=axes[1][j];mesh.positions[3*n+2]=axes[2][k];}
  return mesh;
}

/** Unit eigenvector of the symmetric tensor [xx, yy, zz, yz, xz, xy] for the eigenvalue `value`. */
function eigenvector(t:ArrayLike<number>,value:number,out:number[]):void {
  const a=t[0]-value,b=t[1]-value,c=t[2]-value,yz=t[3],xz=t[4],xy=t[5];
  // The eigenvector is orthogonal to every row of (T - value I): take the largest cross product of two rows.
  const c0=[xy*yz-xz*b,xz*xy-a*yz,a*b-xy*xy],c1=[xy*c-xz*yz,xz*xz-a*c,a*yz-xy*xz],c2=[b*c-yz*yz,yz*xz-xy*c,xy*yz-b*xz];
  const n0=Math.hypot(c0[0],c0[1],c0[2]),n1=Math.hypot(c1[0],c1[1],c1[2]),n2=Math.hypot(c2[0],c2[1],c2[2]);
  const best=n0>=n1&&n0>=n2?c0:n1>=n2?c1:c2,norm=Math.max(n0,n1,n2);
  if(!(norm>0)){out[0]=1;out[1]=0;out[2]=0;return;}
  out[0]=best[0]/norm;out[1]=best[1]/norm;out[2]=best[2]/norm;
}

const NODE_FIELDS=['X','u','v','a','fext','fint','g','gTrial','trial','u0','target','x','r','z','p','ap','prescribed','nodalForce','nodalForcePrev','kd','pd','work','fth','md'] as const;
type NodeField=typeof NODE_FIELDS[number];

/**
 * A deformable solid that can crack. Small strain: the elements follow Hooke's law on
 * sym(grad u), so a piece that rotates far after breaking off carries false stress. Hand such a
 * piece to a rigid world with `handOff`. No plasticity. Contact exists only across an interface
 * (the penalty that keeps the two sides of a closed crack from passing through each other).
 */
export class FractureBody {
  readonly solver=SOLID_FRACTURE_SOLVER_ID;
  readonly model:FractureModel;readonly integrator:FractureIntegrator;readonly dt:number;
  readonly tetCount:number;
  /** Node count of the mesh as given. Temperature fields are given on these nodes. */
  readonly thermalNodeCount:number;
  /** Four node indices per element. Entries change when nodes split. */
  readonly tets:Uint32Array;
  readonly elementVolume:Float64Array;
  readonly referenceVolume:number;readonly mass:number;
  readonly lambda:number;readonly mu:number;
  readonly material:Readonly<Required<SolidMaterial>>;
  readonly law:Readonly<Required<FractureLaw>>;
  /** Number of interior faces (shared by two elements). Interface calls take indices into this list. */
  readonly interiorFaceCount:number;
  /** Number of boundary faces of the mesh as given. Load calls take indices into this list. */
  readonly boundaryFaceCount:number;
  readonly stats:FractureSolveStats={converged:true,reason:'converged',newtonIterations:0,linearIterations:0,residual:0,reference:0,sweeps:0,insertedFaces:0,damageIterations:0};

  private nodes:number;private capacity:number;
  private f!:Record<NodeField,Float64Array>;
  private fixed:Uint8Array;private nodeMass:Float64Array;private origin:Uint32Array;private nodeActive:Uint8Array;
  private readonly nodeTets:number[][];
  private readonly grad:Float64Array;private readonly theta:Float64Array;private readonly tetActive:Uint8Array;
  // Interior faces.
  private readonly fA:Uint32Array;private readonly fB:Uint32Array;private readonly fLocal:Uint8Array;
  private readonly fNormal:Float64Array;private readonly fArea:Float64Array;private readonly fCentroid:Float64Array;
  private readonly fStrength:Float64Array;private readonly fToughness:Float64Array;
  /** 0: no interface. 1: interface. 2: interface without traction. 3: pre-crack (never had cohesion). */
  private readonly fState:Uint8Array;
  private readonly hist:Float64Array;private readonly lin:Float64Array;private readonly mix:Float64Array;
  private readonly tetFace:Int32Array;private readonly inserted:number[]=[];
  // Boundary faces.
  private readonly bTet:Uint32Array;private readonly bLocal:Uint8Array;private readonly bNormal:Float64Array;private readonly bLoad:Float64Array;private readonly bLoadPrev:Float64Array;
  // Crack band.
  private readonly eStrength:Float64Array;private readonly eToughness:Float64Array;
  private readonly omega:Float64Array;private readonly kappa:Float64Array;private readonly band:Float64Array;private readonly omegaOld:Float64Array;private readonly psiOld:Float64Array;private readonly eDissipated:Float64Array;private readonly eFailed:Uint8Array;

  private readonly massDamping:number;private readonly gravity:Float64Array;
  private readonly tolerance:number;private readonly forceTolerance:number;private readonly maxNewton:number;private readonly maxLinear:number;private readonly explicitSafety:number;private readonly maxSweeps:number;private readonly maxDamage:number;
  private readonly H=new Float64Array(9);private readonly S=new Float64Array(6);private readonly principal=[0,0,0];private readonly direction=[0,0,0];
  private readonly extent:number;
  private cm=0;private cd=0;private reference=0;private referenceInertia=0;private accelerationValid=false;
  private steps=0;private solves=0;private unconverged=0;private limit:number|null=null;
  private work=0;private dampingLoss=0;private relaxed=0;private phiStart=0;private phiEnd=0;private bulkDissipated=0;private handedMass=0;
  private readonly handedMomentum=[0,0,0];
  private clamped=0;
  // The stiffness of the elements as a sparse matrix of 3x3 blocks, rebuilt when the topology or the damage changes.
  private rowStart=new Int32Array(0);private column=new Int32Array(0);private block=new Float64Array(0);private slot=new Int32Array(0);private patternStale=true;private valuesStale=true;private thermalConstant=0;
  private events:CrackEvent[]=[];

  constructor(input:FractureDefinition){
    const d=record(input,'definition');onlyKeys(d,['mesh','material','fracture','config'],'definition');
    const mesh=record(d.mesh,'mesh');onlyKeys(mesh,['positions','tets'],'mesh');
    const nodeCount=integer((mesh.positions as ArrayLike<number>)?.length/3,'node count',4,SOLID_MAX_NODES),tetCount=integer((mesh.tets as ArrayLike<number>)?.length/4,'element count',1,SOLID_MAX_TETS);
    this.nodes=this.thermalNodeCount=nodeCount;this.tetCount=tetCount;this.capacity=nodeCount;
    const X0=numbers(Array.isArray(mesh.positions)?mesh.positions:Float64Array.from(mesh.positions as ArrayLike<number>),3*nodeCount,'positions',-1e6,1e6);
    const tets=this.tets=Uint32Array.from(indexList(mesh.tets,nodeCount,'tets'));
    const m=record(d.material,'material');onlyKeys(m,['youngModulus','poissonRatio','density','thermalExpansion'],'material');
    const E=finite(m.youngModulus,'youngModulus',1,1e13),nu=finite(m.poissonRatio,'poissonRatio',-.99,.4999),rho=finite(m.density,'density',1e-6,1e6);
    this.material=Object.freeze({youngModulus:E,poissonRatio:nu,density:rho,thermalExpansion:m.thermalExpansion===undefined?0:finite(m.thermalExpansion,'thermalExpansion',-1e-2,1e-2)});
    this.lambda=E*nu/((1+nu)*(1-2*nu));this.mu=E/(2*(1+nu));
    const l=record(d.fracture,'fracture');onlyKeys(l,['model','strength','toughness','shearWeight','initialOpeningRatio','insertion','insertionThreshold','regularisation','failureStrain','residualStiffness'],'fracture');
    if(l.model!=='cohesive'&&l.model!=='crack-band'&&l.model!=='none')throw payload('Unknown fracture model.');
    const strength=finite(l.strength,'strength',1e-6,1e13),toughness=finite(l.toughness,'toughness',1e-12,1e12);
    const insertion=l.insertion===undefined?'on-demand':l.insertion,regularisation=l.regularisation===undefined?'crack-band':l.regularisation;
    if(insertion!=='on-demand'&&insertion!=='manual')throw payload('Unknown insertion rule.');
    if(regularisation!=='crack-band'&&regularisation!=='none')throw payload('Unknown regularisation.');
    const failureStrain=l.failureStrain===undefined?0:finite(l.failureStrain,'failureStrain',0,10);
    if(l.model==='crack-band'&&regularisation==='none'&&!(failureStrain>strength/E))throw payload('Without regularisation, failureStrain must be above strength / youngModulus.');
    this.law=Object.freeze({model:l.model,strength,toughness,shearWeight:l.shearWeight===undefined?1:finite(l.shearWeight,'shearWeight',1e-3,1e3),initialOpeningRatio:l.initialOpeningRatio===undefined?.02:finite(l.initialOpeningRatio,'initialOpeningRatio',1e-6,.5),insertion,insertionThreshold:l.insertionThreshold===undefined?1:finite(l.insertionThreshold,'insertionThreshold',1e-3,1),regularisation,failureStrain,residualStiffness:l.residualStiffness===undefined?1e-9:finite(l.residualStiffness,'residualStiffness',0,.1)});
    this.model=l.model;
    const c=d.config===undefined?{}:record(d.config,'config');onlyKeys(c,['dt','integrator','massDamping','gravity','tolerance','forceTolerance','maxNewtonIterations','maxLinearIterations','explicitSafety','maxInsertionSweeps','maxDamageIterations'],'config');
    const integrator=c.integrator===undefined?'backward-euler':c.integrator;
    if(integrator!=='backward-euler'&&integrator!=='midpoint'&&integrator!=='explicit')throw payload('Unknown integrator.');
    this.integrator=integrator;this.dt=c.dt===undefined?1/240:finite(c.dt,'dt',1e-12,10);
    this.massDamping=c.massDamping===undefined?0:zero(finite(c.massDamping,'massDamping',0,1e9));
    this.gravity=c.gravity===undefined?new Float64Array(3):numbers(c.gravity,3,'gravity',-1e5,1e5);
    this.tolerance=c.tolerance===undefined?1e-10:finite(c.tolerance,'tolerance',0,1e-2);this.forceTolerance=c.forceTolerance===undefined?0:finite(c.forceTolerance,'forceTolerance',0,1e12);
    this.maxNewton=c.maxNewtonIterations===undefined?80:integer(c.maxNewtonIterations,'maxNewtonIterations',1,10000);this.maxLinear=c.maxLinearIterations===undefined?20000:integer(c.maxLinearIterations,'maxLinearIterations',1,10_000_000);
    this.explicitSafety=c.explicitSafety===undefined?.9:finite(c.explicitSafety,'explicitSafety',.01,1);
    this.maxSweeps=c.maxInsertionSweeps===undefined?200:integer(c.maxInsertionSweeps,'maxInsertionSweeps',1,100000);this.maxDamage=c.maxDamageIterations===undefined?400:integer(c.maxDamageIterations,'maxDamageIterations',1,100000);

    this.allocate(nodeCount);this.f.X.set(X0);
    this.fixed=new Uint8Array(3*nodeCount);this.nodeMass=new Float64Array(nodeCount);this.origin=Uint32Array.from({length:nodeCount},(_,i)=>i);this.nodeActive=new Uint8Array(nodeCount).fill(1);
    const X=this.f.X,grad=this.grad=new Float64Array(12*tetCount),vol=this.elementVolume=new Float64Array(tetCount);
    this.nodeTets=Array.from({length:nodeCount},()=>[] as number[]);
    let total=0;const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(let n=0;n<nodeCount;n++)for(let k=0;k<3;k++){lo[k]=Math.min(lo[k],X[3*n+k]);hi[k]=Math.max(hi[k],X[3*n+k]);}
    this.extent=Math.hypot(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]);
    for(let e=0;e<tetCount;e++){
      const t=4*e;if(new Set([tets[t],tets[t+1],tets[t+2],tets[t+3]]).size!==4)throw payload(`Element ${e} repeats a node.`);
      if(tetVolume(X,tets[t],tets[t+1],tets[t+2],tets[t+3])<0){const s=tets[t+2];tets[t+2]=tets[t+3];tets[t+3]=s;}
      const n0=3*tets[t],n1=3*tets[t+1],n2=3*tets[t+2],n3=3*tets[t+3];
      const a=X[n1]-X[n0],b=X[n2]-X[n0],cc=X[n3]-X[n0],dd=X[n1+1]-X[n0+1],ee=X[n2+1]-X[n0+1],ff=X[n3+1]-X[n0+1],gg=X[n1+2]-X[n0+2],h=X[n2+2]-X[n0+2],i=X[n3+2]-X[n0+2];
      const c0=ee*i-ff*h,c1=ff*gg-dd*i,c2=dd*h-ee*gg,det=a*c0+b*c1+cc*c2,edge=Math.max(Math.hypot(a,dd,gg),Math.hypot(b,ee,h),Math.hypot(cc,ff,i));
      if(!(det>1e-9*edge*edge*edge))throw payload(`Element ${e} has no volume.`);
      const o=12*e;
      grad[o+3]=c0/det;grad[o+4]=(cc*h-b*i)/det;grad[o+5]=(b*ff-cc*ee)/det;
      grad[o+6]=c1/det;grad[o+7]=(a*i-cc*gg)/det;grad[o+8]=(cc*dd-a*ff)/det;
      grad[o+9]=c2/det;grad[o+10]=(b*gg-a*h)/det;grad[o+11]=(a*ee-b*dd)/det;
      for(let k=0;k<3;k++)grad[o+k]=-(grad[o+3+k]+grad[o+6+k]+grad[o+9+k]);
      vol[e]=det/6;total+=vol[e];
      for(let q=0;q<4;q++)this.nodeTets[tets[t+q]].push(e);
    }
    for(let n=0;n<nodeCount;n++){if(this.nodeTets[n].length===0)throw payload(`Node ${n} belongs to no element.`);this.lumpNode(n);}
    this.referenceVolume=total;this.mass=rho*total;
    this.theta=new Float64Array(tetCount);this.tetActive=new Uint8Array(tetCount).fill(1);

    // Faces: an interior face is listed where its first element is met, so the order follows the element order.
    const seen=new Map<string,number>(),first:number[]=[],second:number[]=[];
    for(let e=0;e<tetCount;e++)for(let skip=0;skip<4;skip++){
      const key=[0,1,2,3].filter(q=>q!==skip).map(q=>tets[4*e+q]).sort((p,q)=>p-q).join(','),at=seen.get(key);
      if(at===undefined){seen.set(key,first.length);first.push(4*e+skip);second.push(-1);}
      else{if(second[at]>=0)throw payload('Three elements share one face.');second[at]=4*e+skip;}
    }
    const interior:number[]=[],boundary:number[]=[];
    for(let i=0;i<first.length;i++)(second[i]>=0?interior:boundary).push(i);
    const nf=this.interiorFaceCount=interior.length,nb=this.boundaryFaceCount=boundary.length;
    this.fA=new Uint32Array(nf);this.fB=new Uint32Array(nf);this.fLocal=new Uint8Array(6*nf);this.fNormal=new Float64Array(3*nf);this.fArea=new Float64Array(nf);this.fCentroid=new Float64Array(3*nf);
    this.fStrength=new Float64Array(nf).fill(strength);this.fToughness=new Float64Array(nf).fill(toughness);this.fState=new Uint8Array(nf);this.hist=new Float64Array(3*nf);this.lin=new Float64Array(18*nf);this.mix=new Float64Array(nf);
    this.tetFace=new Int32Array(4*tetCount).fill(-1);
    const normal=[0,0,0,0];
    for(let f=0;f<nf;f++){
      const a=first[interior[f]],b=second[interior[f]],A=a>>2,B=b>>2,skipA=a&3,skipB=b&3;
      this.fA[f]=A;this.fB[f]=B;this.tetFace[a]=f;this.tetFace[b]=f;
      const locals=[0,1,2,3].filter(q=>q!==skipA).sort((p,q)=>tets[4*A+p]-tets[4*A+q]);
      for(let i=0;i<3;i++){
        const node=tets[4*A+locals[i]];this.fLocal[6*f+i]=locals[i];
        for(let q=0;q<4;q++)if(tets[4*B+q]===node)this.fLocal[6*f+3+i]=q;
      }
      this.triangle(tets[4*A+locals[0]],tets[4*A+locals[1]],tets[4*A+locals[2]],normal);
      // The normal points from element A to element B: away from A's fourth node.
      const p=3*tets[4*A+locals[0]],q=3*tets[4*A+skipA],sign=(X[q]-X[p])*normal[0]+(X[q+1]-X[p+1])*normal[1]+(X[q+2]-X[p+2])*normal[2]>0?-1:1;
      for(let k=0;k<3;k++){this.fNormal[3*f+k]=zero(sign*normal[k]);this.fCentroid[3*f+k]=(X[3*tets[4*A+locals[0]]+k]+X[3*tets[4*A+locals[1]]+k]+X[3*tets[4*A+locals[2]]+k])/3;}
      this.fArea[f]=normal[3];
    }
    this.bTet=new Uint32Array(nb);this.bLocal=new Uint8Array(3*nb);this.bNormal=new Float64Array(4*nb);this.bLoad=new Float64Array(3*nb);this.bLoadPrev=new Float64Array(3*nb);
    for(let f=0;f<nb;f++){
      const a=first[boundary[f]],e=a>>2,skip=a&3,locals=[0,1,2,3].filter(q=>q!==skip);
      // Wound so that the normal points out of the solid, as boundaryFaces() does.
      if(tetVolume(X,tets[4*e+locals[0]],tets[4*e+locals[1]],tets[4*e+locals[2]],tets[4*e+skip])>0){const s=locals[1];locals[1]=locals[2];locals[2]=s;}
      this.bTet[f]=e;for(let i=0;i<3;i++)this.bLocal[3*f+i]=locals[i];
      this.triangle(tets[4*e+locals[0]],tets[4*e+locals[1]],tets[4*e+locals[2]],normal);
      for(let k=0;k<4;k++)this.bNormal[4*f+k]=normal[k];
    }
    this.eStrength=new Float64Array(tetCount).fill(strength);this.eToughness=new Float64Array(tetCount).fill(toughness);
    this.omega=new Float64Array(tetCount);this.kappa=new Float64Array(tetCount);this.band=new Float64Array(tetCount);this.omegaOld=new Float64Array(tetCount);this.psiOld=new Float64Array(tetCount);this.eDissipated=new Float64Array(tetCount);this.eFailed=new Uint8Array(tetCount);
    if(integrator==='explicit'&&this.dt>this.explicitSafety*this.explicitLimit())
      throw new EngineError('UNSTABLE_TIME_STEP',`Explicit time step ${this.dt} s exceeds ${this.explicitSafety} of the stability limit ${this.explicitLimit()} s.`);
  }

  // ---- Storage and topology ----

  private allocate(capacity:number):void {
    const next={} as Record<NodeField,Float64Array>;
    for(const name of NODE_FIELDS){next[name]=new Float64Array(3*capacity);if(this.f)next[name].set(this.f[name].subarray(0,3*this.nodes));}
    this.f=next;
    if(this.fixed){
      const fixed=new Uint8Array(3*capacity);fixed.set(this.fixed.subarray(0,3*this.nodes));this.fixed=fixed;
      const mass=new Float64Array(capacity);mass.set(this.nodeMass.subarray(0,this.nodes));this.nodeMass=mass;
      const origin=new Uint32Array(capacity);origin.set(this.origin.subarray(0,this.nodes));this.origin=origin;
      const active=new Uint8Array(capacity);active.set(this.nodeActive.subarray(0,this.nodes));this.nodeActive=active;
    }
    this.capacity=capacity;
  }
  /** Unit normal of the triangle (a, b, c) into n[0..2] and its area into n[3]. */
  private triangle(a:number,b:number,c:number,n:number[]):void {
    const X=this.f.X,ux=X[3*b]-X[3*a],uy=X[3*b+1]-X[3*a+1],uz=X[3*b+2]-X[3*a+2],vx=X[3*c]-X[3*a],vy=X[3*c+1]-X[3*a+1],vz=X[3*c+2]-X[3*a+2];
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx,length=Math.hypot(x,y,z);
    n[0]=x/length;n[1]=y/length;n[2]=z/length;n[3]=length/2;
  }
  /** Lumped mass and reference stiffness diagonal of a node from the elements that touch it, in element order. */
  private lumpNode(n:number):void {
    const rho=this.material.density,g=this.grad,kd=this.f.kd,mu=this.mu,la=this.lambda;let mass=0,kx=0,ky=0,kz=0;
    for(const e of this.nodeTets[n]){
      const V=this.elementVolume[e];let q=0;while(this.tets[4*e+q]!==n)q++;
      const gx=g[12*e+3*q],gy=g[12*e+3*q+1],gz=g[12*e+3*q+2],g2=gx*gx+gy*gy+gz*gz;
      mass+=rho*V/4;kx+=V*(mu*g2+(la+mu)*gx*gx);ky+=V*(mu*g2+(la+mu)*gy*gy);kz+=V*(mu*g2+(la+mu)*gz*gz);
    }
    this.nodeMass[n]=mass;kd[3*n]=kx;kd[3*n+1]=ky;kd[3*n+2]=kz;this.f.md[3*n]=this.f.md[3*n+1]=this.f.md[3*n+2]=mass;
  }
  /** Duplicates each listed node once per extra group of its elements that is no longer joined to the
   * others through a face without an interface. The group that holds the lowest element keeps the
   * node; the other groups take new nodes in the order of their lowest element. A new node copies
   * position, displacement, velocity and constraints; point forces stay on the original. */
  private splitNodes(list:number[]):void {
    const tets=this.tets;
    for(const n of list){
      const around=this.nodeTets[n];if(around.length<2)continue;
      const label=new Map<number,number>(),groups:number[][]=[];
      for(const start of around){
        if(label.has(start))continue;
        const group=[start],stack=[start];label.set(start,groups.length);
        while(stack.length>0){
          const t=stack.pop()!;
          for(let skip=0;skip<4;skip++){
            if(tets[4*t+skip]===n)continue;
            const face=this.tetFace[4*t+skip];if(face<0||this.fState[face]!==0)continue;
            const other=this.fA[face]===t?this.fB[face]:this.fA[face];
            if(!label.has(other)){label.set(other,groups.length);group.push(other);stack.push(other);}
          }
        }
        groups.push(group.sort((p,q)=>p-q));
      }
      if(groups.length<2)continue;
      this.nodeTets[n]=groups[0];
      for(let k=1;k<groups.length;k++){
        if(this.nodes>=SOLID_MAX_NODES)throw new EngineError('NUMERICAL_FAILURE','Node splitting reached the node limit.');
        if(this.nodes===this.capacity)this.allocate(Math.ceil(1.5*this.capacity)+16);
        const fresh=this.nodes++;
        for(const name of NODE_FIELDS){const array=this.f[name];for(let c=0;c<3;c++)array[3*fresh+c]=name==='nodalForce'||name==='nodalForcePrev'?0:array[3*n+c];}
        for(let c=0;c<3;c++)this.fixed[3*fresh+c]=this.fixed[3*n+c];
        this.origin[fresh]=this.origin[n];this.nodeActive[fresh]=1;
        for(const e of groups[k])for(let q=0;q<4;q++)if(tets[4*e+q]===n)tets[4*e+q]=fresh;
        this.nodeTets.push(groups[k]);this.lumpNode(fresh);
      }
      this.lumpNode(n);
    }
    this.accelerationValid=false;this.patternStale=true;
  }
  private insert(list:number[],state:1|3):number {
    const touched=new Set<number>();let count=0;
    for(const face of [...list].sort((p,q)=>p-q)){
      if(this.fState[face]!==0)continue;
      const dc=2*this.fToughness[face]/this.fStrength[face];
      this.fState[face]=state;this.inserted.push(face);count++;
      for(let i=0;i<3;i++){this.hist[3*face+i]=state===3?Infinity:this.law.initialOpeningRatio*dc;touched.add(this.tets[4*this.fA[face]+this.fLocal[6*face+i]]);}
    }
    if(count>0)this.splitNodes([...touched].sort((p,q)=>p-q));
    return count;
  }

  // ---- Selection, constraints and loads ----

  /** Current node count. It grows when nodes split. */
  get nodeCount():number {return this.nodes;}
  /** Reference node positions (x, y, z per node, m). A duplicated node has the position of its original. */
  get referencePositions():Float64Array {return this.f.X.subarray(0,3*this.nodes);}
  /** Lumped mass per node, kg. */
  get nodalMass():Float64Array {return this.nodeMass.subarray(0,this.nodes);}
  /** For each node, the node of the mesh as given that it came from. */
  get nodeOrigin():Uint32Array {return this.origin.subarray(0,this.nodes);}
  /** Boundary triangles of the mesh as given, three current node indices each, wound outward. */
  get faces():Uint32Array {
    const out=new Uint32Array(3*this.boundaryFaceCount);
    for(let f=0;f<this.boundaryFaceCount;f++)for(let i=0;i<3;i++)out[3*f+i]=this.tets[4*this.bTet[f]+this.bLocal[3*f+i]];
    return out;
  }
  /** Nodes (duplicates included) whose reference position satisfies the predicate. */
  selectNodes(predicate:(x:number,y:number,z:number)=>boolean):Uint32Array {
    const X=this.f.X,out:number[]=[];
    for(let n=0;n<this.nodes;n++)if(predicate(X[3*n],X[3*n+1],X[3*n+2]))out.push(n);
    return Uint32Array.from(out);
  }
  /** Boundary faces whose reference centroid and outward unit normal satisfy the predicate. */
  selectFaces(predicate:(cx:number,cy:number,cz:number,nx:number,ny:number,nz:number)=>boolean):Uint32Array {
    const X=this.f.X,out:number[]=[];
    for(let f=0;f<this.boundaryFaceCount;f++){
      const e=this.bTet[f],a=3*this.tets[4*e+this.bLocal[3*f]],b=3*this.tets[4*e+this.bLocal[3*f+1]],c=3*this.tets[4*e+this.bLocal[3*f+2]];
      if(predicate((X[a]+X[b]+X[c])/3,(X[a+1]+X[b+1]+X[c+1])/3,(X[a+2]+X[b+2]+X[c+2])/3,this.bNormal[4*f],this.bNormal[4*f+1],this.bNormal[4*f+2]))out.push(f);
    }
    return Uint32Array.from(out);
  }
  /** Interior faces whose centroid and unit normal satisfy the predicate. The normal points from the
   * lower-numbered element of the face to the higher. */
  selectInteriorFaces(predicate:(cx:number,cy:number,cz:number,nx:number,ny:number,nz:number)=>boolean):Uint32Array {
    const out:number[]=[],c=this.fCentroid,n=this.fNormal;
    for(let f=0;f<this.interiorFaceCount;f++)if(predicate(c[3*f],c[3*f+1],c[3*f+2],n[3*f],n[3*f+1],n[3*f+2]))out.push(f);
    return Uint32Array.from(out);
  }
  /** Elements whose reference centroid satisfies the predicate. */
  selectElements(predicate:(cx:number,cy:number,cz:number)=>boolean):Uint32Array {
    const X=this.f.X,t=this.tets,out:number[]=[];
    for(let e=0;e<this.tetCount;e++){
      let x=0,y=0,z=0;for(let q=0;q<4;q++){x+=X[3*t[4*e+q]];y+=X[3*t[4*e+q]+1];z+=X[3*t[4*e+q]+2];}
      if(predicate(x/4,y/4,z/4))out.push(e);
    }
    return Uint32Array.from(out);
  }
  /** Geometry and state of an interior face. `state`: 'intact' (no interface), 'cohesive', 'open' (no traction left) or 'precrack'. */
  interiorFace(face:number):{elements:[number,number];nodes:[number,number,number,number,number,number];normal:[number,number,number];centroid:[number,number,number];area:number;state:'intact'|'cohesive'|'open'|'precrack';strength:number;toughness:number} {
    const f=integer(face,'face',0,this.interiorFaceCount-1),A=this.fA[f],B=this.fB[f],L=this.fLocal,t=this.tets;
    return {elements:[A,B],nodes:[t[4*A+L[6*f]],t[4*A+L[6*f+1]],t[4*A+L[6*f+2]],t[4*B+L[6*f+3]],t[4*B+L[6*f+4]],t[4*B+L[6*f+5]]],
      normal:[this.fNormal[3*f],this.fNormal[3*f+1],this.fNormal[3*f+2]],centroid:[this.fCentroid[3*f],this.fCentroid[3*f+1],this.fCentroid[3*f+2]],area:this.fArea[f],
      state:(['intact','cohesive','open','precrack'] as const)[this.fState[f]],strength:this.fStrength[f],toughness:this.fToughness[f]};
  }
  /** Prescribes displacement components (m) at nodes; `null` leaves a component as it is. A node that
   * splits later passes its constraints to its duplicates. */
  constrain(nodes:ArrayLike<number>,value:readonly [number|null,number|null,number|null]=[0,0,0]):void {
    const list=indexList(nodes,this.nodes,'nodes');
    if(!Array.isArray(value)||value.length!==3)throw payload('A constraint needs three components.');
    const values=value.map((v,k)=>v===null?null:zero(finite(v,`constraint[${k}]`,-1e6,1e6)));
    for(const n of list)for(let k=0;k<3;k++){const w=values[k];if(w!==null){this.fixed[3*n+k]=1;this.f.prescribed[3*n+k]=w;this.f.v[3*n+k]=0;}}
    this.accelerationValid=false;
  }
  release(nodes:ArrayLike<number>):void {
    for(const n of indexList(nodes,this.nodes,'nodes'))if(this.nodeActive[n])for(let k=0;k<3;k++){this.fixed[3*n+k]=0;this.f.prescribed[3*n+k]=0;}
    this.accelerationValid=false;
  }
  /** Sets the point force on one node, N. When the node splits the force stays on the original. */
  setNodalForce(node:number,force:readonly [number,number,number]):void {
    const n=integer(node,'node',0,this.nodes-1),f=numbers(force,3,'force',-1e15,1e15);
    for(let k=0;k<3;k++)this.f.nodalForce[3*n+k]=f[k];this.accelerationValid=false;
  }
  /** Adds a uniform traction (Pa) on boundary faces. The load belongs to the face, so it follows node splits. */
  addTraction(faces:ArrayLike<number>,traction:readonly [number,number,number]):void {
    const t=numbers(traction,3,'traction',-1e15,1e15);
    for(const f of indexList(faces,this.boundaryFaceCount,'faces'))for(let k=0;k<3;k++)this.bLoad[3*f+k]+=t[k]*this.bNormal[4*f+3];
    this.accelerationValid=false;
  }
  /** Adds a pressure (Pa, positive pushes into the solid) on boundary faces. */
  addPressure(faces:ArrayLike<number>,pressure:number):void {
    const p=finite(pressure,'pressure',-1e15,1e15);
    for(const f of indexList(faces,this.boundaryFaceCount,'faces'))for(let k=0;k<3;k++)this.bLoad[3*f+k]-=p*this.bNormal[4*f+k]*this.bNormal[4*f+3];
    this.accelerationValid=false;
  }
  clearSurfaceLoads():void {this.bLoad.fill(0);this.accelerationValid=false;}
  /** Temperature rise above the stress-free reference, K: one value, or one per node of the mesh as
   * given (`thermalNodeCount` values; duplicated nodes read their original). */
  setTemperatureChange(rise:number|ArrayLike<number>):void {
    const alpha=this.material.thermalExpansion,nodal=typeof rise==='number'?null:numbers(Array.isArray(rise)?rise:Array.from(rise),this.thermalNodeCount,'temperature',-1e5,1e5),uniform=nodal?0:finite(rise,'temperature',-1e5,1e5),o=this.origin,t=this.tets;
    for(let e=0;e<this.tetCount;e++){
      const theta=alpha*(nodal?(nodal[o[t[4*e]]]+nodal[o[t[4*e+1]]]+nodal[o[t[4*e+2]]]+nodal[o[t[4*e+3]]])/4:uniform);
      if(!(theta>-.5))throw payload('The thermal strain must stay above -0.5.');
      this.theta[e]=theta;
    }
    this.accelerationValid=false;this.valuesStale=true;
  }
  /** Strength and fracture energy of chosen interior faces (a weak interface). Faces that already have an interface are refused. */
  setInterfaceProperties(faces:ArrayLike<number>,properties:{strength?:number;toughness?:number}):void {
    const p=record(properties,'interface properties');onlyKeys(p,['strength','toughness'],'interface properties');
    const strength=p.strength===undefined?null:finite(p.strength,'strength',1e-6,1e13),toughness=p.toughness===undefined?null:finite(p.toughness,'toughness',1e-12,1e12);
    for(const f of indexList(faces,this.interiorFaceCount,'faces')){
      if(this.fState[f]!==0)throw new EngineError('INVALID_STATE',`Face ${f} already has an interface.`);
      if(strength!==null)this.fStrength[f]=strength;if(toughness!==null)this.fToughness[f]=toughness;
    }
    this.limit=null;
  }
  /** Strength and fracture energy of chosen elements, for the crack-band model (a weak layer). */
  setElementProperties(elements:ArrayLike<number>,properties:{strength?:number;toughness?:number}):void {
    const p=record(properties,'element properties');onlyKeys(p,['strength','toughness'],'element properties');
    const strength=p.strength===undefined?null:finite(p.strength,'strength',1e-6,1e13),toughness=p.toughness===undefined?null:finite(p.toughness,'toughness',1e-12,1e12);
    for(const e of indexList(elements,this.tetCount,'elements')){
      if(this.kappa[e]>0)throw new EngineError('INVALID_STATE',`Element ${e} is already damaged.`);
      if(strength!==null)this.eStrength[e]=strength;if(toughness!==null)this.eToughness[e]=toughness;
    }
  }
  /** Puts an undamaged cohesive interface on interior faces now, whatever their traction. Returns how many were new. */
  insertCohesive(faces:ArrayLike<number>):number {
    if(this.model!=='cohesive')throw new EngineError('INVALID_STATE','Interfaces need the cohesive model.');
    return this.insert(indexList(faces,this.interiorFaceCount,'faces'),1);
  }
  /** Cuts the body along interior faces: an interface with no cohesion from the start (a notch or a
   * pre-crack). It dissipates nothing; its two sides still cannot pass through each other. Any model. */
  precrack(faces:ArrayLike<number>):number {return this.insert(indexList(faces,this.interiorFaceCount,'faces'),3);}

  private assembleLoads(point:Float64Array,face:Float64Array,out:Float64Array):void {
    const g=this.gravity,t=this.tets;
    for(let n=0;n<this.nodes;n++){const m=this.nodeActive[n]?this.nodeMass[n]:0;for(let k=0;k<3;k++)out[3*n+k]=point[3*n+k]+m*g[k];}
    for(let f=0;f<this.boundaryFaceCount;f++){
      const e=this.bTet[f];if(!this.tetActive[e])continue;
      for(let i=0;i<3;i++){const n=3*t[4*e+this.bLocal[3*f+i]];for(let k=0;k<3;k++)out[n+k]+=face[3*f+k]/3;}
    }
  }

  // ---- State ----

  /** Live nodal displacements (m), three per current node. Read only. */
  get displacements():Float64Array {return this.f.u.subarray(0,3*this.nodes);}
  /** Live nodal velocities (m/s). Read only. */
  get velocities():Float64Array {return this.f.v.subarray(0,3*this.nodes);}
  get time():number {return this.steps*this.dt;}
  get unconvergedSteps():number {return this.unconverged;}
  /** Replaces displacements and/or velocities (three per current node). The energy this adds or removes is booked as external work. */
  setState(displacements?:ArrayLike<number>,velocities?:ArrayLike<number>):void {
    const size=3*this.nodes,u=displacements===undefined?null:numbers(Array.isArray(displacements)?displacements:Array.from(displacements),size,'displacements',-1e6,1e6),v=velocities===undefined?null:numbers(Array.isArray(velocities)?velocities:Array.from(velocities),size,'velocities',-1e9,1e9);
    for(let j=0;j<size;j++)if(this.fixed[j]&&((u&&u[j]!==this.f.prescribed[j])||(v&&v[j]!==0)))throw payload('A constrained component must keep its prescribed displacement and zero velocity.');
    const before=this.strainEnergy()+this.interfaceEnergy()+this.kineticEnergy();
    if(u)this.f.u.set(u);if(v)this.f.v.set(v);
    this.work+=this.strainEnergy()+this.interfaceEnergy()+this.kineticEnergy()-before;this.accelerationValid=false;
  }
  /** Current node positions (m). */
  positions(out=new Float64Array(3*this.nodes)):Float64Array {for(let j=0;j<out.length;j++)out[j]=this.f.X[j]+this.f.u[j];return out;}

  // ---- Mechanics ----

  /** Small strain of element e minus its thermal strain into S as [xx, yy, zz, yz, xz, xy] (tensor components). */
  private strain(e:number,u:Float64Array,thermal:number):void {
    const g=this.grad,t=this.tets,o=12*e,S=this.S;let xx=0,yy=0,zz=0,yz=0,xz=0,xy=0;
    for(let q=0;q<4;q++){
      const n=3*t[4*e+q],gx=g[o+3*q],gy=g[o+3*q+1],gz=g[o+3*q+2],ux=u[n],uy=u[n+1],uz=u[n+2];
      xx+=ux*gx;yy+=uy*gy;zz+=uz*gz;yz+=uy*gz+uz*gy;xz+=ux*gz+uz*gx;xy+=ux*gy+uy*gx;
    }
    S[0]=xx-thermal;S[1]=yy-thermal;S[2]=zz-thermal;S[3]=.5*yz;S[4]=.5*xz;S[5]=.5*xy;
  }
  /** Replaces the strain in S by the undamaged stress 2 mu eps + lambda tr(eps) I; returns the undamaged energy density. */
  private hooke():number {
    const S=this.S,mu=this.mu,tr=this.lambda*(S[0]+S[1]+S[2]),w=mu*(S[0]*S[0]+S[1]*S[1]+S[2]*S[2]+2*(S[3]*S[3]+S[4]*S[4]+S[5]*S[5]))+.5*tr*(S[0]+S[1]+S[2]);
    S[0]=2*mu*S[0]+tr;S[1]=2*mu*S[1]+tr;S[2]=2*mu*S[2]+tr;S[3]*=2*mu;S[4]*=2*mu;S[5]*=2*mu;
    return w;
  }
  /** Adds scale * V * sigma g_a to the nodes of element e, with sigma in S. */
  private scatter(e:number,scale:number,out:Float64Array):void {
    const S=this.S,g=this.grad,V=scale*this.elementVolume[e],o=12*e;
    for(let q=0;q<4;q++){
      const n=3*this.tets[4*e+q],gx=V*g[o+3*q],gy=V*g[o+3*q+1],gz=V*g[o+3*q+2];
      out[n]+=S[0]*gx+S[5]*gy+S[4]*gz;out[n+1]+=S[5]*gx+S[1]*gy+S[3]*gz;out[n+2]+=S[4]*gx+S[3]*gy+S[2]*gz;
    }
  }
  /** Builds the block-sparse stiffness of the elements: K_ab = V [lambda g_a g_b^T + mu g_b g_a^T + mu (g_a . g_b) I], scaled by the damage. */
  private assemble():void {
    const t=this.tets,g=this.grad,mu=this.mu,la=this.lambda;
    if(this.patternStale){
      const start=this.rowStart=new Int32Array(this.nodes+1),columns:number[]=[],where=new Map<number,number>();
      this.slot=new Int32Array(16*this.tetCount);
      for(let n=0;n<this.nodes;n++){
        const seen=new Set<number>();for(const e of this.nodeTets[n])for(let q=0;q<4;q++)seen.add(t[4*e+q]);
        const row=[...seen].sort((p,q)=>p-q);where.clear();
        for(let i=0;i<row.length;i++){where.set(row[i],columns.length);columns.push(row[i]);}
        for(const e of this.nodeTets[n]){let a=0;while(t[4*e+a]!==n)a++;for(let b=0;b<4;b++)this.slot[16*e+4*a+b]=where.get(t[4*e+b])!;}
        start[n+1]=columns.length;
      }
      this.column=Int32Array.from(columns);this.block=new Float64Array(9*columns.length);this.patternStale=false;
    }
    const K=this.block,fth=this.f.fth;K.fill(0);fth.fill(0,0,3*this.nodes);this.thermalConstant=0;
    for(let e=0;e<this.tetCount;e++){
      if(!this.tetActive[e])continue;
      const V=this.stiffnessScale(e)*this.elementVolume[e],o=12*e,th=this.theta[e];
      if(th!==0){
        // Thermal load V (3 lambda + 2 mu) theta g_a and the constant part of the energy.
        const s=V*(3*la+2*mu)*th;this.thermalConstant+=1.5*s*th;
        for(let a=0;a<4;a++){const n=3*t[4*e+a];fth[n]+=s*g[o+3*a];fth[n+1]+=s*g[o+3*a+1];fth[n+2]+=s*g[o+3*a+2];}
      }
      for(let a=0;a<4;a++)for(let b=0;b<4;b++){
        const ax=g[o+3*a],ay=g[o+3*a+1],az=g[o+3*a+2],bx=g[o+3*b],by=g[o+3*b+1],bz=g[o+3*b+2],dot=V*mu*(ax*bx+ay*by+az*bz),k=9*this.slot[16*e+4*a+b],l=V*la,m=V*mu;
        K[k]+=l*ax*bx+m*bx*ax+dot;K[k+1]+=l*ax*by+m*bx*ay;K[k+2]+=l*ax*bz+m*bx*az;
        K[k+3]+=l*ay*bx+m*by*ax;K[k+4]+=l*ay*by+m*by*ay+dot;K[k+5]+=l*ay*bz+m*by*az;
        K[k+6]+=l*az*bx+m*bz*ax;K[k+7]+=l*az*by+m*bz*ay;K[k+8]+=l*az*bz+m*bz*az+dot;
      }
    }
    this.valuesStale=false;
  }
  private stiffnessScale(e:number):number {return this.model==='crack-band'?Math.max(1-this.omega[e],this.law.residualStiffness):1;}
  /** Strain energy of the elements at u, as u.K u / 2 - u.f_th + c with the assembled stiffness and the
   * thermal load; adds their nodal forces K u - f_th to `out`. */
  private bulk(u:Float64Array,out:Float64Array|null):number {
    if(this.patternStale||this.valuesStale)this.assemble();
    const start=this.rowStart,column=this.column,K=this.block,fth=this.f.fth;let energy=this.thermalConstant;
    for(let n=0;n<this.nodes;n++){
      let fx=0,fy=0,fz=0;
      for(let k=start[n],end=start[n+1];k<end;k++){
        const c=3*column[k],o=9*k,ux=u[c],uy=u[c+1],uz=u[c+2];
        fx+=K[o]*ux+K[o+1]*uy+K[o+2]*uz;fy+=K[o+3]*ux+K[o+4]*uy+K[o+5]*uz;fz+=K[o+6]*ux+K[o+7]*uy+K[o+8]*uz;
      }
      const j=3*n;energy+=u[j]*(.5*fx-fth[j])+u[j+1]*(.5*fy-fth[j+1])+u[j+2]*(.5*fz-fth[j+2]);
      if(out){out[j]+=fx-fth[j];out[j+1]+=fy-fth[j+1];out[j+2]+=fz-fth[j+2];}
    }
    return energy;
  }
  /** The bilinear law of a face: critical opening, opening at the peak and strength. */
  private envelope(strength:number,d0:number,dc:number,opening:number):number {
    return opening<=d0?strength*opening/d0:opening<dc?strength*(dc-opening)/(dc-d0):0;
  }
  /** Energy of the interfaces at u for the damage history `hist`: for an opening below the history it is
   * the secant spring; beyond it, the energy follows the softening envelope, so its derivative is the
   * traction of a face that is being damaged. Adds the nodal forces to `out` and keeps the data of the
   * tangent when `store` is set. With `recoverable` it returns only the part that unloading gives back. */
  private cohesive(u:Float64Array,out:Float64Array|null,store:boolean,recoverable=false):number {
    const t=this.tets,L=this.fLocal,N=this.fNormal,lin=this.lin,beta2=this.law.shearWeight*this.law.shearWeight,ratio=this.law.initialOpeningRatio;let energy=0;
    for(const f of this.inserted){
      const A=this.fA[f],B=this.fB[f];if(!this.tetActive[A]||!this.tetActive[B])continue;
      const sc=this.fStrength[f],dc=2*this.fToughness[f]/sc,d0=ratio*dc,stiffness=sc/d0,w=this.fArea[f]/3,nx=N[3*f],ny=N[3*f+1],nz=N[3*f+2],cut=this.fState[f]===3;
      for(let i=0;i<3;i++){
        const a=3*t[4*A+L[6*f+i]],b=3*t[4*B+L[6*f+3+i]],o=6*(3*f+i);
        if(a===b){if(store)lin[o]=-1;continue;}
        const dx=u[b]-u[a],dy=u[b+1]-u[a+1],dz=u[b+2]-u[a+2],dn=dx*nx+dy*ny+dz*nz,open=dn>0?dn:0;
        // q = <dn> n + beta^2 (sliding part); the effective opening is sqrt(q . delta).
        const qx=open*nx+beta2*(dx-dn*nx),qy=open*ny+beta2*(dy-dn*ny),qz=open*nz+beta2*(dz-dn*nz),eff=Math.sqrt(Math.max(qx*dx+qy*dy+qz*dz,0)),k=this.hist[3*f+i];
        let secant=0,curve=0;
        if(!cut){
          if(eff<=k){secant=this.envelope(sc,d0,dc,k)/k;energy+=.5*w*secant*eff*eff;}
          else{
            const peak=this.envelope(sc,d0,dc,eff),at=this.envelope(sc,d0,dc,k);secant=peak/eff;
            if(recoverable)energy+=.5*w*peak*eff;
            else{
              // Area under the envelope from the history to the opening, plus the secant energy at the history.
              const area=(x:number,tx:number)=>x<dc?.5*sc*d0+.5*(sc+tx)*(x-d0):.5*sc*dc;
              energy+=w*(area(eff,peak)-area(k,at)+.5*at*k);
            }
            // d(secant)/d(eff) / eff, with the slope of the softening branch.
            curve=eff<dc?((-sc/(dc-d0))*eff-peak)/(eff*eff*eff):0;
          }
        }
        const contact=dn<0?stiffness*dn:0;if(dn<0)energy+=.5*w*contact*dn;
        if(out){
          const fx=w*(secant*qx+contact*nx),fy=w*(secant*qy+contact*ny),fz=w*(secant*qz+contact*nz);
          out[b]+=fx;out[b+1]+=fy;out[b+2]+=fz;out[a]-=fx;out[a+1]-=fy;out[a+2]-=fz;
        }
        if(store){lin[o]=secant;lin[o+1]=curve;lin[o+2]=qx;lin[o+3]=qy;lin[o+4]=qz;lin[o+5]=dn<0?-1:1;}
      }
    }
    return energy;
  }
  /** out = K x: the elements with their current damage plus the tangent of the interfaces stored by `cohesive`. */
  private stiffness(x:Float64Array,out:Float64Array):void {
    if(this.patternStale||this.valuesStale)this.assemble();
    const start=this.rowStart,column=this.column,K=this.block;
    for(let n=0;n<this.nodes;n++){
      let fx=0,fy=0,fz=0;
      for(let k=start[n],end=start[n+1];k<end;k++){
        const c=3*column[k],o=9*k,ux=x[c],uy=x[c+1],uz=x[c+2];
        fx+=K[o]*ux+K[o+1]*uy+K[o+2]*uz;fy+=K[o+3]*ux+K[o+4]*uy+K[o+5]*uz;fz+=K[o+6]*ux+K[o+7]*uy+K[o+8]*uz;
      }
      out[3*n]=fx;out[3*n+1]=fy;out[3*n+2]=fz;
    }
    const t=this.tets,L=this.fLocal,N=this.fNormal,lin=this.lin,beta2=this.law.shearWeight*this.law.shearWeight,ratio=this.law.initialOpeningRatio;
    for(const f of this.inserted){
      const A=this.fA[f],B=this.fB[f];if(!this.tetActive[A]||!this.tetActive[B])continue;
      const w=this.fArea[f]/3,nx=N[3*f],ny=N[3*f+1],nz=N[3*f+2],stiffness=this.fStrength[f]*this.fStrength[f]/(2*ratio*this.fToughness[f]);
      for(let i=0;i<3;i++){
        const o=6*(3*f+i),secant=lin[o];if(secant<0)continue;
        const a=3*t[4*A+L[6*f+i]],b=3*t[4*B+L[6*f+3+i]];if(a===b)continue;
        const dx=x[b]-x[a],dy=x[b+1]-x[a+1],dz=x[b+2]-x[a+2],dn=dx*nx+dy*ny+dz*nz,side=lin[o+5],normal=side>0?secant:stiffness;
        const along=lin[o+1]*(lin[o+2]*dx+lin[o+3]*dy+lin[o+4]*dz),shear=secant*beta2;
        const fx=w*(normal*dn*nx+shear*(dx-dn*nx)+along*lin[o+2]),fy=w*(normal*dn*ny+shear*(dy-dn*ny)+along*lin[o+3]),fz=w*(normal*dn*nz+shear*(dz-dn*nz)+along*lin[o+4]);
        out[b]+=fx;out[b+1]+=fy;out[b+2]+=fz;out[a]-=fx;out[a+1]-=fy;out[a+2]-=fz;
      }
    }
  }
  /** Internal nodal forces of the elements and interfaces at u into `out`. */
  private internal(u:Float64Array,out:Float64Array):void {out.fill(0,0,3*this.nodes);this.bulk(u,out);this.cohesive(u,out,false);}

  // ---- Solver ----

  private norm(a:Float64Array):number {let s=0;for(let j=0,size=3*this.nodes;j<size;j++)s+=a[j]*a[j];return Math.sqrt(s);}
  /** Incremental potential at u and its gradient on the free components. */
  private objective(u:Float64Array,g:Float64Array):number {
    const {fint,fext,target,u0,md:mass}=this.f,size=3*this.nodes,cm=this.cm,cd=this.cd*this.massDamping;
    fint.fill(0,0,size);
    let phi=this.bulk(u,fint)+this.cohesive(u,fint,true),internal=0,external=0;
    for(let j=0;j<size;j++){phi-=fext[j]*u[j];g[j]=fint[j]-fext[j];internal+=fint[j]*fint[j];external+=fext[j]*fext[j];}
    if(cm>0)for(let j=0;j<size;j++){const d=u[j]-target[j],md=cm*mass[j]*d;phi+=.5*md*d;g[j]+=md;}
    if(cd>0)for(let j=0;j<size;j++){const d=u[j]-u0[j],md=cd*mass[j]*d;phi+=.5*md*d;g[j]+=md;}
    for(let j=0;j<size;j++)if(this.fixed[j])g[j]=0;
    this.reference=Math.max(Math.sqrt(internal),Math.sqrt(external),this.referenceInertia);
    return phi;
  }
  /** Preconditioned conjugate gradients for (K + mScale M) x = -g. Negative count: stopped on a direction of non-positive curvature. */
  private conjugateGradient(mScale:number,g:Float64Array,target:number):number {
    const {x,r,z,p,ap,pd,md}=this.f,fixed=this.fixed,size=3*this.nodes,limit=target*target;let rz=0,rr=0,iterations=0;
    for(let j=0;j<size;j++){x[j]=0;const rj=fixed[j]?0:-g[j];r[j]=rj;z[j]=p[j]=rj/pd[j];rz+=rj*z[j];rr+=rj*rj;}
    while(iterations<this.maxLinear&&rr>limit){
      this.stiffness(p,ap);let curvature=0;
      for(let j=0;j<size;j++){const value=fixed[j]?0:ap[j]+mScale*md[j]*p[j];ap[j]=value;curvature+=p[j]*value;}
      if(!(curvature>0)||!Number.isFinite(curvature)){if(iterations===0)x.set(z.subarray(0,size));return -iterations-1;}
      const step=rz/curvature;let next=0;rr=0;
      for(let j=0;j<size;j++){x[j]+=step*p[j];const rj=r[j]-step*ap[j],zj=rj/pd[j];r[j]=rj;z[j]=zj;next+=rj*zj;rr+=rj*rj;}
      const ratio=next/rz;rz=next;iterations++;
      for(let j=0;j<size;j++)p[j]=z[j]+ratio*p[j];
    }
    return iterations;
  }
  /** Newton's method with a line search on the incremental potential, from the current displacements. Damage histories are frozen. */
  private minimise():void {
    const st=this.stats,u=this.f.u,size=3*this.nodes,mScale=this.cm+this.cd*this.massDamping,linear=this.inserted.length===0,pd=this.f.pd,kd=this.f.kd;
    for(let j=0;j<size;j++)pd[j]=kd[j]+mScale*this.f.md[j];
    for(const f of this.inserted){
      const k=this.fStrength[f]*this.fStrength[f]/(2*this.law.initialOpeningRatio*this.fToughness[f])*this.fArea[f]/3;
      for(let i=0;i<3;i++){const a=3*this.tets[4*this.fA[f]+this.fLocal[6*f+i]],b=3*this.tets[4*this.fB[f]+this.fLocal[6*f+3+i]];if(a!==b)for(let c=0;c<3;c++){pd[a+c]+=k;pd[b+c]+=k;}}
    }
    for(let j=0;j<size;j++)if(!(pd[j]>0))pd[j]=1;
    st.converged=false;st.reason='iteration-limit';
    let phi=this.objective(u,this.f.g),residual=this.norm(this.f.g),reference=0;this.phiStart=this.phiEnd=phi;
    for(let iteration=0;;iteration++){
      reference=Math.max(reference,this.reference);
      const tolerance=this.forceTolerance+this.tolerance*reference;st.residual=residual;st.reference=reference;
      if(residual<=tolerance){st.converged=true;st.reason='converged';break;}
      if(iteration>=this.maxNewton)break;
      st.newtonIterations++;
      const inner=this.conjugateGradient(mScale,this.f.g,linear?.1*tolerance:Math.max(.1*tolerance,Math.min(.1,Math.sqrt(residual/reference))*residual));
      st.linearIterations+=Math.abs(inner);
      if(inner<0&&linear){st.reason='singular-or-indefinite';break;}
      const x=this.f.x,g=this.f.g,trial=this.f.trial;let slope=0,largest=0;for(let j=0;j<size;j++)slope+=g[j]*x[j];
      if(!(slope<0)){st.reason='singular-or-indefinite';break;}
      let accepted=false,trialPhi=0,trialResidual=0;
      for(let search=0,t=1;search<(linear?1:48);search++,t*=.5){
        for(let j=0;j<size;j++)trial[j]=u[j]+t*x[j];
        trialPhi=this.objective(trial,this.f.gTrial);trialResidual=this.norm(this.f.gTrial);
        if(linear||trialPhi<=phi+1e-4*t*slope||(trialResidual<residual&&Math.abs(trialPhi-phi)<=1e-10*Math.max(Math.abs(phi),Math.abs(trialPhi))+1e-14*this.mu*this.referenceVolume)){accepted=true;break;}
      }
      if(!accepted){
        // The last trial left its tangent data behind: restore that of the accepted state.
        this.objective(u,this.f.g);st.reason='line-search';break;
      }
      if(!Number.isFinite(trialPhi)||!Number.isFinite(trialResidual))throw new EngineError('NUMERICAL_FAILURE','The fracture solve produced a nonfinite state.');
      u.set(trial.subarray(0,size));const swap=this.f.g;this.f.g=this.f.gTrial;this.f.gTrial=swap;phi=trialPhi;residual=trialResidual;this.phiEnd=phi;
      for(let j=0;j<size;j++){const value=Math.abs(u[j]);if(value>largest)largest=value;}
      // A piece with nothing to hold it runs away under load: stop instead of following it.
      if(largest>100*this.extent){st.reason='diverged';break;}
    }
  }
  /** Equilibrium for the current loads: a frozen-damage solve, repeated while the crack band's damage grows. */
  private equilibrate():void {
    const st=this.stats;
    for(;;){
      this.minimise();
      if(this.model!=='crack-band'||!st.converged)break;
      st.damageIterations++;
      if(!this.updateBand(this.f.u)||st.damageIterations>=this.maxDamage)break;
    }
  }
  /** Raises the history and the damage of every element from the strain at u. Returns true when a damage value grew by more than 1e-9. */
  private updateBand(u:Float64Array):boolean {
    const E=this.material.youngModulus,X=this.f.X,S=this.S,p=this.principal,n=this.direction;let grew=false;
    for(let e=0;e<this.tetCount;e++){
      if(!this.tetActive[e]||this.omega[e]>=1)continue;
      this.strain(e,u,this.theta[e]);this.hooke();symmetricEigenvalues(S,0,p,0);
      const equivalent=p[0]/E,onset=this.eStrength[e]/E;
      if(!(equivalent>this.kappa[e])||equivalent<=onset)continue;
      if(this.band[e]===0){
        // Band width: the extent of the element along the largest principal stress when it first softens.
        eigenvector(S,p[0],n);let lo=Infinity,hi=-Infinity;
        for(let q=0;q<4;q++){const a=3*this.tets[4*e+q],s=X[a]*n[0]+X[a+1]*n[1]+X[a+2]*n[2];lo=Math.min(lo,s);hi=Math.max(hi,s);}
        this.band[e]=hi-lo;
      }
      this.kappa[e]=equivalent;
      let end=this.law.regularisation==='crack-band'?2*this.eToughness[e]/(this.eStrength[e]*this.band[e]):this.law.failureStrain;
      // An element wider than 2 E G_c / f_t^2 cannot soften stably: it drops at once and dissipates more than G_c.
      if(!(end>onset*(1+1e-9))){end=onset*(1+1e-9);if(this.omega[e]===0)this.clamped++;}
      const damage=equivalent>=end?1:1-onset/equivalent*(end-equivalent)/(end-onset);
      if(damage>this.omega[e]+1e-9)grew=true;
      if(damage>this.omega[e]){this.omega[e]=damage;this.valuesStale=true;}
    }
    return grew;
  }
  /** Books the energy the elements dissipated since the last call (trapezoid in the undamaged energy density) and reports failed elements. */
  private settleBand(u:Float64Array):void {
    for(let e=0;e<this.tetCount;e++){
      if(!this.tetActive[e])continue;
      this.strain(e,u,this.theta[e]);const psi=this.hooke(),grown=this.omega[e]-this.omegaOld[e];
      if(grown>0){const spent=.5*(psi+this.psiOld[e])*grown*this.elementVolume[e];this.eDissipated[e]+=spent;this.bulkDissipated+=spent;}
      this.psiOld[e]=psi;this.omegaOld[e]=this.omega[e];
      if(this.omega[e]>=1&&!this.eFailed[e]){this.eFailed[e]=1;this.events.push({time:this.time,step:this.solves,kind:'element-failed',face:-1,element:e,mode:'I',modeMix:1,energy:this.eDissipated[e],area:this.elementVolume[e]/this.band[e]});}
    }
  }
  /** Raises the interface histories to the openings at u and reports the faces that lost all traction. */
  private settleInterfaces(u:Float64Array):void {
    const t=this.tets,L=this.fLocal,N=this.fNormal,beta2=this.law.shearWeight*this.law.shearWeight;
    for(const f of this.inserted){
      if(this.fState[f]!==1)continue;
      const A=this.fA[f],B=this.fB[f],dc=2*this.fToughness[f]/this.fStrength[f],nx=N[3*f],ny=N[3*f+1],nz=N[3*f+2];let open=0,normalShare=0;
      for(let i=0;i<3;i++){
        const a=3*t[4*A+L[6*f+i]],b=3*t[4*B+L[6*f+3+i]];if(a===b)continue;
        const dx=u[b]-u[a],dy=u[b+1]-u[a+1],dz=u[b+2]-u[a+2],dn=dx*nx+dy*ny+dz*nz,up=dn>0?dn:0,eff2=up*up+beta2*(dx*dx+dy*dy+dz*dz-dn*dn),eff=Math.sqrt(Math.max(eff2,0));
        if(eff>this.hist[3*f+i]){this.hist[3*f+i]=eff;this.mix[f]=eff2>0?up*up/eff2:1;}
        if(this.hist[3*f+i]>=dc){open++;normalShare+=this.mix[f];}
      }
      if(open===3){
        const share=normalShare/3;this.fState[f]=2;
        this.events.push({time:this.time,step:this.solves,kind:'opened',face:f,element:-1,mode:share>.9?'I':share<.1?'II':'mixed',modeMix:share,energy:this.fToughness[f]*this.fArea[f],area:this.fArea[f]});
      }
    }
  }
  /** Inserts an interface on every face whose effective traction, from the mean stress of its two
   * elements, has reached the face's strength. Faces are taken in index order. Returns how many. */
  private insertOnDemand(u:Float64Array):number {
    if(this.model!=='cohesive'||this.law.insertion!=='on-demand')return 0;
    const stress=this.stresses(undefined,u),N=this.fNormal,threshold=this.law.insertionThreshold*this.law.insertionThreshold,beta2=this.law.shearWeight*this.law.shearWeight,list:number[]=[],mixes:number[]=[];
    for(let f=0;f<this.interiorFaceCount;f++){
      if(this.fState[f]!==0)continue;
      const A=6*this.fA[f],B=6*this.fB[f];if(!this.tetActive[this.fA[f]]||!this.tetActive[this.fB[f]])continue;
      const nx=N[3*f],ny=N[3*f+1],nz=N[3*f+2],xx=.5*(stress[A]+stress[B]),yy=.5*(stress[A+1]+stress[B+1]),zz=.5*(stress[A+2]+stress[B+2]),yz=.5*(stress[A+3]+stress[B+3]),xz=.5*(stress[A+4]+stress[B+4]),xy=.5*(stress[A+5]+stress[B+5]);
      const tx=xx*nx+xy*ny+xz*nz,ty=xy*nx+yy*ny+yz*nz,tz=xz*nx+yz*ny+zz*nz,tn=tx*nx+ty*ny+tz*nz,pull=tn>0?tn:0,shear2=Math.max(tx*tx+ty*ty+tz*tz-tn*tn,0),eff2=pull*pull+shear2/beta2;
      if(eff2>=threshold*this.fStrength[f]*this.fStrength[f]){list.push(f);mixes.push(pull*pull/eff2);}
    }
    for(let i=0;i<list.length;i++){const share=mixes[i];this.events.push({time:this.time,step:this.solves,kind:'initiated',face:list[i],element:-1,mode:share>.9?'I':share<.1?'II':'mixed',modeMix:share,energy:0,area:this.fArea[list[i]]});}
    return this.insert(list,1);
  }
  private applyConstraints():void {const {u,v,prescribed}=this.f;for(let j=0,size=3*this.nodes;j<size;j++)if(this.fixed[j]){u[j]=prescribed[j];v[j]=0;}}
  private resetStats():void {const st=this.stats;st.newtonIterations=0;st.linearIterations=0;st.sweeps=0;st.insertedFaces=0;st.damageIterations=0;}

  /** Static equilibrium under the current constraints, loads and temperature, as ONE increment from
   * the current state: damage is irreversible, so the load path matters and the caller steps it
   * (change the prescribed displacements or loads a little, call again). The state is left at rest.
   * `predictor` scales the free displacements before the solve, a good start under proportional loading. */
  solveStatic(options:{predictor?:number}={}):FractureSolveStats&{displacements:Float64Array;reactions:Float64Array} {
    const o=record(options,'static options');onlyKeys(o,['predictor'],'static options');
    const predictor=o.predictor===undefined?1:finite(o.predictor,'predictor',0,1e6),{u,u0,v,fext}=this.f;
    v.fill(0);this.cm=0;this.cd=0;this.referenceInertia=0;this.accelerationValid=false;this.resetStats();
    u0.set(u.subarray(0,3*this.nodes));
    this.assembleLoads(this.f.nodalForce,this.bLoad,fext);
    if(predictor!==1)for(let j=0,size=3*this.nodes;j<size;j++)u[j]*=predictor;
    this.applyConstraints();
    for(;;){
      this.equilibrate();
      const size=3*this.nodes,now=this.f.u,start=this.f.u0,load=this.f.fext;
      if(this.stats.sweeps===0){
        // External work by the trapezoid rule: reactions on the prescribed components, loads on the free ones.
        const old=this.f.work,next=this.f.fint,before=this.f.target;
        this.internal(start,old);this.internal(now,next);this.assembleLoads(this.f.nodalForcePrev,this.bLoadPrev,before);
        for(let j=0;j<size;j++){const du=now[j]-start[j];if(du!==0)this.work+=.5*(this.fixed[j]?old[j]+next[j]:before[j]+load[j])*du;}
      }else{
        // After an insertion the loads have not changed, so the drop of the potential is energy the new
        // interfaces let go without any work being done on them: it is booked as `relaxation`.
        this.relaxed+=this.phiStart-this.phiEnd;
        for(let j=0;j<size;j++)if(!this.fixed[j])this.work+=load[j]*(now[j]-start[j]);
      }
      start.set(now.subarray(0,size));
      if(!this.stats.converged||this.stats.sweeps>=this.maxSweeps)break;
      const added=this.insertOnDemand(this.f.u);if(added===0)break;
      this.stats.sweeps++;this.stats.insertedFaces+=added;
      this.assembleLoads(this.f.nodalForce,this.bLoad,this.f.fext);
    }
    const size=3*this.nodes;
    this.f.nodalForcePrev.set(this.f.nodalForce.subarray(0,size));this.bLoadPrev.set(this.bLoad);
    this.solves++;this.finish(this.f.u);
    return {...this.stats,displacements:this.f.u.slice(0,size),reactions:this.reactions()};
  }
  /** After a converged increment: histories, events, dissipation. */
  private finish(u:Float64Array):void {
    this.settleInterfaces(u);
    if(this.model==='crack-band'){this.updateBand(u);this.settleBand(u);}
  }

  /** Advances `count` time steps. Backward Euler and midpoint solve each step as in solid.ts, with the
   * damage history frozen during the solve; the explicit scheme is velocity Verlet. Interfaces are
   * inserted at the end of a step, so a new interface starts with no opening and no jump in force. */
  step(count=1):void {
    const steps=integer(count,'count',0,1_000_000),h=this.dt;
    for(let s=0;s<steps;s++){
      const {u,v,fext}=this.f,size=3*this.nodes;
      this.assembleLoads(this.f.nodalForce,this.bLoad,fext);this.applyConstraints();this.resetStats();
      const u0=this.f.u0;u0.set(u.subarray(0,size));
      let lost=0;
      if(this.integrator==='explicit'){
        if(h>this.explicitSafety*this.explicitLimit())throw new EngineError('UNSTABLE_TIME_STEP',`Explicit time step ${h} s exceeds ${this.explicitSafety} of the stability limit ${this.explicitLimit()} s.`);
        const a=this.f.a;if(!this.accelerationValid){this.accelerate();this.accelerationValid=true;}
        for(let j=0;j<size;j++)if(!this.fixed[j]){v[j]+=.5*h*a[j];u[j]+=h*v[j];}
        if(this.massDamping>0)for(let j=0;j<size;j++)lost+=this.massDamping*this.f.md[j]*v[j]*v[j]*h;
        this.accelerate();
        for(let j=0;j<size;j++)if(!this.fixed[j])v[j]+=.5*h*a[j];
      }else{
        const tau=this.integrator==='midpoint'?.5*h:h,target=this.f.target;let inertia=0;
        this.cm=1/(tau*tau);this.cd=this.massDamping>0?1/tau:0;
        for(let j=0;j<size;j++){target[j]=u[j]+tau*v[j];const mv=this.cm*this.f.md[j]*tau*v[j];inertia+=mv*mv;}
        this.referenceInertia=Math.sqrt(inertia);
        this.equilibrate();if(!this.stats.converged)this.unconverged++;
        if(this.integrator==='midpoint')for(let j=0;j<size;j++){const mid=(u[j]-u0[j])/tau;if(this.massDamping>0)lost+=this.massDamping*this.f.md[j]*mid*mid*h;u[j]=2*u[j]-u0[j];v[j]=2*mid-v[j];}
        else for(let j=0;j<size;j++){v[j]=(u[j]-u0[j])/h;if(this.massDamping>0)lost+=this.massDamping*this.f.md[j]*v[j]*v[j]*h;}
      }
      for(let j=0;j<size;j++){
        if(!Number.isFinite(u[j])||!Number.isFinite(v[j]))throw new EngineError('NUMERICAL_FAILURE','The fracture step produced a nonfinite state.');
        if(!this.fixed[j])this.work+=fext[j]*(u[j]-u0[j]);
      }
      this.dampingLoss+=lost;this.steps++;this.solves++;
      this.finish(u);
      const added=this.insertOnDemand(u);
      if(added>0){this.stats.sweeps=1;this.stats.insertedFaces=added;}
    }
  }
  /** a = M^-1 (f_ext - f_int(u)) - massDamping v on the free components. */
  private accelerate():void {
    const {a,fint,fext,u,v}=this.f,size=3*this.nodes;this.internal(u,fint);
    for(let j=0;j<size;j++)a[j]=this.fixed[j]?0:(fext[j]-fint[j])/this.f.md[j]-this.massDamping*v[j];
  }
  /** Largest stable explicit time step, s, valid for any crack pattern: 2 / omega_max with
   * omega_max^2 bounded by the stiffest single element with its own lumped mass (as in solid.ts) plus,
   * for the cohesive model, a Gershgorin bound on the interface springs with every face inserted. */
  explicitLimit():number {
    if(this.limit!==null)return this.limit;
    const x=new Float64Array(12),y=new Float64Array(12),g=this.grad,S=this.S,rho=this.material.density;let bulk=0,springs=0;
    for(let e=0;e<this.tetCount;e++){
      const o=12*e,V=this.elementVolume[e];let value=0;
      for(let k=0;k<12;k++)x[k]=Math.sin(1+2.3*k);
      for(let iteration=0;iteration<60;iteration++){
        let xx=0,yy=0,zz=0,yz=0,xz=0,xy=0;
        for(let q=0;q<4;q++){const gx=g[o+3*q],gy=g[o+3*q+1],gz=g[o+3*q+2],ux=x[3*q],uy=x[3*q+1],uz=x[3*q+2];xx+=ux*gx;yy+=uy*gy;zz+=uz*gz;yz+=uy*gz+uz*gy;xz+=ux*gz+uz*gx;xy+=ux*gy+uy*gx;}
        S[0]=xx;S[1]=yy;S[2]=zz;S[3]=.5*yz;S[4]=.5*xz;S[5]=.5*xy;this.hooke();
        let dot=0,xNorm=0,yNorm=0;
        for(let q=0;q<4;q++){
          const gx=V*g[o+3*q],gy=V*g[o+3*q+1],gz=V*g[o+3*q+2];
          y[3*q]=S[0]*gx+S[5]*gy+S[4]*gz;y[3*q+1]=S[5]*gx+S[1]*gy+S[3]*gz;y[3*q+2]=S[4]*gx+S[3]*gy+S[2]*gz;
        }
        for(let k=0;k<12;k++){dot+=x[k]*y[k];xNorm+=x[k]*x[k];yNorm+=y[k]*y[k];}
        value=dot/xNorm;const scale=1/Math.sqrt(yNorm);for(let k=0;k<12;k++)x[k]=y[k]*scale;
      }
      bulk=Math.max(bulk,1.01*value*4/(rho*V));
      if(this.model==='cohesive')for(let q=0;q<4;q++){
        // A fully separated corner of this element has mass rho V / 4 and a spring from each of its three faces.
        let sum=0;
        for(let skip=0;skip<4;skip++){
          const f=this.tetFace[4*e+skip];if(skip===q||f<0)continue;
          sum+=Math.max(1,this.law.shearWeight*this.law.shearWeight)*this.fStrength[f]*this.fStrength[f]/(2*this.law.initialOpeningRatio*this.fToughness[f])*this.fArea[f]/3;
        }
        springs=Math.max(springs,2*sum*4/(rho*V));
      }
    }
    const omega=Math.sqrt(bulk+springs),xi=.5*this.massDamping/omega;
    return this.limit=2/omega*(Math.sqrt(1+xi*xi)-xi);
  }

  // ---- Outputs ----

  /** Elastic strain energy of the elements, J. */
  strainEnergy():number {return this.bulk(this.f.u,null);}
  /** Recoverable energy in the interfaces, J: the damaged springs and the contact penalty. */
  interfaceEnergy():number {return this.cohesive(this.f.u,null,false,true);}
  kineticEnergy():number {let s=0;for(let j=0,size=3*this.nodes;j<size;j++)s+=this.f.md[j]*this.f.v[j]*this.f.v[j];return .5*s;}
  /** Energy dissipated by fracture, J. Interfaces: the area under the traction law up to the largest
   * opening reached, minus what unloading returns: w (sigma_c kappa - T(kappa) delta_0) / 2 per point,
   * G_c per unit area at full separation. Elements: the running sum of psi_0 d(omega). */
  dissipatedEnergy():number {
    const ratio=this.law.initialOpeningRatio;let total=this.bulkDissipated;
    for(const f of this.inserted){
      if(this.fState[f]===3)continue;
      const sc=this.fStrength[f],dc=2*this.fToughness[f]/sc,d0=ratio*dc,w=this.fArea[f]/3;
      for(let i=0;i<3;i++){const k=this.hist[3*f+i];total+=w*(k>=dc?.5*sc*dc:.5*(sc*k-this.envelope(sc,d0,dc,k)*d0));}
    }
    return total;
  }
  /** The energy ledger. It covers mechanical loading; a change of temperature does work that it does not book. */
  energy():FractureEnergy {
    const strain=this.strainEnergy(),stored=this.interfaceEnergy(),kinetic=this.kineticEnergy(),dissipated=this.dissipatedEnergy();
    return {strain,interface:stored,kinetic,dissipated,damping:this.dampingLoss,relaxation:this.relaxed,externalWork:this.work,balance:this.work-(strain+stored+kinetic+dissipated+this.dampingLoss+this.relaxed)};
  }
  /** Forces the constraints put on the body, N: internal minus external force on each constrained component. */
  reactions(out=new Float64Array(3*this.nodes)):Float64Array {
    const {work,fext}=this.f;this.internal(this.f.u,work);this.assembleLoads(this.f.nodalForce,this.bLoad,fext);
    for(let j=0;j<out.length;j++)out[j]=this.fixed[j]&&this.nodeActive[(j-j%3)/3]?zero(work[j]-fext[j]):0;
    return out;
  }
  /** Stress per element, Pa, as [xx, yy, zz, yz, xz, xy], with the crack band's damage applied. */
  stresses(out=new Float64Array(6*this.tetCount),u:Float64Array=this.f.u):Float64Array {
    for(let e=0;e<this.tetCount;e++){
      if(!this.tetActive[e]){out.fill(0,6*e,6*e+6);continue;}
      this.strain(e,u,this.theta[e]);this.hooke();const scale=this.model==='crack-band'?1-this.omega[e]:1;
      for(let k=0;k<6;k++)out[6*e+k]=scale*this.S[k];
    }
    return out;
  }
  /** Damage of each element (crack band), 0 to 1. */
  get elementDamage():Float64Array {return this.omega;}
  /** Opening and damage at the three node pairs of an interface: normal opening (negative when
   * pressed together), sliding, effective opening, the largest effective opening so far, and damage. */
  interfaceState(face:number):{inserted:boolean;normal:number[];sliding:number[];effective:number[];history:number[];damage:number[];criticalOpening:number;peakOpening:number} {
    const f=integer(face,'face',0,this.interiorFaceCount-1),sc=this.fStrength[f],dc=2*this.fToughness[f]/sc,d0=this.law.initialOpeningRatio*dc,u=this.f.u,beta=this.law.shearWeight;
    const normal:number[]=[],sliding:number[]=[],effective:number[]=[],history:number[]=[],damage:number[]=[];
    for(let i=0;i<3;i++){
      const a=3*this.tets[4*this.fA[f]+this.fLocal[6*f+i]],b=3*this.tets[4*this.fB[f]+this.fLocal[6*f+3+i]],dx=u[b]-u[a],dy=u[b+1]-u[a+1],dz=u[b+2]-u[a+2],dn=dx*this.fNormal[3*f]+dy*this.fNormal[3*f+1]+dz*this.fNormal[3*f+2],ds=Math.sqrt(Math.max(dx*dx+dy*dy+dz*dz-dn*dn,0)),k=this.fState[f]===0?0:this.hist[3*f+i];
      normal.push(dn);sliding.push(ds);effective.push(Math.hypot(Math.max(dn,0),beta*ds));history.push(k);
      // Damage d of the secant stiffness (1 - d) sigma_c / delta_0.
      damage.push(this.fState[f]===0?0:k>=dc?1:1-this.envelope(sc,d0,dc,k)*d0/(sc*k));
    }
    return {inserted:this.fState[f]!==0,normal,sliding,effective,history,damage,criticalOpening:dc,peakOpening:d0};
  }
  /** Area of the interfaces, m^2: `open` counts the node pairs that lost all traction, `cohesive` those
   * that still carry some, `precrack` the cuts made by `precrack`. A third of a face per node pair. */
  crackArea():{open:number;cohesive:number;precrack:number} {
    let open=0,cohesive=0,precrack=0;
    for(const f of this.inserted){
      const dc=2*this.fToughness[f]/this.fStrength[f],w=this.fArea[f]/3;
      for(let i=0;i<3;i++){if(this.fState[f]===3)precrack+=w;else if(this.hist[3*f+i]>=dc)open+=w;else cohesive+=w;}
    }
    return {open,cohesive,precrack};
  }
  /** Interior faces that have an interface, in the order they got it. */
  get interfaces():Uint32Array {return Uint32Array.from(this.inserted);}
  /** Crack events since the last call, oldest first. */
  takeEvents():CrackEvent[] {const out=this.events;this.events=[];return out;}
  /** Total linear momentum and angular momentum about the origin of the pieces still simulated here, and what was handed off. */
  momentum():{linear:[number,number,number];angular:[number,number,number];mass:number;handedOffMass:number;handedOffLinear:[number,number,number]} {
    const {X,u,v}=this.f,p:[number,number,number]=[0,0,0],l:[number,number,number]=[0,0,0];let mass=0;
    for(let n=0;n<this.nodes;n++){
      if(!this.nodeActive[n])continue;
      const m=this.nodeMass[n],x=X[3*n]+u[3*n],y=X[3*n+1]+u[3*n+1],z=X[3*n+2]+u[3*n+2],vx=v[3*n],vy=v[3*n+1],vz=v[3*n+2];
      mass+=m;p[0]+=m*vx;p[1]+=m*vy;p[2]+=m*vz;l[0]+=m*(y*vz-z*vy);l[1]+=m*(z*vx-x*vz);l[2]+=m*(x*vy-y*vx);
    }
    return {linear:p,angular:l,mass,handedOffMass:this.handedMass,handedOffLinear:[this.handedMomentum[0],this.handedMomentum[1],this.handedMomentum[2]]};
  }
  /** Crack-band elements that were too wide to soften stably and dropped at once (see docs/SOLID_FRACTURE.md). */
  get clampedElements():number {return this.clamped;}

  // ---- Fragments ----

  /** The connected pieces of the body. Two elements belong to one piece when they share a node, or an
   * interface between them still carries traction at a node pair. Pieces are ordered by their lowest
   * element; elements and nodes inside a piece are ascending. Mass, momentum and inertia use the lumped
   * nodal masses and the current positions. */
  fragments():Fragment[] {
    const parent=Int32Array.from({length:this.nodes},(_,i)=>i),t=this.tets,{X,u,v}=this.f;
    const find=(i:number)=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
    const join=(a:number,b:number)=>{a=find(a);b=find(b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);};
    for(let e=0;e<this.tetCount;e++)for(let q=1;q<4;q++)join(t[4*e],t[4*e+q]);
    for(const f of this.inserted){
      if(this.fState[f]!==1)continue;
      const dc=2*this.fToughness[f]/this.fStrength[f];
      for(let i=0;i<3;i++)if(this.hist[3*f+i]<dc)join(t[4*this.fA[f]+this.fLocal[6*f+i]],t[4*this.fB[f]+this.fLocal[6*f+3+i]]);
    }
    const slot=new Map<number,number>(),groups:{tets:number[];nodes:number[]}[]=[];
    for(let e=0;e<this.tetCount;e++){
      const root=find(t[4*e]);let at=slot.get(root);
      if(at===undefined){at=groups.length;slot.set(root,at);groups.push({tets:[],nodes:[]});}
      groups[at].tets.push(e);
    }
    for(let n=0;n<this.nodes;n++)groups[slot.get(find(n))!].nodes.push(n);
    return groups.map((group,index)=>{
      let mass=0,cx=0,cy=0,cz=0,px=0,py=0,pz=0,volume=0;
      for(const n of group.nodes){const m=this.nodeMass[n];mass+=m;cx+=m*(X[3*n]+u[3*n]);cy+=m*(X[3*n+1]+u[3*n+1]);cz+=m*(X[3*n+2]+u[3*n+2]);px+=m*v[3*n];py+=m*v[3*n+1];pz+=m*v[3*n+2];}
      cx/=mass;cy/=mass;cz/=mass;
      const l:[number,number,number]=[0,0,0],inertia:[number,number,number,number,number,number]=[0,0,0,0,0,0];
      for(const n of group.nodes){
        const m=this.nodeMass[n],x=X[3*n]+u[3*n]-cx,y=X[3*n+1]+u[3*n+1]-cy,z=X[3*n+2]+u[3*n+2]-cz,vx=v[3*n],vy=v[3*n+1],vz=v[3*n+2];
        l[0]+=m*(y*vz-z*vy);l[1]+=m*(z*vx-x*vz);l[2]+=m*(x*vy-y*vx);
        inertia[0]+=m*(y*y+z*z);inertia[1]+=m*(x*x+z*z);inertia[2]+=m*(x*x+y*y);inertia[3]-=m*y*z;inertia[4]-=m*x*z;inertia[5]-=m*x*y;
      }
      for(const e of group.tets)volume+=this.elementVolume[e];
      return {index,tets:Uint32Array.from(group.tets),nodes:Uint32Array.from(group.nodes),mass,volume,centerOfMass:[cx,cy,cz],linearMomentum:[px,py,pz],angularMomentum:l,inertia,handedOff:!this.tetActive[group.tets[0]]};
    });
  }
  /** A rigid-body description of a fragment: the convex hull of its nodes about its centre of mass, its
   * mass (as a density for the hull's volume), and the velocity and spin that carry its linear and
   * angular momentum. The hull of a piece that is not convex is larger than the piece, and its centre is
   * not exactly the piece's centre of mass. The body is not changed: see `handOff`. */
  fragmentRigidBody(fragment:Fragment,options:{maxPoints?:number}={}):FragmentRigidBody {
    const o=record(options,'hand-off options');onlyKeys(o,['maxPoints'],'hand-off options');
    const {X,u}=this.f,c=fragment.centerOfMass,points=new Float64Array(3*fragment.nodes.length);
    for(let i=0;i<fragment.nodes.length;i++){const n=fragment.nodes[i];for(let k=0;k<3;k++)points[3*i+k]=X[3*n+k]+u[3*n+k]-c[k];}
    const shape=toHullShape(points,o.maxPoints===undefined?{}:{maxPoints:integer(o.maxPoints,'maxPoints',4,64)}),hullVolume=meshVolume(convexHull(shape.points));
    const m=fragment.mass,p=fragment.linearMomentum,velocity:[number,number,number]=[p[0]/m,p[1]/m,p[2]/m],density=m/hullVolume;
    // Spin from I w = L, by Cramer's rule; zero when the lumped masses have no inertia about some axis.
    const [ixx,iyy,izz,iyz,ixz,ixy]=fragment.inertia,l=fragment.angularMomentum;
    const c0=iyy*izz-iyz*iyz,c1=ixz*iyz-ixy*izz,c2=ixy*iyz-ixz*iyy,det=ixx*c0+ixy*c1+ixz*c2,scale=Math.abs(ixx*iyy*izz);
    const spin:[number,number,number]=Math.abs(det)>1e-12*scale&&scale>0?[(c0*l[0]+c1*l[1]+c2*l[2])/det,(c1*l[0]+(ixx*izz-ixz*ixz)*l[1]+(ixy*ixz-ixx*iyz)*l[2])/det,(c2*l[0]+(ixy*ixz-ixx*iyz)*l[1]+(ixx*iyy-ixy*ixy)*l[2])/det]:[0,0,0];
    return {shape,position:[c[0],c[1],c[2]],linearVelocity:velocity,angularVelocity:spin,density,mass:m,hullVolume,linearMomentum:[density*hullVolume*velocity[0],density*hullVolume*velocity[1],density*hullVolume*velocity[2]],type:'dynamic'};
  }
  /** ONE-WAY hand-off of a fragment to a rigid world: returns its rigid-body description and stops
   * simulating it here. Its elements carry no stress from now on, its nodes are frozen, and its mass
   * and momentum leave `momentum()` and the kinetic energy (the ledger books that as external work).
   * Nothing comes back: the rigid body does not act on what is left of this body. */
  handOff(fragment:Fragment,options:{maxPoints?:number}={}):FragmentRigidBody {
    if(!fragment||!(fragment.tets instanceof Uint32Array)||fragment.tets.length===0)throw payload('handOff needs a fragment from fragments().');
    for(const e of fragment.tets)if(!(e<this.tetCount)||!this.tetActive[e])throw new EngineError('INVALID_STATE','The fragment is stale or was already handed off.');
    const body=this.fragmentRigidBody(fragment,options),before=this.strainEnergy()+this.interfaceEnergy()+this.kineticEnergy();
    for(const e of fragment.tets)this.tetActive[e]=0;
    this.valuesStale=true;
    for(const n of fragment.nodes){this.nodeActive[n]=0;for(let k=0;k<3;k++){this.fixed[3*n+k]=1;this.f.prescribed[3*n+k]=this.f.u[3*n+k];this.f.v[3*n+k]=0;this.f.nodalForce[3*n+k]=0;}}
    this.handedMass+=fragment.mass;for(let k=0;k<3;k++)this.handedMomentum[k]+=fragment.linearMomentum[k];
    this.work+=this.strainEnergy()+this.interfaceEnergy()+this.kineticEnergy()-before;this.accelerationValid=false;
    return body;
  }
}

/** The stage order of solids in a Simulation (`SUBSYSTEM_ORDER.solid` of simulation.ts). */
export const FRACTURE_SUBSYSTEM_ORDER=300;

/** A fracturing solid in the shared stepping loop. Post stage, where `solidSubsystem` runs, after heat
 * and the links, so `thermalSolidLink(heat, body, ...)` drives its thermal strain. Requirement: the
 * body's dt is the simulation step, a whole fraction of it or a whole multiple of it; an explicit body
 * must be within `explicitLimit()`. Crack events of a step are emitted in the events stage with the
 * type 'crack' (data: a `CrackEvent`). Energy: kinetic + strain + interface, with minus the dissipated
 * and damped energy as `exchanged`, so `total - exchanged` stays constant when no load does work. */
export function fractureSubsystem<W=unknown,B=unknown>(body:FractureBody,options:{readonly id?:string}={}):Subsystem<W,B> {
  const id=options.id??'fracture';
  return {
    id,kind:'solid-fracture',stage:'post',order:FRACTURE_SUBSYSTEM_ORDER,timeStep:{dt:body.dt,rule:'commensurate'},
    validate(){
      if(body.integrator!=='explicit')return;
      const limit=body.explicitLimit();
      if(body.dt>limit)throw new EngineError('UNSTABLE_TIME_STEP',`Subsystem "${id}" (solid-fracture): the explicit step ${body.dt} s is above the stability limit ${limit} s. Give the body a smaller dt (a whole fraction of the simulation step) or use an implicit integrator.`);
    },
    step(ctx){body.step(ctx.substeps);},
    finish(ctx){for(const event of body.takeEvents())ctx.emit('crack',event);},
    energy(){const e=body.energy();return {domain:'mechanical',total:e.strain+e.interface+e.kinetic,exchanged:e.externalWork-e.dissipated-e.damping-e.relaxation,parts:{kinetic:e.kinetic,strain:e.strain,interface:e.interface,dissipated:e.dissipated,damping:e.damping,relaxation:e.relaxation,externalWork:e.externalWork}};},
    diagnostics(){const area=body.crackArea();return {solver:body.solver,model:body.model,integrator:body.integrator,time:body.time,nodes:body.nodeCount,interfaces:body.interfaces.length,crackArea:area.open,unconvergedSteps:body.unconvergedSteps,...body.stats};},
  };
}

export interface QuenchedPlateOptions {
  /** Cells through the depth (x, from the cooled face), along the face (y) and across the thin direction (z). Default [12, 8, 1]. */
  cells?:readonly [number,number,number];
  /** Cell edge in metres. Default 0.25e-3. */
  cellSize?:number;
  /** Uniform start temperature, which is also the stress-free temperature, K. Default 600. */
  initialTemperature?:number;
  /** Coolant temperature, K. Default 300. */
  ambient?:number;
  /** Film coefficient on the cooled face, W/(m^2 K). Default 5000. */
  coefficient?:number;
  /** Time step of the heat solver and of the solid, s. Default 2e-3. */
  dt?:number;
}
export interface QuenchedPlate {
  heat:HeatSolver;body:FractureBody;
  /** The stress-free temperature for `thermalSolidLink`, K. */
  reference:number;
  cells:[number,number,number];cellSize:number;
  /** Options for `thermalShock(heat.temperature, shock)`: the heat module's estimate for the same plate. */
  shock:ThermalShockOptions;
  /** Surface temperature drop at which the restrained surface stress E alpha dT / (1 - nu) equals the strength, K. */
  criticalDrop:number;
}

/** The thermal-shock example: a hot ceramic plate (alumina-like: E = 370 GPa, nu = 0.22, alpha_T = 8e-6 /K,
 * k = 30 W/(m K), rho = 3900 kg/m^3, c = 880 J/(kg K), strength 300 MPa, G_c = 40 J/m^2) whose face x = 0 is
 * suddenly cooled by a film coefficient. The strip modelled is held in its plane (rollers on the y and z
 * faces) and free through its depth, so a cooled layer carries the biaxial tension E alpha dT / (1 - nu).
 * Register `heatSubsystem(heat)`, `thermalSolidLink(heat, body, {reference})` and `fractureSubsystem(body)`
 * with a Simulation whose step is `dt`; the heat solver's temperature then cracks the solid. One-way: the
 * cracks do not change the heat flow. The elements are larger than E G_c / sigma_c^2 (0.16 mm), so the
 * onset of cracking is meaningful and the crack pattern after it is not resolved. */
export function quenchedPlate(options:QuenchedPlateOptions={}):QuenchedPlate {
  const o=record(options,'quenched plate');onlyKeys(o,['cells','cellSize','initialTemperature','ambient','coefficient','dt'],'quenched plate');
  const cells=(o.cells===undefined?[12,8,1]:Array.from(o.cells as ArrayLike<number>,(v,i)=>integer(v,`cells[${i}]`,1,256))) as [number,number,number];
  if(cells.length!==3)throw payload('cells needs three counts.');
  const h=o.cellSize===undefined?.25e-3:finite(o.cellSize,'cellSize',1e-6,1),hot=o.initialTemperature===undefined?600:finite(o.initialTemperature,'initialTemperature',1,5000),ambient=o.ambient===undefined?300:finite(o.ambient,'ambient',1,5000);
  const coefficient=o.coefficient===undefined?5000:finite(o.coefficient,'coefficient',1e-3,1e9),dt=o.dt===undefined?2e-3:finite(o.dt,'dt',1e-9,10);
  const E=370e9,nu=.22,alpha=8e-6,strength=300e6,toughness=40,size:[number,number,number]=[cells[0]*h,cells[1]*h,cells[2]*h];
  const heat=new HeatSolver({nx:cells[0],ny:cells[1],nz:cells[2],dx:h,dy:h,dz:h,materials:[{conductivity:30,density:3900,specificHeat:880}],temperature:hot,dt,boundaries:[{face:'x-',type:'convection',coefficient,ambient}]});
  const body=new FractureBody({mesh:boxMesh({size,cells}),material:{youngModulus:E,poissonRatio:nu,density:3900,thermalExpansion:alpha},fracture:{model:'cohesive',strength,toughness},config:{dt,integrator:'backward-euler',tolerance:1e-9}});
  const close=(a:number,b:number)=>Math.abs(a-b)<1e-6*h;
  body.constrain(body.selectNodes(x=>close(x,size[0])),[0,null,null]);
  body.constrain(body.selectNodes((x,y)=>close(y,0)||close(y,size[1])),[null,0,null]);
  body.constrain(body.selectNodes((x,y,z)=>close(z,0)||close(z,size[2])),[null,null,0]);
  return {heat,body,reference:hot,cells,cellSize:h,shock:{expansion:alpha,youngsModulus:E,poissonRatio:nu,reference:hot,constraint:'plate',tensileStrength:strength},criticalDrop:strength*(1-nu)/(E*alpha)};
}
