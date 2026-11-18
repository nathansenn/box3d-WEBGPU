// The scenes of the engine comparison. Every scene is plain data (bodies, joints, rays) built from a seeded
// generator, so each engine receives exactly the same shapes, masses, poses, friction and restitution.
// Units are SI: metres, kilograms, seconds; y is up; gravity is 9.81 m/s^2; one step is 1/60 s.
//
// A scene's `build(size)` returns
//   bodies   [{shape, type, position, rotation, density, mass, friction, restitution, linearVelocity?, ccd?, group?}]
//   joints   [{type: 'spherical' | 'revolute', a, b, anchorA, anchorB, ...}]   (a = -1 is the fixed world)
//   steps    number of 1/60 s steps of the measured run
//   sample   0, or read the state every `sample` steps (outside the timed region) for the quality hooks
//   quality  {init(ctx), sample?(ctx, step), finish(ctx)} -> the scene's quality numbers
// Shapes: box {half}, sphere {radius}, capsule {radius, halfHeight} along the body's y axis, hull {points, faces, key},
// mesh {vertices, indices}, heightfield {nx, nz, heights (x + z * nx), dx, dz} starting at the body position.
import {rng, quatAxisAngle, quatMul, quatRotate, quatRandom, shapeVolume, ellipticK, quatIdentity} from './lib/util.mjs';

export const DT = 1 / 60;
export const GRAVITY = 9.81;
const FRICTION = 0.5;

function body(shape, position, options = {}) {
  const density = options.density ?? 1000, type = options.type ?? 'dynamic';
  return {shape, type, position, rotation: options.rotation ?? quatIdentity(), density, mass: type === 'static' ? 0 : density * shapeVolume(shape),
    friction: options.friction ?? FRICTION, restitution: options.restitution ?? 0, linearVelocity: options.linearVelocity ?? null,
    ccd: options.ccd === true, group: options.group ?? -1};
}
const box = (hx, hy, hz) => ({kind: 'box', half: [hx, hy, hz]});
const sphere = radius => ({kind: 'sphere', radius});
const capsule = (radius, halfHeight) => ({kind: 'capsule', radius, halfHeight});
/** The static ground: a 300 m x 1 m x 300 m box whose top face is y = 0. */
const ground = (options = {}) => body(box(150, 0.5, 150), [0, -0.5, 0], {type: 'static', ...options});
/** Four static walls around a square pit of inner half-width `half`, from y = 0 up to `height`. */
function pit(half, height) {
  const t = 0.5, h = height / 2;
  return [
    body(box(t, h, half + 2 * t), [half + t, h, 0], {type: 'static'}), body(box(t, h, half + 2 * t), [-half - t, h, 0], {type: 'static'}),
    body(box(half, h, t), [0, h, half + t], {type: 'static'}), body(box(half, h, t), [0, h, -half - t], {type: 'static'}),
  ];
}

// ---- generic checks every scene reports ---------------------------------------------------------------------------
/** NaN, or a coordinate beyond 10 km: the simulation blew up. */
function unstable(state, count) {
  for (let i = 0; i < count * 7; i++) if (!(Math.abs(state[i]) < 1e4)) return true;
  return false;
}
const noQuality = {init() {}, finish(ctx) { return {unstable: unstable(ctx.state, ctx.count)}; }};

// ---- pyramid -------------------------------------------------------------------------------------------------------
function pyramid(base) {
  const h = 0.25, bodies = [ground()];
  for (let row = 0; row < base; row++) for (let i = 0; i < base - row; i++) {
    bodies.push(body(box(h, h, h), [(i - (base - row - 1) / 2) * 2 * h * 1.05, h + row * 2 * h, 0]));
  }
  return {bodies, joints: [], steps: 300, sample: 1, quality: {
    init(ctx) { ctx.start = ctx.initial; ctx.sleepStep = null; },
    sample(ctx, step) {
      if (ctx.sleepStep === null && ctx.awake !== null && ctx.awake === 0) ctx.sleepStep = step;
    },
    finish(ctx) {
      let drift = 0;
      for (let b = 1; b < ctx.count; b++) drift = Math.max(drift, Math.hypot(ctx.state[b * 7] - ctx.start[b * 7], ctx.state[b * 7 + 1] - ctx.start[b * 7 + 1], ctx.state[b * 7 + 2] - ctx.start[b * 7 + 2]));
      const top = ctx.count - 1, topDrop = ctx.start[top * 7 + 1] - ctx.state[top * 7 + 1];
      return {unstable: unstable(ctx.state, ctx.count), maxDriftMm: drift * 1000, topDropMm: topDrop * 1000, standing: drift < h, stepsToSleep: ctx.sleepStep, awakeAtEnd: ctx.awake};
    },
  }};
}

