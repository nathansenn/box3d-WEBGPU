# GPU compute backends

The validated solvers of this project run in float64 on one CPU thread. This document describes the WebGPU compute
backends beside them: what exists, how each is validated, what float32 costs in accuracy, the capacities and limits,
and how to measure the speed on a real GPU. The CPU solvers stay the default and the reference; a GPU backend is opt-in.

Updated 2026-11-17.

## Status

| Part | State |
|---|---|
| Compute framework (`src/engine/gpu/compute.ts`, `layout.ts`, `wgsl.ts`) | done, tested in the gate |
| Shallow water (`shallow-water-gpu.ts`) | done; 22 closed-form cases pass on the GPU (SwiftShader) with the float64 tolerances except four rows (below) |
| Discrete-element grains (`granular-gpu.ts`) | done; 27 closed-form cases pass on the GPU (SwiftShader): 17 two-body, incline and column rows (13 with the float64 tolerance) and the 10 Janssen, Beverloo and repose rows (float64 tolerances) |
| Coupling grains to rigid bodies (`GpuGranularCoupling`) | done on the CPU with per-wall sums reduced on the GPU; latency 0 or 1 rigid step |
| Drawing from the simulation buffers (`src/webgpu/simulation-layers.ts`) | done: grains as shaded quads from the position buffer, terrain and water surface from the state and bed buffers, slices of a fluid coloured by speed from its data buffer |
| Lab examples at scale (`lab.html?example=sand-avalanche-100k`, `flood-valley-1m`, `lid-cavity-262k`) | done, with a CPU example as the fall back; seen on SwiftShader at small sizes only |
| Incompressible flow on the MAC grid (`fluid-gpu.ts`) | done, with fixed and moving obstacles and rigid bodies coupled through `FluidCoupling`: 24 closed-form rows pass on the GPU (SwiftShader), 19 with the float64 tolerance; the GPU gives the float32 reference's bits, forces included |
| Free surface (APIC), cloth | **not done** on the GPU (see "Not done" for why the free surface was not attempted) |
| Shallow water with coupled rigid bodies or point sources on the GPU | **not done** (the float64 solver has both) |
| Checkpoints of the GPU backends (`checkpoint()`, `restoreCheckpoint()`) | done for the three backends, a format shared with each float32 reference; bit-exact on resume (gate: references, and the fluid across GPU and reference; SwiftShader: the GPU backends) |
| `backend: 'gpu'` in the scene format (grains, shallow water, flows with obstacles and coupled bodies), `Simulation.stepAsync()` | done (`src/engine/gpu/scene-backends.ts`); tested in the gate on the float32 reference standing in for the GPU (flows also through `GpuFluid` on a stand-in device that runs the kernels) |
| The GPU backends in the kit (`box3d-webgpu-kit/gpu`) | done: the three backends, their float32 references and `gpuSceneBackends`; the kit's gate loads a GPU scene on the reference (repeat and resume bit-exact) and encodes it on Dawn's null device |
| The Studio's granular tray and river tabs on the GPU | **not done**: the Studio's solvers run inside its synchronous step |
| Speed on a real GPU | **not measured**: this machine has no GPU. The command is below |

## How a GPU backend is validated here

Node's WebGPU package (Dawn) has only the null backend on this machine: it compiles shaders and validates every call but
runs nothing. Headless Chromium with SwiftShader does run compute shaders, slowly. So the validation has three layers:

1. **A float32 CPU reference of the same algorithm.** `ShallowWaterF32` and `GranularF32` take the same passes over the
   same buffer layouts as the shaders, operation for operation, each result rounded with `Math.fround` (which is what a
   float32 add, multiply, divide or square root gives). The reference runs in Node.
2. **The gate** (`npm run test:gpu`, in `validate:pr`; no shader runs): struct offsets against hand-computed tables and
   struct sizes against the shader compiler for every prefix of every struct; the shaders compile on Dawn without
   warnings; whole runs encode without a validation error; the dispatch order; the error paths; device loss; and the
   float32 references against the float64 solvers' own validation set-ups and closed forms.
3. **The browser check** (`scripts/gpu-compute-browser-check.mjs`, not in a gate because the gates have no browser): the
   shaders run. It compares the GPU with the float32 reference and with the float64 solver, runs the closed-form cases
   on the GPU, checks conservation, repeats runs, and destroys the device in mid-run.

The validation set-ups are not rewritten for the GPU. For shallow water the set-up is run three times: with a stand-in
that counts steps, then the backend for that many steps keeping every state, then the set-up again on a `ShallowWater`
that replays those states (`shallow-water-validation.ts`). For grains the set-ups drive the solver step by step, so
`granularProxy` (`granular-proxy.ts`) is a `Granular` whose steps a backend takes; in the browser the set-up runs in a
worker that blocks on a shared buffer while the page drives the device (`scenario-worker.ts`).

```
npm run test:gpu                                             # the gate: 42 tests and a Dawn script, about 8 minutes
npm run build && node scripts/gpu-compute-browser-check.mjs out          # the shaders, on SwiftShader: about 100 minutes
npm run build && node scripts/gpu-compute-browser-check.mjs out --quick  # without Janssen, Beverloo and repose
```

`gpu-probe.html` (built with the site) runs the same checks and the timings in any browser, on the visitor's device.

## The framework (`src/engine/gpu/`)

- `acquireGpuCompute(needs)`: adapter and device, with the limits a backend needs checked first (storage buffers per
  stage, largest storage binding, workgroups per dimension). Limits above the WebGPU defaults are requested only when
  needed. No adapter, or one too small, throws `EngineError` `GPU_UNAVAILABLE` with the reason.
- `defineStruct(name, fields)`: one definition gives the WGSL declaration, the byte offsets by WGSL's alignment rules,
  and `write` / `read` for an `ArrayBuffer`. The TypeScript side never repeats an offset by hand.
- `preprocessWgsl`: `#include "name"`, `#define`, `#if` / `#ifdef` / `#ifndef` / `#else` / `#endif`, `${NAME}`. The grain
  shaders are five modules built from shared snippets, in variants with and without rolling histories.
- `GpuCompute.module`, `pipeline`, `scoped`: shader compilation and every creation call run inside error scopes that
  are popped before anything is awaited; an error becomes an `EngineError` (`GPU_SHADER` with `line:column message` and
  the source line, `GPU_VALIDATION`, `GPU_OUT_OF_MEMORY`).
- `GpuProgram`: dispatches encoded into one compute pass in list order. WebGPU runs the dispatches of a pass in the
  order encoded, each seeing the writes of the ones before.
- `GpuCompute.read`: staging buffers and `mapAsync`. Everything submitted before a read has run when it resolves.
- Device loss: `lost`, `onLost(listener)`, and every later call throws `GPU_DEVICE_LOST`. `ShallowWaterRunner` and
  `GranularRunner` keep a snapshot every N steps in the float64 solver the run was built from; when the device is lost
  they run that solver from the snapshot to where the GPU run had got to and carry on with it (`backend` becomes
  `'cpu'`, `fallback` says why, when, and how many steps were run again). Grains resume with their tangential springs
  at zero: the histories do not cross over.

Every pass is a gather: one invocation writes only its own element. The one exception is the insertion of grains into
the hash grid (atomic counters, so the order within a bucket depends on scheduling); a per-bucket sort removes that
order before anything reads it. Repeated runs on the same device give identical bytes (checked in the browser).

