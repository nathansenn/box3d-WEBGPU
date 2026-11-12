/**
 * A suspension footbridge in SI units on the validated solvers: Euler-Bernoulli frame elements for the
 * deck grillage and the two portal towers (frame-runtime.ts), tension-only compliant cables for the main
 * cables, backstays and hangers (compliant-cable.ts, proximal backend), all coupled two ways by
 * StructureCoupling (structure-coupling.ts), with an optional rigid service vehicle on the Box3D world.
 *
 * The geometry is the Engineering Studio's footbridge (src/studio/: a 42 m span between two portal
 * towers, 36 panels of 7/6 m, main cables in two planes 3.8 m apart with a 6.8 m sag, vertical hangers at
 * every panel point, backstays to ground anchorages), in metres in the Studio's own coordinates. The
 * sections are hand estimates for a steel and timber footbridge of that look; docs/SI_BRIDGE.md derives
 * every number and lists what is validated.
 *
 * What the model is: linear beams (small strains and rotations); axial, tension-only cable segments whose
 * geometry is exact (a main cable is a chain of 36 straight segments, so its sag and its gravity stiffness
 * are modelled); loads at nodes. What it is not: no contact, no buckling, yielding or geometric stiffness
 * of the beams, no saddle slip, no aerodynamics beyond a static lateral load, no timber deck stiffness
 * (the boards are mass only). Utilisations are linear-elastic indicators, not a design check.
 *
 * The file has three parts: the layout (`suspensionLayout`), an independent static solver
 * (`SiSuspensionStatics`: form-finding, statics, modes) and the time-stepped model (`SiSuspensionBridge`).
 * It imports no drawing code.
 */
import {frameElementMatrices,type FrameElement,type FrameElementMatrices} from './frame-element.ts';
import {FrameRuntime} from './frame-runtime.ts';
import {CompliantCableRuntime} from './compliant-cable.ts';
import {StructureCoupling,type StructureAttachment,type StructureWorld} from './structure-coupling.ts';
import {materialProperty} from './materials.ts';
import {EnvelopeMatrix} from './envelope-matrix.ts';
import type {NativeBodyHandle,NativeWorldBackend} from './native-world.ts';

export const SI_SUSPENSION_GRAVITY=9.81;

/** A prismatic steel member. Lengths in m, moduli and stresses in Pa, mass in kg/m. */
export interface SiMemberSection {
  readonly name:string;
  readonly youngModulus:number;readonly shearModulus:number;readonly area:number;
  /** Second moment of area for bending out of the plane of the member and its `up` vector, m^4. */
  readonly iy:number;
  /** Second moment of area for bending in the plane of the member and its `up` vector, m^4. */
  readonly iz:number;
  readonly torsionConstant:number;
  /** Mass per metre including what the member carries permanently, kg/m. */
  readonly massPerMetre:number;
  /** Elastic section moduli for iz and iy bending, m^3. */
  readonly modulusZ:number;readonly modulusY:number;
  readonly yieldStress:number;
}
/** A cable or hanger: axial, tension-only. */
export interface SiCableSection {
  readonly name:string;
  readonly youngModulus:number;
  /** Metallic area, m^2. */
  readonly area:number;
  readonly massPerMetre:number;
  /** Minimum breaking force, N. */
  readonly breakingLoad:number;
  readonly diameter:number;
}

const S355='structural-steel-s355';
const steelE=materialProperty(S355,'youngModulus'),steelG=materialProperty(S355,'shearModulus'),steelRho=materialProperty(S355,'density'),steelFy=materialProperty(S355,'yieldStrength');
/** Timber for the deck boards and fascias: the library's loblolly pine (12 % moisture). */
export const SI_SUSPENSION_TIMBER_DENSITY=materialProperty('pine-loblolly','density');

/** A rolled steel section in S355 from its table values (cm units, as tables print them). */
function rolled(name:string,areaCm2:number,iStrongCm4:number,iWeakCm4:number,torsionCm4:number,wStrongCm3:number,wWeakCm3:number,strongIn:'z'|'y'='z',extraMass=0):SiMemberSection {
  const A=areaCm2*1e-4,strong=iStrongCm4*1e-8,weak=iWeakCm4*1e-8,ws=wStrongCm3*1e-6,ww=wWeakCm3*1e-6;
  return Object.freeze({name,youngModulus:steelE,shearModulus:steelG,area:A,iz:strongIn==='z'?strong:weak,iy:strongIn==='z'?weak:strong,torsionConstant:torsionCm4*1e-8,
    massPerMetre:steelRho*A+extraMass,modulusZ:strongIn==='z'?ws:ww,modulusY:strongIn==='z'?ww:ws,yieldStress:steelFy});
}

// Deck dead load carried by the girders (kg per metre of bridge): timber boards 3.8 m x 0.16 m, two fascia
// boards 0.26 x 0.14 m, two railings (one 76.1 x 3.6 tube 6.4 kg/m, five 24 mm bars 3.55 kg/m each, a 48.3 x 4
// post every 7/6 m 4.4 kg/m x 1.15 m) and fixings 10 kg/m.
const BOARDS=3.8*.16*SI_SUSPENSION_TIMBER_DENSITY,FASCIAS=2*.26*.14*SI_SUSPENSION_TIMBER_DENSITY,RAILINGS=2*(6.4+5*3.55+4.4*1.15/(7/6)),FIXINGS=10;
/** Surface, fascias, railings and fixings, kg/m, carried half by each girder. */
export const SI_SUSPENSION_DECK_SURFACE=BOARDS+FASCIAS+RAILINGS+FIXINGS;

/** Edge girder: HEA 340 (EN 10365), vertical bending about its strong axis; it carries half the deck surface. */
export const SI_SUSPENSION_GIRDER=rolled('HEA 340',133.5,27690,7436,127.2,1678,495.7,'z',SI_SUSPENSION_DECK_SURFACE/2);
/** Crossbeam at every panel point: IPE 200, vertical bending about its strong axis. */
export const SI_SUSPENSION_CROSSBEAM=rolled('IPE 200',28.48,1943,142.4,6.98,194.3,28.47);
/** Plan bracing (two diagonals per panel): L 60 x 6 angle, an axial member in practice. */
export const SI_SUSPENSION_BRACING=rolled('L 60x6',6.91,22.8,22.8,.86,5.29,5.29);
/** Tower column: HEB 400, strong axis bending along the bridge. */
export const SI_SUSPENSION_COLUMN=rolled('HEB 400',197.8,57680,10820,355.7,2884,721.3);
/** Portal beam between the column tops: HEB 300, strong axis bending in the portal plane. */
export const SI_SUSPENSION_PORTAL=rolled('HEB 300',149.1,25170,8563,185,1678,570.9);
/** Portal knee brace: HEB 200, strong axis in the portal plane (iy for a knee, whose up is along the bridge). */
export const SI_SUSPENSION_KNEE=rolled('HEB 200',78.08,5696,2003,59.28,569.6,200.3,'y');
/** Main cable: a 50 mm full locked coil strand. Metallic area 0.87 x pi 25^2 = 1708 mm^2; E = 160 GPa
 * (EN 1993-1-11 for locked coil); 1570 MPa wire with 0.9 spinning loss gives a minimum breaking force of
 * 0.9 x 1570 x 1708 = 2413 kN; 1.708e-3 x 7850 x 1.02 (coating) = 13.7 kg/m. */
export const SI_SUSPENSION_MAIN_CABLE:SiCableSection=Object.freeze({name:'50 mm full locked coil strand',youngModulus:160e9,area:1.708e-3,massPerMetre:13.7,breakingLoad:2.413e6,diameter:.05});
/** Hanger: a 20 mm spiral strand. Metallic area 0.78 x pi 10^2 = 245 mm^2; E = 150 GPa (EN 1993-1-11 for
 * spiral strand); minimum breaking force 0.86 x 1770 x 245 = 373 kN; 2.0 kg/m. */
export const SI_SUSPENSION_HANGER:SiCableSection=Object.freeze({name:'20 mm spiral strand',youngModulus:150e9,area:2.45e-4,massPerMetre:2.0,breakingLoad:3.73e5,diameter:.02});

export interface SiSuspensionParams {
  /** Main span between the tower axes, m. */
  readonly span:number;
  /** Panels along the deck (hangers at every interior panel point). */
  readonly panels:number;
  /** Height of the girder axes, m. */
  readonly deckY:number;
  /** Half the distance between the cable planes and between the girders, m. */
  readonly halfWidth:number;
  /** Height of the saddles (the column tops), m. */
  readonly saddleY:number;
  /** Drawn sag of the main cable at midspan below the saddles, m. */
  readonly sag:number;
  /** Column base height (top of the pier), m. */
  readonly towerBaseY:number;
  readonly portalY:number;readonly kneeY:number;
  /** Where the knee braces meet the portal beam, |z| in m. */
  readonly kneeZ:number;
  /** Backstay anchorages: |x|, height and |z|, m. */
  readonly anchorX:number;readonly anchorY:number;readonly anchorZ:number;
  readonly girder:SiMemberSection;readonly crossbeam:SiMemberSection;readonly bracing:SiMemberSection;
  readonly column:SiMemberSection;readonly portal:SiMemberSection;readonly knee:SiMemberSection;
  readonly mainCable:SiCableSection;readonly hanger:SiCableSection;
  /** Lumped mass at each saddle (the saddle casting, cable clamp and tower head fittings), kg. */
  readonly saddleMass:number;
}
/** The Studio footbridge (src/studio/physics.ts STUDIES.bridge, world.ts, reference-scene.ts). The drawn
 * anchorages stand on uneven ground between 6.25 and 6.36 m; the model puts all four at 6.30 m so that the
 * structure is mirror-symmetric. */
export const SI_SUSPENSION_DEFAULTS:SiSuspensionParams=Object.freeze({span:42,panels:36,deckY:4.8,halfWidth:1.9,saddleY:14,sag:6.8,towerBaseY:3.73,portalY:13.5,kneeY:11.85,kneeZ:.82,
  anchorX:31,anchorY:6.3,anchorZ:4.3,girder:SI_SUSPENSION_GIRDER,crossbeam:SI_SUSPENSION_CROSSBEAM,bracing:SI_SUSPENSION_BRACING,column:SI_SUSPENSION_COLUMN,portal:SI_SUSPENSION_PORTAL,knee:SI_SUSPENSION_KNEE,
  mainCable:SI_SUSPENSION_MAIN_CABLE,hanger:SI_SUSPENSION_HANGER,saddleMass:500});

