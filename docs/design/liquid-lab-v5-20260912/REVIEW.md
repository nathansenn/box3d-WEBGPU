# Liquid Lab V5 — experiment notebook

The lab now keeps full comparison curves, inputs, notes and review choices across reloads. Open **Analyze → Experiment notebook** to reopen a saved study or import a V4/V5 JSON report. The existing Run library remains separate and unchanged.

## Delivered

- Local notebook with titles, notes, save/update and validated JSON import. Switching reports or loading a case preserves edited notes first.
- A chosen baseline and movable comparison time, with actual recorded times, differences and percentage changes. Zero baselines and solid probes are handled explicitly.
- User-defined upper limits for depth, coverage and river floodplain area, evaluated against every-tick maxima in the recorded run.
- Final water-budget table and one-click loading of each case's original setup.
- JSON, measurement CSV and standalone HTML exports. The readable report includes notes, plots, comparisons, limits and reproduction settings; it has no scripts or remote assets.
- A compact drawer based on a fresh built-in imagegen reference. Collapsible notes preserve room for the chart on short screens; the phone layout keeps export actions available.

## Visual comparison

The generated reference supplies the ivory/teal palette, right-side notebook, editable title and notes, comparison chart and three-case readout. The implemented chart uses measured data rather than the mockup's illustrative numbers. The existing 3D river apparatus and section probes remain model-driven. This pass improves the notebook and review workflow; it does not claim a new photorealistic fluid renderer or pixel-exact reconstruction of the generated scene.

Inspected the actual app at 1280 × 720 and 390 × 844. The chart remains visible above the footer on the short desktop layout. Phone comparison controls, limits and the four-column budget have no horizontal overflow. Screenshots are saved alongside this review. The exported HTML also fits the phone width.

## Verification

- 98 tests pass: 77 notebook/report tests (including full reports for all 60 liquid presets), 12 existing analysis tests and 9 Run-library tests. Five rig round trips and HTML escaping received focused rechecks after final export changes.
- TypeScript and production build pass. Vite retains a warning about an existing shared rendering chunk over 500 kB.
- Dev browser: imported the actual V4 export, saved/reloaded notes and review choices, reopened V5 JSON, rejected invalid JSON without replacing the report, checked zero-baseline output and invalid limit handling, and verified edits survived loading a case and reloading.
- Production browser: native WebGPU renderer, fresh three-case worker comparison, report import, save and actual HTML download. No error or warning entries were captured for the compiled page during this check. Dev verification also exercised the WebGL fallback.
- Actual downloaded JSON, CSV and HTML are retained here. The CSV has 363 sample rows; the three-case report retains all measurements and settings.

The model remains a depth-averaged comparative simulation, not a calibrated engineering prediction. Study limits are user comparisons, not safety criteria. Imported reports are checked for format and consistency, not independently re-simulated. Notebook capacity is 12 reports or 2.5 million stored characters, subject to browser quota; failed writes preserve existing data and leave export available.

## Browser and storage scope

Local browser use was required for the private localhost build, native GPU rendering and local file import/download integration. One disposable task-owned IAB tab was used; no files or credentials were transferred to a remote browser. All listeners bind 127.0.0.1. Prior transfer/retention rejections were respected. User tabs and shared browser processes were untouched.

Disk headroom was 58 GiB initially and 54 GiB at final build verification, above the 50 GiB reserve. The production output is isolated in `/private/tmp/box3d-liquid-v5-build-20260912`; no existing build, source, user result or concurrent change was deleted.

Final cleanup: closed the owned QA tab, reset the temporary viewport, and stopped only the preview process on 5186. The development server remains on 127.0.0.1:5173; its final river/Analyze route was verified ready in the native browser. The compiled live river run reached 12.00 seconds, stopped supply and retained its recorded history.
