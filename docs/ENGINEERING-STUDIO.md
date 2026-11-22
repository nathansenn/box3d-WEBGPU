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

Release browser test (`npm run test:browser:release`), 2026-11-17. Causes found and fixed:

- **It never tested WebGPU.** Chromium was started without `--enable-features=Vulkan --use-vulkan=swiftshader`, and without Vulkan every page's WebGPU device is lost at its first frame (all eight studies warned "The WebGPU device was lost on its first frame … Starting on the WebGL renderer"). The test now passes the two flags, as the other browser checks do; the WebGL fallback keeps its own check (`scripts/lab-webgl2-browser-check.mjs`).
- **The device-loss "flakes" were that loss.** The browser drops the WebGPU instance some time after the first frame, and the loss arrives by one of several roads: the `lost` promise with reason `destroyed` (silent), with reason `unknown` and "A valid external Instance reference no longer exists" (CI run 43931374185, the Physics Lab's return to `?studio=liquid`; locally the canopy), or rejected error scopes, "Instance dropped in popErrorScope" (the glass lab's failed check in an earlier run here). With Vulkan no device is lost. The material labs also had a bug on that road: their first-frame probe renderer kept three.js's default loss handler, which logs any reason but `destroyed` as an error. It now leaves a WebGPU loss to the probe (`watchDeviceLoss`) and keeps the default report for WebGL.
- **A lab reset recompiled its pipelines.** `MaterialLabWorld.setModel` disposed the apparatus before building the new one, so three.js released the render pipelines and compiled them again: 32 render pipelines per reset of the liquid lab (19 in the reset itself, 13 in the next frame), each seconds of SwiftShader time. The replaced apparatus is now disposed after the new one has drawn, and label materials are kept per text: 5 per reset remain, all for MeshBasicMaterials of the rebuilt liquid scene (not traced further).
- **Frames in flight.** The Studio and the labs drew a frame at every animation frame whatever the GPU still had queued: after a 5 s press run SwiftShader had 53 s of work queued, which every later screenshot waited for. The animation loop now draws only while fewer than two frames are on the GPU (`renderFrame`): 17 s.
- **What is left is the CPU.** SwiftShader draws on the CPU, in Chromium's GPU process. The liquid lab's frame took 5.4 to 7.6 s at 1028 × 742 and 0.9 s at a quarter of the pixels (load 22 to 25); the bridge's 0.84 s, 0.33 to 0.41 s at half and 0.09 to 0.16 s at a quarter of the pixels (load 12); the first frame drawn after an idle period took 12 to 30 s (liquid, press, bridge), the next ones about 1 s. Boots wait for the GPU process: the page's main thread was idle 88% of the press's 142 s boot, which compiles 45 render pipelines (the bridge 110). Clicks wait too although the main thread is idle (95% of a press run's samples): Playwright clicks once the button has kept its place for two animation frames, and the browser produces frames only as fast as the GPU process draws. CI's runner has its 4 cores to itself and passed the old budgets except for the bridge; this sandbox had a load average of 12 to 33 from other jobs. The budgets are now multiplied by the load average per core (at least 1, at most 8), measured before each page and written to the report (`loadFactor`), so CI keeps the old ones.

Final run here with these changes (load average 12 to 15 from other jobs, factors 2.9 to 5.5): liquid, glass, concrete, rubber, granular, canopy, the Physics Lab and the mobile page pass, with post-reset screenshots of 8.5 to 17 s in the labs and 53 s in the canopy; the press and the bridge fail their post-reset screenshots (over 59 s and 51 s; the press passed once in three runs), as the bridge does on CI. Before the changes, at load 24 to 30, liquid and granular failed their screenshots and plate, canopy, bridge, the Lab's return and the mobile page their 90 s boots.
Found later (2026-11-18): why the Studio's pages (canopy, press, bridge) took 50 s and more for a screenshot. A Chrome
trace of the press page (load 25 to 30) shows the GPU process's main thread inside WebGPU command-buffer flushes for 22 to
29 s each, three of them in 105 s, waiting for SwiftShader to finish the frames; compositing took 1.7 s in all. The frames
themselves were the cost, and not their pixels: a press frame took 25 to 75 s at 1080 x 610, at 540 x 305 and at 144 x 81
alike. Counting the GPU calls of one frame (5 render passes, 66 draws, 1.6 MB of buffer writes) found the reason: the sun's
shadow pass drew into a 4096 x 4096 colour and depth target (three.js gives a shadow map a colour attachment too), 16.8 M
texels against the view's 0.66 M, every frame. The material labs use 2048. Side by side at load 25, a press frame took 19 to
21 s with the 4096 map and 7.6 to 8.0 s with a 1024 one. The earlier
estimate of about 1 s per frame does not hold at this load. Fixed by (see Rendering below): the shadow map is drawn again only when something casting a
shadow moves; a software adapter gets a 1024 map; a still scene is not redrawn; and dynamic resolution.

## Rendering: dynamic resolution and on-demand frames