export type SiMemberKind='girder'|'crossbeam'|'bracing'|'column'|'portal'|'knee';
export type SiSegmentKind='main'|'backstay'|'hanger';
/** A cable segment between two ends. An end >= 0 is a frame node; an end < 0 is the cable point -(end + 1). */
export interface SiSegment {
  readonly a:number;readonly b:number;readonly kind:SiSegmentKind;
  /** 0: the cable plane at z < 0, 1: at z > 0. */
  readonly side:0|1;
  /** Panel point (hangers: where it holds the deck; main: the segment from station - 1 to station; backstays: 0 or the last). */
  readonly station:number;
}
export interface SiSuspensionLayout {
  readonly params:SiSuspensionParams;
  /** Frame nodes, three coordinates each, and six fixed flags each. */
  readonly positions:Float64Array;readonly fixed:Uint8Array;
  readonly elements:readonly FrameElement[];readonly members:readonly SiMemberKind[];
  /** Cable points that are not frame nodes (main cable points between the saddles, anchorages). */
  readonly points:Float64Array;readonly anchored:Uint8Array;
  readonly segments:readonly SiSegment[];
  /** Panel points 0..panels, x in m. */
  readonly stationX:Float64Array;
  /** Girder node of each station on each side, and the crossbeam centre node of each station. */
  readonly girders:readonly [Int32Array,Int32Array];readonly centres:Int32Array;
  /** Girder element of each panel on each side (panel j joins stations j and j + 1). */
  readonly girderElements:readonly [Int32Array,Int32Array];
  /** Main cable point at each station on each side (-1 at the towers, where the saddle node is the end). */
  readonly cablePoints:readonly [Int32Array,Int32Array];
  /** Segment index of the hanger at each station on each side (-1 at the towers). */
  readonly hangers:readonly [Int32Array,Int32Array];
  /** The towers at -span/2 and +span/2: column nodes from base to saddle per side, column elements, portal nodes. */
  readonly towers:readonly {readonly x:number;readonly columns:readonly [readonly number[],readonly number[]];readonly columnElements:readonly [readonly number[],readonly number[]];readonly saddles:readonly [number,number]}[];
  readonly midStation:number;
  readonly length:number;
}

const positive=(value:number,label:string):number=>{if(!(Number.isFinite(value)&&value>0))throw new RangeError(`${label} must be a positive number.`);return value;};
function member(section:SiMemberSection,a:number,b:number,up:readonly [number,number,number]):FrameElement {
  return {a,b,youngModulus:section.youngModulus,shearModulus:section.shearModulus,area:section.area,iy:section.iy,iz:section.iz,torsionConstant:section.torsionConstant,density:section.massPerMetre/section.area,up};
}
/** Drawn main cable height at x: the Studio's parabola, saddleY at the towers and saddleY - sag at midspan. */
export function drawnCableHeight(params:SiSuspensionParams,x:number):number {const u=x/params.span*2;return params.saddleY-params.sag*(1-u*u);}

export function suspensionLayout(input:Partial<SiSuspensionParams>={}):SiSuspensionLayout {
  const p:SiSuspensionParams={...SI_SUSPENSION_DEFAULTS,...input};
  for(const key of ['span','deckY','halfWidth','saddleY','sag','portalY','kneeY','kneeZ','anchorX','anchorY','anchorZ'] as const)positive(p[key],key);
  const N=p.panels;if(!(Number.isInteger(N)&&N>=4&&N<=72&&N%2===0))throw new RangeError('panels must be an even integer from 4 to 72.');
  if(!(p.saddleY-p.sag>p.deckY))throw new RangeError('The main cable must stay above the deck.');
  if(!(p.towerBaseY<p.deckY&&p.deckY<p.kneeY&&p.kneeY<p.portalY&&p.portalY<p.saddleY))throw new RangeError('Tower levels must rise: base < deck < knee < portal < saddle.');
  if(!(p.anchorX>p.span/2))throw new RangeError('The anchorages must be behind the towers.');
  const xyz:number[]=[],fixedList:number[][]=[],elements:FrameElement[]=[],members:SiMemberKind[]=[];
  const node=(x:number,y:number,z:number):number=>{xyz.push(x,y,z);fixedList.push([0,0,0,0,0,0]);return xyz.length/3-1;};
  const add=(kind:SiMemberKind,section:SiMemberSection,a:number,b:number,up:readonly [number,number,number])=>{elements.push(member(section,a,b,up));members.push(kind);return elements.length-1;};
  const half=p.span/2,dx=p.span/N,w=p.halfWidth;
  // Mirror-image stations get mirror-image coordinates to the last bit.
  const stationX=Float64Array.from({length:N+1},(_,j)=>j<=N-j?-half+dx*j:half-dx*(N-j));
  const girders:[Int32Array,Int32Array]=[new Int32Array(N+1),new Int32Array(N+1)],centres=new Int32Array(N+1);
  for(let j=0;j<=N;j++){girders[0][j]=node(stationX[j],p.deckY,-w);centres[j]=node(stationX[j],p.deckY,0);girders[1][j]=node(stationX[j],p.deckY,w);}
  const girderElements:[Int32Array,Int32Array]=[new Int32Array(N),new Int32Array(N)];
  for(let side=0;side<2;side++)for(let j=0;j<N;j++)girderElements[side][j]=add('girder',p.girder,girders[side][j],girders[side][j+1],[0,1,0]);
  for(let j=0;j<=N;j++){add('crossbeam',p.crossbeam,girders[0][j],centres[j],[0,1,0]);add('crossbeam',p.crossbeam,centres[j],girders[1][j],[0,1,0]);}
  // X bracing in plan: both diagonals of every panel (they cross without a node).
  for(let j=0;j<N;j++){add('bracing',p.bracing,girders[0][j],girders[1][j+1],[0,1,0]);add('bracing',p.bracing,girders[1][j],girders[0][j+1],[0,1,0]);}
  // Bearings: both girder ends held in x, y and z on the piers (x at both ends keeps the structure mirror-symmetric).
  for(const j of [0,N])for(let side=0;side<2;side++){const f=fixedList[girders[side][j]];f[0]=f[1]=f[2]=1;}
  const towers:SiSuspensionLayout['towers'][number][]=[],levels=[p.towerBaseY,(2*p.towerBaseY+p.kneeY)/3,(p.towerBaseY+2*p.kneeY)/3,p.kneeY,p.portalY,p.saddleY];
  for(const t of [0,1]){
    const x=t===0?-half:half,columns:[number[],number[]]=[[],[]],columnElements:[number[],number[]]=[[],[]];
    for(let side=0;side<2;side++){
      const z=side?w:-w;
      for(let k=0;k<levels.length;k++){
        const n=node(x,levels[k],z);columns[side].push(n);
        if(k>0)columnElements[side].push(add('column',p.column,n-1,n,[1,0,0]));
      }
      fixedList[columns[side][0]].fill(1);
    }
    const left=node(x,p.portalY,-p.kneeZ),right=node(x,p.portalY,p.kneeZ),top=levels.indexOf(p.portalY),knee=levels.indexOf(p.kneeY);
    add('portal',p.portal,columns[0][top],left,[0,1,0]);add('portal',p.portal,left,right,[0,1,0]);add('portal',p.portal,right,columns[1][top],[0,1,0]);
    add('knee',p.knee,columns[0][knee],left,[1,0,0]);add('knee',p.knee,columns[1][knee],right,[1,0,0]);
    towers.push({x,columns,columnElements,saddles:[columns[0][levels.length-1],columns[1][levels.length-1]]});
  }
  const pts:number[]=[],anchoredList:number[]=[],segments:SiSegment[]=[];
  const point=(x:number,y:number,z:number,anchored:boolean):number=>{pts.push(x,y,z);anchoredList.push(anchored?1:0);return -(pts.length/3);};
  const cablePoints:[Int32Array,Int32Array]=[new Int32Array(N+1).fill(-1),new Int32Array(N+1).fill(-1)],hangers:[Int32Array,Int32Array]=[new Int32Array(N+1).fill(-1),new Int32Array(N+1).fill(-1)];
  for(const side of [0,1] as const){
    const z=side?w:-w,az=side?p.anchorZ:-p.anchorZ,left=towers[0].saddles[side],right=towers[1].saddles[side];
    const anchorL=point(-p.anchorX,p.anchorY,az,true);
    segments.push({a:anchorL,b:left,kind:'backstay',side,station:0});
    let previous=left;
    for(let j=1;j<N;j++){
      const end=point(stationX[j],drawnCableHeight(p,stationX[j]),z,false);cablePoints[side][j]=-end-1;
      segments.push({a:previous,b:end,kind:'main',side,station:j});previous=end;
    }
    segments.push({a:previous,b:right,kind:'main',side,station:N});
    const anchorR=point(p.anchorX,p.anchorY,az,true);
    segments.push({a:right,b:anchorR,kind:'backstay',side,station:N});
    for(let j=1;j<N;j++){hangers[side][j]=segments.length;segments.push({a:-cablePoints[side][j]-1,b:girders[side][j],kind:'hanger',side,station:j});}
  }
  const fixed=new Uint8Array(6*fixedList.length);fixedList.forEach((f,i)=>fixed.set(f,6*i));
  return {params:p,positions:Float64Array.from(xyz),fixed,elements,members,points:Float64Array.from(pts),anchored:Uint8Array.from(anchoredList),segments,
    stationX,girders,centres,girderElements,cablePoints,hangers,towers,midStation:N/2,length:p.span};
}

// ---------------------------------------------------------------------------------------------
// Statics

