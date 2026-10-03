import assert from 'node:assert/strict';
import {test} from 'node:test';
import {registerHooks} from 'node:module';
import {existsSync} from 'node:fs';
registerHooks({resolve(s,c,next){if(s.startsWith('.')&&!/\.[a-z]+$/i.test(s)&&c.parentURL?.endsWith('.ts')){const u=new URL(s+'.ts',c.parentURL);if(existsSync(u))return next(u.href,c);}return next(s,c);}});
const {METALS,PRESS_TOOLS,THICKNESSES,PRESS_EXPERIMENTS,DEFAULT_PRESS,normalizePress,readPress,writePress,toolHeight}=await import('../../src/studio/press-settings.ts');
const {FailureSimulation}=await import('../../src/studio/physics.ts');
const {pressAttachment,updatePlateShell,PRESS_FRAME_POINTS}=await import('../../src/studio/press-tooling.ts');
const {frameBridge}=await import('../../src/studio/bridge-framing.ts');
const {verifyNonPress}=await import('./non-press-regression.mjs');
const T=await import('three/webgpu');
const run=(p,seconds=12,load=p.pressure/20)=>{const s=new FailureSimulation('plate',p);s.targetLoad=load;for(let i=0;i<seconds*120;i++)s.step();return s;};
test('canopy and bridge retain exact pre-change positions, failures and responses',verifyNonPress);
test('complete press catalogue covers all tools and metal families with unique identities',()=>{
  assert.equal(METALS.length,24);assert.equal(PRESS_TOOLS.length,12);assert.equal(THICKNESSES.length,16);assert.equal(PRESS_EXPERIMENTS.length,54);
  for(const list of [METALS,PRESS_TOOLS,PRESS_EXPERIMENTS])assert.equal(new Set(list.map(x=>x.id)).size,list.length);
  assert.equal(new Set(PRESS_EXPERIMENTS.map(e=>e.settings.tool)).size,12);
});
test('URL round trip retains every independent control and rejects nonfinite or unknown input',()=>{
  const p=normalizePress({metal:'copper',tool:'wedge',thickness:16,angle:35,toolScale:1.25,pressure:42,strikeSpeed:150,stroke:80,hold:3.5}),q=new URLSearchParams();writePress(q,p);assert.deepEqual(readPress(q),p);
  const bad=readPress(new URLSearchParams('metal=unknown&tool=unknown&thickness=Infinity&pressure=-30&strike=999&toolAngle=NaN&stroke=0'));
  assert.equal(bad.metal,'mild-steel');assert.equal(bad.tool,'round');assert.equal(bad.thickness,2);assert.equal(bad.pressure,0);assert.equal(bad.strikeSpeed,250);assert.equal(bad.stroke,5);assert.equal(bad.angle,0);
});
test('pressure changes response while thickness, tool and strike speed stay fixed',()=>{
  const low=run({...DEFAULT_PRESS,pressure:15}),high=run({...DEFAULT_PRESS,pressure:95});assert.equal(low.brokenCount,0);assert.ok(high.brokenCount>5);assert.ok(high.deflection()>low.deflection()*2);
});
test('thicker plate resists the same pressure and thin sheet fractures',()=>{
  const thin=run({...DEFAULT_PRESS,thickness:.5,pressure:60}),thick=run({...DEFAULT_PRESS,thickness:12,pressure:60});assert.ok(thin.deflection()>thick.deflection()*2);assert.ok(thin.brokenCount>0);assert.equal(thick.brokenCount,0);
});
test('strike speed changes approach time without changing pressure or playback',()=>{
  const slow=run({...DEFAULT_PRESS,strikeSpeed:5},1),fast=run({...DEFAULT_PRESS,strikeSpeed:250},1);assert.ok(fast.punchY<slow.punchY-.2);assert.equal(fast.load,slow.load);
});
test('metal profiles change yield and deformation under the same stroke',()=>{
  const soft=run({...DEFAULT_PRESS,metal:'tin',pressure:25}),hard=run({...DEFAULT_PRESS,metal:'spring-steel',pressure:25});assert.ok(soft.deflection()>hard.deflection()*1.3);assert.ok(soft.response().plastic>hard.response().plastic);
});
test('all 54 experiments remain finite with pinned fixtures and irreversible topology',()=>{
  for(const e of PRESS_EXPERIMENTS){const s=run(e.settings,8);assert.ok(s.nodes.every(n=>n.p.every(Number.isFinite)),e.id);for(const i of s.supports)assert.deepEqual(s.nodes[i].p,s.nodes[i].rest,e.id);
    const broken=s.links.map(e=>e.broken);s.targetLoad=0;for(let i=0;i<240;i++)s.step();broken.forEach((b,i)=>{if(b)assert.ok(s.links[i].broken);});
  }
});
test('unloading retracts the tool while retaining plastic set and replay is immutable',()=>{
  const s=run({...DEFAULT_PRESS,pressure:80});const f=s.snapshot(),copy=Array.from(f.positions),plastic=f.response.plastic;s.targetLoad=0;for(let i=0;i<600;i++)s.step();assert.equal(s.punchY,3.85);assert.ok(s.response().plastic>=plastic);assert.ok(s.deflection()>.1);assert.deepEqual(Array.from(f.positions),copy);assert.equal(f.press.settings.pressure,80);
});
test('a completed short stroke holds, retracts and is exactly deterministic',()=>{
  const p={...DEFAULT_PRESS,thickness:.5,stroke:20,hold:.5};const a=run(p),b=run(p);assert.equal(a.pressCycle,'Complete');assert.deepEqual(a.snapshot(),b.snapshot());assert.deepEqual(a.events,b.events);
});
test('tool footprint honors the bore, four tips, rotation and contact scaling',()=>{
  assert.equal(toolHeight({...DEFAULT_PRESS,tool:'ring'},0,0),Infinity);assert.equal(toolHeight({...DEFAULT_PRESS,tool:'ring'},.7,0),0);
  assert.equal(toolHeight({...DEFAULT_PRESS,tool:'four-point'},0,0),Infinity);assert.equal(toolHeight({...DEFAULT_PRESS,tool:'four-point'},.68,.68),0);
  const p={...DEFAULT_PRESS,tool:'wedge'};assert.equal(toolHeight(p,1,0),Infinity);assert.ok(Number.isFinite(toolHeight({...p,angle:90},1,0)));
  assert.equal(toolHeight({...DEFAULT_PRESS,toolScale:.65},.8,0),Infinity);
});
test('all attachment geometry is finite, scaled and contacts its analytical lower face',()=>{
  const m=new T.MeshStandardMaterial();
  for(const tool of PRESS_TOOLS){const p={...DEFAULT_PRESS,tool:tool.id},g=pressAttachment(p,m,m);g.updateMatrixWorld(true);let contact=0;
    g.traverse(o=>{if(!o.isMesh)return;const v=o.geometry.attributes.position;for(let i=0;i<v.count;i++){const q=new T.Vector3(v.getX(i),v.getY(i),v.getZ(i)).applyMatrix4(o.matrixWorld);assert.ok(q.toArray().every(Number.isFinite));const h=toolHeight(p,q.x*.999999,q.z*.999999);if(Number.isFinite(h)){assert.ok(q.y>=h-.005,tool.id+' lower face penetration');if(Math.abs(q.y-h)<.005)contact++;}}o.geometry.dispose();});assert.ok(contact>10,tool.id+' contact vertices');
  }m.dispose();
});
test('solid shell supplies underside and fracture walls at actual selected thickness',()=>{
  const g=new T.BufferGeometry();g.setAttribute('position',new T.BufferAttribute(new Float32Array(300),3));g.setAttribute('uv',new T.BufferAttribute(new Float32Array(200),2));updatePlateShell(g,new Float32Array([0,0,0,1,0,0,0,0,1]),[0,2,1],.2);assert.equal(g.drawRange.count,21);let low=1,high=-1;for(let i=0;i<g.drawRange.count;i++){const y=g.attributes.position.getY(i);low=Math.min(low,y);high=Math.max(high,y);}assert.ok(Math.abs(high-low-.2)<1e-6);assert.ok([...g.attributes.normal.array].every(Number.isFinite));g.dispose();
});
test('complete machine corners fit desktop and phone inspection bounds from both sides',()=>{
  for(const [w,h,left,right] of [[1216,634,100,886],[390,720,18,372]])for(const x of [-10,9.5]){
    const camera=new T.PerspectiveCamera(44,w/h,.1,900),target=new T.Vector3(0,3.8,0);camera.position.set(x,8.4,16);const rect={left,right,top:90,bottom:h-175};
    frameBridge(camera,target,w,h,rect,PRESS_FRAME_POINTS);
    for(const p of PRESS_FRAME_POINTS){const v=new T.Vector3(...p).project(camera),px=(v.x+1)*w/2,py=(1-v.y)*h/2;assert.ok(px>=left-.01&&px<=right+.01&&py>=rect.top-.01&&py<=rect.bottom+.01,`${w} px full press corner`);}
  }
});
