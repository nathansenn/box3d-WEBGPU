import {distribution,now,message} from './common.mjs';
export function timeout(promise,ms,label){let timer;return Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label+' exceeded '+ms+' ms')),ms);})]).finally(()=>clearTimeout(timer));}
export const gpuIdle=device=>timeout(device.queue.onSubmittedWorkDone(),15000,'GPU completion');
export const gpuSnapshot=gpu=>timeout(gpu.readback(),15000,'GPU readback');
export async function gpuSetup(promise,label='GPU setup'){try{return await timeout(promise,20000,label);}catch(e){void promise.then(r=>r.destroy(),()=>{}).catch(()=>{});throw e;}}
export function stepCpu(adapter,steps,params){for(let i=0;i<steps;i++)adapter.step(params);}
export function stepGpu(gpu,device,steps,params){for(let start=0;start<steps;start+=32){const encoder=device.createCommandEncoder();for(let i=0;i<Math.min(32,steps-start);i++)gpu.encodeStep(encoder,params);device.queue.submit([encoder.finish()]);}}
export function cpuTiming(adapter,scenario,data,settings,deadline){
 for(let i=0;i<settings.warmupBatches;i++){adapter.reset();stepCpu(adapter,scenario.batchSteps,data.params);}
 const samples=[];for(let i=0;i<settings.samples&&now()<deadline;i++){adapter.reset();const start=now();stepCpu(adapter,scenario.batchSteps,data.params);samples.push(now()-start);}
 return {status:samples.length===settings.samples?'MEASURED':'INCOMPLETE',method:'Resident arrays; reset outside timer.',batchSteps:scenario.batchSteps,warmupBatches:settings.warmupBatches,completion:distribution(samples,scenario.batchSteps),includes:['kernel','API call','bank swap'],excludes:['initialization','reset','readback','rendering','forcing','floaters','droplets']};
}
async function readTimestamp(device,r){
 const encoder=device.createCommandEncoder();encoder.resolveQuerySet(r.querySet,0,2,r.resolve,0);encoder.copyBufferToBuffer(r.resolve,0,r.read,0,16);device.queue.submit([encoder.finish()]);
 await timeout(r.read.mapAsync(GPUMapMode.READ),15000,'Timestamp map');
 try{const a=new BigUint64Array(r.read.getMappedRange());if(a[1]<a[0])throw new Error('Non-monotonic timestamps');return Number(a[1]-a[0])/1e6;}finally{r.read.unmap();}
}
export async function gpuTiming(gpu,device,scenario,data,settings,deadline){
 const timestamp=device.features.has('timestamp-query')?{querySet:device.createQuerySet({type:'timestamp',count:2}),resolve:device.createBuffer({size:16,usage:GPUBufferUsage.QUERY_RESOLVE|GPUBufferUsage.COPY_SRC}),read:device.createBuffer({size:16,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ})}:null;
 const samples={encode:[],submit:[],cpuSubmission:[],completion:[],gpu:[]},timestampErrors=[];
 try{
  for(let i=0;i<settings.warmupBatches;i++){gpu.reset(data.initial,data.history);await gpuIdle(device);stepGpu(gpu,device,scenario.batchSteps,data.params);await gpuIdle(device);}
  for(let i=0;i<settings.samples&&now()<deadline;i++){
   gpu.reset(data.initial,data.history);await gpuIdle(device);const start=now(),encoder=device.createCommandEncoder();
   for(let step=0;step<scenario.batchSteps;step++)gpu.encodeStep(encoder,data.params,timestamp&&(step===0||step===scenario.batchSteps-1)?{querySet:timestamp.querySet,...(step===0?{beginIndex:0}:{}),...(step===scenario.batchSteps-1?{endIndex:1}:{})}:undefined);
   const commands=encoder.finish(),encoded=now();device.queue.submit([commands]);const submitted=now();await gpuIdle(device);const finished=now();
   samples.encode.push(encoded-start);samples.submit.push(submitted-encoded);samples.cpuSubmission.push(submitted-start);samples.completion.push(finished-start);
   if(timestamp)try{samples.gpu.push(await readTimestamp(device,timestamp));}catch(e){timestampErrors.push(message(e));}
  }
 }finally{timestamp?.querySet.destroy();timestamp?.resolve.destroy();timestamp?.read.destroy();}
 return {status:samples.completion.length===settings.samples?'MEASURED':'INCOMPLETE',method:'GPU-resident ordered four-phase steps; one submission per batch.',batchSteps:scenario.batchSteps,warmupBatches:settings.warmupBatches,
 cpuEncode:distribution(samples.encode,scenario.batchSteps),cpuSubmitCall:distribution(samples.submit,scenario.batchSteps),cpuSubmission:distribution(samples.cpuSubmission,scenario.batchSteps),wallCompletion:distribution(samples.completion,scenario.batchSteps),gpuTimestamp:distribution(samples.gpu,scenario.batchSteps),
 gpuTimestampStatus:!timestamp?'UNAVAILABLE':!timestampErrors.length&&samples.gpu.length>0&&samples.gpu.length===settings.samples?'MEASURED':'INCOMPLETE',timestampErrors,
 timestampScope:'First velocity pass through final column pass; query resolution excluded.',comparison:'GPU timestamps alone are not end-to-end speedup.',excludes:['upload/reset','readback','rendering','forcing','floaters','droplets']};
}
export async function transferTiming(gpu,device,data,settings,deadline){
 const uploadCpu=[],uploadWall=[],readbackWall=[];await gpuIdle(device);
 for(let i=0;i<settings.transferSamples&&now()<deadline;i++){const start=now();gpu.reset(data.initial,data.history);const queued=now();await gpuIdle(device);uploadCpu.push(queued-start);uploadWall.push(now()-start);const begin=now();await gpuSnapshot(gpu);readbackWall.push(now()-begin);}
 const as=(v,unit)=>v.length?{...distribution(v),unit}:null;
 return {status:readbackWall.length===settings.transferSamples?'MEASURED':'INCOMPLETE',bytesPerState:data.initial.eta.byteLength*6,buffersPerState:6,uploadCpu:as(uploadCpu,'ms/upload'),uploadWall:as(uploadWall,'ms/upload'),readbackWall:as(readbackWall,'ms/readback'),scope:'Six arrays, separate from resident-kernel timing.'};
}

