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

const CCD = 'packages/box3d-kit/test/v21-rigid-ccd.test.mjs';
const TD = {
  wall: 'a 5 cm ball against a 2 cm wall at 60 Hz: discrete stepping loses the shots the window model predicts, continuous collision loses none',
  bullet: 'the bullet flag: a ball passes through a thin free plate without it and is stopped with it, and momentum is conserved',
};
const wallShots = () => run('ccd/wall', (S, K) => S.bulletThroughWall(K));
const bulletShot = () => run('ccd/bullet', (S, K) => S.bulletAgainstDynamic(K));
const ccdCases = defineCases('rigid-core', CCD, [
  {id: 'rigid-core.ccd.wall-on', title: 'Continuous collision on: balls through a thin wall', quantity: '5 cm balls of 120 that end beyond a 2 cm static wall, 15 to 240 m/s at 60 Hz (0.25 to 4 m per step)', unit: 'balls', test: TD.wall,
    reference: {formula: 'none passes', value: 0}, tolerance: absolute(0), measure: async () => (await wallShots()).throughWithCcd},
  {id: 'rigid-core.ccd.wall-off', title: 'Continuous collision off: balls through the same wall', quantity: 'balls of 120 that end beyond the wall with the setting off', unit: 'balls', test: TD.wall,
    reference: {formula: 'N = sum over speeds of 24 (1 - (r + margin + thickness / 2) / (v dt)), margin = 4 linear slops', value: null}, tolerance: absolute(3),
    note: 'A discrete step stops the ball only if it ends with the centre between r + 2 cm before the near face (Box3D makes contacts 2 cm ahead) and the wall mid-plane. The start positions are spread evenly over one step of travel.',
    measure: async () => { const r = await wallShots(); return {value: r.throughWithout, reference: r.predictedWithout}; }},
  {id: 'rigid-core.ccd.bullet', title: 'Bullet against a free plate: common speed', quantity: 'speed of plate and ball after a 0.88 kg ball at 150 m/s hits a 160 kg plate, 2 cm thick (2.5 m per step)', unit: 'm/s', test: TD.bullet,
    reference: {formula: 'v = m u / (m + M), no restitution', value: null}, tolerance: relative(1e-3),
    measure: async () => { const r = (await bulletShot()).bullet; return {value: r.plateSpeed, reference: r.masses[0] * 150 / (r.masses[0] + r.masses[1])}; }},
  {id: 'rigid-core.ccd.bullet-momentum', title: 'Bullet against a free plate: momentum', quantity: 'total momentum after the impact', unit: 'kg m/s', test: TD.bullet,
    reference: {formula: 'p = m u', value: null}, tolerance: relative(1e-4), measure: async () => { const r = (await bulletShot()).bullet; return {value: r.momentumAfter, reference: r.momentumBefore}; }},
  {id: 'rigid-core.ccd.no-bullet', title: 'Without the bullet flag the ball passes the free plate', quantity: 'speed of the plate after the same shot without the flag', unit: 'm/s', test: TD.bullet,
    reference: {formula: 'v = 0 (the ball is never in contact)', value: 0}, tolerance: absolute(1e-6),
    note: 'Continuous collision covers dynamic bodies against static ones. Between two moving bodies it runs only when one is a bullet.', measure: async () => (await bulletShot()).plain.plateSpeed},
]);

