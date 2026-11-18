import * as T from 'three/webgpu';
import type { LightingPreset } from './presets';

/** Coupled sun / background / reflection environment, adapted from HouseBuilder's local HDR method. */
export function skyTexture(p:LightingPreset):T.DataTexture {
  const w=512,h=256,data=new Uint16Array(w*h*4),sky=new T.Color(p.sky),horizon=new T.Color(p.horizon),ground=new T.Color(p.ground),sun=new T.Color(p.key);
  const direction=new T.Vector3(...p.sun).normalize(),d=new T.Vector3(),c=new T.Color();
  for(let y=0;y<h;y++)for(let x=0;x<w;x++) {
    const latitude=((y+.5)/h-.5)*Math.PI,theta=((x+.5)/w-.5)*Math.PI*2;
    d.set(Math.cos(latitude)*Math.cos(theta),Math.sin(latitude),Math.cos(latitude)*Math.sin(theta));
    const vertical=Math.max(0,d.y),horizonMix=Math.pow(1-vertical,3);
    c.copy(sky).lerp(horizon,horizonMix);
    if(d.y<0)c.copy(horizon).lerp(ground,Math.min(1,-d.y*3));
    // Broad cloud structure is analytical and wraps seamlessly around the sky.
    const cloud=Math.sin(d.x*13+d.z*7)+.45*Math.sin(d.x*29-d.z*19)+.22*Math.sin(d.x*57+d.z*31);
    const veil=Math.max(0,cloud-.25)*.17*Math.max(0,1-Math.abs(d.y-.3)*2);
    c.lerp(horizon,Math.min(.44,veil*p.haze));
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
export function studioEnvironment(renderer:T.WebGPURenderer):T.RenderTarget {
  const room=new T.Scene();
  const sphere=new T.Mesh(new T.SphereGeometry(20,32,16),new T.MeshBasicMaterial({color:'#77848a',side:T.BackSide}));room.add(sphere);
  const emitters:[number[],number[],number][]=[ [[-4,5,3],[4,7],4],[[5,3,2],[3,5],2.5],[[0,6,-4],[5,3],3],[[-3,1,-4],[1,4],1.5] ];
  for(const [position,size,power] of emitters){
    const panel=new T.Mesh(new T.PlaneGeometry(size[0],size[1]),new T.MeshBasicMaterial({color:new T.Color('#fff8ed').multiplyScalar(power),side:T.DoubleSide}));
    panel.position.fromArray(position);panel.lookAt(0,0,0);room.add(panel);
  }
  const pmrem=new T.PMREMGenerator(renderer),target=pmrem.fromScene(room,.035);
  room.traverse(o=>{if(o instanceof T.Mesh){o.geometry.dispose();(o.material as T.Material).dispose();}});pmrem.dispose();return target;
}

/** A periodic analytic ripple normal field for the live planar water reflector. */
export function riverNormals():T.DataTexture {
  const n=128,data=new Uint8Array(n*n*4),v=new T.Vector3();
  for(let y=0;y<n;y++)for(let x=0;x<n;x++) {
    const u=x/n*Math.PI*2,w=y/n*Math.PI*2;
    const dx=.19*Math.cos(u*4+w*3)+.08*Math.cos(u*9-w*7),dy=.24*Math.cos(u*4+w*3)-.11*Math.cos(u*9-w*7);
    v.set(-dx,-dy,1).normalize();const i=(y*n+x)*4;
    data[i]=(v.x*.5+.5)*255;data[i+1]=(v.y*.5+.5)*255;data[i+2]=(v.z*.5+.5)*255;data[i+3]=255;
  }
  const t=new T.DataTexture(data,n,n,T.RGBAFormat);t.wrapS=t.wrapT=T.RepeatWrapping;t.magFilter=T.LinearFilter;t.minFilter=T.LinearMipmapLinearFilter;t.generateMipmaps=true;t.needsUpdate=true;return t;
}
