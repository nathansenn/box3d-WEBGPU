import * as T from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { REFERENCE_CAMERAS, VALLEY_GRID, valleyHeight, valleySurface, seatRock, coniferGeometry, addBridgeCraft } from './reference-scene';
import { bankPlant, sedgeGeometry, fernGeometry, RIFFLE_STONES, BANK_ROCKS, clearBankRoot } from './bridge-ecology';
import { frameBridge, BRIDGE_APPROACH_FRAME_POINTS } from './bridge-framing';
import { BRIDGE_LAYOUT as BRIDGE, roadClear, roadCenter, roadHalfWidth } from './bridge-layout';
import { addBridgeApproaches } from './bridge-approaches';
import { deckSupportGeometry, bridgeDeckFrames, bridgeRailPoint, DeckFrameStorage } from './bridge-deck';
import {canopyRig} from './canopy-rig';
import { SurfaceTopology, gridBorderPairs, updateSurfaceNormals } from './surface-topology';
import { RiverWater } from './river-water';
import { RiverSplash, clusterImpacts, waterContacts } from './river-impacts';
import { DEFAULT_RIVER, normalizeRiver, type RiverSettings } from './river-settings';
import { StudioMaterials } from './materials';
import {pressAttachment,updatePlateShell,PRESS_FRAME_POINTS} from './press-tooling';
import {sheetThickness,type PressSettings} from './press-settings';
import {pressStrainHue,sheetRimEdge,PressSectionSampler,type SectionAxis} from './press-inspection';
import { skyTexture, studioEnvironment, riverNormals } from './lighting';
import { finishFor, lightingFor, surroundingsFor, type FinishPreset, type LightingPreset, type CameraPreset, type SurroundingPreset } from './presets';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pass, vec3, vec4, mix, mrt, output, normalView, renderOutput, texture, positionWorld, smoothstep, uniform } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { FailureSimulation, STUDIES, terrainHeight, type Snapshot, type Vec, type StudyId } from './physics';

const UP = new T.Vector3(0,1,0);
const seeded = (n: number) => { const x=Math.sin(n*127.1+311.7)*43758.5453;return x-Math.floor(x); };

/** Visible structures are geometry. Generated concepts appear only in the comparison UI. */
export class StudioWorld {
  renderer: T.WebGPURenderer;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(43,1,.1,900);
  controls: OrbitControls;
  readonly root = new T.Group();
  private surface?: T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;
  private naturalMaterial?: T.MeshStandardMaterial;
  private analysisMaterial?: T.MeshStandardMaterial;
  private linksMesh?: T.InstancedMesh;
  private borderMesh?: T.InstancedMesh;
  private decks?: T.InstancedMesh;
  private deckSteel?:T.InstancedMesh;
  private roadTextures:T.Texture[]=[];
  private railPosts?: T.InstancedMesh;
  private rails?: T.InstancedMesh;
  private ram = new T.Group();
  private pressTool?:T.Group;
  private pressToolKey='';
  private pressPiston?:T.Mesh;
  private pressClamps?:T.Group;
  private plateShell?:T.Mesh<T.BufferGeometry,T.MeshStandardMaterial>;
  private pressNeedle?:T.Group;
  private pressHead?:T.Group;
  private water?: RiverWater;
  private riverSettings:RiverSettings={...DEFAULT_RIVER};
  private library=new StudioMaterials();
  private sun?:T.DirectionalLight;
  private fill?:T.DirectionalLight;
  private hemisphere?:T.HemisphereLight;
  private sky?:T.DataTexture;
  private exteriorEnvironment?:T.RenderTarget;
  private interiorEnvironment?:T.RenderTarget;
  private pressEnvironment?:T.RenderTarget;
  private environmentGenerator?:T.PMREMGenerator;
  private rippleNormals=riverNormals();
  private look=lightingFor();
  private surroundings=surroundingsFor('canopy');
  private terrainTint=uniform(new T.Color('#ffffff'));
  private pineMaterial?:T.MeshStandardMaterial;
  private grassMaterial?:T.MeshStandardMaterial;
  private ownedMaterials=new Set<T.Material>();
  private woodlandSources:T.Group[]=[];
  private woodlandLeaves:T.MeshStandardMaterial[]=[];
  private stitches?:T.InstancedMesh;
  private stitchLinks:number[]=[];
  private panelSeams?:T.InstancedMesh;
  private seamLinks:number[]=[];
  private plateEdges?:T.InstancedMesh;
  private pressSection?:T.InstancedMesh;
  private sectionSampler?:PressSectionSampler;
  private sectionAxis:SectionAxis='x';
  private sectionOffset=0;
  private sectionVisible=true;
  private topology?:SurfaceTopology;
  private borderPairs:Uint32Array=new Uint32Array();
  private positionScratch:Vec[]=[];
  private readonly rodDirection=new T.Vector3();
  private readonly pointA:Vec=[0,0,0];
  private readonly pointB:Vec=[0,0,0];
  private readonly neutralLinkColor=new T.Color('#c1c9c9');
  private readonly boltLocal=new T.Matrix4();
  private readonly boltWorld=new T.Matrix4();
  private deckFrameStorage?:DeckFrameStorage;
  private deckLinkIndices=new Int32Array();
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
  private splash?: RiverSplash;
  private materials: Record<string,T.MeshStandardMaterial> = {};
  private cylinder = new T.CylinderGeometry(1,1,1,10);
  private dummy = new T.Object3D();
  private resizeObserver: ResizeObserver;
  private lastSnapshot?: Snapshot;
  private responseMode = false;
  private strainColor = new T.Color();
  private frame = 0;
  private pipeline?: T.RenderPipeline;
  private cameraLayout='';
  private disposed=false;
  private graphicsLost?: (message:string)=>void;

  constructor(private host: HTMLElement, simulation: FailureSimulation) {
    this.sim=simulation;
    this.renderer=this.createRenderer();
    this.controls=new OrbitControls(this.camera,this.renderer.domElement);
    this.configureControls();
    this.scene.add(this.root);
    this.resizeObserver=new ResizeObserver(()=>this.resize());
    this.resizeObserver.observe(host);
  }

  private createRenderer(forceWebGL=false):T.WebGPURenderer {
    const renderer=new T.WebGPURenderer({antialias:true,alpha:false,forceWebGL});
    const reportLoss=renderer.onDeviceLost.bind(renderer);
    renderer.onDeviceLost=info=>{if(this.disposed)return;reportLoss(info);this.graphicsLost?.(info.message);};
    renderer.setPixelRatio(Math.min(window.devicePixelRatio,1.75));
    renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=.94;
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFShadowMap;
    renderer.domElement.setAttribute('aria-label','Interactive 3D simulation. Drag to orbit, scroll to zoom.');
    renderer.domElement.setAttribute('role','img');this.host.append(renderer.domElement);return renderer;
  }
  private configureControls():void {
    this.controls.enableDamping=true;this.controls.dampingFactor=.075;
    this.controls.maxPolarAngle=Math.PI*.49;
    this.controls.minDistance=3;this.controls.maxDistance=110;
  }

