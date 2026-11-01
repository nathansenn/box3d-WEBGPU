/** Analytical closed working-tool queries. Lengths are metres; normals point
 * out of the tool. Coupling, shank and machine-frame solids are separate bodies.
 * This module does not change the authored Studio material or mass model.
 */
import {PRESS_TOOLS,type PressSettings,type PressToolId} from '../studio/press-settings.ts';

export type PressContactVector = [number,number,number];
type V = PressContactVector;
type P2 = readonly [number,number];
export const PRESS_METRES_PER_UNIT = .1;
export const PRESS_CONTACT_GEOMETRY = 'press-working-solids-analytic-v1';
export interface PressToolQuery {distance:number;closest:V;normal:V;part:number}
export const createPressToolQuery=():PressToolQuery=>({distance:Infinity,closest:[0,0,0],normal:[0,-1,0],part:0});
interface Section {distance:number;a:number;b:number;na:number;nb:number}
const section=():Section=>({distance:Infinity,a:0,b:0,na:0,nb:-1});
const clamp=(x:number,lo:number,hi:number)=>Math.max(lo,Math.min(hi,x));
const ROUND:readonly P2[]=[[0,0],[.86,0],[.86,.21],[.82,.26],[0,.26]];
const CONE:readonly P2[]=[[0,0],[.9,.855],[.9,.96],[0,.96]];
const RING:readonly P2[]=[[.51,0],[.95,0],[.95,.35],[.51,.35]];
const WEDGE:readonly P2[]=[[0,0],[.58,.638],[.58,.83],[-.58,.83],[-.58,.638]];
const CROSS:readonly P2[]=[[.27,1.25],[-.27,1.25],[-.27,.27],[-1.25,.27],[-1.25,-.27],[-.27,-.27],[-.27,-1.25],[.27,-1.25],[.27,-.27],[1.25,-.27],[1.25,.27],[.27,.27]];
const WIDE:readonly P2[]=[[-1.42,-1.12],[1.42,-1.12],[1.42,1.12],[-1.42,1.12]];
const SQUARE:readonly P2[]=[[-.8,-.8],[.8,-.8],[.8,.8],[-.8,.8]];
const HEX:readonly P2[]=Array.from({length:6},(_,i)=>[.92*Math.cos(i*Math.PI/3),.92*Math.sin(i*Math.PI/3)] as const);
const TIP_OFFSETS=[-.68,.68] as const;
const CROSS_PARTS:readonly (readonly P2[])[]=[
  [[-.27,-1.25],[.27,-1.25],[.27,1.25],[-.27,1.25]],
  [[-1.25,-.27],[1.25,-.27],[1.25,.27],[-1.25,.27]],
];
const EXTENTS:Record<PressToolId,readonly [number,number,number]>={round:[.86,.26,.86],wide:[1.42,.27,1.12],square:[.8,.32,.8],ball:[.88,.96,.88],cone:[.9,.96,.9],wedge:[.58,.83,1.65],bead:[.36,.72,1.55],ring:[.95,.35,.95],cross:[1.25,.34,1.25],'four-point':[.98,.38,.98],hex:[.92,.32,.46*Math.sqrt(3)],capsule:[.42,.32,1.07]};

function polygon(a:number,b:number,points:readonly P2[],out:Section,axisIsInterior=false):void {
  let inside=false,best=Infinity;
  for(let i=0;i<points.length;i++){
    const p=points[i],q=points[(i+1)%points.length],da=q[0]-p[0],db=q[1]-p[1];
    if((p[1]>b)!==(q[1]>b)&&a<p[0]+(b-p[1])*da/db)inside=!inside;
    // A lathe's axis segment closes its meridian area but is not a solid boundary.
    if(axisIsInterior&&p[0]===0&&q[0]===0)continue;
    const t=clamp(((a-p[0])*da+(b-p[1])*db)/(da*da+db*db),0,1);
    const qa=p[0]+t*da,qb=p[1]+t*db,d=Math.hypot(a-qa,b-qb);
    if(d<best){best=d;out.a=qa;out.b=qb;const length=Math.hypot(da,db);out.na=db/length;out.nb=-da/length;}
  }
  out.distance=inside?-best:best;
}

