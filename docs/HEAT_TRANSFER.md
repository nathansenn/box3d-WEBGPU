# Heat conduction in solids

`src/engine/heat.ts` (`HeatSolver`, solver id `heat-fv-implicit-js-f64-v1`) solves transient and steady heat conduction in solids. The kit exports it as `box3d-webgpu-kit/heat`. It is the first non-mechanical domain of Phase 3 of the [roadmap](ROADMAP.md).

It also has helpers that turn a temperature field into thermal strain, restrained thermal stress and a thermal-shock verdict. **These are a one-way thermal → stress estimate. They are not a coupled thermo-mechanical solver:** nothing computes displacements, and stress and cracking do not change the temperature field.

## Use

```ts
import {HeatSolver, thermalShock} from 'box3d-webgpu-kit/heat';

// A 10 mm alumina plate at 500 K whose two faces are suddenly held at 300 K.
const nx = 40;
const plate = new HeatSolver({
  nx, ny: 1, nz: 1,                       // cells; one cell on an axis makes it 1-D or 2-D
  dx: 0.010 / nx, dy: 1, dz: 1,           // cell size in metres
  materials: [{conductivity: 30, density: 3900, specificHeat: 880}],
  temperature: 500,                       // kelvin
  dt: 1e-3, scheme: 'backward-euler',     // or 'crank-nicolson' or 'explicit'
  boundaries: [
    {face: 'x-', type: 'temperature', temperature: 300},
    {face: 'x+', type: 'temperature', temperature: 300},
  ],
});
plate.step(100);                          // 0.1 s
plate.temperature;                        // Float64Array, one value per cell
plate.boundaryHeatRate(0);                // W into the solid through the first boundary
plate.storedEnergy();                     // J

const shock = thermalShock(plate.temperature, {
  expansion: 8e-6, youngsModulus: 370e9, poissonRatio: 0.22,
  reference: 500, constraint: 'plate', tensileStrength: 300e6,
});
shock.crackedCells;                       // the cells whose tensile stress reaches the strength
```

Cell `(i, j, k)` is at index `i + nx (j + ny k)`. Units are SI: metres, seconds, W/(m·K), kg/m³, J/(kg·K), W/m³, W/m², and temperatures in kelvin. Without a radiation boundary the equations only see temperature differences, so degrees Celsius work too.

## Equations

```
rho c dT/dt = div(k grad T) + q
```

`rho` is density, `c` specific heat, `k` conductivity and `q` a volumetric source. `k` may depend on temperature through a table; `rho` and `c` are constants per material.

## Discretisation

Cell-centred finite volume on a structured grid with one spacing per axis. Each solid cell `P` has heat capacity `C_P = rho c V` and exchanges heat with each solid neighbour `N` through a face conductance

```
G = A k_f / d        k_f = 2 k_P k_N / (k_P + k_N)
```

where `A` is the face area and `d` the spacing along that axis. The harmonic mean is the series resistance of the two half cells, so a layered wall is exact at steady state. The semi-discrete system is

```
C_P dT_P/dt = sum over neighbours G (T_N - T_P) + sum over boundary faces (a - g T_P) + q_P V
```

Every boundary face contributes an affine heat rate `a − g T_P` in watts (next section).

- **Per-cell material:** `material[cell]` indexes `materials`.
- **Solid mask:** `solid[cell]` non-zero marks solid. Cells outside the solid keep the value they were given and take no part. A face is *exposed* when its neighbour is outside the grid or not solid; exposed faces are insulated unless a boundary condition covers them. Voxelised shapes, cavities and separate bodies all work this way.
- **Temperature-dependent conductivity:** `conductivityTable` is piecewise linear and constant outside its range. It is evaluated at the start-of-step cell temperature (lagged), which keeps the step linear and exactly conservative.
- **Sources:** `heatGeneration` (W/m³, one value or one per cell) plus `sources`, each a cell or an inclusive box of cells with either a total `power` in watts (spread by volume over the solid cells) or a `density` in W/m³.

### Boundary conditions

A boundary condition names an outward `face` (`x-`, `x+`, `y-`, `y+`, `z-`, `z+`) and an optional `region` (an inclusive box of cell indices; default the whole grid). It acts on every exposed face of that orientation in the region, including the walls of internal cavities. With `u = k_P / (d/2)` the conductance per area of the half cell:

