// Runs the WebGPU compute backends (docs/GPU_COMPUTE.md) in a browser and writes a JSON report.
//
//   npm run build
//   node scripts/gpu-compute-browser-check.mjs [output directory] [--bench] [--hardware] [--only=name,name] [--sizes=256,512,1024] [--steps=30] [--no-cases]
//
// Default: headless Chromium with the software adapter (SwiftShader). That executes the compute shaders, so the
// validation is real; its timings say nothing about a GPU and are labelled so.
//   --hardware   use the machine's GPU instead (no SwiftShader flags). This is how real timings are measured:
//                  npm run build && node scripts/gpu-compute-browser-check.mjs out --hardware --bench
//                prints one table of ms per step and element updates per second per backend and size.
//   --bench      time the backends (sizes with --sizes, steps with --steps) instead of validating them.
//   --only       restrict the closed-form set-ups (names as in src/engine/gpu/shallow-water-cases.ts and granular-cases.ts).
//   --no-cases   skip the closed-form cases (agreement, repeatability and device loss only: about a minute).
//   --quick      of the granular closed-form cases, only the ones that take seconds (no Janssen, Beverloo, repose).
//   --no-granular, --no-shallow-water   leave a backend out.
//   --dist=path  serve this copy of the built site instead of ./dist (so that a rebuild cannot disturb a long run).
//   --showcase   instead: open the Lab's examples at scale (lab.html?example=sand-avalanche-100k, flood-valley-1m) at
//                small sizes (3000 grains, 96 x 96 cells; with --hardware the real ones; --showcase-sizes=grains,cells),
//                let them run, save captures of the canvas read back in the frame that drew it, and open one with
//                ?renderer=webgl2 to see the CPU example it falls back to. Look at the captures.
//
// It needs Playwright (from this repository or the global node_modules) and a Chromium with WebGPU; BOX3D_CHROMIUM
// names the executable (default /opt/pw-browsers/chromium when present). It is not in a gate, because the gates have
// no browser. What does not need a shader to run is tested in the gate: tests/engine/gpu-*.test.mjs (npm run test:gpu).
//
// The validation: every closed-form case of the float64 solver that the backend covers, against its closed form with
// its tolerance; the GPU against the float32 CPU reference and the float64 solver on short runs; the volume budget; a
// repeated run (identical bytes); a run with face speeds two steps old; and a device lost in mid-run. Exit code 1 when
// a case misses, a repeat differs, or the page reports an error.
import assert from 'node:assert/strict';
import {execSync} from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { try { playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); } catch { playwright = require('/opt/node-tools/node_modules/playwright'); } }
const {chromium} = playwright;

const args = process.argv.slice(2), flag = name => args.includes(`--${name}`), value = name => args.find(a => a.startsWith(`--${name}=`))?.split('=')[1];
const output = path.resolve(args.find(a => !a.startsWith('--')) ?? process.env.BOX3D_QA_OUTPUT ?? path.join(os.tmpdir(), 'box3d-gpu-compute'));
fs.mkdirSync(output, {recursive: true});
const hardware = flag('hardware'), bench = flag('bench');

const root = path.resolve(value('dist') ?? 'dist');
assert.ok(fs.existsSync(path.join(root, 'gpu-probe.html')), `${root}/gpu-probe.html is missing: run npm run build first`);
const mime = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml'};
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

