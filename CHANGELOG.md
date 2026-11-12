# Changelog

## Unreleased — 2026-11-12 — Concrete crush lab in SI units on a concrete damage-plasticity law

- **Solid (`src/engine/concrete-law.ts`, `material.concrete` of `SolidBody`, solver id `solid-tet-dp-rankine-js-f64-v1`):** composite plasticity for concrete on the J2 structure of the solid. Associated Drucker-Prager in compression, hardening and softening so that uniaxial compression follows EN 1992-1-1 3.1.5 (3.14) from 0.4 f_cm to f_cm at eps_c1 and on to eps_cu1, then a tail of area G_c (f_cm × 0.5 mm / 2, the ATENA default after van Mier) regularised by the crack band; Rankine in tension with linear softening of area G_f; friction parameter fitted to the biaxial strength 1.16 f_c. Exact minimiser of the incremental potential per element (tensor-form Drucker-Prager fast path, principal-axis Drucker-Prager / Rankine corners with Anderson mixing), a lazily formed finite-difference tangent, erosion of crushed and opened elements, `erode()`, `setStrengthFactors()`, `damage()`, `crackOpening()`, and the preconditioner rebuilt from live elements. All of it is in `saveState()`. `SolidContact` gains `predictor: 'velocity'` (start each step from the free motion). The kit ships `concrete-law.js`.
- **Validated (`tests/engine/solid-concrete.test.mjs`, 7 tests, in `npm run test:solid`; 15 rows `solid.concrete.*`):** C30/37 peak 37.92 MPa at 2.20 ‰ (f_cm 38, eps_c1 2.2), within 2.3 % of f_cm of (3.14) up to eps_cu1; tensile peak and G_f A through a localised crack within 0.02 % on 5, 10 and 20 cells; G_c per unit area of a crushed cell within 2 % for h = 120, 60, 30 mm; the Drucker-Prager confinement closed form within 0.5 % (1.07 and 1.28 f_cm at 0.05 and 0.2 f_cm lateral, below EN 1992-1-1 3.1.9's 1.25 and 1.63); a bit-exact resume of a cracked and crushed solid, and a concrete set-up in the kit's checkpoint test. Not objective: compressive softening in a prism spreads beyond one element layer (26, 54, 119 J against 13.7 J on 5, 10, 20 cells), documented.
- **Material library 1.5.0:** `concrete-c20-25`, `concrete-c60-75`, `concrete-lc25-28` (EN 1992-1-1 Table 3.1 and section 11, read in a scanned copy of the standard), `alumina-96` (Syalons Aloxalon 96, Morgan AL600); C30/37 gains eps_c1, eps_cu1 and G_f (fib Model Code 2010 formula as quoted by Sucharda 2020); `concreteMaterial()`; new properties `peakStrain`, `ultimateStrain`; category `ceramic`. 32 materials, 274 values, 10 unverified (the LC fracture energy is new among them). `fractureLaw('concrete-c30-37')` now uses the library G_f.
- **Studio (`src/studio/material-labs/concrete-si.ts`):** the concrete crush lab runs a 625-element 150 mm cube (drawn eight times larger) between a fixed steel base and a displacement-controlled steel platen through `SolidContact`, friction 0.57 (Rabbat and Russell 1985, from a search summary: unverified), in the shared lab worker. Elements are coloured by the strength they lost and spalled elements are removed; readouts in MPa, % and kN, with a stress-strain chart against the EN 1992-1-1 cylinder curve; the machine stops when no equilibrium is found past the peak or the load falls below 30 % of it. Mixes: C30/37, C60/75, LC25/28, C20/25 for mortar and weathered (unverified mappings), fibre concrete (C30/37 with an unverified fibre softening), reinforced (plain C30/37, marked as not modelled), 96 % alumina. The "not calibrated" footer is replaced by "SI damage-plasticity solid · what is modelled".
- **Measured:** the cube peaks at 45.0 MPa (1.18 f_cm) at 2.87 ‰ and fails at 7.2 ‰; with frictionless platens 37.8 MPa at 2.30 ‰; a 150 × 150 × 300 mm prism with the same platens 38.5 MPa, a cube-to-prism ratio of 1.17 against 37 / 30 = 1.23 in EN 1992-1-1 Table 3.1 (row `solid.concrete.cube-cylinder`). Real-time factor in Node 0.36 to 0.44 over the failing programs (20 to 60 ms per step before the peak, up to about a second while softening), 1.25 for C60/75 to 6 ‰, 6.0 at low strain, 2.0 for the ceramic.
- **Tests:** `tests/studio/concrete-si.test.mjs` (6 tests, about 90 s, in `test:studio:materials`); `material-labs.test.mjs` runs the first 2 s of each concrete preset.
## Unreleased — 2026-11-12 — The Studio's suspension bridge on the validated solvers

- **Model (`src/engine/si-suspension.ts`, `docs/SI_BRIDGE.md`):** the Studio's 42 m footbridge in SI units: a deck grillage (HEA 340 girders, IPE 200 crossbeams, plan bracing) and two portal towers (HEB 400 columns) as frame elements; both 50 mm locked-coil main cables, the four backstays and 70 spiral-strand hangers as one tension-only cable network with exact geometry; steel values from the material library, timber density from it too. Form-finding cuts every segment so that the deck is level at the hangers (5.8·10⁻⁸ m) and the cables pass the drawn 6.8 m sag. An independent envelope-Cholesky statics (Newton) gives the dead-load state, load cases, a damaged re-solve and the modes. Crowd (N/m² on whole panels), wind (N/m), hanger failure and an optional rigid service vehicle on the Box3D world.
- **Solvers (opt-in, existing paths unchanged):** `CompliantCableRuntime` gains a Newton backend for elastic networks (the same backward-Euler step as the proximal backend, solved with a kept direct factor), `coupleNodes()` and `releaseLink()`; `FrameRuntime` gains `solver: 'direct'` and `setLoads()`; `StructureCoupling` solves a Newton cable network together with its frame (the frame's full interface response, consistent with its midpoint rule) and rebuilds its interface once per step instead of per attachment. The kit carries `envelope-matrix.ts`.
- **Validated (`tests/physics/si-suspension.test.mjs`, 16 tests in `npm run test:assets`; 24 rows in `docs/VALIDATION.md`):** main cable H within 1.9 % of `w L²/8f` (the end hangers carry 13 % more), tower tension equal to `√(H²+V²)` to 2·10⁻⁸, the midspan hanger equal to one panel of deck to 2·10⁻⁸; a 20 kN point load within 2.2 to 3.3 % of the linearised deflection theory and its cable force within 0.4 %; the first antisymmetric mode 1.4148 Hz against 1.4054 Hz from the tensioned-beam closed form, and 1.4143 Hz time-stepped; the time-stepped model equal to its statics to 10⁻¹⁰ under a crowd, after a hanger failure (7.9·10⁻⁷) and under wind; mirror symmetry to 10⁻¹²; a parked vehicle to 5·10⁻⁹; bit-identical repeats. 5 to 9 ms per 120 Hz step in Node.
- **Studio (`src/studio/si-bridge-study.ts`, `main.ts`, `bridge-review*.ts`, `bridge-experiments*.ts`, `presets.ts`):** the bridge study runs on that model in the Studio's worker; its deck boards, steelwork, rails, main cables and hangers are drawn from the model's node positions each frame, with the Studio's materials, river and ecology unchanged. Controls in SI (crowd 0 to 5 kN/m² on the east half, hangers cut 0 to 6, wind 0 to 2 kN/m) and the ten load cases in those units; readouts in mm, kN, MPa and fractions of stated strengths in the inspector, Analyze → Inspect and Experiments; the footer reads "SI model · validated solvers" with a link to the document instead of "Comparative model · not calibrated" for this study only. Bridge acceptance tests (`tests/studio/bridge-experiments.test.mjs`, `bridge-review.test.mjs`, the bridge recipes in `presets.test.mjs`) rewritten against SI values; saved baselines and scans of the old model are not read (storage keys v2).
- **Startup in software rendering:** the approach-road gravel texture is rastered on the CPU (`willReadFrequently`); an accelerated canvas deferred its 18,000 grains to the first frame's texture upload, which took 41 s of main thread under SwiftShader (2.7 s without the rest of the scene). The bridge route now reaches render-ready in 108 s on this sandbox (4 cores, load 12 to 28) against 127 to 247 s before; the rest is SwiftShader's own work (87 s of the 108 the main thread waits on it), so the release browser test's 90 s wait can still run out on a loaded machine.
- **Exact checkpoints (on top of `src/engine/checkpoint.ts`):** the cable runtime's Newton state (node order, the kept factor's envelope, the coupling version), released links and coupled nodes are saved through handlers; the frame runtime's direct factors are left out as a cache that depends only on what is fixed at construction; the coupling's joint-step data and rebuild counters are plain state. `SiSuspensionBridge.saveState()` / `restoreState()` hold the whole bridge without a vehicle; resumed in a fresh bridge or rewound in place it steps on bit for bit (new test in `si-suspension.test.mjs`; 8.9 MB per checkpoint). The existing checkpoint tests pass unchanged.
- **Default load case:** *Hanger loss under crowd* cuts four upstream hangers by design (the old default was *Progressive collapse*); its four failures are those cuts, none a rupture, and without cuts the same crowd and wind fail no hanger (test in `bridge-review.test.mjs`). Snapshots carry `si.hangersCut`; the readouts show "of 70 · 4 cut" and, in Inspect, "4 cut, 0 ruptured".
- **Not done:** resuming a saved bridge run in the Studio (its checkpoint format does not carry the model; Export evidence holds the recorded response), the service vehicle in the Studio (it triples the step cost), a failed hanger drawn hanging, saddle slip, buckling, aerodynamics beyond a static load, a pedestrian comfort check (the first mode is in the walking band). Seen in software rendering only.

## Unreleased — 2026-11-12 — Elastomer lab in SI units

- **Studio (`src/studio/material-labs/rubber-si.ts`):** the elastomer lab runs a 625-element viscoelastic Neo-Hookean cylinder (`config.viscoelastic`) between bonded steel platens (`SolidContact` welds) in the shared lab worker. The platen compresses at the set rate, holds while the force relaxes, then follows the specimen with no load so it recovers by its own creep recovery. The renderer draws the solid's boundary from its nodes; the readouts are compression (%), platen force (kN) and retained volume (%); the material panel shows long-term and instantaneous moduli and relaxation times; the "not calibrated" label is replaced by a link to `docs/STUDIO_MATERIAL_LABS.md`.
- **Values:** natural rubber's modulus and density from the library; a filled rubber's 4-term Prony spectrum from Andena et al. (Constitutive Models for Rubber XII, 2023, Table 1); the other moduli and spectra are typical figures marked unverified. Foams are compressible Neo-Hookean (ν = 0).
- **Measured:** real-time factor 0.73 (soft gel) to 4.8 (memory foam) over the 18 to 24 s programs, 1.15 for the default silicone cycle (1.32 in the browser's worker). Bonded compression of the lab's mesh is 52 % stiffer than the bonded-block closed form (volumetric locking at ν = 0.49), stated in the lab and as validation row `solid.bonded-compression`.
- **Tests:** `tests/studio/rubber-si.test.mjs` (5 tests, 40 s, in `test:studio:materials`); `material-labs.test.mjs` runs the first 1.5 s of each elastomer preset.

## Unreleased — 2026-11-12 — Canopy study on the calibrated cloth, woven fabric and tearing

- **Cloth (`src/engine/cloth.ts`, `docs/CLOTH.md`):** an orthotropic membrane for woven fabric (`material.orthotropic`: warp and weft stiffness, shear and nu in N/m, the warp direction turned into each triangle), tension-only edge cables (`cables`, `cableTensions()`) and strength-based tearing (`material.strength`: a triangle tears after a converged step when the stress along a yarn reaches its strength; `tornCount`, `tornMask`, `yarnStress()`, `setStrength()`). All of it is in `saveState()`. The isotropic path is unchanged.
- **Material library 1.4.0:** `pvc-polyester-fabric` (Ambroziak 2020, Precontraint 1302 S2: 1.35 kg/m², warp 1225 and weft 1000 kN/m, nu 0.35, strength 165.5 / 122 kN/m; Sioen B6657 for tear strength; shear stiffness unverified) and `fabricMaterial()`. 28 materials, 239 values, 9 unverified.
- **Validated (`tests/engine/cloth-fabric.test.mjs`, 7 tests in `npm run test:engine`; 7 rows in `docs/VALIDATION.md`):** strips along warp and weft within 0.2% of `T / E`, at 45° within 1.5% of the orthotropic compliance; a pressurised orthotropic strip within 0.5% of the circular arc; a pretensioned square membrane within 2.0% of the Fourier series, reactions equal to the load; tear onset at 1.057 times the strength; a slit strip below the net section and at 1.27 times a one-element LEFM estimate; a torn cloth resumes from a checkpoint bit for bit.
- **Studio (`index.html?studio=canopy`, `src/studio/canopy-si.ts`, `docs/STUDIO_CANOPY.md`):** the canopy runs on that cloth in its worker (backend `studio-canopy-cloth-si-v1`): library fabric with the warp along the span, four corner posts, pretensioned steel edge cables, form finding under its weight, a uniform load on plan in kPa (10 kPa per unit of target load), wind in m/s as a normal pressure, tearing drawn as broken fabric. Readouts in mm, kPa, m/s and torn triangles; utilisation colours; SI load cases; the footer states what is modelled and links the document. Reactions equal weight plus load (`tests/studio/canopy-si.test.mjs` in `npm run test:studio`).
- **Real time:** 0.36 to 1.3 of real time on one core; slower while a tear runs.
- **Not done:** nonlinear fabric response, cable, clamp and post failure, wind as a flow, ponding, resuming a saved SI canopy run.

## Unreleased — 2026-11-12 — Metal press study on the SI press brake

- **Studio (`index.html?studio=plate`, `src/studio/press-si.ts`, `docs/STUDIO_METAL_PRESS.md`):** the metal press runs the SI press brake (`src/engine/press-brake.ts`) in the Studio's worker, numerical backend `studio-press-brake-si-v1`. A punch air-bends a 520 × 440 mm sheet of S355 or 6061-T6 (library data) between two die shoulders: the V blade (nose radius one thickness) or the 36 mm beading bar, any thickness from 1 to 12 mm, the tool rotation turning the bend line. The solved plane-strain section is swept along the bend line and drawn on the Studio's sheet; eroded elements break the drawn sheet along the bend. The ram approaches, forms at the strike speed, stops at the stroke (at most 0.6 of the die opening) or at the force limit (`Pressure limited`), holds and retracts; springback comes from the solved unloading.
- **Readouts in SI:** bend depth in mm, punch force and force limit in kN (the pressure setting is a percentage of a 1000 kN rating), equivalent plastic strain in %, eroded elements; the chart plots mm and kN; the response colours are the plastic strain against the failure strain; the footer states what is modelled and links the document. Seven prepared SI cases replace the authored experiments in the press workbench, which offers the two library metals and the two line punches. The die is drawn with the model's shoulders.
- **Checked:** `tests/studio/press-si.test.mjs` (in `npm run test:studio:press`): geometry from settings, a full S355 stroke with the peak force against the beam limit load, a cracking 6061-T6 V bend, the force limit, the worker runtime and the refusal to resume an SI checkpoint.
- **Cost:** 0.05 to 0.07 of real time on one core of this sandbox (a tenth of a second of solving per quarter-thickness of punch travel); the Studio clock shows the lag. Approach and retraction away from the sheet cost nothing.
- **Not done:** resuming a saved SI run, the authored metals and the ten other tool shapes in SI, end effects along the bend line, the canopy study.

## Unreleased — 2026-11-12 — Metal plasticity in the solid solver

- **J2 plasticity (`src/engine/solid.ts`, `docs/SOLID_MECHANICS.md`):** a material with `yieldStress` (and optional `hardeningModulus`, `failureStrain`) makes the `linear` model and the new `green-lagrange` model (St Venant-Kirchhoff, exact under rotation) elastic-plastic: von Mises yield, associative flow, linear isotropic hardening, backward-Euler radial return. The solve minimises the incremental potential (stored energy plus hardening and dissipation), whose Hessian is the consistent elastic-plastic tangent, so Newton and the line search work unchanged. The state is committed after each static load step, each time step and each `SolidContact` step (`SolidKernel.commit()` is new). Elements whose equivalent plastic strain reaches `failureStrain` erode. New outputs: `equivalentPlasticStrain()`, `plasticStrains()`, `plasticWork`, `erodedCount`, `erodedMask`; solver id `solid-tet-j2-js-f64-v1`. Plasticity is refused for the corotational and Neo-Hookean models and the midpoint integrator.
- **Press brake (`src/engine/press-brake.ts`):** air bending of a plane-strain section of sheet (green-lagrange J2 solid, half by symmetry) between a kinematic punch and two die shoulders in `SolidContact` with Coulomb friction; forces for the whole sheet width.
- **Material library:** elongation at break for 6061-T6 (12%, ASM datasheet) and, unverified, S355 (22%); `plasticMaterial(id)` builds yield stress, a bilinear hardening fit and a failure strain. 230 values, 8 unverified.
- **Measured (`tests/engine/solid-plasticity.test.mjs` 9 tests, `tests/engine/press-brake.test.mjs` 3 tests, in `npm run test:solid`; 6 new rows in `docs/VALIDATION.md`):** uniaxial bilinear cycle with reverse yield to 1e-11; tangent and gradient against central differences to 1e-9; work balance to 0.1%; pure-bending moment 2.9% to 3.2% above the closed form on 16 x 8 cells, springback curvature within 0.34%; thick cylinder first yield and Hill's collapse pressure bracketed within ±2%; a 2 mm S355 three-point air bend at 1.23 times the beam limit load with springback 0.90 of F V^3 / (48 E' I); 6061-T6 cracks over a 1 mm nose, S355 does not over an 8 mm nose.
- **Checkpoints:** the plastic state (committed plastic strains, equivalent plastic strain, eroded flags, plastic work) is part of `SolidBody.saveState()`; `PressBrake` has `saveState()` / `restoreState()`. A plastic bar across the onset of erosion, a press brake mid-stroke and (in `v19-checkpoint.test.mjs`) an elastic-plastic block dented by a sphere in the stepping loop resume bit for bit. Material library 1.3.0 (230 values). Plasticity together with the new viscoelastic Prony branches is refused with a clear error.
- **Not done:** a mixed or averaged-pressure element against plastic-incompressibility locking, finite plastic strain, kinematic hardening, a failure strain that depends on triaxiality.
## Unreleased — 2026-11-12 — Viscoelastic solid

- **Solver (`src/engine/solid.ts`, `config.viscoelastic`):** a Prony series on the elastic stress of the tetrahedral solid (linear, corotational or Neo-Hookean): long-term moduli from the material, up to 8 branches of `{ratio, time}`, Simo's recursion per element and step, each step still one minimisation (tangent scaled by `1 + sum b_i ratio_i`). Backward Euler only; the history is committed by `step()` and by `SolidContact` through the kernel. Statics give the relaxed solid. New read-only `viscoelasticScale`.
- **Validated (`tests/engine/solid-viscoelastic.test.mjs` in `npm run test:solid`, 6 tests; 6 rows `solid.viscoelastic.*` in `docs/VALIDATION.md`):** relaxation follows the discrete recursion to 1e-15 and `E (1 + gamma e^(-t/tau))` to 0.09 %; creep and recovery of the standard linear solid to 0.03 % and 0.10 % with first-order convergence in the step; a Neo-Hookean block relaxes to its elastic stress; a soft cube on a plane through `SolidContact` creeps to its relaxed settlement (−0.07 %).
- **For the Studio:** this is the material law the elastomer lab needs for creep, hold and recovery. The lab itself is not converted yet (see `docs/STUDIO_MATERIAL_LABS.md`).

## Unreleased — 2026-11-12 — Glass impact lab in SI units

- **Finding:** linear tetrahedra cannot model the Studio's 2.6 m × 2.0 m × 8 mm pane: with 0.1 m cells the solid of `SOLID_MECHANICS.md` deflects 1e-4 of the Navier value, and 0.09 to 0.25 of it even with cells as wide as the pane is thick. The glass lab therefore runs a plate.
- **Solver (`src/engine/plate.ts`, `plate-kirchhoff-fd-explicit-js-f64-v1`):** Kirchhoff bending on a regular grid with energy-consistent finite-difference curvatures, explicit symplectic Euler under a Gershgorin step limit, supports, clamp couplings, implicit mass damping and dashpots; brittle fracture as broken bonds where the mid-bond principal surface stress less a prestress reaches the strength; a dicing front for toughened glass; bridging membranes for laminates and wire; pieces joined by shared curvature terms.
- **Validated (`tests/engine/plate.test.mjs`, `npm run test:plate` in the pull-request gate, 6 tests; 9 rows in `docs/VALIDATION.md`, domain `plate`):** Navier deflection 9e-6 and moment 1.8e-3 at 0.1 m cells, second order; the (1,1) mode at the grid's exact frequency to 1e-6 and 0.17 % below Kirchhoff; first crack under uniform pressure 0.6 % above the Navier stress and exactly scaled by a prestress; pieces conserve mass and momentum; bit-identical repeats.
- **Studio (`src/studio/material-labs/glass-si.ts`):** the glass lab runs that plate in SI units in its existing worker: six natural-rubber clamp pads, a rigid pendulum with a damped penalty contact, library glass (annealed 41 MPa; toughened with 124 MPa surface compression; laminated with 0.76 mm PVB at 33 MPa; wired; BOROFLOAT 33 at 25 MPa; PMMA), detached pieces falling as rigid bodies. The renderer bends the intact pane with the plate, draws the node tiles and the broken bonds, and the readouts are peak contact force (kN), peak surface stress (MPa) and out-of-plane deflection (mm), with pieces, share held and farthest fragment in the status line. The "not calibrated" label of this lab links to `docs/STUDIO_MATERIAL_LABS.md`. The "Thick panel" preset is now 20 J (the old 98 J breaks 24 mm glass in this model) and "Support restraint" is "Clamp pad stiffness".
- **Materials (library 1.2.0):** `soda-lime-glass-toughened`, `borosilicate-glass` (SCHOTT) and `pvb-interlayer` (AGC), 14 values and 2 sources (27 materials, 228 values).
- **Tests:** `tests/studio/material-labs.test.mjs` asserts SI outcomes (cracks if and only if the surface stress reached the strength plus prestress; thick pane and acrylic intact; annealed sheds pieces; toughened falls out; laminated and wired keep every piece) and now runs in the Studio gate (`test:studio:materials`, about 4 minutes; it was unwired at 36 minutes). The convex-contact glass scene is kept as `glass-convex.ts` for the contact-world qualification tests.
- **Measured:** laminated sag 0.40 m at 3 s against 5.8 m for the farthest annealed fragment (6.9 %; the old authored 30 % target is reported, not forced). Real-time factor over the 12 s programs 0.29 (24 mm) to 2.5 (acrylic), 0.92 for the default strike; the old fractured presets ran at 0.01 to 0.09.
- **Not done:** concrete crush and elastomer lab in SI (no damage-plasticity or viscoelastic solid yet); membrane stiffening of the unbroken pane, Hertzian contact cracks, crack paths finer than the 0.1 m grid, tearing of the interlayer, fragment–fragment collisions. Two inputs are unverified: the dicing speed and the wire-mesh geometry; the plate damping is assumed.

## Unreleased — 2026-11-12 — Exact checkpoints

- **What:** save the complete state of a running simulation and restore it, in the same page or a fresh one, so that the resumed run is bit-identical to the uninterrupted one: the rigid world (contacts with their warm-start impulses, constraint graph, islands and sleep timers, joints and their impulses, broad phase), every coupled solver's fields, histories, warm starts, clocks, counters, ledgers and event cursors. Roadmap Phase 1 "Solver state save and load" ([`docs/CHECKPOINTS.md`](docs/CHECKPOINTS.md)).
- **Rigid world (`wasm/box3d_snapshot.c`, `wasm/box3d_web.c`):** Box3D v0.1.0's own world snapshot, which its recording player restores in place on a backward seek, wrapped in a self-contained image with its geometry registry (the only bridge source that includes Box3D's internal headers; the hull and mesh address the snapshot leaves in each shape is zeroed so equal states give equal bytes). Four new optional exports: `b3w_world_checkpoint`, `b3w_world_checkpoint_ptr`, `b3w_world_checkpoint_free`, `b3w_world_restore`; the bridge adds its body table, render streams, kinds, hand-set mass data and RNG. A restore validates before it changes anything; in a world built the same way the caller's body and joint handles stay valid even when the world hosted other scenes before. World API version still 1; recipes, streams and hashes unchanged. Both artifacts rebuilt; `BUILD_PROVENANCE.json` records the glue's SHA-256.
- **Engine:** `src/engine/checkpoint.ts` (state trees, a bit-exact binary encoding, the `B3CK` container with a format version and a SHA-256, and a field walker that refuses an object field nobody classified); `NativeWorldBackend.checkpoint()` / `restoreCheckpoint()`; `saveState()` / `restoreState()` on every solver (water, structure with its cables and frames, heat, solid, fracture, solid contact, cloth, grains, fluid, free-surface fluid, and their couplings); `checkpoint()` / `restore()` on the `Subsystem` contract, every adapter and link; `Simulation.checkpoint()` / `restore()` (refuses another scene, set-up, version or a damaged file), `simulationCheckpointInfo`, `resumeSimulationScene`.
- **Kit:** `PhysicsWorld.checkpoint()` / `restoreCheckpoint()`, `RemoteWorld.checkpoint()` / `restoreCheckpoint()`, `resumeSimulation`, `CHECKPOINT_VERSION`, `CHECKPOINT_ERROR`, `checkpointInfo` (kit `CHANGELOG.md`).
- **Fluid scenes:** the `fluids` section's flows and free-surface tanks are covered (`freeSurfaceSubsystem` has `checkpoint()` / `restore()`).
- **Lab:** **Save checkpoint** (a `.b3ck` file) and **Load checkpoint…** in the Scenes panel next to *Download scene*; a dropped `.b3ck` file loads too. The checkpoint carries its scene, title and step count.
- **Measured:** `packages/box3d-kit/test/v19-checkpoint.test.mjs` (kit gate, 7 tests, about 170 s on a shared 4-core machine): all 19 example scenes (the four volumetric-fluid ones included) resume bit for bit in a fresh world (the whole state after 40 to 300 more steps is the same bytes), nine of them in a fresh Node process too; one coupled set-up of each solver family (cloth, grains, fluid, solid contact, fracture across the onset of cracking, heat with a solid) resumes bit for bit with the same events; restore then checkpoint gives the same bytes; refusals of another scene, a flipped bit, another version, a truncated file and another set-up. `tests/physics/checkpoint.test.mjs` (in `npm run test:assets`): the Lab's path into a world that hosted other scenes. `scripts/checkpoint-browser-check.mjs` (not gated): Save checkpoint in one page and Load checkpoint in a fresh browser context, nine examples, the same transform and solver state hashes 30 Lab ticks later. Sizes 17 KiB to 0.6 MiB, save and restore 0.4 to 13 ms for the examples without a volumetric flow; a flow of about 4,000 cells takes about 3 MiB and 60 to 110 ms.
- **Not done / limits:** same WASM build only (no cross-build or cross-machine claim); checkpoints are not compressed and include solvers' work vectors; events queued between steps by a body destruction are not kept; the Lab's own clock, camera and panels are not saved.

