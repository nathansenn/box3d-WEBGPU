import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {protocol,gate,verifyWaterRun} from '../../scripts/gpu-water-benchmark.mjs';
import {hashValue,inventory,writeJsonExclusive} from '../../scripts/engine-baseline.mjs';
import {gpuControlExpected,retainBenchmarkState,readBenchmarkState,verifyClosedBenchmarkFields} from '../../scripts/closed-water-benchmark-support.mjs';
const fixture=(model)=>{
  const p=protocol({model,trials:4,grids:[64],frames:8,warmup:1}),samples=[];
  for(let pair=0;pair<4;pair++)for(const side of ['baseline','candidate'])samples.push({pair,side,pid:100+samples.length,status:'passed',protocolSha256:hashValue(p),sourceSha256:'a'.repeat(64),runtimeSha256:'b'.repeat(64),adapter:{backend:'metal',isFallbackAdapter:false},errors:[],controls:Array(16).fill(1),controlValues:Array(16).fill(42),cases:[{...p.gridCases[0],cells:4096,ticks:36,displayQuality:p.quality,frameMs:Array(8).fill(side==='baseline'?2:1),maxToleranceFraction:0,stateReadbackBytesDuringTimedFrames:0,stateUploadBytesPerFrame:side==='baseline'?49152:0}]});
  if(model==='closed')for(const s of samples){
    s.schema='box3d.gpu-water-frame-sample/2';s.accuracySha256='c'.repeat(64);s.gpuControls=Array(16).fill(1);s.gpuControlValues=[gpuControlExpected(),gpuControlExpected()];
    s.gpuControlStats={dispatchesPerSample:128,totalDispatches:2560};
    const c=s.cases[0];c.backend=p.backendIds[s.side];c.velocityLayout='east-north-faces';c.physical={massError:0,maxWallVelocity:0};
    c.initialState=c.finalState={file:`states/${'d'.repeat(64)}.f32`,sha256:'d'.repeat(64),bytes:4096*24};
  }
  return {p,samples};
};
test('paired water frame gate accepts a controlled gain and retains small-grid losses',()=>{
  const {p,samples}=fixture();let result=gate(samples,p);assert.equal(result.verdict,'measured');assert.deepEqual(result.qualifiedWinningGrids,[64]);
  for(const s of samples.filter(s=>s.side==='candidate'))s.cases[0].frameMs.fill(3);
  result=gate(samples,p);assert.equal(result.verdict,'measured');assert.deepEqual(result.qualifiedWinningGrids,[]);assert.equal(result.cases[0].noRegression,false);
});
test('control drift rejects speed claims despite faster water frames',()=>{
  const {p,samples}=fixture();for(const s of samples.filter(s=>s.side==='candidate'))s.controls.fill(3);
  const result=gate(samples,p);assert.equal(result.verdict,'inconclusive');assert.deepEqual(result.qualifiedWinningGrids,[]);
});
test('missing evidence, changed quality, shared processes and numerical drift cannot qualify',()=>{
  for(const mutate of [s=>s.pop(),s=>s[0]=null,s=>s[0].pid=s[1].pid,s=>s[0].cases[0].frameMs.pop(),s=>s[0].cases[0].frameMs[0]=NaN,s=>s[0].cases[0].maxToleranceFraction=1.1,s=>s[0].cases[0].displayQuality={sampleCount:4},s=>s[0].runtimeSha256='c'.repeat(64),s=>s[0].controls=[],s=>delete s[0].controlValues,s=>s[0].controlValues[0]=0,s=>s[0].adapter={backend:'null'},s=>s[0].cases[0].ticks=99,s=>s[0].cases[0].config={dt:1/30},s=>s[0].cases[0].renderStride=2,s=>s[1].cases[0].stateReadbackBytesDuringTimedFrames=1024]) {
    const {p,samples}=fixture();mutate(samples);assert.equal(gate(samples,p).verdict,'incomparable');
  }
});
test('water experiment rejects unbounded or duplicate workloads before execution',()=>{
  assert.equal(protocol().grids.at(-1),1024);
  for(const options of [{model:'unknown'},{trials:3},{trials:5},{trials:14},{frames:121},{warmup:0},{ticksPerFrame:9},{grids:[65]},{grids:[64,64]},{trials:12,frames:120,warmup:32,ticksPerFrame:8}])assert.throws(()=>protocol(options),RangeError);
});

test('closed-water timings require matching physical identity, zero wall flux and stable GPU controls',()=>{
  const valid=fixture('closed');assert.equal(gate(valid.samples,valid.p).verdict,'measured');
  const drift=fixture('closed');for(const s of drift.samples.filter(s=>s.side==='candidate'))s.gpuControls.fill(2);
  const rejected=gate(drift.samples,drift.p);assert.equal(rejected.verdict,'inconclusive');assert.equal(rejected.cpuControlQualified,true);assert.equal(rejected.gpuControlQualified,false);assert.deepEqual(rejected.qualifiedWinningGrids,[]);
  for(const mutate of [s=>delete s[0].gpuControls,s=>s[0].gpuControls[0]=NaN,s=>s[0].gpuControlValues=[],s=>s[0].gpuControlValues[0][0]=0,s=>delete s[0].gpuControlStats,s=>s[0].gpuControlStats.dispatchesPerSample=4,s=>s[0].gpuControlStats.totalDispatches--,s=>s[0].accuracySha256='f'.repeat(64),s=>s[0].cases[0].backend='linear-water-webgpu-f32-v1',s=>s[0].cases[0].velocityLayout='cell-centered',s=>s[0].cases[0].physical.massError=.1,s=>s[0].cases[0].physical.maxWallVelocity=.01,s=>s[0].cases[0].initialState.bytes=0,s=>s[0].cases[0].finalState.file='../field.f32']){
    const {p,samples}=fixture('closed');mutate(samples);assert.equal(gate(samples,p).verdict,'incomparable');
  }
});

