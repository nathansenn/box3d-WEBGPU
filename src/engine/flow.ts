/**
 * Flow around and through geometry (float64, JavaScript, deterministic). SI units.
 *
 * `Flow` is a weakly compressible lattice-Boltzmann solver (flow-lattice.ts: D3Q19, regularised collision, Smagorinsky
 * sub-grid model, interpolated bounce-back walls) on a uniform grid of cubic cells, with the solid given by oriented
 * primitives and triangle meshes (flow-geometry.ts). It is an engineering estimate of an incompressible flow:
 *
 *  - the cell size h and the time step dt = latticeSpeed h / referenceSpeed are tied (the reference speed is
 *    `latticeSpeed` cells per step, 0.06 by default, a lattice Mach number of 0.10); the error of the incompressible
 *    limit is of the order of that Mach number squared;
 *  - above a cell Reynolds number U h / nu of a few it is an under-resolved large-eddy simulation: boundary layers are
 *    not resolved and there is no wall model, so friction and the separation from smooth curved walls are estimates,
 *    while the pressure drag of sharp-edged bodies, whose separation the geometry fixes, is predicted far better;
 *  - it is not certified CFD. docs/FLOW.md lists what was measured against what reference, and the limits.
 *
 * The box of fluid cells is closed on each side by a layer of boundary cells ('wall', 'slip', a velocity or a pressure)
 * or joined to the opposite side ('periodic'). Openings of an internal flow are named patches: a disc or a rectangle;
 * the cells behind its plane become an inlet (a velocity, or a flow rate) or an outlet (a pressure).
 *
 * Forces come from the momentum the walls exchange with the fluid, summed per named part; flow rates from the mass
 * that crosses each patch, which is exact on the lattice: what enters minus what leaves is the change of the mass in
 * the box, to round-off, when the walls are 'halfway' (interpolated walls conserve mass to second order only).
 */
