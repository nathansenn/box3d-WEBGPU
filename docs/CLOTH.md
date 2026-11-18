# Calibrated cloth

`Cloth` (`src/engine/cloth.ts`, kit subpath `box3d-webgpu-kit/cloth`, solver id `cloth-stvk-koiter-newton-pcg-js-f64-v1`) is a triangle-mesh membrane and plate in SI units. You give it an areal density, Young's modulus, a thickness and Poisson's ratio; it integrates implicitly to a force tolerance, collides with rigid bodies and with itself, and `ClothCoupling` (backend id `rigid-cloth-coupling-monolithic-js-f64-v1`) couples it both ways to the rigid world. Every number below was measured by `packages/box3d-kit/test/v16-cloth.test.mjs`, which runs in the pull-request gate; the headline rows are also in [`VALIDATION.md`](VALIDATION.md).

It is a second cloth model, beside the one the app draws. The app's cloth and rope (`src/soft/`, [`SOFT_BODY_AND_WATER.md`](SOFT_BODY_AND_WATER.md)) are position-based with authored coefficients, built for looks and speed. This one is built to give the right number, and it is slower: see [Cost](#cost).

## Contents

- [The model](#the-model)
- [Time integration](#time-integration)
- [Supports and loads](#supports-and-loads)
- [Contact with rigid bodies](#contact-with-rigid-bodies)
- [Two-way coupling](#two-way-coupling)
- [Self-collision](#self-collision)
- [In the stepping loop](#in-the-stepping-loop)
- [Woven fabric, cables and tearing](#woven-fabric-cables-and-tearing)
- [Validation](#validation)
- [Cost](#cost)
- [Limits](#limits)

## The model

Nodes carry lumped masses: a third of `rho_A A` from every triangle that touches them, plus any `extraMass`. State is float64.

### Membrane

Each triangle is a constant-strain element. With `F` the 3 × 2 deformation gradient from the rest triangle to the present one and `E = (FᵀF − 1) / 2` the Green strain, the energy per rest area is the plane-stress St. Venant–Kirchhoff one,

```
W = (1/2) S : E,    S = Y / (1 − ν²) [ (1 − ν) E + ν tr(E) 1 ],    Y = E_young t   (N/m)
```

`S` is the second Piola–Kirchhoff stress resultant. For small strains this is Hooke's law in plane stress; at a strain `e` it differs from it by about `1.5 e`, and the tests that need better use the exact law. `restPositions` may differ from `positions`: a sheet that starts stretched starts pre-tensioned.

`membrane: 'spring'` replaces this by one spring per edge, `k = Y ΣA / L²` (Van Gelder's calibration, `ΣA` the area of the triangles on the edge). It exists for comparison only. **Springs cannot be given a Poisson's ratio.** On an equilateral mesh they behave as `ν = 1/3` whatever the material; on the right-triangle meshes used here they give `ν = 0.0005` with one diagonal direction and `ν = 0.29` with alternating ones, and the alternating mesh is 22 % too stiff. The membrane gives `ν = 0.3002` when asked for 0.3 (the 0.0002 is the law at a strain of 10⁻³) on both meshes and on an irregular one.

### Bending

`D = E t³ / (12 (1 − ν²))` unless `bendingStiffness` states it. (A woven fabric bends far more easily than a plate of its thickness: measure `D` and set it.)

The energy is the Koiter plate energy on a curvature that is constant per triangle:

```
W_T = A_T (D/2) [ ν tr(Λ)² + (1 − ν) tr(Λ²) ],    Λ = Σ_e (θ_e − θ0_e) |e| / (2 A_T)  t_e ⊗ t_e
```

The sum runs over the triangle's interior edges, `θ_e` is the dihedral angle across the edge, `θ0_e` its value in the rest shape and `t_e` the in-plane unit normal of the edge. `Λ` is the *triangle-averaged* (hinge-averaged) shape operator: the mean, over the triangle, of the curvature that a folded mesh concentrates on its edges. It is a quadratic form in the angles of neighbouring hinges, so unlike a sum of independent hinge springs it has a Poisson's ratio and separates bending from twist.

Known mesh sensitivity, stated plainly:

- On structured meshes (every cell cut the same way, or in a union-jack pattern) `Λ` reproduces any constant curvature exactly and the cantilever below converges at second order.
- On irregular meshes it is **not consistent** (Grinspun, Gingold, Reisman and Zorin, 2006): the error does not go to zero under refinement. Measured: nodes jittered by 10 % of a cell, −0.40 %; by 25 %, −2.9 %, −4.4 % and −11 % at 8, 16 and 32 elements. Use structured meshes when bending matters. The membrane does not have this limit.

`bending: 'hinge'` is the plain hinge energy, `Σ (4/9) D |e|² / (A₀ + A₁) (θ − θ0)²`, calibrated to be right on an equilateral mesh. It fixes `ν = 1/3` and depends on the mesh: the cantilever on a right-triangle mesh comes out 37 % too soft. It is there for comparison.

**Clamped edges.** A triangle whose three nodes are in `pinned` when the cloth is built is a wall: it stores no bending energy, and the angle of an edge between it and a free triangle counts twice in the free one, as if the wall were that triangle's mirror image. Without this rule a clamp is too soft by half a cell (a first-order error of `2/n`; 25 % at 8 elements). Pinning or releasing nodes later does not change which triangles are walls.

### Damping

`drag` is mass-proportional (1/s) and may be changed between steps. There is no stiffness-proportional (material) damping. The default integrator adds numerical damping of its own, quantified below.

## Time integration

A step is a minimisation. Backward Euler for `M (v⁺ − v) / h = f(x⁺)`, `x⁺ = x + h v⁺` is the stationary point of

```
Φ(y) = Σ m_i |y_i − (x_i + h v_i)|² / (2 h²) + drag term + U_membrane(y) + U_bending(y) + U_contact(y) − f_ext · y
```

and the cloth takes `x⁺ = argmin Φ`. It is found by Newton's method:

- **Hessian.** Positive definite by construction. The membrane uses its exact second derivative with the compressive part of the stress removed from the geometric term (in tension nothing is removed); bending uses the Gauss–Newton part, `Jᵀ B J` with `J` the angle gradients; contacts are one-sided springs.
- **Linear solve.** Matrix-free conjugate gradients with 3 × 3 block-Jacobi preconditioning (two 3 × 3 blocks per coupled body), to a relative residual of `cgTolerance` (default 10⁻²: an inexact Newton step).
- **Line search.** Backtracking on `Φ` itself, so every accepted iterate lowers the step energy.
- **Stopping.** The largest residual force on a degree of freedom must fall below `residualTolerance` (default 10⁻⁶) times the largest load, inertia force or internal force on a node, plus `forceTolerance`, plus the rounding floor `3.6·10⁻¹⁵ Y |x| / (1 − ν²)`. A step that reaches `maxNewtonIterations` (default 60) first is counted in `stats.unconvergedSteps`.

Stiffness is therefore a property of the material and the mesh, never of an iteration count: more iterations only bring the residual down. A step at rest takes one or two Newton iterations; an impact with many contacts opening and closing can take tens.

`integrator: 'midpoint'` is the implicit midpoint rule (a backward-Euler half step, then a reflection through it). It has no numerical damping and conserves the energy of a linear system; it has no contact, bodies or self-collision.

`solveStatic()` finds the equilibrium of the present loads, supports and contacts by proximal Newton steps: each minimises the potential energy plus `m |x − x_k|² / (2 s²)` with a pseudo step `s` (default 1000 s), which keeps the problem well posed where the cloth has no stiffness (a slack direction, a body free to move). Dynamic bodies take part with their weight.

Everything is deterministic (fixed loop orders, no randomness, no time-dependent branches), and `step()` allocates nothing: all vectors are made in the constructor or in `addBody()`.

**Energy.** Backward Euler multiplies the energy of a mode of angular frequency `ω` by `1 / (1 + (ω h)²)` per step, a decay rate of `ω² h` per second, and never adds energy. Measured on the first mode of a tensioned strip (`ω = 57.4 rad/s`): 0.19298 of the energy is left after 0.5 s at `h = 1/1000 s` against a factor of 0.19298, and 0.43885 at `1/2000 s` against 0.43885; the ratio of the two decay rates is 0.500. The midpoint rule on the same mode drifts by 8·10⁻⁹ of the mode's energy in 250 steps.

## Supports and loads

| | |
|---|---|
| `pinned`, `pin(node, position?)`, `release(node)` | A held node. Given a new position it moves there over the next step and stays. `reactions` holds the force each support gave in the last step. |
| gravity | A potential, `−Σ m g·x`: statics are exact. |
| `setNodalForce(node, f)` | A dead load. |
| `setPressure(p)` | Each triangle is pushed along its normal by `p A`; it follows the surface. Evaluated at every Newton iterate, so the equilibrium is that of the deformed shape. |
| `setWind({velocity, airDensity, coefficient})` | **A normal-pressure formula, not aerodynamics**: each triangle feels `(1/2) ρ C (u·n) |u·n| A` along its normal, `u` the wind relative to the triangle, evaluated at the start of the step. No shielding, no lift, no vortices. |

## Contact with rigid bodies

Supported shapes: **box, sphere, capsule** (by their exact signed distance) and the **plane** (static or kinematic only). **Convex hulls, triangle meshes and height fields are not supported**; `addBody` refuses them. The world cannot report a body's shape, so you state it when you couple the body.

Contact is node against body. For every node and body the cloth holds at most one contact plane per step, in the body's own frame:

1. **At the start of a step**, a node closer than `offset + skin` to a body gets the tangent plane at its nearest surface point. `offset` (default half the thickness) is the distance kept between the cloth's mid-surface and the body.
2. **During the solve**, at every Newton iterate, a node without a plane is traced along its straight path *relative to the body* from the start of the step to the iterate, by sphere tracing: the signed distance is 1-Lipschitz, so stepping by it cannot jump over the surface. If the path enters the body, the node gets the plane where it enters. Planes are only added during a step, so the function being minimised only gains terms.

A plane is a one-sided spring of stiffness `contact.stiffness` per node (default `10 Y + 100 m / h²`). The force a resting contact carries is exact whatever the stiffness; the stiffness sets the depth, `force / stiffness` (1.5 µm under the draped cloth below).

**Friction** is Coulomb's law as a stick spring: a tangential spring of the contact stiffness between the node and an anchor point on the body, whose force is capped at `μ N`. Below the cap the node sticks (it holds for ever, with no creep; it moves by `force / stiffness`, 38 nm on the ramp below). At the cap it slides, and the anchor is dragged along at the end of the step. `N` is the normal force of the same solve: it is updated from Newton iterate to iterate while that settles, and held for the rest of the step when it does not (after the eighth iterate, if the change no longer halves), because the limit of a contact about to slip can otherwise flip between two states for ever. At steady contact the limit is `μ N` of the solution; in a transient it can lag by an iterate.

What is and is not prevented:

- A node cannot cross a flat face however fast the body or the node moves: a 2 mm kinematic plate was swept through a free cloth at 2, 20 and 200 m/s (4, 42 and 417 plate thicknesses per step at 240 Hz) and left no node behind. The penalty depth grows with speed (0.66 mm into the leading face at 200 m/s; inside the contact offset at 20 m/s).
- A curved body is seen through one tangent plane per node and step. That is safe while the body moves less than about its own radius per step relative to the cloth: a 5 cm sphere at 10 m/s (0.83 radii per step) pushed nodes 0.73 mm in and they came back. Above it nodes are left inside: one of 121, 2.3 mm deep, at 20 m/s (1.7 radii per step); five, 8.7 mm deep, at 50 m/s (4.2 radii per step). The next step pushes them out again.
- **Only nodes are tested.** A body corner or edge that passes between nodes is not seen, and a body smaller than the mesh spacing rests on single nodes, like a ball on a pin: the mesh must be finer than the bodies.
- A cloth held so that it would have to tear to let a body pass is pushed through at `force / stiffness`; nothing breaks.

## Two-way coupling

`ClothCoupling` reads the bodies, advances the cloth and gives each dynamic body the force and torque the cloth put on it, to act through the next `world.step()`:

```js
coupling.step();   // immediately before
world.step();
```

What the cloth feels and what the bodies get are the same numbers with opposite signs.

### The bodies are unknowns of the cloth's solve

Solving the cloth against bodies that move as if it were not there, and handing them its force afterwards, is unstable as soon as the cloth is stiff against a body's inertia. Instead each coupled dynamic body adds six unknowns, a displacement `c` and a rotation vector `θ` of the step, to `Φ`, with the inertia the rigid step will give it:

```
Φ_body = [ m |c − c_free|² + (θ − θ_free)ᵀ I (θ − θ_free) ] / (2 α h²),    α = (n + 1) / (2 n)
```

The rigid solver takes `n` substeps of symplectic Euler, which moves a body by `h v + α h² a` under a constant acceleration (measured: a force of `m·3 m/s²` moves a ball by 3.2552·10⁻⁵ m in one step at 240 Hz with 4 substeps; `α h² a` is 3.2552·10⁻⁵ m). `c_free` and `θ_free` are that motion without the cloth. Contact planes and attached nodes then depend on `c` and `θ`, so the Newton iteration finds the cloth and the bodies together: this is the effective-mass idea of [`STRUCTURE_COUPLING.md`](STRUCTURE_COUPLING.md) taken to its end, with the body's own mass matrix in the system instead of a per-attachment proxy, and it is exact for any number of contacts and attachments on one body. The force and torque of the converged state go to the world as `applyForce` and `applyTorque`.

**Attachments.** `coupling.attach(node, body, localPoint?)` fixes a node to a point of a body. The node is not an unknown: it rides on the body, `x = c + exp([θ]×) r` (the exact rotation), with its own mass and weight, and everything the cloth does to it becomes force and moment on the body. A static or kinematic body makes it a moving support (a flag on a pole).

**What the cloth cannot see.** A body's other contacts and joints are in the rigid world, not in `Φ`. The coupling estimates them from how the body actually moved in the last rigid step (`m Δv / h` less gravity less what the cloth applied) and adds that force to the body's free motion. It lags by one step. Without it (`estimateSupports: false`) a cloth still weighs the right amount on a supported body, but it expects the body to fall and rests `α g h²` = 0.114 mm inside it; with it, 1.5 µm (the contact depth).

**Naive staggering, for comparison.** `scheme: 'naive-staggered'` solves the cloth against each body's free motion and hands it the force. A 40 g box released on a strip of stiffness `k = E t w / L`; the right answer swings at no more than `g / ω`:

| `k h² / m` | implicit: fastest speed in 1 s | naive: fastest speed in 1 s |
|---:|---:|---:|
| 0.05 | 0.216 m/s | 0.210 m/s |
| 0.25 | 0.086 m/s | 9.3 m/s (wrong) |
| 3 | 0.020 m/s | blew up |
| 868 | 1.1·10⁻⁴ m/s | blew up |
| 10⁴ | 9.8·10⁻⁶ m/s | blew up |

"Blew up" means a speed above 100 m/s or a force beyond float32, which the world refuses. The implicit coupling stays inside the physical bound at every ratio tried; at 868 the strip also carries box and strip at rest, with the reaction right to 2.5·10⁻⁷.

### Limits of the coupling

- The support estimate lags a step. The loop "cloth force changes → the body does not move as predicted → next step corrects" should contract while the cloth resting on a supported body is lighter than about `m_body / α` (an estimate from the scheme, not a measurement). The checked case is a 0.81 kg cloth on a 14.4 kg box; a cloth heavier than the supported body it lies on is not checked.
- Bodies rotate by a linearised rotation in the *contact* geometry: a contact point is off by `(ω h)² / 2` times its distance from the centre of mass per step (1.4·10⁻⁴ m for a point 4 cm out on a body spinning at 20 rad/s, at 240 Hz), and the next step starts from the true pose. Attachments use the exact rotation.
- Gyroscopic terms, the body's own damping and its sleep state are not in the cloth's picture of the body. Keep coupled bodies awake (`neverSleeps`).
- Engine quirk found on the way: a body created with `lockRotation` does not feel a prismatic joint's spring. The scale test leaves the box free to rotate for that reason.

## Self-collision

`selfCollision: {thickness}` turns on repulsion between parts of the cloth that do not share a node. At the first Newton iterate of a step, and again whenever a node has moved a tenth of the thickness since the last search, a spatial hash of the nodes finds

- node–triangle pairs (the nearest point of the triangle, wherever it lies), and
- edge–edge pairs whose nearest points are inside both edges,

that are closer than 1.4 thicknesses or have changed sides since the start of the step. A pair is four nodes with fixed weights and a fixed direction `n` for the step, and adds a one-sided spring `(1/2) k (thickness − n·Δ)²` when its gap is below the thickness. The direction keeps the side the pair was on at the start of the step: a pair that the iteration has pushed through is pushed back, not on.

What is guaranteed, and what is not:

- The gap of a listed pair stays above `thickness − force / stiffness`. Measured: three sheets stacked on a plane rest 0.9999 thicknesses apart and the plane carries their weight to 4·10⁻¹¹; a folded strip pressed by a box at 0.02 N per pair keeps 0.999 thicknesses between its layers through the drop and at rest (asserted: 0.95), where without self-collision the same layers end 2·10⁻¹¹ thicknesses apart.
- **It is not intersection-free.** A pair pressed harder than `stiffness × thickness` crosses. A pair that closes by more than the search distance (the thickness plus the room nodes moved in the step, at most one mesh edge) within one iterate is not found. Once two layers have crossed, the next step takes the crossed state for the right side: nothing untangles it.
- There is no friction between layers.
- The thickness must be less than half the smallest triangle height (the constructor checks), or neighbouring nodes would repel in the rest shape.
- `selfCollision.capacity` (default 24 pairs per node) bounds the list; `stats.droppedPairs` counts what did not fit.

## In the stepping loop

`clothSubsystem(target)` adapts a cloth to the `Simulation` of [`SIMULATION.md`](SIMULATION.md):

| Target | Stage | Order | Time-step rule |
|---|---|---|---|
| a `ClothCoupling` | `couple` | 150: after the structure coupling (100), before the water (200) | `equal`: it exchanges forces with the rigid step and cannot be sub-cycled |
| a bare `Cloth` | `post` | 400 | `commensurate`: the step, a whole fraction of it or a whole multiple |

- **Energy.** Kinetic, membrane, bending, gravitational and contact-spring energy of the cloth; `exchanged` is the work done on it by point forces, pressure, wind, moving supports and bodies. `total − exchanged` only falls (numerical damping, drag, friction): measured largest rise in a 150-step run with an impact, friction, an attachment and self-collision, 0 J. The bodies are not counted: track them with `simulation.trackBody`.
- **Events**, in the events stage: `contact-begin` and `contact-end` with `{body, index}` when a body starts or stops pressing on the cloth, and `unconverged` with `{residual, tolerance}` when a step stopped at its iteration limit. Tearing (below) has no event here; read `tornCount` after a step.
- A run through the Simulation is bit-identical to `coupling.step(); world.step()`.

## Woven fabric, cables and tearing

Three options make the cloth a tensile-structure model. Tests: `tests/engine/cloth-fabric.test.mjs` (7 tests, about 10 s, in `npm run test:engine`; 7 rows in [`VALIDATION.md`](VALIDATION.md)).

- **Orthotropic membrane** (`material.orthotropic: {warp, weft, shear, poissonRatio, warpDirection}`, N/m): plane-stress Hooke's law in the yarn axes, `S1 = Q11 E1 + Q12 E2`, `S2 = Q12 E1 + Q22 E2`, `S12 = G12 2 E12`, `Q11 = E1 / (1 - nu12 nu21)`, `Q22 = E2 / (1 - nu12 nu21)`, `Q12 = nu12 E2 / (1 - nu12 nu21)`, `nu21 = nu12 E2 / E1`, on the Green strain. The warp direction is projected into each triangle's rest plane and the stiffness turned into its rest axes once, at construction (the usual Q-bar formulas), so the energy, gradient and Newton tangent are the isotropic ones with a 3 x 3 stiffness per triangle. The preconditioner uses an isotropic block of the mean stiffness. `materials.ts` `fabricMaterial(id, {warpDirection})` fills it from the library (docs/MATERIALS.md).
- **Cables** (`cables: [{nodes, axialStiffness, restLengthFactor}]`): chains of tension-only bars, energy `(EA / 2 L0) <l - L0>^2`, in the same Newton solve; `restLengthFactor` below 1 pretensions them. `cableTensions()` reports them, N.
- **Tearing** (`material.strength: {warp, weft}`, N/m): after each converged step, a triangle whose second Piola-Kirchhoff stress resultant along the warp or the weft (isotropic: the largest principal value) has reached its strength is torn: it loses its membrane and bending stiffness, its pressure and wind; its nodes keep their mass. `tornCount`, `tornMask`, `yarnStress(t)`, `setStrength()`. A torn triangle stays torn and is saved by `saveState()`.

| Check | Expected | Measured | Tolerance and why |
|---|---|---|---|
| Strip 1 m x 0.2 m pulled at 1 kN/m along the warp (1225 kN/m), the weft (1000 kN/m), at 45° (shear 30 kN/m, nu 0.35) | strain `T / E_dir`, `1 / E_45 = (1/E1 + 1/E2 + 1/G - 2 nu12 / E1) / 4` | warp 8.149e-4 against 8.163e-4 (-0.18%), weft 9.981e-4 against 1.000e-3 (-0.19%), bias 8.511e-3 against 8.645e-3 (-1.5%) | 0.2%: Green against engineering strain; bias 2%: the clamped end restrains the shear-extension coupling |
| Long strip (span 1 m, 6 m long) pinned on its edges, 2 kPa, weft across the span | circular arc, `T = p R = Q22 eps` (plane strain), arc length `S (1 + eps)` | mid-span rise 43.773 mm against 43.996 mm (-0.5%) | 1% |
| Square membrane 2 m, 0.2% isotropic prestrain (600 kN/m, nu 0.3), 50 Pa | Fourier series of `T (w_xx + w_yy) = -q` | centre 8.400 mm against 8.569 mm (-2.0%); reactions equal the load to 1e-9 | 3%: load on interior nodes only, slight stiffening |
| Cable with `restLengthFactor` 0.99 between held ends; one with 1.01 | tension `EA (1 / 0.99 - 1)`; zero | to 2e-3; 0 | |
| Strip 0.2 m wide with strength 120 kN/m, load ramped in 0.6% steps | first tear at the strength | 126.8 kN/m (1.057) | 0.99 to 1.12: the criterion reads the second Piola-Kirchhoff resultant at 10% strain, the load is nominal |
| Same strip with a slit of half its width | below the net section (60 kN/m); edge-crack estimate `K = sigma sqrt(pi a) 2.82` (Tada) with the tip triangle averaging `K / sqrt(2 pi r)` over its size `h`: 10.6 kN/m | 13.5 kN/m (1.27 times the estimate) | 0.7 to 1.5: an order-of-magnitude estimate; the onset falls as `sqrt(h)` with refinement (mesh-dependent) |
| A torn orthotropic cloth with cables, checkpoint mid-tear | resumes bit for bit | same bytes | exact |

## Validation

`packages/box3d-kit/test/v16-cloth.test.mjs`, 21 tests, with the set-ups in `test/cloth-scenarios.mjs`. Errors are relative unless a unit is given. "Order" is `log2` of the error ratio when the mesh is halved.

| Check | Expected | Measured | Tolerance | Convergence |
|---|---|---|---|---|
| Patch test, 49 nodes jittered by 30 % | `x = F X` | 8.8·10⁻¹⁵ m | 10⁻¹² m | exact on any mesh |
| Uniaxial strip, `σ / ε` | `E` | +0.150 % (the law's `1.5 ε`) | 0.2 % | uniform state |
| Uniaxial strip, contraction | `ν = 0.3` | 0.30019 | ±0.001 | uniform state |
| Same against the exact law | `λ Y (λ² − 1) / 2 = T` | −3.6·10⁻¹², −2.3·10⁻¹¹ | 10⁻⁸ | |
| Edge springs on the same mesh | `ν = 0.3`, `E` | `ν` = 0.0005; alternating diagonals `ν` = 0.2945, `E` +21.6 % | must miss | does not converge to the material |
| Hanging strip, elongation | `ρ g L² / (2 E t)` | −0.050 % (the top strain, as the law predicts) | 2 × top strain | exact at the nodes |
| Hanging strip, reaction | weight | 2·10⁻¹² | 10⁻⁸ | |
| Hanging strip with `ν = 0.3` | same formula | −0.88 % (the clamp holds the width) | 1.5 % | |
| Catenary sag, stiff strip | inextensible catenary | +0.82 %, +0.20 %, +0.051 % at 8, 16, 32 | 1.2 %, 0.3 %, 0.08 % | order 2.01, 1.98 |
| Cantilever tip, regular mesh, `ν = 0` | `w L⁴ / (8 D)` | +1.54 %, +0.37 %, +0.080 % at 8, 16, 32 | 2 %, 0.5 %, 0.12 % | order 2.05, 2.22 |
| Cantilever, alternating diagonals | same | +0.37 % at 16 | 0.5 % | |
| Cantilever, irregular mesh | same | −0.40 % (10 % jitter), −4.4 % (25 % jitter) at 16; −11 % at 32 | 1 %, 6 % (bounds on the measurement) | **does not converge** |
| Cantilever, plain hinge energy | same | +37 % | must exceed 30 % | mesh dependent |
| Cantilever, `ν = 0.3`, narrow strip | between plate `D` and beam `E t³/12` | 5.0 % above the plate value, 4.4 % below the beam value | inside the bracket | no closed form |
| Tensioned strip, first frequency | `(1 / 2L) √(T / ρ)` | −0.65 %, −0.17 %, −0.047 % at 8, 16, 32 | 0.8 %, 0.2 %, 0.06 % | order 1.95, 1.83 |
| Same against the lumped string | `f sin(π/2n) / (π/2n)` | −6.7·10⁻⁵ (the time step, `(ω h)² / 12`) | 10⁻⁴ | |
| Pressurised square membrane, centre | `0.07367 p a² / T` | −1.23 %, −0.33 %, −0.098 % at 8, 16, 32 | 1.6 %, 0.45 %, 0.14 % | order 1.91, 1.74 |
| Membrane, irregular mesh (25 % jitter) | same | −0.41 % at 16 | 0.6 % | as the regular mesh |
| Membrane, edge reaction | `p a²` | −1·10⁻⁸ | 10⁻⁷ | |
| Backward Euler, energy left | `(1 + (ω h)²)^−steps` | 0.19298 and 0.43885 against 0.19298 and 0.43885 | 0.2 % | decay ∝ `h`: ratio 0.500 |
| Midpoint, energy drift | 0 | 8·10⁻⁹ of the mode's energy | 10⁻⁶ | |
| Ramp, 30°, `μ = 0.3`: speed | `g (sin θ − μ cos θ) t` | −4.9·10⁻⁹ | 10⁻⁶ | |
| Ramp, 26°, `μ = 0.5` (`tan` = 0.488) | sticks | 0 m/s; moved 3.8·10⁻⁸ m | 10⁻⁹ m/s, 10⁻⁶ m | |
| Ramp, 27°, `μ = 0.5` (`tan` = 0.510) | `g (sin θ − μ cos θ) t` | −3.1·10⁻⁸ | 10⁻⁵ | |
| Plate at 2, 20, 200 m/s | no node behind | 0, 0, 0 nodes | 0 | |
| Trampoline, momentum | `Δp = Σ (R − W) h` | 1.5·10⁻⁶ of 10.4 N s | 10⁻⁵ (float32 ball) | |
| Trampoline at rest, reactions | `(m_ball + m_cloth) g` | +1.3·10⁻⁵ (ball still at 4·10⁻⁵ m/s) | 10⁻⁴ | |
| Trampoline at rest, ball height | static solve | −4.0·10⁻⁷ m of a 97 mm sag | 5·10⁻⁶ m | |
| Draped box on a spring scale | `m_cloth g` | +1.2·10⁻⁵ | 10⁻⁴ (float32 sag) | |
| Box hanging from a strip, stretch | `m g L / (E t w) + ρ g L² / (2 E t)` | −0.30 % (the law at `ε` = 2·10⁻³) | 2 `ε` | |
| Same against the exact law | element by element | −5.7·10⁻⁸ m | 2.5·10⁻⁷ m (float32) | |
| Light body on a stiff strip | bounded by `g / ω` | bounded at `k h²/m` = 0.05 … 10⁴; naive wrong from 0.25, overflows from 3 | 1.3 `g / ω` | |
| Three stacked sheets, support | weight | −4·10⁻¹¹ | 10⁻⁶ | |
| Three stacked sheets, spacing | 1 thickness | 0.99988, 0.99993 | ≥ 0.99 | |
| Fold pressed by a box, spacing | ≥ thickness − force / stiffness | 0.9990 (worst over the drop) | ≥ 0.95 | |
| Fold pressed by a box, support | `(m_box + m_cloth) g` | −3.7·10⁻⁶ | 10⁻⁴ | |
| Repeat runs | identical bits | identical, also through the Simulation | exact | |

The coefficient 0.07367 is the double Fourier series of `T ∇²w = −p` on a square with `w = 0` on the edge, `w₀ = (16 p a² / π⁴ T) Σ (−1)^((m+n)/2−1) / (m n (m² + n²))` over odd `m`, `n`; the test sums it and checks it against Timoshenko's 0.0737. The last halving of the membrane row gains less than four because the membrane also stiffens with its deflection, by 10⁻⁴ of the tension at `w₀ / a = 10⁻³`.

Two rows compare the solver with itself solved another way (the trampoline's static solve, the exact-law rows): they check the time stepping and the solve, not the model.

## Cost

One run on the development machine (4 cores shared with other jobs, Node 22, one thread; the times varied by up to 50 % between runs on the small meshes, the iteration counts not at all). A square cloth with `E t` = 5 kN/m, 0.3 kg/m², hanging from two corners, default tolerances:

| Nodes | Step | Time per step | Newton iterations | CG iterations | Real time? |
|---:|---:|---:|---:|---:|---|
| 81 | 1/240 s | 1.0 ms | 2.5 | 55 | yes (4.2 ms) |
| 81 | 1/60 s | 2.9 ms | 4.2 | 172 | yes (16.7 ms) |
| 289 | 1/240 s | 8.9 ms | 2.7 | 103 | no |
| 289 | 1/60 s | 30 ms | 5.8 | 379 | no |
| 1089 | 1/240 s | 68 ms | 4.1 | 230 | no |
| 1089 | 1/60 s | 229 ms | 8.6 | 849 | no |
| 289, `E t` = 500 N/m | 1/240 s | 3.1 ms | 2.3 | 37 | yes |
| 81, draped on a sphere with friction | 1/240 s | 3.3 ms | 4.5 | 88 | yes |
| 289, draped on a sphere with friction | 1/240 s | 23 ms | 6.6 | 238 | no |
| 289, the same with self-collision | 1/240 s | 37 ms | 9.4 | 381 | no |

So: **about 100 nodes in real time at realistic fabric stiffness, a few hundred for a soft sheet.** One conjugate-gradient iteration costs about 0.25 µs per node, and the iteration count per Newton step follows the membrane's Courant number, roughly `5 √(Y / ρ_A) h / Δx`: the price of stepping over the in-plane waves implicitly with a diagonal preconditioner. A stronger preconditioner (incomplete Cholesky, multigrid) or a GPU solve is the way to larger meshes; neither is here.

## Limits

Not modelled:

- **Plasticity and damage** before tearing; tear paths finer than the mesh (a tear follows triangle edges and its onset at a crack tip depends on the mesh, see [Woven fabric](#woven-fabric-cables-and-tearing)).
- **Nonlinear fabric response.** The orthotropic law is linear in the Green strain: no crimp interchange, shear locking of the weave or hysteresis; cables do not fail.
- **Large-strain accuracy.** St. Venant–Kirchhoff is validated to strains of 2·10⁻³ here. It softens in strong compression; the solver stays stable there (the Hessian is kept positive), the material law is not meaningful.
- **Bending on irregular meshes**, as measured above.
- **Material damping.** Only mass-proportional drag and the integrator's own damping.
- **Contact** with hulls, meshes and height fields; body features between nodes; rolling and spinning friction; friction between layers of the cloth.
- **Intersection-free self-collision**, as stated above.
- **Aerodynamics.** Wind and pressure are formulas for a normal force.
- **Checkpoints.** The cloth's state is its positions and velocities, but friction anchors and the coupling's estimates are not saved, and the cloth is not in the scene format.
- **Speed**, as measured above. The Studio's canopy study uses this model ([`STUDIO_CANOPY.md`](STUDIO_CANOPY.md)); the Lab's own cloth does not.
