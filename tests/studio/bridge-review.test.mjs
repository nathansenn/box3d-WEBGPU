import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {FailureSimulation,STUDIO_SCALED_CHECKPOINT_BACKEND}=await import('../../src/studio/physics.ts');
const {createStudioRuntime,cloneStudioSnapshot}=await import('../../src/engine/studio-runtime.ts');
const {bridgeInspection,bridgePoint,bridgeZone,bridgeZoneTarget,bridgeModelKey,bridgeMilestones,bridgeSampleIndex,bridgeComparison,parseBridgeBaseline,shouldPauseBridge}=await import('../../src/studio/bridge-review.ts');
const make=()=>new FailureSimulation('bridge',undefined,STUDIO_SCALED_CHECKPOINT_BACKEND);
const point=(time,drop=0,broken=0)=>({time,drop,broken,load:1,lateral:0});
const settings={target:5,strength:1.6,wind:2,program:'failure',speed:1};
const baseline=()=>({format:'box3d-bridge-baseline',version:1,name:'Overload / wind',savedAt:'2026-09-13T10:00:00.000Z',model:bridgeModelKey(make()),settings,changes:[{time:0,...settings}],points:[point(0),point(.1,.4)],historyComplete:true});

test('connection groups and six span zones partition all 327 modeled links',()=>{
  const model=make(),report=bridgeInspection(model,model.snapshot(),null);
  assert.deepEqual(report.groups.map(g=>[g.kind,g.total]),[['cable',72],['hanger',74],['deck',72],['crossbeam',37],['shear',72]]);
  assert.equal(report.zones.reduce((a,z)=>a+z.total,0),327);
  assert.equal(bridgeZone(-21),0);assert.equal(bridgeZone(21),5);
  for(let zone=0;zone<6;zone++)assert.equal(bridgeInspection(model,model.snapshot(),zone).groups.reduce((a,g)=>a+g.total,0),report.zones[zone].total);
});
test('inspection reads the snapshot mask, including backward replay, instead of stale main-thread flags',()=>{
  const model=make(),initial=model.snapshot(),damaged=model.snapshot();
  [2,10,27,125,324].forEach(i=>damaged.broken[i]=1);
  const report=bridgeInspection(model,damaged,null);
  assert.equal(report.point.broken,5);assert.equal(report.groups.reduce((n,g)=>n+g.broken,0),5);assert.equal(report.zones.reduce((n,g)=>n+g.broken,0),5);
  assert.equal(model.links.filter(l=>l.broken).length,0);assert.equal(bridgeInspection(model,initial,null).point.broken,0);
});
test('lateral movement and zone camera target follow current deck positions, excluding cables',()=>{
  const model=make(),frame=model.snapshot(),i=18*4;
  frame.positions[i*3+2]+=2.5;frame.positions[(i+2)*3+2]+=40;
  assert.ok(Math.abs(bridgePoint(model,frame).lateral-2.5)<1e-5);
  const initial=bridgeZoneTarget(model,model.snapshot(),3),moved=bridgeZoneTarget(model,frame,3);
  assert.ok(moved[2]>initial[2]);assert.ok(moved[2]<1);
});
test('first rupture resolves to a real sample after the event; pre-rupture is intact',()=>{
  const points=[point(0),point(.1,.2),point(.2,.5,2),point(.3,.3,3)];
  const events=[{time:.158333,type:'break',message:'Hanger ruptured',connection:0}];
  const milestones=bridgeMilestones(points,events,true);
  assert.deepEqual(milestones.map(m=>[m.key,m.sampleTime]),[['before',.1],['first',.2],['peak',.2],['latest',.3]]);
  assert.equal(milestones[1].time,.158333);assert.equal(milestones[1].index,2);
});
test('milestone and baseline matching refuse an evicted initial-to-recent gap',()=>{
  const points=[point(0),point(60,2,10),point(60.1,2.2,10)];
  const events=[{time:1,type:'break',message:'Hanger ruptured',connection:0}];
  const first=bridgeMilestones(points,events,false).find(m=>m.key==='first');
  assert.equal(first.index,-1);assert.equal(first.sampleTime,undefined);
  assert.equal(bridgeSampleIndex(points,1),-1);assert.equal(bridgeComparison(points,1),undefined);
  assert.equal(bridgeMilestones(points,events,false).find(m=>m.key==='peak').detail,'2.200 model units · retained history');
});
test('comparison uses a nearby actual time and does not extrapolate past a saved run',()=>{
  const points=[point(0),point(.1,.2),point(.2,.3)];
  assert.equal(bridgeComparison(points,.14),points[1]);
  assert.equal(bridgeComparison(points,.21),undefined);assert.equal(bridgeComparison(points,-.01),undefined);
});
test('imported damaged history does not claim it captured the first rupture',()=>{
  const m=bridgeMilestones([point(5,2,12),point(5.1,2,12)],[],false)[0];
  assert.equal(m.key,'unknown');assert.equal(m.index,-1);assert.equal(m.sampleTime,undefined);
});
test('saved baseline roundtrips with its settings and complete response series',()=>{
  const b=baseline();assert.deepEqual(parseBridgeBaseline(JSON.stringify(b),b.model),b);
});
test('storage validation rejects corrupt, nonfinite, oversized and incompatible data',()=>{
  const valid=baseline(),key=valid.model;
  for(const raw of ['{',null,'x'.repeat(500001),JSON.stringify({...valid,model:'different'}),JSON.stringify({...valid,version:2}),JSON.stringify({...valid,settings:{...settings,wind:-1}}),JSON.stringify({...valid,points:[point(0),point(0)]}),JSON.stringify({...valid,points:[point(0),point(.1,Infinity)]}),JSON.stringify({...valid,points:[point(0),point(.1,0,328)]}),JSON.stringify({...valid,changes:[{...settings,time:0,strength:9}]})])assert.equal(parseBridgeBaseline(raw,key),undefined);
});
test('model compatibility stays stable across damage but detects changed topology or backend',()=>{
  const model=make(),key=bridgeModelKey(model);model.links[0].broken=true;assert.equal(bridgeModelKey(model),key);
  model.links[0].threshold*=2;assert.notEqual(bridgeModelKey(model),key);
  assert.notEqual(bridgeModelKey(new FailureSimulation('bridge')),key);
});
test('first-rupture pause fires once when a returned worker batch first contains failures',()=>{
  const runtime=createStudioRuntime({study:'bridge',backend:STUDIO_SCALED_CHECKPOINT_BACKEND,controls:{targetLoad:5,strength:.4,wind:2}});
  const initial=runtime.inspect();let before=cloneStudioSnapshot(initial.liveSnapshot);initial.release();
  let paused=false;
  try{
    for(let batch=0;batch<300&&!paused;batch++){
      const result=runtime.step({ticks:12}),after=cloneStudioSnapshot(result.liveSnapshot);
      if(shouldPauseBridge(true,before,after)){
        const first=result.eventDelta.find(e=>e.type==='break');assert.ok(first);
        assert.ok(after.response.time-first.time<=.1+1e-8);assert.ok(after.response.broken>0);
        assert.equal(shouldPauseBridge(false,before,after),false);paused=true;
      }
      result.release();before=after;
    }
    assert.ok(paused,'actual solver reaches rupture');
    const resumed=runtime.step({ticks:12});assert.equal(shouldPauseBridge(true,before,resumed.liveSnapshot),false);resumed.release();
  }finally{runtime.destroy();}
});
