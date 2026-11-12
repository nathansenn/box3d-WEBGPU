/**
 * Volumetric incompressible flow (float64, JavaScript, deterministic). SI units.
 *
 *   du/dt + (u . grad) u = - grad p / rho + nu lap u + g + f,      div u = 0
 *
 * `Fluid` solves these on a uniform staggered (MAC) grid of cubic cells: pressure at cell centres, each velocity
 * component on the faces normal to it. One step is an incremental pressure-correction projection:
 *
 *   u*  = u^n + dt [ -A + (1 - theta) nu L u^n + theta nu L u* - grad p^n / rho + g + f ]     (+ obstacle constraint)
 *   A   = advection: 2nd-order central differences in conservative (flux) form, Adams-Bashforth 2 in time
 *         ('upwind': first-order donor cell, for under-resolved flow)
 *   theta = 0 ('explicit'), 1/2 ('crank-nicolson'), 1 ('backward-euler'); the implicit parts are solved by Jacobi-
 *         preconditioned conjugate gradients
 *   L phi = (rho / dt) div u*,  u^{n+1} = u* - (dt / rho) grad phi,  p^{n+1} = p^n + phi
 *
 * The pressure Poisson equation is solved by conjugate gradients preconditioned with modified incomplete Cholesky
 * MIC(0), to a tolerance on the divergence left after the projection.
 *
 * Boundaries, per side of the box: 'no-slip' (a wall, which may slide: the lid of a cavity), 'free-slip', 'inflow'
 * (velocity given), 'outflow' (p = 0 and zero normal gradient of the velocity) and 'periodic' (both sides of an axis).
 *
 * Obstacles (spheres, boxes, capsules, cylinders), fixed or moving, are a fictitious domain: the grid covers them and
 * the pressure is solved through them. Velocity faces inside an obstacle take its rigid velocity; those next to fluid
 * take the value extrapolated, linearly in the signed distance, from the fluid face beyond, so that the velocity on the
 * surface is the rigid one. The force on an obstacle is the momentum this constraint removes from the fluid, minus
 * the change of momentum of the fluid inside the obstacle (solid fraction alpha, a linear ramp of the signed distance
 * over one cell), minus the weight of the fluid it displaces:
 *
 *   F = ( - J + (M_k - M_{k-1}) ) / dt - rho V_b (g + f),      J = sum_faces rho dV (u*_constrained - u*_free)
 *
 * which is, by the divergence theorem, the pressure and viscous traction integrated over the obstacle's surface (see
 * docs/FLUID.md). The same numbers with opposite signs are what the fluid receives, so a coupled rigid body and the
 * fluid exchange equal and opposite momentum. `controlVolumeForce` integrates momentum flux, pressure and viscous
 * stress over a box of faces around a body, as an independent check.
 *
 * `FluidCoupling` joins the solver to a rigid world (the rigid bodies are moving obstacles; the world receives the force
 * and torque); `fluidSubsystem` plugs either into the one stepping loop (simulation.ts), `freeSurfaceSubsystem` a
 * `FreeSurfaceFluid` tank. The scene format's `fluids` section builds them (simulation.ts `loadSimulationScene`). A step uses only +, -, *, /,
 * the square root and fixed loop orders, so repeat runs are bit-identical.
 *
 * See docs/FLUID.md for the equations, the validation and the limits.
 */
import {EngineError} from './contracts.ts';
import type {Subsystem} from './simulation.ts';

export const FLUID_SOLVER_ID='fluid-mac-projection-mic-pcg-js-f64-v1';
export const FLUID_COUPLING_BACKEND='rigid-fluid-coupling-fictitious-domain-js-f64-v1';
export const FLUID_MAX_CELLS=1<<24;

export type FluidVec3=readonly [number,number,number];
export type FluidBoundaryType='no-slip'|'free-slip'|'inflow'|'outflow'|'periodic';
export interface FluidBoundary {
  readonly type:FluidBoundaryType;
  /** 'no-slip': the wall's velocity (its normal part must be zero); 'inflow': the velocity that enters, constant or a function of the position on the side. */
  readonly velocity?:FluidVec3|((x:number,y:number,z:number)=>FluidVec3);
}
export interface FluidBoundaries {
  readonly xMin?:FluidBoundaryType|FluidBoundary;readonly xMax?:FluidBoundaryType|FluidBoundary;
  readonly yMin?:FluidBoundaryType|FluidBoundary;readonly yMax?:FluidBoundaryType|FluidBoundary;
  readonly zMin?:FluidBoundaryType|FluidBoundary;readonly zMax?:FluidBoundaryType|FluidBoundary;
}
export type FluidShape=
  |{readonly kind:'sphere';readonly radius:number}
  |{readonly kind:'box';readonly halfExtents:FluidVec3}
  /** Axis along the local Y; halfLength is half the distance between the cap centres. */
  |{readonly kind:'capsule';readonly radius:number;readonly halfLength:number}
  /** A solid cylinder with flat ends, axis along the local Y. */
  |{readonly kind:'cylinder';readonly radius:number;readonly halfLength:number};
export interface FluidObstacleState {
  readonly position:ArrayLike<number>;
  /** Quaternion x, y, z, w. */
  readonly rotation?:ArrayLike<number>;
  readonly linearVelocity?:ArrayLike<number>;
  readonly angularVelocity?:ArrayLike<number>;
}
export interface FluidObstacleOptions extends Partial<FluidObstacleState> {readonly shape:FluidShape}
export interface FluidOptions {
  /** Cells along x, y and z. A 2D flow is one cell along z with periodic z sides. */
  readonly cells:FluidVec3;
  /** Edge of the cubic cells, m. */
  readonly spacing:number;
  /** Corner of the grid with the smallest coordinates, m. Default [0, 0, 0]. */
  readonly origin?:FluidVec3;
  /** kg/m^3. */
  readonly density:number;
  /** Dynamic viscosity mu, Pa s. The kinematic viscosity is mu / density. */
  readonly viscosity:number;
  /** Time step, s. */
  readonly dt:number;
  /** m/s^2. Default [0, -9.81, 0]. */
  readonly gravity?:FluidVec3;
  /** A uniform body acceleration besides gravity (a driving pressure gradient over density), m/s^2. Default zero. */
  readonly bodyForce?:FluidVec3;
  /** Default: no-slip on every side. */
  readonly boundaries?:FluidBoundaries;
  /** Default 'central'. */
  readonly advection?:'central'|'upwind'|'none';
  /** Default 'explicit'. */
  readonly diffusion?:'explicit'|'crank-nicolson'|'backward-euler';
  /** The projection stops when max |div u| h is below this fraction of the largest velocity. Default 1e-10. */
  readonly pressureTolerance?:number;
  /** Relative tolerance of the implicit viscous solves (infinity norm of the residual over that of the right side). Default 1e-10. */
  readonly viscousTolerance?:number;
  /** Most conjugate-gradient iterations per solve. Default 4000. */
  readonly maxIterations?:number;
  /** Largest Courant number dt (|u| + |v| + |w|) / h accepted. Default 1. */
  readonly cflLimit?:number;
  /** Accept a time step above the explicit viscous limit or a starting Courant number above cflLimit, with stats.unstable raised, instead of refusing. */
  readonly allowUnstable?:boolean;
}
export interface FluidStats {
  steps:number;
  /** Iterations and final relative divergence (max |div u| h / max |u|) of the last projection. */
  pressureIterations:number;divergence:number;
  /** Iterations of the last implicit viscous solves (sum over components). */
  viscousIterations:number;
  /** Courant number of the last step, and the largest since creation. */
  cfl:number;maxCfl:number;
  /** Steps whose Courant number exceeded cflLimit, and projections that hit maxIterations. */
  cflExceeded:number;unconverged:number;
  /** True when the solver was accepted above a stability limit (allowUnstable). */
  unstable:boolean;
}
export interface FluidTimeStepLimits {
  /** Explicit diffusion limit h^2 / (2 d nu), d the number of active axes; Infinity for implicit diffusion. */
  readonly viscous:number;
  /** cflLimit h / (|u| + |v| + |w|) for the largest velocity on the grid, its walls, inflows and obstacles; Infinity at rest. */
  readonly advective:number;
}

