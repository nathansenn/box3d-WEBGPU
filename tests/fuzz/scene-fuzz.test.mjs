// Scene files as untrusted input (docs/ROBUSTNESS.md, docs/SCENE_FORMAT.md).
//
//   random valid scenes:   validate -> canonical text -> hash are stable under key order and idempotent;
//                          load -> save -> reload -> save gives the same file, and the reloaded scene steps to the same
//                          states bit for bit; share links round-trip.
//   random invalid scenes: one leaf of a valid scene (the random ones and every example, rigid and coupled) replaced by
//                          a hostile value. validateScene never throws; each problem carries a JSON pointer that resolves
//                          in the document; a scene that still validates loads and steps, or is refused by an
//                          EngineError that names what it refused. Nothing else may be thrown.
//   hostile structure:     prototype-pollution keys, cycles, deep nesting, sparse and huge arrays, class instances:
//                          refused in bounded time, and Object.prototype stays clean.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COUPLED_EXAMPLE_SCENES, EXAMPLE_SCENES, SCENE_LIMITS, SceneValidationError, canonicalize, decodeSceneLink, encodeSceneLink, encodeSceneLinkSync,
  normalizeScene, saveScene, sceneHash, validateScene,
} from '../../src/engine/scene-format.ts';
import {ENGINE_ERRORS} from '../../src/engine/contracts.ts';
import {disposeLabScene, exactTransformHash, loadLabScene} from '../../src/lab/scene-host.ts';
import {rng, seeds, scale} from './lib/rng.mjs';
import {nativePool, randomScene, resolvePointer, shuffleKeys} from './lib/scene-gen.mjs';
import {mutations} from './lib/misuse.mjs';
import {describe} from './lib/hostile.mjs';

const pool = await nativePool();
const SEEDS = seeds(40, 2000);
const ALL_EXAMPLES = {...EXAMPLE_SCENES, ...COUPLED_EXAMPLE_SCENES};
const engineError = (error, what) => {
  assert.ok(error instanceof Error && error.name === 'EngineError', `${what}: threw ${error?.constructor?.name}: ${String(error?.stack ?? error).slice(0, 400)}`);
  assert.ok(error.code in ENGINE_ERRORS, `${what}: code ${error.code} is not in the taxonomy`);
  assert.ok(error.message.length > 12, `${what}: no helpful message`);
};
const fail = (seed, error) => { error.message = `[seed ${seed}; rerun with FUZZ_SEED=${seed}] ${error.message}`; throw error; };
/** Every problem has a message and a JSON pointer into the document (or to a missing key of an existing parent). */
function checkProblems(problems, doc, what) {
  assert.ok(Array.isArray(problems) && problems.length <= SCENE_LIMITS.problems + 1, `${what}: the problem list is bounded`);
  for (const problem of problems) {
    assert.equal(typeof problem.message, 'string', what); assert.ok(problem.message.length > 3, `${what}: empty message`);
    const at = resolvePointer(doc, problem.path);
    assert.ok(!at.malformed, `${what}: "${problem.path}" is not a JSON pointer (${problem.message})`);
    assert.ok(at.found || at.parent, `${what}: the pointer "${problem.path}" does not resolve in the document (${problem.message})`);
  }
}
const stepHash = (world, loaded, steps) => { for (let i = 0; i < steps; i++) loaded.simulation.step(); return exactTransformHash(world); };

