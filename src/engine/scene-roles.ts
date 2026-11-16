/**
 * Scene roles: what makes a scene of bodies and joints playable.
 *
 * A scene file can mark a body or a joint with `userData.role`. The scene format carries userData and never
 * reads it; this module does. Given a loaded scene it attaches
 *
 * - `role: 'character'` on a kinematic capsule body: a CapsuleCharacterController that walks it (the body is only
 *   what is drawn: it is moved to where the controller is, every step); `route` is a list of [x, z] to walk when
 *   nobody steers ([x, z, 1] jumps there);
 * - `role: 'platform'` on a kinematic body: a sinusoidal travel `amplitude` along `axis` with `period`;
 * - `role: 'vehicle'` on a chassis body, with `role: 'wheel'` on its wheel joints: a Vehicle over them; `autopilot`
 *   gives the pedals when nobody drives ({throttle, steer, brake, speed}: the throttle is let go above `speed`);
 * - `role: 'laser'` on a body: a fan of rays cast in one batched call per step.
 *
 * `update(input)` is called once before every fixed step of the world. With an input the character and the
 * vehicle do what it says; without one they follow what their userData gives them (a walking route, constant
 * pedals), so a scene plays by itself and plays the same way every time.
 *
 * The roles' own state (the controller, the route progress, the clock) is saved and restored with saveState() /
 * restoreState(); the bodies and joints are in the world's checkpoint.
 *
 * Used by the Physics Lab (src/lab/rigid-play.ts) and published by the kit as `box3d-webgpu-kit/gameplay`.
 */
import {EngineError} from './contracts.ts';
import {CapsuleCharacterController, type CapsuleCharacterState, type CharacterHost} from './character-controller.ts';
import {Vehicle, type VehicleHost, type VehicleState} from './vehicle.ts';
import type {NativeBodyHandle, NativeJointHandle, NativeQueryFilter, NativeRayBatch} from './native-world.ts';
import type {StateObject, StateValue} from './checkpoint.ts';
import type {Subsystem} from './simulation.ts';

type Body = NativeBodyHandle;
type Joint = NativeJointHandle;
type V3 = [number, number, number];

/** What the roles need from a world: the kit's PhysicsWorld and the Lab's scene host both have it. */
export interface SceneRolesHost extends VehicleHost {
  readonly native: CharacterHost['native'] & {castRayBatch(rays: ArrayLike<number>, filter?: NativeQueryFilter): NativeRayBatch};
  isAlive(body: Body): boolean;
  applyImpulseAt(body: Body, impulse: readonly [number, number, number], point: readonly [number, number, number]): void;
  gravity(): [number, number, number];
  moveKinematic(body: Body, position: readonly [number, number, number], rotation?: readonly [number, number, number, number], seconds?: number): void;
}

/** The part of a loaded scene the roles read. */
export interface SceneRolesSource {
  readonly scene: {readonly bodies: readonly {readonly id: string; readonly userData?: {readonly [key: string]: unknown}}[];
    readonly joints?: readonly {readonly id: string; readonly bodyA: string | null; readonly bodyB: string | null; readonly userData?: {readonly [key: string]: unknown}}[]};
  readonly bodies: ReadonlyMap<string, Body>;
  readonly joints: ReadonlyMap<string, Joint>;
}

/** What a player asks for in one step. Every field is optional; absent ones are zero. */
export interface SceneRolesInput {
  /** Character: walking direction in the ground plane, world x and z, each in [-1, 1] (scaled by the character's speed). */
  readonly move?: readonly [number, number];
  /** Character: jump, if it stands on something. */
  readonly jump?: boolean;
  /** Vehicle: pedal in [-1, 1] (negative reverses), steering in [-1, 1] (positive turns left), brake in [0, 1]. */
  readonly throttle?: number;
  readonly steer?: number;
  readonly brake?: number;
}

/** One laser role's beam this step: where it starts and ends, and the body it hit. */
export interface SceneLaserBeam {
  readonly from: V3;
  readonly to: V3;
  /** The body the ray hit, or null when it ran its whole range. */
  readonly body: Body | null;
}

/** The playable roles after a step: time played, the character and its laps, the vehicle, how many platforms move, and the lasers' rays and hits. */
export interface SceneRolesState {
  readonly time: number;
  readonly character: (CapsuleCharacterState & {readonly waypoint: number; readonly laps: number}) | null;
  readonly vehicle: VehicleState | null;
  readonly platforms: number;
  readonly lasers: {readonly rays: number; readonly hits: number}[];
}

