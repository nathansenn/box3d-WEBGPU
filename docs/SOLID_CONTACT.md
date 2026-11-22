# Deformable solids in contact with rigid bodies and with each other

`SolidContact` (`src/engine/solid-contact.ts`, kit subpath `box3d-webgpu-kit/solid-contact`, solver id `solid-contact-penalty-newton-pcg-js-f64-v1`) lets the tetrahedral solid of [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md) touch rigid bodies: contact with boxes, spheres, capsules and planes, Coulomb friction, and welds of solid nodes to a body. `SolidCoupling` (backend id `rigid-solid-coupling-monolithic-js-f64-v1`) couples it both ways to the rigid world, and `solidContactSubsystem` puts it in the one stepping loop of [`SIMULATION.md`](SIMULATION.md).

Every number below was measured by `packages/box3d-kit/test/v17-solid-contact.test.mjs` (12 tests, about 21 s), which runs in the pull-request gate; the rows are also in [`VALIDATION.md`](VALIDATION.md) (domain "Deformable solids in contact with rigid bodies").

## Use

```ts
import {createWorld} from 'box3d-webgpu-kit';
import {createSimulation} from 'box3d-webgpu-kit/simulation';
import {SolidBody, boxMesh} from 'box3d-webgpu-kit/solid';
import {SolidCoupling, solidContactSubsystem} from 'box3d-webgpu-kit/solid-contact';

const world = await createWorld({step: 1 / 240, ground: false});
const pad = new SolidBody({mesh: boxMesh({size: [0.2, 0.05, 0.2], cells: [4, 2, 4]}),
  material: {youngModulus: 1e6, poissonRatio: 0.3, density: 1000}, config: {dt: 1 / 240, gravity: [0, -9.81, 0]}});
pad.constrain(pad.selectNodes((x, y) => y === 0));               // hold the base

const box = world.createBody({shape: {kind: 'box', halfExtents: [0.1, 0.05, 0.1]}, position: [0.1, 0.1, 0.1]});
const coupling = new SolidCoupling(world, pad);
coupling.addBody(box, {shape: {kind: 'box', halfExtents: [0.1, 0.05, 0.1]}, friction: 0.5});   // the world cannot report shapes
coupling.addPlane({normal: [0, 1, 0]});                          // a fixed plane that is not a body of the world
coupling.weld(nodes, box);                                       // fix solid nodes to a body, two-way

const sim = createSimulation(world).add(solidContactSubsystem(coupling));
sim.step();                       // or by hand: coupling.step(); world.step();
coupling.force(box);              // force and torque the solid put on the body in the last step
```

Do not also step the same `SolidBody` with `solid.step()` or register it with `solidSubsystem`: the coupling advances it.

`SolidContact` alone (no world) keeps its own bodies in float64 and moves the dynamic ones itself; it also has `solveStatic()`. The Hertz and pad statics below use it.

## The step

The solid must use the backward-Euler integrator. One step minimises one function of the nodal displacements `u` and of six numbers per dynamic body, its displacement `c` and the rotation `dθ` it makes beyond its free rotation:

```
Φ = W(u) − f_ext·u + Σ m_i |u_i − (u_i⁰ + h v_i)|² / (2 h²) + damping           the solid's own backward-Euler step
  + Σ_bodies [ m |c − c_free|² + dθᵀ I dθ ] / (2 α h²)                           the inertia the rigid step gives a body
  + Σ_contacts k ⟨−gap⟩² / 2                                                     one-sided springs, node against body
  + Σ_contacts friction(|slip|)                                                  a stick spring capped at μ N
  + Σ_welds k |x − x_body|² / 2                                                  nodes fixed to a body
```

