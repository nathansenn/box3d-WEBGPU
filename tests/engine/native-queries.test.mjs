import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const source=process.env.BOX3D_QUERY_SOURCE_ROOT??'.';
const {NativeWorldPool}=await import(pathToFileURL(path.resolve(source,'src/engine/native-world.ts')));
const artifact=process.env.BOX3D_QUERY_ARTIFACT_DIR??'public/box3d';
async function load(dir=artifact){
  const {default:make}=await import(pathToFileURL(path.resolve(dir,'box3d.js')));
  return make({wasmBinary:await fs.readFile(path.resolve(dir,'box3d.wasm'))});
}
function empty(world){
  world.createScene({id:0},1,42);
  while(world.bodyCount())world.destroyBody(world.bodyHandle(world.bodyCount()-1));
}
function state(world){
  const n=world.bodyCount(),h=world.HEAPF32;
  return {n,dynamic:world.dynamicCount(),awake:world.awakeCount(),hash:world.replayHash(),frame:world.frameVersion(),color:world.colorVersion(),
    matrices:[...h.slice(Number(world._b3w_matrices_ptr())/4,Number(world._b3w_matrices_ptr())/4+n*16)],
    colors:[...h.slice(Number(world._b3w_colors_ptr())/4,Number(world._b3w_colors_ptr())/4+n*4)]};
}
const tokens=result=>result.hits.map(hit=>hit.body.token);
const ray=(extra={})=>({kind:'ray',origin:[0,10,0],translation:[16,0,0],...extra});
const overlap=(extra={})=>({kind:'box-overlap',origin:[8,10,0],halfExtents:[16,1,1],...extra});
const close=(actual,expected,tolerance=1e-6)=>assert.ok(Math.abs(actual-expected)<=tolerance,`${actual} differs from ${expected} by more than ${tolerance}`);
function queryBytes(mod,w){
  const info=w.spatialQueryInfo(),p=Number(mod._b3w_world_query_inputs_ptr(w.handle));
  return {info,ptr:p,bytes:Buffer.from(mod.HEAPU8.slice(p,p+info.bridgeBufferBytes))};
}

test('native rays and sphere/box casts match analytic box hits with documented SDK cast slop',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),w=pool.createWorld();
  try{
    empty(w);const bodies=[8,4,12].map(x=>w.launchProjectileBody(x,10,0,0,0,0,.5));assert.ok(bodies.every(Boolean));
    const before=state(w),queries=[ray(),ray({kind:'sphere-cast',radius:.5}),ray({kind:'box-cast',halfExtents:[.5,.5,.5]})];
    const results=w.queryBatch(queries),expected=[bodies[1].token,bodies[0].token,bodies[2].token];
    for(const [j,result] of results.entries()){
      assert.deepEqual(tokens(result),expected);assert.equal(result.totalHits,3);assert.equal(result.overflow,false);
      for(const [i,hit] of result.hits.entries()){
        const x=[4,8,12][i];close(hit.fraction,(x-(j===0?.5:1))/16,j===0?1e-6:.006/16);
        close(hit.point[0],x-.5);close(hit.point[1],10);close(hit.point[2],0);close(hit.normal[0],-1);
        close(hit.normal[1],0);close(hit.normal[2],0);assert.equal(hit.material,0n);assert.notEqual(w.bodyIndex(hit.body),null);
      }
    }
    assert.deepEqual(w.queryBatch(queries),queries.map(q=>w.queryBatch([q])[0]),'batched and serial results must be exact');
    assert.deepEqual(state(w),before,'query traversal must not change simulation state');
    for(const q of queries)assert.equal(w.queryBatch([{...q,translation:[0,0,0]}])[0].totalHits,0);
    for(const q of queries){
      const inside=w.queryBatch([{...q,origin:[4,10,0],translation:[1,0,0]}])[0];
      assert.deepEqual(tokens(inside),[bodies[1].token]);assert.equal(inside.hits[0].fraction,0);
      assert.deepEqual(inside.hits[0].point,[4,10,0]);assert.deepEqual(inside.hits[0].normal,[0,0,0]);
    }
  }finally{pool.destroy();}
});

