/**
 * Shallow water on terrain: the 2D Saint-Venant equations by a finite-volume scheme, in SI units, float64.
 *
 *   h_t + (hu)_x + (hv)_z = R - I
 *   (hu)_t + (hu^2 + g h^2 / 2)_x + (huv)_z = -g h b_x - g n^2 u |u| / h^(1/3)
 *   (hv)_t + (huv)_x + (hv^2 + g h^2 / 2)_z = -g h b_z - g n^2 v |u| / h^(1/3)
 *
 * h depth (m), (u, v) depth-averaged velocity along world x and z (m/s), b bed elevation (m, world y up), n Manning's
 * coefficient (s/m^(1/3)), R rain (m/s), I infiltration (m/s, Green-Ampt).
 *
 * Scheme (docs/SHALLOW_WATER.md):
 *  - Hydrostatic reconstruction (Audusse, Bouchut, Bristeau, Klein, Perthame, SIAM J. Sci. Comput. 25 (2004) 2050, as
 *    restated by Chen and Noelle, IGPM report 440, eqs. 2.5-2.8): at a face, b* = max(b_L, b_R), h*_L,R = max(0, eta_L,R - b*),
 *    the flux is computed from the starred states and each side gets the pressure correction g/2 (h^2 - h*^2). A lake at
 *    rest stays at rest to round-off, and depths stay non-negative under the CFL condition.
 *  - Second order: MUSCL reconstruction of h, eta = h + b, u and v with the minmod limiter, the bed at a face taken as
 *    eta - h of the reconstructed values, and the centred bed term g h (dh - deta) per cell that keeps the scheme
 *    well-balanced (Audusse et al. 2004, sec. 3; written from that paper's form as quoted, the paper itself was not opened);
 *    Heun's method (SSP-RK2) in time.
 *  - The flux: HLL for depth and normal momentum with Einfeldt-type wave speeds (2 sqrt(g h) for a dry side), and the
 *    transverse momentum carried upwind of the mass flux (the contact wave of HLLC).
 *  - Sources split after each step: rain, Green-Ampt infiltration (exact ponded integral over the step), and Manning
 *    friction by backward Euler on |q|, q (1 + dt g n^2 |q| / h^(7/3)) = q*, which never reverses the flow, is stable
 *    for any step and whose steady state is the normal depth exactly.
 *  - Time step: substeps of equal length inside each `step(dt)`, each at most `cfl / (max |s_x| / dx + max |s_z| / dz)`
 *    from the wave speeds of the faces. Deterministic: the same inputs give the same bits.
 *
 * Boundaries per side: wall, open (transmissive), inflow of a discharge (Riemann invariant, optionally with the depth for
 * a supercritical inflow), or a stage (water level, switching to transmissive while the flow leaves supercritically).
 *
 * `ShallowWaterCoupling` couples rigid bodies (boxes and spheres) both ways, after water-coupling.ts: buoyancy from the
 * exact volume below the local water plane, a drag model on the velocity relative to the water, the reaction of the
 * horizontal force as a momentum source and the displaced volume as a volume source. `shallowWaterSubsystem` plugs either
 * into simulation.ts. Self-contained apart from contracts.ts, checkpoint.ts and the Subsystem type.
 */
