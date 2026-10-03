import * as T from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { WaterMesh } from 'three/addons/objects/WaterMesh.js';
import { StudioMaterials } from './materials';
import { skyTexture, studioEnvironment, riverNormals } from './lighting';
import { finishFor, lightingFor, type FinishPreset, type LightingPreset, type CameraPreset } from './presets';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pass, vec3, vec4, mix, mrt, output, normalView, renderOutput, texture, positionWorld, smoothstep } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { FailureSimulation, STUDIES, terrainHeight, type Snapshot, type Vec, type StudyId } from './physics';

const UP = new T.Vector3(0,1,0);
const seeded = (n: number) => { const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x); };

/** All visible structures are actual geometry. Generated images are material maps only. */
export class StudioWorld {
  readonly renderer: T.WebGPURenderer;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(43,1,.1,900);
  readonly controls: OrbitControls;
  readonly root = new T.Group();
  private surface?: T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;
  private naturalMaterial?: T.MeshStandardMaterial;
  private analysisMaterial?: T.MeshStandardMaterial;
  private linksMesh?: T.InstancedMesh;
  private borderMesh?: T.InstancedMesh;
  private decks?: T.InstancedMesh;
  private railPosts?: T.InstancedMesh;
  private rails?: T.InstancedMesh;
  private ram = new T.Group();
  private water?: WaterMesh;
  private library=new StudioMaterials();
  private sun?:T.DirectionalLight;
  private fill?:T.DirectionalLight;
  private hemisphere?:T.HemisphereLight;
  private sky?:T.DataTexture;
  private exteriorEnvironment?:T.RenderTarget;
  private interiorEnvironment?:T.RenderTarget;
  private environmentGenerator?:T.PMREMGenerator;
  private rippleNormals=riverNormals();
  private look=lightingFor();
  private ownedMaterials=new Set<T.Material>();
  private stitches?:T.InstancedMesh;
  private stitchLinks:number[]=[];
  private panelSeams?:T.InstancedMesh;
  private seamLinks:number[]=[];
  private plateEdges?:T.InstancedMesh;
  private exposedEdges:[number,number][]=[];
  private deckBolts?:T.InstancedMesh;
  private cableClamps?:T.InstancedMesh;
  private currentFinish=finishFor('canopy');
  private finishRevision=0;
  private cameraPreset:CameraPreset='hero';
  private renderQuality:'balanced'|'ultra'='ultra';
  private fps=0;
  private lastFpsTime=0;
  private fpsFrames=0;
  private sim: FailureSimulation;
  private materials: Record<string,T.MeshStandardMaterial> = {};
  private cylinder = new T.CylinderGeometry(1,1,1,10);
  private dummy = new T.Object3D();
  private resizeObserver: ResizeObserver;
  private lastTopology = -1;
  private lastSnapshot?: Snapshot;
  private responseMode = false;
  private strainColor = new T.Color();
  private frame = 0;
  private pipeline?: T.RenderPipeline;
  private compactFraming=false;

