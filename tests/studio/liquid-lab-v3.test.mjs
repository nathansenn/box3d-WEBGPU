import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,writeFileSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {LABS,MATERIALS,normalizeSettings,readSettings,writeSettings}=await import('../../src/studio/material-labs/catalog.ts');
const {LiquidModel,DT}=await import('../../src/studio/material-labs/models.ts');
const {LIQUID_RIGS,TERRAINS,PIPE_TOOLS,SUPPLY_PROGRAMS,liquidSettings,pipeDelivery,supplyFactor}=await import('../../src/studio/material-labs/liquid-config.ts');
const {bedElevation,liquidOutlets,rimHeight}=await import('../../src/studio/material-labs/liquid-terrain.ts');
const run=(m,t,dt=DT)=>{for(let i=0;i<Math.round(t/dt);i++)m.step(dt);return m;};
const cell=(m,x,z)=>Math.floor((z+1)/m.dz)*m.nx+Math.floor((x+3)/m.dx);
const results=[];
test('V3 contains 60 presets, 24 liquids, six attachments, six shaped beds and four supply programs',()=>{
  assert.equal(LABS.liquid.experiments.length,60);assert.equal(MATERIALS.liquid.length,24);assert.equal(PIPE_TOOLS.length,6);assert.equal(TERRAINS.length,6);assert.equal(SUPPLY_PROGRAMS.length,4);
  for(const rig of LIQUID_RIGS)assert.equal(LABS.liquid.experiments.filter(p=>(p.settings.rig??'flume')===rig.id).length,12);
  for(const preset of LABS.liquid.experiments){const p=normalizeSettings('liquid',preset.settings);assert.deepEqual(readSettings('liquid',new URLSearchParams(writeSettings('liquid',p,preset.id))),p);}
});
for(const terrain of TERRAINS)test(`stationary lake and dry shoreline over ${terrain.id}`,()=>{
  const m=new LiquidModel({rig:'surface',surface:'glass',terrain:terrain.id,relief:65,slope:1.5,inflow:0,drain:0,fill:0});
  const level=.66;for(let i=0;i<m.h.length;i++)m.h[i]=Math.max(0,level-m.elevation[i]);
  const before=m.h.slice(),volume=m.volume();run(m,5);
  const depthDrift=Math.max(...m.h.map((h,i)=>Math.abs(h-before[i]))),speed=Math.max(...m.frame.rotations.map(Math.abs));
  assert.ok(depthDrift<1e-12,`depth drift ${depthDrift}`);assert.ok(speed<1e-10,`spurious speed ${speed}`);assert.ok(Math.abs(m.volume()-volume)<1e-12);
  results.push({case:terrain.id,depthDrift,speed});
});
test('rain collects in the modelled hollow while the displayed bed uses identical heights',()=>{
  const m=run(new LiquidModel({rig:'rain',surface:'glass',terrain:'bowl',relief:30,slope:0,inflow:0,drain:0,fill:2,rain:250}),12);
  assert.ok(m.h[cell(m,.45,0)]>m.h[cell(m,2.5,.8)]*5);assert.ok(Math.abs(m.frame.hydraulics.residual)<1e-8);
  for(let i=0;i<m.h.length;i++){const x=(i%m.nx+.5)*m.dx-3,z=(Math.floor(i/m.nx)+.5)*m.dz-1;assert.equal(m.elevation[i],bedElevation(m.liquid,x,z));}
});
test('a crowned road moves its film toward both edge gutters',()=>{
  const m=run(new LiquidModel({rig:'surface',surface:'glass',terrain:'crown',relief:40,slope:0,inflow:0,drain:0,fill:4}),8);
  assert.ok(m.h[cell(m,0,.9)]>m.h[cell(m,0,0)]*4);assert.ok(m.h[cell(m,0,-.9)]>m.h[cell(m,0,0)]*4);assert.ok(Math.abs(m.frame.hydraulics.residual)<1e-8);
});
test('water crosses initially dry banks; taller banks reduce floodplain inundation',()=>{
  const p={rig:'river',surface:'glass',material:'water',bankHeight:.06,channelWidth:.7,meander:1,slope:0,fill:0,inflow:80,bore:200,head:8,drain:0};
  const low=new LiquidModel(p),high=new LiquidModel({...p,bankHeight:.4});assert.equal(low.frame.hydraulics.floodArea,0);assert.equal(high.frame.hydraulics.floodArea,0);
  run(low,15);run(high,15);assert.ok(low.frame.hydraulics.floodArea>.5);assert.ok(low.frame.hydraulics.floodArea>high.frame.hydraulics.floodArea+.4);
  for(const m of [low,high]){assert.ok(Math.abs(m.frame.hydraulics.residual)<1e-8);assert.ok([...m.h].every(h=>h>=0));}
  results.push({case:'bank-height',low:low.frame.hydraulics.floodArea,high:high.frame.hydraulics.floodArea});
});
test('pump head, supply valve and each timed program change delivered volume',()=>{
  const p=liquidSettings({rig:'pipes',bore:50,inflow:80,head:2}),base=pipeDelivery(p,.02,1);
  assert.ok(pipeDelivery({...p,head:8},.02,1).flow>base.flow);assert.ok(pipeDelivery({...p,valve:20},.02,1).flow<base.flow);
  for(const off of [{head:0},{valve:0}])assert.equal(pipeDelivery({...p,...off},.02,1).flow,0);
  for(const supply of SUPPLY_PROGRAMS){const m=run(new LiquidModel({...p,supply:supply.id,fill:0}),8);let integral=0;for(let i=0;i<80000;i++)integral+=supplyFactor((i+.5)/10000,supply.id)/10000;assert.ok(Math.abs(m.frame.hydraulics.added-base.flow*integral)<2e-6);assert.ok(Math.abs(m.frame.hydraulics.residual)<1e-8);}
});
test('all outlet groups add water exactly where their rendered openings discharge',()=>{
  for(const rig of ['pipes','river'])for(const tool of PIPE_TOOLS){const m=new LiquidModel({rig,pipe:tool.id,inflow:10,bore:120,fill:0,slope:0,surface:'glass'}),before=m.h.slice();assert.deepEqual(m.outlets,liquidOutlets(m.liquid));m.step(.0001);for(const [x,z] of m.outlets)assert.ok(m.h[cell(m,x,z)]>before[cell(m,x,z)]);assert.ok(Math.abs(m.frame.hydraulics.added-m.delivery.flow*.0001)<1e-12);}
});
test('zero initial film starts a pipe bench dry and a supplied front wets it progressively',()=>{
  const m=new LiquidModel({rig:'pipes',fill:0,inflow:25,bore:120,slope:2});assert.equal(m.volume(),0);run(m,2);assert.ok(m.frame.hydraulics.coverage>0&&m.frame.hydraulics.coverage<75);assert.ok(Math.abs(m.frame.hydraulics.residual)<1e-8);assert.equal(m.h[cell(m,2.7,0)],0);
});
test('finite boundary rims overflow with closed drains and remain in the volume budget',()=>{
  const m=run(new LiquidModel({rig:'surface',surface:'glass',terrain:'crown',relief:90,inflow:80,bore:200,head:12,drain:0,fill:80,slope:0}),18);
  assert.ok(m.frame.hydraulics.overflow>0);assert.equal(m.frame.hydraulics.outlet,0);assert.ok(Math.abs(m.frame.hydraulics.drained-m.frame.hydraulics.overflow)<1e-12);assert.ok(Math.abs(m.frame.hydraulics.residual)<1e-8);
  for(let z=0;z<m.nz;z++)for(let x=0;x<m.nx;x++)if(x===0||z===0||x===m.nx-1||z===m.nz-1){const i=z*m.nx+x;assert.ok(m.h[i]+m.elevation[i]<=m.datum((x+.5)*m.dx-3)+rimHeight(m.liquid)+1e-10);}
});
test('cutoff and replay preserve the recorded surge, bank coverage and overflow values',()=>{
  const m=run(new LiquidModel(LABS.liquid.experiments.find(p=>p.id==='river-overbank').settings),9),snapshot=m.snapshot(),saved=structuredClone(snapshot),added=m.frame.hydraulics.added;
  m.release();run(m,2);assert.equal(m.frame.hydraulics.added,added);assert.equal(m.frame.hydraulics.inlet,0);assert.deepEqual(snapshot,saved);assert.ok(saved.hydraulics.floodArea>0);assert.ok(saved.hydraulics.coverage>=0&&saved.hydraulics.coverage<=100);
});
after(()=>{if(process.env.LIQUID_V3_QA_OUTPUT)writeFileSync(process.env.LIQUID_V3_QA_OUTPUT,JSON.stringify({at:new Date().toISOString(),results},null,2)+'\n');});
