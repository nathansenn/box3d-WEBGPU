import assert from 'node:assert/strict';import fs from 'node:fs';import test from 'node:test';
import {validateBodyLifecycle} from '../../scripts/native-recycling-check.mjs';
const source=JSON.parse(fs.readFileSync(new URL('../../benchmarks/results/engine-100x/runs/native-body-recycling-20260910-04/result.json',import.meta.url)));
test('the recorded million-pair run passes independent lifecycle arithmetic',()=>assert.equal(validateBodyLifecycle(source).spawnDespawnPairs,1048576));
test('memory growth, revived generations, truncated lifecycle counts and invented rejection counts fail the audit',()=>{
 for(const corrupt of [r=>r.samples[127].heapBytes+=65536,r=>r.lastHotToken=r.firstHotToken,r=>r.spawnDespawnPairs--,r=>r.staleRejections++,r=>r.samples[70].bodyCount=1,r=>r.samples.pop()]){
  const r=structuredClone(source);corrupt(r);assert.throws(()=>validateBodyLifecycle(r));
 }
});
