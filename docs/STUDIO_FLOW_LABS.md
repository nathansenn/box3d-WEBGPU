# Studio flow labs: liquid dynamics and granular flow in SI

The Engineering Studio's **Liquid dynamics** (FL–01) and **Granular flow** (GF–05) labs run the engine's validated SI solvers where a validated solver covers the experiment, and say plainly where they still run an authored model. This page lists, per lab and tab, the model, its SI set-up, the validation it rests on with the sources, the real-time factor measured, and the limits. The Studio links here from the lab's footer and its "About this model" note.

Values marked "from memory" were not checked against a source opened while writing; every other number below was read in the source named.

## Contents

- [What runs where](#what-runs-where)
- [Liquid: flume](#liquid-flume)
- [Liquid: pipes](#liquid-pipes)
- [Liquid: river, rain table, surface runoff](#liquid-river-rain-table-surface-runoff)
- [Liquid properties](#liquid-properties)
- [Granular flow](#granular-flow)
- [Validation](#validation)
- [Real time](#real-time)
- [Tests](#tests)
- [Limits](#limits)

## What runs where

| Lab, tab | Model | Units | Status |
|---|---|---|---|
| Liquid, Flume | `FreeSurfaceFluid` ([`FLUID.md`](FLUID.md)): 3D incompressible liquid with a free surface, viscosity, a lifting gate and two posts | SI | validated solver; the flume itself is not compared with an experiment |
| Liquid, Pipes | pump delivery by Darcy–Weisbach with the liquid's SI viscosity (laminar exact, turbulent by the Colebrook correlation); the channel the pipe fills is the depth-averaged model | SI | friction law checked; outlet and valve loss coefficients and the channel are authored |
| Liquid, River | depth-averaged model over the shaped bed | SI dimensions, authored bed drag and damping | authored, labelled as such |
| Liquid, Rain | depth-averaged model with rain, infiltration and drainage | as above | authored |
| Liquid, Surface | depth-averaged film on a substrate | as above | authored |
| Granular, all experiments | `Granular` ([`GRANULAR.md`](GRANULAR.md)): discrete element spheres with friction and rolling resistance, coarse-grained | SI | validated solver; glass beads checked against measured repose and column-collapse runout |

The validated basin of [`WATER_COUPLING.md`](WATER_COUPLING.md) (linear waves in a closed basin) covers none of the river, rain or surface tabs: they need a sloping, partly dry bed, inflow, outflow and infiltration, which it does not have. The volumetric fluid has no inflow or outflow with a free surface. Those three tabs therefore keep the authored depth-averaged model, and the footer says so.

Both labs step in the flow worker (`src/studio/material-labs/liquid-study-worker.ts`, which also runs the liquid lab's three-case comparisons), so the page stays responsive whatever the solver costs. The worker runs free toward wall time in 1/120 s ticks, records the history samples itself and publishes its newest frame at most every 33 ms; the scene draws the newest frame, so the drawing rate does not limit the solver ([`ENGINEERING-STUDIO.md`](ENGINEERING-STUDIO.md#scheduling-the-solver-runs-free-of-the-renderer)). The footer shows the solver's measured speed as a multiple of real time.

## Liquid: flume

`FlumeSI` (`src/studio/material-labs/liquid-si.ts`) builds the flume the scene draws, in metres:

| | |
|---|---|
| Tank | 6 m long, 2 m wide, walls 1.125 m high; the solver grid is 48 × 9 × 16 cells of 0.125 m, 8 particles per cell |
| Gate | a box obstacle 0.125 m thick at x = −1.07 m (the drawn gate), lifting at the **gate speed** (m/s) to the **gate opening** (% of 1.1 m) |
| Posts | two cylinders of radius 0.2 m at (1.25, 0.48) and (2.0, −0.42) m |
| Reservoir | **reservoir depth** (m) behind the gate; downstream 0.008 m + 0.6 m × **downstream fill** |
| Bed slope | the bed slope setting, as a tilt of gravity |
| Liquid | density and dynamic viscosity at 20 °C from the table below, the viscosity multiplied by the **viscosity multiplier** |
| Time step | at most 1/60 s and a Courant number of 0.8, adaptive |
| Readouts | peak depth (m): the largest column depth; peak speed (m/s): the largest depth-averaged horizontal speed of a column holding at least 1 cm; fluid volume (m³): the particles' volume, which the solver conserves exactly |

The drawn surface is the solver's: each column's depth is the number of particles in its cells, a cell counting as full at its seeded share (eight) and partly full below it, interpolated to the scene's 84 × 28 grid. Particles that crowd against the end wall after the surge therefore do not raise the drawn surface above the cells they fill.

**Viscosity at this cell size.** The term `nu dt / h²` (diffusion over one cell per step) is below 1e-5 for water and the light liquids (1.1e-6 for water); their viscosity is left out of the solve, which changes the velocity by less than that fraction per step. A no-slip wall is applied only when the viscous boundary layer, sqrt(nu t), reaches half a cell within the 18 s program, nu ≥ h² / (4 × 18 s) = 2.2e-4 m²/s: glycerol, honey and the thicker liquids. Thinner layers (water, olive oil at 9.1e-5 m²/s) are not resolved on a 0.125 m grid, and their walls are free-slip, so their wall friction is left out. The consequence is physical, not a defect: at flume scale olive oil surges almost like water (the Reynolds number of the release is about 2 × 10⁴), and honey (7.4 Pa s, 5.2e-3 m²/s) still runs as a surge, its centre of mass 0.4 m behind water's after 2 s.

The experiment cards say what each case is in SI (for example "0.65 m of water behind a gate lifting at 0.8 m/s"). The "Reflected wave" case starts with the gate open and a cosine surface.

## Liquid: pipes

`pipeDelivery` (`src/studio/material-labs/liquid-config.ts`) finds the flow at which the losses use up the pump head, capped by the pump demand:

```
h = (f L / D + K_outlet + K_valve + 1) V² / 2g,        Re = V D / nu,  nu = mu / rho
f = 64 / Re                                   Re < 2300   (Hagen–Poiseuille, exact for fully developed laminar flow)
1/√f = −2 log10(ε/3.7D + 2.51/(Re √f))        Re > 4000   (Colebrook, a correlation fitted to measurements; ε = 0 here)
f interpolated linearly in Re                 2300–4000   (a convention: no law holds in the transition)
```

The laminar and turbulent forms and the Re 2300 / 4000 bounds were read in the chapter summary of Çengel & Cimbala, *Fluid Mechanics*, chapter 8 (McGraw-Hill, https://highered.mheducation.com/sites/dl/free/0072472367/211345/chp8_summ.pdf). Colebrook's paper (J. Inst. Civ. Eng. 11 (1939) 133–156) was not opened. The pipe is taken as hydraulically smooth (ε = 0) because no roughness source was opened for the bench's pipe. The outlet loss coefficients (`PIPE_TOOLS`) and the valve law `K = 2 (1/v² − 1)` are authored. The panel shows Re, f and which law applied. The channel the pipe discharges into is the depth-averaged model of the next section.

## Liquid: river, rain table, surface runoff

A conservative finite-volume depth-averaged model (hydrostatic reconstruction after Audusse et al. 2004) over the bed the scene draws, with explicit rain, infiltration and drainage, and a recorded volume balance. Its dimensions, rain rates and volumes are in SI. Its bed drag per substrate, infiltration rates and viscous damping are authored and not calibrated, and it does not use the SI viscosity. These tabs are labelled "authored depth model" in the footer.

## Liquid properties

`LIQUID_SI` (`src/studio/material-labs/liquid-si.ts`), Newtonian, about 20 °C:

| Studio liquid | Density, kg/m³ | Viscosity | Source |
|---|---|---|---|
| Clear water, River water | 998.207 | 1.0016 mPa s | material library `water` (NIST WebBook) |
| Olive oil | 879 (at 25 °C) | 79.7 mPa s | material library `olive-oil`: Brock et al., Ciênc. Tecnol. Aliment. 28 (2008) 564, Tables 2 and 3 |
| Glycerin | 1261.08 | 1.412 Pa s | material library `glycerol`: Segur & Oberstar, Ind. Eng. Chem. 43 (1951) 2117, Table V; density of Bosart & Snoddy (1928) tabulated by Volk & Kähler, Exp. Fluids 59 (2018) 75, supplement |
| Honey | 1420 (**unverified**) | 7.43 Pa s | material library `honey`: viscosity from Rodriguez-Navarro & Vivanco-Pezantes, Agroindustrial Science 12 (2022) 7; density recalled |
| The other 19 (sea water, brine, coolant, antifreeze, ink, milk, diesel, hydraulic oil, emulsion, slurry, mud, silicone oil, syrup, soap, paint, shampoo, resin, molasses, silicone gel) | 840 to 1600 | 1.08 mPa s to 30 Pa s | **unverified estimates**, marked so in the Material panel; slurry, mud, paint, shampoo and gel are taken as Newtonian although real ones are not |

See [`MATERIALS.md`](MATERIALS.md) for the library entries with the figures as read.

## Granular flow

`GranularTray` (`src/studio/material-labs/granular-si.ts`):

| | |
|---|---|
| Tray | 0.57 m × 0.17 m with a floor and four walls; the scene draws it ten times larger (scene units = SI × 10) |
| Column | behind a gate at x = −0.115 m, 0.155 m long, filled to the **column fill** (% of 0.14 m) on a jittered lattice of at most 12 × 6 grains a layer, then settled for 0.3 s behind the closed gate before the clock starts (a lattice column of frictional spheres otherwise stands like a wall) |
| Gate | a kinematic box 10 mm thick lifting at the **gate speed** (× 0.1 m/s) to the **gate opening** (% of 150 mm); "Open gate fully" removes it |
| Obstacle | a cylinder 54 mm across and 60 mm high with a cap |
| Grains | spheres of the **grain diameter** (7 to 16 mm), radii 0.96 to 1 of it |
| Contacts | linear springs k_n = 4000 m g / d (the solver's validated bulk stiffness), k_t = (2/7) k_n, restitution and friction of the material (friction × the **contact friction** setting), rolling resistance; time step 17% of the impact time (the solver refuses above 20%) |
| Readouts | runout (m): leading edge of the farthest grain past the gate face; pile height (m): the highest grain top; grains behind gate: how many are still behind the gate face |

**Coarse-graining.** The grains are stand-ins: 7 to 16 mm spheres for real grains of 0.2 to 2 mm (sand) or 1 to 3 mm (glass beads), 5 to 50 times larger. What the lab compares with experiments does not depend on the grain size for cohesionless grains: the angle of repose (Makse et al. 1998 found it the same for spherical glass beads of different sizes) and runout over column length against aspect ratio (Lajeunesse et al. 2005 found the same scaling for 1.15 and 3 mm beads). Times scale with sqrt(length / g) and are those of the apparatus. What changes with the grain size, and is therefore not that of the real material: the number of grains across the flow (six to twenty here, thousands in reality), the discreteness of the front, and the contact stiffness (the springs are about a thousand times softer than glass).

**Grain materials** (`GRAIN_SI`):

| Studio grains | Density | Friction | Restitution | Rolling resistance | Source |
|---|---|---|---|---|---|
| Glass beads | 2500 kg/m³ | 0.12 | 0.926 | 0.06, **fitted** to a 22° pile | material library `glass-beads` (Tang et al. 2019; Sandeep & Senetakis 2018); the pile angle from Lajeunesse et al. 2005, Table I |
| Dry sand | 2650 kg/m³ | 0.19 | 0.6 | 0.2 | density and friction from the library `sand-quartz`; restitution and the rolling resistance standing in for angular shape are **authored** |
| Gravel, crushed stone, polymer pellets, grain surrogate, steel shot, damp sand | | | | | **unverified estimates**; damp sand has no capillary bridges, only strong damping |

## Validation

Solver cases, all run by the validation registry ([`VALIDATION.md`](VALIDATION.md), `npm run validation:report`) and asserted by the kit tests:

| Case | Reference (source opened) | Measured | Tolerance |
|---|---|---|---|
| Viscous film slowing on a no-slip floor, 10 cells deep | series solution of u_t = nu u_yy (closed form) | +0.51%, +0.84%, +1.48% at 0.02, 0.05, 0.1 s | ±2% |
| Viscous gravity current, fixed volume, front from 3 to 6 s | Huppert, J. Fluid Mech. 121 (1982) 43, eq. 2.18 with eta_N = 1.411 (2.17) | −1.27% to −0.72% | ±2% |
| the same, d(x_N⁵)/dt | 1.411⁵ g q³ / 3 nu | −1.0% | ±8% |
| Hydrostatic force on a gate, water and glycerol | rho g H² / 2 per width | −0.41% | ±1% |
| Glycerol held at rest behind a gate | u = 0 | 1.6e-13 m/s | ≤ 1e-9 sqrt(g H) |
| 3D release past a post: particles in solid cells; particle volume | none; conserved | 0; exact | 0 |
| Pipe friction: Colebrook residual at Re 1e4, 1e5, 1e6; laminar head of honey | the implicit equation; 32 mu L V / (rho g D²) | below 1e-9; to 1e-9 | 1e-9 |
| Glass beads, angle of repose (rolling resistance fitted here) | Lajeunesse et al. 2005, Table I: 22 ± 0.5° | 22.6° (mean of three packings: 0.06 rolling resistance) | ±2.5° |
| Column collapse, runout ΔL/L_i at a = 0.47, 0.81, 1.50 | ΔL/L_i = 1.8 a for a ≲ 3: proportionality from Lajeunesse et al. 2005 (text), prefactor read from their Fig. 6(a) | 0.63, 1.45, 3.16: −25%, 0%, +17% | ±30% |
| Column collapse, deposit height at a = 0.47 | H_f / L_i = a for a ≲ 0.7 (same paper) | 0.46 (−2%) | ±10% |

Sources: H. E. Huppert (1982), read from https://scispace.com/pdf/the-propagation-of-two-dimensional-and-axisymmetric-viscous-1ybbc4dya0.pdf; E. Lajeunesse, J. B. Monnier & G. M. Homsy, *Granular slumping on a horizontal surface*, Phys. Fluids 17 (2005) 103302, read from https://www.ipgp.fr/~lajeunes/download/2005-pof-slumping.pdf; H. A. Makse, R. C. Ball, H. E. Stanley & S. Warr, *Dynamics of granular stratification*, Phys. Rev. E 58 (1998) 3357, read from https://arxiv.org/pdf/cond-mat/9809428 (spherical glass beads 26 ± 1° in a Hele-Shaw cell, where the walls add friction; not used as the reference). Lube et al.'s two-dimensional collapse paper (Phys. Rev. E 72 (2005) 041301) could not be opened and is not used.

The collapse runs use 10 mm library beads in a channel six grains wide with side-wall friction tan 12.5° and a rough floor (friction and rolling resistance tan 24.8°), the angles Lajeunesse et al. list for their channel; their channel was 15 to 39 beads wide. In a ten-grain channel the same three runs gave −26%, +16% and +33%: the measured runout rises faster than linearly with a in both widths, which is the main disagreement with the experiment. The flume as a whole (6 m tank, surge past posts) is not compared with an experiment; it rests on the solver cases above and on the dam break and sloshing cases of [`FLUID.md`](FLUID.md).

## Real time

Measured with `node` on the solver alone (no drawing), one thread of this 4-core sandbox while other jobs ran (load average 8 to 12, so these are lower bounds), for the first seconds of each prepared experiment. A value below 1 means the lab plays slower than real time.

| Lab | Experiment | Solver size | Real-time factor | Load average |
|---|---|---|---|---|
| Liquid, flume | Clear-water release | 11,584 particles, 6,912 cells | 0.46 | 13 |
| | Oil through the gate (viscous, free-slip walls) | 11,584 | 0.32 | 14 |
| | Honey creep (viscous, no-slip walls) | 11,584 | 0.37 | 14 |
| | Deep reservoir | 13,440 | 0.57 | 14 |
| | Slow gate lift | 11,584 | 0.66 | 15 |
| | Reflected wave | 18,208 | 0.56 | 15 |
| | Blue tracer | 11,584 | 0.82 | 14 |
| | Slurry front (viscous) | 14,464 | 0.37 | 14 |
| Granular | Sand avalanche, glass-bead runout, crushed-stone pile, metered discharge, polymer pellets | 792 grains of 10 mm, step 0.19 ms | 0.23 to 0.25 | 14 to 17 |
| | Steel shot | 792 | 0.29 | 14 |
| | Damped pile | 792 | 0.14 | 14 |
| | Coarse gravel (16 mm) | 270 | 1.28 | 16 |

The flume's cost is the particles (8 per cell, 11,000 to 18,000) and the two pressure solves of a viscous step; the tray's is the step, 17% of a contact time, about 5,000 steps per second of 10 mm grains. On an unloaded core both run about twice as fast (the flume's clear-water release measured 0.5 to 0.6 when the load average was 8 to 11). Neither lab is real time for its default experiment on this machine: the flume is between a third and four fifths of real time, the tray a quarter (coarse gravel, with a third as many grains, faster than real time).

In the browser the solver runs in the worker and the footer shows its live factor. In headless Chromium on SwiftShader (software rendering, 1000 × 640) under the same load the footer read 0.18× for the clear-water release and 0.22× to 0.29× for the glass-bead runout. The page advanced more slowly than that (about 1 s of simulation in 4 minutes): a software-rendered frame took seconds, and the Studio's loop advances the clock by at most 0.05 s per drawn frame, so there the drawing, not the solver, set the pace. Captures: `granular-bead-runout-before.png` / `-after.png` (0.97 s, the column collapsed past the gate toward the obstacle) and `liquid-water-release-before.png` / `-after.png` (0.67 s, the gate 0.53 m up and the surge under it), saved outside the repository.

## Tests

- `tests/studio/liquid-si.test.mjs`: the liquid properties (library values and verification flags), the friction law (laminar exact, Colebrook residual, Blasius within 2%, Hagen–Poiseuille head of honey), the flume (volume exact, gate lift = speed × time, determinism, honey slower than water, the viscosity and no-slip thresholds), the worker protocol.
- `tests/studio/granular-si.test.mjs`: the grain materials, the tray (SI radius and the × 10 drawing, mass kept, gate lift, grains past the gate), beads against crushed stone, determinism, the worker.
- `tests/studio/liquid-lab-v2..v5.test.mjs`: the authored tabs and the analysis and notebook workflow, with the pipe cases in SI; flume presets run one second there.
- Solver cases: `packages/box3d-kit/test/v18-fluid.test.mjs` and `v17-granular.test.mjs`.

All run in the Studio gate (`npm run test:studio:liquid`).

## Limits

- Flume: a 0.125 m grid (two cells across the posts' radius, the gate quantised to 0.125 m steps of opening), no surface tension, no turbulence model, no wall friction for water and oil (boundary layers below the grid), no force on the posts or gate in the readouts, splash volume of the cells varies (the particles' volume is exact). A thin viscous layer with two particles per axis runs a few percent slow ([`FLUID.md`](FLUID.md)).
- Pipes: hydraulically smooth pipe, authored fitting and valve losses, no transient (water hammer) or two-phase flow.
- River, rain, surface: authored, as above.
- Granular: spheres only, coarse-grained, soft contacts; rolling resistance stands in for shape (fitted for glass beads only); runout within 30% of one experiment's scaling over a = 0.5 to 2 with a trend steeper than linear; no cohesion, moisture, breakage or segregation of sizes; no comparison for sand or the other grains.
- Real time: below 1 for both labs on this machine; see the table.
- Granular stability: the solver's step check does not account for damping; with the tray's step a restitution of 0.1 blew a pile apart, so the damp-sand stand-in uses 0.3. The largest overlap in the prepared experiments is about 10% of a radius, during the settling of the column before the clock starts.
