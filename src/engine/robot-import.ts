/**
 * Robot import: URDF and MJCF files become a neutral robot description, and a
 * description becomes a scene (docs/SCENE_FORMAT.md) or bodies and joints in a
 * world. Documented in docs/ROBOT_IMPORT.md.
 *
 * The solver is a maximal-coordinate rigid-body solver with one shape per body
 * and no way to set an inertia tensor. So:
 *
 * - every link becomes one body per collision shape, welded together;
 * - each link's MASS is matched exactly by choosing density = mass / volume,
 *   and the inertia tensor that results is compared with the file's and
 *   REPORTED per link (`robotReport`). That gap is the main fidelity limit;
 * - joints are constraints solved iteratively, so a long chain stretches a
 *   little under load (measured in the document above).
 *
 * Nothing here fetches, touches the DOM or needs the WASM. Mesh files are
 * supplied by the caller as bytes. No npm dependency: the XML parser is in
 * this file and never expands entities or reads a DTD.
 *
 * Conventions: SI units and radians; quaternions are [x, y, z, w]; a robot
 * description keeps the file's own axes (Z up for URDF and MJCF) and
 * `robotToScene` turns them into the engine's Y-up world.
 */
import {EngineError} from './contracts.ts';
import {convexHull, parseGLB, parseGLTF, parseOBJ, parseSTL, toHullShape, type BinaryLike, type TriangleMesh} from './geometry.ts';
import type {NativeBodyDescriptor, NativeBodyHandle, NativeJointDescriptor, NativeJointHandle} from './native-world.ts';
import type {Scene, SceneBody, SceneFilter, SceneJoint, SceneShape, SceneWorld} from './scene-format.ts';

type V3 = [number, number, number];
type Q4 = [number, number, number, number];
/** Row-major 3 x 3. */
type M3 = [number, number, number, number, number, number, number, number, number];

function bad(message: string): never { throw new EngineError('INVALID_PAYLOAD', message); }

// ---------------------------------------------------------------------------
// XML
// ---------------------------------------------------------------------------

/** Hard caps of `parseXML`. Input beyond them is refused, with the position. */
export const XML_LIMITS = Object.freeze({
  /** Characters in the document. */
  maxChars: 16 * 1024 * 1024,
  /** Element nesting depth. */
  maxDepth: 64,
  /** Elements in the document. */
  maxNodes: 200_000,
  /** Attributes on one element. */
  maxAttributes: 256,
  /** Characters in an element or attribute name. */
  maxNameChars: 256,
});
export type XMLLimits = {readonly [K in keyof typeof XML_LIMITS]?: number};

export interface XMLElement {
  name: string;
  attributes: {[name: string]: string};
  children: XMLElement[];
  /** Character data directly inside the element (entities decoded, CDATA included), concatenated. */
  text: string;
  /** 1-based position of the element's `<`. */
  line: number;
  column: number;
}

/** Thrown by `parseXML`. `code` is 'INVALID_PAYLOAD'; `line` and `column` are 1-based. */
export class XMLParseError extends EngineError {
  readonly line: number;
  readonly column: number;
  constructor(message: string, line: number, column: number) {
    super('INVALID_PAYLOAD', `XML line ${line}, column ${column}: ${message}`);
    this.line = line; this.column = column;
  }
}

const NAME = /[A-Za-z_:\u0080-￿][\w:.\-\u0080-￿]*/y;
const ENTITIES: {readonly [name: string]: string} = {lt: '<', gt: '>', amp: '&', quot: '"', apos: "'"};

/**
 * A small XML parser for robot files: elements, attributes, text, comments,
 * CDATA, the five predefined entities and numeric character references.
 *
 * It is deliberately not a full XML processor. A DOCTYPE with an internal
 * subset (where entities are declared) is refused, an undeclared entity is an
 * error, and nothing is ever expanded or fetched, so entity-expansion and
 * external-entity attacks cannot work. A bare `<!DOCTYPE name>` and processing
 * instructions are skipped. Namespaces are not interpreted: `xacro:macro` is
 * just a name. Errors are `XMLParseError` with the line and column.
 */
export function parseXML(text: string, limits: XMLLimits = {}): XMLElement {
  if (typeof text !== 'string') bad('XML must be a string.');
  const max = {...XML_LIMITS, ...limits}, n = text.length;
  const where = (at: number): [number, number] => {
    let line = 1, start = 0;
    for (let i = text.indexOf('\n'); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) { line++; start = i + 1; }
    return [line, at - start + 1];
  };
  const fail = (message: string, at: number): never => { const [line, column] = where(Math.min(at, n)); throw new XMLParseError(message, line, column); };
  if (n > max.maxChars) throw new XMLParseError(`the document is ${n} characters; the limit is ${max.maxChars}`, 1, 1);
  // Element positions only move forward, so one running line counter serves them all.
  let line = 1, lineStart = 0, scanned = 0;
  const mark = (at: number): [number, number] => {
    for (let i = text.indexOf('\n', scanned); i >= 0 && i < at; i = text.indexOf('\n', i + 1)) { line++; lineStart = i + 1; }
    scanned = at;
    return [line, at - lineStart + 1];
  };
  const decode = (raw: string, at: number): string => {
    let amp = raw.indexOf('&');
    if (amp < 0) return raw;
    let out = '', from = 0;
    for (; amp >= 0; amp = raw.indexOf('&', from)) {
      const end = raw.indexOf(';', amp);
      if (end < 0 || end - amp > 12) fail('"&" must start an entity reference such as &amp; or &#38;', at + amp);
      const name = raw.slice(amp + 1, end);
      let value: string | undefined;
      if (name[0] === '#') {
        const hex = name[1] === 'x', digits = name.slice(hex ? 2 : 1);
        if (!(hex ? /^[0-9A-Fa-f]{1,6}$/ : /^[0-9]{1,7}$/).test(digits)) fail(`malformed character reference &${name};`, at + amp);
        const code = parseInt(digits, hex ? 16 : 10);
        const legal = code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xD7FF) || (code >= 0xE000 && code <= 0xFFFD) || (code >= 0x10000 && code <= 0x10FFFF);
        if (!legal) fail(`character reference &${name}; is not a legal XML character`, at + amp);
        value = String.fromCodePoint(code);
      } else if (Object.hasOwn(ENTITIES, name)) value = ENTITIES[name];
      else fail(`undefined entity &${name}; (only &lt; &gt; &amp; &quot; &apos; and numeric references are supported; entities are never expanded)`, at + amp);
      out += raw.slice(from, amp) + value;
      from = end + 1;
    }
    return out + raw.slice(from);
  };
  const readName = (at: number): string => {
    NAME.lastIndex = at;
    const found = NAME.exec(text);
    if (!found) return '';
    if (found[0].length > max.maxNameChars) fail(`a name is longer than ${max.maxNameChars} characters`, at);
    return found[0];
  };
  const skipSpace = (at: number): number => { while (at < n) { const c = text.charCodeAt(at); if (c !== 32 && c !== 9 && c !== 10 && c !== 13) break; at++; } return at; };

  const stack: XMLElement[] = [];
  let root: XMLElement | null = null, nodes = 0, pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  while (pos < n) {
    const lt = text.indexOf('<', pos), stop = lt < 0 ? n : lt;
    if (stop > pos) {
      const chunk = text.slice(pos, stop), top = stack[stack.length - 1];
      if (top) top.text += decode(chunk, pos);
      else { const ink = chunk.search(/\S/); if (ink >= 0) fail(root ? 'text after the root element' : 'text before the root element', pos + ink); }
    }
    if (lt < 0) break;
    pos = lt;
    if (text.startsWith('<!--', pos)) {
      const end = text.indexOf('-->', pos + 4);
      if (end < 0) fail('unterminated comment', pos);
      pos = end + 3; continue;
    }
    if (text.startsWith('<![CDATA[', pos)) {
      const top = stack[stack.length - 1], end = text.indexOf(']]>', pos + 9);
      if (!top) fail('CDATA outside the root element', pos);
      if (end < 0) fail('unterminated CDATA section', pos);
      top!.text += text.slice(pos + 9, end);
      pos = end + 3; continue;
    }
    if (text.startsWith('<?', pos)) {
      const end = text.indexOf('?>', pos + 2);
      if (end < 0) fail('unterminated processing instruction', pos);
      pos = end + 2; continue;
    }
    if (text.startsWith('<!DOCTYPE', pos)) {
      if (root) fail('DOCTYPE after the root element', pos);
      const close = text.indexOf('>', pos), subset = text.indexOf('[', pos);
      if (close < 0) fail('unterminated DOCTYPE', pos);
      if (subset >= 0 && subset < close) fail('a DOCTYPE with an internal subset (entity declarations) is refused: this parser never declares or expands entities', pos);
      pos = close + 1; continue;
    }
    if (text.startsWith('<!', pos)) fail('unsupported markup declaration', pos);
    if (text.charCodeAt(pos + 1) === 47) {   // </name>
      const name = readName(pos + 2), top = stack.pop(), end = skipSpace(pos + 2 + name.length);
      if (!name) fail('expected an element name after "</"', pos);
      if (!top) fail(`closing tag </${name}> has no opening tag`, pos);
      if (top!.name !== name) fail(`closing tag </${name}> does not match <${top!.name}> opened at line ${top!.line}, column ${top!.column}`, pos);
      if (text.charCodeAt(end) !== 62) fail(`expected ">" to end </${name}>`, end);
      pos = end + 1; continue;
    }
    if (root && stack.length === 0) fail('more than one root element', pos);
    const name = readName(pos + 1);
    if (!name) fail('expected an element name after "<"', pos);
    if (++nodes > max.maxNodes) fail(`the document has more than ${max.maxNodes} elements`, pos);
    if (stack.length >= max.maxDepth) fail(`elements are nested deeper than ${max.maxDepth} levels`, pos);
    const [atLine, atColumn] = mark(pos);
    const element: XMLElement = {name, attributes: {}, children: [], text: '', line: atLine, column: atColumn};
    let at = pos + 1 + name.length, count = 0, open = true;
    for (;;) {
      const before = at;
      at = skipSpace(at);
      if (at >= n) fail(`unclosed tag <${name}>: the document ends inside it`, pos);
      const c = text.charCodeAt(at);
      if (c === 62) { at++; break; }
      if (c === 47) { if (text.charCodeAt(at + 1) !== 62) fail('expected ">" after "/"', at); at += 2; open = false; break; }
      if (at === before) fail(`unexpected character ${JSON.stringify(text[at])} in tag <${name}>`, at);
      const key = readName(at);
      if (!key) fail(`unexpected character ${JSON.stringify(text[at])} in tag <${name}>`, at);
      if (key === '__proto__') fail('the attribute name "__proto__" is not allowed', at);
      if (Object.hasOwn(element.attributes, key)) fail(`duplicate attribute "${key}" on <${name}>`, at);
      if (++count > max.maxAttributes) fail(`<${name}> has more than ${max.maxAttributes} attributes`, at);
      let v = skipSpace(at + key.length);
      if (text.charCodeAt(v) !== 61) fail(`attribute "${key}" needs a value: expected "="`, v);
      v = skipSpace(v + 1);
      const quote = text[v];
      if (quote !== '"' && quote !== "'") fail(`the value of attribute "${key}" must be quoted`, v);
      const end = text.indexOf(quote!, v + 1);
      if (end < 0) fail(`unterminated value of attribute "${key}"`, v);
      const raw = text.slice(v + 1, end), angle = raw.indexOf('<');
      if (angle >= 0) fail(`"<" is not allowed in the value of attribute "${key}"`, v + 1 + angle);
      element.attributes[key] = decode(raw, v + 1);
      at = end + 1;
    }
    const parent = stack[stack.length - 1];
    if (parent) parent.children.push(element); else root = element;
    if (open) stack.push(element);
    pos = at;
  }
  const open = stack[stack.length - 1];
  if (open) throw new XMLParseError(`unclosed tag <${open.name}>: the document ends before </${open.name}>`, open.line, open.column);
  if (!root) fail('the document has no root element', n);
  return root!;
}

// ---------------------------------------------------------------------------
// Small vector, quaternion and inertia helpers
// ---------------------------------------------------------------------------

const zero = (v: number): number => v === 0 ? 0 : v;   // -0 -> 0
/** An option given by name: own properties only, so a joint called "constructor" finds nothing. */
const named = <T>(map: {readonly [name: string]: T} | undefined, name: string): T | undefined => map !== undefined && Object.hasOwn(map, name) ? map[name] : undefined;
const add = (a: readonly number[], b: readonly number[]): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: readonly number[], b: readonly number[]): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: readonly number[], s: number): V3 => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a: readonly number[], b: readonly number[]): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const qmul = (a: readonly number[], b: readonly number[]): Q4 => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qconj = (q: readonly number[]): Q4 => [-q[0], -q[1], -q[2], q[3]];
const qunit = (q: readonly number[]): Q4 => { const k = 1 / Math.hypot(q[0], q[1], q[2], q[3]); return [q[0] * k, q[1] * k, q[2] * k, q[3] * k]; };
function qrot(q: readonly number[], v: readonly number[]): V3 {
  const t = scale(cross(q, v), 2), u = cross(q, t);
  return [v[0] + q[3] * t[0] + u[0], v[1] + q[3] * t[1] + u[1], v[2] + q[3] * t[2] + u[2]];
}
function axisAngle(axis: readonly number[], angle: number): Q4 {
  const length = Math.hypot(axis[0], axis[1], axis[2]), s = Math.sin(angle / 2) / (length || 1);
  return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)];
}
/** Rotation that turns `from` (+z or +x) onto `axis`: the same rule as the kit's axisRotation(). */
function aim(axis: readonly number[], from: 'x' | 'z'): Q4 {
  const length = Math.hypot(axis[0], axis[1], axis[2]), x = axis[0] / length, y = axis[1] / length, z = axis[2] / length;
  const f: V3 = from === 'x' ? [1, 0, 0] : [0, 0, 1], d = f[0] * x + f[1] * y + f[2] * z;
  if (d < -0.999999) return from === 'x' ? [0, 1, 0, 0] : [1, 0, 0, 0];
  const c = cross(f, [x, y, z]), w = 1 + d, k = 1 / Math.hypot(c[0], c[1], c[2], w);
  return [c[0] * k, c[1] * k, c[2] * k, w * k];
}
function qmat(q: readonly number[]): M3 {
  const [x, y, z, w] = q;
  return [1 - 2 * (y * y + z * z), 2 * (x * y - w * z), 2 * (x * z + w * y), 2 * (x * y + w * z), 1 - 2 * (x * x + z * z), 2 * (y * z - w * x), 2 * (x * z - w * y), 2 * (y * z + w * x), 1 - 2 * (x * x + y * y)];
}
const mmul = (a: readonly number[], b: readonly number[]): M3 => {
  const out = new Array(9).fill(0) as M3;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
  return out;
};
const mT = (a: readonly number[]): M3 => [a[0], a[3], a[6], a[1], a[4], a[7], a[2], a[5], a[8]];
const mv = (a: readonly number[], v: readonly number[]): V3 => [a[0] * v[0] + a[1] * v[1] + a[2] * v[2], a[3] * v[0] + a[4] * v[1] + a[5] * v[2], a[6] * v[0] + a[7] * v[1] + a[8] * v[2]];
/** R I R^T: a tensor given in a frame, expressed in the frame's parent. */
const rotateTensor = (q: readonly number[], tensor: readonly number[]): M3 => { const r = qmat(q); return mmul(mmul(r, tensor), mT(r)); };
/** m (|d|^2 1 - d d^T): what the parallel-axis theorem adds. */
const steiner = (m: number, d: readonly number[]): M3 => {
  const s = dot(d, d);
  return [m * (s - d[0] * d[0]), -m * d[0] * d[1], -m * d[0] * d[2], -m * d[0] * d[1], m * (s - d[1] * d[1]), -m * d[1] * d[2], -m * d[0] * d[2], -m * d[1] * d[2], m * (s - d[2] * d[2])];
};
const madd = (a: readonly number[], b: readonly number[]): M3 => a.map((v, i) => v + b[i]) as M3;
const mscale = (a: readonly number[], s: number): M3 => a.map(v => v * s) as M3;
function minv(a: readonly number[]): M3 {
  const c: M3 = [a[4] * a[8] - a[5] * a[7], a[2] * a[7] - a[1] * a[8], a[1] * a[5] - a[2] * a[4], a[5] * a[6] - a[3] * a[8], a[0] * a[8] - a[2] * a[6], a[2] * a[3] - a[0] * a[5],
    a[3] * a[7] - a[4] * a[6], a[1] * a[6] - a[0] * a[7], a[0] * a[4] - a[1] * a[3]];
  const det = a[0] * c[0] + a[1] * c[3] + a[2] * c[6];
  return det === 0 ? [0, 0, 0, 0, 0, 0, 0, 0, 0] : mscale(c, 1 / det);
}

/** Eigenvalues (ascending) and unit eigenvectors (the columns of `vectors`, a right-handed set) of a symmetric 3 x 3 matrix, by Jacobi rotations. */
function eigenSymmetric(matrix: readonly number[]): {values: V3; vectors: M3} {
  const a = [...matrix], v: number[] = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  for (let sweep = 0; sweep < 64; sweep++) {
    const off = Math.abs(a[1]) + Math.abs(a[2]) + Math.abs(a[5]);
    if (off <= 1e-18 * (Math.abs(a[0]) + Math.abs(a[4]) + Math.abs(a[8]))) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p * 3 + q];
      if (apq === 0) continue;
      const theta = (a[q * 3 + q] - a[p * 3 + p]) / (2 * apq), t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const kp = a[k * 3 + p], kq = a[k * 3 + q]; a[k * 3 + p] = c * kp - s * kq; a[k * 3 + q] = s * kp + c * kq; }
      for (let k = 0; k < 3; k++) { const pk = a[p * 3 + k], qk = a[q * 3 + k]; a[p * 3 + k] = c * pk - s * qk; a[q * 3 + k] = s * pk + c * qk; }
      for (let k = 0; k < 3; k++) { const kp = v[k * 3 + p], kq = v[k * 3 + q]; v[k * 3 + p] = c * kp - s * kq; v[k * 3 + q] = s * kp + c * kq; }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[i * 4] - a[j * 4]);
  const columns = order.map(i => [v[i], v[3 + i], v[6 + i]] as V3);
  if (dot(cross(columns[0], columns[1]), columns[2]) < 0) columns[2] = scale(columns[2], -1);
  return {values: [a[order[0] * 4], a[order[1] * 4], a[order[2] * 4]], vectors: [columns[0][0], columns[1][0], columns[2][0], columns[0][1], columns[1][1], columns[2][1], columns[0][2], columns[1][2], columns[2][2]]};
}
/** Unit quaternion of a rotation matrix. */
function quatOfMatrix(m: readonly number[]): Q4 {
  const trace = m[0] + m[4] + m[8];
  let q: Q4;
  if (trace > 0) { const s = 0.5 / Math.sqrt(trace + 1); q = [(m[7] - m[5]) * s, (m[2] - m[6]) * s, (m[3] - m[1]) * s, 0.25 / s]; }
  else if (m[0] > m[4] && m[0] > m[8]) { const s = 2 * Math.sqrt(1 + m[0] - m[4] - m[8]); q = [0.25 * s, (m[1] + m[3]) / s, (m[2] + m[6]) / s, (m[7] - m[5]) / s]; }
  else if (m[4] > m[8]) { const s = 2 * Math.sqrt(1 + m[4] - m[0] - m[8]); q = [(m[1] + m[3]) / s, 0.25 * s, (m[5] + m[7]) / s, (m[2] - m[6]) / s]; }
  else { const s = 2 * Math.sqrt(1 + m[8] - m[0] - m[4]); q = [(m[2] + m[6]) / s, (m[5] + m[7]) / s, 0.25 * s, (m[3] - m[1]) / s]; }
  return qunit(q);
}

