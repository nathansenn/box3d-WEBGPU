// Concrete crush lab in SI units: a cube of the concrete law (src/engine/concrete-law.ts on the tetrahedral solid,
// src/engine/solid.ts) between a fixed steel base and a displacement-controlled steel platen through SolidContact
// (src/engine/solid-contact.ts), with Coulomb friction at both faces. See docs/STUDIO_MATERIAL_LABS.md.
import {SolidBody,boxMesh,tetVolume,ec2CompressionStress} from '../../engine/solid';
import {SolidContact} from '../../engine/solid-contact';
import {concreteMaterial,materialProperty} from '../../engine/materials';
import type {SolidMaterial} from '../../engine/solid';
import {LabModel,DT,random} from './lab-model';
import type {LabSettings} from './catalog';

/** The rig draws the cube this many times larger than its SI size (a 150 mm cube is drawn 1.2 m wide). */
export const CONCRETE_DRAW_SCALE=8;
/** Top of the base platen in the rig's drawing, m. */
export const CONCRETE_DRAW_BASE=.95;
/** Time step of the solid, s. The test is quasi-static: the law has no rate effect and the inertia of the cube is negligible
 * at these platen speeds, so the simulated test runs faster than the EN 12390-3 rate (0.6 MPa/s) and gives the same curve. */
export const CONCRETE_DT=1/30;
/** Cells along each edge of the cube (five tetrahedra per cell). */
export const CONCRETE_CELLS=5;
/** Platen friction steel on concrete: 0.57, the dry static coefficient Rabbat and Russell (J. Struct. Eng. 111(3), 1985)
 * recommend for rolled steel plate on concrete cast against it, read in a search summary of the paper, not in the paper:
 * unverified for a machined platen. */
export const PLATEN_FRICTION=.57;
/** The machine stops when the load has fallen to this fraction of the peak. */
export const STOP_FRACTION=.3;

export interface ConcreteSpec {
  name:string;libraryId:string;material:SolidMaterial;
  /** Strength scatter between elements (coefficient of variation) that seeds where the cube cracks. */
  scatter:number;
  /** What is sourced and what is not. */
  source:string;
  /** False when the preset stands for something the model does not represent (reinforcement). */
  modelled:boolean;
}
/** Tension softening of a steel-fibre concrete: stress fractions of f_t at crack openings (m). Unverified: a typical shape
 * for 30 to 40 kg/m^3 of hooked steel fibres (a drop to half the strength by 0.05 mm, then a slow loss to 5 mm), giving
 * G_f of about 4 kJ/m^2, some 30 times plain concrete. Not from an opened source. */
export const FIBRE_SOFTENING=[5e-5,.5,2.5e-3,.3,5e-3,0];
const fibreEnergy=(ft:number)=>{let a=0,w0=0,s0=1;for(let i=0;i<FIBRE_SOFTENING.length;i+=2){a+=(FIBRE_SOFTENING[i]-w0)*(FIBRE_SOFTENING[i+1]+s0)/2*ft;w0=FIBRE_SOFTENING[i];s0=FIBRE_SOFTENING[i+1];}return a;};

/** SI law of each Studio mix. Concrete classes from the material library (EN 1992-1-1 Table 3.1, section 11 for LC); the
 * mapping of a Studio name onto a class is stated in `source`. */
