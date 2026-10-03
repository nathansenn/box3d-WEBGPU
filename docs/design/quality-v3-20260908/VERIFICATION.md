# Collection verification — September 8–9, 2026

The final collection contains **150 entries**: 24 complete scene setups, 60 compatible finishes, 20 lighting treatments, 30 load recipes, 8 cameras and 8 surroundings. The new 15 PBR maps (five matched packs) total 8,415,128 bytes and retain exact source hashes. Source projects were reviewed read-only.

## Checks completed

- TypeScript: pass (`typecheck.log`).
- Production build: pass (`build.log`), with the existing large-chunk warning retained.
- Physics: **26/26** checks passed.
- Preset/provenance/integration: **44/44** checks passed (`preset-tests.log`), including all 30 recipes integrated for 12 model seconds with finite positions and fixed fixtures. Every setup labeled Failure produces actual broken connections during its tested ramp.
- The physics SHA-256 remains `fbc8326cb7f2f734351b2fc4d68a112340756311d28db92b794133acb934e0f0`.
- Final source and compiled bundle hashes are recorded in `final-build.json`. The final production entry is `index-CW0Crxft.js`.

## Actual browser results

| Experiment | Observed outcome | Evidence |
|---|---|---|
| Canopy | 69 broken connections; collapsed at 18.40 model seconds. Replay at the beginning restored the recorded intact state; Live returned to the damaged state. Reset restored the specimen. | `canopy-failure.jpg/json`, `canopy-connection.jpg/json` |
| Forged sheet | 895 broken connections at 30.10 model seconds; still 895 at 40.20 seconds after the target returned to zero. Permanent perforation and fragments remained visible. | `plate-phone.jpg/json`, `plate-unloaded.jpg/json` |
| Autumn bridge | 27 broken connections; collapsed at 30.10 model seconds. | `bridge-failure.jpg/json`, `bridge-failure-focus.jpg/json` |

The press and bridge were manually advanced at 2× playback for these captures; their target and strength remained 4.00 and 1.00. Their URLs correctly identify the modified load case. The failure model is unchanged across the camera refinements.

Library behavior exercised in the live browser:

- Apply Marine crosswind: finish `canopy-denim`, light `coolbox`, load 0.90, strength 1.10, wind 2.00, half speed, oblique camera and concrete hall all applied together.
- Save Marine crosswind, show Favorites, reload, and confirm it remained saved and selected.
- Filter to Commander Academy, search “tear,” apply Anatomy of a tear, and clear the search.
- Keyboard Home/End navigation across all six preset categories; empty search results and recovery.
- Open the compact drawer while retaining the visible scene.
- Load and visually inspect new leather, brass, copper, forged iron and Cloudrest timber packs.
- On phone, open Load settings, change the bridge from Alpine river to Quiet wetland, close the inspector, and confirm the URL and visible selection.
- Ultra/Balanced transitions; studio navigation; model reset, release and history controls.
- Desktop captures at the browser’s native 1026 × 994 size and phone captures at 390 × 844. All three phone documents reported `scrollWidth === clientWidth === 390`. Temporary viewport overrides were cleared.

## Corrections found during review

1. The half/quarter-speed option values did not match the normalized numeric strings assigned by setup selection. They now show the actual applied speed.
2. Relative URLs inside CSS custom properties resolved under `/assets/` in production and produced blank swatches. URLs now resolve against the document before entering the custom property. Production computed styles and visible copper/iron samples were rechecked.
3. Native graphics initialization stalled in both the in-app browser and independent Chrome tab. A 12-second native initialization deadline now attempts Three.js’s WebGL 2 backend. Loading stages identify actual progress instead of an indefinite spinner.
4. The full collection now retains the scene’s last frame while it obscures the scene. The compact drawer continues live rendering.
5. A close camera exposed the canopy’s vertical clevis pin. It now spans the plates horizontally with washers and hex heads.
6. The press connection camera moved to an unobstructed side of the corner clamp. The bridge overview accounts for floating panel widths, and focus/resizing updates framing. Both towers were visibly retained in the 1026-pixel desktop overview.

## Limits

This session’s visual verification used **WebGL 2 compatibility rendering**, not a working native WebGPU adapter. Observed scene rates were roughly 2–11 fps depending on view and size; native GPU performance remains unverified in this session. The fallback uses fixed 2048-pixel shadows and a smaller AO buffer; native WebGPU keeps 4096-pixel shadows. The quality selector does not resize compiled shadow targets.

Current production console checks reported no application errors or warnings. Some browser-control calls timed out while changing studies; fresh accessibility state confirmed that navigation had completed. These automation timeouts are not presented as app exceptions or ignored as evidence of success.

These are authored comparative reduced models. Finishes and surroundings are visual; fixed machinery, bridge towers and terrain do not fail. Calibration, self-collision, hydraulics, fatigue, thermal behavior and water/structure coupling have not been added. The real-time scenes remain less photographic than the ImageGen references; human visual acceptance is open.

The [review gallery](review.html) contains original screenshots, relevant recorded states and links to the live studies. Earlier development captures are retained alongside production captures; the final camera corrections have their own captures. The v2 reference gallery remains unchanged.
