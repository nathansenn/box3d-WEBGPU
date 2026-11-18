// Drives the scene editor of the built Lab in headless Chromium with software WebGPU.
//
//   npm run build:pages
//   node scripts/scene-editor-browser-check.mjs [output directory]
//
// It needs Playwright (resolved from this repository or from the global node_modules) and a Chromium
// with WebGPU; BOX3D_CHROMIUM names the executable (default /opt/pw-browsers/chromium when present).
// It is not in a gate, because the gates do not have a browser. The node tests of the editor's model
// are tests/physics/scene-editor.test.mjs.
//
// What it does: builds a scene with the editor's controls (three bodies and a hinge), edits sizes and
// a material, undoes and redoes, drags a body, plays, measures, resets, copies the share link, opens
// the link in a fresh page and compares the scene hash and the replay hash after N steps; then a
// keyboard-only pass (add, select, move, delete, undo) and a 390 px wide phone pass. The canvas is
// read back with toDataURL in the frame that drew it; panels are screenshots.
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

const output = path.resolve(process.argv[2] ?? process.env.BOX3D_QA_OUTPUT ?? path.join(os.tmpdir(), 'box3d-scene-editor'));
fs.mkdirSync(output, {recursive: true});
const root = path.resolve('dist');
assert.ok(fs.existsSync(path.join(root, 'lab.html')), 'dist/lab.html is missing: run npm run build:pages first');
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

