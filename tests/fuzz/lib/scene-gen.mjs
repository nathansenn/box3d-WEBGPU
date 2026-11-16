// Random valid scene files (src/engine/scene-format.ts), and the native world the scene fuzzers load them into.
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {NativeWorldPool} from '../../../src/engine/native-world.ts';
import {randomBody} from './world-program.mjs';

const artifact = resolve(process.env.BOX3D_WORLD_ARTIFACT_DIR ?? 'public/box3d');
let factory = null, wasm = null;
/** A fresh WASM instance and its world pool (16 worlds). */
export async function nativePool() {
  factory ??= (await import(pathToFileURL(resolve(artifact, 'box3d.js')).href)).default;
  wasm ??= await readFile(resolve(artifact, 'box3d.wasm'));
  return new NativeWorldPool(await factory({wasmBinary: wasm, print: () => {}, printErr: () => {}}));
}

const round = v => Math.fround(v);
const rounded = value => typeof value === 'number' ? round(value) : Array.isArray(value) ? value.map(rounded) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, rounded(v)])) : value;
const rotate = (q, v) => {
  const [x, y, z, w] = q, [vx, vy, vz] = v;
  const tx = 2 * (y * vz - z * vy), ty = 2 * (z * vx - x * vz), tz = 2 * (x * vy - y * vx);
  return [vx + w * tx + y * tz - z * ty, vy + w * ty + z * tx - x * tz, vz + w * tz + x * ty - y * tx];
};
const conj = q => [-q[0], -q[1], -q[2], q[3]];
const unit = q => { const n = Math.hypot(...q); return q.map(v => v / n); };

/**
 * A valid rigid scene: bodies of every shape kind with materials, mass data, filters and flags, joints as a forest whose
 * frames start where the bodies are, free-form userData and extensions, and world settings. Values are float32, as a
 * saved scene's are, so that a save reproduces them exactly.
 */
export function randomScene(r, options = {}) {
  const count = options.bodies ?? r.int(1, 14), bodies = [], materials = {};
  for (const name of r.shuffle(['steel', 'rubber', 'ice', 'oak']).slice(0, r.int(0, 3))) materials[name] = {density: round(r.log(100, 9000)), friction: round(r.real(0, 1)), restitution: round(r.real(0, 0.8)), ...(r.bool() ? {color: r.int(0, 0xffffff)} : {})};
  const names = Object.keys(materials);
  for (let i = 0; i < count; i++) {
    const body = rounded(randomBody(r));
    if (body.rotation) body.rotation = unit(body.rotation).map(round);
    if (body.shape.kind === 'compound') for (const child of body.shape.shapes) if (child.rotation) child.rotation = unit(child.rotation).map(round);
    if (body.filter) body.filter = {categoryBits: String(body.filter.categoryBits), maskBits: String(body.filter.maskBits), groupIndex: body.filter.groupIndex};
    if (body.shape.kind === 'mesh' || body.shape.kind === 'heightfield') body.shape = {...body.shape, ...(body.shape.indices ? {indices: [...body.shape.indices]} : {})};
    if (names.length && r.bool(0.3)) body.material = r.pick(names);
    if (r.bool(0.15)) body.userData = randomJson(r, 2);
    bodies.push({id: `b${i}${r.pick(['', '.x', ':part', '-a', '_1'])}`, ...body});
  }
  const joints = [], held = new Set();
  for (let i = 0; i < r.int(0, Math.min(8, count)); i++) {
    const child = r.pick(bodies);
    if ((child.type ?? 'dynamic') !== 'dynamic' || held.has(child.id)) continue;
    const parent = r.bool(0.6) ? r.pick(bodies) : null;
    if (parent && (parent === child || descends(joints, parent.id, child.id))) continue;
    held.add(child.id);
    const type = r.pick(['weld', 'revolute', 'spherical', 'prismatic', 'distance', 'wheel']);
    const local = (body, point) => body ? rotate(conj(body.rotation ?? [0, 0, 0, 1]), [point[0] - body.position[0], point[1] - body.position[1], point[2] - body.position[2]]).map(round) : point;
    const anchor = child.position, from = type === 'distance' && parent ? parent.position : anchor;
    const joint = {id: `j${i}`, type, bodyA: parent ? parent.id : null, bodyB: child.id, frameA: {position: local(parent, from)}, frameB: {position: local(child, anchor)}};
    if (type === 'distance') joint.length = round(Math.max(0.05, Math.hypot(anchor[0] - from[0], anchor[1] - from[1], anchor[2] - from[2])));
    else if (type !== 'weld' && r.bool(0.4)) joint.limits = {lower: round(-r.real(0.05, 1)), upper: round(r.real(0.05, 1))};
    if (['revolute', 'prismatic', 'wheel'].includes(type) && r.bool(0.3)) joint.motor = {speed: round(r.real(-3, 3)), maxForce: round(r.real(0, 100))};
    if (r.bool(0.25)) joint.spring = {hertz: round(r.real(0.5, 10)), dampingRatio: round(r.real(0, 2))};
    if (type === 'spherical' && r.bool(0.4)) joint.coneAngle = round(r.real(0.1, 1.2));
    if (r.bool(0.2)) joint.stiffness = {hertz: round(r.real(20, 90)), dampingRatio: round(r.real(0.5, 3))};
    if (r.bool(0.2)) joint.collideConnected = true;
    joints.push(joint);
  }
  const needsV2 = bodies.some(b => b.shape.kind === 'compound' || b.massData);
  const scene = {format: 'box3d-scene', version: needsV2 || r.bool() ? 2 : 1, bodies};
  if (r.bool(0.7)) scene.world = {...(r.bool() ? {gravity: [0, round(r.real(-20, -1)), 0]} : {}), ...(r.bool() ? {ground: r.bool(0.8)} : {}), ...(r.bool() ? {seed: r.int(0, 0xffffffff)} : {}), ...(r.bool(0.3) ? {step: r.pick([1 / 60, 1 / 120, 1 / 90])} : {}), ...(r.bool(0.3) ? {subSteps: r.int(1, 8)} : {})};
  if (names.length) scene.materials = materials;
  if (joints.length) scene.joints = joints;
  if (r.bool(0.3)) scene.units = 'SI';
  if (r.bool(0.3)) scene.meta = {title: `fuzz ${r.seed}`, ...(r.bool() ? {description: 'a "quoted" \\ line\nbreak   and unicode: é中'} : {}), ...(r.bool() ? {created: '2026-11-16T12:00:00Z'} : {})};
  if (r.bool(0.2)) scene.extensions = randomJson(r, 3);
  return scene;
}
function descends(joints, candidate, root) {
  for (let id = candidate, depth = 0; depth < 64; depth++) {
    if (id === root) return true;
    const up = joints.find(j => j.bodyB === id);
    if (!up || up.bodyA === null) return false;
    id = up.bodyA;
  }
  return true;
}

