import test from 'node:test';
import assert from 'node:assert/strict';
import {Triangle,Vector3} from 'three';
import {closestSurfaceTriangle,closestSurfaceEdges,sweepSurfacePointTriangle,sweepSurfaceEdges,projectSurfaceContact} from '../../src/engine/surface-contact.ts';

const close=(a,b,tolerance=1e-9)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);
test('surface triangle distances agree with independent Three.js geometry and barycentric reconstruction',()=>{
  let seed=912341;const rand=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32*4-2;};
  for(let i=0;i<600;i++){
    const [p,a,b,c]=Array.from({length:4},()=>[rand(),rand(),rand()]);
    const expected=new Triangle(new Vector3(...a),new Vector3(...b),new Vector3(...c)).closestPointToPoint(new Vector3(...p),new Vector3());
    const actual=closestSurfaceTriangle(p,a,b,c);
    actual.point.forEach((v,k)=>close(v,expected.getComponent(k),2e-9));
    close(actual.weights.reduce((s,v)=>s+v,0),1);assert.ok(actual.weights.every(v=>v>=0));
    for(let k=0;k<3;k++)close(actual.point[k],actual.weights[0]*a[k]+actual.weights[1]*b[k]+actual.weights[2]*c[k]);
  }
});
test('collapsed triangles and point edges retain finite closest features',()=>{
  assert.deepEqual(closestSurfaceTriangle([0,1,0],[0,0,0],[0,0,0],[0,0,0]),{point:[0,0,0],weights:[1,0,0],distanceSquared:1});
  const collinear=closestSurfaceTriangle([.5,1,0],[-1,0,0],[1,0,0],[0,0,0]);
  assert.deepEqual(collinear.point,[.5,0,0]);close(collinear.distanceSquared,1);
  const edges=closestSurfaceEdges([0,0,0],[0,0,0],[-1,1,0],[1,1,0]);close(edges.distanceSquared,1);close(edges.fractionB,.5);
});
test('point/triangle CCD catches a complete thin-surface transit with separated endpoints',()=>{
  const face=[[-2,-2,0],[2,-2,0],[0,2,0]],start=[[0,0,1],...face],end=[[0,0,-1],...face];
  const hit=sweepSurfacePointTriangle(start,end,.006);
  assert.ok(hit?.converged);close(hit.time,(1-.006)/2,1e-7);close(Math.sqrt(hit.closest.distanceSquared),.006,1e-7);
});
test('point/triangle CCD uses relative motion and is unchanged by a common translation',()=>{
  const face=[[-2,-2,0],[2,-2,0],[0,2,0]],start=[[0,0,1],...face],end=[[0,0,1],...face.map(p=>[p[0],p[1],2])];
  const a=sweepSurfacePointTriangle(start,end,.006),offset=[20,-30,11],shift=p=>p.map((v,k)=>v+offset[k]);
  const b=sweepSurfacePointTriangle(start.map(shift),end.map(shift),.006);
  assert.ok(a?.converged&&b?.converged);close(a.time,b.time,1e-12);close(a.time,.497,1e-7);
});
test('edge/edge CCD catches crossing edges even when no endpoint reaches the other edge',()=>{
  const start=[[-1,0,1],[1,0,1],[0,-1,0],[0,1,0]],end=[[-1,0,-1],[1,0,-1],[0,-1,0],[0,1,0]];
  const hit=sweepSurfaceEdges(start,end,.006);
  assert.ok(hit?.converged);close(hit.time,.497,1e-7);close(hit.closest.fractionA,.5);close(hit.closest.fractionB,.5);
});
test('stationary separation and a path past a finite triangle are misses',()=>{
  const start=[[0,0,1],[-1,-1,0],[1,-1,0],[0,1,0]];
  assert.equal(sweepSurfacePointTriangle(start,start,.006),null);
  assert.equal(sweepSurfacePointTriangle([[-2,3,0],...start.slice(1)],[[2,3,0],...start.slice(1)],.006),null);
});
test('a limited grazing query reports uncertainty rather than a missed collision',()=>{
  const a=[[-2,1.000001,0],[-1,-1,0],[1,-1,0],[0,1,0]],b=[[2,1.000001,0],...a.slice(1)];
  const hit=sweepSurfacePointTriangle(a,b,1e-7,1e-9,1);
  assert.ok(hit);assert.equal(hit.converged,false);assert.equal(hit.iterations,1);
  assert.throws(()=>sweepSurfacePointTriangle(a,b,-1),RangeError);
});
test('mass-weighted surface response separates a crossing without moving its centre of mass',()=>{
  const masses=[2,3,4,5],particles=masses.map((mass,i)=>({p:[i,0,i?0:-.1],inverseMass:1/mass})),coefficients=[1,-.2,-.3,-.5];
  const centre=()=>[0,1,2].map(k=>particles.reduce((s,p,i)=>s+masses[i]*p.p[k],0));
  const before=centre();assert.ok(projectSurfaceContact(particles,coefficients,[0,0,1],.006)>0);
  centre().forEach((v,k)=>close(v,before[k],1e-12));
  close(particles.reduce((s,p,i)=>s+coefficients[i]*p.p[2],0),.006,1e-12);
});
test('surface response preserves fixed anchors and does not attract separated surfaces',()=>{
  const particles=[{p:[0,0,-.1],inverseMass:1},{p:[0,0,0],inverseMass:0}],anchor=[...particles[1].p];
  projectSurfaceContact(particles,[1,-1],[0,0,1],.006);assert.deepEqual(particles[1].p,anchor);close(particles[0].p[2],.006);
  particles[0].p[2]=.1;const before=structuredClone(particles);assert.equal(projectSurfaceContact(particles,[1,-1],[0,0,1],.006),0);assert.deepEqual(particles,before);
});

