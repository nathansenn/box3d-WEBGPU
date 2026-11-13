import {EngineError,finite,integer,onlyKeys,record} from './contracts.ts';
import {captureFields,restoreFields,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';
import {boundaryFaces,tetVolume,SOLID_MAX_NODES,SOLID_MAX_TETS,type TetMesh} from './solid-mesh.ts';
import {buildConcreteLaw,ConcreteReturn,concreteDamage,tableValue,type ConcreteLaw,type ConcreteLawInput} from './concrete-law.ts';
import {SparseLDL} from './sparse-ldl.ts';
export {buildConcreteLaw,ec2CompressionStress,type ConcreteLaw,type ConcreteLawInput} from './concrete-law.ts';
export {boxMesh,boxNode,boundaryFaces,tetVolume,SOLID_MAX_NODES,SOLID_MAX_TETS,type TetMesh,type BoxMeshOptions} from './solid-mesh.ts';

export const SOLID_SOLVER_ID='solid-tet-corot-js-f64-v1';
/** Solver id of a body with a yield stress: J2 plasticity on the same element. */
export const SOLID_PLASTIC_SOLVER_ID='solid-tet-j2-js-f64-v1';
/** Solver id of a body with a concrete law: Drucker-Prager and Rankine composite plasticity with crack-band softening. */
export const SOLID_CONCRETE_SOLVER_ID='solid-tet-dp-rankine-js-f64-v1';
/** `linear`: small-strain Hooke. `corotational`: Hooke on the stretch left after removing each
 * element's rotation. `neo-hookean`: compressible Neo-Hookean rubber. `green-lagrange`: Hooke on the
 * Green-Lagrange strain (St Venant-Kirchhoff): exact under rotation, for small elastic strain; the model
 * that carries J2 plasticity through large rotations. */
export type SolidModel='linear'|'corotational'|'neo-hookean'|'green-lagrange';
export type SolidIntegrator='backward-euler'|'midpoint'|'explicit';
/** `tet4`: the four-node tetrahedron, everything per element (locks when the material is nearly incompressible, elastically or
 * plastically). `tet4-nodal`: the same nodes and shape functions with the volumetric strain averaged over the elements around each
 * node: for every law that splits into a deviatoric and a volumetric energy the volumetric energy is evaluated at the nodes from
 * the nodal volume change (averaged nodal pressure, Bonet and Burton 1998); for the pressure-dependent concrete law the element's
 * volumetric strain is replaced by the average of its nodes' (nodally averaged B-bar). See docs/SOLID_MECHANICS.md. */
export type SolidElement='tet4'|'tet4-nodal';
/** Inner solver of each Newton step: conjugate gradients preconditioned by the stiffness diagonal (`cg`), or by a sparse LDLᵀ
 * factorization of the assembled tangent (`ldl`, sparse-ldl.ts), kept across Newton iterations and steps and formed again when an
 * inner solve needed more than LDL_REFACTOR_ITERATIONS. Both multiply by the exact tangent and stop at the same tolerance; `ldl`
 * takes far fewer iterations on stiff or nearly incompressible problems. Meant for meshes of up to a few thousand nodes. */
export type SolidLinearSolver='cg'|'ldl';
export interface SolidMaterial {
  /** Young's modulus E in Pa. */
  youngModulus:number;
  /** Poisson's ratio, from -0.99 to 0.4999. Linear tetrahedra lock as it nears 0.5. */
  poissonRatio:number;
  /** Mass density in kg/m^3. */
  density:number;
  /** Linear thermal expansion coefficient in 1/K. Default 0. */
  thermalExpansion?:number;
  /** Initial yield stress sigma_y0 in Pa (von Mises, J2). Leave out for an elastic body. With it the
   * `linear` and `corotational` models become elastic-plastic: associative J2 flow, radial return. */
  yieldStress?:number;
  /** Linear isotropic hardening modulus H in Pa: the yield stress is sigma_y0 + H p, p the equivalent
   * plastic strain. The uniaxial tangent after yield is E H / (E + H). Default 0 (perfectly plastic). */
  hardeningModulus?:number;
  /** Ductile failure: an element whose equivalent plastic strain reaches this value is eroded (removed:
   * no stiffness, no stress) at the end of the step. Default Infinity (no erosion). */
  failureStrain?:number;
  /** Quasi-brittle damage-plasticity (concrete-law.ts): Drucker-Prager in compression fitted to the EN 1992-1-1 3.1.5
   * curve and Rankine in tension, both softening by the crack band; crushed and fully opened elements erode. Instead of
   * yieldStress. Linear or green-lagrange model, backward-euler or explicit integrator, not viscoelastic. */
  concrete?:ConcreteLawInput;
}
export interface SolidConfig {
  model?:SolidModel;
  /** Time step in seconds. Default 1/240. */
  dt?:number;
  integrator?:SolidIntegrator;
  /** Rayleigh damping C = massDamping * M + stiffnessDamping * K. Units 1/s and s. */
  massDamping?:number;stiffnessDamping?:number;
  /** Acceleration of gravity in m/s^2. Default (0, 0, 0). */
  gravity?:readonly [number,number,number];
  /** Relative force residual: a solve stops when the 2-norm of the unbalanced nodal forces is
   * at most `tolerance` times the largest of the internal, external and inertial force norms
   * seen during that solve, plus `forceTolerance` newtons. Defaults 1e-10 and 0. */
  tolerance?:number;forceTolerance?:number;
  maxNewtonIterations?:number;maxLinearIterations?:number;
  /** The explicit integrator refuses a time step above this fraction of its stability limit. Default 0.9. */
  explicitSafety?:number;
  /** Viscoelasticity: a Prony series on the elastic stress. The material's moduli are the long-term (relaxed) ones; branch i
   * adds `ratio` times the elastic stress, relaxing with time constant `time` (s), so in one dimension the relaxation
   * modulus is E(t) = E (1 + sum ratio_i exp(-t / time_i)). Backward Euler only. Default: none (elastic). */
  viscoelastic?:{readonly branches:readonly {readonly ratio:number;readonly time:number}[]};
  /** Element formulation. Default `tet4`. */
  element?:SolidElement;
  /** Inner linear solver of Newton's method. Default `cg`. */
  linearSolver?:SolidLinearSolver;
}
export interface SolidDefinition {mesh:TetMesh|{positions:ArrayLike<number>;tets:ArrayLike<number>};material:SolidMaterial;config?:SolidConfig}
export interface SolidSolveStats {
  converged:boolean;reason:'converged'|'iteration-limit'|'line-search'|'singular-or-indefinite';
  newtonIterations:number;linearIterations:number;
  /** 2-norm of the unbalanced force on the free degrees of freedom, N. */
  residual:number;
  /** Force norm the relative tolerance is measured against, N. */
  reference:number;
}
export interface SolidStaticResult extends SolidSolveStats {
  loadSteps:number;displacements:Float64Array;reactions:Float64Array;strainEnergy:number;
}
export interface SolidExplicitLimit {
  /** Largest stable explicit time step in seconds, damping included: 2 / omega_max times the damping factor. */
  criticalTimeStep:number;
  /** Dilatational wave speed sqrt((lambda + 2 mu) / rho) in m/s. */
  waveSpeed:number;
  /** Smallest element altitude in m. */
  minAltitude:number;
  /** waveSpeed * criticalTimeStep / minAltitude. */
  courant:number;
}
export interface SolidMode {angularFrequency:number;frequency:number;shape:Float64Array;iterations:number;converged:boolean}
export type SolidFailureCriterion='max-principal'|'von-mises';
/** What `SolidBody.kernel()` hands to a coupled solver. Arrays are the body's own, live. */
export interface SolidKernel {
  /** 1 for a constrained component. */
  readonly fixed:Uint8Array;readonly prescribed:Float64Array;
  /** Diagonal of the reference stiffness, N/m per component. */
  readonly stiffnessDiagonal:Float64Array;
  readonly massDamping:number;readonly stiffnessDamping:number;readonly tolerance:number;readonly forceTolerance:number;
  readonly maxNewtonIterations:number;readonly maxLinearIterations:number;readonly gravity:Float64Array;
  /** Assembles the dead loads (point forces, surface loads, weight) and returns them, N. */
  loads():Float64Array;
  /** Puts the prescribed values into the constrained displacement components. */
  applyConstraints():void;
  /** Strain energy of the displacement field `u`, J; fills `fint` with the internal forces. With `store`
   * the tangent at `u` is kept for `tangentProduct`. Infinity when an element is inverted. */
  energy(u:Float64Array,fint:Float64Array|null,store:boolean):number;
  /** out = K x with the tangent kept by the last `energy(..., true)` (the constant stiffness for the linear model). */
  tangentProduct(x:Float64Array,out:Float64Array):void;
  /** Keeps the tangent of the present state as the stiffness of Rayleigh damping for the coming step. */
  holdDampingTangent():void;
  dampingProduct(x:Float64Array,out:Float64Array):void;
  /** Counts one time step taken by the outside solver and commits the plastic state of the present displacements. */
  advance(converged:boolean):void;
  /** Commits the plastic state of the present displacements (a static solve by the outside solver). */
  commit():void;
  /** `ldl` when the body asks for a factorized preconditioner. */
  readonly linearSolver:SolidLinearSolver;
  /** Assembles kScale K + mScale M (K the tangent kept by the last `energy(..., true)`, M the lumped mass) into the body's sparse
   * matrix and returns it unfactored, so the caller can add its own node blocks before `factor()`. */
  assembleTangent(kScale:number,mScale:number):SparseLDL;
  /** Whether a new factorization is due before an inner solve with these scales. */
  factorDue(kScale:number,mScale:number):boolean;
  /** Reports an inner solve's iteration count (it decides when to form the factorization again). */
  innerDone(iterations:number):void;
  /** Factors what `assembleTangent` (plus the caller's blocks) assembled, and keeps it for later solves. */
  factorize(kScale:number,mScale:number):void;
  /** The kept factorization, or null. */
  factorization():SparseLDL|null;
}

const MIN_J=1e-6;
/** Per element data of the plastic tangent: flow direction n (6), 2 mu beta, 2 mu (3 mu / (3 mu + H) - beta)
 * and the plastic strain of the trial state (6). */
const PT=14;
const zero=(x:number)=>x===0?0:x;
function numbers(value:unknown,count:number,label:string,min=-1e100,max=1e100):Float64Array {
  if(!Array.isArray(value)&&!(value instanceof Float64Array)&&!(value instanceof Float32Array))throw new EngineError('INVALID_PAYLOAD',`${label} needs a numeric array.`);
  if(value.length!==count)throw new EngineError('INVALID_PAYLOAD',`${label} has the wrong length.`);
  return Float64Array.from(value,(v,i)=>zero(finite(v,`${label}[${i}]`,min,max)));
}
function indices(value:unknown,limit:number,label:string):Uint32Array {
  if(!Array.isArray(value)&&!(value instanceof Uint32Array)&&!(value instanceof Int32Array)&&!(value instanceof Uint16Array))throw new EngineError('INVALID_PAYLOAD',`${label} needs an index array.`);
  return Uint32Array.from(value as ArrayLike<number>,(v,i)=>integer(v,`${label}[${i}]`,0,limit-1));
}

/** Rotation factor R of F = R S by Newton iteration R <- (R + R^-T) / 2. Needs det F > 0. */
function polarRotation(F:Float64Array,R:Float64Array):void {
  let a=F[0],b=F[1],c=F[2],d=F[3],e=F[4],f=F[5],g=F[6],h=F[7],i=F[8];
  for(let k=0;k<64;k++){
    const c0=e*i-f*h,c1=f*g-d*i,c2=d*h-e*g,c3=c*h-b*i,c4=a*i-c*g,c5=b*g-a*h,c6=b*f-c*e,c7=c*d-a*f,c8=a*e-b*d,s=.5/(a*c0+b*c1+c*c2);
    const na=.5*a+s*c0,nb=.5*b+s*c1,nc=.5*c+s*c2,nd=.5*d+s*c3,ne=.5*e+s*c4,nf=.5*f+s*c5,ng=.5*g+s*c6,nh=.5*h+s*c7,ni=.5*i+s*c8;
    const delta=Math.max(Math.abs(na-a),Math.abs(nb-b),Math.abs(nc-c),Math.abs(nd-d),Math.abs(ne-e),Math.abs(nf-f),Math.abs(ng-g),Math.abs(nh-h),Math.abs(ni-i));
    a=na;b=nb;c=nc;d=nd;e=ne;f=nf;g=ng;h=nh;i=ni;
    if(delta<=1e-15)break;
  }
  R[0]=a;R[1]=b;R[2]=c;R[3]=d;R[4]=e;R[5]=f;R[6]=g;R[7]=h;R[8]=i;
}

/** Eigenvalues of a symmetric 3x3 tensor [xx, yy, zz, yz, xz, xy], largest first, by cyclic Jacobi rotations. */
export function symmetricEigenvalues(t:ArrayLike<number>,offset:number,out:Float64Array|number[],outOffset:number):void {
  const m=[t[offset],t[offset+5],t[offset+4],t[offset+5],t[offset+1],t[offset+3],t[offset+4],t[offset+3],t[offset+2]];
  const scale=Math.max(Math.abs(m[0]),Math.abs(m[4]),Math.abs(m[8]),Math.abs(m[1]),Math.abs(m[2]),Math.abs(m[5]));
  for(let sweep=0;sweep<32&&scale>0;sweep++){
    if(Math.abs(m[1])+Math.abs(m[2])+Math.abs(m[5])<=1e-300+4e-17*scale)break;
    for(let p=0;p<2;p++)for(let q=p+1;q<3;q++){
      const apq=m[3*p+q];if(apq===0)continue;
      const theta=(m[4*q]-m[4*p])/(2*apq),tan=(theta<0?-1:1)/(Math.abs(theta)+Math.sqrt(theta*theta+1)),cos=1/Math.sqrt(tan*tan+1),sin=tan*cos;
      for(let k=0;k<3;k++){const kp=m[3*k+p],kq=m[3*k+q];m[3*k+p]=cos*kp-sin*kq;m[3*k+q]=sin*kp+cos*kq;}
      for(let k=0;k<3;k++){const pk=m[3*p+k],qk=m[3*q+k];m[3*p+k]=cos*pk-sin*qk;m[3*q+k]=sin*pk+cos*qk;}
    }
  }
  let x=m[0],y=m[4],z=m[8],s:number;
  if(x<y){s=x;x=y;y=s;}if(y<z){s=y;y=z;z=s;}if(x<y){s=x;x=y;y=s;}
  out[outOffset]=x;out[outOffset+1]=y;out[outOffset+2]=z;
}

/** Symmetric 6 x 6 matrix M (row-major) with its eigenvalues raised to at least `floor`, by cyclic Jacobi. In place. */
/** Von Mises equivalent stress of a symmetric tensor [xx, yy, zz, yz, xz, xy]. */
export function vonMisesStress(t:ArrayLike<number>,offset=0):number {
  const a=t[offset]-t[offset+1],b=t[offset+1]-t[offset+2],c=t[offset+2]-t[offset];
  return Math.sqrt(.5*(a*a+b*b+c*c)+3*(t[offset+3]*t[offset+3]+t[offset+4]*t[offset+4]+t[offset+5]*t[offset+5]));
}

/** A deformable solid of four-node tetrahedra with a lumped mass matrix. SI units, float64.
 *
 * Statics and the implicit integrators minimise one incremental potential by Newton's method
 * with a Jacobi-preconditioned conjugate-gradient inner solve; products with the tangent
 * stiffness are formed element by element, so no global matrix is stored. Loads are dead
 * loads: tractions, pressure and gravity keep their reference direction and area.
 * With a yield stress the linear and green-lagrange models are elastic-plastic (J2, isotropic hardening,
 * ductile erosion). No contact here (solid-contact.ts) and no crack-growth law. See docs/SOLID_MECHANICS.md.
 */
/** What an exact checkpoint of a SolidBody holds: every field it has (displacements, velocities, loads, constraints, the
 * integrator's history, the corotational frames, the plastic and concrete state). The concrete return mapping is scratch. */
const SOLID_FIELDS:FieldOptions={label:'SolidBody',skip:['creturn','ldl','nW','nT','nU1','nU2','nU2Old','nD','eG','eP','eD','ringStart','ringNodes','nodeElementStart','nodeElements','mark','ringVector','keScratch']};
/** Inner iterations above which the next Newton iteration forms a new factorization (`linearSolver: 'ldl'`). */
export const LDL_REFACTOR_ITERATIONS=8;
/** Newton iterations that use the diagonal preconditioner after a factorization met an indefinite tangent. */
export const LDL_INDEFINITE_SKIP=3;

export class SolidBody {
  /** Everything a later step reads, as a state tree (checkpoint.ts), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,SOLID_FIELDS);}
  /** Put back a state from `saveState()` of a solid with the same mesh, material and settings. */
  restoreState(state:StateValue):void {restoreFields(this,state,SOLID_FIELDS);}

  readonly solver:string=SOLID_SOLVER_ID;
  readonly model:SolidModel;readonly integrator:SolidIntegrator;readonly dt:number;
  readonly element:SolidElement;readonly linearSolver:SolidLinearSolver;
  readonly nodeCount:number;readonly tetCount:number;
  /** Reference node positions (x, y, z per node, m). */
  readonly referencePositions:Float64Array;
  /** Four node indices per element, oriented to positive volume. */
  readonly tets:Uint32Array;
  /** Boundary triangles, three node indices each, wound outward. Load calls take indices into this list. */
  readonly faces:Uint32Array;
  /** Lumped mass per node, kg: a quarter of the mass of each element that touches the node. */
  readonly nodalMass:Float64Array;
  /** Reference volume per element, m^3. */
  readonly elementVolume:Float64Array;
  readonly referenceVolume:number;readonly mass:number;
  /** Lame parameters in Pa: lambda = E nu / ((1 + nu)(1 - 2 nu)), mu = E / (2 (1 + nu)). */
  readonly lambda:number;readonly mu:number;
  readonly material:Readonly<Required<Omit<SolidMaterial,'concrete'>>&{concrete?:ConcreteLawInput}>;
  /** True when the material has a yield stress. */
  readonly plastic:boolean;
  /** Statistics of the most recent solve (static load step or implicit time step). Updated in place. */
  readonly stats:SolidSolveStats={converged:true,reason:'converged',newtonIterations:0,linearIterations:0,residual:0,reference:0};
  private readonly massDamping:number;private readonly stiffnessDamping:number;private readonly gravity:Float64Array;
  private readonly tolerance:number;private readonly forceTolerance:number;private readonly maxNewton:number;private readonly maxLinear:number;private readonly explicitSafety:number;
  private readonly grad:Float64Array;private readonly theta:Float64Array;private readonly kDiagonal:Float64Array;
  private readonly fixed:Uint8Array;private readonly prescribed:Float64Array;private readonly nodalForce:Float64Array;private readonly surfaceForce:Float64Array;private readonly fext:Float64Array;
  private readonly u:Float64Array;private readonly v:Float64Array;private readonly acceleration:Float64Array;
  private readonly fint:Float64Array;private g:Float64Array;private gTrial:Float64Array;private readonly trial:Float64Array;private readonly u0:Float64Array;private readonly target:Float64Array;
  private readonly x:Float64Array;private readonly r:Float64Array;private readonly z:Float64Array;private readonly p:Float64Array;private readonly ap:Float64Array;private readonly work:Float64Array;private readonly work2:Float64Array;
  private readonly lin:Float64Array;private readonly linOld:Float64Array;
  private readonly H=new Float64Array(9);private readonly P=new Float64Array(9);private readonly F=new Float64Array(9);private readonly R=new Float64Array(9);private readonly B=new Float64Array(9);
  private veBranches:{ratio:number;time:number}[]=[];private veA=new Float64Array(0);private veB=new Float64Array(0);private veHist=new Float64Array(0);private vePrev=new Float64Array(0);private veC=new Float64Array(0);private relaxed=false;private reporting=false;
  /** Scale of the elastic stress within one step of a viscoelastic body: 1 + sum ratio_i (1 - a_i) / (dt / time_i), a_i = exp(-dt / time_i). 1 when elastic. */
  readonly viscoelasticScale:number=1;
  /** Committed plastic strain per element [xx, yy, zz, yz, xz, xy] (tensor shear), equivalent plastic strain, erosion flags. */
  private readonly ep:Float64Array;private readonly alpha:Float64Array;private readonly eroded:Uint8Array;private readonly ptan:Float64Array;
  /** Concrete law (constant), crack strain kappa_t per element, and the stored symmetric 6 x 6 tangent per element (21 values). */
  readonly concreteLaw:ConcreteLaw|null=null;private readonly kappaT:Float64Array=new Float64Array(0);private readonly strengthFactor:Float64Array=new Float64Array(0);private readonly ctan:Float64Array=new Float64Array(0);private readonly ctrial:Float64Array=new Float64Array(0);private readonly cdirty:Uint8Array=new Uint8Array(0);
  private readonly creturn:ConcreteReturn|null=null;private readonly cbase=new Float64Array(13);private readonly cstrain=new Float64Array(6);private readonly cmat=new Float64Array(36);
  private kDiagonalFirst:Float64Array|null=null;
  // ---- Nodally averaged element (`tet4-nodal`) ----
  /** 0: per-element volumetric strain (tet4). 1: volumetric energy at the nodes (averaged nodal pressure, tet4-nodal). */
  private readonly avg:number=0;
  /** Lame lambda the element laws use: lambda for tet4 and B-bar; for the averaged nodal pressure lambda - K (the deviatoric
   * part only) or 0 for Neo-Hookean, whose volumetric term lambda/2 ln^2 J moves to the nodes. */
  private elemLambda:number;
  /** Modulus of the nodal volumetric energy: K = lambda + 2 mu / 3 (U = K/2 theta^2) or lambda for Neo-Hookean (U = lambda/2 ln^2 J). */
  private readonly bulkNodal:number=0;
  /** Per node: weight (a quarter of each live element's volume), the weighted volumetric measure, U', U'' (and U'' kept for the
   * damping tangent), and the tangent passes' scratch. */
  private nW=new Float64Array(0);private nT=new Float64Array(0);private nU1=new Float64Array(0);private nU2=new Float64Array(0);private nU2Old=new Float64Array(0);private nD=new Float64Array(0);
  /** Per element: d theta_e / d H (9), the element stress (9), d theta_e of the tangent pass. */
  private eG=new Float64Array(0);private eP=new Float64Array(0);private eD=new Float64Array(0);
  /** Set by piolaElastic for the averaged passes: theta_e and d theta_e / d H. */
  private vol=0;private readonly G9=new Float64Array(9);
  /** Sparse factorization (`linearSolver: 'ldl'`), built on first use, and its bookkeeping. */
  private ldl:SparseLDL|null=null;
  /** The factorization is kept across Newton iterations and steps and formed again when an inner solve needed more than
   * LDL_REFACTOR_ITERATIONS, when the scales of K and M change or an element erodes. Its numbers are state (a resumed run must
   * precondition with the same factor to repeat bit for bit), so they live in these arrays, which the factorization shares. */
  private ldlValid=false;private ldlLast=0;private ldlK=0;private ldlM=0;private ldlEroded=0;private ldlFactorizations=0;
  /** Inner solves left that use the diagonal instead of the factorization, and whether the factorization is fresh and shifted. */
  private ldlSkip=0;private ldlFresh=false;
  private ldlValues:Float64Array=new Float64Array(0);private ldlD:Float64Array=new Float64Array(0);
  private nodeElementStart=new Int32Array(0);private nodeElements=new Int32Array(0);private mark=new Int32Array(0);private ringVector=new Float64Array(0);private ringStart=new Int32Array(0);private ringNodes=new Int32Array(0);private keScratch=new Float64Array(0);
  private readonly T=new Float64Array(6);private storeMode=0;private storedOnly=false;private erodedTotal=0;private plasticWorkTotal=0;
  private cm=0;private cd=0;private reference=0;private referenceInertia=0;private loadScale=1;private accelerationValid=false;private steps=0;private unconverged=0;private limit:SolidExplicitLimit|null=null;

  constructor(input:SolidDefinition){
    const d=record(input,'definition');onlyKeys(d,['mesh','material','config'],'definition');
    const mesh=record(d.mesh,'mesh');onlyKeys(mesh,['positions','tets'],'mesh');
    const nodeCount=integer((mesh.positions as ArrayLike<number>)?.length/3,'node count',4,SOLID_MAX_NODES),tetCount=integer((mesh.tets as ArrayLike<number>)?.length/4,'element count',1,SOLID_MAX_TETS),size=3*nodeCount;
    this.nodeCount=nodeCount;this.tetCount=tetCount;
    const X=this.referencePositions=numbers(mesh.positions,size,'positions',-1e6,1e6),tets=this.tets=indices(mesh.tets,nodeCount,'tets');
    const m=record(d.material,'material');onlyKeys(m,['youngModulus','poissonRatio','density','thermalExpansion','yieldStress','hardeningModulus','failureStrain','concrete'],'material');
    const E=finite(m.youngModulus,'youngModulus',1,1e13),nu=finite(m.poissonRatio,'poissonRatio',-.99,.4999),rho=finite(m.density,'density',1e-6,1e6);
    const concrete=m.concrete!==undefined;
    if(concrete&&(m.yieldStress!==undefined||m.hardeningModulus!==undefined||m.failureStrain!==undefined))throw new EngineError('INVALID_PAYLOAD','A concrete law replaces yieldStress, hardeningModulus and failureStrain.');
    const plastic=this.plastic=m.yieldStress!==undefined||concrete;
    if(!plastic&&(m.hardeningModulus!==undefined||m.failureStrain!==undefined))throw new EngineError('INVALID_PAYLOAD','hardeningModulus and failureStrain need a yieldStress.');
    this.material=Object.freeze({youngModulus:E,poissonRatio:nu,density:rho,thermalExpansion:m.thermalExpansion===undefined?0:finite(m.thermalExpansion,'thermalExpansion',-1e-2,1e-2),
      yieldStress:plastic&&!concrete?finite(m.yieldStress,'yieldStress',1e-6,1e13):Infinity,hardeningModulus:m.hardeningModulus===undefined?0:finite(m.hardeningModulus,'hardeningModulus',0,1e13),
      failureStrain:m.failureStrain===undefined?Infinity:m.failureStrain===Infinity?Infinity:finite(m.failureStrain,'failureStrain',1e-9,1e3),...(concrete?{concrete:m.concrete as ConcreteLawInput}:{})});
    if(plastic)this.solver=concrete?SOLID_CONCRETE_SOLVER_ID:SOLID_PLASTIC_SOLVER_ID;
    this.lambda=E*nu/((1+nu)*(1-2*nu));this.mu=E/(2*(1+nu));this.elemLambda=this.lambda;
    const c=d.config===undefined?{}:record(d.config,'config');onlyKeys(c,['model','dt','integrator','massDamping','stiffnessDamping','gravity','tolerance','forceTolerance','maxNewtonIterations','maxLinearIterations','explicitSafety','viscoelastic','element','linearSolver'],'config');
    const model=c.model===undefined?'corotational':c.model,integrator=c.integrator===undefined?'backward-euler':c.integrator;
    if(model!=='linear'&&model!=='corotational'&&model!=='neo-hookean'&&model!=='green-lagrange')throw new EngineError('INVALID_PAYLOAD','Unknown solid model.');
    if(integrator!=='backward-euler'&&integrator!=='midpoint'&&integrator!=='explicit')throw new EngineError('INVALID_PAYLOAD','Unknown solid integrator.');
    const element=c.element===undefined?'tet4':c.element,linearSolver=c.linearSolver===undefined?'cg':c.linearSolver;
    if(element!=='tet4'&&element!=='tet4-nodal')throw new EngineError('INVALID_PAYLOAD','Unknown solid element: tet4 or tet4-nodal.');
    if(linearSolver!=='cg'&&linearSolver!=='ldl')throw new EngineError('INVALID_PAYLOAD','Unknown linear solver: cg or ldl.');
    this.element=element;this.linearSolver=linearSolver;
    if(c.viscoelastic!==undefined){
      const ve=record(c.viscoelastic,'viscoelastic');onlyKeys(ve,['branches'],'viscoelastic');
      if(integrator!=='backward-euler')throw new EngineError('INVALID_PAYLOAD','A viscoelastic solid needs the backward-euler integrator.');
      if(!Array.isArray(ve.branches)||ve.branches.length<1||ve.branches.length>8)throw new EngineError('INVALID_PAYLOAD','viscoelastic.branches takes 1 to 8 branches.');
      this.veBranches=ve.branches.map((b:unknown,i:number)=>{const r=record(b,`branches[${i}]`);onlyKeys(r,['ratio','time'],`branches[${i}]`);return {ratio:finite(r.ratio,'ratio',0,1e4),time:finite(r.time,'time',1e-9,1e12)};});
    }
    if(plastic&&model!=='linear'&&model!=='green-lagrange')throw new EngineError('INVALID_PAYLOAD','Plasticity needs the linear or green-lagrange model.');
    if(concrete&&c.viscoelastic!==undefined)throw new EngineError('INVALID_PAYLOAD','A solid is either viscoelastic or has a concrete law, not both.');
    if(plastic&&integrator==='midpoint')throw new EngineError('INVALID_PAYLOAD','Plasticity needs the backward-euler or explicit integrator: the midpoint rule extrapolates past the state it solved.');
    if(plastic&&c.viscoelastic!==undefined)throw new EngineError('INVALID_PAYLOAD','A solid is either viscoelastic or plastic, not both: the Prony branches relax the total strain, and J2 needs them to act on the elastic strain, which this version does not model.');
    this.model=model;this.integrator=integrator;
    if(element==='tet4-nodal'){
      // The pressure-dependent concrete law does not split into a deviatoric and a volumetric energy, and an element strain whose
      // volumetric part is averaged from the nodes (B-bar) admits spurious soft modes (measured: Cook's membrane 2.5 times too
      // flexible at nu = 0.3), so the concrete law keeps the tet4 element.
      if(concrete)throw new EngineError('INVALID_PAYLOAD','The concrete law needs the tet4 element: its pressure-dependent yield does not split into the deviatoric and volumetric energies tet4-nodal averages.');
      this.avg=1;this.bulkNodal=model==='neo-hookean'?this.lambda:this.lambda+2*this.mu/3;this.elemLambda=model==='neo-hookean'?0:this.lambda-this.bulkNodal;
    }this.dt=c.dt===undefined?1/240:finite(c.dt,'dt',1e-12,10);
    this.massDamping=c.massDamping===undefined?0:zero(finite(c.massDamping,'massDamping',0,1e6));this.stiffnessDamping=c.stiffnessDamping===undefined?0:zero(finite(c.stiffnessDamping,'stiffnessDamping',0,1e3));
    this.gravity=c.gravity===undefined?new Float64Array(3):numbers(c.gravity,3,'gravity',-1e5,1e5);
    this.tolerance=c.tolerance===undefined?1e-10:finite(c.tolerance,'tolerance',0,1e-2);this.forceTolerance=c.forceTolerance===undefined?0:finite(c.forceTolerance,'forceTolerance',0,1e12);
    this.maxNewton=c.maxNewtonIterations===undefined?60:integer(c.maxNewtonIterations,'maxNewtonIterations',1,10000);this.maxLinear=c.maxLinearIterations===undefined?20000:integer(c.maxLinearIterations,'maxLinearIterations',1,10_000_000);
    this.explicitSafety=c.explicitSafety===undefined?.9:finite(c.explicitSafety,'explicitSafety',.01,1);

    // Element geometry: reference volume and the constant shape-function gradients.
    const grad=this.grad=new Float64Array(12*tetCount),vol=this.elementVolume=new Float64Array(tetCount),mass=this.nodalMass=new Float64Array(nodeCount),kd=this.kDiagonal=new Float64Array(size);
    let total=0;
    for(let e=0;e<tetCount;e++){
      const t=4*e;if(new Set([tets[t],tets[t+1],tets[t+2],tets[t+3]]).size!==4)throw new EngineError('INVALID_PAYLOAD',`Element ${e} repeats a node.`);
      if(tetVolume(X,tets[t],tets[t+1],tets[t+2],tets[t+3])<0){const s=tets[t+2];tets[t+2]=tets[t+3];tets[t+3]=s;}
      const n0=3*tets[t],n1=3*tets[t+1],n2=3*tets[t+2],n3=3*tets[t+3];
      const a=X[n1]-X[n0],b=X[n2]-X[n0],cc=X[n3]-X[n0],dd=X[n1+1]-X[n0+1],ee=X[n2+1]-X[n0+1],f=X[n3+1]-X[n0+1],gg=X[n1+2]-X[n0+2],h=X[n2+2]-X[n0+2],i=X[n3+2]-X[n0+2];
      const c0=ee*i-f*h,c1=f*gg-dd*i,c2=dd*h-ee*gg,det=a*c0+b*c1+cc*c2,edge=Math.max(Math.hypot(a,dd,gg),Math.hypot(b,ee,h),Math.hypot(cc,f,i));
      if(!(det>1e-9*edge*edge*edge))throw new EngineError('INVALID_PAYLOAD',`Element ${e} has no volume.`);
      // Rows of the inverse edge matrix are the gradients of the shape functions of nodes 1 to 3.
      const o=12*e;
      grad[o+3]=c0/det;grad[o+4]=(cc*h-b*i)/det;grad[o+5]=(b*f-cc*ee)/det;
      grad[o+6]=c1/det;grad[o+7]=(a*i-cc*gg)/det;grad[o+8]=(cc*dd-a*f)/det;
      grad[o+9]=c2/det;grad[o+10]=(b*gg-a*h)/det;grad[o+11]=(a*ee-b*dd)/det;
      for(let k=0;k<3;k++)grad[o+k]=-(grad[o+3+k]+grad[o+6+k]+grad[o+9+k]);
      const V=vol[e]=det/6;total+=V;
      for(let q=0;q<4;q++){
        const gx=grad[o+3*q],gy=grad[o+3*q+1],gz=grad[o+3*q+2],g2=gx*gx+gy*gy+gz*gz,n=tets[t+q];mass[n]+=rho*V/4;
        // Diagonal of the reference stiffness: V (mu |g|^2 + (lambda + mu) g_i^2).
        kd[3*n]+=V*(this.mu*g2+(this.lambda+this.mu)*gx*gx);kd[3*n+1]+=V*(this.mu*g2+(this.lambda+this.mu)*gy*gy);kd[3*n+2]+=V*(this.mu*g2+(this.lambda+this.mu)*gz*gz);
      }
    }
    for(let n=0;n<nodeCount;n++)if(!(mass[n]>0))throw new EngineError('INVALID_PAYLOAD',`Node ${n} belongs to no element.`);
    this.referenceVolume=total;this.mass=rho*total;this.faces=boundaryFaces({positions:X,tets});
    this.theta=new Float64Array(tetCount);this.fixed=new Uint8Array(size);
    const f64=()=>new Float64Array(size);
    this.prescribed=f64();this.nodalForce=f64();this.surfaceForce=f64();this.fext=f64();this.u=f64();this.v=f64();this.acceleration=f64();this.fint=f64();this.g=f64();this.gTrial=f64();this.trial=f64();this.u0=f64();this.target=f64();
    this.x=f64();this.r=f64();this.z=f64();this.p=f64();this.ap=f64();this.work=f64();this.work2=f64();
    if(this.veBranches.length){
      const nb=this.veBranches.length;this.veA=new Float64Array(nb);this.veB=new Float64Array(nb);let scale=1;
      this.veBranches.forEach((b,i)=>{const x=this.dt/b.time,a=Math.exp(-x);this.veA[i]=a;this.veB[i]=b.ratio*(x>1e-8?-Math.expm1(-x)/x:1-x/2);scale+=this.veB[i];});
      this.viscoelasticScale=scale;this.veHist=new Float64Array(9*nb*tetCount);this.vePrev=new Float64Array(9*tetCount);this.veC=new Float64Array(9*tetCount);
    }
    const stride=model==='linear'&&!plastic?0:16;this.lin=new Float64Array(stride*tetCount);this.linOld=new Float64Array(this.stiffnessDamping>0?stride*tetCount:0);
    this.ep=new Float64Array(plastic?6*tetCount:0);this.alpha=new Float64Array(plastic?tetCount:0);this.eroded=new Uint8Array(plastic?tetCount:0);this.ptan=new Float64Array(plastic&&!concrete?PT*tetCount:0);
    if(concrete){
      this.concreteLaw=buildConcreteLaw(m.concrete,E,nu,total/tetCount);this.kappaT=new Float64Array(tetCount);this.strengthFactor=new Float64Array(tetCount).fill(1);this.ctan=new Float64Array(21*tetCount);this.ctrial=new Float64Array(6*tetCount);this.cdirty=new Uint8Array(tetCount).fill(2);
      this.creturn=new ConcreteReturn(this.concreteLaw,this.lambda,this.mu);
    }
    if(this.avg){
      const f=()=>new Float64Array(nodeCount),g=(k:number)=>new Float64Array(k*tetCount);
      this.nW=f();this.nT=f();this.nU1=f();this.nU2=f();this.nU2Old=f();this.nD=f();this.eG=g(9);this.eP=g(9);this.eD=g(1);
    }
    if(integrator==='explicit'&&this.dt>this.explicitSafety*this.explicitLimit().criticalTimeStep){
      const limit=this.explicitLimit();
      throw new EngineError('UNSTABLE_TIME_STEP',`Explicit time step ${this.dt} s exceeds ${this.explicitSafety} of the stability limit ${limit.criticalTimeStep} s (wave speed ${limit.waveSpeed} m/s, smallest altitude ${limit.minAltitude} m).`);
    }
  }

  // ---- Selection, constraints and loads ----

  /** Nodes whose reference position satisfies the predicate. */
  selectNodes(predicate:(x:number,y:number,z:number)=>boolean):Uint32Array {
    const X=this.referencePositions,out:number[]=[];
    for(let n=0;n<this.nodeCount;n++)if(predicate(X[3*n],X[3*n+1],X[3*n+2]))out.push(n);
    return Uint32Array.from(out);
  }
  /** Boundary faces (indices into `faces`) whose reference centroid and outward unit normal satisfy the predicate. */
  selectFaces(predicate:(cx:number,cy:number,cz:number,nx:number,ny:number,nz:number)=>boolean):Uint32Array {
    const X=this.referencePositions,out:number[]=[],n=[0,0,0,0];
    for(let f=0;f<this.faces.length/3;f++){
      const a=3*this.faces[3*f],b=3*this.faces[3*f+1],c=3*this.faces[3*f+2];this.faceNormal(f,n);
      if(predicate((X[a]+X[b]+X[c])/3,(X[a+1]+X[b+1]+X[c+1])/3,(X[a+2]+X[b+2]+X[c+2])/3,n[0],n[1],n[2]))out.push(f);
    }
    return Uint32Array.from(out);
  }
  /** Writes the outward unit normal into n[0..2] and the area into n[3]. */
  private faceNormal(face:number,n:number[]):void {
    const X=this.referencePositions,a=3*this.faces[3*face],b=3*this.faces[3*face+1],c=3*this.faces[3*face+2];
    const ux=X[b]-X[a],uy=X[b+1]-X[a+1],uz=X[b+2]-X[a+2],vx=X[c]-X[a],vy=X[c+1]-X[a+1],vz=X[c+2]-X[a+2];
    const x=uy*vz-uz*vy,y=uz*vx-ux*vz,z=ux*vy-uy*vx,length=Math.hypot(x,y,z);
    n[0]=x/length;n[1]=y/length;n[2]=z/length;n[3]=length/2;
  }
  /** Prescribes displacement components (m) at nodes. A `null` component is left as it is.
   * Constrained components keep their value during statics and dynamics. */
  constrain(nodes:ArrayLike<number>,value:readonly [number|null,number|null,number|null]=[0,0,0]):void {
    const list=indices(Array.from(nodes),this.nodeCount,'nodes');
    if(!Array.isArray(value)||value.length!==3)throw new EngineError('INVALID_PAYLOAD','A constraint needs three components.');
    const values=value.map((v,k)=>v===null?null:zero(finite(v,`constraint[${k}]`,-1e6,1e6)));
    for(const n of list)for(let k=0;k<3;k++){const w=values[k];if(w!==null){this.fixed[3*n+k]=1;this.prescribed[3*n+k]=w;this.v[3*n+k]=0;}}
    this.accelerationValid=false;
  }
  /** Removes the constraints on the given nodes. */
  release(nodes:ArrayLike<number>):void {
    for(const n of indices(Array.from(nodes),this.nodeCount,'nodes'))for(let k=0;k<3;k++){this.fixed[3*n+k]=0;this.prescribed[3*n+k]=0;}
    this.accelerationValid=false;
  }
  /** Sets the point force on one node, N. Replaces any earlier point force on it. */
  setNodalForce(node:number,force:readonly [number,number,number]):void {
    const n=integer(node,'node',0,this.nodeCount-1),f=numbers(force,3,'force',-1e15,1e15);
    for(let k=0;k<3;k++)this.nodalForce[3*n+k]=f[k];this.accelerationValid=false;
  }
  /** Adds a uniform traction (Pa, a force per reference area) on boundary faces; each node of a face takes a third of its load. */
  addTraction(faces:ArrayLike<number>,traction:readonly [number,number,number]):void {
    const list=indices(Array.from(faces),this.faces.length/3,'faces'),t=numbers(traction,3,'traction',-1e15,1e15),n=[0,0,0,0];
    for(const f of list){this.faceNormal(f,n);for(let q=0;q<3;q++)for(let k=0;k<3;k++)this.surfaceForce[3*this.faces[3*f+q]+k]+=t[k]*n[3]/3;}
    this.accelerationValid=false;
  }
  /** Adds a pressure (Pa, positive pushes into the solid) on boundary faces, along the reference normal. */
  addPressure(faces:ArrayLike<number>,pressure:number):void {
    const list=indices(Array.from(faces),this.faces.length/3,'faces'),p=finite(pressure,'pressure',-1e15,1e15),n=[0,0,0,0];
    for(const f of list){this.faceNormal(f,n);for(let q=0;q<3;q++)for(let k=0;k<3;k++)this.surfaceForce[3*this.faces[3*f+q]+k]-=p*n[k]*n[3]/3;}
    this.accelerationValid=false;
  }
  /** Removes every traction and pressure load. */
  clearSurfaceLoads():void {this.surfaceForce.fill(0);this.accelerationValid=false;}
  /** Temperature rise above the stress-free reference, K: one value for the body or one per node.
   * It enters as the eigenstrain thermalExpansion * rise (isotropic), evaluated per element from the mean of its nodes. */
  setTemperatureChange(rise:number|ArrayLike<number>):void {
    const alpha=this.material.thermalExpansion,nodal=typeof rise==='number'?null:numbers(Array.isArray(rise)?rise:Array.from(rise),this.nodeCount,'temperature',-1e5,1e5),uniform=nodal?0:finite(rise,'temperature',-1e5,1e5);
    for(let e=0;e<this.tetCount;e++){
      const value=nodal?(nodal[this.tets[4*e]]+nodal[this.tets[4*e+1]]+nodal[this.tets[4*e+2]]+nodal[this.tets[4*e+3]])/4:uniform,theta=alpha*value;
      if(!(theta>-.5))throw new EngineError('INVALID_PAYLOAD','The thermal strain must stay above -0.5.');
      this.theta[e]=theta;
    }
    this.accelerationValid=false;
  }
  private assembleLoads():void {
    const s=this.loadScale,g=this.gravity;
    for(let n=0;n<this.nodeCount;n++)for(let k=0;k<3;k++)this.fext[3*n+k]=s*(this.nodalForce[3*n+k]+this.surfaceForce[3*n+k]+this.nodalMass[n]*g[k]);
  }

  // ---- State ----

  /** Live nodal displacements (m). Read only; use `setState` to change them. */
  get displacements():Float64Array {return this.u;}
  /** Live nodal velocities (m/s). Read only; use `setState` to change them. */
  get velocities():Float64Array {return this.v;}
  get time():number {return this.steps*this.dt;}
  /** Time steps whose solve did not reach the tolerance since construction or `reset`. */
  get unconvergedSteps():number {return this.unconverged;}
  /** Replaces displacements and/or velocities. Constrained components must be given their prescribed value and zero velocity. */
  setState(displacements?:ArrayLike<number>,velocities?:ArrayLike<number>):void {
    const size=this.u.length,u=displacements===undefined?null:numbers(Array.isArray(displacements)?displacements:Array.from(displacements),size,'displacements',-1e6,1e6),v=velocities===undefined?null:numbers(Array.isArray(velocities)?velocities:Array.from(velocities),size,'velocities',-1e9,1e9);
    for(let j=0;j<size;j++)if(this.fixed[j]&&((u&&u[j]!==this.prescribed[j])||(v&&v[j]!==0)))throw new EngineError('INVALID_PAYLOAD','A constrained component must keep its prescribed displacement and zero velocity.');
    if(u)this.u.set(u);if(v)this.v.set(v);this.accelerationValid=false;
  }
  /** Returns to the undeformed state at rest and time zero. Constraints and loads stay. */
  reset():void {
    this.u.fill(0);this.v.fill(0);this.steps=0;this.unconverged=0;this.accelerationValid=false;
    this.ep.fill(0);this.alpha.fill(0);this.kappaT.fill(0);this.eroded.fill(0);this.erodedTotal=0;this.plasticWorkTotal=0;
    if(this.kDiagonalFirst)this.kDiagonal.set(this.kDiagonalFirst);
  }
  /** Current node positions (m). */
  positions(out=new Float64Array(this.u.length)):Float64Array {for(let j=0;j<out.length;j++)out[j]=this.referencePositions[j]+this.u[j];return out;}

  // ---- Element mechanics ----

  /** Displacement gradient of element e into H (row i, column j = d u_i / d X_j). */
  private gradient(e:number,u:Float64Array):void {
    const H=this.H,g=this.grad,t=this.tets,o=12*e;H.fill(0);
    for(let q=0;q<4;q++){
      const n=3*t[4*e+q],gx=g[o+3*q],gy=g[o+3*q+1],gz=g[o+3*q+2],ux=u[n],uy=u[n+1],uz=u[n+2];
      H[0]+=ux*gx;H[1]+=ux*gy;H[2]+=ux*gz;H[3]+=uy*gx;H[4]+=uy*gy;H[5]+=uy*gz;H[6]+=uz*gx;H[7]+=uz*gy;H[8]+=uz*gz;
    }
  }
  /** First Piola-Kirchhoff stress of element e from H into P; returns the strain energy density,
   * or Infinity when the element is inverted. Stores the data of the tangent when `lin` is given. */
  private piola(e:number,lin:Float64Array|null):number {
    const w=this.piolaElastic(e,lin);
    if(!this.veBranches.length||this.relaxed||!(w<Infinity))return w;
    if(this.reporting){
      // The stress now: the elastic stress plus every branch's overstress h_i (C_e already looks ahead to the next step).
      const P=this.P,hist=this.veHist,nb=this.veBranches.length;
      for(let i=0;i<nb;i++){const o=9*(nb*e+i);for(let q=0;q<9;q++)P[q]+=hist[o+q];}
      return w;
    }
    // Viscoelastic step: P = s P_elastic + C_e, the gradient of s W + C_e : H (C_e from the history, constant in the step).
    const P=this.P,H=this.H,C=this.veC,o=9*e,scale=this.viscoelasticScale;let linear=0;
    for(let q=0;q<9;q++){P[q]=scale*P[q]+C[o+q];linear+=C[o+q]*H[q];}
    return scale*w+linear;
  }
  /** After an accepted step: h_i <- a_i h_i + b_i (P_elastic(u) - P_elastic,old) for every branch, and the constant
   * C_e = sum_i (a_i h_i - b_i P_elastic) of the next step (Simo's recursion, exact for a stress that varies linearly within a step). */
  private commitViscous(u:Float64Array,relaxed=false):void {
    if(!this.veBranches.length)return;
    const nb=this.veBranches.length,P=this.P,hist=this.veHist,prev=this.vePrev,C=this.veC;
    if(this.avg){
      // The elastic stress of every element at once (the averaged passes leave it in eP).
      const keep=this.relaxed;this.relaxed=true;
      try{if(!(this.elastic(u,null,null)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');}finally{this.relaxed=keep;}
    }
    for(let e=0;e<this.tetCount;e++){
      if(this.avg)for(let q=0;q<9;q++)P[q]=this.eP[9*e+q];
      else{this.gradient(e,u);if(!(this.piolaElastic(e,null)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');}
      const o=9*e;
      for(let q=0;q<9;q++){
        const delta=relaxed?0:P[q]-prev[o+q];let c=0;
        for(let i=0;i<nb;i++){const k=9*(nb*e+i)+q;hist[k]=this.veA[i]*hist[k]+this.veB[i]*delta;c+=this.veA[i]*hist[k];}
        prev[o+q]=P[q];
        for(let i=0;i<nb;i++)c-=this.veB[i]*P[q];
        C[o+q]=c;
      }
    }
  }
  private piolaElastic(e:number,lin:Float64Array|null):number {
    const H=this.H,P=this.P,mu=this.mu,la=this.elemLambda,th=this.loadScale*this.theta[e];
    if(this.model==='linear'){
      const exx=H[0]-th,eyy=H[4]-th,ezz=H[8]-th,exy=.5*(H[1]+H[3]),exz=.5*(H[2]+H[6]),eyz=.5*(H[5]+H[7]),tr=exx+eyy+ezz;
      if(this.avg)this.vol=tr;
      if(this.plastic){
        if(this.eroded[e]){P.fill(0);return 0;}
        const w=this.constitutive(e,exx,eyy,ezz,eyz,exz,exy,lin!==null),T=this.T;
        P[0]=T[0];P[4]=T[1];P[8]=T[2];P[5]=P[7]=T[3];P[2]=P[6]=T[4];P[1]=P[3]=T[5];return w;
      }
      P[0]=2*mu*exx+la*tr;P[4]=2*mu*eyy+la*tr;P[8]=2*mu*ezz+la*tr;P[1]=P[3]=2*mu*exy;P[2]=P[6]=2*mu*exz;P[5]=P[7]=2*mu*eyz;
      return mu*(exx*exx+eyy*eyy+ezz*ezz+2*(exy*exy+exz*exz+eyz*eyz))+.5*la*tr*tr;
    }
    // Strains are formed from H, not from F - I, so that small strains keep full relative precision.
    const F=this.F,R=this.R,o=16*e;
    if(this.model==='green-lagrange'){
      if(this.plastic&&this.eroded[e]){P.fill(0);return 0;}
      F[0]=1+H[0];F[1]=H[1];F[2]=H[2];F[3]=H[3];F[4]=1+H[4];F[5]=H[5];F[6]=H[6];F[7]=H[7];F[8]=1+H[8];
      if(!(F[0]*(F[4]*F[8]-F[5]*F[7])+F[1]*(F[5]*F[6]-F[3]*F[8])+F[2]*(F[3]*F[7]-F[4]*F[6])>MIN_J))return Infinity;
      // Green-Lagrange strain E = (H + H^T + H^T H) / 2, less the thermal strain.
      const exx=H[0]+.5*(H[0]*H[0]+H[3]*H[3]+H[6]*H[6])-th,eyy=H[4]+.5*(H[1]*H[1]+H[4]*H[4]+H[7]*H[7])-th,ezz=H[8]+.5*(H[2]*H[2]+H[5]*H[5]+H[8]*H[8])-th;
      if(this.avg)this.vol=exx+eyy+ezz;
      const exy=.5*(H[1]+H[3]+H[0]*H[1]+H[3]*H[4]+H[6]*H[7]),exz=.5*(H[2]+H[6]+H[0]*H[2]+H[3]*H[5]+H[6]*H[8]),eyz=.5*(H[5]+H[7]+H[1]*H[2]+H[4]*H[5]+H[7]*H[8]);
      let w:number,sxx:number,syy:number,szz:number,syz:number,sxz:number,sxy:number;
      if(this.plastic){w=this.constitutive(e,exx,eyy,ezz,eyz,exz,exy,lin!==null);const T=this.T;sxx=T[0];syy=T[1];szz=T[2];syz=T[3];sxz=T[4];sxy=T[5];}
      else{const tr=exx+eyy+ezz;sxx=2*mu*exx+la*tr;syy=2*mu*eyy+la*tr;szz=2*mu*ezz+la*tr;syz=2*mu*eyz;sxz=2*mu*exz;sxy=2*mu*exy;w=mu*(exx*exx+eyy*eyy+ezz*ezz+2*(exy*exy+exz*exz+eyz*eyz))+.5*la*tr*tr;}
      // First Piola-Kirchhoff stress P = F S (S the second Piola-Kirchhoff stress, here sxx..sxy).
      for(let i=0;i<3;i++){const a=F[3*i],b=F[3*i+1],c=F[3*i+2];P[3*i]=a*sxx+b*sxy+c*sxz;P[3*i+1]=a*sxy+b*syy+c*syz;P[3*i+2]=a*sxz+b*syz+c*szz;}
      if(lin){for(let q=0;q<9;q++)lin[o+q]=F[q];lin[o+9]=sxx;lin[o+10]=syy;lin[o+11]=szz;lin[o+12]=syz;lin[o+13]=sxz;lin[o+14]=sxy;}
      if(this.avg){const G=this.G9;for(let q=0;q<9;q++)G[q]=F[q];}
      return w;
    }
    if(this.model==='corotational'){
      F[0]=1+H[0];F[1]=H[1];F[2]=H[2];F[3]=H[3];F[4]=1+H[4];F[5]=H[5];F[6]=H[6];F[7]=H[7];F[8]=1+H[8];
      if(!(F[0]*(F[4]*F[8]-F[5]*F[7])+F[1]*(F[5]*F[6]-F[3]*F[8])+F[2]*(F[3]*F[7]-F[4]*F[6])>MIN_J))return Infinity;
      polarRotation(F,R);
      // Right stretch S = R^T F (symmetric), and C - I = H + H^T + H^T H.
      const sxx=R[0]*F[0]+R[3]*F[3]+R[6]*F[6],syy=R[1]*F[1]+R[4]*F[4]+R[7]*F[7],szz=R[2]*F[2]+R[5]*F[5]+R[8]*F[8];
      const sxy=.5*(R[0]*F[1]+R[3]*F[4]+R[6]*F[7]+R[1]*F[0]+R[4]*F[3]+R[7]*F[6]),sxz=.5*(R[0]*F[2]+R[3]*F[5]+R[6]*F[8]+R[2]*F[0]+R[5]*F[3]+R[8]*F[6]),syz=.5*(R[1]*F[2]+R[4]*F[5]+R[7]*F[8]+R[2]*F[1]+R[5]*F[4]+R[8]*F[7]);
      const cxx=2*H[0]+H[0]*H[0]+H[3]*H[3]+H[6]*H[6],cyy=2*H[4]+H[1]*H[1]+H[4]*H[4]+H[7]*H[7],czz=2*H[8]+H[2]*H[2]+H[5]*H[5]+H[8]*H[8];
      const cxy=H[1]+H[3]+H[0]*H[1]+H[3]*H[4]+H[6]*H[7],cxz=H[2]+H[6]+H[0]*H[2]+H[3]*H[5]+H[6]*H[8],cyz=H[5]+H[7]+H[1]*H[2]+H[4]*H[5]+H[7]*H[8];
      // Biot strain S - I = (S + I)^-1 (C - I); the two factors commute.
      const mxx=sxx+1,myy=syy+1,mzz=szz+1,j0=myy*mzz-syz*syz,j1=sxz*syz-sxy*mzz,j2=sxy*syz-sxz*myy,jd=mxx*j0+sxy*j1+sxz*j2;
      const nxx=j0/jd,nxy=j1/jd,nxz=j2/jd,nyy=(mxx*mzz-sxz*sxz)/jd,nzz=(mxx*myy-sxy*sxy)/jd,nyz=(sxy*sxz-mxx*syz)/jd;
      const exx=nxx*cxx+nxy*cxy+nxz*cxz-th,eyy=nxy*cxy+nyy*cyy+nyz*cyz-th,ezz=nxz*cxz+nyz*cyz+nzz*czz-th;
      const exy=.5*(nxx*cxy+nxy*cyy+nxz*cyz+nxy*cxx+nyy*cxy+nyz*cxz),exz=.5*(nxx*cxz+nxy*cyz+nxz*czz+nxz*cxx+nyz*cxy+nzz*cxz),eyz=.5*(nxy*cxz+nyy*cyz+nyz*czz+nxz*cxy+nyz*cyy+nzz*cyz);
      const tr=exx+eyy+ezz,txx=2*mu*exx+la*tr,tyy=2*mu*eyy+la*tr,tzz=2*mu*ezz+la*tr,txy=2*mu*exy,txz=2*mu*exz,tyz=2*mu*eyz;
      for(let i=0;i<3;i++){const a=R[3*i],b=R[3*i+1],c=R[3*i+2];P[3*i]=a*txx+b*txy+c*txz;P[3*i+1]=a*txy+b*tyy+c*tyz;P[3*i+2]=a*txz+b*tyz+c*tzz;}
      if(lin){
        // G = (tr(S) I - S)^-1 maps the skew part of R^T dF to the spin of R.
        const gxx=syy+szz,gyy=sxx+szz,gzz=sxx+syy,gxy=-sxy,gxz=-sxz,gyz=-syz,i0=gyy*gzz-gyz*gyz,i1=gxz*gyz-gxy*gzz,i2=gxy*gyz-gxz*gyy,det=gxx*i0+gxy*i1+gxz*i2;
        for(let k=0;k<9;k++)lin[o+k]=R[k];
        lin[o+9]=i0/det;lin[o+10]=(gxx*gzz-gxz*gxz)/det;lin[o+11]=(gxx*gyy-gxy*gxy)/det;lin[o+12]=(gxy*gxz-gxx*gyz)/det;lin[o+13]=i2/det;lin[o+14]=i1/det;
        lin[o+15]=la*tr-2*mu*(1+th);
      }
      if(this.avg){this.vol=tr;const G=this.G9;for(let q=0;q<9;q++)G[q]=R[q];}
      return mu*(exx*exx+eyy*eyy+ezz*ezz+2*(exy*exy+exz*exz+eyz*eyz))+.5*la*tr*tr;
    }
    // Neo-Hookean on the elastic part Fe = F / (1 + theta) = I + He. F holds He from here on.
    const k=1/(1+th),shift=-th*k;
    for(let q=0;q<9;q++)F[q]=k*H[q];F[0]+=shift;F[4]+=shift;F[8]+=shift;
    const a=1+F[0],b=1+F[4],c=1+F[8],c0=b*c-F[5]*F[7],c1=F[5]*F[6]-F[3]*c,c2=F[3]*F[7]-b*F[6];
    // J - 1 = tr He + (sum of the principal 2x2 minors of He) + det He.
    const J1=F[0]+F[4]+F[8]+F[0]*F[4]-F[1]*F[3]+F[0]*F[8]-F[2]*F[6]+F[4]*F[8]-F[5]*F[7]+F[0]*(F[4]*F[8]-F[5]*F[7])+F[1]*(F[5]*F[6]-F[3]*F[8])+F[2]*(F[3]*F[7]-F[4]*F[6]);
    if(!(1+J1>MIN_J))return Infinity;
    const logJ=Math.log1p(J1),s=1/(1+J1);
    // R holds the inverse of Fe.
    R[0]=c0*s;R[1]=(F[2]*F[7]-F[1]*c)*s;R[2]=(F[1]*F[5]-F[2]*b)*s;R[3]=c1*s;R[4]=(a*c-F[2]*F[6])*s;R[5]=(F[2]*F[3]-a*F[5])*s;R[6]=c2*s;R[7]=(F[1]*F[6]-a*F[7])*s;R[8]=(a*b-F[1]*F[3])*s;
    // Pe = [mu (Fe Fe^T - I) + lambda ln J I] Fe^-T, with Fe Fe^T - I = He + He^T + He He^T.
    const coefficient=la*logJ;let norm=0;
    for(let q=0;q<9;q++)norm+=F[q]*F[q];
    for(let i=0;i<3;i++)for(let m=0;m<3;m++){
      const left=mu*(F[3*i+m]+F[3*m+i]+F[3*i]*F[3*m]+F[3*i+1]*F[3*m+1]+F[3*i+2]*F[3*m+2])+(i===m?coefficient:0);
      this.B[3*i+m]=left;
    }
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)P[3*i+j]=k*(this.B[3*i]*R[3*j]+this.B[3*i+1]*R[3*j+1]+this.B[3*i+2]*R[3*j+2]);
    if(lin){for(let q=0;q<9;q++)lin[o+q]=R[q];lin[o+9]=logJ;lin[o+10]=k;}
    if(this.avg){
      // The volumetric measure is J of Fe, and its gradient d J / d H = k J Fe^-T.
      const J=1+J1,G=this.G9;this.vol=J;if(lin)lin[o+11]=J;
      for(let i=0;i<3;i++)for(let j=0;j<3;j++)G[3*i+j]=k*J*R[3*j+i];
    }
    // W = mu/2 (|Fe|^2 - 3) - mu ln J + lambda/2 ln^2 J, with |Fe|^2 - 3 = 2 tr He + |He|^2.
    return mu*(.5*norm+(F[0]+F[4]+F[8]-J1)-(logJ-J1))+.5*la*logJ*logJ;
  }
  /** J2 return mapping of element e for the strain e (tensor shear components), from the committed plastic
   * state. Writes the stress [xx, yy, zz, yz, xz, xy] into T and returns the incremental potential density:
   * stored elastic energy plus hardening energy plus the dissipation sigma_y0 dp of this increment, whose
   * derivative is the stress. With `store` keeps the tangent data; with storeMode 2 commits the state. */
  private constitutive(e:number,xx:number,yy:number,zz:number,yz:number,xz:number,xy:number,store:boolean):number {
    if(this.creturn)return this.concreteConstitutive(e,xx,yy,zz,yz,xz,xy,store);
    const mu=this.mu,la=this.elemLambda,Hm=this.material.hardeningModulus,ep=this.ep,o=6*e,tr=xx+yy+zz,m=tr/3;
    // Trial deviatoric elastic strain dev(eps) - eps_p.
    let dxx=xx-m-ep[o],dyy=yy-m-ep[o+1],dzz=zz-m-ep[o+2],dyz=yz-ep[o+3],dxz=xz-ep[o+4],dxy=xy-ep[o+5];
    const norm=Math.sqrt(dxx*dxx+dyy*dyy+dzz*dzz+2*(dyz*dyz+dxz*dxz+dxy*dxy)),q=3*mu*Math.sqrt(2/3)*norm;
    const a0=this.alpha[e],sy=this.material.yieldStress+Hm*a0,f=q-sy;
    let dp=0,nx=0,ny=0,nz=0,nyz=0,nxz=0,nxy=0,c1=0,c2=0;
    if(f>0&&norm>0){
      dp=f/(3*mu+Hm);const k=1/norm;nx=dxx*k;ny=dyy*k;nz=dzz*k;nyz=dyz*k;nxz=dxz*k;nxy=dxy*k;
      // The plastic increment sqrt(3/2) dp n takes the deviatoric strain back to the yield surface.
      const r=1-3*mu*dp/q;dxx*=r;dyy*=r;dzz*=r;dyz*=r;dxz*=r;dxy*=r;
      const beta=3*mu*dp/q;c1=2*mu*beta;c2=2*mu*(3*mu/(3*mu+Hm)-beta);
    }
    const T=this.T,pressure=(la+2*mu/3)*tr;T[0]=2*mu*dxx+pressure;T[1]=2*mu*dyy+pressure;T[2]=2*mu*dzz+pressure;T[3]=2*mu*dyz;T[4]=2*mu*dxz;T[5]=2*mu*dxy;
    // Plastic strain of this state: eps_p = dev(eps) - (deviatoric elastic strain).
    const pxx=xx-m-dxx,pyy=yy-m-dyy,pzz=zz-m-dzz,pyz=yz-dyz,pxz=xz-dxz,pxy=xy-dxy;
    if(store){
      const s=PT*e,P=this.ptan;P[s]=nx;P[s+1]=ny;P[s+2]=nz;P[s+3]=nyz;P[s+4]=nxz;P[s+5]=nxy;P[s+6]=c1;P[s+7]=c2;
      P[s+8]=pxx;P[s+9]=pyy;P[s+10]=pzz;P[s+11]=pyz;P[s+12]=pxz;P[s+13]=pxy;
    }
    if(this.storeMode===2){
      ep[o]=pxx;ep[o+1]=pyy;ep[o+2]=pzz;ep[o+3]=pyz;ep[o+4]=pxz;ep[o+5]=pxy;this.alpha[e]=a0+dp;
      this.plasticWorkTotal+=this.elementVolume[e]*(sy+Hm*dp)*dp;
    }
    const elastic=mu*(dxx*dxx+dyy*dyy+dzz*dzz+2*(dyz*dyz+dxz*dxz+dxy*dxy))+.5*(la+2*mu/3)*tr*tr;
    if(this.storedOnly)return elastic;
    return elastic+dp*(this.material.yieldStress+Hm*(a0+.5*dp));
  }
  /** The concrete law at element e for the strain [xx, yy, zz, yz, xz, xy] (tensor shear): the return mapping from the
   * committed state into T, the incremental potential density as the result. With `store`, keeps the trial strain from
   * which `concreteTangentForm` forms the element's tangent when a product needs it. With storeMode 2, commits the state. */
  private concreteConstitutive(e:number,xx:number,yy:number,zz:number,yz:number,xz:number,xy:number,store:boolean):number {
    const R=this.creturn!,ep=this.ep,o=6*e,t=this.cstrain,kc0=this.alpha[e],kt0=this.kappaT[e],T=this.T,base=this.cbase;
    t[0]=xx-ep[o];t[1]=yy-ep[o+1];t[2]=zz-ep[o+2];t[3]=yz-ep[o+3];t[4]=xz-ep[o+4];t[5]=xy-ep[o+5];
    const f=this.strengthFactor[e];R.map(t,kc0,kt0,f);
    for(let q=0;q<6;q++){T[q]=R.stress[q];base[q]=R.plastic[q];}
    base[6]=R.dKappaC;base[7]=R.dKappaT;base[8]=R.energy;base[9]=R.elastic;const yielded=R.yielded;
    if(store){
      // The tangent is formed when a product first needs it (concreteTangent): line-search trials that are not kept cost nothing.
      if(yielded){const c=this.ctrial;for(let q=0;q<6;q++)c[o+q]=t[q];this.cdirty[e]=1;}
      else{this.cdirty[e]=2;}
    }
    if(this.storeMode===2){
      for(let q=0;q<6;q++)ep[o+q]+=base[q];
      this.alpha[e]=kc0+base[6];this.kappaT[e]=kt0+base[7];
      this.plasticWorkTotal+=this.elementVolume[e]*(base[8]-base[9]);
    }
    return this.storedOnly?base[9]:base[8];
  }
  /** Forms element e's tangent from the trial strain kept by the last evaluation: elastic, or the derivative of the
   * returned stress by forward differences in engineering strain, symmetrised. Softening
   * makes it indefinite; the conjugate gradients stop at negative curvature. */
  private concreteTangentForm(e:number):void {
    const c=this.ctan,s=21*e,M=this.cmat,la=this.lambda,mu=this.mu,flag=this.cdirty[e];this.cdirty[e]=0;
    if(flag===2){
      M.fill(0);for(let i=0;i<3;i++){for(let j=0;j<3;j++)M[6*i+j]=la;M[7*i]+=2*mu;M[6*(i+3)+i+3]=mu;}
    }else{
      const R=this.creturn!,t=this.cstrain,o=6*e,kc0=this.alpha[e],kt0=this.kappaT[e],f=this.strengthFactor[e],base=this.cbase;
      for(let q=0;q<6;q++)t[q]=this.ctrial[o+q];
      R.map(t,kc0,kt0,f);for(let q=0;q<6;q++)base[q]=R.stress[q];
      const d=1e-9;
      for(let j=0;j<6;j++){
        const keep=t[j];t[j]+=j<3?d:d/2;R.map(t,kc0,kt0,f);t[j]=keep;
        for(let i=0;i<6;i++)M[6*i+j]=(R.stress[i]-base[i])/d;
      }
      for(let i=0;i<6;i++)for(let j=i+1;j<6;j++){const v=.5*(M[6*i+j]+M[6*j+i]);M[6*i+j]=M[6*j+i]=v;}
    }
    for(let i=0,k=0;i<6;i++)for(let j=i;j<6;j++)c[s+k++]=M[6*i+j];
  }
  /** Product of element e's stored concrete tangent with the strain increment d (tensor shear) into t. */
  private concreteTangent(e:number,d0:number,d1:number,d2:number,d3:number,d4:number,d5:number,t:Float64Array):void {
    if(this.cdirty[e])this.concreteTangentForm(e);
    const c=this.ctan,s=21*e,v0=d0,v1=d1,v2=d2,v3=2*d3,v4=2*d4,v5=2*d5;
    t[0]=c[s]*v0+c[s+1]*v1+c[s+2]*v2+c[s+3]*v3+c[s+4]*v4+c[s+5]*v5;
    t[1]=c[s+1]*v0+c[s+6]*v1+c[s+7]*v2+c[s+8]*v3+c[s+9]*v4+c[s+10]*v5;
    t[2]=c[s+2]*v0+c[s+7]*v1+c[s+11]*v2+c[s+12]*v3+c[s+13]*v4+c[s+14]*v5;
    t[3]=c[s+3]*v0+c[s+8]*v1+c[s+12]*v2+c[s+15]*v3+c[s+16]*v4+c[s+17]*v5;
    t[4]=c[s+4]*v0+c[s+9]*v1+c[s+13]*v2+c[s+16]*v3+c[s+18]*v4+c[s+19]*v5;
    t[5]=c[s+5]*v0+c[s+10]*v1+c[s+14]*v2+c[s+17]*v3+c[s+19]*v4+c[s+20]*v5;
  }
  /** Tangent of the first Piola-Kirchhoff stress of element e: dH in H, dP out in P. */
  private tangent(e:number,model:SolidModel,lin:Float64Array,plastic=false):void {
    this.tangentElastic(e,model,lin,plastic);
    if(this.veBranches.length&&!this.relaxed){const P=this.P,s=this.viscoelasticScale;for(let q=0;q<9;q++)P[q]*=s;}
  }
  private tangentElastic(e:number,model:SolidModel,lin:Float64Array,plastic=false):void {
    const H=this.H,P=this.P,mu=this.mu,la=this.elemLambda,o=16*e;
    if(this.plastic&&this.eroded[e]){P.fill(0);return;}
    if(model==='linear'){
      const tr=la*(H[0]+H[4]+H[8]),xy=mu*(H[1]+H[3]),xz=mu*(H[2]+H[6]),yz=mu*(H[5]+H[7]);
      P[0]=2*mu*H[0]+tr;P[4]=2*mu*H[4]+tr;P[8]=2*mu*H[8]+tr;P[1]=P[3]=xy;P[2]=P[6]=xz;P[5]=P[7]=yz;
      if(plastic&&this.creturn){
        const T=this.T;this.concreteTangent(e,H[0],H[4],H[8],.5*(H[5]+H[7]),.5*(H[2]+H[6]),.5*(H[1]+H[3]),T);
        P[0]=T[0];P[4]=T[1];P[8]=T[2];P[5]=P[7]=T[3];P[2]=P[6]=T[4];P[1]=P[3]=T[5];return;
      }
      if(plastic){
        const q=PT*e,T=this.ptan,c1=T[q+6],c2=T[q+7];
        if(c1!==0||c2!==0){
          const d0=H[0],d1=H[4],d2=H[8],d3=.5*(H[5]+H[7]),d4=.5*(H[2]+H[6]),d5=.5*(H[1]+H[3]),m=(d0+d1+d2)/3;
          const nd=c2*(T[q]*d0+T[q+1]*d1+T[q+2]*d2+2*(T[q+3]*d3+T[q+4]*d4+T[q+5]*d5));
          P[0]-=c1*(d0-m)+nd*T[q];P[4]-=c1*(d1-m)+nd*T[q+1];P[8]-=c1*(d2-m)+nd*T[q+2];
          const yz2=c1*d3+nd*T[q+3],xz2=c1*d4+nd*T[q+4],xy2=c1*d5+nd*T[q+5];
          P[5]-=yz2;P[7]-=yz2;P[2]-=xz2;P[6]-=xz2;P[1]-=xy2;P[3]-=xy2;
        }
      }
      return;
    }
    if(model==='corotational'){
      // A = R^T dH; its skew part gives the spin w of R; dP = 2 mu dH + s R [w]x + lambda tr(A) R.
      const r0=lin[o],r1=lin[o+1],r2=lin[o+2],r3=lin[o+3],r4=lin[o+4],r5=lin[o+5],r6=lin[o+6],r7=lin[o+7],r8=lin[o+8];
      const a01=r0*H[1]+r3*H[4]+r6*H[7],a02=r0*H[2]+r3*H[5]+r6*H[8],a10=r1*H[0]+r4*H[3]+r7*H[6],a12=r1*H[2]+r4*H[5]+r7*H[8],a20=r2*H[0]+r5*H[3]+r8*H[6],a21=r2*H[1]+r5*H[4]+r8*H[7];
      const tr=la*(r0*H[0]+r3*H[3]+r6*H[6]+r1*H[1]+r4*H[4]+r7*H[7]+r2*H[2]+r5*H[5]+r8*H[8]),ax=a21-a12,ay=a02-a20,az=a10-a01,s=lin[o+15];
      const wx=s*(lin[o+9]*ax+lin[o+14]*ay+lin[o+13]*az),wy=s*(lin[o+14]*ax+lin[o+10]*ay+lin[o+12]*az),wz=s*(lin[o+13]*ax+lin[o+12]*ay+lin[o+11]*az);
      P[0]=2*mu*H[0]+r1*wz-r2*wy+tr*r0;P[1]=2*mu*H[1]-r0*wz+r2*wx+tr*r1;P[2]=2*mu*H[2]+r0*wy-r1*wx+tr*r2;
      P[3]=2*mu*H[3]+r4*wz-r5*wy+tr*r3;P[4]=2*mu*H[4]-r3*wz+r5*wx+tr*r4;P[5]=2*mu*H[5]+r3*wy-r4*wx+tr*r5;
      P[6]=2*mu*H[6]+r7*wz-r8*wy+tr*r6;P[7]=2*mu*H[7]-r6*wz+r8*wx+tr*r7;P[8]=2*mu*H[8]+r6*wy-r7*wx+tr*r8;return;
    }
    if(model==='green-lagrange'){
      // P = F T: dP = dH T + F dT, dT = C : dE (elastic-plastic when `plastic`), dE = sym(F^T dH).
      const B=this.B;for(let q=0;q<9;q++)B[q]=H[q];
      const f0=lin[o],f1=lin[o+1],f2=lin[o+2],f3=lin[o+3],f4=lin[o+4],f5=lin[o+5],f6=lin[o+6],f7=lin[o+7],f8=lin[o+8];
      const d0=f0*B[0]+f3*B[3]+f6*B[6],d1=f1*B[1]+f4*B[4]+f7*B[7],d2=f2*B[2]+f5*B[5]+f8*B[8];
      const d3=.5*(f1*B[2]+f4*B[5]+f7*B[8]+f2*B[1]+f5*B[4]+f8*B[7]),d4=.5*(f0*B[2]+f3*B[5]+f6*B[8]+f2*B[0]+f5*B[3]+f8*B[6]),d5=.5*(f0*B[1]+f3*B[4]+f6*B[7]+f1*B[0]+f4*B[3]+f7*B[6]);
      const ltr=la*(d0+d1+d2);let t0=2*mu*d0+ltr,t1=2*mu*d1+ltr,t2=2*mu*d2+ltr,t3=2*mu*d3,t4=2*mu*d4,t5=2*mu*d5;
      if(plastic&&this.creturn){const T=this.T;this.concreteTangent(e,d0,d1,d2,d3,d4,d5,T);t0=T[0];t1=T[1];t2=T[2];t3=T[3];t4=T[4];t5=T[5];}
      else if(plastic){
        const q=PT*e,T=this.ptan,c1=T[q+6],c2=T[q+7];
        if(c1!==0||c2!==0){
          const m=(d0+d1+d2)/3,nd=c2*(T[q]*d0+T[q+1]*d1+T[q+2]*d2+2*(T[q+3]*d3+T[q+4]*d4+T[q+5]*d5));
          t0-=c1*(d0-m)+nd*T[q];t1-=c1*(d1-m)+nd*T[q+1];t2-=c1*(d2-m)+nd*T[q+2];t3-=c1*d3+nd*T[q+3];t4-=c1*d4+nd*T[q+4];t5-=c1*d5+nd*T[q+5];
        }
      }
      const sxx=lin[o+9],syy=lin[o+10],szz=lin[o+11],syz=lin[o+12],sxz=lin[o+13],sxy=lin[o+14];
      for(let i=0;i<3;i++){
        const h0=B[3*i],h1=B[3*i+1],h2=B[3*i+2],a=lin[o+3*i],b=lin[o+3*i+1],c=lin[o+3*i+2];
        P[3*i]=h0*sxx+h1*sxy+h2*sxz+a*t0+b*t5+c*t4;
        P[3*i+1]=h0*sxy+h1*syy+h2*syz+a*t5+b*t1+c*t3;
        P[3*i+2]=h0*sxz+h1*syz+h2*szz+a*t4+b*t3+c*t2;
      }
      return;
    }
    // Neo-Hookean: dPe = mu dFe + lambda tr(B) Fe^-T + (mu - lambda ln J) (B Fe^-1)^T with B = Fe^-1 dFe.
    const k=lin[o+10],c=mu-la*lin[o+9],B=this.F;
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)B[3*i+j]=k*(lin[o+3*i]*H[j]+lin[o+3*i+1]*H[3+j]+lin[o+3*i+2]*H[6+j]);
    const tr=la*(B[0]+B[4]+B[8]);
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)P[3*i+j]=k*(mu*k*H[3*i+j]+tr*lin[o+3*j+i]+c*(B[3*j]*lin[o+i]+B[3*j+1]*lin[o+3+i]+B[3*j+2]*lin[o+6+i]));
  }
  /** Adds V P g_a to the entries of `out` that belong to the nodes of element e. */
  private scatter(e:number,out:Float64Array):void {
    const P=this.P,g=this.grad,V=this.elementVolume[e],o=12*e;
    for(let q=0;q<4;q++){
      const n=3*this.tets[4*e+q],gx=V*g[o+3*q],gy=V*g[o+3*q+1],gz=V*g[o+3*q+2];
      out[n]+=P[0]*gx+P[1]*gy+P[2]*gz;out[n+1]+=P[3]*gx+P[4]*gy+P[5]*gz;out[n+2]+=P[6]*gx+P[7]*gy+P[8]*gz;
    }
  }
  /** Strain energy of the displacement field u; fills `fint` with the internal nodal forces. Infinity when an element is inverted. */
  private elastic(u:Float64Array,fint:Float64Array|null,lin:Float64Array|null):number {
    if(this.avg)return this.elasticNodal(u,fint,lin);
    let energy=0;if(fint)fint.fill(0);
    for(let e=0;e<this.tetCount;e++){
      this.gradient(e,u);const w=this.piola(e,lin);
      if(!(w<Infinity))return Infinity;
      energy+=this.elementVolume[e]*w;if(fint)this.scatter(e,fint);
    }
    return energy;
  }
  /** out = K x with the tangent stiffness of `model` linearised with `lin`. */
  private stiffness(model:SolidModel,lin:Float64Array,x:Float64Array,out:Float64Array,plastic=false):void {
    if(this.avg){this.stiffnessNodal(model,lin,x,out,plastic);return;}
    out.fill(0);
    for(let e=0;e<this.tetCount;e++){this.gradient(e,x);this.tangent(e,model,lin,plastic);this.scatter(e,out);}
  }

  // ---- Nodally averaged element (tet4-nodal) ----

  private live(e:number):boolean {return !(this.plastic&&this.eroded[e]);}
  /** Averaged nodal pressure: the energy of every element's deviatoric law (element lambda `elemLambda`) plus the volumetric
   * energy sum_n W_n U(theta_n) at the nodes, theta_n the average of the elements' volumetric measure theta_e weighted by a quarter
   * of their volume W_n. Its gradient adds pi_e G_e to each element's stress, pi_e the mean of U'(theta_n) over its four nodes and
   * G_e = d theta_e / d H. Viscoelastic bodies scale the whole elastic energy, as for tet4. */
  private elasticNodal(u:Float64Array,fint:Float64Array|null,lin:Float64Array|null):number {
    const nW=this.nW,nT=this.nT,nU1=this.nU1,V=this.elementVolume,t=this.tets,eG=this.eG,eP=this.eP,P=this.P,G=this.G9,model=this.model;
    nW.fill(0);nT.fill(0);let energy=0;
    for(let e=0;e<this.tetCount;e++){
      if(!this.live(e))continue;
      this.gradient(e,u);const w=this.piolaElastic(e,lin);
      if(!(w<Infinity))return Infinity;
      energy+=V[e]*w;const o=9*e;for(let q=0;q<9;q++)eP[o+q]=P[q];
      if(model!=='linear')for(let q=0;q<9;q++)eG[o+q]=G[q];
      const theta=this.vol,wq=V[e]/4;
      for(let q=0;q<4;q++){const n=t[4*e+q];nW[n]+=wq;nT[n]+=wq*theta;}
    }
    const K=this.bulkNodal,nh=model==='neo-hookean';let nodal=0;
    for(let n=0;n<this.nodeCount;n++){
      const W=nW[n];if(!(W>0)){nU1[n]=0;if(lin)this.nU2[n]=0;continue;}
      const theta=nT[n]/W;
      if(nh){
        if(!(theta>MIN_J))return Infinity;
        const l=Math.log(theta);nodal+=W*.5*K*l*l;nU1[n]=K*l/theta;if(lin)this.nU2[n]=K*(1-l)/(theta*theta);
      }else{nodal+=W*.5*K*theta*theta;nU1[n]=K*theta;if(lin)this.nU2[n]=K;}
    }
    energy+=nodal;
    const ve=this.veBranches.length>0&&!this.relaxed,reporting=this.reporting,scale=this.viscoelasticScale,C=this.veC,H=this.H,nb=this.veBranches.length,hist=this.veHist;
    let linear=0;if(fint)fint.fill(0);
    for(let e=0;e<this.tetCount;e++){
      if(!this.live(e))continue;
      const o=9*e,pi=(nU1[t[4*e]]+nU1[t[4*e+1]]+nU1[t[4*e+2]]+nU1[t[4*e+3]])/4;
      if(model==='linear'){for(let q=0;q<9;q++)P[q]=eP[o+q];P[0]+=pi;P[4]+=pi;P[8]+=pi;}
      else for(let q=0;q<9;q++)P[q]=eP[o+q]+pi*eG[o+q];
      for(let q=0;q<9;q++)eP[o+q]=P[q];
      if(lin){const l=16*e;if(model==='green-lagrange')lin[l+15]=pi;else if(model==='corotational')lin[l+15]+=pi;else if(model==='neo-hookean')lin[l+12]=pi;}
      if(ve){
        if(reporting){for(let i=0;i<nb;i++){const h=9*(nb*e+i);for(let q=0;q<9;q++)P[q]+=hist[h+q];}}
        else{this.gradient(e,u);for(let q=0;q<9;q++){P[q]=scale*P[q]+C[o+q];linear+=V[e]*C[o+q]*H[q];}}
      }
      if(fint)this.scatter(e,fint);
    }
    return ve&&!reporting?scale*energy+linear:energy;
  }
  /** Product with the tangent of elasticNodal: each element's own tangent (deviatoric law, plus pi_e dG_e) and d pi_e G_e, with
   * d pi_e the mean over the element's nodes of U''(theta_n) d theta_n. */
  private stiffnessNodal(model:SolidModel,lin:Float64Array,x:Float64Array,out:Float64Array,plastic:boolean):void {
    const nW=this.nW,nD=this.nD,eD=this.eD,V=this.elementVolume,t=this.tets,H=this.H,P=this.P,own=model===this.model;
    const U2=lin===this.linOld?this.nU2Old:this.nU2,K=this.bulkNodal;
    nW.fill(0);nD.fill(0);
    for(let e=0;e<this.tetCount;e++){
      if(!this.live(e))continue;
      this.gradient(e,x);const d=this.volumeChange(e,model,lin);eD[e]=d;const wq=V[e]/4;
      for(let q=0;q<4;q++){const n=t[4*e+q];nW[n]+=wq;nD[n]+=wq*d;}
    }
    for(let n=0;n<this.nodeCount;n++)nD[n]=nW[n]>0?(own&&model==='neo-hookean'?U2[n]:K)*nD[n]/nW[n]:0;
    out.fill(0);
    for(let e=0;e<this.tetCount;e++){
      if(!this.live(e))continue;
      this.gradient(e,x);this.tangentElastic(e,model,lin,plastic);
      const dpi=(nD[t[4*e]]+nD[t[4*e+1]]+nD[t[4*e+2]]+nD[t[4*e+3]])/4;
      this.addVolumeTangent(e,model,lin,dpi);
      if(this.veBranches.length&&!this.relaxed){const s=this.viscoelasticScale;for(let q=0;q<9;q++)P[q]*=s;}
      this.scatter(e,out);
    }
    void H;
  }
  /** d theta_e = G_e : dH of element e for the increment in H, from the data `lin` keeps. */
  private volumeChange(e:number,model:SolidModel,lin:Float64Array):number {
    const H=this.H,o=16*e;
    if(model==='linear')return H[0]+H[4]+H[8];
    if(model==='neo-hookean'){
      // k J tr(Fe^-1 dH); lin holds Fe^-1, k and J.
      let s=0;for(let i=0;i<3;i++)for(let j=0;j<3;j++)s+=lin[o+3*i+j]*H[3*j+i];
      return lin[o+10]*lin[o+11]*s;
    }
    // green-lagrange: F : dH; corotational: R : dH (lin holds F or R).
    let s=0;for(let q=0;q<9;q++)s+=lin[o+q]*H[q];return s;
  }
  /** Adds the volumetric terms of the averaged nodal pressure to the tangent product in P: pi_e dG_e + dpi G_e (corotational:
   * pi_e dR is already in the element's spin term, its coefficient lin[15] holding pi_e). */
  private addVolumeTangent(e:number,model:SolidModel,lin:Float64Array,dpi:number):void {
    const H=this.H,P=this.P,o=16*e;
    if(model==='linear'){P[0]+=dpi;P[4]+=dpi;P[8]+=dpi;return;}
    if(model==='green-lagrange'){const pi=lin[o+15];for(let q=0;q<9;q++)P[q]+=pi*H[q]+dpi*lin[o+q];return;}
    if(model==='corotational'){for(let q=0;q<9;q++)P[q]+=dpi*lin[o+q];return;}
    // Neo-Hookean: G = k J Fe^-T; dG = k J (tr(B) Fe^-T - (B Fe^-1)^T), B = k Fe^-1 dH.
    const k=lin[o+10],J=lin[o+11],pi=lin[o+12],B=this.B;
    for(let i=0;i<3;i++)for(let j=0;j<3;j++)B[3*i+j]=k*(lin[o+3*i]*H[j]+lin[o+3*i+1]*H[3+j]+lin[o+3*i+2]*H[6+j]);
    const tr=B[0]+B[4]+B[8],a=pi*k*J,b=dpi*k*J;
    for(let i=0;i<3;i++)for(let j=0;j<3;j++){
      const rt=lin[o+3*j+i],bf=B[3*j]*lin[o+i]+B[3*j+1]*lin[o+3+i]+B[3*j+2]*lin[o+6+i];
      P[3*i+j]+=a*(tr*rt-bf)+b*rt;
    }
  }
  // ---- Solver ----

  private norm(a:Float64Array):number {let s=0;for(let j=0;j<a.length;j++)s+=a[j]*a[j];return Math.sqrt(s);}
  /** Incremental potential at u and its gradient on the free components. */
  private objective(u:Float64Array,g:Float64Array):number {
    const fint=this.fint,fext=this.fext,size=u.length,cm=this.cm,cd=this.cd,alpha=this.massDamping,beta=this.stiffnessDamping;
    let phi=this.elastic(u,fint,this.lin.length?this.lin:null),internal=0,external=0;
    if(!(phi<Infinity))return Infinity;
    for(let j=0;j<size;j++){phi-=fext[j]*u[j];g[j]=fint[j]-fext[j];internal+=fint[j]*fint[j];external+=fext[j]*fext[j];}
    if(cm>0)for(let j=0;j<size;j++){const d=u[j]-this.target[j],md=cm*this.nodalMass[(j-j%3)/3]*d;phi+=.5*md*d;g[j]+=md;}
    if(cd>0){
      const d=this.work;for(let j=0;j<size;j++)d[j]=u[j]-this.u0[j];
      if(alpha>0)for(let j=0;j<size;j++){const md=cd*alpha*this.nodalMass[(j-j%3)/3]*d[j];phi+=.5*md*d[j];g[j]+=md;}
      if(beta>0){this.stiffness(this.model,this.linOld,d,this.work2);for(let j=0;j<size;j++){const kd=cd*beta*this.work2[j];phi+=.5*kd*d[j];g[j]+=kd;}}
    }
    for(let j=0;j<size;j++)if(this.fixed[j])g[j]=0;
    this.reference=Math.max(Math.sqrt(internal),Math.sqrt(external),this.referenceInertia);
    return phi;
  }
  /** Preconditioned conjugate gradients for (kScale K + mScale M) x = -g on the free components.
   * Stops early on a direction of non-positive curvature. Returns the iteration count, negative when it stopped that way. */
  private conjugateGradient(model:SolidModel,lin:Float64Array,kScale:number,mScale:number,g:Float64Array,target:number,plastic=false,ldl:SparseLDL|null=null):number {
    if(ldl)return this.factoredGradient(model,lin,kScale,mScale,g,target,plastic,ldl);
    const {x,r,z,p,ap,fixed,kDiagonal,nodalMass}=this,size=x.length;let rz=0,iterations=0;
    for(let j=0;j<size;j++){x[j]=0;r[j]=fixed[j]?0:-g[j];z[j]=p[j]=r[j]/(kScale*kDiagonal[j]+mScale*nodalMass[(j-j%3)/3]);rz+=r[j]*z[j];}
    while(iterations<this.maxLinear&&this.norm(r)>target){
      this.stiffness(model,lin,p,ap,plastic);let curvature=0;
      for(let j=0;j<size;j++){ap[j]=fixed[j]?0:kScale*ap[j]+mScale*nodalMass[(j-j%3)/3]*p[j];curvature+=p[j]*ap[j];}
      if(!(curvature>0)||!Number.isFinite(curvature)){if(iterations===0)x.set(z);return -iterations-1;}
      const step=rz/curvature;let next=0;
      for(let j=0;j<size;j++){x[j]+=step*p[j];r[j]-=step*ap[j];z[j]=r[j]/(kScale*kDiagonal[j]+mScale*nodalMass[(j-j%3)/3]);next+=r[j]*z[j];}
      const ratio=next/rz;rz=next;iterations++;
      for(let j=0;j<size;j++)p[j]=z[j]+ratio*p[j];
    }
    return iterations;
  }
  /** The same conjugate gradients preconditioned by the sparse factorization. */
  private factoredGradient(model:SolidModel,lin:Float64Array,kScale:number,mScale:number,g:Float64Array,target:number,plastic:boolean,ldl:SparseLDL):number {
    const {x,r,z,p,ap,fixed,nodalMass}=this,size=x.length;let rz=0,iterations=0;
    for(let j=0;j<size;j++){x[j]=0;r[j]=fixed[j]?0:-g[j];}
    ldl.solve(r,z);
    for(let j=0;j<size;j++){p[j]=z[j];rz+=r[j]*z[j];}
    while(iterations<this.maxLinear&&this.norm(r)>target){
      this.stiffness(model,lin,p,ap,plastic);let curvature=0;
      for(let j=0;j<size;j++){ap[j]=fixed[j]?0:kScale*ap[j]+mScale*nodalMass[(j-j%3)/3]*p[j];curvature+=p[j]*ap[j];}
      if(!(curvature>0)||!Number.isFinite(curvature)){if(iterations===0)x.set(z);return -iterations-1;}
      const step=rz/curvature;
      for(let j=0;j<size;j++){x[j]+=step*p[j];r[j]-=step*ap[j];}
      ldl.solve(r,z);let next=0;for(let j=0;j<size;j++)next+=r[j]*z[j];
      const ratio=next/rz;rz=next;iterations++;
      for(let j=0;j<size;j++)p[j]=z[j]+ratio*p[j];
    }
    return iterations;
  }
  /** Node to element lists, the ring of each node (the nodes of the elements around it) and the sparse structure: nodes that share
   * an element, or for the averaged nodal pressure nodes in the rings of a common node. */
  private ensureLdl():SparseLDL {
    if(this.ldl){if(this.ldlValues!==this.ldl.values)this.adoptFactor(this.ldl);return this.ldl;}
    const N=this.nodeCount,t=this.tets,start=this.nodeElementStart=new Int32Array(N+1);
    for(let e=0;e<this.tetCount;e++)for(let q=0;q<4;q++)start[t[4*e+q]+1]++;
    for(let n=0;n<N;n++)start[n+1]+=start[n];
    const fill=start.slice(0,N),list=this.nodeElements=new Int32Array(4*this.tetCount);
    for(let e=0;e<this.tetCount;e++)for(let q=0;q<4;q++)list[fill[t[4*e+q]]++]=e;
    const mark=this.mark=new Int32Array(N).fill(-1),rings:number[][]=[];let longest=0;
    for(let n=0;n<N;n++){
      const ring:number[]=[];
      for(let k=start[n];k<start[n+1];k++)for(let q=0;q<4;q++){const m=t[4*list[k]+q];if(mark[m]!==n){mark[m]=n;ring.push(m);}}
      ring.sort((a,b)=>a-b);rings.push(ring);longest=Math.max(longest,ring.length);
    }
    mark.fill(-1);
    const ringStart=this.ringStart=new Int32Array(N+1);for(let n=0;n<N;n++)ringStart[n+1]=ringStart[n]+rings[n].length;
    const ringNodes=this.ringNodes=new Int32Array(ringStart[N]);for(let n=0;n<N;n++)ringNodes.set(rings[n],ringStart[n]);
    this.ringVector=new Float64Array(3*longest);this.keScratch=new Float64Array(153);
    const wide=this.avg>0;
    const L=this.ldl=new SparseLDL(N,(a,visit)=>{
      for(let k=ringStart[a];k<ringStart[a+1];k++){
        const m=ringNodes[k];visit(m);
        if(wide)for(let j=ringStart[m];j<ringStart[m+1];j++)visit(ringNodes[j]);
      }
    });
    this.adoptFactor(L);
    return L;
  }
  /** A restored body brings the factor's numbers in ldlValues / ldlD: copy them into the factorization (or drop the factor when
   * they do not fit it), then share its arrays again. */
  private adoptFactor(L:SparseLDL):void {
    if(this.ldlValues.length===L.values.length&&this.ldlD.length===L.D.length){L.values.set(this.ldlValues);L.D.set(this.ldlD);}
    else this.ldlValid=false;
    this.ldlValues=L.values;this.ldlD=L.D;
  }
  /** Whether a new factorization is due before an inner solve with these scales, after one of `last` iterations. */
  private factorDue(kScale:number,mScale:number,last:number):boolean {
    if(this.ldlSkip>0){this.ldlSkip--;return false;}
    return !this.ldlValid||last>LDL_REFACTOR_ITERATIONS||kScale!==this.ldlK||mScale!==this.ldlM||this.erodedTotal!==this.ldlEroded;
  }
  /** Records an inner solve of `iterations`. A fresh factorization of an indefinite tangent (shifted) that still needed more
   * than twice LDL_REFACTOR_ITERATIONS is a poor preconditioner there: the next LDL_INDEFINITE_SKIP inner solves use the
   * stiffness diagonal, as `cg` does, before a new factorization is tried. */
  private innerDone(iterations:number):void {
    if(this.ldlFresh&&iterations>2*LDL_REFACTOR_ITERATIONS){this.ldlValid=false;this.ldlSkip=LDL_INDEFINITE_SKIP;}
    this.ldlFresh=false;this.ldlLast=iterations;
  }
  /** Factors the assembled matrix and records what it was formed for. */
  private factorize(kScale:number,mScale:number):void {
    const L=this.ensureLdl();
    if(L.values!==this.ldlValues)throw new EngineError('INTERNAL','The factorization lost its arrays.');
    L.factor();this.ldlK=kScale;this.ldlM=mScale;this.ldlEroded=this.erodedTotal;this.ldlFactorizations++;
    this.ldlValid=true;this.ldlFresh=L.shift>0;
  }
  /** Assembles kScale K + mScale M into the sparse matrix (unfactored), K the tangent of `lin`, exactly. */
  private assemble(kScale:number,mScale:number,lin:Float64Array,plastic:boolean):SparseLDL {
    const L=this.ensureLdl(),K=this.keScratch,M=this.B,H=this.H,P=this.P,g=this.grad,V=this.elementVolume,t=this.tets,model=this.model;
    const ve=this.veBranches.length>0&&!this.relaxed?this.viscoelasticScale:1;
    L.begin(this.fixed);
    for(let e=0;e<this.tetCount;e++){
      if(!this.live(e))continue;
      const o=12*e,scale=kScale*V[e];
      for(let c=0;c<12;c++){
        const qc=(c-c%3)/3,i=c%3;H.fill(0);H[3*i]=g[o+3*qc];H[3*i+1]=g[o+3*qc+1];H[3*i+2]=g[o+3*qc+2];
        if(this.avg===0)this.tangent(e,model,lin,plastic);
        else{
          // The element's own part of the averaged nodal pressure tangent (pi_e dG_e); d pi_e G_e is assembled per node below.
          this.tangentElastic(e,model,lin,plastic);this.addVolumeTangent(e,model,lin,0);
          if(ve!==1)for(let q=0;q<9;q++)P[q]*=ve;
        }
        for(let q=0;q<4;q++){const gx=g[o+3*q],gy=g[o+3*q+1],gz=g[o+3*q+2];for(let k=0;k<3;k++)K[12*(3*q+k)+c]=scale*(P[3*k]*gx+P[3*k+1]*gy+P[3*k+2]*gz);}
      }
      for(let qa=0;qa<4;qa++)for(let qb=0;qb<4;qb++){
        const na=t[4*e+qa],nb=t[4*e+qb];if(na>nb)continue;
        for(let p=0;p<3;p++)for(let r=0;r<3;r++)M[3*p+r]=K[12*(3*qa+p)+3*qb+r];
        L.addBlock(na,nb,M);
      }
    }
    if(mScale>0)for(let n=0;n<this.nodeCount;n++)L.addDiagonal(n,mScale*this.nodalMass[n]);
    if(this.avg){
      // sum_n (U''_n / W_n) v_n v_n^T, v_n = sum over the elements e around n of (V_e / 4) d theta_e / d u.
      const nW=this.nW,mark=this.mark,v=this.ringVector,rs=this.ringStart,rn=this.ringNodes,es=this.nodeElementStart,el=this.nodeElements,G=this.G9,nh=model==='neo-hookean';
      for(let n=0;n<this.nodeCount;n++){
        if(!(nW[n]>0))continue;
        const r0=rs[n],r1=rs[n+1];for(let k=r0;k<r1;k++)mark[rn[k]]=k-r0;
        v.fill(0,0,3*(r1-r0));
        for(let k=es[n];k<es[n+1];k++){
          const e=el[k];if(!this.live(e))continue;
          const l=16*e,o=12*e,wq=V[e]/4;
          if(model==='linear'){G.fill(0);G[0]=G[4]=G[8]=1;}
          else if(nh){const kJ=lin[l+10]*lin[l+11];for(let i=0;i<3;i++)for(let j=0;j<3;j++)G[3*i+j]=kJ*lin[l+3*j+i];}
          else for(let q=0;q<9;q++)G[q]=lin[l+q];
          for(let q=0;q<4;q++){
            const m=3*mark[t[4*e+q]],gx=g[o+3*q],gy=g[o+3*q+1],gz=g[o+3*q+2];
            for(let i=0;i<3;i++)v[m+i]+=wq*(G[3*i]*gx+G[3*i+1]*gy+G[3*i+2]*gz);
          }
        }
        const c=kScale*ve*(nh?this.nU2[n]:this.bulkNodal)/nW[n];
        for(let a=r0;a<r1;a++)for(let b=a;b<r1;b++){
          const ia=3*(a-r0),ib=3*(b-r0);
          for(let p=0;p<3;p++)for(let r=0;r<3;r++)M[3*p+r]=c*v[ia+p]*v[ib+r];
          L.addBlock(rn[a],rn[b],M);
        }
        for(let k=r0;k<r1;k++)mark[rn[k]]=-1;
      }
    }
    return L;
  }
  /** Newton's method on the incremental potential, starting from the current displacements. */
  private minimise():void {
    const st=this.stats,linear=this.model==='linear'&&!this.plastic,u=this.u,size=u.length,kScale=1+this.cd*this.stiffnessDamping,mScale=this.cm+this.cd*this.massDamping;
    st.converged=false;st.reason='iteration-limit';st.newtonIterations=0;st.linearIterations=0;
    let phi=this.objective(u,this.g),residual=this.norm(this.g);
    if(!(phi<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted at the start of the solve. Apply the load in more steps or use a smaller time step.');
    // The force scale is the largest seen during this solve, so a solution without stress (a free
    // thermal expansion, a rigid rotation) is still measured against the forces it started from.
    let reference=0;
    for(;;){
      reference=Math.max(reference,this.reference);
      const tolerance=this.forceTolerance+this.tolerance*reference;st.residual=residual;st.reference=reference;
      if(residual<=tolerance){st.converged=true;st.reason='converged';break;}
      if(st.newtonIterations>=this.maxNewton)break;
      st.newtonIterations++;
      let ldl:SparseLDL|null=null;
      if(this.linearSolver==='ldl'){
        if(this.factorDue(kScale,mScale,this.ldlLast)){this.assemble(kScale,mScale,this.lin,this.plastic);this.factorize(kScale,mScale);}
        ldl=this.ldlValid?this.ensureLdl():null;
      }
      const inner=this.conjugateGradient(this.model,this.lin,kScale,mScale,this.g,linear?.1*tolerance:Math.max(.1*tolerance,Math.min(.1,Math.sqrt(residual/reference))*residual),this.plastic,ldl);
      st.linearIterations+=Math.abs(inner);if(this.linearSolver==='ldl')this.innerDone(Math.abs(inner));else this.ldlLast=Math.abs(inner);
      if(inner<0&&linear){st.reason='singular-or-indefinite';break;}
      const x=this.x;let slope=0;for(let j=0;j<size;j++)slope+=this.g[j]*x[j];
      if(!(slope<0)){st.reason='singular-or-indefinite';break;}
      let accepted=false,trialPhi=0,trialResidual=0;
      for(let search=0,t=1;search<(linear?1:48);search++,t*=.5){
        for(let j=0;j<size;j++)this.trial[j]=u[j]+t*x[j];
        trialPhi=this.objective(this.trial,this.gTrial);
        if(!(trialPhi<Infinity))continue;
        trialResidual=this.norm(this.gTrial);
        // Accept a sufficient decrease. Once the change is below the rounding of the energy (relative
        // 1e-10, or 1e-14 mu V, the floor of the finite-strain energies), accept a smaller residual instead.
        if(linear||trialPhi<=phi+1e-4*t*slope||(trialResidual<residual&&Math.abs(trialPhi-phi)<=1e-10*Math.max(Math.abs(phi),Math.abs(trialPhi))+1e-14*this.mu*this.referenceVolume)){accepted=true;break;}
      }
      if(!accepted){st.reason='line-search';break;}
      if(!Number.isFinite(trialPhi)||!Number.isFinite(trialResidual))throw new EngineError('NUMERICAL_FAILURE','The solid solve produced a nonfinite state.');
      u.set(this.trial);const swap=this.g;this.g=this.gTrial;this.gTrial=swap;phi=trialPhi;residual=trialResidual;
    }
  }
  private applyConstraints(scale:number):void {for(let j=0;j<this.u.length;j++)if(this.fixed[j]){this.u[j]=scale*this.prescribed[j];this.v[j]=0;}}

  /** Static equilibrium under the current constraints and loads. The solution becomes the body's
   * state, at rest. With `loadSteps` above one, loads, prescribed displacements and the temperature
   * change are raised in equal increments, which the nonlinear models need for large deformation. */
  solveStatic(options:{loadSteps?:number}={}):SolidStaticResult {
    const o=record(options,'static options');onlyKeys(o,['loadSteps'],'static options');
    const loadSteps=o.loadSteps===undefined?1:integer(o.loadSteps,'loadSteps',1,10000);let newton=0,inner=0;
    this.v.fill(0);this.cm=0;this.cd=0;this.referenceInertia=0;this.accelerationValid=false;this.relaxed=true;
    try{
      for(let step=1;step<=loadSteps;step++){
        this.loadScale=step/loadSteps;this.assembleLoads();this.applyConstraints(this.loadScale);this.minimise();
        newton+=this.stats.newtonIterations;inner+=this.stats.linearIterations;
        if(this.plastic)this.commitPlastic();
        if(!this.stats.converged)break;
      }
    }finally{this.loadScale=1;this.relaxed=false;}
    // A statically loaded body is fully relaxed: no overstress remains, and later steps start from this stress.
    if(this.veBranches.length){this.veHist.fill(0);this.commitViscous(this.u,true);}
    return {...this.stats,newtonIterations:newton,linearIterations:inner,loadSteps,displacements:this.u.slice(),reactions:this.reactions(),strainEnergy:this.strainEnergy()};
  }

  /** Advances `count` time steps with the configured integrator. The implicit steps allocate nothing.
   * Backward Euler: M (v1 - v0) / h = f(u1) - C v1, u1 = u0 + h v1. Midpoint: the same equations at
   * the half step, then u1 = 2 u_mid - u0 and v1 = 2 v_mid - v0. Explicit: velocity Verlet. */
  step(count=1):void {
    const steps=integer(count,'count',0,1_000_000),h=this.dt,size=this.u.length,u=this.u,v=this.v;
    this.loadScale=1;this.assembleLoads();this.applyConstraints(1);
    for(let s=0;s<steps;s++){
      if(this.integrator==='explicit'){
        const a=this.acceleration;if(!this.accelerationValid){this.accelerate();this.accelerationValid=true;}
        for(let j=0;j<size;j++)if(!this.fixed[j]){v[j]+=.5*h*a[j];u[j]+=h*v[j];}
        this.accelerate();
        for(let j=0;j<size;j++)if(!this.fixed[j])v[j]+=.5*h*a[j];
        if(this.plastic&&this.commitPlastic()>0)this.accelerationValid=false;
      }else{
        const tau=this.integrator==='midpoint'?.5*h:h,damped=this.massDamping>0||this.stiffnessDamping>0;let inertia=0;
        this.cm=1/(tau*tau);this.cd=damped?1/tau:0;
        for(let j=0;j<size;j++){this.u0[j]=u[j];this.target[j]=u[j]+tau*v[j];const mv=this.cm*this.nodalMass[(j-j%3)/3]*tau*v[j];inertia+=mv*mv;}
        this.referenceInertia=Math.sqrt(inertia);
        if(this.linOld.length>0){if(!(this.elastic(u,null,this.lin)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');this.linOld.set(this.lin);this.nU2Old.set(this.nU2);}
        this.minimise();if(!this.stats.converged)this.unconverged++;
        this.commitViscous(u);
        if(this.integrator==='midpoint')for(let j=0;j<size;j++){const mid=(u[j]-this.u0[j])/tau;u[j]=2*u[j]-this.u0[j];v[j]=2*mid-v[j];}
        else for(let j=0;j<size;j++)v[j]=(u[j]-this.u0[j])/h;
        if(this.plastic)this.commitPlastic();
      }
      for(let j=0;j<size;j++)if(!Number.isFinite(u[j])||!Number.isFinite(v[j]))throw new EngineError('NUMERICAL_FAILURE','The solid step produced a nonfinite state.');
      this.steps++;
    }
  }
  /** a = M^-1 (f_ext - f_int(u) - C v) on the free components, for the explicit integrator. */
  private accelerate():void {
    const a=this.acceleration,beta=this.stiffnessDamping,alpha=this.massDamping;
    if(!(this.elastic(this.u,this.fint,beta>0&&this.lin.length?this.lin:null)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element inverted during explicit integration. Use a smaller time step or an implicit integrator.');
    if(beta>0)this.stiffness(this.model,this.lin,this.v,this.work);
    for(let j=0;j<a.length;j++){const m=this.nodalMass[(j-j%3)/3];a[j]=this.fixed[j]?0:(this.fext[j]-this.fint[j]-(beta>0?beta*this.work[j]:0))/m-alpha*this.v[j];}
  }
  /** Stability limit of the explicit integrator. omega_max is bounded by the largest natural frequency
   * of any single element with its own lumped mass (found by power iteration on the reference
   * stiffness), which never underestimates the frequency of the assembled mesh. With Rayleigh damping
   * ratio xi at omega_max the limit is (2 / omega_max) (sqrt(1 + xi^2) - xi). */
  explicitLimit():SolidExplicitLimit {
    if(this.limit)return this.limit;
    // The bound uses the tet4 element with the full lambda: the averaged element's energy is never above it (Jensen), so the bound holds.
    const keep=this.elemLambda;this.elemLambda=this.lambda;
    try{return this.explicitBound();}finally{this.elemLambda=keep;}
  }
  private explicitBound():SolidExplicitLimit {
    const x=new Float64Array(12),y=new Float64Array(12),g=this.grad,H=this.H,P=this.P;let largest=0,altitude=Infinity;
    for(let e=0;e<this.tetCount;e++){
      const o=12*e,V=this.elementVolume[e];let value=0;
      for(let k=0;k<12;k++)x[k]=Math.sin(1+2.3*k);
      for(let q=0;q<4;q++)altitude=Math.min(altitude,1/Math.hypot(g[o+3*q],g[o+3*q+1],g[o+3*q+2]));
      for(let iteration=0;iteration<60;iteration++){
        H.fill(0);
        for(let q=0;q<4;q++)for(let i=0;i<3;i++)for(let j=0;j<3;j++)H[3*i+j]+=x[3*q+i]*g[o+3*q+j];
        this.tangent(e,'linear',this.lin);let xy=0,xx=0,yy=0;
        for(let q=0;q<4;q++)for(let i=0;i<3;i++){const f=V*(P[3*i]*g[o+3*q]+P[3*i+1]*g[o+3*q+1]+P[3*i+2]*g[o+3*q+2]);y[3*q+i]=f;xy+=x[3*q+i]*f;xx+=x[3*q+i]*x[3*q+i];yy+=f*f;}
        value=xy/xx;const scale=1/Math.sqrt(yy);for(let k=0;k<12;k++)x[k]=y[k]*scale;
      }
      // The element mass matrix is (rho V / 4) I; 1% covers the power iteration's approach from below.
      largest=Math.max(largest,1.01*value*4/(this.material.density*V));
    }
    const omega=Math.sqrt(largest),xi=.5*(this.massDamping/omega+this.stiffnessDamping*omega),criticalTimeStep=2/omega*(Math.sqrt(1+xi*xi)-xi),waveSpeed=Math.sqrt((this.lambda+2*this.mu)/this.material.density);
    return this.limit=Object.freeze({criticalTimeStep,waveSpeed,minAltitude:altitude,courant:waveSpeed*criticalTimeStep/altitude});
  }
  /** Lowest natural frequency and mode shape of the constrained body about its reference state, by
   * inverse iteration with the linear stiffness and the lumped mass. The state is not changed. */
  fundamentalMode(options:{maxIterations?:number;tolerance?:number}={}):SolidMode {
    const o=record(options,'mode options');onlyKeys(o,['maxIterations','tolerance'],'mode options');
    const limit=o.maxIterations===undefined?200:integer(o.maxIterations,'maxIterations',1,10000),tolerance=o.tolerance===undefined?1e-10:finite(o.tolerance,'tolerance',1e-14,1e-2),size=this.u.length;
    const shape=new Float64Array(size),load=new Float64Array(size);let lambda=0,iterations=0,converged=false;
    for(let j=0;j<size;j++)shape[j]=this.fixed[j]?0:1+.5*Math.sin(1.7*j);
    for(;iterations<limit;){
      let norm=0;for(let j=0;j<size;j++){const m=this.nodalMass[(j-j%3)/3];norm+=m*shape[j]*shape[j];}
      norm=1/Math.sqrt(norm);
      // Solve K y = M x; conjugateGradient solves for the negated right-hand side.
      for(let j=0;j<size;j++){shape[j]*=norm;load[j]=-this.nodalMass[(j-j%3)/3]*shape[j];}
      if(this.conjugateGradient('linear',this.lin,1,0,load,1e-12*this.norm(load))<0)throw new EngineError('NUMERICAL_FAILURE','The stiffness is singular: constrain the rigid-body motions before asking for a mode.');
      let numerator=0,denominator=0;
      for(let j=0;j<size;j++){const y=this.x[j],m=this.nodalMass[(j-j%3)/3];numerator-=y*load[j];denominator+=m*y*y;shape[j]=y;}
      const next=numerator/denominator;iterations++;
      if(Math.abs(next-lambda)<=tolerance*next){lambda=next;converged=true;break;}
      lambda=next;
    }
    let peak=0;for(let j=0;j<size;j++)peak=Math.max(peak,Math.abs(shape[j]));
    for(let j=0;j<size;j++)shape[j]/=peak;
    const angularFrequency=Math.sqrt(lambda);
    return {angularFrequency,frequency:angularFrequency/(2*Math.PI),shape,iterations,converged};
  }

  // ---- Access for a coupled solve ----

  /** Low-level access for a solver that advances this body together with something else
   * (solid-contact.ts adds contact springs and rigid bodies to the same Newton iteration).
   * The element mechanics are this body's own; nothing here changes how `step` or
   * `solveStatic` behave. */
  kernel():SolidKernel {
    const self=this;
    return {
      fixed:this.fixed,prescribed:this.prescribed,stiffnessDiagonal:this.kDiagonal,
      massDamping:this.massDamping,stiffnessDamping:this.stiffnessDamping,tolerance:this.tolerance,forceTolerance:this.forceTolerance,
      maxNewtonIterations:this.maxNewton,maxLinearIterations:this.maxLinear,gravity:this.gravity,
      loads(){self.loadScale=1;self.assembleLoads();return self.fext;},
      applyConstraints(){self.applyConstraints(1);},
      energy(u,fint,store){return self.elastic(u,fint,store&&self.lin.length?self.lin:null);},
      tangentProduct(x,out){self.stiffness(self.model,self.lin,x,out,self.plastic);},
      holdDampingTangent(){
        if(self.linOld.length===0)return;
        if(!(self.elastic(self.u,null,self.lin)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');
        self.linOld.set(self.lin);self.nU2Old.set(self.nU2);
      },
      dampingProduct(x,out){self.stiffness(self.model,self.linOld,x,out);},
      advance(converged){self.steps++;if(!converged)self.unconverged++;self.accelerationValid=false;self.commitViscous(self.u);if(self.plastic)self.commitPlastic();},
      commit(){if(self.plastic)self.commitPlastic();},
      linearSolver:this.linearSolver,
      assembleTangent(kScale,mScale){return self.assemble(kScale,mScale,self.lin,self.plastic);},
      factorDue(kScale,mScale){return self.factorDue(kScale,mScale,self.ldlLast);},
      innerDone(iterations){self.innerDone(iterations);},
      factorize(kScale,mScale){self.factorize(kScale,mScale);},
      factorization(){return self.linearSolver==='ldl'&&self.ldlValid?self.ensureLdl():null;},
    };
  }

  // ---- Outputs ----

  /** Elastic strain energy, J. */
  strainEnergy():number {
    const relaxed=this.relaxed;this.relaxed=true;this.storedOnly=true;let energy:number;
    try{energy=this.elastic(this.u,null,null);}finally{this.relaxed=relaxed;this.storedOnly=false;}
    if(!(energy<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');return energy;
  }
  /** Kinetic energy with the lumped mass, J. */
  kineticEnergy():number {let s=0;for(let j=0;j<this.v.length;j++)s+=this.nodalMass[(j-j%3)/3]*this.v[j]*this.v[j];return .5*s;}
  /** Potential of the dead loads, J: minus the work of nodal forces, surface loads and gravity. */
  loadPotential():number {this.assembleLoads();let s=0;for(let j=0;j<this.u.length;j++)s-=this.fext[j]*this.u[j];return s;}
  /** Current volume, m^3. */
  volume():number {
    const p=this.positions();let total=0;
    for(let e=0;e<this.tetCount;e++)total+=tetVolume(p,this.tets[4*e],this.tets[4*e+1],this.tets[4*e+2],this.tets[4*e+3]);
    return total;
  }
  /** Forces the constraints put on the body, N: internal plus damping minus external force on each
   * constrained component of the current state, zero elsewhere. They do not include inertia. */
  reactions(out=new Float64Array(this.u.length)):Float64Array {
    const beta=this.stiffnessDamping;this.assembleLoads();
    if(!(this.elastic(this.u,this.fint,beta>0&&this.lin.length?this.lin:null)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');
    if(beta>0)this.stiffness(this.model,this.lin,this.v,this.work);
    for(let j=0;j<out.length;j++)out[j]=this.fixed[j]?zero(this.fint[j]-this.fext[j]+(beta>0?beta*this.work[j]:0)):0;
    return out;
  }
  /** Cauchy stress per element, Pa, as [xx, yy, zz, yz, xz, xy]. The linear model reports
   * lambda tr(eps) I + 2 mu eps; the other models report P F^T / det F. */
  stresses(out=new Float64Array(6*this.tetCount)):Float64Array {this.tensors(out,null);return out;}
  /** Strain per element as [xx, yy, zz, yz, xz, xy] (tensor shear components, half the engineering
   * shear). Linear model: the small strain. Other models: the Biot strain V - I in the current frame,
   * whose principal values are the stretches minus one. Thermal strain is included. */
  strains(out=new Float64Array(6*this.tetCount)):Float64Array {this.tensors(null,out);return out;}
  private tensors(stress:Float64Array|null,strain:Float64Array|null):void {
    this.reporting=true;try{this.tensorsNow(stress,strain);}finally{this.reporting=false;}
  }
  private tensorsNow(stress:Float64Array|null,strain:Float64Array|null):void {
    const H=this.H,P=this.P,F=this.F,R=this.R;
    if(this.avg&&!(this.elastic(this.u,null,null)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');
    for(let e=0;e<this.tetCount;e++){
      const o=6*e;this.gradient(e,this.u);
      if(this.avg){
        // The averaged passes leave each element's elastic stress in eP; add the viscoelastic overstress as piola() does.
        if(!this.live(e))P.fill(0);else for(let q=0;q<9;q++)P[q]=this.eP[9*e+q];
        if(this.veBranches.length&&!this.relaxed){const nb=this.veBranches.length;for(let i=0;i<nb;i++){const h=9*(nb*e+i);for(let q=0;q<9;q++)P[q]+=this.veHist[h+q];}}
      }else if(!(this.piola(e,null)<Infinity))throw new EngineError('NUMERICAL_FAILURE',`Element ${e} is inverted.`);
      if(this.model==='linear'){
        if(stress){stress[o]=P[0];stress[o+1]=P[4];stress[o+2]=P[8];stress[o+3]=P[5];stress[o+4]=P[2];stress[o+5]=P[1];}
        if(strain){strain[o]=H[0];strain[o+1]=H[4];strain[o+2]=H[8];strain[o+3]=.5*(H[5]+H[7]);strain[o+4]=.5*(H[2]+H[6]);strain[o+5]=.5*(H[1]+H[3]);}
        continue;
      }
      // piola() uses F as scratch; rebuild F = I + H.
      F[0]=1+H[0];F[1]=H[1];F[2]=H[2];F[3]=H[3];F[4]=1+H[4];F[5]=H[5];F[6]=H[6];F[7]=H[7];F[8]=1+H[8];
      if(stress){
        const J=F[0]*(F[4]*F[8]-F[5]*F[7])+F[1]*(F[5]*F[6]-F[3]*F[8])+F[2]*(F[3]*F[7]-F[4]*F[6]);
        const s=(i:number,j:number)=>(P[3*i]*F[3*j]+P[3*i+1]*F[3*j+1]+P[3*i+2]*F[3*j+2])/J;
        stress[o]=s(0,0);stress[o+1]=s(1,1);stress[o+2]=s(2,2);stress[o+3]=.5*(s(1,2)+s(2,1));stress[o+4]=.5*(s(0,2)+s(2,0));stress[o+5]=.5*(s(0,1)+s(1,0));
      }
      if(strain){
        polarRotation(F,R);
        const b=(i:number,j:number)=>F[3*i]*R[3*j]+F[3*i+1]*R[3*j+1]+F[3*i+2]*R[3*j+2];
        strain[o]=b(0,0)-1;strain[o+1]=b(1,1)-1;strain[o+2]=b(2,2)-1;strain[o+3]=.5*(b(1,2)+b(2,1));strain[o+4]=.5*(b(0,2)+b(2,0));strain[o+5]=.5*(b(0,1)+b(1,0));
      }
    }
  }
  /** Commits the plastic state of the present displacements and erodes the elements whose equivalent
   * plastic strain reached `failureStrain`. Returns the number of elements eroded now. */
  private commitPlastic():number {
    const limit=this.material.failureStrain;let eroded=0;
    this.storeMode=2;
    try{
      if(this.avg){
        // The averaged element commits every element in one pass of its energy, then erodes.
        if(!(this.elastic(this.u,null,null)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');
        this.storeMode=0;const law=this.concreteLaw;
        for(let e=0;e<this.tetCount;e++)if(!this.eroded[e]&&(law?this.alpha[e]>=law.kappaCrushed||this.kappaT[e]>=law.kappaErode:this.alpha[e]>=limit)){this.eroded[e]=1;eroded++;}
      }else for(let e=0;e<this.tetCount;e++){
        if(this.eroded[e])continue;
        this.gradient(e,this.u);
        if(!(this.piola(e,null)<Infinity))throw new EngineError('NUMERICAL_FAILURE',`Element ${e} is inverted.`);
        const law=this.concreteLaw;
        if(law?this.alpha[e]>=law.kappaCrushed||this.kappaT[e]>=law.kappaErode:this.alpha[e]>=limit){this.eroded[e]=1;eroded++;}
      }
    }finally{this.storeMode=0;}
    this.erodedTotal+=eroded;if(eroded>0&&this.concreteLaw)this.liveStiffnessDiagonal();return eroded;
  }
  /** Concrete: the diagonal of the reference stiffness from the elements still present (the preconditioner of both
   * solvers). A node left in no element keeps 1e-9 of its first value, so that a static preconditioner never divides by zero. */
  private liveStiffnessDiagonal():void {
    const kd=this.kDiagonal,g=this.grad,t=this.tets,first=this.kDiagonalFirst??(this.kDiagonalFirst=kd.slice());kd.fill(0);
    for(let e=0;e<this.tetCount;e++){
      if(this.eroded[e])continue;const o=12*e,V=this.elementVolume[e];
      for(let q=0;q<4;q++){const gx=g[o+3*q],gy=g[o+3*q+1],gz=g[o+3*q+2],g2=gx*gx+gy*gy+gz*gz,n=t[4*e+q];
        kd[3*n]+=V*(this.mu*g2+(this.lambda+this.mu)*gx*gx);kd[3*n+1]+=V*(this.mu*g2+(this.lambda+this.mu)*gy*gy);kd[3*n+2]+=V*(this.mu*g2+(this.lambda+this.mu)*gz*gz);}
    }
    for(let j=0;j<kd.length;j++)if(!(kd[j]>1e-9*first[j]))kd[j]=1e-9*first[j];
  }
  /** Concrete: remove elements now (for example pieces that hang on by an edge or a node and carry nothing). They stop
   * carrying stress at once; the change counts in `erodedCount`. */
  erode(elements:ArrayLike<number>):void {
    if(!this.concreteLaw)throw new EngineError('INVALID_PAYLOAD','Only a solid with a concrete law erodes elements on request.');
    let n=0;for(const e of indices(Array.from(elements),this.tetCount,'elements'))if(!this.eroded[e]){this.eroded[e]=1;n++;}
    if(n>0){this.erodedTotal+=n;this.liveStiffnessDiagonal();this.accelerationValid=false;}
  }
  /** Equivalent plastic strain p per element (committed state); zeros for an elastic body. */
  equivalentPlasticStrain(out=new Float64Array(this.tetCount)):Float64Array {if(this.plastic)out.set(this.alpha);else out.fill(0);return out;}
  /** Plastic strain per element [xx, yy, zz, yz, xz, xy] (tensor shear; committed state). Corotational: in the
   * element's unrotated frame. Zeros for an elastic body. */
  plasticStrains(out=new Float64Array(6*this.tetCount)):Float64Array {if(this.plastic)out.set(this.ep);else out.fill(0);return out;}
  /** Plastic work dissipated (plus stored in hardening) since construction or `reset`, J: sum of V sigma_y dp. */
  get plasticWork():number {return this.plasticWorkTotal;}
  /** Concrete: strength lost per element, 0 to 1 (1 - k / k_peak after the compressive peak, 1 - f_t / f_t0 in tension,
   * the larger; 1 when eroded). Zeros without a concrete law. */
  damage(out=new Float64Array(this.tetCount)):Float64Array {
    const law=this.concreteLaw;if(!law){out.fill(0);return out;}
    for(let e=0;e<this.tetCount;e++)out[e]=this.eroded[e]?1:concreteDamage(law,this.alpha[e],this.kappaT[e]);return out;
  }
  /** Concrete: scale the strengths (and with them the fracture energies) of each element by a factor, e.g. to seed
   * localisation or to give a specimen a scatter of strength. One factor per element, 0.05 to 20. Default 1. */
  setStrengthFactors(factors:ArrayLike<number>):void {
    if(!this.concreteLaw)throw new EngineError('INVALID_PAYLOAD','Strength factors need a concrete law.');
    this.strengthFactor.set(numbers(Array.from(factors),this.tetCount,'strength factors',.05,20));
  }
  /** Concrete: crack opening per element, kappa_t times the band width, m (committed state). */
  crackOpening(out=new Float64Array(this.tetCount)):Float64Array {
    const law=this.concreteLaw;if(!law){out.fill(0);return out;}
    for(let e=0;e<this.tetCount;e++)out[e]=this.kappaT[e]*law.bandWidth;return out;
  }
  /** Concrete: the compressive hardening variable kappa_c and the strength k(kappa_c) left, Pa (Drucker-Prager units). */
  compressiveStrengthLeft(e:number):number {const law=this.concreteLaw;return law?tableValue(law.kx,law.ky,this.alpha[e]):NaN;}
  /** Number of eroded elements. */
  get erodedCount():number {return this.erodedTotal;}
  /** 1 per eroded element (live, read only). Empty for an elastic body. */
  get erodedMask():Uint8Array {return this.eroded;}
  /** Von Mises stress per element, Pa. */
  vonMises(out=new Float64Array(this.tetCount)):Float64Array {
    const s=this.stresses();for(let e=0;e<this.tetCount;e++)out[e]=vonMisesStress(s,6*e);return out;
  }
  /** Principal stresses per element, Pa, largest first (three per element). */
  principalStresses(out=new Float64Array(3*this.tetCount)):Float64Array {
    const s=this.stresses();for(let e=0;e<this.tetCount;e++)symmetricEigenvalues(s,6*e,out,3*e);return out;
  }
  /** Elements whose stress measure is above `strength` (Pa) in the current state: the largest principal
   * stress (`max-principal`, a brittle tensile check) or the von Mises stress (`von-mises`, a yield check).
   * This is post-processing: the material does not yield, soften or crack. */
  failedElements(options:{criterion:SolidFailureCriterion;strength:number}):Uint32Array {
    const o=record(options,'failure options');onlyKeys(o,['criterion','strength'],'failure options');
    if(o.criterion!=='max-principal'&&o.criterion!=='von-mises')throw new EngineError('INVALID_PAYLOAD','Unknown failure criterion.');
    const strength=finite(o.strength,'strength',0,1e15),s=this.stresses(),principal=[0,0,0],failed:number[]=[];
    for(let e=0;e<this.tetCount;e++){
      let value:number;
      if(o.criterion==='von-mises')value=vonMisesStress(s,6*e);else{symmetricEigenvalues(s,6*e,principal,0);value=principal[0];}
      if(value>strength)failed.push(e);
    }
    return Uint32Array.from(failed);
  }
}