test('shape overlaps use SDK distance slop, remain distinct from broadphase candidates, and filter both body types',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),w=pool.createWorld();
  try{
    empty(w);const body=w.launchProjectileBody(4,10,0,0,0,0,.5);
    const queries=[{kind:'sphere-overlap',origin:[4,10,0],radius:.25},{kind:'box-overlap',origin:[4,10,0],halfExtents:[.25,.25,.25]}];
    for(const result of w.queryBatch(queries))assert.deepEqual(tokens(result),[body.token]);
    const precise={kind:'box-overlap',origin:[4.56,10,0],halfExtents:[.01,.01,.01]};
    assert.equal(w.queryBatch([precise])[0].totalHits,0);
    const near={...precise,origin:[4.5104,10,0]},outside={...precise,origin:[4.511,10,0]};
    assert.deepEqual(tokens(w.queryBatch([near])[0]),[body.token],'surface gap 0.0004 is inside the SDK overlap slop');
    assert.equal(w.queryBatch([outside])[0].totalHits,0,'surface gap 0.001 is outside the SDK overlap slop');
    assert.deepEqual(tokens(w.queryBatch([{...precise,kind:'aabb-candidates'}])[0]),[body.token],'fat broadphase proxy may overlap beyond the collider');
    for(const filter of [{bodies:'none'},{bodies:'static'},{maskBits:0n},{categoryBits:0n},{ignoreBody:body}]){
      assert.equal(w.queryBatch([ray({filter})])[0].totalHits,0);
    }
    assert.deepEqual(tokens(w.queryBatch([ray({filter:{categoryBits:1n<<63n,maskBits:1n,bodies:'dynamic'}})])[0]),[body.token]);
    assert.deepEqual(tokens(w.queryBatch([ray({filter:{maskBits:1n<<63n}})])[0]),[body.token],'SDK default collider categories contain all bits');
    w.createScene({id:0},1,42);
    const all=w.queryBatch([overlap({origin:[0,10,0],halfExtents:[100,100,100],limit:256})])[0];
    const dynamic=w.queryBatch([overlap({origin:[0,10,0],halfExtents:[100,100,100],limit:256,filter:{bodies:'dynamic'}})])[0];
    const fixed=w.queryBatch([overlap({origin:[0,10,0],halfExtents:[100,100,100],limit:256,filter:{bodies:'static'}})])[0];
    assert.equal(all.totalHits,157);assert.equal(dynamic.totalHits,156);assert.deepEqual(tokens(fixed),[w.bodyHandle(0).token]);
  }finally{pool.destroy();}
});

test('nearest-K overflow is deterministic across non-distance insertion, compaction and slot recycling',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),w=pool.createWorld();
  try{
    empty(w);const placed=[];
    for(let i=0;i<300;i++){const x=((i*127)%300)*2+2;placed.push({x,body:w.launchProjectileBody(x,10,0,0,0,0,.5)});}
    const expected=placed.toSorted((a,b)=>a.x-b.x),q=ray({translation:[602,0,0],limit:256});
    let result=w.queryBatch([q])[0];assert.equal(result.totalHits,300);assert.equal(result.overflow,true);assert.deepEqual(tokens(result),expected.slice(0,256).map(x=>x.body.token));
    assert.deepEqual(tokens(w.queryBatch([{...q,limit:1}])[0]),[expected[0].body.token]);
    const first=placed[78],dead=placed[201];w.destroyBody(dead.body);w.destroyBody(first.body);
    const replacement=w.launchProjectileBody(1,10,0,0,0,0,.1);assert.ok(replacement);
    result=w.queryBatch([{...q,limit:17}])[0];
    assert.deepEqual(tokens(result),[replacement.token,...expected.filter(p=>p!==dead&&p!==first).slice(0,16).map(p=>p.body.token)]);
    assert.equal(result.totalHits,299);assert.equal(result.overflow,true);assert.equal(w.bodyIndex(dead.body),null);
    const repeated=w.queryBatch(Array.from({length:128},()=>({...q,limit:256})));
    assert.ok(repeated.every(r=>r.totalHits===299&&r.hits.length===256&&r.overflow));
    assert.equal(w.spatialQueryInfo().bridgeBufferBytes,128*96+32768*56);
    const samePosition=[w.launchProjectileBody(1,10,0,0,0,0,.1),w.launchProjectileBody(1,10,0,0,0,0,.1)];
    const tie=w.queryBatch([{...q,limit:3}])[0];assert.deepEqual(tokens(tie),[replacement,...samePosition].map(b=>b.token).toSorted((a,b)=>a<b?-1:1));
    const volume=w.queryBatch([overlap({origin:[300,10,0],halfExtents:[400,2,2],limit:7})])[0];
    const all=Array.from({length:w.bodyCount()},(_,i)=>w.bodyHandle(i).token).toSorted((a,b)=>a<b?-1:1);
    assert.equal(volume.totalHits,301);assert.deepEqual(tokens(volume),all.slice(0,7));
  }finally{pool.destroy();}
});

