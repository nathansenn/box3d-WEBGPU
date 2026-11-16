import {EngineError, showValue, type DiagnosticFinding} from './core/contracts.js';
import {checkpointError, readCheckpoint, writeCheckpoint, type StateObject} from './core/checkpoint.js';
import type {
  NativeBodyHandle, NativeBodyKind, NativeBodyMassState, NativeBodyState, NativeConvexShape, NativeBodyType, NativeJointHandle, NativeJointState, NativeJointType, NativeQueryCastHit, NativeQueryFilter,
  NativeSpatialQuery, NativeWorldBackend, NativeWorldEvent, NativeWorldPool,
} from './core/native-world.js';
import {FixedStepLoop, type FixedStepOptions, type FixedStepResult} from './loop.js';

/** Three numbers [x, y, z]: a position or displacement in metres, a velocity in m/s, a force in newtons, as the method says. */
export type Vec3 = readonly [number, number, number];
/** A tuple, a plain {x, y, z} object or a three.js Vector3: all accepted wherever a vector is taken. */
export type Vec3Like = Vec3 | {readonly x: number; readonly y: number; readonly z: number};

/** Normalize any Vec3Like to a fresh tuple. */
export function toVec3(value: Vec3Like): [number, number, number] {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const list = value as unknown as ArrayLike<number>;
    if (list.length === 3) return [list[0], list[1], list[2]];
  } else {
    const v = value as {x: number; y: number; z: number};
    if (v !== null && typeof v === 'object' && typeof v.x === 'number' && typeof v.y === 'number' && typeof v.z === 'number') return [v.x, v.y, v.z];
  }
  throw new EngineError('INVALID_PAYLOAD', `Expected a vector as [x, y, z] or {x, y, z}; got ${showValue(value)}.`, {value: showValue(value), expected: '[x, y, z] or {x, y, z}'});
}
/** An opaque handle to a body of one world. It never names another body, even after this one is destroyed; test it with isAlive(). */
export type Body = NativeBodyHandle;
/** An opaque handle to a joint of one world; test it with isJointAlive(). */
export type Joint = NativeJointHandle;
/** 'dynamic' is simulated, 'kinematic' is moved by you and pushes dynamic bodies, 'static' never moves. */
export type BodyType = NativeBodyType;
/** A body as the solver holds it: position (m), rotation [x, y, z, w], linear (m/s) and angular (rad/s) velocity, mass (kg), whether it is awake, and its type. */
export type BodyState = NativeBodyState;
/** The six joint types: 'weld', 'revolute', 'spherical', 'prismatic', 'distance' and 'wheel'. JointOptions says what each constrains. */
export type JointType = NativeJointType;
/** What a joint reports: its angle (rad), travel (m) or length (m) in `value`, and the force (N) and torque (N m) it carries. */
export type JointState = NativeJointState;
/** A contact or sensor event of one step: kind ('contact-begin', 'contact-end', 'hit', 'sensor-begin', 'sensor-end'), the two bodies and, for a hit, the point, normal and approach speed. */
export type WorldEvent = NativeWorldEvent;
/** Unit quaternion as [x, y, z, w] or {x, y, z, w} (a three.js Quaternion works). */
export type QuatLike = readonly [number, number, number, number] | {readonly x: number; readonly y: number; readonly z: number; readonly w: number};

/** Normalize any QuatLike to a fresh tuple. */
export function toQuat(value: QuatLike): [number, number, number, number] {
  if (Array.isArray(value) || ArrayBuffer.isView(value)) {
    const list = value as unknown as ArrayLike<number>;
    if (list.length === 4) return [list[0], list[1], list[2], list[3]];
  } else {
    const q = value as {x: number; y: number; z: number; w: number};
    if (q !== null && typeof q === 'object' && typeof q.x === 'number' && typeof q.y === 'number' && typeof q.z === 'number' && typeof q.w === 'number') return [q.x, q.y, q.z, q.w];
  }
  throw new EngineError('INVALID_PAYLOAD', `Expected a quaternion as [x, y, z, w] or {x, y, z, w}; got ${showValue(value)}.`, {value: showValue(value), expected: '[x, y, z, w] or {x, y, z, w}'});
}

/** The shapes a compound body may hold. */
export type ConvexShapeOptions =
  | {readonly kind: 'box'; readonly halfExtents: Vec3Like}
  | {readonly kind: 'sphere'; readonly radius: number}
  | {readonly kind: 'capsule'; readonly radius: number; readonly halfLength: number}
  | {readonly kind: 'hull'; readonly points: ArrayLike<number>};
/** One shape of a compound body, placed in the body's frame. */
export interface CompoundShapeOptions {
  readonly shape: ConvexShapeOptions;
  /** The shape's origin in the body frame. Default [0, 0, 0]. */
  readonly position?: Vec3Like;
  /** The shape's orientation in the body frame. Default identity. */
  readonly rotation?: QuatLike;
  /** kg/m^3, friction and restitution of this shape. Each defaults to the body's. */
  readonly density?: number;
  readonly friction?: number;
  readonly restitution?: number;
}
/**
 * Mass in kg, centre of mass in the body frame (default the origin), and the inertia tensor about
 * the centre of mass in body axes as [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] in kg m^2.
 */
export interface MassDataOptions {
  readonly mass: number;
  readonly center?: Vec3Like;
  readonly inertia: readonly [number, number, number, number, number, number];
}
/** Mass (kg), centre of mass in the body frame (m) and inertia tensor about it [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] in kg m^2, as getMassData() reports them. */
export type BodyMassData = NativeBodyMassState;
/** The shape of a body: a box, sphere, capsule or convex hull, a compound of those, or static scenery (a triangle mesh or a height field). Sizes in metres. */
export type ShapeOptions =
  | {readonly kind: 'box'; readonly halfExtents: Vec3Like}
  | {readonly kind: 'sphere'; readonly radius: number}
  /** The capsule's axis is the body's local Y; halfLength is half the distance between the cap centers. */
  | {readonly kind: 'capsule'; readonly radius: number; readonly halfLength: number}
  /** Convex hull of 4 or more body-local points, as a flat [x, y, z, x, y, z, ...] list. Box3D keeps at most 64 hull vertices. */
  | {readonly kind: 'hull'; readonly points: ArrayLike<number>}
  /**
   * 1 to 64 convex shapes on one body. Mass, centre of mass and inertia are the sum over the
   * shapes; `position` is the origin of the frame the shapes are placed in.
   */
  | {readonly kind: 'compound'; readonly shapes: readonly CompoundShapeOptions[]}
  /** Triangle mesh for static scenery: flat vertex list and counter-clockwise index triples. The body is always static. */
  | {readonly kind: 'mesh'; readonly vertices: ArrayLike<number>; readonly indices: ArrayLike<number>}
  /**
   * Terrain: countX by countZ heights in metres (index x + z * countX) on a grid of spacing [dx, dz],
   * starting at the body position and extending along +x and +z. The body is always static.
   */
  | {readonly kind: 'heightfield'; readonly heights: ArrayLike<number>; readonly countX: number; readonly countZ: number; readonly spacing: readonly [number, number]};
/** The shape kind of a render row: 'box', 'sphere', 'capsule', 'hull', 'mesh', 'heightfield' or 'compound'. */
export type BodyKind = NativeBodyKind;

/** Lengths in metres, masses from density in kg/m^3, angles in radians. */
export interface BodyOptions {
  readonly shape: ShapeOptions;
  /** 'dynamic' (default) is simulated, 'kinematic' is moved by you and pushes dynamic bodies, 'static' never moves. */
  readonly type?: BodyType;
  readonly position: Vec3Like;
  readonly rotation?: QuatLike;
  readonly linearVelocity?: Vec3Like;
  readonly angularVelocity?: Vec3Like;
  /** Default 1000 (water). */
  readonly density?: number;
  /** Default 0.6. */
  readonly friction?: number;
  /** Bounciness 0..1. Default 0. */
  readonly restitution?: number;
  /** 0xRRGGBB. */
  readonly color?: number;
  /** Continuous collision against other moving bodies, for small fast objects. */
  readonly bullet?: boolean;
  /** Reports overlaps as sensor events instead of colliding. */
  readonly sensor?: boolean;
  /** Also report 'hit' events (point, normal, approach speed) for this body. */
  readonly hitEvents?: boolean;
  readonly neverSleeps?: boolean;
  readonly lockRotation?: boolean;
  readonly linearDamping?: number;
  readonly angularDamping?: number;
  /** Multiplier on world gravity. Default 1; 0 makes the body float. */
  readonly gravityScale?: number;
  /** Two bodies collide when each one's categoryBits shares a bit with the other's maskBits. */
  readonly filter?: {readonly categoryBits?: bigint; readonly maskBits?: bigint; readonly groupIndex?: number};
  /** Use this mass, centre of mass and inertia tensor instead of the ones the shape and density give. See setMassData(). */
  readonly massData?: MassDataOptions;
}

/** Where a joint attaches to a body: a position (m) and rotation in that body's own frame. Both default to the body's origin and axes. */
export interface JointFrame { readonly position?: Vec3Like; readonly rotation?: QuatLike }
/**
 * Connects two bodies; pass null for a body to attach to the fixed world.
 * Frames are local to each body. Revolute and wheel joints turn about the
 * frame's z axis; prismatic travel and wheel suspension run along frame A's x
 * axis. Use `axisRotation()` to aim a frame at another axis.
 */
