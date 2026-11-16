/**
 * A wheeled vehicle on Box3D's wheel joints: one chassis body, one sphere body per wheel, and per wheel a joint
 * with a suspension spring along the chassis' up axis, a spin motor about the axle and, for steered wheels,
 * steering about the up axis with Ackermann geometry.
 *
 * Everything is an ordinary body or joint of the world, so the vehicle collides, sleeps, is recorded, replayed and
 * checkpointed like the rest. `update(controls, dt)` once per step turns pedal and steering-wheel positions into
 * motor, brake and steering settings and applies aerodynamic drag.
 *
 * Axes of the chassis frame: +x forward, +y up, +z to the right.
 *
 * Published by the kit as `box3d-webgpu-kit/gameplay`; the Physics Lab uses this file directly.
 */
import {EngineError} from './contracts.ts';
import {captureFields, restoreFields, type StateObject, type StateValue} from './checkpoint.ts';
import type {NativeBodyDescriptor, NativeBodyHandle, NativeBodyMassState, NativeBodyState, NativeJointDescriptor, NativeJointDetails, NativeJointHandle, NativeMassData} from './native-world.ts';

type Body = NativeBodyHandle;
type Joint = NativeJointHandle;
type Vec3 = readonly [number, number, number];
type Quat = readonly [number, number, number, number];
/** A tuple or an {x, y, z} object (a three.js Vector3 works). */
export type VehicleVec3 = Vec3 | {readonly x: number; readonly y: number; readonly z: number};
export type VehicleQuat = Quat | {readonly x: number; readonly y: number; readonly z: number; readonly w: number};
const toVec3 = (value: VehicleVec3): [number, number, number] => {
  if (Array.isArray(value)) return [value[0], value[1], value[2]];
  const v = value as {x: number; y: number; z: number};
  if (v && typeof v.x === 'number') return [v.x, v.y, v.z];
  throw new EngineError('INVALID_PAYLOAD', 'Expected [x, y, z] or {x, y, z}.');
};
const toQuat = (value: VehicleQuat): [number, number, number, number] => {
  if (Array.isArray(value)) return [value[0], value[1], value[2], value[3]];
  const q = value as {x: number; y: number; z: number; w: number};
  if (q && typeof q.x === 'number' && typeof q.w === 'number') return [q.x, q.y, q.z, q.w];
  throw new EngineError('INVALID_PAYLOAD', 'Expected [x, y, z, w] or {x, y, z, w}.');
};

/** What a vehicle needs from a world. The kit's PhysicsWorld has exactly these members; the Physics Lab's scene host has them too. */
export interface VehicleHost {
  readonly loop: {readonly step: number};
  createBody(options: NativeBodyDescriptor): Body | null;
  createJoint(options: NativeJointDescriptor): Joint;
  destroyBody(body: Body): boolean;
  getState(body: Body): NativeBodyState;
  getMassData(body: Body): NativeBodyMassState | {readonly mass: number; readonly center: readonly number[]; readonly inertia: readonly number[]} | null;
  setMassData(body: Body, data: NativeMassData): void;
  applyForce(body: Body, force: Vec3, point?: Vec3): void;
  setJointMotor(joint: Joint, motor: {speed: number; maxForce: number} | null): void;
  setJointSteering(joint: Joint, steering: {angle: number; hertz: number; dampingRatio: number; maxTorque: number} | null): void;
  getJointDetails(joint: Joint): NativeJointDetails;
}

export interface VehicleWheelOptions {
  /** Wheel centre in the chassis frame, with the suspension at its rest length (no load). */
  readonly position: VehicleVec3;
  /** Default: the vehicle's `wheelRadius`. */
  readonly radius?: number;
  /** Turns with the steering wheel. Default: true for wheels in front of the chassis origin. */
  readonly steered?: boolean;
  /** Takes engine torque. Default true. */
  readonly driven?: boolean;
  /** Takes brake torque. Default true. */
  readonly braked?: boolean;
}

