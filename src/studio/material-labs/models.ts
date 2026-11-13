import {liquidSettings,surfaceFor,pipeDelivery,rainFactor,supplyFactor,type LiquidSettings} from './liquid-config';
import {FlumeSI,liquidSI,surfaceSI,type LiquidSI,type SurfaceSI} from './liquid-si';
import {ShallowWater} from '../../engine/shallow-water';
import {GranularTray,grainSI,TRAY} from './granular-si';
import {bedDatum,bedElevation,bedRelief,channelCenter,liquidOutlets,rimHeight} from './liquid-terrain';
import {LABS,materialFor,normalizeSettings,type LabId,type LabSettings,type MaterialProfile} from './catalog';
import {LabModel,DT,random,clamp,copyFrame,type LabFrame,type V3,type Piece} from './lab-model';
import {GlassModel} from './glass-si';
import {RubberModel} from './rubber-si';
import {ConcreteModel} from './concrete-si';
export * from './lab-model';
export {GlassModel} from './glass-si';
export {RubberModel} from './rubber-si';
export {ConcreteModel} from './concrete-si';

/** The rigs that run the validated shallow-water solver (src/engine/shallow-water.ts) in SI units. */
export const SHALLOW_RIGS:readonly string[]=['river','rain','surface'];
/** Weir coefficient of the outlet, m^0.5/s: critical flow over a broad crest, q = sqrt(g) (2H/3)^(3/2) = 1.705 H^(3/2). */
const WEIR=Math.sqrt(9.81)*Math.pow(2/3,1.5);

/**
 * The liquid lab. Flume: the validated free-surface solver in SI (FlumeSI: 3D incompressible liquid with viscosity, a
 * lifting gate and two posts), read back as a depth field on this grid. River, rain and surface: the validated
 * shallow-water solver in SI (ShallowWater: hydrostatic reconstruction, Manning and laminar film friction, rain and
 * Green-Ampt infiltration from the material library) on this grid and bed; the pipe outlets are volume sources, the
 * outlet a broad-crested weir and the rim an overflow. Pipes: a conservative finite-volume depth field whose bed drag,
 * absorption and damping are authored, while the pipe delivery uses the Darcy-Weisbach law with SI viscosity.
 */
