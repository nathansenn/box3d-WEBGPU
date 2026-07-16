# Box3D WebGPU AAA — Performance Engineering Report

Release: **v1.8.1 GPU Surface / WASM Edition**
Generated: 2026-07-14T04:53:58.117Z

## Executive result

This run evaluated **100 distinct microbenchmark candidates**. **76** cleared the kernel threshold, **6** were borderline, and **18** were rejected or inconclusive.

The accepted-kernel geometric mean is **11.518×**. It describes isolated accepted kernels—including timer-floor work-elimination cases—and is not an engine-wide speed claim.

## Measurement discipline

- Four warm-up passes and nine timed samples per candidate.
- Median ns/op is primary; median absolute deviation records noise.
- Kernel acceptance requires at least 3% median improvement and bounded dispersion.
- Whole-project acceptance requires at least 2% median improvement with normalized MAD at or below 15%.
- Rejected and borderline results remain in the evidence set.
- Ratios from unrelated kernels are never multiplied.

## Candidate summary by subsystem

| Subsystem | Candidates | Accepted | Borderline | Rejected | Best isolated kernel |
|---|---:|---:|---:|---:|---:|
| Math | 10 | 6 | 0 | 4 | 18.566× |
| Data layout | 10 | 9 | 1 | 0 | 1215.655× |
| Allocation | 10 | 8 | 0 | 2 | 304.559× |
| Cloth | 10 | 7 | 0 | 3 | 6361.991× |
| Rope | 10 | 7 | 0 | 3 | 5.004× |
| Water | 10 | 6 | 2 | 2 | 60332.000× |
| Surface mesh | 10 | 8 | 2 | 0 | 45725.202× |
| Renderer CPU | 10 | 8 | 1 | 1 | 529.734× |
| Rigid preview | 10 | 9 | 0 | 1 | 4551.647× |
| Scheduling | 6 | 4 | 0 | 2 | 22.154× |
| WASM bridge | 3 | 3 | 0 | 0 | 5052.711× |
| Build/runtime | 1 | 1 | 0 | 0 | 4.438× |

## End-to-end comparison against bundled v1.2.0

| Workload | Baseline median | Current median | Speedup | Time reduction | Noise ceiling | Accepted |
|---|---:|---:|---:|---:|---:|---|
| `test:soft-soak` | 20.7247s | 9.4308s | 2.198× | 54.49% | 1.77% | yes |
| `test:webgpu` | 0.7361s | 0.9011s | 0.817× | -22.41% | 10.11% | no |
| `build` | 0.7207s | 0.7540s | 0.956× | -4.61% | 5.70% | no |
| `test` | failed | failed | — | — | — | no |

Production bundle delta: **+204,481 bytes** (108.39%).

A failed baseline gate is reported as unavailable evidence; it is never converted into a speed claim.

## Source integration audit

Changed implementation/configuration files: **27**; source files: **11**; line delta: **+5379 / -622**. See `benchmarks/results/source-integration-audit.md` for hashes and file detail.

## Retained engineering changes

1. Packed constraint/material layouts and reusable typed-array staging.
2. Cached tear topology, regular-grid topology, UVs, static transforms, and unchanged frame streams.
3. Buffer swapping, geometric capacity growth, in-place compaction, and batched instance preparation.
4. SIMD/scalar standalone WASM cloth, rope, water, and rope-render kernels with JavaScript fallback.
5. GPU-resident intact-cloth reconstruction at 16 dynamic bytes per vertex.
6. GPU-resident shallow-water reconstruction at 12 dynamic bytes per cell.
7. Topology-aware packed CPU fallback for tearing cloth.
8. Coherent sweep-and-prune deterministic preview broadphase.
9. Whole-system projectile AABB and squared-distance contact rejection.
10. Optional TurboQuant transport compression kept outside the local authoritative frame loop.

## Evidence policy

- A microbenchmark win alone is insufficient for a release claim.
- CPU and Dawn command-submission results are not physical-GPU FPS measurements.
- Regressions, parity, timer-floor cases, and unavailable baseline gates stay visible.
- The original native Box3D Emscripten artifact is a separate build gate from the packaged soft-kernel WASM modules.

## Reproduce

```bash
npm ci
npm run validate:v1.8
npm run bench:100
npm run bench:end-to-end
npm run bench:audit
npm run perf:report
```

The source manifest is generated after reports and verified as the final provenance gate.
