# Performance evidence

This document is the human-readable index for performance work retained in Box3D WebGPU v1.13. It separates complete production workloads, subsystem measurements, traffic and memory reductions, exact work elimination, and rejected candidates so unlike ratios are not multiplied together.

## Current authority

- [v1.13 1,000-case methodology and matrix](docs/V1.13_1000_BENCHMARK_MATRIX.md)
- [Historical retained/missed-gain audit](benchmarks/results/v113-history-gap-audit.md)
- [Machine-readable v1.13 result](benchmarks/results/v113-production-1000.json)
- [Post-campaign Metal validation](benchmarks/results/post1000-hardware/README.md)
- [Machine-readable release summary](PERFORMANCE_CHANGES.json)

On Apple M3 Ultra with Node.js 26, the source-frozen v1.13 tournament completed exactly 1,000 unique cases with zero correctness failures.

| Population | Eligible cases | Geometric mean |
|---|---:|---:|
| Changed CPU production paths | 555 | **1.0544254732×** |
| Controls | 242 | **1.0041104525×** |

The predeclared 22.5 ms timing floor excluded 203 cases from aggregate claims: 85 changed paths and 118 controls. The 1.0544× result is an unweighted case-level geometric mean for the changed-path population, equivalent to about 5.16% less measured CPU time. It is not a whole-engine, browser-FPS, or physical-GPU multiplier.

No eligible control met both the material-regression threshold (`candidate / baseline < 0.94×`) and the global Benjamini–Hochberg screen (`q <= 0.05`). This does not mean every control point estimate improved.

Reproduce the frozen evidence gate:

```bash
npm run bench:v1.13:gate
```

Rerun all timed cases:

```bash
npm run bench:v1.13:1000
```

The stored v1.11 and v1.12 gates remain bound to their historical renderer/source identities. The v1.13 matrix and history-gap audit supersede them for the current tree; running an older gate directly against the v1.13 renderer is expected to reject the identity mismatch.

## Direct cumulative soft-system comparison

The earliest directly comparable full cloth/rope/water baseline is v1.2. Fresh isolated-process measurements against corresponding maximum-detail v1.10 production workloads found:

| CPU simulation + handoff workload | v1.2 | v1.10 | Speedup |
|---|---:|---:|---:|
| Tensioned Membrane cloth | 6.5829 ms | 0.8966 ms | **7.342×** |
| Rope Net Resonance | 0.9573 ms | 0.3486 ms | **2.746×** |
| Leviathan water | 0.4360 ms | 0.0327 ms | **13.342×** |
| Geometric mean | — | — | **6.455×** |

These corresponding-workload ratios already contain multiple layout, scheduling, WASM, and handoff changes. They are not multiplied by later release aggregates. See the [original-baseline report](benchmarks/results/original-v1.2-v1.9.md).

## Retained gain map

### Soft presentation, traffic, and assets

| Retained path | Result | Current boundary |
|---|---:|---|
| Intact cloth logical handoff | 81,600 → 20,400 B; **75.00% lower** | Positions are dynamic; rest pose/topology are cached; WGSL reconstructs presentation |
| Rope logical handoff | 33,120 → 4,116 B; **87.57% lower** | WebGPU compute expands compact rope data; constraints remain CPU/WASM |
| Water logical handoff | 309,200 → 77,360 B; **74.98% lower** | `eta/u/v` remain authoritative; WGSL reconstructs the 2.5D surface |
| Tearing-cloth packed surface | **66.12% lower steady traffic** than the original 48-byte path | Only topology-changing cloth uses this fallback now |
| KTX2 BC4 | **49.73% smaller file; 50.00% less resident payload** | Direct BC4 upload with R8/procedural fallback; fetch overlap was neutral locally |
| Unchanged soft frames | **0 additional upload bytes** | Exact version/identity-keyed work elimination |

### Soft simulation and retained memory

| Retained path | Result | Boundary |
|---|---:|---|
| Qualified adaptive cloth, long horizon | **1.555× geometric mean** | Qualified intact layouts only; fidelity ceiling 0.2% |
| Qualified adaptive cloth, projectile storms | **1.435× geometric mean** | Tearing and conservative collision layouts remain on full schedules |
| Qualified rope batching | **1.0964× fresh five-scene geometric mean** | 38 of 250 scene/stress combinations; remaining 212 are controls |
| Soft retained typed memory | **38.74% lower overall** | v1.11 audit across all 150 independently constructed soft scenes |
| Water construction | **1.375×** | Initialization only, not solver or FPS |
| Water retained typed memory | **28.24% lower** | Maximum-water construction audit |

### Renderer, staging, and main-loop work

