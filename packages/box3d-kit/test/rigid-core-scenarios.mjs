// Set-ups of the rigid-core validation, shared by the test/v21-rigid-*.test.mjs files (which assert on them) and
// validation/domains/rigid-core.mjs (which reports them). Each function builds a problem with a closed-form
// answer, runs the real engine through the kit and returns the measured numbers beside the reference. SI units.
// `K` is the kit: {createWorld, axisRotation, ...}. Nothing here measures wall-clock time unless it says so.

export const G = 9.81, HZ = 240, DT = 1 / HZ, SUB = 4;
/** Box3D's linear slop: resting contacts sink by it, and swept rounded shapes stop this far inside. */
export const LINEAR_SLOP = 0.005;

export const newWorld = (K, options = {}) => K.createWorld({step: DT, subSteps: SUB, gravity: [0, -G, 0], ground: false, ...options});
export const run = (world, seconds, each) => { const n = Math.round(seconds * (1 / world.loop.step)); for (let i = 0; i < n; i++) { world.step(); each?.(i); } };

// Small deterministic generator (mulberry32), so that every run casts the same rays.
export function random(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b, s = 1) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const length = a => Math.hypot(a[0], a[1], a[2]);
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const rotate = ([x, y, z, w], v) => {
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  return [v[0] + w * t[0] + y * t[2] - z * t[1], v[1] + w * t[1] + z * t[0] - x * t[2], v[2] + w * t[2] + x * t[1] - y * t[0]];
};
const conjugate = q => [-q[0], -q[1], -q[2], q[3]];
const axisAngle = (axis, angle) => { const n = length(axis), s = Math.sin(angle / 2) / n; return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(angle / 2)]; };

// ---------------------------------------------------------------------------------------------------
// Closed forms for rays. Each returns {t, point, normal, margin} or null; `t` is the fraction of the
// translation `d`, and `margin` says how far the ray is from grazing (so that a test can leave out the
// rays whose answer flips with the last bit).
// ---------------------------------------------------------------------------------------------------

export function raySphere(o, d, c, R) {
  const m = sub(o, c), a = dot(d, d), b = dot(m, d), c0 = dot(m, m) - R * R, disc = b * b - a * c0;
  // Perpendicular distance from the centre to the ray's line, against the radius.
  const margin = R - Math.sqrt(Math.max(0, dot(m, m) - b * b / a));
  if (disc < 0 || c0 < 0) return {hit: false, margin};
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0 || t > 1) return {hit: false, margin: Math.min(Math.abs(margin), Math.abs(t) * Math.sqrt(a), Math.abs(t - 1) * Math.sqrt(a))};
  const point = add(o, d, t);
  return {hit: true, t, point, normal: scale(sub(point, c), 1 / R), margin: Math.min(margin, t * Math.sqrt(a), (1 - t) * Math.sqrt(a))};
}

/** Oriented box: centre c, rotation q, half extents h. */
export function rayBox(o, d, c, q, h) {
  const inv = conjugate(q), lo = rotate(inv, sub(o, c)), ld = rotate(inv, d);
  let tEnter = -Infinity, tExit = Infinity, axis = -1, sign = 0;
  for (let k = 0; k < 3; k++) {
    if (Math.abs(ld[k]) < 1e-12) { if (Math.abs(lo[k]) > h[k]) return {hit: false, margin: Math.abs(lo[k]) - h[k]}; continue; }
    let t0 = (-h[k] - lo[k]) / ld[k], t1 = (h[k] - lo[k]) / ld[k], s = -1;
    if (t0 > t1) { [t0, t1] = [t1, t0]; s = 1; }
    if (t0 > tEnter) { tEnter = t0; axis = k; sign = s; }
    tExit = Math.min(tExit, t1);
  }
  const speed = length(d), margin = Math.min((tExit - tEnter) * speed, tEnter * speed, (1 - tEnter) * speed);
  if (tEnter > tExit || tEnter < 0 || tEnter > 1) return {hit: false, margin: Math.abs(margin)};
  const normal = [0, 0, 0];
  normal[axis] = sign;
  // How close the entry point is to an edge of its face: there the reported normal may belong to the neighbour.
  const local = add(lo, ld, tEnter);
  let edge = Infinity;
  for (let k = 0; k < 3; k++) if (k !== axis) edge = Math.min(edge, h[k] - Math.abs(local[k]));
  return {hit: true, t: tEnter, point: add(o, d, tEnter), normal: rotate(q, normal), margin: Math.min(margin, edge)};
}

/** Capsule: centre c, rotation q, axis along the local Y, half length h (between the cap centres), radius r. */
export function rayCapsule(o, d, c, q, h, r) {
  const inv = conjugate(q), lo = rotate(inv, sub(o, c)), ld = rotate(inv, d), speed = length(d);
  let best = null;
  const a = ld[0] * ld[0] + ld[2] * ld[2], b = lo[0] * ld[0] + lo[2] * ld[2], c0 = lo[0] * lo[0] + lo[2] * lo[2] - r * r;
  if (a > 1e-12 && b * b - a * c0 >= 0) {
    const t = (-b - Math.sqrt(b * b - a * c0)) / a, y = lo[1] + t * ld[1];
    if (t >= 0 && t <= 1 && Math.abs(y) <= h) best = {t, normal: [(lo[0] + t * ld[0]) / r, 0, (lo[2] + t * ld[2]) / r], seam: h - Math.abs(y)};
  }
  for (const s of [-1, 1]) {
    const cap = raySphere(lo, ld, [0, s * h, 0], r);
    if (cap.hit && (best === null || cap.t < best.t)) best = {t: cap.t, normal: cap.normal, seam: Infinity};
  }
  // Distance from the capsule's axis segment to the ray's line, against the radius: the grazing margin.
  let closest = Infinity;
  for (let i = 0; i <= 200; i++) {
    const p = [0, -h + 2 * h * i / 200, 0], m = sub(lo, p), along = Math.min(Math.max(-dot(m, ld) / (speed * speed), 0), 1);
    closest = Math.min(closest, length(add(m, ld, along)));
  }
  if (best === null) return {hit: false, margin: Math.abs(closest - r)};
  return {hit: true, t: best.t, point: add(o, d, best.t), normal: rotate(q, best.normal), margin: Math.min(r - closest, best.t * speed, (1 - best.t) * speed)};
}

/**
 * Casts `count` rays at one static shape from every side and compares each answer with the closed form.
 * Returns the largest error of the hit point (m) and of the unit normal, the number of rays compared and the
 * number of rays on which the engine and the closed form disagree about hitting at all. Rays within
 * `graze` (m) of only touching the shape, or of ending on it, are left out and counted.
 */
export async function rayAccuracy(K, kind, {count = 2000, seed = 7, graze = 2e-3} = {}) {
  const world = await newWorld(K);
  try {
    const c = [1.5, -0.7, 2.25], q = axisAngle([1, 2, -0.5], 0.9);
    let shape, exact;
    if (kind === 'sphere') { shape = {kind: 'sphere', radius: 0.8}; exact = (o, d) => raySphere(o, d, c, 0.8); }
    else if (kind === 'box') { shape = {kind: 'box', halfExtents: [0.9, 0.35, 0.6]}; exact = (o, d) => rayBox(o, d, c, q, [0.9, 0.35, 0.6]); }
    else { shape = {kind: 'capsule', radius: 0.4, halfLength: 0.7}; exact = (o, d) => rayCapsule(o, d, c, q, 0.7, 0.4); }
    world.createBody({shape, type: 'static', position: c, rotation: q});
    const next = random(seed), rays = [];
    for (let i = 0; i < count; i++) {
      // From a point on a sphere of radius 6 around the shape, towards a point near it, and twice as far.
      const u = next() * 2 - 1, phi = next() * 2 * Math.PI, s = Math.sqrt(1 - u * u);
      const o = add(c, [s * Math.cos(phi), u, s * Math.sin(phi)], 6);
      const target = add(c, [(next() * 2 - 1) * 1.3, (next() * 2 - 1) * 1.3, (next() * 2 - 1) * 1.3]);
      rays.push(...o, ...scale(sub(target, o), 2));
    }
    const batch = world.raycastBatch(rays);
    let pointError = 0, normalError = 0, compared = 0, skipped = 0, disagreements = 0, hits = 0;
    for (let i = 0; i < count; i++) {
      const o = rays.slice(i * 6, i * 6 + 3).map(Math.fround), d = rays.slice(i * 6 + 3, i * 6 + 6).map(Math.fround), ref = exact(o, d);
      if (Math.abs(ref.margin) < graze) { skipped++; continue; }
      const hit = batch.fractions[i] >= 0;
      if (hit !== ref.hit) { disagreements++; continue; }
      if (!hit) continue;
      hits++; compared++;
      const p = [...batch.points.subarray(i * 3, i * 3 + 3)], n = [...batch.normals.subarray(i * 3, i * 3 + 3)];
      pointError = Math.max(pointError, length(sub(p, ref.point)));
      normalError = Math.max(normalError, length(sub(n, ref.normal)));
    }
    return {pointError, normalError, compared, skipped, disagreements, hits, count};
  } finally { world.dispose(); }
}

