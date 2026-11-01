import assert from 'node:assert/strict';
import test from 'node:test';
import {quantizedHash} from '../../src/soft/quantized-hash.ts';
function legacy(values,scale,count=values.length,seed=2166136261){
  let hash=seed>>>0;const n=Math.min(count,values.length);
  for(let i=0;i<n;i++){const q=Math.trunc(values[i]*scale)|0;
    for(const sh of [0,8,16,24]){hash^=(q>>>sh)&0xff;hash=Math.imul(hash,16777619)>>>0;}}
  return hash>>>0;
}
test('bit-identical to the legacy hash on finite in-range state',()=>{
  let s=12345;const r=()=>((s=(s*1664525+1013904223)>>>0)/2**32-.5)*400;
  for(const scale of [1000,100000])for(let t=0;t<200;t++){
    const a=new Float32Array(64).map(r);
    assert.equal(quantizedHash(a,scale),legacy(a,scale));
    assert.equal(quantizedHash(a,scale,17),legacy(a,scale,17));
  }
});
test('NaN and overflow no longer collide with zero or each other',()=>{
  const h=v=>quantizedHash(new Float32Array([1,v,2]),1000);
  const set=new Set([h(0),h(NaN),h(1e30),h(-1e30)]);
  assert.equal(set.size,4);
});
