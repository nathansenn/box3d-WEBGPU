'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const archive = path.join(root, 'benchmarks/baselines/box3d-webgpu-v1.8.0-source.tar.gz');
function run(command,args,options={}){const result=spawnSync(command,args,{stdio:'inherit',...options});if(result.status!==0)throw new Error(`${command} ${args.join(' ')} failed`);}
function baselineRoot(){if(process.env.V19_BASELINE_ROOT)return path.resolve(process.env.V19_BASELINE_ROOT);if(!fs.existsSync(archive))throw new Error(`missing ${archive}`);const target=path.join(os.tmpdir(),`box3d-v19-tournament-${process.pid}`);fs.rmSync(target,{recursive:true,force:true});fs.mkdirSync(target,{recursive:true});run('tar',['-xzf',archive,'-C',target,'--strip-components=1']);fs.rmSync(path.join(target,'node_modules'),{recursive:true,force:true});fs.symlinkSync(path.join(root,'node_modules'),path.join(target,'node_modules'),process.platform==='win32'?'junction':'dir');run(path.join(root,'node_modules/.bin/tsc'),['-p',path.join(target,'tsconfig.test.json')],{cwd:target});fs.mkdirSync(path.join(target,'.test-build'),{recursive:true});fs.writeFileSync(path.join(target,'.test-build/package.json'),'{"type":"commonjs"}');return target;}
const baseline=baselineRoot();
const env={...process.env,V19_BASELINE_ROOT:baseline,FIFTH_SAMPLES:process.env.FIFTH_SAMPLES||'5',FIFTH_SCALE:process.env.FIFTH_SCALE||'0.22'};
for(const [start,end] of [[1,25],[26,50],[51,75],[76,100]]){
  console.log(`\n=== v1.9 experiment shard ${start}-${end} ===`);
  run(process.execPath,['--expose-gc',path.join(root,'benchmarks/breakthrough-fifth-100.cjs')],{cwd:root,env:{...env,FIFTH_START:String(start),FIFTH_END:String(end)}});
}
run(process.execPath,[path.join(root,'benchmarks/merge-v19-shards.cjs')],{cwd:root,env});
