// Smoke variant of the engine comparison (benchmarks/engines): tiny scenes, every engine, no timing asserted.
// It keeps the harness and every adapter working: each engine builds every kind of scene (stack, piles of four shape
// kinds, mesh and height-field terrain, ragdolls, chain, mass-ratio stack, bullets, pendulum, bounce, ray casts) and the
// physical sanity of the result is checked, loosely enough for every engine and tightly enough to catch a broken adapter.
// It also checks that the published report (docs/BENCHMARKS_ENGINES.md) is what public/benchmarks/benchmarks.json renders to.
// Run by `npm run test:bench:engines`. The other engines are installed on first use (npm ci in benchmarks/engines).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test, {after, before} from 'node:test';
import {fileURLToPath} from 'node:url';
import {ENGINES, ensureEngines, ensureKit, runChild} from '../../benchmarks/engines/run.mjs';
import {SMOKE_SCENES, SCENES} from '../../benchmarks/engines/scenes.mjs';
import {renderMarkdown, SCHEMA, VERSION} from '../../benchmarks/engines/report.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const scenes = [...SMOKE_SCENES.map(scene => scene.id), 'probe-trimesh', 'probe-heightfield'];

// What an engine cannot do, stated in the report as well: these counts may be above zero. Everything else must hold
// for every engine.
const LIMITS = {
  // cannon-es: a Trimesh collides only with spheres and planes, and there is no continuous collision detection.
  cannon: {'trimesh-smoke': 'fellThrough', 'bullets-smoke': 'tunnelled'},
  // ammo.js (Bullet 2.82): capsules dropped on a mesh or height field can pass through on first impact.
  ammo: {'trimesh-smoke': 'fellThrough', 'heightfield-smoke': 'fellThrough'},
};

// This engine's adapter imports the built kit. Build it once for the file and remove the outputs again, as
// packages/box3d-kit/scripts/test-gate.mjs does: the source manifest check fails on leftover build outputs.
let cleanKit = () => {};
before(() => { ensureEngines(); cleanKit = ensureKit(); });
after(() => cleanKit());

let results = null;
function runAll() {
  // Three engines at a time; nothing here is timed.
  results ??= (async () => {
    const queue = [...ENGINES], collected = new Map();
    const worker = async () => { for (let engine = queue.shift(); engine; engine = queue.shift()) collected.set(engine, await runSmoke(engine)); };
    await Promise.all([worker(), worker(), worker()]);
    return collected;
  })();
  return results;
}
/** One child per engine runs every smoke scene; returns {sceneId: result}. */
async function runSmoke(engine) {
  const {spawn} = await import('node:child_process');
  const env = {...process.env};
  delete env.NODE_OPTIONS;
  const out = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(root, 'benchmarks/engines/child.mjs'), `--engine=${engine}`, `--scene=${scenes.join(',')}`, '--warm=0', '--budgetMs=60000'], {env, stdio: ['ignore', 'pipe', 'pipe']});
    let text = '', err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), 600000);
    child.stdout.on('data', chunk => { text += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timer); if (code === 0) resolve(text); else reject(new Error(`${engine}: child exited ${code}: ${err.slice(-400)}`)); });
  });
  const byScene = {};
  for (const line of out.split('\n')) if (line.startsWith('{')) { const row = JSON.parse(line); byScene[row.scene] = row; }
  return byScene;
}

test('runChild is the entry the full comparison uses and returns a result for one tiny run', async () => {
  const row = await runChild(['--engine=box3d', '--scene=bounce-smoke', '--warm=0'], 120000);
  assert.equal(row.failed, undefined, row.error);
  assert.equal(row.scene, 'bounce-smoke');
});

