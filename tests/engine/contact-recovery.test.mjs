import test from 'node:test';
import assert from 'node:assert/strict';
import {ConvexBody,ConvexContactWorld,ContactResolutionError,contactBox} from '../../src/engine/convex-contact.ts';

const DT=1/120;
function fixture(walls=1){
  const world=new ConvexContactWorld();
  const body=world.add(new ConvexBody(contactBox([1,1,1]),[0,10,0]));body.velocity=[1,0,0];
  const fixed=Array.from({length:walls},(_,i)=>{const b=world.add(new ConvexBody(contactBox([1,1,1]),[i,-10,0],1,false));b.collisionEnabled=false;return b;});
  return {world,body,fixed};
}
const contact=(body,wall,converged=false)=>({a:wall,b:body,normal:[0,1,0],points:[{a:[wall.position[0],-9.5,0],b:[body.position[0],body.position[1]-.5,0],gap:body.position[1]+9}],poseA:wall.pose,poseB:body.pose,time:0,iterations:48,converged});
const state=world=>({bodies:world.bodies.map(b=>({position:[...b.position],rotation:[...b.rotation],velocity:[...b.velocity],angularVelocity:[...b.angularVelocity],dynamic:b.dynamic,collisionEnabled:b.collisionEnabled,friction:b.friction,restitution:b.restitution,pose:structuredClone(b.pose)})),stats:structuredClone(world.stats),impacts:world.impacts.map(i=>({a:world.bodies.indexOf(i.a),b:world.bodies.indexOf(i.b),speed:i.speed,impulse:i.impulse}))});
const rejects=(operation,stage)=>assert.throws(operation,e=>e instanceof ContactResolutionError&&e.code==='CCD_UNRESOLVED'&&e.stage===stage);

test('terminal sweep exhaustion restores the interval and can retry after the fault is removed',()=>{
  const a=fixture(),b=fixture(),before=state(a.world);let queries=0;
  a.world.contactProvider=h=>{if(!h)return [];queries++;return [contact(a.body,a.fixed[0])];};
  rejects(()=>a.world.step(DT),'sweep');assert.equal(queries,11);
  assert.deepEqual(state(a.world),before);
  a.world.contactProvider=undefined;a.world.step(DT);b.world.step(DT);assert.deepEqual(state(a.world),state(b.world));
});

test('failure in the second subdivision restores accepted first-half motion and warm starts',()=>{
  function resting(){
    const world=new ConvexContactWorld(),floor=world.add(new ConvexBody(contactBox([10,1,10]),[0,-.5,0],1,false)),body=world.add(new ConvexBody(contactBox([1,1,1]),[0,.5,0]));
    floor.friction=body.friction=0;body.velocity=[1,0,0];world.externalForces=h=>{body.velocity[1]-=9.81*h;};world.step(DT);
    return {world,body,floor};
  }
  const a=resting(),b=resting(),before=state(a.world),start=a.body.position[0];let travel=0;
  assert.ok(a.world.stats.contacts>0);
  a.world.contactProvider=h=>{
    travel=Math.max(travel,a.body.position[0]-start);
    return h>0&&(h>DT/2||a.body.position[0]>start+DT*.45)?[contact(a.body,a.floor)]:[];
  };
  rejects(()=>a.world.step(DT),'sweep');assert.ok(travel>=DT/2-1e-15);
  assert.deepEqual(state(a.world),before);
  a.world.contactProvider=undefined;a.world.step(DT);b.world.step(DT);assert.deepEqual(state(a.world),state(b.world));
});

test('terminal contact discovery exhaustion cannot commit applied forces',()=>{
  const a=fixture(5),before=state(a.world);let prediction=true,cursor=0;
  a.world.externalForces=(h,phase)=>{prediction=phase==='prediction';cursor=0;a.body.velocity[1]-=h;};
  a.world.contactProvider=h=>!h||prediction?[]:[contact(a.body,a.fixed[Math.min(cursor++,4)],true)];
  rejects(()=>a.world.step(DT),'discovery');assert.deepEqual(state(a.world),before);
});

test('an unresolved endpoint query rolls back motion instead of certifying the position projection',()=>{
  const a=fixture(),before=state(a.world);let advanced=false;
  a.world.contactProvider=h=>{if(h)return [];advanced||=a.body.position[0]>0;return [contact(a.body,a.fixed[0])];};
  rejects(()=>a.world.step(DT),'projection');assert.ok(advanced);assert.deepEqual(state(a.world),before);
});

test('a callback exception restores the original error and accepted world state',()=>{
  const a=fixture(),before=state(a.world),fault=new Error('Force callback failed');
  a.world.externalForces=h=>{a.body.velocity[1]-=h;throw fault;};
  assert.throws(()=>a.world.step(DT),error=>error===fault);assert.deepEqual(state(a.world),before);
});

test('a failed outer transaction restores body material, topology, callbacks and nested steps',()=>{
  const a=fixture(),before=state(a.world),bodies=[...a.world.bodies],fault=new Error('Late operation failure'),forces=a.world.externalForces;
  assert.throws(()=>a.world.transaction(()=>{
    a.world.externalForces=h=>{a.body.velocity[1]-=h;};a.body.friction=.1;a.body.restitution=.9;
    a.fixed[0].dynamic=true;a.fixed[0].collisionEnabled=true;a.world.step(DT);
    a.world.add(new ConvexBody(contactBox([1,1,1]),[50,50,50]));throw fault;
  }),error=>error===fault);
  assert.deepEqual(state(a.world),before);assert.deepEqual(a.world.bodies,bodies);assert.equal(a.world.externalForces,forces);
  const b=fixture();a.world.step(DT);b.world.step(DT);assert.deepEqual(state(a.world),state(b.world));
});