/**
 * Sweeps of rounded and flat shapes against static shapes with a closed-form time of impact. For each kind
 * returns the range of the gap between the two shapes at the reported fraction: 0 would be touching, negative
 * is inside. Box3D stops a flat shape one linear slop (5 mm) short of the surface and lets a shape with a radius
 * go up to one slop inside.
 */
export async function sweepAccuracy(K, {count = 300, seed = 11} = {}) {
  const world = await newWorld(K);
  try {
    const R = 0.9, c = [0, 0, 0];
    world.createBody({shape: {kind: 'sphere', radius: R}, type: 'static', position: c});
    // A wide slab whose top face is y = 0, far from the sphere.
    world.createBody({shape: {kind: 'box', halfExtents: [3, 0.5, 3]}, type: 'static', position: [20, -0.5, 0]});
    const next = random(seed), gaps = {sphereSphere: [], capsuleSphere: [], sphereFace: [], boxFace: [], capsuleFace: []};
    let misses = 0;
    for (let i = 0; i < count; i++) {
      const r = 0.15 + 0.4 * next();
      // Sphere against sphere: start 5 m away in a random direction, aim to pass within 0.6 (R + r) of the centre.
      const u = next() * 2 - 1, phi = next() * 2 * Math.PI, s = Math.sqrt(1 - u * u), dir = [s * Math.cos(phi), u, s * Math.sin(phi)];
      const side = Math.abs(dir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0], perp = sub(side, scale(dir, dot(side, dir)));
      const offset = scale(perp, 0.6 * (R + r) * next() / length(perp));
      const o = add(add(c, dir, 5), offset), d = scale(dir, -8);
      const hit = world.sphereCast(o, r, d);
      if (!hit) misses++;
      else gaps.sphereSphere.push(length(sub(add(o.map(Math.fround), d.map(Math.fround), hit.fraction), c)) - (R + Math.fround(r)));
      // Upright capsule against the sphere, from straight above with a sideways offset: its lower cap meets the sphere.
      const h = 0.3 + 0.3 * next(), ox = 0.5 * (R + r) * (next() * 2 - 1), oz = 0.5 * (R + r) * (next() * 2 - 1);
      const co = [ox, 6, oz], cd = [0, -8, 0], ch = world.capsuleCast(co, r, h, cd);
      if (!ch) misses++;
      else { const y = Math.fround(6) + Math.fround(-8) * ch.fraction - Math.fround(h); gaps.capsuleSphere.push(Math.hypot(Math.fround(ox), y, Math.fround(oz)) - (R + Math.fround(r))); }
      // Onto the slab's top face (y = 0) at a slant.
      const start = [20 + (next() * 2 - 1), 2 + next(), (next() * 2 - 1)], down = [(next() * 2 - 1) * 2, -5, (next() * 2 - 1) * 2];
      const sf = world.sphereCast(start, r, down);
      if (!sf) misses++; else gaps.sphereFace.push(Math.fround(start[1]) + Math.fround(down[1]) * sf.fraction - Math.fround(r));
      const half = [0.1 + 0.3 * next(), 0.1 + 0.3 * next(), 0.1 + 0.3 * next()];
      const bf = world.boxCast(start, half, down);
      if (!bf) misses++; else gaps.boxFace.push(Math.fround(start[1]) + Math.fround(down[1]) * bf.fraction - Math.fround(half[1]));
      const cf = world.capsuleCast(start, r, h, down);
      if (!cf) misses++; else gaps.capsuleFace.push(Math.fround(start[1]) + Math.fround(down[1]) * cf.fraction - Math.fround(h) - Math.fround(r));
    }
    const range = list => ({min: Math.min(...list), max: Math.max(...list), count: list.length});
    return {misses, sphereSphere: range(gaps.sphereSphere), capsuleSphere: range(gaps.capsuleSphere), sphereFace: range(gaps.sphereFace), boxFace: range(gaps.boxFace), capsuleFace: range(gaps.capsuleFace)};
  } finally { world.dispose(); }
}

/**
 * A 7 x 7 x 7 lattice of small static spheres, 1 m apart, and overlap queries whose answer is a count of
 * lattice points: within a sphere, within a box, within an upright capsule, and the same with a category mask.
 * `margin` is the smallest distance by which any lattice sphere is inside or outside a query (so that no count
 * depends on the engine's 0.5 mm overlap slop).
 */
export async function overlapCounts(K) {
  const world = await newWorld(K);
  try {
    const r = 0.1, centres = [];
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) for (let k = -3; k <= 3; k++) {
      centres.push([i, j, k]);
      // Every other layer is in category 2.
      world.createBody({shape: {kind: 'sphere', radius: r}, type: 'static', position: [i, j, k], filter: {categoryBits: (j & 1) === 0 ? 1n : 2n, maskBits: 0xFFFFFFFFFFFFFFFFn}});
    }
    let margin = Infinity;
    const count = (distance, limit, only) => centres.filter(p => { const e = distance(p) - limit; if (only?.(p) ?? true) margin = Math.min(margin, Math.abs(e)); return e <= 0 && (only?.(p) ?? true); }).length;
    const qs = [0.31, 0.17, -0.23], rs = 2.42;
    const qb = [0.4, -0.2, 0.15], hb = [1.73, 0.95, 2.33];
    const qc = [-0.2, 0.1, 0.3], rc = 1.27, hc = 1.6;
    const toBox = p => { const e = [0, 1, 2].map(k => Math.max(0, Math.abs(p[k] - qb[k]) - hb[k])); return length(e); };
    const toSegment = p => { const y = Math.min(Math.max(p[1] - qc[1], -hc), hc); return Math.hypot(p[0] - qc[0], p[1] - qc[1] - y, p[2] - qc[2]); };
    const limit = 256;
    const sphere = world.overlapSphere(qs, rs, {limit}).length, box = world.overlapBox(qb, hb, {limit}).length, capsule = world.overlapCapsule(qc, rc, hc, {limit}).length;
    const masked = world.overlapSphere(qs, rs, {limit, filter: {maskBits: 2n}}).length;
    const [aabb] = world.native.queryBatch([{kind: 'aabb-candidates', origin: qb, halfExtents: hb, limit}]);
    return {
      sphere, sphereExact: count(p => length(sub(p, qs)), rs + r),
      box, boxExact: count(toBox, r),
      capsule, capsuleExact: count(toSegment, rc + r),
      masked, maskedExact: count(p => length(sub(p, qs)), rs + r, p => (p[1] & 1) !== 0),
      // Broad-phase candidates: every sphere whose bounds meet the box's.
      aabb: aabb.totalHits, aabbExact: centres.filter(p => [0, 1, 2].every(k => { margin = Math.min(margin, Math.abs(Math.abs(p[k] - qb[k]) - hb[k] - r)); return Math.abs(p[k] - qb[k]) <= hb[k] + r; })).length,
      margin, total: centres.length,
    };
  } finally { world.dispose(); }
}

/**
 * One raycastBatch() call against the same rays cast one at a time with raycast(): the two must agree to the
 * last bit, on a scene of boxes, spheres, capsules, hulls, a triangle mesh and a height field (`triangleHits`
 * counts the hits on the last two). Also returns the time each way took (wall clock; reported, never asserted).
 */
