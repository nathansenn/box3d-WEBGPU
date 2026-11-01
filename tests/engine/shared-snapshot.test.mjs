import assert from 'node:assert/strict';
import test from 'node:test';
import {Worker} from 'node:worker_threads';
import {StudioSharedReader,StudioSharedWriter,studioSharedMemorySupport} from '../../src/engine/studio-shared.ts';
import {createStudioClient} from '../../src/engine/studio-client.ts';
import {validateStudioBuffers,validateStudioSnapshot} from '../../src/engine/studio-protocol.ts';
import {FailureSimulation} from '../../src/studio/physics.ts';

const dimensions={positions:12,strains:4,broken:5};
const copy=s=>({...s,positions:new Float32Array(s.positions),strains:new Float32Array(s.strains),broken:new Uint8Array(s.broken)});
function factory(log=[],workerData){
  return()=>{
    const worker=new Worker(new URL('./fixtures/studio-shared-worker.mjs',import.meta.url),{workerData});
    const bindings=new Map();
    return {postMessage:(m,t)=>{log.push({type:m.type,snapshots:m.snapshots,transfers:t.length});worker.postMessage(m,t);},terminate:()=>worker.terminate(),
      addEventListener(type,listener){const wrapped=value=>listener(type==='message'?{data:value}:{message:value.message});bindings.set(listener,{type,wrapped});worker.on(type,wrapped);},
      removeEventListener(type,listener){const b=bindings.get(listener);if(b){worker.off(type,b.wrapped);bindings.delete(listener);}}
    };
  };
}
test('atomic publication prevents early reads, duplicate claims, stale tickets and held-slot overwrites',()=>{
  const writer=new StudioSharedWriter(dimensions,2**32+17),reader=new StudioSharedReader(structuredClone(writer.descriptor),2**32+17);
  const loans=[];
  for(let i=0;i<3;i++){
    const w=writer.acquire(),tick=2**32+i;
    w.buffers.positions.fill(i+1);w.buffers.strains.fill(i+.5);w.buffers.broken.fill(i%2);
    assert.throws(()=>reader.acquire({generation:writer.descriptor.generation,slot:w.slot,sequence:w.sequence,tick}),{code:'STALE_SNAPSHOT'});
    const ticket=writer.publish(w,tick);
    assert.throws(()=>reader.acquire({...ticket,tick:tick+1}),{code:'STALE_SNAPSHOT'});
    const loan=reader.acquire(ticket);loans.push({loan,ticket,copy:copy(loan.buffers)});
    assert.throws(()=>reader.acquire(ticket),{code:'STALE_SNAPSHOT'});
  }
  assert.throws(()=>writer.acquire(),{code:'BACKPRESSURE'});
  const old=loans[0];old.loan.release();old.loan.release();
  const replacement=writer.acquire();assert.equal(replacement.slot,old.ticket.slot);replacement.buffers.positions.fill(99);
  const replacementTicket=writer.publish(replacement,77);
  assert.throws(()=>reader.acquire(old.ticket),{code:'STALE_SNAPSHOT'});
  const current=reader.acquire(replacementTicket);old.loan.release();
  assert.throws(()=>writer.acquire(),{code:'BACKPRESSURE'});
  for(const held of loans.slice(1))assert.deepEqual(copy(held.loan.buffers),held.copy);
  current.release();loans.slice(1).forEach(l=>l.loan.release());assert.equal(writer.diagnostics().outstanding,0);
  assert.throws(()=>reader.acquire({...replacementTicket,generation:1}),{code:'STALE_GENERATION'});
  writer.close();assert.throws(()=>reader.acquire(replacementTicket),{code:'DISPOSED'});
});
test('sequence exhaustion retires storage and malformed or mutable shared layouts are rejected',()=>{
  const writer=new StudioSharedWriter(dimensions,1),header=new Int32Array(writer.descriptor.control);
  for(let slot=0;slot<3;slot++)Atomics.store(header,16*(slot+1)+1,0x7fffffff);
  assert.throws(()=>writer.acquire(),{code:'SEQUENCE_EXHAUSTED'});assert.equal(writer.diagnostics().retired,3);
  for(const mutate of [d=>d.v=2,d=>d.generation=2,d=>d.positions=13,d=>d.data=new SharedArrayBuffer(4),d=>d.control=new ArrayBuffer(256),d=>d.data=new SharedArrayBuffer(d.data.byteLength,{maxByteLength:d.data.byteLength*2})]){
    const d=structuredClone(new StudioSharedWriter(dimensions,1).descriptor);mutate(d);assert.throws(()=>new StudioSharedReader(d,1));
  }
  const buffers=new StudioSharedWriter(dimensions,1).acquire().buffers;
  assert.throws(()=>validateStudioBuffers(buffers),/owned ArrayBuffers/);
  const sim=new FailureSimulation('canopy'),s=sim.snapshot();
  const w=new StudioSharedWriter({positions:s.positions.length,strains:s.strains.length,broken:s.broken.length},1).acquire();
  w.buffers.positions.set(s.positions);w.buffers.strains.set(s.strains);w.buffers.broken.set(s.broken);
  assert.doesNotThrow(()=>validateStudioSnapshot({...s,...w.buffers},w.buffers));
  assert.throws(()=>validateStudioSnapshot({...s,...w.buffers,positions:new Float32Array(w.buffers.positions)},w.buffers),/claimed ring slot/);
});
test('shared worker output, recordings and full checkpoints match all three direct solvers exactly',async()=>{
  for(const study of ['canopy','plate','bridge']){
    const log=[],client=await createStudioClient({study,controls:{targetLoad:4,wind:.3}},{mode:'worker',snapshots:'shared',workerFactory:factory(log)});
    const direct=new FailureSimulation(study);direct.targetLoad=4;direct.wind=.3;
    try{
      assert.equal(client.snapshotTransport,'shared');const buffers=new Set();let sample,saved;
      for(let i=0;i<8;i++){
        for(let k=0;k<12;k++)direct.step();
        const result=await client.step({ticks:12});assert.deepEqual(copy(result.liveSnapshot),direct.snapshot());
        assert.ok(result.liveSnapshot.positions.buffer instanceof SharedArrayBuffer);buffers.add(result.liveSnapshot.positions.buffer);
        for(const recording of result.recordingSamples)assert.ok(recording.snapshot.positions.buffer instanceof ArrayBuffer);
        if(!sample){sample=result.recordingSamples[0].snapshot;saved=structuredClone(sample);}
        result.release();assert.equal(client.diagnostics().outstandingLoans,0);
      }
      assert.equal(buffers.size,1,'the three slots use fixed regions of one shared data buffer');
      assert.deepEqual(sample,saved);assert.deepEqual(await client.exportCheckpoint(),direct.exportCheckpoint());
      assert.equal(log.filter(m=>m.type==='recycle').length,0);assert.ok(client.diagnostics().sharedBytes>0);
    }finally{await client.destroy();}
  }
});
test('full shared rings reject commands atomically; reset and destruction preserve held old-generation data',async()=>{
  const client=await createStudioClient({study:'canopy'},{mode:'worker',snapshots:'shared',workerFactory:factory()});
  let old;
  try{
    const loans=[await client.inspect(),await client.inspect(),await client.inspect()],before=await client.exportCheckpoint();
    await assert.rejects(client.step({ticks:1,commands:[{type:'controls',tick:1,values:{wind:4}}]}),{code:'BACKPRESSURE'});
    assert.equal(client.tick,0);assert.deepEqual(await client.exportCheckpoint(),before);
    loans[1].release();loans[2].release();old=loans[0];const oldCopy=copy(old.liveSnapshot);
    const inFlight=client.step({ticks:120}),rejected=assert.rejects(inFlight,{code:'RESET'});
    const reset=await client.reset({study:'bridge'});await rejected;
    assert.equal(reset.liveSnapshot.study,'bridge');assert.equal(client.tick,0);reset.release();
    assert.deepEqual(copy(old.liveSnapshot),oldCopy);old.release();old.release();
    const advanced=await client.step({ticks:12});assert.equal(advanced.tick,12);advanced.release();
    const held=await client.inspect(),copyHeld=copy(held.liveSnapshot);await client.destroy();
    assert.deepEqual(copy(held.liveSnapshot),copyHeld);held.release();
    await assert.rejects(client.inspect(),{code:'DISPOSED'});
  }finally{old?.release();await client.destroy();}
});
test('isolation gating and shared negotiation retain the explicit transfer fallback',async()=>{
  const previous=Object.getOwnPropertyDescriptor(globalThis,'crossOriginIsolated');
  try{
    Object.defineProperty(globalThis,'crossOriginIsolated',{value:false,configurable:true});assert.equal(studioSharedMemorySupport().supported,false);
    let created=0;await assert.rejects(createStudioClient({study:'bridge'},{mode:'worker',snapshots:'shared',workerFactory:()=>{created++;}}),{code:'SHARED_UNAVAILABLE'});assert.equal(created,0);
    const client=await createStudioClient({study:'bridge'},{mode:'worker',snapshots:'auto',workerFactory:factory()});
    try{assert.equal(client.snapshotTransport,'transfer');assert.match(client.snapshotFallbackReason,/isolated/);const s=await client.inspect();s.release();assert.equal(s.liveSnapshot.positions.byteLength,0);}finally{await client.destroy();}
  }finally{if(previous)Object.defineProperty(globalThis,'crossOriginIsolated',previous);else delete globalThis.crossOriginIsolated;}
  const log=[],client=await createStudioClient({study:'bridge'},{mode:'worker',snapshots:'auto',workerFactory:factory(log,{denyShared:true})});
  try{assert.equal(client.snapshotTransport,'transfer');assert.match(client.snapshotFallbackReason,/worker fixture/);assert.equal(log.filter(m=>m.type==='create').length,2);const r=await client.step({ticks:1});r.release();}finally{await client.destroy();}
  await assert.rejects(createStudioClient({study:'bridge'},{mode:'sync',snapshots:'shared'}),{code:'INVALID_PAYLOAD'});
  await assert.rejects(createStudioClient({study:'bridge'},{snapshots:'invalid'}),{code:'INVALID_PAYLOAD'});
  await assert.rejects(createStudioClient({study:'bridge'},{mode:'auto',snapshots:'shared',workerFactory:factory([],{denyShared:true})}),{code:'SHARED_UNAVAILABLE'});
});
