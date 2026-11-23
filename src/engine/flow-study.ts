/**
 * Flow studies: a JSON document in (`box3d-flow-study/1`), a JSON document out (`box3d-flow-result/1`). SI units.
 *
 *   const result = runFlowStudy(study, {onProgress});          // set up, run to a steady state or a steady mean, post-process
 *   const run = createFlowStudy(study); while (!run.done) run.advance(); const result = run.result();
 *
 * An external study is a virtual wind or water tunnel around the geometry; an internal study is the flow through a
 * cavity with named inlets and outlets. docs/FLOW.md is the reference of both formats and of what is validated.
 */
import {EngineError} from './contracts.ts';
import {Flow,FLOW_FLUIDS,FLOW_SOLVER_ID,FLOW_SOLVER_VERSION,FLOW_SIDES,FLOW_MAX_CELLS,type FlowField,type FlowFluid,type FlowOptions,type FlowPatch,type FlowPatchShape,type FlowSide,type FlowSideName} from './flow.ts';
import {flowGeometryBounds,type FlowItem,type FlowMesh,type FlowVec3,type FlowGrid} from './flow-geometry.ts';
import {flowFrequency,flowLine,flowProjectedArea,flowRake,flowSection,flowSeedPlane,flowSlice,flowStreamlines,flowSurfacePressure} from './flow-post.ts';

export const FLOW_STUDY_FORMAT='box3d-flow-study/1';
export const FLOW_RESULT_FORMAT='box3d-flow-result/1';
export const FLOW_STATEMENT='Weakly compressible lattice-Boltzmann (D3Q19, regularised collision) with a Smagorinsky sub-grid model on a uniform grid. Above a cell Reynolds number of about 10 it is an under-resolved large-eddy simulation without a wall model: an engineering estimate, not certified CFD.';
export const FLOW_LIMITS:readonly string[]=Object.freeze([
  'Boundary layers are not resolved and there is no wall model: skin friction, and the separation from smooth curved surfaces (spheres, cylinders, streamlined bodies, wings), are estimates. Sharp-edged bodies, whose separation the geometry fixes, are predicted better.',
  'Incompressible flow only. The lattice Mach number of the reference speed is sqrt(3) * latticeSpeed (0.10 by default); the physical flow should be below Mach 0.3. No shocks, no heating by compression.',
  'One fluid, no free surface (use the free-surface or shallow-water solvers), no heat transfer, no cavitation, no rotating or moving geometry: a rotor is a frozen solid, optionally with a surface velocity.',
  'The geometry is voxelised: features thinner than about two cells are coarse, and thinner than one are lost (see the warnings and setup.geometry).',
  'Walls of the tunnel are slip planes; the blockage they cause is reported and not corrected.',
]);

type Json=Record<string,unknown>;
const fail=(message:string):never=>{throw new EngineError('INVALID_ARGUMENT',`flow study: ${message}`);};
const isObject=(v:unknown):v is Json=>typeof v==='object'&&v!==null&&!Array.isArray(v)&&!ArrayBuffer.isView(v);
const num=(v:unknown,name:string,min=-Infinity,exclusive=false):number=>{
  if(typeof v!=='number'||!Number.isFinite(v)||v<min||(exclusive&&v===min))fail(`${name} must be a finite number${min>-Infinity?(exclusive?` above ${min}`:` of at least ${min}`):''}.`);
  return v as number;
};
const vec3=(v:unknown,name:string):[number,number,number]=>{
  if(!Array.isArray(v)||v.length!==3||!v.every(x=>typeof x==='number'&&Number.isFinite(x)))fail(`${name} must be [x, y, z].`);
  return [(v as number[])[0],(v as number[])[1],(v as number[])[2]];
};
const known=(o:Json,name:string,keys:readonly string[]):void=>{for(const k of Object.keys(o))if(!keys.includes(k))fail(`${name} has an unknown field "${k}". Known: ${keys.join(', ')}.`);};
const unit=(v:FlowVec3,name:string):[number,number,number]=>{const l=Math.hypot(v[0],v[1],v[2]);if(!(l>0))fail(`${name} must not be zero.`);return [v[0]/l,v[1]/l,v[2]/l];};
const cross=(a:FlowVec3,b:FlowVec3):[number,number,number]=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const dot=(a:FlowVec3,b:FlowVec3):number=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
/** Six significant digits: what a float32 field holds. */
const r6=(v:number):number=>Number.isFinite(v)?Number(v.toPrecision(6)):0;
const list=(a:ArrayLike<number>):number[]=>{const out=new Array<number>(a.length);for(let i=0;i<a.length;i++)out[i]=r6(a[i]);return out;};

export interface FlowStudyOptions {
  /** Called after every monitor interval. */
  readonly onProgress?:(progress:FlowProgress)=>void;
  /** Resolves a mesh given by `file` in the study. Without it such a mesh is an error. */
  readonly loadMesh?:(file:string)=>{positions:ArrayLike<number>;indices?:ArrayLike<number>};
  /** Wall clock in milliseconds. Default Date.now. */
  readonly now?:()=>number;
}
export interface FlowProgress {
  readonly step:number;readonly maxSteps:number;readonly time:number;
  /** Fraction of the largest run length done. */
  readonly fraction:number;
  readonly residual:number;
  /** External: drag, lift and side coefficients of the last interval. Internal: null. */
  readonly coefficients:{cd:number;cl:number;cs:number}|null;
  /** Internal: (inflow - outflow) / inflow of the last interval. External: null. */
  readonly massBalance:number|null;
  readonly window:number;readonly phase:'startup'|'averaging';
}
/** What `flowStudySetup` works out from a study: the options of the solver and the numbers of the set-up. */
export interface FlowStudySetup {
  readonly name:string;readonly mode:'external'|'internal';
  readonly options:FlowOptions;
  readonly fluid:FlowFluid;
  /** The box of fluid cells. */
  readonly grid:FlowGrid;
  readonly referenceSpeed:number;readonly referenceLength:number;readonly referenceLengthSource:string;readonly reynolds:number;
  readonly transitTime:number;
  readonly external:null|{direction:[number,number,number];up:[number,number,number];side:[number,number,number];speed:number;ground:null|{height:number;moving:boolean};
    bodySize:number;bodyBounds:{min:[number,number,number];max:[number,number,number]};momentCenter:[number,number,number];referenceArea:number|null};
  readonly internal:null|{inlets:string[];outlets:string[]};
  readonly run:{maxSteps:number;startupSteps:number;windowSteps:number;monitorEvery:number;sampleEvery:number;tolerance:number};
  readonly outputs:Json;
  readonly warnings:string[];
}

