# Material studies — implementation and review

The studio now opens into Liquid dynamics and offers eight studies in one picker. Five new interactive studies provide 40 material profiles and 40 complete experiments. Metal press, canopy and suspension bridge remain accessible. The original workbench entry, markup and navigation have been retired; reusable engine code remains in the repository.

Preview: [Engineering Studio](http://127.0.0.1:5186/?studio=liquid). This is a local preview, not a deployed release. The source snapshot is `/private/tmp/box3d-material-stable-20260910`. `build-manifest.json` records the compiled artifact and six generated image hashes; `source-checkpoint.json` confirms all nine owned entry/navigation/material-module files match the workspace. Shared engine and classic-study code is frozen at the captured checkpoint to avoid racing the concurrent engine task.

## Five working studies

| Study | Apparatus and visible behavior | Main controls |
| --- | --- | --- |
| Liquid dynamics | Clear flume, lifting gate, twin obstacles, pump and hoses; moving surface and conserved liquid volume | Liquid profile, release, gate speed, upstream depth, viscosity multiplier, downstream fill |
| Glass impact | Clamped pane, suspended striker, radial fracture, catch tray, retained laminated fragments | Pane profile, impact mass, drop height, thickness, restraint, strike offset |
| Concrete crush | Four-column hydraulic press, bonded aggregate specimen, cracking and displaced fragments | Concrete profile, compression, rate, specimen size, restraint |
| Elastomer lab | Circular platens, compressed cylinder, bulging, hold, creep and recovery | Material profile, compression, rate, size, hold |
| Granular flow | Clear tray, lifting gate, cylindrical obstacle, individual contacting grains and settled pile | Grain profile, release, gate rate, grain size, friction, fill |

Every study has eight prepared experiments and eight material profiles, independent numeric/range inputs, a specimen seed, three camera views, pause/reset, playback speeds, recorded-history replay, a generated-reference viewer and JSON export. Presets serialize their actual settings into the URL. Custom settings do not falsely highlight the default preset. Keyboard tabs and the phone inspector retain the same workflow.

## Mockup and reconstruction evidence

Five imagegen mockups were generated and inspected before implementation. `prompts.json` and `image-provenance.json` preserve the prompts and original file hashes. A sixth generated image supplies the empty testing hall; `hall-prompt.txt` and `hall-provenance.json` preserve it. The live scene uses actual geometry for the apparatus and specimens, with a ground-projected panorama and image-based reflections for the hall. The hall is not fully reconstructed room geometry, and its LDR image is not measured HDR illumination.

The retained design features are the ivory application frame, orange actions, narrow left tool rail, right inspector, lower-left readings, bottom playback, and apparatus-specific framing. Physical corrections made during review include grounded glass frame feet, press crowns that meet their columns, continuous platen/ram contact, a concrete catch tray clear of the columns, contained grains, contact-aware falling glass, and damped retained fragments. The final glass-retention capture shows a fractured pane held in the frame instead of perpetually rotating pieces.

`geometry/*-verification.log` records five actual `verify_scene.py` PASS results: structural schema, zero reported unintended overlaps, support consistency and no entirely off-screen components in the declared coarse graphs. Their composites were viewed. These graphs cover exposed primary supports and containment, not every fastener, hose, dynamic contact or render triangle. Cylinders are projected as bounding boxes by the diagnostic verifier. The graph cameras are diagnostic approximations; the runtime uses fitted perspective cameras. The graphs do not establish pixel-perfect image parity or engineering dimensional accuracy.

## Verification

- `node --test tests/studio/material-labs.test.mjs`: **56 passed, 0 failed**. All 40 programs run through their complete configured duration. `model-tests.log` and `model-qa.json` retain results, source hashes and final metrics.
- Numerical checks cover finite states, seeded repeatability, immutable recorded frames, shallow-water mass and positivity, glass thickness/retention and off-center coverage, concrete strength and low-strain behavior, elastic recovery versus foam set, and granular count, containment, contacts and friction response.
- `npm run typecheck`: passed. Isolated Vite production build: passed. These checks do not substitute for the visual review below.
- Existing local in-app browser: all five new labs rendered and ran. Representative views include `captures/glass-retained-final.png`, `concrete-hall-failure.png`, `rubber-hall-compressed.png`, `rubber-hall-recovered.png`, `granular-desktop.png` and `granular-top.png`. `captures/browser-qa.json` records the route, state, metrics and build entry for each capture. Earlier captures retain their earlier build identifiers; they are iteration evidence, not silently relabeled final artifacts.
- The silicone replay shows 50.01% compression and 99.15% retained modeled volume at 3.54 s, then 0% compression and 100% volume at 18.01 s. Laminated glass finishes with 100% fractured pieces retained in the frame. The default granular program settles with all 1,056 grains retained. The liquid program preserves approximately 3.04337 model m³.
- At 390 × 844, the liquid numeric input, material cards, preset search, reference dialog, keyboard tabs and inspector were exercised without horizontal overflow. `phone-materials.png` uses an explicit viewport crop to avoid an in-app compositor artifact. This is viewport emulation, not physical touch-device acceptance.
- Export was verified from the actual downloaded `box3d-liquid-run.json`: honey profile, depth 0.8, seed 42, one initial recorded frame and valid `box3d-material-study-v1` data. `export-qa.json` records its hash. This export contains recorded visual states, not resumable solver checkpoints.
- The existing metal press, canopy and bridge completed native WebGPU/worker runs via the eight-study picker: perforated press at 11.82 s, collapsed canopy and bridge at 30.01 s. A classic canopy preset application retained all eight options and zero original-workbench links. The historical `?workbench=1` route opened Liquid dynamics and normalized its URL into the new study. Classic checks exercise the captured shared-engine version only.
- Final water review found missing texture coordinates on the liquid side walls. The side geometry now supplies UVs; the rebuilt liquid scene rendered without new warnings or errors. `captures/liquid-final-desktop.png` records the corrected build.

The Browserless static-payload check was **blocked before execution by automatic approval review** because sending the private compiled build and generated assets lacked specific payload/destination approval. No files were transferred, no remote session was created and no indirect retry was made. `remote-browser-qa.json` is a blocked receipt, not remote validation. Bounded verification continued in the existing healthy local tab.

## Reconstruction failure-register walk

| Check | Observed result and limit |
| --- | --- |
| A1 | Reference view and apparatus composition were recorded before construction. Camera values remain inferred. |
| A2 | Compared source images and runtime perspective; revised the fitted camera to avoid excessive empty space. Exact FOV is not recoverable from the generated images. |
| A3 | Near-level verticals and raised flume views were inspected in the actual renders. The generated hall horizon is approximate. |
| A4 | Upright world up retained; the references do not require a Dutch angle. |
| A5 | Apparatus framing adjusted from individual mesh bounds; actual viewport captures show the specimen and support structure. |
| B1 | Each graph declares an assumed apparatus scale anchor. |
| B2 | Absolute dimensions and coefficients are explicitly comparative/inferred, not measured source facts. |
| B3 | Relative proportions use apparatus geometry and perspective, not raw screen pixel lengths. |
| C1 | Source apparatus silhouettes and diagnostic composites were compared; live secondary/detail views were inspected. |
| C2 | Cylindrical platens, columns, grains and pendulum are curved geometry; the coarse verifier's box silhouettes are disclosed. |
| C3 | Detail effort concentrated on visible load paths, clamps, tray edges, gates and material response. |
| C4 | No silent default box replaces an unsupported runtime apparatus primitive. Concrete fragments deliberately use coarse authored polyhedra. |
| D1 | Floating glass supports were corrected; declared support graphs pass and feet were viewed in the runtime. |
| D2 | Press platen and specimen contact corrections were rechecked. No exhaustive dynamic collision proof is claimed. |
| D3 | Primary columns, specimens, transparent tank walls and strikers were inspected from the hero view and relevant second views. |
| D4 | Five graph projections report no off-screen components; runtime apparatus fits its viewport. |
| D5 | Apparatus axes and the bridge/press compatibility views were inspected in the live browser. |
| E1 | Initial concrete/rubber overlap violations were corrected in the apparatus and graphs; five final coarse graphs pass. |
| E2 | Open tanks/trays are treated as containment with separate solid walls and floors. |
| E3 | Container status is not used to suppress the crown/column/tray issues that were found. |
| E4 | Visible feet, clamp mounts and ram-to-platen attachments were checked after correction. |
| F1 | Material palette follows the generated references; exact pixel color matching under different lighting is not claimed. |
| F2 | Key-light placement and visible shadows were inspected in the rendered hall. |
| F3 | The generated panorama restores the hall context, with the projection limitation stated above. |
| F4 | Glass transparency, water reflections, metallic columns and rough concrete are visible in actual captures. |
| G1 | PASS statements cite real logs; remote rejection is labeled blocked. |
| G2 | Coarse scene graphs were actually projected by the verifier. |
| G3 | All five diagnostic composites and original mockups were opened for comparison. |
| G4 | Corrected support and containment graphs were rerun; corrected glass retention was run and captured again. |
| G5 | Initial geometry checks found nine concrete and one rubber violations; additional runtime review found camera, glass and floor-contact problems. |
| H1 | Runtime transforms use Three setters/quaternions; the app parsed and rendered. |
| H2 | The r128-only primitive restriction does not apply to the installed Three 185 application. |
| H3 | OrbitControls is imported from the installed Three package and was used in the working runtime. |
| H4 | Lighting and metal/water highlights were viewed; no measured display/color acceptance is claimed. |
| H5 | All 40 numerical programs remain finite; all five rendered specimens were inspected. |
| H6 | TypeScript, production bundling and actual browser startup passed. |

## Model limits and integration boundary

These are authored comparative educational models. Liquid is a depth-averaged finite-volume model with damping, not full three-dimensional splashing or a calibrated viscous CFD solver. Glass uses an energy threshold, a prescribed radial subdivision and rigid fragment dynamics. Concrete uses a coarse bonded-fragment model, not calibrated fracture mechanics. Rubber is a reduced viscoelastic/volume-aware model. Granular materials use spherical coarse particles and contact/friction approximations; named profiles do not reproduce every grain shape or capillary interaction. The UI identifies the models as uncalibrated.

Modeling references informed the approach: [hydrostatic reconstruction and shallow-water methods](https://perso.math.u-pem.fr/bouchut.francois/publications/hydroproj_published.pdf), [position-based dynamics](https://matthias-research.github.io/pages/publications/posBasedDyn.pdf). These references are principles, not claims of identical implementation or validation against laboratory data.

`createModel(id, settings)` returns the independent material model; `step(1/120)`, `release()` and `snapshot()` form its current boundary. `LabFrame` provides immutable time, positions, rotations, damage, actuator, phase and three metrics. It is not a `FailureSimulation` instance. A future shared-engine adapter must include internal velocity, bond/contact state and random state before it can promise resumable checkpoints. No concurrent engine-owned file was edited for this expansion, and no commit, push, deployment or store submission was made.
