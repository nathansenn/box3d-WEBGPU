// Render geometry of hull, mesh, height-field and compound bodies (src/webgpu/body-geometry.ts), the plan
// that routes their rows (src/webgpu/instance-shapes.ts), and the shapes the native world keeps
// for them. The height-field triangulation is compared with ray casts against Box3D itself.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../src/engine/native-world.ts';
import {
  BODY_MESH_VERTEX_FLOATS, bodyRenderMesh, compoundRenderMesh, heightfieldRenderMesh, hullRenderMesh, meshRenderMesh,
} from '../../src/webgpu/body-geometry.ts';
import {
  SHAPE_KIND_COMPOUND, SHAPE_KIND_HEIGHTFIELD, SHAPE_KIND_HULL, SHAPE_KIND_MESH, forEachBoxRun, forEachRun, geometryRowsBelow, planInstanceShapes,
} from '../../src/webgpu/instance-shapes.ts';
import {random, showcaseScene, torusMesh} from './lab-scene-fixtures.mjs';
import {loadLabScene} from '../../src/lab/scene-host.ts';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
const {default: factory} = await import(pathToFileURL(resolve(artifact, 'box3d.js')));
const pool = new NativeWorldPool(await factory({wasmBinary: await readFile(resolve(artifact, 'box3d.wasm'))}));

const F = BODY_MESH_VERTEX_FLOATS;
/** Triangles of a render mesh as {p: [a, b, c], n: [na, nb, nc], face: geometric unit normal by the right-hand rule, area}. */
function trianglesOf(mesh) {
  assert.equal(mesh.vertices.length, mesh.vertexCount * F);
  assert.equal(mesh.vertexCount % 3, 0);
  const out = [];
  for (let t = 0; t < mesh.vertexCount; t += 3) {
    // `+ 0` turns -0 into 0: the sign of a zero component means nothing to a shader, but deepEqual tells them apart.
    const p = [0, 1, 2].map(k => Array.from(mesh.vertices.subarray((t + k) * F, (t + k) * F + 3), v => v + 0));
    const n = [0, 1, 2].map(k => Array.from(mesh.vertices.subarray((t + k) * F + 3, (t + k) * F + 6), v => v + 0));
    const u = p[1].map((v, k) => v - p[0][k]), w = p[2].map((v, k) => v - p[0][k]);
    const c = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], length = Math.hypot(...c);
    out.push({p, n, face: c.map(v => v / length), area: length / 2});
  }
  return out;
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const close = (a, b, eps, message) => assert.ok(Math.abs(a - b) <= eps, `${message ?? ''} ${a} vs ${b}`);
const unit = (n, message) => close(Math.hypot(...n), 1, 1e-6, message ?? 'unit normal');

test('a hull is drawn as its convex hull, wound outward, with one flat normal per face', () => {
  // A cube given as its 8 corners plus points inside it and on a face, which the hull ignores.
  const cube = [];
  for (const x of [-0.5, 0.5]) for (const y of [-1, 1]) for (const z of [-0.25, 0.25]) cube.push(x, y, z);
  const mesh = hullRenderMesh([...cube, 0, 0, 0, 0.1, 0.2, 0.05, 0.5, 0, 0]);
  const triangles = trianglesOf(mesh);
  assert.equal(triangles.length, 12);
  assert.equal(mesh.reduced, null);
  let area = 0;
  const normals = new Set();
  for (const {p, n, face, area: a} of triangles) {
    area += a;
    for (const normal of n) { unit(normal); assert.ok(dot(normal, face) > 1 - 1e-6, 'the stored normal is the normal of the winding'); }
    assert.deepEqual(n[0], n[1]); assert.deepEqual(n[1], n[2]);
    const centroid = [0, 1, 2].map(k => (p[0][k] + p[1][k] + p[2][k]) / 3);
    assert.ok(dot(centroid, face) > 0, 'faces look away from the centre');
    normals.add(n[0].map(v => Math.round(v)).join());
  }
  // 1 x 2 x 0.5 box: 2 * (1*2 + 1*0.5 + 2*0.5) = 7.
  close(area, 7, 1e-5, 'surface area');
  assert.deepEqual([...normals].sort(), ['-1,0,0', '0,-1,0', '0,0,-1', '0,0,1', '0,1,0', '1,0,0'], 'the two triangles of a face share its axis normal');
  const tetra = trianglesOf(hullRenderMesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]));
  assert.equal(tetra.length, 4);
  assert.throws(() => hullRenderMesh([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]), /coplanar/);
});

