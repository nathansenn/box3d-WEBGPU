# Studio material labs in SI units

The Engineering Studio's material labs (`index.html?studio=glass`, `concrete`, `rubber`; source `src/studio/material-labs/`) were authored models in normalised units, labelled "Comparative model · not calibrated". This document covers the labs that now run in SI units on validated solvers, what they model, how they were checked, what they cost, and what they leave out.

| Lab | State | Solver |
|---|---|---|
| Glass impact (`GI–02`) | **SI** since 2026-11-12 | Kirchhoff plate with brittle fracture, `src/engine/plate.ts` (new); lab model `src/studio/material-labs/glass-si.ts` |
| Concrete crush (`CC–03`) | **SI** since 2026-11-12 | tetrahedral solid with the concrete law (`material.concrete`, `src/engine/concrete-law.ts`, new) and `SolidContact` with friction; lab model `src/studio/material-labs/concrete-si.ts` |
| Elastomer lab (`EL–04`) | **SI** since 2026-11-12 | viscoelastic Neo-Hookean tetrahedral solid (`config.viscoelastic`) with `SolidContact` welds; lab model `src/studio/material-labs/rubber-si.ts` |

## Glass impact

### Why a plate and not the tetrahedral solid

The first plan was to mesh the pane with the tetrahedral solid of [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md) and break it with the cohesive interfaces of [`SOLID_FRACTURE.md`](SOLID_FRACTURE.md). Linear tetrahedra lock in bending, and a pane is the worst case: 2.6 m × 2.0 m × 8 mm. Measured with `SolidBody` (linear model, statics, simply supported edges, 1 kPa), the centre deflection against the Navier series:

| Mesh (cells x × y × through the thickness) | Elements | Deflection / Navier |
|---|---|---|
| 26 × 20 × 1 (0.1 m cells) | 2,600 | 1.5·10⁻⁴ |
| 26 × 20 × 2 | 5,200 | 4·10⁻⁵ |
| 52 × 40 × 2 | 20,800 | 6·10⁻⁴ |
| 0.26 m × 0.2 m pane, 26 × 20 × 2 (cells 10 × 10 × 4 mm) | 5,200 | 0.25 |
| the same, × 4 through the thickness | 10,400 | 0.09 |

Even with cells about as wide as the plate is thick the tetrahedra are four to ten times too stiff. A pane that bends correctly would need cells of a quarter of the thickness in every direction: about 10⁸ elements. So the glass lab got a plate solver instead, scoped to what the lab needs, and validated on its own.

### The plate (`src/engine/plate.ts`, solver id `plate-kirchhoff-fd-explicit-js-f64-v1`)

