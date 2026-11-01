#!/usr/bin/env node
/** Read-only audit: rehash retained source/state, replay CPU, recompute modal/integral gates. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {closedWaterProtocol} from './closed-water-protocol.mjs';
import {standingWave,compareFields,integrals,waveErrorScales} from './closed-water-oracle.mjs';

const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const keys=['eta','u','v','nextEta','nextU','nextV'];
const json=async(file)=>JSON.parse(await fs.readFile(file,'utf8'));
export async function readClosedWaterState(directory,record,count) {
  assert.ok(record&&record.file===path.basename(record.file)&&record.file.endsWith('.f32'),'Unsafe state path');
  assert.deepEqual(record.fields,keys);assert.equal(record.format,'six contiguous little-endian float32 fields');
  assert.equal(record.bytes,count*24);assert.ok(count>=9&&count<=1048576);
  const bytes=await fs.readFile(path.join(directory,record.file));assert.equal(bytes.length,count*24);assert.equal(hash(bytes),record.sha256,'Raw state hash mismatch');
  const copy=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),state={};
  for(let i=0;i<keys.length;i++){state[keys[i]]=new Float32Array(copy,i*count*4,count);assert.ok(state[keys[i]].every(Number.isFinite),'Nonfinite retained state');}
  return state;
}

export async function auditClosedWaterRun(directory) {
  const report={schema:'box3d.closed-water-integrity/1',status:'failed',issues:[],cases:0,samples:0,maxMassError:0,maxEnergyError:0,maxCpuGpuError:0,maxDiscreteError:0};
  try {
    const [manifest,p,result]=await Promise.all(['manifest.json','protocol.json','result.json'].map(file=>json(path.join(directory,file))));
    assert.deepEqual(p,closedWaterProtocol(),'Predeclared protocol changed');
    assert.equal(result.schema,'box3d.closed-water-accuracy/1');assert.equal(result.status,'passed');assert.deepEqual(result.errors,[]);
    assert.equal(manifest.protocolSha256,hash(JSON.stringify(p)));assert.equal(manifest.sourceSha256,hash(JSON.stringify(manifest.source)));assert.equal(result.sourceSha256,manifest.sourceSha256);
    assert.equal(result.adapter.backend,'metal');assert.equal(result.adapter.isFallbackAdapter,false);
    for(const source of manifest.source) {
      assert.ok(!path.isAbsolute(source.file)&&!source.file.split('/').includes('..'));
      const data=await fs.readFile(path.join(directory,'source',source.file));assert.equal(data.length,source.bytes);assert.equal(hash(data),source.sha256,'Retained source mismatch');
    }
    // Execute only the hash-verified retained CPU reference. Modal and integral
    // oracles above are independent of that reference and of the GPU stencil.
    const {stepClosedWaterCpu,copyClosedWaterArrays}=await import(pathToFileURL(path.resolve(directory,'source/src/engine/closed-water.ts')).href);
    assert.equal(result.cases.length,p.cases.length);const convergence=[];
    for(let caseId=0;caseId<p.cases.length;caseId++) {
      const spec=p.cases[caseId],r=result.cases[caseId],c=spec.config,count=c.cols*c.rows,mean=spec.kind==='rest'?.01:.02;
      assert.equal(r.name,spec.name);assert.deepEqual(r.config,c);assert.equal(r.ticks,spec.ticks);assert.equal(r.checkpointContinuation,'exact');
      assert.deepEqual(await json(path.join(directory,spec.name+'.json')),r,'Per-case report differs from aggregate');
      const initial=await readClosedWaterState(directory,r.initial,count),cpu=copyClosedWaterArrays(c,initial),start=integrals(initial,c,mean);
      assert.deepEqual(r.start,start);assert.equal(r.samples.length,Math.ceil(spec.ticks/spec.sampleEvery));let tick=0;
      for(const sample of r.samples) {
        assert.equal(sample.tick,Math.min(spec.ticks,tick+spec.sampleEvery));
        while(tick<sample.tick){stepClosedWaterCpu(cpu,c);tick++;}
        const actual=await readClosedWaterState(directory,sample.state,count),sums=integrals(actual,c,mean),error=compareFields(actual,cpu);
        assert.deepEqual(sample.actual,sums);assert.deepEqual(sample.cpuIntegral,integrals(cpu,c,mean));assert.deepEqual(sample.error,error);
        let tolerance=0;
        for(const key of keys)for(let i=0;i<count;i++)tolerance=Math.max(tolerance,Math.abs(actual[key][i]-cpu[key][i])/(p.thresholds.cpuGpuAbsolute+p.thresholds.cpuGpuRelative*Math.abs(cpu[key][i])));
        assert.equal(sample.maxToleranceFraction,tolerance);assert.ok(tolerance<=1);
        const mass=Math.abs(sums.volume-start.volume)/start.l1Volume,energy=Math.abs(sums.modifiedEnergyPerDensity/start.modifiedEnergyPerDensity-1);
        assert.equal(sample.massError,mass);assert.equal(sample.energyError,Number.isFinite(energy)?energy:null);assert.ok(mass<=p.thresholds.massRelativeToInitialL1);assert.equal(sums.maxWall,0);
        if(c.drag===0&&spec.kind!=='rest'){assert.ok(energy<=p.thresholds.undampedModifiedEnergyRelative);report.maxEnergyError=Math.max(report.maxEnergyError,energy);}
        if(spec.kind==='rest'){assert.deepEqual(actual.eta,initial.eta);assert.ok(actual.u.every(v=>v===0)&&actual.v.every(v=>v===0));}
        if(spec.mode) {
          const discrete=compareFields(actual,standingWave(c,spec.mode,tick,true)),cpuDiscrete=compareFields(cpu,standingWave(c,spec.mode,tick,true));
          const continuum=compareFields(actual,standingWave(c,spec.mode,tick),waveErrorScales(c,spec.mode));
          assert.deepEqual(sample.discrete,discrete);assert.deepEqual(sample.cpuDiscrete,cpuDiscrete);assert.deepEqual(sample.continuum,continuum);
          assert.ok(discrete.maxAbsolute<=p.thresholds.discreteMaxAbsolute&&cpuDiscrete.maxAbsolute<=p.thresholds.discreteMaxAbsolute);
          report.maxDiscreteError=Math.max(report.maxDiscreteError,discrete.maxAbsolute);
        }
        report.maxMassError=Math.max(report.maxMassError,mass);report.maxCpuGpuError=Math.max(report.maxCpuGpuError,error.maxAbsolute);report.samples++;
      }
      assert.deepEqual(await readClosedWaterState(directory,r.cpuFinal,count),cpu,'Retained CPU final differs from replay');report.cases++;
    }
    for(const drag of [0,.28]) {
      const values=[1,2,4,8].map(scale=>result.cases.find(c=>c.name===`convergence-${drag}-${scale}`).samples.at(-1).continuum.normalizedRms),ratios=values.slice(1).map((v,i)=>values[i]/v);
      assert.ok(values.at(-1)<=p.thresholds.continuumFineNormalizedRms);assert.ok(ratios.every(r=>r>=p.thresholds.convergenceRatio[0]&&r<=p.thresholds.convergenceRatio[1]));
      convergence.push({drag,normalizedRms:values,ratios});
    }
    assert.deepEqual(result.convergence,convergence);
    report.status='passed';report.convergence=convergence;report.sourceSha256=manifest.sourceSha256;report.protocolSha256=manifest.protocolSha256;report.resultSha256=hash(await fs.readFile(path.join(directory,'result.json')));
    report.scope='Every retained GPU sample rehashed; CPU samples replayed; mass, walls, undamped modified energy, discrete modes and dimensionless continuum convergence recomputed. GPU checkpoint and telemetry assertions remain evidence from the frozen GPU harness.';
  }catch(error){report.issues.push(error.stack??String(error));}
  return report;
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  if(!process.argv[2])throw new Error('Pass the retained run directory, and optionally a new receipt path.');
  const report=await auditClosedWaterRun(path.resolve(process.argv[2]));
  if(process.argv[3])await fs.writeFile(path.resolve(process.argv[3]),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(report,null,2));if(report.status!=='passed')process.exitCode=1;
}