export function concreteSpec(material:string,edge=.15):ConcreteSpec {
  const band=edge/CONCRETE_CELLS;
  const lib=(id:string,extra:Record<string,unknown>={})=>{const m=concreteMaterial(id,{allowUnverified:true});return {...m,concrete:{...m.concrete!,bandWidth:band,...extra}} as SolidMaterial;};
  switch(material){
    case 'high-strength':return {name:'High-strength concrete C60/75',libraryId:'concrete-c60-75',material:lib('concrete-c60-75'),scatter:.05,modelled:true,source:'C60/75 from EN 1992-1-1 Table 3.1; G_f from the fib Model Code 2010 formula'};
    case 'reinforced':return {name:'Reinforced concrete (bars not modelled)',libraryId:'concrete-c30-37',material:lib('concrete-c30-37'),scatter:.08,modelled:false,source:'authored, unverified: runs as plain C30/37; embedded reinforcement is not modelled in this version'};
    case 'fiber':{const m=lib('concrete-c30-37'),ft=m.concrete!.tensileStrength;return {name:'Steel-fibre concrete (C30/37 matrix)',libraryId:'concrete-c30-37',material:{...m,concrete:{...m.concrete!,fractureEnergy:fibreEnergy(ft),tensionSoftening:FIBRE_SOFTENING}},scatter:.08,modelled:true,source:'C30/37 matrix from the library; the fibre tension softening (G_f ≈ 4 kJ/m²) is unverified'};}
    case 'lightweight':return {name:'Lightweight aggregate concrete LC25/28',libraryId:'concrete-lc25-28',material:lib('concrete-lc25-28'),scatter:.08,modelled:true,source:'LC25/28, density class 1.8, sanded, from EN 1992-1-1 section 11; its G_f is the normal-weight formula (unverified)'};
    case 'mortar':return {name:'Mortar (as C20/25)',libraryId:'concrete-c20-25',material:lib('concrete-c20-25'),scatter:.06,modelled:true,source:'unverified mapping: a mortar run as concrete class C20/25 from EN 1992-1-1 Table 3.1'};
    case 'aged':return {name:'Weathered concrete (as C20/25)',libraryId:'concrete-c20-25',material:lib('concrete-c20-25'),scatter:.15,modelled:true,source:'unverified mapping: weathering taken as a lower class, C20/25, with a wider strength scatter (15 %)'};
    case 'ceramic':{
      const E=materialProperty('alumina-96','youngModulus'),fc=materialProperty('alumina-96','compressiveStrength'),ft=materialProperty('alumina-96','flexuralStrength');
      const m=concreteMaterial('alumina-96',{tensileStrength:ft});
      return {name:'Technical ceramic (96 % alumina)',libraryId:'alumina-96',material:{...m,concrete:{...m.concrete!,bandWidth:band,elasticLimit:1,peakStrain:fc/E,ultimateStrain:fc/E,crushingEnergy:m.concrete!.fractureEnergy}},scatter:.05,modelled:true,
        source:'96 % alumina from a datasheet (E, nu, density, K_IC, flexural and compressive strength); tensile strength taken as the flexural strength and the Drucker-Prager friction of concrete: unverified'};
    }
    default:return {name:'Concrete C30/37',libraryId:'concrete-c30-37',material:lib('concrete-c30-37'),scatter:.08,modelled:true,source:'C30/37 from EN 1992-1-1 Table 3.1; G_f from the fib Model Code 2010 formula'};
  }
}

/** The EN 1992-1-1 (3.14) cylinder curve of a mix, for the chart: [strain %, stress MPa] pairs up to eps_cu1. */
export function ec2Curve(spec:ConcreteSpec):number[] {
  const c=spec.material.concrete!,E=spec.material.youngModulus,out:number[]=[];
  if(c.elasticLimit===1){out.push(0,0,c.peakStrain*100,c.compressiveStrength/1e6);return out;}
  const end=Math.max(c.ultimateStrain,c.peakStrain);
  for(let i=0;i<=40;i++){const e=end*i/40;out.push(e*100,Math.max(0,ec2CompressionStress(e,c.compressiveStrength,c.peakStrain,E))/1e6);}
  return out;
}

/** Program: the platen moves down at `rate` per mille of the edge per second until it has travelled `load` per mille,
 * then holds; "Release load" lifts it at the same rate. */
