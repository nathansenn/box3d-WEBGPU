// Elastomer lab in SI units: a viscoelastic Neo-Hookean cylinder (src/engine/solid.ts, config.viscoelastic) between a fixed
// base plane and a kinematic top platen through SolidContact (src/engine/solid-contact.ts). See docs/STUDIO_MATERIAL_LABS.md.
import {SolidBody,boxMesh} from '../../engine/solid';
import {SolidContact} from '../../engine/solid-contact';
import {materialProperty,contactPair} from '../../engine/materials';
import {LabModel,DT} from './lab-model';
import type {LabSettings} from './catalog';

const G=9.81;
/** Top of the base platen in the rig, m. */
export const RUBBER_BASE=1;
/** Time step of the solid, s: backward Euler, quasi-static at these rates. */
export const RUBBER_DT=1/30;
/** Time constant of the zero-load platen during recovery, s: much shorter than the shortest relaxation time (0.3 s). */
export const SERVO_TIME=.05;
/** A filled rubber's relaxation spectrum: Prony weights g_i of the instantaneous modulus at 0.3, 3, 30 and 300 s, g_inf = 0.45
 * (Andena, Cotta Ramusino, Tagliabue, Zalaffi, "A visco-hyperelastic numerical model for the dynamic behaviour of rubbers",
 * Constitutive Models for Rubber XII, 2023, Table 1, blend F2, 4 terms). Used here as the spectrum of the filled elastomers. */
export const FILLED_SPECTRUM={times:[.3,3,30,300],weights:[.2,.19,.1,.06]};
const spectrum=(times:number[],weights:number[])=>{const inf=1-weights.reduce((a,b)=>a+b,0);return times.map((time,i)=>({time,ratio:weights[i]/inf}));};

export interface RubberSpec {name:string;youngModulus:number;poissonRatio:number;density:number;branches:{time:number;ratio:number}[];source:string;}
/** SI values of each Studio elastomer. Only natural rubber's modulus and density are library values; the rest are typical
 * figures marked unverified in docs/STUDIO_MATERIAL_LABS.md. Moduli are long-term (relaxed) values. */
export function rubberSpec(material:string):RubberSpec {
  const filled=spectrum(FILLED_SPECTRUM.times,FILLED_SPECTRUM.weights);
  const nr={youngModulus:materialProperty('natural-rubber','youngModulus'),density:materialProperty('natural-rubber','density')};
  switch(material){
    case 'natural':return {name:'Natural rubber',...nr,poissonRatio:.49,branches:filled,source:'E and rho: library (pure gum); spectrum: filled blend F2'};
    case 'neoprene':return {name:'Neoprene (CR)',youngModulus:4e6,poissonRatio:.49,density:1230,branches:filled,source:'unverified typical values; spectrum: filled blend F2'};
    case 'epdm':return {name:'EPDM',youngModulus:5e6,poissonRatio:.49,density:1150,branches:spectrum([.3,3,30,300],[.25,.22,.12,.08]),source:'unverified'};
    case 'polyurethane':return {name:'Polyurethane elastomer',youngModulus:10e6,poissonRatio:.49,density:1200,branches:filled,source:'unverified typical values; spectrum: filled blend F2'};
    case 'gel':return {name:'Soft gel',youngModulus:.1e6,poissonRatio:.49,density:1000,branches:spectrum([1,10],[.3,.25]),source:'unverified'};
    case 'foam':return {name:'Open-cell foam',youngModulus:.1e6,poissonRatio:0,density:30,branches:spectrum([.3,3],[.15,.1]),source:'unverified; compressible Neo-Hookean, no cell collapse'};
    case 'memory-foam':return {name:'Memory foam',youngModulus:.03e6,poissonRatio:0,density:50,branches:spectrum([2,20],[.45,.3]),source:'unverified; compressible Neo-Hookean, no cell collapse'};
    default:return {name:'Silicone rubber',youngModulus:1.5e6,poissonRatio:.49,density:1150,branches:spectrum([.3,3],[.06,.04]),source:'unverified typical values'};
  }
}

/** A cylinder of tetrahedra: a box mesh whose square cross-section is mapped onto the disc (x sqrt(1 - z^2/2), z sqrt(1 - x^2/2)). */
export function cylinderMesh(radius:number,height:number,across:number,up:number):{positions:Float64Array;tets:Uint32Array} {
  const m=boxMesh({size:[2,height,2],cells:[across,up,across],origin:[-1,RUBBER_BASE,-1]}),p=m.positions;
  for(let n=0;n<p.length;n+=3){const x=p[n],z=p[n+2];p[n]=radius*x*Math.sqrt(1-z*z/2);p[n+2]=radius*z*Math.sqrt(1-x*x/2);}
  return m;
}

/** Program: the platen compresses at `rate` %/s to `load` % of the height, holds it for `damping` s (stress relaxation),
 * then rises at the same rate and leaves the specimen to recover freely. */
