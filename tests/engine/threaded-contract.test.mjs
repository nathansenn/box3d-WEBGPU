import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync} from 'node:fs';

// Source-level contract of the pthread build (docs/THREADED_ENGINE.md). Nothing here runs the engine: the
// determinism of the artifact is scripts/threaded-determinism-test.mjs, its identity is checked below.
const path=file=>new URL(`../../${file}`,import.meta.url);
const read=file=>readFileSync(path(file),'utf8');
const bytes=file=>readFileSync(path(file));
const sha=file=>createHash('sha256').update(bytes(file)).digest('hex');
const provenance=JSON.parse(read('public/box3d/BUILD_PROVENANCE.json'));
const EXPORTS=['b3w_threads_supported','b3w_worker_capacity','b3w_get_worker_count','b3w_set_worker_count','b3w_last_step_workers','b3w_get_thread_threshold','b3w_set_thread_threshold'];

test('the threading ABI is defined in box3d_threads.c and exported by the threaded artifact only',()=>{
  const threads=read('wasm/box3d_threads.c'),cmake=read('wasm/CMakeLists.txt'),mt=read('public/box3d/box3d-mt.js'),single=read('public/box3d/box3d.js');
  for(const name of EXPORTS){
    assert.match(threads,new RegExp(`\\b${name}\\s*\\(`),`box3d_threads.c must define ${name}`);
    assert.ok(cmake.includes(`'_${name}'`),`CMakeLists.txt must export _${name} for the threaded build`);
    assert.ok(mt.includes(`_${name}`),`box3d-mt.js must export _${name}`);
    assert.ok(!single.includes(name),`the single-threaded artifact must not carry ${name}`);
  }
});

