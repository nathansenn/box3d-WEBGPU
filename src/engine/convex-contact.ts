/** Small deterministic 3D convex-contact kernel used by the material studies.
 * Metres, seconds, kilograms. Normals point from A toward B. See GLASS_CONTACT.md.
 */
export type ContactVec3 = [number,number,number];
export type ContactQuat = [number,number,number,number];
type V = ContactVec3;
const add=(a:V,b:V):V=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]];
const sub=(a:V,b:V):V=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const mul=(a:V,s:number):V=>[a[0]*s,a[1]*s,a[2]*s];
const dot=(a:V,b:V)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:V,b:V):V=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const length=(a:V)=>Math.sqrt(a[0]*a[0]+a[1]*a[1]+a[2]*a[2]);
const unit=(a:V):V=>mul(a,1/(length(a)||1));
export const CONTACT_SKIN=1e-5;
export const CONTACT_SLOP=2e-5;
const SWEEP_TOLERANCE=1e-7;
export const CONVEX_CONTACT_BACKEND='convex-contact-sat-js-f64-v5';
const MAX_CCD_REFINEMENT=10,CONTACT_STATE_STRIDE=17;

function rotate(q:ContactQuat,v:V):V {
  const x=q[0],y=q[1],z=q[2],w=q[3],vx=v[0],vy=v[1],vz=v[2];
  const tx=(y*vz-z*vy)*2,ty=(z*vx-x*vz)*2,tz=(x*vy-y*vx)*2;
  // Keep the original arithmetic order, with only the owned result allocated.
  return [vx+(tx*w+(y*tz-z*ty)),vy+(ty*w+(z*tx-x*tz)),vz+(tz*w+(x*ty-y*tx))];
}
function inverseRotate(q:ContactQuat,v:V):V {return rotate([-q[0],-q[1],-q[2],q[3]],v);}
function advanceQuaternion(q:ContactQuat,w:V,dt:number):ContactQuat {
  if(dt===0)return [...q];const speed=length(w);if(speed<1e-15)return [...q];
  const angle=speed*dt/2,s=Math.sin(angle)/speed,x=w[0]*s,y=w[1]*s,z=w[2]*s,c=Math.cos(angle);
  const next:ContactQuat=[c*q[0]+x*q[3]+y*q[2]-z*q[1],c*q[1]-x*q[2]+y*q[3]+z*q[0],c*q[2]+x*q[1]-y*q[0]+z*q[3],c*q[3]-x*q[0]-y*q[1]-z*q[2]];
  const norm=Math.hypot(...next);return next.map(v=>v/norm) as ContactQuat;
}
export function contactEuler(q:ContactQuat):V {
  const x=rotate(q,[1,0,0]),y=rotate(q,[0,1,0]),z=rotate(q,[0,0,1]);
  const ry=Math.asin(Math.max(-1,Math.min(1,z[0])));
  return Math.abs(z[0])<.9999999?[Math.atan2(-z[1],z[2]),ry,Math.atan2(-y[0],x[0])]:[Math.atan2(y[2],y[1]),ry,0];
}

