/** Physical NVIDIA Vulkan runtime. Validation stays enabled in every mode. */
import { readFile, readdir, realpath } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve, basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import os from 'node:os';
const execute=promisify(execFile);
const ID_FIELDS=['name','uuid','driver_version','memory.total','pci.bus_id'];
const TELEMETRY_FIELDS=['timestamp','uuid','temperature.gpu','utilization.gpu','utilization.memory','memory.used','power.draw','power.limit','clocks.current.graphics','clocks.current.memory'];
const hashBytes=data=>createHash('sha256').update(data).digest('hex');
let activeRuntime=false;
export function parseNvidiaCsv(text,fields=ID_FIELDS){
 return String(text).trim().split(/\r?\n/).filter(Boolean).map(line=>{
  const values=line.split(',').map(x=>x.trim());
  if(values.length!==fields.length)throw new Error('Unexpected nvidia-smi CSV shape.');
  return Object.fromEntries(fields.map((name,index)=>[name,values[index]]));
 });
}
export function assertPhysicalNvidiaAdapter(details,visibleGpus){
 if(!Array.isArray(visibleGpus)||visibleGpus.length!==1)throw new Error('Exactly one visible NVIDIA GPU is required.');
 const smi=visibleGpus[0];
 if(!/^GPU-[A-Za-z0-9-]+$/.test(smi.uuid??'')||!smi.name||!smi.driver_version)throw new Error('nvidia-smi did not provide a usable GPU identity.');
 const text=[details.vendor,details.architecture,details.device,details.description].join(' ');
 if(/lavapipe|llvmpipe|swiftshader|software|null backend/i.test(text))throw new Error('Software or null WebGPU adapter rejected.');
 if(!/nvidia/i.test(text)&&!/^(?:0x)?10de$/i.test(String(details.vendor)))throw new Error('Selected Vulkan adapter is not explicitly NVIDIA.');
 if(details.isFallbackAdapter!==false)throw new Error('Adapter must explicitly report isFallbackAdapter=false.');
 if(details.timestampQuery!==true)throw new Error('GPU timestamp queries are required.');
 return{verified:true,visibleGpuCount:1,scope:'One GPU is visible through nvidia-smi; the Vulkan WebGPU adapter identifies NVIDIA, non-fallback execution and timestamps. WebGPU exposes no UUID, so direct adapter-to-UUID mapping is not claimed.'};
}
/** Pure stable identity builder; library ordering and mount paths do not matter. */
export function makeRuntimeIdentity({visibleGpus,adapter,nodeVersion,packageInfo,driver}){
 assertPhysicalNvidiaAdapter(adapter,visibleGpus);
 const validHash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 for(const key of ['packageLockSha256','nativeBinarySha256'])if(!validHash(packageInfo[key]))throw new Error(`Missing runtime dependency hash: ${key}`);
 const normalized=(rows,label)=>{
  if(!Array.isArray(rows))throw new Error(`Missing ${label} evidence`);
  const result=rows.map(row=>{
   if(!validHash(row.sha256))throw new Error(`Unresolved ${label} hash: ${row.name??row.path??'unknown'}`);
   return{name:row.name??basename(row.path),sha256:row.sha256};
  });
  return [...new Map(result.map(row=>[`${row.name}:${row.sha256}`,row])).values()].sort((a,b)=>a.name.localeCompare(b.name)||a.sha256.localeCompare(b.sha256));
 };
 const libraries=normalized(driver.libraries,'driver library'),icds=normalized(driver.icds,'ICD');
 if(!libraries.some(row=>/nvidia/i.test(row.name)))throw new Error('No NVIDIA driver library hash is available.');
 return{gpuUuid:visibleGpus[0].uuid,gpuName:visibleGpus[0].name,driverVersion:visibleGpus[0].driver_version,nodeVersion,
  webgpuVersion:packageInfo.version,packageLockSha256:packageInfo.packageLockSha256,nativeBinarySha256:packageInfo.nativeBinarySha256,
  driverLibraries:libraries,driverIcds:icds,adapter:{...adapter}};
}
async function smiQuery(fields,uuid){
 const args=[`--query-gpu=${fields.join(',')}`,'--format=csv,noheader,nounits'];if(uuid)args.push(`--id=${uuid}`);
 const result=await execute('nvidia-smi',args,{encoding:'utf8',timeout:10000,maxBuffer:1024*1024,windowsHide:true});
 return parseNvidiaCsv(result.stdout,fields);
}
async function hashFile(path){const h=createHash('sha256');for await(const chunk of createReadStream(path))h.update(chunk);return h.digest('hex');}
async function driverEvidence(){
 const icds=[];
 for(const directory of ['/usr/share/vulkan/icd.d','/etc/vulkan/icd.d']){
  const entries=await readdir(directory).catch(()=>[]);
  for(const name of entries.filter(n=>/nvidia.*\.json$/i.test(n)).sort()){
   const path=join(directory,name),data=await readFile(path);let manifest=null;try{manifest=JSON.parse(data);}catch{}
   icds.push({path,sha256:hashBytes(data),manifest});
  }
 }
 const maps=await readFile('/proc/self/maps','utf8').catch(()=>'');
 const paths=[...new Set(maps.split('\n').map(line=>line.match(/\s(\/[^\n]+)$/)?.[1]).filter(Boolean).map(path=>path.replace(/ \(deleted\)$/,''))
  .filter(path=>/\/(?:libvulkan|libGLX_nvidia|libnvidia-(?:glvkspirv|gpucomp|glcore|eglcore|tls|vulkan))[^/]*\.so/.test(path)))].sort();
 const libraries=[];
 for(const path of paths){try{const canonical=await realpath(path);libraries.push({path:canonical,name:basename(canonical),sha256:await hashFile(canonical)});}catch(error){libraries.push({path,sha256:null,error:String(error.message)});}}
 return{nvidiaVersion:await readFile('/proc/driver/nvidia/version','utf8').catch(()=>null),icds,libraries,scope:'Read-only hashes of NVIDIA ICD manifests and relevant shared libraries mapped in this process. No driver installation or mutation.'};
}
export async function openRuntime({width=960,height=540,packageRoot=process.env.WEBGPU_PACKAGE_ROOT??'/opt/webgpu-tools',highResolutionTimestamps=false}={}){
 if(activeRuntime)throw new Error('Close the previous hardware runtime before opening another.');
 if(process.platform!=='linux'||process.arch!=='x64')throw new Error('This cloud runtime targets Linux x86_64.');
 if(Number(process.versions.node.split('.')[0])!==24)throw new Error('Node.js 24 is required.');
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>4096||height>4096)throw new Error('Invalid render resolution.');
 const caps=String(process.env.NVIDIA_DRIVER_CAPABILITIES??'').split(',').map(s=>s.trim());
 if(!caps.includes('all')&&!['graphics','utility','compute'].every(c=>caps.includes(c)))throw new Error('Configure NVIDIA_DRIVER_CAPABILITIES=compute,utility,graphics at pod creation. Setting it after boot cannot mount missing driver components.');
 const visibleGpus=await smiQuery(ID_FIELDS);if(visibleGpus.length!==1)throw new Error(`Expected one visible GPU; nvidia-smi reports ${visibleGpus.length}.`);
 const packagePath=join(resolve(packageRoot),'node_modules/webgpu'),pkg=JSON.parse(await readFile(join(packagePath,'package.json'),'utf8'));
 if(pkg.version!=='0.6.2')throw new Error(`Pinned webgpu@0.6.2 required; found ${pkg.version}.`);
 const lockBytes=await readFile(join(resolve(packageRoot),'package-lock.json')),lock=JSON.parse(lockBytes),binary=join(packagePath,'dist/linux-x64/dawn.node');
 const options=['backend=vulkan'];
 if(highResolutionTimestamps)options.push('disable-dawn-features=timestamp_quantization');
 const meta={schemaVersion:1,openedAt:new Date().toISOString(),node:process.version,platform:process.platform,arch:process.arch,
  cpu:{model:os.cpus()[0]?.model??null,logicalCpus:os.cpus().length,availableParallelism:os.availableParallelism()},
  executionClass:'physical NVIDIA required; adapter verification pending',executionScope:'Real offscreen WebGPU textures and GPU timestamps. Presentation is another offscreen texture. No browser compositor, monitor refresh or game FPS measurement.',
  resolution:{width,height},options,validationDisabled:false,timestampQuantizationDisabled:highResolutionTimestamps,
  package:{name:pkg.name,version:pkg.version,integrity:lock.packages?.['node_modules/webgpu']?.integrity??null,packageLockSha256:hashBytes(lockBytes),nativeBinarySha256:await hashFile(binary)},
  environment:{NVIDIA_DRIVER_CAPABILITIES:process.env.NVIDIA_DRIVER_CAPABILITIES??null,NVIDIA_VISIBLE_DEVICES:process.env.NVIDIA_VISIBLE_DEVICES??null,VK_DRIVER_FILES:process.env.VK_DRIVER_FILES??null,VK_ICD_FILENAMES:process.env.VK_ICD_FILENAMES??null},
  visibleGpus,adapter:null,identity:null,identityVerification:null,driverEvidence:null};
 const {create,globals}=await import(pathToFileURL(join(packagePath,'index.js')).href);Object.assign(globalThis,globals);
 let gpu=create(options),texture=null,closed=false,presentationAcquisitions=0;
 const previousNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator'),canvas={width,height};
 const context={
  configure({device,format}){texture?.destroy();texture=device.createTexture({label:'Physical GPU offscreen presentation target',size:[canvas.width,canvas.height],format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});},
  getCurrentTexture(){if(!texture)throw new Error('Presentation target is not configured.');presentationAcquisitions++;return texture;},
  unconfigure(){texture?.destroy();texture=null;},
 };
 canvas.getContext=kind=>kind==='webgpu'?context:null;
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:`Node ${process.version}; Dawn webgpu@${pkg.version}; NVIDIA native Vulkan offscreen`,gpu:{
  async requestAdapter(options){
   if(closed)throw new Error('Runtime closed.');const adapter=await gpu.requestAdapter(options);
   if(!adapter)throw new Error('No Vulkan adapter. Verify host NVIDIA graphics support and container graphics capabilities.');
   const info=adapter.info??{},details=Object.fromEntries(['vendor','architecture','device','description'].map(k=>[k,info[k]??'']));
   details.isFallbackAdapter=info.isFallbackAdapter??adapter.isFallbackAdapter??null;details.timestampQuery=adapter.features.has('timestamp-query');
   meta.adapter=details;meta.identityVerification=assertPhysicalNvidiaAdapter(details,visibleGpus);meta.executionClass='physical NVIDIA GPU through native Dawn Vulkan';meta.driverEvidence=await driverEvidence();
   // Final identity waits until the caller has exercised compute/render/present
   // outside measurement, so lazy driver loading is sampled consistently.
   meta.identity=null;
   return adapter;
  },getPreferredCanvasFormat:()=>gpu.getPreferredCanvasFormat(),
 }}});activeRuntime=true;
 return{canvas,meta,
  async sampleTelemetry(){const recordedAt=new Date().toISOString();try{return{recordedAt,status:'recorded',units:{temperature:'C',memory:'MiB',power:'W',clock:'MHz',utilization:'percent'},rows:await smiQuery(TELEMETRY_FIELDS,visibleGpus[0].uuid)}}catch(error){return{recordedAt,status:'unavailable',error:String(error.message),rows:[]};}},
  async refreshDriverEvidence(){meta.driverEvidence=await driverEvidence();return meta.driverEvidence;},
  async finalizeIdentity(){
   if(closed||!meta.identityVerification?.verified||presentationAcquisitions===0)throw new Error('Finalize identity after an untimed compute/render/presentation setup frame.');
   meta.driverEvidence=await driverEvidence();
   meta.identity=makeRuntimeIdentity({visibleGpus,adapter:meta.adapter,nodeVersion:process.version,packageInfo:meta.package,driver:meta.driverEvidence});
   meta.identityFinalization={phase:'after-caller-compute-render-presentation-setup',presentationAcquisitions,finalizedAt:new Date().toISOString(),scope:'The caller must exercise compute, rendering and presentation before this hash snapshot. No lazy-loading timestamps or counters are part of the stable identity.'};
   return meta.identity;
  },
  close(){if(closed)return;context.unconfigure();closed=true;activeRuntime=false;if(previousNavigator)Object.defineProperty(globalThis,'navigator',previousNavigator);else delete globalThis.navigator;gpu=null;},
 };
}

