#!/usr/bin/env node
/** Retained memory after explicit GC, not bytes allocated per step or browser memory. */
import * as fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath,pathToFileURL} from 'node:url';

const execute=promisify(execFile),self=fileURLToPath(import.meta.url);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function canonical(value){
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  return JSON.stringify(value);
}
const fileHash=async file=>hash(await fs.readFile(file));
const writeJson=(file,value)=>fs.writeFile(file,JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const SOURCE_FILES=['src/studio/physics.ts','src/studio/press-settings.ts','src/studio/solver-storage.ts'];
const PROTOCOL={schema:'box3d.studio-retained-memory/1',trials:4,instances:8,warmInstances:2,steps:16,
  studies:['canopy','plate','bridge'],modes:['worker','object-views'],gcPasses:3,
  scope:'Fresh Node process; heapUsed plus arrayBuffers retained by eight stepped instances after explicit GC',
  excludes:['allocation rate','RSS attribution','browser/worker-process memory','timing performance','thermal stability'],
  control:'same study, default controls, fixed 1/120 tick; exact final full-precision checkpoint checksum'};
function median(values){const v=[...values].sort((a,b)=>a-b),n=v.length;return n%2?v[(n-1)/2]:(v[n/2-1]+v[n/2])/2;}
function summarize(values){return {median:median(values),min:Math.min(...values),max:Math.max(...values)};}
async function verify(source,files){for(const f of files)if(await fileHash(path.join(source,f.path))!==f.sha256)throw new Error(`Changed source: ${f.path}`);}
function touchViews(sim){
  let sum=0;
  for(const n of sim.nodes)sum+=n.p[0]+n.prev[1]+n.rest[2]+n.inverseMass+n.strain;
  for(const e of sim.links)sum+=e.a+e.b+e.rest+e.original+e.stiffness+e.threshold+e.damage+e.plastic+e.dependencies.length+(e.broken?1:0)+e.kind.length;
  return sum;
}
async function worker(taskFile) {
  if(typeof global.gc!=='function')throw new Error('Memory worker requires --expose-gc');
  const task=JSON.parse(await fs.readFile(taskFile,'utf8')),p=task.protocol;
  if(JSON.stringify(p)!==JSON.stringify(PROTOCOL)||!p.studies.includes(task.study)||!p.modes.includes(task.mode))throw new Error('Invalid memory task');
  await verify(task.source,task.files);
  const {FailureSimulation}=await import(pathToFileURL(path.join(task.source,'src/studio/physics.ts')));
  const create=()=>{
    const sim=new FailureSimulation(task.study);
    for(let i=0;i<p.steps;i++)sim.step(1/120);
    if(task.mode==='object-views'&&!Number.isFinite(touchViews(sim)))throw new Error('Nonfinite compatibility state');
    return sim;
  };
  let warm=Array.from({length:p.warmInstances},create);
  if(warm.length!==p.warmInstances)throw new Error('Missing warmup');
  warm=null;
  for(let i=0;i<p.gcPasses;i++)global.gc();
  const before=process.memoryUsage();
  const simulations=Array.from({length:p.instances},create);
  for(let i=0;i<p.gcPasses;i++)global.gc();
  const after=process.memoryUsage();
  // Keep every specimen strongly reachable until after the memory sample. Checkpoints
  // and hashing allocate independent copies only after this sample has been recorded.
  const output=createHash('sha256');
  for(const sim of simulations)output.update(canonical(sim.exportCheckpoint()));
  await verify(task.source,task.files);
  const heap=after.heapUsed-before.heapUsed,arrays=after.arrayBuffers-before.arrayBuffers;
  return {schema:p.schema,side:task.side,study:task.study,mode:task.mode,trial:task.trial,pid:process.pid,
    instances:p.instances,before,after,retained:{heapBytes:heap,arrayBufferBytes:arrays,totalBytes:heap+arrays,
      bytesPerInstance:(heap+arrays)/p.instances},checkpointSha256:output.digest('hex'),
    node:process.version,execArgv:process.execArgv,platform:process.platform,arch:process.arch};
}
async function main() {
  if(process.argv[2]==='--worker'){console.log(JSON.stringify(await worker(process.argv[3])));return;}
  if(process.argv.includes('--help')){console.log('node scripts/studio-storage-memory.mjs --baseline-root FROZEN_SOURCE --candidate-root FROZEN_SOURCE --out NEW_DIRECTORY');return;}
  const args={};
  for(let i=2;i<process.argv.length;i+=2){const key=process.argv[i],value=process.argv[i+1];
    if(!['--baseline-root','--candidate-root','--out'].includes(key)||args[key]!==undefined||!value||value.startsWith('--'))throw new Error(`Invalid option ${key}`);args[key]=value;}
  for(const key of ['--baseline-root','--candidate-root','--out'])if(!args[key])throw new Error(`Missing ${key}`);
  const roots={baseline:await fs.realpath(args['--baseline-root']),candidate:await fs.realpath(args['--candidate-root'])};
  const requested=path.resolve(args['--out']);await fs.mkdir(path.dirname(requested),{recursive:true});
  const out=path.join(await fs.realpath(path.dirname(requested)),path.basename(requested));
  for(const root of Object.values(roots))if(out===root||out.startsWith(root+path.sep))throw new Error('Output must not be inside an input root');
  await fs.mkdir(out); // Exclusive reservation. A failed or partial run is retained.
  const start=Date.now();
  try {
    for(const dir of ['source','harness','tasks','raw'])await fs.mkdir(path.join(out,dir));
    const source={},inventory={};
    for(const side of ['baseline','candidate']){
      source[side]=path.join(out,'source',side);inventory[side]=[];
      for(const name of SOURCE_FILES){
        let bytes;try{bytes=await fs.readFile(path.join(roots[side],name));}catch(error){if(error.code==='ENOENT'&&name.endsWith('solver-storage.ts'))continue;throw error;}
        const destination=path.join(source[side],name);await fs.mkdir(path.dirname(destination),{recursive:true});
        await fs.writeFile(destination,bytes,{flag:'wx'});inventory[side].push({path:name,bytes:bytes.length,sha256:hash(bytes)});
      }
      await verify(roots[side],inventory[side]);
    }
    const harness=path.join(out,'harness',path.basename(self));await fs.copyFile(self,harness,fs.constants.COPYFILE_EXCL);
    await writeJson(path.join(out,'protocol.json'),PROTOCOL);
    await writeJson(path.join(out,'manifest.json'),{protocolSha256:hash(JSON.stringify(PROTOCOL)),sources:inventory,
      harnessSha256:await fileHash(harness),nodeExecutableSha256:await fileHash(process.execPath),
      node:process.version,os:os.release(),arch:process.arch,cpuModels:[...new Set(os.cpus().map(c=>c.model))]});
    const samples=[],rawFiles=[];
    for(let trial=0;trial<PROTOCOL.trials;trial++)for(const study of PROTOCOL.studies)for(const mode of PROTOCOL.modes){
      for(const side of trial%2?['candidate','baseline']:['baseline','candidate']){
        if(Date.now()-start>180000)throw new Error('Memory probe exceeded its 180 second bound');
        const name=`${trial}-${study}-${mode}-${side}`,task=path.join(out,'tasks',name+'.json');
        await writeJson(task,{protocol:PROTOCOL,side,study,mode,trial,source:source[side],files:inventory[side]});
        const {stdout}=await execute(process.execPath,['--expose-gc',harness,'--worker',task],{timeout:30000,maxBuffer:1024*1024,env:{...process.env,NODE_OPTIONS:'',NODE_NO_WARNINGS:'1'}});
        const sample=JSON.parse(stdout),relative='raw/'+name+'.json';await writeJson(path.join(out,relative),sample);
        samples.push(sample);rawFiles.push({path:relative,sha256:await fileHash(path.join(out,relative))});
      }
      console.error(`Measured ${study}/${mode} memory pair ${trial+1}/${PROTOCOL.trials}`);
    }
    const rows=[];
    for(const study of PROTOCOL.studies)for(const mode of PROTOCOL.modes){
      const group=samples.filter(s=>s.study===study&&s.mode===mode);
      if(new Set(group.map(s=>s.checkpointSha256)).size!==1)throw new Error(`Checkpoint mismatch: ${study}/${mode}`);
      const row={study,mode,baseline:{},candidate:{}};
      for(const side of ['baseline','candidate'])for(const field of ['heapBytes','arrayBufferBytes','totalBytes','bytesPerInstance'])row[side][field]=summarize(group.filter(s=>s.side===side).map(s=>s.retained[field]));
      rows.push(row);
    }
    const result={schema:PROTOCOL.schema,status:'measured',elapsedMs:Date.now()-start,protocol:PROTOCOL,rawFiles,rows,
      claim:'Retained Node heap plus array-buffer observations after explicit GC only; no allocation-rate or timing claim'};
    await writeJson(path.join(out,'result.json'),result);console.log(JSON.stringify({out,...result}));
  }catch(error){await writeJson(path.join(out,'failure.json'),{status:'failed',message:error.message,elapsedMs:Date.now()-start});throw error;}
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
