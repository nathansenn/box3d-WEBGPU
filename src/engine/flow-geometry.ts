/**
 * Geometry of a flow study: oriented primitives and triangle meshes, turned into a signed distance on a uniform grid
 * of cubic cells. SI units. Deterministic (fixed loop orders; +, -, *, /, sqrt).
 *
 * An item is a solid (the default) or a cavity. With cavities the solid is everything outside their union, plus the
 * solid items: a pipe is a cylinder with `role: 'cavity'`, a tank a box, a valve disc a solid inside them.
 *
 *   distance(x) = min( min over solids d_s(x),  - min over cavities d_c(x) )      positive in the fluid
 *
 * Primitives have exact distances. A mesh is welded and split into connected components; each closed component is
 * signed by ray parity along the three axes through every cell centre with a majority vote (so a ray that slips through
 * a crack or grazes an edge is outvoted, and the orientation of the triangles does not matter), and the distance to its
 * triangles is exact within a band of `band` cells. An open component is a thin shell with the stated `thickness`.
 *
 * Walls do not leak. A lattice link (to the 6 face and 12 edge neighbours) that crosses a wall has an end within
 * sqrt(2)/2 = 0.71 cells of it, so a sheet at least THIN_CELLS = 1.44 cells thick blocks every link. A plate-like
 * primitive (thin in one direction: a panel, a disc, a pipe wall) or an open mesh thinner than that is grown to 1.44
 * cells about its mid-surface; in a closed mesh, every link that crosses the surface between two fluid cells gets
 * the end nearer to the surface made solid. What was grown, and by how much, is in the report. Slender things (thin
 * in two directions: a rod, a cable) are not walls and are left as they fall on the grid.
 *
 * The report says what the grid did to the geometry: for every item the smallest dimension that is known, what was
 * added to it, and the fraction of its surface with no cell of its own within 1.25 cells.
 */
import {EngineError} from './contracts.ts';

/** A point or vector [x, y, z], metres in SI frames. */
export type FlowVec3=readonly [number,number,number];
/** Quaternion x, y, z, w. */
export type FlowQuat=readonly [number,number,number,number];

/** The thinnest wall the lattice is certain to see, in cells (see the header). */
export const FLOW_THIN_CELLS=1.44;
interface ItemBase {
  /** Carried to the report unchanged (the id of the element in the model the item came from). */
  readonly id?:string|number;
  /** Name of the part this item belongs to; forces and surfaces are reported per part. Default 'body'. */
  readonly part?:string;
  /** 'solid' (default) or 'cavity': a cavity is fluid, and makes everything outside the cavities solid. */
  readonly role?:'solid'|'cavity';
}
/** An axis either by its end points, or by centre, half length and rotation (the axis is the local Y). */
interface AxisPlacement {
  readonly from?:FlowVec3;readonly to?:FlowVec3;
  /** With `center`: `halfLength`, or the full `length`, along the local +Y. */
  readonly center?:FlowVec3;readonly halfLength?:number;readonly length?:number;readonly rotation?:FlowQuat;
}
/** A box: `halfExtents`, or the full `size`, along its local x, y, z. */
export interface FlowBox extends ItemBase {readonly kind:'box';readonly center:FlowVec3;readonly halfExtents?:FlowVec3;readonly size?:FlowVec3;readonly rotation?:FlowQuat}
/** A sphere: centre and radius. */
export interface FlowSphere extends ItemBase {readonly kind:'sphere';readonly center:FlowVec3;readonly radius:number}
/** A flat-ended cylinder along its axis (from and to, or centre, rotation and full length along local +y). */
export interface FlowCylinder extends ItemBase,AxisPlacement {readonly kind:'cylinder';readonly radius:number}
/** A capsule: a segment (from and to, or centre, rotation and full length along local +y) swept by a sphere of `radius`. */
export interface FlowCapsule extends ItemBase,AxisPlacement {readonly kind:'capsule';readonly radius:number}
/** A cone frustum: `radius` at `from` (the -Y end), `radiusTop` at `to`. */
export interface FlowCone extends ItemBase,AxisPlacement {readonly kind:'cone';readonly radius:number;readonly radiusTop:number}
/** A pipe wall: the solid between `innerRadius` and `radius`, open at both ends. */
export interface FlowTube extends ItemBase,AxisPlacement {readonly kind:'tube';readonly radius:number;readonly innerRadius:number}
/** A straight member from `from` to `to`. `depth` is measured along `up`, `width` across. An I section has two flanges
 * of thickness `flange` and a web of thickness `web`. */
export interface FlowBeam extends ItemBase {
  readonly kind:'beam';readonly from:FlowVec3;readonly to:FlowVec3;readonly up?:FlowVec3;
  readonly section?:'rect'|'i';readonly width:number;readonly depth:number;readonly flange?:number;readonly web?:number;
}
/** A triangle mesh: closed components are solids, open ones surfaces of a thickness; `elements` give per-run flags. */
export interface FlowMesh extends ItemBase {
  readonly kind:'mesh';
  /** x, y, z per vertex. */
  readonly positions:ArrayLike<number>;
  /** Three vertex indices per triangle; without it every three vertices are a triangle. */
  readonly indices?:ArrayLike<number>;
  /** For an open surface (a panel, a sheet): its thickness; 0 for a surface without one. A closed component ignores it. */
  readonly thickness?:number;
  readonly position?:FlowVec3;readonly rotation?:FlowQuat;readonly scale?:number|FlowVec3;
  /** Runs of triangles that came from one model element, each closed (a solid, signed by ray parity) or open (a thin
   * surface of the given thickness, 0 for none: it becomes a shell grown to the thinnest wall the lattice sees).
   * Triangles in no run take the mesh's own `thickness`. Same layout as an `apex-flow-geometry/1` mesh. */
  readonly elements?:readonly FlowMeshElement[];
}
/** A run of triangles of one model element, closed (a solid) or open (a surface of a thickness). */
export interface FlowMeshElement {
  readonly element?:string|number;
  /** First triangle and number of triangles (three indices each). */
  readonly triStart:number;readonly triCount:number;
  /** true: a closed solid. false: an open surface. */
  readonly closed:boolean;
  /** Thickness of an open surface, metres (0: none given). Ignored for a closed element. */
  readonly thickness?:number;
}
/** Split a mesh with `elements` into one mesh per kind of element (closed, or open of one thickness), so that every
 * triangle is voxelised the way its element says. A mesh without elements is returned as it is. */
function splitElements(item:FlowMesh):FlowMesh[]{
  const els=item.elements;
  if(!els||els.length===0)return [item];
  if(!Array.isArray(els))fail('mesh.elements must be an array.');
  const triangles=item.indices?item.indices.length/3:item.positions.length/9;
  const group=new Int32Array(triangles).fill(-1),keys:(number|undefined)[]=[],keyOf=new Map<string,number>();
  for(let e=0;e<els.length;e++){
    const el=els[e];
    if(!el||typeof el!=='object')fail(`mesh.elements[${e}] must be an object.`);
    if(!Number.isInteger(el.triStart)||!Number.isInteger(el.triCount)||el.triStart<0||el.triCount<0||el.triStart+el.triCount>triangles)fail(`mesh.elements[${e}]: triStart and triCount must lie within the ${triangles} triangles.`);
    if(typeof el.closed!=='boolean')fail(`mesh.elements[${e}].closed must be true or false.`);
    const t=el.closed?undefined:(el.thickness??0);
    if(t!==undefined&&(!(t>=0)||!Number.isFinite(t)))fail(`mesh.elements[${e}].thickness must not be negative.`);
    const key=t===undefined?'closed':`open ${t}`;
    let g=keyOf.get(key);if(g===undefined){g=keys.length;keys.push(t);keyOf.set(key,g);}
    for(let f=el.triStart;f<el.triStart+el.triCount;f++)group[f]=g;
  }
  const out:FlowMesh[]=[],{elements:_e,...rest}=item;void _e;
  const indexOf=(f:number,k:number):number=>item.indices?item.indices[3*f+k]:3*f+k;
  for(let g=-1;g<keys.length;g++){
    const idx:number[]=[];
    for(let f=0;f<triangles;f++)if(group[f]===g)idx.push(indexOf(f,0),indexOf(f,1),indexOf(f,2));
    if(idx.length===0)continue;
    out.push(g<0?{...rest,indices:idx}:{...rest,indices:idx,thickness:keys[g]});
  }
  return out;
}
/** Any primitive item of the geometry. */
export type FlowPrimitive=FlowBox|FlowSphere|FlowCylinder|FlowCapsule|FlowCone|FlowTube|FlowBeam;
/** An item of the geometry: a primitive or a mesh, solid or cavity. */
export type FlowItem=FlowPrimitive|FlowMesh;

