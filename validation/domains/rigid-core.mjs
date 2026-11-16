// The rigid core beyond bodies and joints (docs/RIGID_CORE.md): scene queries, the capsule character, continuous
// collision, the wheel-joint vehicle, motor and breakable joints, world controls, and stacks and piles, against
// closed forms. The set-ups are the ones the test files assert on: packages/box3d-kit/test/rigid-core-scenarios.mjs,
// run here through the built kit. SI units, 240 Hz, 4 sub-steps unless a row says otherwise.
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import {kit, memo, defineCases, relative, absolute, upper, lower, ROOT} from '../lib.mjs';

const QUERIES = 'packages/box3d-kit/test/v21-rigid-queries.test.mjs';
const T = {
  rays: 'rays against a sphere, an oriented box and an oriented capsule: hit points and normals match the closed forms',
  sweeps: 'sweeps: at the reported time of impact a flat shape is one linear slop short and a rounded one at most one slop inside',
  overlaps: 'overlaps: sphere, box, capsule and broad-phase counts on a lattice equal the counts of lattice points, with and without a mask',
  batch: 'raycastBatch: 4,096 rays in one call agree bit for bit with 4,096 single raycasts, on every shape kind',
};

const modules = () => memo('rigid-core/modules', async () => {
  const [S, index, gameplay] = await Promise.all([import(pathToFileURL(path.join(ROOT, 'packages/box3d-kit/test/rigid-core-scenarios.mjs')).href), kit('index'), kit('gameplay')]);
  return {S, K: {...index, ...gameplay}};
});
/** Runs one scenario once, whatever number of rows read it. */
const run = (key, call) => memo(`rigid-core/${key}`, async () => { const {S, K} = await modules(); return call(S, K); });

const rays = kind => run(`rays/${kind}`, (S, K) => S.rayAccuracy(K, kind));
const sweeps = () => run('sweeps', (S, K) => S.sweepAccuracy(K));
const overlaps = () => run('overlaps', (S, K) => S.overlapCounts(K));
const batch = () => run('batch', (S, K) => S.batchAgreement(K));

const CHARACTER = 'packages/box3d-kit/test/v21-rigid-character.test.mjs';
const TC = {
  flat: 'flat ground: the character walks at the commanded speed, stays grounded and keeps its feet on the floor',
  slope: 'slope limit: ramps below maxSlopeDegrees are climbed at the commanded speed along the ramp, steeper ones are walls',
  step: 'step height: ledges up to stepHeight are stepped onto, taller ones block, and stairs are walked up and down',
  jump: 'jump: the apex is v^2 / (2 g) and the flight lasts 2 v / g',
  wall: 'thin walls: a 1 cm wall stops the character at 10 to 300 m/s, 5 m per step at the top speed',
  platform: 'moving platforms: a standing character takes the velocity of the kinematic body under it, sideways and upwards',
  push: 'pushing: a box lighter than maxPushForce / (mu g) is pushed at walking speed, a heavier one stops the character',
  checkpoint: 'checkpoint: the world checkpoint and the character state resume a walk bit for bit (a step, a platform ride, a jump, pushing)',
};
const flat = () => run('character/flat', (S, K) => S.characterFlat(K));
const slopeLimit = limit => run(`character/slope/${limit}`, (S, K) => S.characterSlopeLimit(K, limit));
const stepLimit = height => run(`character/step/${height}`, (S, K) => S.characterStepLimit(K, height));
const stairs = () => run('character/stairs', (S, K) => S.characterStairs(K));
const jump = () => run('character/jump', (S, K) => S.characterJump(K, 5));
const thinWall = () => run('character/wall', (S, K) => S.characterThinWall(K));
const platform = () => run('character/platform', (S, K) => S.characterPlatform(K));
const push = ratio => run(`character/push/${ratio}`, (S, K) => S.characterPush(K, ratio));
const characterCheckpoint = () => run('character/checkpoint', (S, K) => S.characterCheckpoint(K));
const G = 9.81, HZ = 240;

