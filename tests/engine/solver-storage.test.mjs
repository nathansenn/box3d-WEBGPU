import assert from 'node:assert/strict';
import test from 'node:test';
import {PackedFailureSimulation as FailureSimulation} from '../../src/studio/packed-physics.ts';
import {FailureSimulation as BeforePacking} from '../../benchmarks/baselines/studio-before-typed-arrays-20260910/source/src/studio/physics.ts';

for(const study of ['canopy','plate','bridge']) {
  test(`${study}: stepping, snapshots and checkpoint restore never materialize compatibility objects`,()=>{
    const sim=new FailureSimulation(study),nodeCount=sim.nodeCount,linkCount=sim.linkCount;
    for(const name of ['nodes','links'])Object.defineProperty(sim,name,{get(){assert.fail(`hot path requested ${name} objects`);}});
    const target=sim.createSnapshotTarget();
    for(let i=0;i<20;i++){sim.step();sim.snapshotInto(target);sim.response();sim.activeIndices();}
    const checkpoint=sim.exportCheckpoint();
    assert.equal(checkpoint.nodes.length,nodeCount);assert.equal(checkpoint.links.length,linkCount);
    sim.step();sim.restoreCheckpoint(checkpoint);
    assert.deepEqual(sim.exportCheckpoint(),checkpoint);
  });

  test(`${study}: edited full precision views and resumed trajectories match the preceding object solver exactly`,()=>{
    const actual=new FailureSimulation(study),reference=new BeforePacking(study);
    const nodeIndex=study==='bridge'?64:200;
    for(const sim of [actual,reference]) {
      const n=sim.nodes[nodeIndex],e=sim.links[25];
      n.p[0]+=.012345678901234;n.prev[2]-=.001987654321098;n.rest[1]+=.000000000000037;
      n.inverseMass*=.812345678901234;
      e.rest*=1.000123456789012;e.damage=.001234567890123;
      sim.wind=.63;sim.damping=.031;sim.strength=.82;sim.targetLoad=3.4;
    }
    const node=actual.nodes[nodeIndex],position=node.p,link=actual.links[25];
    assert.ok(Array.isArray(position));assert.deepEqual(actual.nodes,reference.nodes);assert.deepEqual(actual.links,reference.links);
    assert.deepEqual(JSON.parse(JSON.stringify(actual.nodes)),JSON.parse(JSON.stringify(reference.nodes)));
    assert.deepEqual(structuredClone(actual.links),structuredClone(reference.links));
    for(let i=0;i<120;i++) {
      if(i===70)actual.targetLoad=reference.targetLoad=0;
      actual.step();reference.step();
    }
    assert.deepEqual(actual.exportCheckpoint(),reference.exportCheckpoint());
    const saved=reference.exportCheckpoint();actual.step();actual.restoreCheckpoint(saved);
    assert.equal(actual.nodes[nodeIndex],node);assert.equal(node.p,position);assert.equal(actual.links[25],link);
    assert.deepEqual(actual.nodes,reference.nodes);assert.deepEqual(actual.links,reference.links);
    const restored=FailureSimulation.fromCheckpoint(JSON.parse(JSON.stringify(saved)));
    for(let i=0;i<30;i++){actual.step();reference.step();restored.step();}
    assert.deepEqual(actual.exportCheckpoint(),reference.exportCheckpoint());
    assert.deepEqual(restored.exportCheckpoint(),reference.exportCheckpoint());
  });
}

test('vector and dependency assignments remain live without replacing retained views',()=>{
  const sim=new FailureSimulation('canopy'),node=sim.nodes[200],p=node.p;
  node.p=[1.123456789012345,2.234567890123456,3.345678901234567];
  assert.equal(node.p,p);assert.deepEqual(p,[1.123456789012345,2.234567890123456,3.345678901234567]);
  const link=sim.links.find(e=>e.dependencies.length===2),index=sim.links.indexOf(link);
  link.dependencies=[-1,8];link.dependencies.push(9);
  assert.deepEqual(sim.exportCheckpoint().links[index].dependencies,[-1,8,9]);
  assert.deepEqual(sim.exportCheckpoint().nodes[200].p,p);
});
