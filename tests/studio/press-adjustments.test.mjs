import assert from 'node:assert/strict';
import test from 'node:test';
import {pressAdjustments,DEFAULT_PRESS} from '../../src/studio/press-settings.ts';
test('clean settings report nothing',()=>assert.deepEqual(pressAdjustments(DEFAULT_PRESS),[]));
test('NaN, out-of-range and unknown ids are flagged',()=>{
  assert.deepEqual(pressAdjustments({pressure:NaN,thickness:99,metal:'unobtainium'}).sort(),['metal','pressure','thickness']);
});
