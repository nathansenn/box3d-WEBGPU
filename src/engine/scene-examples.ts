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

// ---------------------------------------------------------------------------
// Coupled examples: scenes with water, cable and frame sections. They need a
// Simulation (simulation.ts; the kit's loadScene), so they are kept out of
// EXAMPLE_SCENES, which every rigid-only loader can open.
// ---------------------------------------------------------------------------

/**
 * A buoy moored to the bed: a sphere of radius `radius` and density `density`
 * floats in an 8 m x 8 m basin `depth` deep and is held under its free
 * waterline by one compliant cable (rest length `cableLength`, axial rigidity
 * `axialRigidity` in newtons) from a fixed anchor on the bed to its centre.
 * `offset` moves the buoy sideways at the start. At rest the cable tension is
 * the buoyancy minus the weight of the buoy and of the cable's upper node.
 */
export function mooredBuoyScene(options: {radius?: number; density?: number; depth?: number; cableLength?: number; axialRigidity?: number; offset?: number; linearDrag?: number; waterDrag?: number; lineDensity?: number} = {}): Scene {
  const {radius = 0.4, density = 300, depth = 3, cableLength = 2.75, axialRigidity = 5e4, offset = 0, linearDrag = 200, waterDrag = 0.5, lineDensity = 0.02} = options;
  const cells = 16, size = 0.5, half = cells * size / 2, cableMass = lineDensity * cableLength, y = round(cableLength + 0.02);
  return {
    ...header, world: {gravity: [0, -G, 0], ground: false, seed: 1, step: 1 / 240, subSteps: 4},
    materials: {}, joints: [],
    bodies: [
      {id: 'bed', shape: {kind: 'box', halfExtents: [half, 0.25, half]}, type: 'static', position: [0, -0.25, 0], color: 0x8A7F6A},
      {id: 'buoy', shape: {kind: 'sphere', radius}, position: [offset, y, 0], density, neverSleeps: true, color: 0xE8792B},
    ],
    water: [{
      id: 'basin', cols: cells, rows: cells, dx: size, dz: size, restDepth: depth, origin: [-half, 0, -half], waterDrag,
      bodies: [{body: 'buoy', linearDrag}],
    }],
    cables: [{
      id: 'mooring', nodes: [0, 0, 0, offset, y, 0], masses: [cableMass / 2, cableMass / 2], pinned: [1, 0],
      segments: [{a: 0, b: 1, restLength: cableLength, compliance: cableLength / axialRigidity}],
      maxIterations: 64, residualTolerance: 1e-12, forceTolerance: 1e-9,
      attachments: [{node: 1, body: 'buoy', localPoint: [0, 0, 0]}],
    }],
    meta: {title: 'Moored buoy', description: 'A sphere floating in a basin, held under its free waterline by a compliant cable to the bed.'},
  };
}

/**
 * A small cable-stayed deck: an 8 m steel beam of 8 elements on a pin and a
 * roller, two stays from a fixed tower top 3 m above midspan to the deck at
 * 2 m and 6 m, and a ball pinned to deck node `loadNode` (1 to 7). It is the
 * span of the structure-coupling validation, so its stay tensions and its
 * deflection have a hand solution (docs/STRUCTURE_COUPLING.md).
 */
export function cableStayedDeckScene(options: {loadNode?: number; ballRadius?: number; ballDensity?: number; stayRigidity?: number; drag?: number} = {}): Scene {
  const {loadNode = 5, ballRadius = 0.15, ballDensity = 1000, stayRigidity = 5e6, drag = 60} = options;
  const length = 8, segments = 8, towerX = 4, towerY = 3, stayDensity = 0.2;
  const section = {youngModulus: 2e11, shearModulus: 8e10, area: 0.002, iy: 1e-6, iz: 3e-6, torsionConstant: 2e-6, density: 7850, up: [0, 1, 0] as const};
  const nodes: number[] = [], fixed = new Array<number>(6 * (segments + 1)).fill(0), elements = [];
  for (let i = 0; i <= segments; i++) { nodes.push(length * i / segments, 0, 0); if (i > 0) elements.push({...section, a: i - 1, b: i}); }
  // A pin at node 0 (which also holds the twist) and a roller at the far end.
  fixed[0] = fixed[1] = fixed[2] = fixed[3] = 1; fixed[6 * segments + 1] = fixed[6 * segments + 2] = 1;
  const stay = (id: string, x: number) => {
    const span = Math.hypot(x - towerX, towerY), end = stayDensity * span / 2;
    return {
      id, nodes: [towerX, towerY, 0, x, 0, 0], masses: [end, end], pinned: [1, 0], segments: [{a: 0, b: 1, restLength: span, compliance: span / stayRigidity}],
      maxIterations: 64, residualTolerance: 1e-12, forceTolerance: 1e-9, attachments: [{node: 1, frame: 'deck', frameNode: x}],
    };
  };
  return {
    ...header, world: {gravity: [0, -G, 0], ground: false, seed: 1, step: 1 / 240, subSteps: 4},
    materials: {}, joints: [],
    bodies: [{id: 'load', shape: {kind: 'sphere', radius: ballRadius}, position: [loadNode, 0, 0], density: ballDensity, neverSleeps: true, color: 0xD9412B}],
    frames: [{id: 'deck', nodes, elements, fixed, drag, attachments: [{node: loadNode, body: 'load'}]}],
    cables: [stay('stay-left', 2), stay('stay-right', 6)],
    meta: {title: 'Cable-stayed deck', description: 'A steel deck on a pin and a roller, two stays from a tower top, and a ball pinned to the deck.'},
  };
}