const fail=(message:string):never=>{throw new EngineError('INVALID_PAYLOAD',message);};
const num=(value:unknown,label:string,min:number,max:number):number=>{
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${label} must be a finite number in [${min}, ${max}].`);
  return value as number;
};
const vec=(value:unknown,label:string):[number,number,number]=>{
  if(!value||typeof (value as ArrayLike<number>).length!=='number'||(value as ArrayLike<number>).length!==3)fail(`${label} must be three numbers.`);
  const v=value as ArrayLike<number>;
  return [num(v[0],`${label}[0]`,-Infinity,Infinity),num(v[1],`${label}[1]`,-Infinity,Infinity),num(v[2],`${label}[2]`,-Infinity,Infinity)];
};
// The rigid world works in float32 and refuses a nonzero component too small for one: hand over an exact zero instead.
const flush=(value:number):number=>Math.fround(value)===0?0:value;

// Face kinds of a velocity component (padded storage).
const GHOST=0,UNKNOWN=1,FIXED=2,COPY=3,OUTFLOW=4;
/** Faces within this many cells of an obstacle's surface are examined. */
const BAND=1.5;
const SIDES=['xMin','xMax','yMin','yMax','zMin','zMax'] as const;

interface Side {readonly type:FluidBoundaryType;readonly velocity:FluidVec3|((x:number,y:number,z:number)=>FluidVec3)}

interface Obstacle {
  readonly shape:FluidShape;
  readonly x:Float64Array;readonly q:Float64Array;readonly v:Float64Array;readonly w:Float64Array;readonly R:Float64Array;
  /** Bounding radius, m. */
  readonly reach:number;
  moved:boolean;enabled:boolean;
  /** Last step: constraint impulse on the fluid (linear, angular about x), momentum inside (now and before), force and torque on the obstacle. */
  readonly J:Float64Array;readonly M:Float64Array;readonly Mprev:Float64Array;readonly force:Float64Array;readonly torque:Float64Array;
  /** Sum of the force and torque times dt since the last reset. */
  readonly impulse:Float64Array;
  /** Fluid volume displaced per velocity component (sum alpha dV), m^3, and its first moment, for the buoyancy. */
  readonly vol:Float64Array;readonly moment:Float64Array;
  started:boolean;
}

function rotationMatrix(q:ArrayLike<number>,R:Float64Array):void {
  const x=q[0],y=q[1],z=q[2],w=q[3],n=Math.sqrt(x*x+y*y+z*z+w*w)||1,a=x/n,b=y/n,c=z/n,d=w/n;
  R[0]=1-2*(b*b+c*c);R[1]=2*(a*b-c*d);R[2]=2*(a*c+b*d);
  R[3]=2*(a*b+c*d);R[4]=1-2*(a*a+c*c);R[5]=2*(b*c-a*d);
  R[6]=2*(a*c-b*d);R[7]=2*(b*c+a*d);R[8]=1-2*(a*a+b*b);
}
/** Signed distance from a point given in the obstacle's frame (relative position px, py, pz in world axes). */
function shapeDistance(o:Obstacle,px:number,py:number,pz:number):number {
  const s=o.shape,R=o.R;
  if(s.kind==='sphere')return Math.sqrt(px*px+py*py+pz*pz)-s.radius;
  // Local coordinates: R^T p.
  const lx=R[0]*px+R[3]*py+R[6]*pz,ly=R[1]*px+R[4]*py+R[7]*pz,lz=R[2]*px+R[5]*py+R[8]*pz;
  if(s.kind==='box'){
    const dx=Math.abs(lx)-s.halfExtents[0],dy=Math.abs(ly)-s.halfExtents[1],dz=Math.abs(lz)-s.halfExtents[2];
    const ox=dx>0?dx:0,oy=dy>0?dy:0,oz=dz>0?dz:0,inside=Math.max(dx,dy,dz);
    return Math.sqrt(ox*ox+oy*oy+oz*oz)+(inside<0?inside:0);
  }
  if(s.kind==='capsule'){
    const cy=ly>s.halfLength?s.halfLength:ly<-s.halfLength?-s.halfLength:ly,dy=ly-cy;
    return Math.sqrt(lx*lx+dy*dy+lz*lz)-s.radius;
  }
  const dr=Math.sqrt(lx*lx+lz*lz)-s.radius,dy=Math.abs(ly)-s.halfLength;
  const or=dr>0?dr:0,oy=dy>0?dy:0;
  return Math.sqrt(or*or+oy*oy)+Math.min(Math.max(dr,dy),0);
}
function shapeReach(s:FluidShape):number {
  switch(s.kind){
    case 'sphere':return num(s.radius,'radius',1e-12,1e6);
    case 'box':{const h=vec(s.halfExtents,'halfExtents');h.forEach(v=>num(v,'halfExtents',1e-12,1e6));return Math.hypot(h[0],h[1],h[2]);}
    case 'capsule':return num(s.radius,'radius',1e-12,1e6)+num(s.halfLength,'halfLength',0,1e6);
    case 'cylinder':return Math.hypot(num(s.radius,'radius',1e-12,1e6),num(s.halfLength,'halfLength',1e-12,1e6));
    default:return fail('An obstacle shape is a sphere, box, capsule or cylinder.');
  }
}
/** Volume of a shape, m^3. */
export function fluidShapeVolume(s:FluidShape):number {
  switch(s.kind){
    case 'sphere':return 4/3*Math.PI*s.radius**3;
    case 'box':return 8*s.halfExtents[0]*s.halfExtents[1]*s.halfExtents[2];
    case 'capsule':return Math.PI*s.radius**2*(2*s.halfLength+4/3*s.radius);
    case 'cylinder':return 2*Math.PI*s.radius**2*s.halfLength;
  }
}

/** Incompressible Navier-Stokes on a staggered grid. See the file header and docs/FLUID.md. */
export class Fluid {
  readonly solver=FLUID_SOLVER_ID;
  readonly nx:number;readonly ny:number;readonly nz:number;readonly h:number;
  readonly origin:FluidVec3;readonly density:number;readonly viscosity:number;readonly nu:number;readonly dt:number;
  readonly gravity:Float64Array;readonly bodyForce:Float64Array;
  readonly advection:'central'|'upwind'|'none';readonly diffusion:'explicit'|'crank-nicolson'|'backward-euler';
  readonly theta:number;readonly pressureTolerance:number;readonly viscousTolerance:number;readonly maxIterations:number;readonly cflLimit:number;
  readonly sides:readonly Side[];
  /** Padded dimensions (one ghost layer each side) and strides. */
  readonly NX:number;readonly NY:number;readonly NZ:number;readonly size:number;readonly stride:readonly [number,number,number];
  /** Strides used by the stencils: zero along an axis of one periodic cell, whose neighbours are the cell itself. */
  private readonly es:readonly [number,number,number];
  /** Face velocities, padded: u[i,j,k] is on the face at x = origin + i h, y and z at cell centres. */
  readonly u:Float64Array;readonly v:Float64Array;readonly w:Float64Array;
  readonly vel:readonly [Float64Array,Float64Array,Float64Array];
  /** Pressure at cell centres, Pa, compact (i + nx (j + ny k)). Relative: its mean is zero unless a side is an outflow. */
  readonly p:Float64Array;
  readonly cells:number;
  readonly stats:FluidStats={steps:0,pressureIterations:0,divergence:0,viscousIterations:0,cfl:0,maxCfl:0,cflExceeded:0,unconverged:0,unstable:false};
  time=0;
  /** Energy ledger, J: viscous dissipation, work by obstacles and coupled bodies, by moving walls and open sides, by body forces. */
  dissipated=0;workByBodies=0;workByBoundaries=0;workByForces=0;
  private readonly kind:[Uint8Array,Uint8Array,Uint8Array];
  private readonly unknown:Int32Array[]=[];
  private readonly copies:Int32Array[]=[];private readonly outflows:Int32Array[]=[];
  private readonly fixedFaces:Int32Array[]=[];private readonly fixedValues:Float64Array[]=[];
  private readonly ghostDst:Int32Array[]=[];private readonly ghostSrc:Int32Array[]=[];private readonly ghostA:Float64Array[]=[];private readonly ghostB:Float64Array[]=[];
  private readonly gradFace:Int32Array[]=[];private readonly gradLow:Int32Array[]=[];private readonly gradHigh:Int32Array[]=[];private readonly gradWL:Float64Array[]=[];private readonly gradWH:Float64Array[]=[];
  private readonly cellPad:Int32Array;private readonly nbr:Int32Array;private readonly diag:Float64Array;private readonly plus:Uint8Array;private readonly lowMask:Uint8Array;private readonly precon:Float64Array;
  private readonly singular:boolean;private readonly activeAxes:number;
  private readonly adv:[Float64Array,Float64Array,Float64Array];private readonly advPrev:[Float64Array,Float64Array,Float64Array];private hasPrev=false;
  private readonly rhs:Float64Array;private readonly cr:Float64Array;private readonly cz:Float64Array;private readonly cd:Float64Array;private readonly cq:Float64Array;private readonly phi:Float64Array;
  private readonly wx:Float64Array;private readonly wr:Float64Array;private readonly wz:Float64Array;private readonly wd:Float64Array;private readonly wq:Float64Array;private readonly wb:Float64Array;private readonly pred:[Float64Array,Float64Array,Float64Array];private readonly pen:Float64Array;
  private readonly alpha:[Float64Array,Float64Array,Float64Array];private readonly dist:[Float64Array,Float64Array,Float64Array];private readonly mode:[Uint8Array,Uint8Array,Uint8Array];private readonly outFace:[Int32Array,Int32Array,Int32Array];private readonly weight:[Float64Array,Float64Array,Float64Array];private readonly value:Float64Array;private readonly owner:[Int32Array,Int32Array,Int32Array];private readonly target:[Float64Array,Float64Array,Float64Array];
  private readonly solidFaces:number[][]=[[],[],[]];
  private readonly obstacles:Obstacle[]=[];
  private obstaclesDirty=true;private ledgerRate=-1;private boundaryRate=-1;

  constructor(options:FluidOptions) {
    if(!options||typeof options!=='object')fail('Fluid needs options.');
    const cells=vec(options.cells,'cells');
    for(const c of cells)if(!Number.isInteger(c)||c<1)fail('cells must be positive integers.');
    this.nx=cells[0];this.ny=cells[1];this.nz=cells[2];this.cells=this.nx*this.ny*this.nz;
    if(this.cells>FLUID_MAX_CELLS)fail(`At most ${FLUID_MAX_CELLS} cells.`);
    this.h=num(options.spacing,'spacing',1e-9,1e6);
    this.origin=options.origin?vec(options.origin,'origin'):[0,0,0];
    this.density=num(options.density,'density',1e-6,1e6);
    this.viscosity=num(options.viscosity,'viscosity',0,1e9);this.nu=this.viscosity/this.density;
    this.dt=num(options.dt,'dt',1e-12,1e3);
    this.gravity=new Float64Array(options.gravity?vec(options.gravity,'gravity'):[0,-9.81,0]);
    this.bodyForce=new Float64Array(options.bodyForce?vec(options.bodyForce,'bodyForce'):[0,0,0]);
    this.advection=options.advection??'central';
    if(!['central','upwind','none'].includes(this.advection))fail("advection is 'central', 'upwind' or 'none'.");
    this.diffusion=options.diffusion??'explicit';
    if(!['explicit','crank-nicolson','backward-euler'].includes(this.diffusion))fail("diffusion is 'explicit', 'crank-nicolson' or 'backward-euler'.");
    this.theta=this.diffusion==='explicit'?0:this.diffusion==='crank-nicolson'?.5:1;
    this.pressureTolerance=num(options.pressureTolerance??1e-10,'pressureTolerance',1e-15,1e-2);
    this.viscousTolerance=num(options.viscousTolerance??1e-10,'viscousTolerance',1e-15,1e-2);
    this.maxIterations=num(options.maxIterations??4000,'maxIterations',1,1e7);
    this.cflLimit=num(options.cflLimit??1,'cflLimit',1e-6,100);
    const given=(options.boundaries??{}) as FluidBoundaries;
    for(const key of Object.keys(given))if(!(SIDES as readonly string[]).includes(key))fail(`boundaries.${key} is not a side (xMin, xMax, yMin, yMax, zMin, zMax).`);
    this.sides=SIDES.map(key=>{
      const raw=given[key]??'no-slip',b:FluidBoundary=typeof raw==='string'?{type:raw}:raw;
      if(!['no-slip','free-slip','inflow','outflow','periodic'].includes(b.type))fail(`boundaries.${key}: unknown type "${String(b.type)}".`);
      const velocity=b.velocity??[0,0,0];
      if(typeof velocity!=='function')vec(velocity,`boundaries.${key}.velocity`);
      if(b.type==='inflow'&&b.velocity===undefined)fail(`boundaries.${key}: an inflow needs a velocity.`);
      return {type:b.type,velocity};
    });
    for(let a=0;a<3;a++)if((this.sides[2*a].type==='periodic')!==(this.sides[2*a+1].type==='periodic'))fail(`Axis ${'xyz'[a]}: periodic must be set on both sides.`);
    for(let a=0;a<3;a++)for(let s=0;s<2;s++){
      const side=this.sides[2*a+s];
      if(side.type==='no-slip'&&typeof side.velocity!=='function'&&side.velocity[a]!==0)fail(`boundaries.${SIDES[2*a+s]}: a wall cannot move along its normal.`);
      if(side.type==='no-slip'&&typeof side.velocity==='function')fail(`boundaries.${SIDES[2*a+s]}: a wall's velocity is a constant vector.`);
    }
    const n=[this.nx,this.ny,this.nz];
    this.NX=this.nx+2;this.NY=this.ny+2;this.NZ=this.nz+2;this.size=this.NX*this.NY*this.NZ;this.stride=[1,this.NX,this.NX*this.NY];
    const P=this.size;
    this.es=[0,1,2].map(a=>n[a]===1&&this.sides[2*a].type==='periodic'?0:this.stride[a]) as [number,number,number];
    this.u=new Float64Array(P);this.v=new Float64Array(P);this.w=new Float64Array(P);this.vel=[this.u,this.v,this.w];
    this.p=new Float64Array(this.cells);
    this.kind=[new Uint8Array(P),new Uint8Array(P),new Uint8Array(P)];
    this.adv=[new Float64Array(P),new Float64Array(P),new Float64Array(P)];this.advPrev=[new Float64Array(P),new Float64Array(P),new Float64Array(P)];
    this.alpha=[new Float64Array(P),new Float64Array(P),new Float64Array(P)];this.owner=[new Int32Array(P).fill(-1),new Int32Array(P).fill(-1),new Int32Array(P).fill(-1)];
    this.target=[new Float64Array(P),new Float64Array(P),new Float64Array(P)];
    this.dist=[new Float64Array(P).fill(Infinity),new Float64Array(P).fill(Infinity),new Float64Array(P).fill(Infinity)];this.mode=[new Uint8Array(P),new Uint8Array(P),new Uint8Array(P)];
    this.outFace=[new Int32Array(P),new Int32Array(P),new Int32Array(P)];this.weight=[new Float64Array(P),new Float64Array(P),new Float64Array(P)];this.value=new Float64Array(P);
    this.pred=[new Float64Array(P),new Float64Array(P),new Float64Array(P)];this.pen=new Float64Array(P);this.rhs=new Float64Array(P);this.wx=new Float64Array(P);this.wr=new Float64Array(P);this.wz=new Float64Array(P);this.wd=new Float64Array(P);this.wq=new Float64Array(P);this.wb=new Float64Array(P);
    const N=this.cells;
    this.cr=new Float64Array(N);this.cz=new Float64Array(N);this.cd=new Float64Array(N);this.cq=new Float64Array(N);this.phi=new Float64Array(N);
    this.activeAxes=[0,1,2].filter(a=>!(n[a]===1&&this.sides[2*a].type==='periodic')).length||1;
    const viscousLimit=this.theta>0||this.nu===0?Infinity:this.h*this.h/(2*this.activeAxes*this.nu);
    if(this.dt>viscousLimit*(1+1e-12)){
      if(!options.allowUnstable)throw new EngineError('UNSTABLE_TIME_STEP',`The step ${this.dt} s is above the explicit viscous limit h^2 / (2 d nu) = ${viscousLimit} s. Use a smaller dt, diffusion 'crank-nicolson' or 'backward-euler', or allowUnstable.`);
      this.stats.unstable=true;
    }
    // Faces.
    const id=(i:number,j:number,k:number)=>(i+1)+this.NX*((j+1)+this.NY*(k+1));
    for(let c=0;c<3;c++){
      const kind=this.kind[c],unk:number[]=[],cop:number[]=[],out:number[]=[],fix:number[]=[],fixV:number[]=[];
      const lo=this.sides[2*c],hi=this.sides[2*c+1];
      for(let k=-1;k<=n[2];k++)for(let j=-1;j<=n[1];j++)for(let i=-1;i<=n[0];i++){
        const idx=[i,j,k],f=id(i,j,k);let inside=true;
        for(let d=0;d<3;d++)if(d!==c&&(idx[d]<0||idx[d]>=n[d]))inside=false;
        const ic=idx[c];
        if(!inside||ic<0){kind[f]=GHOST;continue;}
        const side=ic===0?lo:ic===n[c]?hi:null;
        if(!side){kind[f]=UNKNOWN;unk.push(f);continue;}
        if(side.type==='periodic'){if(ic===0){kind[f]=UNKNOWN;unk.push(f);}else{kind[f]=COPY;cop.push(f,f-n[c]*this.stride[c]);}continue;}
        if(side.type==='outflow'){kind[f]=OUTFLOW;out.push(f,ic===0?f+this.stride[c]:f-this.stride[c]);continue;}
        kind[f]=FIXED;fix.push(f);
        const x=this.facePosition(c,f);fixV.push(this.sideVelocity(side,x[0],x[1],x[2])[c]);
      }
      this.unknown.push(Int32Array.from(unk));this.copies.push(Int32Array.from(cop));this.outflows.push(Int32Array.from(out));
      this.fixedFaces.push(Int32Array.from(fix));this.fixedValues.push(Float64Array.from(fixV));
      // Ghosts, by passes over the axes so that edges and corners take their values from cells already filled.
      const gd:number[]=[],gs:number[]=[],ga:number[]=[],gb:number[]=[];
      for(let d=0;d<3;d++){
        for(let k=-1;k<=n[2];k++)for(let j=-1;j<=n[1];j++)for(let i=-1;i<=n[0];i++){
          const idx=[i,j,k],f=id(i,j,k),id_=idx[d];
          if(d===c){
            if(id_!==-1)continue;
            // The face below the low boundary face: only read by the stencils of periodic faces.
            const src=lo.type==='periodic'?f+n[c]*this.stride[c]:f+this.stride[c];
            gd.push(f);gs.push(src);ga.push(1);gb.push(0);continue;
          }
          if(id_!==-1&&id_!==n[d])continue;
          if(this.es[d]===0)continue;
          const side=this.sides[2*d+(id_===-1?0:1)];
          const src=side.type==='periodic'?(id_===-1?f+n[d]*this.stride[d]:f-n[d]*this.stride[d]):(id_===-1?f+this.stride[d]:f-this.stride[d]);
          let a=1,b=0;
          if(side.type==='no-slip'||side.type==='inflow'){
            const x=this.facePosition(c,f);x[d]=this.origin[d]+(id_===-1?0:n[d]*this.h);
            a=-1;b=2*this.sideVelocity(side,x[0],x[1],x[2])[c];
          }
          gd.push(f);gs.push(src);ga.push(a);gb.push(b);
        }
      }
      this.ghostDst.push(Int32Array.from(gd));this.ghostSrc.push(Int32Array.from(gs));this.ghostA.push(Float64Array.from(ga));this.ghostB.push(Float64Array.from(gb));
    }
    // Cells: neighbours for the pressure operator (closed wall: -1, p = 0 outflow side: -2), MIC(0) couplings.
    this.cellPad=new Int32Array(N);this.nbr=new Int32Array(6*N);this.diag=new Float64Array(N);this.plus=new Uint8Array(3*N);this.lowMask=new Uint8Array(N);this.precon=new Float64Array(N);
    let dirichlet=false;
    for(let k=0,c=0;k<this.nz;k++)for(let j=0;j<this.ny;j++)for(let i=0;i<this.nx;i++,c++){
      this.cellPad[c]=id(i,j,k);
      const idx=[i,j,k],cstride=[1,this.nx,this.nx*this.ny];let diag=0;
      for(let d=0;d<3;d++)for(let s=0;s<2;s++){
        const at=idx[d]+(s?1:0),boundary=at===0||at===n[d];
        let nb:number;
        if(!boundary)nb=c+(s?1:-1)*cstride[d];
        else{
          const side=this.sides[2*d+s];
          if(side.type==='periodic')nb=n[d]===1?-3:c+(s?-(n[d]-1):(n[d]-1))*cstride[d];
          else if(side.type==='outflow'){nb=-2;dirichlet=true;}
          else nb=-1;
        }
        this.nbr[6*c+2*d+s]=nb;
        if(nb>=0)diag+=1;else if(nb===-2)diag+=2;
        if(s===1&&!boundary)this.plus[3*c+d]=1;
      }
      this.diag[c]=diag;
    }
    this.singular=!dirichlet;
    for(let c=0;c<N;c++){const i=c%this.nx,j=Math.floor(c/this.nx)%this.ny,k=Math.floor(c/(this.nx*this.ny));this.lowMask[c]=(i>0&&this.plus[3*(c-1)]?1:0)|(j>0&&this.plus[3*(c-this.nx)+1]?2:0)|(k>0&&this.plus[3*(c-this.nx*this.ny)+2]?4:0);}
    this.buildPreconditioner();
    // Gradient faces: unknown and outflow faces, with the cells on either side (or -1 for the p = 0 side of an outflow).
    for(let c=0;c<3;c++){
      const faces:number[]=[],low:number[]=[],high:number[]=[],wl:number[]=[],wh:number[]=[];
      const padToCell=(f:number)=>{const i=f%this.NX-1,j=Math.floor(f/this.NX)%this.NY-1,k=Math.floor(f/(this.NX*this.NY))-1;return i+this.nx*(j+this.ny*k);};
      const list=[...this.unknown[c],...Array.from(this.outflows[c]).filter((_,q)=>q%2===0)];
      list.sort((a,b)=>a-b);
      for(const f of list){
        const idx=this.faceIndex(f),ic=idx[c];
        let hiCell=ic<n[c]?padToCell(f):-1,loCell=ic>0?padToCell(f-this.stride[c]):-1;
        if(ic===0&&this.sides[2*c].type==='periodic')loCell=padToCell(f+(n[c]-1)*this.stride[c]);
        const scale=1/this.h;
        faces.push(f);low.push(loCell);high.push(hiCell);
        wl.push(loCell<0?0:hiCell<0?2*scale:scale);wh.push(hiCell<0?0:loCell<0?2*scale:scale);
      }
      this.gradFace.push(Int32Array.from(faces));this.gradLow.push(Int32Array.from(low.map(x=>x<0?0:x)));this.gradHigh.push(Int32Array.from(high.map(x=>x<0?0:x)));
      this.gradWL.push(Float64Array.from(wl));this.gradWH.push(Float64Array.from(wh));
    }
    for(let c=0;c<3;c++){const f=this.fixedFaces[c],val=this.fixedValues[c],x=this.vel[c];for(let q=0;q<f.length;q++)x[f[q]]=val[q];}
    this.fillAll();
  }

  private sideVelocity(side:Side,x:number,y:number,z:number):FluidVec3 {
    if(side.type!=='no-slip'&&side.type!=='inflow')return [0,0,0];
    const v=typeof side.velocity==='function'?side.velocity(x,y,z):side.velocity;
    return vec(v,'boundary velocity');
  }
  /** Grid indices (i, j, k) of a padded index. */
  faceIndex(f:number):[number,number,number] {return [f%this.NX-1,Math.floor(f/this.NX)%this.NY-1,Math.floor(f/(this.NX*this.NY))-1];}
  /** Position of the face of component c at padded index f, m. */
  facePosition(c:number,f:number):[number,number,number] {
    const [i,j,k]=this.faceIndex(f),h=this.h,o=this.origin;
    return [o[0]+(i+(c===0?0:.5))*h,o[1]+(j+(c===1?0:.5))*h,o[2]+(k+(c===2?0:.5))*h];
  }
  /** Padded index of cell or face (i, j, k). */
  index(i:number,j:number,k:number):number {return (i+1)+this.NX*((j+1)+this.NY*(k+1));}

  /** Stable step limits for the current state. */
  maxTimeStep():FluidTimeStepLimits {
    const viscous=this.theta>0||this.nu===0?Infinity:this.h*this.h/(2*this.activeAxes*this.nu);
    const speed=this.maxSpeedSum();
    return {viscous,advective:speed>0?this.cflLimit*this.h/speed:Infinity};
  }
  /** Largest |u_c| over the real faces of component c, the walls and inflows included. */
  private maxComponent(c:number):number {
    let m=0;const x=this.vel[c],list=this.unknown[c],fix=this.fixedValues[c],b=this.ghostB[c];
    for(let q=0;q<list.length;q++){const a=x[list[q]];const v=a<0?-a:a;if(v>m)m=v;}
    for(let q=0;q<fix.length;q++){const v=Math.abs(fix[q]);if(v>m)m=v;}
    for(let q=0;q<b.length;q++){const v=Math.abs(.5*b[q]);if(v>m)m=v;}
    return m;
  }
  private maxSpeedSum():number {
    let total=0;
    for(let c=0;c<3;c++){
      let m=this.maxComponent(c);
      for(const o of this.obstacles){if(!o.enabled)continue;const s=Math.abs(o.v[c])+o.reach*Math.hypot(o.w[0],o.w[1],o.w[2]);if(s>m)m=s;}
      total+=m;
    }
    return total;
  }
  /** Throws UNSTABLE_TIME_STEP when the step is above either limit (unless allowUnstable was given, which only raises stats.unstable). */
  checkTimeStep(allowUnstable=this.stats.unstable):void {
    const {viscous,advective}=this.maxTimeStep();
    if(this.dt<=viscous*(1+1e-12)&&this.dt<=advective*(1+1e-12))return;
    if(allowUnstable){this.stats.unstable=true;return;}
    throw new EngineError('UNSTABLE_TIME_STEP',`The fluid step ${this.dt} s is above its limit: explicit viscous ${viscous} s, Courant (${this.cflLimit}) ${advective} s.`);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Initial conditions and boundary values.
  // ---------------------------------------------------------------------------------------------------------------

  /** Set every face velocity from a field (component c at each face's position). Not projected: call project() for a divergence-free start. */
  setVelocity(field:(x:number,y:number,z:number)=>ArrayLike<number>):void {
    for(let c=0;c<3;c++){
      const x=this.vel[c],kind=this.kind[c];
      for(let f=0;f<x.length;f++){if(kind[f]!==UNKNOWN&&kind[f]!==OUTFLOW)continue;const p=this.facePosition(c,f);x[f]=Number(field(p[0],p[1],p[2])[c]);}
    }
    this.hasPrev=false;this.fillAll();
  }
  /** Make the velocity divergence-free (one projection; the pressure is not changed). */
  project():void {this.copyOutflows();this.fillAll();this.projectVelocity(false);this.fillAll();}
  /** Set the pressure from a function of the cell centre, Pa. */
  setPressure(field:(x:number,y:number,z:number)=>number):void {
    for(let c=0;c<this.cells;c++){const [x,y,z]=this.cellCentre(c);this.p[c]=field(x,y,z);}
  }
  cellCentre(c:number):[number,number,number] {
    const i=c%this.nx,j=Math.floor(c/this.nx)%this.ny,k=Math.floor(c/(this.nx*this.ny)),h=this.h,o=this.origin;
    return [o[0]+(i+.5)*h,o[1]+(j+.5)*h,o[2]+(k+.5)*h];
  }
  /** Faces of component c in compact order: (nx + 1) ny nz for u, nx (ny + 1) nz for v, nx ny (nz + 1) for w, index i + Nx (j + Ny k) with that component's counts. */
  faceCount(c:0|1|2):number {const n=[this.nx,this.ny,this.nz];n[c]++;return n[0]*n[1]*n[2];}
  /**
   * The state a save needs: the face velocities in compact order (see `faceCount`) and the cell pressures. Copies.
   * Restoring it with `setState` gives the same velocity and pressure fields; the Adams-Bashforth history and the
   * energy ledger are not part of it (the first step after a restore advects by forward Euler, as the first step does).
   */
  getState():{u:Float64Array;v:Float64Array;w:Float64Array;pressure:Float64Array} {
    const out=[0,1,2].map(c=>{
      const n=[this.nx,this.ny,this.nz];n[c]++;
      const a=new Float64Array(n[0]*n[1]*n[2]),x=this.vel[c];let q=0;
      for(let k=0;k<n[2];k++)for(let j=0;j<n[1];j++)for(let i=0;i<n[0];i++)a[q++]=x[this.index(i,j,k)];
      return a;
    });
    return {u:out[0],v:out[1],w:out[2],pressure:Float64Array.from(this.p)};
  }
  /** Set the face velocities (compact order, see `faceCount`) and optionally the cell pressures. Wall, inflow and periodic-copy faces keep their own values. */
  setState(state:{readonly u:ArrayLike<number>;readonly v:ArrayLike<number>;readonly w:ArrayLike<number>;readonly pressure?:ArrayLike<number>}):void {
    const given=[state.u,state.v,state.w];
    for(let c=0;c<3;c++){
      const n=[this.nx,this.ny,this.nz];n[c]++;
      const a=given[c],x=this.vel[c],kind=this.kind[c];
      if(!a||a.length!==n[0]*n[1]*n[2])fail(`setState: ${'uvw'[c]} must hold ${n[0]*n[1]*n[2]} values.`);
      let q=0;
      for(let k=0;k<n[2];k++)for(let j=0;j<n[1];j++)for(let i=0;i<n[0];i++,q++){
        const f=this.index(i,j,k),value=Number(a[q]);
        if(!Number.isFinite(value))fail(`setState: ${'uvw'[c]}[${q}] is not a finite number.`);
        if(kind[f]===UNKNOWN||kind[f]===OUTFLOW)x[f]=value;
      }
    }
    if(state.pressure!==undefined){
      if(state.pressure.length!==this.cells)fail(`setState: pressure must hold ${this.cells} values.`);
      for(let c=0;c<this.cells;c++){const value=Number(state.pressure[c]);if(!Number.isFinite(value))fail(`setState: pressure[${c}] is not a finite number.`);this.p[c]=value;}
    }
    this.hasPrev=false;this.fillAll();
  }
  /** Signed distance from a point to the nearest enabled obstacle's surface, m (negative inside; Infinity with none). */
  obstacleDistance(x:number,y:number,z:number):number {
    let d=Infinity;
    for(const o of this.obstacles){if(!o.enabled)continue;const s=shapeDistance(o,x-o.x[0],y-o.x[1],z-o.x[2]);if(s<d)d=s;}
    return d;
  }

  private fillGhosts(c:number,x:Float64Array,homogeneous:boolean):void {
    const cop=this.copies[c];
    for(let q=0;q<cop.length;q+=2)x[cop[q]]=x[cop[q+1]];
    const d=this.ghostDst[c],s=this.ghostSrc[c],a=this.ghostA[c],b=this.ghostB[c];
    if(homogeneous)for(let q=0;q<d.length;q++)x[d[q]]=a[q]*x[s[q]];
    else for(let q=0;q<d.length;q++)x[d[q]]=a[q]*x[s[q]]+b[q];
  }
  private fillAll():void {for(let c=0;c<3;c++)this.fillGhosts(c,this.vel[c],false);}
  /** Outflow faces take their inner neighbour's value (zero normal gradient) before a projection corrects them. */
  private copyOutflows():void {for(let c=0;c<3;c++){const o=this.outflows[c],x=this.vel[c];for(let q=0;q<o.length;q+=2)x[o[q]]=x[o[q+1]];}}

  // ---------------------------------------------------------------------------------------------------------------
  // Obstacles.
  // ---------------------------------------------------------------------------------------------------------------

  /** Add a fixed or moving solid. Returns its index. Its velocity is that of a rigid body: linearVelocity + angularVelocity x r. */
  addObstacle(options:FluidObstacleOptions):number {
    if(!options||typeof options!=='object')fail('addObstacle needs options.');
    const reach=shapeReach(options.shape);
    const o:Obstacle={shape:options.shape,x:new Float64Array(3),q:new Float64Array([0,0,0,1]),v:new Float64Array(3),w:new Float64Array(3),R:new Float64Array(9),reach,moved:true,enabled:true,
      J:new Float64Array(6),M:new Float64Array(6),Mprev:new Float64Array(6),force:new Float64Array(3),torque:new Float64Array(3),impulse:new Float64Array(6),vol:new Float64Array(3),moment:new Float64Array(9),started:false};
    this.obstacles.push(o);
    this.setObstacleState(this.obstacles.length-1,{position:options.position??[0,0,0],rotation:options.rotation,linearVelocity:options.linearVelocity,angularVelocity:options.angularVelocity});
    return this.obstacles.length-1;
  }
  get obstacleCount():number {return this.obstacles.length;}
  private obstacle(index:number):Obstacle {const o=this.obstacles[index];if(!o)fail(`No obstacle ${index}.`);return o;}
  setObstacleState(index:number,state:FluidObstacleState):void {
    const o=this.obstacle(index),x=vec(state.position,'position');
    const q=state.rotation?[...Array.from(state.rotation)]:[o.q[0],o.q[1],o.q[2],o.q[3]];
    if(q.length!==4||q.some(c=>!Number.isFinite(c)))fail('rotation must be a quaternion x, y, z, w.');
    const v=state.linearVelocity?vec(state.linearVelocity,'linearVelocity'):[0,0,0],w=state.angularVelocity?vec(state.angularVelocity,'angularVelocity'):[0,0,0];
    let moved=false;
    for(let k=0;k<3;k++){if(o.x[k]!==x[k])moved=true;o.x[k]=x[k];o.v[k]=v[k];o.w[k]=w[k];}
    for(let k=0;k<4;k++){if(o.q[k]!==q[k])moved=true;o.q[k]=q[k];}
    rotationMatrix(o.q,o.R);
    if(moved||!o.started){o.moved=true;this.obstaclesDirty=true;}
  }
  setObstacleEnabled(index:number,enabled:boolean):void {const o=this.obstacle(index);if(o.enabled!==enabled){o.enabled=enabled;o.moved=true;this.obstaclesDirty=true;o.started=false;}}
  /** Mean force (N) and torque about the obstacle's position (N m) the fluid put on it over the last step, including buoyancy. Live arrays. */
  obstacleForce(index:number):Float64Array {return this.obstacle(index).force;}
  obstacleTorque(index:number):Float64Array {return this.obstacle(index).torque;}
  /** Impulse (N s) and angular impulse (N m s) on the obstacle since the last reset: [Px, Py, Pz, Lx, Ly, Lz]. Live array. */
  obstacleImpulse(index:number):Float64Array {return this.obstacle(index).impulse;}
  resetObstacleImpulses(index?:number):void {for(let i=0;i<this.obstacles.length;i++)if(index===undefined||index===i)this.obstacles[i].impulse.fill(0);}
  /** Volume of fluid the obstacle displaces on the grid (mean over the three face sets of sum alpha dV), m^3. */
  obstacleVolume(index:number):number {this.updateObstacles();const o=this.obstacle(index);return (o.vol[0]+o.vol[1]+o.vol[2])/3;}

  /**
   * Recompute, where obstacles moved, each nearby face's signed distance to the surface, its solid fraction alpha (a
   * linear ramp over one cell, 1/2 on the surface) and its constraint: mode 1, an inside face, takes the rigid velocity;
   * mode 2, an inside face with a fluid face next to it along a grid line, takes the value extrapolated through that
   * fluid face (see below); mode 0, a fluid face, is free.
   */
  private updateObstacles():void {
    if(!this.obstaclesDirty)return;
    this.obstaclesDirty=false;
    const h=this.h,dV=h*h*h,n=[this.nx,this.ny,this.nz];
    for(let c=0;c<3;c++){
      const list=this.solidFaces[c],alpha=this.alpha[c],owner=this.owner[c],dist=this.dist[c],mode=this.mode[c];
      for(let q=0;q<list.length;q++){const f=list[q];alpha[f]=0;owner[f]=-1;dist[f]=Infinity;mode[f]=0;}
      list.length=0;
    }
    for(let oi=0;oi<this.obstacles.length;oi++){
      const o=this.obstacles[oi];o.moved=false;o.vol.fill(0);o.moment.fill(0);
      if(!o.enabled)continue;
      for(let c=0;c<3;c++){
        const lo=[0,0,0],hi=[0,0,0];
        for(let d=0;d<3;d++){
          const shift=d===c?0:.5,top=d===c?n[d]:n[d]-1;
          lo[d]=Math.max(0,Math.floor((o.x[d]-o.reach-2*h-this.origin[d])/h-shift));
          hi[d]=Math.min(top,Math.ceil((o.x[d]+o.reach+2*h-this.origin[d])/h-shift));
        }
        const kind=this.kind[c],dist=this.dist[c],owner=this.owner[c],list=this.solidFaces[c];
        for(let k=lo[2];k<=hi[2];k++)for(let j=lo[1];j<=hi[1];j++)for(let i=lo[0];i<=hi[0];i++){
          const f=this.index(i,j,k);
          if(kind[f]!==UNKNOWN)continue;
          const px=this.origin[0]+(i+(c===0?0:.5))*h-o.x[0],py=this.origin[1]+(j+(c===1?0:.5))*h-o.x[1],pz=this.origin[2]+(k+(c===2?0:.5))*h-o.x[2];
          const d=shapeDistance(o,px,py,pz);
          if(d>=BAND*h)continue;
          if(owner[f]<0)list.push(f);
          if(d<dist[f]){dist[f]=d;owner[f]=oi;}
        }
      }
    }
    const es=this.es,st=this.stride;
    for(let c=0;c<3;c++){
      const list=this.solidFaces[c];list.sort((a,b)=>a-b);
      const alpha=this.alpha[c],owner=this.owner[c],dist=this.dist[c],mode=this.mode[c],out=this.outFace[c],weight=this.weight[c],kind=this.kind[c];
      for(let q=0;q<list.length;q++){
        const f=list[q],o=this.obstacles[owner[f]],[px,py,pz]=this.facePosition(c,f),phi=dist[f];
        let a=.5-phi/h;a=a<0?0:a>1?1:a;alpha[f]=a;
        const va=a*dV;
        o.vol[c]+=va;o.moment[3*c]+=va*(px-o.x[0]);o.moment[3*c+1]+=va*(py-o.x[1]);o.moment[3*c+2]+=va*(pz-o.x[2]);
        if(phi>0){mode[f]=0;continue;}
        // An inside face with a fluid face next to it along a grid line is a ghost: its value is extrapolated linearly in the
        // distance from the surface (rigid velocity) through the first fluid face out along that line, or the second one when
        // the first is closer to the surface than half a cell, so that the velocity on the surface is the rigid one.
        let best=-1,bestScore=0,bestOut=0;
        for(let d=0;d<3;d++){
          if(es[d]===0)continue;
          for(const sign of [1,-1]){
            let outside=f+sign*st[d];
            if(kind[outside]!==UNKNOWN)continue;
            const po1=this.faceDistance(c,outside,o,dist);
            if(!(po1>0))continue;
            let po=po1;
            if(po1<.5*h){const further=outside+sign*st[d];if(kind[further]!==UNKNOWN)continue;outside=further;po=this.faceDistance(c,further,o,dist);}
            const score=po1-phi;
            if(score>bestScore){bestScore=score;best=d;bestOut=outside;weight[f]=phi/po;}
          }
        }
        if(best>=0){mode[f]=2;out[f]=bestOut;}else mode[f]=1;
      }
    }
  }
  private faceDistance(c:number,f:number,o:Obstacle,dist:Float64Array):number {
    const known=dist[f];if(known!==Infinity)return known;
    const p=this.facePosition(c,f);return shapeDistance(o,p[0]-o.x[0],p[1]-o.x[1],p[2]-o.x[2]);
  }
  /** Rigid velocity of each obstacle at its faces. */
  private updateTargets():void {
    for(let c=0;c<3;c++){
      const list=this.solidFaces[c],owner=this.owner[c],target=this.target[c];
      for(let q=0;q<list.length;q++){
        const f=list[q],o=this.obstacles[owner[f]],[px,py,pz]=this.facePosition(c,f),rx=px-o.x[0],ry=py-o.x[1],rz=pz-o.x[2];
        target[f]=o.v[c]+(c===0?o.w[1]*rz-o.w[2]*ry:c===1?o.w[2]*rx-o.w[0]*rz:o.w[0]*ry-o.w[1]*rx);
      }
    }
  }
  /** Momentum of the fluid inside each obstacle (sum rho alpha u dV, and its moment about the obstacle position) into o.M. */
  private insideMomentum():void {
    const rho=this.density,dV=this.h**3;
    for(const o of this.obstacles)o.M.fill(0);
    for(let c=0;c<3;c++){
      const list=this.solidFaces[c],owner=this.owner[c],alpha=this.alpha[c],x=this.vel[c];
      for(let q=0;q<list.length;q++){
        const f=list[q],o=this.obstacles[owner[f]],m=rho*alpha[f]*x[f]*dV,[px,py,pz]=this.facePosition(c,f);
        o.M[c]+=m;addCross(o.M,px-o.x[0],py-o.x[1],pz-o.x[2],c,m);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Operators.
  // ---------------------------------------------------------------------------------------------------------------

  /** Advection term A(u) of component c at its unknown faces into out. Ghosts must be current. */
  private advect(c:number,out:Float64Array):void {
    const list=this.unknown[c],x=this.vel[c],s=this.es,sc=s[c],ih=1/this.h,upwind=this.advection==='upwind';
    for(let q=0;q<list.length;q++){
      const f=list[q];
      let a:number;
      const up=.5*(x[f]+x[f+sc]),dn=.5*(x[f-sc]+x[f]);
      if(upwind)a=(up*(up>0?x[f]:x[f+sc])-dn*(dn>0?x[f-sc]:x[f]))*ih;
      else a=(up*up-dn*dn)*ih;
      for(let d=0;d<3;d++){
        if(d===c||s[d]===0)continue;
        const sd=s[d],y=this.vel[d];
        const vt=.5*(y[f+sd]+y[f+sd-sc]),vb=.5*(y[f]+y[f-sc]);
        if(upwind)a+=(vt*(vt>0?x[f]:x[f+sd])-vb*(vb>0?x[f-sd]:x[f]))*ih;
        else a+=(vt*.5*(x[f]+x[f+sd])-vb*.5*(x[f-sd]+x[f]))*ih;
      }
      out[f]=a;
    }
  }
  /** nu L x at face f (ghosts of x current). */
  private lap(x:Float64Array,f:number):number {
    const s=this.es;
    return (x[f+s[0]]+x[f-s[0]]+x[f+s[1]]+x[f-s[1]]+x[f+s[2]]+x[f-s[2]]-6*x[f])/(this.h*this.h);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Step.
  // ---------------------------------------------------------------------------------------------------------------

  /** Advance by count steps of dt. */
  step(count=1):void {for(let i=0;i<count;i++)this.advance();}

  private advance():void {
    const dt=this.dt,rho=this.density,nu=this.nu,theta=this.theta,dV=this.h**3;
    this.updateObstacles();this.updateTargets();
    let fresh=false;
    for(const o of this.obstacles){o.J.fill(0);if(o.started)o.Mprev.set(o.M);else fresh=true;}
    if(fresh){const keep=this.obstacles.map(o=>Float64Array.from(o.M));this.insideMomentum();this.obstacles.forEach((o,i)=>{if(o.started)o.M.set(keep[i]);else{o.Mprev.set(o.M);o.started=true;}});}
    this.fillAll();
    // Courant number at the start of the step.
    const cfl=this.maxSpeedSum()*dt/this.h;this.stats.cfl=cfl;if(cfl>this.stats.maxCfl)this.stats.maxCfl=cfl;if(cfl>this.cflLimit)this.stats.cflExceeded++;
    if(this.ledgerRate<0){this.ledgerRate=this.viscousPower();this.boundaryRate=this.boundaryPower();}
    const forceStart=this.forcePower();
    if(this.advection!=='none')for(let c=0;c<3;c++)this.advect(c,this.adv[c]);
    const ab=this.hasPrev;
    let viscousIterations=0;
    // Predictor, component by component, into wx (then copied back to the velocity after all three are done).
    const predicted=this.pred;
    for(let c=0;c<3;c++){
      const list=this.unknown[c],x=this.vel[c],rhs=this.rhs,adv=this.adv[c],prev=this.advPrev[c];
      const accel=this.gravity[c]+this.bodyForce[c];
      const g=this.gradFace[c],gl=this.gradLow[c],gh=this.gradHigh[c],wl=this.gradWL[c],wh=this.gradWH[c],p=this.p;
      // Pressure gradient at the faces (grad p^n), into wr.
      const gp=this.wr;
      for(let q=0;q<g.length;q++)gp[g[q]]=wh[q]*p[gh[q]]-wl[q]*p[gl[q]];
      for(let q=0;q<list.length;q++){
        const f=list[q];
        let r=x[f]+dt*(accel-gp[f]/rho);
        if(this.advection!=='none')r-=dt*(ab?1.5*adv[f]-.5*prev[f]:adv[f]);
        if(theta<1&&nu>0)r+=dt*(1-theta)*nu*this.lap(x,f);
        rhs[f]=r;
      }
      if(this.advection!=='none')for(let q=0;q<list.length;q++)prev[list[q]]=adv[list[q]];
      const out=predicted[c];out.set(x);
      if(theta===0||nu===0){
        for(let q=0;q<list.length;q++)out[list[q]]=rhs[list[q]];
        const solid=this.solidFaces[c],mode=this.mode[c],target=this.target[c],outFace=this.outFace[c],weight=this.weight[c],kind=this.kind[c];
        for(let q=0;q<solid.length;q++){
          const f=solid[q],m=mode[f];
          if(m===1)out[f]=target[f];
          else if(m===2){const g=outFace[f],free=kind[g]===UNKNOWN&&mode[g]===0?rhs[g]:x[g];out[f]=target[f]+weight[f]*(free-target[f]);}
        }
      }else viscousIterations+=this.solveViscous(c,out);
      // Impulse of the constraint on the fluid: u*_constrained - u*_free at the obstacle faces.
      const solid=this.solidFaces[c],owner=this.owner[c];
      if(solid.length>0){
        if(theta>0&&nu>0){this.fillGhosts(c,out,false);}
        const mode=this.mode[c];
        for(let q=0;q<solid.length;q++){
          const f=solid[q],o=this.obstacles[owner[f]];if(mode[f]===0)continue;
          let free=rhs[f];if(theta>0&&nu>0)free+=dt*theta*nu*this.lap(out,f);
          const J=rho*dV*(out[f]-free),[px,py,pz]=this.facePosition(c,f);
          o.J[c]+=J;addCross(o.J,px-o.x[0],py-o.x[1],pz-o.x[2],c,J);
        }
      }
    }
    this.hasPrev=this.advection!=='none';
    for(let c=0;c<3;c++){const list=this.unknown[c],x=this.vel[c],out=predicted[c];for(let q=0;q<list.length;q++)x[list[q]]=out[list[q]];}
    this.stats.viscousIterations=viscousIterations;
    this.copyOutflows();this.fillAll();
    this.projectVelocity(true);
    this.fillAll();
    // Obstacle forces.
    this.insideMomentum();
    const a=[this.gravity[0]+this.bodyForce[0],this.gravity[1]+this.bodyForce[1],this.gravity[2]+this.bodyForce[2]];
    for(const o of this.obstacles){
      if(!o.enabled){o.force.fill(0);o.torque.fill(0);continue;}
      for(let k=0;k<3;k++)o.force[k]=(-o.J[k]+o.M[k]-o.Mprev[k])/dt-rho*o.vol[k]*a[k];
      // Buoyancy torque: - rho sum alpha r x (e_c a_c) dV.
      const t=[0,0,0];
      for(let c=0;c<3;c++){const m=o.moment;const rx=m[3*c],ry=m[3*c+1],rz=m[3*c+2],f=-rho*a[c];
        if(c===0){t[1]+=rz*f;t[2]-=ry*f;}else if(c===1){t[0]-=rz*f;t[2]+=rx*f;}else{t[0]+=ry*f;t[1]-=rx*f;}}
      for(let k=0;k<3;k++)o.torque[k]=(-o.J[3+k]+o.M[3+k]-o.Mprev[3+k])/dt+t[k];
      for(let k=0;k<3;k++){o.impulse[k]+=o.force[k]*dt;o.impulse[3+k]+=o.torque[k]*dt;}
      this.workByBodies-=dt*(o.force[0]*o.v[0]+o.force[1]*o.v[1]+o.force[2]*o.v[2]+o.torque[0]*o.w[0]+o.torque[1]*o.w[1]+o.torque[2]*o.w[2]);
    }
    // Ledger: trapezoidal rule on the rates at the two ends of the step.
    const rate=this.viscousPower(),brate=this.boundaryPower();
    this.dissipated+=.5*dt*(this.ledgerRate+rate);this.workByBoundaries+=.5*dt*(this.boundaryRate+brate);
    this.ledgerRate=rate;this.boundaryRate=brate;
    this.workByForces+=.5*dt*(forceStart+this.forcePower());
    this.time+=dt;this.stats.steps++;
  }

  /** Implicit viscous solve of component c: x - theta dt nu L x = rhs on the free faces, the constrained faces given. Jacobi-preconditioned CG. */
  private solveViscous(c:number,out:Float64Array):number {
    const list=this.unknown[c],mode=this.mode[c],target=this.value,rhs=this.rhs,k=this.theta*this.dt*this.nu/(this.h*this.h);
    const x=this.wx,r=this.wr,z=this.wz,d=this.wd,q=this.wq,b=this.wb,pen=this.pen,vel=this.vel[c],n=list.length;
    const s0=this.es[0],s1=this.es[1],s2=this.es[2];
    // -1 marks a face with an obstacle constraint: its value is given (inside: the rigid velocity; next to the surface: the
    // interpolation, with the outer face's value from the start of the step).
    for(let i=0;i<n;i++)pen[i]=mode[list[i]]?-1:0;
    {const solid=this.solidFaces[c],t=this.target[c],outFace=this.outFace[c],weight=this.weight[c];
      for(let q=0;q<solid.length;q++){const f=solid[q];target[f]=mode[f]===2?t[f]+weight[f]*(vel[outFace[f]]-t[f]):t[f];}}
    // L_b: the operator on the known values (walls, outflow faces, obstacle faces taken exactly), with free unknowns at zero.
    x.fill(0);
    const fx=this.fixedFaces[c],fv=this.fixedValues[c];for(let i=0;i<fx.length;i++)x[fx[i]]=fv[i];
    const o=this.outflows[c];for(let i=0;i<o.length;i+=2)x[o[i]]=vel[o[i+1]];
    for(let i=0;i<n;i++)if(pen[i]<0)x[list[i]]=target[list[i]];
    this.fillGhosts(c,x,false);
    let bmax=0;
    for(let i=0;i<n;i++){
      const f=list[i],L=pen[i];
      if(L<0){b[i]=0;continue;}
      const v=rhs[f]+k*(x[f+s0]+x[f-s0]+x[f+s1]+x[f-s1]+x[f+s2]+x[f-s2]-6*x[f]);
      b[i]=v;const m=v<0?-v:v;if(m>bmax)bmax=m;
    }
    // Work vectors in padded storage: known faces stay zero (homogeneous ghosts).
    x.fill(0);d.fill(0);
    for(let i=0;i<n;i++){const f=list[i];x[f]=pen[i]<0?0:vel[f];}
    const diag0=1+k*2*this.activeAxes;
    // r = b - M x
    this.fillGhosts(c,x,true);
    for(let i=0;i<n;i++){
      const f=list[i],L=pen[i];
      r[i]=L<0?0:b[i]-((1+L)*x[f]-k*(x[f+s0]+x[f-s0]+x[f+s1]+x[f-s1]+x[f+s2]+x[f-s2]-6*x[f]));
    }
    const tol=this.viscousTolerance*bmax;
    let rz=0;
    for(let i=0;i<n;i++){const L=pen[i];const zi=L<0?0:r[i]/(diag0+L);z[i]=zi;d[list[i]]=zi;rz+=r[i]*zi;}
    let it=0;
    for(;it<this.maxIterations;it++){
      let rmax=0;for(let i=0;i<n;i++){const m=r[i]<0?-r[i]:r[i];if(m>rmax)rmax=m;}
      if(rmax<=tol)break;
      this.fillGhosts(c,d,true);
      let dq=0;
      for(let i=0;i<n;i++){
        const f=list[i],L=pen[i];
        const v=L<0?0:(1+L)*d[f]-k*(d[f+s0]+d[f-s0]+d[f+s1]+d[f-s1]+d[f+s2]+d[f-s2]-6*d[f]);
        q[i]=v;dq+=d[f]*v;
      }
      if(!(dq>0))break;
      const step=rz/dq;
      let rzNew=0;
      for(let i=0;i<n;i++){const f=list[i];x[f]+=step*d[f];const ri=r[i]-step*q[i];r[i]=ri;const L=pen[i];const zi=L<0?0:ri/(diag0+L);z[i]=zi;rzNew+=ri*zi;}
      const beta=rzNew/rz;rz=rzNew;
      for(let i=0;i<n;i++){const f=list[i];d[f]=z[i]+beta*d[f];}
    }
    for(let i=0;i<n;i++){const f=list[i];out[f]=pen[i]<0?target[f]:x[f];}
    return it;
  }

  /** Divergence of the velocity in cell c (compact index), 1/s. */
  divergenceAt(c:number):number {
    const f=this.cellPad[c],s=this.stride;
    return (this.u[f+1]-this.u[f]+this.v[f+s[1]]-this.v[f]+this.w[f+s[2]]-this.w[f])/this.h;
  }
  /** Largest |div u| over the cells, 1/s. */
  maxDivergence():number {
    const u=this.u,v=this.v,w=this.w,sy=this.stride[1],sz=this.stride[2],pad=this.cellPad;let m=0;
    for(let c=0;c<this.cells;c++){const f=pad[c],d=Math.abs(u[f+1]-u[f]+v[f+sy]-v[f]+w[f+sz]-w[f]);if(d>m)m=d;}
    return m/this.h;
  }
  private maxSpeed():number {return Math.max(this.maxComponent(0),this.maxComponent(1),this.maxComponent(2));}

  private applyA(x:Float64Array,out:Float64Array):void {
    const nbr=this.nbr,diag=this.diag,N=this.cells;
    for(let c=0;c<N;c++){
      let s=diag[c]*x[c];
      for(let q=0;q<6;q++){const nb=nbr[6*c+q];if(nb>=0)s-=x[nb];}
      out[c]=s;
    }
  }
  private buildPreconditioner():void {
    // MIC(0) with the usual tuning (0.97) and safety (0.25) constants; couplings across periodic seams are left out of the factor.
    const N=this.cells,diag=this.diag,plus=this.plus,pre=this.precon,sx=1,sy=this.nx,sz=this.nx*this.ny,tau=.97,sigma=.25;
    const A=(c:number,d:number)=>plus[3*c+d]?-1:0;
    for(let c=0;c<N;c++){
      const i=c%this.nx,j=Math.floor(c/this.nx)%this.ny,k=Math.floor(c/sz);
      let e=diag[c];
      if(i>0){const m=c-sx,a=A(m,0)*pre[m];e-=a*a+tau*A(m,0)*(A(m,1)+A(m,2))*pre[m]*pre[m];}
      if(j>0){const m=c-sy,a=A(m,1)*pre[m];e-=a*a+tau*A(m,1)*(A(m,0)+A(m,2))*pre[m]*pre[m];}
      if(k>0){const m=c-sz,a=A(m,2)*pre[m];e-=a*a+tau*A(m,2)*(A(m,0)+A(m,1))*pre[m]*pre[m];}
      if(e<sigma*diag[c])e=diag[c];
      pre[c]=e>0?1/Math.sqrt(e):0;
    }
  }
  private applyPreconditioner(r:Float64Array,z:Float64Array):void {
    const N=this.cells,low=this.lowMask,plus=this.plus,pre=this.precon,sy=this.nx,sz=this.nx*this.ny,qv=this.cq;
    for(let c=0;c<N;c++){
      const m=low[c];let t=r[c];
      if(m&1)t+=pre[c-1]*qv[c-1];
      if(m&2)t+=pre[c-sy]*qv[c-sy];
      if(m&4)t+=pre[c-sz]*qv[c-sz];
      qv[c]=t*pre[c];
    }
    for(let c=N-1;c>=0;c--){
      let t=qv[c];const pc=pre[c];
      if(plus[3*c])t+=pc*z[c+1];
      if(plus[3*c+1])t+=pc*z[c+sy];
      if(plus[3*c+2])t+=pc*z[c+sz];
      z[c]=t*pc;
    }
  }

  /** Projection: solve A phi = -h^2 (rho / dt) div u, u -= (dt / rho) grad phi; with updatePressure, p += phi. */
  private projectVelocity(updatePressure:boolean):void {
    const N=this.cells,rho=this.density,dt=this.dt,h=this.h,b=this.cr,phi=this.phi,r=this.cr,z=this.cz,d=this.cd,q=this.cq;
    const scale=-h*h*rho/dt;
    {const u=this.u,v=this.v,w=this.w,sy=this.stride[1],sz=this.stride[2],pad=this.cellPad,ih=1/h;
      for(let c=0;c<N;c++){const f=pad[c];b[c]=scale*(u[f+1]-u[f]+v[f+sy]-v[f]+w[f+sz]-w[f])*ih;}}
    if(this.singular){let mean=0;for(let c=0;c<N;c++)mean+=b[c];mean/=N;for(let c=0;c<N;c++)b[c]-=mean;}
    const vmax=this.maxSpeed();
    const tol=this.pressureTolerance*Math.max(vmax,1e-300)*rho*h/dt;
    phi.fill(0);
    // r = b (phi = 0); b and r share storage.
    let rmax=0;for(let c=0;c<N;c++){const m=Math.abs(r[c]);if(m>rmax)rmax=m;}
    let it=0;
    if(rmax>tol){
      const zbuf=z;
      this.applyPreconditioner(r,zbuf);
      let rz=0;for(let c=0;c<N;c++){d[c]=zbuf[c];rz+=r[c]*zbuf[c];}
      const Ad=this.wq;
      for(;it<this.maxIterations;it++){
        this.applyA(d,Ad);
        let dAd=0;for(let c=0;c<N;c++)dAd+=d[c]*Ad[c];
        if(!(dAd>0))break;
        const alpha=rz/dAd;rmax=0;
        for(let c=0;c<N;c++){phi[c]+=alpha*d[c];r[c]-=alpha*Ad[c];const m=Math.abs(r[c]);if(m>rmax)rmax=m;}
        if(rmax<=tol){it++;break;}
        this.applyPreconditioner(r,zbuf);
        let rzNew=0;for(let c=0;c<N;c++)rzNew+=r[c]*zbuf[c];
        const beta=rzNew/rz;rz=rzNew;
        for(let c=0;c<N;c++)d[c]=zbuf[c]+beta*d[c];
      }
      if(rmax>tol)this.stats.unconverged++;
    }
    if(this.singular){let mean=0;for(let c=0;c<N;c++)mean+=phi[c];mean/=N;for(let c=0;c<N;c++)phi[c]-=mean;}
    const k=dt/rho;
    for(let c=0;c<3;c++){
      const g=this.gradFace[c],gl=this.gradLow[c],gh=this.gradHigh[c],wl=this.gradWL[c],wh=this.gradWH[c],x=this.vel[c];
      for(let i=0;i<g.length;i++)x[g[i]]-=k*(wh[i]*phi[gh[i]]-wl[i]*phi[gl[i]]);
    }
    if(updatePressure){const p=this.p;for(let c=0;c<N;c++)p[c]+=phi[c];if(this.singular){let mean=0;for(let c=0;c<N;c++)mean+=p[c];mean/=N;for(let c=0;c<N;c++)p[c]-=mean;}}
    this.fillAll();
    this.stats.pressureIterations=it;
    this.stats.divergence=vmax>0?this.maxDivergence()*h/vmax:0;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Measures.
  // ---------------------------------------------------------------------------------------------------------------

  /** Kinetic energy of the fluid outside the obstacles, sum 1/2 rho (1 - alpha) u^2 dV over the faces, J. Faces on a wall count half. */
  kineticEnergy():number {
    const dV=this.h**3;let e=0;
    for(let c=0;c<3;c++){
      const x=this.vel[c],kind=this.kind[c],alpha=this.alpha[c];
      for(let f=0;f<x.length;f++){
        const k=kind[f];if(k===GHOST||k===COPY)continue;
        const w=(k===UNKNOWN?1:.5)*(1-alpha[f]);
        e+=w*x[f]*x[f];
      }
    }
    return .5*this.density*e*dV;
  }
  /** Momentum of the fluid outside the obstacles: sum rho (1 - alpha) u dV over the faces, kg m/s. */
  momentum():[number,number,number] {
    const dV=this.h**3,out:[number,number,number]=[0,0,0];
    for(let c=0;c<3;c++){
      const x=this.vel[c],kind=this.kind[c],alpha=this.alpha[c];let s=0;
      for(let f=0;f<x.length;f++){const k=kind[f];if(k===GHOST||k===COPY)continue;s+=(k===UNKNOWN?1:.5)*(1-alpha[f])*x[f];}
      out[c]=this.density*s*dV;
    }
    return out;
  }
  /** Rate at which viscosity takes kinetic energy out of the fluid, W (the discrete mu |grad u|^2, walls included). */
  viscousPower():number {
    if(this.nu===0)return 0;
    const dV=this.h**3;let s=0;
    for(let c=0;c<3;c++){
      const list=this.unknown[c],x=this.vel[c],alpha=this.alpha[c];
      for(let q=0;q<list.length;q++){const f=list[q];s+=(1-alpha[f])*x[f]*this.lap(x,f);}
    }
    return -this.density*this.nu*s*dV+this.wallPower();
  }
  /** Power of the moving walls through the viscous stress, W. */
  private wallPower():number {
    if(this.nu===0)return 0;
    const ih2=1/(this.h*this.h),dV=this.h**3;let s=0;
    for(let c=0;c<3;c++){
      const d=this.ghostDst[c],src=this.ghostSrc[c],a=this.ghostA[c],b=this.ghostB[c],x=this.vel[c],kind=this.kind[c];
      for(let q=0;q<d.length;q++){
        if(a[q]!==-1||b[q]===0||kind[src[q]]!==UNKNOWN)continue;
        const wall=.5*b[q];s+=2*wall*(wall-x[src[q]])*ih2;
      }
    }
    return this.density*this.nu*s*dV;
  }
  /** Power through moving walls, inflows and outflows (kinetic energy carried and pressure work), W. */
  boundaryPower():number {
    let s=this.wallPower();
    const h2=this.h*this.h,rho=this.density;
    for(let c=0;c<3;c++){
      for(const [list,step] of [[this.fixedFaces[c],1],[this.outflows[c],2]] as const){
        for(let q=0;q<list.length;q+=step){
          const f=list[q],idx=this.faceIndex(f),n=[this.nx,this.ny,this.nz][c],low=idx[c]===0;
          const side=this.sides[2*c+(low?0:1)];if(side.type!=='inflow'&&side.type!=='outflow')continue;
          const un=this.vel[c][f]*(low?1:-1);
          const cellF=low?f:f-this.stride[c];
          const ci=this.faceIndex(cellF),cell=ci[0]+this.nx*(ci[1]+this.ny*ci[2]);void n;
          const pf=side.type==='outflow'?0:this.p[cell];
          // Speed^2 at the face from the face's own normal component (the tangential parts at the sides are small).
          s+=un*(pf+.5*rho*un*un)*h2;
        }
      }
    }
    return s;
  }
  /** Power of gravity and the body force on the fluid outside the obstacles, W. */
  private forcePower():number {
    const p=this.momentum();
    return (this.gravity[0]+this.bodyForce[0])*p[0]+(this.gravity[1]+this.bodyForce[1])*p[1]+(this.gravity[2]+this.bodyForce[2])*p[2];
  }
  /** Kinetic energy + dissipated - work in: constant up to the discretisation error, J. */
  energyBalance():number {return this.kineticEnergy()+this.dissipated-this.workByBodies-this.workByBoundaries-this.workByForces;}

  /** Velocity at a point by trilinear interpolation of each staggered component, m/s. */
  velocityAt(x:number,y:number,z:number,out:number[]|Float64Array=[0,0,0]):number[]|Float64Array {
    const p=[x,y,z],n=[this.nx,this.ny,this.nz],g=[0,0,0],t=[0,0,0],s=this.stride;
    for(let c=0;c<3;c++){
      for(let d=0;d<3;d++){
        if(this.es[d]===0){g[d]=0;t[d]=0;continue;}
        const r=(p[d]-this.origin[d])/this.h-(d===c?0:.5);
        let i=Math.floor(r);if(i<-1)i=-1;if(i>n[d]-1)i=n[d]-1;
        g[d]=i;const f=r-i;t[d]=f<0?0:f>1?1:f;
      }
      const X=this.vel[c];let v=0;
      for(let dz=0;dz<2;dz++)for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
        const wgt=(dx?t[0]:1-t[0])*(dy?t[1]:1-t[1])*(dz?t[2]:1-t[2]);
        if(wgt!==0)v+=wgt*X[(g[0]+dx+1)*s[0]+(g[1]+dy+1)*s[1]+(g[2]+dz+1)*s[2]];
      }
      out[c]=v;
    }
    return out;
  }
  /** Pressure in the cell containing the point, Pa. */
  pressureAt(x:number,y:number,z:number):number {
    const i=Math.min(this.nx-1,Math.max(0,Math.floor((x-this.origin[0])/this.h))),j=Math.min(this.ny-1,Math.max(0,Math.floor((y-this.origin[1])/this.h))),k=Math.min(this.nz-1,Math.max(0,Math.floor((z-this.origin[2])/this.h)));
    return this.p[i+this.nx*(j+this.ny*k)];
  }
  /** Volume flow through the plane of faces of component `axis` at face index `index`, m^3/s. */
  flowRate(axis:0|1|2,index:number):number {
    const n=[this.nx,this.ny,this.nz],x=this.vel[axis],h2=this.h*this.h;let s=0;
    const a=(axis+1)%3,b=(axis+2)%3;
    for(let jb=0;jb<n[b];jb++)for(let ja=0;ja<n[a];ja++){const idx=[0,0,0];idx[axis]=index;idx[a]=ja;idx[b]=jb;s+=x[this.index(idx[0],idx[1],idx[2])];}
    return s*h2;
  }

  /**
   * Force on what is inside a box of cells [min, max] (inclusive cell indices), from the momentum flux, the pressure and
   * the viscous stress on the box's faces and the weight of the fluid inside: F = sum (-p n + tau n - rho u (u.n)) dS
   * + rho (g + f) V_fluid. The rate of change of the momentum inside is not included: use it at a steady state.
   */
  controlVolumeForce(min:FluidVec3,max:FluidVec3):[number,number,number] {
    const n=[this.nx,this.ny,this.nz];
    for(let d=0;d<3;d++)if(!(Number.isInteger(min[d])&&Number.isInteger(max[d])&&min[d]>=1&&max[d]<=n[d]-2&&min[d]<=max[d]))fail('controlVolumeForce: the box must be whole cells at least one cell inside the grid.');
    this.fillAll();
    const h=this.h,mu=this.viscosity,rho=this.density,A=h*h,F:[number,number,number]=[0,0,0];
    const V=this.vel,s=this.stride;
    const P=(i:number,j:number,k:number)=>this.p[i+this.nx*(j+this.ny*k)];
    for(let d=0;d<3;d++){
      const a=(d+1)%3,b=(d+2)%3;
      for(let side=0;side<2;side++){
        const sign=side?1:-1,id=side?max[d]+1:min[d];
        for(let jb=min[b];jb<=max[b];jb++)for(let ja=min[a];ja<=max[a];ja++){
          const idx=[0,0,0];idx[d]=id;idx[a]=ja;idx[b]=jb;
          const f=this.index(idx[0],idx[1],idx[2]);
          // Velocity at the face centre: the normal component is on the face; tangential ones average four faces.
          const un=V[d][f];
          const ut=(c:number)=>.25*(V[c][f]+V[c][f-s[d]]+V[c][f+s[c]]+V[c][f+s[c]-s[d]]);
          const u=[0,0,0];u[d]=un;u[a]=ut(a);u[b]=ut(b);
          const lo=[...idx];lo[d]=id-1;
          const pf=.5*(P(idx[0],idx[1],idx[2])+P(lo[0],lo[1],lo[2]));
          // Stress tau_cd n_d at the face: c = d: 2 mu du_d/dx_d; c != d: mu (du_c/dx_d + du_d/dx_c).
          const dndn=(.5*(V[d][f+s[d]]-V[d][f-s[d]]))/h;
          const tau=[0,0,0];tau[d]=2*mu*dndn;
          for(const c of [a,b]){
            // du_c/dx_d at the face: difference of the cell-centred averages of u_c across it.
            const above=.5*(V[c][f]+V[c][f+s[c]]),below=.5*(V[c][f-s[d]]+V[c][f-s[d]+s[c]]);
            const dcdd=(above-below)/h;
            const ddc=(.5*(V[d][f+s[c]]-V[d][f-s[c]]))/h;
            tau[c]=mu*(dcdd+ddc);
          }
          for(let c=0;c<3;c++){
            F[c]+=sign*(tau[c]-rho*u[c]*un)*A;
          }
          F[d]-=sign*pf*A;
        }
      }
    }
    // Weight of the fluid inside the box, outside the obstacles.
    let fluidVolume=0;
    for(let k=min[2];k<=max[2];k++)for(let j=min[1];j<=max[1];j++)for(let i=min[0];i<=max[0];i++){
      const [x,y,z]=this.cellCentre(i+this.nx*(j+this.ny*k));let a=0;
      for(const o of this.obstacles){if(!o.enabled)continue;const d=shapeDistance(o,x-o.x[0],y-o.x[1],z-o.x[2]);let f=.5-d/h;f=f<0?0:f>1?1:f;if(f>a)a=f;}
      fluidVolume+=(1-a)*h*h*h;
    }
    for(let c=0;c<3;c++)F[c]+=rho*(this.gravity[c]+this.bodyForce[c])*fluidVolume;
    return F;
  }
}

function addCross(out:Float64Array,rx:number,ry:number,rz:number,c:number,m:number):void {
  // out[3..5] += r x (e_c m)
  if(c===0){out[4]+=rz*m;out[5]-=ry*m;}
  else if(c===1){out[3]-=rz*m;out[5]+=rx*m;}
  else{out[3]+=ry*m;out[4]-=rx*m;}
}

// -------------------------------------------------------------------------------------------------
// Free surface: liquid particles carried on the grid (APIC), the air as p = 0.
// -------------------------------------------------------------------------------------------------

export const FREE_SURFACE_SOLVER_ID='fluid-free-surface-apic-mac-js-f64-v1';
export interface FreeSurfaceOptions {
  /** Cells along x, y and z. One cell along z makes a 2D flow (the z velocity is not stored). */
  readonly cells:FluidVec3;
  readonly spacing:number;
  readonly origin?:FluidVec3;
  /** Liquid density, kg/m^3. The air has none. */
  readonly density:number;
  /** Time step, s. `setTimeStep` changes it between steps. */
  readonly dt:number;
  /** Default [0, -9.81, 0]. */
  readonly gravity?:FluidVec3;
  /** Dynamic viscosity of the liquid, Pa s. Default 0 (inviscid). Solved implicitly (backward Euler), so any value is stable. */
  readonly viscosity?:number;
  /** Tangential condition of the viscous liquid on the tank walls and obstacles. Default 'free-slip'; ignored when inviscid. */
  readonly walls?:'free-slip'|'no-slip';
  /** Particles per cell along each axis when seeding. Default 2. */
  readonly particlesPerAxis?:number;
  readonly pressureTolerance?:number;
  /** Relative tolerance of the viscous solve (infinity norm of the residual over that of the right side). Default 1e-9. */
  readonly viscousTolerance?:number;
  readonly maxIterations?:number;
  /** Largest Courant number dt max|v| / h. Default 1. */
  readonly cflLimit?:number;
  /** Most particles. Default 4,000,000. */
  readonly capacity?:number;
}
/** A fixed or moving solid in the tank: axis-aligned (no rotation), voxelised (a cell is solid when its centre is inside). */
export interface FreeSurfaceObstacleOptions {
  readonly shape:FluidShape;
  /** Centre, m. */
  readonly position:FluidVec3;
  /** Velocity of a moving obstacle, m/s (the faces next to it take it). Default zero. */
  readonly velocity?:FluidVec3;
}
export interface FreeSurfaceStats {steps:number;pressureIterations:number;viscousIterations:number;liquidCells:number;solidCells:number;cfl:number;maxCfl:number;cflExceeded:number;unconverged:number;divergence:number}

interface FreeSurfaceObstacle {shape:FluidShape;position:[number,number,number];velocity:[number,number,number];force:Float64Array}

const insideShape=(s:FluidShape,dx:number,dy:number,dz:number):boolean=>{
  switch(s.kind){
    case 'sphere':return dx*dx+dy*dy+dz*dz<s.radius*s.radius;
    case 'box':return Math.abs(dx)<s.halfExtents[0]&&Math.abs(dy)<s.halfExtents[1]&&Math.abs(dz)<s.halfExtents[2];
    case 'cylinder':return Math.abs(dy)<s.halfLength&&dx*dx+dz*dz<s.radius*s.radius;
    case 'capsule':{const y=Math.max(-s.halfLength,Math.min(s.halfLength,dy));return dx*dx+(dy-y)**2+dz*dz<s.radius*s.radius;}
  }
};

/**
 * Incompressible liquid with a free surface in a closed tank, float64, deterministic. The liquid is carried by particles
 * with the affine particle-in-cell transfer (APIC, Jiang et al. 2015): each step the particles' momentum goes to the
 * staggered grid, gravity is added, viscosity is applied implicitly (backward Euler, component-wise Laplacian, no-slip or
 * free-slip on walls and obstacles, zero normal gradient into the air), the velocity is projected to zero divergence in
 * the cells that hold particles with p = 0 on the surface (ghost fluid), extrapolated two cells out, and read back to the
 * particles with its gradient, which then move with it. Obstacles are voxelised solids: their cells take no liquid,
 * their faces carry the obstacle's velocity, and the pressure on the faces between them and the liquid is their force.
 * See docs/FLUID.md.
 */
export class FreeSurfaceFluid {
  readonly solver=FREE_SURFACE_SOLVER_ID;
  readonly nx:number;readonly ny:number;readonly nz:number;readonly h:number;readonly origin:FluidVec3;readonly density:number;
  /** Time step, s. */
  dt:number;
  readonly viscosity:number;readonly noSlip:boolean;
  readonly gravity:Float64Array;readonly flat:boolean;readonly perAxis:number;readonly pressureTolerance:number;readonly viscousTolerance:number;readonly maxIterations:number;readonly cflLimit:number;readonly capacity:number;
  /** Face velocities: u (nx + 1) ny nz, v nx (ny + 1) nz, w nx ny (nz + 1); index i + Nx (j + Ny k) with that component's counts. */
  readonly vel:[Float64Array,Float64Array,Float64Array];
  /** Pressure at the liquid cells' centres, Pa (zero in empty cells). */
  readonly p:Float64Array;
  /** 1 for a cell holding a particle. */
  readonly liquid:Uint8Array;
  /** 1 for a cell inside an obstacle. */
  readonly solid:Uint8Array;
  readonly stats:FreeSurfaceStats={steps:0,pressureIterations:0,viscousIterations:0,liquidCells:0,solidCells:0,cfl:0,maxCfl:0,cflExceeded:0,unconverged:0,divergence:0};
  time=0;
  /** Particle positions and velocities (3 per particle) and affine matrices (9 per particle, C[3 c + d] = d v_c / d x_d). */
  positions:Float64Array;velocities:Float64Array;affine:Float64Array;
  count=0;
  /** Mass of one particle, kg. */
  particleMass=0;
  private readonly dims:[number,number,number][];private readonly weight:[Float64Array,Float64Array,Float64Array];private readonly valid:[Uint8Array,Uint8Array,Uint8Array];
  /** Faces whose value is set (1: a tank wall's normal face, 2: a face next to a solid cell) and the value they take. */
  private readonly fixed:[Uint8Array,Uint8Array,Uint8Array];private readonly fixedValue:[Float64Array,Float64Array,Float64Array];
  private readonly owner:Int32Array;private readonly obstacles:FreeSurfaceObstacle[]=[];private solidDirty=false;
  private readonly cellsTotal:number;private readonly phi:Float64Array;private readonly near:Uint8Array;private readonly b:Float64Array;private readonly r:Float64Array;private readonly z:Float64Array;private readonly d:Float64Array;private readonly q:Float64Array;private readonly pre:Float64Array;private readonly diag:Float64Array;private readonly Ad:Float64Array;private readonly p2:Float64Array;private readonly scratch:[Float64Array,Float64Array,Float64Array];

  constructor(options:FreeSurfaceOptions) {
    if(!options||typeof options!=='object')fail('FreeSurfaceFluid needs options.');
    const cells=vec(options.cells,'cells');
    for(const c of cells)if(!Number.isInteger(c)||c<1)fail('cells must be positive integers.');
    this.nx=cells[0];this.ny=cells[1];this.nz=cells[2];this.flat=this.nz===1;
    if(this.nx<2||this.ny<2)fail('A free-surface tank needs at least 2 cells along x and y.');
    this.cellsTotal=this.nx*this.ny*this.nz;
    if(this.cellsTotal>FLUID_MAX_CELLS)fail(`At most ${FLUID_MAX_CELLS} cells.`);
    this.h=num(options.spacing,'spacing',1e-9,1e6);this.origin=options.origin?vec(options.origin,'origin'):[0,0,0];
    this.density=num(options.density,'density',1e-6,1e6);this.dt=num(options.dt,'dt',1e-12,1e3);
    this.viscosity=num(options.viscosity??0,'viscosity',0,1e9);
    if(options.walls!==undefined&&options.walls!=='free-slip'&&options.walls!=='no-slip')fail("walls must be 'free-slip' or 'no-slip'.");
    this.noSlip=options.walls==='no-slip';
    this.gravity=new Float64Array(options.gravity?vec(options.gravity,'gravity'):[0,-9.81,0]);
    this.perAxis=num(options.particlesPerAxis??2,'particlesPerAxis',1,8);
    if(!Number.isInteger(this.perAxis))fail('particlesPerAxis must be an integer.');
    this.pressureTolerance=num(options.pressureTolerance??1e-10,'pressureTolerance',1e-15,1e-2);
    this.viscousTolerance=num(options.viscousTolerance??1e-9,'viscousTolerance',1e-15,1e-2);
    this.maxIterations=num(options.maxIterations??4000,'maxIterations',1,1e7);
    this.cflLimit=num(options.cflLimit??1,'cflLimit',1e-6,100);
    this.capacity=num(options.capacity??4e6,'capacity',1,1<<26);
    const nx=this.nx,ny=this.ny,nz=this.nz;
    this.dims=[[nx+1,ny,nz],[nx,ny+1,nz],[nx,ny,nz+1]];
    const f64=()=>this.dims.map(([a,b,c])=>new Float64Array(a*b*c)) as [Float64Array,Float64Array,Float64Array];
    const u8=()=>this.dims.map(([a,b,c])=>new Uint8Array(a*b*c)) as [Uint8Array,Uint8Array,Uint8Array];
    this.vel=f64();this.weight=f64();this.scratch=f64();this.fixedValue=f64();this.valid=u8();this.fixed=u8();
    const N=this.cellsTotal;
    this.p=new Float64Array(N);this.liquid=new Uint8Array(N);this.solid=new Uint8Array(N);this.owner=new Int32Array(N).fill(-1);this.phi=new Float64Array(N);this.near=new Uint8Array(N);
    this.b=new Float64Array(N);this.r=new Float64Array(N);this.z=new Float64Array(N);this.d=new Float64Array(N);this.q=new Float64Array(N);this.pre=new Float64Array(N);this.diag=new Float64Array(N);this.Ad=new Float64Array(N);this.p2=new Float64Array(N);
    this.positions=new Float64Array(0);this.velocities=new Float64Array(0);this.affine=new Float64Array(0);
    this.particleMass=this.density*this.h**3/(this.perAxis**(this.flat?2:3));
    this.classify();
  }

  /** Change the time step for the following steps (an adaptive Courant-number control), s. */
  setTimeStep(dt:number):void {this.dt=num(dt,'dt',1e-12,1e3);}

  /** Add a voxelised obstacle; returns its index. Particles already in its cells are left there (add obstacles before the liquid). */
  addObstacle(options:FreeSurfaceObstacleOptions):number {
    if(!options||typeof options!=='object'||!options.shape)fail('addObstacle needs a shape and a position.');
    const s=options.shape;
    if(s.kind==='sphere')num(s.radius,'radius',0,1e6);
    else if(s.kind==='box')vec(s.halfExtents,'halfExtents').forEach((v,i)=>num(v,`halfExtents[${i}]`,0,1e6));
    else if(s.kind==='cylinder'||s.kind==='capsule'){num(s.radius,'radius',0,1e6);num(s.halfLength,'halfLength',0,1e6);}
    else fail('Unknown obstacle shape.');
    this.obstacles.push({shape:s,position:vec(options.position,'position'),velocity:options.velocity?vec(options.velocity,'velocity'):[0,0,0],force:new Float64Array(3)});
    this.solidDirty=true;this.classify();return this.obstacles.length-1;
  }
  /**
   * Move an obstacle (and give it a velocity for the faces next to it). An obstacle may only retreat from the liquid (a
   * gate that lifts): particles in cells it moves into stay where they are and no longer count as liquid until it leaves.
   */
  moveObstacle(index:number,position:FluidVec3,velocity:FluidVec3=[0,0,0]):void {
    const o=this.obstacles[index];if(!o)fail('No such obstacle.');
    o.position=vec(position,'position');o.velocity=vec(velocity,'velocity');this.solidDirty=true;
  }
  /** Pressure force of the liquid on an obstacle over the last step, N (the sum of p h^2 over the faces between it and liquid cells; a 2D tank counts one cell of depth). The viscous traction is not included. */
  obstacleForce(index:number):[number,number,number] {const o=this.obstacles[index];if(!o)fail('No such obstacle.');return [o.force[0],o.force[1],o.force[2]];}

  /** Solid cells from the obstacles, then the fixed faces: tank walls (zero normal velocity) and faces next to a solid cell. */
  private classify():void {
    const nx=this.nx,ny=this.ny,nz=this.nz,h=this.h,o=this.origin,S=this.solid,own=this.owner;
    if(this.solidDirty||this.obstacles.length===0){
      S.fill(0);own.fill(-1);let count=0;
      for(let n=0;n<this.obstacles.length;n++){
        const ob=this.obstacles[n],[px,py,pz]=ob.position;
        for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
          if(S[c])continue;
          const cx=o[0]+(i+.5)*h-px,cy=o[1]+(j+.5)*h-py,cz=this.flat?0:o[2]+(k+.5)*h-pz;
          if(insideShape(ob.shape,cx,cy,cz)){S[c]=1;own[c]=n;count++;}
        }
      }
      this.stats.solidCells=count;this.solidDirty=false;
    }
    const comps=this.flat?2:3;
    for(let c=0;c<comps;c++){
      const [Nx,Ny,Nz]=this.dims[c],F=this.fixed[c],FV=this.fixedValue[c],n=[nx,ny,nz][c],sc=c===0?1:c===1?nx:nx*ny;
      for(let k=0,f=0;k<Nz;k++)for(let j=0;j<Ny;j++)for(let i=0;i<Nx;i++,f++){
        const idx=c===0?i:c===1?j:k;
        if(idx===0||idx===n){F[f]=1;FV[f]=0;continue;}
        const hi=i+nx*(j+ny*k),lo=hi-sc,a=S[lo]?own[lo]:-1,b=S[hi]?own[hi]:-1;
        if(a<0&&b<0){F[f]=0;FV[f]=0;continue;}
        F[f]=2;FV[f]=this.obstacles[a>=0?a:b].velocity[c];
      }
    }
  }

  /** Fill every cell whose seeding points satisfy `inside` with particles (perAxis per axis, at regular positions) moving at `velocity`. Cells inside obstacles are skipped. Returns the number added. */
  addLiquid(inside:(x:number,y:number,z:number)=>boolean,velocity:FluidVec3=[0,0,0]):number {
    const v=vec(velocity,'velocity'),n=this.perAxis,h=this.h,o=this.origin,pts:number[]=[];
    const nzSeeds=this.flat?1:n;
    for(let k=0;k<this.nz;k++)for(let j=0;j<this.ny;j++)for(let i=0;i<this.nx;i++){
      if(this.solid[i+this.nx*(j+this.ny*k)])continue;
      for(let c=0;c<nzSeeds;c++)for(let b=0;b<n;b++)for(let a=0;a<n;a++){
        const x=o[0]+(i+(a+.5)/n)*h,y=o[1]+(j+(b+.5)/n)*h,z=o[2]+(k+(this.flat?.5:(c+.5)/n))*h;
        if(inside(x,y,z))pts.push(x,y,z);
      }
    }
    const added=pts.length/3;
    if(this.count+added>this.capacity)fail(`At most ${this.capacity} particles.`);
    const grow=(a:Float64Array,size:number)=>{const out=new Float64Array(size);out.set(a.subarray(0,Math.min(a.length,size)));return out;};
    const total=this.count+added;
    this.positions=grow(this.positions,3*total);this.velocities=grow(this.velocities,3*total);this.affine=grow(this.affine,9*total);
    for(let q=0;q<added;q++){
      const id=this.count+q;
      for(let d=0;d<3;d++){this.positions[3*id+d]=pts[3*q+d];this.velocities[3*id+d]=this.flat&&d===2?0:v[d];}
    }
    this.count=total;this.markLiquid();
    return added;
  }
  /**
   * Replace every particle: positions and velocities (3 per particle) and, optionally, the affine matrices (9 per
   * particle; zero when left out). What a save of `positions`, `velocities` and `affine` gives back exactly.
   */
  setParticles(positions:ArrayLike<number>,velocities?:ArrayLike<number>,affine?:ArrayLike<number>):void {
    if(!positions||positions.length%3!==0)fail('setParticles: positions must hold 3 numbers per particle.');
    const count=positions.length/3;
    if(count>this.capacity)fail(`At most ${this.capacity} particles.`);
    if(velocities!==undefined&&velocities.length!==3*count)fail(`setParticles: velocities must hold ${3*count} numbers.`);
    if(affine!==undefined&&affine.length!==9*count)fail(`setParticles: affine must hold ${9*count} numbers.`);
    const X=new Float64Array(3*count),V=new Float64Array(3*count),C=new Float64Array(9*count);
    for(let i=0;i<3*count;i++){X[i]=Number(positions[i]);if(velocities)V[i]=Number(velocities[i]);if(!Number.isFinite(X[i])||!Number.isFinite(V[i]))fail(`setParticles: value ${i} is not a finite number.`);}
    if(affine)for(let i=0;i<9*count;i++){C[i]=Number(affine[i]);if(!Number.isFinite(C[i]))fail(`setParticles: affine[${i}] is not a finite number.`);}
    this.positions=X;this.velocities=V;this.affine=C;this.count=count;this.markLiquid();
  }

  /** Trilinear stencil of component c at a point: base indices and fractions (flat: no z interpolation for u and v). */
  private stencil(c:number,x:number,y:number,z:number):void {
    const base=this.base,frac=this.frac,dims=this.dims[c],h=this.h,o=this.origin;
    let s=(x-o[0])/h-(c===0?0:.5),i=Math.floor(s),top=dims[0]-2;if(i<0)i=0;else if(i>top)i=top;let f=s-i;base[0]=i;frac[0]=f<0?0:f>1?1:f;
    s=(y-o[1])/h-(c===1?0:.5);i=Math.floor(s);top=dims[1]-2;if(i<0)i=0;else if(i>top)i=top;f=s-i;base[1]=i;frac[1]=f<0?0:f>1?1:f;
    if(this.flat){base[2]=0;frac[2]=0;return;}
    s=(z-o[2])/h-(c===2?0:.5);i=Math.floor(s);top=dims[2]-2;if(i<0)i=0;else if(i>top)i=top;f=s-i;base[2]=i;frac[2]=f<0?0:f>1?1:f;
  }

  private readonly base=new Int32Array(3);private readonly frac=new Float64Array(3);

  /** Particles to grid (APIC), then mark the liquid cells. */
  private toGrid():void {
    const h=this.h,o=this.origin,X=this.positions,V=this.velocities,C=this.affine,comps=this.flat?2:3,flat=this.flat;
    const inv=1/h,ox0=o[0],oy0=o[1],oz0=o[2],sx=[0,.5,.5],sy=[.5,0,.5],sz2=[.5,.5,0],tx=this.dims.map(d=>d[0]-2),ty=this.dims.map(d=>d[1]-2),tz=this.dims.map(d=>d[2]-2),NX=this.dims.map(d=>d[0]),NXY=this.dims.map(d=>d[0]*d[1]);
    for(let c=0;c<3;c++){this.vel[c].fill(0);this.weight[c].fill(0);}
    for(let c=0;c<comps;c++){
      const [Nx,Ny]=this.dims[c],u=this.vel[c],W=this.weight[c],zs=flat?1:2,ox=c===0?0:.5,oy=c===1?0:.5,oz=c===2?0:.5,NxNy=Nx*Ny;
      for(let pI=0;pI<this.count;pI++){
        const x=X[3*pI],y=X[3*pI+1],z=X[3*pI+2];
        let b0=0,b1=0,b2=0,f0=0,f1=0,f2=0;
        {let q=(x-ox0)*inv-sx[c],i=Math.floor(q);if(i<0)i=0;else if(i>tx[c])i=tx[c];let f=q-i;b0=i;f0=f<0?0:f>1?1:f;
        q=(y-oy0)*inv-sy[c];i=Math.floor(q);if(i<0)i=0;else if(i>ty[c])i=ty[c];f=q-i;b1=i;f1=f<0?0:f>1?1:f;
        if(!flat){q=(z-oz0)*inv-sz2[c];i=Math.floor(q);if(i<0)i=0;else if(i>tz[c])i=tz[c];f=q-i;b2=i;f2=f<0?0:f>1?1:f;}}
        const vc=V[3*pI+c],c0=C[9*pI+3*c],c1=C[9*pI+3*c+1],c2=flat?0:C[9*pI+3*c+2];
        for(let dz=0;dz<zs;dz++){
          const wz=flat?1:(dz?f2:1-f2),k=b2+dz,fz=flat?0:c2*(o[2]+(k+oz)*h-z);
          for(let dy=0;dy<2;dy++){
            const wy=wz*(dy?f1:1-f1),j=b1+dy,fy=c1*(o[1]+(j+oy)*h-y)+fz,row=Nx*j+NxNy*k;
            for(let dx=0;dx<2;dx++){
              const w=wy*(dx?f0:1-f0);
              if(w===0)continue;
              const i=b0+dx,id=i+row;
              u[id]+=w*(vc+c0*(o[0]+(i+ox)*h-x)+fy);W[id]+=w;
            }
          }
        }
      }
      for(let id=0;id<u.length;id++)if(W[id]>0)u[id]/=W[id];
    }
    this.markLiquid();
  }
  /** Mark the cells that hold a particle (never a solid cell). */
  private markLiquid():void {
    const L=this.liquid,X=this.positions,o=this.origin,h=this.h,S=this.solid;L.fill(0);
    for(let pI=0;pI<this.count;pI++){
      let i=Math.floor((X[3*pI]-o[0])/h),j=Math.floor((X[3*pI+1]-o[1])/h),k=this.flat?0:Math.floor((X[3*pI+2]-o[2])/h);
      i=i<0?0:i>=this.nx?this.nx-1:i;j=j<0?0:j>=this.ny?this.ny-1:j;k=k<0?0:k>=this.nz?this.nz-1:k;
      const c=i+this.nx*(j+this.ny*k);if(!S[c])L[c]=1;
    }
  }

  /** Set the fixed faces: zero normal velocity on the tank walls, the obstacle's velocity next to a solid cell. */
  private boundary():void {
    const comps=this.flat?2:3;
    for(let c=0;c<comps;c++){const u=this.vel[c],F=this.fixed[c],FV=this.fixedValue[c];for(let f=0;f<u.length;f++)if(F[f])u[f]=FV[f];}
  }

  /** Faces next to at least one liquid cell (or fixed) are valid; the rest are filled from valid neighbours, two layers out. */
  private extrapolate():void {
    const comps=this.flat?2:3,nx=this.nx,ny=this.ny,L=this.liquid;
    for(let c=0;c<comps;c++){
      const [Nx,Ny,Nz]=this.dims[c],u=this.vel[c],valid=this.valid[c],tmp=this.scratch[c],F=this.fixed[c],n=[nx,ny,this.nz][c],sc=c===0?1:c===1?nx:nx*ny,NxNy=Nx*Ny;
      for(let k=0,id=0;k<Nz;k++)for(let j=0;j<Ny;j++)for(let i=0;i<Nx;i++,id++){
        const idx=c===0?i:c===1?j:k,hi=i+nx*(j+ny*k);
        const ok=F[id]===2||(idx<n&&L[hi])||(idx>0&&L[hi-sc]);
        valid[id]=ok?1:0;if(!ok)u[id]=0;
      }
      for(let layer=0;layer<2;layer++){
        tmp.set(u);const mark=this.markScratch(c,valid);
        for(let k=0,id=0;k<Nz;k++)for(let j=0;j<Ny;j++)for(let i=0;i<Nx;i++,id++){
          if(valid[id])continue;
          let s=0,m=0;
          if(i>0&&valid[id-1]){s+=u[id-1];m++;}
          if(i<Nx-1&&valid[id+1]){s+=u[id+1];m++;}
          if(j>0&&valid[id-Nx]){s+=u[id-Nx];m++;}
          if(j<Ny-1&&valid[id+Nx]){s+=u[id+Nx];m++;}
          if(!this.flat){if(k>0&&valid[id-NxNy]){s+=u[id-NxNy];m++;}if(k<Nz-1&&valid[id+NxNy]){s+=u[id+NxNy];m++;}}
          if(m>0){tmp[id]=s/m;mark[id]=1;}
        }
        u.set(tmp);valid.set(mark);
      }
    }
  }
  private readonly markBuffers:Uint8Array[]=[];private readonly acc=new Float64Array(2);private readonly vbuf:Float64Array[][]=[];
  private viscousBuffers(c:number,M:number):Float64Array[] {return this.vbuf[c]??=[0,1,2,3,4].map(()=>new Float64Array(M));}
  private markScratch(c:number,valid:Uint8Array):Uint8Array {const m=this.markBuffers[c]??=new Uint8Array(valid.length);m.set(valid);return m;}

  /**
   * Viscosity, backward Euler: (1 - dt nu L) u = u*, per component over the faces next to liquid. A neighbour face that is
   * fixed is a Dirichlet value; across a tank wall the ghost is -u (no-slip) or u (free-slip); an air face adds nothing
   * (zero normal gradient, the stress-free surface approximated). Jacobi-preconditioned conjugate gradients.
   */
  private diffuse():void {
    const nu=this.viscosity/this.density,k0=nu*this.dt/(this.h*this.h),comps=this.flat?2:3,nx=this.nx,ny=this.ny,L=this.liquid;
    let total=0;
    for(let c=0;c<comps;c++){
      const [Nx,Ny,Nz]=this.dims[c],u=this.vel[c],F=this.fixed[c],unknown=this.valid[c],n=[nx,ny,this.nz][c],sc=c===0?1:c===1?nx:nx*ny,NxNy=Nx*Ny,M=u.length;
      const diag=this.scratch[c],rhs=this.viscousBuffers(c,M)[4];
      // Unknown faces: next to a liquid cell and not fixed.
      let any=0;
      for(let k=0,id=0;k<Nz;k++)for(let j=0;j<Ny;j++)for(let i=0;i<Nx;i++,id++){
        const idx=c===0?i:c===1?j:k,hi=i+nx*(j+ny*k);
        const ok=!F[id]&&((idx<n&&L[hi])||(idx>0&&L[hi-sc]));unknown[id]=ok?1:0;if(ok)any++;
      }
      if(!any)continue;
      const axes=this.flat?2:3,FV=this.fixedValue[c],noSlip=this.noSlip;
      // One neighbour along axis a (0 x, 1 y, 2 z): unknown couples; fixed is a Dirichlet value (along the component its
      // normal velocity; across it a wall or obstacle, no-slip only); beyond a tank wall the ghost is -u (no-slip).
      const side=(id:number,nb:number,inside:boolean,a:number,acc:Float64Array)=>{
        if(!inside){if(noSlip)acc[0]+=2*k0;return;}
        if(unknown[nb]){acc[0]+=k0;return;}
        if(F[nb]&&(a===c||noSlip)){acc[0]+=k0;acc[1]+=k0*FV[nb];}
        void id;
      };
      const acc=this.acc;
      for(let k=0,id=0;k<Nz;k++)for(let j=0;j<Ny;j++)for(let i=0;i<Nx;i++,id++){
        if(!unknown[id]){diag[id]=0;rhs[id]=0;continue;}
        acc[0]=1;acc[1]=u[id];
        side(id,id-1,i>0,0,acc);side(id,id+1,i<Nx-1,0,acc);
        side(id,id-Nx,j>0,1,acc);side(id,id+Nx,j<Ny-1,1,acc);
        if(axes===3){side(id,id-NxNy,k>0,2,acc);side(id,id+NxNy,k<Nz-1,2,acc);}
        diag[id]=acc[0];rhs[id]=acc[1];
      }
      const apply=(x:Float64Array,out:Float64Array)=>{
        for(let k=0,id=0;k<Nz;k++)for(let j=0;j<Ny;j++)for(let i=0;i<Nx;i++,id++){
          if(!unknown[id]){out[id]=0;continue;}
          let s=diag[id]*x[id];
          if(i>0&&unknown[id-1])s-=k0*x[id-1];if(i<Nx-1&&unknown[id+1])s-=k0*x[id+1];
          if(j>0&&unknown[id-Nx])s-=k0*x[id-Nx];if(j<Ny-1&&unknown[id+Nx])s-=k0*x[id+Nx];
          if(axes===3){if(k>0&&unknown[id-NxNy])s-=k0*x[id-NxNy];if(k<Nz-1&&unknown[id+NxNy])s-=k0*x[id+NxNy];}
          out[id]=s;
        }
      };
      const [r,zz,d,Ad]=this.viscousBuffers(c,M);
      apply(u,Ad);let bmax=0,rmax=0;
      for(let id=0;id<M;id++){if(!unknown[id])continue;r[id]=rhs[id]-Ad[id];bmax=Math.max(bmax,Math.abs(rhs[id]));rmax=Math.max(rmax,Math.abs(r[id]));}
      const tol=this.viscousTolerance*Math.max(bmax,1e-300);let it=0;
      if(rmax>tol){
        let rz=0;for(let id=0;id<M;id++)if(unknown[id]){zz[id]=r[id]/diag[id];d[id]=zz[id];rz+=r[id]*zz[id];}
        for(;it<this.maxIterations;it++){
          apply(d,Ad);let dAd=0;for(let id=0;id<M;id++)dAd+=d[id]*Ad[id];
          if(!(dAd>0))break;
          const alpha=rz/dAd;rmax=0;
          for(let id=0;id<M;id++){if(!unknown[id])continue;u[id]+=alpha*d[id];r[id]-=alpha*Ad[id];const a=Math.abs(r[id]);if(a>rmax)rmax=a;}
          if(rmax<=tol){it++;break;}
          let rzNew=0;for(let id=0;id<M;id++)if(unknown[id]){zz[id]=r[id]/diag[id];rzNew+=r[id]*zz[id];}
          const beta=rzNew/rz;rz=rzNew;
          for(let id=0;id<M;id++)if(unknown[id])d[id]=zz[id]+beta*d[id];
        }
        if(rmax>tol)this.stats.unconverged++;
      }
      total+=it;
    }
    this.stats.viscousIterations=total;
  }

  /** Solve A x = b over the liquid cells (diag and b set), MIC(0)-preconditioned conjugate gradients, until max |r| <= tol. Returns the iterations. */
  private solvePoisson(p:Float64Array,tol:number):number {
    const b=this.b,diag=this.diag,pre=this.pre,r=this.r,z=this.z,d=this.d,q=this.q,L=this.liquid,nx=this.nx,ny=this.ny,nz=this.nz,N=this.cellsTotal,flat=this.flat,sy=nx,sz=nx*ny;
    let liquid=0;for(let c=0;c<N;c++)liquid+=L[c];
    p.fill(0);
    // MIC(0): for each lower liquid neighbour m, subtract pre[m]^2 (1 + 0.97 (number of m's other upper liquid neighbours)).
    const up=(c:number,i:number,j:number,k:number,skip:number):number=>(skip!==0&&i<nx-1&&L[c+1]===1?1:0)+(skip!==1&&j<ny-1&&L[c+sy]===1?1:0)+(skip!==2&&!flat&&k<nz-1&&L[c+sz]===1?1:0);
    for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
      if(!L[c]){pre[c]=0;continue;}
      let e=diag[c];
      if(i>0&&L[c-1]===1){const m=c-1;e-=pre[m]*pre[m]*(1+.97*up(m,i-1,j,k,0));}
      if(j>0&&L[c-sy]===1){const m=c-sy;e-=pre[m]*pre[m]*(1+.97*up(m,i,j-1,k,1));}
      if(!flat&&k>0&&L[c-sz]===1){const m=c-sz;e-=pre[m]*pre[m]*(1+.97*up(m,i,j,k-1,2));}
      if(e<.25*diag[c])e=diag[c];
      pre[c]=e>0?1/Math.sqrt(e):0;
    }
    const applyA=(x:Float64Array,out:Float64Array)=>{
      for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
        if(!L[c]){out[c]=0;continue;}
        let s=diag[c]*x[c];
        if(i>0&&L[c-1])s-=x[c-1];if(i<nx-1&&L[c+1])s-=x[c+1];
        if(j>0&&L[c-sy])s-=x[c-sy];if(j<ny-1&&L[c+sy])s-=x[c+sy];
        if(!flat){if(k>0&&L[c-sz])s-=x[c-sz];if(k<nz-1&&L[c+sz])s-=x[c+sz];}
        out[c]=s;
      }
    };
    const tmp=this.q;
    const precondition=(rr:Float64Array,out:Float64Array)=>{
      for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
        if(!L[c]){tmp[c]=0;continue;}
        let t=rr[c];
        if(i>0&&L[c-1])t+=pre[c-1]*tmp[c-1];
        if(j>0&&L[c-sy])t+=pre[c-sy]*tmp[c-sy];
        if(!flat&&k>0&&L[c-sz])t+=pre[c-sz]*tmp[c-sz];
        tmp[c]=t*pre[c];
      }
      for(let k=nz-1,c=N-1;k>=0;k--)for(let j=ny-1;j>=0;j--)for(let i=nx-1;i>=0;i--,c--){
        if(!L[c]){out[c]=0;continue;}
        let t=tmp[c];
        if(i<nx-1&&L[c+1])t+=pre[c]*out[c+1];
        if(j<ny-1&&L[c+sy])t+=pre[c]*out[c+sy];
        if(!flat&&k<nz-1&&L[c+sz])t+=pre[c]*out[c+sz];
        out[c]=t*pre[c];
      }
    };
    r.set(b);
    let rmax=0;for(let c=0;c<N;c++){const a=Math.abs(r[c]);if(a>rmax)rmax=a;}
    let it=0;
    if(rmax>tol&&liquid>0){
      const Ad=this.Ad;
      precondition(r,z);
      let rz=0;for(let c=0;c<N;c++){d[c]=z[c];rz+=r[c]*z[c];}
      for(;it<this.maxIterations;it++){
        applyA(d,Ad);
        let dAd=0;for(let c=0;c<N;c++)dAd+=d[c]*Ad[c];
        if(!(dAd>0))break;
        const alpha=rz/dAd;rmax=0;
        for(let c=0;c<N;c++){p[c]+=alpha*d[c];r[c]-=alpha*Ad[c];const a=Math.abs(r[c]);if(a>rmax)rmax=a;}
        if(rmax<=tol){it++;break;}
        precondition(r,z);
        let rzNew=0;for(let c=0;c<N;c++)rzNew+=r[c]*z[c];
        const beta=rzNew/rz;rz=rzNew;
        for(let c=0;c<N;c++)d[c]=z[c]+beta*d[c];
      }
      if(rmax>tol)this.stats.unconverged++;
    }
    return it;
  }

  /** Project the liquid cells: A p = -h^2 (rho / dt) div u with p = 0 in empty cells, MIC(0)-preconditioned CG. Solid cells and walls are closed. */
  private project(first=true):void {
    const nx=this.nx,ny=this.ny,nz=this.nz,N=this.cellsTotal,L=this.liquid,S=this.solid,h=this.h,rho=this.density,dt=this.dt,flat=this.flat;
    const [u,v,w]=this.vel,b=this.b,diag=this.diag,pre=this.pre,p=first?this.p:this.p2,r=this.r,z=this.z,d=this.d,q=this.q;
    const U=(i:number,j:number,k:number)=>i+(nx+1)*(j+ny*k),Vi=(i:number,j:number,k:number)=>i+nx*(j+(ny+1)*k),Wi=(i:number,j:number,k:number)=>i+nx*(j+ny*k);
    const sy=nx,sz=nx*ny;
    let liquid=0,dirichlet=false,vmax=0;
    for(let id=0;id<3;id++){const x=this.vel[id];for(let f=0;f<x.length;f++){const a=Math.abs(x[f]);if(a>vmax)vmax=a;}}
    p.fill(0);
    // Distance from each empty cell's centre to the liquid surface, from the particles: min |x - x_p| - s / 2 (s the seeding
    // spacing), so that a flat surface lies half a spacing above the top particles, where seeding put it. Only particles
    // in cells with an empty cell among their 27 neighbours can be the nearest to one.
    const phi=this.phi,near=this.near,X=this.positions,o=this.origin,radius=h/(2*this.perAxis);
    phi.fill(Infinity);near.fill(0);
    for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
      if(L[c]||S[c])continue;
      for(let dk=flat?0:-1;dk<=(flat?0:1);dk++){const kk=k+dk;if(kk<0||kk>=nz)continue;
        for(let dj=-1;dj<=1;dj++){const jj=j+dj;if(jj<0||jj>=ny)continue;
          for(let di=-1;di<=1;di++){const ii=i+di;if(ii<0||ii>=nx)continue;near[ii+nx*(jj+ny*kk)]=1;}}}
    }
    for(let pI=0;pI<this.count;pI++){
      const x=X[3*pI],y=X[3*pI+1],zp=X[3*pI+2];
      const ci=Math.floor((x-o[0])/h),cj=Math.floor((y-o[1])/h),ck=flat?0:Math.floor((zp-o[2])/h);
      if(ci<0||cj<0||ck<0||ci>=nx||cj>=ny||ck>=nz||!near[ci+nx*(cj+ny*ck)])continue;
      for(let dk=flat?0:-1;dk<=(flat?0:1);dk++)for(let dj=-1;dj<=1;dj++)for(let di=-1;di<=1;di++){
        const i=ci+di,j=cj+dj,k=ck+dk;if(i<0||j<0||k<0||i>=nx||j>=ny||k>=nz)continue;
        const c=i+nx*(j+ny*k);if(L[c]||S[c])continue;
        const ex=o[0]+(i+.5)*h-x,ey=o[1]+(j+.5)*h-y,ez=flat?0:o[2]+(k+.5)*h-zp,dist=Math.sqrt(ex*ex+ey*ey+ez*ez)-radius;
        if(dist<phi[c])phi[c]=dist;
      }
    }
    // theta: fraction of the way from a liquid centre to the next empty centre at which the surface lies (ghost fluid,
    // p = 0 on the surface), from that empty cell's distance assuming unit slope; at least 0.05.
    const theta=(air:number)=>{const t=1-phi[air]/h;return t<.05?.05:t>1?1:t;};
    // Neighbour state: 1 liquid, 0 air, -1 wall or solid.
    const nb=(i:number,j:number,k:number):number=>{if(i<0||j<0||k<0||i>=nx||j>=ny||k>=nz)return -1;const c=i+nx*(j+ny*k);return S[c]?-1:L[c];};
    for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
      if(!L[c]){b[c]=0;diag[c]=0;continue;}
      liquid++;
      let dg=0;
      for(let a=0;a<(flat?4:6);a++){
        const ii=i+(a===0?-1:a===1?1:0),jj=j+(a===2?-1:a===3?1:0),kk=k+(a===4?-1:a===5?1:0);
        const s=nb(ii,jj,kk);if(s===1)dg++;if(s===0){dg+=1/theta(ii+nx*(jj+ny*kk));dirichlet=true;}
      }
      diag[c]=dg;
      const div=(u[U(i+1,j,k)]-u[U(i,j,k)]+v[Vi(i,j+1,k)]-v[Vi(i,j,k)]+(flat?0:w[Wi(i,j,k+1)]-w[Wi(i,j,k)]))/h;
      b[c]=-h*h*rho/dt*div;
    }
    this.stats.liquidCells=liquid;
    if(!dirichlet&&liquid>0){let mean=0;for(let c=0;c<N;c++)if(L[c])mean+=b[c];mean/=liquid;for(let c=0;c<N;c++)if(L[c])b[c]-=mean;}
    const tol=this.pressureTolerance*Math.max(vmax,1e-300)*rho*h/dt;
    const it=this.solvePoisson(p,tol);
    this.stats.pressureIterations=it;
    // u -= (dt / rho) grad p on faces with a liquid cell on at least one side and no wall or solid.
    const k0=dt/(rho*h);
    // Pressure difference across a face; an empty side takes the ghost value p_l (1 - 1 / theta) that is zero on the surface.
    const jump=(lo:number,hi:number):number=>{
      const a=L[lo],c=L[hi];
      if(a&&c)return p[hi]-p[lo];
      if(a)return -p[lo]/theta(hi);
      return p[hi]/theta(lo);
    };
    for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=1;i<nx;i++){const lo=i-1+nx*(j+ny*k),hi=lo+1;if((L[lo]||L[hi])&&!S[lo]&&!S[hi])u[U(i,j,k)]-=k0*jump(lo,hi);}
    for(let k=0;k<nz;k++)for(let j=1;j<ny;j++)for(let i=0;i<nx;i++){const lo=i+nx*(j-1+ny*k),hi=lo+nx;if((L[lo]||L[hi])&&!S[lo]&&!S[hi])v[Vi(i,j,k)]-=k0*jump(lo,hi);}
    if(!flat)for(let k=1;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){const lo=i+nx*(j+ny*(k-1)),hi=lo+nx*ny;if((L[lo]||L[hi])&&!S[lo]&&!S[hi])w[Wi(i,j,k)]-=k0*jump(lo,hi);}
    // Pressure force on each obstacle: p h^2 on every face between one of its cells and a liquid cell, pushing into the solid.
    if(this.obstacles.length){
      if(first)for(const ob of this.obstacles)ob.force.fill(0);
      const own=this.owner,area=h*h;
      for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
        if(!S[c])continue;const f=this.obstacles[own[c]].force;
        if(i>0&&L[c-1])f[0]+=p[c-1]*area;if(i<nx-1&&L[c+1])f[0]-=p[c+1]*area;
        if(j>0&&L[c-sy])f[1]+=p[c-sy]*area;if(j<ny-1&&L[c+sy])f[1]-=p[c+sy]*area;
        if(!flat){if(k>0&&L[c-sz])f[2]+=p[c-sz]*area;if(k<nz-1&&L[c+sz])f[2]-=p[c+sz]*area;}
      }
    }
    if(!first)for(let c=0;c<N;c++)this.p[c]+=p[c];
    this.stats.divergence=vmax>0?this.maxDivergence()*h/vmax:0;
  }

  /** Largest |div u| over the liquid cells, 1/s. */
  maxDivergence():number {
    const nx=this.nx,ny=this.ny,[u,v,w]=this.vel,h=this.h;let m=0;
    for(let k=0,c=0;k<this.nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
      if(!this.liquid[c])continue;
      const d=Math.abs(u[i+1+(nx+1)*(j+ny*k)]-u[i+(nx+1)*(j+ny*k)]+v[i+nx*(j+1+(ny+1)*k)]-v[i+nx*(j+(ny+1)*k)]+(this.flat?0:w[i+nx*(j+ny*(k+1))]-w[i+nx*(j+ny*k)]));
      if(d>m)m=d;
    }
    return m/h;
  }

  /** Grid to particles (APIC: velocity and its gradient), then move the particles, keeping them inside the tank and out of solid cells. */
  private toParticles():void {
    const h=this.h,X=this.positions,V=this.velocities,C=this.affine,dt=this.dt,o=this.origin,comps=this.flat?2:3,flat=this.flat;
    const inv=1/h,ox0=o[0],oy0=o[1],oz0=o[2],sx=[0,.5,.5],sy=[.5,0,.5],sz2=[.5,.5,0],tx=this.dims.map(d=>d[0]-2),ty=this.dims.map(d=>d[1]-2),tz=this.dims.map(d=>d[2]-2),NX=this.dims.map(d=>d[0]),NXY=this.dims.map(d=>d[0]*d[1]);
    const wallSlip=this.noSlip&&this.viscosity>0;
    const hi=[o[0]+this.nx*h,o[1]+this.ny*h,o[2]+this.nz*h],eps=1e-6*h,S=this.solid,hasSolid=this.stats.solidCells>0,nx=this.nx,ny=this.ny,nz=this.nz;
    const solidAt=(x:number,y:number,z:number)=>{
      let i=Math.floor((x-o[0])/h),j=Math.floor((y-o[1])/h),k=flat?0:Math.floor((z-o[2])/h);
      i=i<0?0:i>=nx?nx-1:i;j=j<0?0:j>=ny?ny-1:j;k=k<0?0:k>=nz?nz-1:k;return S[i+nx*(j+ny*k)]===1;
    };
    let vmax=0;
    for(let pI=0;pI<this.count;pI++){
      const x=X[3*pI],y=X[3*pI+1],z=X[3*pI+2];
      for(let c=0;c<comps;c++){
        const Nx=NX[c],u=this.vel[c],NxNy=NXY[c];
        let b0=0,b1=0,b2=0,f0=0,f1=0,f2=0;
        {let q=(x-ox0)*inv-sx[c],i=Math.floor(q);if(i<0)i=0;else if(i>tx[c])i=tx[c];let f=q-i;b0=i;f0=f<0?0:f>1?1:f;
        q=(y-oy0)*inv-sy[c];i=Math.floor(q);if(i<0)i=0;else if(i>ty[c])i=ty[c];f=q-i;b1=i;f1=f<0?0:f>1?1:f;
        if(!flat){q=(z-oz0)*inv-sz2[c];i=Math.floor(q);if(i<0)i=0;else if(i>tz[c])i=tz[c];f=q-i;b2=i;f2=f<0?0:f>1?1:f;}}
        let vc=0,gx=0,gy=0,gz=0;
        const zs=flat?1:2;
        for(let dz=0;dz<zs;dz++){
          const wz=flat?1:(dz?f2:1-f2),sz=dz?1:-1;
          for(let dy=0;dy<2;dy++){
            const wy=dy?f1:1-f1,row=Nx*(b1+dy)+NxNy*(b2+dz);
            for(let dx=0;dx<2;dx++){
              const wx=dx?f0:1-f0,value=u[b0+dx+row];
              vc+=wx*wy*wz*value;
              gx+=(dx?1:-1)*wy*wz*value;gy+=wx*(dy?1:-1)*wz*value;if(!flat)gz+=wx*wy*sz*value;
            }
          }
        }
        gx/=h;gy/=h;gz/=h;
        // Viscous no-slip walls: between a wall and the first row of tangential faces, interpolate toward the ghost row
        // (-u), which puts zero tangential velocity on the wall, instead of holding the first row's value.
        if(wallSlip)for(let d=0;d<comps;d++){
          if(d===c)continue;
          const n=this.dims[c][d],sd=((d===0?x:d===1?y:z)-o[d])/h-.5;
          let t=0,sign=0;
          if(sd<0){t=-sd;sign=1;}else if(sd>n-1){t=sd-(n-1);sign=-1;}
          if(!sign)continue;
          const factor=1-2*t,slope=2*vc/h*sign;
          vc*=factor;
          if(d===0){gx=slope;gy*=factor;gz*=factor;}else if(d===1){gy=slope;gx*=factor;gz*=factor;}else{gz=slope;gx*=factor;gy*=factor;}
        }
        V[3*pI+c]=vc;C[9*pI+3*c]=gx;C[9*pI+3*c+1]=gy;C[9*pI+3*c+2]=gz;
      }
      for(let d=0;d<comps;d++){
        const old=X[3*pI+d];
        let nxp=old+dt*V[3*pI+d];
        if(nxp<o[d]+eps){nxp=o[d]+eps;if(V[3*pI+d]<0)V[3*pI+d]=0;}
        else if(nxp>hi[d]-eps){nxp=hi[d]-eps;if(V[3*pI+d]>0)V[3*pI+d]=0;}
        X[3*pI+d]=nxp;
        // Into a solid cell along this axis: stay, and lose the velocity into it.
        if(hasSolid&&solidAt(X[3*pI],X[3*pI+1],X[3*pI+2])){X[3*pI+d]=old;V[3*pI+d]=0;}
      }
      const s=Math.abs(V[3*pI])+Math.abs(V[3*pI+1])+Math.abs(V[3*pI+2]);if(s>vmax)vmax=s;
    }
    const cfl=vmax*dt/h;this.stats.cfl=cfl;if(cfl>this.stats.maxCfl)this.stats.maxCfl=cfl;if(cfl>this.cflLimit)this.stats.cflExceeded++;
  }

  /** Advance by count steps of dt. */
  step(count=1):void {
    for(let s=0;s<count;s++){
      if(this.solidDirty)this.classify();
      this.toGrid();
      const comps=this.flat?2:3;
      for(let c=0;c<comps;c++){const u=this.vel[c],W=this.weight[c],g=this.dt*this.gravity[c];for(let id=0;id<u.length;id++)if(W[id]>0)u[id]+=g;}
      this.boundary();
      // Viscous: project, diffuse, project again. Diffusing the divergence-free field (not the raw gravity increment) keeps
      // a liquid at rest at rest, and the steady state is nu lap u = grad p / rho - g whatever the step.
      if(this.viscosity>0){this.project();this.boundary();this.diffuse();this.boundary();this.project(false);}
      else this.project();
      this.boundary();
      this.extrapolate();
      this.toParticles();
      this.time+=this.dt;this.stats.steps++;
    }
  }

  /** Volume of the cells that hold particles, m^3 (a 2D tank counts its one cell of depth). */
  liquidVolume():number {let n=0;for(let c=0;c<this.cellsTotal;c++)n+=this.liquid[c];return n*this.h**3;}
  /** Volume the particles stand for: their count times the volume each was seeded with, m^3. */
  particleVolume():number {return this.count*this.particleMass/this.density;}
  kineticEnergy():number {let s=0;const V=this.velocities;for(let i=0;i<3*this.count;i++)s+=V[i]*V[i];return .5*this.particleMass*s;}
  /** - m g . x summed over the particles, J (zero at the origin). */
  potentialEnergy():number {let s=0;const X=this.positions,g=this.gravity;for(let pI=0;pI<this.count;pI++)s-=g[0]*X[3*pI]+g[1]*X[3*pI+1]+g[2]*X[3*pI+2];return this.particleMass*s;}
  /** Largest coordinate of a particle along an axis, m. */
  front(axis:0|1|2=0):number {let m=-Infinity;for(let pI=0;pI<this.count;pI++)if(this.positions[3*pI+axis]>m)m=this.positions[3*pI+axis];return m;}
  /** Highest particle whose x lies in [x0, x1), m (-Infinity when none). */
  surfaceHeight(x0:number,x1:number):number {let m=-Infinity;const X=this.positions;for(let pI=0;pI<this.count;pI++){const x=X[3*pI];if(x>=x0&&x<x1&&X[3*pI+1]>m)m=X[3*pI+1];}return m;}
  /** Largest particle speed, m/s. */
  maxSpeed():number {let m=0;const V=this.velocities;for(let pI=0;pI<this.count;pI++){const s=Math.hypot(V[3*pI],V[3*pI+1],V[3*pI+2]);if(s>m)m=s;}return m;}
  /** Mean grid velocity component c of the faces next to liquid cells whose centre lies in the box [lo, hi), m/s, from the last step. */
  meanVelocity(c:0|1|2,lo:FluidVec3,hi:FluidVec3):number {
    const [Nx,Ny,Nz]=this.dims[c],u=this.vel[c],h=this.h,o=this.origin;let s=0,n=0;
    for(let k=0,id=0;k<Nz;k++)for(let j=0;j<Ny;j++)for(let i=0;i<Nx;i++,id++){
      const x=o[0]+(i+(c===0?0:.5))*h,y=o[1]+(j+(c===1?0:.5))*h,z=o[2]+(k+(c===2?0:.5))*h;
      if(x<lo[0]||x>=hi[0]||y<lo[1]||y>=hi[1]||(!this.flat&&(z<lo[2]||z>=hi[2])))continue;
      const idx=c===0?i:c===1?j:k,cell=i+this.nx*(j+this.ny*k),sc=c===0?1:c===1?this.nx:this.nx*this.ny,n2=[this.nx,this.ny,this.nz][c];
      if(!((idx<n2&&this.liquid[cell])||(idx>0&&this.liquid[cell-sc])))continue;
      s+=u[id];n++;
    }
    return n?s/n:0;
  }
}

