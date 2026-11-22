// Scene sections on the GPU in the built Physics Lab (src/lab/gpu-scene.ts), in headless Chromium on SwiftShader.
//
//   npm run build
//   node scripts/lab-gpu-browser-check.mjs [output directory] [example,example,...]
//
// Not in a gate (the gates have no browser); the node test of the same code path is tests/physics/lab-gpu-scene.test.mjs.
// For each GPU example (default sphere-settling-gpu and hopper-seesaw-gpu):
//  1. node runs the same scene on the float32 CPU reference (gpuSceneBackends('reference')) with the same WASM world
//     and records the Lab's state hash (coupledStateHash: the world's transforms and every solver array the Lab draws)
//     after each step;
//  2. the page opens lab.html?example=<name>, the Lab is paused, and the scene is stepped one step at a time on WebGPU
//     compute (box3dLab.stepGpuScene): after every step the page's state hash must be the reference's at that tick
//     (the GPU gives the reference's bits); the canvas and the indicator are captured;
//  3. the compute device is destroyed (box3dLab.loseGpuCompute) and the scene stepped on: the Lab must say it fell
//     back, from which checkpoint, and after the fall back the state hash must again be the reference's at that tick
//     (the run carries on with the bits it would have had); captured again;
//  4. lab.html?example=<name>&gpu=off: the scene runs on the float64 CPU solvers and says why; its hash after the steps
//     is the CPU example's (the scene without its backend fields) stepped in node.
// No page error, console error or failed request may happen. Writes lab-gpu-browser-check.json and PNG captures.
import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }
const {chromium} = playwright;

const output = path.resolve(process.argv.slice(2).find(a => !a.startsWith('--')) ?? path.join(os.tmpdir(), 'box3d-lab-gpu'));
fs.mkdirSync(output, {recursive: true});
const args = process.argv.slice(2).filter(a => !a.startsWith('--'));
const EXAMPLES = (args[1] ?? 'sphere-settling-gpu,hopper-seesaw-gpu').split(',');
/** Steps compared on the GPU before the loss, and after it. */
const BEFORE = Number(process.env.BOX3D_GPU_STEPS ?? 8), AFTER = Number(process.env.BOX3D_GPU_AFTER ?? 6);

// ---- the reference in node ----
const {NativeWorldPool} = await import('../src/engine/native-world.ts');
const {gpuSceneBackends} = await import('../src/engine/gpu/scene-backends.ts');
const {loadLabScene} = await import('../src/lab/scene-host.ts');
const {coupledStateHash} = await import('../src/lab/coupled-scene.ts');
const {GPU_EXAMPLE_SCENES} = await import('../src/lab/scene-loading.ts');
const {withoutGpuSections} = await import('../src/lab/gpu-scene.ts');
const {default: factory} = await import(pathToFileURL(path.resolve('public/box3d/box3d.js')).href);
const pool = new NativeWorldPool(await factory({wasmBinary: fs.readFileSync(path.resolve('public/box3d/box3d.wasm'))}));
/** The Lab's state hash after each of `steps` steps (index 0: the start), on the reference or (cpu) on the float64 solvers. */
async function referenceHashes(scene, steps, cpu = false) {
  const world = pool.createWorld();
  try {
    world.retainBodyShapes(true);
    const loaded = loadLabScene(world, cpu ? withoutGpuSections(scene) : scene, cpu ? {} : {gpu: gpuSceneBackends('reference')}), hashes = [coupledStateHash(loaded)];
    for (let i = 0; i < steps; i++) {
      if (cpu) loaded.simulation.step(); else { await loaded.simulation.stepAsync(); await loaded.simulation.pullAsync(); }
      hashes.push(coupledStateHash(loaded));
    }
    loaded.simulation.dispose();
    return hashes;
  } finally { world.destroy(); }
}

