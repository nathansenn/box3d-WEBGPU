# Metal press V3 — implementation and review

The press now has 24 authored metal profiles, 16 thickness shortcuts across 0.5–20 mm, 12 working-tool shapes, 36 attachment configurations and 54 complete experiments. This pass adds hexagonal and capsule working faces, six cartridges and six experiments to V2. Strike speed remains independently adjustable from 2–250 mm/s, drive pressure from 0–100% of model capacity, depth from 5–140 mm, and hold from 0–10 seconds.

## What changed

- Pressure changes preserve the current specimen, clock and recording. Zero pressure requests retraction; after the tool retracts, further pressure changes apply to the next stroke. Metal, thickness, tooling, speed, depth and hold changes explicitly start a fresh specimen.
- Replay locks pressure/release controls and shows requested pressure from the corresponding recorded moment. The separate drive-level readout shows the solver's ramped value.
- X/Z section cuts can move across the sheet. The chart and visible orange section marker share snapshot positions and surviving connectivity. Off-center cracks do not become invented center cracks. Opening/closing the inspection card shows/hides the marker.
- The two new visible working faces match their analytical footprints at each size and rotation. The separate closed-solid contact API also recognizes both shapes. All cartridges are seated against their backing and shaft without the small gaps previously present on several tools.
- The new generated reference is available in the in-app comparison. Press reflections have a brighter base and an additional broad light panel. Laptop spacing makes all four stroke controls visible at 1280×720; mobile retains larger controls and a collapsible inspection card.

## Live review

Used the existing private localhost Vite server and native WebGPU/worker renderer in disposable in-app browser tabs. This is the bounded native-GPU/localhost exception documented in PLAN.md. No private app assets were transferred to Browserless.

- Desktop: 1280×720, contact and top cutaway views. Final hold-slider bottom was 512.5 px; footer started at 517.5 px. No horizontal overflow.
- Phone: 390×844, tooling/stroke controls, closed/open inspection, contact and top cutaway views. No horizontal overflow. Tested stainless 316 at 20 mm and the broad capsule cartridge: 1.30× size, 90° rotation, 278×109 mm envelope.
- Copper capsule: pressure changed from 65% to 40% within run 1. Recording grew from 22 to 29 samples while time advanced from 2.242 to 2.925 s. It did not reset. At 4.617 s, deflection was 94.724 mm with 63 broken connections. The center X slice had two gaps; the slice at Z −125.7 mm had none.
- Release: the same run completed at 7.575 s, retaining 60.6% maximum plastic connection stretch and 145 broken connections. Deflection recovered to 45.260 mm. Breakage continued during recovery; prior damage did not heal.
- Hexagon trial: the Aluminum 2024 / 0.8 mm / 30° preset completed with 411 broken connections and visible perforation in the top cutaway.
- Replay pressure: the gentle copper trial showed 38% requested pressure at 2.0 s and 65% at 6.5 s. Controls were disabled in replay. Returning to Live restored enabled controls at 65%.
- The new reference and current-geometry capture both loaded in the comparison dialog. Final fresh-load review reported `WebGPU renderer · worker`, `renderReady=true`, and no captured renderer errors.

Disposable tabs 3 and 4 were closed. The viewport override was reset, and the pre-existing bridge tab 1 was preserved. Vite remained bound to 127.0.0.1:5173, PID 67040. A sandboxed shell curl could not reach loopback; the native browser fresh-load check verified the preview itself.

## Verification and limits

Typecheck passed. The 14 press-lab tests and 21 contact/inspection/V3 tests passed, including all 54 experiments remaining finite, fixed supports, irreversible topology, original non-press trajectories, visible/contact matching, coupling continuity, section replay and pressure-command state retention. Test output is retained beside this review.

The generated image guided the scene, palette and controls; the real-time viewport remains a procedural approximation rather than a photographic match. The sheet uses the existing 33×29 simulation grid, and tears follow that topology. Material coefficients are authored comparisons and pressure is a drive percentage, not calibrated hydraulic pressure or force. The closed-solid query kernel remains separate from the Studio height-projection solver. No numerical performance multiplier or physical engineering validation is claimed.

Disk space was approximately 18 GiB at the start and 17 GiB near completion, below the shared 50 GiB reserve. No installation, production build, bulk render or deployment was performed. The image copy is about 1.83 MiB. No Git staging, commit or push was performed.
