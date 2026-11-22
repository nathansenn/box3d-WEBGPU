import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync,statSync} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {DynamicResolution,HARDWARE_FLOOR,SOFTWARE_FLOOR,RESOLUTION_STEP,resolutionQuery,isSoftwareAdapter} from '../../src/perf/dynamic-resolution.ts';

const feed=(controller,ms,count)=>{const ratios=[];for(let i=0;i<count;i++){controller.sample(typeof ms==='function'?ms(controller.ratio,i):ms);ratios.push(controller.ratio);}return ratios;};
/** A frame whose cost is proportional to the pixel count (ratio squared): `full` ms at ratio 1. */
const pixelBound=full=>ratio=>full*ratio*ratio;
const onGrid=value=>Math.abs(value/RESOLUTION_STEP-Math.round(value/RESOLUTION_STEP))<1e-9;

test('a fixed ratio or a disabled controller never changes',()=>{
  const fixed=new DynamicResolution({ceiling:2,fixed:.7});
  assert.equal(fixed.adaptive,false);assert.equal(fixed.ratio,.7);
  feed(fixed,500,200);assert.equal(fixed.ratio,.7);assert.equal(fixed.changes,0);
  const off=new DynamicResolution({ceiling:1.25,enabled:false,software:true});
  feed(off,500,200);assert.equal(off.ratio,1.25);
});

test('a hardware adapter that misses its target steps down to the floor and never below it',()=>{
  const c=new DynamicResolution({ceiling:2});assert.equal(c.ratio,2);
  const ratios=feed(c,80,400);
  assert.equal(c.ratio,HARDWARE_FLOOR);assert.ok(ratios.every(r=>r>=HARDWARE_FLOOR-1e-12&&r<=2+1e-12));
  assert.ok(ratios.every(onGrid),'ratios stay on the 0.05 grid');
});

test('a pixel-bound load settles near the ratio that holds the target, without oscillating',()=>{
  // 40 ms at ratio 1.5 (≈ 17.8 ms per unit ratio²): the 14 ms target is held near ratio 0.89.
  const cost=pixelBound(40/1.5**2),c=new DynamicResolution({ceiling:1.5});
  const ratios=feed(c,cost,6000),tail=ratios.slice(-2000);
  const settled=tail.at(-1);
  assert.ok(cost(settled)<=14*1.2+1e-9,`settled ratio ${settled} costs ${cost(settled).toFixed(1)} ms`);
  assert.ok(settled>=.7,`settled ratio ${settled} is not far below what holds the target`);
  assert.ok(new Set(tail).size<=2,'at most one probe step in the last 2000 frames');
  assert.ok(c.changes<=12,`${c.changes} changes`);
});

test('light frames climb back to the ceiling one step at a time',()=>{
  const c=new DynamicResolution({ceiling:1.25});feed(c,80,100);assert.equal(c.ratio,HARDWARE_FLOOR);
  const ratios=feed(c,2,4000);
  assert.equal(c.ratio,1.25);
  for(let i=1;i<ratios.length;i++)assert.ok(ratios[i]-ratios[i-1]<=RESOLUTION_STEP+1e-9,'upward steps are single');
});

test('a software adapter starts at the hardware floor and may go to the software floor only',()=>{
  const c=new DynamicResolution({ceiling:1.25,software:true});
  assert.equal(c.ratio,HARDWARE_FLOOR);assert.equal(c.floor,SOFTWARE_FLOOR);
  feed(c,3000,200);assert.equal(c.ratio,SOFTWARE_FLOOR);
  const low=new DynamicResolution({ceiling:.4,software:true});assert.equal(low.ratio,.4);
  const hw=new DynamicResolution({ceiling:1.25});feed(hw,3000,200);assert.equal(hw.ratio,HARDWARE_FLOOR);
});

test('presented-frame intervals: vsync-locked frames climb, missed frames step down',()=>{
  const c=new DynamicResolution({ceiling:1.5,source:'interval'});
  feed(c,33.3,40);assert.ok(c.ratio<1.5,'two-vsync frames lower the ratio');
  const lowered=c.ratio;feed(c,16.7,2000);assert.ok(c.ratio>lowered,'one-vsync frames raise it again');
});

test('the controller is deterministic',()=>{
  const sequence=(ratio,i)=>20+15*Math.sin(i*.37)+ratio*10;
  const a=feed(new DynamicResolution({ceiling:2}),sequence,3000),b=feed(new DynamicResolution({ceiling:2}),sequence,3000);
  assert.deepEqual(a,b);
});

test('query switches and software adapter detection',()=>{
  assert.deepEqual(resolutionQuery('?resolution=0.5'),{fixed:.5,enabled:true});
  assert.deepEqual(resolutionQuery('?adaptive=0'),{fixed:null,enabled:false});
  assert.deepEqual(resolutionQuery('?resolution=abc&adaptive=1'),{fixed:null,enabled:true});
  assert.deepEqual(resolutionQuery(''),{fixed:null,enabled:true});
  assert.equal(isSoftwareAdapter({vendor:'google',architecture:'swiftshader',description:''}),true);
  assert.equal(isSoftwareAdapter({vendor:'nvidia',architecture:'ampere'}),false);
  assert.equal(isSoftwareAdapter({vendor:'apple',architecture:'metal-3',isFallbackAdapter:true}),true);
  assert.equal(isSoftwareAdapter(null,'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'),true);
  assert.equal(isSoftwareAdapter(null,'ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'),false);
  assert.equal(isSoftwareAdapter(null,'llvmpipe (LLVM 15.0.7, 256 bits)'),true);
});

test('no solver reads the render resolution: physics results cannot depend on it',()=>{
  const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
  const files=[];const walk=dir=>{for(const name of readdirSync(dir)){const file=path.join(dir,name);if(statSync(file).isDirectory())walk(file);else if(/\.(ts|mjs|js)$/.test(name)&&!/probe\.ts$/.test(name))files.push(file);}};
  // The engine's probe pages (frame-probe, cable-probe, probe) draw; every other engine file is a solver.
  walk(path.join(root,'src/engine'));walk(path.join(root,'src/soft'));
  for(const name of readdirSync(path.join(root,'src/studio')))if(/(physics|-si|packed-physics)\.ts$/.test(name))files.push(path.join(root,'src/studio',name));
  for(const name of readdirSync(path.join(root,'src/studio/material-labs')))if(/(-si|models|lab-run|worker)\.ts$/.test(name))files.push(path.join(root,'src/studio/material-labs',name));
  assert.ok(files.length>50,`${files.length} solver files`);
  for(const file of files){const text=readFileSync(file,'utf8');assert.ok(!/dynamic-resolution|devicePixelRatio|renderRatio|resolutionScale/.test(text),path.relative(root,file));}
});
