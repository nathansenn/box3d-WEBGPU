import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Worker} from 'node:worker_threads';
import {createStudioClient} from '../../src/engine/studio-client.ts';
import {StudioRuntime} from '../../src/engine/studio-runtime.ts';
import {FreeRunPacer} from '../../src/perf/free-run.ts';
import {STUDIO_SI_BRIDGE_BACKEND,STUDIO_PRESS_SI_BACKEND} from '../../src/studio/physics.ts';
import {pressDriveCommands} from '../../src/studio/press-program.ts';

function workerFactory(file='./fixtures/studio-worker.mjs'){
  return ()=>{
    const worker=new Worker(new URL(file,import.meta.url));
    const bindings=new Map();
    return {postMessage:(message,transfer)=>worker.postMessage(message,transfer),terminate:()=>worker.terminate(),
      addEventListener(type,listener){const wrapped=value=>listener(type==='message'?{data:value}:{message:value.message});bindings.set(listener,{type,wrapped});worker.on(type,wrapped);},
      removeEventListener(type,listener){const binding=bindings.get(listener);if(binding){worker.off(type,binding.wrapped);bindings.delete(listener);}},
    };
  };
}
/** Runs freely until the run ends by itself; collects every frame (copied, then released). */
function collect(client,request,{hold=0}={}){
  const frames=[],held=[];
  return new Promise((resolve,reject)=>{
    client.run(request,{frame(result){
      frames.push({tick:result.tick,completedTicks:result.completedTicks,samples:result.recordingSamples.map(s=>s.tick),events:result.eventDelta.length,run:result.run,snapshot:structuredClone(result.liveSnapshot)});
      if(held.length<hold)held.push(result);else result.release();
      if(!result.run.running){for(const h of held)h.release();resolve(frames);}
      else if(held.length===hold&&hold&&frames.length===hold+2){for(const h of held.splice(0))h.release();}
    },error:reject}).catch(reject);
  });
}
function direct(options,ticks,commandsAt=()=>[]){
  const runtime=StudioRuntime.create(options);
  for(let t=0;t<ticks;t++){const r=runtime.step({ticks:1,commands:commandsAt(runtime.tick)});r.release();}
  const result=runtime.inspect(),snapshot=structuredClone(result.liveSnapshot);result.release();
  return {runtime,snapshot};
}

test('pacer: never ahead of wall time, lag bounded and reported, retime without a burst',()=>{
  const pacer=new FreeRunPacer(1/120,{speed:1,maxLagSeconds:.25,tick:0,nowMs:0});
  assert.equal(pacer.due(0,0),0);assert.equal(pacer.due(1000/120,0),1);assert.equal(pacer.due(250,0),30);assert.equal(pacer.overloads,0);
  assert.equal(pacer.due(250,30),0);
  // Ten seconds behind: owes only the lag bound, drops and reports the rest.
  assert.equal(pacer.due(10250,30),30);assert.equal(pacer.overloads,1);assert.ok(Math.abs(pacer.lagSeconds-9.75)<1e-9,String(pacer.lagSeconds));
  assert.equal(pacer.due(10250,60),0);
  pacer.retime(20000,60,2);assert.equal(pacer.due(20000,60),0);assert.equal(pacer.due(20100,60),24);assert.equal(pacer.nextDueMs(84),20000+25/240*1000);
  assert.throws(()=>new FreeRunPacer(1/120,{speed:0,maxLagSeconds:.25,tick:0,nowMs:0}));
});

