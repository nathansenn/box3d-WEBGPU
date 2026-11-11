/**
 * Scene files: one plain-JSON description of a rigid-body scene that can be
 * validated, loaded, saved, diffed, hashed and carried in a share link.
 *
 * The native solver cannot serialise its state, so a scene file says how to
 * BUILD a scene (world settings, bodies, joints) and, optionally, the pose and
 * velocity each body had when it was saved. The format is documented in
 * docs/SCENE_FORMAT.md.
 *
 * A scene may also carry three optional coupled sections: `water` basins with
 * the bodies that float in them, `cables` and `frames` with their attachments.
 * This module validates, normalises, hashes and links them; BUILDING them is
 * the job of simulation.ts (`loadSimulationScene`, the kit's `loadScene`),
 * which returns one Simulation that steps everything in the right order.
 *
 * This is the one copy of the format. The kit publishes it as
 * `box3d-webgpu-kit/scene` (packages/box3d-kit/src/scene.ts pins the builder to
 * its PhysicsWorld) and the Physics Lab loads scenes with it through
 * src/lab/scene-host.ts. The builder talks to a world through `SceneHost`, the
 * few members of the kit's PhysicsWorld it needs.
 */
import {EngineError} from './contracts.ts';
import type {NativeBodyDescriptor, NativeBodyHandle, NativeBodyState, NativeJointDescriptor, NativeJointHandle} from './native-world.ts';

type Body = NativeBodyHandle;
type Joint = NativeJointHandle;

/**
 * What a SceneBuilder needs from a world. The kit's PhysicsWorld has exactly
 * these members; the Lab wraps a NativeWorldBackend (src/lab/scene-host.ts).
 */
export interface SceneHost {
  readonly loop: {readonly step: number};
  readonly subSteps: number;
  readonly seed: number;
  readonly native: {readonly maxBodies: number; reserveBodyCapacity(bodies: number): unknown};
  reset(options: {readonly ground?: boolean; readonly gravity?: SceneVec3; readonly seed?: number}): unknown;
  createBody(options: NativeBodyDescriptor): NativeBodyHandle | null;
  createJoint(options: NativeJointDescriptor): NativeJointHandle;
  destroyBody(body: NativeBodyHandle): boolean;
  destroyJoint(joint: NativeJointHandle): boolean;
  isAlive(body: NativeBodyHandle): boolean;
  isJointAlive(joint: NativeJointHandle): boolean;
  getState(body: NativeBodyHandle): NativeBodyState;
  gravity(): [number, number, number];
  bodyCount(): number;
}

export const SCENE_FORMAT = 'box3d-scene';
export const SCENE_VERSION = 1;

/** Hard limits a scene file must respect. `validateScene` reports each one by path. */
export const SCENE_LIMITS = Object.freeze({
  bodies: 65536,
  joints: 65536,
  materials: 1024,
  /** Characters in a body, joint or material id. */
  idLength: 64,
  hullPoints: 4096,
  meshVertices: 1048576,
  meshTriangles: 2097152,
  /** Height-field samples along one side. */
  heightfieldSide: 4096,
  /** Numbers in all hull, mesh and height-field arrays of one scene together. */
  geometryValues: 8_000_000,
  /** Canonical JSON characters of one `userData`, or of `extensions`. */
  userDataChars: 65536,
  /** Nesting depth of `userData` and `extensions`. */
  depth: 32,
  /** Characters in a meta string. */
  metaChars: 4096,
  /** Water basins in one scene, and cells in one basin. */
  waterBasins: 8,
  waterCells: 65536,
  cables: 1024,
  cableNodes: 16384,
  frames: 64,
  frameNodes: 4096,
  frameElements: 8192,
  /** Equations of all frame <-> body attachments together: 3 per pinned, 6 per clamped. */
  frameBodyEquations: 96,
  /** Problems `validateScene` lists before it stops. */
  problems: 100,
  /** Characters in a share link. */
  linkChars: 1_048_576,
  /** UTF-8 bytes of the canonical JSON a share link may carry (the decompression cap). */
  linkSceneBytes: 4_194_304,
});

export type SceneVec3 = readonly [number, number, number];
export type SceneQuat = readonly [number, number, number, number];
export type SceneBodyType = 'static' | 'kinematic' | 'dynamic';
export type SceneJointType = 'weld' | 'revolute' | 'spherical' | 'prismatic' | 'distance' | 'wheel';

export interface SceneWorld {
  /** m/s^2. Default [0, -9.81, 0]. */
  readonly gravity?: SceneVec3;
  /** The static 88 m x 88 m slab whose top face is y = 0. Default true. */
  readonly ground?: boolean;
  /** Unsigned 32-bit. Default 1. */
  readonly seed?: number;
  /** Fixed time step in seconds, in (0, 1/30]. Default 1/60. */
  readonly step?: number;
  /** Solver sub-steps per step, 1..16. Default 4. */
  readonly subSteps?: number;
}

export interface SceneMaterial {
  /** kg/m^3. */
  readonly density: number;
  readonly friction: number;
  readonly restitution: number;
  /** 0xRRGGBB. */
  readonly color?: number;
}

export type SceneShape =
  | {readonly kind: 'box'; readonly halfExtents: SceneVec3}
  | {readonly kind: 'sphere'; readonly radius: number}
  | {readonly kind: 'capsule'; readonly radius: number; readonly halfLength: number}
  | {readonly kind: 'hull'; readonly points: readonly number[]}
  | {readonly kind: 'mesh'; readonly vertices: readonly number[]; readonly indices: readonly number[]}
  | {readonly kind: 'heightfield'; readonly heights: readonly number[]; readonly countX: number; readonly countZ: number; readonly spacing: readonly [number, number]};

export interface SceneFilter {
  /** Unsigned 64-bit integer as a decimal string. Give both bit fields or neither. */
  readonly categoryBits?: string;
  readonly maskBits?: string;
  readonly groupIndex?: number;
}

export interface SceneBody {
  /** Unique among all bodies and joints of the scene. Letters, digits and `_ . : -`. */
  readonly id: string;
  readonly shape: SceneShape;
  /** Default 'dynamic'. Mesh and height-field bodies are always static. */
  readonly type?: SceneBodyType;
  readonly position: SceneVec3;
  /** Unit quaternion [x, y, z, w]. Default identity. */
  readonly rotation?: SceneQuat;
  /** Input only: degrees about X, Y, Z (q = qx qy qz). Normalised to `rotation`; never give both. */
  readonly rotationEuler?: SceneVec3;
  readonly linearVelocity?: SceneVec3;
  /** rad/s. */
  readonly angularVelocity?: SceneVec3;
  /** Name in `scene.materials`. The inline density, friction, restitution and color override it. */
  readonly material?: string;
  readonly density?: number;
  readonly friction?: number;
  readonly restitution?: number;
  readonly color?: number;
  readonly bullet?: boolean;
  readonly sensor?: boolean;
  readonly hitEvents?: boolean;
  readonly neverSleeps?: boolean;
  readonly lockRotation?: boolean;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  readonly gravityScale?: number;
  readonly filter?: SceneFilter;
  /** Free-form JSON for the application. Carried, never interpreted. */
  readonly userData?: {readonly [key: string]: unknown};
}

export interface SceneFrame {
  readonly position?: SceneVec3;
  readonly rotation?: SceneQuat;
  /** Input only, as on a body. */
  readonly rotationEuler?: SceneVec3;
}

export interface SceneJoint {
  readonly id: string;
  readonly type: SceneJointType;
  /** A body id, or null for the fixed world. */
  readonly bodyA: string | null;
  readonly bodyB: string | null;
  readonly frameA?: SceneFrame;
  readonly frameB?: SceneFrame;
  readonly collideConnected?: boolean;
  readonly limits?: {readonly lower: number; readonly upper: number};
  readonly motor?: {readonly speed: number; readonly maxForce: number};
  readonly spring?: {readonly hertz: number; readonly dampingRatio: number; readonly target?: number};
  /** Distance joints only (required there). */
  readonly length?: number;
  /** Spherical joints only. */
  readonly coneAngle?: number;
  /** How stiffly the joint holds its bodies together. Default 60 Hz with damping ratio 2. */
  readonly stiffness?: {readonly hertz: number; readonly dampingRatio?: number};
  readonly userData?: {readonly [key: string]: unknown};
}

export interface SceneMeta {
  readonly title?: string;
  readonly description?: string;
  readonly author?: string;
  /** A date `Date.parse` accepts; ISO 8601 recommended. */
  readonly created?: string;
}

/** Per-body drag settings of a body in a water basin. Omitted values take the coupling's defaults. */
export interface SceneWaterBody {
  /** Id of a box, sphere or capsule body. A body floats in at most one basin. */
  readonly body: string;
  readonly dragCoefficient?: number;
  /** m^2. */
  readonly referenceArea?: number;
  /** N s/m. Default 0. */
  readonly linearDrag?: number;
  /** N m s/rad. Default 0. */
  readonly angularDrag?: number;
}

/** One closed, flat-bottom shallow-water basin (docs/WATER_COUPLING.md). Numbers here are float64. */
export interface SceneWater {
  readonly id: string;
  /** Cells along world x and z, each 3 or more. */
  readonly cols: number;
  readonly rows: number;
  /** Cell size in metres. */
  readonly dx: number;
  readonly dz: number;
  /** Rest depth in metres. */
  readonly restDepth: number;
  /** The basin floor at the grid's minimum-x, minimum-z corner. */
  readonly origin: SceneVec3;
  /** kg/m^3. Default 1000. */
  readonly density?: number;
  /** Bottom friction of the water, 1/s. Default 0. */
  readonly waterDrag?: number;
  /** State, `cols * rows` values each: surface elevation above rest (m) and the face velocities (m/s). Default zero. */
  readonly eta?: readonly number[];
  readonly u?: readonly number[];
  readonly v?: readonly number[];
  readonly bodies?: readonly SceneWaterBody[];
}

/** Rotational inertia of an attached body: the world reports mass only. Default: from the body's box, sphere or capsule shape. */
export type SceneInertia =
  | {readonly kind: 'box'; readonly halfExtents: SceneVec3}
  | {readonly kind: 'sphere'; readonly radius: number}
  | {readonly kind: 'capsule'; readonly radius: number; readonly halfLength: number}
  | {readonly kind: 'principal'; readonly moments: SceneVec3}
  | {readonly kind: 'locked'};

/** A free cable node attached to a point on a body (`body`), or to a frame node (`frame` and `frameNode`). */
export interface SceneCableAttachment {
  readonly node: number;
  readonly body?: string;
  readonly frame?: string;
  readonly frameNode?: number;
  /** Body attachments only. Required when the body's shape is not a box, sphere or capsule. */
  readonly inertia?: SceneInertia;
  /** Body attachments only: the attachment point in body axes. Default: where the node is when the scene is built. */
  readonly localPoint?: SceneVec3;
}

export interface SceneCableSegment {
  readonly a: number;
  readonly b: number;
  /** Metres. */
  readonly restLength: number;
  /** Metres per newton: restLength / (E A). Zero is inextensible. */
  readonly compliance: number;
}

/** A tension-only cable (docs/COMPLIANT_CABLE.md, docs/NONLINEAR_CABLE.md). It steps with the world's step and gravity. Numbers are float64. */
export interface SceneCable {
  readonly id: string;
  /** Default 'proximal'. */
  readonly solver?: 'proximal' | 'xpbd';
  /** x, y, z per node, metres. */
  readonly nodes: readonly number[];
  /** kg per node. */
  readonly masses: readonly number[];
  /** 1 per node that is a fixed anchor in the world, else 0. Default all 0. */
  readonly pinned?: readonly number[];
  readonly velocities?: readonly number[];
  readonly segments: readonly SceneCableSegment[];
  /** Default 1. A cable with drag needs 1. */
  readonly substeps?: number;
  /** Default 64. */
  readonly maxIterations?: number;
  /** Default 1e-10. */
  readonly residualTolerance?: number;
  /** Newtons; proximal solver only. Default 1e-6. */
  readonly forceTolerance?: number;
  /** Mass-proportional velocity damping, 1/s. Default 0. */
  readonly drag?: number;
  readonly attachments?: readonly SceneCableAttachment[];
}

export interface SceneFrameElement {
  readonly a: number;
  readonly b: number;
  readonly youngModulus: number;
  readonly shearModulus: number;
  readonly area: number;
  readonly iy: number;
  readonly iz: number;
  readonly torsionConstant: number;
  readonly density: number;
  /** A direction that is not parallel to the element; it fixes the section's local y axis. */
  readonly up: SceneVec3;
}

/** A frame node attached to a point on a body: 'pinned' (forces) or 'clamped' (forces and moments). */
export interface SceneFrameAttachment {
  readonly node: number;
  readonly body: string;
  /** Default 'pinned'. */
  readonly mode?: 'pinned' | 'clamped';
  readonly inertia?: SceneInertia;
  readonly localPoint?: SceneVec3;
}

/** A linear beam frame (docs/FRAME_MECHANICS.md). It steps with the world's step and gravity, one sub-step. Numbers are float64. */
export interface SceneFrameSection {
  readonly id: string;
  /** Rest position x, y, z per node, metres. */
  readonly nodes: readonly number[];
  readonly elements: readonly SceneFrameElement[];
  /** Six flags per node (translation x, y, z, rotation x, y, z): 1 is held at zero. Default all 0. */
  readonly fixed?: readonly number[];
  /** kg per node. */
  readonly pointMasses?: readonly number[];
  /** Three rotary inertias per node, kg m^2. */
  readonly pointInertias?: readonly number[];
  /** State: six values per node. Default zero. */
  readonly displacements?: readonly number[];
  readonly velocities?: readonly number[];
  /** Mass-proportional damping, 1/s. Default 0. */
  readonly drag?: number;
  /** Default 1024. */
  readonly maxIterations?: number;
  /** Defaults 1e-9 N, 1e-9 N m, 1e-10 N s, 1e-10 N m s. */
  readonly forceTolerance?: number;
  readonly momentTolerance?: number;
  readonly impulseTolerance?: number;
  readonly angularImpulseTolerance?: number;
  readonly attachments?: readonly SceneFrameAttachment[];
}

/** The optional coupled sections of a scene. */
export interface SceneCoupledSections {
  readonly water?: readonly SceneWater[];
  readonly cables?: readonly SceneCable[];
  readonly frames?: readonly SceneFrameSection[];
}