/** Volume, centroid and inertia about the centroid (unit density) of a closed, outward-wound triangle mesh. */
function polyhedronMass(vertices: ArrayLike<number>, indices: ArrayLike<number>): {volume: number; centroid: V3; inertia: M3} {
  let six = 0;
  const first: V3 = [0, 0, 0], second = new Array(9).fill(0) as M3;
  for (let t = 0; t < indices.length; t += 3) {
    const p = [0, 1, 2].map(k => { const i = indices[t + k] * 3; return [vertices[i], vertices[i + 1], vertices[i + 2]] as V3; });
    const det = dot(p[0], cross(p[1], p[2])), sum = add(add(p[0], p[1]), p[2]);
    six += det;
    for (let i = 0; i < 3; i++) {
      first[i] += det * sum[i];
      for (let j = 0; j < 3; j++) second[i * 3 + j] += det * (p[0][i] * p[0][j] + p[1][i] * p[1][j] + p[2][i] * p[2][j] + sum[i] * sum[j]);
    }
  }
  const volume = six / 6, centroid = scale(first, 1 / (4 * six));
  // second / 120 is the integral of x x^T; move it to the centroid, then I = trace(C) 1 - C.
  const c = second.map((value, k) => value / 120 - volume * centroid[Math.floor(k / 3)] * centroid[k % 3]), trace = c[0] + c[4] + c[8];
  return {volume, centroid, inertia: [trace - c[0], -c[1], -c[2], -c[3], trace - c[4], -c[5], -c[6], -c[7], trace - c[8]]};
}

// ---------------------------------------------------------------------------
// The neutral robot description
// ---------------------------------------------------------------------------

/** Hard caps on a robot description. */
export const ROBOT_LIMITS = Object.freeze({
  links: 4096,
  joints: 4096,
  /** Collision shapes on one link. */
  collisionsPerLink: 64,
  /** Hull points kept for one mesh (Box3D keeps at most 64; 32 is the geometry module's default). */
  meshHullPoints: 32,
});

/** A position and a unit quaternion [x, y, z, w]. */
export interface RobotPose { xyz: [number, number, number]; quat: [number, number, number, number] }

/** A collision shape, in the file's terms. Cylinders, capsules and ellipsoids have their axis along the shape's local z. */
export type RobotGeometry =
  | {type: 'box'; size: [number, number, number]}
  | {type: 'sphere'; radius: number}
  | {type: 'cylinder'; radius: number; length: number}
  /** `length` is the distance between the cap centres. */
  | {type: 'capsule'; radius: number; length: number}
  | {type: 'ellipsoid'; radii: [number, number, number]}
  /** The convex hull of the mesh file, scale applied: flat [x, y, z, ...] hull vertices in the shape's frame. */
  | {type: 'mesh'; filename: string; scale: [number, number, number]; points: number[]}
  /** A mesh whose file was not supplied (`missingMeshes: 'box'`); replaced by a box when the scene is built. */
  | {type: 'missing-mesh'; filename: string; scale: [number, number, number]}
  /** An infinite ground plane through the origin with normal +z (MJCF only, on the world). */
  | {type: 'plane'};

export interface RobotCollision {
  name?: string;
  /** Pose of the shape in the link frame. */
  origin: RobotPose;
  geometry: RobotGeometry;
  /** kg. Set when the file gives mass per shape (MJCF geoms on a body without <inertial>). */
  mass?: number;
  friction?: number;
  /** 0xRRGGBB. */
  color?: number;
}

export interface RobotInertial {
  /** kg. */
  mass: number;
  /** Centre of mass and the frame the tensor is written in, in the link frame. */
  origin: RobotPose;
  /** [ixx, ixy, ixz, iyy, iyz, izz] about the centre of mass, kg m^2. */
  inertia: [number, number, number, number, number, number];
  /** True when the file gave no inertial and this one was computed from the collision shapes (MJCF). */
  derived?: boolean;
}

export interface RobotLink {
  name: string;
  inertial?: RobotInertial;
  collisions: RobotCollision[];
  /** 0xRRGGBB, from the first visual with a colour. */
  color?: number;
  /** True for the MJCF world body: its shapes are static scenery and joints to it are joints to the world. */
  isWorld?: boolean;
}

export type RobotJointType = 'fixed' | 'revolute' | 'continuous' | 'prismatic' | 'spherical' | 'floating' | 'planar';

export interface RobotJoint {
  name: string;
  type: RobotJointType;
  parent: string;
  child: string;
  /** Pose of the child link frame in the parent link frame when the joint is at its reference position. */
  origin: RobotPose;
  /** A point on the joint axis (the pivot of a ball joint) in the child link frame. URDF: the child origin. */
  anchor: [number, number, number];
  /** Unit joint axis in the child link frame. */
  axis: [number, number, number];
  /** rad or m. Absent: unlimited. */
  limits?: {lower: number; upper: number};
  /** Largest actuator torque (N m) or force (N). */
  effort?: number;
  /** Largest joint speed, rad/s or m/s. Recorded; the engine has no joint speed limit. */
  velocity?: number;
  /** Viscous damping, N m s/rad or N s/m. */
  damping?: number;
  /** Dry (Coulomb) friction, N m or N. */
  friction?: number;
  /** Spring stiffness, N m/rad or N/m, pulling towards `springRef`. */
  stiffness?: number;
  springRef?: number;
  /** Joint value at the pose the file describes (MJCF `ref`). Limits and targets are given in the file's values. */
  ref?: number;
  /** Rotor inertia (MJCF). Recorded; not modelled. */
  armature?: number;
  /** A position servo from the file (MJCF <position>): a spring of stiffness kp towards 0, with damping kv. */
  servo?: {kp: number; kv: number};
  /** False for joint types the engine cannot represent (planar): the child is left free and a warning says so. */
  supported: boolean;
}

/** `unsupported`: dropped. `approximated`: represented by something close. `ignored`: has no effect on the physics here. `note`: worth knowing. */
export interface RobotWarning {
  code: 'unsupported' | 'approximated' | 'ignored' | 'note';
  /** What the warning is about, e.g. `joint "elbow" <mimic>`. */
  element: string;
  message: string;
  /** Position in the file, when the warning comes from one element. */
  line?: number;
  column?: number;
}

export interface RobotDescription {
  name: string;
  source: 'urdf' | 'mjcf';
  links: RobotLink[];
  joints: RobotJoint[];
  /** Name of the root link. */
  root: string;
  /** World settings the file gives (MJCF <option>, a ground plane), in the file's axes. */
  world: {gravity?: [number, number, number]; timestep?: number; ground?: boolean};
  /** Everything the import ignored, approximated or could not represent. Never empty silently. */
  warnings: RobotWarning[];
}

export type RobotMeshData = BinaryLike | string;
export interface RobotParseOptions {
  /**
   * Mesh files by name: bytes (STL, GLB, glTF, OBJ) or text (OBJ, glTF). A name in the robot file is
   * matched after normalisation (see `normalizeMeshPath`): exactly, or by whole trailing path segments.
   */
  readonly meshes?: Readonly<Record<string, RobotMeshData>> | ReadonlyMap<string, RobotMeshData>;
  /** 'error' (default): a mesh that is not in `meshes` throws, naming the file. 'box': a box takes its place, with a warning. */
  readonly missingMeshes?: 'error' | 'box';
  /** Throw on the first warning instead of collecting it. */
  readonly strict?: boolean;
}

/**
 * How mesh names are compared: backslashes become '/', a URI scheme
 * (`package://`, `file://`, `model://`) is removed, and empty, '.' and '..'
 * segments are resolved. `package://arm/meshes/hand.stl` -> `arm/meshes/hand.stl`.
 */