/**
 * The moored buoy released 0.4 m to the side, with `crates` wooden boxes dropped into the same basin: the buoy
 * swings back on its cable while the crates make waves, bob and drift. Water, a cable and floating bodies in one scene.
 */
export function buoyAndCratesScene(options: {offset?: number; crates?: number} = {}): Scene {
  const {offset = 0.4, crates = 3} = options, base = mooredBuoyScene({offset});
  const bodies: SceneBody[] = [...base.bodies], floating = [...(base.water![0].bodies ?? [])];
  for (let k = 0; k < crates; k++) {
    const angle = 2.2 + 2.1 * k, r = 1.9 + 0.35 * k, half = round(0.22 + 0.04 * k);
    bodies.push({id: `crate-${k}`, shape: {kind: 'box', halfExtents: [half, half, half]}, position: [round(r * Math.cos(angle), 3), round(3.6 + 0.5 * k, 3), round(r * Math.sin(angle), 3)],
      rotationEuler: [12 * k, 25 * k, 8], density: 450 + 80 * k, neverSleeps: true, color: 0xB98A4E});
    floating.push({body: `crate-${k}`, linearDrag: 60, angularDrag: 4});
  }
  return {...base, bodies, water: [{...base.water![0], bodies: floating}],
    meta: {title: 'Buoy and crates', description: `A moored buoy released ${offset} m off its line, and ${crates} crates dropped into the basin.`}};
}

/** A rectangle of (nx + 1) x (ny + 1) cloth nodes from `origin` along +x and -z, every cell cut the same way, normals up: node (i, j) is i + (nx + 1) j. */
function clothSheet(nx: number, ny: number, width: number, depth: number, origin: readonly [number, number, number]): {nodes: number[]; triangles: number[]; node: (i: number, j: number) => number} {
  const nodes: number[] = [], triangles: number[] = [], node = (i: number, j: number): number => i + (nx + 1) * j;
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) nodes.push(round(origin[0] + width * i / nx), origin[1], round(origin[2] - depth * j / ny));
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const a = node(i, j), b = node(i + 1, j), c = node(i + 1, j + 1), d = node(i, j + 1);
    triangles.push(a, b, c, a, c, d);
  }
  return {nodes, triangles, node};
}

/**
 * A trampoline: a square cloth of `cells` x `cells` cells and side `side`, held along its four edges at height
 * `height` between four posts, with a ball and a box dropped on it. The cloth and the two bodies are solved together
 * (docs/CLOTH.md), so the bodies bounce, settle into the sag and are carried by it.
 */
export function trampolineScene(options: {cells?: number; side?: number; height?: number; ballRadius?: number; ballDensity?: number} = {}): Scene {
  const {cells = 8, side = 2, height = 1, ballRadius = 0.3, ballDensity = 60} = options;
  const sheet = clothSheet(cells, cells, side, side, [-side / 2, height, side / 2]), pinned: number[] = [];
  for (let j = 0; j <= cells; j++) for (let i = 0; i <= cells; i++) if (i === 0 || j === 0 || i === cells || j === cells) pinned.push(sheet.node(i, j));
  const post = 0.04, rail = side / 2 + post, bodies: SceneBody[] = [];
  for (const [k, [sx, sz]] of ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).entries()) {
    bodies.push({id: `post-${k}`, shape: {kind: 'box', halfExtents: [post, height / 2, post]}, type: 'static', position: [sx * rail, height / 2, sz * rail], color: 0x59616B});
  }
  for (const [k, [sx, sz]] of ([[0, -1], [1, 0], [0, 1], [-1, 0]] as const).entries()) {
    bodies.push({id: `rail-${k}`, shape: {kind: 'box', halfExtents: sx === 0 ? [rail + post, post, post] : [post, post, rail + post]}, type: 'static', position: [sx * rail, height, sz * rail], color: 0x59616B});
  }
  bodies.push(
    {id: 'ball', shape: {kind: 'sphere', radius: ballRadius}, position: [-0.3, round(height + ballRadius + 0.9), 0.1], density: ballDensity, neverSleeps: true, color: 0xD9412B},
    {id: 'box', shape: {kind: 'box', halfExtents: [0.18, 0.18, 0.18]}, position: [0.45, round(height + 0.18 + 1.5), -0.3], rotationEuler: [0, 20, 0], density: 120, neverSleeps: true, color: 0x2F7FD1},
  );
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 120, subSteps: 4},
    materials: {}, joints: [], bodies,
    cloths: [{
      id: 'sheet', nodes: sheet.nodes, triangles: sheet.triangles, pinned,
      material: {arealDensity: 0.3, youngModulus: 5e6, thickness: 1e-3, poissonRatio: 0.3, bendingStiffness: 1e-3},
      drag: 0.8, contact: {stiffness: 2e5},
      bodies: [{body: 'ball', friction: 0.4}, {body: 'box', friction: 0.4}],
    }],
    meta: {title: 'Trampoline', description: `A ${side} m cloth of ${(cells + 1) * (cells + 1)} nodes held along its edges, with a ball and a box dropped on it.`},
  };
}

