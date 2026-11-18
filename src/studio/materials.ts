import * as T from 'three/webgpu';
import { texture, positionWorld, vec2, vec3, mix, smoothstep, mx_noise_float, uv, sin } from 'three/tsl';
import { PACKS, type FinishPreset } from './presets';
import type { StudyId } from './physics';

const asset=(file:string)=>`${import.meta.env?.BASE_URL??'/'}studio/materials/${file}`;
type MaterialMap=Record<string,T.MeshStandardMaterial|T.MeshStandardNodeMaterial>;
type TextureLoader=Pick<T.TextureLoader,'loadAsync'>;
interface TextureEntry {
  key:string;
  promise:Promise<T.Texture>;
  texture?:T.Texture;
  references:number;
  retained:boolean;
  retired:boolean;
}

/** Local texture payloads only. Data maps remain linear; albedo maps are sRGB. */
export class StudioMaterials {
  readonly materials:Record<string,T.MeshStandardMaterial>={};
  private cache=new Map<string,TextureEntry>();
  private groups=new Map<string,Promise<void>>();
  private ownedTextures=new Set<T.Texture>();
  private disposedTextures=new WeakSet<T.Texture>();
  private ownedMaterials=new Set<T.Material>();
  private finishes=new Map<T.Material,TextureEntry[]>();
  private disposed=false;
  private loader:TextureLoader;

  /** The loader seam supports deterministic lifecycle tests without network or GPU access. */
  constructor(loader:TextureLoader=new T.TextureLoader()) {
    this.loader=loader;
    const m=(color:string,roughness=.65,metalness=0)=>new T.MeshStandardMaterial({color,roughness,metalness});
    // Unused study materials need only accept palette changes until ensureStudy resolves.
    this.install({
      floor:m('#deddd3',.89),concrete:m('#d6d6cb',.94),steel:m('#aeb9bd',.62,.84),
      wall:m('#cbcfc7',.94),black:m('#a5b0b3',.7,.48),chrome:m('#f4f3ed',.28,.96),
      wood:m('#e8decd',.93),soil:m('#fffef5',.97),moss:m('#ffffff',.99),
      rock:m('#d3d4ca',.96),bark:m('#9d9788',1),
      leaf:new T.MeshStandardMaterial({color:'#abb7a0',alphaTest:.55,side:T.DoubleSide,roughness:.95}),
      wireRope:m('#707d82',.59,.7),bridgeSteel:m('#5c666a',.79,.58),bridgeConcrete:m('#d6d6cb',.98),
      bridgeBolt:m('#5c666a',.62,.65),bolt:m('#b0bac0',.34,.94),dark:m('#444b49',.84,.15),
      orange:m('#c46d32',.65,.18),yellow:m('#c2a46a',.87),seam:m('#b7b09c',.97),
      reed:m('#7b8260',1),grass:m('#7b8569',1),rubber:m('#222c2e',.94),
      glass:new T.MeshPhysicalMaterial({color:'#c7dee3',metalness:.08,roughness:.16,transparent:true,opacity:.22,depthWrite:false}),
      lamp:new T.MeshStandardMaterial({color:'#fff3db',emissive:'#ffdfab',emissiveIntensity:3,roughness:.4}),
    });
  }

  private assertOpen():void {
    if(this.disposed)throw new Error('StudioMaterials has been disposed');
  }
  private disposeTexture(value:T.Texture):void {
    this.ownedTextures.delete(value);
    if(this.disposedTextures.has(value))return;
    this.disposedTextures.add(value);value.dispose();
  }
  private entry(file:string,color:boolean,repeat:[number,number]):TextureEntry {
    this.assertOpen();
    const key=[file,color,...repeat].join(':');
    const cached=this.cache.get(key);if(cached)return cached;
    const entry:TextureEntry={key,promise:undefined!,references:0,retained:false,retired:false};
    this.cache.set(key,entry);
    entry.promise=Promise.resolve().then(()=>{
      this.assertOpen();return this.loader.loadAsync(asset(file));
    }).then(value=>{
      if(this.disposed||entry.retired){this.disposeTexture(value);throw new Error(this.disposed?'StudioMaterials has been disposed':'StudioMaterials texture was released');}
      // Ownership starts before configuration so even a loader/configuration failure is reclaimable.
      entry.texture=value;this.ownedTextures.add(value);
      value.name=file;value.colorSpace=color?T.SRGBColorSpace:T.NoColorSpace;value.wrapS=value.wrapT=T.RepeatWrapping;
      value.repeat.set(...repeat);value.anisotropy=8;return value;
    }).catch(error=>{
      if(this.cache.get(key)===entry)this.cache.delete(key);
      if(entry.texture)this.disposeTexture(entry.texture);
      throw error;
    });
    return entry;
  }
  /** Explicit texture requests are retained for the library lifetime, as are fixture maps. */
  async texture(file:string,color=true,repeat:[number,number]=[1,1]):Promise<T.Texture> {
    const entry=this.entry(file,color,repeat);entry.retained=true;return entry.promise;
  }
  private release(entry:TextureEntry):void {
    entry.references--;
    if(entry.references>0||entry.retained||entry.retired)return;
    entry.retired=true;
    if(this.cache.get(entry.key)===entry)this.cache.delete(entry.key);
    if(entry.texture)this.disposeTexture(entry.texture);
  }
  private own<M extends T.Material>(material:M,entries?:TextureEntry[]):M {
    this.ownedMaterials.add(material);
    if(entries)this.finishes.set(material,entries);
    const onDispose=()=>{
      material.removeEventListener('dispose',onDispose);this.ownedMaterials.delete(material);
      const textures=this.finishes.get(material);this.finishes.delete(material);
      textures?.forEach(entry=>this.release(entry));
    };
    material.addEventListener('dispose',onDispose);return material;
  }
  private install(materials:MaterialMap):void {
    for(const [key,material] of Object.entries(materials)) {
      const previous=this.materials[key];
      // A prepared finish can already be used by the visible hall worktops.
      if(this.finishes.has(previous)){material.dispose();continue;}
      // Keep the established standard-material dictionary API; its bridge entries are node materials.
      Object.assign(this.materials,{[key]:this.own(material)});
      if(previous&&this.ownedMaterials.has(previous))previous.dispose();
    }
  }

