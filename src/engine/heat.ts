import {EngineError,finite,integer,onlyKeys,record} from './contracts.ts';
import {checkpointError,type StateObject,type StateValue} from './checkpoint.ts';

/** Transient and steady heat conduction in solids on a structured grid of cells.
 *
 *   rho c dT/dt = div(k grad T) + q
 *
 * Finite volume, cell-centred, float64, SI units: metres, seconds, kelvin (or degrees Celsius when
 * no radiation boundary is used), W/(m K), kg/m^3, J/(kg K), W/m^3, W/m^2. The face conductivity
 * between unlike cells is the harmonic mean, so layered walls are exact at steady state. Boundary
 * conditions act on exposed faces of solid cells: fixed temperature, prescribed flux, convection
 * and grey-body radiation. Time integration is backward Euler or Crank-Nicolson (both solved with
 * Jacobi-preconditioned conjugate gradients, matrix-free, no allocation in the step), or explicit
 * Euler, which refuses a time step above its stability limit. A direct steady solve is included.
 *
 * The thermal strain and stress helpers at the end are a ONE-WAY estimate from a temperature field.
 * They are not a thermo-mechanical solver: nothing here computes displacements or feeds stress back.
 * See docs/HEAT_TRANSFER.md for the equations, the validation and the limits.
 */
export const HEAT_SOLVER_ID='heat-fv-implicit-js-f64-v1';
/** Stefan-Boltzmann constant in W/(m^2 K^4) (CODATA 2018, exact). */
export const STEFAN_BOLTZMANN=5.670374419e-8;
export const HEAT_MAX_CELLS=2_097_152;

export type HeatScheme='backward-euler'|'crank-nicolson'|'explicit';
export type HeatFace='x-'|'x+'|'y-'|'y+'|'z-'|'z+';
export type HeatIndex3=readonly [number,number,number];
/** An inclusive box of cell indices. */
export interface HeatRegion {readonly min:HeatIndex3;readonly max:HeatIndex3}

export interface HeatMaterial {
  /** Thermal conductivity k in W/(m K). Required unless conductivityTable is given. */
  readonly conductivity?:number;
  /** Density in kg/m^3. */
  readonly density:number;
  /** Specific heat capacity in J/(kg K). */
  readonly specificHeat:number;
  /** Temperature-dependent conductivity: piecewise linear between the points, constant outside them.
   * It is evaluated at the start-of-step cell temperature (lagged). */
  readonly conductivityTable?:{readonly temperatures:ArrayLike<number>;readonly conductivities:ArrayLike<number>};
}

interface HeatBoundaryPlace {
  /** The outward direction of the faces this condition applies to. */
  readonly face:HeatFace;
  /** Cells to consider. Default: the whole grid. Only exposed faces (the neighbour in the face
   * direction is outside the grid or not solid) of solid cells in the region take the condition. */
  readonly region?:HeatRegion;
}
export type HeatBoundary=HeatBoundaryPlace&(
  /** Fixed surface temperature. */
  |{readonly type:'temperature';readonly temperature:number}
  /** Prescribed heat flux INTO the solid in W/m^2 (0 is the insulated default). */
  |{readonly type:'flux';readonly flux:number}
  /** Film convection: q = coefficient (ambient - T_surface), coefficient in W/(m^2 K). */
  |{readonly type:'convection';readonly coefficient:number;readonly ambient:number}
  /** Grey-body radiation: q = emissivity sigma (environment^4 - T_surface^4). Temperatures must be kelvin. */
  |{readonly type:'radiation';readonly emissivity:number;readonly environment:number});
/** New values for an existing boundary condition (its type, face and region stay). */
export interface HeatBoundaryUpdate {temperature?:number;flux?:number;coefficient?:number;ambient?:number;emissivity?:number;environment?:number}

/** A heat source in one cell (max omitted) or spread over the solid cells of a box. Give exactly
 * one of power (W in total, spread by volume) or density (W/m^3 in every solid cell of the box). */
export interface HeatSource {readonly min:HeatIndex3;readonly max?:HeatIndex3;readonly power?:number;readonly density?:number}

export interface HeatConfig {
  readonly nx:number;readonly ny:number;readonly nz:number;
  /** Cell size per axis in metres. An axis with one cell is a degenerate (1-D or 2-D) direction. */
  readonly dx:number;readonly dy:number;readonly dz:number;
  readonly materials:readonly HeatMaterial[];
  /** Per cell, an index into materials. Default 0. Cell (i,j,k) is at i + nx (j + ny k). */
  readonly material?:ArrayLike<number>;
  /** Per cell, non-zero where there is solid. Default: solid everywhere. */
  readonly solid?:ArrayLike<number>;
  /** Initial temperature: one value or one per cell. */
  readonly temperature:number|ArrayLike<number>;
  /** Time step in seconds. Needed by step(); not needed by solveSteady(). */
  readonly dt?:number;
  /** Default 'backward-euler'. */
  readonly scheme?:HeatScheme;
  readonly boundaries?:readonly HeatBoundary[];
  /** Volumetric source q in W/m^3: one value or one per cell. Default 0. */
  readonly heatGeneration?:number|ArrayLike<number>;
  readonly sources?:readonly HeatSource[];
  /** Conjugate-gradient stop: residual 2-norm <= tolerance * right-hand-side 2-norm. Default 1e-12. */
  readonly tolerance?:number;
  /** Conjugate-gradient iteration limit per solve. Default max(500, 4 * cells), at most 100000. */
  readonly maxIterations?:number;
}

export interface HeatSteadyOptions {
  /** Outer (Newton/Picard) iterations for radiation and k(T). Default 60. */
  readonly maxOuterIterations?:number;
  /** Outer stop: max |change| <= nonlinearTolerance * (1 + max |T|). Default 1e-11. */
  readonly nonlinearTolerance?:number;
}
export interface HeatSteadyResult {converged:boolean;outerIterations:number;iterations:number;residual:number;maxChange:number}
export interface HeatDiagnostics {
  id:string;scheme:HeatScheme;time:number;steps:number;cells:number;solidCells:number;
  /** Sum of rho c V T over solid cells, in joules (relative to T = 0). */
  storedEnergy:number;
  /** Heat that entered through each boundary condition since construction, in joules. */
  boundaryEnergy:number[];
  /** Heat released by sources since construction, in joules. */
  sourceEnergy:number;
  /** Heat rate through each boundary condition at the present temperature, in watts into the solid. */
  boundaryHeatRates:number[];
  sourcePower:number;
  /** Iterations and relative residual of the last linear solve. */
  iterations:number;residual:number;
  /** Largest stable explicit time step for the present state, in seconds. */
  explicitStabilityLimit:number;
}

