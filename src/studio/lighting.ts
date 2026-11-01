import * as T from 'three/webgpu';
import type { LightingPreset } from './presets';

function cloudNoise(x:number,z:number):number {
  const ix=Math.floor(x),iz=Math.floor(z),a=x-ix,b=z-iz,u=a*a*(3-2*a),v=b*b*(3-2*b);
  const hash=(xx:number,zz:number)=>{const n=Math.sin(xx*127.1+zz*311.7)*43758.5453;return n-Math.floor(n);};
  return (hash(ix,iz)*(1-u)+hash(ix+1,iz)*u)*(1-v)+(hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u)*v;
}

/** Coupled sun / background / reflection environment, adapted from HouseBuilder's local HDR method. */
export function skyTexture(p:LightingPreset):T.DataTexture {
  const w=1024,h=512,data=new Uint16Array(w*h*4),sky=new T.Color(p.sky),horizon=new T.Color(p.horizon),ground=new T.Color(p.ground),sun=new T.Color(p.key);
  const direction=new T.Vector3(...p.sun).normalize(),d=new T.Vector3(),c=new T.Color();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const latitude=((y+.5)/h-.5)*Math.PI,theta=((x+.5)/w-.5)*Math.PI*2;
    d.set(Math.cos(latitude)*Math.cos(theta),Math.sin(latitude),Math.cos(latitude)*Math.sin(theta));
    const vertical=Math.max(0,d.y),horizonMix=Math.exp(-vertical*9);
    c.copy(sky).lerp(horizon,horizonMix);
    if(d.y<0)c.copy(horizon).lerp(ground,Math.min(1,-d.y*3));
    // A continuous directional cloud field: soft cumulus bodies, fine edges and
    // shaded bases. Sampling direction rather than UV keeps the panorama seam closed.
    if(d.y>.025){
      const stretch=1/(d.y+.32),cx=d.x*stretch*8.5,cz=d.z*stretch*8.5;
      let density=0,amplitude=.58,frequency=1;
      for(let o=0;o<5;o++){density+=cloudNoise(cx*frequency,cz*frequency)*amplitude;amplitude*=.48;frequency*=2.13;}
      const cloud=Math.min(1,Math.max(0,(density-.5)*9.5));
      const horizonFade=Math.min(1,Math.max(0,(d.y-.025)*9));
      const light=.85+Math.max(0,cloudNoise(cx+.16,cz+.09)-density)*.9;
      const cloudColor=new T.Color().setRGB(light,light*1.012,light*1.03);
      c.lerp(cloudColor,cloud*horizonFade*.93);
    }
    const cosine=Math.max(0,d.dot(direction));
    const halo=Math.pow(cosine,35)*.3+Math.pow(cosine,1800)*3;
    c.r+=sun.r*halo*p.intensity*.3;c.g+=sun.g*halo*p.intensity*.3;c.b+=sun.b*halo*p.intensity*.3;
    const i=(y*w+x)*4;
    data[i]=T.DataUtils.toHalfFloat(c.r*1.8);data[i+1]=T.DataUtils.toHalfFloat(c.g*1.8);data[i+2]=T.DataUtils.toHalfFloat(c.b*1.8);data[i+3]=T.DataUtils.toHalfFloat(1);
  }
  const texture=new T.DataTexture(data,w,h,T.RGBAFormat,T.HalfFloatType);
  texture.mapping=T.EquirectangularReflectionMapping;texture.colorSpace=T.LinearSRGBColorSpace;
  texture.minFilter=T.LinearFilter;texture.magFilter=T.LinearFilter;texture.needsUpdate=true;
  return texture;
}

/** Four broad photographic emitters, following Material Forge's studio environment. */
export function studioEnvironment(renderer:T.WebGPURenderer,press=false):T.RenderTarget {
  const room=new T.Scene();
  const sphere=new T.Mesh(new T.SphereGeometry(20,32,16),new T.MeshBasicMaterial({color:press?'#4b555d':'#77848a',side:T.BackSide}));room.add(sphere);
  const emitters:[number[],number[],number][]=press?
    // An elevated inspection camera reflects below the horizon on vertical steel.
    // Tall cards must span both hemispheres to reveal the cylindrical guides.
    [ [[-5,0,3],[1.5,14],5],[[5,0,-2],[1,14],4],[[0,8,-1],[5,4],4],[[3,-2,6],[4,5],2],[[-4,0,-7],[6,12],3],[[6,0,7],[3,12],2.8] ]:
    [ [[-4,5,3],[4,7],4],[[5,3,2],[3,5],2.5],[[0,6,-4],[5,3],3],[[-3,1,-4],[1,4],1.5] ];
  for(const [position,size,power] of emitters){
    const panel=new T.Mesh(new T.PlaneGeometry(size[0],size[1]),new T.MeshBasicMaterial({color:new T.Color('#fff8ed').multiplyScalar(power),side:T.DoubleSide}));
    panel.position.fromArray(position);panel.lookAt(0,0,0);room.add(panel);
  }
  const pmrem=new T.PMREMGenerator(renderer),target=pmrem.fromScene(room,.035);
  room.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(o.material as T.Material).dispose();}});pmrem.dispose();return target;
}

/** A periodic, directional wave spectrum; integer frequencies tile without a seam. */
export function riverNormals():T.DataTexture {
  const n=256,data=new Uint8Array(n*n*4),v=new T.Vector3();
  const waves=[ [2,1,.047,.4],[1,3,.025,2.7],[5,-2,.018,1.2],[3,7,.011,4.1],[9,4,.006,3.4],[7,-11,.004,5.7],[17,9,.002,1.8],[13,-19,.0015,4.8] ];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
    const u=x/n*Math.PI*2,w=y/n*Math.PI*2;
    let dx=0,dy=0;
    for(const [kx,ky,amplitude,phase] of waves){const slope=amplitude*Math.cos(kx*u+ky*w+phase);dx+=kx*slope;dy+=ky*slope;}
    v.set(-dx,-dy,1).normalize();const i=(y*n+x)*4;
    data[i]=(v.x*.5+.5)*255;data[i+1]=(v.y*.5+.5)*255;data[i+2]=(v.z*.5+.5)*255;data[i+3]=255;
  }
  const t=new T.DataTexture(data,n,n,T.RGBAFormat);t.wrapS=t.wrapT=T.RepeatWrapping;t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;
}
