// Opens every coupled example scene of the built Lab in headless Chromium with software WebGPU.
//
//   npm run build:pages
//   node scripts/coupled-scenes-browser-check.mjs [output directory] [example,example,...]
//
// It needs Playwright (resolved from this repository or from the global node_modules) and a Chromium
// with WebGPU; BOX3D_CHROMIUM names the executable (default /opt/pw-browsers/chromium when present).
// It is not in a gate, because the gates do not have a browser. The node tests of the same code path
// are tests/physics/lab-coupled-scenes.test.mjs.
//
// For each example: open lab.html?example=<name>, pause, step it, read the canvas back in the frame that
// drew it (page.screenshot shows a blank WebGPU canvas) and require that it is not blank; read the
// coupled readout (energy ledger, events); copy the share link, open it in two fresh browser contexts, step
// both the same number of steps and require the same scene hash and the same state hash in both; and require
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

const output = path.resolve(process.argv[2] ?? process.env.BOX3D_QA_OUTPUT ?? path.join(os.tmpdir(), 'box3d-coupled-scenes'));
fs.mkdirSync(output, {recursive: true});
const EXAMPLES = (process.argv[3] ?? 'buoy-and-crates,trampoline,hopper-seesaw,suspended-platform,moored-buoy,cable-stayed-deck').split(',');
/** Lab ticks to advance before the first capture, and after reopening a link. */
const FIRST = {'hopper-seesaw': 180, trampoline: 90}, SHARE_TICKS = 30;

const root = path.resolve('dist');
assert.ok(fs.existsSync(path.join(root, 'lab.html')), 'dist/lab.html is missing: run npm run build:pages first');
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'};
// A share link of a scene with many grains is long: allow request lines up to 4 MB.
const server = http.createServer({maxHeaderSize: 4 << 20}, (req, res) => {
  let relative;
  try { relative = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname.slice(1)) || 'index.html'; } catch { res.writeHead(400); res.end(); return; }
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const report = {base, output, examples: {}, checks: [], errors: [], warnings: [], screenshots: []};
const check = (name, value) => { report.checks.push({name, value}); console.log(`ok  ${name}${value === undefined ? '' : `: ${typeof value === 'string' ? value : JSON.stringify(value)}`}`); };
const executable = process.env.BOX3D_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  ...(executable ? {executablePath: executable} : {}),
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--no-sandbox', '--enable-features=Vulkan', '--use-vulkan=swiftshader'],
});