## Shallow water on the GPU

The scheme of [`SHALLOW_WATER.md`](SHALLOW_WATER.md): hydrostatic reconstruction, MUSCL with minmod and the centred bed
term, HLL, Heun, split rain, Green-Ampt and Manning friction; walls, open, inflow and stage sides; solid cells.
One cell is one invocation; it evaluates its own four face fluxes (each face is evaluated by both cells that share it,
from the same inputs).

What differs from the float64 solver, by design:

- **Substeps.** The number of equal substeps of a step is fixed at its start from the largest face speed. With
  `rateLatency: 0` (default, used by the validation) a measuring pass runs first and 32 bytes are read back and waited
  for. With `rateLatency: L >= 1` the speeds of the step `L` before are used: no pass, no wait unless that readback is
  late; `safety` (default 1.25 then) widens the margin and `stats.courant` reports what the substeps ran at. Both are
  repeatable. `rateWait: false` never waits: a step uses the newest speeds that have arrived, however old; the substep
  counts then depend on timing (for a frame loop only).
- **Volume.** The depth takes every increment (the transport step, rain, infiltration) with a per-cell carry
  (compensated sum). The volume is `sum(h + carry)`; it changes only by the rounding of the increments, not of the
  depths. Rain of 1e-7 m per step into 10 m of water (below half a unit in the last place of the depth) is kept: after
  1000 steps the volume has grown by the rain to 3e-7 of it. A depth that would go below zero is zero and the shortfall
  stays in the carry; nothing is booked as `clipped`.
- **Green-Ampt** is solved for the increment with `ln(1 + t)` by series for small `t`, where float32 loses `t`.
- **The volume through the sides** is summed per cell with a carry and added in float64 when read.

Buffers: 16 bytes per cell four times (state, stage, bed, sums). A million cells: 64 MB.

Not on the GPU: coupled rigid bodies (`ShallowWaterCoupling`), `addVolume` / `removeVolume`, checkpoints.

### Results

The 22 rows are the float64 solver's (domain `shallow-water` of [`VALIDATION.md`](VALIDATION.md)) minus the rigid-body
and resume rows. Measured on the float32 reference in the gate and on the GPU (SwiftShader) in the browser; the two
agree to the digits shown.

| Case | Measured | Tolerance | float64 tolerance |
|---|---|---|---|
| Lake at rest, immersed: largest speed | 5.6e-6 m/s | <= 2e-5 | <= 1e-12 |
| Lake at rest, partly emerged: largest speed | 3.9e-6 m/s | <= 2e-5 | <= 1e-12 |
| Lake at rest: level drift | 3.7e-8 m | <= 5e-7 | <= 1e-14 |
| Ritter dam break: L1 error | 2.497e-3 | <= 4e-3 | same |
| Ritter: order | 1.03 | >= 0.2 | same |
| Ritter: wet front | 7.1375 m (7.259) | +- 0.15 | same |
| Stoker dam break: L1 error | 2.269e-3 | <= 4e-3 | same |
| Stoker: shock position | 6.2624 m (6.2598) | +- 0.025 | same |
| Thacker paraboloid: L1 error after one period | 1.975e-2 | <= 2.5e-2 | same |
| Thacker: order | 1.45 | >= 0 | same |
| Bump, subcritical: L1 error | 6.25e-5 | <= 1e-4 | same |
| Bump, subcritical: order | 1.97 | 2 +- 0.2 | same |
| Bump, transcritical: L1 error | 4.20e-4 | <= 1e-3 | same |
| Bump with a jump: L1 error | 1.71e-3 | <= 3e-3 | same |
| Bump: jump position | 11.625 m (11.666) | +- 0.125 | same |
| Manning normal depth, slope 0.001 | 0.63906 m (0.63923) | +- 5e-4 relative | same |
| Manning normal depth, slope 0.01 | 0.31997 m (0.32037) | +- 2e-3 relative | same |
| Rain on a slope: hydrograph rms | 3.86e-2 | <= 5e-2 | same |
| Rain on a slope: equilibrium outflow | 2.0e-6 | <= 1e-4 | same |
| Green-Ampt: cumulative infiltration | 4.6e-8 m | <= 1e-6 | same |
| Green-Ampt: ponding time | 997 s (995.7) | +- 2 | same |
| Volume budget, every source and side at once | 4.4e-8 | <= 1e-6 | <= 1e-12 |

Where float32 forces a looser tolerance: the lake at rest (the level `h + b` is rounded per cell, so neighbours differ
by a unit in the last place, 3e-8 m at 0.25 m, which drives flows of the order of `sqrt(g / h)` times that) and the
volume budget (increments are float32). The largest relative volume budget error over all 17 set-ups is 8e-7.

GPU against the CPU on short runs (browser check, SwiftShader):

| Set-up | Cells | Steps | Depth, GPU vs float32 reference | Depth, GPU vs float64 | Volume budget | Repeat run |
|---|---|---|---|---|---|---|
| Thacker's paraboloid | 4096 | 40 | 0 (identical) | 1.3e-7 | 3e-11 | identical bytes |
| Inflow, open side, rain, soil, friction | 1536 | 120 | 3.2e-7 | 7.6e-7 | 1.8e-8 | identical bytes |
| Ritter dam break | 200 | 40 | 4e-28 | 1.5e-7 | 7e-11 | identical bytes |
| Channel with a pier (solid cells), stage outlet | 1440 | 80 | 0 (identical) | 9.8e-7 | 9e-9 | identical bytes |

Differences are over the largest depth. The one set-up that is not identical to the reference uses `pow` and `log`
(friction and Green-Ampt), which a GPU rounds differently. Device destroyed after 12 of 20 steps with a snapshot every
5: the run finishes on the CPU, 2 steps run again, 8.7e-8 from a float64 run of the 20 steps.

## Grains on the GPU

The contact laws of [`GRANULAR.md`](GRANULAR.md): linear and Hertz normal force with the same numerically solved damping
coefficient, tangential spring with history under Coulomb's cap (Mindlin stiffness for Hertz), rolling resistance,
velocity Verlet with one force evaluation per step; walls: plane, box, sphere, capsule, and the shells of revolution
(cylinder, annulus, frustum); static, kinematic and dynamic walls (a dynamic wall is integrated on the GPU with the
grains, as in the float64 solver); removal at the bounds.

One step is six dispatches:

| Pass | Invocations | What |
|---|---|---|
| `wallOpen` | per wall | opening half kick and drift of moving walls |
| `integrate` | per grain | opening half kick, drift, removal at the bounds, insertion into the hash grid (atomic counters) |
| `sort` | per bucket | sorts the bucket's grains by index: the insertion order cannot matter after this |
| `pairs` | per grain | every grain of the 27 cells around it; the contact law; writes the new histories |
| `wallContacts` | per block of 64 grains, in order | wall contacts, the closing half kick, the block's per-wall sums |
| `wallClose` | per wall | adds the block sums in block order; closing half kick of dynamic walls |

What differs from the float64 solver, by design:

- **Neighbours** come from a hash grid of cell size `2 r_max` rebuilt every step (no Verlet list).
- **Every pair is evaluated from both grains.** Each operation of the contact law gives the exact negative for the
  exchanged pair, so the two forces are equal and opposite to the last bit: the momentum of two colliding grains does
  not change by one bit (measured 0).
