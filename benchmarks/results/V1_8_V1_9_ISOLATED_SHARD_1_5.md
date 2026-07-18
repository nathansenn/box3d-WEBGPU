# v1.8 → v1.9 Isolated Fresh-Process Benchmark

- Changed-path geometric mean: **2.268×**
- Dynamic/mixed geometric mean: **1.413×**
- Correctness failures: **0**

| Workload | v1.8 ms | v1.9 ms | Speedup | Paired 95% interval | Dynamic bytes |
|---|---:|---:|---:|---:|---:|
| Cargo net · adaptive solver + handoff | 1.831857 | 1.399664 | **1.309×** | 1.271–1.364× | 27200 → 20400 |
| Maximum membrane · adaptive solver + handoff | 1.723008 | 0.911298 | **1.891×** | 1.818–1.980× | 27200 → 20400 |
| Maximum membrane · 72-projectile storm | 3.381344 | 2.137002 | **1.582×** | 1.513–1.679× | 27200 → 20400 |
| Maximum rope · CPU render handoff | 0.013656 | 0.000908 | **15.039×** | 14.791–15.755× | 32160 → 4116 |
| Maximum rope · solver + handoff | 0.701210 | 0.687999 | **1.019×** | 0.997–1.049× | 32160 → 4116 |