async function newPage(context, label) {
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(240000);
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => report.errors.push(`${label}: pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(`${label}: ${message.text()}`);
    if (message.type() === 'warning') report.warnings.push(`${label}: ${message.text()}`);
  });
  page.on('response', (response) => { if (response.status() >= 400) report.errors.push(`${label}: ${response.status()} ${response.url()}`); });
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => original((time) => { callback(time); const capture = window.__capture; if (capture) { window.__capture = null; capture(); } });
  });
  return page;
}

/** The canvas as a PNG file, with the share of pixels that are lit and how many distinct colours it has. */
async function captureCanvas(page, name) {
  const shot = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const arm = () => { window.__capture = () => {
      if (++frames < 3) { arm(); return; }
      const canvas = document.getElementById('gpu-canvas'), url = canvas.toDataURL('image/png');
      const image = new Image();
      image.onload = () => {
        const copy = document.createElement('canvas');
        copy.width = image.width; copy.height = image.height;
        const context = copy.getContext('2d');
        context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, copy.width, copy.height).data, colours = new Set();
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
          if ((i >> 2) % 37 === 0) colours.add((data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | data[i + 2] >> 4);
        }
        resolve({url, width: image.width, height: image.height, lit: lit / (data.length / 4), colours: colours.size});
      };
      image.src = url;
    }; };
    arm();
  }));
  const file = path.join(output, name);
  fs.writeFileSync(file, Buffer.from(shot.url.split(',')[1], 'base64'));
  report.screenshots.push(file);
  return {width: shot.width, height: shot.height, lit: +shot.lit.toFixed(3), colours: shot.colours};
}

const loaded = page => page.waitForFunction(() => window.box3dLab?.sceneState().loaded === true && window.box3dLab.sceneState().coupled === true, null, {timeout: 240000});
/** Pause, then step to `ticks` Lab ticks past the current one, timing it. */
async function advance(page, ticks) {
  return page.evaluate((n) => {
    window.box3dLab.setPaused(true);
    const start = performance.now(), from = window.box3dLab.sceneState().tick, state = window.box3dLab.stepSceneTo(from + n);
    return {...state, wallMs: performance.now() - start, ticks: state.tick - from};
  }, ticks);
}

try {
  for (const name of EXAMPLES) {
    const context = await browser.newContext({viewport: {width: 1280, height: 800}});
    const page = await newPage(context, name);
    await page.goto(`${base}lab.html?example=${name}`);
    await loaded(page);
    const opened = await page.evaluate(() => { window.box3dLab.setPaused(true); return window.box3dLab.sceneState(); });
    const first = FIRST[name] ?? 120;
    const stepped = await advance(page, first);
    assert.equal(stepped.simulationTick, opened.simulationTick + first * stepped.stepsPerTick, `${name}: every Lab tick is stepsPerTick simulation steps`);
    const canvas = await captureCanvas(page, `${name}.png`);
    assert.ok(canvas.lit > 0.2 && canvas.colours > 20, `${name}: the canvas is not blank (${JSON.stringify(canvas)})`);
    const readout = await page.evaluate(() => window.box3dLab.coupledReadout());
    assert.ok(readout.energy.entries.length > 0, `${name}: the energy ledger has entries`);
    assert.equal(await page.locator('#lab-coupled-panel').isVisible(), true, `${name}: the readout panel is shown`);
    await page.locator('#lab-coupled-panel').screenshot({path: path.join(output, `${name}-panel.png`)});
    report.screenshots.push(path.join(output, `${name}-panel.png`));
    // Share link: Copy share link writes it into the address (and the clipboard when allowed).
    await page.click('#lab-scene-copy').catch(async () => { await page.evaluate(() => document.getElementById('lab-scene-copy')?.click()); });
    await page.waitForFunction(() => typeof window.box3dLab.lastShareLink() === 'string', null, {timeout: 60000});
    const link = await page.evaluate(() => window.box3dLab.lastShareLink());
    const saved = await page.evaluate(() => window.box3dLab.sceneJson());
    await context.close();

    const reopen = async (label) => {
      const fresh = await browser.newContext({viewport: {width: 1280, height: 800}});
      const viewer = await newPage(fresh, `${name} ${label}`);
      await viewer.goto(link);
      await loaded(viewer);
      const at = await viewer.evaluate(() => { window.box3dLab.setPaused(true); return window.box3dLab.sceneState(); });
      // The page may have taken a few ticks before it was paused: step both to the same simulation tick.
      const target = Math.max(at.tick, 8) + SHARE_TICKS;
      const state = await viewer.evaluate(t => window.box3dLab.stepSceneTo(t), target);
      const shot = label === 'first' ? await captureCanvas(viewer, `${name}-share-link.png`) : null;
      await fresh.close();
      return {state, shot};
    };
    const a = await reopen('first'), b = await reopen('second');
    assert.equal(a.state.source, 'link');
    assert.equal(a.state.sceneHash, b.state.sceneHash);
    assert.equal(a.state.title, saved.meta?.title ?? a.state.title);
    assert.equal(a.state.simulationTick, b.state.simulationTick);
    assert.equal(a.state.stateHash, b.state.stateHash, `${name}: two fresh openings of the share link give the same state hash`);
    assert.ok(a.shot.lit > 0.2, `${name}: the reopened canvas is not blank`);
    report.examples[name] = {
      opened: {sceneHash: opened.sceneHash, bodies: opened.bodies, draw: opened.coupledDraw},
      stepped: {labTicks: stepped.ticks, simulationSteps: stepped.ticks * stepped.stepsPerTick, wallMs: Math.round(stepped.wallMs), msPerStep: +(stepped.wallMs / (stepped.ticks * stepped.stepsPerTick)).toFixed(3), stateHash: stepped.stateHash, events: stepped.events, energy: stepped.energy},
      canvas, readoutStepMs: readout.stepMs, link: link.length,
      share: {sceneHash: a.state.sceneHash, simulationTick: a.state.simulationTick, stateHash: a.state.stateHash},
    };
    check(`${name}: opens, steps, draws, and its share link reopens the same twice`, {canvas, msPerStep: report.examples[name].stepped.msPerStep, share: report.examples[name].share});
  }
  assert.deepEqual(report.errors, [], `console errors:\n${report.errors.join('\n')}`);
  check('no console errors, page errors or failed requests', {warnings: report.warnings.length});
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error instanceof Error ? error.stack : String(error);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, 'coupled-scenes-browser-check.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
console.log(`${report.ok ? 'PASS' : 'FAIL'}: ${report.checks.length} checks, ${report.errors.length} console errors, ${report.warnings.length} warnings. Output in ${output}`);