export class RubberModel extends LabModel {
  readonly spec:RubberSpec;readonly solid:SolidBody;readonly contact:SolidContact;readonly radius:number;readonly initialHeight:number;
  readonly initialVolume:number;readonly surface:Uint32Array;readonly top:Uint32Array;
  platen:number;platenForce=0;peakForce=0;residual=0;private platenBody:number;private clock=0;unconverged=0;
  constructor(p:Partial<LabSettings>={}){
    super('rubber',p);const s=this.settings;this.spec=rubberSpec(this.material.id);this.radius=.58*s.size;this.initialHeight=.86*s.size;
    this.solid=new SolidBody({mesh:cylinderMesh(this.radius,this.initialHeight,5,5),material:{youngModulus:this.spec.youngModulus,poissonRatio:this.spec.poissonRatio,density:this.spec.density},
      config:{model:'neo-hookean',dt:RUBBER_DT,gravity:[0,-G,0],massDamping:2,tolerance:1e-7,maxLinearIterations:4000,viscoelastic:{branches:this.spec.branches}}});
    const friction=contactPair('natural-rubber','concrete-c30-37').friction??.8;
    this.contact=new SolidContact(this.solid,{gravity:[0,-G,0]});
    this.contact.addBody({shape:{kind:'plane',normal:[0,1,0]},type:'static',position:[0,RUBBER_BASE,0],rotation:[0,0,0,1],friction});
    this.platen=RUBBER_BASE+this.initialHeight;
    this.platenBody=this.contact.addBody({shape:{kind:'box',halfExtents:[1.2*this.radius,.1,1.2*this.radius]},type:'kinematic',position:[0,this.platen+.1,0],rotation:[0,0,0,1],friction});
    this.initialVolume=this.solid.volume();this.surface=this.solid.faces;
    this.top=this.solid.selectNodes((x,y)=>y>RUBBER_BASE+this.initialHeight-1e-9);
    // Bonded platens (as in a bonded compression test piece): both end faces are welded to them throughout.
    this.contact.weld(this.solid.selectNodes((x,y)=>y<RUBBER_BASE+1e-9),0);this.contact.weld(this.top,this.platenBody);
    this.allocate(this.solid.nodeCount);this.sync();
  }
  /** Commanded compression (fraction of the height) at time t. */
  /** Commanded compression (fraction of the height) during the ramp and the hold. */
  command(t:number):number {
    const s=this.settings,peak=s.load/100,rate=s.rate/100,ramp=peak/rate;
    return t<ramp?t*rate:peak;
  }
  unloading(t:number):boolean {const s=this.settings,peak=s.load/100;return this.released||t>peak/(s.rate/100)+s.damping;}
  step(dt=DT):void {
    if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new Error('Rubber step must be in (0, 0.25] seconds');
    this.clock+=dt;
    const H=this.initialHeight,rise=this.settings.rate/100*H;
    // The solid steps at RUBBER_DT; the lab's 1/120 s ticks accumulate until a whole step is due.
    while(this.clock>=RUBBER_DT-1e-12){
      const t=this.frame.time+RUBBER_DT;let target:number;
      if(!this.unloading(t))target=RUBBER_BASE+H*(1-this.command(t));
      else{
        // Unloading: the bonded platen follows the specimen with no load. It moves by the force it feels over a damper of
        // time constant SERVO_TIME on the specimen's instantaneous stiffness, never faster than the loading rate, so the
        // specimen recovers freely (its own creep recovery) and is never pulled or pushed by more than that damper.
        const stiffness=this.spec.youngModulus*(1+this.spec.branches.reduce((a,b)=>a+b.ratio,0))*Math.PI*this.radius**2/H;
        target=this.platen+RUBBER_DT*Math.max(-rise,Math.min(rise,this.platenForce/(stiffness*SERVO_TIME)));
      }
      const v=(target-this.platen)/RUBBER_DT;
      this.contact.setBodyState(this.platenBody,{position:[0,this.platen+.1,0],rotation:[0,0,0,1],linearVelocity:[0,v,0],angularVelocity:[0,0,0]});
      this.contact.step();this.platen=target;this.frame.time=t;this.clock-=RUBBER_DT;
      this.platenForce=this.contact.bodyForce(this.platenBody)[1];this.peakForce=Math.max(this.peakForce,this.platenForce);if(!this.contact.stats.converged)this.unconverged++;
    }
    this.sync();
  }
  private sync():void {
    const f=this.frame,x=this.solid.positions(),H=this.initialHeight;f.positions.set(x);
    let height=0;for(const n of this.top)height+=x[3*n+1];height=height/this.top.length-RUBBER_BASE;
    const compression=1-height/H,volume=this.solid.volume()/this.initialVolume,t=f.time,s=this.settings;
    const peak=s.load/100,ramp=peak/(s.rate/100),hold=s.damping,unloading=this.released||t>ramp+hold;
    const free=unloading&&Math.abs(this.platenForce)<=.02*this.peakForce;
    if(free)this.residual=compression;
    f.actuator=this.platen;
    f.phase=t===0?'Ready':!unloading?(t<ramp?'Compressing':'Holding · relaxing'):!free?'Unloading':Math.abs(compression)<.002?'Recovered':'Recovering';
    f.metrics=[compression*100,this.platenForce/1000,volume*100];
    f.status=`${this.spec.name} · E ${(this.spec.youngModulus/1e6).toFixed(2)} MPa long-term, ${(this.spec.youngModulus*(1+this.spec.branches.reduce((a,b)=>a+b.ratio,0))/1e6).toFixed(2)} MPa instantaneous · peak ${(this.peakForce/1000).toFixed(1)} kN`+(free?` · ${(this.residual*100).toFixed(1)} % still to recover`:'');
  }
}
