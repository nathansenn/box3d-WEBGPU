import assert from 'node:assert/strict';
import test from 'node:test';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createWorld, capabilities, readPoses, packPoses, readBodyPoses, BUILD_INFO} from 'box3d-webgpu-kit';
import {CompliantCableRuntime, hangingCableDefinition} from 'box3d-webgpu-kit/cable';
import {createClosedWaterArrays, stepClosedWaterCpu} from 'box3d-webgpu-kit/water';
import {FRAME_BACKEND} from 'box3d-webgpu-kit/frame';

const pkg = fileURLToPath(new URL('..', import.meta.url));
const close = (a, b, eps) => Math.abs(a - b) <= eps;

test('pose arrays (SoA, packed 28-byte and per-entity) agree with getPose', async () => {
  const world = await createWorld();
  try {
    const bodies = [];
    for (let i = 0; i < 6; i++) bodies.push(world.spawnBox({position: [i * 1.5 - 4, 2 + i, 0], impulse: [0, 0, i], halfSize: 0.3 + i * 0.05}));
    for (let i = 0; i < 40; i++) world.step();
    const n = world.bodyCount();
    const soa = {positions: new Float32Array(n * 3), rotations: new Float32Array(n * 4), halfExtents: new Float32Array(n * 3)};
    assert.equal(readPoses(world, soa), n);
    const packed = new Float32Array(n * 7);
    assert.equal(packPoses(world, packed), n);
    world.destroyBody(bodies[2]);
    const ecs = {positions: new Float32Array(bodies.length * 3).fill(-99), rotations: new Float32Array(bodies.length * 4)};
    assert.equal(readBodyPoses(world, bodies, ecs), 5, 'the destroyed entity is skipped');
    assert.equal(ecs.positions[2 * 3], -99, 'its slot is untouched');
    for (const [i, body] of bodies.entries()) {
      if (i === 2) continue;
      const pose = world.getPose(body);
      for (let k = 0; k < 3; k++) assert.ok(close(ecs.positions[i * 3 + k], pose.position[k], 1e-6));
      for (let k = 0; k < 4; k++) assert.ok(close(ecs.rotations[i * 4 + k], pose.rotation[k], 1e-5));
    }
    const row5 = 5;
    for (let k = 0; k < 3; k++) assert.ok(close(soa.positions[row5 * 3 + k], packed[row5 * 7 + k], 0));
    assert.ok(close(soa.halfExtents[row5 * 3], 0.3 + 4 * 0.05, 1e-5), 'half extents recovered');
  } finally { world.dispose(); }
});

test('capabilities() reports build identity, modules and honest limits', () => {
  const caps = capabilities();
  assert.equal(caps.build.wasmSha256, BUILD_INFO.wasmSha256);
  assert.deepEqual(caps.limits.shapes, ['box']);
  assert.equal(caps.limits.joints, false);
  for (const m of ['cable', 'water', 'frame', 'single-file']) assert.ok(caps.modules.includes(m));
  assert.equal(caps.environment.runtime, 'node');
});

test('optional modules load from their subpaths and simulate', () => {
  const cable = new CompliantCableRuntime(hangingCableDefinition({segments: 8, length: 2, linearDensity: 0.2, tipMass: 1, axialRigidity: 2e4,
    config: {dt: 1 / 240, substeps: 4, maxIterations: 40, residualTolerance: 1e-10, drag: 2, gravity: [0, -9.81, 0]}}));
  cable.step({ticks: 120});
  const snap = cable.step({ticks: 120});
  assert.equal(snap.tick, 240);
  assert.ok(snap.positions.every(Number.isFinite) && snap.positions[snap.positions.length - 2] < -1.9, 'the cable hangs about 2 m below its support');
  cable.destroy?.();
  const config = {cols: 16, rows: 12, dt: 1 / 120, gravity: 9.81, meanDepth: 1, drag: 0.05, dx: 0.25, dz: 0.25};
  const eta = new Float32Array(16 * 12); eta[16 * 6 + 8] = 0.2;
  const water = createClosedWaterArrays(config, {eta});
  const volume = a => a.eta.reduce((s, v) => s + v, 0);
  const before = volume(water);
  for (let i = 0; i < 240; i++) stepClosedWaterCpu(water, config);
  assert.ok(close(volume(water), before, 1e-4), 'closed basin conserves volume');
  assert.equal(typeof FRAME_BACKEND, 'string');
});

test('dist/single.js is self-contained and matches the regular build bit-for-bit', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'box3d-single-'));
  try {
    writeFileSync(join(dir, 'single.js'), readFileSync(join(pkg, 'dist/single.js')));
    const scenario = `
      const w = await k.createWorld({seed: 77});
      for (let i = 0; i < 30; i++) w.spawnBox({position: [(i % 6) - 2.5, 0.5 + Math.floor(i / 6) * 1.05, 0], halfSize: 0.48});
      w.spawnBox({position: [-10, 2, 0], impulse: [120, 10, 0], halfSize: 0.5});
      for (let t = 0; t < 240; t++) { if (t === 120) w.explode([0, 0, 0], 12, 6); w.step(); }
      console.log(w.exactHash());`;
    const alone = execFileSync(process.execPath, ['--input-type=module', '-e', `const k = await import('./single.js');${scenario}`], {cwd: dir, encoding: 'utf8'}).trim();
    const regular = execFileSync(process.execPath, ['--input-type=module', '-e', `const k = await import('box3d-webgpu-kit');${scenario}`], {cwd: pkg, encoding: 'utf8'}).trim();
    assert.equal(alone, regular);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});

test('box3d-kit init creates each template and refuses a non-empty directory', () => {
  const dir = mkdtempSync(join(tmpdir(), 'box3d-init-'));
  const cli = join(pkg, 'bin/box3d-kit.mjs');
  try {
    for (const template of ['node', 'three', 'single']) {
      const out = execFileSync(process.execPath, [cli, 'init', `game-${template}`, '--template', template], {cwd: dir, encoding: 'utf8'});
      assert.match(out, new RegExp(`Created ${template} project`));
    }
    const nodePkg = JSON.parse(readFileSync(join(dir, 'game-node/package.json'), 'utf8'));
    assert.equal(nodePkg.dependencies['box3d-webgpu-kit'], `^${BUILD_INFO.kitVersion}`);
    assert.equal(nodePkg.name, 'game-node');
    assert.match(readFileSync(join(dir, 'game-three/vite.config.js'), 'utf8'), /host: '127\.0\.0\.1'/, 'dev server binds loopback');
    assert.ok(existsSync(join(dir, 'game-single/box3d-kit.single.js')));
    assert.ok(!readFileSync(join(dir, 'game-three/index.html'), 'utf8').includes('{{'), 'placeholders replaced');
    assert.throws(() => execFileSync(process.execPath, [cli, 'init', 'game-node', '--template', 'node'], {cwd: dir, stdio: 'pipe'}), 'non-empty target refused');
    assert.throws(() => execFileSync(process.execPath, [cli, 'init', 'x', '--template', 'unreal'], {cwd: dir, stdio: 'pipe'}), 'unknown template refused');
    assert.match(execFileSync(process.execPath, [cli, 'info'], {encoding: 'utf8'}), /"wasmSha256"/);
  } finally { rmSync(dir, {recursive: true, force: true}); }
});
