#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inventory,hashFile,hashValue,reserveRunDirectory,writeJsonExclusive,parseArgs} from './engine-baseline.mjs';
import {frameSection,cantileverDefinition,continuumCantileverMode,cantileverFrequency,independentFrameTrajectory,independentFrameImpulseDefect,plainFrameSnapshot} from './frame-oracle.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceFiles=['src/engine/contracts.ts','src/engine/frame-element.ts','src/engine/frame-runtime.ts','scripts/frame-oracle.mjs','scripts/frame-qualify.mjs','scripts/engine-baseline.mjs','tests/engine/frame.test.mjs','tests/qualification/frame-evidence.test.mjs'];
export function frameProtocol(){
  const cases=[];
  for(const segments of [1,4,16,32])for(const component of [0,1,2,3,4,5])cases.push({id:`cantilever-${segments}-${component}`,kind:'static',segments,component,ticks:0,samples:0});
  for(const segments of [2,8,16])for(const supported of [false,true])cases.push({id:`gravity-${segments}-${supported?'supported':'cantilever'}`,kind:'gravity',segments,supported,ticks:0,samples:0});
  for(const component of [0,3])for(const steps of [32,64,128,256])cases.push({id:`oscillator-${component}-${steps}`,kind:'oscillator',segments:1,component,steps,ticks:20*steps,samples:40});
  for(const segments of [2,4,8,16])cases.push({id:`bending-mesh-${segments}`,kind:'bending',refinement:'mesh',segments,steps:1024,ticks:1024,samples:32});
  for(const steps of [64,128,256,512])cases.push({id:`bending-time-${steps}`,kind:'bending',refinement:'time',segments:16,steps,ticks:steps,samples:32});
  for(const free of [false,true])cases.push({id:`spatial-${free?'free':'anchored'}`,kind:'spatial',segments:4,free,expectedDomainExceeded:free,ticks:240,samples:24});
  cases.push({id:'spatial-free-small-load',kind:'spatial',segments:4,free:true,loadScale:.1,expectedDomainExceeded:false,ticks:240,samples:24});
  cases.push({id:'underconverged',kind:'underconverged',segments:8,ticks:4,samples:4},{id:'static-mechanism',kind:'mechanism',segments:1,ticks:0,samples:0},{id:'static-domain',kind:'domain',segments:2,ticks:0,samples:0});
  return {schema:'box3d.frame-protocol/4',backend:'frame-eb-midpoint-js-f64-v1',cases,thresholds:{staticDisplacement:2e-10,staticReaction:4e-7,staticEndForce:4e-7,discretePosition:1e-10,discreteVelocity:1e-7,energy:1e-8,linearImpulse:2e-9,angularImpulse:2e-9,densePosition:2e-9,denseVelocity:5e-8,temporalRatioMin:3.7,temporalRatioMax:4.4,spatialAdjustedRatioMin:8,spatialAdjustedRatioMax:24,coarseContinuumModeError:.01,finestContinuumModeError:2e-5},
    scope:'Linear 3D Euler-Bernoulli frames: all six static tip-load components, consistent gravity loading, midpoint axial/torsional trajectories, bending mesh/time refinement, independent quadrature/dense dynamics, energy/work and generalized momentum balance, explicit under-convergence/mechanisms/domain screens, full-state/checkpoint replay. No shear, finite rotations, buckling, damage, contact, physical calibration, coupled bridge adoption or timing claim.'};
}
const oscillatorOmega=component=>component===0?Math.sqrt(3*frameSection.youngModulus/(frameSection.density*4)):Math.sqrt(3*frameSection.shearModulus*frameSection.torsionConstant/(frameSection.density*(frameSection.iy+frameSection.iz)*4));
export function frameCaseDefinition(spec){
  const d=cantileverDefinition({segments:spec.segments,free:spec.free??spec.kind==='mechanism'}),n=spec.segments,size=6*(n+1);d.forces=new Float64Array(size);
  if(spec.kind==='static')d.forces[6*n+spec.component]=spec.component<3?10:2;
  if(spec.kind==='gravity'){
    d.config.gravity=[0,-9.81,0];if(spec.supported){d.fixed.fill(0);for(const i of [0,1,2,3,6*n+1,6*n+2])d.fixed[i]=1;}
  }
  if(spec.kind==='oscillator'){d.config.dt=2*Math.PI/oscillatorOmega(spec.component)/spec.steps;d.displacements=new Float64Array(size);d.displacements[6+spec.component]=.0001;}
  if(spec.kind==='bending'){
    d.config={...d.config,dt:2*Math.PI/cantileverFrequency(2)/spec.steps,maxIterations:512,forceTolerance:1e-7,momentTolerance:1e-8};d.displacements=new Float64Array(size);
    for(let i=1;i<=n;i++){const m=continuumCantileverMode(2*i/n,2);d.displacements[6*i+1]=.001*m.value;d.displacements[6*i+5]=.001*m.slope;}
  }
  if(spec.kind==='spatial'){
    d.config={...d.config,gravity:[0,-1,.3],drag:2,substeps:2,forceTolerance:1e-10,momentTolerance:1e-10,maxIterations:512};
    for(let i=0;i<=n;i++){d.positions[3*i+1]=.13*Math.sin(i);d.positions[3*i+2]=.07*i*i;}
    d.pointMasses=Float64Array.from({length:n+1},(_,i)=>.1*(i+1));d.pointInertias=Float64Array.from({length:3*(n+1)},(_,i)=>.001*(i+1));
  }
  if(spec.kind==='underconverged'){d.config.maxIterations=1;d.forces[6*n+1]=-10;}
  if(spec.kind==='mechanism')d.forces[6]=1;
  if(spec.kind==='domain')d.forces[6*n+1]=1000;
  return d;
}
const total=s=>s.diagnostics.kineticEnergy+s.diagnostics.elasticEnergy+s.diagnostics.gravitationalEnergy;
const plainDefinition=d=>Object.fromEntries(Object.entries(d).map(([k,v])=>[k,ArrayBuffer.isView(v)?Array.from(v):v]));
const plainStatic=s=>s?{...s,positions:Array.from(s.positions),displacements:Array.from(s.displacements),supportReactions:Array.from(s.supportReactions),elementEndForces:Array.from(s.elementEndForces)}:null;
function finiteTree(value){if(typeof value==='number')assert.ok(Number.isFinite(value),'Nonfinite retained value');else if(value&&typeof value==='object')for(const v of Object.values(value))finiteTree(v);}
export function executeFrameCase(spec,core){
  const d=frameCaseDefinition(spec),r=new core.FrameRuntime(d),samples=[plainFrameSnapshot(r.inspect())],reference=spec.kind==='spatial'?independentFrameTrajectory(d):undefined;
  const stats={checkedTicks:0,unconvergedSolves:0,maxForceResidual:0,maxMomentResidual:0,maxImpulseResidual:0,maxAngularImpulseResidual:0,maxEnergyDefect:0,maxLinearImpulseDefect:0,maxAngularImpulseDefect:0,maxDensePositionError:0,maxDenseVelocityError:0,maxDiscretePositionError:0,maxDiscreteVelocityError:0,maxContinuumError:0,maxPhaseAdjustedModeError:0,maxIterationsUsed:0,matrixProducts:0,elementVisits:0,domainExceededTicks:0};
  const initial=r.inspect();let previous=initial,staticSolution=null;
  try{
    if(!spec.ticks){const before=r.checkpoint();staticSolution=plainStatic(r.solveStatic());assert.deepEqual(r.checkpoint(),before,'Static analysis mutated dynamic state');}
    for(let tick=1;tick<=spec.ticks;tick++){
      const commands=spec.kind==='spatial'?(tick===1?[{tick,type:'force',node:4,value:[.2,-1,.3,.01,.02,.03]}]:tick===80?[{tick,type:'impulse',node:4,value:[.003,-.002,.001,.0001,.0002,.0001]}]:[]):[];
      if(spec.loadScale!==undefined)for(const command of commands)command.value=command.value.map(v=>v*spec.loadScale);
      const s=r.step({ticks:1,commands}),v=s.diagnostics;finiteTree(s);stats.checkedTicks++;stats.unconvergedSolves+=v.unconvergedSolves;stats.domainExceededTicks+=v.linearKinematicsExceeded?1:0;
      for(const key of ['maxForceResidual','maxMomentResidual','maxImpulseResidual','maxAngularImpulseResidual','maxIterationsUsed'])stats[key]=Math.max(stats[key],v[key]);stats.matrixProducts+=v.matrixProducts;stats.elementVisits+=v.elementVisits;
      stats.maxEnergyDefect=Math.max(stats.maxEnergyDefect,Math.abs(total(s)-total(initial)-v.externalWork+v.dragDissipation));
      if(reference){const expected=reference.step(commands),defect=independentFrameImpulseDefect(reference.matrices,previous,s,d.positions);for(let j=0;j<s.velocities.length;j++){stats.maxDensePositionError=Math.max(stats.maxDensePositionError,Math.abs(s.displacements[j]-expected.displacements[j]));stats.maxDenseVelocityError=Math.max(stats.maxDenseVelocityError,Math.abs(s.velocities[j]-expected.velocities[j]));}stats.maxLinearImpulseDefect=Math.max(stats.maxLinearImpulseDefect,defect.linear);stats.maxAngularImpulseDefect=Math.max(stats.maxAngularImpulseDefect,defect.angular);}
      if(spec.kind==='oscillator'){
        const w=oscillatorOmega(spec.component),angle=tick*2*Math.atan(w*d.config.dt/2),j=6+spec.component;
        stats.maxDiscretePositionError=Math.max(stats.maxDiscretePositionError,Math.abs(s.displacements[j]-.0001*Math.cos(angle)));stats.maxDiscreteVelocityError=Math.max(stats.maxDiscreteVelocityError,Math.abs(s.velocities[j]+.0001*w*Math.sin(angle)));stats.maxContinuumError=Math.max(stats.maxContinuumError,Math.abs(s.displacements[j]/.0001-Math.cos(w*v.time)));
      }
      if(spec.kind==='bending'){
        const w=cantileverFrequency(2),value=s.displacements[6*spec.segments+1]/.001;stats.maxContinuumError=Math.max(stats.maxContinuumError,Math.abs(value-Math.cos(w*v.time)));stats.maxPhaseAdjustedModeError=Math.max(stats.maxPhaseAdjustedModeError,Math.abs(value-Math.cos(tick*2*Math.atan(w*d.config.dt/2))));
      }
      if(tick%(spec.ticks/spec.samples)===0)samples.push(plainFrameSnapshot(s));previous=s;
    }
    const checkpoint=JSON.parse(JSON.stringify(r.checkpoint())),restored=core.FrameRuntime.fromCheckpoint(checkpoint);try{assert.deepEqual(restored.inspect(),r.inspect());assert.deepEqual(restored.step({ticks:17}),r.step({ticks:17}));}finally{restored.destroy();}
    const result={spec,definition:plainDefinition(d),staticSolution,stats,samples,checkpoint,continuation:plainFrameSnapshot(r.inspect())};finiteTree(result);return result;
  }finally{r.destroy();}
}
function expectedStatic(spec,d){
  const n=spec.segments,L=2,{youngModulus:E,shearModulus:G,area:A,iy:Iy,iz:Iz,torsionConstant:J,density:rho}=frameSection,u=new Float64Array((n+1)*6),reactions=new Float64Array(u.length),endForces=new Float64Array(n*12);
  if(spec.kind==='gravity'){
    const q=-rho*A*9.81,EI=E*Iz;
    for(let i=0;i<=n;i++){const x=L*i/n;u[6*i+1]=spec.supported?q*x*(L**3-2*L*x*x+x**3)/(24*EI):q*x*x*(6*L*L-4*L*x+x*x)/(24*EI);u[6*i+5]=spec.supported?q*(L**3-6*L*x*x+4*x**3)/(24*EI):q*x*(3*L*L-3*L*x+x*x)/(6*EI);}
    reactions[1]=spec.supported?-q*L/2:-q*L;if(spec.supported)reactions[6*n+1]=-q*L/2;else reactions[5]=-q*L*L/2;
    for(let i=0;i<n;i++){
      const a=L*i/n,b=L*(i+1)/n,j=12*i;
      endForces[j+1]=-q*((spec.supported?L/2:L)-a);endForces[j+7]=q*((spec.supported?L/2:L)-b);
      endForces[j+5]=spec.supported?q*a*(L-a)/2:-q*(L-a)**2/2;endForces[j+11]=spec.supported?-q*b*(L-b)/2:q*(L-b)**2/2;
    }
  }else{
    const c=spec.component,P=d.forces[6*n+c];reactions[c]=-P;
    for(let i=0;i<=n;i++){const x=L*i/n,j=6*i;if(c===0)u[j]=P*x/(E*A);if(c===1){u[j+1]=P*x*x*(3*L-x)/(6*E*Iz);u[j+5]=P*x*(2*L-x)/(2*E*Iz);}if(c===2){u[j+2]=P*x*x*(3*L-x)/(6*E*Iy);u[j+4]=-P*x*(2*L-x)/(2*E*Iy);}if(c===3)u[j+3]=P*x/(G*J);if(c===4){u[j+2]=-P*x*x/(2*E*Iy);u[j+4]=P*x/(E*Iy);}if(c===5){u[j+1]=P*x*x/(2*E*Iz);u[j+5]=P*x/(E*Iz);}}
    if(c===1)reactions[5]=-P*L;if(c===2)reactions[4]=P*L;
    for(let i=0;i<n;i++){
      const a=L*i/n,b=L*(i+1)/n,j=12*i;endForces[j+c]=-P;endForces[j+6+c]=P;
      if(c===1){endForces[j+5]=-P*(L-a);endForces[j+11]=P*(L-b);}if(c===2){endForces[j+4]=P*(L-a);endForces[j+10]=-P*(L-b);}
    }
  }
  return {u,reactions,endForces};
}
export function evaluateFrames(records,p=frameProtocol()){
  const issues=[],checks=[],require=(condition,message)=>{if(!condition)issues.push(message);},t=p.thresholds;
  require(JSON.stringify(records.map(r=>r.spec))===JSON.stringify(p.cases),'Case matrix differs');
  for(const record of records){
    const {spec,definition:d,stats,staticSolution:s,samples}=record,start=issues.length,check={id:spec.id,...stats};
    try{finiteTree(record);}catch{require(false,`${spec.id}: nonfinite record`);}
    require(stats.checkedTicks===spec.ticks&&samples.length===spec.samples+1,`${spec.id}: tick/sample coverage`);require(samples.every((s,i)=>s.backend===p.backend&&s.tick===(spec.ticks?i*spec.ticks/spec.samples:0)),`${spec.id}: backend/sample times`);
    if(spec.kind==='static'||spec.kind==='gravity'){
      const reference=expectedStatic(spec,d);check.displacementError=Math.max(...s.displacements.map((v,i)=>Math.abs(v-reference.u[i])));check.reactionError=Math.max(...s.supportReactions.map((v,i)=>Math.abs(v-reference.reactions[i])));check.endForceError=Math.max(...s.elementEndForces.map((v,i)=>Math.abs(v-reference.endForces[i])));
      require(s.converged&&s.forceResidual<=d.config.forceTolerance&&s.momentResidual<=d.config.momentTolerance,`${spec.id}: static convergence`);require(check.displacementError<=t.staticDisplacement&&check.reactionError<=t.staticReaction&&check.endForceError<=t.staticEndForce,`${spec.id}: analytical displacement/reaction/end action`);require(!s.linearKinematicsExceeded,`${spec.id}: static model domain`);
    }
    if(spec.kind==='mechanism')require(!s.converged,`${spec.id}: mechanism falsely converged`);
    if(spec.kind==='domain')require(s.converged&&s.linearKinematicsExceeded,`${spec.id}: missing model-domain warning`);
    if(spec.kind==='underconverged')require(stats.unconvergedSolves>0,`${spec.id}: missing iteration warning`);
    else if(spec.ticks){
      require(stats.unconvergedSolves===0&&stats.maxForceResidual<=d.config.forceTolerance&&stats.maxMomentResidual<=d.config.momentTolerance&&stats.maxImpulseResidual<=d.config.impulseTolerance&&stats.maxAngularImpulseResidual<=d.config.angularImpulseTolerance,`${spec.id}: dynamic convergence`);
      require(stats.maxEnergyDefect<=t.energy,`${spec.id}: energy/work balance`);require(spec.expectedDomainExceeded?stats.domainExceededTicks>0:stats.domainExceededTicks===0,`${spec.id}: dynamic model domain`);check.modelDomainAccepted=!spec.expectedDomainExceeded;
      if(spec.kind==='spatial')require(stats.maxDensePositionError<=t.densePosition&&stats.maxDenseVelocityError<=t.denseVelocity&&stats.maxLinearImpulseDefect<=t.linearImpulse&&stats.maxAngularImpulseDefect<=t.angularImpulse,`${spec.id}: independent dynamics/impulse`);
      if(spec.kind==='oscillator')require(stats.maxDiscretePositionError<=t.discretePosition&&stats.maxDiscreteVelocityError<=t.discreteVelocity,`${spec.id}: exact discrete trajectory`);
      if(spec.kind==='bending')require(stats.maxContinuumError<=t.coarseContinuumModeError,`${spec.id}: continuum phase/amplitude`);
    }
    check.issues=issues.slice(start);checks.push(check);
  }
  const ratio=errors=>errors.slice(1).map((v,i)=>errors[i]/v),temporal=[];
  for(const component of [0,3]){const errors=[32,64,128,256].map(n=>checks.find(c=>c.id===`oscillator-${component}-${n}`)?.maxContinuumError),ratios=ratio(errors);require(ratios.every(v=>v>=t.temporalRatioMin&&v<=t.temporalRatioMax),`component ${component}: temporal refinement`);temporal.push({kind:'oscillator',component,errors,ratios});}
  const timeErrors=[64,128,256,512].map(n=>checks.find(c=>c.id===`bending-time-${n}`)?.maxContinuumError),timeRatios=ratio(timeErrors);require(timeRatios.every(v=>v>=t.temporalRatioMin&&v<=t.temporalRatioMax),'bending: temporal refinement');temporal.push({kind:'bending',errors:timeErrors,ratios:timeRatios});
  const adjustedErrors=[2,4,8,16].map(n=>checks.find(c=>c.id===`bending-mesh-${n}`)?.maxPhaseAdjustedModeError),continuumErrors=[2,4,8,16].map(n=>checks.find(c=>c.id===`bending-mesh-${n}`)?.maxContinuumError),spatialRatios=ratio(adjustedErrors);
  require(spatialRatios.every(v=>v>=t.spatialAdjustedRatioMin&&v<=t.spatialAdjustedRatioMax),'bending: phase-adjusted mesh refinement');require(continuumErrors.at(-1)<=t.finestContinuumModeError,'bending: finest continuum error');
  return {status:issues.length?'failed':'passed',issues,cases:records.length,samples:records.reduce((sum,r)=>sum+r.samples.length,0),checkedTicks:records.reduce((sum,r)=>sum+r.stats.checkedTicks,0),checks,temporal,spatial:{adjustedErrors,continuumErrors,ratios:spatialRatios,meaning:'The mesh diagnostic removes the analytically known midpoint phase of the continuum frequency. Unadjusted continuum errors are retained separately.'},scope:p.scope,speedupClaim:false};
}
export async function qualifyFrames(out){
  out=await reserveRunDirectory(out,[root]);const p=frameProtocol(),source=await inventory(root,sourceFiles,1024*1024);await fs.mkdir(path.join(out,'source'));
  for(const entry of source.files){const target=path.join(out,'source',entry.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,entry.path),target,fs.constants.COPYFILE_EXCL);assert.equal(await hashFile(target),entry.sha256);}
  await writeJsonExclusive(path.join(out,'protocol.json'),p);await writeJsonExclusive(path.join(out,'manifest.json'),{schema:'box3d.frame-manifest/1',source,protocolSha256:hashValue(p),createdAt:new Date().toISOString(),runtime:{node:process.version,platform:process.platform,arch:process.arch}});
  const core=await import(pathToFileURL(path.join(out,'source/src/engine/frame-runtime.ts')).href),records=[];
  for(const spec of p.cases){const record=executeFrameCase(spec,core);records.push(record);await writeJsonExclusive(path.join(out,spec.id+'.json'),record);}
  assert.deepEqual(await inventory(root,sourceFiles,1024*1024),source,'Source changed during qualification');const result={schema:'box3d.frame-result/1',sourceSha256:source.sha256,protocolSha256:hashValue(p),records,gate:evaluateFrames(records,p)};await writeJsonExclusive(path.join(out,'result.json'),result);return result.gate;
}
export async function auditFrames(out){
  const report={schema:'box3d.frame-integrity/1',status:'failed',issues:[]};
  try{
    out=await fs.realpath(out);const read=async name=>{const target=path.join(out,name),stat=await fs.lstat(target);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=16*1024*1024);return JSON.parse(await fs.readFile(target,'utf8'));};
    const p=await read('protocol.json'),manifest=await read('manifest.json'),result=await read('result.json');assert.equal(manifest.schema,'box3d.frame-manifest/1');assert.equal(result.schema,'box3d.frame-result/1');assert.deepEqual(p,frameProtocol());
    const source=await inventory(path.join(out,'source'),['.'],1024*1024);assert.deepEqual(source,manifest.source);assert.equal(result.sourceSha256,source.sha256);assert.equal(manifest.protocolSha256,hashValue(p));assert.equal(result.protocolSha256,hashValue(p));assert.deepEqual(result.records.map(r=>r.spec),p.cases);
    const core=await import(pathToFileURL(path.join(out,'source/src/engine/frame-runtime.ts')).href);
    for(const record of result.records){assert.deepEqual(await read(record.spec.id+'.json'),record);assert.deepEqual(executeFrameCase(record.spec,core),record,'Full frame state, every-tick metrics or checkpoint replay differs');}
    const gate=evaluateFrames(result.records,p);assert.deepEqual(gate,result.gate);assert.equal(gate.status,'passed',gate.issues.join('\n'));Object.assign(report,{status:'passed',cases:gate.cases,samples:gate.samples,checkedTicks:gate.checkedTicks,sourceSha256:source.sha256,protocolSha256:hashValue(p),resultSha256:await hashFile(path.join(out,'result.json')),scope:p.scope,speedupClaim:false});
  }catch(error){report.issues.push(error.message);}return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2),['--out','--check']);assert.ok(Boolean(args['--out'])!==Boolean(args['--check']),'Choose --out NEW_DIRECTORY or --check EXISTING_DIRECTORY');const result=args['--out']?await qualifyFrames(args['--out']):await auditFrames(args['--check']);console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='passed'?0:1;
}
