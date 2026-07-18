# Box3D WebGPU AAA v1.3 — KTX2 Performance Pass

Generated: 2026-07-11T08:54:44.803Z
Baseline: **v1.2.0**
Optimized release: **v1.3.0**

## Executive result

This pass integrates **32 concrete runtime techniques** into the shipped cloth, rope, water, effects, renderer, texture-loading, and GPU-upload paths. The benchmark uses isolated Node processes, alternates baseline/optimized order, reports medians and median absolute deviation, and bootstraps paired speedup ratios 20,000 times.

| Maximum scene | Baseline total | v1.3 total | Total speedup | 95% paired speedup CI |
|---|---:|---:|---:|---:|
| Tensioned Membrane Drum — Cinematic | 12.940 ms | 3.553 ms | **3.64×** | 3.54×–3.77× |
| Rope Net Resonance — Cinematic | 1.811 ms | 0.554 ms | **3.27×** | 3.20×–3.34× |
| Leviathan Impact Pool — Cinematic | 0.965 ms | 0.375 ms | **2.57×** | 2.54×–2.66× |

Effects frame construction improved **1.40×** and effect updates improved **1.25×** in the integrated comparison.

These ratios are separate workload results. They are not multiplied together into a fabricated engine-wide number.

## Dynamic geometry bandwidth

| Surface | v1.2 every frame | v1.3 first frame | v1.3 steady frame | First-frame reduction | Steady reduction |
|---|---:|---:|---:|---:|---:|
| cloth | 120,408 B | 60,204 B | 40,800 B | 50.00% | 66.12% |
| water | 459,816 B | 229,908 B | 154,560 B | 50.00% | 66.39% |

The 50% first-frame reduction comes from packed 24-byte vertices and uint16 indices. The larger steady-state reduction also includes topology upload caching.

## KTX2 / BC4 compression

The material micro-variation texture now ships in KTX2 as native BC4 when the adapter exposes `texture-compression-bc`, with an R8 KTX2 fallback. This release does **not** claim Basis Universal transcoding: the runtime intentionally uses directly uploadable BC4/R8 payloads and requires no texture transcoder.

| Measurement | Result |
|---|---:|
| R8 KTX2 file | 87,840 B |
| BC4 KTX2 file | 44,160 B |
| File reduction | **49.73%** |
| Resident mip-payload reduction | **50.00%** |
| Base-mip quality | 30.86 dB PSNR |
| Base-mip RMSE / maximum error | 7.302 / 17 |

The BC4 WebGPU chain intentionally stops at 4×4 because compressed texture copies must respect complete 4×4 blocks; the KTX2 source still retains the complete mip chain.

## Integrated techniques

1. Replaced 48-byte dynamic surface vertices with a 24-byte packed layout.
2. Encoded normals as two signed 16-bit octahedral components.
3. Packed cloth/water color and stress into four normalized bytes.
4. Packed UV coordinates into two normalized 16-bit lanes.
5. Replaced 32-bit dynamic-surface indices with 16-bit indices.
6. Cached cloth topology and uploads indices only when its topology version changes.
7. Kept regular-grid water topology immutable and upload-once.
8. Writes packed cloth vertices directly into typed-array lanes.
9. Writes packed water height, normal, and foam lanes directly while retaining static X/Z/UV lanes.
10. Removed redundant Euclidean normalization before octahedral normal encoding.
11. Converted cloth constraints from object graphs to structure-of-arrays typed lanes.
12. Converted rope constraints from object graphs to structure-of-arrays typed lanes.
13. Precomputed constraint inverse rest lengths, weighted correction scales, break thresholds, and edge metadata.
14. Removed constraints joining two pinned cloth particles.
15. Added a branch-light non-tearing cloth projection path.
16. Cached cloth tear topology until a structural edge actually breaks.
17. Replaced per-particle wind trigonometry with phase caches and angle addition.
18. Bounded cloth integration substeps and projection sweeps instead of mirroring every rigid-body substep.
19. Reused cloth, rope, water, debug, frame, matrix, and color buffers.
20. Compacted projectiles, droplets, particles, and shockwaves in place.
21. Swapped shallow-water state buffers instead of copying complete grids.
22. Folded timestep and grid coefficients outside water-cell loops.
23. Moved water energy telemetry to the existing 12-frame telemetry cadence.
24. Reused renderer line staging memory rather than allocating per frame.
25. Writes GPU buffers by backing buffer/offset/size instead of allocating subarray views.
26. Caches surface buffer identity, topology version, and index count.
27. Pads odd uint16 topology transfers without inflating logical upload accounting.
28. Reused effects frame arrays with geometric capacity growth.
29. Replaced shockwave per-segment trigonometry with a recurrence.
30. Added native BC4 KTX2 material-noise textures with R8 fallback.
31. Parallelized shader diagnostics and asynchronous render-pipeline creation.
32. Overlapped KTX2 fetch/upload with independent renderer initialization work.

