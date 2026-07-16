# WebPhysics v1.12 focused runtime-candidate qualification

Exact baseline archive: `7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537`.

Each path used **16** timed samples (equal execution-order strata), 3 warmup rounds per implementation, calibrated batches, and 20,000 order-stratified bootstrap resamples.

Classification requires at least a 2% effect and a 95% interval wholly beyond parity. Smaller/inconclusive effects are parity/noise.

| Family | Complete timed path | Iterations | v1.11 ns/op | v1.12 ns/op | Speedup | 95% CI | nMAD | Result | Exact |
|---|---|---:|---:|---:|---:|---:|---:|---|---|
| fallback dynamic index/cache | fallback-dynamic-count | 1,454,451 | 186.07 | 2.19 | **67.502x** | 64.138–99.231 | 23.55% | **true-win** (high noise) | yes |
| fallback dynamic index/cache | fallback-sync-transforms | 33,568 | 1620.11 | 1542.39 | **1.039x** | 1.024–1.065 | 1.89% | **true-win** (low noise) | yes |
| fallback dynamic index/cache | fallback-complete-step | 1,374 | 23072.48 | 22188.47 | **0.982x** | 0.929–1.154 | 16.97% | **parity/noise** (high noise) | yes |
| axis-aligned matrix writer | cloth-sphere-frame | 876,607 | 74.20 | 41.96 | **1.782x** | 1.750–1.809 | 2.27% | **true-win** (low noise) | yes |
| axis-aligned matrix writer | water-768-droplet-frame | 3,760 | 31354.53 | 6631.32 | **4.324x** | 4.264–4.387 | 4.59% | **true-win** (moderate noise) | yes |
| rope tuple removal | rope-payload-frame | 505,087 | 81.54 | 79.36 | **1.020x** | 0.990–1.063 | 4.52% | **parity/noise** (moderate noise) | yes |
| rope tuple removal | rope-debug-frame | 10,556 | 3453.08 | 2652.22 | **1.411x** | 1.109–1.440 | 16.25% | **true-win** (high noise) | yes |

## Interpretation

- Fallback cached dynamicCount: true-win at 67.502x.
- Fallback dynamic-index sync path: true-win at 1.039x; complete fallback frame: parity/noise at 0.982x.
- Axis-aligned matrix specialization: cloth sphere true-win at 1.782x; full 768-droplet water frame true-win at 4.324x.
- Rope tuple removal: payload-only parity/noise at 1.020x; 149-node debug frame true-win at 1.411x.

Every sample started from the same scene/stress/seed. Setup, garbage collection, post-GC subject priming, and capture hashing were excluded from timed regions. Final matrices, colors, debug lines, authoritative soft state, body/node counts, frame versions, and replay hashes matched bit-for-bit across versions and across repeated samples.