/**
 * A hopper over a see-saw: `count` beads fill a conical hopper and run out of its orifice into a tray on one end of a
 * plank that turns on a hinge; a counterweight sits on the other end. When enough beads have landed the plank tips.
 * The beads are soft spheres by the discrete element method (docs/GRANULAR.md), linear contact law; the hopper is a
 * fixed wall that only the beads feel, the plank, the tray walls and the counterweight are rigid bodies.
 */
export function hopperSeesawScene(options: {count?: number; radius?: number; orifice?: number; counterweight?: number} = {}): Scene {
  const {count = 150, radius = 0.03, orifice = 0.13, counterweight = 24} = options;
  const density = 2500, mass = density * 4 / 3 * Math.PI * radius ** 3, stiffness = round(4000 * mass * G / (2 * radius), 0);
  // The hopper: a cone from the orifice up to a bin, on the axis x = hopperX.
  const hopperX = 0.55, outlet = 1.55, coneTop = 1.95, binRadius = 0.42, binTop = 2.75;
  const positions: number[] = [], radii: number[] = [];
  let seed = 7;
  const random = (): number => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  const pitch = 2.3 * radius;
  for (let layer = 0; radii.length < count && layer < 64; layer++) {
    const y = coneTop + 0.06 + layer * pitch, reach = binRadius - 1.4 * radius;
    for (let ix = -8; ix <= 8 && radii.length < count; ix++) for (let iz = -8; iz <= 8 && radii.length < count; iz++) {
      const x = ix * pitch + (layer % 2) * pitch / 2, z = iz * pitch + (layer % 2) * pitch / 2;
      if (Math.hypot(x, z) > reach) continue;
      positions.push(round(hopperX + x + 0.1 * radius * (random() - 0.5)), round(y), round(z + 0.1 * radius * (random() - 0.5)));
      radii.push(round(radius * (0.9 + 0.2 * random())));
    }
  }
  // The see-saw: a plank on a hinge about z at the origin of x, a tray of three low walls and an end wall under the hopper, a counterweight at the other end.
  const pivotY = 0.55, plankHalf: [number, number, number] = [1.05, 0.025, 0.3], wall = 0.02, rim = 0.11, trayHalf = 0.34;
  const lean = 0.19, cos = Math.cos(lean), sin = Math.sin(lean), q: [number, number, number, number] = [0, 0, round(Math.sin(lean / 2), 9), round(Math.cos(lean / 2), 9)];
  // A point given in the plank's own axes, in the world, for the plank leaning by `lean` about z (counterweight end down).
  const at = (x: number, y: number, z: number): [number, number, number] => [round(x * cos - y * sin), round(pivotY + x * sin + y * cos), z];
  // Two stops hold the plank at +-lean: their tops are just under the plank's underside at x = +-0.95.
  const stopTop = round(pivotY - 0.95 * sin - plankHalf[1] * cos - 0.004, 4);
  const weightHalf = 0.13, weightDensity = round(counterweight / (8 * weightHalf ** 3), 3);
  const parts: {id: string; half: [number, number, number]; local: [number, number, number]}[] = [
    {id: 'tray-end', half: [wall, rim, plankHalf[2]], local: [hopperX + trayHalf + wall, plankHalf[1] + rim, 0]},
    {id: 'tray-inner', half: [wall, rim, plankHalf[2]], local: [hopperX - trayHalf - wall, plankHalf[1] + rim, 0]},
    {id: 'tray-front', half: [trayHalf, rim, wall], local: [hopperX, plankHalf[1] + rim, plankHalf[2] - wall]},
    {id: 'tray-back', half: [trayHalf, rim, wall], local: [hopperX, plankHalf[1] + rim, -plankHalf[2] + wall]},
  ];
  const bodies: SceneBody[] = [
    {id: 'fulcrum', shape: {kind: 'box', halfExtents: [0.06, (pivotY - 0.03) / 2, 0.34]}, type: 'static', position: [0, (pivotY - 0.03) / 2, 0], color: 0x59616B, filter: {categoryBits: '2', maskBits: '0'}},
    {id: 'stop-left', shape: {kind: 'box', halfExtents: [0.08, stopTop / 2, 0.3]}, type: 'static', position: [-0.95, stopTop / 2, 0], color: 0x59616B},
    {id: 'stop-right', shape: {kind: 'box', halfExtents: [0.08, stopTop / 2, 0.3]}, type: 'static', position: [0.95, stopTop / 2, 0], color: 0x59616B},
    {id: 'plank', shape: {kind: 'box', halfExtents: plankHalf}, position: at(0, 0, 0), rotation: q, density: 500, neverSleeps: true, color: 0xB98A4E},
    ...parts.map((part): SceneBody => ({id: part.id, shape: {kind: 'box', halfExtents: part.half}, position: at(...part.local), rotation: q, density: 500, neverSleeps: true, color: 0x8C6A3F})),
    {id: 'counterweight', shape: {kind: 'box', halfExtents: [weightHalf, weightHalf, weightHalf]}, position: at(-0.85, plankHalf[1] + weightHalf + 0.002, 0), rotation: q, density: weightDensity, friction: 0.9, neverSleeps: true, color: 0x3F4650},
  ];
  const joints: SceneJoint[] = [
    {id: 'hinge', type: 'revolute', bodyA: null, bodyB: 'plank', frameA: {position: [0, pivotY, 0]}, frameB: {position: [0, 0, 0]}},
    ...parts.map((part): SceneJoint => ({id: `weld-${part.id}`, type: 'weld', bodyA: 'plank', bodyB: part.id, frameA: {position: part.local}, frameB: {position: [0, 0, 0]}})),
  ];
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 240, subSteps: 4},
    materials: {}, bodies, joints,
    grains: [{
      id: 'beads', material: {density, restitution: 0.3, friction: 0.5, rollingFriction: 0.05}, law: 'linear', normalStiffness: stiffness, substeps: 12,
      bounds: {min: [-6, -0.5, -6], max: [6, 6, 6]},
      positions, radii,
      walls: [
        {shape: {kind: 'frustum', r0: orifice, z0: outlet, r1: binRadius, z1: coneTop}, position: [hopperX, 0, 0]},
        {shape: {kind: 'cylinder', radius: binRadius, from: coneTop, to: binTop}, position: [hopperX, 0, 0]},
        {shape: {kind: 'plane', normal: [0, 1, 0]}},
      ],
      bodies: [{body: 'plank'}, ...parts.map(part => ({body: part.id})), {body: 'counterweight'}],
    }],
    meta: {title: 'Hopper and see-saw', description: `${radii.length} beads of ${Math.round(2000 * radius)} mm run out of a hopper into a tray on a see-saw and tip it against a ${counterweight} kg counterweight.`},
  };
}