/** A box of cubic cells: origin (its minimum corner), cell size and cell counts. */
export interface FlowGrid {readonly origin:FlowVec3;readonly cell:number;readonly nx:number;readonly ny:number;readonly nz:number}
/** What the grid did to one item: its smallest dimension, what was added so that it does not leak, its surface and how much of it is unresolved. */
export interface FlowItemReport {
  readonly index:number;readonly id?:string|number;readonly kind:string;readonly part:string;readonly role:'solid'|'cavity';
  /** Metres added to the thin dimension of a plate-like item so that it does not leak (0: nothing), and for a closed
   * mesh the number of cells made solid to close links that crossed its surface. */
  readonly thickened:number;readonly thickenedCells?:number;
  /** Smallest dimension of the item when it is known from its definition (a wall thickness, a diameter), metres. */
  readonly smallestDimension:number|null;
  /** Triangles of a mesh; components and how many of them are closed. */
  readonly triangles?:number;readonly components?:number;readonly closedComponents?:number;
  /** Area of the item's surface inside the grid, and the fraction of it with no cell of the item within 1.25 cells. */
  readonly surfaceArea:number;readonly unresolvedFraction:number;
}
/** The voxelised geometry: signed distance per cell, the part of each cell, the report and the warnings. */
export interface FlowVoxels {
  readonly grid:FlowGrid;
  /** Signed distance to the solid at the cell centres, metres, positive in the fluid, limited to +-band cells. */
  readonly distance:Float32Array;
  /** Index into `parts` of the nearest item, per cell; -1 where no item is within the band. */
  readonly part:Int16Array;
  readonly parts:readonly string[];
  readonly band:number;
  readonly items:readonly FlowItemReport[];
  readonly warnings:readonly string[];
  readonly solidCells:number;
}
/** Triangles of the surface of one part, for sampling and drawing. */
export interface FlowSurface {readonly part:string;readonly positions:Float32Array;readonly indices:Uint32Array}

const fail=(message:string):never=>{throw new EngineError('INVALID_ARGUMENT',`flow geometry: ${message}`);};
const finite3=(v:unknown,name:string):FlowVec3=>{
  if(!Array.isArray(v)&&!ArrayBuffer.isView(v))fail(`${name} must be [x, y, z].`);
  const a=v as ArrayLike<number>;
  if(a.length!==3||!Number.isFinite(a[0])||!Number.isFinite(a[1])||!Number.isFinite(a[2]))fail(`${name} must be three finite numbers.`);
  return [a[0],a[1],a[2]];
};
const positive=(v:unknown,name:string):number=>{if(typeof v!=='number'||!(v>0)||!Number.isFinite(v))fail(`${name} must be a positive number.`);return v as number;};

/** Rotation matrix (rows) of a unit quaternion; the identity without one. */
function matrixOf(q:FlowQuat|undefined):number[]{
  if(!q)return [1,0,0,0,1,0,0,0,1];
  if(q.length!==4||![q[0],q[1],q[2],q[3]].every(Number.isFinite))fail('rotation must be a quaternion [x, y, z, w].');
  const n=Math.sqrt(q[0]*q[0]+q[1]*q[1]+q[2]*q[2]+q[3]*q[3]);
  if(!(n>0))fail('rotation must not be the zero quaternion.');
  const x=q[0]/n,y=q[1]/n,z=q[2]/n,w=q[3]/n;
  return [1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w),2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w),2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)];
}
/** A frame whose Y axis runs from `from` to `to`: returns the matrix (columns are the local axes), centre and half length. */
function axisFrame(item:AxisPlacement&{kind:string},up?:FlowVec3):{m:number[];c:FlowVec3;h:number}{
  if(item.from!==undefined||item.to!==undefined){
    const a=finite3(item.from,`${item.kind}.from`),b=finite3(item.to,`${item.kind}.to`);
    const dx=b[0]-a[0],dy=b[1]-a[1],dz=b[2]-a[2],len=Math.sqrt(dx*dx+dy*dy+dz*dz);
    if(!(len>0))fail(`${item.kind}: from and to coincide.`);
    const yx=dx/len,yy=dy/len,yz=dz/len;
    // local Z: the given up direction made perpendicular to the axis, or the world axis least aligned with it
    let ux:number,uy:number,uz:number;
    if(up){ux=up[0];uy=up[1];uz=up[2];}else if(Math.abs(yy)<0.9){ux=0;uy=1;uz=0;}else{ux=1;uy=0;uz=0;}
    const d=ux*yx+uy*yy+uz*yz;ux-=d*yx;uy-=d*yy;uz-=d*yz;
    const ul=Math.sqrt(ux*ux+uy*uy+uz*uz);
    if(!(ul>1e-9))fail(`${item.kind}: up is parallel to the axis.`);
    ux/=ul;uy/=ul;uz/=ul;
    // local X = Y x Z
    const xx=yy*uz-yz*uy,xy=yz*ux-yx*uz,xz=yx*uy-yy*ux;
    return {m:[xx,yx,ux,xy,yy,uy,xz,yz,uz],c:[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],h:len/2};
  }
  if((item.halfLength===undefined)===(item.length===undefined))fail(`${item.kind}: give from and to, or center with exactly one of halfLength and length.`);
  return {m:matrixOf(item.rotation),c:finite3(item.center,`${item.kind}.center`),h:item.length!==undefined?positive(item.length,`${item.kind}.length`)/2:positive(item.halfLength,`${item.kind}.halfLength`)};
}

