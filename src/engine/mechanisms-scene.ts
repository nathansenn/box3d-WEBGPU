/**
 * "Mechanisms": an SI demo scene for the Physics Lab built with the general
 * rigid-body API (resetWorld, createBody, createJoint). Metres, kilograms,
 * seconds, radians; gravity 9.81 m/s^2 down; the ground top is y = 0.
 *
 * It is not one of the 800 catalogue recipes. Those are generated as 16 families
 * of 50 with fixed native stage IDs 0-799 and fixed counts
 * (docs/CATALOG_COUNTS.json), so this scene is a separate entry point.
 *
 * Contents, back to front:
 *   - a pendulum wave: sphere bobs welded to thin capsule rods on revolute joints;
 *   - two hanging capsule chains on spherical joints with different cone limits;
 *   - a paddle on a motor-driven revolute joint stirring loose spheres, capsules and boxes;
 *   - a four-wheel car on wheel joints (suspension spring, spin motor) driving over planks.
 *
 * The scene is a pure function of the seed: the same seed gives the same bodies,
 * joints and trajectories.
 */
import type { NativeBodyHandle, NativeJointHandle, NativeQuaternion, NativeQueryVector, NativeWorldBackend } from './native-world.ts';

export const MECHANISMS_SCENE_ID = 'mechanisms';
export const MECHANISMS_SCENE_TITLE = 'Mechanisms (SI demo)';
export const MECHANISMS_DEFAULT_SEED = 0x51de3;

export type MechanismsWorld = Pick<NativeWorldBackend, 'resetWorld' | 'createBody' | 'createJoint'>;

export interface MechanismsPendulum {
  readonly rod: NativeBodyHandle;
  readonly bob: NativeBodyHandle;
  readonly hinge: NativeJointHandle;
  readonly pivot: NativeQueryVector;
  /** Pivot to bob centre, in metres. */
  readonly length: number;
}
export interface MechanismsChain {
  readonly links: readonly NativeBodyHandle[];
  readonly joints: readonly NativeJointHandle[];
  /** Cone limit half-angle of every joint, in radians. */
  readonly coneAngle: number;
  readonly anchor: NativeQueryVector;
}
export interface MechanismsScene {
  readonly seed: number;
  readonly bodyCount: number;
  readonly jointCount: number;
  readonly pendulums: readonly MechanismsPendulum[];
  readonly chains: readonly MechanismsChain[];
  readonly mixer: { readonly paddle: NativeBodyHandle; readonly hinge: NativeJointHandle; readonly speed: number; readonly loose: readonly NativeBodyHandle[] };
  readonly car: {
    readonly chassis: NativeBodyHandle;
    readonly wheels: readonly NativeBodyHandle[];
    readonly joints: readonly NativeJointHandle[];
    readonly planks: readonly NativeBodyHandle[];
    /** World x of each plank and of the end stop the car drives towards. */
    readonly plankX: readonly number[];
    readonly stopX: number;
  };
  readonly camera: { readonly yaw: number; readonly pitch: number; readonly distance: number; readonly target: readonly [number, number, number] };
}

