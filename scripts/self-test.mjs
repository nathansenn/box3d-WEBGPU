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
  'src/aaa-improvements.ts',
  'src/math.ts',
  'src/scenes.ts',
  'src/material-demos.ts',
  'src/showcases.ts',
  'src/effects.ts',
  'src/types.ts',
  'src/soft/simulations.ts',
  'src/soft/material-presets.ts',
  'src/soft/material-simulation.ts',
  'src/soft/combined-material-simulation.ts',
  'src/soft/kernels.ts',
  'src/soft/packed-surface.ts',
  'src/compression/turboquant.ts',
  'src/assets/ktx2.ts',
  'src/physics/fallback.ts',
  'src/physics/wasm.ts',
  'src/webgpu/renderer.ts',
  'wasm/box3d_web.c',
  'wasm/soft_kernels.c',
  'wasm/CMakeLists.txt',
  'scripts/build-wasm.sh',
  'scripts/build-soft-kernels.sh',
  'scripts/fetch-box3d.sh',
  'scripts/doctor.sh',
  'scripts/c-bridge-syntax-test.sh',
  'scripts/soft-simulation-soak.cjs',
  'scripts/soft-kernel-test.mjs',
  'scripts/soft-kernel-integration-test.cjs',
  'scripts/compile-turboquant-benchmarks.mjs',
  'scripts/generate-source-manifest.sh',
  'benchmarks/turboquant-benchmark.cjs',
  'benchmarks/turboquant-worker-benchmark.cjs',
  'benchmarks/turboquant-worker-thread.cjs',
  'benchmarks/turboquant-report.mjs',
  'scripts/verify-source-manifest.sh',
  'scripts/push-existing-box3d-webgpu.sh',
  'scripts/publish-github.sh',
  'docs/AAA_SHOWCASE.md',
  'docs/AAA_100_IMPROVEMENTS.md',
  'docs/BOX3D_PORT.md',
  'docs/RENDERING_PIPELINE.md',
  'docs/TEST_PLAN.md',
  'docs/DEMO_GUIDE.md',
  'docs/LOCAL_BROWSER_VALIDATION.md',
  'docs/SOFT_BODY_AND_WATER.md',
  'docs/PERFORMANCE_V1.3.md',
  'docs/TURBOQUANT.md',
  'docs/RECONSTRUCTION_V1.8.md',
  'docs/INTEGRATION_V1.9.md',
  'docs/PERFORMANCE_V1.9.md',
  'docs/V1.10_INTEGRATION_AND_TEST_MATRIX.md',
  'benchmarks/baselines/box3d-webgpu-v1.9.0-integration-source.tar.gz',
  'benchmarks/results/v1.10-integration-hotpaths.json',
  'benchmarks/results/rope-batching-qualification.json',
  'benchmarks/results/webgpu-quality-metal.json',
  'benchmarks/results/renderer-startup-metal.json',
  'benchmarks/results/upload-cache-metal.json',
  'scripts/ktx2-runtime-test.mjs',
  'scripts/native-box3d-soak.mjs',
  'scripts/rope-batching-qualification.mjs',
  'scripts/webgpu-quality-benchmark.mjs',
  'scripts/renderer-startup-benchmark.mjs',
  'public/box3d/box3d.js',
  'public/box3d/box3d.wasm',
  'public/box3d/BUILD_PROVENANCE.json',
  'public/box3d/BOX3D_LICENSE.txt',
  'benchmarks/baselines/box3d-webgpu-v1.8.0-source.tar.gz',
  'benchmarks/results/v1.9-fifth-breakthrough-100.json',
  'benchmarks/results/v1.8-v1.9-isolated.json',
  'benchmarks/original-v1.2-v1.9.cjs',
  'benchmarks/results/original-v1.2-v1.9.json',
  'benchmarks/results/original-v1.2-v1.9.md',
  'scripts/check-v1.9-results.mjs',
  'benchmarks/baselines/box3d-webgpu-v1.12.0-source.tar.gz',
  'benchmarks/v113-production-1000.cjs',
  'benchmarks/v113-production-1000-registry.cjs',
  'scripts/check-v1.13-results.mjs',
  'scripts/material-fracture-100.cjs',
  'docs/V1.13_1000_BENCHMARK_MATRIX.md',
  'public/textures/material-noise-bc4.ktx2',
  'public/textures/material-noise-r8.ktx2',
  'public/textures/poliigon-materials-albedo-astc.ktx2',
  'public/textures/poliigon-materials-surface-astc.ktx2',
  'public/textures/poliigon-materials-albedo-rgba8.ktx2',
  'public/textures/poliigon-materials-surface-rgba8.ktx2',
  'public/soft-kernels-simd.wasm',
  'public/soft-kernels-scalar.wasm',
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

