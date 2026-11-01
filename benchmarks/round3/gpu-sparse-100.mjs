import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { openRuntime } from './hardware-runtime.mjs';
import { planSparseRecordUpload } from './sparse-upload.ts';

const root = process.env.APEX_ROUND3_OUTPUT || '/workspace/round3-gpu-results-20261102';
const deadline = Date.parse(process.env.APEX_ROUND3_DEADLINE || '');
const sha = v => createHash('sha256').update(v).digest('hex');
const emit = event => console.log('APEX_ROUND3 ' + JSON.stringify({ at: new Date().toISOString(), ...event }));
let stopping = false;
process.on('SIGTERM', () => { stopping = true; });
const guard = () => { if(stopping || !Number.isFinite(deadline) || Date.now() >= deadline) throw new Error('Deadline or stop signal reached'); };
const families = ['matrix-contiguous','matrix-scattered','matrix-strided','matrix-clustered','color-contiguous','color-scattered','dual-scattered','dense-burst','static-control','proof-missing'];
const sizes = [257,513,1025,2049,4097,8193,16385,32769,65536,65536];
const conditions = families.flatMap((family,f) => sizes.map((count,i) => ({
 id:'R3-'+String(f*10+i+1).padStart(3,'0'),family,count,
 fraction:family==='static-control'?0:family==='dense-burst'?0.75:[0.005,0.01,0.015,0.03,0.05,0.1,0.15,0.25,0.4,0.6][i],
 pattern:family.includes('contiguous')?'contiguous':family.includes('strided')?'strided':family.includes('clustered')?'clustered':'scattered',
 matrix:family.startsWith('matrix')||family.startsWith('dual')||family==='dense-burst'||family==='proof-missing',
 color:family.startsWith('color')||family.startsWith('dual')||family==='dense-burst',
 gapRecords:[0,1,4,16,64][i%5]
})));
if(conditions.length!==100||!conditions.every(x=>x.count>0))throw new Error('Exactly 100 predeclared cases required');

