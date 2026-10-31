import {WebGPURenderer} from '../../src/webgpu/renderer.ts';
import {GpuWaterCompute} from '../../src/webgpu/water-compute.ts';
import * as referenceApi from '../../src/soft/water-reference.ts';
import {mat4Perspective,mat4LookAt,mat4Multiply,mat4Identity} from '../../src/math.ts';
import {fixture,fixtureHash,compareSnapshots,DEFAULT_SETTINGS,hardwareClassification,sha256,message} from './common.mjs';
import {timeout,gpuIdle,gpuSnapshot,gpuSetup} from './timing.mjs';
import {runUploadOverhead} from './upload-overhead.mjs';
const canvas=document.querySelector('#scene'),status=document.querySelector('#status'),resultView=document.querySelector('#result'),runButton=document.querySelector('#run');
const sourcePaths=['src/webgpu/renderer.ts','src/webgpu/water-compute.ts','src/soft/water-reference.ts','src/webgpu/water-surface-plan.ts','src/runtime/execution-graph.ts','src/math.ts','src/assets/ktx2.ts',...['render-parity','common','timing','upload-overhead','baseline-renderer'].map(n=>'benchmarks/math-runtime/'+n+'.mjs')];
async function sourceHashes(){const result={},root=new URL('../../',import.meta.url);for(const path of sourcePaths)try{const v=await import(new URL(path+'?raw',root).href);result[path]=await sha256(v.default);}catch(e){result[path]={unavailable:message(e)};}return result;}
function topology(cols,rows){const a=new Uint16Array((cols-1)*(rows-1)*6);let n=0;for(let z=0;z<rows-1;z++)for(let x=0;x<cols-1;x++){const p=z*cols+x,b=p+1,c=p+cols,d=c+1;a.set([p,c,b,b,c,d],n);n+=6;}return a;}
function comparePixels(expected,actual){
 if(expected.length!==actual.length)return {pass:false,reason:'length mismatch'};
 let differingChannels=0,differingPixels=0,maxAbsolute=0,squared=0;
 for(let i=0;i<expected.length;i+=4){let changed=false;for(let c=0;c<4;c++){const e=Math.abs(expected[i+c]-actual[i+c]);if(e){differingChannels++;changed=true;}maxAbsolute=Math.max(maxAbsolute,e);squared+=e*e;}if(changed)differingPixels++;}
 return {pass:differingChannels===0,comparison:'Exact byte equality of identical fields on the same renderer/device.',pixels:expected.length/4,differingPixels,differingChannels,maxAbsolute,rmsChannelError:Math.sqrt(squared/expected.length)};
}
async function capture(renderer,texture){
 const [width,height]=renderer.viewport(),bytesPerRow=Math.ceil(width*4/256)*256;
 const buffer=renderer.device.createBuffer({size:bytesPerRow*height,usage:GPUBufferUsage.COPY_DST|GPUBufferUsage.MAP_READ});
 try{
  const encoder=renderer.device.createCommandEncoder();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow,rowsPerImage:height},[width,height]);renderer.device.queue.submit([encoder.finish()]);
  await timeout(buffer.mapAsync(GPUMapMode.READ),15000,'Pixel readback');
  const mapped=new Uint8Array(buffer.getMappedRange()),pixels=new Uint8Array(width*height*4);
  for(let y=0;y<height;y++)pixels.set(mapped.subarray(y*bytesPerRow,y*bytesPerRow+width*4),y*width*4);
  buffer.unmap();return pixels;
 }finally{buffer.destroy();}
}
function sceneUniforms(){
 const eye=[24,21,30];return {viewProjection:mat4Multiply(mat4Perspective(Math.PI/3.5,4/3,.1,150),mat4LookAt(eye,[0,0,0],[0,1,0])),lightViewProjection:mat4Identity(),cameraPosition:eye,timeSeconds:1.25,lightDirection:[.4,.8,.3],fogColor:[.05,.08,.12],studioMode:false,quality:{id:'performance',label:'Fixed parity fixture',exposure:1,bloomStrength:0,fogDensity:0,shadowStrength:0,effectBudget:0,resolutionScale:1,sampleCount:1,shadowMapSize:1024,shadowTapCount:1}};
}
export async function runRenderParity(){
 runButton.disabled=true;status.textContent='Creating renderer…';
 const report={schemaVersion:'box3d-resident-water-render-parity/1',createdAt:new Date().toISOString(),status:'RUNNING',scope:'Actual renderer offscreen parity; no FPS or canvas-presentation claim.',outputTarget:'GPU texture matching viewport/format, sample count 1.',canvasPresentation:{status:'UNQUALIFIED',reason:'Offscreen output only.'},uploadAccountingCaveat:'Initial counters differ for uniform/index accounting; only steady dynamic bytes are comparable.',
 provenance:{userAgent:navigator.userAgent,secureContext:isSecureContext,crossOriginIsolated,sourceSha256:await sourceHashes(),recoveryNote:'Fresh run after workspace reset; earlier raw results lost.'},gpu:{status:'BLOCKED'},cases:[],gpuValidationErrors:[]};
 let renderer,gpu,outputTexture,tearingDown=false;
 try{
  if(!navigator.gpu){report.status='BLOCKED';report.reason='navigator.gpu unavailable';return report;}
  const adapter=await timeout(navigator.gpu.requestAdapter({powerPreference:'high-performance'}),15000,'Adapter request');
  if(!adapter){report.status='BLOCKED';report.gpu.reason='requestAdapter returned null.';return report;}
  const info=adapter.info??{},adapterInfo=Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,info[k]??'']));
  adapterInfo.isFallbackAdapter=adapter.isFallbackAdapter??info.isFallbackAdapter??null;
  report.gpu={status:'AVAILABLE',preflightAdapterInfo:adapterInfo,classification:hardwareClassification(adapterInfo),note:'Renderer requests its own device with same power preference.'};
  const pending=WebGPURenderer.create(canvas,1);
  try{renderer=await timeout(pending,60000,'Renderer setup');}catch(e){void pending.then(r=>r.device.destroy(),()=>{}).catch(()=>{});throw e;}
  renderer.device.addEventListener('uncapturederror',e=>report.gpuValidationErrors.push(e.error.message));
  void renderer.device.lost.then(info=>{if(!tearingDown)report.deviceLostBeforeTeardown={reason:info.reason,message:info.message};});
  if(typeof renderer.uploadResidentWater!=='function'){report.status='BLOCKED';report.reason='Resident API missing';return report;}
  if(renderer.device.adapterInfo)report.gpu.deviceAdapterInfo=Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,renderer.device.adapterInfo[k]??'']));
  const uniforms=sceneUniforms();renderer.writeSceneUniforms(uniforms);
  outputTexture=renderer.device.createTexture({label:'Parity output',size:renderer.viewport(),format:renderer.format,sampleCount:1,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});
  const outputView=outputTexture.createView();
  report.fixture={grid:{cols:96,rows:80},canvas:renderer.viewport(),format:renderer.format,scene:uniforms};
  report.materials={noise:renderer.materialTextureInfo(),atlas:renderer.materialAtlasTextureInfo()};
  const grid=report.fixture.grid,data=fixture(grid,DEFAULT_SETTINGS.seed),indices=topology(grid.cols,grid.rows);
  report.fixture.initialStateSha256=await fixtureHash(data);report.fixture.params=data.params;report.settingsSha256=await sha256(JSON.stringify(report.fixture));
  const reference=referenceApi.createWaterReference(grid,data.initial,data.history);
  gpu=await gpuSetup(GpuWaterCompute.create(renderer.device,grid,data.initial,data.history));
  const metadata={path:'gpu-water',material:'water',...grid,width:34,depth:24,baseY:0,vertexCount:grid.cols*grid.rows,indices,indexCount:indices.length,topologyVersion:1};
  report.stage='background';renderer.uploadSurface(null);renderer.render(0,[],0,undefined,outputView);const background=await capture(renderer,outputTexture);
  let steps=0;
  for(const delta of [0,1,3]){
   for(let i=0;i<delta;i++)referenceApi.stepWaterReference(reference,data.params,'f32');steps+=delta;
   report.stage='resident-'+steps;status.textContent='Checking step '+steps;
   const frame={...metadata,...reference.current,frameVersion:steps};let residentUploadBytes=0;
   renderer.render(0,[],0,encoder=>{for(let i=0;i<delta;i++)gpu.encodeStep(encoder,data.params);residentUploadBytes=renderer.uploadResidentWater(frame,{device:renderer.device,...gpu.currentBuffers});},outputView);
   const residentPixels=await capture(renderer,outputTexture),actual=await gpuSnapshot(gpu);
   const cpuUploadBytes=renderer.uploadSurface({...frame,...actual.current});report.stage='cpu-'+steps;
   renderer.render(0,[],0,undefined,outputView);const cpuPixels=await capture(renderer,outputTexture);
   const pixels=comparePixels(cpuPixels,residentPixels),coverage=comparePixels(background,residentPixels),numerical=compareSnapshots(referenceApi.snapshotWaterReference(reference),actual,DEFAULT_SETTINGS.tolerance);
   report.cases.push({steps,status:pixels.pass&&coverage.differingPixels>100&&numerical.pass?'PASSED':'FAILED',residentUploadBytes,cpuUploadBytes,pixels,waterCoveragePixels:coverage.differingPixels,numerical,computeAndRenderInOneEncoder:true,residentPixelSha256:await sha256(residentPixels),cpuPixelSha256:await sha256(cpuPixels)});
  }
  report.rejections=[];
  for(const [id,overrides] of [['short-height-array',{eta:reference.current.eta.subarray(0,grid.cols*grid.rows-1)}],['wrong-velocity-array-type',{u:new Float64Array(reference.current.u)}]]){
   const reportedBytes=renderer.uploadSurface({...metadata,...reference.current,...overrides,indices:new Uint16Array([0,grid.cols,1]),indexCount:3,topologyVersion:2,frameVersion:10});
   renderer.render(0,[],0,undefined,outputView);const pixels=comparePixels(background,await capture(renderer,outputTexture));report.rejections.push({id,status:reportedBytes===0&&pixels.pass?'PASSED':'FAILED',reportedBytes,pixels});
  }
  await gpuIdle(renderer.device);report.waterPlanningStats=renderer.waterPlanningStats();report.stage='upload-overhead';status.textContent='Measuring upload methods…';
  report.uploadOverhead=await runUploadOverhead(renderer,{...metadata,...reference.current,frameVersion:0});
  const source=await fetch(new URL('./baseline-renderer-provenance.json',import.meta.url));if(source.ok)report.uploadOverhead.baselineProvenance=await source.json();
  report.status=report.cases.every(c=>c.status==='PASSED')&&report.rejections.every(c=>c.status==='PASSED')&&report.uploadOverhead.status==='PASSED'&&!report.gpuValidationErrors.length?'PASSED':'FAILED';report.stage='complete';
 }catch(e){report.status='FAILED';report.reason=message(e);}
 finally{tearingDown=true;gpu?.destroy();outputTexture?.destroy();renderer?.device.destroy();window.__BOX3D_RENDER_PARITY_RESULT__=report;status.textContent=report.status+' · '+(report.gpu.classification??'unavailable');resultView.textContent=JSON.stringify(report,null,2);runButton.disabled=false;}
 return report;
}
window.runBox3dRenderParity=runRenderParity;runButton.onclick=runRenderParity;

