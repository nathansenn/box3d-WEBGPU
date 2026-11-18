import {test} from 'node:test';
import assert from 'node:assert/strict';
import {exportRunFrames} from '../../src/studio/material-labs/run-export.ts';

const frame=(time=0)=>({time,positions:Float32Array.of(1,2,3),rotations:Float32Array.of(0,0,0),damage:Uint8Array.of(1),actuator:.5,phase:'Settling',metrics:[1,2,3],collisions:{impacts:1,contacts:4,sweptContacts:5,unresolvedSweeps:0}});
const jsonFrame=value=>({...value,positions:[...value.positions],rotations:[...value.rotations],damage:[...value.damage]});

test('export includes a paused collision endpoint received after the last history sample',()=>{
  const history=[frame(0),frame(.06)],current=frame(.075);current.positions[1]=.125;current.collisions.contacts=7;
  const result=exportRunFrames(history,current);
  assert.deepEqual(result.map(f=>f.time),[0,.06,.075]);assert.deepEqual(result.at(-1),jsonFrame(current));
  assert.equal(history.length,2);assert.equal(history.at(-1).collisions.contacts,4);
});
test('an already sampled endpoint is refreshed without duplicating completion or initial time',()=>{
  const history=[frame(0),frame(12)],current=frame(12);current.collisions.contacts=8;
  assert.deepEqual(exportRunFrames(history,current).map(f=>f.time),[0,12]);
  assert.equal(exportRunFrames(history,current).at(-1).collisions.contacts,8);
  assert.equal(exportRunFrames([frame()],frame()).length,1);
  assert.equal(exportRunFrames([],frame()).length,1);
});
test('exported buffers, collision metadata and hydraulic measurements do not alias live or replay state',()=>{
  const historical=frame(1),current=frame(2);historical.hydraulics={added:2,supplyOn:false};current.hydraulics={added:3,supplyOn:true};
  const result=exportRunFrames([historical],current),before=structuredClone(result);
  for(const source of [historical,current]){source.positions.fill(99);source.rotations.fill(99);source.damage.fill(99);source.metrics[0]=99;source.collisions.contacts=99;source.hydraulics.added=99;}
  assert.deepEqual(result,before);
  result[0].positions[0]=-8;result[1].metrics[1]=-8;assert.equal(historical.positions[0],99);assert.equal(current.metrics[1],2);
});
test('JSON keeps the existing exported frame schema and final metrics',()=>{
  const current=frame(.125),result=exportRunFrames([frame()],current),parsed=JSON.parse(JSON.stringify(result));
  assert.deepEqual(parsed.at(-1),jsonFrame(current));assert.ok(Array.isArray(parsed[0].positions));
  assert.deepEqual(Object.keys(parsed.at(-1)),Object.keys(jsonFrame(current)));
});
