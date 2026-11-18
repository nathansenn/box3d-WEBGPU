import test from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {Matrix4,Quaternion,Euler,Vector3} from 'three';
import {ConvexBody,ConvexContactWorld,contactBox,triangularPrism,convexSeparation,convexManifold,sweepConvex,sphereConvex,contactEuler,CONTACT_SKIN,CONTACT_SLOP} from '../../src/engine/convex-contact.ts';

const close=(a,b,t=1e-8)=>assert.ok(Math.abs(a-b)<=t,`${a} != ${b}; error ${Math.abs(a-b)}`);
const box=(size,position,mass=1,dynamic=true)=>new ConvexBody(contactBox(size,mass),position,mass,dynamic);

test('world retries an exhausted rotating query even when endpoint overlap is small',()=>{
  const fixture=JSON.parse(readFileSync(new URL('../fixtures/glass-contact/rotating-grazing-pair.json',import.meta.url)));
  const restore=s=>{const b=new ConvexBody(s.shape,s.p,s.mass,s.dynamic);b.rotation=s.q;b.velocity=s.v;b.angularVelocity=s.w;b.sync();return b;};
  const a=restore(fixture.a),b=restore(fixture.b),world=new ConvexContactWorld();world.add(a);world.add(b);
  assert.equal(sweepConvex(a,b,fixture.dt,48,a.at(fixture.dt),b.at(fixture.dt),2e-6)?.converged,false);
  world.step(fixture.dt);assert.ok(world.stats.refinements>0);assert.equal(world.stats.ccdUnresolved,0);
  assert.ok(convexSeparation(a.pose,b.pose).gap>=-CONTACT_SLOP);
});
const dot=(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0);
const kinetic=b=>{
  const inv=new Matrix4().set(b.shape.inverseInertia[0],b.shape.inverseInertia[1],b.shape.inverseInertia[2],0,b.shape.inverseInertia[3],b.shape.inverseInertia[4],b.shape.inverseInertia[5],0,b.shape.inverseInertia[6],b.shape.inverseInertia[7],b.shape.inverseInertia[8],0,0,0,0,1).invert();
  const local=new Vector3(...b.angularVelocity).applyQuaternion(new Quaternion(...b.rotation).invert());
  return .5*b.mass*dot(b.velocity,b.velocity)+.5*local.dot(local.clone().applyMatrix4(inv));
};

test('triangular prism inertia agrees with independent degree-two triangle quadrature',()=>{
  const vertices=[[-.8,-.2,0],[.9,-.3,0],[-.1,.5,0]],mass=2,thickness=.012,s=triangularPrism(vertices,thickness,mass);
  // Three barycentric quadrature points integrate every quadratic exactly.
  const quadrature=[[2/3,1/6,1/6],[1/6,2/3,1/6],[1/6,1/6,2/3]],I=new Matrix4().set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1);
  let xx=0,yy=0,xy=0;for(const weights of quadrature){const x=dot(weights,vertices.map(v=>v[0])),y=dot(weights,vertices.map(v=>v[1]));xx+=x*x/3;yy+=y*y/3;xy+=x*y/3;}
  I.set(mass*(yy+thickness**2/12),-mass*xy,0,0,-mass*xy,mass*(xx+thickness**2/12),0,0,0,0,mass*(xx+yy),0,0,0,0,1).invert();
  for(let i=0;i<3;i++)for(let j=0;j<3;j++)close(s.inverseInertia[i*3+j],I.elements[j*4+i],1e-10);
  assert.throws(()=>triangularPrism([[0,0,0],[0,0,0],[0,0,0]],.01,1),/Degenerate/);
  assert.throws(()=>triangularPrism(vertices,0,1));assert.throws(()=>contactBox([1,-1,1]));
});

test('collider vertices and exported XYZ rotations match the Three.js renderer',()=>{
  const b=box([.4,.7,.008],[1,2,3]);
  for(let i=0;i<40;i++){
    b.rotation=new Quaternion().setFromEuler(new Euler(i*.23,i*.41,i*.73)).toArray();b.sync();
    const matrix=new Matrix4().compose(new Vector3(...b.position),new Quaternion().setFromEuler(new Euler(...contactEuler(b.rotation))),new Vector3(1,1,1));
    b.shape.vertices.forEach((v,j)=>new Vector3(...v).applyMatrix4(matrix).toArray().forEach((p,k)=>close(p,b.pose.vertices[j][k],1e-7)));
  }
});