const ROLES = ['character', 'platform', 'vehicle', 'wheel', 'laser'] as const;
const fail = (message: string): never => { throw new EngineError('INVALID_PAYLOAD', message); };
const number = (value: unknown, name: string, fallback: number | undefined, low: number, high: number): number => {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) return fail(`${name} must be a number in [${low}, ${high}].`);
  return value;
};
const vec3 = (value: unknown, name: string, fallback?: V3): V3 => {
  if (value === undefined && fallback) return fallback;
  if (!Array.isArray(value) || value.length !== 3 || !value.every(v => typeof v === 'number' && Number.isFinite(v))) return fail(`${name} must be three finite numbers.`);
  return [value[0], value[1], value[2]];
};
const clamp = (value: number | undefined, low: number, high: number): number => Math.min(high, Math.max(low, Number.isFinite(value) ? value as number : 0));

interface CharacterRole { readonly body: Body; readonly controller: CapsuleCharacterController; readonly speed: number; readonly jump: number;
  readonly route: readonly {readonly x: number; readonly z: number; readonly jump: boolean}[]; waypoint: number; since: number; laps: number }
interface PlatformRole { readonly body: Body; readonly origin: V3; readonly rotation: [number, number, number, number]; readonly axis: V3; readonly amplitude: number; readonly period: number }
interface VehicleRole { readonly vehicle: Vehicle; readonly autopilot: {readonly throttle: number; readonly steer: number; readonly brake: number; readonly speed: number} }
interface LaserRole { readonly body: Body; readonly origin: V3; readonly rays: number; readonly range: number; readonly spin: number; readonly pitch: readonly number[];
  readonly input: Float32Array; beams: SceneLaserBeam[]; hits: number }

/** True when a scene has a body or a joint with one of the roles this module plays. */
export function sceneHasRoles(scene: SceneRolesSource['scene']): boolean {
  const has = (item: {readonly userData?: {readonly [key: string]: unknown}}) => typeof item.userData?.role === 'string' && (ROLES as readonly string[]).includes(item.userData.role);
  return scene.bodies.some(has) || (scene.joints ?? []).some(has);
}

/** Makes a loaded scene playable from the roles in its bodies' and joints' `userData.role`: a character, moving platforms, a vehicle, lasers. */
export class SceneRoles {
  private readonly world: SceneRolesHost;
  private readonly characterRole: CharacterRole | null = null;
  private readonly platformRoles: PlatformRole[] = [];
  private readonly vehicleRole: VehicleRole | null = null;
  private readonly laserRoles: LaserRole[] = [];
  /** Fixed steps played. */
  private tick = 0;

