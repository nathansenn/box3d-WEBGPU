import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {FailureSimulation,STUDIO_SCALED_CHECKPOINT_BACKEND}=await import('../../src/studio/physics.ts');
const {createStudioClient}=await import('../../src/engine/studio-client.ts');
const {createStudioRuntime}=await import('../../src/engine/studio-runtime.ts');
const {bridgeModelKey,bridgePoint,parseBridgeBaseline}=await import('../../src/studio/bridge-review.ts');
const {EXPERIMENT_PLANS,EXPERIMENT_CASE_COUNTS,EXPERIMENT_DURATIONS,EXPERIMENT_PRESETS,EXPERIMENT_METRICS,makeExperimentBatch,runBridgeExperiments,experimentRange,experimentValue,experimentTransitions,experimentFollowUp,experimentSummary,experimentPeak,experimentProbeTargets,experimentComparison,experimentSample,experimentOverview,experimentBaseline,parseBridgeExperiments,interruptedExperiments,experimentCSV,experimentSamplesCSV,experimentExport}=await import('../../src/studio/bridge-experiments.ts');
const model=()=>new FailureSimulation('bridge',undefined,STUDIO_SCALED_CHECKPOINT_BACKEND);
const settings={target:5,strength:1.6,wind:2,program:'failure',speed:1};
const sync=options=>createStudioClient(options,{mode:'sync'});
const noYield=()=>Promise.resolve();
const run=async(b,m,extra={})=>runBridgeExperiments(b,m,{signal:new AbortController().signal,progress:()=>{},createClient:sync,yieldTask:noYield,...extra});
let measured;
before(async()=>{const m=model();measured=await run(makeExperimentBatch(m,'load',15,settings),m);});

