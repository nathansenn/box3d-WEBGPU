# Solid mechanics

`solid-tet-corot-js-f64-v1` is a finite-element solver for deformable 3-D solids with real material parameters: Young's modulus `E` (Pa), Poisson's ratio `nu`, density `rho` (kg/m³) and an optional thermal expansion coefficient (1/K). It is the first continuum solid in the project. The Studio's rubber lab (one spring-damper), its concrete lab (a bond lattice) and the app's cloth and rope (uncalibrated PBD) do not use it yet.

Source: `src/engine/solid.ts` and `src/engine/solid-mesh.ts`. Kit import: `box3d-webgpu-kit/solid`. Validation: `tests/engine/solid.test.mjs`, run by `npm run test:solid` in the required pull-request gate.

It plugs into the shared stepping loop (`solidSubsystem`, [`SIMULATION.md`](SIMULATION.md)), where two one-way links reach it: the heat solver's temperature as thermal strain, and a rigid body's weight as a dead load. Contact with rigid bodies, friction, welds and the two-way coupling to the rigid world are a separate module on this solver, `SolidContact` and `SolidCoupling`: see [`SOLID_CONTACT.md`](SOLID_CONTACT.md). `SolidBody.kernel()` is the access that module uses; it does not change how `step` or `solveStatic` behave.

## Formulation

**Element.** Four-node tetrahedron with linear shape functions, so the displacement gradient `H = du/dX`, the deformation gradient `F = I + H`, strain and stress are constant in each element. Internal nodal forces are `f_a = V P g_a`, where `V` is the reference volume, `P` the first Piola-Kirchhoff stress and `g_a` the gradient of shape function `a`. Mass is lumped: each node takes a quarter of the mass of every element that touches it.

**Lamé parameters.** `lambda = E nu / ((1 + nu)(1 - 2 nu))`, `mu = E / (2 (1 + nu))`.

**Material models.**

| Model | Energy density per reference volume | Stress |
|---|---|---|
| `linear` | `mu eps:eps + lambda/2 tr(eps)^2`, `eps = sym(H)` | `sigma = 2 mu eps + lambda tr(eps) I` |
| `corotational` (default) | `mu e:e + lambda/2 tr(e)^2`, `e = S - I`, `F = R S` (polar decomposition) | `P = R (2 mu e + lambda tr(e) I)` |
| `neo-hookean` | `mu/2 (I_C - 3) - mu ln J + lambda/2 (ln J)^2`, `I_C = tr(F^T F)`, `J = det F` | `P = mu (F - F^-T) + lambda ln J F^-T` |

- The linear model is small-strain Hooke's law. It produces false stress under rotation.
- The corotational model applies Hooke's law to the stretch that is left after removing each element's rotation `R`. The force is the usual corotational force `R K_e (R^T x - X)`. The solver uses its exact tangent, including the derivative of `R`, so Newton's method converges quadratically. `R` comes from the Newton iteration `R <- (R + R^-T) / 2`.
- The Neo-Hookean model is the compressible form above (Bonet and Wood). It reduces to Hooke's law with the same `E` and `nu` at small strain and is valid at large stretch.
- Strains are computed from `H`, not from `F - I`, so small strains keep full relative precision.

**Inversion.** The two finite-strain models do not accept inverted elements. An element with `det F <= 1e-6` has infinite energy: the line search of the implicit solvers halves the step until no element is inverted, and a solve that starts from an inverted state, or an explicit step that inverts an element, throws `NUMERICAL_FAILURE`. Apply large prescribed displacements in several load steps. The linear model has no such limit and will happily return an inverted shape.

**Thermal strain.** A temperature rise `dT` above the stress-free reference enters as the isotropic eigenstrain `theta = alpha_T dT`, per element from the mean of its nodes. Linear: `eps - theta I`. Corotational: `S - (1 + theta) I`. Neo-Hookean: the law is applied to `F / (1 + theta)`. A free body expands by `theta` with zero stress in all three.

**Loads and constraints.** Prescribed displacement components at nodes (Dirichlet), point forces, uniform tractions and pressure on boundary faces, gravity. All loads are dead loads: tractions and pressure keep the direction and area of the reference shape. That is exact at small strain and an approximation for pressure at large deformation.