// ---- piles ---------------------------------------------------------------------------------------------------------
/** `count` bodies on a jittered lattice inside a pit: side^2 per layer, falling onto each other. */
function pile(count, make, spacing, layerGap, seed) {
  const random = rng(seed), side = Math.ceil(Math.cbrt(count)), layers = Math.ceil(count / (side * side));
  const bodies = [ground(), ...pit(side * spacing / 2 + 0.3, layers * layerGap + 2)];
  for (let n = 0; n < count; n++) {
    const layer = Math.floor(n / (side * side)), i = n % side, k = Math.floor(n / side) % side;
    const x = (i - (side - 1) / 2) * spacing + (random() - 0.5) * 0.04, z = (k - (side - 1) / 2) * spacing + (random() - 0.5) * 0.04, y = 0.5 + layer * layerGap;
    bodies.push(make(n, [x, y, z], random));
  }
  // 3 s: the top layer of the largest pile lands after 1.8 s.
  return {bodies, joints: [], steps: 180, sample: 0, quality: {
    init() {},
    finish(ctx) {
      let escaped = 0, maxY = -Infinity;
      for (let b = 5; b < ctx.count; b++) { const y = ctx.state[b * 7 + 1]; if (y < -1) escaped++; maxY = Math.max(maxY, y); }
      return {unstable: unstable(ctx.state, ctx.count), belowGround: escaped, pileTopM: maxY};
    },
  }};
}
const smallTilt = random => quatMul(quatAxisAngle(0, 1, 0, (random() - 0.5) * 0.6), quatAxisAngle(1, 0, 0, (random() - 0.5) * 0.6));
const boxPile = count => pile(count, (n, p, random) => body(box(0.25, 0.25, 0.25), p, {rotation: smallTilt(random)}), 0.55, 0.75, 1000 + count);
const spherePile = count => pile(count, (n, p) => body(sphere(0.25), p), 0.55, 0.75, 2000 + count);
const capsulePile = count => pile(count, (n, p, random) => body(capsule(0.15, 0.2), p, {rotation: quatRandom(random)}), 0.8, 0.6, 3000 + count);

// A regular icosahedron (12 points, 20 triangles), stretched to four fixed proportions.
const PHI = (1 + Math.sqrt(5)) / 2;
const ICO_POINTS = [[-1, PHI, 0], [1, PHI, 0], [-1, -PHI, 0], [1, -PHI, 0], [0, -1, PHI], [0, 1, PHI], [0, -1, -PHI], [0, 1, -PHI], [PHI, 0, -1], [PHI, 0, 1], [-PHI, 0, -1], [-PHI, 0, 1]];
const ICO_FACES = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
const HULL_VARIANTS = [[1, 1, 1], [1.3, 0.8, 1], [0.8, 1.2, 1.1], [1, 0.7, 1.3]].map((scale, index) => {
  const r = 0.3 / Math.hypot(1, PHI), points = new Float32Array(36);
  ICO_POINTS.forEach((p, i) => { points[i * 3] = p[0] * r * scale[0]; points[i * 3 + 1] = p[1] * r * scale[1]; points[i * 3 + 2] = p[2] * r * scale[2]; });
  return {kind: 'hull', points, faces: ICO_FACES, key: `ico${index}`};
});
const hullPile = count => pile(count, (n, p, random) => body(HULL_VARIANTS[n % 4], p, {rotation: quatRandom(random)}), 0.9, 0.8, 4000 + count);

