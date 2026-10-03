/** Shared dimensions for visible canopy load-bearing hardware and contact proxies.
 * Beveled boxes use their enclosing box for collision; small bolts/rings/threads
 * remain decoration. This is authored scene geometry, not an engineering rating.
 */
import type {SurfaceTriangle,SurfaceVec} from '../engine/surface-contact.ts';
type Vec=SurfaceVec;
export type CanopyRigPart = {kind:'box';size:Vec;center:Vec;material:string;bevel:number;name:string} |
  {kind:'rod';a:Vec;b:Vec;radius:number;material:string;name:string};
export interface CanopyCorner {sx:number;sz:number;x:number;z:number;y:number;a:Vec;b:Vec;parts:CanopyRigPart[]}
export function canopyRig(span:number,depth:number,supportY:number):CanopyCorner[]{
  const corners:CanopyCorner[]=[];
  for(const sx of [-1,1])for(const sz of [-1,1]){
    const x=sx*(span/2+.65),z=sz*(depth/2+.65),y=supportY+.23,a:Vec=[sx*span/2,supportY,sz*depth/2],b:Vec=[x,y+.18,z];
    const parts:CanopyRigPart[]=[],box=(name:string,size:Vec,center:Vec,material='steel',bevel=0)=>parts.push({kind:'box',name,size,center,material,bevel});
    box('base plate',[.85,.13,.85],[x,.075,z],'steel',.045);
    const base=.14,height=y-base,width=.22;
    box('column cap',[width,.07,width],[x,base+height,z]);
    for(const dx of [-width*.5,width*.5])box('column flange',[.055,height,width],[x+dx,base+height/2,z]);
    box('column web',[width,height,.055],[x,base+height/2,z]);
    box('top plate',[.42,.1,.42],[x,y,z],'chrome',.022);
    parts.push({kind:'rod',name:'corner tie',a,b,radius:.025,material:'chrome'});
    const mid:Vec=[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
    parts.push({kind:'rod',name:'threaded turnbuckle',a:[mid[0]-.09*sx,mid[1]-.025,mid[2]-.09*sz],b:[mid[0]+.09*sx,mid[1]+.025,mid[2]+.09*sz],radius:.065,material:'chrome'});
    for(const side of [-1,1])box('clevis plate',[.055,.25,.18],[x+side*.09,y+.16,z],'steel',.015);
    corners.push({sx,sz,x,z,y,a,b,parts});
  }
  return corners;
}
export function canopyRigSurface(corners:readonly CanopyCorner[]):{positions:Vec[];triangles:SurfaceTriangle[]}{
  const positions:Vec[]=[],triangles:SurfaceTriangle[]=[];
  for(const {parts} of corners)for(const part of parts){
    const offset=positions.length;
    if(part.kind==='box'){
      for(const z of [-1,1])for(const y of [-1,1])for(const x of [-1,1])positions.push([part.center[0]+x*part.size[0]/2,part.center[1]+y*part.size[1]/2,part.center[2]+z*part.size[2]/2]);
      for(const f of [[0,2,3,1],[4,5,7,6],[0,1,5,4],[2,6,7,3],[0,4,6,2],[1,3,7,5]]){
        triangles.push([offset+f[0],offset+f[1],offset+f[2]],[offset+f[0],offset+f[2],offset+f[3]]);
      }
    }else{
      // Match CylinderGeometry's 12-sided Y-axis cylinder and UP-to-axis rotation.
      const dx=part.b[0]-part.a[0],dy=part.b[1]-part.a[1],dz=part.b[2]-part.a[2],length=Math.hypot(dx,dy,dz);
      const axis:Vec=[dx/length,dy/length,dz/length],qw=Math.sqrt((1+axis[1])/2),qx=axis[2]/(2*qw),qz=-axis[0]/(2*qw);
      const rotate=(x:number,y:number,z:number):Vec=>{
        const tx=-2*qz*y,ty=2*(qz*x-qx*z),tz=2*qx*y;
        return [x+qw*tx-qz*ty,y+qw*ty+qz*tx-qx*tz,z+qw*tz+qx*ty];
      };
      for(const end of [part.a,part.b])for(let i=0;i<12;i++){
        const angle=i*Math.PI/6,r=rotate(Math.sin(angle)*part.radius,0,Math.cos(angle)*part.radius);
        positions.push([end[0]+r[0],end[1]+r[1],end[2]+r[2]]);
      }
      positions.push([...part.a],[...part.b]);
      for(let i=0;i<12;i++){
        const j=(i+1)%12;
        triangles.push([offset+i,offset+j,offset+12+j],[offset+i,offset+12+j,offset+12+i],[offset+24,offset+j,offset+i],[offset+25,offset+12+i,offset+12+j]);
      }
    }
  }
  return {positions,triangles};
}
