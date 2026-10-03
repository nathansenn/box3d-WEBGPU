import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';

const sha=value=>createHash('sha256').update(value).digest('hex');
const script=fileURLToPath(new URL('../../scripts/update-threaded-provenance.mjs',import.meta.url));
const env={...process.env,B3W_EMSCRIPTEN_VERSION:'0.0.0-test'};
const defaultRecord=()=>({
  bridge:{source:'wasm/box3d_web.c',sha256:sha('bridge'),deterministicDoubleBuild:true},
  artifacts:{'box3d.js':{bytes:9,sha256:sha('box3d.js')},'box3d.wasm':{bytes:11,sha256:sha('box3d.wasm')}},
  validation:{status:'pass',catalogScenes:800,evidence:['historical-receipt.json']},
});
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'box3d-threaded-provenance-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const artifacts=path.join(root,'public/box3d');await fs.mkdir(artifacts,{recursive:true});await fs.mkdir(path.join(root,'wasm'));
  for(const file of ['wasm/box3d_web.c','wasm/box3d_threads.c','wasm/CMakeLists.txt','public/box3d/box3d-mt.js','public/box3d/box3d-mt.wasm'])await fs.writeFile(path.join(root,file),file);
  const manifest=path.join(artifacts,'BUILD_PROVENANCE.json');
  const write=record=>fs.writeFile(manifest,JSON.stringify(record));
  const read=()=>JSON.parse(readFileSync(manifest,'utf8'));
  await write(defaultRecord());
  const run=()=>{const out=execFileSync(process.execPath,[script,root,artifacts],{env,encoding:'utf8'});return {record:read(),out};};
  return {root,artifacts,manifest,write,read,run};
}
const qualification={status:'pass',comparisons:3322,mismatches:0,evidence:['threaded-determinism.json']};

test('a first threaded record identifies the exact sources and artifacts and starts unqualified',async t=>{
  const f=await fixture(t);const {record}=f.run();const threaded=record.threaded;
  assert.equal(threaded.sources.threadsSha256,sha('wasm/box3d_threads.c'));
  assert.equal(threaded.sources.bridgeSha256,sha('wasm/box3d_web.c'));
  assert.equal(threaded.sources.cmakeSha256,sha('wasm/CMakeLists.txt'));
  for(const name of ['box3d-mt.js','box3d-mt.wasm'])assert.deepEqual(threaded.artifacts[name],{bytes:`public/box3d/${name}`.length,sha256:sha(`public/box3d/${name}`)});
  assert.equal(threaded.build.pthreads,true);assert.equal(threaded.build.emscripten,'0.0.0-test');
  assert.equal(threaded.validation.status,'not_run');assert.match(threaded.validation.reason,/test:threaded/);
});

test('the single-threaded artifact record is never touched',async t=>{
  const f=await fixture(t);const {record}=f.run();
  assert.deepEqual({bridge:record.bridge,artifacts:record.artifacts,validation:record.validation},defaultRecord());
});

test('an exact threaded rebuild retains the qualification attached to those exact hashes',async t=>{
  const f=await fixture(t);const first=f.run().record;
  await f.write({...first,threaded:{...first.threaded,note:'kept',validation:qualification}});
  const {record,out}=f.run();
  assert.deepEqual(record.threaded.validation,qualification);assert.equal(record.threaded.note,'kept');
  assert.match(out,/unchanged; validation pass/);
});

test('changed threaded source or artifacts invalidate prior qualification instead of relabelling it',async t=>{
  for(const changed of ['wasm/box3d_threads.c','wasm/box3d_web.c','wasm/CMakeLists.txt','public/box3d/box3d-mt.js','public/box3d/box3d-mt.wasm']){
    const f=await fixture(t);const first=f.run().record;
    await f.write({...first,threaded:{...first.threaded,validation:qualification}});
    await fs.appendFile(path.join(f.root,changed),'changed');
    const {record,out}=f.run();
    assert.equal(record.threaded.validation.status,'not_run',changed);
    assert.equal(record.threaded.validation.comparisons,undefined,changed);assert.equal(record.threaded.validation.evidence,undefined,changed);
    assert.match(record.threaded.validation.reason,/changed/,changed);assert.match(out,/updated; validation not_run/,changed);
    if(changed.startsWith('wasm/'))assert.notDeepEqual(record.threaded.sources,first.threaded.sources,changed);
    else assert.notDeepEqual(record.threaded.artifacts,first.threaded.artifacts,changed);
    assert.deepEqual({bridge:record.bridge,artifacts:record.artifacts,validation:record.validation},defaultRecord(),changed);
  }
});

test('a missing threaded artifact or manifest is refused with the command that fixes it',async t=>{
  const f=await fixture(t);await fs.rm(path.join(f.artifacts,'box3d-mt.wasm'));
  assert.throws(()=>execFileSync(process.execPath,[script,f.root,f.artifacts],{env,stdio:'pipe'}),error=>/build:wasm:mt/.test(String(error.stderr)));
  const g=await fixture(t);await fs.rm(g.manifest);
  assert.throws(()=>execFileSync(process.execPath,[script,g.root,g.artifacts],{env,stdio:'pipe'}),error=>/build:wasm/.test(String(error.stderr)));
});