const VEHICLE = 'packages/box3d-kit/test/v21-rigid-vehicle.test.mjs';
const TV = {
  sag: 'static sag: each spring is compressed by its wheel load over the stiffness, M g / (4 k), and by the axle loads when the centre of mass is forward',
  heave: 'heave: the chassis bounces at sqrt(4 k / M) / (2 pi), and dampers give zeta = 4 c / (2 sqrt(4 k M))',
  top: 'top speed: drive torque against drag balances at sqrt(8 tau / (R rho CdA)), approached from below and from above',
  turn: 'turning circle: at low speed the rear axle turns about L / tan(delta), with Ackermann angles on the front wheels',
  brake: 'braking: with locked wheels the car stops in v^2 / (2 mu g)',
  terrain: 'terrain and checkpoints: a drive over a height field stays upright, and the world checkpoint with the vehicle state resumes it bit for bit',
};
const sag = () => run('vehicle/sag', (S, K) => S.vehicleSag(K));
const heave = (key, options) => run(`vehicle/heave/${key}`, (S, K) => S.vehicleHeave(K, options));
const topSpeed = () => run('vehicle/top', (S, K) => S.vehicleTopSpeed(K));
const turning = () => run('vehicle/turn', (S, K) => S.vehicleTurning(K, {delta: 0.25, speed: 3}));
const braking = () => run('vehicle/brake', (S, K) => S.vehicleBraking(K));
const terrain = () => run('vehicle/terrain', (S, K) => S.vehicleTerrainCheckpoint(K));
const vehicleCases = defineCases('rigid-core', VEHICLE, [
  {id: 'rigid-core.vehicle.sag', title: 'Vehicle: static sag', quantity: 'spring compression of a 1,200 kg chassis on four 60 kN/m springs', unit: 'm', test: TV.sag,
    reference: {formula: 's = M g / (4 k)', value: 1200 * G / (4 * 60000)}, tolerance: relative(1e-3), measure: async () => (await sag()).even[0]},
  {id: 'rigid-core.vehicle.sag-front', title: 'Vehicle: front sag with the centre of mass 0.4 m forward', quantity: 'front spring compression, wheelbase 2.6 m', unit: 'm', test: TV.sag,
    reference: {formula: 's = M g (1/2 + x / L) / (2 k)', value: 1200 * G * (0.5 + 0.4 / 2.6) / (2 * 60000)}, tolerance: relative(5e-3),
    note: 'The chassis pitches by 0.012 rad, which the statics of the formula leave out.', measure: async () => (await sag()).nose[0]},
  {id: 'rigid-core.vehicle.sag-rear', title: 'Vehicle: rear sag with the centre of mass 0.4 m forward', quantity: 'rear spring compression', unit: 'm', test: TV.sag,
    reference: {formula: 's = M g (1/2 - x / L) / (2 k)', value: 1200 * G * (0.5 - 0.4 / 2.6) / (2 * 60000)}, tolerance: relative(5e-3), measure: async () => (await sag()).nose[2]},
  {id: 'rigid-core.vehicle.heave', title: 'Vehicle: heave frequency', quantity: 'bounce frequency of a 1,200 kg chassis on four undamped 60 kN/m springs', unit: 'Hz', test: TV.heave,
    reference: {formula: 'f = sqrt(4 k / M) / (2 pi)', value: Math.sqrt(4 * 60000 / 1200) / (2 * Math.PI)}, tolerance: relative(0.015),
    note: 'The tyre contact is a stiff spring in series with the suspension (Box3D contacts are soft constraints), which lowers the frequency by 0.8% here.',
    measure: async () => (await heave('stiff', {})).frequency},
  {id: 'rigid-core.vehicle.heave-soft', title: 'Vehicle: heave frequency of a soft car', quantity: 'bounce frequency of an 800 kg chassis on four undamped 20 kN/m springs', unit: 'Hz', test: TV.heave,
    reference: {formula: 'f = sqrt(4 k / M) / (2 pi)', value: Math.sqrt(4 * 20000 / 800) / (2 * Math.PI)}, tolerance: relative(0.015), measure: async () => (await heave('soft', {mass: 800, stiffness: 20000})).frequency},
  {id: 'rigid-core.vehicle.damping', title: 'Vehicle: suspension damping ratio', quantity: 'damping ratio of the bounce with four 2 kN s/m dampers, from the logarithmic decrement', unit: '1', test: TV.heave,
    reference: {formula: 'zeta = 4 c / (2 sqrt(4 k M))', value: 4 * 2000 / (2 * Math.sqrt(4 * 60000 * 1200))}, tolerance: absolute(0.02),
    note: 'The implicit integration of the spring adds a damping ratio of about 0.018 at 240 Hz with 4 sub-steps (measured with the dampers at zero).',
    measure: async () => (await heave('damped', {damping: 2000})).zeta},
  {id: 'rigid-core.vehicle.top-speed', title: 'Vehicle: top speed against drag', quantity: 'steady speed with 40 N m on each of four wheels, CdA = 1.2 m^2 (approached from below)', unit: 'm/s', test: TV.top,
    reference: {formula: 'v = sqrt(8 tau / (R rho CdA))', value: Math.sqrt(8 * 40 / (0.35 * 1.225 * 1.2))}, tolerance: relative(0.01),
    note: 'The wheels roll on a slightly smaller radius than R (the contact sinks by millimetres), so the thrust tau / R is a little higher and the speed 0.2% to 0.4% above the formula.',
    measure: async () => (await topSpeed()).below},
  {id: 'rigid-core.vehicle.top-speed-above', title: 'Vehicle: top speed, approached from above', quantity: 'the same car started 5% above the balance speed, after 45 s', unit: 'm/s', test: TV.top,
    reference: {formula: 'v = sqrt(8 tau / (R rho CdA))', value: Math.sqrt(8 * 40 / (0.35 * 1.225 * 1.2))}, tolerance: relative(0.01), measure: async () => (await topSpeed()).above},
  {id: 'rigid-core.vehicle.turning', title: 'Vehicle: turning radius', quantity: 'radius of the rear axle path at 3 m/s with a 0.25 rad bicycle angle, wheelbase 2.6 m (speed over yaw rate)', unit: 'm', test: TV.turn,
    reference: {formula: 'R = L / tan(delta)', value: 2.6 / Math.tan(0.25)}, tolerance: relative(0.01), note: 'Lateral acceleration 0.88 m/s^2; at higher speeds the tyres slip and the circle widens.',
    measure: async () => (await turning()).radius},
  {id: 'rigid-core.vehicle.turning-path', title: 'Vehicle: turning radius of the path', quantity: 'radius of the circle fitted to the rear axle path over 20 s', unit: 'm', test: TV.turn,
    reference: {formula: 'R = L / tan(delta)', value: 2.6 / Math.tan(0.25)}, tolerance: relative(0.01), measure: async () => (await turning()).fitted},
  {id: 'rigid-core.vehicle.ackermann', title: 'Vehicle: inner wheel angle', quantity: 'steering angle of the inner front wheel, track 1.6 m', unit: 'rad', test: TV.turn,
    reference: {formula: 'atan(L / (L / tan(delta) - T / 2))', value: Math.atan(2.6 / (2.6 / Math.tan(0.25) - 0.8))}, tolerance: absolute(2e-3), measure: async () => (await turning()).angles[0]},
  {id: 'rigid-core.vehicle.braking', title: 'Vehicle: braking distance with locked wheels', quantity: 'stopping distance from 20 m/s on a road of friction 0.8', unit: 'm', test: TV.brake,
    reference: {formula: 'd = v^2 / (2 mu g)', value: null}, tolerance: relative(0.01), measure: async () => { const r = await braking(); return {value: r.distance, reference: r.exact}; }},
  {id: 'rigid-core.vehicle.checkpoint', title: 'Vehicle: exact resume from a checkpoint', quantity: 'steps of 1,500 of a drive over a height field that differ in any bit after a restore', unit: 'steps', test: TV.terrain,
    reference: {formula: 'restored run = uninterrupted run', value: 0}, tolerance: absolute(0), measure: async () => (await terrain()).mismatches},
]);