/** One oriented convex-ish piece with an exact distance in its local frame. */
interface Piece {
  readonly m:number[];readonly c:FlowVec3;
  /** Signed distance at a point of the local frame. */
  readonly d:(x:number,y:number,z:number)=>number;
  /** Radius of a sphere about `c` that holds the piece. */
  readonly reach:number;
  /** Thickness when the piece is plate-like (thin in one direction only), else Infinity; `across` is its next dimension. */
  readonly sheet:number;readonly across:number;
}
/** Half extents of a box item: `halfExtents`, or half of `size`. */
function boxHalf(item:FlowBox):FlowVec3{
  if((item.halfExtents===undefined)===(item.size===undefined))fail('box: give exactly one of halfExtents and size (the full extents).');
  const h=item.size!==undefined?finite3(item.size,'box.size').map(v=>v/2) as unknown as FlowVec3:finite3(item.halfExtents,'box.halfExtents');
  if(!(h[0]>0&&h[1]>0&&h[2]>0))fail('box: the extents must be positive.');
  return h;
}
/** Sheet thickness and next dimension of a box with these full sizes. */
const boxSheet=(a:number,b:number,c:number):{sheet:number;across:number}=>{const d=[a,b,c].sort((x,y)=>x-y);return {sheet:d[0],across:d[1]};};
const boxDistance=(hx:number,hy:number,hz:number)=>(x:number,y:number,z:number):number=>{
  const qx=Math.abs(x)-hx,qy=Math.abs(y)-hy,qz=Math.abs(z)-hz;
  const ox=qx>0?qx:0,oy=qy>0?qy:0,oz=qz>0?qz:0,inside=Math.max(qx,qy,qz);
  return Math.sqrt(ox*ox+oy*oy+oz*oz)+(inside<0?inside:0);
};
/** Distance to a solid of revolution about the local Y whose half profile is the convex polygon `poly` in (r, y). */
const revolved=(poly:readonly (readonly [number,number])[])=>(x:number,y:number,z:number):number=>{
  const r=Math.sqrt(x*x+z*z);let best=Infinity,inside=true;
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],ex=b[0]-a[0],ey=b[1]-a[1],px=r-a[0],py=y-a[1];
    if(a[0]===0&&b[0]===0)continue; // the edge on the axis is not a surface
    const ee=ex*ex+ey*ey;let t=ee>0?(px*ex+py*ey)/ee:0;t=t<0?0:t>1?1:t;
    const qx=px-t*ex,qy=py-t*ey,dd=qx*qx+qy*qy;if(dd<best)best=dd;
    // counter-clockwise polygon: inside is to the left of every edge
    if(ex*py-ey*px<0)inside=false;
  }
  return inside?-Math.sqrt(best):Math.sqrt(best);
};
function piecesOf(item:FlowPrimitive):{pieces:Piece[];smallest:number}{
  switch(item.kind){
    case 'box':{
      const h=boxHalf(item);
      return {pieces:[{m:matrixOf(item.rotation),c:finite3(item.center,'box.center'),d:boxDistance(h[0],h[1],h[2]),reach:Math.hypot(h[0],h[1],h[2]),...boxSheet(2*h[0],2*h[1],2*h[2])}],smallest:2*Math.min(h[0],h[1],h[2])};
    }
    case 'sphere':{
      const r=positive(item.radius,'sphere.radius');
      return {pieces:[{m:matrixOf(undefined),c:finite3(item.center,'sphere.center'),d:(x,y,z)=>Math.sqrt(x*x+y*y+z*z)-r,reach:r,sheet:Infinity,across:2*r}],smallest:2*r};
    }
    case 'cylinder':{
      const r=positive(item.radius,'cylinder.radius'),f=axisFrame(item);
      return {pieces:[{m:f.m,c:f.c,d:revolved([[0,-f.h],[r,-f.h],[r,f.h],[0,f.h]]),reach:Math.hypot(r,f.h),sheet:2*f.h<2*r?2*f.h:Infinity,across:2*r}],smallest:Math.min(2*r,2*f.h)};
    }
    case 'capsule':{
      const r=positive(item.radius,'capsule.radius'),f=axisFrame(item),h=f.h;
      return {pieces:[{m:f.m,c:f.c,d:(x,y,z)=>{const t=y<-h?-h:y>h?h:y,dy=y-t;return Math.sqrt(x*x+dy*dy+z*z)-r;},reach:r+h,sheet:Infinity,across:2*r}],smallest:2*r};
    }
    case 'cone':{
      const r0=item.radius,r1=item.radiusTop,f=axisFrame(item);
      if(!(r0>=0&&r1>=0&&r0+r1>0)||!Number.isFinite(r0+r1))fail('cone: radius and radiusTop must not be negative, and not both zero.');
      const poly:[number,number][]=[[0,-f.h]];if(r0>0)poly.push([r0,-f.h]);if(r1>0)poly.push([r1,f.h]);poly.push([0,f.h]);
      return {pieces:[{m:f.m,c:f.c,d:revolved(poly),reach:Math.hypot(Math.max(r0,r1),f.h),sheet:2*f.h<2*Math.max(r0,r1)?2*f.h:Infinity,across:2*Math.max(r0,r1)}],smallest:Math.min(2*Math.max(r0,r1),2*f.h)};
    }
    case 'tube':{
      const r=positive(item.radius,'tube.radius'),ri=positive(item.innerRadius,'tube.innerRadius'),f=axisFrame(item);
      if(!(ri<r))fail('tube.innerRadius must be below radius.');
      return {pieces:[{m:f.m,c:f.c,d:revolved([[ri,-f.h],[r,-f.h],[r,f.h],[ri,f.h]]),reach:Math.hypot(r,f.h),sheet:Math.min(r-ri,2*f.h),across:Math.min(2*r,Math.max(r-ri,2*f.h))}],smallest:Math.min(r-ri,2*f.h)};
    }
    case 'beam':{
      const w=positive(item.width,'beam.width'),dp=positive(item.depth,'beam.depth');
      const f=axisFrame({kind:'beam',from:item.from,to:item.to},item.up?finite3(item.up,'beam.up'):undefined);
      // local frame: X across (width), Y along the member, Z along up (depth)
      if((item.section??'rect')==='rect')return {pieces:[{m:f.m,c:f.c,d:boxDistance(w/2,f.h,dp/2),reach:Math.hypot(w/2,f.h,dp/2),...boxSheet(w,2*f.h,dp)}],smallest:Math.min(w,dp)};
      const tf=positive(item.flange,'beam.flange'),tw=positive(item.web,'beam.web');
      if(!(2*tf<dp)||!(tw<=w))fail('beam: the flanges must fit in the depth and the web in the width.');
      const off=(z:number):FlowVec3=>[f.c[0]+f.m[2]*z,f.c[1]+f.m[5]*z,f.c[2]+f.m[8]*z];
      const reach=Math.hypot(w/2,f.h,tf/2);
      return {pieces:[
        {m:f.m,c:off((dp-tf)/2),d:boxDistance(w/2,f.h,tf/2),reach,...boxSheet(w,2*f.h,tf)},
        {m:f.m,c:off(-(dp-tf)/2),d:boxDistance(w/2,f.h,tf/2),reach,...boxSheet(w,2*f.h,tf)},
        {m:f.m,c:f.c,d:boxDistance(tw/2,f.h,dp/2-tf),reach:Math.hypot(tw/2,f.h,dp/2),...boxSheet(tw,2*f.h,dp-2*tf)},
      ],smallest:Math.min(tf,tw)};
    }
    default:return fail(`unknown primitive kind "${(item as {kind:string}).kind}".`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Meshes
// ---------------------------------------------------------------------------------------------------------------------
interface PreparedMesh {positions:Float64Array;indices:Uint32Array;component:Int32Array;componentCount:number;closed:boolean[]}
function prepareMesh(item:FlowMesh,topology:boolean):PreparedMesh{
  const src=item.positions;
  if(!src||src.length<9||src.length%3!==0)fail('mesh.positions must hold x, y, z per vertex, at least three vertices.');
  const vertexCount=src.length/3,m=matrixOf(item.rotation),t=item.position?finite3(item.position,'mesh.position'):[0,0,0];
  const sc=item.scale===undefined?[1,1,1]:typeof item.scale==='number'?[item.scale,item.scale,item.scale]:finite3(item.scale,'mesh.scale');
  const positions=new Float64Array(src.length);
  for(let v=0;v<vertexCount;v++){
    const x=src[3*v]*sc[0],y=src[3*v+1]*sc[1],z=src[3*v+2]*sc[2];
    if(!Number.isFinite(x+y+z))fail(`mesh vertex ${v} is not finite.`);
    positions[3*v]=m[0]*x+m[1]*y+m[2]*z+t[0];positions[3*v+1]=m[3]*x+m[4]*y+m[5]*z+t[1];positions[3*v+2]=m[6]*x+m[7]*y+m[8]*z+t[2];
  }
  let indices:Uint32Array;
  if(item.indices){
    if(item.indices.length%3!==0)fail('mesh.indices must hold three indices per triangle.');
    indices=new Uint32Array(item.indices.length);
    for(let i=0;i<indices.length;i++){const v=item.indices[i];if(!Number.isInteger(v)||v<0||v>=vertexCount)fail(`mesh index ${i} is out of range.`);indices[i]=v;}
  }else{
    if(vertexCount%3!==0)fail('a mesh without indices must hold three vertices per triangle.');
    indices=new Uint32Array(vertexCount);for(let i=0;i<vertexCount;i++)indices[i]=i;
  }
  if(indices.length===0)fail('mesh has no triangles.');
  if(!topology)return {positions,indices,component:new Int32Array(0),componentCount:0,closed:[]};
  // weld coincident vertices (1e-6 of the bounding box) so that shared edges are found
  let lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
  for(let v=0;v<vertexCount;v++)for(let a=0;a<3;a++){const p=positions[3*v+a];if(p<lo[a])lo[a]=p;if(p>hi[a])hi[a]=p;}
  const tol=Math.max(hi[0]-lo[0],hi[1]-lo[1],hi[2]-lo[2],1e-30)*1e-6,weld=new Int32Array(vertexCount),seen=new Map<string,number>();
  for(let v=0;v<vertexCount;v++){
    const key=`${Math.round((positions[3*v]-lo[0])/tol)},${Math.round((positions[3*v+1]-lo[1])/tol)},${Math.round((positions[3*v+2]-lo[2])/tol)}`;
    const w=seen.get(key);if(w===undefined){seen.set(key,v);weld[v]=v;}else weld[v]=w;
  }
  // connected components over welded vertices (union-find)
  const parent=new Int32Array(vertexCount);for(let v=0;v<vertexCount;v++)parent[v]=v;
  const find=(v:number):number=>{while(parent[v]!==v){parent[v]=parent[parent[v]];v=parent[v];}return v;};
  const triangles=indices.length/3;
  for(let f=0;f<triangles;f++){const a=find(weld[indices[3*f]]),b=find(weld[indices[3*f+1]]),c=find(weld[indices[3*f+2]]);if(b!==a)parent[b]=a;const c2=find(c);if(c2!==a)parent[c2]=a;}
  const ids=new Map<number,number>(),component=new Int32Array(triangles);
  for(let f=0;f<triangles;f++){const r=find(weld[indices[3*f]]);let id=ids.get(r);if(id===undefined){id=ids.size;ids.set(r,id);}component[f]=id;}
  // a component is closed when every edge is shared by an even number of its triangles
  const edges=new Map<number,number>(),open=new Array<boolean>(ids.size).fill(false);
  for(let f=0;f<triangles;f++)for(let e=0;e<3;e++){
    const a=weld[indices[3*f+e]],b=weld[indices[3*f+(e+1)%3]];if(a===b)continue;
    const key=a<b?a*vertexCount+b:b*vertexCount+a;edges.set(key,(edges.get(key)??0)+1);
  }
  for(let f=0;f<triangles;f++)for(let e=0;e<3;e++){
    const a=weld[indices[3*f+e]],b=weld[indices[3*f+(e+1)%3]];if(a===b)continue;
    if((edges.get(a<b?a*vertexCount+b:b*vertexCount+a)!&1)===1)open[component[f]]=true;
  }
  return {positions,indices,component,componentCount:ids.size,closed:open.map(o=>!o)};
}

/** Squared distance from p to the triangle a b c (Ericson, Real-Time Collision Detection, 5.1.5). */
function triangleDistance2(px:number,py:number,pz:number,ax:number,ay:number,az:number,bx:number,by:number,bz:number,cx:number,cy:number,cz:number):number{
  const abx=bx-ax,aby=by-ay,abz=bz-az,acx=cx-ax,acy=cy-ay,acz=cz-az,apx=px-ax,apy=py-ay,apz=pz-az;
  const d1=abx*apx+aby*apy+abz*apz,d2=acx*apx+acy*apy+acz*apz;
  let qx:number,qy:number,qz:number;
  if(d1<=0&&d2<=0){qx=ax;qy=ay;qz=az;}
  else{
    const bpx=px-bx,bpy=py-by,bpz=pz-bz,d3=abx*bpx+aby*bpy+abz*bpz,d4=acx*bpx+acy*bpy+acz*bpz;
    if(d3>=0&&d4<=d3){qx=bx;qy=by;qz=bz;}
    else{
      const vc=d1*d4-d3*d2;
      if(vc<=0&&d1>=0&&d3<=0){const v=d1/(d1-d3);qx=ax+v*abx;qy=ay+v*aby;qz=az+v*abz;}
      else{
        const cpx=px-cx,cpy=py-cy,cpz=pz-cz,d5=abx*cpx+aby*cpy+abz*cpz,d6=acx*cpx+acy*cpy+acz*cpz;
        if(d6>=0&&d5<=d6){qx=cx;qy=cy;qz=cz;}
        else{
          const vb=d5*d2-d1*d6;
          if(vb<=0&&d2>=0&&d6<=0){const w=d2/(d2-d6);qx=ax+w*acx;qy=ay+w*acy;qz=az+w*acz;}
          else{
            const va=d3*d6-d5*d4;
            if(va<=0&&d4-d3>=0&&d5-d6>=0){const w=(d4-d3)/((d4-d3)+(d5-d6));qx=bx+w*(cx-bx);qy=by+w*(cy-by);qz=bz+w*(cz-bz);}
            else{const dn=1/(va+vb+vc),v=vb*dn,w=vc*dn;qx=ax+abx*v+acx*w;qy=ay+aby*v+acy*w;qz=az+abz*v+acz*w;}
          }
        }
      }
    }
  }
  const dx=px-qx,dy=py-qy,dz=pz-qz;return dx*dx+dy*dy+dz*dz;
}

/** Does the segment p -> p + d cross the triangle a b c? Returns the parameter t in [0, 1], or -1 (Moller & Trumbore). */
function segmentTriangle(px:number,py:number,pz:number,dx:number,dy:number,dz:number,ax:number,ay:number,az:number,bx:number,by:number,bz:number,cx:number,cy:number,cz:number):number{
  const e1x=bx-ax,e1y=by-ay,e1z=bz-az,e2x=cx-ax,e2y=cy-ay,e2z=cz-az;
  const hx=dy*e2z-dz*e2y,hy=dz*e2x-dx*e2z,hz=dx*e2y-dy*e2x,det=e1x*hx+e1y*hy+e1z*hz;
  if(det===0)return -1;
  const inv=1/det,sx=px-ax,sy=py-ay,sz=pz-az,u=(sx*hx+sy*hy+sz*hz)*inv;
  if(u<-1e-9||u>1+1e-9)return -1;
  const qx=sy*e1z-sz*e1y,qy=sz*e1x-sx*e1z,qz=sx*e1y-sy*e1x,v=(dx*qx+dy*qy+dz*qz)*inv;
  if(v<-1e-9||u+v>1+1e-9)return -1;
  const t=(e2x*qx+e2y*qy+e2z*qz)*inv;
  return t>=0&&t<=1?t:-1;
}
// the nine lattice links of a cell towards larger indices (the other nine are the same links seen from the far end)
const LINK_X=[1,0,0,1,1,1,1,0,0],LINK_Y=[0,1,0,1,-1,0,0,1,1],LINK_Z=[0,0,1,0,0,1,-1,1,-1];

/** Signed distance of one mesh, merged into `field` (metres) with `owner` set to `part` where the mesh is nearest. Each
 * connected component is worked in the box of cells around it. Returns the number of cells made solid to close leaks. */
function voxelizeMesh(mesh:PreparedMesh,thickness:number|undefined,grid:FlowGrid,band:number,field:Float32Array,owner:Int16Array,part:number,warnings:string[],label:string):{parityFaces:number[];shellAdded:number}{
  const {nx,ny,cell:h,origin}=grid,reach=band*h,full=[grid.nx,grid.ny,grid.nz],thin=FLOW_THIN_CELLS/2*h;
  const P=mesh.positions,I=mesh.indices,triangles=I.length/3;
  // The rays pass a hair off the cell centres so that vertices and edges on round coordinates are not hit exactly.
  const jitter=[1.3e-7*h,2.1e-7*h,1.7e-7*h];
  const byComponent:number[][]=[];for(let c=0;c<mesh.componentCount;c++)byComponent.push([]);
  for(let f=0;f<triangles;f++)byComponent[mesh.component[f]].push(f);
  let openWithoutThickness=0,shellAdded=0;const parityFaces:number[]=[];
  for(let comp=0;comp<mesh.componentCount;comp++){
    const faces=byComponent[comp],closed=mesh.closed[comp],byParity=closed||thickness===undefined;
    // the box of cells within the band of the component
    const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(const f of faces)for(let e=0;e<3;e++){const v=3*I[3*f+e];for(let a=0;a<3;a++){const p=P[v+a];if(p<lo[a])lo[a]=p;if(p>hi[a])hi[a]=p;}}
    const b0=[0,0,0],n=[0,0,0];let empty=false;
    for(let a=0;a<3;a++){
      const first=Math.max(0,Math.floor((lo[a]-reach-origin[a])/h)),last=Math.min(full[a]-1,Math.floor((hi[a]+reach-origin[a])/h));
      if(last<first)empty=true;b0[a]=first;n[a]=last-first+1;
    }
    if(empty)continue;
    const o=[origin[0]+b0[0]*h,origin[1]+b0[1]*h,origin[2]+b0[2]*h],cells=n[0]*n[1]*n[2],stride=[1,n[0],n[0]*n[1]];
    const unsigned=new Float32Array(cells).fill(reach),votes=new Uint8Array(cells),parity=new Uint8Array(cells);
    for(let axis=0;axis<(byParity?3:0);axis++){
      const u=(axis+1)%3,v=(axis+2)%3;parity.fill(0);
      for(const f of faces){
        const a=3*I[3*f],b=3*I[3*f+1],c=3*I[3*f+2];
        const au=P[a+u],av=P[a+v],bu=P[b+u],bv=P[b+v],cu=P[c+u],cv=P[c+v];
        const area=(bu-au)*(cv-av)-(bv-av)*(cu-au);if(area===0)continue;
        const u0=Math.max(0,Math.ceil((Math.min(au,bu,cu)-o[u]-jitter[u])/h-0.5)),u1=Math.min(n[u]-1,Math.floor((Math.max(au,bu,cu)-o[u]-jitter[u])/h-0.5));
        const v0=Math.max(0,Math.ceil((Math.min(av,bv,cv)-o[v]-jitter[v])/h-0.5)),v1=Math.min(n[v]-1,Math.floor((Math.max(av,bv,cv)-o[v]-jitter[v])/h-0.5));
        for(let jv=v0;jv<=v1;jv++){
          const pv=o[v]+(jv+0.5)*h+jitter[v];
          for(let ju=u0;ju<=u1;ju++){
            const pu=o[u]+(ju+0.5)*h+jitter[u];
            // barycentric coordinates of the ray in the projected triangle
            const w0=((bu-pu)*(cv-pv)-(bv-pv)*(cu-pu))/area,w1=((cu-pu)*(av-pv)-(cv-pv)*(au-pu))/area,w2=1-w0-w1;
            if(w0<0||w1<0||w2<0)continue;
            const t=w0*P[a+axis]+w1*P[b+axis]+w2*P[c+axis];
            // every cell centre beyond the crossing changes side
            let first=Math.ceil((t-o[axis])/h-0.5);if(first<0)first=0;
            const base=ju*stride[u]+jv*stride[v];
            for(let m=first;m<n[axis];m++)parity[base+m*stride[axis]]^=1;
          }
        }
      }
      for(let c=0;c<cells;c++)votes[c]+=parity[c];
    }
    // exact distance within the band
    for(const f of faces){
      const a=3*I[3*f],b=3*I[3*f+1],c=3*I[3*f+2];
      const ax=P[a],ay=P[a+1],az=P[a+2],bx=P[b],by=P[b+1],bz=P[b+2],cx=P[c],cy=P[c+1],cz=P[c+2];
      const i0=Math.max(0,Math.floor((Math.min(ax,bx,cx)-reach-o[0])/h)),i1=Math.min(n[0]-1,Math.floor((Math.max(ax,bx,cx)+reach-o[0])/h));
      const j0=Math.max(0,Math.floor((Math.min(ay,by,cy)-reach-o[1])/h)),j1=Math.min(n[1]-1,Math.floor((Math.max(ay,by,cy)+reach-o[1])/h));
      const k0=Math.max(0,Math.floor((Math.min(az,bz,cz)-reach-o[2])/h)),k1=Math.min(n[2]-1,Math.floor((Math.max(az,bz,cz)+reach-o[2])/h));
      for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
        const idx=i+n[0]*(j+n[1]*k),cur=unsigned[idx];
        const d2=triangleDistance2(o[0]+(i+0.5)*h,o[1]+(j+0.5)*h,o[2]+(k+0.5)*h,ax,ay,az,bx,by,bz,cx,cy,cz);
        if(d2<cur*cur)unsigned[idx]=Math.sqrt(d2);
      }
    }
    if(byParity&&!closed)openWithoutThickness++;
    if(byParity)for(const f of faces)parityFaces.push(f);
    const half=byParity?0:Math.max(thickness!/2,thin);
    if(!byParity&&thickness!/2<thin)shellAdded=Math.max(shellAdded,2*thin-thickness!);
    for(let k=0,c=0;k<n[2];k++)for(let j=0;j<n[1];j++)for(let i=0;i<n[0];i++,c++){
      const d=byParity?(votes[c]>=2?-unsigned[c]:unsigned[c]):unsigned[c]-half,idx=b0[0]+i+nx*(b0[1]+j+ny*(b0[2]+k));
      if(d<field[idx]){field[idx]=d;owner[idx]=part;}
    }
  }
  if(openWithoutThickness>0)warnings.push(`${label}: ${openWithoutThickness} of ${mesh.componentCount} connected component(s) are open and no thickness was given; they were filled by ray parity, which can leak. Close the mesh or give the item a thickness.`);
  return {parityFaces,shellAdded};
}

/**
 * Close the leaks of the meshes that were filled by parity. A lattice link between two fluid cells that passes through
 * a mesh (in through one triangle and out through another, by more than a nick; or through a surface with no inside)
 * is a leak unless its two cells are joined by a short detour of links that cross nothing: an axis link by a step
 * sideways, along and back; an edge link round its corner. A link that only shaves a thick body, clips a convex edge
 * or passes the free rim of a plate joins two cells of the same fluid and is left alone. The end of a leaking link
 * nearer to the wall is made solid. Links are followed a hair off the cell centres, so that none passes exactly through
 * an edge of the mesh. Returns the cells made solid, per mesh.
 */
function closeLeaks(meshes:readonly {mesh:PreparedMesh;faces:number[];part:number}[],grid:FlowGrid,field:Float32Array,owner:Int16Array):number[]{
  const {cell:h,origin:o}=grid,n=[grid.nx,grid.ny,grid.nz],stride=[1,n[0],n[0]*n[1]],thin=FLOW_THIN_CELLS/2*h,jitter=[1.3e-7*h,2.1e-7*h,1.7e-7*h];
  // per crossing link (key: cell * 9 + link): first and last crossing along the link, their number, and the mesh
  const hits=new Map<number,[number,number,number,number]>();
  meshes.forEach(({mesh,faces},which)=>{
    const P=mesh.positions,I=mesh.indices;
    for(const f of faces){
      const a=3*I[3*f],b=3*I[3*f+1],c=3*I[3*f+2];
      const ax=P[a],ay=P[a+1],az=P[a+2],bx=P[b],by=P[b+1],bz=P[b+2],cx=P[c],cy=P[c+1],cz=P[c+2];
      // cells whose links towards larger x (and any y, z) can reach the triangle
      const i0=Math.max(0,Math.floor((Math.min(ax,bx,cx)-o[0])/h-1.5)),i1=Math.min(n[0]-1,Math.floor((Math.max(ax,bx,cx)-o[0])/h-0.5));
      const j0=Math.max(0,Math.floor((Math.min(ay,by,cy)-o[1])/h-1.5)),j1=Math.min(n[1]-1,Math.floor((Math.max(ay,by,cy)-o[1])/h+0.5));
      const k0=Math.max(0,Math.floor((Math.min(az,bz,cz)-o[2])/h-1.5)),k1=Math.min(n[2]-1,Math.floor((Math.max(az,bz,cz)-o[2])/h+0.5));
      for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
        const idx=i+n[0]*(j+n[1]*k);if(field[idx]<0)continue;
        const px=o[0]+(i+0.5)*h+jitter[0],py=o[1]+(j+0.5)*h+jitter[1],pz=o[2]+(k+0.5)*h+jitter[2];
        for(let l=0;l<9;l++){
          const i2=i+LINK_X[l],j2=j+LINK_Y[l],k2=k+LINK_Z[l];
          if(i2>=n[0]||j2<0||j2>=n[1]||k2<0||k2>=n[2])continue;
          if(field[i2+n[0]*(j2+n[1]*k2)]<0)continue;
          const t=segmentTriangle(px,py,pz,LINK_X[l]*h,LINK_Y[l]*h,LINK_Z[l]*h,ax,ay,az,bx,by,bz,cx,cy,cz);
          if(t<0)continue;
          const key=idx*9+l,hit=hits.get(key);
          if(hit){if(t<hit[0])hit[0]=t;if(t>hit[1])hit[1]=t;hit[2]++;}else hits.set(key,[t,t,1,which]);
        }
      }
    }
  });
  const closed=meshes.map(()=>0);
  if(hits.size===0)return closed;
  const shut=new Set<number>();
  // A link "crosses" when it enters and leaves a mesh over more than a nick, or meets a surface with no inside.
  const crosses=(key:number):boolean=>{const hit=hits.get(key);return hit!==undefined&&!(hit[2]>1&&hit[1]-hit[0]<1e-4);};
  // the axis link between two neighbouring cells, keyed from the one with the smaller index
  const axisCrosses=(p:number,q:number,axis:number):boolean=>crosses((p<q?p:q)*9+axis);
  const open=(c:number):boolean=>field[c]>=0&&!shut.has(c);
  const inBox=(c:number,a:number,step:number):boolean=>{const pos=a===0?c%n[0]:a===1?Math.floor(c/n[0])%n[1]:Math.floor(c/stride[2]);return pos+step>=0&&pos+step<n[a];};
  const close=(hit:[number,number,number,number],idx:number,idx2:number):void=>{
    const c=hit[0]+hit[1]<=1?idx:idx2,t=hit[0]+hit[1]<=1?(hit[0]+hit[1])/2:1-(hit[0]+hit[1])/2;
    shut.add(c);closed[hit[3]]++;
    // inside a wall of the thinnest kind the lattice sees, at its distance from the mid-surface
    field[c]=-Math.max(thin-Math.min(t*h,thin),1e-3*h);owner[c]=meshes[hit[3]].part;
  };
  for(const [key,hit] of hits){
    const l=key%9;if(l>2||!crosses(key))continue;
    const idx=(key-l)/9,idx2=idx+stride[l];
    if(!open(idx)||!open(idx2))continue;
    let joined=false;
    for(let a=0;a<3&&!joined;a++){
      if(a===l)continue;
      for(const step of [-1,1]){
        if(!inBox(idx,a,step))continue;
        const p=idx+step*stride[a],q=idx2+step*stride[a];
        if(open(p)&&open(q)&&!axisCrosses(idx,p,a)&&!axisCrosses(idx2,q,a)&&!axisCrosses(p,q,l)){joined=true;break;}
      }
    }
    if(!joined)close(hit,idx,idx2);
  }
  for(const [key,hit] of hits){
    const l=key%9;if(l<3||!crosses(key))continue;
    const idx=(key-l)/9,idx2=idx+LINK_X[l]+n[0]*(LINK_Y[l]+n[1]*LINK_Z[l]);
    if(!open(idx)||!open(idx2))continue;
    let joined=false;
    for(let a=0;a<3&&!joined;a++){
      const step=a===0?LINK_X[l]:a===1?LINK_Y[l]:LINK_Z[l];if(step===0)continue;
      // along axis a first, then along the other axis of the link
      const mid=idx+step*stride[a];let other=0;
      for(let e=0;e<3;e++)if(e!==a&&(e===0?LINK_X[l]:e===1?LINK_Y[l]:LINK_Z[l])!==0)other=e;
      if(open(mid)&&!axisCrosses(idx,mid,a)&&!axisCrosses(mid,idx2,other))joined=true;
    }
    if(!joined)close(hit,idx,idx2);
  }
  return closed;
}

// ---------------------------------------------------------------------------------------------------------------------
// Surfaces of primitives (for sampling the pressure and for drawing)
// ---------------------------------------------------------------------------------------------------------------------
class SurfaceBuilder {
  positions:number[]=[];indices:number[]=[];
  /** A patch of (nu x nv) quads; `at` maps (s, t) in [0,1]^2 to a point. `flip` reverses the winding. */
  patch(nu:number,nv:number,at:(s:number,t:number)=>FlowVec3,flip=false):void{
    const base=this.positions.length/3;
    for(let j=0;j<=nv;j++)for(let i=0;i<=nu;i++){const p=at(i/nu,j/nv);this.positions.push(p[0],p[1],p[2]);}
    for(let j=0;j<nv;j++)for(let i=0;i<nu;i++){
      const a=base+i+(nu+1)*j,b=a+1,c=a+nu+1,d=c+1;
      if(flip)this.indices.push(a,c,b,b,c,d);else this.indices.push(a,b,c,b,d,c);
    }
  }
}
const count=(length:number,size:number,min=1):number=>Math.max(min,Math.min(256,Math.ceil(length/size)));
const place=(m:number[],c:FlowVec3,x:number,y:number,z:number):FlowVec3=>[c[0]+m[0]*x+m[1]*y+m[2]*z,c[1]+m[3]*x+m[4]*y+m[5]*z,c[2]+m[6]*x+m[7]*y+m[8]*z];
function boxSurface(sb:SurfaceBuilder,m:number[],c:FlowVec3,hx:number,hy:number,hz:number,size:number):void{
  const h=[hx,hy,hz];
  for(let axis=0;axis<3;axis++){
    const u=(axis+1)%3,v=(axis+2)%3;
    for(const sign of [-1,1]){
      sb.patch(count(2*h[u],size),count(2*h[v],size),(s,t)=>{const p=[0,0,0];p[axis]=sign*h[axis];p[u]=(2*s-1)*h[u];p[v]=(2*t-1)*h[v];return place(m,c,p[0],p[1],p[2]);},sign<0);
    }
  }
}
/** Surface of revolution of a profile in (r, y), about the local Y. */
function revolvedSurface(sb:SurfaceBuilder,m:number[],c:FlowVec3,profile:readonly (readonly [number,number])[],size:number):void{
  let rmax=0;for(const p of profile)if(p[0]>rmax)rmax=p[0];
  const around=count(2*Math.PI*rmax,size,12);
  for(let i=0;i+1<profile.length;i++){
    const a=profile[i],b=profile[i+1],len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!(len>0))continue;
    sb.patch(around,count(len,size),(s,t)=>{const r=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t,ang=2*Math.PI*s;return place(m,c,r*Math.cos(ang),y,-r*Math.sin(ang));});
  }
}
/** Triangles of the surface of a primitive, with edges of about `size`. */
export function flowPrimitiveSurface(item:FlowPrimitive,size:number):{positions:number[];indices:number[]}{
  const sb=new SurfaceBuilder();
  switch(item.kind){
    case 'box':{const h=boxHalf(item);boxSurface(sb,matrixOf(item.rotation),item.center,h[0],h[1],h[2],size);break;}
    case 'sphere':{const r=item.radius,n=count(Math.PI*r,size,6),prof:[number,number][]=[];for(let i=0;i<=n;i++){const a=-Math.PI/2+Math.PI*i/n;prof.push([i===0||i===n?0:r*Math.cos(a),r*Math.sin(a)]);}revolvedSurface(sb,matrixOf(undefined),item.center,prof,size);break;}
    case 'cylinder':{const f=axisFrame(item),r=item.radius;revolvedSurface(sb,f.m,f.c,[[0,-f.h],[r,-f.h],[r,f.h],[0,f.h]],size);break;}
    case 'capsule':{const f=axisFrame(item),r=item.radius,n=count(Math.PI*r/2,size,3),prof:[number,number][]=[];for(let i=0;i<=n;i++){const a=-Math.PI/2+Math.PI/2*i/n;prof.push([i===0?0:r*Math.cos(a),-f.h+r*Math.sin(a)]);}for(let i=0;i<=n;i++){const a=Math.PI/2*i/n;prof.push([i===n?0:r*Math.cos(a),f.h+r*Math.sin(a)]);}revolvedSurface(sb,f.m,f.c,prof,size);break;}
    case 'cone':{const f=axisFrame(item);revolvedSurface(sb,f.m,f.c,[[0,-f.h],[item.radius,-f.h],[item.radiusTop,f.h],[0,f.h]],size);break;}
    case 'tube':{const f=axisFrame(item),r=item.radius,ri=item.innerRadius;revolvedSurface(sb,f.m,f.c,[[ri,-f.h],[r,-f.h],[r,f.h],[ri,f.h],[ri,-f.h]],size);break;}
    case 'beam':{
      const f=axisFrame({kind:'beam',from:item.from,to:item.to},item.up),w=item.width,dp=item.depth;
      if((item.section??'rect')==='rect'){boxSurface(sb,f.m,f.c,w/2,f.h,dp/2,size);break;}
      const tf=item.flange!,tw=item.web!,off=(z:number):FlowVec3=>[f.c[0]+f.m[2]*z,f.c[1]+f.m[5]*z,f.c[2]+f.m[8]*z];
      boxSurface(sb,f.m,off((dp-tf)/2),w/2,f.h,tf/2,size);boxSurface(sb,f.m,off(-(dp-tf)/2),w/2,f.h,tf/2,size);boxSurface(sb,f.m,f.c,tw/2,f.h,dp/2-tf,size);break;
    }
  }
  return sb;
}

