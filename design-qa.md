# Engineering Studio — implementation review

final result: passed

This passes the three-study interactive prototype gate. It is not a claim of pixel equivalence, photographic realism, calibrated engineering accuracy, or human visual acceptance. The selected images establish the three art directions; the user also required actual failure simulation. The viewport is therefore live geometry with generated material maps, rather than a raster of the mockup.

## Evidence and normalization

Source visual truth is frozen in `docs/design/realism-20260908/reference-manifest.json`:

| Study | Source | Implementation |
| --- | --- | --- |
| Canopy / Precision | `option-1-precision-studio.png` | `evidence/canopy-intact.png` |
| Plate / Atelier | `option-2-research-atelier.png` | `evidence/plate-intact.png` |
| Bridge / Observatory | `option-3-field-observatory.png` | `evidence/bridge-intact.png` |

Paths in this table are relative to `docs/design/realism-20260908/`. Both source and implementation images are **1487 × 1058 pixels**. Implementations were captured at 1487 × 1058 CSS pixels with density 1. The generated source has no independent CSS/density metadata. No browser frame is included. Full comparisons display each image at the same 616-pixel width; focused comparisons display the same upper scene crop at native 1:1 size. These are actual combined browser inputs, saved as `evidence/compare-{canopy,plate,bridge}-{full,focus}.png`.

The comparison state is the material view with intact connections. The reference images contain illustrative load values, traces, and annotations from an unspecified simulation state. The live initial captures show zero elapsed time and empty history. Numerical trace shape and deformation amplitude cannot be matched honestly to those invented values. Failure, unloaded and replay states are separately verified with actual solver data.

Additional captures cover all three failed states, a second camera angle for each, 390 × 844 responsive views, the mobile inspector, plate after unloading, canopy strain mode, and the production app at 1280 × 720. The latter also tests the shorter desktop layout. `verification.json` records artifact dimensions, hashes, timestamps and the final source hashes.

## Findings and corrections

No unresolved P0/P1/P2 issues remain in the implemented three-study workflow.

| Priority | Earlier finding | Correction | Post-fix evidence |
| --- | --- | --- | --- |
| P0 | Response mode could stop rendering after a texture was removed from an already compiled material. | Use separate natural and strain materials; switch the mesh material rather than nulling a live texture node. | `canopy-strain.png`; plate Material → Response → Material, fresh console empty. |
| P0 | Initial ambient-occlusion shader used an incompatible multisampled depth texture. | Single-sample scene pass and a separate FXAA output stage. | All fresh production captures; `production-console.json`. |
| P1 | Scene navigation could leave the renderer attached to an old viewport host. | Reconnect the canvas and ResizeObserver to the newly rendered host. | Canopy → plate → bridge navigation in the production build. |
| P1 | The press rod visually detached from its housing at full travel. | Extend the telescoping rod to retain housing overlap throughout the stroke. | `plate-failed.png`, `plate-unloaded.png`, `plate-second-angle.png`. |
| P2 | Early hall geometry could obstruct the camera. | Raise the overhead members beyond the viewing cone. | `canopy-intact.png`, `plate-intact.png`, second angles. |
| P2 | Plate fragments needed a collision floor aligned with the visible bed. | Align model floor to the bed at 1.62 model units. | `plate-unloaded.png`; floor/contact solver tests. |
| P2 | Narrow viewports could clip the bridge towers. | Scale camera fit by the actual viewport aspect ratio. | `bridge-mobile.png`; all three mobile views. |
| P2 | The mobile inspector and short desktop layout could hide primary controls. | Scroll the settings area while keeping result/action controls separate; provide a mobile drawer and workspace selector. | `mobile-inspector.png`, mobile scene captures, production views. |
| P2 | Bridge headline overlapped the floating setup panel at 1280 × 720. | Hide the decorative desktop field headline; retain the study name in the setup panel. Hide the small mobile caption label near status. | Final `production-bridge.png`, `bridge-intact.png`, final mobile captures and repeated bridge comparison. |

The pass-1 captures retain earlier composition evidence. The final bridge capture and repeated comparison follow the last caption correction. Shader/build troubleshooting is not counted as a visual comparison iteration; the camera, attachment and overlapping-caption corrections were checked in rendered images.

## Required fidelity surfaces

- **Typography:** Inter at 400–700 supplies the neutral technical sans hierarchy, with IBM Plex Mono for values and timelines. The references do not identify exact font families. The weight, compact labels, large target value and restrained study headings follow their hierarchy. Text is real accessible UI, not generated-image text.
- **Spacing and layout:** Precision retains the dark outline/viewport/inspector/chart arrangement. Atelier retains the light workspace, inset scene and orange primary action. Observatory uses the full scene with floating dark panels and bottom history. Responsive layouts preserve run, reset, replay and load access. Navigation is intentionally organized around the three implemented studies rather than the mockups' fictional application sections.
- **Colors and tokens:** Charcoal and muted teal-gray panels, off-white Atelier surfaces, orange actions/selection, and cyan response channels follow the references. State colors identify actual running/failure state. Generated example values have been replaced with model-derived values.
- **Image quality:** The material maps are generated concrete, ivory weave, machined metal and transparent foliage. They are applied to real 3D meshes with PBR materials, environment reflections, shadows and ambient occlusion. All three scene subjects and major fixtures are present. The real-time rendering remains cleaner and less photographic than the generated references, especially fabric microtexture, aged metal, vegetation distribution and river detail. This is explicitly retained as further visual polish, not represented as a 1:1 reconstruction or an accepted photographic match.
- **Copy/content:** The UI names the specimen, supports, load case, failure mode, actual connection loss and deflection. It labels model units and the comparative/non-calibrated boundary. Mockup sample curves, stress values and run-history rows are not invented as live measurements. Phosphor icons provide conventional control affordances.

