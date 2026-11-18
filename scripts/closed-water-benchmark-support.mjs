import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {hashFile,hashValue,writeJsonExclusive} from './engine-baseline.mjs';
import {integrals} from './closed-water-oracle.mjs';

export const closedCoreFiles=['src/engine/linear-water.ts','src/engine/closed-water.ts','src/webgpu/linear-water.ts','src/webgpu/closed-water-shader.ts'];
const fields=['eta','u','v','nextEta','nextU','nextV'];
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');

export function closedBenchmarkInitial(c,create) {
  const eta=new Float32Array(c.cols*c.rows);
  for(let z=0;z<c.rows;z++)for(let x=0;x<c.cols;x++) {
    const wx=(x+.5)*c.dx-20,wz=(z+.5)*c.dz-12;
    eta[z*c.cols+x]=.05*Math.exp(-((wx+7)**2+wz*wz)/5)-.025*Math.exp(-((wx-5)**2+(wz-3)**2)/8);
  }
  return create(c,{eta});
}

export async function retainBenchmarkState(directory,state) {
  const bytes=Buffer.concat(fields.map(f=>Buffer.from(state[f].buffer,state[f].byteOffset,state[f].byteLength))),sha256=hash(bytes),file=`states/${sha256}.f32`;
  try {await fs.writeFile(path.join(directory,file),bytes,{flag:'wx'});}
  catch(error){if(error.code!=='EEXIST')throw error;assert.equal(await hashFile(path.join(directory,file)),sha256,'Existing retained state changed');}
  return {file,sha256,bytes:bytes.length,fields,format:'six contiguous little-endian float32 fields'};
}

export async function readBenchmarkState(directory,record,count) {
  assert.ok(record&&/^[a-f0-9]{64}$/.test(record.sha256));assert.equal(record.file,`states/${record.sha256}.f32`);assert.deepEqual(record.fields,fields);
  assert.equal(record.format,'six contiguous little-endian float32 fields');assert.equal(record.bytes,count*24);
  const bytes=await fs.readFile(path.join(directory,record.file));assert.equal(bytes.length,count*24);assert.equal(hash(bytes),record.sha256,'Retained field hash mismatch');
  const buffer=bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),state={};
  for(let i=0;i<6;i++){state[fields[i]]=new Float32Array(buffer,i*count*4,count);assert.ok(state[fields[i]].every(Number.isFinite));}
  return state;
}

export function closedBenchmarkMetrics(state,initial,config) {
  const start=integrals(initial,config),end=integrals(state,config);
  return {initialVolume:start.volume,initialL1Volume:start.l1Volume,finalVolume:end.volume,massError:Math.abs(end.volume-start.volume)/start.l1Volume,maxWallVelocity:end.maxWall};
}

/** The timing run must use the exact core source from an independently audited physics run. */
export async function qualifyBenchmarkCore(directory,sourceRoot,accuracyRun) {
  const {auditClosedWaterRun}=await import('./closed-water-check.mjs');
  const run=await fs.realpath(accuracyRun),audit=await auditClosedWaterRun(run);assert.equal(audit.status,'passed',audit.issues?.join('\n'));
  const manifest=JSON.parse(await fs.readFile(path.join(run,'manifest.json'),'utf8')),core=[];
  for(const file of closedCoreFiles) {
    const qualified=manifest.source.find(f=>f.file===file);assert.ok(qualified,`Missing physical source: ${file}`);
    assert.equal(await hashFile(path.join(sourceRoot,file)),qualified.sha256,`Physics source changed since accuracy qualification: ${file}`);core.push({file,sha256:qualified.sha256});
  }
  const receipt={schema:'box3d.closed-water-benchmark-physics/1',relativeDirectory:path.relative(directory,run),core,audit};
  await writeJsonExclusive(path.join(directory,'accuracy-link.json'),receipt);return hashValue(receipt);
}

