// Geometry and robot files as untrusted input (docs/ROBUSTNESS.md).
//
// OBJ, STL (ASCII and binary), glTF and GLB, XML, URDF and MJCF: valid files mutated at random (characters deleted,
// repeated, swapped, numbers replaced by NaN, infinities, overflowing and malformed numerals, truncation), and hand-made
// hostile files (entity expansion, external references, lying headers and counts, cyclic and very deep structures,
// enormous indices, degenerate triangles). Every input must either parse to data that is finite and in range, or be
// refused by an EngineError that says why, within a time bound and without reading anything outside the input. What
// parses is then pushed through the shape converters and into a native world, which must also stay finite.
import assert from 'node:assert/strict';
import test from 'node:test';
import {ENGINE_ERRORS} from '../../src/engine/contracts.ts';
import {GEOMETRY_LIMITS, convexDecompose, convexHull, meshBounds, parseGLB, parseGLTF, parseOBJ, parseSTL, toHullShape, toMeshShape, weldVertices} from '../../src/engine/geometry.ts';
import {EXAMPLE_ROBOTS, XML_LIMITS, parseMJCF, parseURDF, parseXML, robotReport, robotToScene, spawnRobot} from '../../src/engine/robot-import.ts';
import {validateScene} from '../../src/engine/scene-format.ts';
import {LabSceneHost, loadLabScene, disposeLabScene} from '../../src/lab/scene-host.ts';
import {rng, seeds, scale} from './lib/rng.mjs';
import {nativePool} from './lib/scene-gen.mjs';

const pool = await nativePool();
const SEEDS = seeds(1, 20), ROUNDS = scale(700, 8000);
const stats = {parsed: 0, refused: 0};

/** Run `fn`; it must return, or throw an EngineError of the taxonomy, within `limitMs`. Returns the value or undefined. */
function closed(what, fn, limitMs = 3000) {
  const start = performance.now();
  let value, thrown;
  try { value = fn(); } catch (error) { thrown = error ?? new Error('threw nothing'); }
  const ms = performance.now() - start;
  assert.ok(ms < limitMs, `${what}: took ${ms.toFixed(0)} ms (limit ${limitMs})`);
  if (!thrown) { stats.parsed++; return value; }
  assert.ok(thrown instanceof Error && thrown.name === 'EngineError', `${what}: threw ${thrown?.constructor?.name} instead of an EngineError: ${String(thrown?.stack ?? thrown).slice(0, 500)}`);
  assert.ok(thrown.code in ENGINE_ERRORS, `${what}: code ${thrown.code} is not in the taxonomy`);
  assert.ok(thrown.message.length > 12 && !/\[object Object\]/.test(thrown.message), `${what}: unhelpful message "${thrown.message}"`);
  stats.refused++;
  return undefined;
}
const mustRefuse = (what, fn, limitMs) => { const before = stats.refused; closed(what, fn, limitMs); assert.equal(stats.refused, before + 1, `${what}: accepted`); };

/** A parsed mesh: typed arrays, finite vertices, index triples in range. */
function checkMesh(mesh, what) {
  assert.ok(mesh.vertices instanceof Float32Array && mesh.indices instanceof Uint32Array, `${what}: typed arrays`);
  assert.equal(mesh.vertices.length % 3, 0, what); assert.equal(mesh.indices.length % 3, 0, what);
  const count = mesh.vertices.length / 3;
  assert.ok(count <= GEOMETRY_LIMITS.maxVertices && mesh.indices.length / 3 <= GEOMETRY_LIMITS.maxTriangles, `${what}: within the limits`);
  for (let i = 0; i < mesh.vertices.length; i++) if (!Number.isFinite(mesh.vertices[i])) assert.fail(`${what}: vertex value ${i} is ${mesh.vertices[i]}`);
  for (let i = 0; i < mesh.indices.length; i++) if (mesh.indices[i] >= count) assert.fail(`${what}: index ${i} is ${mesh.indices[i]} of ${count} vertices`);
}
/** Push a parsed mesh through the converters and into a world: each stage returns or refuses cleanly, and the world stays finite. */
function useMesh(world, mesh, what) {
  checkMesh(mesh, what);
  if (mesh.indices.length === 0 || mesh.vertices.length > 30000) return;
  closed(`${what}: meshBounds`, () => meshBounds(mesh));
  closed(`${what}: weldVertices`, () => checkMesh(weldVertices(mesh), `${what} welded`));
  const hull = closed(`${what}: toHullShape`, () => toHullShape(mesh));
  const shape = closed(`${what}: toMeshShape`, () => toMeshShape(mesh));
  closed(`${what}: convexHull`, () => checkMesh(convexHull(mesh), `${what} hull`));
  if (mesh.indices.length <= 600) closed(`${what}: convexDecompose`, () => convexDecompose(mesh, {maxHulls: 4}), 8000);
  for (const [kind, s] of [['hull', hull], ['mesh', shape]]) {
    if (!s) continue;
    const body = closed(`${what}: createBody(${kind})`, () => world.createBody({shape: s, type: kind === 'mesh' ? 'static' : 'dynamic', position: [0, 3, 0]}));
    if (!body) continue;
    world.step(1 / 60, 4);
    const state = world.bodyState(body);
    assert.ok([...state.position, ...state.rotation, ...state.linearVelocity].every(Number.isFinite), `${what}: the ${kind} body is not finite after a step`);
    world.destroyBody(body);
  }
}

