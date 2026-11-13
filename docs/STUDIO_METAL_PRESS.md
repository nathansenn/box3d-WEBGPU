# Metal press study (SI)

`index.html?studio=plate` runs a press brake in SI units on the validated solid solver. The Studio keeps its press, its look and its panels; what moves is computed by `src/engine/press-brake.ts` through `src/studio/press-si.ts` (numerical backend `studio-press-brake-si-v1`, run in the Studio's worker).

## What is modelled

- **Sheet.** A 520 × 440 mm sheet, 1 to 12 mm thick, of a library metal: structural steel S355 or aluminium 6061-T6 (`src/engine/materials.ts`, [`MATERIALS.md`](MATERIALS.md)). The material is elastic-plastic: E, ν and ρ from the library; J2 plasticity with linear isotropic hardening fitted to the library's yield strength, tensile strength and elongation at break (`plasticMaterial`); elements erode when their equivalent plastic strain reaches the failure strain (elongation minus the elastic strain at the tensile strength). The S355 elongation (22%) is marked unverified in the library.
- **Section.** The bend is long against the thickness, so one plane-strain section across the bend line is solved: four linear tetrahedra through the thickness, 16 to 40 cells along the half section (about 1.5 thicknesses each), the averaged nodal pressure element (`tet4-nodal`: no plastic-incompressibility locking, [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md#averaged-nodal-pressure-element-tet4-nodal)), the green-lagrange model (exact under the large rotation of a bend), half the section by symmetry. The Studio sweeps the solved mid-surface along the bend line; beyond the modelled strip (three quarters of the die opening from the bend line) the flanges are drawn straight, as the solved last cell points.
- **Tools.** The punch and the two die shoulders are rigid cylinders across the sheet (`SolidContact`, penalty contact, Coulomb friction 0.1). Punches: the V blade with a nose radius of one sheet thickness, and the beading bar with the drawn 36 mm radius, both times the tool size. Shoulders have a radius of one thickness. The die opening is eight thicknesses, or wider so that the punch nose and both shoulders fit with four thicknesses of clearance on each side (closer, a deep bend pinches and irons the flanges): 24 mm for a 2 mm sheet under the V blade, 92 mm under the bar. The tool rotation turns the bend line.
- **Stroke.** The ram approaches at the strike speed, forms at the same speed in quasi-static backward-Euler steps of the sheet (a quarter of a thickness of punch travel per step; a tenth gives the same peak force within 0.3%), stops at the stroke setting, at 0.6 of the die opening (about a 90° bend) or before the punch centre passes the shoulders' (punch and shoulder radius plus two thicknesses), or where the sheet's force reaches the force limit (`Pressure limited`), holds, and retracts at the same speed. Springback happens on the way up, from the solved elastic unloading.
- **Force.** The punch force is the section's force per metre times the width of sheet along the bend line. The force limit is the pressure setting as a percentage of the press's 1000 kN rating.

Not modelled: the sheet's ends along the bend line (no end effects, no anticlastic curving), the die's V faces and bottoming (air bending only), strain rate and heating, thickness changes drawn on screen (the drawn sheet keeps its thickness), cracks that are not along the bend line, and resuming a saved SI run (export works; import refuses it).

## Readouts

| Readout | Meaning | Unit |
|---|---|---|
| Bend depth (`Deflection` in the inspection panel) | Largest drop of the drawn sheet below its flat position | mm |
| Punch force | Force of the sheet on the punch over the whole width | kN |
| Ram force limit | Pressure setting × 1000 kN / 100 | kN |
| Plastic stretch · max | Largest equivalent plastic strain in the section | % |
| Eroded elements | Elements of the section that reached the failure strain | count of the section's elements |
| Ram travel | Travel of the ram from its start | mm |

The chart plots bend depth (mm) and punch force (kN) over time. The response colouring is the equivalent plastic strain of the section column under each point, from cyan (elastic) through green and yellow to red at the failure strain.

## Hand numbers

2 mm S355 under the beading bar (the default case): die opening V = 2 (36 + 2 + 8) = 92 mm; plastic moment per metre M_p' = (2/√3) 355 MPa (2 mm)² / 4 = 410 N; beam-theory limit force 4 M_p' / V = 17.8 kN/m, 7.8 kN over the 440 mm width. The Studio model reaches 13.5 kN at 8 mm of stroke (1.7 times that; 14.0 kN with the tet4 element before 2026-11-12): the engine test measures 1.23 times beam theory for a short span over a small nose (see below), the sheet wraps the 36 mm bar so the contact moves out and the lever arm shortens, and hardening (0.62 GPa) adds as the plastic strain reaches 4%. After the punch leaves, the bend keeps 6.1 mm of depth and an included angle of 163.3° (163.0° with tet4).

2 mm 6061-T6 under the V blade (nose radius 2 mm, die 24 mm): the outer fibre of a sheet wrapped on that nose stretches by about t / (2R + t) = 33%, nearly three times 6061-T6's 12% elongation: it cracks.

## Validation

The material, the solid and the press brake are validated in the engine (`tests/engine/solid-plasticity.test.mjs`, `tests/engine/press-brake.test.mjs`, rows in [`VALIDATION.md`](VALIDATION.md) and [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md)):

| Check | Closed form | Measured | Tolerance |
|---|---|---|---|
| Uniaxial bilinear cycle with reverse yield | bilinear law | 3.7e-11 | 1e-9 |
| Beam moment at 8 k_y | M(k) of a rectangle | +3.2% | 0 to +4% |
| Beam springback | M / (E I) | 0.34% | 1% |
| Thick cylinder collapse | (2/√3) σ_y ln(b/a) | bracketed ±2% | ±2% |
| Air bend limit load, 2 mm S355, V = 8 t | 4 M_p' / V | 1.23 × (tet4 and tet4-nodal alike; 1.17 × with 8 cells through the thickness) | 1.0 to 1.35 × |
| Air bend springback (bend depth recovered) | F V³ / (48 E' I) | 0.90 × (tet4), 0.925 × (tet4-nodal, the Studio's) | ±12%; ±10% |
| Plane-strain pure bending, fully plastic, 4 cells | M_p' (1 - (k_y/k)²/3) | +6.8% (tet4), +4.8% (tet4-nodal) | below +5.5% |
| Equilibrium: die reaction against punch force | equal | within 1% | 1% |
| 6061-T6 over a 1 mm nose | cracks (33% outer strain ≫ 12%) | first erosion at 0.58 t of stroke | must crack |
| S355 over an 8 mm nose to 118° | no crack; outer-fibre estimate (2/√3) ln((R+t)/(R+t/2)) = 0.122 | 0.177 (1.45 ×) | 0.9 to 1.6 × |

`tests/studio/press-si.test.mjs` (in `npm run test:studio:press`) runs the Studio model itself: geometry from the settings, a full S355 stroke (approach, forming, hold, retract) with the peak force against the beam limit, a cracking 6061-T6 V bend, the force limit, and the worker runtime.

Why the limit load is 23% above beam theory: a short span loaded by a punch raises the hinge moment above the beam value, and four linear tetrahedra through the thickness are too stiff in bending: 6.8% in fully plastic plane-strain pure bending with tet4, of which the averaged nodal pressure element removes the plastic-incompressibility part (4.8% left). The air-bend limit load itself does not change with the element (1.228 and 1.231) and falls to 1.167 with eight cells through the thickness, so its excess is bending, not locking (the earlier version of this page put it on locking). The springback is 7.5% short of the elastic beam with tet4-nodal (10% with tet4) because the same elements are too stiff in elastic bending.

## Real time

Real-time factor = model seconds of the stroke over CPU seconds of stepping, Node 22, one thread, on this sandbox's shared 4-core Xeon with a load average of 10 to 15 from other jobs (`node scripts/fem-preset-benchmark.mjs press`; before and after measured back to back on each preset):

| Preset | Before (tet4, diagonal-preconditioned CG) | After (tet4-nodal, sparse LDLᵀ preconditioner) | Peak force before → after |
|---|---|---|---|
| S355 radius bend | 0.096 | 0.83 | 34.74 → 31.55 kN |
| 6061-T6 radius bend | 0.108 | 1.04 | 23.66 → 23.50 kN |
| S355 V bend (cracks) | 0.50 | 0.32 | 45.74 → 44.37 kN |
| 6061-T6 V bend (cracks) | 0.55 | 0.39 | 33.77 → 32.65 kN |
| S355 shallow bend | 0.167 | 0.87 | 13.97 → 13.50 kN |
| Force-limited stroke | 0.132 | 0.36 | 18.71 → 18.41 kN |
| Diagonal bend line | 0.105 | 0.87 | 41.05 → 37.29 kN |

What set the cost before: each step is a Newton solve of the section with the contact active set and the plastic zone changing (about 10 Newton iterations per step), and the conjugate gradients needed about 360 iterations per Newton iteration on the stiff, thin section (818,000 for the radius bend). Now a sparse LDLᵀ factorization of the section's tangent preconditions them, kept across iterations and steps: 10,200 inner iterations and 200 factorizations for the radius bend. The cracking V bends are slower than before: erosion forces new factorizations, the compressed, cracking section is often indefinite (the factorization is shifted or the diagonal is used for a few iterations), and the averaged element costs about twice as much per product; with the tet4 element and the factorization they run at 0.64 (S355 V bend) and the radius bend at 1.6. Approach and retraction clear of the sheet cost nothing. The solver runs in the Studio's worker, so the page stays responsive; the Studio's clock falls behind wall time and says so in the footer.

## Limits

- Linear tetrahedra are too stiff in bending: with four cells through the thickness, fully plastic bending is about 5% too strong and the springback 7.5% short. The averaged nodal pressure element has removed the plastic-incompressibility locking (forces of the radius-bend presets 0.7% to 9% lower than with tet4); eight cells would halve the bending error but cost several times more and are not used.
- With tet4-nodal a few steps of a stroke (0 to 2 of the 50 to 180 steps of a preset) stop at the Newton iteration limit (40) and are accepted unconverged, as the press allows; tet4 had none on these presets.
- The failure strain is one number from a tensile test, independent of stress state and element size: real sheet bends tighter than the model allows before cracking (the model cracks early, on the safe side).
- The hardening is a straight line between yield and tensile strength; the additive Green-Lagrange split is a moderate-strain model.
- One section stands for the whole width.
