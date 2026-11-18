import assert from 'node:assert/strict';import fs from 'node:fs';import test from 'node:test';
import factory from '../../public/box3d/box3d.js';import {NativeWorldPool} from '../../src/engine/native-world.ts';
test('removing a sleeping body support wakes its survivor and resumes gravity-driven stepping',async()=>{
 const mod=await factory({wasmBinary:fs.readFileSync(new URL('../../public/box3d/box3d.wasm',import.meta.url))}),pool=new NativeWorldPool(mod),world=pool.createWorld();
 try{
  world.createScene({id:0},1,42);const ground=world.bodyHandle(0);
  while(world.bodyCount()>1)world.destroyBody(world.bodyHandle(world.bodyCount()-1));
  const box=world.launchProjectileBody(0,3,0,0,0,0,.5);assert.ok(box);
  for(let i=0;i<1200&&world.awakeCount()>0;i++)world.step(1/60,4);
  assert.equal(world.awakeCount(),0,'body must settle before testing support removal');
  const y=()=>world.HEAPF32[Number(world._b3w_matrices_ptr())/4+world.bodyIndex(box)*16+13],before=y();
  assert.equal(world.destroyBody(ground),true);assert.equal(world.bodyIndex(box),0);assert.ok(world.awakeCount()>0,'SDK destruction must wake the formerly supported body');
  for(let i=0;i<12;i++)world.step(1/60,4);assert.ok(y()<before-.1,'sleeping early-out must not strand the body above the removed support');
 }finally{pool.destroy();}
});