const HOSTILE_NUMBERS = ['NaN', 'nan', 'inf', '-inf', 'Infinity', '1e999', '-1e999', '1e-999', '0x1F', '1.2.3', '--1', '+', '.', '1e', '9'.repeat(400), '0.' + '0'.repeat(400) + '1', '١٢', '1,5', '', '1e39', '-0', '4294967296', '-2147483649', '18446744073709551616'];
/** One random edit of a text. */
function mutateText(text, r) {
  if (text.length === 0) return 'x';
  const at = r.int(0, text.length - 1), span = Math.min(text.length - at, r.pick([1, 1, 2, 5, 20, 200]));
  switch (r.int(0, 8)) {
    case 0: return text.slice(0, at) + text.slice(at + span);                                   // delete
    case 1: return text.slice(0, at) + text.slice(at, at + span).repeat(r.int(2, 6)) + text.slice(at + span); // repeat
    case 2: return text.slice(0, at);                                                           // truncate
    case 3: return text.slice(0, at) + r.pick(['<', '>', '&', '"', "'", '\0', '\n', '/', '\\', '￿', ' ', '=', '#', '{', '[', '-', '‮']) + text.slice(at + 1);
    case 4: { // replace a number
      const numbers = [...text.matchAll(/-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?/g)];
      if (!numbers.length) return text.slice(0, at) + '9' + text.slice(at);
      const m = r.pick(numbers);
      return text.slice(0, m.index) + r.pick(HOSTILE_NUMBERS) + text.slice(m.index + m[0].length);
    }
    case 5: { const other = r.int(0, text.length - 1), a = Math.min(at, other), b = Math.max(at, other); return text.slice(0, a) + text[b] + text.slice(a + 1, b) + text[a] + text.slice(b + 1); } // swap
    case 6: return text.slice(0, at) + text.slice(at, at + span).toUpperCase() + text.slice(at + span);
    case 7: return text.slice(at) + text.slice(0, at);                                           // rotate
    default: return text.slice(0, at) + text + text.slice(at);                                   // nest the file in itself
  }
}
function mutateBytes(bytes, r) {
  const out = bytes.slice();
  if (out.length === 0) return out;
  switch (r.int(0, 4)) {
    case 0: return out.slice(0, r.int(0, out.length - 1));
    case 1: out[r.int(0, out.length - 1)] ^= 1 << r.int(0, 7); return out;
    case 2: { const at = r.int(0, Math.max(0, out.length - 4)); out.set([0xff, 0xff, 0xff, 0x7f].slice(0, out.length - at), at); return out; }   // NaN or a huge count
    case 3: { const at = r.int(0, Math.max(0, out.length - 4)); out.set([0, 0, 0x80, 0x7f].slice(0, out.length - at), at); return out; }         // +Infinity
    default: { const bigger = new Uint8Array(out.length + r.int(1, 64)); bigger.set(out); return bigger; }
  }
}

