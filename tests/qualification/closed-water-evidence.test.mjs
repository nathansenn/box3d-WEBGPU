import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {readClosedWaterState,auditClosedWaterRun} from '../../scripts/closed-water-check.mjs';
import {compareFields,waveErrorScales} from '../../scripts/closed-water-oracle.mjs';

test('wave error normalization treats elevation and velocity in their own physical units',()=>{
  const scales=waveErrorScales({gravity:9,meanDepth:1},{amplitude:.1});
  const expected={eta:[0],u:[0],v:[0]},actual={eta:[.1],u:[.3],v:[.3]};
  assert.ok(Math.abs(compareFields(actual,expected,scales).normalizedRms-1)<1e-15);
});

test('raw field audit rejects a changed byte, missing components and unsafe paths',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'box3d-closed-audit-'));
  try {
    const bytes=Buffer.alloc(9*24),record={file:'state.f32',bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),fields:['eta','u','v','nextEta','nextU','nextV'],format:'six contiguous little-endian float32 fields'};
    await fs.writeFile(path.join(dir,record.file),bytes);assert.equal((await readClosedWaterState(dir,record,9)).eta.length,9);
    bytes[0]=1;await fs.writeFile(path.join(dir,record.file),bytes);await assert.rejects(readClosedWaterState(dir,record,9),/hash/);
    await assert.rejects(readClosedWaterState(dir,{...record,file:'../state.f32'},9),/Unsafe/);
    await assert.rejects(readClosedWaterState(dir,{...record,fields:['eta']},9));
    const result=await auditClosedWaterRun(dir);assert.equal(result.status,'failed');assert.equal(result.cases,0);assert.equal(result.issues.length,1);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
