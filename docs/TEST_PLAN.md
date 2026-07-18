# Test Plan — Box3D WebGPU AAA Physics Lab

This plan covers the current v1.13 thousand-case optimization target. The supplied v1.9 archive follows a different original-v1.8.0 lineage; see [`INTEGRATION_V1.9.md`](INTEGRATION_V1.9.md). Current evidence is in [`V1.13_1000_BENCHMARK_MATRIX.md`](V1.13_1000_BENCHMARK_MATRIX.md) and the [`history-gap audit`](../benchmarks/results/v113-history-gap-audit.md); v1.12, v1.11, and the prior integration map remain in [`PERFORMANCE_V1.12.md`](PERFORMANCE_V1.12.md), [`PERFORMANCE_V1.11.md`](PERFORMANCE_V1.11.md), and [`V1.10_INTEGRATION_AND_TEST_MATRIX.md`](V1.10_INTEGRATION_AND_TEST_MATRIX.md).

## Quality-gate sequence

```text
source integrity
  → strict TypeScript
  → 22 deterministic Node suites
  → 750 scene constructors / 30 hero definitions
  → repository and UI contracts
  → strict C17 bridge syntax
  → deterministic SIMD/scalar soft-kernel rebuild and integration
  → Dawn WGSL/pipeline/full-frame validation
  → actual renderer runtime validation
  → production bundling
  → 150-scene soft/fluid soak
  → visible browser and native-WASM acceptance
```

## Standard automated gate

```bash
npm run validate:v1.13
```

This command must be run successfully against the manually integrated tree before it is described as validated.

Stages:

1. `tsc --noEmit`;
2. test-only CommonJS compilation;
3. 22 deterministic Node suites;
4. repository self-test;
5. strict C17 bridge syntax/API-contract test;
6. SIMD/scalar soft-kernel rebuild, numerical tests, and scene integration;
7. Dawn WebGPU pipeline/full-frame test;
8. actual renderer runtime and cache test;
9. all JavaScript/SIMD/scalar soft-system soaks;
10. retained v1.9/v1.10/v1.11 benchmark-evidence consistency gates;
11. the source-frozen v1.13 1,000-case evidence gate;
12. Vite production and relative-base Pages builds;
13. moderate-or-higher npm audit;
14. final source-integrity verification.

## Node suites

| Suite | Purpose |
|---|---|
| `testMath` | matrix identity/multiplication and finite projections |
| `testAllocationFreeCameraMatrices` | retained camera writers match allocation-based reference matrices |
| `testSceneCatalog` | exactly 750 unique scenes, 15 families, valid metadata |
| `testHeroShowcaseCatalog` | exactly 30 unique heroes, sorted keys/beats, finite camera sampling |
| `testFallbackCanCreateEveryScene` | every scene creates valid rigid staging, finite transforms, nonzero hash |
| `testFallbackStaticBodiesRemainImmutable` | static preview transforms remain exact across stepping |
| `testAAACinematicSetDressing` | cinematic modes and hero scenes receive and step authored staging |
| `testFeaturedScenesStep` | featured scenes survive multiple fixed steps |
| `testDeterminism` | identical rigid scene/seed/action sequence matches replay hash |
| `testFallbackCoherentBroadphase` | coherent sweep ordering remains deterministic, finite, and capacity-safe |
| `testFallbackContactResolutionReusesBodyVectors` | allocation-free contact resolution remains equivalent and finite |
| `testFallbackCachedCountsStaticStepsAndSceneReset` | cached counts, all-static early return, and reset bookkeeping stay exact |
| `testSoftSimulationCatalog` | all 150 cloth/rope/water scenes construct, step, publish valid surfaces and compact rope topology |
| `testSoftFrameMemoization` | unchanged frames retain identity/version; intact cloth/water and compact rope use GPU contracts |
| `testSoftRetainedStateAndExactInstanceCaps` | retained memory and cloth/rope/water instance ceilings remain bounded |
| `testSoftSimulationActionsAndDeterminism` | soft kick/projectile/explosion/rain actions and paired replay hashes |
| `testFarProjectileBroadRejection` | distant projectiles leave cloth/rope solver state unchanged |
| `testTurboQuantCodec` | deterministic quantization, packet bounds, predictive reconstruction |
| `testBreakthroughStormDeterminism` | collision-heavy retained paths preserve replay and output contracts |
| `testCinematicEffects` | effect budgets, emissive tags, lines, shake, finite streams |
| `testFrameLineStager` | version-keyed diagnostic/effect lines preserve exact staged output |
| `testActions` | rigid impulse, explosion, projectile, rain, body growth, stepping |

## Repository self-test

Checks include:

