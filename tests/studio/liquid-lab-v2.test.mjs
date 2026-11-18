import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {existsSync,writeFileSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {LABS,MATERIALS,normalizeSettings,readSettings,writeSettings}=await import('../../src/studio/material-labs/catalog.ts');
const {LiquidModel,DT}=await import('../../src/studio/material-labs/models.ts');
const {LIQUID_RIGS,LIQUID_KEYS,LIQUID_DEFAULTS,liquidSettings,pipeDelivery}=await import('../../src/studio/material-labs/liquid-config.ts');
const {createSavedRun,readRunLibrary,RUN_STORAGE_KEY}=await import('../../src/studio/material-labs/run-library.ts');
const run=(m,t,dt=DT)=>{for(let i=0;i<Math.round(t/dt);i++)m.step(dt);return m;};
const receipts=[];
test('catalog covers five rigs and at least twenty fluids and forty presets and normalized URL inputs',()=>{
  assert.ok(MATERIALS.liquid.length>=20);assert.equal(new Set(MATERIALS.liquid.map(m=>m.id)).size,MATERIALS.liquid.length);assert.ok(LABS.liquid.experiments.length>=40);
  for(const rig of LIQUID_RIGS)assert.ok(LABS.liquid.experiments.filter(p=>(p.settings.rig??'flume')===rig.id).length>=8);
  for(const p of LABS.liquid.experiments){const normalized=normalizeSettings('liquid',p.settings);assert.deepEqual(readSettings('liquid',new URLSearchParams(writeSettings('liquid',normalized,p.id))),normalized);}
  const invalid=normalizeSettings('liquid',{rig:'bad',surface:'unknown',pipe:'evil',storm:'bad',rain:Infinity,slope:-5,bore:1e6,drain:NaN,inflow:NaN,damping:100});
  assert.equal(invalid.rig,'flume');assert.equal(invalid.rain,0);assert.equal(invalid.slope,0);assert.equal(invalid.bore,200);assert.equal(invalid.damping,12);assert.equal(invalid.inflow,18);
});
for(const preset of LABS.liquid.experiments)test(`complete hydraulic program: ${preset.id}`,()=>{
  const t=performance.now(),m=run(new LiquidModel(preset.settings),LABS.liquid.duration),h=m.frame.hydraulics;
  for(const a of [m.h,m.qx,m.qz,m.frame.positions,m.frame.rotations,m.frame.metrics,Object.values(h).filter(v=>typeof v==='number')])assert.ok([...a].every(Number.isFinite));
  assert.ok(Math.abs(h.residual)<1e-8,`budget ${h.residual}`);assert.ok([...m.h].every(v=>v>=0));m.solid.forEach((v,i)=>{if(v)assert.equal(m.h[i],0);});
  if(m.liquid.rig==='flume')assert.ok(Math.abs(m.volume()-m.initialVolume)<1e-8);
  if(m.liquid.rig!=='flume')assert.ok([...m.h].every(v=>v<=1.250001));
  receipts.push({preset:preset.id,rig:m.liquid.rig,seconds:m.frame.time,cpuMs:performance.now()-t,metrics:m.frame.metrics,hydraulics:h});
});
test('pipe demand, diameter, length, viscosity and attachment affect actual delivery',()=>{
  const base=liquidSettings({rig:'pipes',bore:50,inflow:80}),water=pipeDelivery(base,.02,1),narrow=pipeDelivery({...base,bore:20},.02,1),wide=pipeDelivery({...base,bore:200},.02,1),long=pipeDelivery({...base,pipeLength:20},.02,1),honey=pipeDelivery(base,5,1.4),nozzle=pipeDelivery({...base,pipe:'nozzle'},.02,1);
  assert.ok(wide.flow>water.flow&&water.flow>narrow.flow);assert.ok(water.flow>long.flow&&water.flow>honey.flow&&water.flow>nozzle.flow);assert.ok(water.head<=4.000001);assert.equal(pipeDelivery({...base,inflow:0},.02,1).flow,0);
  const m=run(new LiquidModel({...base,fill:0}),2);assert.ok(Math.abs(m.frame.hydraulics.added-water.flow*2)<1e-9);
});
test('rain adds the specified depth over exposed area; a closed sealed table conserves it',()=>{
  const m=run(new LiquidModel({rig:'rain',rain:180,drain:0,fill:0,slope:0,surface:'glass'}),6);
  assert.ok(Math.abs(m.volume()-6*2*.18/3600*6)<1e-10);assert.ok(m.frame.hydraulics.rained>0);assert.equal(m.frame.hydraulics.added,0);assert.equal(m.frame.hydraulics.absorbed,0);
});
test('supply cutoff stops both inputs, allows drainage, and replay snapshots remain detached',()=>{
  const m=run(new LiquidModel({rig:'pipes',rain:150,slope:4,fill:20}),3),snapshot=m.snapshot(),saved=structuredClone(snapshot),added=m.frame.hydraulics.added,rained=m.frame.hydraulics.rained,drained=m.frame.hydraulics.drained;
  m.release();run(m,3);assert.equal(m.frame.hydraulics.added,added);assert.equal(m.frame.hydraulics.rained,rained);assert.ok(m.frame.hydraulics.drained>drained);assert.equal(m.frame.hydraulics.inlet,0);assert.equal(m.frame.hydraulics.rainRate,0);assert.deepEqual(snapshot,saved);
});
test('film drag, absorption and viscosity produce different observable responses',()=>{
  const p={rig:'surface',surface:'glass',slope:6,fill:10,inflow:0},smooth=run(new LiquidModel(p),3),rough=run(new LiquidModel({...p,surface:'rubber'}),3),porous=run(new LiquidModel({...p,surface:'concrete'}),3),honey=run(new LiquidModel({...p,material:'honey'}),3);
  assert.ok(smooth.frame.metrics[1]>rough.frame.metrics[1]*2);assert.ok(smooth.frame.metrics[1]>honey.frame.metrics[1]*1.5);assert.ok(porous.frame.hydraulics.absorbed>0);assert.equal(smooth.frame.hydraulics.absorbed,0);
});
test('determinism, dry rain, blocked outlet, zero demand and step validation',()=>{
  for(const p of [{rig:'rain',rain:0,fill:0},{rig:'surface',inflow:0,fill:0},{rig:'river',inflow:80,bore:200,drain:0,slope:12,fill:80}]){const a=run(new LiquidModel(p),2),b=run(new LiquidModel(p),2);assert.deepEqual(a.snapshot(),b.snapshot());assert.ok(Math.abs(a.frame.hydraulics.residual)<1e-8);}
  const dry=run(new LiquidModel({rig:'rain',rain:0,fill:0}),2);assert.equal(dry.volume(),0);assert.equal(dry.frame.hydraulics.wetArea,0);
  for(const dt of [0,-1,NaN,Infinity,.3])assert.throws(()=>dry.step(dt));
});
test('all fluid profiles stay finite at maximum viscosity and minimum bore',()=>{
  for(const material of MATERIALS.liquid){const m=run(new LiquidModel({rig:'pipes',material:material.id,bore:20,inflow:80,damping:12,slope:12,fill:0}),1);assert.ok([...m.h,...m.qx,...m.qz].every(Number.isFinite));assert.ok(Math.abs(m.frame.hydraulics.residual)<1e-8);}
});
test('new saved settings round-trip; legacy liquid records acquire safe defaults',()=>{
  const m=run(new LiquidModel(LABS.liquid.experiments.find(e=>e.id==='rain-wind').settings),1);
  const draft={study:'liquid',name:'Rain',settings:m.settings,experiment:'rain-wind',complete:false,phase:m.frame.phase,events:[],metricLabels:['Depth','Speed','Volume'],frames:[{time:0,metrics:[0,0,0]},m.frame]};
  const result=createSavedRun(draft,{id:'liquid-v2',savedAt:'2026-09-11'}),db={getItem:()=>JSON.stringify({version:1,runs:[result]})};assert.deepEqual(readRunLibrary(db).runs[0].settings,result.settings);
  for(const k of LIQUID_KEYS)delete result.settings[k];const old=readRunLibrary(db);assert.equal(old.runs.length,1);for(const k of LIQUID_KEYS)assert.equal(old.runs[0].settings[k],LIQUID_DEFAULTS[k]);
  result.settings.rig='bogus';assert.equal(readRunLibrary(db).runs.length,0);
});
after(()=>process.env.LIQUID_QA_OUTPUT&&writeFileSync(process.env.LIQUID_QA_OUTPUT,JSON.stringify({at:new Date().toISOString(),fixedStep:DT,scope:'Comparative CPU solver; excludes graphics',programs:receipts},null,2)+'\n'));
