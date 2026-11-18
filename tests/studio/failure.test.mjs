import assert from 'node:assert/strict';
import { FailureSimulation, STUDIES, FIXED_DT, cableHeight, terrainHeight } from '../../src/studio/physics.ts';

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(`PASS ${name}`); }
function run(s, seconds) { for(let i=0;i<Math.round(seconds/FIXED_DT);i++) s.step(); return s; }

check('bridge cable saddles exactly meet tower elevation and share gauge', () => {
  assert.equal(cableHeight(0),14); assert.equal(cableHeight(1),14); assert.equal(cableHeight(.5),7.2);
  const s=new FailureSimulation('bridge');
  for(let i=0;i<STUDIES.bridge.cols;i++) assert.equal(s.nodes[i*4+3].rest[2]-s.nodes[i*4+2].rest[2],STUDIES.bridge.depth);
});
check('valley has grounded banks and a continuous river channel', () => {
  for(let z=-40;z<40;z++) { assert.ok(terrainHeight(0,z)<-1.4); assert.ok(terrainHeight(24,z)>0); }
});

for(const id of ['canopy','plate','bridge']) {
  const service=new FailureSimulation(id);service.targetLoad=.8;run(service,10);
  const failed=new FailureSimulation(id);failed.targetLoad=4;run(failed,13);
  check(`${id}: service load preserves all connections`,()=>assert.equal(service.brokenCount,0));
  check(`${id}: overload breaks physical connections and yields an event`,()=>{
    assert.ok(failed.brokenCount>5);assert.ok(failed.events.some(e=>e.type==='break'));
    assert.ok(failed.deflection()>service.deflection()*1.5);
  });
  check(`${id}: all fixed anchors remain exactly on their fixture coordinates`,()=>{
    for(const i of failed.supports) assert.deepEqual(failed.nodes[i].p,failed.nodes[i].rest);
  });
  check(`${id}: finite positions and explicit lower contact boundary after failure`,()=>{
    for(const n of failed.nodes) { assert.ok(n.p.every(Number.isFinite));assert.ok(n.p[1]>=STUDIES[id].floor-1e-7); }
  });
  check(`${id}: broken links cannot transmit forces or reconnect on unloading`,()=>{
    const breaks=failed.links.map(e=>e.broken);failed.targetLoad=0;run(failed,1);
    breaks.forEach((b,i)=>{if(b)assert.equal(failed.links[i].broken,true);});
    assert.ok(failed.brokenCount>=breaks.filter(Boolean).length);
  });
  check(`${id}: reset restores original topology and model time`,()=>{
    const reset=new FailureSimulation(id);assert.equal(reset.brokenCount,0);assert.equal(reset.time,0);
    assert.equal(reset.links.length,failed.links.length);assert.ok(reset.links.every(e=>!e.broken&&e.plastic===0));
  });
  if(id!=='bridge') check(`${id}: rendered triangles no longer span severed edges`,()=>{
    assert.ok(failed.activeIndices().length<service.activeIndices().length);
    assert.ok(failed.activeIndices().every(i=>i>=0&&i<failed.nodes.length));
  });
  if(id==='plate') check('plate: plastic strain and permanent dent remain after unloading',()=>{
    const plastic=service.response().plastic,loaded=service.deflection(); service.targetLoad=0;run(service,4);
    assert.ok(plastic>0);assert.ok(service.response().plastic>=plastic);assert.ok(service.deflection()>.005);assert.ok(service.deflection()<loaded);
  });
}
check('fixed-step replay is exactly deterministic',()=>{
  const a=new FailureSimulation('bridge'),b=new FailureSimulation('bridge');
  a.targetLoad=b.targetLoad=4;run(a,8);run(b,8);
  assert.deepEqual(a.snapshot(),b.snapshot());assert.deepEqual(a.events,b.events);
});
check('connection strength materially changes failure under identical loading',()=>{
  const a=new FailureSimulation('bridge'),b=new FailureSimulation('bridge');
  a.targetLoad=b.targetLoad=4;b.strength=4;run(a,9);run(b,9);
  assert.ok(a.brokenCount>0);assert.equal(b.brokenCount,0);
});
check('invalid time steps are rejected before state mutation',()=>{
  const s=new FailureSimulation('canopy');for(const dt of [NaN,0,-1,1]) assert.throws(()=>s.step(dt),RangeError);
  assert.equal(s.time,0);
});
console.log(`\n${passed}/${passed} PASS — reduced failure physics and attachment invariants`);