  constructor(private host: HTMLElement, simulation: FailureSimulation) {
    this.sim=simulation;
    this.renderer=new T.WebGPURenderer({antialias:true,alpha:false});
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));
    this.renderer.toneMapping=T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure=.94;
    this.renderer.shadowMap.enabled=true;
    this.renderer.shadowMap.type=T.PCFShadowMap;
    this.host.append(this.renderer.domElement);
    this.renderer.domElement.setAttribute('aria-label','Interactive 3D simulation. Drag to orbit, scroll to zoom.');
    this.renderer.domElement.setAttribute('role','img');
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.controls.enableDamping=true;this.controls.dampingFactor=.075;
    this.controls.maxPolarAngle=Math.PI*.49;
    this.controls.minDistance=3;this.controls.maxDistance=110;
    this.scene.add(this.root);
    this.resizeObserver=new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(host);
  }

  async init(): Promise<void> {
    await this.renderer.init();
    this.interiorEnvironment=studioEnvironment(this.renderer);
    this.environmentGenerator=new T.PMREMGenerator(this.renderer);
    await this.library.init();this.materials=this.library.materials;
    const [fabric,sheet,wood]=await Promise.all((['canopy','plate','bridge'] as StudyId[]).map(id=>this.library.finish(finishFor(id))));
    Object.assign(this.materials,{fabric,sheet,wood});
    const scenePass=pass(this.scene,this.camera,{samples:0});
    scenePass.setMRT(mrt({output,normal:normalView}));
    const ambient=ao(scenePass.getTextureNode('depth'),scenePass.getTextureNode('normal'),this.camera);
    ambient.resolutionScale=.5;ambient.radius.value=.8;ambient.thickness.value=1.2;
    this.pipeline=new T.RenderPipeline(this.renderer);
    const shaded=scenePass.getTextureNode('output').mul(vec4(vec3(mix(1,ambient.getTextureNode().r,.48)),1));
    this.pipeline.outputNode=fxaa(renderOutput(shaded));
    this.pipeline.outputColorTransform=false;
    this.build(this.sim);
    this.resize();
  }

  private mesh(geometry:T.BufferGeometry, material:T.Material, p:Vec, parent:T.Object3D=this.root):T.Mesh {
    const mesh=new T.Mesh(geometry,material);mesh.position.set(...p);mesh.castShadow=true;mesh.receiveShadow=true;parent.add(mesh);return mesh;
  }
  private box(size:Vec,p:Vec,mat='steel',bevel=0,parent:T.Object3D=this.root):T.Mesh {
    return this.mesh(bevel?new RoundedBoxGeometry(...size,2,bevel):new T.BoxGeometry(...size),this.materials[mat],p,parent);
  }
  private cyl(radius:number,length:number,p:Vec,mat='chrome',r2=radius,parent:T.Object3D=this.root):T.Mesh {
    return this.mesh(new T.CylinderGeometry(radius,r2,length,24),this.materials[mat],p,parent);
  }
  private rod(a:Vec,b:Vec,r:number,mat='steel',parent:T.Object3D=this.root):T.Mesh {
    const d=new T.Vector3(...b).sub(new T.Vector3(...a));
    const mesh=this.mesh(new T.CylinderGeometry(r,r,d.length(),12),this.materials[mat],[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],parent);
    mesh.quaternion.setFromUnitVectors(UP,d.normalize());return mesh;
  }
  private beam(a:Vec,b:Vec,width:number,depth:number,mat='steel'):T.Mesh {
    const d=new T.Vector3(...b).sub(new T.Vector3(...a));
    const mesh=this.box([width,d.length(),depth],[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2],mat);
    mesh.quaternion.setFromUnitVectors(UP,d.normalize());return mesh;
  }
  private bolt(x:number,y:number,z:number,size=.065):void {
    this.cyl(size*1.45,.025,[x,y,z],'steel');
    this.mesh(new T.CylinderGeometry(size,size,.06,6),this.materials.bolt,[x,y+.04,z]);
    this.cyl(size*.5,.045,[x,y+.08,z],'chrome');
  }
  private iColumn(x:number,z:number,base:number,height:number,width=.26):void {
    this.box([width,.07,height>10?width*1.1:width],[x,base+height,z],'steel');
    for(const dx of [-width*.5,width*.5]) this.box([.055,height,width],[x+dx,base+height/2,z],'steel');
    this.box([width,height,.055],[x,base+height/2,z],'steel');
  }

  private build(sim:FailureSimulation):void {
    this.finishRevision++;
    this.root.traverse(o=>{if(o instanceof T.Mesh && o.geometry!==this.cylinder)o.geometry.dispose();if(o instanceof T.Light)o.dispose();});
    this.ownedMaterials.forEach(m=>m.dispose());this.ownedMaterials.clear();
    this.analysisMaterial?.dispose();
    this.root.clear();this.sim=sim;this.surface=undefined;this.linksMesh=undefined;this.decks=undefined;
    this.borderMesh=undefined;this.railPosts=undefined;this.rails=undefined;this.water=undefined;
    this.stitches=undefined;this.panelSeams=undefined;this.plateEdges=undefined;this.deckBolts=undefined;this.cableClamps=undefined;
    this.lastTopology=-1;this.lastSnapshot=undefined;
    const outdoor=sim.id==='bridge';
    this.hemisphere=new T.HemisphereLight();this.root.add(this.hemisphere);
    this.sun=new T.DirectionalLight();this.sun.castShadow=true;this.sun.shadow.mapSize.set(4096,4096);
    const extent=outdoor?35:15;
    Object.assign(this.sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:.1,far:110});
    this.sun.shadow.bias=-.0002;this.sun.shadow.normalBias=.028;this.root.add(this.sun);
    this.fill=new T.DirectionalLight();this.fill.position.set(12,9,-15);this.root.add(this.fill);
    if(outdoor) {this.buildLandscape();this.buildBridge();}
    else {this.buildHall();if(sim.id==='canopy')this.buildCanopy();else this.buildPress();this.buildSurface();}
    this.mergeStaticGeometry();this.setLighting(this.look);this.fit();this.update(sim.snapshot(),false);
  }
  attach(host:HTMLElement):void {this.resizeObserver.disconnect();this.host=host;host.append(this.renderer.domElement);this.resizeObserver.observe(host);this.resize();}
  async changeStudy(sim:FailureSimulation):Promise<void> {
    this.build(sim);await this.applyFinish(finishFor(sim.id));
  }
  async applyFinish(p:FinishPreset):Promise<void> {
    if(p.study!==this.sim.id)return;
    const revision=++this.finishRevision,next=await this.library.finish(p);
    if(revision!==this.finishRevision){next.dispose();return;}
    const key=p.study==='canopy'?'fabric':p.study==='plate'?'sheet':'wood',previous=this.materials[key];
    this.root.traverse(o=>{if(o instanceof T.Mesh&&o.material===previous)o.material=next;});
    this.materials[key]=next;this.currentFinish=p;
    if(this.surface){this.naturalMaterial=next;if(!this.responseMode)this.surface.material=next;}
    previous.dispose();
  }
  setLighting(p:LightingPreset):void {
    this.look=p;
    const outdoor=this.sim.id==='bridge',sky=skyTexture(p),oldSky=this.sky,oldEnvironment=this.exteriorEnvironment;
    this.sky=sky;this.scene.background=sky;
    this.scene.backgroundBlurriness=.045;
    this.scene.fog=new T.Fog(p.horizon,outdoor?95/p.haze:45,outdoor?390/p.haze:140);
    this.exteriorEnvironment=outdoor?this.environmentGenerator!.fromEquirectangular(sky):undefined;
    this.scene.environment=outdoor?this.exteriorEnvironment!.texture:this.interiorEnvironment!.texture;
    this.scene.environmentIntensity=p.environment;
    this.renderer.toneMappingExposure=p.exposure;
    this.sun!.color.set(p.key);this.sun!.intensity=p.intensity;this.sun!.position.set(...p.sun);
    this.hemisphere!.color.set(p.sky);this.hemisphere!.groundColor.set(p.ground);this.hemisphere!.intensity=p.ambient;
    this.fill!.color.set(p.fill);this.fill!.intensity=p.ambient*.52;
    if(this.water){this.water.sunDirection.value.set(...p.sun).normalize();this.water.sunColor.value.set(p.key);}
    oldSky?.dispose();oldEnvironment?.dispose();
  }
  setQuality(quality:'balanced'|'ultra'):void {
    this.renderQuality=quality;
    const nativeRatio=Math.min(window.devicePixelRatio,2);
    this.renderer.setPixelRatio(quality==='ultra'?nativeRatio:Math.min(nativeRatio*.75,1.25));
    // Keep the shadow target stable. Resizing it after compilation leaves stale
    // WebGPU bindings in the current Three.js node pipeline. Balanced reduces
    // output resolution while retaining the same fine shadow detail.
    this.resize();
  }
  resetModel(sim:FailureSimulation):void {this.sim=sim;this.lastTopology=-1;this.lastSnapshot=undefined;this.update(sim.snapshot(),this.responseMode);}

  private buildHall():void {
    this.box([64,.25,64],[0,-.14,0],'floor');
    for(let v=-28;v<=28;v+=4) {
      this.box([.017,.008,58],[v,.001,0],'dark');this.box([58,.008,.017],[0,.002,v],'dark');
    }
    for(let x=-18;x<=18;x+=6) {
      this.iColumn(x,-12,0,18,.45);
      this.box([5.6,2.2,.3],[x+3,1.1,-12.2],'wall');
      this.box([5.6,1.4,.3],[x+3,11.2,-12.2],'wall');
      for(let ox=0;ox<=5.8;ox+=1.45) this.box([.08,8.8,.13],[x+ox,6.5,-12.1],'dark');
      for(let y=2.2;y<=10.8;y+=2.15) this.box([5.8,.08,.13],[x+2.9,y,-12.1],'dark');
      const glazing=this.box([5.65,8.5,.025],[x+2.9,6.5,-12.25],'glass');glazing.castShadow=false;
      this.beam([x,17.6,-12],[x,18.3,16],.24,.36,'steel');
    }
    for(let z=-10;z<=14;z+=6) {
      this.iColumn(-17,z,0,12,.42);
      this.box([.3,12,5.4],[-17.3,6,z+3],'wall');
      this.beam([-16.9,2,z],[-16.9,10,z+6],.13,.13,'steel');
    }
    // Quiet workshop context: storage, worktops and conduits at full scene scale.
    for(let i=0;i<4;i++) {
      const x=-10+i*3.6;
      this.box([2.9,1.3,.8],[x,.65,-10.5],'dark',.04);
      this.box([3.1,.12,1],[x,1.36,-10.4],'wood',.025);
      for(let d=0;d<3;d++) {this.box([2.65,.012,.02],[x,.35+d*.3,-10.07],'steel');this.box([.35,.04,.04],[x,.48+d*.3,-10.01],'chrome');}
      this.box([.7,.04,.55],[x-.6,1.45,-10.4],'chrome');
      this.cyl(.16,.2,[x+.8,1.54,-10.4],'black');
      this.rod([x,1.45,-10.7],[x,2.15,-10.7],.025,'steel');
      this.rod([x,2.15,-10.7],[x+.4,2.32,-10.3],.025,'steel');
      this.box([.55,.035,.26],[x+.4,2.3,-10.3],'lamp');
    }
    for(let z=-10;z<=10;z+=4) this.rod([-16.4,.4,z],[-16.4,10.5,z],.035,'steel');
    // Painted test boundary is geometry on the concrete, not a composited image.
    const w=this.sim.id==='canopy'?7:5, d=this.sim.id==='canopy'?6:4.6;
    for(let x=-w;x<w;x+=.6)for(const z of [-d,d])this.box([.36,.004,.06],[x,.008,z],'yellow');
    for(let z=-d;z<d;z+=.6)for(const x of [-w,w])this.box([.06,.004,.36],[x,.008,z],'yellow');
  }

  private buildCanopy():void {
    const {span,depth,supportY}=STUDIES.canopy;
    for(const sx of [-1,1]) for(const sz of [-1,1]) {
      const x=sx*(span/2+.65),z=sz*(depth/2+.65),y=supportY+.23;
      this.box([.85,.13,.85],[x,.075,z],'steel',.045);
      this.iColumn(x,z,.14,y-.14,.22);
      this.box([.42,.1,.42],[x,y,z],'chrome',.022);
      for(const dx of [-.3,.3])for(const dz of [-.3,.3])this.bolt(x+dx,.15,z+dz,.075);
      // Four gussets seat on the base plate and brace the web.
      for(const dx of [-.21,.21]) this.beam([x+dx,.14,z],[x,.7,z],.055,.19);
      const a:Vec=[sx*span/2,supportY,sz*depth/2],b:Vec=[x,y+.18,z];
      this.rod(a,b,.025,'chrome');
      const mid:Vec=[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
      const m=this.rod([mid[0]-.09*sx,mid[1]-.025,mid[2]-.09*sz],[mid[0]+.09*sx,mid[1]+.025,mid[2]+.09*sz],.065,'chrome');m.name='threaded turnbuckle';
      this.cyl(.055,.17,[x,y+.13,z],'bolt');
      const ring=this.mesh(new T.TorusGeometry(.095,.022,8,20),this.materials.chrome,a);ring.rotation.x=Math.PI/2;
      for(const t of [.28,.34,.4,.6,.66,.72]) {
        const q:Vec=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
        const thread=this.mesh(new T.TorusGeometry(.03,.009,5,12),this.materials.bolt,q);
        thread.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(...b).sub(new T.Vector3(...a)).normalize());
      }
      for(const side of [-1,1])this.box([.055,.25,.18],[x+side*.09,y+.16,z],'steel',.015);
    }
    const perimeter=2*(this.sim.config.cols+this.sim.config.rows)-4;
    this.borderMesh=new T.InstancedMesh(this.cylinder,this.materials.fabric,perimeter);
    this.borderMesh.castShadow=true;this.root.add(this.borderMesh);
    const {cols,rows}=this.sim.config;
    this.seamLinks=this.sim.links.flatMap((e,i)=>e.kind==='weft'&&[8,16,24].includes(e.a%cols)?[i]:[]);
    this.stitchLinks=this.sim.links.flatMap((e,i)=>e.kind==='warp'&&[1,rows-2].includes(Math.floor(e.a/cols))||e.kind==='weft'&&[1,cols-2].includes(e.a%cols)?[i]:[]);
    this.panelSeams=new T.InstancedMesh(this.cylinder,this.materials.seam,this.seamLinks.length);this.panelSeams.castShadow=true;
    this.stitches=new T.InstancedMesh(this.cylinder,this.materials.seam,this.stitchLinks.length*3);
    this.root.add(this.panelSeams,this.stitches);
  }

  private buildPress():void {
    this.box([7.4,1.25,6.4],[0,.725,0],'black',.11);
    this.box([7.5,.23,6.5],[0,1.465,0],'steel',.035);
    for(let x=-3.1;x<=3.2;x+=.45) this.box([.12,.04,5.6],[x,1.6,0],'black');
    for(const x of [-3.12,3.12])for(const z of [-2.64,2.64]) {
      this.cyl(.33,.28,[x,1.73,z],'black');this.cyl(.21,5.12,[x,4.37,z],'chrome');
      this.cyl(.28,.29,[x,6.9,z],'steel');this.cyl(.28,.25,[x,2.04,z],'steel');
      for(const dx of [-.3,.3])this.bolt(x+dx,1.6,z,.09);
    }
    this.box([7.65,.9,6.65],[0,7.32,0],'black',.14);
    this.box([3.45,.45,3.4],[0,6.67,0],'steel',.065);
    this.cyl(1.24,.65,[0,6.36,0],'chrome');this.cyl(.94,.68,[0,5.79,0],'steel');
    // Static support rails meet the pinned sheet perimeter at exactly y = 3.15.
    const y=STUDIES.plate.supportY;
    for(const x of [-2.72,2.72]) {
      this.box([.26,1.56,4.66],[x,y-.78,0],'black',.02);
      this.box([.48,.15,4.8],[x,y-.075,0],'steel',.025);
    }
    for(const z of [-2.32,2.32]) this.box([5.22,.15,.48],[0,y-.075,z],'steel',.025);
    for(const x of [-2.64,2.64])for(const z of [-2.2,2.2]) {
      this.cyl(.075,.8,[x,3.1,z],'chrome');this.box([.48,.12,.4],[x,3.27,z],'black',.025);this.bolt(x,3.36,z,.095);
    }
    this.ram=new T.Group();this.root.add(this.ram);
    this.cyl(.36,3.5,[0,2.3,0],'chrome',.36,this.ram);
    this.cyl(.49,.24,[0,.53,0],'black',.49,this.ram);
    this.cyl(.64,.25,[0,.28,0],'chrome',.64,this.ram);
    this.cyl(.86,.18,[0,.08,0],'chrome',.78,this.ram);
    // Hydraulic hoses, service plate and warning detail belong to the fixed fixture.
    for(const dz of [0,.22]) {
      const hose=new T.CatmullRomCurve3([[1,5.95,1+dz],[1.8,5.9,1+dz],[2.25,5.3,1+dz],[2.5,4.4,1+dz],[3.4,3.8,1.3+dz],[3.55,1.1,1.5+dz]].map(v=>new T.Vector3(...v)));
      this.mesh(new T.TubeGeometry(hose,40,.065,8,false),this.materials.rubber,[0,0,0]);
      this.cyl(.12,.16,[1,5.96,1+dz],'bolt');
    }
    for(const x of [-3.15,3.15])for(const z of [-2.65,2.65]) {
      this.cyl(.38,.09,[x,7.82,z],'steel');this.bolt(x,7.89,z,.19);
      for(const y of [2.35,6.7])this.cyl(.226,.045,[x,y,z],'rubber');
    }
    for(const x of [-2.4,-1.8,1.8,2.4])for(const z of [-2.9,2.9])this.bolt(x,1.6,z,.09);
    // The dial is a fixture scale, not an invented pressure readout.
    const gauge=new T.Group();gauge.position.set(3.5,4.1,2.2);gauge.rotation.x=-Math.PI/2;this.root.add(gauge);
    this.cyl(.25,.11,[0,0,0],'chrome',.25,gauge);this.cyl(.214,.012,[0,-.065,0],'wall',.214,gauge);
    for(let k=0;k<13;k++){const a=-2.3+k*.38;this.rod([Math.sin(a)*.17,-.075,Math.cos(a)*.17],[Math.sin(a)*.2,-.075,Math.cos(a)*.2],.005,'black',gauge);}
    this.rod([0,-.079,0],[.105,-.079,-.09],.008,'orange',gauge);
    this.box([.9,.34,.02],[2.4,7.27,3.34],'orange',.015);
    this.box([1.3,.2,.03],[-2.2,.8,3.21],'steel');
  }

  private buildSurface():void {
    const sim=this.sim, n=sim.nodes.length;
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(n*3),3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('color',new T.BufferAttribute(new Float32Array(n*3).fill(1),3).setUsage(T.DynamicDrawUsage));
    const uv=new Float32Array(n*2);
    for(let i=0;i<n;i++) {uv[i*2]=(i%sim.config.cols)/(sim.config.cols-1);uv[i*2+1]=Math.floor(i/sim.config.cols)/(sim.config.rows-1);}
    g.setAttribute('uv',new T.BufferAttribute(uv,2));
    g.setIndex(new T.BufferAttribute(new Uint32Array(sim.faces.length*3),1).setUsage(T.DynamicDrawUsage));
    const mat=this.materials[sim.id==='plate'?'sheet':'fabric'];
    this.naturalMaterial=mat;
    this.analysisMaterial=new T.MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:.7,metalness:.05,side:T.DoubleSide});
    this.surface=new T.Mesh(g,mat);this.surface.castShadow=true;this.surface.receiveShadow=true;this.surface.frustumCulled=false;this.root.add(this.surface);
    if(sim.id==='plate'){
      this.plateEdges=new T.InstancedMesh(this.cylinder,this.materials.chrome,sim.faces.length*3);
      this.plateEdges.castShadow=true;this.plateEdges.frustumCulled=false;this.root.add(this.plateEdges);
    }
  }

  private buildLandscape():void {
    const geometry=new T.PlaneGeometry(320,300,180,140);geometry.rotateX(-Math.PI/2);
    const p=geometry.getAttribute('position');const colors=new Float32Array(p.count*3);const c=new T.Color();
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),z=p.getZ(i);let y=terrainHeight(x,z);
      const far=Math.max(0,Math.abs(x)-38)+Math.max(0,Math.abs(z)-42)*.5;
      y+=far*.2*(1.2+Math.sin(x*.035+z*.044)*.65+Math.cos(z*.08)*.25);
      p.setY(i,y);c.setHSL(.21+seeded(i)*.02,.08+seeded(i+4)*.08,.76+seeded(i+8)*.13);
      if(Math.abs(x)<17)c.set('#babbb0');c.toArray(colors,i*3);
    }
    geometry.setAttribute('color',new T.BufferAttribute(colors,3));geometry.computeVertexNormals();
    const groundMat=new T.MeshStandardNodeMaterial({roughness:.98,vertexColors:true,bumpMap:this.materials.soil.map,bumpScale:.055});
    const bankBlend=smoothstep(18,26,positionWorld.x.abs());
    groundMat.colorNode=mix(texture(this.materials.soil.map!),texture(this.materials.moss.map!),bankBlend);
    this.ownedMaterials.add(groundMat);
    this.mesh(geometry,groundMat,[0,0,0]);
    this.water=new WaterMesh(new T.PlaneGeometry(34,280),{waterNormals:this.rippleNormals,sunDirection:new T.Vector3(...this.look.sun).normalize(),sunColor:this.look.key,waterColor:'#224c4d',distortionScale:1.7,size:11,resolutionScale:.5});
    this.water.rotation.x=-Math.PI/2;this.water.position.y=-1.48;this.water.receiveShadow=true;
    this.root.add(this.water);this.ownedMaterials.add(this.water.material);
    // Riverbank rocks: irregular faceted vertices, resting at sampled terrain height.
    const rockGeo=new T.IcosahedronGeometry(1,2);const rp=rockGeo.getAttribute('position');
    for(let i=0;i<rp.count;i++){const x=rp.getX(i),y=rp.getY(i),z=rp.getZ(i),f=.88+.1*Math.sin(x*13+y*9+z*7);rp.setXYZ(i,x*f,y*f*.65,z*f);}rockGeo.computeVertexNormals();
    const rocks=new T.InstancedMesh(rockGeo,this.materials.rock,330);rocks.castShadow=true;rocks.receiveShadow=true;
    for(let i=0;i<330;i++) {
      const x=(i%2?1:-1)*(13.8+seeded(i*3)*9),z=(seeded(i*3+1)-.5)*150,s=.24+seeded(i*3+2)*1.1;
      this.dummy.position.set(x,terrainHeight(x,z)+s*.21,z);this.dummy.scale.set(s,s,s*.75);this.dummy.rotation.set(0,seeded(i+4)*6.28,0);this.dummy.updateMatrix();rocks.setMatrixAt(i,this.dummy.matrix);
    }this.root.add(rocks);
    this.buildTrees();this.buildUndergrowth();
  }

  private buildTrees():void {
    const count=280,cards=48;
    const trunks=new T.InstancedMesh(new T.CylinderGeometry(.14,.25,1,7),this.materials.bark,count);
    const branches=new T.InstancedMesh(this.cylinder,this.materials.bark,count*4);
    const leaves=new T.InstancedMesh(new T.PlaneGeometry(1,1),this.materials.leaf,count*cards);
    leaves.castShadow=true;leaves.receiveShadow=true;trunks.castShadow=true;branches.castShadow=true;
    const color=new T.Color();
    for(let i=0;i<count;i++) {
      const x=(i%2?1:-1)*(27+seeded(i+51)*100);let z=(seeded(i*3+8)-.5)*190;
      if(Math.abs(x)<67&&z>0)z=-24-Math.abs(z);
      const ground=terrainHeight(x,z)+(Math.max(0,Math.abs(x)-38)+Math.max(0,Math.abs(z)-42)*.5)*.2*(1.2+Math.sin(x*.035+z*.044)*.65+Math.cos(z*.08)*.25);
      const h=6+seeded(i+41)*11,spread=.25+seeded(i+76)*.12;
      this.dummy.position.set(x,ground+h*.3,z);this.dummy.scale.set(h*.1,h*.6,h*.1);this.dummy.rotation.set(0,0,0);this.dummy.updateMatrix();trunks.setMatrixAt(i,this.dummy.matrix);
      for(let k=0;k<4;k++) {
        const a=k*2.4+i;
        this.instanceRod(branches,i*4+k,[x,ground+h*.45,z],[x+Math.sin(a)*h*.22,ground+h*(.75+k*.055),z+Math.cos(a)*h*.22],.075);
      }
      for(let k=0;k<cards;k++) {
        const a=k*2.39996+i*.33,level=seeded(i*cards+k+9),r=h*spread*Math.sqrt(seeded(i*cards+k+19));
        this.dummy.position.set(x+Math.sin(a)*r,ground+h*(.30+level*.68),z+Math.cos(a)*r);
        const size=h*(.27+seeded(i+k+62)*.17);
        this.dummy.scale.set(size,size,1);this.dummy.rotation.set((seeded(k+i)-.5)*2.4,a,seeded(k+66+i)*2);
        this.dummy.updateMatrix();leaves.setMatrixAt(i*cards+k,this.dummy.matrix);
        color.setHSL(.17+seeded(i+8)*.05,.12,.57+seeded(i+11)*.22);leaves.setColorAt(i*cards+k,color);
      }
    }this.root.add(trunks,branches,leaves);
  }

  private buildUndergrowth():void {
    // Bank cover stays on sampled terrain and leaves the bridge approaches clear.
    const blades:T.BufferGeometry[]=[];
    for(let k=0;k<5;k++){
      const g=new T.PlaneGeometry(.075,.8+seeded(k)*.5,1,3),p=g.getAttribute('position');
      for(let i=0;i<p.count;i++){const y=p.getY(i)+.6;p.setXYZ(i,p.getX(i)*(1-y*.55),y,p.getZ(i)+y*y*.12);}
      g.rotateY(k*2.399);blades.push(g);
    }
    const bladeGeometry=mergeGeometries(blades);blades.forEach(g=>g.dispose());
    const grassMat=this.materials.grass.clone();grassMat.side=T.DoubleSide;this.ownedMaterials.add(grassMat);
    const tufts=new T.InstancedMesh(bladeGeometry,grassMat,1800);tufts.receiveShadow=true;
    const color=new T.Color();
    for(let i=0;i<1800;i++){
      const x=(i%2?1:-1)*(17.2+seeded(i*4+401)*18),z=(seeded(i*4+402)-.5)*132;
      const clear=Math.abs(z)<3&&Math.abs(x)>20&&Math.abs(x)<33;
      this.dummy.position.set(x,terrainHeight(x,z)-.04,z);this.dummy.rotation.set(0,seeded(i+98)*6.28,0);
      const s=clear?0:.3+seeded(i+602)*.85;this.dummy.scale.set(s,s,s);this.dummy.updateMatrix();tufts.setMatrixAt(i,this.dummy.matrix);
      color.setHSL(.14+seeded(i+10)*.075,.1+seeded(i)*.12,.65+seeded(i+303)*.18);tufts.setColorAt(i,color);
    }
    this.root.add(tufts);
    // Narrow, irregular crowns break up the broadleaf skyline without solid cone silhouettes.
    const pineMat=this.materials.leaf.clone();pineMat.color.set('#9baea0');this.ownedMaterials.add(pineMat);
    const cards=48,count=120;
    const pines=new T.InstancedMesh(new T.PlaneGeometry(1,1),pineMat,count*cards);pines.castShadow=true;pines.receiveShadow=true;
    const stems=new T.InstancedMesh(new T.CylinderGeometry(.10,.22,1,7),this.materials.bark,count);stems.castShadow=true;
    for(let i=0;i<count;i++){
      const x=(i%2?1:-1)*(39+seeded(i+700)*82),z=-22-seeded(i+801)*90;
      const y=terrainHeight(x,z)+(Math.max(0,Math.abs(x)-38)+Math.max(0,Math.abs(z)-42)*.5)*.2*(1.2+Math.sin(x*.035+z*.044)*.65+Math.cos(z*.08)*.25);
      const h=7+seeded(i+602)*9;
      this.dummy.position.set(x,y+h*.43,z);this.dummy.scale.set(h*.1,h*.86,h*.1);this.dummy.rotation.set(0,0,0);this.dummy.updateMatrix();stems.setMatrixAt(i,this.dummy.matrix);
      for(let k=0;k<cards;k++){
        const t=.16+seeded(i*cards+k+95)*.78,a=k*2.399+i,r=(1-t)*h*.3*Math.sqrt(seeded(i*cards+k+113));
        const size=h*(.13+seeded(i+k+397)*.09);
        this.dummy.position.set(x+Math.cos(a)*r,y+h*t,z+Math.sin(a)*r);
        this.dummy.scale.set(size,size,1);this.dummy.rotation.set((seeded(i+k+81)-.5)*2.3,a,seeded(k+11)*2);this.dummy.updateMatrix();pines.setMatrixAt(i*cards+k,this.dummy.matrix);
        color.setHSL(.23+seeded(i+23)*.035,.12,.62+seeded(i+83)*.19);pines.setColorAt(i*cards+k,color);
      }
    }
    this.root.add(pines,stems);
  }

  /** Detail stays cheap: stationary fixtures share a draw call per material. */
  private mergeStaticGeometry():void {
    this.root.updateMatrixWorld(true);
    const groups=new Map<string,{material:T.Material;meshes:T.Mesh[];cast:boolean;receive:boolean}>();
    this.root.traverse(o=>{
      if(!(o instanceof T.Mesh)||o instanceof T.InstancedMesh||o===this.surface||o===this.water||Array.isArray(o.material))return;
      for(let parent:T.Object3D|null=o;parent;parent=parent.parent)if(parent===this.ram||parent===this.water)return;
      const key=[o.material.uuid,o.castShadow,o.receiveShadow].join(':');
      if(!groups.has(key))groups.set(key,{material:o.material,meshes:[],cast:o.castShadow,receive:o.receiveShadow});
      groups.get(key)!.meshes.push(o);
    });
    for(const {material,meshes,cast,receive} of groups.values()){
      if(meshes.length<2)continue;
      const parts=meshes.map(m=>(m.geometry.index?m.geometry.toNonIndexed():m.geometry.clone()).applyMatrix4(m.matrixWorld));
      const geometry=mergeGeometries(parts);parts.forEach(g=>g.dispose());
      if(!geometry)continue;
      for(const m of meshes){m.removeFromParent();m.geometry.dispose();}
      const combined=new T.Mesh(geometry,material);combined.name='Batched fixture · '+material.name;combined.castShadow=cast;combined.receiveShadow=receive;this.root.add(combined);
    }
  }

  private buildBridge():void {
    const {span,depth,supportY,cols}=STUDIES.bridge;
    for(const sx of [-1,1]) {
      const x=sx*span/2;
      this.box([4.1,4.8,7.2],[x,1.1,0],'concrete',.08);
      for(const sz of [-1,1]) {
        const z=sz*depth/2;
        this.box([1.2,.22,1.2],[x,3.62,z],'bridgeSteel',.025);
        this.iColumn(x,z,3.75,10.25,.42);
        this.box([.92,.15,.9],[x,14.08,z],'bridgeSteel',.04);
        this.cyl(.25,.12,[x,14.22,z],'chrome');
        for(const dx of [-.43,.43])for(const dz of [-.43,.43])this.bolt(x+dx,3.74,z+dz,.08);
        for(let y=4.2;y<14;y+=.65)for(const dz of [-.12,.12]){
          const bolt=this.cyl(.04,.04,[x+sx*.25,y,z+dz],'bolt');bolt.rotation.z=Math.PI/2;
        }
        const ax=sx*(span/2+7),ay=terrainHeight(ax,z)+1.1;
        this.box([2.2,1.6,1.9],[ax,ay-.5,z],'concrete',.08);
        this.rod([x,14,z],[ax,ay+.35,z],.095,'bridgeSteel');
        this.rod([x+.06,14,z],[ax+.06,ay+.35,z],.034,'chrome');
      }
      for(const y of [9.8,13.5])this.box([.42,.35,depth+.5],[x,y,0],'bridgeSteel');
      this.beam([x,9.9,-depth/2],[x,13.45,depth/2],.14,.14);
      this.beam([x,9.9,depth/2],[x,13.45,-depth/2],.14,.14);
      this.box([9,.2,depth],[x+sx*6,4.65,0],'wood');
      // Ramped approach meets the deck on the abutment.
      for(const sz of [-1,1])this.rod([x,6,sz*depth/2],[x+sx*10,6,sz*depth/2],.045);
    }
    this.linksMesh=new T.InstancedMesh(this.cylinder,this.materials.bridgeSteel,this.sim.links.length);
    this.linksMesh.castShadow=true;this.linksMesh.receiveShadow=true;this.root.add(this.linksMesh);
    // One full-width plank belongs to each independent deck station, including after collapse.
    const station=span/(cols-1),boardParts:T.BufferGeometry[]=[];
    for(let b=0;b<6;b++)boardParts.push(new RoundedBoxGeometry(station/6-.014,.16,depth,1,.015).translate((b-2.5)*station/6,0,0));
    const boardGeometry=mergeGeometries(boardParts);boardParts.forEach(g=>g.dispose());
    this.decks=new T.InstancedMesh(boardGeometry,this.materials.wood,cols);
    this.decks.castShadow=true;this.decks.receiveShadow=true;this.root.add(this.decks);
    this.railPosts=new T.InstancedMesh(this.cylinder,this.materials.bridgeSteel,cols*2);this.railPosts.castShadow=true;this.root.add(this.railPosts);
    this.rails=new T.InstancedMesh(this.cylinder,this.materials.bridgeSteel,(cols-1)*2*3);this.rails.castShadow=true;this.root.add(this.rails);
    this.deckBolts=new T.InstancedMesh(new T.CylinderGeometry(.027,.03,.025,6),this.materials.bolt,cols*12);
    this.cableClamps=new T.InstancedMesh(new T.BoxGeometry(.18,.12,.14),this.materials.bolt,cols*2);this.cableClamps.castShadow=true;
    this.root.add(this.deckBolts,this.cableClamps);
    const plankColor=new T.Color();for(let i=0;i<cols;i++){plankColor.setHSL(.12,.04,.79+seeded(i)*.16);this.decks.setColorAt(i,plankColor);}
  }

  private instanceRod(mesh:T.InstancedMesh,index:number,a:Vec,b:Vec,r:number,visible=true):void {
    this.dummy.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
    const d=new T.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
    this.dummy.quaternion.setFromUnitVectors(UP,d.clone().normalize());
    this.dummy.scale.set(visible?r:0,visible?d.length():0,visible?r:0);this.dummy.updateMatrix();mesh.setMatrixAt(index,this.dummy.matrix);
  }

  update(snapshot:Snapshot,responseMode:boolean):void {
    this.lastSnapshot=snapshot;this.responseMode=responseMode;
    const sim=this.sim;
    const p=(i:number):Vec=>[snapshot.positions[i*3],snapshot.positions[i*3+1],snapshot.positions[i*3+2]];
    const colorFor=(strain:number)=>new T.Color().setHSL(.52-Math.min(1,strain/(sim.config.threshold*sim.strength))*.52,.84,.52);
    if(this.surface) {
      const g=this.surface.geometry;
      (g.getAttribute('position').array as Float32Array).set(snapshot.positions);g.getAttribute('position').needsUpdate=true;
      const indices=g.index!;let count=0;
      for(const f of sim.faces)if(f.links.every(i=>i<0||snapshot.broken[i]===0))for(const n of f.nodes)indices.setX(count++,n);
      indices.needsUpdate=true;g.setDrawRange(0,count);g.computeVertexNormals();
      // Keep textured materials immutable: cached WebGPU texture nodes retain their map reference.
      this.surface.material=responseMode?this.analysisMaterial!:this.naturalMaterial!;
      if(responseMode){const colors=g.getAttribute('color');for(let i=0;i<sim.nodes.length;i++){this.strainColor.copy(colorFor(snapshot.strains[i]));colors.setXYZ(i,this.strainColor.r,this.strainColor.g,this.strainColor.b);}colors.needsUpdate=true;}
      if(this.plateEdges){
        if(this.lastTopology!==snapshot.response.broken){
          const edgeUse=new Map<string,{a:number;b:number;uses:number}>();
          for(const f of sim.faces)if(f.links.every(i=>i<0||snapshot.broken[i]===0))for(let j=0;j<3;j++){
            const a=f.nodes[j],b=f.nodes[(j+1)%3],key=[Math.min(a,b),Math.max(a,b)].join(':');
            const edge=edgeUse.get(key);if(edge)edge.uses++;else edgeUse.set(key,{a,b,uses:1});
          }
          this.exposedEdges=[...edgeUse.values()].filter(e=>e.uses===1).map(e=>[e.a,e.b]);this.lastTopology=snapshot.response.broken;
        }
        this.exposedEdges.forEach(([a,b],i)=>this.instanceRod(this.plateEdges!,i,p(a),p(b),.016));
        this.plateEdges.count=this.exposedEdges.length;this.plateEdges.instanceMatrix.needsUpdate=true;
      }
    }
    if(this.borderMesh) {
      const {cols,rows}=sim.config;let k=0;
      const pairs:[number,number][]=[];
      for(let x=0;x<cols-1;x++){pairs.push([x,x+1]);pairs.push([(rows-1)*cols+x,(rows-1)*cols+x+1]);}
      for(let y=0;y<rows-1;y++){pairs.push([y*cols,(y+1)*cols]);pairs.push([y*cols+cols-1,(y+1)*cols+cols-1]);}
      for(const [a,b] of pairs)this.instanceRod(this.borderMesh,k++,p(a),p(b),.018,Math.hypot(...p(a).map((v,i)=>v-p(b)[i]))<.9);
      this.borderMesh.count=k;this.borderMesh.instanceMatrix.needsUpdate=true;
    }
    if(this.panelSeams&&this.stitches){
      this.seamLinks.forEach((index,i)=>{const e=sim.links[index],a=p(e.a),b=p(e.b);a[1]+=.012;b[1]+=.012;this.instanceRod(this.panelSeams!,i,a,b,.012,!snapshot.broken[index]);});
      this.stitchLinks.forEach((index,i)=>{const e=sim.links[index],a=p(e.a),b=p(e.b);for(let k=0;k<3;k++){
        const start=(k+.15)/3,end=(k+.55)/3,at=(t:number):Vec=>[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t+.015,a[2]+(b[2]-a[2])*t];
        this.instanceRod(this.stitches!,i*3+k,at(start),at(end),.006,!snapshot.broken[index]);
      }});
      this.panelSeams.instanceMatrix.needsUpdate=true;this.stitches.instanceMatrix.needsUpdate=true;
    }
    if(sim.id==='plate')this.ram.position.y=snapshot.punchY;
    if(this.linksMesh) {
      for(let i=0;i<sim.links.length;i++) {
        const e=sim.links[i],visible=!snapshot.broken[i]&&e.kind!=='shear';
        this.instanceRod(this.linksMesh,i,p(e.a),p(e.b),e.kind==='cable'?.075:e.kind==='hanger'?.026:e.kind==='crossbeam'?.08:.05,visible);
        this.linksMesh.setColorAt(i,responseMode?colorFor(Math.max(snapshot.strains[e.a],snapshot.strains[e.b])):new T.Color('#c1c9c9'));
      }
      this.linksMesh.instanceMatrix.needsUpdate=true;if(this.linksMesh.instanceColor)this.linksMesh.instanceColor.needsUpdate=true;
      let r=0;
      for(let i=0;i<sim.config.cols;i++) {
        const a=p(i*4),b=p(i*4+1),next=p(Math.min(i+1,sim.config.cols-1)*4),prev=p(Math.max(0,i-1)*4);
        const zAxis=new T.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]).normalize();
        const xAxis=new T.Vector3(next[0]-prev[0],next[1]-prev[1],next[2]-prev[2]).normalize();
        const yAxis=new T.Vector3().crossVectors(zAxis,xAxis).normalize();xAxis.crossVectors(yAxis,zAxis).normalize();
        const matrix=new T.Matrix4().makeBasis(xAxis,yAxis,zAxis);matrix.setPosition((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
        this.decks!.setMatrixAt(i,matrix);
        for(let board=0;board<6;board++)for(let side=0;side<2;side++) {
          const local=new T.Matrix4().makeTranslation((board-2.5)*sim.config.span/(sim.config.cols-1)/6,.095,(side?1:-1)*(sim.config.depth/2-.17));
          this.deckBolts!.setMatrixAt(i*12+board*2+side,new T.Matrix4().multiplyMatrices(matrix,local));
        }
        for(let side=0;side<2;side++){
          this.dummy.position.set(...p(i*4+2+side));this.dummy.rotation.set(0,0,0);this.dummy.scale.setScalar(1);this.dummy.updateMatrix();this.cableClamps!.setMatrixAt(i*2+side,this.dummy.matrix);
        }
        for(let side=0;side<2;side++) {
          const pos=p(i*4+side), top:Vec=[pos[0]+yAxis.x*1.12,pos[1]+yAxis.y*1.12,pos[2]+yAxis.z*1.12];
          this.instanceRod(this.railPosts!,i*2+side,pos,top,.025);
          if(i<sim.config.cols-1)for(const h of [.35,.75,1.12]) {
            const nb=p((i+1)*4+side);
            const link=sim.links.findIndex(e=>e.a===i*4+side&&e.b===(i+1)*4+side&&e.kind==='deck');
            this.instanceRod(this.rails!,r++,[pos[0],pos[1]+h,pos[2]],[nb[0],nb[1]+h,nb[2]],h===1.12?.025:.011,link<0||!snapshot.broken[link]);
          }
        }
      }
      this.decks!.instanceMatrix.needsUpdate=true;this.railPosts!.instanceMatrix.needsUpdate=true;this.rails!.instanceMatrix.needsUpdate=true;
      this.deckBolts!.instanceMatrix.needsUpdate=true;this.cableClamps!.instanceMatrix.needsUpdate=true;
    }
  }

  fit(second=false):void {
    this.cameraPreset=second?'reverse':'hero';
    const c=STUDIES[this.sim.id];this.camera.fov=c.fov;
    this.controls.target.set(...c.target);
    const position=new T.Vector3(...(second?c.secondCamera:c.camera));
    const aspect=this.host.clientWidth/Math.max(1,this.host.clientHeight);
    // Preserve the full specimen and both bridge towers when the viewport becomes portrait.
    const framing=Math.max(1,1.1/aspect);
    this.camera.position.copy(position.sub(this.controls.target).multiplyScalar(framing).add(this.controls.target));
    this.camera.updateProjectionMatrix();this.controls.update();
  }
  setCamera(mode:CameraPreset):void {
    this.fit(mode==='reverse');this.cameraPreset=mode;
    if(mode==='hero'||mode==='reverse')return;
    const study=STUDIES[this.sim.id],bridge=this.sim.id==='bridge';
    if(mode==='detail'){
      this.controls.target.set(bridge?-3:0,study.supportY,0);
      this.camera.position.copy(this.controls.target).add(new T.Vector3(...(bridge?[-12,4,13]:this.sim.id==='plate'?[4,3.7,7]:[6,5,7])));
      this.camera.fov=42;
    } else if(mode==='plan'){
      this.controls.target.set(0,study.supportY,0);this.camera.position.set(0,bridge?62:16.6,.15);this.camera.fov=44;
    } else {
      this.controls.target.set(0,study.supportY,0);this.camera.position.set(bridge?-4:10,study.supportY+(bridge?2:1.6),bridge?52:16);this.camera.fov=42;
    }
    const framing=Math.max(1,1.1/this.camera.aspect);
    if(mode==='plan'&&!bridge){
      // Inspect beneath the hall rafters; widen the lens instead of moving
      // through the roof when a portrait viewport needs more horizontal room.
      const visibleHeight=Math.max(study.depth+2.5,(study.span+3)/this.camera.aspect);
      this.camera.fov=T.MathUtils.radToDeg(2*Math.atan(visibleHeight*.55/(16.6-study.supportY)));
    }else this.camera.position.sub(this.controls.target).multiplyScalar(framing).add(this.controls.target);
    this.camera.updateProjectionMatrix();this.controls.update();
  }
  resize():void {
    const w=this.host.clientWidth,h=this.host.clientHeight;if(w<1||h<1)return;
    this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
    const compact=w/h<1;
    if(compact!==this.compactFraming){this.compactFraming=compact;this.setCamera(this.cameraPreset);}
  }
  render(time:number):void {
    this.frame++;
    this.fpsFrames++;
    if(time-this.lastFpsTime>1){this.fps=this.fpsFrames/Math.max(.001,time-this.lastFpsTime);this.fpsFrames=0;this.lastFpsTime=time;}
    this.controls.update();if(this.pipeline)this.pipeline.render();else this.renderer.render(this.scene,this.camera);
  }
  cameraState():object {return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),fov:this.camera.fov};}
  presentationState():object {return {finish:this.currentFinish.id,lighting:this.look.id,camera:this.cameraPreset,quality:this.renderQuality,exposure:this.renderer.toneMappingExposure};}
  metrics():{fps:number;drawCalls:number;triangles:number;objects:number;textures:number} {
    const info=this.renderer.info;let objects=0;this.root.traverse(o=>{if(o instanceof T.Mesh)objects+=o instanceof T.InstancedMesh?o.count:1;});
    return {fps:Math.round(this.fps),drawCalls:info.render.drawCalls,triangles:info.render.triangles,objects,textures:info.memory.textures};
  }
}
