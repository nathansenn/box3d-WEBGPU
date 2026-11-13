# Canopy load study (SI)

`index.html?studio=canopy` runs the canopy on the calibrated cloth (`src/engine/cloth.ts`, [`CLOTH.md`](CLOTH.md)) in SI units, through `src/studio/canopy-si.ts` (numerical backend `studio-canopy-cloth-si-v1`, in the Studio's worker). The Studio keeps its scene, look and panels; the fabric's shape, its stresses and its tears come from the cloth.

## What is modelled

- **Fabric.** The Studio's 10 m x 8 m sheet (1 scene unit = 1 m, 33 x 27 nodes, 1,664 triangles, about 0.3 m cells) of PVC-coated polyester from the library (`pvc-polyester-fabric`, [`MATERIALS.md`](MATERIALS.md)): 1.35 kg/m², an orthotropic membrane of 1,225 kN/m along the warp (along the 10 m span) and 1,000 kN/m along the weft (biaxial tests at small strain), nu 0.35, in-plane shear 30 kN/m (unverified), no bending stiffness. Tensile strength 165.5 kN/m warp and 122 kN/m weft, times the Studio's strength factor.
- **Supports.** The four corners are held at the posts. A steel edge cable runs along each side: E A = 8.5 MN (a 12 mm wire rope, about 100 GPa on 85 mm²; a typical figure, not from the library), pretensioned 0.3%.
- **Pretension and form.** The fabric's stress-free shape is the drawn one shrunk 0.4% in plan; a static solve under its weight finds the starting shape (0.13 m below the drawn one at the centre).
- **Loads.** Its weight; a uniform load on the plan area (snow) of 10 kPa per unit of the Studio's target load, ramped at 5.5 kPa/s; wind as a normal pressure `(1/2) rho C (u.n)|u.n|` from a wind speed of 15 m/s per unit of the crosswind control, along x with a lateral component of 0.3. The floor is a contact plane.
- **Tearing.** After each converged step a triangle whose stress along the warp or the weft reaches the strength tears (CLOTH.md). The drawn sheet loses an edge when every triangle on it has torn. Snow on fabric that is torn all round a node is dropped.
- **Time.** Backward Euler at 60 Hz (two Studio ticks per cloth step), mass-proportional drag 1.5 /s.

Not modelled: the fabric's nonlinear, creeping and cyclic response, seams and clamping plates, cable and post strength (the cables and posts never fail), wind as a flow (no suction, gusts or flutter), ponding, the drawn rig as contact (only the floor), tear paths finer than the mesh, and resuming a saved SI run (export works).

## Readouts

| Readout | Meaning | Unit |
|---|---|---|
| Deflection | Largest drop below the form-found shape | mm |
| Target load / chart load | Uniform load on plan | kPa |
| Crosswind | Wind speed | m/s |
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

`tests/studio/canopy-si.test.mjs` (in `npm run test:studio`) runs the study itself: the form-found canopy's corner reactions equal its weight (to 6e-6), and under 2 kPa equal weight plus snow (134.428 kN against 134.428 kN, 0.5% allowed for the damped approach to rest), the sag is 0.88 m and nothing tears; at half strength under the 45 kPa ramp the first triangle tears at 20.7 kPa, events and the drawn sheet follow; the worker runtime runs the backend and refuses to resume its checkpoint.

## Real time

Measured on one core of this sandbox (Node 22, shared 4-core machine): the form finding takes 1 to 2 s at start; then 0.36 to 1.3 seconds of model time per second of computation (`StudioCanopySI.realTimeFactor`), about 1 (real time) for loads up to tens of kPa and lower while a tear runs and the torn fabric hits the floor (steps then take up to 60 Newton iterations and some stop unconverged; they do not tear). In headless Chromium on SwiftShader the renderer limits the frame rate, not the model: the cloth runs free in the Studio's worker toward wall time ([`ENGINEERING-STUDIO.md`](ENGINEERING-STUDIO.md#scheduling-the-solver-runs-free-of-the-renderer)). A saved run resumes exactly, torn fabric included: its checkpoint carries the cloth's state ([`ENGINEERING-STUDIO.md`](ENGINEERING-STUDIO.md#saved-runs-resume-exactly)).

## Limits

- Linear orthotropic membrane at small strain (first-loading biaxial stiffness): real coated fabric stiffens, takes a permanent set and creeps.
- The shear stiffness is unverified; deflections depend on it weakly, bias stresses more.
- Strength-based tearing removes whole 0.3 m triangles; the load at which a tear starts at a defect depends on the mesh.
- Cables and posts never fail; the reaction at 50 kPa (3.3 MN) is far beyond any real fitting.
- One material per sheet; no seams or reinforcement patches.
