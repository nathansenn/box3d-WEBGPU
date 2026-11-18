import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { FailureSimulation, STUDIO_CHECKPOINT_VERSION, STUDIO_CHECKPOINT_BACKEND } from '../../src/studio/physics.ts';

const run=(s,steps)=>{for(let i=0;i<steps;i++)s.step();return s;};
const jsonCopy=value=>JSON.parse(JSON.stringify(value));
function compareRenderValues(a,b) {
  for(const key of ['positions','strains','broken','punchY','response','press'])assert.deepEqual(a[key],b[key],key);
}

test('live snapshots reuse every buffer and nested object while copying all current values',()=>{
  for(const id of ['canopy','plate','bridge']) {
    const s=new FailureSimulation(id),target=s.createSnapshotTarget();
    const refs={positions:target.positions,strains:target.strains,broken:target.broken,response:target.response,
      press:target.press,settings:target.press?.settings};
    target.positions.fill(-999);target.strains.fill(-999);target.broken.fill(255);
    s.targetLoad=3;s.wind=.4;run(s,5);
    if(id==='plate')Object.assign(s.press,{pressure:55,strikeSpeed:100,tool:'wedge',angle:35,toolScale:1.2,stroke:60,hold:3,metal:'copper',thickness:3});
    assert.equal(s.snapshotInto(target),target);
    for(const key of ['positions','strains','broken','response','press'])assert.equal(target[key],refs[key],`${id} ${key}`);
    assert.equal(target.press?.settings,refs.settings);
    assert.deepEqual(target,s.snapshot());
    assert.deepEqual(target.response,s.response());
    assert.equal(target.study,id);assert.equal(target.topologyVersion,s.topologyVersion);
    if(id==='plate')assert.deepEqual(target.press.settings,s.press);
  }
});

test('recorded snapshots own all mutable data independently of the simulation and live targets',()=>{
  const s=run(new FailureSimulation('plate'),5),recording=s.snapshot(),expected=structuredClone(recording);
  const live=s.createSnapshotTarget(),other=s.snapshot();
  assert.notEqual(recording.positions,other.positions);assert.notEqual(recording.broken,other.broken);
  assert.notEqual(recording.strains,other.strains);assert.notEqual(recording.response,other.response);
  assert.notEqual(recording.press,other.press);assert.notEqual(recording.press.settings,other.press.settings);
  s.press.pressure=25;s.targetLoad=1.25;run(s,10);s.snapshotInto(live);
  other.positions.fill(100);other.broken.fill(1);other.strains.fill(2);other.response.phase='changed';other.press.settings.tool='cone';
  live.response.time=-1;live.press.settings.pressure=-1;
  assert.deepEqual(recording,expected);
});

test('snapshot targets reject bad dimensions, types, shared regions and missing or frozen state before writes',()=>{
  const s=new FailureSimulation('plate');
  const corruptions=[
    t=>t.positions=new Float32Array(t.positions.length-1),
    t=>t.strains=new Float32Array(t.strains.length+1),
    t=>t.broken=new Uint16Array(t.broken.length),
    t=>t.response=null,
    t=>t.study='canopy',
    t=>delete t.press,
    t=>t.press.settings=null,
    t=>Object.freeze(t.response),
    t=>Object.freeze(t.press.settings),
    t=>t.strains=new Float32Array(t.positions.buffer,0,t.strains.length),
  ];
  for(const corrupt of corruptions) {
    const target=s.createSnapshotTarget();corrupt(target);const before=structuredClone(target);
    assert.throws(()=>s.snapshotInto(target),RangeError);assert.deepEqual(target,before);
  }
  assert.throws(()=>s.snapshotInto(null),RangeError);
  const canopy=new FailureSimulation('canopy'),target=canopy.createSnapshotTarget();target.press={};
  assert.throws(()=>canopy.snapshotInto(target),RangeError);
});

