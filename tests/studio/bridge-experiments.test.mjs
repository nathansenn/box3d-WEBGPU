// Experiments of the Studio's bridge study, which runs on the SI suspension model (src/studio/si-bridge-study.ts):
// crowd in kN/m^2 on the east half, hangers cut on the upstream cable, wind in kN/m; readings in mm and kN.
import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const p=new URL(s+'.ts',c.parentURL);if(existsSync(p))return next(p.href,c);}return next(s,c);}});
const {SiBridgeStudy}=await import('../../src/studio/si-bridge-study.ts');
const {createStudioClient}=await import('../../src/engine/studio-client.ts');
const {createStudioRuntime}=await import('../../src/engine/studio-runtime.ts');
const {bridgePoint,parseBridgeBaseline}=await import('../../src/studio/bridge-review.ts');
const {EXPERIMENT_PLANS,EXPERIMENT_CASE_COUNTS,EXPERIMENT_DURATIONS,EXPERIMENT_PRESETS,EXPERIMENT_METRICS,makeExperimentBatch,runBridgeExperiments,experimentRange,experimentValue,experimentTransitions,experimentFollowUp,experimentSummary,experimentPeak,experimentProbeTargets,experimentComparison,experimentSample,experimentOverview,experimentBaseline,parseBridgeExperiments,interruptedExperiments,experimentCSV,experimentSamplesCSV,experimentExport}=await import('../../src/studio/bridge-experiments.ts');
const model=()=>new SiBridgeStudy();
const settings={target:2,strength:0,wind:.5,program:'failure',speed:1};
const sync=options=>createStudioClient(options,{mode:'sync'});
const noYield=()=>Promise.resolve();
const run=async(b,m,extra={})=>runBridgeExperiments(b,m,{signal:new AbortController().signal,progress:()=>{},createClient:sync,yieldTask:noYield,...extra});
let measured;
// Three SI runs of 15 s: no hanger cut, one and two cut, under a 2 kN/m^2 crowd and 0.5 kN/m of wind.
before(async()=>{const m=model();measured=await run(makeExperimentBatch(m,'cuts',15,settings,{values:[0,1,2],preset:null}),m);});

