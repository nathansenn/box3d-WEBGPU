// The Lab's Save checkpoint and Load checkpoint buttons in headless Chromium with software WebGPU (docs/CHECKPOINTS.md).
//
//   npm run build
//   node scripts/checkpoint-browser-check.mjs [output directory] [example,example,...]
//
// It needs Playwright (resolved from this repository or from the global node_modules) and a Chromium with WebGPU;
// BOX3D_CHROMIUM names the executable (default /opt/pw-browsers/chromium when present). It is not in a gate, because
// the gates do not have a browser. The node tests of the same code path are tests/physics/checkpoint.test.mjs.
//
// For each example: open lab.html?example=<name>, pause, step it, press Save checkpoint and keep the downloaded file;
// step it further and read its state. Then open lab.html in a fresh browser context, load the file with Load
// checkpoint, step it as far, and require the same rigid transform hash and the same state hash of every solver, and
// that no page error, console error or failed request happened.
import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const {chromium} = playwright;

const output = path.resolve(process.argv[2] ?? process.env.BOX3D_QA_OUTPUT ?? path.join(os.tmpdir(), 'box3d-checkpoints'));
fs.mkdirSync(output, {recursive: true});
const EXAMPLES = (process.argv[3] ?? 'domino-run,ragdoll,moored-buoy,trampoline,hopper-seesaw,rubber-pad,quenched-plate,sphere-settling,dam-break').split(',');
/** Lab ticks before the checkpoint and after it. */
const BEFORE = 45, AFTER = 30;

const root = path.resolve('dist');
assert.ok(fs.existsSync(path.join(root, 'lab.html')), 'dist/lab.html is missing: run npm run build first');
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'};
const server = http.createServer((req, res) => {
  let relative;
  try { relative = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname.slice(1)) || 'index.html'; } catch { res.writeHead(400); res.end(); return; }
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const report = {base, output, examples: {}, errors: []};
const executable = process.env.BOX3D_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  ...(executable ? {executablePath: executable} : {}),
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--no-sandbox', '--enable-features=Vulkan', '--use-vulkan=swiftshader'],
});

async function newPage(label) {
  const context = await browser.newContext({acceptDownloads: true});
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(240000);
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => report.errors.push(`${label}: pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') report.errors.push(`${label}: ${message.text()}`); });
  page.on('response', (response) => { if (response.status() >= 400) report.errors.push(`${label}: ${response.status()} ${response.url()}`); });
  return {context, page};
}
const ready = page => page.waitForFunction(() => typeof window.box3dLab?.sceneState === 'function', null, {timeout: 240000});
const state = page => page.evaluate(() => window.box3dLab.sceneState());

try {
  for (const name of EXAMPLES) {
    const a = await newPage(`${name} A`);
    await a.page.goto(`${base}lab.html?example=${name}`);
    await ready(a.page);
    await a.page.waitForFunction(() => window.box3dLab.sceneState().loaded === true, null, {timeout: 240000});
    await a.page.evaluate(() => window.box3dLab.setPaused(true));
    const start = await state(a.page);
    await a.page.evaluate(t => window.box3dLab.stepSceneTo(t), start.tick + BEFORE);
    const atSave = await state(a.page);
    const [download] = await Promise.all([a.page.waitForEvent('download'), a.page.click('#lab-checkpoint-save')]);
    const file = path.join(output, download.suggestedFilename());
    await download.saveAs(file);
    const status = await a.page.textContent('#lab-scene-status');
    const expected = await a.page.evaluate(t => window.box3dLab.stepSceneTo(t), atSave.tick + AFTER);
    await a.context.close();

    // A fresh page: nothing loaded but the Lab itself, then Load checkpoint with the file.
    const b = await newPage(`${name} B`);
    await b.page.goto(`${base}lab.html`);
    await ready(b.page);
    await b.page.evaluate(() => window.box3dLab.setPaused(true));
    await b.page.setInputFiles('#lab-checkpoint-file', file);
    await b.page.waitForFunction(() => window.box3dLab.sceneState().loaded === true && /Resumed/.test(document.querySelector('#lab-scene-status')?.textContent ?? ''), null, {timeout: 240000});
    // A fresh page may run a few Lab ticks after the load before the pause takes hold: step to the same scene step count.
    const resumed = await b.page.evaluate(() => { window.box3dLab.setPaused(true); return window.box3dLab.sceneState(); });
    const remaining = (expected.steps - resumed.steps) / resumed.stepsPerTick;
    assert.ok(Number.isInteger(remaining) && remaining >= 0, `${name}: the resumed page is at step ${resumed.steps}, before step ${expected.steps}`);
    const actual = await b.page.evaluate(t => window.box3dLab.stepSceneTo(t), resumed.tick + remaining);
    await b.context.close();

    const row = {file: path.basename(file), bytes: fs.statSync(file).size, savedAt: atSave.steps, resumedAt: resumed.steps, status,
      expected: {steps: expected.steps, exactHash: expected.exactHash, stateHash: expected.stateHash}, actual: {steps: actual.steps, exactHash: actual.exactHash, stateHash: actual.stateHash}};
    report.examples[name] = row;
    assert.equal(resumed.title, atSave.title, `${name}: the title comes back`);
    assert.ok(resumed.steps >= atSave.steps, `${name}: the step count continues from the saved one`);
    assert.equal(actual.steps, expected.steps, `${name}: the same number of steps`);
    assert.equal(actual.exactHash, expected.exactHash, `${name}: rigid transforms after ${AFTER} more Lab ticks`);
    assert.equal(actual.stateHash, expected.stateHash, `${name}: every solver's state after ${AFTER} more Lab ticks`);
    console.log(`ok  ${name}: ${row.bytes} bytes saved at step ${row.savedAt}; resumed in a fresh page; at step ${actual.steps} exactHash ${actual.exactHash} and state ${actual.stateHash} match`);
  }
  assert.deepEqual(report.errors, [], 'no page error, console error or failed request');
} finally {
  fs.writeFileSync(path.join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();
  server.close();
}
console.log(`Checkpoint browser check passed for ${EXAMPLES.length} examples; report in ${path.join(output, 'report.json')}`);
