# WebPhysics v1.12 — Sixth Production Optimization Pass

Date: July 16, 2026

Version 1.12 reviews the retained v1.2–v1.11 benchmark history against the actual current source, retests missed production paths, and keeps only changes that survive exact-output, determinism, confidence, and complete-workload gates.

## Release result

The final source-frozen tournament compares the exact archived v1.11 source with the measured v1.12 tree.

```text
100 production-path cases
8 timed samples per implementation and case
equal baseline-first and candidate-first ordering
20,000 deterministic stratified-bootstrap resamples
25 ms target timed batches where each path's safety cap permits
```

| Outcome | Count |
|---|---:|
| Accepted measured wins | **14** |
| Borderline / inside noise | **14** |
| Rejected — no win | **0** |
| Rejected — correctness | **0** |
| Unchanged controls | **72** |
| **Total** | **100** |

Across the 28 changed production paths, the point-estimate geometric mean is **1.0640×** and the median is **1.0477×**. All 200 baseline/candidate groups were deterministic; all 16 explicitly unchanged before/after groups were bit-exact. These are CPU simulation and frame-preparation results on Apple M3 Ultra, not a universal browser-FPS multiplier.

The exact evidence is in:

- [`benchmarks/results/v112-production-100.json`](../benchmarks/results/v112-production-100.json)
- [`benchmarks/results/v112-production-100.md`](../benchmarks/results/v112-production-100.md)
- [`scripts/check-v1.12-results.mjs`](../scripts/check-v1.12-results.mjs)

The frozen v1.11 archive SHA-256 is `7583322b353b6aca546fb36223737adbabf9511678c235a9ec7177546ac06537`. The measured v1.12 candidate digest is `c27e51857777bbe9cd096f48aeddba26af61fd43d6592206298f70446c1097e7`, and the final harness digest is `fa5e84dc492bb4004e4ae76702ae613fe4e2f097e6dae9e817cdaec820460bdd`.

## Retained optimizations

### Full batched Racing Sail projection

The Racing Sail variant-5 layout was the one intact-cloth recipe still leaving an already-qualified full batch on the table. Its five production cases now use the persistent WebAssembly batched solve. Every state and render fingerprint remains exact.

| Mode | Speedup | 95% interval |
|---|---:|---:|
| Baseline | **1.0486×** | 1.0294–1.0652× |
| High Stress | **1.0468×** | 1.0280–1.0636× |
| Precision | **1.0491×** | 1.0400–1.0580× |
| Impact Demo | **1.0504×** | 1.0366–1.0603× |
| Cinematic | **1.0451×** | 1.0162–1.0612× |

Collider-drape and Cargo Net variants were deliberately not presented as wins: their complete solver groups remain close to parity. The retained matrix specialization is independently qualified below; the broad solver path remains conservative.

### Axis-aligned soft-instance matrices

Sphere colliders and water droplets have zero Euler rotation. A dedicated writer emits the same float32 matrix bits without evaluating the general rotation path.

| Complete frame path | Speedup | 95% interval | Exactness |
|---|---:|---:|---|
| Cloth sphere stream | **1.748×** | 1.687–1.785× | bit-exact |
| Water frame with 768 droplets | **4.135×** | 4.087–4.185× | bit-exact |

The 100-case water-rain group measured **1.1129×** geometric mean across five changed scene paths. All five cases were accepted independently, and no correctness failure occurred.

### Exact cinematic-effect drag factors

Five built-in drag factors depend only on the frame delta and are now computed once per update rather than once per particle. The focused benchmark compared 360 complete effect frames and 528,840 scalar outputs; float32 matrices/colors, lines, shake, counts, and frame versions were exact.

| Timed scope | Geometric mean | Minimum workload |
|---|---:|---:|
| `CinematicEffects.update` | **1.314×** | 1.084× |
| `update` plus `buildFrame` | **1.093×** | 1.044× |

Evidence: [`benchmarks/results/v112-effects-drag.md`](../benchmarks/results/v112-effects-drag.md).

### Allocation-free cinematic camera sampling

The active director now samples into the existing camera rig and directly selects the segment in the fixed five-key track. Across 123,030 samples, all outputs matched v1.11 exactly.

| Workload | Speedup | 95% interval |
|---|---:|---:|
| Interior track | **1.126×** | 1.113–1.136× |
| 60 Hz tour | **1.035×** | 1.023–1.047× |
| Endpoint/clamp sampling | **1.271×** | 1.256–1.285× |

Geometric mean: **1.140×**. Evidence: [`benchmarks/results/v112-ui-hotpaths.md`](../benchmarks/results/v112-ui-hotpaths.md).

