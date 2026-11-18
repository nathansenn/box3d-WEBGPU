import test from 'node:test';
import assert from 'node:assert/strict';
import {FailureSimulation,STUDIO_CANOPY_CONTACT_BACKEND,STUDIO_SCALED_CHECKPOINT_BACKEND} from '../../src/studio/physics.ts';
import {CanopyContactSolver,CANOPY_CONTACT} from '../../src/studio/canopy-contact.ts';
import {canopyRig,canopyRigSurface} from '../../src/studio/canopy-rig.ts';
import {StudioRuntime,STUDIO_CANOPY_CONTACT_CAPABILITIES} from '../../src/engine/studio-runtime.ts';
const node=(p,inverseMass=1)=>({p:[...p],prev:[...p],rest:[...p],inverseMass});
const close=(a,b,e=1e-8)=>assert.ok(Math.abs(a-b)<=e,`${a} != ${b}`);
const wide={span:100,depth:100,supportY:10,floor:-10};
test('surface response stops a complete fabric crossing and preserves fixed faces',()=>{
 const xy=[[-1,-1],[1,-1],[0,1]],nodes=[...xy.map(([x,y])=>node([x,y,.1])),...xy.map(([x,y])=>node([x,y,0],0))];
 const solver=new CanopyContactSolver(nodes,wide);solver.begin();nodes.slice(0,3).forEach(n=>n.p[2]=-.1);
 solver.solve([[0,1,2],[3,4,5]],0);
 for(const n of nodes.slice(0,3)){assert.ok(n.p[2]>=CANOPY_CONTACT.separation-3e-6);assert.ok(n.p[2]-n.prev[2]>=-1e-8);}
 for(const n of nodes.slice(3))assert.deepEqual(n.p,n.rest);
 assert.ok(solver.stats.contacts>0);assert.equal(solver.stats.unresolved,0);
});
test('self-contact shares correction by mass and preserves free tangential displacement',()=>{
 const xy=[[-1,-1],[1,-1],[0,1]],nodes=[...xy.map(([x,y])=>node([x,y,.1])),...xy.map(([x,y])=>node([x,y,-.1]))];
 const solver=new CanopyContactSolver(nodes,wide);solver.begin();nodes.slice(0,3).forEach(n=>n.p[2]=-.2);nodes.slice(3).forEach(n=>n.p[2]=.2);
 const centre=()=>[0,1,2].map(k=>nodes.reduce((s,n)=>s+n.p[k],0));const before=centre();solver.solve([[0,1,2],[3,4,5]],0);
 centre().forEach((v,k)=>close(v,before[k]));assert.ok(solver.stats.contacts>0);
 for(const n of nodes)close(n.p[0],n.rest[0]);
});
test('fabric faces crossing the middle of a post are stopped by shared rig geometry',()=>{
 const x=5.65,z=4.65,nodes=[[x+.4,2,z-.06],[x+.4,2.2,z+.06],[x+.4,1.8,z+.06]].map(p=>node(p));
 const solver=new CanopyContactSolver(nodes,{span:10,depth:8,supportY:5.3,floor:.025});solver.begin();nodes.forEach(n=>n.p[0]-=.8);
 solver.solve([[0,1,2]],0);assert.ok(solver.stats.contacts>0);
 for(const n of nodes)assert.ok(n.p[0]>=x+.1375+CANOPY_CONTACT.separation-5e-6);
});
test('removing torn faces removes their self-contact barriers',()=>{
 const xy=[[-1,-1],[1,-1],[0,1]],nodes=[...xy.map(([x,y])=>node([x,y,.1])),...xy.map(([x,y])=>node([x,y,0],0))];
 const solver=new CanopyContactSolver(nodes,wide);solver.begin();solver.solve([[0,1,2],[3,4,5]],0);
 solver.begin();nodes.slice(0,3).forEach(n=>n.p[2]=-.1);solver.solve([[0,1,2]],1);
 for(const n of nodes.slice(0,3))close(n.p[2],-.1);assert.equal(solver.stats.contacts,0);
});
test('floor friction is bounded by normal correction and does not damp every solver iteration',()=>{
 const n=node([0,.0265,0]),s=new CanopyContactSolver([n],{span:10,depth:8,supportY:5.3,floor:.025});
 s.begin();n.p[0]=.1;n.p[1]-=.001;
 for(let i=0;i<13;i++)s.floor();close(n.prev[0],0);
 s.solve([],0);close(n.p[0]-n.prev[0],.1-CANOPY_CONTACT.floorFriction*.001);close(n.p[1],.0265);
});
test('shared rig proxies enclose every box and have finite cylinder surfaces',()=>{
 const rig=canopyRig(10,8,5.3),surface=canopyRigSurface(rig);
 assert.equal(rig.length,4);assert.ok(surface.positions.every(p=>p.every(Number.isFinite)));
 assert.ok(surface.triangles.every(t=>new Set(t).size===3&&t.every(i=>i>=0&&i<surface.positions.length)));
 for(const c of rig){const base=c.parts.find(p=>p.name==='base plate');close(base.center[0],c.x);close(base.center[2],c.z);}
});
test('new canopy backend has a distinct checkpoint and worker capability identity',()=>{
 const s=new FailureSimulation('canopy',{},STUDIO_CANOPY_CONTACT_BACKEND),c=s.exportCheckpoint();
 assert.equal(c.backend,STUDIO_CANOPY_CONTACT_BACKEND);assert.match(c.scene.identity,/attachmentRadius/);
 assert.throws(()=>new FailureSimulation('plate',{},STUDIO_CANOPY_CONTACT_BACKEND),RangeError);
 assert.throws(()=>new FailureSimulation('canopy',{},STUDIO_SCALED_CHECKPOINT_BACKEND).restoreCheckpoint(c),RangeError);
 const r=new StudioRuntime({study:'canopy',backend:STUDIO_CANOPY_CONTACT_BACKEND});assert.deepEqual(r.capabilities,STUDIO_CANOPY_CONTACT_CAPABILITIES);r.destroy();
});
test('checkpoint resume exactly preserves the new canopy trajectory',()=>{
 const s=new FailureSimulation('canopy',{},STUDIO_CANOPY_CONTACT_BACKEND);s.targetLoad=4;
 for(let i=0;i<12;i++)s.step();const resumed=FailureSimulation.fromCheckpoint(s.exportCheckpoint());
 for(let i=0;i<12;i++){s.step();resumed.step();assert.deepEqual(resumed.exportCheckpoint(),s.exportCheckpoint());}
});
test('a rejected contact tick restores the complete accepted state and can retry',()=>{
 const s=new FailureSimulation('canopy',{},STUDIO_CANOPY_CONTACT_BACKEND);s.targetLoad=4;
 // Cause genuine structural edits before injecting a contact work-limit failure.
 s.nodes[100].prev[1]+=1;const before=s.exportCheckpoint(),solve=s.canopyContact.solve;
 s.canopyContact.solve=()=>{throw Error('contact work limit');};assert.throws(()=>s.step(),/contact work limit/);
 assert.deepEqual(s.exportCheckpoint(),before);s.canopyContact.solve=solve;
 const other=FailureSimulation.fromCheckpoint(before);s.step();other.step();assert.deepEqual(s.exportCheckpoint(),other.exportCheckpoint());
});

