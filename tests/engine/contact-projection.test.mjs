import test from 'node:test';
import assert from 'node:assert/strict';
import {Vector3} from 'three';
import '../../scripts/glass-collision-qualify.mjs';
const {ConvexBody,ConvexContactWorld,contactBox}=await import('../../src/engine/convex-contact.ts');
const {GlassPendulum}=await import('../../src/studio/material-labs/glass-pendulum.ts');
const {GLASS_RIG}=await import('../../src/studio/material-labs/glass-rig.ts');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-12,`${a} != ${b}`);

test('external split correction preserves free-body orientations and mass-weighted centre',()=>{
  const world=new ConvexContactWorld(),a=world.add(new ConvexBody(contactBox([1,1,1],2),[0,0,0],2)),b=world.add(new ConvexBody(contactBox([1,1,1],3),[.999,0,0],3));
  const before={a:[...a.rotation],b:[...b.rotation],centre:(2*a.position[0]+3*b.position[0])/5};
  world.contactProvider=()=>[{a,b,normal:[1,0,0],poseA:a.pose,poseB:b.pose,time:0,iterations:1,converged:true,positionTarget:0,points:[{a:[a.position[0]+.5,.2,.1],b:[b.position[0]-.5,.2,.1],gap:b.position[0]-a.position[0]-1}]}];
  world.externalPenetration(true);
  // The off-centre contact has a nonzero angular lever. Final plane projection
  // must preserve its fixed orientation, while velocity response remains 3D.
  assert.deepEqual(a.rotation,before.a);assert.deepEqual(b.rotation,before.b);
  close((2*a.position[0]+3*b.position[0])/5,before.centre);
  close(b.position[0]-a.position[0]-1,-.0002);
  close(a.position[0],-.00048);close(b.position[0],.99932);
  assert.deepEqual(a.velocity,[0,0,0]);assert.deepEqual(b.velocity,[0,0,0]);
});

test('split correction preserves the pendulum coordinate and its pivot Jacobian',()=>{
  const b=new GlassPendulum(25,.65,.4),arm=[.07,-.09,.12],j=[0,.003,.005],n=new Vector3(.2,.3,.4).normalize();
  const lever=new Vector3(...b.position).add(new Vector3(...arm)).sub(new Vector3(.65,GLASS_RIG.pivotY,0));
  const jacobian=new Vector3(-1,0,0).cross(lever).dot(n),before=b.angle;
  close(b.inverseMassAt(arm,n.toArray(),true),jacobian*jacobian/b.inertia);
  const angleChange=-lever.clone().cross(new Vector3(...j)).x/b.inertia;
  b.correctPose(arm,j,true);b.sync();close(b.angle-before,angleChange);
  close(b.position[0],.65);
  close(Math.hypot(b.position[1]-GLASS_RIG.pivotY,b.position[2]),Math.hypot(GLASS_RIG.pendulumLength,GLASS_RIG.bobOffsetZ));
});
