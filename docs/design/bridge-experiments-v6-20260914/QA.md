# Bridge Experiments V6 — validation

Reference: the existing V5 imagegen mockup and its prompt, retained at `../bridge-experiments-v5-20260914/`. This pass refines the implemented workflow rather than generating another scene asset. Keep the woodland bridge, dark inspector, five case colors, orange run action and measured response chart.

## Changes

- Collapsible next-scan setup; frozen settings remain attached to the recorded result metadata. Starting a scan folds setup away; restoring a saved scan opens directly on its results.
- Completed / recorded-with-rupture counts and earliest actual rupture event. Pending cases do not count as observations. Partial cases remain explicitly partial.
- Deck drop, sideways movement and cumulative connection-loss charts. Connection loss uses steps rather than interpolated fractional counts.
- Optional keyboard-accessible time probe. Every readout comes from an actual 10 Hz sample. No interpolation, extrapolation or carry-forward beyond a partial record. Outcome labels explicitly refer to the full recording.
- Five case rows stay together, with numeric readings and comparison bars. Selection details follow the complete list. Arrow keys, Home and End select cases; keyboard focus scrolls into view. Selected-only scaling remains available.
- Static controls are updated only when their state changes. Completion is announced through the live status region without using extra visual space.

## Verification

- 39 focused tests passed: experiment engine isolation, exact fixed-tick measurements, cancellation, persistence, exports, new metric channels / sampling / summary semantics, bridge review and geometry regressions. See `tests.log`.
- TypeScript check passed. See `typecheck.log`.
- Production compilation passed, with the pre-existing large-chunk advisory. `copyPublicDir:false` kept output to 8 MB; local symlinks expose the existing public assets for QA, without duplicating the asset tree. This is a local compiled preview, not a deployment or portable release bundle.
- Dev runtime: actual WebGL 2 renderer plus worker. Load scan at strength 1.6 / wind 2 completed five 30-second cases, 301 samples each, while live time stayed 0.00 s. Peak drops: 0.132, 0.254, 0.320, 0.417, 6.200; final lost links: 0, 0, 0, 3, 28. Earliest rupture: 7.69 s, Load 5.00.
- Probe at 29.9 s showed lateral readings 0.002, 0.014, 0.054, 0.524, 3.923, exactly matching the rounded exported samples. See `load-30s.json` and `probe-lateral-29.9.txt`.
- Case 03 was selected using ArrowDown, isolated on the chart, promoted to a baseline and loaded into the live controls (URL target became 1.8). Inspect restored the named 30.0-second baseline after reload. See `case-actions.txt`, `baseline-restored.txt`.
- Next-scan setup changed to Strength / 60 s while the recorded Load / 30 s metadata and measurements remained unchanged. See `config-preserves-results.txt`.
- Strength / 60 s cancellation retained 91 samples through 9.0 s in case 01; other cases remained unrun. Overview showed 0 / 5 complete and 1 / 1 recorded with rupture. At a 60 s probe, all cases correctly showed no sample. The saved partial scan survived a source reload. See `partial-strength-60s.json` and `phone-partial-probe.png`.
- Desktop inspected at 1536×1024 and 1280×720. The larger view shows the graph and all five rows together. The shorter view uses denser controls and requires scrolling for remaining rows and details; the timeline stays beside the inspector.
- Phone inspected at 390×844: document scroll width exactly 390 px; case rows 318×52 px in the partial probe view; range hit area 32 px high. Setup, mode switches, probe and results are reachable in the scrollable desk. See `phone-setup.png`.
- Final compiled runtime also completed the five 30-second cases. Every case and sample in `compiled-load-30s.json` equals the development export; CSV contains five rows with the same loss counts. Console warnings/errors were empty (`compiled-console.json`).
- Compiled keyboard End selected case 05 and scrolled it into view: its button occupied y=577–611 within the desk's y=190.5–677 at 1280×720. Completion appeared in the accessible status region. No horizontal overflow (`compiled-dom.json`).
- The final compiled overview is shown in `compiled-comparison.png`. Renderer frame rates varied in the background IAB; this was functional and visual QA of the WebGL 2 fallback, not a frame-rate benchmark or native WebGPU qualification.

## Operational notes

Browserless policy exception: one disposable IAB tab for the private loopback app and GPU/solver interactions. No private asset transfer, remote upload, deliverable-retention override or new authentication session. Both development and QA listeners bind only 127.0.0.1.

Disk headroom was 38 GiB at recovery and 35 GiB at the final capacity check. This pass used small source changes, an 8 MB code build and bounded evidence captures. No large rendering, asset imports, duplicated public tree or unrelated deletion.

One cancellation click arrived after the scan had already completed. A new scan was started and cancelled in the same browser call to verify the partial path. One selector used the AX checkbox representation for an HTML pressed button and found no match; the visible AX target worked. A renderer-ready locator wait expired during initialization; the later live state confirmed readiness. Some screenshots immediately following several UI changes captured an older GPU paint; a later observation confirmed the final rendered state.

The previously empty baseline slot was used only for QA; that baseline and this pass's development scan were cleared through their UI controls. User tabs, recordings and unrelated workspace edits were preserved.

Final cleanup: compiled QA scan cleared through its own UI; viewport override reset; disposable IAB tab 9 closed; owned 127.0.0.1:5186 preview stopped. The development listener on 127.0.0.1:5173 remains available.

These are authored comparative simulations. Units and failure thresholds remain uncalibrated; the visual river does not apply structural forces. This pass does not change the bridge geometry or solver.
