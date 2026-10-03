#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {parseArgs,reserveRunDirectory,inventory,hashFile,hashValue,writeJsonExclusive} from './engine-baseline.mjs';
import {cableProtocol,cableCaseDefinition,plainCableState,evaluateCableCampaign} from './cable-oracle.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceFiles=['src/engine/contracts.ts','src/engine/compliant-cable.ts','scripts/cable-oracle.mjs','scripts/cable-qualify.mjs','scripts/cable-check.mjs','scripts/engine-baseline.mjs','tests/engine/compliant-cable.test.mjs'];
const args=parseArgs(process.argv.slice(2),['--out']);
if(args.help){console.log('node scripts/cable-qualify.mjs --out NEW_DIRECTORY');process.exit(0);}
if(!args['--out'])throw new Error('A new --out directory is required.');
const out=await reserveRunDirectory(args['--out'],[root]);
const protocol=cableProtocol(),source=await inventory(root,sourceFiles,1024*1024);
await fs.mkdir(path.join(out,'source'));
for(const entry of source.files){const target=path.join(out,'source',entry.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,entry.path),target,fs.constants.COPYFILE_EXCL);assert.equal(await hashFile(target),entry.sha256);}
const core=await import(pathToFileURL(path.join(out,'source/src/engine/compliant-cable.ts')).href);
await writeJsonExclusive(path.join(out,'protocol.json'),protocol);
await writeJsonExclusive(path.join(out,'manifest.json'),{schema:'box3d.cable-accuracy-manifest/1',source,protocolSha256:hashValue(protocol),runtime:{node:process.version,platform:process.platform,arch:process.arch},createdAt:new Date().toISOString()});
const records=[];
for(const spec of protocol.cases) {
  const runtime=new core.CompliantCableRuntime(cableCaseDefinition(spec,core));
  try {
    const samples=[plainCableState(runtime.inspect())],interval=spec.ticks/spec.samples;assert.ok(Number.isInteger(interval));
    for(let i=1;i<=spec.samples;i++){
      let remaining=interval;while(remaining){const n=Math.min(remaining,120);runtime.step({ticks:n});remaining-=n;}
      samples.push(plainCableState(runtime.inspect()));
    }
    const checkpoint=runtime.checkpoint(),restored=core.CompliantCableRuntime.fromCheckpoint(JSON.parse(JSON.stringify(checkpoint)));
    try{assert.deepEqual(restored.inspect(),runtime.inspect());assert.deepEqual(restored.step({ticks:17}),runtime.step({ticks:17}));}finally{restored.destroy();}
    const record={spec,samples,checkpoint,continuation:plainCableState(runtime.inspect())};records.push(record);await writeJsonExclusive(path.join(out,spec.id+'.json'),record);
  }finally{runtime.destroy();}
}
assert.deepEqual(await inventory(root,sourceFiles,1024*1024),source,'Source changed while the qualification ran');
const result={schema:'box3d.cable-accuracy-result/1',sourceSha256:source.sha256,protocolSha256:hashValue(protocol),records,gate:evaluateCableCampaign(records,protocol)};
await writeJsonExclusive(path.join(out,'result.json'),result);
console.log(JSON.stringify({out,...result.gate},null,2));process.exitCode=result.gate.status==='passed'?0:1;
