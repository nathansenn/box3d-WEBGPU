# v1.11 exact soft-simulation gains

Exact baseline: `benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz` (SHA-256 `dea18ff88e86568e5449c9dece5610d0dfadf38d901eef1c1e39155c64e8c3f5`)

Source stable during run: **yes**

## Timings

| Workload | v1.10 median | Current median | Speedup | Decision |
|---|---:|---:|---:|---|
| Construct all 150 soft scenes | 49.257 ms | 47.069 ms | 1.046× | retain |
| Sphere-collider solve (10 scenes × 36 frames) | 779.188 ms | 681.802 ms | 1.143× | retain |
| Cloth explosion actions (50 scenes × 32) | 34.006 ms | 8.680 ms | 3.918× | retain |
| Rope explosion actions (50 scenes × 32) | 3.552 ms | 0.943 ms | 3.768× | retain |

## Retained typed-array memory

| Domain | Scenes | v1.10 mean | Current mean | Reduction |
|---|---:|---:|---:|---:|
| all | 150 | 407.91 KiB | 249.90 KiB | 38.74% |
| cloth-intact | 43 | 672.86 KiB | 439.27 KiB | 34.72% |
| cloth-tearing | 7 | 684.51 KiB | 525.41 KiB | 23.24% |
| rope | 50 | 190.33 KiB | 37.90 KiB | 80.08% |
| water | 50 | 358.90 KiB | 260.46 KiB | 27.43% |

Summed across the 150 independently constructed scenes: **23.15 MiB saved**.

## Exhaustive action ceilings

| Domain | Scenes scanned | Maximum rendered instances | Exact capacity | Component ceiling |
|---|---:|---:|---:|---|
| Cloth | 50 | 161 | 161 | 160 projectiles + 1 collider |
| Rope | 50 | 97 | 97 | 96 projectiles + 1 payload |
| Water | 50 | 788 | 788 | 768 droplets + 20 floaters |

All 150 recipes were saturated through the public launch/rain actions. Baseline/current action counts matched, every current stream reached its documented cap without clamping, and all collider/explosion comparison fingerprints were exact.
