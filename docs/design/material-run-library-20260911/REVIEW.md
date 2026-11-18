# Material studies: run library

The five material labs now keep compact experiment results across reloads and study changes. Save a result, load a fresh setup, change one variable, and compare two recorded traces while keeping the apparatus visible.

## Implemented

- A responsive ivory results drawer following the generated reference; teal A and dashed orange B traces, shared elapsed-time axis, metric selection and a final-value comparison table.
- Up to 24 results stored in this browser on this origin. Each result contains normalized settings, material, seed, recording duration, completion state, manual release events, extrema and at most 320 metric samples. Full geometry is not stored in the notebook.
- Same-study comparisons only. Different recording lengths are explicitly identified and traces end at their actual recorded times. Setup differences can be expanded below the table.
- Same-study and cross-study setup loading, JSON result/comparison export, remove and undo, empty states, storage-error feedback, accessible names and Escape-to-close.

Loading a saved setup starts a fresh specimen. Stored measurements are comparative model results and do not restore a solver checkpoint. These changes are local; this phase did not update the public deployment.

## Design reference

Generated with built-in imagegen from the original liquid-study reference. The [mockup](mockup.png) supplies the palette, split composition, result rows and two-curve plot. The [exact final prompt](imagegen-prompt.md) records the brief. Its illustrative numbers were replaced by actual recorded data in the live app.

The implementation adds partial/completed labels, explicit units, unequal recording-length notices, a dashed B trace and a table of changed settings. At 390 px the apparatus and notebook stack without horizontal page overflow. Desktop and phone screenshots were inspected through the local browser during this turn.

## Verification

- TypeScript and production build passed. Nine scoped tests passed for persistence, normalization, buffer detachment, trace bounds, corrupt data, storage failure, capacity, undo and incompatible comparisons.
- Saved real results in all five labs: full water/oil, concrete, silicone and sand programs; a partial glass fracture result; a partial early-wave liquid result.
- Downloaded water/oil comparison JSON was inspected for finite values, actual endpoints and distinct responses. The silicone export was inspected for its manually triggered release event.
- Checked reload persistence, loading setups between studies, metric switching, incompatible study selection, unequal recording lengths, removal/undo, rail navigation, scene expansion and Escape. No application console errors were captured in the inspected pages.
- [Verification receipt](verification.json), [download evidence](export-check.json), [manual release evidence](manual-release-check.json), [test output](tests.txt), [build manifest](build-manifest.json).

Concurrent engine/model edits were preserved. The preview was moved from the development server to the verified production build at the same `127.0.0.1:5173` origin, so ongoing source changes do not reset this review. The build folder is `/private/tmp/box3d-notebook-build-20260911`; the entry response was verified byte-for-byte against that artifact. The server binds only to 127.0.0.1. This phase does not qualify the independent physics edits.

The browser's tab-retention action remains blocked by automatic approval review, which classified it as a possible submission. The preview server is running; retaining the agent-created browser tab after the turn requires user confirmation.