**Solver.** Statics and the implicit integrators minimise one incremental potential by Newton's method. Each Newton step solves its linear system with conjugate gradients, preconditioned by the diagonal of the reference stiffness plus the mass term. Products with the tangent stiffness are formed element by element; no global matrix is stored. For the finite-strain models the inner solve stops on a direction of non-positive curvature and a backtracking line search on the potential follows. A solve converges when the 2-norm of the unbalanced nodal forces is at most `tolerance` (default 1e-10) times the largest internal, external or inertial force norm seen during that solve. Statics can raise loads, prescribed displacements and temperature in equal load steps.

**Integrators.**

| Integrator | Scheme | Property |
|---|---|---|
| `backward-euler` (default) | `M (v1 - v0) / h = f(u1) - C v1`, `u1 = u0 + h v1` | Unconditionally stable. Damps: energy never rises. First order. |
| `midpoint` | The same equations at the half step, then `u1 = 2 u_mid - u0`, `v1 = 2 v_mid - v0` | Unconditionally stable for the linear model, where it equals Newmark average acceleration and conserves energy exactly. Second order. For the finite-strain models it does not conserve energy exactly. |
| `explicit` | Velocity Verlet with the lumped mass | Conditionally stable; the limit is reported and enforced. Second order. |

Rayleigh damping is `C = massDamping * M + stiffnessDamping * K`. For the finite-strain models `K` is the tangent at the start of the step. The implicit steps allocate nothing; work arrays are created once in the constructor.

**Explicit stability limit.** `explicitLimit()` returns `criticalTimeStep = (2 / omega_max)(sqrt(1 + xi^2) - xi)`, where `xi` is the Rayleigh damping ratio at `omega_max`. `omega_max` is bounded from above by the largest natural frequency of any single element with its own lumped mass, which never underestimates the assembled mesh. The result also gives the dilatational wave speed `sqrt((lambda + 2 mu) / rho)`, the smallest element altitude and the Courant number that relates them: measured 0.81 (`nu = 0.3`) to 0.86 (`nu = 0`) on the default box mesh and 0.69 on the `kuhn6` mesh. A body built with `integrator: 'explicit'` and `dt` above `explicitSafety` (default 0.9) times the limit throws `UNSTABLE_TIME_STEP`. The limit is that of the reference shape; strong compression raises element frequencies, so leave margin for the finite-strain models.

**Meshes.** `boxMesh` splits `nx × ny × nz` cells into tetrahedra. The default `alternating5` pattern uses five tetrahedra per cell and mirrors the split between neighbours; the mesh is mirror-symmetric about every mid-plane whose cell count is even. `kuhn6` uses six congruent tetrahedra per cell and favours one diagonal. Caller meshes are accepted as node positions and four indices per element in either orientation; degenerate elements, repeated nodes and unused nodes are rejected. One material per body.

**Outputs.** Nodal displacements and velocities; per element the strain tensor, Cauchy stress tensor, von Mises stress and principal stresses; strain energy, kinetic energy and load potential; reaction forces at constraints; current volume; the lowest natural frequency and mode (`fundamentalMode`, inverse iteration). For the finite-strain models the stress is `P F^T / J` and the strain is the Biot strain `V - I` in the current frame.

**Failure.** `failedElements({criterion, strength})` returns the elements whose largest principal stress (`max-principal`, brittle) or von Mises stress (`von-mises`, yield) is above a strength. This is post-processing only. The material does not yield, soften or crack in `SolidBody`. Crack propagation is a separate body type on this element's linear model, `FractureBody`: see [`SOLID_FRACTURE.md`](SOLID_FRACTURE.md).

## Validation

Measured by `tests/engine/solid.test.mjs` (22 tests, about 8 s) on Node 22.23.4, Linux x64. Run `node --test --test-reporter=tap tests/engine/solid.test.mjs` to print the measured numbers. Steel is `E = 200 GPa`, `nu = 0.3`, `rho = 7850 kg/m³` unless stated. "Irregular mesh" means interior nodes moved by up to 17.5% of a cell.