import {EngineError} from './contracts.ts';
import {captureFields,restoreFields,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';
import {FlowLattice,FlowTiles,flowEachCell,FLOW_MAX_SPARSE_CELLS,FLOW_SQUEEZED_LINKS,FLOW_FLUID,FLOW_WALL,FLOW_VELOCITY,FLOW_PRESSURE,FLOW_SLIP,FLOW_CX,FLOW_CY,FLOW_CZ,FLOW_WEIGHT,FLOW_LATTICE_ID,FLOW_MAX_CELLS,type FlowLatticePart,type FlowLatticePatch} from './flow-lattice.ts';
import {flowVoxelize,type FlowGrid,type FlowItem,type FlowItemReport,type FlowSurface,type FlowVec3} from './flow-geometry.ts';

/** The solver id written to results (`solver.id`). */
export const FLOW_SOLVER_ID=FLOW_LATTICE_ID;
/** The version of the solver written to results (`solver.version`). */
export const FLOW_SOLVER_VERSION='1.0.0';
/** The sub-grid model `turbulence: 'auto'` picks above its thresholds. */
export const FLOW_AUTO_MODEL:'smagorinsky'|'wale'='smagorinsky';
/** Cell Reynolds number (peak speed x cell / viscosity) above which a laminar Flow with walls warns: above it a laminar
 * pipe or duct loses its developed profile within three viscous times (docs/FLOW.md, laminar pipe). Below it the loss
 * is slower, not absent: at 46 a pipe held within 0.3% for three viscous times and lost 15% by eight. */
export const FLOW_LAMINAR_CELL_REYNOLDS=50;
export {FLOW_MAX_CELLS,FLOW_MAX_SPARSE_CELLS};

/** A Newtonian fluid of constant properties. */
export interface FlowFluid {
  /** kg/m^3 */
  readonly density:number;
  /** Kinematic viscosity, m^2/s. */
  readonly viscosity:number;
}
/** Air and water at 20 C and 1 atm: the density and dynamic viscosity of the material library (docs/MATERIALS.md). */
export const FLOW_FLUIDS:Readonly<Record<'air'|'water',FlowFluid>>=Object.freeze({
  air:Object.freeze({density:1.204,viscosity:1.825e-5/1.204}),
  water:Object.freeze({density:998.207,viscosity:1.0016e-3/998.207}),
});

/** Names of the six sides of the box. */
export type FlowSideName='xMin'|'xMax'|'yMin'|'yMax'|'zMin'|'zMax';
/** The six sides of the box, in the order of their indices. */
export const FLOW_SIDES:readonly FlowSideName[]=Object.freeze(['xMin','xMax','yMin','yMax','zMin','zMax']) as readonly FlowSideName[];
/** What closes a side of the box: a wall, a slip plane, periodic, a velocity inlet or a pressure outlet. */
export type FlowSide=
  |'wall'|'slip'|'periodic'
  /** A no-slip wall, which may slide in its own plane (a moving ground). `part` names it in the force report. */
  |{readonly kind:'wall';readonly velocity?:FlowVec3;readonly part?:string}
  /** A given velocity on the whole side (an inflow, or a far field). `freeStream`: the inflow gives way to the pressure
   * across the side so that the total pressure is even on it, as in a free stream (FlowLatticePatch.totalPressure);
   * for a constant velocity only. Default false. */
  |{readonly kind:'velocity';readonly velocity:FlowVec3|((x:number,y:number,z:number)=>FlowVec3);readonly name?:string;readonly freeStream?:boolean}
  /** A given gauge pressure on the whole side (an outflow). */
  |{readonly kind:'pressure';readonly pressure?:number;readonly name?:string};
/** The shape of an opening: a disc or a rectangle in a plane, with the outward normal of the fluid. */
export type FlowPatchShape=
  /** `normal` points OUT of the fluid, through the opening (the outward normal of the fluid domain). */
  |{readonly kind:'disc';readonly center:FlowVec3;readonly normal:FlowVec3;readonly radius:number}
  |{readonly kind:'rect';readonly center:FlowVec3;readonly normal:FlowVec3;readonly up?:FlowVec3;readonly halfWidth:number;readonly halfHeight:number};
/** An opening of an internal flow: an inlet by flow rate, speed or velocity, or an outlet by pressure or flow rate. */
export interface FlowPatch {
  readonly name:string;
  readonly kind:'inlet'|'outlet';
  readonly shape:FlowPatchShape;
  /** Inlet: the volume flow rate INTO the fluid, m^3/s, or the mean speed into the fluid, m/s, or the velocity vector.
   * One of the three. Outlet: `pressure`, or `flowRate` / `speed` OUT of the fluid. */
  readonly flowRate?:number;readonly speed?:number;readonly velocity?:FlowVec3;
  /** Inlet by flow rate or speed: 'uniform' (default), or 'parabolic': 1 - (r/R)^2 on a disc, (1 - (x/a)^2)(1 - (y/b)^2) on
   * a rectangle, scaled so that the flow rate (or the mean speed) is the one given. */
  readonly profile?:'uniform'|'parabolic';
  /** Outlet: gauge pressure, Pa. Default 0 when neither flowRate nor speed is given. */
  readonly pressure?:number;
}
/** A wall velocity for a part of the geometry: the solid stays where it is (a "frozen" rotor, a belt, a rolling wheel)
 * and its surface moves. */
export interface FlowPartMotion {
  /** m/s */
  readonly velocity?:FlowVec3;
  /** rad/s about `center` (m). */
  readonly angularVelocity?:FlowVec3;readonly center?:FlowVec3;
}
/** An actuator disc: a momentum source spread over the fluid cells of a disc (a fan, a propeller, a turbine as drag). */
export interface FlowActuator {
  readonly name:string;
  readonly center:FlowVec3;
  /** The force on the fluid is along this direction. */
  readonly axis:FlowVec3;
  readonly radius:number;
  /** Thickness of the disc, m. Default (and at least) two cells. */
  readonly thickness?:number;
  /** Force on the fluid, N; or the pressure rise across the disc, Pa (force = pressureJump pi radius^2). One of the two. */
  readonly force?:number;readonly pressureJump?:number;
}
/** An actuator disc as set up: its cells, force, axis and area. */
export interface FlowActuatorInfo {readonly name:string;readonly cells:number;readonly force:number;readonly axis:FlowVec3;readonly area:number}
/** Options of `Flow`: the grid, geometry, fluid, sides, openings, motion, actuators, model and run settings, SI units. */
export interface FlowOptions {
  /** The box of fluid cells: origin (its minimum corner), cell size and counts. */
  readonly grid:FlowGrid;
  readonly geometry?:readonly FlowItem[];
  readonly fluid:FlowFluid;
  /** Default 'wall' on every side. */
  readonly sides?:Partial<Record<FlowSideName,FlowSide>>;
  readonly patches?:readonly FlowPatch[];
  /** Surface velocities of parts, by part name. */
  readonly motion?:Readonly<Record<string,FlowPartMotion>>;
  readonly actuators?:readonly FlowActuator[];
  /** The speed that is `latticeSpeed` cells per step: the largest speed imposed. Sets the time step. */
  readonly referenceSpeed:number;
  /** Default 0.06 (a lattice Mach number of 0.10). */
  readonly latticeSpeed?:number;
  /** 'auto' (default): Smagorinsky when the cell Reynolds number referenceSpeed h / nu exceeds 10 and the Reynolds
   * number of the flow, when `reynolds` gives it, exceeds 2000; else none. */
  readonly turbulence?:'auto'|'none'|'smagorinsky'|'wale';
  /** Steps over which a velocity inlet's mean density is low-passed to give way to sound (FlowLattice); 0 makes inlets
   * hard (the GPU kernel has no absorbing inlets). Default: the time sound takes through the box and back. */
  readonly absorbSteps?:number;
  /** 'auto' (default) is 'regularized'. 'trt' (two relaxation times, laminar flow only) diverged next to inlets, outlets
   * and no-slip walls at relaxation times of 0.501 to 0.51: use it for closed or periodic laminar flows. */
  readonly collision?:'auto'|'regularized'|'trt';
  /** WALE constant Cw. Default 0.5. */
  readonly wale?:number;
  /** Reynolds number of the flow (reference speed, a length of the body or the duct), for the 'auto' rule. */
  readonly reynolds?:number;
  /** Smagorinsky constant. Default 0.16. */
  readonly smagorinsky?:number;
  /** With the sub-grid model on: cells that touch a wall take the viscosity of a power-law wall function (Werner &
   * Wengle) instead of the Smagorinsky formula. Default true. */
  readonly wallFunction?:boolean;
  /** The wall function is used only next to smooth walls: where h times the Laplacian of the signed distance (the
   * curvature of the wall, convex positive) is below this. Next to sharper convex edges the wall is plain bounce-back,
   * so the geometry fixes the separation. Default 0.05 (a convex radius of 20 cells: flat walls, large surfaces and the
   * inside of pipes take it; the cells near an edge or round a small body do not). */
  readonly wallFunctionCurvature?:number;
  /** 'interpolated' (default): the wall is where the geometry puts it on every link; 'halfway': half-way, mass-exact. */
  readonly walls?:'interpolated'|'halfway';
  /** Body force per unit mass, m/s^2 (a pressure gradient that drives a periodic duct). */
  readonly acceleration?:FlowVec3;
  /** Velocity of the fluid at the start, m/s. Default 0. */
  readonly initialVelocity?:FlowVec3;
  /** Steps over which the wall and inlet velocities rise from 0 to their value (smooth start). Default 0. */
  readonly rampSteps?:number;
  /** Cells in front of each pressure side over which the viscosity rises to damp what leaves. Default 0. */
  readonly spongeCells?:number;
  /** Half width, in cells, of the band in which distances to the geometry are exact. Default 4. */
  readonly band?:number;
  /** Keep the surface triangles of the parts (`surfaces`, for surface pressure and drawing). Default true. */
  readonly surfaces?:boolean;
  /** Grow walls thinner than 1.44 cells so that they do not leak. Default true. */
  readonly thicken?:boolean;
  /** 'dense' stores every cell of the box (at most FLOW_MAX_CELLS); 'sparse' stores tiles of FLOW_TILE^3 cells near the
   * cavities only (a pipe network: everything outside the cavities is solid; needs cavity items), so that the box may
   * span up to FLOW_MAX_SPARSE_CELLS cells while at most FLOW_MAX_CELLS are stored. Both give the same bits. 'auto'
   * (default): 'sparse' when the box exceeds FLOW_MAX_CELLS and the geometry has a cavity, else 'dense'. */
  readonly storage?:'auto'|'dense'|'sparse';
}
/** An opening as set up on the lattice: its area, outward normal and what is imposed. */
export interface FlowPatchInfo {
  readonly name:string;readonly kind:'inlet'|'outlet';
  /** Area the lattice gives the patch along its normal, m^2, and the outward normal (out of the fluid). */
  readonly area:number;readonly normal:FlowVec3;
  /** Inlet: the velocity imposed, m/s. Outlet: the pressure, Pa. */
  readonly velocity:FlowVec3|null;readonly pressure:number|null;
  /** Fluid cells that touch the patch. */
  readonly cells:number;
}
/** Fields of the flow in SI units on the lattice (the fluid box plus its boundary layers). */
export interface FlowField {
  readonly grid:FlowGrid;
  /** 1 in fluid cells. */
  readonly fluid:Uint8Array;
  /** m/s; zero in walls, the imposed velocity in inlet cells, the neighbouring fluid's elsewhere. */
  readonly ux:Float32Array;readonly uy:Float32Array;readonly uz:Float32Array;
  /** Gauge pressure, Pa; in cells that are not fluid, the mean of the fluid cells around. */
  readonly pressure:Float32Array;
  /** Signed distance to the geometry, m (positive in the fluid). */
  readonly distance:Float32Array;
  /** Per cell: the index of the opening (in `Flow.patches`) the cell belongs to, or -1. Openings include the velocity
   * and pressure sides of the box. Streamlines end where they enter an opening. */
  readonly opening?:Int16Array;
  /** Sparse storage: the arrays above have one entry per slot of these tiles (FlowTiles.slot), tiles with no storage
   * reading as block 0 (not fluid). Absent or null: one entry per cell, index i + nx (j + ny k). */
  readonly tiles?:FlowTiles|null;
}

const fail=(message:string):never=>{throw new EngineError('INVALID_PAYLOAD',`Flow: ${message}`);};
const isVec=(v:unknown):v is FlowVec3=>Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='number'&&Number.isFinite(x));
const vec=(v:unknown,name:string):FlowVec3=>isVec(v)?v:fail(`${name} must be three finite numbers.`);
const FLOW_FIELDS:FieldOptions={label:'Flow',skip:['grid','lattice','tiles','fluid','dt','cell','latticeSpeed','referenceSpeed','turbulence','smagorinsky','wale','cellReynolds','relaxationTime','parts','patches','voxels','warnings','surfaces','items','solidCells','fluidCells','enclosedCells','forceScale','momentScale','flowScale','pressureScale','velocityScale','rampSteps','kinds','inletVelocity','actuators','actuatorCells','geometryParts','thickening'],
  nested:{}};