  /**
   * Attach the roles of a loaded scene (`loadScene` of the kit, or the Lab's loader). A role whose settings are not
   * usable throws INVALID_PAYLOAD naming the body or joint; nothing in the world has been changed by then.
   */
  constructor(world: SceneRolesHost, loaded: SceneRolesSource) {
    this.world = world;
    const body = (id: string): Body => loaded.bodies.get(id) ?? fail(`Scene roles: body '${id}' is not in the loaded scene.`);
    for (const item of loaded.scene.bodies) {
      const data = item.userData, role = data?.role, at = `body '${item.id}' userData`;
      if (!data || typeof role !== 'string') continue;
      if (role === 'character') {
        if (this.characterRole) fail('Scene roles: a scene has at most one character.');
        const handle = body(item.id), state = world.getState(handle);
        if (state.type !== 'kinematic') fail(`Scene roles: ${at}: a character body must be kinematic.`);
        const route = data.route === undefined ? [] : Array.isArray(data.route) && data.route.length <= 256 ? data.route.map((p, i) => {
          if (!Array.isArray(p) || p.length < 2 || p.length > 3 || !p.every(v => typeof v === 'number' && Number.isFinite(v))) return fail(`Scene roles: ${at}.route[${i}] must be [x, z] or [x, z, 1] (jump there).`);
          return {x: p[0] as number, z: p[1] as number, jump: p[2] === 1};
        }) : fail(`Scene roles: ${at}.route must be a list of at most 256 points.`);
        const controller = new CapsuleCharacterController(world, {
          position: state.position, radius: number(data.radius, `${at}.radius`, 0.3, 0.05, 5), height: number(data.height, `${at}.height`, 1.8, 0.11, 20),
          maxSlopeDegrees: number(data.maxSlopeDegrees, `${at}.maxSlopeDegrees`, 50, 0, 89), stepHeight: number(data.stepHeight, `${at}.stepHeight`, 0.35, 0, 5),
          maxPushForce: number(data.maxPushForce, `${at}.maxPushForce`, 800, 0, 1e7), ignoreBody: handle,
        });
        this.characterRole = {body: handle, controller, speed: number(data.speed, `${at}.speed`, 2.5, 0, 100), jump: number(data.jump, `${at}.jump`, 5, 0, 100), route, waypoint: 0, since: 0, laps: 0};
      } else if (role === 'platform') {
        const handle = body(item.id), state = world.getState(handle);
        if (state.type !== 'kinematic') fail(`Scene roles: ${at}: a platform body must be kinematic.`);
        const axis = vec3(data.axis, `${at}.axis`, [1, 0, 0]), length = Math.hypot(...axis);
        if (!(length > 1e-6)) fail(`Scene roles: ${at}.axis must not be zero.`);
        this.platformRoles.push({body: handle, origin: [...state.position], rotation: [...state.rotation], axis: [axis[0] / length, axis[1] / length, axis[2] / length],
          amplitude: number(data.amplitude, `${at}.amplitude`, 1, 0, 1000), period: number(data.period, `${at}.period`, 4, 0.05, 3600)});
      } else if (role === 'vehicle') {
        if (this.vehicleRole) fail('Scene roles: a scene has at most one vehicle.');
        const wheels = (loaded.scene.joints ?? []).filter(joint => joint.userData?.role === 'wheel' && joint.bodyA === item.id).map(joint => {
          const w = joint.userData!, wat = `joint '${joint.id}' userData`;
          if (joint.bodyB === null) return fail(`Scene roles: ${wat}: a wheel joint needs a wheel body.`);
          return {body: body(joint.bodyB), joint: loaded.joints.get(joint.id) ?? fail(`Scene roles: joint '${joint.id}' is not in the loaded scene.`),
            position: vec3(w.position, `${wat}.position`), radius: number(w.radius, `${wat}.radius`, undefined, 0.01, 100),
            ...(typeof w.steered === 'boolean' ? {steered: w.steered} : {}), ...(typeof w.driven === 'boolean' ? {driven: w.driven} : {}), ...(typeof w.braked === 'boolean' ? {braked: w.braked} : {})};
        });
        if (wheels.length < 2) fail(`Scene roles: ${at}: a vehicle needs at least two joints from this body with userData.role 'wheel'.`);
        const auto = (data.autopilot ?? {}) as {readonly [key: string]: unknown};
        const vehicle = Vehicle.adopt(world, {chassis: body(item.id), wheels,
          maxSteerAngle: number(data.maxSteerAngle, `${at}.maxSteerAngle`, 0.6, 0.01, 1.39), maxDriveTorque: number(data.maxDriveTorque, `${at}.maxDriveTorque`, 400, 0, 1e7),
          maxWheelSpeed: number(data.maxWheelSpeed, `${at}.maxWheelSpeed`, 200, 0, 1e4), maxBrakeTorque: number(data.maxBrakeTorque, `${at}.maxBrakeTorque`, 1500, 0, 1e7),
          dragArea: number(data.dragArea, `${at}.dragArea`, 0, 0, 1000), ...(typeof data.stiffness === 'number' ? {stiffness: data.stiffness} : {}), ...(typeof data.damping === 'number' ? {damping: data.damping} : {})});
        this.vehicleRole = {vehicle, autopilot: {throttle: number(auto.throttle, `${at}.autopilot.throttle`, 0, -1, 1), steer: number(auto.steer, `${at}.autopilot.steer`, 0, -1, 1), brake: number(auto.brake, `${at}.autopilot.brake`, 0, 0, 1),
          speed: number(auto.speed, `${at}.autopilot.speed`, Infinity, 0, 1000)}};
      } else if (role === 'laser') {
        const rays = number(data.rays, `${at}.rays`, 64, 1, 4096);
        if (!Number.isInteger(rays)) fail(`Scene roles: ${at}.rays must be a whole number.`);
        const pitch = data.pitch === undefined ? [0] : Array.isArray(data.pitch) && data.pitch.length >= 1 && data.pitch.length <= 16 ? data.pitch.map((p, i) => number(p, `${at}.pitch[${i}]`, undefined, -1.5, 1.5)) : fail(`Scene roles: ${at}.pitch must be 1 to 16 angles.`);
        this.laserRoles.push({body: body(item.id), origin: vec3(data.origin, `${at}.origin`, [...world.getState(body(item.id)).position]), rays, range: number(data.range, `${at}.range`, 20, 0.01, 1e4),
          spin: number(data.spin, `${at}.spin`, 0, -100, 100), pitch, input: new Float32Array(rays * 6), beams: [], hits: 0});
      }
    }
  }

