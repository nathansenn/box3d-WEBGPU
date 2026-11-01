import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3} from 'three';
import {ConvexBody,ConvexContactWorld,contactBox,contactEuler} from '../../src/engine/convex-contact.ts';
import {referenceShape,referenceSeparation} from '../../scripts/glass-collision-qualify.mjs';

const pose=b=>({position:[...b.position],rotation:[...b.rotation],velocity:[...b.velocity],angularVelocity:[...b.angularVelocity],pose:structuredClone(b.pose)});
const falling=()=>{
  const world=new ConvexContactWorld(),body=world.add(new ConvexBody(contactBox([.2,.3,.4],2),[0,10,0],2));
  world.externalForces=dt=>{body.velocity[1]-=8*dt;};return {world,body};
};

test('force prediction does not commit gravity twice',()=>{
  const {world,body}=falling(),calls=[],dt=1/64;
  world.externalForces=(h,phase)=>{calls.push([h,phase]);body.velocity[1]-=8*h;};world.step(dt);
  assert.equal(calls.filter(c=>c[1]==='prediction').length,1);
  assert.equal(calls.filter(c=>c[1]==='substep').length,4);
  assert.equal(body.velocity[1],-8*dt);
  assert.equal(body.position[1],10-8*dt*dt*5/8);
});

test('gravity and drag converge to the independent closed-form trajectory',()=>{
  const errors=[];
  for(const dt of [1/60,1/120,1/240]){
    const {world,body}=falling(),g=9.81,gamma=.15,T=.25;
    world.externalForces=h=>{body.velocity[1]=(body.velocity[1]-g*h)*Math.exp(-gamma*h);};
    for(let n=0;n<Math.round(T/dt);n++)world.step(dt);
    const v=-g/gamma*(1-Math.exp(-gamma*T)),y=10+g/(gamma*gamma)*(1-Math.exp(-gamma*T))-g/gamma*T;
    errors.push([Math.abs(body.velocity[1]-v),Math.abs(body.position[1]-y)]);
  }
  for(let i=0;i<2;i++)for(let k=0;k<2;k++){
    const ratio=errors[i][k]/errors[i+1][k];assert.ok(ratio>1.95&&ratio<2.05,`refinement ratio ${ratio}`);
  }
});

test('an unresolved query restores forces before retrying smaller intervals',()=>{
  const a=falling(),b=falling(),dt=1/64,wall=a.world.add(new ConvexBody(contactBox([1,1,1]),[100,0,0],1,false));
  a.world.contactProvider=h=>h>dt/2?[{a:wall,b:a.body,normal:[0,1,0],points:[{a:[0,0,0],b:[0,10,0],gap:10}],poseA:wall.pose,poseB:a.body.pose,time:0,iterations:1,converged:false}]:[];
  a.world.step(dt);b.world.step(dt/2);b.world.step(dt/2);
  assert.deepEqual(pose(a.body),pose(b.body));assert.equal(a.world.stats.refinements,1);assert.equal(a.world.stats.ccdUnresolved,0);
});

test('late contact rejection restores the original velocity snapshot',()=>{
  const a=falling(),b=falling(),dt=1/64;let interval=0;
  a.world.externalForces=(h,phase)=>{if(phase==='prediction')interval=h;a.body.velocity[1]-=8*h;};
  a.world.externalPenetration=()=>interval>dt/2?.001:0;
  a.world.step(dt);b.world.step(dt/2);b.world.step(dt/2);
  assert.deepEqual(pose(a.body),pose(b.body));assert.equal(a.world.stats.refinements,1);
});

test('gravity-driven contact stays above a thin floor',()=>{
  const world=new ConvexContactWorld(),floor=world.add(new ConvexBody(contactBox([2,.0001,2]),[0,-.00005,0],1,false)),body=world.add(new ConvexBody(contactBox([.1,.1,.1]),[0,.05005,0]));
  body.restitution=floor.restitution=0;world.externalForces=h=>{body.velocity[1]-=9.81*h;};
  for(let i=0;i<30;i++){
    world.step(1/120);assert.ok(body.position[1]>=.05-.0005);assert.ok(world.stats.maxPenetration<=.0005);assert.equal(world.stats.ccdUnresolved,0);
  }
});

for(const axis of [0,1,2])for(const sign of [-1,1])test(`rotation detects a thin transient contact on axis ${axis}, direction ${sign}`,()=>{
  const dt=1/120,h=dt/4,long=(axis+1)%3,thin=(axis+2)%3,rodSize=[0,0,0],obstacleSize=[.00005,.00005,.00005];
  rodSize[axis]=.02;rodSize[long]=1;rodSize[thin]=.0001;obstacleSize[axis]=.1;
  let angle=0,speed=10*sign;
  for(let s=0;s<4;s++){speed=(speed-angle*.94*40*h)*Math.exp(-8*h);angle+=speed*h;}
  const predicted=10*sign*Math.exp(-8*dt)*dt,obstacleAngle=(predicted+angle)/2,position=[0,0,0];
  position[long]=.45*Math.cos(obstacleAngle);position[thin]=.45*Math.sin(obstacleAngle);
  const world=new ConvexContactWorld(),rod=world.add(new ConvexBody(contactBox(rodSize),[0,0,0])),obstacle=world.add(new ConvexBody(contactBox(obstacleSize),position,1,false));
  rod.angularVelocity[axis]=10*sign;rod.restitution=obstacle.restitution=0;rod.friction=obstacle.friction=0;
  const unit=new Vector3();unit.setComponent(axis,1);
  const gapAt=a=>referenceSeparation(referenceShape({shape:rod.shape,position:[0,0,0],rotation:new Quaternion().setFromAxisAngle(unit,a).toArray(),dynamic:true}),referenceShape(obstacle));
  assert.ok(gapAt(0)>3e-5);assert.ok(gapAt(predicted)>3e-5);assert.ok(gapAt(angle)>3e-5);assert.ok(gapAt(obstacleAngle)<0);
  world.externalForces=step=>{const angles=contactEuler(rod.rotation);for(let k=0;k<3;k++)rod.angularVelocity[k]=(rod.angularVelocity[k]-angles[k]*.94*40*step)*Math.exp(-8*step);};
  world.step(dt);
  assert.ok(world.stats.contacts>0);assert.ok(world.stats.sweptContacts>0);
  assert.ok(referenceSeparation(referenceShape(rod),referenceShape(obstacle))>=-.0005);
  assert.equal(world.stats.ccdUnresolved,0);assert.ok(world.stats.maxPenetration<=.0005);
});

test('a gravity reversal detects the ceiling crossed between accepted endpoints',()=>{
  const world=new ConvexContactWorld(),body=world.add(new ConvexBody(contactBox([.004,.00001,.004]),[0,0,0])),ceiling=world.add(new ConvexBody(contactBox([.01,.000005,.01]),[0,.0000475,0],1,false));
  body.velocity[1]=.05;body.restitution=ceiling.restitution=0;body.friction=ceiling.friction=0;
  world.externalForces=h=>{body.velocity[1]-=9.81*h;};world.step(1/120);
  const h=1/480,freePeak=(.05-9.81*h)*h+(.05-2*9.81*h)*h;
  assert.ok(freePeak>.00005);assert.ok(world.stats.sweptContacts>0);
  assert.ok(body.velocity[1]<.05-9.81/120-1e-4);assert.equal(world.stats.ccdUnresolved,0);
  assert.ok(body.position[1]+.000005<=.000045+1e-7);
  assert.ok(referenceSeparation(referenceShape(body),referenceShape(ceiling))>=-1e-7);
});
