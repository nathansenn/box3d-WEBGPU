# Worlds and units

A world is one isolated rigid-body simulation. Everything in it is in SI units: metres, kilograms, seconds, radians,
newtons. The Y axis points up.

```js
import {createWorld} from 'box3d-webgpu-kit';

const world = await createWorld({
  gravity: [0, -9.81, 0],   // m/s^2; passing gravity or ground gives an SI world
  ground: true,             // a static slab 88 m by 88 m whose top face is y = 0
  step: 1 / 60,             // the fixed time step, at most 1/30 s
  subSteps: 4,              // solver sub-steps per step, 1 to 16
  seed: 1,
});
```

- `createWorld()` with neither `gravity` nor `ground` gives the classic arena (gravity -10, for the built-in presets).
  For your own scenes pass `gravity`.
- `world.reset({gravity, ground, seed})` empties the world; handles from before are stale afterwards.
- One WebAssembly module holds up to 16 worlds: `loadBox3D()` once, then `new PhysicsWorld(pool)` for each.
  `createWorld` does both for a single world, and `world.dispose()` frees it.

## Numbers and their ranges

The rigid world holds single-precision numbers. Positions stay within 100 km of the origin and are precise to about a
millimetre within 16 km; the convex shapes of a dynamic body are at most 1 km across a half extent (of a static or kinematic body 100 km) and at least 0.1 mm. Values outside the
[accepted ranges](../../reference/errors.html) are refused with `INVALID_PAYLOAD`, the field named in the message.

Model at human scale: a shape thinner than a centimetre is below the 5 mm contact tolerance and will not rest
cleanly. `world.diagnose()` reports such things:

```js
for (const finding of world.diagnose()) console.warn(finding.rule, finding.message);
```

The deformable solvers (water, cables, cloth, grains, solids, heat, fluids) hold double precision and also work in SI.

## Body handles

`createBody` returns an opaque handle, or `null` when the world is full (65,536 bodies at most; reserve with
`capacity`). A handle of a destroyed body never names a newer body: `world.isAlive(body)` is `false` for it forever.
Rows of the render buffers do move when a body is destroyed; `world.bodyAt(row)` gives the body drawn at a row.