test('plans vary exactly one numerical control and freeze independent copies',()=>{
  for(const p of EXPERIMENT_PLANS){
    const original={...settings},b=makeExperimentBatch(model(),p.id,30,original);
    assert.deepEqual(b.cases.map(c=>c.settings[p.axis]),p.values);
    for(const c of b.cases)for(const key of Object.keys(settings))if(key!==p.axis)assert.equal(c.settings[key],settings[key]);
    original.wind=.1;b.cases[0].settings.wind=.3;
    assert.equal(b.base.wind,2);assert.notEqual(b.cases[1].settings.wind,.3);
  }
});
test('unsupported settings are rejected before any engine is allocated',()=>{
  for(const args of [['bogus',15,settings],['load',16,settings],['load',15,{...settings,target:Infinity}],['load',15,{...settings,strength:.1}],['load',15,{...settings,wind:3}]])assert.throws(()=>makeExperimentBatch(model(),...args));
});
test('ten presets stay inside the declared domain and change exactly one control',()=>{
  assert.equal(EXPERIMENT_PRESETS.length,10);
  assert.equal(new Set(EXPERIMENT_PRESETS.map(p=>p.id)).size,10);
  for(const preset of EXPERIMENT_PRESETS){
    const b=makeExperimentBatch(model(),preset.plan,preset.duration,settings,{values:preset.values,preset:preset.id});
    const plan=EXPERIMENT_PLANS.find(p=>p.id===preset.plan);
    assert.equal(b.version,2);assert.deepEqual(b.design.values,preset.values);assert.notEqual(b.design.values,preset.values);
    assert.ok(EXPERIMENT_DURATIONS.includes(b.duration));
    for(const c of b.cases){
      assert.ok(c.settings[plan.axis]>=plan.min&&c.settings[plan.axis]<=plan.max);
      for(const key of Object.keys(settings))if(key!==plan.axis)assert.equal(c.settings[key],settings[key]);
    }
  }
});
test('custom ranges cover all case counts, domain boundaries and narrow distinct values',()=>{
  for(const p of EXPERIMENT_PLANS)for(const count of EXPERIMENT_CASE_COUNTS){
    const values=experimentRange(p.id,p.min,p.max,count),b=makeExperimentBatch(model(),p.id,15,settings,{values,preset:null});
    assert.equal(values.length,count);assert.equal(values[0],p.min);assert.equal(values.at(-1),p.max);
    assert.equal(new Set(values).size,count);assert.ok(values.every((v,i)=>!i||v>values[i-1]));
    assert.equal(b.cases.length,count);assert.deepEqual(b.cases.map(c=>c.settings[p.axis]),values);
    values[0]=999;assert.equal(b.design.values[0],p.min);assert.equal(b.cases[0].settings[p.axis],p.min);
  }
  const fine=experimentRange('load',1,1.0008,9);
  assert.equal(new Set(fine.map(experimentValue)).size,9);assert.equal(experimentValue(1),'1.00');assert.equal(experimentValue(1.0001),'1.0001');
});
test('invalid ranges and falsely labelled presets are rejected instead of silently clipped',()=>{
  for(const args of [['load',0,5,4],['load',-1,5,5],['wind',0,3,5],['strength',0,2,5],['load',1,1,5],['load',2,1,5],['load',NaN,5,5],['load',0,Infinity,5],['load',0,.0002,9],['load',0,.00001,3]])assert.throws(()=>experimentRange(...args));
  for(const design of [{values:[0,1,1,3,5],preset:null},{values:[0,1,2,3,5],preset:null},{values:[0,2.5,5],preset:'load-overview'},{values:[0,2.5,5],preset:'unknown'}])assert.throws(()=>makeExperimentBatch(model(),'load',15,settings,design));
});
test('a nine-case scan records and restores every distinct experiment',async()=>{
  const m=model(),values=experimentRange('load',0,5,9),b=await run(makeExperimentBatch(m,'load',15,settings,{values,preset:null}),m);
  assert.equal(b.status,'completed');assert.equal(b.cases.length,9);assert.equal(b.cases.flatMap(c=>c.points).length,9*151);
  assert.equal(experimentOverview(b).completed,9);assert.deepEqual(parseBridgeExperiments(JSON.stringify(b),b.model),b);
  const mismatched=structuredClone(b);mismatched.design.values[1]+=.01;assert.equal(parseBridgeExperiments(JSON.stringify(mismatched),b.model),undefined);
  const badCount=structuredClone(b);badCount.cases.pop();assert.equal(parseBridgeExperiments(JSON.stringify(badCount),b.model),undefined);
});
test('120-second recordings remain exact and can be promoted to a saved baseline',async()=>{
  const m=model(),base={...settings,wind:0},values=experimentRange('load',0,1,3);
  const b=await run(makeExperimentBatch(m,'load',120,base,{values,preset:null}),m);
  assert.equal(b.status,'completed');assert.equal(b.cases.length,3);
  for(const c of b.cases){assert.equal(c.points.length,1201);assert.ok(Math.abs(c.points.at(-1).time-120)<1e-7);assert.equal(experimentSample(c,120),c.points.at(-1));}
  assert.deepEqual(parseBridgeExperiments(JSON.stringify(b),b.model),b);
  const baseline=experimentBaseline(b,b.cases[2]);assert.equal(baseline.points.length,1201);
  assert.deepEqual(parseBridgeBaseline(JSON.stringify(baseline),b.model),baseline);
});
test('five actual intact solver runs have exact durations, complete samples and measured outcomes',()=>{
  assert.equal(measured.status,'completed');assert.equal(measured.transport,'sync');
  for(const c of measured.cases){
    assert.equal(c.status,'completed');assert.equal(c.points.length,151);
    assert.equal(c.points[0].time,0);assert.equal(c.points[0].broken,0);assert.equal(c.points[0].load,0);
    assert.ok(Math.abs(c.points.at(-1).time-15)<1e-9);
    c.points.forEach((p,i)=>assert.ok(Math.abs(p.time-i/10)<1e-9));
    const summary=experimentSummary(c);
    assert.equal(summary.peak,Math.max(...c.points.map(p=>p.drop)));
    assert.equal(summary.broken,c.points.at(-1).broken);
    if(summary.broken){assert.ok(c.firstRupture>0);assert.ok(c.firstRupture<=summary.time);assert.notEqual(summary.outcome,'No rupture observed');}
    else assert.equal(c.firstRupture,null);
  }
  assert.ok(measured.cases.at(-1).firstRupture>0);
});
test('experiment response equals direct production runtime at the same fixed ticks',()=>{
  const c=measured.cases[4],m=model(),runtime=createStudioRuntime({study:'bridge',backend:m.backend,controls:{targetLoad:c.settings.target,strength:c.settings.strength,wind:c.settings.wind}});
  const points=[];let first=null;
  const initial=runtime.inspect();points.push(bridgePoint(m,initial.liveSnapshot));initial.release();
  try{for(let i=0;i<15;i++){
    const r=runtime.step({ticks:120});
    points.push(...r.recordingSamples.map(s=>bridgePoint(m,s.snapshot)));
    first??=r.eventDelta.find(e=>e.type==='break')?.time??null;r.release();
  }}finally{runtime.destroy();}
  assert.deepEqual(c.points,points);assert.equal(c.firstRupture,first);
});
test('comparison metrics use their own actual response channels',()=>{
  const c=measured.cases[4];
  for(const metric of EXPERIMENT_METRICS)assert.equal(experimentPeak(c,metric.id),Math.max(...c.points.map(p=>p[metric.id])));
  assert.equal(experimentPeak(c,'broken'),c.points.at(-1).broken);
  assert.notEqual(experimentPeak(c,'drop'),experimentPeak(c,'lateral'));
  assert.equal(experimentPeak({...c,points:[]},'drop'),undefined);
  assert.equal(experimentPeak({...c,points:c.points.slice(0,1)},'drop'),undefined);
});
test('time probe reads exact recorded samples and never interpolates or extends a partial run',()=>{
  const c=measured.cases[4],partial={...c,status:'cancelled',points:c.points.slice(0,24)};
  for(const time of [0,.1,1,2.3])assert.equal(experimentSample(partial,time),partial.points[Math.round(time*10)]);
  for(const time of [-.1,NaN,Infinity,1.05,2.31,2.4,15])assert.equal(experimentSample(partial,time),undefined);
  assert.equal(experimentSample(c,15),c.points.at(-1));
  assert.equal(experimentSample({...c,points:[]},0),undefined);
});
test('overview counts observations, including partial ruptures, without counting unrun cases',()=>{
  const b=structuredClone(measured),first=experimentOverview(b);
  assert.equal(first.completed,5);assert.equal(first.recorded,5);
  assert.equal(first.ruptured,b.cases.filter(c=>c.points.at(-1).broken>0).length);
  assert.equal(first.earliest.firstRupture,Math.min(...b.cases.flatMap(c=>c.firstRupture===null?[]:[c.firstRupture])));
  b.status='cancelled';b.cases[0].status='cancelled';
  for(const c of b.cases.slice(1)){c.status='pending';c.points=[];c.firstRupture=null;}
  assert.deepEqual(experimentOverview(b),{completed:0,recorded:1,ruptured:b.cases[0].points.at(-1).broken?1:0,earliest:b.cases[0].firstRupture===null?undefined:b.cases[0]});
  b.cases[0].points=b.cases[0].points.slice(0,1);b.cases[0].firstRupture=null;
  assert.deepEqual(experimentOverview(b),{completed:0,recorded:0,ruptured:0,earliest:undefined});
});
test('isolated runs preserve the live model and release every borrowed snapshot',async()=>{
  const m=model(),initial=m.snapshot(),diagnostics=[];
  const b=makeExperimentBatch(m,'wind',15,settings);
  await run(b,m,{createClient:async options=>{
    const client=await sync(options),destroy=client.destroy.bind(client);
    client.destroy=async()=>{diagnostics.push(client.diagnostics());await destroy();};return client;
  }});
  assert.deepEqual(m.snapshot(),initial);assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].outstandingLoans,0);
});
test('cancelling mid-case keeps completed and partial results and destroys the client once',async()=>{
  const m=model(),abort=new AbortController();let destroyed=0;
  const b=makeExperimentBatch(m,'strength',15,settings);
  await run(b,m,{signal:abort.signal,progress:batch=>{if((batch.cases[1].points.at(-1)?.time??0)>1.9)abort.abort();},createClient:async options=>{
    const c=await sync(options),destroy=c.destroy.bind(c);c.destroy=async()=>{destroyed++;await destroy();};return c;
  }});
  assert.equal(b.status,'cancelled');assert.deepEqual(b.cases.map(c=>c.status),['completed','cancelled','pending','pending','pending']);
  assert.equal(b.cases[0].points.length,151);assert.equal(b.cases[1].points.length,21);assert.equal(destroyed,1);
  assert.ok(parseBridgeExperiments(JSON.stringify(b),b.model));
  const baseline=experimentBaseline(b,b.cases[1]);assert.match(baseline.name,/partial/);assert.ok(parseBridgeBaseline(JSON.stringify(baseline),b.model));
});
test('cancellation before initialization allocates no client',async()=>{
  const m=model(),abort=new AbortController();abort.abort();let allocated=false;
  const b=await run(makeExperimentBatch(m,'load',15,settings),m,{signal:abort.signal,createClient:async()=>{allocated=true;throw Error('unexpected');}});
  assert.equal(allocated,false);assert.equal(b.status,'cancelled');assert.ok(b.cases.every(c=>c.points.length===0));
});
test('engine failure preserves prior completed cases and releases the client',async()=>{
  const m=model();let destroyed=false;
  const b=await run(makeExperimentBatch(m,'load',15,settings),m,{createClient:async options=>{
    const c=await sync(options),destroy=c.destroy.bind(c);
    c.reset=async()=>{throw Error('Synthetic reset failure');};
    c.destroy=async()=>{destroyed=true;await destroy();};return c;
  }});
  assert.equal(b.status,'failed');assert.deepEqual(b.cases.map(c=>c.status),['completed','failed','pending','pending','pending']);
  assert.equal(b.cases[0].points.length,151);assert.equal(destroyed,true);assert.ok(parseBridgeExperiments(JSON.stringify(b),b.model));
});
test('saved results roundtrip and malformed, incompatible or fabricated completion is rejected',()=>{
  assert.deepEqual(parseBridgeExperiments(JSON.stringify(measured),measured.model),measured);
  for(const raw of [null,'{',' '.repeat(1_000_001)])assert.equal(parseBridgeExperiments(raw,measured.model),undefined);
  const mutations=[b=>b.model='other',b=>b.duration=16,b=>b.cases[0].settings.wind=0,b=>b.cases[0].points.pop(),b=>b.cases[1].points[4].time=0,b=>b.cases[0].points[2].drop=Infinity,b=>b.cases[0].firstRupture=80,b=>b.status='running',b=>b.cases[0].phase='Safe',b=>b.cases[4].points.at(-1).broken=400];
  for(const mutate of mutations){const b=structuredClone(measured);mutate(b);assert.equal(parseBridgeExperiments(JSON.stringify(b),measured.model),undefined);}
});
test('legacy five-case recordings still restore with the same data and strict old defaults',()=>{
  const legacy=structuredClone(measured);legacy.version=1;delete legacy.design;
  assert.deepEqual(parseBridgeExperiments(JSON.stringify(legacy),legacy.model),legacy);
  legacy.cases[0].settings.target=.3;assert.equal(parseBridgeExperiments(JSON.stringify(legacy),legacy.model),undefined);
  const missing=structuredClone(measured);delete missing.design;assert.equal(parseBridgeExperiments(JSON.stringify(missing),missing.model),undefined);
  const unsupported=structuredClone(measured);unsupported.version=3;assert.equal(parseBridgeExperiments(JSON.stringify(unsupported),unsupported.model),undefined);
});
test('restored batches cannot skip an unrun case and then contain a later partial recording',()=>{
  const b=structuredClone(measured);b.status='cancelled';
  for(const c of b.cases){c.status='pending';c.points=[];c.firstRupture=null;c.phase='Ready';}
  b.cases[1]={...structuredClone(measured.cases[1]),status:'cancelled',points:measured.cases[1].points.slice(0,11),firstRupture:null};
  assert.equal(parseBridgeExperiments(JSON.stringify(b),b.model),undefined);
});
test('follow-ups retain both boundary cases and the original fixed conditions without changing the recording',()=>{
  // Controlled outcome fixture exercises selection; actual solver samples are covered above.
  const b=structuredClone(measured);b.cases.forEach((c,i)=>{c.points.at(-1).broken=i<2?0:1;});
  const before=structuredClone(b),transitions=experimentTransitions(b);
  assert.equal(transitions.length,1);assert.equal(transitions[0].lower.index,1);assert.equal(transitions[0].upper.index,2);
  const next=experimentFollowUp(b,1);
  assert.deepEqual(next.base,b.base);assert.notEqual(next.base,b.base);assert.equal(next.duration,b.duration);assert.equal(next.plan,b.plan);
  assert.deepEqual(next.design.values,[.8,1.05,1.3,1.55,1.8]);assert.equal(next.design.preset,null);
  next.base.wind=0;assert.equal(b.base.wind,2);assert.deepEqual(b,before);
  assert.throws(()=>experimentFollowUp(b,0));
});
test('transitions do not assume monotonic failure or use partial, pending or running cases',()=>{
  const b=structuredClone(measured);b.cases.forEach((c,i)=>{c.points.at(-1).broken=i%2;});
  assert.deepEqual(experimentTransitions(b).map(t=>[t.lower.index,t.lowerRuptured,t.upperRuptured]),[[0,false,true],[1,true,false],[2,false,true],[3,true,false]]);
  b.status='running';assert.deepEqual(experimentTransitions(b),[]);assert.throws(()=>experimentFollowUp(b,0));
  b.status='cancelled';b.cases[2].status='cancelled';for(const c of b.cases.slice(3)){c.status='pending';c.points=[];}
  assert.deepEqual(experimentTransitions(b).map(t=>t.lower.index),[0]);
  b.cases[1].status='cancelled';assert.deepEqual(experimentTransitions(b),[]);
});
test('sample CSV retains exact samples and labels partial runs without inventing future rows',()=>{
  const b=structuredClone(measured);b.status='cancelled';b.cases[1].status='cancelled';b.cases[1].points=b.cases[1].points.slice(0,11);
  for(const c of b.cases.slice(2)){c.status='pending';c.points=[];}
  const lines=experimentSamplesCSV(b).trim().split('\r\n');
  assert.equal(lines.length,1+151+11);assert.match(lines[0],/model_seconds.*applied_load_normalized.*deck_drop_model_units.*sideways_model_units/);
  const columns=line=>line.slice(1,-1).split('","');
  const actual=columns(lines.at(-1)),point=b.cases[1].points.at(-1);
  assert.equal(actual[2],'cancelled');assert.deepEqual(actual.slice(3,8).map(Number),[point.time,point.load,point.drop,point.lateral,point.broken]);
  assert.deepEqual(actual.slice(8,12).map(Number),[.8,1.6,2,15]);assert.equal(actual[12],b.model);
  assert.ok(lines.every(line=>!line.includes('"pending"')));
  b.model='=HYPERLINK("bad")';assert.match(experimentSamplesCSV(b),/"'=HYPERLINK\(""bad""\)"/);
});
test('interrupted persisted batches never appear to still be running',()=>{
  const b=structuredClone(measured);b.status='running';
  assert.equal(interruptedExperiments(b).status,'completed');
  b.cases[4].status='running';b.cases[4].points=b.cases[4].points.slice(0,100);
  const saved=interruptedExperiments(b);assert.equal(saved.status,'cancelled');assert.equal(saved.cases[4].status,'cancelled');assert.equal(b.cases[4].status,'running');
  assert.ok(parseBridgeExperiments(JSON.stringify(saved),saved.model));
});
test('baseline promotion uses the measured series and export includes model basis and partial status',()=>{
  const c=measured.cases[4],baseline=experimentBaseline(measured,c);
  assert.ok(parseBridgeBaseline(JSON.stringify(baseline),measured.model));
  assert.deepEqual(baseline.points,c.points);assert.notEqual(baseline.points,c.points);assert.deepEqual(baseline.settings,c.settings);
  const exported=experimentExport(measured);assert.equal(exported.basis.fixedHz,120);assert.equal(exported.basis.sampleHz,10);assert.equal(exported.cases[4].points.length,151);
  const csv=experimentCSV(measured),lines=csv.trim().split('\r\n');assert.equal(lines.length,6);assert.match(lines[0],/peak_recorded_drop_model_units/);assert.match(lines[5],/Load 5.00/);
  const hostile=structuredClone(measured);hostile.model='=HYPERLINK("bad")';assert.match(experimentCSV(hostile),/"'=HYPERLINK\(""bad""\)"/);
});