const executable = process.env.BOX3D_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const software = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--use-vulkan=swiftshader'];
const browser = await chromium.launch({
  ...(executable ? {executablePath: executable} : {}),
  headless: !hardware || process.env.BOX3D_HEADED !== '1',
  args: ['--enable-unsafe-webgpu', '--no-sandbox', '--enable-features=Vulkan', ...(hardware ? ['--ignore-gpu-blocklist'] : software)],
});
const errors = [];
let exit = 0;
const number = (x, digits = 3) => (x === null || x === undefined || !Number.isFinite(x) ? '-' : Math.abs(x) >= 1e4 || (x !== 0 && Math.abs(x) < 1e-3) ? x.toExponential(digits - 1) : String(Number(x.toPrecision(digits))));
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { const text = message.text(); if (text.startsWith('[gpu] ')) console.log(text.slice(6)); else if (message.type() === 'error') errors.push(text); });
  page.on('response', (response) => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
  await page.goto(base + 'gpu-probe.html', {waitUntil: 'load'});
  await page.waitForFunction(() => !!window.box3dGpu, null, {timeout: 60000});
  const supported = await page.evaluate(() => window.box3dGpu.supported());
  assert.ok(supported, 'this browser has no WebGPU');
  const print = (head, rows) => {
    const widths = head.map((h, k) => Math.max(h.length, ...rows.map(r => String(r[k]).length)));
    const line = cells => cells.map((c, k) => String(c).padEnd(widths[k])).join('  ');
    console.log(line(head)); console.log(widths.map(w => '-'.repeat(w)).join('  ')); for (const r of rows) console.log(line(r));
  };
  if (flag('showcase')) {
    const sizes = (value('showcase-sizes') ?? (hardware ? '100000,1024' : '3000,96')).split(',').map(Number), result = {examples: {}, captures: []};
    const open = async (query, label) => {
      // A small canvas: on a software adapter the Lab's frame is what takes the time.
      const lab = await browser.newPage({viewport: hardware ? {width: 1440, height: 1000} : {width: 900, height: 820}});
      lab.setDefaultTimeout(0);
      lab.on('pageerror', error => errors.push(`${label}: pageerror: ${error.message}`));
      lab.on('console', (message) => { if (message.type() === 'error') errors.push(`${label}: ${message.text()}`); });
      await lab.addInitScript(() => { const original = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = callback => original((time) => { callback(time); const capture = window.__capture; if (capture) { window.__capture = null; capture(); } }); });
      await lab.goto(`${base}lab.html?${query}`, {waitUntil: 'load'});
      await lab.waitForFunction(() => window.box3dLab?.sceneState && (window.box3dLab.sceneState().gpuShowcase || window.box3dLab.sceneState().gpuShowcaseFallback), null, {timeout: 600000});
      return lab;
    };
    // The canvas in the frame that drew it (page.screenshot shows a blank WebGPU canvas).
    const capture = async (lab, name) => {
      const shot = await lab.evaluate(() => new Promise((resolve) => { let frames = 0; const arm = () => { window.__capture = () => { if (++frames < 3) { arm(); return; } const canvas = document.getElementById('gpu-canvas'), url = canvas.toDataURL('image/png'); const image = new Image();
        image.onload = () => { const copy = document.createElement('canvas'); copy.width = image.width; copy.height = image.height; const context = copy.getContext('2d'); context.drawImage(image, 0, 0); const data = context.getImageData(0, 0, copy.width, copy.height).data, colours = new Set(); for (let i = 0; i < data.length; i += 4 * 37) colours.add((data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | data[i + 2] >> 4); resolve({url, colours: colours.size}); }; image.src = url; }; }; arm(); }));
      const file = path.join(output, name); fs.writeFileSync(file, Buffer.from(shot.url.split(',')[1], 'base64')); result.captures.push(file);
      return shot.colours;
    };
    // Frames of 1/60 s taken between captures.
    const cases = [['sand-avalanche-100k', sizes[0], hardware ? [6, 54, 120] : [6, 24, 40]], ['flood-valley-1m', sizes[1], hardware ? [10, 590, 1800] : [10, 170, 300]]];
    for (const [name, n, stops] of cases) {
      const lab = await open(`example=${name}&n=${n}`, name), states = [];
      // Paused, then stepped without waiting for frames: on a software adapter a frame of the Lab takes seconds.
      await lab.evaluate(() => window.box3dLab.pauseGpuShowcase(true));
      for (const frames of stops) {
        const state = (await lab.evaluate(async (target) => { const lab = window.box3dLab; let s = lab.sceneState().gpuShowcase, taken = 0; while (s && !s.failed && taken < target) { const batch = Math.min(60, target - taken); s = (await lab.stepGpuShowcase(batch)).gpuShowcase; taken += batch; } return lab.sceneState(); }, frames)).gpuShowcase;
        const colours = await capture(lab, `${name}-${n}-frame-${frames}.png`);
        assert.ok(state && !state.failed, `${name}: ${state?.failed ?? 'the showcase did not start'}`);
        assert.ok(colours > 8, `${name}: the canvas is blank (${colours} colours)`);
        states.push({...state, colours});
        console.log(`${name} (${state.elements} elements, ${state.adapter}): step ${state.steps}, t = ${number(state.time)} s, ${number(state.msPerStep)} ms per step, ${JSON.stringify(state.stats)}`);
      }
      result.examples[name] = states;
      await lab.close();
    }
    // Without compute shaders the page opens the CPU example of the same kind.
    const fallback = await open('example=flood-valley-1m&renderer=webgl2', 'fallback');
    result.fallback = (await fallback.evaluate(() => window.box3dLab.sceneState())).gpuShowcaseFallback;
    assert.equal(result.fallback?.opened, 'dam-break-valley');
    console.log(`flood-valley-1m with ?renderer=webgl2: opened "${result.fallback.opened}" (${result.fallback.reason})`);
    await fallback.close();
    result.pageErrors = errors;
    fs.writeFileSync(path.join(output, 'gpu-showcase.json'), JSON.stringify(result, null, 2));
    console.log(`Captures:\n  ${result.captures.join('\n  ')}`);
  } else if (bench) {
    const sizes = (value('sizes') ?? (hardware ? '256,512,1024,2048' : '64,128,256')).split(',').map(Number), steps = Number(value('steps') ?? (hardware ? 60 : 6));
    const grains = (value('grains') ?? (hardware ? '10000,100000,400000,1000000' : '2000,8000')).split(',').map(Number);
    const result = await page.evaluate(options => window.box3dGpu.benchmark({...options, progress: text => console.log('[gpu] ' + text)}), {shallowWater: sizes, grains, steps, cpuLimit: hardware ? 262144 : 65536});
    const adapter = `${result.info.vendor} ${result.info.architecture} ${result.info.device} ${result.info.description}`.replace(/\s+/g, ' ').trim();
    console.log(`\nAdapter: ${adapter}${result.info.software ? '  (SOFTWARE ADAPTER: these timings are not those of a GPU)' : ''}\n`);
    print(['backend', 'size', 'substeps', 'ms/step', 'element updates/s', 'CPU ms/step', 'GPU/CPU'], result.rows.map(r => [r.backend, r.size, r.substeps, number(r.msPerStep), number(r.elementUpdatesPerSecond), number(r.cpuMsPerStep), r.speedup === null ? '-' : number(r.speedup) + ' x']));
    fs.writeFileSync(path.join(output, hardware ? 'gpu-compute-bench-hardware.json' : 'gpu-compute-bench-software.json'), JSON.stringify({adapter, software: result.info.software, hardwareFlag: hardware, ...result}, null, 2));
  } else {
    const only = value('only')?.split(',');
    const report = await page.evaluate(options => window.box3dGpu.validate({...options, progress: text => console.log('[gpu] ' + text)}), {only, cases: flag('no-cases') ? false : flag('quick') ? 'quick' : true, granular: !flag('no-granular'), shallowWater: !flag('no-shallow-water')});
    const adapter = `${report.info.vendor} ${report.info.architecture} ${report.info.device} ${report.info.description}`.replace(/\s+/g, ' ').trim();
    console.log(`\nAdapter: ${adapter}${report.info.software ? '  (software adapter)' : ''}; ${number(report.seconds)} s\n`);
    const tol = t => `${t.kind === 'upper' ? '<=' : t.kind === 'lower' ? '>=' : t.kind === 'absolute' ? '+-' : '+- rel'} ${number(t.value)}`;
    const failures = [];
    for (const [name, section] of Object.entries(report)) {
      if (!section || typeof section !== 'object' || !Array.isArray(section.cases)) continue;
      if (section.cases.length) { console.log(`${name}: closed forms`); print(['case', 'value', 'reference', 'tolerance', 'float64 tolerance', ''], section.cases.map(r => [r.id, number(r.value, 5), number(r.reference, 5), tol(r.tolerance), tol(r.float64), r.pass ? 'pass' : 'MISS'])); console.log(''); }
      for (const r of section.cases) if (!r.pass) failures.push(`${r.id}: ${r.value} against ${r.reference} (${tol(r.tolerance)})`);
      if (section.agreement?.length) {
        console.log(`${name}: GPU against the CPU`);
        print(['set-up', 'elements', 'steps', 'vs float32', 'vs float64', 'conservation', 'repeat'], section.agreement.map(a => [a.name, a.cells ?? a.grains, a.steps, number(a.gpuVsF32.depth ?? a.gpuVsF32.position), number(a.gpuVsF64.depth ?? a.gpuVsF64.position), number(a.volumeRelative ?? a.momentumRelative), a.repeat.identical ? 'identical' : 'DIFFERS']));
        console.log('');
        for (const a of section.agreement) if (!a.repeat.identical) failures.push(`${name} ${a.name}: a repeated run differs`);
      }
      if (section.deviceLoss) console.log(`${name}: device lost in mid-run: ${section.deviceLoss.backendBefore} -> ${section.deviceLoss.backendAfter}, ${section.deviceLoss.stepsRerun} steps run again on the CPU; against float64: ${number(section.deviceLoss.vsF64)}\n`);
      if (section.deviceLoss && section.deviceLoss.backendAfter !== 'cpu') failures.push(`${name}: the run did not fall back to the CPU`);
    }
    report.failures = failures; report.adapter = adapter; report.pageErrors = errors.filter(e => !/device.*(lost|destroyed)/i.test(e));
    fs.writeFileSync(path.join(output, 'gpu-compute-validation.json'), JSON.stringify(report, null, 2));
    console.log(failures.length ? `MISSES:\n  ${failures.join('\n  ')}` : 'Every case within tolerance.');
    if (failures.length || report.pageErrors.length) exit = 1;
    if (report.pageErrors.length) console.log(`Page errors:\n  ${report.pageErrors.join('\n  ')}`);
  }
  console.log(`Report in ${output}`);
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
process.exit(exit);
