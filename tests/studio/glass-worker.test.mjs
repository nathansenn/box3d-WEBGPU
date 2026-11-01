import '../../scripts/register-typescript.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const {glassWorkerHandler}=await import('../../src/studio/material-labs/glass-worker-protocol.ts');
const {GlassWorkerClient}=await import('../../src/studio/material-labs/glass-worker-client.ts');
const {GlassModel}=await import('../../src/studio/material-labs/models.ts');
const settings={size:24,load:25,rate:.4};

test('worker batches exactly reproduce the direct glass model and own transferred arrays',()=>{
  const handle=glassWorkerHandler(),model=new GlassModel(settings),first=handle({type:'reset',generation:0,settings});
  const transferred=structuredClone(first,{transfer:[first.frame.positions.buffer,first.frame.rotations.buffer,first.frame.damage.buffer]});assert.equal(first.frame.positions.length,0);
  for(let request=1;request<=24;request++){
    const response=handle({type:'step',generation:0,request,ticks:4,release:false});for(let i=0;i<4;i++)model.step();
    assert.equal(response.type,'frame');assert.deepEqual(response.frame,model.snapshot());
  }
  assert.equal(transferred.frame.time,0);assert.ok(transferred.frame.positions.length>0);
});

test('worker rejects invalid batches before mutation and drops stale generations',()=>{
  const handle=glassWorkerHandler();handle({type:'reset',generation:0,settings});
  for(const ticks of [0,-1,5,1.5,NaN,Infinity])assert.equal(handle({type:'step',generation:0,request:1,ticks,release:false}).type,'error');
  const frame=handle({type:'step',generation:0,request:1,ticks:1,release:false}).frame;const direct=new GlassModel(settings);direct.step();assert.deepEqual(frame,direct.frame);
  assert.equal(handle({type:'step',generation:0,request:1,ticks:1,release:false}).type,'error');
  handle({type:'reset',generation:1,settings:{...settings,seed:7}});
  assert.equal(handle({type:'step',generation:0,request:2,ticks:1,release:false}),null);assert.equal(handle({type:'reset',generation:0,settings}),null);
  const fresh=handle({type:'step',generation:1,request:1,ticks:1,release:false});assert.equal(fresh.frame.time,1/120);
});

test('changing batch sizes preserves every fixed-step result',()=>{
  const handle=glassWorkerHandler(),model=new GlassModel(settings);handle({type:'reset',generation:0,settings});
  for(let request=1;request<=20;request++){
    const ticks=[1,3,2,4][(request-1)%4],response=handle({type:'step',generation:0,request,ticks,release:false});
    for(let tick=0;tick<ticks;tick++)model.step();
    assert.equal(response.type,'frame');assert.deepEqual(response.frame,model.snapshot());
  }
});

test('client applies backpressure, ignores late frames and terminates its own worker',()=>{
  const original=globalThis.Worker,workers=[];
  class FakeWorker {messages=[];terminated=false;constructor(){workers.push(this);}postMessage(message){this.messages.push(message);}terminate(){this.terminated=true;}respond(message){this.onmessage({data:message});}}
  globalThis.Worker=FakeWorker;
  try{
    const frames=[],errors=[],client=new GlassWorkerClient(new GlassModel(settings).settings,f=>frames.push(f),e=>errors.push(e)),worker=workers[0];
    assert.equal(client.step(2),false);worker.respond({type:'frame',generation:0,request:0,frame:{time:0}});
    assert.equal(client.step(2),true);assert.equal(client.step(2),false);
    worker.respond({type:'frame',generation:0,request:99,frame:{time:99}});assert.equal(frames.length,0);
    worker.respond({type:'frame',generation:0,request:1,frame:{time:2/120}});assert.equal(frames.length,1);
    client.release();assert.equal(client.step(1),true);assert.equal(worker.messages.at(-1).release,true);
    client.dispose();worker.respond({type:'frame',generation:0,request:2,frame:{time:3/120}});assert.equal(frames.length,1);assert.equal(worker.terminated,true);assert.equal(client.step(1),false);assert.deepEqual(errors,[]);
  }finally{globalThis.Worker=original;}
});

test('worker errors stop dispatch and provide an actionable failure',()=>{
  const original=globalThis.Worker;let worker;
  globalThis.Worker=class {terminated=false;constructor(){worker=this;}postMessage(){}terminate(){this.terminated=true;}};
  try{const errors=[],client=new GlassWorkerClient(new GlassModel(settings).settings,()=>assert.fail('unexpected frame'),e=>errors.push(e));worker.onmessage({data:{type:'error',generation:0,request:0,message:'Fixture initialization failed'}});assert.equal(worker.terminated,true);assert.deepEqual(errors,['Fixture initialization failed']);assert.equal(client.step(1),false);}
  finally{globalThis.Worker=original;}
});

test('dense work reduces batch delivery delay and recovers without changing fixed ticks',()=>{
  const original=globalThis.Worker;let worker,now=1000;
  globalThis.Worker=class {messages=[];constructor(){worker=this;}postMessage(m){this.messages.push(m);}terminate(){}respond(data){this.onmessage({data});}};
  try{
    const client=new GlassWorkerClient(new GlassModel(settings).settings,()=>{},e=>assert.fail(e),()=>now);
    worker.respond({type:'frame',generation:0,request:0,frame:{time:0}});assert.equal(client.maxBatchTicks,4);
    assert.equal(client.step(4),true);now+=320;
    worker.respond({type:'frame',generation:0,request:1,frame:{time:4/120}});assert.equal(client.maxBatchTicks,1);
    assert.equal(client.step(1),true);assert.equal(client.step(4),false);
    now+=800;worker.respond({type:'frame',generation:0,request:99,frame:{time:99}});assert.equal(client.maxBatchTicks,1);
    now-=799;worker.respond({type:'frame',generation:0,request:2,frame:{time:5/120}});assert.equal(client.maxBatchTicks,1);
    let ticks=5;
    for(let request=3;request<=16;request++){
      const batch=client.maxBatchTicks;assert.ok(batch>=1&&batch<=4);assert.equal(client.step(batch),true);ticks+=batch;now+=batch;
      worker.respond({type:'frame',generation:0,request,frame:{time:ticks/120}});
      assert.equal(worker.messages.at(-1).ticks,batch);
    }
    assert.equal(client.maxBatchTicks,4);client.dispose();
  }finally{globalThis.Worker=original;}
});
