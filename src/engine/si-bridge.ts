/**
 * A cable-stayed bridge in SI units on the validated solvers: Euler-Bernoulli frame elements for the
 * deck and the towers (frame-runtime.ts), tension-only compliant cables for the stays
 * (compliant-cable.ts), a rigid body for the vehicle (Box3D through native-world.ts), all coupled
 * two ways by StructureCoupling (structure-coupling.ts). See docs/SI_BRIDGE.md for the hand numbers,
 * the validation table and the limits.
 *
 * What the model is: linear beams (small strains and rotations), axial stays, loads attached at
 * nodes. What it is not: there is no contact between wheels and deck, no buckling, yielding or
 * geometric stiffness of the members, no cable sag (one segment per stay) and no aerodynamics beyond
 * a static lateral load. The utilisation ratios are linear-elastic indicators, not a design check.
 *
 * The file has three parts:
 *   1. layouts: `cableStayedLayout` (two towers, three spans) and `proppedSpanLayout` (one span, one
 *      stay: the hand-checkable case);
 *   2. `SiBridgeStatics`: an independent dense static solver of the same discrete structure
 *      (pretension, dead-load shape, influence lines, damaged re-solve, modes);
 *   3. `SiBridge`: the time-stepped model on the rigid world.
 */
import {frameElementMatrices,type FrameElement,type FrameElementMatrices} from './frame-element.ts';
import {FrameRuntime} from './frame-runtime.ts';
import {CompliantCableRuntime} from './compliant-cable.ts';
import {StructureCoupling,type StructureAttachment,type StructureWorld} from './structure-coupling.ts';
import type {NativeBodyHandle,NativeWorldBackend} from './native-world.ts';

export const SI_BRIDGE_ID='bridge';
export const SI_BRIDGE_TITLE='Cable-stayed bridge (SI)';
export const SI_BRIDGE_GRAVITY=9.81;
/** Out-of-balance force (N) and moment (N m) at which the frame's conjugate-gradient solve stops each
 * step, and force at which the stay solver stops. Loads are of order 1e5 to 1e6 N. */
const FRAME_TOLERANCE=1e-4,STAY_TOLERANCE=1e-4;

/** A prismatic member. Lengths in m, moduli and stresses in Pa, mass in kg/m. */
export interface SiBridgeSection {
  readonly youngModulus:number;readonly shearModulus:number;
  /** Cross-section area, m^2. */
  readonly area:number;
  /** Second moment of area for bending out of the member's vertical plane (deck: lateral), m^4. */
  readonly iy:number;
  /** Second moment of area for bending in the member's vertical plane (deck: vertical; tower: along the bridge), m^4. */
  readonly iz:number;
  /** St Venant torsion constant, m^4. */
  readonly torsionConstant:number;
  /** Mass per metre including everything the member carries permanently, kg/m. */
  readonly massPerMetre:number;
  /** Elastic section modulus for `iz` bending, m^3. */
  readonly sectionModulus:number;
  readonly yieldStress:number;
  /** Drawn size only. */
  readonly depth:number;readonly width:number;
}
export interface SiBridgeStaySection {
  readonly youngModulus:number;readonly area:number;readonly massPerMetre:number;readonly breakingStress:number;
}

// Hand numbers (docs/SI_BRIDGE.md derives each one).
/** Deck: a steel box girder 4.0 m wide and 1.2 m deep in 16 mm plate, with 20 % longitudinal stiffeners,
 * carrying a 5 m wide surface. A = 2 (4.0 + 1.2) 0.016 x 1.2 = 0.20 m^2. Vertical bending: flanges
 * 2 (4.0 x 0.016) 0.6^2 = 0.0461, webs 2 x 0.016 x 1.2^3 / 12 = 0.0046, x 1.2 = 0.060 m^4; Z = I / 0.6 = 0.10 m^3.
 * Lateral: webs 2 (1.2 x 0.016) 2.0^2 = 0.154, flanges 2 x 0.016 x 4^3 / 12 = 0.171, x 1.2 = 0.38 m^4 (rounded down).
 * Torsion (Bredt, one cell): 4 (4.0 x 1.2)^2 / (2 (4.0 + 1.2) / 0.016) = 0.14 m^4. Mass: steel 7850 x 0.20 = 1570 kg/m,
 * 70 mm asphalt on 5 m 805 kg/m, parapets and services 225 kg/m: 2600 kg/m, 25.5 kN/m. Steel S355. */
export const SI_BRIDGE_DECK:SiBridgeSection=Object.freeze({youngModulus:210e9,shearModulus:81e9,area:.20,iy:.38,iz:.060,torsionConstant:.14,massPerMetre:2600,sectionModulus:.10,yieldStress:355e6,depth:1.2,width:5});
/** Tower: a steel box 1.5 m square in 30 mm plate. A = 4 x 1.5 x 0.03 = 0.18 m^2; I = 2 (1.5 x 0.03) 0.75^2 +
 * 2 x 0.03 x 1.5^3 / 12 = 0.0675 m^4; Z = I / 0.75 = 0.09 m^3; J = 4 (1.5^2)^2 / (4 x 1.5 / 0.03) = 0.10 m^4;
 * 7850 x 0.18 = 1413 kg/m. Steel S355. */
export const SI_BRIDGE_TOWER:SiBridgeSection=Object.freeze({youngModulus:210e9,shearModulus:81e9,area:.18,iy:.0675,iz:.0675,torsionConstant:.10,massPerMetre:1413,sectionModulus:.09,yieldStress:355e6,depth:1.5,width:1.5});
/** Stay: six 15.7 mm seven-wire strands of 150 mm^2: A = 900 mm^2, E = 195 GPa, breaking stress 1860 MPa,
 * 7850 x 9e-4 x 1.15 (sheath) = 8.1 kg/m. E A = 175.5 MN. */
export const SI_BRIDGE_STAY:SiBridgeStaySection=Object.freeze({youngModulus:195e9,area:9e-4,massPerMetre:8.1,breakingStress:1860e6});

export interface SiBridgeParams {
  /** Main span between the towers, m. Each side span is half of it. */
  readonly span:number;
  /** Stays on each side of each tower (the bridge has four times as many). */
  readonly staysPerSide:number;
  /** Deck beam elements between neighbouring stay anchorages. */
  readonly elementsPerPanel:number;
  /** Tower top above the deck axis, m. */
  readonly towerHeight:number;
  /** Tower base below the deck axis, m. */
  readonly towerDepth:number;
  /** Vertical spacing of the stay anchorages below the tower top, m (0 gives a fan). */
  readonly anchorSpacing:number;
  readonly deck:SiBridgeSection;readonly tower:SiBridgeSection;readonly stay:SiBridgeStaySection;
}
export const SI_BRIDGE_DEFAULTS:SiBridgeParams=Object.freeze({span:60,staysPerSide:4,elementsPerPanel:1,towerHeight:15,towerDepth:8,anchorSpacing:1.5,deck:SI_BRIDGE_DECK,tower:SI_BRIDGE_TOWER,stay:SI_BRIDGE_STAY});

export interface SiBridgeStayLayout {
  readonly towerNode:number;readonly deckNode:number;
  /** Unstressed length, m. Omit to let the pretension solve choose it (level deck under dead load). */
  readonly restLength?:number;
}
/** A structure the model can build: frame nodes and elements, supports, and stays between frame nodes. */
export interface SiBridgeLayout {
  readonly positions:Float64Array;readonly fixed:Uint8Array;
  readonly elements:readonly FrameElement[];readonly members:readonly ('deck'|'tower')[];
  /** Deck nodes in order of x; deckElements[j] joins deckNodes[j] and deckNodes[j + 1]. */
  readonly deckNodes:readonly number[];readonly deckElements:readonly number[];
  readonly towers:readonly {readonly x:number;readonly nodes:readonly number[];readonly elements:readonly number[]}[];
  readonly stays:readonly SiBridgeStayLayout[];
  readonly deck:SiBridgeSection;readonly tower:SiBridgeSection;readonly stay:SiBridgeStaySection;
  /** Deck node whose deflection is reported as "midspan". */
  readonly midNode:number;
  readonly length:number;
}

