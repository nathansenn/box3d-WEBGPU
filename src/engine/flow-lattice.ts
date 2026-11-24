/**
 * Lattice-Boltzmann kernel of the flow solvers (float64, JavaScript, deterministic). Lattice units: the cell is 1, the
 * step is 1, the reference density is 1. `flow.ts` owns the SI units, the geometry and the set-up; this file is only
 * the numerics.
 *
 * The lattice is D3Q19. A population f_i moves with the velocity c_i (rest, 6 axis and 12 edge neighbours); the
 * arrays hold the deviation f_i - w_i from the fluid at rest, which keeps the round-off of a weak flow small. One step
 * of a fluid cell is "pull, then collide":
 *
 *   g_i      = f*_i(x - c_i, t)                                          (streaming; boundary links below)
 *   rho      = sum g_i,   rho u = sum c_i g_i + F / 2,   P = sum c_i c_i g_i
 *   Pi       = P - rho u u - (rho / 3) I                                 (non-equilibrium stress)
 *   f*_i     = w_i [ rho + 3 c_i . (rho u + F / 2) + 9/2 (c_i c_i - I / 3) : (rho u u + (1 - 1/tau) dev Pi + (1 - 1/tau_b) tr Pi / 3 I) ]
 *
 * which is the regularised collision of Latt & Chopard (2006): the populations are rebuilt from the ten moments
 * (density, momentum, stress), so the "ghost" modes that make the plain BGK collision unstable at small viscosity are
 * removed every step. The deviatoric stress relaxes with tau = 3 nu + 1/2 (the shear viscosity), the trace with tau_b
 * (a bulk viscosity, default tau_b = 1, which damps sound waves and does not enter an incompressible flow).
 *
 * Sub-grid model (large-eddy simulation). With `smagorinsky` Cs > 0 the relaxation time is local:
 *
 *   tau = 1/2 ( tau_0 + sqrt( tau_0^2 + 18 sqrt(2) Cs^2 |dev Pi| / rho ) ),      |A| = sqrt(A : A)
 *
 * which is nu_t = (Cs)^2 |S| with |S| = sqrt(2 S : S) and the strain rate read from the non-equilibrium stress,
 * S = -3 Pi / (2 rho tau) (Hou et al. 1996). No velocity gradient is differenced.
 *
 * Wall function. With the sub-grid model on, the boundary layers are not resolved: the velocity falls to zero inside
 * half a cell, and a no-slip bounce-back wall then takes a shear stress set by the lattice, not by the fluid (measured
 * here: a skin-friction coefficient of 0.02 to 0.04 on a tunnel floor, ten to twenty times that of a turbulent boundary
 * layer). With `wallFunction` a cell that touches a wall is treated as the first cell of a wall-modelled large-eddy
 * simulation instead:
 *
 *   - its wall links bounce back from a wall that moves with the cell's own velocity made tangent to the wall
 *     (u_t = u - (u . n) n, n along N = sum of w_i c_i over its wall links), so the wall takes the pressure and no
 *     shear (a slip wall, on any staircase);
 *   - the shear stress of a turbulent boundary layer is then taken out of the cell as a force, - tau_w a u_t / |u_t|,
 *     a = 6 |N| the wall area of the cell, with the power law u+ = 8.3 (y+)^(1/7) (Werner & Wengle 1991) for the
 *     velocity u_t at the distance y of the cell from the wall, and the viscous law below it:
 *
 *       tau_w = max( nu |u_t| / y,  ( |u_t|^7 nu / (8.3^7 y) )^(1/4) )            (a fourth root is two square roots)
 *
 *   - the same force, with the opposite sign, is added to the force on the part.
 *
 * Without the sub-grid model (a resolved laminar flow) walls are plain no-slip bounce-back.
 *
 * Boundary links. A fluid cell whose neighbour x - c_i is not fluid takes g_i from a rule, with i' the direction
 * opposite to i (it points at the neighbour) and q the fraction of the link that is in the fluid:
 *
 *   wall         q < 1/2:   g_i = 2 q f*_i'(x) + (1 - 2 q) f*_i'(x + c_i) + 6 w_i c_i . u_w
 *                q >= 1/2:  g_i = [ f*_i'(x) + (2 q - 1) f*_i(x) + 6 w_i c_i . u_w ] / (2 q)
 *                           (Bouzidi, Firdaouss & Lallemand 2001; q = 1/2 is the half-way bounce-back; u_w is the
 *                           velocity of the wall, which is how a moving ground and a velocity inlet are made)
 *   pressure     g_i = - f*_i'(x) + 2 w_i rho_p ( 1 + 9/2 (c_i . u)^2 - 3/2 u^2 )     (anti-bounce-back; u of the cell)
 *   slip         g_i = f*_m(x - c_i tangential), m the mirror image of i in the side (specular reflection)
 *
 * A velocity inlet is a wall link whose u_w is the inlet velocity minus n (rho - <rho>) / sqrt(3): the characteristic
 * impedance of the lattice, so that sound leaves through the inlet instead of standing between it and the outlets.
 * rho is the mean density over the inlet (one number per inlet: a correction per cell would feed on the Bernoulli
 * pressure of a local jet), <rho> the same low-passed over `absorbSteps` steps, so the mean velocity is the one given.
 *
 * The interpolation of a wall link does not conserve mass; what the wall links of a cell create is taken from the rest
 * population of that cell, so that walls neither add nor remove mass (the mass of a moving wall's own term apart).
 *
 * Forces by momentum exchange (Ladd 1994): a wall link gives the wall the momentum c_i' (f*_i'(x) + g_i) per step. The
 * mass that enters through a link is g_i - f*_i'(x); summed per inlet and outlet it is the discrete mass flux, and the
 * sum over every link is exactly the change of the mass on the lattice.
 *
 * Storage. Populations and fields exist for the fluid cells only (`fluidCells` of them, in the order of their cell
 * index); `cellOf` and `activeOf` map between a fluid cell's number and its cell index in the box. Each fluid cell holds
 * the 19 places its populations are pulled from, so a pipe network in a large box costs what its fluid costs.
 *
 * A step uses only +, -, *, / and the square root in a fixed order, so repeat runs are bit-identical.
 */