export interface JointOptions {
  readonly type: JointType;
  readonly bodyA: Body | null;
  readonly bodyB: Body | null;
  readonly frameA?: JointFrame;
  readonly frameB?: JointFrame;
  /** Let the two connected bodies collide with each other. Default false. */
  readonly collideConnected?: boolean;
  /** Angle (rad), travel (m) or length (m) limits. On a spherical joint these limit twist. */
  readonly limits?: {readonly lower: number; readonly upper: number};
  /** speed in rad/s or m/s; maxForce in N, or N·m for a turning motor. */
  readonly motor?: {readonly speed: number; readonly maxForce: number};
  /** Spring towards `target` (angle or travel). On a weld joint it makes the weld flexible. */
  readonly spring?: {readonly hertz: number; readonly dampingRatio: number; readonly target?: number};
  /** Distance joints: rest length in metres (required). */
  readonly length?: number;
  /** Spherical joints: cone limit half-angle in radians. */
  readonly coneAngle?: number;
  /**
   * How stiffly the joint holds its bodies together. The default (60 Hz, damping ratio 2) lets a
   * loaded chain sag by millimetres; raise it for robot arms, keeping it well below the sub-step
   * rate (steps per second x subSteps).
   */
  readonly stiffness?: {readonly hertz: number; readonly dampingRatio?: number};
}

/** What reset() starts the empty world with: the ground slab, gravity and the seed. */
export interface ResetOptions {
  /** Add the static 88 m x 88 m ground whose top face is y = 0. Default true. */
  readonly ground?: boolean;
  /** Default [0, -9.81, 0]. */
  readonly gravity?: Vec3Like;
  readonly seed?: number;
}

/**
 * Rotation that turns the +z axis onto `axis`: a joint frame built from it
 * hinges about `axis`. For a prismatic joint, which slides along +x, pass
 * `from: 'x'`.
 */
export function axisRotation(axisLike: Vec3Like, from: 'x' | 'z' = 'z'): [number, number, number, number] {
  const a = toVec3(axisLike), length = Math.hypot(a[0], a[1], a[2]);
  if (!(length > 0) || !Number.isFinite(length)) throw new EngineError('INVALID_PAYLOAD', 'axis must be a non-zero vector.');
  const x = a[0] / length, y = a[1] / length, z = a[2] / length;
  const f: [number, number, number] = from === 'x' ? [1, 0, 0] : [0, 0, 1];
  const dot = f[0] * x + f[1] * y + f[2] * z;
  // Opposite direction: turn half a revolution about any perpendicular axis.
  if (dot < -0.999999) return from === 'x' ? [0, 1, 0, 0] : [1, 0, 0, 0];
  const cx = f[1] * z - f[2] * y, cy = f[2] * x - f[0] * z, cz = f[0] * y - f[1] * x, w = 1 + dot, n = 1 / Math.hypot(cx, cy, cz, w);
  return [cx * n, cy * n, cz * n, w * n];
}

/** A body's pose as getPose() reads it from the render transforms. */
export interface BodyPose {
  /** World-space center. */
  position: [number, number, number];
  /** Unit quaternion [x, y, z, w]. */
  rotation: [number, number, number, number];
  /** Box half extents (the render matrix is scaled by these). */
  halfExtents: [number, number, number];
}

/** How a world steps: the fixed step and the most steps per update() (FixedStepOptions), the sub-steps, the seed, the body capacity, interpolation and strict mode. */
export interface WorldOptions extends FixedStepOptions {
  /** Solver substeps per fixed step, 1..16. Default 4. */
  readonly subSteps?: number;
  /** Deterministic seed for presets and scattered spawns. Default 1. */
  readonly seed?: number;
  /** Reserve this many bodies up front (4,096..65,536) so growth never stalls gameplay. */
  readonly capacity?: number;
  /** Keep the previous step's transforms for render interpolation. Default true. */
  readonly interpolate?: boolean;
  /**
   * Throw an EngineError with code NUMERICAL_FAILURE from step() or update() as soon as a step leaves a body with a
   * transform that is not finite, instead of only recording it in stats().nonFiniteSince. Default false: a game loop
   * keeps running and decides for itself (restore a checkpoint, reset the level). Tests and tools should pass true.
   */
  readonly strict?: boolean;
}

/** What spawnBox() takes: where the cube appears, its half size and an initial impulse. */
export interface SpawnBoxOptions {
  readonly position: Vec3Like;
  /** Cube half size in meters. Default 0.5. Values <= 0.05 are replaced with 0.8 by the native bridge. Cubes only. */
  readonly halfSize?: number;
  /** Initial linear impulse (N·s) applied at the center. Default none. */
  readonly impulse?: Vec3Like;
}

/** Options of the casts and overlaps: which bodies to consider and how many hits to return. */
export interface QueryOptions {
  readonly filter?: NativeQueryFilter;
  /** Most hits returned, 1..256. Default 1 for casts, 32 for overlaps. */
  readonly limit?: number;
}
/**
 * The old name of QueryOptions.
 * @deprecated Use QueryOptions.
 */
export type RaycastOptions = QueryOptions;

/** Counts and timings of a world, from stats(): cheap enough to read every frame. */
export interface WorldStats {
  readonly bodies: number;
  readonly awake: number;
  /** Native contact count, or null when the WASM build does not report it. */
  readonly contacts: number | null;
  readonly capacity: number;
  /** Fixed steps since the last reset. */
  readonly tick: number;
  /** Wall-clock milliseconds of the most recent native step. */
  readonly lastStepMs: number;
  /** Wall-clock milliseconds of all steps in the most recent update(). */
  readonly lastUpdateMs: number;
  /** Seconds discarded by the most recent update() because maxSteps was reached. */
  readonly droppedSeconds: number;
  /**
   * The tick of the first step that left a body with a transform that is not finite (NaN or infinite), or null when
   * every transform has been finite since the last reset or restore. Once set, the world's numbers cannot be trusted:
   * restore a checkpoint taken before that tick, or reset. See diagnose() for what makes a set-up unstable.
   */
  readonly nonFiniteSince: number | null;
}

/** One recorded action of a ReplayLog, with the tick it happened at. Bodies are named by render row and joints by creation order, so that a log replays in any world. */
export type ReplayCommand =
  | {readonly t: number; readonly op: 'spawnBox'; readonly position: Vec3; readonly halfSize: number; readonly impulse: Vec3}
  | {readonly t: number; readonly op: 'destroyBody'; readonly row: number}
  | {readonly t: number; readonly op: 'applyImpulse'; readonly row: number; readonly impulse: Vec3}
  | {readonly t: number; readonly op: 'explode'; readonly center: Vec3; readonly strength: number; readonly radius: number}
  /**
   * Any other mutating call (createBody, createJoint, setVelocity, ...). In `args`, a body is
   * {$body: row}, a joint is {$joint: n} (the n-th joint created since recording began) and a
   * bigint is {$bigint: 'decimal'}, so the log stays plain JSON.
   */
  | {readonly t: number; readonly op: 'call'; readonly method: string; readonly args: readonly unknown[]};

/** Everything needed to reproduce a session bit-for-bit on the same WASM build. JSON-serializable. */
export interface ReplayLog {
  /** 2 when the log starts from an SI world or holds 'call' commands; such logs need kit 0.8 or later. */
  readonly version: 1 | 2;
  /** Present when recording began with reset() instead of the classic arena. */
  readonly world?: {readonly ground: boolean; readonly gravity: Vec3};
  readonly seed: number;
  readonly step: number;
  readonly subSteps: number;
  readonly ticks: number;
  readonly commands: readonly ReplayCommand[];
  /** exactHash() when recording stopped. */
  readonly finalHash: number;
  /** [tick, exactHash] pairs captured during recording; lets replay locate the first divergence. */
  readonly checkpoints?: readonly (readonly [number, number])[];
}

/** Options of startRecording(): how often to record a state hash, and whether to start from an SI world. */
export interface RecordingOptions {
  /** Capture exactHash every N ticks (0 disables). Default 60. */
  readonly checkpointEvery?: number;
  /** Start from an empty SI world (as reset() does) instead of the classic arena. */
  readonly world?: {readonly ground?: boolean; readonly gravity?: Vec3Like};
}

/** The result of replayDetailed(): whether the replay matched the recording and, if not, between which ticks it first differed. */
export interface ReplayReport {
  /** True when every checkpoint and the final state match bit-for-bit. */
  readonly matches: boolean;
  /** Ticks bounding the first divergence: it happened after `from` and by `to`. Null when none was found. */
  readonly divergence: {readonly from: number; readonly to: number} | null;
  readonly finalHash: number;
  readonly checkpointsCompared: number;
}

