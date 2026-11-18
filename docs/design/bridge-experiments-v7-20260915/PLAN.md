# Bridge experiment refinement V7

Refine the current bridge comparison using the existing V5 imagegen reference and V6 implementation. The observed friction is that charts push remaining cases below the fold in short windows.

Add a compact Table / Chart presentation. Table shows deck drop, sideways movement and lost connections for all five cases together, using peaks by default or exact samples at the existing time probe. Default to Table for short desktop and phone windows; retain the chart for inspecting response shape. Include clear units and full-record outcome labels. Do not substitute sample-time outcomes for whole-record outcomes.

Add per-case shortcuts to the first recorded sample with rupture, the sampled peak drop and the last recorded sample. Distinguish solver event time from its subsequent 10 Hz sample. Keep partial records, cancellation, exports, frozen settings, baseline loading and keyboard navigation intact.

Acceptance: all five rows and three measurement columns fit the short-desktop initial result view; phone has no horizontal overflow; table/probe/chart agree with actual exported samples; event shortcuts use recorded points only; case actions and cancellation remain usable. Validate focused tests, typecheck, a bounded compilation and actual local rendering.

The checkout is shared and dirty. Own the experiment helper/view/styles, focused tests and this evidence directory. No staging, commits, resets, dependency installs or publishing.

Capacity: 20 GiB available at recovery, below the 50 GiB shared reserve. Reuse existing reference imagery; keep source edits, evidence and a code-only build under 20 MB. Do not duplicate public assets, start large renders, or delete unrelated data.

Browser exception for task 01a07e7b-23c9-72e1-a62e-b780ac76623f: one disposable local IAB tab is required for the private loopback-only app and GPU/worker interactions. Browserless cannot reach this backend; a prior private-build transfer rejection must not be bypassed. Bind servers to 127.0.0.1, preserve user tabs, reset the viewport and close the owned tab at cleanup. The exception ends with this QA pass.
