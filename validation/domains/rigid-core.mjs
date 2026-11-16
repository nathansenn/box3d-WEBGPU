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
  const [S, index] = await Promise.all([import(pathToFileURL(path.join(ROOT, 'packages/box3d-kit/test/rigid-core-scenarios.mjs')).href), kit('index')]);
  return {S, K: index};
});
/** Runs one scenario once, whatever number of rows read it. */
const run = (key, call) => memo(`rigid-core/${key}`, async () => { const {S, K} = await modules(); return call(S, K); });

const rays = kind => run(`rays/${kind}`, (S, K) => S.rayAccuracy(K, kind));
const sweeps = () => run('sweeps', (S, K) => S.sweepAccuracy(K));
const overlaps = () => run('overlaps', (S, K) => S.overlapCounts(K));
const batch = () => run('batch', (S, K) => S.batchAgreement(K));

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

export default cases;