import {EngineError} from './contracts.ts';
import {captureFields,restoreFields,type FieldOptions,type StateObject,type StateValue} from './checkpoint.ts';

export const FLOW_LATTICE_ID='flow-lbm-d3q19-regularized-les-js-f64-v1';
/** Most cells of the box (fluid or not). The box costs about 15 bytes per cell, the fluid about 420 bytes per fluid cell. */
export const FLOW_MAX_CELLS=1<<25;

/** Cell kinds of the lattice. */
export const FLOW_FLUID=0,FLOW_WALL=1,FLOW_VELOCITY=2,FLOW_PRESSURE=3,FLOW_SLIP=4;

/** D3Q19 velocities, opposite directions and weights. */
export const FLOW_CX=Object.freeze([0,1,-1,0,0,0,0,1,-1,1,-1,1,-1,1,-1,0,0,0,0]);
export const FLOW_CY=Object.freeze([0,0,0,1,-1,0,0,1,-1,-1,1,0,0,0,0,1,-1,1,-1]);
export const FLOW_CZ=Object.freeze([0,0,0,0,0,1,-1,0,0,0,0,1,-1,-1,1,1,-1,-1,1]);
export const FLOW_OPPOSITE=Object.freeze([0,2,1,4,3,6,5,8,7,10,9,12,11,14,13,16,15,18,17]);
export const FLOW_WEIGHT=Object.freeze([1/3,1/18,1/18,1/18,1/18,1/18,1/18,1/36,1/36,1/36,1/36,1/36,1/36,1/36,1/36,1/36,1/36,1/36,1/36]);
const Q=19;

export interface FlowLatticePart {
  /** Velocity of the wall, cells per step (a moving ground, a belt). Default 0. */
  readonly velocity?:readonly [number,number,number];
  /** Angular velocity, radians per step, about `centre` (cell coordinates): a frozen rotor's surface velocity. */
  readonly angularVelocity?:readonly [number,number,number];
  readonly centre?:readonly [number,number,number];
}
export interface FlowLatticePatch {
  /** FLOW_VELOCITY cells: the velocity that is imposed half-way to the cell, cells per step. */
  readonly velocity?:readonly [number,number,number];
  /** FLOW_PRESSURE cells: the density imposed (pressure = (density - 1) / 3). Default 1. */
  readonly density?:number;
}
export interface FlowLatticeOptions {
  readonly nx:number;readonly ny:number;readonly nz:number;
  /** Axes whose two sides are joined. An axis that is not periodic must be closed by non-fluid cells. */
  readonly periodic?:readonly [boolean,boolean,boolean];
  /** Kind of every cell (FLOW_FLUID, FLOW_WALL, FLOW_VELOCITY, FLOW_PRESSURE, FLOW_SLIP), index i + nx (j + ny k). */
  readonly kind:Uint8Array;
  /** Per cell: the part of a wall cell, the patch of a velocity or pressure cell. Default 0. */
  readonly owner?:Int16Array|Int32Array;
  /** Signed distance to the geometry at the cell centres (any unit), positive outside the solid. Used for the link
   * fractions q when `walls` is 'interpolated'; a wall cell whose distance is not negative (a side of the box, a cell
   * closed off) is half-way. */
  readonly distance?:Float32Array;
  readonly walls?:'interpolated'|'halfway';
  readonly parts?:readonly FlowLatticePart[];
  readonly patches?:readonly FlowLatticePatch[];
  /** Kinematic viscosity, cells squared per step. */
  readonly viscosity:number;
  /** Smagorinsky constant; 0 switches the sub-grid model off. */
  readonly smagorinsky?:number;
  /** WALE constant (Nicoud & Ducros 1999); 0 (default) switches that model off. With it the eddy viscosity is
   * (Cw)^2 (Sd:Sd)^(3/2) / ((S:S)^(5/2) + (Sd:Sd)^(5/4)) from the velocity gradient of the last step (central
   * differences, one-sided next to walls), which vanishes in pure shear and pure strain: no eddy viscosity at a
   * stagnation point or next to a wall, where the Smagorinsky model makes far too much. */
  readonly wale?:number;
  /** With the sub-grid model: walls slip and take the shear stress of a power-law wall function (see the header)
   * instead of the no-slip bounce-back. Default true. */
  readonly wallFunction?:boolean;
  /** Per cell of the box: 1 where the wall function may be used (a cell next to a smooth wall), 0 where the wall is
   * plain bounce-back (next to a sharp convex edge, where the geometry fixes the separation). Default: everywhere. */
  readonly wallFunctionMask?:Uint8Array;
  /** Relaxation time of the trace of the stress (bulk viscosity). Default 1. */
  readonly bulkRelaxation?:number;
  /** Body force per unit mass, cells per step squared. */
  readonly force?:readonly [number,number,number];
  /** Initial velocity of the fluid, cells per step. Default 0. */
  readonly initialVelocity?:readonly [number,number,number];
  /** Viscosity added per cell (index: cell in the box), cells squared per step (a sponge in front of an outlet). */
  readonly extraViscosity?:Float32Array;
  /** Velocity inlets give way to sound: the velocity imposed is lowered by (rho - <rho>) / sqrt(3) along the inward
   * normal, where rho is the mean density of the fluid cells on the inlet and <rho> follows it with the time constant
   * `absorbSteps` steps. A plane pressure wave that reaches the inlet leaves instead of being reflected; in a steady
   * flow the velocity is exactly the one given.
   * 0 switches it off (a hard inlet). Default 2 sqrt(3) max(nx, ny, nz): the time sound takes through the box and back. */
  readonly absorbSteps?:number;
  /** Momentum added per step to single fluid cells (an actuator disc): cell indices in the box, and 3 numbers per entry. */
  readonly forceCells?:Int32Array;readonly forceValues?:Float64Array;
  /** Velocity of single FLOW_VELOCITY cells (cells per step) by cell index, instead of the velocity of their patch: a profile. */
  readonly cellVelocity?:ReadonlyMap<number,readonly [number,number,number]>;
}

