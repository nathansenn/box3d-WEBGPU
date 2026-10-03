import {EngineError} from './core/contracts.js';
import type {NativeBodyHandle, NativeQueryCastHit, NativeQueryFilter, NativeSpatialQuery, NativeWorldBackend, NativeWorldPool} from './core/native-world.js';
import {FixedStepLoop, type FixedStepOptions, type FixedStepResult} from './loop.js';

export type Vec3 = readonly [number, number, number];
/** A tuple, a plain {x, y, z} object or a three.js Vector3: all accepted wherever a vector is taken. */
export type Vec3Like = Vec3 | {readonly x: number; readonly y: number; readonly z: number};

/** Normalize any Vec3Like to a fresh tuple. */
export function toVec3(value: Vec3Like): [number, number, number] {
  if (Array.isArray(value)) return [value[0], value[1], value[2]];
  const v = value as {x: number; y: number; z: number};
  if (v && typeof v.x === 'number') return [v.x, v.y, v.z];
  throw new EngineError('INVALID_PAYLOAD', 'Expected [x, y, z] or {x, y, z}.');
}
export type Body = NativeBodyHandle;

export interface BodyPose {
  /** World-space center. */
  position: [number, number, number];
  /** Unit quaternion [x, y, z, w]. */
  rotation: [number, number, number, number];
  /** Box half extents (the render matrix is scaled by these). */
  halfExtents: [number, number, number];
}

export interface WorldOptions extends FixedStepOptions {
  /** Solver substeps per fixed step, 1..16. Default 4. */
  readonly subSteps?: number;
  /** Deterministic seed for presets and scattered spawns. Default 1. */
  readonly seed?: number;
  /** Reserve this many bodies up front (4,096..65,536) so growth never stalls gameplay. */
  readonly capacity?: number;
  /** Keep the previous step's transforms for render interpolation. Default true. */
  readonly interpolate?: boolean;
}

export interface SpawnBoxOptions {
  readonly position: Vec3Like;
  /** Cube half size in meters. Default 0.5. Values <= 0.05 are replaced with 0.8 by the native bridge. Cubes only. */
  readonly halfSize?: number;
  /** Initial linear impulse (N·s) applied at the center. Default none. */
  readonly impulse?: Vec3Like;
}

export interface QueryOptions {
  readonly filter?: NativeQueryFilter;
  /** Most hits returned, 1..256. Default 1 for casts, 32 for overlaps. */
  readonly limit?: number;
}
/** @deprecated Use QueryOptions. */
export type RaycastOptions = QueryOptions;

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
}

export type ReplayCommand =
  | {readonly t: number; readonly op: 'spawnBox'; readonly position: Vec3; readonly halfSize: number; readonly impulse: Vec3}
  | {readonly t: number; readonly op: 'destroyBody'; readonly row: number}
  | {readonly t: number; readonly op: 'applyImpulse'; readonly row: number; readonly impulse: Vec3}
  | {readonly t: number; readonly op: 'explode'; readonly center: Vec3; readonly strength: number; readonly radius: number};

/** Everything needed to reproduce a session bit-for-bit on the same WASM build. JSON-serializable. */
export interface ReplayLog {
  readonly version: 1;
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

export interface RecordingOptions {
  /** Capture exactHash every N ticks (0 disables). Default 60. */
  readonly checkpointEvery?: number;
}

export interface ReplayReport {
  /** True when every checkpoint and the final state match bit-for-bit. */
  readonly matches: boolean;
  /** Ticks bounding the first divergence: it happened after `from` and by `to`. Null when none was found. */
  readonly divergence: {readonly from: number; readonly to: number} | null;
  readonly finalHash: number;
  readonly checkpointsCompared: number;
}

const now = () => globalThis.performance?.now() ?? Date.now();

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
  private recording: {seed: number; commands: ReplayCommand[]; every: number; checkpoints: [number, number][]} | null = null;
  private readonly stepListeners = new Set<(tick: number) => void>();

