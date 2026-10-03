# Engineering Studio

Three live studies implement the selected ImageGen directions:

| Study | Local route | Failure mechanism |
| --- | --- | --- |
| Canopy / Precision Studio | `/?studio=canopy` | Pressure and wind strain the membrane; damaged connections tear and unsupported fabric falls. |
| Plate press / Research Atelier | `/?studio=plate` | A contacting punch plastically stretches the sheet, opens fractures, and leaves fragments on the bed. |
| Suspension bridge / Field Observatory | `/?studio=bridge` | Cable, hanger, and deck connections rupture under load; unsupported deck sections fall. |

`npm run dev` binds to **127.0.0.1**. The root URL opens the canopy. The previous workbench remains at `/?workbench=1`; other direct lab routes retain their existing implementation.

Choose **Ramp to failure**, then **Run simulation**. The applied load ramps toward the target at 0.55 normalized units per model second. **Service load** selects 0.80; the default failure program selects 4.00. Changing strength or crosswind changes the solver input. **Release load** removes the applied load without healing damage. **Reset** restores the original topology. The timeline seeks stored positions and broken-link states; **Play history** plays them and **Live** restores the latest live state. Camera orbit, fit, second angle, strain display, viewport capture, and run JSON export are available.

The default layout follows the Material Forge river proving ground: a large continuous scene, a compact **Experiment desk**, and a persistent playback bar. **Set up** searches the compatible complete experiments by name and intent; **Surface** previews specimen finishes; **World** groups lighting, surroundings and inspection views; **Test** holds the load recipes and solver controls. Hide the desk for a clear view. On phones, **Show experiment desk** opens the panel. **Results** reveals the recorded response chart and failure events.

The three visual treatments can still be selected independently in **World → Workspace treatment**. **Undo look** restores the last finish, lighting, surroundings, camera or water change without resetting time or damage. Applying a complete setup prepares a new run and clears appearance undo.

The bridge also offers three flow profiles adapted from the canonical river: **Bridge calm**, **Lessons Bridge**, and **Bridge rapids**. Tune flow speed, wave energy and foam independently, or freeze the current with **Animate flow**. Its private visual clock is separate from the structural clock. Each complete bridge setup defines a flow profile. Water tuning persists in the URL and run export. **River corridor** and **Riverbank detail** are bridge-only cameras. **Orbit automatically** is available for all studies.

**Presets** opens 157 curated entries: **27 complete scene setups, 60 finishes, 21 lighting treatments, 30 load recipes, 11 cameras and 8 surroundings**. Only compatible choices appear for the active study. A setup applies all five presentation/load choices together and prepares a fresh run after its material loads. View the scene, then press **Run simulation**.

Search by material, mood, purpose or workspace; filter by StudiCraft, HouseBuilder, Commander Academy or Material Forge. Star a card to save it in **Favorites**. **Recently used** retains the last 24 applied choices. These preferences stay in the current browser, with graceful recovery when storage is unavailable. **Keep scene visible** changes the library into a compact drawer on desktop.

Finish and surroundings choices affect appearance. A load recipe sets target, connection strength, wind and playback speed and resets the model. Manual load changes are marked **Custom load case**. Setup and individual choices are reflected in the URL; custom load values and playback speed also survive reloading. JSON exports include setup identity, exact settings, selected presentation and whether the load was modified.

The collection adapts local work from the four reviewed projects. Thirteen texture packs underpin the 60 appearance variants; these are not 60 independent scans. Five new packs have complete matched albedo, normal and roughness maps from Commander Academy. Surroundings offer four architectural hall palettes and four river/vegetation treatments. Connection, oblique and context cameras are joined by two river inspection cameras that appear only for the bridge.

**Focus on scene** hides surrounding panels while preserving playback. **Quality** offers full output resolution in Ultra and reduced output resolution in Balanced. Shadow targets remain fixed after creation: 4096 pixels with native WebGPU, 2048 in WebGL 2 compatibility mode. If native graphics initialization stalls for 12 seconds, the studio attempts Three.js’s WebGL 2 backend instead of keeping a permanent loading spinner. The backend is named in the footer.

See the [previous preset-pass gallery](design/quality-v3-20260908/review.html), [source review](design/quality-v3-20260908/SOURCE-REVIEW.md), [verification](design/quality-v3-20260908/VERIFICATION.md) and [previous reference comparison](design/quality-v2-20260908/review.html).

## Model boundary

These are deterministic, reduced position-based particle/constraint models in authored model units. They are not calibrated finite-element analyses or certified engineering predictions. Failure is caused by connection strain and accumulated damage, not by timed mesh visibility changes. The metal study also updates rest lengths to retain plastic set. Broken links stop applying corrections; surface triangles crossing those links are removed. Free nodes keep integrating and collide with the modeled floor or press bed.