export interface SiSuspensionLoad {
  /** Pedestrian crowd, N/m^2 over the walkway width (2 halfWidth) between stations `from` and `to` (whole panels). */
  readonly crowd?:{readonly pressure:number;readonly from:number;readonly to:number};
  /** A vehicle of this weight (N) at x (m) on the deck centreline, shared by the lever rule between the two centre nodes. */
  readonly vehicle?:{readonly x:number;readonly weight:number};
  /** Extra frame nodal loads, six per frame node (N, N m). */
  readonly nodal?:ArrayLike<number>;
  /** Segments that have failed: a hanger lets go of the deck, a main cable or backstay segment carries nothing. */
  readonly failed?:readonly number[];
}
export interface SiSuspensionState {
  /** Frame displacements (six per frame node) followed by cable point displacements (three per point). */
  readonly displacements:Float64Array;
  readonly tensions:Float64Array;
  /** Support reactions at fixed degrees of freedom, same layout as `displacements` (anchorages included). */
  readonly reactions:Float64Array;
  readonly iterations:number;
  /** Largest out-of-balance force (N) or moment (N m) at a free degree of freedom. */
  readonly residual:number;
}
export interface SiSuspensionModes {
  readonly frequencies:number[];readonly shapes:Float64Array[];
  /** Share of each mode's kinetic energy in deck motion along y (vertical), z (lateral), torsional (girders opposite), and everything else. */
  readonly character:{vertical:number;lateral:number;torsion:number;other:number}[];
}
export interface SiFormFinding {
  /** Horizontal component of each main cable's tension under dead load, N. */
  readonly horizontal:[number,number];
  /** Largest vertical deflection of a girder at a hanger after form-finding, m. */
  readonly deckLevel:number;
  /** Midspan main cable height reached, m (target saddleY - sag). */
  readonly midHeight:number;
  readonly passes:number;
}

/** Dense-envelope statics of a suspension layout: the frame's element matrices; every cable segment a
 * tension-only spring along its current chord (exact geometry, so the main cable's sag and gravity
 * stiffness are in it); segment weights lumped half and half on their ends, as the cable solver does.
 * Newton's method with the full tangent. Builds the unstressed lengths by form-finding. */
export class SiSuspensionStatics {
  readonly layout:SiSuspensionLayout;readonly gravity:number;readonly windLoad:number;
  readonly frameNodes:number;readonly pointCount:number;readonly size:number;
  readonly elements:FrameElementMatrices[];
  readonly restLengths:Float64Array;
  /** EA of each segment, N. */
  readonly axial:Float64Array;
  /** Consistent nodal loads of the frame's own weight and the wind, frame part of the size. */
  readonly memberLoads:Float64Array;
  /** The same for the weight alone (form-finding is for the dead load). */
  readonly weightLoads:Float64Array;
  /** Lumped masses on frame nodes (the saddles), kg per node. */
  readonly pointMasses:Float64Array;
  private forming=false;
  /** Each element's own distributed load in its axes (12 per element), for end actions. */
  readonly elementLoads:Float64Array;
  readonly form:SiFormFinding;
  /** The form-found dead-load state (with the wind, if any): the default start of every solve. */
  readonly dead:SiSuspensionState;
  private readonly freeIndex:Int32Array;private readonly freeDofs:Int32Array;private readonly first:Int32Array;
  private readonly K:EnvelopeMatrix;private readonly T:EnvelopeMatrix;

  constructor(layout:SiSuspensionLayout,options:{readonly gravity?:number;readonly windLoad?:number}={}) {
    this.layout=layout;this.gravity=options.gravity??SI_SUSPENSION_GRAVITY;this.windLoad=options.windLoad??0;
    if(!Number.isFinite(this.gravity)||!Number.isFinite(this.windLoad))throw new RangeError('gravity and windLoad must be finite.');
    this.frameNodes=layout.positions.length/3;this.pointCount=layout.points.length/3;this.size=6*this.frameNodes+3*this.pointCount;
    this.elements=layout.elements.map(e=>frameElementMatrices(e,layout.positions));
    this.axial=Float64Array.from(layout.segments,s=>{const c=s.kind==='hanger'?layout.params.hanger:layout.params.mainCable;return c.youngModulus*c.area;});
    // Free degrees of freedom in order of x, then y and z, so that the envelope stays narrow.
    const items=Array.from({length:this.frameNodes+this.pointCount},(_,i)=>i),at=(i:number,k:number)=>i<this.frameNodes?layout.positions[3*i+k]:layout.points[3*(i-this.frameNodes)+k];
    items.sort((a,b)=>at(a,0)-at(b,0)||at(a,1)-at(b,1)||at(a,2)-at(b,2)||a-b);
    this.freeIndex=new Int32Array(this.size).fill(-1);const free:number[]=[];
    for(const item of items){
      if(item<this.frameNodes){for(let k=0;k<6;k++){const dof=6*item+k;if(!layout.fixed[dof]){this.freeIndex[dof]=free.length;free.push(dof);}}}
      else{const p=item-this.frameNodes;if(layout.anchored[p])continue;for(let k=0;k<3;k++){const dof=6*this.frameNodes+3*p+k;this.freeIndex[dof]=free.length;free.push(dof);}}
    }
    this.freeDofs=Int32Array.from(free);const n=free.length;
    const first=this.first=Int32Array.from({length:n},(_,i)=>i);
    const couple=(dofs:number[])=>{let lo=Infinity;for(const d of dofs){const f=this.freeIndex[d];if(f>=0)lo=Math.min(lo,f);}for(const d of dofs){const f=this.freeIndex[d];if(f>=0&&lo<first[f])first[f]=lo;}};
    for(const e of this.elements)couple(Array.from(e.dofs));
    for(const s of layout.segments)couple([...this.endDofs(s.a),...this.endDofs(s.b)]);
    this.K=new EnvelopeMatrix(n,first);this.T=new EnvelopeMatrix(n,first);
    const fsize=6*this.frameNodes;
    this.memberLoads=new Float64Array(fsize);this.weightLoads=new Float64Array(fsize);this.elementLoads=new Float64Array(12*this.elements.length);
    const acceleration=new Float64Array(12),share=new Float64Array(12);
    this.elements.forEach((e,index)=>{
      for(let i=0;i<12;i++){const a=this.freeIndex[e.dofs[i]];if(a<0)continue;for(let j=0;j<=i;j++){const b=this.freeIndex[e.dofs[j]];if(b>=0)this.K.add(a,b,e.stiffness[12*i+j]);}}
      // A uniform load q per metre is the consistent mass matrix times q / (rho A). Wind goes to the girders, half each.
      const wind=layout.members[index]==='girder'?this.windLoad/2/(e.definition.density*e.definition.area):0;
      for(let j=0;j<12;j++)acceleration[j]=j%6===1?-this.gravity:j%6===2?wind:0;
      for(let i=0;i<12;i++){
        let sum=0,weight=0;for(let j=0;j<12;j++){sum+=e.massMatrix[12*i+j]*acceleration[j];if(j%6===1)weight+=e.massMatrix[12*i+j]*acceleration[j];}
        this.memberLoads[e.dofs[i]]+=sum;this.weightLoads[e.dofs[i]]+=weight;share[i]=sum;
      }
      for(let i=0;i<12;i++){let v=0;for(let j=0;j<3;j++)v+=e.basis[3*(i%3)+j]*share[i-i%3+j];this.elementLoads[12*index+i]=v;}
    });
    this.pointMasses=new Float64Array(this.frameNodes);
    if(!(layout.params.saddleMass>=0))throw new RangeError('saddleMass must be zero or more.');
    for(const t of layout.towers)for(const node of t.saddles){this.pointMasses[node]+=layout.params.saddleMass;this.memberLoads[6*node+1]-=layout.params.saddleMass*this.gravity;this.weightLoads[6*node+1]-=layout.params.saddleMass*this.gravity;}
    this.restLengths=new Float64Array(layout.segments.length);
    const found=this.formFind();this.form=found.form;this.dead=found.state;
  }

