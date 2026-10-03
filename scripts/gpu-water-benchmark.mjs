#!/usr/bin/env node
/** Bounded paired CPU+upload versus GPU water, including completed rendering. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import ts from 'typescript';
import {reserveRunDirectory,inventory,hashFile,hashValue,writeJsonExclusive,parseArgs} from './engine-baseline.mjs';
import {bootstrapRatio,mean,summary,readJsonBounded} from './engine-check.mjs';
import {closedBenchmarkInitial,closedBenchmarkMetrics,retainBenchmarkState,qualifyBenchmarkCore,verifyClosedBenchmarkFields,createGpuControl,gpuControlExpected} from './closed-water-benchmark-support.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sources=['src/engine/linear-water.ts','src/engine/closed-water.ts','src/engine/contracts.ts','src/webgpu/linear-water.ts','src/webgpu/closed-water-shader.ts','src/webgpu/water-telemetry.ts',
  'src/webgpu/renderer.ts','src/webgpu/startup-budget.ts','src/webgpu/resident-water-surface.ts','src/webgpu/instance-partition.ts',
  'src/webgpu/gpu-timing.ts','src/webgpu/shadow-cache.ts','src/assets/ktx2.ts','src/math.ts','src/camera.ts','src/types.ts',
  'scripts/gpu-water-benchmark.mjs','scripts/closed-water-benchmark-support.mjs','scripts/closed-water-oracle.mjs','scripts/closed-water-check.mjs','scripts/closed-water-protocol.mjs',
  'scripts/engine-baseline.mjs','scripts/engine-check.mjs','package.json','package-lock.json'];
const shaderModules=['webgpu/renderer','webgpu/startup-budget','webgpu/resident-water-surface','webgpu/instance-partition','webgpu/gpu-timing','webgpu/shadow-cache','assets/ktx2','math','camera'];
const quality={id:'balanced',label:'Balanced',sampleCount:1,shadowMapSize:1024,shadowTapCount:1,shadowStrength:0,exposure:1.2,bloomStrength:.12,fogDensity:.004,effectBudget:0,resolutionScale:1};

export function protocol(input={}) {
  if(input.model!==undefined&&!['legacy','closed'].includes(input.model))throw new RangeError('Water benchmark model must be legacy or closed.');
  if(input.gpuControlDispatches!==undefined&&(input.model!=='closed'||![4,128].includes(input.gpuControlDispatches)))throw new RangeError('Closed GPU controls support 4 or 128 dispatches per sample.');
  const trials=input.trials??6,warmup=input.warmup??8,frames=input.frames??24,ticksPerFrame=input.ticksPerFrame??4;
  const grids=input.grids??[64,128,256,512,1024];
  if(!Number.isSafeInteger(trials)||trials<4||trials>12||trials%2)throw new RangeError('Use 4–12 even-numbered pairs.');
  if(!Number.isSafeInteger(warmup)||warmup<1||warmup>32||!Number.isSafeInteger(frames)||frames<8||frames>120||!Number.isSafeInteger(ticksPerFrame)||ticksPerFrame<1||ticksPerFrame>8)throw new RangeError('Invalid bounded frame workload.');
  if(!Array.isArray(grids)||!grids.length||new Set(grids).size!==grids.length||grids.some(n=>![32,64,128,256,512,1024].includes(n)))throw new RangeError('Invalid grid sweep.');
  if(trials*2*(warmup+frames)*ticksPerFrame*grids.reduce((n,g)=>n+g*g,0)>3e9)throw new RangeError('Workload exceeds the three-billion cell-tick experiment bound.');
  const p={schema:'box3d.gpu-water-benchmark-protocol/1',trials,warmup,frames,ticksPerFrame,grids,seed:42,dt:1/240,viewport:[512,320],quality,
    gridCases:grids.map(grid=>{const renderStride=grid<=128?1:Math.ceil((grid-1)/126);return {grid,renderStride,meshVertices:(Math.ceil((grid-1)/renderStride)+1)**2,
      config:{cols:grid,rows:grid,dt:1/240,gravity:9.81,meanDepth:1.5,drag:.28,dx:40/(grid-1),dz:24/(grid-1)}};}),
    renderStride:'1 up to 128; ceil((grid-1)/126) above 128; identical source indices in both modes',
    timing:'Wall time for fixed numerical ticks, all required field uploads, uniforms, command encoding, render submission, and queue completion. Serialized completed frames, not browser FPS.',
    models:{baseline:'Exact JavaScript reference equations + three full float32 GPU field uploads per frame',candidate:'linear-water-webgpu-f32-v1; six resident ping-pong fields; no ordinary state readback'},
    qualityEnvelope:{absolute:5e-5,relative:5e-5},thresholds:{maxRegression:.05,controlTolerance:.15,minimumQualifiedSpeedup:1.05},
    control:'Eight timings of 2,000,000 unchanged integer iterations before and after each process suite',
    limits:{childSeconds:120,runSeconds:900,sourceBytes:8388608,stdoutBytes:1048576},
    exclusions:['Browser presentation/compositor and interactive FPS','Calibrated physical water accuracy','Nonlinear water, droplets, forcing and rigid coupling','Performance on other adapters','Engine-wide speedup','Asset transfer/startup time']};
  if(input.model==='closed') {
    const gpuControlDispatches=input.gpuControlDispatches??128;
    p.schema=gpuControlDispatches===4?'box3d.gpu-water-benchmark-protocol/2':'box3d.gpu-water-benchmark-protocol/3';p.model='closed';
    p.backendIds={baseline:'linear-water-closed-cgrid-js-f32-v1',candidate:'linear-water-closed-cgrid-webgpu-f32-v1'};
    p.models={baseline:'Closed C-grid CPU reference + three complete face/elevation float32 uploads per frame',candidate:'Closed C-grid GPU solver; six resident fields; identical GPU face-to-centre presentation interpolation'};
    for(const c of p.gridCases){c.config.dx=40/c.grid;c.config.dz=24/c.grid;}
    p.initialState='Cell-centred Gaussian elevations: +0.05 m at (-7,0), -0.025 m at (5,3), widths squared 5 and 8; synchronized zero face velocity, converted to negative half-time';
    p.physicalEnvelope={massRelativeToInitialL1:1e-4,wallVelocity:0,requireMatchingAuditedCore:true};
    p.gpuControl={workgroups:1024,workgroupSize:64,integerIterations:256,dispatchesPerSample:gpuControlDispatches,warmup:4,samplesBefore:8,samplesAfter:8,verifyWords:16,description:'Unchanged u32 mix kernel, completed GPU submission; output verified before and after all water cases'};
    p.stateRetention='Content-addressed complete initial and final six-field states outside timed frames; every final field is checked against CPU replay';
  }
  return p;
}

export function gate(samples,p) {
  const issues=[],cases=[],closed=p.model==='closed';
  if(!Array.isArray(samples)||samples.length!==p.trials*2||samples.some(s=>!s||typeof s!=='object'))return {verdict:'incomparable',issues:['Missing process samples'],cases};
  const bySide={baseline:[],candidate:[]};
  for(let pair=0;pair<p.trials;pair++)for(const side of ['baseline','candidate']) {
    const matches=samples.filter(s=>s.pair===pair&&s.side===side);
    if(matches.length!==1){issues.push(`Invalid pair ${pair}/${side}`);continue;}
    const s=matches[0];bySide[side].push(s);
    if(s.status!=='passed'||s.protocolSha256!==hashValue(p)||s.errors?.length||s.cases?.length!==p.grids.length||s.controls?.length!==16)issues.push(`Incomplete ${pair}/${side}`);
    if(!Array.isArray(s.controls)||!s.controls.every(value=>Number.isFinite(value)&&value>0)||s.controlValues?.length!==16||!s.controlValues.every(Number.isSafeInteger))issues.push(`Invalid control ${pair}/${side}`);
    if(!/^[a-f0-9]{64}$/.test(s.sourceSha256)||!/^[a-f0-9]{64}$/.test(s.runtimeSha256)||s.adapter?.backend!=='metal'||s.adapter.isFallbackAdapter!==false)issues.push(`Missing physical adapter or identity ${pair}/${side}`);
    if(closed&&(!/^[a-f0-9]{64}$/.test(s.accuracySha256)||s.schema!=='box3d.gpu-water-frame-sample/2'||!Array.isArray(s.gpuControls)||s.gpuControls.length!==16||!s.gpuControls.every(v=>Number.isFinite(v)&&v>0)||!Array.isArray(s.gpuControlValues)||s.gpuControlValues.length!==2||s.gpuControlValues.some(a=>!Array.isArray(a)||a.length!==16||!a.every(v=>Number.isInteger(v)&&v>=0&&v<=4294967295))||hashValue(s.gpuControlValues[0])!==hashValue(s.gpuControlValues[1])))issues.push(`Missing GPU control or physics identity ${pair}/${side}`);
    if(closed&&Array.isArray(s.gpuControlValues)&&hashValue(s.gpuControlValues[0]??null)!==hashValue(gpuControlExpected()))issues.push(`Incorrect GPU control output ${pair}/${side}`);
    if(p.schema==='box3d.gpu-water-benchmark-protocol/3'&&(s.gpuControlStats?.dispatchesPerSample!==p.gpuControl.dispatchesPerSample||s.gpuControlStats?.totalDispatches!==20*p.gpuControl.dispatchesPerSample))issues.push(`Incomplete GPU control work ${pair}/${side}`);
    for(const n of p.grids){
      const c=Array.isArray(s.cases)?s.cases.find(c=>c.grid===n):null;
      const contract=p.gridCases.find(c=>c.grid===n);
      if(!c||!Array.isArray(c.frameMs)||c.frameMs.length!==p.frames||!c.frameMs.every(value=>Number.isFinite(value)&&value>0)||c.maxToleranceFraction<0||c.maxToleranceFraction>1||!Number.isFinite(c.maxToleranceFraction)||c.cells!==n*n||c.ticks!==(p.warmup+p.frames)*p.ticksPerFrame||hashValue(c.displayQuality??null)!==hashValue(p.quality)||hashValue(c.config??null)!==hashValue(contract.config)||c.renderStride!==contract.renderStride||c.meshVertices!==contract.meshVertices||c.stateReadbackBytesDuringTimedFrames!==0||c.stateUploadBytesPerFrame!==(side==='baseline'?n*n*12:0))issues.push(`Invalid case ${n}/${pair}/${side}`);
      if(closed) {
        const stateValid=[c?.initialState,c?.finalState].every(state=>state&&/^[a-f0-9]{64}$/.test(state.sha256)&&state.bytes===n*n*24&&state.file===`states/${state.sha256}.f32`);
        if(!c||c.backend!==p.backendIds[side]||c.velocityLayout!=='east-north-faces'||!Number.isFinite(c.physical?.massError)||c.physical.massError<0||c.physical.massError>p.physicalEnvelope.massRelativeToInitialL1||c.physical.maxWallVelocity!==0||!stateValid)issues.push(`Invalid closed-model state ${n}/${pair}/${side}`);
      }
    }
  }
  if(new Set(samples.map(s=>s.pid)).size!==samples.length)issues.push('Process isolation failed');
  if(issues.length)return {verdict:'incomparable',issues,cases};
  if(new Set(samples.map(s=>s.sourceSha256)).size!==1||new Set(samples.map(s=>s.runtimeSha256)).size!==1||new Set(samples.map(s=>hashValue(s.adapter))).size!==1||new Set(samples.map(s=>hashValue(s.controlValues))).size!==1)issues.push('Source/runtime/adapter/control identities differ');
  if(closed&&(new Set(samples.map(s=>s.accuracySha256)).size!==1||new Set(samples.map(s=>hashValue(s.gpuControlValues))).size!==1))issues.push('Closed physics or GPU control outputs differ');
  if(issues.length)return {verdict:'incomparable',issues,cases};
  const controls=bootstrapRatio(bySide.baseline.map(s=>mean(s.controls)),bySide.candidate.map(s=>mean(s.controls)),{seed:p.seed});
  const gpuControls=closed?bootstrapRatio(bySide.baseline.map(s=>mean(s.gpuControls)),bySide.candidate.map(s=>mean(s.gpuControls)),{seed:p.seed+1}):null;
  const cpuControlQualified=controls.lower95>=1-p.thresholds.controlTolerance&&controls.upper95<=1+p.thresholds.controlTolerance;
  const gpuControlQualified=!closed||(gpuControls.lower95>=1-p.thresholds.controlTolerance&&gpuControls.upper95<=1+p.thresholds.controlTolerance);
  const controlQualified=cpuControlQualified&&gpuControlQualified;
  for(const grid of p.grids) {
    const b=bySide.baseline.map(s=>s.cases.find(c=>c.grid===grid)),c=bySide.candidate.map(s=>s.cases.find(c=>c.grid===grid));
    const ratio=bootstrapRatio(b.map(c=>mean(c.frameMs)),c.map(c=>mean(c.frameMs)),{seed:grid});
    const baseline=summary(b.flatMap(c=>c.frameMs)),candidate=summary(c.flatMap(c=>c.frameMs));
    const noRegression=ratio.lower95>=1-p.thresholds.maxRegression&&candidate.p95<=baseline.p95*(1+p.thresholds.maxRegression);
    cases.push({grid,cells:grid*grid,baseline,candidate,ratio,noRegression,
      qualifiedSpeedup:controlQualified&&ratio.lower95>=p.thresholds.minimumQualifiedSpeedup&&candidate.p95<=baseline.p95*(1+p.thresholds.maxRegression)});
  }
  // A crossover sweep may legitimately lose at small sizes. Preserve those losses.
  return {verdict:controlQualified?'measured':'inconclusive',issues,controls,controlQualified,cases,
    ...(closed?{gpuControls,cpuControlQualified,gpuControlQualified}:{}),
    qualifiedWinningGrids:cases.filter(c=>c.qualifiedSpeedup).map(c=>c.grid),
    conclusion:controlQualified?'Per-grid results apply only to this declared serialized workload. Small-grid losses are retained.':'Unchanged control did not qualify timing; no speedup claim is accepted.'};
}

/** Rehash the retained inputs and every raw sample before accepting a saved report. */
export async function verifyWaterRun(directory) {
  directory=await fs.realpath(directory);
  const issues=[];
  try {
    const [manifest,p,result]=await Promise.all(['manifest.json','protocol.json','result.json'].map(name=>readJsonBounded(path.join(directory,name),16*1024**2)));
    const closed=p.model==='closed';
    if(result.schema!==(closed?'box3d.gpu-water-frame-benchmark/2':'box3d.gpu-water-frame-benchmark/1')||hashValue(p)!==manifest.protocolSha256||hashValue(result.protocol)!==manifest.protocolSha256)issues.push('Protocol identity mismatch');
    const declared=protocol({model:p.model,gpuControlDispatches:p.gpuControl?.dispatchesPerSample,trials:p.trials,warmup:p.warmup,frames:p.frames,ticksPerFrame:p.ticksPerFrame,grids:p.grids});
    if(hashValue(declared)!==hashValue(p))issues.push('Unsupported protocol or changed declared thresholds');
    if(hashValue(manifest.runtime)!==manifest.runtimeSha256||hashValue(result.runtime)!==manifest.runtimeSha256)issues.push('Runtime identity mismatch');
    const retained=await inventory(path.join(directory,'source'),['.'],p.limits.sourceBytes);
    if(retained.sha256!==manifest.source.sha256||hashValue(retained.files)!==hashValue(manifest.source.files)||result.sourceSha256!==retained.sha256)issues.push('Retained source identity mismatch');
    if(!Array.isArray(result.execution)||result.execution.length!==p.trials*2||!Array.isArray(result.samples)||result.samples.length!==p.trials*2)issues.push('Missing execution receipts');
    if(issues.length)return {verdict:'incomparable',issues,cases:[]};
    let index=0;
    for(let pair=0;pair<p.trials;pair++)for(const side of pair%2?['candidate','baseline']:['baseline','candidate']) {
      const name=`${String(pair).padStart(2,'0')}-${side}`;
      const [raw,task]=await Promise.all([readJsonBounded(path.join(directory,name+'.json')),readJsonBounded(path.join(directory,name+'-task.json'))]);
      if(hashValue(raw)!==hashValue(result.samples[index])||hashValue(result.execution[index])!==hashValue({pair,side,pid:raw.pid,output:name+'.json'}))issues.push(`Raw sample or order mismatch: ${name}`);
      if(task.pair!==pair||task.side!==side||hashValue(task.protocol)!==manifest.protocolSha256||task.sourceSha256!==retained.sha256||task.runtimeSha256!==manifest.runtimeSha256||raw.sourceSha256!==retained.sha256||raw.runtimeSha256!==manifest.runtimeSha256)issues.push(`Task identity mismatch: ${name}`);
      if(closed&&(task.accuracySha256!==manifest.accuracySha256||raw.accuracySha256!==manifest.accuracySha256))issues.push(`Physical qualification mismatch: ${name}`);
      index++;
    }
    if(issues.length)return {verdict:'incomparable',issues,cases:[]};
    const physics=closed?await verifyClosedBenchmarkFields(directory,p,result.samples,retained,manifest.accuracySha256):null;
    return {...gate(result.samples,p),...(closed?{physics}:{}),integrity:{sourceSha256:retained.sha256,protocolSha256:manifest.protocolSha256,resultSha256:await hashFile(path.join(directory,'result.json')),checkerSha256:await hashFile(fileURLToPath(import.meta.url))}};
  }catch(error){return {verdict:'incomparable',issues:[error.message],cases:[]};}
}

