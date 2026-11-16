// castRays(): closest hits of many rays from flat arrays into flat arrays. Every ray must give exactly what the
// object form gives (raycast(), which is a queryBatch of one ray with limit 1): the same fraction, point, normal and
// body, bit for bit, for boxes, spheres, capsules, hulls, compounds, a triangle mesh and a height field, with and
// without filters, across the bridge's 128-query batch boundary. Queries never change the simulation state.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld} from 'box3d-webgpu-kit';

/** mulberry32 */
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
async function sceneWorld() {
  const world = await createWorld({gravity: [0, -9.81, 0], ground: true, seed: 7});
  const random = rng(11), bodies = [];
  const at = () => [(random() - 0.5) * 16, 0.5 + random() * 6, (random() - 0.5) * 16];
  for (let i = 0; i < 12; i++) bodies.push(world.createBody({shape: {kind: 'box', halfExtents: [0.3 + random() * 0.4, 0.3 + random() * 0.4, 0.3 + random() * 0.4]}, position: at(), rotation: [0, Math.sin(i / 2), 0, Math.cos(i / 2)]}));
  for (let i = 0; i < 12; i++) bodies.push(world.createBody({shape: {kind: 'sphere', radius: 0.3 + random() * 0.4}, position: at()}));
  for (let i = 0; i < 8; i++) bodies.push(world.createBody({shape: {kind: 'capsule', radius: 0.25, halfLength: 0.5}, position: at(), rotation: [Math.sin(i / 3), 0, 0, Math.cos(i / 3)]}));
  for (let i = 0; i < 6; i++) bodies.push(world.createBody({shape: {kind: 'hull', points: [0, 0.6, 0, 0.5, -0.4, 0.5, -0.5, -0.4, 0.5, 0.5, -0.4, -0.5, -0.5, -0.4, -0.5]}, position: at()}));
  bodies.push(world.createBody({shape: {kind: 'compound', shapes: [{shape: {kind: 'sphere', radius: 0.4}, position: [0.6, 0, 0]}, {shape: {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, position: [-0.6, 0, 0]}]}, position: [0, 9, 0]}));
  bodies.push(world.createBody({type: 'static', shape: {kind: 'mesh', vertices: [-3, 0, -3, 3, 0, -3, 3, 1, 3, -3, 1, 3], indices: [0, 2, 1, 0, 3, 2]}, position: [14, 0, 0]}));
  bodies.push(world.createBody({type: 'static', shape: {kind: 'heightfield', heights: [0, 1, 0, 1, 2, 1, 0, 1, 0], countX: 3, countZ: 3, spacing: [2, 2]}, position: [-16, 0, -2]}));
  // A few steps, so the bodies are mid-fall and the broad phase holds moved proxies.
  for (let i = 0; i < 5; i++) world.step();
  return {world, bodies};
}
function rays(count, seed) {
  const random = rng(seed), origins = new Float32Array(count * 3), translations = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = random() * 2 * Math.PI, o = [Math.cos(a) * 24, random() * 12, Math.sin(a) * 24], t = [(random() - 0.5) * 30, random() * 6, (random() - 0.5) * 30];
    origins.set(o, i * 3); translations.set([t[0] - o[0], t[1] - o[1], t[2] - o[2]], i * 3);
  }
  // Some straight down (the ground, the mesh, the height field) and one of zero length.
  for (let i = 0; i < count; i += 7) { origins.set([(random() - 0.5) * 40, 20, (random() - 0.5) * 12], i * 3); translations.set([0, -30, 0], i * 3); }
  if (count > 3) translations.set([0, 0, 0], 9);
  return {origins, translations};
}
const triple = (array, i) => [array[i * 3], array[i * 3 + 1], array[i * 3 + 2]];

