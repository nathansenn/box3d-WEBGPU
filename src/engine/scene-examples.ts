/**
 * Ready-made scenes in the box3d-scene format. Each function returns a new
 * plain-JSON scene; pass it to loadScene, encodeSceneLink or JSON.stringify.
 */
import type {Scene, SceneBody, SceneJoint} from './scene-format.ts';

const G = 9.81;
const round = (value: number, digits = 6): number => { const v = Number(value.toFixed(digits)); return v === 0 ? 0 : v; };
const header = {format: 'box3d-scene', version: 1, units: 'SI'} as const;

/**
 * A pendulum wave: `count` spheres on revolute joints whose lengths are chosen
 * so that pendulum k swings `swings + k` times in `cycle` seconds; they drift
 * out of phase and realign after one cycle. Each bob's `userData` holds its
 * `length` (pivot to centre), small-angle `period` and release `angle`.
 * The lengths include the sphere's own inertia: T = 2 pi sqrt((L^2 + 2 r^2 / 5) / (g L)).
 */
export function pendulumWaveScene(options: {count?: number; cycle?: number; swings?: number; radius?: number; angle?: number} = {}): Scene {
  const {count = 9, cycle = 60, swings = 30, radius = 0.05, angle = 0.15} = options;
  const bodies: SceneBody[] = [], joints: SceneJoint[] = [];
  const lengthFor = (period: number): number => { const a = G * period * period / (4 * Math.PI * Math.PI); return (a + Math.sqrt(a * a - 1.6 * radius * radius)) / 2; };
  const pivotY = round(lengthFor(cycle / swings) + radius + 0.25, 3);
  for (let k = 0; k < count; k++) {
    const period = cycle / (swings + k), length = round(lengthFor(period)), z = round(k * (2 * radius + 0.04));
    const dx = round(length * Math.sin(angle)), dy = round(length * Math.cos(angle));
    bodies.push({
      id: `bob-${k}`, shape: {kind: 'sphere', radius}, position: [dx, round(pivotY - dy), z], material: 'brass', neverSleeps: true,
      userData: {length, period: round(2 * Math.PI * Math.sqrt((length * length + 0.4 * radius * radius) / (G * length)), 9), angle},
    });
    joints.push({id: `string-${k}`, type: 'revolute', bodyA: null, bodyB: `bob-${k}`, frameA: {position: [0, pivotY, z]}, frameB: {position: [-dx, dy, 0]}});
  }
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 240, subSteps: 4},
    materials: {brass: {density: 8500, friction: 0.4, restitution: 0.2, color: 0xD4A017}}, bodies, joints,
    meta: {title: 'Pendulum wave', description: `${count} pendulums that realign every ${cycle} s.`},
  };
}

/**
 * Newton's cradle: `count` steel balls hanging on rigid hinges in a row with a
 * small gap, the first one raised by `angle`. Perfectly elastic and
 * frictionless, so the last ball leaves at the first ball's speed (measured:
 * 99.5% of it with the defaults). Keep the impact above about 1 m/s: the
 * engine applies no restitution to slow contacts (a 0.44 m/s impact passed on
 * only 23%), and the balls must not touch at rest (`gap` > 0).
 */
export function newtonsCradleScene(options: {count?: number; radius?: number; length?: number; angle?: number; gap?: number} = {}): Scene {
  const {count = 5, radius = 0.05, length = 1, angle = 0.6, gap = 0.002} = options;
  const pivotY = round(length + radius + 0.2, 3), pitch = 2 * radius + gap;
  const bodies: SceneBody[] = [], joints: SceneJoint[] = [];
  for (let i = 0; i < count; i++) {
    const x = round((i - (count - 1) / 2) * pitch), raised = i === 0 ? angle : 0;
    const dx = round(length * Math.sin(raised)), dy = round(length * Math.cos(raised));
    bodies.push({id: `ball-${i}`, shape: {kind: 'sphere', radius}, position: [round(x - dx), round(pivotY - dy), 0], material: 'steel', neverSleeps: true, userData: {length}});
    joints.push({id: `rod-${i}`, type: 'revolute', bodyA: null, bodyB: `ball-${i}`, frameA: {position: [x, pivotY, 0]}, frameB: {position: [dx, dy, 0]}});
  }
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 240, subSteps: 4},
    materials: {steel: {density: 7800, friction: 0, restitution: 1, color: 0xC9CED6}}, bodies, joints,
    meta: {title: "Newton's cradle", description: `${count} elastic balls; the first is released from ${angle} rad.`},
  };
}

