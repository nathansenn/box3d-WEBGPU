import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactDir = path.resolve(process.env.BOX3D_WASM_DIR ?? path.join(root, 'public/box3d'));
const jsPath = path.join(artifactDir, 'box3d.js');
const wasmPath = path.join(artifactDir, 'box3d.wasm');
const provenancePath = path.join(artifactDir, 'BUILD_PROVENANCE.json');
const licensePath = path.join(artifactDir, 'BOX3D_LICENSE.txt');

if (!fs.existsSync(jsPath) || !fs.existsSync(wasmPath)) {
  throw new Error(`Native Box3D artifacts are missing in ${artifactDir}. Run npm run build:wasm first.`);
}
if (!fs.existsSync(provenancePath) || !fs.existsSync(licensePath)) {
  throw new Error(`Native Box3D provenance or license is missing in ${artifactDir}.`);
}

const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
const bridgePath = path.join(root, provenance.bridge?.source ?? '');
if (!fs.existsSync(bridgePath)) {
  throw new Error(`Native Box3D bridge source is missing: ${bridgePath}`);
}
const bridgeDigest = crypto.createHash('sha256').update(fs.readFileSync(bridgePath)).digest('hex');
if (bridgeDigest !== provenance.bridge?.sha256) {
  throw new Error(`Native bridge source does not match BUILD_PROVENANCE.json: ${bridgeDigest}`);
}
for (const [name, filePath] of [['box3d.js', jsPath], ['box3d.wasm', wasmPath]]) {
  const bytes = fs.readFileSync(filePath);
  const digest = crypto.createHash('sha256').update(bytes).digest('hex');
  if (bytes.byteLength !== provenance.artifacts?.[name]?.bytes || digest !== provenance.artifacts?.[name]?.sha256) {
    throw new Error(`${name} does not match BUILD_PROVENANCE.json`);
  }
}

const wasmBinary = fs.readFileSync(wasmPath);
if (!WebAssembly.validate(wasmBinary)) throw new Error(`${wasmPath} is not valid WebAssembly.`);
const imported = await import(`${pathToFileURL(jsPath).href}?v=${Date.now()}`);
const factory = imported.default;
if (typeof factory !== 'function') throw new Error(`${jsPath} did not export an Emscripten module factory.`);
const mod = await factory({ wasmBinary });

const requiredExports = [
  '_b3w_create_scene', '_b3w_step', '_b3w_destroy', '_b3w_body_count',
  '_b3w_dynamic_count', '_b3w_matrices_ptr', '_b3w_colors_ptr',
  '_b3w_max_bodies', '_b3w_transform_version', '_b3w_color_version',
  '_b3w_awake_count', '_b3w_replay_hash', '_b3w_kick_stack', '_b3w_explode',
  '_b3w_launch_projectile', '_b3w_spawn_rain',
];
for (const name of requiredExports) {
  if (typeof mod[name] !== 'function') throw new Error(`Native Box3D module is missing ${name}.`);
}

function assertFiniteStreams(count, sceneId) {
  const matrixStart = Number(mod._b3w_matrices_ptr()) >>> 2;
  const colorStart = Number(mod._b3w_colors_ptr()) >>> 2;
  const heap = mod.HEAPF32;
  for (let i = 0; i < count * 16; i++) {
    if (!Number.isFinite(heap[matrixStart + i])) throw new Error(`scene ${sceneId}: matrix ${i} is not finite`);
  }
  for (let i = 0; i < count * 4; i++) {
    const value = heap[colorStart + i];
    const alphaMaterialChannel = i % 4 === 3;
    const valid = alphaMaterialChannel ? value >= -5 && value <= 8 : value >= 0 && value <= 1;
    if (!Number.isFinite(value) || !valid) {
      throw new Error(`scene ${sceneId}: color ${i} is invalid (${value})`);
    }
  }
}

