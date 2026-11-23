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
import {FlowLattice,FLOW_FLUID,FLOW_WALL,FLOW_VELOCITY,FLOW_PRESSURE,FLOW_SLIP,FLOW_CX,FLOW_CY,FLOW_CZ,FLOW_WEIGHT,FLOW_LATTICE_ID,FLOW_MAX_CELLS,type FlowLatticePart,type FlowLatticePatch} from './flow-lattice.ts';
import {flowVoxelize,type FlowGrid,type FlowItem,type FlowItemReport,type FlowSurface,type FlowVec3} from './flow-geometry.ts';

export const FLOW_SOLVER_ID=FLOW_LATTICE_ID;
export const FLOW_SOLVER_VERSION='1.0.0';
export {FLOW_MAX_CELLS};

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

export type FlowSideName='xMin'|'xMax'|'yMin'|'yMax'|'zMin'|'zMax';
export const FLOW_SIDES:readonly FlowSideName[]=Object.freeze(['xMin','xMax','yMin','yMax','zMin','zMax']) as readonly FlowSideName[];
export type FlowSide=
  |'wall'|'slip'|'periodic'
  /** A no-slip wall, which may slide in its own plane (a moving ground). `part` names it in the force report. */
  |{readonly kind:'wall';readonly velocity?:FlowVec3;readonly part?:string}
  /** A given velocity on the whole side (an inflow, or a far field). */
  |{readonly kind:'velocity';readonly velocity:FlowVec3|((x:number,y:number,z:number)=>FlowVec3);readonly name?:string}
  /** A given gauge pressure on the whole side (an outflow). */
  |{readonly kind:'pressure';readonly pressure?:number;readonly name?:string};
export type FlowPatchShape=
  /** `normal` points into the fluid. */
  |{readonly kind:'disc';readonly center:FlowVec3;readonly normal:FlowVec3;readonly radius:number}
  |{readonly kind:'rect';readonly center:FlowVec3;readonly normal:FlowVec3;readonly up?:FlowVec3;readonly halfWidth:number;readonly halfHeight:number};
export interface FlowPatch {
  readonly name:string;
  readonly kind:'inlet'|'outlet';
  readonly shape:FlowPatchShape;
  /** Inlet: volume flow rate m^3/s, or the speed along the normal m/s, or the velocity vector. One of the three. */
  readonly flowRate?:number;readonly speed?:number;readonly velocity?:FlowVec3;
  /** Inlet by flow rate or speed: 'uniform' (default), or 'parabolic': 1 - (r/R)^2 on a disc, (1 - (x/a)^2)(1 - (y/b)^2) on
   * a rectangle, scaled so that the flow rate (or the mean speed) is the one given. */
  readonly profile?:'uniform'|'parabolic';
  /** Outlet: gauge pressure, Pa. Default 0. */
  readonly pressure?:number;
}
export interface FlowOptions {
  /** The box of fluid cells: origin (its minimum corner), cell size and counts. */
  readonly grid:FlowGrid;
  readonly geometry?:readonly FlowItem[];
  readonly fluid:FlowFluid;
  /** Default 'wall' on every side. */
  readonly sides?:Partial<Record<FlowSideName,FlowSide>>;
  readonly patches?:readonly FlowPatch[];
  /** The speed that is `latticeSpeed` cells per step: the largest speed imposed. Sets the time step. */
  readonly referenceSpeed:number;
  /** Default 0.06 (a lattice Mach number of 0.10). */
  readonly latticeSpeed?:number;
  /** 'auto' (default): Smagorinsky when the cell Reynolds number referenceSpeed h / nu exceeds 10, else none. */
  readonly turbulence?:'auto'|'none'|'smagorinsky';
  /** Smagorinsky constant. Default 0.16. */
  readonly smagorinsky?:number;
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
}
export interface FlowPatchInfo {
  readonly name:string;readonly kind:'inlet'|'outlet';
  /** Area the lattice gives the patch along its normal, m^2, and the normal (into the fluid). */
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
}

const fail=(message:string):never=>{throw new EngineError('INVALID_ARGUMENT',`Flow: ${message}`);};
const isVec=(v:unknown):v is FlowVec3=>Array.isArray(v)&&v.length===3&&v.every(x=>typeof x==='number'&&Number.isFinite(x));
const vec=(v:unknown,name:string):FlowVec3=>isVec(v)?v:fail(`${name} must be three finite numbers.`);
const FLOW_FIELDS:FieldOptions={label:'Flow',skip:['grid','lattice','fluid','dt','cell','latticeSpeed','referenceSpeed','turbulence','smagorinsky','cellReynolds','relaxationTime','parts','patches','voxels','warnings','surfaces','items','solidCells','fluidCells','enclosedCells','forceScale','momentScale','flowScale','pressureScale','velocityScale','rampSteps','kinds','inletVelocity'],
  nested:{}};

