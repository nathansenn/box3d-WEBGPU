import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  createWorld, loadBox3D, PhysicsWorld, EngineError, BUILD_INFO, writeInstances, lastUploadRange,
  spawnBoxes, applyImpulses, BodyRing, detectEnvironment, LICENSE_NOTICE,
} from 'box3d-webgpu-kit';
import {bindThinInstances, syncThinInstances} from 'box3d-webgpu-kit/babylon';
import {CORE, transformCore, repo, pkg} from '../scripts/sync-core.mjs';

const wasmPath = new URL('../wasm/box3d.wasm', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('BUILD_INFO identifies the shipped WASM and the loader can verify it', async () => {
  const bytes = readFileSync(wasmPath);
  assert.equal(BUILD_INFO.wasmSha256, sha(bytes));
  assert.equal(BUILD_INFO.wasmBytes, bytes.length);
  assert.equal(BUILD_INFO.box3dRef, 'v0.1.0');
  const pool = await loadBox3D({integrity: true});
  pool.destroy();
  const tampered = new Uint8Array(bytes);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(loadBox3D({wasmBinary: tampered, integrity: true}), e => e instanceof EngineError && e.code === 'INTEGRITY_MISMATCH');
  await assert.rejects(loadBox3D({integrity: 'ab'.repeat(32)}), e => e.code === 'INTEGRITY_MISMATCH');
});

test('load failures surface as WASM_UNAVAILABLE instead of a silent fallback', async () => {
  await assert.rejects(loadBox3D({moduleUrl: new URL('./does-not-exist.js', import.meta.url)}), e => {
    assert.equal(e.code, 'WASM_UNAVAILABLE');
    assert.ok(e.cause, 'the original error is kept as cause');
    return true;
  });
  await assert.rejects(createWorld({wasmBinary: new Uint8Array([0, 97, 115, 109])}), e => e.code === 'WASM_UNAVAILABLE');
});

test('drift check: packaged core and WASM are exactly what the app sources produce', () => {
  for (const entry of CORE) {
    const expected = transformCore(entry, readFileSync(`${repo}/${entry.from}`, 'utf8'));
    const actual = readFileSync(`${pkg}/src/core/${entry.from.split('/').pop()}`, 'utf8');
    assert.equal(actual, expected, `${entry.from} drifted; run npm run build`);
  }
  for (const name of ['box3d.wasm', 'box3d.js']) {
    assert.equal(sha(readFileSync(`${pkg}/wasm/${name}`)), sha(readFileSync(`${repo}/public/box3d/${name}`)), `${name} differs from public/box3d`);
  }
});

test('public API matches the committed report (api/public-api.txt)', () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/api-report.mjs', import.meta.url)), '--check'], {encoding: 'utf8'});
  assert.match(out, /matches/);
});

