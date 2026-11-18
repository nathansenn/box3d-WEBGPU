#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inventory,hashFile,hashValue,reserveRunDirectory,writeJsonExclusive,parseArgs} from './engine-baseline.mjs';
import {proximalConfig,spanDefinition,discreteSpanReference,continuumSpanReference,symmetricDefinition,symmetricTrajectory,independentForceResidual,impulseDefect,plainProximalState} from './cable-proximal-oracle.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sourceFiles=['src/engine/contracts.ts','src/engine/compliant-cable.ts','scripts/cable-proximal-oracle.mjs','scripts/cable-proximal-qualify.mjs','scripts/cable-oracle.mjs','scripts/engine-baseline.mjs','tests/engine/proximal-cable.test.mjs','tests/qualification/proximal-cable-evidence.test.mjs'];
export function proximalProtocol(){
  const cases=[];
  for(const dt of [1/30,1/120,1/480])for(const hard of [false,true])cases.push({id:`symmetric-${Math.round(1/dt)}-${hard?'hard':'elastic'}`,kind:'symmetric',dt,hard,ticks:Math.round(1/dt),samples:30});
  for(const rigidity of [500,1000,5000])for(const segments of [8,16,32])cases.push({id:`span-${segments}-${rigidity}-16`,kind:'span',segments,rigidity,substeps:16,ticks:1200,samples:20});
  for(const substeps of [4,8])cases.push({id:`span-32-1000-${substeps}`,kind:'span',segments:32,rigidity:1000,substeps,ticks:1200,samples:20});
  cases.push({id:'span-8-hard',kind:'span',segments:8,hard:true,substeps:8,ticks:1200,samples:20});
  cases.push({id:'off-axis-network',kind:'network',ticks:600,samples:30});
  cases.push({id:'span-forces-and-impulse',kind:'commands',segments:16,substeps:8,ticks:300,samples:30});
  cases.push({id:'underconverged-span',kind:'underconverged',segments:16,substeps:1,ticks:4,samples:4});
  return {schema:'box3d.proximal-cable-protocol/1',backend:'cable-proximal-js-f64-v2',cases,
    thresholds:{shape:2e-7,tension:2e-5,reaction:3e-6,hardReaction:2e-5,scalarPosition:1e-8,scalarVelocity:2e-7,impulse:2e-9,independentForce:2e-7,energyDefect:1e-8,spatialRatioMinimum:3.7,spatialRatioMaximum:4.3},
    scope:'Nonlinear tension-only elastic and hard cable solves: scalar implicit trajectories, discrete static force polygons, elastic catenary mesh refinement, every outer-tick impulse balance, independent single-substep force/energy checks, under-convergence and complete checkpoint continuation. No bending, contact, material calibration, rigid coupling or timing acceptance.'};
}
function definition(spec,core){
  if(spec.kind==='symmetric')return symmetricDefinition(spec);
  if(spec.kind==='network')return {config:{...proximalConfig,dt:1/120,substeps:1,drag:0,gravity:[0,0,0],residualTolerance:1e-11,forceTolerance:1e-7},positions:[-1,0,.2,.8,.3,-.1,.2,1,.8],masses:[2,3,1],velocities:[.4,.2,.1,-.3,.1,-.2,.2,-.3,.4],constraints:[{a:0,b:1,restLength:1.5,compliance:.01},{a:1,b:2,restLength:1,compliance:.02},{a:2,b:0,restLength:1.1,compliance:.015}]};
  const d=spanDefinition(core,spec);
  if(spec.kind==='underconverged'){d.config.maxIterations=1;d.config.residualTolerance=.01;d.positions[25]=-.8;}
  return d;
}