for (const engine of ENGINES) {
  test(`${engine}: every smoke scene builds, steps and stays physically sane`, async () => {
    const rows = (await runAll()).get(engine), limits = LIMITS[engine] ?? {};
    for (const scene of scenes) {
      const row = rows[scene];
      assert.ok(row, `${engine} ${scene}: no result`);
      assert.equal(row.failed, undefined, `${engine} ${scene}: ${row.error}`);
      assert.equal(row.timedOut, false, `${engine} ${scene}: timed out`);
      assert.match(row.version, /\d/, `${engine} ${scene}: engine version`);
      assert.equal(typeof row.settings, 'object');
      assert.match(row.stateHash, /^[0-9a-f]{16}$/);
      assert.equal(row.quality.unstable, false, `${engine} ${scene}: the simulation blew up`);
      for (const value of [row.constructionMs, row.step.mean, row.peakRssBytes]) assert.ok(value === null || Number.isFinite(value), `${engine} ${scene}: a number is missing`);
      const q = row.quality, allow = limits[scene];
      const expectZero = (name, value) => { if (allow !== name) assert.equal(value, 0, `${engine} ${scene}: ${name}`); };
      switch (scene) {
        case 'pyramid-smoke': assert.equal(q.standing, true); assert.ok(q.maxDriftMm < 120, `drift ${q.maxDriftMm} mm`); break;
        case 'boxes-smoke': case 'spheres-smoke': case 'capsules-smoke': case 'hulls-smoke': assert.equal(q.belowGround, 0); assert.ok(q.pileTopM > 0.1 && q.pileTopM < 4, `pile top ${q.pileTopM} m`); break;
        case 'trimesh-smoke': case 'heightfield-smoke': expectZero('fellThrough', q.fellThrough); break;
        case 'ragdolls-smoke': assert.ok(q.maxJointGapMm < 250, `joint gap ${q.maxJointGapMm} mm`); assert.equal(q.belowGround, 0); break;
        // Ten links under a mass of 100 links: the engines stretch between a few percent and almost twice the length.
        case 'chain-smoke': assert.ok(Math.abs(q.maxStretchPercent) < 300, `stretch ${q.maxStretchPercent} %`); break;
        case 'stack-smoke': assert.ok(q.maxPenetrationMm === null || q.maxPenetrationMm < 250); break;
        case 'bullets-smoke': expectZero('tunnelled', q.tunnelled); break;
        // Most engines lose pendulum energy at 60 Hz and PhysX's TGS solver gains some (see the report); this only catches a broken joint.
        case 'pendulum-smoke': assert.ok(q.maxEnergyDriftPercent < 30 && q.maxEnergyDriftPercent > -60, `energy drift ${q.maxEnergyDriftPercent} %`); assert.ok(Math.abs(q.periodErrorPercent) < 6, `period error ${q.periodErrorPercent} %`); break;
        case 'bounce-smoke': assert.ok(Math.abs(q.restitutionErrorPercent) < 40, `restitution error ${q.restitutionErrorPercent} %`); break;
        case 'raycast-smoke': assert.ok(row.rays.hits > 20, `ray hits ${row.rays.hits}`); break;
        // An adapter that places or orients the terrain differently from the others fails here.
        case 'probe-trimesh': case 'probe-heightfield': assert.ok(row.rays.maxErrorM < 0.02, `terrain error ${row.rays.maxErrorM} m`); assert.ok(row.rays.missed <= 2, `missed ${row.rays.missed}`); break;
        default: assert.fail(`no check for ${scene}`);
      }
    }
  });
}

// Bullet's 0.04 m collision margin makes its shapes slightly larger, so ammo.js hits a few more of the 200 rays.
test('every engine sees the same ray-cast scene: hit counts agree within 5 %', async () => {
  const all = await runAll(), reference = all.get('box3d')['raycast-smoke'].rays;
  for (const engine of ENGINES) {
    const rays = all.get(engine)['raycast-smoke'].rays;
    assert.ok(Math.abs(rays.hits - reference.hits) <= Math.max(2, 0.05 * reference.hits), `${engine}: ${rays.hits} hits against ${reference.hits}`);
    assert.ok(Math.abs(rays.meanHitDistanceM - reference.meanHitDistanceM) < 0.25, `${engine}: mean hit distance ${rays.meanHitDistanceM} m against ${reference.meanHitDistanceM} m`);
  }
});

test('this engine repeats bit for bit: two processes give the same state hash for every smoke scene', async () => {
  const first = (await runAll()).get('box3d'), second = await runSmoke('box3d');
  for (const scene of scenes) assert.equal(second[scene].stateHash, first[scene].stateHash, scene);
});