/** Lower hemisphere plus its short cylindrical rim and closed top cap. */
function dome(rho:number,y:number,r:number,out:Section):void {
  const top=r+.08,dy=y-r,length=Math.hypot(rho,dy);
  let qa=r,qb=r;
  if(dy<=0&&length>0){qa=r*rho/length;qb=r+r*dy/length;}
  let best=Math.hypot(rho-qa,y-qb);
  out.a=qa;out.b=qb;out.na=qa/r;out.nb=(qb-r)/r;
  const sideY=clamp(y,r,top),sideDistance=Math.hypot(rho-r,y-sideY);
  if(sideDistance<best){best=sideDistance;out.a=r;out.b=sideY;out.na=1;out.nb=0;}
  const topR=clamp(rho,0,r),topDistance=Math.hypot(rho-topR,y-top);
  if(topDistance<best){best=topDistance;out.a=topR;out.b=top;out.na=0;out.nb=1;}
  const inside=rho<=r&&y<=top&&y>=r-Math.sqrt(Math.max(0,r*r-rho*rho));
  out.distance=inside?-best:best;
}

function finish(out:PressToolQuery,x:number,y:number,z:number,qx:number,qy:number,qz:number,inside:boolean,nx:number,ny:number,nz:number,part=0):void {
  const dx=x-qx,dy=y-qy,dz=z-qz,d=Math.hypot(dx,dy,dz),sign=inside?-1:1;
  out.distance=sign*d;out.closest[0]=qx;out.closest[1]=qy;out.closest[2]=qz;out.part=part;
  if(d>0){out.normal[0]=sign*dx/d;out.normal[1]=sign*dy/d;out.normal[2]=sign*dz/d;}
  else{out.normal[0]=nx;out.normal[1]=ny;out.normal[2]=nz;}
}

function revolved(x:number,y:number,z:number,section:Section,out:PressToolQuery,ox=0,oz=0,part=0):void {
  const rho=Math.hypot(x-ox,z-oz),ux=rho>0?(x-ox)/rho:1,uz=rho>0?(z-oz)/rho:0;
  finish(out,x,y,z,ox+section.a*ux,section.b,oz+section.a*uz,section.distance<0,section.na*ux,section.nb,section.na*uz,part);
}

/** Exact distance to an extrusion, including its rim corners and end caps. */
function extruded(a:number,b:number,c:number,s:Section,lo:number,hi:number,out:PressToolQuery,vertical:boolean):void {
  const axial=Math.max(lo-c,c-hi),inside=s.distance<0&&axial<0;
  let qa=a,qb=b,qc=clamp(c,lo,hi),na=0,nb=0,nc=c<(lo+hi)/2?-1:1;
  if(s.distance>0||(inside&&s.distance>axial)||s.distance===0){qa=s.a;qb=s.b;na=s.na;nb=s.nb;nc=0;}
  else if(inside)qc=c<(lo+hi)/2?lo:hi;
  if(vertical)finish(out,a,c,b,qa,qc,qb,inside,na,nc,nb);
  else finish(out,a,b,c,qa,qb,qc,inside,na,nb,nc);
}

function finiteCoordinate(n:number):boolean {return Number.isFinite(n)&&Math.abs(n)<=10000;}
function planeAdvance(q:PressToolQuery,vx:number,vy:number,vz:number,scale:number,radius:number,tolerance:number):number {
  const closing=-(q.normal[0]*vx+q.normal[1]*vy+q.normal[2]*vz);
  return closing>0?Math.max(0,(q.distance*scale-radius-tolerance*.5)/closing):Infinity;
}
function validatePoint(p:readonly number[]):void {
  if(p.length!==3||!p.every(finiteCoordinate))throw new RangeError('Press query coordinates must be finite metres within ±10 km');
}
export interface PressToolSweep {
  status:'hit'|'miss'|'unresolved';time:number;lastSafeTime:number;queries:number;
  initialOverlap:boolean;contact:PressToolQuery|null;
}
export interface PressNormalCorrection {particleDelta:V;ramDelta:number;penetration:number;resolvable:boolean}
/** Linearized unilateral contact for a 3D particle and a ram guided along Y.
 * Inverse weights must use the same mass unit. The guide absorbs lateral tool
 * reaction; the ram denominator therefore contains normalY squared.
 */
