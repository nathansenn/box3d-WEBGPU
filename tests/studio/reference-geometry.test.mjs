import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import * as T from 'three/webgpu';
// Resolve the app's extensionless TypeScript imports without changing its build.
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)&&context.parentURL?.endsWith('.ts')){
    const path=new URL(specifier+'.ts',context.parentURL);if(existsSync(path))return next(path.href,context);
  }return next(specifier,context);
}});
const { VALLEY_GRID, valleyHeight, valleySurface, seatRock, coniferGeometry, REFERENCE_CAMERAS, noise, addBridgeCraft }=await import('../../src/studio/reference-scene.ts');
const { SCENE_SETUPS }=await import('../../src/studio/presets.ts');

const grid=VALLEY_GRID;
const terrain=new T.PlaneGeometry(grid.width,grid.depth,grid.cols,grid.rows);terrain.rotateX(-Math.PI/2);
const tp=terrain.getAttribute('position');
for(let i=0;i<tp.count;i++)tp.setY(i,valleyHeight(tp.getX(i),tp.getZ(i)));
terrain.computeVertexNormals();
const ground=new T.Mesh(terrain,new T.MeshBasicMaterial({side:T.DoubleSide}));ground.updateMatrixWorld(true);
const ray=new T.Raycaster(),v=new T.Vector3();
function renderedGround(x,z){ray.set(new T.Vector3(x,200,z),new T.Vector3(0,-1,0));const hit=ray.intersectObject(ground)[0];assert.ok(hit);return hit.point.y;}

test('ground sampler agrees with independently raycast rendered triangles on both slopes',()=>{
  for(let i=0;i<100;i++){
    const x=(noise(i+701)-.5)*280,z=(noise(i+881)-.5)*270;
    assert.ok(Math.abs(renderedGround(x,z)-valleySurface(x,z))<.0001,`${x},${z}`);
  }
});
test('rotated, nonuniformly scaled bank stones contact actual terrain vertices at the allowed embed',()=>{
  const rock=new T.IcosahedronGeometry(1,2),p=rock.getAttribute('position');
  for(let i=0;i<p.count;i++){const x=p.getX(i),y=p.getY(i),z=p.getZ(i),f=.88+.1*Math.sin(x*13+y*9+z*7);p.setXYZ(i,x*f,y*f*.65,z*f);}
  const transform=new T.Object3D();
  for(let i=0;i<12;i++){
    const size=.3+noise(i+68)*1.6,burial=.18*size;
    transform.position.set((i%2?1:-1)*(14+noise(i+84)*10),0,(noise(i+92)-.5)*110);
    transform.rotation.set((noise(i)-.5)*.7,noise(i+4)*6.28,(noise(i+19)-.5)*.5);transform.scale.set(size,size*.8,size*1.25);transform.updateMatrix();
    transform.position.y=seatRock(rock,transform.matrix,burial);transform.updateMatrix();
    let lowestGap=Infinity;
    for(let j=0;j<p.count;j++){v.fromBufferAttribute(p,j).applyMatrix4(transform.matrix);lowestGap=Math.min(lowestGap,v.y-renderedGround(v.x,v.z));}
    assert.ok(Math.abs(lowestGap+burial)<.0001);
    assert.ok(lowestGap+1>.5,'a deliberately floating instance must fail the contact tolerance');
  }rock.dispose();
});
test('conifer boughs have finite geometry, bounded crown and outward top-face winding',()=>{
  const g=coniferGeometry(),p=g.getAttribute('position'),n=g.getAttribute('normal');g.computeBoundingBox();
  assert.ok([...p.array,...n.array].every(Number.isFinite));
  assert.ok(g.boundingBox.min.y>.17&&g.boundingBox.max.y<=1);
  assert.ok(g.boundingBox.max.x-g.boundingBox.min.x<.5);
  const a=new T.Vector3(),b=new T.Vector3(),c=new T.Vector3();
  for(let i=0;i<p.count;i+=6){
    a.fromBufferAttribute(p,i);b.fromBufferAttribute(p,i+1);c.fromBufferAttribute(p,i+2);
    assert.ok(b.sub(a).cross(c.sub(a)).y>0,'top of each bough must face the sky');
  }
  for(let i=0;i<n.count;i++)assert.ok(Math.abs(v.fromBufferAttribute(n,i).length()-1)<1e-6);
  g.dispose();
});
test('reference tower crown and base remain inside the unobstructed desktop frame',()=>{
  const p=REFERENCE_CAMERAS.bridge,c=new T.PerspectiveCamera(p.fov,1423/972,.1,900);
  c.position.fromArray(p.position);c.lookAt(new T.Vector3(...p.target));c.setViewOffset(1423,972,156,85,1423,972);c.updateMatrixWorld();
  for(const point of [[-21,14,-1.9],[-21,14,1.9],[-21,3.75,-1.9],[-21,3.75,1.9],[21,14,1.9],[21,4.8,1.9]]){
    v.set(...point).project(c);const x=64+(v.x+1)*1423/2,y=58+(1-v.y)*972/2;
    assert.ok(x>320&&x<1175&&y>82&&y<802,`occluded tower anchor ${x},${y}`);
  }
});
test('each study has a complete original-reference setup with a compatible camera',()=>{
  for(const study of ['canopy','plate','bridge']){
    const setup=SCENE_SETUPS.find(p=>p.id===`setup-${study}-reference`);assert.ok(setup);assert.equal(setup.camera,'reference');assert.equal(setup.study,study);
    for(const value of [...REFERENCE_CAMERAS[study].position,...REFERENCE_CAMERAS[study].target,REFERENCE_CAMERAS[study].fov])assert.ok(Number.isFinite(value));
  }
});
test('all new tower fixtures have finite transforms and nondegenerate surfaces',()=>{
  const root=new T.Group(),mat=new T.MeshStandardMaterial();
  addBridgeCraft(root,{bridgeSteel:mat,dark:mat,bolt:mat});root.updateMatrixWorld(true);
  assert.ok(root.children.length>100);
  root.traverse(o=>{if(o.isMesh){assert.ok(o.matrixWorld.elements.every(Number.isFinite));assert.ok([...o.geometry.attributes.position.array].every(Number.isFinite));o.geometry.computeBoundingBox();assert.ok(o.geometry.boundingBox.getSize(new T.Vector3()).length()>0);o.geometry.dispose();}});
});
