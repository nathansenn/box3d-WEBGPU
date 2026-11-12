import {liquidSettings,surfaceFor,pipeDelivery,rainFactor,supplyFactor,type LiquidSettings} from './liquid-config';
import {FlumeSI,liquidSI,type LiquidSI} from './liquid-si';
import {GranularTray,grainSI,TRAY} from './granular-si';
import {bedDatum,bedElevation,bedRelief,channelCenter,liquidOutlets,rimHeight} from './liquid-terrain';
import {LABS,materialFor,normalizeSettings,type LabId,type LabSettings,type MaterialProfile} from './catalog';
import {ConvexBody,ConvexContactWorld,contactBox,triangularPrism,contactEuler,convexSeparation,CONTACT_SKIN,type ContactStats} from '../../engine/convex-contact';
import {GLASS_RIG,glassFixtures} from './glass-rig';
import {GlassPendulum,glassPendulumContacts} from './glass-pendulum';
export type V3=[number,number,number];
export interface Piece {center:V3;vertices:V3[];radius:number;}
export interface HydraulicFrame {inlet:number;rainRate:number;outlet:number;added:number;rained:number;drained:number;absorbed:number;residual:number;wetArea:number;meanFilm:number;head:number;reynolds:number;supplyOn:boolean;floodArea:number;coverage:number;meanSpeed:number;overflow:number;overflowRate:number;}
export interface LabFrame {hydraulics?:HydraulicFrame;time:number;positions:Float32Array;rotations:Float32Array;damage:Uint8Array;actuator:number;phase:string;metrics:[number,number,number];collisions?:{impacts:number;contacts:number;sweptContacts:number;unresolvedSweeps:number};}
export const DT=1/120;
export function random(seed:number):()=>number {let v=seed>>>0;return()=>{v=(Math.imul(v,1664525)+1013904223)>>>0;return v/4294967296;};}
export const clamp=(x:number,a:number,b:number)=>Math.max(a,Math.min(b,x));
export const copyFrame=(f:LabFrame):LabFrame=>({...f,positions:f.positions.slice(),rotations:f.rotations.slice(),damage:f.damage.slice(),metrics:[...f.metrics],...(f.hydraulics?{hydraulics:{...f.hydraulics}}:{}),...(f.collisions?{collisions:{...f.collisions}}:{})});
export abstract class LabModel {
  readonly id:LabId;
  readonly settings:LabSettings;readonly material:MaterialProfile;readonly pieces:Piece[]=[];
  frame:LabFrame={time:0,positions:new Float32Array(),rotations:new Float32Array(),damage:new Uint8Array(),actuator:0,phase:'Ready',metrics:[0,0,0]};
  released=false;
  constructor(id:LabId,p:Partial<LabSettings>){this.id=id;this.settings=normalizeSettings(id,p);this.material=materialFor(id,this.settings.material);}
  abstract step(dt?:number):void;
  release():void {this.released=true;}
  snapshot():LabFrame {return copyFrame(this.frame);}
  protected allocate(n:number):void {this.frame.positions=new Float32Array(n*3);this.frame.rotations=new Float32Array(n*3);this.frame.damage=new Uint8Array(n);}
}

/**
 * The liquid lab. Flume: the validated free-surface solver in SI (FlumeSI: 3D incompressible liquid with viscosity, a
 * lifting gate and two posts), read back as a depth field on this grid. Pipes, river, rain and surface: a conservative
 * finite-volume depth field with closed-wall fluxes and explicit sources and sinks; its bed drag, absorption and the
 * authored damping are comparative, while the pipe delivery uses the Darcy-Weisbach law with SI viscosity.
 */