export function normalizeMeshPath(name: string): string {
  const parts: string[] = [];
  for (const segment of name.trim().replace(/\\/g, '/').replace(/^[A-Za-z][A-Za-z0-9+.-]*:\/\//, '').split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment === '..') parts.pop(); else parts.push(segment);
  }
  return parts.join('/');
}

const IDENTITY: Q4 = [0, 0, 0, 1];
const pose = (xyz: readonly number[] = [0, 0, 0], quat: readonly number[] = IDENTITY): RobotPose => ({xyz: [xyz[0], xyz[1], xyz[2]], quat: [quat[0], quat[1], quat[2], quat[3]]});
const compose = (a: RobotPose, b: RobotPose): RobotPose => ({xyz: add(a.xyz, qrot(a.quat, b.xyz)), quat: qunit(qmul(a.quat, b.quat))});
const invert = (a: RobotPose): RobotPose => { const q = qconj(a.quat); return {xyz: scale(qrot(q, a.xyz), -1), quat: q}; };

/** Shared by both parsers: numbers with positions, warnings, meshes. */
class Reader {
  readonly warnings: RobotWarning[] = [];
  private readonly meshKeys: {key: string; normal: string}[] = [];
  private readonly meshCache = new Map<string, number[]>();
  readonly what: string;
  readonly options: RobotParseOptions;
  constructor(what: string, options: RobotParseOptions) {
    this.what = what; this.options = options;
    const meshes = options.meshes;
    const keys = !meshes ? [] : meshes instanceof Map ? [...meshes.keys()] : Object.keys(meshes);
    for (const key of keys) this.meshKeys.push({key, normal: normalizeMeshPath(key)});
  }
  fail(element: XMLElement, message: string): never {
    throw new EngineError('INVALID_PAYLOAD', `${this.what} line ${element.line}, column ${element.column}: <${element.name}> ${message}`);
  }
  warn(code: RobotWarning['code'], what: string, message: string, element?: XMLElement): void {
    if (this.options.strict) throw new EngineError('INVALID_PAYLOAD', `${this.what}${element ? ` line ${element.line}, column ${element.column}` : ''}: ${what}: ${message} (strict mode)`);
    this.warnings.push(element ? {code, element: what, message, line: element.line, column: element.column} : {code, element: what, message});
  }
  numbers(element: XMLElement, attributes: {readonly [name: string]: string}, key: string, count: number | [number, number], fallback?: readonly number[]): number[] {
    const text = attributes[key];
    if (text === undefined) { if (fallback) return [...fallback]; this.fail(element, `needs the attribute "${key}"`); }
    const parts = text!.trim().split(/\s+/).filter(part => part !== ''), [low, high] = typeof count === 'number' ? [count, count] : count;
    if (parts.length < low || parts.length > high) this.fail(element, `${key}="${text}" must hold ${low === high ? low : `${low} to ${high}`} number${high === 1 ? '' : 's'}, got ${parts.length}`);
    return parts.map(part => {
      const value = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(part) ? Number(part) : NaN;
      if (!Number.isFinite(value)) this.fail(element, `${key}="${text}": ${JSON.stringify(part)} is not a finite number`);
      return value;
    });
  }
  number(element: XMLElement, attributes: {readonly [name: string]: string}, key: string, fallback?: number): number {
    return this.numbers(element, attributes, key, 1, fallback === undefined ? undefined : [fallback])[0];
  }
  /** Hull points of a mesh file, scaled. Returns null when the file is missing and `missingMeshes` is 'box'. */
  mesh(element: XMLElement, filename: string, meshScale: readonly number[], owner: string): number[] | null {
    const wanted = normalizeMeshPath(filename);
    let found = this.meshKeys.filter(entry => entry.key === filename);
    if (found.length === 0) found = this.meshKeys.filter(entry => entry.normal === wanted);
    if (found.length === 0) {
      const tails = this.meshKeys.filter(entry => entry.normal !== '' && (wanted.endsWith('/' + entry.normal) || entry.normal.endsWith('/' + wanted)));
      const longest = Math.max(0, ...tails.map(entry => Math.min(entry.normal.length, wanted.length)));
      found = tails.filter(entry => Math.min(entry.normal.length, wanted.length) === longest);
      if (found.length > 1) this.fail(element, `mesh "${filename}" matches more than one supplied file: ${found.map(entry => `"${entry.key}"`).join(', ')}`);
    }
    if (found.length === 0) {
      if (this.options.missingMeshes === 'box') {
        this.warn('approximated', `${owner} mesh "${filename}"`, 'the mesh file was not supplied; a box takes its place (the solid box with the link\'s mass and inertia tensor, or a 0.1 m cube times the mesh scale when the link has no usable inertial)', element);
        return null;
      }
      this.fail(element, `mesh "${filename}" was not supplied: add it to the meshes option (looked for "${wanted}"), or pass missingMeshes: 'box'`);
    }
    const key = found[0].key, cacheKey = `${key}\n${meshScale.join(' ')}`;
    const cached = this.meshCache.get(cacheKey);
    if (cached) return cached;
    const meshes = this.options.meshes!, data = (meshes instanceof Map ? meshes.get(key) : (meshes as Readonly<Record<string, RobotMeshData>>)[key]) as RobotMeshData;
    const extension = /\.([A-Za-z0-9]+)$/.exec(key)?.[1]?.toLowerCase() ?? '';
    let points: number[];
    try {
      const textOf = (): string => typeof data === 'string' ? data : new TextDecoder().decode(data);
      let parsed: TriangleMesh[];
      if (extension === 'obj') parsed = parseOBJ(textOf());
      else if (extension === 'stl') parsed = [parseSTL(data)];
      else if (extension === 'glb') parsed = typeof data === 'string' ? bad('a .glb file must be given as bytes.') : parseGLB(data, meshes as Readonly<Record<string, BinaryLike>>);
      else if (extension === 'gltf') parsed = parseGLTF(textOf(), meshes as Readonly<Record<string, BinaryLike>>);
      else bad(`".${extension}" files are not supported; convert the mesh to OBJ, STL or GLB.`);
      const all: number[] = [];
      for (const one of parsed) for (let i = 0; i < one.vertices.length; i++) all.push(one.vertices[i] * meshScale[i % 3]);
      points = Array.from(toHullShape(all, {maxPoints: ROBOT_LIMITS.meshHullPoints}).points);
    } catch (error) {
      this.fail(element, `mesh "${filename}": ${error instanceof Error ? error.message : String(error)}`);
    }
    this.meshCache.set(cacheKey, points!);
    this.warn('approximated', `${owner} mesh "${filename}"`, `the mesh is represented by its convex hull (${points!.length / 3} points); concave detail does not collide and mass is spread over the hull`, element);
    return points!;
  }
}

const rgb = (rgba: readonly number[]): number => {
  const byte = (v: number): number => Math.max(0, Math.min(255, Math.round(v * 255)));
  return (byte(rgba[0]) << 16) | (byte(rgba[1]) << 8) | byte(rgba[2]);
};

/** The tree of a description: parent joint and child joints of every link, and the links in an order that visits parents first. Throws on a broken tree. */
export function robotTree(description: Pick<RobotDescription, 'links' | 'joints' | 'root'>): {order: string[]; parentJoint: Map<string, RobotJoint>; childJoints: Map<string, RobotJoint[]>} {
  const links = new Map(description.links.map(link => [link.name, link])), parentJoint = new Map<string, RobotJoint>(), childJoints = new Map<string, RobotJoint[]>();
  if (links.size !== description.links.length) bad('robot: two links share a name.');
  for (const link of description.links) childJoints.set(link.name, []);
  const names = new Set<string>();
  for (const joint of description.joints) {
    if (names.has(joint.name)) bad(`robot: two joints are named "${joint.name}".`);
    names.add(joint.name);
    if (!links.has(joint.parent)) bad(`robot: joint "${joint.name}" names the parent link "${joint.parent}", which does not exist.`);
    if (!links.has(joint.child)) bad(`robot: joint "${joint.name}" names the child link "${joint.child}", which does not exist.`);
    if (joint.parent === joint.child) bad(`robot: joint "${joint.name}" connects link "${joint.child}" to itself.`);
    const other = parentJoint.get(joint.child);
    if (other) bad(`robot: link "${joint.child}" is the child of two joints, "${other.name}" and "${joint.name}"; closed loops are not supported.`);
    parentJoint.set(joint.child, joint);
    childJoints.get(joint.parent)!.push(joint);
  }
  const roots = description.links.filter(link => !parentJoint.has(link.name)).map(link => link.name);
  if (description.links.length === 0) bad('robot: there are no links.');
  if (roots.length === 0) bad('robot: every link is the child of a joint, so the joints form a cycle and there is no root link.');
  if (roots.length > 1) bad(`robot: there must be exactly one root link, found ${roots.length}: ${roots.slice(0, 8).map(name => `"${name}"`).join(', ')}.`);
  if (description.root !== roots[0]) bad(`robot: the root link is "${roots[0]}", not "${description.root}".`);
  const order: string[] = [];
  // Depth first, children in the order their joints are written. A cycle cannot hang this: every link has at most one parent.
  for (const stack = [roots[0]]; stack.length > 0;) {
    const name = stack.pop()!;
    order.push(name);
    const children = childJoints.get(name)!;
    for (let i = children.length - 1; i >= 0; i--) stack.push(children[i].child);
  }
  if (order.length !== description.links.length) {
    const missing = description.links.filter(link => !order.includes(link.name)).map(link => `"${link.name}"`);
    bad(`robot: the joints form a cycle; these links are not reachable from the root "${roots[0]}": ${missing.slice(0, 8).join(', ')}.`);
  }
  return {order, parentJoint, childJoints};
}

function finish(reader: Reader, root: XMLElement, name: string, source: 'urdf' | 'mjcf', links: RobotLink[], joints: RobotJoint[], world: RobotDescription['world']): RobotDescription {
  if (links.length > ROBOT_LIMITS.links) reader.fail(root, `has ${links.length} links; the limit is ${ROBOT_LIMITS.links}`);
  if (joints.length > ROBOT_LIMITS.joints) reader.fail(root, `has ${joints.length} joints; the limit is ${ROBOT_LIMITS.joints}`);
  const parents = new Set(joints.map(joint => joint.child));
  const description: RobotDescription = {name, source, links, joints, root: links.find(link => !parents.has(link.name))?.name ?? '', world, warnings: reader.warnings};
  try { robotTree(description); } catch (error) {
    throw new EngineError('INVALID_PAYLOAD', `${reader.what}: ${(error as Error).message.replace(/^robot: /, '')}`);
  }
  return description;
}

// ---------------------------------------------------------------------------
// URDF
// ---------------------------------------------------------------------------

/** URDF fixed-axis roll, pitch, yaw: R = Rz(yaw) Ry(pitch) Rx(roll). */
function rpyQuat(rpy: readonly number[]): Q4 {
  return qunit(qmul(qmul(axisAngle([0, 0, 1], rpy[2]), axisAngle([0, 1, 0], rpy[1])), axisAngle([1, 0, 0], rpy[0])));
}

/**
 * Read a URDF robot.
 *
 * Read: links (inertial, collision boxes, cylinders, spheres and meshes, the
 * first visual colour), joints (fixed, revolute, continuous, prismatic,
 * floating; origin, axis, limit, dynamics) and the tree, which must have one
 * root and no loops. Visual geometry is not read. Reported in `warnings` and
 * otherwise without effect: planar joints (the child is left free), `<mimic>`,
 * `<calibration>`, `<safety_controller>`, `<transmission>`, `<gazebo>` and
 * any unknown element. Xacro must be expanded first.
 *
 * Throws `XMLParseError` for malformed XML and
 * `EngineError('INVALID_PAYLOAD')`, with the line and column, for an invalid
 * robot: a missing or dangling name, a broken tree, a bad number, a mesh that
 * was not supplied.
 */
export function parseURDF(xml: string, options: RobotParseOptions = {}): RobotDescription {
  const root = parseXML(xml), r = new Reader('URDF', options);
  if (root.name !== 'robot') r.fail(root, 'is not a URDF: the root element must be <robot>');
  const child = (element: XMLElement, name: string): XMLElement | undefined => element.children.find(one => one.name === name);
  const origin = (element: XMLElement): RobotPose => {
    const o = child(element, 'origin');
    return o ? pose(r.numbers(o, o.attributes, 'xyz', 3, [0, 0, 0]), rpyQuat(r.numbers(o, o.attributes, 'rpy', 3, [0, 0, 0]))) : pose();
  };
  const positive = (element: XMLElement, key: string): number => {
    const value = r.number(element, element.attributes, key);
    if (!(value > 0)) r.fail(element, `${key} must be greater than 0, got ${value}`);
    return value;
  };
  const materials = new Map<string, number>();
  const colorOf = (material: XMLElement | undefined): number | undefined => {
    if (!material) return undefined;
    const color = child(material, 'color');
    if (color) return rgb(r.numbers(color, color.attributes, 'rgba', [3, 4]));
    return material.attributes.name !== undefined ? materials.get(material.attributes.name) : undefined;
  };
  for (const material of root.children) if (material.name === 'material' && material.attributes.name !== undefined) {
    const color = colorOf(material);
    if (color !== undefined) materials.set(material.attributes.name, color);
  }
  const links: RobotLink[] = [], joints: RobotJoint[] = [], linkNames = new Set<string>(), jointNames = new Set<string>();
  for (const element of root.children) {
    if (element.name === 'material') continue;
    if (element.name === 'link') {
      const name = element.attributes.name;
      if (!name) r.fail(element, 'needs a name');
      if (linkNames.has(name)) r.fail(element, `duplicate link name "${name}"`);
      linkNames.add(name);
      const link: RobotLink = {name, collisions: []};
      let visuals = 0;
      for (const part of element.children) {
        if (part.name === 'inertial') {
          const mass = child(part, 'mass'), inertia = child(part, 'inertia');
          const m = mass ? r.number(mass, mass.attributes, 'value') : 0;
          if (!(m >= 0)) r.fail(mass!, `value must not be negative, got ${m}`);
          const tensor = (['ixx', 'ixy', 'ixz', 'iyy', 'iyz', 'izz'] as const).map(key => inertia ? r.number(inertia, inertia.attributes, key, 0) : 0) as RobotInertial['inertia'];
          link.inertial = {mass: m, origin: origin(part), inertia: tensor};
          if (m > 0 && tensor.every(value => value === 0)) r.warn('note', `link "${name}" <inertial>`, 'has mass but a zero inertia tensor; the body gets the inertia of its collision shapes', part);
        } else if (part.name === 'collision') {
          if (link.collisions.length >= ROBOT_LIMITS.collisionsPerLink) r.fail(part, `link "${name}" has more than ${ROBOT_LIMITS.collisionsPerLink} collision shapes`);
          const geometry = child(part, 'geometry'), shape = geometry?.children[0];
          if (!geometry || !shape) r.fail(part, `of link "${name}" needs a <geometry> with a shape`);
          let parsed: RobotGeometry;
          if (shape!.name === 'box') {
            const size = r.numbers(shape!, shape!.attributes, 'size', 3) as V3;
            if (!size.every(value => value > 0)) r.fail(shape!, `size must be positive, got "${shape!.attributes.size}"`);
            parsed = {type: 'box', size};
          } else if (shape!.name === 'sphere') parsed = {type: 'sphere', radius: positive(shape!, 'radius')};
          else if (shape!.name === 'cylinder') parsed = {type: 'cylinder', radius: positive(shape!, 'radius'), length: positive(shape!, 'length')};
          else if (shape!.name === 'capsule') parsed = {type: 'capsule', radius: positive(shape!, 'radius'), length: positive(shape!, 'length')};
          else if (shape!.name === 'mesh') {
            const filename = shape!.attributes.filename;
            if (!filename) r.fail(shape!, 'needs a filename');
            const meshScale = r.numbers(shape!, shape!.attributes, 'scale', 3, [1, 1, 1]) as V3;
            if (meshScale.some(value => value === 0)) r.fail(shape!, `scale must not be zero, got "${shape!.attributes.scale}"`);
            const points = r.mesh(shape!, filename, meshScale, `link "${name}"`);
            parsed = points ? {type: 'mesh', filename, scale: meshScale, points} : {type: 'missing-mesh', filename, scale: meshScale};
          } else r.fail(shape!, `is not a collision shape this import reads (box, cylinder, sphere, capsule, mesh)`);
          const collision: RobotCollision = {origin: origin(part), geometry: parsed!};
          if (part.attributes.name !== undefined) collision.name = part.attributes.name;
          link.collisions.push(collision);
        } else if (part.name === 'visual') {
          visuals++;
          if (link.color === undefined) { const color = colorOf(child(part, 'material')); if (color !== undefined) link.color = color; }
        } else r.warn('ignored', `link "${name}" <${part.name}>`, 'unknown element; ignored', part);
      }
      if (visuals > 0 && link.collisions.length === 0) r.warn('note', `link "${name}"`, 'has visual geometry but no collision geometry: it collides with nothing', element);
      links.push(link);
    } else if (element.name === 'joint') {
      const name = element.attributes.name, type = element.attributes.type;
      if (!name) r.fail(element, 'needs a name');
      if (jointNames.has(name)) r.fail(element, `duplicate joint name "${name}"`);
      jointNames.add(name);
      if (!['fixed', 'revolute', 'continuous', 'prismatic', 'floating', 'planar'].includes(type)) r.fail(element, `"${name}": type must be fixed, revolute, continuous, prismatic, floating or planar, got ${type === undefined ? 'nothing' : `"${type}"`}`);
      const parent = child(element, 'parent')?.attributes.link, kid = child(element, 'child')?.attributes.link;
      if (!parent) r.fail(element, `"${name}" needs <parent link="...">`);
      if (!kid) r.fail(element, `"${name}" needs <child link="...">`);
      const axisElement = child(element, 'axis');
      let axis: V3 = [1, 0, 0];
      if (axisElement) {
        const raw = r.numbers(axisElement, axisElement.attributes, 'xyz', 3), length = Math.hypot(raw[0], raw[1], raw[2]);
        if (!(length > 0)) r.fail(axisElement, `of joint "${name}" must not be the zero vector`);
        axis = scale(raw, 1 / length);
      }
      const joint: RobotJoint = {name, type: type as RobotJointType, parent: parent!, child: kid!, origin: origin(element), anchor: [0, 0, 0], axis, supported: type !== 'planar'};
      const limit = child(element, 'limit'), moving = type === 'revolute' || type === 'prismatic' || type === 'continuous';
      if (limit && moving) {
        if (type !== 'continuous') {
          const lower = r.number(limit, limit.attributes, 'lower', 0), upper = r.number(limit, limit.attributes, 'upper', 0);
          if (upper < lower) r.fail(limit, `of joint "${name}": upper (${upper}) is below lower (${lower})`);
          joint.limits = {lower, upper};
        }
        if (limit.attributes.effort !== undefined) joint.effort = Math.abs(r.number(limit, limit.attributes, 'effort'));
        if (limit.attributes.velocity !== undefined) joint.velocity = Math.abs(r.number(limit, limit.attributes, 'velocity'));
      } else if (type === 'revolute' || type === 'prismatic') r.warn('note', `joint "${name}"`, `a ${type} joint needs a <limit>; none was given, so the joint is left unlimited`, element);
      const dynamics = child(element, 'dynamics');
      if (dynamics && moving) {
        const damping = r.number(dynamics, dynamics.attributes, 'damping', 0), friction = r.number(dynamics, dynamics.attributes, 'friction', 0);
        if (damping < 0 || friction < 0) r.fail(dynamics, `of joint "${name}": damping and friction must not be negative`);
        if (damping > 0) joint.damping = damping;
        if (friction > 0) joint.friction = friction;
      }
      for (const part of element.children) {
        if (['origin', 'parent', 'child', 'axis', 'limit', 'dynamics'].includes(part.name)) continue;
        if (part.name === 'mimic') r.warn('unsupported', `joint "${name}" <mimic>`, `mimic joints are not supported: "${name}" moves independently of "${part.attributes.joint ?? '?'}"`, part);
        else if (part.name === 'calibration' || part.name === 'safety_controller') r.warn('ignored', `joint "${name}" <${part.name}>`, 'not used by the simulation; ignored', part);
        else r.warn('ignored', `joint "${name}" <${part.name}>`, 'unknown element; ignored', part);
      }
      if (type === 'planar') r.warn('unsupported', `joint "${name}"`, `planar joints are not supported: link "${kid}" is left free (6 degrees of freedom instead of 3)`, element);
      joints.push(joint);
    } else if (element.name === 'transmission' || element.name === 'gazebo') {
      r.warn('ignored', `<${element.name}>${element.attributes.name ? ` "${element.attributes.name}"` : element.attributes.reference ? ` for "${element.attributes.reference}"` : ''}`, 'simulator-specific element; ignored', element);
    } else r.warn('ignored', `<${element.name}>`, 'unknown element; ignored', element);
  }
  if (links.length === 0) r.fail(root, 'has no <link>');
  return finish(r, root, root.attributes.name ?? 'robot', 'urdf', links, joints, {});
}

// ---------------------------------------------------------------------------
// Mass properties of the shapes a file can name
// ---------------------------------------------------------------------------

interface SolidMass { volume: number; centre: V3; /** About `centre`, unit density, in the shape's frame. */ inertia: M3 }
const diagonal = (x: number, y: number, z: number): M3 => [x, 0, 0, 0, y, 0, 0, 0, z];

/** Unit-density inertia of a capsule whose axis is `axis` (0 x, 1 y, 2 z): Box3D's own formula. */
function capsuleMass(radius: number, length: number, axis: 0 | 1 | 2): SolidMass {
  const cylinder = Math.PI * radius * radius * length, sphere = 4 / 3 * Math.PI * radius ** 3;
  const along = cylinder * radius * radius / 2 + sphere * 0.4 * radius * radius;
  const across = cylinder * (3 * radius * radius + length * length) / 12 + sphere * 0.4 * radius * radius + 0.125 * sphere * (3 * radius + 2 * length) * length;
  const moments: V3 = [across, across, across];
  moments[axis] = along;
  return {volume: cylinder + sphere, centre: [0, 0, 0], inertia: diagonal(...moments)};
}

/** The exact solid the file describes (a mesh: its convex hull). */
function solidMass(geometry: RobotGeometry): SolidMass {
  switch (geometry.type) {
    case 'box': { const [x, y, z] = geometry.size, v = x * y * z; return {volume: v, centre: [0, 0, 0], inertia: diagonal(v * (y * y + z * z) / 12, v * (x * x + z * z) / 12, v * (x * x + y * y) / 12)}; }
    case 'sphere': { const v = 4 / 3 * Math.PI * geometry.radius ** 3, i = 0.4 * v * geometry.radius ** 2; return {volume: v, centre: [0, 0, 0], inertia: diagonal(i, i, i)}; }
    case 'cylinder': {
      const {radius, length} = geometry, v = Math.PI * radius * radius * length, across = v * (3 * radius * radius + length * length) / 12;
      return {volume: v, centre: [0, 0, 0], inertia: diagonal(across, across, v * radius * radius / 2)};
    }
    case 'capsule': return capsuleMass(geometry.radius, geometry.length, 2);
    case 'ellipsoid': { const [a, b, c] = geometry.radii, v = 4 / 3 * Math.PI * a * b * c; return {volume: v, centre: [0, 0, 0], inertia: diagonal(v * (b * b + c * c) / 5, v * (a * a + c * c) / 5, v * (a * a + b * b) / 5)}; }
    case 'mesh': { const hull = convexHull(geometry.points), m = polyhedronMass(hull.vertices, hull.indices); return {volume: m.volume, centre: m.centroid, inertia: m.inertia}; }
    default: return {volume: 0, centre: [0, 0, 0], inertia: diagonal(0, 0, 0)};
  }
}

const tensorOf = (i: readonly number[]): M3 => [i[0], i[1], i[2], i[1], i[3], i[4], i[2], i[4], i[5]];

// ---------------------------------------------------------------------------
// MJCF
// ---------------------------------------------------------------------------

/**
 * Read a MuJoCo MJCF model: the common subset.
 *
 * Read: `<compiler>` (angle, eulerseq, meshdir, autolimits, inertiafromgeom),
 * `<option>` (gravity, timestep), nested `<default>` classes with `class` and
 * `childclass`, `<asset>` meshes and material colours, the `<worldbody>` tree
 * (body pose by pos with quat, euler, axisangle, xyaxes or zaxis; `<inertial>`;
 * `<geom>` box, sphere, capsule, cylinder, ellipsoid and mesh, by size or
 * `fromto`, and a plane on the world; `<joint>` hinge, slide, ball and free with
 * axis, range, damping, stiffness, springref, ref and frictionloss) and
 * `<actuator>` motor, position and velocity on a joint. A body without
 * `<inertial>` gets its mass and inertia from its geoms, as MuJoCo does.
 *
 * The world body becomes the root link "world"; a body without a joint is
 * fixed to its parent. Everything else is reported in `warnings` with the
 * element named, and has no effect: `<equality>`, `<tendon>`, `<contact>`
 * pairs and exclusions between bodies that are not joined, `<include>`,
 * composites, height fields, armature, solver settings, and any attribute this
 * import does not use. A body with several joints keeps one (three hinges at a
 * point become a ball joint). Sites, cameras, lights and visual settings are
 * skipped without a warning: they do not change the motion.
 */
export function parseMJCF(xml: string, options: RobotParseOptions = {}): RobotDescription {
  const root = parseXML(xml), r = new Reader('MJCF', options);
  if (root.name !== 'mujoco') r.fail(root, 'is not an MJCF model: the root element must be <mujoco>');
  type Attributes = {readonly [name: string]: string};
  const leftover = (element: XMLElement, attributes: Attributes, known: readonly string[], what: string): void => {
    const extra = Object.keys(attributes).filter(key => !known.includes(key));
    if (extra.length > 0) r.warn('ignored', what, `attribute${extra.length === 1 ? '' : 's'} not used by this import: ${extra.join(', ')}`, element);
  };

  let degrees = true, eulerseq = 'xyz', meshdir = '', autolimits = true, fromGeom = 'auto';
  const world: RobotDescription['world'] = {ground: false};
  for (const element of root.children) {
    const a = element.attributes;
    if (element.name === 'compiler') {
      if (a.angle !== undefined) { if (a.angle !== 'degree' && a.angle !== 'radian') r.fail(element, `angle must be "degree" or "radian", got "${a.angle}"`); degrees = a.angle === 'degree'; }
      if (a.eulerseq !== undefined) { if (!/^[xyzXYZ]{3}$/.test(a.eulerseq)) r.fail(element, `eulerseq must be three of x, y, z, X, Y, Z, got "${a.eulerseq}"`); eulerseq = a.eulerseq; }
      if (a.coordinate !== undefined && a.coordinate !== 'local') r.fail(element, `coordinate="${a.coordinate}" is not supported: only local coordinates are read`);
      if (a.meshdir !== undefined) meshdir = a.meshdir; else if (a.assetdir !== undefined) meshdir = a.assetdir;
      if (a.autolimits !== undefined) autolimits = a.autolimits === 'true';
      if (a.inertiafromgeom !== undefined) { if (!['auto', 'true', 'false'].includes(a.inertiafromgeom)) r.fail(element, `inertiafromgeom must be auto, true or false, got "${a.inertiafromgeom}"`); fromGeom = a.inertiafromgeom; }
      leftover(element, a, ['angle', 'eulerseq', 'coordinate', 'meshdir', 'assetdir', 'texturedir', 'autolimits', 'inertiafromgeom', 'strippath', 'discardvisual', 'usethread'], '<compiler>');
    } else if (element.name === 'option') {
      if (a.gravity !== undefined) world.gravity = r.numbers(element, a, 'gravity', 3) as V3;
      if (a.timestep !== undefined) { world.timestep = r.number(element, a, 'timestep'); if (!(world.timestep > 0)) r.fail(element, `timestep must be greater than 0, got ${world.timestep}`); }
      leftover(element, a, ['gravity', 'timestep'], '<option>');
      for (const part of element.children) r.warn('ignored', `<option> <${part.name}>`, 'solver flags are not mapped; ignored', part);
    }
  }
  const angle = degrees ? Math.PI / 180 : 1;

  // Default classes. A class starts from its parent's settings, whatever the order they are written in.
  const classes = new Map<string, Map<string, Attributes>>();
  const readDefaults = (element: XMLElement, parent: Map<string, Attributes> | null, name: string): void => {
    let tags = classes.get(name);
    if (!tags) { tags = new Map(parent ?? []); classes.set(name, tags); }
    for (const part of element.children) if (part.name !== 'default') tags.set(part.name, {...tags.get(part.name), ...part.attributes});
    for (const part of element.children) if (part.name === 'default') {
      const inner = part.attributes.class;
      if (!inner) r.fail(part, 'nested inside <default> needs a class');
      if (classes.has(inner)) r.fail(part, `duplicate default class "${inner}"`);
      readDefaults(part, tags, inner);
    }
  };
  for (const element of root.children) if (element.name === 'default') readDefaults(element, classes.get('main') ?? null, element.attributes.class ?? 'main');
  const resolve = (tag: string, element: XMLElement, childclass: string | undefined): Attributes => {
    const name = element.attributes.class ?? childclass ?? 'main', tags = classes.get(name);
    if (!tags && name !== 'main') r.fail(element, `uses the default class "${name}", which is not defined`);
    return {...tags?.get(tag), ...element.attributes};
  };

  const eulerQuat = (e: readonly number[]): Q4 => {
    let q: Q4 = IDENTITY;
    for (let i = 0; i < 3; i++) {
      const letter = eulerseq[i], lower = letter.toLowerCase(), turn = axisAngle([lower === 'x' ? 1 : 0, lower === 'y' ? 1 : 0, lower === 'z' ? 1 : 0], e[i] * angle);
      q = letter === lower ? qmul(q, turn) : qmul(turn, q);   // lower case: axes that turn with the body; upper case: fixed axes
    }
    return qunit(q);
  };
  const unit = (element: XMLElement, v: readonly number[], what: string): V3 => {
    const length = Math.hypot(v[0], v[1], v[2]);
    if (!(length > 0)) r.fail(element, `${what} must not be the zero vector`);
    return scale(v, 1 / length);
  };
  const orientation = (element: XMLElement, a: Attributes): Q4 => {
    if (a.quat !== undefined) {
      const q = r.numbers(element, a, 'quat', 4);
      if (!(Math.hypot(...q) > 0)) r.fail(element, 'quat must not be zero');
      return qunit([q[1], q[2], q[3], q[0]]);   // MJCF writes w first
    }
    if (a.axisangle !== undefined) { const v = r.numbers(element, a, 'axisangle', 4); return axisAngle(unit(element, v, 'the axisangle axis'), v[3] * angle); }
    if (a.euler !== undefined) return eulerQuat(r.numbers(element, a, 'euler', 3));
    if (a.xyaxes !== undefined) {
      const v = r.numbers(element, a, 'xyaxes', 6), x = unit(element, v, 'the x axis of xyaxes');
      const y = unit(element, sub(v.slice(3), scale(x, dot(v.slice(3), x))), 'the y axis of xyaxes'), z = cross(x, y);
      return quatOfMatrix([x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]]);
    }
    if (a.zaxis !== undefined) return aim(unit(element, r.numbers(element, a, 'zaxis', 3), 'zaxis'), 'z');
    return IDENTITY;
  };
  const ORIENT = ['quat', 'axisangle', 'euler', 'xyaxes', 'zaxis'];

  const meshAssets = new Map<string, {element: XMLElement; a: Attributes}>(), materialColors = new Map<string, number>();
  for (const element of root.children) if (element.name === 'asset') for (const part of element.children) {
    if (part.name === 'mesh') {
      const a = resolve('mesh', part, undefined), name = a.name ?? (a.file ?? '').replace(/^.*[\\/]/, '').replace(/\.[^.]*$/, '');
      if (!name) r.fail(part, 'needs a name or a file');
      meshAssets.set(name, {element: part, a});
      leftover(part, a, ['name', 'class', 'file', 'scale', 'vertex'], `mesh "${name}"`);
    } else if (part.name === 'material') {
      const a = resolve('material', part, undefined);
      if (a.name !== undefined && a.rgba !== undefined) materialColors.set(a.name, rgb(r.numbers(part, a, 'rgba', [3, 4])));
    } else if (part.name === 'hfield') r.warn('unsupported', `asset <hfield>${part.attributes.name ? ` "${part.attributes.name}"` : ''}`, 'height fields are not imported', part);
  }

  const links: RobotLink[] = [], joints: RobotJoint[] = [], linkNames = new Set<string>(), jointNames = new Set<string>(), droppedJoints = new Set<string>();
  let anonymous = 0;
  const uniqueJoint = (wanted: string): string => { let name = wanted; for (let k = 2; jointNames.has(name); k++) name = `${wanted}_${k}`; jointNames.add(name); return name; };

  const readGeom = (g: XMLElement, a: Attributes, owner: string, index: number, isWorld: boolean): {collision: RobotCollision; mass: number; colliding: boolean} | null => {
    const what = `geom ${a.name !== undefined ? `"${a.name}"` : `#${index + 1}`} of ${isWorld ? 'the world' : `body "${owner}"`}`, type = a.type ?? 'sphere';
    leftover(g, a, ['name', 'class', 'type', 'size', 'pos', ...ORIENT, 'fromto', 'mass', 'density', 'friction', 'rgba', 'material', 'mesh', 'contype', 'conaffinity', 'group'], what);
    if (!['plane', 'sphere', 'capsule', 'cylinder', 'box', 'ellipsoid', 'mesh'].includes(type)) { r.warn('unsupported', what, `geom type "${type}" is not imported; the geom is dropped`, g); return null; }
    const size = a.size !== undefined ? r.numbers(g, a, 'size', [1, 3]) : [];
    const need = (count: number): void => {
      if (size.length < count) r.fail(g, `${what}: a ${type} needs ${count} size value${count === 1 ? '' : 's'}, got ${size.length}`);
      for (let i = 0; i < count; i++) if (!(size[i] > 0)) r.fail(g, `${what}: size must be positive, got "${a.size}"`);
    };
    let origin = pose(a.pos !== undefined ? r.numbers(g, a, 'pos', 3) : [0, 0, 0], orientation(g, a)), half = 0;
    const fromto = a.fromto !== undefined && type !== 'plane' && type !== 'mesh' && type !== 'sphere' ? r.numbers(g, a, 'fromto', 6) : null;
    if (fromto) {
      const d = sub(fromto.slice(3), fromto);
      half = Math.hypot(d[0], d[1], d[2]) / 2;
      if (!(half > 0)) r.fail(g, `${what}: fromto must join two different points`);
      origin = pose(scale(add(fromto, fromto.slice(3)), 0.5), aim(d, 'z'));
    }
    let geometry: RobotGeometry;
    if (type === 'plane') {
      if (!isWorld) { r.warn('unsupported', what, 'a plane on a moving body is not imported; the geom is dropped', g); return null; }
      geometry = {type: 'plane'};
    } else if (type === 'sphere') { need(1); geometry = {type: 'sphere', radius: size[0]}; }
    else if (type === 'capsule' || type === 'cylinder') { need(fromto ? 1 : 2); geometry = {type, radius: size[0], length: 2 * (fromto ? half : size[1])}; }
    else if (type === 'box') { need(fromto ? 1 : 3); geometry = {type: 'box', size: fromto ? [2 * size[0], 2 * size[0], 2 * half] : [2 * size[0], 2 * size[1], 2 * size[2]]}; }
    else if (type === 'ellipsoid') {
      need(fromto ? 1 : 3);
      geometry = {type: 'ellipsoid', radii: fromto ? [size[0], size[0], half] : [size[0], size[1], size[2]]};
      r.warn('approximated', what, 'an ellipsoid is represented by a 42-point convex hull of the same volume', g);
    } else {
      const asset = a.mesh !== undefined ? meshAssets.get(a.mesh) : undefined;
      if (!asset) r.fail(g, `${what}: ${a.mesh === undefined ? 'a mesh geom needs mesh="..."' : `the mesh asset "${a.mesh}" is not defined`}`);
      const meshScale = r.numbers(asset!.element, asset!.a, 'scale', 3, [1, 1, 1]) as V3;
      if (meshScale.some(value => value === 0)) r.fail(asset!.element, 'scale must not be zero');
      if (asset!.a.vertex !== undefined) {
        const raw = asset!.a.vertex.trim().split(/\s+/).map(Number);
        if (raw.length < 12 || raw.length % 3 !== 0 || raw.some(value => !Number.isFinite(value))) r.fail(asset!.element, 'vertex must hold at least four finite x y z triples');
        let points: number[];
        try { points = Array.from(toHullShape(raw.map((value, i) => value * meshScale[i % 3]), {maxPoints: ROBOT_LIMITS.meshHullPoints}).points); } catch (error) { r.fail(asset!.element, (error as Error).message); }
        geometry = {type: 'mesh', filename: `${a.mesh}`, scale: meshScale, points: points!};
        r.warn('approximated', `${what} mesh "${a.mesh}"`, `the mesh is represented by its convex hull (${points!.length / 3} points); concave detail does not collide and mass is spread over the hull`, g);
      } else {
        if (asset!.a.file === undefined) r.fail(asset!.element, 'needs a file or a vertex list');
        const filename = meshdir ? `${meshdir.replace(/[\\/]+$/, '')}/${asset!.a.file}` : asset!.a.file, points = r.mesh(g, filename, meshScale, what);
        geometry = points ? {type: 'mesh', filename, scale: meshScale, points} : {type: 'missing-mesh', filename, scale: meshScale};
      }
    }
    const collision: RobotCollision = {origin, geometry};
    if (a.name !== undefined) collision.name = a.name;
    collision.friction = a.friction !== undefined ? r.numbers(g, a, 'friction', [1, 3])[0] : 1;   // MuJoCo's default sliding friction
    if (a.rgba !== undefined) collision.color = rgb(r.numbers(g, a, 'rgba', [3, 4]));
    else if (a.material !== undefined && materialColors.has(a.material)) collision.color = materialColors.get(a.material)!;
    const contype = a.contype ?? '1', conaffinity = a.conaffinity ?? '1', colliding = !(contype === '0' && conaffinity === '0');
    if (colliding && (contype !== '1' || conaffinity !== '1')) r.warn('ignored', what, `contype="${contype}" conaffinity="${conaffinity}" are not mapped: the geom collides with everything`, g);
    let mass = 0;
    if (!isWorld) {
      if (a.mass !== undefined) mass = r.number(g, a, 'mass');
      else mass = r.number(g, a, 'density', 1000) * (geometry.type === 'missing-mesh' ? Math.abs(0.001 * geometry.scale[0] * geometry.scale[1] * geometry.scale[2]) : solidMass(geometry).volume);
      if (!(mass >= 0)) r.fail(g, `${what}: mass and density must not be negative`);
    }
    return {collision, mass, colliding};
  };

  const walk = (element: XMLElement, parent: string | null, inherited: string | undefined): void => {
    const isWorld = parent === null, name = isWorld ? 'world' : element.attributes.name ?? `body_${++anonymous}`;
    if (linkNames.has(name)) r.fail(element, `duplicate body name "${name}"`);
    linkNames.add(name);
    const childclass = element.attributes.childclass ?? inherited;
    const link: RobotLink = isWorld ? {name, collisions: [], isWorld: true} : {name, collisions: []};
    links.push(link);
    if (!isWorld) leftover(element, element.attributes, ['name', 'childclass', 'pos', ...ORIENT], `body "${name}"`);
    const geoms: {collision: RobotCollision; mass: number; colliding: boolean}[] = [], bodyJoints: {element: XMLElement; a: Attributes; type: string; name: string}[] = [];
    let inertial: XMLElement | undefined, geomIndex = 0;
    for (const part of element.children) {
      if (part.name === 'geom') { const geom = readGeom(part, resolve('geom', part, childclass), name, geomIndex++, isWorld); if (geom) geoms.push(geom); }
      else if (part.name === 'joint' || part.name === 'freejoint') {
        if (isWorld) r.fail(part, 'the world body cannot have a joint');
        const a = part.name === 'joint' ? resolve('joint', part, childclass) : part.attributes, type = part.name === 'freejoint' ? 'free' : a.type ?? 'hinge';
        if (!['hinge', 'slide', 'ball', 'free'].includes(type)) r.fail(part, `type must be hinge, slide, ball or free, got "${type}"`);
        bodyJoints.push({element: part, a, type, name: a.name ?? `${name}_joint${bodyJoints.length ? bodyJoints.length + 1 : ''}`});
      } else if (part.name === 'inertial') inertial = part;
      else if (part.name === 'body' || part.name === 'site' || part.name === 'camera' || part.name === 'light') continue;
      else r.warn('unsupported', `<${part.name}> in ${isWorld ? 'the world' : `body "${name}"`}`, `<${part.name}> is not imported; it and everything inside it are dropped`, part);
    }
    if (geoms.length > ROBOT_LIMITS.collisionsPerLink) r.fail(element, `"${name}" has more than ${ROBOT_LIMITS.collisionsPerLink} geoms`);

    // Mass: the <inertial> element when there is one, else the geoms (MuJoCo's inertiafromgeom="auto").
    const useInertial = inertial !== undefined && fromGeom !== 'true';
    if (inertial && !useInertial) r.warn('ignored', `body "${name}" <inertial>`, 'inertiafromgeom="true": the inertial element is replaced by the geoms\' mass', inertial);
    if (useInertial) {
      const a = inertial!.attributes, mass = r.number(inertial!, a, 'mass');
      if (!(mass >= 0)) r.fail(inertial!, `mass must not be negative, got ${mass}`);
      let tensor: RobotInertial['inertia'] = [0, 0, 0, 0, 0, 0];
      if (a.fullinertia !== undefined) { const f = r.numbers(inertial!, a, 'fullinertia', 6); tensor = [f[0], f[3], f[4], f[1], f[5], f[2]]; }
      else if (a.diaginertia !== undefined) { const d = r.numbers(inertial!, a, 'diaginertia', 3); tensor = [d[0], 0, 0, d[1], 0, d[2]]; }
      link.inertial = {mass, origin: pose(r.numbers(inertial!, a, 'pos', 3, [0, 0, 0]), orientation(inertial!, a)), inertia: tensor};
      leftover(inertial!, a, ['pos', ...ORIENT, 'mass', 'diaginertia', 'fullinertia'], `body "${name}" <inertial>`);
      for (const geom of geoms) if (geom.colliding) link.collisions.push(geom.collision);
    } else {
      const massive = geoms.filter(geom => geom.colliding);
      for (const geom of geoms) if (!geom.colliding && geom.mass > 0) r.warn('unsupported', `body "${name}"`, `a geom with contype="0" conaffinity="0" (${geom.mass.toPrecision(4)} kg) is not imported: its mass is missing from the body`, element);
      for (const geom of massive) {
        if (geom.collision.geometry.type === 'missing-mesh') { const s = geom.collision.geometry.scale; geom.collision.geometry = {type: 'box', size: [0.1 * Math.abs(s[0]), 0.1 * Math.abs(s[1]), 0.1 * Math.abs(s[2])]}; }
        if (!isWorld) geom.collision.mass = geom.mass;
        link.collisions.push(geom.collision);
      }
      const total = massive.reduce((sum, geom) => sum + geom.mass, 0);
      if (!isWorld && total > 0) {
        const parts = massive.map(geom => { const solid = solidMass(geom.collision.geometry); return {mass: geom.mass, solid, centre: add(geom.collision.origin.xyz, qrot(geom.collision.origin.quat, solid.centre)), quat: geom.collision.origin.quat}; });
        const com = scale(parts.reduce((sum, part) => add(sum, scale(part.centre, part.mass)), [0, 0, 0] as V3), 1 / total);
        let tensor: M3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
        for (const part of parts) tensor = madd(tensor, madd(rotateTensor(part.quat, mscale(part.solid.inertia, part.solid.volume > 0 ? part.mass / part.solid.volume : 0)), steiner(part.mass, sub(part.centre, com))));
        link.inertial = {mass: total, origin: pose(com), inertia: [tensor[0], tensor[1], tensor[2], tensor[4], tensor[5], tensor[8]], derived: true};
      }
    }

    // The joint to the parent. No joint: fixed.
    if (!isWorld) {
      const a = element.attributes, origin = pose(a.pos !== undefined ? r.numbers(element, a, 'pos', 3) : [0, 0, 0], orientation(element, a));
      const base = {parent: parent!, child: name, origin, supported: true};
      let chosen = bodyJoints[0];
      if (bodyJoints.length === 0) joints.push({...base, name: uniqueJoint(`${name}_fixed`), type: 'fixed', anchor: [0, 0, 0], axis: [0, 0, 1]});
      else {
        for (const one of bodyJoints) { if (jointNames.has(one.name)) r.fail(one.element, `duplicate joint name "${one.name}"`); jointNames.add(one.name); }
        const names = bodyJoints.map(one => `"${one.name}"`).join(', ');
        let ball = false;
        if (bodyJoints.length === 3 && bodyJoints.every(one => one.type === 'hinge')) {
          const anchors = bodyJoints.map(one => r.numbers(one.element, one.a, 'pos', 3, [0, 0, 0])), axes = bodyJoints.map(one => unit(one.element, r.numbers(one.element, one.a, 'axis', 3, [0, 0, 1]), 'axis'));
          ball = anchors.every(p => Math.hypot(...sub(p, anchors[0])) < 1e-9) && Math.abs(dot(axes[0], cross(axes[1], axes[2]))) > 1e-6;
        }
        if (ball) r.warn('approximated', `body "${name}"`, `the three hinge joints ${names} at one point are represented by one ball joint named "${chosen.name}"; their ranges, damping, stiffness and actuators are dropped`, element);
        else if (bodyJoints.length > 1) r.warn('unsupported', `body "${name}"`, `has ${bodyJoints.length} joints (${names}); only one joint per body is supported, so only "${chosen.name}" is used and the body loses the other degrees of freedom`, element);
        for (const one of bodyJoints.slice(1)) droppedJoints.add(one.name);
        const j = chosen.a, e = chosen.element, type = ball ? 'ball' : chosen.type, what = `joint "${chosen.name}"`, turning = type === 'hinge';
        if (chosen.element.name === 'joint') leftover(e, j, ['name', 'class', 'type', 'pos', 'axis', 'range', 'limited', 'damping', 'stiffness', 'springref', 'ref', 'armature', 'frictionloss', 'actuatorfrcrange', 'group'], what);
        if (type === 'free' && parent !== 'world') r.fail(e, `${what}: a free joint must be on a body directly inside <worldbody>`);
        const joint: RobotJoint = {...base, name: chosen.name, type: type === 'hinge' ? 'continuous' : type === 'slide' ? 'prismatic' : type === 'ball' ? 'spherical' : 'floating',
          anchor: type === 'free' ? [0, 0, 0] : r.numbers(e, j, 'pos', 3, [0, 0, 0]) as V3, axis: unit(e, r.numbers(e, j, 'axis', 3, [0, 0, 1]), 'axis')};
        if (type === 'hinge' || type === 'slide') {
          const k = turning ? angle : 1, limited = j.limited ?? 'auto';
          if (!['auto', 'true', 'false'].includes(limited)) r.fail(e, `${what}: limited must be auto, true or false, got "${limited}"`);
          if (j.range !== undefined && (limited === 'true' || (limited === 'auto' && autolimits))) {
            const range = r.numbers(e, j, 'range', 2);
            if (range[1] < range[0]) r.fail(e, `${what}: range="${j.range}" has its upper bound below its lower bound`);
            joint.limits = {lower: range[0] * k, upper: range[1] * k};
            if (turning) joint.type = 'revolute';
          }
          for (const key of ['damping', 'stiffness', 'frictionloss', 'armature'] as const) if (j[key] !== undefined) {
            const value = r.number(e, j, key);
            if (value < 0) r.fail(e, `${what}: ${key} must not be negative`);
            if (value > 0) joint[key === 'frictionloss' ? 'friction' : key] = value;
          }
          if (j.springref !== undefined) joint.springRef = r.number(e, j, 'springref') * k;
          if (j.ref !== undefined) joint.ref = r.number(e, j, 'ref') * k;
          if (j.actuatorfrcrange !== undefined) joint.effort = Math.max(...r.numbers(e, j, 'actuatorfrcrange', 2).map(Math.abs));
          if (joint.armature !== undefined) r.warn('note', what, `armature ${joint.armature} (rotor inertia) is recorded but not modelled`, e);
        } else if (!ball) {
          for (const key of ['range', 'damping', 'stiffness', 'frictionloss', 'armature', 'springref', 'ref']) if (j[key] !== undefined && Number(j[key].split(/\s+/).pop()) !== 0) r.warn('unsupported', what, `${key} on a ${type} joint is not imported`, e);
        }
        joints.push(joint);
      }
    }
    for (const part of element.children) if (part.name === 'body') walk(part, name, childclass);
  };
  const worldbody = root.children.filter(element => element.name === 'worldbody');
  if (worldbody.length === 0) r.fail(root, 'has no <worldbody>');
  if (worldbody.length > 1) r.warn('unsupported', '<worldbody>', 'more than one <worldbody>; only the first is read', worldbody[1]);
  walk(worldbody[0], null, undefined);

  // A horizontal plane through the origin is the engine's ground; any other plane stays a shape for robotToScene to approximate.
  const worldLink = links[0];
  worldLink.collisions = worldLink.collisions.filter(collision => {
    if (collision.geometry.type !== 'plane') return true;
    const normal = qrot(collision.origin.quat, [0, 0, 1]);
    if (!(Math.abs(collision.origin.xyz[2]) < 1e-9 && normal[2] > 1 - 1e-9) || world.ground) return true;
    world.ground = true;
    return false;
  });

  const byName = new Map(joints.map(joint => [joint.name, joint])), parentOf = new Map(joints.map(joint => [joint.child, joint.parent]));
  for (const element of root.children) {
    if (element.name === 'actuator') for (const part of element.children) {
      const a = resolve(part.name, part, undefined), what = `actuator <${part.name}>${a.name !== undefined ? ` "${a.name}"` : ''}`;
      if (a.joint === undefined) { r.warn('unsupported', what, `only actuators on a joint are imported (this one acts on ${['tendon', 'site', 'body', 'slidersite', 'cranksite', 'jointinparent'].find(key => a[key] !== undefined) ?? 'nothing'})`, part); continue; }
      const joint = byName.get(a.joint);
      if (!joint) {
        if (droppedJoints.has(a.joint)) { r.warn('unsupported', what, `acts on joint "${a.joint}", which was dropped`, part); continue; }
        r.fail(part, `acts on joint "${a.joint}", which does not exist`);
      }
      if (joint!.type !== 'revolute' && joint!.type !== 'continuous' && joint!.type !== 'prismatic') { r.warn('unsupported', what, `actuators on a ${joint!.type} joint are not imported`, part); continue; }
      const gear = a.gear !== undefined ? r.numbers(part, a, 'gear', [1, 6])[0] : 1;
      const range = (key: string, flag: string): number | undefined => a[key] !== undefined && a[flag] !== 'false' ? Math.max(...r.numbers(part, a, key, 2).map(Math.abs)) : undefined;
      const force = range('forcerange', 'forcelimited'), control = range('ctrlrange', 'ctrllimited');
      if (part.name === 'motor') {
        const effort = force !== undefined ? force * Math.abs(gear) : control !== undefined ? control * Math.abs(gear) : undefined;
        if (effort !== undefined) joint!.effort = effort;
        r.warn('note', what, effort !== undefined
          ? `a torque source: its limit (${+effort.toPrecision(6)}) is recorded as the effort of joint "${joint!.name}"; drive the joint with the motors option or setJointMotor`
          : `a torque source with no ctrlrange or forcerange: joint "${joint!.name}" gets no effort limit`, part);
        leftover(part, a, ['name', 'class', 'joint', 'gear', 'ctrlrange', 'ctrllimited', 'forcerange', 'forcelimited', 'group'], what);
      } else if (part.name === 'position') {
        const kp = r.number(part, a, 'kp', 1) * gear * gear, kv = r.number(part, a, 'kv', 0) * gear * gear;
        if (kp < 0 || kv < 0) r.fail(part, 'kp and kv must not be negative');
        joint!.servo = {kp: (joint!.servo?.kp ?? 0) + kp, kv: (joint!.servo?.kv ?? 0) + kv};
        if (force !== undefined) { joint!.effort = force * Math.abs(gear); r.warn('note', what, `forcerange is recorded as the effort of joint "${joint!.name}", but the spring that represents the servo is not force-limited`, part); }
        leftover(part, a, ['name', 'class', 'joint', 'gear', 'kp', 'kv', 'ctrlrange', 'ctrllimited', 'forcerange', 'forcelimited', 'group'], what);
      } else if (part.name === 'velocity') {
        const kv = r.number(part, a, 'kv', 1) * gear * gear;
        joint!.damping = (joint!.damping ?? 0) + kv;
        r.warn('approximated', what, `a velocity servo at zero command is a damper: ${+kv.toPrecision(6)} is added to the damping of joint "${joint!.name}"`, part);
        leftover(part, a, ['name', 'class', 'joint', 'gear', 'kv', 'ctrlrange', 'ctrllimited', 'forcerange', 'forcelimited', 'group'], what);
      } else r.warn('unsupported', what, `<${part.name}> actuators are not imported`, part);
    } else if (element.name === 'equality' || element.name === 'tendon') {
      for (const part of element.children) {
        if (element.name === 'tendon' && part.name === 'default') continue;
        const label = `${element.name} <${part.name}>${part.attributes.name !== undefined ? ` "${part.attributes.name}"` : ''}`;
        r.warn('unsupported', label, element.name === 'equality' ? 'equality constraints are not imported: the bodies or joints it ties move independently' : 'tendons are not imported: it applies no force and no limit', part);
      }
    } else if (element.name === 'contact') {
      for (const part of element.children) {
        const a = part.attributes;
        if (part.name === 'exclude' && a.body1 !== undefined && a.body2 !== undefined && (parentOf.get(a.body1) === a.body2 || parentOf.get(a.body2) === a.body1)) continue;   // joined links never collide here
        if (part.name === 'exclude') r.warn('unsupported', `contact <exclude> body1="${a.body1 ?? ''}" body2="${a.body2 ?? ''}"`, 'only links joined by a joint are excluded from colliding; these two can collide (selfCollision: false stops all self-collision)', part);
        else r.warn('unsupported', `contact <${part.name}>`, 'explicit contact pairs are not imported', part);
      }
    } else if (element.name === 'include') r.warn('unsupported', `<include file="${element.attributes.file ?? ''}">`, 'included files are not read; merge them into the model first', element);
    else if (!['compiler', 'option', 'default', 'asset', 'worldbody', 'visual', 'statistic', 'size'].includes(element.name)) {
      r.warn('ignored', `<${element.name}>`, `not used by this import${element.children.length ? ` (${element.children.length} element${element.children.length === 1 ? '' : 's'} inside)` : ''}`, element);
    }
  }
  return finish(r, root, root.attributes.model ?? 'robot', 'mjcf', links, joints, world);
}