// ---- terrain -------------------------------------------------------------------------------------------------------
export const TERRAIN = {n: 64, d: 1, origin: -31.5};
/** Rolling hills inside a shallow bowl, so the bodies stay on the terrain. */
export function terrainHeight(x, z) {
  return 1.5 * Math.sin(0.25 * x) * Math.cos(0.2 * z) + 0.8 * Math.sin(0.6 * x + 1) * Math.sin(0.5 * z) + 0.004 * (x * x + z * z);
}
function terrainSamples() {
  const {n, d, origin} = TERRAIN, heights = new Float32Array(n * n);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) heights[x + z * n] = terrainHeight(origin + x * d, origin + z * d);
  return heights;
}
function terrainBodies(count, seed) {
  const random = rng(seed), side = Math.ceil(Math.sqrt(count)), bodies = [];
  for (let n = 0; n < count; n++) {
    const x = (n % side - (side - 1) / 2) * 1.2, z = (Math.floor(n / side) - (side - 1) / 2) * 1.2, y = terrainHeight(x, z) + 2 + (n % 3);
    const shape = n % 3 === 0 ? box(0.25, 0.25, 0.25) : n % 3 === 1 ? sphere(0.25) : capsule(0.15, 0.2);
    bodies.push(body(shape, [x, y, z], {rotation: quatRandom(random)}));
  }
  return bodies;
}
function terrainQuality(firstDynamic) {
  return {
    init() {},
    finish(ctx) {
      // A body more than 1 m under the surface below it went through the terrain.
      let through = 0, outside = 0;
      const limit = -TERRAIN.origin;
      for (let b = firstDynamic; b < ctx.count; b++) {
        const x = ctx.state[b * 7], y = ctx.state[b * 7 + 1], z = ctx.state[b * 7 + 2];
        if (Math.abs(x) > limit || Math.abs(z) > limit) outside++;
        else if (y < terrainHeight(x, z) - 1) through++;
      }
      return {unstable: unstable(ctx.state, ctx.count), fellThrough: through, leftTerrain: outside};
    },
  };
}
function meshTerrain(count) {
  const {n, d, origin} = TERRAIN, heights = terrainSamples(), vertices = new Float32Array(n * n * 3), indices = new Uint32Array((n - 1) * (n - 1) * 6);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) { const i = (x + z * n) * 3; vertices[i] = origin + x * d; vertices[i + 1] = heights[x + z * n]; vertices[i + 2] = origin + z * d; }
  let k = 0;
  for (let z = 0; z < n - 1; z++) for (let x = 0; x < n - 1; x++) {
    const a = x + z * n, b = a + 1, c = a + n, e = c + 1;
    // Counter-clockwise seen from above (+y is the outside).
    indices[k++] = a; indices[k++] = c; indices[k++] = b; indices[k++] = b; indices[k++] = c; indices[k++] = e;
  }
  const bodies = [body({kind: 'mesh', vertices, indices}, [0, 0, 0], {type: 'static'}), ...terrainBodies(count, 5000 + count)];
  return {bodies, joints: [], steps: 180, sample: 0, quality: terrainQuality(1)};
}
function heightfieldTerrain(count) {
  const {n, d, origin} = TERRAIN;
  const bodies = [body({kind: 'heightfield', nx: n, nz: n, heights: terrainSamples(), dx: d, dz: d}, [origin, 0, origin], {type: 'static'}), ...terrainBodies(count, 5000 + count)];
  return {bodies, joints: [], steps: 180, sample: 0, quality: terrainQuality(1)};
}

// Vertical rays onto the bare terrain, at lattice points and at the middle of cell edges (where every triangulation of
// a cell agrees). They check that an adapter placed and oriented the terrain exactly as the other engines have it.
function terrainProbe(kind) {
  const {n, d, origin} = TERRAIN, heights = terrainSamples(), top = 40, points = [], expected = [];
  const at = (x, z) => heights[x + z * n];
  for (let k = 0; k < 60; k++) {
    const x = 2 + (k * 7) % (n - 4), z = 2 + (k * 13) % (n - 4);
    points.push([origin + x * d, origin + z * d]); expected.push(top - at(x, z));
    points.push([origin + (x + 0.5) * d, origin + z * d]); expected.push(top - (at(x, z) + at(x + 1, z)) / 2);
    points.push([origin + x * d, origin + (z + 0.5) * d]); expected.push(top - (at(x, z) + at(x, z + 1)) / 2);
  }
  const origins = new Float32Array(points.length * 3), directions = new Float32Array(points.length * 3);
  // 3 mm off the lattice lines, so that no ray runs exactly along a shared triangle edge.
  points.forEach((p, i) => { origins.set([p[0] + 0.003, top, p[1] + 0.003], i * 3); directions.set([0, -1, 0], i * 3); });
  const terrain = kind === 'mesh' ? meshTerrain(0).bodies[0] : heightfieldTerrain(0).bodies[0];
  return {bodies: [terrain], joints: [], steps: 1, sample: 0, rays: {origins, directions, maxDistance: 80, count: points.length, expected: Float32Array.from(expected)}, quality: noQuality};
}