test(`random valid scenes: canonical form, hash, links and load -> save -> reload are exact (${SEEDS.length} scenes)`, async () => {
  const a = pool.createWorld(), b = pool.createWorld();
  a.retainBodyShapes(true); b.retainBodyShapes(true);
  let bodies = 0, joints = 0;
  try {
    for (const seed of SEEDS) {
      const r = rng(seed), scene = randomScene(r);
      try {
        assert.deepEqual(validateScene(scene), [], 'the generated scene is valid');
        const text = canonicalize(scene), hash = sceneHash(scene);
        assert.equal(canonicalize(JSON.parse(text)), text, 'canonical text is a fixed point');
        assert.equal(canonicalize(shuffleKeys(scene, r)), text, 'key order does not change the canonical text');
        assert.equal(sceneHash(JSON.parse(JSON.stringify(shuffleKeys(scene, r)))), hash);
        assert.equal(canonicalize(normalizeScene(scene)), text, 'the normal form is canonical');
        // Share links, stored and compressed.
        assert.equal(canonicalize(decodeSceneLink(encodeSceneLinkSync(scene))), text);
        const link = await encodeSceneLink(scene);
        assert.equal(canonicalize(decodeSceneLink(`https://example.invalid/lab.html#scene=${link}&x=1`)), text);
        assert.match(link, /^[A-Za-z0-9._-]+$/, 'a link needs no escaping');
        // Load, save as described and reload: the same file. Step both: the same states.
        const first = loadLabScene(a, scene), described = saveScene(first.simulation.world, first.builder, {state: false});
        assert.equal(canonicalize(described), text, 'save({state: false}) right after load gives the scene back');
        const second = loadLabScene(b, JSON.parse(canonicalize(described)));
        assert.equal(canonicalize(saveScene(second.simulation.world, second.builder, {state: false})), text);
        const steps = r.int(1, 40);
        assert.equal(stepHash(b, second, steps), stepHash(a, first, steps), `the reloaded scene steps like the original (${steps} steps)`);
        // Save the state mid-run and reload it: valid, canonical, and loadable.
        const live = saveScene(first.simulation.world, first.builder);
        assert.deepEqual(validateScene(live), [], 'a saved running scene is valid');
        const resumed = loadLabScene(b, JSON.parse(canonicalize(live)));
        assert.equal(canonicalize(saveScene(resumed.simulation.world, resumed.builder, {state: false})), canonicalize(live), 'a saved state reloads to the same file');
        for (let row = 0; row < b.bodyCount(); row++) { const s = b.bodyState(b.bodyHandle(row)); assert.ok([...s.position, ...s.rotation, ...s.linearVelocity, ...s.angularVelocity].every(Number.isFinite)); }
        bodies += scene.bodies.length; joints += scene.joints?.length ?? 0;
        disposeLabScene(first); disposeLabScene(second); disposeLabScene(resumed);
      } catch (error) { fail(seed, error); }
    }
  } finally { a.destroy(); b.destroy(); }
  console.log(`scene fuzz: ${SEEDS.length} valid scenes (${bodies} bodies, ${joints} joints) round-tripped`);
});

