# v1.8 → v1.9 Isolated Fresh-Process Benchmark

- Changed-path geometric mean: **1.166×**
- Dynamic/mixed geometric mean: **1.166×**
- Correctness failures: **0**

| Workload | v1.8 ms | v1.9 ms | Speedup | Paired 95% interval | Dynamic bytes |
|---|---:|---:|---:|---:|---:|
| Maximum rope · 96-impact storm | 1.148120 | 1.176055 | **0.976×** | 0.965–0.998× | 37040 → 11396 |
| Maximum cloth + rope + water | 2.650116 | 1.902195 | **1.393×** | 1.387–1.440× | 136640 → 101796 |
| Tearing cloth · topology control | 7.367745 | 7.365089 | **1.000×** | 0.981–1.020× | 39168 → 39168 |
| Maximum water · unchanged control | 0.137275 | 0.139033 | **0.987×** | 0.912–1.109× | 77280 → 77280 |
| Regular cloth · non-adaptive control | 1.387506 | 1.313566 | **1.056×** | 1.031–1.081× | 21824 → 16368 |
