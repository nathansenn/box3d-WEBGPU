// One-off, branch-scoped migration for the owner's approved November 5 review.
// Never changes numerical solvers, native artifacts, or the production branch.
import fs from 'node:fs';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
const branch='apex/restore-lab-release-gates-20261105';
assert.equal(process.env.GITHUB_REF,`refs/heads/${branch}`);
const read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>fs.writeFileSync(p,s);
const patch=(p,from,to)=>{const s=read(p);if(s.includes(to))return;assert.ok(s.includes(from),`Expected source guard missing in ${p}`);write(p,s.replace(from,to));};
if(!fs.existsSync('lab.html')){
  const response=await fetch('https://raw.githubusercontent.com/nathansenn/box3d-WEBGPU/dfedd9f/index.html');
  assert.ok(response.ok,'Could not recover historical Lab HTML');
  let html=await response.text();
  const blob=crypto.createHash('sha1').update(`blob ${Buffer.byteLength(html)}\0`).update(html).digest('hex');
  assert.equal(blob,'46b5b7d59ec45c9efa58067526970e5e7b0e435b','Historical HTML changed');
  html=html.replace('<title>Box3D WebGPU — Simulation Workbench</title>','<title>Box3D — Physics Capability Lab</title>');
  assert.ok(html.includes('/src/main.ts'));
  html=html.replace('/src/main.ts','/src/lab-entry.ts');
  html=html.replace('</head>',`<style>\n#application-navigation{position:fixed;inset:0 0 auto;z-index:1000;height:34px;display:flex;align-items:center;gap:20px;padding:0 16px;background:#151a1d;border-bottom:1px solid #343a3d;font:12px system-ui;color:#cfd5d7}#application-navigation a{color:inherit;text-decoration:none}#application-navigation a[aria-current]{color:#ff9b43;font-weight:700}#app,#engineering-workspaces-mount:not(:empty){margin-top:34px;height:calc(100dvh - 34px)!important}\n</style>\n</head>`);
  html=html.replace(/<body([^>]*)>/,`<body$1><nav id="application-navigation" aria-label="Applications"><a href="./?studio=liquid" data-app-switch="studio">Engineering Studio</a><a href="./lab.html" aria-current="page">Physics Capability Lab</a></nav>`);
  write('lab.html',html);
}
patch('vite.config.ts',"import { defineConfig } from 'vite';","import { defineConfig } from 'vite';\nimport { fileURLToPath } from 'node:url';");
patch('vite.config.ts',"  base: process.env.VITE_BASE_PATH ?? './',","  base: process.env.VITE_BASE_PATH ?? './',\n  build: {\n    rolldownOptions: {\n      input: {\n        studio: fileURLToPath(new URL('./index.html', import.meta.url)),\n        lab: fileURLToPath(new URL('./lab.html', import.meta.url)),\n      },\n    },\n  },");
patch('src/studio/study-navigation.ts',"  nav.querySelector('select')!.addEventListener", "  nav.insertAdjacentHTML('beforeend', `<a class=\"study-app-link\" data-app-switch=\"lab\" href=\"${import.meta.env.BASE_URL}lab.html\">Physics Lab ↗</a>`);\n  nav.querySelector('select')!.addEventListener");
if(!read('src/studio/study-navigation.css').includes('.study-app-link'))fs.appendFileSync('src/studio/study-navigation.css','\n.study-app-link{display:inline-flex;align-items:center;margin-left:12px;padding:8px;border:1px solid currentColor;border-radius:5px;color:inherit;text-decoration:none;font:500 12px Inter,system-ui;white-space:nowrap}.study-app-link:focus-visible{outline:2px solid #bf5a20;outline-offset:2px}\n@media(max-width:700px){.study-app-link{margin-left:5px;padding:6px;font-size:10px}}\n');
let index=read('index.html');
index=index.replace('The capability lab described below remains in the source','The capability lab described below remains in the source');
index=index.replaceAll('href="/?studio=', 'href="./?studio=').replaceAll('href="/licenses/','href="./licenses/').replaceAll('src="/studio/','src="./studio/').replaceAll('href="/studio/','href="./studio/').replace('href="/" aria-label="BOX3D Engineering Studio home"','href="./" aria-label="BOX3D Engineering Studio home"');
if(!index.includes('href="./lab.html"'))index=index.replace('<h2>Choose a study</h2>','<p><a href="./lab.html">Open the Physics Capability Lab</a> for native rigid bodies, cloth, rope, water, and cinematic showcases.</p>\n    <h2>Choose a study</h2>');
write('index.html',index);
const pkg=JSON.parse(read('package.json'));
pkg.devDependencies.playwright='1.56.1';
Object.assign(pkg.scripts,{
  'validate:release':'node scripts/validate-release.mjs',
  'test:release-contracts':'node --test tests/release-contracts.test.mjs',
  'test:browser:release':'node scripts/test-release-browser.mjs',
  'catalog:check':'node scripts/catalog-counts.mjs',
  'catalog:sync':'node scripts/catalog-counts.mjs --write',
  'stage:railway':'node scripts/stage-railway.mjs',
  'bench:contact-budget':'node scripts/contact-budget.mjs'
});
write('package.json',JSON.stringify(pkg,null,2)+'\n');
let caddy=read('deploy/railway/Caddyfile');
if(!caddy.includes('Cross-Origin-Opener-Policy same-origin'))caddy=caddy.replace('X-Content-Type-Options nosniff','X-Content-Type-Options nosniff\n\t\t\tCross-Origin-Opener-Policy same-origin\n\t\t\tCross-Origin-Embedder-Policy require-corp');
write('deploy/railway/Caddyfile',caddy);
let docker=read('deploy/railway/Dockerfile');
if(!docker.includes('COPY box3d '))docker=docker.replace('COPY licenses /srv/box3d/licenses','COPY licenses /srv/box3d/licenses\nCOPY lab.html /srv/box3d/lab.html\nCOPY box3d /srv/box3d/box3d\nCOPY textures /srv/box3d/textures\nCOPY soft-kernels-simd.wasm soft-kernels-scalar.wasm /srv/box3d/');
write('deploy/railway/Dockerfile',docker);
for(const path of ['.github/workflows/ci.yml','.github/workflows/pages.yml']){
  let y=read(path);
  const start=y.indexOf('      - name: Verify source manifest');
  const finish=y.indexOf('      - name: Add nojekyll marker');
  assert.ok(start>=0);
  const gate=`      - name: Install Chromium for software-rendered browser acceptance\n        run: npx playwright install --with-deps chromium\n\n      - name: Shared Studio, Lab, engine, browser, and production release gate\n        env:\n          BOX3D_QA_OUTPUT: \${{ runner.temp }}/box3d-release-qa\n        run: npm run validate:release\n\n      - name: Keep release QA receipts\n        if: always()\n        uses: actions/upload-artifact@v4\n        with:\n          name: box3d-release-qa-\${{ github.job }}\n          path: \${{ runner.temp }}/box3d-release-qa\n          if-no-files-found: warn\n          retention-days: 7\n\n`;
  if(!y.includes('run: npm run validate:release')){
    y=y.slice(0,start)+gate+(finish>=0?y.slice(finish):'');
    y=y.replace('node-version: 22','node-version: 24').replace('    runs-on: ubuntu-latest\n    steps:', '    runs-on: ubuntu-latest\n    timeout-minutes: 40\n    steps:');
    write(path,y);
  }
}
let readme=read('README.md');
readme=readme.replace('but `index.html` no longer links it.', 'and is available independently at [`lab.html`](lab.html). Both pages link to each other; Studio remains the default.');
readme=readme.replace('The capability lab described below remains in the source (`src/main.ts`) and its tests, but `index.html` no longer links it.', 'The capability lab described below is served separately at [`lab.html`](lab.html), using the retained `src/main.ts` runtime and its own complete page shell. Both applications link to each other.');
if(!readme.includes('## Release gate (both applications)'))readme+='\n## Release gate (both applications)\n\nRun `npm ci`, `npx playwright install chromium`, then `npm run validate:release` on Node 24. This shared CI/Pages gate tests both applications, packaged native and soft runtimes, Studio and engine suites, production assets, and software-rendered browser routes. Kernel byte-rebuild qualification remains a separate toolchain-specific check.\n\n`npm run stage:railway` creates a fresh, guarded deployment directory under `build/railway-release` containing both HTML entries, native single/threaded WASM, soft kernels, textures, Studio assets and notices. It does not deploy. See [the approved review repair notes](docs/REVIEW_REPAIRS_20261105.md).\n';
write('README.md',readme);
console.log('Guarded integration applied; no numerical solver or GPU-default change.');
