import * as T from 'three/webgpu';
import { terrainHeight, type StudyId } from './physics';
import { BRIDGE_LAYOUT, gradeRoadTerrain } from './bridge-layout';

/** Image-guided poses; dimensions stay in the existing model's authored units. */
export const REFERENCE_CAMERAS = {
  bridge: { position: [-31.75, 6.3, 13.6], target: [-16, 8, 0], fov: 57.3 },
  canopy: { position: [11.7, 11.5, 13.4], target: [0, 3.05, 0], fov: 43 },
  plate: { position: [2.5, 5.55, 10.4], target: [0, 3.7, 0], fov: 39 },
} satisfies Record<StudyId, {position:number[];target:number[];fov:number}>;

export const VALLEY_GRID={width:480,depth:600,cols:288,rows:360} as const;
export const noise=(n:number)=>{const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x);};
export function valleyHeight(x:number,z:number):number {
  const far=Math.max(0,Math.abs(x)-38)+Math.max(0,Math.abs(z)-42)*.5;
  const t=Math.max(0,Math.min(1,(Math.abs(x)-15.5)/18)),bank=t*t*(3-2*t);
  const ridge=22*(1-Math.exp(-far/72));
  return gradeRoadTerrain(x,z,terrainHeight(x,z)+ridge*bank*(1.2+Math.sin(x*.035+z*.044)*.65+Math.cos(z*.08)*.25));
}
/** Interpolate the actual two triangles used by PlaneGeometry, not a smooth proxy. */
export function valleySurface(x:number,z:number):number {
  const g=VALLEY_GRID,dx=g.width/g.cols,dz=g.depth/g.rows;
  const u=Math.max(0,Math.min(g.cols-1e-8,(x+g.width/2)/dx)),v=Math.max(0,Math.min(g.rows-1e-8,(z+g.depth/2)/dz));
  const ix=Math.floor(u),iz=Math.floor(v),tx=u-ix,tz=v-iz,x0=ix*dx-g.width/2,z0=iz*dz-g.depth/2;
  const a=valleyHeight(x0,z0),b=valleyHeight(x0,z0+dz),c=valleyHeight(x0+dx,z0+dz),d=valleyHeight(x0+dx,z0);
  return tx+tz<=1?a*(1-tx-tz)+b*tz+d*tx:b*(1-tx)+c*(tx+tz-1)+d*(1-tz);
}

/** Rotation-aware vertex contact, with an intentional 18% embed for an eroded bank. */
export function seatRock(geometry:T.BufferGeometry, transform:T.Matrix4, burial:number):number {
  const p=geometry.getAttribute('position'),v=new T.Vector3();let y=-Infinity;
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(transform);y=Math.max(y,valleySurface(v.x,v.z)-v.y);}
  return y-burial;
}