// ---- ragdolls ------------------------------------------------------------------------------------------------------
// One ragdoll: 11 bodies and 10 joints. Shoulders, hips, spine and neck are spherical joints with a cone and a twist
// limit; elbows and knees are revolute joints limited to +-1.2 rad. Limits are symmetric, so no engine's sign
// convention matters. Positions are for a figure standing on y = 0, facing +z.
const RAGDOLL_PARTS = [
  ['pelvis', box(0.15, 0.10, 0.10), [0, 1.00, 0]], ['torso', box(0.16, 0.20, 0.10), [0, 1.32, 0]], ['head', sphere(0.11), [0, 1.66, 0]],
  ['upperArmL', capsule(0.05, 0.11), [-0.23, 1.30, 0]], ['lowerArmL', capsule(0.045, 0.11), [-0.23, 0.97, 0]],
  ['upperArmR', capsule(0.05, 0.11), [0.23, 1.30, 0]], ['lowerArmR', capsule(0.045, 0.11), [0.23, 0.97, 0]],
  ['upperLegL', capsule(0.065, 0.14), [-0.09, 0.68, 0]], ['lowerLegL', capsule(0.055, 0.14), [-0.09, 0.26, 0]],
  ['upperLegR', capsule(0.065, 0.14), [0.09, 0.68, 0]], ['lowerLegR', capsule(0.055, 0.14), [0.09, 0.26, 0]],
];
// [type, parent, child, world anchor, cone half-angle, twist half-range] or [type, parent, child, anchor, hinge half-range]
const RAGDOLL_JOINTS = [
  ['spherical', 0, 1, [0, 1.11, 0], 0.5, 0.3], ['spherical', 1, 2, [0, 1.535, 0], 0.5, 0.3],
  ['spherical', 1, 3, [-0.19, 1.47, 0], 1.2, 0.6], ['revolute', 3, 4, [-0.23, 1.1325, 0], 1.2],
  ['spherical', 1, 5, [0.19, 1.47, 0], 1.2, 0.6], ['revolute', 5, 6, [0.23, 1.1325, 0], 1.2],
  ['spherical', 0, 7, [-0.09, 0.8925, 0], 0.8, 0.4], ['revolute', 7, 8, [-0.09, 0.465, 0], 1.2],
  ['spherical', 0, 9, [0.09, 0.8925, 0], 0.8, 0.4], ['revolute', 9, 10, [0.09, 0.465, 0], 1.2],
];
function ragdolls(count) {
  const random = rng(6000 + count), side = Math.ceil(Math.sqrt(count)), bodies = [ground()], joints = [];
  for (let n = 0; n < count; n++) {
    const base = bodies.length, root = [(n % side - (side - 1) / 2) * 1.5, 0.3 + (n % 5) * 0.6, (Math.floor(n / side) - (side - 1) / 2) * 1.5];
    // Tilt the whole figure about a horizontal axis through its pelvis so that it falls over.
    const heading = random() * 2 * Math.PI, tilt = quatAxisAngle(Math.cos(heading), 0, Math.sin(heading), (random() - 0.5)), pivot = [0, 1, 0];
    for (const [, shape, at] of RAGDOLL_PARTS) {
      const r = quatRotate(tilt, [at[0] - pivot[0], at[1] - pivot[1], at[2] - pivot[2]]);
      bodies.push(body(shape, [root[0] + pivot[0] + r[0], root[1] + pivot[1] + r[1], root[2] + pivot[2] + r[2]], {rotation: tilt, group: n}));
    }
    for (const [type, parent, child, anchor, a, b] of RAGDOLL_JOINTS) {
      const pa = RAGDOLL_PARTS[parent][2], pb = RAGDOLL_PARTS[child][2];
      const joint = {type, a: base + parent, b: base + child, anchorA: [anchor[0] - pa[0], anchor[1] - pa[1], anchor[2] - pa[2]], anchorB: [anchor[0] - pb[0], anchor[1] - pb[1], anchor[2] - pb[2]]};
      // Limbs run along the bodies' y axes; elbows and knees hinge about x.
      if (type === 'spherical') Object.assign(joint, {twistAxisA: [0, 1, 0], twistAxisB: [0, 1, 0], cone: a, twist: [-b, b]});
      else Object.assign(joint, {axisA: [1, 0, 0], axisB: [1, 0, 0], limits: [-a, a]});
      joints.push(joint);
    }
  }
  return {bodies, joints, steps: 180, sample: 10, quality: jointQuality(joints)};
}
/** Largest distance between the two anchor points of any joint: zero for an ideal joint. */
function jointSeparation(ctx, joints) {
  let worst = 0;
  const s = ctx.state;
  for (const joint of joints) {
    const world = (index, local) => {
      if (index < 0) return local;
      const o = index * 7, r = quatRotate([s[o + 3], s[o + 4], s[o + 5], s[o + 6]], local);
      return [s[o] + r[0], s[o + 1] + r[1], s[o + 2] + r[2]];
    };
    const p = world(joint.a, joint.anchorA), q = world(joint.b, joint.anchorB), d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (!(d <= worst)) worst = d;
  }
  return worst;
}
function jointQuality(joints) {
  return {
    init(ctx) { ctx.worst = 0; },
    sample(ctx) { const d = jointSeparation(ctx, joints); if (!(d <= ctx.worst)) ctx.worst = d; },
    finish(ctx) {
      const end = jointSeparation(ctx, joints);
      let below = 0;
      for (let b = 1; b < ctx.count; b++) if (ctx.state[b * 7 + 1] < -0.5) below++;
      return {unstable: unstable(ctx.state, ctx.count), maxJointGapMm: Math.max(ctx.worst, end) * 1000, endJointGapMm: end * 1000, belowGround: below};
    },
  };
}

