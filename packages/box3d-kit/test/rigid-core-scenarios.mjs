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
