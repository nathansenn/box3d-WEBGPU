// The Metal press study on the SI press brake (src/studio/press-si.ts, physics.ts STUDIO_PRESS_SI_BACKEND).
// Short runs; SI values. Run by `npm run test:studio:press`.
import test from 'node:test';
import assert from 'node:assert/strict';
import {FailureSimulation,STUDIO_PRESS_SI_BACKEND} from '../../src/studio/physics.ts';
import {pressGeometry,siPress,SI_PRESS_EXPERIMENTS,PRESS_RATED_FORCE} from '../../src/studio/press-si.ts';
import {normalizePress} from '../../src/studio/press-settings.ts';
import {createStudioRuntime} from '../../src/engine/studio-runtime.ts';

const settings=p=>siPress(normalizePress({metal:'structural-steel-s355',tool:'bead',thickness:2,pressure:40,strikeSpeed:25,stroke:8,hold:.2,...p}));
function run(p,seconds){
  const sim=new FailureSimulation('plate',settings(p),STUDIO_PRESS_SI_BACKEND);sim.targetLoad=sim.press.pressure/20;
  const cycles=new Set();for(let i=0;i<Math.round(seconds*120)&&sim.pressCycle!=='Complete';i++){sim.step();cycles.add(sim.pressCycle);}
  return {sim,cycles,r:sim.response(),si:sim.pressSI};
}

test('settings map to SI press-brake geometry and library metals',()=>{
  const g=pressGeometry(settings({}));
  assert.equal(g.thickness,.002);assert.equal(g.punchRadius,.036);assert.equal(g.dieRadius,.002);
  assert.ok(Math.abs(g.dieOpening-2*(.036+.002+.008))<1e-12,'die opening clears punch, shoulders and four thicknesses each side');
  assert.ok(Math.abs(pressGeometry(settings({tool:'wedge'})).dieOpening-.024)<1e-12,'twelve thicknesses for the V blade');
  assert.ok(Math.abs(pressGeometry(settings({tool:'wedge',stroke:30})).strokeLimit-.008)<1e-12,'the punch stops before its centre passes the shoulders');
  assert.equal(siPress(normalizePress({metal:'copper',tool:'ball'})).metal,'structural-steel-s355');assert.equal(siPress(normalizePress({tool:'ball'})).tool,'wedge');
  for(const e of SI_PRESS_EXPERIMENTS)assert.deepEqual(siPress(e.settings),e.settings,e.id);
});

test('an S355 radius bend: approach, forming, hold, retract; force in kN, depth in mm, yield and springback, no crack',()=>{
  const {sim,cycles,r,si}=run({},4);
  assert.ok(['Approach','Forming','Holding','Retracting'].every(c=>cycles.has(c)),[...cycles].join());
  const peak=si.peakForce/1e3,g=si.geometry,Mp=2/Math.sqrt(3)*355e6*g.thickness**2/4,limit=4*Mp/g.dieOpening*g.width/1e3;
  console.log(`# peak punch force ${peak.toFixed(2)} kN (beam limit ${limit.toFixed(2)} kN), plastic ${(r.plastic*100).toFixed(2)}%, depth ${(r.deflection*100).toFixed(2)} mm, angle ${si.brake.bendAngle.toFixed(1)} deg, real-time factor ${si.realTimeFactor.toFixed(3)}`);
  // The force rises past the beam-theory limit load with hardening and the closing span; the same band as the engine test.
  assert.ok(peak>.9*limit&&peak<2*limit,`peak ${peak} limit ${limit}`);
  assert.ok(r.plastic>.005&&r.broken===0,'yielded, not cracked');
  assert.ok(sim.events.some(e=>e.type==='yield'));
  assert.ok(r.deflection*100>5,'a permanent bend of several millimetres in scene units');
});

test('a 6061-T6 V bend cracks, breaks the sheet along the bend line and reports the eroded elements',()=>{
  const {sim,r}=run({metal:'aluminium-6061-t6',tool:'wedge',stroke:6},3);
  assert.ok(r.broken>0&&sim.events.some(e=>e.type==='break'),'eroded elements and a crack event');
  assert.ok(sim.brokenCount>0,'links across the cracked column are broken for drawing');
});

test('the force limit stops the ram (pressure limited) and is a percentage of the rated force',()=>{
  const {si,cycles}=run({thickness:4,pressure:1},4);
  assert.equal(si.pressureLimit,.01*PRESS_RATED_FORCE);
  assert.ok(cycles.has('Pressure limited'));assert.ok(si.peakForce>=si.pressureLimit&&si.peakForce<1.5*si.pressureLimit,`${si.peakForce}`);
});

test('the Studio runtime runs the SI backend and refuses to resume an SI checkpoint',()=>{
  const runtime=createStudioRuntime({study:'plate',backend:STUDIO_PRESS_SI_BACKEND,press:settings({}),controls:{targetLoad:2}});
  const step=runtime.step({ticks:30});assert.equal(step.liveSnapshot.study,'plate');step.release();
  assert.equal(step.capabilities.models[0].id,STUDIO_PRESS_SI_BACKEND);
  const checkpoint=runtime.exportCheckpoint();
  assert.throws(()=>FailureSimulation.fromCheckpoint(checkpoint),/cannot be resumed/);
});