// ---------------------------------------------------------------------------
// Forward kinematics
// ---------------------------------------------------------------------------

/**
 * Pose of every link frame in the robot's own axes (the root link frame is the
 * origin), for the given joint positions: radians for revolute and continuous
 * joints, metres for prismatic ones, in the file's values. A joint that is not
 * named sits at its reference position (0, or MJCF `ref`). Each child frame is
 * parent x joint origin x joint motion, where the motion turns about, or slides
 * along, the joint axis through the joint's anchor.
 */
export function robotKinematics(description: RobotDescription, positions: {readonly [joint: string]: number} = {}): Map<string, RobotPose> {
  const {order, parentJoint} = robotTree(description), known = new Map(description.joints.map(joint => [joint.name, joint]));
  for (const [name, value] of Object.entries(positions)) {
    const joint = known.get(name);
    if (!joint) bad(`robot "${description.name}" has no joint "${name}".`);
    if (joint!.type !== 'revolute' && joint!.type !== 'continuous' && joint!.type !== 'prismatic') bad(`joint "${name}" is ${joint!.type}: only revolute, continuous and prismatic joints take a position.`);
    if (!Number.isFinite(value)) bad(`the position of joint "${name}" must be a finite number.`);
  }
  const poses = new Map<string, RobotPose>();
  for (const name of order) {
    const joint = parentJoint.get(name);
    if (!joint) { poses.set(name, pose()); continue; }
    const q = (named(positions, joint.name) ?? joint.ref ?? 0) - (joint.ref ?? 0);
    let motion = pose();
    if (q !== 0 && joint.type === 'prismatic') motion = pose(scale(joint.axis, q));
    else if (q !== 0) { const turn = axisAngle(joint.axis, q); motion = pose(sub(joint.anchor, qrot(turn, joint.anchor)), turn); }
    poses.set(name, compose(compose(poses.get(joint.parent)!, joint.origin), motion));
  }
  return poses;
}

