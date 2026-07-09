import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const requiredFiles = [
  'index.html',
  'src/main.ts',
  'src/physics/fallback.ts',
  'src/physics/wasm.ts',
  'src/webgpu/renderer.ts',
  'wasm/box3d_web.c',
  'scripts/build-wasm.sh',
  'docs/TEST_PLAN.md',
  'docs/DEMO_GUIDE.md',
];

for (const file of requiredFiles) {
  assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`);
}

const buildScript = fs.readFileSync(path.join(root, 'scripts/build-wasm.sh'), 'utf8');
const cBridge = fs.readFileSync(path.join(root, 'wasm/box3d_web.c'), 'utf8');
const expectedExports = [
  'b3w_create_scene',
  'b3w_create_demo',
  'b3w_body_count',
  'b3w_dynamic_count',
  'b3w_matrices_ptr',
  'b3w_colors_ptr',
  'b3w_step',
  'b3w_kick_stack',
  'b3w_explode',
  'b3w_launch_projectile',
  'b3w_spawn_rain',
  'b3w_replay_hash',
];

for (const symbol of expectedExports) {
  assert.ok(buildScript.includes(`_${symbol}`), `build script does not export _${symbol}`);
  assert.ok(cBridge.includes(symbol), `C bridge does not define/reference ${symbol}`);
}

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const id of ['gpu-canvas', 'scene-buttons', 'scene-search', 'category-filter', 'scene-select', 'max-tour', 'run-tests', 'stress', 'projectile', 'explode']) {
  assert.ok(html.includes(`id="${id}"`), `index.html missing #${id}`);
}

console.log('✅ repository self-test passed');
