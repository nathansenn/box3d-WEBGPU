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
// tests/physics/rigid-play.test.mjs and packages/box3d-kit/test/v22-rigid-*.test.mjs.
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
        let lit = 0, red = 0;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i] + data[i + 1] + data[i + 2] > 60) lit++;
          if (data[i] > 110 && data[i] > 1.9 * data[i + 1] && data[i] > 1.9 * data[i + 2]) red++;
          if ((i >> 2) % 37 === 0) colours.add((data[i] >> 4) << 8 | (data[i + 1] >> 4) << 4 | data[i + 2] >> 4);
        }
        resolve({url, width: image.width, height: image.height, lit: lit / (data.length / 4), red, colours: colours.size});
      };
      image.src = url;
    }; };
    arm();
  }));
  const file = path.join(output, name);
  fs.writeFileSync(file, Buffer.from(shot.url.split(',')[1], 'base64'));
  report.screenshots.push(file);
  return {width: shot.width, height: shot.height, lit: +shot.lit.toFixed(3), red: shot.red, colours: shot.colours};
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
  // The rigid-core examples. One Lab tick is 1/60 s: four steps of a 240 Hz scene.
  {name: 'course-stairs', address: 'lab.html?example=obstacle-course', ticks: 150, async verify(page) {
    const play = await page.evaluate(() => ({play: window.box3dLab.playState(), mark: document.getElementById('gpu-canvas').dataset.rigidPlay, title: window.box3dLab.sceneState().title}));
    assert.equal(play.mark, 'character'); assert.equal(play.play.kind, 'character'); assert.equal(play.play.manual, false);
    assert.ok(Math.abs(play.play.character.feet - 0.8) < 0.01 && play.play.character.position[0] > 5, `after 2.5 s the walker is on the deck, four stairs up (${JSON.stringify(play.play.character)})`);
    return play;
  }},
  {name: 'course-keys', address: 'lab.html?example=obstacle-course', ticks: 30, async verify(page) {
    // The keyboard, as a person would use it: the default view looks across the course, so right is along it and up is away from the camera.
    const before = await page.evaluate(() => window.box3dLab.playState().character.position);
    await page.keyboard.down('ArrowRight');
    const held = await page.evaluate(() => window.box3dLab.playState());
    assert.deepEqual(held.held, ['ArrowRight']); assert.equal(held.manual, true);
    await advance(page, 60);
    await page.keyboard.up('ArrowRight');
    const walked = await page.evaluate(() => window.box3dLab.playState());
    const dx = walked.character.position[0] - before[0], dz = walked.character.position[2] - before[2];
    assert.ok(Math.hypot(dx, dz) > 2.3 && Math.hypot(dx, dz) < 2.6 && dx > 2, `one second of the right arrow walks 2.5 m, mostly along the course (${dx}, ${dz})`);
    assert.deepEqual(walked.held, []);
    await page.keyboard.down('Space'); await advance(page, 1); await page.keyboard.up('Space');
    await advance(page, 14);
    const shot = await captureCanvas(page, 'course-keys-jump.png');
    const jumped = await page.evaluate(() => window.box3dLab.playState());
    assert.ok(!jumped.character.grounded && jumped.character.feet > 0.8, `Space jumps (${JSON.stringify(jumped.character)})`);
    // Space did not do what it does in other scenes (an impulse on every body), and D did not open the debug panel.
    return {walked: [dx, dz], jumpFeet: jumped.character.feet, shot};
  }},
  {name: 'course-platform', address: 'lab.html?example=obstacle-course', ticks: 440, async verify(page) {
    const play = await page.evaluate(() => window.box3dLab.playState());
    assert.ok(play.character.position[0] > 16.3 && play.character.position[0] < 20 && Math.abs(play.character.feet - 0.3) < 0.01, `at 7.3 s the walker is on the moving platform (${JSON.stringify(play.character)})`);
    return play.character;
  }},
  {name: 'vehicle', address: 'lab.html?example=vehicle-terrain', ticks: 480, async verify(page) {
    const info = await page.evaluate(() => ({play: window.box3dLab.playState(), camera: window.box3dLab.rendererInfo().camera, kinds: window.box3dLab.sceneState().kinds}));
    assert.equal(info.play.kind, 'vehicle');
    assert.ok(Math.abs(info.play.vehicle.forwardSpeed - 6.2) < 0.6 && info.play.vehicle.yawRate > 0.4, `after 8 s the car cruises on its circle (${JSON.stringify(info.play.vehicle)})`);
    // The camera follows the car: after the frames of the capture its target is on the way to it.
    const p = info.play.vehicle.position, t = info.camera.target;
    assert.ok(Math.hypot(p[0] - t[0], p[2] - t[2]) < 6, `the camera looks at the car (${p} against ${t})`);
    // Then the keys: full throttle and the left arrow for a second and a half.
    await page.keyboard.down('KeyW'); await page.keyboard.down('ArrowLeft');
    await advance(page, 90);
    await page.keyboard.up('KeyW'); await page.keyboard.up('ArrowLeft');
    const driven = await page.evaluate(() => window.box3dLab.playState());
    assert.ok(driven.manual && driven.vehicle.forwardSpeed > 7 && driven.vehicle.yawRate > 0.3, `W and left drive it faster round the bend (${JSON.stringify(driven.vehicle)})`);
    const shot = await captureCanvas(page, 'vehicle-keys.png');
    return {cruise: info.play.vehicle, driven: driven.vehicle, shot};
  }},
  {name: 'vehicle-webgl2', address: 'lab.html?example=vehicle-terrain&renderer=webgl2', ticks: 300, async verify(page) {
    const info = await page.evaluate(() => ({play: window.box3dLab.playState(), renderer: window.box3dLab.rendererInfo().kind}));
    assert.equal(info.renderer, 'webgl2'); assert.ok(info.play.vehicle.forwardSpeed > 5);
    return info.play.vehicle;
  }},
  {name: 'laser', address: 'lab.html?example=laser-scanner', ticks: 90, async verify(page, state, canvas) {
    const info = await page.evaluate(() => ({play: window.box3dLab.playState(), mark: document.getElementById('gpu-canvas').dataset.rigidPlay}));
    assert.equal(info.mark, 'watch'); assert.equal(info.play.lasers[0].rays, 96); assert.ok(info.play.lasers[0].hits > 40, `rays hit (${JSON.stringify(info.play.lasers)})`);
    assert.ok(canvas.red > 400, `the beams are drawn in red (${canvas.red} red pixels)`);
    return {lasers: info.play.lasers, red: canvas.red};
  }},
  {name: 'laser-webgl2', address: 'lab.html?example=laser-scanner&renderer=webgl2', ticks: 90, async verify(page, state, canvas) {
    const info = await page.evaluate(() => ({play: window.box3dLab.playState(), renderer: window.box3dLab.rendererInfo().kind}));
    assert.equal(info.renderer, 'webgl2'); assert.ok(info.play.lasers[0].hits > 40); assert.ok(canvas.red > 400, `the beams are drawn in red (${canvas.red} red pixels)`);
    return {lasers: info.play.lasers, red: canvas.red};
  }},
  {name: 'bullets', address: 'lab.html?example=bullet-plates', ticks: 12, async verify(page) {
    // A 60 Hz scene: one step per tick. After 12 steps the three lanes have ended as the scene says.
    const x = await page.evaluate(() => Object.fromEntries(window.box3dLab.sceneJson().bodies.filter(body => body.id.startsWith('ball-')).map(body => [body.id, body.position[0]])));
    assert.ok(x['ball-plain'] > 15 && x['ball-bullet'] > 6.1 && x['ball-bullet'] < 7.3 && x['ball-static'] < 6.1, `plain through, bullet and static stopped (${JSON.stringify(x)})`);
    assert.equal(await page.evaluate(() => window.box3dLab.playState()), null, 'nothing to play in this scene');
    // A second later the plate the bullet hit has been carried into its row; the plain lane stands untouched.
    await advance(page, 60);
    const shot = await captureCanvas(page, 'bullets-later.png');
    const later = await page.evaluate(() => Object.fromEntries(window.box3dLab.sceneJson().bodies.filter(body => /^plate-(plain|bullet)-0$/.test(body.id)).map(body => [body.id, body.position[0]])));
    assert.ok(Math.abs(later['plate-plain-0'] - 6.1) < 0.01 && later['plate-bullet-0'] > 6.5, `the bullet's plate moved, the plain one did not (${JSON.stringify(later)})`);
    return {balls: x, later, shot};
  }},
  {name: 'bridge-before', address: 'lab.html?example=breakable-bridge', ticks: 30, async verify(page) {
    const joints = await page.evaluate(() => window.box3dLab.sceneJson().joints.length);
    assert.equal(joints, 9, 'half a second in, the bridge carries itself on all nine welds');
    return {welds: joints};
  }},
  {name: 'bridge-after', address: 'lab.html?example=breakable-bridge&debug=joints', ticks: 150, async verify(page) {
    const info = await page.evaluate(() => { const scene = window.box3dLab.sceneJson(); return {welds: scene.joints.map(joint => joint.id), block: scene.bodies.find(body => body.id === 'block').position[1]}; });
    assert.deepEqual(info.welds, ['weld-0', 'weld-8'], 'the block broke the span; the two end welds are left');
    assert.ok(info.block < 0.6, 'the block is on the ground');
    return info;
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
    const result = await one.verify(page, state, canvas);
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
