# Rigid core

The rigid-body engine is Box3D v0.1.0 compiled to WebAssembly behind a small C bridge (`wasm/box3d_web.c`). This
document covers what the bridge exposes beyond bodies, shapes and the six basic joints: scene queries, the capsule
character, continuous collision, vehicles, motor and breakable joints, world controls, the step profile, debug
drawing, and what was measured at scale. Bodies, shapes, joints and events are in
[`packages/box3d-kit/README.md`](../packages/box3d-kit/README.md); exact checkpoints are in
[`CHECKPOINTS.md`](CHECKPOINTS.md); the scene format is in [`SCENE_FORMAT.md`](SCENE_FORMAT.md).

Every feature runs end to end: bridge export → `NativeWorldBackend` (`src/engine/native-world.ts`) →
`PhysicsWorld` (`packages/box3d-kit/src/world.ts`) → `RemoteWorld` (worker) → recording and replay where the call
changes the world → checkpoints. The world API version is still 1: every export below is optional, and an
artifact built before it reports `UNSUPPORTED_BACKEND` for the calls that need it
(`NativeWorldBackend.supportsRigidCore`).

Units are SI. Numbers under "Measured" are from `npm run validation:report`
([`VALIDATION.md`](VALIDATION.md), domain *Rigid core*), on one machine, with the tolerance each row is held to.

## 1. Scene queries

| Call (`PhysicsWorld`) | What it returns |
|---|---|
| `raycast(origin, translation, options?)` | Closest hit: body, point, unit normal, fraction of the translation, triangle index for meshes and height fields. |
| `raycastAll(origin, translation, options?)` | Every hit, nearest first, up to `limit` (default 32, at most 256). |
| `raycastBatch(rays, filter?)` | Closest hit of each of up to 65,536 rays in **one call into the engine**. `rays` is a flat list, 6 numbers per ray (origin, translation). Results are flat arrays indexed by ray: `fractions` (−1 for a miss), `points`, `normals`, `triangles`, `bodies`. |
| `sphereCast`, `boxCast`, `capsuleCast` | Closest hit of a swept sphere, axis-aligned box or upright capsule. |
| `overlapSphere`, `overlapBox`, `overlapCapsule` | Bodies whose shapes overlap the query shape. |
| `world.native.queryBatch(queries)` | Up to 128 mixed queries per call, each with up to 256 hits, including `'aabb-candidates'` (broad-phase bounds only). |

Filters (`options.filter`, or the second argument of `raycastBatch`): `bodies: 'all' | 'static' | 'dynamic' | 'none'`
(`'dynamic'` includes kinematic bodies), `categoryBits` and `maskBits` (64-bit, as bigints), and `ignoreBody`.
Queries read the world only: a world that was queried steps bit-identically to one that was not (tested).

```js
// A 64 x 64 depth scan from a sensor, one engine call.
const rays = new Float32Array(64 * 64 * 6);
for (let j = 0, k = 0; j < 64; j++) for (let i = 0; i < 64; i++) {
  rays.set(sensorPosition, k); rays.set(direction(i, j).map(c => c * 50), k + 3); k += 6;   // 50 m range
}
const scan = world.raycastBatch(rays, {ignoreBody: sensorBody});
for (let n = 0; n < scan.count; n++) depth[n] = scan.fractions[n] < 0 ? Infinity : scan.fractions[n] * 50;
```

**Translations are whole displacements**, not directions: a ray from `o` along `d` ends at `o + d`, and a hit at
fraction `f` is at `o + f d`.

### What a sweep's fraction means

Box3D does not report the instant of first touch. A swept shape **without a radius** (a box) is stopped one
*linear slop* (5 mm) **before** the surface; a shape **with a radius** (sphere, capsule) is allowed to go up to one
slop **inside** it (exactly 5 mm onto a flat face, 3.8 mm to 5 mm onto a curved one). The reported hit point and
normal are those of that position. If you need the touching time, correct the fraction by
`0.005 / (|translation| cos(angle between translation and normal))`. A sweep that starts overlapping reports
fraction 0 and a zero normal.

### Measured

| Quantity | Measured | Held to |
|---|---|---|
| Ray against a sphere: hit point, 2,000 rays from every side | 3.2e-6 m | ≤ 5e-5 m |
| Ray against an oriented box: hit point | 1.7e-5 m | ≤ 5e-5 m |
| Ray against an oriented capsule: hit point | 2.8e-5 m | ≤ 5e-5 m |
| Unit normal, all three | ≤ 8.8e-6 | ≤ 1e-4 |
| Rays on which the engine and the closed form disagree about hitting (rays within 2 mm of grazing left out) | 0 of 5,978 | 0 |
| Box sweep onto a face: gap at the reported impact | +4.95 mm … +5.00 mm | 5 mm ± 0.2 mm |
| Sphere and capsule sweeps onto a face | −5.00 mm | −5 mm ± 0.2 mm |
| Sphere and capsule sweeps onto a sphere, off centre | −5.00 mm … −3.77 mm | within [−5.2 mm, 0] |
| Overlap counts on a 7 × 7 × 7 lattice: sphere, box, capsule, category mask, broad-phase bounds | 67, 40, 30, 33, 40: all exact | exact |
| `raycastBatch` against 4,096 single `raycast` calls (boxes, spheres, capsules, hulls, a mesh, a height field) | 0 rays differ in any bit | 0 |