export class LiquidModel extends LabModel {
  readonly nx=84;readonly nz=28;readonly width=6;readonly depth=2;
  readonly h=new Float64Array(this.nx*this.nz);readonly qx=new Float64Array(this.h.length);readonly qz=new Float64Array(this.h.length);
  readonly solid=new Uint8Array(this.h.length);readonly delta=new Float64Array(this.h.length*3);readonly elevation=new Float64Array(this.h.length);
  readonly dx=this.width/this.nx;readonly dz=this.depth/this.nz;readonly gateColumn=27;
  readonly initialVolume:number;
  readonly liquid:LiquidSettings;readonly substrate:ReturnType<typeof surfaceFor>;readonly delivery:ReturnType<typeof pipeDelivery>;
  /** SI density and viscosity of the liquid (viscosity already multiplied by the viscosity control). */
  readonly si:LiquidSI;readonly flume?:FlumeSI;
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
    this.initialVolume=this.volume();if(this.settings.mode==='pulse')this.frame.actuator=1.1;this.sync();
  }
  /** Liquid volume, m^3: the solver particles' volume in the flume (exact), the depth field's elsewhere. */
  volume():number {if(this.flume)return this.flume.volume();let total=0;for(const h of this.h)total+=h;return total*this.dx*this.dz;}
  /** Depth and depth-averaged velocity of the flume solver at each cell of this grid (zero inside the posts). */
  private fromFlume():void {
    const f=this.flume!;
    for(let z=0;z<this.nz;z++)for(let x=0;x<this.nx;x++){
      const i=z*this.nx+x;if(this.solid[i]){this.h[i]=this.qx[i]=this.qz[i]=0;continue;}
      const [d,u,w]=f.sample((x+.5)*this.dx-3,(z+.5)*this.dz-1);this.h[i]=d;this.qx[i]=d*u;this.qz[i]=d*w;
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
    this.frame.hydraulics={inlet:rig==='flume'||rig==='rain'||!supply?0:this.delivery.flow*factor,rainRate:rig==='flume'||!supply?0:this.liquid.rain*rainFactor(this.frame.time,this.liquid.storm),outlet:this.outlet,added:this.added,rained:this.rained,drained:this.drained,absorbed:this.absorbed,residual:volume-(this.initialVolume+this.added+this.rained-this.drained-this.absorbed),wetArea,meanFilm:wetArea?volume/wetArea*1000:0,head:rig==='flume'||rig==='rain'?0:this.delivery.head,reynolds:rig==='flume'||rig==='rain'?0:this.delivery.reynolds,supplyOn:supply,floodArea,coverage:Math.min(100,wetArea/(this.activeCells*this.dx*this.dz)*100),meanSpeed:volume?speedSum*this.dx*this.dz/volume:0,overflow:this.overflow,overflowRate:this.overflowRate};
  }
}