test('SAT distinguishes overlapping bounding boxes from actual thin triangular shapes',()=>{
  const s=triangularPrism([[-2/3,-2/3,0],[4/3,-2/3,0],[-2/3,4/3,0]],.008,1);
  const a=new ConvexBody(s,[0,0,0]),b=new ConvexBody(s,[1.3,1.3,0]);
  assert.ok(a.pose.max[0]>b.pose.min[0]&&a.pose.max[1]>b.pose.min[1]);assert.ok(convexSeparation(a.pose,b.pose).gap>.4);
  b.position=[.2,.2,0];b.sync();close(convexSeparation(a.pose,b.pose).gap,-.008);
});

test('touching faces yield a supporting manifold and contained shapes have a finite exit',()=>{
  const a=box([1,1,1],[0,1,0]),b=box([10,1,10],[0,0,0],1,false),s=convexSeparation(a.pose,b.pose),points=convexManifold(a,b);
  close(s.gap,0);assert.equal(points.length,4);for(const p of points){close(p.gap,0);close(p.a[1],.5);close(p.b[1],.5);}
  a.position=[0,0,0];a.sync();assert.ok(Number.isFinite(convexSeparation(a.pose,b.pose).gap));
  const sphere=sphereConvex([0,0,0],.25,b);close(sphere.gap,-.75);close(Math.hypot(...sphere.normal),1);
});

test('swept SAT catches fast translation through 2 mm walls with disjoint endpoints',()=>{
  for(const speed of [10,100,1000])for(const axis of [0,1,2])for(const direction of [-1,1]){
    const size=[1,1,1];size[axis]=.002;const p=[0,0,0];p[axis]=direction*.05;
    const a=box(size,p),b=box(size,[0,0,0],1,false);a.velocity[axis]=-direction*speed;const dt=.02;
    assert.ok(convexSeparation(a.at(dt),b.pose).gap>0);
    const hit=sweepConvex(a,b,dt);assert.ok(hit?.converged);close(hit.time,(.05-.002-CONTACT_SKIN)/speed,1e-8);assert.ok(hit.separation.gap>=-1e-7);
  }
});

test('rotational sweep catches an intermediate contact when both endpoint poses miss',()=>{
  const a=box([2,.02,.02],[0,1,0]),b=box([10,.1,10],[0,.15,0],1,false),dt=1/120,omega=2*Math.PI/dt;
  a.angularVelocity=[0,0,omega];assert.ok(convexSeparation(a.pose,b.pose).gap>.7);assert.ok(convexSeparation(a.at(dt),b.pose).gap>.7);
  const hit=sweepConvex(a,b,dt,64),angle=Math.asin((.8-CONTACT_SKIN)/Math.hypot(1,.01))-Math.atan(.01);
  assert.ok(hit?.converged);close(hit.time,angle/omega,1e-8);assert.ok(hit.separation.gap>=-1e-7);
});

test('near grazing motion stays separated; exhausted CCD explicitly reports uncertainty',()=>{
  const a=box([1,.01,.1],[0,.506,0]),b=box([10,1,10],[0,0,0],1,false);a.velocity=[20,0,0];assert.equal(sweepConvex(a,b,1/120),null);
  a.position=[0,2,0];a.velocity=[0,-300,0];a.sync();assert.equal(sweepConvex(a,b,1/120,1)?.converged,false);
});

test('swept broad phase includes every sampled rotating overlap and emits each pair once',()=>{
  const w=new ConvexContactWorld();for(let i=0;i<24;i++){
    const b=w.add(box([.5,.04,.2],[Math.sin(i*7)*2,Math.cos(i*5),Math.sin(i*3)]));b.velocity=[Math.sin(i)*15,Math.cos(i)*4,Math.sin(i*2)*10];b.angularVelocity=[i*3,4,-i*5];
  }
  const dt=1/60,pairs=w.candidates(dt),set=new Set(pairs.map(p=>p.join(',')));assert.equal(set.size,pairs.length);
  for(let frame=0;frame<=16;frame++){const poses=w.bodies.map(b=>b.at(dt*frame/16));for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++)if(convexSeparation(poses[i],poses[j]).gap<=CONTACT_SKIN)assert.ok(set.has([i,j].join(',')));}
});