test('milestone probes select retained samples and distinguish the rupture event from its recording',()=>{
  const c=measured.cases[4],targets=experimentProbeTargets(c);
  assert.ok(targets.first.time>=c.firstRupture);
  assert.ok(targets.first.time-c.firstRupture<=.1+1e-9);
  assert.ok(targets.first.broken>0);
  const firstIndex=c.points.indexOf(targets.first);assert.equal(c.points[firstIndex-1].broken,0);
  assert.equal(targets.peak.drop,experimentSummary(c).peak);
  assert.equal(targets.peak.time,experimentSummary(c).peakTime);
  assert.equal(targets.end,c.points.at(-1));
  for(const point of Object.values(targets))assert.equal(experimentSample(c,Math.round(point.time*10)/10),point);
});

test('partial and unrun milestone probes cannot reach unrecorded future events',()=>{
  const c=measured.cases[4],first=c.points.findIndex(p=>p.broken>0);
  const partial={...c,status:'cancelled',points:c.points.slice(0,first)};
  const targets=experimentProbeTargets(partial);
  assert.equal(targets.first,undefined);
  assert.equal(targets.end,partial.points.at(-1));
  assert.ok(targets.peak.time<=targets.end.time);
  assert.equal(experimentProbeTargets(measured.cases[0]).first,undefined);
  assert.deepEqual(experimentProbeTargets({...c,points:[]}),{});
  assert.deepEqual(experimentProbeTargets({...c,points:c.points.slice(0,1)}),{});
});

