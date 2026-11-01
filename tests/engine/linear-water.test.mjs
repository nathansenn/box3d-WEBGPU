import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import test from 'node:test';
import {createLinearWaterArrays,stepLinearWaterCpu,validateLinearWaterConfig} from '../../src/engine/linear-water.ts';

const frozen=execFileSync('tar',['-xOf','benchmarks/baselines/engine-100x-20260910-source.tar.gz','src/soft/simulations.ts'],{maxBuffer:1024*1024}).toString();
const method=frozen.slice(frozen.indexOf('  private solveShallowWater(dt: number): void {')+'  private solveShallowWater(dt: number): void {'.length,frozen.indexOf('\n  private disturb(',frozen.indexOf('  private solveShallowWater(dt: number): void {'))).trim();
const referenceStep=new Function('dt',method.slice(0,-1));
const config={cols:9,rows:7,dt:1/240,gravity:9.81,meanDepth:1.5,drag:.28,dx:.6,dz:.5};
test('water CPU reference retains frozen equations, ping-pong history and boundary order exactly',()=>{
  for(const [cols,rows] of [[3,3],[5,17],[32,24]]) {
    const c={...config,cols,rows},initial=createLinearWaterArrays(c);
    for(const [field,values]of Object.entries(initial))for(let i=0;i<values.length;i++)values[i]=Math.sin(i*.7+field.length)*.15;
    const actual=createLinearWaterArrays(c,initial),reference={...createLinearWaterArrays(c,initial),cols,rows,gravityMagnitude:c.gravity,stress:3,mode:0,invTwoDx:1/(2*c.dx),invTwoDz:1/(2*c.dz)};
    for(let tick=0;tick<360;tick++){stepLinearWaterCpu(actual,c);referenceStep.call(reference,c.dt);}
    for(const key of Object.keys(actual))assert.deepEqual(actual[key],reference[key],`${cols}x${rows} ${key}`);
  }
});
test('water configuration rejects invalid grids, unstable steps and invalid state before allocation',()=>{
  for(const invalid of [{cols:2},{rows:1},{cols:4096,rows:4096},{dt:0},{dt:1},{drag:-1},{gravity:NaN},{meanDepth:-1},{dx:0},{dx:1e-5}])assert.throws(()=>validateLinearWaterConfig({...config,...invalid}),RangeError);
  assert.throws(()=>createLinearWaterArrays(config,{eta:new Float32Array(3)}),RangeError);
  const eta=new Float32Array(config.cols*config.rows);eta[0]=NaN;
  assert.throws(()=>createLinearWaterArrays(config,{eta}),RangeError);
});