/** Linear standing wave in a tank of length L and depth H, mode n: omega^2 = g k tanh(k H), k = n pi / L. Returns the frequency, Hz. */
export const sloshingFrequency=(length:number,depth:number,gravity=9.81,mode=1):number=>{const k=mode*Math.PI/length;return Math.sqrt(gravity*k*Math.tanh(k*depth))/(2*Math.PI);};

// -------------------------------------------------------------------------------------------------
// Closed forms used by the validation.
// -------------------------------------------------------------------------------------------------

/** Taylor-Green vortex in a periodic square of side 2 pi / k: u = U sin kx cos ky e^(-2 nu k^2 t), v = -U cos kx sin ky e^(-2 nu k^2 t). */
export function taylorGreenVelocity(x:number,y:number,t:number,{speed=1,wavenumber=1,nu}:{speed?:number;wavenumber?:number;nu:number}):[number,number,number] {
  const decay=Math.exp(-2*nu*wavenumber*wavenumber*t);
  return [speed*Math.sin(wavenumber*x)*Math.cos(wavenumber*y)*decay,-speed*Math.cos(wavenumber*x)*Math.sin(wavenumber*y)*decay,0];
}
/** Plane Poiseuille flow between walls at 0 and H driven by a body acceleration G: u = G y (H - y) / (2 nu). */
export const poiseuilleVelocity=(y:number,height:number,acceleration:number,nu:number):number=>acceleration*y*(height-y)/(2*nu);
/**
 * Fully developed flow in a rectangular duct |y| < a, |z| < b driven by a body acceleration G (pressure gradient over
 * density), kinematic viscosity nu (series solution, e.g. White, Viscous Fluid Flow, sec. 3-3; written from memory and
 * checked against the solver and against the limit b >> a, where it tends to plane Poiseuille flow):
 *   u = (16 a^2 G / (nu pi^3)) sum_{n odd} (-1)^((n-1)/2) [1 - cosh(n pi z / 2a) / cosh(n pi b / 2a)] cos(n pi y / 2a) / n^3
 */
