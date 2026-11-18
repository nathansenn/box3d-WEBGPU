import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SHAPE_KIND_BOX as B, SHAPE_KIND_SPHERE as S, SHAPE_KIND_CAPSULE as C, ROUND_SEGMENTS, ROUND_RINGS,
  capsulesBelow, cylinderVertexCount, cylinderVertexData, forEachBoxRun, forEachRun, hemisphereVertexCount,
  planInstanceShapes, sphereVertexCount, sphereVertexData, writeCapsuleCaps,
} from '../../src/webgpu/instance-shapes.ts';

const runs = (walk) => { const out = []; walk((start, length) => out.push([start, length])); return out; };
function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}

test('a stream with no round rows has no plan, so the renderer keeps its single cube draw', () => {
  assert.equal(planInstanceShapes(null, 12), null);
  assert.equal(planInstanceShapes(undefined, 12), null);
  assert.equal(planInstanceShapes(new Uint8Array(12), 12), null);
  assert.equal(planInstanceShapes(new Uint8Array([S, C]), 0), null);
  assert.equal(planInstanceShapes(new Uint8Array([B, 7, 255, B]), 4), null, 'an unknown kind is a box');
  assert.equal(planInstanceShapes(new Uint8Array([B, B, S]), 2), null, 'rows past the count are not read');
  assert.throws(() => planInstanceShapes(new Uint8Array(1), -1), RangeError);
  assert.throws(() => planInstanceShapes(new Uint8Array(1), 1.5), RangeError);
});

test('rows are grouped into runs per shape', () => {
  const plan = planInstanceShapes(new Uint8Array([B, B, S, S, S, C, B, C, C, 9, S]), 11);
  assert.deepEqual([...plan.boxRuns], [0, 2, 6, 1, 9, 1]);
  assert.deepEqual([...plan.sphereRuns], [2, 3, 10, 1]);
  assert.deepEqual([...plan.capsuleRuns], [5, 1, 7, 2]);
  assert.deepEqual([...plan.capsuleRows], [5, 7, 8]);
  assert.deepEqual([plan.count, plan.sphereCount, plan.capsuleCount], [11, 4, 3]);
  const short = planInstanceShapes(new Uint8Array([S]), 4);
  assert.deepEqual([...short.boxRuns], [1, 3], 'rows the source did not describe are boxes');
});

test('rows after the rigid stream are boxes and join the last box run', () => {
  const tailBox = planInstanceShapes(new Uint8Array([S, C, B, B]), 4);
  assert.deepEqual(runs(draw => forEachBoxRun(tailBox, 4, draw)), [[2, 2]]);
  assert.deepEqual(runs(draw => forEachBoxRun(tailBox, 40, draw)), [[2, 38]], 'ropes and effects extend the same draw');
  const tailRound = planInstanceShapes(new Uint8Array([B, S, B, C]), 4);
  assert.deepEqual(runs(draw => forEachBoxRun(tailRound, 4, draw)), [[0, 1], [2, 1]]);
  assert.deepEqual(runs(draw => forEachBoxRun(tailRound, 9, draw)), [[0, 1], [2, 1], [4, 5]]);
  assert.deepEqual(runs(draw => forEachBoxRun(tailRound, 3, draw)), [[0, 1], [2, 1]], 'a frame may draw fewer rows than were uploaded');
  assert.deepEqual(runs(draw => forEachBoxRun(tailRound, 1, draw)), [[0, 1]]);
  assert.deepEqual(runs(draw => forEachBoxRun(tailRound, 0, draw)), []);
  assert.deepEqual(runs(draw => forEachRun(tailRound.capsuleRuns, 3, draw)), []);
  assert.equal(capsulesBelow(tailRound, 3), 0);
  assert.equal(capsulesBelow(tailRound, 4), 1);
  assert.equal(capsulesBelow(tailRound, 100), 1);
});

test('every row is drawn exactly once, as its own shape, for random streams', () => {
  const next = random(0xb0c5);
  for (let trial = 0; trial < 200; trial++) {
    const count = 1 + Math.floor(next() * 60), extra = Math.floor(next() * 4) * 5;
    const kinds = Uint8Array.from({ length: count }, () => [B, B, S, C, 3][Math.floor(next() * 5)]);
    const plan = planInstanceShapes(kinds, count);
    const expected = Array.from(kinds, kind => (kind === S || kind === C ? kind : B));
    if (!plan) { assert.ok(expected.every(kind => kind === B)); continue; }
    for (const limit of [count + extra, count, Math.floor(count / 2)]) {
      const drawn = new Array(limit).fill(-1);
      const mark = kind => (start, length) => {
        assert.ok(length > 0 && start + length <= limit);
        for (let i = start; i < start + length; i++) { assert.equal(drawn[i], -1, 'drawn twice'); drawn[i] = kind; }
      };
      forEachBoxRun(plan, limit, mark(B));
      forEachRun(plan.sphereRuns, limit, mark(S));
      forEachRun(plan.capsuleRuns, limit, mark(C));
      for (let i = 0; i < limit; i++) assert.equal(drawn[i], i < count ? expected[i] : B, `row ${i} of ${limit}`);
      assert.equal(capsulesBelow(plan, limit), expected.slice(0, limit).filter(kind => kind === C).length);
    }
  }
});