- **Bending.** Kirchhoff plate in the x-y plane, deflection `w` along z, flexural rigidity `D = E t³ / (12 (1 − ν²))`. Nodes on a rectangular grid, of equal cells or (since 2026-11-17, `lines`) graded ones (*Finer cracks* below). The energy is a sum of finite-difference curvatures: per node `½ D A (κxx² + κyy² + 2ν κxx κyy)` with `κxx` from the node and its two x-neighbours, per cell `D (1 − ν) κxy² hx hy` with `κxy` from its four corners. Forces are the exact gradient of that energy, assembled as a 5 × 5 stencil per node. For a simply supported plate the sine modes are exact eigenvectors of this grid, so its frequencies are known in closed form (`plateGridFrequency`).
- **Membrane action (`membrane: true`, von Kármán; on in the lab since 2026-11-16).** Each node also has in-plane displacements u, v. On each intact cell the membrane strains `u_x + w_x²/2`, `v_y + w_y²/2`, `u_y + v_x + w_x w_y` (bilinear interpolation, 2 × 2 Gauss points) carry the forces `N = E t / (1 − ν²) (...)`, so a deflection of the order of the thickness stretches the middle surface and stiffens the plate. The in-plane displacements are in equilibrium at every step (their inertia is neglected, their waves are some 30 times faster than the bending of interest): one solve with a sparse Cholesky factor of the in-plane stiffness (since 2026-11-17 in nested-dissection order: 35,625 entries on the lab's 27 × 21 nodes against 65,772 in the band it replaced; a solve 2.2 to 2.4 times and a factorization about 3 times faster), formed again after each crack; with `tieInPlane` (straight edges free to move) conjugate gradients instead. The membrane forces on w are the exact gradient of the membrane energy at in-plane equilibrium; the stability limit adds a bound on the membrane tangent (below); the fracture check reads the surface stress `N / t ± 6 M / t²` (the larger principal stress of either face). A plate flat to 1e-4 of its thickness skips the in-plane solve. `relax()` finds the nonlinear static deflection by dynamic relaxation with kinetic damping.
- **Supports.** Nodes held at `w = 0`, springs to `w = 0`, and springs on the difference of two nodes (a clamp's rotational restraint); in plane, `holdInPlane` and `tieInPlane`.
- **Time.** Explicit symplectic Euler, lumped mass `ρ t A` per node (plus an added areal mass for an interlayer). The step is limited by a Gershgorin bound on `M⁻¹K` including supports, contact springs the caller declares, bridging membranes and the membrane tangent; a step above it is refused. Since 2026-11-17 each node's row is the sum of its bending, layer and membrane rows before the largest is taken (before: the largest of each, added), the bridging string enters with its tangent `k (1 − (L/ℓ)³)` (before: `k` whatever its stretch; it is 0 for an unstretched string), and the membrane's row at each Gauss point is `wt √a_k Σ_j √a_j` with `a_k = ∇N_k · S ∇N_k`, `S = N⁺ + G` (N⁺ the membrane force without its compressive principal part, G the material part `Bᵀ C B`), a Cauchy–Schwarz bound on the exact tangent `∇N_k · (N + G) ∇N_j` (before: `(λ_max(N)⁺ + C |∇w|²) (1/hx + 1/hy)² hx hy` per cell, 3 to 4 times larger). All three are still upper bounds of the tangent at the present state. Mass damping and caller dashpots are taken implicitly. The step length must stay constant: symplectic Euler gains energy when it changes from one step to the next (seen as a blow-up when a remainder step closed each frame), so the lab splits each 1/120 s tick into equal sub-steps.
- **Fracture.** A crack is a broken bond between two neighbouring nodes; every curvature term that spans it is dropped, so no moment or shear crosses it. After each step, every intact bond whose mid-point principal surface stress `6 |M| / t²` (the mean of its two nodes' moments) minus the surface prestress reaches the strength breaks, if that principal direction is within 45° of the bond. Pieces are the groups of nodes joined by a shared curvature term; a piece is handed to the lab when it is free.
- **Toughened glass.** A surface prestress `σ_p` raises the stress the bending must reach to `σ_c + σ_p`. After the first crack, a dicing front breaks every bond within `v_d (t − t₀)` of the origin.
- **Bridging layers.** A laminate's PVB or a wire mesh is a membrane of stiffness `E t` (N/m) acting on every bond as a string with the in-plane displacements neglected: force `k s Δw / ℓ`, `k = E t w / L`, `s = ℓ − L`, `ℓ = √(L² + Δw²)`. It keeps a cracked laminate in one piece.

### The lab model (`src/studio/material-labs/glass-si.ts`)

| Item | Value | Source |
|---|---|---|
| Pane | 2.6 m × 2.0 m, thickness 3–24 mm (control), 26 × 20 cells of 0.1 m | the rig (`glass-rig.ts`) |
| Annealed, frosted, bronze glass | E 72 GPa, ν 0.23, ρ 2500 kg/m³, flexural strength 41 MPa | `soda-lime-glass` (Continental Trade sheet) |
| Toughened (tempered) | strength 41 MPa plus a surface compression of 165 − 41 = **124 MPa** (toughened minus annealed flexural strength of the same sheet) | `soda-lime-glass-toughened` (new entry, same sheet). ASTM C1048 requires at least 69 MPa (Efferz et al. 2024) |
| Dicing | front at **1466 m/s**; about **1 fragment per MPa** in a 50 mm square: ≈ 124 for 124 MPa | 1466 m/s within 1 %: Nielsen, Olesen and Stang, *The fracture process of tempered soda-lime-silica glass*, Exp. Mech. 49 (2009) 855–870, high-speed cameras, as stated on DTU's tempered-glass research page (<https://www.cse.byg.dtu.dk/research/tempered-glass>; the paper itself was not opened). 0.8–1.2 fragments per MPa for thin glass, EN 12150 minimum 40: Efferz, Thiele, Schuster, Schuler, Siebert, Schneider, *Relation between edge stress, bending strength, surface stress and fracture pattern of thermally toughened glass*, Glass Struct. Eng. (2024), doi 10.1007/s40940-024-00269-w |
| Laminated | annealed plies bending as one section; 0.76 mm PVB, E 33 MPa, ρ 1070 kg/m³: membrane 25.1 kN/m, +0.81 kg/m² | `pvb-interlayer` (new entry): AGC, *Material properties of PVB interlayers, Stratobel*, 2022 — 33 MPa is the 3 s, 0–20 °C value, the shortest tabulated |
| Wired | annealed plus a steel mesh of 0.46 mm wire at 12.7 mm: membrane 2.75 MN/m | E of `structural-steel-s235`; mesh 1/2 in × 1/2 in from AGC's wired glass sheet (*InfoSheet 2023 Wired*: "The dimensions of each wire mesh element is 1/2” × 1/2”"); EN 572-6 is summarised as 12.5 or 25 mm meshes (not opened); wire diameter **unverified** |
| Borosilicate | E 64 GPa, ν 0.2, ρ 2230 kg/m³, bending strength 25 MPa | `borosilicate-glass` (new entry): SCHOTT BOROFLOAT 33 datasheet |
| Acrylic | E 3.3 GPa, ν 0.37, ρ 1190 kg/m³, flexural strength 115 MPa (treated as brittle) | `pmma` (Evonik PLEXIGLAS GS) |
| Clamp pads | 6 natural-rubber pads (E 1.5 MPa), 24 mm thick, 210 mm tall, 55 mm over the pane edge, both faces: 1.44 MN/m per pad, rotation 363 N m/rad, × the "Clamp pad stiffness" control | `natural-rubber` |
| Pendulum | mass 5–100 kg (control), drop height 0.1–2 m (control), arm 1.9 m, bob radius 0.235 m, inertia `m (L² + offset² + 0.4 R²)` | the rig |
| Contact | node in front of the sphere along z: spring of a quarter of the stiffest bending row, critically damped dashpot (an inelastic, crushing contact) | model choice |
| Plate damping | mass damping 0.6 /s (≈ 0.6 % of critical at 8 Hz) | **unverified** assumption |
| Fragments | since 2026-11-17 rigid bodies of a Box3D world that collide with each other, the frame, the tray (y = 0.68 m) and the floor, and since 2026-11-18 with the pendulum's bob (which feels them), the clamp pads and the glass still held in the frame (below, *Fragments in a Box3D world*); glass on glass static friction 0.95, glass on steel 0.6 with restitution 0.71 | `contactPair('soda-lime-glass', 'soda-lime-glass')` and `contactPair('soda-lime-glass', 'structural-steel-s355')` (The Engineering ToolBox, last resort; Zou et al. 2024) |

A piece stays in the frame while at least two of its nodes sit under the pads; otherwise it falls. Readouts: **peak contact force (kN)**, **peak surface stress before the first crack (MPa)**, **out-of-plane deflection of the glass still in the frame (mm)**; the status line gives the number of pieces, the share of the pane held and the farthest fragment.

**Hand numbers (8 mm annealed).** `D` = 3244 N m. First mode of the pane if simply supported on all edges: 7.96 Hz. First crack under uniform pressure on those edges: 1.63 kPa. Default strike: 50 kg from 1.1 m, 540 J, bob at 4.63 m/s at the bottom. Stable step on the 0.1 m grid: 196 µs bare, 176 µs with the contact springs (which since 2026-11-17 count only while the bob is near), so about 43 to 48 sub-steps per 1/120 s tick (three times more at 24 mm).

### Validation (`tests/engine/plate.test.mjs`, `npm run test:plate`, pull-request gate; domain `plate` in [`VALIDATION.md`](VALIDATION.md))

The 2.6 m × 2.0 m × 8 mm soda-lime pane, simply supported on all edges.

| Check | Expected | Measured | Tolerance |
|---|---|---|---|
| Centre deflection, 1 kPa, 26 × 20 cells | Navier series | +8.7·10⁻⁶ (+2.6·10⁻⁶ at 52 × 40) | 2·10⁻⁵ |
| Centre moment M_y | Navier series | −1.77·10⁻³ (−4.4·10⁻⁴ at 52 × 40) | 3·10⁻³ |
| Order of the moment error | 2 | 2.00 | ±0.1 |
| (1,1) mode, released from its shape | the grid's exact frequency 7.946312 Hz | 7.946320 Hz | 10⁻⁵ |
| (1,1) mode against Kirchhoff | 7.960185 Hz | −0.17 % | 0.25 % |
| Energy, no damping, 40,000 steps at half the limit | constant | largest change 2.5·10⁻³ (bounded oscillation of symplectic Euler) | 5·10⁻³ |
| Step above the limit | refused | `UNSTABLE_TIME_STEP` | exact |
| First crack under uniform pressure, 41 MPa | `σ_c t² / (6 M_max per unit q)` = 1629.1 Pa | 1638.6 Pa (+0.59 %; never early) | 2 % |
| The same with 124 MPa prestress | ratio (41 + 124) / 41 | exact to 10⁻⁹ | 10⁻⁹ |
| First crack direction | perpendicular to the larger centre moment (M_y) | only y-bonds break | exact |
| A cut line through a free plate | two pieces; masses and momenta sum; spin from the velocity gradient | to 10⁻¹³ | 10⁻¹³ |
| Bridging tie on the same cut | one piece | one piece | exact |
| Determinism of a cracking run | bit-identical | identical | bit equality |
| Von Kármán, square plate, edges held in plane (ν = 0.316, 16 × 16 cells), w_center / h at p a⁴ / (E h⁴) = 14.78, 51.4, 132.0, 278.5 | Levy, NACA Report 737 (1942), Table 9 (scan opened on NTRS): 0.485, 0.952, 1.402, 1.846 (true value 1.827 to 1.846) | 0.4844, 0.9513, 1.4012, 1.8406 (−0.29 % at the largest; linear theory 12.22) | 1 % |
| The same, average edge tension, −p_x a² / (E h²) | Table 10: 0.451, 1.816, 4.12, 7.38 | 0.466, 1.866, 4.21, 7.50 (+1.6 to +3.3 %) | 4 % |
| Von Kármán, straight edges free to move, w_center / h at 12.1 … 497 (8 loads) | Levy, Table 6: 0.486 … 3.600 (true value at 247: 2.704 to 2.743) | within 0.69 % at all eight (−0.69 % at 497, the largest; 2.7397 at 247) | 1 % |
| Mesh, edges held, p a⁴ / (E h⁴) = 278.5 | converged | 1.8555, 1.8406, 1.8369 on 8, 16, 32 cells | 1.5 % (8 against 32 cells) |
| Small load (10⁻³) | the linear plate | within 10⁻⁶ | 10⁻⁶ |
| Forces against central differences of the energy | exact gradient | 2.1·10⁻⁸ | 10⁻⁵ |
| Free vibration at two thicknesses | bounded energy oscillation, falling with the step, no drift | 2.1 % at 0.2 of the limit, 1.1 % at 0.1, the same in both halves of the run | — |
| Fracture check with membrane stress | membrane plus bending at the centre | sees ≥ 97.4 MPa where bending alone gives 54.2 MPa; cracks at a strength between the two | exact |
| Checkpoint of a cracking von Kármán plate | bit-identical, in-plane state included | identical | bit equality |

**Not validated:** von Kármán with a crack or a bridging layer (the membrane acts on intact cells only; the bridging tie is still a string with in-plane motion neglected), the impact itself (contact force history, rebound), crack paths and fragment counts, the dicing front and fragment size (inputs), the membranes' strength (they never tear), fragment trajectories. No plate model can be checked against the Studio's real pendulum: there is no test of that rig.

### What the presets give (first 3 s; `tests/studio/material-labs.test.mjs`)

| Preset | Result |
|---|---|
| Radial impact, 8 mm annealed, 540 J | cracks at the first contact (peak force 12.4 kN, stress 106 MPa at the step it breaks); about 28 pieces; 5 % of the pane falls out, the rest stays clamped; the farthest fragment lands 5.8 m away |
| Tempered breakup, 1590 J | cracks at 256 MPa, then the dicing front breaks every bond; the whole pane falls (≈ 124 fragments per 50 mm square predicted, drawn at the 0.1 m grid) |
| Laminated retention, 1180 J | cracks; nothing detaches; the cracked laminate sags 0.40 m at 3 s on the PVB membrane |
| Thick panel, 24 mm, 10 kg from 0.2 m (20 J) | intact: 35 MPa against 41 MPa |
| Acrylic comparison, 147 J | intact: 31 MPa against 115 MPa |
| Wired retention | cracks; held by the mesh; sag 32–44 mm |

The earlier authored test asked laminated travel to be below 30 % of annealed. Measured instead of forced: the laminate's 0.40 m sag against 5.8 m for the farthest annealed fragment (6.9 %), and against 6.6 mm for the annealed glass that stays in the frame. The old "thick panel" preset (25 kg from 0.4 m, 98 J on 24 mm) **breaks** in this model (67 MPa), so the preset was changed to 20 J; a hard 25 kg sphere at 2.8 m/s on 24 mm glass is also likely to break real glass (Hertzian stress), which the plate does not model.

**With membrane action (2026-11-16)**, first 3 s, against the linear plate (same settings, Node 22, load about 12):

| Preset | Peak force (kN) linear → von Kármán | Peak stress (MPa) | Largest deflection (mm) | Pieces | Real-time factor |
|---|---|---|---|---|---|
| Radial impact | 12.4 → 12.4 | 105.8 → 111.3 | 25.6 → 23.0 | 28 → 24 | 0.83 → 0.22 |
| Tempered breakup | 11.0 → 30.6 | 256 → 304 | 25.9 → 74.0 | 567 → 567 | 0.68 → 0.71 |
| Laminated retention | 10.4 → 18.9 | 121.0 → 121.7 | 622 → 589 | 1 → 1 | 0.86 → 0.057 |
| Thick panel | 22.31 → 22.31 | 35.2 → 35.3 | 3.0 → 3.0 | intact | 0.32 → 0.082 |
| Off-centre strike | 9.5 → 10.1 | 105.8 → 111.3 | 16.4 → 18.0 | 21 → 21 | 1.00 → 0.26 |
| Frosted fracture | 10.9 → 13.3 | 106.2 → 111.8 | 28.1 → 26.0 | 30 → 31 | 0.87 → 0.24 |
| Wired retention | 18.0 → 20.7 | 115.0 → 117.8 | 209 → 208 | 1 → 1 | 0.48 → 0.10 |
| Acrylic comparison | 1.34 → 2.73 | 30.9 → 30.6 | 365 → 210 | intact | 2.35 → 0.32 |

The acrylic sheet, deflected 45 thicknesses by the linear plate, is held to 26 thicknesses by its membrane, at twice the force; the tempered pane, stiffer, takes almost three times the force. The cost is the in-plane solve at every sub-step and, once the pane sags, a smaller stable step (the laminate takes 4.7 times the sub-steps: 87,280 against 18,720 in 3 s). Profiled on 2026-11-16: the banded Cholesky factor is formed only when a cell cracks, and the solve is direct (one forward and one back substitution per sub-step), so there is no iteration to warm-start; conjugate gradients, warm-started from the last field, run only with edges tied straight, which the lab does not use. What was removed, with the state unchanged to the bit on all eight presets: the load pass of the in-plane solve computed the full membrane energy (now only its gradient), the back substitution read the factor across rows (now a transposed copy read in order), and the fracture check allocated an array per bond and evaluated every bond (now a bound |s_x| + |s_y| + |s_xy| skips the bonds that cannot crack or raise the peak). Measured old and new back to back (3 s, Node, load about 12): 1.03 to 1.35 times faster, the lab at 0.09 to 0.64 times real time (radial impact 0.29, laminate 0.087, thick panel 0.12, acrylic 0.42), against 0.3 to 2.4 for the linear plate. What remained was the in-plane solve itself (about a third of the time) and the smaller step: see *Speed (2026-11-17)* below.

### Speed (2026-11-17)

Four changes, none of them to the model:

1. **The in-plane solve** uses a sparse Cholesky factor in nested-dissection order (each half of the node grid ordered before the middle grid line that separates it): 35,625 entries against 65,772 for the band. Same matrix, same unit rows for held and unconnected components; a solve takes 0.18–0.21 ms against 0.43–0.56 ms, a factorization 3.6 ms against 10–12 ms. The answers change by rounding only: every row of the plate's validation printed by `npm run test:plate` (the Levy rows of both tables, edge tension, mesh study, small load, gradient check, energy oscillation, fracture with membrane stress) has the same digits as before; the dynamic-relaxation step counts and the rounding-level net edge forces of the free-edge rows change.
2. **A tighter stability bound** (above, *Time*): still an upper bound of the present tangent, 3 to 4 times smaller in the membrane part, and the bridging layer counted by its tangent. Fewer sub-steps where the membrane or the layer set the step (laminate, wire, acrylic). The lab's contact springs keep their stiffness: they are still a quarter of the stiffest bending row with the layer counted at full stiffness, as before.
3. **Contact springs in the bound only near the bob.** The lab declares them on the nodes the bob can reach within the tick (under its footprint widened by its travel, with a gap below twice what the bob and the fastest node close in a tick plus 20 mm), not on every node at all times: about 11 % fewer sub-steps while the bob is away.
4. **The pane at rest is not stepped (2026-11-17, with the refinement).** Until the bob first touches it the pane carries no load, so its sub-steps only advance its clock: the same state to the bit (the radial impact's hash over its first second is unchanged), about 1.5 times faster over that second.

Items 1 to 3, measured old and new interleaved, preset by preset, over the first 3 s (`node scripts/fem-preset-benchmark.mjs glass --seconds 3`, Node 22, this 4-core sandbox at load 16 to 31 from other jobs, so the factors are rough):

| Preset | Real-time factor before → after | CPU ratio | Sub-steps before → after | Pieces | Peak force (kN) | Peak stress (MPa) |
|---|---|---|---|---|---|---|
| Radial impact | 0.39 → 0.62 | 1.59 | 20,239 → 18,137 | 24 → 24 | 12.41 → 12.43 | 111.3 → 106.9 |
| Tempered breakup | 0.98 → 0.85 (0.93–0.97 → 0.98–1.04 rerun) | ≈1 | 5,626 → 5,032 | 567 → 567 | 30.64 → 30.71 | 303.9 → 303.6 |
| Laminated retention | 0.095 → 0.265 | 2.79 | 87,280 → 55,184 | 1 → 1 | 18.91 → 23.25 | 121.7 → 120.8 |
| Thick panel | 0.135 → 0.181 | 1.34 | 57,240 → 54,044 | intact | 22.31 → 20.69 | 35.3 → 34.4 |
| Off-centre strike | 0.34 → 0.55 | 1.60 | 20,289 → 18,155 | 21 → 21 | 10.12 → 9.57 | 111.3 → 106.8 |
| Frosted fracture | 0.36 → 0.50 | 1.37 | 20,582 → 18,056 | 31 → 29 | 13.25 → 10.12 | 111.8 → 107.3 |
| Wired retention | 0.19 → 0.59 | 3.13 | 47,556 → 21,750 | 1 → 1 | 20.72 → 19.29 | 117.8 → 117.6 |
| Acrylic comparison | 0.48 → 0.94 | 1.97 | 14,870 → 9,964 | intact | 2.73 → 2.76 | 30.6 → 30.7 |

**With all four items** (the code after the three commits of 2026-11-17, default grid, fragments without the Box3D world, which the benchmark does not load), measured the same way against the code before them at load about 7: radial impact 0.33 → 0.55 times real time (1.66 times faster), tempered breakup 0.88 → 1.16 (1.32), laminated retention 0.10 → 0.24 (2.40), thick panel 0.139 → 0.22 (1.58), off-centre strike 0.35 → 0.59 (1.72), frosted fracture 0.40 → 0.69 (1.75), wired retention 0.175 → 0.57 (3.26), acrylic comparison 0.45 → 1.16 (2.59).

The tempered pane spends its time on the 567 falling tiles and the hand-off of the dicing tick (worst tick 2 to 4 s), which these changes do not touch. The state hashes of the presets change (the factor rounds differently and the step is longer). What moves with the step are the peak readouts of the impact, which are not converged in the time step: the radial impact's peak contact force is 12.4, 15.3 to 16.3 and 17.5 to 18.6 kN at 1, 1/2 and 1/4 of the lab's step (old and new code alike), the laminate's 18.3 (old) or 23.3 (new), then 22.6 to 23.4 and 22.8 to 23.0; the peak stress moves by about 5 %; the time of the first crack stays within 0.1 ms (0.7055 s radial, 0.7418 s laminate). So the differences in the table are within the step error of these readouts; the new step is if anything closer to the converged laminate force.

**Tried and not kept.** Solving the membrane only every k-th sub-step (the in-plane displacements of an earlier sub-step in between): 1.2 to 2.5 times faster at k = 2 to 4, but the acrylic sheet's peak stress fell from 30.6 to 22.0 MPa and the laminate took half the sub-steps for the wrong reason (the lagged field is not in equilibrium), so the answers are not those of the model: not kept. **Implicit or sub-cycled bending: not done.** Only the thick panel is limited by bending alone (its interior bending row sets the step at 24 mm, three times the 8 mm step); the others are limited by the membrane or by bending plus contact. An implicit bending step would need the contact penalty implicit too (it is a quarter of the bending row) and a factor of the 13-point stencil after every crack, and the impact readouts above already move by 50 % between the lab's step and a quarter of it, so a longer step would move them further.

### Fragments in a Box3D world (2026-11-17; `glass-fragments.ts`)

Released fragments become rigid bodies of a Box3D world (`src/engine/native-world.ts`, the native world the kit's `PhysicsWorld` and the Physics Lab use) that the glass worker loads once from the page's `box3d/box3d.js` and `box3d.wasm`. Each fragment is one dynamic body: a compound of one convex hull per tile (a tile's four corners at its node's deflection, as drawn), up to 64 hulls (larger fragments merge neighbouring tiles into one hull; none in the presets has more than three tiles). Its mass, centre and inertia tensor are the plate's (explicit mass data: each node's point mass plus its cell as a thin lamina, products of inertia included), its velocity the plate's centre-of-mass velocity and its spin `I⁻¹ L` with `L` the plate's angular momentum about that centre, so a fragment leaves with the plate's linear and angular momentum. Static bodies: the floor (top at y = 0), the tray and its walls, the frame's posts, feet and header (the boxes the renderer draws); not the clamp pads, which press on the pane's faces, so a shard released from under one would start inside it. The world steps 8 times per 1/120 s tick with 4 sub-steps each: Box3D finds contacts once per step and keeps them within 20 mm of touching, and a shard landing at 7.5 m/s must not cover more than that in a step (with one step of 4 sub-steps per tick a shard went 40 mm into the tray). Fragments collide as hulls at least **16 mm** thick (`COLLISION_THICKNESS`): between 8 mm hulls a shard landing edge first went through one lying flat (overlap of the full thickness); so thin glass rests 4 mm above what it lies on, which the camera does not show.

| Contact | Friction | Restitution | Source |
|---|---|---|---|
| Glass on glass (fragment on fragment) | 0.95 (static, clean and dry) | 0 | `contactPair('soda-lime-glass', 'soda-lime-glass')`: The Engineering ToolBox (last resort); the library has no glass-on-glass restitution |
| Glass on steel (tray, frame) | 0.6 (static, clean and dry, "Glass / Metal 0.5–0.7", new in library 1.8.0) | 0.71 | ToolBox friction table, read 2026-11-17 (it does not name the metal); restitution: Zou et al. 2024, a glass ball on a 10 mm steel plate at 3.1–4.4 m/s |
| Glass on the floor | 0.6 (the glass-on-steel value, **unverified** for a concrete floor) | 0 | the library has no glass-on-concrete pair |

Box3D mixes friction as `√(f_a f_b)` and restitution as `max(e_a, e_b)`: fragments carry 0.95 and 0, the rig 0.6² / 0.95 = 0.379 and 0.71, the floor 0.379 and 0.

**Validation** (`tests/studio/glass-fragments.test.mjs`, in `npm run test:studio:materials`):

| Check | Expected | Measured | Bound |
|---|---|---|---|
| Contact values | the library's pairs through Box3D's mixing rules | √(0.95 × 0.379) = 0.6, max(0, 0.71) = 0.71 | 1e-12 |
| A 0.1 m tile lying on the floor, at rest | normal force = m g = 1.962 N | 1.96200 N (sampled over the last 0.5 s of 2 s), speed 0, centre 7.9 mm up (its 16 mm hull) | 1e-4 |
| A second tile on it | floor and tile contacts carry 2 m g + m g | 5.8851 N against 5.8860 N (−0.016 %), 15.5 mm apart | 5e-4 |
| Momentum at release, every fragment (radial, frosted, tempered) | Box3D body (float32) = plate: M v and I ω = L | linear within 1.6e-7, angular within 3.8e-8 (relative) | 1e-6 |
| No corner of a drawn shard inside the floor, tray or frame (first 4 s; tempered 6 s) | ≤ Box3D's 5 mm linear slop | radial 1.4 mm, frosted 0.6 mm, tempered 1.8 mm | 5 mm |
| Drawn shards overlapping each other (separating-axis test on the 8 mm tiles, every 2nd tick; tempered every 24th) | apart | radial 0.42 mm, frosted 0.37 mm, at the end 0; tempered (567 tiles falling into the tray at once) up to the full 8 mm for a few ticks, 2.3 mm at rest; since 2026-11-18 (6 mm wider hulls) radial, frosted, edge strike 0, tempered 3.96 mm, 0.91 mm at the end | 3 mm; tempered 5 mm, 2 mm at rest (8 and 5 mm before) |
| Determinism | a cracking run with Box3D fragments repeats bit for bit | identical | bit equality |

**The bob, the clamp pads and the held glass (2026-11-18).** Collision categories keep each pair that matters and nothing else: fragments collide with everything; the rig, the clamps and the bob only with fragments.

- *The bob* is a dynamic sphere of the bob's mass (radius 0.235 m, its own moment of inertia 0.4 m R² about its centre), free only in the pendulum's plane (translations in y and z, turning about x; Box3D motion locks), without gravity. At each tick it is put at the pendulum's pose at the start of the tick with the velocity that takes it to the pose at the end (and the arm's spin), Box3D steps, and the change of its velocities is the fragments' impulse J and angular impulse L_x on it. The pendulum takes the generalized impulse `Q = J · t − L_x` (t = dr/dθ, the bob's centre per unit angle; the bob turns by −1 per unit angle): `θ̇ += Q / I`. So the angular momentum about the pivot is conserved between pendulum and fragments, friction included. The contact is glass on steel friction without restitution: the bob crushes the glass it strikes, as its contact with the pane does (a critically damped, never pulling spring); with the glass-ball restitution 0.71 the struck shards left at 1.7 times the bob's speed and one hit the tray wall edge-on hard enough to put a corner 17.7 mm into it.
- *Is the reaction significant?* The fragments give the pendulum 1.6 N m s (radial impact), 1.3 (frosted), 2.3 (edge strike) and 0.00 (tempered) against its largest angular momentum about the pivot of 443, 576, 443 and 1022 N m s: 0.2 to 0.5 %. Small, but it is kept two-way, at no extra cost.
- *A shard released where the bob pressed the glass* starts inside the bob's sphere: its tiles are flat 0.1 m squares and the sphere curves away under them (the plate's own nodes stay within the contact's spring compression of the sphere). Before it enters the world it is moved out along the shortest way (from the bob's centre to the nearest point of its deepest tile), position only, so its momentum is the plate's: in the radial impact 20 of 23 shards move, by up to 72 mm (a tile on the flank of the sphere, which has passed half way through the pane when the last shards of the hole come loose); in the tempered pane 3 of 567, by up to 4.6 mm.
- *The clamp pads* (both chrome blocks and the rubber faces, as drawn) are static boxes; glass-on-steel friction and restitution (the library has no glass-on-rubber pair: unverified for the rubber faces).
- *The held glass* is one kinematic hull per tile of the plate's active nodes (its outline as drawn, widened by 2.5 mm, 16 mm thick like the fragments' hulls, at the node's deflection and turned by the plate's slopes as drawn), made at the first release; a node's hull leaves when the node does. Each tick the hulls near a fragment that may reach them follow the plate (Box3D's kinematic target: the pose at the end of the tick); the others stay where they are and are put at their pose when a fragment comes near. The glass is one-way: a fragment does not push the plate. A fragment of 0.2 kg sliding on the pane at 1 m/s carries 0.2 N s; the pane weighs 104 kg and its pads take 1.4 MN/m each. Without the 2.5 mm margin a drawn shard went 2.1 mm into the drawn pane (frosted fracture): against a crack face the contact is in the pane's plane, where a hull is no thicker than the glass, and Box3D lets touching shapes overlap by up to its 5 mm linear slop.
- *A shard released inside a clamp* (from under a pad, or overlapping the held glass's collision hull, which a shard released along a crack does through the outline margins: the held glass's 2.5 mm and since step 4 below the fragments' 6 mm) collides with the clamps only once its hulls are clear of them (separating-axis test each tick): 3 shards in the radial impact, 8 frosted, 2 edge strike, 31 in the tempered pane (its tiles under the pads, each a piece with fewer than two pad nodes). The drawn-corner check below includes these shards for the held glass, so one that fell through the pane's edge while clearing it would show.

| Check (`glass-fragments.test.mjs`) | Expected | Measured | Bound |
|---|---|---|---|
| The bob strikes a 0.1 m tile at 4.6 m/s, no gravity: angular momentum about the pivot of pendulum plus tile | conserved | the tile takes 1.7642 N m s, the pendulum gives 1.7639 (difference 0.015 % of the exchange; Box3D holds float32) | 0.1 % |
| No corner of a drawn shard (8 mm) inside the bob's sphere, every 2nd tick, first 4 s (tempered 6 s, every 24th) | ≤ 2 mm | radial, frosted, edge strike, tempered: 0 (0.62, 0.87, 1.06, 0 mm before the fragments' 6 mm margin) | 2 mm |
| … inside a clamp pad (shards that started inside one skipped until clear) | ≤ 2 mm | 0 in all four | 2 mm |
| … inside a drawn tile of the held glass (every shard) | ≤ 2 mm | radial 0, frosted 1.12 mm, edge strike 1.79 mm, tempered 0 (0, 1.13, 0, 0 mm before the margin) | 2 mm |
| No corner inside the floor, tray or frame | ≤ 5 mm | radial 0, frosted 0.14 mm, edge strike 0, tempered 3.25 mm (0.13, 3.08, 0, 1.94 mm before the margin) | 5 mm |