const positive=(value:number,label:string):number=>{if(!(Number.isFinite(value)&&value>0))throw new RangeError(`${label} must be a positive number.`);return value;};
const whole=(value:number,label:string,min:number,max:number):number=>{if(!(Number.isInteger(value)&&value>=min&&value<=max))throw new RangeError(`${label} must be an integer from ${min} to ${max}.`);return value;};
function checkSection(s:SiBridgeSection,label:string):void {
  for(const key of ['youngModulus','shearModulus','area','iy','iz','torsionConstant','massPerMetre','sectionModulus','yieldStress','depth','width'] as const)positive(s[key],`${label}.${key}`);
}
function checkStay(s:SiBridgeStaySection):void {for(const key of ['youngModulus','area','massPerMetre','breakingStress'] as const)positive(s[key],`stay.${key}`);}
/** The frame element of a section between two nodes. Its density is mass per metre over area, so that
 * the element weighs what the member and everything fixed to it weigh. */
function element(section:SiBridgeSection,a:number,b:number,up:readonly [number,number,number]):FrameElement {
  return {a,b,youngModulus:section.youngModulus,shearModulus:section.shearModulus,area:section.area,iy:section.iy,iz:section.iz,torsionConstant:section.torsionConstant,density:section.massPerMetre/section.area,up};
}

/** Two towers and three spans: side span, main span, side span = span/2, span, span/2. The deck is
 * one line of beam elements at y = 0 from x = 0 to x = 2 span, held vertically, laterally and in
 * torsion at both abutments and fixed along x at both (which keeps the structure mirror-symmetric);
 * it passes the towers without touching them. Each tower is a column clamped at its base. Stays run
 * in one plane from anchorages near the tower top to deck nodes every span/(2 n + 2) on both sides. */
export function cableStayedLayout(input:Partial<SiBridgeParams>={}):SiBridgeLayout {
  const p={...SI_BRIDGE_DEFAULTS,...input};
  positive(p.span,'span');positive(p.towerHeight,'towerHeight');positive(p.towerDepth,'towerDepth');
  const n=whole(p.staysPerSide,'staysPerSide',1,8),m=whole(p.elementsPerPanel,'elementsPerPanel',1,4);
  if(!(Number.isFinite(p.anchorSpacing)&&p.anchorSpacing>=0))throw new RangeError('anchorSpacing must be zero or more.');
  checkSection(p.deck,'deck');checkSection(p.tower,'tower');checkStay(p.stay);
  const panels=4*n+4,panel=p.span/(2*n+2),deckCount=panels*m+1,length=2*p.span;
  const firstAnchor=p.towerHeight-(n-1)*p.anchorSpacing;
  if(!(firstAnchor>0))throw new RangeError('The lowest stay anchorage must be above the deck: reduce anchorSpacing or raise the tower.');
  // Tower nodes: base, two intermediate nodes up to the lowest anchorage, then one node per anchorage (shared when the spacing is 0).
  const levels=[-p.towerDepth,-p.towerDepth+(firstAnchor+p.towerDepth)/3,-p.towerDepth+2*(firstAnchor+p.towerDepth)/3,firstAnchor];
  if(p.anchorSpacing>0)for(let k=1;k<n;k++)levels.push(firstAnchor+k*p.anchorSpacing);
  const nodeCount=deckCount+2*levels.length,positions=new Float64Array(3*nodeCount),fixed=new Uint8Array(6*nodeCount);
  const elements:FrameElement[]=[],members:('deck'|'tower')[]=[],deckNodes:number[]=[],deckElements:number[]=[];
  for(let i=0;i<deckCount;i++){
    // Mirror-image nodes get mirror-image coordinates to the last bit.
    positions[3*i]=i<=deckCount-1-i?panel*i/m:length-panel*(deckCount-1-i)/m;deckNodes.push(i);
    if(i>0){deckElements.push(elements.length);elements.push(element(p.deck,i-1,i,[0,1,0]));members.push('deck');}
  }
  for(const end of [0,deckCount-1]){fixed[6*end]=fixed[6*end+1]=fixed[6*end+2]=fixed[6*end+3]=1;}
  const towers:{x:number;nodes:number[];elements:number[]}[]=[],stays:SiBridgeStayLayout[]=[];
  for(let t=0;t<2;t++){
    const deckIndex=(t===0?n+1:3*n+3)*m,x=positions[3*deckIndex],first=deckCount+t*levels.length,nodes:number[]=[],own:number[]=[];
    for(let k=0;k<levels.length;k++){
      const node=first+k;positions[3*node]=x;positions[3*node+1]=levels[k];nodes.push(node);
      if(k>0){own.push(elements.length);elements.push(element(p.tower,node-1,node,[1,0,0]));members.push('tower');}
    }
    fixed.fill(1,6*first,6*first+6);towers.push({x,nodes,elements:own});
    // Stays in order of deck x: the outermost stay of each side goes to the highest anchorage.
    for(let k=-n;k<=n;k++){
      if(k===0)continue;
      const anchor=p.anchorSpacing>0?nodes[3+(Math.abs(k)-1)]:nodes[3];
      stays.push({towerNode:anchor,deckNode:deckIndex+k*m});
    }
  }
  return {positions,fixed,elements,members,deckNodes,deckElements,towers,stays,deck:p.deck,tower:p.tower,stay:p.stay,midNode:(deckCount-1)/2,length};
}

export interface ProppedSpanParams {
  readonly span:number;readonly elements:number;readonly towerHeight:number;
  readonly deck:SiBridgeSection;readonly tower:SiBridgeSection;readonly stay:SiBridgeStaySection;
}
/** The hand-checkable case: one simply supported span (pin at x = 0, roller at x = span) propped at
 * midspan by one stay from the top of a column clamped at the pin. The stay's unstressed length is
 * its drawn length, so it carries only what the deck's sag puts into it. One redundant: the stay force. */
export function proppedSpanLayout(p:ProppedSpanParams):SiBridgeLayout {
  positive(p.span,'span');positive(p.towerHeight,'towerHeight');const count=whole(p.elements,'elements',2,64);
  if(count%2!==0)throw new RangeError('elements must be even so that a node sits at midspan.');
  checkSection(p.deck,'deck');checkSection(p.tower,'tower');checkStay(p.stay);
  const nodeCount=count+1+3,positions=new Float64Array(3*nodeCount),fixed=new Uint8Array(6*nodeCount);
  const elements:FrameElement[]=[],members:('deck'|'tower')[]=[],deckNodes:number[]=[],deckElements:number[]=[];
  for(let i=0;i<=count;i++){
    positions[3*i]=p.span*i/count;deckNodes.push(i);
    if(i>0){deckElements.push(elements.length);elements.push(element(p.deck,i-1,i,[0,1,0]));members.push('deck');}
  }
  fixed[0]=fixed[1]=fixed[2]=fixed[3]=1;fixed[6*count+1]=fixed[6*count+2]=fixed[6*count+3]=1;
  const base=count+1,nodes=[base,base+1,base+2],own:number[]=[];
  for(let k=0;k<3;k++){positions[3*(base+k)+1]=p.towerHeight*k/2;if(k>0){own.push(elements.length);elements.push(element(p.tower,base+k-1,base+k,[1,0,0]));members.push('tower');}}
  fixed.fill(1,6*base,6*base+6);
  const restLength=Math.hypot(p.span/2,p.towerHeight);
  return {positions,fixed,elements,members,deckNodes,deckElements,towers:[{x:0,nodes,elements:own}],stays:[{towerNode:base+2,deckNode:count/2,restLength}],deck:p.deck,tower:p.tower,stay:p.stay,midNode:count/2,length:p.span};
}

// ---------------------------------------------------------------------------------------------
// Statics

/** In-place Cholesky factor (lower triangle) of a dense symmetric positive definite matrix. */
function cholesky(A:Float64Array,n:number):void {
  for(let j=0;j<n;j++){
    let d=A[j*n+j];for(let k=0;k<j;k++)d-=A[j*n+k]*A[j*n+k];
    if(!(d>0))throw new Error('The structure is a mechanism or has lost its stiffness (the tangent matrix is not positive definite).');
    const root=Math.sqrt(d);A[j*n+j]=root;
    for(let i=j+1;i<n;i++){let s=A[i*n+j];const ri=i*n,rj=j*n;for(let k=0;k<j;k++)s-=A[ri+k]*A[rj+k];A[ri+j]=s/root;}
  }
}
function choleskySolve(L:Float64Array,n:number,x:Float64Array):void {
  for(let i=0;i<n;i++){let s=x[i];const r=i*n;for(let k=0;k<i;k++)s-=L[r+k]*x[k];x[i]=s/L[r+i];}
  for(let i=n-1;i>=0;i--){let s=x[i];for(let k=i+1;k<n;k++)s-=L[k*n+i]*x[k];x[i]=s/L[i*n+i];}
}

