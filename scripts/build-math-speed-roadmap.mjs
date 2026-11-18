import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';

const root=resolve(fileURLToPath(new URL('..',import.meta.url)));
const here=resolve(root,'benchmarks/experiments/math-speed-audit-20260911');
const read=p=>JSON.parse(readFileSync(resolve(here,p)));
const profile=read('profile-summary.json');
const source={
  solver:['src/studio/physics.ts',322],strain:['src/studio/physics.ts',369],
  construction:['src/studio/physics.ts',256],contact:['src/studio/physics.ts',428],
  ram:['src/studio/physics.ts',411],tools:['src/studio/press-settings.ts',62],
  material:['src/studio/press-settings.ts',4],surface:['src/studio/surface-topology.ts',50],
  topology:['src/studio/surface-topology.ts',17],shell:['src/studio/press-tooling.ts',35],
  geometry:['src/studio/world.ts',727],scheduler:['src/studio/main.ts',420],
  runtime:['src/engine/studio-runtime.ts',144],transport:['src/engine/studio-client.ts',1],
  storage:['src/studio/packed-physics.ts',1],checks:['tests/studio/press-lab.test.mjs',13]
};
// Keep the current code links useful as the implementation grows. The audit
// profile and source hash remain frozen independently of these navigation links.
for(const [key,anchor] of Object.entries({
  solver:'  step(dt = FIXED_DT): void {',strain:'        const elastic=Math.max',
  construction:'  private buildSurface(): void {',contact:'  private collide(',
  ram:'  private advanceRam(',runtime:'  step(request: StudioStepRequest)',
  scheduler:'  function animate(now:number):void {'
})){
  const text=readFileSync(resolve(root,source[key][0]),'utf8'),offset=text.indexOf(anchor);
  assert.ok(offset>=0,'Missing source anchor '+key);
  source[key][1]=text.slice(0,offset).split('\n').length;
}
const groups=['Remove repeated work in the current solver','Accelerate and improve punch queries','Make units and time integration consistent','Improve convergence and solver structure','Represent sheet and shell mechanics','Improve plasticity and fracture','Prevent missed and nonphysical contact','Scale numerical computation','Reduce geometry and presentation math','Prove accuracy and speed together'];
const rows=readFileSync(resolve(here,'roadmap.tsv'),'utf8').trim().split('\n').map((line,index)=>{
  const fields=line.split('|');assert.equal(fields.length,5,line);const [priority,kind,basis,proposal,acceptance]=fields;assert.ok(source[basis],basis);
  return {id:'M'+String(index+1).padStart(3,'0'),group:groups[Math.floor(index/10)],priority,kind,proposal,acceptance,source:{path:source[basis][0],line:source[basis][1]},status:'proposed'};
});
assert.equal(rows.length,100);assert.equal(new Set(rows.map(r=>r.proposal)).size,100);
let completion='M001 is being checked against the frozen solver; the remaining entries are proposals.';
if(existsSync(resolve(here,'strain-comparison.json'))){
  const comparison=read('strain-comparison.json');assert.ok(comparison.exact);rows[0].status='implemented; exact comparison passed';
  completion=`M001 is implemented and matches ${comparison.matchedSamples} complete checkpoint samples across ${comparison.results.length} ten-second scenarios, with mid-run restore and unloading. It has not yet established a controlled speedup. The remaining entries are proposals.`;
}
if(existsSync(resolve(here,'strain-timing/result.json'))){
  const timing=read('strain-timing/result.json');
  if(timing.accepted){rows[0].status='implemented; bounded CPU timing passed';completion=completion.replace('It has not yet established a controlled speedup.',`Its controlled CPU comparison passes for the recorded workload; see the timing receipt. This does not establish a whole-engine or GPU/frame-rate gain.`);}
  else{rows[0].status='candidate rejected; original code restored';completion='The simple M001 candidate preserves all 230 sampled checkpoints across 23 ten-second scenarios, including restore and unloading, but fails the Metal press timing gate. Its plate median-time ratio is 0.991x (95% interval 0.980–1.003x); its p95 ratio is 0.874x (0.748–1.020x). These statistics use 15-tick block means, not individual steps or rendered frames. All unchanged controls pass. The original source has been restored and no production math change from this audit remains. The failed candidate and raw measurements are retained; other entries are proposals.';}
}
const outcomePath=resolve(root,'docs/MATH_SPEED_OUTCOMES.json');
const outcomes=existsSync(outcomePath)?JSON.parse(readFileSync(outcomePath,'utf8')):undefined;
if(outcomes){
  assert.equal(outcomes.auditSourceHash,profile.sourceHash);
  assert.equal(typeof outcomes.summary,'string');
  for(const [id,update] of Object.entries(outcomes.items)){
    const row=rows.find(r=>r.id===id);assert.ok(row,'Unknown roadmap item '+id);
    assert.equal(typeof update.status,'string');assert.ok(Array.isArray(update.evidence));
    Object.assign(row,{status:update.status,evidence:update.evidence});
    if(id==='M009'&&update.status.startsWith('implemented'))row.source={path:'src/studio/norm3.ts',line:6};
    if(update.source){
      const text=readFileSync(resolve(root,update.source.path),'utf8'),offset=text.indexOf(update.source.anchor);
      assert.ok(offset>=0,'Missing implementation anchor '+id);
      row.source={path:update.source.path,line:text.slice(0,offset).split('\n').length};
    }
  }
  completion=outcomes.summary;
}
const counts={};for(const r of rows)counts[r.kind]=(counts[r.kind]??0)+1;
const priorities=[9,3,11,87,8,21,22,31,64,93].map(n=>'M'+String(n).padStart(3,'0'));
const metadata={schema:'box3d.math-speed-roadmap/1',at:new Date().toISOString(),scope:'Metal press and its shared Studio runtime; extends the original 100-item engine roadmap without replacing it.',auditSourceHash:profile.sourceHash,count:100,counts,implementationUpdate:outcomes,firstReviewOrder:priorities,profile:{nodes:profile.nodes,links:profile.links,ticks:profile.profiledTicks,elapsedMs:profile.elapsedMs,performanceQualified:false},items:rows};
writeFileSync(resolve(root,'docs/MATH_SPEED_100.json'),JSON.stringify(metadata,null,2)+'\n');
const quote=s=>'"'+String(s).replaceAll('"','""')+'"';
writeFileSync(resolve(root,'docs/MATH_SPEED_100.csv'),[['ID','Group','Priority','Kind','Proposal','Acceptance','Source','Line','Status'],...rows.map(r=>[r.id,r.group,r.priority,r.kind,r.proposal,r.acceptance,r.source.path,r.source.line,r.status])].map(r=>r.map(quote).join(',')).join('\n')+'\n');
const methods={
  3:'A compliant solver is a candidate for reducing iteration-dependent stiffness. The proposed implementation and its speed remain to be tested here. [XPBD paper](https://mmacklin.com/xpbd.pdf), [Small Steps](https://mmacklin.com/smallsteps.pdf), [Projective Dynamics](https://users.cs.utah.edu/~ladislav/bouaziz14projective/bouaziz14projective.html). Matrix-free CG is conditional on an appropriate operator and preconditioner; see [PETSc CG requirements](https://petsc.org/main/manualpages/KSP/KSPCG/).',
  4:'Shell-energy alternatives are informed by [Discrete Shells](https://multires.caltech.edu/pubs/ds.pdf). Their applicability to this press and their implementation details are engineering proposals, not results established by that paper.',
  5:'A reference for local plastic stress integration is the [MOOSE radial-return implementation](https://mooseframework.inl.gov/malamute/source/materials/ADRadialReturnStressUpdate.html). Material fitting and the additional cyclic/anisotropic proposals require separate data and validation.',
  6:'The optional variational contact reference is informed by [Incremental Potential Contact](https://ipc-sim.github.io/). Its published guarantees do not automatically apply to this existing PBD solver.'
};
let md=`# 100 ways to improve the math and speed of Metal press\n\n`+
  `Audited 11 September 2026. This is a focused addition to the [original engine roadmap](${root}/docs/ENGINE_100X_ROADMAP.md), whose 100 items and status remain intact. The scope follows the currently open Metal press study and the runtime it shares with canopy and bridge.\n\n`+
  `${completion} See the [norm experiment report](${root}/docs/STUDIO_NORM3.md) and [press contact qualification](${root}/docs/PRESS_CONTACT.md). The [first trial comparison](${here}/strain-comparison.json), [timing](${here}/strain-timing/result.json) and [restoration](${here}/restoration.json) remain historical evidence.\n\n`+
  `The audit Node profile used the baseline 2 mm mild-steel, flat-punch setup: **957 nodes, 5,434 links, 12 constraint passes and 13 contact passes per tick**. After a separate 240-tick warm-up, 1,200 profiled ticks took **${profile.elapsedMs.toFixed(1)} ms**. About **82.5%** of sampled time was in the constraint step and **11.8%** in contact/tool evaluation. This diagnostic includes profiler and checkpoint-sampling overhead; it is one run, and does not measure browser FPS or establish a speedup. [Frozen profile and source identity](${here}/profile-summary.json).\n\n`+
  `The current code already has worker execution, backpressure, reusable snapshots, interpolation, topology caching and active-constraint compaction. The earlier packed solver failed its CPU gate and remains experimental. These entries extend those foundations rather than count them again as new wins.\n\n`+
  `**Priority:** P0 removes an observed cost or establishes essential correctness; P1 is the next substantial wave; P2 is conditional research or a workload-dependent optimization. **Kind:** exact = preserve physical arithmetic and outputs; numerical = qualify a changed solver or physical model; presentation = preserve a declared visual error bound; qualification = establish a measurement or acceptance gate. New physics may cost more CPU. Solver alternatives require comparison. The ratios from separate optimizations must not be multiplied into an engine-wide claim.\n\n`+
  `Start with **${priorities.join(', ')}**. The recorded priority order begins with the dominant norm calculation, repeated contact work and redundant geometry updates; consult each item's current status before starting a trial. Physical units/masses, compliant constraints and correct tool normals form the main mathematical upgrade.\n\n`;