- **Contact history** lives in K slots per grain (default 10), keyed by the neighbour's index (`0x80000000 | wall` for a
  wall). A contact that finds no free slot is evaluated without history that step (its tangential spring starts from
  zero) and counted in `stats.historyOverflow`; the run goes on. With K = 2 on a packed bed of 360 beads the count is
  positive and the bed still stands (tested).
- **Hash buckets** hold M grains (default `max(12, 4 (r_max / r_min)^3)`); the table has the first power of two at or
  above twice the capacity. A grain that finds its bucket full is invisible to its neighbours that step; `sync()`
  throws `GPU_CAPACITY`, because the forces were then wrong.
- At most 16 walls. No energy ledger (dissipated work is not summed). No checkpoints.

Memory: `capacity x (80 + 32 K)` bytes (`64 K` with rolling friction) plus `8 (1 + M)` bytes per bucket. 100 000 grains
with rolling friction and K = 10: 72 MB plus 27 MB of grid. A million grains with K = 10 need a 160 MB storage binding
(320 MB with rolling), above WebGPU's default of 128 MB: `demMemory()` gives the figure to ask the adapter for, and the
Lab example lowers K to what the device binds.

### Results

The quick rows run on the float32 reference in the gate and on the GPU (SwiftShader) through the worker; the two give
the same digits. The rows are the float64 solver's (domain `granular`), minus the energy ledger rows (the backend sums no
dissipated work) and the rows through the kit's rigid world.

| Case | Measured | Reference | Tolerance | float64 tolerance |
|---|---|---|---|---|
| Hertz contact duration | 6.4335e-4 s | 6.4331e-4 | 2e-4 relative | 5e-5 |
| Hertz duration: order (steps of 16 % and 8 %) | 2.14 | 2 | +- 0.5 | +- 0.3 (8 % and 4 %) |
| Linear-spring contact duration | 2.5413e-4 s | 2.5416e-4 | 2e-4 relative | same |
| Two grains: momentum change | 0 | 0 | <= 1e-13 | same |
| Restitution, Hertz, e = 0.9 | 0.9003 | 0.9 | +- 1e-3 | same |
| Restitution, Hertz, e = 0.5 | 0.5000 | 0.5 | +- 1e-3 | same |
| Restitution, Hertz, e = 0.2 at 1 m/s | 0.1993 | 0.2 | +- 1e-3 | same |
| Restitution, linear, e = 0.5 | 0.4997 | 0.5 | +- 2e-3 | same |
| Oblique impact, sliding (Hertz) | 3.2159 | 3.215 | +- 5e-3 | same |
| Oblique impact, sliding (linear) | 3.7632 | 3.76 | +- 5e-3 | same |
| Oblique impact, sticking, k_t = 2/7 k_n | -1.0002 | -1 | +- 2e-3 | same |
| Oblique impact, sticking, k_t = 1/7 k_n | -0.6064 | -0.6057 | +- 5e-3 | same |
| Sliding down an incline | 4.0536 m/s^2 | 4.0554 | 2e-3 relative | 1e-9 |
| Rolling down an incline (Hertz) | 3.5021 m/s^2 | 3.5036 | 1e-3 relative | same |
| Rolling down an incline (linear) | 3.5033 m/s^2 | 3.5036 | 1e-3 relative | same |
| Column of 300 beads: floor force | 3.8602 N | 3.8592 | 1e-3 relative | same |
| Beads striking a free dynamic sphere: total momentum | 5.0e-8 | 0 | <= 2e-6 | <= 1e-12 |

Where float32 forces a looser tolerance:

- **Hertz duration** (5e-5 -> 2e-4, measured 4.8e-5): the overlap, at most 2e-5 m between grains at 5e-3 m, is resolved
  to 5e-10 m. The convergence order is read between steps of 16 % and 8 % of the Rayleigh time, because at 4 % the error
  of the duration is already the rounding.
- **Sliding down an incline** (1e-9 -> 2e-3, measured -4.4e-4): 43 850 steps of 14 microseconds each add 5.5e-5 m/s to a
  velocity of 1 to 2.4 m/s, which float32 holds to 2.4e-7 m/s. The same increment is rounded the same way step after
  step, so the error does not average out. This is the float32 limit that matters most for grains: **a constant
  acceleration integrated with many small steps drifts by up to half a unit in the last place of the velocity per
  kick.** Softer grains (larger steps) lose less; compensated velocity and position sums would remove it and are not
  implemented.
- **Momentum with a free dynamic wall** (1e-12 -> 2e-6, measured 5e-8): the wall takes the contact forces summed per
  block in float32.

Also float32: positions resolve 6e-8 of their magnitude, so an overlap must be well above that to give a smooth force
(at 1 m from the origin, 6e-8 m; the validation's overlaps are 1e-6 to 1e-4 m at under 0.2 m).

GPU against the CPU on short runs (browser check, SwiftShader):

| Set-up | Grains | Walls | Steps | Position, GPU vs float32 reference | Position, GPU vs float64 | Momentum balance | Repeat run |
|---|---|---|---|---|---|---|---|
| Beads dropped into a box (linear, friction, rolling) | 360 | 5 planes | 500 | 0 (identical) | 1.6e-3 radii | 3.7e-6 | identical bytes |
| Cylinder on a hopper over a ring, turning box and capsule, free sphere, bounds (Hertz) | 272 | every shape | 500 | 0 (identical) | 1.6e-2 radii | - | identical bytes |

The momentum balance is the change of the grains' momentum plus the walls' impulses less `M g t`, over `M g t`.
Many-grain trajectories diverge between float32 and float64 (after 10 000 steps of the column by more than a radius)
while the bulk agrees: floor impulse -2.70145 against -2.70151 N s. Device destroyed after 250 of 400 steps with a
snapshot every 100: the run finishes on the CPU, 50 steps run again, the height of the centre of mass 1.8e-7 from a
float64 run.

The rows that take minutes ran on the GPU only (SwiftShader, 75 minutes; the float32 CPU reference would take longer).
These are statistical results of many-grain runs: the GPU's trajectories differ from the float64 solver's, the laws are
what must hold.

| Case | Measured on the GPU | Reference | Tolerance (the float64 one) | float64 solver measures |
|---|---|---|---|---|
| Janssen: floor load over weight, full silo | 0.140 | (a fluid: 1) | <= 0.2 | 0.131 |
| Janssen: rms misfit of the saturation law over eight fills | 0.086 | 0 | <= 0.1 | 0.061 |
| Janssen: plateau of the last four fills | 1.645 N | fitted W_s 1.707 N | 10 % | 1.706 N against 1.700 |
| Janssen: stress ratio K from the fit | 1.27 | 1.05 read from the solver | 25 % | 1.18 against 1.05 |
| Beverloo: worst misfit over four orifices | 0.061 | 0 | <= 0.15 | 0.090 |
| Beverloo: C | 0.507 | 0.6 (literature, from memory) | +- 0.25 | 0.447 |
| Beverloo: k | 1.42 | 1.5 (literature, from memory) | +- 1 | 1.14 |
| Beverloo: late over early rate as the level falls | 0.998 | 1 | +- 0.12 | 1.037 |
| Repose: slope at (mu, mu_r) = (0.5, 0.3) less (0.2, 0) | 16.8 deg | >= 6 | lower bound | 12.6 deg |
| Repose: pairs where more resistance left less mass | 0 | 0 | 0 | 0 |

The four repose slopes are 19.7, 19.8, 26.0 and 36.5 degrees for (0.2, 0), (0.5, 0), (0.5, 0.1), (0.5, 0.3); the float64
solver gives 22, 26, 27 and 35 with about 2 degrees of noise each. 989 beads (Janssen), 2603 beads (Beverloo) and 480
beads (repose); no history slot or bucket overflowed. Glass-bead repose and the column collapse were not run on the GPU.

## Incompressible flow on the GPU

The float64 solver's projection method ([`FLUID.md`](FLUID.md)) with its obstacles, in float32 (`fluid-gpu.ts`):
ghost fills for every kind of side (walls, sliding walls, free slip, inflow, outflow, periodic); central or upwind
advection with Adams-Bashforth 2; the predictor with grad p^n, gravity, a body force and the explicit part of the
viscosity; the implicit part (Crank-Nicolson or backward Euler) by conjugate gradients, component by component; the
projection by conjugate gradients; the pressure update.

The algorithm is written once as a program of kernel calls (`fluid-program.ts`, a generator) and the kernels twice
(`fluid-kernels.ts`: WGSL, and TypeScript in float32). The GPU runs the program as dispatches; `FluidF32` runs the same
program kernel by kernel on the CPU. In the gate, `GpuFluid` is also driven through a stand-in device that executes each
dispatch with the float32 kernels: it gives the reference's bits, so the encoding (order, parameter blocks, clears,
offsets, readbacks) is the program's.

