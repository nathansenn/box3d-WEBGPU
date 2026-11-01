import test from 'node:test';
import assert from 'node:assert/strict';
import {Euler,Quaternion} from 'three';
import {GlassPresentation} from '../../src/studio/material-labs/glass-presentation.ts';
const frame=(time,x,angle=0)=>({time,positions:new Float32Array([x,0,0]),rotations:new Float32Array([0,0,angle]),damage:new Uint8Array([time?1:0]),actuator:x,phase:'test',metrics:[1,2,3],collisions:{impacts:1,contacts:4,sweptContacts:0,unresolvedSweeps:0}});
const near=(a,b,t=1e-6)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
test('glass display smoothly interpolates received poses without extrapolating',()=>{
  const p=new GlassPresentation(),a=frame(0,0),b=frame(.1,1);p.reset(a,0);p.sample(0);p.receive(b,100);
  near(p.sample(125).positions[0],.25);near(p.sample(150).positions[0],.5);near(p.sample(200).positions[0],1);assert.equal(p.sample(1000),null);
});
test('glass interpolation takes the short quaternion arc across Euler wrap',()=>{
  const p=new GlassPresentation();p.reset(frame(0,0,179*Math.PI/180),0);p.receive(frame(.1,1,-179*Math.PI/180),100);
  const middle=p.sample(150),q=new Quaternion().setFromEuler(new Euler(...middle.rotations)),expected=new Quaternion().setFromEuler(new Euler(0,0,Math.PI));
  assert.ok(Math.abs(q.dot(expected))>1-1e-10);
});
test('display storage never aliases physical frames, metadata or recorded snapshots',()=>{
  const p=new GlassPresentation(),a=frame(0,0),b=frame(.1,1),savedA=structuredClone(a),savedB=structuredClone(b);
  p.reset(a,0);p.receive(b,100);const display=p.sample(150);assert.equal(display.damage[0],1);
  display.positions[0]=99;display.rotations[0]=99;display.damage[0]=0;display.metrics[0]=99;display.collisions.contacts=99;
  assert.deepEqual(a,savedA);assert.deepEqual(b,savedB);p.sample(200);assert.deepEqual(b,savedB);
});
test('pause, backward replay, reset and replacement layout cancel prior blending',()=>{
  const p=new GlassPresentation();p.reset(frame(0,0),0);p.receive(frame(.1,1),100);p.sample(150);
  p.receive(frame(.2,2),160,false);near(p.sample(160).positions[0],2);assert.equal(p.sample(1000),null);
  p.reset(frame(0,0),170);near(p.sample(170).positions[0],0);
  const changed=frame(.3,3);changed.positions=new Float32Array([3,0,0,4,0,0]);changed.rotations=new Float32Array(6);changed.damage=new Uint8Array(2);
  p.receive(changed,200);assert.equal(p.sample(200).positions.length,6);assert.equal(p.sample(1000),null);
});
test('a new result blends from the displayed pose, with a bounded delay',()=>{
  const p=new GlassPresentation();p.reset(frame(0,0),0);p.receive(frame(.1,1),100);near(p.sample(150).positions[0],.5);
  p.receive(frame(.2,2),150);near(p.sample(150).positions[0],.5);near(p.sample(175).positions[0],1.25);near(p.sample(200).positions[0],2);
  p.receive(frame(.3,3),10000);near(p.sample(10150).positions[0],3);assert.equal(p.sample(11000),null);
});