const vertex = (data, i) => ({ p: [data[i * 6], data[i * 6 + 1], data[i * 6 + 2]], n: [data[i * 6 + 3], data[i * 6 + 4], data[i * 6 + 5]] });
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = a => Math.hypot(a[0], a[1], a[2]);

function assertOutwardTriangles(data, outwardOf) {
  for (let t = 0; t < data.length / 18; t++) {
    const [a, b, c] = [0, 1, 2].map(k => vertex(data, t * 3 + k).p);
    const normal = cross(sub(b, a), sub(c, a));
    assert.ok(length(normal) > 1e-6, `triangle ${t} is degenerate`);
    const centre = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    assert.ok(dot(normal, outwardOf(centre)) > 0, `triangle ${t} winds clockwise seen from outside, so back-face culling would remove it`);
  }
}

test('the sphere mesh is a closed unit sphere with outward counter-clockwise triangles', () => {
  const data = sphereVertexData();
  assert.equal(data.length, sphereVertexCount() * 6);
  assert.equal(sphereVertexCount(), ROUND_SEGMENTS * 6 * (ROUND_RINGS - 1));
  assert.equal(hemisphereVertexCount() * 2, sphereVertexCount());
  for (let i = 0; i < sphereVertexCount(); i++) {
    const { p, n } = vertex(data, i);
    assert.ok(Math.abs(length(p) - 1) < 1e-6);
    assert.deepEqual(n, p, 'a unit sphere normal is its position');
    if (i < hemisphereVertexCount()) assert.ok(p[1] >= 0, 'the first half is the upper hemisphere');
    else assert.ok(p[1] <= 0);
  }
  assertOutwardTriangles(data, centre => centre);
  // Closed surface: every edge is shared by exactly two triangles, in opposite directions.
  const edges = new Map();
  const key = p => p.map(v => Math.round(v * 1e5)).join(',');
  for (let t = 0; t < sphereVertexCount() / 3; t++) {
    const k = [0, 1, 2].map(j => key(vertex(data, t * 3 + j).p));
    for (let j = 0; j < 3; j++) { const e = `${k[j]}>${k[(j + 1) % 3]}`; edges.set(e, (edges.get(e) ?? 0) + 1); }
  }
  for (const [edge, uses] of edges) {
    const [from, to] = edge.split('>');
    assert.equal(uses, 1, `edge ${edge} repeats`);
    assert.equal(edges.get(`${to}>${from}`), 1, `edge ${edge} has no neighbour: the sphere has a hole`);
  }
  assert.throws(() => sphereVertexData(2, 16), RangeError);
  assert.throws(() => sphereVertexData(16, 5), RangeError);
});

test('the cylinder mesh is an open unit cylinder whose rims are the hemisphere equator', () => {
  const data = cylinderVertexData();
  assert.equal(data.length, cylinderVertexCount() * 6);
  const rim = new Set();
  for (let i = 0; i < cylinderVertexCount(); i++) {
    const { p, n } = vertex(data, i);
    assert.ok(Math.abs(Math.hypot(p[0], p[2]) - 1) < 1e-6 && Math.abs(p[1]) === 1);
    assert.deepEqual(n, [p[0], 0, p[2]], 'the wall normal is radial');
    rim.add(`${p[0]},${p[2]}`);
  }
  assertOutwardTriangles(data, centre => [centre[0], 0, centre[2]]);
  const sphere = sphereVertexData(), equator = new Set();
  for (let i = 0; i < hemisphereVertexCount(); i++) { const { p } = vertex(sphere, i); if (p[1] === 0) equator.add(`${p[0]},${p[2]}`); }
  assert.equal(rim.size, ROUND_SEGMENTS);
  assert.deepEqual([...equator].sort(), [...rim].sort(), 'the cap equator and the cylinder rim use the same float values, so the seam has no gap');
});

function capsuleRow(position, quaternion, radius, half) {
  const [x, y, z, w] = quaternion;
  const columns = [
    [1 - 2 * (y * y + z * z), 2 * (x * y + z * w), 2 * (x * z - y * w)],
    [2 * (x * y - z * w), 1 - 2 * (x * x + z * z), 2 * (y * z + x * w)],
    [2 * (x * z + y * w), 2 * (y * z - x * w), 1 - 2 * (x * x + y * y)],
  ];
  const scale = [radius, half, radius], m = new Float32Array(16);
  for (let c = 0; c < 3; c++) for (let r = 0; r < 3; r++) m[c * 4 + r] = columns[c][r] * scale[c];
  m[12] = position[0]; m[13] = position[1]; m[14] = position[2]; m[15] = 1;
  return { m, axis: columns[1] };
}
const transform = (m, o, p) => [0, 1, 2].map(r => m[o + r] * p[0] + m[o + 4 + r] * p[1] + m[o + 8 + r] * p[2] + m[o + 12 + r]);