export interface VehicleOptions {
  /** Chassis origin (the centre of its box). */
  readonly position: VehicleVec3;
  readonly rotation?: VehicleQuat;
  /** Half extents of the chassis box: [half length, half height, half width]. */
  readonly chassisHalfExtents: VehicleVec3;
  /** Chassis mass in kg (the box's density is set from it). */
  readonly chassisMass: number;
  /** Lowers or moves the chassis' centre of mass, in the chassis frame. Default [0, 0, 0]. */
  readonly centerOfMass?: VehicleVec3;
  readonly wheels: readonly VehicleWheelOptions[];
  /** Default 0.35 m. */
  readonly wheelRadius?: number;
  /** Mass of each wheel in kg. Default 20. */
  readonly wheelMass?: number;
  /** Tyre friction coefficient. Default 1. */
  readonly wheelFriction?: number;
  /**
   * The suspension of each wheel, as a physical spring and damper: `stiffness` in N/m and `damping` in N s/m, or
   * `frequency` (Hz) and `dampingRatio` of the chassis on its springs, from which they follow as
   * k = (M / n) (2 pi f)^2 and c = 2 zeta sqrt(k M / n) for a chassis of mass M on n wheels. `travel` limits the
   * wheel to that distance above and below its rest position (m).
   */
  readonly suspension: ({readonly stiffness: number; readonly damping: number} | {readonly frequency: number; readonly dampingRatio: number}) & {readonly travel?: number};
  /** Largest steering angle of the vehicle's centre line (the bicycle angle), in radians. Default 0.6. */
  readonly maxSteerAngle?: number;
  /** How quickly the steered wheels follow the steering wheel: frequency (Hz) of the steering spring. Default 8. */
  readonly steeringHertz?: number;
  /** Largest drive torque per driven wheel at full throttle (N m). Default 400. */
  readonly maxDriveTorque?: number;
  /** Wheel speed the engine drives towards at full throttle (rad/s). Default 200. */
  readonly maxWheelSpeed?: number;
  /** Largest brake torque per braked wheel at full brake (N m). Default 1500. */
  readonly maxBrakeTorque?: number;
  /** Drag area Cd A in m^2: the chassis feels F = rho Cd A v^2 / 2 against its velocity. Default 0 (no drag). */
  readonly dragArea?: number;
  /** Air density in kg/m^3. Default 1.225. */
  readonly airDensity?: number;
  readonly color?: number;
  readonly wheelColor?: number;
}

export interface VehicleControls {
  /** -1 (full reverse) .. 1 (full forward). */
  readonly throttle?: number;
  /** -1 (full right) .. 1 (full left). */
  readonly steer?: number;
  /** 0 .. 1. */
  readonly brake?: number;
}

export interface VehicleWheelState {
  /** How far the wheel sits above its rest position in the chassis frame (m): positive is a compressed spring. */
  readonly suspension: number;
  /** Spin of the wheel relative to the chassis about its axle (rad/s); positive rolls the vehicle forward. */
  readonly spinSpeed: number;
  /** Steering angle now (rad); positive turns left. */
  readonly steeringAngle: number;
}
export interface VehicleState {
  readonly position: readonly [number, number, number];
  readonly rotation: readonly [number, number, number, number];
  /** Speed along the chassis' forward axis (m/s). */
  readonly forwardSpeed: number;
  readonly speed: number;
  /** Turn rate about the chassis' up axis (rad/s); positive turns left. */
  readonly yawRate: number;
  readonly wheels: readonly VehicleWheelState[];
}

const rotate = (q: readonly number[], v: readonly number[]): [number, number, number] => {
  const [x, y, z, w] = q, t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]];
};
// Turns the joint frame's x axis onto the chassis' up axis (y) and leaves its z axis on the axle (z).
const FRAME: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];

