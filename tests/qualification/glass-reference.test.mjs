import test from 'node:test';
import assert from 'node:assert/strict';
import {Quaternion,Vector3,Euler} from 'three';
import {referenceShape,referenceSeparation,referenceContacts,referenceSphereContacts} from '../../scripts/glass-collision-qualify.mjs';
const {ConvexBody,contactBox}=await import('../../src/engine/convex-contact.ts');
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);

test('independent glass oracle recovers analytic box gaps under a common rotation',()=>{
  const q=new Quaternion().setFromEuler(new Euler(.43,-.72,1.13));
  for(const gap of [-.03,0,.004,2])for(let axis=0;axis<3;axis++){
    const size=[.2,.3,.4],a=new ConvexBody(contactBox(size),[1,-2,3]),b=new ConvexBody(contactBox(size),[1,-2,3]);
    a.rotation=q.toArray();b.rotation=q.toArray();
    const offset=new Vector3().setComponent(axis,size[axis]+gap).applyQuaternion(q);
    b.position=b.position.map((v,k)=>v+offset.getComponent(k));
    // Deliberately leave production poses stale: this oracle must rebuild geometry.
    close(referenceSeparation(referenceShape(a),referenceShape(b)),gap);
  }
});

test('independent glass pair audit includes dynamic/static contacts and excludes static/static overlap',()=>{
  const box=(x,dynamic)=>new ConvexBody(contactBox([1,1,1]),[x,0,0],1,dynamic);
  const result=referenceContacts([box(0,false),box(0,false),box(.9,true),box(4,true)]);
  close(result.maximum,.1);assert.equal(result.pairs,2);assert.deepEqual(result.pair,[0,2]);
});

test('independent sphere audit checks outside and contained centres',()=>{
  const box=new ConvexBody(contactBox([1,1,1]),[0,0,0],1,false);
  close(referenceSphereContacts([0,0,.6],.2,[box]).maximum,.1);
  close(referenceSphereContacts([0,0,0],.2,[box]).maximum,.7);
  close(referenceSphereContacts([0,0,2],.2,[box]).maximum,0);
});
