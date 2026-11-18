#!/usr/bin/env node
/** Read-only rehash and arithmetic audit; never upgrades descriptive timings to a speedup. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {canonical,hashFile,inventory,LIMITS,parseArgs,verifyManifestStructure,writeJsonExclusive} from './engine-baseline.mjs';
import {verifyNativeWorldRun} from './native-world-check.mjs';

const json=async file=>{assert.ok((await fs.stat(file)).size<24*1024**2);return JSON.parse(await fs.readFile(file,'utf8'));};
const digest=/^[a-f0-9]{64}$/;
const distribution=values=>{const s=[...values].sort((a,b)=>a-b),q=p=>s[Math.ceil(p*s.length)-1];return{p50:q(.5),p95:q(.95),p99:q(.99),max:s.at(-1)};};
export function validateCapacityPair(direct,partition,{bridgeBytesPerBody=112}={}) {
  assert.ok(bridgeBytesPerBody===112||bridgeBytesPerBody===136,'Only the qualified capacity and body-lifecycle storage layouts are supported.');
  assert.deepEqual(direct.protocol,partition.protocol);assert.deepEqual(direct.sources,partition.sources);assert.deepEqual(direct.nativeSources,partition.nativeSources);assert.deepEqual(direct.artifacts,partition.artifacts);
  for(const [mode,r] of [['direct',direct],['gpu-stable',partition]]){
    assert.equal(r.schema,'box3d.native-capacity-renderer-qualification/1');assert.equal(r.status,'passed');assert.equal(r.mode,mode);
    assert.equal(r.dawnBackend,'metal');assert.equal(r.adapter.isFallbackAdapter,false);assert.equal(r.uncapturedWebGpuErrors,0);
    assert.deepEqual(r.protocol.capacities,[4096,16384,65536]);assert.equal(r.protocol.dt,1/60);assert.equal(r.protocol.substeps,4);
    assert.equal(r.protocol.warmupFrames,8);assert.equal(r.protocol.sampleFrames,24);assert.deepEqual(r.protocol.viewport,[512,320]);
    assert.equal(r.protocol.sampleCount,1);assert.equal(r.protocol.shadowStrength,0);assert.equal(r.protocol.shadowMapSize,1024);assert.equal(r.protocol.shadowTapCount,1);assert.equal(r.protocol.bloomStrength,0);
    assert.equal(r.protocol.seed,42);assert.equal(r.protocol.scene,0);assert.equal(r.protocol.height,2);assert.equal(r.protocol.spread,'12 * sqrt(count / 4096)');
    assert.equal(r.cases.length,3);
    for(const [index,c] of r.cases.entries()){
      const count=r.protocol.capacities[index];assert.equal(c.count,count);assert.equal(c.capacity.capacity,count);assert.equal(c.capacity.bridgeBufferBytes,count*bridgeBytesPerBody);
      assert.equal(c.rendererCapacity.capacity,count);assert.equal(c.rendererCapacity.matrixColorBytes,count*80);assert.equal(c.rendererCapacity.pending,false);
      assert.equal(c.streams.verifiedBytes,count*80);assert.match(c.streams.matrixSha256,digest);assert.match(c.streams.colorSha256,digest);assert.match(c.pixelsSha256,digest);
      assert.equal(c.preservedGrowthPixels,true);assert.equal(c.draw.instances,count);assert.equal(c.samples.length,24);
      assert.equal(c.draw.path,mode==='direct'?'direct':'indirect');
      if(mode==='direct')assert.equal(c.draw.cubeDraws,1);else{assert.equal(c.draw.opaque,count);assert.equal(c.draw.transparent,0);assert.equal(c.draw.stableIds,true);}
      for(const [frame,s] of c.samples.entries()){
        assert.equal(s.frame,frame);assert.ok(Number.isInteger(s.awake)&&s.awake>count*.95&&s.awake<count);assert.ok(Number.isInteger(s.contactPairs)&&s.contactPairs>count);
        assert.ok(Number.isSafeInteger(s.wasmHeapBytes)&&s.wasmHeapBytes>=c.capacity.bridgeBufferBytes&&s.wasmHeapBytes%65536===0);
        if(frame===0)assert.ok(s.uploadBytes===count*64||s.uploadBytes===count*80);
        else {
          assert.ok(s.wasmHeapBytes>=c.samples[frame-1].wasmHeapBytes);
          assert.equal(s.uploadBytes,count*(s.wasmHeapBytes===c.samples[frame-1].wasmHeapBytes?64:80),'heap growth requires refreshing both streams');
        }
        for(const key of ['stepMs','uploadMs','encodeMs','gpuCompletionMs','frameMs'])assert.ok(Number.isFinite(s[key])&&s[key]>=0);
        assert.ok(Math.abs(s.frameMs-s.stepMs-s.uploadMs-s.encodeMs-s.gpuCompletionMs)<1e-6,'frame stages must add up');
      }
      for(const key of ['stepMs','uploadMs','encodeMs','gpuCompletionMs','frameMs'])assert.deepEqual(c.distributions[key],distribution(c.samples.map(s=>s[key])));
    }
    assert.equal(r.mixed.count,65536);assert.equal(r.mixed.streams.verifiedBytes,65536*80);assert.match(r.mixed.pixelsSha256,digest);assert.equal(r.mixed.draw.instances,65536);
    if(mode==='direct')assert.equal(r.mixed.draw.cubeDraws,2);else{assert.equal(r.mixed.draw.opaque,43690);assert.equal(r.mixed.draw.transparent,21846);assert.equal(r.mixed.draw.stableIds,true);}
    assert.equal(r.rope.baseInstance,65536);assert.equal(r.rope.segmentCount,2);assert.equal(r.rope.rendererCapacity,131072);assert.equal(r.rope.draw.instances,65538);
    assert.equal(r.rope.matrices.length,32);assert.equal(r.rope.colors.length,8);assert.ok([...r.rope.matrices,...r.rope.colors].every(Number.isFinite));
    assert.deepEqual(r.rope.matrices.slice(12,16),[1,3,0,1]);assert.deepEqual(r.rope.matrices.slice(28,32),[2,4,0,1]);
  }
  for(let i=0;i<3;i++)for(const key of ['streams','pixelsSha256','replayHash'])assert.deepEqual(direct.cases[i][key],partition.cases[i][key],'direct/partition exact state and pixels');
  assert.deepEqual(direct.mixed.streams,partition.mixed.streams);assert.equal(direct.mixed.pixelsSha256,partition.mixed.pixelsSha256);
  assert.deepEqual(direct.rope.matrices,partition.rope.matrices);assert.deepEqual(direct.rope.colors,partition.rope.colors);
  return {capacities:[4096,16384,65536],exactDirectPartitionPixels:true,rawFramesPerMode:72,engineWideSpeedup:'not established'};
}
export async function verifyCapacityPacket(packet,nativeRun,options={}){
  const base=await fs.realpath(packet),manifest=await json(path.join(base,'manifest.json'));
  assert.deepEqual(verifyManifestStructure(manifest),[],'Invalid capture manifest');
  assert.equal((await inventory(path.join(base,'source'),['.'],LIMITS.sourceBytes)).sha256,manifest.source.sha256);
  const receipts={};
  for(const section of ['support','native-artifacts','evidence']){
    const receipt=await json(path.join(base,section+'-manifest.json'));
    assert.deepEqual(await inventory(path.join(base,section),['.'],LIMITS.sourceBytes),receipt);receipts[section]=receipt;
  }
  const direct=await json(path.join(base,'evidence/metal-direct.json')),partition=await json(path.join(base,'evidence/metal-partition.json'));
  const qualification=validateCapacityPair(direct,partition,options);
  const sourceMap=new Map([...manifest.source.files,...receipts.support.files].map(f=>[f.path,f.sha256]));
  for(const source of [...direct.sources,...direct.nativeSources])assert.equal(sourceMap.get(source.file),source.sha256,'GPU evidence must identify the frozen source: '+source.file);
  const artifactMap=new Map(receipts['native-artifacts'].files.map(f=>[f.path,f.sha256]));
  for(const artifact of direct.artifacts)assert.equal(artifactMap.get(artifact.file),artifact.sha256);
  const provenance=await json(path.join(base,'native-artifacts/BUILD_PROVENANCE.json'));
  assert.equal(provenance.bridge.sha256,sourceMap.get('wasm/box3d_web.c'));assert.equal(provenance.build.cmakeSha256,sourceMap.get('wasm/CMakeLists.txt'));
  assert.equal(provenance.bridge.deterministicDoubleBuild,true);assert.equal(provenance.validation.status,'pass');
  for(const name of ['box3d.js','box3d.wasm'])assert.equal(provenance.artifacts[name].sha256,artifactMap.get(name));
  const builds=await json(path.join(base,'evidence/double-build.json'));
  for(const name of ['box3d.js','box3d.wasm'])assert.equal(builds.first[name].sha256,artifactMap.get(name));assert.deepEqual(builds.first,builds.second);
  const native=await verifyNativeWorldRun(nativeRun),oldAudit=await json(path.join(base,'evidence/native-integrity.json'));
  assert.equal(native.resultSha256,oldAudit.resultSha256);const nativeResult=await json(path.join(nativeRun,'result.json'));
  for(const source of nativeResult.candidateSource.files)assert.equal(sourceMap.get(source.path),source.sha256);
  for(const artifact of nativeResult.candidateArtifacts.files)assert.equal(artifactMap.get(artifact.path),artifact.sha256);
  return {schema:'box3d.native-capacity-integrity/1',status:'pass',packet:base,sourceSha256:manifest.source.sha256,
    evidenceSha256:receipts.evidence.sha256,nativeResultSha256:native.resultSha256,qualification,
    statement:'Frozen source/artifact/harness/log hashes and recorded frame arithmetic agree. Exact recorded stream/pixel digests match. Does not rerun hardware or qualify a speedup.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2),['--packet','--native-run','--receipt']);
  if(!args['--packet']||!args['--native-run'])throw new Error('--packet and --native-run are required');
  const result=await verifyCapacityPacket(args['--packet'],args['--native-run']);
  if(args['--receipt'])await writeJsonExclusive(args['--receipt'],result);console.log(JSON.stringify(result,null,2));
}
