# Camera path benchmark versus archived v1.10

| Workload | v1.10 ns/frame | optimized ns/frame | speedup |
|---|---:|---:|---:|
| static-camera | 350.01 | 18.09 | 19.347x |
| continuous-orbit | 363.96 | 128.41 | 2.834x |
| fully-changing-cinematic-shake | 361.29 | 244.85 | 1.476x |
| mixed-30-frame-keyframes | 347.70 | 29.80 | 11.669x |

- Fidelity cases: 4096
- Maximum view-projection difference: 0
- Maximum light-view-projection difference: 0
- Maximum eye difference: 0
- Float32 view-projection bit mismatches: 0
- Float32 light-view-projection bit mismatches: 0
- Camera-eye value mismatches: 0
- Static result/object/typed-array identity reuse: passed
- Changing-path no-regression gate (>=0.95x): passed
- Overall decision: retain

The source-level allocation count is conservative and does not assume whether the JavaScript engine performs escape analysis.
