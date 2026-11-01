import {Euler,Quaternion} from 'three';
import type {LabFrame} from './models';

/** Display-only poses. Worker frames and recorded history stay authoritative.
 * Interpolation stops at the latest received pose and never predicts a contact.
 */
export class GlassPresentation {
  private from:LabFrame|null=null;
  private shown:LabFrame|null=null;
  private next:LabFrame|null=null;
  private started=0;
  private received=0;
  private duration=0;
  private readonly a=new Quaternion();
  private readonly b=new Quaternion();
  private readonly e=new Euler(0,0,0,'XYZ');
  private dirty=false;

  reset(frame:LabFrame,now:number):void {
    this.from=this.copy(frame,this.from);this.shown=this.copy(frame,this.shown);this.next=frame;
    this.started=this.received=now;this.duration=0;this.dirty=true;
  }
  receive(frame:LabFrame,now:number,smooth=true):void {
    if(!this.next||frame.time<=this.next.time||frame.positions.length!==this.next.positions.length||!smooth){this.reset(frame,now);return;}
    this.sample(now);
    this.from=this.copy(this.shown!,this.from);this.next=frame;
    this.duration=Math.max(1000/120,Math.min(150,now-this.received));this.started=this.received=now;this.dirty=true;
  }
  /** Null means the already uploaded display pose remains unchanged. */
  sample(now:number):LabFrame|null {
    if(!this.next||!this.shown||!this.from||!this.dirty)return null;
    const t=this.duration?Math.max(0,Math.min(1,(now-this.started)/this.duration)):1;
    const out=this.shown,a=this.from,b=this.next;
    if(t===1){this.copy(b,out);this.dirty=false;return out;}
    out.time=a.time+(b.time-a.time)*t;out.actuator=a.actuator+(b.actuator-a.actuator)*t;
    out.phase=b.phase;out.damage.set(b.damage);
    for(let i=0;i<3;i++)out.metrics[i]=b.metrics[i];
    if(b.collisions){out.collisions??={...b.collisions};Object.assign(out.collisions,b.collisions);}else out.collisions=undefined;
    for(let i=0;i<out.positions.length;i++)out.positions[i]=a.positions[i]+(b.positions[i]-a.positions[i])*t;
    for(let i=0;i<out.rotations.length;i+=3){
      this.a.setFromEuler(this.e.set(a.rotations[i],a.rotations[i+1],a.rotations[i+2]));
      this.b.setFromEuler(this.e.set(b.rotations[i],b.rotations[i+1],b.rotations[i+2]));
      this.a.slerp(this.b,t);this.e.setFromQuaternion(this.a,'XYZ');
      out.rotations[i]=this.e.x;out.rotations[i+1]=this.e.y;out.rotations[i+2]=this.e.z;
    }
    return out;
  }
  private copy(frame:LabFrame,target:LabFrame|null):LabFrame {
    if(!target||target.positions.length!==frame.positions.length)target={...frame,positions:frame.positions.slice(),rotations:frame.rotations.slice(),damage:frame.damage.slice(),metrics:[...frame.metrics],...(frame.collisions?{collisions:{...frame.collisions}}:{})};
    else {target.time=frame.time;target.positions.set(frame.positions);target.rotations.set(frame.rotations);target.damage.set(frame.damage);target.actuator=frame.actuator;target.phase=frame.phase;target.metrics=[...frame.metrics];target.collisions=frame.collisions?{...frame.collisions}:undefined;}
    return target;
  }
}
