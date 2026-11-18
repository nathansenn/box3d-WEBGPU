import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  createWorld, loadBox3D, PhysicsWorld, convertMatrices, convertVector, toBox3DFrame, writeInstances,
  boxOutlines, rayLine, SnapshotEncoder, SnapshotDecoder, WorldScheduler,
} from 'box3d-webgpu-kit';
import {syncInstancedMesh} from 'box3d-webgpu-kit/three';

const close = (a, b, eps) => Math.abs(a - b) <= eps;

test('vectors may be tuples, {x,y,z} objects or three.js Vector3', async () => {
  const THREE = await import('three').catch(() => null);
  const world = await createWorld();
  try {
    world.startRecording();
    const a = world.spawnBox({position: {x: 2, y: 3, z: 4}});
    assert.deepEqual(world.getPose(a).position.map(v => +v.toFixed(3)), [2, 3, 4]);
    if (THREE) {
      const b = world.spawnBox({position: new THREE.Vector3(-2, 3, 0), impulse: new THREE.Vector3(0, 1, 0)});
      assert.ok(world.getPose(b));
      assert.ok(world.raycast(new THREE.Vector3(-2, 10, 0), new THREE.Vector3(0, -20, 0)));
    }
    world.explode({x: 0, y: 0, z: 0}, 1, 1);
    const log = world.stopRecording();
    assert.ok(log.commands.every(c => !('position' in c) || Array.isArray(c.position)), 'logs store plain tuples');
    assert.throws(() => world.spawnBox({position: 'up'}), e => e.code === 'INVALID_PAYLOAD');
  } finally { world.dispose(); }
});

test('replayDetailed pinpoints the checkpoint window where a replay diverged', async () => {
  const world = await createWorld({seed: 11});
  const other = await createWorld();
  try {
    world.startRecording({checkpointEvery: 10});
    for (let i = 0; i < 10; i++) world.spawnBox({position: [i - 5, 1, 0], halfSize: 0.4});
    for (let t = 0; t < 150; t++) { if (t === 90) world.explode([0, 0, 0], 8, 6); world.step(); }
    const log = world.stopRecording();
    assert.equal(log.checkpoints.length, 15);
    const clean = other.replayDetailed(log);
    assert.deepEqual({matches: clean.matches, divergence: clean.divergence, compared: clean.checkpointsCompared}, {matches: true, divergence: null, compared: 15});
    const tampered = {...log, commands: log.commands.map(c => c.op === 'explode' ? {...c, strength: 8.0001} : c)};
    const report = other.replayDetailed(tampered);
    assert.equal(report.matches, false);
    assert.deepEqual(report.divergence, {from: 90, to: 100}, 'the explode at tick 90 diverges by the checkpoint at tick 100');
  } finally { world.dispose(); other.dispose(); }
});

test('Symbol.dispose releases the world (and `using` works where supported)', async () => {
  const world = await createWorld();
  assert.equal(typeof world[Symbol.dispose], 'function');
  world[Symbol.dispose]();
  assert.throws(() => world.step(), e => e.code === 'DISPOSED');
  let usingWorks = true, disposed;
  try {
    const run = new Function('createWorld', 'return (async () => { let w; { using x = await createWorld(); w = x; } return w; })()');
    disposed = await run(createWorld);
  } catch (error) { if (error instanceof SyntaxError) usingWorks = false; else throw error; }
  if (usingWorks) assert.throws(() => disposed.step(), e => e.code === 'DISPOSED', '`using` disposed the world at block exit');
});

test('Z-up conversion keeps frames right-handed and round-trips vectors', () => {
  const m = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 2, 3, 1]);
  const out = convertMatrices(m, new Float32Array(16), 1, 'z');
  assert.deepEqual(Array.from(out.subarray(12, 15)), [1, -3, 2]);
  const col = k => [out[k * 4], out[k * 4 + 1], out[k * 4 + 2]];
  const [x, y, z] = [col(0), col(1), col(2)];
  const det = x[0] * (y[1] * z[2] - y[2] * z[1]) - x[1] * (y[0] * z[2] - y[2] * z[0]) + x[2] * (y[0] * z[1] - y[1] * z[0]);
  assert.equal(det, 1, 'rotation stays proper');
  assert.deepEqual(convertVector([0, 1, 0], 'z'), [0, -0, 1], 'Box3D up becomes +Z');
  assert.deepEqual(toBox3DFrame(convertVector([1, 2, 3], 'z'), 'z'), [1, 2, 3]);
});

