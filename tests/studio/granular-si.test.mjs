// The granular lab in SI: grains from the material library, the discrete element solver in a tray drawn ten times
// larger, and the worker that steps it. The solver's validation against Lajeunesse et al. (2005) is in
// packages/box3d-kit/test/v17-granular.test.mjs; docs/STUDIO_FLOW_LABS.md lists both.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {GRAIN_SI,grainSI,BEAD_ROLLING_FRICTION,TRAY}=await import('../../src/studio/material-labs/granular-si.ts');
const {GranularModel,DT,METRIC_LABELS}=await import('../../src/studio/material-labs/models.ts');
const {MATERIALS}=await import('../../src/studio/material-labs/catalog.ts');
const {labWorkerHandler}=await import('../../src/studio/material-labs/lab-worker-protocol.ts');
const {GLASS_BEAD_ROLLING}=await import('../../packages/box3d-kit/test/granular-scenarios.mjs');
const run=(m,t)=>{while(m.frame.time<t-1e-9)m.step(Math.min(4*DT,t-m.frame.time));return m;};

test('grains: glass beads come from the material library with the rolling resistance fitted in the validated repose case',()=>{
  for(const m of MATERIALS.granular){const g=grainSI(m.id).material;assert.ok(g.density>500&&g.friction>0&&g.restitution>0&&g.restitution<=1,m.id);}
  assert.deepEqual([GRAIN_SI.beads.material.density,GRAIN_SI.beads.material.friction,GRAIN_SI.beads.material.restitution,GRAIN_SI.beads.verified],[2500,0.12,0.926,true]);
  assert.equal(BEAD_ROLLING_FRICTION,GLASS_BEAD_ROLLING);
  assert.equal(GRAIN_SI.sand.material.density,2650);assert.equal(GRAIN_SI.sand.verified,false,'sand restitution and rolling resistance are authored');
  assert.deepEqual(METRIC_LABELS.granular,['Runout · m','Pile height · m','Grains behind gate']);
});

test('tray: SI grains of the set diameter, drawn ten times larger; nothing is lost; the gate lifts at the set speed',()=>{
  const m=new GranularModel({material:'beads',size:10,fill:80,load:100,rate:2});
  assert.ok(Math.abs(m.tray.radius-0.005)<1e-12);assert.ok(Math.abs(m.radius-0.05)<1e-12);
  assert.equal(m.frame.metrics[2],m.count,'every grain starts behind the gate');
  run(m,0.5);
  assert.equal(m.tray.solver.liveCount,m.count);assert.equal(m.tray.solver.mass(),m.initialMass);
  assert.ok(Math.abs(m.frame.actuator-0.5*0.2*TRAY.scale)<1e-9,'lift = 0.2 m/s x 0.5 s, drawn x10');
  for(let i=0;i<m.count;i++){const y=m.frame.positions[3*i+1];assert.ok(Number.isFinite(y)&&y>=TRAY.floorModelY+0.9*m.radius-1e-9);}
  assert.ok(m.frame.metrics[0]>0&&m.frame.metrics[2]<m.count,'grains have passed the gate');
});

test('tray: low-friction glass beads run out farther than crushed stone; repeat runs are identical',()=>{
  const beads=run(new GranularModel({material:'beads',size:14,fill:60,rate:2}),1.5),stone=run(new GranularModel({material:'angular',size:14,fill:60,rate:2}),1.5);
  assert.ok(beads.frame.metrics[0]>stone.frame.metrics[0]+0.02,`runouts ${beads.frame.metrics[0]} and ${stone.frame.metrics[0]} m`);
  assert.deepEqual(run(new GranularModel({material:'beads',size:14,fill:60,rate:2}),1.5).snapshot(),beads.snapshot());
});

test('the flow worker steps the granular lab',()=>{
  const handle=labWorkerHandler();assert.equal(handle({type:'reset',generation:1,lab:'granular',settings:{size:16,fill:40}}).type,'frame');
  const f=handle({type:'step',generation:1,request:1,ticks:8,release:true});assert.equal(f.type,'frame');assert.ok(Math.abs(f.frame.time-8*DT)<1e-12);assert.ok(f.cpuMs>=0);
});
