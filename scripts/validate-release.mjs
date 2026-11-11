// Release gates for the Studio and the Physics Lab.
//   node scripts/validate-release.mjs pr       the required check on every pull request (npm run validate:pr)
//   node scripts/validate-release.mjs studio   the long Studio suites, run on main and before releases
//   node scripts/validate-release.mjs release  everything above plus the engine suite and browser acceptance
// CI runs the engine suite and browser acceptance as separate jobs that report without blocking until
// their known failures are fixed; `release` requires them, so a release can't skip them.
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const mode=process.argv[2]??'pr';
if(!['pr','studio','release'].includes(mode))throw new Error(`Unknown gate "${mode}": use pr, studio or release`);
const output=path.resolve(process.env.BOX3D_QA_OUTPUT||path.join(os.tmpdir(),'box3d-release-qa'));
fs.mkdirSync(output,{recursive:true});
const receipts=[];
function run(command,args,timeout=1800000){
  console.log(`\n=== ${command} ${args.join(' ')} ===`);
  const start=performance.now();
  const result=spawnSync(command,args,{stdio:'inherit',timeout,env:{...process.env,BOX3D_QA_OUTPUT:output}});
  receipts.push({command,args,elapsedMs:performance.now()-start,status:result.status,signal:result.signal,error:result.error?.message??null});
  fs.writeFileSync(path.join(output,`release-gates-${mode}.json`),JSON.stringify({mode,node:process.version,platform:process.platform,receipts},null,2));
  if(result.error||result.status!==0)throw new Error(`Release gate failed: ${command} ${args.join(' ')}`);
}
const npm=process.platform==='win32'?'npm.cmd':'npm';
const gate=name=>run(npm,['run',name]);

function pullRequestGate(){
  gate('typecheck');gate('bench:breakthrough:compile');
  for(const file of ['unit','sparse-upload','dirty-record-tracker','engineering-evidence','execution-graph','water-reference','water-surface-plan','projection-depth','instance-visibility'])run(process.execPath,[`.test-build/tests/${file}.test.js`]);
  run(process.execPath,['--test','tests/round4-statistics.test.mjs']);
  run('python3',['tests/round5-worker.test.py']);
  run(process.execPath,['scripts/self-test.mjs']);gate('test:cbridge');
  // Test the shipped artifacts here. Rebuilding with a pinned clang is a separate release-toolchain gate.
  run(process.execPath,['scripts/soft-kernel-test.mjs']);
  run(process.execPath,['scripts/soft-kernel-integration-test.cjs']);
  for(const name of ['test:webgpu','test:collision','test:assets','test:qualification','test:threaded','test:release-contracts','catalog:check','test:soft-soak:all','test:rope-batching','test:native-wasm','test:kit','test:material:100','build','build:pages','stage:railway'])gate(name);
  run(npm,['audit','--audit-level=moderate']);
}
// test:kit covers the embeddable kit, including its closed-form physics validation. The kit's
// upstream-suites file is left to the engine gate: it needs the baseline archives that the
// engine suite needs.
function studioGate(){
  for(const name of ['test:studio','test:studio:presets','test:studio:river','test:studio:reference','test:studio:press','test:studio:bridge','test:studio:liquid','test:studio:materials'])gate(name);
}
function reportedGates(){
  gate('test:engine');gate('test:browser:release');
}

gate('verify:source');
if(mode==='pr')pullRequestGate();
else if(mode==='studio')studioGate();
else{pullRequestGate();studioGate();reportedGates();}
gate('verify:source');
console.log(`All ${receipts.length} ${mode} gates passed. Receipts: ${output}`);
