# Original v1.2.0 -> current v1.10.0 soft-simulation benchmark

Generated: 2026-07-14T10:55:28.839Z

## Result

- JavaScript-to-JavaScript geometric mean: **3.692x**
- Original JavaScript-to-current SIMD/WASM geometric mean: **6.455x**
- Determinism/correctness failures: **0**

| Maximum-detail recipe | v1.2 JS | v1.10 JS | JS speedup (95% CI) | v1.10 SIMD/WASM | SIMD speedup (95% CI) |
|---|---:|---:|---:|---:|---:|
| Tensioned Membrane Drum — Cinematic | 6.582875 ms | 1.061386 ms | **6.202x** (6.036-6.292x) | 0.896607 ms | **7.342x** (7.272-7.442x) |
| Rope Net Resonance — Cinematic | 0.957329 ms | 0.454064 ms | **2.108x** (2.036-2.155x) | 0.348593 ms | **2.746x** (2.702-2.786x) |
| Leviathan Impact Pool — Cinematic | 0.435999 ms | 0.113289 ms | **3.849x** (3.653-3.972x) | 0.032679 ms | **13.342x** (12.473-14.056x) |

## CPU render-handoff payload

These are logical dynamic bytes prepared for each changed frame. Static topology/rest data is listed separately and is upload-once in the current renderer.

| Recipe | v1.2 dynamic/frame | v1.10 dynamic/frame | Reduction | v1.2 static | v1.10 static |
|---|---:|---:|---:|---:|---:|
| Tensioned Membrane Drum — Cinematic | 81,600 B | 20,400 B | **75.00%** | 38,808 B | 39,804 B |
| Rope Net Resonance — Cinematic | 33,120 B | 4,116 B | **87.57%** | 0 B | 12,864 B |
| Leviathan Impact Pool — Cinematic | 309,200 B | 77,360 B | **74.98%** | 150,696 B | 75,348 B |

## Correctness and comparability

| Recipe | Same catalog recipe | Same state shape | v1.2 deterministic | v1.10 JS deterministic | v1.10 SIMD deterministic | SIMD relative L2 vs v1.2 |
|---|---:|---:|---:|---:|---:|---:|
| Tensioned Membrane Drum — Cinematic | yes | yes | yes | yes | yes | 9.7697e-4 |
| Rope Net Resonance — Cinematic | yes | yes | yes | yes | yes | 6.7513e-4 |
| Leviathan Impact Pool — Cinematic | yes | yes | yes | yes | yes | 2.2864e-3 |

The cross-version fidelity gate is relative L2 <= 0.5% for the authoritative position/height state after the complete warmup and timed horizon. It passed for both current paths in every workload. Constraint and rope-render counts are recorded but are not required to match because current builds intentionally remove pinned-to-pinned constraints and their zero-motion render segments.

| Recipe | v1.2 nodes / constraints / instances | v1.10 nodes / constraints / instances |
|---|---:|---:|
| Tensioned Membrane Drum — Cinematic | 1700 / 9782 / 0 | 1700 / 9454 / 0 |
| Rope Net Resonance — Cinematic | 343 / 743 / 414 | 343 / 731 / 402 |
| Leviathan Impact Pool — Cinematic | 6441 / 18360 / 1 | 6441 / 18360 / 1 |

## Measurement stability

| Recipe | v1.2 normalized MAD | v1.10 JS normalized MAD | v1.10 SIMD normalized MAD |
|---|---:|---:|---:|
| Tensioned Membrane Drum — Cinematic | 0.80% | 0.69% | 0.84% |
| Rope Net Resonance — Cinematic | 1.22% | 1.19% | 0.25% |
| Leviathan Impact Pool — Cinematic | 1.99% | 1.59% | 3.19% |

## Method

- 7 fresh processes per variant/workload; variant order rotates each sample.
- Scene creation, module loading, warmup, and process startup are excluded from the timed region.
- Every timed operation is one fixed 1/60-second simulation step with four substeps followed by one CPU frame/handoff build.
- Results use medians, median absolute deviation, and a paired bootstrap confidence interval.
- The baseline and current source are independently compiled into temporary directories. The repository `.test-build` directory is not used.
- v1.10 JavaScript isolates source/data-layout/scheduling gains; v1.10 SIMD/WASM represents the preferred current soft-kernel path.

## Interpretation boundary

- These are CPU simulation plus CPU render-handoff timings, not physical-GPU frame times or universal browser FPS claims.
- Current cloth and water surface reconstruction and rope instance expansion occur on WebGPU; that GPU work is outside this CPU timer.
- Cross-version replay hashes are not required to match because solver scheduling, precision, and render-stream architecture intentionally changed. The benchmark instead requires identical catalog recipes and state shapes, finite state, successful validation, and deterministic repeated results within each implementation.
- The three workloads are representative maximum-detail soft simulations; they do not measure native Box3D rigid-body WASM.

## Environment

- Node: v26.0.0
- Platform: darwin/arm64
- CPU: Apple M3 Ultra
- Baseline archive SHA-256: `cfe8124c0a8b4f5e0945e3f83113833efd57dd7b6ebf44941271e3633db509d0`
- Current soft-path source fingerprint: `e921d69bcc2024e644d55fd0551fb7473bf8de91459ce7f7909885b429b056f9`
- Current SIMD WASM SHA-256: `a4a3c3f30856d40a7cf87e22400aa318edb00c9b6c4fdc37b2b24149152fe230`
