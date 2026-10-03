#!/usr/bin/env node
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { execFileSync } from 'node:child_process';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStudioSweep, validateStudioSweep } from '../src/engine/studio-sweep.ts';

export function nodeStudioWorkerFactory() {
  const worker=new Worker(new URL('./studio-sweep-worker.mjs',import.meta.url));
  const bindings=new Map();
  return {
    postMessage:(message,transfer)=>worker.postMessage(message,transfer),terminate:()=>worker.terminate(),
    addEventListener(type,listener){const wrapped=value=>listener(type==='message'?{data:value}:{message:value.message});bindings.set(listener,{type,wrapped});worker.on(type,wrapped);},
    removeEventListener(type,listener){const binding=bindings.get(listener);if(binding){worker.off(type,binding.wrapped);bindings.delete(listener);}},
  };
}
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
async function writeJson(path,value){const bytes=JSON.stringify(value,null,2)+'\n';await writeFile(path,bytes,{flag:'wx'});return sha(bytes);}

export async function runSweepCli(argv) {
  const allowed=new Set(['--input','--output','--concurrency','--sample-every','--checkpoint']);
  const args={};
  for(let i=0;i<argv.length;i++){
    const key=argv[i];if(!allowed.has(key)||key in args)throw new Error(`Unknown or repeated option: ${key}`);
    if(key==='--checkpoint'){args[key]=true;continue;}
    if(!argv[i+1]||argv[i+1].startsWith('--'))throw new Error(`Missing value for ${key}`);
    args[key]=argv[++i];
  }
  if(!args['--input']||!args['--output'])throw new Error('Usage: node scripts/studio-sweep.mjs --input cases.json --output new-results-directory [--concurrency 1..4] [--sample-every 120] [--checkpoint]');
  const inputPath=resolve(args['--input']),output=resolve(args['--output']);
  if((await stat(inputPath)).size>1024*1024)throw new Error('Sweep input exceeds 1 MiB.');
  const input=await readFile(inputPath),cases=validateStudioSweep(JSON.parse(input));
  const concurrency=Number(args['--concurrency']??2),sampleEveryTicks=Number(args['--sample-every']??120);
  if(!Number.isInteger(concurrency)||concurrency<1||concurrency>4)throw new Error('concurrency must be 1..4');
  if(!Number.isInteger(sampleEveryTicks)||sampleEveryTicks<12||sampleEveryTicks>72000||sampleEveryTicks%12)throw new Error('sample-every must be a multiple of 12 in 12..72000');
  const files=['src/studio/physics.ts','src/studio/press-settings.ts','src/engine/contracts.ts','src/engine/studio-runtime.ts','src/engine/studio-client.ts','src/engine/studio-protocol.ts','src/engine/studio-dispatcher.ts','src/engine/studio-sweep.ts','scripts/studio-sweep.mjs','scripts/studio-sweep-worker.mjs'];
  const source={};for(const file of files)source[file]=sha(await readFile(join(root,file)));
  const startedAt=new Date().toISOString();
  const manifest={schema:'box3d.studio-sweep/1',startedAt,inputSha256:sha(input),source,head:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),runtime:{node:process.version,platform:process.platform,architecture:process.arch},concurrency,sampleEveryTicks,checkpoint:!!args['--checkpoint'],cases,scope:'Independent authored Studio models; numerical parameter study, not a speed benchmark or calibrated material prediction.'};
  await mkdir(output); // Exclusive reservation: no overwrite of any existing run.
  await writeJson(join(output,'manifest.json'),manifest);
  const abort=new AbortController(),onSignal=()=>abort.abort();
  process.once('SIGINT',onSignal);process.once('SIGTERM',onSignal);
  const artifacts=[];
  try {
    const results=await runStudioSweep(cases,{concurrency,sampleEveryTicks,includeCheckpoint:!!args['--checkpoint'],retainCheckpoints:false,signal:abort.signal,
      transport:{mode:'worker',workerFactory:nodeStudioWorkerFactory},
      onResult:async(result,index)=>{
        const file=`${String(index+1).padStart(3,'0')}-${result.id}.json`;
        const hash=await writeJson(join(output,file),result);artifacts.push({index,id:result.id,status:result.status,file,sha256:hash});
        process.stdout.write(`${result.id}: ${result.status}, ${result.completedTicks}/${result.requestedTicks} ticks\n`);
      },
    });
    artifacts.sort((a,b)=>a.index-b.index);
    const summary={schema:'box3d.studio-sweep-summary/1',startedAt,finishedAt:new Date().toISOString(),status:abort.signal.aborted?'cancelled':results.some(r=>r.status==='failed')?'failed':'completed',artifacts};
    await writeJson(join(output,'summary.json'),summary);
    return summary.status==='cancelled'?130:summary.status==='failed'?1:0;
  }catch(error){
    await writeJson(join(output,'failure.json'),{finishedAt:new Date().toISOString(),error:error instanceof Error?error.message:String(error),artifacts}).catch(()=>{});
    throw error;
  }finally{process.removeListener('SIGINT',onSignal);process.removeListener('SIGTERM',onSignal);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  runSweepCli(process.argv.slice(2)).then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
}
