/**
 * Gameplay building blocks made from spatial queries: trigger volumes with
 * enter/exit events and a kinematic character controller. Both work with the
 * shipped WASM, which has no sensors, contact events or kinematic bodies;
 * see the notes on each class for what that costs.
 */
import {EngineError} from './core/contracts.js';
import type {NativeQueryCastHit, NativeQueryFilter, NativeSpatialQuery} from './core/native-world.js';
import {toVec3, type Body, type PhysicsWorld, type Vec3Like} from './world.js';

/** Gravity of the native world, fixed by the shipped bridge (the cable and water modules default to -9.81). */
export const NATIVE_GRAVITY: readonly [number, number, number] = Object.freeze([0, -10, 0]) as readonly [number, number, number];

/** Most bodies one query can report; triggers holding more report `overflow`. */
export const MAX_QUERY_HITS = 256;
// The native batch accepts at most this many queries per call.
const MAX_BATCH = 128;

export type TriggerShape =
  | {readonly kind: 'box'; readonly center: Vec3Like; readonly halfExtents: Vec3Like}
  | {readonly kind: 'sphere'; readonly center: Vec3Like; readonly radius: number};

export interface TriggerOptions<T = unknown> {
  readonly shape: TriggerShape;
  /** Which bodies count. Default: dynamic bodies only. */
  readonly filter?: NativeQueryFilter;
  /** Anything you want back in events, e.g. a zone id. */
  readonly data?: T;
  /** Most bodies reported per update, 1..MAX_QUERY_HITS (default). Beyond it the trigger reports `overflow`. */
  readonly limit?: number;
}

export interface Trigger<T = unknown> {
  readonly id: number;
  shape: TriggerShape;
  readonly filter: NativeQueryFilter;
  readonly data: T | undefined;
  readonly limit: number;
  /**
   * True when the last update found more bodies than `limit`. Exits
   * are then withheld for bodies the query could not report, so membership
   * can lag until the crowd thins out.
   */
  readonly overflow: boolean;
}

export interface TriggerEvent<T = unknown> {
  readonly type: 'enter' | 'exit';
  readonly trigger: Trigger<T>;
  readonly body: Body;
  /** False when the body was destroyed inside the volume; do not query it. */
  readonly alive: boolean;
}

interface TriggerState<T> extends Trigger<T> {
  overflow: boolean;
  inside: Map<bigint, Body>;
}

/**
 * Trigger volumes: axis-aligned boxes or spheres that report which bodies
 * enter and leave them. All volumes are tested in one batched native query
 * per update (chunks of 128). Call update() after each fixed step, or pass
 * `{attach: true}` to have the world do it through onStep().
 *
 * Detection is by overlap at step boundaries, so a body fast enough to cross
 * a thin volume within one step is missed; make volumes at least one step of
 * travel deep, or use a sweep.
 */
export class TriggerSet<T = unknown> {
  private readonly triggers = new Map<number, TriggerState<T>>();
  private nextId = 1;
  private detach: (() => void) | null = null;
  private readonly listeners = new Set<(event: TriggerEvent<T>) => void>();

  constructor(private readonly world: PhysicsWorld, options: {attach?: boolean} = {}) {
    if (options.attach) this.detach = world.onStep(() => { this.update(); });
  }

