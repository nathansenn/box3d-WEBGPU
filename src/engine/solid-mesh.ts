import {EngineError,finite,integer,onlyKeys,record} from './contracts.ts';

/** A tetrahedral mesh. `positions` holds x, y, z per node in metres; `tets` holds four node indices per element. */
export interface TetMesh {positions:Float64Array;tets:Uint32Array}
export interface BoxMeshOptions {
  /** Edge lengths along x, y, z in metres. */
  size:readonly [number,number,number];
  /** Number of hexahedral cells along x, y, z. Each cell is split into tetrahedra. */
  cells:readonly [number,number,number];
  /** Position of the corner with the smallest coordinates. Default (0, 0, 0). */
  origin?:readonly [number,number,number];
  /** `alternating5` (default): five tetrahedra per cell, mirrored in every second cell.
   * `kuhn6`: six congruent tetrahedra per cell around the (1, 1, 1) diagonal. */
  pattern?:'alternating5'|'kuhn6';
}
export const SOLID_MAX_NODES=200_000,SOLID_MAX_TETS=1_000_000;

// Corner c of a cell has offset (c&1, c>>1&1, c>>2&1).
const FIVE_EVEN=[0,3,5,6, 1,0,3,5, 2,0,3,6, 4,0,5,6, 7,3,5,6];
const FIVE_ODD=FIVE_EVEN.map(c=>c^1);
const KUHN=[0,1,3,7, 0,1,5,7, 0,2,3,7, 0,2,6,7, 0,4,5,7, 0,4,6,7];

function triple(value:unknown,label:string,min:number,max:number,whole=false):[number,number,number] {
  if(!Array.isArray(value)||value.length!==3)throw new EngineError('INVALID_PAYLOAD',`${label} needs three components.`);
  return value.map((v,i)=>whole?integer(v,`${label}[${i}]`,min,max):finite(v,`${label}[${i}]`,min,max)) as [number,number,number];
}

/** Signed volume of the tetrahedron (a, b, c, d): positive when d lies on the side of the normal of a→b→c. */
export function tetVolume(p:ArrayLike<number>,a:number,b:number,c:number,d:number):number {
  const ax=p[3*a],ay=p[3*a+1],az=p[3*a+2];
  const ux=p[3*b]-ax,uy=p[3*b+1]-ay,uz=p[3*b+2]-az,vx=p[3*c]-ax,vy=p[3*c+1]-ay,vz=p[3*c+2]-az,wx=p[3*d]-ax,wy=p[3*d+1]-ay,wz=p[3*d+2]-az;
  return (ux*(vy*wz-vz*wy)+uy*(vz*wx-vx*wz)+uz*(vx*wy-vy*wx))/6;
}

/** Index of the node at grid position (i, j, k) of a `boxMesh` with the given cell counts. */
export function boxNode(cells:readonly [number,number,number],i:number,j:number,k:number):number {
  return i+(cells[0]+1)*(j+(cells[1]+1)*k);
}

/** A box split into tetrahedra. The split is conforming (neighbouring cells share whole
 * triangles). `alternating5` gives every cell the symmetry of a regular tetrahedron and
 * mirrors the split between neighbours, so the mesh is mirror-symmetric about each mid-plane
 * whose cell count is even, and is unchanged by swapping two axes with equal counts and sizes.
 * `kuhn6` uses congruent elements but favours one diagonal. Every element has positive volume.
 */
export function boxMesh(options:BoxMeshOptions):TetMesh {
  const o=record(options,'box mesh');onlyKeys(o,['size','cells','origin','pattern'],'box mesh');
  const size=triple(o.size,'size',1e-9,1e6),cells=triple(o.cells,'cells',1,4096,true),origin=o.origin===undefined?[0,0,0]:triple(o.origin,'origin',-1e6,1e6);
  const pattern=o.pattern===undefined?'alternating5':o.pattern;
  if(pattern!=='alternating5'&&pattern!=='kuhn6')throw new EngineError('INVALID_PAYLOAD','Unknown box mesh pattern.');
  const [nx,ny,nz]=cells,nodes=(nx+1)*(ny+1)*(nz+1),perCell=pattern==='kuhn6'?6:5,count=nx*ny*nz*perCell;
  if(nodes>SOLID_MAX_NODES||count>SOLID_MAX_TETS)throw new EngineError('WORK_LIMIT','The box mesh exceeds the solid mesh capacity.');
  const positions=new Float64Array(3*nodes),tets=new Uint32Array(4*count);
  for(let k=0,n=0;k<=nz;k++)for(let j=0;j<=ny;j++)for(let i=0;i<=nx;i++,n++){
    positions[3*n]=origin[0]+size[0]*i/nx;positions[3*n+1]=origin[1]+size[1]*j/ny;positions[3*n+2]=origin[2]+size[2]*k/nz;
  }
  let t=0;
  for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)for(let i=0;i<nx;i++){
    const table=pattern==='kuhn6'?KUHN:(i+j+k)%2===0?FIVE_EVEN:FIVE_ODD;
    for(let q=0;q<table.length;q+=4){
      for(let m=0;m<4;m++){const c=table[q+m];tets[t+m]=boxNode(cells,i+(c&1),j+(c>>1&1),k+(c>>2&1));}
      if(tetVolume(positions,tets[t],tets[t+1],tets[t+2],tets[t+3])<0){const s=tets[t+2];tets[t+2]=tets[t+3];tets[t+3]=s;}
      t+=4;
    }
  }
  return {positions,tets};
}

/** Triangles that belong to exactly one tetrahedron, three node indices each, wound so the
 * normal (b - a) x (c - a) points out of the solid. The order follows the element order. */
export function boundaryFaces(mesh:TetMesh):Uint32Array {
  const {positions,tets}=mesh,seen=new Map<string,number>(),faces:number[]=[],alive:boolean[]=[];
  for(let t=0;t<tets.length;t+=4)for(let skip=0;skip<4;skip++){
    const f=[0,1,2,3].filter(m=>m!==skip).map(m=>tets[t+m]),key=[...f].sort((a,b)=>a-b).join(','),previous=seen.get(key);
    if(previous!==undefined){alive[previous]=false;continue;}
    // Outward means away from the fourth node of the element.
    if(tetVolume(positions,f[0],f[1],f[2],tets[t+skip])>0){const s=f[1];f[1]=f[2];f[2]=s;}
    seen.set(key,alive.length);alive.push(true);faces.push(f[0],f[1],f[2]);
  }
  const out:number[]=[];
  for(let i=0;i<alive.length;i++)if(alive[i])out.push(faces[3*i],faces[3*i+1],faces[3*i+2]);
  return Uint32Array.from(out);
}
