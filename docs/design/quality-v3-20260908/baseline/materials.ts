import * as T from 'three/webgpu';
import { PACKS, type FinishPreset } from './presets';

const asset=(file:string)=>`${import.meta.env.BASE_URL}studio/materials/${file}`;

/** Local texture payloads only. Data maps remain linear; albedo maps are sRGB. */
export class StudioMaterials {
  readonly materials:Record<string,T.MeshStandardMaterial>={};
  private cache=new Map<string,Promise<T.Texture>>();
  private loader=new T.TextureLoader();
  async texture(file:string,color=true,repeat:[number,number]=[1,1]):Promise<T.Texture> {
    const key=[file,color,...repeat].join(':');
    if(!this.cache.has(key))this.cache.set(key,this.loader.loadAsync(asset(file)).then(t=>{
      t.name=file;t.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;
      t.repeat.set(...repeat);t.anisotropy=8;return t;
    }).catch(e=>{this.cache.delete(key);throw e;}));
    return this.cache.get(key)!;
  }
  async finish(p:FinishPreset):Promise<T.MeshStandardMaterial> {
    const pack=PACKS[p.pack],cloth=p.study==='canopy',wood=p.study==='bridge';
    const repeat:[number,number]=cloth?[3,2.4]:wood?[1,.33]:[1,1];
    const [map,normal,roughness]=await Promise.all([
      this.texture(pack.base,true,repeat),
      pack.normal?this.texture(pack.normal,false,cloth?[26,21]:repeat):undefined,
      pack.roughness?this.texture(pack.roughness,false,repeat):undefined,
    ]);
    const material=new T.MeshPhysicalMaterial({
      name:p.name,color:p.color,map,normalMap:normal,roughnessMap:roughness,
      normalScale:new T.Vector2(p.normal,p.normal),roughness:p.roughness,metalness:p.metalness,
      side:cloth||!wood?T.DoubleSide:T.FrontSide,
      sheen:cloth?(p.pack==='navy'?.18:.55):0,sheenColor:new T.Color(p.pack==='navy'?p.color:'#efebe1'),sheenRoughness:.9,
      clearcoat:wood&&p.roughness<.8?.2:0,clearcoatRoughness:.65,
    });
    return material;
  }
  async init():Promise<void> {
    const [concrete,wall,foliage,iron,ironNormal,ironRough,ground,rock,timber,timberNormal,moss,machined]=await Promise.all([
      this.texture('cast-concrete.png',true,[16,16]),this.texture('cast-concrete.png',true,[2,2]),
      this.texture('oak-foliage.png'),this.texture('iron-basecolor.webp'),this.texture('iron-normal.webp',false),
      this.texture('iron-roughness.webp',false),this.texture('riverbank-earth.png',true,[100,94]),
      this.texture('granite-rock.png'),this.texture('timber-basecolor.webp'),this.texture('timber-normal.webp',false),
      this.texture('forest-floor.png',true,[125,118]),
      this.texture('machined-metal.png'),
    ]);
    const m=(color:string,roughness=.65,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
    Object.assign(this.materials,{
      floor:new T.MeshStandardMaterial({color:'#deddd3',map:concrete,roughness:.89,bumpMap:concrete,bumpScale:.017}),
      concrete:new T.MeshStandardMaterial({color:'#d6d6cb',map:wall,roughness:.94,bumpMap:wall,bumpScale:.027}),
      steel:new T.MeshStandardMaterial({color:'#aeb9bd',map:iron,normalMap:ironNormal,normalScale:new T.Vector2(.11,.11),roughnessMap:ironRough,roughness:.62,metalness:.84}),
      bridgeSteel:new T.MeshStandardMaterial({color:'#8c9ba1',normalMap:ironNormal,normalScale:new T.Vector2(.14,.14),roughnessMap:ironRough,roughness:.57,metalness:.7}),
      black:new T.MeshStandardMaterial({color:'#a5b0b3',map:iron,normalMap:ironNormal,normalScale:new T.Vector2(.16,.16),roughnessMap:ironRough,roughness:.7,metalness:.48}),
      chrome:new T.MeshPhysicalMaterial({color:'#f4f3ed',map:machined,normalMap:ironNormal,normalScale:new T.Vector2(.055,.055),roughnessMap:ironRough,roughness:.28,metalness:.96,anisotropy:.45}),
      bolt:m('#b0bac0',.34,.94),wall:new T.MeshStandardMaterial({color:'#cbcfc7',map:wall,roughness:.94,bumpMap:wall,bumpScale:.018}),
      dark:m('#444b49',.84,.15),wood:new T.MeshStandardMaterial({map:timber,normalMap:timberNormal,normalScale:new T.Vector2(.4,.4),color:'#e8decd',roughness:.93}),
      orange:m('#c46d32',.65,.18),yellow:m('#c2a46a',.87),seam:m('#b7b09c',.97),
      soil:new T.MeshStandardMaterial({map:ground,color:'#fffef5',roughness:.97,bumpMap:ground,bumpScale:.07}),
      moss:new T.MeshStandardMaterial({map:moss,roughness:.99}),
      rock:new T.MeshStandardMaterial({map:rock,color:'#d3d4ca',roughness:.96,bumpMap:rock,bumpScale:.09}),
      bark:new T.MeshStandardMaterial({map:timber,normalMap:timberNormal,normalScale:new T.Vector2(.7,.7),color:'#9d9788',roughness:1}),
      leaf:new T.MeshStandardMaterial({map:foliage,color:'#abb7a0',alphaTest:.55,side:T.DoubleSide,roughness:.95}),
      reed:m('#7b8260',1),grass:m('#7b8569',1),rubber:m('#222c2e',.94),
      glass:new T.MeshPhysicalMaterial({color:'#c7dee3',metalness:.08,roughness:.16,transparent:true,opacity:.22,depthWrite:false}),
      lamp:new T.MeshStandardMaterial({color:'#fff3db',emissive:'#ffdfab',emissiveIntensity:3,roughness:.4}),
    });
  }
}