const SLOP = 0.005;
const rayRows = (kind, label, formula) => [
  {id: `rigid-core.ray.${kind}.point`, title: `Ray against ${label}: hit point`, quantity: 'largest distance between the reported and the exact hit point, 2,000 rays from every side', unit: 'm', test: T.rays,
    reference: {formula, value: 0}, tolerance: upper(5e-5), note: 'Float32 positions 6 m from the shape; rays within 2 mm of grazing the shape or of ending on it are left out.',
    measure: async () => (await rays(kind)).pointError},
  {id: `rigid-core.ray.${kind}.normal`, title: `Ray against ${label}: surface normal`, quantity: 'largest difference between the reported and the exact unit normal', unit: '1', test: T.rays,
    reference: {formula: 'n = outward unit normal of the surface at the hit point', value: 0}, tolerance: upper(1e-4), measure: async () => (await rays(kind)).normalError},
  {id: `rigid-core.ray.${kind}.agreement`, title: `Ray against ${label}: hit or miss`, quantity: 'rays on which the engine and the closed form disagree about hitting', unit: 'rays', test: T.rays,
    reference: {formula: 'hit exactly when the closed form has a root in [0, 1]', value: 0}, tolerance: absolute(0), measure: async () => (await rays(kind)).disagreements},
];

