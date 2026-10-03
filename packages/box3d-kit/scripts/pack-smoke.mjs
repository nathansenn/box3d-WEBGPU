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

// Size budgets (bytes). Raise deliberately, in review, never silently.
const BUDGET = {wasm: 512 * 1024, wasmGzip: 210 * 1024, wasmBrotli: 180 * 1024, glue: 24 * 1024, coreJsGzip: 40 * 1024, modulesJsGzip: 24 * 1024, singleGzip: 280 * 1024, packed: 600 * 1024};
const OPTIONAL = ['cable.js', 'water.js', 'frame.js', 'compliant-cable.js', 'linear-water.js', 'closed-water.js', 'frame-element.js', 'frame-runtime.js', 'gameplay.js'];
const jsFiles = () => readdirSync(join(pkg, 'dist'), {recursive: true}).map(String).filter(f => f.endsWith('.js'));
const gzipOf = files => gzipSync(Buffer.concat(files.map(f => readFileSync(join(pkg, 'dist', f)))), {level: 9}).length;
const size = {
  wasm: readFileSync(join(pkg, 'wasm/box3d.wasm')).length,
  wasmGzip: gzipSync(readFileSync(join(pkg, 'wasm/box3d.wasm')), {level: 9}).length,
  wasmBrotli: brotliCompressSync(readFileSync(join(pkg, 'wasm/box3d.wasm'))).length,
  glue: readFileSync(join(pkg, 'wasm/box3d.js')).length,
  singleGzip: gzipSync(readFileSync(join(pkg, 'dist/single.js')), {level: 9}).length,
  // Rigid-body core (what `import 'box3d-webgpu-kit'` pulls in) vs the optional subpath modules.
  coreJsGzip: gzipOf(jsFiles().filter(f => !OPTIONAL.some(m => f.endsWith(m)) && f !== 'single.js')),
  modulesJsGzip: gzipOf(jsFiles().filter(f => OPTIONAL.some(m => f.endsWith(m)))),
};

try {
  const [packed] = JSON.parse(sh('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', work], pkg));
  const files = packed.files.map(f => f.path);
  size.packed = packed.size;
  const over = Object.entries(size).filter(([k, v]) => v > BUDGET[k]);
  if (over.length) throw new Error(`size budget exceeded: ${over.map(([k, v]) => `${k} ${v} > ${BUDGET[k]}`).join(', ')}`);
  for (const required of ['dist/index.js', 'dist/index.d.ts', 'dist/three.js', 'dist/worker.js', 'dist/worker.d.ts', 'dist/babylon.js', 'dist/core/build-info.js', 'dist/shared-frames.js', 'dist/session.js', 'dist/inspector.js', 'api/API.md', 'CHANGELOG.md', 'dist/single.js', 'dist/cable.js', 'dist/water.js', 'dist/frame.js', 'dist/gameplay.js', 'bin/box3d-kit.mjs', 'templates/three/main.js', 'wasm/box3d.js', 'wasm/box3d.wasm', 'LICENSE', 'wasm/BOX3D_LICENSE.txt', 'THIRD_PARTY_NOTICES.md']) {
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
  const out = sh('node', ['game.mjs'], app).trim();

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
  console.log(`box3d-kit pack smoke: ${packed.filename} ${(packed.size / 1024).toFixed(0)} KiB packed, ${(packed.unpackedSize / 1024).toFixed(0)} KiB unpacked, ${files.length} files`);
  console.log(`consumer: ${out}; strict TypeScript consumer typechecks (nodenext)`);
  console.log('templates: node runs, three builds with Vite (hashed wasm emitted), single-file module runs; box3d-kit info works');
} finally {
  rmSync(work, {recursive: true, force: true});
}
