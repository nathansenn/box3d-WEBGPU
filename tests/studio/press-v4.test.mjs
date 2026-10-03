import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {DEFAULT_PRESS}=await import('../../src/studio/press-settings.ts');
const {STUDIO_SCALED_CHECKPOINT_BACKEND:backend}=await import('../../src/studio/physics.ts');
const {StudioRuntime}=await import('../../src/engine/studio-runtime.ts');
const {PRESS_DRIVES,pressDrivePressure,pressDriveCommands,readPressDriveEnvelope}=await import('../../src/studio/press-program.ts');
const {pressPressureAt,pressDriveAt}=await import('../../src/studio/press-inspection.ts');
const {makePressRun,addPressRun,decodePressRuns,encodePressRuns,pressRunPoint,MAX_PRESS_RUN_BYTES}=await import('../../src/studio/press-runs.ts');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
const options={study:'plate',backend,press:{...DEFAULT_PRESS,metal:'copper',thickness:2,tool:'capsule',angle:90,strikeSpeed:25,stroke:100,hold:10},controls:{targetLoad:0,strength:1,wind:0}};
function advance(runtime,id,end,batch=64,limit=65){
  let snapshot;
  while(runtime.tick<end){const ticks=Math.min(batch,end-runtime.tick),result=runtime.step({ticks,commands:pressDriveCommands(id,runtime.tick,ticks,limit,{strength:1,wind:0})});snapshot=structuredClone(result.liveSnapshot);result.release();assert.equal(result.completed,false);}
  return snapshot;
}

test('all pressure programs remain bounded and hit their phase boundaries on the solver clock',()=>{
  for(const d of PRESS_DRIVES)for(const limit of [0,1,65,100])for(let tick=0;tick<=1440;tick++){
    const p=pressDrivePressure(d.id,tick/120,limit);assert.ok(Number.isFinite(p)&&p>=0&&p<=limit);
  }
  near(pressDrivePressure('soft-start',0,80),20);near(pressDrivePressure('soft-start',4,80),50);near(pressDrivePressure('soft-start',8,80),80);
  near(pressDrivePressure('two-stage',479/120,80),28);near(pressDrivePressure('two-stage',4,80),80);
  near(pressDrivePressure('pulse',359/120,80),32);near(pressDrivePressure('pulse',3,80),80);near(pressDrivePressure('pulse',6,80),32);
  assert.equal(pressDrivePressure('steady',NaN,Infinity),0);assert.equal(pressDrivePressure('steady',0,300),100);
  assert.throws(()=>pressDriveCommands('steady',-1,1,65,{}),RangeError);assert.throws(()=>pressDriveCommands('steady',1,65,65,{}),RangeError);
});

for(const id of ['soft-start','two-stage','pulse'])test(`${id}: 17-tick and 64-tick batches produce identical deformation and checkpoints`,()=>{
  const a=new StudioRuntime(options),b=new StudioRuntime(options);
  const sa=advance(a,id,1020,64),sb=advance(b,id,1020,17);
  assert.deepEqual(sa,sb);assert.deepEqual(a.exportCheckpoint(),b.exportCheckpoint());
  assert.ok(sa.response.deflection>.02);assert.ok(sa.response.plastic>0);
  a.destroy();b.destroy();
});

test('saved schedule resumes across a pressure-stage boundary without changing solver state',()=>{
  const a=new StudioRuntime(options);advance(a,'two-stage',473);
  const app=JSON.parse(JSON.stringify({checkpoint:a.exportCheckpoint(),settings:{pressureProgram:{schema:'press-drive-v1',id:'two-stage',limit:65}}}));
  const program=readPressDriveEnvelope(app.settings.pressureProgram),b=new StudioRuntime({study:'plate',initialCheckpoint:app.checkpoint});
  assert.deepEqual(program,{schema:'press-drive-v1',id:'two-stage',limit:65});
  advance(a,'two-stage',650);advance(b,program.id,650,13,program.limit);
  assert.deepEqual(a.exportCheckpoint(),b.exportCheckpoint());a.destroy();b.destroy();
  for(const bad of [null,{}, {schema:'press-drive-v2',id:'pulse',limit:65},{schema:'press-drive-v1',id:'unknown',limit:65},{schema:'press-drive-v1',id:'pulse',limit:101},{schema:'press-drive-v1',id:'pulse',limit:NaN}])assert.equal(readPressDriveEnvelope(bad),undefined);
});

