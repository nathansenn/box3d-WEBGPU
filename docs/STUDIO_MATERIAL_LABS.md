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

- **Bending.** Kirchhoff plate in the x-y plane, deflection `w` along z, flexural rigidity `D = E t³ / (12 (1 − ν²))`. Nodes on a regular grid. The energy is a sum of finite-difference curvatures: per node `½ D A (κxx² + κyy² + 2ν κxx κyy)` with `κxx` from the node and its two x-neighbours, per cell `D (1 − ν) κxy² hx hy` with `κxy` from its four corners. Forces are the exact gradient of that energy, assembled as a 5 × 5 stencil per node. For a simply supported plate the sine modes are exact eigenvectors of this grid, so its frequencies are known in closed form (`plateGridFrequency`).
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
| Fragments | rigid bodies under gravity on the tray (y = 0.68 m) or the floor; no bounce; glass-on-glass kinetic friction 0.4 | `contactPair('soda-lime-glass', 'soda-lime-glass')` (The Engineering ToolBox, last resort); the library has no glass-on-steel friction |

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

Three changes, none of them to the model:

1. **The in-plane solve** uses a sparse Cholesky factor in nested-dissection order (each half of the node grid ordered before the middle grid line that separates it): 35,625 entries against 65,772 for the band. Same matrix, same unit rows for held and unconnected components; a solve takes 0.18–0.21 ms against 0.43–0.56 ms, a factorization 3.6 ms against 10–12 ms. The answers change by rounding only: every row of the plate's validation printed by `npm run test:plate` (the Levy rows of both tables, edge tension, mesh study, small load, gradient check, energy oscillation, fracture with membrane stress) has the same digits as before; the dynamic-relaxation step counts and the rounding-level net edge forces of the free-edge rows change.
2. **A tighter stability bound** (above, *Time*): still an upper bound of the present tangent, 3 to 4 times smaller in the membrane part, and the bridging layer counted by its tangent. Fewer sub-steps where the membrane or the layer set the step (laminate, wire, acrylic). The lab's contact springs keep their stiffness: they are still a quarter of the stiffest bending row with the layer counted at full stiffness, as before.
3. **Contact springs in the bound only near the bob.** The lab declares them on the nodes the bob can reach within the tick (under its footprint widened by its travel, with a gap below twice what the bob and the fastest node close in a tick plus 20 mm), not on every node at all times: about 11 % fewer sub-steps while the bob is away.

Measured old and new interleaved, preset by preset, over the first 3 s (`node scripts/fem-preset-benchmark.mjs glass --seconds 3`, Node 22, this 4-core sandbox at load 16 to 31 from other jobs, so the factors are rough):

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

The tempered pane spends its time on the 567 falling tiles and the hand-off of the dicing tick (worst tick 2 to 4 s), which these changes do not touch. The state hashes of the presets change (the factor rounds differently and the step is longer). What moves with the step are the peak readouts of the impact, which are not converged in the time step: the radial impact's peak contact force is 12.4, 15.3 to 16.3 and 17.5 to 18.6 kN at 1, 1/2 and 1/4 of the lab's step (old and new code alike), the laminate's 18.3 (old) or 23.3 (new), then 22.6 to 23.4 and 22.8 to 23.0; the peak stress moves by about 5 %; the time of the first crack stays within 0.1 ms (0.7055 s radial, 0.7418 s laminate). So the differences in the table are within the step error of these readouts; the new step is if anything closer to the converged laminate force.