export async function batchAgreement(K, {count = 4096, seed = 5} = {}) {
  const world = await newWorld(K);
  try {
    const next = random(seed);
    for (let i = 0; i < 60; i++) {
      const position = [(next() * 2 - 1) * 8, 0.5 + next() * 6, (next() * 2 - 1) * 8], rotation = axisAngle([next() - 0.5, next() - 0.5, next() - 0.5 + 1e-3], next() * 3);
      const pick = i % 4;
      const shape = pick === 0 ? {kind: 'box', halfExtents: [0.2 + next() * 0.6, 0.2 + next() * 0.6, 0.2 + next() * 0.6]} : pick === 1 ? {kind: 'sphere', radius: 0.2 + next() * 0.6}
        : pick === 2 ? {kind: 'capsule', radius: 0.2 + next() * 0.3, halfLength: 0.2 + next() * 0.6} : {kind: 'hull', points: [0, 0.8, 0, 0.7, -0.4, 0.5, -0.7, -0.4, 0.5, 0, -0.4, -0.8, 0.3, 0.2, 0.9]};
      world.createBody({shape, type: i % 3 === 0 ? 'dynamic' : 'static', position, rotation, gravityScale: 0});
    }
    const mesh = world.createBody({shape: {kind: 'mesh', vertices: [-3, 0, -3, 3, 0, -3, 3, 1.5, 3, -3, 1.5, 3], indices: [0, 2, 1, 0, 3, 2]}, position: [12, 0.2, 0]});
    const heights = [];
    for (let z = 0; z < 9; z++) for (let x = 0; x < 9; x++) heights.push(0.4 * Math.sin(x * 0.9) * Math.cos(z * 0.7) + 0.5);
    const field = world.createBody({shape: {kind: 'heightfield', heights, countX: 9, countZ: 9, spacing: [1, 1]}, position: [-16, 0, -4]});
    const rays = [];
    for (let i = 0; i < count; i++) {
      const o = [(next() * 2 - 1) * 18, 8 + next() * 4, (next() * 2 - 1) * 10];
      rays.push(...o, (next() * 2 - 1) * 6, -14, (next() * 2 - 1) * 6);
    }
    const clock = () => globalThis.performance.now();
    let t0 = clock();
    const batch = world.raycastBatch(rays);
    const batchMs = clock() - t0;
    t0 = clock();
    const singles = [];
    for (let i = 0; i < count; i++) singles.push(world.raycast(rays.slice(i * 6, i * 6 + 3), rays.slice(i * 6 + 3, i * 6 + 6)));
    const singleMs = clock() - t0;
    let mismatches = 0, hits = 0, triangleHits = 0;
    for (let i = 0; i < count; i++) {
      const one = singles[i], hit = batch.fractions[i] >= 0;
      if (hit !== (one !== null)) { mismatches++; continue; }
      if (!hit) continue;
      hits++;
      if (batch.bodies[i].token === mesh.token || batch.bodies[i].token === field.token) triangleHits++;
      const same = one.fraction === batch.fractions[i] && one.body.token === batch.bodies[i].token && one.triangleIndex === batch.triangles[i]
        && [0, 1, 2].every(k => one.point[k] === batch.points[i * 3 + k] && one.normal[k] === batch.normals[i * 3 + k]);
      if (!same) mismatches++;
    }
    return {count, hits, hitCount: batch.hitCount, mismatches, triangleHits, batchMs, singleMs};
  } finally { world.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// Capsule character (box3d-webgpu-kit/gameplay, CapsuleCharacterController). `K` also has the class.
// ---------------------------------------------------------------------------------------------------

const CHARACTER = {radius: 0.3, height: 1.8};
const standing = y => y + CHARACTER.height / 2 - LINEAR_SLOP;   // centre of a character standing on a surface at height y
/** Steps the character and the world together for `seconds`, calling `each(state, step)` after each step. */
function walk(world, character, input, seconds, each) {
  const n = Math.round(seconds * HZ);
  for (let i = 0; i < n; i++) {
    const state = character.move(typeof input === 'function' ? input(i) : input, DT);
    world.step();
    each?.(state, i);
  }
  return character.state;
}

/** Flat ground: the speed held over 3 s of walking, the height of the feet, and whether the character stayed grounded. */
export async function characterFlat(K) {
  const world = await newWorld(K, {ground: true});
  try {
    const character = new K.CapsuleCharacterController(world, {...CHARACTER, position: [0, standing(0) + 0.3, 0]});
    walk(world, character, {velocity: [0, 0, 0]}, 1);
    const landedFeet = character.state.feet, start = character.state.position[0];
    let airborne = 0, feetMin = Infinity, feetMax = -Infinity;
    const end = walk(world, character, {velocity: [3, 0, 0]}, 3, s => { if (!s.grounded) airborne++; feetMin = Math.min(feetMin, s.feet); feetMax = Math.max(feetMax, s.feet); });
    return {speed: (end.position[0] - start) / 3, commanded: 3, landedFeet, feetMin, feetMax, airborne, drift: Math.abs(end.position[2])};
  } finally { world.dispose(); }
}

/** A ramp of `degrees` rising along +x from x = 2: how far up it the character gets in 4 s of walking at 2 m/s, and its speed along the ramp. */
export async function characterSlope(K, degrees, maxSlopeDegrees = 45) {
  const world = await newWorld(K, {ground: true});
  try {
    const angle = degrees * Math.PI / 180, length = 12, thick = 0.5;
    // A slab whose top face passes through (2, 0, 0) and rises at `angle`.
    const centre = [2 + (length / 2) * Math.cos(angle) + (thick / 2) * Math.sin(angle), (length / 2) * Math.sin(angle) - (thick / 2) * Math.cos(angle), 0];
    world.createBody({shape: {kind: 'box', halfExtents: [length / 2, thick / 2, 3]}, type: 'static', position: centre, rotation: [0, 0, Math.sin(angle / 2), Math.cos(angle / 2)]});
    const character = new K.CapsuleCharacterController(world, {...CHARACTER, position: [0, standing(0), 0], maxSlopeDegrees});
    walk(world, character, {velocity: [0, 0, 0]}, 0.25);
    walk(world, character, {velocity: [2, 0, 0]}, 2);
    const a = character.state.position;
    const b = walk(world, character, {velocity: [2, 0, 0]}, 2).position;
    return {degrees, climbed: b[1] - standing(0), alongSpeed: Math.hypot(b[0] - a[0], b[1] - a[1]) / 2, grounded: character.state.grounded, x: b[0]};
  } finally { world.dispose(); }
}

/** The steepest ramp climbed and the shallowest refused, scanning in half-degree steps around the limit. */
export async function characterSlopeLimit(K, maxSlopeDegrees = 45) {
  let steepestClimbed = -Infinity, shallowestRefused = Infinity;
  const rows = [];
  for (let degrees = maxSlopeDegrees - 3; degrees <= maxSlopeDegrees + 3 + 1e-9; degrees += 0.5) {
    const r = await characterSlope(K, degrees, maxSlopeDegrees);
    rows.push(r);
    // 4 s at 2 m/s along a ramp gains about 7 sin(angle) m; a refused ramp gains almost nothing.
    if (r.climbed > 1) steepestClimbed = Math.max(steepestClimbed, degrees); else shallowestRefused = Math.min(shallowestRefused, degrees);
  }
  return {maxSlopeDegrees, steepestClimbed, shallowestRefused, rows};
}

/** A ledge of `height` across the path: does the character get onto it within 3 s at 2 m/s? */
export async function characterStep(K, height, stepHeight = 0.35) {
  const world = await newWorld(K, {ground: true});
  try {
    world.createBody({shape: {kind: 'box', halfExtents: [3, height / 2, 3]}, type: 'static', position: [5, height / 2, 0]});
    const character = new K.CapsuleCharacterController(world, {...CHARACTER, position: [0, standing(0), 0], stepHeight});
    walk(world, character, {velocity: [0, 0, 0]}, 0.25);
    let stepped = false;
    const end = walk(world, character, {velocity: [2, 0, 0]}, 3, s => { stepped ||= s.stepped; });
    return {height, onTop: end.feet > height - 0.02 && end.position[0] > 2.5, feet: end.feet, x: end.position[0], stepped};
  } finally { world.dispose(); }
}

/** The tallest ledge climbed and the lowest refused, scanning in 5 mm steps around the step height. */
export async function characterStepLimit(K, stepHeight = 0.35) {
  let tallestClimbed = -Infinity, lowestRefused = Infinity;
  for (let k = -8; k <= 8; k++) {
    const height = stepHeight + k * 0.005, r = await characterStep(K, height, stepHeight);
    if (r.onTop) tallestClimbed = Math.max(tallestClimbed, height); else lowestRefused = Math.min(lowestRefused, height);
  }
  return {stepHeight, tallestClimbed, lowestRefused};
}

/** A jump from flat ground: apex above the standing height, and the time back to the ground. */
export async function characterJump(K, launch = 5) {
  const world = await newWorld(K, {ground: true});
  try {
    const character = new K.CapsuleCharacterController(world, {...CHARACTER, position: [0, standing(0), 0]});
    walk(world, character, {velocity: [0, 0, 0]}, 0.25);
    const base = character.state.position[1];
    let apex = 0, landedAt = null;
    walk(world, character, i => ({velocity: [0, 0, 0], jump: i === 0 ? launch : 0}), 2, (s, i) => { apex = Math.max(apex, s.position[1] - base); if (landedAt === null && i > 2 && s.grounded) landedAt = (i + 1) * DT; });
    return {apex, exactApex: launch * launch / (2 * G), airTime: landedAt, exactAirTime: 2 * launch / G, launch};
  } finally { world.dispose(); }
}

/** Thin walls: a 1 cm wall in the path of a character asked to move at up to 300 m/s. Returns how far past the wall's near face it ever got. */
export async function characterThinWall(K) {
  const world = await newWorld(K, {ground: true});
  try {
    const thickness = 0.01, face = 3;
    world.createBody({shape: {kind: 'box', halfExtents: [thickness / 2, 2, 4]}, type: 'static', position: [face + thickness / 2, 2, 0]});
    const speeds = [10, 50, 100, 300], result = [];
    for (const speed of speeds) {
      const character = new K.CapsuleCharacterController(world, {...CHARACTER, position: [0, standing(0), 0]});
      let furthest = -Infinity;
      // 60 Hz character steps: 5 m per step at 300 m/s, five hundred times the wall's thickness.
      for (let i = 0; i < 60; i++) { const s = character.move({velocity: [speed, 0, 0]}, 1 / 60); furthest = Math.max(furthest, s.position[0] + CHARACTER.radius - face); }
      result.push({speed, pastFace: furthest});
    }
    return {thickness, result, worst: Math.max(...result.map(r => r.pastFace))};
  } finally { world.dispose(); }
}

/** A kinematic platform moving at constant velocity carries a standing character; then an elevator lifts it. */
export async function characterPlatform(K) {
  const world = await newWorld(K, {ground: true});
  try {
    const top = 1, v = [1.5, 0, 0.5];
    const platform = world.createBody({shape: {kind: 'box', halfExtents: [3, 0.25, 3]}, type: 'kinematic', position: [0, top - 0.25, 0]});
    const character = new K.CapsuleCharacterController(world, {...CHARACTER, position: [0, standing(top), 0]});
    walk(world, character, {velocity: [0, 0, 0]}, 0.25);
    world.setVelocity(platform, v);
    // Let it take up the platform's motion, then measure over 2 s.
    walk(world, character, {velocity: [0, 0, 0]}, 0.5);
    const a = character.state.position, pa = world.getState(platform).position;
    const end = walk(world, character, {velocity: [0, 0, 0]}, 2), pb = world.getState(platform).position;
    const carried = [(end.position[0] - a[0]) / 2, (end.position[2] - a[2]) / 2];
    const slip = Math.hypot((end.position[0] - a[0]) - (pb[0] - pa[0]), (end.position[2] - a[2]) - (pb[2] - pa[2]));
    // Now up at 1 m/s.
    world.setVelocity(platform, [0, 1, 0]);
    walk(world, character, {velocity: [0, 0, 0]}, 0.5);
    const y0 = character.state.position[1], p0 = world.getState(platform).position[1];
    let lostGround = 0;
    const up = walk(world, character, {velocity: [0, 0, 0]}, 2, s => { if (!s.grounded) lostGround++; });
    const rise = up.position[1] - y0, platformRise = world.getState(platform).position[1] - p0;
    return {carried, platformVelocity: [v[0], v[2]], slip, rise, platformRise, lostGround, standingError: up.feet - (world.getState(platform).position[1] + 0.25)};
  } finally { world.dispose(); }
}

/**
 * Pushing: a box of mass m with friction mu rests in the path. The character pushes with at most F. Boxes with
 * mu m g < F are pushed along at the walking speed; heavier ones stop the character.
 */
export async function characterPush(K, massRatio, {force = 400, mu = 0.5, speed = 1.5} = {}) {
  const world = await newWorld(K, {ground: false});
  try {
    world.createBody({shape: {kind: 'box', halfExtents: [20, 0.5, 5]}, type: 'static', position: [0, -0.5, 0], friction: mu});
    const limitMass = force / (mu * G), mass = massRatio * limitMass, half = [0.5, 0.5, 0.5];
    const box = world.createBody({shape: {kind: 'box', halfExtents: half}, position: [2, 0.5, 0], density: mass / 1, friction: mu, lockRotation: true});
    const character = new K.CapsuleCharacterController(world, {...CHARACTER, position: [0, standing(0), 0], maxPushForce: force});
    walk(world, character, {velocity: [0, 0, 0]}, 0.5);
    walk(world, character, {velocity: [speed, 0, 0]}, 2);
    const b0 = world.getState(box).position[0], c0 = character.state.position[0];
    walk(world, character, {velocity: [speed, 0, 0]}, 2);
    const b1 = world.getState(box).position[0], c1 = character.state.position[0];
    return {massRatio, mass: world.getState(box).mass, limitMass, boxSpeed: (b1 - b0) / 2, characterSpeed: (c1 - c0) / 2, speed};
  } finally { world.dispose(); }
}

/** A flight of `count` stairs up, a landing, and the same flight down: the height reached, and how many steps of the way down were spent in the air. */
export async function characterStairs(K, {count = 5, rise = 0.2, tread = 0.5} = {}) {
  const world = await newWorld(K, {ground: true});
  try {
    // Solid blocks: stair k (1..count) is a slab from x = 2 + (k - 1) tread to the far end, k rises high.
    const far = 2 + (2 * count + 3) * tread;
    for (let k = 1; k <= count; k++) {
      const x0 = 2 + (k - 1) * tread, x1 = far - (k - 1) * tread;
      world.createBody({shape: {kind: 'box', halfExtents: [(x1 - x0) / 2, rise / 2, 2]}, type: 'static', position: [(x0 + x1) / 2, (k - 0.5) * rise, 0]});
    }
    const character = new K.CapsuleCharacterController(world, {...CHARACTER, position: [0, standing(0), 0]});
    walk(world, character, {velocity: [0, 0, 0]}, 0.25);
    let top = 0, airborneDown = 0, stepsDown = 0, steps = 0;
    const middle = (2 + far) / 2;
    walk(world, character, {velocity: [2, 0, 0]}, (far + 2) / 2, s => {
      top = Math.max(top, s.feet);
      if (s.stepped) steps++;
      if (s.position[0] > middle + tread && s.position[0] < far + 0.3) { stepsDown++; if (!s.grounded) airborneDown++; }
    });
    return {top, expectedTop: count * rise, endFeet: character.state.feet, endX: character.state.position[0], far, airborneDown, stepsDown, steps, count};
  } finally { world.dispose(); }
}

/**
 * The character's own state in a checkpoint: a walk over a ledge, onto a moving platform and into a box it pushes,
 * interrupted half way. A second world and character, built the same way, take the world's checkpoint and the
 * character's saved state and go on. Returns how many later steps differ in any bit of the character's position or
 * of the world's hash.
 */
export async function characterCheckpoint(K) {
  const build = async () => {
    const world = await newWorld(K, {ground: true});
    // A ledge to step onto, a platform drifting sideways to ride, and a box to push.
    world.createBody({shape: {kind: 'box', halfExtents: [1, 0.15, 3]}, type: 'static', position: [3, 0.15, 0]});
    const platform = world.createBody({shape: {kind: 'box', halfExtents: [1.5, 0.15, 4]}, type: 'kinematic', position: [5.55, 0.15, 0], linearVelocity: [0, 0, 0.3]});
    world.createBody({shape: {kind: 'box', halfExtents: [0.3, 0.3, 0.3]}, position: [8.6, 0.3, 1.1], density: 150, friction: 0.4});
    const character = new K.CapsuleCharacterController(world, {...CHARACTER, position: [0, standing(0), 0]});
    return {world, character, platform};
  };
  const input = i => ({velocity: [2, 0, 0.3 * Math.sin(i / 50)], jump: i === 600 ? 4 : 0});
  const a = await build(), b = await build();
  try {
    const half = 150, total = 1300;
    for (let i = 0; i < half; i++) { a.character.move(input(i), DT); a.world.step(); }
    const worldBytes = a.world.checkpoint(), saved = JSON.parse(JSON.stringify(a.character.saveState()));
    // The second pair has its own history first.
    for (let i = 0; i < 77; i++) { b.character.move({velocity: [0, 0, 1]}, DT); b.world.step(); }
    b.world.restoreCheckpoint(worldBytes);
    b.character.restoreState(saved);
    let mismatches = 0, pushes = 0, stepped = 0;
    for (let i = half; i < total; i++) {
      const sa = a.character.move(input(i), DT), sb = b.character.move(input(i), DT);
      a.world.step(); b.world.step();
      pushes += sa.pushed.length; if (sa.stepped) stepped++;
      if (a.world.exactHash() !== b.world.exactHash() || sa.position.some((v, k) => v !== sb.position[k]) || sa.grounded !== sb.grounded || (sa.groundBody?.token ?? 0n) !== (sb.groundBody?.token ?? 0n)) mismatches++;
    }
    return {mismatches, steps: total - half, pushes, stepped, end: a.character.state.position, savedKeys: Object.keys(saved).sort()};
  } finally { a.world.dispose(); b.world.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// Continuous collision.
// ---------------------------------------------------------------------------------------------------

/**
 * A 5 cm steel ball fired at a 2 cm static wall, at 60 Hz, from `phases` start positions spread over one
 * step's travel so that every alignment of the steps with the wall occurs. Returns, per speed, how many shots
 * ended beyond the wall, with continuous collision off and on. `predictedThrough` is the number of shots that
 * discrete stepping must lose. Without continuous collision the ball is stopped only if some step ends with its
 * centre between r + margin before the wall's near face (a contact exists, margin being Box3D's speculative
 * distance of 4 linear slops = 2 cm) and the wall's mid-plane (beyond that the overlap is pushed out the far side):
 * a window of r + margin + thickness / 2 out of every v dt of travel.
 */
export async function bulletThroughWall(K, {speeds = [15, 30, 60, 120, 240], phases = 24} = {}) {
  const dt = 1 / 60, radius = 0.025, thickness = 0.02, wallX = 6, margin = 4 * LINEAR_SLOP;   // B3_SPECULATIVE_DISTANCE, third_party/box3d/include/box3d/constants.h
  const shoot = async (speed, continuous) => {
    const world = await K.createWorld({step: dt, subSteps: 4, gravity: [0, 0, 0], ground: false});
    try {
      world.configure({continuous});
      world.createBody({shape: {kind: 'box', halfExtents: [thickness / 2, 2, 20]}, type: 'static', position: [wallX, 0, 0]});
      const balls = [];
      for (let i = 0; i < phases; i++) balls.push(world.createBody({shape: {kind: 'sphere', radius}, density: 7800, position: [-(i + 0.5) / phases * speed * dt, 0, (i - phases / 2) * 1.5], linearVelocity: [speed, 0, 0]}));
      const steps = Math.ceil((wallX + 4) / (speed * dt)) + 4;
      for (let i = 0; i < steps; i++) world.step();
      return balls.filter(ball => world.getState(ball).position[0] > wallX + thickness).length;
    } finally { world.dispose(); }
  };
  const rows = [];
  for (const speed of speeds) {
    const capture = Math.min(1, (radius + margin + thickness / 2) / (speed * dt));
    rows.push({speed, travelPerStep: speed * dt, through: {off: await shoot(speed, false), on: await shoot(speed, true)}, predictedThrough: Math.round(phases * (1 - capture)), phases});
  }
  return {rows, phases, thickness, radius, throughWithCcd: rows.reduce((n, r) => n + r.through.on, 0), throughWithout: rows.reduce((n, r) => n + r.through.off, 0),
    predictedWithout: rows.reduce((n, r) => n + r.predictedThrough, 0), shots: rows.length * phases};
}

/**
 * The bullet flag: a small ball fired at a thin free plate (dynamic against dynamic, which continuous collision
 * does not cover by default). Returns whether the ball passed, and the momentum before and after, without and with
 * `bullet: true`.
 */
export async function bulletAgainstDynamic(K, {speed = 150} = {}) {
  const dt = 1 / 60, radius = 0.03, half = [0.01, 1, 1];
  const shoot = async bullet => {
    const world = await K.createWorld({step: dt, subSteps: 4, gravity: [0, 0, 0], ground: false});
    try {
      const plate = world.createBody({shape: {kind: 'box', halfExtents: half}, density: 2000, position: [4, 0, 0]});
      // Start so that discrete steps straddle the plate: one step ends 1 m before it and the next 1.5 m after.
      const ball = world.createBody({shape: {kind: 'sphere', radius}, density: 7800, position: [3 - 3 * speed * dt, 0, 0], linearVelocity: [speed, 0, 0]});
      if (bullet) world.setBullet(ball, true);
      const mb = world.getState(ball).mass, mp = world.getState(plate).mass, before = mb * speed;
      for (let i = 0; i < 12; i++) world.step();
      const b = world.getState(ball), p = world.getState(plate);
      return {passed: b.position[0] > p.position[0], momentumBefore: before, momentumAfter: mb * b.linearVelocity[0] + mp * p.linearVelocity[0], plateSpeed: p.linearVelocity[0],
        ballSpeed: b.linearVelocity[0], flag: world.getBodyFlags(ball).bullet, masses: [mb, mp]};
    } finally { world.dispose(); }
  };
  return {plain: await shoot(false), bullet: await shoot(true), speed};
}

// ---------------------------------------------------------------------------------------------------
// Vehicle (box3d-webgpu-kit/gameplay, Vehicle): a chassis on four wheel joints. `K` also has the class.
// ---------------------------------------------------------------------------------------------------

const CAR = {half: [1.6, 0.25, 0.75], wheelX: 1.3, wheelZ: 0.8, radius: 0.35, wheelMass: 20};
const flatRoad = (world, friction = 1) => world.createBody({shape: {kind: 'box', halfExtents: [2000, 0.5, 2000]}, type: 'static', position: [0, -0.5, 0], friction});
function newCar(K, world, options = {}) {
  const {mass = 1200, stiffness = 60000, damping = 4000, position = [0, CAR.radius + CAR.half[1], 0], ...rest} = options;
  return new K.Vehicle(world, {position, chassisHalfExtents: CAR.half, chassisMass: mass, wheelRadius: CAR.radius, wheelMass: CAR.wheelMass,
    wheels: [{position: [CAR.wheelX, -CAR.half[1], -CAR.wheelZ]}, {position: [CAR.wheelX, -CAR.half[1], CAR.wheelZ]}, {position: [-CAR.wheelX, -CAR.half[1], -CAR.wheelZ]}, {position: [-CAR.wheelX, -CAR.half[1], CAR.wheelZ]}],
    suspension: {stiffness, damping, travel: 0.3}, ...rest});
}
const drive = (world, car, controls, seconds, each) => { const n = Math.round(seconds * HZ); for (let i = 0; i < n; i++) { car.update(typeof controls === 'function' ? controls(i) : controls); world.step(); each?.(i); } };

/**
 * Static sag. A car at rest compresses each spring by the load on its wheel over the stiffness: M g / (4 k) with the
 * centre of mass in the middle, and M g (1/2 +- x / L) / (2 k) per axle with it x in front of the middle.
 */
export async function vehicleSag(K) {
  const world = await newWorld(K);
  try {
    flatRoad(world);
    const mass = 1200, stiffness = 60000, shift = 0.4, L = 2 * CAR.wheelX;
    const even = newCar(K, world, {mass, stiffness}), nose = newCar(K, world, {mass, stiffness, position: [0, CAR.radius + CAR.half[1], 20], centerOfMass: [shift, 0, 0]});
    drive(world, even, {}, 5, () => nose.update({}));
    const sag = car => car.state.wheels.map(wheel => wheel.suspension);
    return {even: sag(even), exact: mass * G / (4 * stiffness), nose: sag(nose), exactFront: mass * G * (0.5 + shift / L) / (2 * stiffness), exactRear: mass * G * (0.5 - shift / L) / (2 * stiffness),
      stiffness: even.stiffness, wheelbase: even.wheelbase, track: even.track, speed: even.state.speed};
  } finally { world.dispose(); }
}

/**
 * Heave. A car pushed down and released bounces on its four springs at f = sqrt(4 k / M) / (2 pi) (the wheels stay on
 * the road, so M is the chassis mass), and with dampers of c each the bounce decays at zeta = 4 c / (2 sqrt(4 k M)).
 */
export async function vehicleHeave(K, {mass = 1200, stiffness = 60000, damping = 0} = {}) {
  const world = await newWorld(K);
  try {
    flatRoad(world);
    const car = newCar(K, world, {mass, stiffness, damping: Math.max(damping, 1500)});
    drive(world, car, {}, 4);
    // Settled with damping; now the dampers of the run under test, and a downward kick.
    const run2 = async () => {
      const w2 = await newWorld(K);
      try {
        flatRoad(w2);
        const rest = car.state.position[1];
        const car2 = newCar(K, w2, {mass, stiffness, damping, position: [0, rest, 0]});
        // Place the wheels where the settled car has them, so that the run starts at rest.
        const y0 = w2.getState(car2.chassis).position[1];
        w2.setVelocity(car2.chassis, [0, -0.25, 0]);
        const ys = [];
        drive(w2, car2, {}, 6, () => ys.push(w2.getState(car2.chassis).position[1]));
        return {ys, y0};
      } finally { w2.dispose(); }
    };
    const {ys} = await run2();
    const mean = ys.slice(-HZ).reduce((a, b) => a + b, 0) / HZ, centred = ys.map(y => y - mean);
    const crossings = [], peaks = [];
    for (let i = 1; i < centred.length; i++) if (centred[i - 1] < 0 && centred[i] >= 0) crossings.push((i - 1 + centred[i - 1] / (centred[i - 1] - centred[i])) / HZ);
    for (let i = 1; i < centred.length - 1; i++) if (centred[i] > centred[i - 1] && centred[i] >= centred[i + 1] && centred[i] > 1e-5) peaks.push(centred[i]);
    const period = (crossings.at(-1) - crossings[0]) / (crossings.length - 1);
    // Logarithmic decrement over the first few peaks.
    const used = Math.min(peaks.length - 1, 4), decrement = used > 0 ? Math.log(peaks[0] / peaks[used]) / used : 0, zeta = decrement / Math.hypot(2 * Math.PI, decrement);
    return {frequency: 1 / period, exact: Math.sqrt(4 * stiffness / mass) / (2 * Math.PI), zeta, exactZeta: 4 * damping / (2 * Math.sqrt(4 * stiffness * mass)), peaks: peaks.slice(0, 6), cycles: crossings.length - 1};
  } finally { world.dispose(); }
}

/**
 * Top speed. Four driven wheels with a torque limit tau each push with 4 tau / R; drag is rho CdA v^2 / 2. The car is
 * started below and above the balance speed sqrt(8 tau / (R rho CdA)) and must settle on it from both sides.
 */
export async function vehicleTopSpeed(K, {torque = 40, dragArea = 1.2, mass = 240, seconds = 45} = {}) {
  const exact = Math.sqrt(8 * torque / (CAR.radius * 1.225 * dragArea));
  const from = async factor => {
    const world = await newWorld(K);
    try {
      flatRoad(world);
      const car = newCar(K, world, {mass, stiffness: 30000, damping: 3000, maxDriveTorque: torque, maxWheelSpeed: 400, dragArea});
      drive(world, car, {}, 2);
      const v = factor * exact;
      world.setVelocity(car.chassis, [v, 0, 0]);
      for (const wheel of car.wheels) world.setVelocity(wheel, [v, 0, 0], [0, 0, -v / CAR.radius]);
      drive(world, car, {throttle: 1}, seconds);
      const s = car.state;
      return {speed: s.forwardSpeed, spin: s.wheels.map(wheel => wheel.spinSpeed), sideways: Math.abs(s.position[2])};
    } finally { world.dispose(); }
  };
  const below = await from(0.95), above = await from(1.05);
  return {exact, below: below.speed, above: above.speed, slip: below.spin.map(w => w * CAR.radius / below.speed - 1), sideways: Math.max(below.sideways, above.sideways), torque, dragArea};
}

/**
 * Turning circle. At low speed a car with its steering at the bicycle angle delta turns about a point on its rear
 * axle line at R = L / tan(delta) (Ackermann geometry: every wheel's axle passes through that point).
 */
export async function vehicleTurning(K, {delta = 0.25, speed = 3} = {}) {
  const world = await newWorld(K);
  try {
    flatRoad(world);
    const car = newCar(K, world, {maxSteerAngle: 0.5, maxDriveTorque: 400});
    drive(world, car, {}, 2);
    const steer = delta / car.maxSteerAngle;
    // Hold the speed with the throttle, turn left for 4 s to settle, then measure over one more lap or 20 s.
    const control = () => ({steer, throttle: Math.max(-1, Math.min(1, (speed - car.state.forwardSpeed) * 0.8))});
    drive(world, car, control, 6);
    const radii = [], xs = [], zs = [];
    drive(world, car, control, 20, () => {
      const s = world.getState(car.chassis), q = s.rotation, w = s.angularVelocity, v = s.linearVelocity;
      // Velocity of the middle of the rear axle: v + w x r, with r from the chassis origin to it.
      const fwd = [1 - 2 * (q[1] * q[1] + q[2] * q[2]), 2 * (q[0] * q[1] + q[3] * q[2]), 2 * (q[0] * q[2] - q[3] * q[1])], r = fwd.map(c => -c * CAR.wheelX);
      const vr = [v[0] + w[1] * r[2] - w[2] * r[1], v[1] + w[2] * r[0] - w[0] * r[2], v[2] + w[0] * r[1] - w[1] * r[0]];
      radii.push(Math.hypot(vr[0], vr[2]) / Math.abs(w[1]));
      xs.push(s.position[0] + r[0]); zs.push(s.position[2] + r[2]);
    });
    // Circle through the rear-axle path by least squares (Kasa fit).
    const n = xs.length, mx = xs.reduce((a, b) => a + b, 0) / n, mz = zs.reduce((a, b) => a + b, 0) / n;
    let suu = 0, svv = 0, suv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
    for (let i = 0; i < n; i++) { const u = xs[i] - mx, v = zs[i] - mz; suu += u * u; svv += v * v; suv += u * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u; }
    const det = suu * svv - suv * suv, uc = (svv * (suuu + suvv) - suv * (svvv + svuu)) / (2 * det), vc = (suu * (svvv + svuu) - suv * (suuu + suvv)) / (2 * det);
    const fitted = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
    const state = car.state;
    return {radius: radii.reduce((a, b) => a + b, 0) / radii.length, fitted, exact: car.wheelbase / Math.tan(delta), speed: state.forwardSpeed, yawRate: state.yawRate,
      angles: state.wheels.map(wheel => wheel.steeringAngle), ackermann: car.ackermann(delta), lateral: speed * speed / (car.wheelbase / Math.tan(delta))};
  } finally { world.dispose(); }
}

/** Braking with locked wheels on a road of friction mu: the car stops in v^2 / (2 mu g). */
export async function vehicleBraking(K, {speed = 20, mu = 0.8} = {}) {
  const world = await newWorld(K);
  try {
    flatRoad(world, mu);
    // Tyre friction mu too: Box3D mixes the two coefficients as sqrt(mu1 mu2).
    const car = newCar(K, world, {wheelFriction: mu, maxBrakeTorque: 4000});
    drive(world, car, {}, 2);
    world.setVelocity(car.chassis, [speed, 0, 0]);
    for (const wheel of car.wheels) world.setVelocity(wheel, [speed, 0, 0], [0, 0, -speed / CAR.radius]);
    drive(world, car, {}, 0.25);
    const x0 = car.state.position[0], v0 = car.state.forwardSpeed;
    let stoppedAt = null, locked = 0, steps = 0;
    drive(world, car, {brake: 1}, 8, i => { const s = car.state; if (s.speed > 1) { steps++; if (Math.max(...s.wheels.map(wheel => Math.abs(wheel.spinSpeed))) < 0.5) locked++; } if (stoppedAt === null && s.speed < 0.01) stoppedAt = (i + 1) * DT; });
    return {distance: car.state.position[0] - x0, exact: v0 * v0 / (2 * mu * G), v0, stoppedAt, exactTime: v0 / (mu * G), lockedFraction: locked / steps, sideways: Math.abs(car.state.position[2])};
  } finally { world.dispose(); }
}

/**
 * A drive over rough height-field terrain with a checkpoint half way: the car must stay upright and on the ground,
 * and a second world restored from the checkpoint, with the vehicle's saved state, must match it bit for bit.
 */
export async function vehicleTerrainCheckpoint(K) {
  const build = async () => {
    const world = await newWorld(K);
    const n = 129, heights = [];
    for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) heights.push(0.18 * Math.sin(x * 0.55) * Math.cos(z * 0.4) + 0.1 * Math.sin(x * 0.21 + z * 0.33));
    world.createBody({shape: {kind: 'heightfield', heights, countX: n, countZ: n, spacing: [1, 1]}, position: [-16, 0, -64], friction: 1});
    const car = newCar(K, world, {position: [0, 1.1, 0], maxDriveTorque: 500, dragArea: 0.8});
    return {world, car};
  };
  const controls = i => ({throttle: i < 1500 ? 0.6 : 0.2, steer: 0.35 * Math.sin(i / 300), brake: i > 2200 ? 0.5 : 0});
  const a = await build(), b = await build();
  try {
    const half = 900, total = 2400;
    let minUp = 1, maxHeight = -Infinity;
    const watch = () => { const s = a.car.state, q = s.rotation; minUp = Math.min(minUp, 1 - 2 * (q[0] * q[0] + q[2] * q[2])); maxHeight = Math.max(maxHeight, s.position[1]); };
    drive(a.world, a.car, controls, half / HZ, watch);
    const bytes = a.world.checkpoint(), saved = JSON.parse(JSON.stringify(a.car.saveState()));
    drive(b.world, b.car, {throttle: -1, steer: 1}, 0.5);
    b.world.restoreCheckpoint(bytes);
    b.car.restoreState(saved);
    let mismatches = 0;
    for (let i = half; i < total; i++) {
      a.car.update(controls(i)); b.car.update(controls(i));
      a.world.step(); b.world.step(); watch();
      if (a.world.exactHash() !== b.world.exactHash()) mismatches++;
    }
    const s = a.car.state;
    return {mismatches, steps: total - half, minUp, maxHeight, travelled: Math.hypot(s.position[0], s.position[2]), end: s.position, savedKeys: Object.keys(saved).sort()};
  } finally { a.world.dispose(); b.world.dispose(); }
}

// ---------------------------------------------------------------------------------------------------
// Motor, parallel and filter joints, joint events and breakable joints.
// ---------------------------------------------------------------------------------------------------

/**
 * A breakable weld holding a block from the world, with an extra downward force that grows slowly. The weld must
 * break when the force it carries reaches its threshold: returns the carried force (weight plus the applied
 * force) in the step before it broke and the threshold. With `arm` > 0 the block hangs that far to the side and the
 * threshold is on the torque instead.
 */
export async function breakableWeld(K, {threshold = 500, arm = 0, rate = 60} = {}) {
  const world = await newWorld(K);
  try {
    const half = 0.1, block = world.createBody({shape: {kind: 'box', halfExtents: [half, half, half]}, density: 1250, position: [arm, 5, 0], neverSleeps: true});
    const mass = world.getState(block).mass;
    const weld = world.createJoint({type: 'weld', bodyA: null, bodyB: block, frameA: {position: [0, 5, 0]}, frameB: {position: [-arm, 0, 0]}, stiffness: {hertz: 240, dampingRatio: 2},
      thresholds: arm > 0 ? {torque: threshold, breakable: true} : {force: threshold, breakable: true}});
    const events = [];
    world.onEvent(event => { if (event.kind === 'joint-break' || event.kind === 'joint-overload') events.push({...event, tick: world.tick}); });
    let applied = 0, carriedBefore = 0, reported = 0, brokeAt = null;
    for (let i = 0; i < HZ * 60 && brokeAt === null; i++) {
      applied = rate * i * DT;
      world.applyForce(block, [0, -applied, 0]);
      const state = world.isJointAlive(weld) ? world.getJointState(weld) : null;
      if (state) { carriedBefore = (arm > 0 ? arm : 1) * (mass * G + rate * (i - 1) * DT); reported = arm > 0 ? Math.hypot(...state.torque) : Math.hypot(...state.force); }
      world.step();
      if (!world.isJointAlive(weld)) brokeAt = i;
    }
    const load = (arm > 0 ? arm : 1) * (mass * G + applied);
    // The block is free afterwards: it must be falling.
    run(world, 0.25);
    return {threshold, load, carriedBefore, reported, mass, weight: mass * G, broke: brokeAt !== null, events, fallingSpeed: -world.getState(block).linearVelocity[1], resolution: (arm > 0 ? arm : 1) * rate * DT};
  } finally { world.dispose(); }
}

/** A weld with a threshold that is not breakable reports 'joint-overload' in every step in which it is over, and stays. */
export async function overloadEvents(K) {
  const world = await newWorld(K);
  try {
    const block = world.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}, density: 1250, position: [0, 5, 0], neverSleeps: true});
    const weight = world.getState(block).mass * G;
    const weld = world.createJoint({type: 'weld', bodyA: null, bodyB: block, frameA: {position: [0, 5, 0]}, thresholds: {force: 2 * weight}});
    const ticks = [];
    world.onEvent(event => { if (event.kind === 'joint-overload') ticks.push({tick: world.tick, force: Math.hypot(...event.force), sameJoint: event.joint.token === weld.token, bodyB: event.bodyB?.token === block.token, bodyA: event.bodyA}); });
    run(world, 0.5);
    const quiet = ticks.length;
    // Push down with 1.5 weights for 0.5 s: the weld then carries 2.5 weights.
    for (let i = 0; i < HZ / 2; i++) { world.applyForce(block, [0, -1.5 * weight, 0]); world.step(); }
    const loud = ticks.length - quiet;
    run(world, 0.5);
    return {quiet, loud, after: ticks.length - quiet - loud, steps: HZ / 2, alive: world.isJointAlive(weld), ticks, weight, details: world.getJointDetails(weld)};
  } finally { world.dispose(); }
}