  add(options: TriggerOptions<T>): Trigger<T> {
    validateShape(options.shape);
    const limit = options.limit ?? MAX_QUERY_HITS;
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_QUERY_HITS) throw new EngineError('INVALID_PAYLOAD', `Trigger limit must be an integer in 1..${MAX_QUERY_HITS}.`);
    const trigger: TriggerState<T> = {id: this.nextId++, shape: options.shape, filter: options.filter ?? {bodies: 'dynamic'}, data: options.data, limit, overflow: false, inside: new Map()};
    this.triggers.set(trigger.id, trigger);
    return trigger;
  }

  /** Remove a volume. Bodies inside it get no exit event. */
  remove(trigger: Trigger<T>): boolean { return this.triggers.delete(trigger.id); }

  /** Move or resize a volume; the change takes effect at the next update. */
  setShape(trigger: Trigger<T>, shape: TriggerShape): void {
    validateShape(shape);
    this.state(trigger).shape = shape;
  }

  /** Bodies inside the volume as of the last update. */
  bodiesIn(trigger: Trigger<T>): Body[] { return [...this.state(trigger).inside.values()]; }

  /** Receive every event as it is produced. Returns an unsubscribe function. */
  on(listener: (event: TriggerEvent<T>) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  get size(): number { return this.triggers.size; }

  /** Query every volume and return the enter/exit events since the last update. */
  update(): TriggerEvent<T>[] {
    const events: TriggerEvent<T>[] = [];
    const all = [...this.triggers.values()];
    for (let start = 0; start < all.length; start += MAX_BATCH) {
      const chunk = all.slice(start, start + MAX_BATCH);
      const results = this.world.native.queryBatch(chunk.map(toQuery));
      for (let i = 0; i < chunk.length; i++) diff(this.world, chunk[i], results[i].hits.map(hit => hit.body), results[i].overflow, events);
    }
    for (const event of events) for (const listener of this.listeners) listener(event);
    return events;
  }

  /** Stop automatic updates (if attached) and forget every volume. */
  dispose(): void {
    this.detach?.();
    this.detach = null;
    this.triggers.clear();
    this.listeners.clear();
  }

  private state(trigger: Trigger<T>): TriggerState<T> {
    const state = this.triggers.get(trigger.id);
    if (!state || state !== trigger) throw new EngineError('INVALID_PAYLOAD', 'The trigger does not belong to this TriggerSet.');
    return state;
  }
}

function validateShape(shape: TriggerShape): void {
  toVec3(shape.center);
  if (shape.kind === 'box') {
    if (!toVec3(shape.halfExtents).every(v => Number.isFinite(v) && v > 0)) throw new EngineError('INVALID_PAYLOAD', 'Trigger half extents must be positive.');
  } else if (shape.kind === 'sphere') {
    if (!(Number.isFinite(shape.radius) && shape.radius > 0)) throw new EngineError('INVALID_PAYLOAD', 'Trigger radius must be positive.');
  } else throw new EngineError('INVALID_PAYLOAD', 'Trigger shape kind must be box or sphere.');
}

function toQuery(trigger: TriggerState<unknown>): NativeSpatialQuery {
  const s = trigger.shape;
  return s.kind === 'box'
    ? {kind: 'box-overlap', origin: toVec3(s.center), halfExtents: toVec3(s.halfExtents), limit: trigger.limit, filter: trigger.filter}
    : {kind: 'sphere-overlap', origin: toVec3(s.center), radius: s.radius, limit: trigger.limit, filter: trigger.filter};
}

function diff<T>(world: PhysicsWorld, trigger: TriggerState<T>, found: Body[], overflow: boolean, events: TriggerEvent<T>[]): void {
  trigger.overflow = overflow;
  const seen = new Set<bigint>();
  for (const body of found) {
    seen.add(body.token);
    if (!trigger.inside.has(body.token)) {
      trigger.inside.set(body.token, body);
      events.push({type: 'enter', trigger, body, alive: true});
    }
  }
  for (const [token, body] of trigger.inside) {
    if (seen.has(token)) continue;
    const alive = world.isAlive(body);
    // An overflowing query may simply have omitted a body that is still inside.
    if (overflow && alive) continue;
    trigger.inside.delete(token);
    events.push({type: 'exit', trigger, body, alive});
  }
}

export interface CharacterOptions {
  /** Centre of the character box. */
  readonly position: Vec3Like;
  /** Default [0.3, 0.9, 0.3]: a 0.6 m x 1.8 m x 0.6 m box. */
  readonly halfExtents?: Vec3Like;
  /** Gap kept from surfaces so the next sweep does not start in contact. Default 0.02 m. */
  readonly skin?: number;
  /** Steepest walkable slope in degrees. Default 50. */
  readonly maxSlopeDegrees?: number;
  /** Tallest ledge the character walks up without jumping. Default 0.35 m. */
  readonly stepHeight?: number;
  /** Default NATIVE_GRAVITY[1] (-10 m/s^2). */
  readonly gravity?: number;
  /** Impulse per (m/s of approach speed) given to dynamic bodies the character walks into. Default 0 (no pushing). */
  readonly pushStrength?: number;
  /** Slide iterations per sweep. Default 4. */
  readonly maxIterations?: number;
}