| Type | Law (heat flux into the solid) | In the cell equation |
|---|---|---|
| `temperature` | surface held at `T_s` | `g = A u`, `a = g T_s` |
| `flux` | `q''` W/m² (0 is the insulated default) | `g = 0`, `a = A q''` |
| `convection` | `h_c (T_inf − T_surface)` | half cell and film in series: `g = A u h_c / (u + h_c)`, `a = g T_inf` |
| `radiation` | `eps sigma (T_env⁴ − T_surface⁴)` | tangent at the present cell temperature (below) |

Radiation is linearised once per step. The surface temperature `T_s` is found by Newton iteration from `u (T_P − T_s) = eps sigma (T_s⁴ − T_env⁴)`; then with `h_4 = 4 eps sigma T_s³` the face uses `g = A u h_4 / (u + h_4)` and `a = Q + g T_P`, where `Q` is the exact radiated rate at the present temperature. `sigma` is 5.670374419e-8 W/(m²·K⁴). Radiation needs absolute temperatures and throws if a radiating cell is below 0.

Flux, convection and radiation may share a face (their rates add). A fixed temperature may not share a face with another condition.

### Time integration

With `R(T)` the right-hand side above and `L` its linear part, one step solves for the change `delta = T^{n+1} − T^n`:

```
(C/dt + theta L) delta = R(T^n)
```

| `scheme` | theta | Order in dt | Stability |
|---|---|---|---|
| `backward-euler` (default) | 1 | 1 | unconditional; never leaves the range of the data |
| `crank-nicolson` | 1/2 | 2 | unconditional, but see the limit on sudden changes below |
| `explicit` | 0 | 1 | `dt ≤ min over cells of C_P / (sum of G + sum of g)` |

The implicit matrix is symmetric positive definite. It is solved by conjugate gradients with a Jacobi (diagonal) preconditioner, matrix-free, starting from `delta = 0`, until the residual 2-norm is below `tolerance` (default 1e-12) times the right-hand-side norm. `step()` allocates nothing. If the iteration limit is reached the step throws `SOLVER_NOT_CONVERGED` and the state stays at the last completed step.

**Explicit limit.** For an interior cell of a uniform grid the limit is `h² / (6 alpha)` in 3-D, `h² / (4 alpha)` in 2-D and `h² / (2 alpha)` in 1-D, with `alpha = k / (rho c)`. Fixed-temperature, convective and radiating faces lower it (a fixed-temperature face counts double, because the wall is half a cell away: `h² / (3 alpha)` in 1-D). `explicitStabilityLimit()` reports the limit for the present state, `heatExplicitLimit(h, alpha, dimensions)` gives the uniform-grid value, and the constructor, `setTimeStep` and `step` throw `UNSTABLE_TIME_STEP` above it. At or below the limit every new temperature is a weighted average of old ones.

**Steady state.** `solveSteady()` solves `div(k grad T) + q = 0` directly with the same matrix-free solver. With radiation or `k(T)` it repeats (Newton for radiation, lagged `k`) until the largest change is below `nonlinearTolerance` (default 1e-11, relative). Every connected solid body needs a fixed-temperature, convective or radiating face; otherwise the call throws `SINGULAR_STEADY`. The steady solve does not change `time` or the energy ledgers.

## Outputs

| Output | Meaning |
|---|---|
| `temperature` | cell temperatures (`Float64Array`) |
| `faceHeatFlux()` | W/m² through interior faces, positive along +x, +y, +z |
| `cellFaceFlux(i, j, k, face)` | outward W/m² through any face of a cell, interior or boundary |
| `faceTemperature(i, j, k, face)` | interface temperature between two cells, or the surface temperature on a boundary face |
| `storedEnergy(reference = 0)` | `sum rho c V (T − reference)` in J |
| `boundaryHeatRate(index)`, `boundaryHeatRates()` | W into the solid through each boundary condition at the present temperature (radiation by the exact fourth-power law) |
| `boundaryEnergy`, `sourceEnergy` | J delivered so far by each boundary condition and by the sources, as the scheme applied them |
| `boundaryStepRates` | step-averaged W of each boundary condition over the last step |
| `sourcePower()`, `boundaryArea(index)` | W of all sources; m² a condition acts on |
| `diagnostics()` | all of the above as a plain object, with the last solve's iterations and residual |

