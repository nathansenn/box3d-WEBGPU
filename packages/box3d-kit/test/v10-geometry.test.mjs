// Geometry import (OBJ, STL, glTF), mesh measures, convex hulls and convex
// decomposition, checked against closed-form answers. Every fixture is
// generated here; no binary files. Physics runs in SI worlds, as in v08.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createWorld, capabilities} from 'box3d-webgpu-kit';
import {
  parseOBJ, parseSTL, parseGLB, parseGLTF, meshVolume, meshCenterOfMass, meshBounds, weldVertices, transformMesh, flipWinding,
  isClosed, isConvex, convexHull, toHullShape, toMeshShape, toHeightfieldShape, convexDecompose, createBodiesFromMesh, GEOMETRY_LIMITS,
} from 'box3d-webgpu-kit/geometry';

const G = 9.81, HZ = 240, SUB = 4;
const si = (extra = {}) => createWorld({step: 1 / HZ, subSteps: SUB, gravity: [0, -G, 0], ...extra});
const run = (world, seconds) => { for (let i = 0; i < Math.round(seconds * HZ); i++) world.step(); };
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: got ${actual}, expected ${expected} ± ${tolerance}`);
const within = (actual, expected, fraction, label) => near(actual, expected, Math.abs(expected) * fraction, label);
const invalid = (fn, pattern, label) => assert.throws(fn, error => {
  assert.equal(error.code, 'INVALID_PAYLOAD', `${label}: ${error.stack}`);
  if (pattern) assert.match(error.message, pattern, label);
  return true;
}, label);

// ---- Fixture generators ---------------------------------------------------

// A polygon model: {points: [[x, y, z], ...], faces: [[i, j, k, ...], ...]}, faces counter-clockwise from outside.
function boxModel(min = [0, 0, 0], max = [1, 1, 1]) {
  const points = [];
  for (let i = 0; i < 8; i++) points.push([i & 1 ? max[0] : min[0], i & 2 ? max[1] : min[1], i & 4 ? max[2] : min[2]]);
  return {points, faces: [[0, 4, 6, 2], [1, 3, 7, 5], [0, 1, 5, 4], [2, 6, 7, 3], [0, 2, 3, 1], [4, 5, 7, 6]]};
}
function sphereModel(radius, rings) {
  const segments = rings * 2, points = [[0, radius, 0]], faces = [];
  for (let i = 1; i < rings; i++) for (let j = 0; j < segments; j++) {
    const theta = Math.PI * i / rings, phi = 2 * Math.PI * j / segments;
    points.push([radius * Math.sin(theta) * Math.cos(phi), radius * Math.cos(theta), radius * Math.sin(theta) * Math.sin(phi)]);
  }
  points.push([0, -radius, 0]);
  const at = (i, j) => 1 + (i - 1) * segments + j % segments, last = points.length - 1;
  for (let j = 0; j < segments; j++) {
    faces.push([0, at(1, j + 1), at(1, j)]);
    for (let i = 1; i < rings - 1; i++) faces.push([at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)]);
    faces.push([last, at(rings - 1, j), at(rings - 1, j + 1)]);
  }
  return {points, faces};
}
function torusModel(major, minor, nu, nv) {
  const points = [], faces = [];
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const u = 2 * Math.PI * i / nu, w = 2 * Math.PI * j / nv, ring = major + minor * Math.cos(w);
    points.push([ring * Math.cos(u), minor * Math.sin(w), ring * Math.sin(u)]);
  }
  const at = (i, j) => (i % nu) * nv + j % nv;
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) faces.push([at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i + 1, j)]);
  return {points, faces};
}
// A prism: `profile` is a counter-clockwise polygon in the xy plane, extruded from z0 to z1.
// Caps are single polygons listed from `fanFrom`, so a fan from that corner triangulates them.
function prismModel(profile, z0, z1, fanFrom = 0) {
  const n = profile.length, points = [...profile.map(([x, y]) => [x, y, z0]), ...profile.map(([x, y]) => [x, y, z1])];
  const order = profile.map((_, i) => (i + fanFrom) % n), faces = [];
  faces.push(order.map(i => i + n));                       // +z cap, counter-clockwise
  faces.push([order[0], ...order.slice(1).reverse()]);     // -z cap, reversed
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([i, j, j + n, i + n]); }
  return {points, faces};
}
// Triangulate a model as fans: the reference mesh the parsers must reproduce.
function modelMesh(model) {
  const indices = [];
  for (const face of model.faces) for (let k = 1; k + 1 < face.length; k++) indices.push(face[0], face[k], face[k + 1]);
  return {vertices: Float32Array.from(model.points.flat()), indices: Uint32Array.from(indices)};
}
const soupOf = mesh => Array.from(mesh.indices, i => [mesh.vertices[i * 3], mesh.vertices[i * 3 + 1], mesh.vertices[i * 3 + 2]]);

// Writers. Numbers are written with full float32 precision so each format holds the same values.
const num = value => String(Math.fround(value));
function objText(model, {name, offset = 0} = {}) {
  return (name ? `o ${name}\n` : '') + model.points.map(p => `v ${p.map(num).join(' ')}\n`).join('') +
    model.faces.map(face => `f ${face.map(i => i + 1 + offset).join(' ')}\n`).join('');
}
function asciiSTL(mesh, name = 'fixture') {
  const corners = soupOf(mesh);
  let text = `solid ${name}\n`;
  for (let t = 0; t < corners.length; t += 3) {
    text += ' facet normal 0 0 0\n  outer loop\n';
    for (let k = 0; k < 3; k++) text += `   vertex ${corners[t + k].map(num).join(' ')}\n`;
    text += '  endloop\n endfacet\n';
  }
  return `${text}endsolid ${name}\n`;
}
function binarySTL(mesh, header = 'generated by v10-geometry.test.mjs') {
  const corners = soupOf(mesh), triangles = corners.length / 3;
  const bytes = new Uint8Array(84 + 50 * triangles), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode(header).subarray(0, 80));
  view.setUint32(80, triangles, true);
  for (let t = 0; t < triangles; t++) for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) {
    view.setFloat32(84 + t * 50 + 12 + k * 12 + c * 4, corners[t * 3 + k][c], true);
  }
  return bytes;
}
// One glTF primitive from a mesh. `stride` interleaves each position with padding; `indexType` null writes no indices.
function gltfParts(mesh, {indexType = 5123, stride = 12, mode = 4, indices = mesh.indices, pad = 0} = {}) {
  const count = mesh.vertices.length / 3, indexSize = {5121: 1, 5123: 2, 5125: 4}[indexType] ?? 0;
  const positionBytes = count === 0 ? 0 : (count - 1) * stride + 12, indexOffset = Math.ceil((pad + positionBytes) / 4) * 4;
  const bin = new Uint8Array(Math.ceil((indexOffset + indices.length * indexSize) / 4) * 4).fill(0xa5), view = new DataView(bin.buffer);
  for (let i = 0; i < count; i++) for (let c = 0; c < 3; c++) view.setFloat32(pad + i * stride + c * 4, mesh.vertices[i * 3 + c], true);
  indices.forEach((value, i) => {
    if (indexType === 5121) view.setUint8(indexOffset + i, value);
    else if (indexType === 5123) view.setUint16(indexOffset + i * 2, value, true);
    else if (indexType === 5125) view.setUint32(indexOffset + i * 4, value, true);
  });
  const json = {
    asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0, name: 'part'}],
    meshes: [{primitives: [{attributes: {POSITION: 0}, mode, ...(indexType ? {indices: 1} : {})}]}],
    buffers: [{byteLength: bin.length}],
    bufferViews: [{buffer: 0, byteOffset: pad, byteLength: positionBytes, ...(stride !== 12 ? {byteStride: stride} : {})},
      {buffer: 0, byteOffset: indexOffset, byteLength: indices.length * indexSize}],
    accessors: [{bufferView: 0, componentType: 5126, count, type: 'VEC3'}, {bufferView: 1, componentType: indexType ?? 5123, count: indices.length, type: 'SCALAR'}],
  };
  return {json, bin};
}
function glbBytes(json, bin) {
  const text = new TextEncoder().encode(JSON.stringify(json)), jsonLength = Math.ceil(text.length / 4) * 4;
  const total = 12 + 8 + jsonLength + (bin ? 8 + bin.length : 0), bytes = new Uint8Array(total), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true); view.setUint32(4, 2, true); view.setUint32(8, total, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4e4f534a, true);
  bytes.fill(0x20, 20, 20 + jsonLength); bytes.set(text, 20);
  if (bin) { view.setUint32(20 + jsonLength, bin.length, true); view.setUint32(24 + jsonLength, 0x004e4942, true); bytes.set(bin, 28 + jsonLength); }
  return bytes;
}
const glbOf = (mesh, options) => { const {json, bin} = gltfParts(mesh, options); return glbBytes(json, bin); };
const base64 = bytes => Buffer.from(bytes).toString('base64');

// ---- Parsers --------------------------------------------------------------

test('one unit cube as OBJ, ASCII STL, binary STL and GLB: volume 1, the same bounds, closed and convex', t => {
  const cube = boxModel(), reference = modelMesh(cube);
  const parsed = {
    obj: parseOBJ(objText(cube))[0],
    'ascii stl': parseSTL(asciiSTL(reference)),
    'ascii stl bytes': parseSTL(new TextEncoder().encode(asciiSTL(reference))),
    'binary stl': parseSTL(binarySTL(reference)),
    'binary stl buffer': parseSTL(binarySTL(reference).buffer),
    glb: parseGLB(glbOf(reference))[0],
  };
  for (const [format, mesh] of Object.entries(parsed)) {
    assert.ok(mesh.vertices instanceof Float32Array && mesh.indices instanceof Uint32Array, `${format}: typed arrays`);
    // The corners are 0 and 1, exact in float32, so the volume is exact too.
    near(meshVolume(mesh), 1, 1e-12, `${format} volume`);
    assert.deepEqual(meshBounds(mesh), {min: [0, 0, 0], max: [1, 1, 1]}, `${format} bounds`);
    assert.deepEqual(meshCenterOfMass(mesh), [0.5, 0.5, 0.5], `${format} centre of mass`);
    assert.equal(mesh.indices.length, 36, `${format}: 12 triangles`);
    assert.equal(mesh.vertices.length, 24, `${format}: 8 vertices (STL corners are welded)`);
    assert.equal(isClosed(mesh), true, `${format} closed`);
    assert.equal(isConvex(mesh), true, `${format} convex`);
  }
  assert.equal(parsed['ascii stl'].name, 'fixture');
  assert.equal(parsed.glb.name, 'part');
  assert.ok(capabilities().modules.includes('geometry'));
  t.diagnostic('cube volume in OBJ / ASCII STL / binary STL / GLB: 1, 1, 1, 1 (exact)');
});

test('a tetrahedron has volume abc/6 and centroid (a, b, c)/4; transforms scale, move and mirror it correctly', () => {
  const a = 1.5, b = 2, c = 3;
  const tetra = {vertices: new Float32Array([0, 0, 0, a, 0, 0, 0, b, 0, 0, 0, c]), indices: new Uint32Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3])};
  near(meshVolume(tetra), a * b * c / 6, 1e-12, 'volume');
  const centre = meshCenterOfMass(tetra);
  [a / 4, b / 4, c / 4].forEach((expected, k) => near(centre[k], expected, 1e-12, `centroid ${'xyz'[k]}`));
  assert.equal(isConvex(tetra), true);
  near(meshVolume(flipWinding(tetra)), -a * b * c / 6, 1e-12, 'inside out is negative');
  assert.equal(isConvex(flipWinding(tetra)), false, 'an inside-out mesh is not convex');

  // Scale (2, 3, 4), quarter turn about z, move by (10, 20, 30): volume x 24, centroid transformed the same way.
  const turn = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const moved = transformMesh(tetra, {scale: [2, 3, 4], rotation: turn, position: [10, 20, 30]});
  within(meshVolume(moved), 24 * a * b * c / 6, 1e-6, 'scaled volume');
  const movedCentre = meshCenterOfMass(moved), expected = [10 - 3 * b / 4, 20 + 2 * a / 4, 30 + 4 * c / 4];
  expected.forEach((value, k) => near(movedCentre[k], value, 1e-5, `transformed centroid ${'xyz'[k]}`));
  // A mirror keeps the mesh outward-facing.
  near(meshVolume(transformMesh(tetra, {scale: [-1, 1, 1]})), a * b * c / 6, 1e-12, 'mirrored volume stays positive');
  within(meshVolume(transformMesh(tetra, {scale: 0.001})), 1e-9 * a * b * c / 6, 1e-6, 'millimetres to metres');
  invalid(() => transformMesh(tetra, {rotation: [0, 0, 0, 0]}), /quaternion/, 'zero quaternion');
  invalid(() => meshCenterOfMass({vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2]}), /no volume/, 'a flat mesh has no centre of mass');
});

test('a UV sphere converges to 4/3 pi r^3 at second order in the resolution', t => {
  const r = 0.75, exact = 4 / 3 * Math.PI * r ** 3, errors = [];
  for (const rings of [8, 16, 32, 64]) {
    const model = sphereModel(r, rings), mesh = parseOBJ(objText(model))[0];   // triangles at the poles, quads elsewhere
    assert.equal(mesh.indices.length / 3, 2 * (2 * rings) * (rings - 1), 'two triangles per quad, one per pole face');
    assert.equal(isClosed(mesh), true);
    const volume = meshVolume(mesh);
    assert.ok(volume < exact, 'an inscribed polyhedron is smaller than the sphere');
    errors.push((exact - volume) / exact);
    const centre = meshCenterOfMass(mesh);
    near(Math.hypot(...centre), 0, 1e-6 * r, `centre of mass at ${rings} rings`);
    if (rings <= 16) assert.equal(isConvex(mesh), true, 'a sphere mesh is convex');
  }
  for (let k = 1; k < errors.length; k++) {
    const ratio = errors[k - 1] / errors[k];
    assert.ok(ratio > 3.8 && ratio < 4.2, `doubling the resolution divides the error by 4 (got ${ratio})`);
  }
  assert.ok(errors[3] < 2e-3, `volume error at 64 rings is ${errors[3]}`);
  t.diagnostic(`sphere volume error at 8, 16, 32, 64 rings: ${errors.map(e => e.toExponential(3)).join(', ')}`);
});

test('OBJ: negative indices, quads and n-gons, the four corner forms, objects and groups', t => {
  // A hexagonal prism written with relative indices: each face names the vertices just above it.
  const radius = 2, height = 3, hexagon = Array.from({length: 6}, (_, k) => [radius * Math.cos(k * Math.PI / 3), radius * Math.sin(k * Math.PI / 3)]);
  const prism = prismModel(hexagon, 0, height);
  let text = '# hexagonal prism\r\nmtllib ignored.mtl\r\n';
  for (const p of prism.points) text += `v ${p.map(num).join(' ')}\r\n`;
  text += 'vt 0 0\r\nvn 0 0 1\r\nusemtl steel\r\ns off\r\n';
  const forms = [i => `${i}`, i => `${i}/1`, i => `${i}//1`, i => `${i}/1/1`];
  prism.faces.forEach((face, f) => { text += `f ${face.map(i => forms[f % 4](i - prism.points.length)).join(' ')}\r\n`; });
  const [mesh] = parseOBJ(text);
  assert.equal(mesh.indices.length / 3, 2 * 4 + 6 * 2, 'two hexagons as 4-triangle fans and six quads');
  within(meshVolume(mesh), 3 * Math.sqrt(3) / 2 * radius ** 2 * height, 1e-6, 'hexagonal prism volume');
  assert.equal(isClosed(mesh), true);
  t.diagnostic(`hexagonal prism (n-gons, negative indices): volume ${meshVolume(mesh)} vs ${3 * Math.sqrt(3) / 2 * radius ** 2 * height}`);

  // Two objects sharing one vertex list; a group name seen twice is one mesh; a line continuation.
  const a = boxModel([0, 0, 0], [1, 1, 1]), b = boxModel([5, 0, 0], [7, 2, 2]);
  const two = objText(a, {name: 'small'}) + objText(b, {name: 'big', offset: 8}) + 'g small\nv 0 0 9\nf 1 2 \\\n -1\n';
  const meshes = parseOBJ(two);
  assert.deepEqual(meshes.map(m => m.name), ['small', 'big']);
  assert.equal(meshes[0].indices.length / 3, 13, 'the second "small" block joined the first');
  assert.equal(meshes[1].vertices.length, 24, 'each mesh holds only the vertices it uses');
  near(meshVolume(meshes[1]), 8, 1e-12, 'second object volume');
  assert.deepEqual(meshBounds(meshes[1]), {min: [5, 0, 0], max: [7, 2, 2]});

  invalid(() => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 4\n'), /out of range/, 'index past the end');
  invalid(() => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 -4\n'), /line 4.*out of range/, 'relative index before the start');
  invalid(() => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2\n'), /out of range/, 'index zero');
  invalid(() => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 99999999999999999999\n'), /out of range/, 'absurd index');
  invalid(() => parseOBJ('v 0 0 0\nv 1 nan 0\nv 0 1 0\nf 1 2 3\n'), /line 2.*not a finite number/, 'NaN vertex');
  invalid(() => parseOBJ('v 0 0 0\nv 1 1e999 0\nv 0 1 0\nf 1 2 3\n'), /not a finite number/, 'overflowing vertex');
  invalid(() => parseOBJ('v 0 0\n'), /needs x, y and z/, 'short vertex');
  invalid(() => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2\n'), /three corners/, 'two-corner face');
  invalid(() => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 x/3\n'), /face corner/, 'malformed corner');
  invalid(() => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\n'), /no faces/, 'no faces');
  invalid(() => parseOBJ(new Uint8Array(4)), /string/, 'not text');
});

test('STL: a binary file whose header starts with "solid", ASCII details, and truncation', () => {
  const reference = modelMesh(boxModel([-1, -2, -3], [1, 2, 3]));
  const sneaky = binarySTL(reference, 'solid exported by a CAD package that writes this in binary files');
  assert.equal(new TextDecoder().decode(sneaky.subarray(0, 5)), 'solid');
  const mesh = parseSTL(sneaky);
  near(meshVolume(mesh), 48, 1e-12, 'volume of the "solid" binary');
  assert.deepEqual(meshBounds(mesh), {min: [-1, -2, -3], max: [1, 2, 3]});
  assert.equal(mesh.vertices.length / 3, 8, 'welded to 8 corners');
  // The same bytes as a view into a larger buffer.
  const padded = new Uint8Array(sneaky.length + 7);
  padded.set(sneaky, 3);
  near(meshVolume(parseSTL(padded.subarray(3, 3 + sneaky.length))), 48, 1e-12, 'a Uint8Array view with an offset');

  const ascii = asciiSTL(reference, 'two words');
  assert.equal(parseSTL(ascii).name, 'two words');
  near(meshVolume(parseSTL(ascii.replace(/\n/g, '\r\n').toUpperCase())), 48, 1e-12, 'CRLF and upper case keywords');
  near(meshVolume(parseSTL(ascii + asciiSTL(modelMesh(boxModel([10, 0, 0], [11, 1, 1])), 'second'))), 49, 1e-12, 'two solids are merged');

  invalid(() => parseSTL(sneaky.subarray(0, sneaky.length - 1)), /truncated/, 'binary cut by one byte');
  invalid(() => parseSTL(binarySTL(reference).subarray(0, 300)), /declares 12 triangles \(684 bytes\) but the data is 300 bytes/, 'binary cut short');
  invalid(() => parseSTL(new Uint8Array(40)), /truncated/, 'shorter than a header');
  invalid(() => parseSTL(new Uint8Array(84)), /no triangles/, 'zero triangles');
  const huge = new Uint8Array(84);
  new DataView(huge.buffer).setUint32(80, 0xffffffff, true);
  invalid(() => parseSTL(huge), /declares 4294967295 triangles/, 'a count far beyond the data');
  const poisoned = binarySTL(reference);
  new DataView(poisoned.buffer).setFloat32(84 + 50 * 3 + 12 + 8, NaN, true);
  invalid(() => parseSTL(poisoned), /triangle 3.*not finite/, 'NaN coordinate in binary');
  invalid(() => parseSTL(ascii.slice(0, ascii.lastIndexOf('endsolid'))), /truncated/, 'ASCII without endsolid');
  invalid(() => parseSTL(ascii.slice(0, ascii.indexOf('endloop'))), /truncated/, 'ASCII cut inside a facet');
  invalid(() => parseSTL(ascii.replace('vertex 1 2 3', 'vertex 1 NaN 3')), /not a finite number/, 'NaN coordinate in ASCII');
  invalid(() => parseSTL(ascii.replace('  endloop\n', '   vertex 0 0 0\n  endloop\n')), /more than three/, 'four vertices in a facet');
  invalid(() => parseSTL('hello world'), /unexpected|solid/, 'not an STL');
  invalid(() => parseSTL('solid empty\nendsolid empty\n'), /no triangles/, 'empty solid');
  invalid(() => parseSTL(12), /ArrayBuffer or Uint8Array/, 'wrong type');
});

test('glTF: node transforms, byteStride, 8-, 16- and 32-bit and absent indices, strips and fans, data URIs and external buffers', t => {
  const cube = modelMesh(boxModel());
  // Every storage variant of the same cube parses to the same mesh.
  for (const [label, options] of [['8-bit indices', {indexType: 5121}], ['16-bit indices', {indexType: 5123}], ['32-bit indices', {indexType: 5125}],
    ['byteStride 20', {stride: 20}], ['byteStride 32 at an offset, 8-bit', {stride: 32, pad: 8, indexType: 5121}]]) {
    const [mesh] = parseGLB(glbOf(cube, options));
    assert.deepEqual([...mesh.vertices], [...cube.vertices], `${label}: positions`);
    assert.deepEqual([...mesh.indices], [...cube.indices], `${label}: indices`);
    near(meshVolume(mesh), 1, 1e-12, `${label}: volume`);
  }
  // No indices: 36 corners in order.
  const corners = {vertices: Float32Array.from(soupOf(cube).flat()), indices: new Uint32Array(0)};
  const [unindexed] = parseGLB(glbOf(corners, {indexType: null}));
  assert.equal(unindexed.indices.length, 36);
  near(meshVolume(unindexed), 1, 1e-12, 'non-indexed volume');
  assert.equal(weldVertices(unindexed).vertices.length, 24, 'welding recovers the 8 corners');

  // Translation, rotation and scale on the node: the cube becomes a 2 x 3 x 4 box, turned a quarter about z, at (1, 2, 3).
  const turn = [0, 0, Math.SQRT1_2, Math.SQRT1_2], {json, bin} = gltfParts(cube);
  json.nodes[0] = {mesh: 0, translation: [1, 2, 3], rotation: turn, scale: [2, 3, 4]};
  json.meshes[0].name = 'cube';
  const [placed] = parseGLB(glbBytes(json, bin));
  within(meshVolume(placed), 24, 1e-6, 'TRS volume');
  const bounds = meshBounds(placed);
  [[-2, 2, 3], [1, 4, 7]].forEach((corner, k) => corner.forEach((value, c) => near((k ? bounds.max : bounds.min)[c], value, 1e-6, `TRS bounds ${k ? 'max' : 'min'} ${'xyz'[c]}`)));
  const same = transformMesh(cube, {position: [1, 2, 3], rotation: turn, scale: [2, 3, 4]});
  placed.vertices.forEach((value, i) => near(value, same.vertices[i], 1e-6, 'glTF TRS agrees with transformMesh'));
  assert.equal(placed.name, 'cube', 'a node without a name takes the mesh name');
  t.diagnostic(`TRS node: volume ${meshVolume(placed)} (24), bounds ${JSON.stringify(bounds)}`);

  // A hierarchy: a parent matrix (mirror in x, move +10 in x) over a child that scales by 2. Children inherit; the mirror keeps the winding outward.
  json.nodes = [{children: [1], matrix: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 10, 0, 0, 1]}, {mesh: 0, scale: [2, 2, 2], name: 'child'}, {mesh: 0, name: 'not in the scene'}];
  const hierarchy = parseGLB(glbBytes(json, bin));
  assert.equal(hierarchy.length, 1, 'only the default scene is read');
  assert.equal(hierarchy[0].name, 'child');
  near(meshVolume(hierarchy[0]), 8, 1e-12, 'mirrored child volume stays positive');
  assert.deepEqual(meshBounds(hierarchy[0]), {min: [8, 0, 0], max: [10, 2, 2]});

  // A triangle strip of three quads and a fan over a hexagon, both facing +y.
  const strip = {vertices: new Float32Array([0, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 2, 0, 0, 2, 0, 1, 3, 0, 0, 3, 0, 1]), indices: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7])};
  const hexagon = [0, 0, 0, ...Array.from({length: 7}, (_, k) => [Math.cos(-k * Math.PI / 3), 0, Math.sin(-k * Math.PI / 3)]).flat()];
  const fan = {vertices: Float32Array.from(hexagon), indices: Uint32Array.from([0, 1, 2, 3, 4, 5, 6, 7])};
  const area = (mesh, expectTriangles, expectArea, label) => {
    assert.equal(mesh.indices.length / 3, expectTriangles, `${label}: triangle count`);
    let total = 0;
    for (let k = 0; k < mesh.indices.length; k += 3) {
      const [a, b, c] = [0, 1, 2].map(j => [...mesh.vertices.subarray(mesh.indices[k + j] * 3, mesh.indices[k + j] * 3 + 3)]);
      const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
      assert.ok(ny > 0, `${label}: triangle ${k / 3} faces up`);
      total += ny / 2;
    }
    within(total, expectArea, 1e-6, `${label}: area`);
  };
  area(parseGLB(glbOf(strip, {mode: 5}))[0], 6, 3, 'strip');
  area(parseGLB(glbOf(strip, {mode: 5, indexType: null}))[0], 6, 3, 'non-indexed strip');
  area(parseGLB(glbOf(fan, {mode: 6, indexType: 5121}))[0], 6, 3 * Math.sqrt(3) / 2, 'fan');
  const stitched = parseGLB(glbOf(strip, {mode: 5, indices: Uint32Array.from([0, 1, 2, 3, 3, 4, 4, 5, 6, 7])}))[0];
  assert.ok(stitched.indices.length / 3 < 8, 'stitching corners of a strip leave no zero-area triangles');

  // The same data as a data: URI and as an external file.
  const embedded = structuredClone(gltfParts(cube).json);
  embedded.buffers[0].uri = `data:application/octet-stream;base64,${base64(bin)}`;
  near(meshVolume(parseGLTF(JSON.stringify(embedded))[0]), 1, 1e-12, 'data: URI');
  embedded.buffers[0].uri = 'cube%20data.bin';
  near(meshVolume(parseGLTF(embedded, {'cube data.bin': bin})[0]), 1, 1e-12, 'external buffer by decoded name');
  near(meshVolume(parseGLTF(embedded, new Map([['cube%20data.bin', bin.buffer]]))[0]), 1, 1e-12, 'external buffer from a Map');
  invalid(() => parseGLTF(embedded), /external file 'cube%20data.bin'.*not supplied/, 'missing external buffer');
  invalid(() => parseGLTF(embedded, {'cube data.bin': bin.subarray(0, 50)}), /declares \d+ bytes but only 50/, 'short external buffer');
});

test('glTF and GLB: unsupported or malformed files fail with INVALID_PAYLOAD and a reason', () => {
  const cube = modelMesh(boxModel());
  const fresh = () => gltfParts(cube);
  const broken = (mutate, pattern, label) => { const {json, bin} = fresh(); mutate(json, bin); invalid(() => parseGLB(glbBytes(json, bin)), pattern, label); };
  broken(json => { json.accessors[0].sparse = {count: 1, indices: {bufferView: 1, componentType: 5123}, values: {bufferView: 0}}; }, /sparse accessor.*not supported/, 'sparse accessor');
  broken(json => { json.accessors[1].count = 37; }, /not a multiple of three|past the end/, 'index count');
  broken(json => { json.accessors[1].count = 2 ** 31; }, /past the end of its bufferView/, 'absurd index count');
  broken(json => { json.accessors[0].count = 2 ** 40; }, /past the end of its bufferView/, 'absurd vertex count');
  broken(json => { json.bufferViews[0].byteLength = 2 ** 33; }, /past the end of its buffer/, 'bufferView beyond the buffer');
  broken(json => { json.buffers[0].byteLength = 1e9; }, /declares 1000000000 bytes but only/, 'buffer longer than the chunk');
  broken(json => { json.bufferViews[0].byteStride = 8; }, /byteStride of 8/, 'stride smaller than a position');
  broken(json => { json.accessors[0].componentType = 5123; }, /VEC3 of FLOAT/, 'quantised positions');
  { const {json, bin} = gltfParts(cube, {indexType: 5125}); json.accessors[1].componentType = 5126; invalid(() => parseGLB(glbBytes(json, bin)), /indices must be SCALAR/, 'float indices'); }
  broken((json, bin) => { new DataView(bin.buffer).setUint16(json.bufferViews[1].byteOffset + 6, 8, true); }, /index 8, out of range for 8 vertices/, 'index out of range');
  broken((json, bin) => { new DataView(bin.buffer).setFloat32(16, NaN, true); }, /position that is not finite/, 'NaN position');
  broken((json, bin) => { new DataView(bin.buffer).setFloat32(16, Infinity, true); }, /position that is not finite/, 'infinite position');
  broken(json => { json.nodes[0].scale = [1, NaN, 1]; }, /scale must be 3 finite numbers/, 'NaN scale');
  broken(json => { json.nodes[0].matrix = [1, 0, 0]; }, /matrix must be 16 finite numbers/, 'short matrix');
  broken(json => { json.nodes[0].children = [0]; }, /reached twice/, 'a node that is its own child');
  broken(json => { json.nodes.push({children: [0]}); json.scenes[0].nodes = [0, 1]; }, /reached twice/, 'a node with two parents');
  broken(json => { json.scenes[0].nodes = [3]; }, /node 3 does not exist/, 'missing node');
  broken(json => { json.nodes[0].mesh = 2; }, /mesh 2 does not exist/, 'missing mesh');
  broken(json => { json.meshes[0].primitives[0].mode = 9; }, /unknown mode/, 'unknown mode');
  broken(json => { json.meshes[0].primitives[0].mode = 1; }, /no triangle meshes/, 'lines only');
  broken(json => { json.asset.version = '1.0'; }, /only version 2\.0/, 'glTF 1.0');
  broken(json => { json.extensionsRequired = ['KHR_draco_mesh_compression']; }, /requires the extension KHR_draco_mesh_compression/, 'Draco');
  broken(json => { json.buffers[0].uri = 'data:application/octet-stream,plain'; }, /not base64/, 'data URI without base64');
  broken(json => { json.buffers.push({byteLength: 4}); json.bufferViews[0].buffer = 1; }, /no uri and there is no GLB binary chunk/, 'second buffer without a uri');
  // A required extension that does not touch geometry is fine.
  { const {json, bin} = fresh(); json.extensionsRequired = ['KHR_materials_unlit']; near(meshVolume(parseGLB(glbBytes(json, bin))[0]), 1, 1e-12, 'harmless extension'); }

  const good = glbOf(cube);
  const patched = (offset, value) => { const copy = good.slice(); new DataView(copy.buffer).setUint32(offset, value, true); return copy; };
  invalid(() => parseGLB(patched(0, 0x46546c68)), /magic/, 'wrong magic');
  invalid(() => parseGLB(new TextEncoder().encode('solid not a glb at all, just text')), /magic/, 'text is not a GLB');
  invalid(() => parseGLB(patched(4, 1)), /version 1/, 'GLB version 1');
  invalid(() => parseGLB(patched(8, good.length + 4)), /declares \d+ bytes but the data is/, 'declared length too long');
  invalid(() => parseGLB(good.subarray(0, good.length - 8)), /declares \d+ bytes but the data is/, 'truncated GLB');
  invalid(() => parseGLB(patched(12, 0xfffffff0)), /chunk of 4294967280 bytes runs past the end/, 'chunk longer than the file');
  invalid(() => parseGLB(patched(16, 0x004e4942)), /first chunk must be JSON/, 'BIN chunk first');
  invalid(() => parseGLB(new Uint8Array(8)), /truncated/, 'shorter than a header');
  invalid(() => parseGLB('glTF'), /ArrayBuffer or Uint8Array/, 'a string');
  invalid(() => parseGLTF('{"asset": '), /does not parse/, 'broken JSON');
  invalid(() => parseGLTF('[]'), /JSON object/, 'JSON array');
});

test('malformed input is rejected before anything large is allocated', () => {
  // None of these may allocate to match the sizes they claim: the claims add up to tens of gigabytes.
  global.gc?.();
  const before = process.memoryUsage().arrayBuffers;
  const cube = modelMesh(boxModel());
  for (let round = 0; round < 5; round++) {
    const stl = new Uint8Array(84 + 50);
    new DataView(stl.buffer).setUint32(80, 80_000_000 + round, true);
    invalid(() => parseSTL(stl), /truncated or corrupt/, 'STL claiming 80 million triangles');
    const {json, bin} = gltfParts(cube);
    json.accessors[0].count = 300_000_000; json.accessors[1].count = 900_000_000;
    invalid(() => parseGLB(glbBytes(json, bin)), /past the end/, 'glTF claiming 300 million vertices');
    const many = gltfParts(cube);
    // 2,000 nodes instancing one mesh is fine; the caps count what would be produced, not what the file stores.
    many.json.nodes = Array.from({length: 2000}, () => ({mesh: 0}));
    many.json.scenes[0].nodes = many.json.nodes.map((_, i) => i);
    assert.equal(parseGLB(glbBytes(many.json, many.bin)).length, 2000);
  }
  // One mesh instanced beyond the vertex cap is refused part-way, not built.
  const big = {vertices: new Float32Array(3 * 70_000), indices: Uint32Array.from([0, 1, 2])};
  big.vertices.forEach((_, i) => { big.vertices[i] = i % 7; });
  const flood = gltfParts(big, {indexType: 5125});
  flood.json.nodes = Array.from({length: 100}, () => ({mesh: 0}));
  flood.json.scenes[0].nodes = flood.json.nodes.map((_, i) => i);
  assert.ok(100 * 70_000 > GEOMETRY_LIMITS.maxVertices);
  invalid(() => parseGLB(glbBytes(flood.json, flood.bin)), /more than 4000000 vertices/, 'instancing past the vertex cap');
  invalid(() => weldVertices({vertices: {length: 3 * (GEOMETRY_LIMITS.maxVertices + 1)}, indices: []}), /limit is 4000000/, 'mesh over the vertex cap');
  invalid(() => toHeightfieldShape(() => 0, {countX: 4096, countZ: 4096, spacing: [1, 1]}), /exceeds 4194304 points/, 'height field over the cap');
  const grown = process.memoryUsage().arrayBuffers - before;
  assert.ok(grown < 256 * 1024 * 1024, `array buffers grew by ${grown} bytes`);
});

// ---- Utilities ------------------------------------------------------------

test('mesh checks, welding, closed and convex tests', () => {
  invalid(() => meshVolume({vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 3]}), /index 3 is out of range/, 'index out of range');
  invalid(() => meshVolume({vertices: [0, 0, 0, 1, 0, 0, 0, 1, NaN], indices: [0, 1, 2]}), /vertex 2 is not finite/, 'NaN vertex');
  invalid(() => meshVolume({vertices: [0, 0, 0, 1], indices: []}), /triples/, 'ragged vertices');
  invalid(() => meshVolume({vertices: [0, 0, 0], indices: [0, 0]}), /triples/, 'ragged indices');
  invalid(() => meshVolume({vertices: [0, 0, 0], indices: [0, 0, 0.5]}), /out of range/, 'fractional index');
  invalid(() => meshBounds({vertices: [], indices: []}), /no vertices/, 'empty bounds');
  invalid(() => weldVertices({vertices: [0, 0, 0], indices: []}, -1), /tolerance/, 'negative tolerance');

  // Triangle soup of a cube with 1e-4 noise: exact welding leaves 36 corners, a 1e-3 tolerance recovers 8.
  const cube = modelMesh(boxModel()), soup = soupOf(cube);
  let seed = 12345;
  const noise = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed / 0x7fffffff - 0.5) * 2e-4; };
  const noisy = {vertices: Float32Array.from(soup.flatMap(p => p.map(c => c + noise()))), indices: Uint32Array.from(soup.map((_, i) => i))};
  assert.equal(weldVertices(noisy).vertices.length / 3, 36);
  assert.equal(isClosed(noisy), false, 'unwelded soup is open');
  const welded = weldVertices(noisy, 1e-3);
  assert.equal(welded.vertices.length / 3, 8);
  assert.equal(welded.indices.length / 3, 12);
  assert.equal(isClosed(welded), true);
  assert.equal(isClosed(noisy, 1e-3), true);
  within(meshVolume(welded), 1, 1e-3, 'noisy cube volume');
  // Points that straddle a grid-cell boundary still merge, and -0 equals 0.
  assert.equal(weldVertices({vertices: [0.00099, 0, 0, 0.00101, 0, 0, -0, 0, 0, 0, 0, 0], indices: []}, 1e-4).vertices.length / 3, 2);
  // Welding drops triangles that collapse.
  assert.equal(weldVertices({vertices: [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2, 0, 2, 3]}).indices.length, 3);

  // An open box (one face missing) is not closed and not convex; an L prism is closed but not convex.
  const open = {vertices: cube.vertices, indices: cube.indices.subarray(0, 30)};
  assert.equal(isClosed(open), false);
  assert.equal(isConvex(open), false);
  const ell = modelMesh(prismModel([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], 0, 1, 3));
  assert.equal(isClosed(ell), true);
  near(meshVolume(ell), 3, 1e-12, 'L prism volume');
  assert.equal(isConvex(ell), false);
  // The cube with its top face (corners 2, 6, 7, 3) replaced by a shallow pit 1 mm deep at the centre.
  const sides = [...cube.indices].filter((_, k) => Math.floor(k / 3) !== 6 && Math.floor(k / 3) !== 7);
  assert.equal(sides.length, 30);
  const dentedMesh = {vertices: Float32Array.from([...cube.vertices, 0.5, 0.999, 0.5]), indices: Uint32Array.from([...sides, 2, 6, 8, 6, 7, 8, 7, 3, 8, 3, 2, 8])};
  assert.equal(isClosed(dentedMesh), true);
  within(meshVolume(dentedMesh), 1 - 0.001 / 3, 1e-6, 'dented cube volume (a pyramid of height 1e-3 removed)');
  assert.equal(isConvex(dentedMesh), false, 'a 1 mm dent is not convex');
  assert.equal(isConvex(dentedMesh, 2e-3), true, 'unless the tolerance allows it');
});

