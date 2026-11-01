# Quality enhancement verification · 8 September 2026

All three enhanced engineering studios are available through the loopback development preview at [127.0.0.1:5173](http://127.0.0.1:5173/?studio=canopy). The [comparison gallery](review.html) shows the frozen ImageGen concepts, previous implementation and final production captures. Human visual acceptance remains pending.

## Presets and source review

The library contains 71 starting points: 36 compatible surface finishes, 12 lighting setups, 18 load recipes and 5 camera views. These adapt material and lighting work reviewed in StudiCraft, HouseBuilder, Commander Academy and Material Forge. They are authored combinations of eight texture packs, not 36 independently scanned or calibrated materials. Applying a finish preserves the run; applying a load recipe explicitly starts a fresh experiment. Source details are in [SOURCE-REVIEW.md](SOURCE-REVIEW.md).

Nineteen added runtime assets, including four ImageGen material maps, have verified source hashes in [asset-provenance.json](asset-provenance.json). No source assets or code in the four reviewed workspaces were modified. Generated concepts are comparison references; scene rendering uses geometry, textures, lighting and solver transforms.

## Final build and runtime evidence

The required 12 captures all use production entry `index-DipR682Y.js`. Each has a paired JSON observation of the same study, presentation settings, live render counters, load history and viewport. Source, bundle and stylesheet hashes are frozen in [final-build.json](final-build.json); image hashes and dimensions are in [evidence/verification.json](evidence/verification.json).

Each study has a 1487 × 1058 overview, second angle and failed state plus a 390 × 844 phone layout. All required captures have positive frame, draw, triangle and object counters and no horizontal page overflow. Phone checks use browser viewport emulation on the desktop GPU, not a physical mobile device. Earlier captures remain in the evidence directory and `before-quality-control-fix/`; the gallery's `current-*` images are authoritative for this build.

| Study | Recorded time | Connections lost | Deflection (model units) | Failure events |
| --- | --- | --- | --- | --- |
| Canopy | 30.01 s | 69 | 5.172 | 10 |
| Plate | 37.83 s | 895 | 1.530 | 25 |
| Bridge | 30.01 s | 27 | 6.200 | 11 |

The plate retains 895 broken connections after release at 48.61 s; permanent deformation and separated pieces remain. Bridge replay returns to the intact starting state and Live returns to the recorded failure. Canopy tearing, plate yield/fracture and bridge connection loss remain driven by the existing simulation rather than animation timers.

Quality transitions, five camera modes, compatible material switching, lighting selection, library search/empty state, load selection, mobile settings, run/reset and replay were exercised. A last-pass WebGPU shadow-target resizing failure was reproduced and fixed: quality selection now changes output resolution while retaining stable 4096-pixel shadow targets. Final canopy captures demonstrate a change from 1003 × 676 pixels in Ultra to 752 × 507 in Balanced. The indoor plan camera now stays beneath the hall rafters. The final production console has no errors or warnings after all three studios and quality transitions; see [production-console.json](evidence/production-console.json).

## Automated checks

- `npm run typecheck`: passed after the final source change.
- `npm run test:studio`: 26/26 passed. Covers irreversible failure, attachment invariants, contact, reset and strength response.
- `npm run test:studio:presets`: 27/27 passed. Covers compatible presets, uniqueness, finite settings, actual assets and provenance, unchanged solver authority, and all 18 recipes integrating for 12 seconds without nonfinite state or moving fixed fixtures.
- `npm run build`: passed; retains the large JavaScript chunk warning (two bundles about 981–989 kB before gzip).

The original workbench also reaches its live Box3D WASM and Ballistic Dent viewport through `?workbench=1`, with no console errors. Its smoke-check capture and runtime observation are saved alongside the evidence.

Logs are saved alongside the evidence. The previous turn's 46 legacy unit suites and 8 engineering-evidence suites were not repeated in this refinement pass. No full native Metal soak or complete legacy benchmark matrix is claimed.

## Visual result and boundaries

Visible changes include woven surface relief and attached seams, differentiated machined/painted metal, threaded and bolted fittings, press hoses and exposed fracture edges, segmented timber planks, HDR lighting, live planar water reflection, blended riverbanks, rocks, grass and mixed leaf-card vegetation. Static fixtures are batched by material; default scene draw counts are 32 for canopy, 41 for press and 64 for bridge (bridge counts include reflection rendering).

The physics source remains unchanged at SHA-256 `fbc8326cb7f2f734351b2fc4d68a112340756311d28db92b794133acb934e0f0`. These are authored, reduced PBD studies with normalized loads. There is no FEM calibration, fabric or fragment self-collision, hydraulic fluid model, fluid/structure coupling or failure of fixed scenery. Cameras prioritize the specimens and their moving parts; some fixed machinery lies outside close views. Real-time scenes still differ from the photographic ImageGen references, especially fine wear and vegetation. Technical verification is separate from human approval of that visual match.

The disposable production output and its temporary preview server were removed after verification. Build hashes, logs, screenshots and source assets remain; `npm run build` regenerates the production output. The development studio and comparison gallery remain available on loopback port 5173.