const fail=(message:string):never=>{throw new EngineError('INVALID_ARGUMENT',`FlowLattice: ${message}`);};
const LINK_WALL=0,LINK_PRESSURE=1,LINK_SLIP=2;
const LATTICE_FIELDS:FieldOptions={label:'FlowLattice',skip:['nx','ny','nz','cells','periodic','kind','owner','walls','viscosity','smagorinsky','wale','eddy','bulkRelaxation','extraViscosity','cellOf','activeOf','linkIndex','boundaryCell','source','linkStart','linkDir','linkKind','linkQ','linkAdd','linkOwner','linkAux','linkArm','linkAbsorb','absorbRate','wallDistance','wallVelocity','wallNormal','wallPart','wallFunction','inletCell','inletPatch','inletCount','inletOver','forceCells','forceValues','partCount','patchCount','fluidCells','partForce','partMoment','patchMass','scratch']};

export class FlowLattice {
  readonly nx:number;readonly ny:number;readonly nz:number;readonly cells:number;
  readonly periodic:readonly [boolean,boolean,boolean];
  readonly kind:Uint8Array;readonly owner:Int16Array|Int32Array;
  readonly walls:'interpolated'|'halfway';
  readonly viscosity:number;readonly smagorinsky:number;readonly wale:number;readonly bulkRelaxation:number;
  readonly partCount:number;readonly patchCount:number;
  /** Number of fluid cells; the cell index of each; and the fluid number of each cell of the box (-1: not fluid). */
  readonly fluidCells:number;readonly cellOf:Int32Array;readonly activeOf:Int32Array;
  /** Populations after the collision (deviation from the weights), 19 per fluid cell. */
  f:Float64Array;
  private next:Float64Array;
  /** Density minus 1, and velocity, of the last step (before its collision), per fluid cell. */
  readonly density:Float64Array;readonly ux:Float64Array;readonly uy:Float64Array;readonly uz:Float64Array;
  /** Body force per unit mass. May be changed between steps. */
  force:[number,number,number];
  /** Factor on every wall and inlet velocity (a start-up ramp). May be changed between steps. */
  ramp=1;
  stepCount=0;
  /** Momentum given to each part in the last step, and its moment about the origin of the cell coordinates (3 per part). */
  readonly partForce:Float64Array;readonly partMoment:Float64Array;
  /** Mass that entered through each patch in the last step, and through moving walls (zero for walls at rest). */
  readonly patchMass:Float64Array;
  wallMass=0;
  private readonly extraViscosity:Float32Array|null;
  /** Per fluid cell and direction: the index in f to pull from, or -1 when a link rule gives the population. */
  private readonly source:Int32Array;
  /** Per fluid cell: -1, or its number among the cells with boundary links. */
  private readonly linkIndex:Int32Array;
  private readonly linkStart:Int32Array;private readonly linkDir:Uint8Array;private readonly linkKind:Uint8Array;
  private readonly linkQ:Float64Array;private readonly linkAdd:Float64Array;private readonly linkOwner:Int32Array;
  private readonly linkAux:Int32Array;private readonly linkArm:Float32Array;private readonly linkAbsorb:Float64Array;
  private readonly absorbRate:number;
  readonly wallFunction:boolean;
  /** Per cell with boundary links: its distance to the nearest wall along its links (0: it touches no wall), the
   * velocity and part of that wall, and the unit normal (into the fluid) with the wall area of the cell as fourth entry. */
  private readonly wallDistance:Float32Array;private readonly wallVelocity:Float32Array;private readonly wallNormal:Float64Array;private readonly wallPart:Int32Array;
  /** Low-passed mean density deviation of the fluid cells on each velocity inlet (one per patch). */
  private readonly inletDensity:Float64Array;
  private readonly inletCell:Int32Array;private readonly inletPatch:Int32Array;private readonly inletCount:Float64Array;private readonly inletOver:Float64Array;
  private readonly forceCells:Int32Array|null;private readonly forceValues:Float64Array|null;
  private readonly scratch=new Float64Array(Q);
  /** Eddy viscosity of the WALE model per fluid cell (lattice units), worked out at the start of each step. */
  private eddy:Float64Array|null=null;
  /** Eddy viscosity of the sub-grid model in the last step, lattice units, per fluid cell (WALE only; null otherwise). */
  get eddyViscosity():Float64Array|null{return this.eddy;}

