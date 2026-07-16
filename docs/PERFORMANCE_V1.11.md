# WebPhysics v1.11 — Exact Work-Elimination Performance Report

## Release status

This is the source-frozen v1.11 report. The dedicated camera, main-frame staging, soft-system, fallback, native Box3D, renderer-resource, rejection, fidelity, and visible-browser artifacts are complete. `npm run bench:v1.11:gate` is the release authority: it fails if a required artifact is stale, incomplete, incorrectly classified, or outside its correctness boundary.

The exact comparison baseline is the bundled v1.10 source archive:

```text
benchmarks/baselines/box3d-webgpu-v1.10.0-source.tar.gz
SHA-256 dea18ff88e86568e5449c9dece5610d0dfadf38d901eef1c1e39155c64e8c3f5
```

## Executive result

Version 1.11 revisits claims and rejected candidates from the earlier optimization passes, searches for optimizations that were described but not actually present in the source, and retains only changes that clear their relevant correctness and measurement gates.

The pass found useful work in six places:

1. allocation-free camera matrix construction and exact matrix caching;
2. version-keyed main-loop debug/effect line staging;
3. exact broad-rejection and right-sized storage in cloth, rope, and water;
4. exact static-stream, explosion, contact-pair, and lazy-hash improvements in the JavaScript fallback;
5. native Box3D settled-step elimination, lazy replay hashing, and independently versioned transform/material uploads;
6. removal of a dead packed-water shader and two dead render pipelines.

These gains have different scopes. Camera resolve, main-frame line staging, replay hashing, explosions, contact resolution, renderer resource creation, and upload volume are subsystem measurements. They are not multiplied together and are not presented as a universal frame-rate multiplier.

## Exactly 100 production-path experiments

The source-diverse release tournament uses:

```text
100 cases
8 timed samples per version and case
full workload scale
equal baseline-first and candidate-first samples for every case
warm-up before timed regions
median and median absolute deviation
speedup = geometric mean of the two order-stratified median ratios
200 deterministic version groups
10 exact unchanged-frame groups
```

Final balanced result:

- Accepted measured wins: **20**
- Borderline: **2**
- Rejected, no win: **4**
- Controls: **74**
- Retained-path correctness failures: **0**
- Changed-path geometric mean: **1.067×**
- Changed-path median: **1.090×**

| Category | Cases | Geometric mean | Correctness failures | Interpretation |
|---|---:|---:|---:|---|
| Cloth SIMD-WASM | 30 | 1.042× | 0 | Five qualified fused scenes, six exact sphere-collider paths, and 19 controls |
| Rope SIMD-WASM | 25 | 1.005× | 0 | All 25 are conservative controls; dedicated explosion gains are reported separately |
| Fallback rigid preview | 15 | 1.031× | 0 | Final exact contact path included: 9 accepted, 2 borderline, 4 no-win |
| Cinematic effects | 10 | 0.987× | 0 | All 10 are controls |
| Water | 10 | 0.997× | 0 | All 10 are controls; no water-solver win is claimed in v1.11 |
| JavaScript soft systems | 5 | 1.035× | 0 | All five are conservative controls |
| Unchanged-frame controls | 5 | 1.014× | 0 | Exact timer-floor controls; all 10 before/after fingerprints match |

The changed-path geometric mean is the broadest CPU production-path number in this pass. It must not be confused with the much larger isolated subsystem results below.

## Gain 1 — exact camera matrix reuse

The old main loop built projection, view, light-view, multiplication intermediates, and eye vectors as fresh arrays. Version 1.11 adds allocation-free `Into` matrix functions and a `CameraMatrixCache` that invalidates only the matrices affected by changed inputs.

Across 4,096 fidelity cases, the optimized and v1.10 camera outputs had:

```text
view-projection Float32 bit mismatches        0
light-view-projection Float32 bit mismatches  0
eye-value mismatches                          0
source-level allocations per cached resolve  0
```