/** The flow solver in SI units: a lattice-Boltzmann flow around and through voxelised geometry, with forces per part, flow rates through openings, time averages, fields and exact checkpoints. */
export class Flow {
  /** The lattice: the fluid box plus one layer of boundary cells on every side that is not periodic. */
  readonly grid:FlowGrid;
  readonly lattice:FlowLattice;
  /** Sparse storage of the box (FlowOptions.storage), or null when dense. */
  readonly tiles:FlowTiles|null;
  readonly fluid:FlowFluid;
  readonly dt:number;readonly cell:number;readonly latticeSpeed:number;readonly referenceSpeed:number;
  readonly turbulence:'none'|'smagorinsky'|'wale';readonly smagorinsky:number;readonly wale:number;
  /** referenceSpeed h / nu, and the relaxation time 3 nu dt / h^2 + 1/2 of the lattice. */
  readonly cellReynolds:number;readonly relaxationTime:number;
  /** Names of the parts that take force: the parts of the geometry, then the wall sides. */
  readonly parts:readonly string[];
  /** The first `geometryParts` entries of `parts` are the parts of the geometry; the rest are wall sides of the box. */
  readonly geometryParts:number;
  /** What the voxeliser grew or could not hold: items grown to 1.44 cells and the largest growth (m), cells made solid
   * to close thin closed meshes, and items thinner than a cell in two directions. */
  readonly thickening:{readonly items:number;readonly largest:number;readonly closedCells:number;readonly slender:number};
  readonly patches:readonly FlowPatchInfo[];
  readonly actuators:readonly FlowActuatorInfo[];
  /** Cells of each actuator (indices into the lattice). */
  readonly actuatorCells:readonly Int32Array[];
  readonly surfaces:readonly FlowSurface[];
  readonly items:readonly FlowItemReport[];
  readonly warnings:readonly string[];
  readonly solidCells:number;readonly fluidCells:number;
  /** Fluid cells no inlet or outlet reaches (the inside of a hollow body); they are made solid. */
  readonly enclosedCells:number;
  private readonly forceScale:number;private readonly momentScale:number;private readonly flowScale:number;
  private readonly pressureScale:number;private readonly velocityScale:number;private readonly rampSteps:number;
  private readonly kinds:Uint8Array;private readonly voxels:{distance:Float32Array};private readonly inletVelocity:ReadonlyMap<number,readonly [number,number,number]>|null;
  time=0;
  // Sums since the last takeSums(): force and moment per part (lattice units), mass per patch, steps.
  private sumForce:Float64Array;private sumMoment:Float64Array;private sumMass:Float64Array;private sumWallMass=0;private sumSteps=0;
  // Mean fields: sums of density deviation and velocity over the samples added by accumulate().
  private meanDensity:Float64Array|null=null;private meanUx:Float64Array|null=null;private meanUy:Float64Array|null=null;private meanUz:Float64Array|null=null;
  meanSamples=0;

