import assert from 'node:assert/strict';
import test from 'node:test';
import {clampWasmSubSteps,MAX_WASM_STEP_DT} from '../../src/physics/step-bounds.ts';
test('substeps clamp to an integer in 1..16',()=>{
  for(const [i,o] of [[0,1],[-3,1],[1.9,1],[4,4],[99,16],[NaN,1],[Infinity,1]])assert.equal(clampWasmSubSteps(i),o);
});
test('max dt is 1/30',()=>assert.equal(MAX_WASM_STEP_DT,1/30));
import {finiteBounded} from '../../src/physics/step-bounds.ts';
test('hostile launch/kick inputs are rejected',()=>{
  assert.equal(finiteBounded(1,2,3),true);
  for(const bad of [NaN,Infinity,-Infinity,1e30,-1e7])assert.equal(finiteBounded(1,bad),false);
});
