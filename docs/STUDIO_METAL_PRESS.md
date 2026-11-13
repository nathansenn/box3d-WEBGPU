# Metal press study (SI)

`index.html?studio=plate` runs a press brake in SI units on the validated solid solver. The Studio keeps its press, its look and its panels; what moves is computed by `src/engine/press-brake.ts` through `src/studio/press-si.ts` (numerical backend `studio-press-brake-si-v1`, run in the Studio's worker).

## What is modelled

- **Sheet.** A 520 × 440 mm sheet, 1 to 12 mm thick, of a library metal: structural steel S355 or aluminium 6061-T6 (`src/engine/materials.ts`, [`MATERIALS.md`](MATERIALS.md)). The material is elastic-plastic: E, ν and ρ from the library; J2 plasticity with linear isotropic hardening fitted to the library's yield strength, tensile strength and elongation at break (`plasticMaterial`); elements erode when their equivalent plastic strain reaches the failure strain (elongation minus the elastic strain at the tensile strength). The S355 elongation (22%) is marked unverified in the library.
- **Section.** The bend is long against the thickness, so one plane-strain section across the bend line is solved: four linear tetrahedra through the thickness, 16 to 40 cells along the half section (about 1.5 thicknesses each), the green-lagrange model (exact under the large rotation of a bend), half the section by symmetry. The Studio sweeps the solved mid-surface along the bend line; beyond the modelled strip (three quarters of the die opening from the bend line) the flanges are drawn straight, as the solved last cell points.
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

2 mm S355 under the beading bar (the default case): die opening V = 2 (36 + 2 + 8) = 92 mm; plastic moment per metre M_p' = (2/√3) 355 MPa (2 mm)² / 4 = 410 N; beam-theory limit force 4 M_p' / V = 17.8 kN/m, 7.8 kN over the 440 mm width. The Studio model reaches 14.0 kN at 8 mm of stroke (1.8 times that): the engine test measures 1.23 times beam theory for a short span over a small nose (see below), the sheet wraps the 36 mm bar so the contact moves out and the lever arm shortens, and hardening (0.62 GPa) adds as the plastic strain reaches 4%. After the punch leaves, the bend keeps 6.1 mm of depth and an included angle of 163.0°.

2 mm 6061-T6 under the V blade (nose radius 2 mm, die 24 mm): the outer fibre of a sheet wrapped on that nose stretches by about t / (2R + t) = 33%, nearly three times 6061-T6's 12% elongation: it cracks.

## Validation

The material, the solid and the press brake are validated in the engine (`tests/engine/solid-plasticity.test.mjs`, `tests/engine/press-brake.test.mjs`, rows in [`VALIDATION.md`](VALIDATION.md) and [`SOLID_MECHANICS.md`](SOLID_MECHANICS.md)):

| Check | Closed form | Measured | Tolerance |
|---|---|---|---|
| Uniaxial bilinear cycle with reverse yield | bilinear law | 3.7e-11 | 1e-9 |
| Beam moment at 8 k_y | M(k) of a rectangle | +3.2% | 0 to +4% |
| Beam springback | M / (E I) | 0.34% | 1% |
| Thick cylinder collapse | (2/√3) σ_y ln(b/a) | bracketed ±2% | ±2% |
| Air bend limit load, 2 mm S355, V = 8 t | 4 M_p' / V | 1.23 × | 1.0 to 1.35 × |
| Air bend springback (bend depth recovered) | F V³ / (48 E' I) | 0.90 × | ±12% |
| Equilibrium: die reaction against punch force | equal | within 1% | 1% |
| 6061-T6 over a 1 mm nose | cracks (33% outer strain ≫ 12%) | first erosion at 0.58 t of stroke | must crack |
| S355 over an 8 mm nose to 118° | no crack; outer-fibre estimate (2/√3) ln((R+t)/(R+t/2)) = 0.122 | 0.177 (1.45 ×) | 0.9 to 1.6 × |

`tests/studio/press-si.test.mjs` (in `npm run test:studio:press`) runs the Studio model itself: geometry from the settings, a full S355 stroke (approach, forming, hold, retract) with the peak force against the beam limit, a cracking 6061-T6 V bend, the force limit, and the worker runtime.

Why the limit load is 23% above beam theory: four linear tetrahedra through the thickness are 6.6% too strong in fully plastic plane-strain bending (measured on a pure-bending section; 1.8% with eight), and a short span loaded by a punch raises the hinge moment above the beam value. The springback is 10% short of the elastic beam because the same elements are too stiff in elastic bending.

## Real time

Measured on this sandbox's 2.1 GHz Xeon, one core, Node 22 (`tests/studio/press-si.test.mjs` prints it): the S355 radius bend solves 0.044 to 0.073 seconds of model time per second of computation, and the earlier finer setting (a tenth of a thickness per step) 0.032. A 30 mm stroke at 10 mm/s is 3 s of model time and takes about a minute; the 6061-T6 V bend is about the same per second. Approach and retraction clear of the sheet cost nothing. The solver runs free in the Studio's worker toward wall time, whatever the drawing rate ([`ENGINEERING-STUDIO.md`](ENGINEERING-STUDIO.md#scheduling-the-solver-runs-free-of-the-renderer)); when it is slower than real time the footer says how far behind it is. A saved run resumes exactly: its checkpoint carries the press brake's state ([`ENGINEERING-STUDIO.md`](ENGINEERING-STUDIO.md#saved-runs-resume-exactly)).

What sets the cost: each step is a Newton solve of the section (about 2,000 to 3,600 unknowns, conjugate gradients) with the contact active set and the plastic zone changing; it takes 15 to 40 Newton iterations. The step carries the last increment forward as its starting guess, which halved the iterations. Coarser sections (two cells through the thickness) run about four times faster but are markedly stiffer in bending (springback 0.54 of the elastic closed form instead of 0.90), so the Studio keeps four.

## Limits

- Plastic-incompressibility locking of linear tetrahedra (no mixed element): forces a few percent high, springback a few percent low.
- The failure strain is one number from a tensile test, independent of stress state and element size: real sheet bends tighter than the model allows before cracking (the model cracks early, on the safe side).
- The hardening is a straight line between yield and tensile strength; the additive Green-Lagrange split is a moderate-strain model.
- One section stands for the whole width.
