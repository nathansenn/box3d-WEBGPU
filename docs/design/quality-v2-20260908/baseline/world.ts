import * as T from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { pass, vec3, vec4, mix, mrt, output, normalView, renderOutput } from 'three/tsl';
import { ao } from 'three/addons/tsl/display/GTAONode.js';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';
import { FailureSimulation, STUDIES, terrainHeight, type Snapshot, type Vec, type StudyId } from './physics';

const UP = new T.Vector3(0,1,0);
const asset = (file: string) => `${import.meta.env.BASE_URL}studio/materials/${file}`;
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
  private water?: T.Mesh<T.PlaneGeometry,T.MeshPhysicalMaterial>;
  private waterBase?: Float32Array;
  private sim: FailureSimulation;
  private materials: Record<string,T.MeshStandardMaterial> = {};
  private textures: T.Texture[] = [];
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
    const pmrem=new T.PMREMGenerator(this.renderer);
    const room=new RoomEnvironment();
    this.scene.environment=pmrem.fromScene(room,.035).texture;
    room.dispose();pmrem.dispose();
    const loader=new T.TextureLoader();
    const [concrete,weave,metal,foliage]=await Promise.all([
      loader.loadAsync(asset('cast-concrete.png')),loader.loadAsync(asset('ivory-weave.png')),loader.loadAsync(asset('machined-metal.png')),loader.loadAsync(asset('oak-foliage.png')),
    ]);
    for(const t of [concrete,weave,metal]) {t.colorSpace=T.SRGBColorSpace;t.wrapS=t.wrapT=T.RepeatWrapping;t.anisotropy=8;}
    concrete.repeat.set(16,16);weave.repeat.set(2,2);metal.repeat.set(2,2);
    foliage.colorSpace=T.SRGBColorSpace;foliage.anisotropy=4;
    this.textures.push(concrete,weave,metal,foliage);
    const m=(color:string,roughness=.65,metalness=0) => new T.MeshStandardMaterial({color,roughness,metalness});
    this.materials={
      floor:new T.MeshStandardMaterial({color:'#c8c4ba',map:concrete,roughness:.84,bumpMap:concrete,bumpScale:.025}),
      concrete:new T.MeshStandardMaterial({color:'#b3b0a3',map:concrete.clone(),roughness:.95}),
      steel:m('#667074',.38,.85), black:m('#232a2b',.43,.72), chrome:m('#d7dedc',.19,.98),
      bolt:m('#b0b5b2',.28,.92), wall:m('#b7b4a8',.95), dark:m('#39423e',.9),
      wood:m('#797769',.92), orange:m('#ed7b24',.53,.18), yellow:m('#d6b35e',.86),
      fabric:new T.MeshStandardMaterial({color:'#dcd2bf',map:weave,bumpMap:weave,bumpScale:.009,roughness:.97,side:T.DoubleSide}),
      sheet:new T.MeshStandardMaterial({color:'#ced1d0',map:metal,bumpMap:metal,bumpScale:.018,roughness:.36,metalness:.92,side:T.DoubleSide}),
      soil:m('#6c7256',.99),rock:m('#74796e',.97), bark:m('#5d5846',1), leaf:m('#465840',.96),
    };
    this.materials.concrete.map!.repeat.set(2,2);
    this.materials.leaf=new T.MeshStandardMaterial({map:foliage,color:'#c3c4ac',alphaTest:.42,side:T.DoubleSide,roughness:.96});
    this.materials.soil.map=concrete;this.materials.soil.bumpMap=concrete;this.materials.soil.bumpScale=.12;
    this.materials.rock.map=concrete;this.materials.rock.bumpMap=concrete;this.materials.rock.bumpScale=.07;
    this.materials.black.bumpMap=metal;this.materials.black.bumpScale=.012;
    this.materials.steel.bumpMap=metal;this.materials.steel.bumpScale=.008;
    this.materials.chrome.bumpMap=metal;this.materials.chrome.bumpScale=.002;
    const scenePass=pass(this.scene,this.camera,{samples:0});
    scenePass.setMRT(mrt({output,normal:normalView}));
    const ambient=ao(scenePass.getTextureNode('depth'),scenePass.getTextureNode('normal'),this.camera);
    ambient.resolutionScale=.5;ambient.radius.value=.65;ambient.thickness.value=1.2;
    this.pipeline=new T.RenderPipeline(this.renderer);
    const shaded=scenePass.getTextureNode('output').mul(vec4(vec3(mix(1,ambient.getTextureNode().r,.6)),1));
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
    this.root.traverse(o=>{if(o instanceof T.Mesh && o.geometry!==this.cylinder)o.geometry.dispose();});
    this.root.clear();this.sim=sim;this.surface=undefined;this.linksMesh=undefined;this.decks=undefined;
    this.borderMesh=undefined;this.railPosts=undefined;this.rails=undefined;this.water=undefined;
    this.lastTopology=-1;this.lastSnapshot=undefined;
    const outdoor=sim.id==='bridge';
    this.scene.background=new T.Color(outdoor?'#b9d6e4':'#bfc7c5');
    this.scene.fog=new T.Fog(outdoor?'#b9d6e4':'#bfc7c5',outdoor?110:40,outdoor?320:120);
    this.scene.environmentIntensity=outdoor?.65:.65;
    const hemi=new T.HemisphereLight(outdoor?'#d7edff':'#eaf2f4',outdoor?'#62634d':'#777568',outdoor?1.2:.75);this.root.add(hemi);
    const sun=new T.DirectionalLight('#fff2d5',outdoor?3.2:3.5);
    sun.position.set(-14,26,9);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);
    const extent=outdoor?35:15;
    Object.assign(sun.shadow.camera,{left:-extent,right:extent,top:extent,bottom:-extent,near:.1,far:100});
    sun.shadow.bias=-.0003;sun.shadow.normalBias=.035;this.root.add(sun);
    const fill=new T.DirectionalLight('#d9e9f6',.4);fill.position.set(12,9,-15);this.root.add(fill);
    if(outdoor) {this.buildLandscape();this.buildBridge();}
    else {this.buildHall();if(sim.id==='canopy')this.buildCanopy();else this.buildPress();this.buildSurface();}
    this.fit();this.update(sim.snapshot(),false);
  }
  attach(host:HTMLElement):void {this.resizeObserver.disconnect();this.host=host;host.append(this.renderer.domElement);this.resizeObserver.observe(host);this.resize();}
  changeStudy(sim:FailureSimulation):void {this.build(sim);}
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
    }
    const perimeter=2*(this.sim.config.cols+this.sim.config.rows)-4;
    this.borderMesh=new T.InstancedMesh(this.cylinder,this.materials.fabric,perimeter);
    this.borderMesh.castShadow=true;this.root.add(this.borderMesh);
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
    this.rod([2.1,7,1],[2.1,4.6,1],.06,'black');this.rod([2.1,4.6,1],[1.1,4.6,1],.06,'black');
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
    const mat=this.materials[sim.id==='plate'?'sheet':'fabric'].clone();
    this.naturalMaterial=mat;
    this.analysisMaterial=new T.MeshStandardMaterial({color:'#ffffff',vertexColors:true,roughness:.7,metalness:.05,side:T.DoubleSide});
    this.surface=new T.Mesh(g,mat);this.surface.castShadow=true;this.surface.receiveShadow=true;this.surface.frustumCulled=false;this.root.add(this.surface);
  }

  private buildLandscape():void {
    const geometry=new T.PlaneGeometry(320,300,180,140);geometry.rotateX(-Math.PI/2);
    const p=geometry.getAttribute('position');const colors=new Float32Array(p.count*3);const c=new T.Color();
    for(let i=0;i<p.count;i++) {
      const x=p.getX(i),z=p.getZ(i);let y=terrainHeight(x,z);
      const far=Math.max(0,Math.abs(x)-38)+Math.max(0,Math.abs(z)-42)*.5;
      y+=far*.2*(1.2+Math.sin(x*.035+z*.044)*.65+Math.cos(z*.08)*.25);
      p.setY(i,y);c.setHSL(.21+seeded(i)*.035,.13+seeded(i+4)*.1,.24+seeded(i+8)*.1);
      if(Math.abs(x)<17)c.set('#696e5e');c.toArray(colors,i*3);
    }
    geometry.setAttribute('color',new T.BufferAttribute(colors,3));geometry.computeVertexNormals();
    const groundMat=this.materials.soil.clone();groundMat.color.set('#64714c');groundMat.vertexColors=true;
    this.mesh(geometry,groundMat,[0,0,0]);
    const wg=new T.PlaneGeometry(34,260,90,160);wg.rotateX(-Math.PI/2);
    this.waterBase=new Float32Array(wg.getAttribute('position').array);
    this.water=new T.Mesh(wg,new T.MeshPhysicalMaterial({color:'#35565a',metalness:.12,roughness:.31,transparent:true,opacity:.90,clearcoat:1,clearcoatRoughness:.18}));
    this.water.position.y=-1.48;this.water.receiveShadow=true;this.root.add(this.water);
    // Riverbank rocks: irregular faceted vertices, resting at sampled terrain height.
    const rockGeo=new T.IcosahedronGeometry(1,1);const rp=rockGeo.getAttribute('position');
    for(let i=0;i<rp.count;i++){const x=rp.getX(i),y=rp.getY(i),z=rp.getZ(i),f=.88+.1*Math.sin(x*13+y*9+z*7);rp.setXYZ(i,x*f,y*f*.65,z*f);}rockGeo.computeVertexNormals();
    const rocks=new T.InstancedMesh(rockGeo,this.materials.rock,330);rocks.castShadow=true;rocks.receiveShadow=true;
    for(let i=0;i<330;i++) {
      const x=(i%2?1:-1)*(13.8+seeded(i*3)*9),z=(seeded(i*3+1)-.5)*150,s=.24+seeded(i*3+2)*1.1;
      this.dummy.position.set(x,terrainHeight(x,z)+s*.21,z);this.dummy.scale.set(s,s,s*.75);this.dummy.rotation.set(0,seeded(i+4)*6.28,0);this.dummy.updateMatrix();rocks.setMatrixAt(i,this.dummy.matrix);
    }this.root.add(rocks);
    this.buildTrees();
  }

  private buildTrees():void {
    const count=360,cards=38;
    const trunks=new T.InstancedMesh(new T.CylinderGeometry(.14,.25,1,7),this.materials.bark,count);
    const branches=new T.InstancedMesh(this.cylinder,this.materials.bark,count*4);
    const leaves=new T.InstancedMesh(new T.PlaneGeometry(1,1),this.materials.leaf,count*cards);
    leaves.castShadow=true;leaves.receiveShadow=true;trunks.castShadow=true;branches.castShadow=true;
    const color=new T.Color();
    for(let i=0;i<count;i++) {
      const x=(i%2?1:-1)*(27+seeded(i+51)*100);let z=(seeded(i*3+8)-.5)*190;
      if(Math.abs(x)<67&&z>0)z=-24-Math.abs(z);
      const ground=terrainHeight(x,z)+(Math.max(0,Math.abs(x)-38)+Math.max(0,Math.abs(z)-42)*.5)*.2*(1.2+Math.sin(x*.035+z*.044)*.65+Math.cos(z*.08)*.25);
      const h=4+seeded(i+41)*9;
      this.dummy.position.set(x,ground+h*.39,z);this.dummy.scale.set(1,h*.78,1);this.dummy.rotation.set(0,0,0);this.dummy.updateMatrix();trunks.setMatrixAt(i,this.dummy.matrix);
      for(let k=0;k<4;k++) {
        const a=k*2.4+i;
        this.instanceRod(branches,i*4+k,[x,ground+h*.45,z],[x+Math.sin(a)*h*.22,ground+h*(.75+k*.055),z+Math.cos(a)*h*.22],.075);
      }
      for(let k=0;k<cards;k++) {
        const a=k*2.39996+i*.33,level=seeded(i*cards+k+9),r=h*.27*Math.sqrt(seeded(i*cards+k+19));
        this.dummy.position.set(x+Math.sin(a)*r,ground+h*(.42+level*.56),z+Math.cos(a)*r);
        const size=h*(.25+seeded(i+k+62)*.14);
        this.dummy.scale.set(size,size,1);this.dummy.rotation.set((seeded(k+i)-.5)*2.4,a,seeded(k+66+i)*2);
        this.dummy.updateMatrix();leaves.setMatrixAt(i*cards+k,this.dummy.matrix);
        color.setHSL(.14+seeded(i+8)*.07,.08,.70+seeded(i+11)*.15);leaves.setColorAt(i*cards+k,color);
      }
    }this.root.add(trunks,branches,leaves);
  }

  private buildBridge():void {
    const {span,depth,supportY,cols}=STUDIES.bridge;
    for(const sx of [-1,1]) {
      const x=sx*span/2;
      this.box([4.1,4.8,7.2],[x,1.1,0],'concrete',.08);
      for(const sz of [-1,1]) {
        const z=sz*depth/2;
        this.box([1.2,.22,1.2],[x,3.62,z],'steel',.025);
        this.iColumn(x,z,3.75,10.25,.42);
        this.box([.92,.15,.9],[x,14.08,z],'steel',.04);
        this.cyl(.25,.12,[x,14.22,z],'chrome');
        for(const dx of [-.43,.43])for(const dz of [-.43,.43])this.bolt(x+dx,3.74,z+dz,.08);
        for(let y=4.2;y<14;y+=.65)for(const dz of [-.12,.12]){
          const bolt=this.cyl(.04,.04,[x+sx*.25,y,z+dz],'bolt');bolt.rotation.z=Math.PI/2;
        }
        const ax=sx*(span/2+7),ay=terrainHeight(ax,z)+1.1;
        this.box([2.2,1.6,1.9],[ax,ay-.5,z],'concrete',.08);
        this.rod([x,14,z],[ax,ay+.35,z],.095,'steel');
        this.rod([x+.06,14,z],[ax+.06,ay+.35,z],.034,'chrome');
      }
      for(const y of [9.8,13.5])this.box([.42,.35,depth+.5],[x,y,0],'steel');
      this.beam([x,9.9,-depth/2],[x,13.45,depth/2],.14,.14);
      this.beam([x,9.9,depth/2],[x,13.45,-depth/2],.14,.14);
      this.box([9,.2,depth],[x+sx*6,4.65,0],'wood');
      // Ramped approach meets the deck on the abutment.
      for(const sz of [-1,1])this.rod([x,6,sz*depth/2],[x+sx*10,6,sz*depth/2],.045);
    }
    this.linksMesh=new T.InstancedMesh(this.cylinder,this.materials.steel,this.sim.links.length);
    this.linksMesh.castShadow=true;this.linksMesh.receiveShadow=true;this.root.add(this.linksMesh);
    // One full-width plank belongs to each independent deck station, including after collapse.
    this.decks=new T.InstancedMesh(new T.BoxGeometry(span/(cols-1)*.94,.16,depth),this.materials.wood,cols);
    this.decks.castShadow=true;this.decks.receiveShadow=true;this.root.add(this.decks);
    this.railPosts=new T.InstancedMesh(this.cylinder,this.materials.steel,cols*2);this.railPosts.castShadow=true;this.root.add(this.railPosts);
    this.rails=new T.InstancedMesh(this.cylinder,this.materials.steel,(cols-1)*2*3);this.rails.castShadow=true;this.root.add(this.rails);
    const plankColor=new T.Color();for(let i=0;i<cols;i++){plankColor.setHSL(.13,.07,.49+seeded(i)*.1);this.decks.setColorAt(i,plankColor);}
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
    }
    if(this.borderMesh) {
      const {cols,rows}=sim.config;let k=0;
      const pairs:[number,number][]=[];
      for(let x=0;x<cols-1;x++){pairs.push([x,x+1]);pairs.push([(rows-1)*cols+x,(rows-1)*cols+x+1]);}
      for(let y=0;y<rows-1;y++){pairs.push([y*cols,(y+1)*cols]);pairs.push([y*cols+cols-1,(y+1)*cols+cols-1]);}
      for(const [a,b] of pairs)this.instanceRod(this.borderMesh,k++,p(a),p(b),.018,Math.hypot(...p(a).map((v,i)=>v-p(b)[i]))<.9);
      this.borderMesh.count=k;this.borderMesh.instanceMatrix.needsUpdate=true;
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
    }
  }

  fit(second=false):void {
    const c=STUDIES[this.sim.id];this.camera.fov=c.fov;
    this.controls.target.set(...c.target);
    const position=new T.Vector3(...(second?c.secondCamera:c.camera));
    const aspect=this.host.clientWidth/Math.max(1,this.host.clientHeight);
    // Preserve the full specimen and both bridge towers when the viewport becomes portrait.
    const framing=Math.max(1,1.1/aspect);
    this.camera.position.copy(position.sub(this.controls.target).multiplyScalar(framing).add(this.controls.target));
    this.camera.updateProjectionMatrix();this.controls.update();
  }
  resize():void {
    const w=this.host.clientWidth,h=this.host.clientHeight;if(w<1||h<1)return;
    this.renderer.setSize(w,h);this.camera.aspect=w/h;this.camera.updateProjectionMatrix();
    const compact=w/h<1;
    if(compact!==this.compactFraming){this.compactFraming=compact;this.fit();}
  }
  render(time:number):void {
    this.frame++;
    if(this.water&&this.waterBase&&this.frame%3===0) {
      const p=this.water.geometry.getAttribute('position');
      for(let i=0;i<p.count;i++){const x=this.waterBase[i*3],z=this.waterBase[i*3+2];p.setY(i,.014*Math.sin(x*1.7+Math.sin(z*.8)*1.9+z*.9-time*2.2)+.009*Math.cos(z*3.7+x*1.15+time*1.4));}
      p.needsUpdate=true;this.water.geometry.computeVertexNormals();
    }
    this.controls.update();if(this.pipeline)this.pipeline.render();else this.renderer.render(this.scene,this.camera);
  }
  cameraState():object {return {position:this.camera.position.toArray(),target:this.controls.target.toArray(),fov:this.camera.fov};}
}
