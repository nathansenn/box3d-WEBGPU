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
  for(const name of ['test:engine','test:studio','test:studio:presets','test:studio:river','test:studio:reference','test:studio:press','test:browser:release','stage:railway'])assert.ok(gate.includes(`'${name}'`),name);
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
