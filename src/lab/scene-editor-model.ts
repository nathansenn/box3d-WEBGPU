/**
 * The scene editor's model: an editing document over a scene in the
 * box3d-scene format (src/engine/scene-format.ts), with commands, undo and
 * redo, and the pure helpers the editor's view needs (shape presets, terrain
 * functions, the materials table, snapping, picking rays, joint frames, step
 * warnings, a measurement series with CSV export, autosave records).
 *
 * Nothing here touches the DOM or the physics world, so it runs in node
 * (tests/physics/scene-editor.test.mjs).
 *
 * The document always holds a valid scene. A command builds a candidate scene,
 * the format's own `validateScene` checks it, and only a candidate without
 * problems replaces the current scene; otherwise the command is refused with
 * the validator's message and nothing changes. Every numeric value the editor
 * writes is rounded to the shortest decimal of its float32 (`shortFloat32`),
 * because float32 is what the rigid solver stores.
 */
import {
  SCENE_LIMITS, canonicalize, eulerToQuaternion, normalizeScene, sceneHasCoupling, validateScene,
  type Scene, type SceneBody, type SceneBodyType, type SceneFilter, type SceneFrame, type SceneJoint, type SceneJointType, type SceneMaterial,
  type SceneProblem, type SceneShape, type SceneWorld,
} from '../engine/scene-format.ts';
import { shortFloat32 } from './scene-loading.ts';

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

const f32 = shortFloat32;
const v3 = (v: ArrayLike<number>): [number, number, number] => [f32(v[0]!), f32(v[1]!), f32(v[2]!)];
const q4 = (q: ArrayLike<number>): [number, number, number, number] => [f32(q[0]!), f32(q[1]!), f32(q[2]!), f32(q[3]!)];

// ---------------------------------------------------------------------------
// Vectors and quaternions ([x, y, z, w])
// ---------------------------------------------------------------------------

export const IDENTITY: Quat = Object.freeze([0, 0, 0, 1]) as Quat;
export const add3 = (a: Vec3, b: Vec3): [number, number, number] => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: Vec3, b: Vec3): [number, number, number] => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale3 = (a: Vec3, s: number): [number, number, number] => [a[0] * s, a[1] * s, a[2] * s];
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a: Vec3, b: Vec3): [number, number, number] => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const length3 = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);
export function normalize3(a: Vec3): [number, number, number] | null {
  const n = length3(a);
  return n > 1e-12 && Number.isFinite(n) ? [a[0] / n, a[1] / n, a[2] / n] : null;
}
export function quatMultiply(a: Quat, b: Quat): [number, number, number, number] {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
export const quatConjugate = (q: Quat): [number, number, number, number] => [-q[0], -q[1], -q[2], q[3]];
export function quatRotate(q: Quat, v: Vec3): [number, number, number] {
  const u: Vec3 = [q[0], q[1], q[2]], t = scale3(cross3(u, v), 2);
  return add3(add3(v, scale3(t, q[3])), cross3(u, t));
}

/**
 * Degrees about X, Y, Z for a quaternion, the inverse of the format's
 * `eulerToQuaternion` (q = qx qy qz). At the gimbal pole (Y = +-90 degrees) Z is 0.
 */
export function quaternionToEuler(q: Quat): [number, number, number] {
  const n = Math.hypot(q[0], q[1], q[2], q[3]) || 1, x = q[0] / n, y = q[1] / n, z = q[2] / n, w = q[3] / n;
  const m11 = 1 - 2 * (y * y + z * z), m12 = 2 * (x * y - z * w), m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z), m23 = 2 * (y * z - x * w), m32 = 2 * (y * z + x * w), m33 = 1 - 2 * (x * x + y * y);
  const k = 180 / Math.PI, ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  const clean = (value: number): number => { const r = Math.round(value * k * 1e4) / 1e4; return r === 0 ? 0 : r; };
  if (Math.abs(m13) < 0.9999999) return [clean(Math.atan2(-m23, m33)), clean(ey), clean(Math.atan2(-m12, m11))];
  return [clean(Math.atan2(m32, m22)), clean(ey), 0];
}