// ---------------------------------------------------------------------------------------------------------------------
// Voxelisation
// ---------------------------------------------------------------------------------------------------------------------
/** Options of `flowVoxelize`: band, surface sampling and thickening. */
export interface FlowVoxelizeOptions {
  /** Half width of the band in which distances are exact, cells. Default 4. */
  readonly band?:number;
  /** Edge length of the triangles made for primitives, metres. Default 1.5 cells. */
  readonly surfaceSize?:number;
  /** Keep the surface triangles of every part (for surface pressure and drawing). Default true. */
  readonly surfaces?:boolean;
  /** Grow thin walls so that they do not leak (see the header). Default true. */
  readonly thicken?:boolean;
}
/** The voxelisation with the surfaces of the parts and the thickening counts. */
export interface FlowVoxelization extends FlowVoxels {
  /** Surface triangles per part (meshes as given, primitives tessellated); empty when `surfaces` is false. */
  readonly surfaces:readonly FlowSurface[];
  /** Items grown to FLOW_THIN_CELLS, the largest growth in metres, closed-mesh cells made solid against leaks, and items
   * thinner than a cell in two directions (left as they fall). */
  readonly thickenedItems:number;readonly largestThickening:number;readonly closedCells:number;readonly slenderItems:number;
}

/** Bounds of a list of items: [min, max]. Cavities and solids alike. */
export function flowGeometryBounds(items:readonly FlowItem[]):{min:[number,number,number];max:[number,number,number]}{
  const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
  const grow=(x:number,y:number,z:number):void=>{if(x<min[0])min[0]=x;if(y<min[1])min[1]=y;if(z<min[2])min[2]=z;if(x>max[0])max[0]=x;if(y>max[1])max[1]=y;if(z>max[2])max[2]=z;};
  for(const item of items){
    if(item.kind==='mesh'){const p=prepareMesh(item,false).positions;for(let v=0;v<p.length;v+=3)grow(p[v],p[v+1],p[v+2]);}
    else{piecesOf(item);const s=flowPrimitiveSurface(item,Infinity).positions;for(let v=0;v<s.length;v+=3)grow(s[v],s[v+1],s[v+2]);}
  }
  if(!(min[0]<=max[0]))fail('the geometry is empty.');
  return {min,max};
}

