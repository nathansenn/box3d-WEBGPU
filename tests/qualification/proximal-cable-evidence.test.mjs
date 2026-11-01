import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as core from '../../src/engine/compliant-cable.ts';
import {plainCableState,cableCaseDefinition} from '../../scripts/cable-oracle.mjs';
import {evaluateProximal,auditProximal} from '../../scripts/cable-proximal-qualify.mjs';

const run=path.resolve('benchmarks/results/engine-100x/runs/proximal-cable-accuracy-20260911-02');
test('the original backend replays all 702 previously qualified sampled states and checkpoints exactly',async()=>{
  const result=JSON.parse(await fs.readFile('benchmarks/results/engine-100x/runs/compliant-cable-accuracy-20260910-04/result.json','utf8'));let count=0;
  for(const record of result.records){
    const r=new core.CompliantCableRuntime(cableCaseDefinition(record.spec,core));
    try{for(const sample of record.samples){while(r.tick<sample.tick)r.step({ticks:Math.min(sample.tick-r.tick,120)});assert.deepEqual(plainCableState(r.inspect()),sample);count++;}
      assert.deepEqual(r.checkpoint(),record.checkpoint);assert.deepEqual(plainCableState(r.step({ticks:17})),record.continuation);
    }finally{r.destroy();}
  }assert.equal(count,702);
});

test('the nonlinear gate rejects changed shapes, reactions, time trajectories, impulse balance and constraint convergence',async()=>{
  const result=JSON.parse(await fs.readFile(path.join(run,'result.json'),'utf8'));
  for(const [kind,mutate] of [
    ['span',r=>r.samples.at(-1).positions[4]-=.01],['span',r=>r.samples.at(-1).tensions[0]+=1],['span',r=>r.samples.at(-1).supportReactions[1]+=1],
    ['symmetric',r=>r.samples.at(-1).velocities[4]+=.01],['commands',r=>r.stats.maxImpulseDefect=.1],['span',r=>r.stats.unconvergedSubsteps=1],['span',r=>r.stats.maxConstraintForceResidual=.1],
  ]){const records=structuredClone(result.records);mutate(records.find(r=>r.spec.kind===kind));assert.equal(evaluateProximal(records).status,'failed');}
});

test('the nonlinear auditor rejects changed solver source before replaying it',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'box3d-proximal-audit-'));
  try{
    const manifest=JSON.parse(await fs.readFile(path.join(run,'manifest.json'),'utf8'));
    for(const name of ['manifest.json','protocol.json','result.json'])await fs.copyFile(path.join(run,name),path.join(directory,name));
    for(const entry of manifest.source.files){const target=path.join(directory,'source',entry.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(run,'source',entry.path),target);}
    await fs.appendFile(path.join(directory,'source/src/engine/compliant-cable.ts'),'\nthrow new Error("Must reject this changed source before import.");\n');
    const report=await auditProximal(directory);assert.equal(report.status,'failed');assert.match(report.issues.join('\n'),/sha256/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