// ---------------------------------------------------------------------------
// From a description to a scene
// ---------------------------------------------------------------------------

export interface RobotSceneOptions {
  /** Joint positions to build the robot in (see `robotKinematics`). Default: every joint at its reference position. */
  readonly positions?: {readonly [joint: string]: number};
  /** false (default): the root link is welded to the world. true: it is free. An MJCF model's root is the world itself, so this has no effect there. */
  readonly floatingBase?: boolean;
  /** true (default): links collide with each other, except links joined by a joint. false: the whole robot shares one negative collision group. */
  readonly selfCollision?: boolean;
  /**
   * How stiffly every joint of the robot holds its links together. The engine's default (60 Hz,
   * damping ratio 2) lets a loaded arm sag by millimetres per joint; a higher frequency holds it
   * closer. Keep it well below the sub-step rate (steps per second x subSteps).
   */
  readonly jointStiffness?: {readonly hertz: number; readonly dampingRatio?: number};
  /** Where the robot's origin goes in the world, and its orientation there (applied after `up`). */
  readonly position?: readonly [number, number, number];
  readonly rotation?: readonly [number, number, number, number];
  /** The robot file's up axis. 'z' (default, the URDF and MJCF convention) maps file (x, y, z) to world (x, z, -y); 'y' keeps the axes. */
  readonly up?: 'z' | 'y';
  /** How a cylinder is represented: 'hull' (default), a prism of the same volume, or 'capsule', a capsule of the same radius and overall length. */
  readonly cylinders?: 'hull' | 'capsule';
  /** Sides of the prism for 'hull', 8 to 32. Default 24. */
  readonly cylinderSides?: number;
  /** Joint motors: target speed (rad/s or m/s) by joint name. The largest torque or force is the joint's effort limit unless `maxForce` is given. */
  readonly motors?: {readonly [joint: string]: number | {readonly speed: number; readonly maxForce?: number}};
  /** Hold joints at the positions they are built in with a spring: every moving joint, or those listed. Replaces the file's stiffness and damping on those joints. */
  readonly hold?: {readonly hertz: number; readonly dampingRatio?: number; readonly joints?: readonly string[]};
  /** Frequency of the weak spring that carries a joint's viscous damping when the joint has no stiffness. Default 0.01 Hz. */
  readonly dampingHertz?: number;
  /** kg/m^3 for a link that has collision shapes but no mass. Default 1000. */
  readonly defaultDensity?: number;
  /** Friction of shapes that give none. Default 0.6 (the engine's). */
  readonly friction?: number;
  readonly restitution?: number;
  /** Scene world settings; each one given replaces what the file says. */
  readonly world?: SceneWorld;
  /** Keep the robot's bodies awake. Default true. */
  readonly neverSleeps?: boolean;
  /** Prefix of every body and joint id, so that two robots can share a world. */
  readonly prefix?: string;
  /** Collision groups -collisionGroup, -collisionGroup - 1, ... are used. Default 20000. */
  readonly collisionGroup?: number;
}

export interface RobotLinkReport {
  link: string;
  /** Ids of the bodies that make up the link (empty for a link that is only a frame). */
  bodies: string[];
  /**
   * 'collision': bodies from the collision shapes. 'inertia-box': a link with mass but no collision shape, as a box that
   * collides with nothing and has exactly the file's mass and inertia. 'default-density': shapes but no mass in the file.
   * 'static': shapes without mass, rigidly fixed to the world. 'frame': no body.
   */
  kind: 'collision' | 'inertia-box' | 'default-density' | 'static' | 'frame';
  /** kg, from the file. */
  mass: number;
  /** kg, of the bodies. */
  massActual: number;
  /** m^3 of the bodies' shapes (overlaps counted twice). */
  volume: number;
  /** Centre of mass in the link frame, from the file and of the bodies, and the distance between them. */
  comSpecified?: [number, number, number];
  comActual?: [number, number, number];
  comOffset?: number;
  /** Principal moments about the centre of mass, ascending, kg m^2. */
  principalSpecified?: [number, number, number];
  principalActual?: [number, number, number];
  /** |actual - specified| / specified for each principal moment (a moment below 1e-9 of the largest is compared with the largest). */
  principalError?: [number, number, number];
  maxPrincipalError?: number;
  /** Frobenius norm of (actual - specified) / specified, both tensors about the file's centre of mass in the link frame: also sees a shifted centre of mass and turned axes. */
  tensorError?: number;
}
export interface RobotShapeReport {
  link: string;
  body: string;
  /** What the file asked for and what stands in for it. */
  shape: string;
  as: string;
  /** (volume of the stand-in) / (volume of the shape) - 1. */
  volumeError: number;
  /** Largest relative error of a principal moment, at equal mass. */
  inertiaError: number;
}
export interface RobotJointReport {
  joint: string;
  type: RobotJointType;
  /** Scene joint id, or null when the joint needs no constraint (floating) or could not be made. */
  id: string | null;
  as: 'weld' | 'revolute' | 'prismatic' | 'spherical' | 'none';
  limits?: {lower: number; upper: number};
  motor?: {speed: number; maxForce: number};
  /** The joint spring, with the physical stiffness (N m/rad or N/m) and damping it stands for and the effective mass the engine sees at the joint. */
  spring?: {hertz: number; dampingRatio: number; target: number; stiffness: number; damping: number; effectiveMass: number};
  effort?: number;
}
export interface RobotReport {
  name: string;
  /** kg: the file's link masses that have bodies, and what the bodies weigh. */
  totalMass: number;
  totalMassActual: number;
  links: RobotLinkReport[];
  shapes: RobotShapeReport[];
  joints: RobotJointReport[];
  /** The largest `maxPrincipalError` of any link, and that link. 0 and null when no link has a tensor to compare. */
  maxPrincipalError: number;
  worstLink: string | null;
  /** The parser's warnings followed by those of the conversion. */
  warnings: RobotWarning[];
}

/** Rotates a body's +y (the engine's capsule axis) onto +z (the file's). */
const Y_TO_Z: Q4 = [Math.SQRT1_2, 0, 0, Math.SQRT1_2];
/** File Z-up to world Y-up: (x, y, z) -> (x, z, -y). */
const Z_UP: Q4 = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];

const ICOSPHERE: V3[] = (() => {
  const t = (1 + Math.sqrt(5)) / 2, corners: V3[] = [];
  for (const a of [-1, 1]) for (const b of [-t, t]) corners.push([0, a, b], [a, b, 0], [b, 0, a]);
  const points = corners.map(p => scale(p, 1 / Math.hypot(...p)));
  // An icosahedron's edges are its shortest vertex pairs (length 2 / |corner| with these coordinates).
  const edge = 2 / Math.hypot(1, t) + 1e-9, count = points.length;
  for (let i = 0; i < count; i++) for (let j = i + 1; j < count; j++) if (Math.hypot(...sub(points[i], points[j])) < edge) { const m = add(points[i], points[j]); points.push(scale(m, 1 / Math.hypot(...m))); }
  return points;
})();

interface Piece {
  id: string;
  shape: SceneShape;
  /** Body frame in the link frame; its origin is the shape's centre of mass. */
  pose: RobotPose;
  volume: number;
  /** Unit-density inertia about the origin, in the body frame. */
  unit: M3;
  density: number;
  friction?: number;
  color?: number;
  colliding: boolean;
}
interface LinkPlan {
  link: RobotLink;
  index: number;
  pieces: Piece[];
  kind: RobotLinkReport['kind'];
  /** The body that carries the link frame (null: the world) and the link frame in that body's coordinates. `free`: a massless floating frame. */
  carrier: {body: string | null; frame: RobotPose; free?: boolean};
}
interface RobotPlan {
  scene: Scene;
  report: RobotReport;
  links: Map<string, {body: string | null; bodies: string[]; frame: RobotPose}>;
  joints: Map<string, string>;
}

