/**
 * A capsule character on Box3D's character mover (b3World_CollideMover, b3SolvePlanes, b3World_CastMover):
 * walking, a slope limit, steps, jumping, riding moving platforms and pushing dynamic bodies.
 *
 * The character is not a rigid body. Each move reads the world (collision planes around the capsule, a cast along
 * the wanted translation) and writes only the impulses with which it pushes dynamic bodies, through
 * the host's applyImpulseAt, so a recording of the world replays them. Its own state is small and is saved and
 * restored with saveState() / restoreState().
 *
 * Published by the kit as `box3d-webgpu-kit/gameplay`; the Physics Lab uses this file directly.
 */
import {EngineError} from './contracts.ts';
import {captureFields, restoreFields, type FieldHandler, type StateObject, type StateValue} from './checkpoint.ts';
import type {NativeBodyHandle, NativeBodyState, NativeMoverInput, NativeMoverPlane, NativeMoverResult, NativeQueryCastHit, NativeQueryResult, NativeSpatialQuery} from './native-world.ts';

type Body = NativeBodyHandle;
type MoverPlane = NativeMoverPlane;
type Vec3 = readonly [number, number, number];
/** A tuple or an {x, y, z} object (a three.js Vector3 works). */
export type CharacterVec3 = Vec3 | {readonly x: number; readonly y: number; readonly z: number};
const toVec3 = (value: CharacterVec3 | readonly number[]): [number, number, number] => {
  if (Array.isArray(value)) return [value[0], value[1], value[2]];
  const v = value as {x: number; y: number; z: number};
  if (v && typeof v.x === 'number') return [v.x, v.y, v.z];
  throw new EngineError('INVALID_PAYLOAD', 'Expected [x, y, z] or {x, y, z}.');
};

/**
 * What a character needs from a world. The kit's PhysicsWorld has exactly these members; the Physics Lab's scene
 * host has them too.
 */
export interface CharacterHost {
  readonly native: {
    moverMove(input: NativeMoverInput): NativeMoverResult;
    queryBatch(queries: readonly NativeSpatialQuery[]): NativeQueryResult[];
    bodyIndex(body: Body): number | null;
    bodyHandle(index: number): Body;
    bodyCount(): number;
  };
  getState(body: Body): NativeBodyState;
  isAlive(body: Body): boolean;
  /** Impulse in N s at a world-space point. Through the host, so that a recording holds it. */
  applyImpulseAt(body: Body, impulse: Vec3, point: Vec3): void;
  gravity(): [number, number, number];
}

/** Box3D's linear slop (m): a resting capsule sits this far inside the surface it stands on. */
const SLOP = 0.005;
/** The ground probe starts this far above the capsule, so that it never starts in contact. */
const PROBE_LIFT = 0.05;

/** The character's capsule, speeds, slope and step limits, jump and the bodies it collides with. */
export interface CapsuleCharacterOptions {
  /** Centre of the capsule. */
  readonly position: CharacterVec3;
  /** Default 0.3 m. */
  readonly radius?: number;
  /** Total height, caps included. Default 1.8 m. At least 2 * radius + 0.005. */
  readonly height?: number;
  /** Steepest slope the character walks up, in degrees from horizontal. Default 50. */
  readonly maxSlopeDegrees?: number;
  /** Tallest ledge the character walks up without jumping (m). Default 0.35. 0 switches stepping off. */
  readonly stepHeight?: number;
  /** How far below its feet the character looks for ground to stay on while walking down slopes and stairs (m). Default: stepHeight, at least 0.05. */
  readonly snapDistance?: number;
  /** Vertical acceleration in the air (m/s^2, negative is down). Default: the world's gravity y. */
  readonly gravity?: number;
  /** Largest force with which the character pushes a dynamic body (N). Default 800. 0 switches pushing off: dynamic bodies then block like walls. */
  readonly maxPushForce?: number;
  /** A body the character never collides with (its own visual body, for instance). */
  readonly ignoreBody?: Body;
  /** Collision filter of the character's queries. Default: everything. */
  readonly filter?: {readonly categoryBits?: bigint; readonly maskBits?: bigint};
}

