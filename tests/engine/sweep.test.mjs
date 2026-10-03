import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {FailureSimulation} from '../../src/studio/physics.ts';
import {runStudioSweep,validateStudioSweep} from '../../src/engine/studio-sweep.ts';
import {nodeStudioWorkerFactory,runSweepCli} from '../../scripts/studio-sweep.mjs';

const cases=[.5,1,2].map((strength,index)=>({id:`bridge-${index}`,options:{study:'bridge',controls:{targetLoad:4,strength}},ticks:240,commands:[{tick:101,type:'controls',values:{wind:.7}},{tick:137,type:'controls',values:{targetLoad:0}}]}));
test('parallel worker sweeps preserve exact case state, order and immutable numeric samples',async()=>{
  let active=0,peak=0;
  const workerFactory=()=>{active++;peak=Math.max(peak,active);const worker=nodeStudioWorkerFactory();const terminate=worker.terminate;let stopped=false;worker.terminate=()=>{if(!stopped){stopped=true;active--;}return terminate();};return worker;};
  const results=await runStudioSweep(cases,{concurrency:2,batchTicks:37,sampleEveryTicks:24,includeCheckpoint:true,transport:{mode:'worker',workerFactory}});
  assert.ok(peak<=2&&peak>0);assert.equal(active,0);assert.deepEqual(results.map(r=>r.id),cases.map(c=>c.id));
  for(let i=0;i<cases.length;i++){
    const c=cases[i],actual=results[i],reference=new FailureSimulation('bridge');Object.assign(reference,c.options.controls);
    const expectedSamples=[{tick:0,response:reference.response()}];
    for(let tick=1;tick<=c.ticks;tick++){
      for(const command of c.commands)if(command.tick===tick)Object.assign(reference,command.values);
      reference.step();if(tick%24===0)expectedSamples.push({tick,response:reference.response()});
    }
    assert.equal(actual.status,'completed');assert.equal(actual.completedTicks,c.ticks);
    assert.deepEqual(actual.checkpoint,reference.exportCheckpoint());assert.deepEqual(actual.samples,expectedSamples);
  }
});
test('cancellation destroys active workers and never starts queued cases',async()=>{
  const controller=new AbortController();let created=0;
  const workerFactory=()=>{created++;return nodeStudioWorkerFactory();};
  const results=await runStudioSweep(cases,{concurrency:1,signal:controller.signal,transport:{mode:'worker',workerFactory},onProgress:()=>controller.abort()});
  assert.equal(created,1);assert.deepEqual(results.map(r=>r.status),['cancelled','cancelled','cancelled']);
  assert.ok(results[0].completedTicks>0&&results[0].completedTicks<cases[0].ticks);
  assert.equal(results[1].completedTicks,0);
});
test('invalid cases are rejected before any worker or output side effect',async()=>{
  let created=0;
  await assert.rejects(runStudioSweep([...cases,{...cases[0],id:'../escape'}],{transport:{workerFactory:()=>{created++;throw new Error('unreachable');}}}));
  assert.equal(created,0);
  assert.throws(()=>validateStudioSweep([cases[0],cases[0]]));
  assert.throws(()=>validateStudioSweep([{...cases[0],commands:[{tick:241,type:'controls',values:{wind:1}}]}]));
  assert.throws(()=>validateStudioSweep([{...cases[0],options:{study:'bridge',initialCheckpoint:{}}}]));
});
test('worker failure is identified per case and sink failures propagate after cleanup',async()=>{
  const failed=await runStudioSweep([cases[0]],{transport:{mode:'worker',workerFactory:()=>{throw new Error('worker unavailable');}}});
  assert.equal(failed[0].status,'failed');assert.match(failed[0].error,/unavailable/);
  await assert.rejects(runStudioSweep([{...cases[0],ticks:1,commands:[]}],{transport:{mode:'sync'},onResult:()=>{throw new Error('sink full');}}),/sink full/);
});
test('large campaigns stream full checkpoints and retain only compact results',async()=>{
  const campaign=Array.from({length:128},(_,i)=>({id:`case-${i}`,options:{study:'bridge'},ticks:1}));
  await assert.rejects(runStudioSweep(campaign,{includeCheckpoint:true}),/stream checkpoints/);
  let stored=0;
  const results=await runStudioSweep(campaign,{concurrency:2,transport:{mode:'sync'},includeCheckpoint:true,retainCheckpoints:false,onResult:result=>{assert.equal(result.checkpoint.study,'bridge');stored++;}});
  assert.equal(stored,128);assert.equal(results.length,128);assert.ok(results.every(r=>r.status==='completed'&&!r.checkpoint));
});
test('CLI writes separate integrity-identified artifacts and refuses existing output directories',async()=>{
  const temp=await mkdtemp(join(tmpdir(),'box3d-sweep-test-'));
  try{
    const input=join(temp,'cases.json'),output=join(temp,'results');
    await writeFile(input,JSON.stringify([{...cases[0],ticks:24,commands:[]}]));
    assert.equal(await runSweepCli(['--input',input,'--output',output,'--checkpoint']),0);
    const summary=JSON.parse(await readFile(join(output,'summary.json'),'utf8'));
    assert.equal(summary.status,'completed');assert.equal(summary.artifacts.length,1);assert.match(summary.artifacts[0].sha256,/^[a-f0-9]{64}$/);
    const result=JSON.parse(await readFile(join(output,summary.artifacts[0].file),'utf8'));
    assert.equal(result.completedTicks,24);assert.equal(result.checkpoint.format,'box3d-studio-checkpoint');
    await assert.rejects(runSweepCli(['--input',input,'--output',output]),{code:'EEXIST'});
  }finally{await rm(temp,{recursive:true,force:true});}
});