test('broad phase matches all-pairs bounds through growth, disable, reorder and reuse',()=>{
  const world=new ConvexContactWorld();
  // Enumerate in body-id order without the production sweep or packed keys.
  const reference=(dt,ends)=>{
    const bounds=world.bodies.map((b,id)=>{
      const end=ends?.[id]??(dt&&b.dynamic?b.at(dt):b.pose);
      const w=b.angularVelocity,angular=b.dynamic?b.shape.radius*(w[0]*w[0]+w[1]*w[1]+w[2]*w[2])*dt*dt/8:0;
      return {min:b.pose.min.map((x,k)=>Math.min(x,end.min[k])-angular-CONTACT_SKIN),max:b.pose.max.map((x,k)=>Math.max(x,end.max[k])+angular+CONTACT_SKIN)};
    });
    const pairs=[];
    for(let a=0;a<world.bodies.length;a++)for(let b=a+1;b<world.bodies.length;b++){
      const x=world.bodies[a],y=world.bodies[b];
      if(!x.collisionEnabled||!y.collisionEnabled||(!x.dynamic&&!y.dynamic))continue;
      if(bounds[a].min.some((v,k)=>v>bounds[b].max[k]||bounds[a].max[k]<bounds[b].min[k]))continue;
      pairs.push([a,b]);
    }
    return pairs;
  };
  assert.deepEqual(world.candidates(),[]);
  for(const count of [8,24,73]){
    while(world.bodies.length<count){
      const i=world.bodies.length,b=world.add(box([.5,.04,.2],[Math.sin(i*7),Math.cos(i*5),Math.sin(i*3)],1,i%4!==0));
      b.velocity=[Math.sin(i)*15,Math.cos(i)*4,Math.sin(i*2)*10];b.angularVelocity=[i*3,4,-i*5];b.collisionEnabled=i%7!==0;
    }
    for(const dt of [0,.001,1/60]){
      const ends=world.bodies.map(b=>b.at(dt));
      for(const supplied of [undefined,ends]){
        const result=world.candidates(dt,supplied),saved=structuredClone(result);assert.deepEqual(result,reference(dt,supplied));
        world.candidates(1/30);assert.deepEqual(result,saved,'later calls must not mutate returned pairs');
        if(result.length)result[0][0]=-1;
        assert.deepEqual(world.candidates(dt,supplied),saved,'returned pairs must not alias internal scratch');
      }
    }
    world.bodies.reverse();assert.deepEqual(world.candidates(1/60),reference(1/60));
  }
  world.bodies.splice(9);world.bodies.forEach(b=>b.collisionEnabled=false);assert.deepEqual(world.candidates(1/60),[]);
  world.bodies.forEach(b=>b.collisionEnabled=true);assert.deepEqual(world.candidates(1/60),reference(1/60));
  world.bodies.length=0;
  const a=world.add(box([1,1,1],[0,0,0])),b=world.add(box([1,1,1],[1+2*CONTACT_SKIN,0,0]));
  assert.deepEqual(world.candidates(),[[0,1]],'touching expanded bounds are included');
  b.position[0]=2;b.sync();assert.deepEqual(world.candidates(),[]);
  a.collisionEnabled=false;a.at=()=>{throw new Error('disabled body should not predict a pose');};assert.deepEqual(world.candidates(1/60),[]);
  world.bodies.length=94_906_266;assert.throws(()=>world.candidates(),/exact pair-key range/);
});

test('high-speed contact response keeps a thin projectile on the entry side of the wall',()=>{
  for(const speed of [100,1000]){
    const w=new ConvexContactWorld(),a=w.add(box([.3,.3,.002],[0,0,.5])),b=w.add(box([2,2,.002],[0,0,0],1,false));a.velocity=[0,0,-speed];
    const before=kinetic(a);w.step(1/120);assert.ok(a.pose.min[2]>=b.pose.max[2]-1e-4,`speed ${speed}, z ${a.pose.min[2]}`);assert.ok(kinetic(a)<=before+1e-8);
  }
});

test('two-body impulses preserve linear momentum and do not create kinetic energy',()=>{
  const w=new ConvexContactWorld(),a=w.add(box([.2,.2,.01],[0,0,.02],2)),b=w.add(box([.2,.2,.01],[0,0,-.02],3));
  a.velocity=[0,0,-5];b.velocity=[0,0,3];a.friction=b.friction=0;a.restitution=b.restitution=0;
  const before=kinetic(a)+kinetic(b),momentum=a.velocity.map((v,i)=>v*a.mass+b.velocity[i]*b.mass);w.step(1/120);
  for(let i=0;i<3;i++)close(a.velocity[i]*a.mass+b.velocity[i]*b.mass,momentum[i],1e-10);assert.ok(kinetic(a)+kinetic(b)<=before+1e-8);
  assert.ok(a.pose.min[2]>=b.pose.max[2]-1e-4);
});