/** Free-form JSON with awkward keys, for userData and extensions. */
export function randomJson(r, depth) {
  const keys = ['a', 'key with spaces', 'sl/ash', 'til~de', '', '0', 'toString', 'valueOf', 'hasOwnProperty', 'über', 'emoji\u{1F600}'];
  const value = d => {
    const roll = r.next();
    if (d <= 0 || roll < 0.4) return r.pick([0, -1, 1.5, 1e-7, 123456789, true, false, null, '', 'text', 'line\nbreak']);
    if (roll < 0.7) return Array.from({length: r.int(0, 4)}, () => value(d - 1));
    return Object.fromEntries(Array.from({length: r.int(0, 4)}, () => [r.pick(keys), value(d - 1)]));
  };
  return Object.fromEntries(Array.from({length: r.int(1, 4)}, () => [r.pick(keys), value(depth)]));
}

/** The same value with every object's keys in another order: canonical text and hash must not notice. */
export function shuffleKeys(value, r) {
  if (Array.isArray(value)) return value.map(item => shuffleKeys(item, r));
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(r.shuffle(Object.keys(value)).map(key => [key, shuffleKeys(value[key], r)]));
}

/** Follow a JSON pointer (RFC 6901). Returns {found, value}; a pointer to a missing key of an existing parent is {found: false, parent: true}. */
export function resolvePointer(doc, pointer) {
  if (pointer === '') return {found: true, value: doc, parent: true};
  if (typeof pointer !== 'string' || pointer[0] !== '/') return {found: false, parent: false, malformed: true};
  let node = doc;
  const parts = pointer.slice(1).split('/').map(part => part.replace(/~1/g, '/').replace(/~0/g, '~'));
  for (let i = 0; i < parts.length; i++) {
    const last = i === parts.length - 1;
    if (node === null || typeof node !== 'object') return {found: false, parent: false};
    if (!Object.hasOwn(node, parts[i])) return {found: false, parent: last};
    node = node[parts[i]];
  }
  return {found: true, value: node, parent: true};
}
