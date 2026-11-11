# Rigid bodies ↔ water

`src/engine/water-coupling.ts` (`WaterCoupling`, backend `rigid-water-coupling-closed-cgrid-js-f64-v1`) couples the rigid-body world with one closed shallow-water basin, in both directions. The kit exports it as `box3d-webgpu-kit/coupling`. This is Phase 2, item 1 of the [roadmap](ROADMAP.md).

- **Water → body:** buoyancy from the exact volume of the shape below the local water plane, applied at the centre of buoyancy; the pressure-gradient force of a sloping surface; and a drag model.
- **Body → water:** the displaced volume is a volume source for the free surface, and the reaction of the horizontal force on the body is a momentum source.

The drag is a model with stated coefficients. It is not a flow solution, and nothing here resolves the flow around a body.

## Use

```ts
import {createWorld} from 'box3d-webgpu-kit';
import {WaterCoupling} from 'box3d-webgpu-kit/coupling';

const world = await createWorld({step: 1 / 240, ground: false});
const water = new WaterCoupling(world, {
  cols: 32, rows: 32, dx: 0.5, dz: 0.5,   // grid; x and z are world x and z
  restDepth: 2,                            // m
  origin: [-8, 0, -8],                     // basin floor at the grid's minimum-x, minimum-z corner
  density: 1000,                           // kg/m^3 (default)
  waterDrag: 0,                            // bottom friction of the water, 1/s (default)
});
const shape = {kind: 'box', halfExtents: [0.5, 0.3, 0.5]};
const body = world.createBody({shape, position: [0, 4, 0], density: 600});
const report = water.attach(body, shape, {dragCoefficient: 1.05});

water.step();   // 1. reads bodies at t, applies the water's forces for t -> t + dt, advances the water to t + dt
world.step();   // 2. advances the bodies to t + dt
```

**Order.** Call `water.step()` once per fixed step, immediately before `world.step()`. `world.onStep(() => water.step())` gives the same sequence shifted by one step (the first rigid step then has no water forces); `onStep` listeners do not run during `replay()`.

**Rules.** The coupling's `dt` must equal the world's fixed step (it defaults to `world.loop.step` and throws on a mismatch). Gravity is read from `world.gravity()` every step; only its downward part is used. The grid must satisfy the closed-water limits (`dt·sqrt(g·H)·hypot(1/dx, 1/dz) ≤ 0.8`, at least 3×3 cells). `attach` needs the shape again because the world does not report it. A body that is already wet at its first step is taken as part of the starting state: the water is assumed to stand around it, so attaching makes no wave and `waterVolume()` drops by its displaced volume once. `detach`, or destroying the body, hands the displaced volume back to the water in the next step. Kinematic and static bodies displace water and exchange momentum with it but receive no force.

**The floor and walls** are not part of the water solver. Put static bodies in the world where the basin floor and walls are; a body denser than water then comes to rest on the floor body while buoyancy keeps acting.

`step()` allocates nothing of its own; `PhysicsWorld.getState` and `applyForce` allocate small arrays inside the kit. State is float64; the rigid solver stores float32.

## Model

World y is up. The basin floor is at `y = origin.y`, the rest surface at `origin.y + H`, and `eta` is the surface elevation above rest at cell centres.

### Water

The scheme is the closed-basin C-grid solver of [`CLOSED_WATER.md`](CLOSED_WATER.md), in float64, with two source terms. Per cell of area `dA = dx·dz`, with `d` the displaced volume per unit area:

```
u_t   = -g eta_x - r u  +  (momentum source)
v_t   = -g eta_z - r v  +  (momentum source)
eta_t = -H (u_x + v_z)  +  d_t
```

`eta` is the piezometric head: where a body covers the column it is the level the water would stand at, not a visible surface. Without bodies the result matches `stepClosedWaterCpu` to float32 roundoff (measured 1.0e-8 m after 960 steps at 0.03 m amplitude).

### Exchange kernel

Each body exchanges with the water through one kernel: a tent centred on the body, with half-widths `2·(horizontal half extent) + one cell`, normalised over the cells inside the basin. The body **reads** the water through it (level, slope, velocity are kernel averages) and **writes** through it (volume and momentum are spread with the same weights). Using the same weights both ways is what makes the energy exchange consistent.

A body lowers itself, raises the level it reads, and so displaces more. For a tent kernel the gain of that loop is `4·A_waterplane / (9·reach_x·reach_z) ≤ 4/9` for any shape and grid. The coupling solves the loop within the step (one secant step on `V = V(level + response·(V − V_previous))`) instead of letting the body meet its own rise one step late.

### Buoyancy

Around each body the water is the plane `y = level + s_x (x − x_c) + s_z (z − z_c)` from the kernel averages of `eta` and its face gradients (slopes limited to ±0.5). The displaced volume `V` and its centroid are computed exactly against that plane:

- **box:** the six faces are clipped by the plane and summed as tetrahedra (exact for any orientation);
- **sphere:** the spherical-cap formula;
- **capsule:** discs perpendicular to the axis, each cut in a circular segment, integrated along the axis with 12-point Gauss–Legendre between the points where the cut changes form (agrees with a brute-force integration at random poses to 3e-5 relative, which is the accuracy of that reference; that comparison is not in the gate).

