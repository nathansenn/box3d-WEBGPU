#!/usr/bin/env node
/** Freeze both artifacts, then compare exact native streams across isolated worlds.
 * This is a correctness/capacity experiment, not a latency or resident-memory benchmark.
 */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {canonical,hashFile,hashValue,inventory,LIMITS,observeEnvironment,parseArgs,reserveRunDirectory,writeJsonExclusive} from './engine-baseline.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const schema='box3d.native-world-qualification/1';
const protocol=Object.freeze({scenes:800,catalogTicks:12,dt:1/60,substeps:4,worlds:16,interleavedTicks:120,
  populatedLifecycleWarmup:32,populatedLifecycles:256,
  equivalence:'exact matrix and color bytes, counts, awake state, replay hash and stream revisions at every sampled tick',
  catalogSeed:'(0xc0ffee + sceneId) >>> 0',catalogStress:'1 + sceneId % 5',
  actions:{2:'kick(6)',4:'explode(0,3,0,8,9)',6:'launchProjectile(-8,5,0,12,2,0,.5)',8:'spawnRain(3,8,14)',10:'applyImpulse(1,2,3,4)'},
  limits:{wallSeconds:240,sourceBytes:64*1024**2},
  memoryScope:'Sum of WebAssembly linear-memory capacity (HEAPF32.byteLength). Not resident RAM, allocation rate, browser memory or throughput.'});

async function copyInputs(input,output,paths){
  const receipt=await inventory(input,paths,LIMITS.sourceBytes);
  for(const file of receipt.files){
    const target=path.join(output,file.path);await fs.mkdir(path.dirname(target),{recursive:true});
    await fs.copyFile(path.join(input,file.path),target,fs.constants.COPYFILE_EXCL);
    assert.equal(await hashFile(target),file.sha256,'Source changed while freezing '+file.path);
  }
  return receipt;
}
async function artifactFactory(directory){
  const binary=await fs.readFile(path.join(directory,'box3d.wasm'));assert.ok(WebAssembly.validate(binary));
  const {default:factory}=await import(pathToFileURL(path.join(directory,'box3d.js')));
  return ()=>factory({wasmBinary:binary});
}
function legacy(mod){
  return {get HEAPF32(){return mod.HEAPF32;},
    _b3w_matrices_ptr:()=>mod._b3w_matrices_ptr(),_b3w_colors_ptr:()=>mod._b3w_colors_ptr(),
    bodyCount:()=>mod._b3w_body_count(),dynamicCount:()=>mod._b3w_dynamic_count(),awakeCount:()=>mod._b3w_awake_count(),
    replayHash:()=>mod._b3w_replay_hash()>>>0,frameVersion:()=>mod._b3w_transform_version()>>>0,colorVersion:()=>mod._b3w_color_version()>>>0,
    createScene:(scene,stress,seed)=>mod._b3w_create_scene(scene.id,stress,seed),step:(dt,substeps)=>mod._b3w_step(dt,substeps),
    kick:strength=>mod._b3w_kick_stack(strength),explode:(...args)=>mod._b3w_explode(...args),
    launchProjectile:(...args)=>mod._b3w_launch_projectile(...args),spawnRain:(...args)=>mod._b3w_spawn_rain(...args),
    applyImpulse:(...args)=>mod._b3w_apply_impulse(...args),clear:()=>mod._b3w_destroy(),destroy:()=>mod._b3w_destroy()};
}
function snapshot(world){
  const count=world.bodyCount(),heap=world.HEAPF32;
  assert.ok(Number.isInteger(count)&&count>=0&&count<=4096);
  const stream=(pointer,words)=>{
    const offset=Number(pointer);assert.ok(offset>0&&offset%4===0&&offset+words*4<=heap.byteLength);
    const values=heap.subarray(offset/4,offset/4+words);assert.ok(values.every(Number.isFinite));
    return Buffer.from(new Uint8Array(heap.buffer,offset,words*4));
  };
  return {meta:{count,dynamic:world.dynamicCount(),awake:world.awakeCount(),replayHash:world.replayHash(),
    transformVersion:world.frameVersion(),colorVersion:world.colorVersion()},
    matrices:stream(world._b3w_matrices_ptr(),count*16),colors:stream(world._b3w_colors_ptr(),count*4)};
}
function digest(state){
  return createHash('sha256').update(canonical(state.meta)).update(state.matrices).update(state.colors).digest('hex');
}
function equivalent(actual,expected,label,{revisions=true}={}){
  const metadata=state=>revisions?state.meta:Object.fromEntries(Object.entries(state.meta).filter(([key])=>!key.endsWith('Version')));
  assert.deepEqual(metadata(actual),metadata(expected),label+' metadata');
  assert.ok(actual.matrices.equals(expected.matrices),label+' matrix bytes');
  assert.ok(actual.colors.equals(expected.colors),label+' color bytes');
}
function action(world,tick){
  switch(tick){
    case 2:world.kick(6);return null;
    case 4:world.explode(0,3,0,8,9);return null;
    case 6:return world.launchProjectile(-8,5,0,12,2,0,.5);
    case 8:return world.spawnRain(3,8,14);
    case 10:if(world.bodyCount()>1)world.applyImpulse(1,2,3,4);return null;
    default:return null;
  }
}