One `raycastBatch` call for 4,096 rays took 18 ms against 134 ms for 4,096 `raycast` calls (Node 22, a loaded
4-core machine; a timing, not a validated number).

### Limits

- Query boxes are axis aligned and query capsules upright. Rotated query shapes are not exposed.
- `raycastBatch` returns the closest hit only; use `raycastAll` or `queryBatch` for all hits.
- When two bodies are hit at exactly the same fraction, the one with the smaller handle is reported, in every
  ray call, so the answer does not depend on tree order.
- Queries against meshes, height fields, hulls and compounds have no closed-form row; they are covered by the
  bit-for-bit agreement of the batched and single calls.

## 2. Character controller

`CapsuleCharacterController` (`box3d-webgpu-kit/gameplay`; source `src/engine/character-controller.ts`) is a capsule
moved by Box3D's character mover, the way the upstream character sample does it: gather the collision planes around
the capsule (`b3World_CollideMover`), solve for the closest allowed translation (`b3SolvePlanes`), and cast the
capsule along it (`b3World_CastMover`). The bridge runs up to 16 such rounds in one call
(`PhysicsWorld.moveCapsule`, which is also usable on its own).

```js
import {CapsuleCharacterController} from 'box3d-webgpu-kit/gameplay';

const character = new CapsuleCharacterController(world, {
  position: [0, 0.9, 0], radius: 0.3, height: 1.8,
  maxSlopeDegrees: 50, stepHeight: 0.35, maxPushForce: 800,
});
world.onStep(() => {
  const state = character.move({velocity: [input.x * 4, 0, input.z * 4], jump: input.jump ? 5 : 0}, world.loop.step);
  playerMesh.position.set(...state.position);
});
```

What it does, and where each rule comes from:

- **Walking.** On walkable ground the wanted velocity is turned into the ground plane and kept at the wanted speed,
  so the character moves at that speed *along* a slope. After each move it looks `snapDistance` below its feet and
  stays on the ground down slopes and stairs.
- **Slope limit.** A surface steeper than `maxSlopeDegrees` is a wall while the character stands on walkable ground
  (the bridge turns such planes vertical before the plane solver sees them), and a slide when it is in the air
  (pushing into it does not climb it).
- **Steps.** When a wall stops it, the character rises by `stepHeight`, moves one radius forwards and looks down. If
  walkable ground is there, higher than where it stood, it takes its move at that height; until the capsule itself
  stands on the ledge, the ledge under its leading foot carries it. While raised, anything that is not level is a
  wall, which is what makes the limit sharp: a ledge 5 mm higher than `stepHeight` is refused.
- **Jumping and falling.** In the air the vertical move of a step uses the mean of the speeds at its two ends, which
  is exact for constant gravity.
- **Moving platforms.** The character takes the velocity of the body under its feet at the point it stands on
  (`v + ω × r`), kinematic or dynamic, and keeps the horizontal part when it leaves.
- **Pushing.** A dynamic body in the way gets the impulse that brings its contact point up to the character's speed,
  limited to `maxPushForce × dt`, through `applyImpulseAt`. A box needs `μ m g` to slide, so boxes lighter than
  `maxPushForce / (μ g)` are pushed at walking speed and heavier ones stop the character.
- **Thin geometry.** Every translation is cast, so no speed gets the capsule through a wall.

The character is not a body: other bodies do not collide with it (give it a kinematic body to push things that
fall on it, and pass that body as `ignoreBody`), and a dynamic body it stands on does not feel its weight. Its own
state (`saveState()` / `restoreState()`) is ten fields; with the world's checkpoint it resumes a walk bit for bit.
A recording of the world holds the character's pushes, so a replay reproduces the world without the character.

### Measured

| Quantity | Measured | Held to |
|---|---|---|
| Speed on flat ground, commanded 3 m/s | 2.99998 m/s | 0.1% |
| Steepest ramp climbed / shallowest refused, limit 45° (0.5° scan) | 44.5° / 45° | limit ± 0.75° |
| The same at a 30° limit | 29.5° / 30° | limit ± 0.75° |
| Speed along a 42° ramp, commanded 2 m/s | 2.0000 m/s | 0.2% |
| Tallest ledge stepped onto / lowest refused, `stepHeight` 0.35 m (5 mm scan) | 0.350 m / 0.355 m | 0.35 m ± 6 mm / ± 11 mm |
| The same at 0.2 m | 0.200 m / 0.205 m | |
| Five stairs of 0.2 m up and down | top at 1.000 m, 0 of 385 steps of the way down in the air | 2 mm, 0 |
| Apex of a 5 m/s jump: v²/(2g) = 1.27421 m | 1.27420 m | 1 mm |
| Air time: 2v/g = 1.0194 s | 1.0167 s | one step (1/240 s) |
| A 1 cm wall at 10, 50, 100 and 300 m/s (5 m per move at the top speed) | 5.00 mm past the near face at every speed | ≤ Box3D's 5 mm slop |
| Carried by a platform moving at (1.5, 0.5) m/s | (1.49999, 0.50000) m/s, slip 0 | 0.1% |
| On a platform rising at 1 m/s for 2 s | 1.99999 m with the platform's 1.99999 m | 0.1% |
| Pushing, limit 400 N and μ = 0.5 (limit mass 81.5 kg): a 40.8 kg box | 1.487 m/s at a 1.5 m/s walk | 2% |
| The same push on a 163 kg box | 0.0013 m/s | ≤ 0.015 m/s |
| Resume from a checkpoint (a step, a platform ride, a jump, 68 pushes) | 0 of 1,150 later steps differ in any bit | 0 |

