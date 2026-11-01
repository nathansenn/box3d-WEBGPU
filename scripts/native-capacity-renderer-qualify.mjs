/** Local hardware capacity evidence. Queue waits occur in measurement/readback
 * only; renderer growth and ordinary rendering do not wait for completion. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../src/engine/native-world.ts';
import {mat4Perspective,mat4LookAt,mat4Multiply} from '../src/math.ts';

export async function qualifyNativeCapacity({renderer,canvas,readPresentedPixels,settleTiming,runtimeErrors,root,dawnBackend,engineSourceIdentity,quality}) {
  assert.notEqual(dawnBackend,'null','Capacity evidence requires a physical GPU.');
  const sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
  const directory=path.resolve(process.env.BOX3D_CAPACITY_ARTIFACT_DIR??path.join(root,'public/box3d'));
  const candidateRoot=path.resolve(process.env.BOX3D_CAPACITY_SOURCE_ROOT??root);
  const sourceFiles=['src/engine/native-world.ts','src/math.ts','scripts/native-capacity-renderer-qualify.mjs'];
  const sources=[...engineSourceIdentity,...sourceFiles.map(file=>({file,sha256:sha(fs.readFileSync(path.join(root,file)))}))];
  const nativeSources=['wasm/box3d_web.c','wasm/CMakeLists.txt'].map(file=>({file,sha256:sha(fs.readFileSync(path.join(candidateRoot,file)))}));
  const artifacts=['box3d.js','box3d.wasm'].map(file=>({file,sha256:sha(fs.readFileSync(path.join(directory,file)))}));
  const {default:factory}=await import(pathToFileURL(path.join(directory,'box3d.js')));
  const mod=await factory({wasmBinary:fs.readFileSync(path.join(directory,'box3d.wasm'))});
  assert.equal(mod._b3w_test_fail_next_capacity_allocation,undefined,'Release artifact must exclude fault injection.');
  const pool=new NativeWorldPool(mod),world=pool.createWorld();
  const adapter=await navigator.gpu.requestAdapter(),info=adapter?.info??{};
  const adapterIdentity={vendor:info.vendor??null,architecture:info.architecture??null,device:info.device??null,description:info.description??null,
    isFallbackAdapter:info.isFallbackAdapter??adapter?.isFallbackAdapter??null};
  assert.equal(adapterIdentity.isFallbackAdapter,false);
  const protocol={capacities:[4096,16384,65536],seed:42,scene:0,spread:'12 * sqrt(count / 4096)',height:2,dt:1/60,substeps:4,warmupFrames:8,sampleFrames:24,
    viewport:[512,320],sampleCount:1,shadowMapSize:1024,shadowTapCount:1,shadowStrength:0,bloomStrength:0,
    contactMetric:'Public SDK contact-pair count, including broad-phase non-touching pairs. Not the number of touching manifolds.',
    frameScope:'Serialized offscreen physics step, rigid upload, render encoding and GPU queue completion. Excludes contact-query/readback, browser scheduling and presentation.',
    timingClaim:'Single-machine descriptive capacity probe, not a controlled speedup or interactive-browser qualification.',
    memoryScope:'WebAssembly linear-memory capacity and bridge/GPU instance buffer sizes; excludes resident RAM, SDK allocator accounting and other GPU resources.'};
  const result={schema:'box3d.native-capacity-renderer-qualification/1',status:'running',startedAt:new Date().toISOString(),
    dawnBackend,adapter:adapterIdentity,sources,nativeSources,artifacts,protocol,mode:renderer.instancePartitionInfo().mode,cases:[]};
  let drawCalls=[];
  const device=renderer.device,createEncoder=device.createCommandEncoder.bind(device);
  device.createCommandEncoder=descriptor=>{
    const encoder=createEncoder(descriptor),begin=encoder.beginRenderPass.bind(encoder);
    encoder.beginRenderPass=passDescriptor=>{
      const pass=begin(passDescriptor),draw=pass.draw.bind(pass);
      pass.draw=(...args)=>{if(passDescriptor.label==='AAA HDR main pass')drawCalls.push(args);return draw(...args);};return pass;
    };return encoder;
  };
  async function read(buffer,size,offset=0) {
    const staging=device.createBuffer({size,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
    try{const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,offset,staging,0,size);device.queue.submit([encoder.finish()]);await staging.mapAsync(GPUMapMode.READ);return new Uint8Array(staging.getMappedRange()).slice();}
    finally{staging.unmap();staging.destroy();}
  }
  const bytes=(source,pointer,count)=>new Uint8Array(source.HEAPF32.buffer,source.HEAPF32.byteOffset+Number(pointer),count);
  async function checkStreams(source,count) {
    const matrices=await read(renderer.matrixBuffer,count*64),colors=await read(renderer.colorBuffer,count*16);
    assert.deepEqual(matrices,bytes(source,source._b3w_matrices_ptr(),count*64));
    assert.deepEqual(colors,bytes(source,source._b3w_colors_ptr(),count*16));
    return {matrixSha256:sha(matrices),colorSha256:sha(colors),verifiedBytes:count*80};
  }
  async function checkDraw(count,transparentCount=0) {
    if(renderer.instancePartition){
      const partition=renderer.instancePartition;
      const indirect=new Uint32Array((await read(partition.indirectBuffer,32)).buffer);
      assert.deepEqual([...indirect],[36,count-transparentCount,0,0,36,transparentCount,0,0]);
      const opaque=[],transparent=[];
      for(let id=0;id<count;id++)(transparentCount&&id%3===0?transparent:opaque).push(id);
      if(opaque.length)assert.deepEqual([...new Uint32Array((await read(partition.buffers[3],opaque.length*4)).buffer)],opaque);
      if(transparent.length)assert.deepEqual([...new Uint32Array((await read(partition.buffers[4],transparent.length*4)).buffer)],transparent);
      return {path:'indirect',instances:count,opaque:count-transparentCount,transparent:transparentCount,stableIds:true};
    }
    const calls=drawCalls.filter(call=>call[0]===36);
    assert.equal(calls.length,transparentCount?2:1);assert.ok(calls.every(call=>call[1]===count));
    return {path:'direct',instances:count,cubeDraws:calls.length};
  }
  const distribution=values=>{
    const sorted=[...values].sort((a,b)=>a-b),q=p=>sorted[Math.ceil(p*sorted.length)-1];
    return {p50:q(.5),p95:q(.95),p99:q(.99),max:sorted.at(-1)};
  };
  try {
    renderer.uploadSurface(null);renderer.uploadRopeGrid(null,0);renderer.invalidateDynamicCaches();
    canvas.clientWidth=512;canvas.clientHeight=320;
    const identity=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],eye=[85,60,110];
    renderer.writeSceneUniforms({viewProjection:mat4Multiply(mat4Perspective(Math.PI/3,512/320,.1,400),mat4LookAt(eye,[0,8,0],[0,1,0])),
      lightViewProjection:identity,cameraPosition:eye,lightDirection:[.42,-.84,.34],fogColor:[.055,.085,.14],timeSeconds:2,
      quality:{...quality,sampleCount:1,shadowMapSize:1024,shadowTapCount:1,resolutionScale:1,shadowStrength:0,bloomStrength:0}});
    for(const count of protocol.capacities){
      world.createScene({id:protocol.scene},1,protocol.seed);const initial=world.bodyCount();
      renderer.uploadInstances(world,initial);renderer.render(initial,[]);await device.queue.onSubmittedWorkDone();
      const before=await readPresentedPixels(),pointer=world._b3w_matrices_ptr(),oldCapacity=world.maxBodies;
      assert.equal(await renderer.reserveInstanceCapacity(count),count);
      assert.equal(renderer.uploadInstances(world,initial),0,'GPU growth preserves cached stream content');
      await checkStreams(world,initial);renderer.render(initial,[]);await device.queue.onSubmittedWorkDone();
      assert.deepEqual(await readPresentedPixels(),before,'GPU growth preserves exact native-scene pixels');
      assert.equal(world.reserveBodyCapacity(count),count);
      assert.equal(renderer.uploadInstances(world,initial),oldCapacity===count?0:initial*80,'native relocation refreshes both streams');
      if(oldCapacity!==count)assert.notEqual(world._b3w_matrices_ptr(),pointer);
      await checkStreams(world,initial);renderer.render(initial,[]);await device.queue.onSubmittedWorkDone();
      assert.deepEqual(await readPresentedPixels(),before,'native growth preserves exact pixels');
      assert.equal(world.spawnRain(count-initial,12*Math.sqrt(count/4096),2),count-initial);
      assert.equal(world.bodyCount(),count);assert.equal(world.dynamicCount(),count-1);
      const samples=[];
      for(let frame=-protocol.warmupFrames;frame<protocol.sampleFrames;frame++){
        const start=performance.now();world.step(protocol.dt,protocol.substeps);const stepped=performance.now();
        const uploadBytes=renderer.uploadInstances(world,count),uploaded=performance.now();drawCalls=[];renderer.render(count,[]);const encoded=performance.now();
        await device.queue.onSubmittedWorkDone();const complete=performance.now();
        if(frame>=0)samples.push({frame,stepMs:stepped-start,uploadMs:uploaded-stepped,encodeMs:encoded-uploaded,gpuCompletionMs:complete-encoded,frameMs:complete-start,
          uploadBytes,awake:world.awakeCount(),contactPairs:world.contactCount(),wasmHeapBytes:mod.HEAPF32.byteLength});
      }
      assert.ok(samples.every(sample=>sample.awake>count*.95&&sample.contactPairs>count),'require active dense contact-pair workload');
      const streams=await checkStreams(world,count),draw=await checkDraw(count),pixels=await readPresentedPixels();
      assert.ok(new Float32Array(bytes(world,world._b3w_matrices_ptr(),count*64).slice().buffer).every(Number.isFinite));
      const entry={count,capacity:world.capacityInfo(),rendererCapacity:renderer.instanceCapacityInfo(),preservedGrowthPixels:true,streams,draw,
        pixelsSha256:sha(pixels),replayHash:world.replayHash(),samples,distributions:Object.fromEntries(['stepMs','uploadMs','encodeMs','gpuCompletionMs','frameMs'].map(key=>[key,distribution(samples.map(sample=>sample[key]))]))};
      result.cases.push(entry);console.log('Native capacity '+count+': '+JSON.stringify({frameMs:entry.distributions.frameMs,contactPairs:samples.at(-1).contactPairs,wasmHeapBytes:mod.HEAPF32.byteLength}));
    }
    const count=world.bodyCount(),heap=new Float32Array(count*20);
    heap.set(world.HEAPF32.subarray(Number(world._b3w_matrices_ptr())/4,Number(world._b3w_matrices_ptr())/4+count*16));
    heap.set(world.HEAPF32.subarray(Number(world._b3w_colors_ptr())/4,Number(world._b3w_colors_ptr())/4+count*4),count*16);
    for(let id=0;id<count;id++)if(id%3===0)heap[count*16+id*4+3]=-4;
    const mixed={HEAPF32:heap,_b3w_matrices_ptr:()=>0,_b3w_colors_ptr:()=>count*64,_b3w_body_count:()=>count,_b3w_max_bodies:()=>count,frameVersion:()=>1,colorVersion:()=>1};
    assert.equal(renderer.uploadInstances(mixed,count),count*80);drawCalls=[];renderer.render(count,[]);await device.queue.onSubmittedWorkDone();
    result.mixed={count,draw:await checkDraw(count,Math.ceil(count/3)),streams:await checkStreams(mixed,count),pixelsSha256:sha(await readPresentedPixels())};
    // Beyond the rigid tier, reserve two extra outputs and verify compute writes
    // to the new matrix/color bindings, not the retired GPU buffers.
    await renderer.reserveInstanceCapacity(count+2);
    renderer.uploadInstances(world,count);
    const rope={presentation:'rope',positions:new Float32Array([0,3,0,2,3,0,2,5,0]),
      segments:new Float32Array([0,1,.5,.08,.25,.5,.75,1,1,2,.5,.08,.75,.5,.25,1]),nodeCount:3,segmentCount:2,topologyVersion:55,frameVersion:55};
    renderer.uploadRopeGrid(rope,count);drawCalls=[];renderer.render(count+2,[]);await device.queue.onSubmittedWorkDone();
    const ropeMatrices=new Float32Array((await read(renderer.matrixBuffer,128,count*64)).buffer),ropeColors=new Float32Array((await read(renderer.colorBuffer,32,count*16)).buffer);
    assert.deepEqual([...ropeMatrices.slice(12,16)],[1,3,0,1]);assert.deepEqual([...ropeMatrices.slice(28,32)],[2,4,0,1]);
    assert.ok([...ropeMatrices,...ropeColors].every(Number.isFinite));assert.ok(ropeColors.some(value=>value!==0));
    result.rope={baseInstance:count,segmentCount:2,rendererCapacity:renderer.maxInstances,draw:await checkDraw(count+2),matrices:[...ropeMatrices],colors:[...ropeColors]};
    renderer.uploadRopeGrid(null,0);await settleTiming();assert.deepEqual(runtimeErrors,[]);
    for(const source of sources)assert.equal(sha(fs.readFileSync(path.join(root,source.file))),source.sha256,'source changed during capacity capture');
    for(const source of nativeSources)assert.equal(sha(fs.readFileSync(path.join(candidateRoot,source.file))),source.sha256);
    result.status='passed';result.finishedAt=new Date().toISOString();result.uncapturedWebGpuErrors=runtimeErrors.length;
    fs.writeFileSync(path.resolve(process.env.WEBGPU_NATIVE_CAPACITY_EVIDENCE),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  }finally{device.createCommandEncoder=createEncoder;renderer.uploadRopeGrid(null,0);pool.destroy();}
}
