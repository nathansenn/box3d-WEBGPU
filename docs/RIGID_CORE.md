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