export interface CharacterMoveInput {
  /** Wanted horizontal velocity in m/s; y is ignored. */
  readonly velocity: Vec3Like;
  /** Vertical launch speed in m/s, applied only while grounded. */
  readonly jump?: number;
}

export interface CharacterState {
  readonly position: readonly [number, number, number];
  readonly verticalSpeed: number;
  readonly grounded: boolean;
  /** Normal of the walkable surface underfoot, or null in the air. */
  readonly groundNormal: readonly [number, number, number] | null;
  /** Body underfoot (the arena ground is a body too), or null. */
  readonly groundBody: Body | null;
  /** Dynamic bodies pushed during the last move. */
  readonly pushed: readonly Body[];
  /** True when the last move started inside static geometry and could not free itself. */
  readonly stuck: boolean;
}

/**
 * A kinematic box character that walks, slides along walls, climbs steps,
 * respects a slope limit and sticks to the ground on the way down, using
 * box casts against the world.
 *
 * It is not a physics body: the shipped WASM cannot create kinematic bodies,
 * so falling boxes pass through the character and only the character's own
 * pushes (applyImpulse) affect them. Dynamic bodies that end up overlapping
 * it are ignored for that move rather than trapping it. Character input is
 * not part of a ReplayLog; to replay a session, re-drive move() with the same
 * inputs (its pushes are recorded as impulses).
 */
export class CharacterController {
  readonly halfExtents: readonly [number, number, number];
  readonly skin: number;
  readonly stepHeight: number;
  readonly gravity: number;
  readonly pushStrength: number;
  readonly maxIterations: number;
  private readonly minGroundY: number;
  private pos: [number, number, number];
  private vy = 0;
  private ground: {normal: [number, number, number]; body: Body} | null = null;
  private pushedBodies: Body[] = [];
  private stuckFlag = false;
  private dt = 1 / 60;

  constructor(private readonly world: PhysicsWorld, options: CharacterOptions) {
    this.pos = toVec3(options.position);
    this.halfExtents = toVec3(options.halfExtents ?? [0.3, 0.9, 0.3]);
    this.skin = options.skin ?? 0.02;
    this.stepHeight = options.stepHeight ?? 0.35;
    this.gravity = options.gravity ?? NATIVE_GRAVITY[1];
    this.pushStrength = options.pushStrength ?? 0;
    this.maxIterations = options.maxIterations ?? 4;
    this.minGroundY = Math.cos((options.maxSlopeDegrees ?? 50) * Math.PI / 180);
    const numbers = [...this.pos, ...this.halfExtents, this.skin, this.stepHeight, this.gravity, this.pushStrength, this.minGroundY];
    if (!numbers.every(Number.isFinite) || !this.halfExtents.every(v => v > 0) || this.skin <= 0 || this.stepHeight < 0 || this.pushStrength < 0) {
      throw new EngineError('INVALID_PAYLOAD', 'CharacterController options must be finite, with positive extents and skin.');
    }
    if (!Number.isInteger(this.maxIterations) || this.maxIterations < 1) throw new EngineError('INVALID_PAYLOAD', 'maxIterations must be a positive integer.');
  }

  get state(): CharacterState {
    return {position: [...this.pos], verticalSpeed: this.vy, grounded: this.ground !== null, groundNormal: this.ground ? [...this.ground.normal] : null,
      groundBody: this.ground?.body ?? null, pushed: [...this.pushedBodies], stuck: this.stuckFlag};
  }

  /** Teleport, e.g. to a spawn point. Clears vertical speed and ground contact. */
  teleport(position: Vec3Like): void {
    this.pos = toVec3(position);
    this.vy = 0;
    this.ground = null;
  }

