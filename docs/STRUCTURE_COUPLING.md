# Cables and frames coupled to rigid bodies

`StructureCoupling` (`src/engine/structure-coupling.ts`, kit subpath `box3d-webgpu-kit/structure`, backend id `rigid-structure-coupling-schur-proxy-js-f64-v1`) attaches the cable solver ([`COMPLIANT_CABLE.md`](COMPLIANT_CABLE.md), [`NONLINEAR_CABLE.md`](NONLINEAR_CABLE.md)) and the frame solver ([`FRAME_MECHANICS.md`](FRAME_MECHANICS.md)) to bodies of a rigid world, both ways. A cable end follows a point on a body and pulls on it; a frame node carries a body and feels its weight and inertia; a cable can hold a frame. Units are SI, the coupling's own state is float64, and a run repeats bit for bit.

It is validated by `packages/box3d-kit/test/v11-structure.test.mjs` (14 tests, in the kit gate). The numbers below are from that file at 240 Hz with 4 rigid substeps unless a row says otherwise.

## What can be attached

| Call | Meaning |
|---|---|
| `attachCableToBody(cable, node, body, {inertia, localPoint?})` | A free cable node follows a point fixed on the body. The cable's pull acts on the body at that point, so off-centre it also turns the body. Both ends of a cable may be on bodies (a tether). A static or kinematic body is a moving anchor and feels nothing. |
| `attachCableToFrame(cable, node, frame, frameNode)` | A free cable node follows a frame node and pulls on it. |
| `attachFrameToBody(frame, frameNode, body, {mode, inertia, localPoint?})` | `'pinned'`: forces only, the body may turn about the node. `'clamped'`: forces and moments, the body turns with the node. A kinematic body prescribes the node's motion. |
| a cable node that is `pinned` in the cable definition | The world: a fixed anchor, as before. Its reaction is in the cable snapshot. |
| `detach(attachment)` | Removes one attachment. A cable node gets its own mass back. |
| `prime(attachment, force, moment?)` | Says what an attachment already carries when it is made: the pull of a cable's segments on the attached node, or the force (and, clamped, the moment) of the frame on a body. See "Starting loaded" below. |

A body that rests on a frame is expressed as an attachment to a frame node. Loads move along a deck by detaching and re-attaching at the next node.

The world reports a body's mass but not its rotational inertia, so every body attachment states it: `{kind: 'box', halfExtents}`, `{kind: 'sphere', radius}`, `{kind: 'capsule', radius, halfLength}`, `{kind: 'principal', moments}` or `{kind: 'locked'}`. The body's position must be its centre of mass, which holds for the kit's single-shape bodies.

## Stepping order

```
coupling.step();   // 1. closes last step's frame impulse, reads the bodies at t
                   // 2. frames: midpoint velocity under their own loads
                   // 3. cables, in the order added: proxies, cable step, tensions
                   // 4. all frame <-> body constraints, one dense solve
                   // 5. bodies: cable forces for the coming step, first half of the frame impulse
                   // 6. frames: finish the tick with the interface loads
world.step();      // the rigid solver integrates the bodies from t to t + dt
```

One call per fixed step, immediately before `world.step()`, or register the coupling with a `Simulation` (`structureSubsystem`, [`SIMULATION.md`](SIMULATION.md)), which does that for you and runs it before a water coupling. The coupling steps the cables and frames it was given; do not step them yourself. `coupling.dt`, the world's fixed step, every cable's `dt` and every frame's `dt` must be equal, and a coupled frame needs `substeps: 1`.

Between `world.step()` and the next `coupling.step()`, the velocity of a body attached to a frame lacks the closing half of that step's frame impulse (step 1 applies it). `diagnostics()` adds it back.

The response of a frame to its interface impulses is a dense product over all attached nodes. A cable or body attachment that asks about its own node forms only that node's six rows (the same sums, so the same bits); only the closing pass of a step forms them all. On the SI bridge, with 29 attached nodes and 34 attachments, that took a step from 4.05 ms to 2.70 ms with identical results.

`step()` allocates nothing of its own: all scratch is created by the constructor and the `attach` calls. The frame's CG and the kit's `getState()` and `applyForce()` allocate small temporaries as they always have.