It is found by Newton's method with a backtracking line search on `Φ`; each Newton step is solved by conjugate gradients, preconditioned by the diagonal for the nodes (or, when the solid has `linearSolver: 'ldl'`, by a sparse factorization of the solid's tangent plus the springs' node blocks, kept across iterations and steps: [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#linear-solver-linearsolver-ldl)) and by the exact 6 × 6 block for each body. The tangent of the solid is its own (exact for all three models); the springs are linear in the unknowns of a step, so their Hessian is exact. Each friction pass after the first starts from the state the previous pass ended in, whose energy and internal forces the last accepted line-search trial already evaluated; the pass takes them instead of evaluating the solid again (the same numbers to the bit, asserted; 2026-11-18). A solve stops when the unbalanced force is below the solid's `tolerance` (default 1e-10) times the largest force of the start state or the present iterate, plus the rounding limit of the springs (their stiffness times the largest increment times 2⁻⁵⁰).

### The bodies are unknowns of the solid's solve

Two ways were considered, the ones the cloth and the structure coupling use.

- [`STRUCTURE_COUPLING.md`](STRUCTURE_COUPLING.md) solves each attachment with the effective mass of both sides, attachment by attachment, with one Gauss-Seidel sweep between attachments that share a body. That is exact for one attachment and lags for several.
- [`CLOTH.md`](CLOTH.md) puts each body's six degrees of freedom into the cloth's implicit solve with the inertia the rigid step will give it.

A body on a solid touches tens of nodes at once, and each contact can open or close inside the step. One sweep over per-node effective masses would not converge for that, so this module does what the cloth does. Each dynamic body adds

```
Φ_body = [ m |c − c_free|² + dθᵀ I dθ ] / (2 α h²),    α = (n + 1) / (2 n)
```

where `c_free = h v + α h² (g + F_other / m)` is where the rigid solver's `n` sub-steps of symplectic Euler would move it without the solid. Contact planes, friction anchors and weld targets ride on `c` and `dθ`, so the Newton iteration finds the solid and the bodies together. The force and torque of the converged springs go to the world with `applyForce` and `applyTorque`, and the rigid step then moves the body to where the solve put it. A force or torque component too small for a float32 is handed over as an exact zero (the rigid world refuses such values; the same rule as `flush()` in the structure coupling).

Why this is stable for both extremes: the stiffness the body feels and the inertia the solid feels are both inside one positive-definite system, so no product of a stiffness and `h²/m` appears as an explicit step. Measured (240 Hz unless stated):

| Case | `k h² / m` | Implicit | Naive staggering |
|---|---|---|---|
| 4 g box on a steel block (`E` = 200 GPa) | 7·10⁸ | never faster than 5.7·10⁻⁷ m/s in 1 s; force / weight at most 1.000023; at 60 Hz 1.5·10⁻⁷ m/s | thrown off at the world's speed limit (400 m/s) in the first step, by a force of 5·10⁸ weights |
| 80 kg box on a 2 kg pad of `E` = 0.2 MPa, 60 Hz | 0.56 | set down from touching: force at most 1.48 weights, at rest (2.7·10⁻⁵ m/s) after 3 s on the right force to 1·10⁻³ | stable too (0.035 at 240 Hz): an explicit spring is only unstable when `k h² / m` is large |

`scheme: 'naive-staggered'` solves the solid against the bodies' free motion and hands them its force afterwards. It exists to show this and should not be used.

**Float32 positions.** The world keeps float32 state: a body at 0.1 m is known to 7·10⁻⁹ m, and a steel contact turns that into thousands of newtons. Where the world put a body where the last solve said it would, to within four float32 roundings, the coupling keeps its own float64 value; any other difference (another contact, a joint, a teleport) is larger than that and the world's value is taken.

**What the solid cannot see.** A body's other contacts and joints are in the rigid world, not in `Φ`. The coupling estimates their force from how the body moved in the last rigid step (`m Δv / h` less gravity less what the solid applied) and adds it to `c_free` (`estimateSupports`, default on). It lags by one step. A 4 kg block on a box on rigid ground loads the box by its weight to 6·10⁻⁸ with the estimate and 2.4·10⁻⁶ without.

## Contact

Shapes: **box, sphere, capsule** (by their exact signed distance) and the **plane** (static or kinematic only). **Convex hulls, triangle meshes and height fields are not supported**; `addBody` refuses them.

