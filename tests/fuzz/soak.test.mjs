// Soak (docs/ROBUSTNESS.md): coupled scenes of every kind stepped side by side in one WASM instance, with checkpoints,
// restores and reloads in between, for ten minutes of wall-clock time in `npm run fuzz:long` (FUZZ_SOAK=1) and for a
// few seconds in the gate, where it only proves that the soak itself still runs.
//
// Stated bounds, checked throughout:
//   - no NaN in any solver field or rigid body state;
//   - the ledger identity balance = total - exchanged holds to 1e-9 of the largest energy;
//   - in the scenes whose only energy flows are in the ledger (CLOSED below) the balance never rises above its starting
//     value by more than 0.5 % of the largest energy seen: energy is lost to drag and damping, never made;
//   - a checkpoint restored into the scene it came from reproduces the state bit for bit;
//   - in the ten-minute run, the memory a full teardown leaves in use in the WASM heap rises by less than 1 MiB between
//     the teardown after the first quarter and the one at the end, and the JavaScript heap (after a collection) grows
//     by less than 48 MiB over the same span.
// A teardown disposes every scene and destroys every world; what is still allocated after it is the module's own
// memory plus anything leaked. Memory in use is the heap size less the free memory a probe finds by taking 64 KiB
// blocks until the heap would have to grow (and then freeing them). Neither the heap's size nor the memory in use while
// running is a leak measure: Box3D keeps its arrays at their largest size (an emptied churn world kept 10.5 MiB) and
// so do the solvers' scratch arrays, so both rise in steps as rarer peaks come by (in one ten-minute run the heap grew
// 16 -> 24 MiB at about 609 s; docs/ROBUSTNESS.md). The gate's four seconds only report the numbers.
import assert from 'node:assert/strict';
import test from 'node:test';
import {COUPLED_EXAMPLE_SCENES} from '../../src/engine/scene-format.ts';
import {encodeState, readCheckpoint} from '../../src/engine/checkpoint.ts';
import {disposeLabScene, loadLabScene} from '../../src/lab/scene-host.ts';
import {rng} from './lib/rng.mjs';
import {nativePool} from './lib/scene-gen.mjs';
import {randomBody} from './lib/world-program.mjs';

const SECONDS = process.env.FUZZ_SOAK ? Number(process.env.FUZZ_SOAK_SECONDS ?? 600) : 4;
// Measured over 25 s of simulated time each (docs/ROBUSTNESS.md): the largest rise of the balance above its start was
// 0.095 % of the largest energy (hopper-seesaw); the bound is five times that.
const CLOSED = ['moored-buoy', 'cable-stayed-deck', 'buoy-and-crates', 'hopper-seesaw'];
// Energy enters these from outside the ledger (boxes falling onto the platform, a ball on the trampoline, the river's
// inflow), so only finiteness, the identity and exactness are checked for them.
const OPEN = ['suspended-platform', 'trampoline', 'river-bend'];
const INFINITE_BY_DESIGN = /\.(strength\w*|hist|dist(\[\d+\])?|phi|lo|hi)$/;

function scan(value, path) {
  const fine = v => Number.isFinite(v) || ((v === Infinity || v === -Infinity) && INFINITE_BY_DESIGN.test(path));
  if (typeof value === 'number') { if (!fine(value)) throw new Error(`${path} is ${value}`); return; }
  if (ArrayBuffer.isView(value)) { if (value instanceof Float64Array || value instanceof Float32Array) for (let i = 0; i < value.length; i++) if (!fine(value[i])) throw new Error(`${path}[${i}] is ${value[i]}`); return; }
  if (value !== null && typeof value === 'object') for (const key of Object.keys(value)) scan(value[key], `${path}.${key}`);
}

