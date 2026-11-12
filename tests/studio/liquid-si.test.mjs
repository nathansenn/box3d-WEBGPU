// The liquid lab in SI: liquid properties from the material library, the pipe friction law, the validated free-surface
// flume (volume, gate, viscosity) and the worker that steps it. The solver's own validation is in
// packages/box3d-kit/test/v18-fluid.test.mjs; docs/STUDIO_FLOW_LABS.md lists both.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {LIQUID_SI,liquidSI,frictionFactor}=await import('../../src/studio/material-labs/liquid-si.ts');
const {liquidSettings,pipeDelivery}=await import('../../src/studio/material-labs/liquid-config.ts');
const {LiquidModel,DT}=await import('../../src/studio/material-labs/models.ts');
const {MATERIALS}=await import('../../src/studio/material-labs/catalog.ts');
const {labWorkerHandler}=await import('../../src/studio/material-labs/lab-worker-protocol.ts');
const run=(m,t)=>{while(m.frame.time<t-1e-9)m.step(Math.min(4*DT,t-m.frame.time));return m;};

test('every Studio liquid has SI density and viscosity; water, olive oil, glycerol and honey come from the material library',()=>{
  for(const m of MATERIALS.liquid){const si=liquidSI(m.id);assert.ok(si.density>500&&si.density<2000&&si.viscosity>0&&si.note.length>10,m.id);}
  assert.deepEqual([LIQUID_SI.water.density,LIQUID_SI.water.viscosity,LIQUID_SI.water.verified],[998.207,1.0016e-3,true]);
  assert.deepEqual([LIQUID_SI.glycerin.density,LIQUID_SI.glycerin.viscosity,LIQUID_SI.glycerin.verified],[1261.08,1.412,true]);
  assert.deepEqual([LIQUID_SI.oil.density,LIQUID_SI.oil.viscosity,LIQUID_SI.oil.verified],[879,0.0797,true]);
  assert.deepEqual([LIQUID_SI.honey.viscosity,LIQUID_SI.honey.verified],[7.43,false],'honey density is unverified');
  assert.equal(LIQUID_SI.slurry.verified,false);
});

test('pipe friction: 64/Re when laminar (Hagen-Poiseuille), the Colebrook correlation when turbulent',()=>{
  assert.equal(frictionFactor(1000),0.064);
  for(const re of [1e4,1e5,1e6]){const f=frictionFactor(re),residual=1/Math.sqrt(f)+2*Math.log10(2.51/(re*Math.sqrt(f)));assert.ok(Math.abs(residual)<1e-9,`Colebrook residual at Re ${re}`);}
  assert.ok(Math.abs(frictionFactor(1e5)/(0.3164/1e5**.25)-1)<0.02,'smooth pipe at Re 1e5 within 2% of Blasius');
  // Honey through a 50 mm, 8 m pipe is laminar: the friction head is the Hagen-Poiseuille 32 mu L V / (rho g D^2).
  const p=liquidSettings({rig:'pipes',bore:50,pipeLength:8,inflow:80,head:4,pipe:'straight'}),honey=pipeDelivery(p,7.43,1420);
  const V=honey.flow/(Math.PI*.05**2/4);assert.ok(honey.reynolds<1);
  assert.ok(Math.abs(honey.friction*8/.05*V*V/(2*9.81)-32*7.43*8*V/(1420*9.81*.05**2))<1e-9);
  const water=pipeDelivery(p,1.0016e-3,998.207);assert.ok(water.reynolds>4000&&water.flow>30*honey.flow);
});

test('flume: the free-surface solver keeps the liquid volume exactly, lifts the gate at the set speed and stays deterministic',()=>{
  const a=run(new LiquidModel({material:'water'}),1.5),b=run(new LiquidModel({material:'water'}),1.5);
  assert.equal(a.flume.volume(),a.initialVolume);assert.equal(a.frame.metrics[2],a.initialVolume);
  assert.ok(Math.abs(a.initialVolume-a.flume.fluid.count*0.125**3/8)<1e-12);
  assert.ok(Math.abs(a.frame.actuator-Math.min(1.1,1.5*.8))<1e-9,'gate lift = speed x time, capped at the opening');
  assert.ok(a.frame.metrics[1]>1,'the surge moves at metres per second');
  assert.deepEqual(a.snapshot(),b.snapshot());
  assert.equal(a.frame.hydraulics.residual,0);
});

test('flume: honey (7.4 Pa s) spreads far more slowly than water from the same reservoir',()=>{
  const water=run(new LiquidModel({material:'water',fill:0}),2),honey=run(new LiquidModel({material:'honey',fill:0}),2);
  assert.equal(honey.flume.viscous,true);assert.equal(water.flume.viscous,false,'water viscosity is below the step threshold at 0.125 m cells');
  assert.equal(honey.flume.noSlip,true);assert.equal(run(new LiquidModel({material:'oil'}),.05).flume.noSlip,false,'the oil boundary layer is thinner than half a cell: free-slip walls');
  const centre=m=>{let x=0;const X=m.flume.fluid.positions;for(let i=0;i<m.flume.fluid.count;i++)x+=X[3*i];return x/m.flume.fluid.count;};
  assert.ok(centre(water)>centre(honey)+0.3,`centres of mass ${centre(water)} and ${centre(honey)} m`);
});

test('the flow worker steps the liquid lab in batches and refuses stale or foreign requests',()=>{
  const handle=labWorkerHandler(),first=handle({type:'reset',generation:1,lab:'liquid',settings:{rig:'pipes',fill:0}});
  assert.equal(first.type,'frame');
  const next=handle({type:'step',generation:1,request:1,ticks:4,release:false});assert.ok(Math.abs(next.frame.time-4*DT)<1e-12);
  assert.equal(handle({type:'step',generation:1,request:1,ticks:4,release:false}).type,'error');
  assert.equal(handle({type:'reset',generation:2,lab:'glass',settings:{}}).type,'error');
});
