// Bounded profiling only: never change contact tolerances or accept unresolved collisions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {emitTypeScriptModuleTree} from './emit-typescript-module-tree.mjs';
const self=fileURLToPath(import.meta.url);
const quantile=(a,p)=>{if(!a.length)return null;const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*(s.length-1)))];};
if(process.argv[2]==='--case'){
  const [name,runtime]=process.argv.slice(3),times=[];
  let model,dt,end;
  if(name.startsWith('glass:')){
    const {createModel,DT}=await import(pathToFileURL(path.join(runtime,'materials/studio/material-labs/models.mjs')).href);
    const {LABS}=await import(pathToFileURL(path.join(runtime,'materials/studio/material-labs/catalog.mjs')).href);
    const experiment=LABS.glass.experiments[Number(name.split(':')[1])];
    model=createModel('glass',{...LABS.glass.defaults,...experiment.settings});dt=DT;end=LABS.glass.duration;
  }else{
    const {FailureSimulation,FIXED_DT,STUDIO_CANOPY_CONTACT_BACKEND}=await import(pathToFileURL(path.join(runtime,'studio/studio/physics.mjs')).href);
    model=new FailureSimulation('canopy',undefined,STUDIO_CANOPY_CONTACT_BACKEND);model.targetLoad=Number(name.split(':')[1]);dt=FIXED_DT;end=16;
  }
  const time=()=>model.frame?.time??model.time;
  let step=0;
  while(time()<end-dt/2){
    const start=performance.now();model.step(dt);times.push(performance.now()-start);step++;
    const positions=model.frame?.positions??model.nodes?.flatMap(n=>n.p);
    if(positions&&!positions.every(Number.isFinite))throw new Error('Nonfinite authoritative positions');
    process.send?.({step,simulatedSeconds:time(),lastStepMs:times.at(-1)});
  }
  process.send?.({complete:true,simulatedSeconds:time(),steps:step,p50Ms:quantile(times,.5),p95Ms:quantile(times,.95),p99Ms:quantile(times,.99),maxMs:Math.max(...times)});
}else{
  const runtime=fs.mkdtempSync(path.join(os.tmpdir(),'box3d-contact-budget-'));
  const result={scope:'Single-host bounded baseline; no speedup claim',node:process.version,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,stepBudgetMs:1000/120,cases:[]};
  try{
    for(const [entry,folder] of [['studio/material-labs/models.ts','materials'],['studio/physics.ts','studio']])emitTypeScriptModuleTree({sourceRoot:path.resolve('src'),outputRoot:path.join(runtime,folder),entry});
    result.sourceHashes=Object.fromEntries(['src/engine/convex-contact.ts','src/studio/physics.ts','src/studio/material-labs/models.ts'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')]));
    const timeout=Number(process.env.BOX3D_CONTACT_TIMEOUT_MS||15000);
    if(!Number.isFinite(timeout)||timeout<1000||timeout>120000)throw new Error('Contact deadline must be 1000..120000 ms');
    for(const name of [...Array.from({length:8},(_,i)=>'glass:'+i),'canopy:0.8','canopy:4']){
      const row=await new Promise(resolve=>{
        const started=performance.now(),samples=[];let latest={},complete=null,timedOut=false,stderr='';
        const child=spawn(process.execPath,[self,'--case',name,runtime],{stdio:['ignore','ignore','pipe','ipc']});
        const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},timeout);
        child.stderr.on('data',chunk=>{stderr=(stderr+chunk).slice(-5000);});
        child.on('message',m=>{latest=m;if(m.complete)complete=m;else samples.push(m.lastStepMs);});
        child.on('error',error=>{clearTimeout(timer);resolve({name,status:'error',error:String(error)});});
        child.on('exit',(code,signal)=>{clearTimeout(timer);resolve({name,status:timedOut?'deadline-exceeded':code===0&&complete?'completed':'failed',elapsedMs:performance.now()-started,code,signal,stderr,simulatedSeconds:latest.simulatedSeconds??0,steps:samples.length,p50Ms:quantile(samples,.5),p95Ms:quantile(samples,.95),p99Ms:quantile(samples,.99),maxMs:samples.length?Math.max(...samples):null,...(complete?{complete}:{}),samples});});
      });
      result.cases.push(row);console.log(JSON.stringify({...row,samples:undefined}));
    }
  }finally{
    const output=path.resolve(process.env.BOX3D_CONTACT_OUTPUT||path.join(os.tmpdir(),'box3d-contact-budget.json'));fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(result,null,2));fs.rmSync(runtime,{recursive:true,force:true});console.log(`Contact baseline: ${output}`);
  }
  if(result.cases.some(row=>row.status==='failed'||row.status==='error'))process.exitCode=1;
}