Fixed test fixtures, bridge towers, terrain, and buildings are scenery/support boundaries. They do not themselves fail. Cloth self-collision, detached-fragment self-collision, volume-preserving sheet fracture, hydraulics, and water/structure interaction are not modeled. The water animation is visual context. The original native Box3D/WASM workbench remains separate; these three studies use the new CPU PBD failure core with the Three.js WebGPU renderer.

## Implementation and checks

- `src/studio/physics.ts`: shared, dependency-free model, dimensions, cameras, topology, damage, plasticity, events and snapshots.
- `src/studio/world.ts`: real fixture/landscape geometry, generated material textures, lights, shadows, ambient occlusion and antialiasing.
- `src/studio/main.ts` and `studio.css`: responsive interfaces, controls, replay, charts and exports.
- `src/studio/materials.ts` and `lighting.ts`: local PBR packs, authored finish combinations, photographic studio environment and coupled procedural HDR sky.
- `src/studio/scene-desk.ts` and `scene-desk.css`: live nonmodal experiment workflow, inline compatible presets, appearance undo and responsive controls.
- `src/studio/river-settings.ts` and `river-water.ts`: bounded flow profiles and an independent TSL water clock, reflection, shallow waves and bank foam.
- `src/studio/presets.ts`, `preset-browser.ts`, `collection-state.ts` and `collection.css`: complete compatible setups, searchable collections and validated local favorites/history.
- `tests/studio/failure.test.mjs`: 26 physics and attachment checks, including service-vs-overload, irreversible failure, plastic dent, deterministic replay and fixed supports.
- `tests/studio/presets.test.mjs`: 44 checks for texture provenance, compatible complete setups, validated local collections, safe fallbacks and all 30 load recipes running through the preserved solver.
- `tests/studio/river-workflow.test.mjs`: seven checks for flow profile and custom URL persistence, invalid input recovery, pause/resume timing, flow scaling and compatible cameras/setups.
- `docs/design/realism-20260908/`: original references, contracts, captures, exported run and comparison viewer.

Run `npm run typecheck`, `npm run test:studio`, `npm run test:studio:presets`, `npm run test:studio:river`, and `npm run build`. Node 22.18+ is required for the studio test's direct TypeScript import; the verified development runtime is Node 26.0.0.

The renderer initializes asynchronously and uses Three.js's WebGPU pipeline, with its built-in WebGL 2 fallback. The ambient-occlusion pass uses a single-sample depth target, followed by FXAA, to avoid sampling multisampled depth through the GTAO shader. See [Three.js WebGPURenderer documentation](https://threejs.org/manual/en/webgpurenderer).

Visual review remains separate from passing model/build checks. The generated designs are art direction; image text and example values are not authoritative engineering data.

## River workflow reference

Reviewed read-only: Material Forge `public/material-lab/commander-pbr-3d.html` and `academy-water-system-10x.js`. The adaptation preserves the source profile ratios (calm 0.50/0.34/0.24, Lessons Bridge 1/1/1, rapids 1.35/1.24/1.38), grouped controls, swatch browsing, hideable panel and inspection workflow. The full 840 m river, 500-material source catalog, five synchronized source clocks, spray and mist engine are not imported. BOX3D uses its existing compact landscape and a TSL water adaptation based on the installed Three.js r185 WaterMesh. No new texture payloads or dependencies were copied for this pass.


### Original-reference workspace

The **Reference** workspace keeps a compact inspection outline, the experiment desk, response chart and playback visible together on desktop. The **Reference canopy**, **Reference press** and **Reference crossing** setups restore the material, light, camera and service load as a complete starting point. **Compare reference** places the immutable ImageGen concept beside a capture of the current geometry and identifies its camera and model time.

The bridge pass adds full-height tower bracing, splice plates and bolt rows, bearing grout, anchor clevises, concrete lift joints, grounded stones, smaller woodland foliage clusters, individual conifer boughs and bank planting. Its river uses a common downstream clock with warped normal layers, shallow displacement and controllable bank foam. Reference daylight couples the sky, sun and reflection environment. Camera poses are inferred from the image; model dimensions and solver coefficients remain authored assumptions.

The StudiCraft process and evidence are recorded in [the reference-fidelity pass](design/studicraft-fidelity-20260909/VERIFICATION.md). Run `npm run test:studio:reference` for independent terrain raycasts, rotated rock contact, conifer winding and camera anchor checks. These checks do not establish calibrated structural behavior or human visual acceptance.