/** One step's commands: the wanted horizontal velocity and an optional jump speed. */
export interface CapsuleCharacterInput {
  /** Wanted velocity along the ground in m/s; y is ignored. On a slope the character moves at this speed along the slope. */
  readonly velocity: CharacterVec3;
  /** Vertical launch speed in m/s, applied only while grounded. */
  readonly jump?: number;
}

/** The character after a step: position and feet, velocity, the ground it stands on, what it pushed, and whether it stepped up or stands on a steep slope. */
export interface CapsuleCharacterState {
  /** Centre of the capsule. */
  readonly position: readonly [number, number, number];
  /** Height of the lowest point of the capsule when it rests (the centre minus half the height, plus Box3D's 5 mm slop). */
  readonly feet: number;
  /** Velocity of the last move: displacement / dt. */
  readonly velocity: readonly [number, number, number];
  readonly grounded: boolean;
  /** Normal of the walkable surface underfoot, or null in the air. */
  readonly groundNormal: readonly [number, number, number] | null;
  /** Body underfoot, or null. */
  readonly groundBody: Body | null;
  /** Dynamic bodies pushed during the last move. */
  readonly pushed: readonly Body[];
  /** True when the last move took a step up. */
  readonly stepped: boolean;
  /** True when the character touches a slope steeper than the limit. */
  readonly onSteepSlope: boolean;
}

interface Ground { normal: [number, number, number]; point: [number, number, number]; body: Body }

/**
 * A capsule character: `move(input, dt)` once per fixed step, before or after `world.step()`.
 *
 * - Walks at the wanted speed along walkable ground, and stays on it down slopes and stairs.
 * - Slopes steeper than `maxSlopeDegrees` are walls from below and slides from above.
 * - Ledges up to `stepHeight` are stepped onto. The round bottom also rides over bumps lower than
 *   radius * (1 - cos(maxSlope)) whatever `stepHeight` is.
 * - Rides kinematic and dynamic bodies it stands on (it takes their velocity at its feet) and keeps their
 *   horizontal velocity when it leaves them.
 * - Pushes dynamic bodies with at most `maxPushForce`; heavier ones block it.
 * - Never passes through thin geometry, at any speed: every translation is cast.
 */
export class CapsuleCharacterController {
  readonly radius: number;
  readonly halfLength: number;
  readonly stepHeight: number;
  readonly snapDistance: number;
  readonly gravity: number;
  readonly maxPushForce: number;
  readonly maxSlopeDegrees: number;
  private readonly minGroundY: number;
  private readonly ignoreBody: Body | undefined;
  private readonly categoryBits: bigint | undefined;
  private readonly maskBits: bigint | undefined;
  private pos: [number, number, number];
  private vel: [number, number, number] = [0, 0, 0];
  private verticalSpeed = 0;
  // Horizontal velocity kept from the platform the character left.
  private inherited: [number, number, number] = [0, 0, 0];
  private ground: Ground | null = null;
  // Horizontal normals of the steep planes touched in the last move.
  private steep: [number, number, number][] = [];
  private pushedBodies: Body[] = [];
  private steppedFlag = false;
  // While the character crosses the edge of a ledge it stepped onto: the horizontal direction of its leading foot.
  // Its round bottom is then over the edge, and what it stands on is the ledge under that foot.
  private stepping: [number, number] | null = null;
  // The velocity the last move asked for, before anything stopped it.
  private wanted: [number, number, number] = [0, 0, 0];

  // Declared, not a parameter property: Node runs this file with its types stripped (tests/physics), which leaves those out.
  private readonly world: CharacterHost;