test('a static mesh is drawn flat-shaded on both sides, keeping each triangle and its winding', () => {
  // Two triangles and one with no area.
  const vertices = [0, 0, 0, 2, 0, 0, 0, 0, -2, 2, 1, -2, 5, 5, 5], indices = [0, 1, 2, 1, 3, 2, 4, 4, 4];
  const mesh = meshRenderMesh(vertices, indices);
  const triangles = trianglesOf(mesh);
  assert.equal(triangles.length, 4, 'two triangles, each twice; the degenerate one is dropped');
  assert.equal(mesh.reduced, null);
  // Front copy: the source corners in the source order, with the normal that order gives.
  assert.deepEqual(triangles[0].p, [[0, 0, 0], [2, 0, 0], [0, 0, -2]]);
  assert.deepEqual(triangles[0].n[0], [0, 1, 0]);
  // Back copy: the same corners reversed, with the opposite normal.
  assert.deepEqual(triangles[1].p, [[0, 0, 0], [0, 0, -2], [2, 0, 0]]);
  assert.deepEqual(triangles[1].n[0], [0, -1, 0]);
  for (const {n, face} of triangles) for (const normal of n) { unit(normal); assert.ok(dot(normal, face) > 1 - 1e-6, 'every copy is counter-clockwise seen along its normal'); }
  assert.ok(dot(triangles[2].face, triangles[3].face) < -1 + 1e-6);
  // Budgets: one-sided when both sides do not fit, cut short when one side does not fit either.
  const torus = torusMesh(16, 8), count = torus.indices.length / 3;
  assert.equal(meshRenderMesh(torus.vertices, torus.indices).vertexCount, count * 6);
  const oneSided = meshRenderMesh(torus.vertices, torus.indices, count * 3 + 6);
  assert.equal(oneSided.vertexCount, count * 3);
  assert.match(oneSided.reduced, /one-sided/);
  const cut = meshRenderMesh(torus.vertices, torus.indices, 30);
  assert.equal(cut.vertexCount, 30);
  assert.match(cut.reduced, /first 10 of 256 triangles/);
  // An index outside the vertex list is skipped, never read.
  assert.equal(meshRenderMesh([0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 1, 7]).vertexCount, 0);
});

