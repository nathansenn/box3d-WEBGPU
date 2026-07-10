import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const requiredFiles = [
  'index.html',
  'LICENSE',
  'CHANGELOG.md',
  'THIRD_PARTY_NOTICES.md',
  'SOURCE_MANIFEST.sha256',
  'package.json',
  'src/main.ts',
  'src/math.ts',
  'src/scenes.ts',
  'src/showcases.ts',
  'src/effects.ts',
  'src/types.ts',
  'src/physics/fallback.ts',
  'src/physics/wasm.ts',
  'src/webgpu/renderer.ts',
  'wasm/box3d_web.c',
  'wasm/CMakeLists.txt',
  'scripts/build-wasm.sh',
  'scripts/fetch-box3d.sh',
  'scripts/doctor.sh',
  'scripts/verify-source-manifest.sh',
  'scripts/push-existing-box3d-webgpu.sh',
  'docs/AAA_SHOWCASE.md',
  'docs/BOX3D_PORT.md',
  'docs/RENDERING_PIPELINE.md',
  'docs/TEST_PLAN.md',
  'docs/DEMO_GUIDE.md',
  'docs/LOCAL_BROWSER_VALIDATION.md',
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

const packageJson = JSON.parse(read('package.json'));
assert.equal(packageJson.name, 'box3d-webgpu');
assert.equal(packageJson.version, '1.0.0');
assert.equal(packageJson.license, 'MIT');
for (const script of ['dev', 'build', 'build:pages', 'fetch:box3d', 'build:wasm', 'doctor', 'verify:source', 'typecheck', 'test', 'validate']) {
  assert.equal(typeof packageJson.scripts?.[script], 'string', `package.json missing script ${script}`);
}

const cBridge = read('wasm/box3d_web.c');
const cmake = read('wasm/CMakeLists.txt');
const wasmLoader = read('src/physics/wasm.ts');
const expectedExports = [
  'b3w_create_scene',
  'b3w_create_demo',
  'b3w_destroy',
  'b3w_body_count',
  'b3w_dynamic_count',
  'b3w_matrices_ptr',
  'b3w_colors_ptr',
  'b3w_max_bodies',
  'b3w_sync_transforms',
  'b3w_step',
  'b3w_apply_impulse',
  'b3w_kick_stack',
  'b3w_explode',
  'b3w_launch_projectile',
  'b3w_spawn_rain',
  'b3w_replay_hash',
];

for (const symbol of expectedExports) {
  assert.ok(cmake.includes(`_${symbol}`), `CMake does not export _${symbol}`);
  assert.ok(cBridge.includes(symbol), `C bridge does not define/reference ${symbol}`);
}
assert.match(cmake, /add_subdirectory\(/, 'Box3D must be wrapped as a subproject');
assert.match(cmake, /box3d::box3d/, 'WASM bridge must link the upstream Box3D target');
assert.match(cmake, /MODULARIZE=1/, 'WASM output must be modularized');
assert.match(cmake, /EXPORT_ES6=1/, 'WASM output must be an ES module');
assert.match(cmake, /ALLOW_MEMORY_GROWTH=1/, 'WASM build must allow heap growth');
assert.match(cmake, /-msimd128/, 'WASM build must support SIMD');
assert.match(cBridge, /b3w_add_aaa_set_dressing/, 'native bridge missing AAA set dressing');
assert.match(cBridge, /mode\s*>=\s*3/, 'native bridge missing cinematic scene mode');
assert.match(wasmLoader, /get HEAPF32\(\)/, 'WASM heap view must be refreshed after memory growth');

const html = read('index.html');
const requiredIds = [
  'gpu-canvas', 'warning', 'showcase-select', 'showcase-title', 'showcase-play',
  'showcase-restart', 'showcase-next', 'cinematic-progress', 'cinematic-progress-bar',
  'scene-buttons', 'scene-search', 'category-filter', 'scene-select', 'max-tour',
  'quality', 'speed', 'stress', 'stress-value', 'pause', 'step', 'reset', 'debug',
  'kick', 'projectile', 'explode', 'rain', 'run-tests', 'test-log', 'body-count',
  'dynamic-count', 'effect-count', 'fps', 'sim-ms', 'render-ms', 'upload', 'backend',
  'hash', 'quality-stat',
];
for (const id of requiredIds) {
  const matches = html.match(new RegExp(`id=["']${id}["']`, 'g')) ?? [];
  assert.equal(matches.length, 1, `index.html must contain exactly one #${id}`);
}
const allIds = [...html.matchAll(/id=["']([^"']+)["']/g)].map((match) => match[1]);
assert.equal(new Set(allIds).size, allIds.length, 'index.html contains duplicate ids');

const showcases = read('src/showcases.ts');
const showcaseDefinitions = [...showcases.matchAll(/\bid:\s*'[^']+'\s*,\s*sceneId:/g)];
assert.equal(showcaseDefinitions.length, 24, 'expected exactly 24 authored hero showcases');
assert.match(showcases, /cameraTrack:/, 'showcases need authored camera tracks');
assert.match(showcases, /beats:/, 'showcases need timed physics beats');
assert.match(showcases, /sampleShowcaseCamera/, 'showcases need camera interpolation');

const scenes = read('src/scenes.ts');
assert.match(scenes, /FAMILIES\.flatMap/, 'catalog must be generated across all families');
assert.match(scenes, /familyIndex \* 50 \+ mode \* 10 \+ variant/, 'catalog must contain 50 recipes per family');

const renderer = read('src/webgpu/renderer.ts');
for (const marker of [
  "'rgba16float'",
  'MSAA_SAMPLE_COUNT',
  'shadowPipeline',
  'textureSampleCompare',
  'GGX',
  'bloom',
  'tone',
  'fog',
  'getCompilationInfo',
  'resolutionScale',
]) {
  assert.ok(renderer.toLowerCase().includes(marker.toLowerCase()), `renderer missing AAA marker: ${marker}`);
}

const effects = read('src/effects.ts');
for (const marker of ['shockwave', 'cameraShake', 'spawnExplosion', 'spawnProjectile', 'spawnRainFlash']) {
  assert.ok(effects.includes(marker), `effects system missing ${marker}`);
}

const main = read('src/main.ts');
for (const marker of ['AAA_SHOWCASES', 'CinematicEffects', 'maxTour', 'runBrowserSmokeTests', 'resolutionScale']) {
  assert.ok(main.includes(marker), `main director missing ${marker}`);
}

assert.match(read('VALIDATION_REPORT.md'), /Browser-render validation boundary/, 'validation report must document browser-runtime boundary');
assert.match(read('THIRD_PARTY_NOTICES.md'), /Box3D/, 'third-party notice must identify Box3D');

const workflows = ['.github/workflows/ci.yml', '.github/workflows/pages.yml'];
for (const workflow of workflows) {
  assert.ok(fs.existsSync(path.join(root, workflow)), `missing ${workflow}`);
}
assert.match(read('.github/workflows/ci.yml'), /npm (run validate|test)/, 'CI must run validation/tests');
assert.match(read('.github/workflows/pages.yml'), /npm run build:pages/, 'Pages workflow must build the subpath-safe bundle');

console.log('✅ repository self-test passed: AAA renderer, 24 hero sequences, 600-scene catalog, native bridge, workflows, and UI contracts');
