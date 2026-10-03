# Reference fidelity verification — 9 September 2026

The StudiCraft reference workflow was applied to the original bridge, canopy and press images: freeze the references, diagnose the camera first, refine visible construction and materials, inspect alternate views, and retain a correction ledger. The bridge received the largest geometry and landscape refinement. Shared reference layouts and complete reference setups are available for all three studies.

[Open the comparison gallery](review.html) · [Open the bridge](http://127.0.0.1:5173/?studio=bridge&setup=setup-bridge-reference&layout=reference&quality=ultra) · [Correction ledger](../../project-architect/CORRECTION-LEDGER.md)

## Implemented

- Inferred reference cameras; compact study outline, experiment desk, visible response history and playback timeline; original/live comparison captures actual rendered geometry.
- Full-height bridge bracing, splice plates and bolts, column flanges, anchor clevises, coursed concrete and continuous bearing/grout stacks.
- Stones seated against the actual triangulated terrain; smaller broadleaf clusters, irregular conifer boughs and rooted bank planting.
- Shared downstream water motion, warped normal layers, restrained diffuse tint and environment/reflection lighting.
- 157 presets: 27 complete setups, 60 finishes, 21 lights, 30 loads, 11 cameras and 8 surroundings. The three new reference setups restore compatible camera, finish, light, surroundings and load choices.
- Portrait bridge framing includes both towers. The response workspace restores when returning to desktop, and the response canvas is constrained to its panel.

## Automated verification

83 checks passed: 26 failure tests, 44 preset tests, 7 river tests and 6 reference-geometry tests. TypeScript and the production build passed. The build retains the existing warning for minified chunks larger than 500 kB.

The new geometry checks independently raycast the terrain, verify transformed stone vertices and a deliberately floating negative control, check conifer winding and finite values, project key camera anchors, validate complete reference presets, and inspect fixture mesh geometry. The scene-graph verifier self-test passed all 11 checks. Its separate bearing-stack check passed with zero reported overlaps or consistency violations; it covers the 14 support objects only, not the full scene. See [bearing graph](bearing-scene-graph.json) and retained receipts.

## Browser observations

| Check | Observed result |
|---|---|
| Bridge progressive collapse | 30.01 s model time, 27 lost connections, 6.200 displayed deflection; deck collapsed and towers remained fixed |
| Bridge replay to start | 0.00 s, zero lost connections and intact geometry; recorded history retained |
| Canopy tearing | 30.08 s, 69 lost connections, 5.172 deflection; released cloth dropped to the floor |
| Canopy finish undo | Sage then Undo restored linen; 30.08 s and 69 lost connections were preserved |
| Plate punch-through | 30.05 s, 895 lost connections, 1.530 deflection and 25 events; sheet perforation and fragments visible |
| Plate load release | Target returned to zero while the 895 lost connections remained |
| Water animation | Frozen clock stayed at 74.137 across observations; resumed clock advanced to 94.325 |
| Comparison | Original image and a real 1423×972 viewport capture displayed with study, camera and model time |
| Responsive layout | 390×844 phone had no horizontal overflow and showed both towers; desktop restoration retained the response panel |
| Alternate views | Both towers visible from the reverse view; tower connections and riverbank contact inspected separately |

All three reference setups were exercised through the interface. Native WebGPU and the WebGL 2 fallback both initialized during this pass. Saved capture logs contain no warning or error entries. Displayed stationary rates were generally around 19–30 fps on this host, with slower transitions during compilation; these observations are not a controlled performance benchmark.

## Evidence scope and limits

The captures come from local production previews on loopback port 5174 across the correction passes. The final reference views use the final build. Some failure and alternate-angle captures precede the last layout-only corrections; their JSON records retain the exact script URLs and observed state. Build manifests identify those iterations. The development preview is left on loopback port 5173; the temporary production copy is removed after review.

The original three ImageGen references and `src/studio/physics.ts` retain their baseline SHA-256 hashes. No generated reference image is used as scene geometry or a scene background. Water motion remains a rendering effect and does not apply fluid forces to the bridge. Dimensions, material coefficients and failure thresholds remain authored assumptions in the existing comparative solver.

The resulting composition is closer, but fine foliage, bank detail, reflections and steel wear remain more stylized than the images. The checks establish the stated runtime and geometry properties, not calibrated structural analysis, photographic equivalence or human visual-match acceptance. Human visualMatch remains **not-accepted**.

Receipts and view records are stored in `receipts/` and `captures/` beside this file. The original image hashes are also retained in the baseline receipt.