/** The signed distance of a list of items on a grid, the part of every cell, the surfaces and the report. The work is
 * proportional to the cells near each item (its bounding box plus the band), not to cells times items. */
export function flowVoxelize(items:readonly FlowItem[],grid:FlowGrid,options:FlowVoxelizeOptions={}):FlowVoxelization{
  const {nx,ny,nz,cell:h,origin}=grid;
  if(!(h>0)||!Number.isFinite(h))fail('grid.cell must be positive.');
  for(const n of [nx,ny,nz])if(!Number.isInteger(n)||n<1)fail('grid sizes must be positive integers.');
  const cells=nx*ny*nz,band=options.band??4,reach=band*h,size=options.surfaceSize??1.5*h,keep=options.surfaces!==false,thicken=options.thicken!==false,thin=FLOW_THIN_CELLS*h;
  if(!(band>=2))fail('band must be at least 2 cells.');
  // one distance field per role, made when the first item of the role arrives
  let solid:Float32Array|null=null,cavity:Float32Array|null=null,solidPart:Int16Array|null=null,cavityPart:Int16Array|null=null;
  const parts:string[]=[],partIndex=new Map<string,number>();
  const partOf=(name:string):number=>{let i=partIndex.get(name);if(i===undefined){i=parts.length;if(i>32766)fail('more than 32767 parts.');parts.push(name);partIndex.set(name,i);}return i;};
  const warnings:string[]=[],itemReports:FlowItemReport[]=[];
  const surfaces=new Map<string,{positions:number[];indices:number[]}>();
  let thickenedItems=0,largestThickening=0,closedCells=0,slenderItems=0,coarseItems=0,unresolvedItems=0;
  const pending:{report:FlowItemReport;surface:{positions:ArrayLike<number>;indices:ArrayLike<number>}}[]=[];
  const leakMeshes:{mesh:PreparedMesh;faces:number[];part:number;item:number}[]=[];
  items.forEach((item,index)=>{
    if(!item||typeof item!=='object')fail(`item ${index} is not an object.`);
    const role=item.role??'solid',name=item.part??'body';
    if(role!=='solid'&&role!=='cavity')fail(`item ${index}: role must be 'solid' or 'cavity'.`);
    if(typeof name!=='string'||name.length===0)fail(`item ${index}: part must be a non-empty string.`);
    const part=partOf(name);
    if(role==='cavity'){cavity??=new Float32Array(cells).fill(reach);cavityPart??=new Int16Array(cells).fill(-1);}else{solid??=new Float32Array(cells).fill(reach);solidPart??=new Int16Array(cells).fill(-1);}
    const field=role==='cavity'?cavity!:solid!,owner=role==='cavity'?cavityPart!:solidPart!;
    const base={index,...(item.id!==undefined?{id:item.id}:{}),part:name,role};
    if(item.kind==='mesh'){
      // a mesh with elements is voxelised as one mesh per kind of element; it is still one item of the report
      const pieces=splitElements(item),allPositions:number[]=[],allIndices:number[]=[];
      let shellAdded=0,triangles=0,components=0,closedCount=0,smallest:number|null=null;
      for(const sub of pieces){
        const mesh=prepareMesh(sub,true);
        if(sub.thickness!==undefined&&(!(sub.thickness>=0)||!Number.isFinite(sub.thickness)))fail(`item ${index}: thickness must not be negative.`);
        // a cavity is not grown: its walls are everything else
        const done=voxelizeMesh(mesh,sub.thickness,grid,band,field,owner,part,warnings,`item ${index} (${name})`);
        const cc=mesh.closed.filter(Boolean).length,open=cc<mesh.componentCount;
        shellAdded=Math.max(shellAdded,done.shellAdded);triangles+=mesh.indices.length/3;components+=mesh.componentCount;closedCount+=cc;
        if(sub.thickness!==undefined&&open)smallest=smallest===null?sub.thickness:Math.min(smallest,sub.thickness);
        if(role==='solid'&&thicken&&done.parityFaces.length>0)leakMeshes.push({mesh,faces:done.parityFaces,part,item:index});
        const first=allPositions.length/3;
        for(let v=0;v<mesh.positions.length;v++)allPositions.push(mesh.positions[v]);
        for(let f=0;f<mesh.indices.length;f++)allIndices.push(first+mesh.indices[f]);
      }
      if(shellAdded>0){thickenedItems++;largestThickening=Math.max(largestThickening,shellAdded);}
      pending.push({report:{...base,kind:'mesh',smallestDimension:smallest,thickened:shellAdded,thickenedCells:0,
        triangles,components,closedComponents:closedCount,surfaceArea:0,unresolvedFraction:0},surface:keep?refine(allPositions,allIndices,size):{positions:allPositions,indices:allIndices}});
    }else{
      const {pieces,smallest}=piecesOf(item);let added=0,slender=false;
      for(const piece of pieces){
        // a plate-like solid thinner than the lattice is certain to see is grown about its mid-surface
        let grow=0;
        if(piece.sheet<thin&&piece.across>=thin){if(thicken&&role==='solid')grow=(thin-piece.sheet)/2;}
        else if(piece.across<h&&Math.min(piece.sheet,piece.across)<h)slender=true;
        if(grow>0)added=Math.max(added,2*grow);
        const m=piece.m,c0=piece.c,r=piece.reach+reach+grow;
        const i0=Math.max(0,Math.floor((c0[0]-r-origin[0])/h)),i1=Math.min(nx-1,Math.floor((c0[0]+r-origin[0])/h));
        const j0=Math.max(0,Math.floor((c0[1]-r-origin[1])/h)),j1=Math.min(ny-1,Math.floor((c0[1]+r-origin[1])/h));
        const k0=Math.max(0,Math.floor((c0[2]-r-origin[2])/h)),k1=Math.min(nz-1,Math.floor((c0[2]+r-origin[2])/h));
        for(let k=k0;k<=k1;k++)for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
          const x=origin[0]+(i+0.5)*h-c0[0],y=origin[1]+(j+0.5)*h-c0[1],z=origin[2]+(k+0.5)*h-c0[2];
          // world to local: the transpose of the rotation
          const d=piece.d(m[0]*x+m[3]*y+m[6]*z,m[1]*x+m[4]*y+m[7]*z,m[2]*x+m[5]*y+m[8]*z)-grow,idx=i+nx*(j+ny*k);
          if(d<field[idx]){field[idx]=d;owner[idx]=part;}
        }
      }
      if(added>0){thickenedItems++;largestThickening=Math.max(largestThickening,added);}
      if(slender)slenderItems++;
      pending.push({report:{...base,kind:item.kind,smallestDimension:smallest,thickened:added,surfaceArea:0,unresolvedFraction:0},surface:flowPrimitiveSurface(item,size)});
    }
    // the item's surface: how much of it the grid holds, and the triangles of its part
    const {report,surface}=pending.pop()!,P=surface.positions,I=surface.indices,field2=field;let area=0,lost=0;
    for(let f=0;f<I.length;f+=3){
      const a=3*I[f],b=3*I[f+1],c=3*I[f+2];
      const gx=(P[a]+P[b]+P[c])/3,gy=(P[a+1]+P[b+1]+P[c+1])/3,gz=(P[a+2]+P[b+2]+P[c+2])/3;
      const fi=(gx-origin[0])/h,fj=(gy-origin[1])/h,fk=(gz-origin[2])/h;
      if(fi<0||fj<0||fk<0||fi>=nx||fj>=ny||fk>=nz)continue;
      const ex=P[b]-P[a],ey=P[b+1]-P[a+1],ez=P[b+2]-P[a+2],fx=P[c]-P[a],fy=P[c+1]-P[a+1],fz=P[c+2]-P[a+2];
      const ar=0.5*Math.hypot(ey*fz-ez*fy,ez*fx-ex*fz,ex*fy-ey*fx);area+=ar;
      // is a cell centre inside the item (as voxelised so far in its role) within 1.25 cells?
      let found=false;const ci=Math.floor(fi),cj=Math.floor(fj),ck=Math.floor(fk);
      for(let dk=-2;dk<=2&&!found;dk++)for(let dj=-2;dj<=2&&!found;dj++)for(let di=-2;di<=2&&!found;di++){
        const i=ci+di,j=cj+dj,k=ck+dk;if(i<0||j<0||k<0||i>=nx||j>=ny||k>=nz)continue;
        const dx=fi-(i+0.5),dy=fj-(j+0.5),dz=fk-(k+0.5);if(dx*dx+dy*dy+dz*dz>1.5625)continue;
        if(field2[i+nx*(j+ny*k)]<0)found=true;
      }
      if(!found)lost+=ar;
    }
    const unresolved=area>0?lost/area:0,full:FlowItemReport={...report,surfaceArea:area,unresolvedFraction:unresolved};
    itemReports.push(full);
    if(full.smallestDimension!==null&&full.smallestDimension<2*h&&full.thickened===0)coarseItems++;
    if(unresolved>0.05)unresolvedItems++;
    if(keep){
      let sf=surfaces.get(name);if(!sf){sf={positions:[],indices:[]};surfaces.set(name,sf);}
      const first=sf.positions.length/3;
      for(let v=0;v<P.length;v++)sf.positions.push(P[v]);
      for(let f=0;f<I.length;f++)sf.indices.push(first+I[f]);
    }
  });
  // close what leaks through the meshes filled by parity (walls thinner than the grid resolves), all meshes at once so
  // that a seam between two of them is seen
  if(leakMeshes.length>0&&solid&&solidPart){
    const closed=closeLeaks(leakMeshes,grid,solid,solidPart);
    closed.forEach((count,m)=>{if(count>0){closedCells+=count;const r=itemReports[leakMeshes[m].item];itemReports[leakMeshes[m].item]={...r,thickenedCells:(r.thickenedCells??0)+count};}});
  }
  // combine: solid outside the cavities, plus the solids
  const distance=solid??cavity??new Float32Array(cells).fill(reach),part=solidPart??cavityPart??new Int16Array(cells).fill(-1);let solidCells=0;
  if(cavity&&cavityPart){
    for(let c=0;c<cells;c++){
      let d=solid?solid[c]:reach,p=solidPart?solidPart[c]:-1;const w=-cavity[c];
      if(w<d){d=w;p=cavityPart[c];}
      distance[c]=d;part[c]=p;
    }
  }
  for(let c=0;c<cells;c++){const d=distance[c];if(d>reach)distance[c]=reach;else if(d<-reach)distance[c]=-reach;if(d<0)solidCells++;}
  // warnings: one line per kind of trouble, with the first items named
  const some=(pick:(r:FlowItemReport)=>boolean):string=>{const hit=itemReports.filter(pick),head=hit.slice(0,4).map(r=>`item ${r.index} (${r.part}, ${r.kind})`).join(', ');return hit.length>4?`${head} and ${hit.length-4} more`:head;};
  if(thickenedItems>0)warnings.push(`${thickenedItems} plate-like item(s) thinner than ${FLOW_THIN_CELLS} cells (${thin.toPrecision(3)} m) were grown to that thickness so that they do not leak; the largest growth is ${largestThickening.toPrecision(3)} m: ${some(r=>r.thickened>0)}.`);
  if(closedCells>0)warnings.push(`${closedCells} cell(s) were made solid to close closed meshes whose walls are thinner than the grid resolves: ${some(r=>(r.thickenedCells??0)>0)}.`);
  if(slenderItems>0)warnings.push(`${slenderItems} item(s) are thinner than a cell (${h.toPrecision(3)} m) in two directions (rods, cables); they are not resolved and take force only where they happen to hold a cell centre.`);
  if(coarseItems>0)warnings.push(`${coarseItems} item(s) have a smallest dimension under two cells (${(2*h).toPrecision(3)} m); their shape is coarse: ${some(r=>r.smallestDimension!==null&&r.smallestDimension<2*h&&r.thickened===0)}.`);
  if(unresolvedItems>0)warnings.push(`${unresolvedItems} item(s) have more than 5% of their surface with no cell of their own within 1.25 cells: features thinner than the cell size ${h.toPrecision(3)} m are lost: ${some(r=>r.unresolvedFraction>0.05)}.`);
  return {grid,distance,part,parts,band,items:itemReports,warnings,solidCells,thickenedItems,largestThickening,closedCells,slenderItems,
    surfaces:[...surfaces].map(([name,sf])=>({part:name,positions:Float32Array.from(sf.positions),indices:Uint32Array.from(sf.indices)}))};
}