test('packed topology identity survives backward restore and distinguishes equal counts with different edges',()=>{
  const s=new FailureSimulation('canopy'),initial=s.exportCheckpoint(),target=s.createSnapshotTarget();
  const pristine=target.topologyIdentity;
  const oneEdge=jsonCopy(initial);oneEdge.links[0].broken=true;oneEdge.links[0].damage=1;
  oneEdge.state.brokenCount=oneEdge.state.topologyVersion=1;
  s.restoreCheckpoint(oneEdge);s.snapshotInto(target);const first=target.topologyIdentity;
  assert.notEqual(first,pristine);assert.equal(target.broken[0],1);assert.equal(target.topologyVersion,1);
  const otherEdge=jsonCopy(initial);otherEdge.links[1].broken=true;otherEdge.links[1].damage=1;
  otherEdge.state.brokenCount=otherEdge.state.topologyVersion=1;
  s.restoreCheckpoint(otherEdge);s.snapshotInto(target);
  assert.notEqual(target.topologyIdentity,first);assert.equal(target.broken[0],0);assert.equal(target.broken[1],1);
  const lastEdge=jsonCopy(initial);lastEdge.links.at(-1).broken=true;lastEdge.links.at(-1).damage=1;
  lastEdge.state.brokenCount=lastEdge.state.topologyVersion=1;
  const second=target.topologyIdentity;s.restoreCheckpoint(lastEdge);s.snapshotInto(target);
  assert.notEqual(target.topologyIdentity,first);assert.notEqual(target.topologyIdentity,second);assert.equal(target.broken.at(-1),1);
  s.restoreCheckpoint(initial);s.snapshotInto(target);
  assert.equal(target.topologyIdentity,pristine);assert.equal(target.topologyVersion,0);assert.ok(target.broken.every(b=>b===0));
  assert.equal(s.snapshot().topologyIdentity,pristine);
});

for(const [id,cut] of [['canopy',600],['plate',480],['bridge',720]]) {
  test(`${id}: JSON checkpoint in active failure resumes full precision state and events exactly`,()=>{
    const continuous=new FailureSimulation(id);continuous.targetLoad=4;run(continuous,cut);
    assert.ok(continuous.brokenCount>0,`${id} checkpoint must be after physical rupture`);
    const c=jsonCopy(continuous.exportCheckpoint());
    assert.equal(c.version,STUDIO_CHECKPOINT_VERSION);assert.equal(c.backend,STUDIO_CHECKPOINT_BACKEND);
    if(id==='plate'){assert.ok(c.state.yieldedCount>0);assert.ok(c.state.contactCount>0);}
    const resumed=FailureSimulation.fromCheckpoint(c);
    const receiver=run(new FailureSimulation(id),8),nodes=receiver.nodes,links=receiver.links,events=receiver.events,press=receiver.press;
    receiver.restoreCheckpoint(c);
    assert.equal(receiver.nodes,nodes);assert.equal(receiver.links,links);assert.equal(receiver.events,events);assert.equal(receiver.press,press);
    assert.deepEqual(resumed.exportCheckpoint(),c);assert.deepEqual(receiver.exportCheckpoint(),c);
    // Vary load controls after resuming to exercise previous positions, damage and irreversible failure.
    for(const s of [continuous,resumed,receiver]){s.wind=.7;s.damping=.03;s.strength=1.15;run(s,90);s.targetLoad=0;run(s,150);}
    assert.deepEqual(resumed.exportCheckpoint(),continuous.exportCheckpoint());
    assert.deepEqual(receiver.exportCheckpoint(),continuous.exportCheckpoint());
    assert.deepEqual(resumed.snapshot(),continuous.snapshot());
    assert.deepEqual(resumed.activeIndices(),continuous.activeIndices());
    // Neither export nor restore leaves caller-owned aliases into the simulation.
    c.nodes[0].p[0]+=10;c.nodes[1].prev[1]-=3;c.nodes[2].rest[2]+=2;
    c.links[0].damage=.123;c.press.pressure=3;c.events[0].message='changed';
    assert.deepEqual(resumed.exportCheckpoint(),continuous.exportCheckpoint());
  });
}

