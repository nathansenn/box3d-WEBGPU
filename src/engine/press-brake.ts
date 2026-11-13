/**
 * A press brake in SI units: a sheet bent in air between a punch and two die shoulders, on the J2 solid.
 *
 * The bend is long compared with the sheet thickness, so the model is one plane-strain section: a strip of
 * the sheet across the die, `cells.thickness` linear tetrahedra through the thickness, one cell deep with every
 * node held in the depth direction, and half of it by the symmetry plane under the punch. The sheet is the
 * elastic-plastic `SolidBody` (green-lagrange model: exact under the large rotations of a bend; J2 plasticity with
 * linear isotropic hardening; elements erode at the failure strain, which is how a crack opens). The punch and the
 * die shoulders are rigid cylinders (capsules along the depth) in `SolidContact`, penalty contact with Coulomb
 * friction; the punch is kinematic and moves at the velocity it is given; each step is a backward-Euler step of
 * the sheet with its real mass, which at press speeds is quasi-static. The sheet has no weight: once the punch has
 * left, nothing holds it down, so read shapes relative to the shoulders (as `deflection` does).
 *
 * Forces are reported for the whole sheet width: the section's force per metre of depth times `width`.
 * See docs/STUDIO_METAL_PRESS.md for the closed forms it is validated against and its limits.
 */