export async function verifyClosedBenchmarkFields(directory,p,samples,source,accuracySha256) {
  const link=JSON.parse(await fs.readFile(path.join(directory,'accuracy-link.json'),'utf8'));
  assert.equal(hashValue(link),accuracySha256);assert.equal(link.schema,'box3d.closed-water-benchmark-physics/1');assert.equal(link.audit.status,'passed');
  const accuracyRun=path.resolve(directory,link.relativeDirectory);
  const {auditClosedWaterRun}=await import('./closed-water-check.mjs');
  assert.deepEqual(await auditClosedWaterRun(accuracyRun),link.audit,'Linked physical evidence changed');
  assert.deepEqual(link.core.map(f=>f.file),closedCoreFiles);
  for(const entry of link.core){assert.equal(source.files.find(f=>f.path===entry.file)?.sha256,entry.sha256);assert.equal(await hashFile(path.join(directory,'source',entry.file)),entry.sha256);}
  const cpu=await import(pathToFileURL(path.join(directory,'source/src/engine/closed-water.ts')).href),expected=new Map(),states=new Map();
  const load=async(record,count)=>{
    if(!states.has(record.sha256))states.set(record.sha256,await readBenchmarkState(directory,record,count));
    // Validate a descriptor even when another sample already used the same data.
    assert.equal(record.file,`states/${record.sha256}.f32`);assert.equal(record.bytes,count*24);assert.deepEqual(record.fields,fields);assert.equal(record.format,'six contiguous little-endian float32 fields');return states.get(record.sha256);
  };
  let cases=0,maxMassError=0,maxComponentError=0;
  for(const sample of samples)for(const record of sample.cases) {
    const c=record.config,count=c.cols*c.rows;
    if(!expected.has(record.grid)) {
      const initial=closedBenchmarkInitial(c,cpu.createClosedWaterArrays),final=cpu.copyClosedWaterArrays(c,initial);
      for(let i=0;i<record.ticks;i++)cpu.stepClosedWaterCpu(final,c);
      expected.set(record.grid,{initial,final});
    }
    const reference=expected.get(record.grid),initial=await load(record.initialState,count),actual=await load(record.finalState,count);
    assert.deepEqual(initial,reference.initial,'Initial physical recipe changed');
    const metrics=closedBenchmarkMetrics(actual,initial,c);assert.deepEqual(record.physical,metrics);
    assert.ok(metrics.massError<=p.physicalEnvelope.massRelativeToInitialL1&&metrics.maxWallVelocity===0);
    let maxAbsolute=0,maxToleranceFraction=0,sumSquared=0,massDifference=0;
    for(const f of fields)for(let i=0;i<count;i++) {
      const error=Math.abs(actual[f][i]-reference.final[f][i]);maxAbsolute=Math.max(maxAbsolute,error);
      maxToleranceFraction=Math.max(maxToleranceFraction,error/(p.qualityEnvelope.absolute+p.qualityEnvelope.relative*Math.abs(reference.final[f][i])));
      if(f==='eta'){sumSquared+=error*error;massDifference+=(actual.eta[i]-reference.final.eta[i])*c.dx*c.dz;}
    }
    assert.equal(record.maxAbsolute,maxAbsolute);assert.equal(record.maxToleranceFraction,maxToleranceFraction);assert.ok(maxToleranceFraction<=1);
    assert.equal(record.elevationRmsDifference,Math.sqrt(sumSquared/count));assert.equal(record.volumePerturbationDifference,massDifference);
    maxMassError=Math.max(maxMassError,metrics.massError);maxComponentError=Math.max(maxComponentError,maxAbsolute);cases++;
  }
  return {status:'passed',cases,distinctStateFiles:states.size,maxMassError,maxComponentError,accuracyResultSha256:link.audit.resultSha256};
}

/** Unchanged completed GPU workload, outside timed water frames. */
export function gpuControlExpected() {
  return Array.from({length:16},(_,id)=>{let v=id^42;for(let i=0;i<256;i++)v=Math.imul(v^(v>>>13)^i,1597334677);return v>>>0;});
}

export async function createGpuControl(device,dispatchesPerSample=128) {
  assert.ok([4,128].includes(dispatchesPerSample),'Unsupported GPU control workload');
  const code=`@group(0) @binding(0) var<storage,read_write> values:array<u32>;
  @compute @workgroup_size(64) fn main(@builtin(global_invocation_id) id:vec3<u32>){
    var value=id.x^42u;for(var i=0u;i<256u;i++){value=(value^(value>>13u)^i)*1597334677u;}values[id.x]=value;
  }`;
  const buffer=device.createBuffer({size:65536*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_SRC});
  const staging=device.createBuffer({size:16*4,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
  let pipeline,group,totalDispatches=0;
  try {
    const module=device.createShaderModule({code}),info=await module.getCompilationInfo();assert.deepEqual(info.messages.filter(m=>m.type==='error'),[]);
    pipeline=await device.createComputePipelineAsync({layout:'auto',compute:{module,entryPoint:'main'}});
    group=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer}}]});
  }catch(error){buffer.destroy();staging.destroy();throw error;}
  return {
    get stats(){return {dispatchesPerSample,totalDispatches};},
    async sample(){const start=performance.now(),encoder=device.createCommandEncoder(),pass=encoder.beginComputePass();pass.setPipeline(pipeline);pass.setBindGroup(0,group);for(let i=0;i<dispatchesPerSample;i++){pass.dispatchWorkgroups(1024);totalDispatches++;}pass.end();device.queue.submit([encoder.finish()]);await device.queue.onSubmittedWorkDone();return performance.now()-start;},
    async verify(){const encoder=device.createCommandEncoder();encoder.copyBufferToBuffer(buffer,0,staging,0,64);device.queue.submit([encoder.finish()]);await staging.mapAsync(1);try{const actual=Array.from(new Uint32Array(staging.getMappedRange()));assert.deepEqual(actual,gpuControlExpected());return actual;}finally{staging.unmap();}},
    destroy(){buffer.destroy();staging.destroy();}
  };
}