export function pressNormalCorrection(query:PressToolQuery,radius:number,particleWeight:number,ramWeight:number):PressNormalCorrection {
  if(!Number.isFinite(query.distance)||query.normal.length!==3||!query.normal.every(Number.isFinite)||Math.abs(Math.hypot(...query.normal)-1)>1e-8||!Number.isFinite(radius)||radius<0||radius>1||![particleWeight,ramWeight].every(n=>Number.isFinite(n)&&n>=0))throw new RangeError('Invalid press contact correction');
  const penetration=Math.max(0,radius-query.distance),particleDelta:V=[0,0,0];
  if(penetration===0)return {particleDelta,ramDelta:0,penetration,resolvable:true};
  const norm=Math.hypot(...query.normal),ny=query.normal[1]/norm;
  if(particleWeight===0){
    const delta=ramWeight>0&&ny!==0?-penetration/ny:Infinity;
    return {particleDelta,ramDelta:Number.isFinite(delta)?delta:0,penetration,resolvable:Number.isFinite(delta)};
  }
  // Scale the effective normal weights, so a huge guided mass cannot erase a
  // particle's lateral mobility when the contact has normalY = 0.
  const ramNormal=ramWeight*ny,effective=ramNormal*ny,scale=Math.max(particleWeight,effective);
  const a=particleWeight/scale,b=effective/scale,denominator=a+b,node=penetration*(a/denominator);
  const ratio=ramNormal/scale/denominator;
  let ramDelta=-penetration*ratio;
  if(!Number.isFinite(ratio))ramDelta=-Math.sign(ny)*Math.exp(Math.log(penetration)+Math.log(ramWeight)+Math.log(Math.abs(ny))-Math.log(scale)-Math.log(denominator));
  if(!Number.isFinite(ramDelta))return {particleDelta,ramDelta:0,penetration,resolvable:false};
  for(let i=0;i<3;i++)particleDelta[i]=node*(query.normal[i]/norm);
  return {particleDelta,ramDelta:ramDelta===0?0:ramDelta,penetration,resolvable:true};
}