  constructor(options:FlowLatticeOptions){
    const {nx,ny,nz}=options;
    for(const [name,n] of [['nx',nx],['ny',ny],['nz',nz]] as const)if(!Number.isInteger(n)||n<1)fail(`${name} must be a positive integer.`);
    const cells=nx*ny*nz;
    if(cells>FLOW_MAX_CELLS)fail(`${cells} cells exceed the limit ${FLOW_MAX_CELLS}.`);
    if(options.kind.length!==cells)fail(`kind has ${options.kind.length} entries for ${cells} cells.`);
    if(!(options.viscosity>0)||!Number.isFinite(options.viscosity))fail('viscosity must be positive.');
    this.nx=nx;this.ny=ny;this.nz=nz;this.cells=cells;
    this.periodic=options.periodic??[false,false,false];
    this.kind=options.kind;this.owner=options.owner??new Int32Array(cells);
    this.walls=options.walls??'interpolated';
    this.viscosity=options.viscosity;this.smagorinsky=options.smagorinsky??0;this.wale=options.wale??0;if(!(this.wale>=0))fail('wale must not be negative.');this.bulkRelaxation=options.bulkRelaxation??1;
    if(!(this.smagorinsky>=0))fail('smagorinsky must not be negative.');
    if(!(this.bulkRelaxation>0.5))fail('bulkRelaxation must exceed 1/2.');
    if(options.extraViscosity&&options.extraViscosity.length!==cells)fail('extraViscosity must have one entry per cell.');
    const parts=options.parts??[{}],patches=options.patches??[];
    this.partCount=parts.length;this.patchCount=patches.length;
    this.force=[options.force?.[0]??0,options.force?.[1]??0,options.force?.[2]??0];
    const kind=this.kind,owner=this.owner,per=this.periodic,dist=this.walls==='interpolated'?options.distance??null:null;
    if(dist&&dist.length!==cells)fail('distance must have one entry per cell.');

    // ---- the fluid cells ----
    const activeOf=new Int32Array(cells);let fluid=0;
    for(let c=0;c<cells;c++)activeOf[c]=kind[c]===FLOW_FLUID?fluid++:-1;
    if(fluid*Q>0x7fffffff)fail(`${fluid} fluid cells are too many.`);
    const cellOf=new Int32Array(fluid);
    for(let c=0;c<cells;c++)if(activeOf[c]>=0)cellOf[activeOf[c]]=c;
    this.fluidCells=fluid;this.cellOf=cellOf;this.activeOf=activeOf;
    this.f=new Float64Array(fluid*Q);this.next=new Float64Array(fluid*Q);
    this.density=new Float64Array(fluid);this.ux=new Float64Array(fluid);this.uy=new Float64Array(fluid);this.uz=new Float64Array(fluid);
    this.partForce=new Float64Array(3*this.partCount);this.partMoment=new Float64Array(3*this.partCount);this.patchMass=new Float64Array(Math.max(1,this.patchCount));
    if(options.extraViscosity){const e=new Float32Array(fluid);for(let a=0;a<fluid;a++)e[a]=options.extraViscosity[cellOf[a]];this.extraViscosity=e;}else this.extraViscosity=null;

    // ---- where every population is pulled from; -1 marks a boundary link ----
    const neighbour=(i:number,j:number,k:number,dx:number,dy:number,dz:number):number=>{
      let a=i+dx,b=j+dy,c=k+dz;
      if(a<0||a>=nx){if(!per[0])return -1;a=(a+nx)%nx;}
      if(b<0||b>=ny){if(!per[1])return -1;b=(b+ny)%ny;}
      if(c<0||c>=nz){if(!per[2])return -1;c=(c+nz)%nz;}
      return a+nx*(b+ny*c);
    };
    const source=new Int32Array(fluid*Q),linkIndex=new Int32Array(fluid).fill(-1),nxy=nx*ny;
    let boundaryCells=0,links=0;
    for(let a=0;a<fluid;a++){
      const c=cellOf[a],i=c%nx,j=((c-i)/nx)%ny,k=(c-i-nx*j)/nxy,edge=i===0||i===nx-1||j===0||j===ny-1||k===0||k===nz-1,sb=a*Q;
      source[sb]=sb;let n=0;
      for(let d=1;d<Q;d++){
        const s=edge?neighbour(i,j,k,-FLOW_CX[d],-FLOW_CY[d],-FLOW_CZ[d]):c-FLOW_CX[d]-nx*FLOW_CY[d]-nxy*FLOW_CZ[d];
        if(s<0)fail(`the fluid cell (${i}, ${j}, ${k}) touches a side of the box that is neither periodic nor closed by boundary cells.`);
        const sa=activeOf[s];
        if(sa>=0)source[sb+d]=sa*Q+d;else{source[sb+d]=-1;n++;}
      }
      if(n>0){linkIndex[a]=boundaryCells++;links+=n;}
    }
    this.source=source;this.linkIndex=linkIndex;
    const linkStart=new Int32Array(boundaryCells+1),linkDir=new Uint8Array(links),linkKind=new Uint8Array(links),linkQ=new Float64Array(links),linkAdd=new Float64Array(links),
      linkOwner=new Int32Array(links),linkAux=new Int32Array(links).fill(-1),linkArm=new Float32Array(3*links),linkAbsorb=new Float64Array(links);
    const absorbSteps=options.absorbSteps??2*Math.sqrt(3)*Math.max(nx,ny,nz);
    if(!(absorbSteps>=0))fail('absorbSteps must not be negative.');
    this.absorbRate=absorbSteps>0?1/Math.max(1,absorbSteps):0;
    const inCell:number[]=[],inPatch:number[]=[],profile=options.cellVelocity,wfMask=options.wallFunctionMask??null;
    if(wfMask&&wfMask.length!==cells)fail('wallFunctionMask must have one entry per cell.');
    const wallDistance=new Float32Array(boundaryCells),wallVelocity=new Float32Array(3*boundaryCells),wallNormal=new Float64Array(4*boundaryCells),wallPart=new Int32Array(boundaryCells);
    this.wallFunction=options.wallFunction!==false;this.wallDistance=wallDistance;this.wallVelocity=wallVelocity;this.wallNormal=wallNormal;this.wallPart=wallPart;
    let l=0;
    for(let a=0;a<fluid;a++){
      const b=linkIndex[a];if(b<0)continue;
      const c=cellOf[a],i=c%nx,j=((c-i)/nx)%ny,k=(c-i-nx*j)/nxy,first=l;
      let inx=0,iny=0,inz=0,inletOf=-1;
      for(let d=1;d<Q;d++){
        if(source[a*Q+d]>=0)continue;
        const cx=FLOW_CX[d],cy=FLOW_CY[d],cz=FLOW_CZ[d],s=neighbour(i,j,k,-cx,-cy,-cz),sk=kind[s],o=FLOW_OPPOSITE[d],w=FLOW_WEIGHT[d];
        let lk=LINK_WALL,q=0.5,add=0,own=-1,aux=-1;
        if(sk===FLOW_SLIP){
          // The axes along which the neighbour is a slip side are mirrored; the others are a tangential shift.
          let mx=cx,my=cy,mz=cz,tx=0,ty=0,tz=0;
          if(cx!==0){const n=neighbour(i,j,k,-cx,0,0);if(n>=0&&kind[n]===FLOW_SLIP)mx=-cx;else tx=cx;}
          if(cy!==0){const n=neighbour(i,j,k,0,-cy,0);if(n>=0&&kind[n]===FLOW_SLIP)my=-cy;else ty=cy;}
          if(cz!==0){const n=neighbour(i,j,k,0,0,-cz);if(n>=0&&kind[n]===FLOW_SLIP)mz=-cz;else tz=cz;}
          const from=neighbour(i,j,k,-tx,-ty,-tz);
          let m=-1;
          for(let e=1;e<Q;e++)if(FLOW_CX[e]===mx&&FLOW_CY[e]===my&&FLOW_CZ[e]===mz){m=e;break;}
          if(from>=0&&activeOf[from]>=0&&m>0&&(mx!==cx||my!==cy||mz!==cz)){lk=LINK_SLIP;aux=activeOf[from]*Q+m;}
          // otherwise (a corner cut off by a wall): bounce back, at rest
        }else if(sk===FLOW_PRESSURE){
          lk=LINK_PRESSURE;own=owner[s];
          if(own<0||own>=patches.length)fail(`a pressure cell names the patch ${own}; there are ${patches.length}.`);
          add=(patches[own].density??1)-1;
        }else{
          let wx=0,wy=0,wz=0;
          if(sk===FLOW_VELOCITY){
            own=owner[s];
            if(own<0||own>=patches.length)fail(`a velocity cell names the patch ${own}; there are ${patches.length}.`);
            const v=profile?.get(s)??patches[own].velocity??[0,0,0];wx=v[0];wy=v[1];wz=v[2];
            if(d<=6&&inletOf<0)inletOf=own;
            own=-2-own; // patches are stored as -2 - index, parts as index
            inx+=cx;iny+=cy;inz+=cz;
          }else{
            own=owner[s];
            if(own<0||own>=parts.length)fail(`a wall cell names the part ${own}; there are ${parts.length}.`);
            if(dist){const da=dist[c],db=dist[s];if(da>0&&db<0){q=da/(da-db);if(q<0.01)q=0.01;}}
            const p=parts[own],v=p.velocity,om=p.angularVelocity;
            if(v){wx=v[0];wy=v[1];wz=v[2];}
            if(om){const ce=p.centre??[0,0,0],rx=i+0.5-q*cx-ce[0],ry=j+0.5-q*cy-ce[1],rz=k+0.5-q*cz-ce[2];wx+=om[1]*rz-om[2]*ry;wy+=om[2]*rx-om[0]*rz;wz+=om[0]*ry-om[1]*rx;}
          }
          add=6*w*(cx*wx+cy*wy+cz*wz);
          if(sk!==FLOW_VELOCITY){
            // the nearest wall of the cell, for the wall function: distance along the link, and its velocity
            const y=q*(cx*cx+cy*cy+cz*cz>1?Math.SQRT2:1);
            if(wallDistance[b]===0||y<wallDistance[b]){wallDistance[b]=y;wallVelocity[3*b]=wx;wallVelocity[3*b+1]=wy;wallVelocity[3*b+2]=wz;wallPart[b]=own;}
            wallNormal[4*b]+=w*cx;wallNormal[4*b+1]+=w*cy;wallNormal[4*b+2]+=w*cz;
          }
          if(q<0.5){const n=neighbour(i,j,k,cx,cy,cz);if(n>=0&&activeOf[n]>=0)aux=activeOf[n]*Q+o;else q=0.5;}
        }
        linkDir[l]=d;linkKind[l]=lk;linkQ[l]=q;linkAdd[l]=add;linkOwner[l]=own;linkAux[l]=aux;
        // The point of the wall on the link, for the moment of the force.
        linkArm[3*l]=i+0.5-q*cx;linkArm[3*l+1]=j+0.5-q*cy;linkArm[3*l+2]=k+0.5-q*cz;
        l++;
      }
      // inlet links: the factor of (rho - <rho>) in their wall term, 6 w (c . n) / sqrt(3), n the inward normal of the cell
      const inl=Math.sqrt(inx*inx+iny*iny+inz*inz);
      if(inl>0&&this.absorbRate>0)for(let m=first;m<l;m++)if(linkOwner[m]<-1&&linkKind[m]===LINK_WALL){
        const d=linkDir[m];linkAbsorb[m]=6*FLOW_WEIGHT[d]*(FLOW_CX[d]*inx+FLOW_CY[d]*iny+FLOW_CZ[d]*inz)/(inl*Math.sqrt(3));
      }
      {
        // unit normal of the cell's walls and their area, 6 |N|; a cell squeezed between opposite walls has none
        const n0=wallNormal[4*b],n1=wallNormal[4*b+1],n2=wallNormal[4*b+2],nl=Math.sqrt(n0*n0+n1*n1+n2*n2);
        if(nl>1e-9&&(!wfMask||wfMask[c]!==0)){wallNormal[4*b]=n0/nl;wallNormal[4*b+1]=n1/nl;wallNormal[4*b+2]=n2/nl;wallNormal[4*b+3]=6*nl;}
        else{wallNormal[4*b]=0;wallNormal[4*b+1]=0;wallNormal[4*b+2]=0;wallNormal[4*b+3]=0;}
      }
      if(inletOf>=0){inCell.push(a);inPatch.push(inletOf);}
      linkStart[b+1]=l;
    }
    this.linkStart=linkStart;this.linkDir=linkDir;this.linkKind=linkKind;this.linkQ=linkQ;this.linkAdd=linkAdd;this.linkOwner=linkOwner;this.linkAux=linkAux;this.linkArm=linkArm;this.linkAbsorb=linkAbsorb;
    this.inletDensity=new Float64Array(Math.max(1,patches.length));this.inletOver=new Float64Array(Math.max(1,patches.length));this.inletCount=new Float64Array(Math.max(1,patches.length));
    this.inletCell=Int32Array.from(inCell);this.inletPatch=Int32Array.from(inPatch);
    for(const p of inPatch)this.inletCount[p]++;
    // momentum sources: cell indices to fluid numbers
    if(options.forceCells){
      if(!options.forceValues||options.forceValues.length!==3*options.forceCells.length)fail('forceValues must hold three numbers per entry of forceCells.');
      const fc=new Int32Array(options.forceCells.length);
      for(let n=0;n<fc.length;n++){const a=activeOf[options.forceCells[n]];if(a<0)fail('a momentum source lies in a cell that is not fluid.');fc[n]=a;}
      this.forceCells=fc;this.forceValues=options.forceValues??null;
    }else{this.forceCells=null;this.forceValues=null;}

    // ---- initial state: equilibrium at density 1 ----
    const u0=options.initialVelocity;
    if(u0&&(u0[0]!==0||u0[1]!==0||u0[2]!==0)){
      const f=this.f,usq=1.5*(u0[0]*u0[0]+u0[1]*u0[1]+u0[2]*u0[2]);
      for(let a=0;a<fluid;a++){
        for(let d=0;d<Q;d++){const cu=FLOW_CX[d]*u0[0]+FLOW_CY[d]*u0[1]+FLOW_CZ[d]*u0[2];f[a*Q+d]=FLOW_WEIGHT[d]*(3*cu+4.5*cu*cu-usq);}
        this.ux[a]=u0[0];this.uy[a]=u0[1];this.uz[a]=u0[2];
      }
    }
  }