// ---- chain ---------------------------------------------------------------------------------------------------------
// `links` spheres of radius 0.04 m, 0.1 m apart, hang straight down from a fixed point; the last body weighs 100 links.
// The chain starts in its rest pose, so an ideal (rigid) chain never moves: any motion is solver stretch.
function chain(links) {
  // The fixed point is three chain lengths above the ground, so even a chain that stretches to twice its length hangs free.
  const r = 0.04, gap = 0.1, heavyR = r * Math.cbrt(100), top = 3 * links * gap + 5, bodies = [ground()], joints = [];
  for (let n = 0; n < links; n++) {
    bodies.push(body(sphere(r), [0, top - (n + 0.5) * gap, 0]));
    joints.push({type: 'spherical', a: n === 0 ? -1 : n, b: n + 1, anchorA: n === 0 ? [0, top, 0] : [0, -gap / 2, 0], anchorB: [0, gap / 2, 0]});
  }
  const jointY = top - links * gap;
  bodies.push(body(sphere(heavyR), [0, jointY - heavyR - 0.01, 0]));
  joints.push({type: 'spherical', a: links, b: links + 1, anchorA: [0, -gap / 2, 0], anchorB: [0, heavyR + 0.01, 0]});
  const ideal = top - (jointY - heavyR - 0.01), heavy = links + 1;
  return {bodies, joints, steps: 300, sample: 1, quality: {
    init(ctx) { ctx.maxStretch = 0; ctx.worst = 0; },
    sample(ctx, step) {
      const stretch = (top - ctx.state[heavy * 7 + 1] - ideal) / ideal;
      if (!(Math.abs(stretch) <= Math.abs(ctx.maxStretch))) ctx.maxStretch = stretch;
      if (step % 10 === 0) { const d = jointSeparation(ctx, joints); if (!(d <= ctx.worst)) ctx.worst = d; }
    },
    finish(ctx) {
      const end = (top - ctx.state[heavy * 7 + 1] - ideal) / ideal;
      return {unstable: unstable(ctx.state, ctx.count), idealLengthM: ideal, endStretchPercent: end * 100, maxStretchPercent: ctx.maxStretch * 100,
        maxJointGapMm: Math.max(ctx.worst, jointSeparation(ctx, joints)) * 1000, massRatio: 100, topTensionRatio: links + 100, reachedGround: ctx.state[heavy * 7 + 1] < heavyR + 0.05};
    },
  }};
}

// ---- mass-ratio stack ------------------------------------------------------------------------------------------------
// `light` 10 kg boxes carry one box of the same size that weighs `ratio` times as much (0.5 m cubes).
function massStack(ratio, light) {
  const h = 0.25, bodies = [ground()];
  for (let n = 0; n < light; n++) bodies.push(body(box(h, h, h), [0, h + n * 2 * h, 0], {density: 80}));
  bodies.push(body(box(h, h, h), [0, h + light * 2 * h, 0], {density: 80 * ratio}));
  const top = light + 1;
  // Overlap of each box with the one below it (or the ground): zero for rigid boxes at rest.
  const penetration = ctx => {
    let worst = h - ctx.state[1 * 7 + 1];
    for (let n = 2; n <= top; n++) worst = Math.max(worst, 2 * h - (ctx.state[n * 7 + 1] - ctx.state[(n - 1) * 7 + 1]));
    return worst;
  };
  const standing = ctx => Math.hypot(ctx.state[top * 7], ctx.state[top * 7 + 2]) < h && ctx.state[top * 7 + 1] > light * 2 * h;
  return {bodies, joints: [], steps: 300, sample: 1, quality: {
    init(ctx) { ctx.worst = -Infinity; ctx.fell = null; },
    sample(ctx, step) {
      if (ctx.fell !== null) return;
      if (!standing(ctx)) { ctx.fell = step; return; }
      const p = penetration(ctx); if (!(p <= ctx.worst)) ctx.worst = p;
    },
    finish(ctx) {
      const up = ctx.fell === null && standing(ctx);
      return {unstable: unstable(ctx.state, ctx.count), standing: up, collapsedAtStep: up ? null : ctx.fell ?? 300, endPenetrationMm: up ? penetration(ctx) * 1000 : null,
        maxPenetrationMm: ctx.worst === -Infinity ? null : ctx.worst * 1000, topSideDriftMm: Math.hypot(ctx.state[top * 7], ctx.state[top * 7 + 2]) * 1000, massRatio: ratio};
    },
  }};
}