test('a height field is drawn on its own grid, counter-clockwise from above, with smooth normals', () => {
  // A plane h = 0.5 x - 0.25 z: every normal is (-0.5, 1, 0.25) normalised.
  const countX = 5, countZ = 4, spacing = [0.5, 2], heights = [];
  for (let z = 0; z < countZ; z++) for (let x = 0; x < countX; x++) heights.push(0.5 * x * spacing[0] - 0.25 * z * spacing[1]);
  const mesh = heightfieldRenderMesh(heights, countX, countZ, spacing);
  const triangles = trianglesOf(mesh);
  assert.equal(triangles.length, (countX - 1) * (countZ - 1) * 2);
  const expected = [-0.5, 1, 0.25].map(v => v / Math.hypot(0.5, 1, 0.25));
  let area = 0;
  for (const {p, n, face, area: a} of triangles) {
    area += a;
    assert.ok(face[1] > 0, 'counter-clockwise seen from above');
    for (let k = 0; k < 3; k++) {
      for (let c = 0; c < 3; c++) close(n[k][c], expected[c], 1e-6, 'plane normal');
      close(p[k][1], 0.5 * p[k][0] - 0.25 * p[k][2], 1e-6, 'vertex on the plane');
      assert.ok(p[k][0] >= 0 && p[k][0] <= 2 + 1e-6 && p[k][2] >= 0 && p[k][2] <= 6 + 1e-6, 'the grid starts at the origin and extends along +x and +z');
    }
  }
  close(area, 2 * 6 * Math.hypot(0.5, 1, 0.25), 1e-4, 'the triangles tile the whole grid once');
  // Smooth: a vertex shared by several triangles carries the same normal in each.
  const bumpy = heightfieldRenderMesh([0, 0, 0, 0, 1, 0, 0, 0, 0], 3, 3, [1, 1]);
  const byPosition = new Map();
  for (const {p, n} of trianglesOf(bumpy)) for (let k = 0; k < 3; k++) {
    const key = p[k].join();
    if (byPosition.has(key)) assert.deepEqual(n[k], byPosition.get(key)); else byPosition.set(key, n[k]);
    unit(n[k]);
  }
  assert.equal(byPosition.size, 9);
  assert.deepEqual(byPosition.get('1,1,1'), [0, 1, 0], 'the summit is level');
  // A field over the vertex budget is drawn from every k-th sample and still reaches its last row and column.
  const big = new Float32Array(41 * 31).map((_, i) => Math.sin(i));
  const coarse = heightfieldRenderMesh(big, 41, 31, [1, 1], 600);
  assert.ok(coarse.vertexCount <= 600 && coarse.vertexCount > 0);
  assert.match(coarse.reduced, /every \d+th height sample/);
  let maxX = 0, maxZ = 0;
  for (const {p} of trianglesOf(coarse)) for (const point of p) { maxX = Math.max(maxX, point[0]); maxZ = Math.max(maxZ, point[2]); }
  assert.deepEqual([maxX, maxZ], [40, 30]);
  assert.throws(() => heightfieldRenderMesh([0, 0, 0], 2, 2, [1, 1]), RangeError);
});

test('the height-field triangles are the ones Box3D collides with', () => {
  // Each cell of a rough field is far from planar, so the diagonal a cell is split along decides its height.
  const next = random(7), countX = 7, countZ = 6, spacing = [0.8, 1.3], heights = [];
  for (let i = 0; i < countX * countZ; i++) heights.push(Number((next() * 2).toFixed(3)));
  const origin = [3, -1, 2];
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: false});
    world.createBody({shape: {kind: 'heightfield', heights, countX, countZ, spacing}, position: origin});
    const triangles = trianglesOf(heightfieldRenderMesh(heights, countX, countZ, spacing));
    const heightAt = (x, z) => {
      for (const {p} of triangles) {
        const [a, b, c] = p, d = (b[2] - c[2]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[2] - c[2]);
        const u = ((b[2] - c[2]) * (x - c[0]) + (c[0] - b[0]) * (z - c[2])) / d, v = ((c[2] - a[2]) * (x - c[0]) + (a[0] - c[0]) * (z - c[2])) / d, w = 1 - u - v;
        if (u >= -1e-9 && v >= -1e-9 && w >= -1e-9) return u * a[1] + v * b[1] + w * c[1];
      }
      return NaN;
    };
    const queries = [], expected = [];
    for (let i = 0; i < 100; i++) {
      const x = (0.02 + next() * 0.96) * (countX - 1) * spacing[0], z = (0.02 + next() * 0.96) * (countZ - 1) * spacing[1];
      queries.push({kind: 'ray', origin: [origin[0] + x, origin[1] + 10, origin[2] + z], translation: [0, -20, 0], limit: 1});
      expected.push(heightAt(x, z));
    }
    const results = world.queryBatch(queries);
    let worst = 0;
    results.forEach((result, i) => {
      assert.equal(result.hits.length, 1, `ray ${i} hits the field`);
      worst = Math.max(worst, Math.abs(result.hits[0].point[1] - origin[1] - expected[i]));
    });
    assert.ok(worst < 2e-4, `mesh and engine heights differ by at most ${worst} m`);
    // The other diagonal would be wrong by much more than that on this field.
    const flipped = (x, z) => {
      const cx = Math.min(countX - 2, Math.floor(x / spacing[0])), cz = Math.min(countZ - 2, Math.floor(z / spacing[1]));
      const fx = x / spacing[0] - cx, fz = z / spacing[1] - cz, h = (i, j) => heights[cx + i + (cz + j) * countX];
      return fx >= fz ? h(0, 0) + fx * (h(1, 0) - h(0, 0)) + fz * (h(1, 1) - h(1, 0)) : h(0, 0) + fx * (h(1, 1) - h(0, 1)) + fz * (h(0, 1) - h(0, 0));
    };
    let otherWorst = 0;
    results.forEach((result, i) => { otherWorst = Math.max(otherWorst, Math.abs(result.hits[0].point[1] - origin[1] - flipped(queries[i].origin[0] - origin[0], queries[i].origin[2] - origin[2]))); });
    assert.ok(otherWorst > 0.05, `the other diagonal misses by ${otherWorst} m, so the comparison can tell them apart`);
  } finally { world.destroy(); }
});

