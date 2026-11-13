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

**Solver.** Statics and the implicit integrators minimise one incremental potential by Newton's method. Each Newton step solves its linear system with conjugate gradients, preconditioned by the diagonal of the reference stiffness plus the mass term (`linearSolver: 'cg'`, the default) or by a sparse factorization of the assembled tangent (`linearSolver: 'ldl'`, section Linear solver). Products with the tangent stiffness are formed element by element; with `cg` no global matrix is stored. For the finite-strain models the inner solve stops on a direction of non-positive curvature and a backtracking line search on the potential follows. A solve converges when the 2-norm of the unbalanced nodal forces is at most `tolerance` (default 1e-10) times the largest internal, external or inertial force norm seen during that solve. Statics can raise loads, prescribed displacements and temperature in equal load steps.

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

## Averaged nodal pressure element (`tet4-nodal`)

`config.element: 'tet4-nodal'` (default `tet4`) removes most of the volumetric locking of the four-node tetrahedron, elastic (rubber, `nu` near 0.5) and plastic (isochoric J2 flow), with the same nodes, shape functions, lumped mass, loads, contact and outputs. Source: `src/engine/solid.ts` (`elasticNodal`, `stiffnessNodal`); validation `tests/engine/solid-nodal.test.mjs` in `npm run test:solid`.

**Formulation.** Each law is split into a deviatoric energy, evaluated per element as before, and a volumetric energy evaluated at the nodes (the averaged nodal pressure of Bonet and Burton, 1998, written here as an energy):

    W = sum_e V_e W_dev(H_e) + sum_n W_n U(theta_n),   theta_n = sum_(e at n) (V_e / 4) theta_e / W_n,   W_n = sum_(e at n) V_e / 4

| Model | Element energy (`W_dev`) | Volumetric measure `theta_e` | `U` at the nodes |
|---|---|---|---|
| `linear` | Hooke with `lambda - K` (`mu eps:eps - mu/3 tr(eps)^2`, the deviatoric part) | `tr(eps)` less the thermal strain | `K/2 theta^2`, `K = lambda + 2 mu / 3` |
| `corotational` | the same on the Biot strain | `tr(S - I)` less the thermal strain | `K/2 theta^2` |
| `green-lagrange` (and J2) | the same on the Green-Lagrange strain; J2's radial return acts on the deviator only, as before | `tr(E)` less the thermal strain | `K/2 theta^2` |
| `neo-hookean` | `mu/2 (I_C - 3) - mu ln J` (the law with `lambda = 0`) | `J` of the elastic part | `lambda/2 ln^2 theta` |

