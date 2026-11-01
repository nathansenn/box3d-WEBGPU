#!/usr/bin/env node
/** Concurrent publication qualification. Retains new runs only; no throughput claim. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
import {createHash} from 'node:crypto';
import {inventory,LIMITS,parseArgs,reserveRunDirectory,writeJsonExclusive,observeEnvironment} from './engine-baseline.mjs';
const yieldOnce=()=>new Promise(resolve=>setImmediate(resolve));
async function producer(task){
  const {StudioSharedWriter}=await import(pathToFileURL(path.join(task.sourceRoot,'src/engine/studio-shared.ts')));
  const writer=new StudioSharedWriter(task.protocol.dimensions,task.protocol.generation);let sequence=0,running=false;
  parentPort.postMessage({type:'ready',descriptor:writer.descriptor});
  async function pump(){
    if(running)return;running=true;
    try{
      while(sequence<task.protocol.snapshots){
        let w;try{w=writer.acquire();}catch(error){if(error.code==='BACKPRESSURE')break;throw error;}
        const value=++sequence;
        w.buffers.positions.fill(value);
        if(value%task.protocol.writerYieldEvery===0)await yieldOnce();
        w.buffers.strains.fill(value+.5);w.buffers.broken.fill(value%2);
        parentPort.postMessage({type:'snapshot',value,ticket:writer.publish(w,value*120)});
      }
    }catch(error){parentPort.postMessage({type:'failure',message:error.stack});}
    finally{running=false;}
  }
  parentPort.on('message',message=>{
    if(message.type==='drain')void pump();
    if(message.type==='finish'){parentPort.postMessage({type:'finished',published:sequence,stats:writer.diagnostics()});writer.close();}
  });
  await pump();
}
async function qualify(output){
  const root=process.cwd(),out=await reserveRunDirectory(output,[root]);
  const inputs=['src/engine/studio-shared.ts','src/engine/contracts.ts','src/studio/physics.ts','src/studio/press-settings.ts'];
  const source=await inventory(root,inputs,LIMITS.sourceBytes);await fs.mkdir(path.join(out,'source'));
  for(const f of source.files){const dest=path.join(out,'source',f.path);await fs.mkdir(path.dirname(dest),{recursive:true});await fs.copyFile(path.join(root,f.path),dest,fs.constants.COPYFILE_EXCL);}
  assert.deepEqual(await inventory(path.join(out,'source'),['.'],LIMITS.sourceBytes),source);
  await fs.mkdir(path.join(out,'harness'));
  for(const name of ['studio-shared-stress.mjs','engine-baseline.mjs'])await fs.copyFile(path.join(root,'scripts',name),path.join(out,'harness',name),fs.constants.COPYFILE_EXCL);
  const harness=await inventory(path.join(out,'harness'),['.'],LIMITS.sourceBytes);
  const {FailureSimulation}=await import(pathToFileURL(path.join(out,'source/src/studio/physics.ts'))),snapshot=new FailureSimulation('canopy').snapshot();
  const protocol={snapshots:131072,dimensions:{positions:snapshot.positions.length,strains:snapshot.strains.length,broken:snapshot.broken.length},generation:2**32+41,writerYieldEvery:31,readerYieldEvery:17,maxSeconds:90};
  await writeJsonExclusive(path.join(out,'protocol.json'),protocol);
  const {StudioSharedReader}=await import(pathToFileURL(path.join(out,'source/src/engine/studio-shared.ts')));
  const worker=new Worker(path.join(out,'harness/studio-shared-stress.mjs'),{workerData:{sourceRoot:path.join(out,'source'),protocol}});
  let reader,received=0,delayedReads=0,checks=0;const observed=new Uint8Array(protocol.snapshots+1),digest=createHash('sha256'),samples=[];
  const started=performance.now();
  const validate=(lease,value)=>{
    for(const n of lease.buffers.positions){assert.equal(n,value);checks++;}
    for(const n of lease.buffers.strains){assert.equal(n,value+.5);checks++;}
    for(const n of lease.buffers.broken){assert.equal(n,value%2);checks++;}
  };
  try{
    const finished=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('Concurrent shared publication exceeded its declared deadline.')),protocol.maxSeconds*1000);
      worker.once('error',reject);worker.once('exit',code=>{if(code!==0)reject(new Error(`Stress worker exited ${code}`));});
      worker.on('message',message=>{void (async()=>{
        if(message.type==='ready'){reader=new StudioSharedReader(message.descriptor,protocol.generation);return;}
        if(message.type==='failure')throw new Error(message.message);
        if(message.type==='finished'){clearTimeout(timer);resolve(message);return;}
        assert.equal(message.type,'snapshot');assert.ok(reader);assert.ok(message.value>=1&&message.value<=protocol.snapshots);assert.equal(observed[message.value],0);observed[message.value]=1;
        const lease=reader.acquire(message.ticket);assert.equal(message.ticket.tick,message.value*120);validate(lease,message.value);
        digest.update(`${message.value}:${message.ticket.slot}:${message.ticket.sequence}\n`);
        if(message.value%protocol.readerYieldEvery===0){await yieldOnce();validate(lease,message.value);delayedReads++;}
        lease.release();received++;
        if(received%1024===0)samples.push({received,sharedBytes:reader.diagnostics().bytes});
        worker.postMessage({type:received===protocol.snapshots?'finish':'drain'});
      })().catch(error=>{clearTimeout(timer);reject(error);});});
    });
    assert.equal(finished.published,protocol.snapshots);assert.equal(received,protocol.snapshots);assert.equal(finished.stats.outstanding,0);assert.equal(finished.stats.retired,0);
    const result={schema:'box3d.shared-snapshot-stress/1',status:'pass',protocol,source,harness,environment:await observeEnvironment(),snapshots:received,delayedReads,scalarChecks:checks,tornReads:0,slots:finished.stats.slots,sharedBytes:finished.stats.bytes,outstandingAtFinish:0,ticketTraceSha256:digest.digest('hex'),samples,elapsedMs:performance.now()-started,scope:'Concurrent bounded ownership and publication correctness, including asynchronous writer/reader yields. Not a controlled throughput benchmark.'};
    await writeJsonExclusive(path.join(out,'result.json'),result);console.log(JSON.stringify({out,status:result.status,snapshots:received,delayedReads,checks,sharedBytes:result.sharedBytes,elapsedMs:result.elapsedMs}));
  }catch(error){await writeJsonExclusive(path.join(out,'failure.json'),{status:'failed',message:error.stack,received,elapsedMs:performance.now()-started});throw error;}
  finally{reader?.close();await worker.terminate();}
}
if(!isMainThread)await producer(workerData);
else if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2),['--out']);if(!args['--out'])throw new Error('--out NEW_DIRECTORY is required');await qualify(args['--out']);
}
