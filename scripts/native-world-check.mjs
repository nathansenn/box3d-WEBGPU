#!/usr/bin/env node
/** Read-only audit of a frozen native-world correctness/capacity experiment. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,hashFile,hashValue,inventory,LIMITS,parseArgs,writeJsonExclusive} from './engine-baseline.mjs';

const digestPattern=/^[a-f0-9]{64}$/;
async function readJson(file){
  assert.ok((await fs.stat(file)).size<24*1024**2,'JSON evidence exceeds the read budget');
  return JSON.parse(await fs.readFile(file,'utf8'));
}
async function verifyFiles(root,receipt){
  assert.equal(receipt.status,'measured');assert.equal(hashValue(receipt.files),receipt.sha256);
  const paths=new Set();let bytes=0;
  for(const file of receipt.files){
    assert.ok(typeof file.path==='string'&&!path.isAbsolute(file.path)&&!file.path.split(/[\\/]/).some(p=>p==='..'||p===''));
    assert.ok(!paths.has(file.path));paths.add(file.path);
    const absolute=await fs.realpath(path.join(root,file.path));
    assert.ok(absolute.startsWith((await fs.realpath(root))+path.sep),'Frozen evidence path escaped its root');
    assert.equal((await fs.stat(absolute)).size,file.bytes);assert.equal(await hashFile(absolute),file.sha256,'Frozen file changed: '+file.path);bytes+=file.bytes;
  }
  assert.equal(bytes,receipt.bytes);
}
function finiteInteger(value,min,max){assert.ok(Number.isSafeInteger(value)&&value>=min&&value<=max);}
function stateSample(sample,sides){
  for(const key of sides)assert.match(sample[key],digestPattern);
  for(const key of sides.slice(1))assert.equal(sample[key],sample[sides[0]],'Exact native state digest mismatch');
  const m=sample.meta;finiteInteger(m.count,1,4096);finiteInteger(m.dynamic,0,m.count);finiteInteger(m.awake,0,m.dynamic);
  for(const key of ['replayHash','transformVersion','colorVersion'])finiteInteger(m[key],0,0xFFFFFFFF);
}
export async function verifyNativeWorldRun(directory){
  const root=await fs.realpath(directory),r=await readJson(path.join(root,'result.json'));
  assert.equal(r.schema,'box3d.native-world-qualification/1');assert.equal(r.status,'pass');
  assert.equal(hashValue(r.protocol),r.protocolSha256);
  assert.equal(canonical(await readJson(path.join(root,'protocol.json'))),canonical(r.protocol));
  assert.equal(r.protocol.scenes,800);assert.equal(r.protocol.catalogTicks,12);assert.equal(r.protocol.dt,1/60);assert.equal(r.protocol.substeps,4);
  assert.equal(r.protocol.worlds,16);assert.equal(r.protocol.interleavedTicks,120);
  assert.equal(r.protocol.populatedLifecycleWarmup,32);assert.equal(r.protocol.populatedLifecycles,256);
  assert.equal(r.protocol.catalogSeed,'(0xc0ffee + sceneId) >>> 0');assert.equal(r.protocol.catalogStress,'1 + sceneId % 5');
  assert.deepEqual(r.protocol.actions,{2:'kick(6)',4:'explode(0,3,0,8,9)',6:'launchProjectile(-8,5,0,12,2,0,.5)',8:'spawnRain(3,8,14)',10:'applyImpulse(1,2,3,4)'});
  await verifyFiles(path.join(root,'baseline'),r.baseline);await verifyFiles(path.join(root,'candidate'),r.candidateSource);
  await verifyFiles(path.join(root,'candidate/public/box3d'),r.candidateArtifacts);await verifyFiles(path.join(root,'harness'),r.harness);
  assert.equal((await inventory(path.join(root,'raw'),['.'],LIMITS.sourceBytes)).sha256,r.raw.sha256);
  const catalog=await readJson(path.join(root,'raw/catalog.json'));assert.equal(catalog.length,800);
  for(let id=0;id<800;id++){
    const c=catalog[id];assert.equal(c.id,id);assert.equal(c.seed,(0xc0ffee+id)>>>0);assert.equal(c.stress,1+id%5);assert.equal(c.samples.length,13);
    for(let tick=0;tick<13;tick++){assert.equal(c.samples[tick].tick,tick);stateSample(c.samples[tick],['baseline','compatibility','isolated']);}
  }
  assert.deepEqual(r.catalog,{scenes:800,comparedSnapshots:20800,sha256:hashValue(catalog),exact:true});
  const interleaved=await readJson(path.join(root,'raw/interleaved.json'));assert.equal(interleaved.length,1920);
  for(let tick=1;tick<=120;tick++){
    const slice=interleaved.slice((tick-1)*16,tick*16);assert.deepEqual(slice.map(s=>s.world),Array.from({length:16},(_,i)=>tick%2?15-i:i));
    for(const sample of slice){assert.equal(sample.tick,tick);stateSample(sample,['baseline','isolated']);}
  }
  assert.deepEqual(r.interleaved,{worlds:16,ticks:120,comparedSnapshots:1920,exact:true,sha256:hashValue(interleaved)});
  const lifecycle=await readJson(path.join(root,'raw/lifecycle.json'));assert.equal(lifecycle.length,256);const handles=new Set();
  for(let cycle=0;cycle<256;cycle++){
    const sample=lifecycle[cycle];assert.equal(sample.cycle,cycle);assert.equal(sample.id,(cycle%16)*50);assert.match(sample.finalSha256,digestPattern);
    finiteInteger(sample.handle,33,0xFFFFFFFF);assert.ok(!handles.has(sample.handle));handles.add(sample.handle);
    assert.equal(sample.heapBytes,r.lifecycle.stablePostWarmupHeapBytes);
  }
  assert.deepEqual(r.lifecycle,{warmup:32,populatedCycles:256,stablePostWarmupHeapBytes:lifecycle[0].heapBytes,
    staleHandlesRejected:true,survivingWorldExact:true,sha256:hashValue(lifecycle)});
  const memory=r.linearMemory;assert.equal(memory.status,'measured');assert.equal(memory.scope,r.protocol.memoryScope);
  assert.equal(memory.oldModules,16);assert.equal(memory.newModules,1);assert.equal(memory.worldsPerSide,16);assert.equal(memory.oldModuleBytes.length,16);
  for(const bytes of [...memory.oldModuleBytes,memory.newInitialModuleBytes,memory.newModuleBytes,r.lifecycle.stablePostWarmupHeapBytes]){
    finiteInteger(bytes,65536,2**32);assert.equal(bytes%65536,0);
  }
  assert.equal(memory.oldAggregateBytes,memory.oldModuleBytes.reduce((a,b)=>a+b,0));
  assert.equal(memory.capacityRatio,memory.oldAggregateBytes/memory.newModuleBytes);
  assert.equal(memory.extraNewDefaultWorldWasAlsoPopulated,true);
  assert.deepEqual(r.claims,{physicsThroughput:'unmeasured',browserFPS:'unmeasured',residentMemory:'unmeasured',parallelThreads:'not implemented'});
  assert.equal(await hashFile(process.execPath),r.environment.runtime.executableSha256,'Recheck uses a different Node executable');
  return {schema:'box3d.native-world-integrity/1',status:'pass',run:root,resultSha256:await hashFile(path.join(root,'result.json')),
    catalog:r.catalog,interleaved:r.interleaved,lifecycle:r.lifecycle,linearMemory:memory,
    statement:'Frozen sources, artifacts, harness and raw records match; all recorded per-tick exact-state digests agree. This check does not rerun simulation or establish a speed gain.'};
}
async function main(){
  const args=parseArgs(process.argv.slice(2),['--run','--receipt']);
  if(args.help){console.log('node scripts/native-world-check.mjs --run FROZEN_RUN [--receipt NEW_FILE.json]');return;}
  if(!args['--run'])throw new Error('--run is required');
  const result=await verifyNativeWorldRun(args['--run']);
  if(args['--receipt'])await writeJsonExclusive(path.resolve(args['--receipt']),result);
  console.log(JSON.stringify(result,null,2));
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{console.error(error.message);process.exitCode=1;});