const JOINTS = 'packages/box3d-kit/test/v21-rigid-joints.test.mjs';
const TJ = {
  weld: 'a breakable weld breaks when the force, or the torque, it carries reaches its threshold',
  overload: 'a threshold without `breakable` reports joint-overload in every step it is exceeded, and the joint stays',
  motor: 'motor joint: velocity drives ramp at F / m and torque / I and hold their targets; springs oscillate at their frequency',
  sag: 'motor joint spring under gravity: the sag is g / (2 pi f)^2 whatever the mass',
  parallel: 'parallel joint: a tilted body swings about the aligned axis at the spring frequency',
  filter: 'filter joint: the two bodies pass through each other, and collide again as soon as it is removed',
  checkpoint: 'checkpoints and replay hold breakable flags, thresholds, drives, bullets and world settings: a weld breaks at the same tick after a restore',
};
const breakForce = () => run('joints/break-force', (S, K) => S.breakableWeld(K));
const breakTorque = () => run('joints/break-torque', (S, K) => S.breakableWeld(K, {arm: 0.5, threshold: 100}));
const overload = () => run('joints/overload', (S, K) => S.overloadEvents(K));
const motor = () => run('joints/motor', (S, K) => S.motorJoint(K));
const motorSag = () => run('joints/sag', (S, K) => S.motorSpringSag(K));
const parallel = () => run('joints/parallel', (S, K) => S.parallelJoint(K));
const filterJoint = () => run('joints/filter', (S, K) => S.filterJoint(K));
const jointCheckpoint = () => run('joints/checkpoint', (S, K) => S.jointCheckpoint(K));
const jointCases = defineCases('rigid-core', JOINTS, [
  {id: 'rigid-core.joint.break-force', title: 'Breakable weld: breaking force', quantity: 'load on a weld (weight plus a force growing at 60 N/s) in the step it broke, threshold 500 N', unit: 'N', test: TJ.weld,
    reference: {formula: 'F = force threshold', value: 500}, tolerance: absolute(0.75), note: 'The load grows by 0.25 N per step; the weld breaks in the first step in which the solver sees the threshold reached.',
    measure: async () => (await breakForce()).load},
  {id: 'rigid-core.joint.break-force-held', title: 'Breakable weld: whole below the threshold', quantity: 'load the weld carried one step before it broke', unit: 'N', test: TJ.weld,
    reference: {formula: 'F < force threshold + two ramp steps', value: 500}, tolerance: upper(0.5), measure: async () => (await breakForce()).carriedBefore},
  {id: 'rigid-core.joint.break-torque', title: 'Breakable weld: breaking torque', quantity: 'moment about a weld holding a block 0.5 m to the side, in the step it broke, threshold 100 N m', unit: 'N m', test: TJ.weld,
    reference: {formula: 'M = (m g + F) a = torque threshold', value: 100}, tolerance: absolute(0.375), measure: async () => (await breakTorque()).load},
  {id: 'rigid-core.joint.reaction', title: 'Weld: reported reaction force', quantity: 'force the weld reports one step before it broke, against the load it carried', unit: 'N', test: TJ.weld,
    reference: {formula: 'F = m g + applied force', value: null}, tolerance: relative(2e-3), measure: async () => { const r = await breakForce(); return {value: r.reported, reference: r.carriedBefore}; }},
  {id: 'rigid-core.joint.overload-events', title: 'Joint events: one per step over the threshold', quantity: 'joint-overload events while a weld carries 2.5 weights against a threshold of 2 for 120 steps', unit: 'events', test: TJ.overload,
    reference: {formula: 'N = steps over the threshold', value: 120}, tolerance: absolute(0), measure: async () => (await overload()).loud},
  {id: 'rigid-core.joint.overload-quiet', title: 'Joint events: none below the threshold', quantity: 'joint-overload events in the 240 steps the weld carries one weight', unit: 'events', test: TJ.overload,
    reference: {formula: 'N = 0', value: 0}, tolerance: absolute(0), measure: async () => { const r = await overload(); return r.quiet + r.after; }},
  {id: 'rigid-core.joint.motor-ramp', title: 'Motor joint: time to reach the velocity target', quantity: 'time for a 65 kg body to reach 3 m/s under a 200 N velocity drive', unit: 's', test: TJ.motor,
    reference: {formula: 't = m v / F', value: null}, tolerance: absolute(2 / HZ), measure: async () => { const r = await motor(); return {value: r.reachedAt, reference: r.rampTime}; }},
  {id: 'rigid-core.joint.motor-speed', title: 'Motor joint: held velocity', quantity: 'speed 3 s after the target was reached', unit: 'm/s', test: TJ.motor,
    reference: {formula: 'v = target', value: 3}, tolerance: relative(1e-4), measure: async () => (await motor()).held},
  {id: 'rigid-core.joint.motor-spin', title: 'Motor joint: time to reach the spin target', quantity: 'time for a sphere to reach 4 rad/s under a 3 N m drive', unit: 's', test: TJ.motor,
    reference: {formula: 't = I w / tau, I = 2 m r^2 / 5', value: null}, tolerance: absolute(2 / HZ), measure: async () => { const r = await motor(); return {value: r.spinReachedAt, reference: r.spinRampTime}; }},
  {id: 'rigid-core.joint.motor-spring', title: 'Motor joint: spring period', quantity: 'period of a body on an undamped 1.5 Hz linear spring, mean over 6 s', unit: 's', test: TJ.motor,
    reference: {formula: 'T = 1 / f', value: 1 / 1.5}, tolerance: relative(2e-3), note: 'The spring is integrated implicitly: the period holds, the amplitude falls to 63% in 6 s (a numerical damping ratio of 0.008).',
    measure: async () => (await motor()).period},
  {id: 'rigid-core.joint.motor-critical', title: 'Motor joint: critically damped return', quantity: 'displacement one period after release from 0.4 m, damping ratio 1', unit: 'm', test: TJ.motor,
    reference: {formula: 'x = x0 (1 + w t) exp(-w t), w = 2 pi f', value: null}, tolerance: absolute(2e-3), measure: async () => { const r = await motor(); return {value: r.dampedX, reference: r.dampedExact}; }},
  {id: 'rigid-core.joint.motor-sag', title: 'Motor joint: spring sag under gravity', quantity: 'sag of a 512 kg body on a 2 Hz spring', unit: 'm', test: TJ.sag,
    reference: {formula: 's = g / (2 pi f)^2, whatever the mass', value: G / (2 * Math.PI * 2) ** 2}, tolerance: relative(2e-3), measure: async () => (await motorSag()).sags[1]},
  {id: 'rigid-core.joint.parallel', title: 'Parallel joint: swing period', quantity: 'period of a ball released 0.2 rad from the aligned axis on an undamped 1 Hz spring', unit: 's', test: TJ.parallel,
    reference: {formula: 'T = 1 / f', value: 1}, tolerance: relative(3e-3), measure: async () => (await parallel()).period},
  {id: 'rigid-core.joint.filter', title: 'Filter joint: overlapping bodies do not collide', quantity: 'distance between two overlapping 1 m boxes after 1 s with a filter joint', unit: 'm', test: TJ.filter,
    reference: {formula: 'd = initial distance', value: 0.4}, tolerance: absolute(1e-6), measure: async () => (await filterJoint()).filtered.distance},
  {id: 'rigid-core.joint.filter-removed', title: 'Filter joint: collision resumes on removal', quantity: 'distance 1 s after the joint is removed, against two boxes that never had one', unit: 'm', test: TJ.filter,
    reference: {formula: 'd = distance without the joint', value: null}, tolerance: absolute(1e-3), measure: async () => { const r = await filterJoint(); return {value: r.filtered.afterRemoval, reference: r.plain.distance}; }},
  {id: 'rigid-core.joint.checkpoint-break', title: 'Checkpoint: a weld breaks at the same tick after a restore', quantity: 'tick at which a loaded breakable weld broke in a world restored 736 ticks earlier', unit: 'ticks', test: TJ.checkpoint,
    reference: {formula: 'tick of the uninterrupted run', value: null}, tolerance: absolute(0), measure: async () => { const r = await jointCheckpoint(); return {value: r.brokeB, reference: r.brokeA}; }},
  {id: 'rigid-core.joint.checkpoint', title: 'Checkpoint: joints, thresholds, drives and settings resume exactly', quantity: 'steps of 1,440 after a restore that differ in any bit', unit: 'steps', test: TJ.checkpoint,
    reference: {formula: 'restored run = uninterrupted run', value: 0}, tolerance: absolute(0), measure: async () => (await jointCheckpoint()).mismatches},
]);

