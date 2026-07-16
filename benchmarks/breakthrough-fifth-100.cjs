'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { performance } = require('node:perf_hooks');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const baselineArchive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.8.0-source.tar.gz');
function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed`);
}
function prepareBaseline() {
  if (process.env.V19_BASELINE_ROOT) return path.resolve(process.env.V19_BASELINE_ROOT);
  if (!fs.existsSync(baselineArchive)) throw new Error(`missing reproducible v1.8 baseline archive: ${baselineArchive}`);
  const target = path.join(os.tmpdir(), `box3d-v18-fifth-${process.pid}`);
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  runCommand('tar', ['-xzf', baselineArchive, '-C', target, '--strip-components=1']);
  fs.rmSync(path.join(target, 'node_modules'), { recursive: true, force: true });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(target, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  runCommand(path.join(root, 'node_modules/.bin/tsc'), ['-p', path.join(target, 'tsconfig.test.json')], { cwd: target });
  fs.mkdirSync(path.join(target, '.test-build'), { recursive: true });
  fs.writeFileSync(path.join(target, '.test-build/package.json'), '{"type":"commonjs"}');
  return target;
}
const baselineRoot = prepareBaseline();
const samples = Math.max(3, Number.parseInt(process.env.FIFTH_SAMPLES || '5', 10));
const scale = Math.max(0.1, Number(process.env.FIFTH_SCALE || '0.35'));
const startExperiment = Math.max(1, Number.parseInt(process.env.FIFTH_START || '1', 10));
const endExperiment = Math.min(100, Number.parseInt(process.env.FIFTH_END || '100', 10));
if (startExperiment > endExperiment) throw new Error(`FIFTH_START ${startExperiment} exceeds FIFTH_END ${endExperiment}`);
const resultsDir = process.env.FIFTH_RESULTS_DIR
  ? path.resolve(process.env.FIFTH_RESULTS_DIR)
  : path.join(root, 'benchmarks/results');
fs.mkdirSync(resultsDir, { recursive: true });

function median(values) { const a=[...values].sort((x,y)=>x-y); const m=a.length>>1; return a.length&1?a[m]:(a[m-1]+a[m])*0.5; }
function mad(values) { const m=median(values); return median(values.map(v=>Math.abs(v-m))); }
function geometricMean(values) { const a=values.filter(v=>v>0&&Number.isFinite(v)); return Math.exp(a.reduce((s,v)=>s+Math.log(v),0)/a.length); }
function relativeL2(a,b) { if(!a||!b||a.length!==b.length)return Infinity; let e=0,r=0; for(let i=0;i<a.length;i++){const d=b[i]-a[i];e+=d*d;r+=a[i]*a[i];} return Math.sqrt(e/Math.max(r,1e-30)); }
function maxAbs(a,b) { if(!a||!b||a.length!==b.length)return Infinity; let m=0; for(let i=0;i<a.length;i++)m=Math.max(m,Math.abs(a[i]-b[i])); return m; }
function finite(a) { if(!a)return true; for(let i=0;i<a.length;i++)if(!Number.isFinite(a[i]))return false; return true; }
function loadProject(projectRoot, variant) {
  const build=path.join(projectRoot,'.test-build');
  const {SCENES}=require(path.join(build,'src/scenes.js'));
  const {SoftSimulationSuite}=require(path.join(build,'src/soft/simulations.js'));
  const wasmModule=new WebAssembly.Module(fs.readFileSync(path.join(projectRoot,'public/soft-kernels-simd.wasm')));
  const currentKernelPath=path.join(build,'src/soft/kernels.js');
  if(fs.existsSync(currentKernelPath)){
    const {SoftKernelModule}=require(currentKernelPath);
    return {
      variant,
      SCENES,
      unifiedSurface:true,
      createSuite(){
        // Each suite needs its own WASM memory. SoftKernelModule#createArena
        // resets its instance, so sharing one instance corrupts mixed scenes.
        const instance=new WebAssembly.Instance(wasmModule,{});
        return new SoftSimulationSuite(new SoftKernelModule('simd',instance.exports));
      },
    };
  }

  // Historical v1.8 packages install a WebAssembly.Module globally and
  // construct suites without arguments. Keep that path byte-for-byte in
  // behavior so the reproducible baseline remains unchanged.
  const kernels=require(path.join(build,'src/soft/wasm-kernels.js'));
  kernels.installSoftKernelModule(wasmModule,`${variant}-simd`);
  return {variant,SCENES,unifiedSurface:false,createSuite(){return new SoftSimulationSuite();}};
}
const baseline=loadProject(baselineRoot,'v1.8');
const optimized=loadProject(root,'v1.9');

const defs=[];
const intact=[];
for(let id=600;id<650;id++){const variant=(id-600)%10; const mode=Math.floor((id-600)/10); if(variant!==6 && !(mode>=3&&variant===7)) intact.push(id);}
for(const sceneId of intact.slice(0,30)) defs.push({category:'cloth-full',sceneId,operation:'full',warmup:12,iterations:75});
for(let mode=0;mode<5;mode++) for(const variant of [3,9]) defs.push({category:'cloth-adaptive-long',sceneId:600+mode*10+variant,operation:'full',warmup:18,iterations:135});
for(let mode=0;mode<5;mode++) defs.push({category:'cloth-adaptive-storm',sceneId:600+mode*10+9,operation:'full',warmup:7,iterations:65,rain:72});
for(let sceneId=650;sceneId<670;sceneId++) defs.push({category:'rope-frame',sceneId,operation:'frame',warmup:24,iterations:1800});
for(let sceneId=680;sceneId<700;sceneId++) defs.push({category:'rope-full',sceneId,operation:'full',warmup:12,iterations:100});
for(let sceneId=695;sceneId<700;sceneId++) defs.push({category:'rope-storm',sceneId,operation:'full',warmup:6,iterations:55,rain:96});
for(const sceneId of [606,616,626,636,646]) defs.push({category:'tearing-control',sceneId,operation:'full',warmup:10,iterations:65});
for(const sceneId of [745,746,747,748,749]) defs.push({category:'water-control',sceneId,operation:'full',warmup:15,iterations:180});
if(defs.length!==100)throw new Error(`expected 100 definitions, got ${defs.length}`);

function createSuite(project,d){const suite=project.createSuite(); if(!suite.createScene(project.SCENES[d.sceneId],5,0x190000+d.sceneId))throw new Error('create scene'); if(d.rain)suite.spawnRain(d.rain,14,24); return suite;}
function op(suite,d){if(d.operation==='frame'){suite.active.frameDirty=true;suite.buildFrame(false);}else if(d.operation==='step'){suite.step(1/60,4);}else{suite.step(1/60,4);suite.buildFrame(false);}}
function reconstructRope(frame){
  if(!frame.ropeGrid){return {matrices:Float32Array.from(frame.matrices.subarray(0,frame.instanceCount*16)),colors:Float32Array.from(frame.colors.subarray(0,frame.instanceCount*4)),count:frame.instanceCount};}
  const g=frame.ropeGrid; const total=g.segmentCount+frame.instanceCount; const matrices=new Float32Array(total*16); const colors=new Float32Array(total*4); const p=g.positions,s=g.segments;
  for(let i=0;i<g.segmentCount;i++){
    const so=i*8,a=s[so]|0,b=s[so+1]|0,ao=a*3,bo=b*3;
    const ax=p[ao],ay=p[ao+1],az=p[ao+2],bx=p[bo],by=p[bo+1],bz=p[bo+2];
    const dx=bx-ax,dy=by-ay,dz=bz-az,len2=dx*dx+dy*dy+dz*dz,raw=len2>0?Math.sqrt(len2):0,len=Math.max(raw,0.0001);
    const yx=dx/len,yy=dy/len,yz=dz/len; let xx,xy,xz;
    if(Math.abs(yy)<0.92){xx=yz;xy=0;xz=-yx;}else{xx=-yy;xy=yx;xz=0;}
    const xl=Math.max(Math.sqrt(xx*xx+xy*xy+xz*xz),0.000001); xx/=xl;xy/=xl;xz/=xl;
    const zx=yy*xz-yz*xy,zy=yz*xx-yx*xz,zz=yx*xy-yy*xx;
    const tension=Math.max(0,Math.min(1,(raw*s[so+2]-1)*4.2)),r=s[so+3]*(1-tension*0.2),mo=i*16;
    matrices[mo]=xx*r;matrices[mo+1]=xy*r;matrices[mo+2]=xz*r;matrices[mo+4]=yx*len*0.5;matrices[mo+5]=yy*len*0.5;matrices[mo+6]=yz*len*0.5;matrices[mo+8]=zx*r;matrices[mo+9]=zy*r;matrices[mo+10]=zz*r;matrices[mo+12]=(ax+bx)*0.5;matrices[mo+13]=(ay+by)*0.5;matrices[mo+14]=(az+bz)*0.5;matrices[mo+15]=1;
    const co=i*4; colors[co]=s[so+4]+(1-s[so+4])*tension;colors[co+1]=s[so+5]+(0.06-s[so+5])*tension;colors[co+2]=s[so+6]+(0.02-s[so+6])*tension;colors[co+3]=s[so+7]+(2.2-s[so+7])*tension;
  }
  matrices.set(frame.matrices.subarray(0,frame.instanceCount*16),g.segmentCount*16); colors.set(frame.colors.subarray(0,frame.instanceCount*4),g.segmentCount*4);
  return {matrices,colors,count:total};
}
function capture(project,suite){
  const frame=suite.buildFrame(false),active=suite.active,state=Float32Array.from((active.kind==='water'?active.eta:active.positions));
  const render=reconstructRope(frame);
  const ropeDynamic=frame.ropeGrid?frame.ropeGrid.nodeCount*12+frame.instanceCount*80:frame.kind==='rope'?frame.instanceCount*80:0;
  let surfaceDynamic=0;
  if(project.unifiedSurface){
    if(frame.surface?.path==='gpu-cloth'||frame.surface?.path==='gpu-water')surfaceDynamic=frame.surface.vertexCount*12;
    else if(frame.surface?.path==='packed')surfaceDynamic=frame.surface.vertexCount*frame.surface.vertexStride;
  }else{
    // Preserve the historical v1.8 accounting contract exactly.
    if(frame.clothGrid)surfaceDynamic=frame.clothGrid.vertexCount*(frame.clothGrid.restPositions?12:16);
    else if(frame.waterGrid)surfaceDynamic=frame.waterGrid.vertexCount*12;
    else if(frame.surface)surfaceDynamic=frame.surface.vertexCount*frame.surface.vertexStride;
  }
  return {hash:suite.hash(),state,render,finite:finite(state)&&finite(render.matrices)&&finite(render.colors),nodes:frame.nodeCount,constraints:frame.constraintCount,broken:frame.brokenCount,ropeSegments:frame.ropeGrid?.segmentCount??0,instanceCount:render.count,dynamicBytes:ropeDynamic+surfaceDynamic};
}
function measure(project,d){global.gc?.();const suite=createSuite(project,d);const warm=Math.max(2,Math.round(d.warmup*scale)),iters=Math.max(3,Math.round(d.iterations*scale));for(let i=0;i<warm;i++)op(suite,d);global.gc?.();const t=performance.now();for(let i=0;i<iters;i++)op(suite,d);const ms=(performance.now()-t)/iters;const cap=capture(project,suite);suite.destroy();return {ms,cap,iters};}

const records=[]; const allStart=performance.now();
for(let index=startExperiment-1;index<endExperiment;index++){
  const d=defs[index],bt=[],ot=[],bc=[],oc=[];
  for(let sample=0;sample<samples;sample++){
    const order=((index+sample)&1)===0?[[baseline,bt,bc],[optimized,ot,oc]]:[[optimized,ot,oc],[baseline,bt,bc]];
    for(const [project,times,caps] of order){const r=measure(project,d);times.push(r.ms);caps.push(r.cap);}
  }
  const b=bc.at(-1),o=oc.at(-1),bmed=median(bt),omed=median(ot),speedup=bmed/omed;
  const stateError=relativeL2(b.state,o.state),matrixError=relativeL2(b.render.matrices,o.render.matrices),colorError=relativeL2(b.render.colors,o.render.colors);
  const control=d.category.endsWith('control');
  const stateLimit=d.category.startsWith('cloth')?0.0025:1e-6;
  const correctness=b.finite&&o.finite&&b.nodes===o.nodes&&b.constraints===o.constraints&&b.instanceCount===o.instanceCount&&stateError<=stateLimit&&matrixError<=2e-4&&colorError<=2e-4;
  const decision=!correctness?'rejected-correctness':control?'control':speedup>=1.03?'accepted':speedup>=0.98?'borderline':'rejected-no-win';
  records.push({id:index+1,...d,title:baseline.SCENES[d.sceneId].title,baselineSamplesMs:bt,optimizedSamplesMs:ot,baselineMedianMs:bmed,optimizedMedianMs:omed,baselineMadMs:mad(bt),optimizedMadMs:mad(ot),speedup,stateError,matrixError,colorError,baselineDynamicBytes:b.dynamicBytes,optimizedDynamicBytes:o.dynamicBytes,dynamicByteReduction:b.dynamicBytes?1-o.dynamicBytes/b.dynamicBytes:0,baselineHash:b.hash,optimizedHash:o.hash,correctness,decision});
  console.log(`${String(index+1).padStart(3,'0')}/100 ${d.category.padEnd(22)} ${speedup.toFixed(3)}x ${decision}`);
}
const changed=records.filter(r=>!r.category.endsWith('control'));
const summary={version:'1.9.0',baseline:'1.8.0',range:[startExperiment,endExperiment],experiments:records.length,samples,scale,elapsedSeconds:(performance.now()-allStart)/1000,accepted:records.filter(r=>r.decision==='accepted').length,borderline:records.filter(r=>r.decision==='borderline').length,rejectedNoWin:records.filter(r=>r.decision==='rejected-no-win').length,rejectedCorrectness:records.filter(r=>r.decision==='rejected-correctness').length,controls:records.filter(r=>r.decision==='control').length,changedGeometricMean:geometricMean(changed.map(r=>r.speedup)),changedMedian:median(changed.map(r=>r.speedup)),records};
const resultBase = startExperiment === 1 && endExperiment === 100 ? 'v1.9-fifth-breakthrough-100' : `v1.9-fifth-breakthrough-shard-${startExperiment}-${endExperiment}`;
fs.writeFileSync(path.join(resultsDir,`${resultBase}.json`),JSON.stringify(summary,null,2));
const csv=['id,category,sceneId,title,baselineMedianMs,optimizedMedianMs,speedup,stateError,matrixError,colorError,baselineDynamicBytes,optimizedDynamicBytes,dynamicByteReduction,decision'];
for(const r of records)csv.push([r.id,r.category,r.sceneId,JSON.stringify(r.title),r.baselineMedianMs,r.optimizedMedianMs,r.speedup,r.stateError,r.matrixError,r.colorError,r.baselineDynamicBytes,r.optimizedDynamicBytes,r.dynamicByteReduction,r.decision].join(','));
fs.writeFileSync(path.join(resultsDir,`${resultBase}.csv`),csv.join('\n')+'\n');
console.log(JSON.stringify({...summary,records:undefined},null,2));
if(summary.experiments!==(endExperiment-startExperiment+1)||summary.rejectedCorrectness>0)process.exitCode=1;