export class Flow {
  /** The lattice: the fluid box plus one layer of boundary cells on every side that is not periodic. */
  readonly grid:FlowGrid;
  readonly lattice:FlowLattice;
  readonly fluid:FlowFluid;
  readonly dt:number;readonly cell:number;readonly latticeSpeed:number;readonly referenceSpeed:number;
  readonly turbulence:'none'|'smagorinsky';readonly smagorinsky:number;
  /** referenceSpeed h / nu, and the relaxation time 3 nu dt / h^2 + 1/2 of the lattice. */
  readonly cellReynolds:number;readonly relaxationTime:number;
  /** Names of the parts that take force: the parts of the geometry, then the wall sides. */
  readonly parts:readonly string[];
  readonly patches:readonly FlowPatchInfo[];
  readonly surfaces:readonly FlowSurface[];
  readonly items:readonly FlowItemReport[];
  readonly warnings:readonly string[];
  readonly solidCells:number;readonly fluidCells:number;
  /** Fluid cells no inlet or outlet reaches (the inside of a hollow body); they are made solid. */
  readonly enclosedCells:number;
  private readonly forceScale:number;private readonly momentScale:number;private readonly flowScale:number;
  private readonly pressureScale:number;private readonly velocityScale:number;private readonly rampSteps:number;
  private readonly kinds:Uint8Array;private readonly voxels:{distance:Float32Array};private readonly inletVelocity:Float64Array|null;
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
    if(cells>FLOW_MAX_CELLS)fail(`${cells} cells exceed the limit ${FLOW_MAX_CELLS}.`);
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
    if(mode!=='auto'&&mode!=='none'&&mode!=='smagorinsky')fail(`unknown turbulence "${mode}".`);
    this.turbulence=mode==='auto'?(this.cellReynolds>10?'smagorinsky':'none'):mode;
    this.smagorinsky=options.smagorinsky??0.16;
    if(!(this.smagorinsky>0&&this.smagorinsky<=0.5))fail('smagorinsky must be in (0, 0.5].');
    const warnings:string[]=[];

