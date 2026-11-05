import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const output=path.resolve(process.env.BOX3D_QA_OUTPUT||path.join(os.tmpdir(),'box3d-release-qa'));
fs.mkdirSync(output,{recursive:true});
const receipts=[];
function run(command,args,timeout=600000){
  console.log(`\n=== ${command} ${args.join(' ')} ===`);
  const start=performance.now();
  const result=spawnSync(command,args,{stdio:'inherit',timeout,env:{...process.env,BOX3D_QA_OUTPUT:output}});
  const receipt={command,args,elapsedMs:performance.now()-start,status:result.status,signal:result.signal,error:result.error?.message??null};receipts.push(receipt);
  fs.writeFileSync(path.join(output,'release-gates.json'),JSON.stringify({node:process.version,platform:process.platform,receipts},null,2));
  if(result.error||result.status!==0)throw new Error(`Release gate failed: ${command} ${args.join(' ')}`);
}
const npm=process.platform==='win32'?'npm.cmd':'npm';
const gate=name=>run(npm,['run',name]);
gate('verify:source');gate('typecheck');gate('bench:breakthrough:compile');
for(const file of ['unit','engineering-evidence','execution-graph','water-reference','water-surface-plan','projection-depth','instance-visibility'])run(process.execPath,[`.test-build/tests/${file}.test.js`]);
run(process.execPath,['scripts/self-test.mjs']);gate('test:cbridge');
// Test the shipped artifacts here. Rebuilding with a pinned clang is a separate release-toolchain gate.
run(process.execPath,['scripts/soft-kernel-test.mjs']);
run(process.execPath,['scripts/soft-kernel-integration-test.cjs']);
for(const name of ['test:webgpu','test:collision','test:assets','test:engine','test:studio','test:studio:presets','test:studio:river','test:studio:reference','test:studio:press','test:release-contracts','catalog:check','test:soft-soak:all','test:rope-batching','test:native-wasm','test:material:100','build','build:pages','stage:railway','test:browser:release'])gate(name);
run(npm,['audit','--audit-level=moderate']);gate('verify:source');
console.log(`All ${receipts.length} release gates passed. Receipts: ${output}`);
