import * as referenceApi from '../../src/soft/water-reference.ts';
import * as gpuApi from '../../src/webgpu/water-compute.ts';
import * as graphApi from '../../src/runtime/execution-graph.ts';
import {runWaterBench} from './core.mjs';
import {runGraphBench} from './graph.mjs';
import {runGpuConformance} from './conformance.mjs';
import {timeout} from './timing.mjs';
import {DEFAULT_SETTINGS,hardwareClassification,sha256,message} from './common.mjs';
const start=document.querySelector('#run'),download=document.querySelector('#download'),status=document.querySelector('#status'),details=document.querySelector('#details'),rows=document.querySelector('#results'),base=new URL('../../',import.meta.url);
async function sourceHashes(){const hashes={};for(const path of ['src/soft/water-reference.ts','src/webgpu/water-compute.ts','src/runtime/execution-graph.ts',...['common','adapters','timing','core','graph','conformance','browser'].map(n=>'benchmarks/math-runtime/'+n+'.mjs')])try{const r=await import(new URL(path+'?raw',base).href);hashes[path]=await sha256(r.default);}catch(e){hashes[path]={unavailable:message(e)};}return hashes;}
async function deviceContext(){
 if(!navigator.gpu)return {reason:'navigator.gpu unavailable'};
 const adapter=await timeout(navigator.gpu.requestAdapter({powerPreference:'high-performance'}),15000,'Adapter request');if(!adapter)return {reason:'requestAdapter returned null.'};
 const info=adapter.info??{},adapterInfo=Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,info[k]??'']));
 adapterInfo.isFallbackAdapter=adapter.isFallbackAdapter??info.isFallbackAdapter??null;
 const device=await timeout(adapter.requestDevice({requiredFeatures:adapter.features.has('timestamp-query')?['timestamp-query']:[]}),15000,'Device request');
 return {context:{device,adapterInfo,classification:hardwareClassification(adapterInfo)}};
}
export async function runBrowserBench({quick=false}={}){
 start.disabled=true;download.disabled=true;let context=null,blocked='';const errors=[];
 try{
  try{const r=await deviceContext();context=r.context??null;blocked=r.reason??'';}catch(e){blocked=message(e);}
  context?.device.addEventListener('uncapturederror',e=>errors.push(e.error.message));
  const conformance=await runGpuConformance({referenceApi,gpuApi,gpuContext:context});
  const report=await runWaterBench({referenceApi,gpuApi,gpuContext:context,gpuBlockedReason:blocked,loadWasmBytes:async v=>{const r=await fetch(new URL('soft-kernels-'+v+'.wasm',base));if(!r.ok)throw new Error('WASM HTTP '+r.status);return r.arrayBuffer();},
   settings:quick?{samples:7,warmupBatches:2,transferSamples:3,cases:DEFAULT_SETTINGS.cases.slice(0,2).map(c=>({...c,checkpoints:[1,2,8,64]}))}:{},
   provenance:{runtime:'browser',userAgent:navigator.userAgent,secureContext:isSecureContext,crossOriginIsolated,visibilityAtStart:document.visibilityState,devicePixelRatio,sourceSha256:await sourceHashes(),recoveryNote:'Fresh run after workspace reset; earlier raw samples were lost. Recovered harness.'},onProgress:t=>status.textContent=t});
  report.executionGraph=await runGraphBench(graphApi,quick?{samples:7,warmupBatches:2}:{});
  report.gpuConformance=conformance;report.gpuValidationErrors=errors;report.provenance.visibilityAtEnd=document.visibilityState;
  if(errors.length||conformance.status==='FAILED'){report.status='FAILED';report.gpuQualification='FAILED';report.comparisonCoverage.webgpu='FAILED';}
  if(report.executionGraph.status==='FAILED')report.status='FAILED';
  window.__BOX3D_MATH_BENCH_RESULT__=report;rows.replaceChildren();
  for(const c of report.cases)for(const [name,t] of Object.entries(c.timings??{})){
   const tr=document.createElement('tr'),v=t.completion??t.wallCompletion;
   for(const text of [c.id,name,t.status,...['p50','p95','p99'].map(k=>v?.[k]?.toFixed(6)??'—'),t.gpuTimestamp?.p50?.toFixed(6)??'—']){const td=document.createElement('td');td.textContent=text;tr.append(td);}rows.append(tr);
  }
  details.textContent=JSON.stringify({status:report.status,gpu:report.gpu,coverage:report.comparisonCoverage,validation:report.cases.map(c=>({id:c.id,status:c.status,unavailable:c.unavailable})),graph:report.executionGraph},null,2);
  status.textContent=report.status+' · GPU '+report.gpuQualification+' ('+(context?.classification??'unavailable')+')';download.disabled=false;return report;
 }finally{context?.device.destroy();start.disabled=false;}
}
window.runBox3dMathBenchmark=runBrowserBench;
start.onclick=()=>runBrowserBench({quick:document.querySelector('#quick').checked}).catch(e=>status.textContent=message(e));
download.onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(window.__BOX3D_MATH_BENCH_RESULT__,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download='box3d-math-runtime.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

