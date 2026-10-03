import '../../scripts/register-typescript.mjs';
import assert from 'node:assert/strict';
import {test} from 'node:test';
const {SurfaceTopology,gridBorderPairs,updateSurfaceNormals}=await import('../../src/studio/surface-topology.ts');
const {bridgeDeckFrames,DeckFrameStorage}=await import('../../src/studio/bridge-deck.ts');
const {updatePlateShell}=await import('../../src/studio/press-tooling.ts');
const T=await import('three/webgpu');
const faces=[{nodes:[0,2,1],links:[0]},{nodes:[1,2,3],links:[1]}];
test('intact motion does not rebuild topology; equal-count tears and backwards replay do',()=>{
  const topology=new SurfaceTopology(faces),buffer=topology.indices;
  assert.equal(topology.update(new Uint8Array([0,0]),'intact'),true);
  assert.equal(topology.count,6);assert.equal(topology.exposed.length,8);
  for(let i=0;i<100;i++)assert.equal(topology.update(new Uint8Array([0,0]),'intact'),false);
  assert.equal(topology.revision,1);assert.equal(topology.indices,buffer);
  topology.update(new Uint8Array([1,0]),'left');assert.deepEqual([...buffer.slice(0,topology.count)],[1,2,3]);
  topology.update(new Uint8Array([0,1]),'right');assert.deepEqual([...buffer.slice(0,topology.count)],[0,2,1]);
  topology.update(new Uint8Array([0,0]),'intact');assert.equal(topology.count,6);assert.equal(topology.revision,4);
});
test('surviving normals exclude stale faces beyond draw range and match Three for intact mesh',()=>{
  const positions=new Float32Array([0,0,0,1,0,0,0,0,1,1,2,1]);
  const indices=new Uint32Array([0,2,1,1,2,3]),normals=new Float32Array(12);
  const g=new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(positions,3));g.setIndex(new T.BufferAttribute(indices,1));g.computeVertexNormals();
  updateSurfaceNormals(positions,indices,6,normals);
  normals.forEach((x,i)=>assert.ok(Math.abs(x-g.attributes.normal.array[i])<1e-6));
  updateSurfaceNormals(positions,indices,3,normals);
  assert.deepEqual([...normals],[0,1,0,0,1,0,0,1,0,0,0,0]);g.dispose();
});
test('cached shell boundary is identical to uncached geometry after fracture',()=>{
  const positions=new Float32Array([0,0,0,1,0,0,0,.1,1,1,2,1]),topology=new SurfaceTopology(faces);
  for(const mask of [[0,0],[1,0],[0,1],[0,0]]){
    topology.update(Uint8Array.from(mask),mask.join(''));
    const create=()=>new T.BufferGeometry().setAttribute('position',new T.BufferAttribute(new Float32Array(600),3)).setAttribute('uv',new T.BufferAttribute(new Float32Array(400),2));
    const a=create(),b=create();
    updatePlateShell(a,positions,topology.indices,.12,topology.exposed,topology.count);
    updatePlateShell(b,positions,[...topology.indices.slice(0,topology.count)],.12);
    assert.equal(a.drawRange.count,b.drawRange.count);
    for(const key of ['position','normal','uv'])assert.deepEqual(a.attributes[key].array,b.attributes[key].array);
    a.dispose();b.dispose();
  }
});
test('perimeter pairs have no duplicates and reusable deck frames preserve reference transforms',()=>{
  const pairs=gridBorderPairs(4,3);assert.equal(pairs.length,20);assert.equal(new Set(Array.from({length:pairs.length/2},(_,i)=>[pairs[i*2],pairs[i*2+1]].sort((a,b)=>a-b).join(':'))).size,10);
  const positions=Float32Array.from(Array.from({length:5},(_,i)=>[i,.2*Math.sin(i),-1,i,.2*Math.sin(i)+.1,1,i,2,-1,i,2,1]).flat());
  const storage=new DeckFrameStorage(5),frames=bridgeDeckFrames(positions,5,storage);
  for(let i=0;i<5;i++){
    const point=(station,side=0)=>new T.Vector3().fromArray(positions,(station*4+side)*3);
    const a=point(i),b=point(i,1),z=b.clone().sub(a).normalize(),x=point(Math.min(i+1,4)).sub(point(Math.max(0,i-1))).normalize(),y=new T.Vector3().crossVectors(z,x).normalize();x.crossVectors(y,z).normalize();
    assert.deepEqual(frames[i].elements,new T.Matrix4().makeBasis(x,y,z).setPosition(a.add(b).multiplyScalar(.5)).elements);
  }
  assert.equal(bridgeDeckFrames(positions,5,storage),frames);
});