### Hybrid native Box3D transform synchronization

The native bridge now tracks dynamic body indices and chooses between indexed and sequential transform synchronization. Indexed traversal is used when static bodies dominate; dense worlds retain the sequential scan. Common revision/hash logic remains shared.

The benchmark compares the exact frozen v1.11 artifact with the rebuilt v1.12 artifact using 24 samples per implementation/case, balanced order, 20,000 bootstrap resamples, and exact matrices, colors, replay hashes, counters, and observable state.

| Native bridge workload | Speedup | 95% interval | Decision |
|---|---:|---:|---|
| Static-heavy explicit sync | **1.678×** | 1.666–1.686× | accepted |
| Nearly-all-dynamic sync | 0.997× | 0.992–1.017× | parity control |
| Static-heavy far explosion | 0.997× | 0.991–1.006× | parity control |
| Dense far explosion | 0.991× | 0.985–1.002× | parity control |
| Mixed sync/explosion frame prep | **1.157×** | 1.149–1.164× | accepted |

Accepted-path geometric mean: **1.393×**. The nearly-all-dynamic path proves the density switch avoids the regression seen in the first indexed-only candidate. Evidence: [`benchmarks/results/v112-native-candidates.md`](../benchmarks/results/v112-native-candidates.md).

## Missed or misclassified coverage corrected

- Rain Impact Reservoir creates rain internally; it is now classified as a changed water-rain path instead of a dry control.
- Collider-drape scene IDs 637 and 647 were added so all five sphere-collider presentation modes are exercised.
- Native build provenance now records the actual Unix Makefiles generator and GNU Make 3.81 rather than an unverified Ninja claim.
- The native soak now checks the bridge-source SHA-256 against the tracked build provenance before executing the artifact.
- CI, Pages, publish scripts, the pull-request template, repository self-test, and source-manifest rules now target `validate:v1.12`.
- Finder-generated duplicate files are preserved for the user but excluded from the canonical release manifest and publish copy.

## Candidates tested and rejected

The pass did not keep every microbenchmark winner.

| Candidate | Why it was rejected |
|---|---|
| Cached fallback `dynamicCount` / traversal | An isolated query was very fast, but the complete fallback frame regressed; the source was restored byte-for-byte to v1.11. |
| Rope tuple-removal variants | Payload and debug paths did not produce a stable complete-path win; reverted. |
| Indexed cube geometry | Metal measurements were about 0.984–0.990× and pixel output differed by one channel step; reverted. |
| Stateful camera-segment cache | Random access regressed to 0.990× and the tour reached only 1.023×; direct five-key selection won. |
| Broad cloth batching / specialized C projection | Some pilots were fast, but broader complete workloads regressed or failed the confidence policy; only the Racing Sail qualification remains. |
| Indexed-only native transform sync | Regressed nearly-all-dynamic worlds; replaced with the density-aware hybrid. |
| Native indexed kick and explosion rewrites | Linked-WASM results were 0.877× or failed to show a stable end-to-end gain; fully reverted. |
| Local TurboQuant | Retained only for remote/network/replay state. Previous testing found about 7× smaller packets but substantially slower local Worker transport. |

Excluded pilots and rejected-candidate records remain under [`benchmarks/results/diagnostics`](../benchmarks/results/diagnostics/); they are not counted in the final 100 cases.

## Cumulative baseline context

The prior reproducible v1.2-to-v1.10 comparison remains the clean cumulative soft-system result: **7.342× cloth**, **2.746× rope**, and **13.342× water**, or **6.455× geometric mean**, with zero correctness failures. The v1.12 ratios above must not be multiplied blindly into those values because the workload sets and scopes differ.

Retained architectural gains from earlier passes include persistent SIMD/scalar WebAssembly kernels, GPU-resident intact cloth and shallow-water reconstruction, GPU-compute rope presentation expansion, exact unchanged-frame/upload caches, 24-byte packed tearing surfaces, `uint16` topology, KTX2 BC4/R8 textures, coherent preview broadphase, projectile AABB rejection, remote-only TurboQuant, and measured quality profiles.

## Reproduction

```bash
npm ci
npm run verify:source
npm run bench:v1.12:100
npm run bench:v1.12:runtime
npm run bench:v1.12:effects
npm run bench:v1.12:ui
npm run bench:v1.12:native
npm run bench:v1.12:gate
npm run validate:v1.12
npm run validate:hardware
```

`validate:hardware` requires the Dawn Metal backend and timestamp-query support. The final browser playtest remains a visible acceptance check rather than a physical-GPU performance claim.