for(const [mode,factory] of [['sync',undefined],['worker',workerFactory()],['worker-shared',workerFactory('./fixtures/studio-shared-worker.mjs')]]){
  const transport=mode==='sync'?{mode:'sync'}:mode==='worker'?{mode:'worker',workerFactory:factory}:{mode:'worker',snapshots:'shared',workerFactory:factory};
  test(`${mode}: a free run to its time limit reproduces fixed stepping tick for tick, with every recording sample`,async()=>{
    for(const [options,seconds] of [[{study:'canopy',controls:{targetLoad:3,wind:.4}},1],[{study:'bridge',backend:STUDIO_SI_BRIDGE_BACKEND,controls:{targetLoad:4,wind:.5,cuts:1}},.5]]){
      const client=await createStudioClient(options,transport);
      try{
        const frames=await collect(client,{speed:16,stopAtTime:seconds,maxLagSeconds:5});
        const last=frames.at(-1),ticks=Math.round(seconds*120);
        assert.equal(last.run.stopReason,'time-limit');assert.equal(last.tick,ticks);assert.equal(client.running,false);
        assert.equal(frames.reduce((n,f)=>n+f.completedTicks,0),ticks);
        assert.deepEqual(frames.flatMap(f=>f.samples),Array.from({length:ticks/12},(_,i)=>12*(i+1)));
        const reference=direct(options,ticks);
        assert.deepEqual(last.snapshot,reference.snapshot);
        if(options.study==='canopy')assert.deepEqual(await client.exportCheckpoint(),reference.runtime.exportCheckpoint());
        reference.runtime.destroy();
      }finally{await client.destroy();}
    }
  });
  test(`${mode}: pause stops at an exact tick, stepping continues from it, and steps are refused while running`,async()=>{
    const options={study:'canopy',controls:{targetLoad:2,wind:.2}};
    const client=await createStudioClient(options,transport);
    try{
      let frames=0;const started=performance.now();
      await client.run({speed:1,maxLagSeconds:.5},{frame(result){frames++;result.release();}});
      assert.equal(client.running,true,'running after start');
      await assert.rejects(client.step({ticks:1}),{code:'BUSY'});await assert.rejects(client.exportCheckpoint(),{code:'BUSY'});
      await new Promise(resolve=>setTimeout(resolve,250));
      const paused=await client.pause();
      assert.equal(paused.run.stopReason,'pause');assert.equal(paused.run.running,false);assert.equal(client.running,false,'stopped after pause');
      const pausedTick=paused.tick,elapsed=(performance.now()-started)/1000;paused.release();
      // Never ahead of wall time (speed 1): at most the ticks due by the time the pause resolved.
      assert.ok(pausedTick>0&&pausedTick<=Math.ceil(elapsed*120)+1,`paused at ${pausedTick} after ${elapsed} s`);assert.ok(frames>0,'frames published while running');
      const after=await client.step({ticks:12}),snapshot=structuredClone(after.liveSnapshot);after.release();
      assert.deepEqual(snapshot,direct(options,pausedTick+12).snapshot);
      // A pause without a run returns the current state.
      const again=await client.pause();assert.equal(again.tick,pausedTick+12);assert.equal(again.completedTicks,0);again.release();
    }finally{await client.destroy();}
  });
  test(`${mode}: a held receiver never loses ticks or samples; a press program is applied per tick`,async()=>{
    const options={study:'plate',backend:STUDIO_PRESS_SI_BACKEND,controls:{targetLoad:2}};
    const client=await createStudioClient(options,transport);
    try{
      const frames=await collect(client,{speed:16,stopAtTime:.3,maxLagSeconds:5,pressDrive:{id:'pulse',limit:40},controls:{targetLoad:2,strength:1,wind:0}},{hold:3});
      const ticks=36;assert.equal(frames.at(-1).tick,ticks);assert.equal(frames.reduce((n,f)=>n+f.completedTicks,0),ticks);
      assert.deepEqual(frames.flatMap(f=>f.samples),[12,24,36]);
      const reference=direct(options,ticks,tick=>pressDriveCommands('pulse',tick,1,40,{targetLoad:2,strength:1,wind:0}));
      assert.deepEqual(frames.at(-1).snapshot,reference.snapshot);reference.runtime.destroy();
    }finally{await client.destroy();}
  });
  test(`${mode}: stop on first rupture ends the run at the failing tick`,async()=>{
    const options={study:'bridge',backend:STUDIO_SI_BRIDGE_BACKEND};
    const client=await createStudioClient(options,transport);
    try{
      const frames=await collect(client,{speed:16,stopAtTime:2,maxLagSeconds:5,stopOnFirstRupture:true,controls:{targetLoad:0,wind:0,cuts:1}});
      const last=frames.at(-1);assert.equal(last.run.stopReason,'first-rupture');assert.equal(last.tick,1);assert.equal(last.snapshot.response.broken,1);
    }finally{await client.destroy();}
  });
}

test('worker: reset during a run drops its frames and the client steps again',async()=>{
  const client=await createStudioClient({study:'canopy'},{mode:'worker',workerFactory:workerFactory()});
  try{
    let errors=0;
    await client.run({speed:4},{frame(result){result.release();},error(){errors++;}});
    const reset=await client.reset({study:'bridge'});assert.equal(client.running,false);assert.equal(reset.tick,0);reset.release();
    const step=await client.step({ticks:12});assert.equal(step.tick,12);step.release();assert.equal(errors,0);
    assert.throws(()=>client.updateRun({speed:1}),{code:'NOT_RUNNING'});
  }finally{await client.destroy();}
});