test('checkpoint restores nondefault particle rest, history, mass and all mutable press controls',()=>{
  const source=run(new FailureSimulation('plate',{metal:'copper',thickness:1.5}),12);
  const n=source.nodes[200];n.rest[0]+=.012345678901234;n.p[1]-=.000123456789012;n.prev[2]+=.000987654321098;n.inverseMass*=.8;
  Object.assign(source.press,{metal:'brass',thickness:2.5,tool:'wedge',toolScale:1.15,angle:37,pressure:42,strikeSpeed:150,stroke:85,hold:3.25});
  const c=jsonCopy(source.exportCheckpoint()),restored=FailureSimulation.fromCheckpoint(c);
  assert.deepEqual(restored.exportCheckpoint(),c);
  assert.deepEqual(restored.nodes[200],source.nodes[200]);
  assert.notEqual(restored.nodes[200].rest,source.nodes[200].rest);
  assert.notEqual(restored.nodes[200].prev,source.nodes[200].prev);
  run(source,12);run(restored,12);assert.deepEqual(restored.exportCheckpoint(),source.exportCheckpoint());
});

test('checkpoint retains mutable press settings, internal hold time and retraction through completion',()=>{
  const continuous=new FailureSimulation('plate',{thickness:.5,stroke:20,hold:.5,strikeSpeed:250});
  continuous.targetLoad=4;let steps=0;
  while(continuous.pressCycle!=='Holding'&&steps++<1200)continuous.step();
  assert.equal(continuous.pressCycle,'Holding');run(continuous,12);
  const c=jsonCopy(continuous.exportCheckpoint());assert.ok(c.state.holdElapsed>.05);
  const resumed=FailureSimulation.fromCheckpoint(c);
  let retractionCheckpoint;
  for(let i=0;i<1200&&continuous.pressCycle!=='Complete';i++) {
    continuous.step();resumed.step();
    if(!retractionCheckpoint&&continuous.pressCycle==='Retracting')retractionCheckpoint=jsonCopy(continuous.exportCheckpoint());
  }
  assert.equal(continuous.pressCycle,'Complete');assert.ok(retractionCheckpoint);
  assert.deepEqual(resumed.exportCheckpoint(),continuous.exportCheckpoint());
  const retracted=FailureSimulation.fromCheckpoint(retractionCheckpoint);
  while(retracted.time<continuous.time)retracted.step();
  assert.deepEqual(retracted.exportCheckpoint(),continuous.exportCheckpoint());
  const exported=resumed.exportCheckpoint();resumed.press.tool='ring';resumed.press.angle=30;resumed.press.pressure=20;
  assert.notDeepEqual(resumed.press,exported.press);
  resumed.restoreCheckpoint(exported);assert.deepEqual(resumed.exportCheckpoint(),exported);
});