test('convex hulls: exact for a cube, inscribed and close for a decimated sphere', t => {
  // Hull of a cube's corners plus points inside and on its faces.
  const points = [...modelMesh(boxModel()).vertices, 0.5, 0.5, 0.5, 0.2, 0.9, 0.1, 0.5, 0.5, 1, 0, 0.3, 0.3, 1, 1, 0.5];
  const hull = convexHull(points);
  assert.equal(hull.vertices.length / 3, 8, 'only the corners are hull vertices');
  near(meshVolume(hull), 1, 1e-12, 'hull volume');
  assert.equal(isClosed(hull), true);
  assert.equal(isConvex(hull), true);
  assert.deepEqual(toHullShape({vertices: points, indices: []}).kind, 'hull');
  invalid(() => convexHull([0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0.3, 0.3, 0]), /coplanar/, 'flat points');
  invalid(() => convexHull([0, 0, 0, 1, 0, 0]), /coplanar/, 'two points');
  invalid(() => toHullShape(points, {maxPoints: 65}), /4 to 64/, 'more points than Box3D keeps');

  // A 1,986-vertex sphere reduced to 16, 32 and 64 hull points: never larger than the sphere, and closer with more points.
  const r = 0.5, sphere = modelMesh(sphereModel(r, 32)), exact = 4 / 3 * Math.PI * r ** 3, full = meshVolume(convexHull(sphere));
  // The hull treats points within 1e-7 of the diagonal of a face as on it, and may split the sphere's flat quads the other way.
  within(full, meshVolume(sphere), 1e-7, 'the hull of a convex mesh is the mesh');
  const errors = [];
  // Box3D allows 255 half-edges per hull: a hull of triangles is cut to 44 points whatever is asked for.
  for (const [maxPoints, kept] of [[16, 16], [32, 32], [64, 44]]) {
    const shape = toHullShape(sphere, {maxPoints});
    assert.equal(shape.points.length / 3, kept, `${maxPoints} points asked for`);
    const volume = meshVolume(convexHull(shape.points));
    assert.ok(volume <= full * (1 + 1e-9), 'a decimated hull is inscribed');
    errors.push((exact - volume) / exact);
  }
  assert.ok(errors[0] > errors[1] && errors[1] > errors[2], `more points, less error: ${errors}`);
  assert.equal(toHullShape(sphere).points.length / 3, 32, 'the default is 32 points');
  // A hull with polygonal faces keeps all 64: a 32-sided prism has 96 edges.
  const sides = 32, prism = modelMesh(prismModel(Array.from({length: sides}, (_, k) => [Math.cos(2 * Math.PI * k / sides), Math.sin(2 * Math.PI * k / sides)]), -1, 1));
  assert.equal(toHullShape(prism, {maxPoints: 64}).points.length / 3, 64);
  within(meshVolume(convexHull(toHullShape(prism, {maxPoints: 64}).points)), sides * Math.sin(2 * Math.PI / sides), 1e-6, 'prism hull volume = n sin(2 pi / n) r^2 h / 2');
  t.diagnostic(`sphere hull volume deficit at 16, 32, 44 points: ${errors.map(e => (e * 100).toFixed(2) + '%').join(', ')}`);
});