  constructor(pool: NativeWorldPool, options: WorldOptions = {}, ownPool = false) {
    this.native = pool.createWorld();
    this.ownedPool = ownPool ? pool : null;
    try {
      if (!this.native.supportsBodyLifecycle) throw new EngineError('UNSUPPORTED_BACKEND', 'box3d.wasm lacks body handles; rebuild with npm run build:wasm.');
      this.loop = new FixedStepLoop(options);
      this.subSteps = options.subSteps ?? 4;
      this.seed = (options.seed ?? 1) >>> 0;
      this.interpolate = options.interpolate ?? true;
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
    this.native.createScene({id: 0}, 1, seed >>> 0);
    const extra: Body[] = [];
    for (let i = 1; i < this.native.bodyCount(); i++) extra.push(this.native.bodyHandle(i));
    for (const body of extra) this.native.destroyBody(body);
    this.afterReset();
    return this;
  }

  /** Load one of the 800 built-in native presets (0..799) at stress 1..5. */
  loadPreset(id: number, stress = 1, seed = this.seed): number {
    this.stopRecordingIfActive('loadPreset');
    const count = this.native.createScene({id}, stress, seed >>> 0);
    this.afterReset();
    return count;
  }

  private afterReset(): void {
    this.loop.reset();
    this.userData.clear();
    this.tickCount = 0;
    this.rowsMoved = true;
  }

  /** Spawn a dynamic cube. Returns null when the world is at body capacity. */
  spawnBox(options: SpawnBoxOptions): Body | null {
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
  getUserData<T = unknown>(body: Body): T | undefined { return this.userData.get(body.token) as T | undefined; }

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
    const rec = this.recording;
    if (rec && rec.every > 0 && this.tickCount % rec.every === 0) rec.checkpoints.push([this.tickCount, this.exactHash()]);
    const check = this.replayCheck;
    if (check) check(this.tickCount);
    // Listener side effects (impulses, spawns) are already in a replay log's commands.
    else for (const listener of this.stepListeners) listener(this.tickCount);
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
    return options.filter ? {limit: options.limit ?? limit, filter: options.filter} : {limit: options.limit ?? limit};
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
      lastUpdateMs: this.lastUpdateMs, droppedSeconds: this.droppedSeconds,
    };
  }

  /**
   * Reset the arena with this world's seed and log every following mutation
   * and step. Hand the log from stopRecording() to replay() to reproduce the
   * session exactly, e.g. attached to a bug report.
   */
  startRecording(options: RecordingOptions = {}): void {
    const every = options.checkpointEvery ?? 60;
    if (!Number.isInteger(every) || every < 0) throw new EngineError('INVALID_PAYLOAD', 'checkpointEvery must be a non-negative integer.');
    this.resetArena(this.seed);
    this.recording = {seed: this.seed, commands: [], every, checkpoints: []};
  }

  stopRecording(): ReplayLog {
    if (!this.recording) throw new EngineError('INVALID_STATE', 'startRecording() was not called.');
    const log: ReplayLog = {version: 1, seed: this.recording.seed, step: this.loop.step, subSteps: this.subSteps, ticks: this.tickCount, commands: this.recording.commands, finalHash: this.exactHash(), checkpoints: this.recording.checkpoints};
    this.recording = null;
    return log;
  }

  get isRecording(): boolean { return this.recording !== null; }

  /** Re-run a ReplayLog in this world. Returns true when the result matches the recording bit-for-bit. */
  replay(log: ReplayLog): boolean { return this.replayDetailed(log).matches; }

  /**
   * Re-run a ReplayLog and report where it first diverged, using the log's
   * checkpoints. Use it to bisect a desync between two builds or machines.
   */
  replayDetailed(log: ReplayLog): ReplayReport {
    if (log.version !== 1) throw new EngineError('UNSUPPORTED_BACKEND', `Replay log version ${String(log.version)} is not supported.`);
    if (log.step !== this.loop.step || log.subSteps !== this.subSteps) throw new EngineError('INVALID_PAYLOAD', 'Replay needs the same step and subSteps as the recording.');
    this.stopRecordingIfActive('replay');
    this.resetArena(log.seed);
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