test('owned query hits survive resets, heap relocation, world isolation and destruction without reviving references',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),w=pool.createWorld(),other=pool.createWorld();
  try{
    empty(w);empty(other);const body=w.launchProjectileBody(4,10,0,0,0,0,.5),otherBody=other.launchProjectileBody(12,10,0,0,0,0,.5);
    const saved=w.queryBatch([ray()]),canonical=structuredClone(saved);
    assert.deepEqual(tokens(other.queryBatch([ray()])[0]),[otherBody.token]);close(other.queryBatch([ray()])[0].hits[0].point[0],11.5);
    const heap=mod.HEAPF32.buffer;other.reserveBodyCapacity(65536);const p=mod._malloc(mod.HEAPF32.byteLength+65536);assert.ok(p);mod._free(p);
    assert.notEqual(mod.HEAPF32.buffer,heap);assert.deepEqual(w.queryBatch([ray()]),saved);
    w.reserveBodyCapacity(65536);assert.deepEqual(w.queryBatch([ray()]),saved);
    const version=w.spatialQueryInfo().version;w.clear();assert.ok(w.spatialQueryInfo().version>version);
    assert.equal(w.queryBatch([ray()])[0].totalHits,0);assert.equal(w.bodyIndex(saved[0].hits[0].body),null);
    assert.deepEqual(structuredClone(saved),canonical);w.destroy();assert.deepEqual(structuredClone(saved),canonical);
    assert.equal(other.bodyIndex(otherBody),0);assert.throws(()=>w.queryBatch([ray()]),e=>e.code==='DISPOSED');
    assert.equal(mod._b3w_world_query_batch(w.handle,1,version),-1);assert.equal(mod._b3w_world_query_reserve(w.handle,1,1),-1);
    assert.equal(body.token,saved[0].hits[0].body.token);
  }finally{pool.destroy();}
});

test('whole-batch input and stale-body validation precede any reservation or output write',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),w=pool.createWorld(),other=pool.createWorld();
  try{
    empty(w);empty(other);const body=w.launchProjectileBody(4,10,0,0,0,0,.5),foreign=other.launchProjectileBody(4,10,0,0,0,0,.5);
    assert.deepEqual(w.queryBatch([]),[]);assert.equal(w.spatialQueryInfo().bridgeBufferBytes,0);w.queryBatch([ray()]);
    const before=queryBytes(mod,w),physics=state(w);
    const invalid=[null,{},ray({kind:'banana'}),ray({limit:0}),ray({limit:257}),ray({limit:1.1}),ray({origin:[NaN,0,0]}),ray({translation:[Infinity,0,0]}),
      ray({translation:[1e6+1,0,0]}),ray({origin:new Array(3)}),ray({origin:[1,2]}),ray({origin:[Number.MIN_VALUE,0,0]}),ray({ignored:true}),
      ray({filter:{bodies:'constructor'}}),ray({filter:{maskBits:-1n}}),ray({filter:{maskBits:1n<<64n}}),ray({filter:{categoryBits:1}}),ray({filter:null}),
      ray({filter:{ignoreBody:foreign}}),ray({filter:{ignoreBody:{token:body.token}}}),ray({filter:{limit:1}}),ray({kind:'sphere-cast',radius:0}),
      ray({kind:'box-cast',halfExtents:[1,-1,1]}),{kind:'sphere-overlap',origin:[0,0,0],radius:Infinity},
      {kind:'box-overlap',origin:[0,0,0],halfExtents:[1,1,1],translation:[0,0,0]}];
    for(const q of invalid){assert.throws(()=>w.queryBatch([ray(),q]),e=>e.code==='INVALID_PAYLOAD');assert.deepEqual(queryBytes(mod,w),before);assert.deepEqual(state(w),physics);}
    for(const list of [null,{},new Array(2),Array.from({length:129},()=>ray())])assert.throws(()=>w.queryBatch(list),e=>e.code==='INVALID_PAYLOAD');
    w.destroyBody(body);const afterRemoval=queryBytes(mod,w);
    assert.throws(()=>w.queryBatch([ray(),ray({filter:{ignoreBody:body}})]),e=>e.code==='STALE_BODY');assert.deepEqual(queryBytes(mod,w),afterRemoval);
  }finally{pool.destroy();}
});