  /** Prepare first, then replace scene references and release the old finish after adoption. */
  async finish(p:FinishPreset):Promise<T.MeshStandardMaterial> {
    this.assertOpen();
    const pack=PACKS[p.pack],cloth=p.study==='canopy',wood=p.study==='bridge';
    const repeat:[number,number]=p.pack==='leather'?[4,3.2]:cloth?[3,2.4]:wood?[1,.33]:[1,1];
    const entries:TextureEntry[]=[];
    const acquire=(file:string,color:boolean,tile:[number,number])=>{
      const entry=this.entry(file,color,tile);entry.references++;entries.push(entry);return entry.promise;
    };
    try {
      const [map,normal,roughness]=await Promise.all([
        acquire(pack.base,true,repeat),
        pack.normal?acquire(pack.normal,false,cloth&&p.pack!=='leather'?[26,21]:repeat):undefined,
        pack.roughness?acquire(pack.roughness,false,repeat):undefined,
      ]);
      this.assertOpen();
      return this.own(new T.MeshPhysicalMaterial({
        name:p.name,color:p.color,map,normalMap:normal,roughnessMap:roughness,
        normalScale:new T.Vector2(p.normal,p.normal),roughness:p.roughness,metalness:p.metalness,
        side:cloth||!wood?T.DoubleSide:T.FrontSide,
        sheen:p.sheen??(cloth?(p.pack==='navy'?.18:.55):0),sheenColor:new T.Color(p.pack==='navy'?p.color:'#efebe1'),sheenRoughness:.9,
        clearcoat:p.clearcoat??(wood&&p.roughness<.8?.2:0),clearcoatRoughness:.65,anisotropy:p.anisotropy??0,
      }),entries);
    } catch(error) {entries.forEach(entry=>this.release(entry));throw error;}
  }
  /** Idempotent, including stale preparation results. Foreign materials are untouched. */
  releaseFinish(material:T.Material|undefined):void {
    if(material&&this.finishes.has(material))material.dispose();
  }