const ITEM_KEYS:Record<string,readonly string[]>={
  box:['kind','part','role','center','halfExtents','rotation'],sphere:['kind','part','role','center','radius'],
  cylinder:['kind','part','role','from','to','center','halfLength','rotation','radius'],capsule:['kind','part','role','from','to','center','halfLength','rotation','radius'],
  cone:['kind','part','role','from','to','center','halfLength','rotation','radius','radiusTop'],tube:['kind','part','role','from','to','center','halfLength','rotation','radius','innerRadius'],
  beam:['kind','part','role','from','to','up','section','width','depth','flange','web'],mesh:['kind','part','role','positions','indices','file','thickness','position','rotation','scale'],
};
function readGeometry(raw:unknown,options:FlowStudyOptions):FlowItem[]{
  if(!Array.isArray(raw))fail('geometry must be an array of items.');
  return (raw as unknown[]).map((item,i)=>{
    if(!isObject(item)||typeof item.kind!=='string')fail(`geometry[${i}] must be an object with a kind.`);
    const o=item as Json,keys=ITEM_KEYS[o.kind as string];
    if(!keys)fail(`geometry[${i}].kind "${o.kind}" is unknown. Known: ${Object.keys(ITEM_KEYS).join(', ')}.`);
    known(o,`geometry[${i}]`,keys);
    if(o.kind==='mesh'&&o.file!==undefined){
      if(typeof o.file!=='string')fail(`geometry[${i}].file must be a string.`);
      if(o.positions!==undefined)fail(`geometry[${i}] has both positions and file.`);
      if(!options.loadMesh)fail(`geometry[${i}] names the file "${o.file}", and no loadMesh was given to resolve it.`);
      const mesh=options.loadMesh!(o.file as string),{file:_file,...rest}=o;void _file;
      return {...rest,positions:mesh.positions,indices:mesh.indices} as unknown as FlowMesh;
    }
    return o as unknown as FlowItem;
  });
}
function readFluid(raw:unknown):FlowFluid{
  if(raw===undefined)fail('fluid is required: "air", "water", or {density, viscosity}.');
  if(typeof raw==='string'){const f=(FLOW_FLUIDS as Record<string,FlowFluid>)[raw];if(!f)fail(`fluid "${raw}" is unknown. Known: air, water; or give {density, viscosity}.`);return f;}
  if(!isObject(raw))fail('fluid must be a name or an object.');
  const o=raw as Json;known(o,'fluid',['density','viscosity','dynamicViscosity']);
  const density=num(o.density,'fluid.density',0,true);
  if((o.viscosity===undefined)===(o.dynamicViscosity===undefined))fail('fluid needs exactly one of viscosity (kinematic, m^2/s) and dynamicViscosity (Pa s).');
  return {density,viscosity:o.viscosity!==undefined?num(o.viscosity,'fluid.viscosity',0,true):num(o.dynamicViscosity,'fluid.dynamicViscosity',0,true)/density};
}
function readShape(raw:unknown,name:string):FlowPatchShape{
  if(!isObject(raw))fail(`${name} must be an object.`);
  const o=raw as Json;
  if(o.kind==='disc'){known(o,name,['kind','center','normal','radius']);return {kind:'disc',center:vec3(o.center,`${name}.center`),normal:vec3(o.normal,`${name}.normal`),radius:num(o.radius,`${name}.radius`,0,true)};}
  if(o.kind==='rect'){known(o,name,['kind','center','normal','up','halfWidth','halfHeight']);return {kind:'rect',center:vec3(o.center,`${name}.center`),normal:vec3(o.normal,`${name}.normal`),up:o.up===undefined?undefined:vec3(o.up,`${name}.up`),halfWidth:num(o.halfWidth,`${name}.halfWidth`,0,true),halfHeight:num(o.halfHeight,`${name}.halfHeight`,0,true)};}
  return fail(`${name}.kind must be 'disc' or 'rect'.`);
}
const shapeArea=(s:FlowPatchShape):number=>s.kind==='disc'?Math.PI*s.radius*s.radius:4*s.halfWidth*s.halfHeight;

