#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {inventory,hashFile,hashValue} from './engine-baseline.mjs';
import {cableProtocol,cableCaseDefinition,plainCableState,evaluateCableCampaign} from './cable-oracle.mjs';

export async function auditCableRun(directory) {
  const report={schema:'box3d.cable-accuracy-integrity/1',status:'failed',issues:[]};
  try {
    directory=await fs.realpath(directory);const read=async file=>{
      const target=path.join(directory,file),stat=await fs.lstat(target);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=16*1024*1024,'Invalid or oversized record');
      const bytes=await fs.readFile(target);assert.ok(bytes.length<=16*1024*1024,'Oversized record');return JSON.parse(bytes.toString('utf8'));
    };
    const manifest=await read('manifest.json'),p=await read('protocol.json'),result=await read('result.json');
    assert.equal(manifest.schema,'box3d.cable-accuracy-manifest/1');assert.equal(result.schema,'box3d.cable-accuracy-result/1');assert.deepEqual(p,cableProtocol());
    const source=await inventory(path.join(directory,'source'),['.'],1024*1024);assert.deepEqual(source,manifest.source);
    assert.equal(result.sourceSha256,source.sha256);assert.equal(hashValue(p),manifest.protocolSha256);assert.equal(result.protocolSha256,manifest.protocolSha256);
    assert.deepEqual(result.records.map(r=>r.spec),p.cases);
    const core=await import(pathToFileURL(path.join(directory,'source/src/engine/compliant-cable.ts')).href);
    for(const record of result.records) {
      const {spec}=record;assert.deepEqual(await read(spec.id+'.json'),record);assert.equal(record.samples.length,spec.samples+1);
      const runtime=new core.CompliantCableRuntime(cableCaseDefinition(spec,core));
      try {
        for(let i=0;i<record.samples.length;i++) {
          const expectedTick=i*spec.ticks/spec.samples;assert.equal(record.samples[i].tick,expectedTick);
          while(runtime.tick<expectedTick)runtime.step({ticks:Math.min(expectedTick-runtime.tick,120)});
          assert.deepEqual(plainCableState(runtime.inspect()),record.samples[i],'Replayed full state differs');
        }
        assert.deepEqual(runtime.checkpoint(),record.checkpoint);const restored=core.CompliantCableRuntime.fromCheckpoint(record.checkpoint);
        try{assert.deepEqual(plainCableState(restored.step({ticks:17})),record.continuation);assert.deepEqual(plainCableState(runtime.step({ticks:17})),record.continuation);}finally{restored.destroy();}
      }finally{runtime.destroy();}
    }
    const gate=evaluateCableCampaign(result.records,p);assert.deepEqual(gate,result.gate);assert.equal(gate.status,'passed');
    Object.assign(report,{status:'passed',cases:gate.cases,samples:gate.samples,continuum:gate.continuum,sourceSha256:source.sha256,protocolSha256:hashValue(p),resultSha256:await hashFile(path.join(directory,'result.json')),scope:gate.scope,speedupClaim:false});
  }catch(error){report.issues.push(error.message);}
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const report=await auditCableRun(process.argv[2]);console.log(JSON.stringify(report,null,2));process.exitCode=report.status==='passed'?0:1;
}