/** Triangles split so that no edge is longer than `size` (an n x n barycentric grid per triangle): the surface of a mesh
 * is sampled at its vertices, so a large triangle would carry no sample where the pressure peaks. */
function refine(positions:ArrayLike<number>,indices:ArrayLike<number>,size:number):{positions:number[];indices:number[]}{
  const P:number[]=Array.from(positions),I:number[]=[];
  for(let f=0;f<indices.length;f+=3){
    const a=indices[f],b=indices[f+1],c=indices[f+2];
    const edge=(u:number,v:number):number=>Math.hypot(P[3*u]-P[3*v],P[3*u+1]-P[3*v+1],P[3*u+2]-P[3*v+2]);
    const n=Math.min(64,Math.max(1,Math.ceil(Math.max(edge(a,b),edge(b,c),edge(c,a))/size)));
    if(n===1){I.push(a,b,c);continue;}
    // vertices (i, j), i + j <= n, at a + (b - a) i / n + (c - a) j / n
    const base=P.length/3,row=(j:number):number=>j*(n+1)-(j*(j-1))/2,at=(i:number,j:number):number=>base+row(j)+i;
    for(let j=0;j<=n;j++)for(let i=0;i+j<=n;i++)for(let k=0;k<3;k++)P.push(P[3*a+k]+(P[3*b+k]-P[3*a+k])*i/n+(P[3*c+k]-P[3*a+k])*j/n);
    for(let j=0;j<n;j++)for(let i=0;i+j<n;i++){I.push(at(i,j),at(i+1,j),at(i,j+1));if(i+j+1<n)I.push(at(i+1,j),at(i+1,j+1),at(i,j+1));}
  }
  return {positions:P,indices:I};
}

