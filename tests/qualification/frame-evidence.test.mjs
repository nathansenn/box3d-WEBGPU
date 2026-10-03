import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {evaluateFrames,auditFrames} from '../../scripts/frame-qualify.mjs';

const run=path.resolve(process.env.FRAME_QUALIFICATION_RUN??'benchmarks/results/engine-100x/runs/frame-accuracy-20260911-04');
test('frame acceptance rejects incorrect compliance, reactions, phases, convergence and model-domain claims',async()=>{
  const result=JSON.parse(await fs.readFile(path.join(run,'result.json'),'utf8'));assert.equal(evaluateFrames(result.records).status,'passed');
  for(const [kind,mutate] of [['static',r=>r.staticSolution.displacements[7]+=.001],['gravity',r=>r.staticSolution.supportReactions[1]+=1],['gravity',r=>r.staticSolution.elementEndForces[1]+=1],['oscillator',r=>r.stats.maxDiscretePositionError=.01],['bending',r=>r.stats.maxContinuumError=.2],['spatial',r=>r.stats.maxDenseVelocityError=.1],['spatial',r=>r.stats.maxLinearImpulseDefect=.1],['spatial',r=>r.stats.maxEnergyDefect=NaN],['underconverged',r=>r.stats.unconvergedSolves=0],['mechanism',r=>r.staticSolution.converged=true],['domain',r=>r.staticSolution.linearKinematicsExceeded=false]]){
    const records=structuredClone(result.records);mutate(records.find(r=>r.spec.kind===kind));assert.equal(evaluateFrames(records).status,'failed',kind);
  }
});
async function fixture(action){
  const out=await fs.mkdtemp(path.join(os.tmpdir(),'box3d-frame-audit-'));
  try{const entries=await fs.readdir(run,{withFileTypes:true});for(const entry of entries)if(entry.isFile()&&entry.name.endsWith('.json'))await fs.copyFile(path.join(run,entry.name),path.join(out,entry.name));
    const manifest=JSON.parse(await fs.readFile(path.join(run,'manifest.json'),'utf8'));for(const entry of manifest.source.files){const target=path.join(out,'source',entry.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(run,'source',entry.path),target);}await action(out);
  }finally{await fs.rm(out,{recursive:true,force:true});}
}
test('frame audit rejects changed solver bytes before importing them',()=>fixture(async out=>{
  await fs.appendFile(path.join(out,'source/src/engine/frame-runtime.ts'),'\nthrow new Error("Changed source must never be imported.");\n');const report=await auditFrames(out);assert.equal(report.status,'failed');assert.match(report.issues.join('\n'),/sha256/);
}));
test('frame audit replays full intermediate states even when aggregate metrics are unchanged',()=>fixture(async out=>{
  const result=JSON.parse(await fs.readFile(path.join(out,'result.json'),'utf8')),record=result.records.find(r=>r.spec.kind==='oscillator');record.samples[2].displacements[6]+=.001;
  await fs.writeFile(path.join(out,record.spec.id+'.json'),JSON.stringify(record));await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result));const report=await auditFrames(out);assert.equal(report.status,'failed');assert.match(report.issues.join('\n'),/replay differs/);
}));