export interface SiBridgeStaticLoad {
  /** A vehicle of this weight (N) standing at deck coordinate x (m). 'lever' shares it between the two
   * neighbouring nodes in proportion to distance, as the time-stepped model's two pins do; 'consistent'
   * uses the cubic beam's work-equivalent forces and moments, the exact load for the beam element. */
  readonly vehicle?:{readonly x:number;readonly weight:number;readonly model?:'lever'|'consistent'};
  /** Extra nodal loads, six per node (N and N m). */
  readonly nodal?:ArrayLike<number>;
  /** Stays whose deck anchorage has failed: they hang from the tower and carry nothing. */
  readonly failed?:readonly number[];
}
export interface SiBridgeStaticState {
  /** Displacements, six per node. */
  readonly displacements:Float64Array;
  readonly tensions:Float64Array;
  /** Support reactions at fixed degrees of freedom, six per node. */
  readonly reactions:Float64Array;
  readonly iterations:number;
  /** Largest out-of-balance force (N) or moment (N m) at a free degree of freedom. */
  readonly residual:number;
}
export interface SiBridgeModes {
  /** Natural frequencies in Hz, lowest first. */
  readonly frequencies:number[];
  /** Mass-normalised shapes, six values per node. */
  readonly shapes:Float64Array[];
  /** Fraction of each mode's kinetic energy in deck motion along x, y (vertical) and z (lateral), and in everything else. */
  readonly character:{x:number;y:number;z:number;other:number}[];
}

/** Dense statics of a layout: the same frame element matrices as FrameRuntime, each stay a
 * tension-only spring along its current chord (so the stay geometry is exact), stay weights lumped
 * half and half on their end nodes as the cable solver does. Newton's method with the full tangent. */
export class SiBridgeStatics {
  readonly layout:SiBridgeLayout;readonly gravity:number;readonly windLoad:number;
  readonly nodeCount:number;readonly size:number;
  readonly elements:FrameElementMatrices[];
  /** Unstressed stay lengths, m. */
  readonly restLengths:Float64Array;
  /** Consistent nodal loads of the frame's own weight and the wind, six per node. */
  readonly memberLoads:Float64Array;
  /** Weight of each element's distributed load in its own axes (12 per element), for end actions. */
  readonly elementLoads:Float64Array;
  private readonly freeIndex:Int32Array;private readonly freeDofs:Int32Array;
  private readonly K:Float64Array;

  constructor(layout:SiBridgeLayout,options:{readonly gravity?:number;readonly windLoad?:number}={}) {
    this.layout=layout;this.gravity=options.gravity??SI_BRIDGE_GRAVITY;this.windLoad=options.windLoad??0;
    if(!Number.isFinite(this.gravity)||!Number.isFinite(this.windLoad))throw new RangeError('gravity and windLoad must be finite.');
    this.nodeCount=layout.positions.length/3;this.size=6*this.nodeCount;
    this.elements=layout.elements.map(e=>frameElementMatrices(e,layout.positions));
    this.freeIndex=new Int32Array(this.size).fill(-1);const free:number[]=[];
    for(let j=0;j<this.size;j++)if(!layout.fixed[j]){this.freeIndex[j]=free.length;free.push(j);}
    this.freeDofs=Int32Array.from(free);
    const n=free.length,K=this.K=new Float64Array(n*n);
    this.memberLoads=new Float64Array(this.size);this.elementLoads=new Float64Array(12*this.elements.length);
    const acceleration=new Float64Array(12);
    this.elements.forEach((e,index)=>{
      for(let i=0;i<12;i++){const a=this.freeIndex[e.dofs[i]];if(a<0)continue;for(let j=0;j<12;j++){const b=this.freeIndex[e.dofs[j]];if(b>=0)K[a*n+b]+=e.stiffness[12*i+j];}}
      // A uniform load q per metre along a direction is the consistent mass matrix times q / (rho A): the same shape functions.
      const wind=layout.members[index]==='deck'?this.windLoad/(e.definition.density*e.definition.area):0;
      for(let j=0;j<12;j++)acceleration[j]=j%6===1?-this.gravity:j%6===2?wind:0;
      const share=new Float64Array(12);
      for(let i=0;i<12;i++){let sum=0;for(let j=0;j<12;j++)sum+=e.massMatrix[12*i+j]*acceleration[j];this.memberLoads[e.dofs[i]]+=sum;share[i]=sum;}
      // The element's share in its own axes (three by three blocks), for member end actions.
      for(let i=0;i<12;i++){let v=0;for(let j=0;j<3;j++)v+=e.basis[3*(i%3)+j]*share[i-i%3+j];this.elementLoads[12*index+i]=v;}
    });
    this.restLengths=new Float64Array(layout.stays.length);
    layout.stays.forEach((s,i)=>{this.restLengths[i]=s.restLength??this.chord(i,null).length;});
    if(layout.stays.some(s=>s.restLength===undefined))this.levelPretension();
  }