const {SurfaceContactIndex}=await import('../../src/engine/surface-contact.ts');
test('spatial hierarchy agrees with exhaustive continuous feature queries',()=>{
  let seed=71913;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32)*6-3;
  const triangles=Array.from({length:8},(_,i)=>[i*3,i*3+1,i*3+2]);
  const index=new SurfaceContactIndex(triangles),edges=triangles.flatMap(t=>[[t[0],t[1]],[t[0],t[2]],[t[1],t[2]]]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  // Reuse/refit one hierarchy across unrelated poses, including long sweeps.
  for(let trial=0;trial<8;trial++){
    const start=Array.from({length:24},()=>[rand(),rand(),rand()]),end=start.map(p=>p.map(v=>v+rand()*.5));
    const result=index.detect(start,end,Array(24).fill(1),.02,1e-7,128),expected=[];let unresolved=0;
    const add=(kind,ids,hit)=>{if(hit?.converged)expected.push(kind+':'+ids.join('/'));else if(hit)unresolved++;};
    for(let p=0;p<24;p++)for(const t of triangles)if(!t.includes(p)){
      const ids=[p,...t];add('point-triangle',ids,sweepSurfacePointTriangle(ids.map(i=>start[i]),ids.map(i=>end[i]),.02,1e-7,128));
    }
    for(let a=0;a<edges.length;a++)for(let b=a+1;b<edges.length;b++)if(!edges[a].some(i=>edges[b].includes(i))){
      const ids=[...edges[a],...edges[b]];add('edge-edge',ids,sweepSurfaceEdges(ids.map(i=>start[i]),ids.map(i=>end[i]),.02,1e-7,128));
    }
    assert.deepEqual(result.contacts.map(c=>c.kind+':'+c.indices.join('/')).sort(),expected.sort());
    // The tree may certify misses that the looser distance bound cannot finish.
    assert.ok(result.unresolved<=unresolved);
    assert.ok(result.contacts.every(c=>Math.abs(Math.hypot(...c.normal)-1)<1e-10));
  }
});
test('deleted topology leaves no hidden face or edge barriers and invalid updates are atomic',()=>{
  const index=new SurfaceContactIndex([[1,2,3]]),start=[[0,0,1],[-1,-1,0],[1,-1,0],[0,1,0]],end=[[0,0,-1],...start.slice(1)],m=[1,0,0,0];
  const before=index.detect(start,end,m,.003);assert.equal(before.contacts.length,1);
  assert.throws(()=>index.setTriangles([[1,1,3]]),RangeError);assert.deepEqual(index.detect(start,end,m,.003),before);
  index.setTriangles([]);assert.equal(index.detect(start,end,m,.003).contacts.length,0);
});
test('static surfaces do not create static/static contacts or duplicate edge tests',()=>{
  const p=[[-1,0,0],[1,0,0],[0,1,0],[0,-1,0]],index=new SurfaceContactIndex([[0,1,2],[1,0,3]]);
  assert.equal(index.detect(p,p,[0,0,0,0],.003).contacts.length,0);
  const result=index.detect(p,p,[1,1,1,1],.003);assert.equal(result.unresolved,0);
  assert.equal(new Set(result.contacts.map(c=>c.kind+c.indices.join('/'))).size,result.contacts.length);
});
test('large coordinates and long features are queried without cell overflow or dropped hits',()=>{
  const x=2**54,face=[[x,-2,-2],[x,2,-2],[x,0,2]],start=[[x+16,0,0],...face],end=[[x-16,0,0],...face];
  const r=new SurfaceContactIndex([[1,2,3]]).detect(start,end,[1,0,0,0],.003);
  assert.ok(r.contacts.length||r.unresolved); // floating-point resolution is explicit uncertainty, never a silent miss
  const huge=[[0,0,1],[-1000,-1000,0],[1000,-1000,0],[0,1000,0]],out=[[0,0,-1],...huge.slice(1)];
  assert.equal(new SurfaceContactIndex([[1,2,3]]).detect(huge,out,[1,0,0,0],.003).contacts.length,1);
});
test('empty topology still validates query limits and particle dimensions',()=>{
  const index=new SurfaceContactIndex([]);
  assert.throws(()=>index.detect([],[],[],.003,NaN),RangeError);
  assert.throws(()=>index.detect([],[],[],.003,1e-7,0),RangeError);
  assert.throws(()=>index.detect([[0,0]],[[0,0]],[1],.003),RangeError);
  assert.throws(()=>index.detect([[0,0,0]],[[0,0,0]],[-1],.003),RangeError);
});