test('height fields sampled from a function and from a mesh', () => {
  const plane = (x, z) => 0.25 * x - 0.5 * z + 3;
  const field = toHeightfieldShape(plane, {countX: 5, countZ: 4, spacing: [0.5, 2], origin: [10, -1]});
  assert.deepEqual(field.origin, [10, 0, -1]);
  assert.equal(field.heights.length, 20);
  for (let j = 0; j < 4; j++) for (let i = 0; i < 5; i++) near(field.heights[i + j * 5], plane(10 + i * 0.5, -1 + j * 2), 1e-6, `height (${i}, ${j})`);
  invalid(() => toHeightfieldShape(() => NaN, {countX: 2, countZ: 2, spacing: [1, 1]}), /returned NaN at grid point \(0, 0\)/, 'NaN height');
  invalid(() => toHeightfieldShape(plane, {countX: 2, countZ: 2}), /spacing is required/, 'function without spacing');
  invalid(() => toHeightfieldShape(plane, {countX: 1, countZ: 2, spacing: [1, 1]}), /at least 2/, 'one column');

  // A wedge 8 m long falling 2 m: the top surface is y = -x / 4, whatever lies below it.
  const wedge = modelMesh(prismModel([[0, 0], [0, -2], [8, -2]], -1, 1));
  near(meshVolume(wedge), 0.5 * 8 * 2 * 2, 1e-12, 'wedge volume');
  const sampled = toHeightfieldShape(wedge, {countX: 17, countZ: 5});
  assert.deepEqual(sampled.origin, [0, 0, -1]);
  assert.deepEqual([...sampled.spacing], [0.5, 0.5]);
  for (let j = 0; j < 5; j++) for (let i = 0; i < 17; i++) near(sampled.heights[i + j * 17], -i * 0.5 / 4, 1e-6, `wedge height (${i}, ${j})`);
  invalid(() => toHeightfieldShape(wedge, {countX: 5, countZ: 5, origin: [-1, -1], spacing: [1, 0.5]}), /no surface above grid point \(0, 0\)/, 'grid wider than the mesh');
  const filled = toHeightfieldShape(wedge, {countX: 5, countZ: 5, origin: [-1, -1], spacing: [1, 0.5], missing: -9});
  assert.equal(filled.heights[0], -9);
  near(filled.heights[2], -0.25, 1e-6, 'covered points keep their height');
});

