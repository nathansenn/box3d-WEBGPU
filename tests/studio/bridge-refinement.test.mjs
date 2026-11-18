import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync,readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as T from 'three/webgpu';
registerHooks({resolve(specifier,context,next){if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)&&context.parentURL?.endsWith('.ts')){const path=new URL(specifier+'.ts',context.parentURL);if(existsSync(path))return next(path.href,context);}return next(specifier,context);}});
const {bankPlant,fernGeometry,sedgeGeometry,RIFFLE_STONES,wakeAt,BANK_ROCKS}=await import('../../src/studio/bridge-ecology.ts');
const {valleySurface,seatRock}=await import('../../src/studio/reference-scene.ts');
const {frameBridge}=await import('../../src/studio/bridge-framing.ts');
const evidence=new URL('../../docs/design/bridge-imagegen-v2-20260909/',import.meta.url);
const sha=b=>createHash('sha256').update(b).digest('hex');

test('new generated references are immutable, full-size PNGs with recorded hashes',()=>{
  for(const ref of JSON.parse(readFileSync(new URL('references.json',evidence))).references){
    const b=readFileSync(new URL('../../'+ref.path,import.meta.url));assert.equal(sha(b),ref.sha256);
    assert.deepEqual([b.readUInt32BE(16),b.readUInt32BE(20)],[1536,1024]);
  }
});
test('scanned source LODs retain their bytes and map by material name across reordered primitives',()=>{
  const assets=JSON.parse(readFileSync(new URL('asset-provenance.json',evidence))).assets;
  const materialLists=assets.map(a=>{const b=readFileSync(new URL('../../'+a.destination,import.meta.url));assert.equal(sha(b),a.sha256);const doc=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));return doc.materials.map(m=>m.name);});
  assert.notDeepEqual(materialLists[0],materialLists[1],'fixture must exercise source reordering');
  for(const names of materialLists){assert.equal(names.length,3);assert.deepEqual([...names].sort(),[...materialLists[0]].sort());}
});
test('planted roots stay above the water and clear foundations, approaches and stone footprints',()=>{
  let visible=0;
  for(let i=0;i<10000;i++){
    const p=bankPlant(i);if(!p.visible)continue;visible++;
    assert.ok(p.y>-.945);assert.ok(Math.abs(p.y-(valleySurface(p.x,p.z)-.045))<1e-8);
    assert.ok(!(Math.abs(p.z)<3.6&&Math.abs(p.x)>19&&Math.abs(p.x)<33));
    assert.ok(!(Math.abs(Math.abs(p.x)-21)<2.6&&Math.abs(p.z)<4.1));
    for(const r of BANK_ROCKS)assert.ok(Math.hypot(p.x-r.x,p.z-r.z)>=r.size*1.05+.15);
  }
  assert.ok(visible>3500,'bank habitat must retain meaningful cover');
});
test('new sedges and fronds have grounded stems, finite normals and bounded leaf sizes',()=>{
  for(const create of [fernGeometry,sedgeGeometry]){
    const g=create(),p=g.getAttribute('position'),n=g.getAttribute('normal');g.computeBoundingBox();
    assert.ok([...p.array,...n.array].every(Number.isFinite));assert.ok(Math.abs(g.boundingBox.min.y)<1e-7);
    assert.ok(g.boundingBox.max.y<1.2);assert.ok(g.boundingBox.max.x-g.boundingBox.min.x<2);
    assert.ok(Array.from(p.array).some((v,i)=>i%3===1&&v<.005),'each species must reach the root datum');g.dispose();
  }
});
test('foam stays on wet terrain and forms tails downstream of real riffle stones',()=>{
  for(let x=-20;x<=20;x+=.5)for(let z=-60;z<=60;z+=1.5){const value=wakeAt(x,z);assert.ok(value>=0&&value<=1);if(Math.abs(x)>16.6||valleySurface(x,z)>-1.55)assert.equal(value,0);}
  for(const r of RIFFLE_STONES){assert.ok(wakeAt(r.x,r.z+r.radius)>.4);}
  assert.equal(wakeAt(0,-68),0);
});
test('riffle stones actually break the surface at the coordinates used for foam',()=>{
  const geo=new T.IcosahedronGeometry(1,2),p=geo.getAttribute('position'),dummy=new T.Object3D(),v=new T.Vector3();
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),f=.88+.1*Math.sin(x*13+y*9+z*7);p.setXYZ(i,x*f,y*f*.65,z*f);}
  for(const r of RIFFLE_STONES){dummy.position.set(r.x,0,r.z);dummy.scale.set(r.radius,r.radius,r.radius*1.15);dummy.updateMatrix();dummy.position.y=seatRock(geo,dummy.matrix,r.radius*.12);dummy.updateMatrix();let top=-Infinity;for(let j=0;j<p.count;j++)top=Math.max(top,v.fromBufferAttribute(p,j).applyMatrix4(dummy.matrix).y);assert.ok(top>-1.48,`submerged obstacle ${r.x}, ${r.z}`);}
});
test('hero framing protects tower crowns and footing edges at desktop and phone breakpoints',()=>{
  for(const [w,h,rect] of [[1472,938,{left:258,right:1140,top:120,bottom:690}],[1216,636,{left:258,right:884,top:120,bottom:430}],[390,550,{left:24,right:366,top:56,bottom:480}]]){
    const c=new T.PerspectiveCamera(55,w/h,.1,900),target=new T.Vector3(-13,7,0);c.position.set(-33,7.8,17);frameBridge(c,target,w,h,rect);
    for(const p of [[-21,14.2,-1.9],[-21,14.2,1.9],[-23,1.1,3.6],[21,14.2,-1.9],[23,1.1,3.6]]){
      const v=new T.Vector3(...p).project(c),x=(v.x+1)*w/2,y=(1-v.y)*h/2;assert.ok(x>=rect.left-1&&x<=rect.right+1&&y>=rect.top-1&&y<=rect.bottom+1,`${w}×${h}: ${x},${y}`);
    }
  }
});
