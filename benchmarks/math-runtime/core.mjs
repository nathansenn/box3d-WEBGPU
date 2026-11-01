import {SCHEMA_VERSION,DEFAULT_SETTINGS,fixture,fixtureHash,compareSnapshots,now,yieldTask,message,sha256} from './common.mjs';
import {javascriptAdapter,wasmAdapter} from './adapters.mjs';
import {gpuSetup,gpuIdle,gpuSnapshot,stepCpu,stepGpu,cpuTiming,gpuTiming,transferTiming} from './timing.mjs';
export async function runWaterBench(options){
 const {referenceApi,gpuApi,loadWasmBytes,gpuContext=null,provenance={},onProgress=()=>{}}=options;
 const settings={...DEFAULT_SETTINGS,...options.settings},started=now(),deadline=started+settings.budgetMs;
 const report={schemaVersion:SCHEMA_VERSION,createdAt:new Date().toISOString(),status:'RUNNING',settings,settingsSha256:await sha256(JSON.stringify(settings)),provenance,
 scope:'Solver microbenchmark; no full-scene FPS or theorem-derived speedup claim.',timingCaveat:'Percentiles describe the sample set, not confidence bounds.',validationCaveat:'Finite seeded checks, not an all-input proof.',
 gpu:gpuContext?{status:'AVAILABLE',adapter:gpuContext.adapterInfo,classification:gpuContext.classification,features:[...gpuContext.device.features]}:{status:'BLOCKED',reason:options.gpuBlockedReason??'No WebGPU device.'},wasm:{},cases:[]};
 const binaries={};
 for(const variant of ['scalar','simd'])try{const bytes=await loadWasmBytes(variant);binaries[variant]=bytes;report.wasm[variant]={status:'AVAILABLE',byteLength:bytes.byteLength,sha256:await sha256(bytes)};}catch(e){report.wasm[variant]={status:'BLOCKED',reason:message(e)};}
 for(const scenario of settings.cases){
  if(now()>=deadline){report.cases.push({id:scenario.id,status:'BLOCKED',reason:'Budget reached.'});continue;}
  onProgress('Validating '+scenario.id);await yieldTask();const data=fixture(scenario,settings.seed);
  const item={id:scenario.id,grid:{cols:scenario.cols,rows:scenario.rows},cells:scenario.cols*scenario.rows,status:'RUNNING',seed:data.seed,initialStateSha256:await fixtureHash(data),params:data.params,physicalExtent:data.physicalExtent,nonzeroBoundaryHistory:true,checkedSteps:[],comparisons:[],timings:{},unavailable:[],runtimeFailures:[]};report.cases.push(item);
  await runCase(item,scenario,data,{...options,settings,deadline,binaries,report,onProgress});
 }
 report.elapsedMs=now()-started;
 report.status=report.cases.some(c=>['FAILED','NUMERICAL_FAILURE'].includes(c.status))?'FAILED':report.cases.some(c=>c.status!=='VALIDATED')?'INCOMPLETE':'COMPLETED';
 const qualified=name=>report.cases.some(c=>c.runtimeFailures?.some(f=>f.name===name)||c.failedCandidates?.includes(name)||c.timings?.[name]?.status==='FAILED')?'FAILED':report.cases.every(c=>c.timings?.[name]?.status==='MEASURED')?'RUNTIME_MEASURED':'INCOMPLETE';
 report.gpuQualification=gpuContext?qualified('webgpu-resident'):'BLOCKED';
 report.comparisonCoverage={javascript:qualified('javascript-reference'),scalarWasm:binaries.scalar?qualified('wasm-scalar'):'BLOCKED',simdWasm:binaries.simd?qualified('wasm-simd'):'BLOCKED',webgpu:report.gpuQualification};
 report.coverageCaveat='COMPLETED covers available implementations; comparisonCoverage records missing or failed backends.';
 return report;
}
async function runCase(item,scenario,data,options){
 const {referenceApi,gpuApi,gpuContext,settings,deadline,binaries,report,onProgress}=options;
 const js=javascriptAdapter(referenceApi,scenario,data),f32=javascriptAdapter(referenceApi,scenario,data,'f32'),candidates=[js];
 for(const variant of ['scalar','simd']){
  if(!binaries[variant]){item.unavailable.push({name:'wasm-'+variant,reason:report.wasm[variant].reason});continue;}
  try{candidates.push(await wasmAdapter(binaries[variant],variant,scenario,data));}catch(e){const f={name:'wasm-'+variant,reason:message(e)};item.unavailable.push(f);item.runtimeFailures.push(f);}
 }
 let gpu=null;if(gpuContext&&gpuApi)try{const start=now();gpu=await gpuSetup(gpuApi.GpuWaterCompute.create(gpuContext.device,scenario,data.initial,data.history));await gpuIdle(gpuContext.device);item.gpuSetupMs=now()-start;}catch(e){const f={name:'webgpu-resident',reason:message(e)};item.unavailable.push(f);item.runtimeFailures.push(f);}
 const failed=new Set();let completed=0;
 const compare=(step,candidate,baseline,expected,actual)=>{const r=compareSnapshots(expected,actual,settings.tolerance);item.comparisons.push({step,candidate,baseline,...r});if(!r.pass)failed.add(candidate);};
 try{
  for(const checkpoint of scenario.checkpoints){
   if(now()>=deadline)break;const delta=checkpoint-completed;
   for(const c of candidates)stepCpu(c,delta,data.params);stepCpu(f32,delta,data.params);
   const expected=js.snapshot(),rounded=f32.snapshot();compare(checkpoint,'f32-reference','javascript-reference',expected,rounded);
   for(const c of candidates.slice(1)){const actual=c.snapshot();compare(checkpoint,c.name,'javascript-reference',expected,actual);compare(checkpoint,c.name,'f32-reference',rounded,actual);}
   if(gpu&&!failed.has('webgpu-resident'))try{stepGpu(gpu,gpuContext.device,delta,data.params);const actual=await gpuSnapshot(gpu);compare(checkpoint,'webgpu-resident','javascript-reference',expected,actual);compare(checkpoint,'webgpu-resident','f32-reference',rounded,actual);}catch(e){failed.add('webgpu-resident');item.comparisons.push({step:checkpoint,candidate:'webgpu-resident',pass:false,error:message(e)});}
   completed=checkpoint;item.checkedSteps.push(checkpoint);await yieldTask();
  }
  const complete=completed===scenario.checkpoints.at(-1);onProgress('Timing '+scenario.id);
  for(const c of candidates){item.timings[c.name]=failed.has(c.name)||!complete?{status:'BLOCKED',reason:'Validation failed or incomplete.'}:cpuTiming(c,scenario,data,settings,deadline);await yieldTask();}
  if(gpu){
   if(failed.has('webgpu-resident')||!complete)item.timings['webgpu-resident']={status:'BLOCKED',reason:'Validation failed or incomplete.'};
   else try{item.timings['webgpu-resident']=await gpuTiming(gpu,gpuContext.device,scenario,data,settings,deadline);item.transfers=await transferTiming(gpu,gpuContext.device,data,settings,deadline);}catch(e){item.timings['webgpu-resident']={status:'FAILED',reason:message(e)};}
  }
  const timings=Object.values(item.timings);
  item.status=failed.size?'NUMERICAL_FAILURE':item.runtimeFailures.length||timings.some(t=>t.status==='FAILED')?'FAILED':complete&&timings.every(t=>t.status==='MEASURED')&&(!item.transfers||item.transfers.status==='MEASURED')?'VALIDATED':'INCOMPLETE';
  item.failedCandidates=[...failed];
 }catch(e){item.status='FAILED';item.reason=message(e);}
 finally{gpu?.destroy();for(const c of candidates)c.dispose();f32.dispose();}
}

