# Volumetric fluid

`Fluid` (`src/engine/fluid.ts`, kit subpath `box3d-webgpu-kit/fluid`, solver id `fluid-mac-projection-mic-pcg-js-f64-v1`) solves the incompressible Navier–Stokes equations in three dimensions (or two, with one periodic cell along z) in SI units, float64, deterministic, with no dependencies. Walls, periodic sides, inflows and outflows bound the box; spheres, boxes, capsules and cylinders sit in it as fixed or moving obstacles. `FluidCoupling` (backend id `rigid-fluid-coupling-fictitious-domain-js-f64-v1`) makes rigid bodies of the world into moving obstacles and hands them the fluid's force and torque, and `fluidSubsystem` plugs either into the one stepping loop ([`SIMULATION.md`](SIMULATION.md)). `FreeSurfaceFluid` (solver id `fluid-free-surface-apic-mac-js-f64-v1`) is the free-surface option: liquid particles in a closed tank of air. Together they are the volumetric-fluid item of Phase 3 of the [roadmap](ROADMAP.md).

It is a new model beside the existing water ([`WATER_COUPLING.md`](WATER_COUPLING.md)), which is a height field with linear waves in a closed basin. This one resolves the flow in the volume, so it can give a drag, a wake, a pressure on a body or a lid-driven vortex, and it is far slower per unit of water: see [Cost](#cost).

Values in this document marked "from memory" are recalled, not checked against a source that was opened while writing.

## Contents

- [Why this method](#why-this-method)
- [Equations and grid](#equations-and-grid)
- [One step](#one-step)
- [Boundaries](#boundaries)
- [Obstacles and forces on them](#obstacles-and-forces-on-them)
- [Time step](#time-step)
- [Energy ledger](#energy-ledger)
- [Two-way coupling](#two-way-coupling)
- [In the stepping loop](#in-the-stepping-loop)
- [Free surface](#free-surface)
- [Validation](#validation)
- [Cost](#cost)
- [Limits](#limits)

## Why this method

- **Staggered (MAC) grid.** Pressure at cell centres, each velocity component on the faces normal to it. The discrete divergence and gradient are adjoint, so the projection is a symmetric positive (semi-)definite Poisson problem, there is no checkerboard pressure mode, and a uniform body force such as gravity is exactly a discrete gradient: water at rest stays at rest to round-off (measured 8e-20 m/s).
- **Incremental pressure-correction projection** (Chorin's method with the old pressure kept in the predictor). With the old gradient in the predictor, a steady state of the scheme is a steady state of the discrete equations whatever the step, which the channel, duct and cavity cases use to reach their steady states in large steps.
- **Conjugate gradients with modified incomplete Cholesky, MIC(0)** (the tuning 0.97 and safety 0.25 of Bridson's *Fluid Simulation for Computer Graphics*, from memory). It needs nothing but the seven-point stencil, is deterministic (fixed loop order) and takes 20 to 50 iterations on the grids here. Multigrid would scale better on large grids; it is not done.
- **Central differences in flux form with Adams–Bashforth 2** for advection. Second order in space and time, and it conserves momentum to round-off in a periodic box, which the momentum-exchange check relies on. Semi-Lagrangian advection would be unconditionally stable but first order and diffusive; it would have failed the Taylor–Green rate and the cavity. A first-order upwind option is kept for under-resolved flow.
- **Viscosity explicit, Crank–Nicolson or backward Euler**, the implicit ones by Jacobi-preconditioned conjugate gradients per component.
- **Obstacles immersed in the grid** (a fictitious domain with a sharp-interface constraint) rather than a body-fitted or cut-cell mesh: the grid never changes, so moving bodies cost no remeshing, and the force on an obstacle is the momentum the constraint removes, which makes the exchange with a rigid body equal and opposite by construction.
- **Free surface by APIC particles** (affine particle-in-cell, Jiang et al. 2015, from memory) with a ghost-fluid pressure condition. Particles carry the liquid without numerical loss of volume, and APIC keeps the grid-particle transfer stable without the noise of FLIP. A level set would lose volume; geometric volume-of-fluid in 3D was out of reach here.

## Equations and grid

```
du/dt + (u . grad) u = - grad p / rho + nu lap u + g + f          div u = 0
```

`rho` is `density`, `nu = mu / rho` with `mu` the dynamic `viscosity`, `g` is `gravity` and `f` the uniform `bodyForce` (a driving pressure gradient over density, for periodic channels). Cells are cubes of side `h` (`spacing`), `cells = [nx, ny, nz]` of them from `origin`. `u[i, j, k]` lies on the face at `x = i h`, at the centres of the cell in y and z, and likewise for `v` and `w`. Storage carries one ghost layer on every side; an axis with one periodic cell (a 2D flow) is skipped by the stencils.

Advection of component `c` at a face, flux form:

```
A_c = [ (ū_c ū_c)_{c+1/2} - (ū_c ū_c)_{c-1/2} + sum_{d != c} (ū_d ū_c)_{edge+} - (ū_d ū_c)_{edge-} ] / h
```

with each product taken at the cell centre (along c) or at the cell edge (across) from averages of the two neighbouring faces. `advection: 'upwind'` replaces the transported average by the upwind face value.

## One step

```
1. obstacles: signed distances, solid fractions and constraints of the faces near each obstacle (only where it moved)
2. u* = u^n + dt [ -(3/2 A^n - 1/2 A^{n-1}) + (1 - theta) nu L u^n + theta nu L u* - grad p^n / rho + g + f ]
   with the obstacle constraint on its faces (explicit: set after; implicit: Dirichlet rows of the solve)
3. outflow faces take their inner neighbour's value
4. A phi = -h^2 (rho / dt) div u*                         MIC(0)-PCG, until max |div u| h <= 1e-10 max |u|
5. u^{n+1} = u* - (dt / rho) grad phi,   p^{n+1} = p^n + phi
6. forces on the obstacles, energy ledger, Courant number
```

`theta` is 0 (`diffusion: 'explicit'`), 1/2 (`'crank-nicolson'`) or 1 (`'backward-euler'`). The first step uses forward Euler for advection. With only walls and periodic sides the Poisson problem is singular: the mean of the right side is removed and the pressure is kept at zero mean.

## Boundaries

Each side of the box is one of:

| Type | Normal velocity | Tangential velocity | Pressure |
|---|---|---|---|
| `no-slip` | zero | the wall's (`velocity`, e.g. a sliding lid), by a ghost value `2 u_wall - u` | zero gradient |
| `free-slip` | zero | zero gradient | zero gradient |
| `inflow` | given (`velocity`, a vector or a function of position) | given | zero gradient |
| `outflow` | zero gradient before the projection, then corrected by it | zero gradient | `p = 0` on the side |
| `periodic` | wraps (both sides of the axis) | wraps | wraps |

## Obstacles and forces on them

`addObstacle({shape, position, rotation, linearVelocity, angularVelocity})` adds a sphere, box, capsule (local Y axis) or solid cylinder. Its velocity is that of a rigid body, `v + w x r`. Each step, for the faces within 1.5 cells of the surface, the solver takes the signed distance `phi` to the surface and

- a face inside (`phi <= 0`) with a fluid face next to it along a grid line is a **ghost** face: its value is extrapolated linearly in the distance through the first fluid face out along that line (or the second, when the first is within half a cell of the surface), so that the interpolated velocity on the surface is the rigid one. The line is the one that crosses the surface most steeply;
- a deeper inside face takes the rigid velocity;
- fluid faces are not constrained.

The pressure is solved over the whole box, obstacles included (a fictitious domain). The constraint's impulse on the fluid is `J = sum rho h^3 (u_constrained - u_free)` over the constrained faces (`u_free` is what the predictor would have given). The force and torque on the obstacle over the step are

```
F = ( -J + (M_k - M_{k-1}) ) / dt  -  rho V_b (g + f)
```

`M_k` is the momentum of the fluid inside the obstacle at the end of step k, `sum rho alpha u h^3` with `alpha` the solid fraction of a face (a linear ramp of the distance over one cell, 1/2 on the surface), and `V_b = sum alpha h^3` the displaced volume. The middle term removes the fluid that rides inside the body; the last is buoyancy, because the fluid inside carries its own weight on the pressure. By the divergence theorem this is the pressure and viscous traction integrated over the obstacle's surface. Since it is built from the same numbers the fluid receives, the momentum the fluid gains and the impulse the body is handed are equal and opposite to round-off. The fluid's own momentum is `sum rho (1 - alpha) u h^3`.

`controlVolumeForce(min, max)` gives an independent measure: the momentum flux, the pressure and the viscous stress on the faces of a box of cells around the body, plus the body force on the fluid inside it (steady flow only). On the Stokes case it agrees with the obstacle force to 9e-5.

The pressure inside an obstacle has no physical meaning. Because the extrapolated ghost values are not divergence-free with the rigid ones behind them, the projection keeps adding a small constant to it each step; it creeps without bound inside the body and does not affect the flow or the force outside (the Stokes force converges while it creeps).

## Time step

- Explicit viscosity: `dt <= h^2 / (2 d nu)`, with `d` the number of active axes. A larger step is refused at construction with `EngineError` code `UNSTABLE_TIME_STEP`, unless `allowUnstable` is set (then `stats.unstable` is raised).
- Advection: the Courant number `dt (|u| + |v| + |w|)_max / h` must stay below `cflLimit` (default 1), counting walls, inflows and obstacle speeds. `checkTimeStep()` (called when a subsystem registers) refuses a step that starts above it; every step records `stats.cfl` and counts `stats.cflExceeded`, and the subsystem emits `'cfl-exceeded'`.
- `maxTimeStep()` returns both limits for the current state.
- Central advection is stable with Adams–Bashforth 2 below a Courant number of about 0.5 for inviscid flow (from memory); the viscous cases here run at 0.4 to 1.

## Energy ledger

`kineticEnergy()` is `sum 1/2 rho (1 - alpha) u^2 h^3` (wall faces count half). The solver integrates, by the trapezoidal rule on the rates at both ends of each step:

- `dissipated`: the discrete viscous dissipation `-rho nu sum u . L u h^3` plus the work of moving walls on their ghost values, which together are `mu |grad u|^2` summed over the links;
- `workByBoundaries`: moving walls, and the kinetic energy and pressure work carried through inflows and outflows (the outflow at `p = 0`, an approximation that uses the normal velocity only);
- `workByForces`: gravity and the body force on the fluid's momentum;
- `workByBodies`: minus the force and torque on each obstacle times its velocities at the start of the step.

`energyBalance()` = kinetic + dissipated − the three works stays constant up to the discretisation error. On the Taylor–Green vortex it drifts by 4e-4 of the dissipated energy at 32 cells, halving with the cell size. With moving bodies the sampled work is first order and the ledger does not close (a sphere dropped into a box: the residual is of the order of the kinetic energy); that is not validated.

## Two-way coupling

`new FluidCoupling(world, fluid)` takes any world with `gravity()`, `getState()`, `applyForce()` and `applyTorque()` (the kit's `PhysicsWorld`). The rigid step must be a whole number of fluid steps. `addBody(body, {shape})` makes the body an obstacle (its position is its centre of mass). `step()`, called immediately before `world.step()`:

1. reads each body's pose and velocity,
2. takes `substeps` fluid steps, the body moving at that velocity through them,
3. gives each dynamic body the mean force and torque of those steps through the rigid step. Components that are not zero but too small for a float32 are handed over as exact zero (as in the structure and granular couplings), because the world refuses them.

The fluid's gravity must be the world's for buoyancy to be right: the coupling does not copy it. The coupling is explicit, so the body sees the fluid one step late. It is stable when the rigid step is below the body's response time `m / (6 pi mu a K)` (a sphere 1.5 times denser than the fluid at 0.57 of it is stable; at 1.13 of it the run blew up) and when the body is not much lighter than the fluid it displaces (measured stable down to a density ratio of 1.1 with the step below the response time; with the ghost faces placed outside the body instead of inside, the ratio had to be above 3).

## In the stepping loop

`fluidSubsystem(target, {id, order})`:

- with a `FluidCoupling`: couple stage, order 180 (after the cloth at 150, the grains at 160 and solid contact at 170, before the water at 200); its step must equal the simulation step;
- with a bare `Fluid`: post stage, order 510; its step may be the simulation step, a whole fraction of it or a whole multiple.

Registration runs `checkTimeStep()`. Energy entry: `total` is the kinetic energy, `exchanged` the work of bodies, boundaries and forces, and the parts list `dissipated`. Events: `'cfl-exceeded'` when the Courant number first rises above the limit, `'unconverged'` when a projection stopped at `maxIterations`, `'unstable-step'` once for a solver built with `allowUnstable`. A run through a `Simulation` is bit-identical to calling the coupling by hand (checked).

## Free surface

`FreeSurfaceFluid({cells, spacing, density, dt, gravity, particlesPerAxis})` is a closed tank with free-slip walls holding an inviscid liquid and empty space (no air dynamics). `addLiquid(inside, velocity)` seeds `particlesPerAxis` particles per axis in every cell where `inside(x, y, z)` holds (one cell along z makes a 2D tank). Each step:

1. particles to grid by APIC: each particle gives its velocity plus its affine part `C (x_face - x_p)` to the eight (four in 2D) faces around it with trilinear weights;
2. cells holding a particle are liquid; gravity is added to faces that received weight; walls get zero normal velocity;
3. projection over the liquid cells, `p = 0` on the surface by the ghost-fluid rule: across a liquid-empty face the surface lies at `theta h` from the liquid centre, `theta = 1 - phi_empty / h`, with `phi_empty` the distance from the empty cell's centre to the nearest particle less half a particle spacing (at least 0.05);
4. velocity extrapolated two layers into the empty cells;
5. grid to particles: velocity and its gradient (the new `C`), then the particles move by `dt v` and are kept inside the tank.

Particles conserve the liquid's mass exactly; the volume of the cells they occupy is what the checks call volume. There is no viscosity, surface tension, obstacle or coupling in this option.

## Validation

`packages/box3d-kit/test/v18-fluid.test.mjs` (14 tests, 31 s on the machine below) asserts on the set-ups in `packages/box3d-kit/test/fluid-scenarios.mjs`, and the validation registry (`validation/domains/fluid.mjs`, 31 rows in [`VALIDATION.md`](VALIDATION.md)) reports the same runs. Measured values, from the registry run:

| Case | Reference | Measured | Tolerance |
|---|---|---|---|
| Divergence after projection, random field, walls / periodic / outflow, tilted capsule | 0 (solver stops at 1e-10) | 6.4e-11 (max \|div u\| h / max \|u\|) | ≤ 1.5e-10 |
| Taylor–Green decay rate, 32², U = 1 m/s, nu = 0.01 m²/s | 4 nu = 0.04 /s | 0.039887 (−0.28%) | ±0.5% |
| Taylor–Green L2 velocity error at 16, 32, 64 cells | exact solution | 2.45e-4, 5.53e-5, 1.22e-5 | order 2.19 (32→64), ±0.3 of 2 |
| Taylor–Green energy ledger, 32² | E + D constant | −3.9e-4 of the dissipated energy | ±1e-3 |
| Plane Poiseuille, 16 cells | discrete error (h/H)² = 3.906e-3 of the peak | 3.906e-3 (to 2e-8 relative) | ±1e-6 relative |
| Plane Couette, 16 cells | linear profile (exact on the grid) | 3.7e-9 of the wall speed | ≤ 1e-7 |
| Square duct, flow rate, 16² | series solution | +1.5% (+5.9% at 8²) | ±2% |
| Square duct, profile convergence | order 2 | 1.90 | ±0.3 |
| Channel with inflow and outflow, pressure gradient | −8 mu U/H² = −18 Pa/m | −17.815 (+1.0%) | ±2% |
| Channel, outlet profile; mass | parabola; flux in = out | 5.2e-3 of the peak; −6e-11 | ≤ 1e-2; ±1e-8 |
| Lid-driven cavity Re 100, 32², u and v on the centre lines | Ghia et al. 1982 | 0.22% and 0.82% of the lid speed (largest) | ≤ 0.5% and 1.2% |
| Lid-driven cavity Re 400, 48² | Ghia et al. 1982 | 1.34% and 1.48% | ≤ 2.5% |
| Water at rest with a sphere, 40 steps | u = 0 | 8e-20 g dt | ≤ 1e-12 g dt |
| Water at rest, pressure head | rho g (L − h) | to 1e-12 relative | ±1e-9 |
| Buoyancy of the sphere (2.4 cells per radius) | rho g (4/3) pi a³ | +4.96% (= rho g × grid volume to 1e-9) | ±6% |
| Stokes drag in a periodic cube, a = 0.15 L, 16³ (2.4 cells per radius) | Hasimoto K = 1.700 | 1.5727 (−7.5%) | ±10% |
| Stokes drag, 24³ (3.6 cells per radius) | Hasimoto K = 1.700 | 1.6436 (−3.3%) | ±5% |
| Stokes drag on a control surface | obstacle force | +8.6e-5 | ±1% |
| Terminal velocity of a rigid-world sphere (density ratio 1.5, Re 0.03) | from Hasimoto's K | −6.0% | ±12% |
| Momentum exchanged with a thrown rigid sphere: fluid side; total through the world | equal and opposite; constant | 9e-16; 2.8e-7 | ≤ 1e-12; ≤ 1e-6 |
| Repeat runs (coupled, through the Simulation, free surface) | bit-identical | 0 differ | 0 |
| Dam break front, 13 points Z = 1.44 to 6.76 | Martin & Moyce 1952 | worst 7.4% (after the paper's normalisation) | ≤ 10% |
| Dam break, volume of liquid cells | conserved | −3.9% | ±6% |
| Sloshing, first mode, 32 cells along | omega² = g k tanh(kH): 1.3379 Hz | 1.3315 Hz (−0.48%) | ±2% |
| Sloshing, volume after three periods | conserved | −0.19% | ±1% |
| Still water with a free surface, 1 s | u = 0 | 7.8e-12 sqrt(g h) | ≤ 1e-9 |

Notes on the cases:

- **Taylor–Green.** A periodic square of side 2π, U = 1 m/s, nu = 0.01 m²/s, run to t = 1 s at a Courant number of 0.4 (so dt halves with h). The rate error falls from −1.2% (16) to −0.28% (32) and −0.061% (64): second order. The decay rate of the discrete mode is 4 nu sin²(h/2)/(h/2)², which accounts for the sign.
- **Channels.** The Poiseuille error is exactly the closed form of the discrete problem: the ghost value at the wall is linear extrapolation, so the computed profile is the parabola shifted down by G h²/(8 nu). The square-duct series (White, *Viscous Fluid Flow*, from memory) was checked in the test against its limits: a wide duct gives plane Poiseuille flow at its centre and the flow rate loses 0.630 a/b at the edges; the centre speed of a square duct, 0.2947 G a²/nu, matches the value remembered for it.
- **Lid-driven cavity.** Reference values: Ghia, Ghia & Shin, *J. Comput. Phys.* 48 (1982) 387–411, tables I (u on the vertical centre line) and II (v on the horizontal centre line), at the 15 interior stations of each. The paper itself was not opened. The values were taken from transcriptions found on the web, and the Re 100 and 400 columns agree between independent copies: table I from https://gist.github.com/ivan-pi/3e9326d18a366ffe6a8e5bfda6353219 and from `data/ghia_1982_u.txt` of the StreamVorti repository (github.com/benzwick/StreamVorti); table II from https://raw.githubusercontent.com/DravenPie/PINNFormers-Navier-Stokes-Equations/HEAD/data/ghiav.txt and https://raw.githubusercontent.com/hhucyl/permeable_bed/HEAD/uy.txt (a third copy, StreamVorti's `ghia_1982_v.txt`, is garbled and was not used). The Re 400 station x = 0.9063 (v = −0.23827) is flagged in one copy as probably wrong and is left out. The solver runs the problem in the paper's units (unit cavity, lid speed 1, nu = 1/Re) by backward Euler to a steady state (velocity change below 1e-6, Re 400: 2e-6, of the lid speed per unit time). Ghia et al. used 129² cells with a second-order scheme; differences of a few tenths of a percent are within their own error.
- **Water at rest.** A 0.2 m cube of water started from the hydrostatic pressure with a fixed sphere of radius 30 mm in it. Started from zero pressure instead, the first step leaves a start-up transient of about 1e-3 m/s around the sphere that viscosity then damps; the row is for a tank that has been at rest. The buoyancy is rho g times the grid's displaced volume, which is 5% above the sphere's because the solid-fraction ramp adds about h²/(4a²).
- **Stokes drag.** One sphere of radius 0.15 L in a periodic cube of side L = 20 mm, mu = 1 Pa s, driven by a body acceleration, Re 0.05. In a periodic cube the sphere is one of a simple cubic array, whose drag is not 6 pi mu a U: Hasimoto's correction (H. Hasimoto, *J. Fluid Mech.* 5 (1959) 317) for solid fraction c, `1/K = 1 − 1.7601 c^(1/3) + c − 1.5593 c²`, gives K = 1.700 at c = 0.0141. The coefficients are those printed by Ladd (*Numerical simulations of particulate suspensions via a discretized Boltzmann equation, Part II*, eq. 3.5, read in the arXiv copy comp-gas/9306005; the journal is J. Fluid Mech. 271, 1994, from memory) as 2.837 a/L, 4.19 a³/L³ and 27.4 a⁶/L⁶, which are the same numbers written with c = (4/3) pi a³/L³; U is the mean velocity over the whole cell (Ladd's volumetric flow rate). The error falls from −7.5% to −3.3% between 2.4 and 3.6 cells per radius, at the rate of h² relative to Hasimoto's K. The control-surface force is the independent check that the force is the surface traction.
- **Terminal velocity.** A sphere of the rigid world (density 1500 kg/m³, radius 3 mm) in the same periodic cube of a fluid with nu = 2e-3 m²/s, gravity on both, and a uniform back-pressure on the fluid so that fluid and sphere carry no net external force (the periodic analogue of a closed container). At its terminal velocity the drag balances m g V/(V − V_b); with the frame of zero total momentum and Hasimoto's K that gives U = −m g V²/(6 pi mu a K (V − V_b)(m/rho + V − V_b)). The rigid step is 0.5 ms (0.57 of the response time m/(6 pi mu a K)); the run is 0.1 s, about 20 viscous times of the cube. The sphere moves through the cells and its drag changes by a few percent with its position; it is 6% fast here, consistent with the 7.5% low drag of the fixed sphere.
- **Momentum.** A 3000 kg/m³ sphere thrown at 54 mm/s with a spin through a periodic cube of fluid at rest, no gravity, explicit viscosity, 60 rigid steps of 1/120 s. "Fluid side" is the change of the fluid's own momentum plus the impulses handed to the body, both float64: 9e-16 of the exchange. "Total" uses the body's momentum from the world's float32 state: 2.8e-7.
- **Dam break.** J. C. Martin and W. J. Moyce, *An experimental study of the collapse of liquid columns on a rigid horizontal plane*, Phil. Trans. R. Soc. A 244 (1952) 312–324, table 2 (rectangular section, n² = 2: height 2a, width a), read from the scanned copy at https://www.math.ntu.edu.tw/~shyue/orch08/benchmarks/lowmach/broken-dam/91519.pdf. The rows used are the mean of the three records with a = 1⅛ in (Z = 1.44 to 6.76), whose layout in the scan is unambiguous; the a = 2¼ in columns are not used. The paper normalises every record's time so that T = n t (g/a)^(1/2) = 1.19 at Z = 1.44, because the instant of release was not recorded; the computed times are shifted the same way (by +0.263). The computed front then runs 4–7% late at Z ≈ 2.3–2.8 and 7% early at Z = 6.76: its speed is dZ/dT ≈ 1.8 against 1.26 measured, closer to the inviscid limit 2 (Ritter's solution, from memory). The experiment is small (a ≈ 29 mm), with friction and surface tension; the computation has neither. 16 cells per a; at 32 cells the times change by less than 2%.
- **Sloshing.** Water 0.2 m deep in a tank 0.4 m long, the surface started as 10 mm cos(pi x / L), 32 × 26 cells, 2048 particles. The frequency is read from the crossings of the horizontal centre of mass of the particles over three periods. Without the ghost-fluid surface condition (p = 0 at the empty cell's centre) the same case gave −30% at 32 cells and −3.6% at 64; with it, −0.5% at 32, −0.9% at 48 and −0.1% at 64. The amplitude falls to 0.85 of its start in three periods.

## Cost

Measured with `node packages/box3d-kit/scripts/bench-fluid.mjs` (Node 22.23, one thread of an Intel Xeon at 2.1 GHz in a cloud sandbox; a plain JavaScript multiply-add loop runs at 12 ns per element on it, several times slower than a desktop, so treat the numbers as a lower bound). Lid-driven box, explicit viscosity, central advection, after start-up:

| Grid | ms per step | cell-steps per second | cells stepped in 1/60 s |
|---|---:|---:|---:|
| 16³ (4,096 cells) | 5.0 | 0.83 million | 13,800 |
| 16³ with a sphere | 4.6 | 0.89 million | 14,900 |
| 32³ (32,768 cells) | 53 | 0.62 million | 10,300 |
| 32³ with a sphere | 58 | 0.57 million | 9,500 |
| 48³ (110,592 cells) | 332 | 0.33 million | 5,600 |
| 64² (2D) | 8.5 | 0.48 million | 8,000 |
| 128² (2D) | 69 | 0.24 million | 4,000 |
| Dam break, 128 × 40 cells, 2,048 particles | 8.5 | 0.24 million particle-steps/s | |

So about 10,000 cells (a 21³ box) keep up with a 60 Hz loop at one fluid step per frame on this machine; the pressure solve's iteration count grows with the grid (22 at 16³, 50 at 48³), so the throughput per cell falls on larger grids. Implicit viscosity adds three conjugate-gradient solves per step.

## Limits

- No turbulence model. Central differences are for resolved flow; at cell Reynolds numbers above a few they oscillate, and `upwind` is first order. No case is above Re 400.
- Immersed obstacles: the surface is placed to second order in the cell size along one grid line, and the drag is several percent off at 2–4 cells per radius. Lift, torque on a body, bodies under two cells across and thin plates are not checked. Obstacles overlapping each other or the walls are not handled specially. The pressure inside an obstacle creeps (see above).
- The coupling is explicit; the step limits are in [Two-way coupling](#two-way-coupling). Only spheres are checked. The coupled energy ledger does not close.
- The free surface: inviscid, no surface tension, closed free-slip tanks only, no obstacles or bodies, the volume of occupied cells varies by a few percent in splashing flow, and the transfers damp waves (15% of a sloshing amplitude in three periods). It is 2D-checked only.
- Fluid is not in the scene format, the Lab or the Studio. No GPU version; one thread.
- Steady states with obstacles converge slowly in step count (77 steps at 16³, 189 at 24³ for the Stokes case).
