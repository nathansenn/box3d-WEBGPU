import assert from 'node:assert/strict';
import test from 'node:test';
import {rayBox,sphereBox,boxBox} from '../../scripts/native-query-oracle.mjs';
const box={token:131073n,center:[0,0,0],halfExtents:[.5,.5,.5],axes:[[1,0,0],[0,1,0],[0,0,1]]};

test('the oracle resolves overlap slop at corners using Euclidean distance rather than expanded axes',()=>{
  const q={origin:[1.0004,1.0004,0],halfExtents:[.5,.5,.5]};
  assert.equal(boxBox(q,box,.0005),false,'two 0.0004 gaps have Euclidean separation > 0.0005');
  assert.equal(boxBox({...q,origin:[1.0003,1.0003,0]},box,.0005),true);
  assert.equal(boxBox({...q,origin:[1.0004,0,0]},box,0),false);
  assert.equal(boxBox({...q,origin:[1.0004,0,0]},box,.0005),true);
  assert.equal(sphereBox({origin:[1.0004,0,0],radius:.5},box,.0005),true);
  assert.equal(sphereBox({origin:[1.0006,0,0],radius:.5},box,.0005),false);
});

test('edge normals include only entering incident faces within the declared point envelope',()=>{
  const q={origin:[-2,2,0],translation:[3,-3,0]},hit=rayBox(q,box,3e-4);
  assert.equal(hit.fraction,.5);assert.deepEqual(hit.point,[-.5,.5,0]);assert.equal(hit.normals.length,2);
  assert.ok(hit.normals.some(n=>n[0]===-1&&n[1]===0&&n[2]===0));assert.ok(hit.normals.some(n=>n[0]===0&&n[1]===1&&n[2]===0));
  assert.equal(rayBox({...q,translation:[3,-2,0]},box,3e-4).normals.length,1);
  assert.deepEqual(rayBox({origin:[0,0,0],translation:[1,0,0]},box).normal,[0,0,0]);
  assert.equal(rayBox({origin:[-2,2,0],translation:[1,0,0]},box),null);
});