test('a compound is drawn as every child at its local pose, and the drawn surface is the one Box3D collides with', () => {
  // One child of each kind, turned and spaced so that no ray towards one child meets another first.
  const turn = (axis, angle) => { const s = Math.sin(angle / 2); return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]; };
  const cube = [];
  for (const x of [-0.2, 0.2]) for (const y of [-0.15, 0.15]) for (const z of [-0.1, 0.1]) cube.push(x, y, z);
  const children = [
    {shape: {kind: 'box', halfExtents: [0.3, 0.1, 0.2]}, position: [-2, 0, 0], rotation: turn([0, 0, 1], 0.6)},
    {shape: {kind: 'sphere', radius: 0.25}, position: [0, 0.5, 0]},
    {shape: {kind: 'capsule', radius: 0.12, halfLength: 0.3}, position: [2, 0, 0], rotation: turn([1, 0, 0], Math.PI / 2)},   // its axis now along z
    {shape: {kind: 'hull', points: cube}, position: [0, -2, 0], rotation: turn([0, 1, 0], 0.9)},
  ];
  const mesh = compoundRenderMesh(children), triangles = trianglesOf(mesh);
  assert.equal(mesh.reduced, null);
  assert.equal(bodyRenderMesh({kind: 'compound', shapes: children}).vertexCount, mesh.vertexCount);
  // 12 triangles a box and a cuboid hull; a sphere of 24 x 12 bands has 24 x (12 - 1) x 2; a capsule adds 24 x 2 for its cylinder.
  assert.equal(triangles.length, 12 + 24 * 11 * 2 + (24 * 11 * 2 + 24 * 2) + 12);
  for (const {p, n, face, area} of triangles) {
    assert.ok(area > 1e-7, 'no degenerate triangle');
    for (const normal of n) { close(Math.hypot(...normal), 1, 1e-5, 'unit normal'); assert.ok(dot(normal, face) > 0.85, 'the winding faces the way the normals point'); }
    assert.ok(p.every(v => v.every(Number.isFinite)));
  }
  // Each child's vertices are where its pose puts them: the capsule, turned onto z, reaches 0.42 along z and 0.12 along y.
  const near = centre => triangles.flatMap(t => t.p).filter(v => Math.hypot(v[0] - centre[0], v[1] - centre[1], v[2] - centre[2]) < 0.9);
  const extent = (points, axis) => [Math.min(...points.map(v => v[axis])), Math.max(...points.map(v => v[axis]))];
  const capsule = near([2, 0, 0]);
  [[extent(capsule, 2), [-0.42, 0.42]], [extent(capsule, 1), [-0.12, 0.12]], [extent(capsule, 0), [1.88, 2.12]]].forEach(([got, want]) => got.forEach((v, i) => close(v, want[i], 1e-6, 'capsule extent')));
  const box = near([-2, 0, 0]), reach = 0.3 * Math.cos(0.6) + 0.1 * Math.sin(0.6);
  extent(box, 0).forEach((v, i) => close(v, -2 + (i ? reach : -reach), 1e-6, 'the box is turned 0.6 rad about z'));
  // Against the engine: a ray along -normal towards any drawn vertex stops at that vertex.
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: false});
    world.retainBodyShapes(true);
    const origin = [5, 3, -4], spin = turn([0.6, 0, 0.8], 1.1);
    const body = world.createBody({shape: {kind: 'compound', shapes: children}, position: origin, rotation: spin, type: 'static'});
    assert.deepEqual([world.bodyKinds(), world.shapeKinds()[0], world.bodyShape(0).kind, world.bodyShape(0).shapes.length], [['compound'], SHAPE_KIND_COMPOUND, 'compound', 4]);
    assert.equal(world.bodyShape(0), world.bodyShape(world.bodyIndex(body)), 'the same object every time, so the renderer uploads it once');
    const rotate = ([x, y, z, w], v) => { const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])]; return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]]; };
    // Rays go to triangle centres (a ray along a face normal through a corner only grazes the box).
    const drawn = trianglesOf(compoundRenderMesh(world.bodyShape(0).shapes)), queries = [], targets = [];
    drawn.forEach(({p, face}) => {
      const local = [0, 1, 2].map(k => (p[0][k] + p[1][k] + p[2][k]) / 3), point = rotate(spin, local).map((value, i) => value + origin[i]), out = rotate(spin, face);
      queries.push({kind: 'ray', origin: point.map((value, i) => value + 0.4 * out[i]), translation: out.map(value => -0.8 * value), limit: 1});
      targets.push(point);
    });
    let flat = 0, round = 0;
    for (let start = 0; start < queries.length; start += 100) world.queryBatch(queries.slice(start, start + 100)).forEach((result, i) => {
      const index = start + i, miss = result.hits.length === 1 ? Math.hypot(...result.hits[0].point.map((value, k) => value - targets[index][k])) : Infinity;
      assert.equal(result.hits.length, 1, `ray ${index} hits the compound`);
      // The first 12 triangles are the box and the last 12 the hull; the others are the sphere and the capsule.
      if (index < 12 || index >= drawn.length - 12) flat = Math.max(flat, miss); else round = Math.max(round, miss);
    });
    assert.ok(flat < 1e-4, `the centres of the box's and the hull's triangles are on the collision surface to ${flat} m`);
    // A flat triangle under a curved surface sits below it by the sagitta: at most r (1 - cos(pi / 24)) (1 + ...) for 24 segments and 12 bands, 4 mm at r = 0.25.
    assert.ok(round > 1e-4 && round < 0.25 * 0.02, `the centres of the sphere's and the capsule's triangles are within ${round} m of the collision surface`);
  } finally { world.destroy(); }
  // A compound row has its own geometry in the plan, like a hull.
  const plan = planInstanceShapes(new Uint8Array([0, SHAPE_KIND_COMPOUND, 1]), 3, row => row === 1);
  assert.deepEqual([[...plan.geometryRows], [...plan.boxRuns], [...plan.sphereRuns]], [[1], [0, 1], [2, 1]]);
  assert.equal(compoundRenderMesh([{shape: {kind: 'hull', points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0]}}, {shape: {kind: 'sphere', radius: 1}}]).vertexCount, 24 * 11 * 2 * 3, 'a child without volume is left out');
});