// ---- Convex decomposition -------------------------------------------------

test('convex decomposition: polyhedral solids split exactly, a torus is approached as hulls are added', t => {
  // L: 3 unit cubes. U: 5. Plus: 5 cubes in a cross. Steps: a staircase of three treads.
  const solids = {
    L: {profile: [[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], fan: 3, volume: 3, hulls: 2},
    U: {profile: [[0, 0], [3, 0], [3, 2], [2, 2], [2, 1], [1, 1], [1, 2], [0, 2]], fan: null, volume: 5, hulls: 3},
    plus: {profile: [[1, 0], [2, 0], [2, 1], [3, 1], [3, 2], [2, 2], [2, 3], [1, 3], [1, 2], [0, 2], [0, 1], [1, 1]], fan: null, volume: 5, hulls: 3},
    steps: {profile: [[0, 0], [3, 0], [3, 1], [2, 1], [2, 2], [1, 2], [1, 3], [0, 3]], fan: null, volume: 6, hulls: 3},
  };
  for (const [name, solid] of Object.entries(solids)) {
    // Caps of the non-star-shaped profiles are built from unit squares instead of one polygon.
    const mesh = solid.fan !== null ? modelMesh(prismModel(solid.profile, 0, 1, solid.fan)) : cellsMesh(solid.profile);
    assert.equal(isClosed(mesh), true, `${name} is closed`);
    near(meshVolume(mesh), solid.volume, 1e-12, `${name} volume`);
    const result = convexDecompose(mesh);
    assert.equal(result.hulls.length, solid.hulls, `${name}: hull count`);
    near(result.meshVolume, solid.volume, 1e-12, `${name}: reported mesh volume`);
    // Stated error for polyhedral solids with flat inner faces: 1e-9 of the volume (float roundoff only).
    near(result.volumeError, 0, 1e-9, `${name}: volume error`);
    near(result.partVolumeError, 0, 1e-9, `${name}: part volume error`);
    for (const hull of result.hulls) {
      near(hull.volume, hull.partVolume, 1e-9, `${name}: each piece is convex`);
      assert.ok(hull.points.length / 3 >= 8 && hull.points.length / 3 <= 32);
      near(meshVolume(convexHull(hull.points)), hull.volume, 1e-9, `${name}: reported hull volume is the hull's volume`);
    }
    // The pieces' centres of mass recombine to the solid's.
    const centre = meshCenterOfMass(mesh);
    for (let k = 0; k < 3; k++) near(result.hulls.reduce((sum, hull) => sum + hull.partVolume * hull.centroid[k], 0) / solid.volume, centre[k], 1e-9, `${name}: centroid ${'xyz'[k]}`);
    t.diagnostic(`${name}: ${result.hulls.length} hulls, volume error ${result.volumeError.toExponential(2)}`);
  }

  // A convex mesh comes back as one hull.
  const single = convexDecompose(modelMesh(boxModel()));
  assert.equal(single.hulls.length, 1);
  near(single.volumeError, 0, 1e-12, 'cube');

  // A torus has no flat inner faces: planes can only approach it. Measured, with loose stated bounds.
  const R = 1, r = 0.4, torus = modelMesh(torusModel(R, r, 24, 12)), volume = meshVolume(torus);
  // 24 x 12 flat facets inscribe the torus: 5.6% under 2 pi^2 R r^2.
  assert.ok(volume < 2 * Math.PI ** 2 * R * r * r);
  within(volume, 2 * Math.PI ** 2 * R * r * r, 0.06, 'torus mesh volume (24 x 12 facets)');
  assert.equal(isConvex(torus), false);
  // One hull fills the hole. Its 32 points also shave the outside, so the error is the net of the two.
  const one = convexDecompose(torus, {maxHulls: 1}), errors = [];
  assert.equal(one.hulls.length, 1);
  assert.ok(one.volumeError > 0.15, `one hull fills the hole (error ${one.volumeError})`);
  for (const maxHulls of [4, 8, 16, 32]) {
    const result = convexDecompose(torus, {maxHulls, maxConcavity: 0});
    assert.equal(result.hulls.length, maxHulls);
    near(result.partVolumeError, 0, 1e-9, `torus pieces at ${maxHulls} hulls add up to the torus`);
    errors.push(result.volumeError);
  }
  assert.ok(errors[0] > errors[1] && errors[1] > errors[2] && errors[2] > errors[3], `more hulls, less error: ${errors}`);
  // Stated error for this torus: within 12% at 16 hulls and 5% at 32 (measured 9.5% and 3.5%).
  assert.ok(Math.abs(errors[2]) < 0.12, `16 hulls bring the torus within 12% (got ${errors[2]})`);
  assert.ok(Math.abs(errors[3]) < 0.05, `32 hulls bring the torus within 5% (got ${errors[3]})`);
  // The default settings stop at 16 hulls.
  assert.equal(convexDecompose(torus).hulls.length, 16);
  t.diagnostic(`torus: volume error with 1, 4, 8, 16, 32 hulls: ${[one.volumeError, ...errors].map(e => (e * 100).toFixed(2) + '%').join(', ')}`);

  invalid(() => convexDecompose({vertices: torus.vertices, indices: torus.indices.subarray(0, 300)}), /closed mesh/, 'open mesh');
  invalid(() => convexDecompose(flipWinding(torus)), /inside out/, 'inside-out mesh');
  invalid(() => convexDecompose(torus, {maxHulls: 0}), /maxHulls/, 'no hulls');
  invalid(() => convexDecompose(torus, {maxHullPoints: 100}), /maxHullPoints/, 'too many hull points');
});

// A closed mesh of a rectilinear profile extruded from z = 0 to 1, built from the unit cells it covers
// (even-odd test at cell centres), with only the outer faces kept. Vertices are shared, so it is closed.
function cellsMesh(profile) {
  const inside = (x, y) => {
    let hit = false;
    for (let i = 0, j = profile.length - 1; i < profile.length; j = i++) {
      const [xi, yi] = profile[i], [xj, yj] = profile[j];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const size = Math.max(...profile.flat()) + 1, filled = (x, y) => x >= 0 && y >= 0 && inside(x + 0.5, y + 0.5);
  const ids = new Map(), vertices = [], indices = [];
  const id = (x, y, z) => { const key = `${x},${y},${z}`; if (!ids.has(key)) { ids.set(key, vertices.length / 3); vertices.push(x, y, z); } return ids.get(key); };
  const quad = (a, b, c, d) => { const [i, j, k, l] = [a, b, c, d].map(p => id(...p)); indices.push(i, j, k, i, k, l); };
  for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) {
    if (!filled(x, y)) continue;
    quad([x, y, 1], [x + 1, y, 1], [x + 1, y + 1, 1], [x, y + 1, 1]);
    quad([x, y, 0], [x, y + 1, 0], [x + 1, y + 1, 0], [x + 1, y, 0]);
    if (!filled(x - 1, y)) quad([x, y, 0], [x, y, 1], [x, y + 1, 1], [x, y + 1, 0]);
    if (!filled(x + 1, y)) quad([x + 1, y, 0], [x + 1, y + 1, 0], [x + 1, y + 1, 1], [x + 1, y, 1]);
    if (!filled(x, y - 1)) quad([x, y, 0], [x + 1, y, 0], [x + 1, y, 1], [x, y, 1]);
    if (!filled(x, y + 1)) quad([x, y + 1, 0], [x, y + 1, 1], [x + 1, y + 1, 1], [x + 1, y + 1, 0]);
  }
  return {vertices: Float32Array.from(vertices), indices: Uint32Array.from(indices)};
}

// ---- Physics round trips --------------------------------------------------

test('a hull body from an imported cube has mass = density x volume, in every format', async t => {
  const world = await si();
  try {
    const model = boxModel([-0.2, -0.3, -0.4], [0.2, 0.3, 0.4]), reference = modelMesh(model), density = 2700;
    const imports = {obj: parseOBJ(objText(model))[0], 'ascii stl': parseSTL(asciiSTL(reference)), 'binary stl': parseSTL(binarySTL(reference)), glb: parseGLB(glbOf(reference))[0]};
    let x = 0;
    for (const [format, mesh] of Object.entries(imports)) {
      const volume = meshVolume(mesh);
      within(volume, 0.4 * 0.6 * 0.8, 1e-6, `${format}: mesh volume`);
      const {bodies, joints} = createBodiesFromMesh(world, mesh, {as: 'hull', position: [x += 2, 0.3, 0], density});
      assert.equal(bodies.length, 1);
      assert.equal(joints.length, 0);
      const mass = world.getState(bodies[0]).mass;
      within(mass, density * volume, 1e-5, `${format}: mass = density x volume`);
      within(mass, 2700 * 0.192, 1e-5, `${format}: mass = 518.4 kg`);
      if (format === 'glb') t.diagnostic(`imported cube hull mass: ${mass} kg, expected ${density * volume}`);
    }
    // A 482-vertex sphere mesh: its hull, cut to the 44 points Box3D can hold, weighs density x that hull's volume.
    const ball = parseOBJ(objText(sphereModel(0.5, 16)))[0], shape = toHullShape(ball, {maxPoints: 64});
    assert.equal(shape.points.length / 3, 44);
    const body = world.createBody({shape, position: [20, 5, 0], density: 1000});
    within(world.getState(body).mass, 1000 * meshVolume(convexHull(shape.points)), 1e-5, 'decimated sphere hull mass');
    assert.throws(() => world.createBody({shape: {kind: 'hull', points: ball.vertices}, position: [30, 5, 0]}), e => e.code === 'INVALID_PAYLOAD', 'the raw vertices are more than Box3D can hold');
    // Through the helper, a closed mesh keeps its own mass although the hull is 14% smaller: density x mesh volume.
    const {bodies: [round]} = createBodiesFromMesh(world, ball, {as: 'hull', maxPoints: 64, position: [25, 5, 0], density: 1000});
    within(world.getState(round).mass, 1000 * meshVolume(ball), 1e-5, 'sphere mesh as a hull body: mass = density x mesh volume');
    // So does a torus cut into 16 welded hulls, whose hulls overlap and are 9% too large in total.
    const torus = modelMesh(torusModel(1, 0.4, 24, 12));
    const ring = createBodiesFromMesh(world, torus, {as: 'decomposed', position: [60, 5, 0], density: 500, decomposition: {maxConcavity: 0}});
    assert.deepEqual([ring.bodies.length, ring.joints.length], [16, 15]);
    within(ring.bodies.reduce((sum, part) => sum + world.getState(part).mass, 0), 500 * meshVolume(torus), 1e-5, 'decomposed torus: total mass = density x mesh volume');
    // A 64-vertex prism keeps every vertex and its exact volume.
    const sides = 32, prism = modelMesh(prismModel(Array.from({length: sides}, (_, k) => [0.5 * Math.cos(2 * Math.PI * k / sides), 0.5 * Math.sin(2 * Math.PI * k / sides)]), -0.5, 0.5));
    const {bodies: [drum]} = createBodiesFromMesh(world, prism, {as: 'hull', maxPoints: 64, position: [40, 5, 0]});
    within(world.getState(drum).mass, 1000 * meshVolume(prism), 1e-5, '64-vertex prism hull mass');
    run(world, 2);
    const height = world.getState(body).position[1];
    assert.ok(height > 0.44 && height < 0.506, `the hull sphere rests on the ground on one of its facets (centre at ${height})`);
    assert.deepEqual(world.bodyKinds().slice(1, 5), ['hull', 'hull', 'hull', 'hull']);
  } finally { world.dispose(); }
});

test('an imported ramp mesh: a sphere slides down it at g sin(theta), and its sampled height field matches', async t => {
  const world = await si({ground: false});
  try {
    // A closed wedge whose top face is the incline of v08: from (0, 0) down to (L cos, -L sin), 8 m wide.
    const theta = 0.3, length = 40, half = 4, c = Math.cos(theta), s = Math.sin(theta), r = 0.25, time = 2;
    const model = prismModel([[0, 0], [0, -length * s], [length * c, -length * s]], -half, half);
    const [imported] = parseOBJ(objText(model, {name: 'ramp'}));
    assert.equal(imported.name, 'ramp');
    assert.equal(isClosed(imported), true);
    assert.equal(isConvex(imported), true);
    within(meshVolume(imported), 0.5 * length * c * length * s * 2 * half, 1e-6, 'wedge volume = base x height x width / 2');
    const {bodies: [ramp]} = createBodiesFromMesh(world, imported, {as: 'mesh', friction: 0});
    assert.equal(world.getState(ramp).type, 'static');
    assert.deepEqual(world.bodyKinds(), ['mesh']);
    const slider = world.createBody({shape: {kind: 'sphere', radius: r}, position: [c + r * s, -s + r * c, 0], friction: 0});
    run(world, time);
    const state = world.getState(slider), speed = Math.hypot(...state.linearVelocity);
    within(speed, G * s * time, 1e-3, 'frictionless: v = g sin(theta) t');
    near(Math.hypot(...state.angularVelocity), 0, 1e-3, 'and no spin');
    near(state.position[0] * s + state.position[1] * c, r, 0.006, 'it stays on the surface (within contact slop)');
    t.diagnostic(`slide down the imported ramp: v = ${speed} m/s, expected ${G * s * time} (error ${((speed / (G * s * time) - 1) * 100).toFixed(4)}%)`);

    // The STL of the same wedge, moved 100 m along z through the transform helper, gives the same slide.
    const moved = transformMesh(parseSTL(binarySTL(modelMesh(model))), {position: [0, 0, 100]});
    createBodiesFromMesh(world, moved, {friction: 0});
    const second = world.createBody({shape: {kind: 'sphere', radius: r}, position: [c + r * s, -s + r * c, 100], friction: 0});
    run(world, time);
    within(Math.hypot(...world.getState(second).linearVelocity), G * s * time, 1e-3, 'STL ramp: v = g sin(theta) t');

    // The wedge sampled as terrain: ray hits land on y = -x tan(theta).
    const terrain = toHeightfieldShape(imported, {countX: 81, countZ: 9});
    world.createBody({shape: terrain, position: [terrain.origin[0], terrain.origin[1], terrain.origin[2] + 200]});
    for (const x of [0.4, 12.3, 37.9]) {
      const hit = world.raycast([x, 50, 200], [0, -100, 0]);
      // Heights are quantised to 16 bits over the field's 11.8 m range: about 0.2 mm.
      near(hit.point[1], -x * Math.tan(theta), 1e-3, `terrain height at x = ${x}`);
    }
    assert.throws(() => createBodiesFromMesh(world, imported, {as: 'compound'}), e => e.code === 'INVALID_PAYLOAD');
  } finally { world.dispose(); }
});

test('an L-shaped mesh becomes welded hulls with the right mass that rest on the ground', async t => {
  const world = await si();
  try {
    // The L of three unit cubes, scaled to 0.5 m cubes: volume 3 / 8 m^3. It stands on its 1 m foot.
    const model = prismModel([[0, 0], [2, 0], [2, 1], [1, 1], [1, 2], [0, 2]], 0, 1, 3);
    const mesh = transformMesh(parseOBJ(objText(model))[0], {scale: 0.5}), volume = 3 / 8, density = 600, drop = 0.2;
    near(meshVolume(mesh), volume, 1e-12, 'L volume');
    const {bodies, joints, decomposition} = createBodiesFromMesh(world, mesh, {as: 'decomposed', position: [0, drop, 0], density, friction: 0.6});
    assert.equal(bodies.length, 2, 'an L is two convex pieces');
    assert.equal(joints.length, 1, 'one weld joint holds them');
    // Stated error of the decomposition for this solid: 1e-9 (the pieces are exactly convex).
    near(decomposition.volumeError, 0, 1e-9, 'hull volume against the mesh');
    near(decomposition.hullVolume, volume, 1e-9, 'total hull volume');
    const mass = bodies.reduce((sum, body) => sum + world.getState(body).mass, 0);
    within(mass, density * volume, 1e-5, 'total mass = density x mesh volume');
    t.diagnostic(`L: ${bodies.length} hulls, volume error ${decomposition.volumeError.toExponential(2)}, mass ${mass} kg, expected ${density * volume}`);

    // World-space hull corners of every piece.
    const corners = () => bodies.flatMap((body, i) => {
      const {position: p, rotation: q} = world.getState(body), points = decomposition.hulls[i].points, out = [];
      for (let k = 0; k < points.length; k += 3) {
        const [x, y, z] = [points[k], points[k + 1], points[k + 2]], [qx, qy, qz, qw] = q;
        const tx = 2 * (qy * z - qz * y), ty = 2 * (qz * x - qx * z), tz = 2 * (qx * y - qy * x);
        out.push([p[0] + x + qw * tx + qy * tz - qz * ty, p[1] + y + qw * ty + qz * tx - qx * tz, p[2] + z + qw * tz + qx * ty - qy * tx]);
      }
      return out;
    });
    const start = corners();
    near(Math.min(...start.map(p => p[1])), drop, 1e-6, 'it starts 0.2 m above the ground');
    const spread = now => Math.abs(Math.hypot(...now[0].map((v, k) => v - now.at(-1)[k])) - Math.hypot(...start[0].map((v, k) => v - start.at(-1)[k])));
    let lowest = Infinity, apart = 0;
    for (let i = 0; i < HZ * 3; i++) {
      world.step();
      const now = corners();
      lowest = Math.min(lowest, ...now.map(p => p[1]));
      // The weld holds the pieces together: a corner of one piece keeps its distance from a corner of the other.
      apart = Math.max(apart, spread(now));
    }
    const rest = corners(), floor = Math.min(...rest.map(p => p[1])), top = Math.max(...rest.map(p => p[1]));
    // Box3D lets resting contacts sink by its linear slop (5 mm); v08 allows 6 mm for the same reason.
    assert.ok(lowest > -0.006, `no corner went below the ground by more than the contact slop (lowest ${lowest})`);
    near(floor, 0, 0.006, 'the L rests on the ground');
    near(top, 1, 0.006, 'standing upright, 1 m tall');
    // Welds are solved iteratively, so the 225 kg set flexes when it lands at 2 m/s, and recovers.
    assert.ok(apart < 5e-3, `the welded pieces stayed within 5 mm of each other during the landing (moved ${apart})`);
    assert.ok(spread(rest) < 1e-3, `and within 1 mm at rest (moved ${spread(rest)})`);
    for (const body of bodies) {
      const state = world.getState(body);
      near(Math.hypot(...state.linearVelocity), 0, 1e-3, 'at rest');
      near(Math.hypot(...state.angularVelocity), 0, 1e-3, 'not turning');
    }
    t.diagnostic(`L at rest: lowest corner ${floor} m, deepest during the landing ${lowest} m, weld flex ${apart} m landing, ${spread(rest)} m at rest`);

    // The pieces of one set never collide with each other; a static set needs no joints.
    const frozen = createBodiesFromMesh(world, mesh, {as: 'decomposed', position: [5, 0, 0], type: 'static'});
    assert.equal(frozen.joints.length, 0);
    assert.deepEqual(frozen.bodies.map(body => world.getState(body).type), ['static', 'static']);
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.1}, position: [5.75, 1.5, 0.25], friction: 0.6, linearDamping: 0.5, angularDamping: 0.5});
    run(world, 2);
    near(world.getState(ball).position[1], 0.5 + 0.1, 0.006, 'a ball dropped on the static L rests on its foot, 0.5 m up');
  } finally { world.dispose(); }
});