export interface Scene {
  readonly format: 'box3d-scene';
  readonly version: 1;
  /** Metres, kilograms, seconds, radians. Default and only value: 'SI'. */
  readonly units?: 'SI';
  readonly world?: SceneWorld;
  readonly materials?: {readonly [name: string]: SceneMaterial};
  readonly bodies: readonly SceneBody[];
  readonly joints?: readonly SceneJoint[];
  /** Water basins and the bodies that float in them. Built by simulation.ts, not by this module. */
  readonly water?: readonly SceneWater[];
  /** Cables and their attachments to bodies and frames. */
  readonly cables?: readonly SceneCable[];
  /** Frames and their attachments to bodies. */
  readonly frames?: readonly SceneFrameSection[];
  readonly meta?: SceneMeta;
  /** Preserved and ignored by this module. */
  readonly extensions?: {readonly [key: string]: unknown};
}

/** One validation finding. `path` is a JSON pointer (RFC 6901) into the scene; '' is the scene itself. */
export interface SceneProblem {
  readonly path: string;
  readonly message: string;
}

/** Thrown by loadScene, canonicalize, the builder and the link functions for an invalid scene. `code` is 'INVALID_PAYLOAD'. */
export class SceneValidationError extends EngineError {
  readonly problems: readonly SceneProblem[];
  constructor(problems: readonly SceneProblem[], what = 'scene') {
    const shown = problems.slice(0, 5).map(p => `${p.path || '/'}: ${p.message}`).join('; ');
    super('INVALID_PAYLOAD', `Invalid ${what} (${problems.length} problem${problems.length === 1 ? '' : 's'}${problems.length > 5 ? ', first 5 shown' : ''}): ${shown}`);
    this.problems = problems;
  }
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9_.:-]+$/;
const BITS_PATTERN = /^(0|[1-9][0-9]{0,19})$/;
const MAX_U64 = 0xFFFFFFFFFFFFFFFFn;
const BODY_TYPES = ['static', 'kinematic', 'dynamic'];
const JOINT_TYPES = ['weld', 'revolute', 'spherical', 'prismatic', 'distance', 'wheel'];
const SHAPE_KEYS: Record<string, readonly string[]> = {
  box: ['kind', 'halfExtents'], sphere: ['kind', 'radius'], capsule: ['kind', 'radius', 'halfLength'], hull: ['kind', 'points'],
  mesh: ['kind', 'vertices', 'indices'], heightfield: ['kind', 'heights', 'countX', 'countZ', 'spacing'],
};
const BODY_KEYS = ['id', 'shape', 'type', 'position', 'rotation', 'rotationEuler', 'linearVelocity', 'angularVelocity', 'material', 'density', 'friction', 'restitution',
  'color', 'bullet', 'sensor', 'hitEvents', 'neverSleeps', 'lockRotation', 'linearDamping', 'angularDamping', 'gravityScale', 'filter', 'userData'];
const JOINT_KEYS = ['id', 'type', 'bodyA', 'bodyB', 'frameA', 'frameB', 'collideConnected', 'limits', 'motor', 'spring', 'length', 'coneAngle', 'stiffness', 'userData'];
/** Which optional settings each joint type takes (the table in the kit README). */
const JOINT_FEATURES: Record<string, readonly string[]> = {
  weld: ['spring'], revolute: ['limits', 'motor', 'spring'], spherical: ['limits', 'spring', 'coneAngle'],
  prismatic: ['limits', 'motor', 'spring'], distance: ['limits', 'motor', 'spring', 'length'], wheel: ['limits', 'motor', 'spring'],
};
const FLAGS = ['bullet', 'sensor', 'hitEvents', 'neverSleeps', 'lockRotation'] as const;

type Obj = Record<string, unknown>;
const isObject = (value: unknown): value is Obj => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
const typeName = (value: unknown): string => value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
const show = (value: unknown): string => typeof value === 'string' ? JSON.stringify(value.length > 40 ? value.slice(0, 40) + '...' : value) : typeof value === 'number' || typeof value === 'boolean' || value === null ? String(value) : typeName(value);
const pointer = (key: string): string => key.replace(/~/g, '~0').replace(/\//g, '~1');

class Checker {
  readonly problems: SceneProblem[] = [];
  geometryValues = 0;
  private full = false;
  add(path: string, message: string): false {
    if (this.problems.length < SCENE_LIMITS.problems) this.problems.push({path, message});
    else if (!this.full) { this.full = true; this.problems.push({path: '', message: `more than ${SCENE_LIMITS.problems} problems; the rest are not listed`}); }
    return false;
  }
  get stopped(): boolean { return this.full; }

  object(value: unknown, path: string, allowed: readonly string[], required: readonly string[] = []): value is Obj {
    if (!isObject(value)) return this.add(path, `must be an object, got ${typeName(value)}`);
    for (const key of Object.keys(value)) if (!allowed.includes(key)) this.add(`${path}/${pointer(key)}`, `unknown key ${JSON.stringify(key)}`);
    for (const key of required) if (value[key] === undefined) this.add(`${path}/${key}`, 'is required');
    return true;
  }
  /** A finite number that survives conversion to float32, optionally bounded. */
  number(value: unknown, path: string, min = -Infinity, max = Infinity, integer = false): value is number {
    if (typeof value !== 'number') return this.add(path, `must be a number, got ${typeName(value)}`);
    if (!Number.isFinite(value)) return this.add(path, `must be a finite number, got ${value}`);
    if (integer && !Number.isInteger(value)) return this.add(path, `must be an integer, got ${value}`);
    if (value < min) return this.add(path, `must be >= ${min}, got ${value}`);
    if (value > max) return this.add(path, `must be <= ${max}, got ${value}`);
    if (!integer) {
      const single = Math.fround(value);
      if (!Number.isFinite(single) || (value !== 0 && single === 0)) return this.add(path, `must fit a float32, got ${value}`);
    }
    return true;
  }
  /** A finite float64 (the coupled sections are float64, unlike the rigid solver's float32 values). */
  real(value: unknown, path: string, min = -Infinity, max = Infinity, integer = false): value is number {
    if (typeof value !== 'number') return this.add(path, `must be a number, got ${typeName(value)}`);
    if (!Number.isFinite(value)) return this.add(path, `must be a finite number, got ${value}`);
    if (integer && !Number.isInteger(value)) return this.add(path, `must be an integer, got ${value}`);
    if (value < min) return this.add(path, `must be >= ${min}, got ${value}`);
    if (value > max) return this.add(path, `must be <= ${max}, got ${value}`);
    return true;
  }
  /** A real that is strictly positive. */
  positive(value: unknown, path: string, max = Infinity): value is number {
    if (!this.real(value, path, 0, max)) return false;
    return value > 0 || this.add(path, `must be > 0, got ${value}`);
  }
  /** A flat array of `length` finite float64 numbers within [min, max]; reports only the first bad element. */
  reals(value: unknown, path: string, length: number, min = -Infinity, max = Infinity): value is number[] {
    if (!Array.isArray(value)) return this.add(path, `must be an array of ${length} numbers, got ${typeName(value)}`);
    this.geometryValues += value.length;
    if (value.length !== length) return this.add(path, `must hold exactly ${length} numbers, got ${value.length}`);
    for (let i = 0; i < length; i++) {
      const v = value[i];
      if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) return this.real(v, `${path}/${i}`, min, max);
    }
    return true;
  }
  realTuple(value: unknown, path: string, length: number): value is number[] {
    if (!Array.isArray(value)) return this.add(path, `must be an array of ${length} numbers, got ${typeName(value)}`);
    if (value.length !== length) return this.add(path, `must hold exactly ${length} numbers, got ${value.length}`);
    let ok = true;
    for (let i = 0; i < length; i++) if (!this.real(value[i], `${path}/${i}`)) ok = false;
    return ok;
  }
  tuple(value: unknown, path: string, length: number, min = -Infinity): value is number[] {
    if (!Array.isArray(value)) return this.add(path, `must be an array of ${length} numbers, got ${typeName(value)}`);
    if (value.length !== length) return this.add(path, `must hold exactly ${length} numbers, got ${value.length}`);
    let ok = true;
    for (let i = 0; i < length; i++) if (!this.number(value[i], `${path}/${i}`, min)) ok = false;
    return ok;
  }
  quaternion(value: unknown, path: string): boolean {
    if (!this.tuple(value, path, 4)) return false;
    const length = Math.hypot(value[0], value[1], value[2], value[3]);
    if (Math.abs(length - 1) > 1e-3) return this.add(path, `must be a unit quaternion [x, y, z, w] (length 1 +- 0.001), got length ${+length.toPrecision(6)}`);
    return true;
  }
  boolean(value: unknown, path: string): value is boolean {
    return typeof value === 'boolean' || this.add(path, `must be true or false, got ${typeName(value)}`);
  }
  string(value: unknown, path: string, max: number): value is string {
    if (typeof value !== 'string') return this.add(path, `must be a string, got ${typeName(value)}`);
    if (value.length > max) return this.add(path, `must be at most ${max} characters, got ${value.length}`);
    return true;
  }
  id(value: unknown, path: string, what = 'id'): value is string {
    if (typeof value !== 'string') return this.add(path, `must be a string, got ${typeName(value)}`);
    if (value.length === 0 || value.length > SCENE_LIMITS.idLength) return this.add(path, `${what} must be 1 to ${SCENE_LIMITS.idLength} characters, got ${value.length}`);
    if (!ID_PATTERN.test(value)) return this.add(path, `${what} may hold only letters, digits and _ . : -, got ${show(value)}`);
    return true;
  }
  /** A flat array of finite float32 numbers; reports only the first bad element. */
  numbers(value: unknown, path: string): value is number[] {
    if (!Array.isArray(value)) return this.add(path, `must be an array of numbers, got ${typeName(value)}`);
    this.geometryValues += value.length;
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (typeof v !== 'number' || !Number.isFinite(v) || !Number.isFinite(Math.fround(v)) || (v !== 0 && Math.fround(v) === 0)) return this.number(v, `${path}/${i}`);
    }
    return true;
  }
  /** Free-form JSON: no functions, bigints, undefined, non-finite numbers, class instances or cycles. */
  json(value: unknown, path: string, depth = 0): boolean {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
    if (typeof value === 'number') return Number.isFinite(value) || this.add(path, `must be a finite number, got ${value}`);
    if (depth >= SCENE_LIMITS.depth) return this.add(path, `is nested deeper than ${SCENE_LIMITS.depth} levels`);
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) if (!this.json(value[i], `${path}/${i}`, depth + 1)) return false;
      return true;
    }
    if (!isObject(value)) return this.add(path, `must be plain JSON, got ${typeName(value)}`);
    for (const key of Object.keys(value)) if (!this.json(value[key], `${path}/${pointer(key)}`, depth + 1)) return false;
    return true;
  }
  freeForm(value: unknown, path: string): boolean {
    if (!isObject(value)) return this.add(path, `must be an object, got ${typeName(value)}`);
    if (!this.json(value, path)) return false;
    const size = stringify(value).length;
    return size <= SCENE_LIMITS.userDataChars || this.add(path, `must be at most ${SCENE_LIMITS.userDataChars} characters of JSON, got ${size}`);
  }
}

function checkWorld(c: Checker, world: unknown, path: string): void {
  if (!c.object(world, path, ['gravity', 'ground', 'seed', 'step', 'subSteps'])) return;
  if (world.gravity !== undefined) c.tuple(world.gravity, `${path}/gravity`, 3);
  if (world.ground !== undefined) c.boolean(world.ground, `${path}/ground`);
  if (world.seed !== undefined) c.number(world.seed, `${path}/seed`, 0, 0xFFFFFFFF, true);
  if (world.step !== undefined && c.number(world.step, `${path}/step`) && !(world.step > 0 && world.step <= 1 / 30)) c.add(`${path}/step`, `must be in (0, 1/30] seconds, got ${world.step}`);
  if (world.subSteps !== undefined) c.number(world.subSteps, `${path}/subSteps`, 1, 16, true);
}

function checkMaterialValues(c: Checker, value: Obj, path: string): void {
  if (value.density !== undefined) c.number(value.density, `${path}/density`, 0);
  if (value.friction !== undefined) c.number(value.friction, `${path}/friction`, 0);
  if (value.restitution !== undefined) c.number(value.restitution, `${path}/restitution`, 0);
  if (value.color !== undefined) c.number(value.color, `${path}/color`, 0, 0xFFFFFFFF, true);
}

function checkMaterials(c: Checker, materials: unknown, path: string): Set<string> {
  const names = new Set<string>();
  if (!isObject(materials)) { c.add(path, `must be an object, got ${typeName(materials)}`); return names; }
  const keys = Object.keys(materials);
  if (keys.length > SCENE_LIMITS.materials) c.add(path, `holds ${keys.length} materials; the limit is ${SCENE_LIMITS.materials}`);
  for (const name of keys) {
    const at = `${path}/${pointer(name)}`;
    if (c.stopped) break;
    if (!c.id(name, at, 'a material name')) continue;
    names.add(name);
    if (c.object(materials[name], at, ['density', 'friction', 'restitution', 'color'], ['density', 'friction', 'restitution'])) checkMaterialValues(c, materials[name] as Obj, at);
  }
  return names;
}

/** True when the points span a volume (four of them are not in one plane). */
function spansVolume(p: readonly number[]): boolean {
  const n = p.length / 3;
  let extent = 0;
  for (let i = 0; i < p.length; i++) extent = Math.max(extent, Math.abs(p[i] - p[i % 3]));
  if (!(extent > 0)) return false;
  const eps = extent * 1e-6;
  let a = 0, best = 0;
  for (let i = 1; i < n; i++) { const d = Math.hypot(p[i * 3] - p[0], p[i * 3 + 1] - p[1], p[i * 3 + 2] - p[2]); if (d > best) { best = d; a = i; } }
  if (best <= eps) return false;
  const ux = (p[a * 3] - p[0]) / best, uy = (p[a * 3 + 1] - p[1]) / best, uz = (p[a * 3 + 2] - p[2]) / best;
  let nx = 0, ny = 0, nz = 0; best = 0;
  for (let i = 1; i < n; i++) {
    const x = p[i * 3] - p[0], y = p[i * 3 + 1] - p[1], z = p[i * 3 + 2] - p[2];
    const cx = uy * z - uz * y, cy = uz * x - ux * z, cz = ux * y - uy * x, d = Math.hypot(cx, cy, cz);
    if (d > best) { best = d; nx = cx / d; ny = cy / d; nz = cz / d; }
  }
  if (best <= eps) return false;
  for (let i = 1; i < n; i++) if (Math.abs((p[i * 3] - p[0]) * nx + (p[i * 3 + 1] - p[1]) * ny + (p[i * 3 + 2] - p[2]) * nz) > eps) return true;
  return false;
}