  /** Per part, the force (3 numbers) and the moment about the origin of the cell coordinates (3 numbers) that a
   * uniform lattice pressure of 1 exerts on its wall links: sum of 6 w_i c_i' over the links (and the arm times it).
   * Zero for a closed body in the fluid; for a body standing on a wall, the pressure times its footprint. Used to refer
   * forces to a static pressure other than the reference density's. */
  wettedArea():{force:Float64Array;moment:Float64Array}{
    const force=new Float64Array(3*this.partCount),moment=new Float64Array(3*this.partCount);
    for(let l=0;l<this.linkDir.length;l++){
      const own=this.linkOwner[l];if(own<0||this.linkKind[l]!==LINK_WALL)continue;
      const d=this.linkDir[l],od=FLOW_OPPOSITE[d],w=6*FLOW_WEIGHT[d],px=w*FLOW_CX[od],py=w*FLOW_CY[od],pz=w*FLOW_CZ[od],rx=this.linkArm[3*l],ry=this.linkArm[3*l+1],rz=this.linkArm[3*l+2];
      force[3*own]+=px;force[3*own+1]+=py;force[3*own+2]+=pz;
      moment[3*own]+=ry*pz-rz*py;moment[3*own+1]+=rz*px-rx*pz;moment[3*own+2]+=rx*py-ry*px;
    }
    return {force,moment};
  }