| Camera workload | v1.10 → v1.11 speedup | Scope |
|---|---:|---|
| Static camera | **19.35×** | Matrix resolve only |
| Continuous orbit | **2.83×** | Matrix resolve only |
| Fully changing cinematic camera + shake | **1.48×** | Matrix resolve only |
| 30-frame mixed keyframes | **11.67×** | Matrix resolve only |

Even the fully changing path is faster because the in-place math removes temporary arrays; the very large static and keyframe results include exact cache reuse.

## Gain 2 — main-frame diagnostic/effect line staging

The main loop previously reconstructed and concatenated rigid debug wireframes, soft-system diagnostic lines, and effect lines every render frame, even when none of those sources changed. Version 1.11 retains the combined list behind explicit source versions and returns the identical list object on an unchanged frame.

The proof compares 4,096 mixed active, paused, and toggle frames; every line count and all ten float fields per line are exact. It also records 1,812 unchanged-frame identity checks.

| Line-staging workload | Speedup | Paired 95% interval |
|---|---:|---:|
| Paused diagnostics | **752.55×** | 559.34–800.19× |
| Paused effects | **28.65×** | 28.25–29.22× |
| Mixed 60 Hz activity | **2.134×** | 2.111–2.148× |
| Active diagnostics, forced rebuild every frame | **1.271×** | 1.256–1.277× |

The paused results are exact work elimination at tens of nanoseconds per cache lookup and must not be read as total-frame gains. The mixed workload is the more representative staging result. The active control changes every source version every frame, forcing a rebuild and proving that paused reuse does not hide an active-path regression. The renderer's own line packing/upload cache remains independent and downstream.

## Gain 3 — exact soft-system work and memory reductions

The soft-system audit found safe exact improvements that were separate from the deliberately approximate cloth schedule:

- squared-distance miss prechecks for sphere contact and cloth/rope explosions;
- exact `Math.hypot` narrow paths retained for hits and boundary behavior;
- unused cloth UV arrays removed;
- intact GPU-cloth CPU-only strain, normal, packed-surface, and base-color storage removed;
- instance buffers right-sized from exhaustive action ceilings rather than broad global maxima.

| Workload | Speedup | Correctness |
|---|---:|---|
| Construct all 150 soft scenes | **1.046×** | Exact constructors/caps |
| Sphere-collider solve, 10 scenes × 36 frames | **1.143×** | Exact fingerprints |
| Cloth explosion actions, 50 scenes × 32 | **3.918×** | Exact fingerprints |
| Rope explosion actions, 50 scenes × 32 | **3.768×** | Exact fingerprints |

Retained typed-array memory fell by **38.74%** on average across all 150 independently constructed soft scenes. The domain reductions were:

| Domain | Retained memory reduction |
|---|---:|
| Intact cloth | **34.72%** |
| Tearing cloth | **23.24%** |
| Rope | **80.08%** |
| Water | **27.43%** |

The audited exact capacity ceilings are 161 cloth instances, 97 rope instances, and 788 water instances. All 150 recipes were saturated through the public action APIs without candidate-side clamping or a baseline/candidate action-count mismatch.

## Gain 4 — fallback rigid-body exact paths

### One-time static streams

Static fallback bodies now write their transform and material once when they are created. Recurring transform synchronization touches dynamic bodies only. Across 15 representative rigid scenes, the isolated stream synchronization path measured **1.383× geometric mean**, with exact detached output captures.

### Broad-rejected explosions

Explosion handling now uses scalar arithmetic, a conservative squared-distance miss rejection, and the exact legacy normalization path for possible hits and boundary cases. The 15-scene action benchmark measured **3.554× geometric mean**. All zero-axis, adjacent-boundary, minimum-radius, and large-finite-radius suites were exact.

### Allocation-free AABB contact resolution

The historical reports described an in-place scalar AABB resolver, but the source still allocated temporary vectors through `sub`, `scale`, and `add`. Version 1.11 closes that gap while preserving the original operation order and random choice behavior.

The final proof uses 21 samples, 72 timed frames per sample, 504 exact comparisons, and 50,000 paired-bootstrap resamples:

```text
geometric mean vs immediate control   1.063×
paired-bootstrap 95% interval         1.054–1.072×
minimum scene speedup vs control      0.980×
geometric mean vs archived v1.10      1.247×
```