test('recorded pressure replays the active program and the later manual override',()=>{
  const history=[{time:0,press:{pressure:80},pressDrive:'two-stage'},{time:5,press:{pressure:40},pressDrive:'steady'},{time:8,press:{pressure:0},pressDrive:'steady'}];
  assert.equal(pressPressureAt(2,65,history),28);assert.equal(pressPressureAt(4.5,65,history),80);assert.equal(pressPressureAt(5,65,history),40);assert.equal(pressPressureAt(9,65,history),0);
  assert.equal(pressDriveAt(2,history),'two-stage');assert.equal(pressDriveAt(5,history),'steady');assert.equal(pressDriveAt(0,[],'pulse'),'pulse');
  near(pressPressureAt(4,65,[],'soft-start'),40.625);assert.equal(pressPressureAt(4,65,[]),65);
});

const point=(time,bend,plastic=0,broken=0)=>({time,bend,plastic,broken,drive:65,requested:65,travel:bend});
const input=()=>({id:'run-1',createdAt:'2026-09-11T06:00:00.000Z',backend,settings:{...DEFAULT_PRESS},drives:['steady'],complete:true,historyComplete:true,points:[point(0,0),point(.1,12,2),point(.2,30,4,3),point(.3,22,4,3)]});
test('run metrics distinguish peak, retained bend, recovery and first recorded damage without retaining mutable inputs',()=>{
  const source=input(),run=makePressRun(source);
  assert.deepEqual(run.metrics,{peakBend:30,finalBend:22,plastic:4,broken:3,recovery:8,firstYield:.1,firstCrack:.2});
  source.points[2].bend=999;source.settings.thickness=20;source.drives.push('pulse');
  assert.equal(run.points[2].bend,30);assert.equal(run.settings.thickness,DEFAULT_PRESS.thickness);assert.deepEqual(run.drives,['steady']);
  const missing=makePressRun({...input(),historyComplete:false});assert.equal(missing.metrics.firstYield,null);assert.equal(missing.metrics.firstCrack,null);assert.equal(missing.metrics.peakBend,30);
  const clean=makePressRun({...input(),points:[point(0,0),point(.1,1)]});assert.equal(clean.metrics.firstYield,null);assert.equal(clean.metrics.firstCrack,null);
});

test('saved run summaries are bounded, survive serialization and recompute untrusted summary values',()=>{
  let saved=[];for(let i=1;i<=7;i++)saved=addPressRun(saved,makePressRun({...input(),id:`run-${i}`}));
  assert.deepEqual(saved.map(r=>r.id),['run-7','run-6','run-5','run-4']);
  const encoded=encodePressRuns(saved);assert.deepEqual(decodePressRuns(encoded),saved);assert.ok(encoded.length<MAX_PRESS_RUN_BYTES);
  const fake=JSON.parse(encoded);fake.runs[0].metrics.peakBend=99999;fake.runs[0].settings.label='<script>';
  const decoded=decodePressRuns(JSON.stringify(fake));assert.equal(decoded[0].metrics.peakBend,30);assert.equal(decoded[0].settings.label,undefined);
  const copy=addPressRun(saved,saved[0]);copy[1].points[1].bend=123;assert.equal(saved[1].points[1].bend,12);
});

test('malformed comparison stores are rejected without exposing partial or misleading runs',()=>{
  const base={schema:'press-runs-v1',runs:[makePressRun(input())]};
  for(const mutate of [x=>x.schema='future',x=>x.runs[0].backend='unvalidated',x=>x.runs[0].settings.thickness=80,x=>x.runs[0].drives=['none'],x=>x.runs[0].points[1].time=0,x=>x.runs[0].points[1].bend=-1,x=>x.runs[0].points[1].drive=101,x=>x.runs[0].points[1].broken=.5,x=>x.runs[0].points=Array(603).fill(point(0,0)),x=>x.runs.push(x.runs[0])]){
    const bad=structuredClone(base);mutate(bad);assert.deepEqual(decodePressRuns(JSON.stringify(bad)),[]);
  }
  assert.deepEqual(decodePressRuns('{oops'),[]);assert.deepEqual(decodePressRuns(' '.repeat(MAX_PRESS_RUN_BYTES+1)),[]);
  assert.throws(()=>encodePressRuns(Array(5).fill(base.runs[0])),RangeError);
});

test('snapshot summaries use explicit millimeter and percentage scales, without borrowing mutable geometry',()=>{
  const runtime=new StudioRuntime(options),result=runtime.inspect(),snapshot=result.liveSnapshot;
  const point=pressRunPoint(snapshot,22.75);assert.equal(point.bend,snapshot.response.deflection*100);assert.equal(point.plastic,snapshot.response.plastic*100);assert.equal(point.requested,22.75);assert.equal(point.drive,snapshot.press.pressure);
  assert.equal('positions' in point,false);result.release();runtime.destroy();
});