// ---- bullets -------------------------------------------------------------------------------------------------------
// 50 spheres (radius 0.05 m) at 200 m/s against a 2 cm static wall, and 50 against a 2 cm dynamic steel plate.
// One step moves a bullet 3.3 m, 167 times the wall thickness: without continuous collision it passes through.
function bullets() {
  const speed = 200, wall = body(box(0.01, 3, 6), [10, 3, 0], {type: 'static'}), plate = body(box(0.01, 3, 6), [-10, 3, 0], {density: 8000});
  const bodies = [ground(), wall, plate];
  for (let side = 0; side < 2; side++) for (let n = 0; n < 50; n++) {
    bodies.push(body(sphere(0.05), [side === 0 ? 1 : -1, 0.6 + Math.floor(n / 10) * 1.1, (n % 10 - 4.5) * 1.0], {linearVelocity: [side === 0 ? speed : -speed, 0, 0], ccd: true}));
  }
  return {bodies, joints: [], steps: 60, sample: 0, quality: {
    init() {},
    finish(ctx) {
      let throughStatic = 0, throughDynamic = 0;
      const plateX = ctx.state[2 * 7];
      for (let n = 0; n < 50; n++) {
        if (ctx.state[(3 + n) * 7] > 10.5) throughStatic++;
        if (ctx.state[(53 + n) * 7] < plateX - 0.5) throughDynamic++;
      }
      return {unstable: unstable(ctx.state, ctx.count), tunnelledStatic: throughStatic, tunnelledDynamic: throughDynamic, tunnelled: throughStatic + throughDynamic, bullets: 100,
        speed, stepTravelM: speed * DT, wallThicknessM: 0.02};
    },
  }};
}

// ---- ray casts -----------------------------------------------------------------------------------------------------
// `count` bodies (boxes and spheres, alternating) on a jittered lattice; `rays` rays from a sphere around it.
function raycast(count, rays) {
  const random = rng(7000 + count), side = Math.ceil(Math.cbrt(count)), bodies = [];
  for (let n = 0; n < count; n++) {
    const p = [(n % side - (side - 1) / 2) + (random() - 0.5) * 0.3, 20 + Math.floor(n / (side * side)) + (random() - 0.5) * 0.3, (Math.floor(n / side) % side - (side - 1) / 2) + (random() - 0.5) * 0.3];
    bodies.push(body(n % 2 === 0 ? box(0.25, 0.25, 0.25) : sphere(0.25), p, {rotation: n % 2 === 0 ? quatRandom(random) : quatIdentity()}));
  }
  const layers = Math.ceil(count / (side * side)), centre = [0, 20 + (layers - 1) / 2, 0], reach = side * 0.9 + 6;
  const origins = new Float32Array(rays * 3), directions = new Float32Array(rays * 3);
  for (let n = 0; n < rays; n++) {
    const z = random() * 2 - 1, a = random() * 2 * Math.PI, s = Math.sqrt(1 - z * z);
    const o = [centre[0] + reach * s * Math.cos(a), centre[1] + reach * z, centre[2] + reach * s * Math.sin(a)];
    const t = [centre[0] + (random() - 0.5) * side, centre[1] + (random() - 0.5) * layers, centre[2] + (random() - 0.5) * side];
    const d = [t[0] - o[0], t[1] - o[1], t[2] - o[2]], len = Math.hypot(...d);
    origins.set(o, n * 3); directions.set([d[0] / len, d[1] / len, d[2] / len], n * 3);
  }
  // One step first, so that every engine has built its broad phase the way it does in a running game.
  return {bodies, joints: [], steps: 1, sample: 0, rays: {origins, directions, maxDistance: 2 * reach + 4, count: rays}, quality: noQuality};
}

