// The Canopy load study on the SI cloth (src/studio/canopy-si.ts, physics.ts STUDIO_CANOPY_SI_BACKEND). Short runs, SI values.
// Run by `npm run test:studio`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FailureSimulation,STUDIO_CANOPY_SI_BACKEND} from '../../src/studio/physics.ts';
import {CANOPY_SNOW_PER_LOAD} from '../../src/studio/canopy-si.ts';
import {assertExactResume} from './fixtures/studio-resume.mjs';
import {createStudioRuntime} from '../../src/engine/studio-runtime.ts';

const make=(target,strength=1,wind=0)=>{const sim=new FailureSimulation('canopy',{},STUDIO_CANOPY_SI_BACKEND);sim.targetLoad=target;sim.strength=strength;sim.wind=wind;return sim;};
const close=(a,b,rel,label)=>assert.ok(Math.abs(a-b)<=rel*Math.abs(b),`${label}: ${a} vs ${b}`);

test('form-found canopy: the corner posts carry its weight; under 2 kPa of snow they carry weight plus snow; it sags without tearing',()=>{
  const sim=make(.2),c=sim.canopySI,weight=c.cloth.masses.reduce((a,b)=>a+b,0)*9.81;
  // The static form finding converges to the cloth's residual tolerance, 1e-6 of the largest nodal force (the edge cables carry
  // tens of kN): reaction = weight to 2e-5 (measured 5.7e-6).
  close(c.supportReaction(),weight,2e-5,'weight');
  for(let i=0;i<120*3;i++)sim.step();
  const snow=.2*CANOPY_SNOW_PER_LOAD*c.area.reduce((a,b)=>a+b,0),r=sim.response();
  console.log(`# 2 kPa: reaction ${(c.supportReaction()/1e3).toFixed(3)} kN for weight ${(weight/1e3).toFixed(3)} + snow ${(snow/1e3).toFixed(3)} kN; sag ${(r.deflection*1e3).toFixed(0)} mm; utilisation ${sim.maxStrain.toFixed(3)}; edge cable ${(Math.max(...c.cloth.cableTensions())/1e3).toFixed(1)} kN`);
  // 0.5%: the drag-damped approach to rest after the ramp (dynamic reactions, 1 s after the load stopped rising).
  close(c.supportReaction(),weight+snow,.005,'reaction');
  assert.ok(r.deflection>.3&&r.deflection<1.5,`sag ${r.deflection} m`);assert.equal(r.broken,0);assert.ok(sim.maxStrain<.2);
});

test('overload at half strength: yarns reach their strength, triangles tear, the drawn sheet breaks and events record it',()=>{
  const sim=make(4.5,.5,.25);
  for(let i=0;i<Math.round(120*4.2)&&sim.canopySI.cloth.tornCount===0;i++)sim.step();
  const c=sim.canopySI,load=sim.load*CANOPY_SNOW_PER_LOAD/1e3;
  console.log(`# first tear at ${sim.time.toFixed(2)} s under ${load.toFixed(1)} kPa (strength ${(c.strengthWarp/1e3).toFixed(1)} kN/m warp)`);
  assert.ok(c.cloth.tornCount>0,'it tore');assert.ok(sim.events.some(e=>e.type==='break'));
  // The fabric at library strength carries 50 kPa at about 0.94 utilisation; at half strength it tears near 20 kPa.
  assert.ok(load>10&&load<35,`tear load ${load} kPa`);
  for(let i=0;i<12;i++)sim.step();
  assert.ok(sim.response().broken>0&&sim.response().phase!=='Ready');
});

test('the Studio runtime runs the SI canopy, and its checkpoint resumes the cloth bit for bit, tears included',async()=>{
  const runtime=createStudioRuntime({study:'canopy',backend:STUDIO_CANOPY_SI_BACKEND,controls:{targetLoad:.1}});
  const step=runtime.step({ticks:12});assert.equal(step.capabilities.models[0].id,STUDIO_CANOPY_SI_BACKEND);assert.equal(step.capabilities.checkpoint,true);step.release();
  await assertExactResume(runtime,{study:'canopy'},24);
  // Torn fabric: half strength under a heavy snow load tears within a few seconds.
  const torn=createStudioRuntime({study:'canopy',backend:STUDIO_CANOPY_SI_BACKEND,controls:{targetLoad:5,strength:.5}});
  let broken=0;for(let i=0;i<10&&!broken;i++){const r=torn.step({ticks:120});broken=r.liveSnapshot.response.broken;r.release();}
  assert.ok(broken>0,'it tore');await assertExactResume(torn,{study:'canopy'},24);torn.destroy();
});

test('a canopy built from the cached form-found cloth steps exactly as one that solved its form again',async()=>{
  const {clearCanopyFormCache}=await import('../../src/studio/canopy-si.ts');
  clearCanopyFormCache();
  const a=new FailureSimulation('canopy',{},STUDIO_CANOPY_SI_BACKEND),b=new FailureSimulation('canopy',{},STUDIO_CANOPY_SI_BACKEND);
  // The first solved its form, the second is built from the cache: same cloth state to the bit.
  assert.deepEqual(b.canopySI.cloth.saveState(),a.canopySI.cloth.saveState());
  a.targetLoad=b.targetLoad=3;for(let i=0;i<60;i++){a.step();b.step();}
  assert.deepEqual(b.exportCheckpoint(),a.exportCheckpoint());
});
