import assert from 'node:assert/strict';
import test from 'node:test';
import {readdirSync,readFileSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {parseKtx2} from '../../src/assets/ktx2.ts';

const ID=[0xAB,0x4B,0x54,0x58,0x20,0x32,0x30,0xBB,0x0D,0x0A,0x1A,0x0A];
function make({depth=0,layers=0,faces=1}={}){
  const b=new Uint8Array(256),v=new DataView(b.buffer);
  b.set(ID,0);v.setUint32(12,37,true);v.setUint32(20,4,true);v.setUint32(24,4,true);
  v.setUint32(28,depth,true);v.setUint32(32,layers,true);v.setUint32(36,faces,true);v.setUint32(40,1,true);v.setUint32(44,0,true);
  v.setBigUint64(80,160n,true);v.setBigUint64(88,16n,true);
  return b;
}
const walk=d=>readdirSync(d).flatMap(n=>{const p=join(d,n);return statSync(p).isDirectory()?walk(p):p.endsWith('.ktx2')?[p]:[]});
test('rejects cube, array and 3D textures',()=>{
  for(const opt of [{faces:6},{layers:2},{depth:4}])assert.throws(()=>parseKtx2(make(opt)),/Unsupported KTX2 layout/);
});
test('single 2D header with faces=1 is not rejected by the layout check',()=>{
  try{parseKtx2(make());}catch(e){assert.doesNotMatch(String(e.message),/Unsupported KTX2 layout/);}
});
test('every shipped .ktx2 asset still parses',()=>{
  const files=walk('public');
  for(const f of files)assert.ok(parseKtx2(readFileSync(f)).levels.length>0,f);
  console.log('shipped ktx2 files parsed:',files.length);
});
