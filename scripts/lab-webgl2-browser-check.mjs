// Checks the Physics Lab's WebGL2 renderer against its WebGPU renderer in headless Chromium.
//
//   npm run build:pages
//   node scripts/lab-webgl2-browser-check.mjs [output directory] [example,example,...] [lab,lab,...]
//
// It needs Playwright (resolved from this repository or from the global node_modules) and a Chromium
// with WebGPU and WebGL2; BOX3D_CHROMIUM names the executable (default /opt/pw-browsers/chromium when
// present). Both run on SwiftShader here (software). It is not in a gate, because the gates do not have
// a browser. The node tests of the code without a DOM are tests/physics/lab-webgl-streams.test.mjs and
// tests/physics/lab-renderer-selection.test.mjs.
//
// What it does:
//   1. Every rigid example and every coupled example (solids and fluids included), once with ?renderer=webgpu and
//      once with ?renderer=webgl2: pause, step to the same Lab tick, require the same state hash from both,
//      read both canvases back in the frame that drew them (page.screenshot shows a blank WebGPU canvas),
//      require that neither is blank, compare them on a 128 x 80 luminance thumbnail (mean difference,
//      correlation, and the share of cells that differ by more than 0.15, which a missing or moved object
//      raises), and write them side by side.
//   1b. Four recipe labs with GPU water, intact cloth, a cable and a metal sheet on both renderers: both draw
//      (captured side by side; they run on wall time, so no agreement is required).
//   2. The scene editor on both renderers: select a body by clicking it and capture the selection tint and
//      the editor's line overlay. Then the editor with a coupled scene (sphere-settling): the ball, which the fluid
//      section names, is selected by a click; the fluid's slice and box edges are drawn with the editor's lines.
//   3. Selection: no ?renderer with WebGPU gives WebGPU; with navigator.gpu removed it gives WebGL2.
//   4. A simulated device loss mid-run (box3dLab.simulateGraphicsLoss destroys the WebGPU device): the Lab
//      switches to WebGL2 with the same tick, state hash and camera, draws, and steps on to the hash a
//      WebGPU-only run reaches. A WebGL2 context loss is replaced by a new WebGL2 context the same way.
//   5. Frame times of both renderers while a scene runs (software rendering: not GPU numbers).
//   6. No page error, console error or failed request anywhere.
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

const output = path.resolve(process.argv[2] ?? process.env.BOX3D_QA_OUTPUT ?? path.join(os.tmpdir(), 'box3d-lab-webgl2'));
fs.mkdirSync(output, {recursive: true});
const RIGID = ['pendulum-wave', 'newtons-cradle', 'domino-run', 'terrain-car', 'ragdoll'];
const COUPLED = ['buoy-and-crates', 'trampoline', 'hopper-seesaw', 'suspended-platform', 'moored-buoy', 'cable-stayed-deck', 'rubber-pad', 'notched-beam', 'quenched-plate', 'heated-bar',
  'sphere-settling', 'cavity-flow', 'flow-past-cylinder', 'dam-break'];
const EXAMPLES = process.argv[3] ? process.argv[3].split(',') : [...RIGID, ...COUPLED];
const RECIPES = process.argv[4] ? process.argv[4].split(',').filter(Boolean) : ['tsunami-flume', 'tempest-flag', 'sky-crane-cable', 'titan-bend-dent'];
/** The Lab tick both renderers step to before the capture. */
const TICK = {'hopper-seesaw': 180, 'quenched-plate': 150, 'heated-bar': 300, 'rubber-pad': 60, 'notched-beam': 60, trampoline: 90, 'sphere-settling': 45, 'cavity-flow': 240, 'flow-past-cylinder': 240, 'dam-break': 40};
const VIEWPORT = {width: 1280, height: 800};

const root = path.resolve('dist');
assert.ok(fs.existsSync(path.join(root, 'lab.html')), 'dist/lab.html is missing: run npm run build:pages first');
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'};
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