**Tried and not kept.** Solving the membrane only every k-th sub-step (the in-plane displacements of an earlier sub-step in between): 1.2 to 2.5 times faster at k = 2 to 4, but the acrylic sheet's peak stress fell from 30.6 to 22.0 MPa and the laminate took half the sub-steps for the wrong reason (the lagged field is not in equilibrium), so the answers are not those of the model: not kept. **Implicit or sub-cycled bending: not done.** Only the thick panel is limited by bending alone (its interior bending row sets the step at 24 mm, three times the 8 mm step); the others are limited by the membrane or by bending plus contact. An implicit bending step would need the contact penalty implicit too (it is a quarter of the bending row) and a factor of the 13-point stencil after every crack, and the impact readouts above already move by 50 % between the lab's step and a quarter of it, so a longer step would move them further.

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
- Cracks follow the 0.1 m grid (staircases at 45°); the irregular tile outlines are drawn, not computed. Glass fragments finer than a cell are not resolved. A grid twice as fine (52 × 40, `new GlassModel(settings, {cells: [52, 40]})`) gives 2.6 to 3.8 times more pieces, but runs 13 to 24 times slower (radial impact 0.011 times real time with membrane action, 0.061 without; the explicit step falls with the square of the cell size), so the lab keeps 0.1 m; no adaptive refinement.
- Laminates bend as one section before breaking (an upper bound on their stiffness); after it, the PVB is a string at its 3 s modulus (a lower bound for an impact) that never tears; in-plane displacement is neglected, so the edges act as if held in-plane. The sag is therefore uncertain by a large factor.
- Fragments do not collide with each other, the frame or the pendulum; they do not bounce; they slide with glass-on-glass friction. (Not done on 2026-11-16: the glass worker has no Box3D world, and no polygon contact was written and validated.)
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
| Reinforced tie through cracking to yield | one-dimensional series model | 1.6 % of A_s f_y | 3 % |
| Reinforced beam: cracking moment; yield moment | 1993 N m; 4515 N m (hand) | 1950 to 2112 N m; 4553 N m | 6 %; 5 % |
| Return mapping in every regime; checkpoint resume (local, nonlocal, reinforced) | derivative of the energy; bit-identical | pass | 1e-6; exact |

Misses: Kupfer's 1.27 f_c at sigma_2 / sigma_1 = 0.5 (the law gives 1.39), and compressive softening is not mesh objective (SOLID_MECHANICS.md, mesh study).

Studio rows (`tests/studio/concrete-si.test.mjs` in `npm run test:studio:materials`, 8 tests; the cube, cylinder and short-cylinder runs take 3, 9 and 3 minutes of CPU on the loaded shared machine):

