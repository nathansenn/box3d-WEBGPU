// Geometry and scene inputs for the Lab scene tests, built in code so no binary fixture is committed.
// tests/physics/lab-scenes.test.mjs and tests/physics/body-geometry.test.mjs use them; the same
// functions write the files that are dropped on the page in the browser check.
import {convexHull} from '../../src/engine/geometry.ts';

/** A deterministic generator in [0, 1). */
export function random(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An L-shaped bracket, closed and concave, in millimetres (200 x 200 x 80), as OBJ text with quad faces. */
export function bracketObj() {
  return `# L bracket, millimetres
o bracket
v 0 0 0
v 200 0 0
v 200 100 0
v 100 100 0
v 100 200 0
v 0 200 0
v 0 0 80
v 200 0 80
v 200 100 80
v 100 100 80
v 100 200 80
v 0 200 80
f 1 6 5 4
f 1 4 3 2
f 7 8 9 10
f 7 10 11 12
f 1 2 8 7
f 2 3 9 8
f 3 4 10 9
f 4 5 11 10
f 5 6 12 11
f 6 1 7 12
`;
}

/** An open half-pipe 4 m long and 2 m wide (a surface, not a solid), as OBJ text. */
export function halfPipeObj(segments = 16) {
  const lines = ['# half pipe, metres', 'o halfpipe'];
  for (let i = 0; i <= segments; i++) {
    const angle = Math.PI + (Math.PI * i) / segments, x = Math.cos(angle), y = 1 + Math.sin(angle);
    lines.push(`v ${x.toFixed(6)} ${y.toFixed(6)} -2`, `v ${x.toFixed(6)} ${y.toFixed(6)} 2`);
  }
  // Wound so the inside of the trough (its upper side) is the front.
  for (let i = 0; i < segments; i++) { const a = i * 2 + 1; lines.push(`f ${a} ${a + 1} ${a + 3} ${a + 2}`); }
  return `${lines.join('\n')}\n`;
}

/** Triangle mesh -> binary STL bytes (each triangle with its geometric normal). */
export function stlBinary(mesh) {
  const triangles = mesh.indices.length / 3, bytes = new Uint8Array(84 + triangles * 50), view = new DataView(bytes.buffer);
  bytes.set(new TextEncoder().encode('box3d lab test fixture'), 0);
  view.setUint32(80, triangles, true);
  for (let t = 0; t < triangles; t++) {
    const p = [0, 1, 2].map(k => { const i = mesh.indices[t * 3 + k] * 3; return [mesh.vertices[i], mesh.vertices[i + 1], mesh.vertices[i + 2]]; });
    const u = p[1].map((v, k) => v - p[0][k]), w = p[2].map((v, k) => v - p[0][k]);
    const n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], length = Math.hypot(...n) || 1;
    const o = 84 + t * 50;
    for (let k = 0; k < 3; k++) view.setFloat32(o + k * 4, n[k] / length, true);
    for (let c = 0; c < 3; c++) for (let k = 0; k < 3; k++) view.setFloat32(o + 12 + c * 12 + k * 4, p[c][k], true);
  }
  return bytes;
}

/** A cut gem, closed and convex, about 0.6 m across, as a triangle mesh. */
export function gemMesh() {
  const points = [0, 0.32, 0, 0, -0.42, 0];
  for (let i = 0; i < 8; i++) {
    const a = (Math.PI * 2 * i) / 8, b = a + Math.PI / 8;
    points.push(0.3 * Math.cos(a), 0.12, 0.3 * Math.sin(a), 0.19 * Math.cos(b), 0.26, 0.19 * Math.sin(b));
  }
  return convexHull(points);
}

/** A torus: closed and concave. `around * tube * 2` triangles. */
export function torusMesh(around = 16, tube = 8, major = 0.5, minor = 0.18) {
  const vertices = [], indices = [];
  for (let i = 0; i < around; i++) for (let j = 0; j < tube; j++) {
    const u = (Math.PI * 2 * i) / around, v = (Math.PI * 2 * j) / tube, r = major + minor * Math.cos(v);
    vertices.push(r * Math.cos(u), minor * Math.sin(v), r * Math.sin(u));
  }
  const at = (i, j) => (i % around) * tube + (j % tube);
  for (let i = 0; i < around; i++) for (let j = 0; j < tube; j++) {
    indices.push(at(i, j), at(i, j + 1), at(i + 1, j + 1), at(i, j), at(i + 1, j + 1), at(i + 1, j));
  }
  return {vertices: Float32Array.from(vertices), indices: Uint32Array.from(indices)};
}

export function meshToObj(mesh, name = 'mesh') {
  const lines = [`o ${name}`];
  for (let i = 0; i < mesh.vertices.length; i += 3) lines.push(`v ${mesh.vertices[i]} ${mesh.vertices[i + 1]} ${mesh.vertices[i + 2]}`);
  for (let i = 0; i < mesh.indices.length; i += 3) lines.push(`f ${mesh.indices[i] + 1} ${mesh.indices[i + 1] + 1} ${mesh.indices[i + 2] + 1}`);
  return `${lines.join('\n')}\n`;
}