export interface ConvexShape {vertices:V[];faces:number[][];normals:V[];edges:V[];radius:number;inverseInertia:number[];}
function uniqueDirection(directions:V[],v:V):void {
  if(length(v)<1e-12)return;const n=unit(v);
  if(!directions.some(d=>Math.abs(dot(d,n))>1-1e-10))directions.push(n);
}
function shape(vertices:V[],inputFaces:number[][],inverseInertia:number[]):ConvexShape {
  const faces:number[][]=[],normals:V[]=[],edges:V[]=[];
  for(const input of inputFaces){
    const face=[...input];let n=unit(cross(sub(vertices[face[1]],vertices[face[0]]),sub(vertices[face[2]],vertices[face[0]])));
    if(dot(n,vertices[face[0]])<0){face.reverse();n=mul(n,-1);}
    faces.push(face);normals.push(n);
    for(let i=0;i<face.length;i++)uniqueDirection(edges,sub(vertices[face[(i+1)%face.length]],vertices[face[i]]));
  }
  return {vertices,faces,normals,edges,radius:Math.max(...vertices.map(length)),inverseInertia};
}
/** Input triangle must be centred on its area centroid in the local XY plane. */
export function triangularPrism(vertices:V[],thickness:number,mass:number):ConvexShape {
  if(vertices.length!==3||!vertices.flat().every(Number.isFinite)||!Number.isFinite(thickness)||thickness<=0||!Number.isFinite(mass)||mass<=0)throw new Error('Invalid triangular prism');
  if(length(mul(vertices.reduce(add,[0,0,0]),1/3))>1e-8||vertices.some(v=>Math.abs(v[2])>1e-10))throw new Error('Prism triangle must be centred in XY');
  if(length(cross(sub(vertices[1],vertices[0]),sub(vertices[2],vertices[0])))<1e-12)throw new Error('Degenerate prism');
  const xx=vertices.reduce((s,v)=>s+v[0]*v[0],0)/12,yy=vertices.reduce((s,v)=>s+v[1]*v[1],0)/12,xy=vertices.reduce((s,v)=>s+v[0]*v[1],0)/12,zz=thickness*thickness/12;
  const a=mass*(yy+zz),b=-mass*xy,d=mass*(xx+zz),det=a*d-b*b;
  return shape([...vertices.map(v=>[v[0],v[1],-thickness/2] as V),...vertices.map(v=>[v[0],v[1],thickness/2] as V)],[[0,2,1],[3,4,5],[0,1,4,3],[1,2,5,4],[2,0,3,5]],[d/det,-b/det,0,-b/det,a/det,0,0,0,1/(mass*(xx+yy))]);
}
export function contactBox(size:V,mass=1):ConvexShape {
  if(size.some(v=>!Number.isFinite(v)||v<=0)||!Number.isFinite(mass)||mass<=0)throw new Error('Invalid contact box');
  const [x,y,z]=size.map(v=>v/2),v:V[]=[[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]];
  return shape(v,[[0,3,2,1],[4,5,6,7],[0,1,5,4],[1,2,6,5],[2,3,7,6],[3,0,4,7]],[3/(mass*(y*y+z*z)),0,0,0,3/(mass*(x*x+z*z)),0,0,0,3/(mass*(x*x+y*y))]);
}
export interface ContactPose {position:V;rotation:ContactQuat;vertices:V[];normals:V[];edges:V[];min:V;max:V;}
export class ConvexBody {
  readonly shape:ConvexShape;readonly mass:number;
  position:V;rotation:ContactQuat=[0,0,0,1];velocity:V=[0,0,0];angularVelocity:V=[0,0,0];
  dynamic:boolean;collisionEnabled=true;friction=.5;restitution=.1;pose:ContactPose;private worldInverse:number[]=[];
  constructor(shape:ConvexShape,position:V,mass=1,dynamic=true){
    if(position.some(v=>!Number.isFinite(v))||!Number.isFinite(mass)||mass<=0)throw new Error('Invalid contact body');
    this.shape=shape;this.position=[...position];this.mass=mass;this.dynamic=dynamic;this.pose=this.at(0);this.sync();
  }
  at(dt:number):ContactPose {
    const position=add(this.position,mul(this.velocity,this.dynamic?dt:0)),rotation=advanceQuaternion(this.rotation,this.angularVelocity,this.dynamic?dt:0);
    const [x,y,z,w]=rotation,xx=2*x*x,yy=2*y*y,zz=2*z*z,xy=2*x*y,xz=2*x*z,yz=2*y*z,wx=2*w*x,wy=2*w*y,wz=2*w*z;
    const transform=(v:V):V=>[(1-yy-zz)*v[0]+(xy-wz)*v[1]+(xz+wy)*v[2],(xy+wz)*v[0]+(1-xx-zz)*v[1]+(yz-wx)*v[2],(xz-wy)*v[0]+(yz+wx)*v[1]+(1-xx-yy)*v[2]];
    const vertices=this.shape.vertices.map((v):V=>[position[0]+((1-yy-zz)*v[0]+(xy-wz)*v[1]+(xz+wy)*v[2]),position[1]+((xy+wz)*v[0]+(1-xx-zz)*v[1]+(yz-wx)*v[2]),position[2]+((xz-wy)*v[0]+(yz+wx)*v[1]+(1-xx-yy)*v[2])]),min:V=[Infinity,Infinity,Infinity],max:V=[-Infinity,-Infinity,-Infinity];
    for(const v of vertices)for(let a=0;a<3;a++){min[a]=Math.min(min[a],v[a]);max[a]=Math.max(max[a],v[a]);}
    return {position,rotation,vertices,normals:this.shape.normals.map(transform),edges:this.shape.edges.map(transform),min,max};
  }
  sync():void {
    this.pose=this.at(0);const q=this.rotation,m=this.shape.inverseInertia;
    const columns=([ [1,0,0],[0,1,0],[0,0,1] ] as V[]).map(v=>{const l=inverseRotate(q,v);return rotate(q,[m[0]*l[0]+m[1]*l[1]+m[2]*l[2],m[3]*l[0]+m[4]*l[1]+m[5]*l[2],m[6]*l[0]+m[7]*l[1]+m[8]*l[2]]);});
    this.worldInverse=[columns[0][0],columns[1][0],columns[2][0],columns[0][1],columns[1][1],columns[2][1],columns[0][2],columns[1][2],columns[2][2]];
  }
  advance(dt:number):void {if(this.dynamic){this.position=add(this.position,mul(this.velocity,dt));this.rotation=advanceQuaternion(this.rotation,this.angularVelocity,dt);this.sync();}}
  translate(delta:V):void {
    for(let a=0;a<3;a++){this.position[a]+=delta[a];this.pose.position[a]+=delta[a];this.pose.min[a]+=delta[a];this.pose.max[a]+=delta[a];}
    for(const p of this.pose.vertices)for(let a=0;a<3;a++)p[a]+=delta[a];
  }
  syncPosition():void {
    const delta=sub(this.position,this.pose.position);
    for(let a=0;a<3;a++){this.pose.position[a]=this.position[a];this.pose.min[a]+=delta[a];this.pose.max[a]+=delta[a];}
    for(const p of this.pose.vertices)for(let a=0;a<3;a++)p[a]+=delta[a];
  }
  inverseInertia(v:V):V {
    if(!this.dynamic)return [0,0,0];const m=this.worldInverse;
    return [m[0]*v[0]+m[1]*v[1]+m[2]*v[2],m[3]*v[0]+m[4]*v[1]+m[5]*v[2],m[6]*v[0]+m[7]*v[1]+m[8]*v[2]];
  }
  pointVelocity(r:V):V {const v=this.velocity,w=this.angularVelocity;return this.dynamic?[v[0]+w[1]*r[2]-w[2]*r[1],v[1]+w[2]*r[0]-w[0]*r[2],v[2]+w[0]*r[1]-w[1]*r[0]]:[0,0,0];}
  inverseMassAt(r:V,n:V,translationOnly=false):number {if(!this.dynamic)return 0;if(translationOnly)return 1/this.mass;const c=cross(r,n);return 1/this.mass+dot(c,this.inverseInertia(c));}
  impulse(r:V,j:V):void {if(this.dynamic){const angular=this.inverseInertia(cross(r,j));for(let a=0;a<3;a++){this.velocity[a]+=j[a]/this.mass;this.angularVelocity[a]+=angular[a];}}}
  correctPose(r:V,j:V,translationOnly=false):void {
    if(!this.dynamic)return;if(translationOnly){for(let k=0;k<3;k++)this.position[k]+=j[k]/this.mass;return;}const angular=this.inverseInertia(cross(r,j)),angle=length(angular),scale=angle>.15?.15/angle:1;
    for(let a=0;a<3;a++)this.position[a]+=j[a]/this.mass*scale;
    this.rotation=advanceQuaternion(this.rotation,angular,scale);
  }
}
export interface Separation {gap:number;normal:V;faceA:number;faceB:number;}
/** Exact separating-axis test for convex polyhedra, including edge/edge axes. */
export function convexSeparation(a:ContactPose,b:ContactPose,earlyExit=Infinity):Separation {
  let bestGap=-Infinity,bestX=1,bestY=0,bestZ=0,bestFaceA=-1,bestFaceB=-1,normalReference:V|undefined;
  // Keep the axis arithmetic and tie order unchanged. Only the winning result
  // needs an owned normal; forward face normals retain their original alias.
  const axis=(nx:number,ny:number,nz:number,fa:number,fb:number,source?:V)=>{
    let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
    for(const v of a.vertices){const p=v[0]*nx+v[1]*ny+v[2]*nz;amin=Math.min(amin,p);amax=Math.max(amax,p);}
    for(const v of b.vertices){const p=v[0]*nx+v[1]*ny+v[2]*nz;bmin=Math.min(bmin,p);bmax=Math.max(bmax,p);}
    const forward=bmin-amax,backward=amin-bmax,gap=Math.max(forward,backward);
    if(gap>bestGap+1e-10){
      bestGap=gap;bestFaceA=fa;bestFaceB=fb;
      if(forward>=backward){normalReference=source;bestX=nx;bestY=ny;bestZ=nz;}
      else{normalReference=undefined;bestX=nx*-1;bestY=ny*-1;bestZ=nz*-1;}
    }
  };
  for(let i=0;i<a.normals.length;i++){
    const n=a.normals[i];axis(n[0],n[1],n[2],i,-1,n);
    if(bestGap>earlyExit)return {gap:bestGap,normal:normalReference??[bestX,bestY,bestZ],faceA:bestFaceA,faceB:bestFaceB};
  }
  for(let i=0;i<b.normals.length;i++){
    const n=b.normals[i];axis(n[0],n[1],n[2],-1,i,n);
    if(bestGap>earlyExit)return {gap:bestGap,normal:normalReference??[bestX,bestY,bestZ],faceA:bestFaceA,faceB:bestFaceB};
  }
  for(const ea of a.edges)for(const eb of b.edges){
    const x=ea[1]*eb[2]-ea[2]*eb[1],y=ea[2]*eb[0]-ea[0]*eb[2],z=ea[0]*eb[1]-ea[1]*eb[0],l=Math.sqrt(x*x+y*y+z*z);
    if(l>1e-8){const inverse=1/l;axis(x*inverse,y*inverse,z*inverse,-1,-1);if(bestGap>earlyExit)return {gap:bestGap,normal:normalReference??[bestX,bestY,bestZ],faceA:bestFaceA,faceB:bestFaceB};}
  }
  return {gap:bestGap,normal:normalReference??[bestX,bestY,bestZ],faceA:bestFaceA,faceB:bestFaceB};
}
function clip(polygon:V[],n:V,offset:number):V[] {
  const out:V[]=[];if(!polygon.length)return out;
  let a=polygon.at(-1)!,da=dot(n,a)-offset;
  for(const b of polygon){const db=dot(n,b)-offset;if((da>0)!==(db>0))out.push(add(a,mul(sub(b,a),da/(da-db))));if(db<=1e-9)out.push(b);a=b;da=db;}return out;
}
export interface ContactPoint {a:V;b:V;gap:number;}
const distanceSquared=(a:V,b:V)=>{const x=a[0]-b[0],y=a[1]-b[1],z=a[2]-b[2];return x*x+y*y+z*z;};
function sameContact(a:ContactPoint,b:ContactPoint):boolean {return distanceSquared(a.a,b.a)<=1e-20&&distanceSquared(a.b,b.b)<=1e-20;}
function uniqueContacts(points:ContactPoint[]):ContactPoint[] {
  const out:ContactPoint[]=[];for(const point of points)if(!out.some(p=>sameContact(p,point)))out.push(point);return out;
}
/** Face clipping keeps a stable supporting polygon rather than a centre proxy. */
export function convexManifold(a:ConvexBody,b:ConvexBody,pa=a.pose,pb=b.pose,separation=convexSeparation(pa,pb),proximity=CONTACT_SKIN*3):ContactPoint[] {
  const n=separation.normal;
  let fa=0,fb=0;for(let i=1;i<pa.normals.length;i++)if(dot(pa.normals[i],n)>dot(pa.normals[fa],n))fa=i;
  for(let i=1;i<pb.normals.length;i++)if(dot(pb.normals[i],n)<dot(pb.normals[fb],n))fb=i;
  const fromA=dot(pa.normals[fa],n)>=-dot(pb.normals[fb],n),ref=fromA?pa:pb,inc=fromA?pb:pa,rs=fromA?a.shape:b.shape,is=fromA?b.shape:a.shape,rf=fromA?fa:fb,inf=fromA?fb:fa,rn=ref.normals[rf];
  const boundary=rs.faces[rf].map(i=>ref.vertices[i]);let polygon=is.faces[inf].map(i=>inc.vertices[i]);
  for(let i=0;i<boundary.length;i++){const x=boundary[i],y=boundary[(i+1)%boundary.length],out=unit(cross(sub(y,x),rn));polygon=clip(polygon,out,dot(out,x));}
  const points:ContactPoint[]=[];
  for(const p of polygon){const distance=dot(rn,sub(p,boundary[0]));if(distance<=proximity&&Math.max(dot(pa.normals[fa],n),-dot(pb.normals[fb],n))>.995){const q=sub(p,mul(rn,distance)),point=fromA?{a:q,b:p,gap:dot(n,sub(p,q))}:{a:p,b:q,gap:dot(n,sub(q,p))};if(!points.some(existing=>sameContact(existing,point)))points.push(point);}}
  if(points.length){
    // Keep extreme points in two tangent directions; redundant interior points add work.
    if(points.length<=4)return points;
    const t=unit(cross(n,Math.abs(n[0])<.8?[1,0,0]:[0,1,0])),u=cross(n,t),keep=new Set<number>();
    for(const d of [t,mul(t,-1),u,mul(u,-1)]){let k=0;for(let i=1;i<points.length;i++)if(dot(points[i].a,d)>dot(points[k].a,d))k=i;keep.add(k);}
    return [...keep].map(i=>points[i]);
  }
  // Edge/edge contact: closest points of the supporting features.
  const max=Math.max(...pa.vertices.map(v=>dot(v,n))),min=Math.min(...pb.vertices.map(v=>dot(v,n)));
  const av=pa.vertices.filter(v=>max-dot(v,n)<1e-7),bv=pb.vertices.filter(v=>dot(v,n)-min<1e-7);
  const [x,y]=closestSegments(av[0],av[1]??av[0],bv[0],bv[1]??bv[0]);return [{a:x,b:y,gap:dot(n,sub(y,x))}];
}
function closestSegments(a:V,b:V,c:V,d:V):[V,V] {
  const u=sub(b,a),v=sub(d,c),w=sub(a,c),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w),den=aa*cc-bb*bb;
  const clamp=(x:number)=>Math.max(0,Math.min(1,x));let s=aa>1e-20?clamp(den>1e-20?(bb*ee-cc*dd)/den:-dd/aa):0,t=cc>1e-20?clamp((bb*s+ee)/cc):0;
  if(aa>1e-20)s=clamp((bb*t-dd)/aa);if(cc>1e-20)t=clamp((bb*s+ee)/cc);return [add(a,mul(u,s)),add(c,mul(v,t))];
}
export interface ConvexSweep {time:number;separation:Separation;poseA:ContactPose;poseB:ContactPose;iterations:number;converged:boolean;}
interface SeparatingAxis {kind:number;i:number;j:number;}
/** Hints store shape-axis indices, never an old world-space normal. A hint may
 * reject only when an axis in the current SAT also rejects the complete swept
 * interval. Otherwise the original ordered search runs unchanged. */
