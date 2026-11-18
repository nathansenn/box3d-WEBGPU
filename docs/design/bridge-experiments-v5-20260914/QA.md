# Bridge Experiments V5

Implemented September 14, 2026. Analyze now has Inspect and Experiments modes. Three scans vary load, strength or crosswind across five independent cases, for 15, 30 or 60 model seconds. Results include response curves, a rescaled selected-case view, first rupture, sampled peak drop and lateral movement, complete broken-link counts and model phase. Cases can restore their starting controls or become the existing Inspect baseline. CSV exports summaries; JSON also includes every response sample and the model basis.

## Visual reference

Built-in image_gen generated `mockup.png` using the verified V4 screenshot as a reference. `PROMPT.md` records the exact prompt. The app Reference picker includes the new concept; the consumed asset is `public/studio/references/bridge-v5-experiments.png`.

The implementation follows the large river scene, dark inspector, internal mode segments, three scan buttons, fixed-settings strip, shared chart and expandable colored rows. Desktop uses a wider experiment inspector and moves the live timeline beside it. On smaller screens, results scroll inside the panel and mode buttons remain accessible. Actual solver data replaces the concept's illustrative curves and numbers; recorded drop is plotted as a positive magnitude. This is a functional adaptation, not a pixel-identical scene reconstruction.

## Verification

| Check | Evidence |
| --- | --- |
| Focused tests | 36 passed in `tests.log`: 11 experiment tests, 11 prior review tests and 14 bridge road/scene checks |
| TypeScript | `typecheck.log` passed |
| Production build | `build.log` passed; existing large-chunk advisory remains |
| Solver isolation | Direct production-runtime comparison is identical at fixed ticks. Tests prove initial intact state, no live model mutation, complete samples and released loans |
| Load scan | Actual worker execution: five cases × 30 seconds, 301 points per case, live scene stayed at 0.00 s. Downloaded JSON and CSV retained |
| Strength scan | Actual worker execution: five cases × 60 seconds, 601 points per case; `strength-60s-completed.json` |
| Crosswind scan | Actual phone interaction: five cases × 15 seconds, 151 points per case; `wind-15s-completed.json` |
| Cancel | Immediate UI cancellation retained 14 seconds / 141 points in case 1; four cases explicitly not run. `strength-60s-cancelled.json` and `cancelled-scan.png` |
| Navigation teardown | Switching to Canopy during a scan cancelled it and retained 13 seconds / 131 points. Returning to the bridge restored that partial scan; `navigation-cancellation.txt`, `wind-60s-cancelled.json` |
| Persistence | Completed scans survived HMR/reload; cancelled scans survived reload and a resumed task session. Damaged, oversized and incompatible storage rejected by tests |
| Baseline integration | Load 5.00 / 30.0 s promoted to Inspect. Loading case 0.80 restored URL controls; live test at 5.41 s compared to baseline sample 5.40 s. `baseline-comparison.txt` |
| Export | Actual browser files parsed: five CSV rows and five JSON series, matching first-rupture values. The browser download event observer timed out once, but the file existed and its contents were verified |
| Small-response inspection | Selected-only chart rescaled case 0.80 to show its oscillation; `selected-response.png` |
| Phone | 390×844, scrollWidth 390, no horizontal overflow; mode buttons 154.5×40. All scan types/durations, result selection, scrolling, notes and Home/End mode navigation exercised; `phone-controls.png`, `phone-results.png` |
| Desktop | 1280×720 and 1536×1024 inspected. Larger inspector preserves scene framing and scrolling results |
| Failure/error paths | Unit tests cover mid-case cancellation, pre-initialization cancellation, reset failure preserving completed cases, cleanup, invalid inputs and partial exports |

The load scan used target values 0.20, 0.80, 1.80, 3.20 and 5.00, with strength 1.60 and wind 2.00. Recorded outcomes were respectively no rupture, no rupture, no rupture, rupture and collapse. Case 3.20 first ruptured at 9.0917 s and lost 3 links. Case 5.00 first ruptured at 7.6917 s, reached 6.200 model units of drop and lost 28 links by 30 s. These observations describe this authored model and recording interval.

## Operation and limits

Choose Analyze → Experiments, select a scan and duration, then Run 5 experiments. Other load settings are frozen from Test at the start. Every case starts intact and uses the existing 120 Hz solver with 10 Hz recording. Playback speed affects the live view, not fixed-tick experiment results. Pause live playback before starting a batch. Cancel retains measurements; each new scan replaces the locally saved result set once samples are available, so export results you want to keep.

Load case restores settings; run the live simulation to inspect geometry. Use as baseline stores response samples for time-matched comparison in Inspect. Neither experiment export nor baseline export is a resumable geometry checkpoint; use the existing Export evidence workflow for resumable live runs.

The solver remains an authored comparative model with uncalibrated units and failure thresholds. No safe-load rating or physical design acceptance is implied. River appearance does not apply hydrodynamic forces. Peak measurements are sampled peaks, not a claim of continuous maxima.

Local native browser exception: private localhost app, native GPU rendering and interactive solver verification. The previous private build transfer rejection was respected; no Browserless upload or retention mark was attempted. Only one disposable local tab was used at a time. The resumed task found the original QA tab and preview processes already gone and restarted local previews. All listeners bind 127.0.0.1. No dependencies were installed, no deployment or Git publication was performed, and concurrent edits were preserved.

Development-origin synthetic scan and baseline data were cleared through the UI after exports.

## Final compiled verification

The final production build rendered at 1280×720 using WebGL 2 plus the production worker. It completed five 30-second load cases. The actual downloaded `compiled-load-scan.json` contains case records identical to the development export, including all 301 samples per case, rupture times and final counts. The live scene remained at 0.00 s. `compiled-results.png` captures the high-load case, and `compiled-ready.png` captures the scene and experiment controls. `compiled-console.json` is an empty warning/error list.

The generated concept loaded in the Reference dialog and Match camera worked; see `reference-comparison.png`. Hiding the inspector restored a 1174 px timeline at the 1280 px viewport, so scene controls use the released space. The compiled synthetic scan was cleared through its UI afterward; `compiled-final.txt` shows the empty state and enabled Run controls. Source and reference hashes are in `source-hashes.json`.

Cleanup: the earlier disposable tab 6 had already disappeared when the user continued. Final disposable tab 7 was closed, viewport overrides reset, and the QA listener on 5186 was stopped. User tabs and authenticated sessions were preserved. The development preview remains on **127.0.0.1:5173**, PID **31956** at handoff. Local free space was about 51 GiB in the final resumed session; only small receipts and existing preview builds were used. No large imports or installations were started.