/** A unit quaternion whose rotation has the given orthonormal, right-handed columns. */
function quatFromBasis(x: Vec3, y: Vec3, z: Vec3): [number, number, number, number] {
  const m00 = x[0], m10 = x[1], m20 = x[2], m01 = y[0], m11 = y[1], m21 = y[2], m02 = z[0], m12 = z[1], m22 = z[2];
  const trace = m00 + m11 + m22;
  let q: [number, number, number, number];
  if (trace > 0) { const s = Math.sqrt(trace + 1) * 2; q = [(m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4]; }
  else if (m00 > m11 && m00 > m22) { const s = Math.sqrt(1 + m00 - m11 - m22) * 2; q = [s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s]; }
  else if (m11 > m22) { const s = Math.sqrt(1 + m11 - m00 - m22) * 2; q = [(m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s]; }
  else { const s = Math.sqrt(1 + m22 - m00 - m11) * 2; q = [(m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s]; }
  const n = Math.hypot(q[0], q[1], q[2], q[3]);
  return [q[0] / n, q[1] / n, q[2] / n, q[3] / n];
}

/** The unit vector perpendicular to `axis` that is closest to `prefer` (or to the next world axis when they are parallel). */
function perpendicular(axis: Vec3, prefer: Vec3): [number, number, number] {
  for (const candidate of [prefer, [1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) {
    const rejected = sub3(candidate, scale3(axis, dot3(candidate, axis)));
    if (length3(rejected) > 1e-3) return normalize3(rejected)!;
  }
  return [1, 0, 0];
}

// ---------------------------------------------------------------------------
// Materials, gravity
// ---------------------------------------------------------------------------

export interface MaterialPreset {
  /** The key written to `scene.materials`. */
  readonly name: string;
  readonly label: string;
  /** Typical values, used when the preset is picked. */
  readonly density: number;
  readonly friction: number;
  readonly restitution: number;
  readonly color: number;
  /** The published range each typical value was taken from; see docs/SCENE_EDITOR.md for the sources. */
  readonly densityRange: readonly [number, number];
  readonly frictionRange: readonly [number, number];
  readonly restitutionRange: readonly [number, number];
}

/**
 * Typical handbook values, not measurements of this project and not a
 * calibrated material library. Friction is for the dry material sliding on
 * itself (or on steel, for aluminium; on dry concrete, for rubber);
 * restitution is for a compact body on a hard surface at about 1 m/s and
 * falls with speed. docs/SCENE_EDITOR.md gives the table with its sources.
 */
export const MATERIAL_PRESETS: readonly MaterialPreset[] = Object.freeze(([
  { name: 'steel', label: 'Steel', density: 7850, friction: 0.6, restitution: 0.6, color: 0x9AA4AE, densityRange: [7750, 8050], frictionRange: [0.42, 0.8], restitutionRange: [0.5, 0.9] },
  { name: 'aluminium', label: 'Aluminium', density: 2700, friction: 0.5, restitution: 0.5, color: 0xC9CED3, densityRange: [2640, 2810], frictionRange: [0.47, 0.61], restitutionRange: [0.4, 0.75] },
  { name: 'concrete', label: 'Concrete', density: 2400, friction: 0.6, restitution: 0.2, color: 0x8C8F8A, densityRange: [2200, 2500], frictionRange: [0.5, 1.0], restitutionRange: [0.1, 0.3] },
  { name: 'wood', label: 'Wood', density: 600, friction: 0.4, restitution: 0.45, color: 0xB07A45, densityRange: [350, 900], frictionRange: [0.2, 0.5], restitutionRange: [0.3, 0.6] },
  { name: 'rubber', label: 'Rubber', density: 1100, friction: 0.9, restitution: 0.8, color: 0x2F3336, densityRange: [920, 1500], frictionRange: [0.6, 1.0], restitutionRange: [0.6, 0.9] },
  { name: 'ice', label: 'Ice', density: 917, friction: 0.05, restitution: 0.3, color: 0xBFE3F2, densityRange: [900, 920], frictionRange: [0.02, 0.1], restitutionRange: [0.1, 0.9] },
  { name: 'glass', label: 'Glass', density: 2500, friction: 0.5, restitution: 0.65, color: 0x9FD3C7, densityRange: [2400, 2800], frictionRange: [0.4, 0.94], restitutionRange: [0.5, 0.95] },
] as MaterialPreset[]).map(preset => Object.freeze(preset)));

export function materialPreset(name: string): MaterialPreset | null {
  return MATERIAL_PRESETS.find(preset => preset.name === name) ?? null;
}

/** Engine defaults for a body that names no material and gives no value (docs/SCENE_FORMAT.md). */
export const BODY_DEFAULTS = Object.freeze({ density: 1000, friction: 0.6, restitution: 0, color: 0xB8C0CC });

/** The density, friction and restitution a body is built with: inline values over its material over the defaults. */
export function resolvedMaterial(scene: Scene, body: SceneBody): { density: number; friction: number; restitution: number; color: number } {
  const table = body.material !== undefined && scene.materials && Object.hasOwn(scene.materials, body.material) ? scene.materials[body.material] : undefined;
  return {
    density: body.density ?? table?.density ?? BODY_DEFAULTS.density,
    friction: body.friction ?? table?.friction ?? BODY_DEFAULTS.friction,
    restitution: body.restitution ?? table?.restitution ?? BODY_DEFAULTS.restitution,
    color: body.color ?? table?.color ?? BODY_DEFAULTS.color,
  };
}

export interface GravityPreset { readonly id: string; readonly label: string; readonly gravity: Vec3 }
/** Surface gravity in m/s^2. Earth is the project's 9.81 (standard gravity is 9.80665). */
export const GRAVITY_PRESETS: readonly GravityPreset[] = Object.freeze([
  { id: 'earth', label: 'Earth (9.81 m/s²)', gravity: [0, -9.81, 0] },
  { id: 'moon', label: 'Moon (1.62 m/s²)', gravity: [0, -1.62, 0] },
  { id: 'mars', label: 'Mars (3.72 m/s²)', gravity: [0, -3.72, 0] },
  { id: 'zero', label: 'Zero gravity', gravity: [0, 0, 0] },
] as GravityPreset[]);

/** The id of the gravity preset a vector equals, or 'custom'. */
export function gravityPresetOf(gravity: Vec3): string {
  return GRAVITY_PRESETS.find(preset => preset.gravity.every((value, k) => value === gravity[k]))?.id ?? 'custom';
}

// ---------------------------------------------------------------------------
// Shape presets
// ---------------------------------------------------------------------------

export type TerrainFunction = 'flat' | 'slope' | 'hills';
export type BodyPresetId = 'box' | 'sphere' | 'capsule' | 'wedge' | 'cylinder' | 'cone' | 'ramp' | 'terrain-flat' | 'terrain-slope' | 'terrain-hills';

/** What a generated shape was made from. Kept in `userData.editor` of hull, mesh and height-field bodies so the sizes stay editable. */
export type GeneratedShape =
  | { readonly preset: 'wedge'; readonly size: Vec3 }
  | { readonly preset: 'cylinder'; readonly radius: number; readonly height: number }
  | { readonly preset: 'cone'; readonly radius: number; readonly height: number }
  | { readonly preset: 'ramp'; readonly length: number; readonly height: number; readonly width: number }
  | { readonly preset: 'terrain'; readonly fn: TerrainFunction; readonly countX: number; readonly countZ: number; readonly spacing: number; readonly amplitude: number; readonly seed: number };

export const BODY_PRESETS: readonly { readonly id: BodyPresetId; readonly label: string; readonly base: string }[] = Object.freeze([
  { id: 'box', label: 'Box', base: 'box' },
  { id: 'sphere', label: 'Sphere', base: 'sphere' },
  { id: 'capsule', label: 'Capsule', base: 'capsule' },
  { id: 'wedge', label: 'Wedge (hull)', base: 'wedge' },
  { id: 'cylinder', label: 'Cylinder (hull)', base: 'cylinder' },
  { id: 'cone', label: 'Cone (hull)', base: 'cone' },
  { id: 'ramp', label: 'Ramp (static mesh)', base: 'ramp' },
  { id: 'terrain-flat', label: 'Terrain: flat (height field)', base: 'terrain' },
  { id: 'terrain-slope', label: 'Terrain: slope (height field)', base: 'terrain' },
  { id: 'terrain-hills', label: 'Terrain: hills (height field)', base: 'terrain' },
]);

/** Sides of the ring of a cylinder or cone hull. Box3D keeps at most 64 hull vertices; a cylinder uses 32. */
export const ROUND_SEGMENTS = 16;
// cos and sin of 2 pi / 16 as literals, so the ring is built by arithmetic alone and is the same on every machine.
const RING_COS = 0.9238795325112867, RING_SIN = 0.3826834323650898;

function ring(radius: number): number[][] {
  const points: number[][] = [];
  let x = 1, z = 0;
  for (let k = 0; k < ROUND_SEGMENTS; k++) {
    points.push([f32(x * radius), f32(z * radius)]);
    const nx = x * RING_COS - z * RING_SIN; z = x * RING_SIN + z * RING_COS; x = nx;
  }
  return points;
}

/** A deterministic generator in [0, 1) (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Heights of a terrain, `countX * countZ` values in metres (index `x + z * countX`).
 *
 *   flat:  every height is 0.
 *   slope: rises linearly along +x from 0 to `amplitude`.
 *   hills: two octaves of seeded value noise (lattices of 4 and 8 cells across the
 *          longer side, smoothstep interpolation), scaled to span 0 to `amplitude`.
 *
 * Only +, -, * and / are used, so the same arguments give the same numbers on every machine.
 */
export function terrainHeights(fn: TerrainFunction, countX: number, countZ: number, amplitude: number, seed = 1): number[] {
  if (!Number.isInteger(countX) || !Number.isInteger(countZ) || countX < 2 || countZ < 2 || countX > SCENE_LIMITS.heightfieldSide || countZ > SCENE_LIMITS.heightfieldSide) {
    throw new EditorError(`A terrain has 2 to ${SCENE_LIMITS.heightfieldSide} samples along each side.`);
  }
  if (!Number.isFinite(amplitude)) throw new EditorError('The terrain height must be a number.');
  const heights = new Array<number>(countX * countZ).fill(0);
  if (fn === 'flat') return heights;
  if (fn === 'slope') {
    for (let z = 0; z < countZ; z++) for (let x = 0; x < countX; x++) heights[x + z * countX] = f32(amplitude * x / (countX - 1));
    return heights;
  }
  const next = random(seed), span = Math.max(countX, countZ) - 1;
  const raw = new Array<number>(countX * countZ).fill(0);
  let weight = 1;
  for (const cells of [4, 8]) {
    const side = cells + 1, lattice: number[] = [];
    for (let i = 0; i < side * side; i++) lattice.push(next());
    for (let z = 0; z < countZ; z++) {
      for (let x = 0; x < countX; x++) {
        const gx = x / span * cells, gz = z / span * cells, ix = Math.min(cells - 1, Math.floor(gx)), iz = Math.min(cells - 1, Math.floor(gz));
        const tx = gx - ix, tz = gz - iz, sx = tx * tx * (3 - 2 * tx), sz = tz * tz * (3 - 2 * tz);
        const a = lattice[ix + iz * side]!, b = lattice[ix + 1 + iz * side]!, c = lattice[ix + (iz + 1) * side]!, d = lattice[ix + 1 + (iz + 1) * side]!;
        raw[x + z * countX]! += weight * ((a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sz);
      }
    }
    weight /= 2;
  }
  let low = Infinity, high = -Infinity;
  for (const value of raw) { if (value < low) low = value; if (value > high) high = value; }
  const range = high - low;
  for (let i = 0; i < raw.length; i++) heights[i] = range > 0 ? f32(amplitude * (raw[i]! - low) / range) : 0;
  return heights;
}

/** The shape of a generated preset. Throws EditorError for sizes that cannot be built. */
export function generateShape(spec: GeneratedShape): SceneShape {
  const positive = (value: number, what: string): number => {
    if (!(value > 0) || !Number.isFinite(value)) throw new EditorError(`${what} must be a number above 0.`);
    return value;
  };
  switch (spec.preset) {
    case 'wedge': {
      // A right triangular prism: the slope rises along +x to the full height at x = +sx / 2.
      const hx = positive(spec.size[0], 'The wedge length') / 2, hy = positive(spec.size[1], 'The wedge height') / 2, hz = positive(spec.size[2], 'The wedge width') / 2;
      return { kind: 'hull', points: [-hx, -hy, -hz, hx, -hy, -hz, hx, hy, -hz, -hx, -hy, hz, hx, -hy, hz, hx, hy, hz].map(f32) };
    }
    case 'cylinder': {
      const r = positive(spec.radius, 'The cylinder radius'), h = positive(spec.height, 'The cylinder height') / 2, points: number[] = [];
      for (const [x, z] of ring(r)) points.push(x!, f32(-h), z!, x!, f32(h), z!);
      return { kind: 'hull', points };
    }
    case 'cone': {
      const r = positive(spec.radius, 'The cone radius'), h = positive(spec.height, 'The cone height') / 2, points: number[] = [];
      for (const [x, z] of ring(r)) points.push(x!, f32(-h), z!);
      points.push(0, f32(h), 0);
      return { kind: 'hull', points };
    }
    case 'ramp': {
      // A closed prism, so it is solid from every side: the top face falls along +x from `height` to 0.
      const l = positive(spec.length, 'The ramp length') / 2, h = positive(spec.height, 'The ramp height'), w = positive(spec.width, 'The ramp width') / 2;
      const vertices = [-l, 0, -w, l, 0, -w, -l, h, -w, -l, 0, w, l, 0, w, -l, h, w].map(f32);
      const indices = [2, 5, 4, 2, 4, 1, /* slope */ 0, 1, 4, 0, 4, 3, /* bottom */ 0, 3, 5, 0, 5, 2, /* back */ 0, 2, 1, /* side -z */ 3, 4, 5 /* side +z */];
      return { kind: 'mesh', vertices, indices };
    }
    case 'terrain': {
      const spacing = positive(spec.spacing, 'The terrain spacing');
      return { kind: 'heightfield', heights: terrainHeights(spec.fn, spec.countX, spec.countZ, spec.amplitude, spec.seed), countX: spec.countX, countZ: spec.countZ, spacing: [f32(spacing), f32(spacing)] };
    }
  }
}

const TERRAIN_DEFAULTS: { readonly [K in TerrainFunction]: GeneratedShape } = {
  flat: { preset: 'terrain', fn: 'flat', countX: 17, countZ: 17, spacing: 1, amplitude: 0, seed: 1 },
  slope: { preset: 'terrain', fn: 'slope', countX: 17, countZ: 17, spacing: 1, amplitude: 4, seed: 1 },
  hills: { preset: 'terrain', fn: 'hills', countX: 33, countZ: 33, spacing: 0.5, amplitude: 1, seed: 1 },
};

/** The default shape of a preset, and what generated it (null for the three analytic shapes). */
export function presetShape(preset: BodyPresetId): { shape: SceneShape; generated: GeneratedShape | null } {
  const made = (generated: GeneratedShape): { shape: SceneShape; generated: GeneratedShape } => ({ shape: generateShape(generated), generated });
  switch (preset) {
    case 'box': return { shape: { kind: 'box', halfExtents: [0.5, 0.5, 0.5] }, generated: null };
    case 'sphere': return { shape: { kind: 'sphere', radius: 0.5 }, generated: null };
    case 'capsule': return { shape: { kind: 'capsule', radius: 0.25, halfLength: 0.5 }, generated: null };
    case 'wedge': return made({ preset: 'wedge', size: [2, 1, 1] });
    case 'cylinder': return made({ preset: 'cylinder', radius: 0.5, height: 1 });
    case 'cone': return made({ preset: 'cone', radius: 0.5, height: 1 });
    case 'ramp': return made({ preset: 'ramp', length: 4, height: 1.5, width: 2 });
    case 'terrain-flat': return made(TERRAIN_DEFAULTS.flat);
    case 'terrain-slope': return made(TERRAIN_DEFAULTS.slope);
    case 'terrain-hills': return made(TERRAIN_DEFAULTS.hills);
    default: throw new EditorError(`There is no shape preset called "${String(preset)}".`);
  }
}

/** What a body's shape was generated from, when the editor made it and the record is still well formed. */
export function generatedShapeOf(body: SceneBody): GeneratedShape | null {
  const record = body.userData?.editor;
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
  const r = record as { readonly [key: string]: unknown }, num = (key: string): boolean => typeof r[key] === 'number' && Number.isFinite(r[key] as number);
  const kind = body.shape.kind;
  if (r.preset === 'wedge' && kind === 'hull' && Array.isArray(r.size) && r.size.length === 3 && r.size.every(value => typeof value === 'number' && Number.isFinite(value))) return { preset: 'wedge', size: r.size as unknown as Vec3 };
  if ((r.preset === 'cylinder' || r.preset === 'cone') && kind === 'hull' && num('radius') && num('height')) return { preset: r.preset, radius: r.radius as number, height: r.height as number };
  if (r.preset === 'ramp' && kind === 'mesh' && num('length') && num('height') && num('width')) return { preset: 'ramp', length: r.length as number, height: r.height as number, width: r.width as number };
  if (r.preset === 'terrain' && kind === 'heightfield' && (r.fn === 'flat' || r.fn === 'slope' || r.fn === 'hills') && num('countX') && num('countZ') && num('spacing') && num('amplitude') && num('seed')) {
    return { preset: 'terrain', fn: r.fn, countX: r.countX as number, countZ: r.countZ as number, spacing: r.spacing as number, amplitude: r.amplitude as number, seed: r.seed as number };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shape measures: extents, volume, inertia
// ---------------------------------------------------------------------------

function shapePoints(shape: SceneShape): readonly number[] | null {
  return shape.kind === 'hull' ? shape.points : shape.kind === 'mesh' ? shape.vertices : null;
}

/** How far a shape reaches from the body position along a unit direction, in metres, for a body turned by `rotation`. */
export function shapeExtentAlong(shape: SceneShape, rotation: Quat, direction: Vec3): number {
  const local = quatRotate(quatConjugate(rotation), direction);
  switch (shape.kind) {
    case 'box': return Math.abs(local[0]) * shape.halfExtents[0] + Math.abs(local[1]) * shape.halfExtents[1] + Math.abs(local[2]) * shape.halfExtents[2];
    case 'sphere': return shape.radius;
    case 'capsule': return shape.radius + Math.abs(local[1]) * shape.halfLength;
    case 'heightfield': {
      const w = (shape.countX - 1) * shape.spacing[0], d = (shape.countZ - 1) * shape.spacing[1];
      let best = -Infinity;
      for (let z = 0; z < shape.countZ; z++) for (let x = 0; x < shape.countX; x++) {
        const value = local[0] * (x * shape.spacing[0]) + local[1] * shape.heights[x + z * shape.countX]! + local[2] * (z * shape.spacing[1]);
        if (value > best) best = value;
      }
      return Number.isFinite(best) ? best : Math.hypot(w, d);
    }
    case 'compound': {
      // The farthest reach of any child: its origin along the direction plus its own extent, turned by its own rotation.
      let best = -Infinity;
      for (const child of shape.shapes) {
        const p = child.position ?? [0, 0, 0], value = local[0] * p[0] + local[1] * p[1] + local[2] * p[2] + shapeExtentAlong(child.shape, child.rotation ?? IDENTITY, local);
        if (value > best) best = value;
      }
      return Number.isFinite(best) ? best : 0;
    }
    default: {
      const points = shapePoints(shape)!;
      let best = -Infinity;
      for (let i = 0; i + 2 < points.length; i += 3) { const value = local[0] * points[i]! + local[1] * points[i + 1]! + local[2] * points[i + 2]!; if (value > best) best = value; }
      return Number.isFinite(best) ? best : 0;
    }
  }
}

/** The smallest full thickness of a shape along its own axes, in metres: what a fast body has to cross to tunnel through it. */
export function shapeThickness(shape: SceneShape): number {
  switch (shape.kind) {
    case 'box': return 2 * Math.min(shape.halfExtents[0], shape.halfExtents[1], shape.halfExtents[2]);
    case 'sphere': return 2 * shape.radius;
    case 'capsule': return 2 * shape.radius;
    case 'heightfield': return Infinity;
    default: {
      let least = Infinity;
      for (const axis of [[1, 0, 0], [0, 1, 0], [0, 0, 1]] as Vec3[]) least = Math.min(least, shapeExtentAlong(shape, IDENTITY, axis) + shapeExtentAlong(shape, IDENTITY, scale3(axis, -1)));
      return least;
    }
  }
}

/** The local axis-aligned box of a shape as [min, max], for drawing a selection frame. */
export function shapeLocalBounds(shape: SceneShape): { min: [number, number, number]; max: [number, number, number] } {
  const axes: Vec3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const max = axes.map(axis => shapeExtentAlong(shape, IDENTITY, axis)) as [number, number, number];
  const min = axes.map(axis => -shapeExtentAlong(shape, IDENTITY, scale3(axis, -1))) as [number, number, number];
  return { min, max };
}

/** Volume in m^3 of a box, sphere or capsule; null for the other kinds (the engine computes those). */
export function shapeVolume(shape: SceneShape): number | null {
  switch (shape.kind) {
    case 'box': return 8 * shape.halfExtents[0] * shape.halfExtents[1] * shape.halfExtents[2];
    case 'sphere': return 4 / 3 * Math.PI * shape.radius ** 3;
    case 'capsule': return Math.PI * shape.radius ** 2 * (2 * shape.halfLength) + 4 / 3 * Math.PI * shape.radius ** 3;
    default: return null;
  }
}

/**
 * Principal moments of inertia [Ix, Iy, Iz] in kg m^2 about the centre, in body
 * axes, of a solid box, sphere or capsule of the given mass. Null for hulls,
 * meshes and height fields: the engine does not report its inertia tensor.
 */
export function principalInertia(shape: SceneShape, mass: number): [number, number, number] | null {
  switch (shape.kind) {
    case 'box': {
      const [x, y, z] = shape.halfExtents, k = mass / 3;
      return [k * (y * y + z * z), k * (x * x + z * z), k * (x * x + y * y)];
    }
    case 'sphere': { const i = 0.4 * mass * shape.radius ** 2; return [i, i, i]; }
    case 'capsule': {
      // A cylinder of height h along y with a hemisphere on each end.
      const r = shape.radius, h = 2 * shape.halfLength, vc = Math.PI * r * r * h, vh = 2 / 3 * Math.PI * r ** 3;
      const mc = mass * vc / (vc + 2 * vh), mh = mass * vh / (vc + 2 * vh);
      const axial = mc * r * r / 2 + 2 * mh * 0.4 * r * r;
      const transverse = mc * (h * h / 12 + r * r / 4) + 2 * mh * (0.4 * r * r + h * h / 4 + 3 * h * r / 8);
      return [transverse, axial, transverse];
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Snapping and picking
// ---------------------------------------------------------------------------

/** `value` rounded to the nearest multiple of `grid`; unchanged when the grid is 0 or not a positive number. */
export function snapValue(value: number, grid: number): number {
  if (!(grid > 0) || !Number.isFinite(grid) || !Number.isFinite(value)) return value;
  const snapped = Math.round(value / grid) * grid;
  // Remove the binary noise of the multiplication (0.1 * 3 = 0.30000000000000004).
  const cleaned = Number(snapped.toPrecision(12));
  return cleaned === 0 ? 0 : cleaned;
}
export function snapVec3(value: Vec3, grid: number, axes: readonly [boolean, boolean, boolean] = [true, true, true]): [number, number, number] {
  return [axes[0] ? snapValue(value[0], grid) : value[0], axes[1] ? snapValue(value[1], grid) : value[1], axes[2] ? snapValue(value[2], grid) : value[2]];
}

/**
 * The y of a body's position that puts its lowest point `gap` metres above a
 * surface at height `surfaceY`: surface snapping. The surface height comes from
 * a downward ray cast in the physics world; this is the arithmetic.
 */
export function restingHeight(shape: SceneShape, rotation: Quat, surfaceY: number, gap = 0): number {
  return f32(surfaceY + shapeExtentAlong(shape, rotation, [0, -1, 0]) + gap);
}

export interface CameraRigLike { readonly yaw: number; readonly pitch: number; readonly distance: number; readonly target: Vec3 }
/** Vertical field of view of the Lab camera (src/camera.ts). */
export const CAMERA_FOV_DEGREES = 58;

/**
 * The ray through a point of the viewport, as the Lab's orbit camera sees it
 * (src/camera.ts: eye on a sphere about the target, y up, 58 degree vertical
 * field of view, pitch clamped to 0.08..1.3 rad). `u` and `v` are 0..1 from the
 * left and top edges of the canvas.
 */
export function cameraRay(rig: CameraRigLike, aspect: number, u: number, v: number): { origin: [number, number, number]; direction: [number, number, number] } {
  const pitch = Math.max(0.08, Math.min(1.3, rig.pitch)), cp = Math.cos(pitch);
  const origin: [number, number, number] = [
    rig.target[0] + Math.cos(rig.yaw) * cp * rig.distance,
    rig.target[1] + Math.sin(pitch) * rig.distance,
    rig.target[2] + Math.sin(rig.yaw) * cp * rig.distance,
  ];
  const forward = normalize3(sub3(rig.target, origin)) ?? [0, 0, -1];
  const right = normalize3(cross3(forward, [0, 1, 0])) ?? [1, 0, 0];
  const up = cross3(right, forward);
  const half = Math.tan(CAMERA_FOV_DEGREES * Math.PI / 360);
  const x = (u * 2 - 1) * aspect * half, y = (1 - v * 2) * half;
  const direction = normalize3(add3(forward, add3(scale3(right, x), scale3(up, y)))) ?? forward;
  return { origin, direction };
}

/** The inverse of `cameraRay`: where a world point appears in the viewport (`u`, `v` in 0..1 when it is on screen) and how far in front of the eye it is. */
export function cameraProject(rig: CameraRigLike, aspect: number, point: Vec3): { u: number; v: number; depth: number } {
  const { origin } = cameraRay(rig, aspect, 0.5, 0.5);
  const forward = normalize3(sub3(rig.target, origin)) ?? [0, 0, -1];
  const right = normalize3(cross3(forward, [0, 1, 0])) ?? [1, 0, 0];
  const up = cross3(right, forward), d = sub3(point, origin), depth = dot3(d, forward), half = Math.tan(CAMERA_FOV_DEGREES * Math.PI / 360);
  return { u: (dot3(d, right) / (depth * aspect * half) + 1) / 2, v: (1 - dot3(d, up) / (depth * half)) / 2, depth };
}

/** Where a ray meets the horizontal plane y = `height`, or null when it runs parallel to it or away from it. */
export function rayPlaneY(origin: Vec3, direction: Vec3, height: number): [number, number, number] | null {
  if (Math.abs(direction[1]) < 1e-6) return null;
  const t = (height - origin[1]) / direction[1];
  if (!(t > 0) || !Number.isFinite(t)) return null;
  return [origin[0] + direction[0] * t, height, origin[2] + direction[2] * t];
}

// ---------------------------------------------------------------------------
// Joints
// ---------------------------------------------------------------------------

export const JOINT_TYPES: readonly SceneJointType[] = Object.freeze(['revolute', 'spherical', 'prismatic', 'distance', 'weld', 'wheel'] as SceneJointType[]);

/** Which optional settings a joint type takes (docs/SCENE_FORMAT.md) and the units of each. */
export interface JointTraits {
  readonly limits: 'angle' | 'length' | null;
  readonly motor: 'angular' | 'linear' | null;
  readonly spring: 'angle' | 'length' | 'none-target' | null;
  readonly coneAngle: boolean;
  readonly length: boolean;
  /** The frame axis the picked axis becomes: z for a hinge, an axle or a cone, x for a slide. */
  readonly axis: 'z' | 'x' | null;
  readonly axisLabel: string;
}
export function jointTraits(type: SceneJointType): JointTraits {
  switch (type) {
    case 'weld': return { limits: null, motor: null, spring: 'none-target', coneAngle: false, length: false, axis: null, axisLabel: '' };
    case 'revolute': return { limits: 'angle', motor: 'angular', spring: 'angle', coneAngle: false, length: false, axis: 'z', axisLabel: 'Hinge axis' };
    case 'spherical': return { limits: 'angle', motor: null, spring: 'none-target', coneAngle: true, length: false, axis: 'z', axisLabel: 'Cone axis' };
    case 'prismatic': return { limits: 'length', motor: 'linear', spring: 'length', coneAngle: false, length: false, axis: 'x', axisLabel: 'Slide axis' };
    case 'distance': return { limits: 'length', motor: 'linear', spring: 'none-target', coneAngle: false, length: true, axis: null, axisLabel: '' };
    case 'wheel': return { limits: 'length', motor: 'angular', spring: 'length', coneAngle: false, length: false, axis: 'z', axisLabel: 'Axle axis' };
  }
}

export interface Pose { readonly position: Vec3; readonly rotation: Quat }
const WORLD_POSE: Pose = { position: [0, 0, 0], rotation: IDENTITY };
const bodyPose = (body: SceneBody): Pose => ({ position: body.position, rotation: body.rotation ?? IDENTITY });

function findPose(scene: Scene, id: string | null): Pose {
  if (id === null) return WORLD_POSE;
  const body = scene.bodies.find(candidate => candidate.id === id);
  if (!body) throw new EditorError(`There is no body called "${id}".`);
  return bodyPose(body);
}

/**
 * The two local frames of a joint whose anchor and axis are given in world
 * space, for the bodies as they stand in the scene. Both frames coincide in
 * the world, so the scene as drawn is the joint's zero position. A distance
 * joint has two anchors instead (`anchor` on A, `anchorB` on B).
 */
export function jointFramesFromWorld(type: SceneJointType, poseA: Pose, poseB: Pose, anchor: Vec3, axis: Vec3, anchorB: Vec3 = anchor): { frameA: SceneFrame; frameB: SceneFrame } {
  const traits = jointTraits(type);
  let world: Quat = IDENTITY;
  if (traits.axis !== null) {
    const unit = normalize3(axis);
    if (!unit) throw new EditorError('The joint axis must have a length.');
    if (traits.axis === 'z') {
      // A wheel's suspension runs along the frame's x axis: keep it as close to vertical as the axle allows.
      const x = perpendicular(unit, type === 'wheel' ? [0, 1, 0] : [1, 0, 0]);
      world = quatFromBasis(x, cross3(unit, x), unit);
    } else {
      const y = perpendicular(unit, [0, 1, 0]);
      world = quatFromBasis(unit, y, cross3(unit, y));
    }
  }
  const local = (pose: Pose, point: Vec3): SceneFrame => {
    const inverse = quatConjugate(pose.rotation);
    const position = v3(quatRotate(inverse, sub3(point, pose.position))), rotation = q4(quatMultiply(inverse, world));
    const identity = Math.abs(rotation[0]) < 1e-7 && Math.abs(rotation[1]) < 1e-7 && Math.abs(rotation[2]) < 1e-7;
    return { position, ...(identity ? {} : { rotation }) };
  };
  return { frameA: local(poseA, anchor), frameB: local(poseB, type === 'distance' ? anchorB : anchor) };
}

/** A joint's anchors and axis in world space, for given body poses (the scene's, or live ones while playing). */
export function jointWorldGeometry(joint: SceneJoint, poseA: Pose, poseB: Pose): { anchorA: [number, number, number]; anchorB: [number, number, number]; axis: [number, number, number] | null } {
  const place = (pose: Pose, frame: SceneFrame | undefined): [number, number, number] => add3(pose.position, quatRotate(pose.rotation, frame?.position ?? [0, 0, 0]));
  const traits = jointTraits(joint.type);
  let axis: [number, number, number] | null = null;
  if (traits.axis !== null) {
    const frame = quatMultiply(poseA.rotation, joint.frameA?.rotation ?? (joint.frameA?.rotationEuler ? eulerToQuaternion(joint.frameA.rotationEuler) : IDENTITY));
    axis = quatRotate(frame, traits.axis === 'z' ? [0, 0, 1] : [1, 0, 0]);
  }
  return { anchorA: place(poseA, joint.frameA), anchorB: place(poseB, joint.frameB), axis };
}

/** `jointWorldGeometry` for the bodies as they stand in a scene. */
export function jointGeometryInScene(scene: Scene, joint: SceneJoint): { anchorA: [number, number, number]; anchorB: [number, number, number]; axis: [number, number, number] | null } {
  return jointWorldGeometry(joint, findPose(scene, joint.bodyA), findPose(scene, joint.bodyB));
}

// ---------------------------------------------------------------------------
// Step warnings
// ---------------------------------------------------------------------------

/**
 * Heuristic warnings about a scene's step, as sentences for the page. They
 * never refuse a scene; the validator's own limits do that.
 *
 *   - A joint stiffness or spring above a quarter of the sub-step rate
 *     (`subSteps / step`): an implicit soft constraint cannot follow a
 *     frequency that high and is softer than asked for.
 *   - A body whose initial speed carries it further in one step than its
 *     thinnest dimension, and that is not a bullet: it can pass through thin
 *     bodies.
 *   - A dynamic body thinner than 2 cm, or with sides differing by more than
 *     a factor of 100: contact is solved with millimetre tolerances.
 *   - A dynamic body that falls further in one step, after one second of free
 *     fall, than its thinnest dimension.
 */
export function stepWarnings(scene: Scene): string[] {
  const world = scene.world ?? {}, step = world.step ?? 1 / 60, subSteps = world.subSteps ?? 4, gravity = world.gravity ?? [0, -9.81, 0];
  const warnings: string[] = [], rate = subSteps / step, limit = rate / 4, show = (value: number): string => Number(value.toPrecision(3)).toString();
  for (const joint of scene.joints ?? []) {
    const stiffness = joint.stiffness?.hertz ?? 60;
    if (stiffness > limit) warnings.push(`Joint "${joint.id}": stiffness ${show(stiffness)} Hz is above a quarter of the sub-step rate (${show(limit)} Hz at ${show(1 / step)} steps/s × ${subSteps} sub-steps). Lower it, shorten the step or add sub-steps.`);
    if (joint.spring && joint.spring.hertz > limit) warnings.push(`Joint "${joint.id}": spring ${show(joint.spring.hertz)} Hz is above a quarter of the sub-step rate (${show(limit)} Hz).`);
  }
  const g = length3(gravity);
  for (const body of scene.bodies) {
    const type = body.type ?? 'dynamic';
    if (type === 'static' || body.shape.kind === 'mesh' || body.shape.kind === 'heightfield') continue;
    const thickness = shapeThickness(body.shape), speed = length3(body.linearVelocity ?? [0, 0, 0]);
    if (speed * step > thickness && !body.bullet) warnings.push(`Body "${body.id}": at ${show(speed)} m/s it moves ${show(speed * step)} m a step, more than its thickness (${show(thickness)} m), so it can pass through thin bodies. Turn on "bullet" or shorten the step.`);
    if (type !== 'dynamic') continue;
    if (thickness < 0.02) warnings.push(`Body "${body.id}": ${show(thickness * 1000)} mm thick. Contact is solved with millimetre tolerances, so bodies under 2 cm rest and stack poorly.`);
    else if (g * (body.gravityScale ?? 1) * step > thickness && !body.bullet) warnings.push(`Body "${body.id}": after 1 s of free fall it moves ${show(g * step)} m a step, more than its thickness (${show(thickness)} m). Shorten the step or turn on "bullet".`);
    if (body.shape.kind === 'box') {
      const h = body.shape.halfExtents, ratio = Math.max(h[0], h[1], h[2]) / Math.min(h[0], h[1], h[2]);
      if (ratio > 100) warnings.push(`Body "${body.id}": its sides differ by a factor of ${show(ratio)}. Very thin plates and long needles are hard on the solver.`);
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// The document and its commands
// ---------------------------------------------------------------------------

/** A command the editor cannot carry out, with a message for the page. */
export class EditorError extends Error {
  constructor(message: string) { super(message); this.name = 'EditorError'; }
}

export interface BodyFlags {
  readonly bullet?: boolean;
  readonly sensor?: boolean;
  readonly hitEvents?: boolean;
  readonly neverSleeps?: boolean;
  readonly lockRotation?: boolean;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  readonly gravityScale?: number;
}

export interface JointPatch {
  readonly jointType?: SceneJointType;
  readonly bodyA?: string | null;
  readonly bodyB?: string | null;
  /** World space. Giving any of these three recomputes both frames for the bodies as they stand. */
  readonly anchor?: Vec3;
  readonly anchorB?: Vec3;
  readonly axis?: Vec3;
  readonly collideConnected?: boolean;
  /** null removes the setting. */
  readonly limits?: { readonly lower: number; readonly upper: number } | null;
  readonly motor?: { readonly speed: number; readonly maxForce: number } | null;
  readonly spring?: { readonly hertz: number; readonly dampingRatio: number; readonly target?: number } | null;
  readonly stiffness?: { readonly hertz: number; readonly dampingRatio?: number } | null;
  readonly coneAngle?: number | null;
  readonly length?: number;
}

export type EditorCommand =
  | { readonly type: 'addBody'; readonly preset: BodyPresetId; readonly id?: string; readonly position?: Vec3 }
  | { readonly type: 'deleteBody'; readonly id: string }
  | { readonly type: 'duplicateBody'; readonly id: string; readonly offset?: Vec3 }
  | { readonly type: 'rename'; readonly id: string; readonly newId: string }
  | { readonly type: 'setTransform'; readonly id: string; readonly position?: Vec3; readonly rotation?: Quat; readonly rotationEuler?: Vec3 }
  | { readonly type: 'setShape'; readonly id: string; readonly shape: SceneShape }
  | { readonly type: 'setGenerated'; readonly id: string; readonly generated: GeneratedShape }
  | { readonly type: 'setBodyType'; readonly id: string; readonly bodyType: SceneBodyType }
  | { readonly type: 'setMaterial'; readonly id: string; readonly material: string | null; readonly density?: number; readonly friction?: number; readonly restitution?: number }
  | { readonly type: 'setColor'; readonly id: string; readonly color: number | null }
  | { readonly type: 'setVelocity'; readonly id: string; readonly linear?: Vec3; readonly angular?: Vec3 }
  | { readonly type: 'setFlags'; readonly id: string; readonly flags: BodyFlags }
  | { readonly type: 'setFilter'; readonly id: string; readonly filter: SceneFilter | null }
  | { readonly type: 'addJoint'; readonly jointType: SceneJointType; readonly bodyA: string | null; readonly bodyB: string | null; readonly id?: string; readonly anchor?: Vec3; readonly anchorB?: Vec3; readonly axis?: Vec3 }
  | { readonly type: 'setJoint'; readonly id: string; readonly patch: JointPatch }
  | { readonly type: 'deleteJoint'; readonly id: string }
  | { readonly type: 'setWorld'; readonly world: SceneWorld }
  | { readonly type: 'setMeta'; readonly title?: string; readonly description?: string; readonly author?: string }
  | { readonly type: 'replaceScene'; readonly scene: unknown };

export type EditorResult =
  | { readonly ok: true; readonly label: string; readonly notes: readonly string[]; /** Ids the command created or renamed to: what to select next. */ readonly created: readonly string[] }
  | { readonly ok: false; readonly message: string; readonly problems: readonly SceneProblem[] };

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
interface Produced { scene: Scene; label: string; notes: string[]; created: string[] }

function without<T extends object>(value: T, ...keys: string[]): T {
  const out: { [key: string]: unknown } = {};
  for (const key of Object.keys(value)) if (!keys.includes(key)) out[key] = (value as { [key: string]: unknown })[key];
  return out as T;
}

/** Every id a scene uses: bodies and joints share one namespace. */
export function sceneIds(scene: Scene): Set<string> {
  const ids = new Set<string>();
  for (const body of scene.bodies) ids.add(body.id);
  for (const joint of scene.joints ?? []) ids.add(joint.id);
  return ids;
}

/** `base-1`, `base-2`, ...: the first that no body or joint uses. A trailing `-N` of `base` is dropped first. */
export function uniqueId(scene: Scene, base: string): string {
  const ids = sceneIds(scene), stem = (base.replace(/-\d+$/, '') || 'item').slice(0, SCENE_LIMITS.idLength - 8);
  for (let n = 1; ; n++) { const id = `${stem}-${n}`; if (!ids.has(id)) return id; }
}

const NEW_BODY_COLORS = [0xE0A458, 0x5FA8D3, 0x9BC53D, 0xE4572E, 0xB497D6, 0x4ECDC4, 0xF2C14E, 0xC97B84];

/** A new, empty SI scene: gravity 9.81 m/s^2 down, the ground slab, no bodies. */
export function emptyScene(title = 'Untitled scene'): Scene {
  return normalizeScene({ format: 'box3d-scene', version: 1, units: 'SI', world: {}, materials: {}, bodies: [], joints: [], meta: { title } });
}

function requireBody(scene: Scene, id: string): SceneBody {
  const body = scene.bodies.find(candidate => candidate.id === id);
  if (!body) throw new EditorError(`There is no body called "${id}".`);
  return body;
}
function mapBody(scene: Scene, id: string, change: (body: SceneBody) => SceneBody): Scene {
  requireBody(scene, id);
  return { ...scene, bodies: scene.bodies.map(body => body.id === id ? change(body) : body) };
}
function withGenerated(body: SceneBody, generated: GeneratedShape | null): SceneBody {
  const rest = without((body.userData ?? {}) as { [key: string]: unknown }, 'editor');
  const userData = generated ? { ...rest, editor: generated } : rest;
  return Object.keys(userData).length > 0 ? { ...body, userData } : without(body, 'userData');
}

function produce(scene: Scene, command: EditorCommand): Produced {
  const done = (next: Scene, label: string, created: string[] = [], notes: string[] = []): Produced => ({ scene: next, label, notes, created });
  switch (command.type) {
    case 'addBody': {
      const preset = BODY_PRESETS.find(candidate => candidate.id === command.preset);
      if (!preset) throw new EditorError(`There is no shape preset called "${String(command.preset)}".`);
      const { shape, generated } = presetShape(command.preset);
      const id = command.id ?? uniqueId(scene, preset.base), fixed = shape.kind === 'mesh' || shape.kind === 'heightfield';
      let position: Vec3 = command.position ?? [0, 0, 0];
      // A height field starts at its position and extends along +x and +z: centre it on the asked point.
      if (shape.kind === 'heightfield') position = [position[0] - (shape.countX - 1) * shape.spacing[0] / 2, position[1], position[2] - (shape.countZ - 1) * shape.spacing[1] / 2];
      else if (command.position === undefined) position = [0, restingHeight(shape, IDENTITY, 0), 0];
      const body = withGenerated({
        id, shape, position: v3(position), ...(fixed ? { type: 'static' as const } : {}),
        color: fixed ? 0x8A9AA6 : NEW_BODY_COLORS[scene.bodies.length % NEW_BODY_COLORS.length]!,
      }, generated);
      return done({ ...scene, bodies: [...scene.bodies, body] }, `Add ${preset.label.toLowerCase()} "${id}"`, [id]);
    }
    case 'deleteBody': {
      requireBody(scene, command.id);
      const joints = scene.joints ?? [], removed = joints.filter(joint => joint.bodyA === command.id || joint.bodyB === command.id);
      const notes = removed.map(joint => `Joint "${joint.id}" was removed with it: it was attached to "${command.id}".`);
      return done({ ...scene, bodies: scene.bodies.filter(body => body.id !== command.id), joints: joints.filter(joint => !removed.includes(joint)) }, `Delete body "${command.id}"`, [], notes);
    }
    case 'duplicateBody': {
      const source = requireBody(scene, command.id), id = uniqueId(scene, source.id);
      const offset = command.offset ?? [Math.max(0.25, 2 * shapeExtentAlong(source.shape, source.rotation ?? IDENTITY, [1, 0, 0]) + 0.1), 0, 0];
      const copy: SceneBody = { ...source, id, position: v3(add3(source.position, offset)) };
      const notes = (scene.joints ?? []).some(joint => joint.bodyA === source.id || joint.bodyB === source.id) ? [`The joints of "${source.id}" were not copied.`] : [];
      return done({ ...scene, bodies: [...scene.bodies, copy] }, `Duplicate "${source.id}" as "${id}"`, [id], notes);
    }
    case 'rename': {
      if (command.id === command.newId) throw new EditorError('The name is unchanged.');
      const joints = scene.joints ?? [];
      if (scene.bodies.some(body => body.id === command.id)) {
        let followed = 0;
        const renamed = joints.map((joint) => {
          if (joint.bodyA !== command.id && joint.bodyB !== command.id) return joint;
          followed++;
          return { ...joint, bodyA: joint.bodyA === command.id ? command.newId : joint.bodyA, bodyB: joint.bodyB === command.id ? command.newId : joint.bodyB };
        });
        return done({ ...scene, bodies: scene.bodies.map(body => body.id === command.id ? { ...body, id: command.newId } : body), joints: renamed },
          `Rename "${command.id}" to "${command.newId}"`, [command.newId], followed > 0 ? [`${followed} ${followed === 1 ? 'joint follows' : 'joints follow'} the new name.`] : []);
      }
      if (joints.some(joint => joint.id === command.id)) {
        return done({ ...scene, joints: joints.map(joint => joint.id === command.id ? { ...joint, id: command.newId } : joint) }, `Rename "${command.id}" to "${command.newId}"`, [command.newId]);
      }
      throw new EditorError(`There is no body or joint called "${command.id}".`);
    }
    case 'setTransform': {
      if (command.rotation && command.rotationEuler) throw new EditorError('Give a rotation as a quaternion or as Euler angles, not both.');
      if (command.rotationEuler && !command.rotationEuler.every(Number.isFinite)) throw new EditorError('Every rotation angle must be a number.');
      const rotation = command.rotation ? q4(command.rotation) : command.rotationEuler ? q4(eulerToQuaternion(command.rotationEuler)) : undefined;
      return done(mapBody(scene, command.id, body => ({
        ...without(body, 'rotationEuler'),
        ...(command.position ? { position: v3(command.position) } : {}),
        ...(rotation ? { rotation } : body.rotationEuler ? { rotation: q4(eulerToQuaternion(body.rotationEuler)) } : {}),
      })), `${rotation && !command.position ? 'Rotate' : 'Move'} "${command.id}"`);
    }
    case 'setShape': {
      return done(mapBody(scene, command.id, (body) => {
        if (body.shape.kind !== command.shape.kind && (command.shape.kind === 'mesh' || command.shape.kind === 'heightfield') && body.type !== undefined && body.type !== 'static') {
          throw new EditorError('A mesh or height-field body is always static.');
        }
        return withGenerated({ ...body, shape: command.shape }, null);
      }), `Resize "${command.id}"`);
    }
    case 'setGenerated': {
      const shape = generateShape(command.generated);
      return done(mapBody(scene, command.id, (body) => {
        if (body.shape.kind !== shape.kind) throw new EditorError(`"${command.id}" is a ${body.shape.kind}; it cannot become a ${shape.kind} by resizing.`);
        return withGenerated({ ...body, shape }, command.generated);
      }), `Resize "${command.id}"`);
    }
    case 'setBodyType':
      return done(mapBody(scene, command.id, body => ({ ...body, type: command.bodyType })), `Make "${command.id}" ${command.bodyType}`);
    case 'setMaterial': {
      if (command.material === null) {
        // Custom: the body carries its own numbers and names no material.
        const current = resolvedMaterial(scene, requireBody(scene, command.id));
        return done(mapBody(scene, command.id, body => ({
          ...without(body, 'material'), color: current.color,
          density: f32(command.density ?? current.density), friction: f32(command.friction ?? current.friction), restitution: f32(command.restitution ?? current.restitution),
        })), `Set the material values of "${command.id}"`);
      }
      const name = command.material, preset = materialPreset(name), inScene = scene.materials && Object.hasOwn(scene.materials, name) ? scene.materials[name] : undefined;
      if (!preset && !inScene) throw new EditorError(`There is no material called "${name}".`);
      const entry: SceneMaterial = inScene ?? { density: preset!.density, friction: preset!.friction, restitution: preset!.restitution, color: preset!.color };
      return done({ ...mapBody(scene, command.id, body => ({ ...without(body, 'density', 'friction', 'restitution', 'color'), material: name })), materials: { ...(scene.materials ?? {}), [name]: entry } },
        `Make "${command.id}" ${preset?.label.toLowerCase() ?? name}`);
    }
    case 'setColor':
      return done(mapBody(scene, command.id, body => command.color === null ? without(body, 'color') : { ...body, color: command.color }), `Colour "${command.id}"`);
    case 'setVelocity':
      return done(mapBody(scene, command.id, body => ({
        ...body, ...(command.linear ? { linearVelocity: v3(command.linear) } : {}), ...(command.angular ? { angularVelocity: v3(command.angular) } : {}),
      })), `Set the velocity of "${command.id}"`);
    case 'setFlags': {
      const flags: Mutable<BodyFlags> = {};
      for (const key of ['bullet', 'sensor', 'hitEvents', 'neverSleeps', 'lockRotation'] as const) if (command.flags[key] !== undefined) flags[key] = command.flags[key];
      for (const key of ['linearDamping', 'angularDamping', 'gravityScale'] as const) if (command.flags[key] !== undefined) flags[key] = f32(command.flags[key]!);
      return done(mapBody(scene, command.id, body => ({ ...body, ...flags })), `Change the settings of "${command.id}"`);
    }
    case 'setFilter':
      return done(mapBody(scene, command.id, body => command.filter === null ? without(body, 'filter') : { ...body, filter: command.filter }), `Set the collision filter of "${command.id}"`);
    case 'addJoint': {
      if (command.bodyA === null && command.bodyB === null) throw new EditorError('A joint needs at least one body.');
      if (command.bodyA === command.bodyB) throw new EditorError('A joint connects two different bodies, or a body and the world.');
      const poseA = findPose(scene, command.bodyA), poseB = findPose(scene, command.bodyB);
      const traits = jointTraits(command.jointType);
      // Default anchor: the moving body's centre for a joint to the world, the midpoint for two bodies.
      const centre: Vec3 = command.bodyA === null ? poseB.position : command.bodyB === null ? poseA.position : scale3(add3(poseA.position, poseB.position), 0.5);
      const anchorA: Vec3 = command.anchor ?? (command.jointType === 'distance' ? (command.bodyA === null ? add3(poseB.position, [0, 1, 0]) : poseA.position) : centre);
      const anchorB: Vec3 = command.anchorB ?? (command.jointType === 'distance' ? (command.bodyB === null ? add3(poseA.position, [0, 1, 0]) : poseB.position) : anchorA);
      const frames = jointFramesFromWorld(command.jointType, poseA, poseB, anchorA, command.axis ?? (traits.axis === 'x' ? [1, 0, 0] : [0, 0, 1]), anchorB);
      const id = command.id ?? uniqueId(scene, command.jointType);
      const joint: SceneJoint = {
        id, type: command.jointType, bodyA: command.bodyA, bodyB: command.bodyB, ...frames,
        ...(command.jointType === 'distance' ? { length: f32(Math.max(0.001, length3(sub3(anchorB, anchorA)))) } : {}),
      };
      return done({ ...scene, joints: [...(scene.joints ?? []), joint] }, `Add ${command.jointType} joint "${id}"`, [id]);
    }
    case 'setJoint': {
      const joints = scene.joints ?? [], current = joints.find(joint => joint.id === command.id);
      if (!current) throw new EditorError(`There is no joint called "${command.id}".`);
      const patch = command.patch;
      let next: Mutable<SceneJoint> = { ...current };
      if (patch.bodyA !== undefined) next.bodyA = patch.bodyA;
      if (patch.bodyB !== undefined) next.bodyB = patch.bodyB;
      if (patch.jointType !== undefined && patch.jointType !== current.type) {
        // Settings the new type does not take are dropped, so the change is not refused for them.
        const traits = jointTraits(patch.jointType);
        next.type = patch.jointType;
        if (traits.limits === null) next = without(next, 'limits');
        if (traits.motor === null) next = without(next, 'motor');
        if (traits.spring === null) next = without(next, 'spring');
        else if (traits.spring === 'none-target' && next.spring?.target !== undefined) next.spring = without(next.spring, 'target');
        if (!traits.coneAngle) next = without(next, 'coneAngle');
        if (!traits.length) next = without(next, 'length');
        // Limits change meaning between angle and travel, so they do not carry over.
        if (traits.limits !== jointTraits(current.type).limits) next = without(next, 'limits');
      }
      const optional = <K extends 'limits' | 'motor' | 'spring' | 'stiffness' | 'coneAngle'>(key: K, round: (value: NonNullable<SceneJoint[K]>) => NonNullable<SceneJoint[K]>): void => {
        const value = patch[key];
        if (value === undefined) return;
        if (value === null) next = without(next, key); else (next as { [key: string]: unknown })[key] = round(value as NonNullable<SceneJoint[K]>);
      };
      optional('limits', value => ({ lower: f32(value.lower), upper: f32(value.upper) }));
      optional('motor', value => ({ speed: f32(value.speed), maxForce: f32(value.maxForce) }));
      optional('spring', value => ({ hertz: f32(value.hertz), dampingRatio: f32(value.dampingRatio), ...(value.target !== undefined ? { target: f32(value.target) } : {}) }));
      optional('stiffness', value => ({ hertz: f32(value.hertz), ...(value.dampingRatio !== undefined ? { dampingRatio: f32(value.dampingRatio) } : {}) }));
      optional('coneAngle', value => f32(value));
      if (patch.length !== undefined) next.length = f32(patch.length);
      if (patch.collideConnected !== undefined) next.collideConnected = patch.collideConnected;
      const reframe = patch.anchor !== undefined || patch.anchorB !== undefined || patch.axis !== undefined || patch.bodyA !== undefined || patch.bodyB !== undefined || next.type !== current.type;
      if (reframe) {
        if (next.bodyA === null && next.bodyB === null) throw new EditorError('A joint needs at least one body.');
        // Keep the world anchors and axis the joint had, unless the patch gives new ones.
        const before = jointGeometryInScene(scene, current);
        const poseA = findPose(scene, next.bodyA), poseB = findPose(scene, next.bodyB), traits = jointTraits(next.type);
        const anchorA = patch.anchor ?? before.anchorA, anchorB = patch.anchorB ?? (next.type === 'distance' ? before.anchorB : anchorA);
        const frames = jointFramesFromWorld(next.type, poseA, poseB, anchorA, patch.axis ?? before.axis ?? (traits.axis === 'x' ? [1, 0, 0] : [0, 0, 1]), anchorB);
        next.frameA = frames.frameA; next.frameB = frames.frameB;
        if (next.type === 'distance' && patch.length === undefined && (current.type !== 'distance' || patch.anchor !== undefined || patch.anchorB !== undefined)) next.length = f32(Math.max(0.001, length3(sub3(anchorB, anchorA))));
      }
      return done({ ...scene, joints: joints.map(joint => joint.id === command.id ? next : joint) }, `Edit joint "${command.id}"`);
    }
    case 'deleteJoint': {
      const joints = scene.joints ?? [];
      if (!joints.some(joint => joint.id === command.id)) throw new EditorError(`There is no joint called "${command.id}".`);
      return done({ ...scene, joints: joints.filter(joint => joint.id !== command.id) }, `Delete joint "${command.id}"`);
    }
    case 'setWorld': {
      const world: Mutable<SceneWorld> = { ...(scene.world ?? {}) };
      if (command.world.gravity !== undefined) world.gravity = v3(command.world.gravity);
      if (command.world.ground !== undefined) world.ground = command.world.ground;
      if (command.world.seed !== undefined) world.seed = command.world.seed;
      if (command.world.step !== undefined) world.step = command.world.step;
      if (command.world.subSteps !== undefined) world.subSteps = command.world.subSteps;
      return done({ ...scene, world }, 'Change the world settings');
    }
    case 'setMeta': {
      let meta: { [key: string]: string } = { ...(scene.meta ?? {}) };
      for (const key of ['title', 'description', 'author'] as const) {
        const value = command[key];
        if (value === undefined) continue;
        if (value === '') meta = without(meta, key); else meta[key] = value;
      }
      return done(Object.keys(meta).length > 0 ? { ...scene, meta } : without(scene, 'meta'), 'Edit the scene details');
    }
    case 'replaceScene': {
      const problems = validateScene(command.scene);
      if (problems.length > 0) throw new RefusedScene(problems);
      const next = normalizeScene(command.scene);
      if (sceneHasCoupling(next)) throw new EditorError('This scene has coupled sections (water, cables, frames, cloths or grains). The editor works on rigid bodies and joints only.');
      return done(next, 'Open a scene');
    }
    default: throw new EditorError(`Unknown command "${String((command as { type?: unknown }).type)}".`);
  }
}

class RefusedScene extends Error {
  readonly problems: readonly SceneProblem[];
  constructor(problems: readonly SceneProblem[]) { super('invalid scene'); this.problems = problems; }
}

const describe = (problem: SceneProblem): string => problem.path ? `${problem.path}: ${problem.message}` : problem.message;

interface HistoryEntry { readonly label: string; readonly before: Scene; after: Scene; readonly mergeKey: string | null }

export interface SceneDocumentOptions {
  /** Commands the undo stack keeps; older ones are forgotten. Default 100. */
  readonly historyLimit?: number;
  /**
   * A further test a valid candidate scene must pass before a command is applied: return a
   * message to refuse it, or null. The Lab builds the candidate in a scratch physics world
   * here, so geometry the engine cannot use is refused like any other invalid edit.
   */
  readonly accept?: (scene: Scene) => string | null;
}

/**
 * An editing document: a valid scene, and the commands that led to it.
 *
 * Scenes are treated as immutable values. A command returns a new scene that
 * shares every untouched body with the one before, so the undo stack costs
 * little even with large meshes; undo and redo swap whole scenes, which is why
 * they restore the exact canonical text.
 */
export class SceneDocument {
  static readonly DEFAULT_HISTORY = 100;
  #scene: Scene;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  readonly #limit: number;
  readonly #accept: ((scene: Scene) => string | null) | null;
  #revision = 0;

  /** Throws SceneValidationError for an invalid scene, and EditorError for one with coupled sections. */
  constructor(scene: unknown = emptyScene(), options: SceneDocumentOptions = {}) {
    const normal = normalizeScene(scene);
    if (sceneHasCoupling(normal)) throw new EditorError('This scene has coupled sections (water, cables, frames, cloths or grains). The editor works on rigid bodies and joints only.');
    this.#scene = normal;
    const limit = options.historyLimit ?? SceneDocument.DEFAULT_HISTORY;
    if (!Number.isInteger(limit) || limit < 1) throw new RangeError('The history limit must be a positive integer.');
    this.#limit = limit;
    this.#accept = options.accept ?? null;
  }

  /** The current scene. Valid, and never modified in place. */
  get scene(): Scene { return this.#scene; }
  /** Increases by one with every change, undo and redo. */
  get revision(): number { return this.#revision; }
  get historyLimit(): number { return this.#limit; }
  get undoDepth(): number { return this.#undo.length; }
  get redoDepth(): number { return this.#redo.length; }
  get canUndo(): boolean { return this.#undo.length > 0; }
  get canRedo(): boolean { return this.#redo.length > 0; }
  get undoLabel(): string | null { return this.#undo.at(-1)?.label ?? null; }
  get redoLabel(): string | null { return this.#redo.at(-1)?.label ?? null; }
  /** The canonical JSON of the scene (scene-format.ts `canonicalize`). */
  canonical(): string { return canonicalize(this.#scene); }

  body(id: string): SceneBody | null { return this.#scene.bodies.find(body => body.id === id) ?? null; }
  joint(id: string): SceneJoint | null { return (this.#scene.joints ?? []).find(joint => joint.id === id) ?? null; }

  /**
   * Carry out a command, or refuse it. A refused command changes nothing and
   * returns the validator's message. `mergeKey` folds a run of like commands
   * (arrow-key nudges, a drag) into one undo step: a command whose key equals
   * that of the newest undo entry replaces that entry's result.
   */
  apply(command: EditorCommand, mergeKey: string | null = null): EditorResult {
    let produced: Produced;
    try {
      produced = produce(this.#scene, command);
    } catch (error) {
      if (error instanceof RefusedScene) return { ok: false, message: describe(error.problems[0]!), problems: error.problems };
      if (error instanceof EditorError) return { ok: false, message: error.message, problems: [{ path: '', message: error.message }] };
      throw error;
    }
    const problems = validateScene(produced.scene);
    if (problems.length > 0) return { ok: false, message: describe(problems[0]!), problems };
    const veto = this.#accept?.(produced.scene) ?? null;
    if (veto !== null) return { ok: false, message: veto, problems: [{ path: '', message: veto }] };
    const top = this.#undo.at(-1);
    if (mergeKey !== null && top && top.mergeKey === mergeKey) top.after = produced.scene;
    else {
      this.#undo.push({ label: produced.label, before: this.#scene, after: produced.scene, mergeKey });
      if (this.#undo.length > this.#limit) this.#undo.splice(0, this.#undo.length - this.#limit);
    }
    this.#redo = [];
    this.#scene = produced.scene;
    this.#revision++;
    return { ok: true, label: produced.label, notes: produced.notes, created: produced.created };
  }

  /** Ends a run of merged commands: the next command starts a new undo step whatever its key. */
  breakMerge(): void {
    const top = this.#undo.at(-1);
    if (top && top.mergeKey !== null) this.#undo[this.#undo.length - 1] = { ...top, mergeKey: null };
  }

  /** Undo the newest command. Returns its label, or null when there is nothing to undo. */
  undo(): string | null {
    const entry = this.#undo.pop();
    if (!entry) return null;
    this.#redo.push(entry);
    this.#scene = entry.before;
    this.#revision++;
    return entry.label;
  }

  redo(): string | null {
    const entry = this.#redo.pop();
    if (!entry) return null;
    this.#undo.push(entry);
    this.#scene = entry.after;
    this.#revision++;
    return entry.label;
  }
}

// ---------------------------------------------------------------------------
// Measurement
// ---------------------------------------------------------------------------

export interface BodySample {
  readonly mass: number;
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly linearVelocity: Vec3;
  readonly angularVelocity: Vec3;
}

export interface EnergyBreakdown {
  /** (1/2) m v^2, joules. */
  readonly translational: number;
  /** (1/2) w . I w, joules; NaN when the inertia is not known (hulls, meshes). */
  readonly rotational: number;
  /** -m g . r, joules: zero at the world origin. */
  readonly potential: number;
  /** The sum, leaving the rotational part out when it is not known. */
  readonly total: number;
}

/** Mechanical energy of one body from its state. `inertia` is `principalInertia(shape, mass)`. */
export function bodyEnergy(sample: BodySample, gravity: Vec3, inertia: readonly [number, number, number] | null): EnergyBreakdown {
  const translational = 0.5 * sample.mass * dot3(sample.linearVelocity, sample.linearVelocity);
  const potential = -sample.mass * dot3(gravity, sample.position);
  let rotational = NaN;
  if (inertia) {
    const w = quatRotate(quatConjugate(sample.rotation), sample.angularVelocity);
    rotational = 0.5 * (inertia[0] * w[0] * w[0] + inertia[1] * w[1] * w[1] + inertia[2] * w[2] * w[2]);
  }
  return { translational, rotational, potential, total: translational + potential + (Number.isNaN(rotational) ? 0 : rotational) };
}

export const MEASUREMENT_COLUMNS = Object.freeze([
  'time_s', 'x_m', 'y_m', 'z_m', 'vx_m_per_s', 'vy_m_per_s', 'vz_m_per_s', 'speed_m_per_s',
  'kinetic_translational_J', 'kinetic_rotational_J', 'potential_J', 'total_J',
] as const);
export type MeasurementColumn = typeof MEASUREMENT_COLUMNS[number];

/** A time history of one body: a ring of rows, newest last, with CSV export. */
export class MeasurementSeries {
  readonly capacity: number;
  readonly #rows: Float64Array;
  #head = 0;
  #count = 0;
  static readonly WIDTH = MEASUREMENT_COLUMNS.length;

  constructor(capacity = 3600) {
    if (!Number.isInteger(capacity) || capacity < 1) throw new RangeError('The capacity must be a positive integer.');
    this.capacity = capacity;
    this.#rows = new Float64Array(capacity * MeasurementSeries.WIDTH);
  }

  get length(): number { return this.#count; }
  clear(): void { this.#head = 0; this.#count = 0; }

  /** Record the state of a body at `time` seconds. The oldest row is dropped when the series is full. */
  push(time: number, sample: BodySample, gravity: Vec3, inertia: readonly [number, number, number] | null): void {
    const energy = bodyEnergy(sample, gravity, inertia), v = sample.linearVelocity, p = sample.position;
    const offset = this.#head * MeasurementSeries.WIDTH;
    this.#rows.set([time, p[0], p[1], p[2], v[0], v[1], v[2], length3(v), energy.translational, energy.rotational, energy.potential, energy.total], offset);
    this.#head = (this.#head + 1) % this.capacity;
    if (this.#count < this.capacity) this.#count++;
  }

  /** Row `index` (0 is the oldest kept) as numbers in MEASUREMENT_COLUMNS order. */
  row(index: number): number[] {
    if (!Number.isInteger(index) || index < 0 || index >= this.#count) throw new RangeError('No such row.');
    const start = ((this.#head - this.#count + index) % this.capacity + this.capacity) % this.capacity * MeasurementSeries.WIDTH;
    return Array.from(this.#rows.subarray(start, start + MeasurementSeries.WIDTH));
  }

  /** One column, oldest first. */
  column(name: MeasurementColumn): number[] {
    const k = MEASUREMENT_COLUMNS.indexOf(name), out: number[] = [];
    for (let i = 0; i < this.#count; i++) out.push(this.#rows[(((this.#head - this.#count + i) % this.capacity + this.capacity) % this.capacity) * MeasurementSeries.WIDTH + k]!);
    return out;
  }

  /**
   * RFC 4180 CSV: a header row of MEASUREMENT_COLUMNS, then one row per sample,
   * oldest first, lines ended by CRLF. Numbers have up to 9 significant digits
   * (the state is float32); a value that is not known is an empty field.
   */
  toCsv(): string {
    const lines = [MEASUREMENT_COLUMNS.join(',')];
    for (let i = 0; i < this.#count; i++) lines.push(this.row(i).map(csvNumber).join(','));
    return `${lines.join('\r\n')}\r\n`;
  }
}

function csvNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  const short = Number(value.toPrecision(9));
  return String(short === 0 ? 0 : short);
}

/** The straight-line distance between two points, with its components: the ruler. */
export function rulerMeasure(a: Vec3, b: Vec3): { distance: number; delta: [number, number, number]; horizontal: number } {
  const delta = sub3(b, a);
  return { distance: length3(delta), delta, horizontal: Math.hypot(delta[0], delta[2]) };
}

// ---------------------------------------------------------------------------
// Autosave records
// ---------------------------------------------------------------------------

export const AUTOSAVE_KEY = 'box3d-lab-scene-editor-autosave-v1';
/** Characters of canonical JSON the editor writes to localStorage; a larger scene is not autosaved. */
export const AUTOSAVE_MAX_CHARS = 1_000_000;

/** The text stored under AUTOSAVE_KEY, or null when the scene is too large to autosave. */
export function encodeAutosave(scene: Scene, savedAt: string): string | null {
  const canonical = canonicalize(scene);
  if (canonical.length > AUTOSAVE_MAX_CHARS) return null;
  return JSON.stringify({ kind: 'box3d-scene-editor-autosave', version: 1, savedAt, scene: JSON.parse(canonical) as unknown });
}

/** A stored autosave, validated like any other imported scene. Null for anything that is not one. Never throws. */
export function decodeAutosave(text: string | null): { scene: Scene; savedAt: string } | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > AUTOSAVE_MAX_CHARS * 2) return null;
  try {
    const record = JSON.parse(text) as { kind?: unknown; version?: unknown; savedAt?: unknown; scene?: unknown } | null;
    if (record === null || typeof record !== 'object' || record.kind !== 'box3d-scene-editor-autosave' || record.version !== 1) return null;
    if (typeof record.savedAt !== 'string' || record.savedAt.length > 64 || Number.isNaN(Date.parse(record.savedAt))) return null;
    if (validateScene(record.scene).length > 0) return null;
    const scene = normalizeScene(record.scene);
    return sceneHasCoupling(scene) ? null : { scene, savedAt: record.savedAt };
  } catch {
    return null;
  }
}