import {EngineError} from './contracts.ts';
import {captureFields,checkpointError,eachElement,holder,restoreFields,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';
import type {Subsystem} from './simulation.ts';

export const SHALLOW_WATER_SOLVER_ID='shallow-water-hr-muscl-hll-js-f64-v1';
export const SHALLOW_WATER_COUPLING_BACKEND='rigid-shallow-water-coupling-js-f64-v1';
/** Standard gravity used when none is given, m/s^2. */
export const SHALLOW_WATER_GRAVITY=9.81;

const fail=(message:string):never=>{throw new EngineError('INVALID_ARGUMENT',message);};
function num(value:unknown,what:string,min:number,max:number):number {
  if(typeof value!=='number'||!Number.isFinite(value)||value<min||value>max)fail(`${what} must be a number in [${min}, ${max}] (got ${String(value)}).`);
  return value as number;
}

/** A side of the domain. */
export type ShallowWaterSide=
  |'wall'
  /** Transmissive: the outside equals the inside. */
  |'open'
  /** A discharge into the domain, m^3/s, spread uniformly by width over the side, or over the part of it whose cell
   *  centres lie in `span` (world z for an x side, world x for a z side, m; the rest of the side is a wall). With `depth`
   *  (m) the inflow is supercritical and both are imposed; without it the depth outside follows the outgoing Riemann invariant. */
  |{readonly type:'inflow';readonly discharge:number;readonly depth?:number;readonly span?:readonly [number,number]}
  /** A water level (world y, m) outside: subcritical outflow or inflow; transmissive while the flow leaves supercritically. */
  |{readonly type:'stage';readonly level:number};
export interface ShallowWaterBoundaries {readonly xMin?:ShallowWaterSide;readonly xMax?:ShallowWaterSide;readonly zMin?:ShallowWaterSide;readonly zMax?:ShallowWaterSide}

/** Green-Ampt infiltration parameters (Rawls, Brakensiek and Miller 1983, eqs. 1 and 2). SI units. */
export interface GreenAmptSoil {
  /** Hydraulic conductivity K, m/s (Rawls et al. tabulate K in cm/h; it is half the saturated conductivity). */
  readonly conductivity:number;
  /** Wetting-front capillary pressure head psi, m. */
  readonly suction:number;
  /** Available porosity eta = effective porosity minus the initial water content, 1. */
  readonly moistureDeficit:number;
}

export interface ShallowWaterOptions {
  /** Cells along x and z. A 1D problem has one cell along z. */
  readonly cells:readonly [number,number];
  /** Cell size along x and z, m. A number for square cells. */
  readonly spacing:number|readonly [number,number];
  /** World x and z of the minimum corner, m. Default [0, 0]. */
  readonly origin?:readonly [number,number];
  /** Bed elevation at cell centres (world y, m): a function of the centre's world x and z, or nx*nz values (x fastest). Default 0. */
  readonly bed?:ArrayLike<number>|((x:number,z:number)=>number);
  /** Initial depth: a function of x, z (and the bed there), or nx*nz values. Default dry. */
  readonly depth?:ArrayLike<number>|((x:number,z:number,bed:number)=>number);
  /** Initial water level (world y): depth = max(0, level - bed). Ignored when `depth` is given. */
  readonly level?:number|((x:number,z:number)=>number);
  /** Initial velocity [u, v], m/s, everywhere, or a function of x, z. Default at rest. */
  readonly velocity?:readonly [number,number]|((x:number,z:number)=>readonly [number,number]);
  /** Manning's n, s/m^(1/3): one value or nx*nz values. Default 0 (no friction). */
  readonly manning?:number|ArrayLike<number>;
  /** Kinematic viscosity of the liquid, m^2/s, for the laminar film friction 3 nu q / h^2 (Poiseuille film; zero for
   *  water is the usual choice at depths where Manning applies). Default 0. */
  readonly viscosity?:number;
  /** Infiltration: one soil, or a soil per cell (null for a sealed cell). Default none. */
  readonly soil?:GreenAmptSoil|readonly (GreenAmptSoil|null)[];
  /** Rain, m/s: a constant or a function of time (uniform over the domain). Default 0. */
  readonly rain?:number|((time:number)=>number);
  /** Cells that are solid (1): their faces are walls. nx*nz values. Default none. */
  readonly solid?:ArrayLike<number>;
  readonly boundaries?:ShallowWaterBoundaries;
  /** Gravity, m/s^2 (positive, along -y). Default 9.81. */
  readonly gravity?:number;
  /** Density of the water, kg/m^3, for forces and energies. Default 1000. */
  readonly density?:number;
  /** The step `step()` advances by, s. Default 0.01. Substeps keep each inside the CFL limit. */
  readonly dt?:number;
  /** Courant number of the substeps: dt (max|s_x|/dx + max|s_z|/dz) <= cfl. Default 0.45 (positivity needs 0.5). */
  readonly cfl?:number;
  /** 2 (MUSCL, default) or 1 (first order). */
  readonly order?:1|2;
  /** Below this depth a cell's velocity is taken as zero, m. Default 1e-8. */
  readonly dryDepth?:number;
  /** Most substeps one `step()` may take before it is refused with UNSTABLE_TIME_STEP. Default 100000. */
  readonly maxSubsteps?:number;
}

/** What a step did, for diagnostics and events. */
export interface ShallowWaterStats {
  substeps:number;totalSubsteps:number;
  /** Courant number of the last substep against `cfl` (equal to it when the limit set the substep). */
  courant:number;
  /** Largest wave speed seen in the last substep, m/s. */
  maxWaveSpeed:number;
  /** Wet cells (depth above dryDepth) after the last step. */
  wetCells:number;
}

/** Signed volume budget since construction, m^3. volume() - initialVolume = inflow + rain - infiltrated + clipped, to round-off. */
export interface ShallowWaterLedger {
  /** Net volume that entered through the sides (negative: left). */
  inflow:number;rain:number;infiltrated:number;
  /** Net volume added by point sources and taken by sinks (`addVolume`, `removeVolume`). */
  sources:number;
  /** Volume added by setting round-off negative depths to zero (0 in every validated case). */
  clipped:number;
  /** Volume added (+) or removed (-) by coupled bodies as they enter or leave the water. */
  displaced:number;
}

interface SideState {kind:0|1|2|3;discharge:number;depth:number;level:number;lo:number;hi:number;width:number}
const SIDES=['xMin','xMax','zMin','zMax'] as const;
function side(value:ShallowWaterSide|undefined,label:string):SideState {
  const none={discharge:0,depth:0,level:0,lo:-Infinity,hi:Infinity,width:0};
  if(value===undefined||value==='wall')return {kind:0,...none};
  if(value==='open')return {kind:1,...none};
  if(typeof value==='object'&&value&&value.type==='inflow'){
    const discharge=num(value.discharge,`${label}: inflow discharge`,0,1e9);
    const depth=value.depth===undefined?0:num(value.depth,`${label}: inflow depth`,1e-9,1e6);
    let lo=-Infinity,hi=Infinity;
    if(value.span!==undefined){if(!Array.isArray(value.span)||value.span.length!==2)fail(`${label}: inflow span must be [from, to].`);lo=num(value.span[0],`${label}: span[0]`,-1e9,1e9);hi=num(value.span[1],`${label}: span[1]`,lo,1e9);}
    return {kind:2,discharge,depth,level:0,lo,hi,width:0};
  }
  if(typeof value==='object'&&value&&value.type==='stage')return {kind:3,...none,level:num(value.level,`${label}: stage level`,-1e6,1e6)};
  return fail(`${label} must be 'wall', 'open', {type: 'inflow', discharge} or {type: 'stage', level}.`);
}

const minmod=(a:number,b:number):number=>a*b<=0?0:a>0?(a<b?a:b):(a>b?a:b);

/** The fields of a ShallowWater that a checkpoint holds: everything but its constants. */
const SHALLOW_WATER_FIELDS:FieldOptions={label:'ShallowWater',nested:{sides:eachElement({label:'ShallowWater side'})}};

export class ShallowWater {
  readonly solver=SHALLOW_WATER_SOLVER_ID;
  readonly nx:number;readonly nz:number;readonly dx:number;readonly dz:number;readonly origin:readonly [number,number];
  readonly gravity:number;readonly density:number;readonly cfl:number;readonly order:1|2;readonly dryDepth:number;readonly maxSubsteps:number;
  /** Bed elevation at cell centres, m. Live; call `bedChanged()` after writing it. */
  readonly bed:Float64Array;
  /** Depth (m) and discharges per unit width hu, hv (m^2/s) at cell centres, x fastest. Live views. */
  readonly h:Float64Array;readonly qx:Float64Array;readonly qz:Float64Array;
  /** Manning's n per cell, s/m^(1/3). Live. */
  readonly manning:Float64Array;
  /** Cumulative infiltrated depth per cell, m (0 where sealed). */
  readonly infiltrated:Float64Array;
  /** Green-Ampt K (m/s) and psi * eta (m) per cell; K = 0 where sealed. Live. */
  readonly soilK:Float64Array;readonly soilS:Float64Array;
  /** 1 where a cell is solid. */
  readonly solid:Uint8Array;
  readonly ledger:ShallowWaterLedger={inflow:0,rain:0,infiltrated:0,sources:0,clipped:0,displaced:0};
  /** Kinematic viscosity for the laminar film friction, m^2/s. */
  readonly viscosity:number;
  /** Horizontal velocity [u, v] the rain arrives with, m/s: its momentum R u per area enters with it. Default at rest. */
  readonly rainVelocity=new Float64Array(2);
  readonly stats:ShallowWaterStats={substeps:0,totalSubsteps:0,courant:0,maxWaveSpeed:0,wetCells:0};
  /** Volume at construction, m^3. */
  readonly initialVolume:number;
  dt:number;time=0;steps=0;
  private rainRate:number|((time:number)=>number);
  private readonly sides:SideState[];
  private readonly hasSoil:boolean;private readonly hasSolid:boolean;private readonly hasManning:boolean;
  // Work arrays (state of the RK stage and the residual); they hold nothing between steps but are kept for exact restores.
  private readonly h0:Float64Array;private readonly qx0:Float64Array;private readonly qz0:Float64Array;
  private readonly rh:Float64Array;private readonly rx:Float64Array;private readonly rz:Float64Array;
  private readonly u:Float64Array;private readonly v:Float64Array;
  private readonly sh:Float64Array;private readonly se:Float64Array;private readonly su:Float64Array;private readonly sv:Float64Array;
  private rateX=0;private rateZ=0;private boundaryFlux=0;
  /** Length of the last substep, s (the leading half of the friction uses it). */
  private lastSub=0;
  /** Momentum (N s) handed to the water from outside since the last `takeMomentum` (couplings write here). */
  readonly sourceMomentum=new Float64Array(2);

  constructor(options:ShallowWaterOptions) {
    if(!options||typeof options!=='object')fail('ShallowWater needs options.');
    const cells=options.cells;
    if(!Array.isArray(cells)||cells.length!==2)fail('cells must be [nx, nz].');
    const nx=num(cells[0],'cells[0]',1,1<<15),nz=num(cells[1],'cells[1]',1,1<<15);
    if(!Number.isInteger(nx)||!Number.isInteger(nz))fail('cells must be whole numbers.');
    if(nx*nz>1<<24)fail('At most 16 777 216 cells.');
    const spacing=options.spacing;
    const dx=num(typeof spacing==='number'?spacing:spacing?.[0],'spacing (x)',1e-6,1e6),dz=num(typeof spacing==='number'?spacing:spacing?.[1],'spacing (z)',1e-6,1e6);
    const origin=options.origin??[0,0];
    this.nx=nx;this.nz=nz;this.dx=dx;this.dz=dz;this.origin=Object.freeze([num(origin[0],'origin[0]',-1e9,1e9),num(origin[1],'origin[1]',-1e9,1e9)]) as readonly [number,number];
    this.gravity=num(options.gravity??SHALLOW_WATER_GRAVITY,'gravity',1e-6,1e3);
    this.density=num(options.density??1000,'density',1e-6,1e6);
    this.cfl=num(options.cfl??0.45,'cfl',1e-6,1);
    this.order=options.order===1?1:options.order===undefined||options.order===2?2:fail('order must be 1 or 2.');
    this.dryDepth=num(options.dryDepth??1e-8,'dryDepth',0,1);
    this.maxSubsteps=num(options.maxSubsteps??100000,'maxSubsteps',1,1e9);
    this.dt=num(options.dt??0.01,'dt',1e-9,1e4);
    const n=nx*nz,cx=(i:number)=>this.origin[0]+(i+.5)*dx,cz=(k:number)=>this.origin[1]+(k+.5)*dz;
    const field=(value:unknown,what:string):ArrayLike<number>|null=>{
      if(value===undefined||typeof value==='function'||typeof value==='number')return null;
      const a=value as ArrayLike<number>;if(!a||a.length!==n)fail(`${what} must have nx*nz = ${n} values.`);return a;
    };
    this.bed=new Float64Array(n);
    {const b=options.bed,arr=field(b,'bed');for(let k=0,c=0;k<nz;k++)for(let i=0;i<nx;i++,c++){const value=arr?arr[c]:typeof b==='function'?b(cx(i),cz(k)):0;this.bed[c]=num(value,'bed',-1e6,1e6);}}
    this.h=new Float64Array(n);this.qx=new Float64Array(n);this.qz=new Float64Array(n);
    {
      const d=options.depth,arr=field(d,'depth'),level=options.level;
      for(let k=0,c=0;k<nz;k++)for(let i=0;i<nx;i++,c++){
        const x=cx(i),z=cz(k);let depth=0;
        if(arr)depth=arr[c];else if(typeof d==='function')depth=d(x,z,this.bed[c]);
        else if(level!==undefined)depth=Math.max(0,(typeof level==='function'?level(x,z):level)-this.bed[c]);
        this.h[c]=num(depth,'depth',0,1e6);
        const vel=options.velocity,uv=typeof vel==='function'?vel(x,z):vel;
        if(uv){this.qx[c]=this.h[c]*num(uv[0],'velocity',-1e4,1e4);this.qz[c]=this.h[c]*num(uv[1],'velocity',-1e4,1e4);}
      }
    }
    this.manning=new Float64Array(n);
    {const m=options.manning;if(typeof m==='number')this.manning.fill(num(m,'manning',0,10));else if(m!==undefined){const arr=field(m,'manning')!;for(let c=0;c<n;c++)this.manning[c]=num(arr[c],'manning',0,10);}}
    this.viscosity=num(options.viscosity??0,'viscosity',0,10);
    this.hasManning=this.manning.some(x=>x>0)||this.viscosity>0;
    this.soilK=new Float64Array(n);this.soilS=new Float64Array(n);this.infiltrated=new Float64Array(n);
    {
      const s=options.soil,one=(soil:GreenAmptSoil|null,c:number)=>{
        if(soil===null)return;
        if(!soil||typeof soil!=='object')fail('soil must be {conductivity, suction, moistureDeficit}.');
        this.soilK[c]=num(soil.conductivity,'soil.conductivity',0,1);
        this.soilS[c]=num(soil.suction,'soil.suction',0,100)*num(soil.moistureDeficit,'soil.moistureDeficit',0,1);
      };
      if(Array.isArray(s)){if(s.length!==n)fail(`soil must be one soil or nx*nz = ${n} entries.`);for(let c=0;c<n;c++)one(s[c],c);}
      else if(s!==undefined)for(let c=0;c<n;c++)one(s as GreenAmptSoil,c);
    }
    this.hasSoil=this.soilK.some(x=>x>0);
    this.solid=new Uint8Array(n);
    {const arr=field(options.solid,'solid');if(arr)for(let c=0;c<n;c++){this.solid[c]=arr[c]?1:0;if(this.solid[c]){this.h[c]=0;this.qx[c]=0;this.qz[c]=0;}}}
    this.hasSolid=this.solid.some(x=>x!==0);
    const rain=options.rain??0;
    if(typeof rain==='number')num(rain,'rain',0,1);else if(typeof rain!=='function')fail('rain must be a number (m/s) or a function of time.');
    this.rainRate=rain;
    const b=options.boundaries??{};
    for(const key of Object.keys(b))if(!(SIDES as readonly string[]).includes(key))fail(`Unknown side "${key}": use xMin, xMax, zMin, zMax.`);
    this.sides=SIDES.map(key=>side(b[key],key));
    this.sides.forEach((state,index)=>this.spanWidth(state,index));
    this.h0=new Float64Array(n);this.qx0=new Float64Array(n);this.qz0=new Float64Array(n);
    this.rh=new Float64Array(n);this.rx=new Float64Array(n);this.rz=new Float64Array(n);
    this.u=new Float64Array(n);this.v=new Float64Array(n);
    this.sh=new Float64Array(n);this.se=new Float64Array(n);this.su=new Float64Array(n);this.sv=new Float64Array(n);
    this.initialVolume=this.volume();
    this.countWet();
  }

  /** Everything a later step reads, as a state tree (checkpoint.ts). */
  saveState():StateObject {return captureFields(this,SHALLOW_WATER_FIELDS);}
  /** Put back a state from `saveState()` of a ShallowWater built with the same options. */
  restoreState(state:StateValue):void {restoreFields(this,state,SHALLOW_WATER_FIELDS);}

  get cells():number {return this.nx*this.nz;}
  /** Rain now, m/s. */
  rainAt(time=this.time):number {const r=this.rainRate;return typeof r==='number'?r:Math.max(0,Number(r(time))||0);}
  /** Set the rain: a constant (m/s) or a function of time. */
  setRain(rain:number|((time:number)=>number)):void {if(typeof rain==='number')num(rain,'rain',0,1);else if(typeof rain!=='function')fail('rain must be a number or a function.');this.rainRate=rain;}
  /** Change a side's condition (for example an inflow that varies in time). */
  setBoundary(key:keyof ShallowWaterBoundaries,value:ShallowWaterSide):void {const index=SIDES.indexOf(key);if(index<0)fail(`Unknown side "${String(key)}".`);const state=side(value,key);this.spanWidth(state,index);this.sides[index]=state;}
  /** The width over which an inflow side spreads its discharge: the cells of the side whose centres lie in its span. */
  private spanWidth(state:SideState,index:number):void {
    if(state.kind!==2)return;
    const alongZ=index<2,count=alongZ?this.nz:this.nx,size=alongZ?this.dz:this.dx,o=alongZ?this.origin[1]:this.origin[0];
    let cells=0;for(let j=0;j<count;j++){const t=o+(j+.5)*size;if(t>=state.lo&&t<=state.hi)cells++;}
    if(cells===0)fail(`The inflow span [${state.lo}, ${state.hi}] holds no cell centre of its side.`);
    state.width=cells*size;
  }
  setTimeStep(dt:number):void {this.dt=num(dt,'dt',1e-9,1e4);}

  /** Water volume over the domain, m^3. */
  volume():number {let s=0;const h=this.h;for(let c=0;c<h.length;c++)s+=h[c];return s*this.dx*this.dz;}
  /** volume() - initialVolume - (inflow + rain - infiltrated + sources + clipped + displaced): zero to round-off. */
  volumeError():number {const L=this.ledger;return this.volume()-this.initialVolume-(L.inflow+L.rain-L.infiltrated+L.sources+L.clipped+L.displaced);}
  /** Add `volume` m^3 of water to a cell (a pipe outlet, a spring), arriving with velocity [u, v] m/s. Booked in ledger.sources. */
  addVolume(c:number,volume:number,u=0,v=0):void {
    if(!(volume>0)||this.solid[c])return;
    const dh=volume/(this.dx*this.dz);this.h[c]+=dh;this.qx[c]+=dh*u;this.qz[c]+=dh*v;this.ledger.sources+=volume;
  }
  /** Take up to `volume` m^3 out of a cell (a drain); the velocity of what is left is kept. Returns the volume taken. */
  removeVolume(c:number,volume:number):number {
    const d=this.h[c],area=this.dx*this.dz;if(!(volume>0)||!(d>0))return 0;
    const take=Math.min(d,volume/area),left=d-take,r=d>0?left/d:0;
    this.h[c]=left;this.qx[c]*=r;this.qz[c]*=r;if(left<=this.dryDepth){this.qx[c]=0;this.qz[c]=0;}
    this.ledger.sources-=take*area;return take*area;
  }
  /** Index of the cell holding world (x, z), clamped to the grid. */
  cellAt(x:number,z:number):number {
    let i=Math.floor((x-this.origin[0])/this.dx),k=Math.floor((z-this.origin[1])/this.dz);
    if(i<0)i=0;else if(i>=this.nx)i=this.nx-1;if(k<0)k=0;else if(k>=this.nz)k=this.nz-1;return i+this.nx*k;
  }
  /** Water level h + b at a cell (the bed where dry), m. */
  level(c:number):number {return this.h[c]+this.bed[c];}
  /** Velocity [u, v] at a cell, m/s (zero where dry). */
  velocity(c:number):[number,number] {const h=this.h[c];return h>this.dryDepth?[this.qx[c]/h,this.qz[c]/h]:[0,0];}
  /** Froude number |u| / sqrt(g h) at a cell (0 where dry). */
  froude(c:number):number {const h=this.h[c];return h>this.dryDepth?Math.hypot(this.qx[c],this.qz[c])/h/Math.sqrt(this.gravity*h):0;}
  /** Bilinear water level between cell centres at world (x, z); dry cells read their bed. */
  levelAt(x:number,z:number):number {return this.bilinear(x,z,0);}
  /** Bilinear depth at world (x, z). */
  depthAt(x:number,z:number):number {return this.bilinear(x,z,1);}
  private bilinear(x:number,z:number,what:0|1):number {
    const nx=this.nx,nz=this.nz;
    let fx=(x-this.origin[0])/this.dx-.5,fz=(z-this.origin[1])/this.dz-.5;
    let i=Math.floor(fx),k=Math.floor(fz);
    if(i<0)i=0;else if(i>nx-2)i=Math.max(0,nx-2);if(k<0)k=0;else if(k>nz-2)k=Math.max(0,nz-2);
    fx-=i;fz-=k;fx=fx<0?0:fx>1?1:fx;fz=fz<0?0:fz>1?1:fz;
    const i1=Math.min(i+1,nx-1),k1=Math.min(k+1,nz-1);
    const at=(a:number,b:number)=>{const c=a+nx*b;return what===0?this.h[c]+this.bed[c]:this.h[c];};
    return (at(i,k)*(1-fx)+at(i1,k)*fx)*(1-fz)+(at(i,k1)*(1-fx)+at(i1,k1)*fx)*fz;
  }
  /** Discharge through the vertical line x = const (between cell columns), m^3/s, from cell-centred hu averaged across it. */
  dischargeX(x:number):number {
    const f=(x-this.origin[0])/this.dx-.5,i=Math.max(0,Math.min(this.nx-1,Math.floor(f))),i1=Math.min(this.nx-1,i+1),t=Math.max(0,Math.min(1,f-i));
    let s=0;for(let k=0;k<this.nz;k++){const a=i+this.nx*k,b=i1+this.nx*k;s+=(1-t)*this.qx[a]+t*this.qx[b];}return s*this.dz;
  }
  /** Kinetic energy rho/2 sum (hu^2 + hv^2)/h dA, J. */
  kineticEnergy():number {let s=0;const h=this.h,dry=this.dryDepth;for(let c=0;c<h.length;c++)if(h[c]>dry)s+=(this.qx[c]*this.qx[c]+this.qz[c]*this.qz[c])/h[c];return .5*this.density*s*this.dx*this.dz;}
  /** Potential energy rho g sum (h^2/2 + h b) dA, J (zero for no water). */
  potentialEnergy():number {let s=0;const h=this.h;for(let c=0;c<h.length;c++)s+=h[c]*(.5*h[c]+this.bed[c]);return this.density*this.gravity*s*this.dx*this.dz;}
  /** Largest depth, m, and largest speed of a cell deeper than `minimum`, m/s. */
  maxDepth():number {let m=0;for(const d of this.h)if(d>m)m=d;return m;}
  maxSpeed(minimum=this.dryDepth):number {let m=0;for(let c=0;c<this.h.length;c++){const h=this.h[c];if(h>minimum){const s=Math.hypot(this.qx[c],this.qz[c])/h;if(s>m)m=s;}}return m;}
  /** Momentum rho sum (hu, hv) dA, N s. */
  momentum():[number,number] {let a=0,b=0;for(let c=0;c<this.h.length;c++){a+=this.qx[c];b+=this.qz[c];}const k=this.density*this.dx*this.dz;return [a*k,b*k];}
  /** Stable substep at the current state from the cells' wave speeds (|u| + sqrt(g h)), s. Boundary inflows not included. */
  stableTimeStep():number {
    let ax=0,az=0;const g=this.gravity,dry=this.dryDepth;
    for(let c=0;c<this.h.length;c++){const h=this.h[c];if(h<=dry)continue;const a=Math.sqrt(g*h),u=Math.abs(this.qx[c]/h)+a,w=Math.abs(this.qz[c]/h)+a;if(u>ax)ax=u;if(w>az)az=w;}
    const rate=ax/this.dx+(this.nz>1?az/this.dz:0);return rate>0?this.cfl/rate:Infinity;
  }
  /** Call after writing `bed`, `solid` or `manning`. */
  bedChanged():void {for(let c=0;c<this.h.length;c++)if(this.solid[c]){this.h[c]=0;this.qx[c]=0;this.qz[c]=0;}(this as unknown as {hasManning:boolean}).hasManning=this.manning.some(x=>x>0);}

  /** Advance by `count` steps of dt, each in CFL-limited substeps of equal length. */
  step(count=1):void {for(let s=0;s<count;s++)this.advance(this.dt);}
  /** Advance by an arbitrary time, s (in CFL-limited substeps). */
  advance(duration:number):void {
    num(duration,'duration',0,1e9);
    let left=duration,taken=0;
    while(left>0){
      // Strang splitting of the friction: half a substep of friction before the transport and half after. The leading half
      // uses the length of the previous substep (equal in a steady run), so the wave speeds are read only once.
      if(this.hasManning&&this.lastSub>0)this.friction(.5*this.lastSub);
      this.residual(this.h,this.qx,this.qz);
      const rate=this.rateX/this.dx+(this.nz>1?this.rateZ/this.dz:0);
      const limit=rate>0?this.cfl/rate:Infinity;
      const n=limit>=left?1:Math.ceil(left/limit-1e-12);
      const sub=left/n;
      if(taken+n>this.maxSubsteps)throw new EngineError('UNSTABLE_TIME_STEP',`ShallowWater: one step of ${duration} s needs more than ${this.maxSubsteps} substeps at Courant number ${this.cfl} (largest wave speed ${Math.max(this.rateX,this.rateZ).toPrecision(4)} m/s). Raise maxSubsteps or take smaller steps.`);
      this.stats.courant=sub*rate;this.stats.maxWaveSpeed=Math.max(this.rateX,this.rateZ);
      // The very first substep: its leading half needs its own length.
      if(this.hasManning&&!(this.lastSub>0)){this.friction(.5*sub);this.residual(this.h,this.qx,this.qz);}
      this.substep(sub);this.lastSub=sub;
      taken++;left-=sub;if(n===1)left=0;
    }
    this.stats.substeps=taken;this.stats.totalSubsteps+=taken;this.steps++;
    this.countWet();
  }
  private countWet():void {let w=0;for(let c=0;c<this.h.length;c++)if(this.h[c]>this.dryDepth)w++;this.stats.wetCells=w;}

  /** One Heun (SSP-RK2) substep; the residual of the current state is already in rh, rx, rz. */
  private substep(dt:number):void {
    const h=this.h,qx=this.qx,qz=this.qz,h0=this.h0,qx0=this.qx0,qz0=this.qz0,rh=this.rh,rx=this.rx,rz=this.rz,n=h.length;
    const area=this.dx*this.dz;
    h0.set(h);qx0.set(qx);qz0.set(qz);
    let inflow=this.boundaryFlux*dt;
    for(let c=0;c<n;c++){h[c]+=dt*rh[c];qx[c]+=dt*rx[c];qz[c]+=dt*rz[c];}
    this.clip();
    if(this.order===2){
      this.residual(h,qx,qz);
      inflow=.5*inflow+.5*this.boundaryFlux*dt;
      for(let c=0;c<n;c++){h[c]=.5*(h0[c]+h[c]+dt*rh[c]);qx[c]=.5*(qx0[c]+qx[c]+dt*rx[c]);qz[c]=.5*(qz0[c]+qz[c]+dt*rz[c]);}
      this.clip();
    }
    this.ledger.inflow+=inflow;
    this.sources(dt,area);
    this.time+=dt;
  }
  private clip():void {
    const h=this.h,dry=this.dryDepth;let added=0;
    for(let c=0;c<h.length;c++){
      const d=h[c];
      if(d<=dry){if(d<0){added-=d;h[c]=0;}this.qx[c]=0;this.qz[c]=0;}
    }
    if(added)this.ledger.clipped+=added*this.dx*this.dz;
  }

  /** Rain, infiltration and friction over dt, split after the transport step. */
  private sources(dt:number,area:number):void {
    const h=this.h,qx=this.qx,qz=this.qz,n=h.length,g=this.gravity,dry=this.dryDepth;
    const rain=this.rainAt(this.time+.5*dt)*dt;
    if(rain>0){
      const ru=rain*this.rainVelocity[0],rv=rain*this.rainVelocity[1];let wet=0;
      for(let c=0;c<n;c++)if(!this.solid[c]){h[c]+=rain;qx[c]+=ru;qz[c]+=rv;wet++;}
      this.ledger.rain+=rain*wet*area;
    }
    if(this.hasSoil){
      const K=this.soilK,S=this.soilS,F=this.infiltrated;let total=0;
      for(let c=0;c<n;c++){
        const k=K[c],d=h[c];if(!(k>0)||!(d>0))continue;
        const taken=greenAmptStep(F[c],d,k,S[c],dt);
        if(taken<=0)continue;
        const left=d-taken;
        if(left>dry){const r=left/d;qx[c]*=r;qz[c]*=r;h[c]=left;}else{h[c]=left>0?left:0;qx[c]=0;qz[c]=0;}
        F[c]+=taken;total+=taken;
      }
      this.ledger.infiltrated+=total*area;
    }
    if(this.hasManning)this.friction(.5*dt);
  }
  /**
   * Bed friction over dt by backward Euler on |q|: q (1 + a + b |q|) = q*, with the turbulent (Manning) part
   * b = dt g n^2 / h^(7/3) and the laminar film part a = 3 nu dt / h^2, so |q| = 2 |q*| / (1 + a + sqrt((1 + a)^2 + 4 b |q*|)).
   * Applied for half a substep before the transport and half after (Strang).
   */
  private friction(dt:number):void {
    const h=this.h,qx=this.qx,qz=this.qz,M=this.manning,g=this.gravity,dry=this.dryDepth,laminar=3*this.viscosity*dt;
    for(let c=0;c<h.length;c++){
      const m=M[c],d=h[c];if(d<=dry||!(m>0||laminar>0))continue;
      const mag=Math.sqrt(qx[c]*qx[c]+qz[c]*qz[c]);
      if(mag===0)continue;
      const a=1+laminar/(d*d),b=dt*g*m*m/(d*d*Math.cbrt(d));
      const factor=2/(a+Math.sqrt(a*a+4*b*mag));
      qx[c]*=factor;qz[c]*=factor;
    }
  }

  /**
   * dU/dt of the state (h, qx, qz) into rh, rx, rz; the net inflow rate through the sides (m^3/s) into boundaryFlux; the
   * largest face wave speeds along x and z into rateX, rateZ.
   */
  private residual(h:Float64Array,qx:Float64Array,qz:Float64Array):void {
    const nx=this.nx,nz=this.nz,n=h.length,u=this.u,v=this.v,dry=this.dryDepth,g=this.gravity,bed=this.bed;
    const rh=this.rh,rx=this.rx,rz=this.rz,sh=this.sh,se=this.se,su=this.su,sv=this.sv,solid=this.solid,hasSolid=this.hasSolid;
    rh.fill(0);rx.fill(0);rz.fill(0);
    for(let c=0;c<n;c++){const d=h[c];if(d>dry){u[c]=qx[c]/d;v[c]=qz[c]/d;}else{u[c]=0;v[c]=0;}}
    this.boundaryFlux=0;this.rateX=0;this.rateZ=0;
    const second=this.order===2;
    const o=this.order===2?.5:0;
    // ---- x faces ----------------------------------------------------------------------------------------------------
    if(o){
      for(let k=0;k<nz;k++){
        const row=k*nx;
        for(let i=0;i<nx;i++){
          const c=row+i;
          if(i===0||i===nx-1||(hasSolid&&(solid[c]||solid[c-1]||solid[c+1]))){sh[c]=0;su[c]=0;sv[c]=0;se[c]=this.edgeSlope(c,i,nx,1,0);continue;}
          const hl=h[c-1],hc=h[c],hr=h[c+1];
          sh[c]=minmod(hc-hl,hr-hc);
          se[c]=minmod(hc+bed[c]-hl-bed[c-1],hr+bed[c+1]-hc-bed[c]);
          su[c]=minmod(u[c]-u[c-1],u[c+1]-u[c]);
          sv[c]=minmod(v[c]-v[c-1],v[c+1]-v[c]);
        }
      }
      // The centred bed term g h (dh - deta) / dx keeps the scheme well-balanced at second order.
      const k=g/this.dx;
      for(let c=0;c<n;c++){const d=h[c];if(d>0)rx[c]+=k*d*(sh[c]-se[c]);}
    }
    const kx=1/this.dx,F=this.flux;
    let rate=0;
    for(let k=0;k<nz;k++){
      const row=k*nx;
      this.boundaryFace(0,row,true,0,o);
      this.boundaryFace(0,row+nx-1,false,1,o);
      for(let i=1;i<nx;i++){
        const a=row+i-1,b=a+1;
        if(hasSolid&&(solid[a]===1||solid[b]===1)){
          if(solid[a]===1&&solid[b]===1)continue;
          if(solid[a]===1)this.boundaryFace(0,b,true,-1,o);else this.boundaryFace(0,a,false,-1,o);
          continue;
        }
        const hL=h[a]+o*sh[a],hR=h[b]-o*sh[b];
        const s=hllFace(F,hL,h[a]+bed[a]+o*se[a],hL>dry?u[a]+o*su[a]:0,hL>dry?v[a]+o*sv[a]:0,hR,h[b]+bed[b]-o*se[b],hR>dry?u[b]-o*su[b]:0,hR>dry?v[b]-o*sv[b]:0,g);
        if(s>rate)rate=s;
        rh[a]-=F[0]*kx;rx[a]-=(F[1]+F[3])*kx;rz[a]-=F[2]*kx;
        rh[b]+=F[0]*kx;rx[b]+=(F[1]+F[4])*kx;rz[b]+=F[2]*kx;
      }
    }
    if(rate>this.rateX)this.rateX=rate;
    rate=0;
    if(nz===1&&this.sides[2].kind===0&&this.sides[3].kind===0)return;
    // ---- z faces (the same with the roles of u and v exchanged) ------------------------------------------------------
    if(o){
      for(let k=0;k<nz;k++)for(let i=0;i<nx;i++){
        const c=k*nx+i;
        if(k===0||k===nz-1||(hasSolid&&(solid[c]||solid[c-nx]||solid[c+nx]))){sh[c]=0;su[c]=0;sv[c]=0;se[c]=this.edgeSlope(c,k,nz,nx,2);continue;}
        const hl=h[c-nx],hc=h[c],hr=h[c+nx];
        sh[c]=minmod(hc-hl,hr-hc);
        se[c]=minmod(hc+bed[c]-hl-bed[c-nx],hr+bed[c+nx]-hc-bed[c]);
        su[c]=minmod(u[c]-u[c-nx],u[c+nx]-u[c]);
        sv[c]=minmod(v[c]-v[c-nx],v[c+nx]-v[c]);
      }
      const k=g/this.dz;
      for(let c=0;c<n;c++){const d=h[c];if(d>0)rz[c]+=k*d*(sh[c]-se[c]);}
    }
    const kz=1/this.dz;
    for(let i=0;i<nx;i++){this.boundaryFace(1,i,true,2,o);this.boundaryFace(1,(nz-1)*nx+i,false,3,o);}
    for(let k=1;k<nz;k++){
      const row=k*nx;
      for(let i=0;i<nx;i++){
        const b=row+i,a=b-nx;
        if(hasSolid&&(solid[a]===1||solid[b]===1)){
          if(solid[a]===1&&solid[b]===1)continue;
          if(solid[a]===1)this.boundaryFace(1,b,true,-1,o);else this.boundaryFace(1,a,false,-1,o);
          continue;
        }
        // Normal velocity is v, transverse is u.
        const hL=h[a]+o*sh[a],hR=h[b]-o*sh[b];
        const s=hllFace(F,hL,h[a]+bed[a]+o*se[a],hL>dry?v[a]+o*sv[a]:0,hL>dry?u[a]+o*su[a]:0,hR,h[b]+bed[b]-o*se[b],hR>dry?v[b]-o*sv[b]:0,hR>dry?u[b]-o*su[b]:0,g);
        if(s>rate)rate=s;
        rh[a]-=F[0]*kz;rz[a]-=(F[1]+F[3])*kz;rx[a]-=F[2]*kz;
        rh[b]+=F[0]*kz;rz[b]+=(F[1]+F[4])*kz;rx[b]+=F[2]*kz;
      }
    }
    if(rate>this.rateZ)this.rateZ=rate;
  }

  /**
   * Slope of eta in a cell at an open side (index j of count along the axis, neighbour offset `step`, first side `side`):
   * minmod with a ghost cell of the same depth on the bed continued linearly, so that a uniform flow on a slope leaves
   * through an open side unchanged. Zero elsewhere (walls, inflows, stages, solid neighbours, a single cell).
   */
  private edgeSlope(c:number,j:number,count:number,step:number,side:number):number {
    if(count<2)return 0;
    const bed=this.bed,h=this.h,solid=this.solid;
    if(j===0&&this.sides[side].kind===1){const b=c+step;if(this.hasSolid&&(solid[c]||solid[b]))return 0;return minmod(bed[b]-bed[c],h[b]+bed[b]-h[c]-bed[c]);}
    if(j===count-1&&this.sides[side+1].kind===1){const a=c-step;if(this.hasSolid&&(solid[c]||solid[a]))return 0;return minmod(h[c]+bed[c]-h[a]-bed[a],bed[c]-bed[a]);}
    return 0;
  }

  /**
   * The face between interior cell `c` and the outside (a side of the domain, `sideIndex` 0-3, or a solid cell, -1).
   * `outsideBefore`: the outside lies at lower x (axis 0) or z (axis 1).
   */
  private boundaryFace(axis:0|1,c:number,outsideBefore:boolean,sideIndex:number,o:number):void {
    if(this.hasSolid&&this.solid[c]===1)return;
    const h=this.h,bed=this.bed,dry=this.dryDepth,g=this.gravity,F=this.flux;
    const normal=axis===0?this.u:this.v,trans=axis===0?this.v:this.u,sn=axis===0?this.su:this.sv,st=axis===0?this.sv:this.su;
    const sign=outsideBefore?-1:1;
    // The interior face state, in the frame where the outward normal velocity is positive.
    const hi=h[c]+sign*o*this.sh[c],ei=h[c]+bed[c]+sign*o*this.se[c];
    const ui=hi>dry?sign*(normal[c]+sign*o*sn[c]):0,vi=hi>dry?trans[c]+sign*o*st[c]:0;
    const state=sideIndex>=0?this.sides[sideIndex]:null;
    let kind=state?state.kind:0;
    // An inflow with a span is a wall outside it.
    if(kind===2){const t=axis===0?this.origin[1]+(Math.floor(c/this.nx)+.5)*this.dz:this.origin[0]+(c%this.nx+.5)*this.dx;if(t<state!.lo||t>state!.hi)kind=0;}
    const width=kind===2?state!.width:axis===0?this.dz*this.nz:this.dx*this.nx;
    const G=this.ghost(kind,state,hi,ei,ui,vi,width);

    // Face with the interior on the left in that frame, then back to world orientation.
    this.face(hi,ei,ui,vi,G[0],G[1],G[2],G[3],g,axis);
    // An inflow side delivers exactly its discharge (the ghost state sets the momentum it brings).
    if(kind===2){F[0]=-(state as SideState).discharge/width;F[2]=0;}
    const k=1/(axis===0?this.dx:this.dz),rn=axis===0?this.rx:this.rz,rt=axis===0?this.rz:this.rx;
    // In the outward frame the interior is the left cell: flux F leaves it. Mass and transverse momentum are scalars
    // carried with the normal flux; the normal-momentum flux is even under the reflection, so it keeps its sign.
    this.rh[c]-=F[0]*k;rn[c]-=sign*(F[1]+F[3])*k;rt[c]-=F[2]*k;
    if(sideIndex>=0)this.boundaryFlux-=F[0]*(axis===0?this.dz:this.dx);
  }

  private readonly ghostOut=new Float64Array(4);
  /**
   * The outside state at a side, in the frame where the interior is on the LEFT and the outward normal velocity is u.
   * Returns [h, eta, u, v]. `width` is the length of the side, m (an inflow discharge is spread over it).
   */
  private ghost(kind:number,state:SideState|null,h:number,eta:number,u:number,v:number,width:number):Float64Array {
    const o=this.ghostOut,g=this.gravity,bed=eta-h;
    o[0]=h;o[1]=eta;o[2]=u;o[3]=v;
    if(kind===0||state===null){o[2]=-u;return o;}
    if(kind===1)return o;
    if(kind===2){
      // Inflow: the outside normal velocity points into the domain (negative in this frame).
      const q=state.discharge/width;
      if(state.depth>0){o[0]=state.depth;o[1]=bed+state.depth;o[2]=-q/state.depth;o[3]=0;return o;}
      // The outgoing invariant, written with the inward velocity w = -u: w - 2c is carried out of the domain, so
      // q / hg - 2 sqrt(g hg) = w_in - 2 sqrt(g h). Solve for hg by bisection on the monotone left side.
      const w=-u,target=w-2*Math.sqrt(g*h);
      if(q<=0){o[2]=0;o[3]=0;return o;}
      let lo=1e-12,hi=Math.max(h,1e-6);
      const f=(hg:number)=>q/hg-2*Math.sqrt(g*hg)-target;
      while(f(hi)>0&&hi<1e6)hi*=2;
      for(let it=0;it<200;it++){const mid=.5*(lo+hi);if(f(mid)>0)lo=mid;else hi=mid;if(hi-lo<=1e-15*hi)break;}
      const hg=.5*(lo+hi);
      o[0]=hg;o[1]=bed+hg;o[2]=-q/hg;o[3]=0;return o;
    }
    // Stage: subcritical, the outgoing invariant u + 2c is carried out; supercritical outflow is transmissive.
    const c=Math.sqrt(g*h);
    if(h>this.dryDepth&&u>=c)return o;
    const hg=Math.max(0,state.level-bed),cg=Math.sqrt(g*hg);
    o[0]=hg;o[1]=bed+hg;o[2]=hg>0?u+2*(c-cg):0;o[3]=v;return o;
  }

  /** [mass, normal momentum, transverse momentum, left pressure correction, right pressure correction]. */
  private readonly flux=new Float64Array(5);
  /** Hydrostatic reconstruction and the HLL flux at one face, written into `flux`. axis: 0 x, 1 z (for the wave speed). */
  private face(hL:number,eL:number,uL:number,vL:number,hR:number,eR:number,uR:number,vR:number,g:number,axis:0|1):void {
    const speed=hllFace(this.flux,hL,eL,uL,vL,hR,eR,uR,vR,g);
    if(axis===0){if(speed>this.rateX)this.rateX=speed;}else if(speed>this.rateZ)this.rateZ=speed;
  }
}

/** Hydrostatic reconstruction and the HLL flux at one face into F; returns the largest wave speed (0 when both sides are dry). */
function hllFace(F:Float64Array,hL:number,eL:number,uL:number,vL:number,hR:number,eR:number,uR:number,vR:number,g:number):number {
  const bL=eL-hL,bR=eR-hR,bs=bL>bR?bL:bR;
  let hl=eL-bs,hr=eR-bs;if(hl<0)hl=0;if(hr<0)hr=0;
  F[3]=.5*g*(hL*hL-hl*hl);F[4]=.5*g*(hR*hR-hr*hr);
  if(hl<=0&&hr<=0){F[0]=0;F[1]=0;F[2]=0;return 0;}
  const cl=Math.sqrt(g*hl),cr=Math.sqrt(g*hr);
  let sL:number,sR:number;
  if(hl<=0){sL=uR-2*cr;sR=uR+cr;}
  else if(hr<=0){sL=uL-cl;sR=uL+2*cl;}
  else{sL=uL-cl<uR-cr?uL-cl:uR-cr;sR=uL+cl>uR+cr?uL+cl:uR+cr;}
  const qL=hl*uL,qR=hr*uR,fL1=qL*uL+.5*g*hl*hl,fR1=qR*uR+.5*g*hr*hr;
  let f0:number,f1:number;
  if(sL>=0){f0=qL;f1=fL1;}
  else if(sR<=0){f0=qR;f1=fR1;}
  else{const k=1/(sR-sL);f0=(sR*qL-sL*qR+sL*sR*(hr-hl))*k;f1=(sR*fL1-sL*fR1+sL*sR*(qR-qL))*k;}
  F[0]=f0;F[1]=f1;F[2]=f0*(f0>=0?vL:vR);
  return -sL>sR?-sL:sR;
}

/**
 * Depth infiltrated over dt by Green-Ampt from a cumulative depth F with `available` water on the surface (m): the
 * ponded-capacity integral F2 - F - S ln((F2 + S) / (F + S)) = K dt (Rawls et al. 1983, eq. 2, between F and F2), solved by
 * safeguarded Newton, capped by the water there is. S = psi * eta, m; K, m/s.
 */
export function greenAmptStep(F:number,available:number,K:number,S:number,dt:number):number {
  if(!(available>0)||!(K>0)||!(dt>0))return 0;
  // Infiltration over dt is at least K dt (the rate never falls below K).
  if(available<=K*dt)return available;
  if(!(S>0))return Math.min(available,K*dt);
  const g=(F2:number)=>F2-F-S*Math.log((F2+S)/(F+S))-K*dt;
  // Capacity above the water there is: all of it goes in.
  if(g(F+available)<=0)return available;
  // The root lies in (F + K dt, F + available]; g is increasing and convex, so Newton from the right end converges from above.
  let lo=F+K*dt,hi=F+available,x=hi;
  for(let it=0;it<100;it++){
    const gx=g(x);
    if(gx>0)hi=x;else lo=x;
    const dg=x/(x+S);
    let next=x-gx/(dg>0?dg:1e-300);
    if(!(next>lo&&next<hi))next=.5*(lo+hi);
    if(Math.abs(next-x)<=1e-15*(Math.abs(x)+S)){x=next;break;}
    x=next;
  }
  const taken=x-F;
  return taken<0?0:taken>available?available:taken;
}

// -------------------------------------------------------------------------------------------------------------------------
// Closed forms used by the validation (each says where it was read).
// -------------------------------------------------------------------------------------------------------------------------

/** Ritter's dry dam break on a flat frictionless bed (SWASHES, Delestre et al. 2013, sec. 4.1.2): [h, u] at x, t. */
export function ritterDamBreak(x:number,t:number,{depth,dam,gravity=SHALLOW_WATER_GRAVITY}:{depth:number;dam:number;gravity?:number}):[number,number] {
  if(t<=0)return x<=dam?[depth,0]:[0,0];
  const c=Math.sqrt(gravity*depth),xa=dam-t*c,xb=dam+2*t*c;
  if(x<=xa)return [depth,0];
  if(x>=xb)return [0,0];
  const s=c-(x-dam)/(2*t);
  return [4/(9*gravity)*s*s,2/3*((x-dam)/t+c)];
}
/** cm of Stoker's wet dam break: the root of -8 g hr cm^2 (sqrt(g hl) - cm)^2 + (cm^2 - g hr)^2 (cm^2 + g hr) = 0 between sqrt(g hr) and sqrt(g hl). */
export function stokerMiddleCelerity(left:number,right:number,gravity=SHALLOW_WATER_GRAVITY):number {
  const g=gravity,cl=Math.sqrt(g*left),f=(cm:number)=>-8*g*right*cm*cm*(cl-cm)**2+(cm*cm-g*right)**2*(cm*cm+g*right);
  let lo=Math.sqrt(g*right),hi=cl;
  // f(lo) < 0 (only the first term), f(hi) > 0.
  for(let i=0;i<200;i++){const mid=.5*(lo+hi);if(f(mid)<0)lo=mid;else hi=mid;}
  return .5*(lo+hi);
}
/** Stoker's wet dam break on a flat frictionless bed (SWASHES, sec. 4.1.1): [h, u] at x, t. */
export function stokerDamBreak(x:number,t:number,{left,right,dam,gravity=SHALLOW_WATER_GRAVITY}:{left:number;right:number;dam:number;gravity?:number}):[number,number] {
  const g=gravity;
  if(t<=0)return x<=dam?[left,0]:[right,0];
  const cl=Math.sqrt(g*left),cm=stokerMiddleCelerity(left,right,g);
  const xa=dam-t*cl,xb=dam+t*(2*cl-3*cm),xc=dam+t*(2*cm*cm*(cl-cm))/(cm*cm-g*right);
  if(x<=xa)return [left,0];
  if(x<=xb){const s=cl-(x-dam)/(2*t);return [4/(9*g)*s*s,2/3*((x-dam)/t+cl)];}
  if(x<=xc)return [cm*cm/g,2*(cl-cm)];
  return [right,0];
}
/** Thacker's radially symmetric oscillating paraboloid (SWASHES, sec. 4.2.2): the bed z(r) = -h0 (1 - r^2/a^2), measured from the centre (cx, cz). */
export const thackerBed=(x:number,z:number,{h0,a,centre}:{h0:number;a:number;centre:readonly [number,number]})=>{const r2=(x-centre[0])**2+(z-centre[1])**2;return -h0*(1-r2/(a*a));};
/** The depth of Thacker's paraboloid at (x, z, t); A = (a^2 - r0^2) / (a^2 + r0^2), omega = sqrt(8 g h0) / a. */
export function thackerDepth(x:number,z:number,t:number,{h0,a,r0,centre,gravity=SHALLOW_WATER_GRAVITY}:{h0:number;a:number;r0:number;centre:readonly [number,number];gravity?:number}):number {
  const A=(a*a-r0*r0)/(a*a+r0*r0),w=Math.sqrt(8*gravity*h0)/a,r2=(x-centre[0])**2+(z-centre[1])**2,d=1-A*Math.cos(w*t);
  const h=h0*(Math.sqrt(1-A*A)/d-1-r2/(a*a)*((1-A*A)/(d*d)-1))-thackerBed(x,z,{h0,a,centre});
  return h>0?h:0;
}
/** Thacker's angular frequency sqrt(8 g h0) / a, rad/s. */
export const thackerFrequency=(h0:number,a:number,gravity=SHALLOW_WATER_GRAVITY)=>Math.sqrt(8*gravity*h0)/a;
/** The bed of the Goutal and Maurel (1997) bump cases as given in SWASHES (sec. 3.1): 0.2 - 0.05 (x - 10)^2 on 8 < x < 12 m. */
export const bumpBed=(x:number)=>x>8&&x<12?0.2-0.05*(x-10)**2:0;
/**
 * Depth of steady 1D frictionless flow of discharge q (m^2/s) over a bed z from Bernoulli, h^3 + (z - C) h^2 + q^2 / (2g) = 0
 * with C = q^2/(2 g h_ref^2) + h_ref + z_ref (SWASHES eq. 8 and sec. 3.1.3-3.1.5). `branch` 'sub' takes the root above the
 * critical depth, 'super' the one below. Returns NaN when the energy is too low for a root.
 */
export function bernoulliDepth(z:number,q:number,energy:number,branch:'sub'|'super',gravity=SHALLOW_WATER_GRAVITY):number {
  const g=gravity,a=z-energy,b=q*q/(2*g),f=(h:number)=>h*h*h+a*h*h+b;
  // The minimum of f is at h = -2a/3 (a < 0).
  if(!(a<0))return NaN;
  const hm=-2*a/3;if(f(hm)>0)return f(hm)<1e-14?hm:NaN;
  let lo:number,hi:number;
  if(branch==='sub'){lo=hm;hi=-a;}else{lo=0;hi=hm;}
  // f(lo) and f(hi) have opposite signs on both branches.
  const flo=f(lo);
  for(let i=0;i<200;i++){const mid=.5*(lo+hi),fm=f(mid);if((fm>0)===(flo>0))lo=mid;else hi=mid;}
  return .5*(lo+hi);
}
/** Steady depth over the bump for the three SWASHES flowing cases: 'subcritical' (q 4.42, h_L 2), 'transcritical' (q 1.53),
 *  'shock' (q 0.18, h_L 0.33, hydraulic jump located by Rankine-Hugoniot). Domain 0 to 25 m. */
export function bumpSteadyDepth(x:number,kind:'subcritical'|'transcritical'|'shock',gravity=SHALLOW_WATER_GRAVITY):number {
  const g=gravity,z=bumpBed(x);
  if(kind==='subcritical'){const q=4.42,hL=2;return bernoulliDepth(z,q,q*q/(2*g*hL*hL)+hL,'sub',g);}
  const q=kind==='transcritical'?1.53:0.18,hc=Math.cbrt(q*q/g),zM=0.2,critical=q*q/(2*g*hc*hc)+hc+zM;
  const upstream=(at:number)=>{const zz=bumpBed(at);if(Math.abs(at-10)<1e-12)return hc;return bernoulliDepth(zz,q,critical,at<10?'sub':'super',g);};
  if(kind==='transcritical')return upstream(x);
  const shock=bumpShockPosition(g);
  if(x<shock)return upstream(x);
  const hL=0.33;return bernoulliDepth(z,q,q*q/(2*g*hL*hL)+hL,'sub',g);
}
/** Position of the hydraulic jump in the 'shock' bump case: q^2 (1/h1 - 1/h2) + g/2 (h1^2 - h2^2) = 0 (SWASHES eq. 10). */
export function bumpShockPosition(gravity=SHALLOW_WATER_GRAVITY):number {
  const g=gravity,q=0.18,hc=Math.cbrt(q*q/g),critical=q*q/(2*g*hc*hc)+hc+0.2,hL=0.33,down=q*q/(2*g*hL*hL)+hL;
  const rh=(x:number)=>{const z=bumpBed(x),h1=bernoulliDepth(z,q,critical,'super',g),h2=bernoulliDepth(z,q,down,'sub',g);return q*q*(1/h1-1/h2)+g/2*(h1*h1-h2*h2);};
  // The subcritical branch downstream exists only where the bump is low enough; start where it does.
  let lo=10+1e-9;const hi0=12-1e-9;
  for(let k=0;k<=2000;k++){const x=10+2*k/2000;if(Number.isFinite(rh(x))){lo=x;break;}}
  let hi=hi0;const flo=rh(lo);
  for(let i=0;i<200;i++){const mid=.5*(lo+hi);if((rh(mid)>0)===(flo>0))lo=mid;else hi=mid;}
  return .5*(lo+hi);
}
/** Depth of a steady laminar film on an incline of slope S carrying q per width: q = g S h^3 / (3 nu) (Poiseuille film; the
 *  standard result, written from memory). */
export const laminarFilmDepth=(q:number,nu:number,slope:number,gravity=SHALLOW_WATER_GRAVITY)=>Math.cbrt(3*nu*q/(gravity*slope));
/** Manning normal depth of a wide channel (unit width): q = (1/n) h^(5/3) sqrt(S)  =>  h = (n q / sqrt(S))^(3/5). */
export const manningNormalDepth=(q:number,n:number,slope:number)=>Math.pow(n*q/Math.sqrt(slope),.6);
/**
 * Kinematic wave on a plane under constant rainfall excess r from t = 0 (WEPP technical documentation, ch. 4, eqs. 4.4.1-
 * 4.4.10, with Manning: alpha = sqrt(S) / n, m = 5/3): outflow per unit width at the foot of a plane of length L, m^2/s.
 * Rising limb q = alpha (r t)^m until t_e = (L / (alpha r^(m-1)))^(1/m), then r L.
 */
export function kinematicWaveOutflow(t:number,{length,rain,slope,manning}:{length:number;rain:number;slope:number;manning:number}):number {
  const alpha=Math.sqrt(slope)/manning,m=5/3,te=kinematicEquilibriumTime({length,rain,slope,manning});
  return t>=te?rain*length:alpha*Math.pow(rain*t,m);
}
export const kinematicEquilibriumTime=({length,rain,slope,manning}:{length:number;rain:number;slope:number;manning:number})=>Math.pow(length/(Math.sqrt(slope)/manning*Math.pow(rain,2/3)),.6);
/**
 * Cumulative Green-Ampt infiltration under a constant rain r (m/s) on a soil (K, psi, eta) with no runoff: before ponding all
 * the rain enters (F = r t) until F_p = K S / (r - K), S = psi eta, which follows from setting the rate of Rawls et al. eq. 1,
 * f = K (1 + S / F), equal to r; after it F solves eq. 2 between F_p and F: F - F_p - S ln((F + S)/(F_p + S)) = K (t - t_p).
 * When r <= K the soil never ponds and F = r t. Returns F, m.
 */
export function greenAmptCumulative(t:number,rain:number,soil:GreenAmptSoil):number {
  const K=soil.conductivity,S=soil.suction*soil.moistureDeficit;
  if(rain<=K||!(S>0))return rain*t;
  const Fp=K*S/(rain-K),tp=Fp/rain;
  if(t<=tp)return rain*t;
  const target=K*(t-tp);
  let lo=Fp,hi=Fp+target+S;while(hi-Fp-S*Math.log((hi+S)/(Fp+S))<target)hi*=2;
  for(let i=0;i<200;i++){const mid=.5*(lo+hi);if(mid-Fp-S*Math.log((mid+S)/(Fp+S))<target)lo=mid;else hi=mid;}
  return .5*(lo+hi);
}
/** Ponding time of Green-Ampt under constant rain r > K: t_p = K S / (r (r - K)). */
export const greenAmptPondingTime=(rain:number,soil:GreenAmptSoil)=>{const K=soil.conductivity,S=soil.suction*soil.moistureDeficit;return rain<=K?Infinity:K*S/(rain*(rain-K));};

// -------------------------------------------------------------------------------------------------------------------------
// Coupling to a rigid world.
// -------------------------------------------------------------------------------------------------------------------------

export type ShallowWaterShape=
  |{readonly kind:'box';readonly halfExtents:readonly [number,number,number]}
  |{readonly kind:'sphere';readonly radius:number};
/** The part of a rigid world the coupling uses. The kit's PhysicsWorld satisfies it. */
export interface ShallowWaterWorld<B> {
  gravity():readonly number[];
  getState(body:B):{readonly position:readonly number[];readonly rotation:readonly number[];readonly linearVelocity:readonly number[];readonly angularVelocity:readonly number[];readonly mass:number;readonly type:string};
  applyForce(body:B,force:readonly [number,number,number],point?:readonly [number,number,number]):void;
  applyTorque(body:B,torque:readonly [number,number,number]):void;
  isAlive?(body:B):boolean;
  readonly loop?:{readonly step:number};
}
export interface ShallowWaterBodyOptions {
  readonly shape:ShallowWaterShape;
  /** Quadratic drag coefficient on the velocity relative to the water. Default 1.05 (box), 0.47 (sphere). */
  readonly dragCoefficient?:number;
  /** Reference area for the drag, m^2. Default the cross-section of the sphere of the same volume. */
  readonly referenceArea?:number;
  /** Linear rotational drag at full submersion, N m s. Default 0. */
  readonly angularDrag?:number;
}
/** Live per-body results of the last step. */
export interface ShallowWaterBodyReport {
  readonly volume:number;submergedVolume:number;submergedFraction:number;
  readonly centre:Float64Array;readonly buoyancy:Float64Array;readonly drag:Float64Array;
}
interface SWEntry<B> {
  body:B;kind:0|1;hx:number;hy:number;hz:number;radius:number;volume:number;cd:number;area:number;angular:number;
  submergedVolume:number;submergedFraction:number;centre:Float64Array;buoyancy:Float64Array;drag:Float64Array;
  /** Displaced volume per cell of the footprint at the last step: cells and volumes. */
  cells:Int32Array;volumes:Float64Array;count:number;
  /** Not yet seen in the water: what it displaces when first seen is taken as part of the starting water (no source). */
  fresh:boolean;
}
const BOX_FACES=new Uint8Array([1,3,7,5, 0,4,6,2, 2,6,7,3, 0,1,5,4, 4,5,7,6, 0,2,3,1]);
const COUPLING_FIELDS:FieldOptions={label:'ShallowWaterCoupling',skip:['world'],nested:{water:holder,entries:eachElement({label:'ShallowWaterCoupling body'})}};

/**
 * Two-way coupling of rigid bodies with a ShallowWater. Call `step()` immediately before `world.step()`; it advances the
 * water by the rigid step. For each body: the local water plane (level and slope, bilinear between cell centres, read one
 * cell outside the body's footprint), the exact volume of the shape below it and its centroid, the buoyant force rho g V along the
 * plane's normal at the centre of buoyancy, and a drag C_d A rho |w| w / 2 on the velocity w of the body relative to the
 * depth-averaged water, scaled by the submerged fraction. The reaction of the horizontal force goes into the water's
 * momentum over the footprint; the change of the displaced volume per cell goes in (or out) as a volume source, so
 * that a body floating in a lake raises its level; what a body displaces when it is first seen is part of the starting
 * water. Explicit: the water feels the body's forces of the same step.
 */
export class ShallowWaterCoupling<B> {
  readonly backend=SHALLOW_WATER_COUPLING_BACKEND;
  readonly world:ShallowWaterWorld<B>;readonly water:ShallowWater;readonly dt:number;
  private readonly entries:SWEntry<B>[]=[];
  /** Impulse handed to the bodies and to the water in the last step, N s (x, y, z and x, z). */
  readonly impulseOnBodies=new Float64Array(3);readonly impulseOnWater=new Float64Array(2);
  steps=0;
  private readonly rot=new Float64Array(9);private readonly corners=new Float64Array(24);private readonly distance=new Float64Array(8);
  private readonly polygon=new Float64Array(24);private readonly clipOut=new Float64Array(3);
  constructor(world:ShallowWaterWorld<B>,water:ShallowWater,options:{readonly step?:number}={}) {
    if(!world||typeof world.getState!=='function'||typeof world.applyForce!=='function'||typeof world.gravity!=='function')fail('ShallowWaterCoupling needs a world with gravity(), getState() and applyForce().');
    if(!(water instanceof ShallowWater))fail('ShallowWaterCoupling needs a ShallowWater.');
    this.world=world;this.water=water;
    this.dt=num(world.loop?world.loop.step:options.step,'the rigid step (world.loop.step or options.step)',1e-9,10);
  }
  saveState():StateObject {return captureFields(this,COUPLING_FIELDS);}
  restoreState(state:StateValue):void {restoreFields(this,state,COUPLING_FIELDS);}
  /** Couple a body. Its position is its centre of mass, which must be the centre of the shape. */
  addBody(body:B,options:ShallowWaterBodyOptions):ShallowWaterBodyReport {
    if(this.entries.some(e=>e.body===body))fail('That body is already coupled.');
    const s=options?.shape;let entry:SWEntry<B>;
    const base={body,submergedVolume:0,submergedFraction:0,centre:new Float64Array(3),buoyancy:new Float64Array(3),drag:new Float64Array(3),cells:new Int32Array(0),volumes:new Float64Array(0),count:0,fresh:true,
      angular:num(options.angularDrag??0,'angularDrag',0,1e9)};
    if(s?.kind==='box'){
      const [hx,hy,hz]=s.halfExtents.map((v,i)=>num(v,`halfExtents[${i}]`,1e-6,1e4));
      const volume=8*hx*hy*hz;
      entry={...base,kind:0,hx,hy,hz,radius:0,volume,cd:num(options.dragCoefficient??1.05,'dragCoefficient',0,100),area:options.referenceArea??Math.PI*Math.cbrt(3*volume/(4*Math.PI))**2};
    }else if(s?.kind==='sphere'){
      const r=num(s.radius,'radius',1e-6,1e4),volume=4/3*Math.PI*r*r*r;
      entry={...base,kind:1,hx:r,hy:r,hz:r,radius:r,volume,cd:num(options.dragCoefficient??.47,'dragCoefficient',0,100),area:options.referenceArea??Math.PI*r*r};
    }else return fail('shape must be {kind: "box", halfExtents} or {kind: "sphere", radius}.');
    num(entry.area,'referenceArea',0,1e8);
    this.entries.push(entry);return entry;
  }
  report(body:B):ShallowWaterBodyReport|null {return this.entries.find(e=>e.body===body)??null;}
  get bodyCount():number {return this.entries.length;}

  step():void {
    const water=this.water,world=this.world,dt=this.dt,rho=water.density,area=water.dx*water.dz;
    const g=-Number(world.gravity()[1])||0;
    this.impulseOnBodies.fill(0);this.impulseOnWater.fill(0);
    for(const e of this.entries){
      const alive=!world.isAlive||world.isAlive(e.body);
      e.submergedVolume=0;e.submergedFraction=0;e.buoyancy.fill(0);e.drag.fill(0);
      if(!alive){this.release(e);continue;}
      const s=world.getState(e.body),R=this.rot;
      {const [qx,qy,qz,qw]=s.rotation;
        R[0]=1-2*(qy*qy+qz*qz);R[1]=2*(qx*qy-qz*qw);R[2]=2*(qx*qz+qy*qw);
        R[3]=2*(qx*qy+qz*qw);R[4]=1-2*(qx*qx+qz*qz);R[5]=2*(qy*qz-qx*qw);
        R[6]=2*(qx*qz-qy*qw);R[7]=2*(qy*qz+qx*qw);R[8]=1-2*(qx*qx+qy*qy);}
      // Half a step ahead, as in water-coupling.ts: forces held over a step then do not pump energy into bobbing.
      const cx=s.position[0]+.5*dt*s.linearVelocity[0],cy=s.position[1]+.5*dt*s.linearVelocity[1],cz=s.position[2]+.5*dt*s.linearVelocity[2];
      let ex:number,ez:number;
      if(e.kind===0){ex=Math.abs(R[0])*e.hx+Math.abs(R[1])*e.hy+Math.abs(R[2])*e.hz;ez=Math.abs(R[6])*e.hx+Math.abs(R[7])*e.hy+Math.abs(R[8])*e.hz;}else{ex=e.radius;ez=e.radius;}
      // The water plane the body sits in, read one cell outside its footprint on each side: the surface inside the
      // footprint carries the body's own displaced volume (the volume source below), which the body must not read.
      const rx0=ex+water.dx,rz0=ez+water.dz;
      const xp=water.levelAt(cx+rx0,cz),xm=water.levelAt(cx-rx0,cz),zp=water.levelAt(cx,cz+rz0),zm=water.levelAt(cx,cz-rz0);
      const L0=.25*(xp+xm+zp+zm),Lx=(xp-xm)/(2*rx0),Lz=(zp-zm)/(2*rz0);
      const depthHere=Math.max(water.depthAt(cx+rx0,cz),water.depthAt(cx-rx0,cz),water.depthAt(cx,cz+rz0),water.depthAt(cx,cz-rz0));
      if(!(depthHere>water.dryDepth)){this.release(e);continue;}
      const sx=Math.max(-.5,Math.min(.5,Lx)),sz=Math.max(-.5,Math.min(.5,Lz));
      const norm=1/Math.sqrt(1+sx*sx+sz*sz),Nx=-sx*norm,Ny=norm,Nz=-sz*norm;
      const volume=this.clip(e,cx,cy,cz,Nx,Ny,Nz,Ny*(cy-L0));
      // Displaced volume per footprint cell, spread by the cells' share of the footprint rectangle.
      const i0=Math.max(0,Math.floor((cx-ex-water.origin[0])/water.dx)),i1=Math.min(water.nx-1,Math.floor((cx+ex-water.origin[0])/water.dx));
      const k0=Math.max(0,Math.floor((cz-ez-water.origin[1])/water.dz)),k1=Math.min(water.nz-1,Math.floor((cz+ez-water.origin[1])/water.dz));
      const count=Math.max(0,(i1-i0+1)*(k1-k0+1));
      const cells=new Int32Array(count),shares=new Float64Array(count);let total=0,m=0;
      for(let k=k0;k<=k1;k++)for(let i=i0;i<=i1;i++){
        const x0=water.origin[0]+i*water.dx,z0=water.origin[1]+k*water.dz;
        const ox=Math.max(0,Math.min(x0+water.dx,cx+ex)-Math.max(x0,cx-ex)),oz=Math.max(0,Math.min(z0+water.dz,cz+ez)-Math.max(z0,cz-ez));
        cells[m]=i+water.nx*k;shares[m]=ox*oz;total+=ox*oz;m++;
      }
      const vols=new Float64Array(count);
      if(volume>0&&total>0)for(let j=0;j<count;j++)vols[j]=volume*shares[j]/total;
      // Volume source: the change of displaced volume per cell (the water cannot go below empty; the shortfall is booked).
      this.exchangeVolume(e,cells,vols,count,area);
      if(!(volume>0))continue;
      const fraction=volume/e.volume,W=rho*g*volume,c=this.clipOut;
      e.submergedVolume=volume;e.submergedFraction=fraction;e.centre[0]=c[0];e.centre[1]=c[1];e.centre[2]=c[2];
      // Buoyancy along the plane normal (its horizontal part is the pressure gradient force -rho g V grad(eta)).
      const bx=W*Nx/Ny,by=W,bz=W*Nz/Ny;
      e.buoyancy[0]=bx;e.buoyancy[1]=by;e.buoyancy[2]=bz;
      // Drag on the velocity relative to the water (no vertical water velocity in the depth average).
      let uw=0,vw=0;{let sh=0,su=0,sv=0;for(let j=0;j<count;j++){const cell=cells[j],h=water.h[cell];if(h>water.dryDepth){sh+=shares[j]*h;su+=shares[j]*water.qx[cell];sv+=shares[j]*water.qz[cell];}}if(sh>0){uw=su/sh;vw=sv/sh;}}
      const w=s.angularVelocity,rx=c[0]-cx,ry=c[1]-cy,rz=c[2]-cz;
      const wx=s.linearVelocity[0]+w[1]*rz-w[2]*ry-uw,wy=s.linearVelocity[1]+w[2]*rx-w[0]*rz,wz=s.linearVelocity[2]+w[0]*ry-w[1]*rx-vw;
      const speed=Math.sqrt(wx*wx+wy*wy+wz*wz);
      let coefficient=fraction*.5*rho*e.cd*e.area*speed;
      const dynamic=s.type==='dynamic';
      if(dynamic&&s.mass>0&&coefficient*dt>s.mass)coefficient=s.mass/dt;
      const fx=-coefficient*wx,fy=-coefficient*wy,fz=-coefficient*wz;
      e.drag[0]=fx;e.drag[1]=fy;e.drag[2]=fz;
      const Fx=bx+fx,Fy=by+fy,Fz=bz+fz;
      if(dynamic){
        const out:[number,number,number]=[Fx,Fy,Fz],point:[number,number,number]=[s.position[0]+rx,s.position[1]+ry,s.position[2]+rz];
        for(let a=0;a<3;a++)if(Math.abs(out[a])<1e-30)out[a]=0;
        world.applyForce(e.body,out,point);
        if(e.angular>0&&world.applyTorque){const t:[number,number,number]=[-e.angular*fraction*w[0],-e.angular*fraction*w[1],-e.angular*fraction*w[2]];for(let a=0;a<3;a++)if(Math.abs(t[a])<1e-30)t[a]=0;if(t[0]||t[1]||t[2])world.applyTorque(e.body,t);}
        this.impulseOnBodies[0]+=Fx*dt;this.impulseOnBodies[1]+=Fy*dt;this.impulseOnBodies[2]+=Fz*dt;
        // The reaction of the horizontal force goes into the water under the footprint, weighted by depth.
        let sh=0;for(let j=0;j<count;j++){const h=water.h[cells[j]];if(h>water.dryDepth)sh+=shares[j]*h;}
        if(sh>0){
          const jx=-Fx*dt/rho,jz=-Fz*dt/rho;
          for(let j=0;j<count;j++){const cell=cells[j],h=water.h[cell];if(!(h>water.dryDepth))continue;const share=shares[j]*h/sh/area;water.qx[cell]+=jx*share;water.qz[cell]+=jz*share;}
          this.impulseOnWater[0]-=Fx*dt;this.impulseOnWater[1]-=Fz*dt;
          water.sourceMomentum[0]-=Fx*dt;water.sourceMomentum[1]-=Fz*dt;
        }
      }
    }
    water.advance(dt);
    this.steps++;
  }
  private release(e:SWEntry<B>):void {this.exchangeVolume(e,new Int32Array(0),new Float64Array(0),0,this.water.dx*this.water.dz);}
  /** Add the change of the displaced volume per cell to the water (a body entering raises the level around it). */
  private exchangeVolume(e:SWEntry<B>,cells:Int32Array,vols:Float64Array,count:number,area:number):void {
    const water=this.water,h=water.h;let net=0;
    // A body that is already in the water when it is first seen is part of the starting state (a scene, or a save of
    // one, holds the water level with the bodies in it): its displacement is recorded, not added.
    if(e.fresh){e.fresh=false;e.cells=cells;e.volumes=vols;e.count=count;return;}
    for(let j=0;j<e.count;j++){const cell=e.cells[j],before=h[cell];let after=before-e.volumes[j]/area;if(after<0)after=0;h[cell]=after;net+=(after-before)*area;if(after<=water.dryDepth){water.qx[cell]=0;water.qz[cell]=0;}}
    for(let j=0;j<count;j++){const cell=cells[j];h[cell]+=vols[j]/area;net+=vols[j];}
    water.ledger.displaced+=net;
    e.cells=cells;e.volumes=vols;e.count=count;
  }
  /** Volume of the shape on the side N.p <= plane (centre's signed distance `d` above it); centroid into clipOut. */
  private clip(e:SWEntry<B>,cx:number,cy:number,cz:number,Nx:number,Ny:number,Nz:number,d:number):number {
    const out=this.clipOut;
    if(e.kind===1){
      const r=e.radius;let h=r-d;if(h<=0)return 0;if(h>2*r)h=2*r;
      const offset=.75*(2*r-h)*(2*r-h)/(3*r-h);
      out[0]=cx-Nx*offset;out[1]=cy-Ny*offset;out[2]=cz-Nz*offset;
      return Math.PI*h*h*(3*r-h)/3;
    }
    const R=this.rot,corners=this.corners,dist=this.distance,polygon=this.polygon;let below=0;
    for(let k=0;k<8;k++){
      const lx=k&1?e.hx:-e.hx,ly=k&2?e.hy:-e.hy,lz=k&4?e.hz:-e.hz;
      const x=R[0]*lx+R[1]*ly+R[2]*lz,y=R[3]*lx+R[4]*ly+R[5]*lz,z=R[6]*lx+R[7]*ly+R[8]*lz;
      corners[3*k]=x;corners[3*k+1]=y;corners[3*k+2]=z;dist[k]=d+Nx*x+Ny*y+Nz*z;if(dist[k]<=0)below++;
    }
    if(below===0)return 0;
    if(below===8){out[0]=cx;out[1]=cy;out[2]=cz;return e.volume;}
    const qx=-d*Nx,qy=-d*Ny,qz=-d*Nz;let volume=0,mx=0,my=0,mz=0;
    for(let f=0;f<6;f++){
      let count=0;
      for(let k=0;k<4;k++){
        const a=BOX_FACES[f*4+k],b=BOX_FACES[f*4+(k+1)%4],da=dist[a],db=dist[b];
        if(da<=0){polygon[3*count]=corners[3*a];polygon[3*count+1]=corners[3*a+1];polygon[3*count+2]=corners[3*a+2];count++;}
        if((da<=0)!==(db<=0)){const t=da/(da-db);for(let j=0;j<3;j++)polygon[3*count+j]=corners[3*a+j]+t*(corners[3*b+j]-corners[3*a+j]);count++;}
      }
      if(count<3)continue;
      const ax=polygon[0]-qx,ay=polygon[1]-qy,az=polygon[2]-qz;
      for(let m=1;m+1<count;m++){
        const bx=polygon[3*m]-qx,by=polygon[3*m+1]-qy,bz=polygon[3*m+2]-qz,ex=polygon[3*m+3]-qx,ey=polygon[3*m+4]-qy,ez=polygon[3*m+5]-qz;
        const tet=(ax*(by*ez-bz*ey)+ay*(bz*ex-bx*ez)+az*(bx*ey-by*ex))/6;
        volume+=tet;mx+=tet*(ax+bx+ex)*.25;my+=tet*(ay+by+ey)*.25;mz+=tet*(az+bz+ez)*.25;
      }
    }
    if(!(volume>0))return 0;
    out[0]=cx+qx+mx/volume;out[1]=cy+qy+my/volume;out[2]=cz+qz+mz/volume;
    return volume;
  }
}

/** Where shallow water runs: coupled, in the couple stage after the fluid (180) and before the water basin (200); bare, in the post stage after the free-surface tank (520). */
export const SHALLOW_WATER_SUBSYSTEM_ORDER=190;

/**
 * Shallow water as a subsystem of the one stepping loop (simulation.ts).
 *  - A `ShallowWaterCoupling`: couple stage, order 190; its step is the rigid step.
 *  - A bare `ShallowWater`: post stage, order 530; its dt may be the step, a whole fraction of it or a whole multiple.
 * Every step is split into CFL-limited substeps; a step that would need more than `maxSubsteps` throws
 * UNSTABLE_TIME_STEP. Energy: kinetic plus potential energy of the water (rho g (h^2/2 + h b) per area); `exchanged` is 0:
 * the energy carried by inflows, rain and infiltration is not booked, so the balance moves with them as well as falling
 * with friction and shocks. Events at the end of a step: 'wet-cells' {wet, before} when the number of wet cells changes by
 * more than 10%, 'substeps' {substeps} when a step first needs more than 100 substeps.
 */
export function shallowWaterSubsystem<W,B>(target:ShallowWater|ShallowWaterCoupling<B>,options:{readonly id?:string;readonly order?:number}={}):Subsystem<W,B> {
  const coupling=target instanceof ShallowWaterCoupling?target:null,water=coupling?coupling.water:target as ShallowWater;
  if(!(water instanceof ShallowWater))fail('shallowWaterSubsystem needs a ShallowWater or a ShallowWaterCoupling.');
  const id=options.id??'shallow-water';
  let wet=water.stats.wetCells,heavy=false;
  return {
    id,kind:coupling?'shallow-water-coupling':'shallow-water',stage:coupling?'couple':'post',order:options.order??(coupling?SHALLOW_WATER_SUBSYSTEM_ORDER:530),
    timeStep:{dt:coupling?coupling.dt:water.dt,rule:coupling?'equal':'commensurate'},
    step(ctx){if(coupling)coupling.step();else water.step(ctx.substeps);},
    checkpoint(){return {state:(coupling??water).saveState(),wet,heavy};},
    restore(state){
      const s=state as {state?:StateValue;wet?:unknown;heavy?:unknown}|null;
      if(!s||typeof s.wet!=='number'||typeof s.heavy!=='boolean')throw checkpointError(`Subsystem "${id}": the saved state is malformed.`);
      (coupling??water).restoreState(s.state);wet=s.wet;heavy=s.heavy;
    },
    finish(ctx){
      const now=water.stats.wetCells;
      if(Math.abs(now-wet)>.1*Math.max(wet,1)){ctx.emit('wet-cells',{wet:now,before:wet});wet=now;}
      if(water.stats.substeps>100&&!heavy){heavy=true;ctx.emit('substeps',{substeps:water.stats.substeps});}
    },
    energy(){const kinetic=water.kineticEnergy(),potential=water.potentialEnergy();return {domain:'mechanical',total:kinetic+potential,exchanged:0,parts:{kinetic,potential}};},
    diagnostics(){return {solver:water.solver,backend:coupling?coupling.backend:null,cells:water.cells,time:water.time,dt:water.dt,volume:water.volume(),volumeError:water.volumeError(),...water.stats,ledger:{...water.ledger}};},
  };
}
