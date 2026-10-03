/** Independent scalar geometry reference. Uses only owned render transforms;
 * does not call Box3D queries or reuse its collision tree/geometry code.
 */
export function readBoxes(world){
  const n=world.bodyCount(),p=Number(world._b3w_matrices_ptr())/4,heap=world.HEAPF32;
  return Array.from({length:n},(_,i)=>{
    const m=heap.slice(p+i*16,p+(i+1)*16),center=[m[12],m[13],m[14]];
    const axes=[[m[0],m[1],m[2]],[m[4],m[5],m[6]],[m[8],m[9],m[10]]];
    const halfExtents=axes.map(v=>Math.hypot(...v));
    return {token:world.bodyHandle(i).token,center,halfExtents,axes:axes.map((v,k)=>v.map(n=>n/halfExtents[k]))};
  });
}
const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>a.map((n,k)=>n-b[k]);
export function rayBox(query,box,faceTolerance=0){
  const relative=sub(query.origin,box.center);let enter=0,exit=1,normal=[0,0,0];
  for(let k=0;k<3;k++){
    const axis=box.axes[k],o=dot(relative,axis),d=dot(query.translation,axis),h=box.halfExtents[k];
    if(d===0){if(o< -h||o>h)return null;continue;}
    const a=(-h-o)/d,b=(h-o)/d,near=Math.min(a,b),far=Math.max(a,b);
    if(near>enter){enter=near;normal=axis.map(n=>n*(d>0?-1:1));}
    exit=Math.min(exit,far);if(exit<enter)return null;
  }
  if(enter>1||exit<0)return null;
  const point=query.origin.map((n,k)=>n+enter*query.translation[k]),normals=[normal];
  if(enter>0&&faceTolerance>0){
    const relativePoint=sub(point,box.center);
    for(let k=0;k<3;k++)for(const sign of [-1,1]){
      const face=box.axes[k].map(n=>n*sign);
      if(dot(query.translation,face)<0&&Math.abs(dot(relativePoint,box.axes[k])-sign*box.halfExtents[k])<=faceTolerance&&
        !normals.some(n=>n.every((v,i)=>v===face[i])))normals.push(face);
    }
  }
  return {token:box.token,fraction:enter,normal,normals,point};
}
export function sphereBox(query,box,tolerance=0){
  const d=sub(query.origin,box.center);let distance=0;
  for(let k=0;k<3;k++){const outside=Math.max(0,Math.abs(dot(d,box.axes[k]))-box.halfExtents[k]);distance+=outside*outside;}
  return tolerance===0?distance<=query.radius**2:Math.sqrt(distance)-query.radius<tolerance;
}
/** Separating-axis theorem for an axis-aligned query box and oriented target.
 * Separating axes: 3 query axes, 3 target axes and their 9 cross products.
 */
export function boxBox(query,box,tolerance=0){
  const d=sub(box.center,query.origin),a=query.halfExtents,b=box.halfExtents,R=box.axes;
  let separation=0;
  for(let k=0;k<3;k++)separation=Math.max(separation,Math.abs(d[k])-a[k]-b.reduce((sum,h,j)=>sum+h*Math.abs(R[j][k]),0));
  for(let j=0;j<3;j++)separation=Math.max(separation,Math.abs(dot(d,R[j]))-b[j]-a.reduce((sum,h,k)=>sum+h*Math.abs(R[j][k]),0));
  if(separation>tolerance)return false;
  for(let k=0;k<3;k++)for(let j=0;j<3;j++){
    const axis=k===0?[0,-R[j][2],R[j][1]]:k===1?[R[j][2],0,-R[j][0]]:[-R[j][1],R[j][0],0];
    const length=Math.hypot(...axis);if(length===0)continue;
    separation=Math.max(separation,(Math.abs(dot(d,axis))-a.reduce((sum,h,i)=>sum+h*Math.abs(axis[i]),0)-b.reduce((sum,h,i)=>sum+h*Math.abs(dot(R[i],axis)),0))/length);
    if(separation>tolerance)return false;
  }
  if(separation<=0)return true;
  // Within the SDK's tiny overlap slop: SAT supplies a lower bound, not the
  // Euclidean distance at a corner. Resolve using vertex/face and edge pairs.
  const first={center:query.origin,halfExtents:a,axes:[[1,0,0],[0,1,0],[0,0,1]]};
  const vertices=b=>Array.from({length:8},(_,i)=>b.center.map((n,k)=>n+b.axes.reduce((s,v,j)=>s+v[k]*b.halfExtents[j]*(i&(1<<j)?1:-1),0)));
  const av=vertices(first),bv=vertices(box);
  const pointDistance=(p,b)=>{const d=sub(p,b.center);return b.axes.reduce((s,axis,k)=>s+Math.max(0,Math.abs(dot(d,axis))-b.halfExtents[k])**2,0);};
  let distance=Math.min(...av.map(v=>pointDistance(v,box)),...bv.map(v=>pointDistance(v,first)));
  const edges=v=>v.flatMap((p,i)=>[0,1,2].filter(k=>!(i&(1<<k))).map(k=>[p,v[i|(1<<k)]]));
  for(const [a0,a1] of edges(av))for(const [b0,b1] of edges(bv))distance=Math.min(distance,segmentDistance(a0,a1,b0,b1));
  return Math.sqrt(distance)<tolerance;
}
function segmentDistance(a0,a1,b0,b1){
  const u=sub(a1,a0),v=sub(b1,b0),w=sub(a0,b0),aa=dot(u,u),bb=dot(u,v),cc=dot(v,v),dd=dot(u,w),ee=dot(v,w),denom=aa*cc-bb*bb;
  const clamp=n=>Math.min(1,Math.max(0,n));
  let s=denom>1e-20?clamp((bb*ee-cc*dd)/denom):0,t=(bb*s+ee)/cc;
  if(t<0){t=0;s=clamp(-dd/aa);}else if(t>1){t=1;s=clamp((bb-dd)/aa);}
  return w.reduce((sum,n,k)=>sum+(n+s*u[k]-t*v[k])**2,0);
}
export function referenceQuery(query,boxes,overlapTolerance=0,faceTolerance=0){
  if(query.kind==='ray')return boxes.map(b=>rayBox(query,b,faceTolerance)).filter(Boolean).sort((a,b)=>a.fraction-b.fraction||(a.token<b.token?-1:1));
  const intersects=query.kind==='sphere-overlap'?sphereBox:boxBox;
  return boxes.filter(b=>intersects(query,b,overlapTolerance)).map(b=>({token:b.token})).sort((a,b)=>a.token<b.token?-1:1);
}
