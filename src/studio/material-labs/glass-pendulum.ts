import {ConvexBody,contactBox,sphereConvex,CONTACT_SKIN,type ContactVec3 as V,type ContactPose,type GeneratedContact} from '../../engine/convex-contact';
import {GLASS_RIG,glassBobPosition,glassBobTangent} from './glass-rig';

/** One generalized coordinate about the fixed pivot, including the solid bob's
 * own inertia. This participant shares the shard impulse and position solve. */
export class GlassPendulum extends ConvexBody {
  constructor(mass:number,impactX:number,dropHeight:number){
    super(contactBox([GLASS_RIG.bobRadius*2,GLASS_RIG.bobRadius*2,GLASS_RIG.bobRadius*2],mass),[impactX,0,0],mass);
    this.collisionEnabled=false;this.friction=.35;this.restitution=.27;
    this.setAngle(Math.acos(1-dropHeight/Math.hypot(GLASS_RIG.pendulumLength,GLASS_RIG.bobOffsetZ))-Math.atan2(GLASS_RIG.bobOffsetZ,GLASS_RIG.pendulumLength));this.sync();
  }
  get angle():number{return -2*Math.atan2(this.rotation[0],this.rotation[3]);}
  get speed():number{return -this.angularVelocity[0];}
  get inertia():number{return this.mass*(GLASS_RIG.pendulumLength**2+GLASS_RIG.bobOffsetZ**2+.4*GLASS_RIG.bobRadius**2);}
  private setAngle(angle:number):void {this.rotation=[-Math.sin(angle/2),0,0,Math.cos(angle/2)];this.position=glassBobPosition(angle,this.position[0]);}
  private tangent(arm:V):V {const t=glassBobTangent(this.angle);return [0,t[1]+arm[2],t[2]-arm[1]];}
  override pointVelocity(arm:V):V {return this.tangent(arm).map(v=>v*this.speed) as V;}
  override inverseMassAt(arm:V,n:V):number {const t=this.tangent(arm),j=t.reduce((s,v,k)=>s+v*n[k],0);return j*j/this.inertia;}
  override impulse(arm:V,impulse:V):void {const t=this.tangent(arm);this.angularVelocity[0]-=t.reduce((s,v,k)=>s+v*impulse[k],0)/this.inertia;this.velocity=this.pointVelocity([0,0,0]);}
  override correctPose(arm:V,impulse:V):void {const t=this.tangent(arm),delta=t.reduce((s,v,k)=>s+v*impulse[k],0)/this.inertia;this.setAngle(this.angle+Math.max(-.15,Math.min(.15,delta)));}
  override at(dt:number):ContactPose {
    const angle=this.angle+this.speed*dt,position=glassBobPosition(angle,this.position[0]),c=Math.cos(angle),s=Math.sin(angle);
    const transform=(v:V):V=>[v[0],c*v[1]+s*v[2],-s*v[1]+c*v[2]],vertices=this.shape.vertices.map(v=>transform(v).map((x,k)=>x+position[k]) as V);
    return {position,rotation:[-Math.sin(angle/2),0,0,Math.cos(angle/2)],vertices,normals:this.shape.normals.map(transform),edges:this.shape.edges.map(transform),min:[0,1,2].map(k=>Math.min(...vertices.map(v=>v[k]))) as V,max:[0,1,2].map(k=>Math.max(...vertices.map(v=>v[k]))) as V};
  }
  override advance(dt:number):void {this.setAngle(this.angle+this.speed*dt);this.sync();}
  override sync():void {this.position=glassBobPosition(this.angle,this.position[0]);this.velocity=this.pointVelocity([0,0,0]);super.sync();}
  gravity(dt:number):void {this.angularVelocity[0]+=(this.mass*9.81*glassBobTangent(this.angle)[1]/this.inertia+.08*this.speed)*dt;this.velocity=this.pointVelocity([0,0,0]);}
}

/** Conservative sphere/prism search. Both bodies use the same interval origin.
 * A separating-plane speed and rotational acceleration bound avoid slow grazing
 * convergence. Exhaustion is retried by the shared contact world. */
export function glassPendulumContacts(pendulum:GlassPendulum,bodies:ConvexBody[],dt:number):GeneratedContact[]{
  const contacts:GeneratedContact[]=[],radius=GLASS_RIG.bobRadius,orbitRadius=Math.hypot(GLASS_RIG.pendulumLength,GLASS_RIG.bobOffsetZ);
  const start=pendulum.position,end=glassBobPosition(pendulum.angle+pendulum.speed*dt,start[0]),arc=orbitRadius*pendulum.speed**2*dt*dt/8;
  for(const body of bodies){
    if(body===pendulum||!body.collisionEnabled)continue;
    const motion=body.dynamic?(Math.hypot(...body.velocity)+Math.hypot(...body.angularVelocity)*body.shape.radius)*dt:0;
    if(start.some((v,k)=>Math.min(v,end[k])-radius-arc>body.pose.max[k]+motion||Math.max(v,end[k])+radius+arc<body.pose.min[k]-motion))continue;
    let time=0;
    for(let iteration=0;iteration<48;iteration++){
      const pa=time?pendulum.at(time):pendulum.pose,pb=time?body.at(time):body.pose,hit=sphereConvex(pa.position,radius,body,pb),converged=hit.gap<=CONTACT_SKIN*3;
      if(converged||iteration===47){
        contacts.push({a:pendulum,b:body,time,poseA:pa,poseB:pb,normal:hit.normal.map(v=>-v) as V,points:[{a:pa.position.map((v,k)=>v-hit.normal[k]*radius) as V,b:hit.point,gap:hit.gap}],iterations:iteration+1,converged,positionTarget:CONTACT_SKIN});break;
      }
      if(dt===0)break;
      const tangent=glassBobTangent(pendulum.angle+pendulum.speed*time),bobNormalSpeed=hit.normal.reduce((s,n,k)=>s+n*tangent[k]*pendulum.speed,0);
      const shardNormalSpeed=body.dynamic?Math.max(...pb.vertices.map(v=>{const speed=body.pointVelocity(v.map((x,k)=>x-pb.position[k]) as V);return hit.normal.reduce((s,n,k)=>s+n*speed[k],0);})):0;
      const closing=shardNormalSpeed-bobNormalSpeed,margin=hit.gap-CONTACT_SKIN;
      const curvature=orbitRadius*pendulum.speed**2+(body.dynamic?body.shape.radius*body.angularVelocity.reduce((s,v)=>s+v*v,0):0),root=Math.sqrt(closing*closing+2*curvature*margin);
      const advance=curvature>1e-12?(closing>=0?2*margin/(closing+root):(root-closing)/curvature):closing>0?margin/closing:Infinity;
      if(time+advance>dt)break;time+=advance;
    }
  }
  return contacts;
}