export class Vehicle {
  readonly chassis: Body;
  readonly wheels: readonly Body[];
  readonly joints: readonly Joint[];
  /** Distance between the front-most and rear-most axles (m). */
  readonly wheelbase: number;
  /** Largest distance between the wheels of one axle (m). */
  readonly track: number;
  /** Physical stiffness (N/m) and damping (N s/m) of each wheel's suspension. */
  readonly stiffness: number;
  readonly damping: number;
  readonly maxSteerAngle: number;
  readonly maxDriveTorque: number;
  readonly maxWheelSpeed: number;
  readonly maxBrakeTorque: number;
  readonly dragArea: number;
  readonly airDensity: number;
  private readonly layout: {x: number; z: number; radius: number; steered: boolean; driven: boolean; braked: boolean}[];
  private readonly rearX: number;
  private readonly steeringHertz: number;
  // What was last sent to each joint, so that update() only talks to the world when something changes.
  private sentMotor: number[];
  private sentTorque: number[];
  private sentSteer: number[];
  private throttle = 0;
  private steer = 0;
  private brake = 0;

  constructor(private readonly world: VehicleHost, options: VehicleOptions) {
    const half = toVec3(options.chassisHalfExtents), position = toVec3(options.position), rotation = toQuat(options.rotation ?? [0, 0, 0, 1]);
    const mass = options.chassisMass, wheelMass = options.wheelMass ?? 20, defaultRadius = options.wheelRadius ?? 0.35, n = options.wheels?.length ?? 0;
    this.maxSteerAngle = options.maxSteerAngle ?? 0.6;
    this.steeringHertz = options.steeringHertz ?? 8;
    this.maxDriveTorque = options.maxDriveTorque ?? 400;
    this.maxWheelSpeed = options.maxWheelSpeed ?? 200;
    this.maxBrakeTorque = options.maxBrakeTorque ?? 1500;
    this.dragArea = options.dragArea ?? 0;
    this.airDensity = options.airDensity ?? 1.225;
    const s = options.suspension as {stiffness?: number; damping?: number; frequency?: number; dampingRatio?: number; travel?: number};
    if (!s || n < 2 || n > 16) throw new EngineError('INVALID_PAYLOAD', 'A vehicle needs a suspension and 2 to 16 wheels.');
    this.stiffness = s.stiffness ?? mass / n * (2 * Math.PI * (s.frequency ?? NaN)) ** 2;
    this.damping = s.damping ?? 2 * (s.dampingRatio ?? NaN) * Math.sqrt(this.stiffness * mass / n);
    const travel = s.travel ?? 0.2;
    const numbers = [...half, ...position, mass, wheelMass, defaultRadius, this.stiffness, this.damping, travel, this.maxSteerAngle, this.steeringHertz, this.maxDriveTorque,
      this.maxWheelSpeed, this.maxBrakeTorque, this.dragArea, this.airDensity];
    if (!numbers.every(Number.isFinite) || !(mass > 0) || !(wheelMass > 0) || !(defaultRadius > 0) || !(this.stiffness > 0) || this.damping < 0 || !(travel > 0)
      || !(this.maxSteerAngle > 0 && this.maxSteerAngle < 1.4) || this.dragArea < 0) {
      throw new EngineError('INVALID_PAYLOAD', 'Vehicle: masses, sizes, stiffness and travel must be positive and finite, and maxSteerAngle below 1.4 rad.');
    }
    this.layout = options.wheels.map(wheel => {
      const p = toVec3(wheel.position);
      return {x: p[0], z: p[2], radius: wheel.radius ?? defaultRadius, steered: wheel.steered ?? p[0] > 0, driven: wheel.driven ?? true, braked: wheel.braked ?? true};
    });
    const xs = this.layout.map(w => w.x), zs = this.layout.map(w => w.z);
    this.rearX = Math.min(...xs);
    this.wheelbase = Math.max(...xs) - this.rearX;
    this.track = Math.max(...zs) - Math.min(...zs);

    const volume = 8 * half[0] * half[1] * half[2];
    const chassis = world.createBody({shape: {kind: 'box', halfExtents: half}, position, rotation, density: mass / volume, friction: 0.5, color: options.color ?? 0x3D7DD8, neverSleeps: true});
    if (!chassis) throw new EngineError('WORLD_CAPACITY', 'The world has no room for the vehicle.');
    this.chassis = chassis;
    if (options.centerOfMass) {
      const data = world.getMassData(chassis)!, c = toVec3(options.centerOfMass), i = data.inertia;
      world.setMassData(chassis, {mass: data.mass, center: c, inertia: [i[0]!, i[1]!, i[2]!, i[3]!, i[4]!, i[5]!]});
    }
    const massData = world.getMassData(chassis)!, inverseInertia = invert(massData.inertia), com = massData.center;
    const wheels: Body[] = [], joints: Joint[] = [];
    options.wheels.forEach((wheel, i) => {
      const local = toVec3(wheel.position), radius = this.layout[i].radius, at = rotate(rotation, local);
      const volumeOfSphere = 4 / 3 * Math.PI * radius ** 3;
      const body = world.createBody({shape: {kind: 'sphere', radius}, position: [position[0] + at[0], position[1] + at[1], position[2] + at[2]], rotation,
        density: wheelMass / volumeOfSphere, friction: options.wheelFriction ?? 1, color: options.wheelColor ?? 0x20242C, neverSleeps: true});
      if (!body) throw new EngineError('WORLD_CAPACITY', 'The world has no room for the vehicle.');
      // Box3D's joint springs are stated as a frequency of the joint's own effective mass, not of the chassis. Along
      // the suspension axis `a` at the wheel, that mass is 1 / (1/M + 1/m + (r x a) . I^-1 (r x a)); the frequency
      // and damping ratio below give the physical stiffness and damping asked for.
      const r = [local[0] - com[0], local[1] - com[1], local[2] - com[2]], ra = [-r[2], 0, r[0]];   // r x (0, 1, 0)
      const inertiaTerm = ra[0] * (inverseInertia[0][0] * ra[0] + inverseInertia[0][2] * ra[2]) + ra[2] * (inverseInertia[2][0] * ra[0] + inverseInertia[2][2] * ra[2]);
      const effective = 1 / (1 / massData.mass + 1 / wheelMass + inertiaTerm);
      const hertz = Math.sqrt(this.stiffness / effective) / (2 * Math.PI), dampingRatio = this.damping / (2 * Math.sqrt(this.stiffness * effective));
      const steered = this.layout[i].steered;
      joints.push(world.createJoint({type: 'wheel', bodyA: chassis, bodyB: body, frameA: {position: local, rotation: FRAME}, frameB: {rotation: FRAME},
        spring: {hertz, dampingRatio}, limits: {lower: -travel, upper: travel}, motor: {speed: 0, maxForce: 0},
        // A wheel that does not steer is held straight by the same spring, stiffly.
        steering: {angle: 0, hertz: steered ? this.steeringHertz : 30, dampingRatio: 1, maxTorque: 1e5, limits: steered ? {lower: -1.5, upper: 1.5} : {lower: 0, upper: 0}}}));
      wheels.push(body);
    });
    this.wheels = wheels;
    this.joints = joints;
    this.sentMotor = new Array(n).fill(0);
    this.sentTorque = new Array(n).fill(0);
    this.sentSteer = new Array(n).fill(0);
  }

