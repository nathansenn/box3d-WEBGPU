import assert from 'node:assert/strict';
import test from 'node:test';
import {alignedMipPrefix} from '../../src/assets/ktx2.ts';

const astc6={blockWidth:6,blockHeight:6};
const chain=(...w)=>w.map(width=>({width,height:width}));
test('keeps only the consecutive block-aligned prefix, no re-admission after a gap', () => {
  // 54 and 18 are aligned, 9 is not, 6 is aligned again: the old filter kept 54,18,6 and shifted mip indexes.
  assert.deepEqual(alignedMipPrefix(chain(54,18,9,6),astc6).map(l=>l.width),[54,18]);
});
test('keeps a fully aligned chain and returns a copy', () => {
  const levels=chain(24,12,6);
  const out=alignedMipPrefix(levels,astc6);
  assert.deepEqual(out.map(l=>l.width),[24,12,6]);
  assert.notEqual(out,levels);
});
test('empty when the base level is misaligned', () => {
  assert.deepEqual(alignedMipPrefix(chain(25,12,6),astc6),[]);
});
