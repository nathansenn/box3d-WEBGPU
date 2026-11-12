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
// that no page error, console error or failed request happened. A scene with solids is also captured once per
// field of the colour ramp (stress, temperature, damage), with the displacements magnified where cracks are tiny, and a
// scene with fluids once per fluid field (speed, pressure), with the fluid readout (Courant number, coupled bodies).
//
// Then the scene editor with a coupled scene (EDITOR_EXAMPLE, sphere-settling by default; set it to '' to skip):
// lab.html?example=<name>&edit=1 opens in the editor, the outline lists the coupled section, a body the section names is
// moved by typing its position, a section value (the fluid's viscosity) is set in the outline, an invalid value is
// refused with the validator's message, undo twice returns to the opened scene hash, the share link of the edited
// document carries the section byte for byte, and the editor's panel and the canvas are captured.
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
const EXAMPLES = (process.argv[3] ?? 'buoy-and-crates,trampoline,hopper-seesaw,suspended-platform,moored-buoy,cable-stayed-deck,rubber-pad,notched-beam,quenched-plate,heated-bar,sphere-settling,cavity-flow,flow-past-cylinder,dam-break').split(',');
/** Lab ticks to advance before the first capture, and after reopening a link. */
const FIRST = {'hopper-seesaw': 180, trampoline: 90, 'rubber-pad': 60, 'notched-beam': 60, 'quenched-plate': 150, 'heated-bar': 300, 'sphere-settling': 45, 'cavity-flow': 300, 'flow-past-cylinder': 300, 'dam-break': 40}, SHARE_TICKS = 30;
/** Fluids: the fields captured. */
const FLUID_VIEWS = {'sphere-settling': ['speed', 'pressure'], 'cavity-flow': ['speed', 'pressure'], 'flow-past-cylinder': ['speed', 'pressure'], 'dam-break': ['speed', 'pressure']};
/** Solids: the fields captured and the displacement scale for each. */
const SOLID_VIEWS = {'notched-beam': [['stress', 1], ['damage', 1], ['damage', 100]], 'quenched-plate': [['temperature', 1], ['stress', 1], ['damage', 100]], 'heated-bar': [['temperature', 1], ['stress', 1]], 'rubber-pad': [['stress', 1]]};

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
    const solidShots = [];
    for (const [field, scale] of SOLID_VIEWS[name] ?? []) {
      const view = await page.evaluate(options => window.box3dLab.setSolidView(options), {field, scale});
      assert.deepEqual(view, {field, scale}, `${name}: the solid view is set`);
      const shot = await captureCanvas(page, `${name}-${field}-x${scale}.png`);
      assert.ok(shot.lit > 0.2, `${name}: the ${field} capture is not blank`);
      solidShots.push({field, scale, ...shot, solids: (await page.evaluate(() => window.box3dLab.sceneState().solidView)).solids});
    }
    if (solidShots.length) await page.evaluate(() => window.box3dLab.setSolidView({field: 'stress', scale: 1}));
    const fluidShots = [];
    for (const field of FLUID_VIEWS[name] ?? []) {
      const view = await page.evaluate(options => window.box3dLab.setFluidView(options), {field});
      assert.deepEqual(view, {field}, `${name}: the fluid view is set`);
      const shot = await captureCanvas(page, `${name}-${field}.png`);
      assert.ok(shot.lit > 0.2 && shot.colours > 20, `${name}: the ${field} capture is not blank`);
      const fluids = (await page.evaluate(() => window.box3dLab.sceneState().fluidView)).fluids;
      assert.ok(fluids.every(f => Number.isFinite(f.min) && Number.isFinite(f.max) && f.max > f.min && f.courant < 1.5), `${name}: the fluid readout is finite (${JSON.stringify(fluids)})`);
      fluidShots.push({field, ...shot, fluids});
    }
    if (fluidShots.length) {
      await page.evaluate(() => window.box3dLab.setFluidView({field: 'speed'}));
      const draw = (await page.evaluate(() => window.box3dLab.sceneState().coupledDraw));
      assert.ok(draw.fluidRows > 0 || draw.particleRows > 0, `${name}: the fluid is drawn (${JSON.stringify(draw)})`);
    }
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
      canvas, solidShots, fluidShots, readoutStepMs: readout.stepMs, link: link.length, latestEvents: readout.events,
      share: {sceneHash: a.state.sceneHash, simulationTick: a.state.simulationTick, stateHash: a.state.stateHash},
    };
    check(`${name}: opens, steps, draws, and its share link reopens the same twice`, {canvas, msPerStep: report.examples[name].stepped.msPerStep, share: report.examples[name].share});
  }
  const editorExample = process.env.EDITOR_EXAMPLE ?? 'sphere-settling';
  if (editorExample) {
    const context = await browser.newContext({viewport: {width: 1280, height: 800}});
    const page = await newPage(context, `editor ${editorExample}`);
    await page.goto(`${base}lab.html?example=${editorExample}&edit=1`);
    await page.waitForFunction(() => window.box3dLab?.editorState()?.active === true && window.box3dLab.sceneState().coupled === true, null, {timeout: 240000});
    const editor = () => page.evaluate(() => window.box3dLab.editorState());
    const sections = () => page.evaluate(() => { const scene = window.box3dLab.sceneJson(); const out = {}; for (const key of ['water', 'cables', 'frames', 'cloths', 'grains', 'solids', 'heat', 'fluids']) if (scene[key]) out[key] = scene[key]; return out; });
    const opened = await editor(), openedSections = await sections();
    assert.ok(opened.coupled.length > 0, `${editorExample}: the outline lists the coupled sections`);
    assert.equal(await page.locator('#lab-editor-coupled').isVisible(), true, 'the coupled sections are shown in the outline');
    const setField = async (selector, value) => {
      const before = (await editor()).messages;
      await page.fill(selector, String(value));
      await page.keyboard.press('Tab');
      await page.waitForFunction(old => window.box3dLab.editorState().messages !== old, before, {timeout: 60000});
    };
    // Move the first body a section names by typing its position.
    const target = (await page.evaluate(() => window.box3dLab.sceneJson())).bodies[0];
    await page.click(`#lab-editor-item-${target.id}`);
    await page.waitForFunction(id => window.box3dLab.editorState().selection.join() === id, target.id, {timeout: 20000});
    await setField('#lab-editor-position-x', target.position[0] + 0.01);
    const moved = await editor();
    assert.equal(moved.error, false, moved.message);
    assert.notEqual(moved.sceneHash, opened.sceneHash, 'the move changed the scene');
    assert.deepEqual(await sections(), openedSections, 'a move keeps the coupled sections as they were');
    // A section value: the first editable field of the coupled outline.
    const field = await page.evaluate(() => { const input = document.querySelector('#lab-editor-coupled input[type=number]'); return input ? {id: input.id, value: Number(input.value)} : null; });
    assert.ok(field, 'a section value can be set in the outline');
    await setField(`#${field.id}`, field.value * 0.8);
    const edited = await editor();
    assert.equal(edited.error, false, edited.message);
    assert.notDeepEqual(await sections(), openedSections, 'the section value changed');
    await page.waitForTimeout(400);
    await captureCanvas(page, `editor-${editorExample}.png`);
    await page.locator('#lab-editor-details-outline').screenshot({path: path.join(output, `editor-${editorExample}-outline.png`)});
    report.screenshots.push(path.join(output, `editor-${editorExample}-outline.png`));
    await setField(`#${field.id}`, -1);
    const refused = await editor();
    assert.equal(refused.error, true, 'a negative value is refused');
    assert.match(refused.message, /must be >= 0/);
    // The share link of the edited document, then undo twice back to the scene as opened.
    await page.click('#lab-scene-copy');
    await page.waitForFunction(() => typeof window.box3dLab.lastShareLink() === 'string', null, {timeout: 60000});
    const link = await page.evaluate(() => window.box3dLab.lastShareLink());
    await page.click('#lab-editor-undo'); await page.click('#lab-editor-undo');
    await page.waitForFunction(hash => window.box3dLab.editorState().sceneHash === hash, opened.sceneHash, {timeout: 60000});
    assert.deepEqual(await sections(), openedSections, 'undo returns the sections as they were');
    await context.close();
    const fresh = await browser.newContext({viewport: {width: 1280, height: 800}});
    const viewer = await newPage(fresh, `editor ${editorExample} link`);
    await viewer.goto(link);
    await loaded(viewer);
    // The page opened from the link holds the edited document: same scene hash (its sceneJson would be the live state).
    const reopened = await viewer.evaluate(() => window.box3dLab.sceneState().sceneHash);
    await fresh.close();
    assert.equal(reopened, edited.sceneHash, 'the link of the edited scene carries it, sections included');
    report.editor = {example: editorExample, coupled: opened.coupled, field: field.id, opened: opened.sceneHash, moved: moved.sceneHash, edited: edited.sceneHash, refused: refused.message, link: link.length};
    check(`editor: ${editorExample} opens with its sections listed, a named body moves, a section value is set and refused, undo and the link keep the sections`, report.editor);
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