  /** Mass of stay i, kg: its unstressed length times its mass per metre. */
  stayMass(i:number):number {return this.layout.stay.massPerMetre*this.restLengths[i];}
  /** Total mass of the frame members and the stays, kg. */
  structureMass():number {let m=0;for(const e of this.elements)m+=e.mass;for(let i=0;i<this.restLengths.length;i++)m+=this.stayMass(i);return m;}
  private chord(i:number,u:Float64Array|null):{length:number;n:[number,number,number]} {
    const s=this.layout.stays[i],p=this.layout.positions,a=s.towerNode,b=s.deckNode,d:[number,number,number]=[0,0,0];
    for(let k=0;k<3;k++)d[k]=p[3*b+k]-p[3*a+k]+(u?u[6*b+k]-u[6*a+k]:0);
    const length=Math.hypot(d[0],d[1],d[2]);return {length,n:[d[0]/length,d[1]/length,d[2]/length]};
  }
  /** Tension of stay i at displacements u, N. */
  tension(i:number,u:Float64Array):number {
    const L0=this.restLengths[i],stretch=this.chord(i,u).length-L0;
    return stretch>0?this.layout.stay.youngModulus*this.layout.stay.area*stretch/L0:0;
  }
  /** Nodal loads of a vehicle standing at deck coordinate x. */
  vehicleLoad(x:number,weight:number,model:'lever'|'consistent'='lever'):Float64Array {
    const out=new Float64Array(this.size),{index,xi,length}=this.locate(x),a=this.layout.deckNodes[index],b=this.layout.deckNodes[index+1];
    if(model==='lever'){out[6*a+1]=-weight*(1-xi);out[6*b+1]=-weight*xi;return out;}
    const s=xi,s2=s*s,s3=s2*s;
    out[6*a+1]=-weight*(1-3*s2+2*s3);out[6*a+5]=-weight*length*(s-2*s2+s3);out[6*b+1]=-weight*(3*s2-2*s3);out[6*b+5]=-weight*length*(-s2+s3);
    return out;
  }
  /** The deck element under deck coordinate x and the fraction of the way along it. */
  locate(x:number):{index:number;xi:number;length:number} {
    const nodes=this.layout.deckNodes,p=this.layout.positions,x0=p[3*nodes[0]],last=nodes.length-2;
    if(!(x>=x0-1e-9&&x<=x0+this.layout.length+1e-9))throw new RangeError('The vehicle position is off the deck.');
    let index=0;while(index<last&&x>=p[3*nodes[index+1]])index++;
    const xa=p[3*nodes[index]],length=p[3*nodes[index+1]]-xa;
    return {index,xi:Math.min(1,Math.max(0,(x-xa)/length)),length};
  }
  /** Everything that does not depend on the displacements: member weights, wind, stay weights, the given loads. */
  private external(load:SiBridgeStaticLoad,failed:ReadonlySet<number>):Float64Array {
    const f=Float64Array.from(this.memberLoads);
    this.layout.stays.forEach((s,i)=>{
      const w=this.stayMass(i)*this.gravity;
      if(failed.has(i))f[6*s.towerNode+1]-=w;else{f[6*s.towerNode+1]-=w/2;f[6*s.deckNode+1]-=w/2;}
    });
    if(load.nodal){if(load.nodal.length!==this.size)throw new RangeError('nodal loads need six values per node.');for(let j=0;j<this.size;j++)f[j]+=load.nodal[j];}
    if(load.vehicle){const v=this.vehicleLoad(load.vehicle.x,load.vehicle.weight,load.vehicle.model??'lever');for(let j=0;j<this.size;j++)f[j]+=v[j];}
    return f;
  }
  /** Frame internal forces K u, six per node. */
  internalForces(u:Float64Array,out:Float64Array=new Float64Array(this.size)):Float64Array {
    out.fill(0);
    for(const e of this.elements)for(let i=0;i<12;i++){let sum=0;for(let j=0;j<12;j++)sum+=e.stiffness[12*i+j]*u[e.dofs[j]];out[e.dofs[i]]+=sum;}
    return out;
  }
  /** Tangent stiffness on the free degrees of freedom at u, factorised. */
  private factor(u:Float64Array,failed:ReadonlySet<number>):Float64Array {
    const n=this.freeDofs.length,T=Float64Array.from(this.K),EA=this.layout.stay.youngModulus*this.layout.stay.area;
    this.layout.stays.forEach((s,i)=>{
      if(failed.has(i))return;
      const {length,n:dir}=this.chord(i,u),L0=this.restLengths[i],stretch=length-L0;if(!(stretch>0))return;
      const elastic=EA/L0,geometric=EA*stretch/L0/length,nodes=[s.towerNode,s.deckNode];
      for(let a=0;a<2;a++)for(let b=0;b<2;b++){
        const sign=a===b?1:-1;
        for(let i3=0;i3<3;i3++)for(let j3=0;j3<3;j3++){
          const row=this.freeIndex[6*nodes[a]+i3],col=this.freeIndex[6*nodes[b]+j3];if(row<0||col<0)continue;
          T[row*n+col]+=sign*((elastic-geometric)*dir[i3]*dir[j3]+(i3===j3?geometric:0));
        }
      }
    });
    cholesky(T,n);return T;
  }
  /** Out-of-balance force external + stays - K u, six per node (fixed degrees of freedom included). */
  private residual(u:Float64Array,external:Float64Array,failed:ReadonlySet<number>,out:Float64Array):void {
    this.internalForces(u,out);
    for(let j=0;j<this.size;j++)out[j]=external[j]-out[j];
    this.layout.stays.forEach((s,i)=>{
      if(failed.has(i))return;
      const T=this.tension(i,u);if(T===0)return;
      const dir=this.chord(i,u).n;
      for(let k=0;k<3;k++){out[6*s.towerNode+k]+=T*dir[k];out[6*s.deckNode+k]-=T*dir[k];}
    });
  }
  /** Equilibrium under the dead load and `load`. */
  solve(load:SiBridgeStaticLoad={},guess?:Float64Array):SiBridgeStaticState {
    const failed=new Set(load.failed??[]),external=this.external(load,failed),n=this.freeDofs.length;
    const u=guess?Float64Array.from(guess):new Float64Array(this.size),r=new Float64Array(this.size),x=new Float64Array(n);
    // Newton's method. The tangent is factorised at the start and again whenever a step fails to shrink
    // fivefold (a stay going slack or taut, or a start far from the answer): near the solution the old
    // factor converges in a few cheap steps, because the stays turn very little.
    let iterations=0,worst=Infinity,previous=Infinity,L=this.factor(u,failed);
    for(;iterations<80;iterations++){
      this.residual(u,external,failed,r);
      for(let a=0;a<n;a++)x[a]=r[this.freeDofs[a]];
      choleskySolve(L,n,x);
      let step=0,scale=0;
      for(let a=0;a<n;a++){const j=this.freeDofs[a];u[j]+=x[a];step=Math.max(step,Math.abs(x[a]));scale=Math.max(scale,Math.abs(u[j]));}
      // Stop when a step no longer changes the answer: what is left is round-off.
      if(step<=1e-13*Math.max(scale,1e-6)){iterations++;break;}
      if(step>.2*previous)L=this.factor(u,failed);
      previous=step;
    }
    this.residual(u,external,failed,r);worst=0;
    for(let a=0;a<n;a++)worst=Math.max(worst,Math.abs(r[this.freeDofs[a]]));
    const reactions=new Float64Array(this.size),tensions=new Float64Array(this.layout.stays.length);
    for(let j=0;j<this.size;j++)if(this.layout.fixed[j])reactions[j]=-r[j]===0?0:-r[j];
    for(let i=0;i<tensions.length;i++)tensions[i]=failed.has(i)?0:this.tension(i,u);
    if(!u.every(Number.isFinite))throw new Error('The static solve did not stay finite.');
    return {displacements:u,tensions,reactions,iterations,residual:worst};
  }

  /** Pretension by the zero-displacement method. With the stays replaced by unknown forces along their
   * drawn chords, the frame is linear: u = u0 + sum T_i c_i, with u0 the deflection under the dead load
   * and c_i the deflection under a unit pull of stay i. Ask for zero vertical deflection at every deck
   * anchorage (one equation per stay), solve for the forces, and cut each stay to the unstressed
   * length that gives its force at its deformed chord. The towers lean by centimetres, which turns the
   * chords, so the anchorages of the true (nonlinear) equilibrium are then level only to a fraction of
   * a millimetre: the remaining deflections are removed by repeating the step on them with the same
   * influence matrix (a quasi-Newton iteration) until they are below a micrometre. The deck then stands
   * as a continuous beam on level supports at the anchorages. */
  private levelPretension():void {
    const stays=this.layout.stays,count=stays.length,n=this.freeDofs.length,EA=this.layout.stay.youngModulus*this.layout.stay.area,none=new Set<number>();
    const L=Float64Array.from(this.K);cholesky(L,n);
    const solveFree=(f:Float64Array):Float64Array=>{const x=new Float64Array(n);for(let a=0;a<n;a++)x[a]=f[this.freeDofs[a]];choleskySolve(L,n,x);const u=new Float64Array(this.size);for(let a=0;a<n;a++)u[this.freeDofs[a]]=x[a];return u;};
    const unit=stays.map((s,i)=>{const dir=this.chord(i,null).n,f=new Float64Array(this.size);for(let k=0;k<3;k++){f[6*s.towerNode+k]=dir[k];f[6*s.deckNode+k]=-dir[k];}return solveFree(f);});
    // Influence matrix A[i][j]: vertical deflection of anchorage i per unit pull of stay j, factorised once (LU with partial pivoting; it is small and not symmetric in general).
    const A=new Float64Array(count*count),order=Int32Array.from({length:count},(_,i)=>i);
    for(let i=0;i<count;i++)for(let j=0;j<count;j++)A[i*count+j]=unit[j][6*stays[i].deckNode+1];
    for(let c=0;c<count;c++){
      let pivot=c;for(let r=c+1;r<count;r++)if(Math.abs(A[r*count+c])>Math.abs(A[pivot*count+c]))pivot=r;
      if(!(Math.abs(A[pivot*count+c])>0))throw new Error('The stays cannot level the deck (singular influence matrix).');
      if(pivot!==c){for(let k=0;k<count;k++){const t=A[c*count+k];A[c*count+k]=A[pivot*count+k];A[pivot*count+k]=t;}const t=order[c];order[c]=order[pivot];order[pivot]=t;}
      for(let r=c+1;r<count;r++){const f=A[r*count+c]/=A[c*count+c];if(f===0)continue;for(let k=c+1;k<count;k++)A[r*count+k]-=f*A[c*count+k];}
    }
    /** Stay forces that lift the anchorages by `rise` (m). */
    const forces=(rise:Float64Array):Float64Array=>{
      const b=Float64Array.from(order,row=>rise[row]);
      for(let r=1;r<count;r++){let sum=b[r];for(let k=0;k<r;k++)sum-=A[r*count+k]*b[k];b[r]=sum;}
      for(let r=count-1;r>=0;r--){let sum=b[r];for(let k=r+1;k<count;k++)sum-=A[r*count+k]*b[k];b[r]=sum/A[r*count+r];}
      return b;
    };
    const cut=(T:Float64Array,u:Float64Array):void=>{
      for(let i=0;i<count;i++){
        if(!(T[i]>0))throw new Error(`Stay ${i} would have to push to level the deck; change the layout.`);
        this.restLengths[i]=this.chord(i,u).length/(1+T[i]/EA);
      }
    };
    // First estimate from the linear frame (stay weights from the drawn lengths).
    const u0=solveFree(this.external({},none)),T=forces(Float64Array.from(stays,s=>-u0[6*s.deckNode+1])),u=Float64Array.from(u0);
    for(let i=0;i<count;i++)for(let j=0;j<this.size;j++)u[j]+=T[i]*unit[i][j];
    cut(T,u);
    let state=this.solve();
    for(let pass=0;pass<12;pass++){
      const rise=Float64Array.from(stays,s=>-state.displacements[6*s.deckNode+1]);
      if(rise.every(value=>Math.abs(value)<1e-7))break;
      // The extra forces move the frame too: cut the stays for the chords they will then have.
      const more=forces(rise),next=Float64Array.from(state.displacements);
      for(let i=0;i<count;i++){T[i]=state.tensions[i]+more[i];for(let j=0;j<this.size;j++)next[j]+=more[i]*unit[i][j];}
      cut(T,next);state=this.solve({},next);
    }
  }

