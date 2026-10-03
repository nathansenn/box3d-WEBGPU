import assert from 'node:assert/strict';
import test from 'node:test';
import {GpuStartupBudget} from '../../src/webgpu/startup-budget.ts';
import {GpuLinearWater,GPU_CLOSED_WATER_BACKEND} from '../../src/webgpu/linear-water.ts';
import {createClosedWaterArrays} from '../../src/engine/closed-water.ts';
import {loadMaterialNoiseTexture,loadMaterialAtlasTexture} from '../../src/assets/ktx2.ts';

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const config={cols:9,rows:7,dt:1/240,gravity:9.81,meanDepth:1.5,drag:.28,dx:.5,dz:.5};

test('startup timeouts reject promptly and release a late device exactly once',async()=>{
  const pending=deferred(),stages=[],device={destroyed:0,destroy(){this.destroyed++;}};
  const budget=new GpuStartupBudget({startupTimeoutMs:20,onStartupProgress:stage=>stages.push(stage)},'Renderer');
  await assert.rejects(budget.wait('Creating graphics device',()=>pending.promise,value=>value.destroy()),/Renderer startup timed out during Creating graphics device/);
  pending.resolve(device);await flush();assert.equal(device.destroyed,1);
  await assert.rejects(budget.wait('Creating shaders',()=>{throw new Error('must never start');}),/timed out/);
  assert.deepEqual(stages,['Creating graphics device']);
});

test('startup cancellation blocks new work, rejects pending work, and releases late ownership',async()=>{
  const before=new AbortController();before.abort();let called=false;
  await assert.rejects(new GpuStartupBudget({signal:before.signal}).wait('adapter',()=>{called=true;}),{name:'AbortError'});
  assert.equal(called,false);
  const controller=new AbortController(),pending=deferred(),discarded=[];
  const operation=new GpuStartupBudget({signal:controller.signal}).wait('device',()=>pending.promise,value=>discarded.push(value));
  await flush();controller.abort();await assert.rejects(operation,{name:'AbortError'});
  pending.resolve('late');await flush();assert.deepEqual(discarded,['late']);
});

test('successful startup hands ownership to the caller and ignores later aborts',async()=>{
  const controller=new AbortController(),value={};let discarded=0;
  const budget=new GpuStartupBudget({signal:controller.signal});
  assert.equal(await budget.wait('device',()=>value,()=>discarded++),value);
  controller.abort();await flush();assert.equal(discarded,0);
  for(const startupTimeoutMs of [0,-1,Infinity,NaN,120001])assert.throws(()=>new GpuStartupBudget({startupTimeoutMs}),RangeError);
});

function fakeWaterDevice() {
  const resources=[],diagnostics=deferred();let creates=0;
  globalThis.GPUBufferUsage={STORAGE:128,COPY_DST:8,COPY_SRC:4,UNIFORM:64};
  globalThis.GPUShaderStage={COMPUTE:4};
  const device={resources,diagnostics,queue:{writeBuffer(){},submit(){}},
    createBuffer(d){const buffer={d,destroyed:0,destroy(){this.destroyed++;}};resources.push(buffer);return buffer;},
    createBindGroupLayout:d=>d,createBindGroup:d=>d,createPipelineLayout:d=>d,
    createShaderModule:()=>({getCompilationInfo:()=>diagnostics.promise}),
    createComputePipelineAsync:async d=>{creates++;return d;},
  };
  return {device,pipelineCreates:()=>creates};
}

test('water initialization releases all seven owned buffers when shader validation stalls or is cancelled',async()=>{
  for(const create of [GpuLinearWater.create,GpuLinearWater.createClosed])for(const cancelled of [false,true]) {
    const f=fakeWaterDevice(),controller=new AbortController();
    const operation=create(f.device,config,{},cancelled?{signal:controller.signal}:{startupTimeoutMs:20});
    await flush();if(cancelled)controller.abort();
    await assert.rejects(operation,cancelled?{name:'AbortError'}:/timed out.*shader/);
    assert.equal(f.device.resources.length,7);assert.ok(f.device.resources.every(b=>b.destroyed===1));
    f.device.diagnostics.resolve({messages:[]});await flush();assert.equal(f.pipelineCreates(),0);
  }
});

test('a failed GPU submission does not publish a future water tick or ping-pong field',async()=>{
  for(const create of [GpuLinearWater.create,GpuLinearWater.createClosed]) {
  const f=fakeWaterDevice();f.device.diagnostics.resolve({messages:[]});
  f.device.createCommandEncoder=()=>({beginComputePass:()=>({setBindGroup(){},setPipeline(){},dispatchWorkgroups(){},end(){}}),finish:()=>({})});
  const water=await create(f.device,config),original=water.getFields();
  f.device.queue.submit=()=>{throw new Error('submission failed');};
  assert.throws(()=>water.step(3),/submission failed/);assert.equal(water.tick,0);assert.equal(water.getFields().eta,original.eta);
  water.destroy();assert.ok(f.device.resources.every(b=>b.destroyed===1));
  }
});

test('closed GPU model rejects wall flux before allocation and dispatches two ordered stages per tick',async()=>{
  const f=fakeWaterDevice(),state=createClosedWaterArrays(config);
  state.u[config.cols-1]=1;
  await assert.rejects(GpuLinearWater.createClosed(f.device,config,state),/wall/);assert.equal(f.device.resources.length,0);
  state.u[config.cols-1]=0;f.device.diagnostics.resolve({messages:[]});
  const stages=[];let selected;
  f.device.createCommandEncoder=()=>({beginComputePass:()=>({setBindGroup(){},setPipeline(p){selected=p.compute.entryPoint;},dispatchWorkgroups(){stages.push(selected);},end(){}}),finish:()=>({})});
  const water=await GpuLinearWater.createClosed(f.device,config,state);
  assert.equal(water.backend,GPU_CLOSED_WATER_BACKEND);assert.equal(water.velocityLayout,'east-north-faces');
  assert.equal(water.capabilities.models[0].calibration,'uncalibrated-physical');
  const initial=water.getFields();water.step(3);
  assert.deepEqual(stages,['velocity','continuity','velocity','continuity','velocity','continuity']);
  assert.notEqual(water.getFields().eta,initial.eta);assert.equal(water.tick,3);
  await assert.rejects(GpuLinearWater.fromCheckpoint(f.device,{backend:'unknown',version:1,tick:3,config,state}),/Incompatible/);
  water.destroy();assert.ok(f.device.resources.every(b=>b.destroyed===1));
});

test('cancelled texture loads never allocate fallback textures, including late successful fetches',async()=>{
  const saved=globalThis.fetch;
  try {
    for(const loader of [loadMaterialNoiseTexture,loadMaterialAtlasTexture]) {
      const controller=new AbortController(),pending=deferred();let allocations=0;
      globalThis.fetch=()=>pending.promise;
      const operation=loader({createTexture(){allocations++;throw new Error('must not allocate');}},false,controller.signal);
      controller.abort();pending.resolve({ok:true,arrayBuffer:async()=>new ArrayBuffer(1)});
      await assert.rejects(operation,{name:'AbortError'});assert.equal(allocations,0);
    }
  }finally{globalThis.fetch=saved;}
});
