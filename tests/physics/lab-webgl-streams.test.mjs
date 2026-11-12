// The stream packing the Lab's two renderers share, and the CPU halves of what the WebGPU renderer does on the
// GPU that the WebGL2 renderer needs (src/webgl/lab-streams.ts). The browser comparison of the two renderers is
// scripts/lab-webgl2-browser-check.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  LINE_VERTEX_FLOATS, MAX_ROPE_SEGMENTS, SURFACE_VERTEX_FLOATS, buildSurface, clothSurfaceVertices, decodePackedSurface,
  expandRopeSegments, fillLineVertexData, waterSurfaceVertices,
} from '../../src/webgl/lab-streams.ts';

const close = (a, b, tolerance = 1e-6, message) => assert.ok(Math.abs(a - b) <= tolerance, `${message ?? ''} ${a} != ${b}`);
const apply = (m, o, [x, y, z]) => [0, 1, 2].map(r => m[o + r] * x + m[o + 4 + r] * y + m[o + 8 + r] * z + m[o + 12 + r]);
const column = (m, o, c) => [m[o + c * 4], m[o + c * 4 + 1], m[o + c * 4 + 2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = a => Math.hypot(...a);

test('both renderers pack lines with the one shared function', () => {
  const lines = [{ax: 1, ay: 2, az: 3, bx: 4, by: 5, bz: 6, r: 0.1, g: 0.2, b: 0.3, a: 0.4}, {ax: -1, ay: -2, az: -3, bx: 0, by: 0, bz: 0, r: 1, g: 1, b: 1, a: 1}];
  const out = new Float32Array(64);
  assert.equal(fillLineVertexData(lines, 100, out), 2 * 2 * LINE_VERTEX_FLOATS);
  assert.deepEqual([...out.subarray(0, 14)].map(v => +v.toFixed(4)), [1, 2, 3, 0.1, 0.2, 0.3, 0.4, 4, 5, 6, 0.1, 0.2, 0.3, 0.4]);
  assert.equal(fillLineVertexData(lines, 2, out), 14, 'the vertex limit holds whole lines only');
  assert.equal(fillLineVertexData(lines, 100, new Float32Array(20)), 14, 'and so does the output length');
  const webgpu = fs.readFileSync(new URL('../../src/webgpu/renderer.ts', import.meta.url), 'utf8');
  assert.match(webgpu, /import \{ fillLineVertexData \} from '\.\.\/webgl\/lab-streams\.ts'/);
  assert.doesNotMatch(webgpu, /function fillLineVertexData/, 'the WebGPU renderer has no copy of its own');
});

function grid(points, segments, presentation = 'rope') {
  const seg = new Float32Array(segments.length * 8);
  segments.forEach((s, i) => seg.set(s, i * 8));
  return {presentation, positions: new Float32Array(points.flat()), segments: seg, nodeCount: points.length, segmentCount: segments.length, topologyVersion: 1, frameVersion: 1};
}

test('a rope segment is a tube from node A to node B with the radius across it', () => {
  const a = [1, 2, 3], b = [2.2, 2.9, 1.4];
  const rest = Math.hypot(1.2, 0.9, -1.6);
  const frame = grid([a, b], [[0, 1, 1 / rest, 0.05, 0.3, 0.4, 0.5, 1]]);
  const m = new Float32Array(16), c = new Float32Array(4);
  assert.equal(expandRopeSegments(frame, m, c), 1);
  // The cube's +-1 along Y lands on the two nodes.
  apply(m, 0, [0, 1, 0]).forEach((v, i) => close(v, b[i], 1e-5));
  apply(m, 0, [0, -1, 0]).forEach((v, i) => close(v, a[i], 1e-5));
  const x = column(m, 0, 0), y = column(m, 0, 1), z = column(m, 0, 2);
  close(length(x), 0.05, 1e-6); close(length(z), 0.05, 1e-6);
  close(dot(x, y), 0, 1e-6); close(dot(y, z), 0, 1e-6); close(dot(x, z), 0, 1e-8);
  assert.deepEqual([m[3], m[7], m[11], m[15]], [0, 0, 0, 1]);
  // At its rest length the colour is the segment's own.
  [0.3, 0.4, 0.5, 1].forEach((v, i) => close(c[i], v, 1e-6));
});

test('a stretched rope segment turns hot, thinner and emissive; a material member also shows compression', () => {
  const stretched = grid([[0, 0, 0], [1.1, 0, 0]], [[0, 1, 1, 0.1, 0.2, 0.2, 0.2, 1]]);
  const m = new Float32Array(16), c = new Float32Array(4);
  expandRopeSegments(stretched, m, c);
  const tension = Math.min(1, 0.1 * 4.2);
  close(length(column(m, 0, 0)), 0.1 * (1 - tension * 0.2), 1e-6);
  close(c[0], 0.2 + (1 - 0.2) * tension, 1e-6);
  close(c[3], 1 + (2.2 - 1) * tension, 1e-6, 'alpha moves toward the emissive 2.2');
  // Vertical segment: the side axis is chosen off the Y axis, and stays orthogonal.
  const vertical = grid([[0, 0, 0], [0, 2, 0]], [[0, 1, 0.5, 0.1, 1, 1, 1, 1]]);
  expandRopeSegments(vertical, m, c);
  close(dot(column(m, 0, 0), column(m, 0, 1)), 0, 1e-6);
  close(length(column(m, 0, 0)), 0.1, 1e-6);
  const compressed = grid([[0, 0, 0], [0.98, 0, 0]], [[0, 1, 1, 0.1, 0.5, 0.5, 0.5, -4]], 'material');
  expandRopeSegments(compressed, m, c);
  const k = Math.min(1, 0.02 * 24);
  close(length(column(m, 0, 0)), 0.1 * (1 + k * 0.08), 1e-6);
  assert.equal(c[3], -4, 'a translucent material member keeps its material alpha');
  assert.ok(c[2] > 0.5 && c[0] < 0.5, 'compression shifts toward blue');
});

test('rope expansion skips bad node indices and stops at the stream limits', () => {
  const frame = grid([[0, 0, 0], [1, 0, 0]], [[0, 7, 1, 0.1, 1, 1, 1, 1], [0, 1, 1, 0.1, 1, 1, 1, 1]]);
  const m = new Float32Array(32).fill(9), c = new Float32Array(8).fill(9);
  assert.equal(expandRopeSegments(frame, m, c), 2);
  assert.ok(m.subarray(0, 16).every(v => v === 9), 'a segment naming a missing node is left alone, as the compute pass does');
  assert.equal(m[16 + 12], 0.5);
  assert.equal(expandRopeSegments(frame, new Float32Array(16), new Float32Array(4)), 1, 'only the rows that fit');
  const many = {...frame, segmentCount: MAX_ROPE_SEGMENTS + 10, segments: new Float32Array((MAX_ROPE_SEGMENTS + 10) * 8)};
  assert.equal(expandRopeSegments(many, new Float32Array((MAX_ROPE_SEGMENTS + 10) * 16), new Float32Array((MAX_ROPE_SEGMENTS + 10) * 4)), MAX_ROPE_SEGMENTS);
});

test('a packed surface decodes position, octahedral normal, colour and uv', () => {
  const bytes = new Uint8Array(48), view = new DataView(bytes.buffer);
  const put = (i, p, oct, rgba, uv) => {
    const b = i * 24;
    p.forEach((v, k) => view.setFloat32(b + k * 4, v, true));
    view.setInt16(b + 12, Math.round(oct[0] * 32767), true); view.setInt16(b + 14, Math.round(oct[1] * 32767), true);
    rgba.forEach((v, k) => view.setUint8(b + 16 + k, v));
    view.setUint16(b + 20, uv[0], true); view.setUint16(b + 22, uv[1], true);
  };
  put(0, [1, 2, 3], [0, 1], [255, 0, 51, 255], [0, 65535]);
  put(1, [4, 5, 6], [0, 0], [0, 255, 0, 0], [65535, 0]);
  const frame = {path: 'packed', material: 'cloth', vertices: bytes, indices: new Uint16Array([0, 1, 0]), vertexStride: 24, vertexCount: 2, indexCount: 3, topologyVersion: 1, frameVersion: 1};
  const out = new Float32Array(2 * SURFACE_VERTEX_FLOATS);
  assert.equal(decodePackedSurface(frame, out), 2);
  assert.deepEqual([...out.subarray(0, 12)].map(v => +v.toFixed(3)), [1, 2, 3, 0, 1, 0, 1, 0, 0.2, 1, 0, 1]);
  assert.deepEqual([...out.subarray(12, 24)].map(v => +v.toFixed(3)), [4, 5, 6, 0, 0, 1, 0, 1, 0, 0, 1, 0]);
  assert.equal(decodePackedSurface({...frame, vertexStride: 20}, out), 0, 'another stride is not read');
});

test('an intact cloth grid: normals across the grid, the 2x2 check, strain against the rest pose', () => {
  const cols = 4, rows = 3, positions = new Float32Array(cols * rows * 3);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) positions.set([c * 0.5, 1, r * 0.5], (r * cols + c) * 3);
  const frame = {path: 'gpu-cloth', material: 'cloth', positions, restPositions: positions.slice(), indices: new Uint16Array([0, 1, 4]), vertexCount: cols * rows, indexCount: 3,
    topologyVersion: 1, frameVersion: 1, cols, rows, baseColorA: [0.1, 0.2, 0.3, 1], baseColorB: [0.7, 0.6, 0.5, 1]};
  const out = new Float32Array(cols * rows * SURFACE_VERTEX_FLOATS);
  assert.equal(clothSurfaceVertices(frame, out), cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const o = i * SURFACE_VERTEX_FLOATS;
    assert.equal(Math.abs(out[o + 4]), 1, 'a flat cloth faces along Y');
    assert.equal(out[o + 9], 0, 'no strain at rest');
  }
  assert.deepEqual([...out.subarray(6, 9)].map(v => +v.toFixed(3)), [0.1, 0.2, 0.3], 'cell (0,0) has colour A');
  assert.deepEqual([...out.subarray(2 * SURFACE_VERTEX_FLOATS + 6, 2 * SURFACE_VERTEX_FLOATS + 9)].map(v => +v.toFixed(3)), [0.7, 0.6, 0.5], 'cell (2,0) has colour B');
  const pulled = positions.slice(); pulled[0] = -0.5;   // node 0 stretched away from node 1 to twice its rest distance
  clothSurfaceVertices({...frame, positions: pulled}, out);
  assert.equal(out[9], 1, 'a doubled edge saturates the strain');
  assert.ok(out[6] > 0.5, 'and turns the node toward the stress colour');
});

test('a water grid: positions centred on the basin, slope normals, depth colour and foam', () => {
  const cols = 5, rows = 5, eta = new Float32Array(cols * rows);
  const frame = {path: 'gpu-water', material: 'water', eta, u: new Float32Array(25), v: new Float32Array(25), indices: new Uint16Array([0, 1, 5]), vertexCount: 25, indexCount: 3,
    topologyVersion: 1, frameVersion: 1, cols, rows, width: 4, depth: 2, baseY: 0.5};
  const out = new Float32Array(25 * SURFACE_VERTEX_FLOATS);
  waterSurfaceVertices(frame, out);
  assert.deepEqual([...out.subarray(0, 6)], [-2, 0.5, -1, 0, 1, 0]);
  const last = 24 * SURFACE_VERTEX_FLOATS;
  assert.deepEqual([...out.subarray(last, last + 3)], [2, 0.5, 1]);
  assert.equal(out[9], 0, 'calm water has no foam');
  eta[12] = 0.2;   // a bump in the middle
  waterSurfaceVertices(frame, out);
  const left = 11 * SURFACE_VERTEX_FLOATS;
  assert.ok(out[left + 3] < 0, 'the normal left of the bump leans away from it');
  assert.ok(out[12 * SURFACE_VERTEX_FLOATS + 9] > 0.9, 'the bump crest foams');
  close(out[12 * SURFACE_VERTEX_FLOATS + 1], 0.7, 1e-6);
});

test('buildSurface picks the shading, refuses indices past the vertices, and only water casts no shadow', () => {
  const out = new Float32Array(25 * SURFACE_VERTEX_FLOATS);
  const water = {path: 'gpu-water', material: 'water', eta: new Float32Array(4), u: new Float32Array(4), v: new Float32Array(4), indices: new Uint16Array([0, 1, 2, 1, 3, 2]), vertexCount: 4, indexCount: 6,
    topologyVersion: 1, frameVersion: 1, cols: 2, rows: 2, width: 1, depth: 1, baseY: 0};
  const built = buildSurface(water, out);
  assert.equal(built.shading, 'water'); assert.equal(built.castsShadow, false); assert.equal(built.indexCount, 6);
  assert.equal(buildSurface({...water, indices: new Uint16Array([0, 1, 9]), indexCount: 3}, out), null);
  assert.equal(buildSurface({...water, indexCount: 4}, out), null, 'not whole triangles');
  assert.equal(buildSurface(null, out), null);
  const sheet = buildSurface({path: 'packed', material: 'sheet', vertices: new Uint8Array(72), indices: new Uint16Array([0, 1, 2]), vertexStride: 24, vertexCount: 3, indexCount: 3, topologyVersion: 1, frameVersion: 1}, out);
  assert.equal(sheet.shading, 'sheet'); assert.equal(sheet.castsShadow, true);
});
