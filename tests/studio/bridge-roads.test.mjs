import assert from 'node:assert/strict';
import {verifyNonPress} from './non-press-regression.mjs';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as T from 'three/webgpu';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)&&context.parentURL?.endsWith('.ts')){const path=new URL(specifier+'.ts',context.parentURL);if(existsSync(path))return next(path.href,context);}return next(specifier,context);}});
const {roadRibbon}=await import('../../src/studio/bridge-approaches.ts');
const {BRIDGE_LAYOUT:B,roadCenter,roadHalfWidth}=await import('../../src/studio/bridge-layout.ts');
const {valleySurface,addBridgeCraft}=await import('../../src/studio/reference-scene.ts');
const {bridgeDeckFrames,bridgeRailPoint,deckSupportGeometry}=await import('../../src/studio/bridge-deck.ts');
const {FailureSimulation}=await import('../../src/studio/physics.ts');
const {bankPlant,BANK_ROCKS}=await import('../../src/studio/bridge-ecology.ts');
const {frameBridge,BRIDGE_APPROACH_FRAME_POINTS}=await import('../../src/studio/bridge-framing.ts');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');

test('road face interiors conform to terrain, face upward and meet both timber ends',()=>{
  let checked=0;
  for(const side of [-1,1]){
    const g=roadRibbon(side),p=g.getAttribute('position'),indices=g.index.array,normal=g.getAttribute('normal');
    assert.ok([...p.array,...normal.array].every(Number.isFinite));
    for(let i=0;i<indices.length;i+=3){
      const v=Array.from(indices.slice(i,i+3),j=>new T.Vector3().fromBufferAttribute(p,j));
      const cross=v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0]));
      assert.ok(cross.y>=-1e-8,'upward winding including tiny clipped triangles');
      for(const weights of [[1/3,1/3,1/3],[.6,.2,.2],[.2,.6,.2],[.2,.2,.6]]){
        const q=v.reduce((sum,point,j)=>sum.addScaledVector(point,weights[j]),new T.Vector3()),gap=q.y-valleySurface(q.x,q.z);
        assert.ok(gap>=.0598&&gap<=.0842,`face interior at ${q.x},${q.z} has ${gap} gap`);checked++;
      }
    }
    let joint=0;
    for(let i=0;i<p.count;i++)if(Math.abs(p.getX(i)-side*B.roadStart)<1e-5&&Math.abs(p.getZ(i))<=B.halfWidth){
      assert.ok(Math.abs(p.getY(i)-B.deckTop)<.025,'gravel meets timber without a step');joint++;
    }
    assert.ok(joint>=6);g.computeBoundingBox();
    assert.ok(Math.abs(Math.max(Math.abs(g.boundingBox.min.x),Math.abs(g.boundingBox.max.x))-B.roadEnd)<1e-4);g.dispose();
  }
  assert.ok(checked>180000,'include shoulder face interiors, not just centreline samples');
});

test('roads turn into each bank, retain width, and clear anchor bodies and ground cover',()=>{
  assert.equal(Math.abs(roadCenter(-B.roadStart)),0);assert.equal(Math.abs(roadCenter(B.roadStart)),0);
  assert.ok(roadCenter(-100)>20&&roadCenter(100)<-20);
  assert.equal(roadHalfWidth(B.roadStart),B.halfWidth);
  for(const side of [-1,1])assert.ok(Math.abs(side*B.anchorZ-roadCenter(side*B.anchorX))-1.05>roadHalfWidth(side*B.anchorX)+B.shoulder);
  let visible=0;
  for(let i=0;i<10000;i++){
    const p=bankPlant(i);if(!p.visible)continue;visible++;
    if(Math.abs(p.x)>B.halfSpan&&Math.abs(p.x)<B.roadEnd)assert.ok(Math.abs(p.z-roadCenter(p.x))>=roadHalfWidth(p.x)+B.shoulder+.69);
  }
  assert.ok(visible>3500);
  for(const r of BANK_ROCKS)if(Math.abs(r.x)>B.halfSpan&&Math.abs(r.x)<B.roadEnd)assert.ok(Math.abs(r.z-roadCenter(r.x))-r.size>roadHalfWidth(r.x),'no boulder in the walking lane');
});

test('new portal hardware leaves the complete declared route prism open',()=>{
  const root=new T.Group(),material=new T.MeshStandardMaterial();addBridgeCraft(root,{bridgeSteel:material,dark:material,bolt:material});root.updateMatrixWorld(true);
  for(const x of [-B.halfSpan,B.halfSpan]){
    const clear=new T.Box3(new T.Vector3(x-.5,B.deckTop,-B.clearWidth/2),new T.Vector3(x+.5,B.deckTop+B.clearHeight,B.clearWidth/2));
    root.traverse(o=>{if(o.isMesh)assert.ok(!new T.Box3().setFromObject(o).intersectsBox(clear),`fixture obstructs ${x} portal`);});
  }
  root.traverse(o=>{if(o.isMesh)o.geometry.dispose();});material.dispose();
});

