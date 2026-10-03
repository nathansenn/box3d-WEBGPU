# Bridge experiment refinement V6

Refine the existing Experiments workspace around reading results. Reuse the V5 imagegen mockup (`../bridge-experiments-v5-20260914/mockup.png`), its five-color chart, restrained inspector, orange action and teal measurements. No new bulk imagery is needed for this interface refinement.

Implement a collapsible scan setup, an honest summary of recorded outcomes, deck-drop / sideways-movement / lost-link chart modes, a keyboard-accessible time probe, and a compact five-case comparison list with the selected case details after the list. A partial run must never be extrapolated beyond its last sample. Configuration changes must not relabel existing results or discard them until a new scan starts.

Preserve the isolated solver, frozen controls, cancellation, saved-result validation, exports, case loading and baseline promotion. Keep authored model units explicit; observations do not establish a safe load or a calibrated failure threshold.

The checkout is shared and dirty. Own only the experiment view/helper/styles, focused tests and this evidence folder. Do not stage, commit, reset, push, deploy or install dependencies.

Capacity at recovery: 38 GiB free, below the shared 50 GiB reserve. Keep this pass small: source edits, tests without generated test runtimes, bounded screenshots, and (if needed) a code-only Vite build without copying the public asset tree. No large renders, new asset batches or duplicated public directories.

Browser exception: one disposable local IAB tab is needed for this private loopback application and native GPU/solver interactions. Browserless cannot reach the local backend; never transfer the build or private assets after the prior transfer rejection. Bind all servers to 127.0.0.1. Preserve user tabs; reset viewport and close only this task's tab at cleanup.