const STEPS = 180;
const report = {base, output, steps: STEPS, checks: [], errors: [], warnings: [], screenshots: []};
const check = (name, value) => { report.checks.push({name, value}); console.log(`ok  ${name}${value === undefined ? '' : `: ${typeof value === 'string' ? value : JSON.stringify(value)}`}`); };
const executable = process.env.BOX3D_CHROMIUM ?? (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch({
  ...(executable ? {executablePath: executable} : {}),
  args: ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-gpu-compositing', '--no-sandbox', '--enable-features=Vulkan', '--use-vulkan=swiftshader'],
});

async function newPage(context, label) {
  const page = await context.newPage();
  // Software rendering on a shared machine: nothing here depends on how long a step takes.
  page.setDefaultNavigationTimeout(240000);
  page.setDefaultTimeout(120000);
  page.on('pageerror', error => report.errors.push(`${label}: pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') report.errors.push(`${label}: ${message.text()}`);
    if (message.type() === 'warning') report.warnings.push(`${label}: ${message.text()}`);
  });
  page.on('response', (response) => { if (response.status() >= 400) report.errors.push(`${label}: ${response.status()} ${response.url()}`); });
  // Read the canvas in the task of the app's own frame callback: afterwards the WebGPU frame is gone.
  await page.addInitScript(() => {
    const original = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => original((time) => { callback(time); const capture = window.__capture; if (capture) { window.__capture = null; capture(); } });
  });
  return page;
}
const editor = page => page.evaluate(() => window.box3dLab.editorState());
const scene = page => page.evaluate(() => window.box3dLab.sceneJson());
const waitEditor = (page, predicate, arg) => page.waitForFunction(predicate, arg, {timeout: 60000});
const openEditor = async (page, query) => {
  await page.goto(`${base}lab.html?${query}`);
  await page.waitForFunction(() => window.box3dLab?.editorState()?.active === true, null, {timeout: 180000});
};
/** The canvas as a PNG file, with how much of it has the selection's orange and its line yellow. */
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
        const data = context.getImageData(0, 0, copy.width, copy.height).data;
        let lit = 0, orange = 0;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i], g = data[i + 1], b = data[i + 2];
          if (r + g + b > 60) lit++;
          if (r > 150 && g > 60 && g < r * 0.8 && b < g * 0.6) orange++;
        }
        resolve({url, width: image.width, height: image.height, lit: lit / (data.length / 4), orange});
      };
      image.src = url;
    }; };
    arm();
  }));
  const file = path.join(output, name);
  fs.writeFileSync(file, Buffer.from(shot.url.split(',')[1], 'base64'));
  report.screenshots.push(file);
  return {width: shot.width, height: shot.height, lit: shot.lit, orange: shot.orange};
}
async function screenshot(page, name, locator) {
  const file = path.join(output, name);
  if (locator) await page.locator(locator).screenshot({path: file}); else await page.screenshot({path: file});
  report.screenshots.push(file);
}
/** Type a value into a number or text field of the inspector and commit it with Tab. */
async function setField(page, id, value) {
  const before = (await editor(page)).messages;
  await page.fill(`#lab-editor-${id}`, String(value));
  await page.keyboard.press('Tab');
  await page.waitForFunction(old => window.box3dLab.editorState().messages !== old, before, {timeout: 20000});
  await page.waitForTimeout(60);
}
const bodyById = (json, id) => json.bodies.find(body => body.id === id);
const close = (actual, expected, tolerance, what) => assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: ${actual} vs ${expected}`);

try {
  // -------------------------------------------------------------------------------------------
  // 1. Desktop, 1440 x 900: build, edit, undo, play, measure, reset, share.
  // -------------------------------------------------------------------------------------------
  const desktop = await browser.newContext({viewport: {width: 1440, height: 900}});
  await desktop.grantPermissions(['clipboard-read', 'clipboard-write']);
  const page = await newPage(desktop, 'desktop');
  await openEditor(page, 'edit=1');
  let state = await editor(page);
  assert.deepEqual([state.mode, state.bodies, state.joints, state.recovery, state.canUndo], ['edit', [], [], false, false]);
  assert.equal((await page.evaluate(() => window.box3dLab.sceneState())).source, 'editor');
  assert.equal(new URL(page.url()).searchParams.get('edit'), '1');
  check('lab.html?edit=1 opens an empty SI scene in the editor', state.sceneHash);

  // Three bodies, by the Add controls. Each lands on what is below the point the camera looks at.
  for (const [preset, id] of [['box', 'box-1'], ['sphere', 'sphere-1'], ['capsule', 'capsule-1']]) {
    await page.selectOption('#lab-editor-add-shape', preset);
    await page.click('#lab-editor-add-body');
    await waitEditor(page, wanted => window.box3dLab.editorState().selection[0] === wanted, id);
  }
  let json = await scene(page);
  assert.deepEqual(json.bodies.map(body => [body.id, body.position]), [['box-1', [0, 0.5, 0]], ['sphere-1', [0, 1.5, 0]], ['capsule-1', [0, 2.75, 0]]], 'surface snapping stacked them');
  check('three bodies added; each rests on the one below', json.bodies.map(body => body.position[1]));

  // Select the box in the outline, then edit name, type, position and size in the inspector.
  await page.click('#lab-editor-item-box-1');
  await waitEditor(page, () => window.box3dLab.editorState().selection.join() === 'box-1');
  await page.waitForSelector('#lab-editor-name');
  await setField(page, 'name', 'post');
  await page.selectOption('#lab-editor-type', 'static');
  await waitEditor(page, () => window.box3dLab.sceneJson().bodies[0].type === 'static');
  await setField(page, 'position-y', 3);
  await setField(page, 'size-x', 0.4);
  await setField(page, 'size-y', 0.4);
  await setField(page, 'size-z', 0.4);
  // The capsule becomes an arm lying along x beside the post.
  await page.click('#lab-editor-item-capsule-1');
  await page.waitForSelector('#lab-editor-length');
  await setField(page, 'name', 'arm');
  await setField(page, 'rotation-z', 90);
  await setField(page, 'position-x', 1);
  await setField(page, 'position-y', 3);
  await setField(page, 'radius', 0.15);
  await setField(page, 'length', 1.2);
  await page.selectOption('#lab-editor-material', 'steel');
  await waitEditor(page, () => window.box3dLab.sceneJson().bodies[2].material === 'steel');
  // The sphere: rubber, and a custom restitution, which makes the material custom.
  await page.click('#lab-editor-item-sphere-1');
  await page.waitForSelector('#lab-editor-radius');
  await setField(page, 'name', 'ball');
  await setField(page, 'position-x', -2);
  await setField(page, 'position-y', 0.3);
  await setField(page, 'radius', 0.3);
  await page.selectOption('#lab-editor-material', 'rubber');
  await waitEditor(page, () => window.box3dLab.sceneJson().bodies[1].material === 'rubber');
  json = await scene(page);
  assert.deepEqual(json.materials.rubber, {density: 1100, friction: 0.9, restitution: 0.8, color: 0x2F3336});
  assert.deepEqual(bodyById(json, 'post').shape.halfExtents, [0.2, 0.2, 0.2]);
  assert.deepEqual([bodyById(json, 'arm').shape.radius, bodyById(json, 'arm').shape.halfLength, bodyById(json, 'arm').material], [0.15, 0.6, 'steel']);
  close(Math.hypot(...bodyById(json, 'arm').rotation), 1, 1e-3, 'the rotation is stored as a unit quaternion');
  close(bodyById(json, 'arm').rotation[2], Math.SQRT1_2, 1e-6, '90 degrees about z');
  assert.equal(bodyById(json, 'arm').rotationEuler, undefined);
  check('names, type, sizes, rotation (degrees in, quaternion out) and materials edited by numeric entry');

  // A refusal: a radius of 0 is the validator's to refuse; the field goes back to its value.
  await setField(page, 'radius', 0);
  state = await editor(page);
  assert.equal(state.error, true);
  assert.match(state.message, /Not changed\. \/bodies\/1\/shape\/radius: /);
  await page.waitForFunction(() => document.getElementById('lab-editor-radius').value === '0.3');
  assert.equal(bodyById(await scene(page), 'ball').shape.radius, 0.3);
  check('an invalid edit is refused with the validator\'s message', state.message);

  // A hinge between the post and the arm: select both, add, then set the anchor and limits.
  await page.click('#lab-editor-item-post');
  await page.click('#lab-editor-item-arm', {modifiers: ['Shift']});
  await waitEditor(page, () => window.box3dLab.editorState().selection.join() === 'post,arm');
  await page.selectOption('#lab-editor-add-joint-type', 'revolute');
  await page.waitForFunction(() => !document.getElementById('lab-editor-add-joint').disabled);
  await page.click('#lab-editor-add-joint');
  await waitEditor(page, () => window.box3dLab.editorState().selection.join() === 'revolute-1');
  await page.waitForSelector('#lab-editor-anchor-x');
  await setField(page, 'name', 'hinge');
  await setField(page, 'anchor-x', 0.25);
  await page.check('#lab-editor-limits-on');
  await page.waitForSelector('#lab-editor-limit-lower');
  await setField(page, 'limit-lower', -120);
  await setField(page, 'limit-upper', 120);
  json = await scene(page);
  const hinge = json.joints[0];
  assert.deepEqual([hinge.id, hinge.type, hinge.bodyA, hinge.bodyB], ['hinge', 'revolute', 'post', 'arm']);
  close(hinge.limits.upper, 120 * Math.PI / 180, 1e-6, 'limits are degrees in the editor and radians in the file');
  assert.deepEqual(hinge.frameA.position, [0.25, 0, 0]);
  check('a hinge added between two selected bodies, with its anchor and limits', hinge.frameA.position);
  // Undo and redo: back through the last four edits and forward again, to the same scene.
  const edited = (await editor(page)).sceneHash, depth = (await editor(page)).undoDepth;
  const hashes = [edited];
  for (let i = 0; i < 4; i++) { await page.click('#lab-editor-undo'); await waitEditor(page, old => window.box3dLab.editorState().sceneHash !== old, hashes.at(-1)); hashes.push((await editor(page)).sceneHash); }
  assert.equal(new Set(hashes).size, 5, 'each undo is a different scene');
  assert.equal((await scene(page)).joints[0].limits, undefined, 'the limits are gone again');
  for (let i = 3; i >= 0; i--) { await page.click('#lab-editor-redo'); await waitEditor(page, wanted => window.box3dLab.editorState().sceneHash === wanted, hashes[i]); }
  state = await editor(page);
  assert.deepEqual([state.sceneHash, state.undoDepth, state.canRedo], [edited, depth, false]);
  check('undo x4 and redo x4 return to the same scene hash', edited);

  // The anchor can also be picked: a click on the post puts it on the post's surface. Undo takes it back.
  const beforePick = (await editor(page)).sceneHash, onPost = await page.evaluate(() => window.box3dLab.editorScreenPosition('post'));
  await page.click('#lab-editor-pick-anchor');
  await page.mouse.click(onPost.x, onPost.y);
  await waitEditor(page, old => window.box3dLab.editorState().sceneHash !== old, beforePick);
  const pickedAnchor = (await scene(page)).joints[0].frameA.position;
  assert.ok(Math.max(...pickedAnchor.map(Math.abs)) <= 0.2001 && pickedAnchor.some(value => Math.abs(Math.abs(value) - 0.2) < 1e-3), `the picked anchor is on a face of the 0.4 m post (${pickedAnchor})`);
  await page.click('#lab-editor-undo');
  await waitEditor(page, wanted => window.box3dLab.editorState().sceneHash === wanted, beforePick);
  check('the joint anchor picked by clicking a point in the view', pickedAnchor);


  // Select by clicking the body in the 3D view; the selection is tinted and framed.
  await page.keyboard.press('Escape');
  await waitEditor(page, () => window.box3dLab.editorState().selection.length === 0);
  const plain = await captureCanvas(page, 'desktop-canvas-no-selection.png');
  const at = await page.evaluate(() => window.box3dLab.editorScreenPosition('ball'));
  assert.equal(at.visible, true);
  await page.mouse.click(at.x, at.y);
  await waitEditor(page, () => window.box3dLab.editorState().selection.join() === 'ball');
  await page.waitForFunction(() => window.box3dLab.editorState().overlayLines === 12 + 6);   // the frame of the ball and the hinge's marker
  const picked = await captureCanvas(page, 'desktop-canvas-selected.png');
  assert.ok(plain.lit > 0.5 && picked.lit > 0.5, 'the canvas is drawn');
  // The ball is about 30 pixels across at this distance; its lit side reads as orange.
  assert.ok(picked.orange >= plain.orange + 100, `the selected body is tinted (${plain.orange} -> ${picked.orange} orange pixels)`);
  check('a click in the 3D view selects the body under it, and the selection is highlighted', {orangeBefore: plain.orange, orangeAfter: picked.orange});
  await screenshot(page, 'desktop-page-selected.png');
  await screenshot(page, 'desktop-panel-body.png', '#lab-scene-panel');

  // Drag the ball over the ground plane with the mouse: x and z follow, snapped to the grid; y stays on the ground.
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 40, at.y + 10, {steps: 4});
  await page.mouse.move(at.x + 120, at.y + 30, {steps: 6});
  await page.mouse.up();
  await waitEditor(page, () => /Move "ball"/.test(window.box3dLab.editorState().message));
  const moved = bodyById(await scene(page), 'ball').position;
  assert.ok(Math.hypot(moved[0] + 2, moved[2]) > 0.2, `the ball moved (${moved})`);
  assert.equal(moved[1], 0.3, 'it still rests on the ground');
  for (const k of [0, 2]) close(moved[k] / 0.25, Math.round(moved[k] / 0.25), 1e-6, 'snapped to the 0.25 m grid');
  const after = await page.evaluate(() => window.box3dLab.editorScreenPosition('ball'));
  close(after.x, at.x + 120, 40, 'the body is under the pointer');
  check('dragging in the view slides the body on the ground plane, snapped to the grid', moved);
  // A click on the ground, where the ball was, deselects. A drag that starts there orbits the camera and keeps the selection.
  assert.equal(await page.evaluate(({x, y}) => document.elementFromPoint(x, y)?.id, at), 'gpu-canvas');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x - 30, at.y, {steps: 3});
  await page.mouse.up();
  assert.deepEqual((await editor(page)).selection, ['ball'], 'orbiting the camera keeps the selection');
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.move(at.x + 30, at.y, {steps: 3});
  await page.mouse.up();
  await page.mouse.click(at.x, at.y);
  await waitEditor(page, () => window.box3dLab.editorState().selection.length === 0);
  check('a click on empty space deselects');

  // The joint is drawn, and its inspector shows the anchor. Then measure: record the arm while it swings.
  await page.click('#lab-editor-item-hinge');
  await page.waitForSelector('#lab-editor-anchor-x');
  await page.waitForFunction(() => window.box3dLab.editorState().overlayLines === 6);   // two crosses' worth: one anchor (3), the axis, two centre-to-anchor lines
  await captureCanvas(page, 'desktop-canvas-joint.png');
  await screenshot(page, 'desktop-panel-joint.png', '#lab-scene-panel');
  await page.click('#lab-editor-item-arm');
  await waitEditor(page, () => window.box3dLab.editorState().selection.join() === 'arm');
  await page.click('#lab-editor-details-measure > summary');
  const initial = (await editor(page)).sceneHash;
  await page.click('#lab-editor-play');
  await waitEditor(page, () => window.box3dLab.editorState().time >= 1.5);
  state = await editor(page);
  assert.deepEqual([state.mode, state.playing, state.tracked], ['run', true, 'arm']);
  assert.ok(state.samples >= 60, `samples recorded: ${state.samples}`);
  await page.waitForSelector('#lab-editor-live dd');
  assert.equal(await page.evaluate(() => document.getElementById('lab-editor-position-x').disabled), true, 'the inspector is read-only while the simulation has moved on');
  await page.waitForTimeout(400);
  await captureCanvas(page, 'desktop-canvas-playing.png');
  await page.click('#lab-editor-play');
  await waitEditor(page, () => window.box3dLab.editorState().playing === false);
  await page.waitForTimeout(400);
  await page.locator('#lab-editor-plot').scrollIntoViewIfNeeded();
  await screenshot(page, 'desktop-panel-measure.png', '#lab-scene-panel');
  assert.deepEqual(await page.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map(node => node.id); return ids.filter((id, k) => ids.indexOf(id) !== k); }), [], 'no id is used twice on the page');
  const csv = await page.evaluate(() => window.box3dLab.editorCsv());
  const rows = csv.split('\r\n');
  assert.equal(rows[0], 'time_s,x_m,y_m,z_m,vx_m_per_s,vy_m_per_s,vz_m_per_s,speed_m_per_s,kinetic_translational_J,kinetic_rotational_J,potential_J,total_J');
  assert.equal(rows.length, (await editor(page)).samples + 2);
  const first = rows[1].split(',').map(Number), last = rows.at(-2).split(',').map(Number);
  assert.deepEqual(first.slice(0, 4), [0, 1, 3, 0], 'the first sample is the initial state');
  assert.ok(last[2] < 2.9 && Math.hypot(last[1] - 0.25, last[2] - 3) < 0.8 && Math.hypot(last[1] - 0.25, last[2] - 3) > 0.7, `the arm swung about the hinge (${last.slice(1, 4)})`);
  const download = page.waitForEvent('download');
  await page.click('#lab-editor-csv');
  const saved = await (await download).path();
  assert.equal(fs.readFileSync(saved, 'utf8'), csv, 'the downloaded CSV is the recorded series');
  // An edit while the simulation has moved on is refused; Step advances one tick; Reset returns to the document.
  await page.keyboard.press('Delete');
  assert.match((await editor(page)).message, /Press Reset|Reset to return/);
  const pausedAt = (await editor(page)).time;
  await page.click('#lab-editor-step');
  await waitEditor(page, before => window.box3dLab.editorState().time > before, pausedAt);
  close((await editor(page)).time - pausedAt, 1 / 60, 1e-9, 'Step is one tick');
  await page.click('#lab-editor-reset');
  await waitEditor(page, () => window.box3dLab.editorState().mode === 'edit');
  state = await editor(page);
  assert.deepEqual([state.time, state.sceneHash, state.bodies.length], [0, initial, 3], 'Reset returns to the edited initial state');
  assert.deepEqual(bodyById(await scene(page), 'arm').position, [1, 3, 0]);
  check('play, live inspector, plot, CSV export, step and reset', {samples: rows.length - 2, lastArmPosition: last.slice(1, 4)});

  // The ruler, between the two selected bodies.
  await page.click('#lab-editor-item-post');
  await page.click('#lab-editor-item-arm', {modifiers: ['Shift']});
  await page.click('#lab-editor-ruler-bodies');
  await waitEditor(page, () => window.box3dLab.editorState().ruler !== null);
  close((await editor(page)).ruler.distance, 1, 1e-6, 'post to arm');
  assert.match(await page.textContent('#lab-editor-ruler-out'), /Distance 1 m/);
  // And between two picked points: two clicks in the view.
  await page.click('#lab-editor-ruler-pick');
  const post = await page.evaluate(() => window.box3dLab.editorScreenPosition('post')), ball = await page.evaluate(() => window.box3dLab.editorScreenPosition('ball'));
  await page.mouse.click(post.x, post.y);
  await page.mouse.click(ball.x, ball.y);
  await waitEditor(page, () => { const r = window.box3dLab.editorState().ruler; return r !== null && r.distance > 1.5; });
  const ruled = (await editor(page)).ruler;
  json = await scene(page);
  close(ruled.distance, Math.hypot(...bodyById(json, 'post').position.map((value, k) => value - bodyById(json, 'ball').position[k])), 0.45, 'surface point to surface point, within the two bodies\' sizes');
  await page.waitForTimeout(300);
  await captureCanvas(page, 'desktop-canvas-ruler.png');
  check('ruler between two bodies and between two picked points', ruled.distance);

  // World settings: the Moon, and a step warning when the sub-steps are too few for the joint.
  await page.click('#lab-editor-details-world > summary');
  await page.selectOption('#lab-editor-gravity-preset', 'moon');
  await waitEditor(page, () => window.box3dLab.sceneJson().world.gravity[1] === -1.62);
  await setField(page, 'sub-steps', 2);
  state = await editor(page);
  assert.match(state.warnings.join('\n'), /Joint "hinge": stiffness 60 Hz is above a quarter of the sub-step rate/);
  await page.waitForSelector('#lab-editor-warnings li');
  await screenshot(page, 'desktop-panel-world.png', '#lab-scene-panel');
  await setField(page, 'sub-steps', 4);
  await page.selectOption('#lab-editor-gravity-preset', 'earth');
  await waitEditor(page, () => window.box3dLab.sceneJson().world.gravity[1] === -9.81);
  assert.deepEqual((await editor(page)).warnings, []);
  await page.click('#lab-editor-details-details > summary');
  await setField(page, 'title', 'Hinged arm');
  check('gravity presets and the step warning');

  // The replay hash of the edited scene after N steps, here; then the share link.
  const finalHash = (await editor(page)).sceneHash;
  const here = await page.evaluate(steps => window.box3dLab.stepSceneTo(steps), STEPS);
  assert.deepEqual([here.sceneHash, here.steps], [finalHash, STEPS]);
  await page.waitForFunction(() => window.box3dLab.editorState().mode === 'run');
  await page.click('#lab-editor-reset');
  await waitEditor(page, () => window.box3dLab.editorState().mode === 'edit');
  const again = await page.evaluate(steps => window.box3dLab.stepSceneTo(steps), STEPS);
  assert.deepEqual([again.replayHash, again.exactHash], [here.replayHash, here.exactHash], 'reset and replay give the same hashes in this page');
  await page.click('#lab-editor-reset');
  await waitEditor(page, () => window.box3dLab.editorState().mode === 'edit');
  const addressBefore = page.url();
  assert.equal(new URL(addressBefore).searchParams.has('scene'), false, 'the address carries no link until one is asked for');
  await page.click('#lab-scene-copy');
  await page.waitForFunction(() => window.box3dLab.lastShareLink() !== null, null, {timeout: 20000});
  const link = await page.evaluate(() => window.box3dLab.lastShareLink());
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), link, 'the clipboard holds the link');
  assert.equal(new URL(link).searchParams.has('edit'), false, 'the shared link opens for viewing');
  assert.deepEqual([new URL(page.url()).searchParams.get('scene'), new URL(page.url()).searchParams.get('edit')], [new URL(link).searchParams.get('scene'), '1'], 'this page keeps the editor open and now shows the link');
  check('Copy share link', `${link.length} characters`);
  // An edit after copying takes the stale link out of the address.
  const ballNow = await page.evaluate(() => window.box3dLab.editorScreenPosition('ball'));
  await page.mouse.click(ballNow.x, ballNow.y);
  await waitEditor(page, () => window.box3dLab.editorState().selection.join() === 'ball');
  await page.keyboard.press('ArrowRight');
  await waitEditor(page, () => /Move "ball"/.test(window.box3dLab.editorState().message));
  assert.equal(new URL(page.url()).searchParams.has('scene'), false);
  await page.click('#lab-editor-undo');
  await waitEditor(page, wanted => window.box3dLab.editorState().sceneHash === wanted, finalHash);
  const downloadScene = page.waitForEvent('download');
  await page.click('#lab-scene-download');
  const sceneFile = await (await downloadScene).path();
  const fileJson = JSON.parse(fs.readFileSync(sceneFile, 'utf8'));
  assert.equal(fileJson.meta.title, 'Hinged arm');
  fs.copyFileSync(sceneFile, path.join(output, 'hinged-arm.json'));

  // Autosave: the same browser, loading the editor again, finds the document and offers it.
  // (One page at a time: a second WebGPU page did not start here while the first was open.)
  await page.waitForTimeout(700);
  await openEditor(page, 'edit=1');
  await page.waitForSelector('#lab-editor-recovery:not([hidden])');
  assert.deepEqual([(await editor(page)).recovery, (await editor(page)).bodies.length], [true, 0]);
  assert.match(await page.textContent('#lab-editor-recovery'), /Hinged arm.*3 bodies and 1 joints/);
  await screenshot(page, 'desktop-panel-recovery.png', '#lab-scene-panel');
  await page.click('#lab-editor-recover');
  await page.waitForFunction(wanted => window.box3dLab.editorState().sceneHash === wanted, finalHash);
  assert.deepEqual([(await editor(page)).recovery, (await editor(page)).canUndo], [false, true]);
  check('autosave and the recovery prompt');
  await desktop.close();

  // A fresh browser context: the link opens the same scene, and it steps to the same hash.
  const fresh = await browser.newContext({viewport: {width: 1440, height: 900}});
  const viewer = await newPage(fresh, 'share link');
  await viewer.goto(link);
  await viewer.waitForFunction(() => window.box3dLab?.sceneState().loaded === true, null, {timeout: 180000});
  const there = await viewer.evaluate(steps => window.box3dLab.stepSceneTo(steps), STEPS);
  assert.equal(there.editing, false);
  assert.equal(there.sceneHash, finalHash, 'the same canonical scene hash');
  assert.deepEqual([there.steps, there.replayHash, there.exactHash], [STEPS, here.replayHash, here.exactHash], `the same replay hash after ${STEPS} steps`);
  await captureCanvas(viewer, 'share-link-canvas.png');
  check(`share link round trip: same scene hash and same replay hash after ${STEPS} steps`, {sceneHash: finalHash, replayHash: here.replayHash, exactHash: here.exactHash});
  // The same link with &edit=1 opens it in the editor; "Open file…" takes the downloaded file.
  await openEditor(viewer, `${new URL(link).search.slice(1)}&edit=1`);
  assert.equal((await editor(viewer)).sceneHash, finalHash);
  await viewer.setInputFiles('#lab-scene-file', {name: 'domino.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(await viewer.evaluate(() => window.box3dLab.sceneJson())).replace('Hinged arm', 'Opened from a file'))});
  await viewer.waitForFunction(() => window.box3dLab.sceneJson().meta.title === 'Opened from a file');
  assert.equal((await editor(viewer)).canUndo, true, 'opening a file in the editor is undoable');
  await viewer.selectOption('#lab-scene-example', 'pendulum-wave');
  await viewer.waitForFunction(() => window.box3dLab.editorState().bodies.length === 9);
  await viewer.click('#lab-scene-edit');
  await viewer.waitForFunction(() => window.box3dLab.editorState().active === false);
  assert.equal(new URL(viewer.url()).searchParams.has('edit'), false);
  await viewer.click('#lab-scene-edit');
  await viewer.waitForFunction(() => window.box3dLab.editorState().active === true);
  check('the link with &edit=1, Open file… and the examples open in the editor; Edit toggles it');
  await fresh.close();


  // -------------------------------------------------------------------------------------------
  // 2. Keyboard only: add, select, move, delete, undo. No pointer event is sent to this page.
  // -------------------------------------------------------------------------------------------
  const keys = await browser.newContext({viewport: {width: 1440, height: 900}});
  const kb = await newPage(keys, 'keyboard');
  await openEditor(kb, 'edit=1');
  const focusedId = () => kb.evaluate(() => document.activeElement?.id ?? '');
  /** Press Tab (or Shift+Tab) until the element with this id has the focus. */
  const tabTo = async (id, back = false) => {
    for (let i = 0; i < 400; i++) {
      if (await focusedId() === id) return i;
      await kb.keyboard.press(back ? 'Shift+Tab' : 'Tab');
    }
    throw new Error(`Tab never reached #${id}`);
  };
  assert.equal(await focusedId(), 'lab-editor-play', 'opening the editor puts the keyboard focus on its toolbar');
  const presses = await tabTo('lab-editor-add-shape');
  assert.ok(presses <= 8, `the Add control is ${presses} Tab presses from the toolbar`);
  // Choose "Sphere" by typing its first letter in the select, then Tab to "Add body" and press Enter.
  await kb.keyboard.type('S');
  assert.equal(await kb.evaluate(() => document.getElementById('lab-editor-add-shape').value), 'sphere');
  await tabTo('lab-editor-add-body');
  await kb.keyboard.press('Enter');
  await kb.waitForFunction(() => window.box3dLab.editorState().selection.join() === 'sphere-1');
  await kb.keyboard.press('Enter');
  await kb.waitForFunction(() => window.box3dLab.editorState().selection.join() === 'sphere-2');
  assert.equal(await focusedId(), 'lab-editor-add-body', 'the focus stays on the button through the rebuild');
  // Move: arrows nudge the selected body by one grid step in x and z, Page Up in y; Shift is ten steps.
  for (const key of ['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowDown', 'PageUp', 'Shift+ArrowLeft']) {
    const before = (await editor(kb)).sceneHash;
    await kb.keyboard.press(key);
    await kb.waitForFunction(old => window.box3dLab.editorState().sceneHash !== old, before);
  }
  assert.deepEqual(bodyById(await scene(kb), 'sphere-2').position, [-1.75, 1.75, 0.25]);
  assert.equal((await editor(kb)).undoDepth, 8, 'two bodies added and six key presses');
  // A key held down repeats, and the whole run is one undo step.
  await kb.keyboard.down('ArrowRight');
  await kb.keyboard.down('ArrowRight');
  await kb.keyboard.down('ArrowRight');
  await kb.waitForFunction(() => window.box3dLab.sceneJson().bodies[1].position[0] === -1);
  await kb.keyboard.up('ArrowRight');
  assert.equal((await editor(kb)).undoDepth, 9, 'a held arrow key is one undo step');
  await kb.keyboard.press('Control+z');
  await kb.waitForFunction(() => window.box3dLab.sceneJson().bodies[1].position[0] === -1.75);
  // Select the other body in the outline: Tab to the list, arrow to the item, Enter.
  await tabTo('lab-editor-item-sphere-2');
  await kb.keyboard.press('ArrowUp');
  assert.equal(await focusedId(), 'lab-editor-item-sphere-1');
  await kb.keyboard.press('Enter');
  await kb.waitForFunction(() => window.box3dLab.editorState().selection.join() === 'sphere-1');
  await kb.waitForFunction(() => document.activeElement?.id === 'lab-editor-item-sphere-1', null, {timeout: 5000});
  const focusRing = await kb.evaluate(() => { const style = getComputedStyle(document.activeElement); return [style.outlineStyle, style.outlineWidth]; });
  assert.deepEqual(focusRing, ['solid', '2px'], 'the focused outline item has a visible focus ring');
  await screenshot(kb, 'keyboard-panel-focus.png', '#lab-scene-panel');
  // Type a coordinate: Tab into the inspector's x field, type, Tab out.
  await tabTo('lab-editor-position-x');
  await kb.keyboard.press('Control+A');
  await kb.keyboard.type('2.5');
  await kb.keyboard.press('Tab');
  await kb.waitForFunction(() => window.box3dLab.sceneJson().bodies[0].position[0] === 2.5);
  await kb.waitForFunction(() => document.activeElement?.id === 'lab-editor-position-y', null, {timeout: 5000});
  // Escape leaves the field; Delete removes the selected body; Ctrl+Z brings it back; Shift+Ctrl+Z removes it again.
  await kb.keyboard.press('Escape');
  assert.equal(await focusedId(), 'gpu-canvas');
  await kb.keyboard.press('Delete');
  await kb.waitForFunction(() => window.box3dLab.editorState().bodies.join() === 'sphere-2');
  await kb.keyboard.press('Control+z');
  await kb.waitForFunction(() => window.box3dLab.editorState().bodies.join() === 'sphere-1,sphere-2');
  await kb.keyboard.press('Control+Shift+z');
  await kb.waitForFunction(() => window.box3dLab.editorState().bodies.join() === 'sphere-2');
  await kb.keyboard.press('Meta+z');
  await kb.waitForFunction(() => window.box3dLab.editorState().bodies.join() === 'sphere-1,sphere-2');
  // Ctrl+D duplicates the selection; Escape deselects.
  await tabTo('lab-editor-item-sphere-1', true);
  await kb.keyboard.press('ArrowDown');
  await kb.keyboard.press('Enter');
  await kb.waitForFunction(() => window.box3dLab.editorState().selection.join() === 'sphere-2');
  await kb.keyboard.press('Control+d');
  await kb.waitForFunction(() => window.box3dLab.editorState().bodies.length === 3);
  assert.deepEqual((await editor(kb)).selection, ['sphere-3']);
  await kb.keyboard.press('Escape');
  await kb.waitForFunction(() => window.box3dLab.editorState().selection.length === 0);
  // The Lab's own single-key shortcuts are off while editing: an arrow does not load another lab.
  const labBefore = new URL(kb.url()).searchParams.get('lab');
  await kb.keyboard.press('ArrowRight');
  await kb.keyboard.press('r');
  await kb.waitForTimeout(300);
  assert.deepEqual([(await editor(kb)).active, new URL(kb.url()).searchParams.get('lab'), (await editor(kb)).bodies.length], [true, labBefore, 3]);
  // Play and Reset from the keyboard.
  await tabTo('lab-editor-play', true);
  await kb.keyboard.press('Enter');
  await kb.waitForFunction(() => window.box3dLab.editorState().time > 0.2);
  await kb.keyboard.press('Enter');
  await tabTo('lab-editor-reset');
  await kb.keyboard.press('Enter');
  await kb.waitForFunction(() => window.box3dLab.editorState().mode === 'edit');
  check('keyboard only: add, select, move (arrows and typed), delete, undo, redo, duplicate, deselect, play, reset', {tabsToTheAddControl: presses});
  await keys.close();

  // -------------------------------------------------------------------------------------------
  // 3. A phone: 390 x 844, touch.
  // -------------------------------------------------------------------------------------------
  const phone = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, deviceScaleFactor: 2});
  const mobile = await newPage(phone, 'phone');
  await openEditor(mobile, 'example=domino-run&edit=1');
  await mobile.waitForTimeout(500);
  await screenshot(mobile, 'phone-page-editor.png');
  const layout = await mobile.evaluate(() => {
    const panel = document.getElementById('lab-scene-panel').getBoundingClientRect(), canvas = document.getElementById('gpu-canvas').getBoundingClientRect();
    const controls = [...document.querySelectorAll('#lab-scene-panel button, #lab-scene-panel select, #lab-editor input')].filter(node => node.offsetParent !== null).map(node => node.getBoundingClientRect());
    return {
      panel: [panel.left, panel.top, panel.right, panel.bottom], canvas: [canvas.left, canvas.top, canvas.right, canvas.bottom], viewport: [innerWidth, innerHeight],
      overflowX: document.getElementById('lab-scene-panel').scrollWidth - document.getElementById('lab-scene-panel').clientWidth,
      outside: controls.filter(box => box.left < panel.left - 1 || box.right > panel.right + 1).length, smallest: Math.min(...controls.map(box => box.height)), controls: controls.length,
      canvasVisibleAbovePanel: Math.max(0, Math.min(canvas.bottom, panel.top) - canvas.top),
    };
  });
  assert.ok(layout.panel[0] >= 0 && layout.panel[2] <= 390, `the panel is inside the viewport (${layout.panel})`);
  assert.equal(layout.overflowX, 0, 'the panel does not scroll sideways');
  assert.equal(layout.outside, 0, 'no control is cut off at the sides');
  // Edit by touch: tap an item in the outline, change a number, see it applied.
  await mobile.tap('#lab-editor-item-domino-3');
  await mobile.waitForFunction(() => window.box3dLab.editorState().selection.join() === 'domino-3');
  await mobile.waitForSelector('#lab-editor-position-y');
  await mobile.locator('#lab-editor-position-y').scrollIntoViewIfNeeded();
  await screenshot(mobile, 'phone-page-inspector.png');
  const dominoBefore = (await editor(mobile)).sceneHash;
  await mobile.fill('#lab-editor-position-y', '1.5');
  await mobile.locator('#lab-editor-position-y').blur();
  await mobile.waitForFunction(old => window.box3dLab.editorState().sceneHash !== old, dominoBefore);
  // Two bodies selected by touch with "Select several", and a joint between them.
  await mobile.locator('#lab-editor-multi-select').scrollIntoViewIfNeeded();
  await mobile.tap('#lab-editor-multi-select');
  await mobile.tap('#lab-editor-item-domino-4');
  await mobile.waitForFunction(() => window.box3dLab.editorState().selection.join() === 'domino-3,domino-4');
  await mobile.selectOption('#lab-editor-add-joint-type', 'distance');
  await mobile.locator('#lab-editor-add-joint').scrollIntoViewIfNeeded();
  await mobile.tap('#lab-editor-add-joint');
  await mobile.waitForFunction(() => window.box3dLab.editorState().joints.join() === 'distance-1');
  await mobile.locator('#lab-editor-multi-select').scrollIntoViewIfNeeded();
  await mobile.tap('#lab-editor-multi-select');
  // Hide the panel to reach the view; tap a body to select it; show the panel again.
  await mobile.tap('#lab-scene-toggle');
  await mobile.waitForTimeout(300);
  const tapAt = await mobile.evaluate(() => window.box3dLab.editorScreenPosition('domino-8'));
  const hit = await mobile.evaluate(({x, y}) => document.elementFromPoint(x, y)?.id ?? '', tapAt);
  let tapped = false;
  if (tapAt.visible && hit === 'gpu-canvas') {
    await mobile.touchscreen.tap(tapAt.x, tapAt.y);
    await mobile.waitForFunction(() => window.box3dLab.editorState().selection.length === 1 && window.box3dLab.editorState().selection[0].startsWith('domino-'), null, {timeout: 10000});
    tapped = true;
  }
  await captureCanvas(mobile, 'phone-canvas-selected.png');
  await screenshot(mobile, 'phone-page-collapsed.png');
  await mobile.tap('#lab-scene-toggle');
  check('phone 390 x 844: the panel fits the width and edits by touch', {...layout, tappedABodyInTheView: tapped, elementAtTheBody: hit});
  report.phone = {...layout, tappedABodyInTheView: tapped, elementAtTheBody: hit};
  await phone.close();

  assert.deepEqual(report.errors, [], `console errors:\n${report.errors.join('\n')}`);
  check('no console errors, page errors or failed requests', {warnings: report.warnings.length});
  report.ok = true;
} catch (error) {
  report.ok = false;
  report.failure = error instanceof Error ? error.stack : String(error);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  fs.writeFileSync(path.join(output, 'scene-editor-browser-check.json'), JSON.stringify(report, null, 2));
  await browser.close();
  server.close();
}
console.log(`${report.ok ? 'PASS' : 'FAIL'}: ${report.checks.length} checks, ${report.errors.length} console errors, ${report.warnings.length} warnings. Output in ${output}`);