The force is `rho g V (−s_x, 1, −s_z)`, applied at the centre of buoyancy. Its vertical part is Archimedes; its horizontal part is the pressure-gradient force of a sloping surface, which moves a floating body with the water. Because it acts at the centre of buoyancy it also produces the righting moment.

Poses are evaluated half a step ahead (`x + v·dt/2`). A position-dependent force evaluated at the start of the step and held over it feeds energy into a floating body's bobbing at a rate set by the rigid solver's substeps; the half-step pose turns that into a small loss, `(beta − 1/2)(omega·dt)²` of the oscillation energy per step with `beta = (n + 1)/(2n)` for `n` substeps.

### Drag (a model)

With `phi = V / V_body`, `v_rel` the velocity of the centre of buoyancy relative to the kernel-averaged horizontal water velocity (the water has no vertical velocity in this model), and `omega` the body's angular velocity:

```
F_drag = −phi (k_lin + ½ rho C_d A_ref |v_rel|) v_rel            applied at the centre of buoyancy
T_drag = −phi (k_ang + ½ rho C_d A_ref R_e³ |omega|) omega
```

| Coefficient | Option | Default |
|---|---|---|
| `C_d` | `dragCoefficient` | 0.47 sphere, 1.05 box, 0.82 capsule (nominal high-Reynolds values; the same in every direction) |
| `A_ref` | `referenceArea` | `pi R_e²`, the cross-section of the sphere with the body's volume (`pi r²` for a sphere) |
| `k_lin` | `linearDrag` | 0 N·s/m |
| `k_ang` | `angularDrag` | 0 N·m·s/rad |

`R_e` is the radius of the sphere with the body's volume. The rotational term is an order-of-magnitude damping, not a derived moment. Two limiters keep the explicit step stable: the drag impulse may remove the relative velocity in one step but not reverse it (`coefficient ≤ m/dt`), and likewise for spin with `I ≈ 0.4 m R_e²`. There is no lift, no added mass, no skin friction model and no dependence on orientation or Reynolds number.

### Body → water

- **Volume.** Each step the body's displaced volume is spread over its kernel cells; the difference from the previous step enters `eta` as `d_t`.
- **Momentum.** The horizontal force on the body (pressure-gradient part plus drag), reversed and multiplied by `dt`, is added to the face momentum `rho H dA u` of the kernel cells: half on each of a cell's two faces, or all on the open face beside a wall.

## What is conserved

| Quantity | Status |
|---|---|
| Water volume, `sum((H + eta) dA) − displaced volume` | Conserved to float64 roundoff. Measured change over 30 s of a drop and bobbing: below one ulp of 512 m³ (1.1e-13 m³). |
| Mean level | Rises by exactly `displaced volume / basin area` (identity of the source term). |
| Vertical force | The hydrostatic floor load `rho g sum((H + eta) dA)` equals the weight of the water plus the buoyancy given to the bodies. Measured error 2.3e-16 of the water weight. |
| Horizontal momentum | The impulse given to dynamic bodies equals minus the impulse given to the water, each step, to roundoff (measured 0 N·s). The basin walls then take momentum from the water, and kinematic bodies exchange momentum with whatever drives them. |
| Energy | Not conserved exactly. Drag removes it by design. With drag off, body + water energy differs from its initial value by an amount first order in `dt` (see the table); it converges to conservation as `dt → 0`. |

**Not conserved, or not represented:**

- The reaction of the **vertical drag** is not put into the water (shallow water has no vertical momentum). `verticalDragTotal()` reports it.
- **Angular momentum:** the drag torque has no reaction on the water.
- The linear water model carries momentum as `rho H u` for the full depth, including under a body.
- Float32 in the rigid solver: forces and poses are rounded when they cross into the WASM.

## Validation

`packages/box3d-kit/test/v09-coupling.test.mjs`, 240 Hz, 4 substeps, water 1000 kg/m³, run by `npm run test:kit`. Tolerances are derived in the test file next to each check.