| Check | Reference | Measured |
|---|---|---|
| Cube with frictionless platens | f_cm at eps_c1 | 37.55 MPa at 2.20 ‰ |
| Cube against the 150 × 300 mm cylinder (O-grid, 1260 tetrahedra), platen friction 0.2 (row `solid.concrete.cube-cylinder`) | f_ck,cube / f_ck = 37 / 30 = 1.233 (EN 1992-1-1 Table 3.1) | 49.15 / 40.84 MPa = **1.204** (-2.4 %, tolerance 5 %); every step of both converges |
| A 150 × 150 mm cylinder against the 150 × 300 mm one, friction 0.2 (row `solid.concrete.cylinder-slenderness`) | 1.17: the slenderness-1 correction of ČSN EN 12390-3/Z1 as quoted by Středulová and Eliáš (2023), who measure and compute about 1.23 on 50 mm cylinders | 47.53 / 40.84 MPa = **1.164** (-0.5 % of 1.17, tolerance 3 %; 5 % below their 1.23) |
| The same cube and cylinder at friction 0.57 (not a row) | 1.233 | 60.02 / 41.88 MPa = 1.433, a miss (+16 %) |
| Default program (friction 0.2) | peak above f_cm (EN 1992-1-1's mean cube strength is about 38 × 37 / 30 = 46.9 MPa), softening | 49.15 MPa (1.29 f_cm) at 2.63 ‰ at 1 ‰/s; then stable softening to 25.7 MPa at 8 ‰ with every step in equilibrium: the machine does not stop and no element spalls within the program |
| Reinforced core at 1.2 ‰ | stiffer than plain; corner bars in compression | 849 kN against 775 kN; 36 of 84 bar segments in compression, the most stressed at 50 % of f_yk |
| Cylinder mesh | volume of the 12-sided prism; no flat element | exact to 1e-12; smallest volume over the cube of the longest edge 0.05 or more |

**The cube-to-cylinder ratio depends on the platen friction, and the row is conditional on it.** With the EN 1992-1-1 3.1.9 meridian, platen friction confines the 5-cell cube strongly: 1.58 f_cm at friction 0.57 against 1.29 f_cm at 0.2, while the cylinder (slenderness 2) gains 10 % and 7 %. The measured friction coefficients opened for steel on concrete (0.43 to 0.70, above) would make the cube 1.4 times the cylinder; the code's 37 / 30 is met within 2.4 % with 0.2, the value another model of the same test was calibrated to, and that value also gives the slenderness correction of ČSN EN 12390-3/Z1 within 0.5 %. So the row `solid.concrete.cube-cylinder`, withdrawn on 2026-11-12, is back with friction 0.2, and says so: it does not show that a machined platen has a friction of 0.2, only that the law and the lab reproduce the two ratios with a friction a published compression-test model uses. The first version compared the cube with a square prism (1.17) because the mapped cylinder mesh of the elastomer lab did not converge at its first contact; the O-grid mesh (`cylinderMeshOgrid`: an inner square and four blended blocks, triangular prisms split by node order so neighbours agree) converges from the first step.

### Presets and real time

Re-measured with platen friction 0.2, the `ldl` preconditioner, the faster return mapping and the principal-axes consistent tangent of 2026-11-16 (`node scripts/fem-preset-benchmark.mjs concrete`: the first 14 s of each program at its own rate, Node 22, single runs on the shared 4-core machine at a load average of about 15):

| Preset | Peak stress | at | State at 14 s | Spalled | Real-time factor | Worst tick |
|---|---|---|---|---|---|---|
| Cube compression (C30/37, 0.5 ‰/s) | 49.1 MPa | 2.75 ‰ | softening, no stop | 0 | 0.61 | 0.72 s |
| Reinforced core (C30/37, B500B bars) | 58.5 MPa | 3.53 ‰ | softening, no stop | 0 | 0.58 | 0.42 s |
| High-strength cube (C60/75) | 87.6 MPa | 3.27 ‰ | softening, no stop | 0 | 0.98 | 0.45 s |
| Lightweight crush (LC25/28) | 41.3 MPa | 2.42 ‰ | softening, no stop | 0 | 0.68 | 0.25 s |
| Weathered spall (C20/25) | 35.7 MPa | 2.50 ‰ | softening, no stop | 0 | 0.49 | 0.52 s |
| Fibre bridging | 49.1 MPa | 2.75 ‰ | softening, no stop | 0 | 0.70 | 0.36 s |
| Low-strain comparison (1.5 ‰) | 40.5 MPa | 1.50 ‰ | holding | 0 | 3.3 | 0.28 s |
| Ceramic comparison (alumina) | 2062 MPa | 6.20 ‰ | stopped: no equilibrium past the peak | 327 | 2.7 | 2.8 s |

**Speed.** The same peaks and strains as before the change, to the printed digits. A profile of the cube across its peak (`--cpu-prof`) put 88 % of the time in the Willam-Warnke deviatoric return: its Lode-angle Newton used a finite-difference r'' (three section evaluations per iteration) and a stopping test tighter than the rounding of its own residual, so most returns bisected down to 1e-16 (26 iterations on average). With the exact r'', a stopping test at that rounding and a warm start from the previous multiplier of the same trial it takes 2.1 iterations; the finite-difference tangent reuses the base return of the evaluation and brackets the six perturbed multipliers. The first 3.5 s of the cube at 1 ‰/s (through the peak), old and new interleaved on the same machine: 128.0 and 130.6 s of CPU before, 14.5 and 14.0 s after, **9.0 times faster**, with the same Newton and inner iteration counts (3287 and 12,583) and the same peak (49.1488 MPa) and end stress (48.3308 MPa); the state agrees to rounding, not to the bit. The 14 s cube program: 606 s of CPU before (load 17 to 20) and 61 s after (load about 12). **Tangent (later on 2026-11-16).** The finite-difference tangent (six tensor returns per yielded element and Newton iteration, half the time after the change above) is replaced by the consistent tangent in the principal axes (`ConcreteReturn.tangent`, [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#concrete-law)): closed form for a compression return, three principal returns where Rankine flows, the rotation part exact, the evaluation's principal data reused. Old and new back to back (`scripts/fem-preset-benchmark.mjs concrete`, load about 15): every C30/37-family preset 2.1 to 2.4 times faster, the same peaks and strains to the printed digits and no failed step (cube 0.27 → 0.61 times real time, reinforced core 0.26 → 0.58, high strength 0.42 → 0.98, lightweight 0.29 → 0.68, weathered 0.23 → 0.49, fibre 0.29 → 0.70, low strain 1.4 → 3.3); the first 3.5 s of the cube at 1 ‰/s: 11.1 / 11.2 s of CPU before, 5.2 / 5.8 s after, the same Newton iterations (3287) and inner iterations within 4 of 12,583. The ceramic comparison peaks at the same 2062 MPa at 6.20 ‰ and stops the same way, but after the stop it sheds 327 elements instead of 229 and runs at 2.7 instead of 4.1 times real time: its brittle collapse past the peak follows a different path with a different tangent. The concrete presets are now at about 0.5 to 1 times real time on this loaded machine; what is left is the return mapping of the evaluations and about 30 Newton iterations per step while elements soften.

With the first law (2026-11-12) the cube peaked at 45.0 MPa and the machine stopped at 7.2 ‰ with 2 elements spalled, at 0.37 to 0.53 times real time; with this law and friction 0.57 it peaked at 60.0 MPa and stopped at 7.4 ‰. With friction 0.2 no preset loses equilibrium within its program, so none ends in a machine stop or a spalled element: the "spalling" of the preset names is not reached. In headless Chromium (SwiftShader) an earlier build of the reinforced core drew its bars through the concrete and ran without console errors (captures `reinforced-ready.png`, `reinforced-running.png`); the page was not re-captured for this change.

### Limits

- Compressive softening is not mesh objective (see SOLID_MECHANICS.md, mesh study); the 5-cell cube cannot resolve the cones of a crushed cube or splitting cracks finer than 30 mm.
- The platen friction 0.2 is a calibrated input of another model, not a measured coefficient; with the measured steel-on-concrete values (0.43 to 0.70) the cube would be about 1.4 times the cylinder instead of 1.23.
- Kupfer's biaxial strength at sigma_2 / sigma_1 = 0.5 is overestimated (1.39 against 1.27 f_c).
- Cracks unload elastically and keep their opening (plasticity, not damage); no crack closure, friction on cracks, aggregate interlock, creep, shrinkage, rate or size effects beyond the crack band.
- Bars have perfect bond: no slip, no dowel action, no rupture at eps_uk; the bar layout of the reinforced preset is authored. The fibre softening, the mortar and weathered mappings and the ceramic's tensile strength and friction are unverified.

## Reproduce

```sh
npm run test:plate
node --test tests/studio/material-labs.test.mjs       # the Studio's labs, glass in SI (about 4 minutes)
node --import ./scripts/register-typescript.mjs --test tests/studio/glass-worker.test.mjs
node --test tests/studio/rubber-si.test.mjs           # the elastomer lab
node --test tests/studio/concrete-si.test.mjs         # the concrete lab (several minutes)
node --test tests/engine/solid-concrete.test.mjs      # the concrete law
node scripts/validation-report.mjs --only plate
```