  constructor(world: CharacterHost, options: CapsuleCharacterOptions) {
    this.world = world;
    this.pos = toVec3(options.position);
    this.radius = options.radius ?? 0.3;
    const height = options.height ?? 1.8;
    this.halfLength = height / 2 - this.radius;
    this.maxSlopeDegrees = options.maxSlopeDegrees ?? 50;
    this.stepHeight = options.stepHeight ?? 0.35;
    this.snapDistance = options.snapDistance ?? Math.max(this.stepHeight, 0.05);
    this.gravity = options.gravity ?? world.gravity()[1];
    this.maxPushForce = options.maxPushForce ?? 800;
    this.minGroundY = Math.cos(this.maxSlopeDegrees * Math.PI / 180);
    this.ignoreBody = options.ignoreBody;
    this.categoryBits = options.filter?.categoryBits;
    this.maskBits = options.filter?.maskBits;
    const numbers = [...this.pos, this.radius, height, this.maxSlopeDegrees, this.stepHeight, this.snapDistance, this.gravity, this.maxPushForce];
    if (!numbers.every(Number.isFinite) || !(this.radius > 0) || !(this.halfLength >= 0.0025) || this.stepHeight < 0 || this.snapDistance < 0 || this.maxPushForce < 0
      || !(this.maxSlopeDegrees > 0 && this.maxSlopeDegrees < 90)) {
      throw new EngineError('INVALID_PAYLOAD', 'CapsuleCharacterController: sizes must be finite and positive, height at least 2 * radius + 0.005 and maxSlopeDegrees between 0 and 90.');
    }
  }

  get state(): CapsuleCharacterState {
    return {position: [...this.pos], feet: this.pos[1] - this.halfLength - this.radius + SLOP, velocity: [...this.vel], grounded: this.ground !== null,
      groundNormal: this.ground ? [...this.ground.normal] : null, groundBody: this.ground?.body ?? null, pushed: [...this.pushedBodies], stepped: this.steppedFlag,
      onSteepSlope: this.steep.length > 0};
  }

  /** Put the character somewhere else. Clears its velocity and its ground. */
  teleport(position: CharacterVec3): void {
    this.pos = toVec3(position);
    this.vel = [0, 0, 0]; this.wanted = [0, 0, 0]; this.inherited = [0, 0, 0]; this.verticalSpeed = 0; this.ground = null; this.steep = []; this.pushedBodies = []; this.steppedFlag = false; this.stepping = null;
  }