export function ductVelocity(y:number,z:number,a:number,b:number,acceleration:number,nu:number,terms=200):number {
  let s=0;
  for(let i=0;i<terms;i++){
    const n=2*i+1,sign=i%2===0?1:-1,arg=n*Math.PI/(2*a);
    // cosh(arg z) / cosh(arg b) without overflow.
    const ratio=Math.exp(arg*(Math.abs(z)-b))*(1+Math.exp(-2*arg*Math.abs(z)))/(1+Math.exp(-2*arg*b));
    s+=sign*(1-ratio)*Math.cos(arg*y)/(n*n*n);
  }
  return 16*a*a*acceleration/(nu*Math.PI**3)*s;
}
/** Volume flow of the same duct: Q = (4 b a^3 G / (3 nu)) [1 - (192 a / (pi^5 b)) sum_{n odd} tanh(n pi b / 2a) / n^5]. */
export function ductFlowRate(a:number,b:number,acceleration:number,nu:number,terms=200):number {
  let s=0;for(let i=0;i<terms;i++){const n=2*i+1;s+=Math.tanh(n*Math.PI*b/(2*a))/n**5;}
  return 4*b*a**3*acceleration/(3*nu)*(1-192*a/(Math.PI**5*b)*s);
}
/**
 * Drag of a simple cubic array of spheres in Stokes flow over that of one sphere alone, K = F / (6 pi mu a U), with U the
 * mean velocity over the whole periodic cell and c the solid fraction (Hasimoto 1959, as given by Ladd 1994, eq. 3.5):
 *   1 / K = 1 - 1.7601 c^(1/3) + c - 1.5593 c^2
 */