export class GlassModel extends LabModel {
  substepForces=true;
  private spin:Float64Array;
  private readonly rollbackFrame:LabFrame;
  readonly collisionWorld=new ConvexContactWorld();readonly shardBodies:ConvexBody[]=[];
  readonly clampedPieces:Uint8Array;
  readonly pendulum:GlassPendulum;
  private impactAt=-1;private severity=0;private hitCount=0;private lastImpact=-Infinity;
  readonly impactX:number;readonly panelWidth=GLASS_RIG.panelWidth;readonly panelHeight=GLASS_RIG.panelHeight;readonly panelCenterY=GLASS_RIG.panelCenterY;
  private sweepCount=0;private unresolvedSweeps=0;
  constructor(p:Partial<LabSettings>={}){
    super('glass',p);this.impactX=this.settings.fill/100;const rng=random(this.settings.seed),fine=this.material.id==='tempered';
    const count=fine?42:24,rings=fine?12:7,angles=Array.from({length:count},(_,i)=>i/count*Math.PI*2+.025*(rng()-.5));
    for(const x of [-1.3,1.3])for(const y of [-1,1])angles.push((Math.atan2(y,x-this.impactX)+Math.PI*2)%(Math.PI*2));angles.sort((a,b)=>a-b);
    const points:V3[][]=[angles.map(()=>[this.impactX,0,0])];
    for(let r=1;r<=rings;r++)points.push(angles.map(a=>{const dx=Math.cos(a),dy=Math.sin(a),edge=Math.min((dx>0?1.3-this.impactX:1.3+this.impactX)/(Math.abs(dx)||1e-8),1/(Math.abs(dy)||1e-8)),f=r/rings;return [this.impactX+dx*edge*f,dy*edge*f,0];}));
    const add=(v:V3[])=>{const center:V3=[v.reduce((s,p)=>s+p[0],0)/3,v.reduce((s,p)=>s+p[1],0)/3+this.panelCenterY,0];this.pieces.push({center,vertices:v.map(p=>[p[0]-center[0],p[1]+this.panelCenterY-center[1],0]),radius:Math.max(...v.map(p=>Math.hypot(p[0]-center[0],p[1]+this.panelCenterY-center[1])))});};
    for(let r=1;r<=rings;r++)for(let i=0;i<angles.length;i++){const j=(i+1)%angles.length;add([points[r-1][i],points[r][i],points[r][j]]);if(r>1)add([points[r-1][i],points[r][j],points[r-1][j]]);}
    this.allocate(this.pieces.length);this.spin=new Float64Array(this.pieces.length*3);this.clampedPieces=new Uint8Array(this.pieces.length);
    const grips:ConvexBody[]=[];for(const x of [-1.32,1.32])for(const y of [1.6,2.45,3.3])grips.push(new ConvexBody(contactBox([.15,.21,this.settings.size/1000+.0001]),[x,y,0],1,false));
    this.pieces.forEach((p,i)=>{
      this.frame.positions.set(p.center,i*3);this.spin.set([(rng()-.5)*3,(rng()-.5)*3,(rng()-.5)*3],i*3);
      const [a,b,c]=p.vertices,area=Math.abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))/2;
      const mass=2500*this.material.density*area*this.settings.size/1000,body=new ConvexBody(triangularPrism(p.vertices,this.settings.size/1000,mass),p.center,mass,false);
      body.friction=this.material.friction;body.restitution=.27;this.shardBodies.push(this.collisionWorld.add(body));
      this.clampedPieces[i]=Number(grips.some(grip=>convexSeparation(body.pose,grip.pose,0).gap<-CONTACT_SKIN));
    });
    for(const fixture of glassFixtures(this.settings.size/1000))this.collisionWorld.add(new ConvexBody(contactBox(fixture.size),fixture.position,1,false));
    // A finite tray has finite walls. Escaping fragments land on the room floor.
    this.collisionWorld.add(new ConvexBody(contactBox([40,.1,40]),[0,-.05,0],1,false));
    this.pendulum=new GlassPendulum(this.settings.load,this.impactX,this.settings.rate);this.collisionWorld.add(this.pendulum);
    this.collisionWorld.contactProvider=dt=>glassPendulumContacts(this.pendulum,this.collisionWorld.bodies,dt);
    this.frame.actuator=this.pendulum.angle;this.frame.metrics=[this.settings.load*9.81*this.settings.rate,0,0];
    this.frame.collisions={impacts:0,contacts:0,sweptContacts:0,unresolvedSweeps:0};
    this.rollbackFrame=copyFrame(this.frame);
  }
  step(dt=DT):void {
    if(!Number.isFinite(dt)||dt<=0||dt>.25)throw new Error('Glass step must be in (0, 0.25] seconds');
    const frame=this.frame,saved=this.rollbackFrame;
    saved.positions.set(frame.positions);saved.rotations.set(frame.rotations);saved.damage.set(frame.damage);
    saved.time=frame.time;saved.actuator=frame.actuator;saved.phase=frame.phase;saved.metrics=frame.metrics;saved.collisions=frame.collisions;
    const impactAt=this.impactAt,severity=this.severity,hitCount=this.hitCount,lastImpact=this.lastImpact,sweepCount=this.sweepCount,unresolvedSweeps=this.unresolvedSweeps,released=this.released;
    try{this.collisionWorld.transaction(()=>this.advanceStep(dt));}
    catch(error){
      // A later internal interval can fail after an earlier one fractured and
      // advanced. Restore the whole public step, including its presentation.
      frame.positions.set(saved.positions);frame.rotations.set(saved.rotations);frame.damage.set(saved.damage);
      frame.time=saved.time;frame.actuator=saved.actuator;frame.phase=saved.phase;frame.metrics=saved.metrics;frame.collisions=saved.collisions;
      this.impactAt=impactAt;this.severity=severity;this.hitCount=hitCount;this.lastImpact=lastImpact;this.sweepCount=sweepCount;this.unresolvedSweeps=unresolvedSweeps;this.released=released;
      throw error;
    }
  }
  private advanceStep(dt:number):void {
    const steps=Math.ceil(dt/DT),h=dt/steps;let contacts=0;this.sweepCount=0;this.unresolvedSweeps=0;
    for(let step=0;step<steps;step++){
      this.frame.time+=h;
      const age=this.impactAt<0?-1:this.frame.time-this.impactAt;
      for(let i=0;i<this.pieces.length;i++){
        const p=this.pieces[i],b=this.shardBodies[i],k=i*3,d=Math.hypot(p.center[0]-this.impactX,p.center[1]-this.panelCenterY);
        if(!this.frame.damage[i]&&this.severity>1&&age>=0&&d<age*5&&d<(this.severity-1)*1.15+.18){
          this.frame.damage[i]=1;b.dynamic=!this.clampedPieces[i];b.restitution=.08;
          if(b.dynamic){b.velocity=[(p.center[0]-this.impactX)*.38,(p.center[1]-this.panelCenterY)*.25,-(.2+Math.max(0,1-d)*Math.min(2,this.severity*.25))];b.angularVelocity=Array.from(this.spin.subarray(k,k+3)) as V3;}
        }
        if(!b.dynamic||this.substepForces)continue;
        const held=this.material.retention,drag=Math.exp(-h*(held?7:.15));
        for(let a=0;a<3;a++)b.velocity[a]=(b.velocity[a]+((a===1?-9.81:0)+(held?(p.center[a]-b.position[a])*held*105:0))*h)*drag;
        const angles=held?contactEuler(b.rotation):[0,0,0];
        for(let a=0;a<3;a++)b.angularVelocity[a]=(b.angularVelocity[a]-angles[a]*held*40*h)*Math.exp(-h*(held?8:.15));
      }
      let incomingSpeed=0,incomingEnergy=0;
      if(this.substepForces){
        // Force callbacks may change only velocities. The contact world rolls
        // back its full-interval prediction before integrating the small steps.
        this.collisionWorld.externalForces=(forceDt,phase,refinement)=>{
          const held=this.material.retention,drag=Math.exp(-forceDt*(held?7:.15)),angularDrag=Math.exp(-forceDt*(held?8:.15));
          for(let i=0;i<this.pieces.length;i++){
            const p=this.pieces[i],b=this.shardBodies[i];if(!b.dynamic)continue;
            for(let a=0;a<3;a++)b.velocity[a]=(b.velocity[a]+((a===1?-9.81:0)+(held?(p.center[a]-b.position[a])*held*105:0))*forceDt)*drag;
            if(held){
              const angles=contactEuler(b.rotation);
              for(let a=0;a<3;a++)b.angularVelocity[a]=(b.angularVelocity[a]-angles[a]*held*40*forceDt)*angularDrag;
            }else for(let a=0;a<3;a++)b.angularVelocity[a]*=angularDrag;
          }
          this.pendulum.gravity(forceDt);
          if(phase==='prediction'&&refinement===0){incomingSpeed=this.pendulum.speed;incomingEnergy=.5*this.pendulum.inertia*incomingSpeed**2;}
        };
      }else{
        this.collisionWorld.externalForces=undefined;
        this.pendulum.gravity(h);incomingSpeed=this.pendulum.speed;incomingEnergy=.5*this.pendulum.inertia*incomingSpeed**2;
      }
      this.collisionWorld.step(h,this.substepForces?1:4);const s:ContactStats=this.collisionWorld.stats;contacts=s.contacts;this.sweepCount+=s.sweptContacts;this.unresolvedSweeps+=s.ccdUnresolved;
      const impacts=this.collisionWorld.impacts.filter(c=>c.a===this.pendulum||c.b===this.pendulum);
      if(impacts.length&&Math.abs(incomingSpeed)>.025&&(incomingSpeed-this.pendulum.speed)*Math.sign(incomingSpeed)>.02&&this.frame.time-this.lastImpact>.08){
        this.hitCount++;this.lastImpact=this.frame.time;
        if(impacts.some(c=>{const other=c.a===this.pendulum?c.b:c.a;return !other.dynamic&&this.shardBodies.includes(other);})){ 
          this.severity=Math.max(this.severity,incomingEnergy/(190*this.material.strength*Math.pow(this.settings.size/8,2)*this.settings.damping));
          if(this.impactAt<0)this.impactAt=this.frame.time;
        }
      }
    }
    const f=this.frame;let broken=0,maxTravel=0;
    for(let i=0;i<this.pieces.length;i++){
      const b=this.shardBodies[i];f.positions.set(b.position,i*3);f.rotations.set(contactEuler(b.rotation),i*3);broken+=f.damage[i];
      for(const v of b.pose.vertices)maxTravel=Math.max(maxTravel,Math.abs(v[2])-this.settings.size/2000);
    }
    f.actuator=this.pendulum.angle;f.phase=this.impactAt<0?'Pendulum falling':broken?(this.material.retention?'Fractured · retained':'Fractured · releasing'):'Impact absorbed';
    f.metrics=[this.settings.load*9.81*this.settings.rate,broken/this.pieces.length*100,maxTravel*1000];
    f.collisions={impacts:this.hitCount,contacts,sweptContacts:this.sweepCount,unresolvedSweeps:this.unresolvedSweeps};
  }

}