Contact is node against body, on the solid's surface nodes.

- At the start of a step every surface node within reach of a body (`skin`, default half an element, plus what the node and the body can travel in the step) gets one plane per body: the tangent plane at the nearest point of the body, held in the body's frame. The plane is one-sided; a node that is not touching yet has an inactive one.
- **Facing rule.** A body's face can press on a node only if the node's own outward normal (its area-weighted surface normal) is turned against the face normal, with a cosine of at least 0.2 between the node's normal and the reversed face normal. Inside a box, the node leaves through the nearest face that passes this test. Without the rule the side of a box sliding on a solid catches every node ahead of it that stands a contact depth above the box's lower face. A box face's outline is taken a tenth of an element wider than the box, so a node on the box's edge stays under it when the solid bulges sideways.
- **Stiffness.** A contact is a spring of `k = stiffnessScale (λ + 2μ) A / l` (default `stiffnessScale` 100), `A` the area the node turns towards the body and `l` the mean element size: a hundred times one layer of elements. Because `k` follows the facing area, a uniform pressure sinks every node equally and a uniform state stays exact. The force a resting contact carries does not depend on `k`; the depth does: `p l / (stiffnessScale (λ + 2μ))` under a pressure `p` (0.77 µm under the 10 kg block below, measured to 0.2 % of that formula).
- **Friction** is Coulomb's law as a stick spring of the contact stiffness between the node and an anchor on the body, capped at `μ N`. Below the cap the node sticks without creep. At the cap it slides and the anchor is dragged along at the end of the step. `N` is the normal force of the same step: the step is solved again with updated caps until none changes by more than `frictionTolerance` (default 1e-4) of the largest, at most `frictionPasses` (default 12) times. A resting contact takes one pass, steady sliding three. Static and kinetic coefficients are equal.
- Within a step a body's rotation is linearised about its free rotation (error `(ω h)² / 2` of the arm for the part the solid adds).

**Welds.** `weld(nodes, body)` fixes nodes to a body at the points where they are. A weld is a spring of `stiffnessScale` times the node's own stiffness in all three directions; the node follows the body within `force / stiffness`. A static or kinematic body makes it a moving support. A welded face is held sideways too, like a face glued to a rigid plate. A welded node takes no contact spring against the body it is welded to (since 2026-11-12: before, a welded node lying on the surface of a box could be paired with the box's far face, through the box: the Studio's elastomer lab put two corner nodes of its top face in contact 1.1 m deep with its platen in the first step, 90 MN that the welds then pulled back).

## In the stepping loop

`solidContactSubsystem(coupling)` runs in the **couple** stage at order 170: after the structure coupling (100) and the cloth (150), before the water (200). Its `dt` must equal the simulation step. A bare `SolidContact` runs in the post stage and may be sub-cycled.

- **Energy entry:** kinetic + strain + load potential of the solid, plus the energy in the contact, friction and weld springs. `exchanged` is the work the bodies did on the solid (minus the force on each body times its displacement and rotation of the step). The bodies themselves are not counted; track them with `simulation.trackBody`. Backward Euler, Rayleigh damping and friction make `total − exchanged` fall.
- **Events,** at the end of a step: `contact-begin` and `contact-end` with `{body, index}` when a body starts or stops pressing on the solid, and `unconverged` with `{residual, reference}` when a step stopped at an iteration limit or with friction limits still changing.
- A run through the loop is bit-identical to `coupling.step(); world.step()` by hand (asserted).

## Validation

240 Hz and 4 rigid sub-steps unless stated. Linear model unless stated.

