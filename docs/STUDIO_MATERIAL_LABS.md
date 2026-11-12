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
- **Supports.** Nodes held at `w = 0`, springs to `w = 0`, and springs on the difference of two nodes (a clamp's rotational restraint).
- **Time.** Explicit symplectic Euler, lumped mass `ρ t A` per node (plus an added areal mass for an interlayer). The step is limited by a Gershgorin bound on `M⁻¹K` including supports, contact springs the caller declares and bridging membranes; a step above it is refused. Mass damping and caller dashpots are taken implicitly. The step length must stay constant: symplectic Euler gains energy when it changes from one step to the next (seen as a blow-up when a remainder step closed each frame), so the lab splits each 1/120 s tick into equal sub-steps.
- **Fracture.** A crack is a broken bond between two neighbouring nodes; every curvature term that spans it is dropped, so no moment or shear crosses it. After each step, every intact bond whose mid-point principal surface stress `6 |M| / t²` (the mean of its two nodes' moments) minus the surface prestress reaches the strength breaks, if that principal direction is within 45° of the bond. Pieces are the groups of nodes joined by a shared curvature term; a piece is handed to the lab when it is free.
- **Toughened glass.** A surface prestress `σ_p` raises the stress the bending must reach to `σ_c + σ_p`. After the first crack, a dicing front breaks every bond within `v_d (t − t₀)` of the origin.
- **Bridging layers.** A laminate's PVB or a wire mesh is a membrane of stiffness `E t` (N/m) acting on every bond as a string with the in-plane displacements neglected: force `k s Δw / ℓ`, `k = E t w / L`, `s = ℓ − L`, `ℓ = √(L² + Δw²)`. It keeps a cracked laminate in one piece.

### The lab model (`src/studio/material-labs/glass-si.ts`)

| Item | Value | Source |
|---|---|---|
| Pane | 2.6 m × 2.0 m, thickness 3–24 mm (control), 26 × 20 cells of 0.1 m | the rig (`glass-rig.ts`) |
| Annealed, frosted, bronze glass | E 72 GPa, ν 0.23, ρ 2500 kg/m³, flexural strength 41 MPa | `soda-lime-glass` (Continental Trade sheet) |
| Toughened (tempered) | strength 41 MPa plus a surface compression of 165 − 41 = **124 MPa** (toughened minus annealed flexural strength of the same sheet) | `soda-lime-glass-toughened` (new entry, same sheet). ASTM C1048 requires at least 69 MPa (Efferz et al. 2024) |
| Dicing | front at 1500 m/s; about **1 fragment per MPa** in a 50 mm square: ≈ 124 for 124 MPa | 1500 m/s **unverified** (the order of the terminal crack speed of soda-lime glass, not read in a source). 0.8–1.2 fragments per MPa for thin glass, EN 12150 minimum 40: Efferz, Thiele, Schuster, Schuler, Siebert, Schneider, *Relation between edge stress, bending strength, surface stress and fracture pattern of thermally toughened glass*, Glass Struct. Eng. (2024), doi 10.1007/s40940-024-00269-w |
| Laminated | annealed plies bending as one section; 0.76 mm PVB, E 33 MPa, ρ 1070 kg/m³: membrane 25.1 kN/m, +0.81 kg/m² | `pvb-interlayer` (new entry): AGC, *Material properties of PVB interlayers, Stratobel*, 2022 — 33 MPa is the 3 s, 0–20 °C value, the shortest tabulated |
| Wired | annealed plus a steel mesh of 0.46 mm wire at 12.5 mm: membrane 2.79 MN/m | E of `structural-steel-s235`; mesh geometry **unverified** (typical, not read) |
| Borosilicate | E 64 GPa, ν 0.2, ρ 2230 kg/m³, bending strength 25 MPa | `borosilicate-glass` (new entry): SCHOTT BOROFLOAT 33 datasheet |
| Acrylic | E 3.3 GPa, ν 0.37, ρ 1190 kg/m³, flexural strength 115 MPa (treated as brittle) | `pmma` (Evonik PLEXIGLAS GS) |
| Clamp pads | 6 natural-rubber pads (E 1.5 MPa), 24 mm thick, 210 mm tall, 55 mm over the pane edge, both faces: 1.44 MN/m per pad, rotation 363 N m/rad, × the "Clamp pad stiffness" control | `natural-rubber` |
| Pendulum | mass 5–100 kg (control), drop height 0.1–2 m (control), arm 1.9 m, bob radius 0.235 m, inertia `m (L² + offset² + 0.4 R²)` | the rig |
| Contact | node in front of the sphere along z: spring of a quarter of the stiffest bending row, critically damped dashpot (an inelastic, crushing contact) | model choice |
| Plate damping | mass damping 0.6 /s (≈ 0.6 % of critical at 8 Hz) | **unverified** assumption |
| Fragments | rigid bodies under gravity on the tray (y = 0.68 m) or the floor; no bounce; glass-on-glass kinetic friction 0.4 | `contactPair('soda-lime-glass', 'soda-lime-glass')` (The Engineering ToolBox, last resort); the library has no glass-on-steel friction |

A piece stays in the frame while at least two of its nodes sit under the pads; otherwise it falls. Readouts: **peak contact force (kN)**, **peak surface stress before the first crack (MPa)**, **out-of-plane deflection of the glass still in the frame (mm)**; the status line gives the number of pieces, the share of the pane held and the farthest fragment.

**Hand numbers (8 mm annealed).** `D` = 3244 N m. First mode of the pane if simply supported on all edges: 7.96 Hz. First crack under uniform pressure on those edges: 1.63 kPa. Default strike: 50 kg from 1.1 m, 540 J, bob at 4.63 m/s at the bottom. Stable step on the 0.1 m grid: 196 µs bare, 176 µs with the contact springs, so about 48 sub-steps per 1/120 s tick (three times more at 24 mm).

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

**Not validated:** the impact itself (contact force history, rebound), crack paths and fragment counts, the dicing front and fragment size (inputs), the membranes' strength (they never tear), fragment trajectories. No plate model can be checked against the Studio's real pendulum: there is no test of that rig.

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

- Linear plate theory: a real pane deflected by several thicknesses stiffens as a membrane; here it does not.
- The bob loads one to four nodes, so the peak stress under it depends on the grid (the point-load moment of a Kirchhoff plate is logarithmically singular), and with 0.1 m cells and a 4.6 m/s strike the stress jumps by tens of MPa per sub-step: the "peak stress" readout overshoots the strength by up to 2.5× on the step the glass breaks. Hertzian contact cracks are not modelled.
- Cracks follow the 0.1 m grid (staircases at 45°); the irregular tile outlines are drawn, not computed. Glass fragments finer than a cell are not resolved.
- Laminates bend as one section before breaking (an upper bound on their stiffness); after it, the PVB is a string at its 3 s modulus (a lower bound for an impact) that never tears; in-plane displacement is neglected, so the edges act as if held in-plane. The sag is therefore uncertain by a large factor.
- Fragments do not collide with each other, the frame or the pendulum; they do not bounce; they slide with glass-on-glass friction.
- The pendulum passes through the cracked region; nodes it has passed are ignored.

## Elastomer lab

### The model (`src/studio/material-labs/rubber-si.ts`)

- **Specimen.** A cylinder of radius 0.58 m × scale and height 0.86 m × scale (the rig's dimensions, in metres), 625 tetrahedra (a 5 × 5 × 5 box mesh whose square section is mapped onto the disc), Neo-Hookean (`src/engine/solid.ts`) with a Prony series (`config.viscoelastic`, [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#viscoelasticity)), gravity on, backward Euler at 1/30 s, mass damping 2 /s.
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

Poisson's ratio 0.49 instead of rubber's 0.4999 (the library's value is 0.5): near-incompressible linear tetrahedra lock (below).

### Validation

- The viscoelastic law: the six `solid.viscoelastic.*` rows ([`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#viscoelasticity)).
- **Bonded compression of the lab's cylinder** (`tests/studio/rubber-si.test.mjs`, row `solid.bonded-compression`): at 1 % strain the apparent modulus is 2.60 MPa against 1.71 MPa from the bonded-block closed form `1 / E_c = 1 / (E (1 + 2 S²)) + 1 / K`, shape factor `S = R / (2H)` = 0.34, `K = E / (3 (1 − 2ν))`: **+52 %, volumetric locking**. Measured on the same geometry: 8 cells across give +30 %; ν = 0.45 gives +51 % (5 cells), ν = 0.499 gives +205 % (5 cells) and +62 % (8 cells). The forces the lab shows are therefore about 1.5 times too high; shapes and times are less affected.
- Lab checks (same file, in `test:studio:materials`, 40 s): library values reach the model; the silicone cycle's force relaxes during the hold and the unloaded specimen recovers to under 5 % with the platen force under 2 % of the peak and every step converged; foam (ν = 0) loses volume where rubber keeps it; bit-identical repeats.

### Presets (12 to 24 s programs) and real time

| Preset | Peak force | Still compressed at the end | Real-time factor | Worst tick (ms) |
|---|---|---|---|---|
| Silicone recovery (50 %) | 4.9 MN | 0.3 % | 1.15 | 215 |
| Rubber rebound (natural) | 8.7 MN | 1.9 % | 1.31 | 174 |
| Foam collapse (75 %) | 0.22 MN | 1.6 % (volume 98 %) | 2.97 | 35 |
| Memory-foam creep | 0.06 MN | 20.7 % (slow recovery) | 4.79 | 22 |
| Firm polyurethane | 41 MN | 2.7 % | 1.26 | 97 |
| Soft gel (65 %) | 1.3 MN | 18.5 % | 0.73 | 729 |
| Neoprene hold | 22 MN | 7.1 % | 1.56 | 94 |
| EPDM comparison | 16 MN | 2.2 % | 1.36 | 74 |

Node 22 on the shared 4-core sandbox, single runs. In headless Chromium serving the built site the worker reported 1.32 times real time for the silicone cycle. The forces are those of a 1.16 m wide specimen (the rig's scale), not of a standard 29 mm test piece.

### Limits

- Volumetric locking (above): about 1.5 times too stiff in bonded compression; incompressibility is approximated by ν = 0.49, so rubber loses up to 7 % volume at 50 % compression where a real one loses a fraction of a percent.
- The Prony model is stress-based (not objective under large rotation while an overstress remains); one spectrum, borrowed from a filled blend, stands for natural rubber, neoprene and polyurethane; the other spectra and most moduli are unverified.
- Foams are compressible Neo-Hookean solids: no cell buckling plateau, no densification, no permanent set. Mullins softening, heat build-up, platen friction (the platens are bonded) and rate effects beyond the Prony series are not modelled.

## Concrete crush

### The law (`src/engine/concrete-law.ts`, solver id `solid-tet-dp-rankine-js-f64-v1`)

Composite plasticity on the J2 structure of the solid (Green-Lagrange strain, return mapping from the committed state, erosion), described in [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#concrete-law):

- **Compression:** associated Drucker-Prager `q + beta p = k(kappa_c)`. Elastic to 0.4 f_cm (E_cm is the secant modulus to 0.4 f_cm); then k follows EN 1992-1-1 3.1.5, expression (3.14) (`sigma_c / f_cm = (k eta - eta^2) / (1 + (k - 2) eta)`, `eta = eps_c / eps_c1`, `k = 1.05 E_cm |eps_c1| / f_cm`) to f_cm at eps_c1 and down to eps_cu1, then a straight tail to zero. After the peak the stress is a function of the plastic displacement across a band of width h (the element size): crack band. The tail is set so that a crushed band dissipates G_c = f_cm w_d / 2 per unit area, w_d = 0.5 mm, the plastic displacement that ends compressive softening in the ATENA model (after van Mier), read in A. Pizzocchero, *Calibration and validation of ATENA concrete material model with respect to experimental data*, MSc thesis, Padova 2015 ([PDF](https://thesis.unipd.it/retrieve/a9f59e86-598b-4002-9b82-ac5013317d92/Alessio_Pizzocchero.pdf)), not in van Mier's papers. For C30/37 an element of h = L_c = 0.118 m follows (3.14) exactly to eps_cu1.
- **Friction parameter.** beta = 0.364 gives the equal-biaxial strength 1.16 f_c (Kupfer, Hilsdorf and Rüsch 1969, as widely quoted; the paper was not opened). Under lateral pressure the law gains `m = (1 + 2 beta / 3) / (1 - beta / 3)` = 1.41 per unit of lateral stress. EN 1992-1-1 3.1.9, (3.24) and (3.25), gives 5 at low and 2.5 at higher confinement: the law gains less. Fitting beta to (3.25) (beta = 1.44) gives a 150 mm cube 2.5 times f_cm through the associated dilatancy; beta = 0.6 gives 1.28 times and beta = 1.0 1.58 times (measured, the lab's mesh and friction).
- **Tension:** Rankine on each principal stress, linear softening in the crack opening w = kappa_t h with the area G_f = 73 f_cm^0.18 N/m (fib Model Code 2010, quoted in Sucharda 2020; the Model Code was not opened).
- **Damage** shown in the lab is the strength lost: `1 - k / k_peak` after the compressive peak, `1 - f_t / f_t0` in tension. Unloading is elastic (plasticity, not secant damage); cracks do not close.
- **Erosion.** An element erodes when its compressive strength reaches zero (crushed) or its crack is 1 mm wide. In the lab an element left without a face neighbour (hanging by an edge or a corner) is removed too (`SolidBody.erode`).

### The lab model (`src/studio/material-labs/concrete-si.ts`)

- **Specimen.** The 150 mm cube of EN 12390-3 (control: 100 or 150 mm), 5 × 5 × 5 cells of 5 tetrahedra (625 elements, band width 30 mm), drawn **eight times larger** (a 150 mm cube is drawn 1.2 m wide in the rig). A seeded scatter of element strength (normal, coefficient of variation 8 %, 15 % for the weathered mix, 5 % for C60/75 and ceramic) decides where it cracks; the specimen seed control changes it.
- **Platens.** A static steel plane below and a kinematic steel box above through `SolidContact` with Coulomb friction 0.57 (control 0 to 0.6): the dry static coefficient of rolled steel plate on concrete cast against it, Rabbat and Russell, J. Struct. Eng. 111(3) (1985), as read in a search summary of the paper, **unverified** for a machined platen. The contact step starts from the free motion (`predictor: 'velocity'`) so the solve follows the loading path.
- **Program.** Displacement control: the platen moves down at the set rate (‰ of the edge per second) to the set travel and holds. Backward Euler at 1/30 s. The test is quasi-static: the law has no rate effect and the cube's inertia is negligible at these platen speeds, so the simulated test runs faster than the EN 12390-3 rate (0.6 MPa/s) and gives the same curve. After the peak, a step that finds no equilibrium (the cube gives way faster than the platen moves) is undone and the machine stops there, as testing machines stop on a load drop; it also stops when the load falls below 30 % of the peak.
- **Readouts.** Stress (MPa, platen force over the loaded area), strain (% of the edge), platen force (kN); a stress-strain chart of the run against the EN 1992-1-1 (3.14) cylinder curve of the mix; the status line gives the peak and how many elements spalled. Colour: grey to red by the strength lost; spalled elements are removed.
- **Material panel.** f_cm, f_ctm, E, ν, ρ, eps_c1 / eps_cu1 and G_f as the model uses them, and what is sourced.
- **Worker.** The lab steps in the shared lab worker.

| Studio mix | Runs as | Source |
|---|---|---|
| Standard | C30/37: f_cm 38, f_ctm 2.9 MPa, E_cm 32.8 GPa, eps_c1 2.2 ‰, eps_cu1 3.5 ‰, G_f 141 N/m | library (`concrete-c30-37`), EN 1992-1-1 Table 3.1, fib MC2010 G_f |
| High strength | C60/75: 68 / 4.35 MPa, 39.1 GPa, 2.6 / 3.0 ‰, 156 N/m | library (`concrete-c60-75`) |
| Reinforced | **plain C30/37: bars are not modelled** | **authored, unverified**: the preset says so |
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

Engine rows (`tests/engine/solid-concrete.test.mjs` in `npm run test:solid`; rows `solid.concrete.*` of [`VALIDATION.md`](VALIDATION.md)):

| Check | Reference | Measured | Tolerance |
|---|---|---|---|
| One cell, h = L_c, uniaxial compression: peak | f_cm = 38 MPa (Table 3.1) | 37.92 MPa | 0.5 % |
| Strain at the peak | eps_c1 = 2.2 ‰ | 2.20 ‰ | 2 % |
| Largest difference from (3.14), 0 to eps_cu1 | 0 | 2.3 % of f_cm, near 0.4 f_cm where E_cm is a secant | 3 % of f_cm |
| Stress at eps_cu1 = 3.5 ‰ | (3.14): 24.65 MPa | 24.69 MPa | 2 % |
| Tension, bar with a 2 % weaker middle cell: peak | 0.98 f_ctm = 2.84 MPa | 2.82 MPa | 2 % |
| Energy to break that bar in tension, 5, 10, 20 cells | 0.98 G_f A | 0.99987, 0.99987, 0.99988 of it | 1 %: the tensile crack band is mesh objective |
| One crushed cell of h = 120, 60, 30 mm: plastic work after the peak per unit area | G_c = 9.5 kJ/m² | within 2 % for each h | 2 % |
| Lateral pressure 0.05 and 0.2 f_cm, then axial compression | f_cm + m sigma_3, m = 1.41 | the closed form within 0.5 %: 1.068 and 1.279 f_cm | 0.5 %; EN 1992-1-1 (3.24) / (3.25) give 1.250 and 1.625 f_cm |
| Return mapping, every regime (elastic, Drucker-Prager, Rankine, corner, strength factor 0.9) | the stress is the derivative of the returned energy | central differences agree | 1e-6 |
| Checkpoint: a cracked, crushed bar resumes from `saveState()` | bit-identical | bit-identical; also a struck concrete block in the kit's checkpoint test (`concrete-solid-contact`) | exact |

**Not mesh objective in compression.** A prism of 5, 10 and 20 cells (0.2 m, middle cell 10 % weaker) dissipates 26, 54 and 119 J after the peak against 0.9 G_c A = 13.7 J. The crushed band does not stay one cell thick: its plastic flow expands it sideways (associated Drucker-Prager; the same happens with beta = 0, where the flow is isochoric), its elastic neighbours restrain that, and the softening spreads to the next cells. Only the tensile crack band is objective here; the single-cell rows above check the regularisation formula, not localisation.

Studio rows (`tests/studio/concrete-si.test.mjs` in `npm run test:studio:materials`, 6 tests, about 90 s):

| Check | Reference | Measured |
|---|---|---|
| Cube with frictionless platens | f_cm at eps_c1 | 37.80 MPa at 2.30 ‰ |
| Cube with friction 0.57 over a 150 × 150 × 300 mm prism (slenderness 2, the cylinder's) with the same platens | f_ck,cube / f_ck = 37 / 30 = 1.233 (Table 3.1) | 45.02 / 38.55 MPa = **1.168**, 5 % below (row `solid.concrete.cube-cylinder`, tolerance 10 %) |
| Default program | peak above f_cm, softening, spalling, machine stop | 45.0 MPa at 2.87 ‰; stopped at 7.2 ‰ with 2 elements spalled |

A square prism stands for the cylinder: the mapped cylinder mesh (as in the elastomer lab) did not converge in its first contact step against the stiff steel platen, and this was not resolved.

### Presets and real time

The programs run to the set travel at the set rate; Node 22 on the shared 4-core sandbox, single runs, the whole program including the hold after a stop.

| Preset | Peak stress | at | End | Spalled | Real-time factor |
|---|---|---|---|---|---|
| Cube compression (C30/37, 8 ‰ at 0.5 ‰/s) | 45.0 MPa | 2.87 ‰ | stopped at 7.2 ‰ | 2 | 0.37 |
| Reinforced core (plain C30/37) | 45.0 MPa | 2.87 ‰ | stopped at 7.2 ‰ | 2 | 0.37 |
| High-strength cube (C60/75, 6 ‰) | 77.4 MPa | 3.07 ‰ | softening | 0 | 1.25 |
| Lightweight crush (LC25/28) | 35.8 MPa | 2.30 ‰ | stopped | 2 | 0.36 |
| Weathered spall (C20/25) | 33.3 MPa | 2.60 ‰ | stopped | 1 | 0.44 |
| Fibre bridging | 45.0 MPa | 2.87 ‰ | stopped | 1 | 0.44 |
| Low-strain comparison (1.5 ‰) | 38.3 MPa | 1.50 ‰ | holding | 0 | 6.0 |
| Ceramic comparison (alumina, 100 mm, 7.5 ‰ at 1 ‰/s) | 1940 MPa | 5.77 ‰ | stopped: shattered | 345 | 2.0 |

The cost is in the softening: below the peak a step takes 20 to 60 ms, after it up to a second (Newton converges linearly while elements soften), and the step that finds no equilibrium took up to 16 s before the iteration limit was lowered (40 Newton iterations per friction pass now). In headless Chromium serving the built site the worker's figure is given in the CHANGELOG entry. The fibre mix peaks like the plain one: before the peak the cube does not crack in tension, and the fibres act only once it does.

### Limits

- Compressive softening is not mesh objective in a prism (above); the 5-cell cube cannot resolve the cones of a crushed cube or splitting cracks finer than 30 mm.
- Confinement: m = 1.41 against 2.5 to 5 in EN 1992-1-1 3.1.9; associated flow overstates dilatancy, which is why beta cannot be raised to fit 3.1.9.
- Cracks unload elastically and keep their opening (plasticity, not damage); no crack closure, friction on cracks, aggregate interlock, creep, shrinkage, rate or size effects beyond the crack band.
- Reinforcement is not modelled (the preset says so); the fibre softening, the mortar and weathered mappings and the ceramic's tensile strength and friction are unverified.
- After the peak the cube fails abruptly at about 7 ‰ in every concrete mix: the test stops there, so the post-failure rubble is not shown.

## Reproduce

```sh
npm run test:plate
node --test tests/studio/material-labs.test.mjs       # the Studio's labs, glass in SI (about 4 minutes)
node --import ./scripts/register-typescript.mjs --test tests/studio/glass-worker.test.mjs
node --test tests/studio/rubber-si.test.mjs           # the elastomer lab
node --test tests/studio/concrete-si.test.mjs         # the concrete lab (about 90 s)
node --test tests/engine/solid-concrete.test.mjs      # the concrete law
node scripts/validation-report.mjs --only plate
```