/** A straight run of `count` dominoes on the ground; the first leans past its tipping point and starts the run. */
export function dominoRunScene(options: {count?: number; spacing?: number} = {}): Scene {
  const {count = 12, spacing = 0.18} = options;
  const hx = 0.02, hy = 0.2, hz = 0.08, lean = -14, t = lean * Math.PI / 180;
  const bodies: SceneBody[] = [];
  for (let i = 0; i < count; i++) {
    const x = round(i * spacing);
    if (i === 0) {
      // Leaning about its bottom edge on the +x side, 1 mm above the ground.
      const cx = -hx * Math.cos(t) + hy * Math.sin(-t), cy = hx * Math.sin(-t) + hy * Math.cos(t);
      bodies.push({id: 'domino-0', shape: {kind: 'box', halfExtents: [hx, hy, hz]}, position: [round(x + hx + cx), round(cy + 0.001), 0], rotationEuler: [0, 0, lean], material: 'wood'});
    } else bodies.push({id: `domino-${i}`, shape: {kind: 'box', halfExtents: [hx, hy, hz]}, position: [x, hy, 0], material: 'wood'});
  }
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 120, subSteps: 4},
    materials: {wood: {density: 700, friction: 0.5, restitution: 0.1, color: 0xB5804A}}, bodies, joints: [],
    meta: {title: 'Domino run', description: `${count} dominoes, ${spacing} m apart.`},
  };
}

/**
 * A four-wheel car on wheel joints (suspension spring, travel limits, spin
 * motor) driving over a rolling height-field terrain. There is no ground slab:
 * the terrain is the floor.
 */
export function terrainCarScene(options: {speed?: number; bump?: number} = {}): Scene {
  const {speed = 8, bump = 0.2} = options;
  const countX = 33, countZ = 9, originX = -16, heights: number[] = [];
  for (let z = 0; z < countZ; z++) for (let x = 0; x < countX; x++) heights.push(round(bump * (1 - Math.cos((originX + x) * Math.PI / 3)) / 2, 4));
  // Suspension travel runs along frame A's x axis and the wheel spins about frame B's z axis: turn x onto world y.
  const up: [number, number, number, number] = [0, 0, Math.SQRT1_2, Math.SQRT1_2];
  const bodies: SceneBody[] = [
    {id: 'terrain', shape: {kind: 'heightfield', heights, countX, countZ, spacing: [1, 1]}, position: [originX, 0, -4], friction: 1, color: 0x6B8E4E},
    {id: 'chassis', shape: {kind: 'box', halfExtents: [1, 0.25, 0.5]}, position: [0, 1, 0], density: 200, color: 0xD9412B},
  ];
  const joints: SceneJoint[] = [];
  for (const [name, x, z] of [['rear-left', -0.8, -0.7], ['rear-right', -0.8, 0.7], ['front-left', 0.8, -0.7], ['front-right', 0.8, 0.7]] as const) {
    bodies.push({id: `wheel-${name}`, shape: {kind: 'sphere', radius: 0.35}, position: [x, 0.5, z], material: 'rubber'});
    joints.push({
      id: `axle-${name}`, type: 'wheel', bodyA: 'chassis', bodyB: `wheel-${name}`, frameA: {position: [x, -0.5, z], rotation: up}, frameB: {rotation: up},
      spring: {hertz: 4, dampingRatio: 0.7}, limits: {lower: -0.3, upper: 0.3}, motor: {speed, maxForce: 400},
    });
  }
  return {
    ...header, world: {gravity: [0, -G, 0], ground: false, seed: 1, step: 1 / 120, subSteps: 4},
    materials: {rubber: {density: 300, friction: 1, restitution: 0, color: 0x2B2B2B}}, bodies, joints,
    meta: {title: 'Car on terrain', description: 'Four wheel joints with suspension and motors on a height field.'},
  };
}