  /** Advance the character by dt seconds (call once per fixed step, or per frame). */
  move(input: CharacterMoveInput, dt: number): CharacterState {
    if (!(dt > 0 && dt <= 0.25)) throw new EngineError('INVALID_PAYLOAD', 'dt must be in (0, 0.25] seconds.');
    const velocity = toVec3(input.velocity);
    this.dt = dt;
    this.pushedBodies = [];
    this.stuckFlag = !this.escapeStatic();
    const wasGrounded = this.ground !== null;
    let jumped = false;
    if (wasGrounded && input.jump && input.jump > 0) { this.vy = input.jump; jumped = true; }
    else if (!wasGrounded) this.vy += this.gravity * dt;
    else this.vy = 0;

    // Horizontal: slide, and if a wall blocks progress try stepping up onto it.
    const want: [number, number, number] = [velocity[0] * dt, 0, velocity[2] * dt];
    if (want[0] !== 0 || want[2] !== 0) {
      const start = [...this.pos] as [number, number, number];
      const blocked = this.slide(want, true);
      if (blocked && wasGrounded && this.stepHeight > 0) this.tryStep(start, want);
    }

    // Vertical: fall or rise, landing on walkable surfaces.
    this.ground = null;
    if (this.vy !== 0) {
      const hit = this.sweep([0, this.vy * dt, 0]);
      if (hit && this.vy < 0 && hit.normal[1] >= this.minGroundY) this.land(hit);
      if (hit && this.vy > 0 && hit.normal[1] < -0.5) this.vy = 0; // ceiling
    }
    // Stay glued to slopes and small drops while walking.
    if (!this.ground && wasGrounded && !jumped && this.stepHeight > 0) {
      const before = [...this.pos] as [number, number, number];
      const hit = this.sweep([0, -(this.stepHeight + this.skin), 0]);
      if (hit && hit.normal[1] >= this.minGroundY) this.land(hit);
      else this.pos = before;
    }
    if (!this.ground && this.vy === 0 && !jumped) {
      // Resting check: something walkable within the skin below.
      const probe = this.cast([0, -2 * this.skin, 0], null);
      if (probe && probe.hit.normal[1] >= this.minGroundY && probe.hit.fraction > 0) this.ground = {normal: toVec3(probe.hit.normal), body: probe.hit.body};
    }
    return this.state;
  }

  private land(hit: NativeQueryCastHit): void {
    this.ground = {normal: toVec3(hit.normal), body: hit.body};
    this.vy = 0;
  }

  /** Move along `delta`, sliding along surfaces. Returns true if a steep surface stopped horizontal progress. */
  private slide(delta: [number, number, number], horizontal: boolean): boolean {
    let remaining = delta, blocked = false;
    const ignored: Body[] = [];
    for (let i = 0; i < this.maxIterations; i++) {
      const length = Math.hypot(remaining[0], remaining[1], remaining[2]);
      if (length < 1e-6) break;
      const cast = this.cast(remaining, ignored);
      if (!cast) { add(this.pos, remaining, 1); break; }
      const {hit, dynamic} = cast;
      if (hit.fraction === 0 && hit.normal[0] === 0 && hit.normal[1] === 0 && hit.normal[2] === 0) {
        // Started overlapping. A dynamic body fell into us: push it and walk through this move.
        if (dynamic) { this.push(hit.body, remaining); ignored.push(hit.body); continue; }
        blocked = true;
        break;
      }
      add(this.pos, remaining, hit.fraction);
      add(this.pos, hit.normal as [number, number, number], this.skin);
      if (dynamic) this.push(hit.body, remaining);
      const n = hit.normal, rest = 1 - hit.fraction;
      const r: [number, number, number] = [remaining[0] * rest, remaining[1] * rest, remaining[2] * rest];
      let d = r[0] * n[0] + r[1] * n[1] + r[2] * n[2];
      if (horizontal && n[1] < this.minGroundY) {
        // Walls and steep slopes: slide in the horizontal plane only, never climb.
        blocked = true;
        const hn = Math.hypot(n[0], n[2]);
        if (hn > 1e-6) { const nx = n[0] / hn, nz = n[2] / hn; d = r[0] * nx + r[2] * nz; r[0] -= nx * d; r[2] -= nz * d; }
        r[1] = 0;
      } else {
        r[0] -= n[0] * d; r[1] -= n[1] * d; r[2] -= n[2] * d;
      }
      remaining = r;
    }
    return blocked;
  }