/** Unit-height conifer: separate jagged boughs, open skirts and volume normals. */
export function coniferGeometry():T.BufferGeometry {
  const positions:number[]=[],normals:number[]=[],colors:number[]=[];
  const vertex=(x:number,y:number,z:number,shade:number)=>{
    positions.push(x,y,z);const n=new T.Vector3(x,.065,z).normalize();normals.push(n.x,n.y,n.z);
    colors.push(.085*shade,.11*shade,.045*shade);
  };
  for(let tier=0;tier<10;tier++){
    const y=.21+tier*.075,r=.19*Math.pow(1-tier/10,.82),branches=tier>7?5:8;
    for(let j=0;j<branches;j++){
      const angle=j/branches*Math.PI*2+tier*2.399,dr=r*(.82+noise(tier*21+j)*.28);
      const ux=Math.cos(angle),uz=Math.sin(angle),tx=-uz,tz=ux;
      const center=[ux*dr*.48,y+.035,uz*dr*.48];
      const ring:number[][]=[];
      for(let k=0;k<6;k++){
        const a=k/6*Math.PI*2,along=dr*(.48+Math.cos(a)*.55),across=Math.sin(a)*dr*.31*(.7+noise(tier*67+j*6+k)*.5);
        ring.push([ux*along+tx*across,y+.055*(1-along/dr)-noise(tier+j+k)*.023,uz*along+tz*across]);
      }
      for(let k=0;k<6;k++){
        const a=ring[k],b=ring[(k+1)%6];
        vertex(center[0],center[1]+.033,center[2],1+tier*.025);
        vertex(b[0],b[1],b[2],.7+noise(k+j+1)*.25);vertex(a[0],a[1],a[2],.7+noise(k+j)*.25);
        vertex(center[0],center[1]-.036,center[2],.35);
        vertex(a[0],a[1],a[2],.42);vertex(b[0],b[1],b[2],.45);
      }
    }
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('normal',new T.Float32BufferAttribute(normals,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));return g;
}

/** Fixed hardware, masonry joints and stiffeners read at the close reference pose. */
export function addBridgeCraft(root:T.Group,materials:Record<string,T.MeshStandardMaterial>):void {
  const box=(size:number[],p:number[],mat:T.Material)=>{const m=new T.Mesh(new T.BoxGeometry(...size as [number,number,number]),mat);m.position.fromArray(p);m.castShadow=true;m.receiveShadow=true;root.add(m);return m;};
  const rod=(a:number[],b:number[],r:number,mat:T.Material)=>{const v=new T.Vector3(...b).sub(new T.Vector3(...a));const m=new T.Mesh(new T.CylinderGeometry(r,r,v.length(),8),mat);m.position.copy(new T.Vector3(...a).add(new T.Vector3(...b)).multiplyScalar(.5));m.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),v.normalize());m.castShadow=true;root.add(m);return m;};
  for(const x of [-21,21]){
    // Form ties and offset lift joints on the exposed abutment faces.
    for(const y of [-.6,.75,2.1]){
      for(const side of [-1,1]){
        box([.018,.025,7.19],[x+side*2.054,y,0],materials.dark);
        for(let z=-2.8;z<3;z+=1.4)box([.025,.016,.06],[x+side*2.059,y+.48,z],materials.dark);
      }
      for(const z of [-3.605,3.605])box([4.09,.025,.018],[x,y,z],materials.dark);
    }
    for(const z of [-1.9,1.9]){
      // Flange strips, splice plates and two bolt rows, including the lower tower.
      for(const y of [4.05,7.35,10.4,13.75]){
        for(const face of [-1,1]){
          box([.04,.55,.42],[x+face*.245,y,z],materials.bridgeSteel);
          for(const yy of [-.17,.17])for(const zz of [-.135,.135])rod([x+face*.267,y+yy,z+zz],[x+face*.292,y+yy,z+zz],.033,materials.bolt);
        }
      }
      for(const end of [-.21,.21])box([.025,10.25,.042],[x+end,8.87,z+.23],materials.bridgeSteel);
      box([.7,.35,.56],[x,13.87,z],materials.bridgeSteel);
    }
    // Open portal: short upper knees stay entirely above the walking clearance.
    for(const side of [-1,1]){
      const a=new T.Vector3(x,11.85,side*1.9),b=new T.Vector3(x,13.5,side*.82),d=b.clone().sub(a);
      const brace=box([.22,d.length(),.28],a.clone().add(b).multiplyScalar(.5).toArray(),materials.bridgeSteel);
      brace.name='Upper portal knee';brace.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),d.normalize());
      box([.28,.55,.46],[x,11.92,side*1.9],materials.bridgeSteel);
      box([.28,.42,.62],[x,13.43,side*.92],materials.bridgeSteel);
    }
    box([.55,.62,4.5],[x,13.5,0],materials.bridgeSteel);
    // Anchor pins and clevis shoulders are aligned with the existing backstays.
    for(const z of [-1.9,1.9]){
      const ax=Math.sign(x)*BRIDGE_LAYOUT.anchorX,az=Math.sign(z)*BRIDGE_LAYOUT.anchorZ,ay=valleySurface(ax,az)+1.6;
      for(const dz of [-.16,.16])box([.48,.62,.09],[ax,ay,az+dz],materials.bridgeSteel);
      const pin=rod([ax,ay+.13,az-.27],[ax,ay+.13,az+.27],.09,materials.bolt);pin.name='Anchor clevis pin';
    }
  }
}
