# Box3D WebGPU AAA v1.9.0 — Adaptive-Cloth / GPU-Rope Breakthrough Report

## Executive result

Version 1.9 attacks the dominant costs left after GPU-resident water and intact-cloth rendering. It introduces a fidelity-gated adaptive cloth projection schedule, removes the per-frame intact-cloth strain stream, and reconstructs rope segment matrices, thickness, tension colors, and shadow instances in a WebGPU compute pass from compact node positions and static segment metadata.

### Exactly 100 production-path experiments

- Experiments: **100**
- Samples per experiment: **5**
- Sequential isolated shards: **4 × 25 experiments**
- Baseline and optimized order alternated within every experiment.
- Warm-up precedes every timed loop; medians and median absolute deviations are retained.
- Every changed path is checked for finite state, counts, deterministic behavior, bounded cloth state error, and reconstructed rope matrix/color fidelity.

- Accepted measured wins: **69**
- Borderline results: **15**
- No-win rejections: **6**
- Unchanged controls: **10**
- Correctness failures: **0**
- Changed-path geometric mean: **1.670×** — dominated by the isolated rope handoff and not a whole-engine multiplier.

| Category | Tests | Geometric mean | Median | Accepted | Mean dynamic-byte reduction |
|---|---:|---:|---:|---:|---:|
| cloth-full | 30 | **1.132×** | 1.067× | 24 | 25.0% |
| cloth-adaptive-long | 10 | **1.555×** | 1.609× | 10 | 25.0% |
| cloth-adaptive-storm | 5 | **1.435×** | 1.358× | 5 | 25.0% |
| rope-frame | 20 | **5.969×** | 5.474× | 20 | 84.9% |
| rope-full | 20 | **1.026×** | 1.026× | 9 | 84.9% |
| rope-storm | 5 | **0.994×** | 0.972× | 1 | 52.3% |
| tearing-control | 5 | **0.997×** | 0.995× | 0 | 0.0% |
| water-control | 5 | **1.010×** | 1.001× | 0 | 0.0% |

### Independent fresh-process proof

- Samples per workload: **7**
- Paired-bootstrap resamples: **10,000**
- Each measurement uses a fresh Node process; process startup is excluded from the timed loop.
- Two sequential five-workload shards avoid the execution environment’s process-spawn quota effects.
- Version order alternates and both versions use packaged SIMD soft kernels.

- Changed-path geometric mean: **1.875×**
- Dynamic/mixed geometric mean: **1.326×**
- Correctness failures: **0**

| Workload | v1.8 ms | v1.9 ms | Speedup | Paired 95% interval | Dynamic bytes |
|---|---:|---:|---:|---:|---:|
| Cargo net · adaptive solver + handoff | 1.831857 | 1.399664 | **1.309×** | 1.271–1.364× | 27,200 → 20,400 |
| Maximum membrane · adaptive solver + handoff | 1.723008 | 0.911298 | **1.891×** | 1.818–1.980× | 27,200 → 20,400 |
| Maximum membrane · 72-projectile storm | 3.381344 | 2.137002 | **1.582×** | 1.513–1.679× | 27,200 → 20,400 |
| Maximum rope · CPU render handoff | 0.013656 | 0.000908 | **15.039×** | 14.791–15.755× | 32,160 → 4,116 |
| Maximum rope · solver + handoff | 0.701210 | 0.687999 | **1.019×** | 0.997–1.049× | 32,160 → 4,116 |
| Maximum rope · 96-impact storm | 1.148120 | 1.176055 | **0.976×** | 0.965–0.998× | 37,040 → 11,396 |
| Maximum cloth + rope + water | 2.650116 | 1.902195 | **1.393×** | 1.387–1.440× | 136,640 → 101,796 |
| Tearing cloth · topology control | 7.367745 | 7.365089 | **1.000×** | 0.981–1.020× | 39,168 → 39,168 |
| Maximum water · unchanged control | 0.137275 | 0.139033 | **0.987×** | 0.912–1.109× | 77,280 → 77,280 |
| Regular cloth · non-adaptive control | 1.387506 | 1.313566 | **1.056×** | 1.031–1.081× | 21,824 → 16,368 |