  /** Number of boundary links (wall, inlet, outlet and slip), for the cost report. */
  get linkCount():number{return this.linkDir.length;}

  /** Advance one step. */
  step():void{
    const a=this.f,b=this.next,linkIndex=this.linkIndex,fluid=this.fluidCells,src=this.source;
    const rho=this.density,UX=this.ux,UY=this.uy,UZ=this.uz;
    const tau0=3*this.viscosity+0.5,cs=this.smagorinsky,les=cs>0,K=18*Math.SQRT2*cs*cs,ab=1-1/this.bulkRelaxation,extra=this.extraViscosity;
    const Fx=this.force[0],Fy=this.force[1],Fz=this.force[2],hx=0.5*Fx,hy=0.5*Fy,hz=0.5*Fz;
    const linkStart=this.linkStart,linkDir=this.linkDir,linkKind=this.linkKind,linkQ=this.linkQ,linkAdd=this.linkAdd,linkOwner=this.linkOwner,linkAux=this.linkAux,linkArm=this.linkArm,linkAbsorb=this.linkAbsorb,inletOver=this.inletOver,g=this.scratch,ramp=this.ramp;
    const wallDistance=this.wallDistance,wallVelocity=this.wallVelocity,wallNormal=this.wallNormal,wallPart=this.wallPart,wallLaw=(les||this.wale>0)&&this.wallFunction,nu0=this.viscosity,A7=1/(8.3*8.3*8.3*8.3*8.3*8.3*8.3);
    const partForce=this.partForce,partMoment=this.partMoment,patchMass=this.patchMass;
    partForce.fill(0);partMoment.fill(0);patchMass.fill(0);let wallMass=0;
    if(this.absorbRate>0){
      // mean density on each inlet above its own slow mean: what the inlet gives way to in this step
      const cellsOf=this.inletCell,patchOf=this.inletPatch,count=this.inletCount,slow=this.inletDensity;
      inletOver.fill(0);
      for(let n=0;n<cellsOf.length;n++)inletOver[patchOf[n]]+=rho[cellsOf[n]];
      for(let p=0;p<inletOver.length;p++){if(count[p]>0){const over=inletOver[p]/count[p]-slow[p];inletOver[p]=over;slow[p]+=this.absorbRate*over;}}
    }
    const W1=1/18,W2=1/36,W0=1/3,wale=this.wale>0;
    let eddy=this.eddy;
    if(wale){
      // velocity gradient of the last step by central differences (one-sided where a neighbour is not fluid)
      eddy??=this.eddy=new Float64Array(fluid);
      const cw2=this.wale*this.wale,g=new Float64Array(9);
      for(let c=0;c<fluid;c++){
        const o=c*Q;
        for(let axis=0;axis<3;axis++){
          // d = 1 + 2 axis pulls from x - e_axis, d + 1 from x + e_axis
          const sm=src[o+1+2*axis],sp=src[o+2+2*axis],m=sm>=0?(sm-1-2*axis)/Q:-1,p=sp>=0?(sp-2-2*axis)/Q:-1;
          let dx:number,dy:number,dz:number;
          if(m>=0&&p>=0){dx=0.5*(UX[p]-UX[m]);dy=0.5*(UY[p]-UY[m]);dz=0.5*(UZ[p]-UZ[m]);}
          else if(p>=0){dx=UX[p]-UX[c];dy=UY[p]-UY[c];dz=UZ[p]-UZ[c];}
          else if(m>=0){dx=UX[c]-UX[m];dy=UY[c]-UY[m];dz=UZ[c]-UZ[m];}
          else{dx=0;dy=0;dz=0;}
          g[axis]=dx;g[3+axis]=dy;g[6+axis]=dz; // g[3 i + j] = d u_i / d x_j
        }
        const g00=g[0],g01=g[1],g02=g[2],g10=g[3],g11=g[4],g12=g[5],g20=g[6],g21=g[7],g22=g[8];
        // g^2
        const a00=g00*g00+g01*g10+g02*g20,a01=g00*g01+g01*g11+g02*g21,a02=g00*g02+g01*g12+g02*g22;
        const a10=g10*g00+g11*g10+g12*g20,a11=g10*g01+g11*g11+g12*g21,a12=g10*g02+g11*g12+g12*g22;
        const a20=g20*g00+g21*g10+g22*g20,a21=g20*g01+g21*g11+g22*g21,a22=g20*g02+g21*g12+g22*g22;
        const t3=(a00+a11+a22)/3,s01=0.5*(a01+a10),s02=0.5*(a02+a20),s12=0.5*(a12+a21);
        const sdsd=(a00-t3)*(a00-t3)+(a11-t3)*(a11-t3)+(a22-t3)*(a22-t3)+2*(s01*s01+s02*s02+s12*s12);
        const e01=0.5*(g01+g10),e02=0.5*(g02+g20),e12=0.5*(g12+g21);
        const ss=g00*g00+g11*g11+g22*g22+2*(e01*e01+e02*e02+e12*e12);
        const den=ss*ss*Math.sqrt(ss)+sdsd*Math.sqrt(Math.sqrt(sdsd));
        eddy[c]=den>0?cw2*sdsd*Math.sqrt(sdsd)/den:0;
      }
    }
    let wfx=0,wfy=0,wfz=0;
    for(let c=0;c<fluid;c++){
      const bi=linkIndex[c],o=c*Q;
      let d0:number,d1:number,d2:number,d3:number,d4:number,d5:number,d6:number,d7:number,d8:number,d9:number,d10:number,d11:number,d12:number,d13:number,d14:number,d15:number,d16:number,d17:number,d18:number;
      if(bi<0){
        d0=a[o];d1=a[src[o+1]];d2=a[src[o+2]];d3=a[src[o+3]];d4=a[src[o+4]];d5=a[src[o+5]];d6=a[src[o+6]];
        d7=a[src[o+7]];d8=a[src[o+8]];d9=a[src[o+9]];d10=a[src[o+10]];d11=a[src[o+11]];d12=a[src[o+12]];
        d13=a[src[o+13]];d14=a[src[o+14]];d15=a[src[o+15]];d16=a[src[o+16]];d17=a[src[o+17]];d18=a[src[o+18]];
      }else{
        for(let d=0;d<Q;d++){const s=src[o+d];g[d]=s>=0?a[s]:0;}
        // mass the interpolation of the wall links creates in this cell; it is taken from the rest population
        let leak=0;
        // wall function: the velocity of the cell along its wall (the wall "slips" with it), and the shear it loses
        let sx=0,sy=0,sz=0,slip=false,slipPart=-1;wfx=0;wfy=0;wfz=0;
        if(wallLaw&&wallNormal[4*bi+3]>0){
          const n0=wallNormal[4*bi],n1=wallNormal[4*bi+1],n2=wallNormal[4*bi+2],rx=UX[c]-wallVelocity[3*bi]*ramp,ry=UY[c]-wallVelocity[3*bi+1]*ramp,rz=UZ[c]-wallVelocity[3*bi+2]*ramp,un=rx*n0+ry*n1+rz*n2;
          sx=rx-un*n0;sy=ry-un*n1;sz=rz-un*n2;slip=true;slipPart=wallPart[bi];
          const u2=sx*sx+sy*sy+sz*sz;
          if(u2>0){
            const up=Math.sqrt(u2),y=wallDistance[bi],lam=nu0*up/y,pw=Math.sqrt(Math.sqrt(u2*u2*u2*up*nu0*A7/y)),tw=lam>pw?lam:pw;
            // momentum taken from the cell per step, never more than half of what it has along the wall
            let k=tw*wallNormal[4*bi+3]/up;if(k>0.5)k=0.5;
            wfx=-k*sx;wfy=-k*sy;wfz=-k*sz;
            const p3=3*wallPart[bi],l3=3*linkStart[bi],ax=linkArm[l3],ay=linkArm[l3+1],az=linkArm[l3+2];
            partForce[p3]-=wfx;partForce[p3+1]-=wfy;partForce[p3+2]-=wfz;
            partMoment[p3]-=ay*wfz-az*wfy;partMoment[p3+1]-=az*wfx-ax*wfz;partMoment[p3+2]-=ax*wfy-ay*wfx;
          }
        }
        for(let l=linkStart[bi],le=linkStart[bi+1];l<le;l++){
          const d=linkDir[l],od=FLOW_OPPOSITE[d],w=FLOW_WEIGHT[d],out=a[o+od],lk=linkKind[l];
          let v:number;
          if(lk===LINK_WALL){
            const q=linkQ[l],own=linkOwner[l],aux=linkAux[l];
            // the wall's own velocity (a moving ground, an inlet); with the wall function also the slip of the cell
            const legit=own<-1?linkAdd[l]*ramp-linkAbsorb[l]*inletOver[-2-own]:linkAdd[l]*ramp;
            const add=slip&&own===slipPart?legit+6*w*(FLOW_CX[d]*sx+FLOW_CY[d]*sy+FLOW_CZ[d]*sz):legit;
            if(q===0.5){v=out+add;leak+=add-legit;}
            else if(q<0.5){v=2*q*out+(1-2*q)*a[aux]+add;leak+=v-out-legit;}
            else{v=(out+(2*q-1)*a[o+d]+add)/(2*q);leak+=v-out-legit/(2*q);}
            const m=v-out;
            if(own>=0){
              // momentum given to the wall: c_o (f*_o + g_d). The deviations are used, so the pressure of the fluid at rest
              // (which cancels over a closed body) is left out: a body standing on a wall takes the gauge pressure.
              const p=out+v,px=FLOW_CX[od]*p,py=FLOW_CY[od]*p,pz=FLOW_CZ[od]*p,p3=3*own,l3=3*l,rx=linkArm[l3],ry=linkArm[l3+1],rz=linkArm[l3+2];
              partForce[p3]+=px;partForce[p3+1]+=py;partForce[p3+2]+=pz;
              partMoment[p3]+=ry*pz-rz*py;partMoment[p3+1]+=rz*px-rx*pz;partMoment[p3+2]+=rx*py-ry*px;
              wallMass+=m;
            }else if(own<-1)patchMass[-2-own]+=m;
          }else if(lk===LINK_PRESSURE){
            const ux=UX[c],uy=UY[c],uz=UZ[c],cu=FLOW_CX[d]*ux+FLOW_CY[d]*uy+FLOW_CZ[d]*uz,dr=linkAdd[l];
            v=-out+2*w*(dr+(1+dr)*(4.5*cu*cu-1.5*(ux*ux+uy*uy+uz*uz)));
            patchMass[linkOwner[l]]+=v-out;
          }else v=a[linkAux[l]];
          g[d]=v;
        }
        wallMass-=leak;
        d0=g[0]-leak;d1=g[1];d2=g[2];d3=g[3];d4=g[4];d5=g[5];d6=g[6];d7=g[7];d8=g[8];d9=g[9];d10=g[10];d11=g[11];d12=g[12];d13=g[13];d14=g[14];d15=g[15];d16=g[16];d17=g[17];d18=g[18];
      }
      // moments
      const sxy=d7+d8,dxy=d7-d8,syx=d9+d10,dyx=d9-d10,sxz=d11+d12,dxz=d11-d12,szx=d13+d14,dzx=d13-d14,syz=d15+d16,dyz=d15-d16,szy=d17+d18,dzy=d17-d18;
      const a12=d1+d2,a34=d3+d4,a56=d5+d6;
      const pxx=a12+sxy+syx+sxz+szx,pyy=a34+sxy+syx+syz+szy,pzz=a56+sxz+szx+syz+szy;
      const dr=d0+a12+a34+a56+sxy+syx+sxz+szx+syz+szy;
      const jx=d1-d2+dxy+dyx+dxz+dzx,jy=d3-d4+dxy-dyx+dyz+dzy,jz=d5-d6+dxz-dzx+dyz-dzy;
      const r=1+dr,inv=1/r,ux=(jx+hx)*inv,uy=(jy+hy)*inv,uz=(jz+hz)*inv;
      rho[c]=dr;UX[c]=ux;UY[c]=uy;UZ[c]=uz;
      const rux=r*ux,ruy=r*uy,ruz=r*uz,third=dr*W0;
      const qxx=pxx-rux*ux-third,qyy=pyy-ruy*uy-third,qzz=pzz-ruz*uz-third,qxy=sxy-syx-rux*uy,qxz=sxz-szx-rux*uz,qyz=syz-szy-ruy*uz;
      const tr=(qxx+qyy+qzz)*W0,exx=qxx-tr,eyy=qyy-tr,ezz=qzz-tr;
      let tau=extra?tau0+3*extra[c]:tau0;
      if(wale)tau+=3*eddy![c];
      if(les)tau=0.5*(tau+Math.sqrt(tau*tau+K*Math.sqrt(exx*exx+eyy*eyy+ezz*ezz+2*(qxy*qxy+qxz*qxz+qyz*qyz))*inv));
      const as=1-1/tau,bt=ab*tr;
      const txx=rux*ux+as*exx+bt,tyy=ruy*uy+as*eyy+bt,tzz=ruz*uz+as*ezz+bt,txy=rux*uy+as*qxy,txz=rux*uz+as*qxz,tyz=ruy*uz+as*qyz;
      let mx=3*(jx+Fx),my=3*(jy+Fy),mz=3*(jz+Fz);
      if(bi>=0){mx+=3*wfx;my+=3*wfy;mz+=3*wfz;}
      const base=dr-1.5*(txx+tyy+tzz);
      b[o]=W0*base;
      let e=base+4.5*txx;b[o+1]=W1*(e+mx);b[o+2]=W1*(e-mx);
      e=base+4.5*tyy;b[o+3]=W1*(e+my);b[o+4]=W1*(e-my);
      e=base+4.5*tzz;b[o+5]=W1*(e+mz);b[o+6]=W1*(e-mz);
      let n=mx+my;e=base+4.5*(txx+tyy+2*txy);b[o+7]=W2*(e+n);b[o+8]=W2*(e-n);
      n=mx-my;e=base+4.5*(txx+tyy-2*txy);b[o+9]=W2*(e+n);b[o+10]=W2*(e-n);
      n=mx+mz;e=base+4.5*(txx+tzz+2*txz);b[o+11]=W2*(e+n);b[o+12]=W2*(e-n);
      n=mx-mz;e=base+4.5*(txx+tzz-2*txz);b[o+13]=W2*(e+n);b[o+14]=W2*(e-n);
      n=my+mz;e=base+4.5*(tyy+tzz+2*tyz);b[o+15]=W2*(e+n);b[o+16]=W2*(e-n);
      n=my-mz;e=base+4.5*(tyy+tzz-2*tyz);b[o+17]=W2*(e+n);b[o+18]=W2*(e-n);
    }
    // momentum sources (actuator discs): f_i += 3 w_i c_i . F adds the momentum F and no mass
    const fc=this.forceCells,fv=this.forceValues;
    if(fc&&fv)for(let n=0;n<fc.length;n++){
      const o=fc[n]*Q,gx=3*fv[3*n]*ramp,gy=3*fv[3*n+1]*ramp,gz=3*fv[3*n+2]*ramp;
      for(let d=1;d<Q;d++)b[o+d]+=FLOW_WEIGHT[d]*(FLOW_CX[d]*gx+FLOW_CY[d]*gy+FLOW_CZ[d]*gz);
    }
    this.wallMass=wallMass;this.f=b;this.next=a;this.stepCount++;
  }