test('the bridge is unchanged: threading reaches it only through the per-source rename of two world calls',()=>{
  const bridge=read('wasm/box3d_web.c'),cmake=read('wasm/CMakeLists.txt'),threads=read('wasm/box3d_threads.c');
  assert.ok(cmake.includes('b3CreateWorld=b3w_threads_create_world;b3World_Step=b3w_threads_step'));
  assert.match(threads,/\bb3w_threads_create_world\s*\(/);assert.match(threads,/\bb3w_threads_step\s*\(/);
  assert.ok(!bridge.includes('b3w_threads_'),'box3d_web.c must not reference the wrappers: the qualified bridge stays as it is');
  assert.ok(!bridge.includes('b3World_SetWorkerCount'),'box3d_web.c must not choose worker counts itself');
  assert.match(threads,/#error[^\n]*DOUBLE_PRECISION/,'the wrappers are single precision only');
});

test('the shipped threaded artifacts are the recorded builds of the current sources',()=>{
  const threaded=provenance.threaded;assert.ok(threaded,'BUILD_PROVENANCE.json has no threaded record: run npm run build:wasm:mt');
  const stale=[];
  for(const [key,file] of [['threadsSha256','wasm/box3d_threads.c'],['bridgeSha256','wasm/box3d_web.c'],['cmakeSha256','wasm/CMakeLists.txt']]){
    if(threaded.sources?.[key]!==sha(file))stale.push(`${file} changed since the threaded artifact was built`);
  }
  for(const name of ['box3d-mt.js','box3d-mt.wasm']){
    const record=threaded.artifacts?.[name],file=`public/box3d/${name}`;
    if(!record||record.bytes!==bytes(file).byteLength||record.sha256!==sha(file))stale.push(`${name} does not match BUILD_PROVENANCE.json`);
  }
  assert.deepEqual(stale,[],'run npm run build:wasm:mt, then npm run test:threaded -- --out=<evidence.json> --record');
  assert.equal(threaded.build.pthreads,true);assert.equal(provenance.build.pthreads,false,'the default artifact stays single-threaded');
});

test('a recorded threaded validation cites evidence that exists and claims no speed',()=>{
  const validation=provenance.threaded.validation;
  assert.ok(['pass','not_run'].includes(validation.status),`unexpected threaded validation status ${validation.status}`);
  if(validation.status!=='pass')return;
  assert.ok(validation.evidence?.length>0);
  for(const file of validation.evidence)assert.ok(existsSync(path(file)),`${file} is cited as evidence but is missing`);
  assert.equal(validation.mismatches,undefined);assert.ok(validation.exactComparisons>0);
  assert.match(validation.scope,/No speedup/);
});

test('the loader plans threads from the page capability and keeps the single-threaded fallback',()=>{
  const loader=read('src/physics/wasm.ts');
  assert.match(loader,/from '\.\/threading'/);assert.match(loader,/planThreading\(/);
  assert.ok(loader.includes("'box3d-mt'"));assert.ok(loader.includes('the pthread artifact did not start'),'a failed pthread start must fall back visibly');
  assert.match(loader,/accepted\s*=\s*mod\._b3w_set_worker_count\(workers\)/);assert.match(loader,/accepted\s*!==\s*workers/,'the loader must confirm the workers it asked for were granted');
});

test('the dev and preview servers isolate the page for shared memory and stay on 127.0.0.1',()=>{
  const vite=read('vite.config.ts'),scripts=JSON.parse(read('package.json')).scripts;
  assert.match(vite,/'Cross-Origin-Opener-Policy':\s*'same-origin'/);assert.match(vite,/'Cross-Origin-Embedder-Policy':\s*'require-corp'/);
  assert.match(vite,/server:\s*{[^}]*headers:\s*crossOriginIsolation/s);assert.match(vite,/preview:\s*{[^}]*headers:\s*crossOriginIsolation/s);
  assert.ok(!vite.includes('0.0.0.0'));
  for(const name of ['dev','preview'])assert.match(scripts[name],/--host 127\.0\.0\.1/,`npm run ${name} must bind 127.0.0.1`);
  for(const [name,command] of Object.entries(scripts)){
    assert.ok(!command.includes('0.0.0.0'),`${name} must not bind all interfaces`);
    // A bare --host, --host :: or --hostname 0 and python's http.server without --bind all listen on every interface.
    for(const [,value] of command.matchAll(/--(?:hostname|host|bind)(?:[ =]+([^\s&|;]+))?/g))assert.match(value??'',/^(?:127\.0\.0\.1|localhost|::1)$/,`${name} must bind 127.0.0.1, not ${value??'the bind-all default'}`);
    if(command.includes('http.server'))assert.match(command,/--bind[ =]127\.0\.0\.1/,`${name} must pass --bind 127.0.0.1 to http.server`);
  }
});

test('the threaded build, test and benchmark commands exist and point at real files',()=>{
  const scripts=JSON.parse(read('package.json')).scripts;
  assert.equal(scripts['build:wasm:mt'],'bash ./scripts/build-wasm-threaded.sh');
  assert.equal(scripts['test:threaded'],'node scripts/threaded-determinism-test.mjs');
  assert.equal(scripts['bench:threaded'],'node scripts/threaded-benchmark.mjs');
  for(const file of ['scripts/build-wasm-threaded.sh','scripts/threaded-determinism-test.mjs','scripts/threaded-benchmark.mjs','scripts/supervise-child.mjs','scripts/update-threaded-provenance.mjs','src/physics/threading.ts','docs/THREADED_ENGINE.md']){
    assert.ok(existsSync(path(file)),`${file} is missing`);
  }
  assert.ok(scripts.clean.includes('build/box3d-wasm-mt'),'npm run clean must remove the threaded build directory');
  assert.ok(!scripts.test.includes('test:threaded'),'the slow determinism run is opt-in, not part of npm test');
});

test('every reference to the threaded design document resolves',()=>{
  for(const file of ['wasm/box3d_threads.c','wasm/CMakeLists.txt','scripts/threaded-determinism-test.mjs','scripts/threaded-benchmark.mjs','scripts/supervise-child.mjs','src/physics/threading.ts','src/physics/wasm.ts']){
    if(read(file).includes('docs/THREADED_ENGINE.md'))assert.ok(existsSync(path('docs/THREADED_ENGINE.md')),`${file} cites docs/THREADED_ENGINE.md`);
  }
});
