import {EngineError,finite,integer,onlyKeys,record} from './contracts.ts';
import {captureFields,restoreFields,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';
import {boundaryFaces,tetVolume,SOLID_MAX_NODES,SOLID_MAX_TETS,type TetMesh} from './solid-mesh.ts';
export {boxMesh,boxNode,boundaryFaces,tetVolume,SOLID_MAX_NODES,SOLID_MAX_TETS,type TetMesh,type BoxMeshOptions} from './solid-mesh.ts';

export const SOLID_SOLVER_ID='solid-tet-corot-js-f64-v1';
/** `linear`: small-strain Hooke. `corotational`: Hooke on the stretch left after removing each
 * element's rotation. `neo-hookean`: compressible Neo-Hookean rubber. */
export type SolidModel='linear'|'corotational'|'neo-hookean';
export type SolidIntegrator='backward-euler'|'midpoint'|'explicit';
export interface SolidMaterial {
  /** Young's modulus E in Pa. */
  youngModulus:number;
  /** Poisson's ratio, from -0.99 to 0.4999. Linear tetrahedra lock as it nears 0.5. */
  poissonRatio:number;
  /** Mass density in kg/m^3. */
  density:number;
  /** Linear thermal expansion coefficient in 1/K. Default 0. */
  thermalExpansion?:number;
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
  /** Counts one time step taken by the outside solver. */
  advance(converged:boolean):void;
}

const MIN_J=1e-6;
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
 * No contact, no plasticity and no crack growth. See docs/SOLID_MECHANICS.md.
 */
/** What an exact checkpoint of a SolidBody holds: every field it has (displacements, velocities, loads, constraints, the
 * integrator's history and the corotational frames). */
const SOLID_FIELDS:FieldOptions={label:'SolidBody'};

export class SolidBody {
  /** Everything a later step reads, as a state tree (checkpoint.ts), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,SOLID_FIELDS);}
  /** Put back a state from `saveState()` of a solid with the same mesh, material and settings. */
  restoreState(state:StateValue):void {restoreFields(this,state,SOLID_FIELDS);}

  readonly solver=SOLID_SOLVER_ID;
  readonly model:SolidModel;readonly integrator:SolidIntegrator;readonly dt:number;
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
  readonly material:Readonly<Required<SolidMaterial>>;
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
  private cm=0;private cd=0;private reference=0;private referenceInertia=0;private loadScale=1;private accelerationValid=false;private steps=0;private unconverged=0;private limit:SolidExplicitLimit|null=null;

  constructor(input:SolidDefinition){
    const d=record(input,'definition');onlyKeys(d,['mesh','material','config'],'definition');
    const mesh=record(d.mesh,'mesh');onlyKeys(mesh,['positions','tets'],'mesh');
    const nodeCount=integer((mesh.positions as ArrayLike<number>)?.length/3,'node count',4,SOLID_MAX_NODES),tetCount=integer((mesh.tets as ArrayLike<number>)?.length/4,'element count',1,SOLID_MAX_TETS),size=3*nodeCount;
    this.nodeCount=nodeCount;this.tetCount=tetCount;
    const X=this.referencePositions=numbers(mesh.positions,size,'positions',-1e6,1e6),tets=this.tets=indices(mesh.tets,nodeCount,'tets');
    const m=record(d.material,'material');onlyKeys(m,['youngModulus','poissonRatio','density','thermalExpansion'],'material');
    const E=finite(m.youngModulus,'youngModulus',1,1e13),nu=finite(m.poissonRatio,'poissonRatio',-.99,.4999),rho=finite(m.density,'density',1e-6,1e6);
    this.material=Object.freeze({youngModulus:E,poissonRatio:nu,density:rho,thermalExpansion:m.thermalExpansion===undefined?0:finite(m.thermalExpansion,'thermalExpansion',-1e-2,1e-2)});
    this.lambda=E*nu/((1+nu)*(1-2*nu));this.mu=E/(2*(1+nu));
    const c=d.config===undefined?{}:record(d.config,'config');onlyKeys(c,['model','dt','integrator','massDamping','stiffnessDamping','gravity','tolerance','forceTolerance','maxNewtonIterations','maxLinearIterations','explicitSafety'],'config');
    const model=c.model===undefined?'corotational':c.model,integrator=c.integrator===undefined?'backward-euler':c.integrator;
    if(model!=='linear'&&model!=='corotational'&&model!=='neo-hookean')throw new EngineError('INVALID_PAYLOAD','Unknown solid model.');
    if(integrator!=='backward-euler'&&integrator!=='midpoint'&&integrator!=='explicit')throw new EngineError('INVALID_PAYLOAD','Unknown solid integrator.');
    this.model=model;this.integrator=integrator;this.dt=c.dt===undefined?1/240:finite(c.dt,'dt',1e-12,10);
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
    const stride=model==='linear'?0:16;this.lin=new Float64Array(stride*tetCount);this.linOld=new Float64Array(this.stiffnessDamping>0?stride*tetCount:0);
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
  reset():void {this.u.fill(0);this.v.fill(0);this.steps=0;this.unconverged=0;this.accelerationValid=false;}
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
    const H=this.H,P=this.P,mu=this.mu,la=this.lambda,th=this.loadScale*this.theta[e];
    if(this.model==='linear'){
      const exx=H[0]-th,eyy=H[4]-th,ezz=H[8]-th,exy=.5*(H[1]+H[3]),exz=.5*(H[2]+H[6]),eyz=.5*(H[5]+H[7]),tr=exx+eyy+ezz;
      P[0]=2*mu*exx+la*tr;P[4]=2*mu*eyy+la*tr;P[8]=2*mu*ezz+la*tr;P[1]=P[3]=2*mu*exy;P[2]=P[6]=2*mu*exz;P[5]=P[7]=2*mu*eyz;
      return mu*(exx*exx+eyy*eyy+ezz*ezz+2*(exy*exy+exz*exz+eyz*eyz))+.5*la*tr*tr;
    }
    // Strains are formed from H, not from F - I, so that small strains keep full relative precision.
    const F=this.F,R=this.R,o=16*e;
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
    // W = mu/2 (|Fe|^2 - 3) - mu ln J + lambda/2 ln^2 J, with |Fe|^2 - 3 = 2 tr He + |He|^2.
    return mu*(.5*norm+(F[0]+F[4]+F[8]-J1)-(logJ-J1))+.5*la*logJ*logJ;
  }
  /** Tangent of the first Piola-Kirchhoff stress of element e: dH in H, dP out in P. */
  private tangent(e:number,model:SolidModel,lin:Float64Array):void {
    const H=this.H,P=this.P,mu=this.mu,la=this.lambda,o=16*e;
    if(model==='linear'){
      const tr=la*(H[0]+H[4]+H[8]),xy=mu*(H[1]+H[3]),xz=mu*(H[2]+H[6]),yz=mu*(H[5]+H[7]);
      P[0]=2*mu*H[0]+tr;P[4]=2*mu*H[4]+tr;P[8]=2*mu*H[8]+tr;P[1]=P[3]=xy;P[2]=P[6]=xz;P[5]=P[7]=yz;return;
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
    let energy=0;if(fint)fint.fill(0);
    for(let e=0;e<this.tetCount;e++){
      this.gradient(e,u);const w=this.piola(e,lin);
      if(!(w<Infinity))return Infinity;
      energy+=this.elementVolume[e]*w;if(fint)this.scatter(e,fint);
    }
    return energy;
  }
  /** out = K x with the tangent stiffness of `model` linearised with `lin`. */
  private stiffness(model:SolidModel,lin:Float64Array,x:Float64Array,out:Float64Array):void {
    out.fill(0);
    for(let e=0;e<this.tetCount;e++){this.gradient(e,x);this.tangent(e,model,lin);this.scatter(e,out);}
  }

  // ---- Solver ----

  private norm(a:Float64Array):number {let s=0;for(let j=0;j<a.length;j++)s+=a[j]*a[j];return Math.sqrt(s);}
  /** Incremental potential at u and its gradient on the free components. */
  private objective(u:Float64Array,g:Float64Array):number {
    const fint=this.fint,fext=this.fext,size=u.length,cm=this.cm,cd=this.cd,alpha=this.massDamping,beta=this.stiffnessDamping;
    let phi=this.elastic(u,fint,this.model==='linear'?null:this.lin),internal=0,external=0;
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
  private conjugateGradient(model:SolidModel,lin:Float64Array,kScale:number,mScale:number,g:Float64Array,target:number):number {
    const {x,r,z,p,ap,fixed,kDiagonal,nodalMass}=this,size=x.length;let rz=0,iterations=0;
    for(let j=0;j<size;j++){x[j]=0;r[j]=fixed[j]?0:-g[j];z[j]=p[j]=r[j]/(kScale*kDiagonal[j]+mScale*nodalMass[(j-j%3)/3]);rz+=r[j]*z[j];}
    while(iterations<this.maxLinear&&this.norm(r)>target){
      this.stiffness(model,lin,p,ap);let curvature=0;
      for(let j=0;j<size;j++){ap[j]=fixed[j]?0:kScale*ap[j]+mScale*nodalMass[(j-j%3)/3]*p[j];curvature+=p[j]*ap[j];}
      if(!(curvature>0)||!Number.isFinite(curvature)){if(iterations===0)x.set(z);return -iterations-1;}
      const step=rz/curvature;let next=0;
      for(let j=0;j<size;j++){x[j]+=step*p[j];r[j]-=step*ap[j];z[j]=r[j]/(kScale*kDiagonal[j]+mScale*nodalMass[(j-j%3)/3]);next+=r[j]*z[j];}
      const ratio=next/rz;rz=next;iterations++;
      for(let j=0;j<size;j++)p[j]=z[j]+ratio*p[j];
    }
    return iterations;
  }
  /** Newton's method on the incremental potential, starting from the current displacements. */
  private minimise():void {
    const st=this.stats,linear=this.model==='linear',u=this.u,size=u.length,kScale=1+this.cd*this.stiffnessDamping,mScale=this.cm+this.cd*this.massDamping;
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
      const inner=this.conjugateGradient(this.model,this.lin,kScale,mScale,this.g,linear?.1*tolerance:Math.max(.1*tolerance,Math.min(.1,Math.sqrt(residual/reference))*residual));
      st.linearIterations+=Math.abs(inner);
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
    this.v.fill(0);this.cm=0;this.cd=0;this.referenceInertia=0;this.accelerationValid=false;
    try{
      for(let step=1;step<=loadSteps;step++){
        this.loadScale=step/loadSteps;this.assembleLoads();this.applyConstraints(this.loadScale);this.minimise();
        newton+=this.stats.newtonIterations;inner+=this.stats.linearIterations;
        if(!this.stats.converged)break;
      }
    }finally{this.loadScale=1;}
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
      }else{
        const tau=this.integrator==='midpoint'?.5*h:h,damped=this.massDamping>0||this.stiffnessDamping>0;let inertia=0;
        this.cm=1/(tau*tau);this.cd=damped?1/tau:0;
        for(let j=0;j<size;j++){this.u0[j]=u[j];this.target[j]=u[j]+tau*v[j];const mv=this.cm*this.nodalMass[(j-j%3)/3]*tau*v[j];inertia+=mv*mv;}
        this.referenceInertia=Math.sqrt(inertia);
        if(this.linOld.length>0){if(!(this.elastic(u,null,this.lin)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');this.linOld.set(this.lin);}
        this.minimise();if(!this.stats.converged)this.unconverged++;
        if(this.integrator==='midpoint')for(let j=0;j<size;j++){const mid=(u[j]-this.u0[j])/tau;u[j]=2*u[j]-this.u0[j];v[j]=2*mid-v[j];}
        else for(let j=0;j<size;j++)v[j]=(u[j]-this.u0[j])/h;
      }
      for(let j=0;j<size;j++)if(!Number.isFinite(u[j])||!Number.isFinite(v[j]))throw new EngineError('NUMERICAL_FAILURE','The solid step produced a nonfinite state.');
      this.steps++;
    }
  }
  /** a = M^-1 (f_ext - f_int(u) - C v) on the free components, for the explicit integrator. */
  private accelerate():void {
    const a=this.acceleration,beta=this.stiffnessDamping,alpha=this.massDamping;
    if(!(this.elastic(this.u,this.fint,beta>0&&this.model!=='linear'?this.lin:null)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element inverted during explicit integration. Use a smaller time step or an implicit integrator.');
    if(beta>0)this.stiffness(this.model,this.lin,this.v,this.work);
    for(let j=0;j<a.length;j++){const m=this.nodalMass[(j-j%3)/3];a[j]=this.fixed[j]?0:(this.fext[j]-this.fint[j]-(beta>0?beta*this.work[j]:0))/m-alpha*this.v[j];}
  }
  /** Stability limit of the explicit integrator. omega_max is bounded by the largest natural frequency
   * of any single element with its own lumped mass (found by power iteration on the reference
   * stiffness), which never underestimates the frequency of the assembled mesh. With Rayleigh damping
   * ratio xi at omega_max the limit is (2 / omega_max) (sqrt(1 + xi^2) - xi). */
  explicitLimit():SolidExplicitLimit {
    if(this.limit)return this.limit;
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
      energy(u,fint,store){return self.elastic(u,fint,store&&self.model!=='linear'?self.lin:null);},
      tangentProduct(x,out){self.stiffness(self.model,self.lin,x,out);},
      holdDampingTangent(){
        if(self.linOld.length===0)return;
        if(!(self.elastic(self.u,null,self.lin)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');
        self.linOld.set(self.lin);
      },
      dampingProduct(x,out){self.stiffness(self.model,self.linOld,x,out);},
      advance(converged){self.steps++;if(!converged)self.unconverged++;self.accelerationValid=false;},
    };
  }

  // ---- Outputs ----

  /** Elastic strain energy, J. */
  strainEnergy():number {const energy=this.elastic(this.u,null,null);if(!(energy<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');return energy;}
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
    if(!(this.elastic(this.u,this.fint,beta>0&&this.model!=='linear'?this.lin:null)<Infinity))throw new EngineError('NUMERICAL_FAILURE','An element is inverted.');
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
    const H=this.H,P=this.P,F=this.F,R=this.R;
    for(let e=0;e<this.tetCount;e++){
      const o=6*e;this.gradient(e,this.u);
      if(!(this.piola(e,null)<Infinity))throw new EngineError('NUMERICAL_FAILURE',`Element ${e} is inverted.`);
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