/**
 * A motor joint between the world and a free body in zero gravity.
 * Velocity drive: the body accelerates at F / m until it reaches the wanted speed, then holds it.
 * Spin drive: the same about an axis, at torque / inertia.
 * Linear spring: released from a displacement, it oscillates at the stated frequency; critically damped it returns
 * as (1 + w t) exp(-w t). Under gravity the spring sags by g / (2 pi f)^2.
 */
export async function motorJoint(K) {
  const world = await newWorld(K, {gravity: [0, 0, 0]});
  try {
    const radius = 0.25, speed = 3, force = 200;
    const sled = world.createBody({shape: {kind: 'sphere', radius}, position: [0, 0, 0], neverSleeps: true});
    const mass = world.getState(sled).mass;
    world.createJoint({type: 'motor', bodyA: null, bodyB: sled, drive: {linearVelocity: [speed, 0, 0], maxForce: force}});
    let reachedAt = null, midSpeed = 0;
    const rampTime = mass * speed / force;
    for (let i = 1; i <= HZ * 4; i++) {
      world.step();
      const v = world.getState(sled).linearVelocity[0];
      if (i === Math.round(rampTime * HZ / 2)) midSpeed = v;
      if (reachedAt === null && v >= speed * 0.999) reachedAt = i * DT;
    }
    const held = world.getState(sled).linearVelocity[0];

    const spin = 4, torque = 3;
    const rotor = world.createBody({shape: {kind: 'sphere', radius}, position: [0, 10, 0], neverSleeps: true});
    const inertia = 0.4 * world.getState(rotor).mass * radius * radius;
    const spinJoint = world.createJoint({type: 'motor', bodyA: null, bodyB: rotor, frameA: {position: [0, 10, 0]}, drive: {angularVelocity: [0, spin, 0], maxTorque: torque, linearSpring: {hertz: 30, dampingRatio: 1, maxForce: 1e6}}});
    let spinReachedAt = null;
    for (let i = 1; i <= HZ * 4; i++) { world.step(); if (spinReachedAt === null && world.getState(rotor).angularVelocity[1] >= spin * 0.999) spinReachedAt = i * DT; }
    const heldSpin = world.getState(rotor).angularVelocity[1], drift = Math.hypot(...world.getState(rotor).position.map((v, k) => v - [0, 10, 0][k]));

    // Springs: undamped oscillation, and a critically damped return.
    const hertz = 1.5, x0 = 0.4;
    const bob = world.createBody({shape: {kind: 'sphere', radius}, position: [x0, 20, 0], neverSleeps: true});
    world.createJoint({type: 'motor', bodyA: null, bodyB: bob, frameA: {position: [0, 20, 0]}, drive: {linearSpring: {hertz, dampingRatio: 0, maxForce: 1e9}}});
    const xs = [];
    for (let i = 0; i < HZ * 6; i++) { world.step(); xs.push(world.getState(bob).position[0]); }
    const crossings = [];
    for (let i = 1; i < xs.length; i++) if (xs[i - 1] > 0 && xs[i] <= 0) crossings.push((i - 1 + xs[i - 1] / (xs[i - 1] - xs[i])) / HZ);
    const period = (crossings.at(-1) - crossings[0]) / (crossings.length - 1), lateAmplitude = Math.max(...xs.slice(-HZ).map(Math.abs));

    const damped = world.createBody({shape: {kind: 'sphere', radius}, position: [x0, 30, 0], neverSleeps: true});
    world.createJoint({type: 'motor', bodyA: null, bodyB: damped, frameA: {position: [0, 30, 0]}, drive: {linearSpring: {hertz, dampingRatio: 1, maxForce: 1e9}}});
    const tSample = 1 / hertz;
    run(world, tSample);
    const w = 2 * Math.PI * hertz, dampedX = world.getState(damped).position[0], dampedExact = x0 * (1 + w * tSample) * Math.exp(-w * tSample);
    return {speed, held, reachedAt, rampTime, midSpeed, spin, heldSpin, spinReachedAt, spinRampTime: inertia * spin / torque, drift, details: world.getJointDetails(spinJoint),
      hertz, period, lateAmplitude, x0, dampedX, dampedExact};
  } finally { world.dispose(); }
}

