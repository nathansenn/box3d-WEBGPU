import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,writeFileSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {LABS,normalizeSettings,readSettings,writeSettings}=await import('../../src/studio/material-labs/catalog.ts');
const {LiquidModel,DT,METRIC_LABELS}=await import('../../src/studio/material-labs/models.ts');
const {measureSection,measurementSample,recordedSamples,measurementCsv,studyParameters,suggestedValues,studyCases,runStudyCase}=await import('../../src/studio/material-labs/liquid-analysis.ts');
const {createSavedRun,storeRun,readRunLibrary,RUN_STORAGE_KEY}=await import('../../src/studio/material-labs/run-library.ts');
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<e,`${a} versus ${b}`);
const run=(m,t,dt=DT)=>{while(m.frame.time<t-1e-9)m.step(Math.min(dt,t-m.frame.time));return m;};
const finish=(generator)=>{let s=generator.next();while(!s.done)s=generator.next();return s.value;};
const receipt=[];
test('section measurement integrates the recorded velocity and depth with signed flow',()=>{
  const m=new LiquidModel({rig:'rain',rain:0,fill:0});m.frame.positions.fill(.05);for(let i=0;i<m.h.length;i++){m.frame.rotations[i*2]=-2;m.frame.rotations[i*2+1]=1;}
  const s=measureSection(m,m.frame,3);close(s.flow,-.2);assert.equal(s.cells.length,28);assert.equal(s.probes.length,3);close(s.probes[1].speed,Math.sqrt(5));close(s.distance,3+m.dx/2);assert.equal(s.column,42);
  m.h.fill(1);close(measureSection(m,m.frame,3).flow,-.2); // never reads unrecorded model.h
  assert.equal(measureSection(m,m.frame,-20).column,0);assert.equal(measureSection(m,m.frame,20).column,83);assert.equal(measureSection(m,m.frame,NaN).column,42);
});
test('solid probes are distinct from dry cells and excluded from discharge',()=>{
  const m=new LiquidModel({rig:'river'});m.frame.positions.fill(.1);m.frame.rotations.fill(1);const s=measureSection(m,m.frame,3.25);
  assert.ok(s.probes[1].blocked);assert.ok(s.flow<.2);const dry=new LiquidModel({rig:'rain',fill:0});const d=measureSection(dry,dry.frame,3);assert.equal(d.flow,0);assert.equal(d.probes[1].blocked,false);assert.equal(d.probes[1].depth,0);
});
test('timing normalizes and round-trips while old saved runs gain safe defaults',()=>{
  const p=normalizeSettings('liquid',{rig:'rain',runSeconds:37.5,cutoff:7.123});assert.deepEqual(readSettings('liquid',new URLSearchParams(writeSettings('liquid',p))),p);
  assert.equal(normalizeSettings('liquid',{runSeconds:Infinity}).runSeconds,18);assert.equal(normalizeSettings('liquid',{runSeconds:100}).runSeconds,60);assert.equal(normalizeSettings('liquid',{cutoff:-1}).cutoff,0);
  const m=run(new LiquidModel({rig:'rain',rain:50}),.1),saved=createSavedRun({study:'liquid',name:'Legacy timing',experiment:'',settings:m.settings,metricLabels:METRIC_LABELS.liquid,frames:[{time:0,metrics:[0,0,0]},m.frame],complete:false,phase:m.frame.phase,events:[]},{id:'legacy-v4',savedAt:'2026-09-12T00:00:00Z'});
  delete saved.settings.runSeconds;delete saved.settings.cutoff;const storage={getItem:()=>JSON.stringify({version:1,runs:[saved]}),setItem(){}};
  const state=readRunLibrary(storage);assert.equal(state.runs.length,1);assert.equal(state.runs[0].settings.runSeconds,18);assert.equal(state.runs[0].settings.cutoff,0);
});
for(const dt of [DT,.037,.25])test(`cutoff splits crossing steps exactly at 0.123 s, dt ${dt}`,()=>{
  const m=run(new LiquidModel({rig:'pipes',surface:'glass',fill:0,rain:150,inflow:10,bore:180,drain:0,cutoff:.123}),1,dt),h=m.frame.hydraulics;
  close(h.added,m.delivery.flow*.123,1e-11);const area=[...m.solid].filter(v=>!v).length*m.dx*m.dz;close(h.rained,area*.15/3600*.123,1e-11);assert.equal(h.supplyOn,false);assert.equal(h.inlet,0);assert.equal(h.rainRate,0);close(h.residual,0);
});
test('after cutoff the recorded source stays off while a wet inclined bed drains',()=>{
  const m=run(new LiquidModel({rig:'surface',surface:'glass',fill:20,slope:4,cutoff:1,rain:120,drain:100}),1),before=m.snapshot();run(m,4);
  assert.equal(m.frame.hydraulics.added,before.hydraulics.added);assert.equal(m.frame.hydraulics.rained,before.hydraulics.rained);assert.ok(m.frame.hydraulics.drained>before.hydraulics.drained);assert.equal(before.hydraulics.supplyOn,false);
});
test('zero cutoff leaves supply running and a flume ignores supply cutoff',()=>{
  const p=run(new LiquidModel({rig:'pipes',cutoff:0}),1);assert.ok(p.frame.hydraulics.supplyOn);close(p.frame.hydraulics.added,p.delivery.flow);
  const a=run(new LiquidModel({rig:'flume',cutoff:.5}),1),b=run(new LiquidModel({rig:'flume',cutoff:0}),1);assert.deepEqual(a.frame,b.frame);
});
test('every preset offers three distinct bounded values including its current value',()=>{
  for(const preset of LABS.liquid.experiments){const p=normalizeSettings('liquid',preset.settings);for(const parameter of studyParameters(p)){const values=suggestedValues(p,parameter);assert.ok(values.includes(p[parameter.key]),`${preset.id} ${parameter.key}`);const cases=studyCases(p,parameter,values);assert.equal(new Set(cases.map(c=>c[parameter.key])).size,3);for(const c of cases)for(const key of Object.keys(p))if(key!==parameter.key)assert.equal(c[key],p[key]);}}
  const p=normalizeSettings('liquid',{rig:'pipes'}),key=studyParameters(p)[0];for(const v of [[20,20,40],[NaN,30,40],[0,30,40],[20,30]])assert.throws(()=>studyCases(p,key,v));
  assert.equal(studyParameters(normalizeSettings('liquid',{rig:'rain'})).find(p=>p.key==='fill').unit,'mm');
});
test('worker cases agree with the live solver and serialize actual measurements',()=>{
  const base=normalizeSettings('liquid',{rig:'rain',surface:'glass',terrain:'flat',fill:0,rain:100,drain:0,runSeconds:6,cutoff:2.35}),key=studyParameters(base).find(p=>p.key==='rain');
  const cases=studyCases(base,key,[50,100,150]),results=cases.map((c,i)=>finish(runStudyCase(c,i,key.key,3)));
  for(const r of results){const live=run(new LiquidModel(r.settings),6),last=r.samples.at(-1);assert.deepEqual(last.metrics,live.frame.metrics);assert.deepEqual(last.hydraulics,live.frame.hydraulics);assert.equal(r.samples[0].time,0);close(last.time,6);assert.ok(r.samples.length<=302);assert.ok(r.peak.depth>=last.metrics[0]);close(last.hydraulics.rained,12*r.value/1000/3600*2.35);for(let i=1;i<r.samples.length;i++)assert.ok(r.samples[i].time>r.samples[i-1].time);}
  close(results[2].samples.at(-1).metrics[2],results[0].samples.at(-1).metrics[2]*3);
  const csv=measurementCsv(results,key);assert.ok(csv.includes('"section_flow_m3_s"'));assert.ok(csv.includes('"settings_json"'));assert.ok(csv.includes('""cutoff"":2.35'));assert.equal(csv.trim().split('\r\n').length,1+results.reduce((n,r)=>n+r.samples.length,0));
  const storage={data:null,getItem(){return this.data},setItem(k,v){assert.equal(k,RUN_STORAGE_KEY);this.data=v}};
  const r=results[1],saved=createSavedRun({study:'liquid',name:'Measured comparison',experiment:'',settings:r.settings,metricLabels:METRIC_LABELS.liquid,complete:true,phase:r.phase,events:[],frames:r.samples},{id:'case-v4',savedAt:'2026-09-12T00:00:00Z'});
  assert.equal(storeRun(storage,saved).ok,true);assert.equal(readRunLibrary(storage).runs[0].settings.cutoff,2.35);receipt.push({case:'rain-study',results});
});
test('sixty-second studies bound retained samples and reach the exact requested endpoint',()=>{
  const r=finish(runStudyCase(normalizeSettings('liquid',{rig:'surface',surface:'glass',fill:1,inflow:0,drain:0,runSeconds:60}),0,'fill',5.99));
  assert.ok(r.samples.length<=302);close(r.samples.at(-1).time,60);close(r.samples.at(-1).metrics[2],.012);close(r.section,6-6/84/2);assert.ok(r.peak.balanceError<1e-8);receipt.push({case:'60-second-program',samples:r.samples.length,end:r.samples.at(-1).time,balance:r.peak.balanceError});
});
test('recording export keeps endpoints and deduplicates repeated final frames',()=>{
  const m=new LiquidModel({rig:'rain',rain:100,fill:0}),zero=m.snapshot();m.step();const first=m.snapshot();m.step();const second=m.snapshot(),samples=recordedSamples(m,[zero,first,second,second],3);assert.equal(samples.length,3);assert.equal(samples[0].time,0);assert.equal(samples.at(-1).time,second.time);m.step();assert.equal(samples.at(-1).time,second.time);assert.throws(()=>measurementSample(m,{...first,hydraulics:undefined},3));
});
after(()=>{if(process.env.LIQUID_V4_QA_OUTPUT)writeFileSync(process.env.LIQUID_V4_QA_OUTPUT,JSON.stringify({at:new Date().toISOString(),receipt},null,2)+'\n');});