export function executeProximalCase(spec,core){
  const d=definition(spec,core),r=new core.CompliantCableRuntime(d),samples=[plainProximalState(r.inspect())],interval=spec.ticks/spec.samples;
  const stats={checkedTicks:0,unconvergedSubsteps:0,maxImplicitForceResidual:0,maxConstraintForceResidual:0,maxConstitutiveResidual:0,maxIndependentForceResidual:0,maxImpulseDefect:0,maxEnergyDefect:0,maxIterationsUsed:0,constraintProjections:0};
  let previous=r.inspect();
  try{
    for(let tick=1;tick<=spec.ticks;tick++){
      const commands=spec.kind==='commands'?(tick===1?[{tick,type:'force',node:8,value:[.2,-1,.1]},{tick,type:'force',node:0,value:[3,2,1]}]:tick===80?[{tick,type:'impulse',node:8,value:[.35,0,.15]}]:[]):[];
      const s=r.step({ticks:1,commands}),v=s.diagnostics;stats.checkedTicks++;
      assert.ok([...s.positions,...s.velocities,...s.tensions,...s.supportReactions,...Object.values(v).flat(),...s.impulses.support,...s.impulses.applied,...s.impulses.drag].every(Number.isFinite));
      stats.unconvergedSubsteps+=v.unconvergedSubsteps;stats.maxImplicitForceResidual=Math.max(stats.maxImplicitForceResidual,v.maxImplicitForceResidual);stats.maxConstraintForceResidual=Math.max(stats.maxConstraintForceResidual,v.maxConstraintForceResidual);stats.maxConstitutiveResidual=Math.max(stats.maxConstitutiveResidual,v.maxResidual);
      stats.maxIterationsUsed=Math.max(stats.maxIterationsUsed,v.maxIterationsUsed);stats.constraintProjections+=v.constraintProjections;
      stats.maxImpulseDefect=Math.max(stats.maxImpulseDefect,impulseDefect(previous,s));
      if(d.config.substeps===1)stats.maxIndependentForceResidual=Math.max(stats.maxIndependentForceResidual,independentForceResidual(d,previous,s));
      if(spec.kind==='network'){
        const defect=d.masses.reduce((sum,m,i)=>sum+.5*m*[0,1,2].reduce((v,k)=>v+(s.velocities[3*i+k]-previous.velocities[3*i+k])**2,0),0);
        stats.maxEnergyDefect=Math.max(stats.maxEnergyDefect,v.kineticEnergy+v.elasticEnergy+defect-previous.diagnostics.kineticEnergy-previous.diagnostics.elasticEnergy);
      }
      if(tick%interval===0)samples.push(plainProximalState(s));previous=s;
    }
    const checkpoint=JSON.parse(JSON.stringify(r.checkpoint())),restored=core.CompliantCableRuntime.fromCheckpoint(checkpoint);
    try{assert.deepEqual(restored.inspect(),r.inspect());assert.deepEqual(restored.step({ticks:17}),r.step({ticks:17}));}finally{restored.destroy();}
    return {spec,definition:dToPlain(d),stats,samples,checkpoint,continuation:plainProximalState(r.inspect())};
  }finally{r.destroy();}
}
function dToPlain(d){return {...d,positions:Array.from(d.positions),masses:Array.from(d.masses),...(d.pinned?{pinned:Array.from(d.pinned)}:{}),...(d.velocities?{velocities:Array.from(d.velocities)}:{})};}

export function evaluateProximal(records,p=proximalProtocol()){
  const issues=[],checks=[],require=(condition,message)=>{if(!condition)issues.push(message);};
  require(JSON.stringify(records.map(r=>r.spec))===JSON.stringify(p.cases),'Case matrix differs');
  for(const record of records){
    const {spec,definition:d,stats,samples}=record,t=p.thresholds,last=samples.at(-1),start=issues.length;
    require(stats.checkedTicks===spec.ticks,`${spec.id}: tick coverage`);require(samples.length===spec.samples+1,`${spec.id}: sample coverage`);
    require(samples.every(s=>s.backend===p.backend&&s.tensions.every(v=>Number.isFinite(v)&&v>=0)),`${spec.id}: backend/tension`);
    require(stats.maxImpulseDefect<=t.impulse,`${spec.id}: impulse balance`);
    const check={id:spec.id,...stats};
    if(spec.kind==='underconverged')require(stats.unconvergedSubsteps>0,`${spec.id}: missing failure to converge`);
    else{
      require(stats.unconvergedSubsteps===0,`${spec.id}: underconverged substeps`);
      require(stats.maxImplicitForceResidual<=d.config.forceTolerance&&stats.maxConstraintForceResidual<=d.config.forceTolerance,`${spec.id}: force tolerances`);
      require(stats.maxConstitutiveResidual<=d.config.residualTolerance,`${spec.id}: constitutive tolerance`);
      require(stats.maxIndependentForceResidual<=t.independentForce,`${spec.id}: independent force balance`);
    }
    if(spec.kind==='symmetric'){
      const reference=symmetricTrajectory(d,spec.ticks);check.positionError=Math.max(...samples.map(s=>Math.abs(-s.positions[4]-reference[s.tick].y)),...samples.map(s=>Math.abs(s.positions[3])));check.velocityError=Math.max(...samples.map(s=>Math.abs(-s.velocities[4]-reference[s.tick].v)));
      require(check.positionError<=t.scalarPosition&&check.velocityError<=t.scalarVelocity,`${spec.id}: nonlinear scalar trajectory`);
    }
    if(spec.kind==='span'){
      const expected=discreteSpanReference(d);check.shapeError=Math.max(...last.positions.map((v,j)=>Math.abs(v-expected.positions[j])));check.tensionError=Math.max(...last.tensions.map((v,j)=>Math.abs(v-expected.tensions[j])));
      check.reactionError=Math.abs(last.supportReactions[1]+last.supportReactions.at(-2)-expected.reaction);check.horizontalReactionError=Math.max(Math.abs(last.supportReactions[0]+expected.horizontal),Math.abs(last.supportReactions.at(-3)-expected.horizontal));
      check.sag=-last.positions[3*spec.segments/2+1];check.expectedSag=expected.sag;
      require(check.shapeError<=t.shape&&check.tensionError<=t.tension&&check.horizontalReactionError<=t.tension&&check.reactionError<=(spec.hard?t.hardReaction:t.reaction),`${spec.id}: static shape and support force`);
      if(!spec.hard)check.continuumSagError=Math.abs(check.sag-continuumSpanReference(spec.rigidity).sag);
    }
    if(spec.kind==='network')require(stats.maxEnergyDefect<=t.energyDefect,`${spec.id}: implicit energy inequality`);
    check.issues=issues.slice(start);checks.push(check);
  }
  const spatial=[];
  for(const rigidity of [500,1000,5000]){
    const errors=[8,16,32].map(n=>checks.find(c=>c.id===`span-${n}-${rigidity}-16`)?.continuumSagError),ratios=errors.slice(1).map((e,i)=>errors[i]/e);
    require(ratios.every(r=>r>=p.thresholds.spatialRatioMinimum&&r<=p.thresholds.spatialRatioMaximum),`EA ${rigidity}: catenary refinement`);spatial.push({rigidity,errors,ratios});
  }
  return {status:issues.length?'failed':'passed',issues,cases:records.length,samples:records.reduce((sum,r)=>sum+r.samples.length,0),checkedTicks:records.reduce((sum,r)=>sum+r.stats.checkedTicks,0),checks,spatial,scope:p.scope,speedupClaim:false};
}

