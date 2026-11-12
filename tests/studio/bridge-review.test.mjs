// Inspect of the Studio's bridge study on the SI suspension model: hanger inspection, milestones, baselines and the
// first-failure pause, with readings in mm and kN.
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {FailureSimulation,STUDIO_SCALED_CHECKPOINT_BACKEND,STUDIO_SI_BRIDGE_BACKEND}=await import('../../src/studio/physics.ts');
const {SiBridgeStudy}=await import('../../src/studio/si-bridge-study.ts');
const {createStudioRuntime,cloneStudioSnapshot}=await import('../../src/engine/studio-runtime.ts');
const {bridgeInspection,bridgePoint,bridgeZone,bridgeZoneTarget,bridgeModelKey,bridgeMilestones,bridgeSampleIndex,bridgeComparison,parseBridgeBaseline,shouldPauseBridge}=await import('../../src/studio/bridge-review.ts');
const make=()=>new SiBridgeStudy();
const point=(time,drop=0,broken=0)=>({time,drop,broken,load:1,lateral:0,hanger:4.5});
const settings={target:2,strength:1,wind:.5,program:'failure',speed:1};
const baseline=model=>({format:'box3d-bridge-baseline',version:2,name:'Crowd / one hanger cut',savedAt:'2026-11-12T10:00:00.000Z',model:bridgeModelKey(model),settings,changes:[{time:0,...settings}],points:[point(0),point(.1,4)],historyComplete:true});
const hangerLink=(model,station,side)=>model.links.findIndex(l=>l.kind==='hanger'&&l.a===station*4+side);