const CONTROLS = 'packages/box3d-kit/test/v21-rigid-controls.test.mjs';
const TW = {
  explosion: 'explosion: a sphere takes P pi r^2 / m, half of it half way across the falloff, nothing beyond; a box takes P times its facing area',
  settings: 'world settings: sleeping, restitution and hit thresholds, the speed limit and motion locks do what they say',
  push: 'contact push-out speed: an embedded ball leaves the ground at the set speed and no faster',
  intro: 'profile, counters, contact statistics and debug lines of a known scene are exact',
};
const explosion = () => run('controls/explosion', (S, K) => S.explosion(K));
const settings = () => run('controls/settings', (S, K) => S.worldSettings(K));
const pushOut = () => run('controls/push', (S, K) => S.pushOutSpeed(K));
const introspection = () => run('controls/introspection', (S, K) => S.introspection(K));
const controlCases = defineCases('rigid-core', CONTROLS, [
  {id: 'rigid-core.explosion.sphere', title: 'Explosion: speed given to a sphere', quantity: 'speed of a 0.2 m sphere inside the radius, 50 N s/m^2', unit: 'm/s', test: TW.explosion,
    reference: {formula: 'v = P pi r^2 / m', value: null}, tolerance: relative(1e-5), measure: async () => { const r = await explosion(); return {value: r.near, reference: r.exactNear}; }},
  {id: 'rigid-core.explosion.falloff', title: 'Explosion: half way across the falloff', quantity: 'speed of the same sphere with its surface half way across the falloff', unit: 'm/s', test: TW.explosion,
    reference: {formula: 'v = (1/2) P pi r^2 / m', value: null}, tolerance: relative(1e-5), measure: async () => { const r = await explosion(); return {value: r.mid, reference: r.exactMid}; }},
  {id: 'rigid-core.explosion.box', title: 'Explosion: speed given to a box face-on', quantity: 'speed of a box showing a 0.6 x 0.8 m face', unit: 'm/s', test: TW.explosion,
    reference: {formula: 'v = P A / m', value: null}, tolerance: relative(1e-5), measure: async () => { const r = await explosion(); return {value: r.box, reference: r.exactBox}; }},
  {id: 'rigid-core.settings.restitution', title: 'Restitution above the threshold: bounce height', quantity: 'bounce of a ball dropped 0.2 m with restitution 0.5 (lands at 1.98 m/s, threshold 1 m/s)', unit: 'm', test: TW.settings,
    reference: {formula: 'h = e^2 h0', value: 0.05}, tolerance: relative(0.05), note: 'At 240 Hz the ball lands up to one step before or after the ground plane, which is 3% of this small drop.',
    measure: async () => (await settings()).bounce},
  {id: 'rigid-core.settings.restitution-off', title: 'Restitution below the threshold: no bounce', quantity: 'bounce of the same drop with the threshold at 3 m/s', unit: 'm', test: TW.settings,
    reference: {formula: 'h = 0', value: 0}, tolerance: absolute(1e-4), measure: async () => (await settings()).bounceBelow},
  {id: 'rigid-core.settings.hit-speed', title: 'Hit event: approach speed', quantity: 'approach speed reported for a 0.2 m drop', unit: 'm/s', test: TW.settings,
    reference: {formula: 'v = sqrt(2 g h)', value: Math.sqrt(2 * G * 0.2)}, tolerance: relative(0.02), measure: async () => (await settings()).hitSpeed},
  {id: 'rigid-core.settings.speed-limit', title: 'Maximum linear speed', quantity: 'speed of a body after an impulse of 1e6 N s with the limit at 20 m/s', unit: 'm/s', test: TW.settings,
    reference: {formula: 'v = limit', value: 20}, tolerance: relative(1e-5), measure: async () => (await settings()).limited},
  {id: 'rigid-core.settings.push-speed', title: 'Contact push-out speed', quantity: 'fastest speed at which a ball embedded 0.3 m in the ground is pushed out, setting 0.5 m/s', unit: 'm/s', test: TW.push,
    reference: {formula: 'v = contactPushSpeed', value: 0.5}, tolerance: relative(0.01), measure: async () => (await pushOut())[1].fastest},
  {id: 'rigid-core.settings.push-speed-default', title: 'Contact push-out speed, default', quantity: 'the same at the default setting of 3 m/s', unit: 'm/s', test: TW.push,
    reference: {formula: 'v = contactPushSpeed', value: 3}, tolerance: relative(0.01), measure: async () => (await pushOut())[0].fastest},
  {id: 'rigid-core.stats.normal-force', title: 'Contact statistics: force carried by 16 stacks of three boxes', quantity: 'sum of the normal forces of all contact points', unit: 'N', test: TW.intro,
    reference: {formula: 'F = 16 (3 + 2 + 1) m g', value: null}, tolerance: relative(1e-3), measure: async () => { const r = await introspection(); return {value: r.normalForce, reference: r.exactNormalForce}; }},
  {id: 'rigid-core.stats.contacts', title: 'Counters: contacts of 16 stacks of three boxes', quantity: 'contact pairs the solver holds', unit: 'pairs', test: TW.intro,
    reference: {formula: 'N = 16 x 3', value: 48}, tolerance: absolute(0), measure: async () => (await introspection()).stats.pairs},
  {id: 'rigid-core.stats.penetration', title: 'Resting contacts: deepest overlap', quantity: 'deepest contact overlap of the stacks at rest', unit: 'm', test: TW.intro,
    reference: {formula: 'depth <= linear slop', value: SLOP}, tolerance: upper(0), measure: async () => (await introspection()).stats.deepestPenetration},
  {id: 'rigid-core.debug.bounds', title: 'Debug draw: bounds', quantity: 'line vertices for the bounds of 50 shapes', unit: 'vertices', test: TW.intro,
    reference: {formula: 'N = 50 x 12 edges x 2', value: 1200}, tolerance: absolute(0), measure: async () => (await introspection()).boundsVertices},
  {id: 'rigid-core.debug.contacts', title: 'Debug draw: contact points', quantity: 'line vertices for 192 contact points', unit: 'vertices', test: TW.intro,
    reference: {formula: 'N = 192 x 3 lines x 2', value: 1152}, tolerance: absolute(0), measure: async () => (await introspection()).contactVertices},
]);

export default [...cases, ...characterCases, ...ccdCases, ...vehicleCases, ...jointCases, ...controlCases];
