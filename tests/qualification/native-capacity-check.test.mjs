import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {validateCapacityPair,verifyCapacityPacket} from '../../scripts/native-capacity-check.mjs';
const direct=JSON.parse(fs.readFileSync(new URL('../../benchmarks/results/engine-100x/native-capacity-renderer-metal-direct-20260910-01.json',import.meta.url)));
const partition=JSON.parse(fs.readFileSync(new URL('../../benchmarks/results/engine-100x/native-capacity-renderer-metal-partition-20260910-01.json',import.meta.url)));
test('retained real Metal records pass the independent capacity arithmetic audit',()=>{
  assert.equal(validateCapacityPair(direct,partition).rawFramesPerMode,72);
});
test('falsified timing, capacity, exact-output, adapter and heap-refresh records fail qualification',()=>{
  for(const corrupt of [
    r=>r.cases[0].distributions.frameMs.p95=0,
    r=>r.cases[1].samples[3].frameMs+=1,
    r=>r.cases[2].count=4096,
    r=>r.cases[2].streams.verifiedBytes=4096*80,
    r=>r.cases[2].pixelsSha256='0'.repeat(64),
    r=>r.adapter.isFallbackAdapter=true,
    r=>r.cases[1].samples[4].uploadBytes=16384*64,
    r=>r.mixed.draw.cubeDraws=1,
    r=>r.rope.matrices[12]=0,
  ]){
    const changed=structuredClone(direct);corrupt(changed);assert.throws(()=>validateCapacityPair(changed,partition));
  }
});
test('packet validation rejects changed manifest identities before inspecting evidence',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'box3d-invalid-native-manifest-'));
  try {
    const manifest=JSON.parse(fs.readFileSync(new URL('../../benchmarks/results/engine-100x/verification-native-capacity-20260910/manifest.json',import.meta.url)));
    manifest.identity.sourceSha256='0'.repeat(64);
    fs.writeFileSync(path.join(temporary,'manifest.json'),JSON.stringify(manifest));
    await assert.rejects(verifyCapacityPacket(temporary,temporary),/Invalid capture manifest/);
  } finally { fs.rmSync(temporary,{recursive:true,force:true}); }
});
