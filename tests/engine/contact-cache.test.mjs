import test from 'node:test';
import assert from 'node:assert/strict';
import {ConvexBody,ConvexContactWorld,contactBox,convexManifold} from '../../src/engine/convex-contact.ts';

test('edge and vertex touching retain only their distinct support points',()=>{
  for(const [center,count] of [[[1,1,0],2],[[1,1,1],1],[[0,1,0],4]]){
    const a=new ConvexBody(contactBox([1,1,1]),[0,0,0]),b=new ConvexBody(contactBox([1,1,1]),center,1,false),points=convexManifold(a,b);
    assert.equal(points.length,count);assert.equal(new Set(points.map(p=>JSON.stringify(p.a))).size,count);
    for(const p of points){assert.deepEqual(p.a,p.b);assert.equal(p.gap,0);}
  }
});

function contactFixture(anchors){
  class RecordedBody extends ConvexBody {calls=[];impulse(r,j){this.calls.push([...j]);super.impulse(r,j);}}
  const world=new ConvexContactWorld(),floor=world.add(new ConvexBody(contactBox([2,1,2]),[0,-.5,0],1,false)),moving=world.add(new RecordedBody(contactBox([1,1,1]),[0,.5,0]));
  floor.collisionEnabled=moving.collisionEnabled=false;floor.friction=moving.friction=0;floor.restitution=moving.restitution=0;
  world.contactProvider=()=>[{a:floor,b:moving,normal:[0,1,0],poseA:floor.pose,poseB:moving.pose,time:0,iterations:1,converged:true,points:anchors.map(x=>({a:[x,0,0],b:[x,moving.position[1]-.5,0],gap:moving.position[1]-.5}))}];
  return {world,moving};
}
const cached=(x,normalImpulse,normal=[0,1,0])=>({localA:[x,.5,0],localB:[x,-.5,0],dynamicA:false,dynamicB:true,normal,impulse:[0,0,0],normalImpulse});

test('distinct points within one millimetre retain separate cache records',()=>{
  const {world}=contactFixture([.0001,.0002]);world.step(1/120);
  assert.equal(world.stats.contacts,2);const records=world.previous.get('0/1');assert.equal(records.length,2);
  assert.deepEqual(records.map(r=>r.localB[0]),[.0001,.0002]);
});

test('one old contact impulse cannot warm start two new contacts',()=>{
  const {world,moving}=contactFixture([.0001,.0002]),previous=new Map([['0/1',[cached(.00015,.1)]]]);
  world.previous=previous;world.previousDt=1/120;const before=structuredClone(previous);world.step(1/120,1);
  assert.equal(moving.calls[0][1],.1);assert.ok(moving.calls[1][1]<=0,'second positive warm-start impulse reused the same old point');
  assert.deepEqual(previous,before,'previous trial cache was mutated');
});

test('cache matching follows local anchors when manifold order changes',()=>{
  const {world,moving}=contactFixture([.0002,.0001]);world.previous=new Map([['0/1',[cached(.0001,.1),cached(.0002,.2)]]]);world.previousDt=1/120;
  world.step(1/120,1);assert.deepEqual(moving.calls.slice(0,2).map(j=>j[1]),[.2,.1]);
});

test('distant or differently oriented cached points are not warm started',()=>{
  for(const old of [cached(.001101,.1),cached(.0001,.1,[1,0,0])]){
    const {world,moving}=contactFixture([.0001]);world.previous=new Map([['0/1',[old]]]);world.previousDt=1/120;
    world.step(1/120,1);assert.ok(moving.calls.every(j=>j[1]===0));
  }
});

test('duplicate generated points are removed without modifying provider data',()=>{
  const {world}=contactFixture([.0001,.0001,.0002]),provider=world.contactProvider,received=[];
  world.contactProvider=dt=>{const contacts=provider(dt);received.push({contacts,copy:structuredClone(contacts[0].points)});return contacts;};
  world.step(1/120);assert.equal(world.stats.contacts,2);
  for(const row of received)assert.deepEqual(row.contacts[0].points,row.copy);
});

test('releasing a fixed participant invalidates the previous support impulse',()=>{
  const {world,moving}=contactFixture([.0001]);world.bodies[0].dynamic=true;
  world.previous=new Map([['0/1',[{...cached(.0001,.1),dynamicA:true,dynamicB:false}]]]);world.previousDt=1/120;
  world.step(1/120,1);assert.ok(moving.calls.every(j=>j[1]===0),'held-fragment support impulse was reused after release');
});

test('fixing a formerly dynamic participant invalidates its old contact impulse',()=>{
  const {world,moving}=contactFixture([.0001]);
  world.previous=new Map([['0/1',[{...cached(.0001,.1),dynamicA:true}]]]);world.previousDt=1/120;
  world.step(1/120,1);assert.ok(moving.calls.every(j=>j[1]===0),'dynamic support impulse was reused after fixing');
});