/** Check a study and work out the set-up: the box, the cell size, the time step, the sides, the run lengths. */
export function flowStudySetup(study:unknown,options:FlowStudyOptions={}):FlowStudySetup{
  if(!isObject(study))fail('the study must be an object.');
  const s=study as Json;
  if(s.format!==FLOW_STUDY_FORMAT)fail(`format must be "${FLOW_STUDY_FORMAT}".`);
  known(s,'the study',['format','name','units','geometry','fluid','mode','external','internal','motion','actuators','resolution','model','run','outputs']);
  if(s.units!==undefined&&s.units!=='SI')fail('units must be "SI".');
  if(s.name!==undefined&&typeof s.name!=='string')fail('name must be a string.');
  const mode=s.mode;
  if(mode!=='external'&&mode!=='internal')fail(`mode must be 'external' or 'internal'.`);
  const geometry=readGeometry(s.geometry??[],options),fluid=readFluid(s.fluid),warnings:string[]=[];
  const res=s.resolution===undefined?{}:isObject(s.resolution)?s.resolution as Json:fail('resolution must be an object.');
  known(res,'resolution',['cells','cellSize','latticeSpeed']);
  const budget=res.cells===undefined?400000:num(res.cells,'resolution.cells',1000);
  if(budget>FLOW_MAX_CELLS)fail(`resolution.cells must not exceed ${FLOW_MAX_CELLS}.`);
  const model=s.model===undefined?{}:isObject(s.model)?s.model as Json:fail('model must be an object.');
  known(model,'model',['turbulence','smagorinsky','walls','spongeCells']);
  const runIn=s.run===undefined?{}:isObject(s.run)?s.run as Json:fail('run must be an object.');
  known(runIn,'run',['transits','startupTransits','windowTransits','tolerance','maxSteps','monitorEvery','sampleEvery']);
  const outputs=s.outputs===undefined?{}:isObject(s.outputs)?s.outputs as Json:fail('outputs must be an object.');
  known(outputs,'outputs',['streamlines','slices','surface','lines','sections','history']);

  // The box [lo, hi] and the cell size: `cellSize`, or the cube root of the volume over the cell budget.
  const gridOf=(lo:number[],hi:number[],anchor:readonly (0|1)[]):FlowGrid=>{
    const size=[hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]];
    for(let a=0;a<3;a++)if(!(size[a]>0))fail('the box of the study has no extent along one axis.');
    let h=res.cellSize!==undefined?num(res.cellSize,'resolution.cellSize',0,true):Math.cbrt(size[0]*size[1]*size[2]/budget);
    const n=[0,0,0];
    const counts=():number=>{for(let a=0;a<3;a++)n[a]=Math.max(1,Math.ceil(size[a]/h-1e-9));return (n[0]+2)*(n[1]+2)*(n[2]+2);};
    // the layers of boundary cells count against the budget too
    if(res.cellSize===undefined)for(let it=0;it<60&&counts()>budget;it++)h*=1.01;
    if(counts()>FLOW_MAX_CELLS)fail(`the box needs ${counts()} cells at cellSize ${h}; the limit is ${FLOW_MAX_CELLS}.`);
    // the box grows to whole cells away from the anchored end of each axis
    const origin:[number,number,number]=[0,0,0];
    for(let a=0;a<3;a++)origin[a]=anchor[a]===0?lo[a]:hi[a]-n[a]*h;
    return {origin,cell:h,nx:n[0],ny:n[1],nz:n[2]};
  };
  const turbulence=model.turbulence??'auto';
  if(turbulence!=='auto'&&turbulence!=='none'&&turbulence!=='smagorinsky')fail(`model.turbulence must be 'auto', 'none' or 'smagorinsky'.`);
  const walls=model.walls??'interpolated';
  if(walls!=='interpolated'&&walls!=='halfway')fail(`model.walls must be 'interpolated' or 'halfway'.`);
  const common={fluid,motion:undefined as typeof motion,actuators:undefined as typeof actuators,turbulence:turbulence as 'auto',walls:walls as 'interpolated',
    smagorinsky:model.smagorinsky===undefined?undefined:num(model.smagorinsky,'model.smagorinsky',0,true),
    latticeSpeed:res.latticeSpeed===undefined?undefined:num(res.latticeSpeed,'resolution.latticeSpeed',0,true),
    spongeCells:model.spongeCells===undefined?undefined:num(model.spongeCells,'model.spongeCells',0)};

  // surface velocities of parts, and actuator discs
  let motion:Record<string,{velocity?:FlowVec3;angularVelocity?:FlowVec3;center?:FlowVec3}>|undefined;
  if(s.motion!==undefined){
    if(!isObject(s.motion))fail('motion must be an object of part names.');
    motion={};
    for(const [name,raw] of Object.entries(s.motion as Json)){
      if(!isObject(raw))fail(`motion.${name} must be an object.`);
      const o=raw as Json;known(o,`motion.${name}`,['velocity','angularVelocity','center']);
      motion[name]={velocity:o.velocity===undefined?undefined:vec3(o.velocity,`motion.${name}.velocity`),angularVelocity:o.angularVelocity===undefined?undefined:vec3(o.angularVelocity,`motion.${name}.angularVelocity`),center:o.center===undefined?undefined:vec3(o.center,`motion.${name}.center`)};
    }
  }
  const actuators=s.actuators===undefined?undefined:(Array.isArray(s.actuators)?s.actuators as unknown[]:fail('actuators must be an array.')).map((raw,i)=>{
    if(!isObject(raw))fail(`actuators[${i}] must be an object.`);
    const o=raw as Json;known(o,`actuators[${i}]`,['name','center','axis','radius','thickness','force','pressureJump']);
    if(typeof o.name!=='string'||o.name.length===0)fail(`actuators[${i}].name must be a non-empty string.`);
    return {name:o.name as string,center:vec3(o.center,`actuators[${i}].center`),axis:vec3(o.axis,`actuators[${i}].axis`),radius:num(o.radius,`actuators[${i}].radius`,0,true),
      thickness:o.thickness===undefined?undefined:num(o.thickness,`actuators[${i}].thickness`,0,true),force:o.force===undefined?undefined:num(o.force,`actuators[${i}].force`),pressureJump:o.pressureJump===undefined?undefined:num(o.pressureJump,`actuators[${i}].pressureJump`)};
  });
  common.motion=motion;common.actuators=actuators;
  let flowOptions:FlowOptions,referenceSpeed:number,referenceLength:number,referenceLengthSource:string,flowLength:number;
  let external:FlowStudySetup['external']=null,internal:FlowStudySetup['internal']=null;
  if(mode==='external'){
    if(s.internal!==undefined)fail('an external study must not have an "internal" section.');
    if(!isObject(s.external))fail('external is required for mode "external".');
    const e=s.external as Json;
    known(e,'external',['speed','direction','up','ground','margins','referenceLength','referenceArea','momentCenter','domain']);
    if(geometry.length===0)fail('an external study needs geometry.');
    if(geometry.some(g=>g.role==='cavity'))fail('an external study takes solids only; cavities are for internal studies.');
    const speed=num(e.speed,'external.speed',0,true),dir=unit(e.direction===undefined?[1,0,0]:vec3(e.direction,'external.direction'),'external.direction');
    const upRaw=e.up===undefined?[0,1,0] as FlowVec3:vec3(e.up,'external.up'),upAxis=upRaw.findIndex(v=>v!==0);
    if(upRaw.filter(v=>v!==0).length!==1)fail('external.up must be along one axis, such as [0, 1, 0].');
    const up:[number,number,number]=[0,0,0];up[upAxis]=upRaw[upAxis]>0?1:-1;
    const groundIn=e.ground===undefined||e.ground===false?null:e.ground===true?{}:isObject(e.ground)?e.ground as Json:fail('external.ground must be true, false or an object.');
    if(groundIn)known(groundIn,'external.ground',['height','moving']);
    if(groundIn&&Math.abs(dot(dir,up))>1e-9)fail('with a ground, external.direction must be parallel to it (normal to up).');
    const side=unit(cross(dir,up).every(v=>Math.abs(v)<1e-12)?fail('external.direction must not be parallel to up.'):cross(dir,up),'side');
    const b=flowGeometryBounds(geometry),ext=[b.max[0]-b.min[0],b.max[1]-b.min[1],b.max[2]-b.min[2]];
    // body size across the flow: the larger of its height and its width seen along the flow
    const lift=unit(cross(side,dir),'lift'),across=(axis:FlowVec3):number=>Math.abs(axis[0])*ext[0]+Math.abs(axis[1])*ext[1]+Math.abs(axis[2])*ext[2];
    const bodySize=Math.max(across(lift),across(side));
    const m=e.margins===undefined?{}:isObject(e.margins)?e.margins as Json:fail('external.margins must be an object.');
    known(m,'external.margins',['upstream','downstream','side','top','bottom']);
    const mUp=m.upstream===undefined?2:num(m.upstream,'margins.upstream',0),mDown=m.downstream===undefined?5:num(m.downstream,'margins.downstream',0),mSide=m.side===undefined?2:num(m.side,'margins.side',0),mTop=m.top===undefined?2:num(m.top,'margins.top',0),mBottom=m.bottom===undefined?mTop:num(m.bottom,'margins.bottom',0);
    let lo=[0,0,0],hi=[0,0,0];const anchor:(0|1)[]=[0,0,0];
    let ground:null|{height:number;moving:boolean}=null;
    if(e.domain!==undefined){
      if(!isObject(e.domain))fail('external.domain must be {min, max}.');
      lo=vec3((e.domain as Json).min,'external.domain.min');hi=vec3((e.domain as Json).max,'external.domain.max');
      for(let a=0;a<3;a++){if(dir[a]<-0.2)anchor[a]=1;}
    }else for(let a=0;a<3;a++){
      if(a===upAxis){
        const below=mBottom*bodySize,above=mTop*bodySize;
        if(up[a]>0){lo[a]=b.min[a]-below;hi[a]=b.max[a]+above;}else{lo[a]=b.min[a]-above;hi[a]=b.max[a]+below;anchor[a]=1;}
      }else if(dir[a]>0.2){lo[a]=b.min[a]-mUp*bodySize;hi[a]=b.max[a]+mDown*bodySize;}
      else if(dir[a]<-0.2){lo[a]=b.min[a]-mDown*bodySize;hi[a]=b.max[a]+mUp*bodySize;anchor[a]=1;}
      else{lo[a]=b.min[a]-mSide*bodySize;hi[a]=b.max[a]+mSide*bodySize;}
    }
    if(groundIn){
      const height=groundIn.height===undefined?(up[upAxis]>0?b.min[upAxis]:b.max[upAxis]):num(groundIn.height,'external.ground.height');
      if(groundIn.moving!==undefined&&typeof groundIn.moving!=='boolean')fail('external.ground.moving must be true or false.');
      ground={height,moving:groundIn.moving===true};
      if(up[upAxis]>0){lo[upAxis]=height;anchor[upAxis]=0;}else{hi[upAxis]=height;anchor[upAxis]=1;}
    }
    const grid=gridOf(lo,hi,anchor),sides:Partial<Record<FlowSideName,FlowSide>>={};
    const velocity:[number,number,number]=[speed*dir[0],speed*dir[1],speed*dir[2]];
    for(let a=0;a<3;a++){
      const loName=FLOW_SIDES[2*a],hiName=FLOW_SIDES[2*a+1];
      if(a===upAxis){
        const groundSide=up[a]>0?loName:hiName,skySide=up[a]>0?hiName:loName;
        sides[skySide]='slip';
        sides[groundSide]=ground?{kind:'wall',part:'ground',velocity:ground.moving?velocity:undefined}:'slip';
      }else if(dir[a]>0.2){sides[loName]={kind:'velocity',velocity,name:'inlet'+(Math.abs(dir[a])<0.999?'-'+loName:'')};sides[hiName]={kind:'pressure',name:'outlet'+(Math.abs(dir[a])<0.999?'-'+hiName:'')};}
      else if(dir[a]<-0.2){sides[hiName]={kind:'velocity',velocity,name:'inlet'+(Math.abs(dir[a])<0.999?'-'+hiName:'')};sides[loName]={kind:'pressure',name:'outlet'+(Math.abs(dir[a])<0.999?'-'+loName:'')};}
      else{sides[loName]='slip';sides[hiName]='slip';}
    }
    if(geometry.some(g=>g.part==='ground')&&ground)fail('the part name "ground" is taken by the ground plane; rename the item.');
    referenceSpeed=speed;
    referenceLength=e.referenceLength===undefined?Math.max(ext[0],ext[1],ext[2]):num(e.referenceLength,'external.referenceLength',0,true);
    referenceLengthSource=e.referenceLength===undefined?'largest extent of the bounding box of the geometry':'given';
    flowLength=Math.abs(dir[0])*grid.nx*grid.cell+Math.abs(dir[1])*grid.ny*grid.cell+Math.abs(dir[2])*grid.nz*grid.cell;
    const centre:[number,number,number]=[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2,(b.min[2]+b.max[2])/2];
    external={direction:dir,up:lift,side,speed,ground,bodySize,bodyBounds:b,momentCenter:e.momentCenter===undefined?centre:vec3(e.momentCenter,'external.momentCenter'),
      referenceArea:e.referenceArea===undefined?null:num(e.referenceArea,'external.referenceArea',0,true)};
    flowOptions={...common,grid,geometry,sides,referenceSpeed,initialVelocity:velocity};
    const cellsAcross=bodySize/grid.cell;
    if(cellsAcross<10)warnings.push(`the body is ${cellsAcross.toFixed(1)} cells across the flow; below about 10 the forces are rough. Raise resolution.cells or shrink the margins.`);
  }else{
    if(s.external!==undefined)fail('an internal study must not have an "external" section.');
    if(!isObject(s.internal))fail('internal is required for mode "internal".');
    const n=s.internal as Json;
    known(n,'internal',['inlets','outlets','domain','padding','referenceLength','referenceSpeed','acceleration','periodic','initialVelocity']);
    const inletsIn=n.inlets===undefined?[]:Array.isArray(n.inlets)?n.inlets as unknown[]:fail('internal.inlets must be an array.');
    const outletsIn=n.outlets===undefined?[]:Array.isArray(n.outlets)?n.outlets as unknown[]:fail('internal.outlets must be an array.');
    const patches:FlowPatch[]=[];let fastest=0,inflow=0,allRates=true,firstInletArea=0;
    inletsIn.forEach((raw,i)=>{
      if(!isObject(raw))fail(`internal.inlets[${i}] must be an object.`);
      const o=raw as Json;known(o,`internal.inlets[${i}]`,['name','shape','flowRate','speed','velocity','profile']);
      if(o.profile!==undefined&&o.profile!=='uniform'&&o.profile!=='parabolic')fail(`internal.inlets[${i}].profile must be 'uniform' or 'parabolic'.`);
      if(typeof o.name!=='string'||o.name.length===0)fail(`internal.inlets[${i}].name must be a non-empty string.`);
      const shape=readShape(o.shape,`internal.inlets[${i}].shape`),area=shapeArea(shape);
      const given=[o.flowRate,o.speed,o.velocity].filter(v=>v!==undefined).length;
      if(given!==1)fail(`internal.inlets[${i}] needs exactly one of flowRate, speed and velocity.`);
      const patch:FlowPatch={name:o.name as string,kind:'inlet',shape,flowRate:o.flowRate===undefined?undefined:num(o.flowRate,`internal.inlets[${i}].flowRate`),speed:o.speed===undefined?undefined:num(o.speed,`internal.inlets[${i}].speed`),velocity:o.velocity===undefined?undefined:vec3(o.velocity,`internal.inlets[${i}].velocity`),profile:o.profile as 'uniform'|'parabolic'|undefined};
      const sp=patch.flowRate!==undefined?Math.abs(patch.flowRate)/area:patch.speed!==undefined?Math.abs(patch.speed):Math.hypot(...patch.velocity!);
      if(sp>fastest)fastest=sp;
      if(patch.flowRate!==undefined)inflow+=patch.flowRate;else{allRates=false;inflow+=sp*area;}
      if(i===0)firstInletArea=area;
      patches.push(patch);
    });
    let smallestOutlet=Infinity;
    outletsIn.forEach((raw,i)=>{
      if(!isObject(raw))fail(`internal.outlets[${i}] must be an object.`);
      const o=raw as Json;known(o,`internal.outlets[${i}]`,['name','shape','pressure']);
      if(typeof o.name!=='string'||o.name.length===0)fail(`internal.outlets[${i}].name must be a non-empty string.`);
      const shape=readShape(o.shape,`internal.outlets[${i}].shape`);
      smallestOutlet=Math.min(smallestOutlet,shapeArea(shape));
      patches.push({name:o.name as string,kind:'outlet',shape,pressure:o.pressure===undefined?0:num(o.pressure,`internal.outlets[${i}].pressure`)});
    });
    void allRates;
    const periodicIn=n.periodic===undefined?[]:Array.isArray(n.periodic)?n.periodic as unknown[]:fail('internal.periodic must be an array of axis names.');
    for(const p of periodicIn)if(p!=='x'&&p!=='y'&&p!=='z')fail(`internal.periodic holds "${p}"; it takes 'x', 'y' and 'z'.`);
    const acceleration=n.acceleration===undefined?undefined:vec3(n.acceleration,'internal.acceleration');
    if(patches.length===0&&!acceleration)fail('an internal study needs inlets and outlets, or an acceleration with periodic sides.');
    if(inletsIn.length>0&&outletsIn.length===0)fail('an internal study with inlets needs at least one outlet (a pressure), or the mass in the box grows without bound.');
    let lo:number[],hi:number[];
    if(n.domain!==undefined){
      if(!isObject(n.domain))fail('internal.domain must be {min, max}.');
      lo=vec3((n.domain as Json).min,'internal.domain.min');hi=vec3((n.domain as Json).max,'internal.domain.max');
    }else{
      if(geometry.length===0)fail('internal: give geometry or a domain.');
      const b=flowGeometryBounds(geometry),pad=n.padding===undefined?0:num(n.padding,'internal.padding',0);
      lo=b.min.map(v=>v-pad);hi=b.max.map(v=>v+pad);
    }
    const grid=gridOf(lo,hi,[0,0,0]),sides:Partial<Record<FlowSideName,FlowSide>>={};
    for(const p of periodicIn){const a='xyz'.indexOf(p as string);sides[FLOW_SIDES[2*a]]='periodic';sides[FLOW_SIDES[2*a+1]]='periodic';}
    if(n.referenceSpeed!==undefined)referenceSpeed=num(n.referenceSpeed,'internal.referenceSpeed',0,true);
    else{
      referenceSpeed=Math.max(fastest,Number.isFinite(smallestOutlet)?Math.abs(inflow)/smallestOutlet:0);
      if(!(referenceSpeed>0))fail('internal.referenceSpeed is required when no inlet sets a speed (a flow driven by an acceleration).');
    }
    if(n.referenceLength!==undefined){referenceLength=num(n.referenceLength,'internal.referenceLength',0,true);referenceLengthSource='given';}
    else if(firstInletArea>0){referenceLength=Math.sqrt(4*firstInletArea/Math.PI);referenceLengthSource='diameter of the circle with the area of the first inlet';}
    else{referenceLength=Math.min(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2]);referenceLengthSource='smallest extent of the box';}
    flowLength=Math.max(grid.nx,grid.ny,grid.nz)*grid.cell;
    internal={inlets:inletsIn.map(i=>(i as Json).name as string),outlets:outletsIn.map(o=>(o as Json).name as string)};
    flowOptions={...common,grid,geometry,sides,patches,referenceSpeed,acceleration,initialVelocity:n.initialVelocity===undefined?undefined:vec3(n.initialVelocity,'internal.initialVelocity')};
  }
  const grid=flowOptions.grid,dt=(common.latticeSpeed??0.06)*grid.cell/referenceSpeed,transitTime=flowLength/referenceSpeed,transitSteps=transitTime/dt;
  const transits=runIn.transits===undefined?(mode==='external'?8:12):num(runIn.transits,'run.transits',0,true);
  const startup=runIn.startupTransits===undefined?1:num(runIn.startupTransits,'run.startupTransits',0);
  const windowT=runIn.windowTransits===undefined?1.5:num(runIn.windowTransits,'run.windowTransits',0,true);
  const windowSteps=Math.max(8,Math.round(windowT*transitSteps));
  let maxSteps=Math.max(windowSteps,Math.round(transits*transitSteps));
  if(runIn.maxSteps!==undefined)maxSteps=Math.min(maxSteps,Math.max(1,Math.floor(num(runIn.maxSteps,'run.maxSteps',1))));
  const monitorEvery=runIn.monitorEvery===undefined?Math.max(1,Math.round(windowSteps/60)):Math.max(1,Math.floor(num(runIn.monitorEvery,'run.monitorEvery',1)));
  const sampleEvery=runIn.sampleEvery===undefined?Math.max(1,Math.floor(monitorEvery/5)):Math.max(1,Math.floor(num(runIn.sampleEvery,'run.sampleEvery',1)));
  const tolerance=runIn.tolerance===undefined?0.02:num(runIn.tolerance,'run.tolerance',0);
  return {name:typeof s.name==='string'?s.name:'',mode:mode as 'external'|'internal',options:flowOptions,fluid,grid,referenceSpeed,referenceLength,referenceLengthSource,reynolds:referenceSpeed*referenceLength/fluid.viscosity,
    transitTime,external,internal,run:{maxSteps,startupSteps:Math.min(maxSteps,Math.round(startup*transitSteps)),windowSteps,monitorEvery,sampleEvery,tolerance},outputs,warnings};
}