function currentSeparatingAxis(a:ContactPose,b:ContactPose,hint:SeparatingAxis):V|undefined {
  if(hint.kind===0)return a.normals[hint.i];
  if(hint.kind===1)return b.normals[hint.i];
  if(hint.kind===2){
    const ea=a.edges[hint.i],eb=b.edges[hint.j];if(!ea||!eb)return undefined;
    const product=cross(ea,eb),l=length(product);if(l<=1e-8)return undefined;return mul(product,1/l);
  }
  return undefined;
}
function currentAxisGap(a:ContactPose,b:ContactPose,n:V):number {
  const nx=n[0],ny=n[1],nz=n[2];let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
  for(const v of a.vertices){const d=v[0]*nx+v[1]*ny+v[2]*nz;amin=Math.min(amin,d);amax=Math.max(amax,d);}
  for(const v of b.vertices){const d=v[0]*nx+v[1]*ny+v[2]*nz;bmin=Math.min(bmin,d);bmax=Math.max(bmax,d);}
  return Math.max(bmin-amax,amin-bmax);
}
function separatingAxisMiss(a:ContactPose,b:ContactPose,endA:ContactPose,endB:ContactPose,padding:number,threshold:number,hint:SeparatingAxis):boolean {
  const n=currentSeparatingAxis(a,b,hint);
  if(!n)return false;
  // Scalar extrema preserve the original projection arithmetic without four
  // owned range tuples and a closure for each repeated miss query.
  const nx=n[0],ny=n[1],nz=n[2];let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
  for(const v of a.vertices){const d=v[0]*nx+v[1]*ny+v[2]*nz;amin=Math.min(amin,d);amax=Math.max(amax,d);}
  for(const v of b.vertices){const d=v[0]*nx+v[1]*ny+v[2]*nz;bmin=Math.min(bmin,d);bmax=Math.max(bmax,d);}
  const forward=bmin-amax,backward=amin-bmax;
  // SAT retains its preceding axis within 1e-10. Leave twice that margin so
  // this shortcut cannot bypass an initial proximity contact or a tie.
  if(!(Math.max(forward,backward)>threshold+2e-10))return false;
  const startForward=forward-padding-CONTACT_SKIN,startBackward=backward-padding-CONTACT_SKIN;
  if(!(startForward>0||startBackward>0))return false;
  let eamin=Infinity,eamax=-Infinity,ebmin=Infinity,ebmax=-Infinity;
  for(const v of endA.vertices){const d=v[0]*nx+v[1]*ny+v[2]*nz;eamin=Math.min(eamin,d);eamax=Math.max(eamax,d);}
  for(const v of endB.vertices){const d=v[0]*nx+v[1]*ny+v[2]*nz;ebmin=Math.min(ebmin,d);ebmax=Math.max(ebmax,d);}
  return (startForward>0&&ebmin-eamax-padding-CONTACT_SKIN>0)||(startBackward>0&&eamin-ebmax-padding-CONTACT_SKIN>0);
}
/** Intersect swept projection intervals. The chord error bound r*w²*h²/8
 * encloses every rotating vertex, including extrema between the endpoints.
 * Pure translation reduces to an exact swept SAT, without iterative advancement.
 */
function sweptInterval(a:ContactPose,b:ContactPose,endA:ContactPose,endB:ContactPose,padding:number,hint?:SeparatingAxis):[number,number]|null {
  let enter=0,exit=1;
  const range=(p:ContactPose,n:V):[number,number]=>{let min=Infinity,max=-Infinity;const nx=n[0],ny=n[1],nz=n[2];for(const v of p.vertices){const d=v[0]*nx+v[1]*ny+v[2]*nz;min=Math.min(min,d);max=Math.max(max,d);}return [min,max];};
  const restrict=(g0:number,g1:number)=>{
    const start=g0-padding-CONTACT_SKIN,end=g1-padding-CONTACT_SKIN;
    if(start>0&&end>0)return false;
    if(start>0)enter=Math.max(enter,start/(start-end));else if(end>0)exit=Math.min(exit,start/(start-end));return enter<=exit;
  };
  const axis=(n:V)=>{const x=range(a,n),y=range(b,n),ex=range(endA,n),ey=range(endB,n);return restrict(y[0]-x[1],ey[0]-ex[1])&&restrict(x[0]-y[1],ex[0]-ey[1]);};
  const rejected=(kind:number,i:number,j=0):null=>{if(hint){hint.kind=kind;hint.i=i;hint.j=j;}return null;};
  for(let i=0;i<a.normals.length;i++)if(!axis(a.normals[i]))return rejected(0,i);
  for(let i=0;i<b.normals.length;i++)if(!axis(b.normals[i]))return rejected(1,i);
  for(let i=0;i<a.edges.length;i++)for(let j=0;j<b.edges.length;j++){const n=cross(a.edges[i],b.edges[j]),l=length(n);if(l>1e-8&&!axis(mul(n,1/l)))return rejected(2,i,j);}
  return [enter,exit];
}
/** Conservative advancement uses a separating gap as a safe lower distance bound.
 * The angular bound includes every vertex; exhaustion is returned, never a miss.
 */