const packageJson = JSON.parse(read('package.json'));
assert.equal(packageJson.name, 'box3d-webgpu');
assert.equal(packageJson.version, '1.20.0');
assert.equal(packageJson.license, 'MIT');
const currentVersion = packageJson.version;
const currentMinor = currentVersion.split('.').slice(0, 2).join('.');
const currentGate = `validate:v${currentMinor}`;
const packageLock = JSON.parse(read('package-lock.json'));
assert.equal(packageLock.version, currentVersion, 'package-lock root version must match package.json');
assert.equal(packageLock.packages?.['']?.version, currentVersion, 'package-lock workspace version must match package.json');
for (const script of ['dev', 'build', 'build:pages', 'fetch:box3d', 'build:wasm', 'build:soft-kernels', 'build:poliigon-materials', 'verify:soft-kernels', 'doctor', 'manifest:generate', 'verify:source', 'typecheck', 'test', 'test:ktx2', 'test:webgpu', 'test:webgpu:metal', 'test:soft-kernels', 'test:cbridge', 'test:native-wasm', 'bench:native:rigid-stream', 'test:rope-batching', 'test:material:100', 'test:soft-soak', 'test:soft-soak:wasm', 'test:soft-soak:scalar', 'test:soft-soak:all', 'bench:turboquant', 'bench:turboquant:worker', 'bench:turboquant:all', 'validate:turboquant', 'bench:fifth:100', 'bench:v1.8-v1.9', 'bench:fifth:gate', 'bench:original', 'bench:v1.10:integration', 'bench:v1.10:integration:ci', 'bench:v1.11:soft-gains', 'bench:v1.11:fallback', 'bench:v1.11:100', 'bench:v1.11:gate', 'bench:v1.12:100', 'bench:v1.12:gate', 'bench:v1.12:runtime', 'bench:v1.12:effects', 'bench:v1.12:ui', 'bench:v1.12:native', 'bench:v1.13:1000', 'bench:v1.13:gate', 'validate:hardware', 'validate:v1.8', 'validate:v1.9', 'validate:v1.10', 'validate:v1.11', 'validate:v1.12', 'validate:v1.13', 'validate:v1.14', 'validate:v1.15', 'validate:v1.16', 'validate:v1.17', 'validate:v1.18', 'validate:v1.19', currentGate, 'validate']) {
  assert.equal(typeof packageJson.scripts?.[script], 'string', `package.json missing script ${script}`);
}
assert.match(packageJson.scripts['bench:v1.13:gate'], /check-v1\.13-results\.mjs/, 'frozen v1.13 evidence gate must remain reproducible from the historical source');
assert.ok(!packageJson.scripts['validate:v1.14'].includes('bench:v1.13:gate'), 'v1.14 must not falsely bind changed source to frozen v1.13 evidence');
for (const gate of ['npm test', 'test:soft-soak:all', 'test:native-wasm', 'test:material:100', 'npm run build', 'npm run build:pages', 'npm audit']) {
  assert.ok(packageJson.scripts['validate:v1.14'].includes(gate), `validate:v1.14 missing current gate ${gate}`);
  assert.ok(packageJson.scripts[currentGate].includes(gate), `${currentGate} missing current gate ${gate}`);
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
  'b3w_transform_version',
  'b3w_color_version',
  'b3w_awake_count',
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
assert.match(cBridge, /b3w_scene_fracture_stage/, 'native bridge missing the material-fracture fixture stage');
assert.match(cBridge, /case 15:[\s\S]*?b3w_scene_fracture_stage/, 'native bridge must map the sixteenth family to material fracture');
assert.match(cBridge, /mode\s*>=\s*3/, 'native bridge missing cinematic scene mode');
assert.match(cBridge, /b3World_GetAwakeBodyCount/, 'native bridge must gate settled transform work with Box3D awake counts');
assert.match(cBridge, /if \(awakeBefore == 0\)[\s\S]*?return;/, 'native bridge must skip solver and stream work for a fully settled world');
assert.match(cBridge, /step began awake[\s\S]*?terminal pose is captured exactly/, 'native bridge must retain a full transform capture on the final-sleep step');
assert.match(wasmLoader, /get HEAPF32\(\)/, 'WASM heap view must be refreshed after memory growth');
assert.match(
  wasmLoader,
  /new URL\(relative, document\.baseURI\)/,
  'relative Pages assets must resolve against the document rather than the bundled module',
);

const html = read('index.html');
const requiredIds = [
  'gpu-canvas', 'warning', 'showcase-select', 'showcase-title', 'showcase-play',
  'showcase-restart', 'showcase-next', 'cinematic-progress', 'cinematic-progress-bar',
  'scene-buttons', 'scene-search', 'category-filter', 'scene-select', 'max-tour',
  'quality', 'speed', 'stress', 'stress-value', 'pause', 'step', 'reset', 'debug',
  'kick', 'projectile', 'explode', 'rain', 'run-tests', 'run-turboquant', 'test-log', 'body-count',
  'dynamic-count', 'effect-count', 'soft-system', 'soft-nodes', 'soft-constraints', 'soft-breaks', 'soft-energy', 'fps', 'sim-ms', 'render-ms', 'upload', 'backend',
  'hash', 'quality-stat', 'material-rig', 'material-name', 'material-test',
  'material-load-target', 'material-load-value', 'material-apply', 'material-release',
  'material-cycle', 'material-dent', 'material-load', 'material-strain', 'material-thresholds',
  'material-damage', 'material-dent-depth', 'material-residual-dent', 'material-fragments', 'material-failure',
];
for (const id of requiredIds) {
  const matches = html.match(new RegExp(`id=["']${id}["']`, 'g')) ?? [];
  assert.equal(matches.length, 1, `index.html must contain exactly one #${id}`);
}
const allIds = [...html.matchAll(/id=["']([^"']+)["']/g)].map((match) => match[1]);
assert.equal(new Set(allIds).size, allIds.length, 'index.html contains duplicate ids');
assert.ok(html.includes(`AAA Physics Capability Lab · v${currentVersion}`), `UI release badge must match package v${currentVersion}`);
assert.match(html, /800 deterministic recipes/, 'UI must advertise the complete 800-scene catalog');
assert.match(html, /Run 800 \+ 65 State Tests/, 'UI state-test label must match the stable 800-scene and expanded 65-showcase matrix');

const showcases = read('src/showcases.ts');
const legacyShowcaseDefinitions = [...showcases.matchAll(/\bid:\s*'[^']+'\s*,\s*sceneId:/g)];
assert.equal(legacyShowcaseDefinitions.length, 34, 'expected exactly 34 literal legacy hero showcases');
assert.match(
  showcases,
  /const\s+MATERIAL_DEMO_DEFINITIONS[^=]*=\s*MATERIAL_DEMO_RECIPES\.map\s*\(/s,
  'the 31 material demos must be mapped programmatically into hero definitions',
);
assert.match(
  showcases,
  /const\s+DEFINITIONS[^=]*=\s*\[[\s\S]*?\.\.\.CORE_DEFINITIONS[\s\S]*?\.\.\.MATERIAL_DEMO_DEFINITIONS[\s\S]*?\]/,
  'the public hero registry must combine the 34 legacy and 31 material definitions',
);
assert.match(showcases, /titan-metal-bend-and-dent/, 'showcases need the dedicated metal bend-and-dent hero');
assert.match(showcases, /action: 'dent-strike'/, 'metal dent hero needs an instrumented strike beat');
assert.match(showcases, /materialSequence: 'concrete'/, 'concrete hero needs its physical spall sequence');
assert.match(showcases, /materialSequence: 'glass'/, 'glass hero needs its radial fracture sequence');
assert.match(showcases, /action: 'material-strike'/, 'concrete and glass heroes need direct deterministic strike beats');
assert.match(showcases, /AAA_SIGNATURE_SHOWCASES/, 'showcases need a curated ten-scene signature collection');
assert.match(showcases, /cameraTrack:/, 'showcases need authored camera tracks');
assert.match(showcases, /beats:/, 'showcases need timed physics beats');
assert.match(showcases, /sampleShowcaseCamera/, 'showcases need camera interpolation');

const materialDemos = read('src/material-demos.ts');
const materialDemoEntries = [...materialDemos.matchAll(/\bid:\s*'([^']+)'\s*,\s*kind:\s*'(metal|glass|concrete|combined)'/g)];
const materialDemoIds = materialDemoEntries.map((match) => match[1]);
const materialDemoKinds = materialDemoEntries.map((match) => match[2]);
const countMaterialKind = (kind) => materialDemoKinds.filter((candidate) => candidate === kind).length;
assert.equal(materialDemoEntries.length, 31, 'material demo registry must expose exactly 31 recipes');
assert.equal(new Set(materialDemoIds).size, 31, 'material demo recipe IDs must be unique');
assert.equal(countMaterialKind('metal'), 10, 'material demo registry must expose exactly 10 metal presentations');
assert.equal(countMaterialKind('glass'), 10, 'material demo registry must expose exactly 10 glass presentations');
assert.equal(countMaterialKind('concrete'), 10, 'material demo registry must expose exactly 10 concrete presentations');
assert.equal(countMaterialKind('combined'), 1, 'material demo registry must expose exactly one combined AAA presentation');
assert.match(
  materialDemos,
  /MATERIAL_DEMO_RECIPES[^=]*=\s*\[[\s\S]*?\.\.\.METAL_DEMOS[\s\S]*?\.\.\.GLASS_DEMOS[\s\S]*?\.\.\.CONCRETE_DEMOS[\s\S]*?COMBINED_DEMO[\s\S]*?\]/,
  'material demo registry must preserve the 10/10/10/1 source collections',
);
assert.match(
  materialDemos,
  /new Map\(MATERIAL_DEMO_RECIPES\.map\(\(recipe\) => \[recipe\.id, recipe\]/,
  'material demo lookup map must be derived from the complete recipe registry',
);
for (const marker of ['getMaterialDemoRecipe', 'materialDemoCounts', 'sceneForMaterialDemo', 'getMaterialDemoStagePrimitives', 'apex-materials-proving-ground']) {
  assert.ok(materialDemos.includes(marker), `material demo registry missing ${marker}`);
}

const scenes = read('src/scenes.ts');
assert.match(scenes, /FAMILIES\.flatMap/, 'catalog must be generated across all families');
assert.match(scenes, /familyIndex \* 50 \+ mode \* 10 \+ variant/, 'catalog must contain 50 recipes per family');
assert.match(scenes, /family:\s*'cloth'/, 'catalog must include cloth recipes');
assert.match(scenes, /family:\s*'rope'/, 'catalog must include rope recipes');
assert.match(scenes, /family:\s*'water'/, 'catalog must include water recipes');
assert.match(scenes, /family:\s*'fracture'/, 'catalog must include normalized material-fracture recipes');

const fallback = read('src/physics/fallback.ts');
for (const marker of ['broadphaseOrder', 'broadphaseBounds', 'broadphaseAxisIndex', 'broadphaseCandidateCountValue']) {
  assert.ok(fallback.includes(marker), `preview broadphase missing ${marker}`);
}

const soft = read('src/soft/simulations.ts');
for (const marker of ['ClothSimulation', 'RopeSimulation', 'WaterSimulation', 'SoftSimulationSuite', 'horizontalBroken', 'shallow-water', 'buildSurface', "path: 'gpu-cloth'", "path: 'gpu-water'", 'frameVersion', 'ropeGridResult', 'rebuildRopeGridSegments']) {
  assert.ok(soft.includes(marker), `soft simulation system missing ${marker}`);
}
assert.match(soft, /MAX_SOFT_INSTANCES\s*=\s*3072/, 'soft simulation instance budget must remain explicit for the expanded combined-material presentation');
assert.match(soft, /MAX_WATER_DROPLETS\s*=\s*768/, 'water droplet budget must remain explicit');
assert.match(soft, /breakThreshold/, 'cloth/rope constraints need controlled break thresholds');
assert.match(soft, /solveShallowWater/, 'water system must advance the shallow-water field');
assert.match(soft, /DynamicSurfaceFrame/, 'cloth/water must publish dynamic indexed surfaces');
assert.match(soft, /computeParticleBounds/, 'cloth/rope projectile paths need whole-system broad rejection');

const materialPresets = read('src/soft/material-presets.ts');
const materialSimulation = read('src/soft/material-simulation.ts');
const combinedMaterialSimulation = read('src/soft/combined-material-simulation.ts');
for (const marker of ['MaterialBehaviorPreset', 'MATERIAL_BEHAVIOR_PRESETS', 'tensileYieldStrain', 'tensileBreakStrain', 'compressionYieldStrain', 'compressionBreakStrain']) {
  assert.ok(materialPresets.includes(marker), `material preset system missing ${marker}`);
}
for (const marker of ['MaterialSimulation', "readonly kind = 'fracture'", 'setLoadTarget', 'releaseLoad', 'cycleLoad', 'MaterialFailureTelemetry']) {
  assert.ok(materialSimulation.includes(marker), `material fracture simulation missing ${marker}`);
}
for (const marker of ['CombinedMaterialSimulation', 'COMBINED_MATERIAL_CPU_INSTANCE_BUDGET', 'metal-square-punch-forming', 'glass-ballistic-off-center', 'concrete-flat-slab-punching', 'setMaterialLoadTarget', 'materialStrikeTarget']) {
  assert.ok(combinedMaterialSimulation.includes(marker), `combined AAA material simulation missing ${marker}`);
}
assert.match(
  soft,
  /getMaterialDemoRecipe\(scene\.materialDemoId\)\?\.kind\s*===\s*'combined'[\s\S]*?new CombinedMaterialSimulation/,
  'soft simulation suite must route the combined material recipe into its real three-bay simulation',
);
assert.match(materialPresets, /not Young's modulus|not certified engineering data/i, 'material presets must state their normalized, non-certified boundary');

const softKernels = read('src/soft/kernels.ts');
const softKernelC = read('wasm/soft_kernels.c');
for (const marker of ['loadSoftKernels', 'initializeSoftKernelRuntime', 'SoftKernelModule', 'projectCloth', 'projectRope', 'stepWater']) {
  assert.ok(softKernels.includes(marker), `soft-kernel loader missing ${marker}`);
}
for (const marker of ['soft_cloth_project', 'soft_rope_project', 'soft_water_step']) {
  assert.ok(softKernelC.includes(marker), `soft-kernel C module missing ${marker}`);
}
assert.match(softKernels, /variant:\s*'javascript'/, 'soft-kernel loader must retain the JavaScript fallback');
for (const binary of ['public/soft-kernels-simd.wasm', 'public/soft-kernels-scalar.wasm']) {
  assert.ok(fs.statSync(path.join(root, binary)).size > 0, `${binary} must be non-empty`);
}

const renderer = read('src/webgpu/renderer.ts');
for (const marker of [
  "'rgba16float'",
  'DEFAULT_SAMPLE_COUNT',
  'shadowPipeline',
  'textureSampleCompareLevel',
  'GGX',
  'bloom',
  'tone',
  'fog',
  'getCompilationInfo',
  'resolutionScale',
  'qualityConfiguration',
  'shadowTapCount',
  'surfaceShadowPipeline',
  'clothDescriptor',
  'gpuClothShadowPipeline',
  'gpuClothDescriptor',
  'gpuWaterDescriptor',
  'transparentSolidDescriptor',
  'fsTransparent',
  'GPU_CLOTH_VERTEX_BYTES = 12',
  'GPU_WATER_CELL_BYTES = 12',
  'uploadSoftInstances',
  'uploadRopeGrid',
  'ropeComputeShader',
  'drawIndexed',
  'uploadSurface',
]) {
  assert.ok(renderer.toLowerCase().includes(marker.toLowerCase()), `renderer missing AAA marker: ${marker}`);
}
assert.ok(!/textureSampleCompare\s*\(/.test(renderer), 'PBR solid shader must not use derivative-sensitive textureSampleCompare');
assert.match(renderer, /materialId == 4u \|\| materialId == 6u[\s\S]*?discard;/, 'opaque solid pass must discard glass and dust materials');
assert.match(
  renderer,
  /label:\s*'AAA translucent glass and material-particle pipeline'[\s\S]*?srcFactor:\s*'src-alpha'[\s\S]*?depthWriteEnabled:\s*false/,
  'glass/dust pipeline must blend while reading but not writing scene depth',
);
assert.match(
  renderer,
  /mainPass\.setPipeline\(this\.mainPipelines\.transparentSolid\)[\s\S]*?mainPass\.setPipeline\(this\.mainPipelines\.line\)/,
  'transparent materials must render after opaque/surface geometry and before diagnostic lines',
);
assert.equal((renderer.match(/scene\.viewportBloomShadow\.w <= 0\.001/g) ?? []).length, 3, 'every live shadowed material must skip sampling when shadows are disabled');
assert.ok(!renderer.includes('waterShader'), 'dead packed-water WGSL must not return after water moved to the GPU-state path');
assert.ok(!renderer.includes('waterDescriptor'), 'dead packed-water 1x/4x pipelines must not return');
const wasmPhysics = read('src/physics/wasm.ts');
assert.match(wasmPhysics, /if \(!Number\.isFinite\(dt\) \|\| dt <= 0\) return;[\s\S]*?_b3w_step/, 'WASM wrapper must reject invalid timesteps before entering native Box3D');
assert.ok(/textureSampleCompareLevel\s*\(/.test(renderer), 'PBR solid shader must use textureSampleCompareLevel for WebGPU uniformity safety');
assert.ok(/uvUnclamped/.test(renderer) && /inBounds/.test(renderer), 'shadow shader must mask out-of-bounds samples without per-fragment early return');
assert.match(
  renderer,
  /let uv = vec2<f32>\(input\.uv\.x, 1\.0 - input\.uv\.y\)/,
  'post-processing must flip render-target V exactly once before presentation',
);
assert.match(
  renderer,
  /label:\s*'AAA atmospheric sky pipeline'[\s\S]*?depthStencil:\s*\{\s*format:\s*'depth24plus',\s*depthWriteEnabled:\s*false,\s*depthCompare:\s*'always'\s*\}/,
  'sky pipeline must declare depth24plus compatibility for the shared HDR render pass',
);
assert.match(
  renderer,
  /label:\s*'AAA shadow uniform layout'[\s\S]*?entries:\s*\[\s*\{\s*binding:\s*0,[\s\S]*?buffer:\s*\{\s*type:\s*'uniform'\s*\}[\s\S]*?\][\s\S]*?label:\s*'AAA shadow uniform bind group'/,
  'shadow pass must use a uniform-only bind group and never sample its writable depth attachment',
);
assert.match(renderer, /shadowPass\.setBindGroup\(0, this\.shadowBindGroup\)/, 'shadow pass must bind the isolated shadow bind group');
assert.match(renderer, /if \(safeCount > 0\) \{[\s\S]*?mainPass\.draw\(CUBE_VERTEX_COUNT, safeCount\)/, 'renderer must skip zero-instance solid draw calls');
assert.match(renderer, /var<storage, read> clothPositions/, 'intact cloth must use storage-buffer reconstruction');
assert.match(renderer, /var<storage, read> clothRestPositions/, 'intact cloth strain reconstruction must retain immutable rest positions on the GPU');
assert.match(renderer, /var<storage, read> waterEta/, 'water must use storage-buffer reconstruction');
assert.match(renderer, /@compute\s+@workgroup_size/, 'rope render streams must be expanded by a WebGPU compute pass');
assert.match(renderer, /computePass\.dispatchWorkgroups/, 'renderer must dispatch the rope compute pass before drawing');
assert.match(renderer, /this\.surfaceFrameVersion === surface\.frameVersion/, 'surface uploads must honor frame-version caching');
assert.match(renderer, /this\.softInstanceFrameVersion === frameVersion/, 'soft-instance uploads must honor frame-version caching');
assert.match(renderer, /source\.colorVersion\(\)/, 'rigid material uploads must use an independent color revision');
assert.match(renderer, /if \(matricesChanged\).*?writeFloatBuffer/s, 'rigid matrices must upload only when their transform revision changes');
assert.match(renderer, /if \(colorsChanged\).*?writeFloatBuffer/s, 'rigid materials must upload only when their color revision changes');

const turboQuant = read('src/compression/turboquant.ts');
for (const marker of ['TurboQuantCodec', 'TurboQuantDeltaStream', 'Lloyd-Max', 'Walsh-Hadamard', 'encodeIntoAndReconstruct']) {
  assert.ok(turboQuant.includes(marker), `TurboQuant codec missing ${marker}`);
}
assert.match(turboQuant, /TurboQuantBits\s*=\s*2\s*\|\s*3\s*\|\s*4/, 'TurboQuant must retain explicit 2/3/4-bit modes');
assert.match(turboQuant, /Keep this outside the authoritative solver/, 'TurboQuant source must document its non-authoritative transport boundary');
assert.match(read('src/main.ts'), /runTurboQuantBrowserProbe/, 'browser command deck must expose a target-device TurboQuant probe');
assert.match(read('docs/TURBOQUANT.md'), /Do not enable TurboQuant on the current same-thread|default local frame path remains lossless/i, 'TurboQuant docs must preserve the measured local-path decision');

const manifestGenerator = read('scripts/generate-source-manifest.sh');
const manifestVerifier = read('scripts/verify-source-manifest.sh');
assert.match(manifestGenerator, /--list/, 'manifest generator must expose its canonical release-file list');
assert.match(manifestGenerator, /src\/assets\/ktx2 2\.ts/, 'manifest generator must exclude the user-owned KTX2 source duplicate');
assert.match(manifestVerifier, /generate-source-manifest\.sh --list/, 'manifest verification must reject omitted or stale release files');

for (const publisher of ['scripts/push-existing-box3d-webgpu.sh', 'scripts/publish-github.sh']) {
  const source = read(publisher);
  assert.ok(source.includes(currentGate), `${publisher} must run the complete ${currentGate} validation gate`);
  assert.match(source, /SOURCE_MANIFEST 2\.sha256/, `${publisher} must exclude the user-owned secondary manifest`);
  assert.match(source, /src\/assets\/ktx2 2\.ts/, `${publisher} must exclude the user-owned KTX2 source duplicate`);
}

const effects = read('src/effects.ts');
for (const marker of ['shockwave', 'cameraShake', 'spawnExplosion', 'spawnProjectile', 'spawnRainFlash', 'spawnMetalStrike', 'spawnConcreteSpall', 'spawnGlassFracture']) {
  assert.ok(effects.includes(marker), `effects system missing ${marker}`);
}
assert.match(effects, /setStageProps/, 'effects system must accept backend-neutral AAA stage primitives');

const improvements = read('src/aaa-improvements.ts');
for (const marker of ['AAA_IMPROVEMENTS', 'Expected 100 AAA improvements', 'getAAAStagePrimitives']) {
  assert.ok(improvements.includes(marker), `AAA 100-improvement registry missing ${marker}`);
}
const runtimeImprovementLabels = [...improvements.matchAll(/\['[^']+', '([^']+)', '(?:architecture|lighting|forensics|safety|story)'/g)]
  .map((match) => match[1]);
const documentedImprovements = [...read('docs/AAA_100_IMPROVEMENTS.md').matchAll(/^(\d+)\. (.+)\.$/gm)];
assert.equal(runtimeImprovementLabels.length, 100, 'runtime AAA registry must expose exactly 100 labeled improvements');
assert.equal(documentedImprovements.length, 100, 'AAA production ledger must document exactly 100 numbered improvements');
assert.deepEqual(documentedImprovements.map((match) => Number(match[1])), Array.from({ length: 100 }, (_, index) => index + 1), 'AAA production ledger ordinals must be contiguous');
assert.deepEqual(documentedImprovements.map((match) => match[2]), runtimeImprovementLabels, 'AAA production ledger labels must exactly match runtime registry order');

const main = read('src/main.ts');
for (const marker of ['AAA_SHOWCASES', 'CinematicEffects', 'SoftSimulationSuite', 'SOFT_RENDER_INSTANCE_BUDGET', 'maxTour', 'runStateTests', 'resolutionScale']) {
  assert.ok(main.includes(marker), `main director missing ${marker}`);
}
assert.match(
  main,
  /function stagePrimitivesForScene[\s\S]*?getAAAStagePrimitives\(scene\.id\)[\s\S]*?getMaterialDemoStagePrimitives\(scene\.materialDemoId\)/,
  'scene staging must merge the legacy AAA set with the active material-demo presentation',
);
assert.match(main, /effects\.setStageProps\(stagePrimitivesForScene\(/, 'scene loading must install the merged AAA stage set');
assert.match(main, /maxBodies \+ SOFT_RENDER_INSTANCE_BUDGET \+ MAX_EFFECT_INSTANCES/, 'renderer capacity must reserve complete soft-segment and Ultra effect budgets');
assert.match(main, /AAA improvements \$\{aaaImprovementPassed\}\/\$\{AAA_IMPROVEMENTS\.length\}/, 'in-app validation must exercise and report every AAA improvement contract');
assert.match(main, /target\.closest\(/, 'global controls must ignore interactive and editable targets');
assert.match(main, /event\.isComposing/, 'global controls must ignore IME composition events');
assert.match(main, /if \(!paused\) updateCinematic/, 'pausing the simulation must freeze the cinematic timeline');

const validationReport = read('VALIDATION_REPORT.md');
assert.match(validationReport, /Visible browser acceptance/, 'validation report must document visible browser acceptance');
assert.match(validationReport, /750 \/ 750 scenes/, 'historical v1.13 validation report must retain its completed visible scene sweep without claiming an unrun v1.14 browser pass');
assert.match(validationReport, /v112-visible-browser-acceptance\.json/, 'validation report must link current machine-readable browser evidence');
assert.match(read('THIRD_PARTY_NOTICES.md'), /Box3D/, 'third-party notice must identify Box3D');

const workflows = ['.github/workflows/ci.yml', '.github/workflows/pages.yml'];
for (const workflow of workflows) {
  assert.ok(fs.existsSync(path.join(root, workflow)), `missing ${workflow}`);
}
assert.match(read('.github/workflows/ci.yml'), /npm (run validate|test)/, 'CI must run validation/tests');
assert.ok(read('.github/workflows/ci.yml').includes(currentGate), `CI must document the complete ${currentGate} gate`);
assert.match(read('.github/workflows/ci.yml'), /test:material:100/, 'CI must run the 100-case material fracture gate');
assert.match(read('.github/workflows/pages.yml'), /npm run build:pages/, 'Pages workflow must build the subpath-safe bundle');
assert.match(read('.github/workflows/pages.yml'), /test:native-wasm/, 'Pages must validate the tracked native Box3D artifact before deployment');
assert.match(read('.github/workflows/pages.yml'), /test:material:100/, 'Pages must run the 100-case material fracture gate before deployment');
for (const workflow of workflows) {
  assert.match(read(workflow), /npm run verify:source/, `${workflow} must verify source integrity`);
  assert.ok(read(workflow).includes(currentGate), `${workflow} must name the current ${currentGate} release gate`);
}

for (const releaseDocument of [
  'README.md',
  'VALIDATION_REPORT.md',
  'docs/TEST_PLAN.md',
  'docs/LOCAL_BROWSER_VALIDATION.md',
  '.github/pull_request_template.md',
  'GITHUB_PUBLISH.md',
]) {
  assert.ok(read(releaseDocument).includes(currentGate), `${releaseDocument} must reference the current ${currentGate} gate`);
}
assert.ok(read('VALIDATION_REPORT.md').includes(`v${currentVersion}`), 'validation report title must match package version');
assert.ok(html.includes(`v${currentVersion}`), 'application release badge must match package version');

console.log(`✅ repository self-test passed: v${currentVersion} exact 100-improvement signature-stage registry, safe controls, synchronized pause/director behavior, 10 metal + 10 glass + 10 concrete presentations, one combined AAA materials proving ground, preserved performance evidence, native Box3D WASM, qualified soft kernels, GPU cloth/water, compute-expanded rope/material lattices, upload caches, 65 hero sequences over the stable 800-scene catalog, workflows, and UI contracts`);