export class ConcreteModel extends LabModel {
  readonly spec:ConcreteSpec;readonly solid:SolidBody;readonly contact:SolidContact;readonly edge:number;
  /** Specimen height, m. */
  readonly height:number;
  /** Boundary triangles of the intact cube (node indices). */
  readonly surface:Uint32Array;
  platen=0;force=0;peakForce=0;peakStrain=0;unconverged=0;
  /** Why the machine stopped (empty while it runs). */
  stopped='';
  /** Recorded [strain %, stress MPa] pairs, one per solid step. */
  readonly curve:number[]=[];
  private platenBody:number;private clock=0;private travel=0;private readonly damage:Float64Array<ArrayBuffer>;private erodedSeen=0;private readonly neighbours:Int32Array;
  /** Loaded area, m^2. */
  readonly area:number;
  /** `shape: 'prism'` makes a prism of the same section and twice the height (slenderness 2, as the EN 12390 cylinder),
   * the stand-in for the cylinder in the cube-to-cylinder comparison; the lab draws the cube. */
  constructor(p:Partial<LabSettings>={},options:{shape?:'cube'|'prism'}={}){
    super('concrete',p);const s=this.settings;this.edge=s.size/1000;const a=this.edge,prism=options.shape==='prism';
    this.spec=concreteSpec(this.material.id,a);this.height=prism?2*a:a;this.area=a*a;
    this.solid=new SolidBody({mesh:boxMesh({size:[a,this.height,a],cells:[CONCRETE_CELLS,prism?2*CONCRETE_CELLS:CONCRETE_CELLS,CONCRETE_CELLS],origin:[-a/2,0,-a/2]}),material:this.spec.material,
      config:{model:'green-lagrange',dt:CONCRETE_DT,gravity:[0,-9.81,0],massDamping:2,tolerance:1e-6,maxNewtonIterations:40,maxLinearIterations:4000}});
    // A seeded scatter of element strength: where the cube cracks first.
    const rng=random(s.seed),f=new Float64Array(this.solid.tetCount);
    for(let e=0;e<f.length;e++){const u=Math.max(1e-9,rng()),v=rng();f[e]=Math.max(.5,1+this.spec.scatter*Math.sqrt(-2*Math.log(u))*Math.cos(2*Math.PI*v));}
    this.solid.setStrengthFactors(f);
    const friction=s.damping;
    this.contact=new SolidContact(this.solid,{gravity:[0,-9.81,0],predictor:'velocity',frictionTolerance:1e-3,frictionPasses:8});
    this.contact.addBody({shape:{kind:'plane',normal:[0,1,0]},type:'static',position:[0,0,0],rotation:[0,0,0,1],friction});
    const H=this.height;this.platen=H;
    this.platenBody=this.contact.addBody({shape:{kind:'box',halfExtents:[a,.02,a]},type:'kinematic',position:[0,H+.02,0],rotation:[0,0,0,1],friction});
    this.surface=this.solid.faces;this.damage=new Float64Array(this.solid.tetCount);this.neighbours=faceNeighbours(this.solid);
    this.allocate(this.solid.nodeCount);this.frame.damage=new Uint8Array(this.solid.tetCount);this.sync();
  }
  step(dt=DT):void {
    if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new Error('Concrete step must be in (0, 0.25] seconds');
    this.clock+=dt;const s=this.settings,a=this.height,speed=s.rate/1000*a,limit=s.load/1000*a;
    while(this.clock>=CONCRETE_DT-1e-12){
      if(this.stopped){this.frame.time+=CONCRETE_DT;this.clock-=CONCRETE_DT;continue;}
      // After the peak a step may find no equilibrium (the cube gives way faster than the platen moves): it is undone and
      // the machine stops there, as a testing machine stops on a load drop.
      const post=this.peakForce>0&&this.force<.97*this.peakForce,saved=post?{solid:this.solid.saveState(),contact:this.contact.saveState(),travel:this.travel}:null;
      const target=this.released?Math.max(0,this.travel-speed*CONCRETE_DT):Math.min(limit,this.travel+speed*CONCRETE_DT);
      const v=-(target-this.travel)/CONCRETE_DT;
      this.contact.setBodyState(this.platenBody,{position:[0,a-this.travel+.02,0],rotation:[0,0,0,1],linearVelocity:[0,v,0],angularVelocity:[0,0,0]});
      this.contact.step();this.travel=target;this.platen=a-target;this.frame.time+=CONCRETE_DT;this.clock-=CONCRETE_DT;
      if(!this.contact.stats.converged){
        this.unconverged++;
        if(saved){this.solid.restoreState(saved.solid);this.contact.restoreState(saved.contact);this.travel=saved.travel;this.platen=a-this.travel;this.stopped='no equilibrium past the peak';continue;}
      }
      if(this.solid.erodedCount!==this.erodedSeen){this.dropLoose();this.erodedSeen=this.solid.erodedCount;}
      this.force=this.contact.bodyForce(this.platenBody)[1];
      const strain=this.measuredStrain(),stress=this.force/this.area;
      if(this.force>this.peakForce){this.peakForce=this.force;this.peakStrain=strain;}
      this.curve.push(strain*100,stress/1e6);
      if(post&&this.force<STOP_FRACTION*this.peakForce)this.stopped=`load fell below ${STOP_FRACTION*100} % of the peak`;
    }
    this.sync();
  }
  /** Spalling: an element left without a neighbour across any face hangs on by an edge or a corner and carries nothing;
   * it is removed with the crushed and cracked ones. */
  private dropLoose():void {
    const mask=this.solid.erodedMask,nb=this.neighbours;
    for(;;){
      const loose:number[]=[];
      for(let e=0;e<mask.length;e++){if(mask[e])continue;let live=0;for(let q=0;q<4;q++){const n=nb[4*e+q];if(n>=0&&!mask[n])live++;}if(live===0)loose.push(e);}
      if(!loose.length)return;this.solid.erode(loose);
    }
  }
  /** Mean shortening of the cube (top face against the base) over its edge. */
  measuredStrain():number {return this.travel/this.height;}
  private sync():void {
    const f=this.frame,x=this.solid.positions(),k=CONCRETE_DRAW_SCALE;
    for(let n=0;n<this.solid.nodeCount;n++){f.positions[3*n]=k*x[3*n];f.positions[3*n+1]=CONCRETE_DRAW_BASE+k*x[3*n+1];f.positions[3*n+2]=k*x[3*n+2];}
    this.solid.damage(this.damage);const mask=this.solid.erodedMask;
    for(let e=0;e<this.damage.length;e++)f.damage[e]=mask[e]?255:Math.min(254,Math.round(this.damage[e]*254));
    f.actuator=CONCRETE_DRAW_BASE+k*this.platen;
    const stress=this.force/this.area,peak=this.peakForce/this.area,strain=this.measuredStrain();
    const eroded=this.solid.erodedCount;
    f.phase=f.time===0?'Ready':this.stopped?'Failed · machine stopped':this.released?'Unloading':this.peakForce>0&&stress<.97*peak&&strain>this.peakStrain?(eroded?'Crushing · spalling':'Post-peak softening'):this.travel>=this.settings.load/1000*this.height-1e-12?'Holding':'Compressing';
    f.metrics=[stress/1e6,strain*100,this.force/1000];
    f.curve=Float32Array.from(this.curve);
    f.status=`${this.spec.name} · f_cm ${(this.spec.material.concrete!.compressiveStrength/1e6).toFixed(0)} MPa (cylinder) · peak ${(peak/1e6).toFixed(1)} MPa at ${(this.peakStrain*1000).toFixed(2)} ‰ · ${eroded} of ${this.solid.tetCount} elements spalled`+(this.stopped?` · stopped: ${this.stopped}`:'');
  }
}