The other presets release no fragments (laminated, wired: held by the interlayer; thick panel, acrylic: intact). Sampled at every 2nd tick instead of every 24th, the tempered pane's rain shows one sample with a corner 14.2 mm into the tray (13.6 mm with the code before these changes): a spinning tile meeting the tray wall's edge, where Box3D's contact between a 16 mm hull and the 0.1 m wall resolves along the wall's side for a few ticks; 16 Box3D steps per tick instead of 8 removed it in the frosted run but not in the tempered one, so it is stated, not hidden.

**Fragments collide 6 mm wider than drawn (2026-11-18, `FRAGMENT_MARGIN`).** A pile of tiles touches edge to edge, in a tile's plane, where its 16 mm hull is no thicker than the glass, and Box3D lets touching shapes overlap by up to its 5 mm linear slop. Measured on the toughened pane's 567 tiles over the first 4 s, every 4th tick (separating-axis test on the drawn 8 mm tiles):

| Fragment hull outline | Deepest crossing of two drawn tiles | Samples above 2 mm | At 4 s | Tiles asleep at 4 s |
|---|---|---|---|---|
| as drawn (before) | 8.0 mm (their thickness) | 79 of 96 | 2.89 mm | 533 of 567 |
| + 2.5 mm | 8.0 mm | 70 of 96 | 3.35 mm | 552 |
| + 4 mm | 7.34 mm | 9 of 96 | 0.41 mm | 562 |
| + 6 mm (kept) | 3.96 mm | 3 of 96 | 0.91 mm | 555 |

Cost: none measurable (Box3D took 9.5 s of CPU for those 4 s before, 12.0 s after, at load 30 on this machine, where single runs scatter by ±20 %). Shards that touch now rest 12 mm apart edge to edge (6 mm each), and shards released side by side, which overlap by 12 mm in the plane, are pushed apart by Box3D's contact (at most its 3 m/s push-out speed). The held-glass tests use the collision outlines (fragments + 6 mm, held glass + 2.5 mm). The tempered row of the test now asks for crossings below 5 mm (was the 8 mm thickness) and 2 mm at the end (was 5 mm).

**Glass on a concrete floor: no source found.** Searched on 2026-11-18 (The Engineering ToolBox's friction table, physics textbook tables, forensic glass-transfer literature): none gives a glass-on-concrete pair; the floor keeps the glass-on-steel friction 0.6, still marked unverified for concrete.

Box3D's own contact statistic (`deepestPenetration`) reports up to 8 to 21 mm in these runs: it is the deepest point of a contact manifold, which for thin hulls meeting edge-on exceeds their overlap; the table measures the drawn geometry instead. Each piece of edge glass (a node on the pane's border) has its centre on its own edge (the plate lumps a cell's mass at its node), so a border tile can stand upright on its centre.

**What changed in the presets** (12 s, Node): the radial impact's farthest fragment lands 4.55 m away (4.91 m without the world; the plate's pieces are unchanged), the tempered pane's 567 tiles come to rest in and around the tray, 12.4 m at the farthest (14.9 m without), every tile asleep by 6 s; shards no longer pass through each other or the tray, and those that hit the tray's steel bounce (restitution 0.71). Cost: Box3D took 0.3 s of the radial impact's 12 s and about 10 s (wall, at load 30) of the tempered pane's, whose real-time factor went from 2.33 to 2.16.

### Finer cracks: a grid refined around the impact (2026-11-17)