/** A motor joint's spring holding a body against gravity: it sags by g / (2 pi f)^2, whatever the mass. */
export async function motorSpringSag(K, hertz = 2) {
  const world = await newWorld(K);
  try {
    const results = [];
    for (const [index, density] of [500, 4000].entries()) {
      const body = world.createBody({shape: {kind: 'box', halfExtents: [0.2, 0.2, 0.2]}, density, position: [index * 3, 5, 0], neverSleeps: true, lockRotation: true});
      world.createJoint({type: 'motor', bodyA: null, bodyB: body, frameA: {position: [index * 3, 5, 0]}, drive: {linearSpring: {hertz, dampingRatio: 1, maxForce: 1e9}}});
      results.push(body);
    }
    run(world, 4);
    return {sags: results.map(body => 5 - world.getState(body).position[1]), exact: G / (2 * Math.PI * hertz) ** 2, hertz};
  } finally { world.dispose(); }
}

/**
 * A parallel joint keeps the z axis of a body along the world's z axis with a spring. A ball released with its
 * axis tilted swings back and forth about the aligned direction at the stated frequency.
 */
export async function parallelJoint(K, hertz = 1) {
  const world = await newWorld(K, {gravity: [0, 0, 0]});
  try {
    const tilt = 0.2, q = [Math.sin(tilt / 2), 0, 0, Math.cos(tilt / 2)];
    const ball = world.createBody({shape: {kind: 'sphere', radius: 0.3}, position: [0, 0, 0], rotation: q, neverSleeps: true});
    const joint = world.createJoint({type: 'parallel', bodyA: null, bodyB: ball, spring: {hertz, dampingRatio: 0}, maxTorque: 1e6});
    const angles = [];
    for (let i = 0; i < HZ * 6; i++) {
      world.step();
      const r = world.getState(ball).rotation;
      // Signed tilt of the body's z axis about x: the y component of the rotated z axis is -sin(angle).
      angles.push(Math.asin(Math.max(-1, Math.min(1, 2 * (r[3] * r[0] - r[1] * r[2])))));
    }
    const crossings = [];
    for (let i = 1; i < angles.length; i++) if (angles[i - 1] > 0 && angles[i] <= 0) crossings.push((i - 1 + angles[i - 1] / (angles[i - 1] - angles[i])) / HZ);
    return {period: (crossings.at(-1) - crossings[0]) / (crossings.length - 1), exact: 1 / hertz, lateAmplitude: Math.max(...angles.slice(-HZ).map(Math.abs)), tilt, details: world.getJointDetails(joint),
      position: Math.hypot(...world.getState(ball).position)};
  } finally { world.dispose(); }
}

