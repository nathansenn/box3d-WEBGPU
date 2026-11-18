// Packs the tarball, installs it into a throwaway project outside the repo and
// runs a consumer game loop against it. Proves the published artifact alone
// (exports map, types, bundled WASM) is enough to integrate.
import {execFileSync} from 'node:child_process';
import {mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {brotliCompressSync, gzipSync} from 'node:zlib';
import {tmpdir} from 'node:os';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const work = mkdtempSync(join(process.env.BOX3D_KIT_SMOKE_DIR ?? tmpdir(), 'box3d-kit-smoke-'));
const sh = (cmd, args, cwd) => execFileSync(cmd, args, {cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']});

// ---- sizes ----
// What an import costs is the gzip size of everything it loads: the entry file and every module it reaches through
// static imports. `closure` follows them in the built files, so the numbers are what a consumer downloads without a
// bundler, and an upper bound on what a bundler keeps.
const dist = join(pkg, 'dist');
function closure(entry) {
  const seen = new Set(), queue = [entry];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const [, specifier] of readFileSync(join(dist, file), 'utf8').matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
      const target = join(dirname(file), specifier).replace(/\\/g, '/');
      if (target.endsWith('.js')) queue.push(target);
    }
  }
  return [...seen].sort();
}
const gzipOf = files => gzipSync(Buffer.concat(files.map(f => readFileSync(join(dist, f)))), {level: 9}).length;
const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
const entries = Object.entries(manifest.exports).filter(([name, target]) => typeof target === 'object' && name !== './single').map(([name, target]) => ({name, file: target.default.replace('./dist/', '')}));
// The solver modules. `import {PhysicsWorld} from 'box3d-webgpu-kit'` must reach none of them.
const SOLVERS = ['compliant-cable', 'linear-water', 'closed-water', 'water-coupling', 'frame-element', 'frame-runtime', 'envelope-matrix', 'heat', 'solid', 'solid-mesh', 'concrete-law', 'sparse-ldl', 'structure-coupling',
  'scene-format', 'scene-examples', 'geometry', 'simulation', 'robot-import', 'solid-fracture', 'cloth', 'granular', 'granular-kernels', 'fluid', 'fluid-multigrid', 'shallow-water', 'solid-contact', 'materials'].map(name => `core/${name}.js`);
// Budgets in bytes of gzip (level 9), set from the measured sizes of 1.0.0-rc.1 with about 15 % of headroom, rounded up to
// a kibibyte. Raise one deliberately, in review, with the measurement in the commit message; never silently.
// Raised with the rigid-core merge (measured then, KiB): box3d.wasm 704.2 raw (was under 700), main entry 75.3 (58.8: the
// queries, mover, joint events, world controls, profile and debug draw), worker 81.4 (63.9), gameplay 83.7 (32.5: Vehicle
// and CapsuleCharacterController), solid 65.8 (54.0: the concrete law), scene-format 80.4 (62.7: the example scenes and
// the vehicle's suspension helper), dist/single.js 412.3 gzip (it was 411.3 of 412 before the concrete speed-up and the
// von Karman plate of bf0b767). The pthread artifact is new and has budgets of its own (mt*).
const KiB = 1024;
// The tarball: both WebAssembly builds and everything else. Measured 1,434 KiB at rc.1 and 1,915.7 KiB after the
// rigid-core merge, of which the pthread artifact is about 290 KiB compressed.
const PACKED_BUDGET = 2194 * KiB;
const BUDGET = {
  wasm: 810 * KiB, wasmGzip: 275 * KiB, wasmBrotli: 210 * KiB, glue: 26 * KiB, singleGzip: 475 * KiB, packed: PACKED_BUDGET,
  // box3d-mt.{js,wasm}: loaded only by loadBox3D({threads: 2 or more}), never by an import, so in no entry's closure.
  // Measured 711.8 KiB raw, 279.5 gzip, 213.1 brotli, glue 38.2.
  mtWasm: 819 * KiB, mtWasmGzip: 322 * KiB, mtWasmBrotli: 246 * KiB, mtGlue: 44 * KiB,
  /** A Vite bundle of a program that uses only createWorld, createBody and step. Measured 27.9 KiB, 37.6 after the rigid-core merge. */
  rigidBundle: 43 * KiB,
  // Measured after the rigid-core merge (KiB): main 75.3, three 2.0, babylon 0.9, worker 81.4, gameplay 83.7, cable 24.7, water 2.7,
  // coupling 25.1, frame 23.4, structure 27.9, heat 24.7, solid 65.8, fracture 124.2, solid-contact 117.7 (with solid–solid contact), cloth 63.0, granular 57.4,
  // fluid 49.7, shallow-water 33.4, materials 35.0, geometry 28.6, scene-format 80.4, robot 64.3, and scene 411.6 and simulation
  // 410.3, which load every solver.
  // Raised 2026-11-17: fracture 131 -> 138 KiB for the concrete law's crack band per element and softening surface (measured
  // 133.7 KiB; the two changed sources grew by 5.8 KiB gzip); solid measured 73.9 of 75, solid-contact 125.8, scene 437.5,
  // simulation 436.2.
  // Raised 2026-11-17: solid 75 -> 80 KiB when the crack band and the press solver's orphaned-pivot and tangent changes
  // met (measured 75.9 KiB = 77,718 bytes; each alone stayed under 75).
  entry: {
    '.': 85 * KiB, './three': 3 * KiB, './babylon': 2 * KiB, './worker': 92 * KiB, './gameplay': 95 * KiB,
    './cable': 28 * KiB, './water': 4 * KiB, './coupling': 29 * KiB, './frame': 27 * KiB, './structure': 32 * KiB, './heat': 28 * KiB,
    './solid': 80 * KiB, './fracture': 138 * KiB, './solid-contact': 135 * KiB, './cloth': 72 * KiB, './granular': 65 * KiB, './fluid': 57 * KiB, './shallow-water': 38 * KiB,
    './materials': 40 * KiB, './geometry': 33 * KiB, './scene-format': 92 * KiB, './robot': 74 * KiB, './scene': 447 * KiB, './simulation': 446 * KiB,
    // Added 2026-11-18: the GPU backends with their float32 references and the scene sections on the GPU. It loads the
    // grain, flow and shallow-water solvers they are built from (the scene loader is in ./simulation). Measured 150.8 KiB.
    './gpu': 174 * KiB,
  },
};
const size = {
  wasm: readFileSync(join(pkg, 'wasm/box3d.wasm')).length,
  wasmGzip: gzipSync(readFileSync(join(pkg, 'wasm/box3d.wasm')), {level: 9}).length,
  wasmBrotli: brotliCompressSync(readFileSync(join(pkg, 'wasm/box3d.wasm'))).length,
  glue: readFileSync(join(pkg, 'wasm/box3d.js')).length,
  singleGzip: gzipSync(readFileSync(join(pkg, 'dist/single.js')), {level: 9}).length,
  mtWasm: readFileSync(join(pkg, 'wasm/box3d-mt.wasm')).length,
  mtWasmGzip: gzipSync(readFileSync(join(pkg, 'wasm/box3d-mt.wasm')), {level: 9}).length,
  mtWasmBrotli: brotliCompressSync(readFileSync(join(pkg, 'wasm/box3d-mt.wasm'))).length,
  mtGlue: readFileSync(join(pkg, 'wasm/box3d-mt.js')).length,
};
const entrySize = Object.fromEntries(entries.map(entry => [entry.name, gzipOf(closure(entry.file))]));
const measureOnly = process.argv.includes('--measure');
if (measureOnly) {
  for (const [name, bytes] of Object.entries({...size, ...Object.fromEntries(Object.entries(entrySize).map(([n, v]) => [`entry ${n}`, v]))})) console.log(`${name.padEnd(26)} ${(bytes / KiB).toFixed(1).padStart(8)} KiB`);
  console.log('core closure:', closure('index.js').join(' '));
}
{
  const core = closure('index.js'), pulled = core.filter(file => SOLVERS.includes(file));
  // The format-only scene entry loads the format, its examples, the error table, and the rigid helpers the examples use
  // (the vehicle's suspension spring and the state encoder it brings), and no solver.
  const format = closure('scene-format.js').filter(file => file.startsWith('core/')).sort().join(' ');
  if (format !== 'core/checkpoint.js core/contracts.js core/scene-examples.js core/scene-format.js core/vehicle.js') throw new Error(`box3d-webgpu-kit/scene-format loads ${format}`);
  if (pulled.length) throw new Error(`the main entry reaches solver modules: ${pulled.join(', ')}. \`import {PhysicsWorld} from 'box3d-webgpu-kit'\` must not load them.`);
  const unlisted = entries.filter(entry => !(entry.name in BUDGET.entry));
  if (unlisted.length) throw new Error(`no size budget for ${unlisted.map(e => e.name).join(', ')}`);
  if (manifest.sideEffects !== false) throw new Error('package.json must keep "sideEffects": false: bundlers drop unused modules only then');
}

try {
  const [packed] = JSON.parse(sh('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], pkg));
  const files = packed.files.map(f => f.path);
  size.packed = packed.size;
  if (measureOnly) console.log(`${'packed'.padEnd(26)} ${(packed.size / KiB).toFixed(1).padStart(8)} KiB`);
  const over = [...Object.entries(size).filter(([k, v]) => v > BUDGET[k]).map(([k, v]) => `${k} ${v} > ${BUDGET[k]}`), ...Object.entries(entrySize).filter(([k, v]) => v > BUDGET.entry[k]).map(([k, v]) => `import '${k}' ${v} > ${BUDGET.entry[k]}`)];
  if (over.length && !measureOnly) throw new Error(`size budget exceeded (bytes): ${over.join(', ')}`);
  for (const required of ['dist/index.js', 'dist/index.d.ts', 'dist/three.js', 'dist/worker.js', 'dist/worker.d.ts', 'dist/babylon.js', 'dist/core/build-info.js', 'dist/shared-frames.js', 'dist/session.js', 'dist/inspector.js', 'api/API.md', 'CHANGELOG.md', 'dist/single.js', 'dist/cable.js', 'dist/water.js', 'dist/coupling.js', 'dist/frame.js', 'dist/heat.js', 'dist/gameplay.js', 'bin/box3d-kit.mjs', 'templates/three/main.js', 'wasm/box3d.js', 'wasm/box3d.wasm', 'LICENSE', 'wasm/BOX3D_LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'dist/geometry.js', 'dist/solid.js', 'dist/scene.js', 'dist/robot.js', 'dist/robot.d.ts', 'dist/core/robot-import.js', 'dist/fracture.js', 'dist/fracture.d.ts', 'dist/core/solid-fracture.js', 'dist/cloth.js', 'dist/solid-contact.js', 'dist/cloth.d.ts', 'dist/core/cloth.js', 'dist/gpu-compute.js', 'dist/gpu-compute.d.ts', 'dist/core/gpu/scene-backends.js', 'dist/core/gpu/fluid-gpu.js']) {
    if (!files.includes(required)) throw new Error(`tarball is missing ${required}`);
  }
  const leaked = files.filter(f => f.startsWith('src/') || f.startsWith('test/') || f.endsWith('.tgz') || f.endsWith('.map')); // maps would point at src/, which is not shipped
  if (leaked.length) throw new Error(`tarball includes non-runtime files: ${leaked.join(', ')}`);

  const app = join(work, 'game');
  execFileSync('mkdir', ['-p', app]);
  writeFileSync(join(app, 'package.json'), JSON.stringify({name: 'smoke-game', private: true, type: 'module'}));
  sh('npm', ['install', '--no-audit', '--no-fund', '--offline', join(work, packed.filename)], app);
  writeFileSync(join(app, 'game.mjs'), `
import {createWorld} from 'box3d-webgpu-kit';
import {syncInstancedMesh} from 'box3d-webgpu-kit/three';
import {validateScene, sceneHash} from 'box3d-webgpu-kit/scene-format';
const tiny = {format: 'box3d-scene', version: 1, bodies: [{id: 'a', shape: {kind: 'sphere', radius: 0.1}, position: [0, 1, 0]}]};
if (validateScene(tiny).length !== 0 || sceneHash(tiny).length !== 64 || validateScene({...tiny, bodies: [{}]}).length === 0) { console.error('scene-format entry failed'); process.exit(1); }
const world = await createWorld({seed: 7});
const player = world.spawnBox({position: [0, 4, 0], halfSize: 0.5});
let frames = 0, steps = 0;
while (frames++ < 240) steps += world.update(1 / 60).steps;           // 4 s of 60 Hz frames
const pose = world.getPose(player);
const ground = world.raycast([3, 10, 3], [0, -20, 0]);
const mesh = {count: 0, instanceMatrix: {array: new Float32Array(64 * 16), needsUpdate: false}, instanceColor: null};
const drawn = syncInstancedMesh(world, mesh);
world.dispose();
if (steps !== 240 || Math.abs(pose.position[1] - 0.5) > 0.05 || !ground || drawn !== 2) {
  console.error(JSON.stringify({steps, y: pose.position[1], ground: !!ground, drawn})); process.exit(1);
}
console.log(JSON.stringify({ok: true, steps, restY: +pose.position[1].toFixed(4), drawn}));
`);
  // A strict TypeScript consumer must resolve the published declarations.
  writeFileSync(join(app, 'types.ts'), `
import {createWorld, type Body, type BodyPose, type NativeQueryCastHit} from 'box3d-webgpu-kit';
import {createBodyMesh, syncInstancedMesh} from 'box3d-webgpu-kit/three';
import {connectWorld, serveWorld, type RemoteWorld} from 'box3d-webgpu-kit/worker';
import {SnapshotEncoder, SnapshotDecoder, WorldScheduler, writeInstances, boxOutlines, convertMatrices, type ReplayLog, type ReplayReport, type WorldStats, type EngineErrorCode, type Vec3Like, type DebugLines} from 'box3d-webgpu-kit';
const world = await createWorld({step: 1 / 120, subSteps: 2, capacity: 8192});
const smooth: Float32Array = world.interpolatedMatrices(world.update(1 / 60).alpha);
const stats: WorldStats = world.stats();
const code: EngineErrorCode = 'STALE_BODY';
world.startRecording();
const log: ReplayLog = world.stopRecording();
const remote: Promise<RemoteWorld> | null = null as Promise<RemoteWorld> | null;
const up: Vec3Like = {x: 0, y: 1, z: 0};
const report: ReplayReport = world.replayDetailed(log);
const lines: DebugLines = boxOutlines(world, {up: 'z'});
const client = new SnapshotDecoder();
client.apply(new SnapshotEncoder().encode(world));
const scheduler = new WorldScheduler({budgetMs: 4}).add(world);
import {syncThinInstances, type ThinInstanceMeshLike} from 'box3d-webgpu-kit/babylon';
import {BUILD_INFO, BodyRing, detectEnvironment, LICENSE_NOTICE, loadBox3D, type EnvironmentReport} from 'box3d-webgpu-kit';
const env: EnvironmentReport = detectEnvironment();
const ring = new BodyRing(world, 10);
const sha: string = BUILD_INFO.wasmSha256;
const verified = loadBox3D({integrity: true});
declare const thin: ThinInstanceMeshLike;
import {saveSession, loadSession, formatStats, sharedMemoryAvailable, leakReporting, type SavedSession, type Inspector} from 'box3d-webgpu-kit';
const saved: SavedSession = saveSession(log);
const replayed = loadSession(world, saved).matches;
const hud: string = formatStats(world.stats());
const sab: boolean = sharedMemoryAvailable();
leakReporting.warn = () => {};
declare const inspector: Inspector;
const sharedRemote = (r: RemoteWorld) => [r.usesSharedMemory, r.start(120), r.stop()];
void [smooth, stats, code, log, remote, connectWorld, serveWorld, up, report, lines, scheduler, writeInstances, convertMatrices, env, ring, sha, verified, LICENSE_NOTICE, replayed, hud, sab, inspector, sharedRemote, () => syncThinInstances(world, thin)];
const body: Body | null = world.spawnBox({position: [0, 1, 0]});
const pose: BodyPose | null = body && world.getPose(body);
const hit: NativeQueryCastHit | null = world.raycast([0, 5, 0], [0, -10, 0]);
void [pose, hit, createBodyMesh, syncInstancedMesh];
import {TriggerSet, CharacterController, NATIVE_GRAVITY, type TriggerEvent, type CharacterState} from 'box3d-webgpu-kit/gameplay';
const zones = new TriggerSet<{zone: string}>(world, {attach: true});
zones.add({shape: {kind: 'box', center: [0, 1, 0], halfExtents: [1, 1, 1]}, data: {zone: 'goal'}});
const events: TriggerEvent<{zone: string}>[] = zones.update();
const hero = new CharacterController(world, {position: [0, 1, 0], pushStrength: 0.5});
const moved: CharacterState = hero.move({velocity: {x: 1, y: 0, z: 0}, jump: 5}, 1 / 60);
const g: number = NATIVE_GRAVITY[1];
const unsubscribe: () => void = world.onStep(tick => void tick);
void [events, moved, g, unsubscribe];
`);
  const tsc = resolve(pkg, '../../node_modules/typescript/bin/tsc');
  sh('node', [tsc, '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--lib', 'es2022,dom', 'types.ts'], app);
  // box3d-webgpu-kit/gpu: a scene section with backend 'gpu' loads from the tarball and steps on the float32 reference
  // (no device in Node); its declarations resolve for a strict consumer that has the WebGPU types.
  writeFileSync(join(app, 'gpu.mjs'), `
import {createWorld} from 'box3d-webgpu-kit';
import {loadSimulationScene} from 'box3d-webgpu-kit/simulation';
import {gpuSceneBackends, GpuCompute} from 'box3d-webgpu-kit/gpu';
import {hopperSeesawScene, sceneWorldOptions} from 'box3d-webgpu-kit/scene-format';
const hopper = hopperSeesawScene({count: 12});
const scene = {...hopper, grains: hopper.grains.map(g => ({...g, backend: 'gpu'}))};
const world = await createWorld(sceneWorldOptions(scene));
const loaded = loadSimulationScene(world, scene, {gpu: gpuSceneBackends('reference')});
for (let i = 0; i < 12; i++) await loaded.simulation.stepAsync();
await loaded.simulation.pullAsync();
const id = scene.grains[0].id, d = loaded.simulation.diagnostics().subsystems[id], dem = loaded.grains.get(id).granular;
const moved = dem.velocities.some(v => v !== 0);
loaded.simulation.dispose(); world.dispose();
if (d.backend !== 'gpu-reference' || d.steps <= 0 || !moved || typeof GpuCompute !== 'function') { console.error(JSON.stringify({d, moved})); process.exit(1); }
console.log(JSON.stringify({gpu: 'ok', steps: d.steps}));
`);
  writeFileSync(join(app, 'gpu-types.ts'), `/// <reference path="${resolve(pkg, '../../node_modules/@webgpu/types/dist/index.d.ts').replace(/\\/g, '/')}" />
import {acquireGpuCompute, gpuSceneBackends, GpuFluid, FluidF32, type GpuSceneSubsystem} from 'box3d-webgpu-kit/gpu';
import type {SceneGpuBackends} from 'box3d-webgpu-kit/simulation';
const backends: SceneGpuBackends = gpuSceneBackends('reference');
const later: Promise<unknown> = acquireGpuCompute().then(compute => gpuSceneBackends(compute));
void [backends, later, GpuFluid, FluidF32, null as unknown as GpuSceneSubsystem<unknown, unknown>];
`);
  sh('node', [tsc, '--noEmit', '--strict', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--lib', 'es2022,dom', 'gpu-types.ts'], app);
  const gpuOut = sh('node', ['gpu.mjs'], app).trim();
  if (!gpuOut.includes('"gpu":"ok"')) throw new Error(`the ./gpu consumer failed: ${gpuOut}`);
  const out = sh('node', ['game.mjs'], app).trim();

  // Tree shaking: a bundle of a program that uses only the rigid world holds no solver code. Vite (Rolldown) builds it
  // from the installed tarball; every solver names itself with an id ending in -js-f64-v<n>, which survives minifying.
  const shake = join(work, 'shake');
  mkdirSync(join(shake, 'node_modules'), {recursive: true});
  execFileSync('ln', ['-s', join(app, 'node_modules/box3d-webgpu-kit'), join(shake, 'node_modules/box3d-webgpu-kit')]);
  writeFileSync(join(shake, 'package.json'), JSON.stringify({name: 'shake', private: true, type: 'module'}));
  writeFileSync(join(shake, 'index.html'), '<!doctype html><script type="module" src="./main.js"></script>');
  writeFileSync(join(shake, 'main.js'), "import {createWorld} from 'box3d-webgpu-kit';\nconst world = await createWorld({gravity: [0, -9.81, 0]});\nworld.createBody({shape: {kind: 'sphere', radius: 0.5}, position: [0, 2, 0]});\nworld.step();\ndocument.title = String(world.bodyCount());\n");
  sh('node', [resolve(pkg, '../../node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error'], shake);
  const bundle = readdirSync(join(shake, 'dist/assets')).map(String).filter(f => f.endsWith('.js') && !/^box3d-/.test(f));
  const bundled = Buffer.concat(bundle.map(f => readFileSync(join(shake, 'dist/assets', f))));
  const solverIds = [...new Set(bundled.toString('utf8').match(/[a-z][a-z-]+-js-f64-v\d+/g) ?? [])];
  if (solverIds.length) throw new Error(`a rigid-only bundle holds solver code: ${solverIds.join(', ')}`);
  const shaken = gzipSync(bundled, {level: 9}).length;
  if (shaken > BUDGET.rigidBundle) throw new Error(`a rigid-only bundle is ${shaken} bytes of gzip; the budget is ${BUDGET.rigidBundle}`);

  // A CDN-style path: the package's files served as they are, loaded by a plain <script type="module"> with no bundler
  // and no import map. Needs a Chromium that Playwright can start; where there is none this is skipped and says so.
  let cdn = 'skipped (no Playwright Chromium here)';
  try {
    const {createServer} = await import('node:http'), {createRequire} = await import('node:module');
    const {chromium} = createRequire(resolve(pkg, '../../package.json'))('playwright');
    const kitDir = join(app, 'node_modules/box3d-webgpu-kit'), types = {'.js': 'text/javascript', '.wasm': 'application/wasm', '.html': 'text/html', '.json': 'application/json'};
    const page = '<!doctype html><title>loading</title><script type="module">import {createWorld} from "/npm/box3d-webgpu-kit@1/dist/index.js"; const w = await createWorld({gravity: [0, -9.81, 0]}); const b = w.createBody({shape: {kind: "box", halfExtents: [0.5, 0.5, 0.5]}, position: [0, 3, 0]}); for (let i = 0; i < 120; i++) w.step(); document.title = "y=" + w.getState(b).position[1].toFixed(2);</script>';
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://x').pathname;
      if (path === '/') { response.writeHead(200, {'content-type': 'text/html'}); response.end(page); return; }
      try { const file = join(kitDir, path.replace('/npm/box3d-webgpu-kit@1/', '')); if (!file.startsWith(kitDir)) throw new Error('outside'); response.writeHead(200, {'content-type': types[file.slice(file.lastIndexOf('.'))] ?? 'application/octet-stream'}); response.end(readFileSync(file)); }
      catch { response.writeHead(404); response.end(); }
    });
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    let browser = null;
    try {
      browser = await chromium.launch({args: ['--no-sandbox']});
      const tab = await browser.newPage();
      await tab.goto(`http://127.0.0.1:${server.address().port}/`);
      await tab.waitForFunction(() => document.title.startsWith('y='), null, {timeout: 30000});
      const title = await tab.title();
      if (title !== 'y=0.50') throw new Error(`the page loaded from a static path gave ${title}, expected y=0.50`);
      cdn = 'a box falls and rests at y = 0.50 in Chromium';
    } finally { await browser?.close(); server.close(); }
  } catch (error) {
    if (!/Executable doesn't exist|Cannot find module|browserType.launch/.test(String(error?.message))) throw error;
  }

  // Starter templates, created by the installed CLI and run against the tarball.
  const cli = join(app, 'node_modules/.bin/box3d-kit');
  sh(cli, ['init', 'starter-node', '--template', 'node'], work);
  sh('npm', ['install', '--no-audit', '--no-fund', '--offline', join(work, packed.filename)], join(work, 'starter-node'));
  const nodeRun = sh('node', ['game.mjs'], join(work, 'starter-node'));
  if (!/final state hash \d+/.test(nodeRun)) throw new Error(`node template failed:\n${nodeRun}`);
  sh(cli, ['init', 'starter-three', '--template', 'three'], work);
  const three = join(work, 'starter-three');
  // Offline: unpack the tarball as the installed kit and link three/vite from the repo.
  const kitDir = join(three, 'node_modules/box3d-webgpu-kit');
  mkdirSync(kitDir, {recursive: true});
  execFileSync('tar', ['-xzf', join(work, packed.filename), '-C', kitDir, '--strip-components', '1']);
  for (const dep of ['three', 'vite']) execFileSync('ln', ['-s', resolve(pkg, '../../node_modules', dep), join(three, 'node_modules', dep)]);
  sh('node', [resolve(pkg, '../../node_modules/vite/bin/vite.js'), 'build', '--logLevel', 'error'], three);
  const built = readdirSync(join(three, 'dist/assets')).map(String);
  if (!built.some(f => f.endsWith('.wasm')) || !built.some(f => /^box3d-.*\.js$/.test(f))) throw new Error(`three template build is missing wasm assets: ${built.join(', ')}`);
  sh(cli, ['init', 'starter-single', '--template', 'single'], work);
  const single = sh('node', ['--input-type=module', '-e', "const k = await import('./box3d-kit.single.js'); const w = await k.createWorld(); w.spawnBox({position: [0, 2, 0]}); for (let i = 0; i < 90; i++) w.step(); console.log(w.bodyCount())"], join(work, 'starter-single')).trim();
  if (single !== '2') throw new Error(`single template module failed: ${single}`);
  if (!/"shapes"/.test(sh(cli, ['info'], app))) throw new Error('box3d-kit info failed');
  console.log(`sizes within budget: ${Object.entries(size).map(([k, v]) => `${k} ${(v / 1024).toFixed(0)}/${(BUDGET[k] / 1024).toFixed(0)} KiB`).join(', ')}`);
  console.log(`gzip of each import with everything it loads: ${Object.entries(entrySize).map(([k, v]) => `${k === '.' ? 'main' : k.slice(2)} ${(v / 1024).toFixed(1)}/${(BUDGET.entry[k] / 1024).toFixed(0)}`).join(', ')} KiB`);
  console.log(`tree shaking: a rigid-only Vite bundle is ${(shaken / 1024).toFixed(1)} KiB of gzip and holds no solver; plain <script type="module"> from a static path: ${cdn}`);
  console.log(`box3d-kit pack smoke: ${packed.filename} ${(packed.size / 1024).toFixed(0)} KiB packed, ${(packed.unpackedSize / 1024).toFixed(0)} KiB unpacked, ${files.length} files`);
  console.log(`consumer: ${out}; strict TypeScript consumer typechecks (nodenext)`);
  console.log('templates: node runs, three builds with Vite (hashed wasm emitted), single-file module runs; box3d-kit info works');
} finally {
  rmSync(work, {recursive: true, force: true});
}