test('writeInstances streams mat4 data to a GPU queue, skipping unchanged frames', async () => {
  const world = await createWorld();
  try {
    world.spawnBox({position: [0, 3, 0]});
    const calls = [], queue = {writeBuffer: (buffer, offset, data, dataOffset, size) => calls.push({buffer, offset, data: Array.from(data.subarray(dataOffset, dataOffset + size))})};
    const buffer = {size: 64 * 8}, colors = {size: 16 * 8};
    assert.equal(writeInstances(world, queue, buffer, {colorBuffer: colors}), 2);
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].data, Array.from(world.matrices()));
    writeInstances(world, queue, buffer, {colorBuffer: colors});
    assert.equal(calls.length, 2, 'nothing moved: no upload');
    world.step();
    writeInstances(world, queue, buffer, {colorBuffer: colors, offset: 64});
    assert.equal(calls.length, 3, 'moved: matrices only, colors unchanged');
    assert.equal(calls[2].offset, 64);
    assert.equal(writeInstances(world, queue, {size: 64}), 1, 'clamped to what the buffer holds');
    writeInstances(world, queue, {size: 128}, {up: 'z'});
    assert.equal(calls.at(-1).data[13], -world.matrices()[14], 'Z-up conversion applied');
  } finally { world.dispose(); }
});

test('writeInstances output reads back identically from a real WebGPU device (Dawn)', async t => {
  let webgpu;
  try { webgpu = await import('webgpu'); } catch { t.skip('webgpu (Dawn) not installed'); return; }
  Object.assign(globalThis, webgpu.globals);
  // Keep the instance referenced: a collected Dawn instance tears down its adapters.
  const gpu = webgpu.create([]);
  const adapter = await gpu.requestAdapter();
  if (!adapter) { t.skip('no WebGPU adapter'); return; }
  const device = await adapter.requestDevice();
  const world = await createWorld();
  try {
    for (let i = 0; i < 5; i++) world.spawnBox({position: [i, 2 + i, 0], halfSize: 0.3});
    for (let i = 0; i < 30; i++) world.step();
    const size = 64 * 16;
    const storage = device.createBuffer({size, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC});
    const read = device.createBuffer({size, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST});
    const count = writeInstances(world, device.queue, storage, {alpha: 0.5});
    const encoder = device.createCommandEncoder();
    encoder.copyBufferToBuffer(storage, 0, read, 0, size);
    device.queue.submit([encoder.finish()]);
    await read.mapAsync(GPUMapMode.READ);
    const readback = new Float32Array(read.getMappedRange().slice(0, count * 64));
    read.unmap();
    assert.equal(count, 6);
    assert.deepEqual(Array.from(readback), Array.from(world.interpolatedMatrices(0.5)));
  } finally { world.dispose(); device.destroy(); void gpu; }
});

test('boxOutlines draws 12 unit-length edges per cube and rayLine stops at the hit', async () => {
  const world = await createWorld();
  try {
    world.spawnBox({position: [0, 0.5, 0], halfSize: 0.5});
    for (let i = 0; i < 90; i++) world.step();
    const {positions, vertexCount} = boxOutlines(world, {skipGround: true});
    assert.equal(vertexCount, 24);
    for (let v = 0; v < 24; v += 2) {
      const a = positions.subarray(v * 3, v * 3 + 3), b = positions.subarray(v * 3 + 3, v * 3 + 6);
      assert.ok(close(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]), 1, 1e-3), 'edge length = cube size');
    }
    const ys = Array.from({length: 24}, (_, i) => positions[i * 3 + 1]);
    assert.ok(close(Math.min(...ys), 0, 0.01) && close(Math.max(...ys), 1, 0.01), 'cube sits on the ground');
    assert.equal(boxOutlines(world).vertexCount, 48, 'ground included by default');
    const hit = world.raycast([0, 10, 0], [0, -20, 0]);
    const ray = rayLine([0, 10, 0], [0, -20, 0], hit);
    assert.ok(close(ray.positions[4], 1, 0.01), 'ray ends on the cube top');
  } finally { world.dispose(); }
});