| Retained path | Result | Boundary |
|---|---:|---|
| v1.11 changed CPU paths | **1.067× geometric mean** | Source-frozen v1.11 changed-path population |
| v1.12 changed CPU paths | **1.064× geometric mean** | 28 v1.12 changed production paths |
| Cloth sphere staging | **1.748×** | Exact axis-aligned instance path |
| 768-droplet staging | **4.135×** | Exact axis-aligned instance path |
| Camera sampler | **1.140× geometric mean** | Camera sampling only |
| Effects changed-frame staging | **1.477×** | CPU staging only |
| Effects update | **1.379×** | CPU effect update only |
| Paused diagnostic lines | **752.55×** | Timer-floor cache work elimination, not total-frame speed |
| Mixed active diagnostic/effect lines | **2.134×** | Main-frame line staging |
| Stable v1.13 native-wrapper paths | **1.2291× geometric mean** | 25 eligible changed wrapper cases |
| Stable pointer access | **1.5136×** | Wrapper pointer-read subsystem |
| Wrapper step + pointers | **1.2120×** | Wrapper subsystem |
| Mixed wrapper path | **1.2070×** | Wrapper subsystem |
| Numeric renderer configuration paths | **1.3162× geometric mean** | 20 eligible changed renderer cases; zero Dawn errors |
| Active cloth upload/configuration | **1.2971×** | Renderer CPU/upload path |
| Active water upload/configuration | **1.1722×** | Renderer CPU/upload path |

### Rigid-body and fallback work

| Retained path | Result | Boundary |
|---|---:|---|
| Native v1.13 scene creation | **1.2443× geometric mean** | 50 complete create cases |
| Native v1.13 create + step | **1.0762× geometric mean** | 30 complete qualified cases |
| Static-heavy native synchronization | **1.678×** | Dense path remained 0.997× parity |
| Mixed native preparation | **1.157×** | Exact sync/explosion preparation path |
| Active 4,096-body rigid upload | 327,680 → 262,144 B; **20% lower** | Colors are independently versioned |
| Settled rigid upload | **0 bytes** | Exact unchanged work elimination |
| Settled native step | **127.51×** | Exact sleeping-world work elimination, not active simulation |
| Fallback explicit synchronization | **1.383×** | Exact subsystem path |
| Fallback explosion miss | **3.554×** | Exact miss rejection; hits retain narrow behavior |
| Fallback contact resolution | **1.063×** | Exact incremental path |
| Fallback lazy replay hash | **1.590×** | Synchronize-only cadence; hashing every frame was parity |

The final v1.13 fallback group measured 0.9983× overall, so selective fallback wins do not support a broad fallback-engine speedup claim.

## Remote-state compression

Predictive structured TurboQuant reduces representative remote simulation packets by roughly 6.7–7.1×. It remains excluded from the local physics-to-WebGPU frame loop because the measured local Worker path was 53.3× slower after encode, transfer, and decode work.

Use it for bandwidth-constrained multiplayer snapshots, spectators, replay archives, cloud simulation, checkpoints, or telemetry. See [TURBOQUANT.md](docs/TURBOQUANT.md).

## Retained v1.13 implementation changes

- Exact eight-entry native hull LRU with MRU-first lookup.
- Cached fallback dynamic-body counts.
- Exact all-static fallback early return.
- Reset-storage reuse.
- Qualified high-count water staging.
- Stable, memory-growth-safe native transform and material pointers.
- Numeric renderer configuration caching.

## Important rejected candidates

| Candidate | Result | Decision |
|---|---:|---|
| SIMD `-O2` versus packaged `-O3` | 0.99480× active GM; max membrane 0.94647× | Rejected |
| Scalar `-Os` versus packaged `-O3` | 0.99476× active GM; max membrane 0.94105× | Rejected |
| Hybrid renderer scratch/string cache | Unchanged cloth 0.4914×; water 0.6436× | Rejected |
| Sparse native move events | 0.998994× removal GM | Reverted |
| Local TurboQuant | 53.3× slower Worker path | Disabled locally |
| Bind-group hoist | 1.0018× Metal aggregate | Reverted |
| Partial uniform write | 0.988× / 0.993× | Reverted |

The [historical gap audit](benchmarks/results/v113-history-gap-audit.md) contains the complete retained/rejected inventory and source locations.

## Evidence policy

- Complete workload, subsystem, bandwidth, memory, work-elimination, and compression numbers keep their original scopes.
- Unrelated ratios are never multiplied into a synthetic engine-wide result.
- Timer-floor cache ratios are not FPS claims.
- Physical-GPU validation proves WebGPU resource and submission behavior, not universal browser performance.
- Historical reports explain why mechanisms remain; the v1.13 source-frozen matrix is the current-source authority.