const report = {base, output, examples: {}, editor: null, selection: null, loss: null, timings: null, checks: [], errors: [], warnings: 0, screenshots: []};
const check = (name, value) => { report.checks.push({name, value}); console.log(`ok  ${name}${value === undefined ? '' : `: ${typeof value === 'string' ? value : JSON.stringify(value)}`}`); };
const executable = process.env.BOX3D_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  ...(executable ? {executablePath: executable} : {}),
  args: ['--enable-unsafe-webgpu', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--no-sandbox', '--enable-features=Vulkan', '--use-vulkan=swiftshader'],
});

async function openLab(query, label, {renderer = null, withoutWebGPU = false, recipe = false} = {}) {
  const context = await browser.newContext({viewport: VIEWPORT});
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(240000);
  page.setDefaultTimeout(180000);
  page.on('pageerror', error => report.errors.push(`${label}: pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(`${label}: ${message.text()}`);
    if (message.type() === 'warning') report.warnings++;
  });
  page.on('response', (response) => { if (response.status() >= 400) report.errors.push(`${label}: ${response.status()} ${response.url()}`); });
  await page.addInitScript((removeGpu) => {
    if (removeGpu) Object.defineProperty(Navigator.prototype, 'gpu', {get: () => undefined, configurable: true});
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => original((time) => {
      callback(time);
      const capture = window.__capture; if (capture) { window.__capture = null; capture(); }
      const times = window.__frameTimes; if (times) times.push(time);
    });
  }, withoutWebGPU);
  await page.goto(`${base}lab.html?${query}${renderer ? `&renderer=${renderer}` : ''}`);
  if (recipe) await page.waitForFunction(() => !!window.box3dLab && !!document.getElementById('gpu-canvas')?.dataset.renderer, null, {timeout: 240000});
  else await page.waitForFunction(() => window.box3dLab?.sceneState().loaded === true, null, {timeout: 240000});
  return {context, page};
}

/** The canvas as a PNG data URL read back in the frame that drew it. */
const readCanvas = page => page.evaluate(() => new Promise((resolve) => {
  let frames = 0;
  const arm = () => { window.__capture = () => { if (++frames < 3) { arm(); return; } resolve(document.getElementById('gpu-canvas').toDataURL('image/png')); }; };
  arm();
}));

/** Measures of one capture or of a pair: lit share, colours, and for a pair the thumbnail difference, correlation and foreground overlap. */
async function measure(page, urls) {
  return page.evaluate(async (list) => {
    const load = url => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.src = url; });
    const images = await Promise.all(list.map(load));
    const stats = images.map((image) => {
      const c = document.createElement('canvas'); c.width = image.width; c.height = image.height;
      const g = c.getContext('2d'); g.drawImage(image, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height).data, colours = new Set();
      let lit = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
        if ((i >> 2) % 37 === 0) colours.add((data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | data[i + 2] >> 4);
      }
      const t = document.createElement('canvas'); t.width = 128; t.height = 80;
      const tg = t.getContext('2d'); tg.imageSmoothingQuality = 'high'; tg.drawImage(image, 0, 0, 128, 80);
      const td = tg.getImageData(0, 0, 128, 80).data, lum = [];
      for (let i = 0; i < td.length; i += 4) lum.push((0.2126 * td[i] + 0.7152 * td[i + 1] + 0.0722 * td[i + 2]) / 255);
      return {width: image.width, height: image.height, lit: +(lit / (data.length / 4)).toFixed(3), colours: colours.size, lum};
    });
    if (stats.length === 1) { const {lum, ...rest} = stats[0]; return rest; }
    const [a, b] = stats.map(s => s.lum), n = a.length;
    const mean = v => v.reduce((x, y) => x + y, 0) / n, ma = mean(a), mb = mean(b);
    let cov = 0, va = 0, vb = 0, diff = 0, large = 0;
    for (let i = 0; i < n; i++) { cov += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; diff += Math.abs(a[i] - b[i]); if (Math.abs(a[i] - b[i]) > 0.15) large++; }
    return {meanDifference: +(diff / n).toFixed(4), largeDifferenceShare: +(large / n).toFixed(4), correlation: +(cov / Math.sqrt(va * vb || 1)).toFixed(4), meanLuminance: [+ma.toFixed(3), +mb.toFixed(3)], sizes: stats.map(s => [s.width, s.height])};
  }, urls);
}

/** Two captures side by side with their labels, as one PNG. */
async function sideBySide(page, left, right, labels, file) {
  const url = await page.evaluate(async ([l, r, names]) => {
    const load = u => new Promise((resolve) => { const image = new Image(); image.onload = () => resolve(image); image.src = u; });
    const [a, b] = await Promise.all([load(l), load(r)]);
    const c = document.createElement('canvas'); c.width = a.width + b.width + 8; c.height = Math.max(a.height, b.height) + 28;
    const g = c.getContext('2d'); g.fillStyle = '#111'; g.fillRect(0, 0, c.width, c.height);
    g.drawImage(a, 0, 28); g.drawImage(b, a.width + 8, 28);
    g.fillStyle = '#eee'; g.font = '16px sans-serif'; g.fillText(names[0], 8, 19); g.fillText(names[1], a.width + 16, 19);
    return c.toDataURL('image/png');
  }, [left, right, labels]);
  const target = path.join(output, file);
  fs.writeFileSync(target, Buffer.from(url.split(',')[1], 'base64'));
  report.screenshots.push(target);
}

const advanceTo = (page, tick) => page.evaluate((t) => { window.box3dLab.setPaused(true); return window.box3dLab.stepSceneTo(t); }, tick);
const pause = page => page.evaluate(() => { window.box3dLab.setPaused(true); return window.box3dLab.sceneState(); });
const rendererInfo = page => page.evaluate(() => window.box3dLab.rendererInfo());
const statusText = page => page.evaluate(() => document.getElementById('runtime-renderer')?.textContent ?? '');

let tools = null;
try {
  tools = await (await browser.newContext()).newPage();
  await tools.goto('about:blank');

  // 1. Every example on both renderers.
  for (const name of EXAMPLES) {
    const target = TICK[name] ?? 120, runs = {};
    for (const renderer of ['webgpu', 'webgl2']) {
      const {context, page} = await openLab(`example=${name}`, `${name} ${renderer}`, {renderer});
      const opened = await pause(page);
      assert.ok(opened.tick < target, `${name}: the page took fewer than ${target} ticks before it was paused`);
      const state = await advanceTo(page, target);
      const info = await rendererInfo(page);
      assert.equal(info.kind, renderer, `${name}: ?renderer=${renderer} draws with ${renderer}`);
      assert.equal(await statusText(page), renderer === 'webgpu' ? 'WebGPU' : 'WebGL2', `${name}: the status bar names the renderer`);
      const url = await readCanvas(page);
      const shot = await measure(page, [url]);
      assert.ok(shot.lit > 0.2 && shot.colours > 20, `${name} ${renderer}: the canvas is not blank (${JSON.stringify(shot)})`);
      // What the renderer drew is read after the capture: the frames before it drew the stepped state.
      const drawnState = await page.evaluate(() => window.box3dLab.sceneState());
      assert.equal(drawnState.tick, state.tick);
      runs[renderer] = {url, shot, state, shapes: drawnState.shapes, drawn: drawnState.drawnMeshes, coupledDraw: drawnState.coupledDraw};
      await context.close();
    }
    assert.equal(runs.webgpu.state.tick, runs.webgl2.state.tick);
    assert.equal(runs.webgpu.state.stateHash, runs.webgl2.state.stateHash, `${name}: the same state hash after ${target} ticks with either renderer`);
    assert.deepEqual(runs.webgpu.shapes, runs.webgl2.shapes, `${name}: the same shape plan`);
    assert.deepEqual(runs.webgpu.drawn, runs.webgl2.drawn, `${name}: the same own-geometry bodies and vertices`);
    const compared = await measure(tools, [runs.webgpu.url, runs.webgl2.url]);
    await sideBySide(tools, runs.webgpu.url, runs.webgl2.url, [`WebGPU — ${name}, tick ${target}`, `WebGL2 — ${name}, tick ${target}`], `${name}.png`);
    assert.deepEqual(compared.sizes[0], compared.sizes[1], `${name}: both canvases have the same size`);
    assert.ok(compared.correlation > 0.85 && compared.meanDifference < 0.08 && compared.largeDifferenceShare < 0.03, `${name}: the two renderings agree (${JSON.stringify(compared)})`);
    report.examples[name] = {tick: target, stateHash: runs.webgl2.state.stateHash, webgpu: runs.webgpu.shot, webgl2: runs.webgl2.shot, compared, shapes: runs.webgl2.shapes, drawnMeshes: runs.webgl2.drawn};
    check(`${name}: same state hash on both renderers, both drawn, renderings agree`, {stateHash: runs.webgl2.state.stateHash, ...compared});
  }

  // 1b. Recipe labs that draw the renderer's soft surfaces and rope stream (GPU water, intact cloth, a cable, a metal
  // sheet). They run on wall time, so the two renderers are captured at different simulation states: both must
  // draw, and the pair is written side by side to be looked at, but no agreement is required.
  report.recipes = {};
  for (const lab of RECIPES) {
    const shots = {};
    for (const renderer of ['webgpu', 'webgl2']) {
      const {context, page} = await openLab(`lab=${lab}`, `${lab} ${renderer}`, {renderer, recipe: true});
      await page.waitForTimeout(4000);
      await page.evaluate(() => window.box3dLab.setPaused(true));
      assert.equal((await rendererInfo(page)).kind, renderer);
      const url = await readCanvas(page);
      shots[renderer] = {url, shot: await measure(page, [url])};
      assert.ok(shots[renderer].shot.lit > 0.2, `${lab} ${renderer}: the canvas is not blank`);
      await context.close();
    }
    await sideBySide(tools, shots.webgpu.url, shots.webgl2.url, [`WebGPU — lab=${lab}`, `WebGL2 — lab=${lab}`], `recipe-${lab}.png`);
    report.recipes[lab] = {webgpu: shots.webgpu.shot, webgl2: shots.webgl2.shot, compared: await measure(tools, [shots.webgpu.url, shots.webgl2.url])};
  }
  check('recipe labs with water, cloth, cable and sheet surfaces draw on both renderers', Object.fromEntries(Object.entries(report.recipes).map(([k, v]) => [k, v.compared.correlation])));

  // 2. The editor: select a domino by clicking it; the selection tint and the editor's frame lines are drawn.
  const editorShots = {};
  for (const renderer of ['webgpu', 'webgl2']) {
    const {context, page} = await openLab('example=domino-run&edit=1', `editor ${renderer}`, {renderer});
    await page.waitForFunction(() => window.box3dLab.editorState()?.active === true, null, {timeout: 180000});
    await pause(page);
    const at = await page.evaluate(() => window.box3dLab.editorScreenPosition('domino-6'));
    assert.ok(at && at.visible !== false, 'the domino is on screen');
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => window.box3dLab.editorState().selection.join() === 'domino-6', null, {timeout: 20000});
    await page.waitForFunction(() => window.box3dLab.editorState().overlayLines > 0, null, {timeout: 20000});
    const url = await readCanvas(page);
    const shot = await measure(page, [url]);
    assert.ok(shot.lit > 0.2, `editor ${renderer}: the canvas is not blank`);
    editorShots[renderer] = {url, shot, lines: (await page.evaluate(() => window.box3dLab.editorState().overlayLines))};
    await context.close();
  }
  const editorCompared = await measure(tools, [editorShots.webgpu.url, editorShots.webgl2.url]);
  await sideBySide(tools, editorShots.webgpu.url, editorShots.webgl2.url, ['WebGPU — editor, domino-6 selected', 'WebGL2 — editor, domino-6 selected'], 'editor-selection.png');
  assert.ok(editorCompared.correlation > 0.85 && editorCompared.meanDifference < 0.08 && editorCompared.largeDifferenceShare < 0.03, `editor: the two renderings agree (${JSON.stringify(editorCompared)})`);
  report.editor = {lines: editorShots.webgl2.lines, compared: editorCompared};
  // 2b. The editor with a coupled scene: its sections are listed, its fluid is drawn with the editor's lines.
  const coupledShots = {};
  for (const renderer of ['webgpu', 'webgl2']) {
    const {context, page} = await openLab('example=sphere-settling&edit=1', `editor coupled ${renderer}`, {renderer});
    await page.waitForFunction(() => window.box3dLab.editorState()?.active === true && window.box3dLab.sceneState().coupled === true, null, {timeout: 180000});
    await pause(page);
    assert.deepEqual((await page.evaluate(() => window.box3dLab.editorState())).coupled, ['fluids:syrup'], `editor coupled ${renderer}: the fluid section is listed`);
    const at = await page.evaluate(() => window.box3dLab.editorScreenPosition('ball'));
    assert.ok(at && at.visible !== false, 'the ball is on screen');
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => window.box3dLab.editorState().selection.join() === 'ball', null, {timeout: 20000});
    await page.waitForFunction(() => window.box3dLab.editorState().overlayLines > 0, null, {timeout: 20000});
    const url = await readCanvas(page);
    const shot = await measure(page, [url]);
    assert.ok(shot.lit > 0.2, `editor coupled ${renderer}: the canvas is not blank`);
    coupledShots[renderer] = {url, shot, draw: (await page.evaluate(() => window.box3dLab.sceneState().coupledDraw))};
    assert.equal(coupledShots[renderer].draw.fluidRows > 0, true, 'the fluid slice is drawn in the editor');
    await context.close();
  }
  const coupledCompared = await measure(tools, [coupledShots.webgpu.url, coupledShots.webgl2.url]);
  await sideBySide(tools, coupledShots.webgpu.url, coupledShots.webgl2.url, ['WebGPU — editor, sphere-settling, ball selected', 'WebGL2 — editor, sphere-settling, ball selected'], 'editor-coupled.png');
  assert.ok(coupledCompared.correlation > 0.85 && coupledCompared.meanDifference < 0.08 && coupledCompared.largeDifferenceShare < 0.03, `editor coupled: the two renderings agree (${JSON.stringify(coupledCompared)})`);
  report.editorCoupled = {compared: coupledCompared};
  check('editor: a coupled scene opens with its sections listed and its fluid drawn on both renderers', report.editorCoupled);
  check('editor: a clicked body is selected, tinted and framed on both renderers', report.editor);

  // 3. Selection at startup.
  {
    const auto = await openLab('example=domino-run', 'auto');
    const autoInfo = await rendererInfo(auto.page);
    assert.equal(autoInfo.kind, 'webgpu', 'with WebGPU available and no ?renderer, the Lab draws with WebGPU');
    await auto.context.close();
    const missing = await openLab('example=domino-run', 'no navigator.gpu', {withoutWebGPU: true});
    const missingInfo = await rendererInfo(missing.page);
    assert.equal(missingInfo.kind, 'webgl2', 'without navigator.gpu the Lab draws with WebGL2');
    assert.equal(missingInfo.note, 'WebGPU unavailable');
    const shot = await measure(missing.page, [await readCanvas(missing.page)]);
    assert.ok(shot.lit > 0.2, 'the WebGL2 fallback draws');
    await missing.context.close();
    report.selection = {auto: autoInfo.kind, withoutNavigatorGpu: missingInfo};
    check('startup: WebGPU when available, WebGL2 without navigator.gpu, WebGL2 with ?renderer=webgl2', report.selection);
  }

  // 4. A device loss mid-run, against a run that never loses its device.
  {
    const name = 'buoy-and-crates', at = 90, after = 150;
    const reference = await openLab(`example=${name}`, 'loss reference', {renderer: 'webgpu'});
    await pause(reference.page);
    const referenceAt = await advanceTo(reference.page, at), referenceAfter = await advanceTo(reference.page, after);
    await reference.context.close();

    const {context, page} = await openLab(`example=${name}`, 'loss', {renderer: null});
    await pause(page);
    await page.evaluate(() => { window.box3dLab.setPaused(false); });
    // Let it run on WebGPU for a moment, then pause at a known tick and drop the device.
    await page.waitForFunction(() => window.box3dLab.sceneState().tick >= 20, null, {timeout: 120000});
    const before = await advanceTo(page, at);
    assert.equal(before.stateHash, referenceAt.stateHash, 'the run matches the reference before the loss');
    const infoBefore = await rendererInfo(page);
    assert.equal(infoBefore.kind, 'webgpu');
    await page.evaluate(() => { window.box3dLab.setPaused(false); });
    assert.equal(await page.evaluate(() => window.box3dLab.simulateGraphicsLoss()), true);
    await page.waitForFunction(() => { const i = window.box3dLab.rendererInfo(); return i.kind === 'webgl2' && !i.recovering; }, null, {timeout: 60000});
    // It kept running while the renderer was replaced; pause and compare with the reference at the same tick.
    const resumed = await page.evaluate(() => { window.box3dLab.setPaused(true); return window.box3dLab.sceneState(); });
    assert.ok(resumed.tick >= at, 'the clock was not reset');
    const infoAfter = await rendererInfo(page);
    assert.deepEqual(infoAfter.camera, infoBefore.camera, 'the camera is kept');
    assert.equal(infoAfter.switches, 1);
    assert.equal(infoAfter.note, 'WebGPU device lost');
    assert.equal(await statusText(page), 'WebGL2');
    const end = await advanceTo(page, Math.max(after, resumed.tick));
    let expected = referenceAfter.stateHash;
    if (end.tick !== after) {
      const again = await openLab(`example=${name}`, 'loss reference 2', {renderer: 'webgpu'});
      await pause(again.page);
      expected = (await advanceTo(again.page, end.tick)).stateHash;
      await again.context.close();
    }
    assert.equal(end.stateHash, expected, 'after the switch the run reaches the state hash of a run that never lost its device');
    const lostShot = await readCanvas(page);
    const lostMeasure = await measure(page, [lostShot]);
    assert.ok(lostMeasure.lit > 0.2, 'the WebGL2 renderer draws after the loss');
    fs.writeFileSync(path.join(output, 'device-loss-after.png'), Buffer.from(lostShot.split(',')[1], 'base64'));
    report.screenshots.push(path.join(output, 'device-loss-after.png'));
    // And a lost WebGL2 context is replaced by a new one.
    assert.equal(await page.evaluate(() => window.box3dLab.simulateGraphicsLoss()), true);
    await page.waitForFunction(() => { const i = window.box3dLab.rendererInfo(); return i.switches === 2 && !i.recovering; }, null, {timeout: 60000});
    const relost = await rendererInfo(page);
    assert.equal(relost.kind, 'webgl2');
    assert.ok((await measure(page, [await readCanvas(page)])).lit > 0.2, 'drawn again after the WebGL2 context loss');
    await context.close();
    report.loss = {tickAtLoss: before.tick, tickAfterSwitch: resumed.tick, endTick: end.tick, stateHash: end.stateHash, camera: infoAfter.camera, afterContextLoss: relost.kind};
    check('device loss: WebGPU → WebGL2 mid-run with tick, camera and state kept; the run ends on the reference hash; a WebGL2 context loss recovers', report.loss);
  }

  // 5. Frame times while a scene runs (software rendering on SwiftShader).
  report.timings = {};
  for (const name of ['domino-run', 'buoy-and-crates']) {
    for (const renderer of ['webgpu', 'webgl2']) {
      const {context, page} = await openLab(`example=${name}`, `timing ${name} ${renderer}`, {renderer});
      const sample = await page.evaluate(() => new Promise((resolve) => {
        window.box3dLab.setPaused(false);
        window.__frameTimes = [];
        setTimeout(() => {
          const t = window.__frameTimes; window.__frameTimes = null;
          const d = t.slice(1).map((v, i) => v - t[i]).sort((a, b) => a - b);
          const renderCpu = document.getElementById('render-ms')?.textContent ?? '';
          resolve({frames: d.length, medianMs: +d[Math.floor(d.length / 2)].toFixed(1), p90Ms: +d[Math.floor(d.length * 0.9)].toFixed(1), renderCpu});
        }, 6000);
      }));
      report.timings[`${name} ${renderer}`] = sample;
      await context.close();
    }
  }
  check('frame times under SwiftShader (software, not GPU numbers)', report.timings);

  assert.deepEqual(report.errors, [], `console errors:\n${report.errors.join('\n')}`);
  check('no console errors, page errors or failed requests', {warnings: report.warnings});
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error instanceof Error ? error.stack : String(error);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, 'lab-webgl2-browser-check.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
console.log(`${report.ok ? 'PASS' : 'FAIL'}: ${report.checks.length} checks, ${report.errors.length} console errors, ${report.warnings} warnings. Output in ${output}`);