export const hasimotoDragFactor=(solidFraction:number):number=>1/(1-1.7601*Math.cbrt(solidFraction)+solidFraction-1.5593*solidFraction*solidFraction);

// -------------------------------------------------------------------------------------------------
// Coupling to a rigid world.
// -------------------------------------------------------------------------------------------------

/** The part of a rigid-body world the coupling uses. The kit's PhysicsWorld satisfies it. */
export interface FluidWorld<B> {
  gravity():readonly number[];
  getState(body:B):{readonly position:readonly number[];readonly rotation:readonly number[];readonly linearVelocity:readonly number[];readonly angularVelocity:readonly number[];readonly mass:number;readonly type:string};
  applyForce(body:B,force:FluidVec3):void;
  applyTorque(body:B,torque:FluidVec3):void;
  isAlive?(body:B):boolean;
  readonly loop?:{readonly step:number};
}
export interface FluidBodyOptions {
  /** The world cannot report shapes: say what the body is. Its position is the body's centre of mass. */
  readonly shape:FluidShape;
  /** False: the fluid feels the body but the body is not pushed. Default true. */
  readonly twoWay?:boolean;
}
export interface FluidCouplingOptions {
  /** The rigid step, s, when the world has no `loop.step`. */
  readonly step?:number;
}
export interface FluidCouplingDiagnostics {
  /** Kinetic energy of the fluid, J; translational kinetic energy of the coupled dynamic bodies, J. */
  fluidKinetic:number;bodyKinetic:number;
  /** Momentum of the fluid outside the bodies plus that of the coupled dynamic bodies (from the world), kg m/s. */
  momentum:[number,number,number];
  dissipated:number;workByBodies:number;
}
interface CoupledBody<B> {readonly body:B;readonly index:number;readonly dynamic:boolean;readonly twoWay:boolean;readonly force:Float64Array;readonly torque:Float64Array}