- required source, docs, workflows, and test scripts;
- package version and all build/test commands;
- C bridge exports and CMake/WASM flags;
- 30 authored hero definitions;
- required HTML IDs exactly once;
- 750-scene family generation including cloth/rope/water;
- soft-system classes, budgets, constraints, water integration, dynamic surfaces;
- SIMD/scalar soft-kernel source, packaged binaries, ABI loader, and JavaScript fallback;
- GPU cloth/water paths, explicit 12-byte/12-byte changed-frame traffic, immutable cloth-rest caching, and frame-version caches;
- compact rope node/segment publication and WebGPU compute expansion;
- HDR/MSAA/shadow/post and cloth/water/rope renderer markers, including the final presentation V flip exactly once;
- WGSL uniformity, pass-depth, and shadow-resource regressions;
- GitHub CI and Pages workflows.

## C bridge syntax gate

```bash
npm run test:cbridge
```

A temporary API-contract header representing the pinned Box3D calls is generated, then `wasm/box3d_web.c` is compiled in syntax-only C17 mode with:

```text
-Wall -Wextra -Werror
```

This does not replace an Emscripten link against real upstream Box3D; it catches syntax, declaration, and warnings-as-errors regressions in constrained environments.

## Soft-kernel gate

```bash
npm run test:soft-kernels
```

The gate rebuilds SIMD and scalar WASM twice and requires byte-deterministic output, checks ABI/version/variant markers, exercises the cloth/rope/water kernels and the retained v1.8.1 rope-instance ABI, verifies SIMD → scalar → JavaScript selection, then runs all 150 cloth/rope/water scenes with paired deterministic replays through JavaScript, packaged SIMD, and packaged scalar execution. The steady v1.9 rope-render path is covered separately by WebGPU tests.

## Dawn WebGPU gate

```bash
npm run test:webgpu
```

The pipeline test validates 11 live WGSL modules and the complete render topology:

- rigid shadow;
- packed cloth-surface shadow;
- GPU cloth storage-buffer shadow;
- GPU rope compute expansion;
- atmospheric sky;
- PBR rigid solids;
- topology-aware packed cloth plus GPU-resident cloth/water compatibility;
- GPU cloth and GPU water storage-buffer reconstruction;
- debug/effect lines;
- post-processing and swapchain-format compatibility.

It creates bind groups, depth/HDR/MSAA attachments, packed vertex buffers, storage buffers, indexed draws, and submits one complete rope compute → shadow → HDR → post command buffer.

The runtime test transpiles and executes the actual `WebGPURenderer` class with rigid, packed, GPU-cloth, GPU-rope, and GPU-water frames, including resize and empty/no-shadow paths. It must check 12-byte changed-frame cloth positions, immutable rest-pose caching, 12-byte water state, compact rope node/segment caching, and zero additional bytes for unchanged surfaces/rope/soft-instance streams. Uncaptured WebGPU errors must remain zero.

## Soft/fluid soak gate

```bash
npm run test:soft-soak
npm run test:soft-soak:wasm
```

Default coverage:

```text
150 scenes × 24 frames = 3,600 catalog frames
3 maximum scenes × 2 paired solvers × 300 frames = 1,800 replay frames
```

The action schedule injects kick, projectile, explosion, and rain events. Every inspected frame must satisfy:

- correct active solver kind;
- initialized nodes and constraints/cells;
- explicit instance budget;
- exact matrix/color stream lengths;
- finite instance and surface values;
- finite nonnegative energy;
- initialized replay hash;
- a valid packed, `gpu-cloth`, or `gpu-water` surface contract;
- valid `ropeGrid` node indices, finite eight-float segment metadata, and monotonic topology/frame versions when rope is active;
- matching frame and topology versions;
- every surface index in range;
- paired deterministic hash equality.

Longer run:

```bash
SOFT_SOAK_FRAMES=120 SOFT_DEEP_FRAMES=1200 npm run test:soft-soak:all
```

## Live browser validation

Click **Run 750 + 30 State Tests**.

The state/catalog gate:

1. stops cinematic playback;
2. creates and steps all 750 scenes against the active rigid backend;
3. builds and validates the active cloth/rope/water frame when present;
4. checks body counts, matrices, colors, indexed surfaces, and hashes;
5. samples every hero camera and validates beat ordering;
6. creates/advances an explosion effect frame;
7. restores the previous scene and UI state;
8. prints the pass summary.

It does not submit all 750 scenes through WebGPU. Use the manual rendering matrix below, plus `npm run test:webgpu`, for actual shader, pipeline, upload-cache, and frame-submission coverage.

## Manual rendering matrix

