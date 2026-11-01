import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import '../../scripts/glass-collision-qualify.mjs';
const {GlassPendulum,glassPendulumContacts}=await import('../../src/studio/material-labs/glass-pendulum.ts');
const {ConvexBody,ConvexContactWorld,contactBox,CONTACT_SKIN}=await import('../../src/engine/convex-contact.ts');
const {GLASS_RIG}=await import('../../src/studio/material-labs/glass-rig.ts');
const {GlassModel}=await import('../../src/studio/material-labs/models.ts');
const {LABS}=await import('../../src/studio/material-labs/catalog.ts');
const {referenceSphereContacts}=await import('../../scripts/glass-collision-qualify.mjs');
const close=(a,b,t=1e-9)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);

test('pendulum impulses satisfy angular momentum about the fixed pivot',()=>{
  const b=new GlassPendulum(25,.65,.4),arm=[.07,-.09,.12],impulse=[2,-3,5],before=b.speed;
  const lever=new Vector3(...b.position).add(new Vector3(...arm)).sub(new Vector3(.65,GLASS_RIG.pivotY,0));
  const torque=lever.clone().cross(new Vector3(...impulse)).x;
  b.impulse(arm,impulse);close(-b.inertia*(b.speed-before),torque);
  const reference=new Vector3(-b.speed,0,0).cross(lever).toArray();
  b.pointVelocity(arm).forEach((v,i)=>close(v,reference[i]));
  const future=b.at(.01);b.advance(.01);b.position.forEach((v,i)=>close(v,future.position[i]));
  close(Math.hypot(b.position[1]-GLASS_RIG.pivotY,b.position[2]),Math.hypot(GLASS_RIG.pendulumLength,GLASS_RIG.bobOffsetZ));
});

test('curved sphere sweep matches the analytic plane-contact angle',()=>{
  const b=new GlassPendulum(25,0,.4),angle=.04;b.rotation=[-Math.sin(angle/2),0,0,Math.cos(angle/2)];b.angularVelocity=[2,0,0];b.sync();
  const pane=new ConvexBody(contactBox([5,5,.024]),[0,2.45,0],1,false),hits=glassPendulumContacts(b,[pane],1/30);
  const r=Math.hypot(1.9,.23),hitAngle=Math.asin((.235+.012+CONTACT_SKIN)/r)-Math.atan2(.23,1.9),expected=(hitAngle-angle)/b.speed;
  assert.equal(hits.length,1);assert.equal(hits[0].converged,true);close(hits[0].time,expected,1e-5);
  const world=new ConvexContactWorld();world.add(b);world.add(pane);world.contactProvider=dt=>glassPendulumContacts(b,[pane],dt);
  for(let i=0;i<60;i++){b.gravity(1/120);world.step(1/120);assert.ok(b.position[2]-.235-.012>=-2e-5);assert.equal(world.stats.ccdUnresolved,0);}
});

test('retained fragments and the bob remain separated in the same contact solve',()=>{
  const preset=LABS.glass.experiments.find(p=>p.id==='laminated-retention'),m=new GlassModel({...LABS.glass.defaults,...preset.settings});let worst=0;
  for(let i=0;i<480;i++){
    m.step();assert.equal(m.frame.collisions.unresolvedSweeps,0,`unresolved at tick ${i+1}`);
    assert.ok(m.collisionWorld.stats.maxPenetration<=.0005);
    if(i%30===29)worst=Math.max(worst,referenceSphereContacts(m.pendulum.position,.235,m.shardBodies).maximum);
  }
  assert.ok(m.frame.metrics[1]>50);assert.ok(worst<=.0005,`independent bob overlap ${worst} m`);
});