Release browser test after these changes, two runs here at load 14 to 25 (factors 3.3 to 5.4): every page passes. Two runs (post-reset screenshot; boot): liquid 1.7 / 3.2 s (75 / 68 s), glass 2.0 / 0.7 s, concrete 1.4 / 1.7 s, rubber 1.7 / 1.0 s, granular 4.0 / 2.2 s, press 5.4 / 5.4 s (99 / 98 s), canopy 5.1 / 6.9 s (77 / 80 s), bridge 48 / 46 s (153 / 170 s; its budget there 66 / 61 s), the Physics Lab and the mobile page pass. Before, at load 12 to 15: labs 8.5 to 17 s, canopy 53 s, press and bridge failed (over 59 and 51 s). The bridge stays the slowest: one of its frames (1080 x 610, 1024 shadow map, load 19) draws 49 M indices in 111 draws of 138,050 instances, the valley's trees, shrubs, ferns, sedge and gravel in the shadow, view and river-reflection passes, and took 22 to 25 s; thinning that vegetation on software adapters is not done.

Frame cost under SwiftShader, before (5f0454d) and after, each study at its default address (`?studio=<id>`, Ultra) and four Lab examples, Run pressed, frames completed in 30 s and their median GPU latency (first submit to `onSubmittedWorkDone`), the two builds interleaved at load 14 to 24: liquid 7 frames, 8.1 s → 23, 1.8 s; glass 12, 4.2 s → 43, 0.9 s; concrete 9, 6.2 s → 33, 1.3 s; rubber 12, 5.2 s → 30, 0.9 s; granular 6, 10.2 s → 14, 3.4 s; press 1, 39.7 s → 10, 6.1 s; canopy 2, 31.0 s → 11, 5.4 s; bridge 0 → 1, 20.6 s; Lab titan-bend-dent 7, 7.7 s → 22, 2.3 s; tempest-flag 12, 7.3 s → 46, 1.6 s; tsunami-flume 12, 7.0 s → 40, 1.8 s; heavy-pendulum 13, 6.4 s → 59, 1.3 s. After, the software adapter ran the Studio at ratio 0.35 to 0.5 and the Lab at scale 0.5. Captures of each default view, before at full and after at the reduced resolution, keep the composition, materials and lighting; the image is softer, small labels become unreadable at 0.5, and shadows are softer with the 1024 map. Six Lab examples (domino-run, ragdoll, moored-buoy, rubber-pad, sphere-settling, dam-break) stepped to tick 900 hash the same at scale 0.35 (288 x 162) and 1 (824 x 463).

- **Dynamic resolution** (`src/perf/dynamic-resolution.ts`). The drawing buffer's pixel ratio moves between 0.5 and the
  quality setting's ratio (Ultra: devicePixelRatio up to 2; Balanced: 0.75 of it, at most 1.25) to hold 14 ms of GPU time
  per frame, measured as the submit-to-done latency of frames sent to an idle queue (WebGPU) or the presented-frame
  interval (WebGL, vsync-locked, so it only sees missed frames). Four samples above 1.2 times the target lower the ratio
  by sqrt(target / cost) (cost goes with the pixel count), at most to 0.6 of it per step; 45 samples below 0.6 times the
  target (120 intervals) raise it by 0.05, and that run doubles after each raise that was undone. Ratios stay on a 0.05
  grid so a render target is not reallocated for a 1% change. On a software adapter (`adapterInfo` names SwiftShader or a
  fallback adapter; for WebGL the unmasked renderer string) it starts at 0.5 and may go to 0.35, the floor a real GPU never
  passes. `?resolution=<ratio>` fixes the ratio, `?adaptive=0` keeps the quality ratio. The canvas reports
  `data-render-ratio`, `data-render-scale`, `data-dynamic-resolution` and `data-software-adapter`. Viewport captures and
  the comparison image draw one frame at the quality ratio and read it in the same task, so they keep full resolution.
  The ratio is a rendering setting only: no solver file reads it (`tests/studio/dynamic-resolution.test.mjs` checks the
  sources), and the Lab's examples hash the same at 0.35 and at full scale.
- **Frames on demand.** The Studio and the material labs draw when something changed (a snapshot, the camera, a setting,
  a resize) plus three frames after it (one on a software adapter), or while something moves on its own (the river,
  orbiting, damped camera motion), and redraw a still scene once a second (every 30 s on a software adapter) for changes no
  setter reports. On a software adapter the river moves with the frames something else asks for instead of on its own.
- **Shadow map reuse.** The sun's (the labs' key light's) shadow map is drawn only after something that casts a shadow
  moved or the light changed; camera moves reuse it. A software adapter gets a 1024 map instead of 4096 (the shadows are
  softer there).
- **Liquid lab resets** compile no render pipeline (5 before, 32 before 2026-11-17): an instanced mesh of at most 1024
  instances keeps its matrices in a uniform buffer that three.js names after the node (`NodeBuffer_<id>`) in the shader, so
  each new foam, current, rain or drop mesh was a new shader. The world keeps those four meshes across resets.
- **Accessibility.** Readout colours meet 4.5:1 on their panels (atelier `--muted` #5f6862 and `--dim` #666e69, dark
  `--dim` #86918f, labs `--muted` #687068, liquid #5f6f6f; they were 3.1 to 4.2:1), search fields show focus on their box,
  the material labs have a focus ring in the ink colour, and `tests/studio/accessibility.test.mjs` (in `test:studio`)
  checks names of icon-only buttons, labels of form controls, the canvases' role and description, the absence of positive
  tabindex, and those contrasts.

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