/**
 * A platform hung on four cables from fixed anchors, loaded by `boxes` boxes that fall on it one after another.
 * The cables are tension-only and compliant (docs/COMPLIANT_CABLE.md), coupled two-way to the platform, and hang from
 * the tops of four posts; the boxes are
 * ordinary rigid bodies, so the platform swings, tilts and stretches its cables under them.
 */
export function suspendedPlatformScene(options: {boxes?: number; axialRigidity?: number; drop?: number} = {}): Scene {
  const {boxes = 4, axialRigidity = 4e5, drop = 1.2} = options;
  const half: [number, number, number] = [0.9, 0.05, 0.6], deckY = 1.2, anchorY = 3.6, spread = 0.35, lineDensity = 0.05;
  const cables = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as const).map(([sx, sz], k) => {
    const corner: [number, number, number] = [sx * (half[0] - 0.05), half[1], sz * (half[2] - 0.05)], anchor = [sx * (half[0] - 0.05 + spread), anchorY, sz * (half[2] - 0.05 + spread)];
    const end = [corner[0], deckY + corner[1], corner[2]], length = Math.hypot(anchor[0] - end[0], anchor[1] - end[1], anchor[2] - end[2]), rest = round(length - 0.004), node = lineDensity * rest / 2;
    return {
      id: `cable-${k}`, nodes: [...anchor, ...end].map(v => round(v)), masses: [round(node), round(node)], pinned: [1, 0],
      segments: [{a: 0, b: 1, restLength: rest, compliance: rest / axialRigidity}], maxIterations: 64, residualTolerance: 1e-12, forceTolerance: 1e-9, drag: 0.4,
      attachments: [{node: 1, body: 'platform', localPoint: corner}],
    };
  });
  const bodies: SceneBody[] = [
    {id: 'platform', shape: {kind: 'box', halfExtents: half}, position: [0, deckY, 0], density: 300, friction: 0.8, neverSleeps: true, color: 0xB98A4E},
    // A post under each anchor, from the ground to just above the cable's fixed end.
    ...cables.map((cable, k): SceneBody => ({id: `post-${k}`, shape: {kind: 'box', halfExtents: [0.05, round((cable.nodes[1] + 0.08) / 2), 0.05]}, type: 'static', position: [cable.nodes[0], round((cable.nodes[1] + 0.08) / 2), cable.nodes[2]], color: 0x59616B})),
  ];
  for (let k = 0; k < boxes; k++) {
    const size = round(0.14 + 0.02 * (k % 3));
    bodies.push({id: `load-${k}`, shape: {kind: 'box', halfExtents: [size, size, size]}, position: [round(-0.45 + 0.3 * k), round(deckY + half[1] + size + drop + 1.6 * k), round(0.2 * ((k % 2) * 2 - 1))],
      rotationEuler: [0, 17 * k, 0], density: 700, friction: 0.8, neverSleeps: true, color: [0xD9412B, 0x2F7FD1, 0x3FA34D, 0xE2A31D][k % 4]});
  }
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 240, subSteps: 4},
    materials: {}, joints: [], bodies, cables,
    meta: {title: 'Suspended platform', description: `A platform on four compliant cables, loaded by ${boxes} falling boxes.`},
  };
}