test('random invalid mutations of valid scenes are reported by JSON pointer, never thrown from inside', () => {
  const world = pool.createWorld();
  world.retainBodyShapes(true);
  const counts = {tried: 0, rejected: 0, stillValid: 0, loaded: 0, refusedAtLoad: 0};
  const loadBudget = {left: scale(120, 6000)};
  const tryScene = (base, label, r, sample) => {
    let index = 0;
    for (const mutation of mutations([base], {})) {
      if (sample < 1 && r.next() > sample) continue;
      const doc = mutation.args[0], what = `${label}: ${mutation.name.replace(/^0\.?/, '/').replace(/\./g, '/')} = ${describe(mutation.bad)}`;
      counts.tried++; index++;
      let problems;
      try { problems = validateScene(doc); } catch (error) { assert.fail(`${what}: validateScene threw ${error?.constructor?.name}: ${error?.message}`); }
      checkProblems(problems, doc, what);
      for (const call of [normalizeScene, canonicalize, sceneHash, encodeSceneLinkSync]) {
        if (problems.length > 0) assert.throws(() => call(doc), error => error instanceof SceneValidationError && error.problems.length > 0, `${what}: ${call.name} must refuse it`);
        else assert.doesNotThrow(() => call(doc), `${what}: ${call.name} of a valid scene`);
      }
      if (problems.length > 0) { counts.rejected++; continue; }
      counts.stillValid++;
      // Still valid: it must build and step, or be refused by a typed error. Building coupled scenes is slow, so sample.
      if (loadBudget.left <= 0 || (base.bodies.length > 40 && index % 7 !== 0)) continue;
      loadBudget.left--;
      let loaded;
      try { loaded = loadLabScene(world, doc); } catch (error) { engineError(error, `${what}: load`); counts.refusedAtLoad++; continue; }
      try {
        for (let i = 0; i < 3; i++) loaded.simulation.step();
        for (let row = 0; row < world.bodyCount(); row++) { const s = world.bodyState(world.bodyHandle(row)); assert.ok([...s.position, ...s.rotation, ...s.linearVelocity].every(Number.isFinite), `${what}: body row ${row} is not finite after 3 steps`); }
        counts.loaded++;
      } catch (error) { if (error.code === 'ERR_ASSERTION') throw error; engineError(error, `${what}: step`); counts.refusedAtLoad++; }
      finally { disposeLabScene(loaded); }
    }
  };
  try {
    for (const seed of SEEDS.slice(0, scale(3, 200))) { const r = rng(seed); try { tryScene(randomScene(r, {bodies: r.int(2, 5)}), `random scene ${seed}`, r, 1); } catch (error) { fail(seed, error); } }
    // Every example scene: all of its top-level sections, sampled where a scene is large.
    for (const [name, make] of Object.entries(ALL_EXAMPLES)) {
      const scene = JSON.parse(JSON.stringify(make())), r = rng(SEEDS[0] ^ name.length), leaves = JSON.stringify(scene).length;
      tryScene(scene, name, r, Math.min(1, scale(1500, 120000) / leaves));
    }
  } finally { world.destroy(); }
  console.log(`scene fuzz: ${counts.tried} mutated scenes; ${counts.rejected} rejected with a pointer, ${counts.stillValid} still valid (${counts.loaded} loaded and stepped, ${counts.refusedAtLoad} refused at load by a typed error)`);
  assert.ok(counts.rejected > 1000 && counts.loaded > 20, JSON.stringify(counts));
});

