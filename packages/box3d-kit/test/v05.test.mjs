import assert from 'node:assert/strict';
import test from 'node:test';
import {Worker} from 'node:worker_threads';
import {execFileSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  createWorld, EngineError, saveSession, loadSession, mountInspector, formatStats,
  SharedFrameReader, SharedFrameWriter, SnapshotDecoder,
} from 'box3d-webgpu-kit';
import {connectWorld} from 'box3d-webgpu-kit/worker';
import {runMatrix} from '../scripts/runtime-matrix.mjs';
import {startRoomServer} from '../examples/server/room-server.mjs';

const pkgDir = fileURLToPath(new URL('..', import.meta.url));
const workerUrl = new URL('./fixtures/physics.worker.mjs', import.meta.url);
const sleep = ms => new Promise(r => setTimeout(r, ms));

test('a leaked world is reclaimed by the garbage collector, releasing its native slot, with a warning', () => {
  const out = execFileSync(process.execPath, ['--expose-gc', '--input-type=module', '-e', `
    import {loadBox3D, PhysicsWorld, leakReporting} from 'box3d-webgpu-kit';
    const warnings = [];
    leakReporting.warn = m => warnings.push(m);
    const pool = await loadBox3D();
    (() => { new PhysicsWorld(pool).resetArena().spawnBox({position: [0, 2, 0]}); })();
    const kept = new PhysicsWorld(pool);
    for (let i = 0; i < 20 && warnings.length === 0; i++) { gc(); await new Promise(r => setTimeout(r, 20)); }
    const sizeAfterLeak = pool.size;
    kept.dispose(); gc(); await new Promise(r => setTimeout(r, 20));
    console.log(JSON.stringify({warnings: warnings.length, sizeAfterLeak, sizeAfterDispose: pool.size}));
  `], {cwd: pkgDir, encoding: 'utf8'}).trim().split('\n').at(-1);
  assert.deepEqual(JSON.parse(out), {warnings: 1, sizeAfterLeak: 1, sizeAfterDispose: 0}, 'only the leaked world warned; its slot was released');
});

test('seqlock frames are never torn under a concurrently writing thread', async () => {
  const writer = new SharedFrameWriter(64);
  const reader = new SharedFrameReader(writer.buffer);
  const thread = new Worker(`
    const {workerData, parentPort} = require('node:worker_threads');
    const header = new Int32Array(workerData, 0, 8), m = new Float32Array(workerData, 32, 64 * 16);
    let k = 0; const end = Date.now() + 400;
    while (Date.now() < end) {
      Atomics.add(header, 0, 1); k++;
      m.fill(k); header[1] = 64;
      Atomics.add(header, 0, 1);
    }
    parentPort.postMessage(k);
  `, {eval: true, workerData: writer.buffer});
  let frames = 0, torn = 0, last = 0, running = true;
  const done = new Promise(resolve => thread.once('message', k => { running = false; resolve(k); }));
  while (running) {
    if (reader.poll()) {
      frames++;
      const first = reader.matrices[0];
      if (!reader.matrices.subarray(0, 64 * 16).every(v => v === first)) torn++;
      assert.ok(first >= last, 'frames never go backwards');
      last = first;
    }
    await new Promise(r => setImmediate(r));
  }
  const written = await done;
  assert.equal(torn, 0, 'every frame read was internally consistent');
  assert.ok(frames > 10 && written > frames, `read ${frames} complete frames of ${written} written`);
});

test('shared-memory worker: frames arrive without messages, and start() decouples physics from rendering', async () => {
  const remote = await connectWorld(new Worker(workerUrl), {sharedMemory: true, seed: 5});
  try {
    assert.equal(remote.usesSharedMemory, true);
    for (let i = 0; i < 20; i++) await remote.spawnBox({position: [(i % 5) - 2, 1 + Math.floor(i / 5) * 1.2, 0]});
    assert.equal(remote.bodyCount(), 21);
    const before = remote.transformVersion(), y0 = remote.matrices()[16 * 20 + 13];
    await remote.start(120);
    await sleep(400);                               // no requests: the worker steps on its own
    const after = remote.transformVersion(), y1 = remote.matrices()[16 * 20 + 13];
    assert.ok(after > before + 10, `frames kept arriving while idle (${before} -> ${after})`);
    assert.ok(y1 < y0, 'and the top cube fell');
    assert.ok(remote.matrices().every(Number.isFinite));
    await remote.stop();
    const stats = await remote.stats();
    assert.ok(stats.tick > 20, `worker stepped ${stats.tick} ticks on its own clock`);
  } finally { await remote.dispose(); }
});

test('message-passing worker mode still works and matches a local world', async () => {
  const remote = await connectWorld(new Worker(workerUrl), {sharedMemory: false, seed: 8});
  const local = await createWorld({seed: 8});
  try {
    assert.equal(remote.usesSharedMemory, false);
    await remote.spawnBox({position: [0, 4, 0]}); local.spawnBox({position: [0, 4, 0]});
    for (let i = 0; i < 60; i++) { await remote.update(1 / 60); local.update(1 / 60); }
    assert.equal(await remote.exactHash(), local.exactHash());
    await assert.rejects(remote.start(), e => e.code === 'UNSUPPORTED_BACKEND', 'start() needs shared memory');
  } finally { await remote.dispose(); local.dispose(); }
});

