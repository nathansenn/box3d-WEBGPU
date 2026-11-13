# Engineering Studio

Three live studies implement the selected ImageGen directions:

| Study | Local route | Failure mechanism |
| --- | --- | --- |
| Canopy / Precision Studio | `/?studio=canopy` | A PVC-coated polyester canopy on four posts with steel edge cables, on the calibrated SI cloth: library fabric, snow on plan in kPa and wind, tearing when a yarn reaches its strength ([`STUDIO_CANOPY.md`](STUDIO_CANOPY.md)). |
| Plate press / Research Atelier | `/?studio=plate` | An SI press brake: a punch air-bends an S355 or 6061-T6 sheet between two die shoulders on the J2 solid; it yields, springs back and cracks by ductile erosion ([`STUDIO_METAL_PRESS.md`](STUDIO_METAL_PRESS.md)). |
| Suspension bridge / Field Observatory | `/?studio=bridge` | SI model on the validated solvers ([SI_BRIDGE.md](SI_BRIDGE.md#suspension-footbridge-the-studio-bridge)): a crowd in kN/m², wind in kN/m and cut hangers; deflections in mm, tensions in kN, stresses in MPa. |

`npm run dev` binds to **127.0.0.1**. The root URL opens the liquid lab; `?studio=<id>` selects any of the eight studies, and historical `?lab=` links resolve to the matching study (`src/entry.ts`). The earlier AAA showcase UI (`src/main.ts`) is no longer linked from `index.html`.

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

The metal press runs the SI press brake ([`STUDIO_METAL_PRESS.md`](STUDIO_METAL_PRESS.md)) and the canopy the SI cloth ([`STUDIO_CANOPY.md`](STUDIO_CANOPY.md)). The other studies are deterministic, reduced position-based particle/constraint models in authored model units. They are not calibrated finite-element analyses or certified engineering predictions. Failure is caused by connection strain and accumulated damage, not by timed mesh visibility changes. The metal study also updates rest lengths to retain plastic set. Broken links stop applying corrections; surface triangles crossing those links are removed. Free nodes keep integrating and collide with the modeled floor or press bed.

Fixed test fixtures, bridge towers, terrain, and buildings are scenery/support boundaries. They do not themselves fail. Cloth self-collision, detached-fragment self-collision, volume-preserving sheet fracture and hydraulics are not modeled. The river does not load the bridge. The original native Box3D/WASM workbench remains separate; the canopy and plate studies use the CPU PBD failure core with the Three.js WebGPU renderer. The bridge study runs on the SI suspension model (`src/engine/si-suspension.ts`, [SI_BRIDGE.md](SI_BRIDGE.md#suspension-footbridge-the-studio-bridge)) in the same worker and renderer: its hangers fail by being cut or by exceeding their breaking force, and nothing falls into the river. The PBD bridge with its falling pieces and river splashes remains in `src/studio/physics.ts` for its frozen tests only.

## Scheduling: the solver runs free of the renderer

Every study's solver runs in its own worker and advances on its own schedule, toward wall-clock time; the page draws
the newest state the worker has published. Drawing speed no longer limits the model: before this, the page asked the
worker for at most 12 ticks (the press 2, the material labs 4 to 8) per drawn frame and waited for the answer, so under
software rendering (about 0.5 frames per second) a study advanced a few hundredths of a second of model time per wall
second whatever its solver cost.

- **Studio studies (canopy, press, bridge):** `src/engine/studio-run.ts` (`StudioRunLoop`), started by `client.run()`,
  paused by `client.pause()`, changed by `client.updateRun()` (`src/engine/studio-client.ts`, protocol in
  `studio-protocol.ts`, worker side in `studio-dispatcher.ts`). **Material labs (liquid, granular, elastomer, concrete,
  glass):** `src/studio/material-labs/lab-run.ts` (`LabRunLoop`, `LabRunChannel`), routed in both lab workers by
  `lab-run-host.ts`.
- **Pacing** (`src/perf/free-run.ts`, `FreeRunPacer`): the worker steps whole fixed ticks (1/120 s) until it reaches
  speed × wall time, never ahead of it. A backlog larger than 0.25 s of model time is dropped from the schedule (the
  model then runs slower than real time) and reported: `data-simulation-lag` and the footer ("Worker · 12.9 s behind
  wall time") give the simulated seconds dropped, and the export carries them (`clock.lagSeconds`, `clock.overloads`).
- **Publication:** the worker works in slices of about 24 ms, then handles messages, and publishes its newest state at
  most every 33 ms. A Studio frame is a live snapshot loan (at most three outstanding); a lab frame waits for the page to
  acknowledge the two before it. While the page holds every loan the worker keeps stepping and keeps every recording
  sample and event (up to 1,200 ticks, or 5 s of a lab), then waits; nothing is dropped.
- **Determinism:** every tick is the same fixed step as before; controls and the press pressure programme are applied
  at exact ticks; recording samples are taken every 12 ticks in the worker (labs: at their history cadence, in the
  worker). A run's result depends on its start state and on the ticks at which controls changed, not on frame rate or
  slicing (`tests/engine/studio-run.test.mjs`: a free run equals fixed stepping tick for tick, in the sync, worker and
  shared-memory transports; `tests/studio/lab-run.test.mjs` for the labs). The material labs now step 1/120 s at a time
  in the worker; they used to step a whole batch (up to 8/120 s) in one call, whose sub-stepping depended on the batch.
- **Pause, step, replay, export:** pausing stops the worker at its current tick and returns that state; the run's
  first rupture can stop it at the exact tick (bridge "pause on first rupture"); export pauses first.

Measured model seconds per wall second in headless Chromium on SwiftShader, built site, 30 s from **Run**, the old and
the new build alternated study by study on this shared 4-core machine at load average 20 to 30 (other jobs running;
the numbers are lower bounds and say nothing about a real GPU):

| Study | Before (driven by drawn frames) | After (free run) | Frames per second (after) | Solver alone in Node (model s per CPU s) |
| --- | --- | --- | --- | --- |
| Bridge (SI) | 0.026 | 0.29 | 0.5 | 2.0 to 2.5 |
| Metal press (SI) | 0.044 | 0.40 | 0.6 | 1.75 (approach included) |
| Canopy (SI cloth) | 0.001 | 0.053 | 0.5 | 0.55 |
| Liquid (flume) | 0.0045 | 0.087 | 0.5 | 0.46 |
| Granular | 0.0034 | 0.15 | 0.6 | 0.68 |
| Concrete | 0.0023 | 0.25 | 0.4 | 20 |
| Elastomer | 0.0032 | 0.29 | 0.9 | 0.55 |
| Glass | 0.0023 | 0.49 (reached its 12 s end) | 0.7 | 1.06 |

The after column is the solver on what CPU the loaded machine left it; the ratio to the before column (10 to 200) is
the scheduling change. The last column is the solver alone, `StudioRuntime.step` or `model.step(1/120)` in Node 22 on the
same machine (load average about 10): where it is below 1 the study is slower than real time even with a free worker,
and the footer says so. Script: a Playwright page per study, **Run**, then the scene time read every second for 30 s.

Release browser test (`npm run test:browser:release`) on this sandbox after these changes, load average 11 to 25 from
other jobs: concrete, rubber and the Physics Lab pass; the canopy and press now export (they failed with "no download"
before); the failures left are time limits: boots over 90 s (plate, bridge), page screenshots over 15 s after reset
(liquid, granular, canopy: a single drawn frame took up to 66 s), and one glass run whose replay check failed and passed
on a rerun. These were not fixed by raising limits and are not shown to pass three times in a row.

## Saved runs resume exactly

Every Studio study exports its exact checkpoint, and **Resume saved run** continues it bit for bit. The SI studies'
checkpoints (`STUDIO_PRESS_SI_BACKEND`, `STUDIO_CANOPY_SI_BACKEND`, `STUDIO_SI_BRIDGE_BACKEND`) carry the solver state in
`si`: a `checkpoint.ts` container of the press brake's `saveState()` (`PressBrake`), the cloth's (`Cloth`) or the
suspension bridge's (`SiSuspensionBridge`), with the adapter's fields captured by the field walker (a field neither saved
nor excluded refuses the checkpoint). In a file the container is gzip-packed (`siGzip`, `checkpoint-file.ts`): the whole
checkpoint is 1.3 MB for the press, 2.1 MB for the canopy and 4.8 MB for the bridge (11.9 MB unpacked, most of it the
frame's dense interface operators), under the 16 MiB import limit. Tests: `tests/studio/press-si.test.mjs`, `canopy-si.test.mjs` (also after tearing) and
`bridge-review.test.mjs` export, write, read back and resume, then compare the next ticks, their samples and events, and
the next checkpoint with the uninterrupted run; a checkpoint missing a solver field is refused.

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

The bridge pass adds full-height tower bracing, splice plates and bolt rows, bearing grout, anchor clevises, concrete lift joints, grounded stones, smaller woodland foliage clusters, individual conifer boughs and bank planting. Its river uses a common downstream clock with warped normal layers, shallow displacement and controllable bank foam. Reference daylight couples the sky, sun and reflection environment. Camera poses are inferred from the image. The bridge's dimensions are the Studio's; its sections and strengths are the SI model's stated assumptions (SI_BRIDGE.md).

The StudiCraft process and evidence are recorded in [the reference-fidelity pass](design/studicraft-fidelity-20260909/VERIFICATION.md). Run `npm run test:studio:reference` for independent terrain raycasts, rotated rock contact, conifer winding and camera anchor checks. These checks do not establish calibrated structural behavior or human visual acceptance.