/** A seed as the 32-bit unsigned integer the native world takes: any finite number, reduced modulo 2^32 (so Date.now() works). */
function seedOf(seed: unknown): number {
  if (typeof seed !== 'number' || !Number.isFinite(seed)) throw new EngineError('INVALID_PAYLOAD', `seed must be a finite number; got ${showValue(seed)}. It is reduced modulo 2^32.`, {path: 'seed', value: showValue(seed), expected: 'a finite number'});
  return seed >>> 0;
}
const massData = (data: MassDataOptions) => ({mass: data?.mass, center: data?.center ? toVec3(data.center) : undefined, inertia: data?.inertia});
const now = () => globalThis.performance?.now() ?? Date.now();
/** The methods a 'call' replay command may name. */
const REPLAYABLE = new Set(['setGravity', 'createBody', 'setTransform', 'setVelocity', 'moveKinematic', 'setBodyType', 'setAwake', 'setGravityScale',
  'setDamping', 'setCollisionFilter', 'applyForce', 'applyTorque', 'applyImpulseAt', 'applyAngularImpulse', 'createJoint', 'destroyJoint',
  'setJointMotor', 'setJointLimits', 'setJointSpring', 'setJointSteering', 'setJointStiffness', 'setMassData', 'resetMassData']);

/**
 * Game-facing wrapper around one isolated native Box3D world.
 *
 * - `update(frameSeconds)` runs a fixed-timestep loop for you.
 * - Bodies are opaque, generation-checked handles; a destroyed body can never
 *   alias a newer one. Attach your own entity with setUserData().
 * - `matrices()` returns column-major 4x4 float32 transforms (scaled by each
 *   box's half extents), ready for GPU instancing with a 2x2x2 unit box.
 *   `interpolatedMatrices(alpha)` blends the last two steps for smooth rendering.
 */
export class PhysicsWorld {
  readonly native: NativeWorldBackend;
  readonly loop: FixedStepLoop;
  readonly subSteps: number;
  readonly seed: number;
  private ownedPool: NativeWorldPool | null;
  private readonly userData = new Map<bigint, unknown>();
  private tickCount = 0;
  private lastStepMs = 0;
  private lastUpdateMs = 0;
  private droppedSeconds = 0;
  // Interpolation: transforms before the latest step, and whether rows still line up.
  private readonly interpolate: boolean;
  private previous = new Float32Array(0);
  private previousCount = 0;
  private rowsMoved = true;
  private blended = new Float32Array(0);
  private recording: {seed: number; commands: ReplayCommand[]; every: number; checkpoints: [number, number][]; world?: {ground: boolean; gravity: Vec3}} | null = null;
  // Joints created since the recording or replay began, so a log can name them by order.
  private jointLog: Joint[] = [];
  private readonly stepListeners = new Set<(tick: number) => void>();
  private readonly eventListeners = new Set<(event: WorldEvent) => void>();
  private droppedEventCount = 0;
  private readonly strict: boolean;
  private nonFiniteTick: number | null = null;
  // What diagnose() needs to know about each joint made through createJoint, by joint token.
  private readonly jointInfo = new Map<bigint, {joint: Joint; a: Body | null; b: Body | null; hertz: number; anchorA: Vec3; anchorB: Vec3}>();
  private jointPruneAt = 256;

  constructor(pool: NativeWorldPool, options: WorldOptions = {}, ownPool = false) {
    this.native = pool.createWorld();
    this.ownedPool = ownPool ? pool : null;
    try {
      if (!this.native.supportsBodyLifecycle) throw new EngineError('UNSUPPORTED_BACKEND', 'box3d.wasm lacks body handles; rebuild with npm run build:wasm.');
      this.loop = new FixedStepLoop(options);
      this.subSteps = options.subSteps ?? 4;
      this.seed = (options.seed ?? 1) >>> 0;
      this.interpolate = options.interpolate ?? true;
      this.strict = options.strict === true;
      if (options.capacity !== undefined) this.native.reserveBodyCapacity(options.capacity);
    } catch (error) {
      this.native.destroy();
      throw error;
    }
    leaks?.register(this, {native: this.native, pool: this.ownedPool}, this);
  }

  /**
   * Replace the world with an empty arena: one static 88 m x 88 m ground box
   * whose top face is at y = 0. Implemented by loading a preset and removing
   * everything except the ground, because the current bridge exports no
   * standalone world-creation call.
   */
  resetArena(seed = this.seed): this {
    this.stopRecordingIfActive('resetArena');
    this.native.createScene({id: 0}, 1, seedOf(seed));
    const extra: Body[] = [];
    for (let i = 1; i < this.native.bodyCount(); i++) extra.push(this.native.bodyHandle(i));
    for (const body of extra) this.native.destroyBody(body);
    this.afterReset();
    return this;
  }

  /** Load one of the 800 built-in native presets (0..799) at stress 1..5. */
  loadPreset(id: number, stress = 1, seed = this.seed): number {
    this.stopRecordingIfActive('loadPreset');
    const count = this.native.createScene({id}, stress, seedOf(seed));
    this.afterReset();
    return count;
  }

  /**
   * Replace the world with an empty one in SI units: real gravity (9.81 m/s^2
   * down) and, unless `ground: false`, the static ground slab. Use this, then
   * createBody() and createJoint(), to build your own scene.
   */
  reset(options: ResetOptions = {}): this {
    this.stopRecordingIfActive('reset');
    if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new EngineError('INVALID_PAYLOAD', `reset takes {ground?, gravity?, seed?} or nothing; got ${showValue(options)}.`);
    this.native.resetWorld({seed: seedOf(options.seed ?? this.seed), ground: options.ground, gravity: options.gravity !== undefined && options.gravity !== null ? toVec3(options.gravity) : undefined});
    this.afterReset();
    return this;
  }

  setGravity(gravity: Vec3Like): void { const g = toVec3(gravity); this.general('setGravity', [g]); this.native.setGravity(g[0], g[1], g[2]); }
  gravity(): [number, number, number] { return this.native.gravity(); }