| Check | Expected | Measured | Tolerance and why |
|---|---|---|---|
| 10 kg rigid block on a 0.2 × 0.2 × 0.05 m pad (`E` = 1 MPa, `ν` = 0.3), **free sides**, statics | uniaxial **stress**: `m g L / (E A)` = 1.22625·10⁻⁴ m | error 1.1·10⁻¹² (linear and corotational) | 1e-8: a uniform strain is in the element space; solve tolerance only |
| … **held sides** (every node held sideways) | uniaxial **strain**: `m g L / ((λ + 2μ) A)` = 9.10929·10⁻⁵ m | error −1.0·10⁻¹¹ | 1e-8. The two cases differ by `(1 − ν) / ((1 + ν)(1 − 2ν))` = 1.346: taking the wrong one is a 35 % error |
| … contact depth | `p l / (100 (λ + 2μ))` = 7.68·10⁻⁷ m | 7.67·10⁻⁷ m | 0.5 %: `l` changes with the strain |
| The same pad under a 7.2 kg box of the rigid world, through the loop, 2 s | `m g L / (E A)`, force `m g`, at rest | shortening error 7·10⁻⁸; force 70.63201 N against 70.63200 N; speed 2.4·10⁻⁹ m/s | 1e-6: the mass is a float32 |
| … energy ledger | `total − exchanged` never rises | largest rise 3·10⁻¹⁵ J of 5.8·10⁻³ J | 1e-9 of the work |
| … determinism | repeat and hand-driven runs bit-identical | identical world hash and solid arrays | bit equality |
| **Hertz:** rigid sphere `R` = 1 m pressed 0.625 mm into a block 1 m wide and 0.5 m deep (quarter model, base held), statics, `stiffnessScale` 1000 | `F = (4/3) E* √R δ^1.5`, `E* = E / (1 − ν²)` = 22.894 N; a bonded layer of that depth is 4.6 % stiffer (Dimitriadis et al. 2002) | 729 nodes (2.5 elements per contact radius): +21.6 % (against the layer +16.3 %); 2197 nodes (3.75): +14.4 % (+9.4 %); 4913 nodes (5): +11.7 % (+6.8 %) | bounds 18 %, 11 %, 8 % against the layer: what was measured plus a margin. Always too stiff |
| … exponent of `F` against `δ`, 0.2 to 0.625 mm, 2197 nodes | 1.5 | 1.559 (1.542 with the layer factor divided out) | 0.08 |
| **Friction:** rigid box on a slab tilted 26°, `μ` = 0.5 (tan = 0.488) | no motion; friction / normal = tan θ | moved 0 m in 0.75 s after settling; ratio 0.48773 | 1e-7 m (float32 position); 1e-5 |
| … tilted 27.5° (tan = 0.521) | slides at `−g (sin θ − μ cos θ)` = −0.17897 m/s² | −0.17967 m/s² (+0.39 %); friction / normal 0.49993 | 2 %: the difference of two forces 25 times larger; the box rocks slightly on the nodes |
| **Mass on a column:** 2 kg block resting on a 1.25 kg column (`k = E A / L` = 1000 N/m, 8 cells) | bar with a tip mass, `x tan x = m_col / M`: 3.2275 Hz. (`√(k / M)` gives 3.5588 Hz, `M + m_col / 3` gives 3.2375 Hz) | 3.2231 Hz (−0.14 %) at 240 Hz; 3.2237 Hz (−0.12 %) at 480 Hz | 0.4 %: lumped masses on 8 cells, and the time step |
| **Weld:** 1.536 kg block welded under a 0.4 m bar, `ν` = 0 | `M g L / (E A) + ρ g L² / (2 E)` = 3.19571 mm; support carries both weights | 3.19572 mm (+3.9·10⁻⁶); reaction 24.87814 N against 24.87816 N | 5e-5; 1e-5 |
| … `ν` = 0.3 | a welded end is clamped sideways | 1.36 % stiffer; the welded block on the column swings 0.51 % faster | bounded, not a closed form |
| **Momentum:** 3 kg ball at 2.06 m/s into a free 8 kg block, friction 0.4, corotational, 120 steps, float64 bodies | total linear momentum constant | changed by 7.6·10⁻¹³ of the ball's | 2e-11: the residual of the nodes' solve times the step |
| … through the float32 rigid world | constant | 1.2·10⁻⁷ | 2e-6 |
| **Ground plane:** a free 1 kg cube (`E` = 0.1 MPa, `ν` = 0) set on a fixed plane, statics | the plane carries `m g`; the cube shortens by `ρ g L² / (2 E)` = 0.4905 mm | force equal to 10 digits on all 16 bottom nodes; 0.4887 mm (−0.36 %) | 1e-9; 0.8 %: lumped weights on 4 cells. With `ν` = 0.3 the flat plane stops the base from warping and the shortening is 2.0 % less |
| **Capsule:** a 2 kg capsule (radius 0.05 m) lying on a pad, statics | carried by `m g`, no sideways force or torque | force equal to 10 digits; it rolls half a node spacing and rests on two rows of nodes, 1.66 mm lower (sagitta of that chord 1.59 mm) | 1e-9. The roll is the node-only contact, see Limits |
| Mass ratios | see the table above | | |