  /** Steering angles of the wheels for a bicycle angle `delta`: every steered wheel's axle line passes through one turning centre on the rear axle line. */
  ackermann(delta: number): number[] {
    if (Math.abs(delta) < 1e-6) return this.layout.map(() => 0);
    // Turning centre at z = -R to the left for delta > 0 (left is -z).
    const R = this.wheelbase / Math.tan(delta);
    return this.layout.map(wheel => wheel.steered ? Math.atan((wheel.x - this.rearX) / (R + wheel.z)) : 0);
  }

  /** Set pedals and steering wheel for the coming step. Call once per fixed step, before world.step(). */
  update(controls: VehicleControls, dt = this.world.loop.step): void {
    const clamp = (value: number | undefined, low: number) => Math.min(1, Math.max(low, Number.isFinite(value) ? value as number : 0));
    this.throttle = clamp(controls.throttle, -1); this.steer = clamp(controls.steer, -1); this.brake = clamp(controls.brake, 0);
    if (!(dt > 0)) throw new EngineError('INVALID_PAYLOAD', 'dt must be positive.');
    const angles = this.ackermann(this.steer * this.maxSteerAngle);
    this.layout.forEach((wheel, i) => {
      // Forward is a negative spin about the axle (+z): v = omega x r with r up from the contact point.
      const drive = wheel.driven ? this.throttle : 0, brake = wheel.braked ? this.brake : 0;
      const speed = brake > 0 || drive === 0 ? 0 : -Math.sign(drive) * this.maxWheelSpeed;
      const torque = brake > 0 ? brake * this.maxBrakeTorque : Math.abs(drive) * this.maxDriveTorque;
      if (speed !== this.sentMotor[i] || torque !== this.sentTorque[i]) {
        this.world.setJointMotor(this.joints[i], {speed, maxForce: torque});
        this.sentMotor[i] = speed; this.sentTorque[i] = torque;
      }
      if (wheel.steered && angles[i] !== this.sentSteer[i]) {
        this.world.setJointSteering(this.joints[i], {angle: angles[i], hertz: this.steeringHertz, dampingRatio: 1, maxTorque: 1e5});
        this.sentSteer[i] = angles[i];
      }
    });
    if (this.dragArea > 0) {
      const v = this.world.getState(this.chassis).linearVelocity, speed = Math.hypot(v[0], v[1], v[2]);
      if (speed > 1e-6) { const k = -0.5 * this.airDensity * this.dragArea * speed; this.world.applyForce(this.chassis, [k * v[0], k * v[1], k * v[2]]); }
    }
  }

