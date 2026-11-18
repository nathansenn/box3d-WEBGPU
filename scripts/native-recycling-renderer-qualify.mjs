import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {mat4Perspective,mat4LookAt,mat4Multiply} from '../src/math.ts';
export async function qualifyNativeRecycling({renderer,canvas,readPresentedPixels,settleTiming,runtimeErrors,root,dawnBackend,engineSourceIdentity,quality}){
 assert.notEqual(dawnBackend,'null');
 const candidateRoot=path.resolve(process.env.BOX3D_RECYCLING_SOURCE_ROOT??root),directory=path.resolve(process.env.BOX3D_RECYCLING_ARTIFACT_DIR??path.join(root,'public/box3d'));
 const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
 const sources=[...engineSourceIdentity,...['scripts/native-recycling-renderer-qualify.mjs','src/math.ts'].map(file=>({file,sha256:sha(fs.readFileSync(path.join(root,file)))}))];
 const nativeSources=['wasm/box3d_web.c','wasm/CMakeLists.txt','src/engine/native-world.ts','src/engine/contracts.ts'].map(file=>({file,sha256:sha(fs.readFileSync(path.join(candidateRoot,file)))}));
 const artifacts=['box3d.js','box3d.wasm'].map(file=>({file,sha256:sha(fs.readFileSync(path.join(directory,file)))}));
 const {NativeWorldPool}=await import(pathToFileURL(path.join(candidateRoot,'src/engine/native-world.ts')));
 const {default:factory}=await import(pathToFileURL(path.join(directory,'box3d.js'))),mod=await factory({wasmBinary:fs.readFileSync(path.join(directory,'box3d.wasm'))});
 assert.equal(mod._b3w_test_exhaust_body_generation,undefined);assert.equal(mod._b3w_test_fail_next_capacity_allocation,undefined);
 const pool=new NativeWorldPool(mod),world=pool.createWorld(),sibling=pool.createWorld(),cases=[];
 async function read(buffer,size){const stage=renderer.device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST});try{const encoder=renderer.device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,0,stage,0,size);renderer.device.queue.submit([encoder.finish()]);await stage.mapAsync(GPUMapMode.READ);return new Uint8Array(stage.getMappedRange()).slice();}finally{stage.unmap();stage.destroy();}}
 async function check(label){
  const count=world.bodyCount(),uploaded=renderer.uploadInstances(world,count);renderer.render(count,[]);await renderer.device.queue.onSubmittedWorkDone();const pixels=await readPresentedPixels();
  const heap=new Float32Array(count*20);
  if(count){
   heap.set(world.HEAPF32.subarray(Number(world._b3w_matrices_ptr())/4,Number(world._b3w_matrices_ptr())/4+count*16));
   heap.set(world.HEAPF32.subarray(Number(world._b3w_colors_ptr())/4,Number(world._b3w_colors_ptr())/4+count*4),count*16);
   assert.deepEqual(await read(renderer.matrixBuffer,count*64),new Uint8Array(heap.buffer,0,count*64));
   assert.deepEqual(await read(renderer.colorBuffer,count*16),new Uint8Array(heap.buffer,count*64,count*16));
  }
  const copied={HEAPF32:heap,_b3w_matrices_ptr:()=>0,_b3w_colors_ptr:()=>count*64,_b3w_body_count:()=>count,_b3w_max_bodies:()=>count,frameVersion:()=>1,colorVersion:()=>1};
  renderer.uploadInstances(copied,count);renderer.render(count,[]);await renderer.device.queue.onSubmittedWorkDone();assert.deepEqual(await readPresentedPixels(),pixels);
  cases.push({label,count,dynamic:world.dynamicCount(),hash:world.replayHash(),uploadedBytes:uploaded,verifiedStreamBytes:count*80,streamSha256:sha(new Uint8Array(heap.buffer)),pixelsSha256:sha(pixels),copiedPixelsExact:true});return pixels;
 }
 try{
  world.createScene({id:0},1,42);sibling.createScene({id:150},1,91);const protectedSibling=sibling.replayHash();
  renderer.uploadSurface(null);renderer.uploadRopeGrid(null,0);renderer.invalidateDynamicCaches();canvas.clientWidth=256;canvas.clientHeight=192;
  const eye=[18,14,24],view=mat4Multiply(mat4Perspective(Math.PI/3,256/192,.1,200),mat4LookAt(eye,[0,4,0],[0,1,0]));
  renderer.writeSceneUniforms({viewProjection:view,lightViewProjection:view,cameraPosition:eye,lightDirection:[.42,-.84,.34],fogColor:[.055,.085,.14],timeSeconds:2,
   quality:{...quality,sampleCount:1,shadowMapSize:1024,shadowTapCount:1,resolutionScale:1,shadowStrength:0,bloomStrength:0}});
  const initial=await check('initial 157 bodies'),last=world.bodyHandle(156),removed=[world.bodyHandle(1),world.bodyHandle(80),world.bodyHandle(152)];
  world.destroyBody(removed[0]);assert.equal(world.bodyIndex(last),1);await check('last body moves to row 1');
  world.destroyBody(removed[1]);world.destroyBody(removed[2]);await check('three removals');
  const newBody=world.launchProjectileBody(0,6,0,0,0,0,1.25);assert.ok(newBody);assert.notEqual(newBody.token,removed[2].token);const spawned=await check('slot reused for projectile');
  for(const ref of removed){assert.equal(world.bodyIndex(ref),null);assert.equal(world.destroyBody(ref),false);assert.throws(()=>world.applyBodyImpulse(ref,100,100,100),error=>error.code==='STALE_BODY');}
  assert.deepEqual(await check('stale actions leave replacement unchanged'),spawned);
  const row=world.bodyIndex(last);await renderer.reserveInstanceCapacity(16384);world.reserveBodyCapacity(16384);assert.equal(world.bodyIndex(last),row);assert.deepEqual(await check('growth retains stable references'),spawned);
  world.applyBodyImpulse(newBody,5,2,0);for(let tick=0;tick<12;tick++)world.step(1/60,4);const stepped=await check('reference impulse and 12 ticks');assert.notDeepEqual(stepped,spawned);
  assert.equal(sibling.replayHash(),protectedSibling);sibling.destroy();assert.deepEqual(await check('sibling destroyed'),stepped);
  while(world.bodyCount())world.destroyBody(world.bodyHandle(0));await check('all bodies removed');assert.equal(world.bodyIndex(last),null);
  world.createScene({id:0},1,42);assert.equal(world.bodyIndex(newBody),null);assert.deepEqual(await check('reset does not revive old references'),initial);
  await settleTiming();assert.deepEqual(runtimeErrors,[]);const adapter=await navigator.gpu.requestAdapter(),info=adapter?.info??{};
  const identity={vendor:info.vendor??null,architecture:info.architecture??null,device:info.device??null,description:info.description??null,isFallbackAdapter:info.isFallbackAdapter??adapter?.isFallbackAdapter??null};assert.equal(identity.isFallbackAdapter,false);
  for(const source of sources)assert.equal(sha(fs.readFileSync(path.join(root,source.file))),source.sha256);for(const source of nativeSources)assert.equal(sha(fs.readFileSync(path.join(candidateRoot,source.file))),source.sha256);
  fs.writeFileSync(path.resolve(process.env.WEBGPU_NATIVE_RECYCLING_EVIDENCE),JSON.stringify({schema:'box3d.native-recycling-renderer-qualification/1',status:'passed',capturedAt:new Date().toISOString(),dawnBackend,adapter:identity,mode:renderer.instancePartitionInfo().mode,sources,nativeSources,artifacts,cases,uncapturedWebGpuErrors:runtimeErrors.length,scope:'Exact native/GPU stream bytes and copied-stream pixels after compaction, slot reuse, stale actions, growth, stepping, deletion and reset. No speedup claim.'},null,2)+'\n',{flag:'wx'});
 }finally{pool.destroy();}
}
