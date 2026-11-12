# Fracture of solids

`solid-fracture-czm-js-f64-v1` adds fracture to the tetrahedral solid of [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md). A `FractureBody` is a small-strain solid of four-node tetrahedra that can break in two ways: by **cohesive interfaces** on element faces, with nodes duplicated where a face opens, or by a **crack band**, where elements soften. Both take a tensile strength `sigma_c` (Pa) and a fracture energy `G_c` (J/m²). Broken pieces are listed as fragments and can be handed to the rigid world.

Source: `src/engine/solid-fracture.ts`. Kit import: `box3d-webgpu-kit/fracture`. Validation: `tests/engine/solid-fracture.test.mjs`, run by `npm run test:fracture` in the required pull-request gate, with its headline numbers in [`VALIDATION.md`](VALIDATION.md).

**Read this first.** A cohesive crack can only follow element faces, so its path depends on the mesh. Where the crack should run along a mesh plane, the results below match closed-form fracture mechanics. Where it should not, the crack is a staircase with too much area ([Mesh dependence](#mesh-dependence)). This is the known limit of the method, not a bug to be fixed by refinement.

The Studio's concrete and impact studies do not use this solver yet; they run the normalized lattice of [`MATERIAL_FRACTURE.md`](MATERIAL_FRACTURE.md). The glass impact lab does not use it either: tetrahedra lock in the bending of a thin pane (measured in [`STUDIO_MATERIAL_LABS.md`](STUDIO_MATERIAL_LABS.md)), so it runs a Kirchhoff plate with brittle fracture (`src/engine/plate.ts`).

## The solid

The elements are those of `SolidBody` with `model: 'linear'`: Hooke's law on `sym(grad u)`, lumped mass, thermal eigenstrain `alpha_T dT`, dead loads. Without cracks a `FractureBody` reproduces `SolidBody` to 2e-14 of the largest displacement in statics and dynamics (asserted). The corotational and Neo-Hookean models are not available here: brittle fracture happens at small strain, and a piece that rotates far after breaking off should be handed to the rigid world.

## Cohesive interfaces

**The law.** An interface joins the two sides of a face at its three node pairs (nodal quadrature, a third of the face area each). With the opening `delta = u_plus - u_minus`, normal part `delta_n` and sliding part `delta_s`, the effective opening is

```
delta = sqrt(<delta_n>^2 + beta^2 |delta_s|^2)        <x> = max(x, 0), beta = shearWeight (default 1)
```

and the effective traction follows a bilinear curve:

```
T(delta) = sigma_c delta / delta_0                               delta <= delta_0           (rising branch)
T(delta) = sigma_c (delta_c - delta) / (delta_c - delta_0)       delta_0 < delta < delta_c  (linear softening)
T(delta) = 0                                                     delta >= delta_c
delta_c = 2 G_c / sigma_c        delta_0 = initialOpeningRatio * delta_c   (default 0.02)
```

The area under the curve is `sigma_c delta_c / 2 = G_c` exactly, whatever `delta_0` is. The tractions are `T_n = (T / delta) <delta_n>` and `T_s = (T / delta) beta^2 delta_s`, so the shear strength is `beta sigma_c`, sliding fails at `delta_c / beta`, and the mode II fracture energy is also `G_c`.

**Irreversibility.** Each node pair remembers the largest effective opening it has seen, `kappa`. Below `kappa` the pair is a linear spring on the secant `T(kappa) / kappa` through the origin, so unloading returns to zero opening with zero traction and reloading follows the same line. `kappa` never decreases. There is no healing. The damage reported is `d = 1 - T(kappa) delta_0 / (sigma_c kappa)`.

**Contact.** A closing interface (`delta_n < 0`) is held by a penalty with the undamaged stiffness `sigma_c / delta_0`, whatever the damage, so the two sides overlap by the contact stress over that stiffness. Sliding under compression uses the damaged shear spring; there is no friction.

**Energy.** The dissipated energy is a function of the state: `w (sigma_c kappa - T(kappa) delta_0) / 2` per node pair of weight `w`, which is zero at `delta_0` and `G_c w` at `delta_c`.

### Where interfaces appear

- `insertion: 'on-demand'` (default). After each static solve and each time step, the traction on every interior face is read from the mean stress of its two elements, `t = sigma n`, and an undamaged interface is inserted where `sqrt(<t_n>^2 + |t_s|^2 / beta^2) >= threshold * sigma_c`. The threshold is `insertionThreshold` (1 by default), except on a face that touches a **crack front**, where it is `tipInsertionThreshold` (0.4 by default). A face touches a crack front when it shares a node with a face that is cut, open, or has started to soften. Faces are taken in index order. A static solve repeats "solve, insert" until no face qualifies.
- `insertCohesive(faces)` puts interfaces on chosen faces before loading (a known crack path, a weak plane).
- `precrack(faces)` cuts the body along faces: an interface with no cohesion from the start, which dissipates nothing and still cannot be pushed through itself. A notch or an initial crack.
- `setInterfaceProperties(faces, {strength, toughness})` gives chosen faces their own values.

A new interface is undamaged and has no opening, so in dynamics the forces do not jump when it appears. It does add its compliance. In a static solve the body relaxes onto it at once, and the energy that lets go, `T_before T_after / (2 K)` per unit area with `K = sigma_c / delta_0`, is booked as `relaxation`: `initialOpeningRatio * G_c` for a face inserted at its strength, 2 % by default.

**Why two thresholds.** The mean stress of two linear elements under-reads the stress peak at a crack tip. With insertion at the strength everywhere, the centre-cracked plate below never gets an interface ahead of its tip: with cells of `l_ch / 2` it held 1.59 times its Griffith stress, with cells of `l_ch` more than 1.8 times. Away from a crack front the stress has no singularity and the same reading is exact (the bar, the thermal shock).

Measured on that plate (failure stress over LEFM, load steps of 1 %, loaded from 0.5; the pre-inserted crack path fails at 0.965 on cells of `l_ch / 2` and at 1.115 on cells of `l_ch`):

| Threshold | Crack-front rule, `l_ch / 2` | Crack-front rule, `l_ch` | One threshold for every face, `l_ch / 2` | One threshold for every face, `l_ch` |
|---|---|---|---|---|
| 1 | 1.595 | above 1.8 | 1.595 | above 1.8 |
| 0.7 | 1.205 | 1.615 | 1.165 | 1.605 |
| 0.6 | 1.045 | 1.385 | 1.005 | 1.375 |
| 0.5 | 1.005 | 1.175 | 0.975 | 1.145 |
| **0.4** | **0.965** | **1.125** | 0.965 | 1.125 |
| 0.3 | 1.015 | 1.135 | 0.965 | 1.115 |
| 0.25 | 1.015 | 1.135 | 0.955 | 1.115 |

At 0.4 both rules give the failure load of the pre-inserted path within one load step on both meshes (0 and +0.9 %), and 0.4 is the default of the crack-front rule. Below it the crack-front rule inserts faces beside the path and the plate reads up to 5 % strong again.

**Why not one lower threshold for every face.** It has the same failure load, but it puts an interface on every face of any region stressed above the threshold, and each interface adds its compliance. Measured on a bar of uniform strength pulled to 0.9 of its strength: with one threshold of 0.4 the bar carries 68 % of its elastic stress on 8 cells (56 interfaces, 81 nodes become 144) and 50 % on 16 cells (480 interfaces, 425 nodes become 800); the loss grows as the cells shrink, and the bar test's peak, sampled where the elastic bar has it, reads 2.1 % low. With the crack-front rule the same bar has no interface and its stress is the elastic one to 4·10⁻¹⁵. On the plate, one threshold of 0.25 costs 1933 nodes and 14 s against 1256 nodes and 5 s for the crack-front rule at 0.4.

**What the crack-front rule costs.** On the Griffith plate, 847 nodes against 836 for the pre-inserted path on cells of `l_ch`, and 1266 against 1248 on cells of `l_ch / 2`; the eight increments take 1.6 s against under 1 s. Results without a crack front are unchanged bit for bit: the bar's peak, softening curve and `G_c A`, the energy balances, the notched beam (its path is pre-inserted), free flight and the thermal shock up to its first crack print the same digits as before the rule. What did change is the strip with a crack inclined to the mesh ([Mesh dependence](#mesh-dependence)), where faces next to a softening face now get their interface early.

`tipInsertionThreshold: 1` turns the rule off. A threshold given as `insertionThreshold` below the crack-front value is used everywhere.

### Splitting nodes

When faces get an interface, each of their nodes is examined once, in ascending node order:

1. Take the elements that use the node. Two of them are joined when they share a face that contains the node and has no interface.
2. Find the connected groups of that relation. One group: nothing happens (the node is at a crack front or on a closed interface edge).
3. Otherwise the group that holds the lowest-numbered element keeps the node. Every other group, in the order of its lowest element, gets a new node appended to the node list. The new node copies the position, displacement, velocity and constraints of the original; point forces stay on the original; surface loads belong to faces and follow.
4. The lumped mass of the old and the new nodes is re-summed from their elements, in element order.

The rule has no geometric tolerance and no dependence on iteration order, so the topology is deterministic (bit-identical repeat runs are asserted, topology included). Element masses do not change at all, so the mass of the body is conserved exactly; the sum of the nodal masses agrees with it to round-off (measured 1.4e-15 at worst), and a new node has the velocity of its original, so momentum is unchanged to round-off. An interface whose node pair has not been split has no opening there and carries no force.

## Crack band

`model: 'crack-band'` is the simple alternative: no topology change, damage in the elements.

- **Criterion (Rankine).** The equivalent strain is the largest principal value of the undamaged stress divided by `E`. Damage starts when it reaches `sigma_c / E`.
- **Softening.** The stress falls linearly to zero at the strain `eps_f`; the damage is `omega = 1 - (eps_0 / kappa) (eps_f - kappa) / (eps_f - eps_0)` with `kappa` the largest equivalent strain so far, and the stress is `(1 - omega)` times Hooke's stress (isotropic damage).
- **Regularisation.** With `regularisation: 'crack-band'` (default), `eps_f = 2 G_c / (sigma_c h)`, where `h` is the extent of the element along the largest principal stress when it first softens. A band one element wide then dissipates `G_c` per unit crack area. With `regularisation: 'none'`, `eps_f = failureStrain` is fixed and the dissipated energy is proportional to the element size.
- **Deletion.** An element at `omega = 1` keeps `residualStiffness` (1e-9) of its stiffness and is reported once as `element-failed`.
- An element wider than `2 E G_c / sigma_c^2` cannot soften stably; it drops at once, dissipates more than `G_c`, and is counted in `clampedElements`.

In statics the damage is found by repeating "solve with frozen damage, update damage" until it stops growing; damage only grows, so the iteration is monotone. The dissipated energy is the running sum of `psi_0 d(omega)` by the trapezoid rule over load steps.

Its limits are those of isotropic damage: it weakens compression as much as tension, has no crack closure, and under lateral restraint it reads `(lambda + 2 mu) eps` instead of `E eps`, so a band held sideways by its neighbours dissipates `E / (lambda + 2 mu)` of `G_c` (0.905 measured at `nu = 0.2`, 1.000 at `nu = 0`).

## Solvers

- `solveStatic()` finds equilibrium for the current loads and constraints as **one increment from the current state**. Damage is irreversible, so the load path matters: the caller changes the prescribed displacements or loads a little and calls again. The solve is Newton's method with a line search on the incremental potential (strain energy, plus the interface energy along the softening curve with the history frozen, minus the work of the loads), with a conjugate-gradient inner solve on an assembled block-sparse stiffness that stops on negative curvature, as in `solid.ts`. A snap-back is followed as a jump to the next stable state; the energy ledger shows it as an imbalance.
- `step()` advances in time: `backward-euler` (default), `midpoint`, or `explicit` (velocity Verlet). The implicit schemes solve each step the same way with the history frozen; histories, events and insertion are updated at the end of the step.
- `explicitLimit()` is a stability limit valid for **any** crack pattern: the stiffest single element with its own lumped mass, plus a Gershgorin bound on the interface springs with every face inserted. Interfaces are stiff (`sigma_c / delta_0`), so this limit is well below the uncracked one; a larger `initialOpeningRatio` raises it.
- Mass damping `massDamping` (1/s) is available; its losses are booked.

`energy()` returns the ledger: strain, interface (recoverable), kinetic, dissipated, damping, relaxation, external work and their balance. It covers mechanical loading; a temperature change does work that is not booked.

## Fragments and the hand-off to the rigid world

`fragments()` returns the connected pieces: two elements are in one piece when they share a node, or when an interface between them still carries traction at a node pair. Pieces are ordered by their lowest element; each has its elements, nodes, mass, volume, centre of mass, linear momentum, angular momentum about the centre of mass and the inertia tensor of its lumped masses.

`fragmentRigidBody(fragment)` describes a piece as a rigid body for `PhysicsWorld.createBody`: the convex hull of its nodes about its centre of mass (`toHullShape` of `geometry.ts`, at most 64 points), the density that gives the hull the piece's mass, the velocity `p / m`, and the spin from `I w = L`. `handOff(fragment)` returns the same and stops simulating the piece here.

**The hand-off is one-way.** The rigid body does not act back on what is left of the solid, and it does not collide with it. The linear momentum of the description equals the fragment's to round-off (4e-16 relative, asserted); in the rigid world, which stores float32 and derives mass from density and volume, mass and momentum match to 1e-5 (kit test). The hull of a piece that is not convex is larger than the piece, and its centre is the hull's centroid, not exactly the piece's centre of mass.

## In the stepping loop

`fractureSubsystem(body)` is the adapter for [`SIMULATION.md`](SIMULATION.md): post stage, order 300, where `solidSubsystem` runs, after heat and the links; time-step rule `commensurate`, and an explicit body must be within `explicitLimit()`. Crack events of a step are emitted in the events stage with type `'crack'`:

```ts
{time, step, kind: 'initiated' | 'opened' | 'element-failed', face, element, mode: 'I' | 'II' | 'mixed', modeMix, energy, area}
```

`initiated` is an interface inserted on a face (energy 0), `opened` a face that lost all traction (energy `G_c` times its area), `element-failed` a crack-band element at full damage. `modeMix` is the share of the normal part in the effective traction or opening; above 0.9 is mode I, below 0.1 mode II. Outside a Simulation, `body.takeEvents()` returns the same events.

**Saving a cracked body.** `crackState()` lists the cohesive interfaces (face, the largest opening so far at its three node pairs, mode share, open or not); `restoreCracks(list)` puts them back on a body built from the same mesh after its `precrack` and `insertCohesive` calls, in one batch. Nodes split as the final set of interfaces requires, but they are numbered in the order one insertion gives, which can differ from the run that was saved; a node is the same node when its original (`nodeOrigin`) and the lowest element that holds it agree. The scene format uses this ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#coupled-sections-solids-and-heat)); the energy counters and the events are not carried.

### Thermal shock

`thermalSolidLink(heat, body, {reference})` accepts a `FractureBody`, so the heat solver's temperature field becomes the eigenstrain that cracks it. Temperatures are given on the nodes of the mesh as built; duplicated nodes read their original. The link stays one-way: cracks do not change the heat flow.

`quenchedPlate()` builds the example: an alumina-like plate (`E` = 370 GPa, `nu` = 0.22, `alpha_T` = 8e-6 /K, strength 300 MPa, `G_c` = 40 J/m²) at 600 K whose face is cooled by a film coefficient of 5000 W/(m² K) to 300 K. The strip is held in its plane and free through its depth, so a cooled layer carries `E alpha_T dT / (1 - nu)`, the `'plate'` restraint of the heat module's `thermalShock`. The first cracks appear in the cell layer under the cooled face, in mode I, at 0.410 s; the heat module's estimate, the time at which the surface cell has cooled by `sigma_c (1 - nu) / (E alpha_T)` = 79.05 K, is 0.400 s. The solid is later by 2.5 % because its element temperatures are means of nodal values that average in the second cell layer. The cells (0.25 mm) are larger than `l_ch` (0.16 mm), so the onset is meaningful and the crack pattern after it is not resolved.

```ts
import {quenchedPlate, fractureSubsystem} from 'box3d-webgpu-kit/fracture';
import {createSimulation, heatSubsystem, thermalSolidLink} from 'box3d-webgpu-kit/simulation';

const plate = quenchedPlate({dt: 1 / 240});
const sim = createSimulation(world)
  .add(heatSubsystem(plate.heat))
  .add(thermalSolidLink(plate.heat, plate.body, {reference: plate.reference}))
  .add(fractureSubsystem(plate.body));
sim.onEvent(event => { if (event.type === 'crack') console.log(event.data.time, event.data.face, event.data.mode); });
```

## Validation

Measured by `tests/engine/solid-fracture.test.mjs` (12 tests, about 17 s) on Node 22.23.4, Linux x64. Run `node --test --test-reporter=tap tests/engine/solid-fracture.test.mjs` to print the numbers; `FRACTURE_SLOW=1` adds the refined studies quoted below (about 70 s). The material is concrete-like unless stated: `E` = 30 GPa, `nu` = 0.2, `sigma_c` = 3 MPa, `G_c` = 100 J/m², so `delta_c` = 66.7 µm and the characteristic length `l_ch = E G_c / sigma_c^2` = 0.333 m. `c_f = 0.419 l_ch` is the effective length of the process zone of a linear softening law (Planas and Elices, as quoted by Bažant and Planas, *Fracture and Size Effect in Concrete and Other Quasibrittle Materials*, 1998); it is taken from the literature, not derived here.

| Check | Expected | Measured | Tolerance and why | Convergence |
|---|---|---|---|---|
| No cracks | `SolidBody` with the linear model | Displacements within 2e-14 of the largest, statics and 20 midpoint steps | 1e-9: solver tolerance | exact |
| Traction-separation law, driven directly (all nodes prescribed) | Bilinear law; shear strength `beta sigma_c`; mixed mode by the effective opening; secant unloading; penalty `sigma_c / delta_0` in compression; mode II energy `G_c` | Every traction within 1e-10 | 1e-10: no solve involved | exact |
| Bar with a weak cross-section: peak load | `sigma_c A` | 0.9999999999998 `sigma_c A` | 1e-9: uniform stress, solver tolerance | exact |
| Bar: load-displacement curve | Linear softening at the measured opening, 40 load steps | Worst difference 6.5e-13 `sigma_c` | 1e-8 | exact |
| Bar: dissipated energy | `G_c A` | 1.000000000000 `G_c A` | 1e-9 | exact |
| Bar: work to break it (area under the curve) | `G_c A` | 1.000045 `G_c A` | 1e-3: trapezoid rule, off only in the two steps that hold a kink | n/a |
| Bar: unloading to 0.75, 0.4, 0.1 of the displacement, then reloading | The damaged secant through the origin; the same point on return | Within 1e-8; damage unchanged | 1e-8 | exact |
| Bar: broken | Zero traction; two fragments; contact when pushed back | 0 Pa within 1e-9 `sigma_c`; 2; overlap = contact stress / penalty | 1e-9 | exact |
| Mesh objectivity, cohesive, 4×1×1, 8×2×2, 12×3×3 cells | `G_c A` on every mesh | 1.0000000000, 0.9999999999999994, 0.9999999999999989 | 1e-9 | exact |
| Interface inserted by the solver at `sigma_c` | Relaxation `T_before T_after / (2 K)` = 0.021333 `G_c A`; dissipated `G_c A` | 0.021333 on both meshes; work 1.021378 `G_c A`; dissipated 1.000000 | 1e-6 on the relaxation | exact |
| Crack band, `nu = 0`, cells of 50, 25, 12.5 mm, regularised | Work `G_c A` on every mesh | 1.0000, 1.0000, 1.0000 | 1 %: trapezoid sum over 45 steps | objective |
| Crack band without regularisation | Work proportional to the cell size | 2.0001, 1.0000, 0.5000 `G_c A` | 2 % on the ratios 2 and 4 | fails by design |
| Crack band, `nu = 0.2` | Not `G_c A`: towards `E / (lambda + 2 mu)` = 0.9 | 0.9098 and 0.9051 | stated, see the model's limits | objective, biased |
| Energy balance, quasi-static: bar, and notched beam through its whole failure | work = strain + interface + dissipated | Bar 4.5e-5 `G_c A`; beam 8.5e-4 of `G_c` × ligament | 1e-3 and 2e-3: trapezoid rule over the load steps | n/a |
| Energy balance, dynamic: bar breaking in free flight, explicit at 0.8 and 0.4 of the limit | work = strain + interface + kinetic + dissipated | 1.2e-4 and 2.9e-5 of the initial kinetic energy | 5e-4 and 1.5e-4 | order 2.04 |
| The same, midpoint rule at 20 and 10 times the explicit limit | same | 2.1e-2 and 6.8e-3 | 4e-2 and 1.5e-2: the interface force is taken at the half step | order 1.6 |
| The same, backward Euler | Energy only lost | Imbalance positive (numerical damping) | sign | n/a |
| Griffith: centre crack, `a = 5 l_ch`, half-width `4 a`, cells of `l_ch` | `sigma_f = sqrt(E G_c) / (Y sqrt(pi a))`, `Y = sqrt(sec(pi a / (2 b)))` = 1.040 | +11.5 % | 15 %: 0.42 cells per `c_f`, too coarse on purpose | see below |
| Griffith, cells of `l_ch / 2` | same | −3.5 %; +1.2 % against LEFM for the crack `a + c_f` | 5 % and 3 % | see below |
| Griffith with on-demand insertion (nothing inserted beforehand), cells of `l_ch` and `l_ch / 2` | The failure stress of the pre-inserted path | +0.9 % and 0 | 1.01 %: one load step | n/a |
| The same with `tipInsertionThreshold: 1` | It must fail near the same stress | Still intact at 1.3 times LEFM on both meshes | shown as the failure the rule removes | n/a |
| Notched beam, depth 0.6 `l_ch`: work of fracture, 4 and 6 cells in the ligament | `G_c` × ligament × `(1 - 1 / (2 n))` | 0.8759 (0.8750) and 0.9157 (0.9167) of `G_c` × ligament | 1 %; and 13 %, 9 % against `G_c` × the full ligament | first order: the shortfall is half a cell |
| Notched beam, depth 2.4 `l_ch`: peak load | Below LEFM; Bažant's size-effect law `t sqrt(E G_c D) / sqrt(k^2 + (k^2)' c_f / D)` | 0.750 of LEFM; +8.9 % against the law | 12 %: the law is an asymptote for large beams | see below |
| Free flight: linear momentum | Constant | Drift 1.7e-14 of `m V` over 358 steps | 1e-12: round-off | n/a |
| Free flight: angular momentum | Constant | 4.6e-15 of `m V L` without spin; 1.5e-4 spinning at 40 rad/s | 1e-12; 1e-3: small-strain elements keep it to the order of rotation × strain | n/a |
| Node splitting | Element masses unchanged; nodal sum and momentum unchanged | Bit-identical element masses; nodal sum within 1.4e-15; momentum within 1e-14 | 4e-15 | n/a |
| Fragments | Two halves; masses and momenta sum to the body; ordered by lowest element | Sums within 1e-14 | 1e-14 | n/a |
| Hand-off | Linear momentum of the rigid description = the fragment's | Within 4e-16 relative | round-off | n/a |
| Thermal shock: place and time of the first crack | Surface layer; the heat module's estimate, 0.400 s | Surface layer, mode I; 0.410 s (+2.5 %) | Never earlier, at most 5 % later: element temperatures average in the second cell layer | n/a |
| Determinism | Identical bits on a repeat run | Identical displacements, velocities, connectivity, node origins, interfaces and events: statics with insertion, explicit dynamics, the thermal example | bit equality | n/a |
| Irreversibility | Damage and dissipated energy never decrease | Monotone through a history with two reversals into contact | exact comparison | n/a |

### Griffith: what the error is made of

The plate is half of a centre-cracked strip (symmetry plane at the crack centre), thin (two cells), with the remote tension applied as a traction. The crack plane is a mesh plane with interfaces on the ligament. The load rises in steps of 1 % of the reference until the crack runs (the solve does not converge, or the crack leaves the refined zone), so every strength below is known to ±0.5 %.

Two errors of opposite sign are in play. The cohesive law has a process zone, so its crack is weaker than an ideal Griffith crack of the same length; the estimate is LEFM for the crack `a + c_f`. And cells too coarse for that zone make the plate stronger.

| Mesh | Cells per `c_f` | `sigma_f` / LEFM | against `a + c_f` |
|---|---|---|---|
| Gate, cells of `l_ch`, far field graded by 1.5 | 0.42 | 1.115 | +16.9 % |
| Gate, cells of `l_ch / 2` | 0.84 | 0.965 | +1.2 % |
| Study, `l_ch / 2`, far field graded by 1.25, twice the refined zone | 0.84 | 0.955 | +0.1 % |
| Study, `l_ch / 4` | 1.68 | 0.955 | +0.1 % |
| Study, `l_ch / 8` | 3.35 | 0.955 | +0.1 % |
| Study, `a = 10 l_ch`, `l_ch / 4` | 1.68 | 0.985 | +0.9 % |

So the mesh error falls from +17 % to about 1 % between 0.4 and 0.8 cells per `c_f` and is below the 1 % load step from there on; the converged model sits at 0.955 of LEFM for `a = 5 l_ch` (the effective-crack estimate gives 0.954) and at 0.985 for `a = 10 l_ch` (0.976): the remaining difference from Griffith is the finite strength of the law, and it shrinks as the crack grows relative to `l_ch`. No parameter was adjusted. The study rows are not in the gate; `FRACTURE_SLOW=1` reruns them and asserts they stay within 1.5 % of the effective-crack estimate.

### Notched beam

Span `4 D`, notch `D / 2`, loaded by a prescribed deflection at mid-span, interfaces on the mid-section. `k(alpha)` is Srawley's formula (ASTM E399) in `K_I = P k / (t sqrt(D))`.

- **Work of fracture.** The node row under the load is the hinge: it never opens, so with `n` cells in the ligament the crack area is `1 - 1 / (2 n)` of the ligament. The work matches `G_c` times that area within 0.1 % (4 cells) and 0.1 % (6 cells); against `G_c` times the whole ligament it is 12.4 % and 8.4 % short, first order in the cell size.
- **Peak load.** LEFM is an upper bound for a cohesive crack. Peak / LEFM is 0.55 at `D = 0.6 l_ch`, 0.75 at 2.4 `l_ch` (8 cells through the depth), 0.73 with 12 cells, and 0.80 to 0.82 at 4.8 `l_ch`: the size effect. Against Bažant's law with `c_f = 0.419 l_ch`: +28 % at 0.6 `l_ch` (far outside its range), +8.9 % and +6.2 % at 2.4 `l_ch` with 8 and 12 cells, −0.7 % and +1.8 % at 4.8 `l_ch` with 12 and 16 cells. The larger beams drop fast after the peak; their ledgers show imbalances of 1 % to 2 % of `G_c` × ligament there.

## Mesh dependence

A strip in tension has its weak faces in a band around a plane inclined 30° to the cross-section, and the solver inserts interfaces where it needs them. The ideal crack is that plane.

| Mesh | Crack area / plane | Dissipated / (`G_c` × plane) | Peak load / (`sigma_c A`) | RMS distance of the crack from the plane |
|---|---|---|---|---|
| Five tetrahedra per cell, 8 cells along | 1.025 | 1.375 | 1.022 | 0.48 cells |
| Five tetrahedra per cell, 16 cells along | 1.212 | 1.486 | 1.146 | 0.31 cells |
| Six tetrahedra per cell, 8 cells along | 1.299 | 1.537 | 1.072 | 0.20 cells |

The crack is 2.5 % to 30 % larger than the plane, depending on the mesh pattern and on the cell size, and halving the cells does not bring it to the plane (1.03 becomes 1.21): the excess is the staircase, set by the angle between the plane and the faces the mesh offers. The dissipated energy is 38 % to 54 % too high, more than the area, because faces beside the path soften without opening. The peak load is 2 % to 15 % too high.

These numbers are with the default crack-front rule. With insertion at the strength only (`tipInsertionThreshold: 1`) the same three strips give areas of 1.241, 1.241 and 1.478, energies of 1.524, 1.316 and 1.686 and peaks of 1.123, 1.435 and 1.109: the rule lowers the peak error from 11–44 % to 2–15 % and changes which faces open, but the mesh still decides the path. Read every result of this solver whose crack is not on a mesh plane with that in mind. What *is* mesh-objective is the energy per unit of crack area that actually opens: `G_c`, on every mesh.

## Limits

- **Crack paths follow element faces** (above). No remeshing, no crack-tip enrichment.
- **Branching** is whatever the interface model gives: a crack branches where two faces at a node both reach their strength. There is no branching criterion beyond that, and no validation of branching, crack speed or fragment statistics.
- **No plasticity**, no rate dependence, no fatigue, one bulk material per body (faces and elements can have their own strength and toughness).
- **Contact** only across an interface, as a frictionless penalty. Fragments do not collide with each other or with anything else here. Hand them to the rigid world, one way.
- **Small strain.** A piece that rotates carries false stress; angular momentum is conserved to the order of rotation times strain.
- **Insertion on demand** reads the mean stress of two elements, which under-reads the peak at a crack tip. The crack-front threshold of 0.4 corrects that for cells up to `l_ch` (checked on the centre-cracked plate only, mode I, crack on a mesh plane); coarser cells, or a crack that starts at a notch that is not cut with `precrack`, are not covered: a re-entrant corner without a cut face has no crack front and is read with `insertionThreshold`. An inserted interface is compliant: `initialOpeningRatio` trades that compliance against conditioning and the explicit time step.
- **Snap-back** in a static solve is followed as a jump; the energy that would become motion shows up as a ledger imbalance.
- **The crack band** is isotropic damage with a Rankine measure: no crack closure, weakened compression, 10 % less energy when confined at `nu = 0.2`.
- **In scenes:** a scene file can describe a cohesive fracture body (`solids` with `fracture`: notches, pre-inserted interfaces, saved interfaces, [`SCENE_FORMAT.md`](SCENE_FORMAT.md#coupled-sections-solids-and-heat)) and the Lab runs and draws it (`lab.html?example=notched-beam`, `quenched-plate`). `crackState()` and `restoreCracks()` carry the interfaces of a save; the energy counters and the events are not saved, and the crack-band model has no scene form. Not used by the Studio; at most 200,000 nodes.

## Cost

JavaScript, one thread, float64; measured on the test machine, no performance claim.

- **Explicit step:** about 0.7 µs per element (3.6 ms for 5,120 elements, 18 ms for 23,040), including the check for new interfaces. The step itself is small: with the default `initialOpeningRatio` the interface springs set the limit.
- **Implicit step or static increment:** one Newton solve, typically 4 to 7 Newton iterations once interfaces are active. A conjugate-gradient iteration costs about 0.15 µs per node. Measured: 40 ms per midpoint step for 5,120 elements, 0.2 s for 23,040; 0.13 s for the first solve of the 2,750-element Griffith plate (717 iterations) and under 1 s for the eight increments of its load path; about 2 s for the 62 increments that break the 720-element beam.
- **Memory:** the stiffness is assembled as 3×3 blocks, about 15 per node; it is rebuilt when nodes split or the crack band's damage changes.
- **Crack band in statics:** about 20 frozen-damage solves per increment while a band softens.

## Use

```ts
import {FractureBody} from 'box3d-webgpu-kit/fracture';
import {boxMesh} from 'box3d-webgpu-kit/solid';

const body = new FractureBody({
  mesh: boxMesh({size: [0.2, 0.05, 0.05], cells: [8, 2, 2]}),
  material: {youngModulus: 30e9, poissonRatio: 0.2, density: 2400},
  fracture: {model: 'cohesive', strength: 3e6, toughness: 100},
});
body.constrain(body.selectNodes(x => x < 1e-9), [0, 0, 0]);
const end = body.selectNodes(x => x > 0.2 - 1e-9);
for (let i = 1; i <= 40; i++) {                       // the caller steps the load
  body.constrain(end, [i * 2e-6, null, null]);
  const result = body.solveStatic();
  for (const event of body.takeEvents()) console.log(event.kind, event.face, event.mode);
}
const pieces = body.fragments();                      // ordered by lowest element
if (pieces.length > 1) world.createBody(pick(body.handOff(pieces[1])));   // one way
```

`handOff` returns `{shape, position, linearVelocity, angularVelocity, density, type}` for `createBody`, plus `mass`, `hullVolume` and `linearMomentum` for your own checks (`pick` above stands for dropping those three).

## Reproduce

```sh
npm run test:fracture
node --test --test-reporter=tap tests/engine/solid-fracture.test.mjs   # prints the measured numbers
FRACTURE_SLOW=1 node --test --test-reporter=tap tests/engine/solid-fracture.test.mjs   # adds the refined studies
npm run typecheck
```