/**
 * Two-way coupling of a Fluid with a rigid world. Call `step()` immediately before `world.step()`. Every coupled body is
 * a moving obstacle at the pose and velocity the world reports; the fluid takes `substeps` = rigid step / fluid step of
 * its own steps (the body moving at that velocity), and each dynamic body receives the mean hydrodynamic force and torque
 * of those steps (buoyancy included) to act through the rigid step. The impulse the fluid receives and the impulse the
 * body is handed are the same numbers with opposite signs. The body's response comes one rigid step later (explicit
 * coupling): a body lighter than about the fluid it displaces can be unstable.
 */
export class FluidCoupling<B> {
  readonly backend=FLUID_COUPLING_BACKEND;
  readonly world:FluidWorld<B>;readonly fluid:Fluid;readonly dt:number;readonly substeps:number;
  private readonly list:CoupledBody<B>[]=[];private readonly byBody=new Map<B,CoupledBody<B>>();
  private readonly out:[number,number,number]=[0,0,0];
  steps=0;
  constructor(world:FluidWorld<B>,fluid:Fluid,options:FluidCouplingOptions={}) {
    if(!world||typeof world.getState!=='function'||typeof world.applyForce!=='function'||typeof world.applyTorque!=='function'||typeof world.gravity!=='function')
      throw new TypeError('FluidCoupling needs a world with gravity(), getState(), applyForce() and applyTorque().');
    if(!(fluid instanceof Fluid))throw new TypeError('FluidCoupling needs a Fluid.');
    this.world=world;this.fluid=fluid;
    this.dt=num(world.loop?world.loop.step:options.step,'the rigid step (world.loop.step or options.step)',1e-12,10);
    const ratio=this.dt/fluid.dt,whole=Math.round(ratio);
    if(whole<1||Math.abs(ratio-whole)>1e-9*whole)fail(`The fluid steps at ${fluid.dt} s and the world at ${this.dt} s: the world step must be a whole number of fluid steps (it is ${ratio}).`);
    this.substeps=whole;
  }
  addBody(body:B,options:FluidBodyOptions):number {
    if(this.byBody.has(body))fail('That body is already coupled to this fluid.');
    const s=this.world.getState(body);
    const index=this.fluid.addObstacle({shape:options.shape,position:s.position,rotation:s.rotation,linearVelocity:s.type==='static'?undefined:s.linearVelocity,angularVelocity:s.type==='static'?undefined:s.angularVelocity});
    const entry:CoupledBody<B>={body,index,dynamic:s.type==='dynamic',twoWay:options.twoWay??true,force:new Float64Array(3),torque:new Float64Array(3)};
    this.list.push(entry);this.byBody.set(body,entry);return index;
  }
  private entry(body:B):CoupledBody<B> {const e=this.byBody.get(body);if(!e)fail('That body is not coupled to this fluid: addBody() it first.');return e as CoupledBody<B>;}
  indexOf(body:B):number {return this.entry(body).index;}
  /** Mean force (N) and torque about the centre of mass (N m) of the last rigid step. Live arrays. */
  force(body:B):Float64Array {return this.entry(body).force;}
  torque(body:B):Float64Array {return this.entry(body).torque;}
  step():void {
    const world=this.world,fluid=this.fluid,h=fluid.dt,n=this.substeps,out=this.out;
    const states:{x:number[];q:number[];v:number[];w:number[]}[]=[];
    for(const e of this.list){
      const alive=!world.isAlive||world.isAlive(e.body);
      fluid.setObstacleEnabled(e.index,alive);
      if(!alive){states.push({x:[0,0,0],q:[0,0,0,1],v:[0,0,0],w:[0,0,0]});continue;}
      const s=world.getState(e.body);
      states.push({x:[...s.position],q:[...s.rotation],v:[...s.linearVelocity],w:[...s.angularVelocity]});
      e.force.fill(0);e.torque.fill(0);
    }
    for(let k=0;k<n;k++){
      for(let i=0;i<this.list.length;i++){
        const e=this.list[i],s=states[i];if(!(!world.isAlive||world.isAlive(e.body)))continue;
        // The body moves at its velocity through the sub-steps: position and orientation advanced to the sub-step's start.
        const t=k*h,x=[s.x[0]+s.v[0]*t,s.x[1]+s.v[1]*t,s.x[2]+s.v[2]*t];
        const q=k===0?s.q:integrateQuaternion(s.q,s.w,t);
        fluid.setObstacleState(e.index,{position:x,rotation:q,linearVelocity:s.v,angularVelocity:s.w});
      }
      fluid.step(1);
      for(const e of this.list){const F=fluid.obstacleForce(e.index),T=fluid.obstacleTorque(e.index);for(let c=0;c<3;c++){e.force[c]+=F[c]/n;e.torque[c]+=T[c]/n;}}
    }
    for(const e of this.list){
      if(!e.dynamic||!e.twoWay)continue;
      if(world.isAlive&&!world.isAlive(e.body))continue;
      out[0]=flush(e.force[0]);out[1]=flush(e.force[1]);out[2]=flush(e.force[2]);
      if(out[0]!==0||out[1]!==0||out[2]!==0)world.applyForce(e.body,out);
      out[0]=flush(e.torque[0]);out[1]=flush(e.torque[1]);out[2]=flush(e.torque[2]);
      if(out[0]!==0||out[1]!==0||out[2]!==0)world.applyTorque(e.body,out);
    }
    this.steps++;
  }
  /** Energies and momentum of the fluid and the coupled dynamic bodies. Allocates; not for the hot path. */
  diagnostics():FluidCouplingDiagnostics {
    const f=this.fluid,momentum=f.momentum();
    const d:FluidCouplingDiagnostics={fluidKinetic:f.kineticEnergy(),bodyKinetic:0,momentum,dissipated:f.dissipated,workByBodies:f.workByBodies};
    for(const e of this.list){
      if(!e.dynamic)continue;
      if(this.world.isAlive&&!this.world.isAlive(e.body))continue;
      const s=this.world.getState(e.body),v=s.linearVelocity;
      d.bodyKinetic+=.5*s.mass*(v[0]*v[0]+v[1]*v[1]+v[2]*v[2]);
      for(let k=0;k<3;k++)momentum[k]+=s.mass*v[k];
    }
    return d;
  }
}
/** q advanced by a constant angular velocity w (world axes) over t: q' = exp(w t / 2) q. */
function integrateQuaternion(q:readonly number[],w:readonly number[],t:number):number[] {
  const wx=w[0]*t,wy=w[1]*t,wz=w[2]*t,angle=Math.sqrt(wx*wx+wy*wy+wz*wz);
  if(angle===0)return [q[0],q[1],q[2],q[3]];
  const s=Math.sin(angle/2)/angle,c=Math.cos(angle/2),ax=wx*s,ay=wy*s,az=wz*s;
  return [c*q[0]+ax*q[3]+ay*q[2]-az*q[1],c*q[1]+ay*q[3]+az*q[0]-ax*q[2],c*q[2]+az*q[3]+ax*q[1]-ay*q[0],c*q[3]-ax*q[0]-ay*q[1]-az*q[2]];
}