  /** Advance the character by dt seconds. */
  move(input: CapsuleCharacterInput, dt: number): CapsuleCharacterState {
    if (!(dt > 0 && dt <= 0.25)) throw new EngineError('INVALID_PAYLOAD', 'dt must be in (0, 0.25] seconds.');
    const wishIn = toVec3(input.velocity), wish: [number, number, number] = [wishIn[0], 0, wishIn[2]];
    if (!wish.every(Number.isFinite)) throw new EngineError('INVALID_PAYLOAD', 'velocity must be finite.');
    const start: [number, number, number] = [...this.pos];
    this.pushedBodies = []; this.steppedFlag = false;
    // A ground body that was destroyed since the last move no longer carries anything.
    if (this.ground && !this.world.isAlive(this.ground.body)) this.ground = null;
    let ground = this.ground;
    const carry = ground ? this.velocityAt(ground.body, ground.point) : [0, 0, 0] as [number, number, number];
    if (ground) {
      if (input.jump !== undefined && input.jump > 0) {
        this.verticalSpeed = input.jump + Math.max(0, carry[1]);
        this.inherited = [carry[0], 0, carry[2]];
        ground = null; this.stepping = null;
      } else this.verticalSpeed = 0;
    }
    let delta: [number, number, number];
    if (ground) {
      // Along the ground plane at the wanted speed, plus whatever the ground itself does.
      const n = ground.normal, speed = Math.hypot(wish[0], wish[2]), into = wish[0] * n[0] + wish[2] * n[2];
      const t: [number, number, number] = [wish[0] - n[0] * into, -n[1] * into, wish[2] - n[2] * into], tl = Math.hypot(t[0], t[1], t[2]);
      const k = tl > 1e-9 ? speed / tl : 0;
      delta = [(t[0] * k + carry[0]) * dt, (t[1] * k + carry[1]) * dt, (t[2] * k + carry[2]) * dt];
    } else {
      // Constant acceleration over the step: the mean of the speeds at its two ends gives the exact parabola.
      const before = this.verticalSpeed;
      this.verticalSpeed += this.gravity * dt;
      const h: [number, number, number] = [wish[0] + this.inherited[0], 0, wish[2] + this.inherited[2]];
      // In the air a steep slope cannot be climbed by pushing into it.
      for (const s of this.steep) { const d = h[0] * s[0] + h[2] * s[2]; if (d < 0) { h[0] -= s[0] * d; h[2] -= s[2] * d; } }
      delta = [h[0] * dt, 0.5 * (before + this.verticalSpeed) * dt, h[2] * dt];
    }

    this.wanted = [delta[0] / dt, delta[1] / dt, delta[2] / dt];
    let result = this.slide(this.pos, delta, ground !== null ? this.minGroundY : undefined);
    // A step: on the ground, wanting to go somewhere, and stopped short of it.
    const wanted = Math.hypot(delta[0], delta[2]);
    if (ground && this.stepHeight > 0 && wanted > 1e-6) {
      const progress = (result.position[0] - start[0]) * delta[0] / wanted + (result.position[2] - start[2]) * delta[2] / wanted;
      if (progress < 0.9 * wanted && result.planes.some(plane => plane.push > 0 && plane.normal[1] < this.minGroundY)) {
        const stepped = this.tryStep(start, delta);
        if (stepped) { result = stepped; this.steppedFlag = true; this.stepping = [delta[0] / wanted, delta[2] / wanted]; }
      }
    }
    this.pos = result.position;
    this.push(result.planes, start, dt);

    // Ground under the new position. While walking, look further down so as to stay on slopes and stairs.
    const reach = ground ? this.snapDistance : 0.02;
    let found = this.verticalSpeed <= 0 || ground ? this.probe(this.pos, reach) : null;
    if (this.stepping && ground) {
      // Crossing a ledge's edge: done once the capsule itself stands on the ledge; until then the ledge under the
      // leading foot (one radius ahead) carries it. If that is gone too, it falls.
      const own = this.probe(this.pos, 4 * SLOP, true);
      if (own) { found = own; this.stepping = null; }
      else {
        const ahead = this.probe([this.pos[0] + this.stepping[0] * this.radius, this.pos[1], this.pos[2] + this.stepping[1] * this.radius], 4 * SLOP, true);
        if (ahead) found = {gap: 0, ground: ahead.ground};
        else { found = null; this.stepping = null; }
      }
    } else if (this.stepping) this.stepping = null;
    if (found) {
      // Close the gap in one go; the probe has shown that the way down is free.
      if (found.gap > 1e-4) this.pos[1] -= found.gap;
      this.ground = found.ground;
      this.verticalSpeed = 0;
      this.inherited = [0, 0, 0];
    } else {
      if (ground) this.inherited = [carry[0], 0, carry[2]];
      this.ground = null;
    }
    this.steep = [];
    for (const plane of result.planes) {
      if (plane.normal[1] > 1e-3 && plane.normal[1] < this.minGroundY && plane.push > 0) {
        const h = Math.hypot(plane.normal[0], plane.normal[2]);
        if (h > 1e-6) this.steep.push([plane.normal[0] / h, 0, plane.normal[2] / h]);
      }
      // A ceiling stops a rise.
      if (plane.normal[1] < -0.5 && plane.push > 0 && this.verticalSpeed > 0) this.verticalSpeed = 0;
    }
    this.vel = [(this.pos[0] - start[0]) / dt, (this.pos[1] - start[1]) / dt, (this.pos[2] - start[2]) / dt];
    return this.state;
  }

  private slide(position: readonly [number, number, number], translation: readonly [number, number, number], wallBelow: number | undefined) {
    return this.world.native.moverMove({position, radius: this.radius, halfLength: this.halfLength, translation, wallBelowNormalY: wallBelow, tolerance: 0.001,
      ignoreBody: this.ignoreBody, categoryBits: this.categoryBits, maskBits: this.maskBits});
  }