/** A tube swept along a polyline, as a closed triangle mesh (caps at both ends): a pipe bore, a bent duct. */
export function flowTubeMesh(path:readonly FlowVec3[],radius:number,segments=24):{positions:number[];indices:number[]}{
  if(path.length<2)fail('flowTubeMesh needs at least two points.');
  positive(radius,'radius');
  const positions:number[]=[],indices:number[]=[],n=path.length;
  let ux=0,uy=0,uz=0;
  for(let p=0;p<n;p++){
    const a=path[Math.max(0,p-1)],b=path[Math.min(n-1,p+1)];
    let tx=b[0]-a[0],ty=b[1]-a[1],tz=b[2]-a[2];const tl=Math.hypot(tx,ty,tz);if(!(tl>0))fail('flowTubeMesh: two points of the path coincide.');tx/=tl;ty/=tl;tz/=tl;
    if(p===0){if(Math.abs(ty)<0.9){ux=0;uy=1;uz=0;}else{ux=1;uy=0;uz=0;}}
    // carry the frame along: make the last normal perpendicular to the new tangent
    const d=ux*tx+uy*ty+uz*tz;ux-=d*tx;uy-=d*ty;uz-=d*tz;const ul=Math.hypot(ux,uy,uz);ux/=ul;uy/=ul;uz/=ul;
    const vx=ty*uz-tz*uy,vy=tz*ux-tx*uz,vz=tx*uy-ty*ux;
    for(let s=0;s<segments;s++){const ang=2*Math.PI*s/segments,co=radius*Math.cos(ang),si=radius*Math.sin(ang);positions.push(path[p][0]+co*ux+si*vx,path[p][1]+co*uy+si*vy,path[p][2]+co*uz+si*vz);}
  }
  for(let p=0;p+1<n;p++)for(let s=0;s<segments;s++){const a=p*segments+s,b=p*segments+(s+1)%segments,c=a+segments,d=b+segments;indices.push(a,b,c,b,d,c);}
  const c0=positions.length/3;positions.push(path[0][0],path[0][1],path[0][2]);
  const c1=c0+1;positions.push(path[n-1][0],path[n-1][1],path[n-1][2]);
  for(let s=0;s<segments;s++){indices.push(c0,(s+1)%segments,s);indices.push(c1,(n-1)*segments+s,(n-1)*segments+(s+1)%segments);}
  return {positions,indices};
}

