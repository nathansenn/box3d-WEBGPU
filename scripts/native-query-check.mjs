#!/usr/bin/env node
/** Rehash frozen inputs and recompute recorded geometric errors without WASM. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {hashFile,hashValue,inventory,LIMITS,parseArgs,writeJsonExclusive,verifyManifestStructure} from './engine-baseline.mjs';
import {QUERY_PROTOCOL} from './native-query-qualify.mjs';
import {referenceQuery} from './native-query-oracle.mjs';
import {verifyNativeWorldRun} from './native-world-check.mjs';
const digestPattern=/^[a-f0-9]{64}$/;
const finite=(value,min,max)=>assert.ok(Number.isFinite(value)&&value>=min&&value<=max);
const int=(value,min,max)=>{finite(value,min,max);assert.ok(Number.isSafeInteger(value));};
const clean=value=>JSON.parse(JSON.stringify(value,(_,v)=>typeof v==='bigint'?v.toString():v));
function token(value){assert.match(value,/^[1-9][0-9]*$/);const n=BigInt(value);assert.ok(n>0n&&n<=0xFFFFFFFFFFFFFFFFn&&(n&0x1FFFFn)>0n&&(n&0x1FFFFn)<=65536n&&(n>>17n)>0n);return n;}
function vector(value){assert.ok(Array.isArray(value));assert.equal(value.length,3);value.forEach(n=>finite(n,-1e6,1e6));}
export function checkQueryGroup(group,expectedLabel,expectedBodies){
  assert.equal(group.label,expectedLabel);assert.equal(group.bodies,expectedBodies);assert.equal(group.comparedWithSerial,true);
  const rotated=expectedLabel==='rotated',count=rotated?2048:1280;
  assert.equal(group.queries,count);assert.equal(group.samples.length,count);
  const digest=createHash('sha256'),errors={fraction:0,point:0,normal:0};let hits=0,overflows=0,edgeNormals=0;
  for(let i=0;i<count;i++){
    const s=group.samples[i],q=s.query,a=s.actual,e=s.reference;
    assert.equal(s.index,i);assert.equal(q.kind,i<1024?'ray':i<1024+(rotated?512:128)?'sphere-overlap':'box-overlap');
    assert.equal(s.kind,q.kind);assert.equal(a.kind,q.kind);assert.equal(q.limit,256);vector(q.origin);
    if(q.kind==='ray')vector(q.translation);else if(q.kind==='sphere-overlap')finite(q.radius,Number.MIN_VALUE,1e6);else vector(q.halfExtents);
    int(s.totalHits,0,expectedBodies);int(s.returned,0,256);assert.equal(a.totalHits,s.totalHits);assert.equal(e.totalHits,s.totalHits);
    assert.equal(s.returned,Math.min(s.totalHits,256));assert.equal(s.overflow,s.totalHits>s.returned);assert.equal(a.overflow,s.overflow);
    assert.equal(a.hits.length,s.returned);assert.equal(e.hits.length,s.returned);assert.equal(e.boxes.length,s.returned);
    assert.equal(hashValue(a),s.actualSha256);assert.match(s.actualSha256,digestPattern);digest.update(s.actualSha256);
    const boxes=e.boxes.map(b=>{vector(b.center);vector(b.halfExtents);b.halfExtents.forEach(h=>finite(h,Number.MIN_VALUE,1e6));assert.equal(b.axes.length,3);b.axes.forEach(vector);return {...b,token:token(b.token)};});
    const computed=referenceQuery(q,boxes,QUERY_PROTOCOL.overlapDistanceTolerance,QUERY_PROTOCOL.errors.point);
    assert.deepEqual(clean(computed),e.hits,'Retained geometry and reference intersections disagree');
    assert.equal(new Set(a.hits.map(h=>h.body.token)).size,a.hits.length,'Duplicate collider in result');
    for(let j=0;j<a.hits.length;j++){
      const actual=a.hits[j],reference=e.hits[j];assert.equal(actual.body.token,reference.token);token(actual.body.token);
      if(q.kind==='ray'){
        vector(actual.point);vector(actual.normal);finite(actual.fraction,0,1);
        errors.fraction=Math.max(errors.fraction,Math.abs(actual.fraction-reference.fraction));
        for(let k=0;k<3;k++)errors.point=Math.max(errors.point,Math.abs(actual.point[k]-reference.point[k]));
        errors.normal=Math.max(errors.normal,Math.min(...reference.normals.map(n=>Math.max(...n.map((v,k)=>Math.abs(v-actual.normal[k]))))));
        edgeNormals+=Number(reference.normals.length>1);assert.equal(actual.material,'0');int(actual.triangleIndex,-1,0);int(actual.childIndex,0,0);
      }
    }
    hits+=s.returned;overflows+=Number(s.overflow);
  }
  assert.deepEqual(errors,group.maxError);for(const [key,error] of Object.entries(errors))finite(error,0,QUERY_PROTOCOL.errors[key]);
  assert.equal(group.hitCount,hits);assert.equal(group.overflows,overflows);assert.equal(group.edgeNormals,edgeNormals);assert.equal(group.digest,digest.digest('hex'));
  assert.equal(group.queryBytes,128*96+32768*56);int(group.heapBytes,65536,2**32);assert.equal(group.heapBytes%65536,0);
  return {queries:count,hits,maxError:errors,edgeNormals};
}
export async function verifyNativeQueryRun(directory){
  const root=await fs.realpath(directory);
  const read=async relative=>{const file=path.join(root,relative);assert.ok((await fs.stat(file)).size<=LIMITS.sourceBytes);return JSON.parse(await fs.readFile(file,'utf8'));};
  const r=await read('result.json');assert.equal(r.schema,'box3d.native-query-qualification/1');assert.equal(r.status,'pass');
  assert.deepEqual(r.protocol,QUERY_PROTOCOL);assert.equal(r.protocolSha256,hashValue(QUERY_PROTOCOL));assert.deepEqual(await read('protocol.json'),QUERY_PROTOCOL);
  for(const key of ['source','artifacts','harness','raw']){
    const observed=await inventory(path.join(root,key),['.'],LIMITS.sourceBytes);assert.deepEqual(observed,r[key],`${key} files changed`);
  }
  assert.equal(await hashFile(process.execPath),r.environment.runtime.executableSha256);
  const raw=await read('raw/geometry.json');assert.equal(raw.length,4);
  const summaries=raw.map((g,i)=>checkQueryGroup(g,i===3?'rotated':'capacity-'+QUERY_PROTOCOL.capacities[i],i===3?256:QUERY_PROTOCOL.capacities[i]));
  assert.deepEqual(r.summary,{groups:4,queries:5888,hits:summaries.reduce((n,g)=>n+g.hits,0),exactBodyMatches:true,exactBatchSerial:true,
    maxError:Object.fromEntries(['fraction','point','normal'].map(k=>[k,Math.max(...summaries.map(g=>g.maxError[k]))]))});
  finite(r.elapsedMs,0,QUERY_PROTOCOL.maxWallSeconds*1000);
  return {schema:'box3d.native-query-integrity/1',status:'pass',run:root,resultSha256:await hashFile(path.join(root,'result.json')),summary:r.summary,
    edgeNormals:summaries.reduce((n,g)=>n+g.edgeNormals,0),
    statement:'Frozen source/artifacts/harness/raw hashes match. Retained hit geometry, body IDs, counts, ordering, cast errors, SDK overlap slop and boundary-normal alternatives pass independent recomputation. Exhaustive missing-hit checks and exact batch/serial checks ran in the frozen harness. No speedup claim.'};
}
export async function verifyNativeQueryPacket(packet,queryRun,worldRun){
  const base=await fs.realpath(packet),read=async file=>JSON.parse(await fs.readFile(path.join(base,file),'utf8'));
  const manifest=await read('manifest.json');assert.deepEqual(verifyManifestStructure(manifest),[]);
  assert.deepEqual(await inventory(path.join(base,'source'),['.'],LIMITS.sourceBytes),manifest.source);
  const receipts={};
  for(const name of ['support','native-artifacts','fault-artifacts','evidence']){
    receipts[name]=await read(name+'-manifest.json');assert.deepEqual(await inventory(path.join(base,name),['.'],LIMITS.sourceBytes),receipts[name]);
  }
  const sourceMap=new Map([...manifest.source.files,...receipts.support.files].map(f=>[f.path,f.sha256]));
  const artifactMap=new Map(receipts['native-artifacts'].files.map(f=>[f.path,f.sha256]));
  const queries=await verifyNativeQueryRun(queryRun),worlds=await verifyNativeWorldRun(worldRun);
  const qr=JSON.parse(await fs.readFile(path.join(queryRun,'result.json'),'utf8')),wr=JSON.parse(await fs.readFile(path.join(worldRun,'result.json'),'utf8'));
  for(const f of qr.source.files)assert.equal(sourceMap.get(f.path),f.sha256);
  for(const f of wr.candidateSource.files)assert.equal(sourceMap.get(f.path),f.sha256);
  for(const f of [...qr.artifacts.files,...wr.candidateArtifacts.files])assert.equal(artifactMap.get(f.path),f.sha256);
  assert.equal((await read('evidence/query-integrity.json')).resultSha256,queries.resultSha256);
  assert.equal((await read('evidence/world-integrity.json')).resultSha256,worlds.resultSha256);
  const metal=await read('evidence/metal-lifecycle.json');assert.equal(metal.status,'passed');assert.equal(metal.dawnBackend,'metal');assert.equal(metal.adapter.isFallbackAdapter,false);assert.equal(metal.mode,'direct');assert.equal(metal.uncapturedWebGpuErrors,0);
  assert.equal(metal.cases.length,10);for(const c of metal.cases){assert.equal(c.copiedPixelsExact,true);assert.equal(c.verifiedStreamBytes,c.count*80);assert.match(c.pixelsSha256,digestPattern);assert.match(c.streamSha256,digestPattern);}
  for(const s of [...metal.sources,...metal.nativeSources])assert.equal(sourceMap.get(s.file),s.sha256);
  for(const a of metal.artifacts)assert.equal(artifactMap.get(a.file),a.sha256);
  const builds=await read('evidence/double-build.json');assert.deepEqual(builds.first,builds.second);assert.equal(builds.testOnlyExportsAbsent,true);
  const binary=await fs.readFile(path.join(base,'native-artifacts/box3d.wasm'));
  assert.ok(WebAssembly.validate(binary));assert.equal(WebAssembly.Module.exports(new WebAssembly.Module(binary)).some(e=>e.name.startsWith('b3w_test_')),false);
  for(const name of ['box3d.js','box3d.wasm'])assert.equal(builds.first[name].sha256,artifactMap.get(name));
  const provenance=await read('native-artifacts/BUILD_PROVENANCE.json');assert.equal(provenance.bridge.sha256,sourceMap.get('wasm/box3d_web.c'));assert.equal(provenance.build.cmakeSha256,sourceMap.get('wasm/CMakeLists.txt'));
  assert.equal(provenance.validation.status,'pass');assert.equal(provenance.validation.engineTests,186);assert.equal(provenance.bridge.deterministicDoubleBuild,true);
  for(const name of ['box3d.js','box3d.wasm'])assert.equal(provenance.artifacts[name].sha256,artifactMap.get(name));
  const build=await read('evidence/production-build.json');assert.equal(build.status,'pass');assert.equal(build.probesExcluded,true);
  assert.deepEqual(await inventory(build.output,['.'],LIMITS.assetBytes),build.files);
  const tests=await fs.readFile(path.join(base,'evidence/engine-tests.log'),'utf8');assert.match(tests,/tests 186/);assert.match(tests,/pass 186/);assert.match(tests,/fail 0/);
  return {schema:'box3d.native-query-packet-integrity/1',status:'pass',packet:base,sourceSha256:manifest.source.sha256,evidenceSha256:receipts.evidence.sha256,
    queryResultSha256:queries.resultSha256,worldResultSha256:worlds.resultSha256,queries:queries.summary,
    statement:'Frozen bridge, adapter, artifacts, tests, browser observations and production build are identified. Recorded geometry and exact native/GPU stream/pixel checks pass. Spatial-query slice only; contact events, impulse streams and independent shape IDs remain. No speedup or deployment claim.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2),['--run','--receipt','--packet','--world-run']);
  if(args.help)console.log('node scripts/native-query-check.mjs --run FROZEN_RUN [--receipt NEW_FILE]');
  else {const r=args['--packet']?await verifyNativeQueryPacket(args['--packet'],args['--run'],args['--world-run']):await verifyNativeQueryRun(args['--run']);if(args['--receipt'])await writeJsonExclusive(path.resolve(args['--receipt']),r);console.log(JSON.stringify(r,null,2));}
}
