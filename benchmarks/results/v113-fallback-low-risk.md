# v1.13 fallback low-risk qualification

- Samples: 16 (alternating order)
- Control: exact current-source pre-edit reconstruction
- Active stream, count, and replay-hash exactness: passed
- Public destroy zeroed-heap contract: passed

| Case | Control ns/op | Candidate ns/op | Speedup | Control MAD | Candidate MAD |
|---|---:|---:|---:|---:|---:|
| cached-dynamic-count-3410 | 4062.50 | 7.51 | **540.808×** | 4.08% | 1.99% |
| static-cloth-rigid-step | 1055.74 | 9.99 | **105.647×** | 1.16% | 2.82% |
| static-rope-rigid-step | 1701.21 | 10.06 | **169.157×** | 0.94% | 1.74% |
| repeated-small-scene-create | 3620.90 | 2030.60 | **1.783×** | 2.66% | 6.42% |
| repeated-large-scene-create | 878339.79 | 856324.17 | **1.026×** | 3.59% | 1.29% |
| complete-dynamic-frame-control | 13299.52 | 13170.63 | **1.010×** | 2.10% | 2.42% |

The static-step ratios measure exact rigid-backend work elimination while cloth/rope simulation remains in the separate soft-system layer. Query speed is not a whole-frame claim.