for(let g=0;g<10;g++){
  md+=`## ${g*10+1}–${g*10+10}: ${groups[g]}\n\n`;
  if(methods[g])md+=methods[g]+'\n\n';
  md+='| ID | Priority / kind | Concrete improvement | Acceptance check | Code | Status |\n| --- | --- | --- | --- | --- | --- |\n';
  for(const r of rows.slice(g*10,g*10+10))md+=`| ${r.id} | ${r.priority} / ${r.kind} | ${r.proposal} | ${r.acceptance} | [source](${root}/${r.source.path}:${r.source.line}) | ${r.status} |\n`;
  md+='\n';
}
md+=`Every performance candidate needs an unchanged control, balanced run order, fixed physical workload and predeclared accuracy/p95 gates. Numerical redesigns require a separately identified backend, physical reference tests and complete checkpoint semantics. Existing passing glass and native-engine evidence remains separate from this press audit.\n\n`+
  `Machine-readable copies: [JSON](${root}/docs/MATH_SPEED_100.json) and [CSV](${root}/docs/MATH_SPEED_100.csv). The frozen audit source is identified by \`${profile.sourceHash}\`. Current source may move as individual entries are implemented; the recorded audit remains the baseline.\n`;
writeFileSync(resolve(root,'docs/MATH_SPEED_100.md'),md);
console.log(JSON.stringify({items:rows.length,counts,firstReviewOrder:priorities,markdown:resolve(root,'docs/MATH_SPEED_100.md')}));