/** Boundary triangles (node indices, wound outward) of the elements still present, and the element each belongs to. */
export function liveFaces(solid:SolidBody,alive:(e:number)=>boolean):{faces:Uint32Array;owners:Uint32Array} {
  const X=solid.referencePositions,T=solid.tets,seen=new Map<string,number>(),faces:number[]=[],owners:number[]=[],keep:boolean[]=[];
  for(let e=0;e<solid.tetCount;e++){
    if(!alive(e))continue;
    for(let skip=0;skip<4;skip++){
      const f=[0,1,2,3].filter(m=>m!==skip).map(m=>T[4*e+m]),key=[...f].sort((a,b)=>a-b).join(','),prev=seen.get(key);
      if(prev!==undefined){keep[prev]=false;continue;}
      if(tetVolume(X,f[0],f[1],f[2],T[4*e+skip])>0){const t=f[1];f[1]=f[2];f[2]=t;}
      seen.set(key,keep.length);keep.push(true);faces.push(f[0],f[1],f[2]);owners.push(e);
    }
  }
  const outF:number[]=[],outO:number[]=[];for(let i=0;i<keep.length;i++)if(keep[i]){outF.push(faces[3*i],faces[3*i+1],faces[3*i+2]);outO.push(owners[i]);}
  return {faces:Uint32Array.from(outF),owners:Uint32Array.from(outO)};
}

/** For each element, the element across each of its four faces (-1 on the boundary). */
export function faceNeighbours(solid:SolidBody):Int32Array {
  const T=solid.tets,out=new Int32Array(4*solid.tetCount).fill(-1),seen=new Map<string,number>();
  for(let e=0;e<solid.tetCount;e++)for(let skip=0;skip<4;skip++){
    const key=[0,1,2,3].filter(m=>m!==skip).map(m=>T[4*e+m]).sort((a,b)=>a-b).join(','),prev=seen.get(key);
    if(prev===undefined)seen.set(key,4*e+skip);else{out[4*e+skip]=(prev-prev%4)/4;out[prev]=e;}
  }
  return out;
}