The internal force is the exact gradient: each element's stress gains `pi_e G_e`, with `G_e = d theta_e / d H` and `pi_e` the mean of `U'(theta_n)` over its four nodes. The tangent is exact too: the element's own tangent, `pi_e dG_e`, and `d pi_e G_e` with `d pi_e` the mean over its nodes of `U''(theta_n) d theta_n` (two passes over the elements per product). Central differences confirm both in every regime the element takes: the four elastic models at `nu` = 0.3 and 0.49 with thermal strain, J2 on the linear and Green-Lagrange models from a plastic state turned 29°, and the viscoelastic Neo-Hookean body (tangent and gradient agree to 1e-9 to 1e-11). A uniform state gives every node the elements' own `theta`, so uniform states, the patch test and the uniform-state rows of section Validation (measured with tet4) are unchanged. Viscoelastic branches scale the whole elastic energy as for `tet4`; `stresses()` reports the element stress with `pi_e G_e`.

**Why this element.** It keeps the element's nodes, its variational structure (one energy, exact gradient and tangent, so Newton's method, the line search and the plastic return are unchanged) and everything that couples to nodes: `SolidContact`, welds, lumped mass, the Studio meshes and drawing. A mixed u-p element needs pressure unknowns and an indefinite system the minimisation does not have; a stabilised P1/P1 element needs a tuned parameter; quadratic tetrahedra (T10) would remove the bending error too but change the mesh, the lumped mass (corner masses of T10 need special lumping), contact and every Studio mesh. The nodal volume constraint gives one constraint per node against three unknowns per node, where per-element constraints give five to six per node (constraint counting in the manner of Hughes' constraint ratio; recalled, not re-read for this).

**Rejected: nodally averaged B-bar.** Replacing each element's volumetric strain by the mean of its nodes' averaged strain (which a pressure-dependent law would need) admits spurious soft modes: Cook's membrane at `nu` = 0.3 came out 2.5 times too flexible (22.96 against about 9.1 at 32 cells) and does not converge to the right answer. It is not in the code. **The concrete law therefore keeps `tet4`**: its Drucker-Prager yield depends on the pressure, so it does not split into the two energies; `element: 'tet4-nodal'` with `concrete` is refused (INVALID_PAYLOAD). Concrete is compressible (`nu` = 0.2), so elastic volumetric locking does not arise; locking of its dilatant plastic flow remains.

**Explicit limit.** By Jensen's inequality `sum_n W_n theta_n^2 <= sum_e V_e theta_e^2`, so the element's energy never exceeds `tet4`'s and the per-element bound of `explicitLimit()` (computed with `tet4`) still holds.

**Cost.** Two passes over the elements per energy and per tangent product instead of one (about 2 to 3 times the work per conjugate-gradient iteration), and a sparse matrix with a wider stencil (nodes within two element rings) when `ldl` is used.

### Validation of `tet4-nodal`

`tests/engine/solid-nodal.test.mjs` (in `npm run test:solid`), the press-brake test, the plasticity test and `tests/studio/rubber-si.test.mjs`; rows `solid.nodal.*` and `solid.bonded-compression` in [`VALIDATION.md`](VALIDATION.md).

| Check | Reference | tet4-nodal | tet4 | Tolerance |
|---|---|---|---|---|
| Patch test, irregular mesh, `nu` = 0.4999, four models | `u = A X`, uniform stress | displacement error 1e-15 to 3.5e-13, stress spread below 6e-13 | — | 1e-8, 1e-6 |
| Gradient and tangent, every regime | central differences | 1e-9 to 1e-11 | — | 2e-6 |
| Cook's membrane, `nu` = 0.4999, plane strain, tip deflection over 7.769 (reference of N. Sukumar et al., arXiv:2304.04941, Cook's membrane section), 4 / 8 / 16 / 32 cells per side | 1 | 0.536, 0.778, 0.907, 0.959 | 0.415, 0.571, 0.785, 0.904 | within 5 % at 32 cells, from below |
| Bonded rubber cylinder of the elastomer lab (5 cells across, `nu` = 0.49), apparent modulus over the Gent-Lindley closed form `1/E_c = 1/(E(1+2S^2)) + 1/K` (quoted as Eq. 2 in Koblar, Škofic, Boltežar, Strojniški vestnik 60 (2014) 506-511) | 1.12 (converged 3-D solution, below) | 1.286 | 1.516 | 1.12 to 1.31 |
| Same, 8 / 12 / 16 cells across | | 1.204, 1.166, 1.150 | 1.299, —, 1.181 (24 cells: 1.154) | measured |
| Same at `nu` = 0.4999, 5 / 8 / 12 / 16 cells | | 1.605, 1.297, 1.182, 1.138 | 18.2 (5 cells), 3.90 (8) | measured |
| Plane-strain pure bending, perfectly plastic, at 16 k_y, M over `M_p' (1 - (k_y/k)^2/3)`, 2 / 4 / 8 cells through the depth | 1 | 1.183, 1.048, 1.013 | 1.234, 1.068, 1.020 | below tet4; 1.055 and 1.016 at 4 and 8 cells |
| Press-brake air bend (4 cells, S355, V = 8 t): limit load over 4 M_p'/V; springback over F V^3 / (48 E' I) | 1 | 1.231; 0.925 | 1.228; 0.899 | 1.0 to 1.35; ±10 % |
| Thick cylinder (Hill), 8 x 8 cells: Lamé outer displacement at 0.97 p_y; collapse | Lamé; p_L = 200.09 MPa | -0.96 %; contained at 0.98 p_L, collapse at 1.02 p_L | -1.05 %; the same | 1.5 %; ±2 % |
| Cantilever, 4 cells, tip error against Timoshenko at `nu` = 0.3, 0.45, 0.49, 0.499, 0.4999 | 0 | -9.6, -14.2, -17.8, -21.5, -23.0 % | -12.5, -17.2, -22.0, -27.3, -29.3 % | softer than tet4 at every `nu` |
| Checkpoint: a viscoelastic tet4-nodal body in contact (ldl) and the press brake (tet4-nodal, ldl) resume bit for bit | | pass | | exact |