export class LiquidModel extends LabModel {
  readonly nx=84;readonly nz=28;readonly width=6;readonly depth=2;
  readonly h:Float64Array=new Float64Array(this.nx*this.nz);readonly qx:Float64Array=new Float64Array(this.h.length);readonly qz:Float64Array=new Float64Array(this.h.length);
  readonly solid=new Uint8Array(this.h.length);readonly delta=new Float64Array(this.h.length*3);readonly elevation=new Float64Array(this.h.length);
  readonly dx=this.width/this.nx;readonly dz=this.depth/this.nz;readonly gateColumn=27;
  readonly initialVolume:number;
  readonly liquid:LiquidSettings;readonly substrate:ReturnType<typeof surfaceFor>;readonly delivery:ReturnType<typeof pipeDelivery>;
  /** SI density and viscosity of the liquid (viscosity already multiplied by the viscosity control). */
  readonly si:LiquidSI;readonly flume?:FlumeSI;
  /** River, rain and surface: the shallow-water solver (its h, qx, qz are this model's fields) and the bed's SI values. */
  readonly water?:ShallowWater;readonly surfaceSI:SurfaceSI;
  readonly outlets:[number,number][];private inletCells:number[][]=[];private activeCells=0;private added=0;private rained=0;private drained=0;private absorbed=0;private outlet=0;private overflow=0;private overflowRate=0;
  datum(x:number):number {return bedDatum(this.liquid,x);}
  bed(x:number,z=0):number {return bedElevation(this.liquid,x,z);}
  relief(x:number,z:number):number {return bedRelief(this.liquid,x,z);}
  channelCenter(x:number):number {return channelCenter(this.liquid,x);}
  constructor(p:Partial<LabSettings>={}){
    super('liquid',p);this.liquid=liquidSettings(this.settings);this.substrate=surfaceFor(this.liquid.surface);
    const base=liquidSI(this.material.id);this.si={...base,viscosity:base.viscosity*this.settings.damping};
    this.delivery=pipeDelivery(this.liquid,this.si.viscosity,this.si.density);
    if(this.liquid.rig==='flume')this.flume=new FlumeSI({depth:this.settings.size,lift:this.settings.load/100*1.1,liftSpeed:this.settings.rate,downstream:.008+this.settings.fill/100*.6,slope:this.liquid.slope,density:this.si.density,viscosity:this.si.viscosity,pulse:this.settings.mode==='pulse'});
    this.outlets=liquidOutlets(this.liquid);this.inletCells=this.outlets.map(()=>[]);
    this.frame.positions=new Float32Array(this.h.length);this.frame.rotations=new Float32Array(this.h.length*2);
    const rig=this.liquid.rig;
    for(let z=0;z<this.nz;z++)for(let x=0;x<this.nx;x++){
      const i=z*this.nx+x,px=(x+.5)*this.dx-3,pz=(z+.5)*this.dz-1;
      this.elevation[i]=this.bed(px,pz);
      this.solid[i]=Number(rig==='river'?Math.hypot(px-.25,pz-.05)<.17||Math.hypot(px-1.65,pz+.28)<.19:rig==='flume'||rig==='pipes'?Math.hypot(px-1.25,pz-.48)<.2||Math.hypot(px-2,pz+.42)<.2:false);
      if(this.solid[i])continue;this.activeCells++;
      this.h[i]=rig==='flume'?(x<this.gateColumn?this.settings.size:.008+this.settings.fill/100*.6):rig==='river'?Math.max(0,.025+this.settings.fill*.004-this.relief(px,pz)):this.settings.fill/1000;
      if(rig==='flume'&&this.settings.mode==='pulse')this.h[i]=this.settings.size*.65+.08*Math.cos(px*Math.PI/3);
      this.outlets.forEach(([ox,oz],j)=>{if(Math.hypot(px-ox,pz-oz)<.13)this.inletCells[j].push(i);});
    }
    if(this.flume)this.fromFlume();
    this.surfaceSI=surfaceSI(this.liquid.surface);
    if(SHALLOW_RIGS.includes(rig)){
      const soil=this.surfaceSI.soil;
      this.water=new ShallowWater({cells:[this.nx,this.nz],spacing:[this.dx,this.dz],origin:[-3,-1],bed:this.elevation,depth:this.h,solid:this.solid,manning:this.surfaceSI.manning,
        viscosity:this.si.viscosity/this.si.density,...(soil?{soil:Array.from(this.solid,v=>v?null:soil)}:{}),density:this.si.density,dt:DT});
      // The solver's fields are this model's: what the scene, the probes and the tests read and write.
      this.h=this.water.h;this.qx=this.water.qx;this.qz=this.water.qz;
    }
    this.initialVolume=this.volume();if(this.settings.mode==='pulse')this.frame.actuator=1.1;this.sync();
  }
  /** Liquid volume, m^3: the solver particles' volume in the flume (exact), the depth field's elsewhere. */
  volume():number {if(this.flume)return this.flume.volume();let total=0;for(const h of this.h)total+=h;return total*this.dx*this.dz;}
  private readonly sampled=new Float64Array(3);
  /** Depth and depth-averaged velocity of the flume solver at each cell of this grid (zero inside the posts). */
  private fromFlume():void {
    const f=this.flume!;
    for(let z=0;z<this.nz;z++)for(let x=0;x<this.nx;x++){
      const i=z*this.nx+x;if(this.solid[i]){this.h[i]=this.qx[i]=this.qz[i]=0;continue;}
      const s=this.sampled;f.sampleInto((x+.5)*this.dx-3,(z+.5)*this.dz-1,s);const d=s[0];this.h[i]=d;this.qx[i]=d*s[1];this.qz[i]=d*s[2];
    }
  }
  private supplyOn(time=this.frame.time):boolean {return !this.released&&(this.liquid.cutoff===0||time<this.liquid.cutoff-1e-10);}
  private face(a:number,b:number,axis:0|1,dt:number,gate:number):void {
    const n=this.h.length,da=axis===0?this.dx:this.dz,g=9.81;
    const va=a>=0&&!this.solid[a],vb=b>=0&&!this.solid[b];if(!va&&!vb)return;
    const ia=va?a:b,ib=vb?b:a,originalA=this.h[ia],originalB=this.h[ib],crest=Math.max(this.elevation[ia],this.elevation[ib]);
    // Audusse et al. (2004), first-order hydrostatic reconstruction. The shared
    // face conserves mass; side-specific pressure corrections balance the bed.
    const ha=Math.max(0,originalA+this.elevation[ia]-crest),hb=Math.max(0,originalB+this.elevation[ib]-crest);
    const ua=originalA>1e-7?(axis===0?this.qx[ia]:this.qz[ia])/originalA*(va?1:-1):0;
    const ub=originalB>1e-7?(axis===0?this.qx[ib]:this.qz[ib])/originalB*(vb?1:-1):0;
    const na=ha*ua,nb=hb*ub;
    const ta=originalA>1e-7?(axis===0?this.qz[ia]:this.qx[ia])*ha/originalA:0;
    const tb=originalB>1e-7?(axis===0?this.qz[ib]:this.qx[ib])*hb/originalB:0;
    const c=Math.max(Math.abs(ua)+Math.sqrt(g*ha),Math.abs(ub)+Math.sqrt(g*hb));
    const fh=(na+nb-c*(hb-ha))*.5,fn=(na*ua+nb*ub+g*(ha*ha+hb*hb)*.5-c*(nb-na))*.5;
    const ft=(ta*ua+tb*ub-c*(tb-ta))*.5,k=dt/da;
    if(va){this.delta[a]-=k*fh*gate;this.delta[a+n*(axis+1)]-=k*(fn*gate+g*(originalA*originalA-gate*ha*ha)*.5);this.delta[a+n*(2-axis)]-=k*ft*gate;}
    if(vb){this.delta[b]+=k*fh*gate;this.delta[b+n*(axis+1)]+=k*(fn*gate+g*(originalB*originalB-gate*hb*hb)*.5);this.delta[b+n*(2-axis)]+=k*ft*gate;}
  }
  step(dt=DT):void {
    if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new Error('Liquid step must be in (0, 0.25] seconds');
    if(this.flume){
      this.flume.step(dt,this.released);this.frame.time+=dt;this.fromFlume();
      this.frame.actuator=Math.min(1.1,this.flume.lift(this.frame.time,this.released));this.outlet=0;this.overflowRate=0;this.sync();return;
    }
    if(this.water){this.stepShallow(dt);return;}
    let left=dt;this.outlet=0;const previousOverflow=this.overflow;
    while(left>1e-9){
      let speed=.1;for(let i=0;i<this.h.length;i++)if(this.h[i]>1e-7)speed=Math.max(speed,Math.hypot(this.qx[i],this.qz[i])/this.h[i]+Math.sqrt(9.81*this.h[i]));
      const untilCutoff=this.liquid.rig!=='flume'&&this.liquid.cutoff-this.frame.time>1e-10?this.liquid.cutoff-this.frame.time:Infinity;
      const sub=Math.min(left,.22*Math.min(this.dx,this.dz)/speed,untilCutoff),gate=this.released||this.settings.mode==='pulse'?1:clamp(this.frame.time*this.settings.rate/1.1,0,this.settings.load/100);
      this.delta.fill(0);
      for(let z=0;z<this.nz;z++)for(let x=0;x<=this.nx;x++)this.face(x?z*this.nx+x-1:-1,x<this.nx?z*this.nx+x:-1,0,sub,this.liquid.rig==='flume'&&x===this.gateColumn&&this.settings.mode!=='pulse'?gate:1);
      for(let z=0;z<=this.nz;z++)for(let x=0;x<this.nx;x++)this.face(z?(z-1)*this.nx+x:-1,z<this.nz?z*this.nx+x:-1,1,sub,1);
      const damp=Math.exp(-sub*(.06+this.material.viscosity*this.settings.damping*3));
      for(let i=0;i<this.h.length;i++)if(!this.solid[i]){
        this.h[i]=Math.max(0,this.h[i]+this.delta[i]);
        const drag=Math.exp(-sub*this.substrate.drag/Math.max(.025,this.h[i]));
        this.qx[i]=(this.qx[i]+this.delta[i+this.h.length])*damp*drag;
        this.qz[i]=(this.qz[i]+this.delta[i+this.h.length*2])*damp*drag;
        if(this.h[i]<1e-7)this.qx[i]=this.qz[i]=0;
      }
      this.sources(sub);this.frame.time+=sub;left-=sub;this.frame.actuator=gate*1.1;
    }
    this.outlet/=dt;this.overflowRate=(this.overflow-previousOverflow)/dt;this.sync();
  }
  private sources(dt:number):void {
    if(this.liquid.rig==='flume')return;
    const cellArea=this.dx*this.dz,time=this.frame.time+dt/2,supply=this.supplyOn(time);
    const factor=supplyFactor(time,this.liquid.supply),q=supply&&this.liquid.rig!=='rain'?this.delivery.flow*factor:0;
    if(q)for(const cells of this.inletCells){if(!cells.length)continue;const amount=q*dt/this.inletCells.length,dh=amount/(cells.length*cellArea);for(const i of cells){this.h[i]+=dh;this.qx[i]+=dh*Math.min(3,this.delivery.speed*factor*.2);}this.added+=amount;}
    const rain=supply?this.liquid.rain/1000/3600*rainFactor(time,this.liquid.storm):0;
    for(let i=0;i<this.h.length;i++)if(!this.solid[i]){
      const dh=rain*dt;this.h[i]+=dh;this.qx[i]+=dh*this.liquid.rainWind*.12;this.rained+=dh*cellArea;
      const soaked=Math.min(this.h[i],this.substrate.absorb/1000/60*dt/(1+this.material.viscosity*this.settings.damping));
      if(soaked){const fraction=1-soaked/this.h[i];this.h[i]-=soaked;this.qx[i]*=fraction;this.qz[i]*=fraction;this.absorbed+=soaked*cellArea;}
      if(i%this.nx===this.nx-1&&this.liquid.drain>0){const out=Math.min(this.h[i],1.7*Math.pow(this.h[i],1.5)*dt/this.dx*this.liquid.drain/100);this.remove(i,out);}
      // Only boundary cells can overtop the physical rim. Interior water is never
      // silently clipped. Overflow is separate from the metered outlet in replay.
      const x=i%this.nx,z=Math.floor(i/this.nx);
      if(x===0||x===this.nx-1||z===0||z===this.nz-1){const px=(x+.5)*this.dx-3,excess=this.h[i]+this.elevation[i]-this.datum(px)-rimHeight(this.liquid);if(excess>0){this.remove(i,excess,false);this.overflow+=excess*cellArea;}}
    }
  }
  /**
   * River, rain and surface: the shallow-water solver. Within each piece of the step (split at the supply cutoff) the
   * pipe outlets add their delivery as volume sources (a vertical jet brings no horizontal momentum), the rain falls
   * at the program's rate with the drift's horizontal velocity, the solver advances in its own CFL substeps, then the
   * outlet weir and the rim take what leaves.
   */
  private stepShallow(dt:number):void {
    const w=this.water!,area=this.dx*this.dz;let left=dt;this.outlet=0;const previousOverflow=this.overflow;
    while(left>1e-12){
      const untilCutoff=this.liquid.cutoff-this.frame.time>1e-10?this.liquid.cutoff-this.frame.time:Infinity,sub=Math.min(left,untilCutoff);
      const mid=this.frame.time+sub/2,supply=this.supplyOn(mid);
      const q=supply&&this.liquid.rig!=='rain'?this.delivery.flow*supplyFactor(mid,this.liquid.supply):0;
      if(q>0)for(const cells of this.inletCells){if(!cells.length)continue;const each=q*sub/this.inletCells.length/cells.length;for(const i of cells)w.addVolume(i,each);this.added+=q*sub/this.inletCells.length;}
      const rain=supply?this.liquid.rain/1000/3600*rainFactor(mid,this.liquid.storm):0;
      w.setRain(rain);w.rainVelocity[0]=this.liquid.rainWind;
      const before=w.ledger.rain;
      w.advance(sub);
      this.rained+=w.ledger.rain-before;this.absorbed=w.ledger.infiltrated;
      for(let z=0;z<this.nz;z++){
        const i=z*this.nx+this.nx-1;
        if(this.liquid.drain>0&&!this.solid[i]){const d=w.h[i];if(d>0){const out=w.removeVolume(i,Math.min(d*area,WEIR*Math.pow(d,1.5)*this.dz*sub*this.liquid.drain/100));this.drained+=out;this.outlet+=out;}}
      }
      // Only boundary cells can overtop the physical rim; interior water is never clipped. Overflow is not metered.
      for(let i=0;i<this.h.length;i++){
        const x=i%this.nx,z=Math.floor(i/this.nx);if(this.solid[i]||!(x===0||x===this.nx-1||z===0||z===this.nz-1))continue;
        const excess=w.h[i]+this.elevation[i]-this.datum((x+.5)*this.dx-3)-rimHeight(this.liquid);
        if(excess>0){const out=w.removeVolume(i,excess*area);this.drained+=out;this.overflow+=out;}
      }
      this.frame.time+=sub;left-=sub;this.frame.actuator=0;
    }
    this.outlet/=dt;this.overflowRate=(this.overflow-previousOverflow)/dt;this.sync();
  }
  private remove(i:number,depth:number,metered=true):void {
    const fraction=this.h[i]>0?Math.max(0,1-depth/this.h[i]):0;this.h[i]-=depth;this.qx[i]*=fraction;this.qz[i]*=fraction;
    const v=depth*this.dx*this.dz;this.drained+=v;if(metered)this.outlet+=v;
  }
  private sync():void {
    let peak=0,velocity=0;
    for(let i=0;i<this.h.length;i++){const h=this.h[i];this.frame.positions[i]=h;this.frame.rotations[i*2]=h>1e-6?this.qx[i]/h:0;this.frame.rotations[i*2+1]=h>1e-6?this.qz[i]/h:0;peak=Math.max(peak,h);velocity=Math.max(velocity,Math.hypot(this.frame.rotations[i*2],this.frame.rotations[i*2+1]));}
    const rig=this.liquid.rig,supply=rig==='flume'?!this.released:this.supplyOn(),volume=this.volume(),factor=supplyFactor(this.frame.time,this.liquid.supply);let wetArea=0,floodArea=0,speedSum=0;
    for(let i=0;i<this.h.length;i++){const x=(i%this.nx+.5)*this.dx-3,z=(Math.floor(i/this.nx)+.5)*this.dz-1;if(this.h[i]>.00005)wetArea+=this.dx*this.dz;if(rig==='river'&&this.relief(x,z)>=this.liquid.bankHeight*.9&&this.h[i]>.002)floodArea+=this.dx*this.dz;speedSum+=Math.hypot(this.qx[i],this.qz[i]);}
    this.frame.phase=this.frame.time===0?'Ready':rig==='flume'?(velocity<.025&&this.frame.time>5?'Settling':this.frame.actuator<.3?'Gate lifting':'Flowing'):!supply?'Supply stopped · draining':rig==='rain'?(rainFactor(this.frame.time,this.liquid.storm)>.01?'Rainfall':'Between showers'):rig==='river'?'River flowing':rig==='surface'?'Film spreading':'Pump delivering';
    this.frame.metrics=this.flume?[this.flume.peakDepth(),this.flume.peakSpeed(),volume]:[peak,velocity,volume];
    if(rig==='river'&&floodArea>.01&&supply&&this.frame.time>0)this.frame.phase='Banks overtopped';
    const w=this.water;let froude=0;
    if(w)for(let i=0;i<this.h.length;i++)if(this.h[i]>.001)froude=Math.max(froude,w.froude(i));
    this.frame.hydraulics={solver:w||rig==='flume'?'si':'authored',...(w?{discharge:w.dischargeX(0),froude}:{}),inlet:rig==='flume'||rig==='rain'||!supply?0:this.delivery.flow*factor,rainRate:rig==='flume'||!supply?0:this.liquid.rain*rainFactor(this.frame.time,this.liquid.storm),outlet:this.outlet,added:this.added,rained:this.rained,drained:this.drained,absorbed:this.absorbed,residual:volume-(this.initialVolume+this.added+this.rained-this.drained-this.absorbed),wetArea,meanFilm:wetArea?volume/wetArea*1000:0,head:rig==='flume'||rig==='rain'?0:this.delivery.head,reynolds:rig==='flume'||rig==='rain'?0:this.delivery.reynolds,supplyOn:supply,floodArea,coverage:Math.min(100,wetArea/(this.activeCells*this.dx*this.dz)*100),meanSpeed:volume?speedSum*this.dx*this.dz/volume:0,overflow:this.overflow,overflowRate:this.overflowRate};
  }
}