The immediate control contains the other v1.11 fallback gains, so the 1.063× contact result is incremental. The 1.247× archive result is not multiplied by the separate static/explosion figures.

### Lazy fallback replay hashing

Deferring the replay scan until telemetry asks for it measured:

| Cadence | Geometric mean | Decision |
|---|---:|---|
| Synchronize only | **1.590×** | Retain |
| Telemetry every 12 synchronizations | **1.502×** | Retain |
| Hash every synchronization | 0.994× | Parity/non-win |

This is an explicit cadence optimization, not an unconditional engine speedup.

## Gain 5 — native Box3D stream/version work elimination

Native Box3D now exposes independent transform and color revisions plus an awake count. A final transition into sleep still synchronizes once; subsequent settled frames skip the native step/sync path until an action wakes the world. Materials have their own immutable revision, so an active rigid frame uploads matrices without redundantly uploading unchanged colors.

| Native workload | Result | Interpretation |
|---|---:|---|
| Dense active step, 2,310 bodies | 1.009×, 95% interval 0.980–1.021× | Parity; no speedup claimed |
| Sparse active step, 25 bodies | 1.015×, 95% interval 0.946–1.066× | Parity; no speedup claimed |
| Settled step, 24 bodies | **127.51×**, 95% interval 114.50–137.24× | Exact work elimination |
| Active upload, 4,096 bodies | 327,680 → 262,144 bytes | **20% less** |
| Color-only upload | 65,536 bytes | Independently versioned |
| Settled unchanged upload | **0 bytes** | Exact work elimination |

Dawn Metal recorded zero uncaptured WebGPU errors for the real queue-write paths.

Native replay hashing is also cadence-sensitive:

| Bridge workload | Speedup | Decision |
|---|---:|---|
| Synchronize transforms only | **12.56×** | Retain subsystem win |
| Hash every 12 synchronizations | **6.06×** | Retain subsystem win |
| Hash every synchronization | 0.921× | Reject as a fast cadence |

The table measures the exported native synchronization bridge with 4,096 bodies, not total Box3D simulation or total frame time.

## Gain 6 — dead packed-water startup resources removed

Every water recipe in the 750-scene catalog uses the GPU-resident water path. The renderer still compiled an older packed-water WGSL module and created two packed-water render pipelines that no live water scene could select. Version 1.11 removes them and encodes the cloth-only packed-surface invariant in the types and tests.

```text
shader modules       12 → 11
render pipelines     18 → 16
compute pipelines     1 → 1
rendered pixel hashes exact
uncaptured WebGPU errors 0
```

Nine fresh-process Metal samples reported a 1.051× ratio of startup medians, but the distributions overlap the declared noise boundary. The release therefore retains and describes this only as **strict resource and pipeline elimination**. It is the one v1.11 accepted change that does not require a timing-confidence win.

## Rejected — exact shadow-map reuse

The candidate reused a completed shadow map only when the light-space projection, shadow texture generation, rigid matrices/count, effects, soft instances, GPU-rope state, cloth positions/topology, and surface path were unchanged. Camera/view and shadow-strength changes correctly reused light-space depth.

It passed the dependency matrix, exact pixels, zero-error Metal checks, and showed large paused-frame wins:

```text
paused rigid                     1.352×  [1.297, 1.405]
camera-orbit rigid               1.358×  [1.306, 1.412]
paused cloth                     1.373×  [1.262, 1.491]
camera-orbit cloth               1.364×  [1.285, 1.437]
exact pixel comparisons          4 / 4
uncaptured WebGPU errors         0
```

However, the separately compiled active rigid control produced a CPU-submit speedup confidence interval whose lower bound was **0.97938**, below the required 0.98 non-regression floor. The miss was small, but the predeclared gate is binding: the cache was fully reverted and remains rejected evidence rather than a release gain.

## Fidelity boundary for the fused cloth schedule

An earlier search applied the fused cloth integration/projection schedule too broadly. That looked faster but failed long-horizon or interaction fidelity in 19 of 100 aggressive search cases; the separate qualification-guard search rejected 10 more correctness cases. Those candidates remain evidence, not source.