test('castRays gives exactly the hits of raycast(), ray by ray, across the 128-query batch boundary', async () => {
  const {world} = await sceneWorld();
  try {
    for (const count of [1, 127, 128, 129, 300, 1000]) {
      const {origins, translations} = rays(count, 100 + count);
      const fractions = new Float32Array(count), points = new Float32Array(count * 3), normals = new Float32Array(count * 3), bodies = [];
      const before = world.exactHash();
      const hits = world.castRays(origins, translations, fractions, {points, normals, bodies});
      assert.equal(world.exactHash(), before, 'queries do not move anything');
      let expectedHits = 0;
      for (let i = 0; i < count; i++) {
        const single = world.raycast(triple(origins, i), triple(translations, i));
        if (!single) { assert.equal(fractions[i], -1, `ray ${i} of ${count}: a miss is -1`); assert.equal(bodies[i], null); continue; }
        expectedHits++;
        assert.equal(fractions[i], single.fraction, `ray ${i} of ${count}: fraction`);
        assert.deepEqual(triple(points, i), [...single.point], `ray ${i} of ${count}: point`);
        assert.deepEqual(triple(normals, i), [...single.normal], `ray ${i} of ${count}: normal`);
        assert.equal(bodies[i].token, single.body.token, `ray ${i} of ${count}: body`);
        assert.ok(world.isAlive(bodies[i]), 'the body reference is usable');
      }
      assert.equal(hits, expectedHits, `${count} rays: hit count`);
      if (count >= 127) assert.ok(hits > count / 10 && hits < count, `${count} rays: the scene gives both hits and misses (${hits})`);
    }
  } finally { world.dispose(); }
});

test('castRays applies the same filters as raycast()', async () => {
  const {world, bodies} = await sceneWorld();
  try {
    const count = 400, {origins, translations} = rays(count, 5);
    for (const filter of [{bodies: 'static'}, {bodies: 'dynamic'}, {bodies: 'none'}, {ignoreBody: bodies[3]}, {categoryBits: 1n, maskBits: 0xFFFFFFFFFFFFFFFFn}]) {
      const fractions = new Float32Array(count), found = [];
      world.castRays(origins, translations, fractions, {filter, bodies: found});
      for (let i = 0; i < count; i++) {
        const single = world.raycast(triple(origins, i), triple(translations, i), {filter});
        assert.equal(fractions[i], single ? single.fraction : -1, `filter ${Object.keys(filter)}: ray ${i}`);
        assert.equal(found[i]?.token ?? null, single?.body.token ?? null);
      }
    }
  } finally { world.dispose(); }
});

test('castRays without the optional outputs, with no rays, and with bad input', async () => {
  const {world} = await sceneWorld();
  try {
    const {origins, translations} = rays(200, 9), fractions = new Float32Array(200), full = new Float32Array(200);
    const hits = world.castRays(origins, translations, fractions);
    assert.equal(world.castRays(origins, translations, full, {points: new Float32Array(600)}), hits);
    assert.deepEqual([...fractions], [...full]);
    assert.equal(world.castRays(new Float32Array(0), new Float32Array(0), new Float32Array(0)), 0);
    const code = (fn, expected) => assert.throws(fn, error => error.code === expected, expected);
    code(() => world.castRays([0, 0, 0], translations, fractions), 'INVALID_PAYLOAD');
    code(() => world.castRays(origins, translations, new Float32Array(199)), 'INVALID_PAYLOAD');
    code(() => world.castRays(origins, translations, fractions, {points: new Float32Array(3)}), 'INVALID_PAYLOAD');
    code(() => world.castRays(origins, translations, fractions, {bodies: new Float32Array(200)}), 'INVALID_PAYLOAD');
    code(() => world.castRays(origins, translations, fractions, {filter: {bodies: 'kinematic'}}), 'INVALID_PAYLOAD');
    const bad = Float32Array.from(origins); bad[301] = NaN;
    const untouched = Float32Array.from(fractions);
    code(() => world.castRays(bad, translations, fractions), 'INVALID_PAYLOAD');
    bad[301] = 2e6;
    code(() => world.castRays(bad, translations, fractions), 'INVALID_PAYLOAD');
    assert.deepEqual([...fractions], [...untouched], 'a refused call writes nothing');
    // A body removed since: the ignored body is refused as stale, as raycast() refuses it.
    const gone = world.createBody({shape: {kind: 'sphere', radius: 0.2}, position: [0, 30, 0]});
    world.destroyBody(gone);
    code(() => world.castRays(origins, translations, fractions, {filter: {ignoreBody: gone}}), 'STALE_BODY');
  } finally { world.dispose(); }
});
