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
//   - after the first tenth of the run the WASM heap does not grow at all, and the JavaScript heap (after a collection)
//     grows by less than 48 MiB.
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
  const churn = pool.createWorld();
  churn.resetWorld({ground: true});
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
  const heap = () => { globalThis.gc?.(); return {wasm: churn.HEAPF32.buffer.byteLength, js: process.memoryUsage().heapUsed + process.memoryUsage().arrayBuffers}; };
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
      if (settled === null && performance.now() - began > SECONDS * 100) settled = heap();
    }
    for (const slot of slots) digest(slot);
    const last = heap();
    settled ??= last;
    const grownJs = (last.js - settled.js) / 2 ** 20;
    console.log(`soak: ${((performance.now() - began) / 1000).toFixed(0)} s, ${rounds} rounds, ${slots.reduce((n, s) => n + s.steps, 0)} coupled steps, ${churned} rigid bodies churned, ${restores} restores, ${reloads} reloads; ` +
      `WASM heap ${settled.wasm >> 20} -> ${last.wasm >> 20} MiB, JS heap ${(settled.js / 2 ** 20).toFixed(0)} -> ${(last.js / 2 ** 20).toFixed(0)} MiB${globalThis.gc ? '' : ' (no --expose-gc: not collected)'}; ` +
      `largest ledger rise ${slots.filter(s => CLOSED.includes(s.name)).map(s => `${s.name} ${(s.worstRise * 100).toFixed(4)} %`).join(', ')}`);
    assert.equal(last.wasm, settled.wasm, 'the WASM heap grew after the first tenth of the run');
    if (globalThis.gc && process.env.FUZZ_SOAK) assert.ok(grownJs < 48, `the JavaScript heap grew by ${grownJs.toFixed(1)} MiB after the first tenth of the run`);
  } finally {
    for (const slot of slots) { if (slot.loaded) disposeLabScene(slot.loaded); slot.world.destroy(); }
    churn.destroy();
  }
});