/** Where the fluid runs inside the couple stage of a Simulation: after the grains (160) and solid contact (170), before the water (200). */
export const FLUID_SUBSYSTEM_ORDER=180;

/**
 * A fluid as a subsystem of the one stepping loop (simulation.ts).
 *  - A `FluidCoupling`: couple stage, order 180. Its time step is the rigid step (it takes `substeps` fluid steps inside).
 *  - A bare `Fluid`: post stage; its dt may be the step, a whole fraction of it or a whole multiple.
 * Registration fails with UNSTABLE_TIME_STEP when the step is above the explicit viscous limit or the starting Courant
 * number is above `cflLimit` (unless the Fluid was built with allowUnstable).
 * Energy: kinetic energy of the fluid; `exchanged` is the work of the bodies, moving walls, open sides and body forces;
 * the parts list `dissipated` (viscous): total - exchanged + dissipated is constant up to the discretisation error.
 * Events, at the end of a step: 'cfl-exceeded' {cfl} when the Courant number first rises above the limit,
 * 'unconverged' {iterations} when a projection stopped at maxIterations, 'unstable-step' once when accepted above a limit.
 */
export function fluidSubsystem<W,B>(target:Fluid|FluidCoupling<B>,options:{readonly id?:string;readonly order?:number}={}):Subsystem<W,B> {
  const coupling=target instanceof FluidCoupling?target:null,fluid=coupling?coupling.fluid:target as Fluid;
  if(!(fluid instanceof Fluid))throw new TypeError('fluidSubsystem needs a Fluid or a FluidCoupling.');
  let over=false,unconverged=fluid.stats.unconverged,warned=false;
  return {
    id:options.id??'fluid',kind:coupling?'fluid-coupling':'fluid',stage:coupling?'couple':'post',order:options.order??(coupling?FLUID_SUBSYSTEM_ORDER:510),
    timeStep:{dt:coupling?coupling.dt:fluid.dt,rule:coupling?'equal':'commensurate'},
    validate(){fluid.checkTimeStep();},
    step(ctx){if(coupling)coupling.step();else fluid.step(ctx.substeps);},
    finish(ctx){
      const now=fluid.stats.cfl>fluid.cflLimit;
      if(now&&!over)ctx.emit('cfl-exceeded',{cfl:fluid.stats.cfl,limit:fluid.cflLimit});
      over=now;
      if(fluid.stats.unconverged!==unconverged){ctx.emit('unconverged',{iterations:fluid.stats.pressureIterations,divergence:fluid.stats.divergence});unconverged=fluid.stats.unconverged;}
      if(fluid.stats.unstable&&!warned){warned=true;ctx.emit('unstable-step',{dt:fluid.dt,limits:fluid.maxTimeStep()});}
    },
    energy(){
      const kinetic=fluid.kineticEnergy();
      return {domain:'mechanical',total:kinetic,exchanged:fluid.workByBodies+fluid.workByBoundaries+fluid.workByForces,
        parts:{kinetic,dissipated:fluid.dissipated,workByBodies:fluid.workByBodies,workByBoundaries:fluid.workByBoundaries,workByForces:fluid.workByForces}};
    },
    diagnostics(){return {solver:fluid.solver,backend:coupling?coupling.backend:null,cells:fluid.cells,time:fluid.time,dt:fluid.dt,substeps:coupling?coupling.substeps:1,obstacles:fluid.obstacleCount,...fluid.stats};},
  };
}