function checkShape(c: Checker, shape: unknown, path: string): string | null {
  if (!isObject(shape)) { c.add(path, `must be an object, got ${typeName(shape)}`); return null; }
  const kind = shape.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(SHAPE_KEYS, kind)) {
    c.add(`${path}/kind`, `must be 'box', 'sphere', 'capsule', 'hull', 'mesh' or 'heightfield', got ${show(kind)}`);
    return null;
  }
  c.object(shape, path, SHAPE_KEYS[kind], SHAPE_KEYS[kind]);
  if (kind === 'box') { if (shape.halfExtents !== undefined) c.tuple(shape.halfExtents, `${path}/halfExtents`, 3, 1e-4); }
  else if (kind === 'sphere') { if (shape.radius !== undefined) c.number(shape.radius, `${path}/radius`, 1e-4); }
  else if (kind === 'capsule') {
    if (shape.radius !== undefined) c.number(shape.radius, `${path}/radius`, 1e-4);
    if (shape.halfLength !== undefined) c.number(shape.halfLength, `${path}/halfLength`, 0.0025);
  } else if (kind === 'hull') {
    const points = shape.points, at = `${path}/points`;
    if (points !== undefined && c.numbers(points, at)) {
      if (points.length % 3 !== 0) c.add(at, `must hold x, y, z triples; ${points.length} numbers is not a multiple of 3`);
      else if (points.length < 12) c.add(at, `a hull needs at least 4 points, got ${points.length / 3}`);
      else if (points.length > SCENE_LIMITS.hullPoints * 3) c.add(at, `holds ${points.length / 3} points; the limit is ${SCENE_LIMITS.hullPoints}`);
      else if (!spansVolume(points)) c.add(at, 'the points lie in one plane; a hull needs volume');
    }
  } else if (kind === 'mesh') {
    const vertices = shape.vertices, indices = shape.indices;
    let vertexCount = -1;
    if (vertices !== undefined && c.numbers(vertices, `${path}/vertices`)) {
      if (vertices.length % 3 !== 0) c.add(`${path}/vertices`, `must hold x, y, z triples; ${vertices.length} numbers is not a multiple of 3`);
      else if (vertices.length < 9) c.add(`${path}/vertices`, `a mesh needs at least 3 vertices, got ${vertices.length / 3}`);
      else if (vertices.length > SCENE_LIMITS.meshVertices * 3) c.add(`${path}/vertices`, `holds ${vertices.length / 3} vertices; the limit is ${SCENE_LIMITS.meshVertices}`);
      else vertexCount = vertices.length / 3;
    }
    if (indices !== undefined) {
      const at = `${path}/indices`;
      if (!Array.isArray(indices)) c.add(at, `must be an array of integers, got ${typeName(indices)}`);
      else {
        c.geometryValues += indices.length;
        if (indices.length % 3 !== 0) c.add(at, `must hold triangles; ${indices.length} indices is not a multiple of 3`);
        else if (indices.length < 3) c.add(at, 'a mesh needs at least 1 triangle');
        else if (indices.length > SCENE_LIMITS.meshTriangles * 3) c.add(at, `holds ${indices.length / 3} triangles; the limit is ${SCENE_LIMITS.meshTriangles}`);
        else for (let i = 0; i < indices.length; i++) {
          const v = indices[i];
          if (typeof v !== 'number' || !Number.isInteger(v)) { c.add(`${at}/${i}`, `must be an integer, got ${show(v)}`); break; }
          if (v < 0 || (vertexCount >= 0 && v >= vertexCount)) { c.add(`${at}/${i}`, `index ${v} is out of range${vertexCount >= 0 ? `; the mesh has ${vertexCount} vertices` : ''}`); break; }
        }
      }
    }
  } else {
    const okX = shape.countX !== undefined && c.number(shape.countX, `${path}/countX`, 2, SCENE_LIMITS.heightfieldSide, true);
    const okZ = shape.countZ !== undefined && c.number(shape.countZ, `${path}/countZ`, 2, SCENE_LIMITS.heightfieldSide, true);
    if (shape.spacing !== undefined) c.tuple(shape.spacing, `${path}/spacing`, 2, 1e-4);
    if (shape.heights !== undefined && c.numbers(shape.heights, `${path}/heights`) && okX && okZ && shape.heights.length !== (shape.countX as number) * (shape.countZ as number)) {
      c.add(`${path}/heights`, `must hold countX * countZ = ${(shape.countX as number) * (shape.countZ as number)} values, got ${shape.heights.length}`);
    }
  }
  return kind;
}

function checkRotation(c: Checker, owner: Obj, path: string): void {
  if (owner.rotation !== undefined && owner.rotationEuler !== undefined) c.add(`${path}/rotationEuler`, 'give rotation or rotationEuler, not both');
  if (owner.rotation !== undefined) c.quaternion(owner.rotation, `${path}/rotation`);
  if (owner.rotationEuler !== undefined) c.tuple(owner.rotationEuler, `${path}/rotationEuler`, 3);
}

function checkBits(c: Checker, value: unknown, path: string): void {
  if (typeof value !== 'string') c.add(path, `must be an unsigned 64-bit integer as a decimal string, got ${typeName(value)}`);
  else if (!BITS_PATTERN.test(value) || BigInt(value) > MAX_U64) c.add(path, `must be an unsigned 64-bit integer as a decimal string (0 to 18446744073709551615), got ${show(value)}`);
}

function checkBody(c: Checker, body: unknown, path: string, materials: ReadonlySet<string>): void {
  if (!c.object(body, path, BODY_KEYS, ['id', 'shape', 'position'])) return;
  const kind = body.shape === undefined ? null : checkShape(c, body.shape, `${path}/shape`);
  if (body.type !== undefined) {
    if (typeof body.type !== 'string' || !BODY_TYPES.includes(body.type)) c.add(`${path}/type`, `must be 'static', 'kinematic' or 'dynamic', got ${show(body.type)}`);
    else if ((kind === 'mesh' || kind === 'heightfield') && body.type !== 'static') c.add(`${path}/type`, `a ${kind} body is always static, got ${show(body.type)}`);
  }
  if (body.position !== undefined) c.tuple(body.position, `${path}/position`, 3);
  checkRotation(c, body, path);
  if (body.linearVelocity !== undefined) c.tuple(body.linearVelocity, `${path}/linearVelocity`, 3);
  if (body.angularVelocity !== undefined) c.tuple(body.angularVelocity, `${path}/angularVelocity`, 3);
  if (body.material !== undefined) {
    if (typeof body.material !== 'string') c.add(`${path}/material`, `must be a string, got ${typeName(body.material)}`);
    else if (!materials.has(body.material)) c.add(`${path}/material`, `unknown material ${show(body.material)}`);
  }
  checkMaterialValues(c, body, path);
  for (const flag of FLAGS) if (body[flag] !== undefined) c.boolean(body[flag], `${path}/${flag}`);
  if (body.linearDamping !== undefined) c.number(body.linearDamping, `${path}/linearDamping`, 0);
  if (body.angularDamping !== undefined) c.number(body.angularDamping, `${path}/angularDamping`, 0);
  if (body.gravityScale !== undefined) c.number(body.gravityScale, `${path}/gravityScale`);
  const filter = body.filter;
  if (filter !== undefined && c.object(filter, `${path}/filter`, ['categoryBits', 'maskBits', 'groupIndex'])) {
    if (filter.categoryBits !== undefined) checkBits(c, filter.categoryBits, `${path}/filter/categoryBits`);
    if (filter.maskBits !== undefined) checkBits(c, filter.maskBits, `${path}/filter/maskBits`);
    if ((filter.categoryBits === undefined) !== (filter.maskBits === undefined)) c.add(`${path}/filter`, 'needs both categoryBits and maskBits, or neither');
    if (filter.groupIndex !== undefined) c.number(filter.groupIndex, `${path}/filter/groupIndex`, -0x80000000, 0x7FFFFFFF, true);
  }
  if (body.userData !== undefined) c.freeForm(body.userData, `${path}/userData`);
}

function checkFrame(c: Checker, frame: unknown, path: string): void {
  if (!c.object(frame, path, ['position', 'rotation', 'rotationEuler'])) return;
  if (frame.position !== undefined) c.tuple(frame.position, `${path}/position`, 3);
  checkRotation(c, frame, path);
}

/** `hasBody` is null when references cannot be resolved (the body list itself is broken). */
function checkJoint(c: Checker, joint: unknown, path: string, hasBody: ((id: string) => boolean) | null): void {
  if (!c.object(joint, path, JOINT_KEYS, ['id', 'type', 'bodyA', 'bodyB'])) return;
  const type = typeof joint.type === 'string' && JOINT_TYPES.includes(joint.type) ? joint.type : null;
  if (joint.type !== undefined && type === null) c.add(`${path}/type`, `must be 'weld', 'revolute', 'spherical', 'prismatic', 'distance' or 'wheel', got ${show(joint.type)}`);
  for (const side of ['bodyA', 'bodyB']) {
    const ref = joint[side];
    if (ref === undefined || ref === null) continue;
    if (typeof ref !== 'string') c.add(`${path}/${side}`, `must be a body id or null, got ${typeName(ref)}`);
    else if (hasBody && !hasBody(ref)) c.add(`${path}/${side}`, `unknown body id ${show(ref)}`);
  }
  if (joint.bodyA !== undefined && joint.bodyA === joint.bodyB) c.add(`${path}/bodyB`, joint.bodyA === null ? 'bodyA and bodyB cannot both be the world (null)' : `a joint needs two different bodies; both are ${show(joint.bodyA)}`);
  if (joint.frameA !== undefined) checkFrame(c, joint.frameA, `${path}/frameA`);
  if (joint.frameB !== undefined) checkFrame(c, joint.frameB, `${path}/frameB`);
  if (joint.collideConnected !== undefined) c.boolean(joint.collideConnected, `${path}/collideConnected`);
  if (type) for (const feature of ['limits', 'motor', 'spring', 'length', 'coneAngle']) {
    if (joint[feature] !== undefined && !JOINT_FEATURES[type].includes(feature)) c.add(`${path}/${feature}`, `a ${type} joint does not take ${feature}`);
  }
  const {limits, motor, spring} = joint;
  if (limits !== undefined && c.object(limits, `${path}/limits`, ['lower', 'upper'], ['lower', 'upper'])) {
    const lower = limits.lower !== undefined && c.number(limits.lower, `${path}/limits/lower`), upper = limits.upper !== undefined && c.number(limits.upper, `${path}/limits/upper`);
    if (lower && upper && (limits.upper as number) < (limits.lower as number)) c.add(`${path}/limits/upper`, `must be >= lower (${limits.lower}), got ${limits.upper}`);
  }
  if (motor !== undefined && c.object(motor, `${path}/motor`, ['speed', 'maxForce'], ['speed', 'maxForce'])) {
    if (motor.speed !== undefined) c.number(motor.speed, `${path}/motor/speed`);
    if (motor.maxForce !== undefined) c.number(motor.maxForce, `${path}/motor/maxForce`, 0);
  }
  if (spring !== undefined && c.object(spring, `${path}/spring`, ['hertz', 'dampingRatio', 'target'], ['hertz', 'dampingRatio'])) {
    if (spring.hertz !== undefined) c.number(spring.hertz, `${path}/spring/hertz`, 0);
    if (spring.dampingRatio !== undefined) c.number(spring.dampingRatio, `${path}/spring/dampingRatio`, 0);
    if (spring.target !== undefined) c.number(spring.target, `${path}/spring/target`);
  }
  if (joint.length !== undefined) { if (c.number(joint.length, `${path}/length`) && !(joint.length > 0)) c.add(`${path}/length`, `must be > 0, got ${joint.length}`); }
  else if (type === 'distance') c.add(`${path}/length`, 'is required on a distance joint');
  if (joint.coneAngle !== undefined) c.number(joint.coneAngle, `${path}/coneAngle`, 0, Math.PI);
  if (joint.stiffness !== undefined && c.object(joint.stiffness, `${path}/stiffness`, ['hertz', 'dampingRatio'], ['hertz'])) {
    const stiffness = joint.stiffness as {hertz?: unknown; dampingRatio?: unknown};
    if (c.number(stiffness.hertz, `${path}/stiffness/hertz`) && !((stiffness.hertz as number) > 0)) c.add(`${path}/stiffness/hertz`, `must be > 0, got ${String(stiffness.hertz)}`);
    if (stiffness.dampingRatio !== undefined) c.number(stiffness.dampingRatio, `${path}/stiffness/dampingRatio`, 0);
  }
  if (joint.userData !== undefined) c.freeForm(joint.userData, `${path}/userData`);
}

// ---- Coupled sections: water basins, cables and frames ----

const WATER_KEYS = ['id', 'cols', 'rows', 'dx', 'dz', 'restDepth', 'origin', 'density', 'waterDrag', 'eta', 'u', 'v', 'bodies'];
const WATER_BODY_KEYS = ['body', 'dragCoefficient', 'referenceArea', 'linearDrag', 'angularDrag'];
const CABLE_KEYS = ['id', 'solver', 'nodes', 'masses', 'pinned', 'velocities', 'segments', 'substeps', 'maxIterations', 'residualTolerance', 'forceTolerance', 'drag', 'attachments'];
const FRAME_KEYS = ['id', 'nodes', 'elements', 'fixed', 'pointMasses', 'pointInertias', 'displacements', 'velocities', 'drag', 'maxIterations',
  'forceTolerance', 'momentTolerance', 'impulseTolerance', 'angularImpulseTolerance', 'attachments'];
const ELEMENT_KEYS = ['a', 'b', 'youngModulus', 'shearModulus', 'area', 'iy', 'iz', 'torsionConstant', 'density', 'up'];
const INERTIA_KEYS: Record<string, readonly string[]> = {
  box: ['kind', 'halfExtents'], sphere: ['kind', 'radius'], capsule: ['kind', 'radius', 'halfLength'], principal: ['kind', 'moments'], locked: ['kind'],
};
const WET_SHAPES = ['box', 'sphere', 'capsule'];

/** What the coupled sections need to know about the rest of the scene. `shapes` is null when the body list is broken. */
interface CoupledContext {
  readonly shapes: ReadonlyMap<string, string | null> | null;
  readonly step: number;
  /** Downward gravity, m/s^2 (zero when gravity points up or sideways). */
  readonly gravity: number;
  readonly wet: Map<string, string>;
  readonly frameNodes: Map<string, number>;
  frameEquations: number;
}

