import assert from 'node:assert/strict';
import {test} from 'node:test';
import {scaledNorm3} from '../../src/studio/norm3.ts';
import {parseStudioCheckpointFile} from '../../src/studio/checkpoint-file.ts';
import {Worker} from 'node:worker_threads';
import {FailureSimulation,STUDIO_CHECKPOINT_BACKEND as legacy,STUDIO_SCALED_CHECKPOINT_BACKEND as scaled} from '../../src/studio/physics.ts';
import {createStudioRuntime,STUDIO_CAPABILITIES,STUDIO_SCALED_CAPABILITIES} from '../../src/engine/studio-runtime.ts';
import {createStudioClient} from '../../src/engine/studio-client.ts';
import {validateStudioStepData} from '../../src/engine/studio-protocol.ts';
const run=(s,ticks)=>{for(let i=0;i<ticks;i++)s.step();return s;};
function workerFactory(tamper=message=>message){return ()=>{
  const worker=new Worker(new URL('./fixtures/studio-worker.mjs',import.meta.url)),bindings=new Map();
  return {postMessage:(message,transfer)=>worker.postMessage(message,transfer),terminate:()=>worker.terminate(),
    addEventListener(type,listener){const wrapped=value=>listener(type==='message'?{data:tamper(value)}:{message:value.message});bindings.set(listener,{type,wrapped});worker.on(type,wrapped);},
    removeEventListener(type,listener){const b=bindings.get(listener);if(b){worker.off(type,b.wrapped);bindings.delete(listener);}}};
};}
test('backend identity is immutable on direct restore and factories retain either history',()=>{
  for(const backend of [legacy,scaled]){
    const a=new FailureSimulation('bridge',{},backend);a.targetLoad=4;run(a,600);
    const checkpoint=JSON.parse(JSON.stringify(a.exportCheckpoint())),b=FailureSimulation.fromCheckpoint(checkpoint);
    assert.equal(b.backend,backend);run(a,120);run(b,120);assert.deepEqual(a.exportCheckpoint(),b.exportCheckpoint());
    const other=new FailureSimulation('bridge',{},backend===legacy?scaled:legacy),before=other.exportCheckpoint();
    assert.throws(()=>other.restoreCheckpoint(checkpoint),/incompatible numerical backend/);assert.deepEqual(other.exportCheckpoint(),before);
  }
  assert.throws(()=>new FailureSimulation('plate',{},'unknown'),/Unknown/);
});
test('runtime enforces selected capabilities and restores recorded backend by default',()=>{
  const runtime=createStudioRuntime({study:'bridge',backend:scaled});const frame=runtime.inspect();
  assert.deepEqual(runtime.capabilities,STUDIO_SCALED_CAPABILITIES);
  const {release,...data}=frame;
  assert.throws(()=>validateStudioStepData(data),{code:'MODEL_MISMATCH'});
  assert.equal(validateStudioStepData(data,undefined,STUDIO_SCALED_CAPABILITIES).tick,0);release();
  const checkpoint=runtime.exportCheckpoint(),restored=createStudioRuntime({study:'bridge',initialCheckpoint:checkpoint});
  assert.equal(restored.capabilities.models[0].id,scaled);restored.destroy();
  assert.throws(()=>runtime.reset({study:'bridge',backend:legacy,initialCheckpoint:checkpoint}));assert.deepEqual(runtime.exportCheckpoint(),checkpoint);
  const reset=runtime.reset({study:'bridge'});reset.release();assert.deepEqual(runtime.capabilities,STUDIO_CAPABILITIES);runtime.destroy();
});
for(const transport of [{mode:'sync'},{mode:'worker',snapshots:'transfer'},{mode:'worker',snapshots:'shared'}])test('client transport retains backend through commands, old loans and resets: '+JSON.stringify(transport),async()=>{
  const client=await createStudioClient({study:'bridge',backend:scaled,controls:{targetLoad:4}},{...transport,workerFactory:workerFactory()});
  try{
    const direct=new FailureSimulation('bridge',{},scaled);direct.targetLoad=4;
    for(const ticks of [12,36,72,120]){const frame=await client.step({ticks});run(direct,ticks);assert.deepEqual(frame.liveSnapshot,direct.snapshot());assert.equal(frame.capabilities.models[0].id,scaled);frame.release();}
    assert.deepEqual(await client.exportCheckpoint(),direct.exportCheckpoint());assert.equal(client.capabilities.models[0].id,scaled);
    const held=await client.inspect(),saved=structuredClone(held.liveSnapshot),checkpoint=new FailureSimulation('bridge').exportCheckpoint();
    const restored=await client.reset({study:'bridge',initialCheckpoint:checkpoint});restored.release();
    assert.equal(client.capabilities.models[0].id,legacy);assert.equal((await client.exportCheckpoint()).backend,legacy);assert.deepEqual(held.liveSnapshot,saved);assert.equal(held.capabilities.models[0].id,scaled);held.release();
    const fresh=await client.reset({study:'plate',backend:scaled});assert.equal(fresh.capabilities.models[0].id,scaled);fresh.release();
  }finally{await client.destroy();}
});
for(const phase of ['ready','snapshot','checkpoint'])test('worker cannot substitute another valid backend at '+phase,async()=>{
  const tamper=m=>{
    if(m.type===phase){
      if(phase==='ready')m.capabilities=STUDIO_CAPABILITIES;
      else if(phase==='snapshot')m.data.capabilities=STUDIO_CAPABILITIES;
      else{m.checkpoint.backend=legacy;const id=JSON.parse(m.checkpoint.scene.identity);id.backend=legacy;m.checkpoint.scene.identity=JSON.stringify(id);}
    }return m;
  };
  const options={study:'bridge',backend:scaled},transport={mode:'worker',workerFactory:workerFactory(tamper)};
  if(phase==='ready'){await assert.rejects(createStudioClient(options,transport),{code:'MODEL_MISMATCH'});return;}
  const client=await createStudioClient(options,transport);
  try{await assert.rejects(phase==='snapshot'?client.inspect():client.exportCheckpoint(),{code:'MODEL_MISMATCH'});}finally{await client.destroy();}
});