  /** True when the scene had something to play. */
  get active(): boolean { return this.characterRole !== null || this.vehicleRole !== null || this.platformRoles.length > 0 || this.laserRoles.length > 0; }
  /** The character's controller, the vehicle and the visual bodies, for a game that wants more than `update`. */
  get character(): CapsuleCharacterController | null { return this.characterRole?.controller ?? null; }
  get characterBody(): Body | null { return this.characterRole?.body ?? null; }
  get vehicle(): Vehicle | null { return this.vehicleRole?.vehicle ?? null; }
  /** Seconds played. */
  get time(): number { return this.tick * this.world.loop.step; }

  /**
   * Play one fixed step's worth: call it once before each `world.step()`. `input` drives the character and the
   * vehicle; `null` (or nothing) lets them follow their route and their autopilot pedals.
   */
  update(input: SceneRolesInput | null = null): void {
    const dt = this.world.loop.step, t0 = this.tick * dt, t1 = t0 + dt;
    // Platforms first: the character reads the velocity of what it stands on.
    for (const p of this.platformRoles) {
      if (!this.world.isAlive(p.body)) continue;
      const s = p.amplitude * Math.sin(2 * Math.PI * t1 / p.period);
      this.world.moveKinematic(p.body, [p.origin[0] + p.axis[0] * s, p.origin[1] + p.axis[1] * s, p.origin[2] + p.axis[2] * s], p.rotation, dt);
    }
    const c = this.characterRole;
    if (c) {
      let wish: [number, number] = [0, 0], jump = false;
      if (input) {
        wish = [clamp(input.move?.[0], -1, 1), clamp(input.move?.[1], -1, 1)];
        const length = Math.hypot(wish[0], wish[1]);
        if (length > 1) wish = [wish[0] / length, wish[1] / length];
        jump = input.jump === true;
      } else if (c.route.length > 0) {
        const p = c.controller.state.position;
        let target = c.route[c.waypoint]!, dx = target.x - p[0], dz = target.z - p[2], distance = Math.hypot(dx, dz);
        // A waypoint the walker cannot reach (the foot of a slope too steep for it, say) is given up after the time the
        // leg would have taken twice over, plus two seconds.
        const previous = c.route[(c.waypoint + c.route.length - 1) % c.route.length]!;
        const allowance = 2 + 2 * Math.hypot(target.x - previous.x, target.z - previous.z) / Math.max(c.speed, 1e-3);
        if (distance < 0.25 || c.since > allowance) {
          jump = distance < 0.25 && target.jump;
          c.waypoint = (c.waypoint + 1) % c.route.length; c.since = 0;
          if (c.waypoint === 0) c.laps++;
          target = c.route[c.waypoint]!; dx = target.x - p[0]; dz = target.z - p[2]; distance = Math.hypot(dx, dz);
        }
        c.since += dt;
        if (distance > 1e-6) wish = [dx / distance, dz / distance];
      }
      const state = c.controller.move({velocity: [wish[0] * c.speed, 0, wish[1] * c.speed], jump: jump && c.controller.state.grounded ? c.jump : 0}, dt);
      if (this.world.isAlive(c.body)) this.world.moveKinematic(c.body, state.position, [0, 0, 0, 1], dt);
    }
    const v = this.vehicleRole;
    if (v) {
      // Left alone: the autopilot's pedals, with the throttle let go above its cruising speed.
      v.vehicle.update(input ? {throttle: clamp(input.throttle, -1, 1), steer: clamp(input.steer, -1, 1), brake: clamp(input.brake, 0, 1)}
        : {throttle: v.vehicle.state.forwardSpeed < v.autopilot.speed ? v.autopilot.throttle : 0, steer: v.autopilot.steer, brake: v.autopilot.brake}, dt);
    }
    for (const laser of this.laserRoles) this.castLaser(laser, t0);
    this.tick++;
  }

  private castLaser(laser: LaserRole, time: number): void {
    const {rays, range, origin, input, pitch} = laser;
    for (let i = 0; i < rays; i++) {
      const angle = laser.spin * time + 2 * Math.PI * i / rays, tilt = pitch[i % pitch.length]!, flat = Math.cos(tilt) * range, k = i * 6;
      input[k] = origin[0]; input[k + 1] = origin[1]; input[k + 2] = origin[2];
      input[k + 3] = flat * Math.cos(angle); input[k + 4] = Math.sin(tilt) * range; input[k + 5] = flat * Math.sin(angle);
    }
    const batch = this.world.native.castRayBatch(input, {ignoreBody: laser.body});
    const beams: SceneLaserBeam[] = new Array(rays);
    for (let i = 0; i < rays; i++) {
      const k = i * 6, f = batch.fractions[i]!, hit = f >= 0;
      beams[i] = {from: [origin[0], origin[1], origin[2]], body: hit ? batch.bodies[i] ?? null : null,
        to: hit ? [batch.points[i * 3]!, batch.points[i * 3 + 1]!, batch.points[i * 3 + 2]!] : [origin[0] + input[k + 3]!, origin[1] + input[k + 4]!, origin[2] + input[k + 5]!]};
    }
    laser.beams = beams; laser.hits = batch.hitCount;
  }