What differs from the float64 solver, by design:

- **Preconditioner.** Jacobi (the diagonal) for the pressure and the viscous solves; the float64 solver uses MIC(0) or
  a multigrid V-cycle for the pressure. MIC is a sequential triangular solve and does not run in parallel; a multigrid
  V-cycle on the GPU was not written. Iterations at the float32 tolerances: 6 (Taylor-Green, 32^2), 48 (cubic cavity,
  16^3), 65 (open channel, 48 x 12) per projection.
- **The solves stop on the GPU.** The tests of the float64 solver (max |r| against the tolerance, a breakdown, the
  iteration limit) run in a one-invocation kernel; the host reads 64 scalars (256 bytes) every 16 iterations. A device
  whose scalars never report a stopped solve is refused (`GPU_VALIDATION`) after the iteration limit, not looped on.
- **Pressure tolerance.** max |div u| h / max |u| <= 2e-6 (the float64 solver: 1e-10). The velocity is resolved to 6e-8
  of itself and a divergence is a difference of six such numbers; measured 1.6e-6 to 2.0e-6.
- **Viscous stopping rule.** max |r| <= max(1e-6 max |r_0|, 2^-25 (1 + 12 k) max |b|), k = theta dt nu / h^2. The
  float64 rule, a fraction of max |b|, freezes a float32 run short of its steady state: near the steady state a step's
  change is below 1e-6 of b and a solve with nothing to do leaves the state unchanged (Couette stopped at 4.9e-5 of the
  wall speed that way). The floor is half the rounding of b - M x.
- No energy ledger (dissipation, work by bodies stays as the float64 bookkeeping of the forces).

### Obstacles

The obstacles are the float64 solver's fictitious domain: spheres, boxes, capsules and cylinders, fixed or moving, the
pressure solved through them, the faces inside taking the rigid velocity and those next to the fluid the value
extrapolated through the fluid face beyond, the force on a body the momentum the constraint takes from the fluid less
the change of the momentum inside, less the weight of the fluid displaced.

- **The geometry stays on the host, in float64.** Before each step `Fluid.backendObstacleBand()` of the Fluid the backend
  was built from gives, per velocity component, the faces within 1.5 cells of an enabled obstacle's surface (grouped by
  obstacle), each with its mode (free, inside, inside next to the fluid), the face beyond, the extrapolation weight, the
  rigid velocity, the solid fraction and the arm r x e_c. The program uploads them rounded to float32: 16 bytes of
  indices and 24 of floats per face (about 10 kB for a sphere of 2.4 cells radius, 4 to 6 per cent of the faces of a
  sphere of 0.15 L in a 16^3 box). A moving obstacle is uploaded every step; the cost on the host is that of the band
  only. The room for faces is fixed when the backend is built (twice the band at the start plus 64 per obstacle,
  `obstacleCapacity`); a move that needs more throws `GPU_CAPACITY`. At most 1024 obstacles.
- **On the GPU** five kernels: the constrained value and the free value of each band face (`oConstrain`, through the
  predicted face beyond when the viscosity is explicit, the present one when it is implicit, as the float64 solver
  does), its scatter into the predictor or the implicit solve's known values (`oScatter`), the removal of those faces
  from the viscous unknowns (`oZero`), the constraint impulse rho dV (u - u_free) with the implicit viscous term of the
  constrained field (`oImpulse`), the momentum inside rho alpha dV u (`oMomentum`); and `segSum`, one workgroup per
  obstacle, component and moment, which sums them in a fixed order (lane l takes entries l, l + 256, ..., then a tree).
- **The forces are taken on the host**: 36 scalars per obstacle come back with the step's statistics, and
  `Fluid.finishBackendObstacles` turns them into the force, torque, impulse and work by bodies with the float64 code of
  the solver's own step. A GpuFluid (or FluidF32) built from a Fluid does both each step, so `fluid.obstacleForce(i)`,
  `setObstacleState` and `FluidCoupling` work as with the float64 solver. One built from a plain description (a worker)
  takes the band through `setObstacles` and leaves the sums in `obstacleSums`.

Two set-ups were added for the agreement checks: a cylinder across a 2D channel (48 x 16 cells, inflow and outflow,
Crank-Nicolson, upwind) and a sphere moving at (0.05, 0.02, -0.01) m/s and turning at 8 rad/s through water in a closed
16^3 box under gravity (explicit viscosity, central advection). The benchmark times the flow through a periodic array
of spheres (the Stokes set-up) beside the cavity.

Memory (`fluidMemory()`): about 140 bytes of floats and 70 of indices per padded cell: 40 MB + 20 MB for 64^3, 132 MB +
68 MB for 96^3 (just above WebGPU's default largest binding of 128 MB, so a device must grant more), 311 MB + 161 MB for
128^3.

### Results

The rows are the float64 solver's (domain `fluid`) that the backend covers, on the float64 set-ups themselves (the
projection with its tilted capsule, the tank with its sphere, the Stokes sphere). The coupling rows take a rigid world:
here a stand-in that integrates free spheres in float64 by symplectic Euler (`pointWorld` in `fluid-cases.ts`), because the
kit's WebAssembly world does not run in the worker that drives the GPU; the float64 solver on the same stand-in gives the
same numbers to the digits shown (terminal velocity -9.2576e-3 against -9.2577e-3 m/s). Measured on the float32
reference in the gate and on the GPU (SwiftShader) in the browser, with the same digits: the rows without obstacles on
2026-11-16 (47 minutes), the ten with obstacles or bodies on 2026-11-17 (76 minutes at a load average of 17 to 36).