test('saved sessions load bit-exactly and refuse other builds unless allowed', async () => {
  const world = await createWorld({seed: 3}), other = await createWorld();
  try {
    world.startRecording({checkpointEvery: 30});
    for (let i = 0; i < 6; i++) world.spawnBox({position: [i - 3, 2, 0]});
    for (let t = 0; t < 120; t++) world.step();
    const file = JSON.parse(JSON.stringify(saveSession(world.stopRecording())));
    assert.equal(file.format, 'box3d-kit-session');
    const report = loadSession(other, file);
    assert.equal(report.matches, true);
    assert.equal(other.exactHash(), world.exactHash());
    const foreign = {...file, wasmSha256: '0'.repeat(64)};
    assert.throws(() => loadSession(other, foreign), e => e instanceof EngineError && e.code === 'INCOMPATIBLE_SAVE');
    assert.equal(loadSession(other, foreign, {allowOtherBuild: true}).matches, true, 'forcing still verifies the result');
    assert.throws(() => loadSession(other, {format: 'nope'}), e => e.code === 'INVALID_PAYLOAD');
  } finally { world.dispose(); other.dispose(); }
});

test('inspector overlay mounts, refreshes from sync or async stats, and unmounts', async () => {
  const appended = [];
  const doc = {createElement: () => ({textContent: '', style: {cssText: ''}, removed: false, remove() { this.removed = true; }})};
  const parent = {appendChild: node => appended.push(node)};
  const world = await createWorld();
  try {
    world.spawnBox({position: [0, 2, 0]});
    world.step();
    const panel = mountInspector(world, {document: doc, parent, intervalMs: 10_000, title: 'Test'});
    await panel.refresh();
    assert.equal(appended.length, 1);
    assert.match(panel.element.textContent, /^Test\nbodies {3}2 \/ 4096/);
    assert.match(panel.element.textContent, /heap {5}\d+\.\d MB/);
    const remoteLike = {stats: async () => world.stats()};
    const second = mountInspector(remoteLike, {document: doc, parent, intervalMs: 10_000});
    await second.refresh();
    assert.match(second.element.textContent, /tick {5}1/);
    panel.unmount(); second.unmount();
    assert.equal(panel.element.removed && second.element.removed, true);
    assert.match(formatStats({...world.stats(), droppedSeconds: 0.25}), /dropped {2}250 ms/);
  } finally { world.dispose(); }
});

test('API reference is current and documents every export', async () => {
  const out = execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/api-docs.mjs', import.meta.url)), '--check'], {encoding: 'utf8'});
  assert.match(out, /current/);
  const docs = readFileSync(new URL('../api/API.md', import.meta.url), 'utf8');
  for (const entry of ['box3d-webgpu-kit', 'box3d-webgpu-kit/three', 'box3d-webgpu-kit/babylon', 'box3d-webgpu-kit/worker']) {
    for (const name of Object.keys(await import(entry))) assert.ok(docs.includes(`### ${name} ·`), `${entry} export ${name} is documented`);
  }
});

test('runtime matrix: every installed runtime produces the identical simulation', () => {
  const {results, agree} = runMatrix();
  const ran = results.filter(r => 'hash' in r);
  assert.ok(ran.length >= 1);
  assert.ok(!results.some(r => r.error), JSON.stringify(results.filter(r => r.error)));
  assert.equal(agree, true, JSON.stringify(ran));
});

test('room server streams decodable snapshots to a client and applies commands', async () => {
  const room = await startRoomServer({sendHz: 60});
  const controller = new AbortController();
  try {
    assert.match(room.url, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'bound to loopback only');
    const response = await fetch(room.url + 'stream', {signal: controller.signal});
    const reader = response.body.getReader(), decoder = new TextDecoder(), view = new SnapshotDecoder();
    let buffered = '', applied = 0;
    const pump = async until => {
      while (!until()) {
        const {value} = await reader.read();
        buffered += decoder.decode(value, {stream: true});
        let cut;
        while ((cut = buffered.indexOf('\n\n')) >= 0) {
          const line = buffered.slice(0, cut); buffered = buffered.slice(cut + 2);
          if (line.startsWith('data: ')) { view.apply(Uint8Array.from(Buffer.from(line.slice(6), 'base64'))); applied++; }
        }
      }
    };
    await pump(() => applied >= 5);
    assert.equal(view.bodyCount(), 49, 'ground + 48 crates');
    assert.equal((await fetch(room.url + 'throw', {method: 'POST'})).status, 204);
    await pump(() => view.bodyCount() === 50);
    const stats = await (await fetch(room.url + 'stats')).json();
    assert.equal(stats.clients, 1);
    const server = room.world.matrices(), client = view.matrices();
    assert.ok(Math.abs(server[13] - client[13]) < 0.01, 'client ground matches server');
    const traversal = await fetch(room.url + '..%2f..%2fpackage.json');
    assert.ok([403, 404].includes(traversal.status), 'no path traversal out of the package');
  } finally { controller.abort(); await room.close(); }
});
