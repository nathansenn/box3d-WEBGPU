import {ConvexBody,ConvexContactWorld,contactBox,triangularPrism,contactEuler,convexSeparation,CONTACT_SKIN,type ContactStats} from '../../engine/convex-contact';
import {GLASS_RIG,glassFixtures} from './glass-rig';
import {GlassPendulum,glassPendulumContacts} from './glass-pendulum';
import {LabModel,DT,random,copyFrame,type LabFrame,type V3} from './lab-model';
import type {LabSettings} from './catalog';

/** The Studio's earlier glass lab: authored fracture thresholds on triangular prisms in the swept convex-contact
 * world. The Studio no longer runs it (see glass-si.ts); it stays as the qualification scene of
 * src/engine/convex-contact.ts (docs/GLASS_CONTACT.md, scripts/glass-collision-qualify.mjs). */
export class ConvexGlassModel extends LabModel {
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

