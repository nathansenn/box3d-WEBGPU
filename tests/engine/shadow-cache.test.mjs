import assert from 'node:assert/strict';
import test from 'node:test';
import {ShadowPassCache} from '../../src/webgpu/shadow-cache.ts';

test('static shadows reuse their map while camera presentation and time change',()=>{
  const cache=new ShadowPassCache(),uniforms=new Float32Array(52);uniforms[16]=1;
  assert.equal(cache.needsRender(uniforms,12,6,'gpu-cloth'),true);
  cache.submitted(uniforms,12,6,'gpu-cloth');
  for(let i=0;i<120;i++){uniforms[0]=i;uniforms[35]=i;assert.equal(cache.needsRender(uniforms,12,6,'gpu-cloth'),false);}
  assert.equal(cache.rendered,1);assert.equal(cache.reused,120);
  uniforms[18]=.001;assert.equal(cache.needsRender(uniforms,12,6,'gpu-cloth'),true);
});
test('caster mutation, removal, topology, light, resolution and failed submissions invalidate reuse',()=>{
  const cache=new ShadowPassCache(),u=new Float32Array(52);
  cache.submitted(u,10,12,'packed');
  for(const args of [[9,12,'packed'],[10,6,'packed'],[10,12,'gpu-cloth'],[0,0,null]])assert.equal(cache.needsRender(u,...args),true);
  cache.invalidate();assert.equal(cache.needsRender(u,10,12,'packed'),true);
  assert.equal(cache.needsRender(u,10,12,'packed'),true,'an unsubmitted frame must not populate the cache');
  cache.submitted(u,10,12,'packed');assert.equal(cache.needsRender(u,10,12,'packed'),false);
  cache.submitted(u,0,0,null);assert.equal(cache.needsRender(u,0,0,null),false,'empty scene stores a cleared map');
});