## Breakthrough 1 — adaptive cloth projection

Intact cloth originally used the same projection schedule for every layout. The v1.9 search measured long-horizon behavior for every cloth family and retained a faster schedule only for variants that remained below the release fidelity ceiling:

```text
structural constraints  → every projection pass
shear/bend constraints   → measured lower cadence
sphere-contact drape     → conservative every-pass path
tearing topology         → original mutable JavaScript path
```

The ten adaptive long-horizon workloads measured **1.555×** geometric-mean speedup, while five projectile-storm workloads measured **1.435×**. The broader 30-scene cloth set measured **1.132×**.

Maximum recorded relative state error across all 100 experiments was **0.08427%**, below the 0.2% release ceiling. The separate long-horizon qualification run reached 720 frames with kicks, explosions, and projectile rain; the worst observed relative position error was approximately 0.0915%.

## Breakthrough 2 — GPU-compute rope reconstruction

Rope constraints still solve in SIMD/scalar WebAssembly, but v1.8 rebuilt a full 4×4 matrix and RGBA stress material for every segment on the CPU. Version 1.9 instead uploads compact state and reconstructs the instance stream in WebGPU compute:

```text
v1.8 per frame
segment matrices + colors ≈ 80 bytes per rendered segment

v1.9 per frame
node positions             = 12 bytes per node
segment topology/material  = static until a break
WebGPU compute             = orientation + scale + stress color
```

The 20 rope handoff workloads measured **5.969×** geometric-mean CPU preparation speedup and **84.9%** mean dynamic-byte reduction. The maximum fresh-process scene measured **15.039×** and reduced dynamic data from 32,160 to 4,116 bytes.

Reconstructed matrices and colors match the legacy stream to floating-point noise: maximum tournament matrix relative L2 **1.118e-09**, maximum color relative L2 **2.708e-07**.

## Traffic reductions

- Intact cloth steady dynamic data falls from 16 to 12 bytes per vertex: **25% less**.
- Maximum rope steady dynamic data falls from 32,160 to 4,116 bytes: **87.20% less**.
- The mixed maximum cloth/rope/water workload falls from 136,640 to 101,796 dynamic bytes: **25.50% less**.
- Static cloth rest positions, rope topology/material metadata, and unchanged frame revisions are cached.

## Convergence and rejected directions

The rope solver itself is now the dominant rope cost. The fresh maximum-rope solver + handoff workload measured 1.019× and the 96-impact storm measured 0.976×, so v1.9 does not claim a solver breakthrough there. The GPU reconstruction path is retained because it removes CPU work, cuts bandwidth, passes Dawn, and improves rendering scalability; further rope speedups must target constraint solving or parallelism.

Tearing cloth and water controls remained at parity. Candidates that exceeded the cloth fidelity ceiling or failed to improve the measured workload were not promoted.

## Reproduction

```bash
npm ci
npm run bench:fifth:100
npm run bench:v1.8-v1.9
npm run bench:fifth:gate
npm run validate:v1.9
```

Raw evidence: `benchmarks/results/v1.9-fifth-breakthrough-100.json` and `benchmarks/results/v1.8-v1.9-isolated.json`. The exact v1.8 source baseline is bundled at `benchmarks/baselines/box3d-webgpu-v1.8.0-source.tar.gz`.

## Validation boundary

Dawn validates the rope compute shader, storage-buffer layouts, compute-to-render synchronization, main/shadow pipelines, indexed cloth/water draws, upload caching, HDR/MSAA integration, and command submission. These CPU and Dawn measurements do not establish a universal target-Mac physical-GPU FPS multiplier. Target-device timestamp queries and visible pixel inspection remain hardware acceptance gates.