function buildPlan(description: RobotDescription, options: RobotSceneOptions): RobotPlan {
  const {order, parentJoint, childJoints} = robotTree(description);
  const warnings: RobotWarning[] = [...description.warnings];
  const warn = (code: RobotWarning['code'], element: string, message: string): void => { warnings.push({code, element, message}); };
  const sides = options.cylinderSides ?? 24, mode = options.cylinders ?? 'hull', up = options.up ?? 'z', prefix = options.prefix ?? '';
  if (!Number.isInteger(sides) || sides < 8 || sides > 32) bad('cylinderSides must be an integer from 8 to 32.');
  if (mode !== 'hull' && mode !== 'capsule') bad("cylinders must be 'hull' or 'capsule'.");
  if (up !== 'z' && up !== 'y') bad("up must be 'z' or 'y'.");
  if (prefix !== '' && !/^[A-Za-z0-9_.:-]{1,24}$/.test(prefix)) bad('prefix may hold up to 24 letters, digits and _ . : -');
  const defaultDensity = options.defaultDensity ?? 1000, dampingHertz = options.dampingHertz ?? 0.01, group0 = options.collisionGroup ?? 20000;
  if (!(defaultDensity > 0) || !(dampingHertz > 0) || !Number.isInteger(group0) || group0 < 1) bad('defaultDensity and dampingHertz must be positive, and collisionGroup a positive integer.');
  const baseRotation = options.rotation ? qunit(options.rotation) : IDENTITY, basePosition = options.position ?? [0, 0, 0];
  const upVector = (v: readonly number[]): V3 => up === 'z' ? [v[0], v[2], zero(-v[1])] : [v[0], v[1], v[2]];
  const turned = options.rotation !== undefined && !(baseRotation[0] === 0 && baseRotation[1] === 0 && baseRotation[2] === 0);
  /** A pose in the robot's axes, in the world. */
  const toWorld = (p: RobotPose): RobotPose => {
    const v = upVector(p.xyz), q = up === 'z' ? qmul(Z_UP, p.quat) : p.quat;
    return {xyz: add(basePosition, turned ? qrot(baseRotation, v) : v), quat: qunit(turned ? qmul(baseRotation, q) : q)};
  };
  const linkPose = robotKinematics(description, options.positions);

  const used = new Set<string>();
  const makeId = (wanted: string): string => {
    const clean = (prefix + (wanted.replace(/[^A-Za-z0-9_.:-]/g, '_') || 'x')).slice(0, 56);
    let id = clean;
    for (let k = 2; used.has(id); k++) id = `${clean}-${k}`;
    used.add(id);
    return id;
  };

  const shapes: RobotShapeReport[] = [];
  const compare = (link: string, shape: string, as: string, exact: SolidMass, volume: number, unit: readonly number[]): Omit<RobotShapeReport, 'body'> => {
    const a = eigenSymmetric(mscale(exact.inertia, 1 / exact.volume)).values, b = eigenSymmetric(mscale(unit, 1 / volume)).values;
    return {link, shape, as, volumeError: volume / exact.volume - 1, inertiaError: Math.max(...a.map((value, i) => Math.abs(b[i] - value) / value))};
  };
  type Made = Omit<Piece, 'id' | 'density' | 'friction' | 'color' | 'colliding'> & {note?: Omit<RobotShapeReport, 'body'>};
  const hullPiece = (points: readonly number[], origin: RobotPose): Made => {
    const hull = convexHull(points), m = polyhedronMass(hull.vertices, hull.indices);
    return {shape: {kind: 'hull', points: Array.from(points, (v, i) => zero(v - m.centroid[i % 3]))}, pose: compose(origin, pose(m.centroid)), volume: m.volume, unit: m.inertia};
  };
  const makePiece = (link: string, geometry: RobotGeometry, origin: RobotPose): Made => {
    const tooSmall = (value: number, floor: number, what: string): void => { if (!(value >= floor)) bad(`link "${link}": ${what} ${value} m is below the engine's minimum of ${floor} m.`); };
    switch (geometry.type) {
      case 'box': {
        const half = scale(geometry.size, 0.5), solid = solidMass(geometry);
        half.forEach(value => tooSmall(value, 1e-4, 'a box half extent of'));
        return {shape: {kind: 'box', halfExtents: half}, pose: origin, volume: solid.volume, unit: solid.inertia};
      }
      case 'sphere': { tooSmall(geometry.radius, 1e-4, 'a sphere radius of'); const solid = solidMass(geometry); return {shape: {kind: 'sphere', radius: geometry.radius}, pose: origin, volume: solid.volume, unit: solid.inertia}; }
      case 'capsule': {
        tooSmall(geometry.radius, 1e-4, 'a capsule radius of');
        if (geometry.length / 2 < 0.0025) {
          const sphere: RobotGeometry = {type: 'sphere', radius: geometry.radius}, solid = solidMass(sphere);
          return {shape: {kind: 'sphere', radius: geometry.radius}, pose: origin, volume: solid.volume, unit: solid.inertia, note: compare(link, 'capsule', 'sphere (shorter than the 5 mm minimum)', solidMass(geometry), solid.volume, solid.inertia)};
        }
        const solid = capsuleMass(geometry.radius, geometry.length, 1);
        return {shape: {kind: 'capsule', radius: geometry.radius, halfLength: geometry.length / 2}, pose: compose(origin, pose([0, 0, 0], Y_TO_Z)), volume: solid.volume, unit: solid.inertia};
      }
      case 'cylinder': {
        const {radius, length} = geometry, exact = solidMass(geometry);
        tooSmall(radius, 1e-4, 'a cylinder radius of'); tooSmall(length / 2, 1e-4, 'a cylinder half length of');
        if (mode === 'capsule' && length / 2 - radius >= 0.0025) {
          const solid = capsuleMass(radius, length - 2 * radius, 1);
          return {shape: {kind: 'capsule', radius, halfLength: length / 2 - radius}, pose: compose(origin, pose([0, 0, 0], Y_TO_Z)), volume: solid.volume, unit: solid.inertia,
            note: compare(link, 'cylinder', 'capsule of the same radius and overall length', exact, solid.volume, mmul(mmul(qmat(Y_TO_Z), solid.inertia), mT(qmat(Y_TO_Z))))};
        }
        if (mode === 'capsule') warn('note', `link "${link}"`, `a cylinder of radius ${radius} m and length ${length} m is too short for a capsule; it is a ${sides}-sided prism instead`);
        // A regular prism whose cross-section has the circle's area, so the volume is the cylinder's.
        const step = 2 * Math.PI / sides, r = radius * Math.sqrt(step / Math.sin(step)), points: number[] = [];
        for (let i = 0; i < sides; i++) for (const z of [-length / 2, length / 2]) points.push(r * Math.cos(i * step), r * Math.sin(i * step), z);
        const made = hullPiece(points, origin);
        return {...made, note: compare(link, 'cylinder', `${sides}-sided prism of the same volume`, exact, made.volume, made.unit)};
      }
      case 'ellipsoid': {
        const [a, b, c] = geometry.radii, exact = solidMass(geometry);
        if (a === b && b === c) return makePiece(link, {type: 'sphere', radius: a}, origin);
        const raw = ICOSPHERE.flatMap(p => [p[0] * a, p[1] * b, p[2] * c]), rawHull = convexHull(raw);
        const k = Math.cbrt(exact.volume / polyhedronMass(rawHull.vertices, rawHull.indices).volume), made = hullPiece(raw.map(v => v * k), origin);
        return {...made, note: compare(link, 'ellipsoid', '42-point hull of the same volume', exact, made.volume, made.unit)};
      }
      case 'mesh': return hullPiece(geometry.points, origin);
      default: return bad(`link "${link}": a ${geometry.type} cannot be a body here.`);
    }
  };
  /** The solid box with a given mass and inertia tensor, or null when no box has them. */
  const inertiaBox = (inertial: RobotInertial): {size: V3; origin: RobotPose} | null => {
    const {values, vectors} = eigenSymmetric(tensorOf(inertial.inertia)), m = inertial.mass;
    const squares = [values[1] + values[2] - values[0], values[0] + values[2] - values[1], values[0] + values[1] - values[2]].map(v => 6 * v / m);
    if (!(m > 0) || !(values[0] > 0) || squares.some(v => !(v >= 4e-8))) return null;
    return {size: squares.map(Math.sqrt) as V3, origin: compose(inertial.origin, pose([0, 0, 0], quatOfMatrix(vectors)))};
  };

  // Which links are rigidly fixed to the world: a massless link among them can be static scenery.
  const fixedBase = !options.floatingBase;
  const rigid = new Map<string, boolean>();
  for (const name of order) {
    const joint = parentJoint.get(name), link = description.links.find(one => one.name === name)!;
    rigid.set(name, joint ? joint.type === 'fixed' && rigid.get(joint.parent)! : fixedBase || link.isWorld === true);
  }

  // Bodies of every link.
  const plans = new Map<string, LinkPlan>();
  const linkIndex = new Map(description.links.map((link, index) => [link.name, index]));
  for (const name of order) {
    const link = description.links[linkIndex.get(name)!], inertial = link.inertial, mass = inertial?.mass ?? 0, pieces: Piece[] = [];
    let kind: RobotLinkReport['kind'] = 'frame';
    const collisions = link.collisions.map(collision => {
      if (collision.geometry.type !== 'missing-mesh') return collision;
      // The file is unknown, so its bounds are too. The box with the link's mass and inertia is the best stand-in.
      const box = inertial ? inertiaBox(inertial) : null, s = collision.geometry.scale;
      return box ? {...collision, origin: box.origin, geometry: {type: 'box', size: box.size} as RobotGeometry}
        : {...collision, geometry: {type: 'box', size: [0.1 * Math.abs(s[0]), 0.1 * Math.abs(s[1]), 0.1 * Math.abs(s[2])]} as RobotGeometry};
    });
    const add1 = (made: Made, id: string, extra: Partial<Piece>): void => {
      const piece: Piece = {id: makeId(id), shape: made.shape, pose: made.pose, volume: made.volume, unit: made.unit, density: 0, colliding: true, ...extra};
      if (made.note) shapes.push({...made.note, body: piece.id});
      pieces.push(piece);
    };
    if (link.isWorld) {
      kind = 'static';
      collisions.forEach((collision, k) => {
        const id = collision.name ?? `${name}.${k + 1}`, extra = {friction: collision.friction, color: collision.color};
        if (collision.geometry.type === 'plane') {
          warn('approximated', `plane ${collision.name ? `"${collision.name}" ` : ''}of the world`, 'a plane that is not the horizontal plane through the origin is represented by a static slab 88 m square and 1 m thick');
          add1(makePiece(name, {type: 'box', size: [88, 88, 1]}, compose(collision.origin, pose([0, 0, -0.5]))), id, extra);
        } else add1(makePiece(name, collision.geometry, collision.origin), id, extra);
      });
    } else if (collisions.length > 0) {
      const made = collisions.map(collision => makePiece(name, collision.geometry, collision.origin));
      const volume = made.reduce((sum, one) => sum + one.volume, 0), perShape = collisions.every(collision => collision.mass !== undefined);
      kind = mass > 0 ? 'collision' : rigid.get(name) ? 'static' : 'default-density';
      if (kind === 'default-density') warn('note', `link "${name}"`, `has collision shapes but no mass; its bodies get the default density of ${defaultDensity} kg/m^3 (${+(defaultDensity * volume).toPrecision(6)} kg)`);
      const densities = made.map((one, k) => kind !== 'collision' ? defaultDensity : perShape ? collisions[k].mass! / one.volume : mass / volume);
      if (kind === 'collision' && densities.some(value => !(value > 0))) bad(`link "${name}": a collision shape has no mass or no volume, so its density cannot be set.`);
      // The heaviest shape carries the link's joints and keeps the link's name.
      let first = 0;
      made.forEach((one, k) => { if (densities[k] * one.volume > densities[first] * made[first].volume * (1 + 1e-12)) first = k; });
      const sequence = [first, ...made.map((_, k) => k).filter(k => k !== first)];
      sequence.forEach((k, position) => add1(made[k], position === 0 ? name : `${name}.${position + 1}`, {density: densities[k], friction: collisions[k].friction, color: collisions[k].color ?? link.color}));
    } else if (mass > 0) {
      kind = 'inertia-box';
      const box = inertiaBox(inertial!);
      if (box) add1(makePiece(name, {type: 'box', size: box.size}, box.origin), name, {density: mass / (box.size[0] * box.size[1] * box.size[2]), colliding: false, color: link.color});
      else {
        warn('approximated', `link "${name}"`, 'has mass and no collision shape, and no solid box has its inertia tensor (a principal moment is zero or exceeds the sum of the other two); it is a 5 cm sphere of the right mass that collides with nothing');
        add1(makePiece(name, {type: 'sphere', radius: 0.05}, inertial!.origin), name, {density: mass / (4 / 3 * Math.PI * 0.05 ** 3), colliding: false, color: link.color});
      }
    }
    plans.set(name, {link, index: linkIndex.get(name)!, pieces, kind, carrier: {body: null, frame: pose()}});
  }

  // Which body carries each link frame.
  const world = (name: string): RobotPose => toWorld(linkPose.get(name)!);
  for (const name of order) {
    const plan = plans.get(name)!, joint = parentJoint.get(name);
    if (plan.link.isWorld) { plan.carrier = {body: null, frame: world(name)}; continue; }
    if (plan.pieces.length > 0) { plan.carrier = {body: plan.pieces[0].id, frame: invert(plan.pieces[0].pose)}; continue; }
    if (!joint) { plan.carrier = fixedBase ? {body: null, frame: world(name)} : {body: null, frame: pose(), free: true}; continue; }
    const parent = plans.get(joint.parent)!.carrier;
    if (joint.type === 'fixed') {
      plan.carrier = parent.free ? {...parent} : parent.body === null ? {body: null, frame: world(name)} : {body: parent.body, frame: compose(parent.frame, joint.origin)};
      continue;
    }
    if (joint.type === 'floating' || joint.type === 'planar') { plan.carrier = {body: null, frame: pose(), free: true}; continue; }
    // A massless link on a moving joint: the first link with a body that is fixed to it stands in.
    let found: {plan: LinkPlan; chain: RobotPose} | null = null;
    for (let queue: {name: string; chain: RobotPose}[] = [{name, chain: pose()}]; queue.length > 0 && !found;) {
      const at = queue.shift()!;
      for (const next of childJoints.get(at.name)!) {
        if (next.type !== 'fixed') continue;
        const chain = compose(at.chain, next.origin), target = plans.get(next.child)!;
        if (target.pieces.length > 0 && target.kind !== 'static') { found = {plan: target, chain}; break; }
        queue.push({name: next.child, chain});
      }
    }
    if (!found) bad(`robot "${description.name}": link "${name}" moves on joint "${joint.name}" but has no mass and no collision shape, and no link fixed to it has a body. Give it an inertial.`);
    plan.carrier = {body: found!.plan.pieces[0].id, frame: compose(invert(found!.plan.pieces[0].pose), invert(found!.chain))};
  }

  // Collision filters.
  const selfCollision = options.selfCollision !== false, filters = new Map<string, SceneFilter>();
  const bodyLinks = order.map(name => plans.get(name)!).filter(plan => plan.pieces.length > 0 && !plan.link.isWorld);
  const compound = bodyLinks.some(plan => plan.pieces.length > 1);
  const ownerOf = new Map<string, LinkPlan>();
  for (const plan of bodyLinks) for (const piece of plan.pieces) ownerOf.set(piece.id, plan);
  const neighbours = new Map<LinkPlan, Set<LinkPlan>>(bodyLinks.map(plan => [plan, new Set<LinkPlan>()]));
  for (const joint of description.joints) {
    if (joint.type === 'floating' || joint.type === 'planar') continue;
    const a = plans.get(joint.parent)!.carrier.body, b = plans.get(joint.child)!.carrier.body, pa = a === null ? undefined : ownerOf.get(a), pb = b === null ? undefined : ownerOf.get(b);
    if (pa && pb && pa !== pb) { neighbours.get(pa)!.add(pb); neighbours.get(pb)!.add(pa); }
  }
  // With several bodies per link, "joined links do not collide" needs more than the joint's own flag: each link gets a category bit and masks out its neighbours.
  const bits = selfCollision && compound && bodyLinks.length <= 63;
  if (selfCollision && compound && !bits) warn('note', `robot "${description.name}"`, `has ${bodyLinks.length} links with bodies, more than the 63 category bits: bodies of joined links that are not the two bodies of the joint can collide`);
  bodyLinks.forEach((plan, k) => {
    const filter: {categoryBits?: string; maskBits?: string; groupIndex?: number} = {};
    if (!selfCollision) filter.groupIndex = -group0;
    else if (plan.pieces.length > 1) filter.groupIndex = -(group0 + 1 + k);
    if (bits) {
      let mask = 0xFFFFFFFFFFFFFFFFn;
      for (const other of neighbours.get(plan)!) mask &= ~(1n << BigInt(bodyLinks.indexOf(other) + 1));
      filter.categoryBits = (1n << BigInt(k + 1)).toString(); filter.maskBits = mask.toString();
    }
    for (const piece of plan.pieces) {
      if (!piece.colliding) filters.set(piece.id, {categoryBits: '1', maskBits: '0'});
      else if (Object.keys(filter).length > 0) filters.set(piece.id, filter);
    }
  });

  // Scene bodies, and what the solver will make of each (mass, inertia in the world frame).
  const bodies: SceneBody[] = [], joints: SceneJoint[] = [];
  const solver = new Map<string, {inverseMass: number; inverseInertia: M3; centre: V3}>();
  for (const name of order) {
    const plan = plans.get(name)!, base = linkPose.get(name)!;
    for (const piece of plan.pieces) {
      const at = toWorld(compose(base, piece.pose)), isStatic = plan.kind === 'static';
      const body: {-readonly [K in keyof SceneBody]: SceneBody[K]} = {id: piece.id, shape: piece.shape, position: at.xyz.map(zero) as V3, rotation: at.quat.map(zero) as Q4};
      if (isStatic) body.type = 'static'; else body.density = piece.density;
      const friction = piece.friction ?? options.friction;
      if (friction !== undefined) body.friction = friction;
      if (options.restitution !== undefined) body.restitution = options.restitution;
      if (piece.color !== undefined) body.color = piece.color;
      if (!isStatic && options.neverSleeps !== false) body.neverSleeps = true;
      const filter = filters.get(piece.id);
      if (filter) body.filter = filter;
      body.userData = plan.pieces.length > 1 ? {link: name, part: plan.pieces.indexOf(piece) + 1} : {link: name};
      bodies.push(body);
      const m = isStatic ? 0 : piece.density * piece.volume;
      solver.set(piece.id, {inverseMass: m > 0 ? 1 / m : 0, inverseInertia: m > 0 ? minv(rotateTensor(at.quat, mscale(piece.unit, piece.density))) : [0, 0, 0, 0, 0, 0, 0, 0, 0], centre: at.xyz});
    }
  }
  const NONE = {inverseMass: 0, inverseInertia: [0, 0, 0, 0, 0, 0, 0, 0, 0] as M3, centre: [0, 0, 0] as V3};
  const frameOf = (p: RobotPose): {position: V3; rotation: Q4} => ({position: p.xyz.map(zero) as V3, rotation: p.quat.map(zero) as Q4});
  /** A frame given in a carrier's coordinates, in the world. */
  const frameInWorld = (body: string | null, frame: RobotPose): RobotPose => {
    if (body === null) return frame;
    const owner = ownerOf.get(body)!, piece = owner.pieces.find(one => one.id === body)!;
    return compose(toWorld(compose(linkPose.get(owner.link.name)!, piece.pose)), frame);
  };

  // Joints.
  const jointReports: RobotJointReport[] = [], jointIds = new Map<string, string>();
  const held = options.hold;
  if (held && !(held.hertz > 0)) bad('hold.hertz must be greater than 0.');
  const names = new Set(description.joints.map(joint => joint.name));
  for (const name of [...Object.keys(options.motors ?? {}), ...(held?.joints ?? [])]) if (!names.has(name)) bad(`robot "${description.name}" has no joint "${name}".`);
  for (const name of order) {
    const plan = plans.get(name)!, joint = parentJoint.get(name);
    if (!joint && !plan.link.isWorld && plan.pieces.length > 0 && plan.kind !== 'static' && fixedBase) {
      joints.push({id: makeId(`${name}.base`), type: 'weld', bodyA: null, bodyB: plan.pieces[0].id, frameA: frameOf(world(name)), frameB: frameOf(plan.carrier.frame), userData: {joint: 'base'}});
    }
    if (joint) {
      const a = plans.get(joint.parent)!.carrier, b = plan.carrier, report: RobotJointReport = {joint: joint.name, type: joint.type, id: null, as: 'none'};
      if (joint.effort !== undefined) report.effort = joint.effort;
      jointReports.push(report);
      const moving = joint.type === 'revolute' || joint.type === 'continuous' || joint.type === 'prismatic';
      const dropped = (why: string): void => { if (joint.type !== 'fixed') warn('unsupported', `joint "${joint.name}"`, why); };
      if (joint.type === 'floating' || joint.type === 'planar') { /* no constraint */ }
      else if (b.free || b.body === null) dropped(`link "${name}" has no body, so the joint is not made`);
      else if (plan.kind === 'static') { /* static scenery needs no joint */ }
      else if (a.free) dropped('its parent is the massless root of a floating robot, so the joint is not made and the child is free');
      else if (a.body === b.body) { /* both link frames ride on one body */ }
      else {
        const id = makeId(joint.name), type = joint.type === 'fixed' ? 'weld' : joint.type === 'prismatic' ? 'prismatic' : joint.type === 'spherical' ? 'spherical' : 'revolute';
        const turn = type === 'revolute' ? aim(joint.axis, 'z') : type === 'prismatic' ? aim(joint.axis, 'x') : IDENTITY;
        const inChild = pose(joint.anchor, turn), frameA = compose(compose(a.frame, joint.origin), inChild), frameB = compose(b.frame, inChild);
        const made: {-readonly [K in keyof SceneJoint]: SceneJoint[K]} = {id, type, bodyA: a.body, bodyB: b.body, frameA: frameOf(frameA), frameB: frameOf(frameB)};
        report.id = id; report.as = type;
        jointIds.set(joint.name, id);
        if (moving) {
          const ref = joint.ref ?? 0, start = (named(options.positions, joint.name) ?? ref) - ref, what = `joint "${joint.name}"`;
          if (joint.limits) {
            let {lower, upper} = joint.limits;
            lower -= ref; upper -= ref;
            if (type === 'revolute' && (lower < -Math.PI || upper > Math.PI)) {
              // The engine measures a hinge angle in (-pi, pi], so a limit beyond that cannot be told from one inside it.
              warn('unsupported', what, `the limit [${+(lower + ref).toPrecision(6)}, ${+(upper + ref).toPrecision(6)}] rad reaches beyond half a turn from the reference position, which the engine's hinge angle cannot measure; the joint is left unlimited`);
            } else { made.limits = {lower: zero(lower), upper: zero(upper)}; report.limits = made.limits; }
          }
          const drive = named(options.motors, joint.name);
          if (drive !== undefined) {
            const speed = typeof drive === 'number' ? drive : drive.speed, maxForce = (typeof drive === 'number' ? undefined : drive.maxForce) ?? joint.effort;
            if (!Number.isFinite(speed)) bad(`motors: the speed of ${what} must be a finite number.`);
            if (maxForce === undefined || !(maxForce >= 0)) bad(`motors: ${what} has no effort limit in the file; give {speed, maxForce}.`);
            made.motor = {speed: zero(speed), maxForce: maxForce!};
            if (joint.friction) warn('unsupported', what, `its dry friction (${joint.friction}) is dropped: the joint's one motor is driving it`);
          } else if (joint.friction) made.motor = {speed: 0, maxForce: joint.friction};   // a motor holding zero speed with a force cap is dry friction
          if (made.motor) report.motor = made.motor;

          // The engine's joint spring is a frequency and a damping ratio on the joint's own effective mass m:
          // it acts as stiffness m (2 pi f)^2 and damping 2 m zeta (2 pi f). Solve those for the file's stiffness and damping.
          const sa = a.body === null ? NONE : solver.get(a.body)!, sb = solver.get(b.body)!, wa = frameInWorld(a.body, frameA), wb = frameInWorld(b.body, frameB);
          let k: number;
          if (type === 'revolute') { const axis = qrot(wa.quat, [0, 0, 1]); k = dot(axis, mv(madd(sa.inverseInertia, sb.inverseInertia), axis)); }
          else {
            const axis = qrot(wa.quat, [1, 0, 0]), sAx = cross(a.body === null ? [0, 0, 0] : sub(wb.xyz, sa.centre), axis), sBx = cross(sub(wb.xyz, sb.centre), axis);
            k = sa.inverseMass + sb.inverseMass + dot(sAx, mv(sa.inverseInertia, sAx)) + dot(sBx, mv(sb.inverseInertia, sBx));
          }
          const effective = k > 0 ? 1 / k : 0;
          const stiffness = (joint.stiffness ?? 0) + (joint.servo?.kp ?? 0), damping = (joint.damping ?? 0) + (joint.servo?.kv ?? 0);
          const holds = held !== undefined && (held.joints === undefined || held.joints.includes(joint.name));
          if (holds) {
            if (stiffness > 0 || damping > 0) warn('note', what, 'the hold option replaces the stiffness and damping the file gives this joint');
            made.spring = {hertz: held!.hertz, dampingRatio: held!.dampingRatio ?? 1, target: zero(start)};
            const w = 2 * Math.PI * held!.hertz;
            report.spring = {...made.spring, target: start, stiffness: effective * w * w, damping: 2 * effective * (held!.dampingRatio ?? 1) * w, effectiveMass: effective};
          } else if ((stiffness > 0 || damping > 0) && effective > 0) {
            // Two springs towards two targets are one spring towards their stiffness-weighted mean.
            const target = stiffness > 0 ? ((joint.stiffness ?? 0) * ((joint.springRef ?? 0) - ref) + (joint.servo?.kp ?? 0) * -ref) / stiffness : start;
            const hertz = stiffness > 0 ? Math.sqrt(stiffness / effective) / (2 * Math.PI) : dampingHertz, w = 2 * Math.PI * hertz;
            made.spring = {hertz, dampingRatio: damping / (2 * effective * w), target: zero(target)};
            report.spring = {...made.spring, target, stiffness: effective * w * w, damping, effectiveMass: effective};
            if (!(stiffness > 0)) warn('note', what, `its damping (${+damping.toPrecision(6)}) is carried by a joint spring of ${dampingHertz} Hz, which adds a stiffness of ${+(effective * w * w).toPrecision(3)} towards the starting position`);
          }
        } else if (type === 'spherical') {
          for (const key of ['limits', 'damping', 'stiffness', 'friction'] as const) if (joint[key]) warn('unsupported', `joint "${joint.name}"`, `${key} on a ball joint is not imported`);
        }
        const data: {[key: string]: unknown} = {joint: joint.name};
        if (joint.effort !== undefined) data.effort = joint.effort;
        if (joint.velocity !== undefined) data.velocity = joint.velocity;
        made.userData = data;
        joints.push(made);
      }
    }
    // Hold the link's shapes together: each to the nearest one before it, at the midpoint of their centres.
    if (plan.kind !== 'static') for (let i = 1; i < plan.pieces.length; i++) {
      const piece = plan.pieces[i];
      let nearest = 0, best = Infinity;
      for (let j = 0; j < i; j++) { const distance = Math.hypot(...sub(piece.pose.xyz, plan.pieces[j].pose.xyz)); if (distance < best) { best = distance; nearest = j; } }
      const other = plan.pieces[nearest], middle = pose(scale(add(piece.pose.xyz, other.pose.xyz), 0.5));
      joints.push({id: makeId(`${name}.weld${i + 1}`), type: 'weld', bodyA: other.id, bodyB: piece.id, frameA: frameOf(compose(invert(other.pose), middle)), frameB: frameOf(compose(invert(piece.pose), middle))});
    }
  }

  if (options.jointStiffness) for (let i = 0; i < joints.length; i++) joints[i] = {...joints[i]!, stiffness: options.jointStiffness};

  // The report: what the file asked for against what the bodies are.
  const linkReports: RobotLinkReport[] = [];
  let totalMass = 0, totalMassActual = 0, maxPrincipalError = 0, worstLink: string | null = null;
  for (const name of order) {
    const plan = plans.get(name)!, inertial = plan.link.inertial;
    if (plan.link.isWorld) continue;
    const dynamic = plan.kind !== 'static' && plan.kind !== 'frame', masses = plan.pieces.map(piece => dynamic ? piece.density * piece.volume : 0), actual = masses.reduce((sum, m) => sum + m, 0);
    const report: RobotLinkReport = {link: name, bodies: plan.pieces.map(piece => piece.id), kind: plan.kind, mass: inertial?.mass ?? 0, massActual: actual, volume: plan.pieces.reduce((sum, piece) => sum + piece.volume, 0)};
    if (dynamic) { totalMass += report.mass; totalMassActual += actual; }
    else if (report.mass > 0 && plan.kind === 'frame') warn('note', `link "${name}"`, `its mass (${report.mass} kg) is not simulated: the link has no body`);
    if (dynamic && actual > 0) {
      const com = scale(plan.pieces.reduce((sum, piece, k) => add(sum, scale(piece.pose.xyz, masses[k])), [0, 0, 0] as V3), 1 / actual);
      let tensor: M3 = [0, 0, 0, 0, 0, 0, 0, 0, 0];
      plan.pieces.forEach((piece, k) => { tensor = madd(tensor, madd(rotateTensor(piece.pose.quat, mscale(piece.unit, piece.density)), steiner(masses[k], sub(piece.pose.xyz, com)))); });
      report.comActual = com;
      report.principalActual = eigenSymmetric(tensor).values;
      if (inertial && inertial.mass > 0) {
        const specified = rotateTensor(inertial.origin.quat, tensorOf(inertial.inertia)), wanted = eigenSymmetric(specified).values;
        report.comSpecified = [...inertial.origin.xyz];
        report.comOffset = Math.hypot(...sub(com, inertial.origin.xyz));
        report.principalSpecified = wanted;
        if (wanted[2] > 0) {
          report.principalError = wanted.map((value, i) => Math.abs(report.principalActual![i] - value) / (value > 1e-9 * wanted[2] ? value : wanted[2])) as V3;
          report.maxPrincipalError = Math.max(...report.principalError);
          const about = madd(tensor, steiner(actual, sub(inertial.origin.xyz, com)));
          report.tensorError = Math.hypot(...about.map((value, i) => value - specified[i])) / Math.hypot(...specified);
          if (report.maxPrincipalError > maxPrincipalError) { maxPrincipalError = report.maxPrincipalError; worstLink = name; }
        }
      }
    }
    linkReports.push(report);
  }
  if (worstLink !== null && maxPrincipalError > 0.01) {
    warn('note', `robot "${description.name}"`, `the bodies' inertia differs from the file's by up to ${(maxPrincipalError * 100).toPrecision(3)}% of a principal moment (link "${worstLink}"): the engine derives inertia from each shape and its density, so only the mass is matched. See the report.`);
  }

  const gravityFile = description.world.gravity ?? (up === 'z' ? [0, 0, -9.81] : [0, -9.81, 0]), settings: {-readonly [K in keyof SceneWorld]: SceneWorld[K]} = {gravity: upVector(gravityFile).map(zero) as V3, ground: description.world.ground ?? true};
  const timestep = description.world.timestep;
  if (timestep !== undefined && options.world?.step === undefined) {
    if (timestep <= 1 / 30) settings.step = timestep;
    else warn('note', '<option timestep>', `a timestep of ${timestep} s is longer than the engine's limit of 1/30 s; the default step is used`);
  }
  Object.assign(settings, options.world);

  const links = new Map<string, {body: string | null; bodies: string[]; frame: RobotPose}>();
  for (const name of order) { const plan = plans.get(name)!; links.set(name, {body: plan.carrier.free ? null : plan.carrier.body, bodies: plan.pieces.map(piece => piece.id), frame: plan.carrier.frame}); }
  let extension: {[key: string]: unknown} = {name: description.name, links: Object.fromEntries([...links].map(([name, link]) => [name, {body: link.body, ...frameOf(link.frame)}])), joints: Object.fromEntries(jointIds)};
  if (JSON.stringify(extension).length > 60000) extension = {name: description.name, truncated: true};
  const scene: Scene = {
    format: 'box3d-scene', version: 1, units: 'SI', world: settings, bodies, joints,
    meta: {title: description.name.slice(0, 200), description: `Imported robot: ${bodyLinks.length} link${bodyLinks.length === 1 ? '' : 's'} with bodies, ${jointIds.size} joint${jointIds.size === 1 ? '' : 's'}.`},
    extensions: {robot: extension},
  };
  return {scene, links, joints: jointIds, report: {name: description.name, totalMass, totalMassActual, links: linkReports, shapes, joints: jointReports, maxPrincipalError, worstLink, warnings}};
}