test('hostile structure is refused in bounded time and Object.prototype stays clean', () => {
  const before = Object.getOwnPropertyNames(Object.prototype).sort().join();
  const valid = () => JSON.parse(JSON.stringify(EXAMPLE_SCENES['newtons-cradle']()));
  const timed = (what, make, limitMs = 2000) => {
    const doc = make(), start = performance.now();
    let problems;
    try { problems = validateScene(doc); } catch (error) { assert.fail(`${what}: validateScene threw ${error?.constructor?.name}: ${error?.message}`); }
    const ms = performance.now() - start;
    assert.ok(ms < limitMs, `${what}: validation took ${ms.toFixed(0)} ms`);
    return problems;
  };
  const refused = (what, make, limitMs) => { const problems = timed(what, make, limitMs); assert.ok(problems.length > 0, `${what}: accepted`); return problems; };

  // Prototype pollution: keys that JSON.parse turns into own properties.
  for (const key of ['__proto__', 'constructor', 'prototype', 'toString', 'hasOwnProperty']) {
    for (const where of ['root', 'world', 'body', 'shape', 'material', 'joint', 'meta']) {
      const text = JSON.stringify(valid()), payload = `"${key}":{"polluted":true,"x":1}`;
      const doc = () => {
        const scene = JSON.parse(text);
        const target = where === 'root' ? scene : where === 'world' ? (scene.world ??= {}) : where === 'body' ? scene.bodies[0] : where === 'shape' ? scene.bodies[0].shape : where === 'material' ? (scene.materials ??= {}) : where === 'joint' ? (scene.joints?.[0] ?? scene) : (scene.meta ??= {});
        return Object.assign(JSON.parse(`{${payload}}`), target) === target ? scene : (Object.defineProperty(target, key, {value: JSON.parse(`{${payload}}`)[key], enumerable: true, configurable: true, writable: true}), scene);
      };
      const problems = timed(`${key} in ${where}`, doc);
      // A material may be named anything the id rule allows except __proto__; everywhere else an unknown key is a problem.
      if (where !== 'material' || key === '__proto__') assert.ok(problems.length > 0, `${key} in ${where}: accepted`);
      assert.equal({}.polluted, undefined, `${key} in ${where} polluted Object.prototype`);
    }
    // In free-form data such keys are data: kept, never merged.
    const scene = valid();
    scene.extensions = JSON.parse(`{"${key}":{"polluted":true},"list":[{"${key}":1}]}`);
    scene.bodies[0].userData = JSON.parse(`{"${key}":{"polluted":true}}`);
    if (validateScene(scene).length === 0) {
      const normal = JSON.parse(canonicalize(scene));
      assert.ok(Object.hasOwn(normal.extensions, key) && Object.hasOwn(normal.bodies[0].userData, key), `${key} in free-form data survives as data`);
      assert.equal(Object.getPrototypeOf(normalizeScene(scene).extensions) === Object.prototype || Object.getPrototypeOf(normalizeScene(scene).extensions) === null, true);
    }
    assert.equal({}.polluted, undefined);
  }
  assert.equal(Object.getOwnPropertyNames(Object.prototype).sort().join(), before, 'Object.prototype gained no property');

  // Depth, cycles, non-JSON values.
  const deep = levels => { let node = {leaf: 1}; for (let i = 0; i < levels; i++) node = i % 2 ? [node] : {n: node}; return node; };
  refused('extensions nested 100,000 deep', () => ({...valid(), extensions: {deep: deep(100000)}}));
  refused('userData nested 100,000 deep', () => { const s = valid(); s.bodies[0].userData = {deep: deep(100000)}; return s; });
  refused('a shape nested 100,000 deep', () => { const s = valid(); s.bodies[0].shape = deep(100000); return s; });
  refused('the scene nested in itself', () => { const s = valid(); s.bodies[0].userData = {self: s}; return s; });
  refused('a cyclic extensions object', () => { const s = valid(); const loop = {}; loop.loop = loop; s.extensions = loop; return s; });
  refused('a cyclic body list', () => { const s = valid(); s.bodies.push(s.bodies); return s; });
  for (const [what, value] of [['a Map', new Map()], ['a Date', new Date(0)], ['a function', () => 1], ['a bigint', 1n], ['a symbol', Symbol('s')], ['a class instance', new (class Thing { x = 1; })()], ['a typed array', new Float32Array(3)], ['NaN', NaN], ['undefined', undefined]]) {
    refused(`${what} as the scene`, () => value);
    refused(`${what} as a body`, () => { const s = valid(); s.bodies[0] = value; return s; });
    refused(`${what} as a position`, () => { const s = valid(); s.bodies[0].position = value; return s; });
    timed(`${what} in userData`, () => { const s = valid(); s.bodies[0].userData = {v: value}; return s; });
  }

  // Counts: over the limits, sparse, and huge-but-declared.
  const body = i => ({id: `x${i}`, shape: {kind: 'sphere', radius: 0.1}, position: [0, 1, 0]});
  refused('65,537 bodies', () => ({format: 'box3d-scene', version: 2, bodies: Array.from({length: 65537}, (_, i) => body(i))}));
  refused('a sparse list of 2^32 - 1 bodies', () => ({format: 'box3d-scene', version: 2, bodies: new Array(2 ** 32 - 1)}));
  refused('a sparse hull of 2^31 points', () => { const s = valid(); s.bodies[0].shape = {kind: 'hull', points: new Array(2 ** 31)}; return s; });
  refused('a sparse mesh', () => { const s = valid(); s.bodies[0].type = 'static'; s.bodies[0].shape = {kind: 'mesh', vertices: new Array(2 ** 30), indices: new Array(2 ** 30)}; return s; });
  refused('a height field that declares 4096 x 4096 with no heights', () => { const s = valid(); s.bodies[0].type = 'static'; s.bodies[0].shape = {kind: 'heightfield', countX: 4096, countZ: 4096, spacing: [1, 1], heights: []}; return s; });
  refused('nine million hull numbers', () => { const s = valid(); s.bodies[0].shape = {kind: 'hull', points: new Array(9_000_000).fill(0.5)}; return s; }, 4000);
  refused('a mesh index beyond the vertices', () => { const s = valid(); s.bodies[0].type = 'static'; s.bodies[0].shape = {kind: 'mesh', vertices: [0, 0, 0, 1, 0, 0, 0, 0, 1], indices: [0, 1, 4294967295]}; return s; });
  refused('a 70,000-character id', () => { const s = valid(); s.bodies[0].id = 'a'.repeat(70000); return s; });
  refused('a megabyte of userData', () => { const s = valid(); s.bodies[0].userData = {blob: 'x'.repeat(1 << 20)}; return s; });
  refused('5,000 materials', () => { const s = valid(); s.materials = Object.fromEntries(Array.from({length: 5000}, (_, i) => [`m${i}`, {density: 1, friction: 0, restitution: 0}])); return s; });
  refused('100 fluids', () => ({...valid(), fluids: new Array(100).fill({})}));
  refused('a sparse coupled section', () => ({...valid(), grains: new Array(2 ** 31)}));
  // Ten thousand separate problems: the list stops at the limit.
  const many = timed('ten thousand broken bodies', () => ({format: 'box3d-scene', version: 2, bodies: Array.from({length: 10000}, () => ({}))}));
  assert.ok(many.length <= SCENE_LIMITS.problems + 1 && /more than/.test(many.at(-1).message));
  assert.equal({}.polluted, undefined);
});