## Interaction and runtime verification

- All three studios load, navigate, run to failure and reset; support nodes stay fixed. Controls change actual load, connection strength and wind inputs.
- The membrane tears, the plate yields and perforates, and the bridge loses connections and collapses. Detached nodes continue integrating rather than disappearing on a timer.
- Material/strain mode, second camera angle, fit, playback speed and mobile settings were exercised. Scrubbing restores recorded topology; Play history animates stored states; Live restores the current run.
- The plate retained 895 broken connections after unloading to zero, with the dent/fragments still visible. Its JSON export contains 401 recorded responses and the topology. Viewport PNG export was downloaded and visually inspected.
- Production navigation and the reference dialog were exercised. Fresh studio error/warning logs are empty. The original workbench also reached its live Box3D WASM view through `?workbench=1`.
- TypeScript and production build pass. All 26 studio physics checks, 46 existing unit suites and 8 existing engineering-evidence suites pass. The build emits the existing-style large-chunk warning; no full native/Metal soak or complete legacy benchmark matrix is claimed.

## Follow-up polish and limits

- P3: Add finer weave visibility, more uneven workshop wear and denser riverbank/vegetation detail to approach the mockups' photographic finish.
- P3: Authored camera positions prioritize seeing attachments and failure. They do not reproduce the exact generated camera or hidden geometry.
- Human visual acceptance remains pending. The three studies are reduced particle/constraint models with authored dimensions and thresholds. Fixed machinery, towers and terrain do not fail; self-collision, hydraulics and water/structure coupling are not modeled.

## Implementation checklist

1. Completed the three live scenes and corresponding responsive treatments.
2. Completed irreversible damage, release/reset, replay and evidence export.
3. Completed desktop/mobile, failed/second-angle and source/runtime visual comparisons.
4. Completed appropriate solver, integration, build and browser verification.
5. Keep the loopback development preview available for review; no deployment or commit requested.

## Quality enhancement v2 · 8 September 2026

The next refinement adds 71 presets informed by a source review of StudiCraft, HouseBuilder, Commander Academy and Material Forge: 36 compatible finishes, 12 lighting setups, 18 normalized load recipes and 5 inspection cameras. The source review is limited to the relevant material, environment, lighting and failure-study code and assets; it is not a whole-product audit of those four applications. See [source review](docs/design/quality-v2-20260908/SOURCE-REVIEW.md) and the [interactive comparison gallery](docs/design/quality-v2-20260908/review.html).

The earlier P3 surface-detail item is substantially addressed by woven base/normal/roughness maps, attached panel seams and stitching, brushed metal relief, fixture wear, threaded fittings, press hoses, visible fracture edges, timber boards and moving fasteners. The river scene now includes soil/moss blending, irregular textured rocks, grass and mixed leaf-card crowns with trunks. A procedural HDR environment, shaped studio emitters and live planar water reflections couple scene illumination and water sun direction. These are real-time meshes and materials, not ImageGen scene plates.

Static fixture geometry is grouped by material. Baseline draw counts are 32 for the canopy, 41 for the press and 64 for the bridge, including the bridge reflection passes. Both render-quality modes preserve 4096-pixel shadow targets; Balanced lowers output resolution. A runtime check caught destroyed shadow-texture bindings when changing map sizes, so quality switching now keeps the compiled shadow target stable. The indoor plan camera also stays below the ceiling rafters. A narrow-layout header gap that displaced the study tabs was removed.

The final production entry is `index-DipR682Y.js`. [Verification](docs/design/quality-v2-20260908/VERIFICATION.md) records the source and build hashes, 12 required desktop/phone/failure/second-angle captures, quality transitions, permanent plate damage, replay and fresh console results. The 26 physics checks and 27 preset/provenance/integration checks pass; typecheck and production build pass. The production build retains the large-chunk warning. The original physics module remains byte-for-byte unchanged in this quality pass.

Human visual acceptance remains pending. The authored real-time scenes still differ from the ImageGen concepts, especially photographic wear, vegetation and inferred cameras. The added finish variants reuse eight texture packs; they are not 36 independent scans and do not alter the material failure coefficients. Fixed machinery, bridge towers and terrain remain outside the failure model. Self-collision, hydraulics, water/structure coupling and engineering calibration are not added by this visual refinement.

## Quality enhancement v3 · September 8–9, 2026

The collection now has **150 presets**, including **24 complete experiment setups**. It adds saved favorites, recent choices, workspace filters, keyboard category navigation, a phone layout and a compact drawer beside the live scene. Sixty finish variants use thirteen local packs, including five new complete Academy PBR packs with exact byte provenance. Eight surroundings adapt architectural palettes and river treatments; lighting, material response, water normals and inspection cameras have been refined.

Production review caught and fixed CSS sample URLs resolving beneath `/assets/`, blank half-speed selection, stalled native graphics initialization, a misplaced clevis pin and obstructed camera framing. All three failures were observed: 69 canopy connections lost, 895 sheet connections lost (retained after unloading), and 27 bridge connections lost. The physics source remains byte-for-byte unchanged. All 26 physics and 44 collection/integration checks pass, along with typecheck and production build. See the [current verification](docs/design/quality-v3-20260908/VERIFICATION.md) and [review gallery](docs/design/quality-v3-20260908/review.html).

Native WebGPU initialization stalled in this session. Browser verification used the new WebGL 2 recovery path; its measured frame rate was limited (roughly 2–11 fps), and native GPU performance remains unverified here. No calibration or additional fixture/fluid physics is claimed. Human photographic-fidelity acceptance remains open.