// ---- valid sources ----
const cubeOBJ = `# cube
o cube
v -1 -1 -1
v 1 -1 -1
v 1 1 -1
v -1 1 -1
v -1 -1 1
v 1 -1 1
v 1 1 1
v -1 1 1
vn 0 0 1
vt 0.5 0.5
g sides
f 1 2 3 4
f 5//1 8//1 7//1 6//1
f 1/1/1 5/1/1 6/1/1 2/1/1
f -5 -6 -2 -1
f 2 6 7 3
o second
v 0 2 0
v 1 2 0
v 0 3 0
f 9 10 11
`;
const asciiSTL = `solid tri
 facet normal 0 0 1
  outer loop
   vertex 0 0 0
   vertex 1 0 0
   vertex 0 1 0
  endloop
 endfacet
 facet normal 0 0 1
  outer loop
   vertex 1 0 0
   vertex 1 1 0.5
   vertex 0 1 0
  endloop
 endfacet
endsolid tri
`;
function binarySTL(triangles) {
  const bytes = new Uint8Array(84 + triangles.length * 50), view = new DataView(bytes.buffer);
  view.setUint32(80, triangles.length, true);
  triangles.forEach((t, i) => { for (let k = 0; k < 9; k++) view.setFloat32(84 + i * 50 + 12 + k * 4, t[k], true); });
  return bytes;
}
const tetra = [[0, 0, 0, 1, 0, 0, 0, 1, 0], [0, 0, 0, 0, 0, 1, 1, 0, 0], [0, 0, 0, 0, 1, 0, 0, 0, 1], [1, 0, 0, 0, 0, 1, 0, 1, 0]];
function gltfDocument() {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]), indices = new Uint16Array([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  const bytes = new Uint8Array(positions.byteLength + indices.byteLength);
  bytes.set(new Uint8Array(positions.buffer)); bytes.set(new Uint8Array(indices.buffer), positions.byteLength);
  return {
    json: {
      asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}],
      nodes: [{mesh: 0, name: 'tetra', translation: [0, 1, 0], children: [1]}, {mesh: 0, scale: [2, 2, 2], rotation: [0, 0, 0, 1]}],
      meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1, mode: 4}]}],
      accessors: [{bufferView: 0, componentType: 5126, count: 4, type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1]}, {bufferView: 1, componentType: 5123, count: 12, type: 'SCALAR'}],
      bufferViews: [{buffer: 0, byteOffset: 0, byteLength: positions.byteLength}, {buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength}],
      buffers: [{uri: 'tetra.bin', byteLength: bytes.byteLength}],
    },
    buffers: {'tetra.bin': bytes},
  };
}
function glb(json, bin) {
  const text = new TextEncoder().encode(JSON.stringify(json)), jsonLength = (text.length + 3) & ~3, binLength = (bin.length + 3) & ~3;
  const out = new Uint8Array(12 + 8 + jsonLength + 8 + binLength).fill(0x20), view = new DataView(out.buffer);
  view.setUint32(0, 0x46546C67, true); view.setUint32(4, 2, true); view.setUint32(8, out.length, true);
  view.setUint32(12, jsonLength, true); view.setUint32(16, 0x4E4F534A, true); out.set(text, 20);
  view.setUint32(20 + jsonLength, binLength, true); view.setUint32(24 + jsonLength, 0x004E4942, true); out.set(bin, 28 + jsonLength);
  for (let i = 28 + jsonLength + bin.length; i < out.length; i++) out[i] = 0;
  return out;
}

test('the valid sources of this file parse, so the mutations start from something real', () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: true});
    for (const mesh of parseOBJ(cubeOBJ)) useMesh(world, mesh, 'cube.obj');
    useMesh(world, parseSTL(asciiSTL), 'ascii.stl'); useMesh(world, parseSTL(binarySTL(tetra)), 'binary.stl');
    const doc = gltfDocument();
    for (const mesh of parseGLTF(doc.json, doc.buffers)) useMesh(world, mesh, 'tetra.gltf');
    const embedded = {...doc.json, buffers: [{byteLength: doc.buffers['tetra.bin'].byteLength}]};
    for (const mesh of parseGLB(glb(embedded, doc.buffers['tetra.bin']))) useMesh(world, mesh, 'tetra.glb');
    assert.equal(parseOBJ(cubeOBJ).length, 2); assert.equal(parseSTL(binarySTL(tetra)).indices.length, 12);
  } finally { world.destroy(); }
});