const cases = defineCases('rigid-core', QUERIES, [
  ...rayRows('sphere', 'a sphere', 'p = o + t d with t = (-b - sqrt(b^2 - a c)) / a, a = d.d, b = (o - c).d, c = |o - c|^2 - R^2'),
  ...rayRows('box', 'an oriented box', 'slab method in the box frame: t = max over axes of the entry times'),
  ...rayRows('capsule', 'an oriented capsule', 'first root among the side cylinder (|y| <= h) and the two cap spheres'),
  {id: 'rigid-core.sweep.box-face', title: 'Box sweep onto a face: gap at the reported impact', quantity: 'gap y0 + f dy - half height at the reported fraction, 300 slanted sweeps (the one furthest from 5 mm)', unit: 'm', test: T.sweeps,
    reference: {formula: 'gap = +linear slop (a flat shape is stopped 5 mm short)', value: SLOP}, tolerance: absolute(2e-4),
    note: 'Box3D stops a swept shape without a radius one linear slop before the surface, so the reported fraction is early by 5 mm along the normal.',
    measure: async () => { const r = (await sweeps()).boxFace; return Math.abs(r.min - SLOP) > Math.abs(r.max - SLOP) ? r.min : r.max; }},
  {id: 'rigid-core.sweep.sphere-face', title: 'Sphere sweep onto a face: gap at the reported impact', quantity: 'gap y0 + f dy - r at the reported fraction (deepest of 300 slanted sweeps)', unit: 'm', test: T.sweeps,
    reference: {formula: 'gap = -linear slop (a rounded shape is stopped 5 mm inside)', value: -SLOP}, tolerance: absolute(2e-4),
    note: 'Box3D lets a swept shape with a radius encroach by its linear slop, so the reported fraction is late by 5 mm along the normal. Add or subtract the slop if you need the touching time.',
    measure: async () => (await sweeps()).sphereFace.min},
  {id: 'rigid-core.sweep.capsule-face', title: 'Capsule sweep onto a face: gap at the reported impact', quantity: 'gap y0 + f dy - h - r at the reported fraction (deepest of 300 slanted sweeps)', unit: 'm', test: T.sweeps,
    reference: {formula: 'gap = -linear slop', value: -SLOP}, tolerance: absolute(2e-4), measure: async () => (await sweeps()).capsuleFace.min},
  {id: 'rigid-core.sweep.sphere-sphere', title: 'Sphere sweep onto a sphere: deepest gap at the reported impact', quantity: 'gap |o + f d - c| - (R + r) at the reported fraction, 300 off-centre sweeps (deepest)', unit: 'm', test: T.sweeps,
    reference: {formula: 'gap >= -linear slop', value: -SLOP}, tolerance: lower(2e-4),
    note: 'Onto a curved surface the encroachment is between 3.8 mm and 5 mm, depending on how far off centre the sweep is.',
    measure: async () => (await sweeps()).sphereSphere.min},
  {id: 'rigid-core.sweep.sphere-sphere-early', title: 'Sphere sweep onto a sphere: never reported before touching', quantity: 'shallowest gap over the same 300 sweeps', unit: 'm', test: T.sweeps,
    reference: {formula: 'gap <= 0', value: 0}, tolerance: upper(0), measure: async () => (await sweeps()).sphereSphere.max},
  {id: 'rigid-core.sweep.capsule-sphere', title: 'Capsule sweep onto a sphere: deepest gap at the reported impact', quantity: 'gap between the lower cap and the sphere at the reported fraction (deepest of 300)', unit: 'm', test: T.sweeps,
    reference: {formula: 'gap = |cap centre - c| - (R + r) >= -linear slop', value: -SLOP}, tolerance: lower(2e-4), measure: async () => (await sweeps()).capsuleSphere.min},
  {id: 'rigid-core.overlap.sphere', title: 'Sphere overlap: count on a lattice', quantity: 'spheres of a 7 x 7 x 7 lattice (r = 0.1 m, 1 m apart) overlapping a 2.42 m query sphere', unit: 'bodies', test: T.overlaps,
    reference: {formula: 'N = #{lattice points with |p - q| <= R + r}', value: null}, tolerance: absolute(0), measure: async () => { const r = await overlaps(); return {value: r.sphere, reference: r.sphereExact}; }},
  {id: 'rigid-core.overlap.box', title: 'Box overlap: count on a lattice', quantity: 'lattice spheres overlapping a 3.46 x 1.9 x 4.66 m query box', unit: 'bodies', test: T.overlaps,
    reference: {formula: 'N = #{lattice points within r of the box}', value: null}, tolerance: absolute(0), measure: async () => { const r = await overlaps(); return {value: r.box, reference: r.boxExact}; }},
  {id: 'rigid-core.overlap.capsule', title: 'Capsule overlap: count on a lattice', quantity: 'lattice spheres overlapping an upright query capsule (r = 1.27 m, half length 1.6 m)', unit: 'bodies', test: T.overlaps,
    reference: {formula: 'N = #{lattice points within R + r of the axis segment}', value: null}, tolerance: absolute(0), measure: async () => { const r = await overlaps(); return {value: r.capsule, reference: r.capsuleExact}; }},
  {id: 'rigid-core.overlap.mask', title: 'Sphere overlap with a category mask', quantity: 'lattice spheres of category 2 (every other layer) overlapping the query sphere', unit: 'bodies', test: T.overlaps,
    reference: {formula: 'N = #{odd-layer lattice points with |p - q| <= R + r}', value: null}, tolerance: absolute(0), measure: async () => { const r = await overlaps(); return {value: r.masked, reference: r.maskedExact}; }},
  {id: 'rigid-core.overlap.bounds', title: 'Broad-phase candidates: count on a lattice', quantity: 'lattice spheres whose bounds meet the query box', unit: 'bodies', test: T.overlaps,
    reference: {formula: 'N = #{lattice points with |p_k - q_k| <= h_k + r on every axis}', value: null}, tolerance: absolute(0),
    measure: async () => { const r = await overlaps(); return {value: r.aabb, reference: r.aabbExact}; }},
  {id: 'rigid-core.ray.batch', title: 'Batched rays equal single rays', quantity: 'rays of 4,096 whose batched answer differs in any bit from the single-ray answer', unit: 'rays', test: T.batch,
    reference: {formula: 'raycastBatch(rays)[i] = raycast(rays[i])', value: 0}, tolerance: absolute(0),
    note: 'Boxes, spheres, capsules, hulls, a triangle mesh and a height field; static and moving bodies.', measure: async () => (await batch()).mismatches},
]);

