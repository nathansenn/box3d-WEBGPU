# Round 6 opt-in producer tracking

This additional module is based on PR #12 commit `0134200705499d6fdcba56127f1fb9fd1b87ac30`.
It does not replace the existing tracker or change the renderer default.

```ts
import { createOptimizedDirtyRecordTracker } from '../webgpu/optimized-dirty-record-tracker';

// Explicit, producer-owned opt-in. Unknown/native producers keep the old path.
const tracker = createOptimizedDirtyRecordTracker(count, 'range-union', { maxRanges: 64 });
tracker.begin();
// Mutate a complete authoritative interval, then mark every potentially changed record.
tracker.markRange(firstChangedRecord, changedRecordCount);
const delta = tracker.finish();
// delta.full => omit sparse proof and use the full-upload path.
// Otherwise bind delta.spans to exact previous/current revisions and source identity
// via the existing renderer dirty-proof API. Copy spans before the next begin().
```

This example is a contract sketch, not an automatic native-physics integration.
The producer must enumerate EVERY modified record; locality hints never prove
completeness. For one matrix and one color stream, use independent trackers and
bind proofs to each stream's actual versions. Source/heap/count changes require
the existing renderer's full-upload fallback. Do not derive authoritative dirty
sets from visibility, cameras, sampled records or another scene.

Five hypotheses are selectable. Their standalone local 100-case CPU study found
11 CPU-gated improvements, 2 regressions, 1 tail rejection, 35 unresolved cases,
31 timing-floor cases and 20 unchanged-state controls. This is CPU mutation,
metadata, planning and TypedArray copying, NOT GPU uploads/rendering or FPS.
The known regression-prone bitmap variants must not be enabled globally.

The supplied source/evidence ZIP contains two-seed raw windows, 400-direction Holm
results, source hashes, an independent Python audit and the negative results.
New-source physical GPU qualification, full application build/CI, merge and live
rollout remain pending. The original 2026-11-01 campaign deadline and preserved
volume `5ftxitn7ox` are unchanged.