test('separating-plane advancement certifies a near-tangential miss without exhausting the query',()=>{
 const a=[[-2,1.000001,0],[-1,-1,0],[1,-1,0],[0,1,0]],b=[[2,1.000001,0],...a.slice(1)];
 assert.equal(sweepSurfacePointTriangle(a,b,1e-7,1e-9,8),null);
});

// These regressions are appended to the production feature suite on promotion.
test('reused surface queries find incoming features, changing thickness and newly dynamic surfaces',()=>{
  const triangles=[[1,2,3]],index=new SurfaceContactIndex(triangles);
  let points=[[0,0,.05],[-1,-1,0],[1,-1,0],[0,1,0]],mass=[0,0,0,0],enabled=[true,true,true,true];
  const check=(end=points,separation=.003,tolerance=1e-7)=>{
    const args=[points,end,mass,separation,tolerance,128,enabled,1e-6];
    const expected=new SurfaceContactIndex(triangles).detect(...args),actual=index.detect(...args);
    assert.deepEqual(actual,expected);return actual;
  };
  assert.equal(check().contacts.length,0);
  mass=[0,1,1,1]; // The point query previously pruned an entirely static face.
  assert.equal(check().contacts.length,0);
  const through=points.map((p,i)=>i?[p[0],p[1],.1]:[...p]);
  assert.equal(check(through).contacts.length,1);
  points=through;assert.equal(check().contacts.length,0);
  assert.equal(check(points,.06).contacts.length,1);
  enabled[0]=false;assert.equal(check(points,.06).contacts.length,0);
  enabled[0]=true;assert.equal(check(points,.06).contacts.length,1);
  mass=[0,0,0,0];assert.equal(check(points,.06).contacts.length,0);
  mass=[1,0,0,0];assert.equal(check(points,.06).contacts.length,1);
  points=points.map(p=>p.map(v=>v+1000));assert.equal(check(points,.06).contacts.length,1);
});

test('slow folds, mass changes and topology edits preserve complete fresh-query reports',()=>{
  let seed=47151;const rnd=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);
  const all=Array.from({length:12},(_,i)=>[i*3,i*3+1,i*3+2]);let faces=all;
  const index=new SurfaceContactIndex(faces);let start=Array.from({length:36},()=>[rnd()-.5,rnd()-.5,(rnd()-.5)*.06]);
  for(let step=0;step<180;step++){
    const end=start.map(p=>p.map(v=>v+(rnd()-.5)*.001));
    const mass=start.map((_,i)=>(i+Math.floor(step/30))%5?1:0),enabled=start.map((_,i)=>(i+Math.floor(step/20))%7!==0);
    if(step%45===0){faces=step===90?[]:all.slice(Math.floor(step/45));index.setTriangles(faces);}
    const args=[start,end,mass,.003,1e-7,128,enabled,step%2?1e-6:.003];
    assert.deepEqual(index.detect(...args),new SurfaceContactIndex(faces).detect(...args));start=end;
  }
});

test('dense candidate envelopes fall back without losing exact contacts',()=>{
  const faces=Array.from({length:80},()=>[0,1,2]);
  const points=[[-1,-1,0],[1,-1,0],[0,1,0],...Array.from({length:160},(_,i)=>[0,0,.02+i*1e-7])];
  const index=new SurfaceContactIndex(faces),mass=points.map((_,i)=>i<3?0:1);
  for(let step=0;step<4;step++){
    const end=points.map((p,i)=>i<3?p:[p[0],p[1],step===2?-.02:p[2]]);
    const args=[points,end,mass,.003,1e-7,64];
    const actual=index.detect(...args);assert.deepEqual(actual,new SurfaceContactIndex(faces).detect(...args));
    assert.equal(actual.contacts.length,step===2?12800:0);
  }
});
