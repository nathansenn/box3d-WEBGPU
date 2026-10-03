# Metal press V4 review

Implemented from the generated V4 concept: a four-step workbench (Metal, Tooling, Stroke, Runs), orange current and dashed cyan reference curves, paired specimen cards, measured comparison rows, a persistent Save comparison footer, yield/crack replay markers, and a compact pressure-program selector. The existing bend/fracture inspector still reads the displayed 3D snapshot and its actual connected surface.

## Coverage

The catalogue remains 24 metals, 16 thickness shortcuts with continuous 0.5–20 mm adjustment, 12 working faces, 36 attachment configurations, and 54 complete experiments. Strike speed is 2–250 mm/s; depth is 5–140 mm; hold is 0–10 s. Pressure is 0–100% of the authored model drive capacity.

Four pressure programs are available: Steady, Soft start (25% to 100% of the chosen limit over eight simulation seconds), Two-stage (35% for four seconds, then 100%), and Pulse (40% / 100% alternating every three seconds). Commands use exact solver ticks; manual pressure overrides select Steady and preserve the specimen and history. Choosing a new program or full experiment starts a fresh specimen. Complete experiments reset the program to Steady.

Run summaries retain settings, numerical backend, pressure programs, and bounded scalar response samples. Four runs fit within a 1 MiB storage envelope; geometry arrays stay in the live recording. Input validation rejects malformed stores and reconstructs metrics from validated samples. Current and reference values share chart axes. Partial runs use Last bend; completed runs use Final bend. Milestones refer to recorded geometry at 0.1 s intervals. Incomplete or imported geometry history disables onset shortcuts. Replay displays the pressure request and program active at that recorded time and locks pressure changes and saving.

Checkpoint export includes versioned pressure-program metadata alongside the existing full-precision solver checkpoint. Restored schedules continue on absolute simulation time. Existing solver backends, material coefficients, and physical contact faces were preserved.

## Visual review

The first runtime comparison showed flat grey guide rods. Reflection cards were all above the environment horizon, while the elevated camera reflected below it on vertical steel. Press-only cards now span both hemispheres. Polished steel has an explicit environment, controlled roughness, smooth 96-segment guide rods, and turned upper shoulders. All 36 tool connections remain continuously seated and retain their exact lower contact envelope.

The generated image contains illustrative numbers and an inconsistent tool label. The implementation uses the actual selected attachment and recorded response instead. It follows the reference's hierarchy and material direction; it is not a pixel-identical photographic reconstruction. The simulation remains a reduced, authored comparative model. Overload tears and fragments follow its lattice connectivity, not calibrated fracture mechanics.

On 1280 × 720, results scroll within the wider desk while the comparison actions remain visible. At 1536 × 1024, paired curves, specimen cards and measurements are visible together. At 390 × 844, the modal desk and pressure-program chooser fit without horizontal overflow; the comparison footer stays reachable. The press also passed a top cutaway visual inspection in the compiled application.

## Verification

45 unique press tests passed: 14 catalogue/physics, 8 inspection/tooling, 4 V3 behavior, 9 contact-kernel, and 10 V4 program/storage tests. After tooling and replay refinements, the affected 8 tooling tests and 14 program/replay tests passed again. Typecheck and the production Vite build passed. Vite reports an existing large-chunk advisory; no build errors occurred.

Native development QA used WebGPU with the worker solver. The compiled production preview selected WebGL 2 with the worker solver and completed a forming cycle; no browser console errors were reported. Production WebGPU selection was not established by that smoke check. No remote browser transfer or deployment occurred.

See verification.json for measured runs, responsive checks, process ownership, and cleanup. Screenshots and the generated reference are recorded in this task's tool transcript. Source hashes are in source-manifest.json.