test(`OBJ, STL, glTF and GLB: ${ROUNDS} random mutations each parse to valid data or are refused`, () => {
  const world = pool.createWorld();
  try {
    world.resetWorld({ground: true});
    for (const seed of SEEDS) {
      const r = rng(seed), doc = gltfDocument(), gltfText = JSON.stringify(doc.json);
      const embedded = glb({...doc.json, buffers: [{byteLength: doc.buffers['tetra.bin'].byteLength}]}, doc.buffers['tetra.bin']), stl = binarySTL(tetra);
      for (let i = 0; i < ROUNDS; i++) {
        const depth = r.int(1, 4), edit = text => { let out = text; for (let k = 0; k < depth; k++) out = mutateText(out, r); return out; };
        const tag = `seed ${seed} round ${i}`;
        const obj = edit(cubeOBJ);
        for (const mesh of closed(`${tag}: parseOBJ`, () => parseOBJ(obj)) ?? []) useMesh(world, mesh, `${tag}: obj`);
        const ascii = edit(asciiSTL), solid = closed(`${tag}: parseSTL(text)`, () => parseSTL(ascii));
        if (solid) useMesh(world, solid, `${tag}: ascii stl`);
        let bin = stl; for (let k = 0; k < depth; k++) bin = mutateBytes(bin, r);
        const binary = closed(`${tag}: parseSTL(bytes)`, () => parseSTL(bin));
        if (binary) useMesh(world, binary, `${tag}: binary stl`);
        const json = edit(gltfText);
        for (const mesh of closed(`${tag}: parseGLTF`, () => parseGLTF(json, doc.buffers)) ?? []) useMesh(world, mesh, `${tag}: gltf`);
        let packed = embedded; for (let k = 0; k < depth; k++) packed = mutateBytes(packed, r);
        for (const mesh of closed(`${tag}: parseGLB`, () => parseGLB(packed)) ?? []) useMesh(world, mesh, `${tag}: glb`);
        let buffer = doc.buffers['tetra.bin']; for (let k = 0; k < depth; k++) buffer = mutateBytes(buffer, r);
        for (const mesh of closed(`${tag}: parseGLTF(damaged buffer)`, () => parseGLTF(doc.json, {'tetra.bin': buffer})) ?? []) useMesh(world, mesh, `${tag}: gltf buffer`);
      }
    }
  } finally { world.destroy(); }
});