  get state(): VehicleState {
    const s = this.world.getState(this.chassis), forward = rotate(s.rotation, [1, 0, 0]), up = rotate(s.rotation, [0, 1, 0]), v = s.linearVelocity, w = s.angularVelocity;
    return {position: s.position, rotation: s.rotation, forwardSpeed: v[0] * forward[0] + v[1] * forward[1] + v[2] * forward[2], speed: Math.hypot(v[0], v[1], v[2]),
      yawRate: w[0] * up[0] + w[1] * up[1] + w[2] * up[2],
      wheels: this.joints.map(joint => { const d = this.world.getJointDetails(joint); return {suspension: d.suspension ?? 0, spinSpeed: -(d.spinSpeed ?? 0), steeringAngle: d.steeringAngle ?? 0}; })};
  }

  /** Remove the vehicle's bodies (and with them its joints) from the world. */
  destroy(): void {
    for (const wheel of this.wheels) this.world.destroyBody(wheel);
    this.world.destroyBody(this.chassis);
  }

  /** The vehicle's own state (the last controls and what was sent to the joints). Its bodies and joints are in the world's checkpoint. */
  saveState(): StateObject { return captureFields(this, FIELDS); }
  restoreState(state: StateValue): void { restoreFields(this, state, FIELDS); }
}

const FIELDS = {label: 'Vehicle', skip: ['world', 'chassis', 'wheels', 'joints', 'wheelbase', 'track', 'stiffness', 'damping', 'maxSteerAngle', 'maxDriveTorque', 'maxWheelSpeed',
  'maxBrakeTorque', 'dragArea', 'airDensity', 'layout', 'rearX', 'steeringHertz']};

// Inverse of a symmetric 3 x 3 tensor given as [xx, yy, zz, xy, xz, yz].
function invert([xx, yy, zz, xy, xz, yz]: readonly number[]): number[][] {
  const det = xx * (yy * zz - yz * yz) - xy * (xy * zz - yz * xz) + xz * (xy * yz - yy * xz);
  return [
    [(yy * zz - yz * yz) / det, (xz * yz - xy * zz) / det, (xy * yz - xz * yy) / det],
    [(xz * yz - xy * zz) / det, (xx * zz - xz * xz) / det, (xy * xz - xx * yz) / det],
    [(xy * yz - xz * yy) / det, (xy * xz - xx * yz) / det, (xx * yy - xy * xy) / det],
  ];
}