test('bodyRenderMesh picks the mesh by shape kind', () => {
  assert.equal(bodyRenderMesh({kind: 'box', halfExtents: [1, 1, 1]}), null);
  assert.equal(bodyRenderMesh({kind: 'sphere', radius: 1}), null);
  assert.equal(bodyRenderMesh({kind: 'capsule', radius: 1, halfLength: 1}), null);
  assert.equal(bodyRenderMesh({kind: 'hull', points: [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]}).vertexCount, 12);
  assert.equal(bodyRenderMesh({kind: 'mesh', vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2]}).vertexCount, 6);
  assert.equal(bodyRenderMesh({kind: 'heightfield', heights: [0, 0, 0, 0], countX: 2, countZ: 2, spacing: [1, 1]}).vertexCount, 6);
});

test('the shape plan gives hull, mesh and height-field rows their own draw only when the source has their geometry', () => {
  const kinds = new Uint8Array([0, SHAPE_KIND_HULL, 0, SHAPE_KIND_MESH, 1, SHAPE_KIND_HEIGHTFIELD, 2, 0]);
  // Without geometry such rows are boxes; with no sphere or capsule either, the frame keeps the single cube draw.
  assert.equal(planInstanceShapes(new Uint8Array([0, SHAPE_KIND_HULL, SHAPE_KIND_MESH, SHAPE_KIND_HEIGHTFIELD]), 4), null);
  assert.equal(planInstanceShapes(new Uint8Array([0, SHAPE_KIND_HULL]), 2, () => false), null);
  const boxes = planInstanceShapes(kinds, 8);
  assert.deepEqual([...boxes.geometryRows], []);
  assert.deepEqual([...boxes.boxRuns], [0, 4, 5, 1, 7, 1]);
  const asked = [];
  const plan = planInstanceShapes(kinds, 8, row => { asked.push(row); return row !== 3; });
  assert.deepEqual(asked, [1, 3, 5], 'only hull, mesh and height-field rows are asked about');
  assert.deepEqual([...plan.geometryRows], [1, 5]);
  assert.deepEqual([...plan.boxRuns], [0, 1, 2, 2, 7, 1], 'row 3 has no geometry and stays a box; rows 1 and 5 are in no run');
  assert.deepEqual([...plan.sphereRuns], [4, 1]);
  assert.deepEqual([...plan.capsuleRuns], [6, 1]);
  const drawn = [];
  forEachBoxRun(plan, 10, (start, length) => drawn.push([start, length]));
  assert.deepEqual(drawn, [[0, 1], [2, 2], [7, 3]], 'rows after the rigid stream join the last box run');
  const covered = new Set(plan.geometryRows);
  for (const runs of [plan.boxRuns, plan.sphereRuns, plan.capsuleRuns]) forEachRun(runs, 8, (start, length) => { for (let i = start; i < start + length; i++) { assert.ok(!covered.has(i), `row ${i} is drawn once`); covered.add(i); } });
  assert.equal(covered.size, 8, 'every row is drawn');
  assert.deepEqual([0, 1, 2, 5, 6, 8, 99].map(limit => geometryRowsBelow(plan, limit)), [0, 0, 1, 1, 2, 2, 2]);
  // A scene with only geometry rows and boxes still has a plan.
  const only = planInstanceShapes(new Uint8Array([SHAPE_KIND_HEIGHTFIELD, 0, 0]), 3, () => true);
  assert.deepEqual([[...only.geometryRows], [...only.boxRuns], only.sphereCount, only.capsuleCount], [[0], [1, 2], 0, 0]);
  // Kinds beyond the count are not asked about.
  assert.equal(planInstanceShapes(new Uint8Array([0, 0, SHAPE_KIND_HULL]), 2, () => { throw new Error('not asked'); }), null);
});

