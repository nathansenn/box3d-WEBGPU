import assert from 'node:assert/strict';
import test from 'node:test';
import {InstancePartition} from '../../src/webgpu/instance-partition.ts';

globalThis.GPUBufferUsage={UNIFORM:64,COPY_DST:8,STORAGE:128,INDIRECT:256,COPY_SRC:4};
globalThis.GPUShaderStage={VERTEX:1,COMPUTE:4};
function fixture(failAt=Infinity) {
  const buffers=[],writes=[];
  return {buffers,writes,device:{
    queue:{writeBuffer(...args){writes.push(args);}},
    createBuffer(d){if(buffers.length===failAt)throw new Error('allocation failed');const b={d,destroyed:0,destroy(){this.destroyed++;}};buffers.push(b);return b;},
    createBindGroupLayout:d=>d,createBindGroup:d=>d,createPipelineLayout:d=>d,
    createShaderModule:()=>({getCompilationInfo:async()=>({messages:[]})}),createComputePipelineAsync:async d=>d,
  }};
}
test('partition publication waits for submission, preserves invalidations and bounds capacity',async()=>{
  const f=fixture(),p=await InstancePartition.create(f.device,65,{},{}),calls=[];
  const pass={setBindGroup(){},setPipeline(v){this.entry=v.compute.entryPoint;},dispatchWorkgroups(n){calls.push([this.entry,n]);}};
  assert.throws(()=>p.needsUpdate(-1),RangeError);assert.throws(()=>p.needsUpdate(66),RangeError);assert.throws(()=>p.needsUpdate(.5),RangeError);
  p.encode(pass,65,36);assert.equal(p.needsUpdate(65),true,'An unsubmitted command buffer must not make the cache current.');
  assert.deepEqual(calls,[['localRanks',2],['groupOffsets',1],['scatter',2]]);
  p.submitted(65,true);assert.equal(p.needsUpdate(65),false);assert.equal(p.builds,1);
  p.submitted(65,false);assert.equal(p.reuses,1);p.invalidate();assert.equal(p.needsUpdate(65),true);
  calls.length=0;p.encode(pass,0,36);assert.deepEqual(calls,[['groupOffsets',1]],'Empty scenes must clear both indirect counts.');
  p.dispose();p.dispose();assert.ok(f.buffers.every(b=>b.destroyed===1));assert.throws(()=>p.needsUpdate(0),/disposed/);
});
test('partial partition allocation failures release their resources',async()=>{
  const f=fixture(3);await assert.rejects(InstancePartition.create(f.device,64,{},{}),/allocation failed/);
  assert.ok(f.buffers.every(b=>b.destroyed===1));
});