export function sweepConvex(a:ConvexBody,b:ConvexBody,dt:number,maxIterations=24,endA=a.at(dt),endB=b.at(dt),tolerance=SWEEP_TOLERANCE):ConvexSweep|null {
  return sweepConvexWithHint(a,b,dt,maxIterations,endA,endB,tolerance);
}
function sweepConvexWithHint(a:ConvexBody,b:ConvexBody,dt:number,maxIterations:number,endA:ContactPose,endB:ContactPose,tolerance:number,hint?:SeparatingAxis):ConvexSweep|null {
  const wa=a.dynamic?length(a.angularVelocity):0,wb=b.dynamic?length(b.angularVelocity):0,curvature=a.shape.radius*wa*wa+b.shape.radius*wb*wb;
  if(hint&&separatingAxisMiss(a.pose,b.pose,endA,endB,curvature*dt*dt/8,CONTACT_SKIN+tolerance,hint))return null;
  const queue:{lo:number;hi:number;pa:ContactPose;pb:ContactPose;ea:ContactPose;eb:ContactPose}[]=[{lo:0,hi:dt,pa:a.pose,pb:b.pose,ea:endA,eb:endB}];let visits=0;
  while(queue.length){
    const q=queue.pop()!,s=convexSeparation(q.pa,q.pb,CONTACT_SKIN+tolerance);visits++;
    if(s.gap<=CONTACT_SKIN+tolerance)return {time:q.lo,separation:s,poseA:q.pa,poseB:q.pb,iterations:visits,converged:true};
    const span=q.hi-q.lo,interval=sweptInterval(q.pa,q.pb,q.ea,q.eb,curvature*span*span/8,hint);if(interval===null)continue;
    if(visits>=maxIterations||span<1e-10)return {time:q.lo,separation:s,poseA:q.pa,poseB:q.pb,iterations:visits,converged:false};
    const lo=q.lo+interval[0]*span,hi=q.lo+interval[1]*span;
    if(interval[0]>.05||interval[1]<.95){queue.push({lo,hi,pa:a.at(lo),pb:b.at(lo),ea:a.at(hi),eb:b.at(hi)});continue;}
    // Search the first half before the second; discarded intervals cannot hide a hit.
    const mid=(q.lo+q.hi)/2,ma=a.at(mid),mb=b.at(mid);
    queue.push({lo:mid,hi:q.hi,pa:ma,pb:mb,ea:q.ea,eb:q.eb});queue.push({lo:q.lo,hi:mid,pa:q.pa,pb:q.pb,ea:ma,eb:mb});
  }return null;
}
/** The solver needs conservative contacts, not a high-precision TOI for every
 * slowly rotating shard. A single swept interval bounds the angular chord error;
 * larger rotations retain the full interval search. The final geometric check
 * below independently rejects and subdivides trials with excessive penetration.
 */