import {EngineError} from './contracts.ts';
import {SolidBody,boxMesh,type SolidMaterial,type SolidElement,type SolidLinearSolver} from './solid.ts';
import {SolidContact} from './solid-contact.ts';
import {captureFields,restoreFields,holder,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';

export const PRESS_BRAKE_MODEL_ID='press-brake-plane-strain-j2-v1';

export interface PressBrakeOptions {
  /** Elastic-plastic material: E, nu, rho and yieldStress at least (materials.ts `plasticMaterial`). */
  readonly material:SolidMaterial;
  /** Sheet thickness t, m. */
  readonly thickness:number;
  /** Sheet width along the bend line, m. Scales the reported forces only. */
  readonly width:number;
  /** Distance between the die shoulder centres, m. Default 8 t. */
  readonly dieOpening?:number;
  /** Radius of each die shoulder, m. Default t. */
  readonly dieRadius?:number;
  /** Nose radius of the punch, m. Default t. */
  readonly punchRadius?:number;
  /** Modelled sheet beyond each shoulder centre, m. Default a quarter of the die opening. */
  readonly overhang?:number;
  /** Coulomb friction between sheet and tools. Default 0.1. */
  readonly friction?:number;
  /** Cells through the thickness (even) and along the half section. Defaults 4 and 24. */
  readonly cells?:{readonly thickness?:number;readonly length?:number};
  /** Time step, s. Default 1/60. */
  readonly dt?:number;
  /** Solve tolerance (SolidBody `tolerance`). Default 1e-6. */
  readonly tolerance?:number;
  /** Newton iterations per solve before a step is accepted unconverged (counted in `contact.stats.unconvergedSteps`). Default 100. */
  readonly maxNewtonIterations?:number;
  /** Element of the sheet (solid.ts): `tet4` (default) or `tet4-nodal` (averaged nodal pressure: no plastic-incompressibility locking). */
  readonly element?:SolidElement;
  /** Inner linear solver (solid.ts): `cg` (default) or `ldl` (sparse factorization preconditioner). */
  readonly linearSolver?:SolidLinearSolver;
}

const near=(a:number,b:number,s:number)=>Math.abs(a-b)<=1e-9*s;
const AXIS_Z:readonly [number,number,number,number]=[Math.SQRT1_2,0,0,Math.SQRT1_2];

/** The sheet and the contact are their own state holders; geometry and row and column lists are set up by the constructor. */
const PRESS_BRAKE_FIELDS:FieldOptions={label:'PressBrake',skip:['midRow','topRow','bottomRow','columns'],nested:{body:holder,contact:holder}};

export class PressBrake {
  /** Everything a later step reads (the sheet, its plastic state, the contact and the punch's travel), for exact checkpoints. */
  saveState():StateObject {return captureFields(this,PRESS_BRAKE_FIELDS);}
  /** Put back a state from `saveState()` of a press brake built with the same options. */
  restoreState(state:StateValue):void {restoreFields(this,state,PRESS_BRAKE_FIELDS);}

  readonly model=PRESS_BRAKE_MODEL_ID;
  readonly body:SolidBody;readonly contact:SolidContact;
  readonly thickness:number;readonly width:number;readonly dieOpening:number;readonly dieRadius:number;readonly punchRadius:number;readonly halfLength:number;readonly depth:number;
  readonly dt:number;
  /** Node indices of the mid-thickness row on the front face, ordered from the symmetry plane outwards; and of the top and bottom rows. */
  readonly midRow:Uint32Array;readonly topRow:Uint32Array;readonly bottomRow:Uint32Array;
  /** Elements of each column of cells along the section (column c holds the elements whose centroid lies in cell c). */
  readonly columns:Uint32Array[];
  private readonly punch:number;private velocity=0;private travelled=0;
  private readonly startGap:number;

  constructor(options:PressBrakeOptions){
    const t=options.thickness,V=options.dieOpening??8*t,rd=options.dieRadius??t,rp=options.punchRadius??t,over=options.overhang??V/4;
    if(!(t>0&&V>2*rd&&rd>0&&rp>0&&over>rd&&options.width>0))throw new EngineError('INVALID_PAYLOAD','Press brake: thickness, width, radii and die opening must be positive, the opening wider than a shoulder and the overhang beyond it.');
    if(options.material.yieldStress===undefined)throw new EngineError('INVALID_PAYLOAD','Press brake: the material needs a yieldStress.');
    const ny=options.cells?.thickness??4,nx=options.cells?.length??24;
    if(ny%2!==0)throw new EngineError('INVALID_PAYLOAD','Press brake: the thickness needs an even number of cells.');
    this.thickness=t;this.width=options.width;this.dieOpening=V;this.dieRadius=rd;this.punchRadius=rp;this.halfLength=V/2+over;this.dt=options.dt??1/60;
    const dz=this.depth=Math.max(this.halfLength/nx,t/ny);
    this.body=new SolidBody({mesh:boxMesh({size:[this.halfLength,t,dz],cells:[nx,ny,1]}),material:options.material,
      config:{model:'green-lagrange',dt:this.dt,tolerance:options.tolerance??1e-6,maxNewtonIterations:options.maxNewtonIterations??100,element:options.element??'tet4',linearSolver:options.linearSolver??'cg'}});
    const b=this.body,X=b.referencePositions,L=this.halfLength;
    b.constrain(b.selectNodes(x=>near(x,0,L)),[0,null,null]);
    b.constrain(b.selectNodes(()=>true),[null,null,0]);
    const row=(y:number)=>{const out=Array.from(b.selectNodes((x,yy,z)=>near(yy,y,t)&&near(z,0,t)));out.sort((p,q)=>X[3*p]-X[3*q]);return Uint32Array.from(out);};
    this.midRow=row(t/2);this.topRow=row(t);this.bottomRow=row(0);
    this.columns=Array.from({length:nx},()=>[] as number[]).map(()=>new Uint32Array(0));
    const lists:number[][]=Array.from({length:nx},()=>[]);
    for(let e=0;e<b.tetCount;e++){let cx=0;for(let q=0;q<4;q++)cx+=X[3*b.tets[4*e+q]]/4;lists[Math.min(nx-1,Math.floor(cx/L*nx))].push(e);}
    this.columns=lists.map(l=>Uint32Array.from(l));
    this.contact=new SolidContact(b,{});
    const mu=options.friction??.1;
    this.contact.addBody({shape:{kind:'capsule',radius:rd,halfLength:dz},type:'static',position:[V/2,-rd,dz/2],rotation:AXIS_Z,friction:mu});
    this.startGap=.02*t;
    this.previous=new Float64Array(3*b.nodeCount);this.guess=new Float64Array(3*b.nodeCount);this.zero=new Float64Array(3*b.nodeCount);
    this.punch=this.contact.addBody({shape:{kind:'capsule',radius:rp,halfLength:dz},type:'kinematic',position:[0,t+rp+this.startGap,dz/2],rotation:AXIS_Z,friction:mu});
  }

  /** Punch speed, m/s, positive downwards. */
  setPunchSpeed(speed:number):void {
    this.velocity=speed;const p=this.contact.bodyPosition(this.punch);
    this.contact.setBodyState(this.punch,{position:[p[0],p[1],p[2]],rotation:AXIS_Z,linearVelocity:[0,-speed,0]});
  }
  /** Advances one step of `dt`. The solve starts from the last step's increment carried forward (scaled to the
   * present punch speed): the punch's step otherwise starts as a deep penetration, which costs Newton many damped
   * iterations. The sheet's mass is negligible at press speeds, so its velocity is not carried. */
  step():void {
    const u=this.body.displacements,n=u.length;
    if(this.lastSpeed!==0&&this.velocity!==0&&this.velocity*this.lastSpeed>0){
      const scale=this.velocity/this.lastSpeed,guess=this.guess;
      for(let j=0;j<n;j++)guess[j]=u[j]+scale*(u[j]-this.previous[j]);
      this.previous.set(u);this.body.setState(guess,this.zero);
    }else this.previous.set(u);
    this.contact.step();this.travelled+=this.velocity*this.dt;this.lastSpeed=this.velocity;
  }
  private lastSpeed=0;private previous=new Float64Array(0);private guess=new Float64Array(0);private zero=new Float64Array(0);
  /** Punch travel from the start position, m (the punch starts 2% of t above the sheet). */
  get punchTravel():number {return this.travelled;}
  /** Punch travel beyond first touch of the undeformed sheet, m. */
  get stroke():number {return this.travelled-this.startGap;}
  /** Force of the sheet on the punch over the whole width, N (positive pushes the punch up). */
  get punchForce():number {return 2*this.contact.bodyForce(this.punch)[1]/this.depth*this.width;}
  /** Height of the mid-thickness line under the punch below its height over the shoulders, m: the bend depth. */
  get deflection():number {
    const u=this.body.displacements,m=this.midRow,s=this.shoulderNode();
    return u[3*m[s]+1]-u[3*m[0]+1];
  }
  private shoulderNode():number {const X=this.body.referencePositions,m=this.midRow;let best=0;for(let i=0;i<m.length;i++)if(Math.abs(X[3*m[i]]-this.dieOpening/2)<Math.abs(X[3*m[best]]-this.dieOpening/2))best=i;return best;}
  /** Included angle between the two flanges, degrees: 180 flat, smaller as it bends. Read from the slope of the last cell of the section. */
  get bendAngle():number {
    const p=this.body.positions(),m=this.midRow,a=m[m.length-2],b=m[m.length-1];
    const slope=Math.atan2(p[3*b+1]-p[3*a+1],p[3*b]-p[3*a]);
    return 180-2*slope*180/Math.PI;
  }
  /** Largest equivalent plastic strain in the section. */
  get maxPlasticStrain():number {let m=0;for(const v of this.body.equivalentPlasticStrain())m=Math.max(m,v);return m;}
  /** Contacts of the sheet with the punch after the last step. */
  get punchContacts():number {return this.contact.bodyContacts(this.punch);}
}