**The bonded block reference.** The closed form assumes the bulging faces stay parabolic; for this tall specimen (shape factor `S = R / (2 H)` = 0.34) it is not the 3-D answer. Richardson extrapolation of both elements (tet4-nodal from 8, 12 and 16 cells, observed order 1.5; tet4 from 8, 16 and 24 cells) gives 1.12 times the closed form for both, so the lab mesh is 15 % too stiff with tet4-nodal and 35 % with tet4 (the elastomer lab's forces were 52 % above the closed form before). Koblar et al. (Table 2, quadratic FE at `nu` = 0.4999) find the closed form within 1 to 3 % for S = 0.25 to 0.5 in their dynamic set-up; at `nu` = 0.4999 the extrapolation here gives about 1.07 (uncertain by a few percent).

**What it does not fix.** Linear tetrahedra are still too stiff in bending (shear locking), and that is what remains in the plastic bending and press-brake rows: the press-brake limit load is not changed by the element (1.23 at 4 cells, 1.167 at 8 cells with either element); the earlier docs put its excess on plastic-incompressibility locking, which the measurements above do not support. In the 4-cell cantilever the nodal pressure relieves part of the locking as `nu` approaches 0.5, not all of it. Convergence in the bonded block is slow (order about 1.5), because the bonded edge is singular.

## Linear solver (`linearSolver: 'ldl'`)

`src/engine/sparse-ldl.ts`. The tangent `kScale K + mScale M` is assembled into a sparse symmetric matrix of 3 x 3 node blocks (each element's 12 x 12 matrix from twelve products of its own tangent, and for `tet4-nodal` the per-node term `(U''_n / W_n) v_n v_n^T`, exact, so the structure holds the nodes within two element rings), ordered by minimum degree on the node graph (explicit elimination, ties to the lowest node index), and factored as L D Lᵀ, left-looking. It preconditions the same conjugate gradients, which still multiply by the exact tangent and stop at the same tolerance, so the answer is that of `cg` within the solve tolerance (measured: 5e-12 to 9e-12 of the largest displacement on a plastic bar) and Newton's method is unchanged.

- **Reuse.** The factorization is kept across Newton iterations and time steps and formed again only when an inner solve needed more than 8 iterations, the scales of K and M change, or an element erodes (a stale factor costs iterations, never accuracy). Its numbers are part of `saveState()`, so a resumed run preconditions with the same factor and repeats bit for bit (asserted).
- **Indefinite tangents** (softening, the geometric stiffness of a compressed sheet, strongly distorted finite-strain elements): the diagonal is raised by 1e-6, 1e-4, 1e-2 or 1 times itself (Levenberg-Marquardt) until no pivot needs resetting (the last attempt resets what it must), so the preconditioner stays positive definite; the conjugate gradients still stop at negative curvature of the true tangent. When a fresh shifted factorization still needs more than 16 inner iterations, the next 3 inner solves use the stiffness diagonal (as `cg`) before a new factorization is tried. Measured on the press's cracking V bend: resetting pivots alone sent the radius bend astray (two steps accepted unconverged, the sheet folded through itself); coarse shifts alone (1e-2 upwards) took 26,000 inner iterations; this policy 27,500 inner iterations and 120 factorizations on the V bend (51,600 with tet4 and `cg`), and 10,200 inner iterations and 200 factorizations over 1,830 Newton iterations on the radius bend (818,000 inner iterations over 2,290 Newton iterations with tet4 and `cg`).
- **`SolidContact`** adds its contact, friction and weld springs as node blocks before factoring; dynamic rigid bodies keep their 6 x 6 block preconditioner.
- **Cost.** One factorization of the lab meshes takes about 10 ms (216 nodes, tet4), 30 ms (216 nodes, tet4-nodal) and 600 ms (729 nodes, tet4-nodal); the ordering is formed once per body. Meant for the Studio's meshes (hundreds to a few thousand nodes); larger meshes keep `cg`.

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

`tests/engine/solid-plasticity.test.mjs` (9 tests, about 2 s) and `tests/engine/press-brake.test.mjs` (5 tests, about 40 s), both in `npm run test:solid`. E = 200 GPa, nu = 0.3, sigma_y = 250 MPa unless stated.

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

Not modelled: see the last bullet above. Plastic bending is too strong with tet4: 3.2% in 3-D bending at 8 cells through the depth, 6.8% (4 cells) and 2.0% (8 cells) in plane-strain bending at 16 k_y; `tet4-nodal` removes the plastic-incompressibility part (4.8% and 1.3%), and the rest is the bending error of linear tetrahedra.

## Concrete law

`material.concrete` (`src/engine/concrete-law.ts`; solver id `solid-tet-dp-rankine-js-f64-v1`) instead of `yieldStress`: composite plasticity for quasi-brittle solids, in the manner of Feenstra and de Borst's composite Rankine / Drucker-Prager model (not opened here; the formulation below is this code's own). Linear or green-lagrange model, backward Euler or explicit; refused with viscoelasticity.

- **Inputs** (`ConcreteLawInput`): `compressiveStrength` f_cm, `tensileStrength` f_ctm, `peakStrain` eps_c1, `ultimateStrain` eps_cu1, `fractureEnergy` G_f; optional `crushingEnergy` G_c (default f_cm × 0.5 mm / 2), `friction` beta (default 0.364), `elasticLimit` (default 0.4), `bandWidth` h (default (6 V̄)^(1/3)), `tensionSoftening` (a stress–opening table of area G_f; default linear), `erosionOpening` (default 1 mm). `materials.ts` `concreteMaterial(id)` fills them from the library (EN 1992-1-1 classes C20/25, C30/37, C60/75, LC25/28; alumina, elastic to the peak).
- **Compression.** Associated Drucker-Prager `f = q + beta p - k(kappa_c)` (p mean stress, tension positive). In uniaxial compression the axial plastic strain is `(1 - beta/3) kappa_c` and the stress `k / (1 - beta/3)`, so k is tabulated from EN 1992-1-1 (3.14): elastic to `elasticLimit` × f_cm with E = E_cm, then the curve's plastic strain `eps(sigma) - sigma / E` (the small offset at the start is blended out by the peak, so the law meets f_cm at eps_c1 exactly), the descending branch to eps_cu1, then a straight tail to zero along its last slope. After the peak the abscissa is the plastic displacement `w = (eps_p - eps_p1) h`: the descending branch is laid out on a reference length L_c chosen so that the area of the whole tail is G_c, so an element of band width h = L_c follows (3.14) and any other h dissipates the same G_c per unit area. Where (3.14) is stiffer than E above the elastic limit (a nearly linear curve, k ≈ 1, as for lightweight concrete) the elastic range is extended to where its tangent falls to E.
- **Tension.** Rankine, `sigma_i <= f_t(kappa_t)` on each principal stress (one, two or three active planes), associated, with f_t a function of the crack opening `w = kappa_t h`, kappa_t the sum of the principal plastic strains.
- **Return mapping.** The incremental potential (elastic energy of `eps - eps_p` plus `int k d kappa_c + int f_t d kappa_t` over the increment) is minimised per element. Both surfaces are isotropic, so the trial elastic strain's principal axes are kept. A pure Drucker-Prager return is closed form in tensor form (radial in the deviatoric plane, a one-dimensional equation in kappa_c on the piecewise-linear table, the apex when the deviator would reverse); otherwise the Drucker-Prager and Rankine blocks are solved in turn, with Anderson mixing, to 1e-15 of the strain. The returned stress is the derivative of that energy (checked by central differences), so the solid's Newton line search stays an energy descent.
- **Tangent.** Forward differences of the returned stress in the six engineering strains, symmetrised, formed only when a product first needs it (line-search trials that are not kept cost nothing). Softening elements give it negative eigenvalues; the conjugate gradients stop at negative curvature and Newton continues with the direction they have, so convergence is linear while elements soften.
- **Softening steeper than the elastic stiffness** (a band wider than the characteristic length E G / f_t², e.g. a ceramic on centimetre elements) would snap back: the table is stretched until it is half as steep as the elastic stiffness of the return, and the law reports how much more than G it then dissipates (`compressionEnergyFactor`, `tensionEnergyFactor`).
- **Erosion and outputs.** Crushed elements (k = 0) and elements whose crack opening reaches `erosionOpening` erode; `erode(elements)` removes elements on request. The preconditioner's stiffness diagonal is rebuilt from the live elements after erosion. `damage()` (strength lost, 0 to 1), `crackOpening()`, `compressiveStrengthLeft(e)`, `setStrengthFactors()` (per-element strength scale, for a scatter or a weak zone), `equivalentPlasticStrain()` (kappa_c), `plasticWork` (all dissipation). Everything is in `saveState()` (the return-mapping scratch object is skipped).
- **Starting guess.** A softening solid follows the branch its starting guess points to. Static load steps from the previous state put the whole increment into the loaded layer; extrapolate the guess from the last two states (as `validation/domains/concrete.mjs` does), or use `SolidContact` with `predictor: 'velocity'`.

### Concrete validation

`tests/engine/solid-concrete.test.mjs` (7 tests, about 8 s, in `npm run test:solid`; 13 rows `solid.concrete.*` and one Studio row in [`VALIDATION.md`](VALIDATION.md)), C30/37 from the library:

| Check | Reference | Measured | Tolerance |
|---|---|---|---|
| One cell, h = L_c = 0.118 m: peak, strain at the peak | f_cm 38 MPa, eps_c1 2.2 ‰ (EN 1992-1-1 Table 3.1) | 37.92 MPa, 2.20 ‰ | 0.5 %, 2 % |
| Largest difference from (3.14) up to eps_cu1 | 0 | 2.3 % of f_cm (near 0.4 f_cm) | 3 % of f_cm |
| Stress at eps_cu1 | 24.65 MPa | 24.69 MPa | 2 % |
| Bar in tension, weak middle cell: peak; energy to separate on 5, 10, 20 cells | 0.98 f_ctm; 0.98 G_f A, G_f = 73 f_cm^0.18 N/m | 2.82 MPa; 0.9999 of G_f A on each mesh | 2 %; 1 % |
| One crushed cell, h = 120, 60, 30 mm: post-peak plastic work per area | G_c = 9.5 kJ/m² | within 2 % | 2 % |
| Lateral pressure 0.05, 0.2 f_cm, then axial | f_cm + m sigma_3, m = 1.41 | within 0.5 % | 0.5 % (EN 1992-1-1 3.1.9 gives a larger gain) |
| Stress against energy, every regime; inputs; bit-exact resume after cracking and crushing | — | pass | — |

**Limits.** Compressive softening is not mesh objective in a prism: the band's plastic flow expands it sideways, its neighbours restrain it, and the softening spreads (26, 54 and 119 J against 13.7 J after the peak for 5, 10 and 20 cells, also with beta = 0); only the tensile crack band localises cleanly. The confinement gain is that of the Drucker-Prager cone (m = 1.41 at the default beta), lower than EN 1992-1-1 3.1.9; raising beta raises the associated dilatancy too. Plasticity, not damage: cracks unload elastically and do not close. No rate, creep, shrinkage, reinforcement or anisotropy; one law per body.

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

The conjugate-gradient iteration count rises with it (125 at 0.3, about 2,500 at 0.4999). Uniform states, including hydrostatic ones, stay exact at any `nu`. Rubber at `nu = 0.45` is about 5 percentage points stiffer in bending than `nu = 0` on that mesh; `nu` above 0.49 needs `element: 'tet4-nodal'` (section Averaged nodal pressure element: tip error -17.8 % at 0.49 and -23.0 % at 0.4999 on the same mesh) or a finer mesh. `nu` is limited to 0.4999.

**Not modelled.** Contact between two solids and self-contact (contact with rigid bodies is in [`SOLID_CONTACT.md`](SOLID_CONTACT.md), node against body, backward Euler only); plasticity beyond what the Plasticity section lists (and plasticity combined with viscoelasticity); viscoelasticity with a rotation-objective finite-strain split (the Prony model above is stress-based); crack propagation in `SolidBody` itself (beyond the concrete law's smeared cracks; its strength checks only flag elements; [`SOLID_FRACTURE.md`](SOLID_FRACTURE.md) describes the fracture solver built on the linear model); follower pressure; anisotropy; more than one material per body; higher-order or mixed elements (`tet4-nodal` averages the volumetric strain at the nodes; the concrete law keeps tet4); two-way coupling to the water, cable or frame solvers (the rigid world is coupled through `SolidCoupling`; the one-way links of [`SIMULATION.md`](SIMULATION.md) remain); checkpoints.

**Other limits.** Up to 200,000 nodes and 1,000,000 elements. The explicit stability limit is that of the reference shape. The midpoint rule conserves energy exactly only for the linear model. Backward Euler damps high modes strongly at large time steps. The stress of a rotated element is accurate to about 1e-16 `E` in absolute terms, so the relative precision of very small strains under large rotation is limited. JavaScript on one thread: the 10,000-unknown cantilever solves in about half a second with `cg`. The Studio's measured speed-ups from `ldl` are in [`STUDIO_METAL_PRESS.md`](STUDIO_METAL_PRESS.md) and [`STUDIO_MATERIAL_LABS.md`](STUDIO_MATERIAL_LABS.md).

## Reproduce

```sh
npm run test:solid
node --test --test-reporter=tap tests/engine/solid.test.mjs   # prints the measured numbers
npm run typecheck
```