const FACES:readonly HeatFace[]=['x-','x+','y-','y+','z-','z+'];
const SCHEMES:readonly HeatScheme[]=['backward-euler','crank-nicolson','explicit'];
const TYPE_TEMPERATURE=0,TYPE_FLUX=1,TYPE_CONVECTION=2,TYPE_RADIATION=3;
const TYPES=['temperature','flux','convection','radiation'] as const;
const bad=(message:string):never=>{throw new EngineError('INVALID_PAYLOAD',message);};
function positive(value:unknown,label:string):number {
  const v=finite(value,label);
  if(!(v>0))bad(`${label} must be positive.`);
  return v;
}
function isArrayLike(value:unknown):value is ArrayLike<number> {
  return Array.isArray(value)||(ArrayBuffer.isView(value)&&!(value instanceof DataView));
}
function cellValues(value:unknown,label:string,n:number):ArrayLike<number> {
  if(!isArrayLike(value)||value.length!==n)bad(`${label} must hold one value per cell (${n}).`);
  return value as ArrayLike<number>;
}
function index3(value:unknown,label:string,size:HeatIndex3):[number,number,number] {
  if(!Array.isArray(value)||value.length!==3)bad(`${label} must be [i, j, k].`);
  const v=value as unknown[];
  return [integer(v[0],`${label}[0]`,0,size[0]-1),integer(v[1],`${label}[1]`,0,size[1]-1),integer(v[2],`${label}[2]`,0,size[2]-1)];
}
function region(value:unknown,label:string,size:HeatIndex3):[number,number,number,number,number,number] {
  if(value===undefined)return [0,0,0,size[0]-1,size[1]-1,size[2]-1];
  const r=record(value,label);onlyKeys(r,['min','max'],label);
  const a=index3(r.min,`${label}.min`,size),b=index3(r.max,`${label}.max`,size);
  for(let axis=0;axis<3;axis++)if(b[axis]<a[axis])bad(`${label}.max must not be below ${label}.min.`);
  return [a[0],a[1],a[2],b[0],b[1],b[2]];
}

/** Largest stable explicit time step of a uniform grid: h^2 / (2 d alpha), with alpha = k/(rho c)
 * and d the number of conducting axes. In 3-D this is h^2 / (6 alpha). */
export function heatExplicitLimit(spacing:number,diffusivity:number,dimensions=3):number {
  return positive(spacing,'spacing')**2/(2*integer(dimensions,'dimensions',1,3)*positive(diffusivity,'diffusivity'));
}

export class HeatSolver {
  readonly id=HEAT_SOLVER_ID;
  readonly nx:number;readonly ny:number;readonly nz:number;
  readonly dx:number;readonly dy:number;readonly dz:number;
  readonly cells:number;readonly solidCells:number;
  readonly scheme:HeatScheme;
  readonly tolerance:number;readonly maxIterations:number;
  /** Cell temperatures. Cells outside the solid keep the value they were given and take no part. */
  readonly temperature:Float64Array;
  /** 1 where the cell is solid. */
  readonly solid:Uint8Array;
  /** Volumetric source per cell in W/m^3 (sources included). Change it with setHeatGeneration/addSource. */
  readonly heatGeneration:Float64Array;
  /** Heat that entered through each boundary condition so far, in joules. */
  readonly boundaryEnergy:Float64Array;
  /** Step-averaged heat rate of each boundary condition over the last step, in watts into the solid. */
  readonly boundaryStepRates:Float64Array;
  readonly boundaryCount:number;

  #dt:number;#time=0;#steps=0;#sourceEnergy=0;#iterations=0;#residual=0;#dirty=true;
  readonly #volume:number;readonly #theta:number;
  readonly #hasTable:boolean;readonly #hasRadiation:boolean;
  readonly #materialOf:Uint8Array;readonly #matK:Float64Array;readonly #matRhoC:Float64Array;
  readonly #tableT:(Float64Array|null)[];readonly #tableK:(Float64Array|null)[];
  readonly #capacity:Float64Array;readonly #kCell:Float64Array;
  readonly #gx:Float64Array;readonly #gy:Float64Array;readonly #gz:Float64Array;readonly #sumG:Float64Array;
  readonly #bG:Float64Array;readonly #bA:Float64Array;
  readonly #diag:Float64Array;readonly #invDiag:Float64Array;
  readonly #rhs:Float64Array;readonly #delta:Float64Array;readonly #r:Float64Array;readonly #z:Float64Array;readonly #p:Float64Array;readonly #q:Float64Array;
  // Boundary conditions (one entry each) and their exposed faces (one record each).
  readonly #bType:Uint8Array;readonly #bP0:Float64Array;readonly #bP1:Float64Array;
  readonly #recCell:Int32Array;readonly #recKey:Float64Array;readonly #recArea:Float64Array;readonly #recHalf:Float64Array;readonly #recBoundary:Int32Array;
  readonly #recG:Float64Array;readonly #recA:Float64Array;readonly #recOrder:Int32Array;
  readonly #component:Int32Array;readonly #componentSink:Uint8Array;