  constructor(options:FlowOptions){
    const g=options.grid;
    if(!g||!(g.cell>0)||!Number.isFinite(g.cell))fail('grid.cell must be positive.');
    for(const n of [g.nx,g.ny,g.nz])if(!Number.isInteger(n)||n<1)fail('grid.nx, ny and nz must be positive integers.');
    vec(g.origin,'grid.origin');
    if(!options.fluid||!(options.fluid.density>0)||!(options.fluid.viscosity>0))fail('fluid.density and fluid.viscosity must be positive.');
    if(!(options.referenceSpeed>0)||!Number.isFinite(options.referenceSpeed))fail('referenceSpeed must be positive.');
    const uLat=options.latticeSpeed??0.06;
    if(!(uLat>0&&uLat<=0.2))fail('latticeSpeed must be in (0, 0.2].');
    const h=g.cell,sides=FLOW_SIDES.map(name=>options.sides?.[name]??'wall');
    const sideKind=sides.map(s=>typeof s==='string'?s:s.kind);
    for(const s of sideKind)if(s!=='wall'&&s!=='slip'&&s!=='periodic'&&s!=='velocity'&&s!=='pressure')fail(`unknown side kind "${s}".`);
    const periodic:[boolean,boolean,boolean]=[false,false,false];
    for(let a=0;a<3;a++){
      const lo=sideKind[2*a]==='periodic',hi=sideKind[2*a+1]==='periodic';
      if(lo!==hi)fail(`${FLOW_SIDES[2*a]} and ${FLOW_SIDES[2*a+1]} must both be periodic, or neither.`);
      periodic[a]=lo;
    }
    const pad=[periodic[0]?0:1,periodic[1]?0:1,periodic[2]?0:1];
    const nx=g.nx+2*pad[0],ny=g.ny+2*pad[1],nz=g.nz+2*pad[2],cells=nx*ny*nz;
    const storage=options.storage??'auto',hasCavity=(options.geometry??[]).some(it=>it&&typeof it==='object'&&it.role==='cavity');
    if(storage!=='auto'&&storage!=='dense'&&storage!=='sparse')fail(`storage must be 'auto', 'dense' or 'sparse'.`);
    const sparse=storage==='sparse'||(storage==='auto'&&cells>FLOW_MAX_CELLS&&hasCavity);
    if(!sparse&&cells>FLOW_MAX_CELLS)fail(`${cells} cells exceed the limit ${FLOW_MAX_CELLS}${hasCavity?'':' (a box of cavities may be stored sparse, up to '+FLOW_MAX_SPARSE_CELLS+')'}.`);
    if(cells>FLOW_MAX_SPARSE_CELLS)fail(`${cells} cells exceed the limit ${FLOW_MAX_SPARSE_CELLS} of a sparse box.`);
    const origin:FlowVec3=[g.origin[0]-pad[0]*h,g.origin[1]-pad[1]*h,g.origin[2]-pad[2]*h];
    this.grid={origin,cell:h,nx,ny,nz};this.cell=h;this.fluid={density:options.fluid.density,viscosity:options.fluid.viscosity};
    this.latticeSpeed=uLat;this.referenceSpeed=options.referenceSpeed;
    const dt=uLat*h/options.referenceSpeed;this.dt=dt;
    const vScale=h/dt;this.velocityScale=vScale;
    this.pressureScale=this.fluid.density*vScale*vScale/3;
    this.forceScale=this.fluid.density*h*h*h*h/(dt*dt);this.momentScale=this.forceScale*h;this.flowScale=h*h*h/dt;
    const nuLat=this.fluid.viscosity*dt/(h*h);
    this.cellReynolds=options.referenceSpeed*h/this.fluid.viscosity;this.relaxationTime=3*nuLat+0.5;
    const mode=options.turbulence??'auto';
    if(mode!=='auto'&&mode!=='none'&&mode!=='smagorinsky'&&mode!=='wale')fail(`unknown turbulence "${mode}".`);
    this.turbulence=mode==='auto'?(this.cellReynolds>10&&(options.reynolds===undefined||options.reynolds>2000)?FLOW_AUTO_MODEL:'none'):mode;
    this.wale=options.wale??0.5;
    if(!(this.wale>0&&this.wale<=2))fail('wale must be in (0, 2].');
    this.smagorinsky=options.smagorinsky??0.16;
    if(!(this.smagorinsky>0&&this.smagorinsky<=0.5))fail('smagorinsky must be in (0, 0.5].');
    const warnings:string[]=[];

    // ---- geometry ----
    const vox=flowVoxelize(options.geometry??[],this.grid,{band:options.band,surfaces:options.surfaces,thicken:options.thicken,sparse});
    // storage: dense (the slot of a cell is its index i + nx (j + ny k)) or tiles; `each` visits the stored cells
    const tiles=vox.tiles??null,slots=tiles?tiles.slots:cells,S=tiles?(c:number):number=>tiles.slotOf(c):(c:number):number=>c;
    const each=(f:(i:number,j:number,k:number,c:number,s:number)=>void):void=>flowEachCell(nx,ny,nz,tiles,f);
    this.tiles=tiles;
    warnings.push(...vox.warnings);
    this.surfaces=vox.surfaces;this.items=vox.items;this.geometryParts=Math.max(1,vox.parts.length);
    this.thickening={items:vox.thickenedItems,largest:vox.largestThickening,closedCells:vox.closedCells,slender:vox.slenderItems};
    const parts=[...vox.parts];
    for(const name of Object.keys(options.motion??{}))if(!parts.includes(name))fail(`motion names the part "${name}", which the geometry does not have. Parts: ${parts.join(', ')||'none'}.`);
    const lparts:FlowLatticePart[]=parts.map(name=>{
      const mo=options.motion?.[name];if(!mo)return {};
      const v=mo.velocity?vec(mo.velocity,`motion.${name}.velocity`):undefined,om=mo.angularVelocity?vec(mo.angularVelocity,`motion.${name}.angularVelocity`):undefined,ce=mo.center?vec(mo.center,`motion.${name}.center`):[0,0,0];
      return {velocity:v?[v[0]/vScale,v[1]/vScale,v[2]/vScale]:undefined,angularVelocity:om?[om[0]*dt,om[1]*dt,om[2]*dt]:undefined,centre:[(ce[0]-origin[0])/h,(ce[1]-origin[1])/h,(ce[2]-origin[2])/h]};
    });
    const lpatches:FlowLatticePatch[]=[],patchNames:string[]=[],patchKinds:('inlet'|'outlet')[]=[];
    const kind=new Uint8Array(slots),owner=new Int16Array(slots),distance=vox.distance;
    const hasGeometry=(options.geometry?.length??0)>0;
    // geometry and the cells of the fluid box (tiles with no storage read as the solid block 0)
    for(let c=0;c<slots;c++)if(distance[c]<0){kind[c]=FLOW_WALL;owner[c]=vox.part[c]<0?0:vox.part[c];}
    if(hasGeometry&&parts.length===0)parts.push('body'),lparts.push({});
    // sides: the boundary layer where the geometry is not solid. Order of precedence at edges: velocity, wall, pressure, slip.
    const sideOwner=new Int32Array(6).fill(-1),sideProfile:(((x:number,y:number,z:number)=>FlowVec3)|null)[]=[null,null,null,null,null,null];
    // velocity of single inlet cells where a profile is given (cells per step); weight of a cell in a parabolic patch
    let cellVelocity:Map<number,[number,number,number]>|undefined,cellWeight:Map<number,number>|undefined;
    const rank=(s:string):number=>s==='velocity'?3:s==='wall'?2:s==='pressure'?1:0;
    sides.forEach((s,index)=>{
      const k=sideKind[index],name=FLOW_SIDES[index];
      if(k==='wall'){
        const spec=typeof s==='string'?{kind:'wall' as const}:s as {kind:'wall';velocity?:FlowVec3;part?:string};
        const v=spec.velocity?vec(spec.velocity,`${name}.velocity`):undefined,partName=spec.part??name;
        if(v&&Math.abs(v[index>>1])>1e-12*Math.hypot(v[0],v[1],v[2]))fail(`${name}: a wall can only slide in its own plane.`);
        let p=parts.indexOf(partName);
        if(p<0){p=parts.length;parts.push(partName);lparts.push(v?{velocity:[v[0]/vScale,v[1]/vScale,v[2]/vScale]}:{});}
        else if(v)fail(`${name}: the part "${partName}" already exists; a sliding wall needs its own part name.`);
        sideOwner[index]=p;
      }else if(k==='velocity'){
        const spec=s as {kind:'velocity';velocity:FlowVec3|((x:number,y:number,z:number)=>FlowVec3);name?:string;freeStream?:boolean};
        sideOwner[index]=lpatches.length;patchNames.push(spec.name??name);
        if(typeof spec.velocity==='function'){sideProfile[index]=spec.velocity;lpatches.push({velocity:[0,0,0]});patchKinds.push('inlet');}
        else{
          const v=vec(spec.velocity,`${name}.velocity`);lpatches.push({velocity:[v[0]/vScale,v[1]/vScale,v[2]/vScale],...(spec.freeStream===true?{totalPressure:true}:{})});
          const inward=(index&1)===0?v[index>>1]:-v[index>>1];patchKinds.push(inward>=0?'inlet':'outlet');
        }
      }else if(k==='pressure'){
        const spec=s as {kind:'pressure';pressure?:number;name?:string},p=spec.pressure??0;
        if(!Number.isFinite(p))fail(`${name}.pressure must be finite.`);
        sideOwner[index]=lpatches.length;lpatches.push({density:1+p/this.pressureScale});patchNames.push(spec.name??name);patchKinds.push('outlet');
      }
    });
    each((i,j,k,c,sc)=>{
      let best=-1;
      const consider=(index:number):void=>{if(best<0||rank(sideKind[index])>rank(sideKind[best]))best=index;};
      if(pad[0]){if(i===0)consider(0);else if(i===nx-1)consider(1);}
      if(pad[1]){if(j===0)consider(2);else if(j===ny-1)consider(3);}
      if(pad[2]){if(k===0)consider(4);else if(k===nz-1)consider(5);}
      if(best<0)return;
      if(kind[sc]===FLOW_WALL)return; // the geometry reaches through the side
      const sk=sideKind[best];
      kind[sc]=sk==='wall'?FLOW_WALL:sk==='slip'?FLOW_SLIP:sk==='velocity'?FLOW_VELOCITY:FLOW_PRESSURE;
      owner[sc]=sk==='slip'?0:sideOwner[best];
      const profile=sideProfile[best];
      if(sk==='velocity'&&profile){
        // the velocity on the side of the box, in front of this boundary cell
        const pos=[origin[0]+(i+0.5)*h,origin[1]+(j+0.5)*h,origin[2]+(k+0.5)*h],a=best>>1;pos[a]=(best&1)===0?origin[a]+h:origin[a]+([nx,ny,nz][a]-1)*h;
        const v=vec(profile(pos[0],pos[1],pos[2]),`${FLOW_SIDES[best]}.velocity()`);
        (cellVelocity??=new Map()).set(c,[v[0]/vScale,v[1]/vScale,v[2]/vScale]);
      }
    });
    // patches: the cells behind the plane of each opening
    const backCells:number[]=[];
    const patchNormals:FlowVec3[]=lpatches.map((_,i)=>{const side=sideOwner.indexOf(i),a=side>>1,n:[number,number,number]=[0,0,0];n[a]=(side&1)===0?1:-1;return n;});
    const pendingRates:{index:number;patch:FlowPatch;normal:FlowVec3}[]=[],patchCentres:(FlowVec3|null)[]=lpatches.map(()=>null);
    for(const patch of options.patches??[]){
      if(!patch||typeof patch.name!=='string'||patch.name.length===0)fail('a patch needs a name.');
      if(patchNames.includes(patch.name))fail(`two patches are named "${patch.name}".`);
      if(patch.kind!=='inlet'&&patch.kind!=='outlet')fail(`patch "${patch.name}": kind must be 'inlet' or 'outlet'.`);
      const sh=patch.shape;
      if(!sh||(sh.kind!=='disc'&&sh.kind!=='rect'))fail(`patch "${patch.name}": shape.kind must be 'disc' or 'rect'.`);
      const ce=vec(sh.center,`patch "${patch.name}": center`),nr=vec(sh.normal,`patch "${patch.name}": normal`),nl=Math.hypot(nr[0],nr[1],nr[2]);
      if(!(nl>0))fail(`patch "${patch.name}": normal must not be zero.`);
      // n points into the fluid (the study gives the outward normal)
      const n:FlowVec3=[-nr[0]/nl,-nr[1]/nl,-nr[2]/nl];
      const parabolic=patch.profile==='parabolic';
      if(patch.profile!==undefined&&patch.profile!=='uniform'&&!parabolic)fail(`patch "${patch.name}": profile must be 'uniform' or 'parabolic'.`);
      // weight of a point of the plane: 0 outside the shape, else 1 or the parabolic profile
      let inside:(x:number,y:number,z:number)=>number;
      if(sh.kind==='disc'){
        if(!(sh.radius>0))fail(`patch "${patch.name}": radius must be positive.`);
        const r2=sh.radius*sh.radius;
        inside=(x,y,z)=>{const s=x*n[0]+y*n[1]+z*n[2],px=x-s*n[0],py=y-s*n[1],pz=z-s*n[2],rr=px*px+py*py+pz*pz;return rr<=r2?(parabolic?Math.max(1-rr/r2,1e-3):1):0;};
      }else{
        if(!(sh.halfWidth>0&&sh.halfHeight>0))fail(`patch "${patch.name}": halfWidth and halfHeight must be positive.`);
        let up:FlowVec3=sh.up?vec(sh.up,`patch "${patch.name}": up`):(Math.abs(n[1])<0.9?[0,1,0]:[1,0,0]);
        const d=up[0]*n[0]+up[1]*n[1]+up[2]*n[2];up=[up[0]-d*n[0],up[1]-d*n[1],up[2]-d*n[2]];
        const ul=Math.hypot(up[0],up[1],up[2]);if(!(ul>1e-9))fail(`patch "${patch.name}": up is parallel to the normal.`);
        up=[up[0]/ul,up[1]/ul,up[2]/ul];
        const w:FlowVec3=[up[1]*n[2]-up[2]*n[1],up[2]*n[0]-up[0]*n[2],up[0]*n[1]-up[1]*n[0]],hw=sh.halfWidth,hh=sh.halfHeight;
        inside=(x,y,z)=>{const a=(x*w[0]+y*w[1]+z*w[2])/hw,b=(x*up[0]+y*up[1]+z*up[2])/hh;return Math.abs(a)<=1&&Math.abs(b)<=1?(parabolic?Math.max((1-a*a)*(1-b*b),1e-3):1):0;};
      }
      const index=lpatches.length;let marked=0;
      each((i,j,k,c,sc)=>{
        const x=origin[0]+(i+0.5)*h-ce[0],y=origin[1]+(j+0.5)*h-ce[1],z=origin[2]+(k+0.5)*h-ce[2],s=x*n[0]+y*n[1]+z*n[2];
        if(s>1e-9*h||s<-2.5*h)return;
        const wt=inside(x,y,z);if(wt===0)return;
        kind[sc]=patch.kind==='inlet'||patch.flowRate!==undefined||patch.speed!==undefined||patch.velocity!==undefined?FLOW_VELOCITY:FLOW_PRESSURE;owner[sc]=index;marked++;
        if(parabolic&&kind[sc]===FLOW_VELOCITY)(cellWeight??=new Map()).set(c,wt);
      });
      if(marked===0)fail(`patch "${patch.name}" covers no cell: its plane must lie in the box or on one of its sides, with the normal pointing out of the fluid.`);
      patchNames.push(patch.name);patchKinds.push(patch.kind);patchNormals.push(n);patchCentres.push(ce);
      const given=[patch.flowRate,patch.speed,patch.velocity].filter(v=>v!==undefined).length;
      if(patch.kind==='inlet'||given>0){
        if(given!==1)fail(`${patch.kind} "${patch.name}" needs exactly one of flowRate, speed and velocity${patch.kind==='outlet'?', or a pressure':''}.`);
        if(patch.kind==='outlet'&&patch.pressure!==undefined)fail(`outlet "${patch.name}" has both a pressure and a flow.`);
        if(parabolic&&patch.velocity)fail(`${patch.kind} "${patch.name}": a parabolic profile needs flowRate or speed, not a velocity vector.`);
        if(patch.velocity){const v=vec(patch.velocity,`${patch.kind} "${patch.name}": velocity`);lpatches.push({velocity:[v[0]/vScale,v[1]/vScale,v[2]/vScale]});}
        else{lpatches.push({velocity:[0,0,0]});pendingRates.push({index,patch,normal:n});}
      }else{
        const p=patch.pressure??0;if(!Number.isFinite(p))fail(`outlet "${patch.name}": pressure must be finite.`);
        lpatches.push({density:1+p/this.pressureScale});
      }
    }
    // an opening is open to the fluid in front of it only: cells of its slab that touch no fluid cell in front of the
    // plane are wall, so that fluid behind the opening (outside a pipe that ends in the box) is not fed by its back
    each((i,j,k,c,sc)=>{
      if(kind[sc]!==FLOW_VELOCITY&&kind[sc]!==FLOW_PRESSURE)return;
      const ce=patchCentres[owner[sc]];if(!ce)return;
      const n=patchNormals[owner[sc]];let front=false;
      for(let d=1;d<19&&!front;d++){
        const a=i+FLOW_CX[d],b=j+FLOW_CY[d],e=k+FLOW_CZ[d];if(a<0||b<0||e<0||a>=nx||b>=ny||e>=nz)continue;
        if(kind[S(a+nx*(b+ny*e))]!==FLOW_FLUID)continue;
        if((origin[0]+(a+0.5)*h-ce[0])*n[0]+(origin[1]+(b+0.5)*h-ce[1])*n[1]+(origin[2]+(e+0.5)*h-ce[2])*n[2]>0)front=true;
      }
      if(!front)backCells.push(sc);
    });
    for(const c of backCells){kind[c]=FLOW_WALL;owner[c]=vox.part[c]<0?0:vox.part[c];}
    // cells no opening reaches become solid
    let enclosed=0;
    if(lpatches.length>0){
      const reached=new Uint8Array(slots),stack:number[]=[];
      const wrap=(v:number,n:number,p:boolean):number=>v<0||v>=n?(p?(v+n)%n:-1):v;
      const visit=(i:number,j:number,k:number):void=>{
        const a=wrap(i,nx,periodic[0]),b=wrap(j,ny,periodic[1]),c=wrap(k,nz,periodic[2]);if(a<0||b<0||c<0)return;
        const idx=a+nx*(b+ny*c),si=S(idx);if(kind[si]!==FLOW_FLUID||reached[si])return;reached[si]=1;stack.push(idx);
      };
      each((i,j,k,_c,sc)=>{
        if(kind[sc]!==FLOW_VELOCITY&&kind[sc]!==FLOW_PRESSURE)return;
        for(let d=1;d<19;d++)visit(i+FLOW_CX[d],j+FLOW_CY[d],k+FLOW_CZ[d]);
      });
      while(stack.length>0){const idx=stack.pop()!,i=idx%nx,j=Math.floor(idx/nx)%ny,k=Math.floor(idx/(nx*ny));for(let d=1;d<19;d++)visit(i+FLOW_CX[d],j+FLOW_CY[d],k+FLOW_CZ[d]);}
      for(let c=0;c<slots;c++)if(kind[c]===FLOW_FLUID&&!reached[c]){
        if(parts.length===0){parts.push('body');lparts.push({});}
        kind[c]=FLOW_WALL;owner[c]=vox.part[c]<0?0:vox.part[c];enclosed++;
      }
    }
    this.enclosedCells=enclosed;
    if(parts.length===0){parts.push('body');lparts.push({});}
    // areas of the patches on the lattice, and the speeds of the inlets given by flow rate
    const areaVec=new Float64Array(3*lpatches.length),weighted=new Float64Array(3*lpatches.length),touch=new Int32Array(lpatches.length);
    // the opening cells in the order of their cell index, so that the sums are the same dense or tiled
    const openings:number[]=[];
    each((_i,_j,_k,c,sc)=>{if(kind[sc]===FLOW_VELOCITY||kind[sc]===FLOW_PRESSURE)openings.push(c);});
    if(tiles)openings.sort((x,y)=>x-y);
    for(const c of openings){
      const i=c%nx,j=Math.floor(c/nx)%ny,k=Math.floor(c/(nx*ny)),p=owner[S(c)];
      for(let d=1;d<19;d++){
        let a=i+FLOW_CX[d],b=j+FLOW_CY[d],e=k+FLOW_CZ[d];
        if(a<0||a>=nx){if(!periodic[0])continue;a=(a+nx)%nx;}
        if(b<0||b>=ny){if(!periodic[1])continue;b=(b+ny)%ny;}
        if(e<0||e>=nz){if(!periodic[2])continue;e=(e+nz)%nz;}
        if(kind[S(a+nx*(b+ny*e))]!==FLOW_FLUID)continue;
        const w=6*FLOW_WEIGHT[d];areaVec[3*p]+=w*FLOW_CX[d];areaVec[3*p+1]+=w*FLOW_CY[d];areaVec[3*p+2]+=w*FLOW_CZ[d];
        if(cellWeight){const ww=w*(cellWeight.get(c)??0);weighted[3*p]+=ww*FLOW_CX[d];weighted[3*p+1]+=ww*FLOW_CY[d];weighted[3*p+2]+=ww*FLOW_CZ[d];}
        if(d<=6)touch[p]++;
      }
    }
    const infos:FlowPatchInfo[]=[];
    for(let p=0;p<lpatches.length;p++){
      const n=patchNormals[p],area=(areaVec[3*p]*n[0]+areaVec[3*p+1]*n[1]+areaVec[3*p+2]*n[2])*h*h;
      const pending=pendingRates.find(r=>r.index===p);
      if(pending){
        if(!(area>0))fail(`inlet "${pending.patch.name}" touches no fluid cell.`);
        // into the fluid for an inlet, out of it for an outlet
        const speed=(pending.patch.kind==='inlet'?1:-1)*(pending.patch.flowRate!==undefined?pending.patch.flowRate/area:pending.patch.speed!);
        if(!Number.isFinite(speed))fail(`${pending.patch.kind} "${pending.patch.name}": flowRate or speed must be finite.`);
        lpatches[p]={velocity:[speed*n[0]/vScale,speed*n[1]/vScale,speed*n[2]/vScale]};
        if(pending.patch.profile==='parabolic'&&cellWeight){
          // every cell of the patch takes its weight times the factor that keeps the flow rate
          const wArea=(weighted[3*p]*n[0]+weighted[3*p+1]*n[1]+weighted[3*p+2]*n[2])*h*h,factor=speed*area/wArea/vScale;
          cellVelocity??=new Map();
          for(const [c,wt] of cellWeight)if(kind[S(c)]===FLOW_VELOCITY&&owner[S(c)]===p){const f=factor*wt;cellVelocity.set(c,[f*n[0],f*n[1],f*n[2]]);}
        }
      }
      if(touch[p]===0)warnings.push(`patch "${patchNames[p]}" touches no fluid cell: nothing flows through it.`);
      const lv=lpatches[p].velocity,ld=lpatches[p].density;
      infos.push({name:patchNames[p],kind:patchKinds[p],area,normal:[-n[0],-n[1],-n[2]],velocity:lv?[lv[0]*vScale,lv[1]*vScale,lv[2]*vScale]:null,pressure:ld!==undefined?(ld-1)*this.pressureScale:null,cells:touch[p]});
      if(lv){const s=Math.hypot(lv[0],lv[1],lv[2]);if(s>0.3)fail(`patch "${patchNames[p]}": its speed ${(s*vScale).toPrecision(3)} m/s is ${(s/uLat).toFixed(1)} times referenceSpeed; raise referenceSpeed.`);
        else if(s>1.5*uLat+1e-12)warnings.push(`patch "${patchNames[p]}": its speed ${(s*vScale).toPrecision(3)} m/s exceeds referenceSpeed ${options.referenceSpeed.toPrecision(3)} m/s; the lattice Mach number there is ${(s*Math.sqrt(3)).toFixed(2)}.`);}
    }
    this.parts=parts;this.patches=infos;this.inletVelocity=cellVelocity??null;
    // sponge in front of the pressure sides
    let extra:Float32Array|undefined;
    const sponge=options.spongeCells??0;
    if(sponge>0){
      extra=new Float32Array(slots);
      const ex=extra;
      each((i,j,k,_c,c)=>{
        let s=0;const idx=[i,j,k],n=[nx,ny,nz];
        for(let side=0;side<6;side++){
          if(sideKind[side]!=='pressure')continue;
          const a=side>>1,depth=(side&1)===0?idx[a]:n[a]-1-idx[a],t=1-depth/sponge;
          if(t>s)s=t;
        }
        if(s>0)ex[c]=0.1*s*s; // up to tau = 0.8 at the side
      });
    }
    // actuator discs
    const actuators:FlowActuatorInfo[]=[],actuatorCells:Int32Array[]=[],fCells:number[]=[],fValues:number[]=[];
    for(const act of options.actuators??[]){
      if(!act||typeof act.name!=='string'||act.name.length===0)fail('an actuator needs a name.');
      const ce=vec(act.center,`actuator "${act.name}": center`),ax=vec(act.axis,`actuator "${act.name}": axis`),al=Math.hypot(ax[0],ax[1],ax[2]);
      if(!(al>0))fail(`actuator "${act.name}": axis must not be zero.`);
      if(!(act.radius>0))fail(`actuator "${act.name}": radius must be positive.`);
      if((act.force===undefined)===(act.pressureJump===undefined))fail(`actuator "${act.name}" needs exactly one of force and pressureJump.`);
      const n:FlowVec3=[ax[0]/al,ax[1]/al,ax[2]/al],half=Math.max(act.thickness??0,2*h)/2,area=Math.PI*act.radius*act.radius,total=act.force!==undefined?act.force:act.pressureJump!*area;
      if(!Number.isFinite(total))fail(`actuator "${act.name}": force or pressureJump must be finite.`);
      const list:number[]=[];
      each((i,j,k,c,sc)=>{
        if(kind[sc]!==FLOW_FLUID)return;
        const x=origin[0]+(i+0.5)*h-ce[0],y=origin[1]+(j+0.5)*h-ce[1],z=origin[2]+(k+0.5)*h-ce[2],sa=x*n[0]+y*n[1]+z*n[2];
        if(Math.abs(sa)>half)return;
        const px=x-sa*n[0],py=y-sa*n[1],pz=z-sa*n[2];if(px*px+py*py+pz*pz>act.radius*act.radius)return;
        list.push(c);
      });
      if(list.length===0)fail(`actuator "${act.name}" holds no fluid cell.`);
      list.sort((a,b)=>a-b);
      const per=total/this.forceScale/list.length;
      for(const c of list){fCells.push(c);fValues.push(per*n[0],per*n[1],per*n[2]);}
      actuators.push({name:act.name,cells:list.length,force:total,axis:n,area});actuatorCells.push(Int32Array.from(list));
    }
    this.actuators=actuators;this.actuatorCells=actuatorCells;
    const acc=options.acceleration?vec(options.acceleration,'acceleration'):[0,0,0],u0=options.initialVelocity?vec(options.initialVelocity,'initialVelocity'):[0,0,0];
    const aScale=dt*dt/h;
    // where the wall function may be used: next to walls whose convex curvature is under wallFunctionCurvature / h
    let wfMask:Uint8Array|undefined;
    if(hasGeometry&&this.turbulence!=='none'&&options.wallFunction!==false){
      const limit=options.wallFunctionCurvature??0.05,mask=new Uint8Array(slots).fill(1);wfMask=mask;
      each((i,j,k,c,sc)=>{
        if(kind[sc]!==FLOW_FLUID)return;
        const d=distance[sc];if(!(d<2*h))return;
        let lap=0;
        if(i>0)lap+=distance[S(c-1)]-d;if(i<nx-1)lap+=distance[S(c+1)]-d;
        if(j>0)lap+=distance[S(c-nx)]-d;if(j<ny-1)lap+=distance[S(c+nx)]-d;
        if(k>0)lap+=distance[S(c-nx*ny)]-d;if(k<nz-1)lap+=distance[S(c+nx*ny)]-d;
        if(lap/h>limit)mask[sc]=0;
      });
    }
    this.lattice=new FlowLattice({wallFunctionMask:wfMask,nx,ny,nz,tiles,periodic,kind,owner,distance,walls:options.walls??'interpolated',parts:lparts,patches:lpatches,viscosity:nuLat,
      smagorinsky:this.turbulence==='smagorinsky'?this.smagorinsky:0,absorbSteps:options.absorbSteps,wale:this.turbulence==='wale'?this.wale:0,collision:(options.collision??'auto')==='auto'?'regularized':options.collision as 'trt',wallFunction:options.wallFunction,force:[acc[0]*aScale,acc[1]*aScale,acc[2]*aScale],initialVelocity:[u0[0]/vScale,u0[1]/vScale,u0[2]/vScale],extraViscosity:extra,cellVelocity,
      forceCells:fCells.length?Int32Array.from(fCells):undefined,forceValues:fCells.length?Float64Array.from(fValues):undefined});
    this.kinds=kind;this.voxels={distance:vox.distance};
    this.solidCells=cells-this.lattice.fluidCells;this.fluidCells=this.lattice.fluidCells;
    this.rampSteps=Math.max(0,Math.floor(options.rampSteps??0));
    if(this.rampSteps>0)this.lattice.ramp=0;
    if(this.relaxationTime<0.5005&&this.turbulence==='none')warnings.push(`the relaxation time ${this.relaxationTime.toFixed(5)} is within 0.0005 of 1/2 and the sub-grid model is off: the run is likely to be unstable.`);
    // Measured (packages/box3d-kit/test/flow-scenarios.mjs laminarPipe, docs/FLOW.md): at high cell Reynolds numbers a
    // laminar pipe, and a square duct aligned with the grid, grow a steady secondary flow in the section that takes 15 to
    // 45% of the flow rate; the relaxation time, the wall rule and the collision variants tried do not change it.
    if(this.turbulence==='none'&&this.cellReynolds>FLOW_LAMINAR_CELL_REYNOLDS&&cells>this.lattice.fluidCells)warnings.push(`laminar run at a cell Reynolds number of ${this.cellReynolds.toFixed(0)} (referenceSpeed x cell / viscosity, the peak speed): above about ${FLOW_LAMINAR_CELL_REYNOLDS} a duct or pipe develops a spurious secondary flow that can take 15 to 45% of the flow rate (a laminar pipe at Re 1107 was not held within 10% for long runs at any resolution tried, up to 48 cells across). Cells of at most ${(FLOW_LAMINAR_CELL_REYNOLDS*this.fluid.viscosity/options.referenceSpeed).toPrecision(3)} m keep the cell Reynolds number under the limit.`);
    if(this.lattice.squeezedCells>0&&(options.walls??'interpolated')==='interpolated')warnings.push(`${this.lattice.squeezedCells} fluid cell(s) have ${FLOW_SQUEEZED_LINKS} or more of their 18 links on a wall (slivers in corners and gaps the grid does not resolve); their walls are half-way, not interpolated, which keeps them stable but places those walls to half a cell.`);
    if(this.relaxationTime>2)warnings.push(`the relaxation time ${this.relaxationTime.toFixed(2)} is above 2 (a very viscous flow on this grid): the time step is large for the viscosity; lower latticeSpeed.`);
    if(this.fluidCells===0)fail('there is no fluid cell.');
    this.warnings=warnings;
    this.sumForce=new Float64Array(3*parts.length);this.sumMoment=new Float64Array(3*parts.length);this.sumMass=new Float64Array(Math.max(1,lpatches.length));
  }

