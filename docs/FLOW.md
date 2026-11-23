# Flow around and through geometry

`box3d-webgpu-kit/flow` computes the flow of one incompressible fluid around a body (a virtual wind or water tunnel) or
through a cavity (pipes, ducts, manifolds, tanks with inlets and outlets), from geometry given as oriented primitives
and triangle meshes in SI units. It reports forces and moments per part, drag, lift and side coefficients, surface
pressure, flow rates, pressure drops and flow splits, slices, streamlines and wake measures.

**What it is.** A weakly compressible lattice-Boltzmann solver (D3Q19, regularised collision, Smagorinsky sub-grid
model, interpolated bounce-back walls) on a uniform grid of cubic cells, float64 JavaScript, deterministic. Above a cell
Reynolds number of about 10 it is an under-resolved large-eddy simulation without a wall model: an engineering
estimate, **not certified CFD**. [Validation](#validation) lists what was measured against which reference, at what
resolution and with what error; [Limits](#limits) says what it cannot do.

The existing `box3d-webgpu-kit/fluid` (staggered-grid projection, [`FLUID.md`](FLUID.md)) is unchanged; it remains the
solver for resolved laminar flow with moving and coupled rigid bodies and for the free surface.

## Contents

- [Quick start](#quick-start)
- [Why this method](#why-this-method)
- [Method](#method)
- [Geometry](#geometry)
- [The study document: `box3d-flow-study/1`](#the-study-document-box3d-flow-study-1)
- [The result document: `box3d-flow-result/1`](#the-result-document-box3d-flow-result-1)
- [Programming interface](#programming-interface)
- [Command line](#command-line)
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
  geometry: [{kind: 'box', center: [0, 0.7, 0], halfExtents: [2.2, 0.7, 0.9], part: 'body'}],
  fluid: 'air',
  mode: 'external',
  external: {speed: 30, ground: {moving: true}},
  resolution: {cells: 400000},
  outputs: {streamlines: true, surface: true, slices: [{axis: 'z', fraction: 0.5}]},
}, {onProgress: p => console.log(p.step, p.maxSteps, p.coefficients)});

console.log(result.forces.coefficients.cd, result.setup.reynolds, result.warnings);
```

```
node packages/box3d-kit/bin/flow-cli.mjs study.json --out result.json
```

Both documents are plain JSON. JSON Schema files: `packages/box3d-kit/schemas/flow-study.schema.json` and
`flow-result.schema.json` (in the published package: `box3d-webgpu-kit/schemas/flow-study.schema.json`).

## Why this method

The existing volumetric solver is a pressure-projection method: each step solves a Poisson equation by conjugate
gradients, in float64 on one thread. That is the right tool for a resolved laminar flow and a coupled body. For flow
around voxelised engineering geometry at high Reynolds number the measured numbers favour a lattice-Boltzmann method:

| | Projection (`fluid`) | Lattice-Boltzmann (`flow`) |
|---|---|---|
| Cell updates per second, one thread, this machine | 0.33 million at 48³, falling as the grid grows (the pressure iterations grow with it; [`FLUID.md`](FLUID.md#cost)) | 6 to 10 million, independent of the grid size ([Cost](#cost)) |
| Steps per flow-through of a box N cells long | about 2 N (Courant number 0.5) | N / 0.06 = 17 N (the lattice speed) |
| Cell updates per flow-through at 48³, relative | 1 | about 0.35 (2.9 times faster); the ratio grows with the grid |
| Stability at small viscosity | central differences oscillate above a cell Reynolds number of a few; upwind is first order | regularised collision with the Smagorinsky model runs at cell Reynolds numbers of 10⁵ ([Validation](#validation)) |
| Arbitrary solid | four primitive kinds | any voxelised shape; the wall position enters through the link fractions |
| Parallel form | global linear solves | one local update per cell: a single compute pass on a GPU |

The price is the weak compressibility (an error of the order of the lattice Mach number squared, about 1%), a time
step tied to the cell size, and no implicit steady solver: a steady state is reached by marching in time.

## Method

Lattice units below: cell 1, step 1, reference density 1. `src/engine/flow-lattice.ts` is the kernel.

- **Lattice.** D3Q19: populations `f_i` with velocities `c_i` (rest, 6 axis and 12 edge neighbours), weights 1/3, 1/18,
  1/36, sound speed `1/sqrt(3)`. The arrays hold `f_i - w_i`.
- **Collision.** Regularised (Latt & Chopard 2006): after streaming, the density, momentum and stress
  `P = sum c_i c_i f_i` are computed and the populations are rebuilt from those ten moments, with the deviatoric
  non-equilibrium stress relaxed with `tau = 3 nu + 1/2` and its trace with `tau_b = 1` (a bulk viscosity that damps
  sound). The ghost modes that make the plain BGK collision unstable at small viscosity are discarded every step.
- **Sub-grid model.** Smagorinsky with the strain rate read from the non-equilibrium stress (Hou et al. 1996):
  `tau = (tau_0 + sqrt(tau_0² + 18 sqrt(2) Cs² |dev Pi| / rho)) / 2`, `Cs = 0.16`. `model.turbulence: 'auto'`
  switches it on when the cell Reynolds number `U h / nu` exceeds 10 and off otherwise (the rule is the same for
  every case; nothing is tuned per case).
- **Walls.** Interpolated bounce-back (Bouzidi, Firdaouss & Lallemand 2001) with the link fraction `q` taken from the
  signed distance to the geometry, so a wall sits where the geometry puts it, to second order, not on the staircase.
  What the interpolation would create or destroy in mass is taken from the rest population of the same cell, so walls
  conserve mass exactly. `model.walls: 'halfway'` uses the plain half-way bounce-back. There is **no wall model**.
- **Inlets** are walls that "move" with the inlet velocity (Ladd's velocity bounce-back): the mass that enters per face
  is exactly `rho U`. An inlet also gives way to sound: its velocity is lowered by `(rho - <rho>) / sqrt(3)` (the
  acoustic impedance), with `rho` the mean density on the inlet and `<rho>` its slow average, so the pressure waves of
  the start-up leave through the inlet instead of standing between inlet and outlet, and in a steady flow the velocity
  is exactly the one given.
- **Outlets** are anti-bounce-back pressure boundaries (gauge pressure 0 unless given).
- **Tunnel sides** are specular (free slip); a ground is a no-slip wall, optionally moving with the stream.
- **Forces** by momentum exchange on every wall link (Ladd 1994), summed per named part, with gauge pressure (a body
  standing on the ground takes no force from the ambient pressure under it).
- **Flow rates** are the mass that crosses each inlet and outlet link: what enters minus what leaves is the change of
  the mass in the box to round-off.
- **Units.** `dt = latticeSpeed h / referenceSpeed`; `nu_lattice = nu dt / h²`; pressure `rho (h/dt)² (rho_lattice - 1) / 3`.
- **Determinism.** Fixed loop orders and only `+ - * /` and the square root: repeat runs are bit-identical.
  `Flow.saveState()` / `restoreState()` resume bit-exactly.

## Geometry

An item is a **solid** (default) or a **cavity** (`role: 'cavity'`). With cavities the solid is everything outside
their union, plus the solid items: a pipe is a cylinder cavity, a tank a box cavity, a valve disc a solid inside.
Every item may name a `part`; forces and surfaces are reported per part (default part `"body"`).

| `kind` | Fields | Notes |
|---|---|---|
| `box` | `center`, `halfExtents`, `rotation?` | |
| `sphere` | `center`, `radius` | |
| `cylinder`, `capsule` | `radius` and an axis | flat ends / round ends |
| `cone` | `radius` (at `from`), `radiusTop` (at `to`) and an axis | a frustum; one radius may be 0 |
| `tube` | `radius`, `innerRadius` and an axis | a pipe wall, open at both ends |
| `beam` | `from`, `to`, `width`, `depth`, `up?`, `section?: 'rect' \| 'i'`, `flange?`, `web?` | `depth` is measured along `up`, `width` across; an I section needs `flange` and `web` |
| `mesh` | `positions` (x, y, z per vertex), `indices?`, `thickness?`, `position?`, `rotation?`, `scale?`; or `file` | triangles; without `indices` every three vertices are a triangle |

An **axis** is either `from` and `to` (two points), or `center`, `halfLength` and `rotation` (the axis is the local Y).
Rotations are unit quaternions `[x, y, z, w]`. All lengths are metres.

**Meshes.** Vertices are welded (10⁻⁶ of the bounding box) and the mesh is split into connected components.
A closed component (every edge shared by an even number of triangles) is filled by ray parity along the three axes
through every cell centre with a majority vote, so the orientation of the triangles does not matter and a ray that
slips through a crack is outvoted. Overlapping closed components are united. An open component with a `thickness` is a
shell of that thickness, never thinner than 1.74 cells (the thinnest sheet every lattice link is certain to hit);
without a thickness it is filled by parity with a warning. Distances are exact within 4 cells of the surface.

**What the grid did to the geometry** is reported in `setup.geometry` of the result: for each item its smallest
dimension when it is known from the definition, its surface area inside the box, and the fraction of that surface with
no cell of the item within 1.25 cells. Warnings are raised when an item's smallest dimension is under two cells
("coarse") or under one ("not resolved"), when more than 5% of a surface is unresolved, and when a shell had to be
thickened. The resolved feature size is the cell size `setup.grid.cell`: shapes are represented from about two cells up.

## The study document: `box3d-flow-study/1`

Unknown fields are errors (a typing mistake is not silently ignored). Schema:
`packages/box3d-kit/schemas/flow-study.schema.json`.

| Field | Type | Meaning |
|---|---|---|
| `format` | `"box3d-flow-study/1"` | required |
| `name` | string | copied to the result |
| `units` | `"SI"` | optional; nothing else is accepted |
| `geometry` | array of items | see [Geometry](#geometry) |
| `fluid` | `"air"`, `"water"`, or `{density, viscosity}` or `{density, dynamicViscosity}` | kg/m³; `viscosity` is kinematic, m²/s. The names are the 20 °C entries of the material library: air 1.204 kg/m³, 1.825·10⁻⁵ Pa s; water 998.207 kg/m³, 1.0016·10⁻³ Pa s |
| `mode` | `"external"` or `"internal"` | required |
| `external` | object | required for `external`, see below |
| `internal` | object | required for `internal`, see below |
| `motion` | `{partName: {velocity?, angularVelocity?, center?}}` | surface velocity of a part, m/s and rad/s about `center`. The solid does not move (a "frozen" rotor, a belt, a rolling wheel) |
| `actuators` | array of `{name, center, axis, radius, thickness?, force \| pressureJump}` | actuator discs: a momentum source over the fluid cells of a disc. `force` (N) acts on the fluid along `axis`; `pressureJump` (Pa) is `force / (pi radius²)`. `thickness` defaults to, and is at least, two cells |
| `resolution` | `{cells?, cellSize?, latticeSpeed?}` | `cells`: budget of lattice cells, default 400,000 (the boundary layers of the box count). `cellSize` (m) overrides it. `latticeSpeed`: the reference speed in cells per step, default 0.06, at most 0.2 |
| `model` | `{turbulence?, smagorinsky?, walls?, spongeCells?}` | `turbulence`: `"auto"` (default), `"none"`, `"smagorinsky"`; `smagorinsky`: the constant, default 0.16; `walls`: `"interpolated"` (default) or `"halfway"`; `spongeCells`: cells in front of pressure sides over which the viscosity rises, default 0 |
| `run` | object | run lengths, see below |
| `outputs` | object | what to post-process, see below |

### `external`: a tunnel around the geometry

| Field | Default | Meaning |
|---|---|---|
| `speed` | required | m/s |
| `direction` | `[1, 0, 0]` | the direction the fluid moves in; any direction (it is normalised). A side of the box is an inlet where the stream enters it (direction component above 0.2), an outlet where it leaves, else a slip wall |
| `up` | `[0, 1, 0]` | the lift axis; must be along one coordinate axis |
| `ground` | `false` | `true` or `{height?, moving?}`: a no-slip plane normal to `up` at `height` (default: the lowest point of the geometry). `moving: true` slides it with the stream. The direction must be parallel to it |
| `margins` | `{upstream: 2, downstream: 5, side: 2, top: 2, bottom: top}` | free space around the bounding box of the geometry, in multiples of the body size across the flow (the larger of its height and its width seen along the flow) |
| `domain` | | `{min, max}`: the box itself, instead of margins |
| `referenceLength` | largest extent of the bounding box | m; used for the Reynolds number and the moment coefficients |
| `referenceArea` | shadow of the solid cells along the flow | m²; used for the coefficients |
| `momentCenter` | centre of the bounding box | point the moments are taken about |

The box grows to whole cells on the downstream and upper sides. The fluid starts at the free-stream velocity.
Solid items only (no cavities). Coefficients: `cd` along `direction`, `cl` along `up` made normal to the direction,
`cs` along `direction × up`.

### `internal`: flow through a cavity

| Field | Default | Meaning |
|---|---|---|
| `inlets` | `[]` | array of `{name, shape, flowRate \| speed \| velocity, profile?}`: volume flow rate m³/s, or mean speed along the normal m/s, or a velocity vector. `profile`: `"uniform"` (default) or `"parabolic"` (`1 - (r/R)²` on a disc, `(1 - (x/a)²)(1 - (y/b)²)` on a rectangle, scaled to the given flow rate; the shape must then match the opening) |
| `outlets` | `[]` | array of `{name, shape, pressure?}`: gauge pressure, Pa, default 0 |
| `domain` | bounds of the geometry | `{min, max}` |
| `padding` | 0 | metres added around the bounds of the geometry |
| `referenceSpeed` | the largest of the inlet speeds and the total inflow over the smallest outlet | m/s; sets the time step. Give it when the flow is faster somewhere inside (a nozzle, a valve seat) |
| `referenceLength` | diameter of the circle with the area of the first inlet | m; for the Reynolds number |
| `acceleration`, `periodic`, `initialVelocity` | | a duct driven by a body force (m/s²) with periodic axes (`["x"]`), instead of inlets and outlets; `referenceSpeed` is then required |

A **shape** is `{kind: "disc", center, normal, radius}` or `{kind: "rect", center, normal, up?, halfWidth, halfHeight}`.
The `normal` points **into the fluid** (for an inlet, the direction of the inflow; for an outlet, against the outflow).
The cells within 2.5 cells behind the plane and inside the shape become the opening, whatever they were, so the plane
is put at the end of the pipe (it may lie on a side of the box) and a shape somewhat larger than the opening does no
harm with a uniform profile. Sides of the box that are not openings are walls. Fluid cells that no opening reaches are
made solid (`setup.lattice.enclosedCells`). With inlets there must be at least one outlet.

### `run`

Lengths are in **transits**: the length of the box along the flow (external) or its longest side (internal) over the
reference speed (`setup.transitTime` in the result).

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

### `outputs`

| Field | Meaning |
|---|---|
| `streamlines` | `true` or `{seeds?, count?, field?, step?, maxPoints?, stride?, direction?}`. `seeds`: `"auto"` (default: a grid upstream of the body over its shadow, or points spread over every inlet) or an array of `{kind: "rake", from, to, count}`, `{kind: "plane", origin, u, v, nu, nv}` (points `origin + s u + t v`), `{kind: "points", points}`. `count`: number of automatic seeds, default 64. `field`: `"mean"` (default) or `"instant"`. `step`: integration step in cells, default 0.5. `stride`: keep every n-th point, default 2. `maxPoints`: default 400. `direction`: `"forward"` (default), `"backward"`, `"both"` |
| `slices` | array of `{axis, position \| fraction, field?}`: a plane normal to `axis` at `position` (m) or at `fraction` (0 to 1) of the box |
| `surface` | `true`: pressure and pressure coefficient at the vertices of the surface of every part |
| `lines` | array of `{name?, from, to, samples?, along?}`: the fields along a line (default 101 samples) and where the velocity component along `along` (default: the line) changes sign (a reattachment point) |
| `sections` | array of `{name?, axis, position, min?, max?}`: integrals over the cell layer at `axis = position`, optionally inside the box `min`..`max` |
| `history` | `false` leaves the convergence history out. Default `true` |

## The result document: `box3d-flow-result/1`

Schema: `packages/box3d-kit/schemas/flow-result.schema.json`. Field numbers are rounded to six significant digits.
Vectors are `[x, y, z]`. Optional members are absent when the output was not requested.

| Member | Content |
|---|---|
| `format`, `name` | `"box3d-flow-result/1"`, the study's name |
| `solver` | `{id, version, statement}`: `id` is `flow-lbm-d3q19-regularized-les-js-f64-v1`; `statement` says what the solver is |
| `setup` | everything derived from the study, below |
| `run` | `{steps, time, wallTime, cellUpdatesPerSecond, converged, reason, windows, averaged, maxSpeed}`: `time` simulated seconds; `wallTime` seconds; `reason` `"tolerance"` or `"max-steps"`; `averaged` `{fromStep, steps, time, samples}` of the window the means are over (`null` when no sample was taken); `maxSpeed` the largest speed seen, m/s |
| `convergence` | `{tolerance, startupSteps, windowSteps, monitorEvery, history}`; `history` holds parallel arrays `step`, `time`, `residual` (rms change of the velocity over an interval, over the reference speed), `maxSpeed`, and for an external study `cd`, `cl`, `cs` (means over each interval), for an internal one `massBalance`, `bulkSpeed`, `flowRates` and `patchPressure` (objects of arrays by opening name) |
| `forces` | `{about, total: {force, moment}, parts: [{name, force, moment}], coefficients}`: N and N m about `about`, means over the window. `total` sums the parts of the geometry (not the ground or the sides of the box). `coefficients` (external; `null` for internal): `{cd, cl, cs, cdRms, clRms, csRms, cm, referenceArea, referenceLength, dynamicPressure, axes: {drag, lift, side}}`; `cm = moment / (q A L)` |
| `flow` | `{patches, inflow, outflow, massBalance, splits, pressureDrops, sections}`. `patches`: per opening `{name, kind, flowRate, area, meanSpeed, meanPressure, meanDynamicPressure, meanTotalPressure}`; `flowRate` is m³/s **into the box** (negative at outlets); pressures are means over the fluid cells that touch the opening, Pa gauge. `massBalance = (inflow - outflow) / inflow`. `splits`: per outlet its `fraction` of the outflow. `pressureDrops`: for every inlet and outlet pair `{from, to, static, total}`, Pa. `sections`: per requested section `{name, axis, position, area, flowRate, meanSpeed, meanPressure, meanTotalPressure, momentumFactor}` (`flowRate` along +axis; `meanTotalPressure` is flux-weighted; `momentumFactor` is `area ∫u_n² / Q²`) |
| `actuators` | per actuator `{name, cells, force, axis, area, pressureJump, meanSpeed, flowRate, power}`: the speed of the fluid through the disc, `flowRate = meanSpeed × area`, `power = force × meanSpeed` |
| `wake` | external: `{shedding, recirculationLength, recirculationFrom}`; `shedding` is `null` or `{frequency, strouhal, length, periods, amplitude, axis}` from the cross-flow force history (Strouhal number with `length` = the body size across the flow); `recirculationLength` is the distance from the rear of the bounding box, on its centre line, to where the mean streamwise velocity turns positive, or `null`. Internal: `null` |
| `streamlines` | `{field, speedRange: [min, max], lines: [{seed, termination, points, speed, pressure}]}`: `points` is x, y, z per vertex (m), `speed` (m/s) and `pressure` (Pa gauge) one per vertex; `termination` is `"wall"`, `"outside"` (left through an outlet or a side), `"stagnation"` or `"length"` (reached `maxPoints`) |
| `slices` | per slice `{axis, position, axes: [u, v], nu, nv, origin: [u0, v0], cell, speed, pressure, u, v, fluid}`: row-major arrays of `nu × nv` samples (index `i + nu j`), sample `(i, j)` at `origin + cell (i, j)` along the in-plane axes `axes` (cyclic: x → y, z; y → z, x; z → x, y); `u`, `v` the in-plane velocity; `fluid` 1 where the sample is in the fluid |
| `surface` | per part `{part, positions, indices, pressure, cp}`: triangles (meshes as given, primitives tessellated at 1.5 cells), `pressure` (Pa gauge) and `cp = pressure / (rho U² / 2)` per vertex, read one cell out from the wall |
| `lines` | per line `{name, from, to, s, ux, uy, uz, speed, pressure, distance, zeroCrossings}`: `s` distance from `from`; `distance` the signed distance to the wall (negative in the solid) |
| `warnings` | array of strings: blockage, resolution, unresolved features, Mach number, non-convergence |
| `limits` | array of strings: the standing limits of the solver |

`setup` holds: `mode`; `fluid`; `grid` (the box of fluid cells: `origin`, `cell`, `nx`, `ny`, `nz`, `min`, `max`);
`lattice` (the box plus its boundary layers: `origin`, `cell`, `nx`, `ny`, `nz`, `cells`, `fluidCells`, `solidCells`,
`enclosedCells`, `boundaryLinks`; slices are sampled on this grid); `timeStep`; `latticeSpeed`; `latticeMach`;
`relaxationTime`; `cellReynolds`; `turbulence: {model, smagorinsky}`; `walls`; `referenceSpeed`;
`referenceLength: {value, source}`; `reynolds`; `transitTime`; `external` (`speed`, `direction`, `up`, `side`,
`ground`, `bodySize`, `bodyCells`, `bodyBounds`, `blockage`, `referenceArea: {value, source}`, `dynamicPressure`,
`momentCenter`; `null` for internal); `internal` (`{inlets, outlets}` names; `null` for external); `sides` (kind of each
of `xMin` … `zMax`); `patches` (per opening `{name, kind, area, normal, velocity, pressure, cells}`: the area the
lattice gives it and what is imposed); `parts` (names, in the order of `forces.parts`); `geometry` (the per-item report
of [Geometry](#geometry): `{index, kind, part, role, smallestDimension, surfaceArea, unresolvedFraction}` and for
meshes `triangles`, `components`, `closedComponents`); `controls` (the run lengths in steps).

The **reference area** of an external study is the shadow of the solid cells along the flow: every solid cell is cut
into eight, the centres are dropped on a plane grid of half the cell size, and the squares hit are counted
(`setup.external.referenceArea.source` says so; a given `referenceArea` is reported as `"given"`). The **blockage** is
that shadow over the cross-section of the tunnel; above 5% a warning is raised and nothing is corrected.

## Programming interface

`box3d-webgpu-kit/flow` (TypeScript declarations in the package; `packages/box3d-kit/api/API.md` lists every export).

```ts
runFlowStudy(study, options?): result              // set up, run, post-process
createFlowStudy(study, options?): FlowStudyRun     // {setup, flow, done, advance(), result()}: step it yourself
flowStudySetup(study, options?): FlowStudySetup    // check a study and work out the set-up without running
// options: {onProgress?(p), loadMesh?(file) => {positions, indices?}, now?() => ms}

new Flow(options)                                  // the solver: grid, geometry, fluid, sides, patches, motion, actuators
  .step(n) .time .dt .forces(about) .takeSums(about) .accumulate() .field(mean) .saveState() .restoreState(state)
flowVoxelize(items, grid)                          // signed distance, parts, surfaces, report
flowGeometryBounds(items)  flowTubeMesh(path, radius, segments)  flowPrimitiveSurface(item, size)
flowStreamlines(field, seeds, options)  flowRake(from, to, count)  flowSeedPlane(origin, u, v, nu, nv)
flowSlice(field, axis, position)  flowSurfacePressure(field, surfaces)  flowLine(field, from, to, samples, along)
flowSection(field, density, axis, position, bounds)  flowProjectedArea(grid, solid, direction)  flowFrequency(samples, dt)
flowSample(field, x, y, z, out)                    // trilinear [ux, uy, uz, pressure, distance]
FlowLattice                                        // the kernel in lattice units
```

`Flow` takes the sides of the box directly (`'wall'`, `'slip'`, `'periodic'`, `{kind: 'velocity', velocity}` with a
vector or a function of the position, `{kind: 'pressure', pressure}`, `{kind: 'wall', velocity, part}`), which is how
the validation cases set up channels with parabolic inflow.

## Command line

```
node packages/box3d-kit/bin/flow-cli.mjs study.json --out result.json [--quiet] [--setup]
npx box3d-flow study.json --out result.json            # from the installed package
```

Reads the study, resolves meshes given by `file` (`.stl` binary or ASCII, `.obj`, or `.json` with `positions` and
`indices`) relative to the study file, prints the set-up and a progress line per monitor interval to standard error,
and writes the result (to standard output without `--out`). `--setup` prints the set-up and stops. It exits with code 1
and a message on an invalid study or a diverged run, and with code 2 when the run ended without converging.

## Drawing results with three.js

`box3d-webgpu-kit/flow-three`: see the section in the kit README. `createFlowView(THREE, result, options)` builds a
group with the streamlines as tubes coloured by speed, the surfaces of the parts (optionally coloured by the pressure
coefficient) and the slices, and `flowLegend` draws the colour scale. `flow-demo.html` shows four studies.

## On the GPU

See [`GPU_COMPUTE.md`](GPU_COMPUTE.md).

## Validation

The cases are in the validation registry (`validation/domains/flow.mjs`, [`VALIDATION.md`](VALIDATION.md)) and asserted
by `packages/box3d-kit/test/v24-flow.test.mjs`. The table is completed with the validation commit.

## Cost

Completed with the validation commit.

## Limits

- **Boundary layers are not resolved and there is no wall model.** Skin friction, and the separation from smooth
  curved surfaces (spheres, cylinders at high Reynolds number, streamlined bodies, wings, ship hulls) are estimates;
  the drag crisis is not predicted. Sharp-edged bodies, whose separation the geometry fixes, are predicted better.
- **Incompressible flow only.** The lattice Mach number of the reference speed is `sqrt(3) × latticeSpeed`, 0.10 by
  default, and the density varies by about that squared. The physical flow should be below **Mach 0.3**; there are no
  shocks and no heating by compression. A warning is raised when the largest speed passes three times the reference.
- **No free surface.** Spillways, hulls at the water line and open tanks need the free-surface solver
  ([`FLUID.md`](FLUID.md#free-surface)) or the shallow-water solver ([`SHALLOW_WATER.md`](SHALLOW_WATER.md)). A spillway
  or a ship can be run here only as a fully submerged, single-fluid shape.
- **No rotating or moving geometry.** There is no sliding mesh. A rotor is a frozen solid, optionally with the surface
  velocity of its rotation (`motion`), or an actuator disc (`actuators`). A frozen rotor gives the blockage and the wake
  of the stopped blades at one position; an actuator disc gives the thrust, the pressure rise and the slipstream of a
  given force. Neither gives the torque, the efficiency, the blade loads or the swirl of a working machine.
- **No heat transfer**, no buoyancy, no cavitation, one fluid. The heat solver is not coupled.
- **Uniform grid.** The cell budget is spent on the whole box; a body 20 cells across in a tunnel with 5% blockage
  needs about a million cells. Features under two cells are coarse, under one cell lost.
- **Tunnel walls are slip planes**; the blockage is reported, not corrected.
- **A steady state is reached by marching in time**; the convergence monitor compares window means, so a slow drift
  longer than two windows passes as converged.