/**
 * A robot description as a scene (docs/SCENE_FORMAT.md), ready for
 * `validateScene`, `loadScene` and share links.
 *
 * - Each link becomes one body per collision shape, placed by forward
 *   kinematics. Several shapes are welded, each to the nearest one before it.
 *   A body's origin is its shape's centre of mass.
 * - Density is mass / collision volume, so the link's mass is the file's. The
 *   inertia is whatever the shapes then have: read `robotReport` for the gap.
 *   A link with mass and no shape becomes a box with the file's exact mass and
 *   inertia that collides with nothing.
 * - fixed -> weld; revolute and continuous -> revolute about the joint axis;
 *   prismatic -> prismatic; ball -> spherical; floating -> no joint.
 * - Body ids are link names and joint ids are joint names (characters outside
 *   letters, digits and `_ . : -` become `_`). `extensions.robot` maps every
 *   link to its body and the link frame in that body's coordinates.
 */
export function robotToScene(description: RobotDescription, options: RobotSceneOptions = {}): Scene { return buildPlan(description, options).scene; }

/** What `robotToScene` does to the robot, in numbers: per-link mass and inertia against the file, shape stand-ins with their errors, the joint mapping and every warning. */
export function robotReport(description: RobotDescription, options: RobotSceneOptions = {}): RobotReport { return buildPlan(description, options).report; }

/** The part of a world `spawnRobot` uses. `B` and `J` are its body and joint handles. */
export interface RobotHost<B = NativeBodyHandle, J = NativeJointHandle> {
  createBody(options: NativeBodyDescriptor): B | null;
  createJoint(options: Omit<NativeJointDescriptor, 'bodyA' | 'bodyB'> & {readonly bodyA: B | null; readonly bodyB: B | null}): J;
  destroyBody?(body: B): unknown;
}
export interface RobotLinkHandle<B = NativeBodyHandle> {
  /** The body that carries the link frame; null when the link is fixed to the world or has no body. */
  body: B | null;
  /** Every body of the link. */
  bodies: B[];
  /** The link frame in `body`'s coordinates (in world coordinates when `body` is null). See `robotLinkPose`. */
  frame: {position: [number, number, number]; rotation: [number, number, number, number]};
}
export interface SpawnedRobot<B = NativeBodyHandle, J = NativeJointHandle> {
  links: Map<string, RobotLinkHandle<B>>;
  /** Joint handles by the robot's joint names. Joints that needed no constraint are absent. */
  joints: Map<string, J>;
  /** Every body and joint by scene id, welds included. */
  bodies: Map<string, B>;
  allJoints: Map<string, J>;
  /** The scene the robot was built from: the same bodies and joints `robotToScene` gives. */
  scene: Scene;
  report: RobotReport;
}

/**
 * Add a robot to a world that already exists, without resetting it, and return
 * handles by link and joint name. The bodies and joints are those of
 * `robotToScene`, created in the same order, so a world built this way steps
 * exactly like one loaded from the scene. The scene's world settings (gravity,
 * ground, step) are NOT applied: the world keeps its own.
 */
