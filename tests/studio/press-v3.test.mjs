import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {DEFAULT_PRESS,toolDimensions,toolHeight}=await import('../../src/studio/press-settings.ts');
const {FailureSimulation,STUDIO_SCALED_CHECKPOINT_BACKEND}=await import('../../src/studio/physics.ts');
const {PressSectionSampler,pressPressureAt}=await import('../../src/studio/press-inspection.ts');
const {StudioRuntime}=await import('../../src/engine/studio-runtime.ts');
const {PressToolCollider}=await import('../../src/engine/press-contact.ts');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

test('replay reads requested pressure at that time rather than the last pressure or ramped drive level',()=>{
  const history=[{time:0,press:{pressure:65}},{time:2.8,press:{pressure:40}},{time:4.6,press:{pressure:0}}],copy=structuredClone(history);
  assert.equal(pressPressureAt(0,80,history),65);assert.equal(pressPressureAt(2,80,history),65);
  assert.equal(pressPressureAt(2.8,80,history),40);assert.equal(pressPressureAt(5,80,history),0);
  assert.equal(pressPressureAt(0,35,[]),35);assert.deepEqual(history,copy);
});

test('hex and capsule retain empty corners and match their rotated working envelopes',()=>{
  const hex={...DEFAULT_PRESS,tool:'hex'},capsule={...DEFAULT_PRESS,tool:'capsule'};
  assert.equal(toolHeight(hex,.91,0),0);assert.equal(toolHeight(hex,.8,.5),Infinity);
  assert.equal(toolHeight(capsule,0,1.06),0);assert.equal(toolHeight(capsule,.4,1),Infinity);
  assert.equal(toolDimensions(hex),'184 × 159 mm envelope');assert.equal(toolDimensions({...hex,angle:30}),'159 × 184 mm envelope');
  assert.equal(toolDimensions(capsule),'84 × 214 mm envelope');assert.equal(toolDimensions({...capsule,angle:90}),'214 × 84 mm envelope');
  assert.equal(toolDimensions({...capsule,angle:45}),'176 × 176 mm envelope');
  const h=new PressToolCollider(hex),c=new PressToolCollider(capsule);
  for(const tool of [h,c]){const q=tool.sample([0,-.01,0],0);near(q.distance,.01);assert.deepEqual(q.normal,[0,-1,0]);}
  assert.ok(h.sample([.08,.016,.05],0).distance>0);
  near(c.sample([.05,.016,0],0).distance,.008);near(c.sample([0,.016,.12],0).distance,.013);
  const hit=c.sweep([0,.016,.2],[0,.016,-.2],0,0,.002);assert.equal(hit.status,'hit');assert.ok(Math.abs(hit.time-(.2-.109)/.4)<1e-8);
});

test('movable sections find off-center damage without inventing a center tear or altering replay',()=>{
  const sim=new FailureSimulation('plate'),sampler=new PressSectionSampler(sim),before=sim.snapshot(),after=sim.snapshot();
  const row=6,a=row*sim.config.cols+16,b=a+1,offset=sim.nodes[a].rest[2]*100;
  for(const f of sim.faces.filter(f=>f.nodes.includes(a)&&f.nodes.includes(b)))after.broken[f.links[0]]=1;
  after.positions[a*3+1]-=.7;
  const slice=sampler.sample(after,'x',offset);
  near(slice.offset,offset);assert.equal(slice.index,row);assert.ok(slice.gaps>0);assert.ok(slice.points.some(p=>p.displacement< -69));
  assert.equal(sampler.sample(after,'x',0).gaps,0);assert.equal(sampler.sample(before,'x',offset).gaps,0);
  assert.equal(sampler.sample(after,'x',-10000).index,0);assert.equal(sampler.sample(after,'x',10000).index,28);
  assert.equal(sampler.sample(after,'z',NaN).index,16);
  for(const axis of ['x','z']){const s=sampler.sample(before,axis,10000);assert.ok(s.points.every(p=>Math.abs(p.displacement)<.001));assert.equal(s.gaps,0);}
});

test('pressure commands preserve the same damaged specimen, tick clock and retained recordings',()=>{
  const runtime=new StudioRuntime({study:'plate',backend:STUDIO_SCALED_CHECKPOINT_BACKEND,press:{...DEFAULT_PRESS,tool:'capsule',thickness:.8,strikeSpeed:100,hold:10},controls:{targetLoad:4}});
  const first=runtime.step({ticks:120}),recording=first.recordingSamples[0].snapshot,original=structuredClone(recording);first.release();
  runtime.step({ticks:120}).release();const formed=runtime.step({ticks:120}),loaded=structuredClone(formed.liveSnapshot),tick=formed.tick;formed.release();
  assert.ok(loaded.response.deflection>.2);assert.ok(loaded.response.plastic>0);
  const lower=runtime.step({ticks:1,commands:[{tick:tick+1,type:'controls',values:{targetLoad:1}}]});
  assert.equal(lower.tick,tick+1);assert.ok(lower.liveSnapshot.response.time>loaded.response.time);
  assert.ok(lower.liveSnapshot.press.pressure<loaded.press.pressure);assert.ok(lower.liveSnapshot.response.deflection>loaded.response.deflection*.9);
  assert.ok(lower.liveSnapshot.response.plastic>=loaded.response.plastic);assert.ok(lower.liveSnapshot.response.broken>=loaded.response.broken);lower.release();
  let release=runtime.step({ticks:120,commands:[{tick:runtime.tick+1,type:'controls',values:{targetLoad:0}}]});
  for(let i=0;i<4&&!release.completed;i++){release.release();release=runtime.step({ticks:120});}
  assert.equal(release.liveSnapshot.press.cycle,'Complete');assert.ok(release.liveSnapshot.response.plastic>=loaded.response.plastic);assert.ok(release.liveSnapshot.response.broken>=loaded.response.broken);
  assert.deepEqual(recording,original);release.release();runtime.destroy();
});
