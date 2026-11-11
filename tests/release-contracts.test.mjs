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
test('CI gates pull requests, runs Studio suites on main, and Pages deploys only after CI',()=>{
  const ci=read('.github/workflows/ci.yml'),pages=read('.github/workflows/pages.yml'),gate=read('scripts/validate-release.mjs');
  assert.match(ci,/npm run validate:pr\b/);assert.match(ci,/npm run validate:studio\b/);
  assert.match(ci,/if: github\.event_name != 'pull_request'/,'Studio suites run on main and manual runs, not on every pull request');
  for(const name of ['test:engine','test:browser:release'])assert.match(ci,new RegExp(`npm run ${name}\\b`),name);
  assert.match(pages,/workflow_run:[\s\S]*workflows: \[CI\]/);assert.doesNotMatch(pages,/validate:(pr|studio|release)/,'Pages must not repeat the CI gates');
  assert.doesNotMatch(pages,/^permissions:[\s\S]*?pages: write[\s\S]*?^jobs:/m,'Pages write access belongs to the deploy job only');
  for(const name of ['test:engine','test:studio','test:studio:presets','test:studio:river','test:studio:reference','test:studio:press','test:studio:bridge','test:studio:liquid','test:studio:materials','test:qualification','test:threaded','test:browser:release','stage:railway'])assert.ok(gate.includes(`'${name}'`),name);
});
// CI must never write to the repository. #13 shipped a workflow with contents: write that
// generated code, committed it as a bot and pushed before running any check. Every
// workflow must keep a read-only token, and only the Pages deploy job may hold the
// pages and id-token write access that publishing needs.
const workflowDir='.github/workflows';
const jobOf=(lines,index)=>{for(let i=index;i>=0;i--){if(/^jobs:\s*$/.test(lines[i]))return null;const job=/^  ([A-Za-z0-9_-]+):\s*$/.exec(lines[i]);if(job)return job[1];}return null;};
function workflowProblems(files){
  const problems=[];
  for(const file of files){
    const text=read(`${workflowDir}/${file}`),lines=text.split('\n');
    const top=lines.indexOf('permissions:'),granted=[];
    if(top>=0)for(let i=top+1;i<lines.length&&/^  \S/.test(lines[i]);i++)granted.push(lines[i].trim());
    if(granted.join()!=='contents: read')problems.push(`${file}: the workflow-wide permissions must be exactly "contents: read"`);
    lines.forEach((line,i)=>{
      // Also matches flow style ({ contents: write }) and quoted values.
      for(const write of line.matchAll(/\b([a-z-]+)\s*:\s*['"]?write\b/g))
        if(!(file==='pages.yml'&&jobOf(lines,i)==='deploy'&&['pages','id-token'].includes(write[1])))
          problems.push(`${file}:${i+1}: "${line.trim()}" is not allowed; only the Pages deploy job may write, and only pages and id-token`);
      if(/\bgit\b.*\s(push|commit|tag|merge|rebase|cherry-pick|am|reset|update-ref)\b/.test(line))
        problems.push(`${file}:${i+1}: CI must not create commits or push: "${line.trim()}"`);
    });
    if(/\bwrite-all\b/.test(text))problems.push(`${file}: write-all is not allowed`);
    if(/\bpull_request_target\b/.test(text))problems.push(`${file}: pull_request_target runs fork code with a write token`);
    if(file!=='pages.yml'&&/\bworkflow_run\b/.test(text))problems.push(`${file}: workflow_run is reserved for the Pages deploy after CI`);
    if(/\bsecrets\.(?!GITHUB_TOKEN\b)/.test(text))problems.push(`${file}: workflows use no stored secrets`);
  }
  return problems;
}
test('workflows stay read-only: none can write to the repository, commit or push',()=>{
  const files=fs.readdirSync(workflowDir).filter(name=>/\.ya?ml$/.test(name)).sort();
  const problems=workflowProblems(files);
  for(const file of files)if(!['ci.yml','pages.yml'].includes(file))problems.push(`${file}: new workflows are a deliberate change; review them against this test and list them here`);
  assert.deepEqual(problems,[],problems.join('\n'));
});
// Every test file must run in a gate. Sixteen Studio suites and the qualification suites once sat in
// tests/ with no npm script, gate or workflow running them. This walks scripts/validate-release.mjs the
// way the gates run it: npm scripts (and the scripts they call), explicit files and globs, the compiled
// .test-build suites, runner scripts that hand files to `node --test`, and test files imported by a
// reached test. A file that must stay out of every gate goes in UNWIRED_TESTS with the reason.
const UNWIRED_TESTS={
  'tests/studio/material-labs.test.mjs':'fails and is too slow for a gate (measured 2026-11-11): the laminated pane travels 645 mm against 757 mm for annealed, so the retention assertion (below 30%) fails on unchanged physics, and the file needs 36 minutes because a fractured-glass step still takes 0.09 to 0.8 s; see docs/GLASS_CONTACT.md',
  'tests/qualification/cable-evidence.test.mjs':'needs benchmarks/results/engine-100x/runs/compliant-cable-accuracy-20260910-04, evidence that is not in the repository',
  'tests/qualification/frame-evidence.test.mjs':'needs benchmarks/results/engine-100x/runs/frame-accuracy-20260911-04, evidence that is not in the repository',
  'tests/qualification/native-capacity-check.test.mjs':'needs benchmarks/results/engine-100x/native-capacity-renderer-metal-direct-20260910-01.json, evidence that is not in the repository',
  'tests/qualification/native-query-evidence.test.mjs':'needs benchmarks/results/engine-100x/runs/native-queries-geometry-20260910-04, evidence that is not in the repository',
  'tests/qualification/native-recycling-check.test.mjs':'needs benchmarks/results/engine-100x/runs/native-body-recycling-20260910-04, evidence that is not in the repository',
  'tests/qualification/proximal-cable-evidence.test.mjs':'needs benchmarks/results/engine-100x/runs/proximal-cable-accuracy-20260911-02 and compliant-cable-accuracy-20260910-04, evidence that is not in the repository',
  'tests/qualification/studio-shared-check.test.mjs':'needs benchmarks/results/engine-100x/runs/studio-shared-transport-20260910-01, evidence that is not in the repository',
};
const isTestFile=file=>/\.test\.(mjs|cjs|js|ts|py)$/.test(file)||/^scripts\/[^/]*(-test\.[a-z]+|\.test\.[a-z]+)$/.test(file)||/^scripts\/test-[^/]+$/.test(file);
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(`${dir}/${entry.name}`):[`${dir}/${entry.name}`]);
const isFile=file=>fs.existsSync(file)&&fs.statSync(file).isFile();
function expandPath(pattern){
  if(!pattern.includes('*'))return isFile(pattern)?[pattern]:[];
  const dir=pattern.slice(0,pattern.lastIndexOf('/')),name=new RegExp(`^${pattern.slice(dir.length+1).split('*').map(part=>part.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('[^/]*')}$`);
  return dir.includes('*')||!fs.existsSync(dir)?[]:fs.readdirSync(dir).filter(file=>name.test(file)).map(file=>`${dir}/${file}`);
}
function gateReach(gateSource,scripts){
  const reached=new Set(),seenScripts=new Set();
  const addFile=file=>{
    if(reached.has(file)||!isFile(file))return;
    reached.add(file);
    const text=read(file);
    // A runner script hands the test files it lists to `node --test`.
    if(file.startsWith('scripts/')&&/['"]--test['"]/.test(text))for(const [,listed] of text.matchAll(/['"]((?:tests|scripts)\/[^'"\s]+)['"]/g))expandPath(listed).forEach(addFile);
    // A test file imported by a reached test runs with it.
    if(file.startsWith('tests/'))for(const [,,specifier] of text.matchAll(/(\bfrom\s*|\bimport\s*\(?\s*)['"](\.[^'"]+)['"]/g)){
      const base=new URL(specifier,`file:///${file}`).pathname.slice(1);
      for(const candidate of [base,`${base}.ts`,`${base}.mjs`])if(candidate.startsWith('tests/')&&/\.test\.[a-z]+$/.test(candidate))addFile(candidate);
    }
  };
  const addCommand=command=>{
    for(const [,name] of command.matchAll(/\bnpm run ([\w:.-]+)/g))addScript(name);
    for(const [,compiled] of command.matchAll(/\.test-build\/((?:tests|scripts)\/[\w./-]+)\.js\b/g))addFile(`${compiled}.ts`);
    for(const [,token] of command.matchAll(/(?<![\w./-])(?:\.\/)?((?:tests|scripts)\/[\w./*-]+)/g))expandPath(token).forEach(addFile);
  };
  const addScript=name=>{if(seenScripts.has(name)||!(name in scripts))return;seenScripts.add(name);addCommand(scripts[name]);};
  const literals=[...gateSource.matchAll(/['"`]([^'"`\n]+)['"`]/g)].map(match=>match[1]);
  const compiledSuites=/\.test-build\/tests\/\$\{\w+\}\.test\.js/.test(gateSource);
  for(const literal of literals){
    addScript(literal);addCommand(literal);
    if(compiledSuites&&/^[\w-]+$/.test(literal))addFile(`tests/${literal}.test.ts`);
  }
  return reached;
}
function gateFunctions(source){
  const bodies={};
  for(const [,name,body] of source.matchAll(/^function (\w+)\(\)\{\n([\s\S]*?)\n\}$/gm))bodies[name]=body;
  return bodies;
}
test('every test file runs in a gate or is listed in UNWIRED_TESTS with a reason',()=>{
  const scripts=JSON.parse(read('package.json')).scripts,bodies=gateFunctions(read('scripts/validate-release.mjs'));
  for(const name of ['pullRequestGate','studioGate','reportedGates'])assert.ok(bodies[name],`scripts/validate-release.mjs must keep ${name}()`);
  const pr=gateReach(bodies.pullRequestGate,scripts),studio=gateReach(bodies.studioGate,scripts),release=new Set([...pr,...studio,...gateReach(bodies.reportedGates,scripts)]);
  const all=[...walk('tests'),...walk('scripts')].filter(isTestFile).sort();
  // The walk must see the suites known to be wired, or a parsing change would pass everything or nothing.
  for(const file of ['tests/unit.test.ts','tests/autoplay.test.ts','tests/round5-worker.test.py','tests/assets/ktx2-header.test.mjs','tests/engine/worker.test.mjs','scripts/test-collision.mjs'])assert.ok(pr.has(file),`${file} runs in the pull-request gate`);
  for(const file of ['tests/studio/failure.test.mjs','tests/studio/press-lab.test.mjs'])assert.ok(studio.has(file)&&!pr.has(file),`${file} runs in the Studio gate`);
  assert.ok(release.has('tests/engine/harness.test.mjs')&&!pr.has('tests/engine/harness.test.mjs'),'the engine suite runs in the release gate');
  assert.ok(!release.has('tests/studio/material-labs.test.mjs'),'an unwired file is seen as unwired');
  const problems=[];
  for(const file of all)if(!release.has(file)&&!(file in UNWIRED_TESTS))problems.push(`${file}: no gate runs it; add it to an npm script that scripts/validate-release.mjs runs, or to UNWIRED_TESTS with the reason`);
  for(const [file,reason] of Object.entries(UNWIRED_TESTS)){
    if(!all.includes(file))problems.push(`${file}: listed in UNWIRED_TESTS but is not a test file in the repository; remove the entry`);
    else if(release.has(file))problems.push(`${file}: a gate runs it now; remove it from UNWIRED_TESTS`);
    if(typeof reason!=='string'||reason.trim().length<20)problems.push(`${file}: UNWIRED_TESTS needs a reason that says why no gate runs it`);
  }
  assert.deepEqual(problems,[],problems.join('\n'));
});