| Case | Measured | Reference | Tolerance | float64 tolerance |
|---|---|---|---|---|
| Projection: divergence left (walls / periodic / outflow, a tilted capsule) | 1.92e-6 | 0 | <= 3e-6 | <= 1.5e-10 |
| Taylor-Green: decay rate, 32^2 | 0.039887 1/s | 0.04 | 5e-3 relative | same |
| Taylor-Green: order between 32 and 64 | 2.17 | 2 | +- 0.3 | same |
| Taylor-Green: velocity error | 5.54e-5 | 0 | <= 1e-4 | same |
| Plane Poiseuille: profile error | 3.9061e-3 | 3.9063e-3 | 5e-4 relative | 1e-6 relative |
| Plane Couette: profile error | 6.0e-5 | 0 | <= 2e-4 | <= 1e-7 |
| Square duct: flow rate, 16^2 | 1.1414e-6 m^3/s | 1.1246e-6 | 2 % | same |
| Square duct: order between 8 and 16 | 1.90 | 2 | +- 0.3 | same |
| Channel, inflow and outflow: pressure gradient | -17.815 Pa/m | -18 | 2 % | same |
| Channel: outlet profile | 5.2e-3 | 0 | <= 0.01 | same |
| Channel: mass | 4.7e-6 | 0 | +- 1e-5 | +- 1e-8 |
| Lid-driven cavity, Re 100: u (Ghia) | 2.24e-3 | 0 | <= 5e-3 | same |
| Lid-driven cavity, Re 100: v | 8.25e-3 | 0 | <= 1.2e-2 | same |
| Lid-driven cavity, Re 400: u | 1.33e-2 | 0 | <= 2.5e-2 | same |
| Lid-driven cavity, Re 400: v | 1.48e-2 | 0 | <= 2.5e-2 | same |
| Water at rest with a fixed sphere: largest speed over g dt | 0 | 0 | <= 1e-12 | same |
| Water at rest: pressure head | 1839.375 Pa | 1839.375 | 1e-9 relative | same |
| Water at rest: buoyancy of the sphere (radius 2.4 cells) | 1.16449 N | 1.10948 | 6 % | same |
| Stokes drag, K at 2.4 cells per radius (Hasimoto) | 1.57272 | 1.70000 | 10 % | same |
| Stokes drag, K at 3.6 cells per radius | 1.64359 | 1.70000 | 5 % | same |
| Stokes drag: force on a control surface against the constraint's | 7.89235e-4 N | 7.89167e-4 | 1 % | same |
| Coupling: terminal velocity of a settling sphere (stand-in world) | -9.2577e-3 m/s | -8.7307e-3 | 12 % | same |
| Coupling: impulse handed over (stand-in world) | 6.2e-8 | 0 | <= 1e-6 | <= 1e-12 |
| Coupling: total momentum (stand-in world) | 6.2e-8 | 0 | <= 1e-6 | same |

The float64 solver gives 2.237e-3 / 8.244e-3 (Re 100) and 1.335e-2 / 1.483e-2 (Re 400) on the cavity: the float32
backend is within 1e-5 of the lid speed of it. Where float32 forces a looser tolerance:

| Row | float64 | float32 | Measured | Why |
|---|---|---|---|---|
| Projection divergence | 1.5e-10 | 3e-6 | 1.8e-6 | the projection stops at 2e-6; velocities carry 6e-8 of rounding each |
| Poiseuille profile | 1e-6 relative | 5e-4 relative | 3.9e-5 relative | the Laplacian of a float32 profile is rounded to 12 x 6e-8 \|u\| / h^2; the steady state carries that over the smallest eigenvalue: about 2e-5 of the centre-line speed, against a measured deviation of 3.9e-3 of it |
| Couette profile | 1e-7 | 2e-4 | 6.0e-5 | the same: 12 x 6e-8 (H / h)^2 / pi^2 = 1.9e-5 of the wall speed at 16 cells, and the steady-state rule stops when a step changes less than that |
| Channel mass | 1e-8 | 1e-5 | 4.7e-6 | a flow rate is a sum of 12 face velocities, and the projection leaves 2e-6 of divergence per cell |
| Coupling: impulse handed over | 1e-12 | 1e-6 | 6.2e-8 | every face velocity is rounded to 6e-8 of itself each step and the impulse and the momentum inside are float32 sums: the fluid's momentum and the impulse it hands over agree to the rounding of the velocities, not to the float64 solver's 1e-16 |

The float32 reference and the float64 solver agree on the obstacle rows to about 1e-6 of each value (Stokes K 1.5727176
against 1.5727184 at 16 cells, 1.6435863 against 1.6435876 at 24; the buoyancy and the pressure head to every digit).
The Taylor-Green energy ledger, the repeatability row (it hashes the kit's world) and the free-surface rows are not
covered.

GPU against the CPU (SwiftShader):

| Set-up | Cells | Steps | Velocity, GPU vs float32 | Velocity, GPU vs float64 | Divergence left | Repeat run |
|---|---|---|---|---|---|---|
| Taylor-Green, explicit, central | 1024 | 20 | 0 (identical) | 1.3e-6 | 1.9e-6 | identical bytes |
| Cubic lid-driven cavity, backward Euler | 4096 | 12 | 0 (identical) | 3.9e-7 | 1.9e-6 | identical bytes |
| Open channel, Crank-Nicolson, upwind, inflow and outflow | 576 | 20 | 0 (identical) | 5.6e-6 | 2.0e-6 | identical bytes |
| Cylinder across a channel (fixed obstacle) | 768 | 20 | 0 (identical) | 1.6e-6 | 1.8e-6 | identical bytes |
| Sphere moving and turning in a closed box, gravity | 4096 | 12 | 0 (identical) | 1.0e-6 | 1.9e-6 | identical bytes |

The force on the obstacle after the last step, GPU against the CPU: the cylinder (9.076e-6, -1.383e-6, 0) N, the
GPU's bits are the reference's, 8.7e-6 of it from the float64 solver; the moving sphere (-2.557e-3, 3.953e-2, -1.882e-3) N,
the reference's bits, 2.3e-6 from float64.

Differences over the largest speed (2026-11-16 for the first three rows, 2026-11-17 for the obstacles). Device
destroyed after 12 of 20 steps with a snapshot every 5: the run finishes on the CPU (2 steps run again; the
Adams-Bashforth history restarts) and ends 3.4e-7 from a float64 run.

On SwiftShader a step of the 48^2 cavity at Re 400 took about 1 s (1450 steps in 25 minutes): numbers for the record,
not for a GPU.

## Coupling grains to rigid bodies

The rigid world stays on the CPU. `GpuGranularCoupling` wraps the float64 solver's `GranularCoupling` on the `Granular`
the backend was built from (the mirror). Each rigid step: `begin()` copies the bodies into the mirror's walls (pose,
velocities, mass, estimated support load); the walls are uploaded (288 bytes per wall); the GPU takes the grain substeps
with each dynamic body integrated alongside the grains, as the float64 solver does; the walls' forces and impulses,
reduced on the GPU to one sum per wall, are read back; `finish()` hands each body the mean force and torque.

- **`latency: 0`** (default): the readback is waited for before `world.step()`. The body gets the forces of this step,
  as in the float64 coupling. A 0.06 kg block dropped on 144 beads at 240 Hz is carried with 2e-3 of its weight and the
  floor reads bed plus block to 2e-3 (tested on the float32 reference standing in for the GPU).
- **`latency: 1`**: nothing is waited for; the body gets the forces of the previous rigid step. That is a delayed
  feedback on a stiff contact, stable only when the body's mass is well above `k h^2` (`k` the contact stiffness under
  the body, `h` the rigid step). The same 0.06 kg block at 240 Hz (`k h^2` about 1.7 kg) is thrown off the bed; a 0.5 kg
  block at 960 Hz (`k h^2` about 0.1 kg) rests at the same height as with latency 0 to within 2 mm, carried to 5e-3
  (tested). Use latency 0 unless the frame loop must not wait.