test('the benchmark dependencies are pinned, licensed and outside the shipped packages', () => {
  const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
  const manifest = read('benchmarks/engines/package.json'), lock = read('benchmarks/engines/package-lock.json');
  assert.equal(manifest.private, true);
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    assert.match(version, /^\d+\.\d+\.\d+$/, `${name} must be pinned to an exact version`);
    assert.equal(lock.packages[`node_modules/${name}`]?.version, version, `${name} in the lock file`);
  }
  for (const file of ['package.json', 'packages/box3d-kit/package.json']) {
    const pkg = read(file), listed = {...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies};
    for (const name of Object.keys(manifest.devDependencies)) assert.equal(listed[name], undefined, `${file} must not depend on ${name}`);
  }
});

test('the published comparison is complete and the Markdown report is what the JSON renders to', () => {
  const jsonText = fs.readFileSync(path.join(root, 'public/benchmarks/benchmarks.json'), 'utf8'), report = JSON.parse(jsonText);
  assert.equal(report.schema, SCHEMA); assert.equal(report.version, VERSION);
  assert.match(report.generated, /^\d{4}-\d{2}-\d{2}$/);
  assert.deepEqual(report.engines.map(engine => engine.id), ENGINES);
  for (const engine of report.engines) {
    assert.match(engine.version, /\d/, `${engine.id}: version`);
    assert.ok(engine.license && engine.docs.length > 0 && engine.gzipBytes > 0, `${engine.id}: licence, documentation and bundle size`);
  }
  // No row may be dropped: every engine has a default-settings row for every scene, measured or with the reason it is not.
  for (const scene of SCENES) for (const engine of ENGINES) {
    const row = report.results.find(r => r.scene === scene.id && r.engine === engine && r.config === 'default');
    assert.ok(row, `${engine} ${scene.id}: missing row`);
    assert.ok(['ok', 'timed-out', 'failed'].includes(row.status), `${engine} ${scene.id}: status`);
    if (row.status === 'failed') assert.ok(row.error?.length > 5, `${engine} ${scene.id}: a failed row says why`);
    else assert.equal(typeof row.settings, 'object', `${engine} ${scene.id}: settings`);
  }
  assert.equal(fs.readFileSync(path.join(root, 'docs/BENCHMARKS_ENGINES.md'), 'utf8'), renderMarkdown(report), 'docs/BENCHMARKS_ENGINES.md is stale: run `node benchmarks/engines/report.mjs`');
  for (const file of ['index.html', 'benchmarks.js', 'benchmarks.css']) assert.ok(fs.existsSync(path.join(root, 'public/benchmarks', file)), file);
});

test('the comparison page is static, self-contained and reads the JSON next to it', () => {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const html = read('public/benchmarks/index.html'), script = read('public/benchmarks/benchmarks.js'), css = read('public/benchmarks/benchmarks.css');
  const policy = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1] ?? '';
  assert.match(policy, /default-src 'none'/);
  assert.match(policy, /script-src 'self'(;|$)/, 'no inline or evaluated script');
  assert.match(policy, /style-src 'self'(;|$)/, 'no inline style');
  assert.doesNotMatch(policy, /unsafe|\*|https?:/);
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc="\.\/benchmarks\.js")|<style|\sstyle=|\son[a-z]+=/, 'no inline script, style or handler');
  for (const [, url] of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    assert.ok(/^(\.\.?\/|#)/.test(url) || url.startsWith('https://github.com/nathansenn/box3d-WEBGPU'), `${url}: relative, or a link to the repository`);
  }
  for (const text of [script, css]) assert.doesNotMatch(text, /https?:\/\/(?!github\.com\/nathansenn\/box3d-WEBGPU|www\.w3\.org\/2000\/svg)|@import|url\(/, 'no request to another origin');
  assert.doesNotMatch(script, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function|\.style\b/, 'the JSON is drawn as text nodes and attributes');
  assert.match(script, /new URL\('\.\/benchmarks\.json', import\.meta\.url\)/);
  assert.match(script, new RegExp(`SCHEMA = '${SCHEMA}', VERSION = ${VERSION}\\b`), 'the page reads the schema version the generator writes');
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(script, /aria-sort/); assert.match(script, /scope: 'col'/); assert.match(script, /scope: 'row'/);
  // The validation page and the README link to it.
  assert.match(read('public/validation/index.html'), /href="\.\.\/benchmarks\/"/);
  assert.match(read('README.md'), /docs\/BENCHMARKS_ENGINES\.md/);
});
