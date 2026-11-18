# Metal press lab

Implemented a material and tooling workbench with 16 authored metal profiles, 16 thickness presets (0.5–20 mm), 10 interchangeable attachments and 20 prepared experiments. Stroke controls independently set model pressure (0–100%), approach speed (2–250 mm/s), depth (5–140 mm), hold time (0–10 s), attachment size and rotation.

The solver shares the attachment profile with the visible geometry. Pressure controls drive and contact compliance; thickness changes mass, membrane/bending resistance and the visible solid shell. Selected metal changes stiffness, yield and rupture. These are authored comparative coefficients. They are not calibrated alloy measurements or hydraulic pressure data. The display scale is 100 mm per scene unit.

The machine now includes a keyed coupling, telescoping piston, adjustable clamps, service cabinet, controls, hydraulic hoses, guide bushings, tooling rack and fixture hardware. Contact inspection and a labeled tooling cutaway expose the specimen. The top skin, underside and cut walls follow the surviving fracture topology. No detached sheet is painted over the viewport.

Changing a metal, thickness, tool or stroke setting starts a fresh run. Appearance-only Surface choices preserve history. All press parameters survive URLs and exports; snapshots retain tooling, ram travel, cycle state and pressure. A stroke holds and retracts when it reaches its depth; insufficient model pressure can stall the ram. Release load retains plastic deformation and broken connections. Final sampling stops on the completing fixed step.

## Verification

- 111 distinct checks passed: press (14), original failure tests (26), preset contracts (44), bridge/river/geometry checks (27). The complete 14-test press suite was repeated at handoff and passed.
- All 20 experiments produced finite states with fixed supports; all five Fracture presets generated ruptures and completed their cycles. Detailed outcomes are in fracture-presets.json.
- Canopy and bridge positions, broken topology and responses match the trajectories frozen before this change exactly. Whole-file physics hashes from earlier visual-only passes were replaced with these behavioral checks because this request intentionally changes press physics.
- The service-load regression now verifies permanent set and elastic recovery under pressure control, replacing the old displacement-controlled minimum dent magnitude.
- TypeScript and production build pass. The build retains Vite's existing large-chunk advisory.
- Production browser verification covers metal/thickness/tool changes, numeric pressure entry, preset search/application, full fracture, cutaway and replay to the intact first frame. Desktop and 390 × 844 phone captures are retained with URL and bundle identity.

The close-up shows the limits of the reduced sheet lattice: tear edges follow the mesh resolution. This is an interactive comparative forming/failure study, not an industrial press validation tool.


## Handoff integration

The local Vite server was restarted on 127.0.0.1:5173 and the enhanced press opened in a retained browser tab. Concurrent engine work added reusable snapshots and cached fracture topology after the frozen production review. All six affected geometry, replay, determinism and non-press regression checks passed against stable source hashes (handoff-integration.json). The complete press suite also passed again (handoff-press-tests.log).

A brief missing-normal-buffer startup error during that concurrent edit was resolved in the shared source. This task added the explicit Uint32Array type on borderPairs to resolve the remaining TypeScript generic mismatch; the full typecheck passed afterward. The recovered live press completed a default 80% / 50 mm/s stroke in 11.82 simulation seconds, retracted and reset successfully without new console errors.

The 14 production screenshots remain tied to the frozen build in runtime-receipts.json. Additional live development fracture and replay views are recorded separately. The owned temporary build was removed; source, installed dependencies, other tasks and the active local server were retained (cleanup.json).


## Stable review preview

The shared engine task subsequently began replacing additional modules, interrupting the development preview again. To keep this review usable, the final preview runs independently on **http://127.0.0.1:5185/?studio=plate**. Its code was restored from the existing source archive and all 11 recorded source hashes match the frozen press review exactly. A fresh build and typecheck passed in the isolated runtime. This build has new bundle names; its hashes are recorded in stable-preview.json rather than being conflated with the earlier capture bundle.

The isolated source and compiled runtime occupy approximately 10 MB; static assets and installed dependencies are reused through local links. The active runtime is retained at /private/tmp/box3d-press-stable-20260910. The shared checkout and engine task continue independently on port 5173.

The stable browser preview was confirmed at port 5185 with entry bundle index-C0KQgGr_.js, visible metal and tooling controls, and no errors from the stable origin. The retained tab also contains prior development error history from port 5173; stable-runtime-receipt.json separates those entries. The preview remains interactive, so the user can continue changing the selected specimen.