// Renderer material tags travel in the top byte of the colour (wasm/box3d_web.c b3w_material_color).
const STEEL = 0x02000000;
const CONCRETE = 0x01000000;
const GLASS = 0x04000000;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function axisAngle(x: number, y: number, z: number, angle: number): NativeQuaternion {
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}
function multiply(a: NativeQuaternion, b: NativeQuaternion): NativeQuaternion {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

// Joint frames: hinges turn about the frame's z axis; a spherical joint's cone is about z too.
const Z_TO_X = axisAngle(0, 1, 0, Math.PI / 2);
const Z_TO_Y = axisAngle(1, 0, 0, -Math.PI / 2);
// Wheel joints: suspension travel along frame A's x axis, spin about frame B's z axis.
const X_TO_Y = axisAngle(0, 0, 1, Math.PI / 2);

export function buildMechanismsScene(world: MechanismsWorld, seed: number = MECHANISMS_DEFAULT_SEED): MechanismsScene {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError('The Mechanisms seed must be a 32-bit unsigned integer.');
  const random = mulberry32(seed);
  const jitter = (amount: number): number => (random() * 2 - 1) * amount;
  world.resetWorld({ seed, ground: true, gravity: [0, -9.81, 0] });
  let bodyCount = 1; // the ground slab
  let jointCount = 0;
  const body = (descriptor: Parameters<MechanismsWorld['createBody']>[0]): NativeBodyHandle => {
    const handle = world.createBody(descriptor);
    if (!handle) throw new Error('The Mechanisms scene does not fit in this world.');
    bodyCount++;
    return handle;
  };
  const joint = (descriptor: Parameters<MechanismsWorld['createJoint']>[0]): NativeJointHandle => {
    jointCount++;
    return world.createJoint(descriptor);
  };
  const fixed = (halfExtents: NativeQueryVector, position: NativeQueryVector, color: number): NativeBodyHandle =>
    body({ shape: { kind: 'box', halfExtents }, type: 'static', position, color, friction: 0.8 });

  // --- Pendulum wave -------------------------------------------------------
  const pendulums: MechanismsPendulum[] = [];
  const pendulumCount = 7, pendulumZ = -3, pivotY = 5.4, firstX = -7.4, spacing = 0.95;
  const beamCentre = firstX + ((pendulumCount - 1) * spacing) / 2;
  const beamHalf = ((pendulumCount - 1) * spacing) / 2 + 0.6;
  // Rods and chains hang from their beam body, not from the world: jointed bodies do not collide,
  // so a rod's round end can sit inside the beam without rubbing on it.
  const beamY = pivotY + 0.09;
  const beam = fixed([beamHalf, 0.09, 0.09], [beamCentre, beamY, pendulumZ], STEEL | 0x9aa4b0);
  for (const side of [-1, 1]) fixed([0.11, (pivotY + 0.18) / 2, 0.11], [beamCentre + side * beamHalf, (pivotY + 0.18) / 2, pendulumZ], STEEL | 0x7d8794);
  const release = 0.62 + jitter(0.08);
  for (let i = 0; i < pendulumCount; i++) {
    const length = 2.4 + i * 0.26, x = firstX + i * spacing;
    const pivot: NativeQueryVector = [x, pivotY, pendulumZ];
    // The rod's local +Y end is the pivot; it swings in the y-z plane about world x.
    const rotation = axisAngle(1, 0, 0, -release);
    const dy = -Math.cos(release), dz = Math.sin(release);
    const rod = body({
      shape: { kind: 'capsule', radius: 0.045, halfLength: length / 2 }, rotation,
      position: [x, pivotY + dy * (length / 2), pendulumZ + dz * (length / 2)], density: 900, color: STEEL | 0xc9ced6,
    });
    const bob = body({
      shape: { kind: 'sphere', radius: 0.34 }, rotation,
      position: [x, pivotY + dy * length, pendulumZ + dz * length], density: 2600,
      color: [0xe4572e, 0xf0a202, 0xf3d34a, 0x76b041, 0x17bebb, 0x3d6fd9, 0x9b5de5][i]!,
    });
    const hinge = joint({ type: 'revolute', bodyA: beam, bodyB: rod, frameA: { position: [x - beamCentre, pivotY - beamY, 0], rotation: Z_TO_X }, frameB: { position: [0, length / 2, 0], rotation: Z_TO_X } });
    joint({ type: 'weld', bodyA: rod, bodyB: bob, frameA: { position: [0, -length / 2, 0] } });
    pendulums.push({ rod, bob, hinge, pivot, length });
  }

  // --- Capsule chains on spherical joints with cone limits -----------------
  const chains: MechanismsChain[] = [];
  const chainZ = -3, gantryY = 7;
  const gantry = fixed([2.7, 0.1, 0.1], [5.4, gantryY + 0.1, chainZ], STEEL | 0x9aa4b0);
  for (const side of [-1, 1]) fixed([0.12, (gantryY + 0.2) / 2, 0.12], [5.4 + side * 2.7, (gantryY + 0.2) / 2, chainZ], STEEL | 0x7d8794);
  const chainSpecs = [
    { x: 3.9, coneAngle: 0.3, lean: 0.95 + jitter(0.05), color: 0xd1495b },
    { x: 6.3, coneAngle: 0.9, lean: 0.95 + jitter(0.05), color: 0x2e86ab },
  ];
  for (const spec of chainSpecs) {
    const radius = 0.17, halfLength = 0.3, reach = halfLength + radius * 0.6, linkCount = 6;
    const anchor: NativeQueryVector = [spec.x, gantryY, chainZ];
    // The chain starts straight, leaning towards +z, and swings down from there.
    const rotation = axisAngle(1, 0, 0, -spec.lean);
    const dy = -Math.cos(spec.lean), dz = Math.sin(spec.lean);
    const frame = multiply(rotation, Z_TO_Y);
    const links: NativeBodyHandle[] = [], joints: NativeJointHandle[] = [];
    for (let i = 0; i < linkCount; i++) {
      const centre = reach * (2 * i + 1);
      const link = body({
        shape: { kind: 'capsule', radius, halfLength }, rotation,
        position: [spec.x, gantryY + dy * centre, chainZ + dz * centre], density: 700,
        color: i % 2 === 0 ? spec.color : 0xe8e4d9, angularDamping: 0.05,
      });
      joints.push(joint({
        type: 'spherical', bodyA: i === 0 ? gantry : links[i - 1]!, bodyB: link,
        frameA: i === 0 ? { position: [spec.x - 5.4, -0.1, 0], rotation: frame } : { position: [0, -reach, 0], rotation: Z_TO_Y },
        frameB: { position: [0, reach, 0], rotation: Z_TO_Y },
        coneAngle: spec.coneAngle, limits: { lower: -0.4, upper: 0.4 },
      }));
      links.push(link);
    }
    chains.push({ links, joints, coneAngle: spec.coneAngle, anchor });
  }

  // --- Motor-driven hinge: a paddle stirring a walled pen -------------------
  const penX = 3.6, penZ = 2.2, penHalf = 2.3, wallHeight = 0.35;
  for (const side of [-1, 1]) {
    fixed([penHalf + 0.12, wallHeight, 0.12], [penX, wallHeight, penZ + side * penHalf], CONCRETE | 0xa9a39a);
    fixed([0.12, wallHeight, penHalf - 0.12], [penX + side * penHalf, wallHeight, penZ], CONCRETE | 0xa9a39a);
  }
  // The paddle skims the floor so nothing can wedge under it, and turns on a hub it does not collide with.
  const paddleY = 0.2, paddleSpeed = 1.1;
  const hub = body({ shape: { kind: 'sphere', radius: 0.24 }, type: 'static', position: [penX, paddleY + 0.14, penZ], color: STEEL | 0x7d8794 });
  const paddle = body({ shape: { kind: 'box', halfExtents: [1.35, 0.16, 0.09] }, position: [penX, paddleY, penZ], density: 800, color: 0xf2b134, neverSleeps: true });
  const paddleHinge = joint({
    type: 'revolute', bodyA: hub, bodyB: paddle,
    frameA: { position: [0, -0.14, 0], rotation: Z_TO_Y }, frameB: { rotation: Z_TO_Y },
    motor: { speed: paddleSpeed, maxForce: 2500 },
  });
  const loose: NativeBodyHandle[] = [];
  for (let i = 0; i < 12; i++) {
    const angle = (i / 12) * Math.PI * 2 + jitter(0.12), ring = 1.15 + (i % 3) * 0.32;
    const x = penX + Math.cos(angle) * ring, z = penZ + Math.sin(angle) * ring;
    // Two of the four spheres are glass, which the renderer draws in its blended pass.
    if (i % 3 === 0) loose.push(body({ shape: { kind: 'sphere', radius: 0.21 }, position: [x, 0.9, z], density: 500, restitution: 0.3, color: i % 6 === 3 ? GLASS | 0xbfe8ff : 0xef6f6c }));
    else if (i % 3 === 1) loose.push(body({ shape: { kind: 'capsule', radius: 0.14, halfLength: 0.22 }, position: [x, 0.9, z], rotation: axisAngle(0, 0, 1, Math.PI / 2), density: 500, color: 0x56cbf9 }));
    else loose.push(body({ shape: { kind: 'box', halfExtents: [0.17, 0.17, 0.17] }, position: [x, 0.9, z], density: 500, color: 0x8ac926 }));
  }

  // --- Car on four wheel joints driving over planks -------------------------
  const laneZ = 6.2, startX = -9.5, stopX = 11.5, wheelRadius = 0.38;
  const chassis = body({ shape: { kind: 'box', halfExtents: [1.3, 0.2, 0.55] }, position: [startX, 0.86, laneZ], density: 260, color: 0x2a9d8f, neverSleeps: true });
  const cabin = body({ shape: { kind: 'box', halfExtents: [0.5, 0.2, 0.45] }, position: [startX - 0.2, 1.26, laneZ], density: 60, color: 0xe9f1f7 });
  joint({ type: 'weld', bodyA: chassis, bodyB: cabin, frameA: { position: [-0.2, 0.4, 0] } });
  const wheels: NativeBodyHandle[] = [], wheelJoints: NativeJointHandle[] = [];
  for (const [ox, oz] of [[-0.82, -0.78], [-0.82, 0.78], [0.82, -0.78], [0.82, 0.78]] as const) {
    const wheel = body({ shape: { kind: 'sphere', radius: wheelRadius }, position: [startX + ox, wheelRadius + 0.02, laneZ + oz], density: 320, friction: 1.1, color: 0x22252b });
    wheels.push(wheel);
    wheelJoints.push(joint({
      type: 'wheel', bodyA: chassis, bodyB: wheel,
      frameA: { position: [ox, wheelRadius + 0.02 - 0.86, oz], rotation: X_TO_Y }, frameB: { rotation: X_TO_Y },
      spring: { hertz: 3.5, dampingRatio: 0.7 }, limits: { lower: -0.25, upper: 0.25 },
      // Spin about +z rolls a wheel towards -x, so a negative speed drives the car towards +x.
      motor: { speed: -7.5, maxForce: 420 },
    }));
  }
  const planks: NativeBodyHandle[] = [], plankX: number[] = [];
  for (let i = 0; i < 4; i++) {
    const x = -4.5 + i * 3.1 + jitter(0.35), halfHeight = 0.055 + (i % 2) * 0.03;
    plankX.push(x);
    planks.push(body({ shape: { kind: 'box', halfExtents: [0.22, halfHeight, 1.15] }, position: [x, halfHeight, laneZ], rotation: axisAngle(0, 1, 0, jitter(0.12)), density: 900, friction: 0.9, color: 0xb08968 }));
  }
  fixed([0.3, 0.6, 1.6], [stopX + 0.3, 0.6, laneZ], CONCRETE | 0xa9a39a);

  return {
    seed, bodyCount, jointCount, pendulums, chains,
    mixer: { paddle, hinge: paddleHinge, speed: paddleSpeed, loose },
    car: { chassis, wheels, joints: wheelJoints, planks, plankX, stopX },
    camera: { yaw: 1.25, pitch: 0.27, distance: 15.5, target: [0.4, 2.5, 1.2] },
  };
}
