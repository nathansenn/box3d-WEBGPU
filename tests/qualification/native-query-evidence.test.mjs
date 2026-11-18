import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {checkQueryGroup} from '../../scripts/native-query-check.mjs';
import {hashValue} from '../../scripts/engine-baseline.mjs';
const file='benchmarks/results/engine-100x/runs/native-queries-geometry-20260910-04/raw/geometry.json';
const raw=JSON.parse(await fs.readFile(file,'utf8'));
function reseal(group,sample){sample.actualSha256=hashValue(sample.actual);const h=createHash('sha256');for(const s of group.samples)h.update(s.actualSha256);group.digest=h.digest('hex');}

test('retained query geometry independently recomputes the accepted error envelope',()=>{
  const result=checkQueryGroup(raw[0],'capacity-4096',4096);assert.equal(result.queries,1280);assert.equal(result.hits,2711);
});
test('resealing a displaced hit or a nonincident normal cannot pass the geometric audit',()=>{
  for(const change of [hit=>hit.point[0]+=.01,hit=>hit.normal=[0,0,1]]){
    const group=structuredClone(raw[0]),sample=group.samples.find(s=>s.kind==='ray'&&s.actual.hits.length);
    change(sample.actual.hits[0]);reseal(group,sample);assert.throws(()=>checkQueryGroup(group,'capacity-4096',4096));
  }
});
test('query audit rejects missing body references and false overflow metadata',()=>{
  for(const change of [s=>s.actual.hits[0].body.token='0',s=>s.actual.overflow=true]){
    const group=structuredClone(raw[0]),sample=group.samples.find(s=>s.actual.hits.length);change(sample);reseal(group,sample);
    assert.throws(()=>checkQueryGroup(group,'capacity-4096',4096));
  }
});