function catalogPass() {
  const hashes = new Uint32Array(800);
  let bodyFrames = 0;
  let maxBodies = 0;
  let maxScene = -1;
  for (let sceneId = 0; sceneId < 800; sceneId++) {
    const stress = 1 + (sceneId % 5);
    const count = mod._b3w_create_scene(sceneId, stress, (0xc0ffee + sceneId) >>> 0);
    const dynamic = mod._b3w_dynamic_count();
    if (!(count > 0 && count <= mod._b3w_max_bodies() && dynamic >= 0 && dynamic <= count)) {
      throw new Error(`scene ${sceneId}: invalid body counts ${count}/${dynamic}`);
    }
    for (let frame = 0; frame < 3; frame++) mod._b3w_step(1 / 60, 4);
    assertFiniteStreams(count, sceneId);
    hashes[sceneId] = mod._b3w_replay_hash() >>> 0;
    if (hashes[sceneId] === 0) throw new Error(`scene ${sceneId}: zero replay hash`);
    bodyFrames += count * 3;
    if (count > maxBodies) {
      maxBodies = count;
      maxScene = sceneId;
    }
  }
  return { hashes, bodyFrames, maxBodies, maxScene };
}

const started = performance.now();
const first = catalogPass();
const second = catalogPass();
for (let i = 0; i < first.hashes.length; i++) {
  if (first.hashes[i] !== second.hashes[i]) {
    throw new Error(`nondeterministic native scene ${i}: ${first.hashes[i]} != ${second.hashes[i]}`);
  }
}

mod._b3w_create_scene(0, 3, 0x515151);
const beforeInvalidStepHash = mod._b3w_replay_hash() >>> 0;
const beforeInvalidTransformVersion = mod._b3w_transform_version() >>> 0;
const beforeInvalidColorVersion = mod._b3w_color_version() >>> 0;
const beforeInvalidStepCount = mod._b3w_body_count();
const beforeInvalidStepStart = Number(mod._b3w_matrices_ptr()) >>> 2;
const beforeInvalidStepMatrices = mod.HEAPF32.slice(beforeInvalidStepStart, beforeInvalidStepStart + beforeInvalidStepCount * 16);
for (const invalidDt of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 0, -1]) {
  mod._b3w_step(invalidDt, 4);
}
if ((mod._b3w_replay_hash() >>> 0) !== beforeInvalidStepHash) {
  throw new Error('native invalid-timestep guard changed the replay hash');
}
if ((mod._b3w_transform_version() >>> 0) !== beforeInvalidTransformVersion ||
    (mod._b3w_color_version() >>> 0) !== beforeInvalidColorVersion) {
  throw new Error('native invalid-timestep guard changed a stream revision');
}
const afterInvalidStepStart = Number(mod._b3w_matrices_ptr()) >>> 2;
for (let i = 0; i < beforeInvalidStepMatrices.length; i++) {
  if (mod.HEAPF32[afterInvalidStepStart + i] !== beforeInvalidStepMatrices[i]) {
    throw new Error(`native invalid-timestep guard changed matrix float ${i}`);
  }
}
const beforeActions = mod._b3w_body_count();
const beforeActionColorVersion = mod._b3w_color_version() >>> 0;
mod._b3w_kick_stack(8);
mod._b3w_explode(0, 3, 0, 18, 9);
const projectile = mod._b3w_launch_projectile(-12, 6, 0, 24, 2, 0, 0.8);
const rain = mod._b3w_spawn_rain(32, 8, 14);
mod._b3w_step(1 / 60, 4);
if (projectile < 0 || rain !== 32 || mod._b3w_body_count() !== beforeActions + 33) {
  throw new Error('native action ABI smoke test failed');
}
if ((mod._b3w_color_version() >>> 0) === beforeActionColorVersion) {
  throw new Error('native body creation did not advance the independent color revision');
}
assertFiniteStreams(mod._b3w_body_count(), 'actions');
mod._b3w_destroy();

console.log(JSON.stringify({
  result: 'passed',
  artifactDir,
  wasmBytes: wasmBinary.byteLength,
  scenes: 800,
  deterministicReplays: 800,
  bodyFramesPerPass: first.bodyFrames,
  maxBodies: first.maxBodies,
  maxScene: first.maxScene,
  actionSmoke: { projectile, rain },
  streamRevisions: { transform: 'passed', color: 'passed', awakeCount: mod._b3w_awake_count() },
  invalidTimestepGuard: 'passed',
  elapsedMs: performance.now() - started,
}, null, 2));