// ---- the page ----
const root = path.resolve('dist');
assert.ok(fs.existsSync(path.join(root, 'lab.html')), 'dist/lab.html is missing: run npm run build first');
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.ktx2': 'image/ktx2', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'};
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
const report = {base, output, date: new Date().toISOString(), load: os.loadavg(), examples: {}, checks: [], errors: [], screenshots: []};
const check = (name, value) => { report.checks.push({name, value}); console.log(`ok  ${name}${value === undefined ? '' : `: ${typeof value === 'string' ? value : JSON.stringify(value)}`}`); };
const executable = process.env.BOX3D_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  ...(executable ? {executablePath: executable} : {}),
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--no-sandbox', '--enable-features=Vulkan', '--use-vulkan=swiftshader'],
});
async function newPage(context, label) {
  const page = await context.newPage();
  page.setDefaultNavigationTimeout(300000);
  page.setDefaultTimeout(600000);
  page.on('pageerror', error => report.errors.push(`${label}: pageerror: ${error.message}`));
  page.on('console', message => { if (message.type() === 'error') report.errors.push(`${label}: ${message.text()}`); });
  page.on('response', response => { if (response.status() >= 400) report.errors.push(`${label}: ${response.status()} ${response.url()}`); });
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => original((time) => { callback(time); const capture = window.__capture; if (capture) { window.__capture = null; capture(); } });
  });
  return page;
}
/** The canvas as a PNG (page.screenshot shows a blank WebGPU canvas), with the share of lit pixels and the colours. */
async function captureCanvas(page, name) {
  const shot = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const arm = () => { window.__capture = () => {
      if (++frames < 3) { arm(); return; }
      const canvas = document.getElementById('gpu-canvas'), url = canvas.toDataURL('image/png'), image = new Image();
      image.onload = () => {
        const copy = document.createElement('canvas'); copy.width = image.width; copy.height = image.height;
        const context = copy.getContext('2d'); context.drawImage(image, 0, 0);
        const data = context.getImageData(0, 0, copy.width, copy.height).data, colours = new Set();
        let lit = 0;
        for (let i = 0; i < data.length; i += 4) { if (data[i] + data[i + 1] + data[i + 2] > 60) lit++; if ((i >> 2) % 37 === 0) colours.add((data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | data[i + 2] >> 4); }
        resolve({url, width: image.width, height: image.height, lit: lit / (data.length / 4), colours: colours.size});
      };
      image.src = url;
    }; };
    arm();
  }));
  const file = path.join(output, name);
  fs.writeFileSync(file, Buffer.from(shot.url.split(',')[1], 'base64'));
  report.screenshots.push(file);
  return {file, lit: +shot.lit.toFixed(3), colours: shot.colours};
}
const opened = page => page.waitForFunction(() => window.box3dLab?.sceneState().loaded === true && window.box3dLab.sceneState().coupled === true, null, {timeout: 300000});
const indicator = page => page.evaluate(() => document.getElementById('gpu-scene-readout')?.textContent ?? null);