function predictContact(a:ConvexBody,b:ConvexBody,dt:number,endA:ContactPose,endB:ContactPose,hint?:SeparatingAxis):ConvexSweep|null {
  const curvature=(a.dynamic?a.shape.radius*dot(a.angularVelocity,a.angularVelocity):0)+(b.dynamic?b.shape.radius*dot(b.angularVelocity,b.angularVelocity):0),padding=curvature*dt*dt/8;
  // The large-rotation path computes curvature using length(w)^2. Retain that
  // exact arithmetic and its own tolerance when checking a full sweep hint.
  if(hint&&padding<=1e-4&&separatingAxisMiss(a.pose,b.pose,endA,endB,padding,CONTACT_SKIN*3,hint))return null;
  const s=convexSeparation(a.pose,b.pose,CONTACT_SKIN*3);
  if(s.gap<=CONTACT_SKIN*3)return {time:0,separation:s,poseA:a.pose,poseB:b.pose,iterations:1,converged:true};
  if(padding>1e-4)return sweepConvexWithHint(a,b,dt,48,endA,endB,CONTACT_SKIN*.2,hint);
  const interval=sweptInterval(a.pose,b.pose,endA,endB,padding,hint);if(!interval)return null;
  const time=interval[0]*dt,pa=time?a.at(time):a.pose,pb=time?b.at(time):b.pose;
  return {time,separation:convexSeparation(pa,pb),poseA:pa,poseB:pb,iterations:1,converged:true};
}
export interface ContactStats {candidatePairs:number;narrowPhaseTests:number;contacts:number;sweptContacts:number;ccdIterations:number;ccdUnresolved:number;maxPenetration:number;refinements:number;}
export interface GeneratedContact {a:ConvexBody;b:ConvexBody;normal:V;points:ContactPoint[];poseA:ContactPose;poseB:ContactPose;time:number;iterations:number;converged:boolean;positionTarget?:number;}
export interface ContactImpact {a:ConvexBody;b:ConvexBody;speed:number;impulse:number;}
export class ContactResolutionError extends Error {
  readonly code='CCD_UNRESOLVED';
  readonly stage:'sweep'|'discovery'|'projection';
  readonly interval:number;
  readonly refinement:number;
  constructor(stage:'sweep'|'discovery'|'projection',interval:number,refinement:number){
    super(`Collision ${stage} could not be resolved at subdivision ${refinement}; the step was rolled back.`);
    this.name='ContactResolutionError';this.stage=stage;this.interval=interval;this.refinement=refinement;
  }
}
interface Constraint {key:string;a:ConvexBody;b:ConvexBody;ra:V;rb:V;localA:V;localB:V;normalBody:ConvexBody|null;localNormal:V;n:V;t:V;u:V;normalMass:number;frictionMass:number;target:number;normalImpulse:number;tangentImpulse:number;bitangentImpulse:number;friction:number;incomingNormalSpeed:number;positionTarget:number;}
interface CachedImpulse {localA:V;localB:V;dynamicA:boolean;dynamicB:boolean;normal:V;impulse:V;normalImpulse:number;}
interface ProjectionPlane {ai:number;bi:number;n:V;target:number;wa:number;wb:number;}
interface ContactRollback {
  bodies:ConvexBody[];values:Float64Array;previous:Map<string,CachedImpulse[]>|undefined;previousDt:number;
  stats:ContactStats;impacts:ContactImpact[];
  externalForces:ConvexContactWorld['externalForces'];contactProvider:ConvexContactWorld['contactProvider'];
}
export class ConvexContactWorld {
  externalForces?:(dt:number,phase:'prediction'|'substep',refinement:number)=>void;
  readonly bodies:ConvexBody[]=[];
  private bodyIndexCache:Map<ConvexBody,number>|null=null;
  /** Index of the first matching body (same result as bodies.indexOf) without a linear scan per generated contact. */
  private bodyIndexOf(body:ConvexBody):number{
    const cached=this.bodyIndexCache?.get(body);
    // A hit must still point at this body; a miss or stale hit rebuilds once (bodies is a public mutable array).
    if(cached!==undefined&&this.bodies[cached]===body)return cached;
    const map=new Map<ConvexBody,number>();
    for(let i=0;i<this.bodies.length;i++){const b=this.bodies[i]!;if(!map.has(b))map.set(b,i);}
    this.bodyIndexCache=map;
    return map.get(body)??-1;
  }
  contactProvider?: (dt:number)=>GeneratedContact[];
  impacts:ContactImpact[]=[];
  private previous=new Map<string,CachedImpulse[]>();private previousDt=0;
  private separatingAxes=new Map<number,SeparatingAxis>();private separatingAxisCount=0;
  private candidateBounds=new Float64Array(0);private candidateOrder:number[]=[];
  private projectionPositions=new Float64Array(0);private projectionCoefficients=new Float64Array(0);private projectionIndices=new Uint32Array(0);
  private rollbackFrames:ContactRollback[]=[];private rollbackDepth=0;
  stats:ContactStats={candidatePairs:0,narrowPhaseTests:0,contacts:0,sweptContacts:0,ccdIterations:0,ccdUnresolved:0,maxPenetration:0,refinements:0};
  add(body:ConvexBody):ConvexBody {this.bodies.push(body);return body;}
  /** Commit synchronous body changes and nested steps together, or restore the
   * accepted bodies, warm starts, callbacks and telemetry if the operation fails.
   * The caller owns any state outside this world, such as fracture history. */
  transaction<T>(operation:()=>T):T {return this.withRollback(()=>operation());}
  private withRollback<T>(operation:(saved:ContactRollback)=>T):T {
    let saved=this.rollbackFrames[this.rollbackDepth];
    if(!saved){
      saved={bodies:[],values:new Float64Array(0),previous:this.previous,previousDt:this.previousDt,stats:this.stats,impacts:this.impacts,externalForces:this.externalForces,contactProvider:this.contactProvider};
      this.rollbackFrames[this.rollbackDepth]=saved;
    }
    const count=this.bodies.length;
    if(saved.values.length<count*CONTACT_STATE_STRIDE)saved.values=new Float64Array(Math.max(count*CONTACT_STATE_STRIDE,saved.values.length*2));
    saved.bodies.length=count;
    for(let i=0;i<count;i++){
      const b=this.bodies[i],k=i*CONTACT_STATE_STRIDE,v=saved.values;saved.bodies[i]=b;
      for(let a=0;a<3;a++){v[k+a]=b.position[a];v[k+7+a]=b.velocity[a];v[k+10+a]=b.angularVelocity[a];}
      for(let a=0;a<4;a++)v[k+3+a]=b.rotation[a];
      v[k+13]=Number(b.dynamic);v[k+14]=Number(b.collisionEnabled);v[k+15]=b.friction;v[k+16]=b.restitution;
    }
    saved.previous=this.previous;saved.previousDt=this.previousDt;saved.stats=this.stats;saved.impacts=this.impacts;
    saved.externalForces=this.externalForces;saved.contactProvider=this.contactProvider;
    this.rollbackDepth++;
    try{return operation(saved);}
    catch(error){
      this.restoreRollback(saved);
      // Search hints are scratch, not an accepted contact certificate. Rebuild
      // them from restored geometry after an exception instead of retaining a trial.
      this.separatingAxes.clear();this.separatingAxisCount=0;
      throw error;
    }finally{
      this.rollbackDepth--;
      // Keep the reusable numeric storage, not a dense obsolete warm-start map.
      saved.previous=undefined;
    }
  }
  private restoreRollback(saved:ContactRollback):void {
    this.bodies.length=saved.bodies.length;
    for(let i=0;i<saved.bodies.length;i++){
      const b=saved.bodies[i],k=i*CONTACT_STATE_STRIDE,v=saved.values;this.bodies[i]=b;
      b.position=[v[k],v[k+1],v[k+2]];b.rotation=[v[k+3],v[k+4],v[k+5],v[k+6]];
      b.velocity=[v[k+7],v[k+8],v[k+9]];b.angularVelocity=[v[k+10],v[k+11],v[k+12]];
      b.dynamic=!!v[k+13];b.collisionEnabled=!!v[k+14];b.friction=v[k+15];b.restitution=v[k+16];b.sync();
    }
    this.previous=saved.previous!;this.previousDt=saved.previousDt;this.stats=saved.stats;this.impacts=saved.impacts;
    this.externalForces=saved.externalForces;this.contactProvider=saved.contactProvider;
  }
  candidates(dt=0,endPoses?:ContactPose[]):[number,number][] {
    const count=this.bodies.length;
    if(count>94_906_265)throw new RangeError('Contact body count exceeds the exact pair-key range');
    if(this.candidateBounds.length<count*6)this.candidateBounds=new Float64Array(Math.max(count*6,this.candidateBounds.length*2,96));
    const bounds=this.candidateBounds,order=this.candidateOrder;let enabled=0;
    for(let id=0;id<count;id++){
      const b=this.bodies[id];if(!b.collisionEnabled)continue;order[enabled++]=id;
      const end=endPoses?.[id]??(dt&&b.dynamic?b.at(dt):b.pose),angular=b.dynamic?b.shape.radius*dot(b.angularVelocity,b.angularVelocity)*dt*dt/8:0,k=id*6;
      for(let axis=0;axis<3;axis++){bounds[k+axis]=Math.min(b.pose.min[axis],end.min[axis])-angular-CONTACT_SKIN;bounds[k+3+axis]=Math.max(b.pose.max[axis],end.max[axis])+angular+CONTACT_SKIN;}
    }
    order.length=enabled;order.sort((a,b)=>bounds[a*6]-bounds[b*6]||a-b);
    // Sort packed integer keys, then allocate only the returned owned pairs.
    // This preserves the original body-id ordering used by the contact solver.
    const keys:number[]=[];
    for(let i=0;i<enabled;i++){
      const ai=order[i],a=ai*6;
      for(let j=i+1;j<enabled&&bounds[order[j]*6]<=bounds[a+3];j++){
        const bi=order[j],b=bi*6;if(!this.bodies[ai].dynamic&&!this.bodies[bi].dynamic)continue;
        if(bounds[a+1]>bounds[b+4]||bounds[a+4]<bounds[b+1]||bounds[a+2]>bounds[b+5]||bounds[a+5]<bounds[b+2])continue;
        keys.push(ai<bi?ai*count+bi:bi*count+ai);
      }
    }
    keys.sort((a,b)=>a-b);return keys.map(key=>[Math.floor(key/count),key%count]);
  }
  step(dt:number,iterations=4):void {
    if(!Number.isFinite(dt)||dt<=0||dt>1/30)throw new Error('Contact step must be in (0, 1/30]');
    if(!Number.isInteger(iterations)||iterations<1||iterations>64)throw new Error('Contact iterations must be an integer in [1, 64]');
    this.stepInterval(dt,iterations,0);
  }
  private queryPair(ai:number,bi:number,dt:number,endA:ContactPose,endB:ContactPose,continuous:boolean):ConvexSweep|null {
    const count=this.bodies.length;
    if(count!==this.separatingAxisCount){this.separatingAxes.clear();this.separatingAxisCount=count;}
    const key=ai*count+bi,hint=this.separatingAxes.get(key)??{kind:-1,i:0,j:0},a=this.bodies[ai],b=this.bodies[bi];
    const hit=continuous?sweepConvexWithHint(a,b,dt,48,endA,endB,CONTACT_SKIN*.2,hint):predictContact(a,b,dt,endA,endB,hint);
    if(hint.kind>=0&&!this.separatingAxes.has(key)){
      const limit=Math.min(16384,Math.max(256,count*16));
      if(this.separatingAxes.size>=limit)this.separatingAxes.delete(this.separatingAxes.keys().next().value!);
      this.separatingAxes.set(key,hint);
    }
    return hit;
  }
  private separatedByHint(ai:number,bi:number,threshold:number):boolean {
    const count=this.bodies.length;if(count!==this.separatingAxisCount)return false;
    const hint=this.separatingAxes.get(ai*count+bi);if(!hint)return false;
    const a=this.bodies[ai].pose,b=this.bodies[bi].pose,n=currentSeparatingAxis(a,b,hint);
    return !!n&&currentAxisGap(a,b,n)>threshold+2e-10;
  }
  private stepInterval(dt:number,iterations:number,refinement:number):void {
    this.withRollback(initial=>{
    const retry=()=>{
      // Restore the complete trial, including warm-start state. An unresolved
      // rotating query must be rebuilt on smaller intervals, never accepted as
      // a missed collision or hidden by a small endpoint penetration residual.
      this.restoreRollback(initial);
      this.stepInterval(dt/2,iterations,refinement+1);const first=this.stats,firstImpacts=this.impacts;
      this.stepInterval(dt/2,iterations,refinement+1);const last=this.stats;
      this.impacts=[...firstImpacts,...this.impacts];
      this.stats={...last,candidatePairs:first.candidatePairs+last.candidatePairs,narrowPhaseTests:first.narrowPhaseTests+last.narrowPhaseTests,sweptContacts:first.sweptContacts+last.sweptContacts,ccdIterations:first.ccdIterations+last.ccdIterations,ccdUnresolved:first.ccdUnresolved+last.ccdUnresolved,maxPenetration:Math.max(first.maxPenetration,last.maxPenetration),refinements:1+first.refinements+last.refinements};
    };
    this.externalForces?.(dt,'prediction',refinement);
    const stats:ContactStats={candidatePairs:0,narrowPhaseTests:0,contacts:0,sweptContacts:0,ccdIterations:0,ccdUnresolved:0,maxPenetration:0,refinements:0},constraints:Constraint[]=[],usedCache=new Set<CachedImpulse>();
    const ends=this.bodies.map(b=>b.dynamic?b.at(dt):b.pose),pairs=this.candidates(dt,ends);stats.candidatePairs=pairs.length;
    const pending:{ai:number;bi:number;hit?:ConvexSweep;points?:ContactPoint[];positionTarget?:number}[]=pairs.map(([ai,bi])=>({ai,bi}));
    for(const c of this.contactProvider?.(dt)??[]){
      const ai=this.bodyIndexOf(c.a),bi=this.bodyIndexOf(c.b);if(ai<0||bi<0||ai===bi)throw new Error('Generated contact must reference two world bodies');
      pending.push({ai,bi,points:c.points,positionTarget:c.positionTarget,hit:{time:c.time,poseA:c.poseA,poseB:c.poseB,iterations:c.iterations,converged:c.converged,separation:{gap:Math.min(...c.points.map(p=>p.gap)),normal:c.normal,faceA:-1,faceB:-1}}});
    }
    stats.candidatePairs=pending.length;
    // Body count is fixed throughout a trial. candidates() has checked the
    // exact integer-key range; public warm-start keys retain their string form.
    const pairStride=this.bodies.length,knownPairs=this.externalForces?new Set<number>():null;
    const appendContact=(entry:typeof pending[number],interval:number,cache:boolean):boolean=>{
      const {ai,bi}=entry;
      const a=this.bodies[ai],b=this.bodies[bi];stats.narrowPhaseTests++;
      const hit=entry.hit??this.queryPair(ai,bi,interval,ends[ai],ends[bi],false);if(!hit)return true;stats.ccdIterations+=hit.iterations;if(!hit.converged)stats.ccdUnresolved++;
      if(!hit.converged){
        if(refinement<MAX_CCD_REFINEMENT){retry();return false;}
        throw new ContactResolutionError('sweep',interval,refinement);
      }
      const {separation:s,poseA:pa,poseB:pb}=hit;stats.maxPenetration=Math.max(stats.maxPenetration,-s.gap);
      if(hit.time>0||!hit.converged)stats.sweptContacts++;
      const proximity=CONTACT_SKIN*3+interval*(length(sub(a.velocity,b.velocity))+length(a.angularVelocity)*a.shape.radius+length(b.angularVelocity)*b.shape.radius);
      const key=ai+'/'+bi,prior=cache?this.previous.get(key):undefined;
      const points=entry.points?uniqueContacts(entry.points):convexManifold(a,b,pa,pb,s,proximity);
      for(const point of points){
        const ra=inverseRotate(pa.rotation,sub(point.a,pa.position)),rb=inverseRotate(pb.rotation,sub(point.b,pb.position));
        const armA=rotate(a.rotation,ra),armB=rotate(b.rotation,rb),n=s.normal,currentGap=dot(n,sub(add(b.position,armB),add(a.position,armA)));
        const vn=dot(sub(b.pointVelocity(armB),a.pointVelocity(armA)),n),inv=a.inverseMassAt(armA,n)+b.inverseMassAt(armB,n);if(inv<=0)continue;
        if(vn<-20)iterations=Math.max(iterations,32);
        const tangent=unit(cross(n,Math.abs(n[0])<.8?[1,0,0]:[0,1,0])),bitangent=cross(n,tangent);
        // Separated contacts spend their gap during this step. Bounce only at a real impact.
        const target=currentGap>CONTACT_SKIN*3?-currentGap/interval:vn<-.25?-Math.min(a.restitution,b.restitution)*vn:0;
        const normalBody=s.faceA>=0?a:s.faceB>=0?b:null;
        const c:Constraint={key,a,b,ra:armA,rb:armB,localA:ra,localB:rb,normalBody,localNormal:normalBody?inverseRotate(normalBody===a?pa.rotation:pb.rotation,n):n,n,t:tangent,u:bitangent,normalMass:1/inv,frictionMass:0,target,normalImpulse:0,tangentImpulse:0,bitangentImpulse:0,friction:currentGap>CONTACT_SKIN*3?0:Math.sqrt(a.friction*b.friction),incomingNormalSpeed:vn,positionTarget:entry.positionTarget??-CONTACT_SLOP};
        // Match local anchors without merging distinct sub-millimetre contacts.
        // A previous impulse may seed only one current constraint in this trial.
        let old:CachedImpulse|undefined,bestDistance=Infinity;
        if(currentGap<=CONTACT_SKIN*3&&prior)for(const cached of prior){
          if(cached.dynamicA!==a.dynamic||cached.dynamicB!==b.dynamic||usedCache.has(cached)||dot(cached.normal,n)<=.99)continue;
          const da=a.dynamic?distanceSquared(ra,cached.localA):0,db=b.dynamic?distanceSquared(rb,cached.localB):0;
          if(da<=1e-6&&db<=1e-6&&da+db<bestDistance){old=cached;bestDistance=da+db;}
        }
        if(old){usedCache.add(old);const scale=Math.min(2,dt/this.previousDt);c.normalImpulse=old.normalImpulse*scale;c.tangentImpulse=dot(old.impulse,tangent)*scale;c.bitangentImpulse=dot(old.impulse,bitangent)*scale;const bound=c.friction*c.normalImpulse,ratio=Math.min(1,bound/(Math.hypot(c.tangentImpulse,c.bitangentImpulse)||1));c.tangentImpulse*=ratio;c.bitangentImpulse*=ratio;}
        constraints.push(c);
      }
      knownPairs?.add(ai*pairStride+bi);return true;
    };
    for(const entry of pending)if(!appendContact(entry,dt,true))return;
    stats.contacts=constraints.length;
    const accumulated=new Map<Constraint,CachedImpulse>(),substeps=4,h=dt/substeps;
    if(this.externalForces)for(let i=0;i<this.bodies.length;i++)for(let k=0;k<3;k++){
      this.bodies[i].velocity[k]=initial.values[i*CONTACT_STATE_STRIDE+7+k];this.bodies[i].angularVelocity[k]=initial.values[i*CONTACT_STATE_STRIDE+10+k];
    }
    for(let substep=0;substep<substeps;substep++){
      this.externalForces?.(h,'substep',refinement);
      const prepare=(c:Constraint):void=>{
        const oldNormal=c.n,oldFriction=this.externalForces?add(mul(c.t,c.tangentImpulse),mul(c.u,c.bitangentImpulse)):null;
        c.ra=rotate(c.a.rotation,c.localA);c.rb=rotate(c.b.rotation,c.localB);
        if(c.normalBody)c.n=rotate(c.normalBody.rotation,c.localNormal);
        c.t=unit(cross(c.n,Math.abs(c.n[0])<.8?[1,0,0]:[0,1,0]));c.u=cross(c.n,c.t);
        const gap=dot(c.n,sub(add(c.b.position,c.rb),add(c.a.position,c.ra)));
        // Preserve the incoming impact speed across speculative braking. Using
        // the already-braked speed here makes rebound depend on the tick phase.
        c.target=gap>CONTACT_SKIN*3?-gap/h:c.incomingNormalSpeed<-.25?-Math.min(c.a.restitution,c.b.restitution)*c.incomingNormalSpeed:0;c.friction=gap>CONTACT_SKIN*3?0:Math.sqrt(c.a.friction*c.b.friction);
        c.normalMass=1/(c.a.inverseMassAt(c.ra,c.n)+c.b.inverseMassAt(c.rb,c.n)||Infinity);c.frictionMass=1/((c.a.inverseMassAt(c.ra,c.t)+c.b.inverseMassAt(c.rb,c.t))+(c.a.inverseMassAt(c.ra,c.u)+c.b.inverseMassAt(c.rb,c.u))||Infinity);
        if(this.externalForces){
          const support=gap<=CONTACT_SKIN*3&&dot(oldNormal,c.n)>.99,scale=substep?1:1/substeps;
          c.normalImpulse=support?c.normalImpulse*scale:0;
          c.tangentImpulse=support?dot(oldFriction!,c.t)*scale:0;c.bitangentImpulse=support?dot(oldFriction!,c.u)*scale:0;
          const ratio=Math.min(1,c.friction*c.normalImpulse/(Math.hypot(c.tangentImpulse,c.bitangentImpulse)||1));c.tangentImpulse*=ratio;c.bitangentImpulse*=ratio;
          if(c.normalImpulse)this.apply(c,add(mul(c.n,c.normalImpulse),add(mul(c.t,c.tangentImpulse),mul(c.u,c.bitangentImpulse))));
        }else if(substep)c.normalImpulse=c.tangentImpulse=c.bitangentImpulse=0;
        else if(c.normalImpulse)this.apply(c,add(mul(c.n,c.normalImpulse),add(mul(c.t,c.tangentImpulse),mul(c.u,c.bitangentImpulse))));
      };
      for(const c of constraints)prepare(c);
      const solve=():void=>{for(let it=0;it<iterations;it++){
      for(let ci=0;ci<constraints.length;ci++){
      const c=constraints[it%2?constraints.length-1-ci:ci],v=sub(c.b.pointVelocity(c.rb),c.a.pointVelocity(c.ra));
      const next=Math.max(0,c.normalImpulse+(c.target-dot(v,c.n))*c.normalMass),normalDelta=next-c.normalImpulse;c.normalImpulse=next;
      this.apply(c,mul(c.n,normalDelta));
      if(!c.friction)continue;
      // A scalar inverse trace preserves the Coulomb disk under tangent-basis
      // rotation. Separate diagonal steps converge to direction-dependent friction.
      const relative=sub(c.b.pointVelocity(c.rb),c.a.pointVelocity(c.ra)),t=c.tangentImpulse-dot(relative,c.t)*c.frictionMass,u=c.bitangentImpulse-dot(relative,c.u)*c.frictionMass,bound=c.friction*next,scale=Math.min(1,bound/(Math.hypot(t,u)||1));
      this.apply(c,add(mul(c.t,t*scale-c.tangentImpulse),mul(c.u,u*scale-c.bitangentImpulse)));c.tangentImpulse=t*scale;c.bitangentImpulse=u*scale;
      }
      }
      };solve();
      // Add newly encountered manifolds at this substep's actual pose. Warm
      // starts and authored forces have already been applied; local re-solves
      // update accumulated impulses without applying either a second time.
      if(knownPairs)for(let discovery=0;;discovery++){
        const substepEnds=this.bodies.map(b=>b.dynamic?b.at(h):b.pose),discovered:typeof pending=[];
        for(const [ai,bi] of this.candidates(h,substepEnds)){
          if(knownPairs.has(ai*pairStride+bi))continue;
          stats.candidatePairs++;stats.narrowPhaseTests++;
          const hit=this.queryPair(ai,bi,h,substepEnds[ai],substepEnds[bi],true);
          if(hit)discovered.push({ai,bi,hit});
        }
        for(const c of this.contactProvider?.(h)??[]){
          const ai=this.bodyIndexOf(c.a),bi=this.bodyIndexOf(c.b);
          if(ai<0||bi<0||ai===bi)throw new Error('Generated contact must reference two world bodies');
          if(knownPairs.has(ai*pairStride+bi)&&c.converged)continue;
          discovered.push({ai,bi,points:c.points,positionTarget:c.positionTarget,hit:{time:c.time,poseA:c.poseA,poseB:c.poseB,iterations:c.iterations,converged:c.converged,separation:{gap:Math.min(...c.points.map(p=>p.gap)),normal:c.normal,faceA:-1,faceB:-1}}});
        }
        if(!discovered.length)break;
        if(discovery>=4){
          if(refinement<MAX_CCD_REFINEMENT){retry();return;}
          throw new ContactResolutionError('discovery',h,refinement);
        }
        const firstNew=constraints.length;
        for(const entry of discovered)if(!appendContact(entry,h,false))return;
        stats.contacts=constraints.length;
        for(let ci=firstNew;ci<constraints.length;ci++)prepare(constraints[ci]);
        solve();
      }
      for(const c of constraints){
        const old=accumulated.get(c),impulse=add(mul(c.t,c.tangentImpulse),mul(c.u,c.bitangentImpulse));
        // This map belongs to the current trial. Keep the previous step's cache
        // untouched so an adaptive retry can restore its complete warm start.
        if(old){old.normal=c.n;old.normalImpulse+=c.normalImpulse;for(let k=0;k<3;k++)old.impulse[k]+=impulse[k];}
        else accumulated.set(c,{localA:c.localA,localB:c.localB,dynamicA:c.a.dynamic,dynamicB:c.b.dynamic,normal:c.n,normalImpulse:0+c.normalImpulse,impulse});
      }
      for(const b of this.bodies)b.advance(h);
    // Reuse the contact anchors for the dense part of the split position solve.
    // This resolves stacks without running a fresh SAT for every solver iteration.
    for(let it=0;it<3;it++){
      let worst=0;
      for(let ci=0;ci<constraints.length;ci++){
        const c=constraints[it%2?constraints.length-1-ci:ci],a=c.a,b=c.b;c.ra=rotate(a.rotation,c.localA);c.rb=rotate(b.rotation,c.localB);
        const gap=(b.position[0]+c.rb[0]-a.position[0]-c.ra[0])*c.n[0]+(b.position[1]+c.rb[1]-a.position[1]-c.ra[1])*c.n[1]+(b.position[2]+c.rb[2]-a.position[2]-c.ra[2])*c.n[2];
        if(gap>=c.positionTarget)continue;worst=Math.max(worst,c.positionTarget-gap);
        const weight=a.inverseMassAt(c.ra,c.n)+b.inverseMassAt(c.rb,c.n);if(weight<=1e-12)continue;const delta=Math.min(.01,(c.positionTarget-gap)*.8)/weight;
        a.correctPose(c.ra,mul(c.n,-delta));b.correctPose(c.rb,mul(c.n,delta));
      }
      if(worst<CONTACT_SLOP*1.1)break;
    }
    for(const b of this.bodies)if(b.dynamic)b.sync();
    }
    const nextCache=new Map<string,CachedImpulse[]>();
    for(const c of constraints){const group=nextCache.get(c.key)??[];group.push(accumulated.get(c)!);nextCache.set(c.key,group);}
    this.previous=nextCache;this.previousDt=dt;
    // At fixed orientations, every SAT contact is a linear separation constraint.
    // Solve the coupled translations using cached planes, then discover any new
    // neighbors. Earlier planes remain in the solve so a later contact cannot
    // simply push a supported piece back through a previously resolved surface.
    const planes=new Map<string,ProjectionPlane>();
    for(let pass=0;pass<6;pass++){
      let worst=this.externalPenetration(true,refinement);
      for(const [ai,bi] of this.candidates()){
        // A current separating axis proves this pair cannot add a support
        // plane or increase the nonnegative penetration maximum. Nearby pairs
        // retain the original SAT and its manifold-axis ordering.
        if(this.separatedByHint(ai,bi,CONTACT_SKIN*3))continue;
        const a=this.bodies[ai],b=this.bodies[bi],s=convexSeparation(a.pose,b.pose,CONTACT_SKIN*3);worst=Math.max(worst,-s.gap);
        // Retain nearby supports even when their gap is already acceptable.
        // A neighboring correction must not push through them on the last pass.
        if(s.gap>CONTACT_SKIN*3)continue;
        const key=ai+'/'+bi;if(!planes.has(key))planes.set(key,{ai,bi,n:s.normal,target:dot(s.normal,sub(b.position,a.position))-s.gap-CONTACT_SLOP,wa:a.dynamic?1/a.mass:0,wb:b.dynamic?1/b.mass:0});
      }
      if(worst<=CONTACT_SLOP*1.1)break;
      this.projectContactPositions([...planes.values()]);
      for(const b of this.bodies)if(b.dynamic)b.syncPosition();
    }
    stats.maxPenetration=this.externalPenetration(false,refinement);for(const [ai,bi] of this.candidates()){
      if(this.separatedByHint(ai,bi,0))continue;
      stats.maxPenetration=Math.max(stats.maxPenetration,-convexSeparation(this.bodies[ai].pose,this.bodies[bi].pose,0).gap);
    }
    if(stats.maxPenetration>2e-4&&refinement<5){
      // Reject the trial state, not the collision. Retry the same interval using
      // smaller steps, rebuilding contacts after each accepted half interval.
      retry();return;
    }
    this.impacts=constraints.filter(c=>c.incomingNormalSpeed<-.05&&(accumulated.get(c)?.normalImpulse??0)>1e-10).map(c=>({a:c.a,b:c.b,speed:-c.incomingNormalSpeed,impulse:accumulated.get(c)!.normalImpulse}));
    this.stats=stats;
    });
  }
  /** Scratch is overwritten on every call, including after a rejected trial.
   * Packing and copy-back preserve owned body arrays and the scalar GS order. */
  private projectContactPositions(list:ProjectionPlane[]):void {
    const count=this.bodies.length,planes=list.length;if(!planes)return;
    // Packing every body only pays off for a dense solve. Sparse contacts keep
    // the same scalar projection while touching just their participating bodies.
    if(planes<64||planes*2<count){
      for(let it=0;it<96;it++){
        let residual=0;
        for(let ci=0;ci<planes;ci++){
          const c=list[it%2?planes-1-ci:ci],a=this.bodies[c.ai].position,b=this.bodies[c.bi].position,n=c.n;
          const gap=c.target-((b[0]-a[0])*n[0]+(b[1]-a[1])*n[1]+(b[2]-a[2])*n[2]);
          if(gap<=0)continue;residual=Math.max(residual,gap);const correction=Math.min(.02,gap*.95)/(c.wa+c.wb);
          for(let k=0;k<3;k++){a[k]-=n[k]*correction*c.wa;b[k]+=n[k]*correction*c.wb;}
        }
        if(residual<CONTACT_SLOP*.05)break;
      }
      return;
    }
    if(this.projectionPositions.length<count*3)this.projectionPositions=new Float64Array(Math.max(count*3,this.projectionPositions.length*2,48));
    if(this.projectionCoefficients.length<planes*6){
      this.projectionCoefficients=new Float64Array(Math.max(planes*6,this.projectionCoefficients.length*2,96));
      this.projectionIndices=new Uint32Array(this.projectionCoefficients.length/3);
    }
    const p=this.projectionPositions,c=this.projectionCoefficients,ids=this.projectionIndices;
    for(let i=0;i<count;i++){const a=this.bodies[i].position,k=i*3;p[k]=a[0];p[k+1]=a[1];p[k+2]=a[2];}
    for(let i=0;i<planes;i++){const v=list[i],k=i*6;ids[i*2]=v.ai*3;ids[i*2+1]=v.bi*3;c[k]=v.n[0];c[k+1]=v.n[1];c[k+2]=v.n[2];c[k+3]=v.target;c[k+4]=v.wa;c[k+5]=v.wb;}
    for(let it=0;it<96;it++){
      let residual=0;
      for(let ci=0;ci<planes;ci++){
        const index=it%2?planes-1-ci:ci,k=index*6,a=ids[index*2],b=ids[index*2+1],nx=c[k],ny=c[k+1],nz=c[k+2],wa=c[k+4],wb=c[k+5];
        const gap=c[k+3]-((p[b]-p[a])*nx+(p[b+1]-p[a+1])*ny+(p[b+2]-p[a+2])*nz);
        if(gap<=0)continue;residual=Math.max(residual,gap);const correction=Math.min(.02,gap*.95)/(wa+wb);
        p[a]-=nx*correction*wa;p[b]+=nx*correction*wb;
        p[a+1]-=ny*correction*wa;p[b+1]+=ny*correction*wb;
        p[a+2]-=nz*correction*wa;p[b+2]+=nz*correction*wb;
      }
      if(residual<CONTACT_SLOP*.05)break;
    }
    for(let i=0;i<count;i++){const a=this.bodies[i].position,k=i*3;a[0]=p[k];a[1]=p[k+1];a[2]=p[k+2];}
  }
  private externalPenetration(correct:boolean,refinement=0):number {
    let worst=0;
    for(const c of this.contactProvider?.(0)??[]){
    if(!c.converged)throw new ContactResolutionError('projection',0,refinement);
    for(const p of c.points){
      worst=Math.max(worst,-p.gap);const target=c.positionTarget??-CONTACT_SLOP;if(!correct||p.gap>=target)continue;
      const ra=rotate(c.a.rotation,inverseRotate(c.poseA.rotation,sub(p.a,c.poseA.position))),rb=rotate(c.b.rotation,inverseRotate(c.poseB.rotation,sub(p.b,c.poseB.position)));
      const gap=dot(c.normal,sub(add(c.b.position,rb),add(c.a.position,ra)));if(gap>=target)continue;
      // Match the fixed-orientation translation projection for ordinary rigid
      // bodies. Generalized bodies retain their overridden mass/pose response.
      const weight=c.a.inverseMassAt(ra,c.normal,true)+c.b.inverseMassAt(rb,c.normal,true);if(weight<=1e-12)continue;
      const delta=Math.min(.01,(target-gap)*.8)/weight;
      c.a.correctPose(ra,mul(c.normal,-delta),true);c.b.correctPose(rb,mul(c.normal,delta),true);
      c.a.sync();c.b.sync();
    }
    }
    return worst;
  }
  private apply(c:Constraint,j:V):void {c.a.impulse(c.ra,mul(j,-1));c.b.impulse(c.rb,j);}
}

