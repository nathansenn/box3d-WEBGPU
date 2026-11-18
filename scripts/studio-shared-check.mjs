#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {inventory,LIMITS,hashFile,parseArgs,writeJsonExclusive,verifyManifestStructure} from './engine-baseline.mjs';
import {verifySharedTransportRun} from './studio-shared-benchmark.mjs';
export function validateSharedStress(r){
  assert.equal(r.schema,'box3d.shared-snapshot-stress/1');assert.equal(r.status,'pass');
  const p=r.protocol;assert.equal(p.snapshots,131072);assert.equal(p.generation,2**32+41);assert.equal(p.writerYieldEvery,31);assert.equal(p.readerYieldEvery,17);assert.equal(p.maxSeconds,90);
  assert.deepEqual(p.dimensions,{positions:2673,strains:891,broken:5048});
  assert.equal(r.snapshots,p.snapshots);assert.equal(r.delayedReads,Math.floor(r.snapshots/p.readerYieldEvery));assert.equal(r.scalarChecks,(r.snapshots+r.delayedReads)*(p.dimensions.positions+p.dimensions.strains+p.dimensions.broken));
  assert.equal(r.tornReads,0);assert.equal(r.slots,3);assert.equal(r.sharedBytes,256+3*Math.ceil(((p.dimensions.positions+p.dimensions.strains)*4+p.dimensions.broken)/4)*4);assert.equal(r.outstandingAtFinish,0);
  assert.ok(r.elapsedMs>0&&r.elapsedMs<p.maxSeconds*1000);assert.match(r.ticketTraceSha256,/^[a-f0-9]{64}$/);assert.equal(r.samples.length,128);
  for(const [i,s]of r.samples.entries()){assert.equal(s.received,(i+1)*1024);assert.equal(s.sharedBytes,r.sharedBytes);}
  return {snapshots:r.snapshots,scalarChecks:r.scalarChecks,delayedReads:r.delayedReads,sharedBytes:r.sharedBytes};
}
export async function verifySharedStressRun(directory){
  const root=await fs.realpath(directory),r=JSON.parse(await fs.readFile(path.join(root,'result.json'))),result=validateSharedStress(r);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(root,'protocol.json'))),r.protocol);
  for(const group of ['source','harness'])assert.deepEqual(await inventory(path.join(root,group),['.'],LIMITS.sourceBytes),r[group]);
  return {schema:'box3d.shared-snapshot-stress-integrity/1',status:'pass',...result,resultSha256:await hashFile(path.join(root,'result.json')),sourceSha256:r.source.sha256,harnessSha256:r.harness.sha256,scope:'Frozen inputs and declared concurrent-stress counters rehash correctly. Does not rerun concurrency or qualify throughput.'};
}
export async function verifySharedSnapshotPacket(packet,stressRun,timingRun){
  const base=await fs.realpath(packet),read=async file=>JSON.parse(await fs.readFile(path.join(base,file)));
  const manifest=await read('manifest.json');assert.deepEqual(verifyManifestStructure(manifest),[]);assert.deepEqual(await inventory(path.join(base,'source'),['.'],LIMITS.sourceBytes),manifest.source);
  for(const section of ['support','evidence'])assert.deepEqual(await inventory(path.join(base,section),['.'],LIMITS.sourceBytes),await read(section+'-manifest.json'));
  const stress=await verifySharedStressRun(stressRun),timing=await verifySharedTransportRun(timingRun);
  assert.equal(stress.resultSha256,(await read('evidence/stress-integrity.json')).resultSha256);assert.deepEqual(timing,await read('evidence/timing-integrity.json'));
  assert.equal(timing.integrity.sourceSha256,manifest.source.sha256);
  const stressResult=JSON.parse(await fs.readFile(path.join(stressRun,'result.json'))),sourceMap=new Map(manifest.source.files.map(f=>[f.path,f.sha256]));
  for(const f of stressResult.source.files)assert.equal(sourceMap.get(f.path),f.sha256);
  const summary=await read('summary.json');assert.equal(summary.sourceSha256,manifest.source.sha256);assert.equal(summary.checks.engineTests,178);assert.equal(summary.checks.concurrentSnapshots,stress.snapshots);assert.equal(summary.qualifiedSpeedup,false);assert.equal(summary.defaultTransport,'transfer');
  return {schema:'box3d.shared-snapshot-phase-integrity/1',status:'pass',sourceSha256:manifest.source.sha256,evidenceSha256:(await read('evidence-manifest.json')).sha256,stress,timing,scope:'Source, run inputs, recorded correctness and timing gate agree. Optional transport is implemented; no speedup or engine-wide performance claim is accepted.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2),['--run','--packet','--timing-run','--receipt']);if(!args['--run'])throw new Error('--run is required');if(args['--packet']&&!args['--timing-run'])throw new Error('--timing-run is required with --packet');const r=args['--packet']?await verifySharedSnapshotPacket(args['--packet'],args['--run'],args['--timing-run']):await verifySharedStressRun(args['--run']);if(args['--receipt'])await writeJsonExclusive(args['--receipt'],r);console.log(JSON.stringify(r,null,2));
}
