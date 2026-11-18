// Independent static intersection oracle: Three.js segment/triangle intersections
// plus 2D polygon clipping for coplanar area overlap. No engine closest/sweep code.
import {Vector3,Ray} from 'three';
const cross2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
function coplanarArea(a,b,normal){
 const axis=[0,1,2].sort((x,y)=>Math.abs(normal.getComponent(y))-Math.abs(normal.getComponent(x)))[0],axes=[0,1,2].filter(k=>k!==axis);
 const project=p=>axes.map(k=>p.getComponent(k)),clip=b.map(project);let polygon=a.map(project);
 const winding=Math.sign(cross2(...clip));if(!winding)return 0;
 for(let i=0;i<3&&polygon.length;i++){
  const p=clip[i],q=clip[(i+1)%3],next=[];
  for(let j=0;j<polygon.length;j++){
   const a=polygon[j],b=polygon[(j+1)%polygon.length],da=winding*cross2(p,q,a),db=winding*cross2(p,q,b),insideA=da>=0,insideB=db>=0;
   if(insideA)next.push(a);if(insideA!==insideB){const t=da/(da-db);next.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]);}
  }
  polygon=next;
 }
 let area=0;for(let i=0;i<polygon.length;i++){const a=polygon[i],b=polygon[(i+1)%polygon.length];area+=a[0]*b[1]-a[1]*b[0];}return Math.abs(area)/2;
}
export function surfaceIntersections(positions,triangles,dynamicCount=positions.length,anchors=[],attachmentRadius=0){
 const vertices=positions.map(p=>new Vector3(...p)),features=triangles.map((ids,id)=>{
  const points=ids.map(i=>vertices[i]);return {id,ids,points,dynamic:ids.some(i=>i<dynamicCount),lo:[0,1,2].map(k=>Math.min(...points.map(p=>p.getComponent(k)))),hi:[0,1,2].map(k=>Math.max(...points.map(p=>p.getComponent(k))))};
 }).sort((a,b)=>a.lo[0]-b.lo[0]||a.id-b.id);
 const ray=new Ray(),direction=new Vector3(),hit=new Vector3(),na=new Vector3(),nb=new Vector3(),tmp=new Vector3(),result=[];
 const attached=(point,a,b)=>a.dynamic!==b.dynamic&&anchors.some(p=>point.distanceToSquared(new Vector3(...p))<attachmentRadius**2);
 for(let i=0;i<features.length;i++){
  const a=features[i];for(let j=i+1;j<features.length&&features[j].lo[0]<=a.hi[0]+1e-9;j++){
   const b=features[j];if(!a.dynamic&&!b.dynamic||a.lo[1]>b.hi[1]+1e-9||b.lo[1]>a.hi[1]+1e-9||a.lo[2]>b.hi[2]+1e-9||b.lo[2]>a.hi[2]+1e-9)continue;
   let found=false;
   for(const [edge,face] of [[a,b],[b,a]])for(let k=0;k<3&&!found;k++){
    // A mesh edge belonging to both faces is their intended seam. Near-parallel
    // ray arithmetic can choose arbitrary points along that shared segment.
    if(face.ids.includes(edge.ids[k])&&face.ids.includes(edge.ids[(k+1)%3]))continue;
    const origin=edge.points[k],end=edge.points[(k+1)%3],length=direction.subVectors(end,origin).length();if(length<1e-12)continue;
    ray.set(origin,direction.divideScalar(length));
    if(!ray.intersectTriangle(...face.points,false,hit)||hit.distanceToSquared(origin)>length*length+1e-12)continue;
    if(a.ids.some(id=>b.ids.includes(id)&&hit.distanceToSquared(vertices[id])<1e-14)||attached(hit,a,b))continue;
    result.push({a:a.id,b:b.id,kind:'crossing',point:hit.toArray()});found=true;
   }
   if(found)continue;
   na.crossVectors(tmp.subVectors(a.points[1],a.points[0]),direction.subVectors(a.points[2],a.points[0]));
   nb.crossVectors(tmp.subVectors(b.points[1],b.points[0]),direction.subVectors(b.points[2],b.points[0]));
   if(na.lengthSq()<1e-20||nb.lengthSq()<1e-20)continue;na.normalize();nb.normalize();
   if(Math.abs(na.dot(nb))<1-1e-10||Math.abs(na.dot(tmp.subVectors(b.points[0],a.points[0])))>1e-9)continue;
   const area=coplanarArea(a.points,b.points,na);
   if(area>1e-9){hit.copy(a.points[0]).add(a.points[1]).add(a.points[2]).divideScalar(3);if(!attached(hit,a,b))result.push({a:a.id,b:b.id,kind:'coplanar-overlap',area});}
  }
 }
 return result;
}