  /** Global degrees of freedom of a segment end (three translations). */
  endDofs(end:number):number[] {const base=end>=0?6*end:6*this.frameNodes+3*(-end-1);return [base,base+1,base+2];}
  /** Drawn position of a segment end, plus a displacement field if given. */
  endPosition(end:number,u:Float64Array|null,out:[number,number,number]=[0,0,0]):[number,number,number] {
    const source=end>=0?this.layout.positions:this.layout.points,i=end>=0?end:-end-1,dofs=this.endDofs(end);
    for(let k=0;k<3;k++)out[k]=source[3*i+k]+(u?u[dofs[k]]:0);return out;
  }
  private chord(i:number,u:Float64Array|null):{length:number;n:[number,number,number]} {
    const s=this.layout.segments[i],a=this.endPosition(s.a,u),b=this.endPosition(s.b,u),d:[number,number,number]=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];
    const length=Math.hypot(d[0],d[1],d[2]);return {length,n:[d[0]/length,d[1]/length,d[2]/length]};
  }
  /** Mass of segment i, kg. */
  segmentMass(i:number):number {const s=this.layout.segments[i],c=s.kind==='hanger'?this.layout.params.hanger:this.layout.params.mainCable;return c.massPerMetre*this.restLengths[i];}
  /** Total mass of the frame members and the cable segments, kg. */
  structureMass():number {let m=0;for(const e of this.elements)m+=e.mass;for(let i=0;i<this.restLengths.length;i++)m+=this.segmentMass(i);for(const p of this.pointMasses)m+=p;return m;}
  /** Tension of segment i at displacements u, N. */
  tension(i:number,u:Float64Array):number {const L0=this.restLengths[i],stretch=this.chord(i,u).length-L0;return stretch>0?this.axial[i]*stretch/L0:0;}
  /** Breaking load of segment i, N. */
  breakingLoad(i:number):number {return (this.layout.segments[i].kind==='hanger'?this.layout.params.hanger:this.layout.params.mainCable).breakingLoad;}

  /** Nodal loads (frame part) of a crowd load: consistent loads of a uniform pressure on the girders, half the width each. */
  crowdLoad(pressure:number,from:number,to:number,out:Float64Array=new Float64Array(6*this.frameNodes)):Float64Array {
    const L=this.layout,N=L.params.panels;
    if(!(Number.isInteger(from)&&Number.isInteger(to)&&from>=0&&to<=N&&from<to))throw new RangeError('A crowd covers whole panels: 0 <= from < to <= panels.');
    if(!Number.isFinite(pressure))throw new RangeError('The crowd pressure must be finite.');
    const q=pressure*L.params.halfWidth;
    for(let side=0;side<2;side++)for(let j=from;j<to;j++){
      const index=L.girderElements[side][j],e=this.elements[index],a=-q/(e.definition.density*e.definition.area);
      for(let i=0;i<12;i++){let sum=0;for(let k=0;k<12;k++)if(k%6===1)sum+=e.massMatrix[12*i+k]*a;out[e.dofs[i]]+=sum;}
    }
    return out;
  }
  /** The deck panel under centreline coordinate x and the fraction along it. */
  locate(x:number):{panel:number;xi:number} {
    const X=this.layout.stationX,N=X.length-1;
    if(!(x>=X[0]-1e-9&&x<=X[N]+1e-9))throw new RangeError('The position is off the deck.');
    let panel=0;while(panel<N-1&&x>=X[panel+1])panel++;
    return {panel,xi:Math.min(1,Math.max(0,(x-X[panel])/(X[panel+1]-X[panel])))};
  }
  private external(load:SiSuspensionLoad,failed:ReadonlySet<number>):Float64Array {
    const f=new Float64Array(this.size);f.set(this.forming?this.weightLoads:this.memberLoads);
    this.layout.segments.forEach((s,i)=>{
      const w=this.segmentMass(i)*this.gravity;
      // A failed segment carries no tension; its weight stays lumped on its two ends, as for an intact one.
      f[this.endDofs(s.a)[1]]-=w/2;f[this.endDofs(s.b)[1]]-=w/2;void failed;
    });
    if(load.crowd)this.crowdLoad(load.crowd.pressure,load.crowd.from,load.crowd.to,f);
    if(load.vehicle){const {panel,xi}=this.locate(load.vehicle.x),c=this.layout.centres;f[6*c[panel]+1]-=load.vehicle.weight*(1-xi);f[6*c[panel+1]+1]-=load.vehicle.weight*xi;}
    if(load.nodal){if(load.nodal.length!==6*this.frameNodes)throw new RangeError('nodal loads need six values per frame node.');for(let j=0;j<load.nodal.length;j++)f[j]+=load.nodal[j];}
    return f;
  }
  /** Frame internal forces K u (frame part only; cable point entries are zero). */
  internalForces(u:Float64Array,out:Float64Array=new Float64Array(this.size)):Float64Array {
    out.fill(0);
    for(const e of this.elements)for(let i=0;i<12;i++){let sum=0;for(let j=0;j<12;j++)sum+=e.stiffness[12*i+j]*u[e.dofs[j]];out[e.dofs[i]]+=sum;}
    return out;
  }
  private factor(u:Float64Array,failed:ReadonlySet<number>):EnvelopeMatrix {
    const T=this.T;T.copyFrom(this.K);
    this.layout.segments.forEach((s,i)=>{
      if(failed.has(i))return;
      const {length,n:dir}=this.chord(i,u),L0=this.restLengths[i],stretch=length-L0;if(!(stretch>0))return;
      const EA=this.axial[i],elastic=EA/L0,geometric=EA*stretch/L0/length,ends=[this.endDofs(s.a),this.endDofs(s.b)];
      for(let a=0;a<2;a++)for(let b=0;b<2;b++){
        const sign=a===b?1:-1;
        for(let i3=0;i3<3;i3++)for(let j3=0;j3<3;j3++){
          const row=this.freeIndex[ends[a][i3]],col=this.freeIndex[ends[b][j3]];if(row<0||col<0||col>row)continue;
          T.add(row,col,sign*((elastic-geometric)*dir[i3]*dir[j3]+(i3===j3?geometric:0)));
        }
      }
    });
    T.factor();return T;
  }
  private residual(u:Float64Array,external:Float64Array,failed:ReadonlySet<number>,out:Float64Array):void {
    this.internalForces(u,out);
    for(let j=0;j<this.size;j++)out[j]=external[j]-out[j];
    this.layout.segments.forEach((s,i)=>{
      if(failed.has(i))return;
      const T=this.tension(i,u);if(T===0)return;
      const dir=this.chord(i,u).n,a=this.endDofs(s.a),b=this.endDofs(s.b);
      for(let k=0;k<3;k++){out[a[k]]+=T*dir[k];out[b[k]]-=T*dir[k];}
    });
  }
  /** Equilibrium under the dead load and `load`. */
  solve(load:SiSuspensionLoad={},guess?:Float64Array):SiSuspensionState {
    const failed=new Set(load.failed??[]),external=this.external(load,failed),n=this.freeDofs.length;
    // Without a guess, start from the dead-load state: at the drawing itself the cable points hang on slack segments.
    const u=Float64Array.from(guess??this.dead.displacements),r=new Float64Array(this.size),x=new Float64Array(n);
    let iterations=0,previous=Infinity,L=this.factor(u,failed);
    for(;iterations<100;iterations++){
      this.residual(u,external,failed,r);
      for(let a=0;a<n;a++)x[a]=r[this.freeDofs[a]];
      L.solve(x);
      let step=0,scale=0;
      for(let a=0;a<n;a++){const j=this.freeDofs[a];u[j]+=x[a];step=Math.max(step,Math.abs(x[a]));scale=Math.max(scale,Math.abs(u[j]));}
      if(step<=1e-11*Math.max(scale,1e-3)){iterations++;break;}
      if(step>.2*previous)L=this.factor(u,failed);
      previous=step;
    }
    this.residual(u,external,failed,r);let worst=0;
    for(let a=0;a<n;a++)worst=Math.max(worst,Math.abs(r[this.freeDofs[a]]));
    const reactions=new Float64Array(this.size),tensions=new Float64Array(this.layout.segments.length);
    for(let j=0;j<this.size;j++)if(this.freeIndex[j]<0)reactions[j]=-r[j]===0?0:-r[j];
    for(let i=0;i<tensions.length;i++)tensions[i]=failed.has(i)?0:this.tension(i,u);
    if(!u.every(Number.isFinite))throw new Error('The static solve did not stay finite.');
    return {displacements:u,tensions,reactions,iterations,residual:worst};
  }

  /** Form-finding: cut every segment so that, under dead load, the deck is level at every hanger, the main
   * cables pass through the drawn midspan height and every hanger hangs plumb.
   *   1. The deck's hanger forces: the frame alone with each girder held vertically at every hanger (a
   *      continuous grillage on level supports); the support reactions are the hanger tensions.
   *   2. Each main cable is the funicular polygon of those forces (plus half of each hanger's weight and the
   *      cable's own weight) between the saddles: y_j = chord - M_j / H, with M_j the simple-beam moment
   *      of the point loads and H chosen so that the midspan point is at saddleY - sag. Backstays balance H.
   *   3. Each segment is cut to the unstressed length that gives its force at its target chord,
   *      L0 = l / (1 + T / EA).
   *   4. The towers shorten and the backstays pull the saddles sideways by millimetres: solve the whole
   *      structure, move the saddle targets to where the saddles went, and repeat 2 and 3 until they stop moving. */
  private formFind():{form:SiFormFinding;state:SiSuspensionState} {
    this.forming=true;
    const L=this.layout,p=L.params,N=p.panels,g=this.gravity,fsize=6*this.frameNodes;
    const main:[Int32Array,Int32Array]=[new Int32Array(N+1).fill(-1),new Int32Array(N+1).fill(-1)];
    L.segments.forEach((s,i)=>{if(s.kind==='main')main[s.side][s.station]=i;});
    // Targets as a displacement field from the drawing: cable points move to the polygon, saddles to where the towers put them.
    const target=new Float64Array(this.size);
    const length=(i:number)=>this.restLengths[i]>0?this.restLengths[i]:Math.hypot(...this.targetChord(i,target));
    const weight=(i:number)=>length(i)*(L.segments[i].kind==='hanger'?p.hanger:p.mainCable).massPerMetre*g;
    // 1. Deck on level supports at the hangers (frame only; the hanger's lower half-weight acts on the deck).
    const hold=new Uint8Array(this.size);for(let j=0;j<this.size;j++)hold[j]=j<fsize?L.fixed[j]:1;
    for(let side=0;side<2;side++)for(let j=1;j<N;j++)hold[6*L.girders[side][j]+1]=1;
    const hangerForce=[new Float64Array(N+1),new Float64Array(N+1)];
    let level:{displacements:Float64Array;reactions:Float64Array}|null=null;
    const levelDeck=()=>{
      const deckLoads=new Float64Array(this.size);deckLoads.set(this.weightLoads);
      for(let side=0;side<2;side++)for(let j=1;j<N;j++)deckLoads[6*L.girders[side][j]+1]-=weight(L.hangers[side][j])/2;
      level=this.linearFrameSolve(hold,deckLoads);
      for(let side=0;side<2;side++)for(let j=1;j<N;j++){
        hangerForce[side][j]=level.reactions[6*L.girders[side][j]+1];
        if(!(hangerForce[side][j]>0))throw new Error('A hanger would have to push to level the deck; change the layout.');
      }
    };
    const X=L.stationX,horizontal:[number,number]=[0,0];
    let state:SiSuspensionState|null=null,passes=0,lastMove=Infinity;
    const saddleShift=[[0,0,0,0,0,0],[0,0,0,0,0,0]];
    for(;passes<10&&lastMove>1e-10;passes++){
      levelDeck();
      for(const side of [0,1] as const){
        const sL=this.endPosition(L.towers[0].saddles[side],null),sR=this.endPosition(L.towers[1].saddles[side],null);
        for(let k=0;k<3;k++){sL[k]+=saddleShift[side][k];sR[k]+=saddleShift[side][3+k];}
        // 2. Funicular polygon of the loads at the cable points between the (moved) saddles.
        const xs=Float64Array.from(X),y=Float64Array.from(X,x=>drawnCableHeight(p,x));xs[0]=sL[0];xs[N]=sR[0];y[0]=sL[1];y[N]=sR[1];
        const span=xs[N]-xs[0],mid=L.midStation,P=new Float64Array(N+1),M=new Float64Array(N+1);
        let H=0;
        for(let inner=0;inner<(passes===0?8:3);inner++){
          for(let j=1;j<N;j++){
            const point=L.cablePoints[side][j],base=fsize+3*point;target[base+1]=y[j]-L.points[3*point+1];
            P[j]=hangerForce[side][j]+weight(L.hangers[side][j])/2+(weight(main[side][j])+weight(main[side][j+1]))/2;
          }
          let RA=0;for(let j=1;j<N;j++)RA+=P[j]*(xs[N]-xs[j])/span;
          for(let j=1;j<N;j++){let m=RA*(xs[j]-xs[0]);for(let k=1;k<j;k++)m-=P[k]*(xs[j]-xs[k]);M[j]=m;}
          H=M[mid]/(sL[1]+(sR[1]-sL[1])*(xs[mid]-xs[0])/span-(p.saddleY-p.sag));
          for(let j=1;j<N;j++)y[j]=sL[1]+(sR[1]-sL[1])*(xs[j]-xs[0])/span-M[j]/H;
        }
        horizontal[side]=H;
        for(let j=1;j<N;j++){const point=L.cablePoints[side][j],base=fsize+3*point;target[base]=0;target[base+1]=y[j]-L.points[3*point+1];target[base+2]=0;}
        for(let k=0;k<3;k++){target[6*L.towers[0].saddles[side]+k]=saddleShift[side][k];target[6*L.towers[1].saddles[side]+k]=saddleShift[side][3+k];}
      }
      // 3. Cut every segment for its force at its target chord.
      const cut=new Float64Array(this.restLengths.length);
      L.segments.forEach((s,i)=>{
        const chord=this.targetChord(i,target),l=Math.hypot(chord[0],chord[1],chord[2]);
        const T=s.kind==='hanger'?hangerForce[s.side][s.station]:horizontal[s.side]*l/Math.abs(chord[0]);
        cut[i]=l/(1+T/this.axial[i]);
      });
      this.restLengths.set(cut);
      // 4. Solve the whole structure and see where the saddles went.
      const guess=state?Float64Array.from((state as SiSuspensionState).displacements):Float64Array.from(target);
      if(!state){const d=(level as unknown as {displacements:Float64Array}).displacements;for(let j=0;j<fsize;j++)guess[j]=d[j];}
      state=this.solve({},guess);lastMove=0;
      for(const side of [0,1] as const)for(let t=0;t<2;t++){
        const node=L.towers[t].saddles[side];
        // Along the bridge the target stays plumb (the backstay is cut to balance H there); down and sideways it follows the tower.
        for(let k=1;k<3;k++){const value=state.displacements[6*node+k];lastMove=Math.max(lastMove,Math.abs(value-saddleShift[side][3*t+k]));saddleShift[side][3*t+k]=value;}
      }
    }
    const final=state as unknown as SiSuspensionState;
    let deckLevel=0;
    for(let side=0;side<2;side++)for(let j=1;j<N;j++)deckLevel=Math.max(deckLevel,Math.abs(final.displacements[6*L.girders[side][j]+1]));
    const midPoint=L.cablePoints[0][L.midStation];
    // With wind the cut is the same (form-finding is for the dead load); the dead state then carries the wind too.
    this.forming=false;
    const dead=this.windLoad===0?final:this.solve({},final.displacements);
    return {form:{horizontal,deckLevel,midHeight:L.points[3*midPoint+1]+final.displacements[fsize+3*midPoint+1],passes},state:dead};
  }
  private targetChord(i:number,target:Float64Array):[number,number,number] {
    const s=this.layout.segments[i],a=this.endPosition(s.a,target),b=this.endPosition(s.b,target);return [b[0]-a[0],b[1]-a[1],b[2]-a[2]];
  }
  /** Linear solve of the frame alone with the dofs in `hold` fixed (cable points must all be held). */
  linearFrameSolve(hold:Uint8Array,loads:Float64Array):{displacements:Float64Array;reactions:Float64Array} {
    const index=new Int32Array(this.size).fill(-1),dofs:number[]=[];
    for(const dof of this.freeDofs)if(!hold[dof]){index[dof]=dofs.length;dofs.push(dof);}
    const n=dofs.length,first=Int32Array.from({length:n},(_,i)=>i);
    for(const e of this.elements){let lo=Infinity;for(const d of e.dofs)if(index[d]>=0)lo=Math.min(lo,index[d]);for(const d of e.dofs)if(index[d]>=0&&lo<first[index[d]])first[index[d]]=lo;}
    const K=new EnvelopeMatrix(n,first);
    for(const e of this.elements)for(let i=0;i<12;i++){const a=index[e.dofs[i]];if(a<0)continue;for(let j=0;j<=i;j++){const b=index[e.dofs[j]];if(b>=0)K.add(a,b,e.stiffness[12*i+j]);}}
    K.factor();
    const x=Float64Array.from(dofs,d=>loads[d]);K.solve(x);
    const u=new Float64Array(this.size);dofs.forEach((d,a)=>{u[d]=x[a];});
    const ku=this.internalForces(u),reactions=new Float64Array(this.size);
    for(let j=0;j<6*this.frameNodes;j++)if(index[j]<0)reactions[j]=ku[j]-loads[j];
    return {displacements:u,reactions};
  }

  /** Member end actions of one element in its own axes: force x, y, z and moment x, y, z at each end. */
  private readonly scratchLocal=new Float64Array(12);private readonly scratchEnds=new Float64Array(12);
  endActions(index:number,u:Float64Array):Float64Array {
    const e=this.elements[index],local=this.scratchLocal,out=this.scratchEnds;
    for(let i=0;i<12;i++){let value=0;for(let j=0;j<3;j++)value+=e.basis[3*(i%3)+j]*u[e.dofs[i-i%3+j]];local[i]=value;}
    for(let i=0;i<12;i++){let f=0;for(let j=0;j<12;j++)f+=e.localStiffness[12*i+j]*local[j];out[i]=f-this.elementLoads[12*index+i];}
    return out;
  }
  /** Largest linear-elastic stress |N| / A + |M_z| / W_z + |M_y| / W_y of one element, Pa. */
  memberStress(index:number,u:Float64Array):number {
    const kind=this.layout.members[index],p=this.layout.params,section=kind==='girder'?p.girder:kind==='crossbeam'?p.crossbeam:kind==='bracing'?p.bracing:kind==='column'?p.column:kind==='portal'?p.portal:p.knee;
    const ends=this.endActions(index,u),axial=Math.abs(ends[6])/section.area;
    return axial+Math.max(Math.abs(ends[5])/section.modulusZ+Math.abs(ends[4])/section.modulusY,Math.abs(ends[11])/section.modulusZ+Math.abs(ends[10])/section.modulusY);
  }
  /** Vertical bending moment of a girder at each station (N m, sagging positive), from its end actions. */
  girderMoments(side:0|1,u:Float64Array,out:Float64Array=new Float64Array(this.layout.stationX.length)):Float64Array {
    const elements=this.layout.girderElements[side];out.fill(0);
    for(let j=0;j<elements.length;j++){const ends=this.endActions(elements[j],u);out[j]+=j===0?-ends[5]:-ends[5]/2;out[j+1]+=j===elements.length-1?ends[11]:ends[11]/2;}
    return out;
  }

  /** Mass matrix on the free degrees of freedom: consistent member masses, segment masses lumped on their
   * ends (a failed hanger's on its cable point), and point masses on frame nodes (kg per node). */
  private massMatrix(failed:ReadonlySet<number>,pointMasses?:ArrayLike<number>):EnvelopeMatrix {
    const M=new EnvelopeMatrix(this.freeDofs.length,this.first);
    for(const e of this.elements)for(let i=0;i<12;i++){const a=this.freeIndex[e.dofs[i]];if(a<0)continue;for(let j=0;j<=i;j++){const b=this.freeIndex[e.dofs[j]];if(b>=0)M.add(a,b,e.massMatrix[12*i+j]);}}
    const add=(end:number,mass:number)=>{for(const d of this.endDofs(end)){const a=this.freeIndex[d];if(a>=0)M.add(a,a,mass);}};
    this.layout.segments.forEach((s,i)=>{const m=this.segmentMass(i);add(s.a,m/2);add(s.b,m/2);void failed;});
    for(let i=0;i<this.frameNodes;i++){const m=this.pointMasses[i]+(pointMasses?pointMasses[i]:0);if(m)add(i,m);}
    return M;
  }
  /** The lowest natural frequencies of small vibrations about a static state, by inverse iteration on
   * K_t x = lambda M x with the modes already found projected out. */
  modes(count:number,state:SiSuspensionState,options:{readonly failed?:readonly number[];readonly pointMasses?:ArrayLike<number>}={}):SiSuspensionModes {
    const failed=new Set(options.failed??[]),n=this.freeDofs.length,L=this.factor(state.displacements,failed),M=this.massMatrix(failed,options.pointMasses);
    const found:Float64Array[]=[],foundM:Float64Array[]=[],frequencies:number[]=[],shapes:Float64Array[]=[],character:SiSuspensionModes['character'][number][]=[];
    // Deck dofs: girder translations (vertical / lateral; opposite vertical motion of the two girders is torsion).
    const role=new Int8Array(n).fill(-1);
    for(let side=0;side<2;side++)for(const node of this.layout.girders[side])for(const k of [1,2]){const a=this.freeIndex[6*node+k];if(a>=0)role[a]=k;}
    for(let mode=0;mode<count;mode++){
      let x=Float64Array.from({length:n},(_,i)=>Math.sin(1+(i+1)*(mode+1)*.7391)+.5*Math.cos(i*.311+mode)),mx=new Float64Array(n),lambda=0;
      const normalise=()=>{
        M.multiply(x,mx);
        for(let f=0;f<found.length;f++){let dot=0;for(let i=0;i<n;i++)dot+=foundM[f][i]*x[i];for(let i=0;i<n;i++)x[i]-=dot*found[f][i];}
        M.multiply(x,mx);let norm=0;for(let i=0;i<n;i++)norm+=x[i]*mx[i];norm=Math.sqrt(norm);for(let i=0;i<n;i++){x[i]/=norm;mx[i]/=norm;}
      };
      normalise();
      for(let iteration=0;iteration<3000;iteration++){
        const y=Float64Array.from(mx);L.solve(y);
        let dot=0;for(let i=0;i<n;i++)dot+=mx[i]*y[i];
        const next=1/dot;x=y;normalise();
        const done=Math.abs(next-lambda)<=1e-12*next;lambda=next;if(done&&iteration>2)break;
      }
      found.push(x);foundM.push(Float64Array.from(mx));frequencies.push(Math.sqrt(lambda)/(2*Math.PI));
      const shape=new Float64Array(this.size);for(let a=0;a<n;a++)shape[this.freeDofs[a]]=x[a];shapes.push(shape);
      // Kinetic energy shares: deck vertical splits into a common part (vertical) and a differential part (torsion).
      let vertical=0,lateral=0,torsion=0,deck=0;
      for(let i=0;i<n;i++){if(role[i]===2)lateral+=x[i]*mx[i];if(role[i]>=0)deck+=x[i]*mx[i];}
      for(let j=0;j<this.layout.stationX.length;j++){
        const a=this.freeIndex[6*this.layout.girders[0][j]+1],b=this.freeIndex[6*this.layout.girders[1][j]+1];if(a<0||b<0)continue;
        const share=x[a]*mx[a]+x[b]*mx[b],common=(x[a]+x[b])/2,diff=(x[a]-x[b])/2,sum=common*common+diff*diff;
        if(sum>0){vertical+=share*common*common/sum;torsion+=share*diff*diff/sum;}
      }
      character.push({vertical,lateral,torsion,other:Math.max(0,1-deck)});
    }
    return {frequencies,shapes,character};
  }
  /** M phi for a mass-normalised shape (size of the state): its dot product with a displacement field is that field's modal coordinate. */
  modalWeights(shape:Float64Array,failed:readonly number[]=[]):Float64Array {
    const n=this.freeDofs.length,M=this.massMatrix(new Set(failed)),x=Float64Array.from(this.freeDofs,d=>shape[d]),y=new Float64Array(n),out=new Float64Array(this.size);
    M.multiply(x,y);this.freeDofs.forEach((d,a)=>{out[d]=y[a];});return out;
  }
}