function flags(c: Checker, value: unknown, path: string, length: number): boolean {
  if (!c.reals(value, path, length, 0, 1)) return false;
  for (let i = 0; i < length; i++) if (value[i] !== 0 && value[i] !== 1) return c.add(`${path}/${i}`, `must be 0 or 1, got ${value[i]}`);
  return true;
}

function checkInertia(c: Checker, inertia: unknown, path: string): void {
  if (!isObject(inertia)) { c.add(path, `must be an object, got ${typeName(inertia)}`); return; }
  const kind = inertia.kind;
  if (typeof kind !== 'string' || !Object.hasOwn(INERTIA_KEYS, kind)) { c.add(`${path}/kind`, `must be 'box', 'sphere', 'capsule', 'principal' or 'locked', got ${show(kind)}`); return; }
  c.object(inertia, path, INERTIA_KEYS[kind], INERTIA_KEYS[kind]);
  const triple = (key: string): void => { const v = inertia[key]; if (v !== undefined && c.realTuple(v, `${path}/${key}`, 3)) for (let i = 0; i < 3; i++) if (!(v[i] > 0)) c.add(`${path}/${key}/${i}`, `must be > 0, got ${v[i]}`); };
  if (kind === 'box') triple('halfExtents');
  else if (kind === 'principal') triple('moments');
  else if (kind !== 'locked') {
    if (inertia.radius !== undefined) c.positive(inertia.radius, `${path}/radius`);
    if (kind === 'capsule' && inertia.halfLength !== undefined) c.positive(inertia.halfLength, `${path}/halfLength`);
  }
}

/** The `body`, `inertia` and `localPoint` of an attachment to a body. */
function checkBodyAttachment(c: Checker, att: Obj, path: string, ctx: CoupledContext): void {
  const ref = att.body;
  if (typeof ref !== 'string') c.add(`${path}/body`, `must be a body id, got ${typeName(ref)}`);
  else if (ctx.shapes) {
    if (!ctx.shapes.has(ref)) c.add(`${path}/body`, `unknown body id ${show(ref)}`);
    else {
      const kind = ctx.shapes.get(ref);
      if (att.inertia === undefined && kind !== null && !WET_SHAPES.includes(kind!)) c.add(`${path}/inertia`, `is required: the inertia of a ${kind} body cannot be taken from its shape`);
    }
  }
  if (att.inertia !== undefined) checkInertia(c, att.inertia, `${path}/inertia`);
  if (att.localPoint !== undefined) c.realTuple(att.localPoint, `${path}/localPoint`, 3);
}

function checkWater(c: Checker, basin: unknown, path: string, ctx: CoupledContext): void {
  if (!c.object(basin, path, WATER_KEYS, ['id', 'cols', 'rows', 'dx', 'dz', 'restDepth', 'origin'])) return;
  const cols = basin.cols !== undefined && c.real(basin.cols, `${path}/cols`, 3, SCENE_LIMITS.waterCells, true) ? basin.cols : 0;
  const rows = basin.rows !== undefined && c.real(basin.rows, `${path}/rows`, 3, SCENE_LIMITS.waterCells, true) ? basin.rows : 0;
  const cells = cols * rows;
  if (cells > SCENE_LIMITS.waterCells) c.add(path, `holds ${cells} cells; the limit is ${SCENE_LIMITS.waterCells}`);
  const dx = basin.dx !== undefined && c.positive(basin.dx, `${path}/dx`, 1e6) ? basin.dx : 0, dz = basin.dz !== undefined && c.positive(basin.dz, `${path}/dz`, 1e6) ? basin.dz : 0;
  const depth = basin.restDepth !== undefined && c.positive(basin.restDepth, `${path}/restDepth`, 1e5) ? basin.restDepth : 0;
  if (basin.origin !== undefined) c.realTuple(basin.origin, `${path}/origin`, 3);
  if (basin.density !== undefined) c.positive(basin.density, `${path}/density`, 1e6);
  const drag = basin.waterDrag !== undefined && c.real(basin.waterDrag, `${path}/waterDrag`, 0) ? basin.waterDrag : 0;
  if (drag * ctx.step > 1) c.add(`${path}/waterDrag`, `waterDrag * step must be <= 1, got ${drag * ctx.step}`);
  if (dx > 0 && dz > 0 && depth > 0 && ctx.gravity > 0) {
    const courant = ctx.step * Math.sqrt(ctx.gravity * depth) * Math.hypot(1 / dx, 1 / dz);
    if (courant > 0.8) c.add(path, `step * sqrt(g * restDepth) * hypot(1/dx, 1/dz) must be <= 0.8 for the water to be stable, got ${+courant.toPrecision(4)}; use larger cells or a smaller world step`);
  }
  if (cells > 0 && cells <= SCENE_LIMITS.waterCells) for (const key of ['eta', 'u', 'v']) if (basin[key] !== undefined) c.reals(basin[key], `${path}/${key}`, cells, -1e6, 1e6);
  if (basin.bodies !== undefined) {
    if (!Array.isArray(basin.bodies)) c.add(`${path}/bodies`, `must be an array, got ${typeName(basin.bodies)}`);
    else for (let i = 0; i < basin.bodies.length && !c.stopped; i++) {
      const entry = basin.bodies[i], at = `${path}/bodies/${i}`;
      if (!c.object(entry, at, WATER_BODY_KEYS, ['body'])) continue;
      const ref = entry.body;
      if (ref !== undefined) {
        if (typeof ref !== 'string') c.add(`${at}/body`, `must be a body id, got ${typeName(ref)}`);
        else {
          if (ctx.shapes) {
            if (!ctx.shapes.has(ref)) c.add(`${at}/body`, `unknown body id ${show(ref)}`);
            else { const kind = ctx.shapes.get(ref); if (kind !== null && !WET_SHAPES.includes(kind!)) c.add(`${at}/body`, `a ${kind} body cannot float: the water couples boxes, spheres and capsules only`); }
          }
          const first = ctx.wet.get(ref);
          if (first !== undefined) c.add(`${at}/body`, `body ${show(ref)} is already in a basin, at ${first}`);
          else ctx.wet.set(ref, `${at}/body`);
        }
      }
      for (const key of ['dragCoefficient', 'referenceArea', 'linearDrag', 'angularDrag']) if (entry[key] !== undefined) c.real(entry[key], `${at}/${key}`, 0);
    }
  }
}

function checkCable(c: Checker, cable: unknown, path: string, ctx: CoupledContext): void {
  if (!c.object(cable, path, CABLE_KEYS, ['id', 'nodes', 'masses', 'segments'])) return;
  const proximal = cable.solver === undefined || cable.solver === 'proximal';
  if (cable.solver !== undefined && cable.solver !== 'proximal' && cable.solver !== 'xpbd') c.add(`${path}/solver`, `must be 'proximal' or 'xpbd', got ${show(cable.solver)}`);
  let count = -1;
  if (cable.masses !== undefined) {
    if (!Array.isArray(cable.masses)) c.add(`${path}/masses`, `must be an array of numbers, got ${typeName(cable.masses)}`);
    else if (cable.masses.length < 2) c.add(`${path}/masses`, `a cable needs at least 2 nodes, got ${cable.masses.length}`);
    else if (cable.masses.length > SCENE_LIMITS.cableNodes) c.add(`${path}/masses`, `holds ${cable.masses.length} nodes; the limit is ${SCENE_LIMITS.cableNodes}`);
    else if (c.reals(cable.masses, `${path}/masses`, cable.masses.length, 1e-9, 1e12)) count = cable.masses.length;
  }
  if (count > 0) {
    if (cable.nodes !== undefined) c.reals(cable.nodes, `${path}/nodes`, 3 * count, -1e9, 1e9);
    if (cable.velocities !== undefined) c.reals(cable.velocities, `${path}/velocities`, 3 * count, -1e9, 1e9);
  }
  const pinned = count > 0 && cable.pinned !== undefined && flags(c, cable.pinned, `${path}/pinned`, count) ? cable.pinned as number[] : null;
  if (pinned && Array.isArray(cable.velocities) && cable.velocities.length === 3 * count) {
    for (let i = 0; i < count; i++) if (pinned[i] && (cable.velocities[3 * i] !== 0 || cable.velocities[3 * i + 1] !== 0 || cable.velocities[3 * i + 2] !== 0)) { c.add(`${path}/velocities/${3 * i}`, `node ${i} is pinned and cannot have a velocity`); break; }
  }
  const linked = new Set<number>();
  if (cable.segments !== undefined) {
    if (!Array.isArray(cable.segments)) c.add(`${path}/segments`, `must be an array, got ${typeName(cable.segments)}`);
    else if (cable.segments.length < 1) c.add(`${path}/segments`, 'a cable needs at least 1 segment');
    else if (cable.segments.length > 4 * SCENE_LIMITS.cableNodes) c.add(`${path}/segments`, `holds ${cable.segments.length} segments; the limit is ${4 * SCENE_LIMITS.cableNodes}`);
    else for (let i = 0; i < cable.segments.length && !c.stopped; i++) {
      const segment = cable.segments[i], at = `${path}/segments/${i}`;
      if (!c.object(segment, at, ['a', 'b', 'restLength', 'compliance'], ['a', 'b', 'restLength', 'compliance'])) continue;
      const a = segment.a !== undefined && c.real(segment.a, `${at}/a`, 0, count > 0 ? count - 1 : Infinity, true), b = segment.b !== undefined && c.real(segment.b, `${at}/b`, 0, count > 0 ? count - 1 : Infinity, true);
      if (a && b) { if (segment.a === segment.b) c.add(`${at}/b`, `a segment needs two different nodes; both are ${segment.a}`); else { linked.add(segment.a as number); linked.add(segment.b as number); } }
      if (segment.restLength !== undefined) c.real(segment.restLength, `${at}/restLength`, 1e-9, 1e9);
      if (segment.compliance !== undefined && c.real(segment.compliance, `${at}/compliance`, 0, 1e12) && segment.compliance > 0 && segment.compliance < 1e-18) c.add(`${at}/compliance`, `must be 0 or at least 1e-18 m/N, got ${segment.compliance}`);
    }
  }
  const substeps = cable.substeps !== undefined && c.real(cable.substeps, `${path}/substeps`, 1, 16, true) ? cable.substeps : 1;
  if (cable.maxIterations !== undefined) c.real(cable.maxIterations, `${path}/maxIterations`, 1, proximal ? 4096 : 256, true);
  if (cable.residualTolerance !== undefined) c.real(cable.residualTolerance, `${path}/residualTolerance`, 0, 1e-2);
  if (cable.forceTolerance !== undefined) { if (!proximal) c.add(`${path}/forceTolerance`, 'only the proximal solver takes forceTolerance'); else c.real(cable.forceTolerance, `${path}/forceTolerance`, 0, 1); }
  if (cable.drag !== undefined && c.real(cable.drag, `${path}/drag`, 0, 1000) && cable.drag > 0 && substeps !== 1) c.add(`${path}/substeps`, 'a cable with drag needs substeps = 1 to be coupled');
  if (cable.attachments !== undefined) {
    if (!Array.isArray(cable.attachments)) c.add(`${path}/attachments`, `must be an array, got ${typeName(cable.attachments)}`);
    else {
      const used = new Set<number>();
      for (let i = 0; i < cable.attachments.length && !c.stopped; i++) {
        const att: unknown = cable.attachments[i], at = `${path}/attachments/${i}`;
        if (!c.object(att, at, ['node', 'body', 'frame', 'frameNode', 'inertia', 'localPoint'], ['node'])) continue;
        if (att.node !== undefined && c.real(att.node, `${at}/node`, 0, count > 0 ? count - 1 : Infinity, true)) {
          const node = att.node;
          if (used.has(node)) c.add(`${at}/node`, `node ${node} is already attached`);
          else if (pinned && pinned[node]) c.add(`${at}/node`, `node ${node} is pinned: attach a free node`);
          else if (Array.isArray(cable.segments) && !linked.has(node)) c.add(`${at}/node`, `node ${node} has no segment`);
          used.add(node);
        }
        if ((att.body !== undefined) === (att.frame !== undefined)) { c.add(at, 'needs exactly one of body and frame'); continue; }
        if (att.body !== undefined) {
          if (att.frameNode !== undefined) c.add(`${at}/frameNode`, 'goes with frame, not with body');
          checkBodyAttachment(c, att, at, ctx);
        } else {
          for (const key of ['inertia', 'localPoint']) if (att[key] !== undefined) c.add(`${at}/${key}`, `goes with body, not with frame`);
          if (typeof att.frame !== 'string') c.add(`${at}/frame`, `must be a frame id, got ${typeName(att.frame)}`);
          else if (!ctx.frameNodes.has(att.frame)) c.add(`${at}/frame`, `unknown frame id ${show(att.frame)}`);
          if (att.frameNode === undefined) c.add(`${at}/frameNode`, 'is required with frame');
          else if (c.real(att.frameNode, `${at}/frameNode`, 0, Infinity, true) && typeof att.frame === 'string' && ctx.frameNodes.has(att.frame)) {
            const nodes = ctx.frameNodes.get(att.frame)!;
            if (nodes >= 0 && att.frameNode >= nodes) c.add(`${at}/frameNode`, `node ${att.frameNode} is out of range; frame ${show(att.frame)} has ${nodes} nodes`);
          }
        }
      }
    }
  }
}

/** Node count of a frame's `nodes` array, or -1 when it cannot be told. */
function frameNodeCount(frame: unknown): number {
  return isObject(frame) && Array.isArray(frame.nodes) && frame.nodes.length % 3 === 0 && frame.nodes.length >= 6 && frame.nodes.length <= 3 * SCENE_LIMITS.frameNodes ? frame.nodes.length / 3 : -1;
}

