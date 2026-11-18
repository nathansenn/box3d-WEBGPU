import * as T from 'three/webgpu';
import {RoundedBoxGeometry} from 'three/addons/geometries/RoundedBoxGeometry.js';
import {LiquidModel,random,type LabFrame,type V3} from './models';
import {surfaceFor,type LiquidDisplay} from './liquid-config';
import {rimHeight} from './liquid-terrain';
import {measureSection} from './liquid-analysis';
const UP=new T.Vector3(0,1,0);
/** All moving presentation is a pure function of a recorded hydraulic frame. */
export class LiquidScene {
  readonly group=new T.Group();
  private owned:T.Material[]=[];private textures:T.Texture[]=[];
  private mats:Record<string,T.Material>;private water:T.Mesh<T.BufferGeometry>;private sides:T.Mesh<T.BufferGeometry>;private spill:T.Mesh<T.BufferGeometry>;private waterMat:T.MeshPhysicalMaterial;
  private gate=new T.Group();private foam:T.InstancedMesh;private rain:T.InstancedMesh;private currents:T.InstancedMesh;
  private jets:T.Mesh<T.BufferGeometry>[]=[];private outlets:V3[]=[];private gutter:T.Mesh;private dummy=new T.Object3D();
  private rainSeeds:Float32Array;private allIndices:number[]=[];private initialIndices:number[]=[];
  private display:LiquidDisplay='natural';private inspectionMat:T.MeshBasicMaterial;private drops:T.InstancedMesh;private waterColor=new T.Color();private palette=['#18365f','#197bba','#31cec7','#d7e7a0','#f1ab4f','#d3543c'].map(v=>new T.Color(v));
  private rimSpill:T.Mesh<T.BufferGeometry>;
  private shore:T.Mesh<T.BufferGeometry>;
  private clearWater:boolean;private clearColor=new T.Color('#eff6f2');
  private measurement=new T.Group();private probeMarkers:T.Group[]=[];private sectionPlane?:T.Mesh;private sectionDistance=3;
  constructor(readonly model:LiquidModel,shared:Record<string,T.Material>,ripple:T.Texture,metalEnvironment?:T.Texture){
    const c=model.liquid,surface=surfaceFor(c.surface),own=<M extends T.Material>(m:M):M=>{this.owned.push(m);return m;};
    this.mats={...shared,
      steel:own(new T.MeshStandardMaterial({color:'#a1b4b7',roughness:.26,metalness:.82,envMapIntensity:1.2,envMap:metalEnvironment})),
      blue:own(new T.MeshStandardMaterial({color:'#226586',roughness:.38,metalness:.6})),
      brass:own(new T.MeshStandardMaterial({color:'#b09b56',roughness:.32,metalness:.82})),
      bed:own(new T.MeshPhysicalMaterial({color:c.surface==='steel'?'#657d82':surface.color,roughness:surface.roughness,metalness:c.surface==='steel'?.3:0,clearcoat:['glass','tile','epoxy'].includes(c.surface)?1:0})),
      rock:shared.liquidRock??own(new T.MeshStandardMaterial({color:'#8e9287',roughness:.96})),
      soil:shared.liquidSoil??own(new T.MeshStandardMaterial({color:'#d9d3ba',roughness:1,vertexColors:true})),
      grass:own(new T.MeshStandardMaterial({color:'#d3d7b4',roughness:.97,side:T.DoubleSide,vertexColors:true})),
    };
    const opaque=['milk','slurry','mud','paint','emulsion'].includes(model.material.id);
    this.clearWater=['water','freshwater','seawater','brine'].includes(model.material.id);
    this.waterMat=own(new T.MeshPhysicalMaterial({color:model.material.color,roughness:opaque?.26:.065,metalness:0,transmission:opaque?0:.68,opacity:1,transparent:false,ior:1.333,thickness:.15,attenuationColor:model.material.color,attenuationDistance:.5,clearcoat:.9,envMapIntensity:1.25,side:T.DoubleSide,normalMap:ripple,normalScale:new T.Vector2(.08,.08)}));
    this.waterMat.color.lerp(new T.Color('#dbefea'),opaque?.03:.14);
    this.inspectionMat=own(new T.MeshBasicMaterial({vertexColors:true,side:T.DoubleSide,toneMapped:false}));
    this.buildBench();
    if(c.rig==='flume')this.buildGate();
    else if(c.rig!=='rain')this.buildSupply();
    if(c.rig==='rain'||c.rain>0)this.buildRainRig();
    if(c.rig==='river')this.buildRiver();
    else if(['rain','surface'].includes(c.rig))this.buildSurface();
    else if(c.rig==='flume'||c.rig==='pipes')for(const [x,z] of [[1.25,.48],[2,-.42]]){this.cylinder(.2,.65,[x,model.bed(x)+.325,z],'steel');this.cylinder(.235,.035,[x,model.bed(x)+.018,z],'black');}
    this.water=this.buildWater();
    const shoreGeo=new T.BufferGeometry(),shoreCapacity=this.initialIndices.length*2;for(const [name,size] of [['position',3],['uv',2],['color',3]] as const)shoreGeo.setAttribute(name,new T.BufferAttribute(new Float32Array(shoreCapacity*size),size).setUsage(T.DynamicDrawUsage));this.shore=this.mesh(shoreGeo,[0,0,0],this.waterMat);this.shore.frustumCulled=false;this.shore.castShadow=false;
    const sideGeo=new T.BufferGeometry();sideGeo.setAttribute('uv',new T.BufferAttribute(new Float32Array((model.nx+model.nz)*2*6*2),2));sideGeo.setAttribute('position',new T.BufferAttribute(new Float32Array((model.nx+model.nz)*2*6*3),3).setUsage(T.DynamicDrawUsage));this.sides=this.mesh(sideGeo,[0,0,0],this.waterMat);this.sides.castShadow=false;this.sides.frustumCulled=false;
    const spillGeo=new T.BufferGeometry();spillGeo.setAttribute('uv',new T.BufferAttribute(new Float32Array(model.nz*12*6*2),2));spillGeo.setAttribute('position',new T.BufferAttribute(new Float32Array(model.nz*12*6*3),3).setUsage(T.DynamicDrawUsage));this.spill=this.mesh(spillGeo,[0,0,0],this.waterMat);this.spill.castShadow=false;this.spill.frustumCulled=false;
    const foamMat=own(new T.MeshBasicMaterial({color:'#e3f3e6',transparent:true,opacity:.58,depthWrite:false}));
    this.foam=new T.InstancedMesh(new T.SphereGeometry(.024,6,4),foamMat,400);this.foam.frustumCulled=false;this.group.add(this.foam);
    const traceMat=own(new T.MeshBasicMaterial({color:'#d0eee5',transparent:true,opacity:.42,depthWrite:false}));
    this.currents=new T.InstancedMesh(new T.PlaneGeometry(.085,.009),traceMat,400);this.currents.frustumCulled=false;this.group.add(this.currents);
    const rainMat=own(new T.MeshBasicMaterial({color:'#d4e9e6',transparent:true,opacity:.67,depthWrite:false}));
    this.rain=new T.InstancedMesh(new T.CylinderGeometry(.0027,.0027,.12,3),rainMat,800);this.rain.frustumCulled=false;this.group.add(this.rain);
    const impactMat=own(new T.MeshBasicMaterial({color:'#effdf3',transparent:true,opacity:.35,depthWrite:false,side:T.DoubleSide}));
    this.drops=new T.InstancedMesh(new T.RingGeometry(.028,.033,16),impactMat,220);this.drops.frustumCulled=false;this.group.add(this.drops);
    const rng=random(model.settings.seed);this.rainSeeds=Float32Array.from({length:2400},rng);
    this.gutter=this.box([.43,.02,2.03],[3.36,.4,0],this.waterMat);this.gutter.castShadow=false;
    const rimGeo=new T.BufferGeometry();rimGeo.setAttribute('position',new T.BufferAttribute(new Float32Array((model.nx+model.nz)*2*6*3),3).setUsage(T.DynamicDrawUsage));rimGeo.setAttribute('uv',new T.BufferAttribute(new Float32Array((model.nx+model.nz)*2*6*2),2));this.rimSpill=this.mesh(rimGeo,[0,0,0],this.waterMat);this.rimSpill.castShadow=false;this.rimSpill.frustumCulled=false;
    this.buildMeasurement();this.update(model.frame);
  }
  private buildMeasurement():void {
    this.group.add(this.measurement);this.measurement.visible=false;
    const cyan=new T.MeshBasicMaterial({color:'#21c6ce',transparent:true,opacity:.09,depthWrite:false,side:T.DoubleSide});this.owned.push(cyan);
    this.sectionPlane=this.mesh(new T.PlaneGeometry(2,.65),[0,0,0],cyan,this.measurement);this.sectionPlane.rotation.y=Math.PI/2;this.sectionPlane.castShadow=false;
    for(const [i,color] of ['#087f89','#bd671d','#7860ac'].entries()){
      const marker=new T.Group();this.measurement.add(marker);this.probeMarkers.push(marker);
      const mat=new T.MeshBasicMaterial({color,depthTest:false});this.owned.push(mat);
      const point=this.mesh(new T.SphereGeometry(.025,12,8),[0,0,0],mat,marker);point.castShadow=false;point.renderOrder=5;
      const stem=this.mesh(new T.CylinderGeometry(.003,.003,.26,6),[0,.13,0],mat,marker);stem.castShadow=false;stem.renderOrder=5;
      const canvas=document.createElement('canvas');canvas.width=canvas.height=96;const ctx=canvas.getContext('2d')!;ctx.fillStyle=color;ctx.fillRect(0,0,96,96);ctx.strokeStyle='#f4fbec';ctx.lineWidth=5;ctx.strokeRect(3,3,90,90);ctx.fillStyle='white';ctx.textAlign='center';ctx.textBaseline='middle';ctx.font='600 55px Inter,sans-serif';ctx.fillText(['A','B','C'][i],48,49);
      const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;this.textures.push(texture);
      const material=new T.SpriteMaterial({map:texture,depthTest:false,sizeAttenuation:true});this.owned.push(material);const sprite=new T.Sprite(material);sprite.scale.set(.16,.16,1);sprite.position.y=.32;sprite.renderOrder=6;marker.add(sprite);
    }
  }
  setSection(distance:number,visible:boolean):void {this.sectionDistance=distance;this.measurement.visible=visible;}
  private updateMeasurement(f:LabFrame):void {
    if(!this.measurement.visible)return;const s=measureSection(this.model,f,this.sectionDistance),x=s.distance-3;
    this.sectionPlane!.position.set(x,this.model.datum(x)+.325,0);
    this.probeMarkers.forEach((marker,i)=>{const p=s.probes[i];marker.position.set(x,p.bed+p.depth+.012,p.z);});
  }
  private material(mat:string|T.Material):T.Material {return typeof mat==='string'?this.mats[mat]:mat;}
  private mesh(g:T.BufferGeometry,p:V3,mat:string|T.Material,parent:T.Object3D=this.group):T.Mesh {const m=new T.Mesh(g,this.material(mat));m.position.set(...p);m.castShadow=true;m.receiveShadow=true;parent.add(m);return m;}
  private box(size:V3,p:V3,mat:string|T.Material='steel',parent:T.Object3D=this.group):T.Mesh {return this.mesh(new RoundedBoxGeometry(...size,2,Math.min(.025,...size.map(n=>n*.15))),p,mat,parent);}
  private cylinder(r:number,h:number,p:V3,mat='steel',parent:T.Object3D=this.group):T.Mesh {return this.mesh(new T.CylinderGeometry(r,r,h,48),p,mat,parent);}
  private rod(a:V3,b:V3,r:number,mat='steel',parent:T.Object3D=this.group):T.Mesh {const d=new T.Vector3(...b).sub(new T.Vector3(...a)),m=this.cylinder(r,d.length(),a,mat,parent);m.position.addScaledVector(d,.5);m.quaternion.setFromUnitVectors(UP,d.normalize());return m;}
  private tube(points:V3[],r:number,mat='steel'):void {this.mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points.map(p=>new T.Vector3(...p))),72,r,16,false),[0,0,0],mat);}
  private label(text:string,w:number,h:number,p:V3,bg='#203d44',fg='#eef3e7'):T.Mesh {
    const c=document.createElement('canvas');c.width=1536;c.height=Math.max(64,Math.round(1536*h/w));const ctx=c.getContext('2d')!;ctx.fillStyle=bg;ctx.fillRect(0,0,c.width,c.height);ctx.fillStyle=fg;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`500 ${c.height*.45}px Inter, sans-serif`;ctx.fillText(text,c.width/2,c.height/2,c.width*.94);
    const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;this.textures.push(t);const m=new T.MeshBasicMaterial({map:t});this.owned.push(m);const mesh=this.mesh(new T.PlaneGeometry(w,h),p,m);mesh.castShadow=false;return mesh;
  }
  private flange(p:V3,r:number,axis:V3):void {
    const shape=new T.Shape();shape.absarc(0,0,r*1.55,0,Math.PI*2,false);const hole=new T.Path();hole.absarc(0,0,r*.85,0,Math.PI*2,true);shape.holes.push(hole);
    const geometry=new T.ExtrudeGeometry(shape,{depth:.045,bevelEnabled:true,bevelSize:.002,bevelThickness:.002,bevelSegments:1,steps:1,curveSegments:32});geometry.translate(0,0,-.0225);geometry.rotateX(-Math.PI/2);
    const m=this.mesh(geometry,p,'steel');m.quaternion.setFromUnitVectors(UP,new T.Vector3(...axis));
    const g=new T.Group();g.position.set(...p);g.quaternion.copy(m.quaternion);this.group.add(g);
    for(let i=0;i<8;i++){const a=i/8*Math.PI*2;this.mesh(new T.CylinderGeometry(.014,.014,.06,6),[Math.cos(a)*r*1.23,0,Math.sin(a)*r*1.23],'black',g);}
  }
  private buildBench():void {
    const c=this.model.liquid,y=(x:number)=>this.model.datum(x),high=rimHeight(c);
    for(const x of [-2.9,0,2.9])for(const z of [-1.06,1.06]){
      this.cylinder(.12,.055,[x,.035,z],'black');this.cylinder(.035,.18,[x,.12,z]);this.box([.075,y(x)-.2,.075],[x,(y(x)+.2)/2,z]);this.cylinder(.06,.045,[x,.22,z],'black');
    }
    for(const z of [-1.12,1.12]){this.rod([-3.17,y(-3.17)-.12,z],[3.17,y(3.17)-.12,z],.052);this.rod([-3,.22,z],[3,.22,z],.025,'black');}
    const bed=this.box([6.35,.13,2.28],[0,y(0)-.075,0]);bed.rotation.z=-Math.atan(c.slope/100);
    if(!['rain','surface'].includes(c.rig)){const top=this.box([6.05,.028,2.03],[0,y(0)-.014,0],'bed');top.rotation.z=bed.rotation.z;}
    for(const z of [-1.04,1.04]){
      const wall=this.box([6.17,high,.02],[0,y(0)+high/2,z],'glass');wall.rotation.z=bed.rotation.z;wall.castShadow=false;
      this.rod([-3.08,y(-3.08)+high,z],[3.08,y(3.08)+high,z],.016);
      for(const x of [-3.09,3.09]){this.box([.042,high+.07,.055],[x,y(x)+high/2,z]);for(let i=0;i<4;i++)this.cylinder(.019,.025,[x,y(x)+.06+i*high/4,z],'black').rotation.x=Math.PI/2;}
    }
    if(c.rig==='flume')for(const x of [-3.04,3.04]){const wall=this.box([.02,high,2.08],[x,y(x)+high/2,0],'glass');wall.castShadow=false;}
    else {
      const back=this.box([.018,high,2.08],[-3.04,y(-3.04)+high/2,0],'glass');back.castShadow=false;
      this.box([.6,.12,2.3],[3.36,.27,0]);for(const z of [-1.1,1.1])this.box([.62,.28,.04],[3.36,.4,z]);this.box([.035,.29,2.2],[3.65,.4,0]);
      for(let z=-.94;z<1;z+=.085)this.box([.48,.022,.013],[3.36,.58,z],'black');
      this.tube([[3.55,.35,-.85],[3.8,.35,-.85],[3.85,.12,-.85]],.065);this.flange([3.74,.35,-.85],.065,[1,0,0]);
      this.label('COLLECTION  /  VOLUME BALANCE',1.35,.09,[2.56,.27,1.155]);
      if(c.drain<100){const shutter=this.box([.022,high,2.03],[3.03,y(3.03)+high/2,0],'glass');shutter.castShadow=false;for(let z=-.9;z<1;z+=.1)this.rod([3.035,y(3.035),z],[3.035,y(3.035)+high*(1-c.drain/100),z],.009,'steel');}
    }
    // Metric scale follows the inclined near rail.
    for(let i=0;i<=60;i++){const x=-3+i*.1,len=i%10===0?.065:i%5===0?.043:.022;this.box([.005,len,.004],[x,y(x)-.05,1.149],'black');if(i%10===0)this.label(String(i/10),.09,.045,[x,y(x)-.105,1.154],'#a8babc','#314c50');}
    this.label('BOX3D  /  HYDRAULICS',1.58,.12,[-1.92,y(-1.92)-.22,1.14]);
    this.label(c.rig.toUpperCase()+'   /   6.00 m',1.2,.1,[1.9,y(1.9)-.22,1.14]);
    if(['rain','surface'].includes(c.rig)){
      if(['asphalt','concrete','gravel','rubber'].includes(c.surface))this.buildTextureGrains(c.surface==='rubber'?160:420);
      if(c.surface==='asphalt')for(let x=-2.7;x<3;x+=.75){const line=this.box([.35,.002,.028],[x,this.model.bed(x,0)+.003,0],'white');line.rotation.z=-Math.atan(c.slope/100);}
    }
  }
  private buildGate():void {
    const x=-3+this.model.gateColumn*this.model.dx,y=this.model.bed(x);this.group.add(this.gate);
    for(const z of [-1.1,1.1])this.box([.09,2.25,.1],[x,y+1.1,z]);this.box([.13,.1,2.32],[x,y+2.25,0]);
    this.box([.05,1.05,2.03],[x,y+.525,0],'steel',this.gate);this.cylinder(.025,.65,[x,y+2.5,0]);
    const wheel=this.mesh(new T.TorusGeometry(.18,.019,10,48),[x,y+2.83,0],'brass');wheel.rotation.x=Math.PI/2;
    for(const z of [-.18,.18])this.rod([x,y+2.83,0],[x,y+2.83,z],.014,'brass');
  }
  private buildSupply():void {
    const c=this.model.liquid,r=c.bore/2000+.008,ox=this.model.outlets[0][0],top=this.model.datum(-2.5)+1.1;
    this.box([.88,.12,.86],[-3.67,.16,-.35]);for(const x of [-3.99,-3.35])for(const z of [-.65,-.05])this.cylinder(.08,.1,[x,.05,z],'black');
    const motor=this.cylinder(.24,.52,[-3.7,.51,-.4],'blue');motor.rotation.z=Math.PI/2;
    for(let x=-3.94;x<-3.44;x+=.035){const fin=this.cylinder(.26,.012,[x,.51,-.4],'blue');fin.rotation.z=Math.PI/2;}
    this.box([.25,.09,.2],[-3.7,.79,-.4],'black');this.box([.5,.14,.5],[-3.7,.24,-.4],'blue');
    this.tube([[-3.4,.51,-.4],[-3.26,.63,-.4],[-3.26,top-.16,-.4],[-3.15,top,-.4],[ox,top,-.4]],r);this.flange([-3.26,1,-.4],r,[0,1,0]);this.flange([-2.9,top,-.4],r,[1,0,0]);
    this.cylinder(r*1.3,.12,[-3.26,top-.55,-.4],'brass');this.rod([-3.26,top-.55,-.4],[-3.26,top-.55,-.17],.014,'brass');this.rod([-3.42,top-.55,-.17],[-3.1,top-.55,-.17],.022,'orange');
    this.rod([-3.26,top-.28,-.4],[-3.48,top-.28,-.4],.012);const gauge=this.cylinder(.11,.045,[-3.49,top-.28,-.35]);gauge.rotation.x=Math.PI/2;this.label(c.head.toFixed(1)+' m',.16,.09,[-3.49,top-.28,-.321],'#e8eadc','#274751');
    if(c.pipe==='spraybar')this.rod([ox,top,-.82],[ox,top,.82],r);
    for(const [,z] of this.model.outlets){const outlet:V3=[ox,top-.28,z];this.outlets.push(outlet);const exitR=c.pipe==='spraybar'?r*.5:r;
      if(c.pipe==='spraybar')this.rod([ox,top,z],outlet,exitR);
      else if(c.pipe==='straight')this.tube([[ox,top,-.4],[ox,top,z],outlet],r);else this.tube([[ox-.15,top,-.4],[ox,top,z-.13],[ox,top-.12,z],outlet],r);
      this.flange(outlet,exitR,[0,1,0]);
      if(c.pipe==='nozzle'||c.pipe==='bell')this.mesh(new T.CylinderGeometry(r,c.pipe==='bell'?r*2:r*.55,.13,40,1,true),[ox,top-.345,z],'brass');
      const g=new T.BufferGeometry(),verts=new Float32Array(17*12*3),uv=new Float32Array(17*12*2),idx:number[]=[];
      for(let row=0;row<=16;row++)for(let a=0;a<12;a++){const i=row*12+a;uv.set([a/12,row/16],i*2);if(row<16){const next=row*12+(a+1)%12;idx.push(i,next,i+12,next,next+12,i+12);}}
      g.setAttribute('position',new T.BufferAttribute(verts,3).setUsage(T.DynamicDrawUsage));g.setAttribute('uv',new T.BufferAttribute(uv,2));g.setIndex(idx);const jet=this.mesh(g,[0,0,0],this.waterMat);jet.frustumCulled=false;jet.castShadow=false;this.jets.push(jet);
    }
    this.label('METERED SUPPLY',.6,.1,[-3.67,.17,.088]);
  }
  private rainHeight():number {return this.model.datum(-3)+1.45;}
  private buildRainRig():void {
    const y=this.rainHeight();for(const x of [-2.9,2.9])for(const z of [-1.15,1.15])this.rod([x,.1,z],[x,y+.05,z],.025);
    for(const x of [-2.9,2.9])this.rod([x,y,-1.15],[x,y,1.15],.035);
    for(const z of [-.72,-.24,.24,.72]){this.rod([-2.9,y,z],[2.9,y,z],.025);for(let x=-2.6;x<2.7;x+=.52){this.cylinder(.031,.065,[x,y-.035,z],'brass');this.cylinder(.018,.026,[x,y-.08,z],'black');}}
    this.rod([-2.9,y,-.72],[-2.9,y,.72],.035);this.tube([[-2.9,y,-.72],[-3.08,y,-.72],[-3.16,y-.14,-.72],[-3.16,.24,-.72]],.025,'black');
    this.label('RAINFALL SIMULATOR  /  0–300 mm/h',2.5,.1,[0,y+.07,1.15]);
  }
  private buildTextureGrains(count:number,river=false):void {
    const rng=random(this.model.settings.seed+17),mesh=new T.InstancedMesh(new T.IcosahedronGeometry(1,1),river?this.mats.rock:this.mats.bed,count),color=new T.Color();let used=0;
    for(let i=0;i<count;i++){const x=rng()*6-3,z=rng()*2-1;const s=river?.025+rng()*.048:.005+rng()*.012;
      this.dummy.position.set(x,this.model.bed(x,z),z);this.dummy.rotation.set(rng(),rng()*6,rng());this.dummy.scale.set(s*1.7,s*.6,s);this.dummy.updateMatrix();mesh.setMatrixAt(used,this.dummy.matrix);mesh.setColorAt(used++,color.set(river?'#959884':surfaceFor(this.model.liquid.surface).color).multiplyScalar(.66+rng()*.55));}
    mesh.count=used;mesh.castShadow=river;mesh.receiveShadow=true;this.group.add(mesh);
  }
  private bankHeight(x:number,z:number):number {return this.model.relief(x,z);}
  private buildSurface():void {
    const m=this.model,g=new T.PlaneGeometry(6.04,2.02,168,56);g.rotateX(-Math.PI/2);const p=g.getAttribute('position');
    for(let i=0;i<p.count;i++)p.setY(i,m.bed(p.getX(i),p.getZ(i))-.0002);g.computeVertexNormals();this.mesh(g,[0,0,0],'bed');
    if(m.liquid.terrain==='crown'||m.liquid.terrain==='gutter')for(const z of [-1.015,1.015])this.rod([-3,m.bed(-3,z)+.015,z],[3,m.bed(3,z)+.015,z],.012,'steel');
    if(m.liquid.surface==='tile')for(let x=-3;x<=3;x+=.5)for(let z=-1;z<1;z+=.1)this.rod([x,m.bed(x,z)+.0005,z],[x,m.bed(x,z+.1)+.0005,z+.1],.0015,'black');
  }
  private buildRiver():void {
    const pos:number[]=[],col:number[]=[],uv:number[]=[],idx:number[]=[],nx=112,nz=40,color=new T.Color();
    for(let z=0;z<=nz;z++)for(let x=0;x<=nx;x++){const px=x/nx*6-3,pz=z/nz*2-1,bank=this.bankHeight(px,pz);pos.push(px,this.model.bed(px,pz)-.001,pz);uv.push(px*1.5,pz*1.5);color.set(bank>this.model.liquid.bankHeight*.6?'#d9d3b5':'#949c8e').multiplyScalar(.85+.12*Math.sin(px*14+pz*21));col.push(color.r,color.g,color.b);if(x<nx&&z<nz){const a=z*(nx+1)+x;idx.push(a,a+nx+1,a+1,a+1,a+nx+1,a+nx+2);}}
    const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(pos,3));g.setAttribute('color',new T.Float32BufferAttribute(col,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();this.mesh(g,[0,0,0],'soil');this.buildTextureGrains(850,true);
    for(const [x,z,r] of [[.25,.05,.17],[1.65,-.28,.19]]){const rock=this.mesh(new T.IcosahedronGeometry(r,2),[x,this.model.bed(x,z)+.22,z],'rock');rock.scale.set(1,1.6,1);rock.rotation.y=.8;}
    const rng=random(this.model.settings.seed+48),grass:number[]=[],colors:number[]=[];
    for(let i=0;i<1700;i++){const x=rng()*6-3,z=rng()*2-1;if(this.bankHeight(x,z)<this.model.liquid.bankHeight*.72)continue;const y=this.model.bed(x,z),height=.04+rng()*.15,a=rng()*Math.PI*2,dx=Math.cos(a)*.014,dz=Math.sin(a)*.014;grass.push(x-dx,y,z-dz,x+dx,y,z+dz,x+dx*3,y+height,z+dz*3);for(let j=0;j<3;j++){color.set(j===2?'#b2c082':'#486e40').multiplyScalar(.85+rng()*.2);colors.push(color.r,color.g,color.b);}}
    const blades=new T.BufferGeometry();blades.setAttribute('position',new T.Float32BufferAttribute(grass,3));blades.setAttribute('color',new T.Float32BufferAttribute(colors,3));blades.computeVertexNormals();this.mesh(blades,[0,0,0],'grass');
  }
  private buildWater():T.Mesh<T.BufferGeometry> {
    const m=this.model,g=new T.BufferGeometry(),p=new Float32Array(m.h.length*3),uv=new Float32Array(m.h.length*2);
    for(let z=0;z<m.nz;z++)for(let x=0;x<m.nx;x++){const i=z*m.nx+x;p.set([(x+.5)*m.dx-3,0,(z+.5)*m.dz-1],i*3);uv.set([x/m.nx*3,z/m.nz],i*2);if(x<m.nx-1&&z<m.nz-1){const b=i+1,c=i+m.nx,d=c+1;if(!m.solid[i]&&!m.solid[b]&&!m.solid[c]&&!m.solid[d])this.allIndices.push(i,c,b,b,c,d);}}
    this.initialIndices=[...this.allIndices];g.setAttribute('position',new T.BufferAttribute(p,3).setUsage(T.DynamicDrawUsage));g.setAttribute('color',new T.BufferAttribute(new Float32Array(m.h.length*3),3).setUsage(T.DynamicDrawUsage));g.setAttribute('uv',new T.BufferAttribute(uv,2));g.setIndex(this.allIndices);g.computeVertexNormals();const mesh=this.mesh(g,[0,0,0],this.waterMat);mesh.castShadow=false;mesh.frustumCulled=false;return mesh;
  }
  setDisplay(mode:LiquidDisplay):void {this.display=mode;this.water.material=mode==='natural'?this.waterMat:this.inspectionMat;this.shore.material=this.water.material;}
  update(f:LabFrame):void {
    this.updateMeasurement(f);
    const m=this.model,h=f.hydraulics!,p=this.water.geometry.getAttribute('position');this.gate.position.y=f.actuator;
    const thinFilm=['rain','surface'].includes(m.liquid.rig),filmFactor=thinFilm?Math.min(1,.12+h.meanFilm/40):1;
    if(this.clearWater){this.waterMat.color.set(m.material.color).lerp(this.clearColor,thinFilm?.94:.52);this.waterMat.transmission=thinFilm?.94:.82;this.waterMat.thickness=Math.max(.0001,Math.min(.4,h.meanFilm/1000));this.waterMat.attenuationDistance=2;}
    const normal=this.waterMat.normalMap!;normal.offset.set(-f.time*.02,-f.time*.007);this.waterMat.normalScale.setScalar(filmFactor*(.18+Math.min(.22,f.metrics[1]*.24)/(1+m.material.viscosity)));
    const colors=this.water.geometry.getAttribute('color'),depthLimit=m.liquid.rig==='flume'?1:m.liquid.rig==='river'?.5:m.liquid.rig==='pipes'?.25:.05;
    for(let i=0;i<m.h.length;i++){p.setY(i,m.elevation[i]+Math.max(.00005,f.positions[i]));if(this.display!=='natural'){const value=this.display==='depth'?f.positions[i]/depthLimit:Math.hypot(f.rotations[i*2],f.rotations[i*2+1])/2,t=Math.min(1,Math.max(0,value))*5,index=Math.min(4,Math.floor(t));this.waterColor.copy(this.palette[index]).lerp(this.palette[index+1],t-index);colors.setXYZ(i,this.waterColor.r,this.waterColor.g,this.waterColor.b);}}p.needsUpdate=true;colors.needsUpdate=this.display!=='natural';
    const index=this.water.geometry.index!,shoreP=this.shore.geometry.getAttribute('position'),shoreUV=this.shore.geometry.getAttribute('uv'),shoreC=this.shore.geometry.getAttribute('color'),uv=this.water.geometry.getAttribute('uv'),wet=.00005;let indexCount=0,shoreCount=0;
    const point=(i:number)=>[p.getX(i),p.getY(i),p.getZ(i),uv.getX(i),uv.getY(i),colors.getX(i),colors.getY(i),colors.getZ(i),f.positions[i]];
    for(let i=0;i<this.initialIndices.length;i+=3){const a=this.initialIndices[i],b=this.initialIndices[i+1],c=this.initialIndices[i+2];if(Math.max(f.positions[a],f.positions[b],f.positions[c])<=wet)continue;
      if(Math.min(f.positions[a],f.positions[b],f.positions[c])>=wet){index.setX(indexCount++,a);index.setX(indexCount++,b);index.setX(indexCount++,c);continue;}
      // Clip the wet front inside its triangle instead of revealing an entire
      // grid triangle as soon as one corner becomes wet. Same 0.05 mm threshold
      // as the measured coverage; interpolation never modifies the solver.
      const vertices=[point(a),point(b),point(c)],polygon:number[][]=[];
      for(let j=0;j<3;j++){const from=vertices[j],to=vertices[(j+1)%3],inside=from[8]>=wet,nextInside=to[8]>=wet;if(inside)polygon.push(from);if(inside!==nextInside){const t=(wet-from[8])/(to[8]-from[8]);polygon.push(from.map((v,k)=>v+(to[k]-v)*t));}}
      for(let j=1;j<polygon.length-1;j++)for(const v of [polygon[0],polygon[j],polygon[j+1]]){shoreP.setXYZ(shoreCount,v[0],v[1],v[2]);shoreUV.setXY(shoreCount,v[3],v[4]);shoreC.setXYZ(shoreCount++,v[5],v[6],v[7]);}
    }
    shoreP.needsUpdate=true;shoreUV.needsUpdate=true;shoreC.needsUpdate=true;this.shore.geometry.setDrawRange(0,shoreCount);this.shore.geometry.computeVertexNormals();
    index.needsUpdate=true;this.water.geometry.setDrawRange(0,indexCount);this.water.geometry.computeVertexNormals();
    const side=this.sides.geometry.getAttribute('position');let sideCount=0;
    const edge=(a:number,b:number)=>{if(m.solid[a]||m.solid[b]||Math.max(f.positions[a],f.positions[b])<.000002)return;for(const [i,up] of [[a,0],[a,1],[b,1],[a,0],[b,1],[b,0]])side.setXYZ(sideCount++,p.getX(i),up?p.getY(i):m.elevation[i],p.getZ(i));};
    for(let x=0;x<m.nx-1;x++){edge(x,x+1);edge((m.nz-1)*m.nx+x+1,(m.nz-1)*m.nx+x);}for(let z=0;z<m.nz-1;z++){edge(z*m.nx,(z+1)*m.nx);edge((z+1)*m.nx-1,(z+2)*m.nx-1);}
    side.needsUpdate=true;this.sides.geometry.setDrawRange(0,sideCount);this.sides.geometry.computeVertexNormals();
    const spill=this.spill.geometry.getAttribute('position');let spillCount=0;
    if(m.liquid.rig!=='flume'&&h.outlet>1e-8)for(let z=0;z<m.nz;z++){const i=z*m.nx+m.nx-1;if(m.solid[i]||f.positions[i]<.000003)continue;for(let row=0;row<12;row++)for(const [r,dz] of [[row,0],[row+1,0],[row,1],[row,1],[row+1,0],[row+1,1]]){const frac=r/12,x=3-m.dx*.5+frac*.4,y=(1-frac*frac)*(m.elevation[i]+f.positions[i])+frac*frac*.36;spill.setXYZ(spillCount++,x,y,(z+dz)*m.dz-1);}}
    spill.needsUpdate=true;this.spill.geometry.setDrawRange(0,spillCount);this.spill.geometry.computeVertexNormals();
    const rim=this.rimSpill.geometry.getAttribute('position');let rimCount=0;
    const overflowEdge=(a:number,b:number,ox:number,oz:number)=>{if(m.solid[a]||m.solid[b]||Math.min(p.getY(a)-m.datum(p.getX(a)),p.getY(b)-m.datum(p.getX(b)))<rimHeight(m.liquid)-.0002)return;for(const [i,down] of [[a,0],[a,1],[b,1],[a,0],[b,1],[b,0]])rim.setXYZ(rimCount++,p.getX(i)+ox*(down?.18:.055),down?.06:p.getY(i),p.getZ(i)+oz*(down?.18:.055));};
    if(h.overflowRate>1e-8){for(let x=0;x<m.nx-1;x++){overflowEdge(x,x+1,0,-1);overflowEdge((m.nz-1)*m.nx+x,(m.nz-1)*m.nx+x+1,0,1);}for(let z=0;z<m.nz-1;z++){overflowEdge(z*m.nx,(z+1)*m.nx,-1,0);overflowEdge((z+1)*m.nx-1,(z+2)*m.nx-1,1,0);}}
    rim.needsUpdate=true;this.rimSpill.geometry.setDrawRange(0,rimCount);this.rimSpill.geometry.computeVertexNormals();
    let foam=0,trace=0;
    for(let z=1;z<m.nz-1;z++)for(let x=1;x<m.nx-1;x++){
      const i=z*m.nx+x;if(m.solid[i]||f.positions[i]<.00008)continue;const vx=f.rotations[i*2],vz=f.rotations[i*2+1],speed=Math.hypot(vx,vz),dh=Math.abs(f.positions[i+1]-f.positions[i-1]);
      if(foam<400&&m.material.viscosity<.5&&((dh>.03&&speed>.2&&i%3===0)||(speed>.7&&i%17===0))){this.dummy.position.set(p.getX(i),p.getY(i)+.003,p.getZ(i));this.dummy.rotation.set(0,-Math.atan2(vz,vx),0);this.dummy.scale.set(1.3,.2,.55);this.dummy.updateMatrix();this.foam.setMatrixAt(foam++,this.dummy.matrix);}
      if(trace<400&&speed>.03&&i%7===0){const phase=(f.time*.3+i*.017)%1;this.dummy.position.set(p.getX(i)+(phase-.5)*m.dx*.55,p.getY(i)+.002,p.getZ(i));this.dummy.rotation.set(-Math.PI/2,0,-Math.atan2(vz,vx));this.dummy.scale.set(Math.min(2,speed*2+.3),1,1);this.dummy.updateMatrix();this.currents.setMatrixAt(trace++,this.dummy.matrix);}
    }
    this.foam.count=this.display==='natural'?foam:0;this.foam.instanceMatrix.needsUpdate=true;this.currents.count=trace;this.currents.instanceMatrix.needsUpdate=true;
    const count=Math.min(800,Math.round(h.rainRate/300*800));this.rain.count=count;
    let dropCount=0;
    for(let i=0;i<count;i++){const x=this.rainSeeds[i*3]*5.8-2.9,z=this.rainSeeds[i*3+1]*1.92-.96,phase=(this.rainSeeds[i*3+2]+f.time*2.8)%1,top=this.rainHeight()-.085,cell=Math.floor((z+1)/m.dz)*m.nx+Math.floor((x+3)/m.dx),base=m.bed(x,z)+f.positions[cell]+.004;
      this.dummy.position.set(x+m.liquid.rainWind*.024*(1-phase),base+(top-base)*phase,z);this.dummy.rotation.set(0,0,Math.atan(m.liquid.rainWind*.075));this.dummy.scale.set(1,1,1);this.dummy.updateMatrix();this.rain.setMatrixAt(i,this.dummy.matrix);}
    for(let i=0;i<Math.min(220,count);i++){const x=this.rainSeeds[i*3]*5.8-2.9,z=this.rainSeeds[i*3+1]*1.92-.96,phase=(this.rainSeeds[i*3+2]+f.time*1.7)%1,cell=Math.floor((z+1)/m.dz)*m.nx+Math.floor((x+3)/m.dx);if(phase>.65||f.positions[cell]<.0001)continue;this.dummy.position.set(x,m.bed(x,z)+f.positions[cell]+.0008,z);this.dummy.rotation.set(-Math.PI/2,0,0);this.dummy.scale.setScalar(.3+phase*2);this.dummy.updateMatrix();this.drops.setMatrixAt(dropCount++,this.dummy.matrix);}
    this.drops.count=this.display==='natural'?dropCount:0;this.drops.instanceMatrix.needsUpdate=true;
    this.rain.instanceMatrix.needsUpdate=true;
    this.jets.forEach((jet,j)=>{
      jet.visible=h.inlet>1e-9&&f.time>0;const a=jet.geometry.getAttribute('position'),[ox,oy,oz]=this.outlets[j],cellZ=Math.max(0,Math.min(m.nz-1,Math.floor((oz+1)/m.dz))),cell=cellZ*m.nx+Math.floor((ox+3)/m.dx),bed=m.bed(ox,oz)+f.positions[cell],start=oy-(['nozzle','bell'].includes(m.liquid.pipe)?.13:0),q=h.inlet/this.jets.length,exitSpeed=m.delivery.flow?m.delivery.speed*h.inlet/m.delivery.flow:0;
      for(let row=0;row<=16;row++){const frac=row/16,y=start+(Math.min(start-.025,bed)-start)*frac,v=Math.sqrt(Math.max(.1,exitSpeed*exitSpeed)+2*9.81*Math.max(0,start-y)),radius=Math.sqrt(q/(Math.PI*v));for(let angle=0;angle<12;angle++){const t=angle/12*Math.PI*2,r=radius*(1+.025*Math.sin(row*1.8-f.time*12));a.setXYZ(row*12+angle,ox+Math.cos(t)*r,y,oz+Math.sin(t)*r);}}
      a.needsUpdate=true;jet.geometry.computeVertexNormals();
    });
    this.gutter.visible=h.drained>0;this.gutter.position.y=.35+Math.min(.13,h.drained/1.2);
  }
  dispose():void {this.group.traverse(o=>{if(o instanceof T.InstancedMesh)o.dispose();});this.owned.forEach(m=>m.dispose());this.textures.forEach(t=>t.dispose());}
}
