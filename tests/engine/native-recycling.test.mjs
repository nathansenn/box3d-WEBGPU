import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
const directory=process.env.BOX3D_RECYCLING_ARTIFACT_DIR??'public/box3d';
const factory=async dir=>{
 const {default:make}=await import(pathToFileURL(path.resolve(dir,'box3d.js')));
 const wasmBinary=await fs.readFile(path.resolve(dir,'box3d.wasm'));return()=>make({wasmBinary});
};
const load=await factory(directory);
function rows(world){
 const count=world.bodyCount(),mat=Number(world._b3w_matrices_ptr())/4,color=Number(world._b3w_colors_ptr())/4;
 return Array.from({length:count},(_,i)=>({token:world.bodyHandle(i).token,matrices:[...world.HEAPF32.slice(mat+i*16,mat+(i+1)*16)],colors:[...world.HEAPF32.slice(color+i*4,color+(i+1)*4)]}));
}
const state=world=>({rows:rows(world),count:world.bodyCount(),dynamic:world.dynamicCount(),hash:world.replayHash(),frame:world.frameVersion(),color:world.colorVersion()});
const projectile=world=>world.launchProjectileBody(40,10,0,0,0,0,.25);

test('first, middle, last and static-body removals preserve every surviving token and exact dense row',async()=>{
 const mod=await load(),pool=new NativeWorldPool(mod),world=pool.createWorld();
 try{
  world.createScene({id:0},1,42);const ground=world.bodyHandle(0);let groundAlive=true;
  const initial=Array.from({length:world.bodyCount()},(_,i)=>world.bodyHandle(i));
  for(const target of [initial[1],initial[156],initial[70],ground,...initial]){
   const index=world.bodyIndex(target);if(index===null)continue;
   const before=rows(world),last=before.at(-1),frame=world.frameVersion(),color=world.colorVersion();
   assert.equal(world.destroyBody(target),true);if(target.token===ground.token)groundAlive=false;
   assert.equal(world.bodyIndex(target),null);assert.equal(world.destroyBody(target),false);
   const expected=before.slice(0,-1);if(index<expected.length)expected[index]=last;
   assert.deepEqual(rows(world),expected);assert.equal(world.dynamicCount(),world.bodyCount()-(groundAlive?1:0));
   assert.equal(world.frameVersion(),frame+1);assert.equal(world.colorVersion(),color+1);
   assert.throws(()=>world.applyBodyImpulse(target,2,3,4),error=>error.code==='STALE_BODY');
  }
  assert.equal(world.bodyCount(),0);assert.equal(world.dynamicCount(),0);world.step(1/60,4);
  const body=projectile(world);assert.ok(body);assert.equal(world.bodyIndex(body),0);assert.equal(world.bodyCount(),1);world.step(1/60,4);assert.ok(rows(world).flatMap(row=>row.matrices).every(Number.isFinite));
 }finally{pool.destroy();}
});

test('dead-slot generations survive capacity relocation and scene resets without reviving stale handles',async()=>{
 const mod=await load(),pool=new NativeWorldPool(mod),world=pool.createWorld();
 try{
  world.createScene({id:0},1,42);const handles=Array.from({length:world.bodyCount()},(_,i)=>world.bodyHandle(i));
  for(const i of [1,2,153])world.destroyBody(handles[i]);const before=state(world);
  world.reserveBodyCapacity(16384);assert.deepEqual(state(world),before);
  for(let i=0;i<3;i++)assert.ok(projectile(world));
  const stable=state(world);
  for(const i of [1,2,153]){assert.equal(world.bodyIndex(handles[i]),null);assert.equal(mod._b3w_world_destroy_body(world.handle,handles[i].token),0);assert.equal(mod._b3w_world_apply_body_impulse(world.handle,handles[i].token,100,100,100),0);}
  assert.deepEqual(state(world),stable);world.clear();assert.equal(world.bodyCount(),0);
  world.reserveBodyCapacity(65536);world.createScene({id:0},1,42);
  for(const handle of handles)assert.equal(world.bodyIndex(handle),null);
  assert.equal(world.bodyCount(),157);world.step(1/60,4);assert.ok(rows(world).flatMap(row=>row.matrices).every(Number.isFinite));
 }finally{pool.destroy();}
});