interface Bond {a:number;b:number;rest:number;broken:boolean;strain:number;}
export class ConcreteModel extends LabModel {
  readonly bonds:Bond[]=[];readonly edge:number;private velocity:Float64Array;private old:Float64Array;
  private heights:Float64Array;private lowerExtents:Float64Array;private strain=0;
  constructor(p:Partial<LabSettings>={}){
    super('concrete',p);this.edge=1.3*this.settings.size;const n=5,cell=this.edge/n,rng=random(this.settings.seed);
    const point=(x:number,y:number,z:number):V3=>[-this.edge/2+x*cell,.95+y*cell,-this.edge/2+z*cell];
    const corners:V3[]=[];for(let z=0;z<=n;z++)for(let y=0;y<=n;y++)for(let x=0;x<=n;x++){const v=point(x,y,z);if(x>0&&x<n)v[0]+=(rng()-.5)*cell*.3;if(y>0&&y<n)v[1]+=(rng()-.5)*cell*.3;if(z>0&&z<n)v[2]+=(rng()-.5)*cell*.3;corners.push(v);}
    const at=(x:number,y:number,z:number)=>corners[(z*(n+1)+y)*(n+1)+x];
    for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const verts=[at(x,y,z),at(x+1,y,z),at(x+1,y+1,z),at(x,y+1,z),at(x,y,z+1),at(x+1,y,z+1),at(x+1,y+1,z+1),at(x,y+1,z+1)];
      const center:V3=[0,0,0];for(const v of verts)for(let a=0;a<3;a++)center[a]+=v[a]/8;
      this.pieces.push({center,vertices:verts.map(v=>[v[0]-center[0],v[1]-center[1],v[2]-center[2]]),radius:cell*.5});
    }
    this.allocate(this.pieces.length);this.velocity=new Float64Array(this.pieces.length*3);this.old=new Float64Array(this.velocity.length);this.heights=new Float64Array(this.pieces.length);this.lowerExtents=new Float64Array(this.pieces.length);
    this.pieces.forEach((p,i)=>{this.frame.positions.set(p.center,i*3);this.heights[i]=Math.max(...p.vertices.map(v=>v[1]));this.lowerExtents[i]=-Math.min(...p.vertices.map(v=>v[1]));});
    for(let z=0;z<n;z++)for(let y=0;y<n;y++)for(let x=0;x<n;x++){
      const a=(z*n+y)*n+x;
      for(const [ox,oy,oz] of [[1,0,0],[0,1,0],[0,0,1],[1,1,0],[-1,1,0],[0,1,1],[0,1,-1]])if(x+ox>=0&&x+ox<n&&y+oy<n&&z+oz>=0&&z+oz<n){const b=((z+oz)*n+y+oy)*n+x+ox;this.bonds.push({a,b,rest:Math.hypot(...this.pieces[a].center.map((v,j)=>v-this.pieces[b].center[j]) as V3),broken:false,strain:0});}
    }
    this.frame.actuator=.95+this.edge;
  }
  step(dt=DT):void {
    const f=this.frame;f.time+=dt;const p=f.positions;
    const target=this.released?0:this.settings.load/100;this.strain+=clamp(target-this.strain,-this.settings.rate/100*dt,this.settings.rate/100*dt);
    const top=.95+this.edge*(1-this.strain);this.old.set(p);
    for(let i=0;i<this.pieces.length;i++)for(let a=0;a<3;a++){const k=i*3+a;this.velocity[k]+=(a===1?-9.81:0)*dt;this.velocity[k]*=.997;p[k]+=this.velocity[k]*dt;}
    let maxStrain=0;
    for(let it=0;it<7;it++){
      for(const b of this.bonds){if(b.broken)continue;const a=b.a*3,c=b.b*3,dx=p[c]-p[a],dy=p[c+1]-p[a+1],dz=p[c+2]-p[a+2],l=Math.hypot(dx,dy,dz)||1e-8,s=(l-b.rest)/b.rest;
        b.strain=Math.max(b.strain,Math.abs(s));maxStrain=Math.max(maxStrain,Math.abs(s));
        const threshold=.095*this.material.strength*(.85+(b.a%7)*.04);
        if(Math.abs(s)>threshold&&f.time>.15){b.broken=true;f.damage[b.a]=f.damage[b.b]=1;continue;}
        const q=(l-b.rest)/l*.39;
        p[a]+=dx*q;p[a+1]+=dy*q;p[a+2]+=dz*q;p[c]-=dx*q;p[c+1]-=dy*q;p[c+2]-=dz*q;
      }
      for(let i=0;i<this.pieces.length;i++){
        const k=i*3,hh=this.heights[i],rest=this.pieces[i].center;
        const low=.95+this.lowerExtents[i];p[k+1]=clamp(p[k+1],low,Math.max(low,top-hh));
        const hold=(.003+this.material.retention*.018)*this.settings.damping;p[k]+=(rest[0]-p[k])*hold;p[k+2]+=(rest[2]-p[k+2])*hold;
        for(let j=i+1;j<this.pieces.length;j++){
          const l=j*3,dx=p[l]-p[k],dy=p[l+1]-p[k+1],dz=p[l+2]-p[k+2],d2=dx*dx+dy*dy+dz*dz,r=(this.pieces[i].radius+this.pieces[j].radius)*.83;
          if(d2>1e-14&&d2<r*r){const d=Math.sqrt(d2),q=(r-d)/d*.5;p[k]-=dx*q;p[k+1]-=dy*q;p[k+2]-=dz*q;p[l]+=dx*q;p[l+1]+=dy*q;p[l+2]+=dz*q;}
        }
      }
    }
    let broken=0;for(const b of this.bonds)if(b.broken)broken++;
    for(let i=0;i<this.pieces.length;i++){
      const k=i*3;for(let a=0;a<3;a++)this.velocity[k+a]=clamp((p[k+a]-this.old[k+a])/dt,-4,4)*.965;
      const margin=this.pieces[i].radius;p[k]=clamp(p[k],-1.26+margin,1.26-margin);p[k+1]=Math.max(.95+this.lowerExtents[i],p[k+1]);p[k+2]=clamp(p[k+2],-.86+margin,.86-margin);
      if(f.damage[i]){f.rotations[k]+=(p[k+2]-this.pieces[i].center[2])*.006;f.rotations[k+2]-=(p[k]-this.pieces[i].center[0])*.006;}
    }
    f.actuator=top;f.phase=broken?'Crushing · spalling':this.strain>0?'Compressing':'Unloaded';f.metrics=[this.strain*100,broken/this.bonds.length*100,maxStrain*100];
  }
}

