import * as T from 'three/webgpu';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { BRIDGE_LAYOUT as B, roadCenter, roadHalfWidth, smooth01 } from './bridge-layout';
import { VALLEY_GRID, valleySurface, noise } from './reference-scene';

type RoadVertex={x:number;z:number;u:number;v:number;crown:number};
function clipRoad(poly:RoadVertex[],a:number[],b:number[]):RoadVertex[] {
  const distance=(p:RoadVertex)=>(b[0]-a[0])*(p.z-a[1])-(b[1]-a[1])*(p.x-a[0]),out:RoadVertex[]=[];
  for(let i=0;i<poly.length;i++){
    const p=poly[i],q=poly[(i+1)%poly.length],dp=distance(p),dq=distance(q);
    if(dp>=-1e-9)out.push(p);
    if((dp>=0)!==(dq>=0)){
      const t=dp/(dp-dq);out.push({x:p.x+(q.x-p.x)*t,z:p.z+(q.z-p.z)*t,u:p.u+(q.u-p.u)*t,v:p.v+(q.v-p.v)*t,crown:p.crown+(q.crown-p.crown)*t});
    }
  }return out;
}

/** The surface follows the actual rendered terrain triangles, including cut/fill. */
export function roadRibbon(side:number):T.BufferGeometry {
  const positions:number[]=[],uvs:number[]=[],vertices:RoadVertex[]=[],rows=490,cols=12;
  for(let i=0;i<=rows;i++){
    const x=side*(B.roadStart+(B.roadEnd-B.roadStart)*i/rows),center=roadCenter(x),width=roadHalfWidth(x)+B.shoulder;
    const feather=smooth01((Math.abs(x)-B.roadStart)/8),ragged=(Math.sin(x*1.8)*.06+Math.sin(x*4.9)*.035)*feather;
    for(let j=0;j<=cols;j++){
      const u=j/cols,lateral=u*2-1,z=center+lateral*(width+ragged),crown=(1-lateral*lateral)*.024*feather;
      vertices.push({x,z,u,v:(Math.abs(x)-B.roadStart)/4.8,crown});
    }
  }
  const grid=VALLEY_GRID,dx=grid.width/grid.cols,dz=grid.depth/grid.rows;
  // Cut every road face at the ground's cell edges and diagonals. Sampling only
  // road vertices leaves hovering/intersecting face interiors on steep shoulders.
  for(let i=0;i<rows;i++)for(let j=0;j<cols;j++){
    const a=i*(cols+1)+j,b=a+cols+1,quad=[vertices[a],vertices[a+1],vertices[b+1],vertices[b]];
    const ix0=Math.floor((Math.min(...quad.map(p=>p.x))+grid.width/2)/dx),ix1=Math.floor((Math.max(...quad.map(p=>p.x))+grid.width/2)/dx);
    const iz0=Math.floor((Math.min(...quad.map(p=>p.z))+grid.depth/2)/dz),iz1=Math.floor((Math.max(...quad.map(p=>p.z))+grid.depth/2)/dz);
    for(let ix=ix0;ix<=ix1;ix++)for(let iz=iz0;iz<=iz1;iz++){
      const x=ix*dx-grid.width/2,z=iz*dz-grid.depth/2;
      for(const tri of [[[x,z],[x+dx,z],[x,z+dz]],[[x+dx,z],[x+dx,z+dz],[x,z+dz]]]){
        let poly=quad;for(let edge=0;edge<3&&poly.length;edge++)poly=clipRoad(poly,tri[edge],tri[(edge+1)%3]);
        for(let k=1;k<poly.length-1;k++){
          const points=[poly[0],poly[k],poly[k+1]],area=(points[1].x-points[0].x)*(points[2].z-points[0].z)-(points[1].z-points[0].z)*(points[2].x-points[0].x);
          if(Math.abs(area)<1e-9)continue;if(area>0)points.reverse();
          for(const p of points){positions.push(p.x,valleySurface(p.x,p.z)+.06+p.crown,p.z);uvs.push(p.u,p.v);}
        }
      }
    }
  }
  const raw=new T.BufferGeometry();raw.setAttribute('position',new T.Float32BufferAttribute(positions,3));raw.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
  const g=mergeVertices(raw,1e-5);raw.dispose();g.computeVertexNormals();return g;
}

/** Seeded gravel, fine aggregate and feathered duff shoulders; no image-source pixels. */
function roadTexture():T.CanvasTexture {
  const canvas=document.createElement('canvas');canvas.width=canvas.height=512;const c=canvas.getContext('2d')!;
  const pixels=c.createImageData(512,512);
  for(let y=0;y<512;y++)for(let x=0;x<512;x++){
    const edge=Math.abs(x/511*2-1),grain=noise(x+y*512),mottle=Math.sin(x*.029+Math.sin(y*.042))*5;
    const worn=Math.exp(-Math.pow((edge-.37)/.13,2))*10,duff=smooth01((edge-.63)/.35);
    const value=114+grain*35+mottle-worn-duff*40,p=(y*512+x)*4;
    pixels.data[p]=value+12;pixels.data[p+1]=value+6;pixels.data[p+2]=value-5;
    pixels.data[p+3]=255*(1-smooth01((edge-.83-noise(y+813)*.025)/.16));
  }c.putImageData(pixels,0,0);
  for(let i=0;i<18000;i++){
    const x=noise(i+920)*512,y=noise(i+311)*512,r=.35+noise(i+453)*1.8,shade=Math.floor(78+noise(i+814)*91);
    if(x<24||x>488)continue;c.fillStyle=`rgba(${shade+8},${shade+4},${shade-3},.58)`;c.beginPath();c.ellipse(x,y,r,r*.65,noise(i+433)*6.28,0,6.28);c.fill();
  }
  const t=new T.CanvasTexture(canvas);t.colorSpace=T.SRGBColorSpace;t.wrapS=T.ClampToEdgeWrapping;t.wrapT=T.RepeatWrapping;t.anisotropy=8;return t;
}

export function addBridgeApproaches(root:T.Group,materials:Record<string,T.MeshStandardMaterial>) {
  const map=roadTexture(),roadMat=new T.MeshStandardMaterial({name:'Compacted woodland gravel',map,bumpMap:map,bumpScale:.015,roughness:1,transparent:true,alphaTest:.025,depthWrite:false});
  for(const side of [-1,1]){const m=new T.Mesh(roadRibbon(side),roadMat);m.name=side<0?'West approach road':'East approach road';m.receiveShadow=true;m.renderOrder=1;root.add(m);}
  const stoneGeometry=new T.IcosahedronGeometry(1,0),stones=new T.InstancedMesh(stoneGeometry,materials.rock,4200),dummy=new T.Object3D(),tint=new T.Color();
  stones.name='Approach shoulder aggregate';stones.receiveShadow=true;
  for(let i=0;i<4200;i++){
    const x=(i%2?1:-1)*(B.roadStart+noise(i+173)*(B.roadEnd-B.roadStart)),edge=(noise(i+715)>.5?1:-1);
    const z=roadCenter(x)+edge*(roadHalfWidth(x)+.35+noise(i+351)*.55),s=.028+noise(i+153)*.075;
    dummy.position.set(x,valleySurface(x,z)+.055,z);dummy.rotation.set(0,noise(i+224)*6.28,0);dummy.scale.set(s,s*.32,s*.8);dummy.updateMatrix();stones.setMatrixAt(i,dummy.matrix);
    tint.setHSL(.085,.06,.55+noise(i+243)*.26);stones.setColorAt(i,tint);
  }root.add(stones);
  return {materials:[roadMat],textures:[map]};
}