test('tilted deck stations keep every rail endpoint attached to its own post',()=>{
  const sim=new FailureSimulation('bridge'),positions=sim.snapshot().positions.slice(),cols=sim.config.cols;
  for(let i=0;i<cols;i++)for(let side=0;side<2;side++){
    const k=(i*4+side)*3;positions[k+1]+=(side?1:-1)*Math.sin(i*.4)*.8-Math.sin(i/(cols-1)*Math.PI)*2.2;positions[k+2]+=.2*Math.sin(i*.25);
  }
  const frames=bridgeDeckFrames(positions,cols),up=new T.Vector3();
  for(let i=0;i<cols;i++)for(let side=0;side<2;side++){
    const frame=frames[i],base=new T.Vector3(...bridgeRailPoint(positions,i,side,.08,frame)),top=new T.Vector3(...bridgeRailPoint(positions,i,side,1.23,frame));
    up.setFromMatrixColumn(frame,1);assert.ok(Math.abs(frame.determinant()-1)<1e-8);assert.ok(Math.abs(base.distanceTo(top)-1.15)<1e-8);
    for(const h of B.railHeights){
      const end=new T.Vector3(...bridgeRailPoint(positions,i,side,h+.08,frame)),expected=base.clone().lerp(top,h/1.15);
      assert.ok(end.distanceTo(expected)<1e-8);assert.ok(Math.abs(end.clone().sub(base).dot(up)-h)<1e-8);
    }
  }
});

test('deck steel supports the board underside and transforms with a failed station',()=>{
  const sim=new FailureSimulation('bridge'),g=deckSupportGeometry(sim.config.span/(sim.config.cols-1),sim.config.depth),m=new T.Mesh(g,new T.MeshBasicMaterial()),ray=new T.Raycaster();m.updateMatrixWorld(true);
  for(const z of [-.65,.65]){
    ray.set(new T.Vector3(.25,1,z),new T.Vector3(0,-1,0));const hit=ray.intersectObject(m)[0];assert.ok(hit);assert.ok(Math.abs(hit.point.y+.08)<1e-7,'stringer supports timber underside');
  }
  const frame=new T.Matrix4().makeRotationZ(.4).setPosition(2,1,-3),v=new T.Vector3(.25,-.08,.65).applyMatrix4(frame);
  m.matrix.copy(frame);m.matrixAutoUpdate=false;m.updateMatrixWorld(true);ray.set(v.clone().add(new T.Vector3(0,2,0)),new T.Vector3(0,-1,0));
  assert.ok(ray.intersectObject(m).some(hit=>hit.point.distanceTo(v)<1e-5),'rendered support follows the station frame');g.dispose();m.material.dispose();
});

test('corrected concept pair stays byte-identical and the structural solver is unchanged',()=>{
  for(const name of ['hero','approach']){
    const original=readFileSync(new URL(`../../docs/design/bridge-critic-v3-20260909/bridge-${name}.png`,import.meta.url));
    assert.equal(sha(readFileSync(new URL(`../../public/studio/references/bridge-v3-${name}.png`,import.meta.url))),sha(original));
  }
  verifyNonPress();
});

test('approach framing retains road-to-deck join and portal crowns beside desktop and phone controls',()=>{
  for(const [w,h,rect] of [[1216,636,{left:258,right:884,top:120,bottom:430}],[1472,938,{left:258,right:1140,top:120,bottom:690}],[390,550,{left:24,right:366,top:56,bottom:480}]]){
    const camera=new T.PerspectiveCamera(w<800?59:51,w/h,.1,900),target=new T.Vector3(...(w<800?[-15,6.2,0]:[-12,6.4,0]));camera.position.set(...(w<800?[-45,11,4]:[-43,7.5,8.5]));
    frameBridge(camera,target,w,h,rect,BRIDGE_APPROACH_FRAME_POINTS);
    for(const point of BRIDGE_APPROACH_FRAME_POINTS){
      const p=new T.Vector3(...point).project(camera),x=(p.x+1)*w/2,y=(1-p.y)*h/2;
      assert.ok(x>=rect.left-1&&x<=rect.right+1&&y>=rect.top-1&&y<=rect.bottom+1,`approach landmark hidden at ${w}×${h}`);
    }
  }
});
