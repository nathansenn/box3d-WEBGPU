import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldBackend,NativeWorldPool} from '../../src/engine/native-world.ts';

const artifact=resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR??'public/box3d');
const {default:factory}=await import(pathToFileURL(resolve(artifact,'box3d.js')));
const binary=await readFile(resolve(artifact,'box3d.wasm'));
const load=()=>factory({wasmBinary:binary});
const code=expected=>error=>error.code===expected;
const matrices=world=>world.HEAPF32.slice(Number(world._b3w_matrices_ptr())/4,Number(world._b3w_matrices_ptr())/4+world.bodyCount()*16);
const legacyMatrices=mod=>mod.HEAPF32.slice(Number(mod._b3w_matrices_ptr())/4,Number(mod._b3w_matrices_ptr())/4+mod._b3w_body_count()*16);

test('native world ABI rejects missing exports, wrong versions and failed construction without leaking a slot',async()=>{
  assert.throws(()=>new NativeWorldPool({}),code('INVALID_BACKEND'));
  const mod=await load();
  assert.throws(()=>new NativeWorldPool({...mod,_b3w_world_step:undefined}),code('UNSUPPORTED_BACKEND'));
  assert.throws(()=>new NativeWorldPool({...mod,_b3w_world_api_version:()=>99}),code('UNSUPPORTED_BACKEND'));
  let rejectedHandle=0;
  const broken={...mod,_b3w_world_create:()=>rejectedHandle=mod._b3w_world_create(),_b3w_world_matrices_ptr:()=>3};
  assert.throws(()=>new NativeWorldBackend(broken),code('INVALID_BACKEND'));
  assert.equal(mod._b3w_world_valid(rejectedHandle),0,'failed constructor must release its own native context');
  assert.throws(()=>new NativeWorldBackend({...mod,_b3w_world_create:()=>0,_b3w_world_last_create_error:()=>2}),code('ALLOCATION_FAILED'));
});

test('interleaved native worlds retain exact default trajectories while another world resets and changes seed',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),a=pool.createWorld(),b=pool.createWorld();
  try {
    mod._b3w_create_scene(0,2,9988);a.createScene({id:0},2,9988);b.createScene({id:799},1,1122);
    assert.notEqual(a._b3w_matrices_ptr(),b._b3w_matrices_ptr());
    assert.notEqual(a._b3w_colors_ptr(),b._b3w_colors_ptr());
    for(let tick=0;tick<120;tick++) {
      if(tick===20){a.kick(6);mod._b3w_kick_stack(6);}
      if(tick===40){a.explode(0,3,0,8,9);mod._b3w_explode(0,3,0,8,9);b.createScene({id:450},2,3344);}
      if(tick===50){assert.equal(a.launchProjectile(-8,5,0,12,2,0,.5),mod._b3w_launch_projectile(-8,5,0,12,2,0,.5));}
      if(tick===60){assert.equal(a.spawnRain(5,8,14),mod._b3w_spawn_rain(5,8,14));}
      if(tick===80){a.applyImpulse(1,2,3,4);mod._b3w_apply_impulse(1,2,3,4);}
      b.step(1/120,2);a.step(1/60,4);mod._b3w_step(1/60,4);
      assert.deepEqual(matrices(a),legacyMatrices(mod),`tick ${tick}`);
      assert.equal(a.replayHash(),mod._b3w_replay_hash()>>>0);
    }
    const before=matrices(a),version=a.frameVersion(),hash=a.replayHash();
    b.clear();assert.equal(b.bodyCount(),0);b.destroy();
    assert.deepEqual(matrices(a),before);assert.equal(a.frameVersion(),version);assert.equal(a.replayHash(),hash);
    assert.equal(pool.size,1);
  }finally{pool.destroy();mod._b3w_destroy();}
});

test('native slot reuse rejects every stale mutation and keeps the replacement and compatibility world intact',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),old=pool.createWorld(),handle=old.handle;
  mod._b3w_create_scene(50,1,42);old.createScene({id:0},1,7);old.destroy();
  const live=pool.createWorld();
  try {
    live.createScene({id:799},1,42);const before=matrices(live),defaultBefore=legacyMatrices(mod),version=live.frameVersion();
    assert.notEqual(live.handle,handle);assert.equal(mod._b3w_world_valid(handle),0);
    assert.equal(mod._b3w_world_create_scene(handle,1,1,1),-1);
    assert.equal(mod._b3w_world_step(handle,1/60,4),0);
    assert.equal(mod._b3w_world_sync_transforms(handle),0);
    assert.equal(mod._b3w_world_kick_stack(handle,10),0);
    assert.equal(mod._b3w_world_explode(handle,0,0,0,10,10),0);
    assert.equal(mod._b3w_world_apply_impulse(handle,1,1,2,3),0);
    assert.equal(mod._b3w_world_launch_projectile(handle,0,2,0,1,2,3,1),-1);
    assert.equal(mod._b3w_world_spawn_rain(handle,20,10,10),-1);
    assert.equal(mod._b3w_world_clear(handle),0);assert.equal(mod._b3w_world_destroy(handle),0);
    assert.equal(mod._b3w_world_matrices_ptr(handle),0);assert.equal(mod._b3w_world_colors_ptr(handle),0);
    for(const action of [()=>old.step(1/60,4),()=>old.bodyCount(),()=>old.HEAPF32,()=>old._b3w_matrices_ptr(),()=>old.clear()])assert.throws(action,code('DISPOSED'));
    old.destroy();assert.deepEqual(matrices(live),before);assert.deepEqual(legacyMatrices(mod),defaultBefore);assert.equal(live.frameVersion(),version);
  }finally{pool.destroy();mod._b3w_destroy();}
});