## Unreleased — 2026-11-12 — Studio flow labs on the SI solvers

- **Free surface (`FreeSurfaceFluid`, `src/engine/fluid.ts`, `docs/FLUID.md`):** viscosity (`viscosity`, Pa s), implicit by backward Euler between two projections so that a liquid at rest stays at rest, with `walls: 'no-slip' | 'free-slip'` and no-slip interpolation of the particles' velocity next to the walls; voxelised obstacles (`addObstacle`, `moveObstacle`, `obstacleForce`: spheres, boxes, capsules, cylinders, a gate that lifts) that particles cannot enter; `setTimeStep`; faster transfers (no allocation per particle). Inviscid results unchanged to the last digits (dam break −3.9% volume and 7.4% worst time; sloshing 1.3315 Hz).
- **Validated (`packages/box3d-kit/test/v18-fluid.test.mjs`, 3 new tests, 5 new registry rows):** a viscous film slowing on a no-slip floor within 1.5% of the series solution; a viscous gravity current within 1.3% of Huppert (1982), x_N = 1.411 (g q³ t / 3 nu)^(1/5), read from the paper, and its growth rate within 1%; the hydrostatic force on a gate within 0.41% for water and glycerol, glycerol at rest to 1.6e-13 m/s; no particle enters a solid in a 3D release past a post.
- **Material library (`src/engine/materials.ts`, `docs/MATERIALS.md`, version 1.1.0):** glycerol (1.412 Pa s, Segur & Oberstar 1951; 1261.08 kg/m³, Bosart & Snoddy 1928 via Volk & Kähler 2018), olive oil (79.7 mPa s and 879 kg/m³, Brock et al. 2008) and honey (7.43 Pa s, Rodriguez-Navarro & Vivanco-Pezantes 2022; density unverified). 24 materials, 214 values, 7 unverified.
- **Granular validation (`packages/box3d-kit/test/v17-granular.test.mjs`, 1 new test, 5 rows):** library glass beads with one fitted rolling resistance (0.06) pile at 22.6° against 22° (Lajeunesse et al. 2005, Table I); their column collapse runs out within 30% of ΔL/L_i = 1.8 a (−25%, 0%, +17% at a = 0.47, 0.81, 1.50) and a low column keeps its height (−2%).
- **Liquid lab (`src/studio/material-labs/liquid-si.ts`, `docs/STUDIO_FLOW_LABS.md`):** the flume runs the free-surface solver in 3D in SI (6 m × 2 m tank, 0.125 m cells, lifting gate, two posts, liquid density and viscosity from the library or marked unverified); the drawn surface and the readouts (peak depth m, peak speed m/s, fluid volume m³, exact) come from it. The pipe bench's friction is Hagen–Poiseuille when laminar and the Colebrook correlation when turbulent, with SI viscosity; the panel shows Re and f. River, rain and surface tabs keep the authored depth model and are labelled so.
- **Granular lab (`src/studio/material-labs/granular-si.ts`):** the discrete element solver in a 0.57 m tray drawn ten times larger, coarse-grained 7–16 mm grains, a kinematic gate and a capped cylinder; glass beads and sand from the library, the other grains marked unverified; readouts runout (m), pile height (m), grains behind the gate.
- **Worker:** both labs step in the flow worker (`liquid-study-worker.ts`, with `lab-worker-protocol.ts` and `lab-worker-client.ts`); the footer shows the solver's live speed against real time and a statement of what is modelled, linking to the document, instead of "not calibrated".
- **Measured speed (solver only, loaded 4-core sandbox, load average 13 to 17):** flume 0.32 to 0.82 times real time, granular tray 0.14 to 0.29 (coarse gravel 1.28); both below real time for their default experiments.
- **Tests:** `tests/studio/liquid-si.test.mjs` and `tests/studio/granular-si.test.mjs` (in `npm run test:studio:liquid`); the liquid lab's v2–v5 suites now use SI pipe inputs and run flume presets for one second.

