// Shows native defect ND-7 (docs/RIGID_CORE.md): a mechanism that moves in one plane steps several times more slowly
// while quantities that should be zero are rounding noise small enough for their products to be subnormal floats.
//
//   npm run build && node scripts/bench-subnormal.mjs [blocks]
//
// The scene is a container crane of five bodies: a boom on a motorised hinge, a trolley on a prismatic joint, a sheave
// block on a hinge under it and a load on a second prismatic joint; everything moves in the x-y plane. The sheave block is
// a compound with one child: a capsule along z, a box, or a sphere. Each variant runs twice: with gravity straight down,
// and with gravity tilted by 0.1 % out of the plane, which makes the out-of-plane velocities ordinary numbers instead of
// rounding noise. The step time is printed per block of 2,000 steps (after 3,000 steps of warm-up).
//
// Measured 2026-11-23, Node 22.23 on x86-64, microseconds per step in nine blocks:
//   capsule  straight 45 39 41 44 45 46 46 51 54     tilted 17 19 29 24 17 17 17 16 16
//   box      straight 20 20 56 216 303 302 336 290 301   tilted 29 22 21 27 22 27 24 26 26
//   sphere   straight 19 18 17 17 16 16 17 15 15     tilted 16 15 15 16 21 22 26 18 16
import {createWorld, axisRotation} from '../dist/index.js';

const blocks = Math.max(1, Number(process.argv[2] ?? 9));
const P = ([x, y, z]) => [x, z, -y];                                 // the drawing is z-up, the world y-up
const FALL_X = 44 - 1.104, SHEAVE_Z = 53.733;
const SQRT_HALF = Math.SQRT1_2;

async function crane(child, gravity) {
  const world = await createWorld({step: 1 / 60, subSteps: 4, interpolate: false, gravity, ground: false});
  const box = (center, size, density, friction) => ({shape: {kind: 'box', halfExtents: P(size).map(v => Math.abs(v) / 2)}, position: P(center), density, friction});
  const body = (type, position, shapes, extra = {}) => world.createBody({type, position: P(position), neverSleeps: type === 'dynamic', shape: {kind: 'compound', shapes}, ...extra});
  const portal = body('static', [0, 0, 0], [box([10, 0, -1], [120, 40, 2], 1000, 0.75)]);
  const boom = body('dynamic', [2, 0, 52], [box([31.5, 0, 0.75], [63, 9, 0.2], 500, 0.22)], {angularDamping: 0.1});
  const trolley = body('dynamic', [44, 0, 53.16], [box([-1.104, 0, 0], [6.4, 10, 0.6], 287.5, 0.2)], {linearDamping: 0.12});
  const block = body('dynamic', [FALL_X, 0, SHEAVE_Z], [
    child === 'capsule' ? {shape: {kind: 'capsule', radius: 0.75, halfLength: 4}, position: [0, 0, 0], rotation: [-SQRT_HALF, 0, 0, SQRT_HALF], density: 694, friction: 0.2}
      : child === 'box' ? box([0, 0, 0], [1.5, 9.5, 1.5], 694, 0.2)
        : {shape: {kind: 'sphere', radius: 0.75}, position: [0, 0, 0], density: 694, friction: 0.2}]);
  const load = body('dynamic', [44, 0, 6.055], [box([-1.104, 0, 0], [12.6, 3, 5.1], 460, 0.48)], {linearDamping: 0.1});
  const at = (point, origin, rotation) => ({position: P(point.map((v, i) => v - origin[i])), rotation});
  let q = axisRotation(P([0, -1, 0]));
  world.createJoint({type: 'revolute', bodyA: portal, bodyB: boom, frameA: at([2, 0, 52], [0, 0, 0], q), frameB: at([2, 0, 52], [2, 0, 52], q), limits: {lower: 0, upper: 80 * Math.PI / 180}, motor: {speed: 0.12 * Math.PI * 2 / 60, maxForce: 78e6}});
  q = axisRotation(P([1, 0, 0]), 'x');
  world.createJoint({type: 'prismatic', bodyA: boom, bodyB: trolley, frameA: at([FALL_X, 0, 53.16], [2, 0, 52], q), frameB: at([FALL_X, 0, 53.16], [44, 0, 53.16], q), limits: {lower: -38, upper: 17}, motor: {speed: -0.45, maxForce: 1.1e6}});
  q = axisRotation(P([0, 1, 0]));
  world.createJoint({type: 'revolute', bodyA: trolley, bodyB: block, frameA: at([FALL_X, 0, SHEAVE_Z], [44, 0, 53.16], q), frameB: at([FALL_X, 0, SHEAVE_Z], [FALL_X, 0, SHEAVE_Z], q)});
  q = axisRotation(P([0, 0, -1]), 'x');
  world.createJoint({type: 'prismatic', bodyA: load, bodyB: block, frameA: at([FALL_X, 0, SHEAVE_Z], [44, 0, 6.055], q), frameB: at([FALL_X, 0, SHEAVE_Z], [FALL_X, 0, SHEAVE_Z], q), limits: {lower: 0, upper: 35}, motor: {speed: 0.25, maxForce: 1.2e6}});
  return world;
}

for (const child of ['capsule', 'box', 'sphere']) for (const [label, gravity] of [['straight', [0, -9.80665, 0]], ['tilted  ', [0.01, -9.80665, 0.01]]]) {
  const world = await crane(child, gravity);
  for (let i = 0; i < 3000; i++) world.step();
  const times = [];
  for (let b = 0; b < blocks; b++) { const t0 = performance.now(); for (let i = 0; i < 2000; i++) world.step(); times.push((performance.now() - t0) / 2); }
  console.log(`${child.padEnd(8)} gravity ${label} microseconds per step: ${times.map(t => t.toFixed(0)).join(' ')}`);
  world.dispose();
}