test(`soak: ${SECONDS} s of mixed coupled scenes in one WASM instance`, {timeout: (SECONDS + 300) * 1000}, async () => {
  const pool = await nativePool(), r = rng(20261116), names = [...CLOSED, ...OPEN];
  const slots = names.map(name => { const world = pool.createWorld(); world.retainBodyShapes(true); return {name, world, loaded: null, start: null, scale: 0, steps: 0, worstRise: 0}; });
  let churn = pool.createWorld();
  churn.resetWorld({ground: true});
  const mod = churn.mod;
  const load = slot => {
    if (slot.loaded) disposeLabScene(slot.loaded);
    slot.loaded = loadLabScene(slot.world, COUPLED_EXAMPLE_SCENES[slot.name]());
    const e = slot.loaded.simulation.energy();
    slot.start = e.balance; slot.scale = Math.max(Math.abs(e.total), Math.abs(e.mechanical), Math.abs(e.thermal), 1e-9);
  };
  const check = slot => {
    const e = slot.loaded.simulation.energy();
    for (const value of [e.total, e.exchanged, e.balance, e.mechanical, e.thermal]) assert.ok(Number.isFinite(value), `${slot.name}: the ledger holds ${value} after ${slot.steps} steps`);
    slot.scale = Math.max(slot.scale, Math.abs(e.total), Math.abs(e.mechanical), Math.abs(e.thermal));
    assert.ok(Math.abs(e.balance - (e.total - e.exchanged)) <= 1e-9 * slot.scale, `${slot.name}: balance is not total - exchanged`);
    if (CLOSED.includes(slot.name)) {
      const rise = (e.balance - slot.start) / slot.scale;
      slot.worstRise = Math.max(slot.worstRise, rise);
      assert.ok(rise <= 5e-3, `${slot.name}: the ledger balance rose by ${(rise * 100).toFixed(3)} % of the largest energy after ${slot.steps} steps (bound 0.5 %)`);
    }
  };
  const digest = slot => {
    const bytes = slot.loaded.simulation.checkpoint({scene: false}), tree = readCheckpoint(bytes, 'simulation');
    try { scan(tree.subsystems, 'subsystems'); } catch (error) { assert.fail(`${slot.name} after ${slot.steps} steps: ${error.message}`); }
    return {bytes, text: Buffer.from(encodeState(tree.subsystems)).toString('base64')};
  };
  const inUse = () => {
    const size = mod.HEAPF32.buffer.byteLength, blocks = [];
    while (mod.HEAPF32.buffer.byteLength === size && blocks.length < 65536) { const block = mod._malloc(65536); if (!block) break; blocks.push(block); }
    const grew = mod.HEAPF32.buffer.byteLength !== size;
    for (const block of blocks) mod._free(block);
    // The block that made the heap grow did not fit in the old heap.
    return size - (blocks.length - (grew ? 1 : 0)) * 65536;
  };
  // Dispose every scene and destroy every world, measure, then build them again (the soak goes on from fresh scenes).
  const teardown = rebuild => {
    const running = inUse();
    for (const slot of slots) {
      // A disposed scene leaves its rigid bodies to the world's owner (scene-host.ts); destroying the world frees them.
      disposeLabScene(slot.loaded); slot.loaded = null;
      slot.world.destroy();
    }
    churn.destroy();
    globalThis.gc?.();
    const measured = {running, used: inUse(), wasm: mod.HEAPF32.buffer.byteLength, js: process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers};
    if (rebuild) {
      for (const slot of slots) { slot.world = pool.createWorld(); slot.world.retainBodyShapes(true); load(slot); }
      churn = pool.createWorld(); churn.resetWorld({ground: true});
    } else slots.length = 0;
    return measured;
  };
  for (const slot of slots) load(slot);
  const began = performance.now(), end = began + SECONDS * 1000;
  let settled = null, rounds = 0, restores = 0, reloads = 0, churned = 0;
  try {
    while (performance.now() < end) {
      rounds++;
      for (const slot of slots) { const k = r.int(1, 4); for (let i = 0; i < k; i++) slot.loaded.simulation.step(); slot.steps += k; check(slot); }
      // Rigid churn beside them, in the same heap: bodies of every kind come and go.
      for (let i = 0; i < 6; i++) { churn.createBody(randomBody(r)); churned++; }
      churn.step(1 / 60, 4);
      while (churn.bodyCount() > 40) churn.destroyBody(churn.bodyHandle(r.int(1, churn.bodyCount() - 1)));
      if (rounds % 15 === 0) {
        // Exactness: checkpoint, run on, restore, and the state is the checkpointed one again.
        const slot = r.pick(slots), saved = slot.loaded.simulation.checkpoint(), before = digest(slot).text;
        const ahead = r.int(1, 3);
        for (let i = 0; i < ahead; i++) slot.loaded.simulation.step();
        slot.loaded.simulation.restore(saved);
        assert.equal(digest(slot).text, before, `${slot.name}: restore after ${slot.steps} steps does not reproduce the checkpoint`);
        restores++;
      }
      if (rounds % 40 === 0) { load(r.pick(slots)); reloads++; }
      if (settled === null && performance.now() - began > SECONDS * 250) settled = teardown(true);
    }
    for (const slot of slots) digest(slot);
    const worst = slots.filter(s => CLOSED.includes(s.name)).map(s => `${s.name} ${(s.worstRise * 100).toFixed(4)} %`).join(', ');
    const coupled = slots.reduce((n, s) => n + s.steps, 0);
    const last = teardown(false);
    settled ??= last;
    const grownJs = (last.js - settled.js) / 2 ** 20;
    const mib = bytes => (bytes / 2 ** 20).toFixed(1);
    console.log(`soak: ${((performance.now() - began) / 1000).toFixed(0)} s, ${rounds} rounds, ${coupled} coupled steps, ${churned} rigid bodies churned, ${restores} restores, ${reloads} reloads; ` +
      `WASM heap ${settled.wasm >> 20} -> ${last.wasm >> 20} MiB, in use while running ${mib(settled.running)} -> ${mib(last.running)} MiB, after a teardown ${mib(settled.used)} -> ${mib(last.used)} MiB; ` +
      `JS heap ${(settled.js / 2 ** 20).toFixed(0)} -> ${(last.js / 2 ** 20).toFixed(0)} MiB${globalThis.gc ? '' : ' (no --expose-gc: not collected)'}; largest ledger rise ${worst}`);
    const grownWasm = (last.used - settled.used) / 2 ** 20;
    if (process.env.FUZZ_SOAK) assert.ok(grownWasm < 1, `a teardown left ${grownWasm.toFixed(2)} MiB more in use in the WASM heap at the end than after the first quarter`);
    if (globalThis.gc && process.env.FUZZ_SOAK) assert.ok(grownJs < 48, `the JavaScript heap grew by ${grownJs.toFixed(1)} MiB after the first quarter of the run`);
  } finally {
    for (const slot of slots) { if (slot.loaded) disposeLabScene(slot.loaded); slot.world.destroy(); }
    if (slots.length > 0) churn.destroy();
  }
});