test('reference comparisons use the actual channel values and signed differences',()=>{
  const selected=measured.cases[4],reference=measured.cases[1],before=structuredClone(measured);
  for(const time of [null,7.7,15]){
    const result=experimentComparison(selected,reference,time);
    assert.equal(result.status,'ready');assert.equal(result.sharedEnd,15);
    for(const reading of result.readings){
      const actual=time===null?experimentPeak(selected,reading.metric):experimentSample(selected,time)[reading.metric];
      const base=time===null?experimentPeak(reference,reading.metric):experimentSample(reference,time)[reading.metric];
      assert.equal(reading.current,actual);assert.equal(reading.reference,base);assert.equal(reading.delta,actual-base);
    }
  }
  assert.deepEqual(measured,before);
});

test('reference differences reverse sign and treat zero and self-comparisons as real readings',()=>{
  const a=measured.cases[4],b=measured.cases[0];
  const forward=experimentComparison(a,b,7.7),reverse=experimentComparison(b,a,7.7);
  forward.readings.forEach((r,i)=>assert.ok(r.delta===-reverse.readings[i].delta));
  for(const result of [experimentComparison(a,a,null),experimentComparison(a,b,0)]){
    assert.equal(result.status,'ready');assert.ok(result.readings.every(r=>r.delta===0));
  }
  assert.ok(forward.readings.find(r=>r.metric==='broken').delta>0);
});