  get stepCount():number{return this.lattice.stepCount;}
  /** Signed distance to the geometry at the cell centres of the lattice, metres (positive in the fluid). */
  get distance():Float32Array{return this.voxels.distance;}

  /** Advance `steps` time steps. */
  step(steps=1):void{
    const L=this.lattice,sf=this.sumForce,sm=this.sumMoment,ms=this.sumMass,pf=L.partForce,pm=L.partMoment,pmass=L.patchMass,np=sf.length,nq=this.patches.length;
    for(let s=0;s<steps;s++){
      if(this.rampSteps>0){const t=(L.stepCount+1)/this.rampSteps;L.ramp=t>=1?1:t*t*(3-2*t);}
      L.step();
      for(let i=0;i<np;i++){sf[i]+=pf[i];sm[i]+=pm[i];}
      for(let i=0;i<nq;i++)ms[i]+=pmass[i];
      this.sumWallMass+=L.wallMass;this.sumSteps++;
    }
    this.time=L.stepCount*this.dt;
  }

  /** Multiply the fluid's viscosity by `k` from the next step on (k >= 1, at most a relaxation time of 1.5): a start-up
   * aid for laminar flows, whose developed profile does not depend on the viscosity. 1 restores the fluid's own. */
  setViscosityScale(k:number):void{
    if(!(k>=1)||!Number.isFinite(k))fail('the viscosity scale must be at least 1.');
    this.lattice.viscosityScale=Math.min(k,(1.5-0.5)/3/this.lattice.viscosity);
  }
  /** Force (N) and moment about `about` (N m) that a uniform gauge pressure of 1 Pa exerts on every part: zero for a
   * closed body in the fluid; for a body on the ground, its footprint. Subtract `p` times it from the forces to refer
   * them to the static pressure `p` (the free stream's) instead of the outlet's. */
  pressureArea(about:FlowVec3=[0,0,0]):{name:string;force:[number,number,number];moment:[number,number,number]}[]{
    // a lattice pressure p_l on the links gives p_l times the wetted sums; 1 Pa is h^2 / forceScale of lattice force
    const {force,moment}=this.lattice.wettedArea(),k=this.cell*this.cell/this.forceScale;
    return this.scaleForces(force.map(v=>v*k),moment.map(v=>v*k),1,about);
  }
  /** Force (N) and moment about `about` (N m) on every part in the last step. */
  forces(about:FlowVec3=[0,0,0]):{name:string;force:[number,number,number];moment:[number,number,number]}[]{
    return this.scaleForces(this.lattice.partForce,this.lattice.partMoment,1,about);
  }
  private scaleForces(F:Float64Array,M:Float64Array,steps:number,about:FlowVec3):{name:string;force:[number,number,number];moment:[number,number,number]}[]{
    const fs=this.forceScale/steps,msc=this.momentScale/steps,o=this.grid.origin,rx=about[0]-o[0],ry=about[1]-o[1],rz=about[2]-o[2];
    return this.parts.map((name,p)=>{
      const fx=F[3*p]*fs,fy=F[3*p+1]*fs,fz=F[3*p+2]*fs;
      return {name,force:[fx,fy,fz] as [number,number,number],moment:[M[3*p]*msc-(ry*fz-rz*fy),M[3*p+1]*msc-(rz*fx-rx*fz),M[3*p+2]*msc-(rx*fy-ry*fx)] as [number,number,number]};
    });
  }
  /** Means since the last call (or the start): force and moment per part, volume flow rate into the box per patch
   * (m^3/s, negative when the fluid leaves), the flow rate lost through interpolated walls, and the number of steps.
   * Resets the sums. */
  takeSums(about:FlowVec3=[0,0,0]):{steps:number;parts:{name:string;force:[number,number,number];moment:[number,number,number]}[];flowRates:number[];wallFlowRate:number}{
    const steps=Math.max(1,this.sumSteps),parts=this.scaleForces(this.sumForce,this.sumMoment,steps,about);
    const flowRates=this.patches.map((_,i)=>this.sumMass[i]*this.flowScale/steps),wallFlowRate=this.sumWallMass*this.flowScale/steps,taken=this.sumSteps;
    this.sumForce.fill(0);this.sumMoment.fill(0);this.sumMass.fill(0);this.sumWallMass=0;this.sumSteps=0;
    return {steps:taken,parts,flowRates,wallFlowRate};
  }
  /** Volume of fluid in the box in excess of the fluid at rest, m^3 (the lattice mass over the reference density). */
  excessVolume():number{return this.lattice.excessMass()*this.cell*this.cell*this.cell;}
  /** Largest speed in the last step, m/s. */
  maxSpeed():number{
    const {ux,uy,uz,fluidCells}=this.lattice;let m=0;
    for(let c=0;c<fluidCells;c++){const s=ux[c]*ux[c]+uy[c]*uy[c]+uz[c]*uz[c];if(s>m)m=s;}
    return Math.sqrt(m)*this.velocityScale;
  }
  /** False when the run has blown up (a density or velocity that is not finite, or a speed above the sound speed). */
  healthy():boolean{return this.lattice.healthy();}