test('snapshots: keyframe then tiny deltas for sleeping bodies, sub-millimetre accuracy, order checks', async () => {
  const server = await createWorld({seed: 4});
  try {
    for (let i = 0; i < 150; i++) server.spawnBox({position: [(i % 10) - 4.5, 0.5 + Math.floor(i / 10) * 1.1, (i % 3) * 0.01], halfSize: 0.45});
    const encoder = new SnapshotEncoder(), client = new SnapshotDecoder();
    const key = encoder.encode(server);
    client.apply(key);
    assert.equal(key.byteLength, 20 + Math.ceil(151 / 8) + 151 * 31, 'keyframe: 31 bytes per body');
    const check = () => {
      const a = server.matrices(), b = client.matrices();
      assert.equal(b.length, a.length);
      let worstPos = 0, worstRot = 0;
      for (let o = 0; o < a.length; o += 16) {
        for (const k of [12, 13, 14]) worstPos = Math.max(worstPos, Math.abs(a[o + k] - b[o + k]));
        for (const k of [0, 1, 2, 4, 5, 6, 8, 9, 10]) worstRot = Math.max(worstRot, Math.abs(a[o + k] - b[o + k]));
      }
      assert.ok(worstPos <= 0.5 / 1024 + 1e-6, `position error ${worstPos}`);
      assert.ok(worstRot < 2e-4 * 45, `rotation error ${worstRot}`);
    };
    check();
    for (let i = 0; i < 600 && server.awakeCount() > 0; i++) { server.step(); client.apply(encoder.encode(server)); }
    assert.equal(server.awakeCount(), 0, 'the stack went to sleep');
    check();
    const idle = encoder.encode(server);
    client.apply(idle);
    assert.equal(idle.byteLength, 20 + Math.ceil(151 / 8), 'nothing moved: header and bitset only');
    assert.ok(idle.byteLength < key.byteLength * 0.01);
    server.explode([0, 0, 0], 6, 4);
    server.destroyBody(server.bodyAt(40));
    server.spawnBox({position: [0, 12, 0], halfSize: 0.7});
    for (let i = 0; i < 20; i++) server.step();
    const delta = encoder.encode(server);
    client.apply(delta);
    check();
    const stale = new SnapshotDecoder();
    assert.throws(() => stale.apply(delta), e => e.code === 'INVALID_STATE', 'a delta without its baseline asks for a keyframe');
    stale.apply(encoder.encode(server, {keyframe: true}));
    assert.equal(stale.bodyCount(), server.bodyCount());
    assert.throws(() => client.apply(new Uint8Array(8)), e => e.code === 'INVALID_PAYLOAD');
    const mesh = {count: 0, instanceMatrix: {array: new Float32Array(16 * 256), needsUpdate: false}, instanceColor: null};
    assert.equal(syncInstancedMesh(client, mesh), server.bodyCount(), 'the decoder drives the three adapter');
  } finally { server.dispose(); }
});

test('WorldScheduler keeps within budget, rotates fairly and preserves each world’s total time', async () => {
  let clock = 0;
  const fake = name => ({name, total: 0, update(dt) { this.total += dt; clock += 10; return {steps: 1, alpha: 0, droppedSeconds: 0}; }});
  const a = fake('a'), b = fake('b'), c = fake('c');
  const scheduler = new WorldScheduler({budgetMs: 8, now: () => clock}).add(a).add(b).add(c);
  const frames = [];
  for (let i = 0; i < 6; i++) frames.push(scheduler.update(1 / 60));
  assert.ok(frames.every(f => f.updated === 1 && f.deferred === 2), 'one 10 ms world per 8 ms frame');
  for (const w of [a, b, c]) assert.ok(close(w.total + scheduler.owedSeconds(w), 6 / 60, 1e-12), 'no time lost');
  assert.ok(a.total > 0 && b.total > 0 && c.total > 0, 'every world got a turn');

  const pool = await loadBox3D();
  const direct = new PhysicsWorld(pool, {maxSteps: 64}).resetArena(), scheduled = new PhysicsWorld(pool, {maxSteps: 64}).resetArena();
  try {
    for (const w of [direct, scheduled]) for (let i = 0; i < 6; i++) w.spawnBox({position: [i - 3, 1 + i, 0]});
    let t = 0;
    const slow = new WorldScheduler({budgetMs: 8, now: () => t}).add({update: () => { t += 100; return {steps: 0, alpha: 0, droppedSeconds: 0}; }}).add(scheduled);
    for (let i = 0; i < 120; i++) { direct.update(1 / 60); slow.update(1 / 60); }
    scheduled.update(slow.owedSeconds(scheduled));
    assert.equal(scheduled.tick, direct.tick);
    assert.equal(scheduled.exactHash(), direct.exactHash(), 'deferred stepping reaches the identical state');
  } finally { direct.dispose(); scheduled.dispose(); pool.destroy(); }
});

test('importing every entry point is SSR-safe: no window/document access at import time', () => {
  const out = execFileSync(process.execPath, ['--input-type=module', '-e',
    "await import('box3d-webgpu-kit'); await import('box3d-webgpu-kit/three'); await import('box3d-webgpu-kit/worker'); await import('box3d-webgpu-kit/babylon'); await import('box3d-webgpu-kit/single'); await import('box3d-webgpu-kit/cable'); await import('box3d-webgpu-kit/water'); await import('box3d-webgpu-kit/frame'); await import('box3d-webgpu-kit/gameplay'); console.log(typeof window, typeof document)"],
    {cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8'}).trim();
  assert.equal(out, 'undefined undefined');
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  // Only these read browser globals, and only inside functions the caller invokes.
  // single.js embeds the Emscripten glue, which reads `window` only inside its module factory.
  const callTimeOnly = new Set(['loop.js', 'helpers.js', 'inspector.js', 'single.js']);
  for (const file of readdirSync(dist).filter(f => f.endsWith('.js') && !callTimeOnly.has(f))) {
    const text = readFileSync(dist + file, 'utf8');
    assert.ok(!/\bwindow\b/.test(text), `${file} references window`);
    assert.ok(!/\bdocument\b/.test(text), `${file} references document`);
  }
});