async function compileRenderer(sourceRoot,output) {
  for(const module of shaderModules) {
    const input=await fs.readFile(path.join(sourceRoot,'src',module+'.ts'),'utf8');
    let code=ts.transpileModule(input,{fileName:module+'.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
    code=code.replace(/(from\s+['"])(\.[^'"]+)(['"])/g,(_,before,spec,after)=>before+spec.replace(/\.(?:js|ts)$/,'').concat('.mjs')+after);
    const target=path.join(output,module+'.mjs');await fs.mkdir(path.dirname(target),{recursive:true});await fs.writeFile(target,code,{flag:'wx'});
  }
  return await import(pathToFileURL(path.join(output,'webgpu/renderer.mjs')).href);
}
function control() {
  let value=42;const start=performance.now();
  for(let i=0;i<2000000;i++)value=Math.imul(value^(value>>>13)^i,1597334677);
  return {ms:performance.now()-start,value};
}

async function child(task) {
  const {create,globals}=await import('webgpu');Object.assign(globalThis,globals);
  const gpu=create(['backend=metal']);Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu}});
  Object.defineProperty(globalThis,'window',{configurable:true,value:{devicePixelRatio:1}});
  Object.defineProperty(globalThis,'fetch',{configurable:true,value:async()=>{throw new Error('Fixed procedural textures in this paired benchmark.');}});
  const {createLinearWaterArrays,stepLinearWaterCpu}=await import(pathToFileURL(path.join(task.sourceRoot,'src/engine/linear-water.ts')).href);
  const {createClosedWaterArrays,copyClosedWaterArrays,stepClosedWaterCpu}=await import(pathToFileURL(path.join(task.sourceRoot,'src/engine/closed-water.ts')).href);
  const {GpuLinearWater}=await import(pathToFileURL(path.join(task.sourceRoot,'src/webgpu/linear-water.ts')).href);
  const runtimeDir=await fs.mkdtemp(path.join(os.tmpdir(),'box3d-water-frame-'));
  const p=task.protocol,closed=p.model==='closed',stepCpu=closed?stepClosedWaterCpu:stepLinearWaterCpu;
  const output={schema:closed?'box3d.gpu-water-frame-sample/2':'box3d.gpu-water-frame-sample/1',pair:task.pair,side:task.side,pid:process.pid,protocolSha256:hashValue(p),sourceSha256:task.sourceSha256,runtimeSha256:task.runtimeSha256,status:'running',cases:[],controls:[],controlValues:[],errors:[],...(closed?{accuracySha256:task.accuracySha256,gpuControls:[],gpuControlValues:[]}: {})};
  const sampleControl=()=>{const value=control();output.controls.push(value.ms);output.controlValues.push(value.value);};
  let renderer,texture,producer,configured,gpuControl;
  try {
    const {WebGPURenderer}=await compileRenderer(task.sourceRoot,runtimeDir);
    const {CameraMatrixCache}=await import(pathToFileURL(path.join(runtimeDir,'camera.mjs')).href);
    const adapter=await gpu.requestAdapter({powerPreference:'high-performance'});
    assert.ok(adapter,'Physical Metal adapter required.');
    const info=adapter.info??{};
    output.adapter={backend:'metal',vendor:info.vendor??null,architecture:info.architecture??null,device:info.device??null,description:info.description??null,isFallbackAdapter:info.isFallbackAdapter??adapter.isFallbackAdapter??null,features:[...adapter.features].sort()};
    // Keep the native instance strongly reachable; select the same observed adapter.
    const gpuRoot=gpu;
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{gpu:{nativeRoot:gpuRoot,requestAdapter:async()=>adapter,getPreferredCanvasFormat:()=>gpuRoot.getPreferredCanvasFormat()}}});
    const canvas={clientWidth:p.viewport[0],clientHeight:p.viewport[1],width:0,height:0,getContext:()=>context};
    const context={configure(options){configured=options;},unconfigure(){texture?.destroy();texture=null;},getCurrentTexture(){
      texture??=configured.device.createTexture({label:'Paired benchmark offscreen output',size:p.viewport,format:configured.format,usage:GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC});return texture;
    }};
    renderer=await WebGPURenderer.create(canvas,1,{gpuTiming:false});
    const device=renderer.device;device.addEventListener('uncapturederror',event=>output.errors.push(event.error.message));
    const matrices=new CameraMatrixCache().resolve({yaw:1.1,pitch:.65,distance:44,target:[0,0,0]},{yaw:0,pitch:0,targetOffset:[0,0,0]},p.viewport[0]/p.viewport[1],[.42,-.84,.34]);
    const uniforms={viewProjection:matrices.viewProjection,lightViewProjection:matrices.lightViewProjection,cameraPosition:matrices.eye,lightDirection:[.42,-.84,.34],fogColor:[.055,.085,.14],timeSeconds:0,quality:p.quality};
    if(closed){gpuControl=await createGpuControl(device,p.gpuControl.dispatchesPerSample);for(let i=0;i<4;i++)await gpuControl.sample();for(let i=0;i<8;i++)output.gpuControls.push(await gpuControl.sample());output.gpuControlValues.push(await gpuControl.verify());}
    for(let i=0;i<4;i++)control();
    for(let i=0;i<8;i++)sampleControl();
    // Rotate grid order between pairs, keeping the order identical within a pair.
    const order=[...p.grids.slice(task.pair%p.grids.length),...p.grids.slice(0,task.pair%p.grids.length)];
    for(const grid of order) {
      const {config,renderStride}=p.gridCases.find(c=>c.grid===grid);
      const initial=closed?closedBenchmarkInitial(config,createClosedWaterArrays):createLinearWaterArrays(config);
      if(!closed)for(let z=0;z<grid;z++)for(let x=0;x<grid;x++){
        const wx=x*config.dx-20,wz=z*config.dz-12;
        initial.eta[z*grid+x]=.7*Math.exp(-((wx+7)**2+wz*wz)/5)-.32*Math.exp(-((wx-5)**2+(wz-3)**2)/8);
      }
      let cpu;
      if(task.side==='candidate')producer=await (closed?GpuLinearWater.createClosed:GpuLinearWater.create)(device,config,initial);
      else {
        cpu=closed?copyClosedWaterArrays(config,initial):createLinearWaterArrays(config,initial);
        const fields=['eta','u','v'].map(name=>device.createBuffer({label:`CPU reference ${name} upload`,size:grid*grid*4,usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST}));
        producer={backend:closed?p.backendIds.baseline:'linear-water-js-reference-v1',velocityLayout:closed?'east-north-faces':'cell-centered',device,config,alive:true,tick:0,getFields(){return {owner:this,device,backend:this.backend,eta:fields[0],u:fields[1],v:fields[2],cols:grid,rows:grid,tick:this.tick,time:this.tick*p.dt};},
          step(ticks){for(let i=0;i<ticks;i++)stepCpu(cpu,config);this.tick+=ticks;['eta','u','v'].forEach((name,i)=>device.queue.writeBuffer(fields[i],0,cpu[name].buffer));},
          destroy(){this.alive=false;for(const field of fields)field.destroy();}};
      }
      renderer.useGpuWater(producer,{renderStride});
      const frame=async()=>{const start=performance.now();producer.step(p.ticksPerFrame);uniforms.timeSeconds=producer.tick*p.dt;renderer.writeSceneUniforms(uniforms);renderer.render(0,[]);await device.queue.onSubmittedWorkDone();return performance.now()-start;};
      for(let i=0;i<p.warmup;i++)await frame();
      const frameMs=[];for(let i=0;i<p.frames;i++)frameMs.push(await frame());
      const final=cpu??(await producer.checkpoint()).state,expected=closed?copyClosedWaterArrays(config,initial):createLinearWaterArrays(config,initial);
      for(let i=0;i<(p.warmup+p.frames)*p.ticksPerFrame;i++)stepCpu(expected,config);
      let maxAbsolute=0,maxToleranceFraction=0,sumSquared=0,massDifference=0;
      for(const name of Object.keys(expected))for(let i=0;i<expected[name].length;i++){
        const error=Math.abs(expected[name][i]-final[name][i]);assert.ok(Number.isFinite(error),'Nonfinite numerical state');
        maxAbsolute=Math.max(maxAbsolute,error);maxToleranceFraction=Math.max(maxToleranceFraction,error/(p.qualityEnvelope.absolute+p.qualityEnvelope.relative*Math.abs(expected[name][i])));
        if(name==='eta'){sumSquared+=error*error;massDifference+=(final.eta[i]-expected.eta[i])*config.dx*config.dz;}
      }
      assert.ok(maxToleranceFraction<=1,'Predeclared CPU/GPU numerical envelope exceeded');
      let physical,initialState,finalState;
      if(closed){
        physical=closedBenchmarkMetrics(final,initial,config);assert.ok(physical.massError<=p.physicalEnvelope.massRelativeToInitialL1&&physical.maxWallVelocity===0,'Closed-model mass/wall acceptance failed');
        initialState=await retainBenchmarkState(path.dirname(task.output),initial);finalState=await retainBenchmarkState(path.dirname(task.output),final);
      }
      output.cases.push({grid,cells:grid*grid,config,renderStride,meshVertices:renderer.gpuWaterInfo().meshVertices,ticks:producer.tick,frameMs,maxAbsolute,maxToleranceFraction,
        elevationRmsDifference:Math.sqrt(sumSquared/(grid*grid)),volumePerturbationDifference:massDifference,
        stateUploadBytesPerFrame:cpu?grid*grid*12:0,stateReadbackBytesDuringTimedFrames:0,displayQuality:p.quality,
        ...(closed?{backend:producer.backend,velocityLayout:producer.velocityLayout,physical,initialState,finalState}: {})});
      renderer.useGpuWater(null);producer.destroy();producer=null;
    }
    for(let i=0;i<8;i++)sampleControl();
    if(closed){for(let i=0;i<8;i++)output.gpuControls.push(await gpuControl.sample());output.gpuControlValues.push(await gpuControl.verify());output.gpuControlStats=gpuControl.stats;}
    await device.queue.onSubmittedWorkDone();assert.deepEqual(output.errors,[]);output.status='passed';
  }catch(error){output.status='failed';output.failure=error.stack;throw error;}
  finally {
    gpuControl?.destroy();producer?.destroy();renderer?.dispose();texture?.destroy();
    output.finishedAt=new Date().toISOString();await writeJsonExclusive(task.output,output);await fs.rm(runtimeDir,{recursive:true,force:true});
  }
}