export class PressToolCollider {
  readonly tool:PressToolId;
  readonly scale:number;
  readonly angle:number;
  private readonly c:number;
  private readonly s:number;
  private readonly convex:boolean;
  private readonly crossSection=section();
  private readonly scratch=createPressToolQuery();
  constructor(settings:Pick<PressSettings,'tool'|'toolScale'|'angle'>){
    if(!PRESS_TOOLS.some(p=>p.id===settings.tool)||!Number.isFinite(settings.toolScale)||settings.toolScale<.65||settings.toolScale>1.3||!Number.isFinite(settings.angle)||settings.angle<0||settings.angle>90)throw new RangeError('Invalid press tool geometry');
    this.tool=settings.tool;this.scale=PRESS_METRES_PER_UNIT*settings.toolScale;this.angle=settings.angle;
    this.c=Math.cos(this.angle*Math.PI/180);this.s=Math.sin(this.angle*Math.PI/180);
    this.convex=!['ring','cross','four-point'].includes(this.tool);
  }
  bounds(ramY:number,radius=0):{min:V;max:V} {
    if(!finiteCoordinate(ramY)||!Number.isFinite(radius)||radius<0||radius>1)throw new RangeError('Invalid press query bounds');
    const [x,y,z]=EXTENTS[this.tool],hx=this.scale*(Math.abs(this.c)*x+Math.abs(this.s)*z)+radius,hz=this.scale*(Math.abs(this.s)*x+Math.abs(this.c)*z)+radius;
    return {min:[-hx,ramY-radius,-hz],max:[hx,ramY+y*this.scale+radius,hz]};
  }
  sample(point:readonly number[],ramY:number,out=createPressToolQuery()):PressToolQuery {
    validatePoint(point);if(!finiteCoordinate(ramY))throw new RangeError('Invalid ram position');
    const x=(point[0]*this.c-point[2]*this.s)/this.scale,y=(point[1]-ramY)/this.scale,z=(point[0]*this.s+point[2]*this.c)/this.scale;
    const s=this.crossSection;
    switch(this.tool){
      case 'round':case 'cone':case 'ring':
        polygon(Math.hypot(x,z),y,this.tool==='round'?ROUND:this.tool==='cone'?CONE:RING,s,this.tool!=='ring');revolved(x,y,z,s,out);break;
      case 'ball':dome(Math.hypot(x,z),y,.88,s);revolved(x,y,z,s,out);break;
      case 'wide':case 'square':case 'cross':case 'hex':
        polygon(x,z,this.tool==='wide'?WIDE:this.tool==='square'?SQUARE:this.tool==='hex'?HEX:CROSS,s);extruded(x,z,y,s,0,EXTENTS[this.tool][1],out,true);break;
      case 'capsule':{
        const center=clamp(z,-.65,.65),dz=z-center,length=Math.hypot(x,dz);
        s.distance=length-.42;s.na=length?x/length:1;s.nb=length?dz/length:0;
        s.a=.42*s.na;s.b=center+.42*s.nb;extruded(x,z,y,s,0,.32,out,true);break;
      }
      case 'wedge':polygon(x,y,WEDGE,s);extruded(x,y,z,s,-1.65,1.65,out,false);break;
      case 'bead':{
        const length=Math.hypot(x,y-.36);s.distance=length-.36;
        s.na=length?x/length:0;s.nb=length?(y-.36)/length:-1;s.a=.36*s.na;s.b=.36+.36*s.nb;
        extruded(x,y,z,s,-1.55,1.55,out,false);break;
      }
      case 'four-point':{
        let best=Infinity,part=0;
        for(const ox of TIP_OFFSETS)for(const oz of TIP_OFFSETS){
          dome(Math.hypot(x-ox,z-oz),y,.3,s);revolved(x,y,z,s,this.scratch,ox,oz,part++);
          if(this.scratch.distance<best){best=this.scratch.distance;out.distance=best;out.part=this.scratch.part;for(let i=0;i<3;i++){out.closest[i]=this.scratch.closest[i];out.normal[i]=this.scratch.normal[i];}}
        }break;
      }
    }
    const qx=out.closest[0],qz=out.closest[2],nx=out.normal[0],nz=out.normal[2];
    out.closest[0]=(qx*this.c+qz*this.s)*this.scale;out.closest[1]=ramY+out.closest[1]*this.scale;out.closest[2]=(-qx*this.s+qz*this.c)*this.scale;
    out.normal[0]=nx*this.c+nz*this.s;out.normal[2]=-nx*this.s+nz*this.c;out.distance*=this.scale;
    return out;
  }
  private supportingPlane(query:PressToolQuery,ramY:number,tolerance:number):boolean {
    if(this.convex)return true;
    // The annulus and its convex hull have the same support function. Its
    // circular outer wall gives a tighter plane than a rectangular bound.
    const [nx,ny,nz]=query.normal;
    const support=this.scale*(.95*Math.hypot(nx,nz)+.35*Math.max(0,ny));
    const surface=nx*query.closest[0]+ny*(query.closest[1]-ramY)+nz*query.closest[2];
    return support-surface<=tolerance*.25;
  }
  private compoundAdvance(point:V,ramY:number,dx:number,dy:number,dz:number,radius:number,tolerance:number):number {
    const x=(point[0]*this.c-point[2]*this.s)/this.scale,y=(point[1]-ramY)/this.scale,z=(point[0]*this.s+point[2]*this.c)/this.scale;
    const vx=dx*this.c-dz*this.s,vz=dx*this.s+dz*this.c;
    const q=this.scratch,s=this.crossSection;let advance=Infinity;
    // A swept sphere hits a union when it first hits any convex component.
    // Every component contributes its own safe separating-plane time; taking
    // the minimum cannot skip an earlier component. Internal box faces are
    // used only for this outside bound, never as a penetration normal.
    if(this.tool==='cross')for(const points of CROSS_PARTS){
      polygon(x,z,points,s);extruded(x,z,y,s,0,.34,q,true);
      advance=Math.min(advance,planeAdvance(q,vx,dy,vz,this.scale,radius,tolerance));
    }else for(const ox of TIP_OFFSETS)for(const oz of TIP_OFFSETS){
      dome(Math.hypot(x-ox,z-oz),y,.3,s);revolved(x,y,z,s,q,ox,oz);
      advance=Math.min(advance,planeAdvance(q,vx,dy,vz,this.scale,radius,tolerance));
    }
    return advance;
  }
  /** Conservative advancement of a sphere along relative linear motion. A
   * separating support plane cannot be crossed before gap / closingSpeed.
   * Otherwise the 1-Lipschitz distance bound uses gap / total travel.
   * Exhaustion is explicit. Rotation or scale changes require another query.
   */
  sweep(start:readonly number[],end:readonly number[],ramStart:number,ramEnd:number,radius=0,options:{tolerance?:number;maxQueries?:number}={}):PressToolSweep {
    validatePoint(start);validatePoint(end);
    const tolerance=options.tolerance??1e-9,maxQueries=options.maxQueries??128;
    if(!finiteCoordinate(ramStart)||!finiteCoordinate(ramEnd)||!Number.isFinite(radius)||radius<0||radius>1||!Number.isFinite(tolerance)||tolerance<1e-10||tolerance>1e-4||!Number.isInteger(maxQueries)||maxQueries<1||maxQueries>4096)throw new RangeError('Invalid press sweep');
    const dx=end[0]-start[0],dy=end[1]-start[1],dz=end[2]-start[2],dr=ramEnd-ramStart,travel=Math.hypot(dx,dy-dr,dz);
    const point:V=[...start] as V,contact=createPressToolQuery();let time=0,lastSafeTime=0;
    for(let queries=1;queries<=maxQueries;queries++){
      point[0]=start[0]+time*dx;point[1]=start[1]+time*dy;point[2]=start[2]+time*dz;
      this.sample(point,ramStart+time*dr,contact);const gap=contact.distance-radius;
      if(gap<=tolerance)return {status:'hit',time,lastSafeTime,queries,initialOverlap:time===0&&gap<0,contact};
      lastSafeTime=time;
      if(travel===0)return {status:'miss',time:1,lastSafeTime:1,queries,initialOverlap:false,contact:null};
      let advance:number;
      if(this.tool==='cross'||this.tool==='four-point')advance=this.compoundAdvance(point,ramStart+time*dr,dx,dy-dr,dz,radius,tolerance);
      else {
        let closingSpeed=travel;
        if(this.supportingPlane(contact,ramStart+time*dr,tolerance)){
          closingSpeed=-(contact.normal[0]*dx+contact.normal[1]*(dy-dr)+contact.normal[2]*dz);
          if(closingSpeed<=0)return {status:'miss',time:1,lastSafeTime:1,queries,initialOverlap:false,contact:null};
        }
        // Half the declared spatial tolerance protects the lower-distance step
        // against roundoff in the bounded coordinate domain.
        advance=(gap-tolerance*.5)/closingSpeed;
      }
      if(advance>1-time)return {status:'miss',time:1,lastSafeTime:1,queries,initialOverlap:false,contact:null};
      const next=Math.min(1,time+advance);
      if(next===time||queries===maxQueries)return {status:'unresolved',time,lastSafeTime,queries,initialOverlap:false,contact};
      time=next;
    }
    throw new Error('Unreachable press sweep state');
  }
}
