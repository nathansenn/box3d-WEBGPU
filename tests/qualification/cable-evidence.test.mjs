import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {auditCableRun} from '../../scripts/cable-check.mjs';
import {evaluateCableCase,cableProtocol} from '../../scripts/cable-oracle.mjs';

const run=path.resolve('benchmarks/results/engine-100x/runs/compliant-cable-accuracy-20260910-04');
test('physical cable gate rejects altered trajectory, force, momentum and convergence evidence',async()=>{
  const result=JSON.parse(await fs.readFile(path.join(run,'result.json'),'utf8')),p=cableProtocol();
  for(const [kind,mutate] of [
    ['spring',s=>s.positions[4]+=.01],['spring',s=>s.tensions[0]+=1],['spring',s=>s.supportReactions[1]+=1],
    ['spring',s=>s.diagnostics.maxImplicitForceResidual=1],['hanging',s=>s.diagnostics.unconvergedSubsteps=1],
    ['hanging',s=>s.positions[s.positions.length-2]-=.01],['momentum',s=>s.diagnostics.momentum[0]+=1],
  ]) {
    const record=structuredClone(result.records.find(r=>r.spec.kind===kind));mutate(record.samples.at(-1));
    assert.equal(evaluateCableCase(record.spec,record.samples,p.thresholds).status,'failed');
  }
});

test('cable auditor rejects a changed solver before loading it',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'box3d-cable-audit-'));
  try {
    const manifest=JSON.parse(await fs.readFile(path.join(run,'manifest.json'),'utf8'));
    for(const name of ['manifest.json','protocol.json','result.json'])await fs.copyFile(path.join(run,name),path.join(directory,name));
    for(const entry of manifest.source.files){const target=path.join(directory,'source',entry.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(run,'source',entry.path),target);}
    await fs.appendFile(path.join(directory,'source/src/engine/compliant-cable.ts'),'\n// Changed after qualification.\n');
    const audit=await auditCableRun(directory);assert.equal(audit.status,'failed');assert.match(audit.issues.join('\n'),/deep-equal/);assert.match(audit.issues.join('\n'),/sha256/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
