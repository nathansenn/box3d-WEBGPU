import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){
  if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){
    const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);
  }return next(s,c);
}});
const {LAB_IDS,LABS,normalizeSettings,readSettings,writeSettings}=await import('../../src/studio/material-labs/catalog.ts');
const {MAX_SAVED_RUNS,MAX_TRACE_SAMPLES,RUN_STORAGE_KEY,createSavedRun,readRunLibrary,storeRun,removeRun,compatibleRuns,comparisonExport}=await import('../../src/studio/material-labs/run-library.ts');
const storage=()=>({data:new Map(),getItem(key){return this.data.get(key)??null;},setItem(key,value){this.data.set(key,value);}});
const frames=()=>[{time:0,metrics:[.65,0,3.04]},{time:1,metrics:[.5,1.2,3.04]},{time:2,metrics:[.4,.8,3.04]}];
const draft=(study='liquid')=>({study,name:'Baseline',experiment:LABS[study].experiments[0].id,settings:normalizeSettings(study),metricLabels:['Depth · m','Speed · m/s','Volume · m³'],complete:false,phase:'Settling',events:[],frames:frames()});
const run=(id='run-a',study='liquid')=>createSavedRun(draft(study),{id,savedAt:'2026-09-11T01:00:00.000Z'});

test('all five lab setups survive persistence and URL loading without losing settings',()=>{
  const db=storage();
  for(const study of LAB_IDS){const r=run(study,study);r.settings=normalizeSettings(study,{...r.settings,...LABS[study].experiments[2].settings,seed:753});assert.equal(storeRun(db,r).ok,true);}
  const saved=readRunLibrary(db);assert.equal(saved.runs.length,5);
  for(const r of saved.runs)assert.deepEqual(readSettings(r.study,new URLSearchParams(writeSettings(r.study,r.settings,r.experiment))),r.settings);
});
test('saved measurements detach from mutable solver buffers, retain final snapshots and release events',()=>{
  const d=draft();d.frames.push({time:2,metrics:[.35,.7,3.04]});d.events.push({action:'release',time:1.7});
  const result=createSavedRun(d,{id:'copy',savedAt:'2026-09-11'});d.frames.at(-1).metrics[0]=999;d.events[0].time=99;d.settings.load=10;
  assert.equal(result.samples.length,3);assert.deepEqual(result.final,[.35,.7,3.04]);assert.equal(result.events[0].time,1.7);assert.equal(result.settings.load,100);
});
test('long recordings stay bounded, preserve end time and extrema from unsampled measurements',()=>{
  const d=draft();d.frames=Array.from({length:1500},(_,i)=>({time:i/20,metrics:[i===501?100:1,Math.sin(i),3]}));
  const result=createSavedRun(d,{id:'long',savedAt:'2026-09-11'});
  assert.equal(result.samples.length,MAX_TRACE_SAMPLES);assert.equal(result.samples[0].time,0);assert.equal(result.samples.at(-1).time,74.95);assert.equal(result.maximum[0],100);assert.equal(result.duration,74.95);
});
test('empty, nonfinite and backwards recordings cannot create plausible looking results',()=>{
  for(const bad of [[],[{time:0,metrics:[0,0,0]}],[{time:0,metrics:[0,0,0]},{time:1,metrics:[NaN,1,2]}],[{time:2,metrics:[0,0,0]},{time:1,metrics:[0,1,2]}]])assert.throws(()=>createSavedRun({...draft(),frames:bad},{id:'bad',savedAt:'2026-09-11'}));
});
test('a full library preserves existing results, and removal plus undo works',()=>{
  const db=storage();for(let i=0;i<MAX_SAVED_RUNS;i++)assert.equal(storeRun(db,run('run-'+i)).ok,true);
  const original=db.getItem(RUN_STORAGE_KEY);assert.equal(storeRun(db,run('overflow')).ok,false);assert.equal(db.getItem(RUN_STORAGE_KEY),original);
  assert.equal(removeRun(db,'run-4').ok,true);assert.equal(storeRun(db,run('run-4')).ok,true);assert.equal(readRunLibrary(db).runs.length,MAX_SAVED_RUNS);
});
test('separate callers read the latest library before saving or removing',()=>{
  const db=storage();storeRun(db,run('first'));readRunLibrary(db);storeRun(db,run('second'));storeRun(db,run('third'));removeRun(db,'second');
  assert.deepEqual(readRunLibrary(db).runs.map(r=>r.id),['third','first']);
});
test('storage denial and unsupported versions report failure without overwriting data',()=>{
  const blocked={getItem(){throw new Error('denied');},setItem(){throw new Error('denied');}};
  assert.equal(readRunLibrary(blocked).writable,false);assert.equal(storeRun(blocked,run()).ok,false);
  const db=storage();db.setItem(RUN_STORAGE_KEY,'{"version":2,"runs":[]}');const before=db.getItem(RUN_STORAGE_KEY);assert.equal(storeRun(db,run()).ok,false);assert.equal(db.getItem(RUN_STORAGE_KEY),before);
  const quota={getItem(){return null;},setItem(){throw new Error('quota');}};assert.equal(storeRun(quota,run()).ok,false);
});
test('corrupt records, duplicate identities and invalid measurements are rejected independently',()=>{
  const good=run(),negative=run('negative'),bad=run('bad'),wrong=run('wrong');negative.samples[0].time=-1;bad.final[0]=999;wrong.settings.material='missing';
  const db=storage();db.setItem(RUN_STORAGE_KEY,JSON.stringify({version:1,runs:[good,negative,bad,wrong,good]}));const state=readRunLibrary(db);
  assert.deepEqual(state.runs.map(r=>r.id),['run-a']);assert.ok(state.warning);
});
test('comparison exports original time axes and refuses unlike studies or metric definitions',()=>{
  const a=run(),b=run('run-b');b.duration=1;b.samples=b.samples.slice(0,2);b.final=[...b.samples.at(-1).metrics];
  const exported=comparisonExport([a,b]);assert.equal(exported.calibrated,false);assert.deepEqual(exported.runs.map(r=>r.duration),[2,1]);
  assert.equal(compatibleRuns(a,run('glass','glass')),false);assert.throws(()=>comparisonExport([a,run('glass','glass')]));
  b.metricLabels[0]='Different metric';assert.equal(compatibleRuns(a,b),false);assert.throws(()=>comparisonExport([a]));
});