test('the inspection counts the 70 SI hangers and reports the main cables and girders',()=>{
  const model=make(),report=bridgeInspection(model,model.snapshot(),null);
  assert.deepEqual(report.groups.map(g=>[g.kind,g.total,g.broken]),[['hanger',70,0],['cable',72,0],['backstay',4,0],['deck',72,0]]);
  assert.equal(report.zones.reduce((a,z)=>a+z.total,0),70);
  assert.equal(bridgeZone(-21),0);assert.equal(bridgeZone(21),5);
  for(let zone=0;zone<6;zone++)assert.equal(bridgeInspection(model,model.snapshot(),zone).groups[0].total,report.zones[zone].total);
  // Dead load: the midspan hanger carries one panel of deck (4.46 kN), the main cable 167 kN at the backstay.
  assert.ok(Math.abs(report.groups[0].peak-5.06)<.05,`largest hanger ${report.groups[0].peak} kN`);assert.ok(Math.abs(report.groups[1].peak-166.7)<.5);
});
test('the inspection reads the snapshot mask, including backward replay, not the live model',()=>{
  const model=make(),initial=model.snapshot(),damaged=model.snapshot();
  for(const [station,side] of [[18,0],[17,0],[5,1]])damaged.broken[hangerLink(model,station,side)]=1;
  damaged.si.hangersFailed=3;
  const report=bridgeInspection(model,damaged,null);
  assert.equal(report.point.broken,3);assert.equal(report.groups[0].broken,3);assert.equal(report.zones.reduce((n,z)=>n+z.broken,0),3);
  assert.equal(bridgeInspection(model,initial,null).point.broken,0);assert.equal(model.model.failed.length,0);
});
test('readings are in SI: drop and lateral movement in mm from the model, hanger tension in kN',()=>{
  const model=make();model.targetLoad=2;model.wind=1;for(let i=0;i<600;i++)model.step();
  const snap=model.snapshot(),p=bridgePoint(model,snap),out=model.model.out;
  assert.equal(p.drop,snap.si.drop);assert.ok(Math.abs(p.drop-1e3*Math.max(...Array.from(out.deckDeflection,v=>-v)))<1e-9);
  assert.ok(Math.abs(snap.si.midspan+1e3*out.midspanDeflection)<1e-9);assert.ok(Math.abs(p.hanger-out.maxHangerTension/1e3)<1e-9);
  assert.ok(p.lateral>0&&p.lateral<100,`lateral ${p.lateral} mm`);assert.equal(snap.si.crowd,2);assert.equal(snap.si.wind,1);
  assert.equal(snap.response.deflection,p.drop/1e3);
});
test('lateral movement and the zone camera target follow current deck positions, excluding cables',()=>{
  const model=make(),frame=model.snapshot(),i=18*4;
  frame.positions[i*3+2]+=.0025;frame.positions[(i+2)*3+2]+=.04;
  const initial=bridgeZoneTarget(model,model.snapshot(),3),moved=bridgeZoneTarget(model,frame,3);
  assert.ok(moved[2]>initial[2]);assert.ok(moved[2]<.01);
});
test('the first failure resolves to a real sample after the event; before it the bridge is intact',()=>{
  const points=[point(0),point(.1,2),point(.2,5,2),point(.3,3,3)];
  const events=[{time:.158333,type:'break',message:'Hanger U18 cut',connection:0}];
  const milestones=bridgeMilestones(points,events,true);
  assert.deepEqual(milestones.map(m=>[m.key,m.sampleTime]),[['before',.1],['first',.2],['peak',.2],['latest',.3]]);
  assert.equal(milestones[1].time,.158333);assert.equal(milestones[1].index,2);
  assert.equal(milestones[2].detail,'5.0 mm');assert.equal(milestones[3].detail,'3 of 70 hangers failed');
});
test('milestone and baseline matching refuse an evicted initial-to-recent gap',()=>{
  const points=[point(0),point(60,20,10),point(60.1,22,10)];
  const events=[{time:1,type:'break',message:'Hanger U18 cut',connection:0}];
  const first=bridgeMilestones(points,events,false).find(m=>m.key==='first');
  assert.equal(first.index,-1);assert.equal(first.sampleTime,undefined);
  assert.equal(bridgeSampleIndex(points,1),-1);assert.equal(bridgeComparison(points,1),undefined);
  assert.equal(bridgeMilestones(points,events,false).find(m=>m.key==='peak').detail,'22.0 mm · retained history');
});
test('comparison uses a nearby actual time and does not extrapolate past a saved run',()=>{
  const points=[point(0),point(.1,2),point(.2,3)];
  assert.equal(bridgeComparison(points,.14),points[1]);assert.equal(bridgeComparison(points,.21),undefined);assert.equal(bridgeComparison(points,-.01),undefined);
});
test('a saved baseline roundtrips; corrupt, nonfinite, oversized, old or incompatible data is rejected',()=>{
  const model=make(),b=baseline(model),key=b.model;
  assert.deepEqual(parseBridgeBaseline(JSON.stringify(b),key),b);
  for(const raw of ['{',null,'x'.repeat(500001),JSON.stringify({...b,model:'different'}),JSON.stringify({...b,version:1}),JSON.stringify({...b,settings:{...settings,wind:-1}}),JSON.stringify({...b,settings:{...settings,strength:1.5}}),JSON.stringify({...b,settings:{...settings,strength:7}}),JSON.stringify({...b,points:[point(0),point(0)]}),JSON.stringify({...b,points:[point(0),point(.1,Infinity)]}),JSON.stringify({...b,points:[point(0),point(.1,0,71)]}),JSON.stringify({...b,points:[point(0),{...point(.1),hanger:undefined}]}),JSON.stringify({...b,changes:[{...settings,time:0,strength:9}]})])assert.equal(parseBridgeBaseline(raw,key),undefined);
});
test('the model key is stable across damage and separates the SI model from the authored one',()=>{
  const model=make(),key=bridgeModelKey(model);
  assert.match(key,new RegExp(STUDIO_SI_BRIDGE_BACKEND));
  model.cuts=2;model.step();assert.equal(model.model.failed.length,2);assert.equal(bridgeModelKey(model),key);
  assert.notEqual(bridgeModelKey(new FailureSimulation('bridge',undefined,STUDIO_SCALED_CHECKPOINT_BACKEND)),key);
});
test('the first-failure pause fires once when a returned worker batch first contains a failed hanger',()=>{
  const runtime=createStudioRuntime({study:'bridge',backend:STUDIO_SI_BRIDGE_BACKEND,controls:{targetLoad:1,wind:0}});
  const initial=runtime.inspect();let before=cloneStudioSnapshot(initial.liveSnapshot);initial.release();
  let paused=false;
  try{
    for(let batch=0;batch<20&&!paused;batch++){
      const commands=batch===5?[{tick:runtime.tick+1,type:'controls',values:{cuts:1}}]:[];
      const result=runtime.step({ticks:12,commands}),after=cloneStudioSnapshot(result.liveSnapshot);
      if(shouldPauseBridge(true,before,after)){
        const first=result.eventDelta.find(e=>e.type==='break');assert.ok(first);assert.match(first.message,/Hanger U18 cut/);
        assert.ok(after.response.time-first.time<=.1+1e-8);assert.equal(after.response.broken,1);assert.equal(after.si.hangersFailed,1);
        assert.equal(shouldPauseBridge(false,before,after),false);paused=true;
      }
      result.release();before=after;
    }
    assert.ok(paused,'the cut is reported');
    const resumed=runtime.step({ticks:12});assert.equal(shouldPauseBridge(true,before,resumed.liveSnapshot),false);resumed.release();
  }finally{runtime.destroy();}
});
test('the SI study has no resumable checkpoint and says so',()=>{
  const runtime=createStudioRuntime({study:'bridge',backend:STUDIO_SI_BRIDGE_BACKEND});
  try{assert.throws(()=>runtime.exportCheckpoint(),/no resumable checkpoint/);assert.equal(runtime.capabilities.checkpoint,false);assert.equal(runtime.capabilities.models[0].calibration,'uncalibrated-physical');}
  finally{runtime.destroy();}
  assert.throws(()=>createStudioRuntime({study:'canopy',backend:STUDIO_SI_BRIDGE_BACKEND}),/bridge study/);
});
