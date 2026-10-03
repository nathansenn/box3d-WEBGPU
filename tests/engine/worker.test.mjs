import assert from 'node:assert/strict';
import {test} from 'node:test';
import {Worker} from 'node:worker_threads';
import {createStudioClient} from '../../src/engine/studio-client.ts';
import {FailureSimulation} from '../../src/studio/physics.ts';

function workerFactory(){
  const worker=new Worker(new URL('./fixtures/studio-worker.mjs',import.meta.url));
  const bindings=new Map();
  return {postMessage:(message,transfer)=>worker.postMessage(message,transfer),terminate:()=>worker.terminate(),
    addEventListener(type,listener){const wrapped=value=>listener(type==='message'?{data:value}:{message:value.message});bindings.set(listener,{type,wrapped});worker.on(type,wrapped);},
    removeEventListener(type,listener){const binding=bindings.get(listener);if(binding){worker.off(type,binding.wrapped);bindings.delete(listener);}},
  };
}
test('real worker transfers recycled snapshots and reproduces all three direct solvers',async()=>{
  for(const study of ['canopy','plate','bridge']){
    const client=await createStudioClient({study,controls:{targetLoad:4,wind:.3}},{mode:'worker',workerFactory});
    const direct=new FailureSimulation(study);direct.targetLoad=4;direct.wind=.3;
    try{
      let sample;
      for(let i=0;i<8;i++){
        for(let k=0;k<12;k++)direct.step();
        const result=await client.step({ticks:12});assert.deepEqual(result.liveSnapshot,direct.snapshot());
        if(!sample)sample=structuredClone(result.recordingSamples[0].snapshot);
        const positions=result.liveSnapshot.positions;result.release();assert.equal(positions.byteLength,0);
        assert.equal(client.diagnostics().outstandingLoans,0);
      }
      assert.ok(Math.abs(sample.response.time-12/120)<1e-12);
      assert.deepEqual(await client.exportCheckpoint(),direct.exportCheckpoint());
    }finally{await client.destroy();}
  }
});
test('worker backpressure, invalid command atomicity, stale reset and old loans are safe',async()=>{
  const client=await createStudioClient({study:'canopy'},{mode:'worker',workerFactory});
  try{
    const before=await client.exportCheckpoint();
    await assert.rejects(client.step({ticks:2,commands:[{tick:1,type:'controls',values:{wind:2}},{tick:2,type:'controls',values:{strength:NaN}}]}));
    assert.deepEqual(await client.exportCheckpoint(),before);
    const old=await client.inspect(),oldCopy=structuredClone(old.liveSnapshot);
    const inFlight=client.step({ticks:120});
    const rejection=assert.rejects(inFlight,{code:'RESET'});
    await assert.rejects(client.inspect(),{code:'BUSY'});
    const reset=await client.reset({study:'bridge'});await rejection;
    assert.equal(reset.liveSnapshot.study,'bridge');assert.equal(client.tick,0);reset.release();
    assert.deepEqual(old.liveSnapshot,oldCopy);old.release();
    const result=await client.step({ticks:12});assert.equal(result.tick,12);result.release();
  }finally{await client.destroy();}
  await assert.rejects(client.step({ticks:1}),{code:'DISPOSED'});
});
test('startup fallback is explicit, mandatory-worker faults reject, and destroyed sync clients stay closed',async()=>{
  const workerFactory=()=>{throw new Error('test adapter unavailable');};
  const fallback=await createStudioClient({study:'bridge'},{mode:'auto',workerFactory});
  assert.equal(fallback.mode,'sync');assert.match(fallback.fallbackReason,/test adapter unavailable/);
  const result=await fallback.step({ticks:1});result.release();await fallback.destroy();
  await assert.rejects(fallback.inspect(),{code:'DISPOSED'});
  await assert.rejects(createStudioClient({study:'bridge'},{mode:'worker',workerFactory}),/test adapter unavailable/);
});
test('unresponsive workers time out and release their transport',async()=>{
  let terminated=0;
  const workerFactory=()=>({postMessage(){},addEventListener(){},removeEventListener(){},terminate(){terminated++;}});
  await assert.rejects(createStudioClient({study:'bridge'},{mode:'worker',workerFactory,timeoutMs:10}),/timed out/i);
  assert.ok(terminated>=1);
});
