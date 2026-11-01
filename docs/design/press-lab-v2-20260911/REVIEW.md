# Metal press enhancement

Built from the new [imagegen visual target](mockup.png). The exact reference prompt and built-in generation mode are recorded in [imagegen-prompt.md](imagegen-prompt.md).

The workbench now offers 24 comparative metal profiles, 16 thickness shortcuts plus precise 0.5–20 mm input, 30 attachment configurations across 10 physical contact shapes, and 48 complete experiments. Configurations include compact/broad contact faces and rotated creases, beads, crosses and square punches. The footprint preview and envelope dimensions follow size and rotation. Form, Fracture and Compare filters combine with text search and display an empty state.

The new inspection card follows the displayed simulation snapshot. It shows actual maximum deflection, maximum permanent link stretch, broken connection count and X/Z center sections. Its orange section line breaks only where no adjacent surface triangle survives. Recorded history restores the earlier geometry, section continuity and readings; release is disabled in history until the user returns to Live. The alloy-specific strain display uses nominal in-plane yield/rupture thresholds and the current strength multiplier. Shear and bending connections retain their existing threshold multipliers.

Fracture boundaries have bright exposed metal edges, using the actual surviving topology rather than animated crack decals. The press has polished tooling/guide rods, a dedicated reflection environment and a closer phone contact camera. The inspection card collapses on initial phone load. The new mockup is available in the app's reference comparison dialog.

## Verification

- TypeScript check: passed.
- Existing press suite: 14/14 passed, including all 48 experiments at 120 Hz for 8 seconds plus unloading, fixed supports, finite positions, irreversible failures, pressure/thickness/speed/material comparisons and exact canopy/bridge regression fixtures.
- New inspection suite: 7/7 passed, including all 30 scaled/rotated visible-to-analytical contact configurations, complete material coverage, section connectivity and replay, alloy thresholds, permanent stretch and exterior rim exclusion.
- Native local IAB: WebGPU renderer and worker observed at desktop 1280 × 720 and phone 390 × 844. Phone document width remained 390 px. Setup controls, filtering, contact selection, forming, fracture, replay, unload and reference comparison exercised. No browser error logs returned on the final steel run.
- Steel / 2 mm / ball / 80% / 100 mm/s: at 2.00 s, 55.0 mm deflection, 13.8% maximum plastic stretch and zero broken connections. At 8.08 s, 584 broken connections, 153.0 mm maximum deflection and 8 gaps in the X center section; Z showed 14 gaps. Scrubbing to zero restored zero damage and an intact section. Replay release protection was verified.
- Copper / 2 mm / ball / 35% / 100 mm/s / 60 mm stroke / 0.5 s dwell: after automatic retraction at 3.88 s, 13.8 mm residual deflection, 10.8% maximum plastic stretch and zero broken connections.
- Hard copper with 7.3 mm custom thickness and the 45° diamond cartridge applied through the UI. The copper Compare search returned six matching experiments; choosing Annealed copper bowl applied its full independent settings.

## Scope and limits

This is an authored comparative PBD model. Original material coefficients, solver equations, contact kernels, checkpoint backend identities and non-press behavior were preserved. New material coefficients are authored comparisons, not certified alloy data. Pressure is a percentage of model drive capacity, not hydraulic bar or calibrated force. Plastic stretch is a connection metric; the model is not a calibrated continuum fracture/necking solver. The request's 10X wording is a quality direction, not a measured speedup.

Free disk space fell from roughly 56.8 GiB to 17.1 GiB during concurrent work. The phase retained approximately 1.9 MiB of design/test artifacts and used the existing development server for final verification. No production build, bulk asset copy, dependency installation, deployment, or Git commit was performed. The app runs on 127.0.0.1:5173 only. The source and generated concept are retained in this workspace.

Local browser use was scoped to this private localhost/native GPU application; the Browserless policy and prior private-transfer rejection were respected. No app build, private assets, cookies or browser profiles were transferred to a remote browser. Temporary viewport settings were reset after the phone check. Inline CUA screenshots in this task are the visual receipts.
