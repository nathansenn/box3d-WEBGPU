#!/usr/bin/env node
import {readFile,writeFile} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {stripTypeScriptTypes} from 'node:module';
const commit='dfedd9fe9983200f492d686488d27b6a4b11c650',gitBlob='e75d39fa091f3b91665c967dcfe548a86d8a0352',expected='af5b3beac1f02f4e6d75e383270151c7679a473fac196b576ff59085c6e3b03f';
const sourceUrl='https://github.com/nathansenn/box3d-WEBGPU/blob/'+commit+'/src/webgpu/renderer.ts',rawUrl='https://raw.githubusercontent.com/nathansenn/box3d-WEBGPU/'+commit+'/src/webgpu/renderer.ts';
const directory=dirname(fileURLToPath(import.meta.url)),args=process.argv.slice(2),index=args.indexOf('--source');
let source;if(index>=0){if(!args[index+1])throw new Error('--source needs a path');source=await readFile(args[index+1]);}
else{const response=await fetch(rawUrl,{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Download HTTP '+response.status);source=Buffer.from(await response.arrayBuffer());}
const blobHash=b=>createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
let removedOnlyToolAppendedFinalLF=false;
if(blobHash(source)!==gitBlob&&source.at(-1)===10&&blobHash(source.subarray(0,source.length-1))===gitBlob){source=source.subarray(0,source.length-1);removedOnlyToolAppendedFinalLF=true;}
const sourceSha256=createHash('sha256').update(source).digest('hex');
if(blobHash(source)!==gitBlob||sourceSha256!==expected)throw new Error('Source does not match pinned renderer; nothing written.');
let compiled=stripTypeScriptTypes(source.toString('utf8'),{mode:'transform'});
const pattern=/(['"])\.\.\/assets\/ktx2\.js\1/g;if([...compiled.matchAll(pattern)].length!==1)throw new Error('Expected one runtime import');
compiled=compiled.replace(pattern,"'../../src/assets/ktx2.ts'");
const prefix='// Unmodified uploadSurface baseline from '+sourceUrl+'\n// Source Git blob '+gitBlob+'; source SHA-256 '+sourceSha256+'.\n// Node '+process.version+' TypeScript transform; only runtime asset import relocated.\n';
const fixture=prefix+compiled+'\n';
const provenance={source:sourceUrl,gitBlob,sourceSha256,sourceBytes:source.length,removedOnlyToolAppendedFinalLF,transform:'node '+process.version+' stripTypeScriptTypes(mode=transform)',runtimeImportRelocation:'../assets/ktx2.js → ../../src/assets/ktx2.ts',fixtureSha256:createHash('sha256').update(fixture).digest('hex')};
await writeFile(join(directory,'baseline-renderer.mjs'),fixture);await writeFile(join(directory,'baseline-renderer-provenance.json'),JSON.stringify(provenance,null,2)+'\n');console.log(JSON.stringify(provenance,null,2));

