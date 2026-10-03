import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {parseReport,validateReport,createReport,readNotebook,saveNotebook,compareAt,defaultReview,limitReading,reportPlot,readableReport,REPORT_FORMAT,NOTEBOOK_KEY,MAX_NOTEBOOK_CHARS,MAX_REPORT_BYTES}=await import('../../src/studio/material-labs/liquid-report.ts');
const {runStudyCase,studyParameters,studyCases}=await import('../../src/studio/material-labs/liquid-analysis.ts');
const {normalizeSettings,LABS}=await import('../../src/studio/material-labs/catalog.ts');
const v4=readFileSync(new URL('../../docs/design/liquid-lab-v4-20260912/native-comparison.json',import.meta.url),'utf8');
const original=parseReport(v4),clone=()=>structuredClone(original),entry=(id,report=clone())=>({id,savedAt:'2026-09-12T16:00:00Z',report});
const storage=()=>({text:null,writes:0,getItem(k){assert.equal(k,NOTEBOOK_KEY);return this.text;},setItem(k,v){assert.equal(k,NOTEBOOK_KEY);this.text=v;this.writes++;}});
const close=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} vs ${b}`);
const finish=g=>{let s=g.next();while(!s.done)s=g.next();return s.value;};
test('the actual V4 download imports with original measurements and safe V5 review defaults',()=>{
  const source=JSON.parse(v4);assert.equal(original.format,REPORT_FORMAT);assert.equal(original.title,'Bank height study');assert.equal(original.notes,'');assert.equal(original.review.baseline,1);assert.deepEqual(original.results,source.results);assert.equal(original.complete,true);
  assert.deepEqual(parseReport(JSON.stringify(original)),original);
});
test('baseline comparison uses actual samples and explicit units at a shared time',()=>{
  const r=clone();r.review.time=5.03;r.review.baseline=1;r.review.metric='volume';const rows=compareAt(r);
  for(const row of rows){const c=r.results.find(c=>c.index===row.index),s=c.samples.find(s=>s.time===row.time);assert.ok(s);close(row.value,s.metrics[2]*1000);assert.ok(Math.abs(row.time-5.03)<.06);}
  assert.equal(rows[1].delta,0);assert.equal(rows[1].percent,0);close(rows[0].delta,rows[0].value-rows[1].value);close(rows[0].percent,(rows[0].value-rows[1].value)/Math.abs(rows[1].value)*100);
});
test('zero baselines and solid probes never produce infinite or fake changes',()=>{
  const r=clone();r.review.time=0;r.review.metric='flow';assert.ok(compareAt(r).every(v=>v.percent===null&&v.delta===0));
  r.review.metric='depth';r.results[1].samples[0].probes[1].blocked=true;const rows=compareAt(r);assert.equal(rows[1].value,null);assert.ok(rows.every(v=>v.delta===null&&v.percent===null));
});
test('user limits compare full tick maxima with unit conversion, including equality',()=>{
  const r=clone();r.review.limit='depth';r.review.limitValue=330;assert.equal(limitReading(r.results[0],r.review).exceeded,false);assert.equal(limitReading(r.results[2],r.review).exceeded,true);
  r.review.limitValue=r.results[0].peak.depth*1000;assert.equal(limitReading(r.results[0],r.review).exceeded,false);r.review.limitValue=null;assert.equal(limitReading(r.results[0],r.review).exceeded,null);
});
test('notes, baseline, selected time and limits survive save, update and reload',()=>{
  const s=storage(),r=clone();r.title='Eight-second flood surge';r.notes='Low banks start partly flooded.\nCheck the initial water budget.';r.review={baseline:2,time:7.5,metric:'flood',limit:'floodArea',limitValue:1.2};
  assert.equal(saveNotebook(s,entry('first',r)).ok,true);assert.deepEqual(readNotebook(s).entries[0].report,r);const updated=structuredClone(r);updated.notes+=' Updated observation.';assert.equal(saveNotebook(s,entry('first',updated)).ok,true);assert.equal(readNotebook(s).entries.length,1);assert.equal(readNotebook(s).entries[0].report.notes,updated.notes);
});
test('concurrent saves re-read storage and preserve every previous report',()=>{
  const s=storage();saveNotebook(s,entry('one'));const stale=readNotebook(s);saveNotebook(s,entry('two'));assert.equal(stale.entries.length,1);saveNotebook(s,entry('three'));assert.deepEqual(readNotebook(s).entries.map(e=>e.id),['three','two','one']);
});
test('corrupt and duplicate notebook entries cannot be silently overwritten',()=>{
  const s=storage();s.text=JSON.stringify({version:1,entries:[entry('good'),{id:'bad',report:{}}]});const before=s.text,state=readNotebook(s);assert.equal(state.entries.length,1);assert.equal(state.writable,false);assert.equal(saveNotebook(s,entry('new')).ok,false);assert.equal(s.text,before);assert.equal(s.writes,0);
  s.text=JSON.stringify({version:1,entries:[entry('duplicate'),entry('duplicate')]});assert.equal(readNotebook(s).writable,false);
});
test('storage quota and unavailable local storage return actionable errors without losing data',()=>{
  const s=storage();saveNotebook(s,entry('keep'));const text=s.text;s.setItem=()=>{throw new Error('Quota exceeded');};const result=saveNotebook(s,entry('second'));assert.equal(result.ok,false);assert.equal(s.text,text);
  const unavailable={getItem(){throw new Error('disabled')},setItem(){assert.fail('must not write')}};assert.equal(saveNotebook(unavailable,entry('new')).ok,false);
});
test('notebook entry and byte limits refuse extra writes',()=>{
  const s=storage();s.text=JSON.stringify({version:1,entries:Array.from({length:12},(_,i)=>entry('id-'+i))});const before=s.text;assert.equal(saveNotebook(s,entry('extra')).ok,false);assert.equal(s.text,before);
  s.text='x'.repeat(MAX_NOTEBOOK_CHARS+1);assert.equal(readNotebook(s).writable,false);assert.throws(()=>parseReport(' '.repeat(MAX_REPORT_BYTES+1)),/smaller than 4 MB/);
});
test('malformed reports fail before changing the notebook',()=>{
  assert.throws(()=>parseReport('{oops'),/valid JSON/);assert.throws(()=>parseReport('{}'),/Liquid Lab/);
  const mutations=[r=>r.results.push(structuredClone(r.results[0])),r=>r.results[1].value=.2,r=>r.results[1].settings.rain=100,r=>r.results[0].samples.reverse(),r=>r.results[0].samples[5].metrics[2]=-1,r=>r.results[0].peak.depth=0,r=>r.results[0].samples[1].hydraulics.added=999,r=>r.results[0].samples[1].probes[0].z=0,r=>r.results[0].samples[1].hydraulics.supplyOn='yes',r=>r.results[0].section=3,r=>r.results[0].samples[1].hydraulics.coverage=150,r=>r.review.baseline=9,r=>r.review.time=100,r=>r.review.limitValue=-1,r=>r.results[0].samples[1].flow=Infinity];
  for(const mutate of mutations){const r=clone();mutate(r);assert.throws(()=>validateReport(r));}
});
test('readable report escapes user text and has no scripts or remote resource requests',()=>{
  const r=clone();r.title='<script>alert(1)</script>';r.notes='<img src=x onerror=alert(1)> & "quoted"';r.source='An experiment <svg onload=alert(1)>';const html=readableReport(r);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));assert.ok(html.includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(!html.includes('<script'));assert.ok(!html.includes('<img'));assert.ok(!/<[a-z][^>]*\s(?:src|href)=/i.test(html));assert.ok(html.includes('Reproduction settings'));assert.ok(html.includes('Final water budget'));assert.ok(html.includes('@media print'));
});
test('one and two completed cases can be preserved after cancellation',()=>{
  const r=clone();r.results=r.results.slice(0,1);r.review=defaultReview(r.results);const parsed=validateReport(r);assert.equal(parsed.complete,false);assert.equal(parsed.review.baseline,0);assert.deepEqual(parseReport(JSON.stringify(parsed)),parsed);
});
for(const preset of LABS.liquid.experiments)test(`complete preset report: ${preset.id}`,()=>{
  const settings=normalizeSettings('liquid',preset.settings),key=studyParameters(settings)[0],result=finish(runStudyCase(settings,0,key.key,3));
  const report=createReport([result],key,preset.name);assert.equal(report.results[0].samples[0].time,0);close(report.results[0].samples.at(-1).time,18);assert.deepEqual(parseReport(JSON.stringify(report)).results[0].settings,settings);
});
for(const rig of ['flume','pipes','river','rain','surface'])test(`fresh ${rig} worker results import and export without changing their input settings`,()=>{
  const preset=LABS.liquid.experiments.find(e=>e.settings.rig===rig||(rig==='flume'&&!e.settings.rig)),settings=normalizeSettings('liquid',{...preset.settings,runSeconds:6}),key=studyParameters(settings)[0],result=finish(runStudyCase(settings,0,key.key,3));
  const report=createReport([result],key,rig+' source');assert.deepEqual(parseReport(JSON.stringify(report)).results[0].settings,settings);assert.ok(reportPlot(report).includes('<svg'));assert.ok(readableReport(report).includes('not calibrated'));
});
after(()=>{if(process.env.LIQUID_V5_QA_OUTPUT)writeFileSync(process.env.LIQUID_V5_QA_OUTPUT,JSON.stringify({at:new Date().toISOString(),v4Rows:original.results.reduce((n,r)=>n+r.samples.length,0),cases:original.results.length,limitResults:original.results.map(r=>limitReading(r,{...original.review,limit:'depth',limitValue:330})),bounds:{importBytes:MAX_REPORT_BYTES,notebookChars:MAX_NOTEBOOK_CHARS}},null,2)+'\n');});