## Cost

JavaScript on one thread. A resting contact step of the 125-node pad takes about 1 ms; the sliding box on a 153-node slab 18 ms (three friction passes); the 4913-node Hertz solve 4 s. No performance claim is made.

## Plastic solids

An elastic-plastic `SolidBody` (J2, docs/SOLID_MECHANICS.md) works here unchanged: the contact solve uses the body's consistent tangent, every `step()` commits the plastic state through `kernel().advance()`, and `solveStatic()` commits it once at the end (`kernel().commit()`). `src/engine/press-brake.ts` bends sheet between a punch and die this way; its validation is in docs/STUDIO_METAL_PRESS.md.

## Limits

- **Hertz is 7 % to 16 % too stiff on the meshes in the gate** and converges slowly; linear tetrahedra with node-against-surface contact are the cause. Pressure distributions inside a contact are not checked.
- **Only nodes are tested.** A body corner or edge that passes between nodes is not seen, and a body smaller than the mesh spacing rests on single nodes. A round body finds the gaps: the capsule above rolls half a node spacing to sit on two rows of nodes. The mesh must be finer than the bodies.
- **One plane per node, body and step, from the start of the step.** Nothing is traced along a node's path: a thin body that crosses a solid in one step is missed. Curved bodies are seen through tangent planes (error `t² / 2R` for a tangential travel `t` in the step).
- **No contact between two solids, and no self-contact.**
- Backward Euler only. It damps: 36 % of the kinetic energy is left after the impact case. Restitution is not a parameter.
- Friction: equal static and kinetic coefficients, no rolling or spinning friction. Only steady sticking and sliding are validated.
- The rotation of a body in contact is linearised within a step; fast-spinning bodies are not checked.
- Other contacts and joints of a coupled body are seen through an estimate that lags one step.
- Extreme stiffness with a light body works because increments are measured from the start of the step; the force of a spring is still resolved only to `k × increment × 2⁻⁵²`.
- Solids in contact with each other: see the section above; a scene names them in `contact.solids`.
- A scene file can describe a solid in contact (`solids` with `contact` and `welds`, [`SCENE_FORMAT.md`](SCENE_FORMAT.md#coupled-sections-solids-and-heat)) and the Lab runs and draws it (`lab.html?example=rubber-pad`); a save does not carry the contact state (friction anchors, the support estimate). The Studio does not run them.

## Deformable against deformable (`SolidSolidContact`)

`src/engine/solid-solid-contact.ts`, published with `box3d-webgpu-kit/solid-contact`. Several `SolidBody` meshes, each with its own material, model and constraints, are advanced by backward Euler in **one** Newton solve; a body can also collide with itself, and all of them with fixed planes. Solver id `solid-solid-contact-node-face-penalty-newton-pcg-js-f64-v1`.

```js
import {SolidBody, boxMesh} from 'box3d-webgpu-kit/solid';
import {SolidSolidContact, solidSolidContactSubsystem} from 'box3d-webgpu-kit/solid-contact';

const lower = new SolidBody({mesh: boxMesh({size: [0.1, 0.1, 0.1], cells: [3, 3, 3]}), material: soft, config: {dt: 1 / 240, gravity: [0, -9.81, 0]}});
const upper = new SolidBody({mesh: boxMesh({size: [0.1, 0.1, 0.1], cells: [4, 4, 4], origin: [0, 0.1, 0]}), material: softer, config: {dt: 1 / 240, gravity: [0, -9.81, 0]}});
const contact = new SolidSolidContact([lower, upper], {friction: 0.5, selfContact: false});
contact.addPlane({normal: [0, 1, 0], friction: 0.5});
contact.step();                       // or contact.solveStatic()
contact.contactForce(1, 0);           // force on `upper` from `lower`, N
```

**The contact.** At the start of a step every surface node of body A is paired with the boundary triangle of body B closest to it (a grid of B's faces; candidates within `skin` plus what the two bodies can close in the step, facing the node, with the node over the face). The pair is a one-sided spring on `gap = n . (x_node - sum xi_i x_i)`: the foot point's barycentric weights `xi` and the normal `n` are frozen for the step, so the energy `k <-gap>^2 / 2` is a function of the displacements alone, its tangent is symmetric, and what the node feels the triangle's three nodes get back with the weights `xi`. The contact forces therefore sum to zero exactly. Every pair of bodies is searched both ways (A's nodes on B's faces and B's on A's). `k = stiffnessScale min(M_A / l_A, M_B / l_B)` per unit of the node's facing area (M = lambda + 2 mu, l the mean element size), so an interface under pressure p closes by `p l / (2 stiffnessScale M)`.

- **Normal.** The weighted mean of the triangle's three vertex normals, each the area-weighted mean of the faces around the vertex that lie within 30° of the triangle: continuous from facet to facet of a curved surface (without it a node near a ridge of the other mesh switches between two facets from pass to pass and the static passes do not settle), the facet's own normal on a flat face, and a sharp edge is not rounded.
- **Friction.** The capped stick spring of the rigid contact above: stiffness k along the tangent plane, force capped at mu N, N from the previous pass (up to `frictionPasses`). The stretch of each node's friction spring is carried from step to step (and is part of the checkpoint), so a block stays where it is on a slope below the friction angle.
- **Self-contact** (`selfContact`). A node is not paired with the faces around it, nor with a face that shares a node with one of them, and not with a face more than a quarter of an element size behind it: the far side of a thin part faces the node through the material.
- **Statics** (`solveStatic`): Newton solves with the pairing found again from each answer until the displacements stop changing. Each body must be held by something other than contact.
- **Linear solver.** Conjugate gradients with the diagonal of each body's stiffness plus the springs. A body's `linearSolver: 'ldl'` is not used here.

### Validation

`packages/box3d-kit/test/v22-solid-solid-contact.test.mjs` (8 tests, in the kit gate; rows `solid-contact.pair.*`):

| Check | Reference | Measured | Tolerance |
|---|---|---|---|
| Two blocks pressed together, surface meshes that match (4 × 4 cells each) | series springs `delta A / (L1 / E1 + L2 / E2 + 1 / (2 k))` | force +2.2e-8; element stress uniform to 1.4e-4 | 1e-6; 1e-3 |
| The same with 3 × 3 on 4 × 4 cells, 5 × 5 on 7 × 6 × 7, E2 = 100 E1, the corotational model, stiffnessScale 1000 | the same | force -2.4e-4, -1.0e-4, -1.1e-4, -2.4e-4, -5.2e-5 | 5e-4 |
| Hertz, two elastic caps (R1 = 3 m, R2 = 1.5 m, E = 1 MPa, nu = 0.3), 2.5, 3.75 and 5 cells per contact radius | `F = (4/3) E* sqrt(R*) delta^1.5` times the bonded-layer factor 1.046 (Dimitriadis et al. 2002) | +15.3 %, +8.5 %, +5.9 % (+20.6 %, +13.5 %, +10.8 % against plain Hertz) | 18 %, 11 %, 8 %, and falling |
| The same coarse mesh with E2 = 5 E1, and a flat block against a cap of R = 1 m | the same error as equal caps | +15.6 %, +15.3 % (equal caps +15.3 %) | within 1 % of it |
| Force against approach, delta and delta / 2 | exponent 1.5 | 1.552 | ±0.12 |
| Free impact of two cubes (1 kg and 2.5 kg, off centre, friction 0.3 and 0), 400 steps | linear momentum constant; angular momentum constant | 1.1e-9 and 1.9e-9 of \|p\|; 6.5e-4 and 1.4e-3 of \|L\| | 1e-8; 3e-3 |
| Three soft cubes (E 0.2, 0.1, 0.3 MPa) stacked on a plane, 2 s | plane 3 W, interfaces 2 W and W; at rest | within 3e-9 of each; speed 0, drift 1e-11 m | 1e-6 |
| A block on a wider block on a slope, friction 0.3 | sticks at 10° and 15° with shear m g sin; slides at 25° with a = g (sin - mu cos) | shear to 1e-10; a = 1.478633 against 1.478621 m/s² (8e-6); mu = 0: 4.145884 against 4.145885 | 1e-6; 1e-3; 2e-3 |
| Self-contact: the arms of a slotted block | they stop at each other | 2, then 4 contacts, 19 µm deep, reaction 35.4 N against 13.9 N; without self-contact the arm goes 5.2 mm through | depth below 50 µm |
| Checkpoint: the stack resumes from `saveState()`, alone and in the stepping loop | bit-identical | bit-identical | exact |

**Limits, measured.**

- **Patch test.** A node against a face does not pass the contact patch test when the two surface meshes do not match: the pressure across the interface is uneven from node to node. On 3 × 3 against 4 × 4 cells the element stress is within 5.5 % of uniform (5.9 % on 5 against 7 cells: it does not fall with the mesh), 30 % with a modulus ratio of 100, and 42 % in the worst case found, coincident nodes with crossed surface diagonals (3 × 3 on 3 × 3 cells), where the total force is 1.5 % low. The total force is otherwise within 2.4e-4. A mortar or segment-to-segment integration would be needed to do better.
- **Hertz** converges from above at the rate of the rigid-sphere rows of this document (+9.4 % and +6.8 % there at 3.75 and 5 cells per radius): linear tetrahedra and one spring per node. The layer factor is that of a rigid sphere on a bonded layer; for two equal bodies it applies by symmetry, for unequal ones it is an estimate.
- **Angular momentum** is kept to 1e-3 over an impact, not to rounding: the foot points are frozen during a step.
- **Backward Euler** damps: the impact above keeps 37 % of its kinetic energy (40 % without friction). Restitution is not a parameter.
- Contact between a solid of a group and a rigid body is not available: `SolidSolidContact` takes solids and fixed planes. No welds between solids. Edge-to-edge contact (two edges crossing with no node inside the other body) is not detected. A node that goes more than an element size behind the other body's face in one step is lost. Self-contact of parts thinner than a quarter of an element size is not supported.
- **Cost.** One search per pair and direction per step (a uniform grid of the master's faces), then the same Newton and conjugate-gradient iteration as a lone solid. The stack of three cubes (318 nodes) takes 38 ms per step in Node on the loaded shared machine, 9 times slower than real time at 240 Hz; the Hertz pair with 9826 nodes 23 s for the static solve.
- **Scene format.** `solids[].contact.solids` names the other solids a solid collides with, `contact.self` its self-contact, `contact.friction` the coefficient ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#coupled-sections-solids-and-heat)); the Lab runs `lab.html?example=soft-blocks`.

## Reproduce

```sh
npm run test:kit
npm --prefix packages/box3d-kit run build
node --test --test-reporter=tap packages/box3d-kit/test/v17-solid-contact.test.mjs   # prints the measured numbers
node --test --test-reporter=tap packages/box3d-kit/test/v22-solid-solid-contact.test.mjs   # deformable against deformable
npm --prefix packages/box3d-kit run clean
npm run validation:check
```