  // Log a mutating call while recording. Arguments are encoded before the call runs,
  // because a body's row is only meaningful at that moment.
  private general(method: string, args: readonly unknown[] = []): void {
    if (this.recording) this.recording.commands.push({t: this.tickCount, op: 'call', method, args: args.map(arg => this.encodeArg(arg))});
  }
  private encodeArg(value: unknown): unknown {
    if (typeof value === 'bigint') return {$bigint: value.toString()};
    if (value === null || typeof value !== 'object') return value;
    if (ArrayBuffer.isView(value)) return Array.from(value as unknown as ArrayLike<number>);
    if (Array.isArray(value)) return value.map(item => this.encodeArg(item));
    if (typeof (value as {token?: unknown}).token === 'bigint') {
      const joint = this.jointLog.indexOf(value as Joint);
      if (joint >= 0) return {$joint: joint};
      let row: number | null = null;
      try { row = this.native.bodyIndex(value as Body); } catch { /* not a body of this world */ }
      if (row === null) throw new EngineError('INVALID_STATE', 'Recording met a destroyed body, or a joint created before recording began.');
      return {$body: row};
    }
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) if (item !== undefined) out[key] = this.encodeArg(item);
    return out;
  }
  private decodeArg(value: unknown): unknown {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(item => this.decodeArg(item));
    const tagged = value as {$body?: number; $joint?: number; $bigint?: string};
    if (typeof tagged.$bigint === 'string') return BigInt(tagged.$bigint);
    if (typeof tagged.$body === 'number') return this.bodyAt(tagged.$body);
    if (typeof tagged.$joint === 'number') {
      const joint = this.jointLog[tagged.$joint];
      if (!joint) throw new EngineError('INVALID_PAYLOAD', `Replay log names joint ${tagged.$joint}, which it never created.`);
      return joint;
    }
    const out: Record<string, unknown> = {};
    // A log is JSON from outside: a key named __proto__ must stay data and never become a prototype.
    for (const [key, item] of Object.entries(value)) if (key !== '__proto__') out[key] = this.decodeArg(item);
    return out;
  }

  /**
   * Create a body: box, sphere, capsule, convex hull or a compound of those, of any type, or a
   * static triangle mesh or height field. Returns null when the world is at body capacity.
   */
  createBody(options: BodyOptions): Body | null {
    if (options === null || typeof options !== 'object') throw new EngineError('INVALID_PAYLOAD', `createBody takes {shape, position, ...}; got ${showValue(options)}.`);
    this.general('createBody', [options]);
    const shape = options.shape ?? ({} as ShapeOptions);
    const convex = (one: ConvexShapeOptions): NativeConvexShape => one?.kind === 'box' ? {kind: 'box', halfExtents: toVec3(one.halfExtents)} : one;
    return this.native.createBody({
      ...options,
      shape: shape.kind === 'box' ? {kind: 'box', halfExtents: toVec3(shape.halfExtents)}
        // A `shapes` that is not an array is passed on as it is, for the native check to refuse by name.
        : shape.kind === 'compound' ? {kind: 'compound', shapes: !Array.isArray(shape.shapes) ? shape.shapes as never : shape.shapes.map((child: CompoundShapeOptions) => ({
          ...child, shape: convex(child?.shape), position: child?.position ? toVec3(child.position) : undefined, rotation: child?.rotation ? toQuat(child.rotation) : undefined,
        }))} : shape,
      massData: options.massData ? massData(options.massData) : undefined,
      position: toVec3(options.position),
      rotation: options.rotation ? toQuat(options.rotation) : undefined,
      linearVelocity: options.linearVelocity ? toVec3(options.linearVelocity) : undefined,
      angularVelocity: options.angularVelocity ? toVec3(options.angularVelocity) : undefined,
    });
  }

  /**
   * Replace the mass, centre of mass and inertia tensor that the body's shapes and densities give.
   * The pose and the velocity of the body's origin do not change. The values stay until
   * resetMassData(), also across setBodyType(), and act while the body is dynamic; the shapes
   * still decide how it collides. Throws unless the mass is positive and the tensor positive definite.
   */
  setMassData(body: Body, data: MassDataOptions): void { this.general('setMassData', [body, data]); this.native.setBodyMassData(body, massData(data)); }
  /** Back to the mass, centre of mass and inertia of the body's shapes. */
  resetMassData(body: Body): void { this.general('resetMassData', [body]); this.native.resetBodyMassData(body); }
  /**
   * Mass, centre of mass (body frame) and inertia tensor (about that centre, body axes, as
   * [Ixx, Iyy, Izz, Ixy, Ixz, Iyz]) as the solver holds them, whether they come from the shapes
   * or were set. A static or kinematic body reports zeros.
   */
  getMassData(body: Body): BodyMassData { return this.native.bodyMassData(body); }
  /** Position, rotation, velocities, mass, sleep state and type, read from the solver. */
  getState(body: Body): BodyState { return this.native.bodyState(body); }
  /** Teleport a body. To move a kinematic body through the world use moveKinematic(). */
  setTransform(body: Body, position: Vec3Like, rotation: QuatLike = [0, 0, 0, 1]): void {
    this.general('setTransform', [body, position, rotation]); this.native.setBodyTransform(body, toVec3(position), toQuat(rotation)); this.rowsMoved = true;
  }
  setVelocity(body: Body, linear: Vec3Like, angular: Vec3Like = [0, 0, 0]): void {
    this.general('setVelocity', [body, linear, angular]); this.native.setBodyVelocity(body, toVec3(linear), toVec3(angular));
  }
  /**
   * Drive a kinematic body so that it reaches the pose after `seconds`
   * (default: one fixed step). This sets its velocity, which it then keeps:
   * call it every step while following a path, or setVelocity(body, [0, 0, 0])
   * to stop.
   */
  moveKinematic(body: Body, position: Vec3Like, rotation: QuatLike = [0, 0, 0, 1], seconds = this.loop.step): void {
    this.general('moveKinematic', [body, position, rotation, seconds]); this.native.setBodyTarget(body, toVec3(position), toQuat(rotation), seconds);
  }
  setBodyType(body: Body, type: BodyType): void { this.general('setBodyType', [body, type]); this.native.setBodyType(body, type); }
  setAwake(body: Body, awake: boolean): void { this.general('setAwake', [body, awake]); this.native.setBodyAwake(body, awake); }
  setGravityScale(body: Body, scale: number): void { this.general('setGravityScale', [body, scale]); this.native.setBodyGravityScale(body, scale); }
  setDamping(body: Body, linear: number, angular: number): void { this.general('setDamping', [body, linear, angular]); this.native.setBodyDamping(body, linear, angular); }
  setCollisionFilter(body: Body, categoryBits: bigint, maskBits: bigint, groupIndex = 0): void {
    this.general('setCollisionFilter', [body, categoryBits, maskBits, groupIndex]); this.native.setBodyFilter(body, categoryBits, maskBits, groupIndex);
  }
  /** Force in newtons, acting over the next step. With `point` (world space) it also produces torque. */
  applyForce(body: Body, force: Vec3Like, point?: Vec3Like): void {
    this.general('applyForce', point ? [body, force, point] : [body, force]); this.native.applyToBody(body, 'force', toVec3(force), point ? toVec3(point) : undefined);
  }
  applyTorque(body: Body, torque: Vec3Like): void { this.general('applyTorque', [body, torque]); this.native.applyToBody(body, 'torque', toVec3(torque)); }
  /** Impulse in N·s at a world-space point. applyImpulse() acts at the center. */
  applyImpulseAt(body: Body, impulse: Vec3Like, point: Vec3Like): void {
    this.general('applyImpulseAt', [body, impulse, point]); this.native.applyToBody(body, 'impulse', toVec3(impulse), toVec3(point));
  }
  applyAngularImpulse(body: Body, impulse: Vec3Like): void { this.general('applyAngularImpulse', [body, impulse]); this.native.applyToBody(body, 'angular-impulse', toVec3(impulse)); }

  /** Connect two bodies, or a body and the fixed world, with a joint. */
  createJoint(options: JointOptions): Joint {
    this.general('createJoint', [options]);
    // A frame that is not an object is passed on as it is, for the native check to refuse by name.
    const frame = (f?: JointFrame) => f !== null && typeof f === 'object' && !Array.isArray(f) ? {position: f.position ? toVec3(f.position) : undefined, rotation: f.rotation ? toQuat(f.rotation) : undefined} : f as undefined;
    if (options === null || typeof options !== 'object') throw new EngineError('INVALID_PAYLOAD', `createJoint takes {type, bodyA, bodyB, ...}; got ${showValue(options)}.`);
    const joint = this.native.createJoint({...options, frameA: frame(options.frameA), frameB: frame(options.frameB)});
    if (this.recording || this.replayCheck) this.jointLog.push(joint);
    const anchor = (f?: JointFrame): Vec3 => f?.position ? toVec3(f.position) : [0, 0, 0];
    this.jointInfo.set(joint.token, {joint, a: options.bodyA, b: options.bodyB, hertz: Math.max(options.spring?.hertz ?? 0, options.stiffness?.hertz ?? 0), anchorA: anchor(options.frameA), anchorB: anchor(options.frameB)});
    // Joints that died with their bodies are dropped now and then, so the table follows the live joints.
    if (this.jointInfo.size > this.jointPruneAt) { for (const [token, info] of this.jointInfo) if (!this.native.jointAlive(info.joint)) this.jointInfo.delete(token); this.jointPruneAt = Math.max(256, 2 * this.jointInfo.size); }
    return joint;
  }
  /** False once the joint, or either of its bodies, has been destroyed. */
  isJointAlive(joint: Joint): boolean { return this.native.jointAlive(joint); }
  destroyJoint(joint: Joint): boolean { this.general('destroyJoint', [joint]); const destroyed = this.native.destroyJoint(joint); this.jointInfo.delete(joint.token); return destroyed; }
  /** Pass null to switch the motor off. */
  setJointMotor(joint: Joint, motor: {speed: number; maxForce: number} | null): void { this.general('setJointMotor', [joint, motor]); this.native.setJointMotor(joint, motor); }
  /** Pass null to remove the limits. */
  setJointLimits(joint: Joint, limits: {lower: number; upper: number} | null): void { this.general('setJointLimits', [joint, limits]); this.native.setJointLimits(joint, limits); }
  /** Pass null to switch the spring off. */
  setJointSpring(joint: Joint, spring: {hertz: number; dampingRatio: number; target?: number} | null): void { this.general('setJointSpring', [joint, spring]); this.native.setJointSpring(joint, spring); }
  /** Set how stiffly a joint holds its bodies together; see JointOptions.stiffness. */
  setJointStiffness(joint: Joint, hertz: number, dampingRatio = 2): void { this.general('setJointStiffness', [joint, hertz, dampingRatio]); this.native.setJointStiffness(joint, hertz, dampingRatio); }
  /** Wheel joints: steer towards an angle. Pass null to switch steering off. */
  setJointSteering(joint: Joint, steering: {angle: number; hertz: number; dampingRatio: number; maxTorque: number} | null): void {
    this.general('setJointSteering', [joint, steering]); this.native.setJointSteering(joint, steering);
  }
  /** Joint angle, travel or length, and the force and torque it is carrying. */
  getJointState(joint: Joint): JointState { return this.native.jointState(joint); }

  /**
   * Call `listener(event)` for every contact and sensor event, after the step
   * that produced it: 'contact-begin' and 'contact-end' when two bodies start
   * or stop touching, 'hit' for impacts on bodies created with
   * `hitEvents: true`, and 'sensor-begin' / 'sensor-end' for sensor overlaps.
   * Destroying a body does not produce a 'contact-end' for what it touched.
   * Returns a function that removes the listener.
   */
  onEvent(listener: (event: WorldEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => { this.eventListeners.delete(listener); };
  }
  /** Events lost because one step produced more than 65,536 of them. */
  get droppedEvents(): number { return this.droppedEventCount; }

  /**
   * Shape of every render row, in the same order as matrices(). Box, sphere and
   * capsule rows are scaled by their size; hull, mesh, height-field and compound
   * rows are unscaled, for drawing with the geometry you created them from.
   */
  bodyKinds(): BodyKind[] { return this.native.bodyKinds(); }

  private afterReset(): void {
    this.loop.reset();
    this.userData.clear();
    this.tickCount = 0;
    this.rowsMoved = true;
    this.nonFiniteTick = null;
    this.jointInfo.clear();
  }

  /** Spawn a dynamic cube. Returns null when the world is at body capacity. */
  spawnBox(options: SpawnBoxOptions): Body | null {
    if (options === null || typeof options !== 'object') throw new EngineError('INVALID_PAYLOAD', `spawnBox takes {position, halfSize?, impulse?}; got ${showValue(options)}.`);
    const position = toVec3(options.position), impulse = options.impulse ? toVec3(options.impulse) : [0, 0, 0] as const, halfSize = options.halfSize ?? 0.5;
    const body = this.native.launchProjectileBody(position[0], position[1], position[2], impulse[0], impulse[1], impulse[2], halfSize);
    // Spawning appends a row, so interpolation of existing rows stays valid.
    if (body) this.record({t: this.tickCount, op: 'spawnBox', position, halfSize, impulse: [impulse[0], impulse[1], impulse[2]]});
    return body;
  }

  /** True while the handle still refers to a live body. */
  isAlive(body: Body): boolean { return this.native.bodyIndex(body) !== null; }

  /** Remove a body and its user data. Returns false if it was already gone. */
  destroyBody(body: Body): boolean {
    const row = this.native.bodyIndex(body);
    if (row === null) return false;
    this.native.destroyBody(body);
    this.userData.delete(body.token);
    // Destruction moves the last row into the freed one.
    this.rowsMoved = true;
    this.record({t: this.tickCount, op: 'destroyBody', row});
    return true;
  }

  applyImpulse(body: Body, impulseLike: Vec3Like): void {
    const impulse = toVec3(impulseLike), row = this.recording ? this.native.bodyIndex(body) : null;
    this.native.applyBodyImpulse(body, impulse[0], impulse[1], impulse[2]);
    if (row !== null) this.record({t: this.tickCount, op: 'applyImpulse', row, impulse});
  }

  /** Radial impulse on every dynamic body within radius. */
  explode(centerLike: Vec3Like, strength: number, radius: number): void {
    const center = toVec3(centerLike);
    this.native.explode(center[0], center[1], center[2], strength, radius);
    this.record({t: this.tickCount, op: 'explode', center, strength, radius});
  }

  /** Attach any game object (entity id, mesh, component) to a body. Cleared on destroy/reset. */
  setUserData(body: Body, value: unknown): void {
    if (!this.isAlive(body)) throw new EngineError('STALE_BODY', 'Cannot attach data to a destroyed body.');
    this.userData.set(body.token, value);
  }
  /** The value from setUserData, e.g. to turn a raycast hit into your entity. */
  getUserData<T = unknown>(body: Body): T | undefined { return this.userData.get((body as Body | null | undefined)?.token as bigint) as T | undefined; }

  /** The body drawn at instance row `row` (0 is the ground in an arena). Rows change on destroy; handles do not. */
  bodyAt(row: number): Body { return this.native.bodyHandle(row); }

  /** Advance by exactly one fixed step. */
  step(): void { this.runStep(this.loop.step); }

  /** Advance by a variable frame time using the fixed-step accumulator. */
  update(frameSeconds: number): FixedStepResult {
    const start = now();
    const result = this.loop.advance(frameSeconds, step => this.runStep(step));
    if (result.steps > 0) this.lastUpdateMs = now() - start;
    this.droppedSeconds = result.droppedSeconds;
    return result;
  }

  private runStep(dt: number): void {
    if (this.interpolate) this.capturePrevious();
    const start = now();
    this.native.step(dt, this.subSteps);
    this.lastStepMs = now() - start;
    this.tickCount++;
    if (this.nonFiniteTick === null) this.checkFinite();
    const rec = this.recording;
    if (rec && rec.every > 0 && this.tickCount % rec.every === 0) rec.checkpoints.push([this.tickCount, this.exactHash()]);
    const check = this.replayCheck;
    if (this.eventListeners.size > 0) {
      const {events, dropped} = this.native.collectEvents();
      this.droppedEventCount += dropped;
      for (const event of events) for (const listener of this.eventListeners) listener(event);
    }
    if (check) check(this.tickCount);
    // Listener side effects (impulses, spawns) are already in a replay log's commands.
    else for (const listener of this.stepListeners) listener(this.tickCount);
  }

  // One pass over four numbers per body (a rotation entry and the position). Their sum is finite exactly when each of
  // them is: single-precision values cannot overflow a double sum, and NaN or an infinity makes the sum non-finite.
  private checkFinite(): void {
    const m = this.matrices();
    let sum = 0;
    for (let o = 0; o < m.length; o += 16) sum += m[o] + m[o + 12] + m[o + 13] + m[o + 14];
    if (Number.isFinite(sum)) return;
    this.nonFiniteTick = this.tickCount;
    if (!this.strict) return;
    let row = 0;
    while (row * 16 < m.length && Number.isFinite(m[row * 16] + m[row * 16 + 12] + m[row * 16 + 13] + m[row * 16 + 14])) row++;
    throw new EngineError('NUMERICAL_FAILURE', `Step ${this.tickCount} left body row ${row} with a transform that is not finite. The solver diverged: usually joints that contradict each other, or a mass ratio or stiffness beyond what the step size resolves. Restore a checkpoint from before this step, and run world.diagnose() on the set-up.`, {path: `body row ${row}`});
  }

  /**
   * Call `listener(tick)` after every fixed step, e.g. to update triggers or
   * a character controller at the physics rate. Listeners do not run during
   * replay(), because their recorded commands already reproduce their
   * effects. Returns a function that removes the listener.
   */
  onStep(listener: (tick: number) => void): () => void {
    this.stepListeners.add(listener);
    return () => { this.stepListeners.delete(listener); };
  }
  private replayCheck: ((tick: number) => void) | null = null;

  private capturePrevious(): void {
    const count = this.native.bodyCount();
    if (this.previous.length < count * 16) this.previous = new Float32Array(Math.max(count, this.native.maxBodies) * 16);
    this.previous.set(this.matrices());
    this.previousCount = count;
    this.rowsMoved = false;
  }

  /**
   * Transforms blended between the previous and the latest fixed step
   * (`alpha` from update(), 0 = previous, 1 = latest). Removes the judder a
   * fixed step shows on displays faster than the physics rate. Rows whose
   * previous transform is unknown (new spawns, or every row after a destroy
   * or reset) use the latest transform. Returns a reused buffer.
   */
  interpolatedMatrices(alpha: number): Float32Array {
    const current = this.matrices(), count = current.length / 16;
    if (this.blended.length < current.length) this.blended = new Float32Array(Math.max(count, this.native.maxBodies) * 16);
    const out = this.blended.subarray(0, current.length);
    out.set(current);
    const t = Math.min(1, Math.max(0, Number.isFinite(alpha) ? alpha : 1));
    if (!this.interpolate || this.rowsMoved || t === 1) return out;
    const rows = Math.min(count, this.previousCount), prev = this.previous, qa = [0, 0, 0, 1], qb = [0, 0, 0, 1];
    for (let row = 0; row < rows; row++) {
      const o = row * 16;
      let same = true;
      for (let k = 0; k < 16; k++) if (prev[o + k] !== current[o + k]) { same = false; break; }
      if (same) continue;
      const hx = Math.hypot(current[o], current[o + 1], current[o + 2]), hy = Math.hypot(current[o + 4], current[o + 5], current[o + 6]), hz = Math.hypot(current[o + 8], current[o + 9], current[o + 10]);
      rotationOf(prev, o, hx, hy, hz, qa);
      rotationOf(current, o, hx, hy, hz, qb);
      // Normalized lerp along the short arc: indistinguishable from slerp at per-step angles.
      const sign = qa[0] * qb[0] + qa[1] * qb[1] + qa[2] * qb[2] + qa[3] * qb[3] < 0 ? -1 : 1;
      let x = qa[0] + (qb[0] * sign - qa[0]) * t, y = qa[1] + (qb[1] * sign - qa[1]) * t, z = qa[2] + (qb[2] * sign - qa[2]) * t, w = qa[3] + (qb[3] * sign - qa[3]) * t;
      const n = 1 / Math.hypot(x, y, z, w);
      x *= n; y *= n; z *= n; w *= n;
      writeMatrix(out, o, x, y, z, w, hx, hy, hz,
        prev[o + 12] + (current[o + 12] - prev[o + 12]) * t,
        prev[o + 13] + (current[o + 13] - prev[o + 13]) * t,
        prev[o + 14] + (current[o + 14] - prev[o + 14]) * t);
    }
    return out;
  }

  private cast(query: NativeSpatialQuery): NativeQueryCastHit[] {
    const [result] = this.native.queryBatch([query]);
    return result.kind === 'ray' || result.kind === 'sphere-cast' || result.kind === 'box-cast' ? [...result.hits] : [];
  }
  private overlap(query: NativeSpatialQuery): Body[] {
    return this.native.queryBatch([query])[0].hits.map(hit => hit.body);
  }
  private static common(options: QueryOptions, limit: number): {limit: number; filter?: NativeQueryFilter} {
    if (options === null || typeof options !== 'object' || Array.isArray(options)) throw new EngineError('INVALID_PAYLOAD', `Query options must be {filter?, limit?}; got ${showValue(options)}.`);
    return options.filter !== undefined && options.filter !== null ? {limit: options.limit ?? limit, filter: options.filter} : {limit: options.limit ?? limit};
  }

  /** Closest hit along origin -> origin + translation, or null. */
  raycast(origin: Vec3Like, translation: Vec3Like, options: QueryOptions = {}): NativeQueryCastHit | null {
    return this.cast({kind: 'ray', origin: toVec3(origin), translation: toVec3(translation), ...PhysicsWorld.common(options, 1)})[0] ?? null;
  }
  /** Closest hit of a sphere swept along translation, or null. */
  sphereCast(origin: Vec3Like, radius: number, translation: Vec3Like, options: QueryOptions = {}): NativeQueryCastHit | null {
    return this.cast({kind: 'sphere-cast', origin: toVec3(origin), radius, translation: toVec3(translation), ...PhysicsWorld.common(options, 1)})[0] ?? null;
  }
  /** Closest hit of an axis-aligned box swept along translation, or null. */
  boxCast(origin: Vec3Like, halfExtents: Vec3Like, translation: Vec3Like, options: QueryOptions = {}): NativeQueryCastHit | null {
    return this.cast({kind: 'box-cast', origin: toVec3(origin), halfExtents: toVec3(halfExtents), translation: toVec3(translation), ...PhysicsWorld.common(options, 1)})[0] ?? null;
  }
  /** Bodies whose shapes overlap a sphere. */
  overlapSphere(center: Vec3Like, radius: number, options: QueryOptions | number = {}): Body[] {
    const opts = typeof options === 'number' ? {limit: options} : options;
    return this.overlap({kind: 'sphere-overlap', origin: toVec3(center), radius, ...PhysicsWorld.common(opts, 32)});
  }
  /** Bodies whose shapes overlap an axis-aligned box. */
  overlapBox(center: Vec3Like, halfExtents: Vec3Like, options: QueryOptions = {}): Body[] {
    return this.overlap({kind: 'box-overlap', origin: toVec3(center), halfExtents: toVec3(halfExtents), ...PhysicsWorld.common(options, 32)});
  }

  /** Current pose, or null for a destroyed body. Pass `out` to avoid allocation. */
  getPose(body: Body, out?: BodyPose): BodyPose | null {
    const index = this.native.bodyIndex(body);
    if (index === null) return null;
    const m = this.native.HEAPF32, o = Number(this.native._b3w_matrices_ptr()) / 4 + index * 16;
    const pose = out ?? {position: [0, 0, 0], rotation: [0, 0, 0, 1], halfExtents: [0, 0, 0]};
    const hx = Math.hypot(m[o], m[o + 1], m[o + 2]), hy = Math.hypot(m[o + 4], m[o + 5], m[o + 6]), hz = Math.hypot(m[o + 8], m[o + 9], m[o + 10]);
    pose.halfExtents[0] = hx; pose.halfExtents[1] = hy; pose.halfExtents[2] = hz;
    pose.position[0] = m[o + 12]; pose.position[1] = m[o + 13]; pose.position[2] = m[o + 14];
    rotationOf(m, o, hx, hy, hz, pose.rotation);
    return pose;
  }

  /** Live view of `bodyCount() * 16` column-major matrices. Re-fetch every frame: WASM memory growth detaches old views. */
  matrices(): Float32Array {
    const start = Number(this.native._b3w_matrices_ptr()) / 4;
    return this.native.HEAPF32.subarray(start, start + this.native.bodyCount() * 16);
  }

  /** Live view of `bodyCount() * 4` RGBA floats (alpha < 0 encodes a material tag). */
  colors(): Float32Array {
    const start = Number(this.native._b3w_colors_ptr()) / 4;
    return this.native.HEAPF32.subarray(start, start + this.native.bodyCount() * 4);
  }

  bodyCount(): number { return this.native.bodyCount(); }
  awakeCount(): number { return this.native.awakeCount(); }
  /** Fixed steps since the last reset. */
  get tick(): number { return this.tickCount; }
  /** Order-sensitive FNV hash of every transform quantized to 1 mm. Cheap desync detector; see exactHash(). */
  replayHash(): number { return this.native.replayHash(); }
  /** FNV-1a over the exact float32 bits of every transform. Any divergence, however small, changes it. */
  exactHash(): number {
    const m = this.matrices(), bits = new Uint32Array(m.buffer, m.byteOffset, m.length);
    let hash = 0x811c9dc5;
    for (let i = 0; i < bits.length; i++) {
      const v = bits[i];
      hash = Math.imul(hash ^ (v & 0xff), 0x01000193);
      hash = Math.imul(hash ^ ((v >>> 8) & 0xff), 0x01000193);
      hash = Math.imul(hash ^ ((v >>> 16) & 0xff), 0x01000193);
      hash = Math.imul(hash ^ (v >>> 24), 0x01000193);
    }
    return hash >>> 0;
  }
  /** Bumps whenever transforms change; skip GPU uploads when unchanged. */
  transformVersion(): number { return this.native.frameVersion(); }
  colorVersion(): number { return this.native.colorVersion(); }

  stats(): WorldStats {
    return {
      bodies: this.native.bodyCount(), awake: this.native.awakeCount(), contacts: this.native.contactCount(),
      capacity: this.native.maxBodies, tick: this.tickCount, lastStepMs: this.lastStepMs,
      lastUpdateMs: this.lastUpdateMs, droppedSeconds: this.droppedSeconds, nonFiniteSince: this.nonFiniteTick,
    };
  }

  /**
   * What in this world is unstable, or close to it, as a list of findings that each name a rule and carry its numbers.
   * Call it after building a scene and when something misbehaves; it reads every body, so not every step.
   *
   * - `non-finite` (error): a step left a body with a transform that is not finite (see stats().nonFiniteSince).
   * - `far-from-origin` (warning): a body more than 16 km out. Box3D holds positions in single precision, which
   *   resolves about a millimetre there (box3d/constants.h: "positions greater than about 16km have precision problems").
   * - `tiny-shape` (warning): a box, sphere or capsule thinner than 1 cm. Box3D lets contacts rest 5 mm apart
   *   (B3_LINEAR_SLOP), so a shape of that size sinks into or hovers over what it touches by its own thickness.
   * - `mass-ratio` (warning): two dynamic bodies joined by a joint whose masses differ by more than 10 to 1. An
   *   iterative solver converges slowly across such a pair and the joint stretches; this threshold is the usual rule
   *   of thumb for solvers of this kind, not a limit measured here.
   * - `joint-frequency` (warning): a joint spring or stiffness above one eighth of the sub-step rate, the ratio at
   *   which Box3D caps its own contact softness (physics_world.c: 0.125 / h). Above it the spring is under-sampled.
   * - `joint-lever` (warning): a joint frame more than 50 radii of gyration from its body's centre of mass. The
   *   joint then acts on the body through a lever against almost no rotational inertia, and Box3D's solver can
   *   diverge: in the fuzzers' random programs about one in sixty did with frames up to 300 radii away, none in 240
   *   within 40 (docs/ROBUSTNESS.md, ND-5). Put the frame near the body, or join through a body that reaches there.
   * - `fast-small-body` (note): a body that moves more than its own smallest half extent in one step without
   *   `bullet`; it can pass through other moving bodies (static geometry always stops it).
   *
   * Joints are those made through createJoint() since the last reset. docs/ERRORS.md has the table.
   */
  diagnose(): DiagnosticFinding[] {
    const out: DiagnosticFinding[] = [], n = this.native.bodyCount(), kinds = this.native.bodyKinds(), dt = this.loop.step, rate = this.subSteps / dt;
    if (this.nonFiniteTick !== null) out.push({severity: 'error', rule: 'non-finite', subject: 'world', numbers: {tick: this.nonFiniteTick},
      message: `A body has had a transform that is not finite since step ${this.nonFiniteTick}: the solver diverged. Restore a checkpoint from before that step or reset; the findings below say what makes this set-up unstable.`});
    const pose: BodyPose = {position: [0, 0, 0], rotation: [0, 0, 0, 1], halfExtents: [0, 0, 0]};
    for (let row = 0; row < n; row++) {
      const body = this.native.bodyHandle(row), state = this.native.bodyState(body), p = state.position, far = Math.max(Math.abs(p[0]), Math.abs(p[1]), Math.abs(p[2]));
      if (!Number.isFinite(far)) { out.push({severity: 'error', rule: 'non-finite', subject: `body row ${row}`, numbers: {}, message: `Body row ${row} has a position that is not finite.`}); continue; }
      if (far > 16000) out.push({severity: 'warning', rule: 'far-from-origin', subject: `body row ${row}`, numbers: {distance: far, limit: 16000},
        message: `Body row ${row} is ${far.toFixed(0)} m from the origin. Positions are single precision: beyond about 16 km they resolve a millimetre or worse and contacts jitter. Keep the action near the origin, or move the scene's origin.`});
      const kind = kinds[row];
      if (state.type === 'static' || (kind !== 'box' && kind !== 'sphere' && kind !== 'capsule')) continue;
      this.getPose(body, pose);
      // A sphere's row is scaled by its radius on all axes, a capsule's by radius, half length + radius, radius.
      const thin = Math.min(pose.halfExtents[0], pose.halfExtents[1], pose.halfExtents[2]);
      if (thin < 0.005) out.push({severity: 'warning', rule: 'tiny-shape', subject: `body row ${row}`, numbers: {halfExtent: thin, slop: 0.005},
        message: `Body row ${row} (${kind}) is ${(2 * thin * 1000).toFixed(1)} mm thin. Box3D rests contacts up to 5 mm apart, which is this body's own thickness: it will sink in or hover. Model in metres with shapes of a centimetre or more, or scale the scene up.`});
      const speed = Math.hypot(state.linearVelocity[0], state.linearVelocity[1], state.linearVelocity[2]);
      if (state.type === 'dynamic' && speed * dt > thin && speed > 0) out.push({severity: 'note', rule: 'fast-small-body', subject: `body row ${row}`, numbers: {speed, step: dt, travel: speed * dt, halfExtent: thin},
        message: `Body row ${row} travels ${(speed * dt).toFixed(3)} m per step, more than its smallest half extent of ${thin.toFixed(3)} m. Static geometry stops it; other moving bodies may not. Create it with bullet: true, or use a smaller step.`});
    }
    let index = 0;
    for (const info of this.jointInfo.values()) {
      const subject = `joint ${index++}`;
      if (!this.native.jointAlive(info.joint)) continue;
      const mass = (body: Body | null): number => { if (body === null || this.native.bodyIndex(body) === null) return 0; const s = this.native.bodyState(body); return s.type === 'dynamic' ? s.mass : 0; };
      const ma = mass(info.a), mb = mass(info.b);
      if (ma > 0 && mb > 0 && Math.max(ma, mb) / Math.min(ma, mb) > 10) out.push({severity: 'warning', rule: 'mass-ratio', subject, numbers: {massA: ma, massB: mb, ratio: Math.max(ma, mb) / Math.min(ma, mb), limit: 10},
        message: `This joint connects bodies of ${ma.toPrecision(4)} kg and ${mb.toPrecision(4)} kg, a ratio of ${(Math.max(ma, mb) / Math.min(ma, mb)).toFixed(1)} to 1. Beyond about 10 to 1 the joint stretches under load. Bring the masses closer, raise subSteps, or raise the joint stiffness.`});
      for (const [body, at, side] of [[info.a, info.anchorA, 'A'], [info.b, info.anchorB, 'B']] as const) {
        if (body === null || this.native.bodyIndex(body) === null || this.native.bodyState(body).type !== 'dynamic') continue;
        const data = this.native.bodyMassData(body);
        // A body with locked rotation reports no rotational inertia: it cannot be turned by any lever.
        if (!(data.mass > 0) || !(Math.min(data.inertia[0], data.inertia[1], data.inertia[2]) > 0)) continue;
        const gyration = Math.sqrt(Math.min(data.inertia[0], data.inertia[1], data.inertia[2]) / data.mass), lever = Math.hypot(at[0] - data.center[0], at[1] - data.center[1], at[2] - data.center[2]);
        if (lever > 50 * gyration) out.push({severity: 'warning', rule: 'joint-lever', subject, numbers: {lever, radiusOfGyration: gyration, ratio: lever / gyration, limit: 50},
          message: `This joint's frame on body ${side} is ${lever.toFixed(2)} m from that body's centre of mass, ${(lever / gyration).toFixed(0)} times its radius of gyration (${gyration.toFixed(3)} m). Beyond about 50 the solver can diverge. Move the frame to the body, or connect through a body that reaches the joint.`});
      }
      if (info.hertz > 0.125 * rate) out.push({severity: 'warning', rule: 'joint-frequency', subject, numbers: {hertz: info.hertz, subStepRate: rate, limit: 0.125 * rate},
        message: `This joint's spring or stiffness is ${info.hertz} Hz; the solver takes ${rate.toFixed(0)} sub-steps a second and resolves up to one eighth of that, ${(0.125 * rate).toFixed(1)} Hz. Lower the frequency, or raise subSteps or the step rate.`});
    }
    return out;
  }

  /**
   * Reset the arena with this world's seed and log every following mutation
   * and step. Hand the log from stopRecording() to replay() to reproduce the
   * session exactly, e.g. attached to a bug report.
   */
  startRecording(options: RecordingOptions = {}): void {
    if (options === null || typeof options !== 'object') throw new EngineError('INVALID_PAYLOAD', `startRecording takes an options object or nothing; got ${showValue(options)}.`);
    const every = options.checkpointEvery ?? 60;
    if (!Number.isInteger(every) || every < 0) throw new EngineError('INVALID_PAYLOAD', `checkpointEvery must be a non-negative integer; got ${showValue(every)}. Use 0 to record no hashes.`);
    if (options.world !== undefined && (options.world === null || typeof options.world !== 'object')) throw new EngineError('INVALID_PAYLOAD', `world must be {ground?, gravity?}; got ${showValue(options.world)}.`);
    const world = options.world ? {ground: options.world.ground ?? true, gravity: toVec3(options.world.gravity ?? [0, -9.81, 0]) as Vec3} : undefined;
    // Checked before the world is reset, so a refused call changes nothing.
    if (world) for (const g of world.gravity) if (typeof g !== 'number' || !Number.isFinite(Math.fround(g))) throw new EngineError('INVALID_PAYLOAD', `world.gravity must hold three finite float32 numbers; got ${showValue(g)}.`);
    if (world) this.reset({seed: this.seed, ...world});
    else this.resetArena(this.seed);
    this.jointLog = [];
    this.recording = {seed: this.seed, commands: [], every, checkpoints: [], world};
  }

  stopRecording(): ReplayLog {
    if (!this.recording) throw new EngineError('INVALID_STATE', 'startRecording() was not called.');
    const rec = this.recording, general = rec.world !== undefined || rec.commands.some(command => command.op === 'call');
    const log: ReplayLog = {version: general ? 2 : 1, ...(rec.world ? {world: rec.world} : {}), seed: this.recording.seed, step: this.loop.step, subSteps: this.subSteps, ticks: this.tickCount, commands: this.recording.commands, finalHash: this.exactHash(), checkpoints: this.recording.checkpoints};
    this.recording = null;
    return log;
  }

  get isRecording(): boolean { return this.recording !== null; }

  /**
   * An exact checkpoint of the world: Box3D's complete state (contacts with their manifolds and warm-start impulses, the
   * constraint graph, islands and sleep timers, joints and their impulses, the broad phase), the body table (handles, render
   * rows, shape kinds, mass data you set), the step count and the fixed-step accumulator, in one self-checking file. Restore it
   * with `restoreCheckpoint` into a world of the same build that was built the same way, here or in a fresh page: every later
   * step is bit-identical to this world's. Not while recording. See docs/CHECKPOINTS.md in the repository.
   */
  checkpoint(): Uint8Array {
    return writeCheckpoint('world', {tick: this.tickCount, native: this.native.checkpoint(), loop: this.loop.pending, droppedEvents: this.droppedEventCount});
  }
  /**
   * Put back a checkpoint from `checkpoint()`. Body and joint handles you hold keep their meaning when this world was built
   * the same way as the one the checkpoint came from (the same calls in the same order); bodies made or destroyed in between
   * follow the checkpoint, so read them again with `bodyAt`. A damaged checkpoint, one of another format version or one that is
   * not a world checkpoint is refused and changes nothing. User data stays.
   */
  restoreCheckpoint(bytes: Uint8Array): void {
    this.stopRecordingIfActive('restoreCheckpoint');
    const state = readCheckpoint(bytes, 'world') as StateObject;
    if (!state || typeof state.tick !== 'number' || !Number.isSafeInteger(state.tick) || state.tick < 0 || !(state.native instanceof Uint8Array)) throw checkpointError('The world checkpoint is malformed.');
    if (state.loop !== undefined && !(typeof state.loop === 'number' && Number.isFinite(state.loop) && state.loop >= 0)) throw checkpointError('The world checkpoint is malformed.');
    this.native.restoreCheckpoint(state.native);
    this.tickCount = state.tick;
    this.loop.setPending(typeof state.loop === 'number' ? state.loop : 0);
    if (typeof state.droppedEvents === 'number') this.droppedEventCount = state.droppedEvents;
    this.rowsMoved = true;
    this.nonFiniteTick = null;
  }

  /** Re-run a ReplayLog in this world. Returns true when the result matches the recording bit-for-bit. */
  replay(log: ReplayLog): boolean { return this.replayDetailed(log).matches; }

  /**
   * Re-run a ReplayLog and report where it first diverged, using the log's
   * checkpoints. Use it to bisect a desync between two builds or machines.
   */
  replayDetailed(log: ReplayLog): ReplayReport {
    checkReplayLog(log);
    if (log.step !== this.loop.step || log.subSteps !== this.subSteps) throw new EngineError('INVALID_PAYLOAD', `Replay needs the same step and subSteps as the recording: the log has step ${showValue(log.step)} and subSteps ${showValue(log.subSteps)}, this world ${this.loop.step} and ${this.subSteps}. Create the world with the log's values.`);
    this.stopRecordingIfActive('replay');
    if (log.world) this.reset({seed: log.seed, ground: log.world.ground, gravity: log.world.gravity});
    else this.resetArena(log.seed);
    this.jointLog = [];
    const checkpoints = log.checkpoints ?? [];
    let next = 0, compared = 0, lastGood = 0, divergence: {from: number; to: number} | null = null;
    this.replayCheck = tick => {
      while (next < checkpoints.length && checkpoints[next][0] < tick) next++;
      if (next >= checkpoints.length || checkpoints[next][0] !== tick) return;
      compared++;
      if (this.exactHash() === checkpoints[next][1]) lastGood = tick;
      else divergence ??= {from: lastGood, to: tick};
      next++;
    };
    try {
      this.replayCommands(log);
    } finally {
      this.replayCheck = null;
    }
    const finalHash = this.exactHash();
    if (!divergence && finalHash !== log.finalHash) divergence = {from: lastGood, to: log.ticks};
    return {matches: divergence === null, divergence, finalHash, checkpointsCompared: compared};
  }

  private replayCommands(log: ReplayLog): void {
    for (const command of log.commands) {
      while (this.tickCount < command.t) this.step();
      switch (command.op) {
        case 'spawnBox': this.spawnBox(command); break;
        case 'destroyBody': this.destroyBody(this.bodyAt(command.row)); break;
        case 'applyImpulse': this.applyImpulse(this.bodyAt(command.row), command.impulse); break;
        case 'explode': this.explode(command.center, command.strength, command.radius); break;
        case 'call': {
          (this as unknown as Record<string, (...args: unknown[]) => unknown>)[command.method](...command.args.map(arg => this.decodeArg(arg)));
          break;
        }
      }
    }
    while (this.tickCount < log.ticks) this.step();
  }

  private record(command: ReplayCommand): void { this.recording?.commands.push(command); }
  private stopRecordingIfActive(reason: string): void {
    if (this.recording) throw new EngineError('INVALID_STATE', `Stop recording before ${reason}().`);
  }

  dispose(): void {
    leaks?.unregister(this);
    this.userData.clear();
    this.stepListeners.clear();
    this.recording = null;
    this.native.destroy();
    this.ownedPool?.destroy();
    this.ownedPool = null;
  }
}