test('checkpoint corruption and incompatible late scene entries never partially mutate a receiver',()=>{
  const source=new FailureSimulation('plate');source.targetLoad=4;run(source,420);
  const checkpoint=source.exportCheckpoint(),receiver=run(new FailureSimulation('plate'),12);
  const before=receiver.exportCheckpoint(),snapshotBefore=receiver.snapshot();
  const corruptions=[
    c=>c.version++,c=>c.backend='different-backend',c=>c.study='bridge',c=>c.scene.identity+='changed',
    c=>c.scene.constructionPress.thickness=12,c=>c.press.hold=Infinity,c=>c.controls.targetLoad=NaN,
    c=>c.nodes.at(-1).prev[2]=Infinity,c=>c.nodes.at(-1).rest[1]=NaN,c=>c.nodes.pop(),
    c=>c.links.at(-1).rest=0,c=>c.links.at(-1).damage=2,c=>c.links.at(-1).broken=1,
    c=>c.links.at(-1).threshold*=1.1,c=>c.links.at(-1).dependencies.push(0),
    c=>c.faces.at(-1).nodes[0]=(c.faces.at(-1).nodes[0]+1)%c.nodes.length,c=>c.supports.pop(),
    c=>c.state.brokenCount++,c=>c.state.topologyVersion++,c=>c.state.contactCount=-1,
    c=>c.state.pressCycle='Unknown',c=>c.state.firstYield=false,c=>c.events.at(-1).time=c.state.time+1,
  ];
  for(const corrupt of corruptions) {
    const c=structuredClone(checkpoint);corrupt(c);
    assert.throws(()=>receiver.restoreCheckpoint(c),RangeError);
    assert.deepEqual(receiver.exportCheckpoint(),before);assert.deepEqual(receiver.snapshot(),snapshotBefore);
  }
  for(const value of [null,{},[],()=>0])assert.throws(()=>receiver.restoreCheckpoint(value),RangeError);
  assert.deepEqual(receiver.exportCheckpoint(),before);
  assert.throws(()=>new FailureSimulation('canopy').restoreCheckpoint(checkpoint),RangeError);
  assert.throws(()=>new FailureSimulation('plate',{thickness:12}).restoreCheckpoint(checkpoint),RangeError);
  assert.throws(()=>new FailureSimulation('plate',{metal:'copper'}).restoreCheckpoint(checkpoint),RangeError);
});

// Opt-in microbenchmark; normal regression runs have no speed threshold or filesystem artifacts.
// STUDIO_STATE_BENCH=1 node --expose-gc tests/engine/studio-state.test.mjs
if(process.env.STUDIO_STATE_BENCH==='1') {
  const directory=mkdtempSync(join(tmpdir(),'studio-state-baseline-'));
  const archive=fileURLToPath(new URL('../../benchmarks/baselines/engine-100x-20260910-source.tar.gz',import.meta.url));
  try {
    execFileSync('tar',['-xzf',archive,'-C',directory,'src/studio/physics.ts','src/studio/press-settings.ts']);
    const {FailureSimulation:Baseline}=await import(pathToFileURL(join(directory,'src/studio/physics.ts')).href);
    const rows=[],iterations=2000,repeats=7;
    const median=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
    let checksum=0;
    for(const id of ['canopy','plate','bridge']) {
      const baseline=run(new Baseline(id),30),candidate=run(new FailureSimulation(id),30),target=candidate.createSnapshotTarget();
      compareRenderValues(baseline.snapshot(),target);
      for(let i=0;i<500;i++){baseline.snapshot();candidate.snapshotInto(target);}
      const before=[],after=[];
      const measure=fn=>{global.gc?.();const start=performance.now();for(let i=0;i<iterations;i++)checksum+=fn().positions[0];return(performance.now()-start)/iterations;};
      for(let repeat=0;repeat<repeats;repeat++) {
        if(repeat%2){after.push(measure(()=>candidate.snapshotInto(target)));before.push(measure(()=>baseline.snapshot()));}
        else {before.push(measure(()=>baseline.snapshot()));after.push(measure(()=>candidate.snapshotInto(target)));}
      }
      compareRenderValues(baseline.snapshot(),candidate.snapshotInto(target));
      rows.push({study:id,nodes:candidate.nodes.length,links:candidate.links.length,iterations,repeats,
        baselineMedianMs:median(before),snapshotIntoMedianMs:median(after),speedup:median(before)/median(after),baselineMs:before,snapshotIntoMs:after});
    }
    assert.ok(Number.isFinite(checksum));
    console.log('STUDIO_SNAPSHOT_BENCHMARK '+JSON.stringify({node:process.version,platform:process.platform,arch:process.arch,
      archiveSha256:createHash('sha256').update(readFileSync(archive)).digest('hex'),
      baselineSourceSha256:createHash('sha256').update(readFileSync(join(directory,'src/studio/physics.ts'))).digest('hex'),
      candidateSourceSha256:createHash('sha256').update(readFileSync(new URL('../../src/studio/physics.ts',import.meta.url))).digest('hex'),rows}));
  } finally { rmSync(directory,{recursive:true,force:true}); }
}