function checkFrameSection(c: Checker, frame: unknown, path: string, ctx: CoupledContext): void {
  if (!c.object(frame, path, FRAME_KEYS, ['id', 'nodes', 'elements'])) return;
  const count = frameNodeCount(frame);
  if (frame.nodes !== undefined) {
    if (!Array.isArray(frame.nodes)) c.add(`${path}/nodes`, `must be an array of numbers, got ${typeName(frame.nodes)}`);
    else if (count < 0) c.add(`${path}/nodes`, `must hold x, y, z for 2 to ${SCENE_LIMITS.frameNodes} nodes, got ${frame.nodes.length} numbers`);
    else c.reals(frame.nodes, `${path}/nodes`, 3 * count, -1e6, 1e6);
  }
  if (frame.elements !== undefined) {
    if (!Array.isArray(frame.elements)) c.add(`${path}/elements`, `must be an array, got ${typeName(frame.elements)}`);
    else if (frame.elements.length < 1) c.add(`${path}/elements`, 'a frame needs at least 1 element');
    else if (frame.elements.length > SCENE_LIMITS.frameElements) c.add(`${path}/elements`, `holds ${frame.elements.length} elements; the limit is ${SCENE_LIMITS.frameElements}`);
    else for (let i = 0; i < frame.elements.length && !c.stopped; i++) {
      const element = frame.elements[i], at = `${path}/elements/${i}`;
      if (!c.object(element, at, ELEMENT_KEYS, ELEMENT_KEYS)) continue;
      const a = element.a !== undefined && c.real(element.a, `${at}/a`, 0, count > 0 ? count - 1 : Infinity, true), b = element.b !== undefined && c.real(element.b, `${at}/b`, 0, count > 0 ? count - 1 : Infinity, true);
      if (a && b && element.a === element.b) c.add(`${at}/b`, `an element needs two different nodes; both are ${element.a}`);
      for (const [key, min, max] of [['youngModulus', 1, 1e13], ['shearModulus', 1, 1e13], ['area', 1e-10, 1e4], ['iy', 1e-16, 1e8], ['iz', 1e-16, 1e8], ['torsionConstant', 1e-16, 1e8], ['density', 1e-6, 1e6]] as const) {
        if (element[key] !== undefined) c.real(element[key], `${at}/${key}`, min, max);
      }
      if (element.up !== undefined && c.realTuple(element.up, `${at}/up`, 3) && element.up.some(v => Math.abs(v) > 1)) c.add(`${at}/up`, 'each component must be within [-1, 1]');
    }
  }
  if (count > 0) {
    const fixed = frame.fixed !== undefined && flags(c, frame.fixed, `${path}/fixed`, 6 * count) ? frame.fixed as number[] : null;
    if (frame.pointMasses !== undefined) c.reals(frame.pointMasses, `${path}/pointMasses`, count, 0, 1e12);
    if (frame.pointInertias !== undefined) c.reals(frame.pointInertias, `${path}/pointInertias`, 3 * count, 0, 1e18);
    for (const [key, limit] of [['displacements', 1e6], ['velocities', 1e9]] as const) {
      const values = frame[key];
      if (values === undefined || !c.reals(values, `${path}/${key}`, 6 * count, -limit, limit) || !fixed) continue;
      for (let j = 0; j < fixed.length; j++) if (fixed[j] && values[j] !== 0) { c.add(`${path}/${key}/${j}`, 'a fixed degree of freedom cannot move'); break; }
    }
  }
  if (frame.drag !== undefined) c.real(frame.drag, `${path}/drag`, 0, 1000);
  if (frame.maxIterations !== undefined) c.real(frame.maxIterations, `${path}/maxIterations`, 1, 1024, true);
  for (const [key, min] of [['forceTolerance', 1e-14], ['momentTolerance', 1e-14], ['impulseTolerance', 1e-16], ['angularImpulseTolerance', 1e-16]] as const) if (frame[key] !== undefined) c.real(frame[key], `${path}/${key}`, min, 1);
  if (frame.attachments !== undefined) {
    if (!Array.isArray(frame.attachments)) c.add(`${path}/attachments`, `must be an array, got ${typeName(frame.attachments)}`);
    else for (let i = 0; i < frame.attachments.length && !c.stopped; i++) {
      const att: unknown = frame.attachments[i], at = `${path}/attachments/${i}`;
      if (!c.object(att, at, ['node', 'body', 'mode', 'inertia', 'localPoint'], ['node', 'body'])) continue;
      if (att.node !== undefined) c.real(att.node, `${at}/node`, 0, count > 0 ? count - 1 : Infinity, true);
      if (att.mode !== undefined && att.mode !== 'pinned' && att.mode !== 'clamped') c.add(`${at}/mode`, `must be 'pinned' or 'clamped', got ${show(att.mode)}`);
      if (att.body !== undefined) checkBodyAttachment(c, att, at, ctx);
      ctx.frameEquations += att.mode === 'clamped' ? 6 : 3;
    }
  }
}

/**
 * Check a scene completely, before anything is built. Returns every problem
 * found (at most SCENE_LIMITS.problems), each with a JSON-pointer path; an
 * empty list means the scene is valid. Never throws, whatever it is given.
 */
export function validateScene(scene: unknown): SceneProblem[] {
  const c = new Checker();
  if (!isObject(scene)) { c.add('', `a scene must be an object, got ${typeName(scene)}`); return c.problems; }
  if (scene.format !== SCENE_FORMAT) { c.add('/format', `must be '${SCENE_FORMAT}', got ${scene.format === undefined ? 'nothing' : show(scene.format)}`); return c.problems; }
  if (scene.version !== SCENE_VERSION) {
    c.add('/version', Number.isInteger(scene.version) && (scene.version as number) > 0
      ? `unsupported scene version ${scene.version}; this build reads version ${SCENE_VERSION} only`
      : `must be the integer ${SCENE_VERSION}, got ${scene.version === undefined ? 'nothing' : show(scene.version)}`);
    return c.problems;
  }
  c.object(scene, '', ['format', 'version', 'units', 'world', 'materials', 'bodies', 'joints', 'water', 'cables', 'frames', 'meta', 'extensions'], ['bodies']);
  if (scene.units !== undefined && scene.units !== 'SI') c.add('/units', `must be 'SI', got ${show(scene.units)}`);
  if (scene.world !== undefined) checkWorld(c, scene.world, '/world');
  const materials = scene.materials === undefined ? new Set<string>() : checkMaterials(c, scene.materials, '/materials');
  const ids = new Map<string, string>(), bodyIds = new Set<string>();
  const claim = (item: unknown, path: string, isBody: boolean): void => {
    if (!isObject(item) || item.id === undefined || !c.id(item.id, `${path}/id`)) return;
    const first = ids.get(item.id);
    if (first !== undefined) { c.add(`${path}/id`, `duplicate id ${show(item.id)}; first used at ${first}`); return; }
    ids.set(item.id, `${path}/id`);
    if (isBody) bodyIds.add(item.id);
  };
  let bodiesOk = false;
  if (scene.bodies !== undefined) {
    if (!Array.isArray(scene.bodies)) c.add('/bodies', `must be an array, got ${typeName(scene.bodies)}`);
    else if (scene.bodies.length > SCENE_LIMITS.bodies) c.add('/bodies', `holds ${scene.bodies.length} bodies; the limit is ${SCENE_LIMITS.bodies}`);
    else {
      bodiesOk = true;
      for (let i = 0; i < scene.bodies.length && !c.stopped; i++) { checkBody(c, scene.bodies[i], `/bodies/${i}`, materials); claim(scene.bodies[i], `/bodies/${i}`, true); }
    }
  }
  if (scene.joints !== undefined) {
    if (!Array.isArray(scene.joints)) c.add('/joints', `must be an array, got ${typeName(scene.joints)}`);
    else if (scene.joints.length > SCENE_LIMITS.joints) c.add('/joints', `holds ${scene.joints.length} joints; the limit is ${SCENE_LIMITS.joints}`);
    else for (let i = 0; i < scene.joints.length && !c.stopped; i++) { checkJoint(c, scene.joints[i], `/joints/${i}`, bodiesOk ? id => bodyIds.has(id) : null); claim(scene.joints[i], `/joints/${i}`, false); }
  }
  const shapeValues = c.geometryValues;
  if (shapeValues > SCENE_LIMITS.geometryValues) c.add('/bodies', `the shapes hold ${c.geometryValues} numbers together; the limit is ${SCENE_LIMITS.geometryValues}`);
  if (scene.water !== undefined || scene.cables !== undefined || scene.frames !== undefined) {
    const shapes = new Map<string, string | null>();
    if (bodiesOk) for (const body of scene.bodies as unknown[]) if (isObject(body) && typeof body.id === 'string' && bodyIds.has(body.id)) shapes.set(body.id, isObject(body.shape) && typeof body.shape.kind === 'string' ? body.shape.kind : null);
    const world = isObject(scene.world) ? scene.world : {}, step = typeof world.step === 'number' && world.step > 0 && world.step <= 1 / 30 ? world.step : 1 / 60;
    const gy = Array.isArray(world.gravity) && typeof world.gravity[1] === 'number' && Number.isFinite(world.gravity[1]) ? world.gravity[1] : -9.81;
    const ctx: CoupledContext = {shapes: bodiesOk ? shapes : null, step, gravity: Math.max(0, -gy), wet: new Map(), frameNodes: new Map(), frameEquations: 0};
    const section = (key: 'water' | 'cables' | 'frames', limit: number, each: (item: unknown, path: string) => void): void => {
      const list = scene[key];
      if (list === undefined) return;
      if (!Array.isArray(list)) c.add(`/${key}`, `must be an array, got ${typeName(list)}`);
      else if (list.length > limit) c.add(`/${key}`, `holds ${list.length} entries; the limit is ${limit}`);
      else for (let i = 0; i < list.length && !c.stopped; i++) { each(list[i], `/${key}/${i}`); claim(list[i], `/${key}/${i}`, false); }
    };
    // Frames first: a cable may be attached to one.
    if (Array.isArray(scene.frames)) for (const frame of scene.frames) if (isObject(frame) && typeof frame.id === 'string') ctx.frameNodes.set(frame.id, frameNodeCount(frame));
    section('frames', SCENE_LIMITS.frames, (item, path) => checkFrameSection(c, item, path, ctx));
    section('cables', SCENE_LIMITS.cables, (item, path) => checkCable(c, item, path, ctx));
    section('water', SCENE_LIMITS.waterBasins, (item, path) => checkWater(c, item, path, ctx));
    if (ctx.frameEquations > SCENE_LIMITS.frameBodyEquations) c.add('/frames', `the frame attachments need ${ctx.frameEquations} equations (3 per pinned, 6 per clamped); the limit is ${SCENE_LIMITS.frameBodyEquations}`);
    if (c.geometryValues > SCENE_LIMITS.geometryValues && shapeValues <= SCENE_LIMITS.geometryValues) c.add('', `the scene's arrays hold ${c.geometryValues} numbers together; the limit is ${SCENE_LIMITS.geometryValues}`);
  }
  if (scene.meta !== undefined && c.object(scene.meta, '/meta', ['title', 'description', 'author', 'created'])) {
    for (const key of ['title', 'description', 'author']) if (scene.meta[key] !== undefined) c.string(scene.meta[key], `/meta/${key}`, SCENE_LIMITS.metaChars);
    const created = scene.meta.created;
    if (created !== undefined && c.string(created, '/meta/created', 64) && Number.isNaN(Date.parse(created))) c.add('/meta/created', `must be a date, e.g. 2026-11-11T12:00:00Z, got ${show(created)}`);
  }
  if (scene.extensions !== undefined) c.freeForm(scene.extensions, '/extensions');
  return c.problems;
}

function assertValid(scene: unknown): Scene {
  const problems = validateScene(scene);
  if (problems.length > 0) throw new SceneValidationError(problems);
  return scene as Scene;
}

// ---------------------------------------------------------------------------
// Normal form, canonical text and hash
// ---------------------------------------------------------------------------

const zero = (v: number): number => v === 0 ? 0 : v;   // -0 -> 0
const vec = (v: readonly number[]): number[] => v.map(zero);
const isZero = (v: readonly number[]): boolean => v.every(x => x === 0);
const isIdentity = (q: readonly number[]): boolean => q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1;

/** Degrees about X, Y, Z to a quaternion, q = qx qy qz (a vector is turned about Z first, then Y, then X: the three.js 'XYZ' order). */
export function eulerToQuaternion(degrees: SceneVec3): [number, number, number, number] {
  const k = Math.PI / 360, c1 = Math.cos(degrees[0] * k), c2 = Math.cos(degrees[1] * k), c3 = Math.cos(degrees[2] * k);
  const s1 = Math.sin(degrees[0] * k), s2 = Math.sin(degrees[1] * k), s3 = Math.sin(degrees[2] * k);
  return [zero(s1 * c2 * c3 + c1 * s2 * s3), zero(c1 * s2 * c3 - s1 * c2 * s3), zero(c1 * c2 * s3 + s1 * s2 * c3), zero(c1 * c2 * c3 - s1 * s2 * s3)];
}

const rotationOf = (owner: {rotation?: SceneQuat; rotationEuler?: SceneVec3}): number[] | undefined =>
  owner.rotation ? vec(owner.rotation) : owner.rotationEuler ? eulerToQuaternion(owner.rotationEuler) : undefined;

const WORLD_DEFAULTS = {gravity: [0, -9.81, 0] as SceneVec3, ground: true, seed: 1, step: 1 / 60, subSteps: 4};
const worldOf = (world: SceneWorld | undefined): Required<SceneWorld> => ({
  gravity: vec(world?.gravity ?? WORLD_DEFAULTS.gravity) as unknown as SceneVec3, ground: world?.ground ?? true, seed: world?.seed ?? 1,
  step: world?.step ?? WORLD_DEFAULTS.step, subSteps: world?.subSteps ?? 4,
});

function normalShape(shape: SceneShape): SceneShape {
  switch (shape.kind) {
    case 'box': return {kind: 'box', halfExtents: vec(shape.halfExtents) as unknown as SceneVec3};
    case 'sphere': return {kind: 'sphere', radius: shape.radius};
    case 'capsule': return {kind: 'capsule', radius: shape.radius, halfLength: shape.halfLength};
    case 'hull': return {kind: 'hull', points: vec(shape.points)};
    case 'mesh': return {kind: 'mesh', vertices: vec(shape.vertices), indices: vec(shape.indices)};
    case 'heightfield': return {kind: 'heightfield', heights: vec(shape.heights), countX: shape.countX, countZ: shape.countZ, spacing: [shape.spacing[0], shape.spacing[1]]};
  }
}