**Energy audit.** Conduction between two cells is computed once and applied with opposite signs, so it cancels exactly in the sum over cells. For every scheme

```
storedEnergy(after) − storedEnergy(before) = sum(boundaryEnergy) + sourceEnergy
```

to the linear-solver tolerance (implicit) or roundoff (explicit). This holds with `k(T)` and radiation too, because the ledgers record the linearised rates the step actually used.

### Thermal strain, stress and thermal shock (one-way)

| Helper | Returns |
|---|---|
| `thermalStrain(T, alpha_T, T_ref)` | free thermal strain `alpha_T (T − T_ref)` per cell |
| `restrainedThermalStress(T, options)` | stress per cell in Pa, tension positive, for fully prevented thermal strain: `−E alpha_T (T − T_ref)` for a `bar`, divided by `(1 − nu)` for a `plate` and by `(1 − 2 nu)` for a `volume` |
| `thermalShock(T, options)` | the same stress, plus `cracked` (per cell), `crackedCells`, `count`, `maxTension` and `maxUtilisation`; a cell cracks when its tensile stress reaches `tensileStrength` |

`reference` is the stress-free temperature: one value, one per cell, or `'mean'`. `'mean'` uses the mean temperature of the solid cells, which describes a plate that is free to expand as a whole but cannot bend, with temperature varying through its thickness. `expansion`, `youngsModulus` and `tensileStrength` take one value or one per cell.

These formulas assume the stated restraint. A real part is restrained somewhere between "free" and "fully restrained", cracks relieve stress, and neither effect is modelled. Use the result as a screening estimate of where and when a quench would start to crack, and as the input a fracture model can consume.

## Validation

`tests/engine/heat.test.mjs` (17 tests, about 2 s) runs in the required pull-request gate as `npm run test:heat`, and in the engine suite. `packages/box3d-kit/test/v09-heat.test.mjs` repeats four checks against the packaged copy. Measured on Node 22, 2026-11-11. Errors are the largest over all cells unless stated. "Order" is the observed convergence order from successive refinements.