  async init(study:StudyId='canopy'):Promise<void> {await this.ensureStudy(study);}
  async ensureStudy(study:StudyId):Promise<void> {
    this.assertOpen();
    if(study!=='canopy'&&study!=='plate'&&study!=='bridge')throw new Error(`Unknown studio study: ${study}`);
    await Promise.all([
      this.group('shared',()=>this.shared()),
      study==='bridge'?this.group('bridge',()=>this.bridge()):this.group('interior',()=>this.interior()),
    ]);
    this.assertOpen();
  }
  private group(key:string,build:()=>Promise<MaterialMap>):Promise<void> {
    let pending=this.groups.get(key);
    if(!pending){
      pending=build().then(materials=>{
        if(this.disposed){Object.values(materials).forEach(material=>material.dispose());this.assertOpen();}
        this.install(materials);
      }).catch(error=>{if(this.groups.get(key)===pending)this.groups.delete(key);throw error;});
      this.groups.set(key,pending);
    }
    return pending;
  }
  private async shared():Promise<MaterialMap> {
    const [wall,iron,ironNormal,ironRough,machined]=await Promise.all([
      this.texture('cast-concrete.png',true,[2,2]),this.texture('iron-basecolor.webp'),
      this.texture('iron-normal.webp',false),this.texture('iron-roughness.webp',false),this.texture('machined-metal.png'),
    ]);
    this.assertOpen();
    return {
      concrete:new T.MeshStandardMaterial({color:'#d6d6cb',map:wall,roughness:.94,bumpMap:wall,bumpScale:.027}),
      steel:new T.MeshStandardMaterial({color:'#aeb9bd',map:iron,normalMap:ironNormal,normalScale:new T.Vector2(.11,.11),roughnessMap:ironRough,roughness:.62,metalness:.84}),
      black:new T.MeshStandardMaterial({color:'#a5b0b3',map:iron,normalMap:ironNormal,normalScale:new T.Vector2(.16,.16),roughnessMap:ironRough,roughness:.7,metalness:.48}),
      chrome:new T.MeshPhysicalMaterial({color:'#f4f3ed',map:machined,normalMap:ironNormal,normalScale:new T.Vector2(.055,.055),roughnessMap:ironRough,roughness:.28,metalness:.96,anisotropy:.45}),
      wall:new T.MeshStandardMaterial({color:'#cbcfc7',map:wall,roughness:.94,bumpMap:wall,bumpScale:.018}),
    };
  }
  private async interior():Promise<MaterialMap> {
    const concrete=await this.texture('cast-concrete.png',true,[16,16]);
    this.assertOpen();
    // The caller prepares the weathered-oak finish used by the visible hall worktops.
    return {
      floor:new T.MeshStandardMaterial({color:'#deddd3',map:concrete,roughness:.89,bumpMap:concrete,bumpScale:.017}),
    };
  }
  private async bridge():Promise<MaterialMap> {
    const [wall,foliage,iron,ironNormal,ironRough,ground,rock,timber,timberNormal,moss]=await Promise.all([
      this.texture('cast-concrete.png',true,[2,2]),this.texture('oak-foliage.png'),this.texture('iron-basecolor.webp'),
      this.texture('iron-normal.webp',false),this.texture('iron-roughness.webp',false),
      this.texture('riverbank-earth.png',true,[100,94]),this.texture('granite-rock.png'),
      this.texture('timber-basecolor.webp'),this.texture('timber-normal.webp',false),this.texture('forest-floor.png',true,[125,118]),
    ]);
    this.assertOpen();
    const bridgeSteel=new T.MeshStandardNodeMaterial({name:'Weathered bridge steel',normalMap:ironNormal,normalScale:new T.Vector2(.08,.08),roughnessMap:ironRough,roughness:.79,metalness:.58});
    const patina=mx_noise_float(positionWorld.mul(vec3(5,.22,5))).mul(.25).add(.9);
    const chips=smoothstep(.73,.84,mx_noise_float(positionWorld.mul(33)).mul(.5).add(.5));
    const paint=texture(iron,positionWorld.yz.mul(vec2(.7,1.7))).rgb.mul(.38).add(vec3(.065,.082,.096)).mul(patina);
    bridgeSteel.colorNode=mix(paint,vec3(.083,.041,.019),chips.mul(.8));
    const bridgeConcrete=new T.MeshStandardNodeMaterial({name:'Cast concrete abutments',roughness:.98,bumpMap:wall,bumpScale:.024});
    const aggregate=mx_noise_float(positionWorld.mul(62)).mul(.09).add(.93);
    const streak=smoothstep(.15,.62,mx_noise_float(positionWorld.mul(vec3(7,.16,7))));
    const damp=smoothstep(-.7,1.15,positionWorld.y.add(mx_noise_float(positionWorld.mul(vec3(2,.2,2))).mul(.5))).mul(-1).add(1);
    const pits=smoothstep(.3,.56,mx_noise_float(positionWorld.mul(47))).mul(-.38).add(1);
    bridgeConcrete.colorNode=texture(wall,positionWorld.yz.mul(.46).add(positionWorld.x.mul(.31))).rgb.mul(vec3(.83,.79,.70)).mul(aggregate).mul(pits).mul(streak.mul(-.34).add(1)).mul(damp.mul(-.38).add(1));
    const wireRope=new T.MeshStandardNodeMaterial({name:'Stranded steel wire rope',roughness:.59,metalness:.7});
    wireRope.colorNode=mix(vec3(.075,.09,.099),vec3(.21,.235,.245),smoothstep(-.65,.7,sin(uv().x.mul(44).add(uv().y.mul(35)))));
    return {
      wireRope,bridgeSteel,bridgeConcrete,
      wood:new T.MeshStandardMaterial({map:timber,normalMap:timberNormal,normalScale:new T.Vector2(.4,.4),color:'#e8decd',roughness:.93}),
      soil:new T.MeshStandardMaterial({map:ground,color:'#fffef5',roughness:.97,bumpMap:ground,bumpScale:.07}),
      moss:new T.MeshStandardMaterial({map:moss,roughness:.99}),
      rock:new T.MeshStandardMaterial({map:rock,color:'#d3d4ca',roughness:.96,bumpMap:rock,bumpScale:.09}),
      bark:new T.MeshStandardMaterial({map:timber,normalMap:timberNormal,normalScale:new T.Vector2(.7,.7),color:'#9d9788',roughness:1}),
      leaf:new T.MeshStandardMaterial({map:foliage,color:'#abb7a0',alphaTest:.55,side:T.DoubleSide,roughness:.95}),
    };
  }

  /** Release only resources created or loaded by this library, including late load results. */
  dispose():void {
    if(this.disposed)return;this.disposed=true;
    for(const key of Object.keys(this.materials))delete this.materials[key];
    for(const material of this.ownedMaterials)material.dispose();
    this.ownedMaterials.clear();this.finishes.clear();
    for(const value of this.ownedTextures)this.disposeTexture(value);
    for(const entry of this.cache.values())entry.retired=true;
    this.cache.clear();this.groups.clear();
  }
}
