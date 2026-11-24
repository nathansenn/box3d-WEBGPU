# Flow around and through geometry

`box3d-webgpu-kit/flow` computes the flow of one incompressible fluid around a body (a virtual wind or water tunnel) or
through a cavity (pipes, ducts, manifolds, tanks with inlets and outlets), from geometry given as oriented primitives
and triangle meshes in SI units. It reports forces and moments per part, drag, lift and side coefficients, surface
pressure, flow rates, pressure drops and flow splits, slices, streamlines and wake measures.

**What it is.** A weakly compressible lattice-Boltzmann solver (D3Q19, regularised collision, Smagorinsky sub-grid
model with a wall function on smooth walls, interpolated bounce-back walls) on a uniform grid of cubic cells, float64
JavaScript, deterministic. Above a cell Reynolds number of about 10 it is an **under-resolved large-eddy simulation: an
engineering estimate, not certified CFD**. [Validation](#validation) lists what was measured against which reference, at
what resolution and with what error; [Limits](#limits) says what it cannot do.

The existing `box3d-webgpu-kit/fluid` (staggered-grid projection, [`FLUID.md`](FLUID.md)) is unchanged; it remains the
solver for resolved laminar flow with moving and coupled rigid bodies and for the free surface.

## Contents

- [Quick start](#quick-start)
- [Why this method](#why-this-method)
- [Method](#method)
- [Frame and units](#frame-and-units)
- [Geometry](#geometry)
- [The study document: `box3d-flow-study/1`](#the-study-document-box3d-flow-study-1)
- [The result document: `box3d-flow-result/1`](#the-result-document-box3d-flow-result-1)
- [Programming interface](#programming-interface)
- [Command line and the single-file bundle](#command-line-and-the-single-file-bundle)
- [Requirements of the apex flow studies](#requirements-of-the-apex-flow-studies)
- [Drawing results with three.js](#drawing-results-with-three-js)
- [On the GPU](#on-the-gpu)
- [Validation](#validation)
- [Cost](#cost)
- [Limits](#limits)

## Quick start

```js
import {runFlowStudy} from 'box3d-webgpu-kit/flow';

const result = runFlowStudy({
  format: 'box3d-flow-study/1',
  name: 'block in wind',
  geometry: [{kind: 'box', center: [0, 10, 0], size: [20, 20, 20], part: 'building'}],
  fluid: 'air',
  mode: 'external',
  external: {speed: 20, direction: [1, 0, 0], ground: {height: 0, type: 'fixed'}},
  resolution: {cells: 400000},
  outputs: {streamlines: true, surface: true, slices: [{axis: 'z', fraction: 0.5}]},
}, {onProgress: p => console.log(p.step, p.maxSteps, p.coefficients)});

console.log(result.forces.coefficients.cd, result.setup.reynolds, result.warnings);
```

```
node packages/box3d-kit/bin/flow-cli.mjs study.json --out result.json        # in the repository
npx box3d-flow study.json --out result.json                                  # from the installed package
```

Both documents are plain JSON. JSON Schemas: `packages/box3d-kit/schemas/flow-study.schema.json` and
`flow-result.schema.json` (in the package: `box3d-webgpu-kit/schemas/flow-study.schema.json`), written by
`packages/box3d-kit/scripts/flow-schemas.mjs`; the test file validates real results against the result schema.

## Why this method

The existing volumetric solver is a pressure-projection method: each step solves a Poisson equation by conjugate
gradients, in float64 on one thread. That is the right tool for a resolved laminar flow and a coupled body. For flow
around voxelised engineering geometry at high Reynolds number the lattice-Boltzmann method is the better fit:

| | Projection (`fluid`) | Lattice-Boltzmann (`flow`) |
|---|---|---|
| Work per step | a Poisson solve whose iterations grow with the grid | one local update per fluid cell |
| Arbitrary solid | four primitive kinds | any voxelised shape; the wall position enters through the link fractions |
| Small viscosity | central differences oscillate above a cell Reynolds number of a few | regularised collision with a sub-grid model stays stable at cell Reynolds numbers of 10⁵ and more |
| Sparse domains | the box | only fluid cells hold populations: a pipe network costs what its fluid costs |
| Parallel form | global linear solves | one gather per cell: a single compute pass on a GPU |

The price is the weak compressibility (an error of the order of the lattice Mach number squared, about 1%), a time
step tied to the cell size, and no implicit steady solver: a steady state is reached by marching in time.

## Method

Lattice units below: cell 1, step 1, reference density 1. `src/engine/flow-lattice.ts` is the kernel.

- **Lattice.** D3Q19: populations `f_i` with velocities `c_i` (rest, 6 axis and 12 edge neighbours), weights 1/3, 1/18,
  1/36, sound speed `1/sqrt(3)`. The arrays hold `f_i - w_i`, and only for the fluid cells (`cellOf` / `activeOf` map
  between fluid numbers and cells of the box).
- **Collision.** Regularised (Latt & Chopard 2006): after streaming, the density, momentum and stress
  `P = sum c_i c_i f_i` are computed and the populations are rebuilt from those ten moments, with the deviatoric
  non-equilibrium stress relaxed with `tau = 3 nu + 1/2` and its trace with `tau_b = 1` (a bulk viscosity that damps
  sound). The ghost modes that make the plain BGK collision unstable at small viscosity are discarded every step.
- **Sub-grid model.** Smagorinsky with the strain rate read from the non-equilibrium stress (Hou et al. 1996):
  `tau = (tau_0 + sqrt(tau_0² + 18 sqrt(2) Cs² |dev Pi| / rho)) / 2`, `Cs = 0.16`. `model.turbulence: 'auto'`
  (default) switches it on when the cell Reynolds number `U h / nu` exceeds 10 and the Reynolds number of the study
  exceeds 2000, and off otherwise; the rule is the same for every case, nothing is tuned per case. `'wale'` (Nicoud &
  Ducros 1999, `Cw = 0.5`, the velocity gradient by central differences of the last step) is available and not
  validated: on the cube case it gave erratic drag (0.45 to 1.37 in four runs), so `auto` does not use it.
- **Collision variants.** `model.collision: 'trt'` (two relaxation times, magic product 3/16) keeps a bounce-back wall
  on a curved boundary where it is at small viscosity, for laminar flow only. It diverged next to inlets, outlets and
  no-slip walls at relaxation times of 0.501 to 0.51, so the default (`'auto'`) is the regularised collision; use
  `'trt'` for closed or periodic laminar flows (a plane channel at relaxation time 0.501: -1.6% regularised, +0.8% TRT).
- **Walls.** Interpolated bounce-back (Bouzidi, Firdaouss & Lallemand 2001) with the link fraction `q` taken from the
  signed distance to the geometry, so a wall sits where the geometry puts it, to second order, not on the staircase.
  What the interpolation would create or destroy in mass is taken from the rest population of the same cell, so walls
  conserve mass. `model.walls: 'halfway'` uses the plain half-way bounce-back.
- **Wall function.** With a sub-grid model on, boundary layers are not resolved and a no-slip wall then takes a shear
  set by the lattice (measured: a skin-friction coefficient of 0.056 on a tunnel floor, ten times a turbulent boundary
  layer's). A fluid cell next to a **smooth** wall therefore treats its wall as slipping with the cell's own tangential
  velocity and takes the wall shear stress of a power law, `u+ = 8.3 (y+)^(1/7)` (Werner & Wengle 1991), with the
  viscous law below it (measured: `Cf` = 0.0055 on the same floor). "Smooth" means `h` times the Laplacian of the
  signed distance (the convex curvature) is under 0.05, a convex radius of 20 cells: flat walls, large surfaces and the
  inside of pipes take the wall function; the cells within a few cells of a sharp convex edge, and round a small body,
  are plain no-slip bounce-back, so the geometry fixes the separation. (With the limit at 0.5 the free cube's drag
  coefficient was 0.53; at 0.05 it is 0.91, without the wall function 0.94: the slip next to an edge kept the flow
  attached.) `model.wallFunction: false` switches it off.
- **Inlets** are walls that "move" with the inlet velocity (velocity bounce-back): the mass that enters per link is
  exactly `rho c . u`. An inlet also gives way to sound: its velocity is lowered by `(rho - <rho>) / sqrt(3)` with `rho`
  the mean density on the inlet and `<rho>` its slow average, so start-up pressure waves leave through the inlet and a
  steady flow has exactly the velocity given.
- **Outlets** are anti-bounce-back pressure boundaries (gauge pressure 0 unless given), or velocity boundaries when an
  outlet is given by a flow rate.
- **Tunnel sides** are specular (free slip); a ground is a no-slip wall (with the wall function), a moving belt, or a
  slip plane.
- **Forces** by momentum exchange on every wall link (Ladd 1994), plus the wall-function shear, summed per named part.
  In an external study they are referred to the static pressure of the free stream (below).
- **Reference pressure (external).** The outlet holds gauge pressure 0; the static pressure of the stream ahead of the
  body is higher by the losses of the tunnel (drag, wake). As in a wind tunnel, the reference is the mean pressure on
  the inlet over the averaged steps (`setup.external.referencePressure`): every pressure, pressure coefficient and force
  of an external result is gauge to it. For a body standing on the ground the footprint matters: the force a uniform
  1 Pa puts on each part (`Flow.pressureArea()`, zero for a body surrounded by fluid) times the reference is taken off.
- **Flow rates** are the mass that crosses each inlet and outlet link: what enters minus what leaves is the change of
  the mass in the box.
- **Units.** `dt = latticeSpeed h / referenceSpeed`; `nu_lattice = nu dt / h²`; pressure `rho (h/dt)² (rho_lattice - 1) / 3`.
- **Determinism.** Fixed loop orders and only `+ - * /` and the square root: repeat runs are bit-identical.
  `Flow.saveState()` / `restoreState()` resume bit-exactly.

## Frame and units

Everything is SI: metres, seconds, kilograms, newtons, pascals; flow rates in m³/s. Results are in the frame of the study
(nothing is recentred or rotated). The frame is any right-handed one; `external.up` says which axis is up (default
`+y`). Rotations are unit quaternions **`[x, y, z, w]`** taking local to world coordinates. A **box** takes either its
**full** extents `size` or its half extents `halfExtents` along its local x, y, z (exactly one). A **cylinder**,
**capsule**, **cone** and **tube** lie along their **local +y**: either `from` and `to`, or `center`, `rotation` and the
**full** `length` (or `halfLength`); a capsule's length is the segment between the centres of its end spheres. These
are the conventions of `apex-flow-geometry/1` (metres, +y up, right-handed, xyzw, FULL box sizes, cylinders along
local +y with their full length), so its items map one to one.

## Geometry

An item is a **solid** (default) or a **cavity** (`role: 'cavity'`). With cavities the solid is everything outside
their union, plus the solid items: a pipe drawn by its bore is a cylinder cavity, a tank a box cavity, a valve disc a
solid inside. Every item may name a `part`; forces and surfaces are reported per part (default part `"body"`), and may
carry an `id` (the model's element id), which the report repeats.

| `kind` | Fields | Notes |
|---|---|---|
| `box` | `center`, `size` (full) or `halfExtents`, `rotation?` | |
| `sphere` | `center`, `radius` | |
| `cylinder`, `capsule` | `radius` and an axis | flat ends / round ends |
| `cone` | `radius` (at `from`, the -y end), `radiusTop` (at `to`) and an axis | a frustum; one radius may be 0 |
| `tube` | `radius`, `innerRadius` and an axis | a pipe wall, open at both ends |
| `beam` | `from`, `to`, `width`, `depth`, `up?`, `section?: 'rect' \| 'i'`, `flange?`, `web?` | `depth` along `up`, `width` across |
| `mesh` | `positions` (x, y, z per vertex), `indices?`, `thickness?`, `elements?`, `position?`, `rotation?`, `scale?`; or `file` | triangles; without `indices` every three vertices are a triangle |
| `apex` | `document` or `file`, `role?`, `partName?: 'id' \| 'name'`, `parts?` | every primitive and mesh of an `apex-flow-geometry/1` document |

An **axis** is `from` and `to`, or `center`, `rotation` and `length` / `halfLength` (the axis is the local +y).

**Voxelisation.** Each primitive is evaluated (an exact signed distance) only on the cells of its own bounding box plus
a band of 4 cells, and each mesh component on its own bounding box: the work is proportional to the cells near each
item, not to cells times items. Distances are exact within the band.

**Meshes.** Vertices are welded (10⁻⁶ of the bounding box) and the mesh is split into connected components. A closed
component (every edge shared by an even number of triangles) is signed by ray parity along the three axes through
every cell centre with a majority vote, so the winding does not matter and a ray that slips through a crack is
outvoted; overlapping closed components are united. An open component with a `thickness` (0 allowed) is a shell of
that thickness; without one it is filled by parity, with a warning. `elements` (the layout of an
`apex-flow-geometry/1` mesh: `{element?, triStart, triCount, closed, thickness?}`) says per run of triangles whether it
is a closed solid or an open surface of a thickness; triangles in no run take the mesh's `thickness`.

**Walls do not leak.** A lattice link that crosses a wall has an end within `sqrt(2)/2` cells of it, so a sheet at
least **1.44 cells** thick blocks every link. A plate-like solid primitive (thin in one direction: a panel, a disc, a
pipe wall) or an open mesh thinner than that is **grown to 1.44 cells** about its mid-surface; in a closed mesh, every
link that crosses the surface between two fluid cells has its end nearer to the surface made solid. Both are reported:
`setup.geometry.thickened` (items grown), `largestThickening` (metres added), `closedCells` (cells made solid), the
per-item `thickened` and `thickenedCells`, and a warning. Slender items (thinner than a cell in two directions: rods,
cables) are not walls; they are counted in `slender` and warned about.

**What the grid did to the geometry** is in `setup.geometry`: for each item (all of them up to 100 items, else those
the grid changed or could not hold, at most 200) its smallest dimension when the definition gives one, its surface
area inside the box, and the fraction of that surface with no cell of the item within 1.25 cells. Warnings are raised
when an item's smallest dimension is under two cells ("coarse"), when more than 5% of a surface is unresolved, and
when walls were grown. The **resolved feature size** is about two cells (`2 setup.grid.cell`).

## The study document: `box3d-flow-study/1`

Unknown fields are errors (a typing mistake is not silently ignored).

| Field | Type | Meaning |
|---|---|---|
| `format` | `"box3d-flow-study/1"` | required |
| `name` | string | copied to the result |
| `units` | `"SI"` | optional; nothing else is accepted |
| `geometry` | array of items | see [Geometry](#geometry) |
| `fluid` | `"air"`, `"water"`, or `{name?, density, viscosity}` or `{name?, density, dynamicViscosity}` | kg/m³; `viscosity` kinematic, m²/s; `dynamicViscosity` Pa s. Air 1.204 kg/m³, 1.825·10⁻⁵ Pa s; water 998.207 kg/m³, 1.0016·10⁻³ Pa s (20 °C, the material library) |
| `mode` | `"external"` or `"internal"` | required |
| `external` | object | required for `external`, see below |
| `internal` | object | required for `internal`, see below |
| `motion` | `{partName: {velocity?, angularVelocity?, center?}}` | surface velocity of a part, m/s and rad/s about `center`. The solid does not move (a frozen rotor, a belt) |
| `actuators` | array of `{name, center, axis, radius, thickness?, force \| pressureJump}` | actuator discs: a momentum source over the fluid cells of a disc; `force` N on the fluid along `axis`, or `pressureJump` Pa |
| `resolution` | `{cells?, cellSize?, latticeSpeed?}` | `cells`: budget of **fluid** cells, default 400,000. `cellSize` (m) is used when it fits the budget. `latticeSpeed`: reference speed in cells per step, default 0.06 |
| `model` | `{turbulence?, smagorinsky?, wale?, wallFunction?, walls?, collision?, spongeCells?, thicken?}` | `turbulence`: `"auto"` (default), `"none"`, `"smagorinsky"`, `"wale"`; `wallFunction` default true; `walls`: `"interpolated"` (default) or `"halfway"`; `collision`: `"auto"` (= regularised), `"regularized"`, `"trt"`; `thicken` default true |
| `run` | object | run lengths, see below |
| `outputs` | object | what to post-process, see below |

### `external`: a tunnel around the geometry

| Field | Default | Meaning |
|---|---|---|
| `speed` | required | free-stream speed, m/s |
| `direction` | `[1, 0, 0]` | direction the fluid moves toward, any direction (normalised). A side of the box is an inlet where the stream enters (component above 0.2), an outlet where it leaves, else a slip wall |
| `up` | `[0, 1, 0]` | the lift axis, along one coordinate axis |
| `ground` | `false` | `true` or `{height?, type?}`: a plane normal to `up` at `height` (default: the lowest point of the geometry). `type`: `"fixed"` (default, no-slip with the wall function), `"moving"` (slides with the stream), `"slip"` (a symmetry plane). The geometry below the ground is removed; the direction must be parallel to the ground |
| `margins` | `{upstream: 3, downstream: 6, side: 2.5, top: 2.5, bottom: top}` | free space around the bounding box of the geometry, in multiples of `margins.length` |
| `margins.length` | `referenceLength` when given, else the body size across the flow (the larger of its height and its width seen along the flow) | m |
| `domain` | | `{min, max}`: the box itself, instead of margins |
| `referenceLength` | largest extent of the geometry | m; for the Reynolds number and the moment coefficients |
| `referenceArea` | shadow of the solid cells along the flow | m²; for the coefficients |
| `momentCenter` | centre of the bounding box | point the moments are taken about |

The box grows to whole cells on the downstream and upper sides. The fluid starts at the free-stream velocity. Solid
items only (no cavities). Coefficients: `cd` along `direction`, `cl` along `up` made normal to the direction, `cs` along
`direction × up`. A ground of type `"moving"` under a body that stands on it makes a singular corner (the belt drives
the fluid into the junction; measured surface `cp` up to 2.2 there): leave a gap, as wheels do.

### `internal`: flow through a cavity

Two kinds of domain, both by the `role` of the items:

- **Fluid layers**: the items are the fluid (`role: "cavity"`): a pipe run drawn as round members whose diameter is
  the bore, a tank as a box. Everything outside their union is wall. Ends of the members are closed unless an opening
  is placed on them.
- **Cavity**: the items are the walls (`role: "solid"`, a tunnel lining, a casing) and the fluid is the space they
  enclose; the box of the study (`domain` or the bounds plus `padding`) closes the rest. Fluid that no opening reaches
  is made solid (`setup.lattice.enclosedCells`).

| Field | Default | Meaning |
|---|---|---|
| `inlets` | `[]` | `{name, shape, flowRate \| speed \| velocity, profile?}`: volume flow **into** the fluid m³/s, or mean speed into the fluid m/s, or a velocity vector. `profile`: `"uniform"` (default), `"parabolic"` or its alias `"developed"` (`1 - (r/R)²` on a disc, `(1 - (x/a)²)(1 - (y/b)²)` on a rectangle, scaled to the flow rate: peak twice the mean on a disc) |
| `outlets` | `[]` | `{name, shape, pressure?}` (gauge, Pa, default 0), or `{name, shape, flowRate \| speed, profile?}`: flow **out of** the fluid. At least one outlet must be given by a pressure (with every opening's flow imposed, the pressure level and the mass in the box drift) |
| `domain` | bounds of the geometry | `{min, max}` |
| `padding` | 0 | metres added around the bounds of the geometry |
| `referenceSpeed` | the fastest opening (peak of a parabolic profile) or the total inflow over the smallest pressure outlet | m/s; sets the time step. Give it when the flow is faster somewhere inside (a nozzle, a valve seat) |
| `referenceLength` | diameter of the circle with the area of the first inlet | m; the Reynolds number is this times the mean speed of the first inlet over the viscosity |
| `acceleration`, `periodic`, `initialVelocity` | | a duct driven by a body force (m/s²) with periodic axes (`["x"]`), instead of openings; `referenceSpeed` is then required |

A **shape** is `{kind: "disc", center, normal, radius}` or `{kind: "rect", center, normal, up?, halfWidth, halfHeight}`.
The `normal` is the **outward normal of the fluid domain**: it points out of the fluid through the opening (for an
inlet, against the inflow; for an outlet, along the outflow), as in `apex-flow-geometry/1` studies. The cells within
2.5 cells outside the plane and inside the shape become the opening, whatever they were; a cell of that slab that has no
fluid in front of the plane stays wall, so a pipe that ends inside the box is fed only through its end. Place the plane
at the end of the pipe (it may lie on a side of the box). Sides of the box that are not openings are walls. Openings
that touch no fluid cell raise a warning. The pressure of an internal result is gauge to the pressure outlets' 0.

### `run`

Lengths are in **transits**: the length of the box along the flow (external) or its longest side (internal) over the
reference speed (`setup.transitTime`).

| Field | Default | Meaning |
|---|---|---|
| `transits` | 8 external, 12 internal | the longest the run may be |
| `startupTransits` | 1 | discarded before averaging starts |
| `windowTransits` | 1.5 | length of an averaging window |
| `tolerance` | 0.02 | the run stops when two consecutive windows agree: external, the mean drag, lift and side force within `tolerance` of the drag; internal, every flow rate, every opening's pressure and the mean speed within `tolerance` of the largest of their kind |
| `maxSteps` | | a cap on the steps, below `transits` |
| `monitorEvery` | window / 60 | steps between two entries of the history |
| `sampleEvery` | `monitorEvery` / 5 | steps between two samples of the time-averaged fields |

All reported means (forces, flow rates, fields, streamlines of the mean field) are over the **last completed window**.

A **laminar internal flow** (no sub-grid model) settles on the viscous time of its bore, `(D/2)² / (5.78 nu)`, which
at a high Reynolds number is many transits: the windows would agree while the profile still creeps. When that time is
longer than a transit, the run starts with the viscosity raised until it is one transit long (the developed profile does
not depend on the viscosity), holds it for two transits, lowers it to the fluid's own over the third, runs a fourth with
it and only then averages; the run is lengthened to fit two windows after that (`setup.controls.viscosityBoost`).

### `outputs`

| Field | Meaning |
|---|---|
| `streamlines` | `true` or `{seeds?, from?, count?, field?, step?, maxPoints?, stride?, direction?}`. `seeds`: `"auto"` (default: a grid upstream of the body over its shadow, or points spread over the inlets) or an array of `{kind: "rake", from, to, count}`, `{kind: "plane", origin, u, v, nu, nv}`, `{kind: "points", points}`. `from`: names of the inlets the automatic seeds are spread over. `count`: automatic seeds, default 64. `field`: `"mean"` (default) or `"instant"`. `step`: RK4 step in cells, default 0.5. `stride`: keep every n-th point, default 2. `maxPoints`: default 400. `direction`: `"forward"` (default), `"backward"`, `"both"` |
| `slices` | array of `{axis, position \| fraction, field?}`: a plane normal to `axis` at `position` (m) or `fraction` (0 to 1) of the box |
| `surface` | `true`: pressure and pressure coefficient at the vertices of the surface of every part |
| `lines` | array of `{name?, from, to, samples?, along?}`: the fields along a line (default 101 samples) and where the velocity component along `along` changes sign |
| `sections` | array of `{name?, axis, position, min?, max?}`: integrals over the cell layer at `axis = position`, optionally inside the box `min`..`max` |
| `history` | `false` leaves the convergence history out. Default `true` |

## The result document: `box3d-flow-result/1`

Numbers are rounded to six significant digits. Vectors are `[x, y, z]` in the frame of the study. Optional members are
absent when the output was not requested. Pressures are gauge (see the reference pressure under [Method](#method)).

| Member | Content |
|---|---|
| `format`, `name` | `"box3d-flow-result/1"`, the study's name |
| `solver` | `{id, version, statement, provenance}`: `id` `flow-lbm-d3q19-regularized-les-js-f64-v1`; `version` `1.0.0`; `statement` says what the solver is; `provenance` is the `provenance` option (the command line fills `{cli, solverVersion, package, sourceCommit}`), else `null` |
| `setup` | everything derived from the study, below |
| `run` | `{steps, time, wallTime, cellUpdatesPerSecond, converged, reason, windows, averaged, maxSpeed}`: `time` simulated s; `wallTime` s; `reason` `"tolerance"` or `"max-steps"`; `averaged` `{fromStep, steps, time, samples}` of the window the means are over (`null` when no sample was taken); `maxSpeed` m/s |
| `convergence` | `{tolerance, startupSteps, windowSteps, monitorEvery, history}`; `history` has parallel arrays `step`, `time`, `residual` (rms change of the velocity over an interval over the reference speed), `maxSpeed`, and external `cd`, `cl`, `cs`, internal `massBalance`, `bulkSpeed`, `flowRates` and `patchPressure` (by opening name) |
| `forces` | `{about, total: {force, moment}, parts: [{name, force, moment}], coefficients}`: N and N m about `about`, means over the window. `parts` lists the parts of the geometry, then the walls of the box that took force (the `ground`, sides by name); `total` sums the parts of the geometry only. `coefficients` (external; `null` internal): `{cd, cl, cs, cdRms, clRms, csRms, cm, referenceArea, referenceLength, dynamicPressure, axes: {drag, lift, side}}`, `cm = moment / (q A L)` |
| `extremes` | `{pressureMax, pressureMin, speedMax, dynamicPressure}` of the averaged field over the fluid cells: `{value, cp?, at}`; `cp = pressure / dynamicPressure`, `dynamicPressure = rho U² / 2` of the reference speed |
| `flow` | `{patches, inflow, outflow, massBalance, splits, pressureDrops, sections}`. `patches`: per opening `{name, kind, flowRate, area, meanSpeed, meanPressure, meanDynamicPressure, meanTotalPressure}`; `flowRate` m³/s **into** the box (negative at outlets), the mass that crossed its links; pressures are area means over the fluid cells touching the opening. `massBalance = (inflow - outflow) / inflow`. `splits`: per outlet its `fraction` of the outflow. `pressureDrops`: per inlet-outlet pair `{from, to, static, total}` Pa. `sections`: `{name, axis, position, area, flowRate, meanSpeed, maxSpeed, maxNormalSpeed, meanPressure, meanTotalPressure, momentumFactor}` (`flowRate` along +axis; peak over mean is `maxNormalSpeed / meanSpeed`) |
| `actuators` | per disc `{name, cells, force, axis, area, pressureJump, meanSpeed, flowRate, power}` |
| `wake` | external `{shedding, recirculationLength, recirculationFrom}`: `shedding` `null` or `{frequency, strouhal, length, periods, amplitude, axis}` from the cross-flow force history (`length` the size of the body inside the box along the oscillating force; an oscillation with a Strouhal number outside 0.05 to 0.6 is not reported as shedding, a warning says so); `recirculationLength` from the rear of the bounding box along its centre line to where the mean streamwise velocity turns positive, or `null`. Internal: `null` |
| `streamlines` | `{field, speedRange, lines: [{seed, termination, points, speed, pressure}]}`: RK4 through the trilinear field; `points` x, y, z per vertex (m); `speed` (m/s) and `pressure` (Pa) per vertex; `termination` `"opening"` (entered an outlet, or an inlet when traced backwards), `"wall"`, `"outside"`, `"stagnation"`, `"length"` |
| `slices` | `{axis, position, axes: [u, v], nu, nv, origin: [u0, v0], cell, speed, pressure, u, v, fluid}`: row-major `nu × nv` samples (index `i + nu j`) at `origin + cell (i + 1/2, j + 1/2)` along the in-plane axes (x → y, z; y → z, x; z → x, y); `fluid` is 1 in the fluid |
| `surface` | per part `{part, positions, indices, pressure, cp, pressureMin, pressureMax, cpMin, cpMax}`: triangles (meshes as given, primitives tessellated at 1.5 cells), pressure read one cell out from the wall |
| `lines` | per line `{name, from, to, s, ux, uy, uz, speed, pressure, distance, zeroCrossings}` |
| `warnings` | strings: blockage, resolution, thickening, unresolved features, Mach number, non-convergence |
| `limits` | strings: the standing limits of the solver |

`setup` holds: `mode`; `fluid` `{density, viscosity}`; `grid` (the box of fluid cells: `origin`, `cell`, `nx`, `ny`,
`nz`, `min`, `max`); `lattice` (the box plus its boundary layers: `origin`, `cell`, `nx`, `ny`, `nz`, `cells`,
`fluidCells`, `solidCells`, `enclosedCells`, `boundaryLinks`; slices are sampled on it); `timeStep`; `latticeSpeed`;
`latticeMach`; `relaxationTime`; `cellReynolds`; `turbulence` `{model, constant, wallFunction, rule}`; `walls`;
`referenceSpeed`; `referenceLength` `{value, source}`; `reynolds`; `transitTime`; `external` (`speed`, `direction`, `up`,
`side`, `ground`, `bodySize`, `bodyCells`, `bodyBounds`, `blockage`, `referenceArea {value, source}`,
`dynamicPressure`, `momentCenter`, `margins`, `referencePressure {value, source}`; `null` internal); `internal`
`{inlets, outlets, fluidFraction}` (`null` external); `sides` (kind of `xMin` … `zMax`); `patches` (per opening `{name,
kind, area, normal, velocity, pressure, cells}`, `normal` outward); `parts`, `geometryParts`; `geometry` (the report
of [Geometry](#geometry)); `controls` (the run lengths in steps).

The **reference area** of an external study is the shadow of the solid cells along the flow: every solid cell is cut
into eight, the centres are dropped on a plane grid of half the cell size, and the squares hit are counted
(`setup.external.referenceArea.source` says so; a given `referenceArea` is `"given"`). The **blockage** is that shadow
over the cross-section of the tunnel; above 5% a warning is raised and nothing is corrected.

## Programming interface

`box3d-webgpu-kit/flow` (TypeScript declarations in the package; `packages/box3d-kit/api/API.md` lists every export).

```ts
runFlowStudy(study, options?): result              // set up, run, post-process
createFlowStudy(study, options?): FlowStudyRun     // {setup, flow, done, advance(), result()}: step it yourself
flowStudySetup(study, options?): FlowStudySetup    // check a study and work out the set-up without running
// options: {onProgress?(p), loadMesh?(file) => {positions, indices?}, loadDocument?(file) => object, now?() => ms,
//           provenance?: {key: string | number | boolean | null}}

flowItemsFromApexGeometry(document, {role?, partName?, parts?}): FlowItem[]   // apex-flow-geometry/1 to items
new Flow(options)                                  // the solver: grid, geometry, fluid, sides, patches, motion, actuators
  .step(n) .time .dt .forces(about) .takeSums(about) .pressureArea(about) .accumulate() .field(mean)
  .saveState() .restoreState(state)
flowVoxelize(items, grid)                          // signed distance, parts, surfaces, report
flowGeometryBounds(items)  flowTubeMesh(path, radius, segments)  flowPrimitiveSurface(item, size)
flowStreamlines(field, seeds, options)  flowRake(from, to, count)  flowSeedPlane(origin, u, v, nu, nv)
flowSlice(field, axis, position)  flowSurfacePressure(field, surfaces)  flowLine(field, from, to, samples, along)
flowSection(field, density, axis, position, bounds)  flowProjectedArea(grid, solid, direction)  flowFrequency(samples, dt)
flowSample(field, x, y, z, out)                    // trilinear [ux, uy, uz, pressure, distance]
FlowLattice                                        // the kernel in lattice units
FLOW_STUDY_FORMAT, FLOW_RESULT_FORMAT, FLOW_SOLVER_ID, FLOW_SOLVER_VERSION, FLOW_MARGINS, FLOW_LIMITS, FLOW_STATEMENT
```

`Flow` takes the sides of the box directly (`'wall'`, `'slip'`, `'periodic'`, `{kind: 'velocity', velocity}` with a
vector or a function of the position, `{kind: 'pressure', pressure}`, `{kind: 'wall', velocity, part}`), which is how
the validation cases set up channels and tunnels.

## Command line and the single-file bundle

```
box3d-flow study.json --out result.json [--quiet] [--setup]
```

Reads the study, resolves meshes given by `file` (`.stl` binary or ASCII, `.obj`, or `.json` with `positions` and
`indices`) and `apex` documents given by `file`, relative to the study file; prints the set-up and a progress line per
second (step, fraction, phase, window, residual, coefficients or mass balance) to standard error; writes the result (to
standard output without `--out`). `--setup` prints the set-up and stops. Exit codes: 0 converged; 2 ran to its step limit
without converging (the result is still written); 1 an invalid study, a missing file or a diverged run.

`box3d-webgpu-kit/flow-bundle` (`dist/flow-bundle.js`) is the whole flow entry as **one ES module** with no imports and
no WebAssembly, for vendoring: its header names the package version and the source commit it was built from, and it
exports `FLOW_SOURCE_COMMIT`. Copy it with its sha256 sum.

## Requirements of the apex flow studies

| Requirement | Supported | How |
|---|---|---|
| `apex-flow-geometry/1` in: metres, +y up, right-handed, xyzw, not recentred; boxes with FULL sizes; flat-ended cylinders along local +y; meshes with per-element closed / open and thickness; part index and element id on every item | yes | `{kind: 'apex', document}` items or `flowItemsFromApexGeometry`; part names from the layer `id` (or `name`), element ids in `setup.geometry.report[].id`. Capsules and spheres also work |
| Hundreds of thousands of elements, spatial binning | yes | per-item bounding boxes (see [Geometry](#geometry)); the report is cut to 200 items |
| Force and moment per part and in total | yes | `forces.parts`, `forces.total` |
| Conservative thin-wall rasterisation, report of the thickening | yes | grown to 1.44 cells; `setup.geometry` and a warning |
| Fluid-layer domains | yes | `role: 'cavity'` items; named openings are inlets / outlets, the rest closed |
| Studies of 72 M and 34 M dense cells against budgets of 3 M and 2 M | **partly** | populations are stored for fluid cells only, so a pipe network's cost is its fluid; but the box still holds about 15 to 45 bytes per cell (cell kinds, distances, the fields for slices), so a box is limited to 2²⁵ = 33.5 M cells. A study whose box at the wanted cell size exceeds that gets coarser cells and a warning (a 72 M box: cells 1.29 times larger, 2.15 times fewer fluid cells). The largest network that fits at a given cell size is one whose bounding box holds 33.5 M cells; cropping (`internal.domain`) is the remedy. No multi-block |
| Cavity domains | yes | solid items, `domain` or `padding` |
| External: inflow in any horizontal direction, ground at a height fixed / moving / slip, geometry below removed, margins in multiples of a reference length | yes | `external` |
| Internal: round openings with outward normal and radius; inlet by flow rate or mean velocity, uniform or parabolic ("developed"); outlet by gauge pressure or flow rate | yes | `internal.inlets` / `outlets` (one outlet must be by pressure) |
| Max surface Cp; mean pressure and flow per opening; peak velocity on a section; mass imbalance; streamlines with speed; axis-plane slices; surface pressure per part; convergence history; solver id, version and source commit | yes | `surface[].cpMax`, `extremes`; `flow.patches`; `flow.sections[].maxNormalSpeed`; `flow.massBalance`; `streamlines`; `slices`; `surface`; `convergence`; `solver` |
| Laminar pipe flow (Hagen–Poiseuille within 10% at Re 1107), a sharp-edged building (Cd 1.0–1.7) | **building yes, pipe at Re 1107 no** | the building: Cd 1.107, largest Cp 1.163 at 8 cells across. The pipe: within 4.8% at Re 100, but 63% (12.6 cells) and 42% (17.9 cells) high at Re 1107 ([Validation](#validation) says why) |
| Node-importable single-file bundle and the CLI | yes | `flow-bundle`, `box3d-flow` |

## Drawing results with three.js

`box3d-webgpu-kit/flow-three` (no dependency on three: pass your `THREE` namespace in):
`createFlowView(THREE, result, options)` builds a group with the streamlines as tubes (or lines) coloured by speed or
pressure, the surfaces of the parts (plain, or coloured by the pressure coefficient) and the slices as coloured planes
with the solid left out; `flowLegend(context2d, {min, max, title, unit, colormap})` draws the colour scale on a canvas;
`flowColormap(name)` gives the colour maps (`rainbow`, `turbo`, `viridis`, `coolwarm`). `flow-demo.html` (built with the
site) shows four studies, run in a worker in the page (`?study=car|cylinder|manifold|tank`); `?result=<url>` draws a result document computed elsewhere instead.

## On the GPU

The step is one gather per fluid cell, the natural form of a compute pass: `src/engine/gpu/flow-gpu.ts` (kit:
`box3d-webgpu-kit/gpu`) holds the WGSL shader, its float32 CPU reference `FlowLatticeF32` and the device backend
`GpuFlowLattice`; the host sums forces and flow rates from the link fluxes the shader writes. It covers streaming,
interpolated and half-way walls, inlets, outlets, slip sides, the regularised collision and the Smagorinsky model; not
the wall function, WALE, the two-relaxation-time collision, absorbing inlets, sponges or actuator discs. **The shader
compiles and encodes on Dawn, but it was not run on any device** (no GPU here): the float32 reference follows the
float64 solver to 2.3e-6 of the reference speed over 200 steps of a turbulent tunnel, and its laminar pipe is 2.5% off
Hagen-Poiseuille (float64: 1.8%). The study runner does not use the GPU. Details: [`GPU_COMPUTE.md`](GPU_COMPUTE.md#flow).

## Validation

40 cases in the validation registry (`validation/domains/flow.mjs`, [`VALIDATION.md`](VALIDATION.md)), asserted with the
same bands by `packages/box3d-kit/test/v24-flow.test.mjs`; the set-ups are in `packages/box3d-kit/test/flow-scenarios.mjs`.
Every measured number below was produced by running the solver (`node scripts/validation-report.mjs --only flow`, all
40 pass). Bands were chosen from the resolution of each case and are stated before the result; a case that misses its
band is listed under "Measured, not in the registry" instead of having its band widened. The cylinder references were
read from the tables of Cui et al. (2019); Williamson's Strouhal fit, the Schiller-Naumann correlation, Hoerner's drag
coefficients and Armaly's reattachment length are from memory, not checked against a source opened while writing. Wall times are of single runs
on a 4-core machine shared with two other jobs (load 8 to 11); an idle machine was not measured.

| Case | Reference | Measured | Error | Band | Resolution | Wall time |
|---|---|---:|---:|---|---|---:|
| Plane Poiseuille, walls off the grid lines (mesh) | `G H³ / (12 nu)` | 0.08047 m³/s | -3.43% | ±5% | 8 cells across | 1 s |
| Square duct (mesh) | series solution | 0.8366 m³/s | -4.78% | ±5% | 8 cells across | 3 s |
| Round pipe, cylinder | `pi R⁴ G / (8 mu)` | 0.3588 m³/s | -2.54% | ±3% | 12 cells across | 2 s |
| Round pipe, swept mesh (48 sides) | same | 0.3574 m³/s | -2.93% | ±3% | 12 cells across | 3 s |
| Round pipe at 24 cells, relaxation time held at 0.6 | same | 0.3646 m³/s | -0.97% | ±2% | 24 cells across (12 and 16 cells: -2.2% at this relaxation time) | 5 s |
| Round pipe, wall force / body force - 1 | 0 | -9.7e-10 | | ±1e-6 | 12 cells | |
| Pipe through openings, Re 100: pressure drop over 2 D | `128 mu L Q / (pi D⁴)` = 0.64 Pa | 0.6709 Pa | +4.82% | ±5% | 12.6 cells across | 17 s |
| Pipe through openings, Re 100: peak / mean speed | 2 | 2.0126 | +0.63% | ±3% | same | |
| Pipe through openings, Re 100: mass balance | 0 | 7.1e-8 | | ±1e-4 | same | |
| Cylinder Re 20: Cd | 2.091 (Wu & Shu; 2.11, 2.144 elsewhere) | 2.182 | +4.36% | ±8% | 8 cells, blockage 4.2% | 76 s |
| Cylinder Re 20: recirculation length / D | 0.93 | 0.933 | +0.33% | ±8% | same | |
| Cylinder Re 40: Cd | 1.539 (1.56, 1.589) | 1.640 | +6.54% | ±10% | same | 85 s |
| Cylinder Re 40: recirculation length / D | 2.23 (2.20, 2.26) | 2.344 | +5.11% | ±10% | same | |
| Cylinder Re 100: mean Cd | 1.334 (Ding et al. 1.325) | 1.472 | +10.3% | ±15% | 10 cells, blockage 6.3% | 104 s |
| Cylinder Re 100: Strouhal number | Williamson (1988): 0.1643 | 0.1706 | +3.8% | ±8% | same | |
| Cylinder Re 200: Strouhal number | 2D computations: 0.196 | 0.1992 | +1.66% | ±8% | same | about 100 s |
| Sphere Re 100: Cd | Schiller-Naumann 1.092 | 1.265 | +15.8% | ±20% | 8 cells, blockage 3.1% | 131 s |
| Cube face-on, Re 1e5: Cd | Hoerner 1.05 | 0.914 | -13.0% | ±15% | 8 cells, blockage 4% | 198 s |
| Square plate, Re 1e5: Cd | Hoerner 1.17 | 1.039 | -11.2% | ±15% | 8 cells, plate grown to 1.44 cells | 181 s |
| Building 12 x 30 x 20 m on fixed ground, study runner defaults: Cd | apex band 1.0 to 1.7 | 1.107 | in band | 1.35 ± 0.35 | 8.2 cells across, blockage 2.9% | 114 s |
| Same: largest surface Cp | 1 | 1.163 | +0.163 | ±0.2 | same | |
| Backward-facing step, Re 100: x_r / S | Armaly et al. (1983), from memory: 3.0 | 2.758 | -8.1% | ±12% | 16 cells over the inlet channel | 29 s |
| Sudden expansion D2 = 2 D1, Re 5e4: pressure rise | Borda-Carnot 0.1875 rho U1² | 0.1995 | +6.39% | ±15% | 7.6 cells across D1, LES | 75 s |
| Symmetric tee: split to one arm | 1/2 | 0.4821 | -0.018 | ±0.03 | about 8 cells across, LES | 21 s |
| Symmetric tee: mass balance | 0 | 9.0e-5 | | ±1e-3 | same | |
| Tank, three inlets and one outlet: mass balance | 0 | -2.0e-4 | | ±1e-3 | 10,300 fluid cells, LES | 11 s |
| Tank: flow at the inlets against the flow given | 0 | 1.5e-4 | | ≤ 1e-3 | same | |
| Stokes drag, 2.4 cells per radius | Hasimoto (1959) | -6.98% | | ±10% | 16³, Re 0.1 | |
| Stokes: drag / body force on the fluid - 1 | 0 | -2.1e-7 | | ±1e-6 | same | |
| Mass through openings and walls (200 steps) | 0 | -3.0e-15 | | ±1e-12 | tunnel with two bodies | 5 s |
| Mass in a closed periodic box (300 steps) | 0 | 3.7e-18 | | ±1e-12 | 20³ | |
| Repeatability; resume from a checkpoint | bit-identical | 0 and 0 runs differ | | 0 | turbulent tunnel | 7 s |
| Mesh against primitive: sphere; box | 0 cells | 6 (of 1,572 solid); 0 | | ≤ 12; 0 | 24³ | 2 s |
| Imperfect meshes: triangle soup, flipped triangles; a hole | 0 cells | 0; 0 | | 0 | 24³ | 2 s |
| Thin walls 0.18 cells thick (five ways): boxes that leak | 0 | 0 | | 0 | 20³ | 1 s |
| Streamline, uniform flow: off the line | 0 | 1.2e-6 cells | | ≤ 1e-4 | 32³ | |
| Streamline, solid-body rotation: radial error over one turn | 0 | 1.2e-7 | | ≤ 1e-4 | 32³, steps of 0.5 cell | |

The whole domain runs in about 17 minutes on that machine (10 CPU minutes).

**Measured, not in the registry (misses):**

| Case | Reference | Measured | Error | Resolution |
|---|---|---:|---:|---|
| Pipe through openings, **Re 1107** (the apex gate): pressure drop | Hagen-Poiseuille | +63% (peak / mean 1.90) | +63% | 12.6 cells across, relaxation time 0.501 |
| Same | | +42% (peak / mean 1.93) | +42% | 17.9 cells across, relaxation time 0.5015 |
| Same with the two-relaxation-time collision | | diverged | | 12.6 cells |
| Sphere, Re 1e4: Cd | about 0.40 (standard drag curve) | 0.728 | +82% | 8 cells, LES |
| Cube on fixed ground, 8.5 cells, wall function next to edges allowed (an earlier curvature limit of 0.5) | about 1.0 to 1.2 | 0.81 | | the reason for the limit of 0.05 |

Why the Re 1107 pipe misses: the lattice viscosity of a pipe 12 to 18 cells across at Re 1107 is so small (relaxation
time 0.501) that the regularised collision, which relaxes the odd non-equilibrium moments at once, moves a bounce-back
wall on a staircase boundary inward (a plane channel aligned with the grid is unaffected: -1.6% at the same relaxation
time). The error falls slowly with the cell count (63% at 12.6 cells, 42% at 17.9); the two-relaxation-time collision
that fixes the wall diverged next to the openings. **The apex gate (Hagen-Poiseuille within 10% at Re 1107) is not met
at affordable resolution.** At Re 100 the same study is within 4.8%.

## Cost

One JavaScript thread, float64. The cost is the number of fluid cells times the number of steps; a step costs 0.24
to 0.45 microseconds per fluid cell on this machine under load (2.2 to 4.2 million cell updates per second measured in
the demo studies below; not measured on an idle machine). The step count is the run length in transits times the box
length in cells over `latticeSpeed` (0.06 cells per step): a box 100 cells long takes 1,700 steps per transit.

| Demo study (flow-demo.html, the same documents run by `runFlowStudy` on Node) | Box cells | Fluid cells | Steps | Wall time | Cell updates per second |
|---|---:|---:|---:|---:|---:|
| Car-like body on a moving ground, 30 m/s | 215,604 | 187,143 | 4,625 | 206 s | 4.2 M |
| Cylinder wake, Re 100 | 71,100 | 45,452 | 7,400 | 100 s | 3.4 M |
| Pipe bend and manifold, water | 383,616 | 46,472 | 16,000 | 343 s | 2.2 M |
| Tank with three inlets and one outlet, water | 243,360 | 72,070 | 5,867 | 131 s | 3.2 M |

Memory: about 420 bytes per fluid cell (two population arrays, the source table, the fields and their means) and 15 to
45 bytes per cell of the box (kinds, distances, and the full fields when slices or streamlines are asked for). The box
holds at most 2²⁵ = 33.5 million cells.

## Limits

- **Boundary layers are not resolved.** The wall function models the friction of an attached turbulent boundary layer
  on smooth walls; separation from smooth curved surfaces (spheres, cylinders at high Reynolds number, streamlined
  bodies, wings, ship hulls) is an estimate and the drag crisis is not predicted. Sharp-edged bodies, whose separation
  the geometry fixes, are predicted better.
- **Incompressible flow only.** The lattice Mach number of the reference speed is `sqrt(3) × latticeSpeed`, 0.10 by
  default; the physical flow should be below **Mach 0.3**. No shocks, no heating by compression. A warning is raised
  when the largest speed passes three times the reference.
- **No free surface.** Spillways, hulls at the water line and open channels need the free-surface solver
  ([`FLUID.md`](FLUID.md#free-surface)) or the shallow-water solver ([`SHALLOW_WATER.md`](SHALLOW_WATER.md)). A spillway
  or a ship can be run here only as a fully submerged, single-fluid shape, or with a slip ground as the water line.
- **No rotating or moving geometry.** No sliding mesh. A rotor is a frozen solid, optionally with the surface velocity
  of its rotation (`motion`), or an actuator disc (`actuators`): neither gives the torque, efficiency or blade loads.
- **No heat transfer**, no buoyancy, no cavitation, one fluid. The heat solver is not coupled.
- **Uniform grid** of at most 2²⁵ cells per box. Features under two cells are coarse, under one cell lost; thin walls
  are grown to 1.44 cells.
- **Tunnel walls are slip planes**; the blockage is reported, not corrected.
- **A steady state is reached by marching in time**; the convergence monitor compares window means, so a slow drift
  longer than two windows passes as converged.
- **Not certified.** No case here is a substitute for a code check, a wind-tunnel test or a validated commercial solver.
