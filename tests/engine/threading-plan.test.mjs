import assert from 'node:assert/strict';
import test from 'node:test';
import {AUTO_PHYSICS_WORKER_CEILING,MAX_PHYSICS_WORKERS,planThreading} from '../../src/physics/threading.ts';

const page=(over={})=>({search:'',crossOriginIsolated:true,sharedArrayBuffer:true,hardwareConcurrency:32,...over});

test('an isolated page on a many-core machine gets the automatic worker ceiling',()=>{
  assert.deepEqual(planThreading(page()),{use:true,workers:AUTO_PHYSICS_WORKER_CEILING});
  assert.equal(AUTO_PHYSICS_WORKER_CEILING,8);
});

test('the automatic plan leaves two processors for the page and the GPU',()=>{
  assert.deepEqual(planThreading(page({hardwareConcurrency:6})),{use:true,workers:4});
  assert.deepEqual(planThreading(page({hardwareConcurrency:4})),{use:true,workers:2});
  for(const cores of [3,2,1,0,Number.NaN,Infinity*-1]){
    const plan=planThreading(page({hardwareConcurrency:cores}));
    assert.equal(plan.use,false,`${cores} processors must stay single-threaded`);assert.match(plan.reason,/logical processors/);
  }
});

test('the page must be able to share memory before workers are requested',()=>{
  const noSab=planThreading(page({sharedArrayBuffer:false}));assert.equal(noSab.use,false);assert.match(noSab.reason,/SharedArrayBuffer/);
  const open=planThreading(page({crossOriginIsolated:false}));assert.equal(open.use,false);assert.match(open.reason,/cross-origin isolated/);
  // An explicit request does not override a missing capability.
  assert.equal(planThreading(page({search:'?threads=8',crossOriginIsolated:false})).use,false);
  assert.equal(planThreading(page({search:'?threads=8',sharedArrayBuffer:false})).use,false);
});

test('?threads= turns threading off or picks the worker count',()=>{
  for(const value of ['off','OFF','false','no','0','1',' off ']){
    const plan=planThreading(page({search:`?threads=${value}`}));assert.equal(plan.use,false,value);assert.match(plan.reason,/\?threads=/);
  }
  assert.deepEqual(planThreading(page({search:'?threads=2'})),{use:true,workers:2});
  assert.deepEqual(planThreading(page({search:'?x=1&threads=12'})),{use:true,workers:12});
  assert.deepEqual(planThreading(page({search:'?threads=12',hardwareConcurrency:4})),{use:true,workers:12});
  assert.deepEqual(planThreading(page({search:`?threads=${MAX_PHYSICS_WORKERS+40}`})),{use:true,workers:MAX_PHYSICS_WORKERS});
});

test('unparseable ?threads= values fall back to the automatic plan',()=>{
  for(const value of ['','auto','-3','2.5','two','0x8'])assert.deepEqual(planThreading(page({search:`?threads=${value}`})),{use:true,workers:8},JSON.stringify(value));
});
