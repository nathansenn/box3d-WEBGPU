# Bridge experiment refinement V7 — verification

Completed September 15, 2026. This pass continues from the existing V5 generated reference. It improves the experiment desk and does not change bridge geometry or solver behavior.

## Delivered

- Table / Chart presentation switch. Table is the initial presentation on windows at most 800 px wide or 830 px high. Larger windows initially use Chart. A choice made in the current view survives resizing.
- Table compares peak drop, peak sideways movement and final lost connections together. Opening the probe shows all three actual readings at the selected time. Outcomes remain explicitly scoped to the complete retained recording.
- Case shortcuts select the first retained rupture sample, sampled peak drop, or final retained sample. The probe receives keyboard focus. Intact and unrecorded cases disable unavailable milestones.
- Native table headings, accessible case descriptions, full precision cell titles and existing arrow/Home/End navigation.

## Gates

| Check | Result |
| --- | --- |
| Focused bridge suite | 41 passed, 0 failed; includes two new retained-sample milestone tests |
| TypeScript | Passed |
| Vite compilation | Passed; existing large-chunk warning remains |
| Actual worker scan | Five fresh 30 s load cases completed with 1,505 total retained samples |
| Compiled / development agreement | All case fields and summaries match exactly; CSV values agree with JSON |
| Desktop 1280 × 720 | All five table rows and their three values visible; last row ends at y=673.67, desk edge y=677; no horizontal overflow |
| Desktop 1440 × 900 | Chart selected on initial load; lost-link step chart, selected-only scale and first-rupture probe inspected |
| Phone 390 × 844 | Table selected on initial load; document width 390; all numeric columns fit; results and case actions reached by normal vertical scrolling |
| Keyboard | Home selected CASE 01 from CASE 05; probe shortcut focused `bx-probe-time`; End moved probe to planned scan end |
| Canceled run | Strength 60 s scan stopped after 2.0 s in first case; one partial record and four pending cases retained and restored on reload |
| Missing data | At probe 60 s all 15 partial/pending cells showed em dashes; all pending-case milestones disabled |
| Load case | CASE 01 loaded target 0.2 with strength 1.6 and wind 2; confirmation visible |
| Console | Captured development and compiled warning/error logs were empty |

## Milestone evidence

For Load 5.00, strength 1.6, wind 2:

| Shortcut | Probe time | Drop | Sideways | Lost links |
| --- | --- | --- | --- | --- |
| First rupture | 7.7 s | 0.307 | 0.218 | 1 |
| Peak drop | 10.8 s | 6.200 | 2.905 | 16 |
| Record end | 30.0 s | 6.200 | 3.890 | 28 |

The solver's first rupture event is 7.691666666666839 s, displayed as 7.69 s. The shortcut intentionally selects its following retained sample at 7.7 s. `sample-verification.json` checks these observed values against the exported recording. A canceled case's Record end selected 2.0 s, not its planned 60 s duration.

## Evidence and scope

- `compiled-desktop-table.png`: final short desktop layout.
- `compiled-chart.png`: selected case step chart and rupture probe.
- `phone-table.png`, `phone-partial.png`: phone layout and partial-record controls.
- `dev-load-30s.json`, `dev-load-30s.csv`, `compiled-load-30s.json`: actual UI exports.
- `dev-partial-strength-60s.json`, `partial-probe.txt`: canceled run evidence.
- `sample-verification.json`, `compiled-verification.json`, `compiled-desktop-bounds.json`: comparison receipts.
- `tests.log`, `typecheck.log`, `build.log`, console files and `source-hashes.json`: code gates.

WebGPU with a worker was observed during the first development scan. The subsequent reload and compiled check used the application's WebGL 2 fallback with a worker. These are runtime observations, not GPU performance benchmarks. The probe displays recorded numeric measurements; it does not replay the experiment's geometry. The existing comparative model remains uncalibrated.

Local browser exception: private loopback backend plus GPU/worker interaction, as documented in PLAN.md. No remote upload or private-asset transfer was attempted. One owned disposable tab was used and closed, and its viewport override reset. Only QA-created scans were cleared; no user baseline was written or cleared. Compiled preview on 127.0.0.1:5186 was stopped. Development preview remains on 127.0.0.1:5173, PID 92848, with HTTP 200 verified at completion.

Capacity remained 20 GiB available. The build excludes public-directory copying and links existing assets for local QA; no new image render, asset duplication, dependency installation, Git staging, commit or publication occurred.