The kit's two-way coupling rows (block on a bed 1e-5, floor load 1e-5, spring scale 1e-5, third law 1e-12) were not
run on the GPU: they need the kit's WASM world inside the worker, which was not set up.

## Drawing without readback

`WebGPURenderer.setSimulationLayers(layers)` draws layers inside the main pass with the scene uniforms bound
(`src/webgpu/simulation-layers.ts`):

- `createGrainLayer(target, positionBuffer, count)`: one camera-facing quad per grain shaded as a sphere; centre and
  radius are pulled from the backend's position buffer in the vertex shader. A removed grain (radius negated by the
  solver) is moved outside the view.
- `createHeightFieldLayers(target, stateBuffer, bedBuffer, grid)`: the terrain and the water surface as a grid generated
  from the vertex index, heights pulled from the state and bed buffers; dry cells of the water surface are discarded.
  A grid finer than 512 quads along a side is drawn every `stride` cells (the solver still computes every cell).
- `createPlaneLayer`: a rectangle with a grid.
- `createFluidSliceLayer(target, dataBuffer, {cells, padded, paddedSize, velocityOffset, axis, index, speedScale, model})`:
  one plane of cells of the GPU fluid (normal `axis`, cell layer `index`), each cell a flat quad coloured by the speed
  at its centre (the mean of its two faces per component, read from the backend's data buffer in the vertex shader;
  dark blue at rest, red at `speedScale`). 6 vertices per cell; nothing is interpolated between cells.

No simulation data is read back for a frame. The examples read back statistics only: 288 bytes per wall and 32 bytes of
counters per batch of grain steps; 32 bytes every twentieth batch for shallow water; for the fluid, its 64 scalars (256 bytes) every 16
iterations of a solve (the solves stop on the GPU) and once at the end of a step.

## Checkpoints

Every GPU backend writes its state as bytes and puts them back (`checkpoint()`, a promise, because it reads the
buffers; `restoreCheckpoint(bytes)`), in the self-checking container of [`CHECKPOINTS.md`](CHECKPOINTS.md) (format
version, SHA-256). The float32 reference of each backend writes and reads the same format, so a checkpoint taken on
the GPU resumes on the CPU reference and the other way round.

| Backend | Kind | What is saved | Bytes |
|---|---|---|---|
| `GpuFluid`, `FluidF32` | `gpu-fluid`, `fluid-program-f32-v1` | face velocities with their ghosts, the previous advection (Adams-Bashforth), pressure, whether the next step uses Adams-Bashforth, time, statistics | 28 per padded cell |
| `GpuShallowWater`, `ShallowWaterF32` | `gpu-shallow-water`, `shallow-water-f32-v1` | (h, hu, hv, carry) and (infiltrated, scratch, side volume, carry) per cell, time, steps, the last substep's length (the leading friction uses it), rain added, the volumes of the budget, statistics | 32 per cell |
| `GpuGranular`, `GranularF32` | `gpu-granular`, `granular-f32-v1` | position and radius, velocity and mass, spin and inverse inertia, force and torque per grain, the contact histories the next step reads, the walls with their sums, the cumulative counters, time, statistics | 80 + 16 K (32 K with rolling friction) per grain |

Everything else on the device is rewritten by a step before it is read, or constant; a restored backend starts the
other history buffer empty. Refused (`CHECKPOINT_MISMATCH`): another grid, grain count, history size or wall count,
another format. A `GpuShallowWater` with `rateLatency` above 0 refuses to checkpoint (its face speeds are on their way).
With obstacles, the fluid's checkpoint holds the flow; the obstacles' poses, forces and momentum records belong to the
`Fluid` the backend was built from and are saved with its own `saveState()`.

What is guaranteed, and checked:

- **Bit-exact against its own run.** A run checkpointed at step N, restored into a fresh backend built from the same
  start and taken to N + M gives the bits of the run taken straight to N + M: in the gate on every float32 reference
  (all fluid, shallow-water and grain set-ups, with the moving sphere's host restored too), across the GPU and the
  reference for the fluid (through the stand-in device that runs the kernels, both ways; the GPU writes the reference's
  bytes), and on SwiftShader for the GPU backends (browser check, table below).
- **Bit-exact against the float32 reference** where the GPU and the reference agree bit for bit (the agreement tables
  above: everything here except set-ups that use `pow`, `log` or `exp`, which a GPU may round differently).
- **Not against float64.** A GPU checkpoint holds float32 numbers; it does not resume the float64 solver, and the
  float64 solver's checkpoints do not resume a GPU backend (`pull` writes a GPU state into a float64 solver, without its
  contact histories, as a fall back does).

On SwiftShader (`node scripts/gpu-compute-browser-check.mjs out --no-granular --no-shallow-water --no-fluid`, 2026-11-17,
124 s at a load average near 30): a GPU run checkpointed half way, restored into a fresh GPU backend built from the
same start, and taken to the end, against the straight GPU run; and the same checkpoint restored into the float32
reference.

| Backend | Set-up | Steps (checkpoint at) | Checkpoint bytes | Restored on the GPU | Restored on the float32 reference |
|---|---|---|---|---|---|
| shallow water | Thacker, 64 x 64 | 40 (20) | 131 535 | identical bits | depths and discharges identical (difference 0); the per-cell aux words differ |
| grains | bead box, 360 beads | 400 (150) | 146 228 | identical bits | identical bits |
| fluid | cubic cavity, 16^3 | 12 (6) | 156 730 | identical bits | identical bits |
| fluid | moving, turning sphere, 16^3 | 12 (6) | 156 730 | identical bits | identical bits |

The shallow-water difference was not traced further; on Thacker's set-up (closed sides, no soil) the only aux word that
changes is, by reading the code, the first stage's depth increment, a scratch value rewritten each substep before it is
read (unverified by a run).

## Scene sections on the GPU

A `grains`, `shallowWater` or flow `fluids` section of a scene file may say `"backend": "gpu"` ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#sections-on-the-gpu)).
The Simulation loop has an opt-in asynchronous stage for them:

- A subsystem may have `stepAsync(ctx)`, `checkpointAsync()` and `pullAsync()`. `await simulation.stepAsync()` runs the
  step in the usual order (prepare, pre-couple, couple, the rigid step, post, finish, events, listeners), awaiting each
  asynchronous subsystem in its place; the others run exactly as in `step()`. `step()` and `checkpoint()` refuse a
  simulation with an asynchronous subsystem; a second asynchronous call before the first has resolved is refused.
  `checkpointAsync()` writes the same file format as `checkpoint()`, and `restore()` puts it back.
- A simulation without asynchronous subsystems is untouched: `step()` is the same code (one added check), and
  `stepAsync()` gives its bits (tested on a scene of grains, a see-saw and a valley of water). No scene hash changes:
  `"cpu"` is the default and is left out of the normal form.