## Unreleased — 2026-11-12 — The scene editor opens coupled scenes

- **Editor model (`src/lab/scene-editor-model.ts`):** a scene with water, cables, frames, cloths, grains, solids, heat or fluids opens instead of being refused. Its bodies and joints are edited as before; every command carries the sections as the same values, so each section's canonical text is unchanged through edits, undo, redo, autosave, Download and Copy share link. `coupledSections(scene)` lists each entry with its kind, key values and the bodies it names. New command `setCoupled` sets one of a few values per section (`COUPLED_EDITS`: water level; cloth areal density, Young's modulus, thickness; grain count (keeps the first N), friction, restitution; solid E, ν, density; heat conductivity, specific heat; fluid viscosity and density), validated and built in the scratch world like every command. Renaming a body renames it in every section that names it; deleting such a body is refused with the sections that name it; section ids share the namespace of new bodies.
- **Editor panel (`src/lab/scene-editor.ts`):** the outline lists the sections read-only under the bodies and joints, with their values and number fields for the editable ones. While the editor is open on a coupled scene, the scene's own lines (water grid, fluid boxes and arrows) are drawn with the editor's.
- **Checked:** `tests/physics/scene-editor.test.mjs` (21 tests): every coupled example opens, a body a section names is moved and renamed, delete is refused, undo and redo restore the exact text, a saved link keeps each section byte for byte; section values set, refused with the validator's paths and undone. `scripts/coupled-scenes-browser-check.mjs` and `scripts/lab-webgl2-browser-check.mjs` (not gated) open `lab.html?example=sphere-settling&edit=1`: section listed, ball moved by typing, viscosity set and a negative one refused, undo to the opened hash, the copied link reopened with the edited hash, the scene drawn alike by WebGPU and WebGL2.
- **Not done:** adding, removing or reshaping a section, editing its other values (meshes, supports, attachments, boundaries, grids, saved fields), picking a section's parts in the view, deleting a body a section names.

## Unreleased — 2026-11-12 — Volumetric fluid in scenes and in the Lab

