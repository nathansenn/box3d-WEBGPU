#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventory,LIMITS,hashFile,parseArgs,writeJsonExclusive} from './engine-baseline.mjs';
import {verifyCapacityPacket} from './native-capacity-check.mjs';
const read=async file=>{assert.ok((await fs.stat(file)).size<24*1024**2);return JSON.parse(await fs.readFile(file,'utf8'));};
export function validateBodyLifecycle(r){
 assert.equal(r.schema,'box3d.native-body-lifecycle-qualification/1');assert.equal(r.status,'pass');
 const p=r.protocol;assert.equal(p.hotPairs,524288);assert.equal(p.hotStepEvery,1024);assert.equal(p.batchSize,1024);assert.equal(p.batches,512);
 assert.equal(p.warmupHotPairs,4096);assert.equal(p.warmupBatches,4);assert.equal(p.dt,1/240);assert.equal(p.substeps,2);assert.equal(p.seed,42);assert.equal(p.scene,0);
 assert.equal(p.hotRecordEvery,8192);assert.equal(p.batchRecordEvery,8);assert.equal(p.destructionOrder,'(i * 641) % 1024');
 assert.equal(r.spawnDespawnPairs,1048576);assert.equal(r.individualCreateDestroyOperations,2097152);assert.equal(r.maxLiveBodies,1024);assert.equal(r.uniqueBodySlots,1024);
 assert.equal(r.bridgeBufferBytes,4096*136);assert.ok(Number.isSafeInteger(r.stablePostWarmupHeapBytes)&&r.stablePostWarmupHeapBytes>=r.bridgeBufferBytes&&r.stablePostWarmupHeapBytes%65536===0);
 assert.ok(r.elapsedMs>0&&r.elapsedMs<p.maxSeconds*1000);assert.equal(p.maxSeconds,240);
 const hotRejections=6*(p.hotPairs-1);assert.equal(r.staleRejections,hotRejections+p.batches*(p.batchSize*3+6));
 const first=BigInt(r.firstHotToken),last=BigInt(r.lastHotToken);assert.ok(first>0n&&last<=0xFFFFFFFFFFFFFFFFn);assert.equal(last-first,BigInt(p.hotPairs-1)<<17n);
 assert.equal(r.samples.length,128);
 for(const [i,s]of r.samples.entries()){
  const hot=i<64,index=hot?(i+1)*8192:(i-63)*8,pairs=hot?index:p.hotPairs+index*p.batchSize;
  assert.equal(s.phase,hot?'hot':'batch');assert.equal(s.index,index);assert.equal(s.pairs,pairs);assert.equal(s.bodyCount,0);assert.equal(s.uniqueSlots,1024);
  assert.equal(s.heapBytes,r.stablePostWarmupHeapBytes);assert.equal(s.bridgeBufferBytes,r.bridgeBufferBytes);
  assert.equal(s.replayHash,2166136261);assert.equal(s.staleRejections,hot?6*(index-1):hotRejections+index*(p.batchSize*3+6));
 }
 return {spawnDespawnPairs:r.spawnDespawnPairs,staleRejections:r.staleRejections,stableHeapBytes:r.stablePostWarmupHeapBytes};
}
export async function verifyBodyLifecycleRun(directory){
 const root=await fs.realpath(directory),r=await read(path.join(root,'result.json')),result=validateBodyLifecycle(r);
 assert.deepEqual(await read(path.join(root,'protocol.json')),r.protocol);
 for(const section of ['source','harness','artifacts'])assert.deepEqual(await inventory(path.join(root,section),['.'],LIMITS.sourceBytes),r[section]);
 return {schema:'box3d.native-body-lifecycle-integrity/1',status:'pass',run:root,resultSha256:await hashFile(path.join(root,'result.json')),sourceSha256:r.source.sha256,artifactsSha256:r.artifacts.sha256,...result,
 statement:'Frozen source, harness and artifacts rehash correctly; all 128 recorded checkpoints agree with the declared lifecycle and stale-rejection arithmetic. Does not rerun simulation or qualify throughput.'};
}
export async function verifyBodyLifecyclePacket(packet,nativeRun,lifecycleRun){
 const capacity=await verifyCapacityPacket(packet,nativeRun,{bridgeBytesPerBody:136});
 const lifecycle=await verifyBodyLifecycleRun(lifecycleRun),base=await fs.realpath(packet);
 const recorded=await read(path.join(base,'evidence/lifecycle-integrity.json'));assert.equal(recorded.resultSha256,lifecycle.resultSha256);
 const manifest=await read(path.join(base,'manifest.json')),support=await read(path.join(base,'support-manifest.json'));
 const sourceMap=new Map([...manifest.source.files,...support.files].map(file=>[file.path,file.sha256]));
 const artifacts=await read(path.join(base,'native-artifacts-manifest.json')),artifactMap=new Map(artifacts.files.map(file=>[file.path,file.sha256]));
 const rawLife=await read(path.join(lifecycleRun,'result.json'));
 for(const file of rawLife.artifacts.files)assert.equal(artifactMap.get(file.path),file.sha256);
 for(const name of ['wasm/box3d_web.c','wasm/CMakeLists.txt','src/engine/native-world.ts','src/engine/contracts.ts'])assert.equal(rawLife.source.files.find(file=>file.path===name)?.sha256,sourceMap.get(name));
 const direct=await read(path.join(base,'evidence/recycling-direct.json')),partition=await read(path.join(base,'evidence/recycling-partition.json'));
 for(const [mode,r]of [['direct',direct],['gpu-stable',partition]]){
  assert.equal(r.schema,'box3d.native-recycling-renderer-qualification/1');assert.equal(r.status,'passed');assert.equal(r.mode,mode);assert.equal(r.dawnBackend,'metal');assert.equal(r.adapter.isFallbackAdapter,false);assert.equal(r.uncapturedWebGpuErrors,0);
  for(const file of [...r.sources,...r.nativeSources])assert.equal(sourceMap.get(file.file),file.sha256);
  for(const file of r.artifacts)assert.equal(artifactMap.get(file.file),file.sha256);
  assert.deepEqual(r.cases.map(c=>c.count),[157,156,154,155,155,155,155,155,0,157]);
  for(const c of r.cases){assert.equal(c.copiedPixelsExact,true);assert.equal(c.dynamic,Math.max(0,c.count-1));assert.equal(c.verifiedStreamBytes,c.count*80);assert.match(c.streamSha256,/^[a-f0-9]{64}$/);assert.match(c.pixelsSha256,/^[a-f0-9]{64}$/);}
  for(const [a,b]of [[3,4],[3,5],[6,7],[0,9]])assert.equal(r.cases[a].pixelsSha256,r.cases[b].pixelsSha256);
  assert.notEqual(r.cases[3].pixelsSha256,r.cases[6].pixelsSha256);
 }
 for(let i=0;i<10;i++)for(const key of ['label','count','dynamic','hash','streamSha256','pixelsSha256'])assert.deepEqual(direct.cases[i][key],partition.cases[i][key]);
 return {schema:'box3d.native-body-phase-integrity/1',status:'pass',sourceSha256:manifest.source.sha256,capacity,lifecycle,recyclingPixelCasesPerMode:10,
  statement:'Capacity and lifecycle input hashes, raw arithmetic, native catalog/interleaving and direct/partition pixel records agree. No engine-wide speedup or interactive capacity claim.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=parseArgs(process.argv.slice(2),['--run','--packet','--native-run','--receipt']);if(!args['--run'])throw new Error('--run is required');
 if(args['--packet']&&!args['--native-run'])throw new Error('--native-run is required for a phase packet');
 const result=args['--packet']?await verifyBodyLifecyclePacket(args['--packet'],args['--native-run'],args['--run']):await verifyBodyLifecycleRun(args['--run']);
 if(args['--receipt'])await writeJsonExclusive(args['--receipt'],result);console.log(JSON.stringify(result,null,2));
}