test('a capsule row decomposes into an exact cylinder and two exact hemispheres at any radius and length', () => {
  const next = random(0xca95), sphere = sphereVertexData(), cylinder = cylinderVertexData();
  const sizes = [[0.25, 0.5], [0.01, 5], [3, 0.0025], [0.045, 1.95], [1, 1]];
  for (let trial = 0; trial < 40; trial++) {
    const [radius, half] = sizes[trial % sizes.length];
    const q = [next() - 0.5, next() - 0.5, next() - 0.5, next() - 0.5], qn = Math.hypot(...q);
    const position = [next() * 40 - 20, next() * 10, next() * 40 - 20];
    const { m, axis } = capsuleRow(position, q.map(v => v / qn), radius, half);
    // Three rows; the capsule is row 1, so the offsets are exercised too.
    const matrices = new Float32Array(3 + 48), colors = new Float32Array(5 + 12);
    matrices.set(m, 3 + 16); colors.set([0.2, 0.4, 0.6, -2], 5 + 4);
    const capMatrices = new Float32Array(32), capColors = new Float32Array(8);
    assert.equal(writeCapsuleCaps(matrices, 3, colors, 5, [1], capMatrices, capColors), 2);
    assert.deepEqual([...capColors], [...new Float32Array([0.2, 0.4, 0.6, -2, 0.2, 0.4, 0.6, -2])], 'both caps carry the row colour and material tag');
    const tolerance = 2e-5 * Math.max(1, radius, half, 20);
    const ends = [1, -1].map(sign => position.map((v, i) => v + sign * half * axis[i]));
    for (let side = 0; side < 2; side++) {
      const o = side * 16, sign = side === 0 ? 1 : -1;
      const cols = [0, 1, 2].map(c => [capMatrices[o + c * 4], capMatrices[o + c * 4 + 1], capMatrices[o + c * 4 + 2]]);
      for (const col of cols) assert.ok(Math.abs(length(col) - radius) < tolerance, 'a cap is scaled by the radius on every axis');
      assert.ok(Math.abs(dot(cols[0], cols[1])) < tolerance * radius && Math.abs(dot(cols[1], cols[2])) < tolerance * radius);
      assert.ok(dot(cross(cols[0], cols[1]), cols[2]) > 0, 'a cap is rotated, not mirrored, so its winding is kept');
      assert.deepEqual([capMatrices[o + 3], capMatrices[o + 7], capMatrices[o + 11], capMatrices[o + 15]], [0, 0, 0, 1]);
      for (let i = 0; i < hemisphereVertexCount(); i++) {
        const world = transform(capMatrices, o, vertex(sphere, i).p), fromEnd = sub(world, ends[side]);
        assert.ok(Math.abs(length(fromEnd) - radius) < tolerance, `cap vertex is ${length(fromEnd)} from its centre, radius ${radius}`);
        assert.ok(dot(fromEnd, axis) * sign > -tolerance, 'the hemisphere faces away from the cylinder');
      }
    }
    const rim = [];
    for (let i = 0; i < cylinderVertexCount(); i++) {
      const world = transform(m, 0, vertex(cylinder, i).p), fromCentre = sub(world, position), along = dot(fromCentre, axis);
      assert.ok(Math.abs(Math.abs(along) - half) < tolerance, 'the cylinder ends at the cap centres');
      assert.ok(Math.abs(length(sub(fromCentre, axis.map(v => v * along))) - radius) < tolerance, 'the cylinder wall is one radius from the axis');
      rim.push(world);
    }
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < hemisphereVertexCount(); i++) {
        const local = vertex(sphere, i).p;
        if (local[1] !== 0) continue;
        const world = transform(capMatrices, side * 16, local);
        assert.ok(rim.some(p => length(sub(p, world)) < tolerance), 'each cap equator vertex meets a cylinder rim vertex');
      }
    }
    // The +Y cap is the matrix syncShapeMeshes in packages/box3d-kit/src/three.ts builds.
    const k = radius / half, kit = Float32Array.from(m);
    kit[4] *= k; kit[5] *= k; kit[6] *= k; kit[12] += m[4]; kit[13] += m[5]; kit[14] += m[6];
    for (let i = 0; i < 16; i++) assert.ok(Math.abs(capMatrices[i] - kit[i]) < tolerance);
  }
  assert.throws(() => writeCapsuleCaps(new Float32Array(16), 0, new Float32Array(4), 0, [0], new Float32Array(16), new Float32Array(8)), RangeError);
});
