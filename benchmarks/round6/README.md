# Round 6: CPU study of dirty-record tracking

Round 6 (PR #14) measured five dirty-tracking variants on the CPU as a second tracker
module, `src/webgpu/optimized-dirty-record-tracker.ts`. That module was folded into
`src/webgpu/dirty-record-tracker.ts` instead of being merged. `SUMMARY.json` is the
study's original summary, kept byte for byte as a record of what was run.

## What the tracker gained

- `markRange(start, count)` marks records `start` to `start + count - 1` in one call,
  in every mode.
- `createDirtyRecordTracker(count, 'ranges', { maxRanges })` gives a full result when a
  frame's merged spans form more than `maxRanges` disjoint runs.
- In `bitset`, `tile-32` and `dense-bypass`, `finish()` visits only the touched words
  when few are touched.

The other variants were dropped because their output was identical to a mode the
tracker already had: `touched-words` and `epoch-words` match `bitset`,
`touched-tiles` matches `tile-32`, and `range-union` matches `ranges` with
`maxRanges`. `locality-gated` matched `tile-32` when the producer called its changes
`'localized'`, and otherwise asked for a full upload on the first change.

The merged code is not the code that was measured. `range-union` merged every mark
into a sorted list, which took about 5 s for 65,536 scattered marks; `ranges` merges
once in `finish()` and takes tens of milliseconds for the same marks.

Nothing is enabled by default. The renderer doesn't use the tracker.

## What the numbers do and don't show

The study made 100 comparisons: 11 CPU-qualified, 2 CPU regressions, 1 tail
rejection, 35 unresolved, 31 below the timing floor and 20 unchanged-state controls.
All 11 passes were `range-union` or `locality-gated` recipes.

- Each candidate was compared with the matching Round 5 tracker from PR #12, not with
  the production full upload.
- Only CPU work was timed: mutation, tracking, planning and TypedArray copies. These
  are not GPU, upload or FPS results.
- The passing recipes also switched the producer from per-record `mark()` to bulk
  `markRange()`. The study didn't separate the two, so the gains can't be credited to
  the tracking variant.
- The benchmark script and reference modules listed in `SUMMARY.json`
  (`benchmarks/round6/cpu-100.mjs` and `benchmarks/round6/reference/*.mjs`) were never
  committed, so the numbers can't be reproduced from this repository. Its source
  hashes are for the removed module and those uncommitted files, not the current
  tracker.

Each comparison used two input sets of 32 balanced AB/BA pairs of eight-frame windows.
It qualified only if, in both sets, the median paired baseline/candidate ratio was
above 1.03, the Holm-adjusted p-value over all 400 directional tests was at most 0.05,
the candidate/baseline p95 ratio was at most 1.10, and each arm's median was at least
0.05 ms per window. Controls could not qualify.

## Tests

The checks from PR #14's test suite that still apply now run in
`tests/dirty-record-tracker.test.ts`, which `npm test` and `npm run test:dirty-records`
run. The `unitTests` counts in `SUMMARY.json` describe the removed suite.
