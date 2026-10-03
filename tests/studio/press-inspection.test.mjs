import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {FailureSimulation,STUDIO_SCALED_CHECKPOINT_BACKEND}=await import('../../src/studio/physics.ts');
const {METALS,PRESS_ATTACHMENTS,PRESS_EXPERIMENTS,DEFAULT_PRESS,normalizePress,toolDimensions}=await import('../../src/studio/press-settings.ts');
const {PressSectionSampler,pressInspectionValues,pressStrainHue,sheetRimEdge}=await import('../../src/studio/press-inspection.ts');
const {pressAttachment}=await import('../../src/studio/press-tooling.ts');
const {toolHeight}=await import('../../src/studio/press-settings.ts');
const T=await import('three/webgpu');

test('all 24 profiles are represented and every complete preset stays within independent control bounds',()=>{
  assert.equal(new Set(PRESS_EXPERIMENTS.map(e=>e.settings.metal)).size,METALS.length);
  for(const e of PRESS_EXPERIMENTS)assert.deepEqual(e.settings,normalizePress(e.settings),e.id);
  assert.equal(PRESS_ATTACHMENTS.length,36);
  assert.equal(new Set(PRESS_ATTACHMENTS.map(a=>[a.tool,a.toolScale,a.angle].join(':'))).size,36);
});
test('all 36 cartridges preserve visible and analytical contact at their configured scale and angle',()=>{
  const material=new T.MeshStandardMaterial();
  for(const a of PRESS_ATTACHMENTS){const p=normalizePress({...DEFAULT_PRESS,...a}),group=pressAttachment(p,material,material);group.updateMatrixWorld(true);let touches=0;
    group.traverse(o=>{if(!o.isMesh)return;const v=o.geometry.attributes.position;for(let i=0;i<v.count;i++){
      const q=new T.Vector3(v.getX(i),v.getY(i),v.getZ(i)).applyMatrix4(o.matrixWorld);assert.ok(q.toArray().every(Number.isFinite),a.id);
      const h=toolHeight(p,q.x*.999999,q.z*.999999);if(Number.isFinite(h)){assert.ok(q.y>=h-.005,a.name);if(Math.abs(q.y-h)<.005)touches++;}
    }o.geometry.dispose();});assert.ok(touches>10,a.name);assert.match(toolDimensions(p),/mm envelope/);
  }material.dispose();
});
test('both section axes recover actual rest dimensions and show connected zero deflection before loading',()=>{
  const sim=new FailureSimulation('plate',{...DEFAULT_PRESS,thickness:7.3}),sample=new PressSectionSampler(sim);
  for(const axis of ['x','z']){const section=sample.sample(sim.snapshot(),axis);assert.equal(section.gaps,0);assert.ok(Math.abs(section.span-(axis==='x'?520:440))<1e-9);assert.ok(section.points.every(p=>Math.abs(p.displacement)<.001));assert.equal(section.points.filter(p=>p.connected).length,section.points.length-1);}
});
test('every cartridge is seated continuously against its backing and ram shaft',()=>{
  const material=new T.MeshStandardMaterial();
  for(const a of PRESS_ATTACHMENTS){
    const group=pressAttachment(normalizePress(a),material,material);group.updateMatrixWorld(true);
    const working=group.children.slice(0,-3),backing=new T.Box3().setFromObject(group.children.at(-3)),shaft=new T.Box3().setFromObject(group.children.at(-2));
    const top=Math.max(...working.map(mesh=>new T.Box3().setFromObject(mesh).max.y));
    assert.ok(Math.abs(top-backing.min.y)<1e-6,a.name+' seated working head');
    assert.ok(Math.abs(backing.max.y-shaft.min.y)<1e-6,a.name+' seated shaft');
    group.traverse(o=>{if(o.isMesh)o.geometry.dispose();});
  }material.dispose();
});
test('a removed surface creates real section gaps and replay restores the original continuity without using live link state',()=>{
  const sim=new FailureSimulation('plate'),sampler=new PressSectionSampler(sim),before=sim.snapshot(),after=sim.snapshot();
  const a=14*33+16,b=a+1;
  for(const f of sim.faces.filter(f=>f.nodes.includes(a)&&f.nodes.includes(b)))after.broken[f.links[0]]=1;
  after.positions[a*3+1]-=.5;
  assert.ok(sampler.sample(after,'x').gaps>0);assert.ok(sampler.sample(after,'x').points.some(p=>p.displacement< -49));
  assert.equal(sampler.sample(before,'x').gaps,0);assert.ok(sampler.sample(before,'x').points.every(p=>Math.abs(p.displacement)<.001));
});
test('yield and rupture coloring follow the selected alloy and strength factor, not the generic steel limit',()=>{
  for(const m of METALS){const p={...DEFAULT_PRESS,metal:m.id};assert.ok(Math.abs(pressStrainHue(m.yield,p)-.38)<1e-12);assert.equal(pressStrainHue(m.rupture,p),0);assert.equal(pressStrainHue(m.rupture*2,p,2),0);}
  assert.notEqual(pressStrainHue(.02,{...DEFAULT_PRESS,metal:'tin'}),pressStrainHue(.02,{...DEFAULT_PRESS,metal:'spring-steel'}));
});
test('actual loaded and unloaded snapshots retain plastic stretch and report cracks, not an animation stage',()=>{
  const sim=new FailureSimulation('plate',{...DEFAULT_PRESS,thickness:.5,pressure:95,strikeSpeed:150},STUDIO_SCALED_CHECKPOINT_BACKEND);
  sim.targetLoad=4.75;for(let i=0;i<720;i++)sim.step();
  const loaded=sim.snapshot(),v=pressInspectionValues(loaded);assert.equal(v.stage,'Cracking');assert.ok(v.broken>0);assert.ok(v.plastic>0);assert.equal(v.deflection,loaded.response.deflection*100);
  sim.targetLoad=0;for(let i=0;i<480;i++)sim.step();const unloaded=pressInspectionValues(sim.snapshot());
  assert.ok(unloaded.plastic>=v.plastic);assert.ok(unloaded.broken>=v.broken);assert.deepEqual(pressInspectionValues(loaded),v);
});
test('fracture highlighting excludes only true exterior rims, including corner-adjacent diagonals',()=>{
  assert.ok(sheetRimEdge(0,1,33,29));assert.ok(sheetRimEdge(0,33,33,29));assert.ok(sheetRimEdge(32,65,33,29));assert.ok(sheetRimEdge(924,925,33,29));
  assert.equal(sheetRimEdge(1,33,33,29),false);assert.equal(sheetRimEdge(460,461,33,29),false);
});