  /** Mass on the lattice minus the mass of the fluid at rest (sum of the deviations of the populations). */
  excessMass():number{
    const f=this.f;let total=0;
    for(let a=0;a<this.fluidCells;a++){const o=a*Q;let s=0;for(let d=0;d<Q;d++)s+=f[o+d];total+=s;}
    return total;
  }
  /** Momentum of the fluid (sum of c_i f_i over the fluid cells). */
  momentum():[number,number,number]{
    const f=this.f;let x=0,y=0,z=0;
    for(let a=0;a<this.fluidCells;a++){const o=a*Q;for(let d=1;d<Q;d++){const v=f[o+d];x+=FLOW_CX[d]*v;y+=FLOW_CY[d]*v;z+=FLOW_CZ[d]*v;}}
    return [x,y,z];
  }
  /** False when a density or a velocity is not finite or the speed passed 0.6 (the lattice sound speed is 0.577). */
  healthy():boolean{
    const {density,ux,uy,uz,fluidCells}=this;
    for(let a=0;a<fluidCells;a++){const s=ux[a]*ux[a]+uy[a]*uy[a]+uz[a]*uz[a];if(!(s<=0.36)||!(Math.abs(density[a])<0.9))return false;}
    return true;
  }

  /** The state of the run: populations, fields of the last step, ramp, force and step count. */
  saveState():StateObject{return captureFields(this,LATTICE_FIELDS);}
  /** Put back a state from `saveState()` of a lattice built with the same options. */
  restoreState(state:StateValue):void{restoreFields(this,state,LATTICE_FIELDS);}
}