test('a native world keeps the geometry of hull, mesh and height-field bodies when asked to', () => {
  const world = pool.createWorld();
  try {
    world.resetWorld();
    const hullPoints = [0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1];
    world.createBody({shape: {kind: 'hull', points: hullPoints}, position: [0, 3, 0]});
    assert.equal(world.bodyShape(1), null, 'nothing is kept by default');
    world.retainBodyShapes(true);
    world.resetWorld();
    const caller = Float32Array.from(hullPoints);
    const box = world.createBody({shape: {kind: 'box', halfExtents: [0.2, 0.2, 0.2]}, position: [4, 1, 0]});
    world.createBody({shape: {kind: 'hull', points: caller}, position: [0, 3, 0]});
    world.createBody({shape: {kind: 'mesh', vertices: [0, 0, 0, 1, 0, 0, 0, 0, -1], indices: [0, 1, 2]}, position: [2, 1, 0]});
    world.createBody({shape: {kind: 'heightfield', heights: [0, 0.5, 0, 0], countX: 2, countZ: 2, spacing: [1, 2]}, position: [-4, 0, 0]});
    assert.deepEqual(world.bodyKinds(), ['box', 'box', 'hull', 'mesh', 'heightfield']);
    assert.equal(world.bodyShape(0), null, 'the ground slab is a box');
    assert.equal(world.bodyShape(1), null);
    const hull = world.bodyShape(2), mesh = world.bodyShape(3), field = world.bodyShape(4);
    assert.deepEqual([hull.kind, Array.from(hull.points)], ['hull', hullPoints]);
    assert.deepEqual([mesh.kind, Array.from(mesh.vertices), Array.from(mesh.indices)], ['mesh', [0, 0, 0, 1, 0, 0, 0, 0, -1], [0, 1, 2]]);
    assert.deepEqual([field.kind, Array.from(field.heights), field.countX, field.countZ, [...field.spacing]], ['heightfield', [0, 0.5, 0, 0], 2, 2, [1, 2]]);
    caller[0] = 99;
    assert.equal(world.bodyShape(2).points[0], 0, 'the kept geometry is a copy');
    assert.equal(world.bodyShape(2), hull, 'the same object every time');
    assert.throws(() => world.bodyShape(5), /body index/);
    // Destroying a body moves the last row into its place; the geometry follows the body, not the row.
    world.destroyBody(box);
    assert.deepEqual(world.bodyKinds(), ['box', 'heightfield', 'hull', 'mesh']);
    assert.equal(world.bodyShape(1), field);
    assert.equal(world.bodyShape(2), hull);
    world.destroyBody(world.bodyHandle(2));
    assert.deepEqual(world.bodyKinds(), ['box', 'heightfield', 'mesh']);
    assert.equal(world.bodyShape(2), mesh);
    world.resetWorld();
    assert.equal(world.bodyCount(), 1);
    world.createBody({shape: {kind: 'hull', points: hullPoints}, position: [0, 3, 0]});
    assert.notEqual(world.bodyShape(1), hull, 'a new scene has new geometry');
    world.retainBodyShapes(false);
    assert.equal(world.bodyShape(1), null);
  } finally { world.destroy(); }
});

