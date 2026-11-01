import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';

const artifact=process.env.BOX3D_CAPACITY_ARTIFACT_DIR??'public/box3d';
const loadFactory=async directory=>{
  const {default:factory}=await import(pathToFileURL(path.resolve(directory,'box3d.js')));
  const wasmBinary=await fs.readFile(path.resolve(directory,'box3d.wasm'));
  return ()=>factory({wasmBinary});
};
const load=await loadFactory(artifact),loadBaseline=await loadFactory('benchmarks/baselines/native-worlds-before-20260910/public/box3d');
function snapshot(mod,handle){
  const call=(name,...args)=>handle===undefined?mod['_b3w_'+name](...args):mod['_b3w_world_'+name](handle,...args);
  const count=call('body_count'),heap=mod.HEAPF32;
  const bytes=(name,words)=>Buffer.from(new Uint8Array(heap.buffer,Number(call(name)),words*4));
  return {count,dynamic:call('dynamic_count'),hash:call('replay_hash')>>>0,frame:call('transform_version')>>>0,color:call('color_version')>>>0,
    matrices:bytes('matrices_ptr',count*16),colors:bytes('colors_ptr',count*4)};
}

test('native growth preserves exact live state and continuation without invalidating a sibling or compatibility world',async()=>{
  const mod=await load(),old=await loadBaseline(),handle=mod._b3w_world_create(),sibling=mod._b3w_world_create();
  try{
    old._b3w_create_scene(0,1,42);mod._b3w_world_create_scene(handle,0,1,42);mod._b3w_world_create_scene(sibling,150,1,91);mod._b3w_create_scene(400,1,12);
    const siblingBefore=snapshot(mod,sibling),defaultBefore=snapshot(mod);
    for(const request of [4097,16385]){
      const before=snapshot(mod,handle),pointer=mod._b3w_world_matrices_ptr(handle),version=mod._b3w_world_buffer_version(handle);
      assert.equal(mod._b3w_world_reserve(handle,request),request===4097?16384:65536);
      assert.notEqual(mod._b3w_world_matrices_ptr(handle),pointer);assert.equal(mod._b3w_world_buffer_version(handle),version+1);
      assert.deepEqual(snapshot(mod,handle),before);
      for(let tick=0;tick<60;tick++){
        old._b3w_step(1/60,4);mod._b3w_world_step(handle,1/60,4);
        assert.deepEqual(snapshot(mod,handle),snapshot(old));
      }
      assert.deepEqual(snapshot(mod,sibling),siblingBefore);assert.deepEqual(snapshot(mod),defaultBefore);
    }
    const before=snapshot(mod,handle),pointer=mod._b3w_world_matrices_ptr(handle),version=mod._b3w_world_buffer_version(handle);
    assert.equal(mod._b3w_world_reserve(handle,4096),65536,'reserving smaller capacity must not shrink or relocate');
    for(const value of [0,-1,65537,2147483647,NaN,Infinity])assert.equal(mod._b3w_world_reserve(handle,value),-2);
    assert.equal(mod._b3w_world_matrices_ptr(handle),pointer);assert.equal(mod._b3w_world_buffer_version(handle),version);assert.deepEqual(snapshot(mod,handle),before);
  }finally{mod._b3w_world_destroy(handle);mod._b3w_world_destroy(sibling);mod._b3w_destroy();old._b3w_destroy();}
});

test('4096, 16384 and 65536 bodies stage completely, step finitely and report exact capacity boundaries',async()=>{
  const mod=await load(),handle=mod._b3w_world_create();
  try{
    mod._b3w_world_create_scene(handle,0,1,42);
    for(const capacity of [4096,16384,65536]){
      assert.equal(mod._b3w_world_reserve(handle,capacity),capacity);
      const count=mod._b3w_world_body_count(handle),added=mod._b3w_world_spawn_rain(handle,capacity-count,256,24);
      assert.equal(added,capacity-count);assert.equal(mod._b3w_world_body_count(handle),capacity);
      assert.equal(mod._b3w_world_max_bodies(handle),capacity);assert.equal(mod._b3w_world_dynamic_count(handle),capacity-1);
      assert.equal(mod._b3w_world_spawn_rain(handle,1,256,24),0);
      assert.equal(mod._b3w_world_launch_projectile(handle,0,2,0,1,2,3,.5),-1);
      mod._b3w_world_step(handle,1/240,2);
      const state=snapshot(mod,handle);assert.equal(state.matrices.byteLength,capacity*64);assert.equal(state.colors.byteLength,capacity*16);
      assert.ok(new Float32Array(state.matrices.buffer,state.matrices.byteOffset,state.matrices.length/4).every(Number.isFinite));
      assert.ok(new Float32Array(state.colors.buffer,state.colors.byteOffset,state.colors.length/4).every(Number.isFinite));
      assert.ok(mod._b3w_world_storage_bytes(handle)>=capacity*80);
    }
    mod._b3w_world_clear(handle);assert.equal(mod._b3w_world_body_count(handle),0);assert.equal(mod._b3w_world_max_bodies(handle),65536);
  }finally{mod._b3w_world_destroy(handle);}
  assert.equal(mod._b3w_world_reserve(handle,4096),-1);assert.equal(mod._b3w_world_buffer_version(handle),0);assert.equal(mod._b3w_world_storage_bytes(handle),0);
});