try {
  for (const name of EXAMPLES) {
    const scene = GPU_EXAMPLE_SCENES[name]();
    assert.ok(scene, `unknown GPU example ${name}`);
    const started = Date.now();
    const hashes = await referenceHashes(scene, BEFORE + AFTER + 40);
    const entry = report.examples[name] = {referenceSeconds: (Date.now() - started) / 1000, steps: []};
    const context = await browser.newContext({viewport: {width: 1280, height: 800}});
    const page = await newPage(context, name);
    await page.goto(`${base}lab.html?example=${name}`);
    await opened(page);
    // Paused, the Lab's clock starts no step; one that started before the pause is waited for by the first stepGpuScene.
    let state = await page.evaluate(() => { window.box3dLab.setPaused(true); return window.box3dLab.sceneState(); });
    entry.opened = state.gpuScene;
    assert.equal(state.gpuScene?.mode, 'gpu', `${name}: the GPU sections run on WebGPU compute (${JSON.stringify(state.gpuScene)})`);
    check(`${name}: on WebGPU compute`, `${state.gpuScene.adapter}${state.gpuScene.software ? ' (software)' : ''}`);
    for (let i = 0; i < BEFORE; i++) {
      const t0 = Date.now();
      state = await page.evaluate(() => window.box3dLab.stepGpuScene(1));
      const tick = state.simulationTick, same = state.stateHash === hashes[tick];
      entry.steps.push({tick, hash: state.stateHash, reference: hashes[tick], same, seconds: (Date.now() - t0) / 1000});
      assert.ok(tick <= hashes.length - 1, `${name}: tick ${tick} is beyond the reference run`);
      assert.ok(same, `${name}: step ${tick} on the GPU has the state hash ${state.stateHash}, the reference ${hashes[tick]}`);
    }
    check(`${name}: ${BEFORE} steps on the GPU, each with the reference's state hash`, `ticks ${entry.steps[0].tick} to ${entry.steps.at(-1).tick}, ${entry.steps.map(s => s.seconds.toFixed(1)).join(' ')} s`);
    entry.indicatorGpu = await indicator(page);
    assert.match(entry.indicatorGpu ?? '', /WebGPU compute/);
    entry.captureGpu = await captureCanvas(page, `${name}-gpu.png`);
    assert.ok(entry.captureGpu.lit > 0.2 && entry.captureGpu.colours > 20, `${name}: the canvas is not blank (${JSON.stringify(entry.captureGpu)})`);
    check(`${name}: indicator`, entry.indicatorGpu);
    // The compute device is lost; the drawing device is not.
    assert.equal(await page.evaluate(() => window.box3dLab.loseGpuCompute()), true);
    const after = [];
    for (let i = 0; i < AFTER; i++) {
      state = await page.evaluate(() => window.box3dLab.stepGpuScene(1));
      after.push({tick: state.simulationTick, same: state.stateHash === hashes[state.simulationTick]});
    }
    entry.afterLoss = {state: state.gpuScene, steps: after};
    assert.equal(state.gpuScene.mode, 'reference', `${name}: after the loss the sections run on the reference`);
    assert.ok(state.gpuScene.fallback && state.gpuScene.fallback.stepsRerun >= 0, `${name}: the Lab reports the fall back`);
    assert.ok(after.every(s => s.same), `${name}: after the fall back every step has the reference's state hash (${JSON.stringify(after)})`);
    entry.indicatorFallback = await indicator(page);
    assert.match(entry.indicatorFallback ?? '', /lost.*reference/);
    entry.captureFallback = await captureCanvas(page, `${name}-after-loss.png`);
    assert.ok(entry.captureFallback.lit > 0.2, `${name}: the canvas is drawn after the loss`);
    check(`${name}: device destroyed at step ${state.gpuScene.fallback.atTick}`, `carried on from the checkpoint at step ${state.gpuScene.fallback.resumedFrom} (${state.gpuScene.fallback.stepsRerun} steps again); ${AFTER} more steps with the reference's hashes; "${entry.indicatorFallback}"`);
    await context.close();

    // ?gpu=off: the float64 CPU solvers, and the reason.
    const cpuContext = await browser.newContext({viewport: {width: 1280, height: 800}});
    const cpuPage = await newPage(cpuContext, `${name}&gpu=off`);
    await cpuPage.goto(`${base}lab.html?example=${name}&gpu=off`);
    await opened(cpuPage);
    const cpu = await cpuPage.evaluate(() => { window.box3dLab.setPaused(true); const s = window.box3dLab.sceneState(); return window.box3dLab.stepSceneTo(s.tick + 5); });
    const cpuHashes = await referenceHashes(scene, cpu.simulationTick, true);
    entry.cpu = {gpuScene: cpu.gpuScene, tick: cpu.simulationTick, same: cpu.stateHash === cpuHashes[cpu.simulationTick], indicator: await indicator(cpuPage)};
    assert.equal(cpu.gpuScene?.mode, 'cpu');
    assert.ok(entry.cpu.same, `${name}&gpu=off: the float64 run has the CPU example's state hash`);
    assert.match(entry.cpu.indicator ?? '', /float64 CPU solvers.*gpu=off/);
    check(`${name}&gpu=off: float64 CPU, step ${cpu.simulationTick} has the CPU example's hash`, entry.cpu.indicator);
    await cpuContext.close();
  }
  assert.deepEqual(report.errors, [], 'no page errors, console errors or failed requests');
  report.ok = true;
} catch (error) {
  report.ok = false; report.failure = error instanceof Error ? error.stack : String(error);
  throw error;
} finally {
  fs.writeFileSync(path.join(output, 'lab-gpu-browser-check.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
console.log(`lab GPU scenes: ${EXAMPLES.join(', ')} passed; report ${path.join(output, 'lab-gpu-browser-check.json')}`);
