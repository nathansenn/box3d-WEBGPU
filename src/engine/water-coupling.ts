import {validateLinearWaterConfig,type LinearWaterArrays,type LinearWaterConfig} from './linear-water.ts';
import {captureFields,eachElement,restoreFields,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';

/** Two-way coupling of rigid bodies with one closed, flat-bottom, linear shallow-water basin.
 *
 * Water -> body: Archimedes buoyancy from the exact volume of the shape below the local
 * water plane, applied at the centre of buoyancy, plus a drag MODEL (linear + quadratic in the
 * velocity relative to the water, scaled by the submerged fraction). This is not CFD.
 * Body -> water: the displaced volume is a volume source for the free surface, and the reaction
 * of every horizontal force the water puts on a body is a momentum source for the water.
 *
 * SI units, float64 state, world Y is up, grid x/z are world x/z. The water scheme is the one in
 * closed-water.ts (C-grid, eta at t, face velocities at t - dt/2) with the two source terms added.
 * See docs/WATER_COUPLING.md for the equations, what is conserved, and the validation.
 */
export const WATER_COUPLING_BACKEND='rigid-water-coupling-closed-cgrid-js-f64-v1';

export type CouplingVec3=readonly [number,number,number];
export type CouplingShape=
  |{readonly kind:'box';readonly halfExtents:CouplingVec3}
  |{readonly kind:'sphere';readonly radius:number}
  /** The capsule's axis is the body's local Y; halfLength is half the distance between the cap centres. */
  |{readonly kind:'capsule';readonly radius:number;readonly halfLength:number};

export interface CouplingBodyState {
  readonly position:CouplingVec3;
  readonly rotation:readonly [number,number,number,number];
  readonly linearVelocity:CouplingVec3;
  readonly angularVelocity:CouplingVec3;
  readonly mass:number;
  readonly type:string;
}

/** The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it. */
export interface CouplingWorld<B> {
  gravity():readonly number[];
  getState(body:B):CouplingBodyState;
  /** Force in newtons at a world-space point, acting over the next step. */
  applyForce(body:B,force:CouplingVec3,point?:CouplingVec3):void;
  applyTorque(body:B,torque:CouplingVec3):void;
  isAlive?(body:B):boolean;
  readonly loop?:{readonly step:number};
}

export interface WaterCouplingOptions {
  readonly cols:number;
  readonly rows:number;
  /** Cell size in metres. */
  readonly dx:number;
  readonly dz:number;
  /** Depth of the water at rest, in metres. The floor is flat. */
  readonly restDepth:number;
  /** World position of the basin floor at the grid's minimum-x, minimum-z corner. The rest surface is at origin y + restDepth. */
  readonly origin:CouplingVec3;
  /** Fixed step in seconds. Must equal the world's fixed step; defaults to world.loop.step. */
  readonly dt?:number;
  /** Water density in kg/m^3. Default 1000. */
  readonly density?:number;
  /** Linear bottom-friction rate of the water in 1/s (the closed-water `drag`). Default 0. */
  readonly waterDrag?:number;
  /** Initial free-surface elevation at t = 0, cols*rows values in metres. Default flat. */
  readonly eta?:ArrayLike<number>;
}

export interface CouplingBodyOptions {
  /** Quadratic drag coefficient C_d. Default 0.47 (sphere), 1.05 (box), 0.82 (capsule). */
  readonly dragCoefficient?:number;
  /** Reference area in m^2. Default: the cross-section of the sphere with the body's volume. */
  readonly referenceArea?:number;
  /** Linear drag in N s/m at full submersion. Default 0. */
  readonly linearDrag?:number;
  /** Linear rotational drag in N m s/rad at full submersion. Default 0. */
  readonly angularDrag?:number;
}

/** Live per-body results of the most recent step(). Do not write to it. */
export interface CoupledBodyReport {
  /** Volume of the shape in m^3. */
  readonly volume:number;
  /** Displaced volume in m^3 used for the forces and the volume source. */
  readonly submergedVolume:number;
  readonly submergedFraction:number;
  /** Centre of buoyancy in world space. */
  readonly centre:Float64Array;
  /** Pressure force in newtons: [-rho g V d(eta)/dx, rho g V, -rho g V d(eta)/dz]. */
  readonly buoyancy:Float64Array;
  /** Drag force in newtons. */
  readonly drag:Float64Array;
  /** Drag torque in newton metres. */
  readonly dragTorque:Float64Array;
}

interface Entry<B> {
  body:B;kind:0|1|2;hx:number;hy:number;hz:number;radius:number;halfLength:number;
  volume:number;cd:number;area:number;linear:number;angular:number;equivalentRadius:number;fresh:boolean;
  submergedVolume:number;submergedFraction:number;centre:Float64Array;buoyancy:Float64Array;drag:Float64Array;dragTorque:Float64Array;
}

const EDGE_SAMPLES=24,MAX_SLOPE=0.5,GAUSS_ORDER=12;
/** Half-width of the exchange kernel in units of the body's horizontal half extent (one cell is added).
 * A body reads the water level through the kernel and returns its displaced volume through the same kernel,
 * so a change of displaced volume changes the level the body reads with gain
 * waterplane area * sum(w^2) / (cell area * sum(w)^2), which for a tent is 4 A_waterplane / (9 reach_x reach_z).
 * With reach = 2 half extents that gain is at most 4/9 for every shape and grid, so the body's own rise is a
 * contraction and the in-step solve in couple() is well posed. */
const KERNEL_REACH=2,TINY=1e-30;
// Corner k of a box has sign bit 0 on x, bit 1 on y, bit 2 on z. Faces wind counter-clockwise seen from outside.
const BOX_FACES=new Uint8Array([1,3,7,5, 0,4,6,2, 2,6,7,3, 0,1,5,4, 4,5,7,6, 0,2,3,1]);

function gaussLegendre(n:number):{nodes:Float64Array;weights:Float64Array} {
  const nodes=new Float64Array(n),weights=new Float64Array(n);
  for(let k=0;k<n;k++) {
    let x=Math.cos(Math.PI*(k+0.75)/(n+0.5)),dp=1;
    for(let iteration=0;iteration<100;iteration++) {
      let p0=1,p1=x;
      for(let j=2;j<=n;j++){const p2=((2*j-1)*x*p1-(j-1)*p0)/j;p0=p1;p1=p2;}
      dp=n*(x*p1-p0)/(x*x-1);
      const step=p1/dp;x-=step;
      if(Math.abs(step)<1e-16)break;
    }
    nodes[k]=x;weights[k]=2/((1-x*x)*dp*dp);
  }
  return {nodes,weights};
}
const GAUSS=gaussLegendre(GAUSS_ORDER);

/** What a checkpoint of a WaterCoupling holds: every field but the world, with the attached bodies as a list of fixed length. */
const WATER_FIELDS:FieldOptions={label:'WaterCoupling',skip:['world'],nested:{entries:eachElement({label:'WaterCoupling.entries'})}};

export class WaterCoupling<B> {
  readonly backend=WATER_COUPLING_BACKEND;
  readonly cols:number;readonly rows:number;readonly dx:number;readonly dz:number;readonly dt:number;
  readonly restDepth:number;readonly density:number;readonly waterDrag:number;
  readonly origin:CouplingVec3;
  /** Free-surface elevation above rest at cell centres, metres, at the current tick. Live view. */
  readonly eta:Float64Array;
  /** East-face velocity of each cell in m/s, half a step behind eta. The last column is the wall (0). Live view. */
  readonly u:Float64Array;
  /** North-face velocity of each cell in m/s, half a step behind eta. The last row is the wall (0). Live view. */
  readonly v:Float64Array;
  /** Net horizontal impulse [x, z] in N s that step() gave the water in the most recent step. */
  readonly stepImpulseOnWater=new Float64Array(2);
  /** Net impulse [x, y, z] in N s that step() asked the world to give dynamic bodies in the most recent step. */
  readonly stepImpulseOnBodies=new Float64Array(3);

  private readonly world:CouplingWorld<B>;
  private displaced:Float64Array;
  private displacedNext:Float64Array;
  private readonly entries:Entry<B>[]=[];
  private g=0;
  private ticks=0;
  private buoyancySum=0;
  private dragYSum=0;
  private displacedMoment=0;
  // Scratch, allocated once.
  private readonly rot=new Float64Array(9);
  private readonly corners=new Float64Array(24);
  private readonly cornerDistance=new Float64Array(8);
  private readonly polygon=new Float64Array(24);
  private readonly breaks=new Float64Array(10);
  private readonly clip=new Float64Array(4);
  /** predictLoad(): where couple() reports instead of acting, and the entry fields it restores afterwards. */
  private probe:Float64Array|null=null;private readonly saved=new Float64Array(14);
  private readonly chord=new Float64Array(2);
  private readonly force:[number,number,number]=[0,0,0];
  private readonly point:[number,number,number]=[0,0,0];

  constructor(world:CouplingWorld<B>,options:WaterCouplingOptions) {
    if(!world||typeof world.getState!=='function'||typeof world.applyForce!=='function'||typeof world.gravity!=='function')throw new TypeError('WaterCoupling needs a world with gravity(), getState() and applyForce().');
    if(!options||typeof options!=='object')throw new TypeError('WaterCoupling options are required.');
    const worldStep=world.loop?.step,dt=options.dt??worldStep;
    if(dt===undefined)throw new RangeError('WaterCoupling needs dt when the world does not expose loop.step.');
    if(worldStep!==undefined&&Math.abs(worldStep-dt)>1e-12)throw new RangeError('WaterCoupling dt must equal the world fixed step.');
    const density=options.density??1000,waterDrag=options.waterDrag??0;
    if(!(Number.isFinite(density)&&density>0))throw new RangeError('Water density must be positive.');
    if(!Array.isArray(options.origin)||options.origin.length!==3||!options.origin.every(Number.isFinite))throw new RangeError('WaterCoupling origin must be three finite numbers.');
    this.world=world;this.cols=options.cols;this.rows=options.rows;this.dx=options.dx;this.dz=options.dz;this.dt=dt;
    this.restDepth=options.restDepth;this.density=density;this.waterDrag=waterDrag;
    this.origin=[options.origin[0],options.origin[1],options.origin[2]];
    this.g=this.readGravity();
    validateLinearWaterConfig(this.waterConfig(this.g>0?this.g:9.81));
    const count=this.cols*this.rows;
    this.eta=new Float64Array(count);this.u=new Float64Array(count);this.v=new Float64Array(count);
    this.displaced=new Float64Array(count);this.displacedNext=new Float64Array(count);
    if(options.eta!==undefined) {
      if(options.eta.length!==count)throw new RangeError('Initial eta must have cols*rows values.');
      for(let i=0;i<count;i++){const value=Number(options.eta[i]);if(!Number.isFinite(value))throw new RangeError('Initial eta must be finite.');this.eta[i]=value;}
      // Face velocities start half a step back, as in createClosedWaterArrays (zero velocity at t = 0).
      const px=this.g*dt/(2*this.dx),pz=this.g*dt/(2*this.dz),{cols,rows,eta}=this;
      for(let z=0;z<rows;z++)for(let x=0;x<cols;x++) {
        const i=z*cols+x;
        this.u[i]=x+1<cols?(eta[i+1]-eta[i])*px:0;
        this.v[i]=z+1<rows?(eta[i+cols]-eta[i])*pz:0;
      }
    }
  }

  /** The closed-water configuration this coupling steps, with the world's current gravity. */
  waterConfig(gravity=this.g):LinearWaterConfig {
    return {cols:this.cols,rows:this.rows,dt:this.dt,gravity,meanDepth:this.restDepth,drag:this.waterDrag,dx:this.dx,dz:this.dz};
  }

  /** Couple a body. `shape` must be the shape the body was created with (the world does not report it).
   * A body that is already below the surface at its first step is taken as part of the starting state:
   * the water is assumed to stand around it at the current level, so attaching makes no wave. */
  attach(body:B,shape:CouplingShape,options:CouplingBodyOptions={}):CoupledBodyReport {
    if(this.find(body)>=0)throw new RangeError('The body is already attached.');
    const positive=(value:number,name:string)=>{if(!(Number.isFinite(value)&&value>0))throw new RangeError(`Coupling shape ${name} must be positive.`);return value;};
    const nonNegative=(value:number|undefined,fallback:number,name:string)=>{const result=value??fallback;if(!(Number.isFinite(result)&&result>=0))throw new RangeError(`Coupling ${name} must be zero or positive.`);return result;};
    let kind:0|1|2,hx=0,hy=0,hz=0,radius=0,halfLength=0,volume:number,cd:number;
    if(shape.kind==='box') {
      kind=0;hx=positive(shape.halfExtents[0],'half extent');hy=positive(shape.halfExtents[1],'half extent');hz=positive(shape.halfExtents[2],'half extent');
      volume=8*hx*hy*hz;cd=1.05;
    } else if(shape.kind==='sphere') {
      kind=1;radius=positive(shape.radius,'radius');volume=4/3*Math.PI*radius**3;cd=0.47;
    } else if(shape.kind==='capsule') {
      kind=2;radius=positive(shape.radius,'radius');halfLength=positive(shape.halfLength,'half length');
      volume=Math.PI*radius*radius*2*halfLength+4/3*Math.PI*radius**3;cd=0.82;
    } else throw new RangeError('Coupling shape must be a box, a sphere or a capsule.');
    const equivalentRadius=Math.cbrt(3*volume/(4*Math.PI));
    const entry:Entry<B>={body,kind,hx,hy,hz,radius,halfLength,volume,
      cd:nonNegative(options.dragCoefficient,cd,'drag coefficient'),
      area:nonNegative(options.referenceArea,Math.PI*equivalentRadius*equivalentRadius,'reference area'),
      linear:nonNegative(options.linearDrag,0,'linear drag'),angular:nonNegative(options.angularDrag,0,'angular drag'),equivalentRadius,fresh:true,
      submergedVolume:0,submergedFraction:0,centre:new Float64Array(3),buoyancy:new Float64Array(3),drag:new Float64Array(3),dragTorque:new Float64Array(3)};
    this.entries.push(entry);
    return entry;
  }

  /** Stop coupling a body. Its displaced volume leaves the water in the next step. */
  detach(body:B):boolean {
    const index=this.find(body);
    if(index<0)return false;
    this.removeAt(index);
    return true;
  }

  /** The live report of an attached body, or null. */
  report(body:B):CoupledBodyReport|null {const index=this.find(body);return index<0?null:this.entries[index];}
  attachedCount():number {return this.entries.length;}
  /** Steps taken. */
  tick():number {return this.ticks;}
  /** Gravity magnitude used in the most recent step, from world.gravity(). */
  gravity():number {return this.g;}

  /** Adds to `out` the force (out[0..2], N) and the torque about the centre of mass (out[3..5], N m) that `step()` would
   * put on `body` if it were called now, for the body's present state and the present water. Nothing is changed: no
   * force is applied and the water is not touched. Returns false for a body that is not attached. A structure coupling
   * uses it to count the water in a moored body's free motion (StructureCoupling.addLoadProvider). */
  predictLoad(body:B,out:Float64Array):boolean {
    const index=this.find(body);if(index<0)return false;
    const entry=this.entries[index],world=this.world;
    if(world.isAlive!==undefined&&!world.isAlive(body))return false;
    const g=this.readGravity(),kept=this.g,s=this.saved;
    s[0]=entry.submergedVolume;s[1]=entry.submergedFraction;
    for(let k=0;k<3;k++){s[2+k]=entry.centre[k];s[5+k]=entry.buoyancy[k];s[8+k]=entry.drag[k];s[11+k]=entry.dragTorque[k];}
    const fresh=entry.fresh;
    this.g=g;this.probe=out;
    try{this.couple(entry);}
    finally{
      this.probe=null;this.g=kept;entry.fresh=fresh;entry.submergedVolume=s[0];entry.submergedFraction=s[1];
      for(let k=0;k<3;k++){entry.centre[k]=s[2+k];entry.buoyancy[k]=s[5+k];entry.drag[k]=s[8+k];entry.dragTorque[k]=s[11+k];}
    }
    return true;
  }

  /** Advance the coupling and the water by one fixed step. Call it once per fixed step,
   * immediately BEFORE world.step(): it reads each body's state at t, gives the world the water's
   * forces for the step t -> t + dt, and advances the water from t to t + dt with the bodies'
   * volume and momentum sources. Allocation-free apart from the world's own getState/applyForce.
   */
  step():void {
    const g=this.readGravity();
    if(g!==this.g){if(g>0)validateLinearWaterConfig(this.waterConfig(g));this.g=g;}
    const next=this.displacedNext;
    next.fill(0);
    this.buoyancySum=0;this.dragYSum=0;this.displacedMoment=0;
    this.stepImpulseOnWater[0]=0;this.stepImpulseOnWater[1]=0;
    this.stepImpulseOnBodies[0]=0;this.stepImpulseOnBodies[1]=0;this.stepImpulseOnBodies[2]=0;
    const world=this.world;
    for(let index=0;index<this.entries.length;) {
      const entry=this.entries[index];
      if(world.isAlive!==undefined&&!world.isAlive(entry.body)){this.removeAt(index);continue;}
      this.couple(entry);
      index++;
    }
    const {cols,rows,dt,dx,dz,eta,u,v,displaced}=this,H=this.restDepth;
    const a=this.waterDrag*dt/2,decay=(1-a)/(1+a),px=g*dt/((1+a)*dx),pz=g*dt/((1+a)*dz),cx=H*dt/dx,cz=H*dt/dz,inverseCell=1/(dx*dz);
    for(let z=0;z<rows;z++)for(let x=0;x<cols;x++) {
      const i=z*cols+x;
      u[i]=x+1<cols?u[i]*decay-(eta[i+1]-eta[i])*px:0;
      v[i]=z+1<rows?v[i]*decay-(eta[i+cols]-eta[i])*pz:0;
    }
    for(let z=0;z<rows;z++)for(let x=0;x<cols;x++) {
      const i=z*cols+x,west=x>0?u[i-1]:0,south=z>0?v[i-cols]:0;
      eta[i]=eta[i]-(u[i]-west)*cx-(v[i]-south)*cz+(next[i]-displaced[i])*inverseCell;
    }
    this.displaced=next;this.displacedNext=displaced;
    this.ticks++;
  }

  /** Volume under the free surface, sum of (restDepth + eta) dx dz, in m^3. It includes the displaced volume. */
  surfaceVolume():number {
    let sum=0;
    for(let i=0;i<this.eta.length;i++)sum+=this.eta[i];
    return (sum+this.restDepth*this.eta.length)*this.dx*this.dz;
  }
  /** Volume of attached bodies below the surface as of the most recent step, in m^3. */
  displacedVolume():number {
    let sum=0;
    for(let i=0;i<this.displaced.length;i++)sum+=this.displaced[i];
    return sum;
  }
  /** Volume of water: surfaceVolume() - displacedVolume(). Constant to float64 roundoff. */
  waterVolume():number {
    let sum=0;
    const cell=this.dx*this.dz;
    for(let i=0;i<this.eta.length;i++)sum+=this.eta[i]*cell-this.displaced[i];
    return sum+this.restDepth*this.eta.length*cell;
  }
  /** Mean free-surface elevation above rest, in metres. */
  meanElevation():number {
    let sum=0;
    for(let i=0;i<this.eta.length;i++)sum+=this.eta[i];
    return sum/this.eta.length;
  }
  /** Free-surface elevation above rest at a world x, z (bilinear between cell centres). */
  elevationAt(x:number,z:number):number {return this.sampleEta(x,z);}
  /** Hydrostatic force of the water on the basin floor, rho g surfaceVolume(), in newtons. */
  floorLoad():number {return this.density*this.g*this.surfaceVolume();}
  /** Sum of the vertical buoyant forces of the most recent step, rho g displacedVolume(), in newtons. */
  buoyancyTotal():number {return this.buoyancySum;}
  /** Sum of the vertical drag forces on bodies in the most recent step, in newtons. Its reaction is not put into the water. */
  verticalDragTotal():number {return this.dragYSum;}
  /** Kinetic energy of the linear water model, rho H/2 sum(u^2 + v^2) dx dz, in joules (velocities are half a step behind eta). */
  waterKineticEnergy():number {
    let sum=0;
    for(let i=0;i<this.u.length;i++)sum+=this.u[i]*this.u[i]+this.v[i]*this.v[i];
    return 0.5*this.density*this.restDepth*this.dx*this.dz*sum;
  }
  /** Gravitational potential energy of the water relative to the flat rest state without bodies, in joules:
   * rho g [sum((H eta + eta^2/2) dx dz) - sum over bodies(V_displaced * height of centre of buoyancy above the floor)].
   */
  waterPotentialEnergy():number {
    let sum=0;
    const H=this.restDepth;
    for(let i=0;i<this.eta.length;i++)sum+=this.eta[i]*(H+0.5*this.eta[i]);
    return this.density*this.g*(sum*this.dx*this.dz-this.displacedMoment);
  }
  /** Everything a later step reads, as a state tree (checkpoint.ts): the surface and face velocities, the displaced
   * volumes of the step before, the gravity and step count, and every attached body's report. For exact checkpoints. */
  saveState():StateObject {return captureFields(this,WATER_FIELDS);}
  /** Put back a state from `saveState()` of a coupling built the same way (same basin, same bodies attached in the same order). */
  restoreState(state:StateValue):void {restoreFields(this,state,WATER_FIELDS);}
  /** Copy the state into float32 closed-water arrays, for a renderer or the GPU solver's checkpoint format. */
  copyTo(arrays:Pick<LinearWaterArrays,'eta'|'u'|'v'>):void {
    arrays.eta.set(this.eta);arrays.u.set(this.u);arrays.v.set(this.v);
  }

  private readGravity():number {
    const y=Number(this.world.gravity()[1]);
    return Number.isFinite(y)&&y<0?-y:0;
  }
  private find(body:B):number {
    for(let i=0;i<this.entries.length;i++)if(this.entries[i].body===body)return i;
    return -1;
  }
  private removeAt(index:number):void {
    const entries=this.entries;
    for(let i=index+1;i<entries.length;i++)entries[i-1]=entries[i];
    entries.length--;
  }
  private sampleEta(x:number,z:number):number {
    const {cols,rows,eta}=this;
    let fx=(x-this.origin[0])/this.dx-0.5,fz=(z-this.origin[2])/this.dz-0.5;
    let ix=Math.floor(fx),iz=Math.floor(fz);
    if(ix<0)ix=0;else if(ix>cols-2)ix=cols-2;
    if(iz<0)iz=0;else if(iz>rows-2)iz=rows-2;
    fx-=ix;fz-=iz;
    if(fx<0)fx=0;else if(fx>1)fx=1;
    if(fz<0)fz=0;else if(fz>1)fz=1;
    const i=iz*cols+ix;
    return (eta[i]*(1-fx)+eta[i+1]*fx)*(1-fz)+(eta[i+cols]*(1-fx)+eta[i+cols+1]*fx)*fz;
  }

  private couple(entry:Entry<B>):void {
    const state=this.world.getState(entry.body),R=this.rot;
    // The pose half a step ahead, x + v dt/2. Forces evaluated at the start-of-step pose and held over a step
    // feed energy into a floating body's bobbing (by (beta - 1) (omega dt)^2 per step, beta in [1/2, 1] set by the
    // rigid solver's substeps); the half-step pose changes that to (beta - 1/2), which never amplifies.
    const half=0.5*this.dt,w=state.angularVelocity;
    const cx=state.position[0]+half*state.linearVelocity[0],cy=state.position[1]+half*state.linearVelocity[1],cz=state.position[2]+half*state.linearVelocity[2];
    {
      let qx=state.rotation[0],qy=state.rotation[1],qz=state.rotation[2],qw=state.rotation[3];
      // dq/dt = (omega, 0) q / 2
      const h=0.5*half,dx=h*(w[0]*qw+w[1]*qz-w[2]*qy),dy=h*(w[1]*qw+w[2]*qx-w[0]*qz),dz=h*(w[2]*qw+w[0]*qy-w[1]*qx),dw=-h*(w[0]*qx+w[1]*qy+w[2]*qz);
      qx+=dx;qy+=dy;qz+=dz;qw+=dw;
      const scale=1/Math.sqrt(qx*qx+qy*qy+qz*qz+qw*qw);
      qx*=scale;qy*=scale;qz*=scale;qw*=scale;
      R[0]=1-2*(qy*qy+qz*qz);R[1]=2*(qx*qy-qz*qw);R[2]=2*(qx*qz+qy*qw);
      R[3]=2*(qx*qy+qz*qw);R[4]=1-2*(qx*qx+qz*qz);R[5]=2*(qy*qz-qx*qw);
      R[6]=2*(qx*qz-qy*qw);R[7]=2*(qy*qz+qx*qw);R[8]=1-2*(qx*qx+qy*qy);
    }
    const fresh=entry.fresh,previousVolume=entry.submergedVolume;
    entry.fresh=false;
    entry.submergedVolume=0;entry.submergedFraction=0;
    entry.centre[0]=cx;entry.centre[1]=cy;entry.centre[2]=cz;
    entry.buoyancy.fill(0);entry.drag.fill(0);entry.dragTorque.fill(0);
    // Horizontal half extents of the body's bounding box.
    let ex:number,ez:number;
    if(entry.kind===0){ex=Math.abs(R[0])*entry.hx+Math.abs(R[1])*entry.hy+Math.abs(R[2])*entry.hz;ez=Math.abs(R[6])*entry.hx+Math.abs(R[7])*entry.hy+Math.abs(R[8])*entry.hz;}
    else if(entry.kind===1){ex=entry.radius;ez=entry.radius;}
    else{ex=Math.abs(R[1])*entry.halfLength+entry.radius;ez=Math.abs(R[7])*entry.halfLength+entry.radius;}
    const {cols,rows,dx,dz,eta,u,v}=this,x0=this.origin[0],z0=this.origin[2];
    if(cx+ex<=x0||cx-ex>=x0+cols*dx||cz+ez<=z0||cz-ez>=z0+rows*dz)return;
    // The exchange kernel: a tent centred on the body (see KERNEL_REACH). The body reads the water through it
    // (level, slope, velocity) and writes to the water through it (volume, momentum).
    const reachX=KERNEL_REACH*ex+dx,reachZ=KERNEL_REACH*ez+dz;
    let i0=Math.ceil((cx-reachX-x0)/dx-0.5),i1=Math.floor((cx+reachX-x0)/dx-0.5),k0=Math.ceil((cz-reachZ-z0)/dz-0.5),k1=Math.floor((cz+reachZ-z0)/dz-0.5);
    if(i0<0)i0=0;if(i1>cols-1)i1=cols-1;if(k0<0)k0=0;if(k1>rows-1)k1=rows-1;
    let kernel=0,kernelSquares=0,meanEta=0,slopeX=0,slopeZ=0,waterU=0,waterW=0;
    for(let k=k0;k<=k1;k++) {
      const wz=1-Math.abs(z0+(k+0.5)*dz-cz)/reachZ;
      if(wz<=0)continue;
      for(let j=i0;j<=i1;j++) {
        const wx=1-Math.abs(x0+(j+0.5)*dx-cx)/reachX;
        if(wx<=0)continue;
        const i=k*cols+j,weight=wx*wz,e=eta[i];
        kernel+=weight;kernelSquares+=weight*weight;meanEta+=weight*e;
        // Faces in the same shares the reaction uses below: half each, or all on the open face beside a wall.
        if(j===0){slopeX+=weight*(eta[i+1]-e);waterU+=weight*u[i];}
        else if(j===cols-1){slopeX+=weight*(e-eta[i-1]);waterU+=weight*u[i-1];}
        else{slopeX+=weight*0.5*(eta[i+1]-eta[i-1]);waterU+=weight*0.5*(u[i]+u[i-1]);}
        if(k===0){slopeZ+=weight*(eta[i+cols]-e);waterW+=weight*v[i];}
        else if(k===rows-1){slopeZ+=weight*(e-eta[i-cols]);waterW+=weight*v[i-cols];}
        else{slopeZ+=weight*0.5*(eta[i+cols]-eta[i-cols]);waterW+=weight*0.5*(v[i]+v[i-cols]);}
      }
    }
    if(!(kernel>0))return;
    meanEta/=kernel;slopeX/=kernel*dx;slopeZ/=kernel*dz;waterU/=kernel;waterW/=kernel;
    slopeX=slopeX>MAX_SLOPE?MAX_SLOPE:slopeX< -MAX_SLOPE?-MAX_SLOPE:slopeX;
    slopeZ=slopeZ>MAX_SLOPE?MAX_SLOPE:slopeZ< -MAX_SLOPE?-MAX_SLOPE:slopeZ;
    // The water plane the body sits in: y = level + slopeX (x - cx) + slopeZ (z - cz).
    const floorY=this.origin[1];
    let level=floorY+this.restDepth+meanEta;
    const norm=1/Math.sqrt(1+slopeX*slopeX+slopeZ*slopeZ),Nx=-slopeX*norm,Ny=norm,Nz=-slopeZ*norm;
    // The exact volume and centroid of the shape below the plane (the argument is the centre's signed distance above it).
    let volume=this.clipShape(entry,cx,cy,cz,Nx,Ny,Nz,Ny*(cy-level));
    // A body that hangs over the basin edge only displaces the part that is over water: sample its vertical
    // chords to find the share of the wet volume that is over the grid. Skipped when it is wholly inside.
    let share=1;
    if(volume>0&&(cx-ex<x0||cx+ex>x0+cols*dx||cz-ez<z0||cz+ez>z0+rows*dz)) {
      const chord=this.chord,sx=2*ex/EDGE_SAMPLES,sz=2*ez/EDGE_SAMPLES;
      let all=0,inside=0;
      for(let k=0;k<EDGE_SAMPLES;k++)for(let j=0;j<EDGE_SAMPLES;j++) {
        const X=-ex+(j+0.5)*sx,Z=-ez+(k+0.5)*sz;
        if(!this.verticalChord(entry,X,Z))continue;
        let wet=level+slopeX*X+slopeZ*Z-(cy+chord[0]);
        const thickness=chord[1]-chord[0];
        wet=wet<0?0:wet>thickness?thickness:wet;
        all+=wet;
        const x=cx+X,z=cz+Z;
        if(x>=x0&&x<x0+cols*dx&&z>=z0&&z<z0+rows*dz)inside+=wet;
      }
      share=all>0?inside/all:0;
    }
    volume*=share;
    // The body's own volume source raises the level it reads, within this same step, by `response` per m^3.
    // Solve displaced = V(level + response (displaced - previous)) by one secant step, so that the buoyancy
    // already contains the body's own rise instead of meeting it one step late (a delayed spring feeds energy in).
    if(!fresh&&volume!==previousVolume) {
      const response=kernelSquares/(kernel*kernel*dx*dz),change=response*(volume-previousVolume);
      const second=share*this.clipShape(entry,cx,cy,cz,Nx,Ny,Nz,Ny*(cy-level-change));
      let gain=(second-volume)/(volume-previousVolume);
      gain=gain<0?0:gain>0.9?0.9:gain;
      level+=response*((volume-gain*previousVolume)/(1-gain)-previousVolume);
      volume=share*this.clipShape(entry,cx,cy,cz,Nx,Ny,Nz,Ny*(cy-level));
    }
    if(!(volume>0))return;
    const fraction=volume/entry.volume,density=this.density,g=this.g,dt=this.dt;
    entry.submergedVolume=volume;entry.submergedFraction=fraction;
    const centre=this.clip,px=centre[0],py=centre[1],pz=centre[2];
    entry.centre[0]=px;entry.centre[1]=py;entry.centre[2]=pz;
    const weight=density*g*volume;
    const bx=-weight*slopeX,by=weight,bz=-weight*slopeZ;
    entry.buoyancy[0]=bx;entry.buoyancy[1]=by;entry.buoyancy[2]=bz;
    // Drag on the velocity of the centre of buoyancy relative to the water (the water has no vertical velocity here).
    const rx=px-cx,ry=py-cy,rz=pz-cz;
    const vx=state.linearVelocity[0]+w[1]*rz-w[2]*ry-waterU,vy=state.linearVelocity[1]+w[2]*rx-w[0]*rz,vz=state.linearVelocity[2]+w[0]*ry-w[1]*rx-waterW;
    const speed=Math.sqrt(vx*vx+vy*vy+vz*vz),quadratic=0.5*density*entry.cd*entry.area;
    let coefficient=fraction*(entry.linear+quadratic*speed);
    const mass=state.mass,dynamic=state.type==='dynamic';
    // Explicit-step limiter: drag may remove the relative velocity in one step, never reverse it.
    if(dynamic&&mass>0&&coefficient*dt>mass)coefficient=mass/dt;
    const fx=-coefficient*vx,fy=-coefficient*vy,fz=-coefficient*vz;
    entry.drag[0]=fx;entry.drag[1]=fy;entry.drag[2]=fz;
    const spin=Math.sqrt(w[0]*w[0]+w[1]*w[1]+w[2]*w[2]);
    let angular=fraction*(entry.angular+quadratic*entry.equivalentRadius**3*spin);
    const inertia=0.4*mass*entry.equivalentRadius*entry.equivalentRadius;
    if(dynamic&&mass>0&&angular*dt>inertia)angular=inertia/dt;
    entry.dragTorque[0]=-angular*w[0];entry.dragTorque[1]=-angular*w[1];entry.dragTorque[2]=-angular*w[2];
    if(this.probe) {
      // predictLoad(): report the force and its torque about the centre of mass, and change nothing.
      const o=this.probe,Fx=bx+fx,Fy=by+fy,Fz=bz+fz;
      if(dynamic){o[0]+=Fx;o[1]+=Fy;o[2]+=Fz;o[3]+=ry*Fz-rz*Fy+entry.dragTorque[0];o[4]+=rz*Fx-rx*Fz+entry.dragTorque[1];o[5]+=rx*Fy-ry*Fx+entry.dragTorque[2];}
      return;
    }
    if(dynamic) {
      const force=this.force,point=this.point;
      // The world takes the point at the body's current pose: keep the lever arm found at the half-step pose.
      force[0]=bx+fx;force[1]=by+fy;force[2]=bz+fz;point[0]=state.position[0]+rx;point[1]=state.position[1]+ry;point[2]=state.position[2]+rz;
      // The world stores float32 and rejects values too small for it.
      for(let axis=0;axis<3;axis++)if(Math.abs(force[axis])<TINY)force[axis]=0;
      this.world.applyForce(entry.body,force,point);
      force[0]=entry.dragTorque[0];force[1]=entry.dragTorque[1];force[2]=entry.dragTorque[2];
      for(let axis=0;axis<3;axis++)if(Math.abs(force[axis])<TINY)force[axis]=0;
      if(force[0]!==0||force[1]!==0||force[2]!==0)this.world.applyTorque(entry.body,force);
      this.stepImpulseOnBodies[0]+=(bx+fx)*dt;this.stepImpulseOnBodies[1]+=(by+fy)*dt;this.stepImpulseOnBodies[2]+=(bz+fz)*dt;
    }
    this.buoyancySum+=by;this.dragYSum+=fy;this.displacedMoment+=volume*(py-floorY);
    // Body -> water, through the same kernel: the displaced volume per column, and the reaction of the horizontal force as face momentum.
    const perWeight=volume/kernel,next=this.displacedNext,previous=this.displaced,faceMass=density*this.restDepth*dx*dz;
    const jx=-(bx+fx)*dt/(faceMass*kernel),jz=-(bz+fz)*dt/(faceMass*kernel);
    for(let k=k0;k<=k1;k++) {
      const wz=1-Math.abs(z0+(k+0.5)*dz-cz)/reachZ;
      if(wz<=0)continue;
      for(let j=i0;j<=i1;j++) {
        const wx=1-Math.abs(x0+(j+0.5)*dx-cx)/reachX;
        if(wx<=0)continue;
        const i=k*cols+j,weight=wx*wz;
        next[i]+=weight*perWeight;
        // A body that is already wet when it is first seen is taken as part of the starting state: no source.
        if(fresh)previous[i]+=weight*perWeight;
        // A wall face cannot move, so a cell beside a wall puts its whole share on its open face.
        if(j===0)u[i]+=jx*weight;else if(j===cols-1)u[i-1]+=jx*weight;else{u[i]+=0.5*jx*weight;u[i-1]+=0.5*jx*weight;}
        if(k===0)v[i]+=jz*weight;else if(k===rows-1)v[i-cols]+=jz*weight;else{v[i]+=0.5*jz*weight;v[i-cols]+=0.5*jz*weight;}
      }
    }
    this.stepImpulseOnWater[0]-=(bx+fx)*dt;this.stepImpulseOnWater[1]-=(bz+fz)*dt;
  }

  /** The body's extent along the vertical line at horizontal offset (X, Z) from its centre, as
   * heights relative to the centre in this.chord. Returns false when the line misses the body. */
  private verticalChord(entry:Entry<B>,X:number,Z:number):boolean {
    const R=this.rot,chord=this.chord;
    if(entry.kind===1) {
      const d=entry.radius*entry.radius-X*X-Z*Z;
      if(d<=0)return false;
      const half=Math.sqrt(d);chord[0]=-half;chord[1]=half;
      return true;
    }
    if(entry.kind===0) {
      let lo=-Infinity,hi=Infinity;
      for(let axis=0;axis<3;axis++) {
        // Local coordinate along this axis of the point (X, t, Z): o + t d.
        const o=R[axis]*X+R[6+axis]*Z,d=R[3+axis],h=axis===0?entry.hx:axis===1?entry.hy:entry.hz;
        if(Math.abs(d)<1e-12){if(Math.abs(o)>=h)return false;continue;}
        const a=(-h-o)/d,b=(h-o)/d;
        if(a<b){if(a>lo)lo=a;if(b<hi)hi=b;}else{if(b>lo)lo=b;if(a<hi)hi=a;}
      }
      if(!(hi>lo))return false;
      chord[0]=lo;chord[1]=hi;
      return true;
    }
    const ax=R[1],ay=R[4],az=R[7],r=entry.radius,L=entry.halfLength;
    let lo=Infinity,hi=-Infinity;
    // The cylinder between the cap centres.
    const along=X*ax+Z*az,A=1-ay*ay;
    if(A<1e-12) {
      if(X*X+Z*Z<r*r){lo=-L;hi=L;}
    } else {
      // |w + t d|^2 = r^2 with w and d the parts of (X, 0, Z) and (0, 1, 0) perpendicular to the axis.
      const wx=X-along*ax,wy=-along*ay,wz=Z-along*az,B=wx*(-ay*ax)+wy*A+wz*(-ay*az),C=wx*wx+wy*wy+wz*wz-r*r,disc=B*B-A*C;
      if(disc>0) {
        const root=Math.sqrt(disc);
        let t0=(-B-root)/A,t1=(-B+root)/A;
        if(Math.abs(ay)<1e-12){if(Math.abs(along)>L)t1=t0-1;}
        else {
          const s0=(-L-along)/ay,s1=(L-along)/ay,smin=s0<s1?s0:s1,smax=s0<s1?s1:s0;
          if(smin>t0)t0=smin;if(smax<t1)t1=smax;
        }
        if(t1>t0){lo=t0;hi=t1;}
      }
    }
    for(let side=-1;side<=1;side+=2) {
      const sxc=X-side*L*ax,syc=side*L*ay,szc=Z-side*L*az,d=r*r-sxc*sxc-szc*szc;
      if(d<=0)continue;
      const half=Math.sqrt(d);
      if(syc-half<lo)lo=syc-half;
      if(syc+half>hi)hi=syc+half;
    }
    if(!(hi>lo))return false;
    chord[0]=lo;chord[1]=hi;
    return true;
  }

  private clipShape(entry:Entry<B>,cx:number,cy:number,cz:number,Nx:number,Ny:number,Nz:number,centreDistance:number):number {
    return entry.kind===0?this.clipBox(entry,cx,cy,cz,Nx,Ny,Nz,centreDistance):entry.kind===1?this.clipSphere(entry,cx,cy,cz,Nx,Ny,Nz,centreDistance):this.clipCapsule(entry,cx,cy,cz,Nx,Ny,Nz,centreDistance);
  }

  /** Volume of the box on the side N.p <= plane, by clipping its faces; centroid in this.clip. */
  private clipBox(entry:Entry<B>,cx:number,cy:number,cz:number,Nx:number,Ny:number,Nz:number,centreDistance:number):number {
    const R=this.rot,corners=this.corners,distance=this.cornerDistance,out=this.clip;
    let below=0;
    for(let k=0;k<8;k++) {
      const lx=k&1?entry.hx:-entry.hx,ly=k&2?entry.hy:-entry.hy,lz=k&4?entry.hz:-entry.hz;
      // Corner relative to the body's centre.
      const x=R[0]*lx+R[1]*ly+R[2]*lz,y=R[3]*lx+R[4]*ly+R[5]*lz,z=R[6]*lx+R[7]*ly+R[8]*lz;
      corners[3*k]=x;corners[3*k+1]=y;corners[3*k+2]=z;
      distance[k]=centreDistance+Nx*x+Ny*y+Nz*z;
      if(distance[k]<=0)below++;
    }
    if(below===0)return 0;
    if(below===8){out[0]=cx;out[1]=cy;out[2]=cz;return entry.volume;}
    // Tetrahedra from q, the centre's projection on the plane, to each clipped face. The cut face contributes nothing.
    const qx=-centreDistance*Nx,qy=-centreDistance*Ny,qz=-centreDistance*Nz,polygon=this.polygon;
    let volume=0,mx=0,my=0,mz=0;
    for(let face=0;face<6;face++) {
      let count=0;
      for(let e=0;e<4;e++) {
        const a=BOX_FACES[face*4+e],b=BOX_FACES[face*4+(e+1)%4],da=distance[a],db=distance[b];
        if(da<=0){polygon[3*count]=corners[3*a];polygon[3*count+1]=corners[3*a+1];polygon[3*count+2]=corners[3*a+2];count++;}
        if((da<=0)!==(db<=0)) {
          const t=da/(da-db);
          polygon[3*count]=corners[3*a]+t*(corners[3*b]-corners[3*a]);
          polygon[3*count+1]=corners[3*a+1]+t*(corners[3*b+1]-corners[3*a+1]);
          polygon[3*count+2]=corners[3*a+2]+t*(corners[3*b+2]-corners[3*a+2]);
          count++;
        }
      }
      if(count<3)continue;
      const ax=polygon[0]-qx,ay=polygon[1]-qy,az=polygon[2]-qz;
      for(let n=1;n+1<count;n++) {
        const bx=polygon[3*n]-qx,by=polygon[3*n+1]-qy,bz=polygon[3*n+2]-qz,ex=polygon[3*n+3]-qx,ey=polygon[3*n+4]-qy,ez=polygon[3*n+5]-qz;
        const tetra=(ax*(by*ez-bz*ey)+ay*(bz*ex-bx*ez)+az*(bx*ey-by*ex))/6;
        volume+=tetra;
        // Centroid of the tetrahedron relative to q is (a + b + e) / 4.
        mx+=tetra*(ax+bx+ex)*0.25;my+=tetra*(ay+by+ey)*0.25;mz+=tetra*(az+bz+ez)*0.25;
      }
    }
    if(!(volume>0))return 0;
    out[0]=cx+qx+mx/volume;out[1]=cy+qy+my/volume;out[2]=cz+qz+mz/volume;
    return volume;
  }

  /** Spherical cap below the plane; centroid in this.clip. */
  private clipSphere(entry:Entry<B>,cx:number,cy:number,cz:number,Nx:number,Ny:number,Nz:number,centreDistance:number):number {
    const r=entry.radius,out=this.clip;
    let h=r-centreDistance;
    if(h<=0)return 0;
    if(h>2*r)h=2*r;
    const offset=0.75*(2*r-h)*(2*r-h)/(3*r-h);
    out[0]=cx-Nx*offset;out[1]=cy-Ny*offset;out[2]=cz-Nz*offset;
    return Math.PI*h*h*(3*r-h)/3;
  }

  /** Capsule below the plane: discs perpendicular to the axis, each cut by the plane in a circular
   * segment, integrated along the axis by Gauss-Legendre between the points where the cut changes form. */
  private clipCapsule(entry:Entry<B>,cx:number,cy:number,cz:number,Nx:number,Ny:number,Nz:number,centreDistance:number):number {
    const R=this.rot,r=entry.radius,L=entry.halfLength,out=this.clip,breaks=this.breaks;
    let ax=R[1],ay=R[4],az=R[7],cos=Nx*ax+Ny*ay+Nz*az;
    if(cos<0){ax=-ax;ay=-ay;az=-az;cos=-cos;}
    if(cos>1)cos=1;
    const sin=Math.sqrt(1-cos*cos),end=L+r;
    if(centreDistance-cos*L-r>=0)return 0;
    let count=0;
    breaks[count++]=-end;breaks[count++]=-L;breaks[count++]=L;breaks[count++]=end;
    if(cos>1e-12) {
      // The cylinder's discs start or stop being cut where the centre is r sin(theta) from the plane.
      const t0=(-r*sin-centreDistance)/cos,t1=(r*sin-centreDistance)/cos;
      if(t0>-L&&t0<L)breaks[count++]=t0;
      if(t1>-L&&t1<L&&t1!==t0)breaks[count++]=t1;
    }
    for(let side=-1;side<=1;side+=2) {
      // In a cap, with tau measured from the cap centre: tau = -s cos(theta) +- sin(theta) sqrt(r^2 - s^2).
      const s=centreDistance+cos*side*L,d=r*r-s*s;
      if(d<=0)continue;
      const root=sin*Math.sqrt(d);
      for(let sign=-1;sign<=1;sign+=2) {
        const tau=-s*cos+sign*root;
        if(side*tau>0&&side*tau<r)breaks[count++]=side*L+tau;
        if(root===0)break;
      }
    }
    for(let i=1;i<count;i++){const value=breaks[i];let j=i-1;while(j>=0&&breaks[j]>value){breaks[j+1]=breaks[j];j--;}breaks[j+1]=value;}
    const nodes=GAUSS.nodes,weights=GAUSS.weights;
    let volume=0,alongMoment=0,acrossMoment=0;
    for(let piece=0;piece+1<count;piece++) {
      const a=breaks[piece],b=breaks[piece+1],half=0.5*(b-a),mid=0.5*(a+b);
      if(!(half>0))continue;
      for(let k=0;k<GAUSS_ORDER;k++) {
        const t=mid+half*nodes[k],over=Math.abs(t)-L,rho2=over>0?r*r-over*over:r*r;
        if(rho2<=0)continue;
        const rho=Math.sqrt(rho2),centre=centreDistance+cos*t,reach=rho*sin;
        let area:number,moment=0;
        if(centre+reach<=0)area=Math.PI*rho2;
        else if(centre-reach>=0)continue;
        else {
          const h=-centre/sin,ratio=h/rho,c=ratio>1?1:ratio< -1?-1:ratio,chord=Math.sqrt(rho2-h*h>0?rho2-h*h:0);
          area=rho2*Math.acos(-c)+h*chord;moment=-2/3*chord*chord*chord;
        }
        const weight=half*weights[k];
        volume+=weight*area;alongMoment+=weight*area*t;acrossMoment+=weight*moment;
      }
    }
    if(!(volume>0))return 0;
    if(volume>entry.volume)volume=entry.volume;
    // Unit vector in the disc's plane pointing out of the water.
    const scale=sin>1e-12?1/sin:0,ex=(Nx-cos*ax)*scale,ey=(Ny-cos*ay)*scale,ez=(Nz-cos*az)*scale;
    const along=alongMoment/volume,across=acrossMoment/volume;
    out[0]=cx+ax*along+ex*across;out[1]=cy+ay*along+ey*across;out[2]=cz+az*along+ez*across;
    return volume;
  }
}