  /** Add the fields of the last step to the time averages. */
  accumulate():void{
    const L=this.lattice,n=L.fluidCells;
    if(!this.meanDensity){this.meanDensity=new Float64Array(n);this.meanUx=new Float64Array(n);this.meanUy=new Float64Array(n);this.meanUz=new Float64Array(n);}
    const md=this.meanDensity,mx=this.meanUx!,my=this.meanUy!,mz=this.meanUz!,d=L.density,ux=L.ux,uy=L.uy,uz=L.uz;
    for(let c=0;c<n;c++){md[c]+=d[c];mx[c]+=ux[c];my[c]+=uy[c];mz[c]+=uz[c];}
    this.meanSamples++;
  }
  /** Forget the time averages. */
  resetMean():void{this.meanDensity?.fill(0);this.meanUx?.fill(0);this.meanUy?.fill(0);this.meanUz?.fill(0);this.meanSamples=0;}

  /** The fields in SI units: of the last step, or the time average (`mean`) of the samples added by `accumulate()`. */
  field(mean=false):FlowField{
    const L=this.lattice,n=L.cells,{nx,ny,nz}=this.grid,kind=this.kinds;
    if(mean&&this.meanSamples===0)fail('field(true): no sample was accumulated.');
    const w=mean?1/this.meanSamples:1,sd=mean?this.meanDensity!:L.density,sx=mean?this.meanUx!:L.ux,sy=mean?this.meanUy!:L.uy,sz=mean?this.meanUz!:L.uz;
    const vs=this.velocityScale*w,ps=this.pressureScale*w;
    const fluid=new Uint8Array(n),ux=new Float32Array(n),uy=new Float32Array(n),uz=new Float32Array(n),pressure=new Float32Array(n);
    const cellOf=L.cellOf,tiles=this.tiles,S=tiles?(c:number):number=>tiles.slotOf(c):(c:number):number=>c;
    for(let a=0;a<L.fluidCells;a++){const c=S(cellOf[a]);fluid[c]=1;ux[c]=sx[a]*vs;uy[c]=sy[a]*vs;uz[c]=sz[a]*vs;pressure[c]=sd[a]*ps;}
    // cells that are not fluid: pressure from the fluid around; velocity zero in walls, imposed in inlets, copied elsewhere
    const per=L.periodic;
    flowEachCell(nx,ny,nz,tiles,(i,j,k,g,c)=>{
      if(fluid[c])return;
      let count=0,p=0,vx=0,vy=0,vz=0;
      for(let d=1;d<19;d++){
        let a=i+FLOW_CX[d],b=j+FLOW_CY[d],e=k+FLOW_CZ[d];
        if(a<0||a>=nx){if(!per[0])continue;a=(a+nx)%nx;}
        if(b<0||b>=ny){if(!per[1])continue;b=(b+ny)%ny;}
        if(e<0||e>=nz){if(!per[2])continue;e=(e+nz)%nz;}
        const q=S(a+nx*(b+ny*e));if(!fluid[q])continue;
        count++;p+=pressure[q];vx+=ux[q];vy+=uy[q];vz+=uz[q];
      }
      if(count===0)return;
      pressure[c]=p/count;
      const kc=kind[c];
      if(kc===FLOW_VELOCITY){
        const iv=this.inletVelocity,sc=this.velocityScale;
        const pv=iv?.get(g);
        if(pv){ux[c]=pv[0]*sc;uy[c]=pv[1]*sc;uz[c]=pv[2]*sc;}else{const v=this.patches[L.owner[c]].velocity!;ux[c]=v[0];uy[c]=v[1];uz[c]=v[2];}
      }
      else if(kc!==FLOW_WALL){ux[c]=vx/count;uy[c]=vy/count;uz[c]=vz/count;}
    });
    const opening=new Int16Array(n).fill(-1);
    for(let c=0;c<n;c++)if(kind[c]===FLOW_VELOCITY||kind[c]===FLOW_PRESSURE)opening[c]=L.owner[c];
    return {grid:this.grid,fluid,ux,uy,uz,pressure,distance:this.voxels.distance,opening,...(tiles?{tiles}:{})};
  }

