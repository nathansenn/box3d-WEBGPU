import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {GlassModel,DT}=await import('../../src/studio/material-labs/models.ts');
const {ContactResolutionError}=await import('../../src/engine/convex-contact.ts');
const {glassWorkerHandler}=await import('../../src/studio/material-labs/glass-worker-protocol.ts');

// A controlled pre-fracture state makes a release occur inside the rejected tick.
function primed(substepForces){const m=new GlassModel();m.substepForces=substepForces;m.impactAt=0;m.severity=2.4;m.frame.time=.17;return m;}
function state(m){
  return {frame:m.snapshot(),released:m.released,impactAt:m.impactAt,severity:m.severity,hitCount:m.hitCount,lastImpact:m.lastImpact,sweepCount:m.sweepCount,unresolvedSweeps:m.unresolvedSweeps,
    bodies:m.collisionWorld.bodies.map(b=>({position:[...b.position],rotation:[...b.rotation],velocity:[...b.velocity],angularVelocity:[...b.angularVelocity],dynamic:b.dynamic,collisionEnabled:b.collisionEnabled,friction:b.friction,restitution:b.restitution,pose:structuredClone(b.pose)})),stats:structuredClone(m.collisionWorld.stats),
    impacts:m.collisionWorld.impacts.map(i=>[m.collisionWorld.bodies.indexOf(i.a),m.collisionWorld.bodies.indexOf(i.b),i.speed,i.impulse])};
}
for(const substepForces of [true,false])for(const intervals of [1,3])test(`glass restores fracture, time and pendulum state after a failed ${intervals}-interval step (staged forces ${substepForces})`,()=>{
  const a=primed(substepForces),b=primed(substepForces),before=state(a),provider=a.collisionWorld.contactProvider,forces=a.collisionWorld.externalForces;
  const start=a.frame.time,threshold=start+(intervals===1?0:DT*1.5);let releasedDuringTrial=false,latest=start;
  a.collisionWorld.contactProvider=h=>{
    latest=Math.max(latest,a.frame.time);releasedDuringTrial||=a.frame.damage.some(Boolean);
    if(h>0&&a.frame.time>threshold){const body=a.shardBodies[0],pendulum=a.pendulum;return [{a:pendulum,b:body,normal:[0,0,1],points:[{a:pendulum.position,b:body.position,gap:1}],poseA:pendulum.pose,poseB:body.pose,time:0,iterations:48,converged:false}];}
    return provider(h);
  };
  assert.throws(()=>a.step(DT*intervals),e=>e instanceof ContactResolutionError);
  assert.ok(releasedDuringTrial);if(intervals>1)assert.ok(latest>=start+DT*2-1e-15);
  assert.deepEqual(state(a),before);assert.equal(a.collisionWorld.externalForces,forces);
  a.collisionWorld.contactProvider=provider;a.step(DT*intervals);b.step(DT*intervals);
  assert.deepEqual(state(a),state(b));assert.ok(a.frame.damage.some(Boolean));
});

test('the worker reports collision rejection without publishing a failed frame and resets cleanly',()=>{
  const handle=glassWorkerHandler(),settings={size:24,load:25,rate:.4};
  const first=handle({type:'reset',generation:0,settings}),originalStep=GlassModel.prototype.step;let attempted;
  try{
    GlassModel.prototype.step=function(dt){
      attempted=this;const provider=this.collisionWorld.contactProvider;
      this.collisionWorld.contactProvider=h=>{
        if(!h)return provider(h);const a=this.pendulum,b=this.shardBodies[0];
        return [{a,b,normal:[0,0,1],points:[{a:a.position,b:b.position,gap:1}],poseA:a.pose,poseB:b.pose,time:0,iterations:48,converged:false}];
      };
      try{return originalStep.call(this,dt);}finally{this.collisionWorld.contactProvider=provider;}
    };
    const rejected=handle({type:'step',generation:0,request:1,ticks:1,release:false});
    assert.equal(rejected.type,'error');assert.match(rejected.message,/Collision sweep.*rolled back/);assert.equal('frame' in rejected,false);
    assert.deepEqual(attempted.snapshot(),first.frame);
  }finally{GlassModel.prototype.step=originalStep;}
  const fresh=handle({type:'reset',generation:1,settings});assert.equal(fresh.type,'frame');assert.equal(fresh.frame.time,0);
  const next=handle({type:'step',generation:1,request:1,ticks:1,release:false}),direct=new GlassModel(settings);direct.step();
  assert.equal(next.type,'frame');assert.deepEqual(next.frame,direct.snapshot());
});