  /** Bending moment of the deck at each deck node (N m, sagging positive), axial force of each deck
   * element (N, tension positive) and the largest |M| / Z + |N| / A over the deck, from the member end
   * actions K_e u_e minus the element's own distributed load. */
  deckActions(u:Float64Array,moments:Float64Array,axial:Float64Array):number {
    const deck=this.layout.deck,elements=this.layout.deckElements;let worst=0;
    moments.fill(0);
    for(let j=0;j<elements.length;j++){
      const ends=this.endActions(elements[j],u),left=-ends[5],right=ends[11];
      moments[j]+=j===0?left:left/2;moments[j+1]+=j===elements.length-1?right:right/2;axial[j]=ends[6];
      worst=Math.max(worst,Math.abs(left)/deck.sectionModulus+Math.abs(ends[6])/deck.area,Math.abs(right)/deck.sectionModulus+Math.abs(ends[6])/deck.area);
    }
    return worst;
  }
  /** Largest |M| / Z + |N| / A over the tower elements, Pa. */
  towerStress(u:Float64Array):number {
    const tower=this.layout.tower;let worst=0;
    for(const t of this.layout.towers)for(const index of t.elements){
      const ends=this.endActions(index,u);
      worst=Math.max(worst,Math.hypot(ends[4],ends[5])/tower.sectionModulus+Math.abs(ends[6])/tower.area,Math.hypot(ends[10],ends[11])/tower.sectionModulus+Math.abs(ends[6])/tower.area);
    }
    return worst;
  }
  private readonly scratchLocal=new Float64Array(12);private readonly scratchEnds=new Float64Array(12);
  /** Member end actions of one element in its own axes: force x, y, z and moment x, y, z at each end. */
  endActions(index:number,u:Float64Array):Float64Array {
    const e=this.elements[index],local=this.scratchLocal,out=this.scratchEnds;
    for(let i=0;i<12;i++){let value=0;for(let j=0;j<3;j++)value+=e.basis[3*(i%3)+j]*u[e.dofs[i-i%3+j]];local[i]=value;}
    for(let i=0;i<12;i++){let f=0;for(let j=0;j<12;j++)f+=e.localStiffness[12*i+j]*local[j];out[i]=f-this.elementLoads[12*index+i];}
    return out;
  }

  /** Mass matrix on the free degrees of freedom: consistent member masses, stay masses lumped on their
   * end nodes, and any extra point masses (kg per node). */
  private massMatrix(failed:ReadonlySet<number>,pointMasses?:ArrayLike<number>):Float64Array {
    const n=this.freeDofs.length,M=new Float64Array(n*n);
    for(const e of this.elements)for(let i=0;i<12;i++){const a=this.freeIndex[e.dofs[i]];if(a<0)continue;for(let j=0;j<12;j++){const b=this.freeIndex[e.dofs[j]];if(b>=0)M[a*n+b]+=e.massMatrix[12*i+j];}}
    const add=(node:number,mass:number)=>{for(let k=0;k<3;k++){const a=this.freeIndex[6*node+k];if(a>=0)M[a*n+a]+=mass;}};
    this.layout.stays.forEach((s,i)=>{const m=this.stayMass(i);if(failed.has(i))add(s.towerNode,m);else{add(s.towerNode,m/2);add(s.deckNode,m/2);}});
    if(pointMasses)for(let i=0;i<this.nodeCount;i++)if(pointMasses[i])add(i,pointMasses[i]);
    return M;
  }
  /** The lowest natural frequencies of small vibrations about a static state, by inverse iteration on
   * K_t x = lambda M x with the modes already found projected out. */
  modes(count:number,state:SiBridgeStaticState,options:{readonly failed?:readonly number[];readonly pointMasses?:ArrayLike<number>}={}):SiBridgeModes {
    const failed=new Set(options.failed??[]),n=this.freeDofs.length,L=this.factor(state.displacements,failed),M=this.massMatrix(failed,options.pointMasses);
    const multiply=(x:Float64Array,out:Float64Array)=>{for(let i=0;i<n;i++){let s=0;const r=i*n;for(let j=0;j<n;j++)s+=M[r+j]*x[j];out[i]=s;}};
    const found:Float64Array[]=[],foundM:Float64Array[]=[],frequencies:number[]=[],shapes:Float64Array[]=[],character:SiBridgeModes['character'][number][]=[];
    const deckDof=new Int8Array(n).fill(-1);for(const node of this.layout.deckNodes)for(let k=0;k<3;k++){const a=this.freeIndex[6*node+k];if(a>=0)deckDof[a]=k;}
    for(let mode=0;mode<count;mode++){
      // A fixed, mode-dependent start vector with a component along every shape.
      let x=Float64Array.from({length:n},(_,i)=>Math.sin(1+(i+1)*(mode+1)*.7391)+.5*Math.cos(i*.311+mode)),mx=new Float64Array(n),lambda=0;
      const normalise=()=>{
        multiply(x,mx);
        for(let f=0;f<found.length;f++){let dot=0;for(let i=0;i<n;i++)dot+=foundM[f][i]*x[i];for(let i=0;i<n;i++)x[i]-=dot*found[f][i];}
        multiply(x,mx);let norm=0;for(let i=0;i<n;i++)norm+=x[i]*mx[i];norm=Math.sqrt(norm);for(let i=0;i<n;i++){x[i]/=norm;mx[i]/=norm;}
      };
      normalise();
      for(let iteration=0;iteration<2000;iteration++){
        const y=Float64Array.from(mx);choleskySolve(L,n,y);
        let dot=0;for(let i=0;i<n;i++)dot+=mx[i]*y[i];
        const next=1/dot;x=y;normalise();
        const done=Math.abs(next-lambda)<=1e-12*next;lambda=next;if(done&&iteration>2)break;
      }
      found.push(x);foundM.push(Float64Array.from(mx));frequencies.push(Math.sqrt(lambda)/(2*Math.PI));
      const shape=new Float64Array(this.size);for(let a=0;a<n;a++)shape[this.freeDofs[a]]=x[a];shapes.push(shape);
      // x^T M x = 1, so the terms x_i (M x)_i are the shares of the kinetic energy.
      const share=[0,0,0,0];for(let i=0;i<n;i++)share[deckDof[i]<0?3:deckDof[i]]+=x[i]*mx[i];
      character.push({x:share[0],y:share[1],z:share[2],other:share[3]});
    }
    return {frequencies,shapes,character};
  }
  /** M phi for a mass-normalised shape, six values per node: the dot product of it with a displacement
   * field is that field's modal coordinate phi^T M u. */
  modalWeights(shape:Float64Array,failed:readonly number[]=[]):Float64Array {
    const n=this.freeDofs.length,M=this.massMatrix(new Set(failed)),out=new Float64Array(this.size);
    for(let i=0;i<n;i++){let s=0;const r=i*n;for(let j=0;j<n;j++)s+=M[r+j]*shape[this.freeDofs[j]];out[this.freeDofs[i]]=s;}
    return out;
  }
  /** Rayleigh's hand estimate of the lowest vertical frequency, Hz. The deck's mass is lumped at its
   * nodes (m_i, with half of each stay); the shape is the deck's deflection delta_i under its own weight
   * applied to the standing structure; f = sqrt(g sum(m_i delta_i) / sum(m_i delta_i^2)) / (2 pi). It is an
   * upper bound, as good as the shape. Each refinement (Stodola's method) loads the structure with the
   * inertia forces m_i delta_i of the previous shape and repeats, which brings the estimate down towards
   * the lowest mode that the weight excites. Returns the lumped masses and the last deflections too. */
  rayleigh(state:SiBridgeStaticState,refinements=0):{frequency:number;masses:Float64Array;deflections:Float64Array} {
    const nodes=this.layout.deckNodes,p=this.layout.positions,masses=new Float64Array(nodes.length),load=new Float64Array(this.size),n=this.freeDofs.length;
    for(let j=0;j+1<nodes.length;j++){const half=this.layout.deck.massPerMetre*(p[3*nodes[j+1]]-p[3*nodes[j]])/2;masses[j]+=half;masses[j+1]+=half;}
    this.layout.stays.forEach((s,i)=>{const at=nodes.indexOf(s.deckNode);if(at>=0)masses[at]+=this.stayMass(i)/2;});
    const L=this.factor(state.displacements,new Set()),x=new Float64Array(n),deflections=new Float64Array(nodes.length),shape=new Float64Array(nodes.length).fill(1);
    let frequency=0;
    for(let pass=0;pass<=refinements;pass++){
      // Loads m_i g shape_i (downwards); with shape = 1 that is the weight.
      nodes.forEach((node,j)=>{load[6*node+1]=-masses[j]*this.gravity*shape[j];});
      for(let a=0;a<n;a++)x[a]=load[this.freeDofs[a]];
      choleskySolve(L,n,x);
      let top=0,bottom=0,largest=0;
      nodes.forEach((node,j)=>{const a=this.freeIndex[6*node+1];deflections[j]=a<0?0:-x[a];top+=masses[j]*shape[j]*deflections[j];bottom+=masses[j]*deflections[j]*deflections[j];largest=Math.max(largest,Math.abs(deflections[j]));});
      frequency=Math.sqrt(this.gravity*top/bottom)/(2*Math.PI);
      for(let j=0;j<shape.length;j++)shape[j]=deflections[j]/largest;
    }
    return {frequency,masses,deflections};
  }
}