/** Where a free-surface tank runs in the post stage of a Simulation: after a bare Fluid (510). */
export const FREE_SURFACE_SUBSYSTEM_ORDER=520;

/**
 * A free-surface tank as a subsystem of the one stepping loop (simulation.ts). Post stage (it does not act on the rigid
 * world); its dt may be the step, a whole fraction of it or a whole multiple. Energy: kinetic plus gravitational
 * potential energy of the particles (zero at the origin); nothing is exchanged with the outside, so the balance falls by
 * what the transfers and the walls dissipate. Events: 'cfl-exceeded' {cfl} when the Courant number first rises above the
 * limit, 'unconverged' {iterations} when a projection stopped at maxIterations.
 */
export function freeSurfaceSubsystem<W,B>(fluid:FreeSurfaceFluid,options:{readonly id?:string;readonly order?:number}={}):Subsystem<W,B> {
  if(!(fluid instanceof FreeSurfaceFluid))throw new TypeError('freeSurfaceSubsystem needs a FreeSurfaceFluid.');
  let over=false,unconverged=fluid.stats.unconverged;
  return {
    id:options.id??'free-surface',kind:'free-surface',stage:'post',order:options.order??FREE_SURFACE_SUBSYSTEM_ORDER,
    timeStep:{dt:fluid.dt,rule:'commensurate'},
    step(ctx){fluid.step(ctx.substeps);},
    finish(ctx){
      const now=fluid.stats.cfl>fluid.cflLimit;
      if(now&&!over)ctx.emit('cfl-exceeded',{cfl:fluid.stats.cfl,limit:fluid.cflLimit});
      over=now;
      if(fluid.stats.unconverged!==unconverged){ctx.emit('unconverged',{iterations:fluid.stats.pressureIterations,divergence:fluid.stats.divergence});unconverged=fluid.stats.unconverged;}
    },
    energy(){const kinetic=fluid.kineticEnergy(),potential=fluid.potentialEnergy();return {domain:'mechanical',total:kinetic+potential,exchanged:0,parts:{kinetic,potential}};},
    diagnostics(){return {solver:fluid.solver,cells:fluid.nx*fluid.ny*fluid.nz,particles:fluid.count,time:fluid.time,dt:fluid.dt,...fluid.stats};},
  };
}