/** The coupled examples by name, each called with its defaults. Load them with a Simulation (`loadSimulationScene`, the kit's `loadScene`). */
/**
 * A rubber pad under a dropped box: a neo-Hookean pad (E = 1.5 MPa, nu = 0.45) welded along its base to a
 * steel plate, and a box that falls on it, bounces on it and comes to rest pressed into it. Solid contact,
 * two-way, with friction (docs/SOLID_CONTACT.md).
 */
export function rubberPadScene(options: {cells?: number; drop?: number; mass?: number} = {}): Scene {
  const {cells = 8, drop = 0.2, mass = 8} = options;
  const pad: [number, number, number] = [0.4, 0.08, 0.4], baseY = 0.1, top = baseY + 0.02 + pad[1], half = 0.12;
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 240, subSteps: 4},
    materials: {}, joints: [],
    bodies: [
      {id: 'base', shape: {kind: 'box', halfExtents: [0.26, 0.02, 0.26]}, type: 'static', position: [0, round(baseY + 0.01), 0], color: 0x59616B},
      {id: 'box', shape: {kind: 'box', halfExtents: [half, half, half]}, position: [0.02, round(top + half + drop), -0.01], rotationEuler: [0, 15, 0],
        density: round(mass / (8 * half ** 3), 3), friction: 0.6, neverSleeps: true, color: 0xC9CDD2},
    ],
    solids: [{
      id: 'pad', mesh: {box: {size: pad, cells: [cells, 2, cells], origin: [-pad[0] / 2, round(baseY + 0.02), -pad[2] / 2]}},
      material: {youngModulus: 1.5e6, poissonRatio: 0.45, density: 1100}, model: 'neo-hookean', stiffnessDamping: 0.002,
      contact: {bodies: [{body: 'box', friction: 0.6}, {body: 'base', collide: false}]},
      welds: [{body: 'base', min: [-1, round(baseY + 0.02), -1], max: [1, round(baseY + 0.02), 1]}],
    }],
    meta: {title: 'Rubber pad', description: `A ${mass} kg box dropped ${drop} m onto a neo-Hookean rubber pad welded to a steel plate: two-way solid contact with friction.`},
  };
}

/**
 * A notched concrete beam loaded by a falling weight (a 200 kg drop hammer from 1.5 m, on a guide). The beam (E = 30 GPa, sigma_c = 3 MPa, G_c = 100 J/m^2)
 * is pinned along both ends of its base, cut by a notch at mid-span and given cohesive interfaces on the
 * section above it. The weight falls on a steel platen over mid-span; the force that holds the weight up is put
 * on the beam's top under the platen (one-way, `reactionLoadLink`). The impact cracks the section from the notch.
 */