/**
 * The granular lab: the discrete element solver in SI (GranularTray, granular-si.ts). Positions are drawn ten times
 * larger than the apparatus (model units = SI x 10, floor at 0.58); the readouts are SI.
 */
export class GranularModel extends LabModel {
  readonly radius:number;readonly count:number;readonly initialMass:number;readonly tray:GranularTray;
  constructor(p:Partial<LabSettings>={}){
    super('granular',p);
    this.tray=new GranularTray(grainSI(this.material.id),{diameter:this.settings.size/1000,fill:this.settings.fill,opening:this.settings.load/100*.15,liftSpeed:this.settings.rate*.1,frictionScale:this.settings.damping,seed:this.settings.seed});
    this.radius=this.tray.radius*TRAY.scale;this.count=this.tray.count;this.allocate(this.count);
    this.initialMass=this.tray.solver.mass();this.sync();
  }
  release():void {super.release();this.tray.release();}
  step(dt=DT):void {
    if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new Error('Granular step must be in (0, 0.25] seconds');
    this.tray.step(dt);this.frame.time+=dt;this.sync();
  }
  private sync():void {
    const f=this.frame,g=this.tray.solver,s=TRAY.scale;
    for(let i=0;i<this.count;i++){f.positions[3*i]=g.positions[3*i]*s;f.positions[3*i+1]=TRAY.floorModelY+g.positions[3*i+1]*s;f.positions[3*i+2]=g.positions[3*i+2]*s;}
    const m=this.tray.measure(),lift=this.tray.lift(f.time);
    f.actuator=Math.min(1.5,lift*s);
    f.phase=f.time===0?'Ready':lift<.02&&!this.tray.released?'Gate lifting':m.agitation<1e-3&&f.time>1?'Settled':'Avalanching';
    f.metrics=[m.runout,m.height,m.behind];
  }
}
export function createModel(id:LabId,p:Partial<LabSettings>={}):LabModel {
  return id==='liquid'?new LiquidModel(p):id==='glass'?new GlassModel(p):id==='concrete'?new ConcreteModel(p):id==='rubber'?new RubberModel(p):new GranularModel(p);
}
export const METRIC_LABELS:Record<LabId,[string,string,string]>={liquid:['Peak depth · m','Peak speed · m/s','Fluid volume · m³'],glass:['Peak contact force · kN','Peak surface stress · MPa','Out-of-plane · mm'],concrete:['Stress · MPa','Strain · %','Platen force · kN'],rubber:['Compression · %','Platen force · kN','Retained volume · %'],granular:['Runout · m','Pile height · m','Grains behind gate']};