// ---------------------------------------------------------------------------------------------
// The time-stepped model

export type SiSuspensionWorld=Pick<NativeWorldBackend,'gravity'|'createBody'|'destroyBody'|'bodyState'|'bodyIndex'|'setBodyTransform'|'setBodyVelocity'|'applyToBody'|'step'|'replayHash'>;

/** A stand-in for the rigid world when the bridge carries no vehicle: it holds no bodies and reports the
 * rigid world's float32 gravity, so a run with it is the same as a run on an empty Box3D world. */
export function structureOnlyWorld(gravity=SI_SUSPENSION_GRAVITY):SiSuspensionWorld {
  const g:[number,number,number]=[0,-Math.fround(gravity),0];
  const none=():never=>{throw new Error('This world holds no bodies: give the bridge a Box3D world to carry a vehicle.');};
  return {gravity:()=>g,createBody:()=>null,destroyBody:()=>false,bodyState:none,bodyIndex:()=>null,setBodyTransform:none,setBodyVelocity:none,applyToBody:none,step:()=>{},replayHash:()=>0} as unknown as SiSuspensionWorld;
}

export interface SiSuspensionVehicle {
  /** kg. */
  readonly mass:number;
  /** m/s along +x; zero parks it. */
  readonly speed:number;
  /** Centreline x where it starts, m. Default: the west end of the deck. */
  readonly start?:number;
  readonly loop?:boolean;
}
export interface SiSuspensionCrowd {readonly pressure:number;readonly from:number;readonly to:number}
export interface SiSuspensionOptions {
  /** Fixed steps per second. Default 120. */
  readonly hz?:number;
  /** Rigid solver substeps per step. Default 4. */
  readonly subSteps?:number;
  /** Mass-proportional damping rate of the frame, 1/s. Default 0.1. */
  readonly damping?:number;
  /** Mass-proportional damping rate of the cables, 1/s. Default 0.1. */
  readonly cableDamping?:number;
  /** Lateral load on the deck, N per metre along +z, fixed for the run. Default 0. */
  readonly windLoad?:number;
  /** Pedestrian crowd at the start (setCrowd() changes it). */
  readonly crowd?:SiSuspensionCrowd|null;
  readonly vehicle?:SiSuspensionVehicle|null;
  /** Hangers (segment indices) whose deck connection fails at the given time, s. */
  readonly failures?:readonly {readonly segment:number;readonly time:number}[];
  /** A hanger whose tension exceeds this fraction of its minimum breaking force fails (Infinity: never). Default 1. */
  readonly ruptureAt?:number;
  /** 'equilibrium' (default) starts at rest in the static solution; 'undeformed' at the form-found dead-load shape without the other loads. */
  readonly start?:'equilibrium'|'undeformed';
  /** Shapes the start only: the structure starts in equilibrium with these extra frame loads, which are then absent. */
  readonly releaseLoad?:ArrayLike<number>;
  /** Prepare every centreline node for the vehicle at build time. Default false. */
  readonly warm?:boolean;
  /** The cable solver: 'newton' (default; Newton's method with a direct solve) or 'proximal' (block Gauss-Seidel,
   * which needs about 16 substeps and 30 times the time on these stiff steel chains). Both solve the same implicit step. */
  readonly cableSolver?:'newton'|'proximal';
  /** Substeps of the cable solve per step. Default 1 (Newton), 16 (proximal). With more than one the cables take no drag (the coupling requires it). */
  readonly cableSubsteps?:number;
  /** Most iterations of the cable solve per substep. Default 64. */
  readonly cableIterations?:number;
  /** Force tolerance of the cable solve, N (default 0.05: the round-off of the joint solve with the frame is about 1e-3 N
   * while the structure moves), and the proximal solver's gap tolerance over segment length (default 1e-9). */
  readonly cableTolerance?:number;readonly cableResidual?:number;
  /** Force tolerance of the cable and frame solves, N. Default 1e-3. */
  readonly tolerance?:number;
}
/** Half extents of the vehicle's rigid body, m (a 2.0 x 1.0 x 1.2 m utility vehicle). */
export const SI_SUSPENSION_VEHICLE_HALF_EXTENTS:readonly [number,number,number]=Object.freeze([1,.6,.5]) as readonly [number,number,number];
/** The model's body touches nothing in the world (it has no contact). */
export const SI_SUSPENSION_NO_COLLISION=Object.freeze({categoryBits:1n<<62n,maskBits:0n});