// ---------------------------------------------------------------------------------------------
// The time-stepped model

export interface SiBridgeVehicle {
  /** kg. The body is a steel-dense block; its measured mass (float32) is what loads the deck. */
  readonly mass:number;
  /** m/s along +x. Zero parks the vehicle. */
  readonly speed:number;
  /** Deck coordinate where it starts, m. Default 0 (on the left abutment). */
  readonly start?:number;
  /** At the far end: start again from x = 0 (true) or stay there (false, the default). */
  readonly loop?:boolean;
}
export interface SiBridgeOptions {
  /** Fixed steps per second. Default 120. */
  readonly hz?:number;
  /** Rigid solver substeps per step. Default 4. */
  readonly subSteps?:number;
  /** Mass-proportional damping rate of the frame, 1/s (a mode of angular frequency w has damping ratio rate / (2 w)). Default 0.1. */
  readonly damping?:number;
  /** Mass-proportional damping rate of the stays, 1/s. Default 0.1. */
  readonly stayDamping?:number;
  /** Lateral load on the deck, N per metre along +z. Default 0. */
  readonly windLoad?:number;
  readonly vehicle?:SiBridgeVehicle|null;
  /** The deck anchorage of this stay fails at this time (s). */
  readonly failure?:{readonly stay:number;readonly time:number}|null;
  /** 'equilibrium' (default) starts at rest in the static solution; 'undeformed' starts with every node
   * where it was drawn and lets the structure find its own equilibrium (use damping). */
  readonly start?:'equilibrium'|'undeformed';
  /** Prepare every deck node for the vehicle when the model is built (about 0.3 s for the default bridge)
   * instead of the first time the vehicle reaches it (a pause of some milliseconds per node). The numbers
   * are the same either way. Default false. */
  readonly warm?:boolean;
  /** Extra nodal loads held for the whole run are not supported; this one only shapes the START state:
   * the structure starts at rest in equilibrium with these loads, which are then absent (a release test). */
  readonly releaseLoad?:ArrayLike<number>;
}
export type SiBridgeWorld=Pick<NativeWorldBackend,'gravity'|'createBody'|'destroyBody'|'bodyState'|'bodyIndex'|'setBodyTransform'|'setBodyVelocity'|'applyToBody'|'step'|'replayHash'>;

/** A collision filter that touches nothing: the model has no contact, so its body must not meet whatever
 * else is in the world. (A filter with both fields zero would select the engine's defaults instead.) */
export const SI_BRIDGE_NO_COLLISION=Object.freeze({categoryBits:1n<<62n,maskBits:0n});
/** Half extents of the vehicle's rigid body, m: a 2.0 x 0.8 x 1.6 m block. */
export const SI_BRIDGE_VEHICLE_HALF_EXTENTS:readonly [number,number,number]=Object.freeze([1,.4,.8]) as readonly [number,number,number];

export interface SiBridgeOutputs {
  /** Seconds since the start. */
  time:number;tick:number;
  /** Vertical displacement of each deck node from its drawn position, m (negative is down). */
  readonly deckDeflection:Float64Array;
  /** Lateral displacement of each deck node, m. */
  readonly deckLateral:Float64Array;
  /** Tension of each stay from its current stretch, N. */
  readonly stayTension:Float64Array;
  /** Stay stress over breaking stress. */
  readonly stayUtilisation:Float64Array;
  /** Elastic support reactions K u - f at every fixed degree of freedom, six per node (N, N m). */
  readonly reactions:Float64Array;
  /** Reaction force x, y, z and moment x, y, z at each tower base. */
  readonly towerBase:Float64Array;
  /** Sum of the reaction forces over all supports, N. */
  readonly totalReaction:[number,number,number];
  /** Deck bending moment at each deck node, N m, sagging positive. */
  readonly deckMoment:Float64Array;
  /** Axial force of each deck element, N, tension positive. */
  readonly deckAxial:Float64Array;
  /** Largest deck stress |M| / Z + |N| / A over yield. */
  deckUtilisation:number;
  /** Largest tower stress over yield. */
  towerUtilisation:number;
  maxStayTension:number;maxStayUtilisation:number;
  /** Deflection of the layout's midspan node, m. */
  midspanDeflection:number;
  /** Deck coordinate of the vehicle, m (NaN without one). */
  vehicleX:number;
}

/** The bridge on a rigid world. One call of step() is one fixed step of everything. When something
 * else steps the world (the Physics Lab), call beforeWorldStep() and afterWorldStep() around it.
 *
 * The vehicle is ONE rigid body pinned to the two deck nodes it stands between, at the height of its
 * centre of mass (two pins in a line cannot steady a body whose centre is above them). The pins share
 * its weight by the lever rule and pass its inertia to the deck. It is moved along the deck by
 * re-attachment: every step the body is set down speed x dt further along the chord of its element
 * and pinned again where the nodes are. It has no velocity along the deck and no wheels; nothing
 * touches the deck surface. */
export class SiBridge {
  readonly layout:SiBridgeLayout;readonly statics:SiBridgeStatics;
  readonly dt:number;readonly subSteps:number;readonly gravity:number;
  readonly frame:FrameRuntime;readonly cables:CompliantCableRuntime[]=[];readonly coupling:StructureCoupling<NativeBodyHandle>;
  /** The static state the run started from (with the vehicle at its start, without any release load). */
  readonly initial:SiBridgeStaticState;
  readonly out:SiBridgeOutputs;
  /** Stays whose deck anchorage has failed, in the order they failed. */
  readonly failed:number[]=[];
  readonly vehicle:{readonly body:NativeBodyHandle;readonly mass:number;readonly speed:number;readonly loop:boolean;x:number;laps:number}|null=null;
  private readonly world:SiBridgeWorld;
  private readonly views:ReturnType<FrameRuntime['couplingViews']>;
  private readonly towerAttachments:StructureAttachment[]=[];private readonly deckAttachments:(StructureAttachment|null)[]=[];
  private readonly pins:StructureAttachment[]=[];
  private readonly failure:{stay:number;time:number}|null;
  private readonly fixedElements:number[];
  private readonly scratch:Float64Array;
  private pinnedElement=-1;private readonly carried=new Float64Array(8);
  private disposed=false;