export class RubberModel extends LabModel {
  private strain=0;private velocity=0;private permanent=0;
  readonly initialHeight:number;readonly radius:number;
  constructor(p:Partial<LabSettings>={}){super('rubber',p);this.initialHeight=.86*this.settings.size;this.radius=.58*this.settings.size;this.allocate(1);this.frame.positions[0]=this.initialHeight;this.frame.positions[1]=this.radius;this.frame.actuator=1+this.initialHeight;this.frame.metrics=[0,100,0];}
  step(dt=DT):void {
    const f=this.frame,p=this.settings;f.time+=dt;
    const peak=p.load/100,tRamp=peak/(p.rate/100),releaseAt=tRamp+p.damping;
    const unloading=this.released||f.time>releaseAt;
    const target=unloading?this.permanent:Math.min(peak,f.time*p.rate/100);
    const k=65*this.material.strength,d=3+this.material.damping*17;
    this.velocity+=(k*(target-this.strain)-d*this.velocity)*dt;this.strain=clamp(this.strain+this.velocity*dt,0,.86);
    if(this.material.retention<.7)this.permanent=Math.max(this.permanent,(this.strain-.25)*.35*(1-this.material.retention));
    const height=this.initialHeight*(1-this.strain),volumeRatio=1-this.strain*(1-this.material.retention)*.85;
    const radius=this.radius*Math.sqrt(volumeRatio/(1-this.strain));
    f.positions[0]=height;f.positions[1]=radius;f.positions[2]=this.strain;f.actuator=1+height;
    f.phase=unloading?(Math.abs(this.strain-this.permanent)<.008?'Recovered':'Recovering'):f.time<tRamp?'Compressing':'Holding · creep';
    f.metrics=[this.strain*100,volumeRatio*100,this.permanent*100];
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
export const METRIC_LABELS:Record<LabId,[string,string,string]>={liquid:['Peak depth · m','Peak speed · m/s','Fluid volume · m³'],glass:['Potential energy · J','Fractured pieces · %','Out-of-plane · mm'],concrete:['Compression · %','Broken bonds · %','Peak local strain · %'],rubber:['Compression · %','Retained volume · %','Permanent set · %'],granular:['Runout · m','Pile height · m','Grains behind gate']};
