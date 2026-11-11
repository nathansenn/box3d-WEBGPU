/**
 * Run a PhysicsWorld on a worker thread so stepping never blocks rendering.
 *
 *   // physics.worker.js
 *   import {serveWorld} from 'box3d-webgpu-kit/worker';
 *   serveWorld(self);
 *
 *   // main thread
 *   import {connectWorld} from 'box3d-webgpu-kit/worker';
 *   const world = await connectWorld(new Worker(new URL('./physics.worker.js', import.meta.url), {type: 'module'}));
 *   const frame = await world.update(dt);     // steps in the worker, returns fresh transforms
 *   syncInstancedMesh(world, mesh);           // RemoteWorld is an InstanceSource
 *
 * Bodies cross the boundary as {token} records (structured-clone safe).
 */
import {EngineError} from './core/contracts.js';
import type {LoadBox3DOptions} from './loader.js';
import type {
  BodyKind, BodyOptions, BodyPose, BodyState, BodyType, JointOptions, JointState, QuatLike, QueryOptions, ReplayLog, ReplayReport, RecordingOptions,
  ResetOptions, SpawnBoxOptions, Vec3, Vec3Like, WorldEvent, WorldOptions, WorldStats,
} from './world.js';
import type {PhysicsWorld} from './world.js';
import type {InstanceSource} from './three.js';
import {SharedFrameReader, SharedFrameWriter, sharedMemoryAvailable} from './shared-frames.js';

/** Worker, DedicatedWorkerGlobalScope, MessagePort, or Node worker_threads Worker/parentPort. */
export interface MessageEndpoint {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  addEventListener?(type: 'message', listener: (event: {data: unknown}) => void): void;
  on?(type: 'message', listener: (data: unknown) => void): void;
  terminate?(): unknown;
}

function listen(endpoint: MessageEndpoint, handler: (data: unknown) => void): void {
  if (typeof endpoint.addEventListener === 'function') endpoint.addEventListener('message', event => handler(event.data));
  else if (typeof endpoint.on === 'function') endpoint.on('message', handler);
  else throw new TypeError('Endpoint needs addEventListener or on.');
}

export interface RemoteBody { readonly token: bigint }
export interface RemoteJoint { readonly token: bigint }
/** JointOptions with the bodies as remote handles. */
export type RemoteJointOptions = Omit<JointOptions, 'bodyA' | 'bodyB'> & {readonly bodyA: RemoteBody | null; readonly bodyB: RemoteBody | null};
/** A WorldEvent with the bodies as remote handles. */
export type RemoteWorldEvent = Omit<WorldEvent, 'bodyA' | 'bodyB'> & {readonly bodyA: RemoteBody | null; readonly bodyB: RemoteBody | null};
export interface RemoteCastHit {
  readonly body: RemoteBody;
  readonly point: Vec3;
  readonly normal: Vec3;
  readonly fraction: number;
}
export interface RemoteFrame {
  readonly steps: number;
  readonly alpha: number;
  readonly droppedSeconds: number;
  readonly bodies: number;
}
export type RemoteWorldOptions = WorldOptions & Omit<LoadBox3DOptions, 'factory' | 'wasmBinary'> & {
  /** Send transforms blended to the frame's alpha (smooth motion). Default true. */
  readonly interpolateFrames?: boolean;
  /**
   * Deliver frames through a SharedArrayBuffer instead of postMessage: no
   * per-frame copies through the message queue, and required by start().
   * 'auto' (default) uses it when SharedArrayBuffer is available, which in
   * browsers means a cross-origin isolated page (COOP/COEP headers).
   */
  readonly sharedMemory?: boolean | 'auto';
  /** Start in SI units with this gravity (m/s^2) instead of the classic arena. */
  readonly gravity?: readonly [number, number, number];
  /** false starts with no ground. Implies an SI world. */
  readonly ground?: boolean;
};

interface Request { id: number; method: string; args: unknown[] }
type Response = {id: number; ok: true; result: unknown; frame?: FramePayload} | {id: number; ok: false; code: string; message: string};
interface FramePayload { count: number; transformVersion: number; colorVersion: number; matrices?: Float32Array; colors?: Float32Array; shared?: true; kinds?: BodyKind[] }