/** A minimal .glb holding one indexed triangle mesh. */
export function meshToGlb(mesh) {
  const positions = Float32Array.from(mesh.vertices), indices = Uint32Array.from(mesh.indices);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { min[i % 3] = Math.min(min[i % 3], positions[i]); max[i % 3] = Math.max(max[i % 3], positions[i]); }
  const json = JSON.stringify({
    asset: {version: '2.0'}, scene: 0, scenes: [{nodes: [0]}], nodes: [{mesh: 0, name: 'part'}],
    meshes: [{primitives: [{attributes: {POSITION: 0}, indices: 1, mode: 4}]}],
    buffers: [{byteLength: positions.byteLength + indices.byteLength}],
    bufferViews: [{buffer: 0, byteOffset: 0, byteLength: positions.byteLength}, {buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength}],
    accessors: [{bufferView: 0, componentType: 5126, count: positions.length / 3, type: 'VEC3', min, max}, {bufferView: 1, componentType: 5125, count: indices.length, type: 'SCALAR'}],
  });
  const jsonBytes = new TextEncoder().encode(json), jsonPadded = Math.ceil(jsonBytes.length / 4) * 4, binLength = positions.byteLength + indices.byteLength;
  const bytes = new Uint8Array(12 + 8 + jsonPadded + 8 + binLength), view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546C67, true); view.setUint32(4, 2, true); view.setUint32(8, bytes.length, true);
  view.setUint32(12, jsonPadded, true); view.setUint32(16, 0x4E4F534A, true);
  bytes.fill(0x20, 20, 20 + jsonPadded); bytes.set(jsonBytes, 20);
  const bin = 20 + jsonPadded;
  view.setUint32(bin, binLength, true); view.setUint32(bin + 4, 0x004E4942, true);
  bytes.set(new Uint8Array(positions.buffer), bin + 8); bytes.set(new Uint8Array(indices.buffer), bin + 8 + positions.byteLength);
  return bytes;
}

/**
 * A scene with every shape kind: rolling hills as a height field, a static mesh ramp, convex-hull
 * rocks, and boxes, spheres and a capsule that fall onto them. No ground slab.
 */
export function showcaseScene() {
  const next = random(20261111), round = v => Number(v.toFixed(4));
  const countX = 33, countZ = 33, spacing = 0.5, heights = [];
  for (let z = 0; z < countZ; z++) for (let x = 0; x < countX; x++) {
    const u = x * spacing - 8, w = z * spacing - 8;
    heights.push(round(0.45 * Math.sin(u * 0.7) * Math.cos(w * 0.55) + 0.06 * (u * u + w * w) / 8));
  }
  const bodies = [
    {id: 'hills', shape: {kind: 'heightfield', heights, countX, countZ, spacing: [spacing, spacing]}, position: [-8, 0, -8], color: 0x7FA65A, friction: 0.8},
    // A ramp: a sloping quad with a flat landing, counter-clockwise seen from above.
    {id: 'ramp', shape: {kind: 'mesh', vertices: [-1.5, 0, -1, 1.5, 1.4, -1, 1.5, 1.4, 1, -1.5, 0, 1, 3, 1.4, -1, 3, 1.4, 1], indices: [0, 3, 2, 0, 2, 1, 1, 2, 5, 1, 5, 4]}, position: [-3.5, 0.9, 0], color: 0xC9B38A, friction: 0.5},
  ];
  for (let k = 0; k < 7; k++) {
    const points = [];
    for (let i = 0; i < 14; i++) points.push(round((next() - 0.5) * 0.9), round((next() - 0.5) * 0.7), round((next() - 0.5) * 0.9));
    bodies.push({id: `rock-${k}`, shape: {kind: 'hull', points}, position: [round(-1 + k * 0.9 - 2), round(3 + (k % 3) * 0.9), round((k % 2) * 1.6 - 0.8)], density: 2400, friction: 0.7, color: [0x8D99AE, 0xA68A64, 0x6B705C][k % 3]});
  }
  bodies.push(
    {id: 'ball-a', shape: {kind: 'sphere', radius: 0.3}, position: [-2.4, 3.6, 0.2], restitution: 0.3, color: 0xE4572E},
    {id: 'ball-b', shape: {kind: 'sphere', radius: 0.22}, position: [-1.4, 4.4, -0.3], restitution: 0.3, color: 0x5FA8D3},
    {id: 'crate', shape: {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, position: [2.2, 3, 1.5], rotationEuler: [20, 30, 10], color: 0xF2C14E},
    {id: 'log', shape: {kind: 'capsule', radius: 0.18, halfLength: 0.5}, position: [1.2, 3.2, -2], rotationEuler: [0, 0, 80], color: 0x9BC53D},
  );
  return {format: 'box3d-scene', version: 1, units: 'SI', world: {ground: false}, bodies, meta: {title: 'Shape showcase', description: 'Height field, static mesh, convex hulls, boxes, spheres and a capsule.'}};
}