- **Scene format (`src/engine/scene-format.ts`):** an optional `fluids` section, added like the other coupled sections (still version 1; every earlier example hash, rigid and coupled, unchanged). A flow has a grid (`cells`, `spacing`, `origin`), density, viscosity, sides (no-slip, sliding wall, free-slip, inflow, outflow, periodic), gravity on or off, advection and diffusion schemes, sub-steps, a starting velocity and the bodies that are its obstacles; a free-surface tank has its grid, density, particles per cell and boxes of liquid. Validation with JSON-pointer paths, including the explicit viscous limit and the starting Courant number at the fluid step and an outflow side along which gravity acts (which blows up: p = 0 cannot hold a hydrostatic pressure along it). Normal form, save of a flow's face velocities and pressures and of a tank's particles, share links.
- **Engine:** `loadSimulationScene` builds them (`fluids` map, also on the kit's `loadScene`): a flow with bodies through `FluidCoupling` (couple stage), without through a bare `Fluid` (post stage), starting from the hydrostatic pressure; a tank through the new `freeSurfaceSubsystem` (post stage, order 520). New on `Fluid`: `getState`, `setState`, `faceCount`, `obstacleDistance`; on `FreeSurfaceFluid`: `setParticles`. A reopened tank runs on bit for bit; a reopened flow restarts its Adams–Bashforth history.
- **Lab (`src/lab/coupled-scene.ts`, `coupled-panel.ts`):** a flow is drawn as a slice across z in ten colour bands of speed or of pressure less its hydrostatic part (picked in the panel; cells inside a body left out), with velocity arrows on a coarse sub-grid and the box edges as lines; a tank as one sphere per particle coloured on the same ramp. No new render pass: both the WebGPU and the WebGL2 renderer draw them. The panel shows each fluid's range, Courant number and iterations, and each body's speed and fluid force (`box3dLab.setFluidView`, `sceneState().fluidView`). A flow is framed face on to its slice.
- **Examples:** `lab.html?example=sphere-settling` (a PTFE ball in a 2.5 Pa s syrup in a 0.12 m column, 4,320 cells, 1/120 s step: terminal velocity 0.151 m/s within 0.3 s, against 0.447 m/s for Stokes in an unbounded fluid), `cavity-flow` (lid-driven cube, Re 100, 16³), `flow-past-cylinder` (Re 20, 80 × 32 cells in 2D, gravity off, a pair of standing vortices, drag coefficient 2.7 with 19% blockage), `dam-break` (a corner column in a closed tank, 1,440 particles). Measured in node over 5 s with the Lab's drawing: 7.2, 5.1, 8.9 (+2.2 drawing) and 9.4 ms per step, 1.1, 3.1, 1.5 and 1.7 times real time; in a headless browser with software WebGPU on a loaded machine 0.3 to 2.6 times.
- **Checked:** `tests/physics/lab-coupled-scenes.test.mjs` (in `npm run test:assets`): bit-identical repeat runs of the four examples through the Lab's code path; fluid validation paths and a flow refused at build with its id; the build (stages, hydrostatic start, divergence-free start, particle count); a save at step N reopened from its share link with the same fields bit for bit, two reopenings identical, and a reopened tank equal to the uninterrupted run; the slice, its bands, the cells inside the ball, arrows, particles; a fluid at rest one colour in pressure; the ball's terminal velocity and the cylinder's drag. `scripts/coupled-scenes-browser-check.mjs` and `scripts/lab-webgl2-browser-check.mjs` (not gated) open the four examples in headless Chromium (software WebGPU and WebGL2): drawn, both fields captured, links reopened with equal state hashes, the two renderers agreeing (thumbnail correlation 0.994 to 0.998).
- **Not done:** one slice of a flow is drawn, not the volume, and no streamlines; a tank's surface is drawn as particles, not a mesh; the free surface still has no bodies; fluids are not in the Studio; the grids stay small (1,440 to 4,320 cells) because the solver is one thread on the CPU.

## Unreleased — 2026-11-12 — Volumetric fluid

- **Solver (`src/engine/fluid.ts`, kit subpath `box3d-webgpu-kit/fluid`, `docs/FLUID.md`):** the incompressible Navier–Stokes equations in 3D (or 2D with one periodic cell) on a staggered grid, SI units, float64, deterministic, no dependencies. Incremental pressure-correction projection, the Poisson equation solved by conjugate gradients with an MIC(0) preconditioner to max |div u| h ≤ 1e-10 of the largest velocity; second-order central advection in flux form with Adams–Bashforth 2 (or first-order upwind); viscosity explicit, Crank–Nicolson or backward Euler. Sides: no-slip (sliding lids), free-slip, inflow, outflow (p = 0), periodic.
- **Obstacles:** spheres, boxes, capsules and cylinders, fixed or moving, immersed in the grid: inside faces take the rigid velocity, the faces next to the fluid the value extrapolated linearly in the distance so the surface moves rigidly. The force on an obstacle is the momentum the constraint takes from the fluid, less the change of the fluid inside it, less buoyancy; a control-surface integral of momentum flux, pressure and viscous stress agrees with it to 9e-5 on the Stokes case.
- **Coupling (`FluidCoupling`):** rigid bodies of the world are moving obstacles; the fluid takes a whole number of its own steps per rigid step and hands each dynamic body the mean force and torque (components too small for a float32 handed over as zero). Explicit: stable with the rigid step below the body's response time; measured down to a density ratio of 1.1.
- **Stepping loop (`fluidSubsystem`):** couple stage, order 180 (a bare `Fluid` in the post stage), with the viscous and Courant checks at registration, the Courant number every step, an energy entry (kinetic energy; work of bodies, boundaries and body forces; viscous dissipation) and `cfl-exceeded`, `unconverged` and `unstable-step` events.
- **Free surface (`FreeSurfaceFluid`):** inviscid liquid carried by APIC particles in a closed tank, the projection over the occupied cells with a ghost-fluid p = 0 on the surface located from the particles.
- **Measured (`packages/box3d-kit/test/v18-fluid.test.mjs`, 14 tests in the kit gate, 31 s; 31 rows in `docs/VALIDATION.md`):** divergence after projection 6e-11; Taylor–Green decay rate −0.28% at 32 cells, velocity error of order 2.19; plane Poiseuille error exactly the discrete (h/H)²; Couette to 4e-9; a square duct's flow rate +1.5% at 16² against the series; an inflow/outflow channel's pressure gradient +1.0% and mass to 6e-11; the lid-driven cavity within 0.22% (u) and 0.82% (v) of the lid speed of Ghia, Ghia & Shin (1982) at Re 100 on 32², 1.3% and 1.5% at Re 400 on 48² (the tables from transcriptions on the web that agree with each other, the paper itself not opened); water at rest to 8e-20 m/s with the pressure head to 1e-12; Stokes drag on a sphere in a periodic cube −7.5% (2.4 cells per radius) and −3.3% (3.6) against Hasimoto's array correction; a rigid-world sphere settling 6% faster than that drag predicts; momentum exchanged with a thrown rigid sphere to 9e-16 in float64 and 2.8e-7 through the float32 world; repeat runs bit-identical, also through the Simulation; a dam break within 7.4% of Martin & Moyce (1952, read from the scanned paper) once both are normalised to T = 1.19 at Z = 1.44 as in the paper; the first sloshing mode within 0.48% of ω² = g k tanh(kH).
- **Cost:** 0.3 to 0.9 million cell-steps per second on one thread of this sandbox's 2.1 GHz Xeon (16³ in 5 ms, 32³ in 53 ms, 48³ in 332 ms), about 10,000 cells per 60 Hz frame.
- **Not done:** turbulence models, cut-cell obstacles, a free surface with viscosity, surface tension or bodies, fluid in the scene format, the Lab or the Studio, a GPU or threaded version. The coupled energy ledger does not close; the pressure inside an obstacle creeps.

## Unreleased — 2026-11-12 — WebGL2 fallback for the Physics Lab

- **Renderer (`src/webgl/lab-renderer.ts`, `src/webgl/lab-shaders.ts`):** a WebGL2 renderer for `lab.html` that takes the same streams as the WebGPU renderer and draws them with the same passes: a shadow map from the directional light (depth32float, 1 or 9 PCF taps, redrawn only when a caster, the light or the map changed), an HDR scene pass with 4× MSAA (sky, instanced boxes, spheres and capsules, hull, mesh, height-field and compound bodies from their own geometry, the coupled scenes' cloth, water, grain, wall and solid rows, rope segments, soft and effect instances, the packed, GPU-cloth and GPU-water surfaces, translucent instances, overlay lines), and the same post pass (bloom, exposure, ACES, vignette, dither). The editor's selection tint and line overlays are drawn as on WebGPU.
- **Selection (`src/webgl/renderer-selection.ts`, `src/main.ts`):** WebGPU when `navigator.gpu` gives an adapter and device and the renderer starts; otherwise WebGL2. `?renderer=webgl2` forces WebGL2; `?renderer=webgpu` keeps the old WebGPU-only behaviour. A lost WebGPU device switches to WebGL2 on a fresh canvas without reloading: scene, clock, camera and recorded results are kept. A lost WebGL2 context gets a new WebGL2 renderer. The status bar shows **Renderer**; `box3dLab.rendererInfo()` and `box3dLab.simulateGraphicsLoss()` are new.
- **Shared code:** line packing moved from `src/webgpu/renderer.ts` to `src/webgl/lab-streams.ts` (same function, now used by both renderers), with CPU versions of the rope compute pass and of the cloth and water surface reconstruction. The WebGPU path's output is unchanged; no scene, hash or example changed.
- **Differs on WebGL2:** no material textures (atlas materials use the mean colour of their tile, so floors are flat where WebGPU shows texture), isotropic metal and sheet highlights, a larger shadow bias (the WebGPU bias showed acne on flat floors without textures), cloth strain from fewer neighbours, no GPU timing, visibility lists or instance partition, a preserved drawing buffer; without `EXT_color_buffer_float`, RGBA8 targets with tone mapping in each fragment and no bloom.
- **Checked:** `tests/physics/lab-webgl-streams.test.mjs` and `tests/physics/lab-renderer-selection.test.mjs` (in `npm run test:assets`, 13 tests): line packing, rope expansion, packed, cloth and water surfaces, the selection order and loss rules, and that no module of the stepping path imports a renderer. `scripts/lab-webgl2-browser-check.mjs` (not gated) opens all 15 examples on both renderers in headless Chromium on SwiftShader: the same state hash at the same tick on both, the same shape plan, both canvases drawn, captures agreeing (thumbnail correlation 0.994 to 1.000, mean luminance difference 0.0001 to 0.0103); the editor with a selected body; four recipe labs with water, cloth, a cable and a sheet; startup with and without `navigator.gpu`; a WebGPU device destroyed mid-run switching to WebGL2 with the tick, camera and state kept and the run ending on the hash of a run that never lost its device; a WebGL2 context loss; no console errors.
- **Measured (software only):** on SwiftShader the WebGL2 frame took 117 to 150 ms median (domino-run and buoy-and-crates at 672 × 463, Cinematic) against 16.7 ms for WebGPU; SwiftShader fills the shadow map, the MSAA target and the post pass on the CPU. Not measured on a GPU.
- **Not done:** no test on a real GPU, in Safari or Firefox, or on a phone, so there is still no browser support statement; the material atlas is not loaded on WebGL2.

## Unreleased — 2026-11-12 — Solids, fracture and heat in scenes and in the Lab

- **Scene format (`src/engine/scene-format.ts`):** optional `solids` and `heat` sections, added like `cloths` and `grains` (still version 1; every example hash, rigid and coupled, unchanged). A solid is a tetrahedral mesh (a box split into tetrahedra or the nodes and tetrahedra themselves) with E, ν, density, thermal expansion, model (linear, corotational, Neo-Hookean), integrator and sub-steps, supports by box, and optionally contact with rigid bodies and fixed planes (`SolidCoupling`), welds to bodies, loads from bodies, and cohesive fracture (σ_c, G_c, notches and pre-inserted interfaces by box). A heat grid conducts in a solid with a box mesh, with temperature, flux, convection and radiation boundaries, and drives the solid's thermal strain (`thermalSolidLink`). Validated with JSON-pointer paths, normalised, saved with the solids' displacements, velocities and interfaces and the grids' temperatures, carried by share links.
- **Engine:** `loadSimulationScene` builds them (`solids` and `heat` maps on the result; the kit's `loadScene` returns them too). New `reactionLoadLink` (`src/engine/simulation.ts`): the force that holds a body up, measured from its motion, as a traction on a solid, one-way. New `FractureBody.crackState()` and `restoreCracks()` (`src/engine/solid-fracture.ts`) carry the interfaces of a save; a cracked solid reopens with the same nodes, interfaces, crack area and node positions bit for bit (its nodes may be numbered in another order; the save writes them in the order the load gives).
- **Lab:** solids are drawn with eight mesh rows each (no new render pass): boundary faces at the current node positions, rebuilt every step, plus both sides of every interface of a fracture body, so an opened crack shows as two surfaces. Colour bands of the field the panel picks: von Mises stress, temperature or damage; the displacements can be drawn ×10, ×100 or ×1000 (`box3dLab.setSolidView`). The readout lists the solids' energy entries and their events (contact begin and end, cracks initiated and opened). Specimen-sized scenes are framed by their size.
- **Examples:** `lab.html?example=rubber-pad` (a box dropped on a rubber pad welded to a plate), `notched-beam` (a 200 kg drop hammer on a guide cracks a notched concrete beam through a platen), `quenched-plate` (thermal shock cracks an alumina plate, as `quenchedPlate()` at 6 mm cells), `heated-bar` (a bar between a hot and a cold block). Step cost measured once here: heated bar 0.8 ms against 16.7 ms; notched beam 1.5 ms mean against 4.17 ms with 40 ms steps at the impact; quenched plate 2 ms before cracking and 20 to 31 ms after, against 16.7 ms (about 0.6 times real time); rubber pad 2 ms at rest but about 80 ms per step for the 0.4 s of the landing (about 0.05 times real time then).
- **Checked:** `tests/physics/lab-coupled-scenes.test.mjs` (in `npm run test:assets`, 24 tests, about 50 s): bit-identical repeat runs of the four new examples through the Lab's code path; validation paths of the new sections; the build (subsystems, welds, notches and interfaces, the heat link); a save at step N reopened from its share link with the same scene hash, displacements, velocities, nodes, interfaces and temperatures, and two reopenings running the same; the beam carrying the hammer's weight to 10⁻³ at rest and staying on its supports; contact and crack events; colour bands, crack faces and empty bands drawn with no size. `scripts/coupled-scenes-browser-check.mjs` (not gated) now also opens the four solid examples, captures each colour field, and reopens their share links twice with equal state hashes.
- **Not done:** a fracture body has no contact with rigid bodies (it is loaded one-way through a platen); the crack-band model has no scene form; contact state, fracture energy counters and heat clocks are not saved, so a resumed run drifts slightly as for the other sections; the editor does not edit coupled scenes; seen in software rendering only.

## Unreleased — 2026-11-12 — A material library with sources

- **`src/engine/materials.ts`, published as `box3d-webgpu-kit/materials` ([`docs/MATERIALS.md`](docs/MATERIALS.md)):** 21 materials (structural steel S355 and S235, stainless 304, aluminium 6061-T6, copper C11000, grey cast iron EN-GJL-250, soda-lime glass, concrete C30/37, Barre granite, northern red oak and loblolly pine along the grain, PMMA, ABS, nylon 66, PTFE, natural rubber, ice, water and air at 20 °C, glass beads, quartz sand) and 31 contact-pair entries (static and kinetic friction, dry and lubricated or wet, restitution with the impact speed of the measurement). 208 values, each in SI with its conditions, the figure exactly as read, the conversion, a range where sources disagree, and one of 32 sources opened on 2026-11-12 (standards and design aids, NIST, NBS, USDA Forest Products Laboratory, LLNL, NASA, manufacturers' datasheets, open-access papers, an open textbook; The Engineering ToolBox and Webmineral only as a marked last resort, 24 values). 202 are sourced; 6 contact coefficients the scene editor needs are marked unverified with a reason and refused unless `allowUnverified` is set. Versioned (`MATERIAL_LIBRARY_VERSION` 1.0.0).
- **Helpers:** `solidMaterial` (solid.ts and fracture), `fractureLaw` (G_c from K_IC by Irwin's relation, plane strain by default, plane stress on request), `heatMaterial`, `thermalDiffusivity`, `grainMaterial` (granular), `contactPair` and `rigidMaterial` (static coefficient by default, since the rigid world has one coefficient for sticking and sliding), `materialAudit`, `shearConsistency`.
- **Consistency:** G against E / (2 (1 + nu)) agrees to 0.4% or better for steel, 6061-T6, copper and granite and to 2.5% for glass (two-digit moduli); stainless 304's datasheet G (13% high) and PMMA's dynamic G (41% high) disagree and are flagged in their entries.
- **Scene editor:** the seven named materials now take their density, friction and restitution from the library (steel restitution 0.6 → 0.56; aluminium friction 0.5 → 0.61; wood 600 → 571.2 kg/m³ and friction 0.4 → 0.5; rubber 1100 → 921.7 kg/m³ and friction 0.9 → 1.0; ice 917 → 918.9 kg/m³ and friction 0.05 → 0.1; glass friction 0.5 → 0.95 and restitution 0.65 → 0.926). The UI is unchanged except that the hint names the library entry and the values without a source. The five pinned example scenes keep their literal values and hashes; the editor's own tests pin the new numbers ([`docs/SCENE_EDITOR.md`](docs/SCENE_EDITOR.md)).
- **Validation:** a `materials` domain, 15 cases (455 in 18 domains): four consistency rows and a check that no disagreement is unflagged; an aluminium bar in tension (1e-9), a steel cantilever against Timoshenko (3.7% stiff at 8 cells, the element's bending error), a heated stainless bar (1e-9), a centre-cracked glass plate at K_IC / (Y sqrt(pi a)) (3.5% low, as the fracture domain's plate), a copper bar's cooling time constant (4e-4), Hertz durations of rubber spheres and glass beads (2e-5), glass-bead restitution (1e-5), and a steel block and ball in the rigid world (sliding distance, rebound 2% low at 240 Hz). The Griffith plate of `validation/domains/fracture.mjs` takes a material; its own rows are unchanged.
- **Tests:** `tests/engine/materials.test.mjs` (12 tests, in `npm run test:engine`) and `packages/box3d-kit/test/v18-materials.test.mjs` (3 tests, in the kit gate).
- **Not done:** nothing is measured by the project, and the cases check that values reach the solvers, not that they are right. Fracture toughness of the steels, copper, concrete and the polymers, rubber's conductivity and most restitution pairs were not found in an opened source. Temperature dependence only where a source gives a formula (evaluated at 20 °C). The Studio's material programs and presets are untouched and do not use the library.

## Unreleased — 2026-11-11 — The Lab runs coupled scenes

- **Lab (`src/lab/scene-host.ts`, `src/lab/coupled-scene.ts`, `src/main.ts`):** every scene is built with `loadSimulationScene`; a scene with water, cables, frames, a cloth or grains is stepped through its `Simulation` (couple stage, rigid step, post stage, events) on every fixed step, with Play, Pause, Step and Reset as for rigid scenes. Rigid scenes step exactly as before and keep their hashes.
- **Drawing, no new render pass:** a basin as a translucent height-field mesh with a wire grid on the surface (line stream); cables and frame elements as rope segments; a cloth as a two-sided mesh rebuilt every step; grains as sphere instances; grain walls (boxes, spheres, capsules, cylinders, rings, cones) as translucent rows. Plane walls are not drawn.
- **Readout:** a panel with the clock, the measured cost of a step, the step order, the energy ledger by subsystem (total and balance) and the latest events, world contacts included, with scene ids. `box3dLab.sceneState()` adds `simulationTick`, `stateHash` (every body transform and every solver field) and the energy entries; `box3dLab.coupledReadout()` and `box3dLab.setPaused()` are new.
- **Scene format:** optional `cloths` and `grains` sections (still version 1, as `water`, `cables` and `frames` were added; scenes without them keep their canonical text and hash), validated with JSON-pointer paths, normalised, hashed, saved with the solvers' fields and carried by share links. Heat, solids and fracture have no section yet.
- **Examples:** `lab.html?example=buoy-and-crates` (moored buoy and three floating crates), `trampoline` (a ball and a box on an 81-node cloth), `hopper-seesaw` (150 beads tip a see-saw), `suspended-platform` (four cables, four falling boxes); the moored buoy and the cable-stayed deck open in the Lab too. Step cost measured once here: 0.1 to 1.9 ms against a 4.17 ms budget, except the trampoline at 4.8 to 8.8 ms against 8.33 ms (about real time in node, 0.9 times real time in headless Chromium).
- **Checked:** `tests/physics/lab-coupled-scenes.test.mjs` (in `npm run test:assets`): bit-identical repeat runs of every coupled example through the Lab's code path, save → share link → fresh load starting from the same fields bit for bit and running the same twice, validation paths for the new sections, the drawn rows. `scripts/coupled-scenes-browser-check.mjs` (not gated) opens each example in headless Chromium with software WebGPU, reads the canvas back, and reopens the share link in two fresh contexts with equal scene and state hashes.
- **Not done:** heat, solids and fracture in scenes and in the Lab; editing coupled scenes in the editor; the Studio does not read scenes.

## Unreleased — 2026-11-11 — Fracture: interfaces are inserted earlier at crack fronts

- **The problem (`docs/SOLID_FRACTURE.md`):** on-demand insertion reads the mean stress of the two elements of a face and inserted an interface at the strength (`insertionThreshold`, default 1 in `src/engine/solid-fracture.ts`). At a crack tip that reading is too low, so no interface appeared ahead of the tip: the centre-cracked plate held 1.59 times its Griffith stress on cells of `l_ch / 2` and more than 1.8 times on cells of `l_ch`.
- **Measured against the threshold, on both gate meshes** (failure stress over LEFM; the pre-inserted path gives 0.965 and 1.115): one threshold for every face gives 1.165 / 1.605 at 0.7, 1.005 / 1.375 at 0.6, 0.975 / 1.145 at 0.5, 0.965 / 1.125 at 0.4, 0.965 / 1.115 at 0.3. So 0.4 is right within the 1 % load step. But one low threshold puts an interface on every face of any region above it: a bar of uniform strength at 0.9 of its strength then carries 68 % of its elastic stress on 8 cells and 50 % on 16 cells (nodes 81 → 144 and 425 → 800), the bar test's sampled peak reads 2.1 % low, and the thermal-shock test loses its first-crack time.
- **The change:** `insertionThreshold` stays 1. A new `tipInsertionThreshold` (default 0.4) applies to faces that touch a crack front: a face sharing a node with a face that is cut, open or softening. The plate then fails at 0.965 and 1.125 (0 and +0.9 % against the pre-inserted path) with 1266 and 847 nodes against 1248 and 836, 1.6 s against under 1 s for the fine mesh's increments. The bar under the same load has no interface and the elastic stress to 4·10⁻¹⁵.
- **Unchanged, bit for bit in the printed digits:** the bar's peak, softening curve and `G_c A`; mesh objectivity; the quasi-static and dynamic energy balances; the notched beam; momentum in free flight; the thermal shock.
- **Changed:** the strip with a crack inclined 30° to the mesh: area over the plane 1.025, 1.212, 1.299 (was 1.241, 1.241, 1.478), energy 1.375, 1.486, 1.537 (was 1.524, 1.316, 1.686), peak 1.022, 1.146, 1.072 (was 1.123, 1.435, 1.109). The statement that the excess is the same at every resolution no longer holds for the area; the mesh still decides the path.
- **Tests and rows:** `tests/engine/solid-fracture.test.mjs` asserts the on-demand plate against the pre-inserted one on both meshes, that it stays intact to 1.3 with the rule off, and the new inclined-crack numbers (12 tests, 21 s, was 15 s); `FRACTURE_SLOW=1` reruns the threshold study. Four rows added to the fracture domain, one note changed (376 cases).
- **Not covered:** the value 0.4 was set on one geometry, mode I, crack on a mesh plane, cells up to `l_ch`. A notch that is not a cut face has no crack front and is read at `insertionThreshold`.

## Unreleased — 2026-11-11 — The water's force in the cable and frame interface solve

- **What changed:** a body that floats and hangs on a cable or a frame was handled by two couplings that did not know of each other: the structure coupling's interface solve used the body's free motion under gravity only, so the cable's end was placed where the body would fall to without buoyancy, `B dt² / m` lower. Now `StructureCoupling.addLoadProvider` takes other solvers' forces into that free motion, `WaterCoupling.predictLoad` reports the buoyancy and drag its next step applies (the same evaluation, no side effects), and `linkWaterToStructure` (`src/engine/simulation.ts`) joins them. `loadSimulationScene` makes the link for every basin of a scene with cables or frames. The step order is unchanged.
- **Measured (`packages/box3d-kit/test/v17-moored.test.mjs`, 4 tests in the kit gate, about 1 s):** a spar (0.2 × 0.2 × 2 m, 32 kg) on a taut vertical tether of 1000 N/m. At rest against the closed form (buoyancy − weight = tension, with the tether stretch and the level rise): draught error 1·10⁻⁷ m and tension error −4·10⁻⁷ at 240, 60 and 30 Hz; before, −0.50, −3.6 and −13.6 mm and +0.09 %, −0.46 %, −2.2 %. Set at its equilibrium it does not move at any of those steps; before, it rang by 0.49 mm (240 Hz) and 12.3 mm (30 Hz) and settled that far off. Heave: 1.0449 Hz against `√((ρ g A + E A / L₀) / (m + m_n)) / 2π` = 1.0495 Hz (−0.43 % at 240 Hz, −1.0 % at 60 Hz; the tether alone would give 0.889 Hz). No added mass in the coupling or in the reference.
- **Example buoy (`v14-simulation.test.mjs`):** segment tension +0.0009 N from `ρ g V_sub − (m + m_n) g` (was +0.729 N), draught −0.45 µm from the closed form (was −0.41 mm), floor load − anchor pull −0.001 N (was −0.73 N); the tolerances of those checks are now 1e-5, 5 µm and 0.02 N.
- **Validation registry:** the five buoy rows carry the new tolerances; five spar rows added (372 cases).
- **Remains:** the water's force is constant over the step in the interface solve; its hydrostatic stiffness is not in the interface matrix (no instability found at 30 Hz on the spar; not checked where `ρ g A dt² / m` is large). A floating body on a frame gets the frame's half kick between the prediction and the water's own read; no closed-form check there. Hand-driven set-ups must call `linkWaterToStructure` themselves.
- **Docs:** `SIMULATION.md` ("Water and structure together"), `STRUCTURE_COUPLING.md`, `WATER_COUPLING.md`, the roadmap.

## Unreleased — 2026-11-11 — Deformable solids in contact with rigid bodies

- **Module (`src/engine/solid-contact.ts`, published as `box3d-webgpu-kit/solid-contact`):** `SolidContact` steps a tetrahedral `SolidBody` by backward Euler together with rigid bodies. Surface nodes collide with boxes, spheres, capsules and planes through one-sided springs as stiff as a hundred layers of elements over the area each node turns to the body; Coulomb friction is a stick spring capped at μ N; `weld` fixes nodes to a body. Newton's method with a line search and preconditioned conjugate gradients, to a force tolerance.
- **Two-way coupling (`SolidCoupling`):** each dynamic body is six unknowns of the solid's solve with the inertia the rigid step gives it, as the cloth does; the forces of the converged springs go to the world. A 4 g body on a steel block (contact stiffness × h² / mass = 7·10⁸) never moves faster than 6·10⁻⁷ m/s; an 80 kg body on a 2 kg soft pad comes to rest at 60 Hz; naive staggering throws the light body off in one step. Forces too small for a float32 are handed over as zero. Where the world put a body where the solve expected it, to float32 rounding, the float64 position is kept.
- **Stepping loop:** `solidContactSubsystem` (couple stage, order 170) with an energy entry (solid energy plus spring energy, the bodies' work as `exchanged`) and `contact-begin`, `contact-end` and `unconverged` events. Bit-identical to driving it by hand.
- **`SolidBody.kernel()`** exposes the element mechanics to that solver. `SolidBody`'s own `step` and `solveStatic` are unchanged (its 22 tests pass unchanged).
- **Validation (`packages/box3d-kit/test/v17-solid-contact.test.mjs`, 12 tests in the kit gate, about 21 s; 25 cases in a new `solid-contact` domain):** a free cube on a ground plane and a capsule on a pad are carried by exactly their weight (the capsule rolls half a node spacing onto two rows of nodes, which is the node-only contact showing); a block on a pad to 1·10⁻¹¹ in uniaxial stress (`m g L / (E A)`) and in uniaxial strain (`m g L / ((λ + 2μ) A)`); the same through the loop to 7·10⁻⁸; Hertz +16.3 %, +9.4 %, +6.8 % at 2.5, 3.75 and 5 elements per contact radius against Hertz with the bonded-layer factor (+21.6 %, +14.4 %, +11.7 % against plain Hertz), exponent 1.56; friction on an incline with μ = 0.5: no motion at tan θ = 0.488, sliding at −0.1797 m/s² against −0.1790 at tan θ = 0.521; a block on a column at 3.2231 Hz against 3.2275 Hz for the bar with a tip mass (a massless spring would give 3.5588 Hz); a welded hanging weight to 4·10⁻⁶; momentum in an impact to 8·10⁻¹³ with float64 bodies and 1.2·10⁻⁷ through the float32 world.
- **Limits, measured or stated:** Hertz contact is too stiff and converges slowly; only the solid's nodes are tested (a body corner between nodes is not seen); one contact plane per node, body and step with nothing traced along the path; no hulls, meshes or height fields; no contact between two solids; backward Euler only (36 % of the kinetic energy is left after the impact case); a welded face is clamped sideways (1.4 % stiffer at ν = 0.3). Not in the scene format, the Lab or the Studio.
- **Docs:** `docs/SOLID_CONTACT.md`; `SOLID_MECHANICS.md`, `SIMULATION.md`, the roadmap and the kit README updated.

## Unreleased — 2026-11-11 — Granular media by the discrete element method

- **Solver (`src/engine/granular.ts`, kit subpath `box3d-webgpu-kit/granular`, `docs/GRANULAR.md`):** spherical grains of any radii in SI units, float64, deterministic, no dependencies. Normal contact by Hertz's law or a linear spring, with a dashpot whose coefficient is solved numerically so that a two-grain impact has the restitution asked for (the contact never pulls, so the textbook coefficients do not apply); a tangential spring with history under Coulomb's limit (Mindlin's no-slip stiffness for the Hertz law); an elastic-plastic rolling-resistance spring. Velocity Verlet. The step is checked against the Rayleigh time (Hertz) or the contact duration (linear) of the smallest grain: above 0.4 or 0.2 of it a grain is refused with `UNSTABLE_TIME_STEP`, or accepted with a warning under `allowUnstable`.
- **Walls:** planes, boxes, spheres, capsules, and thin shells of revolution (cylinder, annular plate with an orifice, conical hopper), static, kinematic or dynamic, each with the force, torque, impulse and normal load the grains put on it. Grains leaving a bounding box are removed and counted.
- **Neighbour search:** a uniform cell grid and neighbour lists with a skin, visited in a fixed order; repeat runs are bit-identical.
- **Coupling (`GranularCoupling`):** bodies of the rigid world are walls of the solver; the grains take a whole number of their own steps inside each rigid step with the dynamic bodies moving alongside, and the world receives the mean force and torque. Components below the smallest float32 are handed over as zero, as in the structure coupling.
- **Stepping loop (`granularSubsystem`):** couple stage, order 160, with the time-step check at registration, an energy entry (kinetic, gravitational, elastic, and the energy dissipated by damping and by friction) and events for contacts, removed grains, deep overlaps and an unstable step.
- **Measured (`packages/box3d-kit/test/v17-granular.test.mjs`, 18 tests in the kit gate, 46 s; 35 rows in `docs/VALIDATION.md`):** Hertz contact duration −9e-6 at 2% of the Rayleigh time, second order (1.98); restitution within 7e-4 (Hertz) and 1.3e-3 (linear) of the value set; sliding rebound `ψ₂ = ψ₁ − (7/2) μ (1 + e)` within 2.2e-3 and the linear-spring sticking rebound within 2.5e-3; a grain sliding at `g (sin θ − μ cos θ)` to 1e-12 and rolling at `(5/7) g sin θ` to 2e-4; the energy ledger of a poured bed closing to 0.12% of the energy dissipated at 10% of the Rayleigh time, second order; a column's floor force equal to its weight to 1.4e-4; a block at rest on a bed carried to 7e-7 of its weight; momentum exchanged with a rigid sphere to 1.7e-7 (float32) and to 6e-16 on the grains' side; a box of beads on a spring scale to 4e-9.
- **Silo laws, in form only:** the floor load of a six-bead-wide silo saturates at 13% of the weight and follows Janssen's curve with one fitted number to 6% rms; the stress ratio from the fit (1.18, with the measured mobilised wall friction of 0.26) agrees with the one read from the wall pressure (1.05) but is above the usual 0.4 to 0.6. Discharge through four orifices follows `(D − k d)^(5/2)` to 9% with C = 0.45 and k = 1.1 (C = 0.49, k = 1.44 to 2% in a hand-run case of 12,000 beads), C below the usual 0.55 to 0.65; the rate does not fall with the fill level. The literature ranges are written from memory. The angle of repose rises from 22° to 35° with friction and rolling resistance (a trend check).
- **Cost:** about 2 million grain-steps per second on one thread; with the soft 10 mm beads of the validation that is 100 to 250 beads in real time.
- **Not done:** non-spherical grains, cohesion, twisting resistance, more than one grain material, checkpoints of the contact history, grains in the scene format, the Lab or the Studio, a GPU or threaded version. No case is compared with an experiment.

## Unreleased — 2026-11-11 — Compound bodies and explicit mass data

- **Bridge (`wasm/box3d_web.c`, both WASM builds rebuilt):** four optional exports. `b3w_world_create_compound_body` takes a 128-byte body descriptor, 1 to 64 80-byte shape descriptors (box, sphere, capsule or hull, each with a local position and rotation, density, friction and restitution) and the hull points; hulls are built before the body, so a refused shape leaves nothing behind. `b3w_world_set_body_mass_data`, `b3w_world_get_body_mass_data` and `b3w_world_reset_body_mass_data` wrap Box3D's `b3Body_SetMassData`. The world API version is still 1; the recipe scenes, their streams and their replay hashes are unchanged.
- **Three things Box3D's setter leaves undone are done in the bridge:** it does not refresh the world-space inverse inertia until the end of the next step, it forgets the values when the body type changes, and it does not keep the velocity of the body origin when the centre of mass moves under a spinning body. A body with locked rotation is given no inertia. `b3w_world_set_body_filter` now reaches 64 shapes of a body, not 8.
- **Adapter and kit:** `NativeWorldBackend.createBody` takes `{kind: 'compound', shapes}` and `massData`; `setBodyMassData`, `resetBodyMassData`, `bodyMassData`. In the kit: `createBody`, `setMassData`, `resetMassData`, `getMassData`, recorded and replayed bit for bit, and on the worker-hosted world.
- **Scene format version 2 (`src/engine/scene-format.ts`, `docs/SCENE_FORMAT.md`):** the `compound` shape kind and the body key `massData`. Version 1 files load as before, and a scene that uses neither feature is still written as version 1 with the canonical text and hash it had (the hashes of the five example scenes from before are pinned in the test). Share links carry both.
- **Lab:** a compound is drawn from one triangle list that holds every child at its local pose (`src/webgpu/body-geometry.ts`, shape kind 6 in the plan). The editor opens version 2 scenes and can move, turn, duplicate and delete such bodies; it cannot create or edit a compound or mass data. Seen in headless Chromium with software WebGPU: a hammer, a dumbbell, a table on capsule legs, an L with a turned hull, and the six-joint example arm with its two-box tool.
- **Robot import (`src/engine/robot-import.ts`, `docs/ROBOT_IMPORT.md`):** a link with several collision shapes is one compound body (it was one welded body per shape), and a link whose shapes do not have the file's `<inertial>` is given the file's mass, centre of mass and inertia tensor (they were only compared and reported). Options `links: 'welded'` and `inertia: 'shapes'` give the previous scenes, character for character on the seven example robots.
- **Measured (`packages/box3d-kit/test/v17-compound.test.mjs`, 12 tests in the kit gate; 26 new registry cases):** dumbbell mass and parallel-axis inertia 2.8e-8 and 8.3e-8; spin-up under a torque 2.0e-6; physical-pendulum period 3.0e-7; centre of mass and product of inertia of an L of two boxes 4.0e-8 m and 1.3e-7; the tilt at which the L tips 15.634° against 15.642° from its centre of mass; the L at rest moves 0.53 mm while it settles and then sleeps; `F = m a` and `τ = I α` with stated values 4.5e-6; a full stated tensor against Euler's equations 2.2e-4 after 2 s; a pendulum from a stated centre of mass 1.7e-6. Robot import: the example arm's principal moments in the solver within 4.7e-8 of the file's (42% off on the worst link from the shapes alone) and its centres of mass within 3.5e-10 m; a rod whose file states 1.3 × its shape's inertia swings with the file's period to 8.6e-7.
- **Existing numbers that moved:** with the file's inertia the held example arm settles 17.0 mm below its pose (17.7 mm before) and moves 23.0 mm at most (24.0); the swinging chain's largest joint gap is 3.65 mm (3.75). The previous numbers are reproduced with the two options.
- **Not done:** a compound has one colour, one filter and one set of flags, and events name the body, not the shape. Meshes and height fields cannot be in a compound. Nothing checks that a stated tensor suits the collision shape. The kit's three.js and Babylon adapters draw a compound row as a unit box, as they do a hull. The Lab's geometry import and `createBodiesFromMesh` still weld decomposed pieces instead of making one compound. Not seen on a real GPU.

## Unreleased — 2026-11-11 — A scene editor in the Lab

- **Editor (`lab.html?edit=1`, `src/lab/scene-editor.ts`, `src/lab/scene-editor-model.ts`):** the Scenes panel has **New scene** and **Edit**. Bodies are added from ten presets (box, sphere, capsule; wedge, cylinder and cone hulls; a static mesh ramp; flat, sloped and hilly height-field terrain from a seeded function library), selected by clicking in the 3D view or in an outline, and edited in an inspector with SI units: name, type, position, rotation in degrees (a quaternion in the file), sizes, material, initial velocity, flags, collision filter. Joints of the six types are added between two selected bodies or a body and the world, with frames computed from an anchor point and an axis that can be picked in the view. World settings have gravity presets (Earth, Moon, Mars, zero) and warnings when a joint stiffness or a body size does not suit the step.
- **Always valid:** every edit is a command on a document; the scene format's `validateScene` and a scratch build in the engine check the result before it is applied, and a refusal shows the validator's message and changes nothing. 100 steps of undo and redo restore the exact canonical JSON.
- **Moving bodies:** no gizmo. A body is dragged on the horizontal plane through the grabbed point (Shift: vertically), nudged with the arrow keys, or typed; grid snapping, and optional surface snapping by a downward ray cast so a body rests on what is below it.
- **Selection** is shown by tinting the body's instance colour and a line frame; joints and the ruler are drawn through the existing line path. No render pass was added (`WasmPhysicsBackend.markGeneralColorsEdited`).
- **Materials:** steel, aluminium, concrete, wood, rubber, ice and glass with typical handbook density, friction and restitution, the ranges and sources in `docs/SCENE_EDITOR.md`. They are labelled typical; restitution values were not checked against a specific table.
- **Run and measure:** Play, Pause, Step and Reset (Reset returns to the edited initial state; the inspector shows live values, read-only, while the simulation has moved on); a plot of one body's position, velocity or energy with CSV export; a ruler between two picked points or two bodies.
- **Persistence:** autosave to `localStorage` with a recovery prompt; Copy share link and Download save the document; the address shows a share link only when one is asked for.
- **Keyboard:** Delete, Ctrl/Cmd+Z, Shift+Ctrl/Cmd+Z, Ctrl/Cmd+D, arrow and Page nudges, Escape; every control is in tab order with a label. The Lab's single-key shortcuts are off while the editor is open.
- **Tests:** `tests/physics/scene-editor.test.mjs` (18 tests in the pull-request gate: every command, undo and redo to byte-identical canonical JSON, rename and delete reaching the joints, 44 refused commands, snapping, the materials table, terrain determinism, joint frames, the picking ray, step warnings, energy and the CSV format, autosave records, builds in the native world). `scripts/scene-editor-browser-check.mjs` drives the built page in headless Chromium (not in a gate): a scene built by UI actions, opened from its share link in a fresh context, has the same scene hash and the same replay hash after 180 steps; a keyboard-only pass; a 390 px phone viewport.
- **Not done:** a translate or rotate gizmo, camera panning, applied forces as loads (the format has none), compound shapes, editing imported geometry, coupled scenes, a vertical drag by touch. Seen in software rendering only.

## Unreleased — 2026-11-11 — Fracture on the validated solid solver

- **Module (`src/engine/solid-fracture.ts`, published as `box3d-webgpu-kit/fracture`):** `FractureBody`, a small-strain tetrahedral solid (the linear model of `solid.ts`) that cracks. Cohesive interfaces on element faces with a bilinear traction-separation law (strength `sigma_c`, fracture energy `G_c`, critical opening `2 G_c / sigma_c`), mixed mode, irreversible damage and a contact penalty; nodes are duplicated where a face opens, deterministically and with the mass unchanged. A Rankine crack band with fracture-energy regularisation as the simple alternative. Statics by increments, implicit and explicit dynamics, and an energy ledger.
- **Fragments:** connected pieces with mass, centre of mass, momentum and inertia; a one-way hand-off of a piece to the rigid world as a hull body with its mass and velocity.
- **Stepping loop:** `fractureSubsystem` (post stage, crack events with time, face, mode and energy). `thermalSolidLink` accepts the fracturing solid, so the heat solver's temperature field can crack it; `quenchedPlate()` is the example.
- **Validation (`tests/engine/solid-fracture.test.mjs`, 12 tests in the pull-request gate as `npm run test:fracture`; 18 cases in a new `fracture` domain of the validation registry; 4 kit tests):** bar peak load, softening curve and fracture energy to 1e-9; unloading on the damaged secant; mesh objectivity of both models, and the unregularised crack band shown to scale with the cell size; energy balance in statics (1e-3) and dynamics (1.2e-4, second order); Griffith's stress for a centre-cracked plate, +11.5 % on cells of `l_ch` and −3.5 % on cells of `l_ch / 2`; work of fracture of a notched beam within 0.1 % of `G_c` times the area that can open; momentum through node splitting, free flight and hand-off; the first thermal-shock crack at the cooled face, 2.5 % later than the heat module's estimate; bit-identical repeat runs.
- **Limits, measured:** cracks follow element faces: a crack inclined 30° to the mesh is 24 % (five-tetrahedron cells) or 48 % (six-tetrahedron cells) too large at any resolution. On-demand insertion misses crack-tip stress on coarse meshes (a plate held 1.6 times its Griffith stress until interfaces were inserted earlier). Small strain, no plasticity, no friction, no contact between fragments. The Studio's concrete and glass studies still run the normalized lattice; `docs/MATERIAL_FRACTURE.md` lists what moving them takes.
- **Docs:** `docs/SOLID_FRACTURE.md`; kit README section; roadmap.

## Unreleased — 2026-11-11 — A cable-stayed bridge in SI units on the validated solvers

- **Model (`src/engine/si-bridge.ts`):** a 120 m cable-stayed bridge (spans 30 + 60 + 30 m, two towers, 16 stays) built from frame elements, compliant cables and one rigid body, stepped through `StructureCoupling`. Section properties are hand numbers for a steel box girder, steel box towers and six-strand stays. The stays are pretensioned by the zero-displacement method so that the deck is level under dead load (anchorages within 4·10⁻⁸ m). Options: span, tower height, number of stays, sections, vehicle mass and speed, a static lateral wind load, and the failure of a stay at a chosen time. Outputs per step: deck deflections, stay tensions, support reactions (forces and moments), deck bending moments, energy, and stay, deck and tower utilisation as linear-elastic indicators. `SiBridgeStatics` is an independent dense static solver of the same structure (pretension, influence lines, damaged re-solve, modes, Rayleigh).
- **Vehicle:** one rigid body pinned to the two deck nodes it stands between and moved by re-attachment. No wheel contact; the weight is shared by the lever rule (1.9 % of the peak deflection on 6 m elements).
- **Lab (`lab.html?si=bridge`, `src/lab/si-bridge-scene.ts`, `src/lab/si-bridge-panel.ts`):** the scene is listed under "SI scenes". Deck and tower elements are box instances on the deformed chords, the stays go through the existing rope stream, and the drawn deflection can be exaggerated up to 100 times. The panel shows midspan deflection, stay tension and utilisation, tower base moment, vehicle position, energy and the measured step cost, with controls for mass, speed, wind, stay failure, exaggeration, pause and reset, and a 30 s history plot. `createGeneralScene` takes `beforeStep` and `afterStep` so that a scene can step its own solvers around the rigid world.
- **Validation (`tests/physics/si-bridge.test.mjs`, 13 tests in the pull-request gate; 30 cases in `validation/domains/si-bridge.mjs`):** reactions equal to the weight to 8·10⁻⁹; a hand-solved propped span to 1.5·10⁻⁶ at every mesh, with the lever-rule error falling as h²; symmetry to 3·10⁻⁸; influence lines within 0.6 %; first vertical frequency 1.7973 Hz against 1.7999 Hz; dynamic amplification 1.016 at 20 m/s and 1.014 at 40 m/s; a stay failure against the damaged statics to 8·10⁻⁵ with energy never growing; bit-identical repeats. See `docs/SI_BRIDGE.md`.
- **Coupling (`src/engine/structure-coupling.ts`, kit `box3d-webgpu-kit/structure`):** `prime(attachment, force, moment?)` hands the coupling the force an attachment already carries, so a structure built loaded starts at rest. A frame's response to one attachment is formed for that attachment's rows only (bit-identical, 4.05 → 2.70 ms per bridge step). The file no longer uses TypeScript parameter properties, so Node can import it directly. The kit's API report is regenerated.
- **Cost:** 1.95 ms per 1/120 s step in Node on a shared 4-core machine: 4.3 times real time.
- **Not done:** the Studio's bridge study is unchanged; `docs/SI_BRIDGE.md` lists the steps to re-base it. No wheel–deck contact, buckling, yielding or cable sag. Seen in software rendering only.

## Unreleased — 2026-11-11 — Robot import: URDF and MJCF

- **Module (`src/engine/robot-import.ts`, published as `box3d-webgpu-kit/robot`):** a dependency-free XML parser (no DTD, no entity expansion, size, depth and node caps, errors with line and column), `parseURDF` and `parseMJCF` into one neutral robot description, `robotToScene` and `spawnRobot` into the rigid world, `robotKinematics`, `robotReport`, and seven example robots as generated text. Every ignored, approximated or unsupported element is listed in `warnings`.
- **Fidelity, stated:** each link's mass is matched through its density and the inertia that results is reported against the file's (the engine cannot take a tensor: 42% off on the worst link of the example arm). Joints are 60 Hz soft constraints in the engine: the 16.8 kg example arm settles 17.7 mm below its kinematic pose at the tool; a 12-link chain shows joint gaps of 1.5 mm at rest.
- **Validation:** `packages/box3d-kit/test/v15-robot.test.mjs` in the kit gate, and 28 cases in a new `robot` domain of the validation registry (forward kinematics to 1e-6, the same scene and trajectory from URDF and MJCF, compound-pendulum and cart-pole periods, limits, effort limits, joint springs and damping, a held arm, chain drift, a wheeled cart, round trips). `docs/VALIDATION.md` and `public/validation/validation.json` regenerated: 239 cases.
- **Docs:** `docs/ROBOT_IMPORT.md` (supported and unsupported elements per format, conventions, the mass and inertia policy with measured errors, limits); kit README section; roadmap.

## Unreleased — 2026-11-11 — The Lab opens scenes and draws every shape kind

- **Lab (`src/lab/`, `src/main.ts`):** `lab.html?example=<name>` opens an example scene and `lab.html?scene=<share link>` (or URL-encoded scene JSON) a shared one. The Scenes panel opens `.json` scene files and `.obj`, `.stl`, `.glb` and `.gltf` geometry by file dialog or drag and drop, copies a share link of the scene on screen, downloads it and resets it. Geometry becomes one body in a default SI scene: a dynamic hull or welded hull set when the mesh is closed and small enough, otherwise a static mesh, with a note that says which and why and how it was scaled. Invalid input is reported in the page with the validator's problem list and changes nothing. The examples and "Open file…" are listed in the laboratory catalog; the 800 recipes are unchanged.
- **One scene loader (`src/engine/scene-format.ts`, `scene-examples.ts`, `geometry.ts`):** the scene format and the geometry import moved here from `packages/box3d-kit/src`, so the Lab and the kit run the same code; the kit copies them like its other core files. `SceneBuilder` now works against a small `SceneHost` contract that the kit's `PhysicsWorld` and the Lab's `LabSceneHost` both meet. The kit's exports and tests are unchanged; `SceneHost` is new.
- **Renderer (`src/webgpu/renderer.ts`, `src/webgpu/body-geometry.ts`, `src/webgpu/instance-shapes.ts`):** convex hulls, static meshes and height fields are drawn from each body's own geometry in the shadow, opaque and transparent passes. Box-only and box, sphere and capsule streams draw as before; no box-only cost was measured. The opt-in partition and visibility lists fall back to direct draws for such frames.
- **Data path:** optional `shapeGeometry(row)` on `InstanceBufferSource`; `NativeWorldBackend.retainBodyShapes()` and `bodyShape(row)` (off by default); `createGeneralScene` takes the scene's own step.

## Unreleased — 2026-11-11 — Public validation page

- **Registry (`validation/`):** 211 cases in ten domains (rigid bodies and joints, rigid ↔ water, cable/frame ↔ rigid, geometry import, scene files, heat, deformable solids, frames, cables, closed-basin water). Each case names its closed-form reference, runs the real solver through its public API and returns the measured value, with the tolerance its test asserts and the test that asserts it.
- **Report (`node scripts/validation-report.mjs`, `npm run validation:report`):** writes `docs/VALIDATION.md`, `public/validation/validation.json` (schema `box3d-validation` version 1) and is drawn by the static page `public/validation/` (served at `<site>/validation/`; no inline code, no third-party requests). The files hold no date, machine or commit, and two runs on one build are byte-identical.
- **Gate:** `npm run validation:check` reruns every case and fails if one misses its tolerance or if the committed files differ from the run beyond the stated rounding; `npm run test:validation` tests the registry and the generator. Both run in the pull-request gate.
- **Kit tests:** the mesh fixture generators of `packages/box3d-kit/test/v10-geometry.test.mjs` moved to `test/fixtures/geometry-models.mjs` so the registry measures the same generated files; the test is otherwise unchanged.
- **Links:** the Lab's application bar and the Studio's introduction link to the page.

## Unreleased — 2026-11-11 — Lab renderer draws spheres and capsules

- **Renderer (`src/webgpu/renderer.ts`, `src/webgpu/instance-shapes.ts`):** sphere and capsule instance rows are drawn in the shadow, opaque and transparent passes. A capsule is an open cylinder plus two hemisphere caps, exact at any radius and length. Box-only streams keep their single cube draw. The opt-in material partition and GPU visibility lists fall back to direct draws for a frame that has round rows.
- **Data path:** optional `shapeVersion()` and `shapeKinds()` on `InstanceBufferSource`; `NativeWorldBackend` implements them; a backend without them has only boxes.
- **Lab:** the Mechanisms SI demo (`lab.html?si=mechanisms&seed=N`, or the last entry of the laboratory catalog) is built with `resetWorld`, `createBody` and `createJoint`. It is a separate entry, not one of the 800 recipes.

## Unreleased — 2026-11-11 — Open the engine: shapes, joints, events, SI worlds

- **Bridge (`wasm/box3d_web.c`):** new optional exports for empty worlds with chosen gravity, sphere, capsule, convex-hull, triangle-mesh and height-field shapes beside boxes, static / kinematic / dynamic bodies, pose and velocity access, forces and torques, collision filters, six joint types with limits, motors and springs, and contact, hit and sensor events. The scene recipes, their streams and their hashes are unchanged; the world API version stays 1.
- **Artifacts:** `box3d.wasm` and `box3d-mt.wasm` rebuilt with Emscripten 4.0.23 from Box3D v0.1.0. Before the change, the same toolchain reproduced the committed `box3d.wasm` byte for byte.
- **Kit 0.8.0 (`packages/box3d-kit`):** `createBody`, `createJoint`, `onEvent`, `reset`, setters and force calls on `PhysicsWorld`; a three.js adapter for mixed shapes; a validation suite against closed-form physics. See the kit changelog.
- **Roadmap:** `docs/ROADMAP.md` is now the single plan of record.

## Unreleased — 2026-11-01 — Engineering Studio, math runtime pilot and CI repair

### Integrated work

- **Engineering Studio** (`bridge-water-20261003`): `index.html` now opens the studio with eight studies — suspension bridge, canopy, metal press, and liquid, glass, concrete, elastomer and granular labs. The bridge adds configurable experiment scans (load, strength or crosswind; 3–9 cases; 15–120 s recordings; follow-up scans; sample CSV). Falling bridge pieces now interact with the river: buoyancy, drag, downstream drift and riverbed contact, with splash, ring, foam and spray visuals.
- **Studio media** (`backup/offload-20261004`): textures, models and reference images; rebuilt `box3d.wasm` and new `box3d-mt.wasm` matching `BUILD_PROVENANCE.json` (the committed `box3d.wasm` was stale); design and QA evidence images and logs.
- **Math runtime pilot** (`codex/math-runtime-water-pilot-20261031`, based on a review of the `openai/math` catalogue published 2026-10-06): incremental execution graph, planned resident water, optional GPU water solver, conservative transformed-box visibility with stable prefix-sum lists and indirect draws, dependency-checked shadow reuse with empty-caster clears, the orthographic zero-to-one depth fix and the CPU/GPU material-rounding fix. A fresh review of the same catalogue revision found no further result that applies to this code.
- **Oct 3 batches**: input validation and the NaN-safe hash (`claude/correctness-fixes-enhancement-lists`), six speed and visual changes (`claude/speed-visual-accuracy-batch1`), and the cloud-readiness notes.

### Renderer integration

- Instance drawing prefers GPU visibility lists (opt-in `computeVisibility`), then the material partition (opt-in `instancePartitioning`), then direct instancing.
- One shadow cache (on by default, toggleable). It checks caster material, path and initialization and clears when casters vanish; `shadowCacheInfo()` reports its counters.
- Visibility resources follow instance-capacity growth instead of keeping bindings to replaced buffers.
- `useGpuWater()` and `uploadResidentWater()` each reset the other path.

### Fixes

- CI has failed since 2026-08-14. Rope batching is now qualified against the same source's legacy per-constraint cadence: the archived v1.9.0 reference became unreachable when rope drag was made time-step scaled. That exposed real divergence, so batching at maximum stress now excludes rope variants 2, 3 and 5; the 23 remaining batched combinations are bit-exact over 720 frames.
- The self-test validates the studio shell. Projection-depth, studio floor and non-press trajectory tests reflect texel-snapped shadows, riverbed contact and cross-platform float noise.

### Benchmarks

- [`docs/BENCHMARKS_MERGE_20261101.md`](docs/BENCHMARKS_MERGE_20261101.md) compares this branch with `main` on a CPU host and an NVIDIA L4. Results:
  - Renderer: every image check passes against a colour-matched control, and GPU time per frame is 33–45% lower in five of six scenes.
  - Native engine: unchanged speed, and trajectories are bit-identical.
  - Soft bodies: unchanged except 15 rope scenes, which are 13–20% slower on the exact cadence.
  - GPU-resident water: up to 217× faster than CPU water plus upload.
- `benchmarks/merge-20261101` holds the harness, raw results and the generated summary.
- Harness changes:
  - The renderer runtime test now also passes with instance partitioning on.
  - The GPU harnesses gained a `--hardware-vulkan` browser profile and a colour-pipeline control baseline.
  - Dawn scripts now read `WEBGPU_DAWN_BACKEND`.

### Known issues

- The AAA Physics Lab (`src/main.ts`) is no longer a page of the production build; `index.html` opens the Engineering Studio.
- Canopy contact costs 10.8 ms per step at service load, which is 0.77× real time on a 2.1 GHz cloud CPU.
- Glass lab: after fracture (about 364 shards) a CPU step can take about 1 s. `ConvexContactWorld.stepInterval` rolls the whole world back and re-runs half-steps whenever one pair needs recovery, so `tests/studio/material-labs.test.mjs` does not finish in practical time. Unchanged here.
- Twelve `tests/engine` evidence and provenance checks carried over from the Oct 3 snapshot fail. They are not part of CI.

## 1.20.0 — 2026-07-19 — AAA Material Programs Expansion

### Material demonstrations

- Added **30 authored material programs**: ten metal-forming and impact demonstrations, ten architectural and safety-glass fracture demonstrations, and ten reinforced-concrete failure demonstrations.
- Added **Apex Materials Proving Ground**, a combined AAA sequence that runs the metal, glass, and concrete rigs together in one coordinated high-bay stage.
- Kept the proven 800 deterministic physics-recipe and native scene-ID contract intact; the new presentation registry derives material-specialized presets lazily instead of renumbering the native catalog.
- Added per-program fixtures, boundary conditions, load patterns, strike locations, crack styles, camera direction, and Poliigon-derived concrete, metal, glass, and stone stage materials.

### Direction and scale

- Expanded the cinematic director from 34 to **65 hero sequences** while retaining the ten signature scenes and their exactly 100 v1.19 production improvements.
- Added target-aware combined-sequence beats so metal loading and denting, glass impact and shattering, and concrete loading, spall, and fracture can be directed independently before the final synchronized failure pass.
- Preserved the existing 800-scene browser, benchmark baselines, source-frozen performance evidence, native Box3D provenance, and the exact 100-case comparative material campaign.

### Validation and release tooling

- Added deterministic registry contracts for exactly ten metal, ten glass, ten concrete, and one combined program, including unique IDs, finite stage transforms, bounded streams, repeatable replay state, and all 65 hero timelines.
- Promoted `validate:v1.20` through the package, CI, Pages, pull-request, and publishing workflows while retaining all v1.19 soft-system, native-WASM, WebGPU, material, production-build, audit, and manifest gates.

## 1.19.0 — 2026-07-18 — 100-Item AAA Signature Production Pass

### Presentation

- Added exactly 100 numbered runtime improvements across the ten signature scenes, with ten authored architecture, lighting, engineering-forensics, safety, and story-cue upgrades per stage.
- Added backend-neutral static stage primitives to the cached effect instance stream so native Box3D WASM and deterministic preview scenes share identical presentation without changing solver state or replay hashes.
- Reserved authored stage identity ahead of transient particle allocation, keeping signature architecture visible during explosion-, rain-, and fracture-heavy beats.
- Corrected concrete crater aggregate from the woven-fabric material tag to the mineral/stone atlas path.

### Controls and direction

- Global shortcuts now ignore editable controls, key repeats, and browser/OS modifier combinations.
- Pausing simulation now freezes the cinematic clock as well as physics, preventing director events from executing against a frozen world.

### Validation

- Added an executable registry contract for exactly 100 unique ordinals, ten-per-scene ownership, finite transforms and colors, positive scales, category coverage, and runtime stage-frame construction.
- Added release/self-test/CI/publisher checks for the v1.19 gate while preserving all source-frozen performance evidence and native/WebGPU/material gates.

## 1.18.0 — 2026-07-18 — Material Impact Spectacle Pass

### Presentation

- Added dedicated material strike effects: hot metal scale/sparks, concrete dust/aggregate/rebar sparks, and glass micro-shard glints with a vertical fracture-wave ring.
- Added persistent yielded-metal strain bands, concrete crater aggregate, and luminous glass crack-edge geometry so failure remains readable after transient particles clear.
- Added distinct five-key camera tracks for overhead metal-forming inspection, low/side concrete rebar transfer, and grazing-angle glass fracture coverage.

### Validation

- Extended metal, concrete, glass, and cinematic-effect contracts to require the new persistent accent material tags, finite effect streams, and vertical glass wave geometry.
- Retained authoritative lattice state, replay hashes, fracture counts, and the frozen v1.13 performance evidence; VFX remain presentation-only and do not alter solver forces.

## 1.17.0 — 2026-07-18 — AAA Materials Destruction Pass

### Metal

- Added damage-aware galvanized sheet tiles over the compact lattice so bending, springback, permanent set, and opened tears read as a deforming surface.
- Retained the deterministic perimeter-clamped dent rig and added the material-wide `I` strike action.
- Re-directed Steel Yield-to-Rupture around proof load, plastic hinge formation, unloading, notch damage, ultimate displacement, and final permanent-set review.

### Concrete

- Added persistent ductile reinforcement constraints with independent yield, rupture, and metal presentation parameters.
- Concrete cohesive-cell separation now removes local cover tiles and emits deterministic Poliigon-atlas spall bodies.
- Re-authored the hero around service preload, flexural cracking, two physical spall events, rebar load transfer, unloading, and residual bridging.

### Glass

- Replaced the generic horizontal coupon presentation with a framed vertical reflective pane.
- Added a center-punch trigger, eight bounded radial crack fronts, damage-aware pane tiles, and up to 192 thin rotating shards retained through final inspection.
- Removed the duplicate unbreakable central glass dressing so the visible pane now follows the authoritative fracture state.

### Validation

- Added a deterministic dual-run concrete/glass contract covering localized cell failure, fragment retention, rebar persistence, bounded crack propagation, remaining topology, and finite streams.
- Expanded material telemetry with fractured-cell, live-fragment, and surviving-reinforcement counts.
- The suite now contains 26 deterministic unit tests; source-frozen v1.13 performance evidence remains unchanged.

## 1.16.0 — 2026-07-18 — Metal Bend & Dent Lab

### Added

- Added **Titan Metal Bend & Dent**, an 18-second directed hero built on the Structural Steel Impact Demo recipe.
- Added a dense 528-node perimeter-clamped metal pressure panel, a readable galvanized press frame, radial actuator loading, and deterministic centered dent strikes for steel, aluminum, and copper Impact Demo scenes.
- Added current/peak center deflection and unloaded residual-set telemetry, a **Dent Strike** command-deck control, and the `I` shortcut.
- Added a deterministic bend → unload → dent → springback contract that runs two independent simulations and verifies identical hashes, visible yield, retained set, finite GPU-expanded topology, and no rupture during the controlled strike.

### Changed

- Increased the directed hero catalog from 33 to **34** while retaining all 800 deterministic scenes and the ten-scene v1.15 signature set.
- Specialized metal Impact Demo loading from a uniform three-point band to a combined global-bend and radial-indenter field; other material recipes preserve their existing comparison path.
- Expanded material documentation and the live rig so transient indentation, springback, and permanent deformation are independently legible.

### Validation

- All 25 deterministic unit suites pass, including the dedicated 2,875-constraint bend/dent scenario and the complete 34-hero director contract.
- The v1.13 source-frozen performance evidence remains unchanged; v1.16 is a new simulation/presentation feature and does not claim an unmeasured speedup.

## 1.15.0 — 2026-07-18 — Signature AAA Materials

### Added

- Promoted ten hero scenes into a starred signature set with additional authored architecture, observation equipment, facade systems, debris, and stage dressing.
- Added Poliigon-derived weathered concrete, galvanized metal, woven fabric, and honed-stone atlases in directly uploadable ASTC 6×6 KTX2 with RGBA8 and deterministic procedural fallbacks.
- Added reflective architectural-glass shading, a new **Concrete Spall & Rebar Exposure** hero, physical concrete cover fragments, and exposed reinforcement dressing.
- Added a reproducible local material-atlas build script and a dedicated signature-scene guide.

### Changed

- Extended the existing rigid instance material word so concrete, metal, stone, and glass share the established instanced PBR pipeline without per-material draw-call proliferation.
- Textured both packed tearing cloth and GPU-resident intact cloth with the woven-fabric atlas tile.
- Rebuilt the native Box3D WebAssembly artifact with renderer material tags and signature-stage parity.
- Increased the directed hero catalog from 32 to **33** while retaining 800 deterministic scenes.

### Validation

- All 24 deterministic unit suites, 11 WGSL modules, actual renderer runtime, C17 bridge syntax, SIMD/scalar soft kernels, RGBA8 and block-aligned ASTC atlas uploads, native 800-scene double replay, and production/Pages build gates pass.
- The hardware ASTC gate caught and corrected invalid 1024px/63px ASTC 6×6 copy extents; derived atlases are now 1008×1008 and retain only the fully block-aligned compressed mip prefix on the GPU.
- Native Box3D validation covers 1,146,621 body-frames per pass and the 4,096-body ceiling with finite material-tagged streams.
- The 100-case material campaign remains deterministic and finite; concrete and glass use their existing progressive and brittle solver profiles rather than cosmetic-only break animation.

## 1.14.0 — 2026-07-18 — Material Bending and Fracture Lab

### Added

- Added 50 deterministic material-test scenes and two directed heroes, bringing the catalog to **800 scenes** and **32 hero sequences**.
- Added ten normalized comparative presets: structural steel, aluminum, copper, oak, cross-laminated timber, reinforced concrete, soda-lime glass, acrylic, elastomer, and carbon-fiber laminate.
- Added a reduced-order beam lattice with tension/compression yield and break envelopes, plastic set, cumulative damage, fatigue, anisotropy, cohesive crack fronts, and bounded impact/rain/blast coupling.
- Added a 0–200% material load rig with apply, release, cycle, keyboard controls, live thresholds, damage, failure phase, energy, break count, and replay telemetry.
- Added an exact current-source **100-case** material campaign plus material preset, deterministic action, three-backend soak, GPU presentation, and native catalog contracts.

### Changed

- Generalized the compact GPU rope segment path so material members reuse its compute-expanded main/shadow presentation while keeping fracture decisions CPU-authoritative.
- Extended the native/fallback fixture stages, catalog, state sweep, release workflows, and documentation to the sixteenth material-fracture family.
- Rebuilt the pinned native Box3D artifact for the 800-scene stage map while retaining the v1.13 1,000-case result as source-frozen historical evidence.

### Validation

- All 24 deterministic Node suites, 11 Dawn WGSL modules, KTX2 paths, native bridge contract, SIMD/scalar kernels, production build, Pages build, and zero-vulnerability audit pass.
- JavaScript, SIMD-WASM, and scalar-WASM each pass 200 scenes, 4,800 catalog frames, and 2,400 deterministic replay frames.
- The 100-case material matrix is **100/100 finite, deterministic, and monotonic**; 83 cases reach yield/damage and 69 fracture. The representative full release-gate median/p95 case time is 0.398/0.844 ms per frame for the measured solver-plus-frame scope.
- The native Box3D artifact passes two deterministic 800-scene traversals, 1,145,838 body-frames per pass, and the 4,096-body ceiling.
- Visible browser acceptance passes **800/800 scenes**, **32/32 heroes**, representative steel/glass/elastomer/composite interactions, and a zero-warning/error console.

The material coefficients are dimensionless demonstration profiles, not calibrated FEA, real design allowables, or safety certification.

## 1.13.0 — 2026-07-16 — Thousand-Case Optimization Audit

### Added

- Added a source-, harness-, registry-, artifact-, renderer-, and Metal-gate-frozen tournament with exactly **1,000 / 1,000** completed production cases and zero correctness failures.
- Added a deterministic ten-shard runner and verification-only release gate. The full run records calibrated work, balanced execution order, exact state/render fingerprints, a predeclared 22.5 ms timing floor, global multiplicity screening, and fresh-process confirmation logic for any materially slower control that survives the screen.
- Added explicit current-source qualification for two historically missed compiler-mode candidates and for a hybrid renderer scratch-cache candidate; the rejected measurements remain part of the audit trail.

### Changed

- Added an exact eight-entry MRU cache for repeated native convex-hull construction.
- Cached the preview backend's dynamic-body count, added an exact all-static step early return, and avoided clearing reset storage that scene construction immediately overwrites.
- Qualified a high-count shallow-water path, retained stable native-wrapper transform/color pointers, and cached numeric renderer configuration state.
- Kept `-O3` for both packaged soft-kernel variants: current-source SIMD `-O2` and scalar `-Os` did not clear the active-workload performance gate. Kept the current renderer cache after the hybrid scratch-cache candidate regressed unchanged cloth and water work.

### Validation

- Final classification: **165 accepted wins, 353 borderline changed paths, 360 controls, 85 changed timer-floor cases, 37 rejected no-win paths, and 0 correctness failures**.
- The timing floor excludes 203 total cases—85 changed paths and 118 controls—from aggregate claims. Across 555 timer-qualified changed CPU production paths on Apple M3 Ultra / Node 26, the point-estimate geometric mean is **1.0544254732×**. The 242 timer-qualified controls measure **1.0041104525×**.
- No eligible control met both the material-regression threshold (`candidate / baseline < 0.94×`) and the global Benjamini–Hochberg screen (`q <= 0.05`). This wording does not mean every control point estimate improved, and the CPU-path aggregate is not a whole-engine or browser-FPS multiplier.
- The complete automated gate passes 22 deterministic Node suites, JavaScript/SIMD/scalar 150-scene soft soaks, the 250-combination rope qualification, the two-pass 750-scene native Box3D soak, 11 Dawn WGSL modules with zero uncaptured errors, production/Pages builds, and the zero-vulnerability audit.
- Final browser acceptance loaded **Box3D WASM**, visibly rendered and interacted with cloth, rope, and water, and produced **0 console warnings and 0 console errors**.
- Latest post-tournament Metal measurements are stored under `benchmarks/results/post1000-hardware/`; the frozen hardware snapshots referenced by the 1,000-case result remain its benchmark-closure evidence.
- Production output is 24.89 kB HTML, 239.27 kB main JavaScript (66.26 kB gzip), and a 9.25 kB lazy TurboQuant chunk (3.18 kB gzip); the moderate-or-higher npm audit reports zero vulnerabilities.

## 1.12.0 — 2026-07-16 — Sixth Production Optimization Pass

### Added

- Added a source-frozen v1.11-versus-v1.12 production tournament with exactly 100 cases, eight balanced samples per implementation/case, 20,000 stratified-bootstrap resamples, source/harness digests, and exact deterministic fingerprints.
- Added focused exact-output gates for axis-aligned cloth/water matrices, cinematic effect drag factors, cinematic camera sampling, and the rebuilt native Box3D transform stream.
- Added a native v1.11 artifact comparator and bridge-source provenance check; promoted `validate:v1.12` throughout CI, Pages, publish scripts, and repository contracts.

### Changed

- Qualified full batched WASM projection for all five Racing Sail modes.
- Specialized zero-rotation sphere and droplet matrices while preserving float32 bits, including signed zero.
- Hoisted the five built-in effect drag powers once per update and made the cinematic camera director sample into its retained rig.
- Added a density-aware native transform synchronization path: dynamic indices for static-heavy scenes and the original sequential scan for nearly-all-dynamic scenes.
- Corrected water-rain and collider-drape benchmark coverage, build provenance, and canonical-manifest handling of user-owned Finder duplicates.

### Rejected

- Reverted fallback cached-count/traversal, rope tuple removal, indexed cube geometry, stateful camera caching, broader cloth batching, native indexed kick, and native explosion candidates when complete-path, fidelity, or linked-WASM evidence failed the release gate.
- Retained TurboQuant only for bandwidth-constrained remote/replay state because prior local Worker measurements remain slower than raw transfer.

### Validation

- Final 100-case result: **14 accepted wins, 14 borderline paths, 0 no-win rejections, 72 controls, and 0 correctness failures**; changed paths measured **1.0640× geometric mean** and **1.0477× median**.
- Dedicated exact gates measure **1.748×** cloth-sphere staging, **4.135×** 768-droplet staging, **1.093×** complete effects update/build, **1.140×** camera sampling, **1.678×** static-heavy native synchronization, and **1.157×** mixed native frame preparation.
- The tracked native artifact passes two 750-scene deterministic soaks, 1,142,268 body-frames per pass, 4,096-body capacity, invalid-timestep guards, and exact v1.11/v1.12 stream comparisons.

## 1.11.0 — 2026-07-15 — Exact Production Optimization

### Added

- Added allocation-free camera matrix writers and an exact invalidation cache, plus version-keyed main-frame diagnostic/effect line staging.
- Added exact soft-system miss rejection and right-sized retained storage; added one-time fallback static streams, broad-rejected explosions, allocation-free contact resolution, and cadence-aware replay hashing.
- Added independent native Box3D transform/material revisions, awake-state reporting, settled-world step elimination, and zero-byte unchanged uploads.
- Added a source-frozen 100-case v1.10-versus-v1.11 tournament, dedicated camera/fallback/native/Metal/fidelity gates, and machine-readable visible-browser acceptance evidence.

### Changed

- Removed the dead packed-water WGSL module and its two unreachable render pipelines, reducing the live renderer from 12 to 11 shader modules and from 18 to 16 render pipelines without changing rendered pixel hashes.
- Fixed relative-base GitHub Pages loading of the native Box3D module and WASM by resolving public assets against `document.baseURI` before dynamic import.
- Promoted `validate:v1.11` to the CI and Pages release gate, including the tracked native Box3D soak and final benchmark-evidence checks.

### Rejected

- Reverted exact shadow-depth reuse after its separately compiled active rigid CPU-submit control missed the predeclared 0.98 non-regression floor. Its dependency, exact-pixel, zero-error, and paused-frame evidence remains archived, but the candidate is not a v1.11 gain.
- Kept broader fused cloth/rope schedules, a Box3D move-event stream, and four shader candidates out of the release when they failed fidelity or stable-performance gates.

### Validation

- The final balanced tournament ran exactly 100 cases with eight timed samples per variant/case: **20 accepted wins, 2 borderline results, 4 no-win rejections, 74 controls, and 0 correctness failures**. Changed paths measured **1.067× geometric mean** and **1.090× median**.
- The complete v1.11 gate passes 21/21 deterministic unit suites, all 750 scene constructors and 30 hero definitions, JavaScript/SIMD/scalar soft soaks, native Box3D's two-pass 750-scene soak, 11 live WGSL modules, production/Pages builds, and the zero-vulnerability audit.
- A visible macOS browser run of the relative-base Pages build loaded **Box3D WASM** with SIMD soft kernels, exercised rigid bodies plus cloth, rope, and water, and passed **750/750 scenes and 30/30 hero sequences**. Evidence is recorded in `benchmarks/results/v111-visible-browser-acceptance.json`.

## 1.10.0 — 2026-07-14 — Native, Cache, and Measured-Quality Integration

### Added

- Bundled the pinned Box3D v0.1.0 Emscripten artifact, upstream license, and machine-readable build provenance; added a deterministic 750-scene native soak and invalid-timestep regression gate.
- Added real KTX2 BC4/R8 runtime upload and sampling tests on Dawn null and Metal.
- Added Metal timestamp-query quality-profile benchmarks, renderer-startup comparison, unchanged-upload microbenchmark, fresh v1.10 integration benchmark, and a reproducible v1.9 integration baseline archive.
- Added exact rope batching qualification across 250 scene/stress combinations and promoted native/rope/integration checks into `validate:v1.10`, CI, and Pages deployment.

### Changed

- Restored allocation-light effects staging, in-place compaction, reusable debug lines, and unchanged-frame identity caching.
- Added frame-version and identity caches for rigid, effect, line, surface, soft-instance, and rope streams; unchanged uploads now account for zero bytes.
- Removed dead packed-water state, reducing retained maximum-water typed memory by 28.24% and improving construction by 1.375× in the persisted run.
- Restricted the faster multi-iteration rope projection bridge to the 38 maximum-stress combinations that pass exact legacy equivalence; all other stress/layout cases retain the original cadence.
- Made quality profiles control real 1×/4× MSAA, 1,024²/2,048² shadow resources, and 1/9-tap PCF work; Performance skips shadow sampling.
- Updated TurboQuant benchmarks to consume GPU-resident cloth positions, compact rope nodes, and water `eta/u/v`; it remains remote-only after a 53.3× local Worker slowdown.
- Averaged telemetry over its five-Hz reporting interval and eliminated debug-only line-object churn.

### Validation

- Fresh v1.2-to-v1.10 maximum-detail soft workloads measure 7.342× cloth, 2.746× rope, and 13.342× water, for a 6.455× geometric mean with zero correctness failures.
- The cross-platform v1.10 gate, all three 150-scene soft backends, 12 Dawn shaders, native Box3D soak, KTX2 tests, production/Pages builds, 158-entry source manifest, and zero-vulnerability audit pass.
- The Apple Metal gate passes with zero uncaptured WebGPU errors. A visible target-browser pass remains required because the in-app Browser runtime failed before tab acquisition.

## 1.9.0 — 2026-07-14 — Validated Semantic GPU-Cloth and GPU-Rope Integration

### Provenance

- Verified the supplied v1.9 archive with SHA-256 `09fa0eec3db1858d57cdc58a9fe8f021b76cd6c19c5b8913eb9d55e1667a1fbb`.
- Determined that the archive descends from its bundled original v1.8.0 source, while this repository descends from the independently reconstructed v1.8.1 implementation.
- Ported v1.9 behavior manually instead of replacing the repository tree, preserving the current soft-kernel loader/ABI, v1.8.1 fixes, and the v1.4.1 final-presentation V flip exactly once.
- Added [`docs/INTEGRATION_V1.9.md`](docs/INTEGRATION_V1.9.md) to record the lineage, semantic mapping, validation target, and evidence limits.

### Changed

- Added adaptive intact-cloth projection ceilings: four passes for perimeter-pinned membrane drums, six for hammocks/collider drapes, and eight for other intact cloth; tearing cloth keeps the full authoritative schedule.
- Added stiffness compensation for the reduced pass schedules while retaining the current one-stream soft-kernel ABI.
- Changed intact cloth's steady dynamic stream from positions plus strain at 16 bytes per vertex to positions only at 12 bytes per vertex.
- Added immutable rest-position storage so WGSL reconstructs visual strain from current/rest geometry. The legacy strain stream remains for diagnostics and tearing compatibility.
- Added compact rope node/segment publication. Each active segment carries two node indices, inverse rest length, radius, and RGBA in eight float32 words.
- Added WebGPU compute expansion of compact rope data into the existing model-matrix and material buffers, with segment metadata refreshed only when topology changes.
- Kept cloth PBD, rope PBD, shallow-water stepping, collision selection, and break bookkeeping on CPU/JavaScript or CPU/WebAssembly. The new compute pass prepares rendering; it is not a GPU physics solver.

### Validation and evidence status

- Added `npm run validate:v1.9` as the complete integrated target gate.
- The complete manifest-sealed `npm run validate:v1.9` gate passed on July 14, 2026: 16 unit suites, deterministic SIMD/scalar rebuilds, 12 Dawn shaders, the actual renderer runtime, JavaScript/SIMD/scalar soft soaks, supplied-evidence consistency, and production/Pages builds.
- Supplied benchmark reports describe the archive's exact-release lineage, not this manual v1.8.1-derived integration.
- `bench:fifth:gate` checks recorded evidence artifacts; it is not a fresh benchmark rerun.
- Some supplied measurements are noisy or have high MAD. The evidence does not prove physical-GPU duration, visible-browser correctness, or a universal FPS gain.

## 1.8.1 — 2026-07-13 — Reconstructed GPU-Surface and Soft-Kernel Edition

### Provenance

- Reconstructed the v1.8 architecture described in the prior project conversation from the verified v1.4.1 source available in this workspace.
- The referenced v1.8 release archive was not available locally or from the configured repository, so this change does not claim a byte-identical import and does not reuse the conversation's historical speedup figures as current evidence.

### Added

- Added deterministic standalone C17 soft kernels for intact-cloth projection, rope projection, shallow-water stepping, and rope matrix/color stream generation.
- Added reproducible SIMD and scalar WebAssembly builds, a stable ABI loader, a persistent typed-array arena, and automatic SIMD → scalar → JavaScript fallback.
- Added solver-native `gpu-cloth` and `gpu-water` surface contracts with explicit grid metadata and monotonic `frameVersion` values.
- Added GPU cloth main/shadow pipelines that reconstruct position, smooth normal, UV, checker palette, strain heat, woven response, and shadow position from storage buffers.
- Added a GPU water pipeline that reconstructs geometry, normals, curvature, foam, and material response from `eta`, `u`, and `v` storage buffers.
- Added soft-kernel ABI, determinism, numerical-parity, fallback, and real-scene integration tests.

### Changed

- Intact cloth now uploads positions plus strain at 16 bytes per vertex instead of rebuilding a packed render mesh on the CPU.
- Shallow water now uploads authoritative `eta/u/v` state at 12 bytes per cell instead of rebuilding packed surface vertices on the CPU.
- Tearing cloth deliberately retains the packed topology-aware fallback so real openings remain correct.
- Rope segment model matrices and tension colors can be generated directly in persistent WebAssembly memory.
- The deterministic rigid preview now uses a coherent longest-axis sweep-and-prune broadphase with persistent typed ordering/bounds buffers.
- Cloth and rope projectile interaction now rejects whole-system AABB misses before particle-level squared-distance checks.
- Surface, topology, and soft-instance streams now use buffer identity, topology version, and frame version to skip unchanged queue writes.
- Dawn coverage now exercises 11 WGSL modules, packed and GPU surface variants, storage-buffer reconstruction, dynamic shadows, and repeated-frame zero-upload behavior.
- Preserved the v1.4.1 final-presentation V flip exactly once; camera, projection, shadows, and world-space simulation remain unchanged.

### Evidence policy

- Current claims are limited to code contracts and checks reproducible from this repository.
- Historical benchmark reports remain available as historical documents, but v1.8.1 performance should be measured again on the target device before publishing comparative speed claims.

## 1.4.1 — 2026-07-12 — Camera Orientation Hotfix

- Corrected the final HDR fullscreen pass by flipping the sampled render-target V coordinate exactly once before swapchain presentation.
- Kept the existing camera rig, pitch convention, view matrix, projection, and world-space simulation unchanged.
- Added a source regression assertion that rejects removal of the required WebGPU presentation flip.
- Replaced environment-specific npm tarball URLs in the lockfile with public npm registry URLs so clean installs remain portable.
- Revalidated WGSL compilation, Dawn pipeline creation, runtime rendering, deterministic simulation, production builds, and the live browser view.

## 1.4.0 — TurboQuant Transport Evaluation

- Added an independent blockwise TurboQuant-MSE codec with deterministic random orthogonal rotation, Gaussian Lloyd–Max codebooks, and specialized 2/3/4-bit packing.
- Added a structured randomized Walsh–Hadamard path inspired by Fast-TurboQuant for O(d log d) transforms.
- Added synchronized predictive state streams that quantize deltas from the prior reconstructed frame.
- Added real cloth, rope, and water benchmarks for size, encode/decode time, error, copy cost, worker transport, fan-out, and network break-even.
- Added a dynamically loaded in-browser TurboQuant probe for target-device measurements.
- Kept TurboQuant disabled on the authoritative solver and same-thread WebGPU upload path because local end-to-end measurements show a regression despite large byte reductions.
- Added `bench:turboquant`, `bench:turboquant:worker`, `bench:turboquant:all`, and `validate:turboquant` scripts.

## 1.3.0 — 2026-07-12 — Packed Surface and KTX2 Optimization

- Replaced the original 48-byte dynamic cloth/water vertex with a 24-byte packed format using octahedral `snorm16x2` normals, `unorm8x4` color, `unorm16x2` UVs, and `uint16` topology.
- Reduced steady packed-surface traffic by **66.12% for cloth** and **66.39% for water** while caching topology until it changes.
- Added directly uploadable KTX2 BC4 material noise with R8 and deterministic procedural fallbacks; measured **49.73% smaller files** and **50.00% lower resident mip payload** at 30.862 dB base-mip PSNR.
- Added structure-of-arrays constraints, precomputed stiffness/break data, reusable simulation/frame buffers, shallow-water buffer swapping, in-place particle compaction, and geometric renderer buffer growth.
- Parallelized shader diagnostics and asynchronous pipeline creation, while recording local startup/fetch-overlap results as borderline or neutral rather than claiming a universal speedup.
- Retained packed topology-aware rendering for tearing cloth. Later releases superseded the intact cloth and water packed-vertex paths with smaller GPU-resident presentation streams.
- Rejected reciprocal cloth correction, separate final strain traversal, rope delta reuse, and non-water telemetry throttling when measurements failed the performance gate.
- See `docs/PERFORMANCE_V1.3.md` for the integrated workload, traffic, asset-quality, and rejected-candidate evidence.

## 1.2.0 — Performance Engineering Edition

- Added a reproducible 100-candidate optimization benchmark suite with raw JSON and CSV evidence.
- Added baseline-versus-optimized whole-project timing with medians and MAD noise reporting.
- Added allocation-free performance primitives, geometric capacity growth, and fixed ring-buffer utilities.
- Specialized side-effect-free vector-length and square operations in validated hot paths.
- Retained packed soft-body data layouts and cached cloth topology from the optimization branch.
- Added permanent `bench:100`, `bench:end-to-end`, `bench:all`, and `validate:performance` gates.
- Documented accepted, borderline, rejected, and future architectural candidates without multiplying unrelated benchmark ratios.

## 1.1.0 — cloth, rope, and interactive water edition

### Added

- 150 deterministic soft/fluid scenes: 50 cloth, 50 rope/rigging, and 50 water scenarios.
- Six directed hero demonstrations: Tempest Standard Protocol, Parachute Canopy Failure, Sky Crane Cable Failure, Suspension Cable Resonance, Tsunami Research Array, and Leviathan Impact Basin.
- Deterministic position-based cloth with structural, shear, and bend constraints; multiple pin layouts; wind; collision; strain visualization; controlled tearing; and topology holes.
- Deterministic rope/cable PBD with anchors, payloads, bend links, catenaries, cross-links, tension coloring, projectile severing, and controlled breakage.
- Interactive 2.5D linear shallow-water simulation with height/velocity fields, reflected boundaries, waves, wakes, fountains, rain, dam-break fronts, vortices, floaters, foam, and impact displacement.
- Indexed dynamic-surface upload path for cloth and water, including dedicated surface-shadow, woven-cloth, and translucent-water WebGPU pipelines.
- Soft-system command-deck telemetry for solver type, nodes, constraints/cells, broken links, energy, and combined replay hash.
- `npm run test:soft-soak` for all 150 soft/fluid scenes and paired deterministic deep replays.
- `npm run test:cbridge` for strict C17 bridge syntax/API-contract validation with warnings as errors.
- Detailed cloth/rope/water architecture and validation documentation.

### Changed

- Catalog expanded from 600 to 750 scenes and from 12 to 15 families.
- Hero director expanded from 24 to 30 authored sequences.
- Dawn validation expanded from five to eight WGSL modules and now covers indexed cloth/water draws.
- Renderer runtime test now uploads and renders real cloth and water surface frames.
- Soft solvers preallocate hot-path buffers and precompute constraint stiffness to avoid large per-frame allocation churn.
- Source-manifest verification now works with either GNU `sha256sum` or macOS `shasum`.

### Validation

- 11 deterministic Node suites pass.
- All 750 scenes construct and step; all 30 hero definitions validate.
- All 150 soft/fluid scenes pass finite-stream, topology, budget, action, and replay checks.
- Long-run preparation soaks covered 6,000 cloth, 9,000 rope, and 12,000 water frames without numerical corruption.
- Eight WGSL modules and the complete rigid/cloth/water frame graph pass Dawn validation with zero uncaptured errors.

## 1.0.2 — full WebGPU frame-validation hotfix

- Fixed a render-pass compatibility error discovered after the 1.0.1 shader correction: the atmospheric sky pipeline was used in a `depth24plus` render pass without declaring a matching depth/stencil state.
- Added `depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'always' }` to the sky pipeline so it shares the HDR pass safely without modifying depth.
- Added a Dawn-backed `npm run test:webgpu` gate using the null backend. It compiles all five WGSL modules, creates the shadow, sky, solid, line, RGBA post, and BGRA post pipelines, validates bind groups and attachments, and submits a complete offscreen shadow/HDR/post frame.
- Added a second Dawn test that transpiles and executes the actual `WebGPURenderer` class with a canvas-context shim, rendering one shadowed/debug-line frame and one resized no-shadow/zero-instance frame.
- Added a repository regression assertion for sky-pass depth compatibility.
- Fixed an illegal shadow-pass feedback loop: the writable depth map was also present in the scene sampling bind group. The shadow pass now uses a separate uniform-only layout and bind group.
- Added regression assertions that the shadow pass binds only the isolated shadow uniform group.
- Skipped zero-instance solid draw calls to remove Dawn diagnostics and avoid needless command encoding in empty scenes.
- Independently reproduced the original 1.0.0 `textureSampleCompare` failure in Dawn and confirmed that the 1.0.2 solid shader compiles with zero messages.

## 1.0.1 — WGSL shadow validation hotfix

- Fixed startup failure on strict WebGPU implementations where the PBR solid shader rejected `textureSampleCompare` in non-uniform fragment control flow.
- Replaced the shadow-map PCF lookup with `textureSampleCompareLevel`, which does not compute derivatives and has no uniform-control-flow requirement.
- Removed the per-fragment early return from the shadow lookup and masks out-of-bounds projections with `select`/`mix` after sampling.
- Added repository self-test assertions to prevent reintroducing derivative-sensitive `textureSampleCompare` in the solid shader path.

## 1.0.0 — 2026-07-10 — AAA Physics Lab Edition

### Added

- 24 directed hero demonstrations layered over the 600-scene capability catalog.
- Timed camera tracks, captions, impulses, projectiles, explosions, stress rain,
  time dilation, camera shake, and telemetry-lock beats.
- 2,048² PCF shadow mapping, four-sample MSAA, `rgba16float` HDR rendering,
  PBR-inspired GGX lighting, atmospheric sky/fog, emissive effects, bloom,
  tone mapping, vignette, and film grain.
- Performance, Balanced, Cinematic, and Ultra render profiles with real
  resolution, shadow, and effect-budget differences.
- Deterministic cinematic effects, authored scene dressing, and 624-scenario
  in-browser validation.
- A reproducible Box3D v0.1.0 Emscripten wrapper, stable C ABI, refreshed heap
  views after WASM memory growth, and safe GitHub publishing scripts.
- Detailed demo, renderer, native-port, test, publishing, and local browser
  validation documentation.
- MIT license and third-party notices.

### Corrected

- Camera elevation now uses positive pitch consistently, keeping catalog and
  cinematic cameras above their targets rather than below the ground plane.
- Non-uniform instance scaling now uses a normalized rotation basis for normal
  transformation, preventing distorted lighting on beams and slabs.
- Native build topology now wraps Box3D as a subproject rather than inheriting
  inappropriate top-level browser thread settings.
- Emscripten heap access now refreshes typed-array views after memory growth.

### Validation

- Strict TypeScript passed.
- Nine deterministic suites passed.
- All 600 catalog scenes constructed successfully.
- All 24 hero timelines passed camera/beat validation.
- Production and GitHub Pages builds passed.
- npm audit reported zero moderate-or-higher vulnerabilities.
- Native bridge passed strict C17 syntax checking with warnings as errors.