### Limits

- The capsule is upright and does not crouch. Its round bottom rides over bumps lower than
  `radius × (1 − cos(maxSlope))` (10.7 cm with the defaults) whatever `stepHeight` is.
- A step needs one radius of standing room on the ledge.
- A ramp exactly at the limit is on the edge of float32: it is refused, and the capsule may creep a few centimetres
  up its foot.
- A platform that moves away sideways faster than the character can follow in one step is left behind; a rising
  platform is followed with one step of lag (4 mm at 1 m/s and 240 Hz).
- Checked on boxes and ramps. Triangle-mesh and height-field ground work through the same queries but have no
  validation row.
- The older `CharacterController` (a box on box casts, no platforms, impulse pushing without a force limit) is
  unchanged and still exported.

## 3. Continuous collision

A discrete step moves a body by `v dt` and then looks for overlaps, so a small fast body can be on one side of a
thin wall before a step and on the other side after it. Box3D prevents this in two ways:

- **`continuous`** (world setting, on by default): a dynamic body that moves far in a step is swept against
  **static** shapes and stopped at the time of impact. `world.configure({continuous: false})` switches it off.
- **`bullet`** (body flag, `createBody({bullet: true})` or `world.setBullet(body, true)`): the body is also swept
  against **moving** bodies. Without it, two dynamic bodies are never swept against each other. Bullets cost
  more; use them for projectiles.

Both are part of a checkpoint. A `reset()` world has `continuous` on again.

### Measured

5 cm steel balls fired at a 2 cm static wall at 60 Hz, 24 start positions spread over one step of travel, so that
every alignment of the steps with the wall occurs:

| Speed | Travel per step | Through the wall, `continuous` off | Predicted | `continuous` on |
|---|---|---|---|---|
| 15 m/s | 0.25 m | 19 of 24 | 19 | 0 |
| 30 m/s | 0.5 m | 21 | 21 | 0 |
| 60 m/s | 1 m | 23 | 23 | 0 |
| 120 m/s | 2 m | 23 | 23 | 0 |
| 240 m/s | 4 m | 24 | 24 | 0 |

The prediction is a window model: without the sweep the ball is stopped only if some step ends with its centre
between `r + 2 cm` before the near face (Box3D makes contacts 2 cm ahead of touching: `B3_SPECULATIVE_DISTANCE`,
4 linear slops, read in `third_party/box3d/include/box3d/constants.h`) and the wall's mid-plane (deeper overlap is
pushed out of the far side). That window is `r + 2 cm + thickness / 2` = 5.5 cm out of every `v dt` of travel.

A 0.88 kg ball at 150 m/s (2.5 m per step) against a free 160 kg plate 2 cm thick: without the bullet flag the
ball passes and the plate does not move; with it both end at 0.82249 m/s, which is `m u / (m + M)` to 5 digits,
and the momentum is conserved to 9e-8 of its value.

### Limits

- Only translation is swept. A thin bar spinning fast can still pass through something.
- Kinematic bodies are not swept against static ones.
- Checked for spheres against boxes.

## Custom filter and pre-solve callbacks: not exposed

Box3D can call the application for every candidate pair (`b3World_SetCustomFilterCallback`) and for every touching
contact before it is solved (`b3World_SetPreSolveCallback`). The bridge does not expose them, for three reasons:

1. **Cost.** Each call would cross from WebAssembly into JavaScript and back. A 5,000-body pile has about
   20,000 contacts per step, at 4 sub-steps a frame; a boundary crossing costs on the order of 100 ns, which is
   several milliseconds a frame before the callback does anything.
2. **Threads.** In the pthread artifact the callbacks run on worker threads, which have no access to the page's
   JavaScript. Routing them to the main thread would block the solver's barriers.
3. **Determinism and checkpoints.** A callback is code outside the engine: a replay or a restored checkpoint is
   exact only if the same callback is installed and answers the same way, which the engine cannot check.

What is exposed instead is declarative and travels in checkpoints: category and mask bits and group indices per
body (`filter`, `setCollisionFilter`), `collideConnected` per joint, and the **filter joint** (`type: 'filter'`),
which switches off collision between two chosen bodies and does nothing else.