export interface SiSuspensionOutputs {
  time:number;tick:number;
  /** Mean vertical displacement of the two girders at each station, m (negative is down). */
  readonly deckDeflection:Float64Array;
  /** Mean lateral displacement of the two girders at each station, m. */
  readonly deckLateral:Float64Array;
  /** Difference of the girders' vertical displacements (z > 0 minus z < 0) at each station, m. */
  readonly deckTwist:Float64Array;
  /** Tension of every segment from its current stretch, N. */
  readonly tension:Float64Array;
  /** Tension over minimum breaking force. */
  readonly utilisation:Float64Array;
  /** Elastic support reactions at the bearings and column bases (six per frame node) and the anchorages (three per point after them). */
  readonly reactions:Float64Array;
  readonly totalReaction:[number,number,number];
  midspanDeflection:number;
  maxMainTension:number;maxHangerTension:number;maxMainUtilisation:number;maxHangerUtilisation:number;
  /** Largest girder stress over yield (|N|/A + |M|/W, linear elastic), and the same for crossbeams, columns and portals. */
  girderUtilisation:number;crossbeamUtilisation:number;towerUtilisation:number;
  /** Saddle displacement along the bridge, m, at each tower and side. */
  readonly saddleShift:Float64Array;
  vehicleX:number;
}

/** The suspension footbridge on a rigid world. One call of step() is one fixed step of everything. Hangers
 * fail by letting go of the deck: the hanger then swings from its main cable point. */
export class SiSuspensionBridge {
  readonly layout:SiSuspensionLayout;readonly statics:SiSuspensionStatics;
  readonly dt:number;readonly subSteps:number;readonly gravity:number;
  readonly frame:FrameRuntime;readonly cables:CompliantCableRuntime[]=[];readonly coupling:StructureCoupling<NativeBodyHandle>;
  readonly initial:SiSuspensionState;
  readonly out:SiSuspensionOutputs;
  /** Segments (hangers) that have failed, in order. */
  readonly failed:number[]=[];
  readonly failedAt:number[]=[];
  readonly vehicle:{readonly body:NativeBodyHandle;readonly mass:number;readonly speed:number;readonly loop:boolean;x:number;laps:number}|null=null;
  crowd:SiSuspensionCrowd|null;
  ruptureAt:number;
  private readonly world:SiSuspensionWorld;
  private readonly views:ReturnType<FrameRuntime['couplingViews']>;
  /** Per segment end: which cable runtime, which of its nodes. */
  private readonly endCable:Int32Array;private readonly endNode:Int32Array;
  private readonly bottom:(StructureAttachment|null)[];
  /** Link index of each segment in its cable runtime, and which segments have failed. */
  private readonly edgeOf:Int32Array;private readonly failedMask:Uint8Array;
  private readonly failures:{segment:number;time:number}[];
  private readonly fixedElements:number[];
  private readonly baseLoads:Float64Array;
  private readonly pins:StructureAttachment[]=[];private pinnedPanel=-1;private readonly carried=new Float64Array(8);
  private readonly a3:[number,number,number]=[0,0,0];private readonly b3:[number,number,number]=[0,0,0];
  private disposed=false;