test('resting contact supports gravity with friction and no forced orientation',()=>{
  const w=new ConvexContactWorld(),a=w.add(box([.4,.02,.5],[0,.51,0])),b=w.add(box([10,1,10],[0,0,0],1,false));a.velocity=[1,0,0];
  for(let i=0;i<360;i++){a.velocity[1]-=9.81/120;w.step(1/120);assert.ok(a.pose.min[1]>=.5-1e-4);}
  assert.ok(Math.hypot(...a.velocity)<.01);assert.ok(Math.hypot(...a.angularVelocity)<.02);assert.ok(Math.abs(contactEuler(a.rotation)[0])<.02);assert.ok(w.stats.contacts>0);
  assert.throws(()=>w.step(NaN));assert.throws(()=>w.step(0));assert.throws(()=>w.step(1));
});

test('removing a normal load releases cached friction without contact attraction',()=>{
  const world=new ConvexContactWorld(),moving=world.add(box([.1,.1,.01],[.1,0,0])),wall=world.add(box([.1,2,2],[0,0,0],1,false));
  moving.restitution=wall.restitution=0;moving.friction=wall.friction=.5;
  for(let i=0;i<60;i++){moving.velocity[0]-=.1;world.step(1/120);}
  moving.velocity=[.5,-1,0];moving.angularVelocity=[0,0,0];world.step(1/120);
  moving.velocity.forEach((v,i)=>close(v,[.5,-1,0][i]));assert.ok(moving.pose.min[0]>wall.pose.max[0]);assert.equal(world.impacts.length,0);
});

test('finite rim has no invisible collision wall above it',()=>{
  const w=new ConvexContactWorld(),a=w.add(box([.1,.1,.01],[0,1,0])),rim=w.add(box([1,.12,.1],[0,.72,-.81],1,false));a.velocity=[0,0,-20];
  for(let i=0;i<10;i++)w.step(1/120);assert.ok(a.position[2]<rim.pose.min[2]-.1);close(a.velocity[2],-20);
});

test('contact position projection preserves mass-weighted centres, fixed supports and owned arrays',()=>{
  const world=new ConvexContactWorld(),removed=[];
  for(const [pairs,spares] of [[1,0],[24,0],[3,0],[96,0],[96,256],[0,0]]){
    world.bodies.length=0;const planes=[],checks=[];
    for(let i=0;i<pairs;i++){
      const direction=[i%2?-.3:.7,.8,-.11],norm=Math.hypot(...direction),n=direction.map(x=>x/norm),pa=[i*2,.2,-.3];
      const a=world.add(box([.1,.1,.1],pa,2+i%5,i%3!==0)),b=world.add(box([.1,.1,.1],pa.map((x,k)=>x+n[k]*.85),3+i%7));
      planes.push({ai:i*2,bi:i*2+1,n,target:1.05,wa:a.dynamic?1/a.mass:0,wb:1/b.mass});
      checks.push({a,b,n,pa:[...a.position],aArray:a.position,bArray:b.position,centre:pa.map((_,k)=>a.position[k]*a.mass+b.position[k]*b.mass)});
    }
    const untouched=[];
    for(let i=0;i<spares;i++){
      const b=world.add(box([.1,.1,.1],[i,.7,-.8]));untouched.push({body:b,array:b.position,position:[...b.position]});
    }
    // Exercise the internal algebra directly against its physical invariants.
    // Full world tests separately check the contact discovery and pose sync.
    world.projectContactPositions(planes);
    for(const held of untouched){assert.equal(held.body.position,held.array);assert.deepEqual(held.body.position,held.position);}
    for(const {a,b,n,pa,aArray,bArray,centre} of checks){
      assert.equal(a.position,aArray);assert.equal(b.position,bArray);
      const distance=n.reduce((sum,v,k)=>sum+v*(b.position[k]-a.position[k]),0);
      assert.ok(distance>=1.05-CONTACT_SLOP*.05&&distance<=1.05+1e-12,`${distance}`);
      if(!a.dynamic)assert.deepEqual(a.position,pa);
      else for(let k=0;k<3;k++)close(a.position[k]*a.mass+b.position[k]*b.mass,centre[k],1e-10);
    }
    for(const held of removed)assert.deepEqual(held.array,held.values,'scratch reuse cannot change removed bodies');
    removed.push(...world.bodies.map(b=>({array:b.position,values:[...b.position]})));
  }
});