/** Two overlapping boxes: with a filter joint between them they pass through each other; without it they push apart. */
export async function filterJoint(K) {
  const separation = async filtered => {
    const world = await newWorld(K, {gravity: [0, 0, 0]});
    try {
      const a = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0, 0, 0], neverSleeps: true});
      const b = world.createBody({shape: {kind: 'box', halfExtents: [0.5, 0.5, 0.5]}, position: [0.4, 0, 0], neverSleeps: true});
      const joint = filtered ? world.createJoint({type: 'filter', bodyA: a, bodyB: b}) : null;
      run(world, 1);
      const result = {distance: world.getState(b).position[0] - world.getState(a).position[0], type: joint ? world.getJointState(joint).type : null};
      if (joint) { world.destroyJoint(joint); run(world, 1); result.afterRemoval = world.getState(b).position[0] - world.getState(a).position[0]; }
      return result;
    } finally { world.dispose(); }
  };
  return {filtered: await separation(true), plain: await separation(false)};
}

/**
 * Checkpoints and replay of the new joint state: a world with a breakable weld under a growing load, a motor
 * joint, a parallel joint, a bullet and changed world settings is checkpointed before the weld breaks, restored
 * into a second world built the same way, and both are stepped on. Returns the tick at which each weld broke and
 * whether every later state hash agreed; and whether a recording of the same session replays to the same hash.
 */