// ---- closed-form checks ----------------------------------------------------------------------------------------------
// A 1 m pendulum (a sphere on a revolute joint to the world) released from horizontal. Energy must stay constant and
// the period of this 90 degree swing is T = 4 sqrt(Leff / g) K(sin 45 deg), Leff = L + 2 r^2 / (5 L).
function pendulum() {
  const L = 1, r = 0.1, pivot = [0, 5, 0], bob = body(sphere(r), [pivot[0] + L, pivot[1], pivot[2]], {friction: 0});
  const m = bob.mass, inertia = 0.4 * m * r * r, period = 4 * Math.sqrt((L + 0.4 * r * r / L) / GRAVITY) * ellipticK(Math.SQRT1_2);
  const energy = ctx => {
    const v = ctx.velocity;
    return 0.5 * m * (v[6] ** 2 + v[7] ** 2 + v[8] ** 2) + 0.5 * inertia * (v[9] ** 2 + v[10] ** 2 + v[11] ** 2) + m * GRAVITY * (ctx.state[8] - pivot[1]);
  };
  return {bodies: [ground(), bob], joints: [{type: 'revolute', a: -1, b: 1, anchorA: pivot, anchorB: [-L, 0, 0], axisA: [0, 0, 1], axisB: [0, 0, 1]}], steps: 600, sample: 1, needsVelocity: true, quality: {
    // Released at rest at the pivot's height: the energy is exactly zero.
    init(ctx) { ctx.e0 = 0; ctx.maxDrift = 0; ctx.crossings = []; ctx.lastX = ctx.state[7] - pivot[0]; ctx.arm = 0; },
    sample(ctx, step) {
      const drift = (energy(ctx) - ctx.e0) / (m * GRAVITY * L);
      if (!(Math.abs(drift) <= Math.abs(ctx.maxDrift))) ctx.maxDrift = drift;
      const x = ctx.state[7] - pivot[0];
      // The bob passes under the pivot twice per period; interpolate the crossing time.
      if ((x < 0) !== (ctx.lastX < 0)) ctx.crossings.push((step - 1 + ctx.lastX / (ctx.lastX - x)) * DT);
      ctx.lastX = x;
      const arm = Math.abs(Math.hypot(x, ctx.state[8] - pivot[1], ctx.state[9] - pivot[2]) - L);
      if (!(arm <= ctx.arm)) ctx.arm = arm;
    },
    finish(ctx) {
      const end = (energy(ctx) - ctx.e0) / (m * GRAVITY * L), c = ctx.crossings;
      const first = c.length >= 3 ? c[2] - c[0] : null;
      return {unstable: unstable(ctx.state, ctx.count), energyDriftPercent: end * 100, maxEnergyDriftPercent: ctx.maxDrift * 100, periodS: first, periodReferenceS: period,
        periodErrorPercent: first === null ? null : (first - period) / period * 100, swings: c.length, maxArmErrorMm: ctx.arm * 1000};
    },
  }};
}
// A sphere dropped 2 m onto the ground with restitution 0.5 on both: the first rebound must reach e^2 * 2 m = 0.5 m.
function bounce() {
  const r = 0.25, drop = 2, e = 0.5, reference = e * e * drop;
  return {bodies: [ground({restitution: e}), body(sphere(r), [0, r + drop, 0], {restitution: e})], joints: [], steps: 180, sample: 1, quality: {
    init(ctx) { ctx.phase = 0; ctx.low = Infinity; ctx.peak = -Infinity; ctx.previous = ctx.state[8]; },
    sample(ctx) {
      const y = ctx.state[8];
      if (ctx.phase === 0 && y > ctx.previous) { ctx.phase = 1; ctx.low = ctx.previous; }
      if (ctx.phase === 1) { if (y > ctx.peak) ctx.peak = y; else if (y < ctx.previous) ctx.phase = 2; }
      ctx.previous = y;
    },
    finish(ctx) {
      const height = ctx.phase >= 1 ? ctx.peak - r : null;
      return {unstable: unstable(ctx.state, ctx.count), reboundM: height, reboundReferenceM: reference, restitutionErrorPercent: height === null ? null : (height - reference) / reference * 100,
        deepestPenetrationMm: ctx.phase >= 1 ? (r - ctx.low) * 1000 : null};
    },
  }};
}

