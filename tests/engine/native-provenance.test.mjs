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
const script=fileURLToPath(new URL('../../scripts/update-build-provenance.mjs',import.meta.url));
async function fixture(t){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'box3d-native-provenance-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const artifacts=path.join(root,'public/box3d');await fs.mkdir(artifacts,{recursive:true});await fs.mkdir(path.join(root,'wasm'));
  await fs.writeFile(path.join(root,'wasm/box3d_web.c'),'bridge');
  const provenance={bridge:{source:'wasm/box3d_web.c',sha256:sha('bridge'),deterministicDoubleBuild:true},
    artifacts:{},validation:{catalogScenes:800,independentWorlds:16,evidence:['historical-receipt.json']}};
  for(const name of ['box3d.js','box3d.wasm']){await fs.writeFile(path.join(artifacts,name),name);provenance.artifacts[name]={bytes:name.length,sha256:sha(name)};}
  const manifest=path.join(artifacts,'BUILD_PROVENANCE.json');await fs.writeFile(manifest,JSON.stringify(provenance));
  return {root,artifacts,provenance,run:()=>{execFileSync(process.execPath,[script,root,artifacts]);return JSON.parse(readFileSync(manifest));}};
}

test('an exact native rebuild retains the qualification attached to those exact hashes',async t=>{
  const f=await fixture(t);assert.deepEqual(f.run(),f.provenance);
});
test('changed native source or artifacts invalidate prior qualification instead of relabelling it',async t=>{
  for(const changed of ['wasm/box3d_web.c','public/box3d/box3d.wasm','public/box3d/box3d.js']){
    const f=await fixture(t);await fs.appendFile(path.join(f.root,changed),'changed');const updated=f.run();
    assert.equal(updated.bridge.deterministicDoubleBuild,false);assert.equal(updated.validation.status,'not_run');
    assert.equal(updated.validation.catalogScenes,undefined);assert.equal(updated.validation.evidence,undefined);
    if(changed.startsWith('wasm/'))assert.notEqual(updated.bridge.sha256,f.provenance.bridge.sha256);
    else assert.notDeepEqual(updated.artifacts,f.provenance.artifacts);
  }
});