  /** The beams of every laser as of the last update: from the emitter to the hit point, or to the end of the range. */
  beams(): readonly SceneLaserBeam[] { return this.laserRoles.length === 1 ? this.laserRoles[0]!.beams : this.laserRoles.flatMap(laser => laser.beams); }

  get state(): SceneRolesState {
    const c = this.characterRole;
    return {time: this.time, character: c ? {...c.controller.state, waypoint: c.waypoint, laps: c.laps} : null, vehicle: this.vehicleRole?.vehicle.state ?? null,
      platforms: this.platformRoles.length, lasers: this.laserRoles.map(laser => ({rays: laser.rays, hits: laser.hits}))};
  }

  /** The roles' own state: the clock, the character's controller and route progress, the vehicle's last controls. Take it together with the world's checkpoint. */
  saveState(): StateObject {
    const c = this.characterRole;
    return {tick: this.tick, character: c ? {controller: c.controller.saveState(), waypoint: c.waypoint, since: c.since, laps: c.laps} : null, vehicle: this.vehicleRole?.vehicle.saveState() ?? null};
  }
  /** Put back a state from saveState(), on the same scene, after the world's checkpoint was restored. */
  restoreState(state: StateValue): void {
    const s = state as {tick?: unknown; character?: {controller: StateValue; waypoint: number; since: number; laps: number} | null; vehicle?: StateValue | null} | null;
    const c = this.characterRole, v = this.vehicleRole;
    if (!s || typeof s.tick !== 'number' || !Number.isSafeInteger(s.tick) || s.tick < 0 || (c === null) !== (s.character == null) || (v === null) !== (s.vehicle == null)) fail('Scene roles: the state does not belong to this scene.');
    if (c && s!.character) {
      const saved = s!.character;
      if (!Number.isInteger(saved.waypoint) || saved.waypoint < 0 || saved.waypoint >= Math.max(1, c.route.length) || !Number.isFinite(saved.since) || !Number.isInteger(saved.laps)) fail('Scene roles: the character state is malformed.');
      c.controller.restoreState(saved.controller); c.waypoint = saved.waypoint; c.since = saved.since; c.laps = saved.laps;
    }
    if (v && s!.vehicle != null) v.vehicle.restoreState(s!.vehicle);
    this.tick = s!.tick as number;
    for (const laser of this.laserRoles) { laser.beams = []; laser.hits = 0; }
  }
}

/**
 * The roles as a Simulation subsystem (simulation.ts): they act in the pre-couple stage of every step, before any
 * coupling and before the rigid step, and their state is part of `simulation.checkpoint()`. `input` is asked once per
 * step; `null` lets the scene play itself.
 */
export function sceneRolesSubsystem<W, B>(roles: SceneRoles, input?: () => SceneRolesInput | null, dt?: number): Subsystem<W, B> {
  return {
    id: 'roles', kind: 'scene-roles', stage: 'pre-couple', order: 0, timeStep: dt === undefined ? null : {dt, rule: 'equal'},
    step() { roles.update(input ? input() : null); },
    checkpoint() { return roles.saveState(); },
    restore(state) { roles.restoreState(state); },
    diagnostics() { return roles.state; },
  };
}

/**
 * Attach the roles of a loaded scene and register them with its Simulation: from then on `loaded.simulation.step()`
 * plays the scene (and `simulation.checkpoint()` holds the roles' state). Returns the roles; when the scene has none,
 * nothing is registered and `roles.active` is false.
 */
export function attachSceneRoles<W extends SceneRolesHost>(
  loaded: SceneRolesSource & {readonly builder: {readonly world: W}; readonly simulation: {add(subsystem: Subsystem<W, Body>): unknown}},
  options: {readonly input?: () => SceneRolesInput | null} = {},
): SceneRoles {
  const roles = new SceneRoles(loaded.builder.world, loaded);
  if (roles.active) loaded.simulation.add(sceneRolesSubsystem<W, Body>(roles, options.input, loaded.builder.world.loop.step));
  return roles;
}
