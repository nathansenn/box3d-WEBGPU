# Canopy load study (SI)

`index.html?studio=canopy` runs the canopy on the calibrated cloth (`src/engine/cloth.ts`, [`CLOTH.md`](CLOTH.md)) in SI units, through `src/studio/canopy-si.ts` (numerical backend `studio-canopy-cloth-si-v1`, in the Studio's worker). The Studio keeps its scene, look and panels; the fabric's shape, its stresses and its tears come from the cloth.

## What is modelled

- **Fabric.** The Studio's 10 m x 8 m sheet (1 scene unit = 1 m, 33 x 27 nodes, 1,664 triangles, about 0.3 m cells) of PVC-coated polyester from the library (`pvc-polyester-fabric`, [`MATERIALS.md`](MATERIALS.md)): 1.35 kg/m², an orthotropic membrane of 1,225 kN/m along the warp (along the 10 m span) and 1,000 kN/m along the weft (biaxial tests at small strain), nu 0.35, in-plane shear 30 kN/m (unverified), no bending stiffness. Tensile strength 165.5 kN/m warp and 122 kN/m weft, times the Studio's strength factor.
- **Supports.** The four corners are held at the posts. A steel edge cable runs along each side: E A = 8.5 MN (a 12 mm wire rope, about 100 GPa on 85 mm²; a typical figure, not from the library), pretensioned 0.3%.
- **Pretension and form.** The fabric's stress-free shape is the drawn one shrunk 0.4% in plan; a static solve under its weight finds the starting shape (0.13 m below the drawn one at the centre).
- **Loads.** Its weight; a uniform load on the plan area (snow) of 10 kPa per unit of the Studio's target load, ramped at 5.5 kPa/s; and wind by EN 1991-1-4 for a canopy roof (below), from a basic wind velocity v_b of 15 m/s per unit of the crosswind control, along x, its pressure ramped at 1 kPa/s. The floor is a contact plane.
- **Wind (EN 1991-1-4:2005+A1:2010, read in a BS EN copy: <https://structuraldynamics.ulb.be/DOS/en.1991.1.4.2005.pdf>).** The peak velocity pressure at the roof's height z (5.27 m above the floor) in terrain category II (Table 4.1: z0 = 0.05 m, z_min = 2 m), with c_o = 1, k_I = 1 and rho = 1.25 kg/m³ (the recommended values): v_m = c_r v_b, c_r = 0.19 (z0/0.05)^0.07 ln(z/z0), I_v = 1/ln(z/z0), q_p = [1 + 7 I_v] (1/2) rho v_m², the factor 1 + 7 I_v (2.50 here) being the code's gust allowance (a peak factor of 3.5, 4.5 Note 3). The expressions are images in the copy; they were written from its symbols and text. The canopy is flat: Table 7.6 (monopitch canopies) at 0°, empty (phi = 0), the minimum row (uplift): overall force coefficient c_f = −0.5 and net pressure coefficients −0.6 (zone A), −1.3 (B), −1.4 (C) (rows for +5° to +30°, the maxima and phi = 1 are in `EN1991_TABLE_7_6`). c_s c_d = 1 is taken (a small structure; not read here). The applied field is statically equivalent to the force coefficient: a pressure on the plan varying linearly along the wind, c_f q_p (a + b xi), with a and b fitted on the nodes so that the resultant is c_f q_p A and its centre lies d/4 from the windward edge, where Figure 7.16 places the centre of force (for the continuous plan a = 2.5, b = −3). `windForm: 'local'` applies the zone coefficients instead: the envelope of local maxima for all directions that the code gives for the roofing and its fixings (7.3(5)); its resultant is 1.56 times c_f q_p A at phi = 0, so it is not the load on the whole canopy.
- **Tearing.** After each converged step a triangle whose stress along the warp or the weft reaches the strength tears (CLOTH.md). The drawn sheet loses an edge when every triangle on it has torn. Snow on fabric that is torn all round a node is dropped.
- **Time.** Backward Euler at 60 Hz (two Studio ticks per cloth step), mass-proportional drag 1.5 /s.

Not modelled: the fabric's nonlinear, creeping and cyclic response, seams and clamping plates, cable and post strength (the cables and posts never fail), the wind as a flow around the deforming sheet (the code's coefficients are for a rigid flat roof; no flutter, no gust time history, no change of the coefficients as the sheet lifts into a dome), wind along z or downward cases in the Studio (the code's maxima are in the table but the control gives uplift), ponding, the drawn rig as contact (only the floor), tear paths finer than the mesh, and resuming a saved SI run (export works). No CFD coupling of the cloth with the volumetric fluid was attempted.

## Readouts

| Readout | Meaning | Unit |
|---|---|---|
| Deflection | Largest drop below the form-found shape | mm |
| Target load / chart load | Uniform load on plan | kPa |
| Crosswind | Basic wind velocity v_b (EN 1991-1-4) | m/s |
| Torn triangles | Triangles that reached a yarn strength | of 1,664 |
| Response colours | Utilisation: largest yarn stress over its strength around each node, cyan 0 to red 1 | 1 |

The footer states what is modelled and links this document. The prepared load cases are SI cases: design snow 0.75 kPa, heavy snow 2 kPa, snow with a 24 m/s wind, a 30 m/s wind, overloads to 30 to 50 kPa at 0.4 to 2 times the library strength.

## Hand numbers

Weight: 1.35 kg/m² on about 67 m² of fabric, 0.88 kN. A uniform load q on a span L = 8 m with sag f takes a membrane tension of about q L² / (8 f): at 2 kPa and f = 0.9 m about 18 kN/m, 0.15 of the weft strength; measured largest utilisation 0.078 (the edge cables carry much of the load into the corners: 74 kN in the most loaded cable). At the library strength the fabric carries 50 kPa (utilisation 0.94): a real canopy fails long before, at its cables, clamps, seams or posts, which are not modelled. At half the library strength (an aged or damaged membrane) it tears at 20.7 kPa.

## Validation

The membrane and its new options are validated in `tests/engine/cloth-fabric.test.mjs` (CLOTH.md, rows in [`VALIDATION.md`](VALIDATION.md)):

| Check | Closed form | Measured | Tolerance |
|---|---|---|---|
| Strip along warp / weft | `eps = T / E` | -0.18% / -0.19% | 0.2% |
| Strip at 45° | orthotropic compliance | -1.5% | 2% |
| Long strip under 2 kPa | circular arc, `T = p R` | -0.5% | 1% |
| Pretensioned square membrane under 50 Pa | Fourier series of `T laplacian(w) = -q` | -2.0% | 3% |
| Its reactions | the applied load | 1e-9 | 1e-6 |
| Onset of tearing of a strip | its strength | 1.057 | 0.99 to 1.12 |
| A slit strip | below the net section; one-element LEFM estimate | 0.22 of net; 1.27 x estimate | 0.7 to 1.5 x |

Wind (`tests/studio/canopy-si.test.mjs`): q_p reproduces the code's expressions to 1e-12 and its exposure factor at 10 m in terrain II is 2.352 (Figure 4.2 of the code reads about 2.35; read from memory, not from the opened copy); for each case of Table 7.6 the nodal forces sum to c_f q_p A and their centre lies d/4 from the windward edge, both to 1e-12; the key-plan zones cover 64%, 20% and 16% of the plan; the local zone envelope gives 3.74 (max), 1.56 (phi = 0) and 1.24 (phi = 1) times the overall force. Under v_b = 30 m/s, q_p = 1103 Pa and the uplift on the 80 m² plan is 36.8 kN. Under v_b = 15 m/s (q_p 276 Pa) the static equilibrium of the sheet has the posts carrying the weight less the uplift (−8.32 kN against 0.88 − 9.21 kN, within 0.2%); the sheet rises 2.2 m into a dome and does not tear.

`tests/studio/canopy-si.test.mjs` (in `npm run test:studio`) also runs the study itself: the form-found canopy's corner reactions equal its weight (to 6e-6), and under 2 kPa equal weight plus snow (134.428 kN against 134.428 kN, 0.5% allowed for the damped approach to rest), the sag is 0.88 m and nothing tears; at half strength under the 45 kPa ramp the first triangle tears at 20.7 kPa, events and the drawn sheet follow; the worker runtime runs the backend and refuses to resume its checkpoint.

## Real time

Measured on one core of this sandbox (Node 22, shared 4-core machine): the form finding takes 1 to 2 s at start; then 0.36 to 1.3 seconds of model time per second of computation (`StudioCanopySI.realTimeFactor`), about 1 (real time) for loads up to tens of kPa and lower while a tear runs and the torn fabric hits the floor (steps then take up to 60 Newton iterations and some stop unconverged; they do not tear). In headless Chromium on SwiftShader the renderer, not the solver, limits the frame rate.

## Limits

- Linear orthotropic membrane at small strain (first-loading biaxial stiffness): real coated fabric stiffens, takes a permanent set and creeps.
- The shear stiffness is unverified; deflections depend on it weakly, bias stresses more.
- Strength-based tearing removes whole 0.3 m triangles; the load at which a tear starts at a defect depends on the mesh.
- Cables and posts never fail; the reaction at 50 kPa (3.3 MN) is far beyond any real fitting.
- One material per sheet; no seams or reinforcement patches.
- Wind: the coefficients of a rigid flat canopy applied to a membrane that lifts metres (a real dome sees other pressures); terrain II and v_b along x only; the uplift case only from the Studio's control; the code's c_s c_d taken as 1.