| Check | Expected | Measured | Tolerance | Result |
|---|---|---|---|---|
| Box floats, `rho_b/rho_w = 0.6` | submerged fraction 0.6 | 0.6000056 (error 5.6e-6) | 1e-4 | pass |
| Sphere floats, 0.3 | 0.3; draught 0.29061 m (cap formula) | 0.2999999 (error −1.2e-7); 0.29061 m | 1e-4; 1 mm | pass |
| Capsule floats on its side, 0.5 | 0.5; axis in the waterline | 0.4999979 (error −2.1e-6) | 1e-4; 1 mm | pass |
| Box draught | 0.36 m | 0.36000 m | 1 mm | pass |
| Dense box (2500 kg/m³) sinks to the floor body | rests at 0.3 m, fully submerged | 0.29996 m, fraction 1 | 6 mm (contact slop) | pass |
| Water volume while a box drops in and bobs, 30 s | constant | change below 1.1e-13 m³ of 512 m³ | 1e-12 relative | pass |
| Bathtub: mean level at rest | `m/(rho_w A)` = 0.002475000 m | 0.002474974 m (−1.1e-5) | 1e-4 relative | pass |
| Bathtub: sunk box, kinematic plunger | level rise = `V/A` | error 2e-18 m; displaced = sphere volume | 1e-12 | pass |
| Floor load = water weight + buoyancy | equal | 2.3e-16 of the water weight | 1e-12 | pass |
| Impulse on bodies = −impulse on water | equal | 0 N·s | 1e-9 N·s | pass |
| Heave period, 0.5 × 0.5 × 4 m spar, depth 4 m | `2 pi sqrt(m/(rho_w g A))` = 3.10779 s | 3.11390 s (+0.20%) | 1% | pass |
| Heave amplitude without drag | never grows | 0.0977, 0.0959, 0.0948, 0.0939 m | no growth | pass |
| Terminal speed, sphere r = 0.1 m, 1100 kg/m³ | 0.746054 m/s | 0.746022 m/s (−4.2e-5) | 1e-3 | pass |
| Righting moment at 0.1 rad heel | `rho g V GZ` = −71.0068 N·m (wall-sided formula) | −71.0068 N·m (2.7e-8) | 1e-5 | pass |
| Roll period at 0.05 rad, no drag | `2 pi sqrt(I/(rho g V GM))` = 0.87216 s | 0.87180 s (−0.04%) | 1% | pass |
| Heeled 0.3 rad, released | returns upright | swing peaks 0.229, 0.185, 0.155, … rad with default drag; 6.6e-5 rad after 6 s with `angularDrag` 60 | each swing smaller; 1e-3 rad | pass |
| Drop makes waves | `eta ≠ 0` away from the body after impact; still before | 0.030 m at 5 m; exactly 0 before impact | > 1e-3 m | pass |
| Energy, default drag | never above the initial energy | max `E − E0` = −0.03 J; −1944 J of 1972 J at 8 s | ≤ 0 | pass |
| Energy, no drag, 240 Hz | excess ≤ `rho g V v_impact dt` = 59.4 J | `E − E0` in [−82.3, +17.1] J of 1972 J in play | 59.4 J on the excess | pass |
| Energy, no drag, 240 → 480 Hz | excess and deficit halve | ratios 2.010 and 2.017 | 2 ± 0.2 | pass |
| Determinism | bit-identical bodies and water | identical | exact | pass |
| No bodies: same as `stepClosedWaterCpu` | float32 roundoff | 1.0e-8 m | 1e-5 m | pass |

Notes on three of these:

- **Heave.** The closed form has no added mass and no wave radiation. This model has no added-mass term either, but its water answers the body's volume source (radiation and a local rise). The check uses a slender spar (`omega·R/c = 0.08`) so that this feedback is small, and measures +0.20%. It is not small for a squat body in shallow water: a 1 × 1 × 0.5 m box of density 500 in 2 m of water (32 m basin, 0.5 m cells, drag off) heaves with a period 7% shorter than the closed form and a damping ratio near 0.18. A real box would be slower than the closed form because of added mass, so in that regime the model errs in the other direction.
- **Roll.** A roll about the centre changes neither the displaced volume nor where it is returned, so in this model rocking makes no waves and the roll check tests the exact moment and the rigid integrator only. With drag off the roll amplitude fell from 0.050 to 0.046 rad in 6 s, which is the half-step numerical loss described above.
- **Energy.** `E` = body kinetic + `m g y` + `waterKineticEnergy()` + `waterPotentialEnergy()`. The terms are sampled up to half a step apart, and the in-step solve of the body's own rise loses energy in proportion to `dt`; both effects halve when `dt` halves. The excess above the initial energy (0.9% of `m g h` at 240 Hz) is the sampling offset, not a gain that accumulates: every run ends below its initial energy.

## Limits

- One basin, rectangular, **flat bottom**, closed walls. No wetting or drying, no sloped beds, no inflow or outflow.
- **Linear, small-amplitude waves**: no advection, no breaking, no splash, no dispersion beyond the grid's. The water has no vertical velocity.
- A body's draught is not checked against the depth: the water under a body is not squeezed, and a body below the floor is still treated as submerged. Use a floor body.
- Each body sees **one plane** of water, averaged over a kernel about twice its size. Waves shorter than the body, and waves much shorter than the kernel, are averaged away. Rocking and yawing make no waves; only changes of displaced volume and horizontal forces do.
- Bodies are **boxes, spheres and capsules**, one shape per body. Bodies do not shelter each other, and a body does not block the flow.
- **No added mass**, no lift, no viscosity model, no orientation-dependent drag.
- A body that hangs over the basin edge displaces only the share of its wet volume that is over the grid (sampled on 24 × 24 vertical chords); there is no water outside the grid.
- Attached bodies are kept awake by the applied forces.
- CPU only. The WebGPU closed-water solver is not coupled; `copyTo()` writes the state into the float32 closed-water arrays for rendering.
- Not yet used by a scene, the Lab or the Studio, and not covered by record/replay (the world rejects `applyForce` while recording).
