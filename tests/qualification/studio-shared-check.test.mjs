import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {gateSharedTransport} from '../../scripts/studio-shared-benchmark.mjs';
import {validateSharedStress} from '../../scripts/studio-shared-check.mjs';
const timing=JSON.parse(fs.readFileSync(new URL('../../benchmarks/results/engine-100x/runs/studio-shared-transport-20260910-01/result.json',import.meta.url)));
const stress=JSON.parse(fs.readFileSync(new URL('../../benchmarks/results/engine-100x/runs/studio-shared-stress-20260910-01/result.json',import.meta.url)));
test('shared transport retains its measured but unqualified speedup result',()=>{
  const gate=gateSharedTransport(timing.samples,timing.protocol);assert.deepEqual(gate,timing.gate);assert.equal(gate.controlQualified,true);assert.deepEqual(gate.qualifiedCases,[]);
});
test('transport gate rejects altered exact outputs, unfair payload accounting and reused process identities',()=>{
  for(const mutate of [r=>r.samples[1].cases[0].outputSha256='0'.repeat(64),r=>r.samples[1].cases[0].messages.liveSharedBytes=0,r=>r.samples[1].cases[1].roundTripMs[0]=0,r=>r.samples[1].pid=r.samples[0].pid,r=>r.protocol.thresholds.minRatioLowerBound=.5]){
    const r=structuredClone(timing);mutate(r);assert.equal(gateSharedTransport(r.samples,r.protocol).status,'incomparable');
  }
  const changed=structuredClone(timing);for(const r of changed.samples)if(r.mode==='shared')r.controls=r.controls.map(x=>x*2);
  assert.equal(gateSharedTransport(changed.samples,changed.protocol).controlQualified,false);assert.deepEqual(gateSharedTransport(changed.samples,changed.protocol).qualifiedCases,[]);
});
test('concurrent ring counters require every scalar, delayed read and bounded-storage sample',()=>{
  assert.equal(validateSharedStress(stress).snapshots,131072);
  for(const mutate of [r=>r.scalarChecks--,r=>r.delayedReads--,r=>r.samples[5].sharedBytes+=4,r=>r.tornReads=1,r=>r.samples.pop(),r=>r.protocol.writerYieldEvery=0]){const r=structuredClone(stress);mutate(r);assert.throws(()=>validateSharedStress(r));}
});