export function notchedBeamScene(options: {mass?: number; drop?: number; cells?: number} = {}): Scene {
  const {mass = 200, drop = 1.5, cells = 12} = options;
  const L = 0.4, D = 0.1, W = 0.05, y0 = 0.25, h = L / cells, platen = 0.05, hammer: [number, number, number] = [0.08, 0.2, 0.08];
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 240, subSteps: 4},
    materials: {},
    // The hammer runs on a vertical guide, as on a drop-weight tester: a prismatic joint along y (frame A's x axis turned to y).
    joints: [{id: 'guide', type: 'prismatic', bodyA: null, bodyB: 'weight', frameA: {position: [0, round(y0 + D + 0.01 + hammer[1] + drop), 0], rotation: [0, 0, 0.7071067811865476, 0.7071067811865476]}, frameB: {rotation: [0, 0, 0.7071067811865476, 0.7071067811865476]}}],
    bodies: [
      {id: 'support-left', shape: {kind: 'box', halfExtents: [0.03, round(y0 / 2), 0.06]}, type: 'static', position: [round(-L / 2 + h), round(y0 / 2), 0], color: 0x59616B},
      {id: 'support-right', shape: {kind: 'box', halfExtents: [0.03, round(y0 / 2), 0.06]}, type: 'static', position: [round(L / 2 - h), round(y0 / 2), 0], color: 0x59616B},
      {id: 'platen', shape: {kind: 'box', halfExtents: [platen, 0.005, 0.06]}, type: 'static', position: [0, round(y0 + D + 0.005), 0], color: 0x8C939B},
      // A tungsten-alloy drop hammer.
      {id: 'weight', shape: {kind: 'box', halfExtents: hammer}, position: [0, round(y0 + D + 0.01 + hammer[1] + drop), 0], density: round(mass / (8 * hammer[0] * hammer[1] * hammer[2]), 3), friction: 0.8, restitution: 0, neverSleeps: true, color: 0x50565E},
    ],
    solids: [{
      id: 'beam', mesh: {box: {size: [L, D, W], cells: [cells, 4, 1], origin: [-L / 2, y0, -W / 2]}},
      material: {youngModulus: 30e9, poissonRatio: 0.2, density: 2400}, tolerance: 1e-9,
      // The node lines one cell in from each end of the base, picked with a quarter-cell margin.
      supports: [{min: [round(-L / 2 + 0.75 * h), round(y0 - 0.001), -1], max: [round(-L / 2 + 1.25 * h), round(y0 + 0.001), 1]}, {min: [round(L / 2 - 1.25 * h), round(y0 - 0.001), -1], max: [round(L / 2 - 0.75 * h), round(y0 + 0.001), 1]}],
      loads: [{body: 'weight', min: [-platen, round(y0 + D), -1], max: [platen, round(y0 + D), 1]}],
      fracture: {strength: 3e6, toughness: 100, insertion: 'manual', notches: [{min: [0, y0, -1], max: [0, round(y0 + D / 4), 1]}], interfaces: [{min: [0, round(y0 + D / 4), -1], max: [0, round(y0 + D), 1]}]},
    }],
    meta: {title: 'Notched beam', description: `A ${mass} kg weight dropped ${drop} m onto a notched concrete beam: the impact cracks it from the notch (cohesive fracture).`},
  };
}

/**
 * Thermal shock: an alumina plate at 600 K (E = 370 GPa, nu = 0.22, alpha_T = 8e-6 /K, sigma_c = 300 MPa,
 * G_c = 40 J/m^2, k = 30 W/(m K)) whose face x = 0 is quenched by a film coefficient of 20,000 W/(m^2 K) to
 * 300 K. As quenchedPlate() in solid-fracture.ts, with 6 mm cells instead of 0.25 mm: held in its plane
 * (rollers on the y and z faces and the back face), the cooled layer cracks in tension from about 1.2 s.
 */
export function quenchedPlateScene(options: {cells?: readonly [number, number, number]; cellSize?: number; coefficient?: number} = {}): Scene {
  const {cells = [10, 6, 1], cellSize = 0.006, coefficient = 20000} = options;
  const size = cells.map(n => round(n * cellSize)) as [number, number, number], y0 = 0.1, z0 = round(-size[2] / 2);
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 60, subSteps: 4},
    materials: {}, joints: [],
    bodies: [{id: 'stand', shape: {kind: 'box', halfExtents: [round(size[0] / 2 + 0.004), round(y0 / 2 - 0.002), 0.008]}, type: 'static', position: [round(size[0] / 2), round(y0 / 2 - 0.002), 0], color: 0x59616B}],
    solids: [{
      id: 'plate', mesh: {box: {size, cells: [...cells], origin: [0, y0, z0]}},
      material: {youngModulus: 370e9, poissonRatio: 0.22, density: 3900, thermalExpansion: 8e-6}, model: 'linear', gravity: false, tolerance: 1e-9,
      supports: [
        {min: [size[0], y0 - 1, -1], max: [size[0], y0 + 1, 1], axes: [true, false, false]},
        {min: [-1, y0, -1], max: [1, y0, 1], axes: [false, true, false]}, {min: [-1, round(y0 + size[1]), -1], max: [1, round(y0 + size[1]), 1], axes: [false, true, false]},
        {min: [-1, -1, z0], max: [1, 1, z0], axes: [false, false, true]}, {min: [-1, -1, round(z0 + size[2])], max: [1, 1, round(z0 + size[2])], axes: [false, false, true]},
      ],
      fracture: {strength: 300e6, toughness: 40},
    }],
    heat: [{id: 'plate-heat', solid: 'plate', material: {conductivity: 30, density: 3900, specificHeat: 880}, temperature: 600,
      boundaries: [{face: 'x-', type: 'convection', coefficient, ambient: 300}]}],
    meta: {title: 'Quenched plate', description: 'A hot alumina plate quenched on one face: the heat solver’s temperature is the plate’s thermal strain, and the cooled layer cracks.'},
  };
}