test('native pools enforce module capacity and release only their own worlds',async()=>{
  const mod=await load(),first=new NativeWorldPool(mod),second=new NativeWorldPool(mod),peer=second.createWorld();
  try {
    peer.createScene({id:150},1,55);const before=matrices(peer);
    for(let i=1;i<first.capacity;i++)first.createWorld();
    assert.equal(first.size,first.capacity-1);
    assert.throws(()=>first.createWorld(),code('WORLD_CAPACITY'));
    assert.equal(mod._b3w_world_last_create_error(),1);
    first.destroy();first.destroy();assert.equal(first.size,0);
    assert.deepEqual(matrices(peer),before);peer.step(1/60,4);
    assert.throws(()=>first.createWorld(),code('DISPOSED'));
    const replacement=second.createWorld();assert.equal(second.size,2);replacement.destroy();assert.equal(second.size,1);
  }finally{first.destroy();second.destroy();}
});

test('native heap growth refreshes borrowed views without relocating a surviving world stream',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),world=pool.createWorld();let allocation=0;
  try {
    world.createScene({id:0},1,42);const before=matrices(world),pointer=world._b3w_matrices_ptr(),oldHeap=world.HEAPF32;
    allocation=mod._malloc(oldHeap.byteLength+1024*1024);assert.ok(allocation>0);
    assert.notEqual(world.HEAPF32.buffer,oldHeap.buffer);assert.equal(world.HEAPF32,mod.HEAPF32);
    assert.equal(world._b3w_matrices_ptr(),pointer);assert.deepEqual(matrices(world),before);
    world.step(1/60,4);assert.ok(matrices(world).every(Number.isFinite));
  }finally{if(allocation)mod._free(allocation);pool.destroy();}
});

test('native adapter rejects invalid and float32-overflow inputs before touching simulation state',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),world=pool.createWorld();
  try {
    world.createScene({id:0},1,42);const before=matrices(world),hash=world.replayHash(),version=world.frameVersion(),count=world.bodyCount();
    const invalid=[()=>world.step(NaN,4),()=>world.step(Infinity,4),()=>world.step(Number.MIN_VALUE,4),()=>world.step(1/60,17),
      ()=>world.kick(-1),()=>world.kick(Number.MAX_VALUE),()=>world.explode(0,NaN,0,8,9),()=>world.launchProjectile(0,2,0,1,2,3,Infinity),
      ()=>world.spawnRain(world.maxBodies+1,8,10),()=>world.applyImpulse(-1,1,2,3),()=>world.applyImpulse(1,Infinity,0,0),
      ()=>world.createScene({id:800},1,42),()=>world.createScene({id:0},1,Infinity)];
    for(const call of invalid)assert.throws(call,code('INVALID_PAYLOAD'));
    assert.equal(world.spawnRain(0,8,10),0);assert.equal(world.bodyCount(),count);
    assert.equal(world.frameVersion(),version);assert.equal(world.replayHash(),hash);assert.deepEqual(matrices(world),before);
  }finally{pool.destroy();}
});

test('ten thousand context lifecycles retain bounded heap and never revive an old generation',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),handles=new Set();
  const warm=pool.createWorld();warm.destroy();const bytes=mod.HEAPF32.byteLength;
  for(let i=0;i<10000;i++){
    const world=pool.createWorld();assert.ok(!handles.has(world.handle));handles.add(world.handle);
    world.destroy();assert.equal(mod._b3w_world_valid(world.handle),0);assert.equal(pool.size,0);
  }
  assert.equal(mod.HEAPF32.byteLength,bytes,'empty-context churn must reuse released native allocation');pool.destroy();
});

test('the original fixed-capacity world artifact remains supported without claiming buffer growth',async()=>{
  const directory=resolve('benchmarks/results/engine-100x/runs/native-worlds-20260910-02/candidate/public/box3d');
  const {default:oldFactory}=await import(pathToFileURL(resolve(directory,'box3d.js')));
  const old=await oldFactory({wasmBinary:await readFile(resolve(directory,'box3d.wasm'))}),pool=new NativeWorldPool(old),world=pool.createWorld();
  try{
    world.createScene({id:0},1,42);const before=matrices(world),hash=world.replayHash();
    assert.deepEqual(world.capacityInfo(),{capacity:4096,maxCapacity:4096,growable:false,bufferVersion:null,bridgeBufferBytes:null});
    assert.equal(world.reserveBodyCapacity(4096),4096);assert.throws(()=>world.reserveBodyCapacity(16384),code('UNSUPPORTED_BACKEND'));
    assert.equal(world.replayHash(),hash);assert.deepEqual(matrices(world),before);world.step(1/60,4);
  }finally{pool.destroy();}
});

test('partial native capacity extensions are rejected before creating a context',async()=>{
  const mod=await load();let creations=0;
  const partial={...mod,_b3w_world_create:()=>{creations++;return mod._b3w_world_create();},_b3w_world_reserve:()=>16384,
    _b3w_world_buffer_version:undefined,_b3w_world_storage_bytes:undefined};
  assert.throws(()=>new NativeWorldPool(partial),code('UNSUPPORTED_BACKEND'));assert.equal(creations,0);
});
