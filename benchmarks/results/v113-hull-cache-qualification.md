# v1.13 native box-hull cache qualification

The current one-entry exact `b3BoxHull` cache was compared with MRU-first,
fully associative exact LRU caches containing 2, 4, and 8 entries. The first
pass used 12 balanced samples per variant with approximately 55 ms batches.
The 4- and 8-entry finalists were then repeated in reverse order with 20
balanced samples, approximately 100 ms batches, and 50,000 deterministic
stratified bootstrap resamples.

All candidates matched the one-entry implementation exactly for body,
dynamic-body, awake-body, and maximum-body counters; every active matrix and
color bit; replay hashes; and three evolved frames for every scenario.

## Capacity result

| Cache | Initial all-case geometric mean | Confirmation all-case geometric mean | Accepted confirmation wins | Unique-size regressions |
|---:|---:|---:|---:|---:|
| 2 entries | 1.012x | Not promoted | 1 initial | 0 |
| 4 entries | 1.044x | 1.052x | 3 | 0 |
| **8 entries** | **1.066x** | **1.069x** | **3 opportunity wins plus 2 varied-stage wins** | **0** |

## Confirmed 8-entry result

| Production construction workload | Bodies | Median speedup | Balanced-bootstrap 95% interval | Decision |
|---|---:|---:|---:|---|
| Long single-size stack run | 4,096 | 1.003x | 0.999-1.017x | Parity; MRU fast path preserved |
| Alternating skyscraper floor/pillar sizes | 461 | **1.048x** | **1.039-1.054x** | Accepted |
| Bridge deck/cargo/pylon sizes | 152 | 1.019x | 1.010-1.032x | Small gain below threshold |
| Material lanes | 116 | **1.037x** | **1.032-1.042x** | Accepted |
| Random unique-size rain | 2,281 | 0.997x | 0.990-1.004x | Parity; no measured regression |
| Mixed construction scene | 671 | 1.027x | 1.016-1.034x | Small gain below threshold |
| Mixed warehouse scene | 367 | 0.999x | 0.996-1.007x | Parity; no measured regression |
| Alternating architectural colonnade | 461 | **1.048x** | **1.041-1.056x** | Accepted |
| Varied cloth stage | 5 | **1.227x** | **1.200-1.263x** | Accepted |
| Varied water stage | 13 | **1.329x** | **1.314-1.346x** | Accepted |

The acceptance rule required a 95% lower bound above 1.03x on at least one
recurring-size workload, no unique-size workload with a 95% upper bound below
0.97x, and exact output after every timed sample. The 8-entry cache cleared all
gates and produced the strongest overall result.

## Artifact identity and scope

- Current one-entry WASM: `6f00de660aa18b19ebf6db51e0739eded76452ebbaa7d894f5d8a13b2d425051`
- Qualified 8-entry WASM: `de1fe4c659bb6c99879555b7b987d53455bcf4768cbfffcb35eac3ee75835a1c`
- Generated JavaScript for both builds: `8ec00439683b8da258916ebe90f0cea6a6d0672641fda571936b6012fd3cec3b`
- Initial raw evidence: `v113-hull-cache-probe.json`
- Confirmation raw evidence: `v113-hull-cache-confirmation.json`

These measurements cover native Box3D scene construction in Node/WebAssembly.
They are not browser-FPS or physical-GPU claims. The public packaged WASM is
intentionally rebuilt only after the v1.13 source freeze.