test('unequal recording windows refuse peak comparisons but permit shared exact samples',()=>{
  const full=measured.cases[0],partial={...measured.cases[4],status:'cancelled',points:measured.cases[4].points.slice(0,24)};
  const peaks=experimentComparison(partial,full,null);
  assert.equal(peaks.status,'duration-mismatch');assert.equal(peaks.sharedEnd,2.3);
  assert.ok(peaks.readings.every(r=>r.delta===undefined));
  assert.equal(experimentComparison(partial,full,2.3).status,'ready');
  for(const time of [2.4,15,1.05,-.1,NaN,Infinity]){
    const result=experimentComparison(partial,full,time);
    assert.equal(result.status,'missing');assert.ok(result.readings.every(r=>r.delta===undefined));
  }
  const equallyPartial={...full,status:'cancelled',points:full.points.slice(0,24)};
  assert.equal(experimentComparison(partial,equallyPartial,null).status,'ready');
});

test('reference comparisons do not invent results for unrun, initial-only or running cases',()=>{
  const full=measured.cases[4];
  for(const points of [[],full.points.slice(0,1)])for(const time of [null,0]){
    const result=experimentComparison({...full,status:'pending',points},full,time);
    assert.equal(result.status,'missing');assert.equal(result.sharedEnd,undefined);
    assert.ok(result.readings.every(r=>r.delta===undefined));
  }
  const running=experimentComparison({...full,status:'running'},full,1);
  assert.equal(running.status,'running');assert.ok(running.readings.every(r=>r.delta===undefined));
});