  constructor(input:HeatConfig) {
    const c=record(input,'heat');
    onlyKeys(c,['nx','ny','nz','dx','dy','dz','materials','material','solid','temperature','dt','scheme','boundaries','heatGeneration','sources','tolerance','maxIterations'],'heat');
    const nx=this.nx=integer(c.nx,'heat.nx',1,HEAT_MAX_CELLS),ny=this.ny=integer(c.ny,'heat.ny',1,HEAT_MAX_CELLS),nz=this.nz=integer(c.nz,'heat.nz',1,HEAT_MAX_CELLS);
    const n=this.cells=nx*ny*nz;
    if(n>HEAT_MAX_CELLS)bad(`heat grid has ${n} cells; at most ${HEAT_MAX_CELLS} are supported.`);
    const dx=this.dx=positive(c.dx,'heat.dx'),dy=this.dy=positive(c.dy,'heat.dy'),dz=this.dz=positive(c.dz,'heat.dz');
    this.#volume=dx*dy*dz;
    const scheme=c.scheme===undefined?'backward-euler':c.scheme as HeatScheme;
    if(!SCHEMES.includes(scheme))bad(`heat.scheme must be one of ${SCHEMES.join(', ')}.`);
    this.scheme=scheme;this.#theta=scheme==='backward-euler'?1:scheme==='crank-nicolson'?.5:0;
    this.#dt=c.dt===undefined?NaN:positive(c.dt,'heat.dt');
    this.tolerance=c.tolerance===undefined?1e-12:finite(c.tolerance,'heat.tolerance',1e-15,1e-2);
    this.maxIterations=c.maxIterations===undefined?Math.min(100000,Math.max(500,4*n)):integer(c.maxIterations,'heat.maxIterations',1,10_000_000);

    // Materials.
    if(!Array.isArray(c.materials)||c.materials.length<1||c.materials.length>255)bad('heat.materials must list 1 to 255 materials.');
    const materials=c.materials as unknown[],count=materials.length;
    this.#matK=new Float64Array(count);this.#matRhoC=new Float64Array(count);this.#tableT=[];this.#tableK=[];
    let hasTable=false;
    materials.forEach((value,m)=>{
      const label=`heat.materials[${m}]`,material=record(value,label);
      onlyKeys(material,['conductivity','density','specificHeat','conductivityTable'],label);
      this.#matRhoC[m]=positive(material.density,`${label}.density`)*positive(material.specificHeat,`${label}.specificHeat`);
      if(!Number.isFinite(this.#matRhoC[m]*this.#volume))bad(`${label} heat capacity is out of range.`);
      if(material.conductivityTable===undefined){
        this.#matK[m]=positive(material.conductivity,`${label}.conductivity`);this.#tableT.push(null);this.#tableK.push(null);return;
      }
      if(material.conductivity!==undefined)bad(`${label} takes conductivity or conductivityTable, not both.`);
      const table=record(material.conductivityTable,`${label}.conductivityTable`);
      onlyKeys(table,['temperatures','conductivities'],`${label}.conductivityTable`);
      const ts=table.temperatures,ks=table.conductivities;
      if(!isArrayLike(ts)||!isArrayLike(ks)||ts.length!==ks.length||ts.length<2||ts.length>4096)bad(`${label}.conductivityTable needs 2 to 4096 matching temperatures and conductivities.`);
      const tt=Float64Array.from(ts as ArrayLike<number>,(v,i)=>finite(v,`${label}.conductivityTable.temperatures[${i}]`));
      const kk=Float64Array.from(ks as ArrayLike<number>,(v,i)=>positive(v,`${label}.conductivityTable.conductivities[${i}]`));
      for(let i=1;i<tt.length;i++)if(!(tt[i]>tt[i-1]))bad(`${label}.conductivityTable.temperatures must increase.`);
      this.#matK[m]=NaN;this.#tableT.push(tt);this.#tableK.push(kk);hasTable=true;
    });
    this.#hasTable=hasTable;

    // Cells.
    this.#materialOf=new Uint8Array(n);
    if(c.material!==undefined){
      const values=cellValues(c.material,'heat.material',n);
      for(let i=0;i<n;i++)this.#materialOf[i]=integer(values[i],`heat.material[${i}]`,0,count-1);
    }
    this.solid=new Uint8Array(n).fill(1);
    if(c.solid!==undefined){
      const values=cellValues(c.solid,'heat.solid',n);
      for(let i=0;i<n;i++){
        const v=values[i] as unknown;
        if(typeof v!=='boolean'&&!(typeof v==='number'&&Number.isFinite(v)))bad(`heat.solid[${i}] must be a number or boolean.`);
        this.solid[i]=v?1:0;
      }
    }
    let solidCells=0;
    for(let i=0;i<n;i++)solidCells+=this.solid[i];
    if(solidCells===0)bad('heat.solid leaves no solid cell.');
    this.solidCells=solidCells;
    this.temperature=new Float64Array(n);
    this.heatGeneration=new Float64Array(n);
    this.#capacity=new Float64Array(n);this.#kCell=new Float64Array(n);
    this.#gx=new Float64Array(n);this.#gy=new Float64Array(n);this.#gz=new Float64Array(n);this.#sumG=new Float64Array(n);
    this.#bG=new Float64Array(n);this.#bA=new Float64Array(n);this.#diag=new Float64Array(n);this.#invDiag=new Float64Array(n);
    this.#rhs=new Float64Array(n);this.#delta=new Float64Array(n);this.#r=new Float64Array(n);this.#z=new Float64Array(n);this.#p=new Float64Array(n);this.#q=new Float64Array(n);
    for(let i=0;i<n;i++)if(this.solid[i]){
      const m=this.#materialOf[i];
      this.#capacity[i]=this.#matRhoC[m]*this.#volume;this.#kCell[i]=this.#matK[m];
    }
    this.setTemperature(c.temperature as number|ArrayLike<number>);

    // Boundary conditions and the exposed faces they act on.
    const size:HeatIndex3=[nx,ny,nz],stride=[1,nx,nx*ny],spacing=[dx,dy,dz],area=[dy*dz,dx*dz,dx*dy];
    const boundaries=c.boundaries===undefined?[]:c.boundaries as unknown[];
    if(!Array.isArray(boundaries)||boundaries.length>4096)bad('heat.boundaries must be an array of at most 4096 conditions.');
    const nb=this.boundaryCount=boundaries.length;
    this.#bType=new Uint8Array(nb);this.#bP0=new Float64Array(nb);this.#bP1=new Float64Array(nb);
    this.boundaryEnergy=new Float64Array(nb);this.boundaryStepRates=new Float64Array(nb);
    const recCell:number[]=[],recKey:number[]=[],recArea:number[]=[],recHalf:number[]=[],recBoundary:number[]=[];
    let hasRadiation=false;
    boundaries.forEach((value,b)=>{
      const label=`heat.boundaries[${b}]`,boundary=record(value,label),type=TYPES.indexOf(boundary.type as typeof TYPES[number]);
      if(type<0)bad(`${label}.type must be one of ${TYPES.join(', ')}.`);
      onlyKeys(boundary,['face','region','type',...[['temperature'],['flux'],['coefficient','ambient'],['emissivity','environment']][type]],label);
      const face=FACES.indexOf(boundary.face as HeatFace);
      if(face<0)bad(`${label}.face must be one of ${FACES.join(', ')}.`);
      this.#bType[b]=type;this.#setBoundaryValues(b,boundary,label,true);
      if(type===TYPE_RADIATION)hasRadiation=true;
      const [i0,j0,k0,i1,j1,k1]=region(boundary.region,`${label}.region`,size),axis=face>>1,direction=face&1?1:-1;
      let found=0;
      for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
        const cell=i+nx*(j+ny*k);
        if(!this.solid[cell])continue;
        const along=[i,j,k][axis]+direction;
        if(along>=0&&along<size[axis]&&this.solid[cell+direction*stride[axis]])continue;
        recCell.push(cell);recKey.push(cell*6+face);recArea.push(area[axis]);recHalf.push(spacing[axis]/2);recBoundary.push(b);found++;
      }
      if(found===0)bad(`${label} selects no exposed face of a solid cell.`);
    });
    this.#hasRadiation=hasRadiation;
    const records=recCell.length;
    this.#recCell=Int32Array.from(recCell);this.#recKey=Float64Array.from(recKey);this.#recArea=Float64Array.from(recArea);
    this.#recHalf=Float64Array.from(recHalf);this.#recBoundary=Int32Array.from(recBoundary);
    this.#recG=new Float64Array(records);this.#recA=new Float64Array(records);
    this.#recOrder=Int32Array.from(recKey.map((_,i)=>i).sort((a,b)=>recKey[a]-recKey[b]||a-b));
    for(let s=1;s<records;s++){
      const a=this.#recOrder[s-1],b=this.#recOrder[s];
      if(recKey[a]===recKey[b]&&(this.#bType[recBoundary[a]]===TYPE_TEMPERATURE||this.#bType[recBoundary[b]]===TYPE_TEMPERATURE)){
        bad(`heat.boundaries[${recBoundary[a]}] and [${recBoundary[b]}] overlap on a face; a fixed temperature cannot share a face with another condition.`);
      }
    }

    // Sources.
    if(c.heatGeneration!==undefined)this.setHeatGeneration(c.heatGeneration as number|ArrayLike<number>);
    if(c.sources!==undefined){
      if(!Array.isArray(c.sources)||c.sources.length>65536)bad('heat.sources must be an array of at most 65536 sources.');
      (c.sources as HeatSource[]).forEach(source=>this.addSource(source));
    }

    // Connected solid components, so a steady solve can refuse a body with nowhere for heat to go.
    this.#component=new Int32Array(n).fill(-1);
    const queue=new Int32Array(solidCells);
    let components=0;
    for(let seed=0;seed<n;seed++){
      if(!this.solid[seed]||this.#component[seed]>=0)continue;
      let head=0,tail=0;
      queue[tail++]=seed;this.#component[seed]=components;
      while(head<tail){
        const cell=queue[head++],i=cell%nx,j=Math.floor(cell/nx)%ny,k=Math.floor(cell/(nx*ny));
        for(let face=0;face<6;face++){
          const axis=face>>1,direction=face&1?1:-1,along=[i,j,k][axis]+direction;
          if(along<0||along>=size[axis])continue;
          const next=cell+direction*stride[axis];
          if(this.solid[next]&&this.#component[next]<0){this.#component[next]=components;queue[tail++]=next;}
        }
      }
      components++;
    }
    this.#componentSink=new Uint8Array(components);

    this.#updateConductances();
    this.#assemble();
    if(scheme==='explicit'&&c.dt!==undefined)this.#checkExplicit();
  }

  get dt():number {return this.#dt;}
  get time():number {return this.#time;}
  get steps():number {return this.#steps;}
  /** Heat released by sources so far, in joules. */
  get sourceEnergy():number {return this.#sourceEnergy;}
  /** Iterations of the last linear solve. */
  get iterations():number {return this.#iterations;}
  /** Relative residual of the last linear solve. */
  get residual():number {return this.#residual;}
  /** Number of connected solid bodies in the grid. */
  get components():number {return this.#componentSink.length;}

  index(i:number,j=0,k=0):number {
    return integer(i,'i',0,this.nx-1)+this.nx*(integer(j,'j',0,this.ny-1)+this.ny*integer(k,'k',0,this.nz-1));
  }

  setTimeStep(dt:number):void {
    const value=positive(dt,'dt'),previous=this.#dt;
    this.#dt=value;
    if(this.scheme==='explicit'){
      try{this.#checkExplicit();}catch(error){this.#dt=previous;throw error;}
    }
  }

  /** Replace the temperature field: one value for every cell, or one value per cell. */
  setTemperature(value:number|ArrayLike<number>):void {
    const n=this.cells,t=this.temperature;
    if(typeof value==='number'){t.fill(finite(value,'temperature'));}
    else{
      const values=cellValues(value,'temperature',n);
      for(let i=0;i<n;i++)finite(values[i],`temperature[${i}]`);
      for(let i=0;i<n;i++)t[i]=values[i];
    }
    this.#dirty=true;
  }

  /** Replace the volumetric source (W/m^3): one value for every solid cell, or one value per cell. */
  setHeatGeneration(value:number|ArrayLike<number>):void {
    const n=this.cells,q=this.heatGeneration;
    if(typeof value==='number'){
      const v=finite(value,'heatGeneration');
      for(let i=0;i<n;i++)q[i]=this.solid[i]?v:0;
      return;
    }
    const values=cellValues(value,'heatGeneration',n);
    for(let i=0;i<n;i++)finite(values[i],`heatGeneration[${i}]`);
    for(let i=0;i<n;i++)q[i]=this.solid[i]?values[i]:0;
  }

  /** Add a point or region source to the volumetric source field. */
  addSource(value:HeatSource):void {
    const source=record(value,'source');onlyKeys(source,['min','max','power','density'],'source');
    const size:HeatIndex3=[this.nx,this.ny,this.nz];
    const [i0,j0,k0,i1,j1,k1]=region({min:source.min,max:source.max===undefined?source.min:source.max},'source',size);
    if((source.power===undefined)===(source.density===undefined))bad('source takes exactly one of power (W) or density (W/m^3).');
    let solidInBox=0;
    for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++)solidInBox+=this.solid[i+this.nx*(j+this.ny*k)];
    if(solidInBox===0)bad('source covers no solid cell.');
    const density=source.density!==undefined?finite(source.density,'source.density'):finite(source.power,'source.power')/(solidInBox*this.#volume);
    if(!Number.isFinite(density))bad('source density is out of range.');
    for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
      const cell=i+this.nx*(j+this.ny*k);
      if(this.solid[cell])this.heatGeneration[cell]+=density;
    }
  }

  /** Change the values of a boundary condition between steps (for example a time-varying ambient). */
  updateBoundary(index:number,values:HeatBoundaryUpdate):void {
    const b=integer(index,'boundary',0,this.boundaryCount-1),update=record(values,'boundary values');
    onlyKeys(update,[['temperature'],['flux'],['coefficient','ambient'],['emissivity','environment']][this.#bType[b]],'boundary values');
    this.#setBoundaryValues(b,update,'boundary values',false);
    this.#dirty=true;
  }

  #setBoundaryValues(b:number,v:Record<string,unknown>,label:string,all:boolean):void {
    const type=this.#bType[b],has=(key:string)=>all||v[key]!==undefined;
    if(type===TYPE_TEMPERATURE){if(has('temperature'))this.#bP0[b]=finite(v.temperature,`${label}.temperature`);}
    else if(type===TYPE_FLUX){if(has('flux'))this.#bP0[b]=finite(v.flux,`${label}.flux`);}
    else if(type===TYPE_CONVECTION){
      if(has('coefficient'))this.#bP0[b]=finite(v.coefficient,`${label}.coefficient`,0);
      if(has('ambient'))this.#bP1[b]=finite(v.ambient,`${label}.ambient`);
    }else{
      if(has('emissivity'))this.#bP0[b]=finite(v.emissivity,`${label}.emissivity`,0,1);
      if(has('environment'))this.#bP1[b]=finite(v.environment,`${label}.environment`,0);
    }
  }

  #conductivity(material:number,temperature:number):number {
    const ts=this.#tableT[material];
    if(ts===null)return this.#matK[material];
    const ks=this.#tableK[material] as Float64Array,last=ts.length-1;
    if(temperature<=ts[0])return ks[0];
    if(temperature>=ts[last])return ks[last];
    let lo=0,hi=last;
    while(hi-lo>1){const mid=(lo+hi)>>1;if(ts[mid]<=temperature)lo=mid;else hi=mid;}
    return ks[lo]+(ks[hi]-ks[lo])*(temperature-ts[lo])/(ts[hi]-ts[lo]);
  }

  /** Face conductances in W/K from the cell conductivities: A * harmonic mean / spacing. */
  #updateConductances():void {
    const {nx,ny,nz,solid}=this,nxy=nx*ny,k=this.#kCell,gx=this.#gx,gy=this.#gy,gz=this.#gz,sum=this.#sumG;
    const cx=2*this.dy*this.dz/this.dx,cy=2*this.dx*this.dz/this.dy,cz=2*this.dx*this.dy/this.dz;
    let cell=0;
    for(let kz=0;kz<nz;kz++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,cell++){
      if(!solid[cell]){gx[cell]=gy[cell]=gz[cell]=0;continue;}
      const kp=k[cell];
      gx[cell]=i+1<nx&&solid[cell+1]?cx*kp*k[cell+1]/(kp+k[cell+1]):0;
      gy[cell]=j+1<ny&&solid[cell+nx]?cy*kp*k[cell+nx]/(kp+k[cell+nx]):0;
      gz[cell]=kz+1<nz&&solid[cell+nxy]?cz*kp*k[cell+nxy]/(kp+k[cell+nxy]):0;
    }
    cell=0;
    for(let kz=0;kz<nz;kz++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,cell++){
      sum[cell]=gx[cell]+gy[cell]+gz[cell]+(i>0?gx[cell-1]:0)+(j>0?gy[cell-nx]:0)+(kz>0?gz[cell-nxy]:0);
    }
  }

  /** Coefficients for the present temperature: k(T), face conductances, and every boundary face as
   * the affine heat rate Q = a - g T_cell (watts into the cell). Radiation is linearised about the
   * present cell temperature (tangent), with the surface temperature found by Newton iteration. */
  #assemble():void {
    const t=this.temperature,k=this.#kCell;
    if(this.#hasTable){
      for(let cell=0;cell<this.cells;cell++)if(this.solid[cell])k[cell]=this.#conductivity(this.#materialOf[cell],t[cell]);
      this.#updateConductances();
    }
    const bG=this.#bG,bA=this.#bA,recG=this.#recG,recA=this.#recA,cells=this.#recCell,areas=this.#recArea,halves=this.#recHalf,owner=this.#recBoundary;
    bG.fill(0);bA.fill(0);
    for(let r=0;r<cells.length;r++){
      const cell=cells[r],b=owner[r],type=this.#bType[b],p0=this.#bP0[b],p1=this.#bP1[b],area=areas[r],u=k[cell]/halves[r];
      let g=0,a=0;
      if(type===TYPE_TEMPERATURE){g=area*u;a=g*p0;}
      else if(type===TYPE_FLUX){a=area*p0;}
      else if(type===TYPE_CONVECTION){g=p0>0?area*u*p0/(u+p0):0;a=g*p1;}
      else if(p0>0){
        const tc=t[cell],es=p0*STEFAN_BOLTZMANN,env4=p1*p1*p1*p1;
        if(!(tc>=0))throw new EngineError('INVALID_STATE',`A radiating cell is at ${tc}; radiation needs absolute temperatures in kelvin.`);
        // Surface temperature: conduction through the half cell equals the radiated flux.
        let ts=tc;
        for(let iteration=0;iteration<100;iteration++){
          const ts3=ts*ts*ts,change=(u*(tc-ts)-es*(ts3*ts-env4))/(u+4*es*ts3);
          ts+=change;
          if(ts<0)ts=0;
          if(Math.abs(change)<=1e-14*ts)break;
        }
        const h4=4*es*ts*ts*ts,rate=area*es*(env4-ts*ts*ts*ts);
        g=area*u*h4/(u+h4);a=rate+g*tc;
      }
      recG[r]=g;recA[r]=a;bG[cell]+=g;bA[cell]+=a;
    }
    this.#dirty=false;
  }
  #sync():void {if(this.#dirty)this.#assemble();}

  /** out = net heat rate into every cell, in watts: conduction + boundaries + sources. */
  #heatRates(out:Float64Array):void {
    const {nx,ny,nz,solid}=this,nxy=nx*ny,nx1=nx-1,ny1=ny-1,nz1=nz-1,t=this.temperature;
    const gx=this.#gx,gy=this.#gy,gz=this.#gz,bG=this.#bG,bA=this.#bA,q=this.heatGeneration,volume=this.#volume;
    let cell=0;
    for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,cell++){
      if(!solid[cell]){out[cell]=0;continue;}
      const tc=t[cell];
      let rate=bA[cell]-bG[cell]*tc+q[cell]*volume;
      if(i>0)rate+=gx[cell-1]*(t[cell-1]-tc);
      if(i<nx1)rate+=gx[cell]*(t[cell+1]-tc);
      if(j>0)rate+=gy[cell-nx]*(t[cell-nx]-tc);
      if(j<ny1)rate+=gy[cell]*(t[cell+nx]-tc);
      if(k>0)rate+=gz[cell-nxy]*(t[cell-nxy]-tc);
      if(k<nz1)rate+=gz[cell]*(t[cell+nxy]-tc);
      out[cell]=rate;
    }
  }

  /** out = (diag - theta * conduction links) x: the symmetric positive-definite step matrix. */
  #apply(theta:number,x:Float64Array,out:Float64Array):void {
    const {nx,ny,nz,solid}=this,nxy=nx*ny,nx1=nx-1,ny1=ny-1,nz1=nz-1;
    const gx=this.#gx,gy=this.#gy,gz=this.#gz,diag=this.#diag;
    let cell=0;
    for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,cell++){
      if(!solid[cell]){out[cell]=0;continue;}
      let links=0;
      if(i>0)links+=gx[cell-1]*x[cell-1];
      if(i<nx1)links+=gx[cell]*x[cell+1];
      if(j>0)links+=gy[cell-nx]*x[cell-nx];
      if(j<ny1)links+=gy[cell]*x[cell+nx];
      if(k>0)links+=gz[cell-nxy]*x[cell-nxy];
      if(k<nz1)links+=gz[cell]*x[cell+nxy];
      out[cell]=diag[cell]*x[cell]-theta*links;
    }
  }

  /** Jacobi-preconditioned conjugate gradients for matrix * delta = rhs, from delta = 0. */
  #solve(theta:number):void {
    const n=this.cells,b=this.#rhs,x=this.#delta,r=this.#r,z=this.#z,p=this.#p,q=this.#q,inv=this.#invDiag;
    let bb=0,rz=0;
    for(let i=0;i<n;i++){x[i]=0;r[i]=b[i];z[i]=inv[i]*b[i];p[i]=z[i];bb+=b[i]*b[i];rz+=b[i]*z[i];}
    this.#iterations=0;this.#residual=0;
    if(bb===0)return;
    if(!Number.isFinite(bb))throw new EngineError('INVALID_STATE','The heat right-hand side is not finite.');
    const stop=this.tolerance*this.tolerance*bb;
    for(let iteration=1;iteration<=this.maxIterations;iteration++){
      this.#apply(theta,p,q);
      let pq=0;
      for(let i=0;i<n;i++)pq+=p[i]*q[i];
      if(!(pq>0))throw new EngineError('SOLVER_BREAKDOWN','The heat matrix is not positive definite along a search direction.');
      const alpha=rz/pq;
      let rr=0,next=0;
      for(let i=0;i<n;i++){
        x[i]+=alpha*p[i];
        const ri=r[i]-alpha*q[i],zi=inv[i]*ri;
        r[i]=ri;z[i]=zi;rr+=ri*ri;next+=ri*zi;
      }
      this.#iterations=iteration;this.#residual=Math.sqrt(rr/bb);
      if(rr<=stop)return;
      const beta=next/rz;
      rz=next;
      for(let i=0;i<n;i++)p[i]=z[i]+beta*p[i];
    }
    throw new EngineError('SOLVER_NOT_CONVERGED',`Conjugate gradients stopped at ${this.maxIterations} iterations with relative residual ${this.#residual}.`);
  }

  #limitFromCoefficients():number {
    let limit=Infinity;
    for(let cell=0;cell<this.cells;cell++){
      const loss=this.#sumG[cell]+this.#bG[cell];
      if(this.solid[cell]&&loss>0){const value=this.#capacity[cell]/loss;if(value<limit)limit=value;}
    }
    return limit;
  }
  #checkExplicit():void {
    this.#sync();
    const limit=this.#limitFromCoefficients();
    if(this.#dt>limit*(1+1e-9))throw new EngineError('UNSTABLE_TIME_STEP',`Explicit time step ${this.#dt} s is above the stability limit ${limit} s (h^2 / (6 alpha) for an interior cell of a uniform 3-D grid). Use a smaller dt or an implicit scheme.`);
  }

  /** Largest time step for which the explicit scheme keeps every new cell temperature a weighted
   * average of old temperatures: the minimum over cells of heat capacity / (sum of conductances to
   * neighbours and boundaries). For an interior cell of a uniform grid this is h^2 / (6 alpha) in
   * 3-D, h^2 / (4 alpha) in 2-D and h^2 / (2 alpha) in 1-D. Fixed-temperature, convective and
   * radiating faces lower it. */
  explicitStabilityLimit():number {this.#sync();return this.#limitFromCoefficients();}

  /** Advance by count time steps. Returns the number of conjugate-gradient iterations used.
   * Nothing is allocated. On an error the state is the one after the last completed step. */
  step(count=1):number {
    const steps=integer(count,'count',0,10_000_000),dt=this.#dt,theta=this.#theta,n=this.cells;
    if(!(dt>0))throw new EngineError('INVALID_STATE','step() needs a time step: pass dt in the configuration or call setTimeStep.');
    const t=this.temperature,rhs=this.#rhs,delta=this.#delta,capacity=this.#capacity,diag=this.#diag,inv=this.#invDiag,sumG=this.#sumG,bG=this.#bG;
    const cells=this.#recCell,owner=this.#recBoundary,recG=this.#recG,recA=this.#recA,rates=this.boundaryStepRates,energy=this.boundaryEnergy,q=this.heatGeneration;
    let iterations=0;
    for(let s=0;s<steps;s++){
      this.#assemble();
      if(theta===0){
        const limit=this.#limitFromCoefficients();
        if(dt>limit*(1+1e-9))throw new EngineError('UNSTABLE_TIME_STEP',`Explicit time step ${dt} s is above the stability limit ${limit} s.`);
        this.#heatRates(rhs);
        for(let i=0;i<n;i++)delta[i]=capacity[i]>0?dt*rhs[i]/capacity[i]:0;
        this.#iterations=0;this.#residual=0;
      }else{
        this.#heatRates(rhs);
        for(let i=0;i<n;i++){
          const d=capacity[i]/dt+theta*(sumG[i]+bG[i]);
          diag[i]=d;inv[i]=d>0?1/d:0;
        }
        this.#solve(theta);
        iterations+=this.#iterations;
      }
      // The heat each boundary and source delivered in this step, exactly as the scheme used it.
      rates.fill(0);
      for(let r=0;r<cells.length;r++){
        const cell=cells[r];
        rates[owner[r]]+=recA[r]-recG[r]*(t[cell]+theta*delta[cell]);
      }
      for(let b=0;b<rates.length;b++)energy[b]+=dt*rates[b];
      let power=0;
      for(let i=0;i<n;i++)power+=q[i];
      this.#sourceEnergy+=dt*power*this.#volume;
      for(let i=0;i<n;i++)t[i]+=delta[i];
      for(let i=0;i<n;i++)if(!Number.isFinite(t[i]))throw new EngineError('INVALID_STATE','The temperature field is no longer finite.');
      this.#time+=dt;this.#steps++;this.#dirty=true;
    }
    return iterations;
  }

  /** Solve div(k grad T) + q = 0 directly, replacing the temperature field. Time and the energy
   * ledgers are not changed. Every connected solid body needs a fixed-temperature, convective or
   * radiating face; otherwise the steady state is undefined and the call throws. */
  solveSteady(options:HeatSteadyOptions={}):HeatSteadyResult {
    const o=record(options,'steady options');onlyKeys(o,['maxOuterIterations','nonlinearTolerance'],'steady options');
    const maxOuter=o.maxOuterIterations===undefined?60:integer(o.maxOuterIterations,'maxOuterIterations',1,10000);
    const tolerance=o.nonlinearTolerance===undefined?1e-11:finite(o.nonlinearTolerance,'nonlinearTolerance',1e-15,1e-2);
    const n=this.cells,t=this.temperature,delta=this.#delta,diag=this.#diag,inv=this.#invDiag,sumG=this.#sumG,bG=this.#bG;
    const nonlinear=this.#hasTable||this.#hasRadiation,result:HeatSteadyResult={converged:false,outerIterations:0,iterations:0,residual:0,maxChange:0};
    for(let outer=1;outer<=maxOuter;outer++){
      this.#assemble();
      const sink=this.#componentSink.fill(0);
      for(let i=0;i<n;i++)if(bG[i]>0)sink[this.#component[i]]=1;
      for(let s=0;s<sink.length;s++)if(!sink[s])throw new EngineError('SINGULAR_STEADY','A solid body has no fixed-temperature, convective or radiating face, so it has no steady temperature.');
      this.#heatRates(this.#rhs);
      for(let i=0;i<n;i++){const d=sumG[i]+bG[i];diag[i]=d;inv[i]=d>0?1/d:0;}
      this.#solve(1);
      let change=0,scale=0;
      for(let i=0;i<n;i++){
        t[i]+=delta[i];
        if(Math.abs(delta[i])>change)change=Math.abs(delta[i]);
        if(this.solid[i]&&Math.abs(t[i])>scale)scale=Math.abs(t[i]);
      }
      this.#dirty=true;
      result.outerIterations=outer;result.iterations+=this.#iterations;result.residual=this.#residual;result.maxChange=change;
      if(!Number.isFinite(change))throw new EngineError('INVALID_STATE','The steady temperature field is not finite.');
      if(!nonlinear||change<=tolerance*(1+scale)){result.converged=true;break;}
    }
    return result;
  }

  /** Sum of rho c V (T - reference) over solid cells, in joules. */
  storedEnergy(reference=0):number {
    const ref=finite(reference,'reference'),t=this.temperature,capacity=this.#capacity;
    let energy=0;
    for(let i=0;i<this.cells;i++)energy+=capacity[i]*(t[i]-ref);
    return energy;
  }

  /** Total source power in watts. */
  sourcePower():number {
    let power=0;
    for(let i=0;i<this.cells;i++)power+=this.heatGeneration[i];
    return power*this.#volume;
  }

  /** Heat rate through one boundary condition at the present temperature, in watts into the solid.
   * Radiation uses the exact fourth-power law here, not the linearised one. */
  boundaryHeatRate(index:number):number {
    const b=integer(index,'boundary',0,this.boundaryCount-1);
    this.#sync();
    let rate=0;
    for(let r=0;r<this.#recCell.length;r++)if(this.#recBoundary[r]===b)rate+=this.#recA[r]-this.#recG[r]*this.temperature[this.#recCell[r]];
    return rate;
  }
  boundaryHeatRates(out:Float64Array=new Float64Array(this.boundaryCount)):Float64Array {
    if(!(out instanceof Float64Array)||out.length!==this.boundaryCount)bad('out must be a Float64Array with one entry per boundary condition.');
    this.#sync();out.fill(0);
    for(let r=0;r<this.#recCell.length;r++)out[this.#recBoundary[r]]+=this.#recA[r]-this.#recG[r]*this.temperature[this.#recCell[r]];
    return out;
  }
  /** Total exposed area a boundary condition acts on, in m^2. */
  boundaryArea(index:number):number {
    const b=integer(index,'boundary',0,this.boundaryCount-1);
    let area=0;
    for(let r=0;r<this.#recCell.length;r++)if(this.#recBoundary[r]===b)area+=this.#recArea[r];
    return area;
  }

  /** Heat flux density in W/m^2 through interior faces, positive along +x, +y and +z. Entry
   * [cell] of x is the face between cell (i,j,k) and (i+1,j,k); it is 0 where there is no such
   * solid neighbour. Use cellFaceFlux for boundary faces. */
  faceHeatFlux(out?:{x:Float64Array;y:Float64Array;z:Float64Array}):{x:Float64Array;y:Float64Array;z:Float64Array} {
    const n=this.cells,result=out??{x:new Float64Array(n),y:new Float64Array(n),z:new Float64Array(n)};
    for(const axis of [result.x,result.y,result.z])if(!(axis instanceof Float64Array)||axis.length!==n)bad('out must hold three Float64Arrays with one entry per cell.');
    this.#sync();
    const {nx,ny,nz}=this,nxy=nx*ny,t=this.temperature,ax=this.dy*this.dz,ay=this.dx*this.dz,az=this.dx*this.dy;
    let cell=0;
    for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,cell++){
      result.x[cell]=i+1<nx?this.#gx[cell]*(t[cell]-t[cell+1])/ax:0;
      result.y[cell]=j+1<ny?this.#gy[cell]*(t[cell]-t[cell+nx])/ay:0;
      result.z[cell]=k+1<nz?this.#gz[cell]*(t[cell]-t[cell+nxy])/az:0;
    }
    return result;
  }

  #face(i:number,j:number,k:number,face:HeatFace):{cell:number;faceIndex:number;area:number;half:number;neighbour:number;conductance:number} {
    const cell=this.index(i,j,k),faceIndex=FACES.indexOf(face);
    if(faceIndex<0)bad(`face must be one of ${FACES.join(', ')}.`);
    if(!this.solid[cell])bad(`cell (${i}, ${j}, ${k}) is not solid.`);
    const axis=faceIndex>>1,direction=faceIndex&1?1:-1,size=[this.nx,this.ny,this.nz][axis],stride=[1,this.nx,this.nx*this.ny][axis];
    const along=[i,j,k][axis]+direction,next=cell+direction*stride,inside=along>=0&&along<size&&this.solid[next]===1;
    const links=[this.#gx,this.#gy,this.#gz][axis];
    return {cell,faceIndex,area:[this.dy*this.dz,this.dx*this.dz,this.dx*this.dy][axis],half:[this.dx,this.dy,this.dz][axis]/2,
      neighbour:inside?next:-1,conductance:inside?links[direction>0?cell:next]:0};
  }
  /** First record (in sorted order) on a cell face, or -1. */
  #firstRecord(key:number):number {
    const order=this.#recOrder,keys=this.#recKey;
    let lo=0,hi=order.length;
    while(lo<hi){const mid=(lo+hi)>>1;if(keys[order[mid]]<key)lo=mid+1;else hi=mid;}
    return lo<order.length&&keys[order[lo]]===key?lo:-1;
  }

  /** Outward heat flux density in W/m^2 through one face of one solid cell, interior or boundary. */
  cellFaceFlux(i:number,j:number,k:number,face:HeatFace):number {
    const f=this.#face(i,j,k,face),t=this.temperature;
    this.#sync();
    if(f.neighbour>=0)return f.conductance*(t[f.cell]-t[f.neighbour])/f.area;
    const key=f.cell*6+f.faceIndex,order=this.#recOrder;
    let rate=0;
    for(let s=this.#firstRecord(key);s>=0&&s<order.length&&this.#recKey[order[s]]===key;s++)rate+=this.#recA[order[s]]-this.#recG[order[s]]*t[f.cell];
    return -rate/f.area;
  }

  /** Temperature on one face of one solid cell: the interface temperature between two cells, or the
   * surface temperature on a boundary face. */
  faceTemperature(i:number,j:number,k:number,face:HeatFace):number {
    const f=this.#face(i,j,k,face);
    if(f.neighbour<0){
      const s=this.#firstRecord(f.cell*6+f.faceIndex);
      if(s>=0&&this.#bType[this.#recBoundary[this.#recOrder[s]]]===TYPE_TEMPERATURE)return this.#bP0[this.#recBoundary[this.#recOrder[s]]];
    }
    const flux=this.cellFaceFlux(i,j,k,face);
    return this.temperature[f.cell]-flux*f.half/this.#kCell[f.cell];
  }

  /** Everything a later step reads, as a state tree (checkpoint.ts), for exact checkpoints: the temperature and source
   * fields, the boundary values and ledgers, the clock, and the assembled conductances and solver vectors (so that the
   * diagnostics read the same before the next step, too). The grid, materials and boundary layout are not saved: restore
   * into a solver built from the same configuration. */
  saveState():StateObject {
    return {temperature:this.temperature.slice(),heatGeneration:this.heatGeneration.slice(),boundaryEnergy:this.boundaryEnergy.slice(),boundaryStepRates:this.boundaryStepRates.slice(),
      dt:this.#dt,time:this.#time,steps:this.#steps,sourceEnergy:this.#sourceEnergy,iterations:this.#iterations,residual:this.#residual,dirty:this.#dirty,
      bP0:this.#bP0.slice(),bP1:this.#bP1.slice(),kCell:this.#kCell.slice(),gx:this.#gx.slice(),gy:this.#gy.slice(),gz:this.#gz.slice(),sumG:this.#sumG.slice(),
      bG:this.#bG.slice(),bA:this.#bA.slice(),diag:this.#diag.slice(),invDiag:this.#invDiag.slice(),recG:this.#recG.slice(),recA:this.#recA.slice(),delta:this.#delta.slice()};
  }
  /** Put back a state from `saveState()` of a solver built from the same configuration. A state of another grid is refused before anything changes. */
  restoreState(value:StateValue):void {
    if(!value||typeof value!=='object'||Array.isArray(value)||ArrayBuffer.isView(value))throw checkpointError('HeatSolver: the saved state is not an object.');
    const state=value as StateObject;
    const arrays:[string,Float64Array][]=[['temperature',this.temperature],['heatGeneration',this.heatGeneration],['boundaryEnergy',this.boundaryEnergy],['boundaryStepRates',this.boundaryStepRates],
      ['bP0',this.#bP0],['bP1',this.#bP1],['kCell',this.#kCell],['gx',this.#gx],['gy',this.#gy],['gz',this.#gz],['sumG',this.#sumG],['bG',this.#bG],['bA',this.#bA],
      ['diag',this.#diag],['invDiag',this.#invDiag],['recG',this.#recG],['recA',this.#recA],['delta',this.#delta]];
    for(const [key,live] of arrays){
      const saved=state[key];
      if(!(saved instanceof Float64Array)||saved.length!==live.length)throw checkpointError(`HeatSolver: the saved ${key} does not fit this grid (${live.length} values).`);
    }
    for(const key of ['dt','time','steps','sourceEnergy','iterations','residual'])if(typeof state[key]!=='number')throw checkpointError(`HeatSolver: the saved ${key} is not a number.`);
    if(typeof state.dirty!=='boolean')throw checkpointError('HeatSolver: the saved state has no assembly flag.');
    for(const [key,live] of arrays)live.set(state[key] as Float64Array);
    this.#dt=state.dt as number;this.#time=state.time as number;this.#steps=state.steps as number;this.#sourceEnergy=state.sourceEnergy as number;
    this.#iterations=state.iterations as number;this.#residual=state.residual as number;this.#dirty=state.dirty as boolean;
  }

  diagnostics():HeatDiagnostics {
    return {id:this.id,scheme:this.scheme,time:this.#time,steps:this.#steps,cells:this.cells,solidCells:this.solidCells,
      storedEnergy:this.storedEnergy(),boundaryEnergy:Array.from(this.boundaryEnergy),sourceEnergy:this.#sourceEnergy,
      boundaryHeatRates:Array.from(this.boundaryHeatRates()),sourcePower:this.sourcePower(),
      iterations:this.#iterations,residual:this.#residual,explicitStabilityLimit:this.explicitStabilityLimit()};
  }
}

// ---------------------------------------------------------------------------------------------
// One-way thermal -> stress estimates for the fracture link. These read a temperature field and
// return strain and stress for idealised restraint. They do not solve for displacement.

export type ThermalConstraint='bar'|'plate'|'volume';
export interface ThermalStressOptions {
  /** Linear thermal expansion coefficient alpha_T in 1/K: one value or one per cell. */
  readonly expansion:number|ArrayLike<number>;
  /** Young's modulus E in Pa: one value or one per cell. */
  readonly youngsModulus:number|ArrayLike<number>;
  /** Poisson's ratio (0 to below 0.5). Needed for 'plate' and 'volume'. Default 0. */
  readonly poissonRatio?:number;
  /** Stress-free temperature: one value, one per cell, or 'mean' (the mean over the solid cells:
   * a plate that is free to expand as a whole but cannot bend). */
  readonly reference:number|ArrayLike<number>|'mean';
  /** 'bar': restrained along one axis, sigma = -E alpha dT. 'plate': restrained in its plane,
   * sigma = -E alpha dT / (1 - nu). 'volume': restrained in all directions, / (1 - 2 nu). Default 'bar'. */
  readonly constraint?:ThermalConstraint;
  /** Per cell, non-zero where there is solid. Cells outside get NaN and never crack. */
  readonly solid?:ArrayLike<number>;
}
export interface ThermalShockOptions extends ThermalStressOptions {
  /** Tensile strength in Pa: one value or one per cell. */
  readonly tensileStrength:number|ArrayLike<number>;
}
export interface ThermalShockResult {
  /** Restrained thermal stress per cell in Pa, tension positive. */
  stress:Float64Array;
  /** 1 where the tensile stress reaches the tensile strength. */
  cracked:Uint8Array;
  /** Indices of the cracked cells, ascending. */
  crackedCells:Int32Array;
  count:number;
  /** Largest tensile stress in Pa (0 when nothing is in tension). */
  maxTension:number;
  /** Largest stress / strength over the solid cells. At or above 1 means cracking. */
  maxUtilisation:number;
}

function perCell(value:unknown,label:string,n:number,min:number,max:number):(i:number)=>number {
  if(typeof value==='number'){const v=finite(value,label,min,max);return ()=>v;}
  const values=cellValues(value,label,n);
  for(let i=0;i<n;i++)finite(values[i],`${label}[${i}]`,min,max);
  return i=>values[i];
}
function temperatureField(value:unknown):ArrayLike<number> {
  if(!isArrayLike(value)||value.length<1)bad('temperature must be a non-empty array of cell temperatures.');
  return value as ArrayLike<number>;
}
function output(out:Float64Array|undefined,n:number):Float64Array {
  if(out===undefined)return new Float64Array(n);
  if(!(out instanceof Float64Array)||out.length!==n)bad('out must be a Float64Array with one entry per cell.');
  return out;
}
function solidMask(value:unknown,n:number):(i:number)=>boolean {
  if(value===undefined)return ()=>true;
  const values=cellValues(value,'solid',n);
  return i=>Boolean(values[i]);
}
function referenceField(value:unknown,temperature:ArrayLike<number>,isSolid:(i:number)=>boolean):(i:number)=>number {
  const n=temperature.length;
  if(value!=='mean')return perCell(value,'reference',n,-Infinity,Infinity);
  let sum=0,count=0;
  for(let i=0;i<n;i++)if(isSolid(i)){sum+=finite(temperature[i],`temperature[${i}]`);count++;}
  if(count===0)bad('solid leaves no cell to average.');
  const mean=sum/count;
  return ()=>mean;
}

/** Free thermal strain alpha_T (T - T_ref) per cell (dimensionless). */
export function thermalStrain(temperature:ArrayLike<number>,expansion:number|ArrayLike<number>,reference:number|ArrayLike<number>,out?:Float64Array):Float64Array {
  const t=temperatureField(temperature),n=t.length,alpha=perCell(expansion,'expansion',n,-1,1),ref=perCell(reference,'reference',n,-Infinity,Infinity),strain=output(out,n);
  for(let i=0;i<n;i++)strain[i]=alpha(i)*(finite(t[i],`temperature[${i}]`)-ref(i));
  return strain;
}

/** Stress in a body whose thermal strain is fully prevented, per cell in Pa, tension positive:
 * -E alpha_T (T - T_ref) for a bar, divided by (1 - nu) for a plate and (1 - 2 nu) for a volume.
 * A one-way estimate: the temperature field is given, nothing is fed back. */
export function restrainedThermalStress(temperature:ArrayLike<number>,options:ThermalStressOptions,out?:Float64Array):Float64Array {
  const o=record(options,'thermal stress options');
  onlyKeys(o,['expansion','youngsModulus','poissonRatio','reference','constraint','solid','tensileStrength'],'thermal stress options');
  const t=temperatureField(temperature),n=t.length,stress=output(out,n);
  const alpha=perCell(o.expansion,'expansion',n,-1,1),modulus=perCell(o.youngsModulus,'youngsModulus',n,0,Infinity);
  const nu=o.poissonRatio===undefined?0:finite(o.poissonRatio,'poissonRatio',0,.4999),constraint=o.constraint===undefined?'bar':o.constraint;
  if(constraint!=='bar'&&constraint!=='plate'&&constraint!=='volume')bad('constraint must be bar, plate or volume.');
  const factor=constraint==='bar'?1:constraint==='plate'?1/(1-nu):1/(1-2*nu);
  const isSolid=solidMask(o.solid,n),ref=referenceField(o.reference,t,isSolid);
  for(let i=0;i<n;i++)stress[i]=isSolid(i)?-modulus(i)*alpha(i)*(finite(t[i],`temperature[${i}]`)-ref(i))*factor:NaN;
  return stress;
}

/** A simple thermal-shock criterion: a cell cracks when its restrained thermal stress is tensile and
 * reaches the tensile strength. It is a screening estimate; it does not model crack growth, stress
 * relief after cracking, or the real restraint of the part. */
export function thermalShock(temperature:ArrayLike<number>,options:ThermalShockOptions):ThermalShockResult {
  const stress=restrainedThermalStress(temperature,options),n=stress.length;
  const strength=perCell(record(options,'thermal shock options').tensileStrength,'tensileStrength',n,Number.MIN_VALUE,Infinity);
  const cracked=new Uint8Array(n);
  let count=0,maxTension=0,maxUtilisation=-Infinity;
  for(let i=0;i<n;i++){
    const s=stress[i];
    if(Number.isNaN(s))continue;
    const utilisation=s/strength(i);
    if(s>maxTension)maxTension=s;
    if(utilisation>maxUtilisation)maxUtilisation=utilisation;
    if(utilisation>=1){cracked[i]=1;count++;}
  }
  const crackedCells=new Int32Array(count);
  for(let i=0,c=0;i<n;i++)if(cracked[i])crackedCells[c++]=i;
  return {stress,cracked,crackedCells,count,maxTension,maxUtilisation};
}