## Measured ideas that were rejected or treated cautiously

| Candidate | Status | Measured ratio | Decision |
|---|---|---:|---|
| Replace (distance-rest)/distance with 1-rest/distance in the common cloth projection loop | rejected-regression | 0.95× | Not shipped as an optimization. |
| Split the final non-tearing strain pass from the general tear-aware path | rejected-below-noise-floor | 1.00× | Not shipped as an optimization. |
| Pass precomputed segment deltas/length into rope matrix construction | rejected-regression | 0.81× | Not shipped as an optimization. |
| Sample cloth energy at telemetry cadence instead of every frame | rejected-no-win | 1.00× | Not shipped as an optimization. |
| Sample rope energy at telemetry cadence instead of every frame | rejected-no-win | 1.00× | Not shipped as an optimization. |
| Sample O(N) water energy together with the 12-frame telemetry/hash cadence | accepted-step-hot-path | 1.05× | Retained in the real runtime path. |
| Validate shader modules in parallel and create eight render pipelines asynchronously | retained-architectural-borderline | 1.02× | Median improved, but the difference overlaps local run noise; retained primarily to avoid first-use compilation stalls on real browsers. |
| Overlap KTX2 fetch/upload with buffer, shader, and pipeline setup | retained-latency-hiding-neutral-local | 1.00× | Local null-backend result was neutral; networked browsers can hide independent fetch latency. |
| Reuse effect frame arrays and shockwave line objects; compact particles in place | accepted | 1.37× | Retained in the real runtime path. |

The rejected results are deliberately preserved. In particular, reciprocal constraint algebra was **slower**, rope delta reuse was **slower**, and throttling cloth/rope energy telemetry did not clear the noise floor. Only the water telemetry scan produced a repeatable solver-step gain.

## Source integration proof

The v1.2 source is bundled as a reproducible baseline archive. The source audit found **18** changed implementation/configuration files, including **8** runtime source files, **2** simulation files, **1** renderer files, and **3** compressed texture assets. Line delta: **+4194 / -593**.

## Validation boundary

The CPU results above prove the measured JavaScript simulation and frame-construction paths in this Linux x64/Node environment. Dawn validates shaders, bind groups, compressed texture uploads, render pipelines, and complete command submission, but its null backend does not prove target-hardware GPU frame-time. Final GPU speed and browser startup latency should be measured on the deployment Mac/browser with timestamp queries or browser performance tooling.

Asynchronous pipeline creation is retained because it prevents first-use pipeline stalls. Its null-backend median improved 1.02×, but that small difference overlaps local run noise and is not presented as a guaranteed hardware speedup.

## Reproduce

```bash
npm ci
npm run validate
npm run test:soft-soak
npm run bench:v13
npm run bench:audit
npm run perf:report
```

For the longer run:

```bash
npm run bench:v13:deep
```

Raw evidence is stored under `benchmarks/results/`, including every sample, MAD, bootstrap interval, KTX2 quality measurement, candidate rejection, and source hash.