// ───────────────────────── worker side ─────────────────────────

/** Host one world inside a worker. Call once in the worker's module scope. */
export function serveWorld(endpoint: MessageEndpoint): void {
  let world: PhysicsWorld | null = null;
  let interpolateFrames = true;
  let sentColorVersion = -1, sentColorCount = -1;
  let shared: SharedFrameWriter | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const bodies = new Map<bigint, ReturnType<PhysicsWorld['bodyAt']>>();
  const joints = new Map<bigint, ReturnType<PhysicsWorld['createJoint']>>();
  // Events wait here until the main thread asks for them.
  let queued: RemoteWorldEvent[] = [], queuedDropped = 0, unsubscribe: (() => void) | null = null;
  // Row shapes travel with the next frame after anything that can change them.
  let kindsDirty = true;
  const joint = (ref: unknown) => {
    const token = (ref as RemoteJoint | null)?.token;
    const found = typeof token === 'bigint' ? joints.get(token) : undefined;
    if (!found) throw new EngineError('STALE_JOINT', 'Unknown or destroyed joint.');
    return found;
  };

  const remember = (body: ReturnType<PhysicsWorld['bodyAt']> | null): RemoteBody | null => {
    if (!body) return null;
    bodies.set(body.token, body);
    return {token: body.token};
  };
  const lookup = (ref: unknown) => {
    const token = (ref as RemoteBody | null)?.token;
    const body = typeof token === 'bigint' ? bodies.get(token) : undefined;
    if (!body) throw new EngineError('STALE_BODY', 'Unknown or destroyed body.');
    return body;
  };
  const hit = (h: ReturnType<PhysicsWorld['raycast']>): RemoteCastHit | null =>
    h && {body: remember(h.body)!, point: h.point, normal: h.normal, fraction: h.fraction};
  const live = () => {
    if (!world) throw new EngineError('DISPOSED', 'World is not initialized or was disposed.');
    return world;
  };
  const frame = (alpha: number | null): {payload: FramePayload; transfer: Transferable[]} => {
    const w = live();
    if (shared) {
      shared.publish(alpha !== null && interpolateFrames ? w.interpolatedMatrices(alpha) : w.matrices(), w.bodyCount(), w.colors(), w.colorVersion());
      return {payload: {count: w.bodyCount(), transformVersion: w.transformVersion(), colorVersion: w.colorVersion(), shared: true}, transfer: []};
    }
    const matrices = (alpha !== null && interpolateFrames ? w.interpolatedMatrices(alpha) : w.matrices()).slice();
    const payload: FramePayload = {count: w.bodyCount(), transformVersion: w.transformVersion(), colorVersion: w.colorVersion(), matrices};
    const transfer: Transferable[] = [matrices.buffer];
    if (payload.colorVersion !== sentColorVersion || payload.count !== sentColorCount) {
      payload.colors = w.colors().slice();
      transfer.push(payload.colors.buffer);
      sentColorVersion = payload.colorVersion;
      sentColorCount = payload.count;
    }
    return {payload, transfer};
  };
  const forget = () => { bodies.clear(); joints.clear(); queued = []; queuedDropped = 0; kindsDirty = true; sentColorVersion = -1; sentColorCount = -1; };
  const listenForEvents = () => {
    unsubscribe?.();
    unsubscribe = live().onEvent(event => {
      if (queued.length >= 65536) { queuedDropped++; return; }
      queued.push({...event, bodyA: remember(event.bodyA), bodyB: remember(event.bodyB)});
    });
  };
  const stop = () => { if (timer !== null) clearInterval(timer); timer = null; };

  const methods: Record<string, (...args: any[]) => unknown> = {
    async init(options: RemoteWorldOptions = {}) {
      const {createWorld} = await import('./index.js');
      stop();
      world?.dispose();
      world = await createWorld(options);
      interpolateFrames = options.interpolateFrames ?? true;
      forget();
      unsubscribe = null;
      const wantShared = options.sharedMemory ?? 'auto';
      if (wantShared === true && !sharedMemoryAvailable()) throw new EngineError('UNSUPPORTED_BACKEND', 'SharedArrayBuffer is unavailable: serve the page cross-origin isolated (COOP/COEP) or pass sharedMemory: false.');
      shared = wantShared !== false && sharedMemoryAvailable() ? new SharedFrameWriter(world.native.maxBodies) : null;
      return {capacity: world.native.maxBodies, step: world.loop.step, subSteps: world.subSteps, seed: world.seed, shared: shared?.buffer ?? null};
    },
    spawnBox: (options: SpawnBoxOptions) => { kindsDirty = true; return remember(live().spawnBox(options)); },
    destroyBody: (ref: RemoteBody) => {
      const body = bodies.get(ref?.token);
      if (!body) return false;
      bodies.delete(ref.token);
      kindsDirty = true;
      return live().destroyBody(body);
    },
    reset: (options?: ResetOptions) => { live().reset(options); forget(); if (unsubscribe) listenForEvents(); },
    setGravity: (gravity: Vec3Like) => live().setGravity(gravity),
    gravity: () => live().gravity(),
    createBody: (options: BodyOptions) => { kindsDirty = true; return remember(live().createBody(options)); },
    getState: (ref: RemoteBody) => live().getState(lookup(ref)),
    setTransform: (ref: RemoteBody, position: Vec3Like, rotation?: QuatLike) => live().setTransform(lookup(ref), position, rotation),
    setVelocity: (ref: RemoteBody, linear: Vec3Like, angular?: Vec3Like) => live().setVelocity(lookup(ref), linear, angular),
    moveKinematic: (ref: RemoteBody, position: Vec3Like, rotation?: QuatLike, seconds?: number) => live().moveKinematic(lookup(ref), position, rotation, seconds),
    setBodyType: (ref: RemoteBody, type: BodyType) => live().setBodyType(lookup(ref), type),
    setAwake: (ref: RemoteBody, awake: boolean) => live().setAwake(lookup(ref), awake),
    setGravityScale: (ref: RemoteBody, scale: number) => live().setGravityScale(lookup(ref), scale),
    setDamping: (ref: RemoteBody, linear: number, angular: number) => live().setDamping(lookup(ref), linear, angular),
    setCollisionFilter: (ref: RemoteBody, categoryBits: bigint, maskBits: bigint, groupIndex?: number) => live().setCollisionFilter(lookup(ref), categoryBits, maskBits, groupIndex),
    applyForce: (ref: RemoteBody, force: Vec3Like, point?: Vec3Like) => live().applyForce(lookup(ref), force, point),
    applyTorque: (ref: RemoteBody, torque: Vec3Like) => live().applyTorque(lookup(ref), torque),
    applyImpulseAt: (ref: RemoteBody, impulse: Vec3Like, point: Vec3Like) => live().applyImpulseAt(lookup(ref), impulse, point),
    applyAngularImpulse: (ref: RemoteBody, impulse: Vec3Like) => live().applyAngularImpulse(lookup(ref), impulse),
    createJoint: (options: RemoteJointOptions): RemoteJoint => {
      const made = live().createJoint({...options, bodyA: options.bodyA ? lookup(options.bodyA) : null, bodyB: options.bodyB ? lookup(options.bodyB) : null});
      joints.set(made.token, made);
      return {token: made.token};
    },
    destroyJoint: (ref: RemoteJoint) => {
      const found = joints.get(ref?.token);
      if (!found) return false;
      joints.delete(ref.token);
      return live().destroyJoint(found);
    },
    isJointAlive: (ref: RemoteJoint) => { const found = joints.get(ref?.token); return !!found && live().isJointAlive(found); },
    setJointMotor: (ref: RemoteJoint, motor: {speed: number; maxForce: number} | null) => live().setJointMotor(joint(ref), motor),
    setJointLimits: (ref: RemoteJoint, limits: {lower: number; upper: number} | null) => live().setJointLimits(joint(ref), limits),
    setJointSpring: (ref: RemoteJoint, spring: {hertz: number; dampingRatio: number; target?: number} | null) => live().setJointSpring(joint(ref), spring),
    setJointStiffness: (ref: RemoteJoint, hertz: number, dampingRatio?: number) => live().setJointStiffness(joint(ref), hertz, dampingRatio),
    setJointSteering: (ref: RemoteJoint, steering: {angle: number; hertz: number; dampingRatio: number; maxTorque: number} | null) => live().setJointSteering(joint(ref), steering),
    getJointState: (ref: RemoteJoint) => live().getJointState(joint(ref)),
    /** Start collecting events (first call) and hand over everything collected since the last call. */
    takeEvents: () => {
      if (!unsubscribe) listenForEvents();
      const result = {events: queued, dropped: queuedDropped};
      queued = []; queuedDropped = 0;
      return result;
    },
    isAlive: (ref: RemoteBody) => { const body = bodies.get(ref?.token); return !!body && live().isAlive(body); },
    applyImpulse: (ref: RemoteBody, impulse: Vec3Like) => live().applyImpulse(lookup(ref), impulse),
    explode: (center: Vec3Like, strength: number, radius: number) => live().explode(center, strength, radius),
    getPose: (ref: RemoteBody) => { const body = bodies.get(ref?.token); return body ? live().getPose(body) : null; },
    bodyAt: (row: number) => remember(live().bodyAt(row)),
    raycast: (o: Vec3Like, t: Vec3Like, q?: QueryOptions) => hit(live().raycast(o, t, q)),
    sphereCast: (o: Vec3Like, r: number, t: Vec3Like, q?: QueryOptions) => hit(live().sphereCast(o, r, t, q)),
    boxCast: (o: Vec3Like, h: Vec3Like, t: Vec3Like, q?: QueryOptions) => hit(live().boxCast(o, h, t, q)),
    overlapSphere: (c: Vec3Like, r: number, q?: QueryOptions) => live().overlapSphere(c, r, q).map(remember),
    overlapBox: (c: Vec3Like, h: Vec3Like, q?: QueryOptions) => live().overlapBox(c, h, q).map(remember),
    resetArena: (seed?: number) => { live().resetArena(seed); forget(); },
    loadPreset: (id: number, stress?: number, seed?: number) => { const n = live().loadPreset(id, stress, seed); forget(); return n; },
    stats: () => live().stats(),
    exactHash: () => live().exactHash(),
    replayHash: () => live().replayHash(),
    startRecording: (options?: RecordingOptions) => { live().startRecording(options); forget(); },
    stopRecording: () => live().stopRecording(),
    replay: (log: ReplayLog) => { const ok = live().replay(log); forget(); return ok; },
    replayDetailed: (log: ReplayLog) => { const report = live().replayDetailed(log); forget(); return report; },
    step: () => { live().step(); },
    update: (dt: number) => live().update(dt),
    /** Step on the worker's own clock at `hz`, publishing each frame to shared memory. */
    start: (hz?: number) => {
      const w = live();
      if (!shared) throw new EngineError('UNSUPPORTED_BACKEND', 'start() needs shared memory (sharedMemory: true or a cross-origin isolated page).');
      stop();
      const rate = hz ?? 1 / w.loop.step;
      if (!(rate > 0 && rate <= 1000)) throw new EngineError('INVALID_PAYLOAD', 'hz must be in (0, 1000].');
      const clock = () => globalThis.performance?.now() ?? Date.now();
      let last = clock();
      timer = setInterval(() => {
        const t = clock();
        const result = w.update((t - last) / 1000);
        last = t;
        frame(result.alpha);
      }, 1000 / rate);
    },
    stop: () => { stop(); if (world) frame(null); },
    dispose: () => { stop(); unsubscribe?.(); unsubscribe = null; world?.dispose(); world = null; shared = null; forget(); },
  };
  const withFrame = new Set(['init', 'update', 'step', 'spawnBox', 'destroyBody', 'resetArena', 'loadPreset', 'startRecording', 'replay', 'replayDetailed', 'explode', 'applyImpulse',
    'reset', 'createBody', 'setTransform', 'setBodyType']);

  listen(endpoint, async data => {
    const {id, method, args} = data as Request;
    let response: Response, transfer: Transferable[] = [];
    try {
      const fn = Object.hasOwn(methods, method) ? methods[method] : undefined;
      if (!fn) throw new EngineError('INVALID_PAYLOAD', `Unknown method ${String(method)}.`);
      const result = await fn(...(args ?? []));
      response = {id, ok: true, result};
      if (world && withFrame.has(method)) {
        const alpha = method === 'update' ? (result as {alpha: number}).alpha : null;
        const f = frame(alpha);
        response.frame = f.payload;
        if (kindsDirty) { f.payload.kinds = world.bodyKinds(); kindsDirty = false; }
        transfer = f.transfer;
      }
    } catch (error) {
      response = {id, ok: false, code: (error as {code?: string})?.code ?? 'INTERNAL', message: error instanceof Error ? error.message : String(error)};
    }
    endpoint.postMessage(response, transfer);
  });
}

