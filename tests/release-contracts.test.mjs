import fs from 'node:fs';
import assert from 'node:assert/strict';
import test from 'node:test';
const read=p=>fs.readFileSync(p,'utf8');
test('Studio remains the default and Lab has its own complete shell',()=>{
  assert.match(read('index.html'),/src\/entry\.ts/);assert.match(read('lab.html'),/src\/lab-entry\.ts/);
  assert.match(read('src/lab-entry.ts'),/import ['"]\.\/main['"]/);
  assert.match(read('lab.html'),/id="app"/);assert.match(read('lab.html'),/id="engineering-workspaces-mount"/);
  assert.match(read('lab.html'),/data-app-switch="studio"/);assert.match(read('src/studio/study-navigation.ts'),/data-app-switch/);
  assert.match(read('vite.config.ts'),/new URL\('\.\/lab\.html'/);
});
test('production native artifact packaging and isolation are explicit',()=>{
  const docker=read('deploy/railway/Dockerfile'),caddy=read('deploy/railway/Caddyfile');
  for(const name of ['box3d','textures','lab.html','soft-kernels-simd.wasm','soft-kernels-scalar.wasm'])assert.ok(docker.includes(name),name);
  assert.match(caddy,/Cross-Origin-Opener-Policy same-origin/);assert.match(caddy,/Cross-Origin-Embedder-Policy require-corp/);
});
test('CI and Pages invoke the same release gate',()=>{
  for(const p of ['.github/workflows/ci.yml','.github/workflows/pages.yml'])assert.match(read(p),/npm run validate:release/);
  const gate=read('scripts/validate-release.mjs');
  for(const name of ['test:engine','test:studio','test:studio:presets','test:studio:river','test:studio:reference','test:studio:press','test:browser:release'])assert.ok(gate.includes(`'${name}'`),name);
});