async function qualify(args){
  if(!args['--baseline-root']||!args['--candidate-artifacts']||!args['--out'])throw new Error('--baseline-root, --candidate-artifacts and --out are required');
  const baselineRoot=await fs.realpath(args['--baseline-root']),candidateArtifacts=await fs.realpath(args['--candidate-artifacts']);
  const candidateRoot=await fs.realpath(args['--candidate-root']??root);
  const out=await reserveRunDirectory(args['--out'],[root,baselineRoot,candidateArtifacts,candidateRoot]);
  if(out.startsWith(baselineRoot+path.sep)||out.startsWith(candidateArtifacts+path.sep)||out.startsWith(candidateRoot+path.sep)&&candidateRoot!==root)throw new Error('Output must be outside candidate and baseline inputs');
  const started=Date.now(),deadline=started+protocol.limits.wallSeconds*1000;
  const bounded=()=>{if(Date.now()>deadline)throw new Error('Native qualification wall budget exceeded');};
  const result={schema,status:'running',protocol,protocolSha256:hashValue(protocol),startedAt:new Date(started).toISOString(),pid:process.pid,
    environment:await observeEnvironment(),claims:{physicsThroughput:'unmeasured',browserFPS:'unmeasured',residentMemory:'unmeasured',parallelThreads:'not implemented'}};
  try{
    result.baseline=await copyInputs(baselineRoot,path.join(out,'baseline'),['.']);
    result.candidateSource=await copyInputs(candidateRoot,path.join(out,'candidate'),['wasm/box3d_web.c','wasm/CMakeLists.txt',
      'src/engine/native-world.ts','src/engine/contracts.ts','src/physics/wasm.ts','src/types.ts']);
    result.candidateArtifacts=await copyInputs(candidateArtifacts,path.join(out,'candidate/public/box3d'),['box3d.js','box3d.wasm']);
    result.harness=await copyInputs(root,path.join(out,'harness'),['scripts/native-world-qualify.mjs','scripts/engine-baseline.mjs']);
    const oldProvenance=JSON.parse(await fs.readFile(path.join(out,'baseline/public/box3d/BUILD_PROVENANCE.json'),'utf8'));
    assert.equal(await hashFile(path.join(out,'baseline/wasm/box3d_web.c')),oldProvenance.bridge.sha256);
    for(const file of ['box3d.js','box3d.wasm'])assert.equal(await hashFile(path.join(out,'baseline/public/box3d',file)),oldProvenance.artifacts[file].sha256);
    result.upstream=oldProvenance.box3d;
    await writeJsonExclusive(path.join(out,'protocol.json'),protocol);
    const oldFactory=await artifactFactory(path.join(out,'baseline/public/box3d'));
    const newFactory=await artifactFactory(path.join(out,'candidate/public/box3d'));
    const {NativeWorldPool}=await import(pathToFileURL(path.join(out,'candidate/src/engine/native-world.ts')));
    const referenceModule=await oldFactory(),candidateModule=await newFactory();
    const reference=legacy(referenceModule),compatibility=legacy(candidateModule),pool=new NativeWorldPool(candidateModule),world=pool.createWorld();
    let foreign=pool.createWorld();
    const catalog=[];
    try{
      for(let id=0;id<protocol.scenes;id++){
        bounded();const stress=1+id%5,seed=(0xc0ffee+id)>>>0;
        const counts=[reference,compatibility,world].map(w=>w.createScene({id},stress,seed));assert.ok(counts.every(n=>n===counts[0]));
        if(id%17===0){const stale=foreign.handle;foreign.destroy();foreign=pool.createWorld();assert.equal(candidateModule._b3w_world_valid(stale),0);}
        foreign.createScene({id:(id+311)%800},1,(seed^0x9e3779b9)>>>0);
        const samples=[];
        const compare=tick=>{
          const old=snapshot(reference),compat=snapshot(compatibility),isolated=snapshot(world);
          equivalent(compat,old,'catalog '+id+' compatibility tick '+tick);equivalent(isolated,old,'catalog '+id+' isolated tick '+tick);
          samples.push({tick,meta:old.meta,baseline:digest(old),compatibility:digest(compat),isolated:digest(isolated)});
        };
        compare(0);
        for(let tick=1;tick<=protocol.catalogTicks;tick++){
          if(tick===5)foreign.createScene({id:(id+17)%800},1,(seed^0xa5a5a5a5)>>>0);
          foreign.step(1/120,2);const outcomes=[reference,compatibility,world].map(w=>action(w,tick));
          assert.deepEqual(outcomes,[outcomes[0],outcomes[0],outcomes[0]],'catalog action results '+id+'/'+tick);
          // Rotate call order so the candidate is not always first or last.
          for(const w of id%2?[world,reference,compatibility]:[compatibility,reference,world])w.step(protocol.dt,protocol.substeps);
          compare(tick);
        }
        catalog.push({id,stress,seed,samples});
        if((id+1)%100===0)console.log('Native exact catalog: '+(id+1)+'/800');
      }
    }finally{pool.destroy();reference.destroy();compatibility.destroy();}
    await fs.mkdir(path.join(out,'raw'));await writeJsonExclusive(path.join(out,'raw/catalog.json'),catalog);
    result.catalog={scenes:catalog.length,comparedSnapshots:catalog.length*(protocol.catalogTicks+1)*2,sha256:hashValue(catalog),exact:true};

    // Sixteen independently instantiated old modules are the exact references.
    const multiModule=await newFactory(),multiPool=new NativeWorldPool(multiModule),multiDefault=legacy(multiModule);
    assert.equal(multiPool.capacity,protocol.worlds);
    const worlds=[],references=[],referenceModules=[];
    const initialCapacity=multiModule.HEAPF32.byteLength,multi=[];
    try{
      multiDefault.createScene({id:150},1,91);const protectedDefault=snapshot(multiDefault);
      for(let i=0;i<protocol.worlds;i++){
        const refModule=await oldFactory();referenceModules.push(refModule);const ref=legacy(refModule),next=multiPool.createWorld();
        references.push(ref);worlds.push(next);const id=i*50,stress=1+i%5,seed=(0x12345678+i)>>>0;
        ref.createScene({id},stress,seed);next.createScene({id},stress,seed);
        equivalent(snapshot(next),snapshot(ref),'multi initial '+i);
      }
      assert.throws(()=>multiPool.createWorld(),error=>error.code==='WORLD_CAPACITY');
      for(let tick=1;tick<=protocol.interleavedTicks;tick++){
        bounded();const order=worlds.map((_,i)=>i);if(tick%2)order.reverse();
        for(const i of order){
          const next=worlds[i],ref=references[i];assert.equal(action(next,tick),action(ref,tick));
          next.step(protocol.dt,protocol.substeps);ref.step(protocol.dt,protocol.substeps);
          const expected=snapshot(ref),actual=snapshot(next);equivalent(actual,expected,'multi '+i+' tick '+tick);
          multi.push({world:i,tick,meta:expected.meta,baseline:digest(expected),isolated:digest(actual)});
        }
        equivalent(snapshot(multiDefault),protectedDefault,'multi default tick '+tick);
      }
      const captured=worlds.map(snapshot);
      multiDefault.destroy();for(let i=0;i<worlds.length;i++)equivalent(snapshot(worlds[i]),captured[i],'default destroy isolation '+i);
      const oldBytes=referenceModules.map(mod=>mod.HEAPF32.byteLength),newBytes=multiModule.HEAPF32.byteLength;
      result.linearMemory={status:'measured',scope:protocol.memoryScope,oldModuleBytes:oldBytes,
        oldAggregateBytes:oldBytes.reduce((a,b)=>a+b,0),newInitialModuleBytes:initialCapacity,newModuleBytes:newBytes,
        oldModules:16,newModules:1,worldsPerSide:16,extraNewDefaultWorldWasAlsoPopulated:true};
      result.linearMemory.capacityRatio=result.linearMemory.oldAggregateBytes/newBytes;
      // Reuse half the populated slots while keeping the survivors untouched.
      const stale=[];
      for(let i=0;i<worlds.length;i+=2){stale.push(worlds[i].handle);worlds[i].destroy();}
      for(let i=0;i<worlds.length;i+=2){worlds[i]=multiPool.createWorld();worlds[i].createScene({id:799-i},1,i+1);}
      for(const handle of stale){assert.equal(multiModule._b3w_world_step(handle,protocol.dt,4),0);assert.equal(multiModule._b3w_world_destroy(handle),0);}
      for(let i=1;i<worlds.length;i+=2)equivalent(snapshot(worlds[i]),captured[i],'sibling slot reuse isolation '+i);
    }finally{multiPool.destroy();multiDefault.destroy();for(const ref of references)ref.destroy();}
    await writeJsonExclusive(path.join(out,'raw/interleaved.json'),multi);
    result.interleaved={worlds:16,ticks:120,comparedSnapshots:multi.length,exact:true,sha256:hashValue(multi)};

    const churnModule=await newFactory(),churnPool=new NativeWorldPool(churnModule),survivor=churnPool.createWorld(),churn=[];
    try{
      survivor.createScene({id:50},1,90210);const protectedState=snapshot(survivor);let warmBytes=0;
      for(let cycle=0;cycle<protocol.populatedLifecycleWarmup+protocol.populatedLifecycles;cycle++){
        bounded();const next=churnPool.createWorld(),handle=next.handle,id=(cycle%16)*50;
        next.createScene({id},1,42);for(let i=0;i<3;i++)next.step(protocol.dt,4);
        const final=digest(snapshot(next));next.destroy();
        assert.equal(churnModule._b3w_world_valid(handle),0);assert.equal(churnModule._b3w_world_spawn_rain(handle,2,8,10),-1);
        assert.equal(churnPool.size,1);equivalent(snapshot(survivor),protectedState,'populated churn survivor '+cycle);
        if(cycle===protocol.populatedLifecycleWarmup-1)warmBytes=churnModule.HEAPF32.byteLength;
        if(cycle>=protocol.populatedLifecycleWarmup){assert.equal(churnModule.HEAPF32.byteLength,warmBytes,'post-warmup native capacity must stay bounded');
          churn.push({cycle:cycle-protocol.populatedLifecycleWarmup,id,handle,finalSha256:final,heapBytes:churnModule.HEAPF32.byteLength});}
      }
      result.lifecycle={warmup:32,populatedCycles:churn.length,stablePostWarmupHeapBytes:warmBytes,
        staleHandlesRejected:true,survivingWorldExact:true,sha256:hashValue(churn)};
    }finally{churnPool.destroy();}
    await writeJsonExclusive(path.join(out,'raw/lifecycle.json'),churn);
    result.raw=await inventory(path.join(out,'raw'),['.'],LIMITS.sourceBytes);
    result.status='pass';result.elapsedMs=Date.now()-started;
  }catch(error){result.status='fail';result.error={name:error.name,message:error.message};result.elapsedMs=Date.now()-started;process.exitCode=1;}
  await writeJsonExclusive(path.join(out,'result.json'),result);
  console.log(JSON.stringify({out,status:result.status,catalog:result.catalog,interleaved:result.interleaved,linearMemory:result.linearMemory,lifecycle:result.lifecycle,error:result.error},null,2));
}
const args=parseArgs(process.argv.slice(2),['--baseline-root','--candidate-artifacts','--candidate-root','--out']);
if(args.help)console.log('node scripts/native-world-qualify.mjs --baseline-root FROZEN_BASELINE --candidate-artifacts BUILD_OUTPUT [--candidate-root SOURCE_ROOT] --out NEW_RUN_DIRECTORY');
else await qualify(args);
