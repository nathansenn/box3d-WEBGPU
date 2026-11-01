import assert from 'node:assert/strict';
import {test} from 'node:test';
import {FixedFrameClock,StageTimings} from '../../src/perf/frame-clock.ts';
import {interpolateSnapshotInto,copySnapshotInto} from '../../src/studio/presentation-state.ts';
import {FailureSimulation} from '../../src/studio/physics.ts';
import {RecordingRing} from '../../src/perf/recording-ring.ts';
test('display rates preserve contiguous fixed tick counts',()=>{
  for(const rate of [60,120,144]){const clock=new FixedFrameClock(1/120,12);let steps=0;for(let frame=0;frame<=rate;frame++){clock.advance(frame*1000/rate);steps+=clock.takeSteps();}assert.equal(steps,120);assert.equal(clock.overloads,0);}
});
test('overload bounds backlog and reports wall-time lag without skipping ticks',()=>{
  const clock=new FixedFrameClock(1/120,12);clock.advance(0);clock.advance(1000);assert.equal(clock.takeSteps(),12);assert.ok(Math.abs(clock.lagSeconds-.9)<1e-10);assert.equal(clock.overloads,1);
  clock.advance(2000,1,false);assert.equal(clock.takeSteps(),0);clock.reset();clock.advance(30000);assert.equal(clock.takeSteps(),0);
  assert.ok(clock.lagSeconds>0);clock.reset(true);assert.equal(clock.lagSeconds,0);assert.equal(clock.overloads,0);
});
test('timing histories stay bounded and unavailable is distinct from zero',()=>{
  const stats=new StageTimings(['step','gpu'],3);assert.equal(stats.inspect().gpu.p50,null);
  for(const value of [100,1,2,3])stats.sample('step',value);
  assert.deepEqual(stats.inspect().step,{count:3,p50:2,p95:3,p99:3});assert.throws(()=>stats.sample('unknown',1));
});
test('recording ring preserves initial state and chronological recent samples through rollover',()=>{
  const ring=new RecordingRing({time:0},4),retained=ring.at(0);
  for(let time=1;time<=10000;time++)ring.push({time});
  assert.equal(ring.length,4);assert.equal(ring.evicted,9997);assert.equal(ring.at(0),retained);
  assert.deepEqual(ring.map(sample=>sample.time),[0,9998,9999,10000]);assert.equal(ring.at(-1).time,10000);
  assert.equal(ring.at(4),undefined);assert.equal(ring.at(-5),undefined);
});
test('interpolation does not bridge a fracture, reset, or mutate recorded frames',()=>{
  const sim=new FailureSimulation('bridge'),previous=sim.snapshot(),current=sim.snapshot(),target=sim.createSnapshotTarget();
  current.positions[0]+=2;current.response.time=1/120;
  interpolateSnapshotInto(target,previous,current,.5);assert.equal(target.positions[0],previous.positions[0]+1);assert.equal(current.positions[0],previous.positions[0]+2);
  current.topologyIdentity='fractured';interpolateSnapshotInto(target,previous,current,.5);assert.equal(target.positions[0],current.positions[0]);
  current.topologyIdentity=previous.topologyIdentity;current.response.time=0;interpolateSnapshotInto(target,previous,current,.5);assert.equal(target.positions[0],current.positions[0]);
  const positionBuffer=target.positions;copySnapshotInto(target,current);assert.equal(target.positions,positionBuffer);
});