export async function jointCheckpoint(K) {
  const build = world => {
    world.configure({restitutionThreshold: 0.5, contactHertz: 45, maximumLinearSpeed: 120});
    const block = world.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.1, 0.1]}, density: 1250, position: [0, 5, 0], neverSleeps: true});
    const weld = world.createJoint({type: 'weld', bodyA: null, bodyB: block, frameA: {position: [0, 5, 0]}, thresholds: {force: 300, breakable: true}});
    const sled = world.createBody({shape: {kind: 'sphere', radius: 0.25}, position: [3, 0.25, 0], neverSleeps: true});
    world.createJoint({type: 'motor', bodyA: null, bodyB: sled, frameA: {position: [3, 0.25, 0]}, drive: {linearVelocity: [1, 0, 0], maxForce: 500, angularSpring: {hertz: 2, dampingRatio: 1, maxTorque: 50}}});
    const top = world.createBody({shape: {kind: 'capsule', radius: 0.15, halfLength: 0.4}, position: [-3, 0.6, 0], rotation: [0.1, 0, 0, 0.995]});
    world.createJoint({type: 'parallel', bodyA: null, bodyB: top, frameA: {rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]}, frameB: {rotation: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]}, spring: {hertz: 3, dampingRatio: 0.3}, maxTorque: 200});
    const shot = world.createBody({shape: {kind: 'sphere', radius: 0.05}, density: 7800, position: [-8, 0.6, 0], linearVelocity: [60, 0, 0], bullet: true});
    return {block, weld, shot};
  };
  const drive = (world, parts, from, to, onBreak) => {
    for (let i = from; i < to; i++) {
      if (world.isAlive(parts.block)) world.applyForce(parts.block, [0, -40 * i * DT, 0]);
      world.step();
      if (onBreak && !world.isJointAlive(parts.weld)) { onBreak(world.tick); onBreak = null; }
    }
  };
  const a = await newWorld(K, {ground: true}), b = await newWorld(K, {ground: true});
  try {
    const pa = build(a), pb = build(b);
    let brokeA = null, brokeB = null;
    const at = HZ * 2, end = HZ * 8;
    drive(a, pa, 0, at, tick => { brokeA = tick; });
    const bytes = a.checkpoint(), settingsAtCheckpoint = a.settings(), aliveAtCheckpoint = a.isJointAlive(pa.weld);
    drive(b, pb, 0, 37, null);   // a different history before the restore
    b.restoreCheckpoint(bytes);
    const settingsRestored = b.settings(), breakableRestored = b.getJointDetails(pb.weld).breakable, bulletRestored = b.getBodyFlags(pb.shot).bullet;
    let mismatches = 0;
    for (let i = at; i < end; i++) {
      for (const [world, parts] of [[a, pa], [b, pb]]) { if (world.isAlive(parts.block)) world.applyForce(parts.block, [0, -40 * i * DT, 0]); world.step(); }
      if (brokeA === null && !a.isJointAlive(pa.weld)) brokeA = a.tick;
      if (brokeB === null && !b.isJointAlive(pb.weld)) brokeB = b.tick;
      if (a.exactHash() !== b.exactHash()) mismatches++;
    }
    // Record and replay the same session.
    const c = await newWorld(K);
    try {
      c.startRecording({world: {ground: true, gravity: [0, -G, 0]}});
      const pc = build(c);
      drive(c, pc, 0, HZ * 4, null);
      const log = JSON.parse(JSON.stringify(c.stopRecording()));
      const finalHash = c.exactHash(), brokenInRecording = !c.isJointAlive(pc.weld);
      const d = await newWorld(K);
      try { return {brokeA, brokeB, mismatches, steps: end - at, settingsAtCheckpoint, settingsRestored, breakableRestored, bulletRestored, aliveAtCheckpoint,
        replay: d.replayDetailed(log), finalHash, brokenInRecording, calls: log.commands.filter(command => command.op === 'call').map(command => command.method)}; } finally { d.dispose(); }
    } finally { c.dispose(); }
  } finally { a.dispose(); b.dispose(); }
}