  constructor(world:SiBridgeWorld,layout:SiBridgeLayout,options:SiBridgeOptions={}) {
    const hz=options.hz??120,subSteps=options.subSteps??4,damping=options.damping??.1,stayDamping=options.stayDamping??.1;
    if(!(Number.isFinite(hz)&&hz>=30&&hz<=1000))throw new RangeError('hz must be between 30 and 1000.');
    whole(subSteps,'subSteps',1,16);
    if(!(damping>=0&&damping<=1000)||!(stayDamping>=0&&stayDamping<=1000))throw new RangeError('damping rates must be between 0 and 1000 per second.');
    const g=world.gravity();
    if(!(g[0]===0&&g[2]===0&&g[1]<0))throw new RangeError('The bridge needs a world with gravity straight down.');
    // The world keeps gravity in float32; the structure uses the same value so that both fall alike.
    this.world=world;this.layout=layout;this.dt=1/hz;this.subSteps=subSteps;this.gravity=-g[1];
    const statics=this.statics=new SiBridgeStatics(layout,{gravity:this.gravity,windLoad:options.windLoad??0});
    const vehicle=options.vehicle??null;let body:NativeBodyHandle|null=null,mass=0;
    if(vehicle){
      positive(vehicle.mass,'vehicle.mass');
      if(!(Number.isFinite(vehicle.speed)&&vehicle.speed>=0))throw new RangeError('vehicle.speed must be zero or more.');
      const h=SI_BRIDGE_VEHICLE_HALF_EXTENTS,start=vehicle.start??0;statics.locate(start);
      body=world.createBody({shape:{kind:'box',halfExtents:h},type:'dynamic',position:[start,0,0],density:vehicle.mass/(8*h[0]*h[1]*h[2]),neverSleeps:true,color:0x30363c,filter:SI_BRIDGE_NO_COLLISION});
      if(!body)throw new Error('The rigid world has no room for the vehicle body.');
      mass=world.bodyState(body).mass;
      this.vehicle={body,mass,speed:vehicle.speed,loop:vehicle.loop===true,x:start,laps:0};
    }
    const load:SiBridgeStaticLoad=this.vehicle?{vehicle:{x:this.vehicle.x,weight:mass*this.gravity}}:{};
    this.initial=statics.solve(load);
    const startState=options.releaseLoad?statics.solve({...load,nodal:options.releaseLoad},this.initial.displacements):this.initial;
    const undeformed=options.start==='undeformed',u0=undeformed?new Float64Array(statics.size):startState.displacements;
    const config={dt:this.dt,substeps:1,maxIterations:1024,drag:damping,gravity:[0,-this.gravity,0] as [number,number,number],forceTolerance:FRAME_TOLERANCE,momentTolerance:FRAME_TOLERANCE,impulseTolerance:1e-10,angularImpulseTolerance:1e-10};
    this.frame=new FrameRuntime({config,positions:layout.positions,elements:layout.elements,fixed:layout.fixed,displacements:u0,forces:this.windForces()});
    this.views=this.frame.couplingViews();
    const adapter:StructureWorld<NativeBodyHandle>={
      gravity:()=>world.gravity(),getState:b=>world.bodyState(b),
      applyForce:(b,f,point)=>world.applyToBody(b,'force',f,point),applyTorque:(b,t)=>world.applyToBody(b,'torque',t),
      applyImpulse:(b,j)=>world.applyToBody(b,'impulse',j),applyAngularImpulse:(b,j)=>world.applyToBody(b,'angular-impulse',j),
      isAlive:b=>world.bodyIndex(b)!==null,subSteps,
    };
    this.coupling=new StructureCoupling(adapter,{dt:this.dt});
    this.coupling.addFrame(this.frame);
    const EA=layout.stay.youngModulus*layout.stay.area,p=layout.positions;
    layout.stays.forEach((s,i)=>{
      const L0=statics.restLengths[i],half=statics.stayMass(i)/2,positions:number[]=[];
      for(const node of [s.towerNode,s.deckNode])for(let k=0;k<3;k++)positions.push(p[3*node+k]+u0[6*node+k]);
      const cable=new CompliantCableRuntime({config:{dt:this.dt,substeps:1,maxIterations:2048,residualTolerance:1e-10,drag:stayDamping,gravity:[0,-this.gravity,0],solver:'proximal',forceTolerance:STAY_TOLERANCE},
        positions,masses:[half,half],pinned:[0,0],constraints:[{a:0,b:1,restLength:L0,compliance:L0/EA}]});
      this.cables.push(cable);
      const top=this.coupling.attachCableToFrame(cable,0,this.frame,s.towerNode),bottom=this.coupling.attachCableToFrame(cable,1,this.frame,s.deckNode);
      this.towerAttachments.push(top);this.deckAttachments.push(bottom);
      if(!undeformed){
        // The structure starts loaded: tell the coupling what each stay already pulls with.
        const T=statics.tension(i,u0),d=[positions[3]-positions[0],positions[4]-positions[1],positions[5]-positions[2]],l=Math.hypot(d[0],d[1],d[2]);
        this.coupling.prime(top,[T*d[0]/l,T*d[1]/l,T*d[2]/l]);this.coupling.prime(bottom,[-T*d[0]/l,-T*d[1]/l,-T*d[2]/l]);
      }
    });
    const failure=options.failure??null;
    if(failure){whole(failure.stay,'failure.stay',0,layout.stays.length-1);if(!(Number.isFinite(failure.time)&&failure.time>=0))throw new RangeError('failure.time must be zero or more.');}
    this.failure=failure?{stay:failure.stay,time:failure.time}:null;
    // Elements that touch a support: enough to form the elastic reactions.
    this.fixedElements=[];statics.elements.forEach((e,index)=>{if(Array.from(e.dofs).some(dof=>layout.fixed[dof]))this.fixedElements.push(index);});
    this.scratch=new Float64Array(statics.size);
    const deckCount=layout.deckNodes.length,stayCount=layout.stays.length;
    this.out={time:0,tick:0,deckDeflection:new Float64Array(deckCount),deckLateral:new Float64Array(deckCount),stayTension:new Float64Array(stayCount),stayUtilisation:new Float64Array(stayCount),
      reactions:new Float64Array(statics.size),towerBase:new Float64Array(6*layout.towers.length),totalReaction:[0,0,0],deckMoment:new Float64Array(deckCount),deckAxial:new Float64Array(deckCount-1),
      deckUtilisation:0,towerUtilisation:0,maxStayTension:0,maxStayUtilisation:0,midspanDeflection:0,vehicleX:NaN};
    if(this.vehicle){
      if(options.warm){
        // Attaching a node makes the coupling solve the frame's response at that node once and keep it.
        const inertia={kind:'box' as const,halfExtents:SI_BRIDGE_VEHICLE_HALF_EXTENTS};
        for(const node of layout.deckNodes)this.coupling.detach(this.coupling.attachFrameToBody(this.frame,node,this.vehicle.body,{mode:'pinned',inertia}));
      }
      this.restVehicle();this.placeVehicle();
      if(!undeformed){
        // At rest the pins share the weight by the lever rule.
        const xi=statics.locate(this.vehicle.x).xi,W=this.vehicle.mass*this.gravity;
        this.coupling.prime(this.pins[0],[0,W*(1-xi),0]);this.coupling.prime(this.pins[1],[0,W*xi,0]);
      }
    }
    this.measure();
  }