test('every body of a scene with all shape kinds gets a render mesh that matches its shape', () => {
  const world = pool.createWorld();
  try {
    world.retainBodyShapes(true);
    const scene = showcaseScene(), loaded = loadLabScene(world, scene);
    const kinds = world.bodyKinds();
    assert.deepEqual([kinds[0], kinds[1]], ['heightfield', 'mesh']);
    assert.equal(kinds.filter(kind => kind === 'hull').length, 7);
    let withMesh = 0;
    kinds.forEach((kind, row) => {
      const shape = world.bodyShape(row);
      if (kind === 'box' || kind === 'sphere' || kind === 'capsule') { assert.equal(shape, null); return; }
      const mesh = bodyRenderMesh(shape);
      withMesh++;
      assert.ok(mesh.vertexCount >= 12 && mesh.reduced === null, `${kind} row ${row}`);
      for (const value of mesh.vertices) assert.ok(Number.isFinite(value));
      for (const {n} of trianglesOf(mesh)) for (const normal of n) unit(normal);
    });
    assert.equal(withMesh, 9);
    // The hull that is drawn contains every point the body was created with, and its vertices are among them.
    const rock = world.bodyShape(world.bodyIndex(loaded.bodies.get('rock-0')));
    for (const {p, face} of trianglesOf(hullRenderMesh(rock.points))) {
      for (let i = 0; i < rock.points.length; i += 3) {
        const q = [rock.points[i] - p[0][0], rock.points[i + 1] - p[0][1], rock.points[i + 2] - p[0][2]];
        assert.ok(dot(q, face) < 1e-5, 'no point lies outside a drawn face');
      }
    }
    assert.equal(heightfieldRenderMesh(world.bodyShape(0).heights, 33, 33, [0.5, 0.5]).vertexCount, 32 * 32 * 6);
  } finally { world.destroy(); }
});