const {surfaceIntersections}=await import('./canopy-contact-oracle.mjs');
test('independent oracle finds crossings and coplanar overlap but permits a shared seam',()=>{
 const p=[[-1,-1,0],[1,-1,0],[0,1,0],[-.5,-.5,-1],[.5,-.5,1],[0,.5,-1]];
 assert.ok(surfaceIntersections(p,[[0,1,2],[3,4,5]]).some(x=>x.kind==='crossing'));
 assert.ok(surfaceIntersections([...p.slice(0,3),[-.5,-.5,0],[.5,-.5,0],[0,.5,0]],[[0,1,2],[3,4,5]]).some(x=>x.kind==='coplanar-overlap'));
 assert.deepEqual(surfaceIntersections([[0,0,0],[1,0,0],[0,1,0],[1,1,0]],[[0,1,2],[1,3,2]]),[]);
 assert.deepEqual(surfaceIntersections([...p.slice(0,3),...p.slice(0,3).map(v=>[v[0],v[1],.003])],[[0,1,2],[3,4,5]]),[]);
});
test('the intersection oracle permits curved shared seams in the initial authored canopy',()=>{
 const s=new FailureSimulation('canopy');assert.deepEqual(surfaceIntersections(s.nodes.map(n=>n.p),s.faces.map(f=>f.nodes)),[]);
});

const {readFileSync}=await import('node:fs');const {gunzipSync}=await import('node:zlib');
test('a folded contact checkpoint resumes exactly, including after restoring a different topology',()=>{
 const c=JSON.parse(gunzipSync(readFileSync(new URL('./fixtures/canopy-contact-resting.json.gz',import.meta.url))));
 const a=FailureSimulation.fromCheckpoint(c),b=new FailureSimulation('canopy',{},STUDIO_CANOPY_CONTACT_BACKEND);
 b.step();b.restoreCheckpoint(c);assert.ok(a.brokenCount>0);
 for(let i=0;i<8;i++){a.step();b.step();assert.deepEqual(a.exportCheckpoint(),b.exportCheckpoint());}
 assert.ok(a.canopyContactStats.contacts>0);
});
const {Worker}=await import('node:worker_threads');
const {createStudioClient}=await import('../../src/engine/studio-client.ts');
function canopyWorkerFactory(){return ()=>{
 const w=new Worker(new URL('../engine/fixtures/studio-worker.mjs',import.meta.url)),bindings=new Map();
 return {postMessage:(m,t)=>w.postMessage(m,t),terminate:()=>w.terminate(),addEventListener(type,listener){const f=v=>listener(type==='message'?{data:v}:{message:v.message});bindings.set(listener,[type,f]);w.on(type,f);},removeEventListener(type,listener){const b=bindings.get(listener);if(b){w.off(...b);bindings.delete(listener);}}};
};}
for(const snapshots of ['transfer','shared'])test('canopy contact backend survives '+snapshots+' worker commands and checkpoint restore',async()=>{
 const options={study:'canopy',backend:STUDIO_CANOPY_CONTACT_BACKEND,controls:{targetLoad:4}};
 const client=await createStudioClient(options,{mode:'worker',snapshots,workerFactory:canopyWorkerFactory()});
 try{
  const direct=new FailureSimulation('canopy',{},STUDIO_CANOPY_CONTACT_BACKEND);direct.targetLoad=4;
  const r=await client.step({ticks:6});for(let i=0;i<6;i++)direct.step();assert.deepEqual(r.liveSnapshot,direct.snapshot());assert.equal(r.capabilities.models[0].id,STUDIO_CANOPY_CONTACT_BACKEND);r.release();
  const c=await client.exportCheckpoint();assert.deepEqual(c,direct.exportCheckpoint());
  const restored=await client.reset({study:'canopy',initialCheckpoint:c});restored.release();assert.equal(client.capabilities.models[0].id,STUDIO_CANOPY_CONTACT_BACKEND);
 }finally{await client.destroy();}
});