async function run(options) {
  const p=protocol({model:options['--model'],gpuControlDispatches:options['--gpu-control-dispatches']===undefined?undefined:Number(options['--gpu-control-dispatches']),trials:options['--trials']===undefined?undefined:Number(options['--trials']),frames:options['--frames']===undefined?undefined:Number(options['--frames']),warmup:options['--warmup']===undefined?undefined:Number(options['--warmup']),grids:options['--grids']?.split(',').map(Number)});
  if(p.model==='closed'&&!options['--accuracy-run'])throw new Error('Closed model timing requires --accuracy-run with matching independently qualified physics source.');
  if(process.env.NODE_OPTIONS||process.execArgv.length)throw new Error('Use an unmodified Node runtime without profiling flags or NODE_OPTIONS.');
  const directory=await reserveRunDirectory(options['--out'],[root]),startedAt=Date.now();
  try {
    const source=await inventory(root,sources,p.limits.sourceBytes),sourceRoot=path.join(directory,'source');
    for(const file of source.files){const destination=path.join(sourceRoot,file.path);await fs.mkdir(path.dirname(destination),{recursive:true});const data=await fs.readFile(path.join(root,file.path));await fs.writeFile(destination,data,{flag:'wx'});assert.equal(await hashFile(destination),file.sha256,'Source changed during capture');}
    const accuracySha256=p.model==='closed'?await qualifyBenchmarkCore(directory,sourceRoot,options['--accuracy-run']):undefined;
    if(p.model==='closed')await fs.mkdir(path.join(directory,'states'));
    const runtime={node:process.version,nodeSha256:await hashFile(process.execPath),typescript:ts.version,webgpu:JSON.parse(await fs.readFile(path.join(root,'node_modules/webgpu/package.json'),'utf8')).version,platform:process.platform,arch:process.arch,os:os.release(),cpu:os.cpus()[0]?.model??null,logicalCpus:os.cpus().length,thermalState:'unavailable',powerMode:'unavailable'};
    await writeJsonExclusive(path.join(directory,'manifest.json'),{source,runtime,runtimeSha256:hashValue(runtime),protocolSha256:hashValue(p),...(accuracySha256?{accuracySha256}:{}),scope:'CPU reference + upload versus GPU linear water; procedural textures only; no external assets or network used'});
    await writeJsonExclusive(path.join(directory,'protocol.json'),p);
    const samples=[],execution=[];
    for(let pair=0;pair<p.trials;pair++)for(const side of pair%2?['candidate','baseline']:['baseline','candidate']) {
      assert.ok(Date.now()-startedAt<p.limits.runSeconds*1000,'Experiment time bound exceeded');
      const name=`${String(pair).padStart(2,'0')}-${side}`,output=path.join(directory,name+'.json'),taskPath=path.join(directory,name+'-task.json');
      await writeJsonExclusive(taskPath,{pair,side,protocol:p,sourceRoot,sourceSha256:source.sha256,runtimeSha256:hashValue(runtime),...(accuracySha256?{accuracySha256}:{}),output});
      await promisify(execFile)(process.execPath,[fileURLToPath(import.meta.url),'--child',taskPath],{cwd:root,timeout:Math.min(p.limits.childSeconds*1000,p.limits.runSeconds*1000-(Date.now()-startedAt)),maxBuffer:p.limits.stdoutBytes,env:process.env});
      const sample=JSON.parse(await fs.readFile(output,'utf8'));samples.push(sample);execution.push({pair,side,pid:sample.pid,output:path.basename(output)});
      console.log(`${pair+1}/${p.trials} ${side}: ${sample.cases.length} completed render workloads`);
    }
    for(const file of source.files)assert.equal(await hashFile(path.join(sourceRoot,file.path)),file.sha256,'Retained source integrity changed');
    // The running harness is also retained and must still match the executed copy.
    for(const name of sources.filter(name=>name.startsWith('scripts/')))assert.equal(await hashFile(path.join(root,name)),source.files.find(f=>f.path===name).sha256);
    const result=gate(samples,p);
    await writeJsonExclusive(path.join(directory,'result.json'),{schema:p.model==='closed'?'box3d.gpu-water-frame-benchmark/2':'box3d.gpu-water-frame-benchmark/1',startedAt:new Date(startedAt).toISOString(),finishedAt:new Date().toISOString(),protocol:p,sourceSha256:source.sha256,runtime,execution,samples,gate:result});
    console.log(JSON.stringify(result,null,2));if(result.verdict!=='measured')process.exitCode=2;
  }catch(error){await writeJsonExclusive(path.join(directory,'failure.json'),{error:error.stack,elapsedMs:Date.now()-startedAt,stderr:String(error.stderr??'').slice(-8192),code:error.code??null,signal:error.signal??null,killed:error.killed??null});throw error;}
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options=parseArgs(process.argv.slice(2),['--out','--trials','--frames','--warmup','--grids','--model','--gpu-control-dispatches','--accuracy-run','--child','--check','--receipt']);
  if(options.help)console.log('node scripts/gpu-water-benchmark.mjs --out NEW_DIRECTORY [--trials 6 --frames 24 --warmup 8 --grids 64,128,256,512,1024] [--model closed --accuracy-run MATCHING_PHYSICS_RUN]\nnode scripts/gpu-water-benchmark.mjs --check RUN_DIRECTORY [--receipt NEW_JSON_FILE]');
  else (options['--check']?verifyWaterRun(options['--check']).then(async result=>{if(options['--receipt'])await writeJsonExclusive(options['--receipt'],result);console.log(JSON.stringify(result,null,2));if(result.verdict!=='measured')process.exitCode=2;}):options['--child']?fs.readFile(options['--child'],'utf8').then(JSON.parse).then(child):options['--out']?run(options):Promise.reject(new Error('--out or --check is required'))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