// ───────────────────────── main-thread side ─────────────────────────

/** Main-thread proxy for a worker-hosted world. Every call is async; transforms are cached per frame. */
export class RemoteWorld implements InstanceSource {
  capacity = 0;
  step = 1 / 60;
  private nextId = 1;
  private readonly pending = new Map<number, {resolve(value: unknown): void; reject(error: unknown): void}>();
  private frameMatrices: Float32Array = new Float32Array(0);
  private frameColors: Float32Array = new Float32Array(0);
  private count = 0;
  private transformRevision = 0;
  private colorRevision = 0;
  private readonly userData = new Map<bigint, unknown>();
  private disposed = false;
  private shared: SharedFrameReader | null = null;
  private kinds: BodyKind[] = [];
  /** True when frames arrive through shared memory (see RemoteWorldOptions.sharedMemory). */
  get usesSharedMemory(): boolean { return this.shared !== null; }

  constructor(private readonly endpoint: MessageEndpoint) {
    listen(endpoint, data => this.receive(data as Response));
  }

  private receive(response: Response): void {
    const waiter = this.pending.get(response.id);
    if (!waiter) return;
    this.pending.delete(response.id);
    if (!response.ok) { waiter.reject(new EngineError(response.code, response.message)); return; }
    const frame = response.frame;
    if (frame?.kinds) this.kinds = frame.kinds;
    if (frame && !frame.shared && frame.matrices) {
      this.count = frame.count;
      this.frameMatrices = frame.matrices;
      this.transformRevision++;
      if (frame.colors) { this.frameColors = frame.colors; this.colorRevision++; }
    }
    waiter.resolve(response.result);
  }