## The scheme, and why

Naive staggering lets the body's motion drive the structure and returns the structure's reaction to the body one step later. That is an explicit step of a spring of stiffness `k` on the body's mass `m`, unstable once `dt² k / m` exceeds about 4. A 1 g body on a cable of `EA = 10⁷ N` has `dt² k / m = 1.7·10⁵` at 240 Hz. The option `scheme: 'naive-staggered'` exists only so that the test can show this failure.

The coupling instead solves each attachment with the effective mass of both sides, and uses the solver that suits each structure.

Write `G` for a carrier's response: the velocity change of the attachment point per unit impulse there, over one step.

- **Body:** `G = M_aug⁻¹` seen at the point, `v_point = V + ω × r`. `M_aug` is the 6×6 mass matrix of the body together with the lumped end masses of every cable attached to it (they ride on the body), rebuilt and inverted each step at the current orientation.
- **Frame:** the frame's step is the midpoint rule, `A v_mid = M v + (h/2)(f − K u)`, `A = M (1 + c h/2) + (h²/4) K`, `v⁺ = 2 v_mid − v`. An impulse `J` on a degree of freedom changes the end velocity by `A⁻¹ J`. The columns of `A⁻¹` for the attached nodes are solved once per attachment by the frame's own CG; `W` is their block on the interface, and `W_aug = (1 + W M_r)⁻¹ W` folds in the cable end masses `M_r` riding on the nodes. `A` already contains the frame's stiffness, so a stiff frame is a heavy carrier.

### Cable ↔ carrier: a proxy node

Each step the attached cable node is overwritten to stand for the carrier point:

```
position, velocity   = the carrier point's, read at t
mass      m̂          = 1 / (dᵀ G d)        d = unit vector along the cable segment at the node
applied force        = m̂ (Δv_free / h − g_cable)
```