// A value equal to the engine default is dropped, so that writing a default out and leaving it out give the same text.
function normalBody(body: SceneBody): SceneBody {
  const out: Obj = {id: body.id, shape: normalShape(body.shape)};
  const fixed = body.shape.kind === 'mesh' || body.shape.kind === 'heightfield';
  if (!fixed && body.type !== undefined && body.type !== 'dynamic') out.type = body.type;
  out.position = vec(body.position);
  const rotation = rotationOf(body);
  if (rotation && !isIdentity(rotation)) out.rotation = rotation;
  if (body.linearVelocity && !isZero(body.linearVelocity)) out.linearVelocity = vec(body.linearVelocity);
  if (body.angularVelocity && !isZero(body.angularVelocity)) out.angularVelocity = vec(body.angularVelocity);
  // With a named material an inline value is an override, so it stays even when it equals the engine default.
  const named = body.material !== undefined;
  if (named) out.material = body.material;
  if (body.density !== undefined && (named || body.density !== 1000)) out.density = body.density;
  if (body.friction !== undefined && (named || body.friction !== 0.6)) out.friction = body.friction;
  if (body.restitution !== undefined && (named || body.restitution !== 0)) out.restitution = zero(body.restitution);
  if (body.color !== undefined && (named || body.color !== 0xB8C0CC)) out.color = body.color;
  for (const flag of FLAGS) if (body[flag]) out[flag] = true;
  if (body.linearDamping) out.linearDamping = body.linearDamping;
  if (body.angularDamping) out.angularDamping = body.angularDamping;
  if (body.gravityScale !== undefined && body.gravityScale !== 1) out.gravityScale = zero(body.gravityScale);
  if (body.filter) {
    const filter: Obj = {};
    if (body.filter.categoryBits !== undefined) { filter.categoryBits = body.filter.categoryBits; filter.maskBits = body.filter.maskBits; }
    if (body.filter.groupIndex) filter.groupIndex = body.filter.groupIndex;
    if (Object.keys(filter).length > 0) out.filter = filter;
  }
  if (body.userData !== undefined) out.userData = clone(body.userData);
  return out as unknown as SceneBody;
}

function normalFrame(frame: SceneFrame | undefined): SceneFrame | undefined {
  if (!frame) return undefined;
  const out: Obj = {}, rotation = rotationOf(frame);
  if (frame.position && !isZero(frame.position)) out.position = vec(frame.position);
  if (rotation && !isIdentity(rotation)) out.rotation = rotation;
  return Object.keys(out).length > 0 ? out as SceneFrame : undefined;
}

function normalJoint(joint: SceneJoint): SceneJoint {
  const out: Obj = {id: joint.id, type: joint.type, bodyA: joint.bodyA, bodyB: joint.bodyB};
  const frameA = normalFrame(joint.frameA), frameB = normalFrame(joint.frameB);
  if (frameA) out.frameA = frameA;
  if (frameB) out.frameB = frameB;
  if (joint.collideConnected) out.collideConnected = true;
  if (joint.limits) out.limits = {lower: zero(joint.limits.lower), upper: zero(joint.limits.upper)};
  if (joint.motor) out.motor = {speed: zero(joint.motor.speed), maxForce: zero(joint.motor.maxForce)};
  if (joint.spring) out.spring = {hertz: zero(joint.spring.hertz), dampingRatio: zero(joint.spring.dampingRatio), ...(joint.spring.target ? {target: joint.spring.target} : {})};
  if (joint.length !== undefined) out.length = joint.length;
  if (joint.coneAngle !== undefined) out.coneAngle = zero(joint.coneAngle);
  if (joint.stiffness) out.stiffness = {hertz: joint.stiffness.hertz, ...(joint.stiffness.dampingRatio !== undefined && joint.stiffness.dampingRatio !== 2 ? {dampingRatio: zero(joint.stiffness.dampingRatio)} : {})};
  if (joint.userData !== undefined) out.userData = clone(joint.userData);
  return out as unknown as SceneJoint;
}

const allZero = (v: readonly number[] | undefined): boolean => v === undefined || v.every(x => x === 0);

function normalInertia(inertia: SceneInertia): SceneInertia {
  switch (inertia.kind) {
    case 'box': return {kind: 'box', halfExtents: vec(inertia.halfExtents) as unknown as SceneVec3};
    case 'sphere': return {kind: 'sphere', radius: inertia.radius};
    case 'capsule': return {kind: 'capsule', radius: inertia.radius, halfLength: inertia.halfLength};
    case 'principal': return {kind: 'principal', moments: vec(inertia.moments) as unknown as SceneVec3};
    case 'locked': return {kind: 'locked'};
  }
}

function normalWater(basin: SceneWater): SceneWater {
  const out: Obj = {id: basin.id, cols: basin.cols, rows: basin.rows, dx: basin.dx, dz: basin.dz, restDepth: basin.restDepth, origin: vec(basin.origin)};
  if (basin.density !== undefined && basin.density !== 1000) out.density = basin.density;
  if (basin.waterDrag) out.waterDrag = basin.waterDrag;
  for (const key of ['eta', 'u', 'v'] as const) if (!allZero(basin[key])) out[key] = vec(basin[key]!);
  if (basin.bodies && basin.bodies.length > 0) out.bodies = basin.bodies.map(entry => {
    const one: Obj = {body: entry.body};
    if (entry.dragCoefficient !== undefined) one.dragCoefficient = zero(entry.dragCoefficient);
    if (entry.referenceArea !== undefined) one.referenceArea = zero(entry.referenceArea);
    if (entry.linearDrag) one.linearDrag = entry.linearDrag;
    if (entry.angularDrag) one.angularDrag = entry.angularDrag;
    return one;
  });
  return out as unknown as SceneWater;
}

function normalBodyAttachment(att: {inertia?: SceneInertia; localPoint?: SceneVec3}, out: Obj): void {
  if (att.inertia) out.inertia = normalInertia(att.inertia);
  if (att.localPoint) out.localPoint = vec(att.localPoint);
}

function normalCable(cable: SceneCable): SceneCable {
  const out: Obj = {id: cable.id, nodes: vec(cable.nodes), masses: vec(cable.masses)}, proximal = cable.solver !== 'xpbd';
  if (!proximal) out.solver = 'xpbd';
  if (!allZero(cable.pinned)) out.pinned = vec(cable.pinned!);
  if (!allZero(cable.velocities)) out.velocities = vec(cable.velocities!);
  out.segments = cable.segments.map(s => ({a: s.a, b: s.b, restLength: s.restLength, compliance: zero(s.compliance)}));
  if (cable.substeps !== undefined && cable.substeps !== 1) out.substeps = cable.substeps;
  if (cable.maxIterations !== undefined && cable.maxIterations !== 64) out.maxIterations = cable.maxIterations;
  if (cable.residualTolerance !== undefined && cable.residualTolerance !== 1e-10) out.residualTolerance = zero(cable.residualTolerance);
  if (proximal && cable.forceTolerance !== undefined && cable.forceTolerance !== 1e-6) out.forceTolerance = zero(cable.forceTolerance);
  if (cable.drag) out.drag = cable.drag;
  if (cable.attachments && cable.attachments.length > 0) out.attachments = cable.attachments.map(att => {
    const one: Obj = {node: att.node};
    if (att.body !== undefined) { one.body = att.body; normalBodyAttachment(att, one); } else { one.frame = att.frame; one.frameNode = att.frameNode; }
    return one;
  });
  return out as unknown as SceneCable;
}

function normalFrameSection(frame: SceneFrameSection): SceneFrameSection {
  const out: Obj = {id: frame.id, nodes: vec(frame.nodes)};
  out.elements = frame.elements.map(e => ({a: e.a, b: e.b, youngModulus: e.youngModulus, shearModulus: e.shearModulus, area: e.area, iy: e.iy, iz: e.iz, torsionConstant: e.torsionConstant, density: e.density, up: vec(e.up)}));
  for (const key of ['fixed', 'pointMasses', 'pointInertias', 'displacements', 'velocities'] as const) if (!allZero(frame[key])) out[key] = vec(frame[key]!);
  if (frame.drag) out.drag = frame.drag;
  if (frame.maxIterations !== undefined && frame.maxIterations !== 1024) out.maxIterations = frame.maxIterations;
  for (const [key, standard] of [['forceTolerance', 1e-9], ['momentTolerance', 1e-9], ['impulseTolerance', 1e-10], ['angularImpulseTolerance', 1e-10]] as const) if (frame[key] !== undefined && frame[key] !== standard) out[key] = frame[key];
  if (frame.attachments && frame.attachments.length > 0) out.attachments = frame.attachments.map(att => {
    const one: Obj = {node: att.node, body: att.body};
    if (att.mode === 'clamped') one.mode = 'clamped';
    normalBodyAttachment(att, one);
    return one;
  });
  return out as unknown as SceneFrameSection;
}

/** The coupled sections of a scene in normal form; a section that is absent or empty is left out. */
function normalCoupled(scene: SceneCoupledSections): SceneCoupledSections {
  return {
    ...(scene.water && scene.water.length > 0 ? {water: scene.water.map(normalWater)} : {}),
    ...(scene.cables && scene.cables.length > 0 ? {cables: scene.cables.map(normalCable)} : {}),
    ...(scene.frames && scene.frames.length > 0 ? {frames: scene.frames.map(normalFrameSection)} : {}),
  };
}

/** True when a scene has a water basin, a cable or a frame: it then needs a Simulation, not just a rigid world. */
export function sceneHasCoupling(scene: SceneCoupledSections): boolean {
  return (scene.water?.length ?? 0) + (scene.cables?.length ?? 0) + (scene.frames?.length ?? 0) > 0;
}

function clone<T>(value: T): T {
  if (Array.isArray(value)) return value.map(clone) as unknown as T;
  if (value !== null && typeof value === 'object') { const out: Obj = {}; for (const key of Object.keys(value)) out[key] = clone((value as Obj)[key]); return out as T; }
  return (typeof value === 'number' ? zero(value) : value) as T;
}

function normalize(scene: Scene): Scene {
  const materials: Record<string, SceneMaterial> = {};
  for (const name of Object.keys(scene.materials ?? {}).sort()) {
    const m = scene.materials![name];
    materials[name] = {density: zero(m.density), friction: zero(m.friction), restitution: zero(m.restitution), ...(m.color !== undefined ? {color: m.color} : {})};
  }
  const meta: Obj = {};
  for (const key of ['title', 'description', 'author', 'created'] as const) if (scene.meta?.[key] !== undefined) meta[key] = scene.meta[key];
  return {
    format: SCENE_FORMAT, version: SCENE_VERSION, units: 'SI', world: worldOf(scene.world), materials,
    bodies: scene.bodies.map(normalBody), joints: (scene.joints ?? []).map(normalJoint),
    // Left out when absent or empty, so that a rigid-only scene has the canonical text and hash it always had.
    ...normalCoupled(scene),
    ...(Object.keys(meta).length > 0 ? {meta: meta as SceneMeta} : {}),
    ...(scene.extensions !== undefined ? {extensions: clone(scene.extensions)} : {}),
  };
}

/**
 * The normal form of a valid scene, as a new object: every world setting
 * present, `rotationEuler` turned into `rotation`, values equal to the engine
 * defaults dropped, -0 written as 0, `units`, `materials` and `joints` always
 * present; `water`, `cables` and `frames` present only when they hold something.
 * Body and joint order is kept, because it is the build order. Throws
 * SceneValidationError for an invalid scene. Normalising twice changes nothing.
 */
export function normalizeScene(scene: unknown): Scene { return normalize(assertValid(scene)); }

