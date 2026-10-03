import {Quaternion,Vector3} from 'three';

export const yaw=(v,a)=>[Math.cos(a)*v[0]+Math.sin(a)*v[2],v[1],-Math.sin(a)*v[0]+Math.cos(a)*v[2]];
export const sliderReference={speed:Math.hypot(1,.7),mu:.5,g:9.81};
sliderReference.stopDistance=sliderReference.speed**2/(2*sliderReference.mu*sliderReference.g);
sliderReference.stopTime=sliderReference.speed/(sliderReference.mu*sliderReference.g);

// A free body: no overridden inertia, velocity, or contact generation. Rotating
// both the floor and slider keeps the same physical experiment in another basis.
export function freeSlider(api,{angle=0,dt=1/120,iterations=4}={}){
  const {mu,g,speed,stopDistance}=sliderReference,size=[.4,.02,.8],mass=1;
  const world=new api.ConvexContactWorld(),floor=world.add(new api.ConvexBody(api.contactBox([10,1,10]),[0,-.5,0],1,false));
  const body=world.add(new api.ConvexBody(api.contactBox(size,mass),[0,.01,0],mass));
  for(const b of [floor,body]){b.rotation=[0,Math.sin(angle/2),0,Math.cos(angle/2)];b.friction=mu;b.restitution=0;b.sync();}
  body.velocity=yaw([1,0,.7],angle);
  // Independent cuboid moment-of-inertia formula and Three.js rotation.
  const inertia=size.map((_,i)=>mass*(size[(i+1)%3]**2+size[(i+2)%3]**2)/12);
  const energy=()=>{const w=new Vector3(...body.angularVelocity).applyQuaternion(new Quaternion(...body.rotation).invert()).toArray();return .5*mass*body.velocity.reduce((s,v)=>s+v*v,0)+.5*w.reduce((s,v,i)=>s+inertia[i]*v*v,0);};
  let previousEnergy=energy(),maxEnergyGain=0,maxMomentumResidual=0,maxCoulombViolation=0,maxOverlap=0,unresolved=0,stoppedAt=null;
  let maxCrossTrack=0,maxRollPitchSpeed=0,maxHeightError=0,maxSlidingDirectionError=0;
  for(let tick=1;tick<=Math.round(.6/dt);tick++){
    const before=[...body.velocity];body.velocity[1]-=g*dt;world.step(dt,iterations);
    const impulse=[0,0,0];
    for(const records of world.previous.values())for(const c of records){
      for(let k=0;k<3;k++)impulse[k]+=c.impulse[k]+c.normal[k]*c.normalImpulse;
      maxCoulombViolation=Math.max(maxCoulombViolation,Math.hypot(...c.impulse)-mu*c.normalImpulse);
    }
    maxMomentumResidual=Math.max(maxMomentumResidual,Math.hypot(mass*(body.velocity[0]-before[0])-impulse[0],mass*(body.velocity[2]-before[2])-impulse[2]));
    const currentEnergy=energy();maxEnergyGain=Math.max(maxEnergyGain,currentEnergy-previousEnergy);previousEnergy=currentEnergy;
    const position=yaw(body.position,-angle),velocity=yaw(body.velocity,-angle);
    maxCrossTrack=Math.max(maxCrossTrack,Math.abs(position[2]-.7*position[0])/speed);
    // Compare net friction impulse and incident slip direction while clearly sliding.
    const horizontalImpulse=Math.hypot(impulse[0],impulse[2]),incidentSpeed=Math.hypot(before[0],before[2]);
    if(incidentSpeed>.1&&horizontalImpulse>1e-12)maxSlidingDirectionError=Math.max(maxSlidingDirectionError,Math.abs(impulse[0]*before[2]-impulse[2]*before[0])/(horizontalImpulse*incidentSpeed));
    maxRollPitchSpeed=Math.max(maxRollPitchSpeed,Math.hypot(body.angularVelocity[0],body.angularVelocity[2]));maxHeightError=Math.max(maxHeightError,Math.abs(body.position[1]-.01));
    maxOverlap=Math.max(maxOverlap,-body.pose.min[1]);unresolved+=world.stats.ccdUnresolved;
    if(stoppedAt===null&&Math.hypot(velocity[0],velocity[2])<1e-8)stoppedAt=tick*dt;
  }
  const position=yaw(body.position,-angle),velocity=yaw(body.velocity,-angle),angularVelocity=yaw(body.angularVelocity,-angle);
  const distance=Math.hypot(position[0],position[2]);
  return {angle,dt,iterations,position,velocity,angularVelocity,distance,distanceError:Math.abs(distance-stopDistance),maxCrossTrack,stoppedAt,maxEnergyGain,maxMomentumResidual,maxCoulombViolation,maxOverlap,unresolved,maxRollPitchSpeed,maxHeightError,maxSlidingDirectionError};
}