test('growing and destroying contexts reuses bounded native storage',async()=>{
  const mod=await load();let warmBytes=0;
  for(let cycle=0;cycle<132;cycle++){
    const handle=mod._b3w_world_create();assert.ok(handle);assert.equal(mod._b3w_world_reserve(handle,65536),65536);
    mod._b3w_world_create_scene(handle,50,1,42);mod._b3w_world_step(handle,1/60,4);mod._b3w_world_destroy(handle);
    if(cycle===3)warmBytes=mod.HEAPF32.byteLength;
    if(cycle>3)assert.equal(mod.HEAPF32.byteLength,warmBytes);
  }
});

test('the typed adapter refreshes relocated streams, including growth requested by a raw native caller',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),world=pool.createWorld();
  try{
    world.createScene({id:0},1,42);const before=snapshot(mod,world.handle),firstPointer=world._b3w_matrices_ptr();
    assert.equal(world.capacityInfo().growable,true);assert.equal(world.reserveBodyCapacity(4097),16384);
    assert.equal(world.maxBodies,16384);assert.notEqual(world._b3w_matrices_ptr(),firstPointer);
    assert.deepEqual(snapshot(mod,world.handle),before);
    const secondPointer=world._b3w_matrices_ptr();assert.equal(mod._b3w_world_reserve(world.handle,16385),65536);
    assert.notEqual(world._b3w_matrices_ptr(),secondPointer,'raw growth must not leave a cached freed pointer');
    assert.equal(world._b3w_colors_ptr(),mod._b3w_world_colors_ptr(world.handle));assert.equal(world.maxBodies,65536);
    assert.equal(world.capacityInfo().bridgeBufferBytes,mod._b3w_world_storage_bytes(world.handle));
    assert.deepEqual(snapshot(mod,world.handle),before);
    assert.equal(world.spawnRain(5000,256,24),5000);world.step(1/240,2);const stable=snapshot(mod,world.handle);
    for(const request of [0,-1,65537,1.5,NaN,Infinity])assert.throws(()=>world.reserveBodyCapacity(request),error=>error.code==='INVALID_PAYLOAD');
    assert.deepEqual(snapshot(mod,world.handle),stable);
  }finally{pool.destroy();}
});

if(process.env.BOX3D_CAPACITY_FAULT_TESTS==='1')test('allocation failure leaves live state intact and releases failed constructor allocations',async()=>{
  const mod=await load();assert.equal(typeof mod._b3w_test_fail_next_capacity_allocation,'function');
  const handle=mod._b3w_world_create();mod._b3w_world_create_scene(handle,0,1,42);
  try{
    const before=snapshot(mod,handle),pointer=mod._b3w_world_matrices_ptr(handle),version=mod._b3w_world_buffer_version(handle);
    mod._b3w_test_fail_next_capacity_allocation();assert.equal(mod._b3w_world_reserve(handle,65536),-3);
    assert.equal(mod._b3w_world_max_bodies(handle),4096);assert.equal(mod._b3w_world_matrices_ptr(handle),pointer);assert.equal(mod._b3w_world_buffer_version(handle),version);
    assert.deepEqual(snapshot(mod,handle),before);
    mod._b3w_test_fail_next_capacity_allocation();assert.equal(mod._b3w_world_create(),0);assert.equal(mod._b3w_world_last_create_error(),2);
    const rest=[];try{for(let i=1;i<mod._b3w_world_capacity();i++){const next=mod._b3w_world_create();assert.ok(next);rest.push(next);}}
    finally{for(const h of rest)mod._b3w_world_destroy(h);}
    assert.deepEqual(snapshot(mod,handle),before);
    assert.equal(mod._b3w_world_reserve(handle,65536),65536);mod._b3w_world_step(handle,1/60,4);
  }finally{mod._b3w_world_destroy(handle);}
});

if(process.env.BOX3D_CAPACITY_FAULT_TESTS==='1')test('typed capacity errors preserve the owned world and do not leak pool slots',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),world=pool.createWorld();
  try{
    world.createScene({id:0},1,42);const before=snapshot(mod,world.handle),pointer=world._b3w_matrices_ptr();
    mod._b3w_test_fail_next_capacity_allocation();assert.throws(()=>world.reserveBodyCapacity(65536),error=>error.code==='ALLOCATION_FAILED');
    assert.equal(world.maxBodies,4096);assert.equal(world._b3w_matrices_ptr(),pointer);assert.deepEqual(snapshot(mod,world.handle),before);
    mod._b3w_test_fail_next_capacity_allocation();assert.throws(()=>pool.createWorld(),error=>error.code==='ALLOCATION_FAILED');assert.equal(pool.size,1);
    world.reserveBodyCapacity(65536);assert.equal(world.maxBodies,65536);
  }finally{pool.destroy();}
});