// JSON with object keys in UTF-16 code-unit order and numbers as ECMAScript prints them (the shortest text that reads back to the same double).
function stringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as Obj;
    return `{${Object.keys(object).filter(key => object[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stringify(object[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function pretty(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.every(item => item === null || typeof item !== 'object')) return stringify(value);
    return `[\n${value.map(item => `${indent}  ${pretty(item, indent + '  ')}`).join(',\n')}\n${indent}]`;
  }
  if (value !== null && typeof value === 'object') {
    const object = value as Obj, keys = Object.keys(object).filter(key => object[key] !== undefined).sort();
    if (keys.length === 0) return '{}';
    return `{\n${keys.map(key => `${indent}  ${JSON.stringify(key)}: ${pretty(object[key], indent + '  ')}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}

/**
 * The canonical text of a scene: its normal form (see normalizeScene) as JSON
 * with sorted keys, no whitespace, and numbers in their shortest round-trip
 * form. Two scenes that describe the same thing give the same text, whatever
 * their key order. `pretty: true` gives the same content on several lines
 * (one key per line, arrays of numbers on one line) for reading and diffing;
 * hashes and links always use the compact text.
 */
export function canonicalize(scene: unknown, options: {readonly pretty?: boolean} = {}): string {
  const normal = normalizeScene(scene);
  return options.pretty ? pretty(normal, '') + '\n' : stringify(normal);
}

const SHA_K = /* @__PURE__ */ (() => {
  const k = new Uint32Array(64);
  for (let n = 2, i = 0; i < 64; n++) {
    let prime = true;
    for (let d = 2; d * d <= n; d++) if (n % d === 0) { prime = false; break; }
    if (prime) k[i++] = (Math.cbrt(n) % 1) * 0x100000000;
  }
  return k;
})();

function sha256(data: Uint8Array): string {
  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const padded = new Uint8Array(((data.length + 9 + 63) >> 6) << 6), view = new DataView(padded.buffer), w = new Uint32Array(64);
  padded.set(data); padded[data.length] = 0x80;
  view.setUint32(padded.length - 8, Math.floor(data.length / 0x20000000)); view.setUint32(padded.length - 4, (data.length << 3) >>> 0);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  for (let o = 0; o < padded.length; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = w[i - 15], b = w[i - 2];
      w[i] = w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10));
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let i = 0; i < 64; i++) {
      const t1 = (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + SHA_K[i] + w[i]) | 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) | 0;
      hh = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e; h[5] += f; h[6] += g; h[7] += hh;
  }
  return Array.from(h, x => x.toString(16).padStart(8, '0')).join('');
}

/** SHA-256 of the compact canonical text (UTF-8), as 64 lowercase hex digits. Equal scenes have equal hashes. */
export function sceneHash(scene: unknown): string { return sha256(new TextEncoder().encode(canonicalize(scene))); }

// ---------------------------------------------------------------------------
// Share links
// ---------------------------------------------------------------------------

/** Every share link of this version starts with this, followed by 'd' (raw DEFLATE) or 'r' (stored). */
export const SCENE_LINK_PREFIX = 'b3s1';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const B64_VALUE = /* @__PURE__ */ (() => { const t = new Int8Array(128).fill(-1); for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i; return t; })();
const CRC_TABLE = /* @__PURE__ */ (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c; }
  return t;
})();
const linkError = (message: string): EngineError => new EngineError('INVALID_PAYLOAD', `Scene link: ${message}`);

function crc32(bytes: Uint8Array): number {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function toBase64Url(bytes: Uint8Array): string {
  const parts: string[] = [];
  let chunk = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    chunk += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    if (i + 1 < bytes.length) chunk += B64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    if (i + 2 < bytes.length) chunk += B64[c & 63];
    if (chunk.length >= 8192) { parts.push(chunk); chunk = ''; }
  }
  return parts.join('') + chunk;
}

function fromBase64Url(text: string): Uint8Array {
  if (text.length % 4 === 1) throw linkError('the data is cut off (not a whole number of bytes).');
  const out = new Uint8Array(Math.floor(text.length * 3 / 4));
  let bits = 0, count = 0, o = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i), v = code < 128 ? B64_VALUE[code] : -1;
    if (v < 0) throw linkError(`character ${i} of the data is not base64url.`);
    bits = (bits << 6) | v; count += 6;
    if (count >= 8) { count -= 8; out[o++] = (bits >> count) & 0xFF; }
  }
  if ((bits & ((1 << count) - 1)) !== 0) throw linkError('the data ends in stray bits.');
  return out;
}

const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
interface Huffman { count: Uint16Array; symbol: Uint16Array }

function huffman(lengths: ArrayLike<number>, n: number): Huffman {
  const count = new Uint16Array(16), symbol = new Uint16Array(n), offsets = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lengths[i]]++;
  let left = 1;
  for (let len = 1; len < 16; len++) { left = (left << 1) - count[len]; if (left < 0) throw linkError('the compressed data is corrupt (bad code table).'); }
  for (let len = 1; len < 15; len++) offsets[len + 1] = offsets[len] + count[len];
  for (let i = 0; i < n; i++) if (lengths[i] !== 0) symbol[offsets[lengths[i]]++] = i;
  return {count, symbol};
}

/**
 * Raw DEFLATE (RFC 1951) decoder that refuses to produce more than `limit`
 * bytes: the output buffer is `limit` long and nothing is written past it.
 */
function inflateRaw(src: Uint8Array, limit: number): Uint8Array {
  const out = new Uint8Array(limit);
  let pos = 0, op = 0, hold = 0, held = 0;
  const corrupt = () => linkError('the compressed data is corrupt.');
  const bomb = () => linkError(`the data decompresses to more than the ${limit} bytes it declares; refused.`);
  const bits = (n: number): number => {
    while (held < n) { if (pos >= src.length) throw linkError('the compressed data is cut off.'); hold |= src[pos++] << held; held += 8; }
    const v = hold & ((1 << n) - 1);
    hold >>>= n; held -= n;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.count[len];
      if (code - count < first) return h.symbol[index + (code - first)];
      index += count; first = (first + count) << 1; code <<= 1;
    }
    throw corrupt();
  };
  let fixed: [Huffman, Huffman] | null = null;
  for (let last = 0; !last;) {
    last = bits(1);
    const type = bits(2);
    if (type === 0) {
      hold = 0; held = 0;
      if (pos + 4 > src.length) throw linkError('the compressed data is cut off.');
      const length = src[pos] | (src[pos + 1] << 8), check = src[pos + 2] | (src[pos + 3] << 8);
      pos += 4;
      if ((length ^ check) !== 0xFFFF) throw corrupt();
      if (pos + length > src.length) throw linkError('the compressed data is cut off.');
      if (op + length > limit) throw bomb();
      out.set(src.subarray(pos, pos + length), op); op += length; pos += length;
      continue;
    }
    if (type === 3) throw corrupt();
    let lit: Huffman, dist: Huffman;
    if (type === 1) {
      if (!fixed) {
        const lengths = new Uint8Array(288);
        lengths.fill(8, 0, 144); lengths.fill(9, 144, 256); lengths.fill(7, 256, 280); lengths.fill(8, 280, 288);
        fixed = [huffman(lengths, 288), huffman(new Uint8Array(30).fill(5), 30)];
      }
      [lit, dist] = fixed;
    } else {
      const nlit = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
      if (nlit > 286 || ndist > 30) throw corrupt();
      const lengths = new Uint8Array(320);
      for (let i = 0; i < ncode; i++) lengths[CODE_ORDER[i]] = bits(3);
      const codes = huffman(lengths.subarray(0, 19), 19), all = new Uint8Array(nlit + ndist);
      for (let i = 0; i < nlit + ndist;) {
        const symbol = decode(codes);
        if (symbol < 16) { all[i++] = symbol; continue; }
        let value = 0, repeat: number;
        if (symbol === 16) { if (i === 0) throw corrupt(); value = all[i - 1]; repeat = 3 + bits(2); }
        else repeat = symbol === 17 ? 3 + bits(3) : 11 + bits(7);
        if (i + repeat > nlit + ndist) throw corrupt();
        while (repeat--) all[i++] = value;
      }
      if (all[256] === 0) throw corrupt();
      lit = huffman(all.subarray(0, nlit), nlit); dist = huffman(all.subarray(nlit), ndist);
    }
    for (;;) {
      const symbol = decode(lit);
      if (symbol < 256) { if (op >= limit) throw bomb(); out[op++] = symbol; continue; }
      if (symbol === 256) break;
      if (symbol > 285) throw corrupt();
      const length = LENGTH_BASE[symbol - 257] + bits(LENGTH_EXTRA[symbol - 257]), code = decode(dist);
      if (code > 29) throw corrupt();
      const distance = DIST_BASE[code] + bits(DIST_EXTRA[code]);
      if (distance > op) throw corrupt();
      if (op + length > limit) throw bomb();
      for (let i = 0; i < length; i++, op++) out[op] = out[op - distance];
    }
  }
  if (pos !== src.length) throw linkError('there is extra data after the compressed scene.');
  return op === limit ? out : out.subarray(0, op);
}

async function deflateRaw(bytes: Uint8Array): Promise<Uint8Array | null> {
  const Stream = (globalThis as {CompressionStream?: new (format: string) => {readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array>}}).CompressionStream;
  if (typeof Stream !== 'function') return null;
  let stream;
  try { stream = new Stream('deflate-raw'); } catch { return null; }   // a platform without the raw format
  const writer = stream.writable.getWriter(), reader = stream.readable.getReader();
  const written = writer.write(bytes).then(() => writer.close());
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const {done, value} = await reader.read();
    if (done) break;
    chunks.push(value); total += value.length;
  }
  await written;
  const out = new Uint8Array(total);
  let o = 0;
  for (const chunk of chunks) { out.set(chunk, o); o += chunk.length; }
  return out;
}

function sceneBytes(scene: unknown): Uint8Array {
  const bytes = new TextEncoder().encode(canonicalize(scene));
  if (bytes.length > SCENE_LIMITS.linkSceneBytes) throw linkError(`the scene is ${bytes.length} bytes of canonical JSON; a link carries at most ${SCENE_LIMITS.linkSceneBytes}.`);
  return bytes;
}

function assemble(mode: 'd' | 'r', raw: Uint8Array, data: Uint8Array): string {
  const link = `${SCENE_LINK_PREFIX}${mode}.${raw.length.toString(36)}.${crc32(raw).toString(16).padStart(8, '0')}.${toBase64Url(data)}`;
  if (link.length > SCENE_LIMITS.linkChars) throw linkError(`the link would be ${link.length} characters; the limit is ${SCENE_LIMITS.linkChars}.`);
  return link;
}

/**
 * Pack a scene into a URL-safe string:
 *
 *     b3s1 <mode> . <length> . <crc> . <data>
 *
 * - `mode`: `d` when `data` is raw DEFLATE (RFC 1951), `r` when it is stored as is;
 * - `length`: UTF-8 byte length of the canonical JSON, in lowercase base 36;
 * - `crc`: CRC-32 (IEEE 802.3, as in zip and PNG) of those bytes, 8 lowercase hex digits;
 * - `data`: base64url (RFC 4648 section 5) without padding.
 *
 * Only `A-Z a-z 0-9 - _ .` appear, so the string needs no escaping in a query
 * or fragment. Compression uses the platform's `CompressionStream('deflate-raw')`;
 * where that is missing, or when the result is not smaller, or with
 * `compress: false`, the link stores the JSON uncompressed (mode `r`).
 */
export async function encodeSceneLink(scene: unknown, options: {readonly compress?: boolean} = {}): Promise<string> {
  const raw = sceneBytes(scene);
  const packed = options.compress === false ? null : await deflateRaw(raw);
  return packed && packed.length < raw.length ? assemble('d', raw, packed) : assemble('r', raw, raw);
}

/** The synchronous form of encodeSceneLink: always mode `r` (stored, not compressed). Works everywhere. */
export function encodeSceneLinkSync(scene: unknown): string { const raw = sceneBytes(scene); return assemble('r', raw, raw); }

const LINK_PATTERN = /b3s([0-9]+)([a-z])\.([0-9a-z]+)\.([0-9a-f]{8})\.([A-Za-z0-9_-]*)/;

/**
 * Unpack a share link into a validated scene. Accepts the bare string or any
 * text that contains it, such as a whole URL. Synchronous and self-contained:
 * the DEFLATE decoder is built in, so a compressed link opens on platforms
 * without DecompressionStream. Throws EngineError('INVALID_PAYLOAD') for a link
 * that is too long, cut off, altered (CRC or length mismatch), of an unknown
 * version, or that would decompress to more than it declares
 * (SCENE_LIMITS.linkSceneBytes at most), and SceneValidationError when the
 * JSON inside is not a valid scene.
 */
export function decodeSceneLink(text: string): Scene {
  if (typeof text !== 'string') throw linkError('expected a string.');
  if (text.length > SCENE_LIMITS.linkChars + 2048) throw linkError(`the text is ${text.length} characters; a link is at most ${SCENE_LIMITS.linkChars}.`);
  const match = LINK_PATTERN.exec(text);
  if (!match) throw linkError(`no link found; one looks like ${SCENE_LINK_PREFIX}d.<length>.<crc>.<data>.`);
  const [whole, version, mode, lengthText, crcText, data] = match;
  if (version !== '1') throw linkError(`unsupported link version ${version}; this build reads version 1.`);
  if (mode !== 'd' && mode !== 'r') throw linkError(`unknown encoding '${mode}'; expected 'd' or 'r'.`);
  if (whole.length > SCENE_LIMITS.linkChars) throw linkError(`the link is ${whole.length} characters; the limit is ${SCENE_LIMITS.linkChars}.`);
  const length = lengthText.length > 8 ? Infinity : parseInt(lengthText, 36);
  if (!(length <= SCENE_LIMITS.linkSceneBytes)) throw linkError(`it declares a scene of ${Number.isFinite(length) ? length : 'too many'} bytes; the limit is ${SCENE_LIMITS.linkSceneBytes}.`);
  const packed = fromBase64Url(data);
  let raw: Uint8Array;
  if (mode === 'r') {
    if (packed.length > length) throw linkError(`the data is longer than the ${length} bytes it declares.`);
    raw = packed;
  } else raw = inflateRaw(packed, length);
  if (raw.length !== length) throw linkError(`the link is cut off or altered: it declares ${length} bytes and holds ${raw.length}.`);
  const crc = crc32(raw).toString(16).padStart(8, '0');
  if (crc !== crcText) throw linkError(`checksum mismatch (the link says ${crcText}, the data gives ${crc}); the link was altered or damaged.`);
  let scene: unknown;
  try { scene = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(raw)); } catch { throw linkError('the data is not UTF-8 JSON.'); }
  return assertValid(scene);
}

// ---------------------------------------------------------------------------
// Building, loading and saving
// ---------------------------------------------------------------------------

/** The options to create a world that can load this scene: `createWorld(sceneWorldOptions(scene))`. */
export function sceneWorldOptions(scene: Scene): {step: number; subSteps: number; seed: number; gravity: [number, number, number]; ground: boolean} {
  const w = worldOf(scene.world);
  return {step: w.step, subSteps: w.subSteps, seed: w.seed, gravity: [w.gravity[0], w.gravity[1], w.gravity[2]], ground: w.ground};
}

/** A body description for SceneBuilder.addBody: a scene body without its id, or a native body descriptor (bigint filter bits, typed arrays). */
export type SceneBodyInput = Omit<SceneBody, 'id'> | NativeBodyDescriptor;
/** A joint description for SceneBuilder.addJoint: a scene joint without its id; bodies are named by id. */
export type SceneJointInput = Omit<SceneJoint, 'id'>;

export interface SaveSceneOptions {
  /** true (default): each body's current pose, velocities and type, and the world's current gravity. false: the scene as it was described. */
  readonly state?: boolean;
  /** Replaces the builder's meta in the saved scene. */
  readonly meta?: SceneMeta;
}

export interface LoadedScene<W extends SceneHost = SceneHost> {
  readonly bodies: Map<string, Body>;
  readonly joints: Map<string, Joint>;
  /** Holds the descriptions; use it to add, remove and save. */
  readonly builder: SceneBuilder<W>;
  /** The scene in normal form, as it was built. */
  readonly scene: Scene;
}

// Plain JSON from what callers hand the builder: {x, y, z} and typed arrays become arrays, bigints become decimal strings.
function plain(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value === null || typeof value !== 'object') return value;
  if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
  if (Array.isArray(value)) return value.map(plain);
  const object = value as Obj, keys = Object.keys(object);
  if (typeof object.x === 'number' && typeof object.y === 'number' && typeof object.z === 'number' && keys.every(key => 'xyzw'.includes(key) && key.length === 1)) {
    return typeof object.w === 'number' ? [object.x, object.y, object.z, object.w] : [object.x, object.y, object.z];
  }
  const out: Obj = {};
  for (const key of keys) if (object[key] !== undefined) out[key] = key === 'userData' ? object[key] : plain(object[key]);
  return out;
}

const sameSingle = (a: readonly number[] | undefined, b: readonly number[], fallback: readonly number[]): boolean => {
  const from = a ?? fallback;
  return b.every((v, i) => Math.fround(from[i]) === v);
};

function bodyOptions(body: SceneBody, materials: ReadonlyMap<string, SceneMaterial>): NativeBodyDescriptor {
  const material = body.material !== undefined ? materials.get(body.material) : undefined, filter = body.filter;
  return {
    shape: body.shape, type: body.type, position: body.position, rotation: body.rotation, linearVelocity: body.linearVelocity, angularVelocity: body.angularVelocity,
    density: body.density ?? material?.density, friction: body.friction ?? material?.friction, restitution: body.restitution ?? material?.restitution, color: body.color ?? material?.color,
    bullet: body.bullet, sensor: body.sensor, hitEvents: body.hitEvents, neverSleeps: body.neverSleeps, lockRotation: body.lockRotation,
    linearDamping: body.linearDamping, angularDamping: body.angularDamping, gravityScale: body.gravityScale,
    filter: filter ? {categoryBits: filter.categoryBits !== undefined ? BigInt(filter.categoryBits) : undefined, maskBits: filter.maskBits !== undefined ? BigInt(filter.maskBits) : undefined, groupIndex: filter.groupIndex} : undefined,
  };
}

const named = (kind: string, id: string, error: unknown): EngineError =>
  new EngineError(error instanceof EngineError ? error.code : 'INTERNAL', `Scene ${kind} "${id}": ${error instanceof Error ? error.message : String(error)}`);

/**
 * A world plus the description of everything put into it. The world
 * cannot report shapes or joint definitions, so the builder remembers them as
 * it creates each body and joint, and `toJSON()` writes them back out with the
 * bodies' current poses and velocities.
 *
 * Constructing a builder RESETS the world to the given settings. Create and
 * remove bodies and joints through the builder; what you change on the world
 * directly (setJointMotor, setDamping, setCollisionFilter, ...) is not seen,
 * except pose, velocity, body type and gravity, which are read back on save.
 */
export class SceneBuilder<W extends SceneHost = SceneHost> {
  readonly world: W;
  /** Shown in saved scenes. Assign to change it. */
  meta: SceneMeta | undefined;
  extensions: {readonly [key: string]: unknown} | undefined;
  private settings: Required<SceneWorld>;
  private readonly materialMap = new Map<string, SceneMaterial>();
  private readonly bodyMap = new Map<string, {description: SceneBody; handle: Body}>();
  private readonly jointMap = new Map<string, {description: SceneJoint; handle: Joint}>();
  /** @internal The scene's water, cable and frame sections as they were described (normal form). This module carries them; simulation.ts builds them. */
  coupledSections: SceneCoupledSections = {};
  /** @internal Set by simulation.ts: the same sections with the solvers' current state, for a save. */
  coupledCapture: (() => SceneCoupledSections) | null = null;

  constructor(world: W, options: {readonly world?: SceneWorld; readonly materials?: {readonly [name: string]: SceneMaterial}; readonly meta?: SceneMeta; readonly extensions?: {readonly [key: string]: unknown}} = {}) {
    // Unlike a file, a builder takes the step, sub-steps and seed it was not given from its world.
    const settings: SceneWorld = {step: world.loop.step, subSteps: world.subSteps, seed: world.seed, ...options.world};
    const scene = normalizeScene({format: SCENE_FORMAT, version: SCENE_VERSION, world: settings, materials: options.materials, bodies: [], meta: options.meta, extensions: options.extensions});
    this.world = world;
    this.settings = worldOf(scene.world);
    if (Math.abs(this.settings.step - world.loop.step) > 1e-12 || this.settings.subSteps !== world.subSteps) {
      throw new EngineError('INVALID_STATE', `The scene steps at ${this.settings.step} s with ${this.settings.subSteps} sub-steps, but this world was created with ${world.loop.step} s and ${world.subSteps}. ` +
        'Create the world with createWorld(sceneWorldOptions(scene)).');
    }
    for (const [name, material] of Object.entries(scene.materials!)) this.materialMap.set(name, material);
    this.meta = scene.meta;
    this.extensions = scene.extensions;
    this.resetWorld();
  }

  /** @internal Empty the world and forget every body and joint. */
  resetWorld(): void {
    this.bodyMap.clear(); this.jointMap.clear();
    this.coupledSections = {}; this.coupledCapture = null;
    this.world.reset({ground: this.settings.ground, gravity: this.settings.gravity, seed: this.settings.seed});
  }

  /** Add or replace a named material. Bodies already created keep the values they were built with. */
  defineMaterial(name: string, material: SceneMaterial): void {
    const c = new Checker();
    checkMaterials(c, {[name]: plain(material)}, '/materials');
    if (c.problems.length > 0) throw new SceneValidationError(c.problems, 'material');
    this.materialMap.set(name, {...material});
  }

  private claim(id: string, kind: string): void {
    const c = new Checker();
    if (!c.id(id, `/${kind}/id`)) throw new SceneValidationError(c.problems, kind);
    if (this.bodyMap.has(id) || this.jointMap.has(id)) throw new SceneValidationError([{path: `/${kind}/id`, message: `duplicate id ${show(id)}`}], kind);
  }

  /** Validate, create and remember a body. Throws when the description is invalid, the id is taken, or the world is full. */
  addBody(id: string, body: SceneBodyInput): Body {
    this.claim(id, 'body');
    const candidate = {...plain(body) as Obj, id}, c = new Checker();
    checkBody(c, candidate, `/bodies/${pointer(id)}`, new Set(this.materialMap.keys()));
    if (c.geometryValues > SCENE_LIMITS.geometryValues) c.add(`/bodies/${pointer(id)}/shape`, `holds ${c.geometryValues} numbers; the limit is ${SCENE_LIMITS.geometryValues}`);
    if (c.problems.length > 0) throw new SceneValidationError(c.problems, `body "${id}"`);
    return this.place(normalBody(candidate as unknown as SceneBody));
  }

  /** @internal Create a body from a description that is already validated and in normal form. */
  place(description: SceneBody): Body {
    let handle: Body | null;
    try { handle = this.world.createBody(bodyOptions(description, this.materialMap)); } catch (error) { throw named('body', description.id, error); }
    if (!handle) throw new EngineError('WORLD_CAPACITY', `Scene body "${description.id}": the world is at body capacity.`);
    this.bodyMap.set(description.id, {description, handle});
    return handle;
  }

  /** Validate, create and remember a joint between two bodies named by id (null is the fixed world). */
  addJoint(id: string, joint: SceneJointInput): Joint {
    this.claim(id, 'joint');
    this.prune();
    const candidate = {...plain(joint) as Obj, id}, c = new Checker();
    checkJoint(c, candidate, `/joints/${pointer(id)}`, ref => this.bodyMap.has(ref));
    if (c.problems.length > 0) throw new SceneValidationError(c.problems, `joint "${id}"`);
    return this.connect(normalJoint(candidate as unknown as SceneJoint));
  }

  /** @internal Create a joint from a description that is already validated and in normal form. */
  connect(description: SceneJoint): Joint {
    const body = (ref: string | null): Body | null => ref === null ? null : this.bodyMap.get(ref)!.handle;
    const options: NativeJointDescriptor = {
      type: description.type, bodyA: body(description.bodyA), bodyB: body(description.bodyB), frameA: description.frameA, frameB: description.frameB,
      collideConnected: description.collideConnected, limits: description.limits, motor: description.motor, spring: description.spring, length: description.length, coneAngle: description.coneAngle, stiffness: description.stiffness,
    };
    let handle: Joint;
    try { handle = this.world.createJoint(options); } catch (error) { throw named('joint', description.id, error); }
    this.jointMap.set(description.id, {description, handle});
    return handle;
  }

  /** Destroy a body (and with it the joints attached to it) or a joint. Returns false for an unknown id. */
  remove(id: string): boolean {
    const body = this.bodyMap.get(id);
    if (body) {
      this.world.destroyBody(body.handle);
      this.bodyMap.delete(id);
      for (const [jointId, joint] of this.jointMap) if (joint.description.bodyA === id || joint.description.bodyB === id) this.jointMap.delete(jointId);
      return true;
    }
    const joint = this.jointMap.get(id);
    if (!joint) return false;
    if (this.world.isJointAlive(joint.handle)) this.world.destroyJoint(joint.handle);
    this.jointMap.delete(id);
    return true;
  }

  // Forget what was destroyed on the world directly.
  private prune(): void {
    for (const [id, body] of this.bodyMap) if (!this.world.isAlive(body.handle)) this.bodyMap.delete(id);
    for (const [id, joint] of this.jointMap) {
      const d = joint.description;
      if (!this.world.isJointAlive(joint.handle) || (d.bodyA !== null && !this.bodyMap.has(d.bodyA)) || (d.bodyB !== null && !this.bodyMap.has(d.bodyB))) this.jointMap.delete(id);
    }
  }

  has(id: string): boolean { return this.bodyMap.has(id) || this.jointMap.has(id); }
  body(id: string): Body | undefined { return this.bodyMap.get(id)?.handle; }
  joint(id: string): Joint | undefined { return this.jointMap.get(id)?.handle; }
  /** The id a body or joint handle was created under, if this builder made it. */
  idOf(handle: Body | Joint): string | undefined {
    for (const [id, body] of this.bodyMap) if (body.handle === handle || body.handle.token === handle.token) return id;
    for (const [id, joint] of this.jointMap) if (joint.handle === handle) return id;
    return undefined;
  }
  /** A new id -> handle map of the live bodies, in creation order. */
  bodies(): Map<string, Body> { this.prune(); return new Map([...this.bodyMap].map(([id, body]) => [id, body.handle])); }
  joints(): Map<string, Joint> { this.prune(); return new Map([...this.jointMap].map(([id, joint]) => [id, joint.handle])); }
  /** The description a body or joint was created from (normal form), or undefined. */
  describe(id: string): SceneBody | SceneJoint | undefined { return this.bodyMap.get(id)?.description ?? this.jointMap.get(id)?.description; }

  /**
   * The scene as JSON, in normal form. By default each body carries its
   * CURRENT position, rotation, velocities and type from the solver, and the
   * world its current gravity, so loading the result resumes from this moment.
   * A value the solver still holds unchanged is written as it was authored.
   * Not carried: sleep state, contact and joint impulses (the solver starts
   * them from zero), forces applied for the next step, the tick count, and any
   * setting changed on the world directly other than those listed above.
   * Water, cable and frame sections are written with their current fields when
   * a Simulation built them (see docs/SIMULATION.md for what that restores),
   * and without the entries that name a body that no longer exists.
   */
  toJSON(options: SaveSceneOptions = {}): Scene {
    this.prune();
    const live = options.state !== false, world = this.world;
    const bodies: SceneBody[] = [];
    for (const {description, handle} of this.bodyMap.values()) {
      if (!live) { bodies.push(description); continue; }
      const state = world.getState(handle), next: {-readonly [K in keyof SceneBody]: SceneBody[K]} = {...description};
      if (description.shape.kind !== 'mesh' && description.shape.kind !== 'heightfield') next.type = state.type;
      if (!sameSingle(description.position, state.position, [0, 0, 0])) next.position = state.position;
      if (!sameSingle(description.rotation, state.rotation, [0, 0, 0, 1])) next.rotation = state.rotation;
      if (!sameSingle(description.linearVelocity, state.linearVelocity, [0, 0, 0])) next.linearVelocity = state.linearVelocity;
      if (!sameSingle(description.angularVelocity, state.angularVelocity, [0, 0, 0])) next.angularVelocity = state.angularVelocity;
      bodies.push(normalBody(next));
    }
    const gravity = world.gravity(), settings = live && !sameSingle(this.settings.gravity, gravity, [0, 0, 0]) ? {...this.settings, gravity} : this.settings;
    const materials: Record<string, SceneMaterial> = {};
    for (const [name, material] of this.materialMap) materials[name] = material;
    const coupled = live && this.coupledCapture ? this.coupledCapture() : this.coupledSections, has = (id: string | undefined): boolean => id === undefined || this.bodyMap.has(id);
    return normalizeScene({
      format: SCENE_FORMAT, version: SCENE_VERSION, world: settings, materials, bodies, joints: [...this.jointMap.values()].map(joint => joint.description),
      water: coupled.water?.map(basin => ({...basin, bodies: basin.bodies?.filter(entry => has(entry.body))})),
      cables: coupled.cables?.map(cable => ({...cable, attachments: cable.attachments?.filter(att => has(att.body))})),
      frames: coupled.frames?.map(frame => ({...frame, attachments: frame.attachments?.filter(att => has(att.body))})),
      meta: options.meta ?? this.meta, extensions: this.extensions,
    });
  }

  /** @internal Build every body, then every joint, of a validated, normalised scene; on any failure leave the world reset and empty. */
  populate(scene: Scene): this {
    const world = this.world;
    try {
      // A world starts with room for 4,096 bodies and does not grow by itself.
      const needed = scene.bodies.length + world.bodyCount();
      if (needed > world.native.maxBodies) {
        if (needed > 65536) throw new EngineError('WORLD_CAPACITY', `The scene needs room for ${needed} bodies with the ground; a world holds at most 65536.`);
        world.native.reserveBodyCapacity(needed);
      }
      for (const body of scene.bodies) this.place(body);
      for (const joint of scene.joints ?? []) this.connect(joint);
      this.coupledSections = normalCoupled(scene);
    } catch (error) {
      this.resetWorld();
      throw error;
    }
    return this;
  }
}

/**
 * Validate a scene, reset the world to its settings and build every body, then
 * every joint, in file order. The world's body capacity is raised first when
 * the scene needs more than it has.
 *
 * - An invalid scene throws SceneValidationError (code 'INVALID_PAYLOAD',
 *   `problems` holds the full list) and the world is NOT touched.
 * - A world created with another step or sub-step count throws
 *   EngineError('INVALID_STATE') and is not touched: create it with
 *   `createWorld(sceneWorldOptions(scene))`.
 * - If the engine refuses a body or joint part-way, the world is left reset to
 *   the scene's settings with none of the scene's bodies in it, and the error
 *   names the offending id.
 * - A scene with `water`, `cables` or `frames` throws EngineError('INVALID_STATE')
 *   and the world is not touched: this loader has no solvers for them.
 */
export function loadScene<W extends SceneHost>(world: W, scene: unknown): LoadedScene<W> {
  const normal = normalizeScene(scene);
  if (sceneHasCoupling(normal)) {
    throw new EngineError('INVALID_STATE', 'This scene has water, cable or frame sections. This loader builds rigid bodies and joints only and would drop them: ' +
      'load the scene with loadSimulationScene (simulation.ts; the kit\'s loadScene), which returns a Simulation that steps every solver.');
  }
  const builder = new SceneBuilder<W>(world, {world: normal.world, materials: normal.materials, meta: normal.meta, extensions: normal.extensions}).populate(normal);
  return {bodies: builder.bodies(), joints: builder.joints(), builder, scene: normal};
}

/**
 * The scene a builder (or the result of loadScene) describes, with each body's
 * current state: see SceneBuilder.toJSON for exactly what is and is not saved.
 */
export function saveScene<W extends SceneHost>(world: W, handles: SceneBuilder<W> | {readonly builder: SceneBuilder<W>}, options: SaveSceneOptions = {}): Scene {
  const builder = handles instanceof SceneBuilder ? handles : handles?.builder;
  if (!(builder instanceof SceneBuilder)) throw new EngineError('INVALID_PAYLOAD', 'saveScene needs the SceneBuilder that built the scene, or the result of loadScene.');
  if (builder.world !== world) throw new EngineError('INVALID_PAYLOAD', 'That SceneBuilder belongs to another world.');
  return builder.toJSON(options);
}

export {pendulumWaveScene, newtonsCradleScene, dominoRunScene, terrainCarScene, ragdollScene, EXAMPLE_SCENES, mooredBuoyScene, cableStayedDeckScene, COUPLED_EXAMPLE_SCENES} from './scene-examples.ts';
