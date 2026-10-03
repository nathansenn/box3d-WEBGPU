# Bridge experiments V9 — configurable engineering studies

Completed September 17, 2026. This extends the bridge experiment workflow and existing visual reference. It does not change bridge geometry, materials, or the structural solver.

## Delivered

- **Ten study presets:** load overview, low load, high load, extended load observation, strength overview, reduced connection strength, increased connection strength, crosswind overview, light crosswind, and strong crosswind.
- **Custom ranges:** 3, 5, 7 or 9 distinct, increasing cases. Values use up to four decimal places. The exact generated settings and total model time are shown before starting. Invalid, reversed, out-of-bounds or indistinguishably narrow ranges cannot run.
- **Editable held settings:** change the controls held constant without changing the live scene. A reset uses the live scene settings. The setup labels whether settings are custom/retained or come from the live scene.
- **15 / 30 / 60 / 120 model-second recordings.** Extended observations preserve the existing fixed-tick solver. They are not fatigue tests. The baseline parser now accepts a full 120-second experiment for Inspect comparisons.
- **Focused follow-ups:** adjacent completed cases with different observed rupture outcomes offer a five-case scan of their interval. Staging retains the original held settings and duration and leaves current recordings intact until Run. Multiple or reversed transitions are supported without assuming monotonic failure. Partial, unrun and running cases cannot define a transition.
- **Samples CSV:** every retained 0.1-second sample, actual applied load, drop, sideways movement, lost links, case settings, recording status, model and units. Summary CSV and full JSON remain available. Unrun/future samples are omitted. Download status now says "requested" because the page cannot confirm browser filesystem delivery.
- **Compatibility and persistence:** original version-1 five-case scans still restore. New version-2 scans retain the design and preset identity. Interrupted scans retain their completed prefix and optional partial case. Invalid stored ordering, including a partial recording after an unrun case, is rejected.

Setup stays collapsible and its Run action remains reachable while scrolling. Existing table/chart, exact probes, references, baseline promotion and keyboard navigation now accommodate up to nine cases.

## Verification

**55 focused tests passed**, zero failures, with a single test worker. Coverage includes all ten presets, range/count bounds, fine-value labels, one-variable isolation, actual nine-case solver runs, actual 120-second recordings and baseline parsing, old-scan compatibility, follow-up provenance and non-monotonic outcomes, partial-state validation, exact exports, references, and existing bridge geometry. See `tests.log`.

TypeScript and the final code-only Vite build passed. The existing large-chunk advisory remains. See `typecheck.log`, `build.log`, and `source-hashes.json`. The final build was reloaded after the saved-order validation correction and successfully restored the valid nine-case cancelled scan: `final-build-restored.json`.

### Actual development scan and exports

- Nine load cases from 0 to 5 at strength 1.6, wind 0 and 15 model seconds completed in the production worker. There are **1,359 samples**.
- Every sample CSV numeric value was checked against the downloaded JSON. All nine summary rows also match the raw record. `dev-verification.json`, `dev-nine-load-15s.json`, `dev-nine-load-15s-samples.csv`, `dev-nine-load-15s-summary.csv`.
- The 4.375 case had no recorded rupture; the 5.00 case recorded rupture at about 9.59 s. The follow-up staged `[4.375, 4.5313, 4.6875, 4.8438, 5]`, retained strength 1.6 / wind 0 / 15 s, and left all nine original result rows available before Run.
- That actual five-case follow-up completed with **755 samples**. Cases 4.8438 and 5 recorded rupture; the next observed interval was 4.6875–4.8438. Reloading restored its exact range and held settings. `dev-followup-15s.json`, `followup-staged.txt`, `followup-results.txt`, `desktop-followup.png`.
- Invalid range and wind 3 produced specific inline errors and disabled Run. Switching to Light crosswind populated its preset values. End-key navigation reached the ninth case and retained the reference comparison.

### Compiled UI and partial recordings

- A fresh compiled nine-case 15-second worker scan completed. Its visible summary readings matched the development scan. This is a visible-summary check, **not** a full raw-record parity claim; see the download limitation below.
- Three 120-second compiled cases completed. The exact probe reached 120.0 s with real recorded readings. `compiled-long-run.txt`, `compiled-120s-probe.txt`, `desktop-120s-chart.png`.
- Cancelling a nine-case 120-second scan retained **four completed 120-second cases, one 70-second partial case, and four unrun cases**. Unequal-duration peak comparison was refused. Its shared-time shortcut selected 70.0 s; probing at 120 s showed no paired sample for the partial case. Both the initial and final compiled builds restored the correct cancelled state. `compiled-cancelled-nine.txt`, `compiled-cancelled-probe.txt`, `cancelled-restored.json`, `final-build-restored.json`.
- Desktop viewport 1280 × 720 and phone viewport 390 × 844 were checked. Phone document width and scroll width were both 390; the comparison table was 294 px wide, with 42 px reference controls and 42 px setup inputs. Longer lists use vertical scrolling. `phone-bounds.json`, `phone-setup.png`, `phone-comparison.png`.
- Native WebGPU + worker was observed. The live scene remained at 0.00 s throughout independent experiments. Captured warning/error logs were empty: `dev-console.json`, `compiled-console.json`. Displayed frame rates are not performance benchmark claims.

## Verification limitation

The development browser produced JSON, summary CSV and sample CSV downloads that were read back and checked. In the compiled in-app preview on port 5186, clicking JSON invoked the page handler but no corresponding file or download event was received. The cause remains unconfirmed. A request to inspect a possible native prompt through the Codex app was denied by the computer-use tool's app safety restriction; that native surface was not accessed by another route. Permitted page controls and the recorded UI remained usable. No full compiled JSON parity claim is made. The product text was corrected to report a download request rather than claiming a file was saved.

The model remains authored and comparative, with uncalibrated units and failure thresholds. "No rupture observed" applies only to the recorded interval. Surrounding water does not apply river forces. The follow-up interval is not a safe-load rating. No new physical qualification, fatigue model, image generation, deployment or release is claimed.

## Ownership and cleanup

The private loopback/native exception is recorded in `PLAN.md`; no private build, asset, profile or credential was transferred. One owned IAB tab (4) was used and closed. Viewport overrides were reset. Existing tabs 1, 2 and 3 were preserved. Only this pass's QA scans were cleared; no Inspect baseline or live recording was changed.

The owned compiled preview on 127.0.0.1:5186 was stopped. The development preview remains at **127.0.0.1:5173**, PID **29361**, with HTTP 200 verified. The code-only build remains at `/private/tmp/box3d-bridge-experiments-v9-code-build-20260917`; public assets are linked, not copied. Build and evidence sizes are in `cleanup.json`. Empty task-owned test temporary storage was removed after its process exited. Shared source, historical builds, assets and rollback evidence were preserved. No installs, staging, commits, pushes or publishing occurred.

Shared free space fell from 2.8 GiB to roughly 296 MiB at the final receipt during this turn. Work stayed within the small output budget; no unrelated cleanup or reserve-only pause was performed. See `cleanup.json` for the exact final reading and attributable output sizes.