/** Closest point on a triangle, including degenerate edge features. */
export function closestTriangle(p:V,a:V,b:V,c:V):V {
  const ab=sub(b,a),ac=sub(c,a),ap=sub(p,a),d1=dot(ab,ap),d2=dot(ac,ap);if(d1<=0&&d2<=0)return a;
  const bp=sub(p,b),d3=dot(ab,bp),d4=dot(ac,bp);if(d3>=0&&d4<=d3)return b;
  const vc=d1*d4-d3*d2;if(vc<=0&&d1>=0&&d3<=0)return add(a,mul(ab,d1/(d1-d3)));
  const cp=sub(p,c),d5=dot(ab,cp),d6=dot(ac,cp);if(d6>=0&&d5<=d6)return c;
  const vb=d5*d2-d1*d6;if(vb<=0&&d2>=0&&d6<=0)return add(a,mul(ac,d2/(d2-d6)));
  const va=d3*d6-d5*d4;if(va<=0&&d4-d3>=0&&d5-d6>=0)return add(b,mul(sub(c,b),(d4-d3)/((d4-d3)+(d5-d6))));
  const inverse=1/(va+vb+vc);return add(a,add(mul(ab,vb*inverse),mul(ac,vc*inverse)));
}
/** Outward normal and nearest surface point, including a sphere centre inside a hull. */
export function sphereConvex(center:V,radius:number,body:ConvexBody,pose=body.pose):{gap:number;normal:V;point:V} {
  let maxPlane=-Infinity,face=0,closest=pose.vertices[0],distance=Infinity;
  for(let i=0;i<body.shape.faces.length;i++){
    const ids=body.shape.faces[i],a=pose.vertices[ids[0]],plane=dot(pose.normals[i],sub(center,a));if(plane>maxPlane){maxPlane=plane;face=i;}
    for(let j=1;j<ids.length-1;j++){const p=closestTriangle(center,a,pose.vertices[ids[j]],pose.vertices[ids[j+1]]),d=length(sub(center,p));if(d<distance){distance=d;closest=p;}}
  }
  if(maxPlane<=0)return {gap:maxPlane-radius,normal:pose.normals[face],point:sub(center,mul(pose.normals[face],maxPlane))};
  return {gap:distance-radius,normal:distance>1e-12?mul(sub(center,closest),1/distance):pose.normals[face],point:closest};
}
