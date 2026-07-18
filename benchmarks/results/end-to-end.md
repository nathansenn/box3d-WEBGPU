# End-to-End Performance Evidence

Generated: 2026-07-14T05:19:13Z

The bundled v1.2.0 source baseline is compared with v1.9.0 using clean package installations. Ratios are never multiplied across tests.

| Workload | Baseline median | Optimized median | Speedup | Reduction | Noise ceiling | Accepted |
|---|---:|---:|---:|---:|---:|---|
| `test:soft-soak` | 15.1036s | 4.6567s | 3.243× | 69.17% | 0.46% | yes |
| `test:webgpu` | 0.4598s | 0.4947s | 0.930× | -7.58% | 1.30% | no |
| `build` | 0.3400s | 0.3565s | 0.954× | -4.85% | 0.86% | no |
| `test` | failed | failed | — | — | — | no |

## Production bundle

- Baseline: 188,658 bytes
- Optimized: 404,710 bytes
- Delta: +216,052 bytes

## Evidence policy

- Full command logs are stored under `benchmarks/results/logs/`.
- A result below the acceptance threshold remains documented but is not presented as a proven win.
- WebGPU results in this environment validate CPU-side command/resource work through the project’s Dawn test path; they are not a substitute for target-GPU frame timing.