test('raw C rejects malformed batches and stale revisions atomically, and JS rejects corrupt native layouts/results',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod),w=pool.createWorld();
  try{
    empty(w);w.launchProjectileBody(4,10,0,0,0,0,.5);w.queryBatch([ray(),ray()]);
    const p=Number(mod._b3w_world_query_inputs_ptr(w.handle)),s=Number(mod._b3w_world_query_status_ptr(w.handle)),h=Number(mod._b3w_world_query_hits_ptr(w.handle));
    const version=mod._b3w_world_query_version(w.handle),valid=mod.HEAPU8.slice(p,p+160),prior=mod.HEAPU8.slice(s,h+64*56);
    const rejects=[v=>v.setUint32(p+80,6,true),v=>v.setUint32(p+84,4,true),v=>v.setFloat32(p+88,NaN,true),
      v=>v.setFloat32(p+100,Infinity,true),v=>v.setUint32(p+124,1,true),v=>v.setUint32(p+152,0,true),
      v=>v.setUint32(p+156,1,true),v=>v.setUint32(p+72,256,true),v=>v.setBigUint64(p+144,0xFFFFn,true)];
    for(const change of rejects){mod.HEAPU8.set(valid,p);change(new DataView(mod.HEAPF32.buffer));assert.ok([-2,-5].includes(mod._b3w_world_query_batch(w.handle,2,version)));assert.equal(mod._b3w_world_query_version(w.handle),version);assert.deepEqual(mod.HEAPU8.slice(s,h+64*56),prior);}
    mod.HEAPU8.set(valid,p);assert.equal(mod._b3w_world_query_batch(w.handle,2,version-1),-4);
    for(const count of [0,129,-1])assert.equal(mod._b3w_world_query_batch(w.handle,count,version),-2);
    assert.equal(mod._b3w_world_query_batch(w.handle,2,version),2);assert.equal(mod._b3w_world_query_batch(w.handle,2,version),-4);
    for(const [a,b] of [[0,1],[1,0],[129,1],[1,32769]])assert.equal(mod._b3w_world_query_reserve(w.handle,a,b),-2);
    const execute=mod._b3w_world_query_batch;
    for(const corrupt of [v=>v.setUint32(s,32,true),v=>v.setUint32(s+4,257,true),v=>v.setUint32(s+12,1,true),v=>v.setBigUint64(h,0n,true),
      v=>v.setFloat32(h+40,NaN,true),v=>v.setFloat32(h+16,Infinity,true),v=>v.setUint32(h+52,0,true)]){
      mod._b3w_world_query_batch=(...args)=>{const r=execute(...args);corrupt(new DataView(mod.HEAPF32.buffer));return r;};
      assert.throws(()=>w.queryBatch([ray()]),e=>e.code==='INVALID_BACKEND');
    }
    mod._b3w_world_query_batch=execute;
    const pointer=mod._b3w_world_query_hits_ptr;mod._b3w_world_query_hits_ptr=()=>p;
    assert.throws(()=>w.queryBatch([ray()]),e=>e.code==='INVALID_BACKEND');mod._b3w_world_query_hits_ptr=pointer;
    assert.equal(w.queryBatch([ray()])[0].totalHits,1);
  }finally{pool.destroy();}
});