const quantile = (a,p) => {const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.floor(p*(s.length-1)))];};
const median = a => quantile(a,.5);
const signP = ratios => {
 let n=ratios.length,w=ratios.filter(r=>r>1).length,choose=1,sum=0;
 for(let k=0;k<=n;k++){if(k>=w)sum+=choose;choose=choose*(n-k)/(k+1);}
 return sum/2**n;
};
function indices(spec,frame,seed) {
 const n=spec.count,k=Math.min(n,Math.ceil(n*spec.fraction)),s=(seed+frame*1973)>>>0;
 if(k===0)return[];
 const set=new Set();
 for(let j=0;j<k;j++) {
  let index;
  if(spec.pattern==='contiguous')index=(s%n+j)%n;
  else if(spec.pattern==='clustered')index=(s+(j%4)*Math.floor(n/4)+Math.floor(j/4))%n;
  else if(spec.pattern==='strided')index=(s+j*Math.max(1,Math.floor(n/k)))%n;
  else index=(s+j*7919)%n;
  set.add(index);
 }
 return [...set];
}
function state(n) {
 const m=new Float32Array(n*16),c=new Float32Array(n*4),columns=Math.ceil(Math.sqrt(n));
 for(let i=0;i<n;i++){
  const o=i*16; m[o]=m[o+5]=m[o+10]=m[o+15]=1;
  m[o+12]=-0.95+1.9*(i%columns)/columns;
  m[o+13]=-0.95+1.9*Math.floor(i/columns)/columns;
  c[i*4]=((i*7)%251)/251;c[i*4+1]=((i*23)%247)/247;c[i*4+2]=((i*41)%239)/239;c[i*4+3]=1;
 }
 return {m,c};
}
function mutate(data,spec,frame,seed){
 const ids=indices(spec,frame,seed);
 for(const i of ids) {
  if(spec.matrix){data.m[i*16+12]+=0.0009*((i+frame)%5+1);data.m[i*16+13]-=0.0003*(frame%3+1);}
  if(spec.color){data.c[i*4]=Math.fround((data.c[i*4]+0.004)%1);data.c[i*4+1]=Math.fround((data.c[i*4+1]+0.007)%1);}
 }
 return ids.map(start=>({start,count:1}));
}
const wgsl=String.raw`
@group(0) @binding(0) var<storage, read> models: array<mat4x4<f32>>;
@group(0) @binding(1) var<storage, read> colors: array<vec4<f32>>;
struct Output { @builtin(position) pos: vec4<f32>, @location(0) color: vec4<f32> };
@vertex fn vs(@builtin(vertex_index) v:u32,@builtin(instance_index) i:u32) -> Output {
 let corners=array<vec2<f32>,3>(vec2<f32>(-0.004,-0.004),vec2<f32>(0.004,-0.004),vec2<f32>(0.0,0.004));
 let center=models[i][3].xy;
 var o:Output;o.pos=vec4<f32>(center+corners[v%3u],0.0,1.0);o.color=colors[i];return o;
}
@fragment fn fs(i:Output)->@location(0) vec4<f32>{return i.color;}
`;
async function main(){
 guard(); if(deadline-Date.now()>45*60000)throw new Error('New round requires a <=45-minute deadline');
 await mkdir(root,{recursive:false,mode:0o700});await mkdir(root+'/cases',{mode:0o700});
 const files=['gpu-sparse-100.mjs','sparse-upload.ts','hardware-runtime.mjs'], sources={};
 for(const f of files)sources[f]=sha(await readFile(new URL('./'+f,import.meta.url)));
 const plan={schema:'apex.round3.100.v1',sourceHashes:sources,conditions,comparison:'same complete eight changing-frame offscreen windows, AB/BA pairs; static controls explicitly declared',
  screeningPairs:0,confirmationPairs:24,confirmationSets:2,holmTests:200,alpha:.05,improvementThreshold:1.03,tailLimit:1.10,
  scope:'Synthetic sparse state update and rendering fixture on physical NVIDIA native Dawn/Vulkan. Not production scene FPS or cross-device qualification.'};
 await writeFile(root+'/plan.json',JSON.stringify(plan,null,2));
 emit({event:'start',cases:100,sourceHashes:sources,deadline:new Date(deadline).toISOString()});
 const runtime=await openRuntime({width:128,height:128,packageRoot:'/workspace/benchmark-tools/webgpu'});
 let device;
 try{
  const adapter=await navigator.gpu.requestAdapter();
  if(!adapter||!adapter.features.has('timestamp-query'))throw new Error('Physical timestamp-capable adapter required');
  device=await adapter.requestDevice({requiredFeatures:['timestamp-query']});
  const context=runtime.canvas.getContext('webgpu');
  context.configure({device,format:'rgba8unorm'});
  const module=device.createShaderModule({code:wgsl});
  const pipeline=device.createRenderPipeline({layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format:'rgba8unorm'}]},primitive:{topology:'triangle-list'}});
  const error=await (async()=>{device.pushErrorScope('validation');device.createCommandEncoder().finish();return await device.popErrorScope();})();
  if(error)throw new Error('WebGPU validation preflight: '+error.message);
  const usage=GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC;
  function make(n){
   const m=device.createBuffer({size:n*64,usage}),c=device.createBuffer({size:n*16,usage});
   const bind=device.createBindGroup({layout:pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:m}},{binding:1,resource:{buffer:c}}]});
   return {m,c,bind};
  }
  const done=()=>device.queue.onSubmittedWorkDone();
  function initial(target,data){device.queue.writeBuffer(target.m,0,data.m);device.queue.writeBuffer(target.c,0,data.c);}
  function draw(target,count){
   const e=device.createCommandEncoder(),p=e.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
   p.setPipeline(pipeline);p.setBindGroup(0,target.bind);p.draw(3,count);p.end();device.queue.submit([e.finish()]);
  }
  async function capture(target) {
   const b=device.createBuffer({size:128*128*4,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),e=device.createCommandEncoder();
   e.copyTextureToBuffer({texture:context.getCurrentTexture()},{buffer:b,bytesPerRow:512,rowsPerImage:128},[128,128]);device.queue.submit([e.finish()]);
   await b.mapAsync(GPUMapMode.READ);const hash=sha(Buffer.from(b.getMappedRange()));b.unmap();b.destroy();return hash;
  }
  async function bufferHash(source,size) {
   const b=device.createBuffer({size,usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),e=device.createCommandEncoder();
   e.copyBufferToBuffer(source,0,b,0,size);device.queue.submit([e.finish()]);
   await b.mapAsync(GPUMapMode.READ);const hash=sha(Buffer.from(b.getMappedRange()));b.unmap();b.destroy();return hash;
  }
  function update(target,data,spec,frame,seed,candidate){
   const spans=mutate(data,spec,frame,seed);
   let bytes=0,calls=0;
   for(const [key,changed,recordBytes,buffer] of [['m',spec.matrix,64,target.m],['c',spec.color,16,target.c]]){
    if(!changed||!spans.length)continue;
    const source=data[key];
    const allowSparse=candidate&&spec.family!=='proof-missing';
    const plan=allowSparse?planSparseRecordUpload(spec.count,recordBytes,spans,{gapRecords:spec.gapRecords}):
     {spans:[{start:0,count:spec.count}],writtenBytes:spec.count*recordBytes};
    for(const range of plan.spans) {
     const from=range.start*recordBytes,to=from+range.count*recordBytes;
     device.queue.writeBuffer(buffer,from,source.buffer,source.byteOffset+from,to-from);calls++;
    }
    bytes+=plan.writtenBytes;
   }
   draw(target,spec.count);
   return {bytes,calls};
  }
  async function run(target,spec,candidate,seed,firstFrame){
   guard();
   const data=state(spec.count);initial(target,data);await done();
   const started=performance.now();let bytes=0,calls=0;
   for(let j=0;j<8;j++){const r=update(target,data,spec,firstFrame+j,seed,candidate);bytes+=r.bytes;calls+=r.calls;}
   await done();return {ms:(performance.now()-started)/8,bytes,calls};
  }
  async function validate(a,b,spec,seed){
   const da=state(spec.count),db=state(spec.count);initial(a,da);initial(b,db);await done();
   for(let frame=0;frame<8;frame++){
    update(a,da,spec,100000+frame,seed,false);const ha=await capture(a);
    update(b,db,spec,100000+frame,seed,true);const hb=await capture(b);
    if(ha!==hb)throw new Error('Image readback mismatch at frame '+frame);
   }
   const hashesA=[await bufferHash(a.m,spec.count*64),await bufferHash(a.c,spec.count*16)];
   const hashesB=[await bufferHash(b.m,spec.count*64),await bufferHash(b.c,spec.count*16)];
   if(hashesA.some((hash,i)=>hash!==hashesB[i]))throw new Error('Complete GPU storage mismatch');
   return {frames:8,imagesExact:true,stateExact:true};
  }
  const probe=make(257);initial(probe,state(257));draw(probe,257);await done();
  await runtime.finalizeIdentity();
  probe.m.destroy();probe.c.destroy();
  emit({event:'hardware',verified:runtime.meta.identityVerification.verified,gpu:runtime.meta.visibleGpus.map(g=>({name:g.name,uuid:g.uuid,driver:g.driver_version})),adapter:runtime.meta.adapter});
  await writeFile(root+'/hardware.json',JSON.stringify(runtime.meta,null,2));
  const results=[];let checks=0;
  for(let t=0;t<conditions.length;t++){
   guard();const spec=conditions[t],a=make(spec.count),b=make(spec.count);
   const row={id:spec.id,family:spec.family,count:spec.count,fraction:spec.fraction,sets:[],validation:[],status:'complete'};
   try{
    for(let set=0;set<2;set++){
     guard();const seed=(0x62a19237+set*5000003+t*7919)>>>0;
     row.validation.push(await validate(a,b,spec,seed));checks+=8;
     for(let warm=0;warm<2;warm++){await run(a,spec,false,seed,7000+warm*8);await run(b,spec,true,seed,7000+warm*8);}
     const samples=[];
     for(let pair=0;pair<24;pair++){
      guard();const firstFrame=20000+set*100000+pair*8;
      const reverse=((seed+pair*0x9e3779b1)>>>0)&1;
      let base,candidate;
      if(reverse){candidate=await run(b,spec,true,seed,firstFrame);base=await run(a,spec,false,seed,firstFrame);}
      else{base=await run(a,spec,false,seed,firstFrame);candidate=await run(b,spec,true,seed,firstFrame);}
      samples.push({base:base.ms,candidate:candidate.ms,ratio:base.ms/candidate.ms,reverse:!!reverse,baseBytes:base.bytes,candidateBytes:candidate.bytes,baseCalls:base.calls,candidateCalls:candidate.calls});
     }
     const ratios=samples.map(s=>s.ratio),baseline=samples.map(s=>s.base),candidate=samples.map(s=>s.candidate);
     row.sets.push({seed,samples,medianRatio:median(ratios),signP:signP(ratios),p95Ratio:quantile(candidate,.95)/quantile(baseline,.95)});
    }
   }catch(e){row.status='invalid';row.error=String(e.message||e);}
   finally{a.m.destroy();a.c.destroy();b.m.destroy();b.c.destroy();}
   const bytes=Buffer.from(JSON.stringify(row)),path=root+'/cases/'+spec.id+'.json';
   await writeFile(path,bytes,{mode:0o600});
   results.push({id:row.id,status:row.status,error:row.error||null,medianRatios:row.sets.map(s=>s.medianRatio),signP:row.sets.map(s=>s.signP),p95:row.sets.map(s=>s.p95Ratio),sha256:sha(bytes)});
   if((t+1)%10===0)emit({event:'progress',complete:t+1,valid:results.filter(x=>x.status==='complete').length,invalid:results.filter(x=>x.status!=='complete').length,checks});
  }
  const tests=results.flatMap((r,i)=>[0,1].map(j=>({id:i*2+j,p:r.signP[j]??1,case:i,set:j}))).sort((a,b)=>a.p-b.p);
  let pass=true;const accepted=new Set();
  for(let i=0;i<tests.length;i++){const v=tests[i];if(pass&&v.p<=.05/(tests.length-i))accepted.add(v.id);else pass=false;}
  const classification=results.map((r,i)=>{
   const good=r.status==='complete'&&r.medianRatios.every(v=>v>1.03)&&r.p95.every(v=>v<=1.10)&&accepted.has(i*2)&&accepted.has(i*2+1);
   const regressed=r.status==='complete'&&r.medianRatios.every(v=>v<0.97);
   return{id:r.id,status:r.status==='invalid'?'invalid':good?'qualified':regressed?'regression':'unresolved',ratios:r.medianRatios,p95:r.p95,source:r.sha256,error:r.error};
  });
  const summary={schema:'apex.round3.100.final.v1',finishedAt:new Date().toISOString(),sourceHashes:sources,gpu:runtime.meta.visibleGpus[0].name,hardwareVerified:true,conditions:100,completed:results.filter(x=>x.status==='complete').length,invalid:results.filter(x=>x.status!=='complete').length,
   qualified:classification.filter(x=>x.status==='qualified').length,regressions:classification.filter(x=>x.status==='regression').length,unresolved:classification.filter(x=>x.status==='unresolved').length,exactOutputFramesChecked:checks,classification,rawExportVerified:false,
   metric:'complete eight-frame CPU-update + GPU upload + render + queue completion window, per-frame average. Not FPS.'};
  await writeFile(root+'/final.json',JSON.stringify(summary,null,2));
  emit({event:'final',completed:summary.completed,invalid:summary.invalid,qualified:summary.qualified,regressions:summary.regressions,unresolved:summary.unresolved,exactOutputFramesChecked:checks,
   resultDir:root,manifestSha256:sha(await readFile(root+'/final.json'))});
 }finally{try{device?.destroy();}catch{}runtime.close();}
}
main().catch(error=>{emit({event:'fatal',error:String(error.stack||error)});process.exitCode=1;});