test('share links: truncation, corruption, wrong declarations and decompression bombs are refused in bounded time', async () => {
  const {deflateRawSync} = await import('node:zlib');
  const scene = EXAMPLE_SCENES['domino-run'](), link = await encodeSceneLink(scene), stored = encodeSceneLinkSync(scene);
  assert.equal(link.slice(0, 5), 'b3s1d'); assert.equal(stored.slice(0, 5), 'b3s1r');
  const refuse = (text, what, limitMs = 1500) => {
    const start = performance.now();
    let thrown; try { decodeSceneLink(text); } catch (error) { thrown = error; }
    const ms = performance.now() - start;
    assert.ok(thrown, `${what}: accepted`);
    engineError(thrown, what);
    assert.ok(ms < limitMs, `${what}: took ${ms.toFixed(0)} ms`);
  };
  const r = rng(SEEDS[0]);
  for (const base of [link, stored]) {
    for (let cut = 0; cut < base.length; cut += Math.max(1, Math.floor(base.length / scale(300, 3000)))) refuse(base.slice(0, cut), `cut to ${cut} of ${base.length} characters`);
    for (let i = 0; i < scale(600, 20000); i++) {
      const at = r.int(0, base.length - 1), with_ = r.pick([...'ABCxyz019-_.', ' ', '%', '+', '/', '=', '\n', 'é', '']);
      const bad = base.slice(0, at) + with_ + base.slice(at + 1);
      if (bad === base) continue;
      let ok = false; try { ok = canonicalize(decodeSceneLink(bad)) === canonicalize(scene); } catch (error) { engineError(error, `character ${at} replaced by ${JSON.stringify(with_)}`); continue; }
      // A change that leaves the decoded scene identical is only possible outside the link itself (none here) or in base64 bits that carry no data.
      assert.ok(ok, `character ${at} replaced by ${JSON.stringify(with_)}: decoded to a different scene without an error`);
    }
  }
  const [, length, crc, data] = /^b3s1d\.([0-9a-z]+)\.([0-9a-f]{8})\.(.*)$/.exec(link);
  refuse(`b3s1d.${(parseInt(length, 36) + 1).toString(36)}.${crc}.${data}`, 'a declared length one too long');
  refuse(`b3s1d.${(parseInt(length, 36) - 1).toString(36)}.${crc}.${data}`, 'a declared length one too short');
  refuse(`b3s1d.${length}.${crc === '00000000' ? '00000001' : '00000000'}.${data}`, 'a wrong checksum');
  refuse(`b3s1r.${length}.${crc}.${data}`, 'compressed data declared as stored');
  refuse(`b3s2d.${length}.${crc}.${data}`, 'an unknown link version');
  refuse(`b3s1z.${length}.${crc}.${data}`, 'an unknown encoding');
  refuse(`b3s1d.zzzzzzzzzzzz.${crc}.${data}`, 'an absurd declared length');
  refuse(`b3s1d.${(SCENE_LIMITS.linkSceneBytes + 1).toString(36)}.${crc}.${data}`, 'a declared length above the cap');
  for (const bad of [null, undefined, 7, {}, [], '', 'not a link', 'b3s1d', 'b3s1d...', 'b3s1d.1.00000000.']) refuse(bad, `decodeSceneLink(${JSON.stringify(bad)})`);
  // Decompression bombs: a few kilobytes of DEFLATE that expand to hundreds of megabytes. The decoder must stop at the
  // declared length (at most the 4 MiB cap), not inflate first and check afterwards.
  const b64 = bytes => Buffer.from(bytes).toString('base64url');
  const bomb = deflateRawSync(Buffer.alloc(256 << 20), {level: 9});
  assert.ok(bomb.length < 400000, `the bomb is ${bomb.length} bytes of DEFLATE`);
  const heapBefore = process.memoryUsage().arrayBuffers;
  refuse(`b3s1d.${(1000).toString(36)}.00000000.${b64(bomb)}`, 'a 256 MiB bomb declared as 1,000 bytes');
  refuse(`b3s1d.${SCENE_LIMITS.linkSceneBytes.toString(36)}.00000000.${b64(bomb)}`, 'a 256 MiB bomb declared at the cap', 4000);
  assert.ok(process.memoryUsage().arrayBuffers - heapBefore < 64 << 20, 'refusing a bomb allocates at most the cap, not the bomb');
  // Valid DEFLATE of valid JSON that is not a scene, and of JSON nested deeper than the parser's stack.
  const wrap = text => { const raw = Buffer.from(text); let c = 0xFFFFFFFF; for (const byte of raw) { c ^= byte; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; } return `b3s1d.${raw.length.toString(36)}.${((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0')}.${b64(deflateRawSync(raw))}`; };
  refuse(wrap('{"format":"not-a-scene"}'), 'JSON that is not a scene');
  refuse(wrap('[]'), 'an array');
  refuse(wrap('nonsense'), 'text that is not JSON');
  refuse(wrap('['.repeat(200000) + ']'.repeat(200000)), 'JSON nested 200,000 deep', 4000);
  refuse(wrap(`{"format":"box3d-scene","version":2,"bodies":[],"extensions":${'{"a":'.repeat(5000)}1${'}'.repeat(5000)}}`), 'extensions nested 5,000 deep', 4000);
  refuse(wrap('{"format":"box3d-scene","version":2,"bodies":[],"__proto__":{"polluted":true}}'), 'a __proto__ key at the root');
  assert.equal({}.polluted, undefined);
  // A long text around a link, and a text with many near-links: the search stays linear.
  assert.equal(canonicalize(decodeSceneLink(`${'x '.repeat(100000)}${link} ${'y'.repeat(100000)}`)), canonicalize(scene));
  refuse('b3s1d.'.repeat(170000), 'a megabyte of link prefixes');
  refuse(`${'b3s1'.repeat(250000)}`, 'a megabyte of half prefixes');
  refuse('a'.repeat(SCENE_LIMITS.linkChars + 5000), 'text longer than any link');
});
