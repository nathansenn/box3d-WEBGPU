#!/usr/bin/env node
/** Paired transfer/shared snapshot round trips, with all copy/validation costs included. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {captureBaseline,inventory,LIMITS,parseArgs,hashValue,hashFile,observeEnvironment,writeJsonExclusive,verifyManifestStructure} from './engine-baseline.mjs';
import {bootstrapRatio,quantile} from './engine-check.mjs';
export const SHARED_TRANSPORT_PROTOCOL=Object.freeze({
  schema:'box3d.shared-snapshot-protocol/1',pairs:6,studies:['canopy','plate','bridge'],
  cases:[{id:'inspect',ticks:0,warmup:128,samples:512},{id:'step',ticks:2,warmup:16,samples:96}],
  controls:{targetLoad:4,wind:.3},controlSamples:24,controlIterations:2000000,
  thresholds:{controlTolerance:.15,maxP95Regression:.05,minRatioLowerBound:1.05},maxSecondsPerProcess:120,
  scope:'Node worker snapshot round trip from request through response validation and release return. Includes runtime stepping, snapshot packing, shared copy or transfer, message scheduling and main-thread validation. No renderer, browser FPS or acknowledged final recycle; the following request observes FIFO recycle work.'
});
const mean=a=>a.reduce((n,v)=>n+v,0)/a.length;
const summarize=a=>({count:a.length,mean:mean(a),p50:quantile(a,.5),p95:quantile(a,.95),p99:quantile(a,.99)});
function control(){let n=42;const start=performance.now();for(let i=0;i<SHARED_TRANSPORT_PROTOCOL.controlIterations;i++)n=Math.imul(n^(n>>>13)^i,1597334677);return{ms:performance.now()-start,value:n};}
export function gateSharedTransport(samples,protocol=SHARED_TRANSPORT_PROTOCOL){
  try{
    assert.deepEqual(protocol,SHARED_TRANSPORT_PROTOCOL);assert.equal(samples.length,protocol.pairs*2);assert.equal(new Set(samples.map(s=>s.pid)).size,samples.length);
    for(const [i,s]of samples.entries()){
      const pair=Math.floor(i/2),mode=(pair%2?['shared','transfer']:['transfer','shared'])[i%2];
      assert.equal(s.pair,pair);assert.equal(s.mode,mode);assert.equal(s.status,'measured');assert.match(s.sourceSha256,/^[a-f0-9]{64}$/);assert.match(s.runtimeSha256,/^[a-f0-9]{64}$/);
      assert.equal(s.protocolSha256,hashValue(protocol));assert.equal(s.controls.length,protocol.controlSamples);assert.ok(s.controls.every(x=>x>0&&Number.isFinite(x)));assert.equal(s.controlValues.length,protocol.controlSamples);
      assert.equal(s.cases.length,6);
      for(const [j,c]of s.cases.entries()){
        const spec=protocol.cases[j%2],study=protocol.studies[Math.floor(j/2)];assert.equal(c.id,`${study}/${spec.id}`);assert.equal(c.roundTripMs.length,spec.samples);assert.equal(c.simMs.length,spec.samples);
        assert.ok(c.roundTripMs.every((n,k)=>Number.isFinite(n)&&n>0&&n>=c.simMs[k]));assert.ok(c.simMs.every(n=>Number.isFinite(n)&&n>=0));
        assert.match(c.outputSha256,/^[a-f0-9]{64}$/);assert.match(c.checkpointSha256,/^[a-f0-9]{64}$/);assert.ok(c.snapshotBytes>0);assert.equal(c.snapshotTransport,mode);assert.equal(c.outstandingLoans,0);
        assert.equal(c.messages.recycle,mode==='shared'?0:spec.samples);
        assert.equal(c.messages.liveTransferredBytes,mode==='shared'?0:c.snapshotBytes*spec.samples);
        assert.equal(c.messages.recycledBytes,mode==='shared'?0:c.snapshotBytes*spec.samples);
        assert.equal(c.messages.snapshots,spec.samples);assert.equal(c.messages.requests,spec.samples);
        assert.equal(c.messages.liveSharedBytes,mode==='shared'?c.snapshotBytes*spec.samples:0);
        assert.equal(c.sharedBytes,mode==='shared'?256+3*Math.ceil(c.snapshotBytes/4)*4:0);
      }
    }
    assert.equal(new Set(samples.map(s=>s.sourceSha256)).size,1);assert.equal(new Set(samples.map(s=>s.runtimeSha256)).size,1);assert.equal(new Set(samples.map(s=>hashValue(s.controlValues))).size,1);
    const transfer=samples.filter(s=>s.mode==='transfer'),shared=samples.filter(s=>s.mode==='shared');
    const controls=bootstrapRatio(transfer.map(s=>mean(s.controls)),shared.map(s=>mean(s.controls)),{seed:42});
    const controlQualified=controls.lower95>=1-protocol.thresholds.controlTolerance&&controls.upper95<=1+protocol.thresholds.controlTolerance;
    const cases=transfer[0].cases.map((c,i)=>{
      const a=transfer.map(s=>s.cases[i]),b=shared.map(s=>s.cases[i]);
      for(const key of ['outputSha256','checkpointSha256','tick','snapshotBytes'])assert.equal(new Set([...a,...b].map(c=>c[key])).size,1,`${c.id} exact ${key}`);
      const baseline=summarize(a.flatMap(c=>c.roundTripMs)),candidate=summarize(b.flatMap(c=>c.roundTripMs)),ratio=bootstrapRatio(a.map(c=>mean(c.roundTripMs)),b.map(c=>mean(c.roundTripMs)),{seed:100+i});
      return {id:c.id,snapshotBytes:c.snapshotBytes,baseline,candidate,ratio,qualifiedSpeedup:controlQualified&&ratio.lower95>=protocol.thresholds.minRatioLowerBound&&candidate.p95<=baseline.p95*(1+protocol.thresholds.maxP95Regression)};
    });
    return {status:controlQualified?'measured':'inconclusive',controlQualified,controls,cases,qualifiedCases:cases.filter(c=>c.qualifiedSpeedup).map(c=>c.id),scope:protocol.scope};
  }catch(error){return {status:'incomparable',issues:[error.message],qualifiedCases:[]};}
}
function factory(sourceRoot,counters){
  const worker=new Worker(fileURLToPath(import.meta.url),{workerData:{sourceRoot}}),bindings=new Map();
  return{postMessage(m,t){if(m.type==='recycle'){counters.recycle++;counters.recycledBytes+=t.reduce((n,b)=>n+b.byteLength,0);}else if(m.type==='step'||m.type==='inspect')counters.requests++;worker.postMessage(m,t);},terminate:()=>worker.terminate(),
    addEventListener(type,listener){const wrapped=value=>{
      if(type==='message'&&(value.type==='snapshot'||value.type==='shared-snapshot')){
        counters.snapshots++;const snapshot=value.data.liveSnapshot;
        if(value.type==='snapshot')counters.liveTransferredBytes+=snapshot.positions.byteLength+snapshot.strains.byteLength+snapshot.broken.byteLength;
        else counters.liveSharedBytes+=counters.snapshotBytes;
        for(const r of value.data.recordingSamples)counters.recordedTransferredBytes+=r.snapshot.positions.byteLength+r.snapshot.strains.byteLength+r.snapshot.broken.byteLength;
      }
      listener(type==='message'?{data:value}:{message:value.message});
    };bindings.set(listener,{type,wrapped});worker.on(type,wrapped);},
    removeEventListener(type,listener){const b=bindings.get(listener);if(b){worker.off(type,b.wrapped);bindings.delete(listener);}}
  };
}
function hashSnapshot(h,s){h.update(JSON.stringify({study:s.study,response:s.response,press:s.press,topologyVersion:s.topologyVersion,topologyIdentity:s.topologyIdentity,punchY:s.punchY}));for(const a of [s.positions,s.strains,s.broken])h.update(new Uint8Array(a.buffer,a.byteOffset,a.byteLength));}
async function child(task){
  const {createStudioClient}=await import(pathToFileURL(path.join(task.sourceRoot,'src/engine/studio-client.ts'))),p=task.protocol;
  assert.deepEqual(p,SHARED_TRANSPORT_PROTOCOL);assert.equal((await observeEnvironment()).runtime.executableSha256,task.executableSha256);
  const sample={schema:'box3d.shared-snapshot-sample/1',status:'measured',pair:task.pair,mode:task.mode,pid:process.pid,sourceSha256:task.sourceSha256,runtimeSha256:task.runtimeSha256,protocolSha256:hashValue(p),controls:[],controlValues:[],cases:[]};
  for(let i=0;i<8;i++)control();
  const takeControl=()=>{const c=control();sample.controls.push(c.ms);sample.controlValues.push(c.value);};
  for(const study of p.studies)for(const spec of p.cases){
    takeControl();takeControl();
    const counters={requests:0,snapshots:0,recycle:0,recycledBytes:0,liveTransferredBytes:0,liveSharedBytes:0,recordedTransferredBytes:0,snapshotBytes:0};
    const started=performance.now(),client=await createStudioClient({study,controls:p.controls},{mode:'worker',snapshots:task.mode,workerFactory:()=>factory(task.sourceRoot,counters)}),startupMs=performance.now()-started;
    try{
      const initial=await client.inspect();counters.snapshotBytes=initial.liveSnapshot.positions.byteLength+initial.liveSnapshot.strains.byteLength+initial.liveSnapshot.broken.byteLength;initial.release();
      for(let i=0;i<spec.warmup;i++){const result=await client.step({ticks:spec.ticks});result.release();}
      const startCounters={...counters},h=createHash('sha256'),roundTripMs=[],simMs=[];
      for(let i=0;i<spec.samples;i++){
        const before=performance.now(),result=await client.step({ticks:spec.ticks});
        const elapsed=performance.now()-before;
        // Hashing is deliberately outside timing, but before releasing shared data.
        hashSnapshot(h,result.liveSnapshot);for(const r of result.recordingSamples){h.update(String(r.tick));hashSnapshot(h,r.snapshot);}h.update(JSON.stringify(result.eventDelta));
        const releaseStart=performance.now();result.release();roundTripMs.push(elapsed+performance.now()-releaseStart);simMs.push(result.simMs);
      }
      const messages=Object.fromEntries(Object.entries(counters).filter(([k])=>k!=='snapshotBytes').map(([k,v])=>[k,v-startCounters[k]]));
      const checkpoint=await client.exportCheckpoint();
      sample.cases.push({id:`${study}/${spec.id}`,tick:client.tick,snapshotTransport:client.snapshotTransport,startupMs,roundTripMs,simMs,messages,snapshotBytes:counters.snapshotBytes,sharedBytes:client.diagnostics().sharedBytes??0,outstandingLoans:client.diagnostics().outstandingLoans,outputSha256:h.digest('hex'),checkpointSha256:hashValue(checkpoint)});
    }finally{await client.destroy();}
    takeControl();takeControl();
  }
  await writeJsonExclusive(task.output,sample);
}
export async function verifySharedTransportRun(directory){
  const root=await fs.realpath(directory),manifest=JSON.parse(await fs.readFile(path.join(root,'manifest.json'))),result=JSON.parse(await fs.readFile(path.join(root,'result.json'))),p=JSON.parse(await fs.readFile(path.join(root,'protocol.json')));
  assert.deepEqual(verifyManifestStructure(manifest),[]);assert.deepEqual(await inventory(path.join(root,'source'),['.'],LIMITS.sourceBytes),manifest.source);assert.deepEqual(await inventory(path.join(root,'harness'),['.'],LIMITS.sourceBytes),result.harness);assert.deepEqual(result.protocol,p);
  for(const [i,sample]of result.samples.entries()){
    const name=`${String(sample.pair).padStart(2,'0')}-${sample.mode}`,raw=JSON.parse(await fs.readFile(path.join(root,name+'.json'))),task=JSON.parse(await fs.readFile(path.join(root,name+'-task.json')));
    assert.deepEqual(raw,sample);assert.equal(raw.sourceSha256,manifest.source.sha256);assert.equal(raw.runtimeSha256,hashValue(manifest.environment.runtime));assert.equal(raw.mode,task.mode);assert.equal(raw.pair,task.pair);assert.deepEqual(task.protocol,p);assert.equal(task.sourceSha256,manifest.source.sha256);
    assert.deepEqual(result.execution[i],{pair:raw.pair,mode:raw.mode,pid:raw.pid,output:name+'.json'});
  }
  const gate=gateSharedTransport(result.samples,p);assert.deepEqual(result.gate,gate);
  return {...gate,integrity:{sourceSha256:manifest.source.sha256,resultSha256:await hashFile(path.join(root,'result.json')),harnessSha256:result.harness.sha256}};
}
async function run(output){
  const root=process.cwd(),out=path.resolve(output),manifest=await captureBaseline({root,out});
  await fs.mkdir(path.join(out,'harness'));for(const name of ['studio-shared-benchmark.mjs','engine-baseline.mjs','engine-check.mjs'])await fs.copyFile(path.join(root,'scripts',name),path.join(out,'harness',name),fs.constants.COPYFILE_EXCL);
  const harness=await inventory(path.join(out,'harness'),['.'],LIMITS.sourceBytes),protocol=SHARED_TRANSPORT_PROTOCOL;await writeJsonExclusive(path.join(out,'protocol.json'),protocol);
  const result={schema:'box3d.shared-snapshot-benchmark/1',protocol,harness,samples:[],execution:[],gate:null};
  for(let pair=0;pair<protocol.pairs;pair++)for(const mode of pair%2?['shared','transfer']:['transfer','shared']){
    const name=`${String(pair).padStart(2,'0')}-${mode}`,task={pair,mode,protocol,sourceRoot:path.join(out,'source'),sourceSha256:manifest.source.sha256,runtimeSha256:hashValue(manifest.environment.runtime),executableSha256:manifest.environment.runtime.executableSha256,output:path.join(out,name+'.json')};
    const taskPath=path.join(out,name+'-task.json');await writeJsonExclusive(taskPath,task);
    await new Promise((resolve,reject)=>{const processChild=spawn(process.execPath,[path.join(out,'harness/studio-shared-benchmark.mjs'),'--child',taskPath],{stdio:['ignore','pipe','pipe']});let output='';const timer=setTimeout(()=>processChild.kill('SIGTERM'),protocol.maxSecondsPerProcess*1000);
      for(const stream of [processChild.stdout,processChild.stderr])stream.on('data',d=>{if(output.length<100000)output+=d;});processChild.once('error',reject);processChild.once('exit',async code=>{clearTimeout(timer);await fs.writeFile(path.join(out,name+'.log'),output,{flag:'wx'});if(code===0)resolve();else reject(new Error(`${name} failed (${code}); see preserved log.`));});});
    const sample=JSON.parse(await fs.readFile(task.output));result.samples.push(sample);result.execution.push({pair,mode,pid:sample.pid,output:name+'.json'});console.log(`${name} complete`);
  }
  result.gate=gateSharedTransport(result.samples,protocol);await writeJsonExclusive(path.join(out,'result.json'),result);console.log(JSON.stringify(result.gate,null,2));
  await writeJsonExclusive(path.join(out,'integrity-review.json'),await verifySharedTransportRun(out));
}
if(!isMainThread){const {createStudioWorkerDispatcher}=await import(pathToFileURL(path.join(workerData.sourceRoot,'src/engine/studio-dispatcher.ts')));const dispatcher=createStudioWorkerDispatcher((m,t)=>parentPort.postMessage(m,t));parentPort.on('message',m=>dispatcher.handle(m));}
else if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2),['--out','--child','--check']);
  if(args['--child'])await child(JSON.parse(await fs.readFile(args['--child'])));else if(args['--check'])console.log(JSON.stringify(await verifySharedTransportRun(args['--check']),null,2));else if(args['--out'])await run(args['--out']);else throw new Error('--out NEW_DIRECTORY or --check RUN_DIRECTORY is required');
}