/** The most steps a replay log may ask for: 2^31 - 1, more than a year at 60 Hz. A log above it is refused, not run. */
export const MAX_REPLAY_TICKS = 0x7fffffff;
const REPLAY_OPS = ['spawnBox', 'destroyBody', 'applyImpulse', 'explode', 'call'];
// A replay log is a file: it may come from a bug report or over the network. Its shape is checked completely before
// the world is touched, so that a malformed log is refused with the field at fault instead of failing part-way, and so
// that it cannot ask for unbounded work (a non-finite or absurd tick count would otherwise step forever).
function checkReplayLog(log: ReplayLog): void {
  const bad = (path: string, value: unknown, expected: string): never => { throw new EngineError('INVALID_PAYLOAD', `Replay log: ${path} must be ${expected}; got ${showValue(value)}.`, {path, value: showValue(value), expected}); };
  const whole = (value: unknown, path: string, max: number): number => typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max ? value : bad(path, value, `a whole number within [0, ${max}]`);
  const triple = (value: unknown, path: string): void => { if (!Array.isArray(value) || value.length !== 3 || !value.every(n => typeof n === 'number' && Number.isFinite(n))) bad(path, value, 'three finite numbers'); };
  if (log === null || typeof log !== 'object' || Array.isArray(log)) bad('the log', log, 'an object from stopRecording()');
  if (log.version !== 1 && log.version !== 2) throw new EngineError('UNSUPPORTED_BACKEND', `Replay log: version must be 1 or 2, the versions this build reads; got ${showValue(log.version)}.`);
  whole(log.seed, 'seed', 0xffffffff);
  if (typeof log.step !== 'number' || !(log.step > 0) || !Number.isFinite(log.step)) bad('step', log.step, 'a positive number of seconds');
  whole(log.subSteps, 'subSteps', 64);
  const ticks = whole(log.ticks, 'ticks', MAX_REPLAY_TICKS);
  if (typeof log.finalHash !== 'number') bad('finalHash', log.finalHash, 'a number');
  if (log.world !== undefined) {
    if (log.world === null || typeof log.world !== 'object') bad('world', log.world, '{ground, gravity}');
    if (typeof log.world.ground !== 'boolean') bad('world.ground', log.world.ground, 'true or false');
    triple(log.world.gravity, 'world.gravity');
  }
  if (!Array.isArray(log.commands)) bad('commands', log.commands, 'an array');
  let previous = 0;
  log.commands.forEach((command, index) => {
    const at = `commands[${index}]`;
    if (command === null || typeof command !== 'object') bad(at, command, 'a command object');
    const t = whole(command.t, `${at}.t`, ticks);
    if (t < previous) bad(`${at}.t`, t, `at least ${previous}, the tick of the command before it`);
    previous = t;
    if (!REPLAY_OPS.includes(command.op)) bad(`${at}.op`, command.op, `one of ${REPLAY_OPS.join(', ')}`);
    if (command.op === 'spawnBox') { triple(command.position, `${at}.position`); triple(command.impulse, `${at}.impulse`); if (typeof command.halfSize !== 'number') bad(`${at}.halfSize`, command.halfSize, 'a number'); }
    else if (command.op === 'destroyBody') whole(command.row, `${at}.row`, 65535);
    else if (command.op === 'applyImpulse') { whole(command.row, `${at}.row`, 65535); triple(command.impulse, `${at}.impulse`); }
    else if (command.op === 'explode') { triple(command.center, `${at}.center`); if (typeof command.strength !== 'number') bad(`${at}.strength`, command.strength, 'a number'); if (typeof command.radius !== 'number') bad(`${at}.radius`, command.radius, 'a number'); }
    else {
      if (typeof command.method !== 'string' || !REPLAYABLE.has(command.method)) throw new EngineError('INVALID_PAYLOAD', `Replay log: ${at}.method must be a call that can be replayed (${[...REPLAYABLE].join(', ')}); got ${showValue(command.method)}.`, {path: `${at}.method`, value: showValue(command.method)});
      if (!Array.isArray(command.args)) bad(`${at}.args`, command.args, 'an array');
    }
  });
  if (log.checkpoints !== undefined) {
    if (!Array.isArray(log.checkpoints)) bad('checkpoints', log.checkpoints, 'an array of [tick, hash] pairs');
    log.checkpoints.forEach((pair, index) => {
      if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[1] !== 'number') bad(`checkpoints[${index}]`, pair, 'a [tick, hash] pair');
      whole(pair[0], `checkpoints[${index}][0]`, MAX_REPLAY_TICKS);
    });
  }
}