test('typed references reject other worlds, modules, forged values, partial extensions and old artifacts',async()=>{
 const mod=await load(),otherMod=await load(),pool=new NativeWorldPool(mod),otherPool=new NativeWorldPool(otherMod),world=pool.createWorld(),other=pool.createWorld(),foreign=otherPool.createWorld();
 try{
  for(const w of [world,other,foreign])w.createScene({id:0},1,42);
  const ref=world.bodyHandle(1);assert.ok(Object.isFrozen(ref));const stable=state(world);
  for(const invalid of [other.bodyHandle(1),foreign.bodyHandle(1),null,ref.token,{token:ref.token}]){
   for(const operation of [()=>world.bodyIndex(invalid),()=>world.destroyBody(invalid),()=>world.applyBodyImpulse(invalid,1,2,3)])assert.throws(operation,error=>error.code==='INVALID_PAYLOAD');
  }
  for(const index of [-1,world.bodyCount(),NaN,1.5])assert.throws(()=>world.bodyHandle(index),error=>error.code==='INVALID_PAYLOAD');
  for(const value of [NaN,Infinity,1e99])assert.throws(()=>world.applyBodyImpulse(ref,value,0,0),error=>error.code==='INVALID_PAYLOAD');
  assert.deepEqual(state(world),stable);assert.deepEqual(state(other),stable);assert.deepEqual(state(foreign),stable);
  let creates=0;assert.throws(()=>new NativeWorldPool({...mod,_b3w_world_body_index:undefined,_b3w_world_create(){creates++;return 0;}}),error=>error.code==='UNSUPPORTED_BACKEND');assert.equal(creates,0);
  world.destroy();assert.throws(()=>world.destroyBody(ref),error=>error.code==='DISPOSED');
  const replacement=pool.createWorld();replacement.createScene({id:0},1,42);assert.throws(()=>replacement.bodyIndex(ref),error=>error.code==='INVALID_PAYLOAD');
  const oldMod=await (await factory('benchmarks/results/engine-100x/verification-native-capacity-20260910/native-artifacts'))(),oldPool=new NativeWorldPool(oldMod);
  try{const old=oldPool.createWorld();old.createScene({id:0},1,42);assert.equal(old.supportsBodyLifecycle,false);assert.throws(()=>old.bodyHandle(1),error=>error.code==='UNSUPPORTED_BACKEND');}finally{oldPool.destroy();}
 }finally{pool.destroy();otherPool.destroy();}
});

test('64K live storage compacts correctly at the boundary and reference-based impulses follow moved bodies',async()=>{
 const mod=await load(),pool=new NativeWorldPool(mod),world=pool.createWorld(),sibling=pool.createWorld();
 try{
  world.reserveBodyCapacity(65536);world.createScene({id:0},1,42);sibling.createScene({id:150},1,91);const protectedSibling=state(sibling);
  world.spawnRain(65536-world.bodyCount(),256,24);const last=world.bodyHandle(65535),removed=world.bodyHandle(1);
  const pointer=Number(world._b3w_matrices_ptr())/4,lastMatrix=[...world.HEAPF32.slice(pointer+65535*16,pointer+65536*16)];
  assert.equal(projectile(world),null);world.destroyBody(removed);assert.equal(world.bodyIndex(last),1);assert.deepEqual([...world.HEAPF32.slice(pointer+16,pointer+32)],lastMatrix);
  world.applyBodyImpulse(last,10,2,3);world.step(1/240,2);assert.equal(world.bodyIndex(last),1);assert.notDeepEqual([...world.HEAPF32.slice(pointer+16,pointer+32)],lastMatrix);
  const next=projectile(world);assert.ok(next);assert.notEqual(next.token,removed.token);assert.equal(world.bodyCount(),65536);assert.equal(world.dynamicCount(),65535);
  assert.equal(world.bodyIndex(removed),null);assert.deepEqual(state(sibling),protectedSibling);
  assert.ok(world.HEAPF32.slice(Number(world._b3w_matrices_ptr())/4,Number(world._b3w_matrices_ptr())/4+65536*16).every(Number.isFinite));
 }finally{pool.destroy();}
});

