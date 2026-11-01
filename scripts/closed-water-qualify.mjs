#!/usr/bin/env node
/** Frozen-source physical-accuracy qualification. Pass a NEW output directory. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import {closedWaterProtocol} from './closed-water-protocol.mjs';
import {fileURLToPath,pathToFileURL} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const output=process.argv[2];if(!output)throw new Error('Pass a new qualification directory.');
const directory=path.resolve(output);await fs.mkdir(directory);
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
const write=async(name,value)=>fs.writeFile(path.join(directory,name),JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const sources=['src/engine/linear-water.ts','src/engine/closed-water.ts','src/engine/contracts.ts','src/webgpu/linear-water.ts','src/webgpu/closed-water-shader.ts','src/webgpu/water-telemetry.ts','src/webgpu/startup-budget.ts',
  'scripts/closed-water-oracle.mjs','scripts/closed-water-protocol.mjs','scripts/closed-water-qualify.mjs','tests/engine/closed-water.test.mjs','package.json','package-lock.json'];
const source=[];
for(const file of sources) {
  const data=await fs.readFile(path.join(root,file)),target=path.join(directory,'source',file);
  await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,data,{flag:'wx'});source.push({file,bytes:data.length,sha256:hash(data)});
}
const protocol=closedWaterProtocol(),base=protocol.cases[2].config;
await write('protocol.json',protocol);
await write('manifest.json',{schema:'box3d.closed-water-source/1',source,sourceSha256:hash(JSON.stringify(source)),protocolSha256:hash(JSON.stringify(protocol)),runtime:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model},startedAt:new Date().toISOString()});
const load=file=>import(pathToFileURL(path.join(directory,'source',file)).href);
const {createClosedWaterArrays,copyClosedWaterArrays,stepClosedWaterCpu}=await load('src/engine/closed-water.ts');
const {createLinearWaterArrays,stepLinearWaterCpu}=await load('src/engine/linear-water.ts');
const {GpuLinearWater}=await load('src/webgpu/linear-water.ts');
const {standingWave,compareFields,integrals,waveErrorScales}=await load('scripts/closed-water-oracle.mjs');
const result={schema:'box3d.closed-water-accuracy/1',status:'running',sourceSha256:hash(JSON.stringify(source)),cases:[],errors:[],convergence:[],startedAt:new Date().toISOString()};
const stateKeys=['eta','u','v','nextEta','nextU','nextV'];
async function retain(name,state) {
  const data=Buffer.concat(stateKeys.map(key=>Buffer.from(state[key].buffer,state[key].byteOffset,state[key].byteLength)));
  const file=name+'.f32';await fs.writeFile(path.join(directory,file),data,{flag:'wx'});
  return {file,bytes:data.length,sha256:hash(data),fields:stateKeys,format:'six contiguous little-endian float32 fields'};
}
let device,water,resumed;
try {
  const {create,globals}=await import('webgpu');Object.assign(globalThis,globals);
  const gpu=create(['backend=metal']);Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu}});
  const adapter=await gpu.requestAdapter();assert.ok(adapter,'Physical Metal adapter required.');
  const info=adapter.info??{};
  result.adapter={backend:'metal',vendor:info.vendor??null,architecture:info.architecture??null,device:info.device??null,description:info.description??null,isFallbackAdapter:info.isFallbackAdapter??adapter.isFallbackAdapter??null};
  assert.equal(result.adapter.isFallbackAdapter,false,'Fallback adapters are not qualification hardware.');
  device=await adapter.requestDevice();device.addEventListener('uncapturederror',event=>result.errors.push(event.error.message));
  // Preserve the measured defect in the inherited model as a distinct experiment.
  const legacyConfig={...base,dt:1/240,cols:32,rows:24,dx:.5,dz:.5},legacy=createLinearWaterArrays(legacyConfig);legacy.eta.fill(.01);
  const legacyInitial=integrals(legacy,legacyConfig);
  for(let tick=0;tick<2400;tick++)stepLinearWaterCpu(legacy,legacyConfig);
  result.inheritedRest={config:legacyConfig,ticks:2400,initial:legacyInitial,final:integrals(legacy,legacyConfig),state:await retain('inherited-rest-final',legacy)};
  for(const spec of protocol.cases) {
    const c=spec.config,count=c.cols*c.rows,eta=new Float32Array(count),u=new Float32Array(count),v=new Float32Array(count);
    if(spec.kind==='rest')eta.fill(.01);
    else if(spec.kind==='mixed') {
      for(let i=0;i<count;i++){eta[i]=.02+.005*Math.sin(i*1.723)+.004*Math.cos(i*.634);u[i]=i%c.cols+1<c.cols?.008*Math.cos(i*.143):0;v[i]=i+c.cols<count?.006*Math.sin(i*.527):0;}
    }else eta.set(standingWave(c,spec.mode,0).eta);
    const initial=createClosedWaterArrays(c,{eta,u,v}),cpu=copyClosedWaterArrays(c,initial),mean=spec.kind==='rest'?.01:.02;
    const start=integrals(initial,c,mean),record={name:spec.name,config:c,ticks:spec.ticks,initial:await retain(spec.name+'-initial',initial),start,samples:[]};
    result.cases.push(record);water=await GpuLinearWater.createClosed(device,c,initial);
    assert.equal(water.backend,protocol.backend);assert.equal(water.capabilities.models[0].calibration,'uncalibrated-physical');
    let completed=0;
    while(completed<spec.ticks) {
      const end=Math.min(spec.ticks,completed+spec.sampleEvery);
      while(completed<end) {const batch=Math.min(120,end-completed);water.step(batch);for(let i=0;i<batch;i++)stepClosedWaterCpu(cpu,c);completed+=batch;}
      const checkpoint=await water.checkpoint(),state=checkpoint.state;
      const actual=integrals(state,c,mean),cpuIntegral=integrals(cpu,c,mean);
      const error=compareFields(state,cpu),massError=Math.abs(actual.volume-start.volume)/start.l1Volume;
      const energyError=Math.abs(actual.modifiedEnergyPerDensity/start.modifiedEnergyPerDensity-1);
      let maxToleranceFraction=0;
      for(const key of stateKeys)for(let i=0;i<count;i++)maxToleranceFraction=Math.max(maxToleranceFraction,Math.abs(state[key][i]-cpu[key][i])/(protocol.thresholds.cpuGpuAbsolute+protocol.thresholds.cpuGpuRelative*Math.abs(cpu[key][i])));
      assert.ok(maxToleranceFraction<=1,`${spec.name} CPU/GPU error ${maxToleranceFraction}`);
      assert.ok(massError<=protocol.thresholds.massRelativeToInitialL1,`${spec.name} mass ${massError}`);assert.equal(actual.maxWall,0);
      if(c.drag===0&&spec.kind!=='rest')assert.ok(energyError<=protocol.thresholds.undampedModifiedEnergyRelative,`${spec.name} modified energy ${energyError}`);
      if(spec.kind==='rest'){assert.deepEqual(state.eta,initial.eta);assert.ok(state.u.every(v=>v===0)&&state.v.every(v=>v===0));}
      const sample={tick:completed,actual,cpuIntegral,error,maxToleranceFraction,massError,energyError:Number.isFinite(energyError)?energyError:null,state:await retain(`${spec.name}-${completed}`,state)};
      record.samples.push(sample);
      if(spec.mode) {
        sample.discrete=compareFields(state,standingWave(c,spec.mode,completed,true));
        sample.cpuDiscrete=compareFields(cpu,standingWave(c,spec.mode,completed,true));
        sample.continuum=compareFields(state,standingWave(c,spec.mode,completed),waveErrorScales(c,spec.mode));
        assert.ok(sample.discrete.maxAbsolute<=protocol.thresholds.discreteMaxAbsolute,`${spec.name} discrete mode ${sample.discrete.maxAbsolute}`);
        assert.ok(sample.cpuDiscrete.maxAbsolute<=protocol.thresholds.discreteMaxAbsolute,`${spec.name} CPU discrete mode ${sample.cpuDiscrete.maxAbsolute}`);
      }
      if(completed===spec.ticks) {
        record.cpuFinal=await retain(spec.name+'-cpu-final',cpu);
        const telemetry=await water.telemetry();record.telemetry=telemetry;
        assert.equal(telemetry.tick,completed);assert.equal(telemetry.velocityTime,(completed-.5)*c.dt);assert.equal(telemetry.readbackBytes,32);
        let maxSpeed=0,sumSpeed2=0,sumEta2=0,min=Infinity,max=-Infinity;
        for(let i=0;i<count;i++) {
          const uc=(state.u[i]+(i%c.cols?state.u[i-1]:0))*.5,vc=(state.v[i]+(i>=c.cols?state.v[i-c.cols]:0))*.5,speed2=uc*uc+vc*vc;
          maxSpeed=Math.max(maxSpeed,Math.sqrt(speed2));sumSpeed2+=speed2;sumEta2+=state.eta[i]**2;min=Math.min(min,state.eta[i]);max=Math.max(max,state.eta[i]);
        }
        const expected={maxSpeed,velocityRms:Math.sqrt(sumSpeed2/count),heightRms:Math.sqrt(sumEta2/count),volumePerturbation:actual.volume,minElevation:min,maxElevation:max,energyProxy:(sumEta2*c.gravity+sumSpeed2)/count};
        for(const [key,value]of Object.entries(expected))assert.ok(Math.abs(telemetry[key]-value)<=protocol.thresholds.telemetryAbsolute+protocol.thresholds.telemetryRelative*Math.abs(value),`${spec.name} telemetry ${key}`);
        record.expectedTelemetry=expected;
        resumed=await GpuLinearWater.fromCheckpoint(device,checkpoint);water.step(7);resumed.step(7);
        assert.deepEqual(await water.checkpoint(),await resumed.checkpoint());record.checkpointContinuation='exact';resumed.destroy();resumed=null;
      }
    }
    water.destroy();water=null;await write(spec.name+'.json',record);
    console.log(`${spec.name}: ${spec.ticks} ticks, mass ${record.samples.at(-1).massError}, max GPU/reference ${record.samples.at(-1).error.maxAbsolute}`);
  }
  for(const drag of [0,.28]) {
    const values=[1,2,4,8].map(scale=>result.cases.find(c=>c.name===`convergence-${drag}-${scale}`).samples.at(-1).continuum.normalizedRms);
    const ratios=values.slice(1).map((value,i)=>values[i]/value);
    assert.ok(values.at(-1)<=protocol.thresholds.continuumFineNormalizedRms,`Continuum error ${drag}`);
    assert.ok(ratios.every(r=>r>=3.5&&r<=4.5),`Convergence ratios ${drag}: ${ratios}`);
    result.convergence.push({drag,normalizedRms:values,ratios});
  }
  await device.queue.onSubmittedWorkDone();assert.deepEqual(result.errors,[]);result.status='passed';
}catch(error){result.status='failed';result.failure=error.stack;process.exitCode=1;console.error(error);}
finally {
  water?.destroy();resumed?.destroy();device?.destroy();result.finishedAt=new Date().toISOString();await write('result.json',result);
}
