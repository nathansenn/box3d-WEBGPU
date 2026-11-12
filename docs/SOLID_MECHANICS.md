# Solid mechanics

`solid-tet-corot-js-f64-v1` is a finite-element solver for deformable 3-D solids with real material parameters: Young's modulus `E` (Pa), Poisson's ratio `nu`, density `rho` (kg/m³) and an optional thermal expansion coefficient (1/K). It is the first continuum solid in the project. Metals can yield: J2 plasticity with isotropic hardening and ductile erosion (section Plasticity). The Studio's rubber lab (one spring-damper), its concrete lab (a bond lattice) and the app's cloth and rope (uncalibrated PBD) do not use it yet.

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
| `green-lagrange` | `mu E:E + lambda/2 tr(E)^2`, `E = (F^T F - I) / 2` (St Venant-Kirchhoff) | `P = F (2 mu E + lambda tr(E) I)` |

- The linear model is small-strain Hooke's law. It produces false stress under rotation.
- The corotational model applies Hooke's law to the stretch that is left after removing each element's rotation `R`. The force is the usual corotational force `R K_e (R^T x - X)`. The solver uses its exact tangent, including the derivative of `R`, so Newton's method converges quadratically. `R` comes from the Newton iteration `R <- (R + R^-T) / 2`.
- The Neo-Hookean model is the compressible form above (Bonet and Wood). It reduces to Hooke's law with the same `E` and `nu` at small strain and is valid at large stretch.
- Strains are computed from `H`, not from `F - I`, so small strains keep full relative precision.

- The Green-Lagrange model is exact under rotation and matches Hooke's law at small strain. It is the model that carries plasticity through large rotations (see below). Like every St Venant-Kirchhoff law it softens under strong compression; use it for small elastic strain (metals).

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

