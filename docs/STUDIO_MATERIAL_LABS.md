# Studio material labs in SI units

The Engineering Studio's material labs (`index.html?studio=glass`, `concrete`, `rubber`; source `src/studio/material-labs/`) were authored models in normalised units, labelled "Comparative model · not calibrated". This document covers the labs that now run in SI units on validated solvers, what they model, how they were checked, what they cost, and what they leave out.

| Lab | State | Solver |
|---|---|---|
| Glass impact (`GI–02`) | **SI** since 2026-11-12 | Kirchhoff plate with brittle fracture, `src/engine/plate.ts` (new); lab model `src/studio/material-labs/glass-si.ts` |
| Concrete crush (`CC–03`) | still the authored bond lattice ("not calibrated") | — |
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

Not converted yet. It keeps its authored model and the "Comparative model · not calibrated" label. It needs compressive crushing: cohesive fracture has no friction on closed cracks and no compression failure, so a scoped damage-plasticity model validated against f_c and the EC2 parabola, platens as constraints or rigid bodies, sourced values for the eight mixes (the library has C30/37 only, without a fracture energy), and the lab wiring. Reinforcement as embedded bars was not attempted. The cube is bulky, so the tetrahedral solid suits it.

## Reproduce

```sh
npm run test:plate
node --test tests/studio/material-labs.test.mjs       # the Studio's labs, glass in SI (about 4 minutes)
node --import ./scripts/register-typescript.mjs --test tests/studio/glass-worker.test.mjs
node --test tests/studio/rubber-si.test.mjs           # the elastomer lab
node scripts/validation-report.mjs --only plate
```