/** A study in progress. */
export interface FlowStudyRun {
  readonly setup:FlowStudySetup;readonly flow:Flow;
  readonly done:boolean;
  /** Advance one monitor interval; returns the progress, or null when the run is over. */
  advance():FlowProgress|null;
  /** The result document. Call when `done` (calling earlier post-processes the run so far). */
  result():Json;
}

export function createFlowStudy(study:unknown,options:FlowStudyOptions={}):FlowStudyRun{
  const now=options.now??(()=>Date.now()),started=now();
  const setup=flowStudySetup(study,options),flow=new Flow(setup.options),run=setup.run,ext=setup.external;
  const warnings=[...setup.warnings,...flow.warnings],L=flow.lattice,g=flow.grid,rho=setup.fluid.density;
  // geometry parts (the first ones) take the body force; wall sides are reported, not summed
  const geometryParts=new Set(flow.surfaces.map(s=>s.part));
  let referenceArea=0,blockage=0,dynamicPressure=0;
  if(ext){
    dynamicPressure=0.5*rho*ext.speed*ext.speed;
    const voxelArea=flowProjectedArea(g,c=>flow.distance[c]<0,ext.direction);
    referenceArea=ext.referenceArea??voxelArea;
    const d=ext.direction,section=(Math.abs(d[0])*setup.grid.ny*setup.grid.nz+Math.abs(d[1])*setup.grid.nx*setup.grid.nz+Math.abs(d[2])*setup.grid.nx*setup.grid.ny)*g.cell*g.cell;
    blockage=voxelArea/section;
    if(blockage>0.1)warnings.push(`the blockage (frontal area over tunnel section) is ${(100*blockage).toFixed(1)}%: the drag is overestimated by roughly ${(100*(1/((1-blockage)*(1-blockage))-1)).toFixed(0)}%. Widen the margins.`);
    else if(blockage>0.05)warnings.push(`the blockage (frontal area over tunnel section) is ${(100*blockage).toFixed(1)}%; above 5% the forces are a few percent high.`);
    if(!(referenceArea>0))fail('the geometry casts no shadow along the flow: there is no solid cell.');
  }
  if(flow.enclosedCells>0)warnings.push(`${flow.enclosedCells} fluid cells are cut off from every inlet and outlet (the inside of a hollow part); they were made solid.`);
  const about:FlowVec3=ext?ext.momentCenter:[0,0,0];
  // fluid cells that touch each patch, for its pressure
  const patchCells:number[][]=flow.patches.map(()=>[]);
  {
    const {nx,ny,nz}=g;
    for(let k=0,c=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++,c++){
      if(L.kind[c]!==2&&L.kind[c]!==3)continue;
      for(const [di,dj,dk] of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){
        const a=i+di,b=j+dj,e=k+dk;if(a<0||b<0||e<0||a>=nx||b>=ny||e>=nz)continue;
        const q=a+nx*(b+ny*e);if(L.kind[q]===0)patchCells[L.owner[c]].push(q);
      }
    }
  }
  // per-part forces of every monitor interval, to average over the same steps as the coefficients
  const partRows:{name:string;force:[number,number,number];moment:[number,number,number]}[][]=[];
  const partMean=(from:number,upto:number):{name:string;force:number[];moment:number[]}[]=>flow.parts.map((name,p)=>{
    const force=[0,0,0],moment=[0,0,0];let n=0;
    for(let i=from;i<upto&&i<partRows.length;i++){for(let a=0;a<3;a++){force[a]+=partRows[i][p].force[a];moment[a]+=partRows[i][p].moment[a];}n++;}
    return {name,force:force.map(v=>n?v/n:0),moment:moment.map(v=>n?v/n:0)};
  });
  // history
  const H={step:[] as number[],time:[] as number[],residual:[] as number[],maxSpeed:[] as number[],drag:[] as number[],lift:[] as number[],side:[] as number[],massBalance:[] as number[],
    flowRates:flow.patches.map(()=>[] as number[]),patchPressure:flow.patches.map(()=>[] as number[]),bulkSpeed:[] as number[]};
  const previous=new Float32Array(3*L.cells);
  let done=false,converged=false,reason='max-steps',windowIndex=0,windowStart=run.startupSteps,lastMean:FlowField|null=null,meanSteps=0,meanFrom=0;
  let lastWindowMeans:number[]|null=null,windowsDone=0;
  // sums of the history over the current window, to compare consecutive windows
  const monitors=():number[]=>{
    const from=H.step.findIndex(sx=>sx>windowStart),out:number[]=[];
    const mean=(a:number[]):number=>{let sum=0,n=0;for(let i=Math.max(0,from);i<a.length;i++){sum+=a[i];n++;}return n?sum/n:0;};
    if(ext)out.push(mean(H.drag),mean(H.lift),mean(H.side));
    else{for(const q of H.flowRates)out.push(mean(q));for(const p of H.patchPressure)out.push(mean(p));out.push(mean(H.bulkSpeed));}
    return out;
  };
  const closeWindow=():void=>{
    if(flow.meanSamples>0){lastMean=flow.field(true);meanSteps=L.stepCount-windowStart;meanFrom=windowStart;}
    const means=monitors();
    if(lastWindowMeans){
      let ok=true;
      if(ext){const scale=Math.max(Math.abs(means[0]),1e-30);for(let i=0;i<3;i++)if(Math.abs(means[i]-lastWindowMeans[i])>run.tolerance*scale)ok=false;}
      else{
        const nq=flow.patches.length;let qScale=0,pScale=0;
        for(let i=0;i<nq;i++){qScale=Math.max(qScale,Math.abs(means[i]));pScale=Math.max(pScale,Math.abs(means[nq+i]));}
        for(let i=0;i<nq;i++){if(Math.abs(means[i]-lastWindowMeans[i])>run.tolerance*Math.max(qScale,1e-30))ok=false;if(Math.abs(means[nq+i]-lastWindowMeans[nq+i])>run.tolerance*Math.max(pScale,1e-30))ok=false;}
        const bs=Math.max(Math.abs(means[2*nq]),1e-30);if(Math.abs(means[2*nq]-lastWindowMeans[2*nq])>run.tolerance*bs)ok=false;
      }
      if(ok){converged=true;reason='tolerance';done=true;}
    }
    lastWindowMeans=means;windowsDone++;windowIndex++;windowStart=L.stepCount;
    if(!done)flow.resetMean();
  };
  const advance=():FlowProgress|null=>{
    if(done)return null;
    const target=Math.min(run.maxSteps,L.stepCount+run.monitorEvery);
    while(L.stepCount<target){
      const toSample=run.sampleEvery-(L.stepCount%run.sampleEvery),n=Math.min(target-L.stepCount,toSample);
      flow.step(n);
      if(L.stepCount>run.startupSteps&&L.stepCount%run.sampleEvery===0)flow.accumulate();
    }
    if(!flow.healthy()){
      done=true;reason='diverged';
      throw new EngineError('INVALID_STATE',`flow study: the run diverged at step ${L.stepCount} (a density or velocity left the valid range). Lower resolution.latticeSpeed, raise the resolution, or set model.turbulence to 'smagorinsky'.`);
    }
    const sums=flow.takeSums(about);partRows.push(sums.parts);
    let fx=0,fy=0,fz=0;
    for(const p of sums.parts)if(geometryParts.has(p.name)){fx+=p.force[0];fy+=p.force[1];fz+=p.force[2];}
    let cd=0,cl=0,cs=0;
    if(ext){const q=dynamicPressure*referenceArea;cd=(fx*ext.direction[0]+fy*ext.direction[1]+fz*ext.direction[2])/q;cl=(fx*ext.up[0]+fy*ext.up[1]+fz*ext.up[2])/q;cs=(fx*ext.side[0]+fy*ext.side[1]+fz*ext.side[2])/q;}
    let inflow=0,outflow=0;sums.flowRates.forEach(q=>{if(q>0)inflow+=q;else outflow-=q;});
    const balance=inflow>0?(inflow-outflow)/inflow:0;
    // residual: rms change of the velocity over the interval, over the reference speed
    const ux=L.ux,uy=L.uy,uz=L.uz;let sum=0,vmax=0,bulk=0;
    for(let c=0;c<L.cells;c++){
      const a=ux[c],b=uy[c],e=uz[c],da=a-previous[3*c],db=b-previous[3*c+1],de=e-previous[3*c+2];
      sum+=da*da+db*db+de*de;previous[3*c]=a;previous[3*c+1]=b;previous[3*c+2]=e;
      const sq=a*a+b*b+e*e;if(sq>vmax)vmax=sq;bulk+=Math.sqrt(sq);
    }
    const residual=Math.sqrt(sum/L.fluidCells)/flow.latticeSpeed,vScale=flow.cell/flow.dt;
    H.step.push(L.stepCount);H.time.push(flow.time);H.residual.push(residual);H.maxSpeed.push(Math.sqrt(vmax)*vScale);
    H.drag.push(cd);H.lift.push(cl);H.side.push(cs);H.massBalance.push(balance);H.bulkSpeed.push(bulk/L.fluidCells*vScale);
    sums.flowRates.forEach((q,i)=>H.flowRates[i].push(q));
    const pScale=rho*vScale*vScale/3;
    patchCells.forEach((cellsOf,i)=>{let p=0;for(const c of cellsOf)p+=L.density[c];H.patchPressure[i].push(cellsOf.length?p/cellsOf.length*pScale:0);});
    const phase=L.stepCount>run.startupSteps?'averaging':'startup';
    if(L.stepCount-windowStart>=run.windowSteps&&L.stepCount>run.startupSteps)closeWindow();
    if(!done&&L.stepCount>=run.maxSteps){
      done=true;
      // a window that is at least half done counts when no window was completed
      if(flow.meanSamples>0&&(lastMean===null||L.stepCount-windowStart>=run.windowSteps/2)){lastMean=flow.field(true);meanSteps=L.stepCount-windowStart;meanFrom=windowStart;}
    }
    const progress:FlowProgress={step:L.stepCount,maxSteps:run.maxSteps,time:flow.time,fraction:L.stepCount/run.maxSteps,residual,coefficients:ext?{cd,cl,cs}:null,massBalance:ext?null:balance,window:windowIndex,phase};
    options.onProgress?.(progress);
    return progress;
  };

  const result=():Json=>{
    const field=lastMean??flow.field(false),meanUsed=lastMean!==null,wall=(now()-started)/1000;
    if(!meanUsed)warnings.push('the run ended before any sample was averaged: the fields are those of the last step.');
    // means of the history over the averaged steps
    const from=Math.max(0,H.step.findIndex(sx=>sx>meanFrom)),upto=H.step.length;
    const meanOf=(a:number[]):number=>{let sum=0,n=0;for(let i=from;i<upto;i++){sum+=a[i];n++;}return n?sum/n:0;};
    const rmsOf=(a:number[]):number=>{const m=meanOf(a);let sum=0,n=0;for(let i=from;i<upto;i++){sum+=(a[i]-m)*(a[i]-m);n++;}return n?Math.sqrt(sum/n):0;};
    const vScale=flow.cell/flow.dt,out:Json={format:FLOW_RESULT_FORMAT,name:setup.name,
      solver:{id:FLOW_SOLVER_ID,version:FLOW_SOLVER_VERSION,statement:FLOW_STATEMENT}};
    const sg=setup.grid;
    out.setup={mode:setup.mode,fluid:{density:rho,viscosity:setup.fluid.viscosity},
      grid:{origin:[...sg.origin],cell:sg.cell,nx:sg.nx,ny:sg.ny,nz:sg.nz,min:[...sg.origin],max:[sg.origin[0]+sg.nx*sg.cell,sg.origin[1]+sg.ny*sg.cell,sg.origin[2]+sg.nz*sg.cell]},
      lattice:{origin:[...g.origin],cell:g.cell,nx:g.nx,ny:g.ny,nz:g.nz,cells:L.cells,fluidCells:flow.fluidCells,solidCells:flow.solidCells,enclosedCells:flow.enclosedCells,boundaryLinks:L.linkCount},
      timeStep:flow.dt,latticeSpeed:flow.latticeSpeed,latticeMach:flow.latticeSpeed*Math.sqrt(3),relaxationTime:flow.relaxationTime,cellReynolds:flow.cellReynolds,
      turbulence:{model:flow.turbulence,smagorinsky:flow.turbulence==='smagorinsky'?flow.smagorinsky:null},walls:L.walls,
      referenceSpeed:setup.referenceSpeed,referenceLength:{value:setup.referenceLength,source:setup.referenceLengthSource},reynolds:setup.reynolds,transitTime:setup.transitTime,
      external:ext?{speed:ext.speed,direction:ext.direction,up:ext.up,side:ext.side,ground:ext.ground,bodySize:ext.bodySize,bodyCells:ext.bodySize/g.cell,bodyBounds:ext.bodyBounds,blockage,
        referenceArea:{value:referenceArea,source:ext.referenceArea===null?'shadow of the solid cells along the flow (half-cell grid)':'given'},dynamicPressure,momentCenter:ext.momentCenter}:null,
      internal:setup.internal,
      sides:Object.fromEntries(FLOW_SIDES.map(name=>{const sd=setup.options.sides?.[name]??'wall';return [name,typeof sd==='string'?sd:sd.kind];})),
      patches:flow.patches.map(p=>({...p})),parts:[...flow.parts],geometry:flow.items.map(i=>({...i})),
      controls:{...run}};
    out.run={steps:L.stepCount,time:flow.time,wallTime:wall,cellUpdatesPerSecond:wall>0?flow.fluidCells*L.stepCount/wall:0,converged,reason,windows:windowsDone,
      averaged:meanUsed?{fromStep:meanFrom,steps:meanSteps,time:meanSteps*flow.dt,samples:Math.floor(meanSteps/run.sampleEvery)}:null,maxSpeed:H.maxSpeed.length?Math.max(...H.maxSpeed):0};
    const peak=(out.run as Json).maxSpeed as number;
    if(peak>3*setup.referenceSpeed)warnings.push(`the largest speed ${peak.toPrecision(3)} m/s is ${(peak/setup.referenceSpeed).toFixed(1)} times the reference speed: the lattice Mach number reached ${(peak/vScale*Math.sqrt(3)).toFixed(2)}; compressibility errors are large. Lower resolution.latticeSpeed or set internal.referenceSpeed.`);
    if(!converged&&reason==='max-steps')warnings.push(`the run stopped at its step limit before two consecutive windows agreed to ${run.tolerance}; the means are those of the last window.`);
    if(outputs(setup).history)out.convergence={tolerance:run.tolerance,startupSteps:run.startupSteps,windowSteps:run.windowSteps,monitorEvery:run.monitorEvery,
      history:{step:H.step,time:list(H.time),residual:list(H.residual),maxSpeed:list(H.maxSpeed),...(ext?{cd:list(H.drag),cl:list(H.lift),cs:list(H.side)}:{massBalance:list(H.massBalance),bulkSpeed:list(H.bulkSpeed),
        flowRates:Object.fromEntries(flow.patches.map((p,i)=>[p.name,list(H.flowRates[i])])),patchPressure:Object.fromEntries(flow.patches.map((p,i)=>[p.name,list(H.patchPressure[i])]))})}};
    // forces: means over the averaged steps come from the history of the coefficients; per part from the sums of the same steps
    const partMeans=partMean(from,upto);
    const total={force:[0,0,0],moment:[0,0,0]};
    for(const p of partMeans)if(geometryParts.has(p.name))for(let a=0;a<3;a++){total.force[a]+=p.force[a];total.moment[a]+=p.moment[a];}
    out.forces={about:[...about],total,parts:partMeans,
      coefficients:ext?{cd:meanOf(H.drag),cl:meanOf(H.lift),cs:meanOf(H.side),cdRms:rmsOf(H.drag),clRms:rmsOf(H.lift),csRms:rmsOf(H.side),
        cm:total.moment.map(mo=>mo/(dynamicPressure*referenceArea*setup.referenceLength)),referenceArea,referenceLength:setup.referenceLength,dynamicPressure,axes:{drag:ext.direction,lift:ext.up,side:ext.side}}:null};
    // flow rates and pressures at the patches
    {
      const rows=flow.patches.map((p,i)=>{
        let ps=0,dyn=0;const cellsOf=patchCells[i];
        for(const c of cellsOf){ps+=field.pressure[c];dyn+=0.5*rho*(field.ux[c]*field.ux[c]+field.uy[c]*field.uy[c]+field.uz[c]*field.uz[c]);}
        const n=Math.max(1,cellsOf.length),q=meanOf(H.flowRates[i]);
        return {name:p.name,kind:p.kind,flowRate:q,area:p.area,meanSpeed:p.area>0?Math.abs(q)/p.area:0,meanPressure:ps/n,meanDynamicPressure:dyn/n,meanTotalPressure:(ps+dyn)/n};
      });
      let inflow=0,outflow=0;for(const r of rows){if(r.flowRate>0)inflow+=r.flowRate;else outflow-=r.flowRate;}
      const drops:Json[]=[];
      for(const a of rows)if(a.kind==='inlet')for(const b of rows)if(b.kind==='outlet')drops.push({from:a.name,to:b.name,static:a.meanPressure-b.meanPressure,total:a.meanTotalPressure-b.meanTotalPressure});
      const sectionsIn=Array.isArray(setup.outputs.sections)?setup.outputs.sections as unknown[]:[];
      const sections=sectionsIn.map((raw,i)=>{
        if(!isObject(raw))fail(`outputs.sections[${i}] must be an object.`);
        const o=raw as Json;known(o,`outputs.sections[${i}]`,['name','axis','position','min','max']);
        const sec=flowSection(field,rho,o.axis as 'x',num(o.position,`outputs.sections[${i}].position`),o.min!==undefined&&o.max!==undefined?{min:vec3(o.min,'min'),max:vec3(o.max,'max')}:undefined);
        return {name:typeof o.name==='string'?o.name:`section-${i}`,...sec};
      });
      out.flow={patches:rows,inflow,outflow,massBalance:inflow>0?(inflow-outflow)/inflow:0,splits:rows.filter(r=>r.kind==='outlet').map(r=>({name:r.name,fraction:outflow>0?-r.flowRate/outflow:0})),pressureDrops:drops,sections};
    }
    // actuator discs: the speed of the fluid through them
    out.actuators=flow.actuators.map((act,i)=>{
      let through=0;const cellsOf=flow.actuatorCells[i];
      for(const c of cellsOf)through+=field.ux[c]*act.axis[0]+field.uy[c]*act.axis[1]+field.uz[c]*act.axis[2];
      const speed=cellsOf.length?through/cellsOf.length:0;
      return {name:act.name,cells:act.cells,force:act.force,axis:act.axis,area:act.area,pressureJump:act.force/act.area,meanSpeed:speed,flowRate:speed*act.area,power:act.force*speed};
    });
    // wake: shedding frequency from the cross-flow forces, recirculation behind the body
    if(ext){
      const dtSample=run.monitorEvery*flow.dt,slice=(a:number[]):number[]=>a.slice(Math.max(0,H.step.findIndex(sx=>sx>run.startupSteps)));
      const fl=flowFrequency(slice(H.lift),dtSample),fs=flowFrequency(slice(H.side),dtSample),drag=Math.abs(meanOf(H.drag));
      const pick=fl&&fs?(fl.amplitude>=fs.amplitude?fl:fs):fl??fs;
      const shedding=pick&&pick.periods>=3&&pick.amplitude>0.01*Math.max(drag,1e-30)?{frequency:pick.frequency,strouhal:pick.frequency*ext.bodySize/ext.speed,length:ext.bodySize,periods:pick.periods,amplitude:pick.amplitude,axis:pick===fl?'lift':'side'}:null;
      const b=ext.bodyBounds,d=ext.direction,centre:[number,number,number]=[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2,(b.min[2]+b.max[2])/2];
      const half=0.5*(Math.abs(d[0])*(b.max[0]-b.min[0])+Math.abs(d[1])*(b.max[1]-b.min[1])+Math.abs(d[2])*(b.max[2]-b.min[2]));
      const rear:[number,number,number]=[centre[0]+half*d[0],centre[1]+half*d[1],centre[2]+half*d[2]];
      // to the end of the box along the flow
      let reach=Infinity;
      for(let a=0;a<3;a++){if(d[a]>1e-9)reach=Math.min(reach,(sg.origin[a]+[sg.nx,sg.ny,sg.nz][a]*sg.cell-rear[a])/d[a]);else if(d[a]<-1e-9)reach=Math.min(reach,(sg.origin[a]-rear[a])/d[a]);}
      let recirculation:number|null=null;
      if(reach>2*g.cell){
        const end:[number,number,number]=[rear[0]+reach*d[0],rear[1]+reach*d[1],rear[2]+reach*d[2]],line=flowLine(field,rear,end,Math.max(8,Math.round(2*reach/g.cell)),d);
        // the first sample in the fluid must run backwards for a recirculation to be there
        let first=-1;for(let i=0;i<line.s.length;i++)if(line.distance[i]>0.5*g.cell){first=i;break;}
        if(first>=0&&line.ux[first]*d[0]+line.uy[first]*d[1]+line.uz[first]*d[2]<0){const z=line.zeroCrossings.find(v=>v>line.s[first]);if(z!==undefined)recirculation=z;}
      }
      out.wake={shedding,recirculationLength:recirculation,recirculationFrom:rear};
    }else out.wake=null;
    // streamlines
    const sl=setup.outputs.streamlines;
    if(sl!==undefined&&sl!==false){
      const o=sl===true?{}:isObject(sl)?sl as Json:fail('outputs.streamlines must be true, false or an object.');
      known(o,'outputs.streamlines',['seeds','count','field','step','maxPoints','stride','direction']);
      const which=o.field??'mean';if(which!=='mean'&&which!=='instant')fail(`outputs.streamlines.field must be 'mean' or 'instant'.`);
      const f=which==='instant'?flow.field(false):field,count=o.count===undefined?64:Math.max(1,Math.floor(num(o.count,'outputs.streamlines.count',1)));
      const seeds=readSeeds(o.seeds??'auto',count,setup,flow);
      const lines=flowStreamlines(f,seeds,{step:o.step===undefined?undefined:num(o.step,'outputs.streamlines.step',0,true),maxPoints:o.maxPoints===undefined?undefined:num(o.maxPoints,'outputs.streamlines.maxPoints',2),stride:o.stride===undefined?undefined:num(o.stride,'outputs.streamlines.stride',1),direction:(o.direction??'forward') as 'forward'});
      let lo=Infinity,hi=-Infinity;for(const l of lines)for(let i=0;i<l.speed.length;i++){if(l.speed[i]<lo)lo=l.speed[i];if(l.speed[i]>hi)hi=l.speed[i];}
      out.streamlines={field:which==='instant'||!meanUsed?'instant':'mean',speedRange:lines.length?[r6(lo),r6(hi)]:[0,0],lines:lines.map(l=>({seed:l.seed,termination:l.termination,points:list(l.points),speed:list(l.speed),pressure:list(l.pressure)}))};
    }
    // slices
    if(setup.outputs.slices!==undefined){
      if(!Array.isArray(setup.outputs.slices))fail('outputs.slices must be an array.');
      out.slices=(setup.outputs.slices as unknown[]).map((raw,i)=>{
        if(!isObject(raw))fail(`outputs.slices[${i}] must be an object.`);
        const o=raw as Json;known(o,`outputs.slices[${i}]`,['axis','position','fraction','field']);
        const a='xyz'.indexOf(o.axis as string);if(a<0||typeof o.axis!=='string'||o.axis.length!==1)fail(`outputs.slices[${i}].axis must be 'x', 'y' or 'z'.`);
        const lo=sg.origin[a],len=[sg.nx,sg.ny,sg.nz][a]*sg.cell;
        if((o.position===undefined)===(o.fraction===undefined))fail(`outputs.slices[${i}] needs exactly one of position (m) and fraction (0 to 1 of the box).`);
        const position=o.position!==undefined?num(o.position,`outputs.slices[${i}].position`):lo+len*num(o.fraction,`outputs.slices[${i}].fraction`,0);
        const sc=flowSlice(o.field==='instant'?flow.field(false):field,o.axis as 'x',position);
        return {axis:sc.axis,position:sc.position,axes:sc.axes,nu:sc.nu,nv:sc.nv,origin:sc.origin,cell:sc.cell,speed:list(sc.speed),pressure:list(sc.pressure),u:list(sc.u),v:list(sc.v),fluid:Array.from(sc.fluid)};
      });
    }
    // surface pressure
    if(setup.outputs.surface===true){
      const q=ext?dynamicPressure:0.5*rho*setup.referenceSpeed*setup.referenceSpeed;
      out.surface=flowSurfacePressure(field,flow.surfaces).map(sf=>({part:sf.part,positions:list(sf.positions),indices:Array.from(sf.indices),pressure:list(sf.pressure),cp:list(sf.pressure.map(p=>p/q))}));
    }else if(setup.outputs.surface!==undefined&&setup.outputs.surface!==false)fail('outputs.surface must be true or false.');
    if(setup.outputs.lines!==undefined){
      if(!Array.isArray(setup.outputs.lines))fail('outputs.lines must be an array.');
      out.lines=(setup.outputs.lines as unknown[]).map((raw,i)=>{
        if(!isObject(raw))fail(`outputs.lines[${i}] must be an object.`);
        const o=raw as Json;known(o,`outputs.lines[${i}]`,['name','from','to','samples','along']);
        const ln=flowLine(field,vec3(o.from,`outputs.lines[${i}].from`),vec3(o.to,`outputs.lines[${i}].to`),o.samples===undefined?101:num(o.samples,`outputs.lines[${i}].samples`,2),o.along===undefined?undefined:vec3(o.along,`outputs.lines[${i}].along`));
        return {name:typeof o.name==='string'?o.name:`line-${i}`,from:ln.from,to:ln.to,s:list(ln.s),ux:list(ln.ux),uy:list(ln.uy),uz:list(ln.uz),speed:list(ln.speed),pressure:list(ln.pressure),distance:list(ln.distance),zeroCrossings:ln.zeroCrossings.map(r6)};
      });
    }
    out.warnings=[...new Set(warnings)];out.limits=[...FLOW_LIMITS];
    return out;
  };
  return {setup,flow,get done(){return done;},advance,result};
}
const outputs=(setup:FlowStudySetup):{history:boolean}=>({history:setup.outputs.history!==false});