  async init(progress:(message:string)=>void=()=>{}): Promise<void> {
    progress('Connecting to the graphics device');
    const first=this.renderer,initializing=first.init();let timer:ReturnType<typeof setTimeout>|undefined;
    try {
      await Promise.race([initializing,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Graphics initialization timed out')),12000);})]);
    } catch {
      // A stalled native adapter must not leave the studio on a permanent spinner.
      progress('Preparing compatible graphics');this.controls.dispose();first.domElement.remove();
      void initializing.then(()=>first.dispose()).catch(()=>{});
      this.renderer=this.createRenderer(true);this.controls=new OrbitControls(this.camera,this.renderer.domElement);this.configureControls();
      await this.renderer.init();
    } finally {if(timer)clearTimeout(timer);}
    progress('Loading surfaces and lighting');
    this.interiorEnvironment=studioEnvironment(this.renderer);
    this.environmentGenerator=new T.PMREMGenerator(this.renderer);
    await this.library.init(this.sim.id);this.materials=this.library.materials;
    if(this.sim.id==='bridge'){progress('Preparing woodland geometry');await this.loadWoodland();}
    await this.prepareStudyMaterials(this.sim.id);
    if(this.disposed)throw new Error('Studio disposed during initialization');
    const scenePass=pass(this.scene,this.camera,{samples:0});
    scenePass.setMRT(mrt({output,normal:normalView}));
    const ambient=ao(scenePass.getTextureNode('depth'),scenePass.getTextureNode('normal'),this.camera);
    ambient.resolutionScale=(this.renderer.backend as unknown as {isWebGPUBackend?:boolean}).isWebGPUBackend?.5:.35;ambient.radius.value=.8;ambient.thickness.value=1.2;
    this.pipeline=new T.RenderPipeline(this.renderer);
    // Contact shading is useful near fixtures; reconstructed distant depth can
    // produce broad AO bands over the river, especially on the WebGL fallback.
    const contactWeight=smoothstep(28,70,scenePass.getViewZNode().negate()).oneMinus().mul(.48);
    const shaded=scenePass.getTextureNode('output').mul(vec4(vec3(mix(1,ambient.getTextureNode().r,contactWeight)),1));
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
    return this.mesh(new T.CylinderGeometry(radius,r2,length,mat==='pressChrome'?96:24),this.materials[mat],p,parent);
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
    const bridge=this.sim.id==='bridge';
    this.cyl(size*1.45,.025,[x,y,z],bridge?'bridgeSteel':'steel');
    this.mesh(new T.CylinderGeometry(size,size,.06,6),this.materials[bridge?'bridgeBolt':'bolt'],[x,y+.04,z]);
    this.cyl(size*.5,.045,[x,y+.08,z],bridge?'bridgeBolt':'chrome');
  }
  private iColumn(x:number,z:number,base:number,height:number,width=.26,mat='steel'):void {
    this.box([width,.07,height>10?width*1.1:width],[x,base+height,z],mat);
    for(const dx of [-width*.5,width*.5]) this.box([.055,height,width],[x+dx,base+height/2,z],mat);
    this.box([width,height,.055],[x,base+height/2,z],mat);
  }

  private build(sim:FailureSimulation):void {
    this.finishRevision++;
    this.root.traverse(o=>{if(o instanceof T.Mesh && o.geometry!==this.cylinder)o.geometry.dispose();if(o instanceof T.Light)o.dispose();});
    this.water?.dispose();this.roadTextures.forEach(t=>t.dispose());this.roadTextures=[];
    this.ownedMaterials.forEach(m=>m.dispose());this.ownedMaterials.clear();
    this.analysisMaterial?.dispose();
    this.root.clear();this.sim=sim;this.surface=undefined;this.linksMesh=undefined;this.decks=undefined;this.deckSteel=undefined;
    this.borderMesh=undefined;this.railPosts=undefined;this.rails=undefined;this.water=undefined;this.splash=undefined;
    this.pineMaterial=undefined;this.grassMaterial=undefined;
    this.woodlandLeaves=[];
    this.stitches=undefined;this.panelSeams=undefined;this.plateEdges=undefined;this.pressSection=undefined;this.deckBolts=undefined;this.cableClamps=undefined;
    this.plateShell=undefined;this.pressTool=undefined;this.pressToolKey='';this.pressPiston=undefined;this.pressClamps=undefined;this.pressNeedle=undefined;this.pressHead=undefined;
    this.prepareModelStorage();this.lastSnapshot=undefined;
    const outdoor=sim.id==='bridge';
    this.controls.maxDistance=outdoor?260:110;
    this.hemisphere=new T.HemisphereLight();this.root.add(this.hemisphere);
    this.sun=new T.DirectionalLight();this.sun.castShadow=true;const shadowSize=(this.renderer.backend as unknown as {isWebGPUBackend?:boolean}).isWebGPUBackend?4096:2048;this.sun.shadow.mapSize.set(shadowSize,shadowSize);
    const extent=outdoor?35:15;
    Object.assign(this.sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:.1,far:110});
    this.sun.shadow.bias=-.0002;this.sun.shadow.normalBias=.028;this.root.add(this.sun);
    this.fill=new T.DirectionalLight();this.fill.position.set(12,9,-15);this.root.add(this.fill);
    if(outdoor) {this.buildLandscape();this.buildBridge();}
    else {this.buildHall();if(sim.id==='canopy')this.buildCanopy();else this.buildPress();this.buildSurface();}
    this.mergeStaticGeometry();this.surroundings=surroundingsFor(sim.id,this.surroundings.id);this.setLighting(this.look);this.setSurroundings(this.surroundings);this.fit();this.update(sim.snapshot(),false);
  }
  attach(host:HTMLElement):void {this.resizeObserver.disconnect();this.host=host;host.append(this.renderer.domElement);this.resizeObserver.observe(host);this.resize();}
  async changeStudy(sim:FailureSimulation):Promise<void> {
    if(this.disposed)return;
    await this.library.ensureStudy(sim.id);await this.prepareStudyMaterials(sim.id);
    if(sim.id==='bridge')await this.loadWoodland();
    if(this.disposed)return;
    this.build(sim);await this.applyFinish(finishFor(sim.id));
  }
  private async prepareStudyMaterials(study:StudyId):Promise<void> {
    const required:StudyId[]=study==='bridge'?['bridge']:[study,'bridge'];
    await Promise.all(required.map(async id=>{
      const key=id==='canopy'?'fabric':id==='plate'?'sheet':'wood';
      // The hall's worktops use the same oak finish as the deck.
      if(this.materials[key]?.userData.studioFinish)return;
      const next=await this.library.finish(finishFor(id));
      if(this.disposed){this.library.releaseFinish(next);return;}
      const previous=this.materials[key];next.userData.studioFinish=true;this.materials[key]=next;this.library.releaseFinish(previous);
    }));
  }
  async applyFinish(p:FinishPreset):Promise<void> {
    if(this.disposed||p.study!==this.sim.id)return;
    const revision=++this.finishRevision,next=await this.library.finish(p);
    if(this.disposed||revision!==this.finishRevision){this.library.releaseFinish(next);return;}
    const key=p.study==='canopy'?'fabric':p.study==='plate'?'sheet':'wood',previous=this.materials[key];
    this.root.traverse(o=>{if(o instanceof T.Mesh&&o.material===previous)o.material=next;});
    next.userData.studioFinish=true;this.materials[key]=next;this.currentFinish=p;
    if(this.surface){this.naturalMaterial=next;if(!this.responseMode)this.surface.material=next;}
    this.library.releaseFinish(previous);
  }
  setLighting(p:LightingPreset):void {
    this.look=p;
    const outdoor=this.sim.id==='bridge',sky=skyTexture(p),oldSky=this.sky,oldEnvironment=this.exteriorEnvironment;
    this.sky=sky;this.scene.background=sky;
    this.scene.backgroundBlurriness=.008;
    const haze=p.haze*this.surroundings.haze;
    this.scene.fog=new T.Fog(p.horizon,outdoor?70/haze:45,outdoor?220/haze:140);
    this.exteriorEnvironment=outdoor?this.environmentGenerator!.fromEquirectangular(sky):undefined;
    this.scene.environment=outdoor?this.exteriorEnvironment!.texture:this.sim.id==='plate'&&this.pressEnvironment?this.pressEnvironment.texture:this.interiorEnvironment!.texture;
    this.scene.environmentIntensity=p.environment;
    this.renderer.toneMappingExposure=p.exposure;
    this.sun!.color.set(p.key);this.sun!.intensity=p.intensity;this.sun!.position.set(...p.sun);
    this.hemisphere!.color.set(p.sky);this.hemisphere!.groundColor.set(p.ground);this.hemisphere!.intensity=p.ambient;
    this.fill!.color.set(p.fill);this.fill!.intensity=p.ambient*.52;
    if(this.water){this.water.sunDirection.value.set(...p.sun).normalize();this.water.sunColor.value.set(p.key);}
    oldSky?.dispose();oldEnvironment?.dispose();
  }
  setSurroundings(p:SurroundingPreset):void {
    if((this.sim.id==='bridge')!==(p.habitat==='valley'))return;
    this.surroundings=p;
    for(const key of ['floor','wall','steel','leaf','grass','rock'] as const)this.materials[key].color.set(p[key]);
    this.materials.leaf.color.set(p.leaf).lerp(new T.Color('#ffffff'),.66);
    this.woodlandLeaves.forEach(m=>m.color.set(p.leaf).lerp(new T.Color('#ffffff'),.62));
    this.terrainTint.value.set(p.terrain);
    this.pineMaterial?.color.set(p.leaf).multiplyScalar(.94);this.grassMaterial?.color.set('#e0dfc2');
    if(this.water){this.water.waterColor.value.set(p.water);this.water.distortionScale.value=p.ripple;this.water.size.value=p.waterScale;}
    const outdoor=this.sim.id==='bridge',haze=this.look.haze*p.haze;
    this.scene.fog=new T.Fog(this.look.horizon,outdoor?70/haze:45,outdoor?220/haze:140);
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
  setRiver(settings:RiverSettings):void {this.riverSettings=normalizeRiver(settings);this.water?.configure(this.riverSettings);}
  setAutoRotate(enabled:boolean):void {this.controls.autoRotate=enabled;this.controls.autoRotateSpeed=.45;}
  private prepareModelStorage():void {
    this.topology=new SurfaceTopology(this.sim.faces);
    this.sectionSampler=this.sim.id==='plate'?new PressSectionSampler(this.sim):undefined;
    this.borderPairs=gridBorderPairs(this.sim.config.cols,this.sim.config.rows);
    this.positionScratch=Array.from({length:this.sim.nodes.length},()=>[0,0,0]);
    if(this.sim.id==='bridge'){
      this.deckFrameStorage=new DeckFrameStorage(this.sim.config.cols);
      this.deckLinkIndices=new Int32Array((this.sim.config.cols-1)*2);
      for(let i=0;i<this.sim.config.cols-1;i++)for(let side=0;side<2;side++)this.deckLinkIndices[i*2+side]=this.sim.links.findIndex(e=>e.a===i*4+side&&e.b===(i+1)*4+side&&e.kind==='deck');
    }else this.deckFrameStorage=undefined;
  }
  resetModel(sim:FailureSimulation):void {this.sim=sim;this.prepareModelStorage();this.lastSnapshot=undefined;this.update(sim.snapshot(),this.responseMode);}
  setPressSection(axis:SectionAxis,offset:number,visible:boolean):void {
    this.sectionAxis=axis;this.sectionOffset=offset;this.sectionVisible=visible;
    if(this.lastSnapshot)this.updatePressSection(this.lastSnapshot);
  }
  private updatePressSection(snapshot:Snapshot):void {
    if(!this.pressSection||!this.sectionSampler||!snapshot.press)return;
    this.pressSection.visible=this.sectionVisible;if(!this.sectionVisible)return;
    const section=this.sectionSampler.sample(snapshot,this.sectionAxis,this.sectionOffset),lift=sheetThickness(snapshot.press.settings)/2+.012;let count=0;
    for(let i=1;i<section.points.length;i++)if(section.points[i].connected){
      const a=section.points[i-1].node,b=section.points[i].node;
      for(let j=0;j<3;j++){this.pointA[j]=snapshot.positions[a*3+j]+(j===1?lift:0);this.pointB[j]=snapshot.positions[b*3+j]+(j===1?lift:0);}
      this.instanceRod(this.pressSection,count++,this.pointA,this.pointB,.008);
    }
    this.pressSection.count=count;this.pressSection.instanceMatrix.needsUpdate=true;
  }

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
    for(const {sx,sz,x,z,y,a,b,parts} of canopyRig(span,depth,supportY)) {
      for(const part of parts){
        const mesh=part.kind==='box'?this.box(part.size,part.center,part.material,part.bevel):this.rod(part.a,part.b,part.radius,part.material);
        mesh.name=part.name;
      }
      for(const dx of [-.3,.3])for(const dz of [-.3,.3])this.bolt(x+dx,.15,z+dz,.075);
      // Four gussets seat on the base plate and brace the web.
      for(const dx of [-.21,.21]) this.beam([x+dx,.14,z],[x,.7,z],.055,.19);
      const pin=this.cyl(.048,.32,[x,y+.18,z],'bolt');pin.rotation.z=Math.PI/2;
      for(const side of [-1,1]){
        const washer=this.cyl(.076,.022,[x+side*.137,y+.18,z],'chrome');washer.rotation.z=Math.PI/2;
        const head=this.mesh(new T.CylinderGeometry(.064,.064,.045,6),this.materials.bolt,[x+side*.166,y+.18,z]);head.rotation.z=Math.PI/2;
      }
      const ring=this.mesh(new T.TorusGeometry(.095,.022,8,20),this.materials.chrome,a);ring.rotation.x=Math.PI/2;
      for(const t of [.28,.34,.4,.6,.66,.72]) {
        const q:Vec=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,a[2]+(b[2]-a[2])*t];
        const thread=this.mesh(new T.TorusGeometry(.03,.009,5,12),this.materials.bolt,q);
        thread.quaternion.setFromUnitVectors(new T.Vector3(0,0,1),new T.Vector3(...b).sub(new T.Vector3(...a)).normalize());
      }
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
    this.pressEnvironment??=studioEnvironment(this.renderer,true);
    // Polished guide rods and tooling need smooth reflections, without the casting's normal map.
    const polished=new T.MeshPhysicalMaterial({name:'Ground tool steel',color:'#e2e8e9',roughness:.22,metalness:1,envMap:this.pressEnvironment.texture,envMapIntensity:1.1});
    this.materials.pressChrome=polished;this.ownedMaterials.add(polished);
    this.box([7.4,1.25,6.4],[0,.725,0],'black',.11);
    this.box([7.5,.23,6.5],[0,1.465,0],'steel',.035);
    for(let x=-3.1;x<=3.2;x+=.45) this.box([.12,.04,5.6],[x,1.6,0],'black');
    for(const x of [-3.12,3.12])for(const z of [-2.64,2.64]) {
      this.cyl(.33,.28,[x,1.73,z],'black');this.cyl(.21,5.12,[x,4.37,z],'pressChrome');
      this.cyl(.28,.29,[x,6.9,z],'steel');this.cyl(.28,.25,[x,2.04,z],'steel');
      for(const dx of [-.3,.3])this.bolt(x+dx,1.6,z,.09);
    }
    this.pressHead=new T.Group();this.pressHead.userData.dynamic=true;this.root.add(this.pressHead);
    this.box([7.65,.9,6.65],[0,7.32,0],'black',.14,this.pressHead);
    this.box([3.45,.45,3.4],[0,6.67,0],'steel',.065,this.pressHead);
    this.cyl(1.24,.65,[0,6.36,0],'pressChrome',1.24,this.pressHead);this.cyl(.94,.68,[0,5.79,0],'steel',.94,this.pressHead);
    // Static support rails meet the pinned sheet perimeter at exactly y = 3.15.
    const y=STUDIES.plate.supportY;
    for(const x of [-2.72,2.72]) {
      this.box([.26,1.56,4.66],[x,y-.78,0],'black',.02);
      this.box([.48,.15,4.8],[x,y-.075,0],'steel',.025);
    }
    for(const z of [-2.32,2.32]) this.box([5.22,.15,.48],[0,y-.075,z],'steel',.025);
    this.pressClamps=new T.Group();this.pressClamps.userData.dynamic=true;this.root.add(this.pressClamps);
    for(const x of [-2.64,2.64])for(const z of [-2.2,2.2]) {
      this.cyl(.075,.8,[x,3.1,z],'chrome');this.box([.48,.12,.4],[x,3.21,z],'black',.025,this.pressClamps);
      this.cyl(.11,.12,[x,3.32,z],'bolt',.11,this.pressClamps);
    }
    this.ram=new T.Group();this.root.add(this.ram);
    this.pressPiston=this.cyl(.34,1,[0,2.3,0],'pressChrome',.34,this.ram);
    this.setPressTool(this.sim.press);
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
    this.pressNeedle=new T.Group();this.pressNeedle.userData.dynamic=true;gauge.add(this.pressNeedle);
    this.rod([0,-.079,0],[0,-.079,-.17],.008,'orange',this.pressNeedle);
    this.box([.9,.34,.02],[2.4,7.27,3.34],'orange',.015);
    this.box([1.3,.2,.03],[-2.2,.8,3.21],'steel');
    // A serviceable power unit, removable panels, guide bushings and tool cart.
    this.box([1.2,2.7,1.85],[4.55,1.6,-1.5],'steel',.09);
    this.box([1.05,1.6,.04],[4.55,1.58,-.55],'black',.035);
    for(let j=0;j<8;j++)this.box([.7,.028,.04],[4.55,.9+j*.1,-.52],'steel');
    this.cyl(.38,.65,[4.55,3.25,-1.5],'black');this.cyl(.42,.08,[4.55,3.62,-1.5],'steel');
    this.box([1.18,.09,.78],[4.4,4.04,1.4],'steel',.04);
    this.rod([4.4,.2,1.45],[4.4,3.98,1.45],.1,'steel');
    this.box([.75,.045,.4],[4.3,4.1,1.35],'black',.04);
    this.cyl(.12,.11,[4.8,4.12,1.6],'orange');this.cyl(.17,.04,[4.8,4.05,1.6],'yellow');
    for(const x of [-2.9,2.9])for(let z=-2.1;z<=2.1;z+=.7){this.bolt(x,7.81,z,.1);this.bolt(x,1.61,z,.085);}
    for(const z of [-3.05,3.05])for(let x=-2.9;x<3;x+=.42)this.box([.2,.075,.06],[x,1.42,z],'yellow');
    for(const x of [-3.14,3.14])for(const z of [-2.64,2.64]){
      this.cyl(.28,.42,[x,6.75,z],'steel');this.cyl(.25,.04,[x,6.5,z],'black');
      this.box([.34,.12,.25],[x,2.28,z],'orange',.02);
    }
    // A small tooling rack behind the machine reinforces the interchangeable workflow.
    this.box([3.3,.16,1.2],[-5.6,1.62,-3.8],'steel',.035);
    for(const x of [-7,-4.2])for(const z of [-4.25,-3.35])this.box([.1,1.5,.1],[x,.78,z],'black');
    for(let i=0;i<5;i++){this.cyl(.2+i*.018,.24,[-6.8+i*.6,1.82,-3.8],'chrome');this.cyl(.1,.28,[-6.8+i*.6,2.08,-3.8],'steel');}
  }

  private setPressTool(p:PressSettings):void {
    const key=[p.tool,p.toolScale,p.angle].join(':');if(this.pressToolKey===key)return;
    this.pressTool?.traverse(o=>{if(o instanceof T.Mesh)o.geometry.dispose();});if(this.pressTool)this.ram.remove(this.pressTool);
    this.pressTool=pressAttachment(p,this.materials.pressChrome??this.materials.chrome,this.materials.black);this.ram.add(this.pressTool);this.pressToolKey=key;
  }

  private buildSurface():void {
    const sim=this.sim, n=sim.nodes.length;
    const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(n*3),3).setUsage(T.DynamicDrawUsage));
    g.setAttribute('normal',new T.BufferAttribute(new Float32Array(n*3),3).setUsage(T.DynamicDrawUsage));
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
      const shell=new T.BufferGeometry(),capacity=sim.faces.length*21;
      shell.setAttribute('position',new T.BufferAttribute(new Float32Array(capacity*3),3).setUsage(T.DynamicDrawUsage));
      shell.setAttribute('uv',new T.BufferAttribute(new Float32Array(capacity*2),2).setUsage(T.DynamicDrawUsage));
      this.plateShell=new T.Mesh(shell,mat);this.plateShell.castShadow=true;this.plateShell.receiveShadow=true;this.plateShell.frustumCulled=false;this.root.add(this.plateShell);
      const edgeMaterial=new T.MeshStandardMaterial({color:'#cbd6d8',roughness:.39,metalness:.8});this.ownedMaterials.add(edgeMaterial);
      this.plateEdges=new T.InstancedMesh(this.cylinder,edgeMaterial,sim.faces.length*3);this.plateEdges.count=0;this.plateEdges.frustumCulled=false;
      this.plateEdges.instanceMatrix.setUsage(T.DynamicDrawUsage);this.root.add(this.plateEdges);
      const sectionMaterial=new T.MeshBasicMaterial({color:'#ffb27b'});this.ownedMaterials.add(sectionMaterial);
      this.pressSection=new T.InstancedMesh(this.cylinder,sectionMaterial,Math.max(sim.config.cols,sim.config.rows));
      this.pressSection.count=0;this.pressSection.frustumCulled=false;this.pressSection.instanceMatrix.setUsage(T.DynamicDrawUsage);this.root.add(this.pressSection);
    }
  }

  private buildLandscape():void {
    const geometry=new T.PlaneGeometry(VALLEY_GRID.width,VALLEY_GRID.depth,VALLEY_GRID.cols,VALLEY_GRID.rows);geometry.rotateX(-Math.PI/2);
    const terrainUv=geometry.getAttribute('uv');
    for(let i=0;i<terrainUv.count;i++)terrainUv.setXY(i,terrainUv.getX(i)*VALLEY_GRID.width/320,terrainUv.getY(i)*VALLEY_GRID.depth/300);
    const p=geometry.getAttribute('position');const colors=new Float32Array(p.count*3);const c=new T.Color();
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),z=p.getZ(i),y=valleyHeight(x,z);
      p.setY(i,y);c.setHSL(.21+seeded(i)*.02,.08+seeded(i+4)*.08,.76+seeded(i+8)*.13);
      if(Math.abs(x)<17)c.set('#babbb0');c.toArray(colors,i*3);
    }
    geometry.setAttribute('color',new T.BufferAttribute(colors,3));geometry.computeVertexNormals();
    const groundMat=new T.MeshStandardNodeMaterial({roughness:.98,vertexColors:true,bumpMap:this.materials.soil.map,bumpScale:.055});
    const bankBlend=smoothstep(17.7,23,positionWorld.x.abs());
    groundMat.colorNode=mix(texture(this.materials.soil.map!),texture(this.materials.moss.map!),bankBlend).mul(this.terrainTint).mul(mix(1,.62,smoothstep(30,65,positionWorld.x.abs())));
    this.ownedMaterials.add(groundMat);
    this.mesh(geometry,groundMat,[0,0,0]);
    this.water=new RiverWater(this.rippleNormals);this.water.configure(this.riverSettings);
    this.root.add(this.water);this.ownedMaterials.add(this.water.material);
    // Spray from bridge pieces striking the river; driven by sim.waterImpacts each frame.
    this.splash=new RiverSplash();this.root.add(this.splash);this.ownedMaterials.add(this.splash.material as T.Material);
    // Riverbank rocks: irregular faceted vertices, resting at sampled terrain height.
    const rockGeo=new T.IcosahedronGeometry(1,2);const rp=rockGeo.getAttribute('position');
    for(let i=0;i<rp.count;i++){const x=rp.getX(i),y=rp.getY(i),z=rp.getZ(i),f=.88+.1*Math.sin(x*13+y*9+z*7);rp.setXYZ(i,x*f,y*f*.65,z*f);}rockGeo.computeVertexNormals();
    const rocks=new T.InstancedMesh(rockGeo,this.materials.rock,1100);rocks.castShadow=true;rocks.receiveShadow=true;
    const rockTint=new T.Color();
    for(let i=0;i<1100;i++) {
      const {x,z,size:s}=BANK_ROCKS[i];
      this.dummy.position.set(x,0,z);this.dummy.scale.set(s,s*(.65+seeded(i+21)*.4),s*(.75+seeded(i+31)*.5));this.dummy.rotation.set((seeded(i+17)-.5)*.7,seeded(i+4)*6.28,(seeded(i+19)-.5)*.5);this.dummy.updateMatrix();
      this.dummy.position.y=seatRock(rockGeo,this.dummy.matrix,s*.18);this.dummy.updateMatrix();rocks.setMatrixAt(i,this.dummy.matrix);
      rockTint.setHSL(.08+seeded(i+83)*.07,.05+seeded(i+56)*.06,.65+seeded(i+44)*.3);rocks.setColorAt(i,rockTint);
    }this.root.add(rocks);
    // Gravel and larger riffle stones occupy the same terrain as plants and water.
    const gravel=new T.InstancedMesh(new T.IcosahedronGeometry(1,0),this.materials.rock,11000);gravel.receiveShadow=true;
    for(let i=0;i<11000;i++){
      const x=(i%2?1:-1)*(13.5+seeded(i+534)*13),z=(seeded(i+763)-.5)*130,s=.035+seeded(i+612)*.13;
      this.dummy.position.set(x,0,z);const gravelScale=roadClear(x,z)?0:s;this.dummy.scale.set(gravelScale,gravelScale*.38,gravelScale*.75);this.dummy.rotation.set(0,seeded(i+81)*6.28,0);this.dummy.updateMatrix();
      this.dummy.position.y=seatRock(gravel.geometry,this.dummy.matrix,s*.15);this.dummy.updateMatrix();gravel.setMatrixAt(i,this.dummy.matrix);
      rockTint.setHSL(.08+seeded(i+853)*.07,.08,.48+seeded(i+266)*.43);gravel.setColorAt(i,rockTint);
    }
    this.root.add(gravel);
    const riffles=new T.InstancedMesh(rockGeo,this.materials.rock,RIFFLE_STONES.length);riffles.castShadow=true;riffles.receiveShadow=true;
    RIFFLE_STONES.forEach((r,i)=>{
      this.dummy.position.set(r.x,0,r.z);this.dummy.scale.set(r.radius,r.radius,r.radius*1.15);this.dummy.rotation.set(0,seeded(i+123)*6.28,0);this.dummy.updateMatrix();
      this.dummy.position.y=seatRock(rockGeo,this.dummy.matrix,r.radius*.12);this.dummy.updateMatrix();riffles.setMatrixAt(i,this.dummy.matrix);
    });this.root.add(riffles);
    const roads=addBridgeApproaches(this.root,this.materials);roads.materials.forEach(m=>this.ownedMaterials.add(m));this.roadTextures=roads.textures;
    this.buildWoodland();this.buildUndergrowth();
  }

  private async loadWoodland():Promise<void> {
    if(this.woodlandSources.length)return;
    const loader=new GLTFLoader();
    const loaded=await Promise.all(['browser','mid','woodland'].map(level=>loader.loadAsync(`${import.meta.env.BASE_URL}studio/models/polyhaven-island-tree-02-${level}-lod.glb`)));
    if(this.disposed){for(const asset of loaded)this.disposeAsset(asset.scene);return;}
    this.woodlandSources=loaded.map(g=>g.scene);
  }

  private buildWoodland():void {
    const sourceParts:T.Mesh[][]=this.woodlandSources.map(source=>{const parts:T.Mesh[]=[];source.updateMatrixWorld(true);source.traverse(o=>{if(o instanceof T.Mesh)parts.push(o);});return parts;});
    const materials=sourceParts[0].map(part=>{
      const m=(part.material as T.MeshStandardMaterial).clone();m.metalness=0;m.roughness=.9;
      if(m.name.includes('leaves')){m.transparent=false;m.opacity=1;m.alphaTest=.12;m.depthWrite=true;m.side=T.DoubleSide;this.woodlandLeaves.push(m);}
      this.ownedMaterials.add(m);return m;
    });
    const hero=[[-26,-8,8],[-29,-18,9],[-39,-17,11],[26,-8,9],[30,8,10],[26,18,7],[34,-20,12],[-42,4,10]];
    for(let tier=0;tier<3;tier++){
      const parts=sourceParts[tier],count=tier===0?hero.length:tier===1?72:460;
      const bounds=new T.Box3().setFromObject(this.woodlandSources[tier]),height=bounds.max.y-bounds.min.y;
      const batches=parts.map((part,k)=>{
        const geometry=part.geometry.clone().applyMatrix4(part.matrixWorld).translate(0,-bounds.min.y,0);
        // Source LODs reorder branches and leaves. Bind by authored material
        // identity, otherwise bark maps would be assigned to the leaf cutouts.
        let material=materials.find(m=>m.name===(part.material as T.Material).name)??materials[k];
        if(tier===2&&material.name.includes('leaves')){
          // The distant mesh already contains simplified leaf silhouettes. A
          // second alpha cutout erases them when the atlas reaches small mips.
          material=new T.MeshStandardMaterial({name:'Distant woodland canopy',color:'#5b7042',roughness:1,side:T.DoubleSide});this.ownedMaterials.add(material);
        }
        const mesh=new T.InstancedMesh(geometry,material,count);mesh.name=`Woodland ${tier} · ${material.name}`;mesh.castShadow=tier<2;mesh.receiveShadow=true;this.root.add(mesh);return mesh;
      });
      const crownFill=tier===2?new T.InstancedMesh(new T.PlaneGeometry(1,1,1,2),this.materials.leaf,count*64):undefined;
      if(crownFill){crownFill.name='Distant canopy infill';crownFill.receiveShadow=true;this.root.add(crownFill);}
      for(let i=0;i<count;i++){
        let x=tier===0?hero[i][0]:(i%2?1:-1)*(tier===1?25+seeded(i+371)*32:35+seeded(i+164)*108);
        let z=tier===0?hero[i][1]:(seeded(i+583+tier*371)-.5)*(tier===1?145:258);
        if(tier>0&&x> -46&&x< -24&&z>0&&z<35)z=-12-z*.7;
        const h=tier===0?hero[i][2]:tier===1?6+seeded(i+352)*7:9+seeded(i+651)*12;
        if(roadClear(x,z,h*.4))z=roadCenter(x)+Math.sign(z-roadCenter(x)||1)*(roadHalfWidth(x)+BRIDGE.shoulder+h*.46+1);
        // Bury the scan's shallow ground skirt below the downslope surface;
        // a center-only sample leaves a visible flat pad on a sloping bank.
        const rootRadius=h*.22,rootY=Math.min(valleySurface(x,z),...[-1,1].flatMap(dx=>[-1,1].map(dz=>valleySurface(x+dx*rootRadius,z+dz*rootRadius))))-.055;
        this.dummy.position.set(x,rootY,z);this.dummy.scale.setScalar(h/height);this.dummy.rotation.set(0,seeded(i+tier*627)*Math.PI*2,0);this.dummy.updateMatrix();
        for(const batch of batches)batch.setMatrixAt(i,this.dummy.matrix);
        if(crownFill){
          const ground=this.dummy.position.y,turn=this.dummy.rotation.y;
          for(let j=0;j<64;j++){
            const a=j*2.399,level=seeded(i*64+j+14),r=h*.3*Math.sqrt(seeded(i*64+j+44))*Math.sqrt(1-(level*2-1)**2);
            const local=new T.Vector3(Math.sin(a)*r,h*(.38+level*.62),h*.22+Math.cos(a)*r).applyAxisAngle(UP,turn);
            this.dummy.position.set(x+local.x,ground+local.y,z+local.z);this.dummy.rotation.set((seeded(j+i)-.5)*2.4,a+turn,seeded(j+12)*2);
            this.dummy.scale.setScalar(h*(.16+seeded(j+i+22)*.035));this.dummy.updateMatrix();crownFill.setMatrixAt(i*64+j,this.dummy.matrix);
          }
        }
      }
    }
    // Low shrubs hide the transition from the scanned canopy to bank cover.
    const shrubs=new T.InstancedMesh(new T.PlaneGeometry(1,1,1,2),this.materials.leaf,240*18);shrubs.castShadow=true;shrubs.receiveShadow=true;
    for(let i=0;i<240;i++){
      const x=(i%2?1:-1)*(18.6+seeded(i+43)*15),z=(seeded(i+141)-.5)*145,y=valleySurface(x,z),h=.7+seeded(i+178)*1.2;
      const clear=roadClear(x,z,h*.7)||!clearBankRoot(x,z);
      for(let k=0;k<18;k++){
        const a=k*2.399,r=Math.sqrt(seeded(i*18+k))*h*.6;
        this.dummy.position.set(x+Math.sin(a)*r,y+.22+seeded(i*18+k+12)*h*.75,z+Math.cos(a)*r);this.dummy.rotation.set((seeded(k+i)-.5)*2,a,seeded(k+52)*2);
        this.dummy.scale.setScalar(clear?0:h*.65);this.dummy.updateMatrix();shrubs.setMatrixAt(i*18+k,this.dummy.matrix);
      }
    }this.root.add(shrubs);

  }

  private buildUndergrowth():void {
    const grassMat=new T.MeshStandardMaterial({color:'#e1e5ca',vertexColors:true,side:T.DoubleSide,roughness:1});this.ownedMaterials.add(grassMat);
    this.grassMaterial=grassMat;
    const tufts=new T.InstancedMesh(sedgeGeometry(),grassMat,9600);tufts.receiveShadow=true;
    const fernMat=grassMat.clone();this.ownedMaterials.add(fernMat);
    const ferns=new T.InstancedMesh(fernGeometry(),fernMat,1100);ferns.receiveShadow=true;ferns.castShadow=true;
    const color=new T.Color();
    for(const [mesh,count] of [[tufts,9600],[ferns,1100]] as const)for(let i=0;i<count;i++){
      const p=bankPlant(mesh===ferns?i*7+382:i),s=p.visible?p.scale*(mesh===ferns?1.6:1):0;
      this.dummy.position.set(p.x,p.y,p.z);this.dummy.rotation.set(0,p.angle,0);this.dummy.scale.setScalar(s);this.dummy.updateMatrix();mesh.setMatrixAt(i,this.dummy.matrix);
      color.setHSL(.14+seeded(i+10)*.065,.08+seeded(i)*.1,.7+seeded(i+303)*.24);mesh.setColorAt(i,color);
    }
    this.root.add(tufts,ferns);
    // Unit-height branch tiers replace broadleaf cards in the conifer silhouette.
    const pineMat=new T.MeshStandardMaterial({color:'#c8cbb8',roughness:1,vertexColors:true});this.ownedMaterials.add(pineMat);this.pineMaterial=pineMat;
    const count=280,pines=new T.InstancedMesh(coniferGeometry(),pineMat,count);pines.castShadow=true;pines.receiveShadow=true;
    const stems=new T.InstancedMesh(new T.CylinderGeometry(.08,.18,1,7),this.materials.bark,count);stems.castShadow=true;
    for(let i=0;i<count;i++){
      const x=(i%2?1:-1)*(28+seeded(i+700)*108),h=5+seeded(i+602)*9;let z=-14-seeded(i+801)*110;
      if(roadClear(x,z,h*.24))z=roadCenter(x)-roadHalfWidth(x)-BRIDGE.shoulder-h*.3-1;
      const y=valleySurface(x,z)-.06;
      this.dummy.position.set(x,y+h*.4,z);this.dummy.scale.set(h*.12,h*.8,h*.12);this.dummy.rotation.set(0,0,0);this.dummy.updateMatrix();stems.setMatrixAt(i,this.dummy.matrix);
      this.dummy.position.set(x,y,z);this.dummy.scale.setScalar(h);this.dummy.rotation.set((seeded(i)-.5)*.03,seeded(i+21)*6.28,(seeded(i+3)-.5)*.03);this.dummy.updateMatrix();pines.setMatrixAt(i,this.dummy.matrix);
      color.setHSL(.20+seeded(i+23)*.05,.12,.66+seeded(i+83)*.27);pines.setColorAt(i,color);
    }
    this.root.add(pines,stems);
  }

  /** Detail stays cheap: stationary fixtures share a draw call per material. */
  private mergeStaticGeometry():void {
    this.root.updateMatrixWorld(true);
    const groups=new Map<string,{material:T.Material;meshes:T.Mesh[];cast:boolean;receive:boolean}>();
    this.root.traverse(o=>{
      if(!(o instanceof T.Mesh)||o instanceof T.InstancedMesh||o===this.surface||o===this.plateShell||o===this.water||Array.isArray(o.material))return;
      for(let parent:T.Object3D|null=o;parent;parent=parent.parent)if(parent===this.ram||parent===this.water||parent.userData.dynamic)return;
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
    const approachLength=BRIDGE.roadStart-BRIDGE.approachStart,planks=50;
    const fixedBoards=new T.InstancedMesh(new RoundedBoxGeometry(approachLength/planks-.012,.16,depth,1,.012),this.materials.wood,planks*2);
    const fixedBolts=new T.InstancedMesh(new T.CylinderGeometry(.027,.03,.025,6),this.materials.bridgeBolt,planks*4),boardTint=new T.Color();
    fixedBoards.name='Fixed approach timber boards';fixedBolts.name='Approach board fasteners';
    fixedBoards.castShadow=true;fixedBoards.receiveShadow=true;fixedBolts.castShadow=true;this.root.add(fixedBoards,fixedBolts);
    for(const sx of [-1,1]) {
      const x=sx*span/2;
      this.box([4.1,4.8,7.2],[x,1.1,0],'bridgeConcrete',.055);
      for(const sz of [-1,1]) {
        const z=sz*depth/2;
        this.box([1.2,.01,1.2],[x,3.505,z],'concrete');
        this.box([1.2,.22,1.2],[x,3.62,z],'bridgeSteel',.025);
        this.iColumn(x,z,3.73,10.27,.42,'bridgeSteel');
        this.box([.92,.15,.9],[x,14.08,z],'bridgeSteel',.04);
        this.cyl(.25,.12,[x,14.22,z],'chrome');
        for(const dx of [-.43,.43])for(const dz of [-.43,.43])this.bolt(x+dx,3.74,z+dz,.08);
        for(let y=4.2;y<14;y+=.65)for(const dz of [-.12,.12]){
          const bolt=this.cyl(.04,.04,[x+sx*.25,y,z+dz],'bridgeBolt');bolt.rotation.z=Math.PI/2;
        }
        const ax=sx*BRIDGE.anchorX,az=sz*BRIDGE.anchorZ,ground=valleySurface(ax,az),socketY=ground+1.73;
        this.box([2.5,2.6,2.1],[ax,ground-.02,az],'bridgeConcrete',.065);
        this.box([1.1,.13,.7],[ax,ground+1.34,az],'bridgeSteel',.025);
        const anchor:Vec=[ax,socketY,az],crown:Vec=[x,14,z];
        this.rod(crown,anchor,.075,'wireRope');
        const direction=new T.Vector3(...crown).sub(new T.Vector3(...anchor)).normalize();
        const end=new T.Vector3(...anchor).addScaledVector(direction,.85);
        this.rod(anchor,end.toArray() as Vec,.15,'bridgeSteel');
        for(const dx of [-.39,.39])for(const dz of [-.24,.24])this.bolt(ax+dx,ground+1.43,az+dz,.065);
        const saddle=new T.CatmullRomCurve3([[-.4,-.16],[-.17,.03],[0,.07],[.17,.03],[.4,-.16]].map(([dx,dy])=>new T.Vector3(x+dx,14+dy,z)));
        this.mesh(new T.TubeGeometry(saddle,18,.077,10,false),this.materials.wireRope,[0,0,0]);
        for(const dz of [-.16,.16])this.box([.75,.26,.065],[x,13.98,z+dz],'bridgeSteel',.02);
      }
      for(let j=0;j<planks;j++){
        const index=(sx>0?planks:0)+j,px=sx*(BRIDGE.approachStart+(j+.5)*approachLength/planks);
        fixedBoards.setMatrixAt(index,new T.Matrix4().makeTranslation(px,supportY,0));
        fixedBoards.setColorAt(index,boardTint.setHSL(.12,.035,.78+seeded(j+index+73)*.19));
        for(let side=0;side<2;side++)fixedBolts.setMatrixAt(index*2+side,new T.Matrix4().makeTranslation(px,supportY+.095,(side?1:-1)*(depth/2-.17)));
      }
      for(const sz of [-1,1]){
        // Fixed steel approach stringers have visible bearings above the abutment.
        this.box([approachLength,.41,.19],[sx*(BRIDGE.approachStart+approachLength/2),4.515,sz*1.35],'bridgeSteel');
        this.box([1.3,.68,.65],[x,3.86,sz*1.35],'bridgeConcrete',.035);
        this.box([1.05,.12,.58],[x,4.26,sz*1.35],'bridgeSteel',.025);
        for(const h of BRIDGE.railHeights)this.rod([x,BRIDGE.deckTop+h,sz*depth/2],[sx*BRIDGE.roadStart,BRIDGE.deckTop+h,sz*depth/2],h===1.15?.038:.012,'bridgeSteel');
        for(let j=1;j<=7;j++){
          const px=x+sx*j*(BRIDGE.roadStart-Math.abs(x))/7;
          this.rod([px,BRIDGE.deckTop,sz*depth/2],[px,BRIDGE.deckTop+1.15,sz*depth/2],.046,'bridgeSteel');
          this.box([.19,.04,.19],[px,BRIDGE.deckTop+.015,sz*depth/2],'bridgeSteel');
        }
      }
      for(let j=0;j<7;j++)this.box([.13,.22,depth],[sx*(BRIDGE.approachStart+j*approachLength/6),4.2,0],'bridgeSteel');
    }
    addBridgeCraft(this.root,{...this.materials,bolt:this.materials.bridgeBolt});
    this.linksMesh=new T.InstancedMesh(this.cylinder,this.materials.wireRope,this.sim.links.length);
    this.linksMesh.castShadow=true;this.linksMesh.receiveShadow=true;this.root.add(this.linksMesh);
    // One full-width plank belongs to each independent deck station, including after collapse.
    const station=span/(cols-1),boardParts:T.BufferGeometry[]=[];
    for(let b=0;b<6;b++)boardParts.push(new RoundedBoxGeometry(station/6-.014,.16,depth,1,.015).translate((b-2.5)*station/6,0,0));
    for(const z of [-depth/2,depth/2]){
      const fascia=new RoundedBoxGeometry(station-.014,.26,.14,1,.012).translate(0,-.13,z),uv=fascia.getAttribute('uv');
      for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getY(i),uv.getX(i));boardParts.push(fascia);
    }
    const boardGeometry=mergeGeometries(boardParts);boardParts.forEach(g=>g.dispose());
    this.decks=new T.InstancedMesh(boardGeometry,this.materials.wood,cols);
    this.decks.castShadow=true;this.decks.receiveShadow=true;this.root.add(this.decks);
    this.deckSteel=new T.InstancedMesh(deckSupportGeometry(station,depth),this.materials.bridgeSteel,cols);this.deckSteel.castShadow=true;this.deckSteel.receiveShadow=true;this.root.add(this.deckSteel);
    this.railPosts=new T.InstancedMesh(this.cylinder,this.materials.bridgeSteel,cols*2);this.railPosts.castShadow=true;this.root.add(this.railPosts);
    this.rails=new T.InstancedMesh(this.cylinder,this.materials.bridgeSteel,(cols-1)*2*6);this.rails.castShadow=true;this.root.add(this.rails);
    this.deckBolts=new T.InstancedMesh(new T.CylinderGeometry(.027,.03,.025,6),this.materials.bridgeBolt,cols*12);
    this.cableClamps=new T.InstancedMesh(new T.BoxGeometry(.18,.12,.14),this.materials.bridgeBolt,cols*2);this.cableClamps.castShadow=true;
    this.root.add(this.deckBolts,this.cableClamps);
    const plankColor=new T.Color();for(let i=0;i<cols;i++){plankColor.setHSL(.12,.04,.79+seeded(i)*.16);this.decks.setColorAt(i,plankColor);}
  }

  private instanceRod(mesh:T.InstancedMesh,index:number,a:Vec,b:Vec,r:number,visible=true):void {
    this.dummy.position.set((a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2);
    const d=this.rodDirection.set(b[0]-a[0],b[1]-a[1],b[2]-a[2]),length=d.length();
    this.dummy.quaternion.setFromUnitVectors(UP,d.normalize());
    this.dummy.scale.set(visible?r:0,visible?length:0,visible?r:0);this.dummy.updateMatrix();mesh.setMatrixAt(index,this.dummy.matrix);
  }

  update(snapshot:Snapshot,responseMode:boolean):void {
    if(this.disposed)return;
    this.lastSnapshot=snapshot;this.responseMode=responseMode;
    const sim=this.sim;
    for(let i=0;i<this.positionScratch.length;i++){const p=this.positionScratch[i];p[0]=snapshot.positions[i*3];p[1]=snapshot.positions[i*3+1];p[2]=snapshot.positions[i*3+2];}
    const p=(i:number):Vec=>this.positionScratch[i];
    const colorFor=(strain:number)=>this.strainColor.setHSL(sim.id==='plate'?pressStrainHue(strain,snapshot.press?.settings??sim.press,sim.strength):.52-Math.min(1,strain/(sim.config.threshold*sim.strength))*.52,.84,.52);
    if(this.surface) {
      const g=this.surface.geometry;
      (g.getAttribute('position').array as Float32Array).set(snapshot.positions);g.getAttribute('position').needsUpdate=true;
      if(sim.id==='plate'){const pos=g.getAttribute('position'),t=sheetThickness(snapshot.press?.settings??sim.press);for(let i=0;i<sim.nodes.length;i++)pos.setY(i,pos.getY(i)+t/2);}
      const indices=g.index!,topology=this.topology!;
      if(topology.update(snapshot.broken,snapshot.topologyIdentity)){
        for(let i=0;i<topology.count;i++)indices.setX(i,topology.indices[i]);
        indices.needsUpdate=true;g.setDrawRange(0,topology.count);
      }
      const normals=g.getAttribute('normal');
      updateSurfaceNormals(g.getAttribute('position').array as Float32Array,topology.indices,topology.count,normals.array as Float32Array);normals.needsUpdate=true;
      if(this.plateShell){updatePlateShell(this.plateShell.geometry,snapshot.positions,topology.indices,sheetThickness(snapshot.press?.settings??sim.press),topology.exposed,topology.count);this.plateShell.material=this.naturalMaterial!;}
      // Keep textured materials immutable: cached WebGPU texture nodes retain their map reference.
      this.surface.material=responseMode?this.analysisMaterial!:this.naturalMaterial!;
      if(responseMode){const colors=g.getAttribute('color');for(let i=0;i<sim.nodes.length;i++){colorFor(snapshot.strains[i]);colors.setXYZ(i,this.strainColor.r,this.strainColor.g,this.strainColor.b);}colors.needsUpdate=true;}
      if(this.plateEdges){
        let count=0;const thickness=sheetThickness(snapshot.press?.settings??sim.press);
        for(let i=0;i<topology.exposed.length;i+=2){
          const a=topology.exposed[i],b=topology.exposed[i+1];if(sheetRimEdge(a,b,sim.config.cols,sim.config.rows))continue;
          for(let j=0;j<3;j++){this.pointA[j]=p(a)[j]+(j===1?thickness/2:0);this.pointB[j]=p(b)[j]+(j===1?thickness/2:0);}
          this.instanceRod(this.plateEdges,count++,this.pointA,this.pointB,Math.min(.012,Math.max(.004,thickness*.2)));
        }
        (this.plateEdges.material as T.MeshStandardMaterial).color.set(responseMode?'#ffbb71':'#cbd6d8');
        this.plateEdges.count=count;this.plateEdges.instanceMatrix.needsUpdate=true;
      }
    }
    if(this.borderMesh) {
      let k=0;
      for(let i=0;i<this.borderPairs.length;i+=2){const a=p(this.borderPairs[i]),b=p(this.borderPairs[i+1]);this.instanceRod(this.borderMesh,k++,a,b,.018,Math.hypot(a[0]-b[0],a[1]-b[1],a[2]-b[2])<.9);}
      this.borderMesh.count=k;this.borderMesh.instanceMatrix.needsUpdate=true;
    }
    if(this.panelSeams&&this.stitches){
      this.seamLinks.forEach((index,i)=>{const e=sim.links[index],a=this.pointA,b=this.pointB;for(let j=0;j<3;j++){a[j]=p(e.a)[j];b[j]=p(e.b)[j];}a[1]+=.012;b[1]+=.012;this.instanceRod(this.panelSeams!,i,a,b,.012,!snapshot.broken[index]);});
      this.stitchLinks.forEach((index,i)=>{const e=sim.links[index],a=p(e.a),b=p(e.b);for(let k=0;k<3;k++){
        const start=(k+.15)/3,end=(k+.55)/3;
        for(let j=0;j<3;j++){this.pointA[j]=a[j]+(b[j]-a[j])*start+(j===1?.015:0);this.pointB[j]=a[j]+(b[j]-a[j])*end+(j===1?.015:0);}
        this.instanceRod(this.stitches!,i*3+k,this.pointA,this.pointB,.006,!snapshot.broken[index]);
      }});
      this.panelSeams.instanceMatrix.needsUpdate=true;this.stitches.instanceMatrix.needsUpdate=true;
    }
    if(sim.id==='plate'){
      const settings=snapshot.press?.settings??sim.press;this.setPressTool(settings);this.ram.position.y=snapshot.punchY;
      this.updatePressSection(snapshot);
      if(this.pressPiston){const bottom=1.5*settings.toolScale,top=6.15-snapshot.punchY;this.pressPiston.position.y=(bottom+top)/2;this.pressPiston.scale.y=Math.max(.01,top-bottom);}
      if(this.pressClamps)this.pressClamps.position.y=sheetThickness(settings);
      if(this.pressNeedle)this.pressNeedle.rotation.y=-2.2+(snapshot.press?.pressure??0)/100*4.4;
    }
    if(this.linksMesh) {
      for(let i=0;i<sim.links.length;i++) {
        const e=sim.links[i],visible=!snapshot.broken[i]&&(e.kind==='cable'||e.kind==='hanger');
        this.instanceRod(this.linksMesh,i,p(e.a),p(e.b),e.kind==='cable'?.075:e.kind==='hanger'?.026:e.kind==='crossbeam'?.08:.05,visible);
        this.linksMesh.setColorAt(i,responseMode?colorFor(Math.max(snapshot.strains[e.a],snapshot.strains[e.b])):this.neutralLinkColor);
      }
      this.linksMesh.instanceMatrix.needsUpdate=true;if(this.linksMesh.instanceColor)this.linksMesh.instanceColor.needsUpdate=true;
      let r=0;const frames=bridgeDeckFrames(snapshot.positions,sim.config.cols,this.deckFrameStorage);
      for(let i=0;i<sim.config.cols;i++) {
        const matrix=frames[i];
        this.decks!.setMatrixAt(i,matrix);this.deckSteel!.setMatrixAt(i,matrix);
        for(let board=0;board<6;board++)for(let side=0;side<2;side++) {
          const local=this.boltLocal.makeTranslation((board-2.5)*sim.config.span/(sim.config.cols-1)/6,.095,(side?1:-1)*(sim.config.depth/2-.17));
          this.deckBolts!.setMatrixAt(i*12+board*2+side,this.boltWorld.multiplyMatrices(matrix,local));
        }
        for(let side=0;side<2;side++){
          this.dummy.position.set(...p(i*4+2+side));this.dummy.rotation.set(0,0,0);this.dummy.scale.setScalar(1);this.dummy.updateMatrix();this.cableClamps!.setMatrixAt(i*2+side,this.dummy.matrix);
        }
        for(let side=0;side<2;side++) {
          const at=(station:number,h:number,target:Vec)=>bridgeRailPoint(snapshot.positions,station,side,h+.08,frames[station],target);
          const pos=at(i,0,this.pointA),top=at(i,1.15,this.pointB);
          this.instanceRod(this.railPosts!,i*2+side,pos,top,.025);
          if(i<sim.config.cols-1)for(const h of BRIDGE.railHeights) {
            const link=this.deckLinkIndices[i*2+side];
            this.instanceRod(this.rails!,r++,at(i,h,this.pointA),at(i+1,h,this.pointB),h===1.15?.025:.011,link<0||!snapshot.broken[link]);
          }
        }
      }
      this.decks!.instanceMatrix.needsUpdate=true;this.deckSteel!.instanceMatrix.needsUpdate=true;this.railPosts!.instanceMatrix.needsUpdate=true;this.rails!.instanceMatrix.needsUpdate=true;
      this.deckBolts!.instanceMatrix.needsUpdate=true;this.cableClamps!.instanceMatrix.needsUpdate=true;
    }
  }

  private framingAspect():number {
    const rect=this.host.getBoundingClientRect(),studio=this.host.closest<HTMLElement>('#studio');let usable=rect.width;
    if(studio?.classList.contains('scene-workflow')&&rect.width<=800)return rect.width/Math.max(1,rect.height);
    if((studio?.dataset.theme==='observatory'||studio?.classList.contains('scene-workflow'))&&!studio.classList.contains('scene-focus')){
      for(const panel of studio.querySelectorAll<HTMLElement>('.study-outline,.load-inspector')){
        const r=panel.getBoundingClientRect();
        if(r.height>0)usable-=Math.max(0,Math.min(rect.right,r.right)-Math.max(rect.left,r.left));
      }
    }
    return Math.max(rect.width*.4,usable)/Math.max(1,rect.height);
  }
  fit(second=false):void {
    this.controls.maxPolarAngle=Math.PI*.49;
    this.cameraPreset=second?'reverse':'hero';
    const c=STUDIES[this.sim.id];this.camera.fov=c.fov;
    this.controls.target.set(...c.target);
    const position=new T.Vector3(...(second?c.secondCamera:c.camera));
    if(this.sim.id==='plate'){
      this.controls.target.set(0,3.8,0);this.camera.position.set(second?-10:9.5,8.4,16);this.camera.fov=44;
      const w=this.host.clientWidth,h=this.host.clientHeight,studio=this.host.closest<HTMLElement>('#studio');
      const focus=studio?.classList.contains('scene-focus'),desk=!focus&&!studio?.classList.contains('desk-collapsed')&&w>800;
      const panel=studio?.querySelector<HTMLElement>('.load-inspector')?.getBoundingClientRect(),rect=this.host.getBoundingClientRect();
      const left=desk&&w>1000?100:18,right=desk&&panel?panel.left-rect.left-24:w-18;
      frameBridge(this.camera,this.controls.target,w,h,{left,right,top:90,bottom:h-(focus?70:175)},PRESS_FRAME_POINTS);
      this.controls.update();return;
    }
    if(second&&this.sim.id==='bridge'){
      // A reverse inspection must include both towers, including with the desk open.
      this.controls.target.set(0,6,0);position.set(16,32,-48);
    }
    if(this.sim.id==='bridge'&&this.camera.aspect<.95){this.controls.target.set(0,6,0);position.set(0,31,second?-47:47);}
    const aspect=this.framingAspect();
    // Preserve the full specimen and both bridge towers when the viewport becomes portrait.
    const framing=Math.max(1,1.1/aspect);
    this.camera.position.copy(position.sub(this.controls.target).multiplyScalar(framing).add(this.controls.target));
    this.camera.updateProjectionMatrix();this.controls.update();
  }
  setCamera(mode:CameraPreset):void {
    this.applyWorkspaceOffset();
    if(this.pressHead)this.pressHead.visible=mode!=='plan';
    if(this.sim.id==='plate')this.ram.visible=mode!=='plan';
    if((mode==='stream'||mode==='bank'||mode==='river-hero'||mode==='bearing'||mode==='approach')&&this.sim.id!=='bridge')mode='hero';
    this.fit(mode==='reverse');this.cameraPreset=mode;
    if(mode==='reverse'&&this.sim.id==='bridge'){this.fitBridgeFrame();this.controls.update();return;}
    if(mode==='hero'||mode==='reverse')return;
    if(mode==='approach'){
      this.controls.maxPolarAngle=Math.PI*.6;this.controls.target.set(-12,6.4,0);this.camera.position.set(-43,7.5,8.5);this.camera.fov=51;
      if(this.camera.aspect<.95){this.controls.target.set(-15,6.2,0);this.camera.position.set(-45,11,4);this.camera.fov=59;}
      this.fitBridgeFrame(BRIDGE_APPROACH_FRAME_POINTS);this.camera.updateProjectionMatrix();this.controls.update();return;
    }
    if(mode==='river-hero'||mode==='bearing'){
      this.controls.maxPolarAngle=Math.PI*.6;
      this.controls.target.set(...(mode==='bearing'?[-20,3.2,0]:[-13,7,0]) as Vec);
      this.camera.position.set(...(mode==='bearing'?[-27,5.4,9.5]:[-33,7.8,17]) as Vec);this.camera.fov=mode==='bearing'?48:55;
      if(this.camera.aspect<.95){
        if(mode==='river-hero'){this.controls.target.set(0,6,0);this.camera.position.set(0,31,47);}
        else{this.controls.target.set(-21,3,0);this.camera.position.set(-24,7,10);}
      }
      if(mode==='river-hero')this.fitBridgeFrame();
      else this.camera.position.sub(this.controls.target).multiplyScalar(Math.max(1,1.1/this.framingAspect())).add(this.controls.target);
      this.camera.updateProjectionMatrix();this.controls.update();return;
    }
    if(mode==='reference'){
      // A portrait screen cannot keep the close landscape crop and both towers.
      // The preceding fit supplies the complete bridge context at this breakpoint.
      if(this.sim.id==='bridge'&&this.camera.aspect<.95)return;
      // The bridge reference looks slightly upward at the near tower.
      // The ordinary ground-facing orbit limit would silently lift this pose.
      this.controls.maxPolarAngle=Math.PI*(this.sim.id==='bridge'?.6:.49);
      const p=REFERENCE_CAMERAS[this.sim.id];this.controls.target.fromArray(p.target);this.camera.position.fromArray(p.position);this.camera.fov=p.fov;
      const aspect=this.framingAspect(),framing=Math.max(1,.94/aspect);this.camera.position.sub(this.controls.target).multiplyScalar(framing).add(this.controls.target);
      this.camera.updateProjectionMatrix();this.controls.update();return;
    }
    const study=STUDIES[this.sim.id],bridge=this.sim.id==='bridge';
    if(mode==='wide'){
      this.camera.position.sub(this.controls.target).multiplyScalar(1.28).add(this.controls.target);
      this.camera.updateProjectionMatrix();this.controls.update();return;
    }
    if(mode==='stream'||mode==='bank'){
      this.controls.target.set(...(mode==='stream'?[0,1,-8]:[13.8,-1.35,21]) as Vec);
      this.camera.position.set(...(mode==='stream'?[11,4.8,38]:[18,1.4,28]) as Vec);this.camera.fov=mode==='stream'?48:44;
      this.camera.updateProjectionMatrix();this.controls.update();return;
    }else if(mode==='connection'){
      this.controls.target.set(...(bridge?[-21,13.6,1.9]:this.sim.id==='plate'?[2.64,3.2,2.2]:[5,5.3,4]) as Vec);
      this.camera.position.copy(this.controls.target).add(new T.Vector3(...(bridge?[5,2,8]:this.sim.id==='plate'?[-3,2.2,4]:[3,2.4,4])));this.camera.fov=38;
    } else if(mode==='oblique'){
      this.controls.target.set(0,study.supportY,0);this.camera.position.copy(this.controls.target).add(new T.Vector3(...(bridge?[-34,25,37]:this.sim.id==='plate'?[-10,10,13]:[-13,10,14])));this.camera.fov=44;
    } else if(mode==='detail'){
      this.controls.target.set(bridge?-3:0,study.supportY,0);
      this.camera.position.copy(this.controls.target).add(new T.Vector3(...(bridge?[-12,4,13]:this.sim.id==='plate'?[4,3.7,7]:[6,5,7])));
      this.camera.fov=42;
    } else if(mode==='plan'){
      this.controls.target.set(0,study.supportY,0);this.camera.position.set(0,bridge?62:16.6,.15);this.camera.fov=44;
    } else {
      this.controls.target.set(0,study.supportY,0);this.camera.position.set(bridge?-4:10,study.supportY+(bridge?2:1.6),bridge?52:16);this.camera.fov=42;
    }
    const framing=Math.max(1,(this.sim.id==='plate'&&mode==='detail'?.7:1.1)/(mode==='detail'||mode==='connection'?this.camera.aspect:this.framingAspect()));
    if(mode==='plan'&&!bridge){
      // Inspect beneath the hall rafters; widen the lens instead of moving
      // through the roof when a portrait viewport needs more horizontal room.
      const visibleHeight=Math.max(study.depth+2.5,(study.span+3)/this.camera.aspect);
      this.camera.fov=T.MathUtils.radToDeg(2*Math.atan(visibleHeight*.55/(16.6-study.supportY)));
    }else this.camera.position.sub(this.controls.target).multiplyScalar(framing).add(this.controls.target);
    this.camera.updateProjectionMatrix();this.controls.update();
  }
  focusBridgePoint(point:Vec):void {
    if(this.sim.id!=='bridge')return;
    this.setCamera('detail');this.controls.target.set(...point);
    this.camera.position.copy(this.controls.target).add(new T.Vector3(-8,6,12));
    this.camera.fov=45;this.camera.updateProjectionMatrix();this.controls.update();
  }
  private fitBridgeFrame(points?:number[][]):void {
    const w=this.host.clientWidth,h=this.host.clientHeight,studio=this.host.closest<HTMLElement>('#studio');
    const focus=studio?.classList.contains('scene-focus'),desk=!studio?.classList.contains('desk-collapsed')&&!focus&&w>800;
    const review=studio?.dataset.deskPanel==='review';
    const response=studio?.classList.contains('response-open')&&!focus&&!review;
    const origin=this.host.getBoundingClientRect();
    const rect=studio?.querySelector<HTMLElement>('.response-panel')?.getBoundingClientRect();
    const bottom=response&&rect?Math.min(h-48,rect.top-origin.top-22):h-70;
    const panel=studio?.querySelector<HTMLElement>('.load-inspector')?.getBoundingClientRect();
    const left=desk&&w>1000&&!review?258:24,right=desk&&panel?panel.left-origin.left-20:w-24,top=desk&&!review?120:80;
    frameBridge(this.camera,this.controls.target,w,h,{left,right,top,bottom},points);
  }
  private applyWorkspaceOffset():void {
    const w=this.host.clientWidth,h=this.host.clientHeight,studio=this.host.closest<HTMLElement>('#studio');
    if(w<1||h<1)return;
    if(studio?.classList.contains('scene-workflow')&&!studio.classList.contains('desk-collapsed')&&!studio.classList.contains('scene-focus')&&w>800){
      const panel=studio.querySelector<HTMLElement>('.load-inspector')!.getBoundingClientRect(),host=this.host.getBoundingClientRect();
      this.camera.setViewOffset(w,h,Math.max(0,host.right-panel.left)/2,studio.classList.contains('reference-workflow')&&window.innerWidth>1000?85:0,w,h);
    }else this.camera.clearViewOffset();
  }
  resize():void {
    if(this.disposed)return;
    const w=this.host.clientWidth,h=this.host.clientHeight;if(w<1||h<1)return;
    this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
    const studio=this.host.closest<HTMLElement>('#studio'),layout=[w,h,studio?.dataset.theme,studio?.dataset.deskPanel,studio?.dataset.reviewMode,studio?.classList.contains('scene-focus'),studio?.classList.contains('desk-collapsed'),studio?.classList.contains('reference-workflow'),studio?.classList.contains('response-open')].join(':');
    if(layout!==this.cameraLayout){this.cameraLayout=layout;this.setCamera(this.cameraPreset);}
  }
  render(time:number):void {
    if(this.disposed)return;
    this.water?.advance(time);
    if(this.water&&this.sim.id==='bridge'){
      const t=this.sim.time,events=clusterImpacts(this.sim.waterImpacts,t);
      this.water.setImpacts(t,events,waterContacts(this.sim));this.splash?.update(t,events);
    }
    this.frame++;
    this.fpsFrames++;
    if(time-this.lastFpsTime>1){this.fps=this.fpsFrames/Math.max(.001,time-this.lastFpsTime);this.fpsFrames=0;this.lastFpsTime=time;}
    this.controls.update();if(this.pipeline)this.pipeline.render();else this.renderer.render(this.scene,this.camera);
  }
  cameraState():object {return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),fov:this.camera.fov};}
  onGraphicsLost(callback:(message:string)=>void):void {this.graphicsLost=callback;}
  presentationState():object {return {finish:this.currentFinish.id,lighting:this.look.id,surroundings:this.surroundings.id,camera:this.cameraPreset,quality:this.renderQuality,exposure:this.renderer.toneMappingExposure,river:this.sim.id==='bridge'?{...this.riverSettings,affectsStructure:false}:null};}
  riverTime():number {return this.water?.clock.value??0;}
  metrics():{fps:number;drawCalls:number;triangles:number;objects:number;textures:number} {
    const info=this.renderer.info;let objects=0;this.root.traverse(o=>{if(o instanceof T.Mesh)objects+=o instanceof T.InstancedMesh?o.count:1;});
    return {fps:Math.round(this.fps),drawCalls:info.render.drawCalls,triangles:info.render.triangles,objects,textures:info.memory.textures};
  }
  private disposeAsset(root:T.Object3D):void {
    const geometries=new Set<T.BufferGeometry>(),materials=new Set<T.Material>(),textures=new Set<T.Texture>();
    root.traverse(object=>{if(object instanceof T.Mesh){geometries.add(object.geometry);for(const material of Array.isArray(object.material)?object.material:[object.material])materials.add(material);if(object instanceof T.InstancedMesh)object.dispose();}});
    for(const material of materials)for(const value of Object.values(material))if(value instanceof T.Texture)textures.add(value);
    geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());textures.forEach(t=>t.dispose());
  }
  dispose():void {
    if(this.disposed)return;this.disposed=true;this.finishRevision++;this.graphicsLost=undefined;
    this.resizeObserver.disconnect();this.controls.dispose();this.pipeline?.dispose();
    const geometries=new Set<T.BufferGeometry>();
    this.root.traverse(object=>{if(object instanceof T.Mesh){geometries.add(object.geometry);if(object instanceof T.InstancedMesh)object.dispose();}if(object instanceof T.Light)object.dispose();});
    geometries.forEach(g=>g.dispose());this.cylinder.dispose();this.water?.dispose();
    this.ownedMaterials.forEach(m=>m.dispose());this.ownedMaterials.clear();this.analysisMaterial?.dispose();
    this.roadTextures.forEach(t=>t.dispose());this.roadTextures=[];
    this.woodlandSources.forEach(source=>this.disposeAsset(source));this.woodlandSources=[];
    this.sky?.dispose();this.exteriorEnvironment?.dispose();this.interiorEnvironment?.dispose();this.pressEnvironment?.dispose();this.environmentGenerator?.dispose();this.rippleNormals.dispose();
    this.library.dispose();this.root.clear();this.scene.clear();this.lastSnapshot=undefined;this.renderer.dispose();this.renderer.domElement.remove();
  }
}