- `gpuSceneBackends(compute)` (`src/engine/gpu/scene-backends.ts`) builds the GPU sections; the loaders take it as
  `{gpu}` and refuse a scene with a GPU section without it. The backend is created from the float64 solver the loader
  made, at the first `stepAsync()`, so loading stays synchronous. Grains: the coupling's begin and finish run on the CPU
  around the GPU's substeps (`GpuGranularCoupling` with latency 0: the walls' sums are read back before the rigid
  step), couple stage, order 160. Shallow water: post stage, order 530, at the world step over `substeps`; no bodies.
  Flows (`gpuFluidSubsystem`, added 2026-11-18): with bodies, the `FluidCoupling` the loader made runs its step with the
  fluid steps taken by the backend (`FluidCoupling.stepAsync(advance)`, the same code as `step()` with `fluid.step(1)`
  handed to the caller), couple stage, order 180; the backend takes the obstacles' band from the `Fluid` before each
  fluid step and hands it their sums after (as in "Obstacles" above), so the forces reach the bodies before the rigid
  step. Without bodies: post stage, order 510. The room for obstacle faces is fixed when the section is built (twice
  the band at the scene's start plus 64 per obstacle), so a run resumed from a checkpoint has the room of the straight
  run. A checkpoint holds the backend's bytes and the `Fluid`'s and coupling's own state (the obstacles' poses, forces
  and momentum records). No energy ledger; events: `unconverged`. A free-surface tank has no GPU backend.
- `gpuSceneBackends('reference')` runs the same float32 programs on the CPU instead (slower than the float64 solvers).
  The gate runs the scene sections that way: two runs give the same bits, a checkpoint taken at step 15 and resumed with
  `resumeSimulationScene` in a fresh world carries on to step 40 with the bits of the straight run. For flows
  (`tests/engine/gpu-scene-fluid.test.mjs`) the same on the three fluid examples with backend `gpu`: the ball settling
  through syrup (coupled two-way), the cylinder in a channel (a static body, inflow and outflow) and the lid-driven
  cube (8^3, no bodies): repeat runs bit-identical, a checkpoint at step 7 (4) resumed in a fresh world reaches step 16
  (10) with the straight run's bits; the GpuFluid path (a stand-in device that runs the kernels) gives the reference's
  bits, the rigid world included; and the float32 flow is within 1e-5 of the largest speed of the float64 scene's (measured 1.8e-6, 3.6e-6 and 3.6e-7; the ball's
  velocity -0.1186153 m/s in both to the seven digits printed).
- The kit publishes the same code as `box3d-webgpu-kit/gpu` (`gpuSceneBackends`, `acquireGpuCompute`, the backends and their
  references); its `loadSimulationScene` and `resumeSimulation` take `{gpu}`. `packages/box3d-kit/test/v23-gpu-scene.test.mjs`
  (kit gate) loads the grains-and-valley scene through the published files with the kit's WebAssembly world: two runs of
  24 steps give the same bits, a checkpoint at step 9 resumed in a fresh world reaches step 24 with them; and on Dawn's
  null device the same scene builds its pipelines from the kit's copies of the shaders and takes two steps and a
  checkpoint without a validation error (the null device runs nothing, so its readbacks are replaced by what the host
  wrote). The entry is 150.8 KiB of gzip with the solvers it loads; its declarations need `@webgpu/types`.
- The state lives on the device. `await simulation.pullAsync()` writes it into the float64 objects the loader made (the
  `grains`, `shallowWater` and `fluids` maps); saving the scene is refused until a section has been pulled since its last step.

Determinism of a GPU section: float32; repeat runs on the same device and browser are bit-identical; a checkpoint resumes
bit-exactly; the results are the float32 reference's bits where the agreement tables say "identical", and are not the
float64 solver's. A checkpoint of a GPU simulation does not restore into a CPU simulation of the same scene without the
`backend` field (the scene hashes differ).

## Lab examples at scale

```
lab.html?example=sand-avalanche-100k        100 000 grains of 7 to 9 mm released behind a gate on a 30 degree slope
lab.html?example=flood-valley-1m            a 34 m reservoir let go into a 1 km valley of 1024 x 1024 cells, Manning 0.035
lab.html?example=lid-cavity-262k            a lid-driven cube of 64 x 64 x 64 cells at Re 1000, drawn as three slices of speed
```

`&n=` sets the size (grains; cells along a side). The avalanche takes 3360 grain steps per simulated second at 100 000
grains (the step is set so that a grain at the bottom of the heap at rest overlaps by about 2.5 % of its radius; the
heap is 18 layers deep), so 56 grain steps per frame at 60 Hz; the flood takes 2 to 3 substeps per 1/60 s step at
1024 x 1024. Both run on their own clock (the Pause button stops them) and never hold a frame for a step: the grain
example waits for the walls' sums once per batch, the flood uses the newest face speeds that have come back
(`rateWait: false`, so its substep counts depend on timing and two runs can differ). Without WebGPU
compute (the WebGL2 renderer, or a device too small for the buffers) the page opens `hopper-seesaw` or
`dam-break-valley` instead, and the log says why. `box3dLab.sceneState().gpuShowcase` reports the solver, the element
count, steps, time, ms per step and the solver's statistics.

The cube (`cavity3d(n, 1000)` of `fluid-setups.ts`: a unit cube, lid speed 1, viscosity 1/1000, backward-Euler
viscosity, `dt = h / 2`) takes one solver step per drawn frame and falls back to `cavity-flow`. Its three slices are the
mid plane (cell layer n/2), the cell layer at 0.8 n along x (x = 0.84 at 16 cells) and the bottom cell layer, coloured
by speed (red at 0.6 of the lid speed). A fluid step reads back the scalars every 16 iterations of each solve, so while
a GPU example is on screen the Lab keeps at most one frame on the device (it waits for `onSubmittedWorkDone` before
drawing the next), and it draws none while the cube's steps are on their way (`holdsFrames`). Without that, on
SwiftShader the Lab submitted frames faster than they ran: with the cube paused, a wait for `onSubmittedWorkDone`
begun 10 s after loading took 92 s (356 more frames were submitted meanwhile), every readback waited behind that queue,
and one 8^3 step took 2.0 s with frames stopped but had not finished after 2.5 minutes with them running (a 16^3 run
drew no frame in 34 minutes). With the change, an 8^3 step took 185 ms and a 16^3 step 1.5 to 2.1 s on SwiftShader on
a loaded machine (load average 10 to 15).

Seen on SwiftShader (`node scripts/gpu-compute-browser-check.mjs out --showcase`, 2026-11-16) at small sizes only:
3174 grains (`&n=3000`), 96 x 96 cells (`&n=96`) and 16^3 cells (`&n=16`), stepped with the Lab paused between
captures. The captures were looked at:

- **Avalanche, 3174 grains** (1920 steps per simulated second at this size): at 0.12 s the heap stands behind the
  gate (4944 touching pairs, largest overlap 16 % of a radius while the heap settles from its lattice); the gate is taken
  away at 0.25 s; at 1.18 s the grains run down the slope in a tongue several heap lengths long, 1088 pairs and 1828
  grain-wall contacts, nothing removed, no history slot or bucket overflowed. Drawn as shaded spheres from the
  position buffer.
- **Flood, 96 x 96 cells**: the reservoir at the head of the valley spills over the line of the old dam, the water
  white where it runs fastest; at 8 s (481 steps, one substep each, Courant number 0.04 to 0.05, largest wave speed
  16 m/s) 1168 cells are wet: the front has moved about 100 m of the 1 km valley, as it should in 8 s. Terrain and
  water drawn from the state and bed buffers.