  constructor(world:SiSuspensionWorld|null,layout:SiSuspensionLayout,options:SiSuspensionOptions={}) {
    const hz=options.hz??120,subSteps=options.subSteps??4,cableSolver=options.cableSolver??'newton',cableSubsteps=options.cableSubsteps??(cableSolver==='newton'?1:16),damping=options.damping??.1,cableDamping=options.cableDamping??.1,tolerance=options.tolerance??1e-3;
    if(!(Number.isFinite(hz)&&hz>=30&&hz<=1000))throw new RangeError('hz must be between 30 and 1000.');
    if(!(Number.isInteger(subSteps)&&subSteps>=1&&subSteps<=16))throw new RangeError('subSteps must be an integer from 1 to 16.');
    if(!(damping>=0&&damping<=1000&&cableDamping>=0&&cableDamping<=1000))throw new RangeError('damping rates must be between 0 and 1000 per second.');
    if(!(tolerance>0))throw new RangeError('tolerance must be positive.');
    world??=structureOnlyWorld();
    const g=world.gravity();
    if(!(g[0]===0&&g[2]===0&&g[1]<0))throw new RangeError('The bridge needs a world with gravity straight down.');
    this.world=world;this.layout=layout;this.dt=1/hz;this.subSteps=subSteps;this.gravity=-g[1];
    const statics=this.statics=new SiSuspensionStatics(layout,{gravity:this.gravity,windLoad:options.windLoad??0});
    this.crowd=options.crowd??null;this.ruptureAt=options.ruptureAt??1;
    if(!(this.ruptureAt>0))throw new RangeError('ruptureAt must be positive.');
    const vehicle=options.vehicle??null;
    if(vehicle){
      positive(vehicle.mass,'vehicle.mass');if(!(Number.isFinite(vehicle.speed)&&vehicle.speed>=0))throw new RangeError('vehicle.speed must be zero or more.');
      const h=SI_SUSPENSION_VEHICLE_HALF_EXTENTS,start=vehicle.start??layout.stationX[0];statics.locate(start);
      const body=world.createBody({shape:{kind:'box',halfExtents:h},type:'dynamic',position:[start,layout.params.deckY,0],density:vehicle.mass/(8*h[0]*h[1]*h[2]),neverSleeps:true,color:0x30363c,filter:SI_SUSPENSION_NO_COLLISION});
      if(!body)throw new Error('The rigid world has no room for the vehicle body (a vehicle needs a Box3D world).');
      this.vehicle={body,mass:world.bodyState(body).mass,speed:vehicle.speed,loop:vehicle.loop===true,x:start,laps:0};
    }
    const load=this.staticLoad();
    this.initial=statics.solve(load);
    const startState=options.releaseLoad?statics.solve({...load,nodal:options.releaseLoad},this.initial.displacements):this.initial;
    const undeformed=options.start==='undeformed',u0=undeformed?statics.dead.displacements:startState.displacements;
    const fsize=6*statics.frameNodes;
    this.baseLoads=new Float64Array(fsize);for(let j=0;j<fsize;j++)this.baseLoads[j]=statics.memberLoads[j]-statics.weightLoads[j];
    const config={dt:this.dt,substeps:1,maxIterations:1024,drag:damping,gravity:[0,-this.gravity,0] as [number,number,number],forceTolerance:tolerance,momentTolerance:tolerance,impulseTolerance:1e-10,angularImpulseTolerance:1e-10,solver:'direct' as const};
    const pointMasses=statics.pointMasses;
    this.frame=new FrameRuntime({config,positions:layout.positions,elements:layout.elements,fixed:layout.fixed,displacements:u0.subarray(0,fsize),forces:this.frameLoads(),pointMasses});
    this.views=this.frame.couplingViews();
    const adapter:StructureWorld<NativeBodyHandle>={
      gravity:()=>world.gravity(),getState:b=>world.bodyState(b),
      applyForce:(b,f,point)=>world.applyToBody(b,'force',f,point),applyTorque:(b,t)=>world.applyToBody(b,'torque',t),
      applyImpulse:(b,j)=>world.applyToBody(b,'impulse',j),applyAngularImpulse:(b,j)=>world.applyToBody(b,'angular-impulse',j),
      isAlive:b=>world.bodyIndex(b)!==null,subSteps,
    };
    this.coupling=new StructureCoupling(adapter,{dt:this.dt});
    this.coupling.addFrame(this.frame);
    // One cable runtime holds both main cables, the backstays and the hangers; every frame-node end (saddles, hanger
    // feet) is a cable node attached to the frame. With the Newton cable solver the coupling solves the whole network
    // together with the frame each step (StructureCoupling's joint step), so these stiff steel chains need no small steps.
    const segments=layout.segments;
    this.endCable=new Int32Array(2*segments.length);this.endNode=new Int32Array(2*segments.length);this.bottom=segments.map(()=>null);
    this.edgeOf=new Int32Array(segments.length);this.failedMask=new Uint8Array(segments.length);
    const groups=new Map<string,number[]>();
    segments.forEach((seg,i)=>{const key=cableSolver==='newton'?'all':seg.kind==='backstay'?`${seg.side}/backstay/${seg.station}`:`${seg.side}/main`;let list=groups.get(key);if(!list){list=[];groups.set(key,list);}list.push(i);});
    const order=[...groups.keys()].sort((a,b)=>(a.includes('backstay')?0:1)-(b.includes('backstay')?0:1)||(a<b?-1:a>b?1:0));
    for(const key of order){
      const own=groups.get(key)!,ends=new Map<number,number>(),positions:number[]=[],masses:number[]=[],pinned:number[]=[],constraints:{a:number;b:number;restLength:number;compliance:number}[]=[];
      const nodeOf=(end:number):number=>{
        let k=ends.get(end);if(k!==undefined)return k;
        k=masses.length;ends.set(end,k);const p=statics.endPosition(end,u0);positions.push(p[0],p[1],p[2]);masses.push(0);
        pinned.push(end<0&&layout.anchored[-end-1]?1:0);return k;
      };
      for(const i of own){
        const seg=segments[i],a=nodeOf(seg.a),b=nodeOf(seg.b),half=statics.segmentMass(i)/2;masses[a]+=half;masses[b]+=half;
        this.edgeOf[i]=constraints.length;constraints.push({a,b,restLength:statics.restLengths[i],compliance:statics.restLengths[i]/statics.axial[i]});
        this.endCable[2*i]=this.endCable[2*i+1]=this.cables.length;this.endNode[2*i]=a;this.endNode[2*i+1]=b;
      }
      const cable=new CompliantCableRuntime({config:{dt:this.dt,substeps:cableSubsteps,maxIterations:options.cableIterations??64,residualTolerance:options.cableResidual??1e-9,drag:cableSubsteps>1?0:cableDamping,gravity:[0,-this.gravity,0],solver:cableSolver,forceTolerance:options.cableTolerance??.05},
        positions,masses,pinned,constraints});
      this.cables.push(cable);
      for(const [end,k] of ends){
        if(end<0)continue;
        const att=this.coupling.attachCableToFrame(cable,k,this.frame,end);
        // Tell the coupling what the segments meeting this node already pull with.
        const force:[number,number,number]=[0,0,0];
        for(const i of own){
          const seg=segments[i];if(seg.a!==end&&seg.b!==end)continue;
          const T=statics.tension(i,u0),other=seg.a===end?seg.b:seg.a,p=statics.endPosition(end,u0),q=statics.endPosition(other,u0),l=Math.hypot(q[0]-p[0],q[1]-p[1],q[2]-p[2]);
          for(let c=0;c<3;c++)force[c]+=T*(q[c]-p[c])/l;
          if(seg.kind==='hanger'&&seg.b===end)this.bottom[i]=att;
        }
        if(!undeformed)this.coupling.prime(att,force);
      }
    }
    this.failures=(options.failures??[]).map(f=>{
      if(!(Number.isInteger(f.segment)&&segments[f.segment]?.kind==='hanger'))throw new RangeError('Only hangers can fail: give a hanger segment index.');
      if(!(Number.isFinite(f.time)&&f.time>=0))throw new RangeError('failure time must be zero or more.');
      return {segment:f.segment,time:f.time};
    });
    this.fixedElements=[];statics.elements.forEach((e,index)=>{if(Array.from(e.dofs).some(dof=>layout.fixed[dof]))this.fixedElements.push(index);});
    const stations=layout.stationX.length;
    this.out={time:0,tick:0,deckDeflection:new Float64Array(stations),deckLateral:new Float64Array(stations),deckTwist:new Float64Array(stations),tension:new Float64Array(segments.length),utilisation:new Float64Array(segments.length),
      reactions:new Float64Array(statics.size),totalReaction:[0,0,0],midspanDeflection:0,maxMainTension:0,maxHangerTension:0,maxMainUtilisation:0,maxHangerUtilisation:0,
      girderUtilisation:0,crossbeamUtilisation:0,towerUtilisation:0,saddleShift:new Float64Array(4),vehicleX:NaN};
    if(this.vehicle){
      const inertia={kind:'box' as const,halfExtents:SI_SUSPENSION_VEHICLE_HALF_EXTENTS};
      if(options.warm)for(const node of layout.centres)this.coupling.detach(this.coupling.attachFrameToBody(this.frame,node,this.vehicle.body,{mode:'pinned',inertia}));
      this.restVehicle();this.placeVehicle();
      if(!undeformed){const xi=statics.locate(this.vehicle.x).xi,W=this.vehicle.mass*this.gravity;this.coupling.prime(this.pins[0],[0,W*(1-xi),0]);this.coupling.prime(this.pins[1],[0,W*xi,0]);}
    }
    this.measure();
  }

