# WebPhysics v1.12 focused runtime-candidate qualification

Exact baseline archive: `7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537`.

Each path used **16** timed samples (equal execution-order strata), 3 warmup rounds per implementation, calibrated batches, and 20,000 order-stratified bootstrap resamples.

Classification requires at least a 2% effect and a 95% interval wholly beyond parity. Smaller/inconclusive effects are parity/noise.

| Family | Complete timed path | Iterations | v1.11 ns/op | v1.12 ns/op | Speedup | 95% CI | nMAD | Result | Exact |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| fallback dynamic index/cache | fallback-dynamic-count | 498,365 | 139.44 | 140.33 | **1.004x** | 0.616–1.973 | 8.80% | **control** (high noise) | yes |
| fallback dynamic index/cache | fallback-sync-transforms | 34,338 | 1612.89 | 1626.87 | **0.985x** | 0.972–1.003 | 1.23% | **control** (low noise) | yes |
| fallback dynamic index/cache | fallback-complete-step | 1,461 | 20875.54 | 22468.49 | **0.938x** | 0.922–0.952 | 14.82% | **control** (high noise) | yes |
| axis-aligned matrix writer | cloth-sphere-frame | 679,454 | 76.50 | 43.98 | **1.748x** | 1.687–1.785 | 2.15% | **true-win** (low noise) | yes |
| axis-aligned matrix writer | water-768-droplet-frame | 3,223 | 31423.95 | 6642.06 | **4.135x** | 4.087–4.185 | 3.98% | **true-win** (moderate noise) | yes |
| rope tuple removal | rope-payload-frame | 522,933 | 81.35 | 80.77 | **1.015x** | 0.974–1.069 | 4.42% | **control** (moderate noise) | yes |
| rope tuple removal | rope-debug-frame | 9,139 | 3896.23 | 3181.56 | **1.095x** | 1.067–1.232 | 16.95% | **control** (high noise) | yes |

## Interpretation

- Rejected fallback cached-count candidate is restored as a control at 1.004x; complete-frame evidence outweighed its isolated query speed.
- Rejected fallback dynamic-count and traversal candidates were fully reverted. The restored v1.11 fallback remains a control: dynamicCount 1.004x, syncTransforms 0.985x, and complete frame 0.938x.
- Axis-aligned matrix specialization: cloth sphere true-win at 1.748x; full 768-droplet water frame true-win at 4.135x.
- Rejected rope tuple candidates remain controls: payload 1.015x; debug 1.095x.

Every sample started from the same scene/stress/seed. Setup, garbage collection, post-GC subject priming, and capture hashing were excluded from timed regions. Final matrices, colors, debug lines, authoritative soft state, body/node counts, frame versions, and replay hashes matched bit-for-bit across versions and across repeated samples.