| Check | Expected | Measured | Tolerance | Observed order |
|---|---|---|---|---|
| Steady slab, fixed ends, 20 cells | linear profile; flux `k dT / L` = 25,000 W/m² | 5.7e-14 K; flux relative error 1.1e-14 | 1e-9 K; 1e-10 (solver tolerance: the scheme is exact for a linear profile) | exact |
| Composite wall, 2 and 3 materials | flux `dT / sum(L_i / k_i)` = 21.538462 and 20 W/m²; interface temperatures | flux relative error 1.4e-13 and 2.3e-13; interfaces 5.7e-14 K | 1e-9 (exact with harmonic means) | exact |
| Steady slab, uniform source | `T = T0 + q x (L − x) / (2k)`, 50 K rise | 0.781, 0.195, 0.0488, 0.0122 K at 8, 16, 32, 64 cells; equal to the predicted offset `q h² / (8k)` within 1e-9 K | the predicted offset; order 2 ± 0.001 | 2.0000 |
| Point source in a slab | heat splits by the two conduction paths | within the tolerance (the error is not printed) | 1e-10 K and 1e-10 relative (exact) | exact |
| Convection face | flux `dT / (L/k + 1/h_c)` = 4565.217 W/m²; surface temperature | flux relative error 4.0e-15; surface 8.0e-13 K | 1e-10; 1e-9 K (two resistances in series: exact) | exact |
| `k(T)` linear, steady | Kirchhoff flux 42,000 W/m² | relative error 4.9e-13 (4 cells), 2.7e-12 (8 cells) | 1e-9 | exact flux |
| `k(T)` quadratic (14 to 41 W/(m·K)), steady | flux `(1/L) ∫ k dT` = 39,000.025 W/m² | relative error 5.9e-4, 1.5e-4, 3.7e-5 at 8, 16, 32 cells | 5e-4 at 32 cells; order 2 ± 0.1 | 1.990, 2.000 |
| Semi-infinite solid, sudden surface temperature, Crank-Nicolson, `dt ∝ h` | erfc solution at t = 100 s | 2.42e-3, 6.06e-4, 1.52e-4 of the 100 K step at 50, 100, 200 cells | `0.25 (h/delta)²` = 3.0e-4 at 200 cells, `delta = sqrt(4 alpha t)`; order 2 ± 0.05 | 1.998, 2.001 |
| Same, backward Euler, `dt ∝ h²` | erfc solution | 9.52e-3, 2.36e-3, 5.88e-4 | `0.6 (h/delta)²` = 7.3e-4; order 2 ± 0.05 | 2.012, 2.004 |
| Same, backward Euler, `dt ∝ h` | first order in dt | 9.52e-3, 4.09e-3, 1.88e-3 | order between 0.95 and 1.25, falling towards 1 | 1.220, 1.122 |
| Same, order in dt alone (200 cells; dt 2, 1, 0.5 s) | 2 for Crank-Nicolson, 1 for backward Euler | from differences between successive runs | ± 0.02 | 1.9997; 1.0010 |
| Slab cooling, fixed faces: Fourier series at Fo 0.05 and 0.2 | series with 200 odd terms | 1.44e-3, 3.58e-4, 8.94e-5 of 200 K at 20, 40, 80 cells | 3e-4 at 80 cells; order 2 ± 0.1 | 2.006, 2.002 |
| First-mode decay rate, space error | `alpha (pi/L)²` = 1.265334e-2 1/s | relative error 8.20e-3, 2.05e-3, 5.14e-4 at 10, 20, 40 cells | predicted `(pi h/L)²/12` = 5.140e-4 at 40 cells, ± 2e-6; order 2 ± 0.02 | 1.996, 1.999 |
| First-mode decay rate, time error, Crank-Nicolson | exact rate of the space-discrete system | 8.35e-4, 2.08e-4, 5.21e-5 at 10, 20, 40 steps per time constant | order 2 ± 0.02 | 2.002, 2.000 |
| First-mode decay rate, time error, backward Euler | same | 1.23e-2, 6.20e-3, 3.11e-3 at 40, 80, 160 steps per time constant | order 1 ± 0.03 | 0.988, 0.994 |
| First-mode rate against the closed-form discrete rate | amplification factor per step of the scheme | agrees | 1e-9 relative (solver precision) | exact |
| Late-time decay rate of the cooling slab (Fo 0.5 to 0.8), 80 cells | `alpha (pi/L)²` | relative error 1.28e-4 | 3e-4 (`(pi h/L)²/12` = 1.3e-4) | |
| Lumped cooling, copper block 20 mm, 4³ cells, `h_c` = 10 W/(m²·K), `Bi` = 8.3e-5 | `T_inf + (T0 − T_inf) exp(−h A t / (rho c V))` over one time constant | mean temperature: 3.1e-5 of 100 K; worst cell: 1.84e-4 | mean: `Bi` = 8.3e-5; worst cell: `h (side/2) / k` = 2.5e-4 (the gradient inside the block) | |
| 2-D plate, square, one hot edge | centre = 25 (a quarter of the hot edge) | 2.6e-11 | 1e-9 (exact on the grid by superposition) | exact |
| 2-D plate, 2 × 1, hot long edge, `dx = 2 dy` | series: centre = 44.511510029 | error 0.1225, 0.01376, 0.00153 at 9, 27, 81 cells per side | 2e-3 at 81; order 2 ± 0.05 | 1.990, 1.999 |
| Radiation, 1 mm copper plate, 1000 K, surroundings at 0 K | closed form: 557.6674 K after 60 s | 0.0160, 0.0136, 0.0130 K at dt 0.5, 0.25, 0.125 s (Crank-Nicolson) | 0.1 K (the lumped model itself: radiation Biot number 2.3e-4) | time part falls 4× per halving |
| Radiation, surroundings at 300 K | RK4 of the lumped ODE, 60,000 steps: 564.1876 K | 0.0154, 0.0132, 0.0127 K (Crank-Nicolson); 1.49, 0.746, 0.378 K (backward Euler) | 0.1 K; backward Euler 1 K and order 1 ± 0.1 | backward Euler 0.980 |
| Radiating wall, steady | conduction to the surface = radiation from it | both 28,963.150539 W/m²; 5 Newton iterations | 1e-9 relative | |
| Energy audit: 3-D, two materials (one with `k(T)`), a cavity, all four boundary types, sources; 60 steps | stored-energy change = boundary heat + sources | defect 8.6e-15 (backward Euler) and 0 (Crank-Nicolson) of the 54 kJ exchanged | 1e-10 | |
| Explicit, 6³ block, insulated, `dt` at the limit | limit `h² / (6 alpha)` = 1.3 s; no overshoot | reported limit matches to 1e-12; 400 steps stayed inside the initial range; energy drift 2.0e-16 | bounds within 1e-9 K; energy 1e-13 | |
| Explicit, `dt` 0.1% above the limit | refused | `UNSTABLE_TIME_STEP` from the constructor and from `setTimeStep` | | |
| Explicit slab at half its limit, 20 cells | Fourier series at Fo 0.1 | 4.9e-4 of 200 K | 2e-3 | |
| Restrained bar, steel, +50 K | `−E alpha_T dT` = −120 MPa; plate −171.428571 MPa | equal | 1e-13 relative | exact |
| Quenched alumina plate (500 K → 300 K faces) | the two surface cells crack first; the cracked zone grows inwards and never shrinks | first cracks in cells 0 and 39 of 40 at t = 2.2 ms; whole thickness beyond the criterion at 0.862 s | exact | |
| Voxelised bar inside a 3-D grid | same as the 1-D bar | within the tolerance (the error is not printed) | 1e-10 K | |
| Determinism | identical bits on a repeat run; one call of 12 steps = 12 calls | identical | exact | |