test('plans vary exactly one SI control and freeze independent copies',()=>{
  assert.deepEqual(EXPERIMENT_PLANS.map(p=>[p.id,p.axis,p.min,p.max]),[['load','target',0,5],['cuts','strength',0,6],['wind','wind',0,2]]);
  for(const p of EXPERIMENT_PLANS){
    const original={...settings},b=makeExperimentBatch(model(),p.id,30,original);
    assert.deepEqual(b.cases.map(c=>c.settings[p.axis]),p.values);
    for(const c of b.cases)for(const key of Object.keys(settings))if(key!==p.axis)assert.equal(c.settings[key],settings[key]);
    original.wind=.1;b.cases[0].settings.wind=.3;
    assert.equal(b.base.wind,.5);assert.notEqual(b.cases[1].settings.wind,.3);
  }
});
test('unsupported settings are rejected before any engine is allocated',()=>{
  for(const args of [['bogus',15,settings],['load',16,settings],['load',15,{...settings,target:Infinity}],['load',15,{...settings,strength:.5}],['load',15,{...settings,strength:7}],['load',15,{...settings,wind:3}]])assert.throws(()=>makeExperimentBatch(model(),...args));
});
test('ten presets stay inside the declared domain and change exactly one control',()=>{
  assert.equal(EXPERIMENT_PRESETS.length,10);assert.equal(new Set(EXPERIMENT_PRESETS.map(p=>p.id)).size,10);
  for(const preset of EXPERIMENT_PRESETS){
    const b=makeExperimentBatch(model(),preset.plan,preset.duration,settings,{values:preset.values,preset:preset.id});
    const plan=EXPERIMENT_PLANS.find(p=>p.id===preset.plan);
    assert.equal(b.version,2);assert.deepEqual(b.design.values,preset.values);assert.ok(EXPERIMENT_DURATIONS.includes(b.duration));
    for(const c of b.cases){
      assert.ok(c.settings[plan.axis]>=plan.min&&c.settings[plan.axis]<=plan.max);
      if(plan.id==='cuts')assert.ok(Number.isInteger(c.settings.strength));
      for(const key of Object.keys(settings))if(key!==plan.axis)assert.equal(c.settings[key],settings[key]);
    }
  }
});
test('custom ranges: decimals for crowd and wind, whole hangers for cuts',()=>{
  for(const p of EXPERIMENT_PLANS)for(const count of EXPERIMENT_CASE_COUNTS){
    if(p.id==='cuts'&&count>7){assert.throws(()=>experimentRange(p.id,p.min,p.max,count),/Widen/);continue;}
    const values=experimentRange(p.id,p.min,p.max,count),b=makeExperimentBatch(model(),p.id,15,settings,{values,preset:null});
    assert.equal(values.length,count);assert.equal(values[0],p.min);assert.equal(values.at(-1),p.max);
    assert.equal(new Set(values).size,count);assert.ok(values.every((v,i)=>!i||v>values[i-1]));
    if(p.id==='cuts')assert.ok(values.every(Number.isInteger));
    assert.deepEqual(b.cases.map(c=>c.settings[p.axis]),values);
  }
  assert.deepEqual(experimentRange('cuts',0,6,7),[0,1,2,3,4,5,6]);
  assert.throws(()=>experimentRange('cuts',0,2.5,3),/whole numbers/);
  const fine=experimentRange('load',1,1.0008,9);assert.equal(new Set(fine.map(experimentValue)).size,9);
});
test('invalid ranges and falsely labelled presets are rejected instead of silently clipped',()=>{
  for(const args of [['load',0,5,6],['load',-1,5,5],['wind',0,3,5],['cuts',0,7,3],['load',1,1,5],['load',2,1,5],['load',NaN,5,5],['load',0,Infinity,5]])assert.throws(()=>experimentRange(...args));
  for(const design of [{values:[0,1,1,3,5],preset:null},{values:[0,1,2,3,5],preset:null},{values:[0,2.5,5],preset:'load-overview'},{values:[0,2.5,5],preset:'unknown'}])assert.throws(()=>makeExperimentBatch(model(),'load',15,settings,design));
});
test('three SI runs have exact durations, complete samples and measured outcomes in SI units',()=>{
  assert.equal(measured.status,'completed');assert.equal(measured.transport,'sync');
  for(const c of measured.cases){
    assert.equal(c.status,'completed');assert.equal(c.points.length,151);
    assert.equal(c.points[0].time,0);assert.equal(c.points[0].broken,0);assert.equal(c.points[0].load,0);
    c.points.forEach((p,i)=>assert.ok(Math.abs(p.time-i/10)<1e-9));
    const summary=experimentSummary(c);
    assert.equal(summary.peak,Math.max(...c.points.map(p=>p.drop)));assert.equal(summary.broken,c.settings.strength);
    if(c.settings.strength){assert.equal(c.firstRupture,0);assert.match(summary.outcome,/hangers? failed/);}else{assert.equal(c.firstRupture,null);assert.equal(summary.outcome,'No hanger failure');}
    // The crowd reaches 2 kN/m^2 at 4 s (0.5 kN/m^2 per second) and stays.
    assert.equal(c.points[40].load,2);assert.ok(Math.abs(c.points[20].load-1)<1e-9);
    // Under a 2 kN/m^2 crowd the deck drops by some tens of millimetres; hanger tensions stay a few percent of breaking.
    assert.ok(summary.peak>20&&summary.peak<200,`peak drop ${summary.peak} mm`);assert.ok(summary.hanger>4&&summary.hanger<40,`hanger ${summary.hanger} kN`);
  }
  // Losing hangers moves their load to the neighbours: the largest hanger tension grows with every cut.
  const peaks=measured.cases.map(c=>experimentSummary(c).hanger);assert.ok(peaks[1]>1.3*peaks[0]&&peaks[2]>peaks[1],peaks.join(', '));
});
test('experiment response equals the direct production runtime at the same fixed ticks',()=>{
  const c=measured.cases[2],m=model(),runtime=createStudioRuntime({study:'bridge',backend:m.backend,controls:{targetLoad:c.settings.target,wind:c.settings.wind,cuts:c.settings.strength}});
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
  const c=measured.cases[2];
  for(const metric of EXPERIMENT_METRICS)assert.equal(experimentPeak(c,metric.id),Math.max(...c.points.map(p=>p[metric.id])));
  assert.deepEqual(EXPERIMENT_METRICS.map(m=>m.unit),['mm','mm','kN','hangers']);
  assert.equal(experimentPeak(c,'broken'),c.points.at(-1).broken);
  assert.notEqual(experimentPeak(c,'drop'),experimentPeak(c,'lateral'));
  assert.equal(experimentPeak({...c,points:[]},'drop'),undefined);assert.equal(experimentPeak({...c,points:c.points.slice(0,1)},'drop'),undefined);
});
test('time probe reads exact recorded samples and never interpolates or extends a partial run',()=>{
  const c=measured.cases[2],partial={...c,status:'cancelled',points:c.points.slice(0,24)};
  for(const time of [0,.1,1,2.3])assert.equal(experimentSample(partial,time),partial.points[Math.round(time*10)]);
  for(const time of [-.1,NaN,Infinity,1.05,2.31,2.4,15])assert.equal(experimentSample(partial,time),undefined);
  assert.equal(experimentSample(c,15),c.points.at(-1));
});
test('overview counts observations, including partial failures, without counting unrun cases',()=>{
  const b=structuredClone(measured),first=experimentOverview(b);
  assert.equal(first.completed,3);assert.equal(first.recorded,3);assert.equal(first.ruptured,2);
  assert.equal(first.earliest.firstRupture,0);
  b.status='cancelled';b.cases[0].status='cancelled';
  for(const c of b.cases.slice(1)){c.status='pending';c.points=[];c.firstRupture=null;}
  assert.deepEqual(experimentOverview(b),{completed:0,recorded:1,ruptured:0,earliest:undefined});
});
test('isolated runs preserve the live model and release every borrowed snapshot',async()=>{
  const m=model(),initial=m.snapshot(),diagnostics=[],abort=new AbortController();
  const b=makeExperimentBatch(m,'wind',15,settings);
  await run(b,m,{signal:abort.signal,progress:batch=>{if((batch.cases[0].points.at(-1)?.time??0)>.9)abort.abort();},createClient:async options=>{
    const client=await sync(options),destroy=client.destroy.bind(client);
    client.destroy=async()=>{diagnostics.push(client.diagnostics());await destroy();};return client;
  }});
  assert.deepEqual(m.snapshot(),initial);assert.equal(diagnostics.length,1);assert.equal(diagnostics[0].outstandingLoans,0);
});
test('cancelling mid-case keeps completed and partial results and destroys the client once',async()=>{
  const m=model(),abort=new AbortController();let destroyed=0;
  const b=makeExperimentBatch(m,'cuts',15,settings,{values:[0,1,2],preset:null});
  await run(b,m,{signal:abort.signal,progress:batch=>{if((batch.cases[1].points.at(-1)?.time??0)>1.9)abort.abort();},createClient:async options=>{
    const c=await sync(options),destroy=c.destroy.bind(c);c.destroy=async()=>{destroyed++;await destroy();};return c;
  }});
  assert.equal(b.status,'cancelled');assert.deepEqual(b.cases.map(c=>c.status),['completed','cancelled','pending']);
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
  const b=await run(makeExperimentBatch(m,'cuts',15,settings,{values:[0,1,2],preset:null}),m,{createClient:async options=>{
    const c=await sync(options),destroy=c.destroy.bind(c);
    c.reset=async()=>{throw Error('Synthetic reset failure');};
    c.destroy=async()=>{destroyed=true;await destroy();};return c;
  }});
  assert.equal(b.status,'failed');assert.deepEqual(b.cases.map(c=>c.status),['completed','failed','pending']);
  assert.deepEqual(b.cases[0].points,measured.cases[0].points);assert.equal(destroyed,true);assert.ok(parseBridgeExperiments(JSON.stringify(b),b.model));
});
test('saved results roundtrip and malformed, incompatible or fabricated completion is rejected',()=>{
  assert.deepEqual(parseBridgeExperiments(JSON.stringify(measured),measured.model),measured);
  for(const raw of [null,'{',' '.repeat(3_000_001)])assert.equal(parseBridgeExperiments(raw,measured.model),undefined);
  const mutations=[b=>b.model='other',b=>b.duration=16,b=>b.cases[0].settings.wind=0,b=>b.cases[0].points.pop(),b=>b.cases[1].points[4].time=0,b=>b.cases[0].points[2].drop=Infinity,b=>b.cases[0].points[2].hanger=-1,b=>b.cases[1].firstRupture=80,b=>b.status='running',b=>b.cases[0].phase='Collapsed',b=>b.cases[2].points.at(-1).broken=71,b=>b.version=1,b=>b.cases[1].settings.strength=1.5];
  for(const mutate of mutations){const b=structuredClone(measured);mutate(b);assert.equal(parseBridgeExperiments(JSON.stringify(b),measured.model),undefined);}
});
test('restored batches cannot skip an unrun case and then contain a later partial recording',()=>{
  const b=structuredClone(measured);b.status='cancelled';
  for(const c of b.cases){c.status='pending';c.points=[];c.firstRupture=null;c.phase='Ready';}
  b.cases[1]={...structuredClone(measured.cases[1]),status:'cancelled',points:measured.cases[1].points.slice(0,11)};
  assert.equal(parseBridgeExperiments(JSON.stringify(b),b.model),undefined);
});
test('follow-ups refine a crowd transition; adjacent whole hangers cannot be refined',()=>{
  assert.equal(experimentTransitions(measured).length,1);assert.throws(()=>experimentFollowUp(measured,0),/Widen/);
  // A crowd scan with a fabricated outcome change between cases 1 and 2 exercises the selection only.
  const b=makeExperimentBatch(model(),'load',15,settings);b.status='completed';
  b.cases.forEach((c,i)=>{c.status='completed';c.points=[{time:0,load:0,drop:0,lateral:0,broken:0,hanger:4},{time:.1,load:.05,drop:1,lateral:0,broken:i<2?0:1,hanger:5}];});
  const before=structuredClone(b),transitions=experimentTransitions(b);
  assert.deepEqual(transitions.map(t=>[t.lower.index,t.upper.index]),[[1,2]]);
  const next=experimentFollowUp(b,1);
  assert.deepEqual(next.base,b.base);assert.notEqual(next.base,b.base);assert.equal(next.plan,'load');
  assert.deepEqual(next.design.values,[1,1.25,1.5,1.75,2]);assert.equal(next.design.preset,null);
  next.base.wind=0;assert.equal(b.base.wind,.5);assert.deepEqual(b,before);
});
test('transitions do not assume monotonic failure or use partial, pending or running cases',()=>{
  const b=structuredClone(measured);b.cases.forEach((c,i)=>{c.points.at(-1).broken=i%2;});
  assert.deepEqual(experimentTransitions(b).map(t=>[t.lower.index,t.lowerRuptured,t.upperRuptured]),[[0,false,true],[1,true,false]]);
  b.status='running';assert.deepEqual(experimentTransitions(b),[]);
  b.status='cancelled';b.cases[2].status='cancelled';
  assert.deepEqual(experimentTransitions(b).map(t=>t.lower.index),[0]);
});
test('sample CSV retains exact samples in SI units and labels partial runs without inventing future rows',()=>{
  const b=structuredClone(measured);b.status='cancelled';b.cases[1].status='cancelled';b.cases[1].points=b.cases[1].points.slice(0,11);
  b.cases[2].status='pending';b.cases[2].points=[];
  const lines=experimentSamplesCSV(b).trim().split('\r\n');
  assert.equal(lines.length,1+151+11);assert.match(lines[0],/seconds.*crowd_kN_per_m2.*deck_drop_mm.*sideways_mm.*largest_hanger_kN.*hangers_failed/);
  const columns=line=>line.slice(1,-1).split('","');
  const actual=columns(lines.at(-1)),point=b.cases[1].points.at(-1);
  assert.equal(actual[2],'cancelled');assert.deepEqual(actual.slice(3,9).map(Number),[point.time,point.load,point.drop,point.lateral,point.hanger,point.broken]);
  assert.deepEqual(actual.slice(9,13).map(Number),[2,1,.5,15]);assert.equal(actual[13],b.model);
  assert.ok(lines.every(line=>!line.includes('"pending"')));
  b.model='=HYPERLINK("bad")';assert.match(experimentSamplesCSV(b),/"'=HYPERLINK\(""bad""\)"/);
});
test('interrupted persisted batches never appear to still be running',()=>{
  const b=structuredClone(measured);b.status='running';
  assert.equal(interruptedExperiments(b).status,'completed');
  b.cases[2].status='running';b.cases[2].points=b.cases[2].points.slice(0,100);
  const saved=interruptedExperiments(b);assert.equal(saved.status,'cancelled');assert.equal(saved.cases[2].status,'cancelled');assert.equal(b.cases[2].status,'running');
  assert.ok(parseBridgeExperiments(JSON.stringify(saved),saved.model));
});
test('baseline promotion uses the measured series and export states SI units and the model basis',()=>{
  const c=measured.cases[2],baseline=experimentBaseline(measured,c);
  assert.ok(parseBridgeBaseline(JSON.stringify(baseline),measured.model));
  assert.deepEqual(baseline.points,c.points);assert.notEqual(baseline.points,c.points);assert.deepEqual(baseline.settings,c.settings);
  const exported=experimentExport(measured);assert.equal(exported.basis.fixedHz,120);assert.equal(exported.units.drop,'mm');assert.equal(exported.units.hanger,'kN');assert.match(exported.basis.calibration,/SI_BRIDGE/);
  const lines=experimentCSV(measured).trim().split('\r\n');assert.equal(lines.length,4);assert.match(lines[0],/peak_deck_drop_mm.*peak_hanger_tension_kN/);assert.match(lines[3],/2 hangers cut/);
});
test('milestone probes select retained samples and distinguish the failure event from its recording',()=>{
  const c=measured.cases[2],targets=experimentProbeTargets(c);
  assert.ok(targets.first.time>=c.firstRupture&&targets.first.time-c.firstRupture<=.1+1e-9);
  assert.ok(targets.first.broken>0);assert.equal(c.points[c.points.indexOf(targets.first)-1].broken,0);
  assert.equal(targets.peak.drop,experimentSummary(c).peak);assert.equal(targets.end,c.points.at(-1));
  for(const point of Object.values(targets))assert.equal(experimentSample(c,Math.round(point.time*10)/10),point);
  assert.equal(experimentProbeTargets(measured.cases[0]).first,undefined);
  assert.deepEqual(experimentProbeTargets({...c,points:[]}),{});
});
test('reference comparisons use the actual channel values and signed differences',()=>{
  const selected=measured.cases[2],reference=measured.cases[0],before=structuredClone(measured);
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
  const forward=experimentComparison(selected,reference,7.7),reverse=experimentComparison(reference,selected,7.7);
  forward.readings.forEach((r,i)=>assert.ok(r.delta===-reverse.readings[i].delta));
  assert.ok(forward.readings.find(r=>r.metric==='broken').delta>0);assert.ok(forward.readings.find(r=>r.metric==='hanger').delta>0);
});
test('unequal recording windows refuse peak comparisons but permit shared exact samples',()=>{
  const full=measured.cases[0],partial={...measured.cases[2],status:'cancelled',points:measured.cases[2].points.slice(0,24)};
  const peaks=experimentComparison(partial,full,null);
  assert.equal(peaks.status,'duration-mismatch');assert.equal(peaks.sharedEnd,2.3);assert.ok(peaks.readings.every(r=>r.delta===undefined));
  assert.equal(experimentComparison(partial,full,2.3).status,'ready');
  for(const time of [2.4,15,1.05,-.1,NaN,Infinity])assert.equal(experimentComparison(partial,full,time).status,'missing');
  const running=experimentComparison({...full,status:'running'},full,1);assert.equal(running.status,'running');
});
