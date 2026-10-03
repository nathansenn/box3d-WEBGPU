# Bridge experiments V8 — comparison refinement

Completed September 17, 2026. Continues the V7 experiment desk and existing V5 generated reference. No new imagery, geometry or solver changes.

## Delivered

- Select or pin one recorded case as the comparison reference. A REF badge identifies it in Table and Chart rows. The reference stays selected while choosing other cases or switching views.
- Selected-case details compare drop, sideways movement and lost links with signed differences. Captions name both cases and identify peak/final versus same-time measurements. Differences use full precision before display rounding; full values remain in cell titles.
- The existing time probe now accepts an exact numeric time. Values snap to the 0.1 s recording grid and clamp to the planned duration. Empty/invalid input restores the previous reading instead of changing it.
- Different recording durations cannot silently produce a peak comparison. A shortcut selects the last sample shared by both recordings. Missing data is not extrapolated; unrun cases cannot be pinned.

The comparison reference is a view choice for the current scan. It resets on a new scan, clearing, or reloading the view. It does not alter the persistent Inspect baseline or the raw scan export format.

## Critique addressed

| Finding | Change | Evidence |
| --- | --- | --- |
| Comparing rows required mental subtraction | Added named reference, actual values and signed differences in case details | `compiled-comparison.png`, `compiled-comparison.txt` |
| Slider made one exact sample awkward to choose | Added numeric input alongside the slider | Input accepted 7.7; 7.77 became 7.8, 31 became 30.0, −1 became 0.0; empty input kept 0.0 |
| Whole-record peaks could mislead when a run was canceled | Refuse unequal-duration peaks and offer an actual shared sample | `partial-comparison-before.txt`, `partial-comparison-after.txt` |
| Additional controls could crowd the five-row overview | Kept comparison controls in selected-case details | `compiled-overview.png`, `compiled-overview-bounds.json` |

Scene visibility and existing orange action / teal measurement styling are retained. The comparison uses signs and text as well as color. Numeric cells were enlarged within the detail table; the 390 px phone layout retains all four columns and 42 px reference controls. This is a targeted refinement, not a new full accessibility audit.

## Verification

- **45 focused tests passed**, including four new reference comparison tests: exact channels, signed/zero differences, duration mismatch and shared samples, missing/unrun/running cases. Tests also retain production-runtime equivalence and existing bridge geometry coverage. `tests.log`.
- **TypeScript passed**, and the final code-only **Vite build passed**. Existing large-chunk warning remains. `typecheck.log`, `build.log`.
- Fresh development and compiled worker scans each ran five 30-second cases. All case records and summaries match exactly across **1,505 samples**. Actual UI exports are `dev-load-30s.json` and `compiled-load-30s.json`.
- At 7.7 s, Load 5.00 against Load 0.80 showed drop **0.307 / 0.210 / +0.097**, sideways **0.218 / 0.020 / +0.199**, lost links **1 / 0 / +1**. Raw exported values confirm the differences in `verification.json`.
- Selecting Load 0.20 against the retained Load 0.80 reference produced negative displacement differences and a zero lost-link difference. Selecting the reference itself explains that another case should be chosen. Home/End case navigation and Table/Chart switching preserved the chosen reference and time.
- Actual Strength 60 s cancellation retained one completed case (60 s), one partial case (10 s), and three unrun cases. Peak comparison explicitly reported the duration mismatch. Its shared-time shortcut selected 10.0 s and showed differences **0.000 drop, −5.203 sideways, −23 lost links**. At 60 s the partial case showed no paired readings. `dev-partial-strength-60s.json`.
- Desktop **1280 × 720** retains all five initial overview rows within the desk. Phone **390 × 844** has document width 390, a 294 px comparison table and 42 px reference controls. `compiled-overview-bounds.json`, `phone-bounds.json`, `phone-comparison.png`.
- Native **WebGPU + worker** rendered in both development and compiled checks. Warning/error logs captured for both were empty. Observed frame rates are not benchmark claims.
- The live scene remained at 0.00 s through the independent scans and probe interactions. The probe displays recorded numeric readings, not experiment geometry playback. The existing authored comparative model remains uncalibrated.

## Scope and cleanup

The local native/loopback exception is recorded in PLAN.md. One disposable IAB tab was used; it was closed and the viewport override reset. Only scans created in this QA pass were cleared. No user baseline was created, overwritten or cleared. The temporary compiled preview on **127.0.0.1:5186** was stopped. The development preview remains on **127.0.0.1:5173**, PID **15688**, with HTTP 200 verified at completion.

The shared checkout and historical build/evidence directories were preserved. No installs, Git staging, commits, publishing, private transfers or unrelated deletions occurred. Code-only compilation links existing public assets and does not copy them. Build plus evidence measured about **9.52 MB** before this small report. Shared free space fell from 8.6 GiB to 6.4 GiB during the pass; no further large work was started. `cleanup.json` and `source-hashes.json` retain the final receipts.