| Area | Checks |
|---|---|
| Startup | adapter/device/context, readable failure state |
| WGSL | zero compilation errors; warnings reviewed |
| Resize | desktop, narrow layout, high DPR, browser zoom |
| Shadows | rigid and cloth shadows, PCF stability, no feedback error |
| HDR/post | finite output, exposure, bloom, tone map, fog |
| Cloth | GPU normals/weave/stress on intact grids; packed real openings after tears |
| Rope | GPU-compute segment orientation/tension colors, zero-length guard, payloads, breaks, topology refresh |
| Water | GPU geometry/normals/foam, transparency, Fresnel, currents |
| Effects | profile budget, emissive sparks, shockwave alignment |
| Camera/director | orbit, zoom, cuts, slow motion, manual handoff, tour |
| Diagnostics | pins/nodes, rope markers, water current vectors, line budget |
| Backend | preview label; Box3D WASM label after native build |

## Performance matrix

Measure stress 1, 3, and 5 for:

- Titan Foundry Stackfall;
- Aegis Tower: Kinetic Breach;
- Orbital Cargo Storm;
- Tempest Standard Protocol;
- Sky Crane Cable Failure;
- Tsunami Research Array;
- Leviathan Impact Basin.

Record:

```text
browser / OS / GPU
backend and quality profile
viewport / DPR
rigid bodies and soft nodes
constraints/cells and breaks
FX count
FPS
simulation CPU ms
render encode-submit CPU ms
upload MB/frame
replay hash
```

Do not label CPU encode/submit time as GPU time. `npm run validate:hardware` records separate Dawn/Metal timestamp queries on supporting hardware; those measurements still do not establish universal browser FPS.

### V1.13 source-frozen optimization evidence

```bash
npm run bench:v1.13:1000
npm run bench:v1.13:gate
```

The full command runs ten deterministic shards and merges exactly 1,000 registered production cases. Each case records calibrated work, balanced baseline/candidate execution order, medians and dispersion, exact state/render fingerprints, and the frozen source, harness, registry, native-artifact, renderer, and hardware-gate identities. The verification-only release gate checks the persisted result and identities; CI does not rerun the full tournament.

Required reporting boundaries:

- report **1,000 / 1,000** completed and zero correctness failures;
- report 165 accepted wins, 353 borderline changed paths, 360 controls, 85 changed timer-floor cases, and 37 rejected no-win paths;
- exclude every case below 22.5 ms from aggregate timing claims: 203 total, comprising 85 changed paths and 118 controls;
- report the **1.0544254732×** point-estimate geometric mean only over 555 timer-qualified changed CPU production paths on Apple M3 Ultra / Node 26;
- report the **1.0041104525×** control geometric mean only over 242 timer-qualified controls;
- state the control screen exactly: no eligible control met both `candidate / baseline < 0.94×` and global Benjamini–Hochberg `q <= 0.05`;
- do not restate the changed-path aggregate as whole-engine, physical-GPU, or universal browser FPS.

If a timer-qualified control does meet both screen conditions, the merge harness launches the predeclared fresh-process confirmation and applies its familywise criterion before failing the gate. The final v1.13 run did not trigger that stage.

The latest post-tournament Metal rerun is stored under `benchmarks/results/post1000-hardware/`. The hardware snapshots frozen into the 1,000-case result remain its benchmark-closure evidence and must not be silently replaced.

The history-gap qualification must also retain both negative results: SIMD `-O2` and scalar `-Os` remain rejected versus the current `-O3` kernels, and the hybrid renderer scratch cache remains rejected after exact-output/Dawn validation but slower unchanged cloth and water paths. A rejected candidate must never be counted as an integrated gain.

### Supplied v1.9 benchmark evidence

The supplied benchmark files are reference evidence with strict limits:

- they were produced for the archive's exact-release lineage, not this manual integration;
- `npm run bench:fifth:gate` checks recorded result artifacts and does not rerun timing;
- noisy/high-MAD cases must be reported as such rather than generalized;
- CPU simulation/frame-preparation and byte-accounting results do not prove physical-GPU duration, visible output, or FPS.

Use `npm run bench:fifth:100` and `npm run bench:v1.8-v1.9` for a fresh integrated measurement pass after functional validation. Record runtime, device, samples, medians, and dispersion.

## Native build gate

With Emscripten active:

```bash
npm run fetch:box3d
npm run build:wasm
npm run dev
```

Verify artifacts exist and are non-empty, backend reports **Box3D WASM**, memory growth does not detach heap views, rigid projectiles/large stacks use native collision behavior, and the live 750-scene + 30-hero state gate passes. This native rigid-body build is separate from the packaged soft-kernel WASM modules.

## Honesty boundary

When Emscripten or a visible GPU browser is unavailable, source/C/Dawn validation may pass, but visible browser rendering and FPS must not be claimed as executed. This tree bundles and soaks a pinned native Box3D artifact and separately records Dawn/Metal timestamp evidence; neither substitutes for a visible browser pass. `VALIDATION_REPORT.md` records the boundary.