// ---- catalogue -----------------------------------------------------------------------------------------------------
// `sleep: 'off'` keeps every body awake in every engine, so a timing compares solvers, not sleep policies.
// `sleep: 'default'` is each engine's own sleep policy (used where the scene measures it).
// `warm` is the small copy of the scene stepped first in the same process (JIT and cache warm-up).
export const SCENES = [
  {id: 'pyramid-10', title: 'Box pyramid, 10 high (55 boxes)', group: 'stacking', sleep: 'off', build: () => pyramid(10), warm: () => pyramid(4)},
  {id: 'pyramid-20', title: 'Box pyramid, 20 high (210 boxes)', group: 'stacking', sleep: 'off', build: () => pyramid(20), warm: () => pyramid(4)},
  {id: 'pyramid-10-sleep', title: 'Box pyramid, 10 high, default sleep policy', group: 'quality', sleep: 'default', build: () => pyramid(10), warm: () => pyramid(4)},
  {id: 'pyramid-20-sleep', title: 'Box pyramid, 20 high, default sleep policy', group: 'quality', sleep: 'default', build: () => pyramid(20), warm: () => pyramid(4)},
  {id: 'boxes-1k', title: 'Box pile drop, 1,000 boxes', group: 'piles', sleep: 'off', build: () => boxPile(1000), warm: () => boxPile(64)},
  {id: 'boxes-5k', title: 'Box pile drop, 5,000 boxes', group: 'piles', sleep: 'off', build: () => boxPile(5000), warm: () => boxPile(64)},
  {id: 'boxes-10k', title: 'Box pile drop, 10,000 boxes', group: 'piles', sleep: 'off', build: () => boxPile(10000), warm: () => boxPile(64)},
  {id: 'spheres-5k', title: 'Sphere pile, 5,000 spheres', group: 'piles', sleep: 'off', build: () => spherePile(5000), warm: () => spherePile(64)},
  {id: 'capsules-2k', title: 'Capsule pile, 2,000 capsules', group: 'piles', sleep: 'off', build: () => capsulePile(2000), warm: () => capsulePile(64)},
  {id: 'hulls-1k', title: 'Convex-hull pile, 1,000 hulls (12 points each)', group: 'piles', sleep: 'off', build: () => hullPile(1000), warm: () => hullPile(64)},
  {id: 'trimesh-2k', title: 'Triangle-mesh terrain (7,938 triangles), 2,000 bodies', group: 'terrain', sleep: 'off', build: () => meshTerrain(2000), warm: () => meshTerrain(48)},
  {id: 'heightfield-2k', title: 'Height field (64 x 64 samples), 2,000 bodies', group: 'terrain', sleep: 'off', build: () => heightfieldTerrain(2000), warm: () => heightfieldTerrain(48)},
  {id: 'ragdolls-100', title: '100 ragdolls (1,100 bodies, 1,000 joints)', group: 'joints', sleep: 'off', build: () => ragdolls(100), warm: () => ragdolls(4)},
  {id: 'chain-100', title: 'Chain, 100 links, end mass 100 links', group: 'joints', sleep: 'off', build: () => chain(100), warm: () => chain(10)},
  {id: 'chain-1000', title: 'Chain, 1,000 links, end mass 100 links', group: 'joints', sleep: 'off', build: () => chain(1000), warm: () => chain(10)},
  {id: 'stack-10', title: 'Stack of 4 light boxes under one 10 times heavier', group: 'quality', sleep: 'off', build: () => massStack(10, 4), warm: () => massStack(10, 4)},
  {id: 'stack-100', title: 'Stack of 4 light boxes under one 100 times heavier', group: 'quality', sleep: 'off', build: () => massStack(100, 4), warm: () => massStack(100, 4)},
  {id: 'stack-1000', title: 'Stack of 4 light boxes under one 1,000 times heavier', group: 'quality', sleep: 'off', build: () => massStack(1000, 4), warm: () => massStack(1000, 4)},
  {id: 'pair-1000', title: 'One light box under one 1,000 times heavier', group: 'quality', sleep: 'off', build: () => massStack(1000, 1), warm: () => massStack(1000, 1)},
  {id: 'bullets', title: 'Fast bullets against thin walls (CCD)', group: 'quality', sleep: 'off', build: bullets, warm: bullets},
  {id: 'pendulum', title: 'Frictionless pendulum, 10 s', group: 'quality', sleep: 'off', build: pendulum, warm: pendulum},
  {id: 'bounce', title: 'Bouncing sphere, restitution 0.5', group: 'quality', sleep: 'off', build: bounce, warm: bounce},
  {id: 'raycast-10k', title: '100,000 ray casts against 10,000 bodies', group: 'queries', sleep: 'off', build: () => raycast(10000, 100000), warm: () => raycast(64, 500)},
  {id: 'raycast-200', title: '100,000 ray casts against 200 bodies', group: 'queries', sleep: 'off', build: () => raycast(200, 100000), warm: () => raycast(64, 500)},
  {id: 'probe-trimesh', title: 'Terrain placement check, triangle mesh (180 vertical rays)', group: 'checks', sleep: 'off', build: () => terrainProbe('mesh')},
  {id: 'probe-heightfield', title: 'Terrain placement check, height field (180 vertical rays)', group: 'checks', sleep: 'off', build: () => terrainProbe('heightfield')},
];
/** The CI smoke variant: the same builders at sizes that finish in well under a second each. */
export const SMOKE_SCENES = [
  {id: 'pyramid-smoke', title: 'pyramid 4', sleep: 'default', build: () => ({...pyramid(4), steps: 90})},
  {id: 'boxes-smoke', title: '48 boxes', sleep: 'off', build: () => ({...boxPile(48), steps: 40})},
  {id: 'spheres-smoke', title: '48 spheres', sleep: 'off', build: () => ({...spherePile(48), steps: 40})},
  {id: 'capsules-smoke', title: '48 capsules', sleep: 'off', build: () => ({...capsulePile(48), steps: 40})},
  {id: 'hulls-smoke', title: '48 hulls', sleep: 'off', build: () => ({...hullPile(48), steps: 40})},
  {id: 'trimesh-smoke', title: 'mesh terrain, 30 bodies', sleep: 'off', build: () => ({...meshTerrain(30), steps: 60})},
  {id: 'heightfield-smoke', title: 'height field, 30 bodies', sleep: 'off', build: () => ({...heightfieldTerrain(30), steps: 60})},
  {id: 'ragdolls-smoke', title: '2 ragdolls', sleep: 'off', build: () => ({...ragdolls(2), steps: 90})},
  {id: 'chain-smoke', title: 'chain 10', sleep: 'off', build: () => ({...chain(10), steps: 60})},
  {id: 'stack-smoke', title: 'mass-ratio stack', sleep: 'off', build: () => ({...massStack(10, 4), steps: 60})},
  {id: 'bullets-smoke', title: 'bullets', sleep: 'off', build: bullets},
  {id: 'pendulum-smoke', title: 'pendulum', sleep: 'off', build: () => ({...pendulum(), steps: 200})},
  {id: 'bounce-smoke', title: 'bounce', sleep: 'off', build: bounce},
  {id: 'raycast-smoke', title: '200 rays, 64 bodies', sleep: 'off', build: () => raycast(64, 200)},
];
export const findScene = id => SCENES.find(scene => scene.id === id) ?? SMOKE_SCENES.find(scene => scene.id === id);