if(process.env.BOX3D_RECYCLING_FAULT_TESTS==='1')test('generation exhaustion retires a slot and never wraps to a previously issued token',async()=>{
 const mod=await load(),pool=new NativeWorldPool(mod),world=pool.createWorld();
 try{
  world.createScene({id:0},1,42);const first=world.bodyHandle(1),rawMaximum=mod._b3w_test_exhaust_body_generation(world.handle,first.token),maximum=BigInt.asUintN(64,rawMaximum);
  assert.ok(rawMaximum<0n,'WASM i64 returns signed BigInt bits even for a uint64 C handle');assert.ok(maximum>BigInt(Number.MAX_SAFE_INTEGER));assert.equal(world.bodyIndex(first),null);
  const final=world.bodyHandle(1);assert.equal(final.token,maximum);world.destroyBody(final);
  const next=projectile(world);assert.ok(next);assert.notEqual(next.token&0x1FFFFn,first.token&0x1FFFFn);
  world.reserveBodyCapacity(16384);assert.equal(world.bodyIndex(first),null);assert.equal(world.bodyIndex(final),null);
  assert.equal(mod._b3w_world_destroy_body(world.handle,maximum),0);
 }finally{pool.destroy();}
});

if(process.env.BOX3D_RECYCLING_FAULT_TESTS==='1')test('failed native growth retains the live and dead body-generation table',async()=>{
 const mod=await load(),pool=new NativeWorldPool(mod),world=pool.createWorld();
 try{
  world.createScene({id:0},1,42);const gone=world.bodyHandle(1),survivor=world.bodyHandle(156);world.destroyBody(gone);const before=state(world);
  mod._b3w_test_fail_next_capacity_allocation();assert.throws(()=>world.reserveBodyCapacity(16384),error=>error.code==='ALLOCATION_FAILED');
  assert.deepEqual(state(world),before);assert.equal(world.bodyIndex(gone),null);assert.equal(world.bodyIndex(survivor),1);
  const next=projectile(world);assert.ok(next);assert.notEqual(next.token,gone.token);assert.equal(world.bodyIndex(gone),null);
 }finally{pool.destroy();}
});

test('retained stale references do not keep a destroyed native backend alive',async()=>{
 const {execFileSync}=await import('node:child_process');
 const script=`import fs from 'node:fs';
 import factory from ${JSON.stringify(pathToFileURL(path.resolve(directory,'box3d.js')).href)};
 import {NativeWorldPool} from ${JSON.stringify(new URL('../../src/engine/native-world.ts',import.meta.url).href)};
 const mod=await factory({wasmBinary:fs.readFileSync(${JSON.stringify(path.resolve(directory,'box3d.wasm'))})});
 let pool=new NativeWorldPool(mod),world=pool.createWorld();world.createScene({id:0},1,42);
 const ref=world.bodyHandle(1),weak=new WeakRef(world);pool.destroy();world=null;pool=null;
 for(let i=0;i<24;i++){await new Promise(setImmediate);global.gc();}
 if(!ref.token||weak.deref()!==undefined)throw new Error('Retained stale body reference kept disposed backend alive');
 console.log('Disposed backend collected while stale body reference remains alive');`;
 assert.match(execFileSync(process.execPath,['--expose-gc','--input-type=module','-e',script],{encoding:'utf8',timeout:10000}),/Disposed backend collected/);
});