test('CSP: the glue and kit use no eval or new Function (needs only wasm-unsafe-eval)', () => {
  const texts = [readFileSync(new URL('../wasm/box3d.js', import.meta.url), 'utf8')];
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  for (const f of readdirSync(dist, {recursive: true}).map(String).filter(f => f.endsWith('.js'))) texts.push(readFileSync(dist + f, 'utf8'));
  for (const text of texts) {
    assert.ok(!/\beval\s*\(/.test(text), 'eval(');
    assert.ok(!/new\s+Function\s*\(/.test(text), 'new Function(');
  }
});

test('fuzz: 3,000 random and hostile calls only raise EngineErrors, and two worlds stay identical', async () => {
  const pool = await loadBox3D();
  const worlds = [new PhysicsWorld(pool).resetArena(), new PhysicsWorld(pool).resetArena()];
  const codes = new Set(['INVALID_PAYLOAD', 'STALE_BODY', 'INVALID_STATE', 'WORLD_CAPACITY', 'ALLOCATION_FAILED']);
  const seen = new Map();
  try {
    for (const [w, world] of worlds.entries()) {
      let seed = 1234567;
      const rand = () => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
      const pick = arr => arr[Math.floor(rand() * arr.length)];
      const num = () => pick([rand() * 20 - 10, rand() * 20 - 10, 0, -0, NaN, Infinity, -Infinity, 1e30, -1e-40, 3]);
      const vec = () => [num(), num(), num()];
      const bodies = [];
      for (let i = 0; i < 3000; i++) {
        const op = Math.floor(rand() * 9);
        try {
          switch (op) {
            case 0: { const b = world.spawnBox({position: [rand() * 16 - 8, rand() * 8 + 1, rand() * 16 - 8], halfSize: pick([0.2, 0.5, 0.01, -1, NaN, 2])}); if (b) bodies.push(b); break; }
            case 1: world.spawnBox({position: vec(), impulse: vec()}); break;
            case 2: if (bodies.length) world.destroyBody(pick(bodies)); break;
            case 3: if (bodies.length) world.applyImpulse(pick(bodies), vec()); break;
            case 4: world.explode(vec(), num(), num()); break;
            case 5: world.raycast(vec(), vec(), {limit: pick([1, 5, 0, 300])}); break;
            case 6: world.overlapBox(vec(), [rand() + 0.1, rand() + 0.1, rand() + 0.1]); break;
            case 7: world.update(pick([1 / 60, 1 / 30, 0, -1, NaN, 5])); break;
            case 8: world.step(); break;
          }
        } catch (error) {
          assert.ok(error instanceof EngineError, `op ${op} threw a non-EngineError: ${error}`);
          assert.ok(codes.has(error.code), `unexpected code ${error.code}`);
          if (w === 0) seen.set(error.code, (seen.get(error.code) ?? 0) + 1);
        }
      }
      world.step();
      assert.ok(world.matrices().every(Number.isFinite), 'no NaN reached the transform stream');
    }
    assert.ok((seen.get('INVALID_PAYLOAD') ?? 0) > 100, 'hostile inputs were actually rejected');
    assert.equal(worlds[0].exactHash(), worlds[1].exactHash(), 'identical fuzz sequences give identical worlds');
    assert.equal(worlds[0].bodyCount(), worlds[1].bodyCount());
  } finally { worlds.forEach(w => w.dispose()); pool.destroy(); }
});

test('changedRowsOnly uploads just the rows that moved', async () => {
  const world = await createWorld();
  try {
    for (let i = 0; i < 50; i++) world.spawnBox({position: [(i % 10) - 4.5, 0.5 + Math.floor(i / 10) * 1.05, 0], halfSize: 0.48});
    for (let i = 0; i < 600 && world.awakeCount() > 0; i++) world.step();
    const writes = [], queue = {writeBuffer: (buffer, offset, data, dataOffset, size) => writes.push({offset, dataOffset, size})};
    const buffer = {size: 64 * 128};
    writeInstances(world, queue, buffer, {changedRowsOnly: true});
    assert.deepEqual(lastUploadRange(), {firstRow: 0, rows: 51}, 'first upload is everything');
    const mover = world.bodyAt(30);
    world.applyImpulse(mover, [0, 0, 5]);
    world.step();
    writeInstances(world, queue, buffer, {changedRowsOnly: true});
    const range = lastUploadRange();
    assert.ok(range.rows >= 1 && range.rows < 51, `only the disturbed rows were uploaded: ${JSON.stringify(range)}`);
    assert.equal(writes.at(-1).offset, range.firstRow * 64);
    writeInstances(world, queue, buffer, {changedRowsOnly: true});
    assert.equal(lastUploadRange().rows, 0, 'nothing new: nothing uploaded');
  } finally { world.dispose(); }
});

test('Babylon thin instances: buffers bound once, Z mirrored for the left-handed default', async () => {
  const world = await createWorld();
  try {
    world.spawnBox({position: [1, 2, 3], halfSize: 0.5});
    const calls = [], buffers = {};
    const mesh = {thinInstanceCount: 0,
      thinInstanceSetBuffer: (kind, buf, stride) => { buffers[kind] = buf; calls.push(['set', kind, stride]); },
      thinInstanceBufferUpdated: kind => calls.push(['updated', kind])};
    bindThinInstances(world, mesh, 16);
    assert.equal(syncThinInstances(world, mesh), 2);
    assert.equal(mesh.thinInstanceCount, 2);
    assert.deepEqual(Array.from(buffers.matrix.subarray(28, 31)), [1, 2, -3], 'left-handed: z mirrored');
    assert.equal(buffers.color[7], 1, 'material tags do not leak into alpha');
    const updates = calls.filter(c => c[0] === 'updated').length;
    syncThinInstances(world, mesh);
    assert.equal(calls.filter(c => c[0] === 'updated').length, updates, 'unchanged: no buffer update');
    world.step();
    syncThinInstances(world, mesh, {rightHanded: true});
    assert.equal(buffers.matrix[30], world.matrices()[30], 'right-handed scenes get matrices unchanged');
    assert.equal(calls.filter(c => c[0] === 'set').length, 2, 'buffers were bound once');
  } finally { world.dispose(); }
});

test('spawnBoxes, applyImpulses and BodyRing manage many bodies', async () => {
  const world = await createWorld();
  try {
    const bodies = spawnBoxes(world, new Float32Array([0, 1, 0, 2, 1, 0, 4, 1, 0]), {halfSize: 0.4});
    assert.equal(bodies.length, 3);
    world.destroyBody(bodies[1]);
    assert.equal(applyImpulses(world, bodies, new Float32Array([0, 5, 0, 0, 5, 0, 0, 5, 0])), 2, 'destroyed body skipped');
    assert.throws(() => spawnBoxes(world, [1, 2]), RangeError);
    const ring = new BodyRing(world, 5);
    const shots = Array.from({length: 12}, (_, i) => ring.spawn({position: [i, 5, -5], halfSize: 0.2}));
    assert.equal(ring.size, 5);
    assert.equal(shots.filter(b => world.isAlive(b)).length, 5, 'oldest shots were recycled');
    assert.ok(world.isAlive(shots[11]) && !world.isAlive(shots[0]));
    ring.clear();
    assert.equal(world.bodyCount(), 3, 'ground + two remaining crates');
  } finally { world.dispose(); }
});

test('detectEnvironment and LICENSE_NOTICE', () => {
  const env = detectEnvironment();
  assert.equal(env.runtime, 'node');
  assert.equal(env.webAssembly, true);
  assert.equal(env.wasmSimd, true, 'Node supports the SIMD the shipped WASM uses');
  assert.equal(env.workers, true);
  assert.match(LICENSE_NOTICE, /Erin Catto/);
  assert.match(LICENSE_NOTICE, /MIT/);
});

test('reserved capacity tiers report bridge memory that scales with capacity', async () => {
  const pool = await loadBox3D();
  try {
    const bytes = [];
    for (const capacity of [4096, 16384, 65536]) {
      const world = new PhysicsWorld(pool, {capacity});
      bytes.push(world.native.capacityInfo().bridgeBufferBytes / capacity);
      world.dispose();
    }
    assert.ok(bytes.every(b => b === bytes[0]), `constant bytes per body slot: ${bytes}`);
  } finally { pool.destroy(); }
});