- **Lid-driven cube, 16^3 cells** (`&n=16`, `--showcase-only=lid-cavity-262k`): captures at steps 5, 45 and 165 (t =
  0.16, 1.41 and 5.16 lid-transit times), all solves converged (27 to 37 pressure iterations a step, 12 viscous,
  divergence 1.4e-6 to 1.7e-6 of the largest speed). At t = 0.16 only the cell layer under the lid moves. At t = 1.41
  the fast band under the lid has a slow layer just beneath it and a broad region of moderate speed below that. At t =
  5.16: the band under the lid, a fast downward stream on the x = 0.84 slice at mid-span (slower towards the side
  walls), faster return flow in the lower half of the mid plane, a slower region in its upper half, and the bottom
  cell layer slow everywhere. The colours show speed, not direction; the direction comes from the same program run by
  the float32 reference (`FluidF32`, which gave the GPU's bits on the 12-step Re 100 cube in the agreement table) for
  165 steps: on the mid plane u runs from 0.40 in the top cell to -0.061 at y = 0.41 (return flow below about 0.8 of
  the height), v from 0.071 at x = 0.6 to -0.27 next to the downstream wall, and the slowest interior cell (0.014) is
  at x = 0.78, y = 0.66: one clockwise primary vortex, its centre still in the upper downstream quarter. The flow is
  far from steady at t = 5; no capture was compared with a published 3D cavity profile, and 16 cells do not resolve Re
  1000 (cell Reynolds number 62).
- **Fall back**: `lab.html?example=flood-valley-1m&renderer=webgl2` opens `dam-break-valley` and says "This page is
  drawing with WebGL2, which has no compute shaders."

The full sizes (100 000 grains, 1024 x 1024 cells, 64^3 cells) were not run here: on SwiftShader a step of the
avalanche at 3174 grains takes 130 to 280 ms, of the cube at 16^3 1.5 to 2.1 s. **What they look like and how fast
they run on a real GPU is not known yet.**

## Timings

Measured on SwiftShader only (`node scripts/gpu-compute-browser-check.mjs out --bench --sizes=64,128,256
--grains=2000,8000 --steps=6`, 2026-11-16, the 4-core machine idle, load average 1 to 6). **SwiftShader is a CPU
emulation of a GPU: these numbers say nothing about a GPU.** They are recorded so that the table's form is known.

| Backend | Size | ms per step | Element updates per second | CPU solver, ms per step |
|---|---|---|---|---|
| shallow water | 64 x 64 | 8.2 | 0.50 million cell-substeps | 30 (JIT warm-up; 6 steps) |
| shallow water | 128 x 128 | 30 | 0.54 million | 5.5 |
| shallow water | 256 x 256 | 121 | 0.54 million | 22 |
| grains (avalanche, at rest behind the gate) | 2000 | 23 | 86 000 grain-steps | 4.2 |
| grains | 8192 | 112 | 73 000 | 1.35 |

So on SwiftShader the backends run at 1/5 (shallow water) to 1/80 (grains, against a heap at rest where the float64
solver's Verlet lists are cheapest) of the float64 CPU solvers. On SwiftShader the Lab steps of the examples took
130 to 280 ms per grain step at 3174 grains and 2.3 to 3 s per 1/60 s flood step at 96 x 96 (with the Lab's own
frame, also emulated, on the same cores).

To measure on a real GPU (any machine with Chrome or Chromium 113 or later and a GPU):

```
npm ci && npm run build && npm run bench:gpu:hardware
```

That is `node scripts/gpu-compute-browser-check.mjs --hardware --bench`: it launches the browser without the software
flags and prints one table (backend, size, substeps, ms per step, element updates per second, the CPU solver's ms per
step where it fits, and the ratio) for shallow water (256 to 2048 cells along a side), the grain avalanche (10 000 to
1 000 000 grains) and the fluid: a lid-driven cube and the flow through a periodic array of spheres (the obstacle band
uploaded every step), 32^3, 64^3 and 96^3 cells. It writes `gpu-compute-bench-hardware.json` and the same table as
`gpu-compute-bench-hardware.md`, with the adapter, the browser version, the date and the machine's load average, ready to
paste here. `BOX3D_CHROMIUM` names the browser; `--sizes=`, `--grains=`, `--fluid=` and `--steps=` set the cases. The
table's first line names the adapter and says so when it is a software adapter. The same table is on `gpu-probe.html`
("Time the backends").

The command on SwiftShader at small sizes (`--bench --sizes=64,128 --grains=2000 --fluid=8,16 --steps=4`, 2026-11-17,
load average 10 to 13 on 4 cores), to show the table's form only:

| Backend | Size | ms per step | CPU solver, ms per step |
|---|---|---|---|
| shallow water | 64 x 64 | 22.9 | 7.5 |
| shallow water | 128 x 128 | 183 | 5.6 |
| grains | 2000 | 42.4 | 8.5 |
| fluid cavity (23 pressure, 18 viscous iterations a step) | 8^3 | 277 | 8.7 |
| fluid sphere array (18 pressure, 59 viscous iterations a step) | 8^3 | 352 | 15 |
| fluid cavity (50 pressure, 21 viscous iterations a step) | 16^3 | 2030 | 21.5 |
| fluid sphere array (36 pressure, 95 viscous iterations a step) | 16^3 | 2960 | 25.6 |

On SwiftShader the fluid is 30 to 110 times slower than the float64 solver: a solve stops on the GPU and is read back
every 16 iterations, and each iteration is a dozen dispatches, which an emulated GPU runs one after another on the CPU.
What a real GPU does with it is the open question this command answers.
Run the validation on that machine too (`node scripts/gpu-compute-browser-check.mjs out --hardware`): a GPU may fuse
multiply-adds and round `pow`, `log` and `sqrt` differently from SwiftShader, so "identical to the reference" above is a
SwiftShader result; the closed-form rows have margin for that.

## Not done

- **The free surface (APIC) on the GPU: not attempted** (2026-11-17), and nothing of it is in the code. What it needs
  that the flow backend does not have: a repeatable particle-to-grid transfer (WGSL has no floating-point atomics, so
  the particles must be sorted by cell every step, as the grains are in their hash grid, and each face gather the
  weighted velocities of the particles in the cells around it in a fixed order); pressure and viscous systems whose
  unknowns change every step (liquid cells, air as p = 0, voxelised solids), where the flow program's lists are fixed
  when it is built, so masked operators with their own float32 reference; and a validation that runs thousands of
  steps (Martin & Moyce, the sloshing frequency, Huppert's current) on SwiftShader. That is a new solver of the size of
  the flow backend, and it was left for a later pass rather than committed unvalidated.
- A **multigrid** pressure preconditioner on the GPU, and the obstacle geometry on the GPU (it is on the host, in
  float64; many moving obstacles would make the host the bottleneck).
- The fluid coupling rows through the kit's WebAssembly world (they ran through a float64 stand-in world).
- **GPU scene sections in the Lab.** The Lab does not load scenes with GPU backends (its frame loop calls `step()`).
- **The Studio's granular tray and river tabs on the GPU (`?gpu=1`).** The Studio's SI solvers run inside
  its synchronous step and its saved runs are exact.
- **Shallow water with bodies and point sources** on the GPU.
- **Compensated velocity and position sums** for grains (the incline row above).
- **Real-GPU numbers** and a check that the closed-form rows hold on a real GPU's rounding.
- The grain rows through the kit's rigid world, glass-bead repose and column collapse on the GPU.