The retained schedule is limited to five qualified cloth scenes. The final long-horizon audit covers all 100 cloth/rope scenes:

```text
fast-path cloth scenes         5
conservative cloth/rope       95
passed                       100
failed                         0
maximum state relative L2      0.07874%
maximum render relative L2     0.05535%
release state ceiling          0.20000%
```

Eight targeted interaction schedules also pass actual, dynamic-guard, and pre-armed-guard paths. Rope remains fully conservative because the broader fused rope path changed projectile/rain break behavior.

## Rejected renderer candidates

Actual Metal tests rejected and reverted four plausible shader edits because their confidence intervals did not prove stable benefit:

| Candidate | Changed-path geometric mean | Paired 95% interval | Decision |
|---|---:|---:|---|
| PCF center-sample rewrite | 0.978× | 0.924–1.034× | Revert |
| Squared-distance fog | 1.027× | 0.986–1.069× | Revert |
| HDR depth discard | 1.021× | 0.981–1.065× | Revert |
| Combined shader candidate | 0.996× | 0.966–1.027× | Revert |

The Box3D move-event transform-stream candidate was also rejected and reverted: **0.979×** on the dense-active workload, with a 95% interval of 0.957–1.014×.

## Historical gains reviewed and preserved

The audit confirmed that the major earlier-chat gains already present in v1.10 remain in the source and are not double-counted as v1.11 wins:

- packed 24-byte dynamic surfaces and 16-bit indices;
- BC4 KTX2 texture delivery with R8 fallback;
- coherent sweep-and-prune and broad collision rejection;
- SIMD/scalar WebAssembly soft kernels;
- exact frame and upload revision caches;
- GPU-resident water and intact-cloth reconstruction;
- GPU-compute rope render reconstruction;
- fidelity-gated adaptive cloth projection;
- TurboQuant for remote/replay transport only.

TurboQuant remains intentionally disabled in the local physics-to-render loop. Its roughly 7.1× packet reduction is valuable across a bandwidth-constrained remote boundary, but the measured local Worker path was slower because codec work dominated the already-cheap transferable-buffer handoff.

## Reproduction and evidence

```bash
npm ci
npm run bench:v1.11:100
npm run bench:v1.11:fallback
npm run bench:v1.11:gate
npm run validate:v1.11
```

Primary machine-readable evidence:

```text
benchmarks/results/v111-production-100.json
benchmarks/results/camera-path-v110.json
benchmarks/results/v111-main-frame-lines.json
benchmarks/results/v111-soft-exact-gains.json
benchmarks/results/v111-fallback-exact-gains.json
benchmarks/results/v111-fallback-pair-exact-gains.json
benchmarks/results/v111-fallback-lazy-hash.json
benchmarks/results/native-lazy-hash-benchmark.json
benchmarks/results/native-rigid-stream.json
benchmarks/results/native-rigid-upload-metal.json
benchmarks/results/dead-packed-water-startup-metal.json
benchmarks/results/shadow-cache-metal.json
benchmarks/results/renderer-hotpath-metal.json
benchmarks/results/v111-visible-browser-acceptance.json
benchmarks/results/v111-long-horizon-fidelity.json
benchmarks/results/v111-fastpath-interaction-fidelity.json
benchmarks/results/v111-visible-browser-acceptance.json
benchmarks/results/v111-long-horizon-rejected-100.json
benchmarks/results/v111-qualification-guard-rejected-100.json
```

## Honest measurement boundary

The CPU results are measurements on this Apple Silicon/macOS environment. The Metal results use Dawn on the local GPU and validate resource creation, shaders, pipelines, queue writes, frame submission, exact pixel hashes where stated, and uncaptured error behavior.

They do not prove a universal browser FPS multiplier. Total frame rate still depends on scene mix, resolution, quality profile, CPU/GPU balance, browser, driver, and hardware. Subsystem ratios near the timer floor describe removed work in that subsystem; the scene-diverse 100-case tournament is the broader CPU-path result.