test('closed-water timings cannot borrow physical acceptance from a different solver source',async()=>{
  const directory=path.resolve('benchmarks/results/engine-100x/runs/closed-water-render-crossover-20260910-02');
  const manifest=JSON.parse(await fs.readFile(path.join(directory,'manifest.json'),'utf8'));
  const link=JSON.parse(await fs.readFile(path.join(directory,'accuracy-link.json'),'utf8'));
  const p=protocol({model:'closed'}),source=structuredClone(manifest.source);
  const entry=source.files.find(f=>f.path==='src/engine/closed-water.ts'),qualified=link.core.find(f=>f.file===entry.path);
  entry.sha256='0'.repeat(64);
  await assert.rejects(verifyClosedBenchmarkFields(directory,p,[],source,manifest.accuracySha256),{code:'ERR_ASSERTION',actual:entry.sha256,expected:qualified.sha256});
});

test('closed model protocol preserves the inherited frozen protocol and uses physical cell-centre spacing',async()=>{
  const old=JSON.parse(await fs.readFile('benchmarks/results/engine-100x/runs/water-render-crossover-20260910-01/protocol.json','utf8'));
  assert.deepEqual(protocol(),old);
  const closed=protocol({model:'closed'});assert.equal(closed.schema,'box3d.gpu-water-benchmark-protocol/3');
  assert.equal(protocol({model:'closed',gpuControlDispatches:4}).schema,'box3d.gpu-water-benchmark-protocol/2');
  assert.throws(()=>protocol({model:'closed',gpuControlDispatches:100000}),RangeError);
  assert.equal(closed.gridCases.at(-1).config.dx,40/1024);assert.equal(closed.physicalEnvelope.requireMatchingAuditedCore,true);
});

test('retained benchmark fields deduplicate by content and reject modified data',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'box3d-water-state-'));
  try {
    await fs.mkdir(path.join(directory,'states'));
    const state=Object.fromEntries(['eta','u','v','nextEta','nextU','nextV'].map((f,i)=>[f,new Float32Array(9).fill(i*.1)]));
    const first=await retainBenchmarkState(directory,state),second=await retainBenchmarkState(directory,state);assert.deepEqual(first,second);
    assert.equal((await fs.readdir(path.join(directory,'states'))).length,1);assert.deepEqual(await readBenchmarkState(directory,first,9),state);
    const file=path.join(directory,first.file),bytes=await fs.readFile(file);bytes[0]^=1;await fs.writeFile(file,bytes);
    await assert.rejects(readBenchmarkState(directory,first,9),/hash mismatch/);await assert.rejects(retainBenchmarkState(directory,state),/changed/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
test('saved water comparisons rehash retained source, raw results, protocol and execution order',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'box3d-water-gate-'));
  try {
    const {p,samples}=fixture();await fs.mkdir(path.join(directory,'source'));
    await fs.writeFile(path.join(directory,'source/reference.ts'),'export const reference = 1;\n');
    const source=await inventory(path.join(directory,'source'),['.'],1024),runtime={node:'fixture'},runtimeSha256=hashValue(runtime),execution=[],ordered=[];
    for(let pair=0;pair<p.trials;pair++)for(const side of pair%2?['candidate','baseline']:['baseline','candidate']) {
      const sample=samples.find(s=>s.pair===pair&&s.side===side),name=`${String(pair).padStart(2,'0')}-${side}`;
      sample.sourceSha256=source.sha256;sample.runtimeSha256=runtimeSha256;
      await writeJsonExclusive(path.join(directory,name+'.json'),sample);
      await writeJsonExclusive(path.join(directory,name+'-task.json'),{pair,side,protocol:p,sourceSha256:source.sha256,runtimeSha256});
      ordered.push(sample);execution.push({pair,side,pid:sample.pid,output:name+'.json'});
    }
    const result={schema:'box3d.gpu-water-frame-benchmark/1',protocol:p,runtime,sourceSha256:source.sha256,execution,samples:ordered};
    await writeJsonExclusive(path.join(directory,'manifest.json'),{source,runtime,runtimeSha256,protocolSha256:hashValue(p)});
    await writeJsonExclusive(path.join(directory,'protocol.json'),p);await writeJsonExclusive(path.join(directory,'result.json'),result);
    assert.equal((await verifyWaterRun(directory)).verdict,'measured');
    const rawPath=path.join(directory,'00-baseline.json'),original=await fs.readFile(rawPath);
    await fs.writeFile(rawPath,JSON.stringify({...ordered[0],pid:999}));assert.equal((await verifyWaterRun(directory)).verdict,'incomparable');await fs.writeFile(rawPath,original);
    await fs.writeFile(path.join(directory,'source/reference.ts'),'changed');assert.equal((await verifyWaterRun(directory)).verdict,'incomparable');
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});