    // ---- geometry ----
    const vox=flowVoxelize(options.geometry??[],this.grid,{band:options.band});
    warnings.push(...vox.warnings);
    this.surfaces=vox.surfaces;this.items=vox.items;
    const parts=[...vox.parts],lparts:FlowLatticePart[]=parts.map(()=>({}));
    const lpatches:FlowLatticePatch[]=[],patchNames:string[]=[],patchKinds:('inlet'|'outlet')[]=[];
    const kind=new Uint8Array(cells),owner=new Int32Array(cells),distance=new Float32Array(cells);
    const hasGeometry=(options.geometry?.length??0)>0;
    // geometry and the cells of the fluid box
    for(let c=0;c<cells;c++){
      const d=hasGeometry?vox.distance[c]/h:vox.band;
      distance[c]=d;
      if(d<0){kind[c]=FLOW_WALL;owner[c]=vox.part[c]<0?0:vox.part[c];}
    }
    if(hasGeometry&&parts.length===0)parts.push('body'),lparts.push({});
    // sides: the boundary layer where the geometry is not solid. Order of precedence at edges: velocity, wall, pressure, slip.
    const sideOwner=new Int32Array(6).fill(-1),sideProfile:(((x:number,y:number,z:number)=>FlowVec3)|null)[]=[null,null,null,null,null,null];
    // velocity of single inlet cells where a profile is given (cells per step); weight of a cell in a parabolic patch
    let cellVelocity:Float64Array|undefined,cellWeight:Float64Array|undefined;
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
        const spec=s as {kind:'velocity';velocity:FlowVec3|((x:number,y:number,z:number)=>FlowVec3);name?:string};
        sideOwner[index]=lpatches.length;patchNames.push(spec.name??name);
        if(typeof spec.velocity==='function'){sideProfile[index]=spec.velocity;lpatches.push({velocity:[0,0,0]});patchKinds.push('inlet');}
        else{
          const v=vec(spec.velocity,`${name}.velocity`);lpatches.push({velocity:[v[0]/vScale,v[1]/vScale,v[2]/vScale]});
          const inward=(index&1)===0?v[index>>1]:-v[index>>1];patchKinds.push(inward>=0?'inlet':'outlet');
        }
      }else if(k==='pressure'){
        const spec=s as {kind:'pressure';pressure?:number;name?:string},p=spec.pressure??0;
        if(!Number.isFinite(p))fail(`${name}.pressure must be finite.`);
        sideOwner[index]=lpatches.length;lpatches.push({density:1+p/this.pressureScale});patchNames.push(spec.name??name);patchKinds.push('outlet');
      }
    });
    const ghostSide=new Int8Array(cells).fill(-1);
    for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
      let best=-1;
      const consider=(index:number):void=>{if(best<0||rank(sideKind[index])>rank(sideKind[best]))best=index;};
      if(pad[0]){if(i===0)consider(0);else if(i===nx-1)consider(1);}
      if(pad[1]){if(j===0)consider(2);else if(j===ny-1)consider(3);}
      if(pad[2]){if(k===0)consider(4);else if(k===nz-1)consider(5);}
      if(best<0)continue;
      ghostSide[c]=best;
      if(kind[c]===FLOW_WALL)continue; // the geometry reaches through the side
      const sk=sideKind[best];
      kind[c]=sk==='wall'?FLOW_WALL:sk==='slip'?FLOW_SLIP:sk==='velocity'?FLOW_VELOCITY:FLOW_PRESSURE;
      owner[c]=sk==='slip'?0:sideOwner[best];
      if(sk==='wall')distance[c]=NaN; // half-way
      const profile=sideProfile[best];
      if(sk==='velocity'&&profile){
        // the velocity on the side of the box, in front of this boundary cell
        const pos=[origin[0]+(i+0.5)*h,origin[1]+(j+0.5)*h,origin[2]+(k+0.5)*h],a=best>>1;pos[a]=(best&1)===0?origin[a]+h:origin[a]+([nx,ny,nz][a]-1)*h;
        const v=vec(profile(pos[0],pos[1],pos[2]),`${FLOW_SIDES[best]}.velocity()`);
        cellVelocity??=new Float64Array(3*cells);cellVelocity[3*c]=v[0]/vScale;cellVelocity[3*c+1]=v[1]/vScale;cellVelocity[3*c+2]=v[2]/vScale;
      }
    }
    // patches: the cells behind the plane of each opening
    const patchNormals:FlowVec3[]=lpatches.map((_,i)=>{const side=sideOwner.indexOf(i),a=side>>1,n:[number,number,number]=[0,0,0];n[a]=(side&1)===0?1:-1;return n;});
    const pendingRates:{index:number;patch:FlowPatch;normal:FlowVec3}[]=[];
    for(const patch of options.patches??[]){
      if(!patch||typeof patch.name!=='string'||patch.name.length===0)fail('a patch needs a name.');
      if(patchNames.includes(patch.name))fail(`two patches are named "${patch.name}".`);
      if(patch.kind!=='inlet'&&patch.kind!=='outlet')fail(`patch "${patch.name}": kind must be 'inlet' or 'outlet'.`);
      const sh=patch.shape;
      if(!sh||(sh.kind!=='disc'&&sh.kind!=='rect'))fail(`patch "${patch.name}": shape.kind must be 'disc' or 'rect'.`);
      const ce=vec(sh.center,`patch "${patch.name}": center`),nr=vec(sh.normal,`patch "${patch.name}": normal`),nl=Math.hypot(nr[0],nr[1],nr[2]);
      if(!(nl>0))fail(`patch "${patch.name}": normal must not be zero.`);
      const n:FlowVec3=[nr[0]/nl,nr[1]/nl,nr[2]/nl];
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
      for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
        const x=origin[0]+(i+0.5)*h-ce[0],y=origin[1]+(j+0.5)*h-ce[1],z=origin[2]+(k+0.5)*h-ce[2],s=x*n[0]+y*n[1]+z*n[2];
        if(s>1e-9*h||s<-2.5*h)continue;
        const wt=inside(x,y,z);if(wt===0)continue;
        kind[c]=patch.kind==='inlet'?FLOW_VELOCITY:FLOW_PRESSURE;owner[c]=index;marked++;
        if(parabolic&&patch.kind==='inlet'){cellWeight??=new Float64Array(cells);cellWeight[c]=wt;}
      }
      if(marked===0)fail(`patch "${patch.name}" covers no cell: its plane must lie in the box or on one of its sides, with the normal pointing into the fluid.`);
      patchNames.push(patch.name);patchKinds.push(patch.kind);patchNormals.push(n);
      if(patch.kind==='inlet'){
        const given=[patch.flowRate,patch.speed,patch.velocity].filter(v=>v!==undefined).length;
        if(given!==1)fail(`inlet "${patch.name}" needs exactly one of flowRate, speed and velocity.`);
        if(parabolic&&patch.velocity)fail(`inlet "${patch.name}": a parabolic profile needs flowRate or speed, not a velocity vector.`);
        if(patch.velocity){const v=vec(patch.velocity,`inlet "${patch.name}": velocity`);lpatches.push({velocity:[v[0]/vScale,v[1]/vScale,v[2]/vScale]});}
        else{lpatches.push({velocity:[0,0,0]});pendingRates.push({index,patch,normal:n});}
      }else{
        const p=patch.pressure??0;if(!Number.isFinite(p))fail(`outlet "${patch.name}": pressure must be finite.`);
        lpatches.push({density:1+p/this.pressureScale});
      }
    }
    // cells no opening reaches become solid
    let enclosed=0;
    if(lpatches.length>0){
      const reached=new Uint8Array(cells),stack:number[]=[];
      const wrap=(v:number,n:number,p:boolean):number=>v<0||v>=n?(p?(v+n)%n:-1):v;
      const visit=(i:number,j:number,k:number):void=>{
        const a=wrap(i,nx,periodic[0]),b=wrap(j,ny,periodic[1]),c=wrap(k,nz,periodic[2]);if(a<0||b<0||c<0)return;
        const idx=a+nx*(b+ny*c);if(kind[idx]!==FLOW_FLUID||reached[idx])return;reached[idx]=1;stack.push(idx);
      };
      for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
        if(kind[c]!==FLOW_VELOCITY&&kind[c]!==FLOW_PRESSURE)continue;
        for(let d=1;d<19;d++)visit(i+FLOW_CX[d],j+FLOW_CY[d],k+FLOW_CZ[d]);
      }
      while(stack.length>0){const idx=stack.pop()!,i=idx%nx,j=Math.floor(idx/nx)%ny,k=Math.floor(idx/(nx*ny));for(let d=1;d<19;d++)visit(i+FLOW_CX[d],j+FLOW_CY[d],k+FLOW_CZ[d]);}
      for(let c=0;c<cells;c++)if(kind[c]===FLOW_FLUID&&!reached[c]){
        if(parts.length===0){parts.push('body');lparts.push({});}
        kind[c]=FLOW_WALL;owner[c]=vox.part[c]<0?0:vox.part[c];distance[c]=NaN;enclosed++;
      }
    }
    this.enclosedCells=enclosed;
    if(parts.length===0){parts.push('body');lparts.push({});}
    // areas of the patches on the lattice, and the speeds of the inlets given by flow rate
    const areaVec=new Float64Array(3*lpatches.length),weighted=new Float64Array(3*lpatches.length),touch=new Int32Array(lpatches.length);
    for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
      if(kind[c]!==FLOW_VELOCITY&&kind[c]!==FLOW_PRESSURE)continue;
      const p=owner[c];
      for(let d=1;d<19;d++){
        let a=i+FLOW_CX[d],b=j+FLOW_CY[d],e=k+FLOW_CZ[d];
        if(a<0||a>=nx){if(!periodic[0])continue;a=(a+nx)%nx;}
        if(b<0||b>=ny){if(!periodic[1])continue;b=(b+ny)%ny;}
        if(e<0||e>=nz){if(!periodic[2])continue;e=(e+nz)%nz;}
        if(kind[a+nx*(b+ny*e)]!==FLOW_FLUID)continue;
        const w=6*FLOW_WEIGHT[d];areaVec[3*p]+=w*FLOW_CX[d];areaVec[3*p+1]+=w*FLOW_CY[d];areaVec[3*p+2]+=w*FLOW_CZ[d];
        if(cellWeight){const ww=w*cellWeight[c];weighted[3*p]+=ww*FLOW_CX[d];weighted[3*p+1]+=ww*FLOW_CY[d];weighted[3*p+2]+=ww*FLOW_CZ[d];}
        if(d<=6)touch[p]++;
      }
    }
    const infos:FlowPatchInfo[]=[];
    for(let p=0;p<lpatches.length;p++){
      const n=patchNormals[p],area=(areaVec[3*p]*n[0]+areaVec[3*p+1]*n[1]+areaVec[3*p+2]*n[2])*h*h;
      const pending=pendingRates.find(r=>r.index===p);
      if(pending){
        if(!(area>0))fail(`inlet "${pending.patch.name}" touches no fluid cell.`);
        const speed=pending.patch.flowRate!==undefined?pending.patch.flowRate/area:pending.patch.speed!;
        if(!Number.isFinite(speed))fail(`inlet "${pending.patch.name}": flowRate or speed must be finite.`);
        lpatches[p]={velocity:[speed*n[0]/vScale,speed*n[1]/vScale,speed*n[2]/vScale]};
        if(pending.patch.profile==='parabolic'&&cellWeight){
          // every cell of the patch takes its weight times the factor that keeps the flow rate
          const wArea=(weighted[3*p]*n[0]+weighted[3*p+1]*n[1]+weighted[3*p+2]*n[2])*h*h,factor=speed*area/wArea/vScale;
          cellVelocity??=new Float64Array(3*cells);
          for(let c=0;c<cells;c++)if(kind[c]===FLOW_VELOCITY&&owner[c]===p){const f=factor*cellWeight[c];cellVelocity[3*c]=f*n[0];cellVelocity[3*c+1]=f*n[1];cellVelocity[3*c+2]=f*n[2];}
        }
      }
      if(touch[p]===0)warnings.push(`patch "${patchNames[p]}" touches no fluid cell: nothing flows through it.`);
      const lv=lpatches[p].velocity,ld=lpatches[p].density;
      infos.push({name:patchNames[p],kind:patchKinds[p],area,normal:n,velocity:lv?[lv[0]*vScale,lv[1]*vScale,lv[2]*vScale]:null,pressure:ld!==undefined?(ld-1)*this.pressureScale:null,cells:touch[p]});
      if(lv){const s=Math.hypot(lv[0],lv[1],lv[2]);if(s>0.3)fail(`patch "${patchNames[p]}": its speed ${(s*vScale).toPrecision(3)} m/s is ${(s/uLat).toFixed(1)} times referenceSpeed; raise referenceSpeed.`);
        else if(s>1.5*uLat+1e-12)warnings.push(`patch "${patchNames[p]}": its speed ${(s*vScale).toPrecision(3)} m/s exceeds referenceSpeed ${options.referenceSpeed.toPrecision(3)} m/s; the lattice Mach number there is ${(s*Math.sqrt(3)).toFixed(2)}.`);}
    }
    if(cellVelocity){
      // cells of the patches without a profile take the velocity of their patch
      const given=new Uint8Array(lpatches.length);
      sideProfile.forEach((f,side)=>{if(f)given[sideOwner[side]]=1;});
      for(const r of pendingRates)if(r.patch.profile==='parabolic')given[r.index]=1;
      for(let c=0;c<cells;c++)if(kind[c]===FLOW_VELOCITY&&!given[owner[c]]){const v=lpatches[owner[c]].velocity!;cellVelocity[3*c]=v[0];cellVelocity[3*c+1]=v[1];cellVelocity[3*c+2]=v[2];}
    }
    this.parts=parts;this.patches=infos;this.inletVelocity=cellVelocity??null;
    // sponge in front of the pressure sides
    let extra:Float32Array|undefined;
    const sponge=options.spongeCells??0;
    if(sponge>0){
      extra=new Float32Array(cells);
      for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
        let s=0;const idx=[i,j,k],n=[nx,ny,nz];
        for(let side=0;side<6;side++){
          if(sideKind[side]!=='pressure')continue;
          const a=side>>1,depth=(side&1)===0?idx[a]:n[a]-1-idx[a],t=1-depth/sponge;
          if(t>s)s=t;
        }
        if(s>0)extra[c]=0.1*s*s; // up to tau = 0.8 at the side
      }
    }
    const acc=options.acceleration?vec(options.acceleration,'acceleration'):[0,0,0],u0=options.initialVelocity?vec(options.initialVelocity,'initialVelocity'):[0,0,0];
    const aScale=dt*dt/h;
    this.lattice=new FlowLattice({nx,ny,nz,periodic,kind,owner,distance,walls:options.walls??'interpolated',parts:lparts,patches:lpatches,viscosity:nuLat,
      smagorinsky:this.turbulence==='smagorinsky'?this.smagorinsky:0,force:[acc[0]*aScale,acc[1]*aScale,acc[2]*aScale],initialVelocity:[u0[0]/vScale,u0[1]/vScale,u0[2]/vScale],extraViscosity:extra,cellVelocity});
    this.kinds=kind;this.voxels={distance:vox.distance};
    this.solidCells=cells-this.lattice.fluidCells;this.fluidCells=this.lattice.fluidCells;
    this.rampSteps=Math.max(0,Math.floor(options.rampSteps??0));
    if(this.rampSteps>0)this.lattice.ramp=0;
    if(this.relaxationTime<0.5005&&this.turbulence==='none')warnings.push(`the relaxation time ${this.relaxationTime.toFixed(5)} is within 0.0005 of 1/2 and the sub-grid model is off: the run is likely to be unstable.`);
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
    const {ux,uy,uz,cells}=this.lattice;let m=0;
    for(let c=0;c<cells;c++){const s=ux[c]*ux[c]+uy[c]*uy[c]+uz[c]*uz[c];if(s>m)m=s;}
    return Math.sqrt(m)*this.velocityScale;
  }
  /** False when the run has blown up (a density or velocity that is not finite, or a speed above the sound speed). */
  healthy():boolean{return this.lattice.healthy();}

  /** Add the fields of the last step to the time averages. */
  accumulate():void{
    const L=this.lattice,n=L.cells;
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
    for(let c=0;c<n;c++)if(kind[c]===FLOW_FLUID){fluid[c]=1;ux[c]=sx[c]*vs;uy[c]=sy[c]*vs;uz[c]=sz[c]*vs;pressure[c]=sd[c]*ps;}
    // cells that are not fluid: pressure from the fluid around; velocity zero in walls, imposed in inlets, copied elsewhere
    const per=L.periodic;
    for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
      if(fluid[c])continue;
      let count=0,p=0,vx=0,vy=0,vz=0;
      for(let d=1;d<19;d++){
        let a=i+FLOW_CX[d],b=j+FLOW_CY[d],e=k+FLOW_CZ[d];
        if(a<0||a>=nx){if(!per[0])continue;a=(a+nx)%nx;}
        if(b<0||b>=ny){if(!per[1])continue;b=(b+ny)%ny;}
        if(e<0||e>=nz){if(!per[2])continue;e=(e+nz)%nz;}
        const q=a+nx*(b+ny*e);if(!fluid[q])continue;
        count++;p+=pressure[q];vx+=ux[q];vy+=uy[q];vz+=uz[q];
      }
      if(count===0)continue;
      pressure[c]=p/count;
      const kc=kind[c];
      if(kc===FLOW_VELOCITY){
        const iv=this.inletVelocity,sc=this.velocityScale;
        if(iv){ux[c]=iv[3*c]*sc;uy[c]=iv[3*c+1]*sc;uz[c]=iv[3*c+2]*sc;}else{const v=this.patches[L.owner[c]].velocity!;ux[c]=v[0];uy[c]=v[1];uz[c]=v[2];}
      }
      else if(kc!==FLOW_WALL){ux[c]=vx/count;uy[c]=vy/count;uz[c]=vz/count;}
    }
    return {grid:this.grid,fluid,ux,uy,uz,pressure,distance:this.voxels.distance};
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
  const tx=nx>1?fx-i:0,ty=ny>1?fy-j:0,tz=nz>1?fz-k:0,sx=nx>1?1:0,sy=ny>1?nx:0,sz=nz>1?nx*ny:0,c=i+nx*(j+ny*k);
  let u=0,v=0,w=0,p=0,pw=0,d=0;
  for(let n=0;n<8;n++){
    const a=n&1,b=(n>>1)&1,e=(n>>2)&1,wt=(a?tx:1-tx)*(b?ty:1-ty)*(e?tz:1-tz);
    if(wt===0)continue;
    const q=c+a*sx+b*sy+e*sz;
    u+=wt*field.ux[q];v+=wt*field.uy[q];w+=wt*field.uz[q];d+=wt*field.distance[q];
    if(field.fluid[q]){p+=wt*field.pressure[q];pw+=wt;}
  }
  if(pw===0){for(let n=0;n<8;n++){const a=n&1,b=(n>>1)&1,e=(n>>2)&1,wt=(a?tx:1-tx)*(b?ty:1-ty)*(e?tz:1-tz);p+=wt*field.pressure[c+a*sx+b*sy+e*sz];}pw=1;}
  out[0]=u;out[1]=v;out[2]=w;out[3]=p/pw;out[4]=d;
  return true;
}
export {FLOW_FLUID,FLOW_WALL,FLOW_VELOCITY,FLOW_PRESSURE,FLOW_SLIP};
