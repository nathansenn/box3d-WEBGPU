# Round 6: bulk marking and capped ranges

PR #14 proposed a second dirty-record tracker. Its two useful features were added to
`src/webgpu/dirty-record-tracker.ts` instead, and the duplicate module was dropped.
The tracker is an opt-in utility: the renderer doesn't use it, and nothing is enabled
by default.

```ts
import { createDirtyRecordTracker } from '../webgpu/dirty-record-tracker';

const tracker = createDirtyRecordTracker(count, 'ranges', { maxRanges: 64 });
tracker.begin();
// Mark every record the producer may have changed.
tracker.markRange(firstChangedRecord, changedRecordCount);
tracker.mark(otherChangedRecord);
const delta = tracker.finish();
// delta.full: upload the whole buffer. delta.spans is then one span over every record.
// Otherwise delta.spans lists the changed records. Copy them before the next begin().
```

## `markRange(start, count)`

- Works in every mode. It marks records `start` to `start + count - 1`, as if each one
  were passed to `mark()`.
- It validates like `mark()`. `start` and `count` must be safe integers with
  `start >= 0`, `count >= 0` and `start + count <= recordCount`, or it throws
  `RangeError`. A finished frame needs `begin()` first. A `count` of 0 does nothing.
- `ranges` stores one span per call, the bitmap modes set whole 32-bit words, and
  `index-list` still visits each record.
- `dense-bypass` still gives a full result once more than 25% of records are marked.
  `countedDirtyRecords` is then `floor(recordCount / 4) + 1`, a lower bound, as with
  `mark()`.

## `maxRanges`

- Only `ranges` accepts it. Other modes throw instead of ignoring it, and it must be a
  positive safe integer.
- `finish()` merges the spans as before. If more than `maxRanges` disjoint spans remain,
  the result is full: one span covering every record, `dirtyCount: null` and
  `coverageUpperBound` equal to the record count. `countedDirtyRecords` keeps the
  merged count.
- The cap applies to the merged result, so it doesn't depend on the order of the marks.
  Marking costs the same as without a cap.
- Without `maxRanges`, `ranges` behaves as before.

## Using the result

The tracker never compares record contents, so the producer must mark every record it
changes. Use one tracker per buffer, for example one for matrices and one for colors.
To pass spans to the renderer, put them in `RigidInstanceDirtyEvidence` with the
previous and current stream versions they describe. When `delta.full` is true, leave
the spans out or pass the single full span: either way the whole stream is uploaded.

## The Round 6 measurements

`benchmarks/round6/README.md` has the details. In short:

- The CPU study compared each candidate with the matching Round 5 tracker from PR #12,
  not with the production full upload. It has no GPU, upload or FPS results.
- Its gains are not separated from switching the producer to bulk `markRange()`.
- It measured the removed module, which was folded into `dirty-record-tracker.ts`.
  Its duplicate modes were dropped because their output was identical.
- Its benchmark script and reference modules, listed in `SUMMARY.json`, were never
  committed, so the numbers can't be reproduced from this repository.