  /** The static load case the run is in now (crowd and vehicle). */
  staticLoad():SiSuspensionLoad {
    return {...(this.crowd?{crowd:this.crowd}:{}),...(this.vehicle?{vehicle:{x:this.vehicle.x,weight:this.vehicle.mass*this.gravity}}:{}),...(this.failed.length?{failed:this.failed.slice()}:{})};
  }
  /** The loads the frame carries besides its own weight (wind and crowd), as given to it now. */
  private applied=new Float64Array(0);
  private frameLoads():Float64Array {
    const f=Float64Array.from(this.baseLoads);
    if(this.crowd)this.statics.crowdLoad(this.crowd.pressure,this.crowd.from,this.crowd.to,f);
    this.applied=f;return f;
  }
  /** Change the pedestrian crowd from the next step on (null removes it). */
  setCrowd(crowd:SiSuspensionCrowd|null):void {
    if(crowd)this.statics.crowdLoad(crowd.pressure,crowd.from,crowd.to);
    this.crowd=crowd?{pressure:crowd.pressure,from:crowd.from,to:crowd.to}:null;this.frame.setLoads(this.frameLoads());
  }
  /** Current position of a frame node. */
  nodePosition(index:number,out:[number,number,number]=[0,0,0]):[number,number,number] {
    const {rest,displacements:u}=this.views;out[0]=rest[3*index]+u[6*index];out[1]=rest[3*index+1]+u[6*index+1];out[2]=rest[3*index+2]+u[6*index+2];return out;
  }
  /** Current position of one end of a segment (0: a, 1: b). A frame end is where its frame node is while it is
   * attached; a failed hanger's lower end is where the cable solver has it. */
  endPosition(segment:number,which:0|1,out:[number,number,number]=[0,0,0]):[number,number,number] {
    const s=this.layout.segments[segment],end=which?s.b:s.a;
    if(end>=0&&!(s.kind==='hanger'&&which===1&&this.bottom[segment]===null))return this.nodePosition(end,out);
    const c=this.cables[this.endCable[2*segment+which]].couplingViews().positions,k=this.endNode[2*segment+which];
    out[0]=c[3*k];out[1]=c[3*k+1];out[2]=c[3*k+2];return out;
  }
  private placeVehicle():void {
    const v=this.vehicle!,world=this.world,{panel,xi}=this.statics.locate(v.x),nodes=this.layout.centres;
    const a=this.nodePosition(nodes[panel],[0,0,0]),b=this.nodePosition(nodes[panel+1],[0,0,0]),carried=this.carried;let known=0;
    for(const pin of this.pins){if(known<2&&this.pinnedPanel>=0){carried[4*known]=nodes[this.pinnedPanel+known];carried[4*known+1]=pin.force[0];carried[4*known+2]=pin.force[1];carried[4*known+3]=pin.force[2];known++;}this.coupling.detach(pin);}
    this.pins.length=0;
    let x0=b[0]-a[0],x1=b[1]-a[1],x2=b[2]-a[2];const length=Math.hypot(x0,x1,x2);x0/=length;x1/=length;x2/=length;
    let z0=-x2,z2=x0;const zl=Math.hypot(z0,z2);z0/=zl;z2/=zl;
    const y0=-z2*x1,y1=z2*x0-z0*x2,y2=z0*x1,w=Math.sqrt(Math.max(0,1+x0+y1+z2))/2,q:[number,number,number,number]=[y2/(4*w),(z0-x2)/(4*w),(x1-y0)/(4*w),w];
    world.setBodyTransform(v.body,[a[0]+xi*(b[0]-a[0]),a[1]+xi*(b[1]-a[1]),a[2]+xi*(b[2]-a[2])],q);
    const inertia={kind:'box' as const,halfExtents:SI_SUSPENSION_VEHICLE_HALF_EXTENTS};
    for(let end=0;end<2;end++){
      const node=nodes[panel+end],pin=this.coupling.attachFrameToBody(this.frame,node,v.body,{mode:'pinned',inertia});this.pins.push(pin);
      for(let k=0;k<known;k++)if(carried[4*k]===node)this.coupling.prime(pin,[carried[4*k+1],carried[4*k+2],carried[4*k+3]]);
    }
    this.pinnedPanel=panel;
  }
  private restVehicle():void {this.world.setBodyVelocity(this.vehicle!.body,[0,this.gravity*this.dt/(2*this.subSteps),0],[0,0,0]);}
  /** A hanger breaks: from the next step on it carries nothing. (With the Newton cable solver its link is released and its
   * two ends stay where they are attached; with the proximal solver its foot lets go of the deck and it swings from its
   * cable point.) Returns false if it had already failed. */
  failHanger(segment:number):boolean {
    if(this.layout.segments[segment]?.kind!=='hanger')throw new RangeError('Not a hanger segment.');
    if(this.failedMask[segment])return false;
    const cable=this.cables[this.endCable[2*segment]];
    if(cable.config.solver==='newton')cable.releaseLink(this.edgeOf[segment]);
    else{const att=this.bottom[segment];if(att){this.coupling.detach(att);this.bottom[segment]=null;}}
    this.failedMask[segment]=1;this.failed.push(segment);this.failedAt.push(this.out.time);return true;
  }
  isFailed(segment:number):boolean {return this.failedMask[segment]===1;}
  beforeWorldStep():void {
    if(this.disposed)throw new Error('This bridge has been disposed.');
    const time=this.out.tick*this.dt;
    for(const f of this.failures)if(time>=f.time-1e-9*this.dt)this.failHanger(f.segment);
    // Rupture: a hanger over its breaking force at the end of the last step lets go now.
    if(Number.isFinite(this.ruptureAt))for(let side=0;side<2;side++)for(const i of this.layout.hangers[side])if(i>=0&&!this.failedMask[i]&&this.out.utilisation[i]>this.ruptureAt)this.failHanger(i);
    const v=this.vehicle;
    if(v&&v.speed>0){
      const start=this.layout.stationX[0],end=this.layout.stationX[this.layout.stationX.length-1];
      if(v.x<end||v.loop){let x=v.x+v.speed*this.dt;if(x>=end){if(v.loop){x-=end-start;v.laps++;this.restVehicle();}else x=end;}v.x=x;this.placeVehicle();}
    }
    this.coupling.step();
  }
  afterWorldStep():void {this.out.tick++;this.out.time=this.out.tick*this.dt;this.measure();}
  step():void {this.beforeWorldStep();this.world.step(this.dt,this.subSteps);this.afterWorldStep();}

  private measure():void {
    const out=this.out,L=this.layout,s=this.statics,u=this.views.displacements,a=this.a3,b=this.b3;
    for(let j=0;j<L.stationX.length;j++){
      const l=6*L.girders[0][j],r=6*L.girders[1][j];
      out.deckDeflection[j]=(u[l+1]+u[r+1])/2;out.deckLateral[j]=(u[l+2]+u[r+2])/2;out.deckTwist[j]=u[r+1]-u[l+1];
    }
    out.midspanDeflection=out.deckDeflection[L.midStation];
    out.maxMainTension=out.maxHangerTension=out.maxMainUtilisation=out.maxHangerUtilisation=0;
    L.segments.forEach((seg,i)=>{
      this.endPosition(i,0,a);this.endPosition(i,1,b);
      const L0=s.restLengths[i],stretch=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2])-L0,T=stretch>0&&!this.failedMask[i]?s.axial[i]*stretch/L0:0,ratio=T/s.breakingLoad(i);
      out.tension[i]=T;out.utilisation[i]=ratio;
      if(seg.kind==='hanger'){if(T>out.maxHangerTension)out.maxHangerTension=T;if(ratio>out.maxHangerUtilisation)out.maxHangerUtilisation=ratio;}
      else{if(T>out.maxMainTension)out.maxMainTension=T;if(ratio>out.maxMainUtilisation)out.maxMainUtilisation=ratio;}
    });
    // Elastic reactions at the frame supports (K u minus the loads acting there), and at the anchorages.
    const r=out.reactions,fixed=L.fixed;r.fill(0);
    for(const index of this.fixedElements){
      const e=s.elements[index];
      for(let i=0;i<12;i++){const dof=e.dofs[i];if(!fixed[dof])continue;let sum=0;for(let j=0;j<12;j++)sum+=e.stiffness[12*i+j]*u[e.dofs[j]];r[dof]+=sum;}
    }
    for(let j=0;j<6*s.frameNodes;j++)if(fixed[j])r[j]-=s.weightLoads[j]+this.applied[j];
    L.segments.forEach((seg,i)=>{
      for(const which of [0,1] as const){
        const end=which?seg.b:seg.a;if(end>=0||!L.anchored[-end-1])continue;
        this.endPosition(i,0,a);this.endPosition(i,1,b);const l=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]),sign=which?1:-1,base=6*s.frameNodes+3*(-end-1);
        // The segment pulls the anchorage towards its other end; the anchorage also carries half the segment's weight.
        for(let k=0;k<3;k++)r[base+k]+=sign*out.tension[i]*(b[k]-a[k])/l;
        r[base+1]+=s.segmentMass(i)*this.gravity/2;
      }
    });
    if(this.vehicle&&this.pinnedPanel>=0)for(let end=0;end<2;end++){const node=L.centres[this.pinnedPanel+end];for(let k=0;k<3;k++)if(fixed[6*node+k])r[6*node+k]+=this.pins[end].force[k];}
    out.totalReaction[0]=out.totalReaction[1]=out.totalReaction[2]=0;
    for(let j=0;j<6*s.frameNodes;j+=6)for(let k=0;k<3;k++)out.totalReaction[k]+=r[j+k];
    for(let p=0;p<s.pointCount;p++)for(let k=0;k<3;k++)out.totalReaction[k]+=r[6*s.frameNodes+3*p+k];
    let girder=0,crossbeam=0,tower=0;
    L.members.forEach((kind,index)=>{
      if(kind==='bracing'||kind==='knee')return;
      const ratio=s.memberStress(index,u)/(kind==='girder'?L.params.girder:kind==='crossbeam'?L.params.crossbeam:kind==='column'?L.params.column:L.params.portal).yieldStress;
      if(kind==='girder')girder=Math.max(girder,ratio);else if(kind==='crossbeam')crossbeam=Math.max(crossbeam,ratio);else tower=Math.max(tower,ratio);
    });
    out.girderUtilisation=girder;out.crossbeamUtilisation=crossbeam;out.towerUtilisation=tower;
    L.towers.forEach((t,ti)=>{for(let side=0;side<2;side++)out.saddleShift[2*ti+side]=u[6*t.saddles[side]];});
    out.vehicleX=this.vehicle?this.vehicle.x:NaN;
  }
  /** Displacements in the statics' layout: six per frame node, then three per cable point (from the cable solver). */
  displacements(out:Float64Array=new Float64Array(this.statics.size)):Float64Array {
    const s=this.statics,F=6*s.frameNodes;out.set(this.views.displacements);
    this.layout.segments.forEach((seg,i)=>{
      for(const which of [0,1] as const){
        const end=which?seg.b:seg.a;if(end>=0)continue;
        const point=-end-1,c=this.cables[this.endCable[2*i+which]].couplingViews().positions,k=this.endNode[2*i+which];
        for(let d=0;d<3;d++)out[F+3*point+d]=c[3*k+d]-this.layout.points[3*point+d];
      }
    });
    return out;
  }
  /** Weight the supports carry, N. */
  totalWeight():number {return (this.statics.structureMass()+(this.vehicle?this.vehicle.mass:0))*this.gravity;}
  /** Every number that defines the state, for bit-for-bit comparisons. */
  stateBytes():Uint8Array {
    const parts:Float64Array[]=[Float64Array.from(this.views.displacements),Float64Array.from(this.views.velocities)];
    for(const cable of this.cables){const c=cable.couplingViews();parts.push(Float64Array.from(c.positions),Float64Array.from(c.velocities));}
    if(this.vehicle){const st=this.world.bodyState(this.vehicle.body);parts.push(Float64Array.from([...st.position,...st.rotation,...st.linearVelocity,...st.angularVelocity,this.vehicle.x]));}
    parts.push(Float64Array.from([this.out.tick,this.world.replayHash(),...this.failed]));
    const bytes=new Uint8Array(parts.reduce((sum,part)=>sum+part.byteLength,0));let offset=0;
    for(const part of parts){bytes.set(new Uint8Array(part.buffer,part.byteOffset,part.byteLength),offset);offset+=part.byteLength;}
    return bytes;
  }
  dispose():void {
    if(this.disposed)return;this.disposed=true;
    if(this.vehicle&&this.world.bodyIndex(this.vehicle.body)!==null)this.world.destroyBody(this.vehicle.body);
    for(const cable of this.cables)cable.destroy();this.frame.destroy();
  }
}
