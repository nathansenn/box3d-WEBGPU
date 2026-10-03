#!/usr/bin/env node
/** Freeze and execute geometric correctness/capacity checks. No timing claim. */
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {hashFile,hashValue,inventory,LIMITS,observeEnvironment,parseArgs,reserveRunDirectory,writeJsonExclusive} from './engine-baseline.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export const QUERY_PROTOCOL=Object.freeze({version:3,capacities:[4096,16384,65536],raysPerTier:1024,spheresPerTier:128,boxesPerTier:128,
  rotatedBodies:256,rotatedTicks:90,rotatedRays:1024,rotatedSpheres:512,rotatedBoxes:512,batchSize:128,limit:256,seed:0x51A7E,
  errors:{fraction:2e-5,point:3e-4,normal:3e-4},overlapDistanceTolerance:0.0005,maxWallSeconds:120,
  oracle:'Independent scalar slab rays, closest-point sphere distance, and box SAT plus vertex/face/edge distance from owned world transforms.',
  overlapSemantics:'Pinned SDK B3_OVERLAP_SLOP = 0.1 * 0.005 at its default length scale; separated surfaces within this distance count as overlaps. Strict zero-slop run 01 is preserved as failed.',
  normalSemantics:'Compare with every entering box face within the existing point error envelope of the intersection. Edge/corner normals need not select the same face as the float64 oracle. Single-face runs 02 and 03 remain failed.',
  scope:'Current one-box-collider bodies. No query latency, FPS, GPU, contact-event, or physical calibration claim.'});