export function spawnRobot<B = NativeBodyHandle, J = NativeJointHandle>(world: RobotHost<B, J>, description: RobotDescription, options: RobotSceneOptions = {}): SpawnedRobot<B, J> {
  const plan = buildPlan(description, options), bodies = new Map<string, B>(), allJoints = new Map<string, J>();
  for (const body of plan.scene.bodies) {
    const filter = body.filter;
    let handle: B | null;
    try {
      handle = world.createBody({
        shape: body.shape, type: body.type, position: body.position, rotation: body.rotation, density: body.density, friction: body.friction, restitution: body.restitution, color: body.color, neverSleeps: body.neverSleeps,
        filter: filter ? {categoryBits: filter.categoryBits !== undefined ? BigInt(filter.categoryBits) : undefined, maskBits: filter.maskBits !== undefined ? BigInt(filter.maskBits) : undefined, groupIndex: filter.groupIndex} : undefined,
      });
    } catch (error) {
      for (const made of bodies.values()) world.destroyBody?.(made);
      throw new EngineError(error instanceof EngineError ? error.code : 'INTERNAL', `Robot body "${body.id}": ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!handle) {
      for (const made of bodies.values()) world.destroyBody?.(made);
      throw new EngineError('WORLD_CAPACITY', `Robot body "${body.id}": the world is at body capacity.`);
    }
    bodies.set(body.id, handle);
  }
  for (const joint of plan.scene.joints ?? []) {
    try {
      allJoints.set(joint.id, world.createJoint({
        type: joint.type, bodyA: joint.bodyA === null ? null : bodies.get(joint.bodyA)!, bodyB: joint.bodyB === null ? null : bodies.get(joint.bodyB)!,
        frameA: joint.frameA, frameB: joint.frameB, limits: joint.limits, motor: joint.motor, spring: joint.spring, stiffness: joint.stiffness,
      }));
    } catch (error) {
      for (const made of bodies.values()) world.destroyBody?.(made);
      throw new EngineError(error instanceof EngineError ? error.code : 'INTERNAL', `Robot joint "${joint.id}": ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const links = new Map<string, RobotLinkHandle<B>>();
  for (const [name, link] of plan.links) links.set(name, {body: link.body === null ? null : bodies.get(link.body)!, bodies: link.bodies.map(id => bodies.get(id)!), frame: {position: [...link.frame.xyz], rotation: [...link.frame.quat]}});
  const joints = new Map<string, J>();
  for (const [name, id] of plan.joints) joints.set(name, allJoints.get(id)!);
  return {links, joints, bodies, allJoints, scene: plan.scene, report: plan.report};
}

/**
 * World pose of a link frame from the state of the body that carries it:
 * `robotLinkPose(world.getState(link.body), link.frame)`. With `body` null the
 * frame already is the world pose.
 */
export function robotLinkPose(body: {readonly position: readonly number[]; readonly rotation: readonly number[]} | null, frame: {readonly position: readonly number[]; readonly rotation: readonly number[]}): {position: [number, number, number]; rotation: [number, number, number, number]} {
  const at = body ? compose(pose(body.position, body.rotation), pose(frame.position, frame.rotation)) : pose(frame.position, frame.rotation);
  return {position: at.xyz, rotation: at.quat};
}

// ---------------------------------------------------------------------------
// Example robots
// ---------------------------------------------------------------------------

const f = (value: number): string => String(+value.toPrecision(12));
/** Inertia of a solid box about its centre, as URDF attributes. */
const boxInertia = (m: number, x: number, y: number, z: number, k = 1): string =>
  `ixx="${f(k * m * (y * y + z * z) / 12)}" ixy="0" ixz="0" iyy="${f(k * m * (x * x + z * z) / 12)}" iyz="0" izz="${f(k * m * (x * x + y * y) / 12)}"`;
/** Inertia of a solid cylinder whose axis is z. */
const cylinderInertia = (m: number, r: number, l: number, k = 1): string => { const a = f(k * m * (3 * r * r + l * l) / 12); return `ixx="${a}" ixy="0" ixz="0" iyy="${a}" iyz="0" izz="${f(k * m * r * r / 2)}"`; };

export interface DoublePendulumOptions { length1?: number; length2?: number; mass1?: number; mass2?: number; width?: number; height?: number }
const pendulumDefaults = (o: DoublePendulumOptions): Required<DoublePendulumOptions> => ({length1: o.length1 ?? 0.5, length2: o.length2 ?? 0.4, mass1: o.mass1 ?? 1, mass2: o.mass2 ?? 0.6, width: o.width ?? 0.05, height: o.height ?? 1.5});

/** A double pendulum as URDF: two box rods on hinges about y, hanging from the world at `height`. Each rod's inertial is that of its box, so the import reproduces it exactly. */
export function doublePendulumURDF(options: DoublePendulumOptions = {}): string {
  const {length1: a, length2: b, mass1, mass2, width: w, height} = pendulumDefaults(options);
  const rod = (name: string, m: number, l: number): string => `  <link name="${name}">
    <inertial><origin xyz="0 0 ${f(-l / 2)}"/><mass value="${f(m)}"/><inertia ${boxInertia(m, w, w, l)}/></inertial>
    <collision><origin xyz="0 0 ${f(-l / 2)}"/><geometry><box size="${f(w)} ${f(w)} ${f(l)}"/></geometry></collision>
  </link>`;
  return `<?xml version="1.0"?>
<robot name="double-pendulum">
  <link name="world"/>
  <joint name="shoulder" type="continuous"><parent link="world"/><child link="upper"/><origin xyz="0 0 ${f(height)}"/><axis xyz="0 1 0"/></joint>
${rod('upper', mass1, a)}
  <joint name="elbow" type="continuous"><parent link="upper"/><child link="lower"/><origin xyz="0 0 ${f(-a)}"/><axis xyz="0 1 0"/></joint>
${rod('lower', mass2, b)}
</robot>
`;
}

/** The same double pendulum as MJCF. `robotToScene` gives the same scene for both (the ground plane and the friction of 0.6 are written out because MJCF's defaults differ from URDF's). */
export function doublePendulumMJCF(options: DoublePendulumOptions = {}): string {
  const {length1: a, length2: b, mass1, mass2, width: w, height} = pendulumDefaults(options);
  const rod = (m: number, l: number): string => `<inertial pos="0 0 ${f(-l / 2)}" mass="${f(m)}" diaginertia="${f(m * (w * w + l * l) / 12)} ${f(m * (w * w + l * l) / 12)} ${f(m * w * w / 6)}"/>
      <geom type="box" pos="0 0 ${f(-l / 2)}" size="${f(w / 2)} ${f(w / 2)} ${f(l / 2)}"/>`;
  return `<mujoco model="double-pendulum">
  <compiler angle="radian"/>
  <default><geom friction="0.6"/></default>
  <worldbody>
    <geom name="floor" type="plane" size="5 5 0.1"/>
    <body name="upper" pos="0 0 ${f(height)}">
      <joint name="shoulder" type="hinge" axis="0 1 0"/>
      ${rod(mass1, a)}
      <body name="lower" pos="0 0 ${f(-a)}">
        <joint name="elbow" type="hinge" axis="0 1 0"/>
        ${rod(mass2, b)}
      </body>
    </body>
  </worldbody>
</mujoco>
`;
}

/** A planar two-link arm as URDF: a base post and two cylinder links along x, on limited hinges about y. Link lengths 0.4 m and 0.3 m. */
export function twoLinkArmURDF(options: {length1?: number; length2?: number} = {}): string {
  const a = options.length1 ?? 0.4, b = options.length2 ?? 0.3, r = 0.03;
  const link = (name: string, m: number, l: number): string => `  <link name="${name}">
    <inertial><origin xyz="${f(l / 2)} 0 0" rpy="0 1.57079632679 0"/><mass value="${f(m)}"/><inertia ${cylinderInertia(m, r, l)}/></inertial>
    <collision><origin xyz="${f(l / 2)} 0 0" rpy="0 1.57079632679 0"/><geometry><cylinder radius="${f(r)}" length="${f(l)}"/></geometry></collision>
  </link>`;
  return `<?xml version="1.0"?>
<robot name="two-link-arm">
  <link name="base">
    <inertial><origin xyz="0 0 0.25"/><mass value="5"/><inertia ${boxInertia(5, 0.1, 0.1, 0.5)}/></inertial>
    <collision><origin xyz="0 0 0.25"/><geometry><box size="0.1 0.1 0.5"/></geometry></collision>
  </link>
  <joint name="shoulder" type="revolute"><parent link="base"/><child link="upper_arm"/><origin xyz="0 0.1 0.5"/><axis xyz="0 1 0"/><limit lower="-2.6" upper="2.6" effort="40" velocity="3"/></joint>
${link('upper_arm', 2, a)}
  <joint name="elbow" type="revolute"><parent link="upper_arm"/><child link="forearm"/><origin xyz="${f(a)} 0.08 0"/><axis xyz="0 1 0"/><limit lower="-2.4" upper="2.4" effort="20" velocity="4"/></joint>
${link('forearm', 1.2, b)}
</robot>
`;
}

/** A pendulum on a cart as URDF: a box cart on a prismatic rail along x, 1.5 m up, and a box pole hanging from it on a free hinge about y. */
export function cartPoleURDF(options: {cartMass?: number; poleMass?: number; poleLength?: number} = {}): string {
  const M = options.cartMass ?? 1, m = options.poleMass ?? 0.2, l = options.poleLength ?? 1, w = 0.04;
  return `<?xml version="1.0"?>
<robot name="cart-pole">
  <link name="world"/>
  <joint name="slider" type="prismatic"><parent link="world"/><child link="cart"/><origin xyz="0 0 1.5"/><axis xyz="1 0 0"/><limit lower="-2" upper="2" effort="100" velocity="10"/></joint>
  <link name="cart">
    <inertial><mass value="${f(M)}"/><inertia ${boxInertia(M, 0.4, 0.3, 0.2)}/></inertial>
    <collision><geometry><box size="0.4 0.3 0.2"/></geometry></collision>
  </link>
  <joint name="hinge" type="continuous"><parent link="cart"/><child link="pole"/><origin xyz="0 0.2 0"/><axis xyz="0 1 0"/></joint>
  <link name="pole">
    <inertial><origin xyz="0 0 ${f(-l / 2)}"/><mass value="${f(m)}"/><inertia ${boxInertia(m, w, w, l)}/></inertial>
    <collision><origin xyz="0 0 ${f(-l / 2)}"/><geometry><box size="${f(w)} ${f(w)} ${f(l)}"/></geometry></collision>
  </link>
</robot>
`;
}

/**
 * A serial six-joint arm as URDF, from boxes, cylinders and a sphere: yaw,
 * shoulder, elbow, forearm roll, wrist pitch, tool roll. Joint origins carry
 * roll, pitch and yaw offsets and the tool has two collision shapes, so the
 * file exercises the conventions. Its inertia tensors are deliberately not
 * those of the collision shapes (they are scaled as a CAD export's would
 * differ), which shows up in `robotReport`.
 */
export function sixDofArmURDF(): string {
  return `<?xml version="1.0"?>
<robot name="six-dof-arm">
  <material name="steel"><color rgba="0.55 0.6 0.68 1"/></material>
  <link name="base">
    <visual><geometry><cylinder radius="0.12" length="0.1"/></geometry><material name="steel"/></visual>
    <inertial><origin xyz="0 0 0.05"/><mass value="6"/><inertia ${cylinderInertia(6, 0.12, 0.1)}/></inertial>
    <collision><origin xyz="0 0 0.05"/><geometry><cylinder radius="0.12" length="0.1"/></geometry></collision>
  </link>
  <joint name="yaw" type="revolute"><parent link="base"/><child link="turret"/><origin xyz="0 0 0.1"/><axis xyz="0 0 1"/><limit lower="-3" upper="3" effort="150" velocity="2"/><dynamics damping="0.5"/></joint>
  <link name="turret">
    <inertial><origin xyz="0 0 0.1"/><mass value="4"/><inertia ${cylinderInertia(4, 0.07, 0.2, 1.15)}/></inertial>
    <collision><origin xyz="0 0 0.1"/><geometry><cylinder radius="0.07" length="0.2"/></geometry></collision>
  </link>
  <joint name="shoulder" type="revolute"><parent link="turret"/><child link="upper_arm"/><origin xyz="0 0.09 0.2" rpy="0 0.3 0"/><axis xyz="0 1 0"/><limit lower="-2" upper="2" effort="150" velocity="2"/></joint>
  <link name="upper_arm">
    <inertial><origin xyz="0 0 0.2"/><mass value="3"/><inertia ${boxInertia(3, 0.08, 0.08, 0.4, 0.9)}/></inertial>
    <collision><origin xyz="0 0 0.2"/><geometry><box size="0.08 0.08 0.4"/></geometry></collision>
  </link>
  <joint name="elbow" type="revolute"><parent link="upper_arm"/><child link="forearm"/><origin xyz="0 -0.08 0.4" rpy="0 0.9 0"/><axis xyz="0 1 0"/><limit lower="-2.5" upper="2.5" effort="80" velocity="3"/></joint>
  <link name="forearm">
    <inertial><origin xyz="0 0 0.15"/><mass value="2"/><inertia ${boxInertia(2, 0.06, 0.06, 0.3, 1.1)}/></inertial>
    <collision><origin xyz="0 0 0.15"/><geometry><box size="0.06 0.06 0.3"/></geometry></collision>
  </link>
  <joint name="forearm_roll" type="revolute"><parent link="forearm"/><child link="wrist"/><origin xyz="0 0 0.3" rpy="0.2 0 0.4"/><axis xyz="0 0 1"/><limit lower="-3" upper="3" effort="30" velocity="4"/></joint>
  <link name="wrist">
    <inertial><origin xyz="0 0 0.06"/><mass value="1"/><inertia ${cylinderInertia(1, 0.04, 0.12, 0.85)}/></inertial>
    <collision><origin xyz="0 0 0.06"/><geometry><cylinder radius="0.04" length="0.12"/></geometry></collision>
  </link>
  <joint name="wrist_pitch" type="revolute"><parent link="wrist"/><child link="hand"/><origin xyz="0 0 0.12" rpy="0 0.5 0"/><axis xyz="0 1 0"/><limit lower="-2" upper="2" effort="30" velocity="4"/></joint>
  <link name="hand">
    <inertial><origin xyz="0 0 0.05"/><mass value="0.5"/><inertia ixx="0.0004" ixy="0" ixz="0" iyy="0.0004" iyz="0" izz="0.0004"/></inertial>
    <collision><origin xyz="0 0 0.05"/><geometry><sphere radius="0.045"/></geometry></collision>
  </link>
  <joint name="tool_roll" type="revolute"><parent link="hand"/><child link="tool"/><origin xyz="0 0 0.095" rpy="0 0 0.3"/><axis xyz="0 0 1"/><limit lower="-3" upper="3" effort="10" velocity="6"/></joint>
  <link name="tool">
    <inertial><origin xyz="0.012 0 0.035"/><mass value="0.3"/><inertia ixx="0.0003" ixy="0" ixz="-0.00003" iyy="0.00035" iyz="0" izz="0.0002"/></inertial>
    <collision name="palm"><origin xyz="0 0 0.02"/><geometry><box size="0.1 0.06 0.04"/></geometry></collision>
    <collision name="finger"><origin xyz="0.04 0 0.07"/><geometry><box size="0.02 0.06 0.06"/></geometry></collision>
  </link>
</robot>
`;
}

/**
 * A four-wheeled cart as URDF: a box chassis and four cylinder wheels on
 * continuous joints about y. The robot's origin is on the ground under the
 * chassis centre. Build it with `floatingBase: true`, or it is welded down.
 */
export function wheeledCartURDF(options: {wheelRadius?: number; wheelMass?: number; chassisMass?: number} = {}): string {
  const r = options.wheelRadius ?? 0.1, mw = options.wheelMass ?? 0.5, mc = options.chassisMass ?? 5, width = 0.04;
  const wheel = (name: string, x: number, y: number): string => `  <joint name="${name}_axle" type="continuous"><parent link="chassis"/><child link="${name}"/><origin xyz="${f(x)} ${f(y)} ${f(r)}"/><axis xyz="0 1 0"/><limit effort="5" velocity="20"/></joint>
  <link name="${name}">
    <inertial><origin rpy="1.57079632679 0 0"/><mass value="${f(mw)}"/><inertia ${cylinderInertia(mw, r, width)}/></inertial>
    <collision><origin rpy="1.57079632679 0 0"/><geometry><cylinder radius="${f(r)}" length="${f(width)}"/></geometry></collision>
  </link>`;
  return `<?xml version="1.0"?>
<robot name="wheeled-cart">
  <link name="chassis">
    <inertial><origin xyz="0 0 ${f(r + 0.05)}"/><mass value="${f(mc)}"/><inertia ${boxInertia(mc, 0.5, 0.3, 0.1)}/></inertial>
    <collision><origin xyz="0 0 ${f(r + 0.05)}"/><geometry><box size="0.5 0.3 0.1"/></geometry></collision>
  </link>
${wheel('front_left', 0.18, 0.19)}
${wheel('front_right', 0.18, -0.19)}
${wheel('rear_left', -0.18, 0.19)}
${wheel('rear_right', -0.18, -0.19)}
</robot>
`;
}

/** A chain of `links` capsule links (0.2 m each) on free hinges about y, hanging from the world: a long serial chain for measuring joint drift. */
export function hangingChainURDF(links = 12): string {
  if (!Number.isInteger(links) || links < 1 || links > 64) bad('links must be an integer from 1 to 64.');
  const l = 0.2, r = 0.02, m = 0.25, parts: string[] = ['  <link name="world"/>'];
  for (let k = 1; k <= links; k++) {
    parts.push(`  <joint name="hinge${k}" type="continuous"><parent link="${k === 1 ? 'world' : `link${k - 1}`}"/><child link="link${k}"/><origin xyz="0 0 ${k === 1 ? f(links * l + 0.5) : f(-l)}"/><axis xyz="0 1 0"/></joint>
  <link name="link${k}">
    <inertial><origin xyz="0 0 ${f(-l / 2)}"/><mass value="${f(m)}"/><inertia ${cylinderInertia(m, r, l)}/></inertial>
    <collision><origin xyz="0 0 ${f(-l / 2)}"/><geometry><capsule radius="${f(r)}" length="${f(l - 2 * r)}"/></geometry></collision>
  </link>`);
  }
  return `<?xml version="1.0"?>\n<robot name="hanging-chain">\n${parts.join('\n')}\n</robot>\n`;
}

/** Every example robot by name: its format and a function that returns the file text with the defaults. */
export const EXAMPLE_ROBOTS: {readonly [name: string]: {readonly format: 'urdf' | 'mjcf'; readonly text: () => string}} = Object.freeze({
  'two-link-arm': {format: 'urdf', text: () => twoLinkArmURDF()},
  'cart-pole': {format: 'urdf', text: () => cartPoleURDF()},
  'six-dof-arm': {format: 'urdf', text: () => sixDofArmURDF()},
  'wheeled-cart': {format: 'urdf', text: () => wheeledCartURDF()},
  'double-pendulum': {format: 'urdf', text: () => doublePendulumURDF()},
  'double-pendulum-mjcf': {format: 'mjcf', text: () => doublePendulumMJCF()},
  'hanging-chain': {format: 'urdf', text: () => hangingChainURDF()},
} as const);