// A world that is garbage-collected without dispose() would keep its native
// slot (16 per module) and memory forever. Release it and say so.
interface LeakedWorld { native: NativeWorldBackend; pool: NativeWorldPool | null }
/** Called when a leaked world is reclaimed; replace to route the warning elsewhere (or silence it). */
export const leakReporting: {warn: (message: string) => void} = {
  warn: message => globalThis.console?.warn(message),
};
const leaks = typeof FinalizationRegistry === 'function' ? new FinalizationRegistry<LeakedWorld>(held => {
  leakReporting.warn('box3d-webgpu-kit: a PhysicsWorld was garbage-collected without dispose(); its native world was released now. Call world.dispose() (or use `using`) to free it promptly.');
  try { held.native.destroy(); held.pool?.destroy(); } catch { /* module already gone */ }
}) : null;

// `using world = await createWorld()` disposes automatically on runtimes with
// explicit resource management. Attached at runtime so the published types
// do not require TypeScript's esnext lib.
const disposeSymbol = (Symbol as unknown as {dispose?: symbol}).dispose;
if (disposeSymbol) Object.defineProperty(PhysicsWorld.prototype, disposeSymbol, {value(this: PhysicsWorld) { this.dispose(); }, configurable: true, writable: true});

function rotationOf(m: Float32Array, o: number, hx: number, hy: number, hz: number, out: number[]): void {
  const m00 = m[o] / hx, m10 = m[o + 1] / hx, m20 = m[o + 2] / hx;
  const m01 = m[o + 4] / hy, m11 = m[o + 5] / hy, m21 = m[o + 6] / hy;
  const m02 = m[o + 8] / hz, m12 = m[o + 9] / hz, m22 = m[o + 10] / hz;
  const trace = m00 + m11 + m22;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    out[3] = 0.25 / s; out[0] = (m21 - m12) * s; out[1] = (m02 - m20) * s; out[2] = (m10 - m01) * s;
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22);
    out[3] = (m21 - m12) / s; out[0] = 0.25 * s; out[1] = (m01 + m10) / s; out[2] = (m02 + m20) / s;
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22);
    out[3] = (m02 - m20) / s; out[0] = (m01 + m10) / s; out[1] = 0.25 * s; out[2] = (m12 + m21) / s;
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11);
    out[3] = (m10 - m01) / s; out[0] = (m02 + m20) / s; out[1] = (m12 + m21) / s; out[2] = 0.25 * s;
  }
}

// Same layout as the native bridge's b3w_ctx_write_model_matrix.
function writeMatrix(m: Float32Array, o: number, x: number, y: number, z: number, w: number, hx: number, hy: number, hz: number, px: number, py: number, pz: number): void {
  const xx = x * x, yy = y * y, zz = z * z, xy = x * y, xz = x * z, yz = y * z, wx = w * x, wy = w * y, wz = w * z;
  m[o] = (1 - 2 * (yy + zz)) * hx; m[o + 1] = 2 * (xy + wz) * hx; m[o + 2] = 2 * (xz - wy) * hx; m[o + 3] = 0;
  m[o + 4] = 2 * (xy - wz) * hy; m[o + 5] = (1 - 2 * (xx + zz)) * hy; m[o + 6] = 2 * (yz + wx) * hy; m[o + 7] = 0;
  m[o + 8] = 2 * (xz + wy) * hz; m[o + 9] = 2 * (yz - wx) * hz; m[o + 10] = (1 - 2 * (xx + yy)) * hz; m[o + 11] = 0;
  m[o + 12] = px; m[o + 13] = py; m[o + 14] = pz; m[o + 15] = 1;
}
