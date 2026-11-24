// Compares two builds of the Box3D WebAssembly artifact in one process: that they compute the same thing, and how long a
// step takes in each. Written for build changes that must not change results or step time (docs/WASM_SIZE.md).
//
//   node scripts/wasm-artifact-compare.mjs <oldDir> <newDir>                 hashes, then timing
//   ... --hash-only | --time-only        one of the two
//   ... --runs 11 --ticks 240            timed runs per scene (after one warm-up run) and ticks per run
//   ... --scenes 40,47,347               preset ids (0..799), all at stress 5 and seed 12345
//   ... --name box3d-mt                  compare the pthread artifacts (stepped on the calling thread)
//
// Each directory holds box3d.js and box3d.wasm (for example public/box3d and a copy of it from another commit).
// Hashes: 34 presets over all 16 scene families, 300 ticks; at ticks 1, 2, 30, 60, 120, 240 and 300 the bridge's replay
// hash and the SHA-256 of every body's transform bytes must be equal. Timing: the two builds step the same scene in turns
// of 20 ticks, so that load on the machine falls on both; the ratio new/old is reported per run. Exit code 1 on a difference.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
const args = process.argv.slice(2);
const flag = name => args.includes(name);
const value = (name, fallback) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : fallback; };
const [oldDir, newDir] = args.filter(a => !a.startsWith('--') && !/^\d|,/.test(a)).map(a => path.resolve(a));
const base = value('--name', 'box3d');
async function load(dir) {
  const factory = (await import(pathToFileURL(path.join(dir, `${base}.js`)).href)).default;
  return factory({wasmBinary: fs.readFileSync(path.join(dir, `${base}.wasm`))});
}
const mods = {old: await load(oldDir), new: await load(newDir)};
const HASH_SCENES = value('--scenes') ? value('--scenes').split(',').map(Number) : [0, 7, 40, 47, 52, 97, 103, 147, 151, 199, 204, 249, 251, 290, 303, 347, 353, 399, 402, 441, 455, 490, 507, 549, 551, 599, 603, 649, 652, 699, 701, 749, 750, 799];
const TIME_SCENES = value('--scenes') ? value('--scenes').split(',').map(Number) : [40, 47, 147, 290, 347, 490, 599, 441];
const make = (mod, scene, stress = 5, seed = 12345) => {
  const handle = mod._b3w_world_create() >>> 0;
  if (!handle) throw new Error('world create failed');
  const count = mod._b3w_world_create_scene(handle, scene, stress, seed);
  return {handle, count, step: () => mod._b3w_world_step(handle, 1 / 60, 4), hash: () => mod._b3w_world_replay_hash(handle) >>> 0,
    bytes: () => { mod._b3w_world_sync_transforms?.(handle); const n = mod._b3w_world_body_count(handle), p = Number(mod._b3w_world_matrices_ptr(handle)); return crypto.createHash('sha256').update(new Uint8Array(mod.HEAPF32.buffer, p, n * 64)).digest('hex'); },
    awake: () => mod._b3w_world_awake_count(handle), destroy: () => mod._b3w_world_destroy(handle)};
};
let failed = 0;
if (!flag('--time-only')) {
  const ticks = +value('--hash-ticks', 300), marks = new Set([1, 2, 30, 60, 120, 240, ticks]);
  let compared = 0;
  for (const scene of HASH_SCENES) {
    const a = make(mods.old, scene), b = make(mods.new, scene);
    let ok = a.count === b.count, first = null;
    for (let t = 1; t <= ticks && ok; t++) {
      a.step(); b.step();
      if (marks.has(t)) { compared++; if (a.hash() !== b.hash() || a.bytes() !== b.bytes()) { ok = false; first = t; } }
    }
    console.log(`scene ${String(scene).padStart(3)} bodies ${String(a.count).padStart(5)} ${ok ? 'equal' : `DIFFERENT at tick ${first}`} replay hash ${a.hash().toString(16).padStart(8, '0')} transforms ${a.bytes().slice(0, 16)}`);
    if (!ok) failed++;
    a.destroy(); b.destroy();
  }
  console.log(`hash comparison: ${HASH_SCENES.length} scenes at stress 5, ${compared} checkpoints, ${failed} different`);
}
if (!flag('--hash-only')) {
  const runs = +value('--runs', 5), ticks = +value('--ticks', 240), CHUNK = 20;
  const median = xs => { const s = [...xs].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
  console.log(`timing: ${runs} runs of ${ticks} ticks, the builds alternating every ${CHUNK} ticks; load ${os.loadavg().map(x => x.toFixed(2)).join(' ')}`);
  const all = [];
  for (const scene of TIME_SCENES) {
    const ratios = [], olds = [], news = [];
    let bodies = 0;
    for (let r = 0; r < runs + 1; r++) {            // run 0 warms both builds up and is not counted
      const a = make(mods.old, scene), b = make(mods.new, scene); bodies = a.count;
      let ta = 0, tb = 0, newFirst = r % 2 === 1;
      const advance = (w, n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) w.step(); return performance.now() - t0; };
      for (let done = 0; done < ticks; done += CHUNK) { if (newFirst) { tb += advance(b, CHUNK); ta += advance(a, CHUNK); } else { ta += advance(a, CHUNK); tb += advance(b, CHUNK); } newFirst = !newFirst; }
      if (a.hash() !== b.hash()) { failed++; console.log(`scene ${scene}: replay hashes differ after timing`); }
      a.destroy(); b.destroy();
      if (r > 0) { ratios.push(tb / ta); olds.push(ta / ticks); news.push(tb / ticks); }
    }
    all.push(median(ratios));
    console.log(`scene ${String(scene).padStart(3)} bodies ${String(bodies).padStart(5)} old ${median(olds).toFixed(4)} ms/step new ${median(news).toFixed(4)} ms/step ratio median ${median(ratios).toFixed(4)} min ${Math.min(...ratios).toFixed(4)} max ${Math.max(...ratios).toFixed(4)}`);
  }
  console.log(`timing: median of scene ratios ${median(all).toFixed(4)}, worst ${Math.max(...all).toFixed(4)}; load ${os.loadavg().map(x => x.toFixed(2)).join(' ')}`);
}
console.log(failed ? 'COMPARE_FAILED' : 'COMPARE_OK');
process.exit(failed ? 1 : 0);