/** Options of `flowItemsFromApexGeometry`. */
export interface FlowApexOptions {
  /** 'solid' (default; a body in a tunnel, the walls of a cavity) or 'cavity' (the items are the fluid: "fluid layers"). */
  readonly role?:'solid'|'cavity';
  /** Name of a part in the result: the layer's 'id' (default; unique) or its 'name'. */
  readonly partName?:'id'|'name';
  /** Keep only these part indices. Default: every part. */
  readonly parts?:readonly number[];
}
/**
 * The items of an `apex-flow-geometry/1` document (metres, +y up, right-handed, quaternions x, y, z, w, not recentred):
 * a box has its FULL extents in `size` along its local axes; a cylinder (flat ends) and a capsule lie along their local
 * +y with the full `length` (for a capsule, the segment between the centres of its end spheres); a mesh keeps its
 * per-element closed / open flags and thicknesses. Every item carries its element id as `id` and its layer as `part`.
 * The units and axes are those of this solver: nothing is converted.
 */
export function flowItemsFromApexGeometry(document:unknown,options:FlowApexOptions={}):FlowItem[]{
  if(!document||typeof document!=='object')fail('the apex-flow-geometry document must be an object.');
  const doc=document as {schema?:unknown;parts?:unknown;primitives?:unknown;meshes?:unknown;frame?:{units?:unknown;up?:unknown;quaternion?:unknown}};
  if(doc.schema!=='apex-flow-geometry/1')fail(`the document's schema is "${String(doc.schema)}", not "apex-flow-geometry/1".`);
  if(doc.frame&&(doc.frame.units!==undefined&&doc.frame.units!=='m'||doc.frame.up!==undefined&&doc.frame.up!=='+y'||doc.frame.quaternion!==undefined&&doc.frame.quaternion!=='xyzw'))fail('the document\'s frame must be metres, +y up, quaternions xyzw.');
  const parts=Array.isArray(doc.parts)?doc.parts as {id?:unknown;name?:unknown}[]:fail('the document has no parts array.');
  const role=options.role??'solid',by=options.partName??'id',keep=options.parts?new Set(options.parts):null;
  const nameOf=(index:unknown):string=>{
    if(!Number.isInteger(index)||(index as number)<0||(index as number)>=parts.length)fail(`part index ${String(index)} is out of range.`);
    const p=parts[index as number],n=by==='name'?p.name:p.id;
    return typeof n==='string'&&n.length>0?n:`part-${index as number}`;
  };
  const items:FlowItem[]=[];
  for(const raw of (Array.isArray(doc.primitives)?doc.primitives:[]) as Record<string,unknown>[]){
    if(keep&&!keep.has(raw.part as number))continue;
    const base={part:nameOf(raw.part),role,...(raw.element!==undefined?{id:raw.element as string}:{})},center=raw.center as FlowVec3,rotation=raw.rotation as FlowQuat|undefined;
    switch(raw.shape){
      case 'box':items.push({...base,kind:'box',center,size:raw.size as FlowVec3,rotation});break;
      case 'cylinder':items.push({...base,kind:'cylinder',center,length:raw.length as number,rotation,radius:raw.radius as number});break;
      case 'capsule':items.push({...base,kind:'capsule',center,length:raw.length as number,rotation,radius:raw.radius as number});break;
      case 'sphere':items.push({...base,kind:'sphere',center,radius:raw.radius as number});break;
      default:fail(`primitive shape "${String(raw.shape)}" is unknown.`);
    }
  }
  for(const raw of (Array.isArray(doc.meshes)?doc.meshes:[]) as Record<string,unknown>[]){
    if(keep&&!keep.has(raw.part as number))continue;
    items.push({kind:'mesh',part:nameOf(raw.part),role,positions:raw.positions as number[],indices:raw.indices as number[],elements:raw.elements as FlowMeshElement[]|undefined});
  }
  return items;
}