`PlateBody` takes a graded tensor grid (`lines: {x, y}`: the node columns and rows): every finite difference uses its own spacings (a second difference `2 ((w₊ − w) / b − (w − w₋) / a) / (a + b)` between spacings a and b, a twist and a bilinear membrane cell of each cell's own size, node areas and bridging widths of the node's strip). `new GlassModel(settings, {refine: {factor, half}})` splits every 0.1 m cell within `half` of the point the bob strikes (the pane's mid-height at the impact x) `factor` times, through the whole pane along both grid lines; the Studio uses `GLASS_REFINEMENT` (factor 2, half 0.3 m: 0.05 m cells in a 0.6 m cross around the impact; 32 × 26 cells, 891 nodes) when the page is opened with `cracks=fine` (`index.html?studio=glass&cracks=fine`). The tiles are drawn from the refined lines (corners moved by up to 0.275 of the smaller neighbouring cell). The contact keeps the 0.1 m grid's stiffness per unit area, so the bob meets the same contact whatever the cells under it. Off by default: it cost 1.5 to 6.2 times the plain lab with every term explicit (below); since 2026-11-18 the fine cells' bending is implicit and it costs 1.5 to 3.5 times (*Implicit fine cells* below), still not twice or less for every preset.

**Validation** (`tests/engine/plate.test.mjs`, registry rows `plate.graded.*`): the refined pane against the same closed forms as the equal grid.

| Check | Expected | Equal grid (26 × 20) | Graded grid | Tolerance |
|---|---|---|---|---|
| Centre deflection, 1 kPa, simply supported pane | Navier series | +8.7·10⁻⁶ | −1.0·10⁻⁴ (first order where the spacing changes) | 2·10⁻⁴ |
| Centre moments M_x, M_y | Navier series | −0.91·10⁻³, −1.77·10⁻³ | −1.05·10⁻³, −2.13·10⁻³ | 2·10⁻³, 3·10⁻³ |
| (1,1) mode | Kirchhoff 7.960185 Hz | −0.17 % | −0.23 % | 0.25 % |
| First crack under uniform pressure, 41 MPa | 1629.1 Pa | 1638.6 Pa (+0.59 %) | 1634.2 Pa (+0.32 %); never early | 2 % |
| Von Kármán, edges held, w_centre / h at 14.78, 51.4, 132.0, 278.5 (16 × 16; graded: middle quarter split, 20 × 20) | Levy Table 9: 0.485, 0.952, 1.402, 1.846 | 0.4844, 0.9513, 1.4012, 1.8406 | 0.4840, 0.9501, 1.3996, 1.8385 (inside Levy's bracket 1.827–1.846) | 1 % |
| Edge tension at the same loads | Levy Table 10: 0.451, 1.816, 4.12, 7.38 | 0.466, 1.866, 4.21, 7.50 | 0.467, 1.868, 4.21, 7.50 | 4 % |

The rows of the equal grid keep their digits with the graded code (the moments of the Navier row change in the 12th digit). In the lab (`tests/studio/glass-refine.test.mjs`): the refined tiles cover the pane to 1e-10 m² and carry its mass to 1e-12; the radial impact's first crack comes at 0.70510 s against 0.70547 s on the 0.1 m grid.

**What it gave with every term explicit** (first 3 s, Node, the same code with and without `refine`, load about 30; superseded by *Implicit fine cells* below):

| Preset | Real-time factor 0.1 m → refined | Cost | Pieces | Broken bonds | Mean falling piece (cm²) | First crack (s) | Peak force (kN) | Peak stress (MPa) |
|---|---|---|---|---|---|---|---|---|
| Radial impact | 0.62 → 0.12 | 5.3× | 24 → 65 | 50 → 111 | 100 → 30 | 0.70547 → 0.70510 | 12.4 → 8.3 | 106.9 → 80.2 |
| Tempered breakup | 1.19 → 0.78 | 1.5× | 567 → 891 | 1086 → 1722 | 92 → 58 | 0.79341 → 0.77266 | 30.7 → 14.5 | 303.6 → 239 |
| Laminated retention | 0.26 → 0.089 | 2.9× | 1 → 1 | 395 → 562 | — | 0.74182 → 0.74140 | 23.3 → 15.2 | 121.1 → 85.6 |
| Thick panel | 0.23 → 0.037 | 6.2× | intact | 0 → 0 | — | — | 20.7 → 16.9 | 34.4 → 43.6 |
| Off-centre strike | 0.61 → 0.12 | 5.1× | 21 → 75 | 45 → 117 | 110 → 26 | 0.70547 → 0.70510 | 9.6 → 7.1 | 106.8 → 80.2 |
| Frosted fracture | 0.63 → 0.11 | 5.6× | 29 → 74 | 64 → 124 | 107 → 26 | 0.70547 → 0.70510 | 10.1 → 7.1 | 107.3 → 80.3 |
| Wired retention | 0.52 → 0.18 | 2.9× | 1 → 1 | 397 → 660 | — | 0.70526 → 0.70467 | 19.3 → 11.2 | 117.6 → 102.3 |
| Acrylic comparison | 0.96 → 0.26 | 3.8× | intact | — | — | — | 2.76 → 2.74 | 30.7 → 34.2 |

The uniform 52 × 40 grid (0.05 m everywhere) gave the radial impact 71 pieces of 27 cm² at 17 times the cost of the 0.1 m grid in the same run (82.6 s of CPU against 4.8 s for 3 s); the refined grid gives 65 pieces of 30 cm² at 5.3 times. The cost is the explicit step, which falls with the square of the smallest cell (3.7 times the sub-steps), not the 57 % more nodes; implicit or sub-cycled time steps for the fine cells were not done. The impact readouts move with the grid as the point-load stress of a Kirchhoff plate does (logarithmically singular under the bob; the contact keeps its stiffness per area, so the load spreads over more nodes): the peak force and stress fall by a quarter where the glass breaks, the toughened pane cracks 21 ms earlier (at 239 instead of 304 MPa, under a softer contact), and the thick panel reads 43.6 MPa at a bond whose principal direction is more than 45° from it, so it stays intact although the readout passes 41 MPa. These are grid effects of the impact, not of the undamaged plate (validated above), and are why the refined grid is an option rather than the default.

### Implicit fine cells: the 0.05 m cells no longer set the step (2026-11-18)

`PlateBody` takes `implicitCells` (m): the bending terms of cells narrower than this are taken implicitly, the others explicitly as before; the refined lab sets 0.075 m (`IMPLICIT_CELLS`), so every term that involves a 0.05 m spacing is implicit. A step of length h is

`(M + h₀²/4 K_f)(v' − v) = h F(w)`, `w' = w + h v'`,

with F every force at the present deflection (bending, supports, the caller's contact, the bridging layer, the membrane), K_f the implicit bending terms and h₀ the stable step of the explicit terms when the plate is first assembled (196.3 µs for the 8 mm pane, that of the 0.1 m grid). At h = h₀ this is the average-acceleration (trapezoidal) rule on K_f and central differences on the rest: the element partition of Hughes and Liu (*Implicit-explicit finite elements in transient analysis: stability theory*, J. Appl. Mech. 45 (1978) 371–374, doi 10.1115/1.3424304; only the abstract was read: the implicit elements unconditionally stable, the explicit elements’ critical step governs. The bound below is derived here and checked by the exact energy row). Written out, it is central differences with the mass M + h₀²/4 K_f, which is stable when h² λ_max(M⁻¹ K_e) < 4 for the explicit terms K_e alone and h ≤ h₀ (the implicit terms are covered whatever their stiffness), so the limit is the 0.1 m grid's. Each node's energy whose x-curvature is implicit and y-curvature explicit splits into ½ D A (κ_x + ν κ_y)² (implicit) and ½ D A (1 − ν²) κ_y² (explicit), both positive, so both parts are energies. The implicit nodes' velocity change comes from an envelope Cholesky factor of M + h₀²/4 K_f over them (615 of the refined lab's 891 nodes, ordered along the shorter side), formed again only when a crack changes K_f; mass damping and the contact dashpots then act node by node, implicitly, as before.

h₀ is fixed on purpose. The first version used h²/4 with the step of the moment; the lab's step changes from tick to tick when the membrane or the contact sets it, the modified mass changed with it, and that pumped energy into the fine cells' modes: the acrylic sheet's velocities grew from 4 to 79 m/s between 1.8 and 2.1 s and it cracked at 2.06 s (it stays intact on both grids). With h₀ fixed, a step shorter than h₀ adds the stiffness-proportional inertia h₀²/4 K_f (a form of selective mass scaling), which slows only modes above about 2/h₀ ≈ 10⁴ rad/s and leaves rigid motions and the first modes alone.

| Check (`tests/engine/plate.test.mjs`, registry `plate.implicit.*`) | Expected | Measured | Tolerance |
|---|---|---|---|
| Stable step of the graded pane with implicit fine cells | that of the 0.1 m grid, 196.31 µs | ratio 1 − 2·10⁻¹⁵ (49.08 µs with every term explicit) | 10⁻⁹ |
| The step's own energy, ½ v (M − h²/4 K_e + (h₀² − h²)/4 K_f) v + ½ w̄ K w̄, over 1 s (5,660 steps at 0.9 of the limit) from random deflections and velocities, no damping | conserved | within 7.3·10⁻¹⁵ | 10⁻¹² |
| Momentum of a free graded plate, 2000 steps from random velocities | conserved (K_f 1 = 0) | 1.6·10⁻¹² of Σ m \|v\| | 10⁻¹⁰ |
| (1,1) mode at 0.9 of the limit | Kirchhoff 7.96018 Hz | 7.94159 Hz (−0.234 %; −0.23 % with every term explicit) | 0.25 % |
| Statics (Navier, first crack, Levy by relaxation) | do not step | the same deflection to the bit | exact |
| Checkpoint of a cracking plate with implicit cells | bit-identical | identical (factor formed again after the cracks) | bit equality |


**What it gives** (first 3 s, Node, without the Box3D world; the plain and refined labs interleaved, two runs each, load 20 to 30 from other jobs; refined = fine cells implicit):

| Preset | Real-time factor plain → refined | Cost (refined over plain) | Before (fine cells explicit) | Pieces | Broken bonds | Mean falling piece (cm²) | First crack (s) | Peak force (kN) | Peak stress (MPa) |
|---|---|---|---|---|---|---|---|---|---|
| Radial impact | 0.42–0.60 → 0.25–0.35 | 1.69–1.73× | 5.3× | 24 → 71 | 50 → 137 | 100 → 26 | 0.70547 → 0.70521 | 12.4 → 5.2 | 106.9 → 118.1 |
| Tempered breakup | 0.66–1.11 → 0.37–0.66 | 1.69–1.80× | 1.5× | 567 → 891 | 1086 → 1722 | 92 → 58 | 0.79341 → 0.77256 | 30.7 → 14.1 | 303.6 → 242.7 |
| Laminated retention | 0.21–0.27 → 0.059–0.087 | 3.09–3.54× | 2.9× | 1 → 1 | 395 → 616 | — | 0.74182 → 0.74149 | 23.3 → 11.7 | 121.1 → 128.7 |
| Thick panel | 0.17–0.23 → 0.11–0.13 | 1.52–1.80× | 6.2× | intact | 0 → 0 | — | — | 20.7 → 17.0 | 34.4 → 45.7 |
| Off-centre strike | 0.57–0.63 → 0.31–0.35 | 1.81–1.82× | 5.1× | 21 → 71 | 45 → 133 | 110 → 26 | 0.70547 → 0.70521 | 9.6 → 5.2 | 106.8 → 118.1 |
| Frosted fracture | 0.62–0.66 → 0.31–0.36 | 1.81–1.95× | 5.6× | 29 → 75 | 64 → 152 | 107 → 25 | 0.70547 → 0.70521 | 10.1 → 4.4 | 107.3 → 118.3 |
| Wired retention | 0.57–0.70 → 0.23–0.26 | 2.45–2.66× | 2.9× | 1 → 1 | 397 → 651 | — | 0.70526 → 0.70471 | 19.3 → 11.8 | 117.6 → 149.4 |
| Acrylic comparison | 1.11–1.25 → 0.48–0.57 | 2.20–2.29× | 3.8× | intact | — | — | — | 2.76 → 2.74 | 30.7 → 35.2 |

The presets whose step the bending sets now take the 0.1 m grid's step (radial impact 17,283 sub-steps in 3 s against 18,137 on the 0.1 m grid and 67,490 with the fine cells explicit) and cost 1.5 to 2.0 times the plain lab: the 57 % more nodes, the larger in-plane solve and the implicit solve (one forward and back substitution over 615 nodes per step; 51 factorizations in the radial impact's 3 s, one per crack). The goal of at most twice the plain lab is met for those five. It is not met for the three whose step the membrane sets (laminate, wire, acrylic): the fine cells' membrane rows stay explicit (the in-plane forces are a global, nonlinear function of w), so the step falls with the cell size there, and the laminate costs as much as with the fine cells explicit (31.1 s of CPU against 29.8 s for its first 3 s, run back to back: 84,054 against 103,607 sub-steps, each dearer by the implicit solve). **So fine cracks stay off by default.**

The first crack moves by at most 0.11 ms against the refined grid with every term explicit (0.70510 → 0.70521 s radial, 0.77266 → 0.77256 tempered, 0.74140 → 0.74149 laminate, 0.70467 → 0.70471 wired), the size of the step error documented for the plain lab (0.1 ms). The peak readouts move more: the contact force at the instant of breaking falls (8.3 → 5.2 kN radial) and the peak stress rises (80.2 → 118.1 MPa), because the implicit terms add inertia h₀²/4 K_f to the stiff local modes under the bob that the explicit fine step resolved; these readouts were already not converged in the time step (12.4 to 18.6 kN between 1 and 1/4 of the plain lab's step) and stay so.

**Refinement that follows running cracks: not done (2026-11-18).** Three things stand in the way, measured or read off the code: (1) cracks run fast: in the radial impact the broken bonds reach 0.14 m from the impact in the tick of the first crack (0.708 s) and the pane's edge, 1.49 m away, two ticks later (0.725 s), and the toughened pane's dicing front at 1466 m/s crosses 1.3 m in 0.9 ms, about 5 sub-steps, so refining ahead of a tip means re-gridding between sub-steps; (2) the plate's grid is a tensor grid: a finer column or row runs through the whole pane (69 % of the refined lab's nodes are in the 0.6 m cross around the impact), so refining ahead of a tip that runs at 45° adds whole lines, not a patch; a patch needs hanging nodes, which the finite-difference curvatures do not have; (3) inserting a line renumbers every node, and the lab's tiles, the renderer's meshes, the broken-bond frames, the fragments' node lists and the Box3D held-glass hulls are all indexed by node. With the fine cells implicit the refined grid costs about twice the plain one, so cost is no longer the obstacle; the discretisation is.

### Real time

The model runs in the lab's existing worker (`glass-worker.ts`, unchanged protocol; frames now carry the broken-bond array). Real-time factor = simulated / compute seconds over the 12 s program in Node 22 on this 4-core sandbox while other jobs ran (single runs; quieter machines are faster):

| Preset | Real-time factor | Worst tick (ms) |
|---|---|---|
| Radial impact | 0.92 | 152 |
| Tempered breakup | 1.90 | 179 |
| Laminated retention | 0.65 | 172 |
| Thick panel | 0.29 | 291 |
| Off-center strike | 0.82 | 79 |
| Frosted fracture | 0.69 | 447 |
| Wired retention | 0.40 | 176 |
| Acrylic comparison | 2.47 | 22 |

Below 1 the lab plays slower than real time while it computes; the recorded run replays at full speed. The cost is the explicit step on the 0.1 m grid (546 nodes, 48 sub-steps per tick at 8 mm, about 140 at 24 mm, about 100 with the stiff wire mesh), so the thick and wired panes are the slowest; once the tempered pane has diced, only falling tiles remain and it runs faster than real time. Worst ticks are the cracking ticks (many bonds, fragment hand-off) and scheduling noise from other jobs. The old convex-contact model needed 90 to 820 ms per tick (real-time factor 0.01 to 0.09) for the fractured presets. In headless Chromium with SwiftShader the page drew about two frames a second, and the lab steps the worker once per frame, so the browser run was renderer-bound (2.6 s simulated in 9 minutes); that measures the software renderer, not the model.

### Limits

- Membrane action is in the unbroken cells (von Kármán, validated against Levy above); a cracked cell carries no membrane force, and the PVB and wire bridging stay strings with the in-plane motion neglected. In-plane inertia is neglected.
- The peak contact force and peak stress readouts are not converged in the time step: at half and a quarter of the lab's step the radial impact's peak force is 1.3 and 1.5 times larger (*Speed* above). The crack time is converged to 0.1 ms.
- The bob loads one to four nodes, so the peak stress under it depends on the grid (the point-load moment of a Kirchhoff plate is logarithmically singular), and with 0.1 m cells and a 4.6 m/s strike the stress jumps by tens of MPa per sub-step: the "peak stress" readout overshoots the strength by up to 2.5× on the step the glass breaks. Hertzian contact cracks are not modelled.
- Cracks follow the grid (staircases at 45°); the irregular tile outlines are drawn, not computed. Glass fragments finer than a cell are not resolved. A grid twice as fine everywhere (52 × 40, `new GlassModel(settings, {cells: [52, 40]})`) gives 2.6 to 3.8 times more pieces at 13 to 24 times the cost. Since 2026-11-17 the grid can be refined around the impact only (`refine`, the Studio's `cracks=fine`): 0.05 m cracks within 0.3 m of the impact, about as many pieces as 52 × 40 at 1.5 to 6 times the cost; off by default. The refinement is fixed when the model is made, not adapted to the cracks as they run (*Refinement that follows running cracks: not done* above). Since 2026-11-18 the fine cells' bending is implicit and no longer sets the step; their membrane does where the membrane sets it (laminate, wire, acrylic: 2.2 to 3.5 times the plain lab), so fine cracks stay off by default.
- Laminates bend as one section before breaking (an upper bound on their stiffness); after it, the PVB is a string at its 3 s modulus (a lower bound for an impact) that never tears; in-plane displacement is neglected, so the edges act as if held in-plane. The sag is therefore uncertain by a large factor.
- Fragments collide with each other, the frame, the tray and the floor in Box3D since 2026-11-17, and with the bob, the clamp pads and the glass still held in the frame since 2026-11-18. The bob feels them (0.2 to 0.5 % of its angular momentum); the held glass does not (one-way). A shard released inside the bob's sphere is moved out by up to 72 mm, one released inside a pad falls through it until clear. They collide as hulls at least 16 mm thick and, since 2026-11-18, 6 mm wider than drawn (thin glass rests 4 mm above what it lies on and 6 mm from a neighbour edge to edge); when the toughened pane's 567 tiles rain into the tray at once two drawn tiles cross by up to 4 mm for a few ticks (their full 8 mm before the 6 mm margin). Glass-on-steel restitution 0.71 is that of a glass ball on a steel plate; a shard landing flat probably bounces less and may break further, which is not modelled. The floor's friction is the glass-on-steel value (no glass-on-concrete pair in the library, and none found in a search on 2026-11-18) and it does not bounce. Without the Box3D world (Node without the WASM, or if it fails to load in the worker) the fragments fall as before, without contacts between them.
- A shard that hangs from the pane by a hinge (a row of nodes joined to the rest through one node) has no bending stiffness against its rotation; since 2026-11-16 such shards are found (`PlateBody.heldNodes`) and handed off as falling pieces. Before, with membrane action the edge strike's hinged shard swung 12 m out of the frame.
- The pendulum passes through the cracked region; nodes it has passed are ignored.

## Elastomer lab

### The model (`src/studio/material-labs/rubber-si.ts`)

- **Specimen.** A cylinder of radius 0.58 m × scale and height 0.86 m × scale (the rig's dimensions, in metres), 625 tetrahedra (a 5 × 5 × 5 box mesh whose square section is mapped onto the disc) with the averaged nodal pressure element (`tet4-nodal`, [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#averaged-nodal-pressure-element-tet4-nodal)) and the sparse LDLᵀ preconditioner (`linearSolver: 'ldl'`), Neo-Hookean (`src/engine/solid.ts`) with a Prony series (`config.viscoelastic`, [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#viscoelasticity)), gravity on, backward Euler at 1/30 s, mass damping 2 /s.
- **Platens.** Steel platens bonded to both end faces (welds of `SolidContact`, [`SOLID_CONTACT.md`](SOLID_CONTACT.md)), as in a bonded compression test piece. The top platen is kinematic: it compresses at the set rate to the target, holds for the set time (the force relaxes), then follows the specimen with no load: its velocity is the force it feels over a damper of time constant 0.05 s on the specimen's instantaneous stiffness, capped at the loading rate, so the specimen recovers by its own creep recovery. (Releasing the weld at full load instead snapped a 65 %-compressed gel inside out in one step; the zero-load platen avoids that.)
- **Readouts.** Compression (%), platen force (kN, signed), retained volume (%); the status line gives the long-term and instantaneous moduli, the peak force and, unloaded, how much compression is still to recover.
- **Worker.** The lab steps in the shared lab worker (`lab-worker-protocol.ts`, extended to the elastomer lab).

| Profile | E long-term | Poisson's ratio | Density | Prony branches (time: ratio) | Source |
|---|---|---|---|---|---|
| Natural rubber | 1.5 MPa | 0.49 | 922 kg/m³ | 0.3 s: 0.44, 3 s: 0.42, 30 s: 0.22, 300 s: 0.13 | E and density from the library (`natural-rubber`, pure gum); spectrum of a filled rubber blend (F2) from Andena, Cotta Ramusino, Tagliabue, Zalaffi, *A visco-hyperelastic numerical model for the dynamic behaviour of rubbers*, Constitutive Models for Rubber XII (2023), Table 1, 4 terms (g = 0.20, 0.19, 0.10, 0.06, g_inf = 0.45), used as a proxy: a pure-gum rubber relaxes less |
| Neoprene | 4 MPa | 0.49 | 1230 kg/m³ | the F2 spectrum | **unverified** typical values |
| Polyurethane | 10 MPa | 0.49 | 1200 kg/m³ | the F2 spectrum | **unverified** |
| EPDM | 5 MPa | 0.49 | 1150 kg/m³ | 0.3 s: 0.76, 3 s: 0.67, 30 s: 0.36, 300 s: 0.24 | **unverified** (a stronger spectrum than F2) |
| Silicone | 1.5 MPa | 0.49 | 1150 kg/m³ | 0.3 s: 0.067, 3 s: 0.044 | **unverified** |
| Soft gel | 0.1 MPa | 0.49 | 1000 kg/m³ | 1 s: 0.67, 10 s: 0.56 | **unverified** |
| Open-cell foam | 0.1 MPa | 0 | 30 kg/m³ | 0.3 s: 0.2, 3 s: 0.13 | **unverified**; compressible Neo-Hookean |
| Memory foam | 0.03 MPa | 0 | 50 kg/m³ | 2 s: 1.8, 20 s: 1.2 | **unverified**; compressible Neo-Hookean |

Poisson's ratio 0.49 instead of rubber's 0.4999 (the library's value is 0.5): even with the nodal element the coarse mesh stiffens as ν nears 0.5 (below: 1.29 times the closed form at 0.49, 1.61 at 0.4999).

### Validation

- The viscoelastic law: the six `solid.viscoelastic.*` rows ([`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#viscoelasticity)).
- **Bonded compression of the lab's cylinder** (`tests/studio/rubber-si.test.mjs`, row `solid.bonded-compression`): at 1 % strain the apparent modulus is 2.20 MPa with the lab's `tet4-nodal` element (2.60 MPa with `tet4` before 2026-11-12) against 1.71 MPa from the bonded-block closed form `1 / E_c = 1 / (E (1 + 2 S²)) + 1 / K` (Gent and Lindley, quoted as Eq. 2 in Koblar, Škofic, Boltežar, Strojniški vestnik 60 (2014) 506-511), shape factor `S = R / (2H)` = 0.34, `K = E / (3 (1 − 2ν))`: **+29 % (was +52 %)**. The closed form assumes parabolic bulging and is not the 3-D answer for this tall specimen: refining both elements (tet4-nodal 8, 12, 16 cells across: +20.4, +16.6, +15.0 %; tet4 8, 16, 24 cells: +29.9, +18.1, +15.4 %) and extrapolating gives **1.12 times the closed form (1.92 MPa)**, so the lab mesh is **15 % too stiff** (35 % with tet4). At ν = 0.4999 the lab mesh gives 1.61 times the closed form with tet4-nodal against 18.2 with tet4. The lab's forces fell by 25 to 37 % with the change (table below); shapes and times are less affected.
- Lab checks (same file, in `test:studio:materials`, 40 s): library values reach the model; the silicone cycle's force relaxes during the hold and the unloaded specimen recovers to under 5 % with the platen force under 2 % of the peak and every step converged; foam (ν = 0) loses volume where rubber keeps it; bit-identical repeats.

### Presets (12 to 24 s programs) and real time

| Preset | Peak force (before → after) | Still compressed at the end | Real-time factor (before → after) |
|---|---|---|---|
| Silicone recovery (50 %) | 4.91 → 3.43 MN | 0.3 % | 1.67 → 3.52 |
| Rubber rebound (natural) | 8.72 → 6.10 MN | 1.6 % | 1.56 → 2.18 |
| Foam collapse (75 %) | 0.216 → 0.214 MN | 0.8 % | 3.83 → 4.66 |
| Memory-foam creep | 0.057 → 0.056 MN | 0 % (slow recovery) | 5.63 → 5.10 |
| Firm polyurethane | 41.4 → 30.0 MN | 2.4 % | 1.55 → 2.49 |
| Soft gel (65 %) | 1.32 → 0.84 MN | 16.5 % | 0.94 → 2.24 |
| Neoprene hold | 22.1 → 15.4 MN | 6.2 % | 1.71 → 3.05 |
| EPDM comparison | 15.6 → 11.7 MN | 2.0 % | 1.56 → 2.71 |

"Before" is tet4 with the diagonal-preconditioned conjugate gradients, "after" tet4-nodal with the sparse LDLᵀ preconditioner and the contact fix (welded nodes no longer meet their own platen: [`SOLID_CONTACT.md`](SOLID_CONTACT.md)); the 18 s lab program, model seconds over CPU seconds, measured back to back on each preset (`node scripts/fem-preset-benchmark.mjs rubber`, load average 10 to 15 from other jobs). The ν = 0.49 presets lose 25 to 36 % of their force with the locking; the foams (ν = 0) keep theirs within 1 % and the memory foam runs 9 % slower (the averaged element's extra pass buys nothing at ν = 0).

**2026-11-18, node-blocked factorization and substitution** (the same numbers to the bit: the final state of all eight presets hashed before and after; docs/SOLID_MECHANICS.md, Linear solver). The elastomer's factor is half dense (104,508 entries for 648 unknowns), so the substitution in each inner iteration was the largest cost (about half of the stepping time in a profile of the rubber rebound); one factorization now takes 46 instead of 75 ms and one substitution 0.20 instead of 0.33 ms. Real-time factor, median of two runs alternated with the old code, load average 15 to 17: silicone recovery 3.66 → 4.18, rubber rebound 2.35 → 2.90, foam collapse 5.54 → 6.06, memory-foam creep 5.42 → 6.85, firm polyurethane 2.55 → 3.38, soft gel 2.27 → 2.96, neoprene hold 3.28 → 4.26, EPDM comparison 2.72 → 3.83 (1.09 to 1.41 times).

**All of 2026-11-18** (node-blocked and plane-section kernels, energy reuse across friction passes, the contact line search's step to first touch; docs/SOLID_CONTACT.md), against the code before it, median of two alternated runs, load average 28 to 29: silicone recovery 3.49 → 3.96, rubber rebound 1.99 → 2.87, foam collapse 4.88 → 6.18, memory-foam creep 4.93 → 6.15, firm polyurethane 2.45 → 2.89, soft gel 2.20 → 2.82, neoprene hold 3.39 → 3.90, EPDM comparison 2.67 → 3.11 (1.14 to 1.44 times). Seven presets end in the same state to the bit; the soft gel's final shape moves by 6e-9 of its largest displacement and its peak force by 4e-8 (the line search takes another path within the solve tolerance).

Before this change, in headless Chromium serving the built site, the worker reported 1.32 times real time for the silicone cycle (not re-measured in the browser). The forces are those of a 1.16 m wide specimen (the rig's scale), not of a standard 29 mm test piece.

### Limits

- Mesh stiffness (above): 15 % too stiff in bonded compression against the converged solution (the 5-cell mesh; 8 cells would give about 7 % and cost about 20 times more per factorization); incompressibility is approximated by ν = 0.49, so rubber loses up to 7 % volume at 50 % compression where a real one loses a fraction of a percent.
- The Prony model is stress-based (not objective under large rotation while an overstress remains); one spectrum, borrowed from a filled blend, stands for natural rubber, neoprene and polyurethane; the other spectra and most moduli are unverified.
- Foams are compressible Neo-Hookean solids: no cell buckling plateau, no densification, no permanent set. Mullins softening, heat build-up, platen friction (the platens are bonded) and rate effects beyond the Prony series are not modelled.

## Concrete crush

### The law (`src/engine/concrete-law.ts`, solver id `solid-tet-dp-rankine-js-f64-v1`)

Composite plasticity on the J2 structure of the solid (Green-Lagrange strain, return mapping from the committed state, erosion), described in [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#concrete-law):

- **Compression:** `q r(theta) = k(kappa_c) Psi(xi / f_cm)`. The meridian Psi is EN 1992-1-1 3.1.9 ((3.24) and (3.25), opened in the scanned standard); r(theta) the Willam-Warnke section with the equal-biaxial strength 1.16 f_c (Kupfer, Hilsdorf and Rüsch 1969, abstract opened). Elastic to 0.4 f_cm, then k follows EN 1992-1-1 (3.14) to f_cm at eps_c1 and eps_cu1 in uniaxial compression, then a tail of area G_c = f_cm × 0.5 mm / 2 on the crack band.
- **Non-associated flow:** plastic potential `q r(theta) + psi p` with psi = tan 30° (Isakov 2025 review of concrete damaged plasticity parameters), each step solved as an associated problem with the pressure of the last step (no unsymmetric solver). Under lateral pressure the law gains EN 1992-1-1's 1.25 and 1.625 f_cm at 0.05 and 0.2 f_cm within 0.4 %.
- **Tension:** Rankine on each principal stress, linear softening in the crack opening w = kappa_t h with the area G_f = 73 f_cm^0.18 N/m (fib Model Code 2010, quoted in Sucharda 2020; the Model Code was not opened).
- **Reinforcement:** truss bars embedded in the tetrahedra with perfect bond, B500B steel (E_s 200 GPa, f_yk 500 MPa, k 1.08, eps_uk 5 %: EN 1992-1-1 3.2.7 and Table C.1), elastic-plastic with the hardening of the inclined branch of 3.2.7 (2) a) (842 MPa).
- **Damage** shown in the lab is the strength lost: `1 - k / k_peak` after the compressive peak, `1 - f_t / f_t0` in tension. Unloading is elastic (plasticity, not secant damage); cracks do not close.
- **Erosion.** An element erodes when its compressive strength reaches zero (crushed) or its crack is 1 mm wide. In the lab an element left without a face neighbour (hanging by an edge or a corner) is removed too (`SolidBody.erode`).

### The lab model (`src/studio/material-labs/concrete-si.ts`)

- **Specimen.** The 150 mm cube of EN 12390-3 (control: 100 or 150 mm), 5 × 5 × 5 cells of 5 tetrahedra (625 elements, band width 30 mm), drawn **eight times larger** (a 150 mm cube is drawn 1.2 m wide in the rig). A seeded scatter of element strength (normal, coefficient of variation 8 %, 15 % for the weathered mix, 5 % for C60/75 and ceramic) decides where it cracks; the specimen seed control changes it.
- **Platens.** A static steel plane below and a kinematic steel box above through `SolidContact` with Coulomb friction 0.2 (control 0 to 0.6). 0.2 is the coefficient Středulová and Eliáš use between steel platens and concrete in their model of the compression test ("based on previous calibration ... a commonly considered value for contact of steel and concrete": *On the effect of friction in testing of small-scale concrete cylinders*, Engineering Mechanics 2023, Milovy, p. 239, [PDF](https://engmechy.it.cas.cz/improc/2023/239.pdf), opened): a calibrated model input, **not a measurement**. Measured coefficients of steel plate on concrete or grout cast against it are higher: 0.43 to 0.70 in the studies reviewed by Gomez, Kanvinde and Deierlein (AISC Engineering Journal 2011, [PDF](https://ej.aisc.org/index.php/engj/article/download/1021/1020), opened: Rabbat and Russell 1985, Baltay and Gjelsvik 1990, Cook and Klingner 1992 with a mean of 0.43 from 44 tests, Nagae et al. 2006 with 0.52, their own 0.46 at up to 2.7 MPa), none of them on a machined platen at 30 to 60 MPa. The lab used 0.57 until 2026-11-16; see the cube-to-cylinder rows below for what each value gives. The contact step starts from the free motion (`predictor: 'velocity'`) so the solve follows the loading path.
- **Program.** Displacement control: the platen moves down at the set rate (‰ of the edge per second) to the set travel and holds. Backward Euler at 1/30 s. The test is quasi-static: the law has no rate effect and the cube's inertia is negligible at these platen speeds, so the simulated test runs faster than the EN 12390-3 rate (0.6 MPa/s) and gives the same curve. After the peak, a step that finds no equilibrium (the cube gives way faster than the platen moves) is undone and the machine stops there, as testing machines stop on a load drop; it also stops when the load falls below 30 % of the peak.
- **Readouts.** Stress (MPa, platen force over the loaded area), strain (% of the edge), platen force (kN); a stress-strain chart of the run against the EN 1992-1-1 (3.14) cylinder curve of the mix; the status line gives the peak and how many elements spalled. Colour: grey to red by the strength lost; spalled elements are removed.
- **Material panel.** f_cm, f_ctm, E, ν, ρ, eps_c1 / eps_cu1 and G_f as the model uses them, and what is sourced.
- **Worker.** The lab steps in the shared lab worker.

| Studio mix | Runs as | Source |
|---|---|---|
| Standard | C30/37: f_cm 38, f_ctm 2.9 MPa, E_cm 32.8 GPa, eps_c1 2.2 ‰, eps_cu1 3.5 ‰, G_f 141 N/m | library (`concrete-c30-37`), EN 1992-1-1 Table 3.1, fib MC2010 G_f |
| High strength | C60/75: 68 / 4.35 MPa, 39.1 GPa, 2.6 / 3.0 ‰, 156 N/m | library (`concrete-c60-75`) |
| Reinforced | C30/37 with four 10 mm corner bars (axes on a square of 0.6 a, ending a / 15 short of the loaded faces) and 6 mm square links at a third and two thirds of the height, B500B, perfect bond; the bars are drawn as dark lines through the concrete and the status line gives the most stressed bar in % of f_yk | concrete and steel: library; the bar layout is **authored** |
| Fibre | C30/37 matrix with a fibre tension softening (half f_t at 0.05 mm, 0.3 f_t at 2.5 mm, zero at 5 mm; G_f ≈ 4 kJ/m²) | matrix: library; fibre softening **unverified** |
| Lightweight | LC25/28, density class 1.8, sanded: f_lcm 33, f_lctm 2.28 MPa, E_lcm 21.1 GPa, eps_lc1 = eps_lcu1 = 1.64 ‰, 1850 kg/m³ | library (`concrete-lc25-28`, EN 1992-1-1 section 11); eps_lc1 from a garbled scan (stated), G_f **unverified** |
| Mortar | C20/25: 28 / 2.21 MPa, 30.0 GPa, 2.0 / 3.5 ‰, 133 N/m | library (`concrete-c20-25`); the mapping of a mortar onto a concrete class is **unverified** |
| Weathered | C20/25 with a 15 % strength scatter | **unverified** mapping |
| Technical ceramic | 96 % alumina: E 330 GPa, ν 0.22, 3750 kg/m³, compressive 2000 MPa, flexural 300 MPa, K_IC 3.5 MPa√m (G_f = 35 J/m²), elastic to the peak | library (`alumina-96`, Syalons Aloxalon 96, Morgan AL600); tensile strength taken as the flexural strength and the friction parameter of concrete: **unverified**. On 20 mm elements its softening has to be stretched (it would snap back), so it dissipates far more than G_f |

### Hand numbers (C30/37, 150 mm cube)

- Elastic slope: 33 GPa × 0.15² / 0.15 = 4.9 GN/m; 1 ‰ of travel (0.15 mm) ≈ 0.74 MN, 33 MPa before plasticity.
- f_cm on 150² mm² = 0.855 MN. EN 1992-1-1 Table 3.1 gives the cube strength f_ck,cube / f_ck = 37 / 30 = 1.23, i.e. about 47 MPa (1.06 MN) on the mean.
- Crushing energy G_c = 38 MPa × 0.5 mm / 2 = 9.5 kJ/m², 214 J across the section.

### Validation

Engine rows (`tests/engine/solid-concrete.test.mjs` in `npm run test:solid`; rows `solid.concrete.*` of [`VALIDATION.md`](VALIDATION.md); details in [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#concrete-validation)):

| Check | Reference | Measured | Tolerance |
|---|---|---|---|
| One cell, h = L_c, uniaxial compression: peak, strain at the peak | f_cm = 38 MPa, eps_c1 = 2.2 ‰ (Table 3.1) | 37.92 MPa, 2.20 ‰ | 0.5 %, 2 % |
| Largest difference from (3.14), 0 to eps_cu1; stress at eps_cu1 | 0; 24.65 MPa | 2.3 % of f_cm; 24.64 MPa | 3 % of f_cm; 2 % |
| Energy to break a bar in tension, 5, 10, 20 cells | 0.98 G_f A | 0.9999 of it on each | 1 % |
| One crushed cell of h = 120, 60, 30 mm: plastic work after the peak per unit area | G_c = 9.5 kJ/m² | within 2 % | 2 % |
| Lateral pressure 0.05 and 0.2 f_cm, then axial compression | EN 1992-1-1 (3.24), (3.25): 1.250, 1.625 f_cm | 1.2469, 1.6199 f_cm | 1 % |
| Equal biaxial compression | 1.16 f_c (Kupfer et al. 1969) | 1.1585 f_cm | 1 % (fitted) |
| Plastic volume change per kappa_c | psi = tan 30° (potential), below the meridian slope 1.71 | psi to 1e-15 | 1e-9 |
| Strength factors 0.8, 0.9, 1.1 (since 2026-11-18) | f f_cm uniaxial, f f_ctm, 1.16 f f_cm equal-biaxial | 0.998 f f_cm, 1.0001 f f_ctm, 1.1585 f f_cm | 0.5 %, 0.5 %, 1 % |
| Reinforced tie through cracking to yield | one-dimensional series model | 1.6 % of A_s f_y | 3 % |
| Reinforced beam: cracking moment; yield moment | 1993 N m; 4515 N m (hand) | 1950 to 2112 N m; 4553 N m | 6 %; 5 % |
| Return mapping in every regime; checkpoint resume (local, nonlocal, reinforced) | derivative of the energy; bit-identical | pass | 1e-6; exact |

Misses: Kupfer's 1.27 f_c at sigma_2 / sigma_1 = 0.5 (the law gives 1.39). Since 2026-11-17 the engine's crack band is per element and compressive softening localises in one band of elements (SOLID_MECHANICS.md, section Crack band and the mesh study); the lab does not use that softening surface (below).

**Strength factors (2026-11-18, a bug fix).** The lab's strength scatter (`setStrengthFactors`, one factor per element) scaled the compression surface's k but read the meridian at xi / f_cm instead of xi / (f f_cm), so an element of factor 0.9 peaked at 0.794 f_cm in uniaxial compression and one of 1.1 at 1.27 f_cm: the scatter was about 2.3 times as wide in compression as its stated coefficient of variation (8 %, 15 % for the weathered mix, 5 % for C60/75 and ceramic), while tension and the fracture energies scaled by f exactly. The factor now scales the whole surface in stress space (`q r = f k Psi(xi / (f f_cm))`): a cell of factor 0.8, 0.9 and 1.1 peaks at 0.998 f f_cm in uniaxial compression (rows `solid.concrete.strength-factor-*`, 0.5 %; before: 0.788, 0.881, 1.151), at f f_ctm in tension (1.00008) and at 1.1585 f f_cm in equal-biaxial compression (1.050 before at 0.9). Every preset's full program (`duration` 14 s at 1/120 s, `postPeak: 'lagged'`, Node 22, three runs at a time on the shared machine at a load average of about 12):

| Preset | Before: peak, strain at peak, stress at the end | After | Peak |
|---|---|---|---|
| Cube compression | 49.109 MPa, 2.750 ‰, 34.83 MPa at 7.0 ‰ | 49.258 MPa, 2.767 ‰, 35.42 MPa | +0.30 % |
| Reinforced core | 58.473 MPa, 3.533 ‰, 47.10 MPa | 58.610 MPa, 3.533 ‰, 47.39 MPa | +0.23 % |
| High-strength cube | 87.580 MPa, 3.267 ‰, 69.06 MPa at 6.0 ‰ | 87.739 MPa, 3.283 ‰, 69.36 MPa | +0.18 % |
| Lightweight crush | 41.349 MPa, 2.417 ‰, 24.87 MPa | 41.499 MPa, 2.400 ‰, 25.55 MPa | +0.36 % |
| Weathered spall | 35.683 MPa, 2.500 ‰, 23.03 MPa | 35.916 MPa, 2.467 ‰, 25.00 MPa | +0.65 % |
| Fibre bridging | 49.109 MPa, 2.750 ‰, 34.84 MPa | 49.258 MPa, 2.767 ‰, 35.42 MPa | +0.30 % |
| Low-strain comparison (stops at 1.5 ‰, before the peak) | 40.481 MPa | 40.620 MPa | +0.34 % |
| Ceramic comparison | 2062.0 MPa, 6.20 ‰; no equilibrium past the peak, 327 spalled | 2141.8 MPa, 6.43 ‰; no equilibrium past the peak, 293 spalled | +3.87 % |
| Cube / cylinder (the test's program, 1 ‰/s to 3.4 ‰) | 49.149 / 40.836 MPa = 1.2036 (cube at 2.63 ‰, cylinder at 2.53 ‰) | 49.325 / 40.951 MPa = 1.2045 (2.70 ‰, 2.23 ‰) | ratio +0.07 % |
| Short cylinder / cylinder | 47.532 / 40.836 = 1.1640 | 47.627 / 40.951 = 1.1630 | -0.09 % |

The concrete peaks move by +0.2 to +0.7 %: at the cube's peak 473 of its 625 elements are past their own peak (kappa_c), so the peak is that of the mean strength, and a narrower scatter in compression raises it a little (fewer weak elements yield early and shed load). The ceramic, elastic to its peak and brittle, is governed by its weakest elements, and gains 3.9 %. The cube-to-cylinder ratio stays at 1.20 against EN 1992-1-1 Table 3.1's 37 / 30 = 1.233 (-2.3 %, tolerance 5 %): the explanation below (platen friction 0.2 confining the 5-cell cube) is unchanged. (Table 3.1 gives 1.25 for C20/25 and C60/75; the row checks C30/37 only.) The cylinder's peak moved from 2.53 to 2.23 ‰: its curve is within 0.5 % of the peak from about 2.2 to 2.6 ‰, so the step that carries the largest load moves with small changes. The cost is unchanged (cube program 26.9 s of CPU before, 28.5 s after, same load).

**Crack band and the lab (2026-11-17).** The engine's default after the compressive peak is now the softening surface of the crack band (`postPeak: 'band'`): no lateral plastic strain, so a crushed band stays one element thick, and G_c per unit area. The lab keeps `postPeak: 'lagged'` (`CONCRETE_POST_PEAK` in `concrete-si.ts`), the law it was validated with, because the softening surface moves its peaks: the elements of the strength scatter pass their own peak before the cube does, and whether they then dilate changes the cube's peak. Each preset's full program (`duration` 14 s at 1/120 s), before the change, with the lab as it is now, and with `'band'` (Node 22, the shared machine at a load average of 25 to 35; measured before the strength-factor fix above):

| Preset | Before: peak, strain at peak, stress at the end, how it ended | Now (`'lagged'`) | With `'band'` |
|---|---|---|---|
| Cube compression | 49.109 MPa, 2.75 ‰, 34.83 MPa at 7.0 ‰, no stop | identical | 51.944 MPa (+5.8 %), 2.55 ‰; stops at 3.52 ‰ (load below 30 %) |
| Reinforced core | 58.473 MPa, 3.53 ‰, 47.10 MPa at 7.0 ‰, no stop | identical | 60.397 MPa (+3.3 %), 2.67 ‰; stops at 3.72 ‰, 14 elements spalled |
| High-strength cube | 87.580 MPa, 3.27 ‰, 69.06 MPa at 6.0 ‰, no stop | identical | 88.973 MPa (+1.6 %), 2.95 ‰; stops at 3.65 ‰ |
| Lightweight crush | 41.349 MPa, 2.42 ‰, 24.87 MPa at 7.0 ‰, no stop | identical | 39.421 MPa (-4.7 %), 2.03 ‰; stops at 3.07 ‰ |
| Weathered spall | 35.683 MPa, 2.50 ‰, 23.03 MPa at 7.0 ‰, no stop | identical | 39.575 MPa (+10.9 %), 2.43 ‰; stops at 3.53 ‰ |
| Fibre bridging | 49.109 MPa, 2.75 ‰, 34.84 MPa at 7.0 ‰, no stop | identical | 51.944 MPa (+5.8 %), 2.55 ‰; stops at 3.52 ‰ |
| Low-strain comparison | 40.481 MPa at 1.50 ‰ (stops before the peak) | identical | identical |
| Ceramic comparison | 2062.0 MPa, 6.20 ‰; no equilibrium past the peak, 327 elements spalled | identical | 1925.1 MPa (-6.6 %), 5.83 ‰; no equilibrium past the peak, 37 spalled |

"Identical" is to the printed digits of peak, strain at the peak, the stress at 1.5 and 2 times that strain, the post-peak area of the curve and the end state. With `'band'` every C30/37-family preset crushes and the machine stops on the load drop within the program (before: softening to the end, no stop, no spalling); the post-peak area of the curve falls to a fifth (cube: 3.82 against 18.72 MPa·%). A dilatancy after the peak that keeps the peaks does not localise in a band: psi kept at tan 30° moves them by -0.4 % to -5.3 % (lightweight) but the prism of SOLID_MECHANICS.md then dissipates 1.6 to 3.3 times G_c. The lab's cylinder (the cube-to-cylinder rows) gives no `bandWidth`, so its tension band is now per element; the cube's is the cell size as before.

**A post-peak law for the lab (2026-11-18): not found; the lab keeps `'lagged'`.** The aim was a law that localises in one band (the engine's mesh study within 5 % of G_c A sigma_peak / f_cm) and moves no preset peak by more than 1 % from the `'lagged'` values above. With the strength-factor fix the softening surface (`'band'`) still moves them by -6.0 to +7.2 % (full 14 s programs, three runs at a time, load average 12 to 28):

| Preset | `'lagged'` (the lab) | `'band'` | Peak |
|---|---|---|---|
| Cube compression | 49.258 MPa at 2.77 ‰, softening to the end | 51.467 MPa at 2.48 ‰; stops at 3.50 ‰ (load below 30 %) | +4.5 % |
| Reinforced core | 58.610 MPa at 3.53 ‰ | 59.925 MPa at 2.62 ‰; stops at 3.68 ‰, 5 spalled | +2.2 % |
| High-strength cube | 87.739 MPa at 3.28 ‰ | 88.874 MPa at 2.93 ‰; stops at 3.63 ‰ | +1.3 % |
| Lightweight crush | 41.499 MPa at 2.40 ‰ | 39.568 MPa at 1.97 ‰; stops at 3.02 ‰ | -4.7 % |
| Weathered spall | 35.916 MPa at 2.47 ‰ | 38.508 MPa at 2.28 ‰; stops at 3.45 ‰ | +7.2 % |
| Fibre bridging | 49.258 MPa at 2.77 ‰ | 51.468 MPa at 2.48 ‰; stops at 3.50 ‰ | +4.5 % |
| Low-strain comparison | 40.620 MPa | 40.620 MPa | 0 |
| Ceramic comparison | 2141.8 MPa at 6.43 ‰, 293 spalled | 2012.7 MPa at 6.00 ‰, 10 spalled | -6.0 % |
| Cube / cylinder (1 ‰/s to 3.4 ‰) | 49.325 / 40.951 = 1.2045 | 51.458 / 41.944 = 1.2269 (one cylinder step without equilibrium) | |

Why the peaks move. At the cube's peak (`'lagged'`, 2.77 ‰) 479 of its 625 elements are past their own peak in kappa_c, by up to 1.96 times kappa_c at the peak, yet none has lost more than 0.6 % of its strength (median 0.1 %): the EN 1992-1-1 curve is flat at the peak and on the 30 mm band its descending branch is slow, and under the platens' confinement an element's stress still rises past its peak in kappa_c (EN 1992-1-1 (3.26) moves the confined peak strain to (f_ck,c / f_ck)² eps_c2; this law does not). The cube's peak is that of hundreds of such elements. `'band'` switches each of them to the softening surface at its peak in kappa_c: its confinement is frozen there and it stops expanding sideways (no lateral plastic strain). How much it then expands decides the cube's peak (measured on 2026-11-17, before the fix: 48.91 MPa with the dilatancy kept, 49.64 with none, 51.94 with -1.5, against 49.11 `'lagged'`), and freezing the confinement alone costs the lightweight cube 5.3 %, whose straight post-peak tail makes its elements soften before the cube peaks. So a law that keeps the peaks within 1 % must leave these elements on the lagged-pressure surface (dilatant, confinement following the pressure) until after the cube's peak. In the engine's prism that same post-peak dilatant flow does not localise: the weak zone keeps expanding against the stronger ends and its elements lock (the plastic volume change of linear tetrahedra), so its stress keeps rising and the softening spreads. Tried (`postPeak` variants in a scratch copy, not kept; prism energies over G_c A sigma_peak / f_cm on 10 × 1 × 1, 20 × 1 × 1, 40 × 1 × 1, 20 × 2 × 2; gate 0.95 to 1.05):

| Switch to the softening surface when | Prism | Studio cube (`'lagged'`: 49.258 MPa) |
|---|---|---|
| kappa_c passes the peak (`'band'`) | 1.011, 1.025, 1.045, 1.009 (40 × 2 × 2: 1.005; 20 × 4 × 4: 0.990) | 51.467 MPa, +4.5 % |
| past the peak, the element's q r + psi_s p falls in a step in which it flows (its own stress peak) | 1.043, 1.103 (four cells crush, 26 steps without equilibrium), 1.072, 1.014; peaks up to 41.5 MPa, above f_cm, from the locked dilatant flow | still rising at the end of the test program, 54.04 MPa at 3.4 ‰ (+9.7 %): the few elements that switch early (their measure dips) stop expanding and stiffen the cube |
| the element has lost 0.25 % or 1 % of its strength on the lagged-pressure table | 1.48, 1.30, 2.44, 1.31; with 1 %: 1.15, 0.79, 2.42, 0.61 (no band crushes on three meshes within 6 ‰) | not run (fails the prism) |
| its axial plastic strain past the peak reaches 0.5 or 1 ‰ (a strain, not an opening) | 0.99, 1.24, 1.15, 0.97; 1.21, 0.96, 1.14, 0.95; bands crush in the end cells, not the weak zone | not run |
| kappa_c reaches (f_ck,c / f_ck)² times its peak value (EN 1992-1-1 (3.26), f_ck,c from the committed pressure) | 0.977, 0.994, 0.999, 1.113; the band forms outside the weak zone on every mesh (the zone is the most confined) | not run |

The cost of any delay is set by the flat top of the curve: losing 0.1, 0.5 and 1 % of the strength on an element's own band dissipates 3.2, 7.5 and 10.8 % of G_c (C30/37; 2.0, 4.6 and 6.6 % for C60/75; 0.2, 1.0 and 2.0 % for LC25/28), in every element that gets there before one band wins. And the 1 % target is about the mesh dependence of the `'lagged'` peak itself: the cube on 10 × 10 × 10 cells (5000 elements, the same scatter law) peaks at 48.621 MPa at 3.07 ‰ with `'lagged'` (-1.3 % from 5 cells) and 50.612 MPa at 2.48 ‰ with `'band'` (+4.1 % over `'lagged'`, +4.5 % on 5 cells). What would be needed: a peak strain that grows with confinement in the hardening law itself (EN 1992-1-1 (3.26)), which moves the lab's peaks by design, or a regularisation that does not rely on the post-peak flow rule (an implicit-gradient average, or an element that does not lock under dilatant plastic flow); neither would keep the present peaks within 1 %, since the `'lagged'` peaks probably contain some of that locked post-peak flow too (inferred from the prism, not measured in the cube).

Studio rows (`tests/studio/concrete-si.test.mjs` in `npm run test:studio:materials`, 8 tests; the cube, cylinder and short-cylinder runs take 29 s of CPU together at a load average of about 12):

| Check | Reference | Measured |
|---|---|---|
| Cube with frictionless platens | f_cm at eps_c1 | 37.82 MPa at 2.20 ‰ (37.55 before the strength-factor fix) |
| Cube against the 150 × 300 mm cylinder (O-grid, 1260 tetrahedra), platen friction 0.2 (row `solid.concrete.cube-cylinder`) | f_ck,cube / f_ck = 37 / 30 = 1.233 (EN 1992-1-1 Table 3.1) | 49.33 / 40.95 MPa = **1.2045** (-2.3 %, tolerance 5 %); every step of both converges |
| A 150 × 150 mm cylinder against the 150 × 300 mm one, friction 0.2 (row `solid.concrete.cylinder-slenderness`) | 1.17: the slenderness-1 correction of ČSN EN 12390-3/Z1 as quoted by Středulová and Eliáš (2023), who measure and compute about 1.23 on 50 mm cylinders | 47.63 / 40.95 MPa = **1.163** (-0.6 % of 1.17, tolerance 3 %; 5 % below their 1.23) |
| The same cube and cylinder at friction 0.57 (not a row) | 1.233 | 60.02 / 41.88 MPa = 1.433, a miss (+16 %) |
| Default program (friction 0.2) | peak above f_cm (EN 1992-1-1's mean cube strength is about 38 × 37 / 30 = 46.9 MPa), softening | 49.33 MPa (1.30 f_cm) at 2.70 ‰ at 1 ‰/s; then stable softening to 27.3 MPa at 8 ‰ with every step in equilibrium: the machine does not stop and no element spalls within the program |
| Reinforced core at 1.2 ‰ | stiffer than plain; corner bars in compression | 852 kN against 779 kN; 36 of 84 bar segments in compression, the most stressed at 50 % of f_yk |
| Cylinder mesh | volume of the 12-sided prism; no flat element | exact to 1e-12; smallest volume over the cube of the longest edge 0.05 or more |

**The cube-to-cylinder ratio depends on the platen friction, and the row is conditional on it.** With the EN 1992-1-1 3.1.9 meridian, platen friction confines the 5-cell cube strongly: 1.58 f_cm at friction 0.57 against 1.29 f_cm at 0.2, while the cylinder (slenderness 2) gains 10 % and 7 %. The measured friction coefficients opened for steel on concrete (0.43 to 0.70, above) would make the cube 1.4 times the cylinder; the code's 37 / 30 is met within 2.4 % with 0.2, the value another model of the same test was calibrated to, and that value also gives the slenderness correction of ČSN EN 12390-3/Z1 within 0.5 %. So the row `solid.concrete.cube-cylinder`, withdrawn on 2026-11-12, is back with friction 0.2, and says so: it does not show that a machined platen has a friction of 0.2, only that the law and the lab reproduce the two ratios with a friction a published compression-test model uses. The first version compared the cube with a square prism (1.17) because the mapped cylinder mesh of the elastomer lab did not converge at its first contact; the O-grid mesh (`cylinderMeshOgrid`: an inner square and four blended blocks, triangular prisms split by node order so neighbours agree) converges from the first step.

### Presets and real time

Re-measured with platen friction 0.2, the `ldl` preconditioner, the faster return mapping and the principal-axes consistent tangent of 2026-11-16 (`node scripts/fem-preset-benchmark.mjs concrete`: the first 14 s of each program at its own rate, Node 22, single runs on the shared 4-core machine at a load average of about 15); peaks, strains and spalled elements since the strength-factor fix of 2026-11-18 (above), real-time factors of 2026-11-16:

| Preset | Peak stress | at | State at 14 s | Spalled | Real-time factor | Worst tick |
|---|---|---|---|---|---|---|
| Cube compression (C30/37, 0.5 ‰/s) | 49.3 MPa | 2.77 ‰ | softening, no stop | 0 | 0.61 | 0.72 s |
| Reinforced core (C30/37, B500B bars) | 58.6 MPa | 3.53 ‰ | softening, no stop | 0 | 0.58 | 0.42 s |
| High-strength cube (C60/75) | 87.7 MPa | 3.28 ‰ | softening, no stop | 0 | 0.98 | 0.45 s |
| Lightweight crush (LC25/28) | 41.5 MPa | 2.40 ‰ | softening, no stop | 0 | 0.68 | 0.25 s |
| Weathered spall (C20/25) | 35.9 MPa | 2.47 ‰ | softening, no stop | 0 | 0.49 | 0.52 s |
| Fibre bridging | 49.3 MPa | 2.77 ‰ | softening, no stop | 0 | 0.70 | 0.36 s |
| Low-strain comparison (1.5 ‰) | 40.6 MPa | 1.50 ‰ | holding | 0 | 3.3 | 0.28 s |
| Ceramic comparison (alumina) | 2142 MPa | 6.43 ‰ | stopped: no equilibrium past the peak | 293 | 2.7 | 2.8 s |

**Speed.** The same peaks and strains as before the change, to the printed digits. A profile of the cube across its peak (`--cpu-prof`) put 88 % of the time in the Willam-Warnke deviatoric return: its Lode-angle Newton used a finite-difference r'' (three section evaluations per iteration) and a stopping test tighter than the rounding of its own residual, so most returns bisected down to 1e-16 (26 iterations on average). With the exact r'', a stopping test at that rounding and a warm start from the previous multiplier of the same trial it takes 2.1 iterations; the finite-difference tangent reuses the base return of the evaluation and brackets the six perturbed multipliers. The first 3.5 s of the cube at 1 ‰/s (through the peak), old and new interleaved on the same machine: 128.0 and 130.6 s of CPU before, 14.5 and 14.0 s after, **9.0 times faster**, with the same Newton and inner iteration counts (3287 and 12,583) and the same peak (49.1488 MPa) and end stress (48.3308 MPa); the state agrees to rounding, not to the bit. The 14 s cube program: 606 s of CPU before (load 17 to 20) and 61 s after (load about 12). **Tangent (later on 2026-11-16).** The finite-difference tangent (six tensor returns per yielded element and Newton iteration, half the time after the change above) is replaced by the consistent tangent in the principal axes (`ConcreteReturn.tangent`, [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#concrete-law)): closed form for a compression return, three principal returns where Rankine flows, the rotation part exact, the evaluation's principal data reused. Old and new back to back (`scripts/fem-preset-benchmark.mjs concrete`, load about 15): every C30/37-family preset 2.1 to 2.4 times faster, the same peaks and strains to the printed digits and no failed step (cube 0.27 → 0.61 times real time, reinforced core 0.26 → 0.58, high strength 0.42 → 0.98, lightweight 0.29 → 0.68, weathered 0.23 → 0.49, fibre 0.29 → 0.70, low strain 1.4 → 3.3); the first 3.5 s of the cube at 1 ‰/s: 11.1 / 11.2 s of CPU before, 5.2 / 5.8 s after, the same Newton iterations (3287) and inner iterations within 4 of 12,583. The ceramic comparison peaks at the same 2062 MPa at 6.20 ‰ and stops the same way, but after the stop it sheds 327 elements instead of 229 and runs at 2.7 instead of 4.1 times real time: its brittle collapse past the peak follows a different path with a different tangent. The concrete presets are now at about 0.5 to 1 times real time on this loaded machine; what is left is the return mapping of the evaluations and about 30 Newton iterations per step while elements soften.

**Solver changes of 2026-11-18** (node-blocked kernels, energy reuse across friction passes, the contact line search's step to first touch; docs/SOLID_MECHANICS.md, docs/SOLID_CONTACT.md). Real-time factor against the code before them, median of two alternated runs: cube compression 0.67 → 0.71, reinforced core 0.59 → 0.63, high strength 1.08 → 1.18, lightweight 0.68 → 0.75, weathered 0.48 → 0.51, fibre 0.69 → 0.74, low strain 3.01 → 3.33 (1.06 to 1.10 times), ceramic comparison 2.74 → 0.99 (below; load average 4 to 28). Most of the stepping time is the concrete law's return mapping (about half of the stepping time in a profile of the cube, its tangent about another eighth), which these changes do not touch, so the gain is small and the C30/37-family presets stay near or below real time on this loaded machine. The answers: the seven other presets' final shapes agree within 5e-7 of the largest displacement, their damage within 3e-7, their equivalent plastic strain within 5e-6 of its largest value (low-strain comparison; the others within 2e-7) and their peaks within 6e-9.

**The ceramic comparison past its peak.** The peak (2062 MPa at 6.20 ‰), the strain at which the machine stops (6.23 ‰) and why (no equilibrium past the peak) are unchanged; the one step accepted after the peak lands on another equilibrium of the brittle collapse: 82 eroded elements and 1745 MPa where it was 327 and 606 MPa. That step's state depends on the solver, not only on this change: with the code before it, tolerances of 2e-6, 1e-6, 5e-7 and 2e-7 give 169, 327, 307 and 271 eroded elements at 1247, 606, 681 and 1003 MPa; with this code 279, 82, 102 and 81 at 826, 1745, 1623 and 1666 MPa. Read the ceramic's post-peak readout as "collapsed", not as a number. On the new branch the step that then finds no equilibrium (and is undone when the machine stops) costs 80 Newton iterations and 1529 energy evaluations, 18.7 s, against 79 and 466, 3.2 s, before: the preset runs at 0.99 instead of 2.74 times real time, with an 18 to 28 s tick at the stop.

With the first law (2026-11-12) the cube peaked at 45.0 MPa and the machine stopped at 7.2 ‰ with 2 elements spalled, at 0.37 to 0.53 times real time; with this law and friction 0.57 it peaked at 60.0 MPa and stopped at 7.4 ‰. With friction 0.2 no preset loses equilibrium within its program, so none ends in a machine stop or a spalled element: the "spalling" of the preset names is not reached. In headless Chromium (SwiftShader) an earlier build of the reinforced core drew its bars through the concrete and ran without console errors (captures `reinforced-ready.png`, `reinforced-running.png`); the page was not re-captured for this change.

### Limits

- The lab keeps the lagged-pressure surface after the compressive peak (`postPeak: 'lagged'`), which does not localise compressive softening in a band: its post-peak curve depends on the 30 mm cells (see above and SOLID_MECHANICS.md, section Crack band); the softening surface moves its peaks by -6.0 to +7.2 %, and no switching rule tried keeps them within 1 % and localises (above); the 5-cell cube cannot resolve the cones of a crushed cube or splitting cracks finer than 30 mm.
- The platen friction 0.2 is a calibrated input of another model, not a measured coefficient; with the measured steel-on-concrete values (0.43 to 0.70) the cube would be about 1.4 times the cylinder instead of 1.23.
- Kupfer's biaxial strength at sigma_2 / sigma_1 = 0.5 is overestimated (1.39 against 1.27 f_c).
- Cracks unload elastically and keep their opening (plasticity, not damage); no crack closure, friction on cracks, aggregate interlock, creep, shrinkage, rate or size effects beyond the crack band.
- Bars have perfect bond: no slip, no dowel action, no rupture at eps_uk; the bar layout of the reinforced preset is authored. The fibre softening, the mortar and weathered mappings and the ceramic's tensile strength and friction are unverified.

## Reproduce

```sh
npm run test:plate
node --test tests/studio/material-labs.test.mjs       # the Studio's labs, glass in SI (about 4 minutes)
node --import ./scripts/register-typescript.mjs --test tests/studio/glass-worker.test.mjs
node --test tests/studio/glass-fragments.test.mjs     # fragments in the Box3D world (about 2 minutes)
node --test tests/studio/glass-refine.test.mjs        # the grid refined around the impact
node scripts/fem-preset-benchmark.mjs glass --seconds 3   # real-time factors and state hashes of the glass presets
node --test tests/studio/rubber-si.test.mjs           # the elastomer lab
node --test tests/studio/concrete-si.test.mjs         # the concrete lab (several minutes)
node --test tests/engine/solid-concrete.test.mjs      # the concrete law
node scripts/validation-report.mjs --only plate
```