| Check | Expected | Measured | Tolerance and why | Order |
|---|---|---|---|---|
| Patch test, irregular mesh, all three models | Interior nodes follow `u = A X`; uniform stress | Displacement error 5e-15 to 8e-15 of the largest displacement; stress error 5e-14 | 1e-10: solver tolerance only, a linear field is in the element space | exact |
| Internal force is the gradient of the energy, all models, with thermal strain | Central difference of the energy | Agreement 1e-10 | 1e-8: difference step 1e-6 | n/a |
| Uniaxial tension, traction-driven, irregular mesh | Elongation `F L / (E A)` = 8.3333e-6 m; lateral strain `-nu` × axial; stress `F / A` | 8.33333333333333e-6 m; stress 833333.3333333 Pa | 1e-9: uniform strain, solver tolerance | exact |
| Simple shear | `G = E / (2 (1 + nu))` = 76.923077 GPa | 76.9230769231 GPa | 1e-9 | exact |
| Hydrostatic pressure | `K = E / (3 (1 - 2 nu))` = 166.666667 GPa | 166.666666667 GPa | 1e-9 | exact |
| Hanging bar, `nu = 0`, 1 / 2 / 4 cells across | Tip `rho g L^2 / (2 E)` = 1.73269e-6 m | Error -2.0e-4, -4.1e-5, -1.4e-5 | 5e-5 at the finest mesh; the lumped weights of a tetrahedral cross-section are not uniform | 2.3, 1.6 |
| Hanging bar, `nu = 0.3` | same | Error -1.6e-4 | `(w / L)^2` = 4.4e-3: the 3-D field is not one-dimensional | n/a |
| Cantilever, end load, `L / t = 5`, `nu = 0`, 1 / 2 / 4 / 8 cells through the thickness | Tip `F L^3 / (3 E I) + F L / (kappa G A)`, `kappa = 10 (1 + nu) / (12 + 11 nu)` | Error -67.2%, -35.8%, -12.3%, -3.4% | Bounds 68%, 37%, 13%, 3.6% (measured plus margin); always too stiff | 0.91, 1.54, 1.86 |
| Cantilever, `nu = 0.3`, 8 cells | same | Error -4.5% | 5% | see locking |
| Axial vibration, fixed-free, `nu = 0`, 4 / 8 / 16 / 32 cells | `f1 = sqrt(E / rho) / (4 L)` = 1261.886 Hz | Error -8.03e-3, -2.01e-3, -5.02e-4, -1.26e-4 | 1.3e-4 at 32 cells | 2.000, 2.000, 2.000 |
| Free vibration of that mode by the midpoint rule | `a cos(2 k atan(omega h / 2))` | Within 2e-8 of the amplitude over 400 steps | 2e-8: solve tolerance | n/a |
| First bending frequency, cantilever `L / t = 10`, 1 / 2 / 4 cells through the thickness | Euler-Bernoulli 81.538 Hz | Error +63.2%, +21.1%, +5.6% | 22% at 2 cells, 6% at 4 cells; too stiff, so too high | 1.58, 1.92 |
| Stress wave in a suddenly loaded bar, `nu = 0`, 100 cells, explicit | `sqrt(E / rho)` = 5047.5 m/s | 5002.2 m/s, error -0.90% | 2%: the front is spread by numerical dispersion | n/a |
| Energy, midpoint, linear model, 1200 steps (30 periods) | Constant | Largest relative change 6.4e-15 | 1e-10 | n/a |
| Energy, backward Euler, linear and corotational, 400 steps | Never rises | Monotone; 5.0e-4 of the start is left | Each step at most 1e-12 above the last | n/a |
| Energy, midpoint, corotational / Neo-Hookean, 0.1% strain | Not conserved exactly | Largest relative change 4.5e-5 / 5.5e-5 | 1e-3 | n/a |
| Rayleigh damping, one mode, three periods | Amplitude `exp(-zeta omega t)`, `zeta = alpha / (2 omega) + beta omega / 2` | Midpoint 0.34175 vs 0.34174 and 0.55053 vs 0.55051; explicit 0.47449 vs 0.47460 | 2e-3: 400 steps per period | n/a |
| Explicit limit | Larger steps refused; bounded at 0.999 of the limit | `UNSTABLE_TIME_STEP`; energy stays at most 0.90 of the start over 3000 steps | Energy below 2× | n/a |
| Rigid rotation by 120°, largest stress / `E` | 0 for corotational and Neo-Hookean | 1.9e-15 for both; linear model 2.7 | 1e-13: rounding | n/a |
| End face turned 60°, statics | Body follows rigidly, no strain energy | Distance from the rigid rotation 4e-15 m (corotational), 5e-14 m (Neo-Hookean); linear model 0.10 m with energy 6e-2 `E V` | 1e-9 m | n/a |
| Neo-Hookean bar stretched to twice its length | Nominal stress 1796388.8108227 Pa, lateral stretch 0.72593500563723 (root finding on zero lateral stress) | 1796388.8108227 Pa, 0.72593500563723 | 1e-9: uniform deformation | exact |
| Thermal, free block, all models | Expands by `alpha_T dT`, zero stress | Displacement within 1e-10; stress below 1e-9 `E alpha_T dT` | solver tolerance | exact |
| Thermal, bar held at both ends | `-E alpha_T dT` = -192.000 MPa | Linear -191.99999999999 MPa; corotational -191.52 MPa; Neo-Hookean -191.30 MPa | Linear 1e-10. Finite-strain models 5 `alpha_T dT` = 4.8e-3: they differ at first order in the strain | n/a |
| Thermal, fully confined, linear | `-E alpha_T dT / (1 - 2 nu)` | exact to 1e-10 | 1e-10 | exact |
| Failure checks | Uniform tension: all elements just below `F / A`, none just above. Tension plus weight: exactly the elements above the strength | All / none; set equal to an independent evaluation and to the analytic cut within one cell | exact set equality | n/a |
| Determinism | Identical bits on a repeat run | Identical for three model and integrator pairs, statics and dynamics | bit equality | n/a |
| Implicit step allocations | No typed arrays created in `step` | 0 | exact count | n/a |

