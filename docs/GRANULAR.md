# Granular media

`Granular` (`src/engine/granular.ts`, kit subpath `box3d-webgpu-kit/granular`, solver id `granular-dem-soft-sphere-verlet-js-f64-v1`) is a discrete element solver in SI units: spherical grains of any radii that overlap slightly where they touch, with a normal law, a tangential spring with history under Coulomb's limit, and rolling resistance. Walls are planes, boxes, spheres, capsules and shells of revolution (a silo, a hopper, a floor with an orifice), fixed or moving. `GranularCoupling` (backend id `rigid-granular-coupling-subcycled-js-f64-v1`) joins the grains to the rigid world both ways, and `granularSubsystem` plugs either into the one stepping loop ([`SIMULATION.md`](SIMULATION.md)). It is the granular item of Phase 3 of the [roadmap](ROADMAP.md).

It is a new model beside the app's granular scenes, which are rigid bodies of the Box3D world. This one resolves every contact with a force law and a small time step, so that its numbers can be checked; it is slower for the same count of grains: see [Cost](#cost).

Values in this document marked "from memory" are recalled, not checked against a source that was opened while writing.

## Contents

- [The model](#the-model)
- [Time integration and the stable step](#time-integration-and-the-stable-step)
- [Walls](#walls)
- [Neighbour search](#neighbour-search)
- [Energy ledger](#energy-ledger)
- [Two-way coupling](#two-way-coupling)
- [In the stepping loop](#in-the-stepping-loop)
- [Validation](#validation)
- [Cost](#cost)
- [Limits](#limits)

## The model

A grain has a position `x`, a velocity `v`, an angular velocity `ω`, a radius `r`, the mass `m = (4/3) π r³ ρ` and the inertia `I = (2/5) m r²`. Its orientation is not stored: a sphere's forces do not depend on it. State is float64.

Two grains `i` and `j` interact only while they overlap, `δ = r_i + r_j − |x_i − x_j| > 0`. With the unit normal `n` from `j` to `i`, the contact point in the middle of the overlap, and

```
R* = r_i r_j / (r_i + r_j)        m* = m_i m_j / (m_i + m_j)
E* = E / (2 (1 − ν²))             G* = G / (2 (2 − ν)),   G = E / (2 (1 + ν))        (both grains of the same material)
u  = v_i − v_j + ω_i × l_i − ω_j × l_j     relative velocity of the contact points, l_i = −(r_i − δ/2) n, l_j = (r_j − δ/2) n
```

the force on `i` is `F_n n + F_t` and the force on `j` its opposite. A wall is a grain of infinite radius (`R* = r`, or `r R / (r + R)` against a sphere or capsule of radius `R`) and, unless it is dynamic, infinite mass (`m* = m`); the contact point is on the wall's surface.

### Normal force

```
'hertz'   F_n = k_H δ^(3/2) + α sqrt(m* k_H) δ^(1/4) δ'        k_H = (4/3) E* sqrt(R*)
'linear'  F_n = k_n δ       + α sqrt(m* k_n) δ'
F_n is set to zero when the sum is negative: a contact never pulls.
```

`δ' = −u·n` is the closing speed. Both dashpots give a restitution that does not depend on the impact speed (substituting `δ = L x`, `t = T τ` with `L / T` the impact speed removes the speed from either equation). The coefficient `α` is not taken from a formula. At construction the solver integrates the dimensionless impact `x'' = −max(0, x^p + α x^((p−1)/2) x')` (`p = 3/2` or `1`) with a fourth-order Runge–Kutta rule and bisects on `α` until the rebound speed is the restitution asked for (`granularDampingCoefficient(e, law)`). The textbook coefficients assume a contact that may pull at the end of the impact, which costs extra energy; with the clamp the same restitution needs more damping. For `e = 0.5` the linear law needs `α = 0.511` where `2ζ` with `e = exp(−π ζ / sqrt(1 − ζ²))` gives 0.431, and the Hertz law needs 0.571 where the form `2 sqrt(5/6) β sqrt(S_n m*)` common in DEM codes (from memory) corresponds to 0.482.

The `linear` law is cheaper per contact (no square roots for the stiffness) and its stiffness is a number you choose; it is the usual choice for bulk flow. The `hertz` law takes the material's Young's modulus and Poisson's ratio.

### Tangential force

A spring that remembers the contact's tangential displacement `ξ`, with a dashpot, under Coulomb's limit:

```
ξ  ←  ξ turned into the tangent plane (length kept)  +  u_t dt          u_t = u − (u·n) n
F_t = −k_t ξ − c_t u_t
if |F_t| > μ F_n:   F_t ← μ F_n F_t / |F_t|,   ξ ← −F_t / k_t          (sliding: the spring is cut back)

'hertz'   k_t = 8 G* sqrt(R* δ)      (Mindlin's no-slip stiffness at the current overlap)
'linear'  k_t = (2/7) k_n by default (`tangentialStiffnessRatio`)
c_t = tangentialDamping · α sqrt(m* k_t)       (`tangentialDamping` is 1 by default; 0 leaves the spring undamped)
```

The torque on `i` is `l_i × F_t` and on `j` it is `l_j × (−F_t)`. The history is kept per neighbour-list entry and carried across rebuilds of the list; it is cleared when the grains part.

The Mindlin spring is the simplified one used by most DEM codes: the stiffness follows the current overlap and the displacement is kept. It is not exactly elastic while the normal load changes; the energy ledger books that difference under friction.

### Rolling resistance

Spheres on a flat floor roll for ever, and a pile of them is flatter than a pile of real grains. Rolling resistance is an elastic-plastic spring on the relative rolling rotation `θ`:

```
θ   ←  θ turned into the tangent plane  +  ω_roll dt        ω_roll = (ω_i − ω_j) − ((ω_i − ω_j)·n) n
M_r = −k_r θ,   k_r = k_t R*²
if |M_r| > μ_r R* F_n:   M_r ← μ_r R* F_n M_r / |M_r|,   θ ← −M_r / k_r
```

`M_r` acts on `i` and `−M_r` on `j`. `μ_r` (`rollingFriction`) is dimensionless. Spin about the contact normal (twisting) is not resisted.

### Materials and walls

One material describes all grains: density, restitution, friction, rolling friction and, for `hertz`, Young's modulus and Poisson's ratio. A wall takes the grain's elastic constants and may override friction, rolling friction and restitution for its own contacts (`addWall({friction, rollingFriction, restitution})`).

## Time integration and the stable step

Velocity Verlet with one force evaluation per step:

```
v ← v + (dt/2) (F/m + g)      ω ← ω + (dt/2) T / I        x ← x + dt v
contact forces at the new x, with the half-step velocities in u and in the histories
v ← v + (dt/2) (F/m + g)      ω ← ω + (dt/2) T / I
```

It is second order in `dt` (measured: [Validation](#validation)).

The step must be a fraction of the shortest contact time in the system. The solver uses one **critical time** per law, for the smallest grain:

| Law | Critical time `t_c` | `dt` refused above |
|---|---|---|
| `hertz` | the Rayleigh time `π r sqrt(ρ / G) / (0.1631 ν + 0.8766)` (formula from memory; `rayleighTime()`) | `0.4 t_c` |
| `linear` | the duration of an impact of two such grains, `π sqrt(m* / k_n)` with `m* = m / 2` | `0.2 t_c` |

`addGrain` throws `EngineError('UNSTABLE_TIME_STEP')` when `dt` exceeds the limit for the grain being added and says which step would be accepted. With `allowUnstable: true` the grain is accepted, `stats.unstable` is raised and the subsystem emits one `unstable-step` event. `timeStepFraction` holds `dt / t_c` and `maxTimeStepFor(radius)` the largest accepted step. A run that produces a position that is not a number stops with the same error code.

The limits are where explicit integration of one contact is still stable with a margin (`ω dt` is 0.63 for the linear law at its limit, against a stability bound of 2; for the Hertz law the stiffness grows with the overlap, and an estimate gives `ω dt` about 0.75 at an overlap of 10% of the radius), not where it is accurate. The validation uses 1% to 2% of `t_c` for two-body closed forms, and 10% to 17% for bulk cases. With `dt = 0.1 t_c` the restitution of a two-grain impact is within 0.006 of the value set for the Hertz law and within 0.03 for the linear law (0.013 and 0.07 at `0.2 t_c`), and the energy ledger of a poured Hertz bed closes to 0.12% of the energy dissipated.

Hertz contact time, for reference (`hertzContactDuration`): an elastic impact at speed `v` lasts `2.9433 δ_max / v` with `δ_max = (15 m* v² / (16 E* sqrt(R*)))^(2/5)`; the factor is `(4/5) B(2/5, 1/2)`, checked by quadrature in the test.

## Walls

```ts
g.addWall({shape, type: 'static' | 'kinematic' | 'dynamic', position, rotation, linearVelocity, angularVelocity, mass, inertia, friction, rollingFriction, restitution});
```

| Shape | What it is |
|---|---|
| `{kind: 'plane', normal}` | the half space behind a plane through the wall position; grains live on the normal's side |
| `{kind: 'box', halfExtents}` | a solid box |
| `{kind: 'sphere', radius}`, `{kind: 'capsule', radius, halfLength}` | solid, axis of the capsule along the wall's local Y |
| `{kind: 'cylinder', radius, from, to, axis?}` | a thin cylindrical shell about `axis` (default Y) between two axial coordinates: a silo wall, touched from either side |
| `{kind: 'annulus', innerRadius, outerRadius, offset?, axis?}` | a thin flat ring: a floor with an orifice |
| `{kind: 'frustum', r0, z0, r1, z1, axis?}` | a thin shell of revolution generated by a straight line: a conical hopper |

The three shells are one primitive: the nearest point of a line segment in the grain's meridian plane, turned about the axis. A shell has no thickness; a grain that passes through it by more than its radius in one step ends on the other side, which a stable step does not allow.

A **kinematic** wall moves with the velocities it is given (`setWallVelocity`), a **dynamic** wall (box, sphere or capsule) has a mass and principal moments and is integrated with the grains under gravity, the grains' forces and `setWallExternalLoad` (no gyroscopic term). `setWallEnabled(index, false)` removes a wall: a gate. For every wall the solver keeps the force and the moment about its position at the last force evaluation (`wallForce`, `wallTorque`), their time integrals (`wallImpulse`, `wallAngularImpulse`, `resetWallImpulses`), the sum of the normal-force magnitudes (`wallNormalLoad`) and the number of touching grains.

`config.bounds` removes grains whose centre leaves a box; `stats.removed` and `stats.removedMass` count them, which is how a discharge is measured.

## Neighbour search

A uniform grid with cells of the largest grain diameter plus the skin (`config.skin`, half the smallest radius by default) over the bounding box of the live grains, filled by a counting sort. Each grain lists the grains of higher index within `r_i + r_j + skin`, and the walls within `r + skin` (a moving wall is always listed). The list is rebuilt when any grain has moved half the skin since the last build. A listed wall is not measured again while it is certainly out of reach: each wall candidate keeps a lower bound of its gap (the distance less the radius at its last measurement, less a margin of 1e-12 of the coordinates for rounding), from which each step subtracts the farthest any grain moved (the largest |v|₁ h) and the farthest any point of that wall's surface moved (its translation, plus 2 |q − q'| times the radius of a sphere holding the surface for a turn; a turning plane is measured every step). While the bound is positive the candidate gets exactly what a measured gap gives (no force, no history), so the results do not change; a kinematic gate far above the grains is then not measured every step. Grains are visited in index order and cells in a fixed order, forces are summed in that order, and nothing depends on time or on a random number, so a run repeats bit for bit. A step uses only `+`, `−`, `×`, `÷` and the square root, which IEEE 754 rounds identically on every machine; that it gives the same bits on another machine or JavaScript engine has not been tried.

`granularLattice({min, max, radius: [r0, r1], jitter, seed, inside})` makes a starting arrangement: a cubic lattice with radii drawn uniformly and centres moved by a seeded generator.

## Energy ledger

```
kineticEnergy()          translation and spin
gravitationalEnergy()    −Σ m g·x
elasticEnergy()          normal springs ((2/5) k_H δ^(5/2) or (1/2) k_n δ²) + tangential and rolling springs
dissipatedDamping        ∫ (F_n − F_elastic) δ' dt                         the normal dashpots, and what the clamp drops
dissipatedFriction       −∫ (F_t·u_t + M_r·ω_roll) dt − Δ(tangential and rolling spring energy)      sliding, rolling resistance, tangential dashpots
externalWork             ∫ (F·v_wall + M_r·ω_wall) dt over moving walls − energy of removed grains
energyBalance()          kinetic + gravitational + elastic + dissipatedDamping + dissipatedFriction − externalWork
```

`energyBalance()` is constant up to the time-stepping error. The dissipated energies are integrated from the forces, not taken as what is missing. Each power is formed with the mean of this step's and the previous step's force and the half-step velocity, which is how velocity Verlet does work; that makes the ledger second order (it was first order, 5% of the dissipated energy in a poured bed, with this step's force alone). The kept forces are part of each contact's history: thirteen numbers per neighbour-list entry.

Because the Mindlin stiffness follows the overlap, `(1/2) k_t ξ²` changes when the normal load changes without the contact sliding. That change is inside `dissipatedFriction` (it can be negative for a moment). The linear law has no such term. A grain removed at the bounds takes its kinetic and gravitational energy out through `externalWork`; if it is touching another grain at that moment, the energy stored in that contact leaves the books unrecorded.

## Two-way coupling

The grain step is typically 1e-4 s and the rigid step 1/240 s or longer, so the coupling sub-cycles.

```ts
const coupling = new GranularCoupling(world, g);          // world.loop.step must be a whole number of grain steps
coupling.addBody(body, {shape, friction, inertia});       // say what the body is: the world cannot report shapes
coupling.step(); world.step();                            // every rigid step, in this order
```

`coupling.step()`:

1. reads each coupled body's pose, velocity and mass from the world and writes them to its wall in the solver. A dynamic body is a dynamic wall with the body's mass;
2. advances the grains by `substeps = rigid step / grain step` of their own steps. The dynamic walls move with them under gravity, the grains' forces and the estimated support load (below), so a block landing on a bed is stopped by the contact law at the contact's own time scale, not one rigid step late;
3. hands every dynamic body the mean force and torque of those steps, `impulse / rigid step`, with `world.applyForce` and `world.applyTorque`. The rigid step then integrates the body with that force, and its velocity at the end is the stand-in's.

The impulse a wall accumulates and the impulse the grains receive come from the same force values, so momentum is exchanged exactly in float64; the body's own velocity is a float32 of the rigid world. A component too small for a float32 is handed over as an exact zero (the rigid world refuses such a number; the same rule as in `structure-coupling.ts`).

**Supports.** A body that also rests on the ground or hangs from a joint would, as a free stand-in, fall through the grains during the sub-steps. With `estimateSupports` (default on) the coupling works out from the body's velocity change over the last rigid step what its other contacts and joints did to it, `m (Δv / h − g) − F_grains`, and holds that force on the stand-in. It lags one step and has no torque part.

`coupling.force(body)` and `coupling.torque(body)` are the means over the last rigid step. `twoWay: false` lets the grains feel a body without pushing it. Static and kinematic bodies of the world are walls that follow the world.

## In the stepping loop

`granularSubsystem(target)`:

| Target | Stage, order | Time-step rule |
|---|---|---|
| `GranularCoupling` | `couple`, 160 (after the structure coupling and the cloth, before the water) | the rigid step it was built for must equal the simulation step |
| bare `Granular` | `post`, 500 | its `dt` may be the step, a whole fraction of it or a whole multiple |

Registration fails with `UNSTABLE_TIME_STEP` when the grain step is above the limit. The energy entry has `total` = kinetic + gravitational + elastic, `exchanged` = `externalWork`, and the parts `kinetic`, `potential`, `elastic`, `dissipatedDamping`, `dissipatedFriction`; `balance + dissipatedDamping + dissipatedFriction` is constant. Coupled bodies are not counted: track them with `simulation.trackBody`. Events, at the end of a step: `contact-begin` and `contact-end` with `{body, index}`, `grains-removed` with `{count, mass}`, `overlap` with `{ratio}` when the largest overlap first exceeds a quarter of a radius, and `unstable-step` once.

A run through a `Simulation` is bit-identical to calling `coupling.step(); world.step()` by hand.

## Validation

Measured by `packages/box3d-kit/test/v17-granular.test.mjs` (19 tests in the kit gate) and published as 40 rows of the `granular` domain of [`VALIDATION.md`](VALIDATION.md). The set-ups are in `packages/box3d-kit/test/granular-scenarios.mjs`. Beads are 10 mm (radii 4.5 to 5.5 mm in the bulk cases), density 2500 kg/m³.

Two-body cases use `E = 1e8 Pa`, `ν = 0.3` (Hertz) or `k_n = 1e5 N/m` (linear), and overlaps below 1e-3 of a radius except where stated.

| Case | Reference | Measured error | Tolerance |
|---|---|---|---|
| Hertz contact duration, two grains at 0.1 m/s, `dt` = 8%, 4%, 2% of the Rayleigh time | `2.9433 δ_max / v` | −1.45e-4, −3.7e-5, −9.3e-6 relative: order 1.98 | 5e-4; 5e-5 at 2%; order 2 ± 0.3 |
| the same at 0.01 and 1 m/s (2.8% overlap) | same | −4e-6, −2.3e-5 | 1e-4 |
| Energy during that impact | constant | 4.6e-4, 1.1e-4, 2.6e-5 of the kinetic energy: order 2.10 | order 2 ± 0.2 |
| Linear-spring contact duration | `π sqrt(m* / k_n)` | −4.1e-5 | 2e-4 |
| Momentum of the pair | constant | 0 (below 1e-16) | 1e-13 |
| Restitution, Hertz, e = 0.9, 0.5, 0.2 at 0.1 and 1 m/s, `dt` = 1% | the value set | at most 6.6e-4 absolute | 1e-3 |
| Restitution, linear, same cases, `dt` = 0.2% of the contact time | the value set | at most 1.3e-3 absolute | 2e-3 |
| Oblique impact on a plane, sliding: Hertz e = 1 and e = 0.7 (ψ₁ = 5, μ = 0.3), linear e = 0.6 (ψ₁ = 6, μ = 0.4) | `ψ₂ = ψ₁ − (7/2) μ (1 + e)` | 9.8e-4, 7.7e-4, 2.2e-3 absolute | 5e-3 |
| Oblique impact, sticking, linear springs, no damping, `k_t = (2/7) k_n` | `ψ₂ = ψ₁ cos(π sqrt(7 k_t / (2 k_n))) = −ψ₁` | −2.5e-4 | 2e-3 |
| the same with `k_t = (1/7) k_n` | `ψ₂ = cos(π sqrt(1/2)) ψ₁ = −0.6057 ψ₁` | 2.5e-3 (slip at the very end of the impact) | 5e-3 |
| Oblique impact, sticking, Hertz–Mindlin, ψ₁ = 1 | no closed form here; the rebound must reverse | ψ₂ = −0.352 | −1 < ψ₂ < −0.1 |
| Grain sliding on a 30° incline, μ = 0.1 | `g (sin θ − μ cos θ)` | 1.3e-12 (Hertz), 5e-13 (linear) | 1e-9 |
| Grain rolling on a 30° incline, μ = 0.5, from rest | `(5/7) g sin θ` | −1.9e-4 (Hertz), −1.3e-4 (linear) | 1e-3 |

`ψ` is the tangential velocity of the contact point over the normal impact speed. The sliding and rolling closed forms are for rigid spheres, and the lever arm here is the radius less the overlap: the tangential impulse of a sliding impact came out 4.6% low at an overlap near 7% of the radius, 0.7% low near 1% and 0.1% low near 0.2% (E = 1e7 Pa at 1, 0.1 and 0.01 m/s, measured while developing; the overlaps are estimates). The rows above use a slow impact on a stiffer bead. The sticking formula for linear springs follows from the tangential spring acting on the contact point with the effective mass `(2/7) m`; it is derived here, not quoted.

Bulk cases use the Hertz law with `E = 5e6 Pa` (ledger, column) or linear springs with `k_n = 4000 m g / d = 5.1e3 N/m` (silo, repose, coupling); restitution 0.3 to 0.6, friction 0.5 unless stated.

| Case | Reference | Measured | Tolerance |
|---|---|---|---|
| Energy ledger, 288 beads dropped in a box (friction 0.5, rolling 0.1, e = 0.6), 0.3 s | `K + U + E + D` constant | drift over energy dissipated: 4.9e-3 at `dt` = 20% of the Rayleigh time, 1.2e-3 at 10%: order 2.04; linear law 8.6e-3 at 10% of the contact time | 1e-2, 2.5e-3, order 2 ± 0.6; 2e-2 |
| the same, where the energy went | potential lost = dissipated + what is stored | 0.0251 J lost: 0.0156 J in the dashpots, 0.0089 J in friction | 2% |
| Column of 300 beads at rest, frictionless sides | floor force = weight | +1.4e-4 | 1e-3 |
| Janssen, silo 6 d wide filled in 8 batches to 989 beads | floor load saturates | floor load over weight 0.72, 0.44, 0.33, 0.26, 0.24, 0.16, 0.16, 0.13; the loads after batches 5 to 8 stay within 10.5% of their mean while the fill grows from 617 to 989 beads | last share < 0.2; scatter < 20% |
| Janssen's curve through the eight loads; **fitted: the saturation load `W_s`** | `F = W_s (1 − exp(−W / W_s))` | `W_s` = 1.700 N (the plateau mean is 1.706 N), rms misfit 6.1% of `W_s` | 10% |
| Stress ratio from that fit, `K = D / (4 μ λ)`, with the **measured** mobilised wall friction μ = 0.264 and λ = 4.79 d | `K` read directly: mean wall pressure over floor pressure | 1.18 against 1.05 | 25% |
| Floor + wall load during the descent | the weight | 0.5% | 2% |
| Beverloo, silo 15 d wide, 2603 beads, orifices of 5, 6, 7, 8 d; **fitted: C and k** | `W = C ρ_b sqrt(g) (D − k d)^(5/2)` | C = 0.447, k = 1.14, worst misfit 9.0%; a plain power law through the end points has exponent 2.96 | misfit < 15%; C in 0.35 to 0.75, k in 0.5 to 2.5 |
| Beverloo, independence of fill height: 8 d orifice, level from 13.8 d to 11.3 d | rate unchanged (a liquid: 0.90) | late over early rate 1.037 | 0.92 to 1.12 |
| Angle of repose, (μ, μ_r) = (0.2, 0), (0.5, 0), (0.5, 0.1), (0.5, 0.3): **a trend check** | rises with both | 22.4°, 25.8°, 26.9°, 35.0°; mass left on the ledge 34.9%, 36.6%, 39.9%, 47.7% | monotonic; 15° to 45°; last − first > 6° |
| Rigid block (0.125 kg) at rest on 384 beads | force of the bed = its weight | −6.4e-7 | 1e-5 |
| Floor under bed and block | weight of both | −3.5e-7 | 1e-5 |
| 27 beads strike a free rigid sphere, no gravity | total momentum constant | 1.7e-7 of the momentum exchanged (the body is float32) | 2e-6 |
| the same, beads' momentum change against the impulse handed to the world | equal and opposite | 6e-16 | 1e-12 |
| the same inside the solver, the sphere a dynamic wall | total momentum constant | 4e-16 | 1e-12 |
| 256 beads in a box on a spring scale (a tray on a spring joint, sag 42 mm) | extra load = their weight | 3.6e-9 | 1e-5 |
| Repeat runs: coupled, through the `Simulation` loop, solver alone | bit-identical | identical | exact |
| Glass beads of the material library (ρ 2500 kg/m³, μ 0.12, e 0.926, linear k_n = 4000 m g / d) on the 12 d ledge, mean of three packings; **fitted: rolling resistance 0.06** | Lajeunesse, Monnier & Homsy (2005), Table I: repose 22 ± 0.5° | 22.6° (one packing scatters by about 2°) | ±2.5° |
| Column collapse of those beads (L_i = 8 d, channel 6 d wide, wall friction tan 12.5°, rough floor tan 24.8°, gate removed at once): runout ΔL/L_i at a = 0.47, 0.81, 1.50 | ΔL/L_i = 1.8 a for a ≲ 3 (Lajeunesse et al. 2005: linear from the text, the prefactor read from Fig. 6a) | 0.63, 1.45, 3.16 (−25%, 0%, +17%) | ±30% |
| the same, deposit height at a = 0.47 | H_f / L_i = a for a ≲ 0.7 | 0.46 (−2%) | ±10% |

### What is fitted and what is not

- **Glass beads.** One number is fitted, the rolling resistance (0.06), to the repose angle Lajeunesse et al. measured for their beads; density, friction and restitution are the library's. The column collapse is then a prediction. E. Lajeunesse, J. B. Monnier, G. M. Homsy, *Granular slumping on a horizontal surface*, Phys. Fluids 17 (2005) 103302, read from the author's copy (https://www.ipgp.fr/~lajeunes/download/2005-pof-slumping.pdf): their beads were 1.15 and 3 mm in a channel 45 mm wide (15 to 39 beads), ours are 10 mm in a channel six beads wide; in a ten-bead channel the three runouts were −26%, +16% and +33%. The computed runout rises faster than linearly with a (about a^1.3) in both widths; the experiment's is linear to a ≈ 3. The front is the 99.5th percentile of the grains' leading edges. The rough floor is a plane with friction and rolling resistance tan 24.8° (their bed friction angle); without the floor's rolling resistance the beads rolled 2.6 to 4 times too far.

- **Janssen.** One number is fitted, the saturation load `W_s`, to eight (weight, floor load) pairs. `λ = W_s / (weight per height)` uses the measured fill height. Janssen's formula contains the product `μ K`; the row above takes μ as the measured ratio of the wall's vertical force to the sum of its normal forces (0.264, about half the coefficient of 0.5, because beads at the wall roll as the fill slides down), and compares the resulting `K` with one read directly from the wall and floor loads. `K` near 1.1 is above the 0.4 to 0.6 often quoted for wide silos (from memory). The silo here is six beads wide, the beads are soft and the floor is being lowered; none of these was varied systematically, so the value is reported, not explained.
- **How the silo is loaded.** Each batch is dropped from just above the fill, and after it has come to rest the floor is lowered by half a bead diameter at 2 cm/s, the loads being read during the descent. Without the descent the wall friction is mobilised to 5% to 15% only and the floor reads most of the weight; pouring a tall column in one go leaves wall pressures locked in from the impact (overlaps of 6% to 10%; in a 6 d silo the wall's normal load was 2.4 times what it is after the descent).
- **Beverloo.** Two numbers are fitted, C and k, by a straight line through `W^(2/5)` against `D`. The bulk density is that of the fill at rest between 2 d and 60% of its height, over the whole cross-section (packing 0.565 in the small silo). The usual ranges, C about 0.55 to 0.65 and k about 1 to 2, are typical literature values written from memory. The measured C is below that range in both runs; k is inside it.

### Larger runs, not in the gate

Run once by hand with the same scenario functions; the numbers are not checked by any test.

| Run | Result |
|---|---|
| Beverloo: silo 24 d wide, 12,059 beads, orifices 5 to 10 d, 600 beads per rate (293 s) | rates 0.542, 0.996, 1.612, 2.407, 3.432, 4.881 kg/s; ρ_b = 1462 kg/m³ (packing 0.585); **C = 0.486, k = 1.44**, worst misfit 2.2%; through the 10 d orifice the rate over the last third of 3000 beads is 1.018 of the first third while the level falls from 24.7 d to 19.5 d |
| Janssen: silo 10 d wide, 12 batches to 5247 beads (93 s) | floor loads 4.40, 6.43, 7.07, 7.76, 8.68, 9.94, 10.21, 9.97, 10.08, 8.97, 9.82, 10.57 N for weights from 5.67 N to 67.9 N; fitted `W_s` = 9.77 N (λ = 9.36 d), rms misfit 6.2%; mean of the last six loads 9.94 N, scatter 9.7%; mobilised wall friction 0.252; **K = 1.06** from the fit against 0.83 read directly (22% apart; 0.53 if the friction were fully mobilised) |

## Cost

One thread of a 4-core x86-64 Linux sandbox, Node 22.23, `node scripts/bench-granular.mjs` in `packages/box3d-kit`: a bed ten layers deep of 10 mm beads in a box, poured for 0.3 s and then timed at rest, `dt` = 12% of the critical time.

| Law | Beads | `dt` | Grain-steps per second, pouring / at rest | Beads in real time |
|---|---|---|---|---|
| linear, `k_n = 4000 m g / d` | 1,000 | 1.15e-4 s | 1.5 M / 1.8 M | 176 |
| linear | 7,840 | 1.15e-4 s | 2.6 M / 2.0 M | 227 |
| linear | 64,000 | 1.15e-4 s | 2.3 M / 2.1 M | 243 |
| Hertz, `E = 5e6 Pa` | 1,000 | 6.6e-5 s | 1.8 M / 2.6 M | 121 |
| Hertz | 7,840 | 6.6e-5 s | 2.4 M / 2.3 M | 153 |
| Hertz | 64,000 | 6.6e-5 s | 2.2 M / 1.6 M | 106 |

So about 2 million grain-steps per second (between 1.5 and 2.6 in these six runs, each timed once), nearly independent of the count, with a little over two touching pairs per bead.

"Beads in real time" is the count for which one second of simulation takes one second: the lower of the two throughputs × `dt`. **About 100 to 250 beads of 10 mm run in real time**; a 1/240 s rigid step with 1000 beads coupled works out to about 18 ms (37 grain steps). The count is small because the step is small: these beads are already about a thousand times softer than glass, and a real glass bead of 10 mm (E = 6e10 Pa, from memory) has a Rayleigh time about a hundred times shorter. Larger or softer grains raise the count in proportion to the step.

Memory is about 2.4 kB per bead as allocated: 0.2 kB of state, and room for eight neighbour-list entries and two wall entries per bead at 109 bytes each (thirteen float64 of history), twice, for the carry-over at a rebuild. The lists grow when a packing needs more.

### Threads, and what changed since the table above (2026-11-12)

The contact loop is split in two (`src/engine/granular-kernels.ts`): `demContacts` evaluates every pair and wall candidate of a range of grains into that contact's own slots (force, the two torques, the ledger terms), and `demGather` adds, for each grain, the contributions of the pairs where it is the second grain (in list order), then its own pairs, then its walls: the order in which the single loop added them. The ledger sums are taken afterwards over the pairs in list order, then the walls. Nothing is summed across ranges, so the forces, histories, ledgers and wall loads are the single loop's to the bit whatever the ranges are. `GranularThreads` (`src/engine/granular-parallel.ts`) runs the ranges on helper threads over shared memory (`SharedArrayBuffer`, `Atomics`): `granular.useExecutor(await GranularThreads.create(4, spawnGranularWorker))`, or `nodeGranularWorker` in Node. Runs of grains of about equal work (pairs plus wall candidates) go to the threads; the calling thread takes the first run, then the ordered sums; the neighbour-list rebuild, the integration and the walls stay on the calling thread. On one thread the solver keeps the single loop (`demSerial`, the original arithmetic). The calling thread blocks on `Atomics.wait`, so it must be a worker or Node (`GranularThreads.available()`), and a page needs cross-origin isolation (COOP/COEP) for shared memory.

Checked: `tests/engine/granular-parallel.test.mjs` (in `npm run test:accel`): the Studio tray on 1, 2 and 3 threads, and a Hertz case with rolling resistance, a dynamic sphere, a turning kinematic box and grains leaving the bounds on 3 threads, give the serial result to the bit (positions, velocities, spins, forces, torques, ledgers, statistics, wall loads); a save taken while threaded restores into a one-thread solver and runs on the same. `tests/engine/accel-exactness.test.mjs` pins the state of every Studio tray experiment after 0.4 s to hashes taken from the solver before this work (commit 5fc530d). The checkpoint format is unchanged (the new work arrays are not saved; a restore rebuilds them).

Studio tray, 0.5 s of each prepared experiment after the 0.3 s settle, CPU time of one process (`node scripts/bench-granular.mjs --seconds 0.5 --repeat 3`, fastest of three; this 4-core sandbox was shared with other jobs, load average 9 to 16, so the numbers are lower bounds and differences under 10% are noise):

| Experiment | Grains | Before: ms, × real time | After, one thread: ms, × real time | State |
|---|---:|---:|---:|---|
| Sand avalanche | 792 | 944, 0.53 | 1009, 0.50 | same bits |
| Glass-bead runout | 792 | 903, 0.55 | 999, 0.50 | same bits |
| Coarse gravel (16 mm) | 270 | 155, 3.2 | 152, 3.3 | same bits |
| Crushed-stone pile | 792 | 780, 0.64 | 842, 0.59 | same bits |
| Metered discharge | 792 | 891, 0.56 | 1020, 0.49 | same bits |
| Polymer pellets | 792 | 1041, 0.48 | 1024, 0.49 | same bits |
| Steel shot | 792 | 1020, 0.49 | 1062, 0.47 | same bits |
| Damped pile | 792 | 832, 0.60 | 806, 0.62 | same bits |
| Lab `hopper-seesaw` (150 grains, coupled) | 150 | 188, 2.7 | 179, 2.8 | same Lab state hash |

So on one thread the solver is as fast as before within the noise of this machine (the skipped wall measurements, about a tenth of the time in the tray, roughly pay for the ordered sums), and gives the same bits. The gain is meant to come from the threads: in a profile of the split path on one thread, `demContacts` and `demGather` take about 70% of a tray step, which bounds four threads at about 2× (Amdahl) before synchronisation (two waits per step, about 5,000 steps per simulated second). **The threaded speed-up was not measured:** every attempt here ran with the load average between 9 and 31 on 4 cores, where two to four spinning threads were slower than one. In headless Chromium (served with COOP/COEP, three helper workers started, no errors) the Studio tray read 0.09× real time with `?threads=4` against 0.22× with one thread, at a load average above 20. The Studio therefore uses threads only when asked (`?threads=n`). Measure on an idle machine with `node scripts/bench-granular.mjs --threads 4` (wall time) before turning them on by default.

Nothing is on the GPU. The roadmap's "granular on GPU" item is open: Node's Dawn (`webgpu` package) offers only the null backend here, which does not run shaders, and a float32 step could only be compared with this solver statistically, not to the bit.

## Limits

- **Spheres only.** No clumps, polyhedra or superquadrics; rolling resistance stands in for shape and must be calibrated. No cohesion, liquid bridges, breakage, wear or interstitial fluid. One material for all grains.
- **Soft grains.** The cost is set by the stiffness. Every bulk case here uses grains far softer than real ones, with overlaps of 2% to 5% of a radius under load. That is common practice in DEM and changes bulk flow little, but wave speeds and contact times are not those of the material.
- **Rolling resistance is one model**, checked only by the repose trend. Twisting about the contact normal is not resisted: a bead spinning on the spot keeps spinning.
- **Hertz–Mindlin is the simplified form.** No micro-slip, no load-history dependence of the tangential stiffness; in the sticking regime only the sign of the rebound is checked. Rigid-sphere results are approached only as the overlap goes to zero (see the note under the first validation table).
- **Silo results are in form.** Janssen saturation and the Beverloo exponent are reproduced; the constants (K about 1.1, C about 0.45 to 0.49) are not the textbook ones and no experiment is compared.
- **Shells have no thickness** and are two-sided; a box or plane is safer where a grain could be pushed hard. Walls take the grains' elastic constants. Dynamic walls have no gyroscopic term. A moving wall is tested against every grain at every step. The time-step check looks at grains only: a dynamic wall lighter than a grain shortens the contact time and is not checked.
- **Coupling.** Bodies are boxes, spheres and capsules. The world gets the mean force of a rigid step; the body's position at the end of the step is the world's, which can differ from the stand-in's by the second-order term of one rigid step. Supports are estimated one step late and without torque, so a body held by a stiff joint against a hard-driven bed is not checked. Sleeping is not handled: create coupled bodies with `neverSleeps`.
- **Size ratio.** The grid cell is the largest diameter, so a wide size distribution makes the neighbour search slow. The cases here use ±10%.
- **No checkpoints.** The state arrays are public and `touch()` re-reads them, but contact histories cannot be saved or restored.
- **The Studio's granular lab runs this solver** ([`STUDIO_FLOW_LABS.md`](STUDIO_FLOW_LABS.md)): coarse-grained grains in a 0.57 m tray. The app's granular scenes still use rigid bodies.