`Δv_free` is how the point's velocity would change over the step without this cable: gravity, the weights of the end masses, and the newest estimate of every other interface impulse on the carrier. The cable's own implicit solve (XPBD or the proximal solver, both unconditionally stable) then finds the tension against a node that resists exactly as the carrier would. The impulse of the cable on the node is `J_c = m̂ (v̂⁺/D − v̂ − Δv_free)` (`D` is the cable's drag factor, 1 without drag). Once every impulse is known the carrier's motion `Δv` follows from `G`, and each cable end hands its carrier

```
J = J_c + m_n (h g_cable − Δv_point)
```

the pull, plus the weight and inertia of the node's own lumped mass `m_n`. The same `J_c`, reversed, is what the cable's other nodes felt, so momentum passes between cable and carrier without loss. For a body the force `J / h` and its torque act through `world.step()` together with gravity, so a body hanging at rest is exactly at rest.

A node with two segments (an interior node) uses the larger `dᵀ G d` of the two. That is exact when `G` is isotropic (an attachment at the centre of mass) and errs on the soft side otherwise.

### Frame ↔ body: an interface (Schur) solve

A pinned attachment is three equations, a clamped one six: the body point (and, clamped, the body's rotation) must leave the step with the node's velocity. With `J` the impulse on the body and `−J` on the node,

```
(T M_aug⁻¹ Tᵀ + W_aug) J = −( w_free + β gap / h + Δv_free,body / (2 n) )
```

`T` maps the body's twist to the point, `w_free` is the relative end velocity without `J`, `gap` the position (and rotation) mismatch read from the poses, `β` the Baumgarte factor (default 0.2), and the last term removes the known lead of the rigid solver: with `n` substeps of symplectic Euler it moves a falling body `h Δv / (2 n)` further than the midpoint rule. All frame ↔ body constraints are solved together by one dense Cholesky factorisation (at most 96 equations), so several bodies on one frame, or one body on several nodes, are coupled exactly.

The impulse reaches the body as two half kicks, one before `world.step()` and one after it (applied at the start of the next `coupling.step()`). The body's share of the interface work is then `J · (v + v⁺)/2`, a midpoint rule like the frame's, and the pair conserves energy to second order. Applying `J` as a force through the step instead makes the body's position update `x + h v⁺` while the frame's is `u + h (v + v⁺)/2`: stable, but it damps the fundamental at `ω² h / 2` per second (0.33 /s for the cantilever below), which is why it was not used.

The frame gets the interface loads as nodal forces for the tick; its midpoint velocity is corrected by `(h/2) A⁻¹` times those loads using the stored columns, so the frame is solved once per step.

### Several attachments on one carrier

Cables are solved one after another in the order they were added, then all frame ↔ body constraints. Each solve sees the impulses already computed this step and last step's values for the rest: one Gauss–Seidel sweep per step. The fixed point is the coupled solution, so statics are exact; the transient error is one step of lag between attachments.

### Starting loaded

A step uses last step's impulses of the other attachments on the same carrier, and a new attachment has none. On a structure that is built already loaded (a deck hanging from sixteen stays, each pulling hundreds of kilonewtons) the first step then misjudges every attachment at once, which is a blow: on the SI bridge ([`SI_BRIDGE.md`](SI_BRIDGE.md), 8 stays) node speeds of 0.125 m/s, 3 kN of tension error and a 5 kJ jump in energy, left ringing in the frame's stiff modes. `prime(attachment, force)` replaces that zero with the force the attachment carries in the state the structure was built in; with it the same bridge starts with node speeds of 10⁻⁴ m/s. It only sets the remembered impulse: it changes nothing once a step has been taken, and nothing if it is never called.

A body that rests on a frame node has, at the moment the coupling reads it, the velocity `g dt / (2 n)` upwards (`n` rigid substeps): the half kick before `world.step()`, gravity, and the allowance for the rigid solver's lead add up to that. A body created with zero velocity starts with a jolt of that size; give it that velocity instead.

Handing an attachment over (detach, re-attach elsewhere on the same node) is the same case: prime the new attachment with the force the old one reported. The bridge's vehicle is moved that way every step.

## Hooks added to the existing solvers

Additions only. `step()`, `substep()`, `solveStatic()`, checkpoints and every existing numeric path are untouched: 14 checkpoint and snapshot hashes of cable and frame runs (both cable backends, with and without substeps, with force and impulse commands) are identical before and after, and the existing 52 engine tests pass unchanged.

| Solver | Hook | Purpose |
|---|---|---|
| `CompliantCableRuntime` | `advance()` | One tick with no commands, validation or snapshot: the same per-tick sequence as `step()`. |
| | `couplingViews()` | Live `positions`, `velocities`, `masses`, `pinned` arrays to read. |
| | `driveNode(node, p, v, mass, force)` | Overwrite one free node's state, mass and applied force (the proxy). |
| `FrameRuntime` | `couplingViews()` | Live `rest`, `displacements`, `velocities`, `fixed` arrays to read. |
| | `solveCoupledOperator(dof, out)` | One column of `A⁻¹` by the runtime's CG. |
| | `beginCoupledTick()` | First half of a tick: the midpoint velocity under the present loads, returned live. |
| | `finishCoupledTick(extra)` | Second half: the same update as `substep()`, with interface loads `extra` added to the nodal forces. |

While a cable node is attached, the cable's own `inspect()` and `checkpoint()` show it with the effective mass it borrows and the force that models the carrier. `coupling.diagnostics()` reports energy and momentum with the node's own mass. The coupling has no checkpoint of its own.

## Stability: analysis and measured limits

**Cable proxy.** For one attachment the cable step and the body step compose to `v⁺ = v + h a(x + h v⁺)`, `x⁺ = x + h v + ((n+1)/2n) h² a`: an implicit-Euler force with the rigid solver's position update. For a spring of frequency `ω` the step matrix has determinant `(1 + q (n−1)/(2n)) / (1 + q)`, `q = ω² h²`, below 1 for every `q`: unconditionally stable, and damped at about `(n+1)/(4n) ω² h` per second. The pendulum test loses 23.5% of its swing energy in 20 s, against 22.6% from this rate.

**Frame interface.** With the velocity constraint and Baumgarte factor `β` the gap obeys `g⁺ = g − (β/2)(g + g_previous)`, roots of `z² − (1 − β/2) z + β/2`, stable for `0 < β < 2`. Measured on the cantilever: `β` = 0.02, 0.2, 1 and 1.9 all give the same frequency to 1e-5 and the same gap.

**Gauss–Seidel lag.** For two stiff cables on one body at an angle with cosine `c`, the lagged impulse obeys `z² − 2c² z + c² = 0`, `|z| = c < 1`.

Measured, all with the coupled scheme:

| Case | Range tried | Result |
|---|---|---|
| A ball on one cable segment, released | mass 4·10⁻⁹ to 0.84 kg, `EA` 10³ to 10⁹ N, `dt² k / m` from 0.02 to 4·10¹² | all stable; the ball never strays beyond twice the static stretch (asserted) |
| The same, naive staggering | 1 g, `EA` 10⁷ N, `dt² k / m` = 1.7·10⁵ | strays 1.9 m with tensions of 6·10⁷ m g |
| A ball clamped to a 4 kg cantilever tip | mass 3·10⁻⁸ to 3.4 kg | all stable (asserted) |
| The same, naive staggering | 34 g | non-finite within 11 steps |
| A light body on 2, 3 or 4 separate cables | 4 g to 4 kg, `EA` 10⁶ to 10⁹ N, 240 and 60 Hz | stable; the cables carry `m g` between them to 4·10⁻⁵ |
| Two stays on a steel deck | `EA` 5·10⁶ to 5·10⁹ N (`dt² k / m_eff` up to 3.5·10³), 240 and 60 Hz | stable; tension noise 0.6 N at 240 Hz and 3.2 N at 60 Hz on 660 N |
| Six and seven stays on the same deck | `EA` 5·10⁶ and 10⁹ N, 240 and 60 Hz | bounded (deck displacement within 0.8 mm); at 10⁹ N the individual tensions are not smooth, because the deck's ringing (below) is larger than the stays' stretch |
| Cantilever with tip ball, step size | 60, 120, 240, 480 Hz | frequency error −1.08%, −0.34%, −0.15%, −0.10% (second order, to a −0.09% floor that is the ball's rotary inertia); gap 1.7·10⁻⁴, 4.3·10⁻⁵, 1.1·10⁻⁵, 2.7·10⁻⁶ m |

The first five rows and their assertions are in the test; the last three rows are measurements made while writing it and are not asserted.

No unstable case of the coupled scheme was found. Limits that are not about stability:

- **The cable solver's own convergence.** A heavy body on a light cable with many segments needs many Gauss–Seidel iterations in the cable solver: 8.4 kg on a four-segment cable with 25 g nodes with `EA = 10⁶ N` used all 2048 proximal iterations while swinging. The coupling gives the node a large mass; it does not make the cable solver converge faster. Read `unconvergedSubsteps` in the cable diagnostics. One or two segments, or a heavier cable, converge in a few iterations.
- **Frame ringing.** The midpoint rule does not damp the frame's stiffest modes. After a sudden load they ring at the step frequency with velocities near 10⁻³ m/s, with or without the coupling, and a reaction read at one instant carries that. The tests read reactions and stay tensions as means over a quarter or half second.

## What is conserved

| Quantity | Status |
|---|---|
| Momentum between a cable and its carriers | The impulses handed to the carriers, the momentum change of the cable's other nodes and of the end masses sum to zero each step. Measured residual 8·10⁻¹³ kg m/s per step (float64). |
| Momentum in the rigid solver | The rigid solver integrates in float32. Tether test: 1.2·10⁻⁵ kg m/s change on 4.1 over 4 s. |
| Centre of mass | Follows from momentum, but the rigid solver moves a body by `h (v + (n+1)/(2n) Δv)` and the cable a node by `h (v + Δv)`, so while momentum `ΔP` is passing between them the centre of mass is off its line by up to `(n−1)/(2n) h ΔP / M`. Tether test: 1.1·10⁻⁴ m, not growing. |
| Energy, frame ↔ body | No numerical dissipation in the coupling or the frame. The rigid solver's symplectic-Euler gravity makes the total oscillate. Cantilever with tip ball, 65 periods: within 1.6% of the swing energy at every sample, drift between the two halves of the run −7.6·10⁻⁵, swing amplitude 0.049706 → 0.049683 m. |
| Energy, cables | Never grows; falls at the implicit-Euler rate given above. Largest rise between samples in the pendulum and bounce tests: 0. |
| Angular momentum | Not checked. The frame is a small-rotation model and reports a linearised angular momentum only. |

## Validation

| Check | Expected | Measured | Tolerance and why |
|---|---|---|---|
| Ball on a cable at rest: force on the ball | `m g` = 82.18407 N | error 1.4·10⁻⁶ (proximal, 8 segments), 3.6·10⁻⁷ (2 segments), −8.4·10⁻⁶ (XPBD, 4 × 4 substeps) | 10⁻⁵ (10⁻³ XPBD): residual motion after settling |
| … stretch | `m g L/EA + ρ g L²/(2 EA)` = 1.7418 mm and 0.17418 mm | error 1.1·10⁻⁷ m | 5·10⁻⁷ m: two float32 ulps of a position near 2 m |
| … support reaction | `(m + ρ L) g` | error 1.2·10⁻⁶ | 10⁻⁵ |
| Pendulum, stiff cable, 0.1 rad | `2π √(L/g) (1 + θ₀²/16)` = 2.83878 s | 2.83881 s (1.1·10⁻⁵) | 0.3%: `O((ω dt)²)` of the cable step and the damped amplitude |
| Spring pendulum bounce | `√(k/(m + m_c/3)) / 2π` = 3.46393 Hz | −0.31% at 240 Hz, −0.094% at 480 Hz, −0.037% at 960 Hz | 1%, 0.3%, 0.15%, and the error must fall with the step: the cable step is first order |
| Tether in zero gravity | momentum constant | see the table above | 10⁻¹² (coupling, float64), 5·10⁻⁵ kg m/s (float32), 3·10⁻⁴ m (centre of mass) |
| Off-centre cable, at release | `T = m g / (1 + m a²/I)` = 85.6145 N | 85.5896 N (−2.9·10⁻⁴) | 2·10⁻³: a cable of `EA = 10⁹ N` gives way by `m_eff / (dt² k)` = 5·10⁻⁴ in the first step |
| … torque | `α = (r × F) / I` | error −3.8·10⁻⁸ | 10⁻⁵: one float32 velocity |
| … at rest | turned `atan(a / h_y)` = 1.107149 rad, centre of mass under the attachment | 1.107152 rad; 6·10⁻⁷ m apart | 10⁻³ rad, 10⁻⁴ m: what is left of the damped swing |
| Ball clamped (and pinned) to a cantilever tip, static | `m g L³/(3 E I) + w L⁴/(8 E I)` = 24.80313 mm | error 3.2·10⁻⁸ (clamped), 3.5·10⁻⁸ (pinned) | 10⁻⁶: cubic elements are exact for both loads; CG stops at 10⁻⁹ N |
| … wall force and moment | `(m + m_b) g`, `m g L + m_b g L/2` | 80.3320 N, 121.4241 N m, both to 6 digits | 10⁻⁵ as half-second means |
| … fundamental frequency | Rayleigh `√(3 E I / ((m + 0.2357 m_b) L³)) / 2π` = 3.33262 Hz; exact tip-mass root 3.33096 Hz | 3.32590 Hz: −0.20% and −0.15% | 0.5% and 0.3%: the ball's rotary inertia (−0.09%, in neither formula) and `(ω dt)²/12` of the midpoint rule |
| Ball pinned at midspan of a simply supported beam | `m g L³/(48 E I) + 5 w L⁴/(384 E I)` = 41.71903 mm | error 1.9·10⁻⁷ | 10⁻⁶ |
| … reactions | `m g/2 + w L/2` = 108.58281 N each | 108.58296 N both | 10⁻⁵ as half-second means |
| Ball on a cable on a cantilever tip | tip deflection under `(m + m_cable) g`; wall carries everything | deflection error −1.5·10⁻⁶; wall 82.2939 N of 82.2940 | 2·10⁻⁵: the ball's float32 pose feeds a 10⁶ N cable |
| Kinematic hook pinned to a cantilever tip, raised 10 mm | tip follows; hook carries `3 E I d/L³ + 3 w L/8` = 37.215 N | tip on the hook to float32; force error −4.5·10⁻⁶; node trails the moving hook by 1.2·10⁻⁴ m | 10⁻⁶ m; 2·10⁻⁵ as a half-second mean |
| Cable-stayed span, ball at each of 7 deck nodes | stay tensions and deflection under the ball from a flexibility-method hand solution | worst error: tension 1.1·10⁻⁴, deflection 1.5·10⁻⁴ | 2·10⁻⁴: the hand solution linearises the stay geometry |
| … total vertical reaction | total weight 1384.97 N at every position | worst error 1.7·10⁻⁵ | 5·10⁻⁵ as quarter-second means |
| Light body on a stiff structure | naive staggering fails, the coupling holds | see the stability table | asserted |
| Determinism | bit-identical repeat | identical: 1312 bytes of frame, cable and body state, the world hash and the energy | exact |

The cable-stayed span is an 8 m steel deck (8 elements, `EI` = 6·10⁵ N m², 125.6 kg) on a pin and a roller, with two stays (`EA` = 5·10⁶ N) from a fixed tower top 3 m above midspan to the deck at 2 m and 6 m, and a 14.1 kg ball pinned to the deck. The hand solution treats the deck as a simply supported beam (point-load influence function, self-weight deflection, axial shortening from the stays' horizontal pulls) and each stay as a spring along its chord: two compatibility equations for two tensions.

## What is not modelled

- **Contact between bodies and members.** A free body does not collide with a cable or a beam. A body loads a frame only through an attachment to a node. Cables have no collisions at all.
- **Cable bending and torsion.** Cables are axial and tension-only; an attachment transmits force, never a moment.
- **Frame nonlinearity.** The frame is linear: small strains and rotations, no buckling, yielding or geometric stiffness. A clamped body's rotation is compared with the node's small-rotation vector, so it is meaningful for small rotations only.
- **Other constraints on an attached body.** The interface uses the body's free response: its mass, inertia and gravity. Contacts and joints acting on the same body are not in it. The error is bounded by the distance gravity moves a body in a step, `g dt²` = 0.17 mm at 240 Hz. Measured with a 32 kg box resting on the ground under a cable to a fixed hook: with 1 mm of slack the tension is 0, as it should be; exactly taut it is 97 N (`EA` = 10⁶ N) to 221 N (10⁸ N) where the true value is about 0; lifting the box by raising the hook then gives the correct 314.4 N and the box follows the hook. Do not read small tensions from a cable whose body is also held by a contact. Water forces are in the same position: for a floating body on a cable the tension is high by the cable end mass times `B / m` and the draught off by `B dt²/ m` ([`SIMULATION.md`](SIMULATION.md#water-and-structure-together): 0.73 N of 1337 N and 0.46 mm on the moored buoy).
- **Sleeping.** The coupling does not wake bodies. Create attached bodies with `neverSleeps: true`.
- **Gyroscopic terms and step-size changes.** The body's response is linearised over the step. `dt` is fixed.
- **Attachment points between nodes.** A cable or a frame is attached at a node. Split the element to attach elsewhere.
- **Checkpointing.** The coupling's own state (last step's impulses and the pending half kick) is not saved. A scene file saves the cables' and frames' fields ([`SCENE_FORMAT.md`](SCENE_FORMAT.md#save-and-resume)); a resumed deck differs from the original by 4·10⁻⁷ m after one second.
- **Forces too small for a float32.** The coupling hands the world float64 forces, and the world refuses a nonzero component below the smallest float32 (about 1.4·10⁻⁴⁵). It happened with a cable attached at a body's centre without `localPoint` on a floating body: state `localPoint: [0, 0, 0]` there.
- **A rigid body on two nodes is a strut.** A body pinned to two frame nodes holds them at a fixed distance, so it also carries axial force between them. On the SI bridge this raises a stay tension by up to 8·10⁻⁴ in its hand case.
- **Steady-state bias.** With both ends of a cable on one frame, the state at rest differs from the static solution by an amount that falls with the step: 2.9·10⁻⁴, 9.6·10⁻⁵, 3.1·10⁻⁵ and 9.8·10⁻⁶ of a stay tension at 60, 120, 240 and 480 Hz on the SI bridge. The cause was not isolated.