export async function qualifyProximal(out){
  out=await reserveRunDirectory(out,[root]);const p=proximalProtocol(),source=await inventory(root,sourceFiles,1024*1024);await fs.mkdir(path.join(out,'source'));
  for(const e of source.files){const target=path.join(out,'source',e.path);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,e.path),target,fs.constants.COPYFILE_EXCL);assert.equal(await hashFile(target),e.sha256);}
  await writeJsonExclusive(path.join(out,'protocol.json'),p);await writeJsonExclusive(path.join(out,'manifest.json'),{schema:'box3d.proximal-cable-manifest/1',source,protocolSha256:hashValue(p),createdAt:new Date().toISOString(),runtime:{node:process.version,platform:process.platform,arch:process.arch}});
  const core=await import(pathToFileURL(path.join(out,'source/src/engine/compliant-cable.ts')).href),records=[];
  for(const spec of p.cases){const record=executeProximalCase(spec,core);records.push(record);await writeJsonExclusive(path.join(out,spec.id+'.json'),record);}
  assert.deepEqual(await inventory(root,sourceFiles,1024*1024),source,'Source changed during qualification');
  const result={schema:'box3d.proximal-cable-result/1',sourceSha256:source.sha256,protocolSha256:hashValue(p),records,gate:evaluateProximal(records,p)};await writeJsonExclusive(path.join(out,'result.json'),result);return result.gate;
}
export async function auditProximal(out){
  const report={schema:'box3d.proximal-cable-integrity/1',status:'failed',issues:[]};
  try{
    out=await fs.realpath(out);const read=async name=>{const target=path.join(out,name),stat=await fs.lstat(target);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=16*1024*1024);const bytes=await fs.readFile(target);assert.ok(bytes.length<=16*1024*1024);return JSON.parse(bytes.toString('utf8'));};
    const p=await read('protocol.json'),manifest=await read('manifest.json'),result=await read('result.json');assert.equal(manifest.schema,'box3d.proximal-cable-manifest/1');assert.equal(result.schema,'box3d.proximal-cable-result/1');assert.deepEqual(p,proximalProtocol());
    const source=await inventory(path.join(out,'source'),['.'],1024*1024);assert.deepEqual(source,manifest.source);assert.equal(result.sourceSha256,source.sha256);assert.equal(manifest.protocolSha256,hashValue(p));assert.equal(result.protocolSha256,hashValue(p));assert.deepEqual(result.records.map(r=>r.spec),p.cases);
    const core=await import(pathToFileURL(path.join(out,'source/src/engine/compliant-cable.ts')).href);
    for(const record of result.records){assert.deepEqual(await read(record.spec.id+'.json'),record);assert.deepEqual(executeProximalCase(record.spec,core),record,'Replay of full samples, every-tick checks, warm start and continuation differs');}
    const gate=evaluateProximal(result.records,p);assert.deepEqual(gate,result.gate);assert.equal(gate.status,'passed',gate.issues.join('\n'));
    Object.assign(report,{status:'passed',cases:gate.cases,samples:gate.samples,checkedTicks:gate.checkedTicks,sourceSha256:source.sha256,protocolSha256:hashValue(p),resultSha256:await hashFile(path.join(out,'result.json')),scope:p.scope,speedupClaim:false});
  }catch(error){report.issues.push(error.message);}
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=parseArgs(process.argv.slice(2),['--out','--check']);assert.ok(Boolean(args['--out'])!==Boolean(args['--check']),'Choose --out NEW_DIRECTORY or --check EXISTING_DIRECTORY');
  const result=args['--out']?await qualifyProximal(args['--out']):await auditProximal(args['--check']);console.log(JSON.stringify(result,null,2));process.exitCode=result.status==='passed'?0:1;
}