  // A step: is there walkable ground, one radius ahead, that is higher than here by no more than the step height?
  // The capsule rises by the step height, moves one radius forwards and looks down. While raised, anything that is
  // not level is a wall, so that the round bottom cannot roll over an edge that is higher than the step height. If
  // the ledge is there, the capsule goes to the ledge's height and makes its move at that height; its round bottom is
  // then over the edge, and `stepping` carries it until it stands on the ledge.
  private tryStep(start: [number, number, number], delta: [number, number, number]) {
    const up = this.slide(start, [0, this.stepHeight + 0.5 * SLOP, 0], undefined), raised = up.position[1] - start[1];
    if (raised < 0.01) return null;
    const wanted = Math.hypot(delta[0], delta[2]), dx = delta[0] / wanted, dz = delta[2] / wanted;
    const forward = this.slide(up.position, [dx * this.radius, 0, dz * this.radius], 0.999);
    const along = (forward.position[0] - start[0]) * dx + (forward.position[2] - start[2]) * dz;
    // The whole radius: only then is the lowest point of the round bottom past the edge, and an edge that is a
    // little too high has stopped the bottom's curve before that.
    if (along < 0.95 * this.radius) return null;
    const landing = this.probe(forward.position, raised + 4 * SLOP, true);
    if (!landing) return null;
    const height = forward.position[1] - landing.gap;
    // Stepping onto something that is not higher than where it started is walking, not a step.
    if (height < start[1] + 0.01) return null;
    return this.slide([start[0], height, start[2]], [delta[0], 0, delta[2]], 0.999);
  }

  // Walkable ground within `reach` below the capsule at `position`: how far down it is, and what it is.
  // With `strict`, only what the capsule itself comes to rest on counts (a step must land on walkable ground).
  private probe(position: readonly [number, number, number], reach: number, strict = false): {gap: number; ground: Ground} | null {
    const lifted: [number, number, number] = [position[0], position[1] + PROBE_LIFT, position[2]], travel = reach + PROBE_LIFT + SLOP;
    const filter = {ignoreBody: this.ignoreBody, categoryBits: this.categoryBits, maskBits: this.maskBits};
    const rayLength = this.halfLength + this.radius + travel;
    const [capsule, ray] = this.world.native.queryBatch([
      {kind: 'capsule-cast', origin: lifted, radius: this.radius, halfLength: this.halfLength, translation: [0, -travel, 0], limit: 8, filter},
      {kind: 'ray', origin: lifted, translation: [0, -rayLength, 0], limit: 8, filter},
    ]);
    const solid = (hit: NativeQueryCastHit) => hit.fraction > 0 && (hit.normal[0] !== 0 || hit.normal[1] !== 0 || hit.normal[2] !== 0);
    const first = (capsule.hits as readonly NativeQueryCastHit[]).find(solid);
    if (!first) return null;
    // The cast reports a rounded shape one slop inside; the resting state is one slop inside too.
    const gap = first.fraction * travel - PROBE_LIFT;
    if (gap > reach) return null;
    if (first.normal[1] >= this.minGroundY) return {gap, ground: {normal: toVec3(first.normal), point: toVec3(first.point), body: first.body}};
    if (strict) return null;
    // The capsule's round bottom touches something steep first: the foot of a steep slope, a wall it leans on, or
    // the edge of the ledge it is walking off. It still stands if the ground straight below its centre is walkable
    // and within reach. While walking that reach is the snap distance, so the character crosses the edge of a stair
    // level and then drops onto the next tread; in the air it is 2 cm, so a capsule hanging on an edge slides off.
    const below = (ray.hits as readonly NativeQueryCastHit[]).find(solid);
    if (!below || below.normal[1] < this.minGroundY) return null;
    const rayGap = below.fraction * rayLength - PROBE_LIFT - this.halfLength - this.radius;
    if (rayGap > Math.max(reach, 4 * SLOP)) return null;
    return {gap: Math.max(0, Math.min(gap, rayGap)), ground: {normal: toVec3(below.normal), point: toVec3(below.point), body: below.body}};
  }