  /** The state of the run (populations, sums, averages, time). Restore it into a Flow built with the same options. */
  saveState():StateObject{return {...captureFields(this,FLOW_FIELDS),lattice:this.lattice.saveState()};}
  restoreState(state:StateValue):void{
    if(!state||typeof state!=='object'||Array.isArray(state)||ArrayBuffer.isView(state))throw new EngineError('CHECKPOINT_MISMATCH','Flow: the saved state is not an object.');
    const {lattice,...rest}=state as StateObject;
    this.lattice.restoreState(lattice as StateValue);restoreFields(this,rest,FLOW_FIELDS);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Sampling the fields
// ---------------------------------------------------------------------------------------------------------------------
/** Trilinear sample of the velocity, pressure and wall distance at a point. Returns false outside the lattice. `out` is
 * [ux, uy, uz, pressure, distance]. The pressure is weighted over fluid cells only. */
export function flowSample(field:FlowField,x:number,y:number,z:number,out:Float64Array|number[]):boolean{
  const {origin,cell:h,nx,ny,nz}=field.grid;
  let fx=(x-origin[0])/h-0.5,fy=(y-origin[1])/h-0.5,fz=(z-origin[2])/h-0.5;
  if(fx<-0.5||fy<-0.5||fz<-0.5||fx>nx-0.5||fy>ny-0.5||fz>nz-0.5)return false;
  if(fx<0)fx=0;else if(fx>nx-1)fx=nx-1;
  if(fy<0)fy=0;else if(fy>ny-1)fy=ny-1;
  if(fz<0)fz=0;else if(fz>nz-1)fz=nz-1;
  let i=Math.floor(fx),j=Math.floor(fy),k=Math.floor(fz);
  if(i>nx-2)i=Math.max(0,nx-2);if(j>ny-2)j=Math.max(0,ny-2);if(k>nz-2)k=Math.max(0,nz-2);
  const tx=nx>1?fx-i:0,ty=ny>1?fy-j:0,tz=nz>1?fz-k:0,sx=nx>1?1:0,sy=ny>1?nx:0,sz=nz>1?nx*ny:0,c=i+nx*(j+ny*k),tiles=field.tiles;
  // the storage slot of corner n of the cube of cells around the point
  const corner=(n:number):number=>{const a=n&1,b=(n>>1)&1,e=(n>>2)&1;return tiles?tiles.slot(i+(nx>1?a:0),j+(ny>1?b:0),k+(nz>1?e:0)):c+a*sx+b*sy+e*sz;};
  let u=0,v=0,w=0,p=0,pw=0,d=0;
  for(let n=0;n<8;n++){
    const a=n&1,b=(n>>1)&1,e=(n>>2)&1,wt=(a?tx:1-tx)*(b?ty:1-ty)*(e?tz:1-tz);
    if(wt===0)continue;
    const q=corner(n);
    u+=wt*field.ux[q];v+=wt*field.uy[q];w+=wt*field.uz[q];d+=wt*field.distance[q];
    if(field.fluid[q]){p+=wt*field.pressure[q];pw+=wt;}
  }
  if(pw===0){for(let n=0;n<8;n++){const a=n&1,b=(n>>1)&1,e=(n>>2)&1,wt=(a?tx:1-tx)*(b?ty:1-ty)*(e?tz:1-tz);p+=wt*field.pressure[corner(n)];}pw=1;}
  out[0]=u;out[1]=v;out[2]=w;out[3]=p/pw;out[4]=d;
  return true;
}
export {FLOW_FLUID,FLOW_WALL,FLOW_VELOCITY,FLOW_PRESSURE,FLOW_SLIP};