  private tryStep(start: [number, number, number], want: [number, number, number]): void {
    const walked = [...this.pos] as [number, number, number];
    const progress = Math.hypot(walked[0] - start[0], walked[2] - start[2]);
    this.pos = [...start];
    const up = this.sweep([0, this.stepHeight, 0]);
    const raised = this.pos[1] - start[1];
    if (up && raised < this.skin) { this.pos = walked; return; }
    this.slide(want, true);
    const down = this.sweep([0, -(raised + this.skin), 0]);
    const stepped = Math.hypot(this.pos[0] - start[0], this.pos[2] - start[2]);
    if (down && down.normal[1] >= this.minGroundY && stepped > progress + 1e-4) { this.land(down); return; }
    this.pos = walked;
  }

  /** Move straight along delta, stopping a skin short of the first hit. */
  private sweep(delta: [number, number, number]): NativeQueryCastHit | null {
    const cast = this.cast(delta, null);
    if (!cast) { add(this.pos, delta, 1); return null; }
    if (cast.hit.fraction > 0) {
      add(this.pos, delta, cast.hit.fraction);
      add(this.pos, cast.hit.normal as [number, number, number], this.skin);
    }
    return cast.hit;
  }

  /** Closest hit of the character box along delta, testing static and dynamic bodies in one batch. */
  private cast(delta: [number, number, number], ignored: Body[] | null): {hit: NativeQueryCastHit; dynamic: boolean} | null {
    const base = {kind: 'box-cast' as const, origin: this.pos, halfExtents: this.halfExtents, translation: delta, limit: 8};
    const [statics, dynamics] = this.world.native.queryBatch([{...base, filter: {bodies: 'static'}}, {...base, filter: {bodies: 'dynamic'}}]);
    const s = statics.hits[0] as NativeQueryCastHit | undefined;
    const skip = ignored ? new Set(ignored.map(b => b.token)) : null;
    const d = (dynamics.hits as readonly NativeQueryCastHit[]).find(hit => !skip?.has(hit.body.token));
    if (!s && !d) return null;
    if (s && (!d || s.fraction <= d.fraction)) return {hit: s, dynamic: false};
    return {hit: d!, dynamic: true};
  }

  private push(body: Body, delta: [number, number, number]): void {
    if (this.pushStrength === 0 || this.pushedBodies.some(b => b.token === body.token) || !this.world.isAlive(body)) return;
    const h = Math.hypot(delta[0], delta[2]);
    if (h < 1e-6) return;
    const speed = h / this.dt * this.pushStrength;
    this.world.applyImpulse(body, [delta[0] / h * speed, 0, delta[2] / h * speed]);
    this.pushedBodies.push(body);
  }

  /** If the box starts inside static geometry, rise up to stepHeight to get out. Returns false when still stuck. */
  private escapeStatic(): boolean {
    const probe = (y: number) => this.world.overlapBox([this.pos[0], y, this.pos[2]], this.halfExtents, {filter: {bodies: 'static'}, limit: 1}).length === 0;
    if (probe(this.pos[1])) return true;
    const steps = Math.max(1, Math.ceil((this.stepHeight + this.skin) / this.skin));
    for (let i = 1; i <= steps; i++) {
      const y = this.pos[1] + i * this.skin;
      if (probe(y)) { this.pos[1] = y; return true; }
    }
    return false;
  }
}

function add(target: [number, number, number], v: readonly [number, number, number] | readonly number[], scale: number): void {
  target[0] += v[0] * scale; target[1] += v[1] * scale; target[2] += v[2] * scale;
}