/**
 * A ragdoll: a capsule torso, a sphere head and eight capsule limb segments on
 * nine spherical joints with cone and twist limits, dropped from `height`
 * metres above the ground with a slight forward tumble.
 */
export function ragdollScene(options: {height?: number} = {}): Scene {
  const {height = 0.4} = options;
  // A spherical joint's cone is about the frame's z axis: turn z onto the limb axis (local y).
  const along: [number, number, number, number] = [-Math.SQRT1_2, 0, 0, Math.SQRT1_2];
  const bodies: SceneBody[] = [], joints: SceneJoint[] = [];
  const y = (value: number): number => round(value + height);
  const limb = (id: string, radius: number, halfLength: number, x: number, centre: number): void => {
    bodies.push({id, shape: {kind: 'capsule', radius, halfLength}, position: [x, y(centre), 0], material: 'body'});
  };
  const socket = (id: string, a: string, b: string, anchorA: [number, number, number], anchorB: [number, number, number], coneAngle: number, twist: number): void => {
    joints.push({id, type: 'spherical', bodyA: a, bodyB: b, frameA: {position: anchorA, rotation: along}, frameB: {position: anchorB, rotation: along}, coneAngle, limits: {lower: -twist, upper: twist}});
  };
  bodies.push({id: 'torso', shape: {kind: 'capsule', radius: 0.16, halfLength: 0.22}, position: [0, y(1.4), 0], angularVelocity: [0.8, 0, 0.3], material: 'body'});
  bodies.push({id: 'head', shape: {kind: 'sphere', radius: 0.13}, position: [0, y(1.93), 0], material: 'body'});
  socket('neck', 'torso', 'head', [0, 0.39, 0], [0, -0.14, 0], 0.5, 0.6);
  for (const [side, sign] of [['left', -1], ['right', 1]] as const) {
    limb(`upper-arm-${side}`, 0.06, 0.14, sign * 0.26, 1.44);
    limb(`lower-arm-${side}`, 0.05, 0.13, sign * 0.26, 1.05);
    limb(`upper-leg-${side}`, 0.08, 0.18, sign * 0.1, 0.73);
    limb(`lower-leg-${side}`, 0.07, 0.18, sign * 0.1, 0.2);
    socket(`shoulder-${side}`, 'torso', `upper-arm-${side}`, [sign * 0.26, 0.22, 0], [0, 0.18, 0], 1.2, 0.8);
    socket(`elbow-${side}`, `upper-arm-${side}`, `lower-arm-${side}`, [0, -0.21, 0], [0, 0.18, 0], 1.0, 0.3);
    socket(`hip-${side}`, 'torso', `upper-leg-${side}`, [sign * 0.1, -0.4, 0], [0, 0.27, 0], 0.9, 0.4);
    socket(`knee-${side}`, `upper-leg-${side}`, `lower-leg-${side}`, [0, -0.27, 0], [0, 0.26, 0], 0.8, 0.2);
  }
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 120, subSteps: 4},
    materials: {body: {density: 985, friction: 0.7, restitution: 0.05, color: 0xE0B090}}, bodies, joints,
    meta: {title: 'Ragdoll', description: 'Ten bodies on nine spherical joints with cone and twist limits.'},
  };
}

/** Every example by name, each called with its defaults. */
export const EXAMPLE_SCENES: {readonly [name: string]: () => Scene} = Object.freeze({
  'pendulum-wave': () => pendulumWaveScene(),
  'newtons-cradle': () => newtonsCradleScene(),
  'domino-run': () => dominoRunScene(),
  'terrain-car': () => terrainCarScene(),
  ragdoll: () => ragdollScene(),
});