**Viscoelasticity.** `config.viscoelastic: {branches: [{ratio, time}, ...]}` (1 to 8 branches, backward Euler only) adds a Prony series on the elastic stress of any of the three models: the material's `E` and `nu` are the long-term (relaxed) moduli, and branch `i` carries an overstress `h_i` that follows `ratio_i` times the elastic stress and relaxes with the time constant `time_i`. In one dimension at small strain the relaxation modulus is `E(t) = E (1 + sum ratio_i exp(-t / time_i))`; one branch is the standard linear solid (Zener), with instantaneous modulus `E (1 + ratio)` and creep retardation time `time (1 + ratio)`. Each step uses Simo's recursion `h_i <- a_i h_i + b_i ratio_i (P_e,new - P_e,old)`, `a_i = exp(-dt / time_i)`, `b_i = (1 - a_i) / (dt / time_i)`, exact when the elastic stress varies linearly within a step. Within a step the stress is `s P_e + C`, with `s = 1 + sum b_i ratio_i` and `C` from the history: the gradient of `s W + C : H`, so the step is still one minimisation with the tangent scaled by `s`. The history is per element (9 numbers per branch) and is part of `saveState()`, so a checkpointed viscoelastic body resumes bit for bit (asserted); it is committed after each step of `step()` and of `SolidContact` (through the kernel's `advance`). `stresses()` reports the elastic stress plus the overstress; `strainEnergy()` the long-term (elastic) part; `solveStatic()` gives the relaxed response and leaves the body relaxed (no overstress). For the finite-strain models the overstress follows the first Piola-Kirchhoff stress of the elastic law (a stress-based finite-strain Prony model, not a multiplicative split): it is exact for a uniform deformation held or applied at constant rate, and not objective under large rotation while the overstress is non-zero.

**Failure.** `failedElements({criterion, strength})` returns the elements whose largest principal stress (`max-principal`, brittle) or von Mises stress (`von-mises`, yield) is above a strength. This is post-processing only. An elastic body does not yield, soften or crack; a plastic one yields and erodes (see Plasticity). Crack propagation is a separate body type on this element's linear model, `FractureBody`: see [`SOLID_FRACTURE.md`](SOLID_FRACTURE.md).

## Plasticity

A material with `yieldStress` (Pa) makes the `linear` and `green-lagrange` models elastic-plastic (solver id `solid-tet-j2-js-f64-v1`):

- **Yield and flow.** Von Mises (J2) yield surface `q = sqrt(3/2) |s| = sigma_y0 + H p`, associative flow, linear isotropic hardening with modulus `hardeningModulus` H (Pa; the uniaxial slope after yield is `E H / (E + H)`), `p` the equivalent plastic strain. The plastic strain is additive and deviatoric: in the small strain (`linear`) or in the Green-Lagrange strain (`green-lagrange`, so a rigid rotation leaves the plastic state and the stress exactly as they were).
- **Update.** Backward-Euler radial return per element from the state committed at the end of the previous step or load step: `dp = (q_trial - sigma_y) / (3 mu + H)`. Statics and implicit steps minimise one incremental potential, the stored elastic energy plus `sigma_y0 dp + H (p dp + dp^2 / 2)`; its gradient is the returned stress and its Hessian the consistent elastic-plastic tangent `C - 2 mu beta I_dev - 2 mu (3 mu / (3 mu + H) - beta) n (x) n`, `beta = 3 mu dp / q_trial`, so Newton keeps its quadratic convergence and the line search stays an energy descent. The state is committed after every converged load step (`solveStatic`), every step (`step`, implicit or explicit) and every step of `SolidContact` (`kernel().advance`, or `kernel().commit()` after a static contact solve).
- **History.** A second `solveStatic` starts from the present state, but with `loadSteps` above one it raises loads and prescribed values from zero again, which unloads and reloads a plastic body. Apply a loading history as successive `solveStatic()` calls with one load step each, changing the constraints or loads in between.
- **Ductile failure.** With `failureStrain`, an element whose committed `p` reaches it is eroded: it carries no stress and no stiffness from then on (`erodedCount`, `erodedMask`). One failure strain for every stress state: no triaxiality or Lode dependence, no damage softening before it, and the result depends on the element size (a crack is one element wide). Statics with an eroded element that leaves nodes unattached have no unique solution; erosion is meant for dynamics and contact steps.
- **Outputs.** `equivalentPlasticStrain()`, `plasticStrains()`, `plasticWork` (J, the sum of `V sigma_y dp`), `strainEnergy()` (stored elastic energy only), and the usual stresses.
- **Not available.** Plasticity together with viscoelasticity (refused with INVALID_PAYLOAD: the Prony branches act on the total elastic stress, J2 would need them on the elastic strain); the corotational and Neo-Hookean models (`P = R T` is not the gradient of the energy when the plastic strain is not coaxial with the stretch, so plasticity uses the Green-Lagrange measure instead), the midpoint integrator (it extrapolates past the solved state), kinematic hardening, rate dependence, thermal softening and finite plastic strain (multiplicative split). The additive Green-Lagrange split is a moderate-strain model: above a few tens of percent of plastic strain it departs from a finite-strain J2 model.

`materials.ts` `plasticMaterial(id)` builds yield stress, hardening and failure strain from the library's yield strength, tensile strength and elongation at break (docs/MATERIALS.md).

### Plasticity validation

`tests/engine/solid-plasticity.test.mjs` (9 tests, about 2 s) and `tests/engine/press-brake.test.mjs` (3 tests, about 25 s), both in `npm run test:solid`. E = 200 GPa, nu = 0.3, sigma_y = 250 MPa unless stated.

| Check | Expected | Measured | Tolerance and why |
|---|---|---|---|
| Uniaxial cycle 0 → 0.6% → −0.6% strain, linear model, H = 0 and 2 GPa | Bilinear law: hardening branch, elastic unloading with slope E, reverse yield at `-(sigma_y + H p)` | Largest stress error 3.7e-11 (H = 0), 1.2e-11 (H = 2 GPa); p to 1e-8 | 1e-9: a uniform state, radial return is exact for it |
| Same, green-lagrange model | Same law to the order of the strain | Within 2% at strains to 0.6% | 2%: nominal stress against the second Piola-Kirchhoff measure |
| Rigid 90° turn of a yielded body, green-lagrange | Cauchy stress turns with the body, p unchanged | Exact to 1e-9 | rounding |
| Internal force against the energy, tangent against the internal force, both models, plastic state, turned 34° | Central differences | Gradient 1.6e-10 / 2.6e-9, tangent 6.1e-11 / 1.3e-9 | 1e-6 / 1e-7: difference step |
| Work of the end force over 40 increments to 0.6% | Stored elastic energy plus plastic work | 13.656 J against 1.682 + 11.986 = 13.668 J | 2e-3: trapezoidal work across the yield knee |
| Pure bending of a 10 × 10 mm beam, 16 × 8 × 2 cells (half width), perfectly plastic, at k/k_y = 0.5, 2, 8 | `M = 2 b [E k c^3 / 3 + sigma_y (h^2/4 - c^2) / 2]`, `c = sigma_y / (E k)` | M/M_y 0.5143, 1.4142, 1.5402 against 0.5000, 1.3750, 1.4922: 2.9%, 2.9%, 3.2% high | Between 0 and +4%: linear tetrahedra are too stiff in bending, and plastic incompressibility locks them slightly more |
| Springback after releasing the end of that beam at 7.4 k_y (mid-length curvature) | Curvature falls by `M(k) / (E I)` | 1.4960 k_y against 1.4909 k_y (0.34%) | 1%: stiffness and moment are both about 3% high and cancel in the recovery |
| Thick-walled cylinder, b = 2a, plane strain, 8 × 8 cells, perfectly plastic | First yield at the bore at p_y = sigma_y / (von Mises of the Lamé stresses per unit p) = 108.07 MPa; Hill's collapse p_L = (2 / sqrt 3) sigma_y ln(b/a) = 200.09 MPa | No element yields at 0.97 p_y, some at 1.06 p_y (centroids lie outside the bore); outer displacement 9.95e-5 m at 0.98 p_L, 5.7e-2 m at 1.02 p_L | Lamé outer displacement within 1.5%; collapse bracketed within ±2% of p_L |
| Erosion, bar with failureStrain 0.01 | No element erodes at p < 0.01; every element erodes when p passes it; the bar then carries nothing | As expected | exact |
| Explicit and backward-Euler dynamics | The state is committed every step; reset clears it | p > 0 after the stretch, 0 after reset | exact |
| Press brake, see docs/STUDIO_METAL_PRESS.md | Limit load and springback of a three-point air bend; cracking of 6061-T6 over a tight radius | 1.23 × beam theory; springback 0.90 of `F V^3 / (48 E' I)` | 1.0 to 1.35; 12% |

Not modelled: see the last bullet above. Plastic-incompressibility locking (no mixed or averaged-pressure element) is measured: 3.2% in 3-D bending at 8 cells through the depth, 6.6% (4 cells) and 1.8% (8 cells) in plane-strain bending at 16 k_y.

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

### Viscoelasticity

Measured by `tests/engine/solid-viscoelastic.test.mjs` (6 tests, in `npm run test:solid`), rows `solid.viscoelastic.*` in [`VALIDATION.md`](VALIDATION.md). One branch, `E` = 2 MPa long-term, `ratio` = 1.5, `time` = 2 s; a 0.1 m bar, `nu = 0`.

| Check | Expected | Measured | Tolerance |
|---|---|---|---|
| Strain held from the first step, 600 steps of `tau / 200` | the discrete recursion `E eps (1 + gamma b a^(n-1))` | 1.3e-15 | 1e-9 |
| The same at `t = tau` | `E eps (1 + gamma / e)` | +0.09 % (a step load is taken as a ramp over the first step) | 1 % |
| Creep under 50 kPa at `t = tau (1 + gamma)` | standard linear solid | −0.028 % (−0.057 % at twice the step: first order) | 1 % |
| Recovery `tau_c` after unloading | `(eps(t1) − sigma / E0) exp(−1)` | +0.10 % | 1 % |
| Neo-Hookean block held at a stretch of 1.5 | `(1 + gamma b a^(n-1))` times the elastic stress | 1.7e-15; relaxed to the elastic stress | 1e-9 |
| Statics | the long-term solid | identical to the elastic body | 1e-15 m |
| Cube on a plane through `SolidContact`, 16 `tau` | relaxed settlement `rho g L^2 / (2 E)` = 2.4525 mm | 2.4507 mm (−0.07 %), 0.28 of it after 5 steps | 3 % |
| Midpoint or explicit integrator with viscoelasticity | refused | `INVALID_PAYLOAD` | exact |

Cost: one elastic stress evaluation per element per step to commit the history, about one extra `energy` pass.

## Limits

**Bending (shear locking).** Linear tetrahedra are too stiff in bending. A cantilever with one cell through its thickness is three times too stiff, with two cells 1.56 times, with four cells 12%, with eight cells 3.4% (`nu = 0`). Outside the gate, 12 and 16 cells measured 1.5% (`nu = 0`) and 2.8% / 2.2% (`nu = 0.3`). Use at least four cells through the thickness of anything that bends, and expect frequencies of bending modes to be 5% to 6% high there.

**Clamped ends.** With `nu = 0.3` a fully clamped root also restrains Poisson contraction, which beam theory ignores. Richardson extrapolation of the 4, 8 and 16 cell results puts the 3-D limit about 1.2% below the Timoshenko value. That part of the error is the reference's, not the mesh's.

**Near-incompressibility (volumetric locking).** The same four-cell cantilever, tip error against Timoshenko as Poisson's ratio rises:

| `nu` | 0 | 0.3 | 0.45 | 0.49 | 0.499 | 0.4999 |
|---|---|---|---|---|---|---|
| Tip error | -12.3% | -12.5% | -17.2% | -22.0% | -27.3% | -29.3% |

The conjugate-gradient iteration count rises with it (125 at 0.3, about 2,500 at 0.4999). Uniform states, including hydrostatic ones, stay exact at any `nu`. Rubber at `nu = 0.45` is about 5 percentage points stiffer in bending than `nu = 0` on that mesh; `nu` above 0.49 needs a mixed or higher-order element, which this version does not have. `nu` is limited to 0.4999.

**Not modelled.** Contact between two solids and self-contact (contact with rigid bodies is in [`SOLID_CONTACT.md`](SOLID_CONTACT.md), node against body, backward Euler only); plasticity beyond what the Plasticity section lists (and plasticity combined with viscoelasticity); viscoelasticity with a rotation-objective finite-strain split (the Prony model above is stress-based); damage and crack propagation in `SolidBody` itself (its strength checks only flag elements; [`SOLID_FRACTURE.md`](SOLID_FRACTURE.md) describes the fracture solver built on the linear model); follower pressure; anisotropy; more than one material per body; higher-order or mixed elements; two-way coupling to the water, cable or frame solvers (the rigid world is coupled through `SolidCoupling`; the one-way links of [`SIMULATION.md`](SIMULATION.md) remain); checkpoints.

**Other limits.** Up to 200,000 nodes and 1,000,000 elements. The explicit stability limit is that of the reference shape. The midpoint rule conserves energy exactly only for the linear model. Backward Euler damps high modes strongly at large time steps. The stress of a rotated element is accurate to about 1e-16 `E` in absolute terms, so the relative precision of very small strains under large rotation is limited. JavaScript on one thread: the 10,000-unknown cantilever solves in about half a second, and no performance claim is made.

## Reproduce

```sh
npm run test:solid
node --test --test-reporter=tap tests/engine/solid.test.mjs   # prints the measured numbers
npm run typecheck
```