  // Velocity of a body's material at a world point: v + w x r. Static bodies report zero.
  private velocityAt(body: Body, point: readonly [number, number, number]): [number, number, number] {
    const s = this.world.getState(body);
    if (s.type === 'static') return [0, 0, 0];
    const r = [point[0] - s.position[0], point[1] - s.position[1], point[2] - s.position[2]], v = s.linearVelocity, w = s.angularVelocity;
    return [v[0] + w[1] * r[2] - w[2] * r[1], v[1] + w[2] * r[0] - w[0] * r[2], v[2] + w[0] * r[1] - w[1] * r[0]];
  }

  // Push the dynamic bodies the move ran into: the impulse that would bring the body's contact point up to the
  // character's speed along the contact normal, limited by maxPushForce * dt.
  private push(planes: readonly MoverPlane[], start: readonly [number, number, number], dt: number): void {
    if (this.maxPushForce === 0) return;
    const v = [(this.pos[0] - start[0]) / dt, (this.pos[1] - start[1]) / dt, (this.pos[2] - start[2]) / dt];
    for (const plane of planes) {
      if (plane.bodyType !== 'dynamic' || plane.push <= 0 || this.pushedBodies.some(body => body.token === plane.body.token)) continue;
      // Standing on a body is not pushing it: its weight is not the character's business here.
      if (plane.normal[1] > 0.7) continue;
      if (!this.world.isAlive(plane.body)) continue;
      const n = [-plane.normal[0], -plane.normal[1], -plane.normal[2]];
      const bodyVelocity = this.velocityAt(plane.body, plane.point), mass = this.world.getState(plane.body).mass;
      // The character wanted to move into the body; `v` is what the mover allowed, so use the wanted approach speed.
      const approach = Math.max(0, (this.wanted[0] - bodyVelocity[0]) * n[0] + (this.wanted[1] - bodyVelocity[1]) * n[1] + (this.wanted[2] - bodyVelocity[2]) * n[2], (v[0] - bodyVelocity[0]) * n[0] + (v[1] - bodyVelocity[1]) * n[1] + (v[2] - bodyVelocity[2]) * n[2]);
      const impulse = Math.min(mass * approach, this.maxPushForce * dt);
      if (!(impulse > 0)) continue;
      this.world.applyImpulseAt(plane.body, [n[0] * impulse, n[1] * impulse, n[2] * impulse], plane.point);
      this.pushedBodies.push(plane.body);
    }
  }

  /** The character's own state, for a checkpoint. The ground body is saved as its render row. */
  saveState(): StateObject { return captureFields(this, this.fieldOptions()); }
  /** Put back a state from saveState(), in a world that holds the same bodies. */
  restoreState(state: StateValue): void { restoreFields(this, state, this.fieldOptions()); }
  private fieldOptions() {
    const world = this.world;
    const row = (body: Body) => { const index = world.native.bodyIndex(body); return index === null ? -1 : index; };
    const groundHandler: FieldHandler = {
      capture: value => { const g = value as Ground | null; return g ? {normal: [...g.normal], point: [...g.point], row: row(g.body)} : null; },
      restore: (_value, state, owner, key) => {
        const saved = state as {normal: number[]; point: number[]; row: number} | null;
        owner[key] = saved && saved.row >= 0 && saved.row < world.native.bodyCount() ? {normal: [...saved.normal], point: [...saved.point], body: world.native.bodyHandle(saved.row)} : null;
      },
    };
    const bodiesHandler: FieldHandler = {
      capture: value => (value as Body[]).map(row),
      restore: (_value, state, owner, key) => { owner[key] = (state as number[]).filter(index => index >= 0 && index < world.native.bodyCount()).map(index => world.native.bodyHandle(index)); },
    };
    return {label: 'CapsuleCharacterController', skip: ['world', 'radius', 'halfLength', 'stepHeight', 'snapDistance', 'gravity', 'maxPushForce', 'maxSlopeDegrees', 'minGroundY',
      'ignoreBody', 'categoryBits', 'maskBits'], nested: {ground: groundHandler, pushedBodies: bodiesHandler}};
  }
}
