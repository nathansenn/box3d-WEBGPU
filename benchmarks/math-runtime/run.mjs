#!/usr/bin/env node
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import os from 'node:os';
import {runWaterBench} from './core.mjs';
import {runGraphBench} from './graph.mjs';
import {DEFAULT_SETTINGS,sha256} from './common.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),args=process.argv.slice(2);
const value=flag=>{const i=args.indexOf(flag);return i<0?undefined:args[i+1];},quick=args.includes('--quick');
const output=resolve(root,value('--out')??'benchmarks/math-runtime/results/node-cpu.json'),buildRoot=value('--build-root');
const load=p=>import(pathToFileURL(join(root,buildRoot?buildRoot+'/'+p.replace(/\.ts$/,'.js'):p)).href);
const referenceApi=await load('src/soft/water-reference.ts'),graphApi=await load('src/runtime/execution-graph.ts');
const paths=['src/soft/water-reference.ts','src/webgpu/water-compute.ts','src/runtime/execution-graph.ts','src/soft/kernels.ts','src/soft/simulations.ts',...['common','adapters','timing','core','graph','run'].map(n=>'benchmarks/math-runtime/'+n+'.mjs')],hashes={};
for(const path of paths)try{hashes[path]=await sha256(await readFile(join(root,path)));}catch(e){hashes[path]={unavailable:e.message};}
const report=await runWaterBench({referenceApi,loadWasmBytes:v=>readFile(join(root,'public/soft-kernels-'+v+'.wasm')),gpuBlockedReason:'CPU runner has no WebGPU device.',
 provenance:{runtime:'Node '+process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,sourceBaseCommit:process.env.BOX3D_BASE_COMMIT??null,sourceSha256:hashes,recoveryNote:'Fresh run after workspace reset; earlier raw samples were lost. Harness recovered from retained source payloads.'},
 settings:quick?{samples:7,warmupBatches:2,cases:DEFAULT_SETTINGS.cases.slice(0,2).map(c=>({...c,checkpoints:[1,2,8,64]}))}:{},onProgress:console.log});
if(!args.includes('--no-graph'))report.executionGraph=await runGraphBench(graphApi,quick?{samples:7,warmupBatches:2}:{});
if(report.executionGraph?.status==='FAILED')report.status='FAILED';
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({output,status:report.status,coverage:report.comparisonCoverage,elapsedMs:report.elapsedMs,cases:report.cases.map(c=>({id:c.id,status:c.status,p50Ms:Object.fromEntries(Object.entries(c.timings??{}).map(([n,t])=>[n,t.completion?.p50]))}))},null,2));
if(report.status==='FAILED')process.exitCode=1;