/**
 * A heated bar: an aluminium bar (k = 237 W/(m K), alpha_T = 23e-6 /K, E = 70 GPa) clamped at both ends between
 * a hot block at 500 K and a cold one at 300 K. Its temperature rises from the hot end and settles to a linear
 * ramp in about 20 s; the restrained expansion puts it in compression.
 */
export function heatedBarScene(options: {hot?: number; cold?: number; cells?: number} = {}): Scene {
  const {hot = 500, cold = 300, cells = 10} = options;
  const size: [number, number, number] = [0.08, 0.016, 0.016], y0 = 0.06, origin: [number, number, number] = [round(-size[0] / 2), round(y0 - size[1] / 2), round(-size[2] / 2)];
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 60, subSteps: 4},
    materials: {}, joints: [],
    bodies: [
      {id: 'hot-block', shape: {kind: 'box', halfExtents: [0.015, round(y0 / 2 + 0.015), 0.02]}, type: 'static', position: [round(origin[0] - 0.015), round(y0 / 2 + 0.015), 0], color: 0xC8432F},
      {id: 'cold-block', shape: {kind: 'box', halfExtents: [0.015, round(y0 / 2 + 0.015), 0.02]}, type: 'static', position: [round(-origin[0] + 0.015), round(y0 / 2 + 0.015), 0], color: 0x2F6FB5},
    ],
    solids: [{
      id: 'bar', mesh: {box: {size, cells: [cells, 2, 2], origin}},
      material: {youngModulus: 70e9, poissonRatio: 0.33, density: 2700, thermalExpansion: 23e-6}, model: 'linear', tolerance: 1e-9,
      supports: [{min: [origin[0], -1, -1], max: [origin[0], 1, 1]}, {min: [-origin[0], -1, -1], max: [-origin[0], 1, 1]}],
    }],
    heat: [{id: 'bar-heat', solid: 'bar', material: {conductivity: 237, density: 2700, specificHeat: 900}, temperature: cold,
      boundaries: [{face: 'x-', type: 'temperature', temperature: hot}, {face: 'x+', type: 'temperature', temperature: cold}]}],
    meta: {title: 'Heated bar', description: `An aluminium bar clamped between a block at ${hot} K and one at ${cold} K: the temperature settles to a linear ramp and the restrained bar goes into compression.`},
  };
}

/**
 * A PTFE ball (2200 kg/m^3) settling through a syrup (rho = 1380 kg/m^3, mu = 2.5 Pa s, a corn-syrup-like liquid) in
 * a square column 0.12 m wide: the ball is a body of the rigid world and a moving obstacle in the flow (FluidCoupling),
 * which hands it the drag and the buoyancy. It reaches a terminal velocity within a few centimetres, far below Stokes's
 * 2 (rho_s - rho) g a^2 / (9 mu) because the walls are 1.2 diameters from it, and lands on the floor. 12 x 30 x 12
 * cells of 10 mm (2.5 cells per radius). The world steps at 1/120 s: the coupling is explicit and must step below the
 * ball's response time in the column (about 0.03 s).
 */
export function sphereSettlingScene(options: {radius?: number; density?: number; viscosity?: number} = {}): Scene {
  const {radius = 0.025, density = 2200, viscosity = 2.5} = options;
  const h = 0.01, cells: [number, number, number] = [12, 30, 12], half = round(cells[0] * h / 2);
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 120, subSteps: 4},
    materials: {}, joints: [],
    bodies: [{id: 'ball', shape: {kind: 'sphere', radius}, position: [0, round(cells[1] * h - 0.05), 0], density, friction: 0.4, neverSleeps: true, color: 0xE9E4D8}],
    fluids: [{id: 'syrup', cells, spacing: h, origin: [-half, 0, -half], density: 1380, viscosity, bodies: [{body: 'ball'}]}],
    meta: {title: 'Sphere settling', description: `A ${radius * 2000} mm PTFE ball falling through a syrup of ${viscosity} Pa s in a 120 mm column: drag and buoyancy from the resolved flow, to a terminal velocity.`},
  };
}

/**
 * The lid-driven cavity: a cube of oil 0.1 m on a side (rho = 900 kg/m^3, mu = 0.09 Pa s) whose top wall slides at
 * 0.1 m/s, Re = 100. The flow turns into one large vortex with small ones in the lower corners (the 2D case is checked
 * against Ghia, Ghia & Shin 1982 in docs/FLUID.md; this one is 3D, with side walls). 16^3 cells.
 */