Two tolerances were set after a first measurement and are stated as such:

- **Lumped cooling.** The first bound was `2 Bi` = 1.67e-4 on the worst cell, and the worst cell measured 1.84e-4. The lumped law describes the mean temperature; single cells differ from the mean by the gradient inside the block, which scales with `h (side/2) / k` = 2.5e-4, not with `h (V/A) / k`. The check now bounds the mean by `Bi` (measured 3.1e-5) and the worst cell by 2.5e-4.
- **`k(T)`.** The first version used a linear `k(T)` and expected second-order convergence of the flux; the flux came out exact to solver tolerance on any grid. That check is kept as an exactness check, and a quadratic `k(T)` now measures the order.

## Limits

- **Conduction in solids only.** No phase change (no latent heat, melting or solidification), no fluid flow, no natural or forced convection beyond a film coefficient you supply, no radiation between surfaces (each radiating face sees one environment temperature; no view factors), no contact resistance between materials.
- **Structured grid.** One spacing per axis, axis-aligned cells. Curved or slanted surfaces are stair-stepped by the solid mask, which makes their surface area wrong (a 45° face is too large by √2); boundary heat rates on such surfaces carry that error.
- **Isotropic conductivity**, one value per cell. `rho` and `c` do not depend on temperature. `k(T)` is lagged by one step, which makes Crank-Nicolson first order in dt for strongly temperature-dependent conductivity.
- **Second order in space**, with fixed-temperature faces half a cell from the first cell centre. Corners where different fixed temperatures meet are singular; the 2-D plate check converges at second order away from them.
- **Crank-Nicolson overshoots after a sudden change** when `alpha dt / h²` is large. In the erfc case at `alpha dt / h²` = 8.2 the cell next to the 400 K surface reached 452 K on the first step, and the error at t = 100 s was 1.3e-2 instead of 1.5e-4. Backward Euler does not overshoot. Use backward Euler for the first steps after a jump, or keep `alpha dt / h²` near 1 there.
- **Radiation is linearised once per step**: first order in dt with backward Euler, second with Crank-Nicolson, and exact at a converged steady state.
- **The explicit limit is the no-overshoot limit**, which is what the solver enforces. It is never looser than the true stability limit.
- **Solver cost.** Jacobi-preconditioned conjugate gradients needs a number of iterations that grows with the grid size for steady problems (36, 106 and 313 iterations for the 9², 27² and 81² plates). There is no multigrid. At most 2,097,152 cells.
- **The thermal stress helpers are one-way** and assume full restraint (or the free, non-bending plate with `reference: 'mean'`). They do not replace a stress analysis, and they are not yet connected to a fracture solver in the repository.
- CPU, float64, one thread. Not yet used by a scene, the Lab or the Studio.
