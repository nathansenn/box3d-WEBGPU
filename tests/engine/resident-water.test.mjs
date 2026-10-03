import assert from 'node:assert/strict';
import test from 'node:test';
import {ResidentWaterSurface} from '../../src/webgpu/resident-water-surface.ts';
globalThis.GPUBufferUsage={INDEX:16,COPY_DST:8,UNIFORM:64};
function fixture(cols=9,rows=7) {
  const buffers=[],writes=[];let bindings=0,parity=0;
  const device={createBuffer(d){const b={d,destroyed:0,destroy(){this.destroyed++;}};buffers.push(b);return b;},queue:{writeBuffer(buffer,offset,data){writes.push({buffer,data:data.slice(0)});}},createBindGroup(d){bindings++;return d;}};
  const fields=[{eta:{},u:{},v:{}},{eta:{},u:{},v:{}}];
  const owner={alive:true,device,config:{cols,rows,dx:.5,dz:.5},getFields(){if(!this.alive)throw new Error('destroyed');return fields[parity];}};
  return {device,owner,buffers,writes,setParity(p){parity=p;},bindingCount:()=>bindings};
}
test('resident water reuses both ping-pong bindings and destroys only its own presentation resources',()=>{
  const f=fixture(),surface=new ResidentWaterSurface(f.owner,f.device,{});
  assert.equal(surface.renderVertexCount,63);assert.equal(surface.indexCount,8*6*6);
  const original=surface.bindGroup();assert.equal(f.bindingCount(),1);f.setParity(1);const other=surface.bindGroup();
  assert.notEqual(original,other);f.setParity(0);assert.equal(surface.bindGroup(),original);assert.equal(f.bindingCount(),2);
  surface.dispose();surface.dispose();assert.equal(f.owner.alive,true);assert.ok(f.buffers.every(b=>b.destroyed===1));assert.throws(()=>surface.bindGroup(),/disposed/);
});
test('large numerical fields require explicit render stride and retain uint32 source indices',()=>{
  const f=fixture(512,512);
  assert.throws(()=>new ResidentWaterSurface(f.owner,f.device,{}),/renderStride/);assert.equal(f.buffers.length,0);
  const surface=new ResidentWaterSurface(f.owner,f.device,{}, {renderStride:8});
  assert.equal(surface.renderVertexCount,65*65);
  const indices=new Uint32Array(f.writes[0].data);assert.equal(Math.max(...indices),512*512-1);
  assert.ok(indices.some(i=>i>65535));f.owner.alive=false;assert.throws(()=>surface.bindGroup(),/destroyed/);surface.dispose();
  assert.throws(()=>new ResidentWaterSurface(f.owner,{},{}),/live solver/);
});
