import * as T from 'three/webgpu';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {GroundedSkybox} from 'three/addons/objects/GroundedSkybox.js';
import {StudioMaterials} from '../materials';
import {studioEnvironment,riverNormals} from '../lighting';
import {LABS,type LabId} from './catalog';
import {GlassModel,GranularModel,LiquidModel,RubberModel,type LabFrame,type LabModel,type V3,random} from './models';

const UP=new T.Vector3(0,1,0),faces=[0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,3,7,6,3,6,2,1,2,6,1,6,5,0,4,7,0,7,3];
export type LabView='hero'|'detail'|'top';
export class MaterialLabWorld {
  readonly scene=new T.Scene();readonly camera=new T.PerspectiveCamera(42,1,.06,120);
  renderer:T.WebGPURenderer;controls:OrbitControls;
  private library=new StudioMaterials();private environment?:T.RenderTarget;private panorama?:T.Texture;private rig=new T.Group();private hall=new T.Group();
  private materials:Record<string,T.Material>={};private extraMaterials=new Set<T.Material>();private observer:ResizeObserver;
  private actuator=new T.Group();private specimen?:T.Mesh<T.BufferGeometry>;private intactPane?:T.Mesh;private piston?:T.Mesh;private housingEnd=0;private cracks?:T.LineSegments;private grains?:T.InstancedMesh;
  private water?:T.Mesh<T.BufferGeometry>;private waterSides?:T.Mesh<T.BufferGeometry>;private foam?:T.InstancedMesh;
  private dummy=new T.Object3D();private color=new T.Color();private localVertices=new Float32Array();private ranges:number[]=[];
  private rubberRest?:Float32Array;private labels:T.Texture[]=[];private view:LabView='hero';private disposed=false;
  private tint:T.MeshPhysicalMaterial;private ripple=riverNormals();private lastFrame?:LabFrame;private rotate=false;private key=new T.DirectionalLight('#fff1d7',3.6);
  constructor(private host:HTMLElement,public model:LabModel){
    this.renderer=this.makeRenderer();this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.setupControls();
    this.tint=this.own(new T.MeshPhysicalMaterial());this.scene.add(this.hall,this.rig);
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(host);
  }
  private own<M extends T.Material>(m:M):M {this.extraMaterials.add(m);return m;}
  private makeRenderer(forceWebGL=false):T.WebGPURenderer {
    const r=new T.WebGPURenderer({antialias:true,alpha:false,forceWebGL});r.setPixelRatio(Math.min(devicePixelRatio,1.5));
    r.toneMapping=T.ACESFilmicToneMapping;r.toneMappingExposure=1;r.shadowMap.enabled=true;r.shadowMap.type=T.PCFShadowMap;
    r.domElement.setAttribute('role','img');r.domElement.setAttribute('aria-label','Interactive 3D material experiment. Drag to orbit and scroll to zoom.');this.host.append(r.domElement);return r;
  }
  private setupControls():void {this.controls.enableDamping=true;this.controls.dampingFactor=.08;this.controls.maxPolarAngle=Math.PI*.49;this.controls.minDistance=2;this.controls.maxDistance=32;}
  async init():Promise<void>{
    const first=this.renderer,initializing=first.init();let timeout:ReturnType<typeof setTimeout>|undefined;
    try{await Promise.race([initializing,new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Graphics initialization timed out')),4000);})]);}
    catch{this.controls.dispose();first.domElement.remove();void initializing.then(()=>first.dispose()).catch(()=>{});this.renderer=this.makeRenderer(true);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.setupControls();await this.renderer.init();}
    finally{if(timeout)clearTimeout(timeout);}
    await this.library.init('plate');
    try{
      this.panorama=await new T.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}studio/references/material-labs/hall-panorama.png`);this.panorama.colorSpace=T.SRGBColorSpace;this.panorama.mapping=T.EquirectangularReflectionMapping;
      const pmrem=new T.PMREMGenerator(this.renderer);this.environment=pmrem.fromEquirectangular(this.panorama);pmrem.dispose();
    }catch{this.environment=studioEnvironment(this.renderer);}
    this.scene.environment=this.environment.texture;this.scene.environmentIntensity=1.35;this.scene.background=new T.Color('#cecfc5');
    const source=this.library.materials;
    this.materials={floor:source.floor,wall:source.concrete,steel:this.own(new T.MeshStandardMaterial({color:'#b7c0ba',map:source.steel.map,normalMap:source.steel.normalMap,normalScale:new T.Vector2(.1,.1),roughness:.32,metalness:.48,envMapIntensity:1.8})),chrome:source.chrome,
      orange:this.own(new T.MeshStandardMaterial({color:'#f07422',roughness:.46,metalness:.32})),black:this.own(new T.MeshStandardMaterial({color:'#1a2020',roughness:.73,metalness:.22})),
      white:this.own(new T.MeshStandardMaterial({color:'#dadad0',roughness:.76})),rubber:this.own(new T.MeshStandardMaterial({color:'#252b28',roughness:.9})),
      glass:this.own(new T.MeshPhysicalMaterial({color:'#d1e7e0',roughness:.07,metalness:.02,transparent:true,opacity:.08,depthWrite:false,side:T.DoubleSide,clearcoat:1,envMapIntensity:1.5})),
      light:this.own(new T.MeshBasicMaterial({color:'#d6e2dc'})),mullion:this.own(new T.MeshStandardMaterial({color:'#939790',roughness:.68,metalness:.45})),leaf:this.own(new T.MeshStandardMaterial({color:'#65794a',roughness:.84,side:T.DoubleSide})),aggregate:this.own(new T.MeshStandardMaterial({color:'#c1baab',map:source.concrete.map,bumpMap:source.concrete.map,bumpScale:.035,roughness:.91}))};
    this.buildHall();this.setModel(this.model);this.resize();
  }
  private mesh(g:T.BufferGeometry,m:T.Material,p:V3,parent:T.Object3D=this.rig):T.Mesh {const mesh=new T.Mesh(g,m);mesh.position.set(...p);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;}
  private box(size:V3,p:V3,mat='steel',bevel=0,parent:T.Object3D=this.rig):T.Mesh {const box=this.mesh(bevel?new RoundedBoxGeometry(...size,2,bevel):new T.BoxGeometry(...size),this.materials[mat],p,parent);if(mat==='glass')box.castShadow=false;return box;}
  private cylinder(r:number,h:number,p:V3,mat='chrome',parent:T.Object3D=this.rig):T.Mesh {return this.mesh(new T.CylinderGeometry(r,r,h,40),this.materials[mat],p,parent);}
  private rod(a:V3,b:V3,r=.025,mat='chrome',parent:T.Object3D=this.rig):T.Mesh {const delta=new T.Vector3(...b).sub(new T.Vector3(...a)),mesh=this.cylinder(r,delta.length(),[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],mat,parent);mesh.quaternion.setFromUnitVectors(UP,delta.normalize());return mesh;}
  private bolt(x:number,y:number,z:number,parent:T.Object3D=this.rig):void {this.cylinder(.056,.025,[x,y,z],'black',parent);this.mesh(new T.CylinderGeometry(.037,.037,.043,6),this.materials.chrome,[x,y+.018,z],parent);}
  private hose(points:V3[],r=.035,parent:T.Object3D=this.rig):void {const curve=new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p)));this.mesh(new T.TubeGeometry(curve,40,r,10,false),this.materials.rubber,[0,0,0],parent);}
  private label(text:string,width:number,height:number,p:V3,background='#222a28',color='#dadcd2',parent:T.Object3D=this.rig):T.Mesh {
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=Math.max(48,Math.round(1024*height/width));const ctx=canvas.getContext('2d')!;ctx.fillStyle=background;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle=color;ctx.font=`600 ${Math.round(canvas.height*.48)}px Inter, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,512,canvas.height/2,980);
    const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;this.labels.push(texture);
    const m=this.own(new T.MeshBasicMaterial({map:texture}));return this.mesh(new T.PlaneGeometry(width,height),m,p,parent);
  }
  private buildHall():void {
    if(this.panorama){
      const skybox=new GroundedSkybox(this.panorama,3,55,64);skybox.position.y=3;(skybox.material as T.MeshBasicMaterial).toneMapped=false;this.own(skybox.material as T.Material);this.hall.add(skybox);
      const shadow=this.mesh(new T.PlaneGeometry(70,70),this.own(new T.ShadowMaterial({color:'#484436',opacity:.3,depthWrite:false})),[0,.009,0],this.hall);shadow.rotation.x=-Math.PI/2;shadow.castShadow=false;shadow.renderOrder=2;
    }else{
    this.box([34,.15,26],[0,-.11,0],'floor',0,this.hall);
    this.box([25,1.25,.24],[0,.61,-5.1],'wall',0,this.hall);
    this.box([25,1.2,.24],[0,6.5,-5.1],'wall',0,this.hall);
    for(let x=-11;x<=11;x+=3.1){
      const pane=this.box([2.78,4.3,.025],[x,3.55,-5.2],'light',0,this.hall);pane.castShadow=false;
      this.box([.14,5.3,.15],[x-1.4,3,-4.82],'mullion',0,this.hall);
      this.box([3,.13,.38],[x,1.3,-4.8],'wall',0,this.hall);
      for(let dx=-.7;dx<=.8;dx+=.72)this.box([.041,4.28,.09],[x+dx,3.55,-4.81],'mullion',0,this.hall);
      for(let y=1.43;y<5.8;y+=1.08)this.box([2.83,.041,.09],[x,y,-4.78],'mullion',0,this.hall);
    }
    for(let x=-12;x<=12;x+=6)this.box([.24,7,.3],[x,3.4,-4.6],'mullion',0,this.hall);
    for(let x=-12;x<=12;x+=2){this.box([.008,.005,23],[x,-.032,0],'wall',0,this.hall);this.box([30,.005,.008],[0,-.032,x],'wall',0,this.hall);}
    this.box([2.8,.12,1],[5.4,1.05,-3.3],'steel',.025,this.hall);
    for(const x of [4.2,6.6])for(const z of [-3.65,-2.95])this.box([.07,1,.07],[x,.5,z],'steel',0,this.hall);
    for(let i=0;i<4;i++){this.box([.36,.33,.42],[4.55+i*.48,1.26,-3.3],i%2?'orange':'white',.02,this.hall);}
    for(const x of [-4.6,3.8]){
      this.box([.62,.66,.62],[x,.33,-3.9],'wall',.025,this.hall);const rng=random(x<0?37:53);
      for(let stem=0;stem<5;stem++){
        const tx=x+(rng()-.5)*.65,tz=-3.9+(rng()-.5)*.4,h=1.8+rng();this.rod([x,.6,-3.9],[tx,h,tz],.012,'black',this.hall);
        for(let j=0;j<9;j++){const y=.85+j*(h-.85)/8,a=rng()*Math.PI*2,leaf=this.mesh(new T.SphereGeometry(1,8,4),this.materials.leaf,[tx+Math.cos(a)*.19,y,tz+Math.sin(a)*.19],this.hall);leaf.scale.set(.24,.021,.07);leaf.rotation.set(.2,a,.35);}
      }
    }
    // Shelf, rolled hoses and a wall conduit establish the same working hall as the references.
    for(const y of [.22,.95,1.68])this.box([1.5,.06,.65],[2.7,y,-4.35],'mullion',0,this.hall);
    for(const x of [2,3.4])for(const z of [-4.65,-4.05])this.box([.045,1.8,.045],[x,.9,z],'mullion',0,this.hall);
    for(let i=0;i<6;i++)this.box([.38,.16,.4],[2.2+(i%3)*.48,.33+Math.floor(i/3)*.73,-4.35],i%2?'black':'orange',.015,this.hall);
    for(const x of [-1.3,-1.16])this.rod([x,.1,-4.68],[x,5.9,-4.68],.022,'mullion',this.hall);
    this.label('BOX3D  /  MATERIAL STUDIES',2.6,.45,[-5.8,3.6,-4.7],'#c0c1b8','#404941',this.hall);
    }
    this.key.position.set(-5,8,-4);this.key.castShadow=true;this.key.shadow.mapSize.set(2048,2048);Object.assign(this.key.shadow.camera,{left:-8,right:8,top:8,bottom:-8,near:.5,far:30});this.key.shadow.bias=-.0003;this.key.shadow.normalBias=.018;this.key.target.position.set(0,1,0);this.scene.add(this.key,this.key.target);
    this.scene.add(new T.HemisphereLight('#f2f7f4','#8a8068',1.9));const rim=new T.DirectionalLight('#d9edf1',1.5);rim.position.set(2,6,-4);this.scene.add(rim);const fill=new T.DirectionalLight('#fff4df',1.6);fill.position.set(7,4,8);this.scene.add(fill);
  }
  setModel(model:LabModel):void {
    const shared=new Set(Object.values(this.materials));
    this.rig.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.LineSegments){o.geometry.dispose();for(const material of Array.isArray(o.material)?o.material:[o.material])if(material!==this.tint&&!shared.has(material)&&this.extraMaterials.has(material)){const texture=(material as T.MeshBasicMaterial).map;if(texture instanceof T.CanvasTexture){texture.dispose();this.labels=this.labels.filter(t=>t!==texture);}material.dispose();this.extraMaterials.delete(material);}}});this.rig.clear();this.model=model;this.actuator=new T.Group();this.rig.add(this.actuator);
    this.specimen=undefined;this.intactPane=undefined;this.piston=undefined;this.grains=undefined;this.water=undefined;this.waterSides=undefined;this.cracks=undefined;this.foam=undefined;this.rubberRest=undefined;
    this.tint.dispose();this.extraMaterials.delete(this.tint);
    const id=model.id,p=model.material;
    this.tint=this.own(new T.MeshPhysicalMaterial({color:p.color,roughness:id==='glass'?(p.id==='frosted'?.55:.08):id==='liquid'?.12:id==='rubber'?.47:.85,metalness:id==='granular'&&p.id==='steel'?.8:0,
      clearcoat:id==='liquid'||id==='glass'?1:id==='rubber'?.18:0,transparent:id==='glass'||id==='liquid',opacity:id==='glass'?.38:id==='liquid'?.82:1,side:T.DoubleSide,depthWrite:id!=='glass',envMapIntensity:id==='liquid'?1.4:.8}));
    if(id==='liquid'){this.tint.normalMap=this.ripple;this.tint.normalScale.set(.13,.13);this.tint.roughness=.075;this.tint.metalness=0;this.tint.opacity=1;this.tint.transmission=.48;this.tint.ior=1.333;this.tint.thickness=.35;this.tint.attenuationColor.set(p.color);this.tint.attenuationDistance=1.4;this.tint.color.lerp(new T.Color('#dcefee'),.12);this.ripple.repeat.set(2,2);}
    if(id==='concrete'){this.tint.map=this.library.materials.concrete.map;this.tint.bumpMap=this.library.materials.concrete.map;this.tint.bumpScale=.035;}
    if(id==='liquid'||id==='granular')this.buildTank();else if(id==='glass')this.buildGlassRig();else this.buildPressRig();
    this.update(model.frame);this.fit(this.view);
  }
  private feet(width:number,depth:number,top:number,parent:T.Object3D=this.rig):void {
    for(const x of [-width/2,width/2])for(const z of [-depth/2,depth/2]){this.cylinder(.11,.05,[x,.035,z],'black',parent);this.cylinder(.045,top-.08,[x,top/2,z],'chrome',parent);this.bolt(x,top,z,parent);}
  }
  private tray(width:number,depth:number,top:number):void {this.box([width,.12,depth],[0,top-.06,0],'steel',.025);for(const x of [-width/2,width/2])this.box([.1,.12,depth],[x,top+.04,0],'steel');for(const z of [-depth/2,depth/2])this.box([width,.12,.1],[0,top+.04,z],'steel');}
  private buildTank():void {
    const fluid=this.model.id==='liquid',y=fluid?.57:.58,w=6.3,d=fluid?2.3:2.04,wallHeight=fluid?1.1:1.5;
    this.feet(5.8,d-.18,.39);this.box([w,.22,d],[0,.4,0],'steel',.035);this.box([6.03,.065,d-.22],[0,y-.035,0],'chrome');
    for(const x of [-3.04,3.04])this.box([.035,wallHeight,d-.17],[x,y+wallHeight/2,0],'glass');
    for(const z of [-(d-.17)/2,(d-.17)/2])this.box([6.12,wallHeight,.024],[0,y+wallHeight/2,z],'glass');
    for(const x of [-3.1,3.1])for(const z of [-(d-.1)/2,(d-.1)/2]){this.box([.064,wallHeight+.13,.064],[x,y+wallHeight/2,z],'steel');for(let by=.1;by<wallHeight;by+=.24)this.bolt(x,y+by,z);}
    for(const z of [-(d-.1)/2,(d-.1)/2]){this.box([6.25,.065,.08],[0,y+wallHeight,z],'chrome');this.box([6.3,.13,.095],[0,y,z],'steel');for(let x=-2.8;x<3;x+=.28)this.bolt(x,y+.075,z);}
    for(const x of [-3,0,3])for(const z of [-d/2,d/2])this.box([.075,.28,.075],[x,.235,z],'steel');
    for(const z of [-d/2,d/2])this.box([6.15,.09,.09],[0,.2,z],'steel');
    const gx=fluid?-(3-18*6/56):-1.15;
    const guideHeight=wallHeight+(fluid?1.1:1.5)+.2;
    for(const z of [-d/2,d/2])this.box([.22,y-.51,.28],[gx,(y+.51)/2,z],'steel');
    for(const z of [-d/2,d/2])this.box([.12,guideHeight,.13],[gx,y+guideHeight/2,z],'steel');
    this.box([.17,.12,d+.2],[gx,y+guideHeight,0],'steel');
    this.box([.07,wallHeight,d-.18],[gx,y+wallHeight/2,0],fluid?'chrome':'orange',.01,this.actuator);
    this.cylinder(.035,.6,[gx,y+guideHeight+.22,0]);
    for(let yThread=y+guideHeight-.1;yThread<y+guideHeight+.48;yThread+=.042){const ring=this.mesh(new T.TorusGeometry(.039,.007,5,16),this.materials.chrome,[gx,yThread,0]);ring.rotation.x=Math.PI/2;}
    const hand=this.mesh(new T.TorusGeometry(.19,.022,10,40),this.materials.orange,[gx,y+guideHeight+.52,0]);hand.rotation.x=Math.PI/2;
    this.rod([gx-.19,y+guideHeight+.52,0],[gx+.19,y+guideHeight+.52,0],.018,'orange');
    if(fluid){
      for(const [x,z] of [[1.25,.48],[2,-.42]]){this.cylinder(.19,.65,[x,y+.325,z]);this.cylinder(.24,.06,[x,y+.03,z],'steel');}
      this.box([1.03,.48,.64],[1.2,.5,-1.85],'black',.05);this.box([.35,1.15,.52],[2.15,.92,-1.85],'white',.025);this.label('FLOW / 01',.3,.12,[2.15,1.19,-1.578]);
      this.box([1.18,.26,.76],[1.2,.13,-1.85],'steel',.02);this.box([.48,.345,.62],[2.15,.1725,-1.85],'steel',.02);
      const motor=this.cylinder(.24,.65,[1.2,.8,-1.85],'steel');motor.rotation.z=Math.PI/2;
      for(let x=.9;x<1.52;x+=.07){const fin=this.cylinder(.265,.018,[x,.8,-1.85],'mullion');fin.rotation.z=Math.PI/2;}
      for(const x of [2.05,2.2]){const button=this.cylinder(.025,.025,[x,1.12,-1.578],x<2.1?'orange':'black');button.rotation.x=Math.PI/2;}
      this.hose([[1.1,.72,-1.8],[.85,1.78,-1.83],[-1.9,1.78,-1.8],[-2.5,1.2,-.65]],.055);this.hose([[1.35,.67,-1.8],[1.9,.27,-1.75],[2.8,.35,-1.1]],.044);
      this.buildWater(this.model as LiquidModel);
    }else{
      this.cylinder(.27,.6,[1,y+.3,0]);this.box([.54,.27,.4],[0,.18,.2],'black',.015);this.label('VIB / 01',.36,.14,[0,.19,.405]);
      const m=this.model as GranularModel,g=new T.IcosahedronGeometry(m.radius,1);this.grains=new T.InstancedMesh(g,this.tint,m.count);this.grains.castShadow=true;this.grains.receiveShadow=true;this.grains.frustumCulled=false;this.rig.add(this.grains);
      const rng=random(m.settings.seed);for(let i=0;i<m.count;i++)this.grains.setColorAt(i,this.color.set(m.material.color).multiplyScalar(.74+rng()*.43));
    }
    this.label(LABS[this.model.id].code+'  /  '+LABS[this.model.id].title.toUpperCase(),2.6,.16,[0,.405,d/2+.011]);
  }
  private buildWater(m:LiquidModel):void {
    const g=new T.BufferGeometry(),n=m.h.length,positions=new Float32Array(n*3),uv=new Float32Array(n*2),indices:number[]=[];
    for(let z=0;z<m.nz;z++)for(let x=0;x<m.nx;x++){const i=z*m.nx+x;positions[i*3]=(x+.5)*m.dx-3;positions[i*3+2]=(z+.5)*m.dz-1;uv[i*2]=x/m.nx*3;uv[i*2+1]=z/m.nz;}
    for(let z=0;z<m.nz-1;z++)for(let x=0;x<m.nx-1;x++){const a=z*m.nx+x,b=a+1,c=a+m.nx,d=c+1;if(m.solid[a]||m.solid[b]||m.solid[c]||m.solid[d])continue;indices.push(a,c,b,b,c,d);}
    g.setAttribute('position',new T.BufferAttribute(positions,3).setUsage(T.DynamicDrawUsage));g.setAttribute('uv',new T.BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();
    this.water=this.mesh(g,this.tint,[0,0,0]);this.water.castShadow=false;this.water.frustumCulled=false;
    const sides=new T.BufferGeometry(),sideVertices=(m.nx+m.nz)*2*6;
    sides.setAttribute('position',new T.BufferAttribute(new Float32Array(sideVertices*3),3).setUsage(T.DynamicDrawUsage));
    sides.setAttribute('uv',new T.BufferAttribute(new Float32Array(sideVertices*2),2).setUsage(T.DynamicDrawUsage));
    this.waterSides=this.mesh(sides,this.tint,[0,0,0]);this.waterSides.castShadow=false;
    const foamMat=this.own(new T.MeshBasicMaterial({color:'#e5f9ef',transparent:true,opacity:.62,depthWrite:false}));this.foam=new T.InstancedMesh(new T.SphereGeometry(.023,5,3),foamMat,320);this.foam.count=0;this.foam.frustumCulled=false;this.rig.add(this.foam);
  }
  private buildGlassRig():void {
    const m=this.model as GlassModel;this.feet(3.1,1.42,.56);this.tray(3.4,1.62,.68);
    for(const x of [-1.52,1.52]){this.box([.17,3.24,.18],[x,2.4,0],'steel');this.box([.4,.1,.44],[x,.73,0],'steel');for(const z of [-.6,.6])this.rod([x,.77,z],[x,2.5,0],.037,'steel');}
    this.box([3.36,.3,.31],[0,4.17,0],'orange',.025);this.label('BOX3D / PENDULUM IMPACT',2.28,.19,[0,4.18,.162],'#de691b','#26312d');
    for(const x of [-1.32,1.32])for(const y of [1.6,2.45,3.3]){this.box([.21,.27,.12],[x,y,.03],'chrome',.014);this.box([.15,.21,.024],[x,y,.112],'rubber');this.bolt(x,y+.15,.065);}
    const rod=this.rod([m.impactX,0,0],[m.impactX,-1.9,0],.035,'chrome',this.actuator);rod.position.x=m.impactX;
    this.mesh(new T.SphereGeometry(.235,40,24),this.materials.chrome,[m.impactX,-1.9,.23],this.actuator);this.actuator.position.set(0,4.35,0);
    this.cylinder(.15,.3,[m.impactX,4.37,0],'steel').rotation.z=Math.PI/2;
    this.buildPieces(true);
    const paneMaterial=this.own(this.tint.clone());paneMaterial.transmission=.82;paneMaterial.opacity=1;paneMaterial.ior=1.5;paneMaterial.thickness=m.settings.size/1000;paneMaterial.envMapIntensity=1.25;
    this.intactPane=this.mesh(new T.BoxGeometry(m.panelWidth,m.panelHeight,m.settings.size/1000),paneMaterial,[0,m.panelCenterY,0]);this.intactPane.castShadow=false;
  }
  private buildPressRig():void {
    const rubber=this.model.id==='rubber',width=rubber?2.5:3.4,depth=rubber?1.65:2.7,height=rubber?3.75:4.9;
    this.feet(width-.3,depth-.3,.25);this.box([width,.48,depth],[0,.46,0],'steel',.045);this.label(LABS[this.model.id].code+'  /  BOX3D',width*.72,.23,[0,.47,depth/2+.006]);
    for(const x of [-width/2+.24,width/2-.24])for(const z of rubber?[-.1]:[-depth/2+.24,depth/2-.24]){
      this.cylinder(.11,height-.48,[x,(height+.48)/2,z]);this.cylinder(.18,.19,[x,.8,z],'black');this.cylinder(.18,.16,[x,height-.23,z],'black');this.bolt(x,.91,z);
    }
    const crownDepth=rubber?depth*.75:depth-.15;
    this.box([width+.1,.46,crownDepth],[0,height,0],rubber?'orange':'steel',.035);this.label(rubber?'ELASTOMER / COMPRESSION':'CONCRETE / COMPRESSION',width*.78,.18,[0,height,crownDepth/2+.004],rubber?'#e2742b':'#26302f',rubber?'#26302f':'#d5d7cc');
    this.cylinder(rubber?.3:.44,.59,[0,height-.525,0],'black');
    this.piston=this.cylinder(rubber?.095:.2,1,[0,1,0],'chrome',this.actuator);this.housingEnd=height-.3;
    if(rubber){
      this.cylinder(.66,.09,[0,.745,0],'steel');this.cylinder(.88,.21,[0,.895,0]);this.cylinder(.88,.21,[0,.105,0],'chrome',this.actuator);
      const g=new T.CylinderGeometry((this.model as RubberModel).radius,(this.model as RubberModel).radius,(this.model as RubberModel).initialHeight,72,32,false);this.rubberRest=(g.getAttribute('position').array as Float32Array).slice();this.specimen=this.mesh(g,this.tint,[0,0,0]);this.specimen.frustumCulled=false;
      this.trayRack();this.box([.28,.19,.22],[1.3,1.6,.25],'black',.02);this.rod([1.01,1.6,-.1],[1.3,1.6,.25],.025,'steel');this.hose([[1.25,1.6,.2],[1.55,2.4,.2],[1.3,3.65,0]],.028);
    }else{
      this.box([2.5,.13,1.7],[0,.765,0],'steel',.02);this.tray(2.7,1.9,.95);this.box([1.9,.19,1.9],[0,.095,0],'chrome',.016,this.actuator);this.buildPieces(false);
      if(this.model.material.retention)for(const x of [-.4,.4])for(const z of [-.4,.4]){this.cylinder(.037,1.45,[x,1.61,z],'steel');for(let y=1;y<2.2;y+=.085){const ring=this.mesh(new T.TorusGeometry(.04,.009,5,8),this.materials.chrome,[x,y,z]);ring.rotation.x=Math.PI/2;}}
      this.box([.78,1.2,.8],[2.45,.6,-.35],'orange',.035);this.label('HYDRAULIC / 03',.64,.15,[2.45,.96,.056],'#d87127','#29332d');this.hose([[2.5,1,-.65],[2.3,2.1,-1.6],[1.2,4.15,-.3],[.44,height-.55,0]],.056);this.hose([[2.25,.6,-.35],[1.7,.25,-1.35],[.3,.62,-1.4]],.045);
    }
  }
  private trayRack():void {
    this.box([1.15,.12,.72],[-2,.28,.2],'steel',.025);const colors=['#dc742b','#d6cba9'];for(let i=0;i<2;i++)this.mesh(new T.CylinderGeometry(.19,.19,.23,32),this.own(new T.MeshStandardMaterial({color:colors[i],roughness:.7})),[-2.27+i*.5,.455,.2]);for(const x of [-2.45,-1.55])for(const z of [-.08,.48])this.cylinder(.045,.22,[x,.11,z],'black');
  }
  private buildPieces(glass:boolean):void {
    const local:number[]=[],uv:number[]=[],colors:number[]=[],rng=random(this.model.settings.seed);this.ranges=[];
    const thickness=this.model.settings.size/1000;
    for(const piece of this.model.pieces){this.ranges.push(local.length/3);const tone=.98+rng()*.035;
      const verts=glass?[...piece.vertices.map(p=>[p[0],p[1],-thickness/2] as V3),...piece.vertices.map(p=>[p[0],p[1],thickness/2] as V3)]:piece.vertices;
      const indices=glass?[0,2,1,3,4,5,0,1,4,0,4,3,1,2,5,1,5,4,2,0,3,2,3,5]:faces;
      for(let j=0;j<indices.length;j++){const v=verts[indices[j]];local.push(...v);if(glass)uv.push(v[0],v[1]);else{const start=Math.floor(j/3)*3,a=new T.Vector3(...verts[indices[start]]),b=new T.Vector3(...verts[indices[start+1]]),c=new T.Vector3(...verts[indices[start+2]]),n=b.sub(a).cross(c.sub(a));const x=v[0]+piece.center[0],y=v[1]+piece.center[1],z=v[2]+piece.center[2];if(Math.abs(n.y)>Math.max(Math.abs(n.x),Math.abs(n.z)))uv.push(x,z);else if(Math.abs(n.x)>Math.abs(n.z))uv.push(z,y);else uv.push(x,y);}colors.push(tone,tone,tone);}
    }
    this.ranges.push(local.length/3);this.localVertices=Float32Array.from(local);
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(local.length),3).setUsage(T.DynamicDrawUsage));g.setAttribute('uv',new T.BufferAttribute(Float32Array.from(uv),2));
    if(!glass){g.setAttribute('color',new T.BufferAttribute(Float32Array.from(colors),3));this.tint.vertexColors=true;}
    this.specimen=this.mesh(g,this.tint,[0,0,0]);this.specimen.frustumCulled=false;this.specimen.castShadow=!glass;
    if(glass){const edges=new T.BufferGeometry();edges.setAttribute('position',new T.BufferAttribute(new Float32Array(this.model.pieces.length*18),3).setUsage(T.DynamicDrawUsage));this.cracks=new T.LineSegments(edges,this.own(new T.LineBasicMaterial({color:'#b5dad4',transparent:true,opacity:.35})));this.cracks.frustumCulled=false;this.rig.add(this.cracks);}
  }
  update(f:LabFrame):void {
    this.lastFrame=f;const m=this.model;
    if(m.id==='liquid')this.updateWater(m as LiquidModel,f);
    if(m.id==='granular'&&this.grains){for(let i=0;i<(m as GranularModel).count;i++){this.dummy.position.fromArray(f.positions,i*3);this.dummy.rotation.set(0,0,0);this.dummy.scale.set(1,1,1);this.dummy.updateMatrix();this.grains.setMatrixAt(i,this.dummy.matrix);}this.grains.instanceMatrix.needsUpdate=true;}
    if(m.id==='glass'){this.actuator.rotation.x=-f.actuator;const fractured=f.damage.some(d=>d>0);if(this.intactPane)this.intactPane.visible=!fractured;this.specimen!.visible=fractured;this.updatePieces(f,true);}
    if(m.id==='concrete'){this.actuator.position.y=f.actuator;this.updatePieces(f,false);}
    if(m.id==='rubber'&&this.specimen&&this.rubberRest){
      const g=this.specimen.geometry,p=g.getAttribute('position'),height=f.positions[0],radius=f.positions[1],rubber=m as RubberModel;
      // Normalize the bulge profile so the radial shape does not invent volume.
      const b=f.positions[2]*.16,norm=Math.sqrt(1+4*b/3+8*b*b/15);
      for(let i=0;i<p.count;i++){const y=this.rubberRest[i*3+1]/rubber.initialHeight+.5,scale=radius/rubber.radius*(1+b*4*y*(1-y))/norm;p.setXYZ(i,this.rubberRest[i*3]*scale,1+y*height,this.rubberRest[i*3+2]*scale);}
      p.needsUpdate=true;g.computeVertexNormals();this.actuator.position.y=f.actuator;
    }
    if(m.id==='liquid'||m.id==='granular')this.actuator.position.y=f.actuator;
    if(this.piston){const h=Math.max(.1,this.housingEnd-f.actuator-.21);this.piston.scale.y=h;this.piston.position.y=.21+h/2;}
  }
  private updatePieces(f:LabFrame,glass:boolean):void {
    const g=this.specimen!.geometry,positions=g.getAttribute('position');let edgeCount=0;const edges=this.cracks?.geometry.getAttribute('position');
    for(let i=0;i<this.model.pieces.length;i++){
      this.dummy.position.fromArray(f.positions,i*3);this.dummy.rotation.set(f.rotations[i*3],f.rotations[i*3+1],f.rotations[i*3+2]);this.dummy.scale.set(1,1,1);this.dummy.updateMatrix();const e=this.dummy.matrix.elements;
      for(let j=this.ranges[i];j<this.ranges[i+1];j++){const x=this.localVertices[j*3],y=this.localVertices[j*3+1],z=this.localVertices[j*3+2];positions.setXYZ(j,e[0]*x+e[4]*y+e[8]*z+e[12],e[1]*x+e[5]*y+e[9]*z+e[13],e[2]*x+e[6]*y+e[10]*z+e[14]);}
      if(glass&&f.damage[i]&&edges){const first=this.ranges[i];for(let a=0;a<3;a++)for(const b of [a,(a+1)%3])edges.setXYZ(edgeCount++,positions.getX(first+b),positions.getY(first+b),positions.getZ(first+b)+.004);}
    }
    positions.needsUpdate=true;g.computeVertexNormals();if(edges&&this.cracks){edges.needsUpdate=true;this.cracks.geometry.setDrawRange(0,edgeCount);}
  }
  private updateWater(m:LiquidModel,f:LabFrame):void {
    this.ripple.offset.set(-f.time*.025,-f.time*.009);const wave=Math.min(1,f.metrics[1]);this.tint.normalScale.setScalar(.055+wave*.11);
    const p=this.water!.geometry.getAttribute('position');let foamCount=0;
    for(let z=0;z<m.nz;z++)for(let x=0;x<m.nx;x++){
      const i=z*m.nx+x,h=f.positions[i];p.setY(i,.57+h);
      const dh=x&&x<m.nx-1?Math.abs(f.positions[i+1]-f.positions[i-1]):0,speed=Math.hypot(f.rotations[i*2],f.rotations[i*2+1]);
      if(!m.solid[i]&&foamCount<320&&((dh>.07&&i%3===0)||(speed>.35&&Math.abs(x-39)<5&&i%9===0))){this.dummy.position.set(p.getX(i),.58+h,p.getZ(i));this.dummy.rotation.set(0,0,0);this.dummy.scale.set(1.4,.35,1);this.dummy.updateMatrix();this.foam!.setMatrixAt(foamCount++,this.dummy.matrix);}
    }
    p.needsUpdate=true;this.water!.geometry.computeVertexNormals();this.foam!.count=foamCount;this.foam!.instanceMatrix.needsUpdate=true;
    const sides=this.waterSides!.geometry.getAttribute('position'),sideUv=this.waterSides!.geometry.getAttribute('uv');let count=0;
    const edge=(a:number,b:number)=>{
      const alongX=Math.abs(p.getX(b)-p.getX(a))>Math.abs(p.getZ(b)-p.getZ(a));
      for(const [i,up] of [[a,0],[a,1],[b,1],[a,0],[b,1],[b,0]]){
        const y=up?p.getY(i):.57;
        sides.setXYZ(count,p.getX(i),y,p.getZ(i));
        sideUv.setXY(count++,(alongX?p.getX(i)+3:p.getZ(i)+1)*.5,(y-.57)*.5);
      }
    };
    for(let x=0;x<m.nx-1;x++){edge(x,x+1);edge((m.nz-1)*m.nx+x+1,(m.nz-1)*m.nx+x);}
    for(let z=0;z<m.nz-1;z++){edge((z+1)*m.nx,z*m.nx);edge(z*m.nx+m.nx-1,(z+1)*m.nx+m.nx-1);}
    sides.needsUpdate=true;sideUv.needsUpdate=true;this.waterSides!.geometry.setDrawRange(0,count);this.waterSides!.geometry.computeVertexNormals();
  }
  fit(view:LabView='hero'):void {
    this.view=view;this.rig.updateMatrixWorld(true);const bounds=new T.Box3().setFromObject(this.rig),center=bounds.getCenter(new T.Vector3());
    const fitPoints:T.Vector3[]=[];
    this.rig.traverse(o=>{if(o instanceof T.Mesh&&o.visible&&!(o instanceof T.InstancedMesh)){o.geometry.computeBoundingBox();const box=o.geometry.boundingBox;if(box)for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z])fitPoints.push(new T.Vector3(x,y,z).applyMatrix4(o.matrixWorld));}});
    const vertical=this.model.id==='glass'||this.model.id==='concrete'||this.model.id==='rubber';
    const dir=view==='top'?new T.Vector3(.001,1,.001):view==='detail'?new T.Vector3(.2,.35,1):new T.Vector3(vertical?.35:.58,vertical?.23:.24,1);dir.normalize();
    if(view==='detail'){center.set(0,this.model.id==='glass'?2.35:this.model.id==='rubber'?1.45:1.3,0);this.camera.position.copy(center).addScaledVector(dir,vertical?4.4:6);}
    else{
      let near=2,far=32,distance=far;for(let iteration=0;iteration<18;iteration++){
        distance=(near+far)/2;
        this.camera.position.copy(center).addScaledVector(dir,distance);this.camera.lookAt(center);this.camera.updateMatrixWorld(true);let maximum=0;
        for(const point of fitPoints){const p=point.clone().project(this.camera);maximum=Math.max(maximum,Math.abs(p.x)/.93,Math.abs(p.y)/.9);}
        if(maximum<=1)far=distance;else near=distance;
      }
      this.camera.position.copy(center).addScaledVector(dir,far);
    }
    this.controls.target.copy(center);this.camera.lookAt(center);this.controls.update();
  }
  setLighting(warm:boolean):void {this.key.color.set(warm?'#ffdcab':'#fff5df');this.key.intensity=warm?3:3.2;this.renderer.toneMappingExposure=warm?.9:1;}
  setRotate(on:boolean):void {this.rotate=on;this.controls.autoRotate=on;this.controls.autoRotateSpeed=.4;}
  resize():void {if(this.disposed)return;const w=this.host.clientWidth,h=this.host.clientHeight;if(!w||!h)return;this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();if(Object.keys(this.materials).length)this.fit(this.view);}
  render():void {if(this.disposed)return;this.controls.update();this.renderer.render(this.scene,this.camera);}
  async capture():Promise<string>{await this.renderer.renderAsync(this.scene,this.camera);return this.renderer.domElement.toDataURL('image/png');}
  get backend():string{return (this.renderer.backend as unknown as {isWebGPUBackend?:boolean}).isWebGPUBackend?'WebGPU':'WebGL';}
  dispose():void {if(this.disposed)return;this.disposed=true;this.observer.disconnect();this.controls.dispose();this.scene.traverse(o=>{if(o instanceof T.Mesh||o instanceof T.LineSegments)o.geometry.dispose();});this.labels.forEach(t=>t.dispose());this.extraMaterials.forEach(m=>m.dispose());this.ripple.dispose();this.library.dispose();this.environment?.dispose();this.panorama?.dispose();this.renderer.dispose();this.renderer.domElement.remove();}
}