The observed order is `log2(error(h) / error(h / 2))`.

## Limits

**Bending (shear locking).** Linear tetrahedra are too stiff in bending. A cantilever with one cell through its thickness is three times too stiff, with two cells 1.56 times, with four cells 12%, with eight cells 3.4% (`nu = 0`). Outside the gate, 12 and 16 cells measured 1.5% (`nu = 0`) and 2.8% / 2.2% (`nu = 0.3`). Use at least four cells through the thickness of anything that bends, and expect frequencies of bending modes to be 5% to 6% high there.

**Clamped ends.** With `nu = 0.3` a fully clamped root also restrains Poisson contraction, which beam theory ignores. Richardson extrapolation of the 4, 8 and 16 cell results puts the 3-D limit about 1.2% below the Timoshenko value. That part of the error is the reference's, not the mesh's.

**Near-incompressibility (volumetric locking).** The same four-cell cantilever, tip error against Timoshenko as Poisson's ratio rises:

| `nu` | 0 | 0.3 | 0.45 | 0.49 | 0.499 | 0.4999 |
|---|---|---|---|---|---|---|
| Tip error | -12.3% | -12.5% | -17.2% | -22.0% | -27.3% | -29.3% |

The conjugate-gradient iteration count rises with it (125 at 0.3, about 2,500 at 0.4999). Uniform states, including hydrostatic ones, stay exact at any `nu`. Rubber at `nu = 0.45` is about 5 percentage points stiffer in bending than `nu = 0` on that mesh; `nu` above 0.49 needs a mixed or higher-order element, which this version does not have. `nu` is limited to 0.4999.

**Not modelled.** Contact between two solids and self-contact (contact with rigid bodies is in [`SOLID_CONTACT.md`](SOLID_CONTACT.md), node against body, backward Euler only); plasticity and viscoelasticity; damage and crack propagation in `SolidBody` itself (its strength checks only flag elements; [`SOLID_FRACTURE.md`](SOLID_FRACTURE.md) describes the fracture solver built on the linear model); follower pressure; anisotropy; more than one material per body; higher-order or mixed elements; two-way coupling to the water, cable or frame solvers (the rigid world is coupled through `SolidCoupling`; the one-way links of [`SIMULATION.md`](SIMULATION.md) remain); checkpoints.

**Other limits.** Up to 200,000 nodes and 1,000,000 elements. The explicit stability limit is that of the reference shape. The midpoint rule conserves energy exactly only for the linear model. Backward Euler damps high modes strongly at large time steps. The stress of a rotated element is accurate to about 1e-16 `E` in absolute terms, so the relative precision of very small strains under large rotation is limited. JavaScript on one thread: the 10,000-unknown cantilever solves in about half a second, and no performance claim is made.

## Reproduce

```sh
npm run test:solid
node --test --test-reporter=tap tests/engine/solid.test.mjs   # prints the measured numbers
npm run typecheck
```