function readSeeds(raw:unknown,count:number,setup:FlowStudySetup,flow:Flow):FlowVec3[]{
  const h=flow.cell;
  if(raw==='auto'){
    if(setup.external){
      // a grid upstream of the body, over its shadow widened by 15% of the body size
      const e=setup.external,b=e.bodyBounds,d=e.direction,centre:[number,number,number]=[(b.min[0]+b.max[0])/2,(b.min[1]+b.max[1])/2,(b.min[2]+b.max[2])/2];
      const extent=(axis:FlowVec3):number=>Math.abs(axis[0])*(b.max[0]-b.min[0])+Math.abs(axis[1])*(b.max[1]-b.min[1])+Math.abs(axis[2])*(b.max[2]-b.min[2]);
      const along=extent(d)/2+Math.min(e.bodySize,0.8*upstreamRoom(setup,centre,d,extent(d)/2)),w=extent(e.side)+0.3*e.bodySize,t=extent(e.up)+0.3*e.bodySize;
      let low=-t/2;
      if(e.ground){const base=dot(centre,e.up)-extent(e.up)/2;low=base-dot(centre,e.up)+0.75*h;}
      const height=t/2-low,nu=Math.max(1,Math.round(Math.sqrt(count*w/height))),nv=Math.max(1,Math.round(count/nu));
      const origin:[number,number,number]=[centre[0]-along*d[0]-w/2*e.side[0]+low*e.up[0],centre[1]-along*d[1]-w/2*e.side[1]+low*e.up[1],centre[2]-along*d[2]-w/2*e.side[2]+low*e.up[2]];
      return flowSeedPlane(origin,[w*e.side[0],w*e.side[1],w*e.side[2]],[height*e.up[0],height*e.up[1],height*e.up[2]],nu,nv);
    }
    // internal: points spread over every inlet, one cell into the fluid
    const inlets=(setup.options.patches??[]).filter(p=>p.kind==='inlet'),seeds:FlowVec3[]=[];
    if(inlets.length===0){
      const g=setup.grid;return flowSeedPlane([g.origin[0]+0.5*h,g.origin[1],g.origin[2]],[0,g.ny*h,0],[0,0,g.nz*h],Math.max(1,Math.round(Math.sqrt(count))),Math.max(1,Math.round(Math.sqrt(count))));
    }
    const total=inlets.reduce((a,p)=>a+shapeArea(p.shape),0);
    for(const p of inlets){
      const n=Math.max(3,Math.round(count*shapeArea(p.shape)/total)),sh=p.shape,nr=unit(sh.normal,'normal');
      let u=Math.abs(nr[1])<0.9?cross([0,1,0],nr):cross([1,0,0],nr);u=unit(u,'u');const v=cross(nr,u);
      const c:[number,number,number]=[sh.center[0]+1.25*h*nr[0],sh.center[1]+1.25*h*nr[1],sh.center[2]+1.25*h*nr[2]];
      if(sh.kind==='disc'){
        // sunflower pattern, kept 15% inside the rim
        for(let i=0;i<n;i++){const r=0.85*sh.radius*Math.sqrt((i+0.5)/n),a=i*2.399963229728653;seeds.push([c[0]+r*(Math.cos(a)*u[0]+Math.sin(a)*v[0]),c[1]+r*(Math.cos(a)*u[1]+Math.sin(a)*v[1]),c[2]+r*(Math.cos(a)*u[2]+Math.sin(a)*v[2])]);}
      }else{
        const upv=sh.up?unit([sh.up[0]-dot(sh.up,nr)*nr[0],sh.up[1]-dot(sh.up,nr)*nr[1],sh.up[2]-dot(sh.up,nr)*nr[2]],'up'):unit(cross(nr,u),'up'),wv=cross(upv,nr);
        const nu=Math.max(1,Math.round(Math.sqrt(n*sh.halfWidth/sh.halfHeight))),nv=Math.max(1,Math.round(n/nu));
        seeds.push(...flowSeedPlane([c[0]-0.85*(sh.halfWidth*wv[0]+sh.halfHeight*upv[0]),c[1]-0.85*(sh.halfWidth*wv[1]+sh.halfHeight*upv[1]),c[2]-0.85*(sh.halfWidth*wv[2]+sh.halfHeight*upv[2])],
          [1.7*sh.halfWidth*wv[0],1.7*sh.halfWidth*wv[1],1.7*sh.halfWidth*wv[2]],[1.7*sh.halfHeight*upv[0],1.7*sh.halfHeight*upv[1],1.7*sh.halfHeight*upv[2]],nu,nv));
      }
    }
    return seeds;
  }
  if(!Array.isArray(raw))fail(`outputs.streamlines.seeds must be 'auto' or an array of seed sets.`);
  const seeds:FlowVec3[]=[];
  (raw as unknown[]).forEach((item,i)=>{
    if(!isObject(item))fail(`outputs.streamlines.seeds[${i}] must be an object.`);
    const o=item as Json,name=`outputs.streamlines.seeds[${i}]`;
    if(o.kind==='rake'){known(o,name,['kind','from','to','count']);seeds.push(...flowRake(vec3(o.from,`${name}.from`),vec3(o.to,`${name}.to`),Math.floor(num(o.count,`${name}.count`,1))));}
    else if(o.kind==='plane'){known(o,name,['kind','origin','u','v','nu','nv']);seeds.push(...flowSeedPlane(vec3(o.origin,`${name}.origin`),vec3(o.u,`${name}.u`),vec3(o.v,`${name}.v`),Math.floor(num(o.nu,`${name}.nu`,1)),Math.floor(num(o.nv,`${name}.nv`,1))));}
    else if(o.kind==='points'){known(o,name,['kind','points']);if(!Array.isArray(o.points))fail(`${name}.points must be an array of [x, y, z].`);(o.points as unknown[]).forEach((p,j)=>seeds.push(vec3(p,`${name}.points[${j}]`)));}
    else fail(`${name}.kind must be 'rake', 'plane' or 'points'.`);
  });
  return seeds;
}
/** Distance from the front of the body to the upstream end of the box, along -d. */
function upstreamRoom(setup:FlowStudySetup,centre:FlowVec3,d:FlowVec3,half:number):number{
  const g=setup.grid,n=[g.nx,g.ny,g.nz];let room=Infinity;
  for(let a=0;a<3;a++){
    if(d[a]>1e-9)room=Math.min(room,(centre[a]-g.origin[a])/d[a]);
    else if(d[a]<-1e-9)room=Math.min(room,(centre[a]-(g.origin[a]+n[a]*g.cell))/d[a]);
  }
  return Math.max(0,room-half-1.5*g.cell);
}

/** Run a study to its end and return the result document. */
export function runFlowStudy(study:unknown,options:FlowStudyOptions={}):Json{
  const run=createFlowStudy(study,options);
  while(!run.done)run.advance();
  return run.result();
}
