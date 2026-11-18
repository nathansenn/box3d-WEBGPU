import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import {create,globals} from 'webgpu';
import {createLinearWaterArrays,stepLinearWaterCpu} from '../src/engine/linear-water.ts';
import {GpuLinearWater} from '../src/webgpu/linear-water.ts';

const output=process.argv[2];if(!output)throw new Error('Pass a new output JSON path.');
const descriptor=fs.openSync(output,'wx');
Object.assign(globalThis,globals);
const gpu=create(['backend=metal']);
// The native Node binding needs its GPU instance strongly reachable while its
// asynchronous event runner is active, including across large typed-array GCs.
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu}});
const adapter=await gpu.requestAdapter();assert.ok(adapter,'A physical Metal GPU is required.');
const device=await adapter.requestDevice(),errors=[];
device.addEventListener('uncapturederror',event=>errors.push(event.error.message));
const tolerances={absolute:5e-5,relative:5e-5};
const evidence={schema:'box3d.gpu-water-qualification/1',startedAt:new Date().toISOString(),backend:'Metal',model:'linear-water-webgpu-f32-v1',tolerances,
  scopes:['Unforced linear water field','Original lagged destination boundary history','Same-adapter exact GPU checkpoint continuation'],
  exclusions:['Interactive automatic forcing, droplets or floaters','Mass conservation of the inherited absorbing boundary/clamp','Nonlinear wetting/drying','CPU/GPU bitwise identity','Engine-wide performance'],cases:[],errors,
  sources:['src/engine/linear-water.ts','src/engine/closed-water.ts','src/engine/contracts.ts','src/webgpu/linear-water.ts','src/webgpu/closed-water-shader.ts','src/webgpu/water-telemetry.ts','src/webgpu/startup-budget.ts','scripts/gpu-water-qualify.mjs'].map(file=>({file,sha256:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')}))};
const save=()=>{fs.ftruncateSync(descriptor,0);fs.writeSync(descriptor,JSON.stringify(evidence,null,2)+'\n',0,'utf8');};
evidence.status='running';save();
let active=null,resumed=null;
try {
  for(const [cols,rows,ticks]of [[3,3,720],[17,5,720],[31,29,720],[64,48,720],[256,192,240],[1024,1024,24]]) {
    const config={cols,rows,dt:1/240,gravity:9.81,meanDepth:1.5,drag:.28,dx:.5,dz:.6};
    const initial=createLinearWaterArrays(config);
    for(let i=0;i<cols*rows;i++){
      const x=i%cols,z=Math.floor(i/cols);
      initial.eta[i]=Math.sin(x*.27)*Math.cos(z*.31)*.4;
      initial.u[i]=Math.sin(i*.13)*.12;initial.v[i]=Math.cos(i*.11)*.09;
      // Exercise both histories, including edge values retained across swaps.
      initial.nextEta[i]=Math.cos(i*.37)*.05;initial.nextU[i]=Math.sin(i*.41)*.02;initial.nextV[i]=Math.cos(i*.23)*.03;
    }
    const cpu=createLinearWaterArrays(config,initial);active=await GpuLinearWater.create(device,config,initial);
    for(let completed=0;completed<ticks;completed+=120)active.step(Math.min(120,ticks-completed));
    const checkpoint=await active.checkpoint();
    const telemetry=await active.telemetry();
    let sumEta=0,sumEta2=0,sumSpeed2=0,maxSpeed2=0,minElevation=Infinity,maxElevation=-Infinity;
    const state=checkpoint.state;
    for(let i=0;i<cols*rows;i++){
      const h=state.eta[i],speed2=state.u[i]**2+state.v[i]**2;
      sumEta+=h;sumEta2+=h*h;sumSpeed2+=speed2;maxSpeed2=Math.max(maxSpeed2,speed2);minElevation=Math.min(minElevation,h);maxElevation=Math.max(maxElevation,h);
    }
    const expectedTelemetry={volumePerturbation:sumEta*config.dx*config.dz,heightRms:Math.sqrt(sumEta2/(cols*rows)),velocityRms:Math.sqrt(sumSpeed2/(cols*rows)),
      maxSpeed:Math.sqrt(maxSpeed2),minElevation,maxElevation,energyProxy:(sumEta2*config.gravity+sumSpeed2)/(cols*rows)};
    for(const [key,value]of Object.entries(expectedTelemetry))assert.ok(Math.abs(telemetry[key]-value)<=.0001+Math.abs(value)*.0001,`${key} GPU reduction exceeds float32 tolerance`);
    assert.equal(telemetry.tick,ticks);assert.equal(telemetry.readbackBytes,32);
    for(let tick=0;tick<ticks;tick++)stepLinearWaterCpu(cpu,config);
    let maxAbsolute=0,maxToleranceFraction=0;
    for(const name of Object.keys(cpu))for(let i=0;i<cpu[name].length;i++){
      const expected=cpu[name][i],actual=checkpoint.state[name][i],error=Math.abs(expected-actual);
      maxAbsolute=Math.max(maxAbsolute,error);maxToleranceFraction=Math.max(maxToleranceFraction,error/(tolerances.absolute+tolerances.relative*Math.abs(expected)));
    }
    assert.ok(maxToleranceFraction<=1,`${cols}×${rows}: error ${maxAbsolute} exceeds the predeclared bound`);
    resumed=await GpuLinearWater.fromCheckpoint(device,checkpoint);active.step(7);resumed.step(7);
    const continuous=await active.checkpoint(),continuation=await resumed.checkpoint();
    assert.deepEqual(continuation,continuous,'Same-adapter checkpoint continuation must preserve exact float32 state.');
    evidence.cases.push({cols,rows,cells:cols*rows,ticks,maxAbsolute,maxToleranceFraction,checkpointContinuation:'exact',stateBytes:cols*rows*24,telemetry,expectedTelemetry});
    save();
    console.log(`${cols}×${rows}, ${ticks} ticks: max error ${maxAbsolute}, checkpoint exact`);
    active.destroy();resumed.destroy();active=resumed=null;
  }
  const config={cols:9,rows:7,dt:1/240,gravity:9.81,meanDepth:1.5,drag:.28,dx:.5,dz:.6};
  active=await GpuLinearWater.create(device,config);
  assert.throws(()=>active.step(121),RangeError);assert.equal(active.tick,0);
  const pending=active.checkpoint();await assert.rejects(active.checkpoint(),/already in flight/);await pending;
  const measuring=active.telemetry();await assert.rejects(active.telemetry(),/already in flight/);await measuring;
  const cancelled=active.checkpoint();active.destroy();await assert.rejects(cancelled);
  assert.throws(()=>active.step(),/destroyed/);active=null;
  await device.queue.onSubmittedWorkDone();assert.deepEqual(errors,[]);
  evidence.status='passed';
}catch(error){evidence.status='failed';evidence.failure=error.stack;process.exitCode=1;console.error(error);}
finally {
  active?.destroy();resumed?.destroy();device.destroy();
  evidence.finishedAt=new Date().toISOString();save();fs.closeSync(descriptor);
}
