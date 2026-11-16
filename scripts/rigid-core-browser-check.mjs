// Opens the rigid-core parts of the built Lab in headless Chromium: the debug draw on both renderers, and the
// rigid-core example scenes (a character on an obstacle course, a car on terrain, a ray-cast scanner, a bullet
// through thin walls, a breakable bridge).
//
//   npm run build
//   node scripts/rigid-core-browser-check.mjs [output directory]
//
// It needs Playwright (resolved from this repository or from the global node_modules) and a Chromium with WebGPU;
// BOX3D_CHROMIUM names the executable (default /opt/pw-browsers/chromium when present). It is not in a gate, because
// the gates do not have a browser. The node tests of the same code are tests/physics/rigid-debug.test.mjs,
// tests/physics/rigid-play.test.mjs and packages/box3d-kit/test/v21-rigid-*.test.mjs.
//
// For each case: open the address, pause, step, read the canvas back in the frame that drew it (page.screenshot shows
// a blank WebGPU canvas), require that it is not blank, and require what the case states (lines drawn, a controller
// that moved its body, a joint that broke). No page error, console error or failed request may happen.
import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { try { playwright = require('/opt/node-tools/node_modules/playwright'); } catch { playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } }
const {chromium} = playwright;

const output = path.resolve(process.argv[2] ?? process.env.BOX3D_QA_OUTPUT ?? path.join(os.tmpdir(), 'box3d-rigid-core'));
const only = process.argv[3] ? process.argv[3].split(',') : null;
fs.mkdirSync(output, {recursive: true});
const root = path.resolve('dist');
assert.ok(fs.existsSync(path.join(root, 'lab.html')), 'dist/lab.html is missing: run npm run build first');
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.jpg': 'image/jpeg', '.webp': 'image/webp'};
const server = http.createServer((req, res) => {
  let relative;
  try { relative = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname.slice(1)) || 'index.html'; } catch { res.writeHead(400); res.end(); return; }
  const file = path.resolve(root, relative);
  if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, {'Content-Type': mime[path.extname(file)] ?? 'application/octet-stream', 'Cross-Origin-Opener-Policy': 'same-origin', 'Cross-Origin-Embedder-Policy': 'require-corp', 'Cache-Control': 'no-store'});
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const report = {base, output, cases: {}, checks: [], errors: [], warnings: [], screenshots: []};
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

const loaded = page => page.waitForFunction(() => window.box3dLab?.sceneState().loaded === true, null, {timeout: 240000});
async function advance(page, ticks) {
  return page.evaluate((n) => {
    window.box3dLab.setPaused(true);
    const from = window.box3dLab.sceneState().tick;
    return window.box3dLab.stepSceneTo(from + n);
  }, ticks);
}

const CASES = [
  // Debug draw of a scene with joints and resting contacts, on both renderers; then switched from the page.
  {name: 'debug-webgpu', address: 'lab.html?example=ragdoll&debug=all', ticks: 90, async verify(page) {
    const info = await page.evaluate(() => ({debug: window.box3dLab.rigidDebug(), renderer: window.box3dLab.rendererInfo().kind, switches: [...document.querySelectorAll('#lab-debug-draw input')].map(input => [input.id, input.checked])}));
    assert.equal(info.renderer, 'webgpu');
    assert.ok(info.debug.enabled && info.debug.lines > 100 && !info.debug.truncated, `debug lines are drawn (${JSON.stringify(info.debug)})`);
    assert.ok(info.switches.every(([, on]) => on), 'the panel shows every layer on');
    return info.debug;
  }},
  {name: 'debug-webgl2', address: 'lab.html?example=ragdoll&debug=all&renderer=webgl2', ticks: 90, async verify(page) {
    const info = await page.evaluate(() => ({debug: window.box3dLab.rigidDebug(), renderer: window.box3dLab.rendererInfo().kind}));
    assert.equal(info.renderer, 'webgl2');
    assert.ok(info.debug.lines > 100, `debug lines are drawn (${JSON.stringify(info.debug)})`);
    return info.debug;
  }},
  {name: 'debug-toggle', address: 'lab.html?example=domino-run', ticks: 120, async verify(page) {
    const off = await page.evaluate(() => window.box3dLab.rigidDebug());
    assert.equal(off.enabled, false); assert.equal(off.lines, 0);
    // The switch in the panel, as a person would use it.
    await page.evaluate(() => { document.getElementById('lab-debug-draw-on').click(); });
    const shot = await captureCanvas(page, 'debug-toggle-on.png');
    const on = await page.evaluate(() => ({debug: window.box3dLab.rigidDebug(), address: location.search}));
    assert.ok(on.debug.enabled && on.debug.lines > 20 && /debug=1/.test(on.address), `switched on from the panel (${JSON.stringify(on)})`);
    await page.evaluate(() => { document.getElementById('lab-debug-draw-bounds').click(); });
    await captureCanvas(page, 'debug-toggle-bounds.png');
    const bounds = await page.evaluate(() => ({debug: window.box3dLab.rigidDebug(), address: location.search}));
    assert.ok(bounds.debug.layers.bounds && bounds.debug.lines > on.debug.lines, 'the bounds layer adds lines');
    return {off: off.lines, on: on.debug.lines, withBounds: bounds.debug.lines, shot};
  }},
];

try {
  for (const one of CASES) {
    if (only && !only.includes(one.name)) continue;
    const context = await browser.newContext({viewport: {width: 1280, height: 800}});
    const page = await newPage(context, one.name);
    await page.goto(base + one.address);
    await loaded(page);
    await page.evaluate(() => { window.box3dLab.setPaused(true); });
    const state = await advance(page, one.ticks ?? 120);
    const canvas = await captureCanvas(page, `${one.name}.png`);
    assert.ok(canvas.lit > 0.05 && canvas.colours > 12, `${one.name}: the canvas is not blank (${JSON.stringify(canvas)})`);
    const result = await one.verify(page, state);
    report.cases[one.name] = {address: one.address, canvas, tick: state.tick, result};
    check(one.name, {canvas, result});
    await context.close();
  }
  assert.deepEqual(report.errors, [], 'no page error, console error or failed request');
  check('no page errors');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
  fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  if (report.errors.length) console.log(report.errors.join('\n'));
}
console.log(`Captures and report.json are in ${output}`);
