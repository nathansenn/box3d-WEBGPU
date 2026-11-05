import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createOptimizedDirtyRecordTracker as create} from '../.round6-build/optimized-dirty-record-tracker.js';
const methods=['touched-words','touched-tiles','epoch-words','range-union','locality-gated'];
let replayFrames=0, recordAssertions=0, invalidChecks=0;
function random(seed){let s=seed>>>0;return ()=>{s^=s<<13;s^=s>>>17;s^=s<<5;return s>>>0;};}
function verify(n,t,truth){
 const result=t.finish(); assert.strictEqual(t.finish(),result);
 assert.equal(result.dirtyCount===null,result.full);
 const coverage=new Uint8Array(n);let end=-1;
 for(const s of result.spans){
  assert.ok(Number.isInteger(s.start)&&Number.isInteger(s.count)&&s.count>0);
  assert.ok(s.start>end&&s.start+s.count<=n);end=s.start+s.count;
  coverage.fill(1,s.start,end);
 }
 if(result.full){assert.equal(result.spans.length,0);assert.equal(result.coverageUpperBound,n);assert.ok(result.countedDirtyRecords<=truth.size);}
 else{assert.equal(result.dirtyCount,truth.size);assert.equal(result.countedDirtyRecords,truth.size);assert.equal(result.coverageUpperBound,coverage.reduce((a,b)=>a+b,0));}
 const old=Uint32Array.from({length:n*4},(_,i)=>(Math.imul(i,0x9e3779b9)>>>0));
 const changed=old.slice();for(const i of truth){changed[i*4]^=0x80000000;changed[i*4+3]^=0x7fc12345;}
 const replay=old.slice();if(result.full)replay.set(changed);
 else for(const s of result.spans)replay.set(changed.subarray(s.start*4,(s.start+s.count)*4),s.start*4);
 assert.deepEqual(replay,changed);
 for(const i of truth){assert.ok(result.full||coverage[i]);recordAssertions++;}
 replayFrames++;
 return result;
}
for(const method of methods)test(`${method}: range boundaries, replay and reset`,()=>{
 const rng=random(0x18afa421);
 for(const n of [0,1,2,31,32,33,63,64,65,257,4097]){
  const t=create(n,method,{locality:'localized',maxRanges:8});
  for(let frame=0;frame<24;frame++){
   t.begin();const truth=new Set();
   for(let j=0;j<20;j++){
    const start=n?rng()%(n+1):0;
    const count=rng()%Math.min(39,n-start+1);
    t.markRange(start,count);for(let i=start;i<start+count;i++)truth.add(i);
    if(n&&j%3===0){const i=rng()%n;t.mark(i);t.mark(i);truth.add(i);}
   }
   verify(n,t,truth);
   assert.throws(()=>t.markRange(0,0),/begin/);
   t.begin();verify(n,t,new Set());
  }
 }
});
for(const method of methods)test(`${method}: validates inputs even after full bypass`,()=>{
 assert.throws(()=>create(-1,method));assert.throws(()=>create(1.2,method));
 const t=create(257,method,{locality:'dense',maxRanges:1});
 t.mark(0);t.mark(6);
 for(const [s,n] of [[-1,1],[0,-1],[258,0],[257,1],[256,2],[0,NaN],[Infinity,1],[0,0.1],[NaN,1]]){assert.throws(()=>t.markRange(s,n));invalidChecks++;}
 for(const index of [-1,257,NaN,Infinity,0.1]){assert.throws(()=>t.mark(index));invalidChecks++;}
 t.markRange(257,0);assert.throws(()=>create(12,method,{maxRanges:0}));
 assert.throws(()=>create(12,method,{locality:'invented'}));
});
test('locality hint never allows unknown, native, scattered or dense optimization',()=>{
 for(const locality of ['unknown','dense','scattered']){
  const t=create(4096,'locality-gated',{locality});
  t.markRange(0,0);assert.equal(t.finish().full,false);
  t.begin();t.markRange(100,25);t.markRange(1000,50);
  const v=verify(4096,t,new Set([...Array.from({length:25},(_,i)=>i+100),...Array.from({length:50},(_,i)=>i+1000)]));
  assert.equal(v.full,true);assert.equal(v.dirtyCount,null);
 }
 const t=create(3,'locality-gated');t.mark(1);assert.equal(t.finish().full,true);
});
test('range union merges overlaps and adjacency without forgetting records',()=>{
 const t=create(100,'range-union',{maxRanges:2});
 t.markRange(40,5);t.markRange(10,10);t.markRange(20,20);
 assert.deepEqual(t.finish().spans,[{start:10,count:35}]);
 t.begin();t.mark(1);t.mark(5);t.mark(99);
 assert.equal(t.finish().full,true);assert.equal(t.finish().countedDirtyRecords,3);
});
test('borrowed spans invalidate; scalar receipts remain snapshots',()=>{
 const t=create(65,'touched-tiles');t.mark(64);const receipt=t.finish();
 assert.deepEqual(receipt.spans,[{start:64,count:1}]);
 t.begin();assert.equal(receipt.spans.length,0);assert.equal(receipt.dirtyCount,1);
 t.mark(32);assert.deepEqual(t.finish().spans,[{start:32,count:32}]);
});
test('randomized changing frames and exact scalar counts',()=>{
 const rng=random(0x924aca39);
 for(let j=0;j<500;j++){
  const n=rng()%1537,method=methods[j%5],locality=['localized','scattered','unknown'][j%3];
  const t=create(n,method,{locality,maxRanges:1+rng()%64});
  for(let frame=0;frame<6;frame++){
   t.begin();const truth=new Set();
   for(let k=0;k<60&&n;k++){
    if(k%2){const i=rng()%n;t.mark(i);truth.add(i);}
    else{const i=rng()%n,count=rng()%Math.min(80,n-i+1);t.markRange(i,count);for(let q=i;q<i+count;q++)truth.add(q);}
   }
   verify(n,t,truth);
  }
 }
});
test('epoch rollover clears tags: instrumented start near u32 wrap',async()=>{
 // This controlled copy exercises wrap without four billion begin() calls.
 // Only the original unmodified emitted module is used in performance runs.
 const path=new URL('../.round6-build/optimized-dirty-record-tracker.js',import.meta.url);
 const original=await readFile(path,'utf8');assert.equal(original.split('let generation = 1;').length,2);
 const instrumented=original.replace('let generation = 1;','let generation = 0xffff_fffe;');
 const module=await import('data:text/javascript;base64,'+Buffer.from(instrumented).toString('base64'));
 const t=module.createOptimizedDirtyRecordTracker(65,'epoch-words');
 t.markRange(0,65);verify(65,t,new Set(Array.from({length:65},(_,i)=>i)));
 t.begin();t.mark(32);verify(65,t,new Set([32]));
 t.begin();t.mark(64);verify(65,t,new Set([64]));
 t.begin();t.mark(0);verify(65,t,new Set([0]));
});
process.on('exit',()=>console.log(JSON.stringify({replayFrames,recordAssertions,invalidChecks,physicalGpuTests:0})));
