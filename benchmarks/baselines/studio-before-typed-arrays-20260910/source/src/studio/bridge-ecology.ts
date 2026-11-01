import * as T from 'three/webgpu';
import { noise, valleySurface } from './reference-scene';
import { roadClear } from './bridge-layout';

export const BANK_ROCKS=Array.from({length:1100},(_,i)=>{
  const x=(i%2?1:-1)*(i>800?8+noise(i*3)*8:13.8+noise(i*3)*10);
  let z=(noise(i*3+1)-.5)*150;
  let size=i<180?.7+noise(i*3+2)*1.2:i>800&&i<880?.65+noise(i*3+2)*.75:.12+noise(i*3+2)*.68;
  if(Math.abs(Math.abs(x)-21)<5&&Math.abs(z)<22)size*=.52;
  if(Math.abs(Math.abs(x)-21)<2.1+size&&Math.abs(z)<3.7+size)z=Math.sign(z||1)*(3.9+size);
  if(roadClear(x,z,size+.2))z+=Math.sign(z||1)*(4+size);
  return {x,z,size};
});
const rockCells=new Map<string,typeof BANK_ROCKS>();
for(const rock of BANK_ROCKS){const key=`${Math.floor(rock.x/3)},${Math.floor(rock.z/3)}`;if(!rockCells.has(key))rockCells.set(key,[]);rockCells.get(key)!.push(rock);}
export function clearBankRoot(x:number,z:number):boolean {
  const ix=Math.floor(x/3),iz=Math.floor(z/3);
  for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const rock of rockCells.get(`${ix+dx},${iz+dz}`)??[]){
    if(Math.hypot(x-rock.x,z-rock.z)<rock.size*1.05+.15)return false;
  }
  return true;
}

/** Fixed, seeded habitat coordinates. Roots use the rendered terrain triangles. */
export function bankPlant(i:number) {
  const cluster=Math.floor(i/32),angle=noise(i+912)*Math.PI*2,r=Math.sqrt(noise(i+718))*3.3;
  const x=(cluster%2?1:-1)*(18.1+noise(cluster+813)*16)+Math.cos(angle)*r;
  const z=(noise(cluster+714)-.5)*132+Math.sin(angle)*r;
  const y=valleySurface(x,z);
  const clear=roadClear(x,z,.7);
  const foundation=Math.abs(Math.abs(x)-21)<2.6&&Math.abs(z)<4.1;
  return {x,y:y-.045,z,visible:y>-.9&&!clear&&!foundation&&clearBankRoot(x,z),scale:.32+noise(i+420)*.48,angle:noise(i+733)*6.28};
}

/** Every blade starts at the same root; geometry curves up and tapers to a tip. */
export function sedgeGeometry():T.BufferGeometry {
  const positions:number[]=[],colors:number[]=[];
  const vertex=(a:number[],shade:number)=>{positions.push(...a);colors.push(.19*shade,.27*shade,.08*shade);};
  for(let k=0;k<9;k++){
    const angle=k*2.399,h=.48+noise(k+95)*.65,lean=.16+noise(k+82)*.38;
    const row=(t:number,side:number)=>{const r=lean*t*t,w=.012*Math.sin(Math.PI*(.04+t*.96))*side;return [Math.cos(angle)*r-Math.sin(angle)*w,h*t,Math.sin(angle)*r+Math.cos(angle)*w];};
    for(let j=0;j<4;j++){
      const a=row(j/4,-1),b=row(j/4,1),c=row((j+1)/4,-1),d=row((j+1)/4,1);
      for(const p of [a,c,b,b,c,d])vertex(p,.7+j*.1+noise(k)*.18);
    }
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}

/** Seven arching fronds with paired leaflets, not a billboard or a flat fan. */
export function fernGeometry():T.BufferGeometry {
  const positions:number[]=[],colors:number[]=[];
  const vertex=(p:T.Vector3,s:number)=>{positions.push(p.x,p.y,p.z);colors.push(.24*s,.37*s,.105*s);};
  for(let f=0;f<7;f++){
    const angle=f*2.399,ux=Math.cos(angle),uz=Math.sin(angle),size=.75+noise(f+56)*.32;
    const center=(t:number)=>new T.Vector3(ux*t*.8*size,Math.sin(t*2.2)*.63*size,uz*t*.8*size);
    for(let j=0;j<14;j++){
      const a=center(j/14),b=center((j+1)/14),width=new T.Vector3(-uz*.004*(1-j/16),0,ux*.004*(1-j/16));
      for(const p of [a.clone().sub(width),a.clone().add(width),b.clone().sub(width),a.clone().add(width),b.clone().add(width),b.clone().sub(width)])vertex(p,.8);
    }
    for(let j=1;j<14;j++)for(const side of [-1,1]){
      const t=j/14,length=.18*Math.pow(Math.sin(Math.PI*t),.7)*size;
      const root=center(t),tip=root.clone().add(new T.Vector3(-uz*side*length+ux*.085,-.012,ux*side*length+uz*.085));
      const mid=root.clone().lerp(tip,.48).add(new T.Vector3(0,.015,0)),wide=new T.Vector3(ux*.028,0,uz*.028);
      for(const p of [root,mid.clone().add(wide),tip,root,tip,mid.clone().sub(wide)])vertex(p,.75+t*.33+noise(j+f)*.15);
    }
  }
  const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('color',new T.Float32BufferAttribute(colors,3));g.computeVertexNormals();return g;
}

/** Exposed riffle stones share coordinates with their surface wakes. */
export const RIFFLE_STONES=Array.from({length:28},(_,i)=>({
  x:(i%2?1:-1)*(7.5+noise(i+491)*7.8),z:-38+noise(i+183)*76,
  radius:.7+noise(i+926)*.5,
}));
export function wakeAt(x:number,z:number):number {
  if(Math.abs(x)>16.6||valleySurface(x,z)>-1.55)return 0;
  let value=0;
  for(const rock of RIFFLE_STONES){
    const dz=z-rock.z,dx=Math.abs(x-rock.x),r=rock.radius;
    if(dz<-.5*r||dz>r*7)continue;
    const width=r*(.75+Math.max(0,dz)*.15);
    value=Math.max(value,Math.exp(-Math.pow(dx/width,2)*2)*Math.exp(-Math.max(0,dz)/(r*3.2)));
  }
  return value;
}
export function riverWakeTexture():T.DataTexture {
  const w=128,h=512,data=new Uint8Array(w*h*4);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const v=Math.round(wakeAt((i+.5)/w*34-17,(j+.5)/h*140-70)*255),p=(j*w+i)*4;
    data[p]=data[p+1]=data[p+2]=v;data[p+3]=255;
  }
  const t=new T.DataTexture(data,w,h);t.minFilter=t.magFilter=T.LinearFilter;t.needsUpdate=true;return t;
}