export function cavityFlowScene(options: {cells?: number; lidSpeed?: number} = {}): Scene {
  const {cells = 16, lidSpeed = 0.1} = options, L = 0.1, h = L / cells;
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 60, subSteps: 4},
    materials: {}, joints: [], bodies: [],
    fluids: [{id: 'cavity', cells: [cells, cells, cells], spacing: h, origin: [-L / 2, 0.05, -L / 2], density: 900, viscosity: 0.09, boundaries: {yMax: {type: 'no-slip', velocity: [lidSpeed, 0, 0]}}}],
    meta: {title: 'Lid-driven cavity', description: `A cube of oil whose lid slides at ${lidSpeed} m/s (Re ${Math.round(lidSpeed * L * 900 / 0.09)}): one large vortex, small ones in the lower corners.`},
  };
}

/**
 * Flow past a cylinder at Re = 20, in two dimensions: a slab one cell thick (periodic in z) of a liquid with
 * nu = 4e-5 m^2/s enters at 40 mm/s on the left and leaves on the right (p = 0), with free-slip top and bottom. The
 * cylinder (20 mm across, 6 cells) is a static capsule of the rigid world lying across the slab. Behind it a pair of
 * standing vortices forms; the flow does not shed at this Reynolds number. The channel is 5.3 diameters tall (19%
 * blockage). Gravity is off in the fluid: the flow is horizontal and an outflow side cannot hold a hydrostatic pressure.
 */
export function flowPastCylinderScene(options: {speed?: number; reynolds?: number} = {}): Scene {
  const {speed = 0.04, reynolds = 20} = options, D = 0.02, h = round(D / 6, 9), cells: [number, number, number] = [80, 32, 1];
  const origin: [number, number, number] = [round(-0.3 * cells[0] * h), 0.06, round(-h / 2, 9)], centreY = round(origin[1] + cells[1] * h / 2);
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 60, subSteps: 4},
    materials: {}, joints: [],
    // The capsule's axis is its local y, turned to z.
    bodies: [{id: 'cylinder', shape: {kind: 'capsule', radius: D / 2, halfLength: 0.03}, type: 'static', position: [0, centreY, 0], rotation: [0.7071067811865476, 0, 0, 0.7071067811865476], color: 0x59616B}],
    fluids: [{
      id: 'channel', cells, spacing: h, origin, density: 1000, viscosity: round(1000 * speed * D / reynolds, 9), gravity: false, velocity: [speed, 0, 0],
      boundaries: {xMin: {type: 'inflow', velocity: [speed, 0, 0]}, xMax: 'outflow', yMin: 'free-slip', yMax: 'free-slip', zMin: 'periodic', zMax: 'periodic'},
      bodies: [{body: 'cylinder'}],
    }],
    meta: {title: 'Flow past a cylinder', description: `A liquid entering at ${speed * 1000} mm/s past a 20 mm cylinder (Re ${reynolds}, two-dimensional): a pair of standing vortices forms behind it.`},
  };
}

/**
 * A dam break in three dimensions: a column of water 0.18 m by 0.09 m and 0.3 m tall stands in one corner of a tank
 * 0.6 x 0.36 x 0.18 m and is let go at t = 0. It spreads over the floor, runs to the far wall, climbs it and falls back.
 * Free surface by particles (APIC), eight per cell; inviscid; closed free-slip tank. 20 x 12 x 6 cells of 30 mm,
 * 1,440 particles, two fluid steps per world step.
 */
export function damBreakScene(options: {width?: number; depth?: number; height?: number} = {}): Scene {
  const {width = 0.18, depth = 0.09, height = 0.3} = options, h = 0.03, cells: [number, number, number] = [20, 12, 6];
  const origin: [number, number, number] = [-0.3, 0, -0.09];
  return {
    ...header, world: {gravity: [0, -G, 0], ground: true, seed: 1, step: 1 / 60, subSteps: 4},
    materials: {}, joints: [], bodies: [],
    fluids: [{id: 'tank', kind: 'free-surface', cells, spacing: h, origin, density: 1000, substeps: 2,
      liquid: [{min: origin, max: [round(origin[0] + width), round(origin[1] + height), round(origin[2] + depth)]}]}],
    meta: {title: 'Dam break', description: `A ${height} m column of water let go in a corner of a closed tank: it spreads over the floor, climbs the far wall and falls back (free surface by particles).`},
  };
}

export const COUPLED_EXAMPLE_SCENES: {readonly [name: string]: () => Scene} = Object.freeze({
  'moored-buoy': () => mooredBuoyScene(),
  'cable-stayed-deck': () => cableStayedDeckScene(),
  'buoy-and-crates': () => buoyAndCratesScene(),
  trampoline: () => trampolineScene(),
  'hopper-seesaw': () => hopperSeesawScene(),
  'suspended-platform': () => suspendedPlatformScene(),
  'rubber-pad': () => rubberPadScene(),
  'notched-beam': () => notchedBeamScene(),
  'quenched-plate': () => quenchedPlateScene(),
  'heated-bar': () => heatedBarScene(),
  'sphere-settling': () => sphereSettlingScene(),
  'cavity-flow': () => cavityFlowScene(),
  'flow-past-cylinder': () => flowPastCylinderScene(),
  'dam-break': () => damBreakScene(),
});