test('old artifacts retain compatibility and incomplete query extensions fail explicitly',async()=>{
  const mod=await load(),old=await load('benchmarks/results/engine-100x/runs/native-body-recycling-20260910-04/artifacts');
  const pool=new NativeWorldPool(old),w=pool.createWorld();
  try{
    w.createScene({id:0},1,42);assert.equal(w.supportsSpatialQueries,false);assert.equal(w.spatialQueryInfo().bridgeBufferBytes,0);
    assert.throws(()=>w.queryBatch([ray()]),e=>e.code==='UNSUPPORTED_BACKEND');w.step(1/60,4);
    assert.throws(()=>new NativeWorldPool({...mod,_b3w_world_query_batch:undefined}),e=>e.code==='UNSUPPORTED_BACKEND');
    assert.throws(()=>new NativeWorldPool({...mod,_b3w_world_body_handle:undefined}),e=>e.code==='UNSUPPORTED_BACKEND');
  }finally{pool.destroy();}
});

test('query arena warmup is bounded through repeated largest-batch execution and world churn',async()=>{
  const mod=await load(),pool=new NativeWorldPool(mod);let warmBytes=0;
  const queries=Array.from({length:128},()=>ray({limit:256}));
  try{
    for(let cycle=0;cycle<68;cycle++){
      const w=pool.createWorld();empty(w);w.launchProjectileBody(4,10,0,0,0,0,.5);
      const expected=w.queryBatch(queries);for(let n=0;n<16;n++)assert.deepEqual(w.queryBatch(queries),expected);
      assert.equal(w.spatialQueryInfo().bridgeBufferBytes,128*96+32768*56);w.destroy();
      if(cycle===3)warmBytes=mod.HEAPF32.byteLength;if(cycle>3)assert.equal(mod.HEAPF32.byteLength,warmBytes);
    }
  }finally{pool.destroy();}
});

if(process.env.BOX3D_QUERY_FAULT_TESTS==='1'){
  test('failed query arena growth is transactional and a later successful reserve remains usable',async()=>{
    const mod=await load(),pool=new NativeWorldPool(mod),w=pool.createWorld();
    try{
      empty(w);w.launchProjectileBody(4,10,0,0,0,0,.5);const physics=state(w);
      mod._b3w_test_fail_next_query_allocation();assert.throws(()=>w.queryBatch([ray()]),e=>e.code==='ALLOCATION_FAILED');assert.equal(w.spatialQueryInfo().bridgeBufferBytes,0);assert.deepEqual(state(w),physics);
      const result=w.queryBatch([ray()]),before=queryBytes(mod,w),queries=Array.from({length:128},()=>ray({limit:256}));
      mod._b3w_test_fail_next_query_allocation();assert.throws(()=>w.queryBatch(queries),e=>e.code==='ALLOCATION_FAILED');assert.deepEqual(queryBytes(mod,w),before);assert.deepEqual(state(w),physics);
      assert.deepEqual(w.queryBatch([ray()]),result);assert.ok(w.queryBatch(queries).every(r=>r.totalHits===1));
    }finally{pool.destroy();}
  });
  test('exhausted query revisions retire without wrapping or changing the physics world',async()=>{
    const mod=await load(),pool=new NativeWorldPool(mod),w=pool.createWorld();
    try{
      empty(w);w.launchProjectileBody(4,10,0,0,0,0,.5);w.queryBatch([ray()]);assert.equal(mod._b3w_test_exhaust_query_version(w.handle),1);
      assert.equal(w.spatialQueryInfo().version,0xFFFFFFFE);assert.equal(w.queryBatch([ray()])[0].totalHits,1);assert.equal(w.spatialQueryInfo().version,0xFFFFFFFF);
      const before=queryBytes(mod,w),physics=state(w);assert.throws(()=>w.queryBatch([ray()]),e=>e.code==='QUERY_VERSION_EXHAUSTED');assert.deepEqual(queryBytes(mod,w),before);assert.deepEqual(state(w),physics);
      w.clear();assert.equal(w.spatialQueryInfo().version,0xFFFFFFFF);assert.throws(()=>w.queryBatch([ray()]),e=>e.code==='QUERY_VERSION_EXHAUSTED');
    }finally{pool.destroy();}
  });
}
