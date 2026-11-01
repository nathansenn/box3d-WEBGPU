import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Euler,Matrix4,Quaternion,Vector3} from 'three';
const {GlassModel,DT}=await import('../../src/studio/material-labs/models.ts');
const {GLASS_RIG,glassBobPosition,glassFixtures}=await import('../../src/studio/material-labs/glass-rig.ts');
const {convexSeparation}=await import('../../src/engine/convex-contact.ts');
const close=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const run=(m,seconds)=>{for(let i=0;i<Math.round(seconds/DT);i++)m.step();return m;};

test('glass thick panel catches every return swing and settles at the rendered sphere surface',()=>{
  for(const fill of [0,65])for(const dt of [DT,1/30]){
    const m=new GlassModel({size:24,load:25,rate:.4,fill});let minGap=Infinity;
    for(let i=0;i<Math.round(12/dt);i++){
      m.step(dt);const bob=glassBobPosition(m.frame.actuator,m.impactX),gap=bob[2]-GLASS_RIG.bobRadius-m.settings.size/2000;
      minGap=Math.min(minGap,gap);assert.ok(gap>=-2e-5,`pendulum crossed an intact pane: ${gap}`);
    }
    assert.equal(m.frame.metrics[1],0);assert.ok(m.frame.collisions.impacts>=3);assert.ok(minGap<3e-5);assert.equal(m.frame.collisions.unresolvedSweeps,0);
    const finalGap=glassBobPosition(m.frame.actuator,m.impactX)[2]-GLASS_RIG.bobRadius-.012;assert.ok(finalGap>=0&&finalGap<2e-5);
  }
});

test('glass contact surfaces share pane thickness, fixture dimensions and visible shard orientation',()=>{
  const m=run(new GlassModel(),1.2),fixtures=glassFixtures(.008);
  assert.equal(m.collisionWorld.bodies.length,m.pieces.length+fixtures.length+2);
  fixtures.forEach((f,i)=>{const b=m.collisionWorld.bodies[m.pieces.length+i];for(let k=0;k<3;k++){close(b.pose.max[k]-b.pose.min[k],f.size[k]);close(b.position[k],f.position[k]);}});
  for(let i=0;i<m.pieces.length;i++){
    const k=i*3,piece=m.pieces[i],matrix=new Matrix4().compose(new Vector3(...m.frame.positions.subarray(k,k+3)),new Quaternion().setFromEuler(new Euler(...m.frame.rotations.subarray(k,k+3))),new Vector3(1,1,1));
    for(let j=0;j<6;j++){const v=piece.vertices[j%3],drawn=new Vector3(v[0],v[1],j<3?-.004:.004).applyMatrix4(matrix),physics=m.shardBodies[i].pose.vertices[j];drawn.toArray().forEach((x,a)=>close(x,physics[a],4e-7));}
  }
});

test('glass contact evolution is deterministic and visual recordings own their contact counters',()=>{
  const a=new GlassModel(),b=new GlassModel();run(a,1.2);run(b,1.2);assert.deepEqual(a.snapshot(),b.snapshot());
  const snapshot=a.snapshot(),saved=structuredClone(snapshot);run(a,.2);assert.deepEqual(snapshot,saved);
  for(const dt of [NaN,Infinity,-1,0,.3]){const before=a.snapshot();assert.throws(()=>a.step(dt));assert.deepEqual(a.snapshot(),before);}
});

test('released glass pieces collide and remain separate in the settled tray',()=>{
  const m=new GlassModel();let contacts=0,worst=0;
  for(let i=0;i<480;i++){
    m.step();contacts=Math.max(contacts,m.frame.collisions.contacts);
    assert.equal(m.frame.collisions.unresolvedSweeps,0,`unresolved sweep at tick ${i+1}`);
    assert.ok([...m.frame.positions,...m.frame.rotations,...m.frame.metrics].every(Number.isFinite));
    if(i%30===29)for(const [a,b] of m.collisionWorld.candidates()){
      const gap=convexSeparation(m.collisionWorld.bodies[a].pose,m.collisionWorld.bodies[b].pose,0).gap;worst=Math.max(worst,-gap);
    }
  }
  assert.ok(contacts>100);assert.ok(m.frame.metrics[1]>90);
  assert.ok(worst<.0005,`maximum sampled penetration ${worst} m`);
  for(const b of m.shardBodies)assert.ok(b.pose.min[1]>=-5e-5,`floor penetration ${b.pose.min[1]}`);
});