test('hostile geometry files: lying counts, enormous indices, external references, cycles and non-finite numbers', () => {
  // OBJ
  mustRefuse('OBJ: NaN coordinate', () => parseOBJ('v NaN 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'));
  mustRefuse('OBJ: infinite coordinate', () => parseOBJ('v 1e999 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'));
  // Found by the long run (seed 20261116, round 830): finite as a double, infinite in the mesh's single precision.
  mustRefuse('OBJ: a coordinate beyond float32', () => parseOBJ('v 1e39 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n'));
  mustRefuse('STL: an ASCII coordinate beyond float32', () => parseSTL(asciiSTL.replace('vertex 1 0 0', 'vertex -4e38 0 0')));
  mustRefuse('OBJ: index far beyond the vertices', () => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 99999999999\n'));
  mustRefuse('OBJ: index zero', () => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 0 1 2\n'));
  mustRefuse('OBJ: negative index before the first vertex', () => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -1 -2 -9\n'));
  mustRefuse('OBJ: fractional index', () => parseOBJ('v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1.5 2 3\n'));
  closed('OBJ: a face of 200,000 corners', () => parseOBJ(`${Array.from({length: 200000}, (_, i) => `v ${Math.cos(i)} ${Math.sin(i)} 0`).join('\n')}\nf ${Array.from({length: 200000}, (_, i) => i + 1).join(' ')}\n`), 6000);
  closed('OBJ: one line of 8 MB', () => parseOBJ(`v ${'1 '.repeat(4_000_000)}\n`), 6000);
  closed('OBJ: a megabyte of newlines', () => parseOBJ('\n'.repeat(1 << 20)));
  closed('OBJ: only comments and unknown keywords', () => parseOBJ('# x\nmtllib ../../../../etc/passwd\nusemtl http://example.invalid/m\ncall /dev/zero\n'));
  for (const bad of [null, undefined, 7, {}, [], new Uint8Array(4)]) mustRefuse(`parseOBJ(${Object.prototype.toString.call(bad)})`, () => parseOBJ(bad));
  // STL
  const lying = binarySTL(tetra); new DataView(lying.buffer).setUint32(80, 0xFFFFFFFF, true);
  mustRefuse('STL: header declares 4 billion triangles', () => parseSTL(lying));
  const short = binarySTL(tetra); new DataView(short.buffer).setUint32(80, 1000, true);
  mustRefuse('STL: declares 1,000 triangles, holds 4', () => parseSTL(short));
  const nan = binarySTL(tetra); new DataView(nan.buffer).setFloat32(84 + 12, NaN, true);
  mustRefuse('STL: NaN vertex', () => parseSTL(nan));
  const inf = binarySTL(tetra); new DataView(inf.buffer).setFloat32(84 + 16, Infinity, true);
  mustRefuse('STL: infinite vertex', () => parseSTL(inf));
  mustRefuse('STL: empty', () => parseSTL(new Uint8Array(0)));
  mustRefuse('STL: 83 bytes', () => parseSTL(new Uint8Array(83)));
  mustRefuse('STL: ASCII with a NaN vertex', () => parseSTL(asciiSTL.replace('vertex 1 0 0', 'vertex nan 0 0')));
  mustRefuse('STL: ASCII with two vertices in a facet', () => parseSTL(asciiSTL.replace('   vertex 0 1 0\n', '')));
  closed('STL: every triangle degenerate', () => parseSTL(binarySTL([[0, 0, 0, 0, 0, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1, 1, 1]])));
  for (const bad of [null, undefined, 7, {}, []]) mustRefuse(`parseSTL(${Object.prototype.toString.call(bad)})`, () => parseSTL(bad));
  // glTF
  const doc = gltfDocument(), edit = change => { const json = JSON.parse(JSON.stringify(doc.json)); change(json); return json; };
  const gltfRefused = (what, change, buffers = doc.buffers) => mustRefuse(`glTF: ${what}`, () => parseGLTF(edit(change), buffers));
  gltfRefused('a buffer that is not supplied (http)', j => { j.buffers[0].uri = 'http://example.invalid/evil.bin'; });
  gltfRefused('a buffer that is not supplied (file)', j => { j.buffers[0].uri = 'file:///etc/passwd'; });
  gltfRefused('a buffer path that climbs out', j => { j.buffers[0].uri = '../../../../etc/passwd'; });
  gltfRefused('a malformed data URI', j => { j.buffers[0].uri = 'data:application/octet-stream;base64,@@@@'; });
  gltfRefused('an accessor count of 2^31', j => { j.accessors[0].count = 2 ** 31; });
  gltfRefused('an accessor count of -1', j => { j.accessors[0].count = -1; });
  gltfRefused('an accessor count of 1.5', j => { j.accessors[0].count = 1.5; });
  gltfRefused('an accessor beyond its buffer view', j => { j.accessors[0].byteOffset = 40; });
  gltfRefused('a buffer view beyond its buffer', j => { j.bufferViews[0].byteLength = 1 << 30; });
  gltfRefused('a negative byte offset', j => { j.bufferViews[1].byteOffset = -4; });
  gltfRefused('a byte stride of 1', j => { j.bufferViews[0].byteStride = 1; });
  gltfRefused('a buffer view naming buffer 99', j => { j.bufferViews[0].buffer = 99; });
  gltfRefused('an index accessor of floats', j => { j.accessors[1].componentType = 5126; });
  gltfRefused('an unknown component type', j => { j.accessors[0].componentType = 1; });
  gltfRefused('positions declared SCALAR', j => { j.accessors[0].type = 'SCALAR'; });
  gltfRefused('an index beyond the vertices', j => { j.accessors[0].count = 2; });
  gltfRefused('a node that is its own child', j => { j.nodes[0].children = [0]; });
  gltfRefused('two nodes that contain each other', j => { j.nodes[1].children = [0]; });
  gltfRefused('a child index out of range', j => { j.nodes[0].children = [7]; });
  gltfRefused('a NaN matrix', j => { j.nodes[0].matrix = Array(16).fill(null); delete j.nodes[0].translation; });
  gltfRefused('a scale of 1e39', j => { j.nodes[1].scale = [1e39, 1, 1]; });
  gltfRefused('a mesh index out of range', j => { j.nodes[0].mesh = 5; });
  gltfRefused('version 1.0', j => { j.asset.version = '1.0'; });
  gltfRefused('nodes that are not a list', j => { j.nodes = {length: 2}; });
  const chain = edit(j => { j.nodes = Array.from({length: 50000}, (_, i) => i < 49999 ? {children: [i + 1]} : {mesh: 0}); });
  closed('glTF: a chain of 50,000 nested nodes', () => parseGLTF(chain, doc.buffers), 6000);
  const fan = edit(j => { j.nodes = [{children: Array(100000).fill(1)}, {mesh: 0}]; });
  closed('glTF: one mesh instanced 100,000 times', () => parseGLTF(fan, doc.buffers), 6000);
  const nanBuffer = doc.buffers['tetra.bin'].slice(); new DataView(nanBuffer.buffer).setFloat32(4, NaN, true);
  gltfRefused('a NaN position in the buffer', () => {}, {'tetra.bin': nanBuffer});
  for (const bad of [null, undefined, 7, '', '{', '[]', 'null', '"text"', '{"asset":{"version":"2.0"},"__proto__":{"polluted":1}}']) closed(`parseGLTF(${JSON.stringify(bad)})`, () => parseGLTF(bad));
  assert.equal({}.polluted, undefined);
  // GLB
  const good = glb({...doc.json, buffers: [{byteLength: doc.buffers['tetra.bin'].byteLength}]}, doc.buffers['tetra.bin']);
  const header = change => { const out = good.slice(); change(new DataView(out.buffer)); return out; };
  mustRefuse('GLB: wrong magic', () => parseGLB(header(v => v.setUint32(0, 0x12345678, true))));
  mustRefuse('GLB: version 1', () => parseGLB(header(v => v.setUint32(4, 1, true))));
  mustRefuse('GLB: total length beyond the data', () => parseGLB(header(v => v.setUint32(8, 0x7fffffff, true))));
  mustRefuse('GLB: JSON chunk length beyond the data', () => parseGLB(header(v => v.setUint32(12, 0x7ffffff0, true))));
  mustRefuse('GLB: JSON chunk of another type', () => parseGLB(header(v => v.setUint32(16, 0x004E4942, true))));
  mustRefuse('GLB: 11 bytes', () => parseGLB(good.slice(0, 11)));
  mustRefuse('GLB: empty', () => parseGLB(new Uint8Array(0)));
  for (const bad of [null, undefined, 7, {}, 'glTF']) mustRefuse(`parseGLB(${Object.prototype.toString.call(bad)})`, () => parseGLB(bad));
});

test('XML: entity expansion, external entities, depth, size and malformed markup are refused', () => {
  const root = closed('a small document', () => parseXML('<?xml version="1.0"?><!-- c --><a x="1" y=\'2\'><b>t &lt; &amp; &#65; &#x42;</b><![CDATA[<raw>]]><c/></a>'));
  assert.equal(root.name, 'a'); assert.equal(root.children[0].text, 't < & A B');
  const refused = (what, text, limits) => mustRefuse(`XML: ${what}`, () => parseXML(text, limits));
  refused('billion laughs', `<?xml version="1.0"?><!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol3 "&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;&lol2;">]><lolz>&lol3;</lolz>`);
  refused('an external entity', '<?xml version="1.0"?><!DOCTYPE r [<!ENTITY xxe SYSTEM "file:///etc/passwd">]><r>&xxe;</r>');
  refused('a parameter entity', '<!DOCTYPE r [<!ENTITY % p SYSTEM "http://example.invalid/x.dtd"> %p;]><r/>');
  // A DOCTYPE that only names an external subset declares nothing here: it is skipped and never fetched (this parser has no way to fetch).
  assert.deepEqual(closed('a DOCTYPE that names an external subset', () => parseXML('<!DOCTYPE r SYSTEM "http://example.invalid/r.dtd"><r/>')).children, []);
  refused('an undefined entity', '<r>&nope;</r>');
  refused('a character reference to NUL', '<r>&#0;</r>');
  refused('a character reference beyond Unicode', '<r>&#x110000;</r>');
  refused('a surrogate character reference', '<r>&#xD800;</r>');
  refused('an unterminated entity', '<r>&amp</r>');
  refused('nesting 100,000 deep', '<a>'.repeat(100000) + '</a>'.repeat(100000));
  refused('nesting one beyond the limit', '<a>'.repeat(XML_LIMITS.maxDepth + 1) + '</a>'.repeat(XML_LIMITS.maxDepth + 1));
  refused('300,000 elements', `<r>${'<a/>'.repeat(300000)}</r>`);
  refused('300 attributes', `<r ${Array.from({length: 300}, (_, i) => `a${i}="1"`).join(' ')}/>`);
  refused('a duplicate attribute', '<r a="1" a="2"/>');
  refused('a 1,000-character name', `<${'a'.repeat(1000)}/>`);
  refused('mismatched tags', '<a><b></a></b>');
  refused('an unclosed root', '<a><b/>');
  refused('two roots', '<a/><b/>');
  refused('text only', 'hello');
  refused('an unquoted attribute', '<a x=1/>');
  refused('< in an attribute', '<a x="<"/>');
  refused('an unterminated comment', '<a><!-- x </a>');
  refused('an unterminated CDATA', '<a><![CDATA[ x </a>');
  refused('an unterminated processing instruction', '<?xml version="1.0"<a/>');
  refused('empty', '');
  refused('a document over the character limit', `<r>${'x'.repeat(2000)}</r>`, {maxChars: 1000});
  for (const bad of [null, undefined, 7, {}, [], new Uint8Array(3)]) mustRefuse(`parseXML(${Object.prototype.toString.call(bad)})`, () => parseXML(bad));
  closed('a megabyte of attribute text', () => parseXML(`<r a="${'x'.repeat(1 << 20)}"/>`));
  closed('a megabyte of < characters', () => parseXML('<'.repeat(1 << 20)));
  closed('a megabyte of open comments', () => parseXML('<r>' + '<!--'.repeat(1 << 18)));
  closed('a megabyte of ampersands', () => parseXML('<r>' + '&'.repeat(1 << 20) + '</r>'));
});

test(`URDF and MJCF: example robots mutated ${ROUNDS} times each parse to a valid scene or are refused; hostile files are refused`, () => {
  const world = pool.createWorld();
  let scenes = 0;
  const use = (description, what) => {
    const scene = closed(`${what}: robotToScene`, () => robotToScene(description));
    if (!scene) return;
    const problems = validateScene(scene);
    assert.deepEqual(problems.slice(0, 3), [], `${what}: a parsed robot gave an invalid scene`);
    const loaded = closed(`${what}: load`, () => loadLabScene(world, scene));
    if (!loaded) return;
    try {
      for (let i = 0; i < 3; i++) loaded.simulation.step();
      for (let row = 0; row < world.bodyCount(); row++) { const s = world.bodyState(world.bodyHandle(row)); assert.ok([...s.position, ...s.rotation, ...s.linearVelocity].every(Number.isFinite), `${what}: body row ${row} is not finite`); }
      scenes++;
    } finally { disposeLabScene(loaded); }
  };
  try {
    const robots = Object.entries(EXAMPLE_ROBOTS).map(([name, robot]) => ({name, format: robot.format, text: robot.text()}));
    for (const robot of robots) use((robot.format === 'urdf' ? parseURDF : parseMJCF)(robot.text), robot.name);
    for (const seed of SEEDS) {
      const r = rng(seed);
      for (let i = 0; i < ROUNDS; i++) {
        const robot = r.pick(robots), depth = r.int(1, 3);
        let text = robot.text; for (let k = 0; k < depth; k++) text = mutateText(text, r);
        const what = `seed ${seed} round ${i} (${robot.name})`;
        const description = closed(`${what}: parse`, () => (robot.format === 'urdf' ? parseURDF : parseMJCF)(text, {missingMeshes: r.pick(['error', 'box']), strict: r.bool(0.2)}));
        if (description && i % scale(4, 1) === 0) use(description, what);
      }
    }
    // Hand-made hostile robots.
    const urdf = body => `<?xml version="1.0"?><robot name="r">${body}</robot>`;
    const link = (name, extra = '') => `<link name="${name}"><inertial><mass value="1"/><inertia ixx="0.1" iyy="0.1" izz="0.1" ixy="0" ixz="0" iyz="0"/></inertial><collision><geometry><box size="0.2 0.2 0.2"/></geometry></collision>${extra}</link>`;
    const joint = (name, parent, child, extra = '') => `<joint name="${name}" type="revolute"><parent link="${parent}"/><child link="${child}"/><axis xyz="0 0 1"/><limit lower="-1" upper="1" effort="10" velocity="1"/>${extra}</joint>`;
    const refused = (what, text, parse = parseURDF, options) => mustRefuse(`robot: ${what}`, () => robotToScene(parse(text, options)));
    refused('a joint loop', urdf(link('a') + link('b') + joint('j1', 'a', 'b') + joint('j2', 'b', 'a')));
    refused('a link that is its own parent', urdf(link('a') + joint('j', 'a', 'a')));
    refused('a joint to a link that does not exist', urdf(link('a') + joint('j', 'a', 'ghost')));
    refused('two links with one name', urdf(link('a') + link('a')));
    refused('two roots', urdf(link('a') + link('b')));
    refused('no links', urdf(''));
    refused('a NaN mass', urdf(link('a').replace('value="1"', 'value="NaN"')));
    refused('a negative mass', urdf(link('a').replace('value="1"', 'value="-1"')));
    refused('an infinite inertia', urdf(link('a').replace('ixx="0.1"', 'ixx="1e999"')));
    // A tensor that is not positive definite is not refused: the importer uses the inertia of the link's shapes and says so in its report.
    { const description = parseURDF(urdf(link('a').replace('ixy="0"', 'ixy="5"'))); assert.deepEqual(validateScene(robotToScene(description)), []); assert.match(JSON.stringify(robotReport(description)), /not positive definite/); }
    refused('a box of size zero', urdf(link('a').replace('0.2 0.2 0.2', '0 0.2 0.2')));
    refused('a box with two numbers', urdf(link('a').replace('0.2 0.2 0.2', '0.2 0.2')));
    refused('a zero axis', urdf(link('a') + link('b') + joint('j', 'a', 'b').replace('0 0 1', '0 0 0')));
    refused('limits the wrong way round', urdf(link('a') + link('b') + joint('j', 'a', 'b').replace('lower="-1" upper="1"', 'lower="1" upper="-1"')));
    refused('an unknown joint type', urdf(link('a') + link('b') + joint('j', 'a', 'b').replace('revolute', 'teleport')));
    refused('an origin of 1e30', urdf(link('a') + link('b') + joint('j', 'a', 'b', '<origin xyz="1e30 0 0"/>')));
    refused('a mesh that was not supplied', urdf(link('a').replace('<box size="0.2 0.2 0.2"/>', '<mesh filename="file:///etc/passwd"/>')));
    refused('a mesh over http that was not supplied', urdf(link('a').replace('<box size="0.2 0.2 0.2"/>', '<mesh filename="http://example.invalid/a.stl"/>')));
    refused('a supplied mesh that is not a mesh', urdf(link('a').replace('<box size="0.2 0.2 0.2"/>', '<mesh filename="a.stl"/>')), parseURDF, {meshes: {'a.stl': new Uint8Array(10)}});
    refused('a DOCTYPE', '<!DOCTYPE robot [<!ENTITY x "y">]>' + urdf(link('a')));
    refused('5,000 links', urdf(Array.from({length: 5000}, (_, i) => link(`l${i}`)).join('')));
    refused('a chain deeper than the scene can hold stably is still a valid tree', urdf(link('l0') + Array.from({length: 4200}, (_, i) => link(`l${i + 1}`) + joint(`j${i}`, `l${i}`, `l${i + 1}`)).join('')));
    refused('an MJCF include', '<mujoco><include file="/etc/passwd"/><worldbody><body><geom type="sphere" size="0.1"/></body></worldbody></mujoco>', parseMJCF);
    refused('an MJCF body nested 100 deep', `<mujoco><worldbody>${'<body><joint type="hinge"/><geom type="sphere" size="0.1"/>'.repeat(100)}${'</body>'.repeat(100)}</worldbody></mujoco>`, parseMJCF);
    // Found by the long run (seed 20261116, round 5545): a friction of -2147483649 reached the scene.
    refused('an MJCF geom with a negative friction', '<mujoco><worldbody><body><geom type="sphere" size="0.1" friction="-2147483649 0.005 0.0001"/></body></worldbody></mujoco>', parseMJCF);
    refused('an MJCF geom of NaN size', '<mujoco><worldbody><body><geom type="sphere" size="NaN"/></body></worldbody></mujoco>', parseMJCF);
    refused('an MJCF mesh that was not supplied', '<mujoco><asset><mesh name="m" file="../../secret.stl"/></asset><worldbody><body><geom type="mesh" mesh="m"/></body></worldbody></mujoco>', parseMJCF);
    refused('a URDF handed to the MJCF parser', urdf(link('a')), parseMJCF);
    refused('an MJCF handed to the URDF parser', '<mujoco><worldbody/></mujoco>');
    for (const bad of [null, undefined, 7, {}, [], '']) { mustRefuse(`parseURDF(${JSON.stringify(bad)})`, () => parseURDF(bad)); mustRefuse(`parseMJCF(${JSON.stringify(bad)})`, () => parseMJCF(bad)); }
    // spawnRobot refuses a description that is not one, and leaves the world as it was.
    world.resetWorld({ground: true});
    const host = new LabSceneHost(world, {step: 1 / 60, subSteps: 4, seed: 1});
    for (const bad of [null, {}, {links: 'x'}, {links: [], joints: [], root: 'a'}]) { const count = world.bodyCount(); mustRefuse(`spawnRobot(${JSON.stringify(bad)})`, () => spawnRobot(host, bad)); assert.equal(world.bodyCount(), count); }
  } finally { world.destroy(); }
  console.log(`import fuzz: ${stats.parsed} inputs accepted with valid results, ${stats.refused} refused by a typed error; ${scenes} mutated robots built and stepped`);
});