  /** Consistent nodal loads of the wind on the deck, six per node. */
  private windForces():Float64Array {
    const s=this.statics,out=new Float64Array(s.size);if(s.windLoad===0)return out;
    const acceleration=new Float64Array(12);
    s.elements.forEach((e,index)=>{
      if(this.layout.members[index]!=='deck')return;
      const a=s.windLoad/(e.definition.density*e.definition.area);for(let j=0;j<12;j++)acceleration[j]=j%6===2?a:0;
      for(let i=0;i<12;i++){let sum=0;for(let j=0;j<12;j++)sum+=e.massMatrix[12*i+j]*acceleration[j];out[e.dofs[i]]+=sum;}
    });
    return out;
  }
  /** Current position of a frame node. */
  private node(index:number,out:[number,number,number]):[number,number,number] {
    const {rest,displacements:u}=this.views;out[0]=rest[3*index]+u[6*index];out[1]=rest[3*index+1]+u[6*index+1];out[2]=rest[3*index+2]+u[6*index+2];return out;
  }
  /** Set the vehicle body on the chord of its deck element at its coordinate, turned to lie along the
   * chord, keep its velocities, and pin it to the element's two nodes where they are now. */
  private placeVehicle():void {
    const v=this.vehicle!,world=this.world,{index,xi}=this.statics.locate(v.x),nodes=this.layout.deckNodes;
    const a=this.node(nodes[index],[0,0,0]),b=this.node(nodes[index+1],[0,0,0]);
    // What each pin carried last step, to hand on to the pin that replaces it on the same node.
    const carried=this.carried;let known=0;
    for(const pin of this.pins){if(known<2&&this.pinnedElement>=0){carried[4*known]=nodes[this.pinnedElement+known];carried[4*known+1]=pin.force[0];carried[4*known+2]=pin.force[1];carried[4*known+3]=pin.force[2];known++;}this.coupling.detach(pin);}
    this.pins.length=0;
    // Body axes: x along the chord, z level and square to it, y completing them (no roll).
    let x0=b[0]-a[0],x1=b[1]-a[1],x2=b[2]-a[2];const length=Math.hypot(x0,x1,x2);x0/=length;x1/=length;x2/=length;
    let z0=-x2,z2=x0;const zl=Math.hypot(z0,z2);z0/=zl;z2/=zl;
    const y0=-z2*x1,y1=z2*x0-z0*x2,y2=z0*x1;
    // Rotation matrix columns x, y, z to a quaternion (the trace is close to 3: the deck is nearly level).
    const w=Math.sqrt(Math.max(0,1+x0+y1+z2))/2,q:[number,number,number,number]=[y2/(4*w),(z0-x2)/(4*w),(x1-y0)/(4*w),w];
    world.setBodyTransform(v.body,[a[0]+xi*(b[0]-a[0]),a[1]+xi*(b[1]-a[1]),a[2]+xi*(b[2]-a[2])],q);
    const inertia={kind:'box' as const,halfExtents:SI_BRIDGE_VEHICLE_HALF_EXTENTS};
    for(let end=0;end<2;end++){
      const node=nodes[index+end],pin=this.coupling.attachFrameToBody(this.frame,node,v.body,{mode:'pinned',inertia});this.pins.push(pin);
      for(let k=0;k<known;k++)if(carried[4*k]===node)this.coupling.prime(pin,[carried[4*k+1],carried[4*k+2],carried[4*k+3]]);
    }
    this.pinnedElement=index;
  }
  /** Give the vehicle body the velocity it has, at the moment the coupling reads it, when it rests on
   * the deck: g dt / (2 substeps) upwards. The coupling holds a body with half its impulse before the
   * rigid step and half after, and allows for the rigid solver's symplectic-Euler lead; a body that
   * starts with zero velocity instead starts with a jolt. */
  private restVehicle():void {this.world.setBodyVelocity(this.vehicle!.body,[0,this.gravity*this.dt/(2*this.subSteps),0],[0,0,0]);}
  /** The deck anchorage of a stay fails: the stay lets go of the deck and hangs from the tower. */
  failStay(index:number):boolean {
    whole(index,'stay',0,this.layout.stays.length-1);
    const attachment=this.deckAttachments[index];if(!attachment)return false;
    this.coupling.detach(attachment);this.deckAttachments[index]=null;this.failed.push(index);return true;
  }
  /** Everything that has to happen before the rigid world takes its step. */
  beforeWorldStep():void {
    if(this.disposed)throw new Error('This bridge has been disposed.');
    const time=this.out.tick*this.dt;
    // A hair of slack so that a failure time that is a whole number of steps acts on that step.
    if(this.failure&&time>=this.failure.time-1e-9*this.dt)this.failStay(this.failure.stay);
    const v=this.vehicle;
    if(v&&v.speed>0){
      const end=this.layout.length;
      if(v.x<end||v.loop){
        let x=v.x+v.speed*this.dt;
        if(x>=end){
          if(v.loop){x-=end;v.laps++;this.restVehicle();}else x=end;
        }
        v.x=x;this.placeVehicle();
      }
    }
    this.coupling.step();
  }
  /** Everything after it: the clock and the outputs. */
  afterWorldStep():void {this.out.tick++;this.out.time=this.out.tick*this.dt;this.measure();}
  /** One fixed step of the frame, the stays, the coupling and the rigid world. */
  step():void {this.beforeWorldStep();this.world.step(this.dt,this.subSteps);this.afterWorldStep();}

  /** Current position of both ends of stay i: tower end then deck end (the free end for a failed stay). */
  stayEnds(i:number,out:Float64Array,offset=0):void {
    const s=this.layout.stays[i],a=this.node(s.towerNode,[0,0,0]);
    out[offset]=a[0];out[offset+1]=a[1];out[offset+2]=a[2];
    if(this.deckAttachments[i]){const b=this.node(s.deckNode,[0,0,0]);out[offset+3]=b[0];out[offset+4]=b[1];out[offset+5]=b[2];return;}
    // A failed stay hangs from the tower: draw its free end where the cable solver has it, relative to its own top.
    const c=this.cables[i].couplingViews().positions;
    for(let k=0;k<3;k++)out[offset+3+k]=a[k]+c[3+k]-c[k];
  }
  private measure():void {
    const out=this.out,layout=this.layout,statics=this.statics,u=this.views.displacements,EA=layout.stay.youngModulus*layout.stay.area;
    layout.deckNodes.forEach((node,j)=>{out.deckDeflection[j]=u[6*node+1];out.deckLateral[j]=u[6*node+2];});
    out.midspanDeflection=u[6*layout.midNode+1];
    out.maxStayTension=0;
    const ends=this.scratch;
    for(let i=0;i<layout.stays.length;i++){
      this.stayEnds(i,ends);
      const L0=statics.restLengths[i],stretch=Math.hypot(ends[3]-ends[0],ends[4]-ends[1],ends[5]-ends[2])-L0,T=stretch>0?EA*stretch/L0:0;
      out.stayTension[i]=T;out.stayUtilisation[i]=T/(layout.stay.area*layout.stay.breakingStress);if(T>out.maxStayTension)out.maxStayTension=T;
    }
    out.maxStayUtilisation=out.maxStayTension/(layout.stay.area*layout.stay.breakingStress);
    // Elastic reactions: K u minus the loads that act at the supports themselves.
    const r=out.reactions,fixed=layout.fixed;r.fill(0);
    for(const index of this.fixedElements){
      const e=statics.elements[index];
      for(let i=0;i<12;i++){const dof=e.dofs[i];if(!fixed[dof])continue;let sum=0;for(let j=0;j<12;j++)sum+=e.stiffness[12*i+j]*u[e.dofs[j]];r[dof]+=sum;}
    }
    for(let j=0;j<r.length;j++)if(fixed[j])r[j]-=statics.memberLoads[j];
    // A vehicle standing on a supported node loads the support directly (force on the node = minus the force on the body).
    if(this.vehicle&&this.pinnedElement>=0)for(let end=0;end<2;end++){
      const node=layout.deckNodes[this.pinnedElement+end],pin=this.pins[end];
      for(let k=0;k<3;k++)if(fixed[6*node+k])r[6*node+k]+=pin.force[k];
    }
    out.totalReaction[0]=out.totalReaction[1]=out.totalReaction[2]=0;
    for(let j=0;j<r.length;j+=6)for(let k=0;k<3;k++)out.totalReaction[k]+=r[j+k];
    layout.towers.forEach((t,index)=>{for(let k=0;k<6;k++)out.towerBase[6*index+k]=r[6*t.nodes[0]+k];});
    out.deckUtilisation=statics.deckActions(u,out.deckMoment,out.deckAxial)/layout.deck.yieldStress;
    out.towerUtilisation=statics.towerStress(u)/layout.tower.yieldStress;
    out.vehicleX=this.vehicle?this.vehicle.x:NaN;
  }
  /** Total energy of the frame, the stays and the vehicle, J: kinetic + elastic + gravitational, from
   * the coupling's ledger, except that the elastic energy of the stays is taken from their stretch
   * between the frame nodes they hold (T^2 L0 / (2 E A) with the tensions in `out`). The cable solver's
   * own figure is formed at the node positions it predicted for the end of the step, which differ from
   * where the frame went by a step's worth of velocity change: with megajoule-stiff stays that is
   * hundreds of joules of bookkeeping noise while the structure moves. Call it after a step. Allocates. */
  energy():number {
    const d=this.coupling.diagnostics(),EA=this.layout.stay.youngModulus*this.layout.stay.area,T=this.out.stayTension,L0=this.statics.restLengths;
    let elastic=0;for(let i=0;i<T.length;i++)elastic+=T[i]*T[i]*L0[i]/(2*EA);
    return d.total-d.cableElastic+elastic;
  }
  /** Weight of everything the supports carry, N. */
  totalWeight():number {return (this.statics.structureMass()+(this.vehicle?this.vehicle.mass:0))*this.gravity;}
  /** Every number that defines the state, for bit-for-bit comparisons of two runs. */
  stateBytes():Uint8Array {
    const parts:Float64Array[]=[Float64Array.from(this.views.displacements),Float64Array.from(this.views.velocities)];
    for(const cable of this.cables){const c=cable.couplingViews();parts.push(Float64Array.from(c.positions),Float64Array.from(c.velocities));}
    if(this.vehicle){const s=this.world.bodyState(this.vehicle.body);parts.push(Float64Array.from([...s.position,...s.rotation,...s.linearVelocity,...s.angularVelocity,this.vehicle.x]));}
    parts.push(Float64Array.from([this.out.tick,this.world.replayHash()]));
    const bytes=new Uint8Array(parts.reduce((sum,part)=>sum+part.byteLength,0));let offset=0;
    for(const part of parts){bytes.set(new Uint8Array(part.buffer,part.byteOffset,part.byteLength),offset);offset+=part.byteLength;}
    return bytes;
  }
  /** Release the solvers and remove the vehicle body. The world itself is the caller's. */
  dispose():void {
    if(this.disposed)return;this.disposed=true;
    if(this.vehicle&&this.world.bodyIndex(this.vehicle.body)!==null)this.world.destroyBody(this.vehicle.body);
    for(const cable of this.cables)cable.destroy();this.frame.destroy();
  }
}
