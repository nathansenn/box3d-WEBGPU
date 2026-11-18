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
// rotate() with the same arithmetic, returning through scratch instead of an array.
let rotatedX=0,rotatedY=0,rotatedZ=0;
function rotateScalar(x:number,y:number,z:number,w:number,vx:number,vy:number,vz:number):void {
  const tx=(y*vz-z*vy)*2,ty=(z*vx-x*vz)*2,tz=(x*vy-y*vx)*2;
  rotatedX=vx+(tx*w+(y*tz-z*ty));rotatedY=vy+(ty*w+(z*tx-x*tz));rotatedZ=vz+(tz*w+(x*ty-y*tx));
}
function advanceQuaternion(q:ContactQuat,w:V,dt:number):ContactQuat {
  if(dt===0)return [...q];const speed=length(w);if(speed<1e-15)return [...q];
  const angle=speed*dt/2,s=Math.sin(angle)/speed,x=w[0]*s,y=w[1]*s,z=w[2]*s,c=Math.cos(angle);
  const n0=c*q[0]+x*q[3]+y*q[2]-z*q[1],n1=c*q[1]-x*q[2]+y*q[3]+z*q[0],n2=c*q[2]+x*q[1]-y*q[0]+z*q[3],n3=c*q[3]-x*q[0]-y*q[1]-z*q[2];
  const norm=Math.hypot(n0,n1,n2,n3);return [n0/norm,n1/norm,n2/norm,n3/norm];
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
  dynamic:boolean;collisionEnabled=true;friction=.5;restitution=.1;pose:ContactPose;
  /** World-space inverse inertia, row-major. Rebuilt by sync(); read by the contact solver. */
  worldInverse:number[]=[];
  constructor(shape:ConvexShape,position:V,mass=1,dynamic=true){
    if(position.some(v=>!Number.isFinite(v))||!Number.isFinite(mass)||mass<=0)throw new Error('Invalid contact body');
    this.shape=shape;this.position=[...position];this.mass=mass;this.dynamic=dynamic;this.pose=this.at(0);this.sync();
  }
  at(dt:number):ContactPose {
    const position=add(this.position,mul(this.velocity,this.dynamic?dt:0)),rotation=advanceQuaternion(this.rotation,this.angularVelocity,this.dynamic?dt:0);
    const [x,y,z,w]=rotation,xx=2*x*x,yy=2*y*y,zz=2*z*z,xy=2*x*y,xz=2*x*z,yz=2*y*z,wx=2*w*x,wy=2*w*y,wz=2*w*z;
    // One rotation matrix, applied with explicit loops: this runs for every body in every substep.
    const m0=1-yy-zz,m1=xy-wz,m2=xz+wy,m3=xy+wz,m4=1-xx-zz,m5=yz-wx,m6=xz-wy,m7=yz+wx,m8=1-xx-yy,shape=this.shape,px=position[0],py=position[1],pz=position[2];
    const local=shape.vertices,vertices=new Array<V>(local.length),min:V=[Infinity,Infinity,Infinity],max:V=[-Infinity,-Infinity,-Infinity];
    for(let i=0;i<local.length;i++){
      const v=local[i],vx=px+(m0*v[0]+m1*v[1]+m2*v[2]),vy=py+(m3*v[0]+m4*v[1]+m5*v[2]),vz=pz+(m6*v[0]+m7*v[1]+m8*v[2]);vertices[i]=[vx,vy,vz];
      min[0]=Math.min(min[0],vx);max[0]=Math.max(max[0],vx);min[1]=Math.min(min[1],vy);max[1]=Math.max(max[1],vy);min[2]=Math.min(min[2],vz);max[2]=Math.max(max[2],vz);
    }
    const localNormals=shape.normals,normals=new Array<V>(localNormals.length),localEdges=shape.edges,edges=new Array<V>(localEdges.length);
    for(let i=0;i<localNormals.length;i++){const v=localNormals[i];normals[i]=[m0*v[0]+m1*v[1]+m2*v[2],m3*v[0]+m4*v[1]+m5*v[2],m6*v[0]+m7*v[1]+m8*v[2]];}
    for(let i=0;i<localEdges.length;i++){const v=localEdges[i];edges[i]=[m0*v[0]+m1*v[1]+m2*v[2],m3*v[0]+m4*v[1]+m5*v[2],m6*v[0]+m7*v[1]+m8*v[2]];}
    return {position,rotation,vertices,normals,edges,min,max};
  }
  sync():void {this.pose=this.at(0);this.syncInertia();}
  /** The world inverse inertia of sync(), leaving the pose for a later sync(). */
  syncInertia():void {
    const q=this.rotation,m=this.shape.inverseInertia;
    // Column k is rotate(q, M inverseRotate(q, e_k)), in the arithmetic of rotate().
    const x=q[0],y=q[1],z=q[2],w=q[3],out=new Array<number>(9);
    for(let k=0;k<3;k++){
      rotateScalar(-x,-y,-z,w,k===0?1:0,k===1?1:0,k===2?1:0);const lx=rotatedX,ly=rotatedY,lz=rotatedZ;
      rotateScalar(x,y,z,w,m[0]*lx+m[1]*ly+m[2]*lz,m[3]*lx+m[4]*ly+m[5]*lz,m[6]*lx+m[7]*ly+m[8]*lz);
      out[k]=rotatedX;out[3+k]=rotatedY;out[6+k]=rotatedZ;
    }
    this.worldInverse=out;
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
/** Shape-axis identity of the most recent convexSeparation() result: 0 a face
 * of A, 1 a face of B, 2 an edge pair. Scratch for the caller's next statement. */
let separationKind=-1,separationI=0,separationJ=0;
/** Exact separating-axis test for convex polyhedra, including edge/edge axes. */
export function convexSeparation(a:ContactPose,b:ContactPose,earlyExit=Infinity):Separation {
  let bestGap=-Infinity,bestX=1,bestY=0,bestZ=0,bestFaceA=-1,bestFaceB=-1,normalReference:V|undefined,edgeA=0,edgeB=0;separationKind=-1;
  // Keep the axis arithmetic and tie order unchanged. Only the winning result
  // needs an owned normal; forward face normals retain their original alias.
  const axis=(nx:number,ny:number,nz:number,fa:number,fb:number,source?:V)=>{
    let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
    for(const v of a.vertices){const p=v[0]*nx+v[1]*ny+v[2]*nz;amin=Math.min(amin,p);amax=Math.max(amax,p);}
    for(const v of b.vertices){const p=v[0]*nx+v[1]*ny+v[2]*nz;bmin=Math.min(bmin,p);bmax=Math.max(bmax,p);}
    const forward=bmin-amax,backward=amin-bmax,gap=Math.max(forward,backward);
    if(gap>bestGap+1e-10){
      bestGap=gap;bestFaceA=fa;bestFaceB=fb;
      if(fa>=0){separationKind=0;separationI=fa;}else if(fb>=0){separationKind=1;separationI=fb;}else{separationKind=2;separationI=edgeA;separationJ=edgeB;}
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
  for(edgeA=0;edgeA<a.edges.length;edgeA++)for(edgeB=0;edgeB<b.edges.length;edgeB++){
    const ea=a.edges[edgeA],eb=b.edges[edgeB],x=ea[1]*eb[2]-ea[2]*eb[1],y=ea[2]*eb[0]-ea[0]*eb[2],z=ea[0]*eb[1]-ea[1]*eb[0],l=Math.sqrt(x*x+y*y+z*z);
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
  sweepEnter=0;sweepExit=1;
  const an=a.normals,bn=b.normals,ae=a.edges,be=b.edges;
  for(let i=0;i<an.length;i++){const n=an[i];if(!sweptAxis(a,b,endA,endB,n[0],n[1],n[2],padding)){if(hint){hint.kind=0;hint.i=i;hint.j=0;}return null;}}
  for(let i=0;i<bn.length;i++){const n=bn[i];if(!sweptAxis(a,b,endA,endB,n[0],n[1],n[2],padding)){if(hint){hint.kind=1;hint.i=i;hint.j=0;}return null;}}
  for(let i=0;i<ae.length;i++)for(let j=0;j<be.length;j++){
    const ea=ae[i],eb=be[j],x=ea[1]*eb[2]-ea[2]*eb[1],y=ea[2]*eb[0]-ea[0]*eb[2],z=ea[0]*eb[1]-ea[1]*eb[0],l=Math.sqrt(x*x+y*y+z*z);
    if(l>1e-8){const inverse=1/l;if(!sweptAxis(a,b,endA,endB,x*inverse,y*inverse,z*inverse,padding)){if(hint){hint.kind=2;hint.i=i;hint.j=j;}return null;}}
  }
  return [sweepEnter,sweepExit];
}
// One axis of sweptInterval(): the four projection ranges and both one-sided
// restrictions, in the original order, without range tuples or closures.
let sweepEnter=0,sweepExit=1;
function sweptAxis(a:ContactPose,b:ContactPose,endA:ContactPose,endB:ContactPose,nx:number,ny:number,nz:number,padding:number):boolean {
  let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity,eamin=Infinity,eamax=-Infinity,ebmin=Infinity,ebmax=-Infinity;
  for(const v of a.vertices){const d=v[0]*nx+v[1]*ny+v[2]*nz;amin=Math.min(amin,d);amax=Math.max(amax,d);}
  for(const v of b.vertices){const d=v[0]*nx+v[1]*ny+v[2]*nz;bmin=Math.min(bmin,d);bmax=Math.max(bmax,d);}
  for(const v of endA.vertices){const d=v[0]*nx+v[1]*ny+v[2]*nz;eamin=Math.min(eamin,d);eamax=Math.max(eamax,d);}
  for(const v of endB.vertices){const d=v[0]*nx+v[1]*ny+v[2]*nz;ebmin=Math.min(ebmin,d);ebmax=Math.max(ebmax,d);}
  let start=bmin-amax-padding-CONTACT_SKIN,end=ebmin-eamax-padding-CONTACT_SKIN;
  if(start>0&&end>0)return false;
  if(start>0)sweepEnter=Math.max(sweepEnter,start/(start-end));else if(end>0)sweepExit=Math.min(sweepExit,start/(start-end));
  if(!(sweepEnter<=sweepExit))return false;
  start=amin-bmax-padding-CONTACT_SKIN;end=eamin-ebmax-padding-CONTACT_SKIN;
  if(start>0&&end>0)return false;
  if(start>0)sweepEnter=Math.max(sweepEnter,start/(start-end));else if(end>0)sweepExit=Math.min(sweepExit,start/(start-end));
  return sweepEnter<=sweepExit;
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
/** The solver's inner loops call these when a body uses ConvexBody's own
 * response methods. Each repeats that method's arithmetic without temporaries. */
const rigidResponse=(b:ConvexBody):boolean=>b.pointVelocity===ConvexBody.prototype.pointVelocity&&b.inverseMassAt===ConvexBody.prototype.inverseMassAt&&b.impulse===ConvexBody.prototype.impulse&&b.correctPose===ConvexBody.prototype.correctPose&&b.inverseInertia===ConvexBody.prototype.inverseInertia;
function rigidInverseMass(b:ConvexBody,r:V,n:V):number {
  if(!b.dynamic)return 0;
  const c0=r[1]*n[2]-r[2]*n[1],c1=r[2]*n[0]-r[0]*n[2],c2=r[0]*n[1]-r[1]*n[0],m=b.worldInverse;
  return 1/b.mass+(c0*(m[0]*c0+m[1]*c1+m[2]*c2)+c1*(m[3]*c0+m[4]*c1+m[5]*c2)+c2*(m[6]*c0+m[7]*c1+m[8]*c2));
}
function rigidImpulse(b:ConvexBody,r:V,j0:number,j1:number,j2:number):void {
  if(!b.dynamic)return;
  const c0=r[1]*j2-r[2]*j1,c1=r[2]*j0-r[0]*j2,c2=r[0]*j1-r[1]*j0,m=b.worldInverse,v=b.velocity,w=b.angularVelocity,mass=b.mass;
  const a0=m[0]*c0+m[1]*c1+m[2]*c2,a1=m[3]*c0+m[4]*c1+m[5]*c2,a2=m[6]*c0+m[7]*c1+m[8]*c2;
  v[0]+=j0/mass;w[0]+=a0;v[1]+=j1/mass;w[1]+=a1;v[2]+=j2/mass;w[2]+=a2;
}
function rigidCorrectPose(b:ConvexBody,r:V,j0:number,j1:number,j2:number):void {
  if(!b.dynamic)return;
  const c0=r[1]*j2-r[2]*j1,c1=r[2]*j0-r[0]*j2,c2=r[0]*j1-r[1]*j0,m=b.worldInverse,mass=b.mass,p=b.position;
  const a0=m[0]*c0+m[1]*c1+m[2]*c2,a1=m[3]*c0+m[4]*c1+m[5]*c2,a2=m[6]*c0+m[7]*c1+m[8]*c2,angle=Math.sqrt(a0*a0+a1*a1+a2*a2),scale=angle>.15?.15/angle:1;
  p[0]+=j0/mass*scale;p[1]+=j1/mass*scale;p[2]+=j2/mass*scale;
  // advanceQuaternion(rotation, angular, scale), still returning a new array.
  const q=b.rotation;
  if(scale===0||angle<1e-15){b.rotation=[q[0],q[1],q[2],q[3]];return;}
  const half=angle*scale/2,sine=Math.sin(half)/angle,x=a0*sine,y=a1*sine,z=a2*sine,cosine=Math.cos(half);
  const n0=cosine*q[0]+x*q[3]+y*q[2]-z*q[1],n1=cosine*q[1]-x*q[2]+y*q[3]+z*q[0],n2=cosine*q[2]+x*q[1]-y*q[0]+z*q[3],n3=cosine*q[3]-x*q[0]-y*q[1]-z*q[2],norm=Math.hypot(n0,n1,n2,n3);
  b.rotation=[n0/norm,n1/norm,n2/norm,n3/norm];
}
/** A persistent pair certificate may skip a narrow-phase query only when a
 * separating axis of the *current* SAT axis set is known, from a bound on the
 * motion since the axis was measured, to clear the complete swept interval with
 * CERTIFICATE_MARGIN to spare. Every skipped query would have returned a miss,
 * so accepted states are unchanged. See GLASS_CONTACT.md, "Persistent pairs". */
const CERTIFICATE_MARGIN=CONTACT_SKIN*3+1e-6,CERTIFICATE_MINIMUM=CERTIFICATE_MARGIN+2e-5,CERTIFICATE_STRIDE=10,NEIGHBOR_MARGIN=.004;
let certificateKind=0,certificateLength=1;
function axisGap(av:V[],bv:V[],nx:number,ny:number,nz:number):number {
  let amin=Infinity,amax=-Infinity,bmin=Infinity,bmax=-Infinity;
  for(let i=0;i<av.length;i++){const v=av[i],d=v[0]*nx+v[1]*ny+v[2]*nz;if(d<amin)amin=d;if(d>amax)amax=d;}
  for(let i=0;i<bv.length;i++){const v=bv[i],d=v[0]*nx+v[1]*ny+v[2]*nz;if(d<bmin)bmin=d;if(d>bmax)bmax=d;}
  const forward=bmin-amax,backward=amin-bmax;return forward>backward?forward:backward;
}
/** Largest one-sided gap over body-fixed SAT axes. Edge pairs closer to
 * parallel than 0.01 are left out: their direction is too sensitive to bound. */
function certificateGap(a:ContactPose,b:ContactPose):number {
  let best=-Infinity;const av=a.vertices,bv=b.vertices;
  for(let i=0;i<a.normals.length;i++){const n=a.normals[i],g=axisGap(av,bv,n[0],n[1],n[2]);if(g>best){best=g;certificateKind=0;certificateLength=1;}}
  for(let i=0;i<b.normals.length;i++){const n=b.normals[i],g=axisGap(av,bv,n[0],n[1],n[2]);if(g>best){best=g;certificateKind=1;certificateLength=1;}}
  for(let i=0;i<a.edges.length;i++){
    const ea=a.edges[i];
    for(let j=0;j<b.edges.length;j++){
      const eb=b.edges[j],x=ea[1]*eb[2]-ea[2]*eb[1],y=ea[2]*eb[0]-ea[0]*eb[2],z=ea[0]*eb[1]-ea[1]*eb[0],l=Math.sqrt(x*x+y*y+z*z);
      if(!(l>=.01))continue;
      const g=axisGap(av,bv,x/l,y/l,z/l);if(g>best){best=g;certificateKind=2;certificateLength=l;}
    }
  }
  return best;
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
interface Constraint {rigid:boolean;key:string;a:ConvexBody;b:ConvexBody;ra:V;rb:V;localA:V;localB:V;normalBody:ConvexBody|null;localNormal:V;n:V;t:V;u:V;normalMass:number;frictionMass:number;target:number;normalImpulse:number;tangentImpulse:number;bitangentImpulse:number;friction:number;incomingNormalSpeed:number;positionTarget:number;}
interface CachedImpulse {localA:V;localB:V;dynamicA:boolean;dynamicB:boolean;normal:V;impulse:V;normalImpulse:number;}
interface ProjectionPlane extends SeparatingAxis {ai:number;bi:number;n:V;target:number;wa:number;wb:number;}
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
  // Persistent broad phase: a key-ordered superset of the candidate pairs built
  // from fattened bounds, and one motion-bounded separation certificate per pair.
  private neighborCount=-1;private neighborPairs=0;private neighborA=new Int32Array(0);private neighborB=new Int32Array(0);
  private neighborKeys=new Float64Array(0);private neighborKeyScratch=new Float64Array(0);private neighborFat=new Float64Array(0);private neighborFlags=new Uint8Array(0);private neighborBodies:ConvexBody[]=[];
  private neighborOrder:number[]=[];private certificates=new Float64Array(0);private certificateScratch=new Float64Array(0);
  private scanBounds=new Float64Array(0);private scanMotion=new Float64Array(0);private scanPosition=new Float64Array(0);private scanSweep=new Float64Array(0);private scanPlain=new Uint8Array(0);
  private finalBounds=new Float64Array(0);private scanA=new Int32Array(0);private scanB=new Int32Array(0);private scanSlot=new Int32Array(0);private scanSerial=0;
  private trackedRotation=new Float64Array(0);private trackedTurn=new Float64Array(0);
  /** Set false to run the original sort-and-sweep and every narrow-phase query. */
  persistentPairs=true;
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
  /** Same pairs, in the same order, as candidates(dt,endPoses). The pairs are
   * left in scanA/scanB with the certificate slot of each pair in scanSlot
   * (-1 when this scan used the original search). End poses are created only
   * for bodies whose class replaces at(); callers fill the rest on demand. */
  private scan(dt:number,endPoses:(ContactPose|undefined)[]|null):number {
    const count=this.bodies.length;
    if(count>94_906_265)throw new RangeError('Contact body count exceeds the exact pair-key range');
    if(this.scanBounds.length<count*6){
      const size=Math.max(count,this.scanMotion.length*2,16);
      this.scanBounds=new Float64Array(size*6);this.scanMotion=new Float64Array(size);this.scanPlain=new Uint8Array(size);
      this.scanPosition=new Float64Array(size*3);this.scanSweep=new Float64Array(size*3);
      const rotation=new Float64Array(size*4),turn=new Float64Array(size);
      rotation.set(this.trackedRotation);turn.set(this.trackedTurn);this.trackedRotation=rotation;this.trackedTurn=turn;
      const fat=new Float64Array(size*6),flags=new Uint8Array(size);fat.set(this.neighborFat);flags.set(this.neighborFlags);this.neighborFat=fat;this.neighborFlags=flags;
    }
    const bounds=this.scanBounds,motion=this.scanMotion,plain=this.scanPlain,fat=this.neighborFat,flags=this.neighborFlags,tracked=this.trackedRotation,positions=this.scanPosition,sweeps=this.scanSweep;
    let rebuild=!this.persistentPairs||count!==this.neighborCount,identity=count!==this.neighborCount,legacy=!this.persistentPairs;
    this.scanSerial++;
    for(let id=0;id<count&&!legacy;id++){
      const b=this.bodies[id],flag=(b.collisionEnabled?1:0)|(b.dynamic?2:0);
      if(this.neighborBodies[id]!==b){identity=true;rebuild=true;}
      if(flags[id]!==flag)rebuild=true;
      if(!b.collisionEnabled)continue;
      const pose=b.pose,p=pose.position,q=pose.rotation,k=id*6,t=id*4,moving=dt!==0&&b.dynamic;
      // The start pose must be the body's own state for the travel bound to hold.
      const bp=b.position,br=b.rotation,replaced=b.at!==ConvexBody.prototype.at,ordinary=!replaced&&bp[0]===p[0]&&bp[1]===p[1]&&bp[2]===p[2]&&br[0]===q[0]&&br[1]===q[1]&&br[2]===q[2]&&br[3]===q[3];
      // Accumulate an upper bound on the rotation angle since the pose was last seen.
      const q0=q[0],q1=q[1],q2=q[2],q3=q[3],a0=q0-tracked[t],a1=q1-tracked[t+1],a2=q2-tracked[t+2],a3=q3-tracked[t+3];
      if(a0!==0||a1!==0||a2!==0||a3!==0){
        const s0=q0+tracked[t],s1=q1+tracked[t+1],s2=q2+tracked[t+2],s3=q3+tracked[t+3];
        const chord=Math.sqrt(Math.min(a0*a0+a1*a1+a2*a2+a3*a3,s0*s0+s1*s1+s2*s2+s3*s3));
        // For unit quaternions the angle is 4 asin(chord/2) <= 2.03 chord while chord <= 0.5.
        this.trackedTurn[id]+=chord<=.5?chord*2.03:8;
        tracked[t]=q0;tracked[t+1]=q1;tracked[t+2]=q2;tracked[t+3]=q3;
      }
      const unit=Math.abs(q0*q0+q1*q1+q2*q2+q3*q3-1)<1e-9;
      plain[id]=Number(ordinary&&unit);
      let e0:number,e1:number,e2:number,e3:number,e4:number,e5:number;
      if(!moving){const lo=pose.min,hi=pose.max;e0=lo[0];e1=lo[1];e2=lo[2];e3=hi[0];e4=hi[1];e5=hi[2];}
      else if(replaced){const end=(endPoses![id]??=b.at(dt)),lo=end.min,hi=end.max;e0=lo[0];e1=lo[1];e2=lo[2];e3=hi[0];e4=hi[1];e5=hi[2];}
      else{
        // The arithmetic of ConvexBody.at(dt), keeping only the bounds.
        const bv=b.velocity,px=bp[0]+bv[0]*dt,py=bp[1]+bv[1]*dt,pz=bp[2]+bv[2]*dt,r=b.rotation,w=b.angularVelocity;
        let x=r[0],y=r[1],z=r[2],c=r[3];const speed=Math.sqrt(w[0]*w[0]+w[1]*w[1]+w[2]*w[2]);
        if(!(speed<1e-15)){
          const angle=speed*dt/2,sine=Math.sin(angle)/speed,wx=w[0]*sine,wy=w[1]*sine,wz=w[2]*sine,cosine=Math.cos(angle);
          const n0=cosine*r[0]+wx*r[3]+wy*r[2]-wz*r[1],n1=cosine*r[1]-wx*r[2]+wy*r[3]+wz*r[0],n2=cosine*r[2]+wx*r[1]-wy*r[0]+wz*r[3],n3=cosine*r[3]-wx*r[0]-wy*r[1]-wz*r[2],norm=Math.hypot(n0,n1,n2,n3);
          x=n0/norm;y=n1/norm;z=n2/norm;c=n3/norm;
        }
        const xx=2*x*x,yy=2*y*y,zz=2*z*z,xy=2*x*y,xz=2*x*z,yz=2*y*z,cx=2*c*x,cy=2*c*y,cz=2*c*z;
        const m0=1-yy-zz,m1=xy-cz,m2=xz+cy,m3=xy+cz,m4=1-xx-zz,m5=yz-cx,m6=xz-cy,m7=yz+cx,m8=1-xx-yy,local=b.shape.vertices;
        e0=e1=e2=Infinity;e3=e4=e5=-Infinity;
        for(let i=0;i<local.length;i++){
          const v=local[i],vx=px+(m0*v[0]+m1*v[1]+m2*v[2]),vy=py+(m3*v[0]+m4*v[1]+m5*v[2]),vz=pz+(m6*v[0]+m7*v[1]+m8*v[2]);
          e0=Math.min(e0,vx);e1=Math.min(e1,vy);e2=Math.min(e2,vz);e3=Math.max(e3,vx);e4=Math.max(e4,vy);e5=Math.max(e5,vz);
        }
      }
      const w=b.angularVelocity,radius=b.shape.radius,spin=w[0]*w[0]+w[1]*w[1]+w[2]*w[2],angular=b.dynamic?radius*spin*dt*dt/8:0,lo=pose.min,hi=pose.max;
      const b0=bounds[k]=Math.min(lo[0],e0)-angular-CONTACT_SKIN,b1=bounds[k+1]=Math.min(lo[1],e1)-angular-CONTACT_SKIN,b2=bounds[k+2]=Math.min(lo[2],e2)-angular-CONTACT_SKIN;
      const b3=bounds[k+3]=Math.max(hi[0],e3)+angular+CONTACT_SKIN,b4=bounds[k+4]=Math.max(hi[1],e4)+angular+CONTACT_SKIN,b5=bounds[k+5]=Math.max(hi[2],e5)+angular+CONTACT_SKIN;
      if(!(b3-b0<Infinity&&b4-b1<Infinity&&b5-b2<Infinity)){legacy=true;break;}
      if(b0<fat[k]||b1<fat[k+1]||b2<fat[k+2]||b3>fat[k+3]||b4>fat[k+4]||b5>fat[k+5])rebuild=true;
      // Vertex travel to the end pose, plus the chord padding of the swept test.
      const v=b.velocity,o=id*3;positions[o]=p[0];positions[o+1]=p[1];positions[o+2]=p[2];
      if(moving){sweeps[o]=v[0]*dt;sweeps[o+1]=v[1]*dt;sweeps[o+2]=v[2]*dt;motion[id]=plain[id]?radius*Math.sqrt(spin)*dt+angular:Infinity;}
      else{sweeps[o]=sweeps[o+1]=sweeps[o+2]=0;motion[id]=0;}
    }
    if(legacy){
      // Non-finite bounds keep the original comparator behaviour exactly.
      this.neighborCount=-1;
      const ends=endPoses?this.bodies.map((b,id)=>(endPoses[id]??=b.dynamic&&dt?b.at(dt):b.pose)):undefined,pairs=this.candidates(dt,ends);
      this.reserveScan(pairs.length);
      for(let i=0;i<pairs.length;i++){this.scanA[i]=pairs[i][0];this.scanB[i]=pairs[i][1];this.scanSlot[i]=-1;}
      return pairs.length;
    }
    if(rebuild)this.rebuildNeighbors(identity);
    const pa=this.neighborA,pb=this.neighborB,total=this.neighborPairs;this.reserveScan(total);
    const outA=this.scanA,outB=this.scanB,outSlot=this.scanSlot;let found=0;
    for(let i=0;i<total;i++){
      const ai=pa[i],bi=pb[i],a=ai*6,b=bi*6;
      if(bounds[a]>bounds[b+3]||bounds[b]>bounds[a+3]||bounds[a+1]>bounds[b+4]||bounds[a+4]<bounds[b+1]||bounds[a+2]>bounds[b+5]||bounds[a+5]<bounds[b+2])continue;
      outA[found]=ai;outB[found]=bi;outSlot[found++]=i;
    }
    return found;
  }
  private reserveScan(size:number):void {
    if(this.scanA.length>=size)return;const next=Math.max(size,this.scanA.length*2,64);
    this.scanA=new Int32Array(next);this.scanB=new Int32Array(next);this.scanSlot=new Int32Array(next);
  }
  private rebuildNeighbors(identity:boolean):void {
    const count=this.bodies.length,bounds=this.scanBounds,fat=this.neighborFat,flags=this.neighborFlags,order=this.neighborOrder;let enabled=0;
    for(let id=0;id<count;id++){
      const b=this.bodies[id],k=id*6;this.neighborBodies[id]=b;flags[id]=(b.collisionEnabled?1:0)|(b.dynamic?2:0);
      if(!b.collisionEnabled)continue;order[enabled++]=id;
      const v=b.velocity,w=b.angularVelocity,margin=NEIGHBOR_MARGIN+(b.dynamic?(Math.sqrt(v[0]*v[0]+v[1]*v[1]+v[2]*v[2])+b.shape.radius*Math.sqrt(w[0]*w[0]+w[1]*w[1]+w[2]*w[2]))/120:0);
      const pad=margin<Infinity?margin:NEIGHBOR_MARGIN;
      fat[k]=bounds[k]-pad;fat[k+1]=bounds[k+1]-pad;fat[k+2]=bounds[k+2]-pad;fat[k+3]=bounds[k+3]+pad;fat[k+4]=bounds[k+4]+pad;fat[k+5]=bounds[k+5]+pad;
    }
    this.neighborBodies.length=count;order.length=enabled;order.sort((a,b)=>fat[a*6]-fat[b*6]||a-b);
    let keys=this.neighborKeyScratch,pairs=0;
    for(let i=0;i<enabled;i++){
      const ai=order[i],a=ai*6,staticA=!(flags[ai]&2);
      for(let j=i+1;j<enabled&&fat[order[j]*6]<=fat[a+3];j++){
        const bi=order[j],b=bi*6;if(staticA&&!(flags[bi]&2))continue;
        if(fat[a+1]>fat[b+4]||fat[a+4]<fat[b+1]||fat[a+2]>fat[b+5]||fat[a+5]<fat[b+2])continue;
        if(pairs===keys.length){const next=new Float64Array(Math.max(256,keys.length*2));next.set(keys);keys=next;}
        keys[pairs++]=ai<bi?ai*count+bi:bi*count+ai;
      }
    }
    keys.subarray(0,pairs).sort();
    // Carry certificates over by merging the two key-ordered lists.
    const old=this.certificates,oldKeys=this.neighborKeys,oldPairs=identity?0:this.neighborPairs;
    let next=this.certificateScratch;if(next.length<pairs*CERTIFICATE_STRIDE)next=new Float64Array(Math.max(pairs*CERTIFICATE_STRIDE,next.length*2,256));
    if(this.neighborA.length<pairs){const size=Math.max(pairs,this.neighborA.length*2,64);this.neighborA=new Int32Array(size);this.neighborB=new Int32Array(size);}
    for(let i=0,j=0;i<pairs;i++){
      const key=keys[i],k=i*CERTIFICATE_STRIDE;while(j<oldPairs&&oldKeys[j]<key)j++;
      if(j<oldPairs&&oldKeys[j]===key){const o=j*CERTIFICATE_STRIDE;for(let f=0;f<CERTIFICATE_STRIDE;f++)next[k+f]=old[o+f];}
      else{next[k]=-Infinity;next[k+3]=0;next[k+7]=0;next[k+8]=0;next[k+9]=0;}
      const ai=Math.floor(key/count);this.neighborA[i]=ai;this.neighborB[i]=key-ai*count;
    }
    this.certificateScratch=old;this.certificates=next;this.neighborKeyScratch=oldKeys;this.neighborKeys=keys;this.neighborPairs=pairs;this.neighborCount=count;
  }
  /** True when the pair's separating axis still clears this scan's sweep. The
   * loss is bounded by the change of the centre offset since measurement and to
   * the end pose, plus every vertex's rotational travel and the axis rotation. */
  private certified(slot:number,ai:number,bi:number):boolean {
    const c=this.certificates,k=slot*CERTIFICATE_STRIDE,p=this.scanPosition,s=this.scanSweep,a=ai*3,b=bi*3;
    const x=p[b]-p[a]-c[k+4],y=p[b+1]-p[a+1]-c[k+5],z=p[b+2]-p[a+2]-c[k+6],u=s[b]-s[a],v=s[b+1]-s[a+1],w=s[b+2]-s[a+2];
    return Math.sqrt(x*x+y*y+z*z)+Math.sqrt(u*u+v*v+w*w)+c[k+1]*this.trackedTurn[ai]+c[k+2]*this.trackedTurn[bi]+this.scanMotion[ai]+this.scanMotion[bi]<c[k];
  }
  /** Measure a pair that has just been found separated at its current poses. */
  private certify(slot:number,ai:number,bi:number):void {
    const c=this.certificates,k=slot*CERTIFICATE_STRIDE;
    const serial=this.scanSerial;
    if(serial<c[k+3]||!this.scanPlain[ai]||!this.scanPlain[bi])return;
    // Measuring costs about as much as the query it replaces. A pair whose last
    // certificate lasted only a few scans is moving too fast to be worth one.
    // The first attempt reuses the pair's rejecting hint axis; a short-lived
    // result earns one full axis search and then a growing pause.
    if(c[k]>-Infinity&&serial-c[k+7]<8){
      if(c[k+8]===0)c[k+8]=1;
      else{c[k+9]=Math.min(128,Math.max(8,c[k+9]*2));c[k]=-Infinity;c[k+3]=serial+c[k+9];return;}
    }else if(serial-c[k+7]>=64){c[k+8]=0;c[k+9]=0;}
    const a=this.bodies[ai],b=this.bodies[bi],pa=a.pose,pb=b.pose;let gap=-Infinity;
    if(c[k+8]===0){
      const count=this.bodies.length,hint=count===this.separatingAxisCount?this.separatingAxes.get(ai*count+bi):undefined,n=hint?currentSeparatingAxis(pa,pb,hint):undefined;
      if(n){
        certificateKind=hint!.kind;certificateLength=hint!.kind===2?length(cross(pa.edges[hint!.i],pb.edges[hint!.j])):1;
        if(certificateLength>=.01)gap=currentAxisGap(pa,pb,n);
      }
    }
    if(!(gap>CERTIFICATE_MINIMUM*4))gap=certificateGap(pa,pb);
    if(!(gap>CERTIFICATE_MINIMUM)){c[k]=-Infinity;c[k+3]=serial+24;return;}
    c[k+7]=serial;
    const p=pa.position,q=pb.position,x=q[0]-p[0],y=q[1]-p[1],z=q[2]-p[2],span=Math.sqrt(x*x+y*y+z*z)+a.shape.radius+b.shape.radius;
    // A face normal turns with its owner. A normalized edge cross product moves
    // by at most 2.125(alpha+beta)/l while alpha+beta <= l/4, which the budget enforces.
    const edge=4/certificateLength,ka=certificateKind===0?1.0001:certificateKind===1?0:edge,kb=certificateKind===1?1.0001:certificateKind===0?0:edge;
    const wa=a.shape.radius*1.0001+span*ka,wb=b.shape.radius*1.0001+span*kb;
    c[k+1]=wa;c[k+2]=wb;c[k+3]=0;c[k+4]=x;c[k+5]=y;c[k+6]=z;
    c[k]=wa*this.trackedTurn[ai]+wb*this.trackedTurn[bi]+(gap-CERTIFICATE_MARGIN);
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
    const ends:(ContactPose|undefined)[]=new Array(this.bodies.length);
    const endOf=(id:number):ContactPose=>ends[id]??=(this.bodies[id].dynamic?this.bodies[id].at(dt):this.bodies[id].pose);
    const pairCount=this.scan(dt,ends);
    // A certified pair is a miss: it is counted and never queried. End poses of
    // the remaining pairs are fixed here, before a contact provider can run.
    const pending:{ai:number;bi:number;slot:number;hit?:ConvexSweep;points?:ContactPoint[];positionTarget?:number}[]=[];
    for(let i=0;i<pairCount;i++){
      const ai=this.scanA[i],bi=this.scanB[i],slot=this.scanSlot[i];
      if(slot>=0&&this.certified(slot,ai,bi)){stats.narrowPhaseTests++;continue;}
      endOf(ai);endOf(bi);pending.push({ai,bi,slot});
    }
    let providerContacts=0;
    for(const c of this.contactProvider?.(dt)??[]){
      providerContacts++;
      const ai=this.bodyIndexOf(c.a),bi=this.bodyIndexOf(c.b);if(ai<0||bi<0||ai===bi)throw new Error('Generated contact must reference two world bodies');
      pending.push({ai,bi,slot:-1,points:c.points,positionTarget:c.positionTarget,hit:{time:c.time,poseA:c.poseA,poseB:c.poseB,iterations:c.iterations,converged:c.converged,separation:{gap:Math.min(...c.points.map(p=>p.gap)),normal:c.normal,faceA:-1,faceB:-1}}});
    }
    stats.candidatePairs=pairCount+providerContacts;
    // Body count is fixed throughout a trial. candidates() has checked the
    // exact integer-key range; public warm-start keys retain their string form.
    const pairStride=this.bodies.length,knownPairs=this.externalForces?new Set<number>():null;
    const appendContact=(entry:typeof pending[number],interval:number,cache:boolean):boolean=>{
      const {ai,bi}=entry;
      const a=this.bodies[ai],b=this.bodies[bi];stats.narrowPhaseTests++;
      const hit=entry.hit??this.queryPair(ai,bi,interval,endOf(ai),endOf(bi),false);if(!hit){if(entry.slot>=0)this.certify(entry.slot,ai,bi);return true;}stats.ccdIterations+=hit.iterations;if(!hit.converged)stats.ccdUnresolved++;
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
        const c:Constraint={rigid:rigidResponse(a)&&rigidResponse(b),key,a,b,ra:armA,rb:armB,localA:ra,localB:rb,normalBody,localNormal:normalBody?inverseRotate(normalBody===a?pa.rotation:pb.rotation,n):n,n,t:tangent,u:bitangent,normalMass:1/inv,frictionMass:0,target,normalImpulse:0,tangentImpulse:0,bitangentImpulse:0,friction:currentGap>CONTACT_SKIN*3?0:Math.sqrt(a.friction*b.friction),incomingNormalSpeed:vn,positionTarget:entry.positionTarget??-CONTACT_SLOP};
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
        if(c.rigid){c.normalMass=1/(rigidInverseMass(c.a,c.ra,c.n)+rigidInverseMass(c.b,c.rb,c.n)||Infinity);c.frictionMass=1/((rigidInverseMass(c.a,c.ra,c.t)+rigidInverseMass(c.b,c.rb,c.t))+(rigidInverseMass(c.a,c.ra,c.u)+rigidInverseMass(c.b,c.rb,c.u))||Infinity);}
        else{c.normalMass=1/(c.a.inverseMassAt(c.ra,c.n)+c.b.inverseMassAt(c.rb,c.n)||Infinity);c.frictionMass=1/((c.a.inverseMassAt(c.ra,c.t)+c.b.inverseMassAt(c.rb,c.t))+(c.a.inverseMassAt(c.ra,c.u)+c.b.inverseMassAt(c.rb,c.u))||Infinity);}
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
      const c=constraints[it%2?constraints.length-1-ci:ci];
      if(c.rigid){
        // The same sequence as the general branch below, without temporaries.
        const a=c.a,b=c.b,ra=c.ra,rb=c.rb,n=c.n,va=a.velocity,wa=a.angularVelocity,vb=b.velocity,wb=b.angularVelocity,da=a.dynamic,db=b.dynamic;
        let ax=0,ay=0,az=0,bx=0,by=0,bz=0;
        if(da){ax=va[0]+wa[1]*ra[2]-wa[2]*ra[1];ay=va[1]+wa[2]*ra[0]-wa[0]*ra[2];az=va[2]+wa[0]*ra[1]-wa[1]*ra[0];}
        if(db){bx=vb[0]+wb[1]*rb[2]-wb[2]*rb[1];by=vb[1]+wb[2]*rb[0]-wb[0]*rb[2];bz=vb[2]+wb[0]*rb[1]-wb[1]*rb[0];}
        const next=Math.max(0,c.normalImpulse+(c.target-((bx-ax)*n[0]+(by-ay)*n[1]+(bz-az)*n[2]))*c.normalMass),normalDelta=next-c.normalImpulse;c.normalImpulse=next;
        const j0=n[0]*normalDelta,j1=n[1]*normalDelta,j2=n[2]*normalDelta;
        rigidImpulse(a,ra,j0*-1,j1*-1,j2*-1);rigidImpulse(b,rb,j0,j1,j2);
        if(!c.friction)continue;
        ax=ay=az=bx=by=bz=0;
        if(da){ax=va[0]+wa[1]*ra[2]-wa[2]*ra[1];ay=va[1]+wa[2]*ra[0]-wa[0]*ra[2];az=va[2]+wa[0]*ra[1]-wa[1]*ra[0];}
        if(db){bx=vb[0]+wb[1]*rb[2]-wb[2]*rb[1];by=vb[1]+wb[2]*rb[0]-wb[0]*rb[2];bz=vb[2]+wb[0]*rb[1]-wb[1]*rb[0];}
        const r0=bx-ax,r1=by-ay,r2=bz-az,ct=c.t,cu=c.u;
        const t=c.tangentImpulse-(r0*ct[0]+r1*ct[1]+r2*ct[2])*c.frictionMass,u=c.bitangentImpulse-(r0*cu[0]+r1*cu[1]+r2*cu[2])*c.frictionMass,bound=c.friction*next,scale=Math.min(1,bound/(Math.hypot(t,u)||1));
        const dt_=t*scale-c.tangentImpulse,du=u*scale-c.bitangentImpulse,f0=ct[0]*dt_+cu[0]*du,f1=ct[1]*dt_+cu[1]*du,f2=ct[2]*dt_+cu[2]*du;
        rigidImpulse(a,ra,f0*-1,f1*-1,f2*-1);rigidImpulse(b,rb,f0,f1,f2);c.tangentImpulse=t*scale;c.bitangentImpulse=u*scale;
        continue;
      }
      const v=sub(c.b.pointVelocity(c.rb),c.a.pointVelocity(c.ra));
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
        const substepEnds:(ContactPose|undefined)[]=new Array(this.bodies.length),discovered:typeof pending=[];
        const found=this.scan(h,substepEnds);
        for(let i=0;i<found;i++){
          const ai=this.scanA[i],bi=this.scanB[i],slot=this.scanSlot[i];
          if(knownPairs.has(ai*pairStride+bi))continue;
          stats.candidatePairs++;stats.narrowPhaseTests++;
          if(slot>=0&&this.certified(slot,ai,bi))continue;
          const a=this.bodies[ai],b=this.bodies[bi];
          const hit=this.queryPair(ai,bi,h,substepEnds[ai]??=(a.dynamic?a.at(h):a.pose),substepEnds[bi]??=(b.dynamic?b.at(h):b.pose),true);
          if(hit)discovered.push({ai,bi,slot:-1,hit});else if(slot>=0)this.certify(slot,ai,bi);
        }
        for(const c of this.contactProvider?.(h)??[]){
          const ai=this.bodyIndexOf(c.a),bi=this.bodyIndexOf(c.b);
          if(ai<0||bi<0||ai===bi)throw new Error('Generated contact must reference two world bodies');
          if(knownPairs.has(ai*pairStride+bi)&&c.converged)continue;
          discovered.push({ai,bi,slot:-1,points:c.points,positionTarget:c.positionTarget,hit:{time:c.time,poseA:c.poseA,poseB:c.poseB,iterations:c.iterations,converged:c.converged,separation:{gap:Math.min(...c.points.map(p=>p.gap)),normal:c.normal,faceA:-1,faceB:-1}}});
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
      // The position solve below reads positions, rotations and inertia only, and
      // every dynamic body is synchronized after it, so an ordinary body's
      // intermediate pose is never read and is not built.
      for(const b of this.bodies){
        if(b.advance!==ConvexBody.prototype.advance||b.sync!==ConvexBody.prototype.sync||b.at!==ConvexBody.prototype.at)b.advance(h);
        else if(b.dynamic){b.position=add(b.position,mul(b.velocity,h));b.rotation=advanceQuaternion(b.rotation,b.angularVelocity,h);b.syncInertia();}
      }
    // Reuse the contact anchors for the dense part of the split position solve.
    // This resolves stacks without running a fresh SAT for every solver iteration.
    for(let it=0;it<3;it++){
      let worst=0;
      for(let ci=0;ci<constraints.length;ci++){
        const c=constraints[it%2?constraints.length-1-ci:ci],a=c.a,b=c.b;c.ra=rotate(a.rotation,c.localA);c.rb=rotate(b.rotation,c.localB);
        const gap=(b.position[0]+c.rb[0]-a.position[0]-c.ra[0])*c.n[0]+(b.position[1]+c.rb[1]-a.position[1]-c.ra[1])*c.n[1]+(b.position[2]+c.rb[2]-a.position[2]-c.ra[2])*c.n[2];
        if(gap>=c.positionTarget)continue;worst=Math.max(worst,c.positionTarget-gap);
        if(c.rigid){
          const weight=rigidInverseMass(a,c.ra,c.n)+rigidInverseMass(b,c.rb,c.n);if(weight<=1e-12)continue;const delta=Math.min(.01,(c.positionTarget-gap)*.8)/weight,n=c.n,back=-delta;
          rigidCorrectPose(a,c.ra,n[0]*back,n[1]*back,n[2]*back);rigidCorrectPose(b,c.rb,n[0]*delta,n[1]*delta,n[2]*delta);continue;
        }
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
    const planes=new Map<number,ProjectionPlane>(),passLimit=CONTACT_SLOP*1.1;
    for(let pass=0;pass<6;pass++){
      let worst=this.externalPenetration(true,refinement);
      const found=this.scan(0,null);
      for(let i=0;i<found;i++){
        const ai=this.scanA[i],bi=this.scanB[i],slot=this.scanSlot[i];
        if(slot>=0&&this.certified(slot,ai,bi))continue;
        // A pair that already has a plane can only raise the maximum. Once the
        // maximum is past the pass limit its value is not used again, so the
        // SAT of such a pair cannot change this pass or the plane set.
        const key=ai*pairStride+bi;
        if(worst>passLimit&&planes.has(key))continue;
        // A current separating axis proves this pair cannot add a support
        // plane or increase the nonnegative penetration maximum. Nearby pairs
        // retain the original SAT and its manifold-axis ordering.
        if(this.separatedByHint(ai,bi,CONTACT_SKIN*3)){if(slot>=0)this.certify(slot,ai,bi);continue;}
        const a=this.bodies[ai],b=this.bodies[bi],s=convexSeparation(a.pose,b.pose,CONTACT_SKIN*3);worst=Math.max(worst,-s.gap);
        // Retain nearby supports even when their gap is already acceptable.
        // A neighboring correction must not push through them on the last pass.
        if(s.gap>CONTACT_SKIN*3){if(slot>=0)this.certify(slot,ai,bi);continue;}
        if(!planes.has(key))planes.set(key,{ai,bi,kind:separationKind,i:separationI,j:separationJ,n:s.normal,target:dot(s.normal,sub(b.position,a.position))-s.gap-CONTACT_SLOP,wa:a.dynamic?1/a.mass:0,wb:b.dynamic?1/b.mass:0});
      }
      if(worst<=passLimit)break;
      this.projectContactPositions([...planes.values()]);
      for(const b of this.bodies)if(b.dynamic)b.syncPosition();
    }
    // The accepted maximum is the largest penetration over every remaining
    // pair. SAT returns at least (one axis gap - 1e-10), so a pair whose plane
    // axis already bounds its penetration below the running maximum is skipped.
    let deepest=this.externalPenetration(false,refinement),first=-1,firstBound=-Infinity;
    const finalFound=this.scan(0,null);
    if(this.finalBounds.length<finalFound)this.finalBounds=new Float64Array(Math.max(finalFound,this.finalBounds.length*2,64));
    const finalBounds=this.finalBounds;
    for(let i=0;i<finalFound;i++){
      const ai=this.scanA[i],bi=this.scanB[i],slot=this.scanSlot[i];finalBounds[i]=-Infinity;
      if(slot>=0&&this.certified(slot,ai,bi))continue;
      if(this.separatedByHint(ai,bi,0)){if(slot>=0)this.certify(slot,ai,bi);continue;}
      const plane=planes.get(ai*pairStride+bi),a=this.bodies[ai].pose,b=this.bodies[bi].pose,n=plane?currentSeparatingAxis(a,b,plane):undefined;
      const bound=n?1e-10-currentAxisGap(a,b,n):Infinity;finalBounds[i]=bound<Infinity?bound:Infinity;
      if(finalBounds[i]>firstBound){firstBound=finalBounds[i];first=i;}
    }
    if(first>=0){deepest=Math.max(deepest,-convexSeparation(this.bodies[this.scanA[first]].pose,this.bodies[this.scanB[first]].pose,0).gap);finalBounds[first]=-Infinity;}
    for(let i=0;i<finalFound;i++){
      if(finalBounds[i]<=deepest)continue;
      deepest=Math.max(deepest,-convexSeparation(this.bodies[this.scanA[i]].pose,this.bodies[this.scanB[i]].pose,0).gap);
    }
    stats.maxPenetration=deepest;
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
