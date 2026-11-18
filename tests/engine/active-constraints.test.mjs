import assert from 'node:assert/strict';
import test from 'node:test';
import {FailureSimulation} from '../../src/studio/physics.ts';

test('broken constraints are excluded from every subsequent projection and checkpoints restore the active set',()=>{
  const simulation=new FailureSimulation('bridge'),intact=simulation.exportCheckpoint();
  const allBroken=structuredClone(intact);
  for(const link of allBroken.links){link.broken=true;link.damage=1;}
  allBroken.state.brokenCount=allBroken.state.topologyVersion=allBroken.links.length;
  simulation.restoreCheckpoint(allBroken);
  assert.equal(simulation.activeConstraintCount,0);
  let visits=0;
  const descriptors=simulation.links.map(link=>Object.getOwnPropertyDescriptor(link,'broken'));
  for(const link of simulation.links)Object.defineProperty(link,'broken',{get(){visits++;return true;},configurable:true});
  simulation.step();assert.equal(visits,0,'fully torn constraints must incur no recurring projection traversal');
  simulation.links.forEach((link,i)=>Object.defineProperty(link,'broken',descriptors[i]));
  simulation.restoreCheckpoint(intact);
  assert.equal(simulation.activeConstraintCount,simulation.links.length);
  assert.ok(simulation.links.every(link=>!link.broken),'live public views must observe restoration');
  const reference=FailureSimulation.fromCheckpoint(intact);
  simulation.step();reference.step();assert.deepEqual(simulation.exportCheckpoint(),reference.exportCheckpoint());
});

test('progressive failure keeps original IDs and compacts in deterministic order',()=>{
  const sim=new FailureSimulation('bridge');sim.targetLoad=4;sim.strength=.25;
  for(let i=0;i<720;i++)sim.step();
  assert.ok(sim.brokenCount>0);
  assert.equal(sim.activeConstraintCount,sim.links.length-sim.brokenCount);
  for(const event of sim.events)if(event.type==='break')assert.equal(sim.links[event.connection].broken,true);
  const checkpoint=sim.exportCheckpoint(),resumed=FailureSimulation.fromCheckpoint(checkpoint);
  for(let i=0;i<120;i++){sim.step();resumed.step();}
  assert.deepEqual(sim.exportCheckpoint(),resumed.exportCheckpoint());
});