const characterCases = defineCases('rigid-core', CHARACTER, [
  {id: 'rigid-core.character.speed', title: 'Character: speed on flat ground', quantity: 'mean speed over 3 s of walking, commanded 3 m/s', unit: 'm/s', test: TC.flat,
    reference: {formula: 'v = commanded speed', value: 3}, tolerance: relative(1e-3), measure: async () => (await flat()).speed},
  {id: 'rigid-core.character.feet', title: 'Character: feet on the floor', quantity: 'highest position of the feet above the floor while walking', unit: 'm', test: TC.flat,
    reference: {formula: 'y = 0', value: 0}, tolerance: absolute(1e-3), note: 'The capsule rests one linear slop (5 mm) inside the floor; the reported feet height adds it back.',
    measure: async () => (await flat()).feetMax},
  {id: 'rigid-core.character.slope-climbed', title: 'Character: steepest ramp climbed', quantity: 'steepest ramp climbed with maxSlopeDegrees 45, scanned in 0.5 degree steps', unit: 'deg', test: TC.slope,
    reference: {formula: 'theta <= maxSlopeDegrees', value: 45}, tolerance: absolute(0.75), measure: async () => (await slopeLimit(45)).steepestClimbed},
  {id: 'rigid-core.character.slope-refused', title: 'Character: shallowest ramp refused', quantity: 'shallowest ramp not climbed with maxSlopeDegrees 45', unit: 'deg', test: TC.slope,
    reference: {formula: 'theta >= maxSlopeDegrees', value: 45}, tolerance: absolute(0.75), measure: async () => (await slopeLimit(45)).shallowestRefused},
  {id: 'rigid-core.character.slope-limit-30', title: 'Character: steepest ramp climbed at a 30 degree limit', quantity: 'steepest ramp climbed with maxSlopeDegrees 30', unit: 'deg', test: TC.slope,
    reference: {formula: 'theta <= maxSlopeDegrees', value: 30}, tolerance: absolute(0.75), measure: async () => (await slopeLimit(30)).steepestClimbed},
  {id: 'rigid-core.character.slope-speed', title: 'Character: speed along a 42 degree ramp', quantity: 'speed along the ramp, commanded 2 m/s', unit: 'm/s', test: TC.slope,
    reference: {formula: 'v = commanded speed, along the surface', value: 2}, tolerance: relative(2e-3), measure: async () => (await slopeLimit(45)).rows.find(row => row.degrees === 42).alongSpeed},
  {id: 'rigid-core.character.step-climbed', title: 'Character: tallest ledge stepped onto', quantity: 'tallest ledge climbed with stepHeight 0.35 m, scanned in 5 mm steps', unit: 'm', test: TC.step,
    reference: {formula: 'h <= stepHeight', value: 0.35}, tolerance: absolute(0.006), measure: async () => (await stepLimit(0.35)).tallestClimbed},
  {id: 'rigid-core.character.step-refused', title: 'Character: lowest ledge refused', quantity: 'lowest ledge not climbed with stepHeight 0.35 m', unit: 'm', test: TC.step,
    reference: {formula: 'h > stepHeight', value: 0.35}, tolerance: absolute(0.011), measure: async () => (await stepLimit(0.35)).lowestRefused},
  {id: 'rigid-core.character.step-limit-20', title: 'Character: tallest ledge stepped onto at a 0.2 m step height', quantity: 'tallest ledge climbed with stepHeight 0.2 m', unit: 'm', test: TC.step,
    reference: {formula: 'h <= stepHeight', value: 0.2}, tolerance: absolute(0.006), measure: async () => (await stepLimit(0.2)).tallestClimbed},
  {id: 'rigid-core.character.stairs', title: 'Character: top of a flight of stairs', quantity: 'height reached on five stairs of 0.2 m', unit: 'm', test: TC.step,
    reference: {formula: 'y = n rise', value: 1}, tolerance: absolute(2e-3), measure: async () => (await stairs()).top},
  {id: 'rigid-core.character.stairs-down', title: 'Character: grounded down the stairs', quantity: 'steps of the way down five stairs spent in the air', unit: 'steps', test: TC.step,
    reference: {formula: 'grounded on every step', value: 0}, tolerance: absolute(0), measure: async () => (await stairs()).airborneDown},
  {id: 'rigid-core.character.jump-apex', title: 'Character: apex of a jump', quantity: 'height gained by a 5 m/s jump', unit: 'm', test: TC.jump,
    reference: {formula: 'h = v^2 / (2 g)', value: 25 / (2 * G)}, tolerance: absolute(1e-3), note: 'The vertical move of each step uses the mean of the speeds at its two ends, which is exact for constant gravity.',
    measure: async () => (await jump()).apex},
  {id: 'rigid-core.character.jump-time', title: 'Character: air time of a jump', quantity: 'time from take-off to landing, 5 m/s jump', unit: 's', test: TC.jump,
    reference: {formula: 't = 2 v / g', value: 10 / G}, tolerance: absolute(1 / HZ), note: 'Landing is detected at a step, so the time is known to one step (1/240 s).', measure: async () => (await jump()).airTime},
  {id: 'rigid-core.character.thin-wall', title: 'Character: a 1 cm wall at up to 300 m/s', quantity: 'furthest the capsule got past the near face of the wall, at 10, 50, 100 and 300 m/s (60 Hz moves)', unit: 'm', test: TC.wall,
    reference: {formula: 'x <= linear slop', value: SLOP}, tolerance: upper(1e-4), note: 'At 300 m/s one move is 5 m, five hundred times the wall thickness. The mover casts every translation; it stops one linear slop inside the face.',
    measure: async () => (await thinWall()).worst},
  {id: 'rigid-core.character.platform', title: 'Character: carried by a moving platform', quantity: 'speed of a standing character on a kinematic platform moving at 1.5 m/s along x', unit: 'm/s', test: TC.platform,
    reference: {formula: 'v = platform velocity', value: 1.5}, tolerance: relative(1e-3), measure: async () => (await platform()).carried[0]},
  {id: 'rigid-core.character.elevator', title: 'Character: lifted by a rising platform', quantity: 'height gained in 2 s on a platform rising at 1 m/s', unit: 'm', test: TC.platform,
    reference: {formula: 'dy = v t', value: null}, tolerance: relative(1e-3), measure: async () => { const r = await platform(); return {value: r.rise, reference: r.platformRise}; }},
  {id: 'rigid-core.character.push-light', title: 'Character: pushing a box below the force limit', quantity: 'speed of a box of half the limit mass, pushed by a character walking at 1.5 m/s', unit: 'm/s', test: TC.push,
    reference: {formula: 'v = walking speed, for m < F / (mu g)', value: 1.5}, tolerance: relative(0.02),
    note: 'maxPushForce 400 N, friction 0.5: the limit mass is 81.5 kg. Friction slows the box by mu g dt each step before the next push, hence the 0.9% lag.',
    measure: async () => (await push(0.5)).boxSpeed},
  {id: 'rigid-core.character.push-heavy', title: 'Character: stopped by a box above the force limit', quantity: 'speed of a box of twice the limit mass under the same push', unit: 'm/s', test: TC.push,
    reference: {formula: 'v = 0, for m > F / (mu g)', value: 0}, tolerance: absolute(0.015), measure: async () => (await push(2)).boxSpeed},
  {id: 'rigid-core.character.checkpoint', title: 'Character: exact resume from a checkpoint', quantity: 'steps of 1,150 after a restore that differ in any bit (world hash, character position, ground)', unit: 'steps', test: TC.checkpoint,
    reference: {formula: 'restored run = uninterrupted run', value: 0}, tolerance: absolute(0), measure: async () => (await characterCheckpoint()).mismatches},
]);

export default [...cases, ...characterCases];
