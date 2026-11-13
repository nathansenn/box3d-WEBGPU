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

test('EN 1991-1-4 wind on the canopy: peak velocity pressure, Table 7.6, the applied resultant equals c_f q_p A at d/4 from the windward edge',async()=>{
  const {peakVelocityPressure,canopyNetPressure,canopyZone,EN1991_TABLE_7_6}=await import('../../src/studio/canopy-si.ts');
  // 4.3-4.10 at z = 10 m in terrain II: c_r = 0.19 ln(200), I_v = 1 / ln(200), c_e = (1 + 7 I_v) c_r^2.
  const at10=peakVelocityPressure(26,10),L=Math.log(200);
  close(at10.cr,.19*L,1e-12,'c_r');close(at10.Iv,1/L,1e-12,'I_v');close(at10.exposure,(1+7/L)*(.19*L)**2,1e-12,'c_e');
  close(at10.qp,at10.exposure*.5*1.25*26*26,1e-12,'q_p = c_e q_b');
  assert.ok(Math.abs(at10.exposure-2.35)<.01,`c_e(10 m, II) ${at10.exposure} (EN Figure 4.2 reads about 2.35; read from memory)`);
  // Below z_min (2 m in terrain II) the profile is held at z_min.
  close(peakVelocityPressure(20,1).qp,peakVelocityPressure(20,2).qp,1e-15,'z < z_min');
  assert.deepEqual(EN1991_TABLE_7_6[0].min0,[-.5,-.6,-1.3,-1.4]);
  const sim=make(0,1,2),c=sim.canopySI,q=peakVelocityPressure(30,c.height).qp,A=c.area.reduce((a,b)=>a+b,0);
  console.log(`# canopy at ${c.height.toFixed(2)} m, plan ${c.plan.d.toFixed(2)} x ${c.plan.b.toFixed(2)} m: v_b 30 m/s gives q_p ${q.toFixed(0)} Pa (gust factor 1 + 7 I_v = ${(1+7*peakVelocityPressure(30,c.height).Iv).toFixed(3)})`);
  for(const windCase of ['max','min0','min1']){
    const p=canopyNetPressure('force',windCase,q,{x:c.planX,z:c.planZ,area:c.area},c.plan),cf=EN1991_TABLE_7_6[0][windCase][0];
    let F=0,M=0;for(let i=0;i<p.length;i++){F+=p[i]*c.area[i];M+=p[i]*c.area[i]*(c.planX[i]-c.plan.x0);}
    close(F,cf*q*A,1e-12,`${windCase}: resultant = c_f q_p A`);close(M/F,c.plan.d/4,1e-12,`${windCase}: centre d/4 from the windward edge`);
    const local=canopyNetPressure('local',windCase,q,{x:c.planX,z:c.planZ,area:c.area},c.plan);let FL=0;for(let i=0;i<p.length;i++)FL+=local[i]*c.area[i];
    console.log(`# ${windCase}: c_f ${cf} -> ${(F/1e3).toFixed(2)} kN; zone envelope c_p,net gives ${(FL/1e3).toFixed(2)} kN (${(FL/F).toFixed(2)} x, the local maxima of all directions at once)`);
    assert.ok(Math.abs(FL)>Math.abs(F),'the local envelope exceeds the overall force');
  }
  // Zone areas of the key plan: B 20%, C 16%, A 64%.
  let a=0,b=0,cc=0;const N=400;for(let i=0;i<N;i++)for(let j=0;j<N;j++){const z=canopyZone((i+.5)/N,(j+.5)/N);if(z==='A')a++;else if(z==='B')b++;else cc++;}
  close(a/N/N,.64,1e-12,'A');close(b/N/N,.2,1e-12,'B');close(cc/N/N,.16,1e-12,'C');
});

test('the canopy under EN uplift: the nodal wind forces are the field, and at rest the posts carry the weight less the uplift',()=>{
  const sim=make(0,1,1),c=sim.canopySI,weight=c.cloth.masses.reduce((s,m)=>s+m,0)*9.81;
  // Let the pressure ramp up (1 kPa/s) and the sheet settle, then solve the static equilibrium under the held loads.
  for(let i=0;i<120*3;i++)sim.step();
  close(c.windPressure,c.windTarget,1e-12,'ramped to the target');
  const {force,centre}=c.windResultant(),q=c.windPressure,A=c.area.reduce((s,a)=>s+a,0);
  close(force,.5*q*A,1e-12,'uplift = |c_f| q_p A (c_f = -0.5, empty canopy)');close(centre,c.plan.d/4,1e-9,'centre at d/4');
  c.cloth.solveStatic();
  console.log(`# v_b 15 m/s: q_p ${q.toFixed(0)} Pa, uplift ${(force/1e3).toFixed(2)} kN, weight ${(weight/1e3).toFixed(2)} kN, post reaction ${(c.supportReaction()/1e3).toFixed(2)} kN, rise ${((Math.max(...Array.from({length:c.settled.length},(_,i)=>c.cloth.positions[3*i+1]-c.settled[i]))))*1e3|0} mm`);
  close(c.supportReaction(),weight-force,2e-3,'static: reaction = weight - uplift');
  assert.equal(c.cloth.tornCount,0);
});