async function copy(root,out,inputs){
  for(const input of inputs)await fs.access(path.join(root,input));
  const receipt=await inventory(root,inputs,LIMITS.sourceBytes);
  for(const f of receipt.files){const to=path.join(out,f.path);await fs.mkdir(path.dirname(to),{recursive:true});await fs.copyFile(path.join(root,f.path),to,fs.constants.COPYFILE_EXCL);assert.equal(await hashFile(to),f.sha256);}
  return receipt;
}
export async function qualifyQueries(args){
  const candidate=await fs.realpath(args['--candidate-root']??root),artifacts=await fs.realpath(args['--candidate-artifacts']??'public/box3d');
  assert.ok(args['--out'],'--out is required');const out=await reserveRunDirectory(args['--out'],[root,candidate,artifacts]);
  const started=Date.now(),bounded=()=>assert.ok(Date.now()-started<QUERY_PROTOCOL.maxWallSeconds*1000,'Query qualification deadline exceeded');
  const result={schema:'box3d.native-query-qualification/1',status:'running',startedAt:new Date(started).toISOString(),protocol:QUERY_PROTOCOL,
    protocolSha256:hashValue(QUERY_PROTOCOL),environment:await observeEnvironment()};
  try{
    result.source=await copy(candidate,path.join(out,'source'),['wasm/box3d_web.c','wasm/CMakeLists.txt','src/engine/native-world.ts','src/engine/contracts.ts']);
    result.artifacts=await copy(artifacts,path.join(out,'artifacts'),['box3d.js','box3d.wasm']);
    result.harness=await copy(root,path.join(out,'harness'),['scripts/native-query-qualify.mjs','scripts/native-query-oracle.mjs','scripts/engine-baseline.mjs','tests/engine/native-queries.test.mjs']);
    await writeJsonExclusive(path.join(out,'protocol.json'),QUERY_PROTOCOL);
    const {NativeWorldPool}=await import(pathToFileURL(path.join(out,'source/src/engine/native-world.ts')));
    const {default:make}=await import(pathToFileURL(path.join(out,'artifacts/box3d.js')));
    const {readBoxes,referenceQuery}=await import(pathToFileURL(path.join(out,'harness/scripts/native-query-oracle.mjs')));
    const mod=await make({wasmBinary:await fs.readFile(path.join(out,'artifacts/box3d.wasm'))}),pool=new NativeWorldPool(mod);
    let seed=QUERY_PROTOCOL.seed;const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return(seed>>>0)/2**32;};
    const raw=[];
    function check(w,queries,label){
      const boxes=readBoxes(w),byToken=new Map(boxes.map(b=>[b.token,b])),samples=[],before=w.replayHash(),revision=w.frameVersion(),awake=w.awakeCount();
      const digest=createHash('sha256'),errors={fraction:0,point:0,normal:0};let hitCount=0,overflows=0,edgeNormals=0;
      for(let i=0;i<queries.length;i+=128){
        bounded();const inputs=queries.slice(i,i+128),actual=w.queryBatch(inputs),serial=inputs.map(q=>w.queryBatch([q])[0]);assert.deepEqual(actual,serial,'Batch/serial mismatch '+label);
        for(let j=0;j<inputs.length;j++){
          const q=inputs[j],expected=referenceQuery(q,boxes,QUERY_PROTOCOL.overlapDistanceTolerance,QUERY_PROTOCOL.errors.point),got=actual[j],truncated=expected.slice(0,q.limit);
          result.lastCase=JSON.parse(JSON.stringify({label,index:i+j,query:q,actual:got,reference:truncated,
            boxes:[...new Set([...got.hits.map(h=>h.body.token),...truncated.map(h=>h.token)])].map(t=>byToken.get(t))},(_,v)=>typeof v==='bigint'?v.toString():v));
          assert.equal(got.totalHits,expected.length,`${label}/${i+j} total`);assert.equal(got.overflow,expected.length>q.limit);
          assert.deepEqual(got.hits.map(h=>h.body.token),truncated.map(h=>h.token),`${label}/${i+j} body hits`);
          if(q.kind==='ray')for(let k=0;k<truncated.length;k++){
            const a=got.hits[k],e=truncated[k];errors.fraction=Math.max(errors.fraction,Math.abs(a.fraction-e.fraction));
            for(let axis=0;axis<3;axis++)errors.point=Math.max(errors.point,Math.abs(a.point[axis]-e.point[axis]));
            errors.normal=Math.max(errors.normal,Math.min(...e.normals.map(n=>Math.max(...n.map((v,axis)=>Math.abs(v-a.normal[axis]))))));
            edgeNormals+=Number(e.normals.length>1);
          }
          for(const [key,error] of Object.entries(errors))assert.ok(error<=QUERY_PROTOCOL.errors[key],`${label}/${i+j} ${key} error ${error}`);
          const clean=r=>JSON.parse(JSON.stringify(r,(_,v)=>typeof v==='bigint'?v.toString():v));
          const actualSha256=hashValue(clean(got)),sample={index:i+j,kind:q.kind,totalHits:got.totalHits,returned:got.hits.length,overflow:got.overflow,actualSha256,
            query:q,actual:clean(got),reference:clean({totalHits:expected.length,hits:truncated,boxes:truncated.map(h=>byToken.get(h.token))})};
          digest.update(actualSha256);samples.push(sample);hitCount+=got.hits.length;overflows+=Number(got.overflow);
        }
      }
      assert.equal(w.replayHash(),before);assert.equal(w.frameVersion(),revision);assert.equal(w.awakeCount(),awake);
      const record={label,bodies:w.bodyCount(),queries:queries.length,comparedWithSerial:true,hitCount,overflows,edgeNormals,maxError:errors,
        heapBytes:mod.HEAPF32.byteLength,queryBytes:w.spatialQueryInfo().bridgeBufferBytes,digest:digest.digest('hex'),samples};
      raw.push(record);console.log(JSON.stringify({...record,samples:undefined}));
    }
    try{
      for(const capacity of QUERY_PROTOCOL.capacities){
        const w=pool.createWorld();w.reserveBodyCapacity(capacity);w.createScene({id:0},1,42);while(w.bodyCount())w.destroyBody(w.bodyHandle(w.bodyCount()-1));
        for(let i=0;i<capacity;i++){bounded();assert.ok(w.launchProjectileBody((i%64)*4,20+Math.floor(i/64)%32*4,Math.floor(i/2048)*4,0,0,0,.5));}
        const boxes=readBoxes(w),queries=[];
        for(let i=0;i<QUERY_PROTOCOL.raysPerTier;i++){
          const target=boxes[Math.floor(random()*boxes.length)].center,origin=[-5,18+random()*132,-5+random()*140];
          const translation=target.map((n,k)=>(n-origin[k])*1.05);queries.push({kind:'ray',origin:origin.map(Math.fround),translation:translation.map(Math.fround),limit:256});
        }
        for(const kind of ['sphere-overlap','box-overlap'])for(let i=0;i<128;i++){
          const center=boxes[Math.floor(random()*boxes.length)].center,origin=center.map(n=>Math.fround(n+(random()-.5)*3));
          queries.push(kind==='sphere-overlap'?{kind,origin,radius:Math.fround(.3+random()*6),limit:256}:{kind,origin,halfExtents:[1.3,2.6,5.2].map(Math.fround),limit:256});
        }
        check(w,queries,'capacity-'+capacity);w.destroy();
      }
      const w=pool.createWorld();w.createScene({id:0},1,17);while(w.bodyCount())w.destroyBody(w.bodyHandle(w.bodyCount()-1));
      for(let i=0;i<256;i++)assert.ok(w.launchProjectileBody((i%8)*4,40+Math.floor(i/8)%8*4,Math.floor(i/64)*4,0,0,0,.7));
      for(let i=0;i<90;i++)w.step(1/60,4);const boxes=readBoxes(w),queries=[];
      for(let i=0;i<QUERY_PROTOCOL.rotatedRays;i++){
        const target=boxes[Math.floor(random()*256)].center,origin=[-5,30+random()*40,-5+random()*25];
        queries.push({kind:'ray',origin:origin.map(Math.fround),translation:target.map((n,k)=>Math.fround((n-origin[k])*1.1)),limit:256});
      }
      for(const kind of ['sphere-overlap','box-overlap'])for(let i=0;i<512;i++){
        const origin=boxes[Math.floor(random()*256)].center.map(n=>Math.fround(n+(random()-.5)*4));
        queries.push(kind==='sphere-overlap'?{kind,origin,radius:Math.fround(.3+random()*2.5),limit:256}:{kind,origin,halfExtents:[.51,1.13,1.57].map(Math.fround),limit:256});
      }
      check(w,queries,'rotated');w.destroy();result.finalRng=seed>>>0;
    }finally{pool.destroy();}
    await fs.mkdir(path.join(out,'raw'));await writeJsonExclusive(path.join(out,'raw/geometry.json'),raw);
    result.raw=await inventory(path.join(out,'raw'),['.'],LIMITS.sourceBytes);
    result.summary={groups:raw.length,queries:raw.reduce((n,r)=>n+r.queries,0),hits:raw.reduce((n,r)=>n+r.hitCount,0),exactBodyMatches:true,exactBatchSerial:true,
      maxError:Object.fromEntries(['fraction','point','normal'].map(k=>[k,Math.max(...raw.map(r=>r.maxError[k]))]))};
    result.status='pass';delete result.lastCase;
  }catch(error){result.status='fail';result.error=String(error.stack??error);}
  result.elapsedMs=Date.now()-started;await writeJsonExclusive(path.join(out,'result.json'),result);console.log(JSON.stringify({out,status:result.status,summary:result.summary,error:result.error},null,2));
  if(result.status!=='pass')process.exitCode=1;return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2),['--candidate-root','--candidate-artifacts','--out']);
  if(args.help)console.log('node scripts/native-query-qualify.mjs --candidate-root SOURCE --candidate-artifacts ARTIFACTS --out NEW_DIRECTORY');
  else await qualifyQueries(args);
}