test('scaled norm remains robust at zero, overflow, underflow and mixed magnitudes',()=>{
  assert.equal(scaledNorm3(3,4,12),13);assert.ok(Object.is(scaledNorm3(-0,0,-0),0));
  assert.equal(scaledNorm3(Infinity,NaN,1),Infinity);assert.ok(Number.isNaN(scaledNorm3(NaN,1,2)));
  const values=[[1e308,1e308,0],[1e-300,-1e-300,1e-300],[Number.MIN_VALUE,Number.MIN_VALUE,0],[1e300,1e-300,3]];
  let state=0x51f15e;const random=()=>{state^=state<<13;state^=state>>>17;state^=state<<5;return(state>>>0)/2**32;};
  for(let i=0;i<1000;i++){const scale=10**(random()*600-300);values.push(Array.from({length:3},()=>scale*(2*random()-1)));}
  for(const v of values){const actual=scaledNorm3(...v),reference=Math.hypot(...v);assert.ok(Number.isFinite(actual));assert.ok(Math.abs(actual-reference)<=Math.max(Number.MIN_VALUE,Math.abs(reference)*4*Number.EPSILON));}
});

test('saved-run file wrappers restore the recorded numerical backend',()=>{
  for(const backend of [legacy,scaled]){
    const original=new FailureSimulation('bridge',{},backend);original.targetLoad=4;run(original,360);
    const checkpoint=original.exportCheckpoint();
    const restored=[checkpoint,{schema:'box3d.failure-studio.v2',checkpoint},{id:'sweep-case',status:'completed',checkpoint}]
      .map(value=>parseStudioCheckpointFile(JSON.stringify(value)));
    run(original,120);
    for(const simulation of restored){assert.equal(simulation.backend,backend);run(simulation,120);assert.deepEqual(simulation.exportCheckpoint(),original.exportCheckpoint());}
  }
});