  private call<T>(method: string, ...args: unknown[]): Promise<T> {
    if (this.disposed) return Promise.reject(new EngineError('DISPOSED', 'This remote world has been disposed.'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {resolve: resolve as (v: unknown) => void, reject});
      this.endpoint.postMessage({id, method, args} satisfies Request);
    });
  }

  /** @internal Called by connectWorld. */
  async init(options: RemoteWorldOptions): Promise<this> {
    const info = await this.call<{capacity: number; step: number; shared: SharedArrayBuffer | null}>('init', options);
    this.capacity = info.capacity;
    this.step = info.step;
    if (info.shared) {
      this.shared = new SharedFrameReader(info.shared);
      this.sync();
    }
    return this;
  }

  // InstanceSource: the most recent frame from the worker. With shared memory
  // every call picks up the newest complete frame, even between requests.
  private sync(): void {
    const reader = this.shared;
    if (!reader || !reader.poll()) return;
    this.count = reader.count;
    this.frameMatrices = reader.matrices;
    this.frameColors = reader.colors;
    this.transformRevision = reader.revision;
    this.colorRevision = reader.colorRevision;
  }
  bodyCount(): number { this.sync(); return this.count; }
  transformVersion(): number { this.sync(); return this.transformRevision; }
  colorVersion(): number { this.sync(); return this.colorRevision; }
  matrices(): Float32Array { this.sync(); return this.frameMatrices.subarray(0, this.count * 16); }
  colors(): Float32Array { this.sync(); return this.frameColors.subarray(0, this.count * 4); }
  /** Shape of every row, as of the last call that could change it. */
  bodyKinds(): readonly BodyKind[] { return this.kinds; }

  /**
   * Let the worker step on its own clock at `hz` (default: the physics rate)
   * and read frames whenever you render: rendering and physics fully
   * decoupled. Needs shared memory. Other calls keep working meanwhile.
   */
  start(hz?: number): Promise<void> { return this.call('start', hz); }
  /** Stop autonomous stepping. */
  stop(): Promise<void> { return this.call('stop'); }

  /** Step by a frame delta in the worker. Resolves once fresh transforms have arrived. */
  update(frameSeconds: number): Promise<RemoteFrame> {
    return this.call<{steps: number; alpha: number; droppedSeconds: number}>('update', frameSeconds)
      .then(r => ({steps: r.steps, alpha: r.alpha, droppedSeconds: r.droppedSeconds, bodies: this.bodyCount()}));
  }
  stepOnce(): Promise<void> { return this.call('step'); }
  spawnBox(options: SpawnBoxOptions): Promise<RemoteBody | null> { return this.call('spawnBox', options); }
  async destroyBody(body: RemoteBody): Promise<boolean> {
    this.userData.delete(body.token);
    return this.call('destroyBody', body);
  }
  isAlive(body: RemoteBody): Promise<boolean> { return this.call('isAlive', body); }
  applyImpulse(body: RemoteBody, impulse: Vec3Like): Promise<void> { return this.call('applyImpulse', body, impulse); }
  explode(center: Vec3Like, strength: number, radius: number): Promise<void> { return this.call('explode', center, strength, radius); }
  getPose(body: RemoteBody): Promise<BodyPose | null> { return this.call('getPose', body); }
  bodyAt(row: number): Promise<RemoteBody> { return this.call('bodyAt', row); }
  raycast(origin: Vec3Like, translation: Vec3Like, options?: QueryOptions): Promise<RemoteCastHit | null> { return this.call('raycast', origin, translation, options); }
  sphereCast(origin: Vec3Like, radius: number, translation: Vec3Like, options?: QueryOptions): Promise<RemoteCastHit | null> { return this.call('sphereCast', origin, radius, translation, options); }
  boxCast(origin: Vec3Like, halfExtents: Vec3Like, translation: Vec3Like, options?: QueryOptions): Promise<RemoteCastHit | null> { return this.call('boxCast', origin, halfExtents, translation, options); }
  overlapSphere(center: Vec3Like, radius: number, options?: QueryOptions): Promise<RemoteBody[]> { return this.call('overlapSphere', center, radius, options); }
  overlapBox(center: Vec3Like, halfExtents: Vec3Like, options?: QueryOptions): Promise<RemoteBody[]> { return this.call('overlapBox', center, halfExtents, options); }
  resetArena(seed?: number): Promise<void> { this.userData.clear(); return this.call('resetArena', seed); }
  /** Replace the world with an empty SI one; see PhysicsWorld.reset. */
  reset(options?: ResetOptions): Promise<void> { this.userData.clear(); return this.call('reset', options); }
  setGravity(gravity: Vec3Like): Promise<void> { return this.call('setGravity', gravity); }
  gravity(): Promise<[number, number, number]> { return this.call('gravity'); }
  createBody(options: BodyOptions): Promise<RemoteBody | null> { return this.call('createBody', options); }
  getState(body: RemoteBody): Promise<BodyState> { return this.call('getState', body); }
  setTransform(body: RemoteBody, position: Vec3Like, rotation?: QuatLike): Promise<void> { return this.call('setTransform', body, position, rotation); }
  setVelocity(body: RemoteBody, linear: Vec3Like, angular?: Vec3Like): Promise<void> { return this.call('setVelocity', body, linear, angular); }
  moveKinematic(body: RemoteBody, position: Vec3Like, rotation?: QuatLike, seconds?: number): Promise<void> { return this.call('moveKinematic', body, position, rotation, seconds); }
  setBodyType(body: RemoteBody, type: BodyType): Promise<void> { return this.call('setBodyType', body, type); }
  setAwake(body: RemoteBody, awake: boolean): Promise<void> { return this.call('setAwake', body, awake); }
  setGravityScale(body: RemoteBody, scale: number): Promise<void> { return this.call('setGravityScale', body, scale); }
  setDamping(body: RemoteBody, linear: number, angular: number): Promise<void> { return this.call('setDamping', body, linear, angular); }
  setCollisionFilter(body: RemoteBody, categoryBits: bigint, maskBits: bigint, groupIndex?: number): Promise<void> { return this.call('setCollisionFilter', body, categoryBits, maskBits, groupIndex); }
  applyForce(body: RemoteBody, force: Vec3Like, point?: Vec3Like): Promise<void> { return this.call('applyForce', body, force, point); }
  applyTorque(body: RemoteBody, torque: Vec3Like): Promise<void> { return this.call('applyTorque', body, torque); }
  applyImpulseAt(body: RemoteBody, impulse: Vec3Like, point: Vec3Like): Promise<void> { return this.call('applyImpulseAt', body, impulse, point); }
  applyAngularImpulse(body: RemoteBody, impulse: Vec3Like): Promise<void> { return this.call('applyAngularImpulse', body, impulse); }
  createJoint(options: RemoteJointOptions): Promise<RemoteJoint> { return this.call('createJoint', options); }
  destroyJoint(joint: RemoteJoint): Promise<boolean> { return this.call('destroyJoint', joint); }
  isJointAlive(joint: RemoteJoint): Promise<boolean> { return this.call('isJointAlive', joint); }
  setJointMotor(joint: RemoteJoint, motor: {speed: number; maxForce: number} | null): Promise<void> { return this.call('setJointMotor', joint, motor); }
  setJointLimits(joint: RemoteJoint, limits: {lower: number; upper: number} | null): Promise<void> { return this.call('setJointLimits', joint, limits); }
  setJointSpring(joint: RemoteJoint, spring: {hertz: number; dampingRatio: number; target?: number} | null): Promise<void> { return this.call('setJointSpring', joint, spring); }
  setJointStiffness(joint: RemoteJoint, hertz: number, dampingRatio?: number): Promise<void> { return this.call('setJointStiffness', joint, hertz, dampingRatio); }
  setJointSteering(joint: RemoteJoint, steering: {angle: number; hertz: number; dampingRatio: number; maxTorque: number} | null): Promise<void> { return this.call('setJointSteering', joint, steering); }
  getJointState(joint: RemoteJoint): Promise<JointState> { return this.call('getJointState', joint); }
  /**
   * Contact and sensor events since the last call. The first call starts
   * collection in the worker and returns nothing, so call it once at set-up.
   */
  takeEvents(): Promise<{events: RemoteWorldEvent[]; dropped: number}> { return this.call('takeEvents'); }
  loadPreset(id: number, stress?: number, seed?: number): Promise<number> { this.userData.clear(); return this.call('loadPreset', id, stress, seed); }
  stats(): Promise<WorldStats> { return this.call('stats'); }
  exactHash(): Promise<number> { return this.call('exactHash'); }
  replayHash(): Promise<number> { return this.call('replayHash'); }
  startRecording(options?: RecordingOptions): Promise<void> { this.userData.clear(); return this.call('startRecording', options); }
  stopRecording(): Promise<ReplayLog> { return this.call('stopRecording'); }
  replay(log: ReplayLog): Promise<boolean> { this.userData.clear(); return this.call('replay', log); }
  replayDetailed(log: ReplayLog): Promise<ReplayReport> { this.userData.clear(); return this.call('replayDetailed', log); }

  /** Main-thread game data keyed by body; never sent to the worker. */
  setUserData(body: RemoteBody, value: unknown): void { this.userData.set(body.token, value); }
  getUserData<T = unknown>(body: RemoteBody): T | undefined { return this.userData.get(body.token) as T | undefined; }

  /** Dispose the world, reject pending calls and terminate the worker when possible. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    try { await this.call('dispose'); } catch { /* worker may already be gone */ }
    this.disposed = true;
    for (const waiter of this.pending.values()) waiter.reject(new EngineError('DISPOSED', 'Remote world disposed.'));
    this.pending.clear();
    this.userData.clear();
    this.endpoint.terminate?.();
  }
}

// `await using world = await connectWorld(...)` where explicit resource management exists.
const asyncDisposeSymbol = (Symbol as unknown as {asyncDispose?: symbol}).asyncDispose;
if (asyncDisposeSymbol) Object.defineProperty(RemoteWorld.prototype, asyncDisposeSymbol, {value(this: RemoteWorld) { return this.dispose(); }, configurable: true, writable: true});

/** Connect to a worker running serveWorld() and create its world. */
export function connectWorld(endpoint: MessageEndpoint, options: RemoteWorldOptions = {}): Promise<RemoteWorld> {
  return new RemoteWorld(endpoint).init(options);
}
