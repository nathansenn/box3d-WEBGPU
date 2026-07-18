# Box3D WebGPU — AAA Physics Lab

A browser-native 3D physics showcase combining **Box3D rigid bodies**, deterministic **cloth and rope**, interactive **shallow water**, and an HDR **WebGPU** renderer.

Version **1.13.0** ships 750 deterministic capability scenes, 30 directed hero demonstrations, native Box3D WebAssembly artifacts, SIMD/scalar soft-system kernels, and an exact 1,000-case optimization audit.

> This is an AAA-style capability lab and engine foundation. It is not a claim that the numerical Box3D solver runs on WebGPU or that every subsystem of a commercial game engine is complete.

## At a glance

- Native Box3D C17 physics compiled to WebAssembly with Emscripten.
- Deterministic PBD cloth and rope plus a 2.5D shallow-water solver.
- SIMD WebAssembly, scalar WebAssembly, and JavaScript fallback paths.
- GPU-resident presentation for intact cloth and water.
- WebGPU compute expansion of compact rope data.
- HDR rendering, real quality profiles, shadows, PBR-inspired materials, atmospheric effects, and post-processing.
- 750 searchable scenes across 15 simulation families.
- 30 hand-directed cinematic demonstrations.
- Deterministic replay hashes, runtime telemetry, and in-app state tests.
- KTX2 BC4 textures with R8 fallback.
- Optional TurboQuant transport for remote snapshots and replay storage.
- Exact source manifest and reproducible benchmark/validation commands.

## Architecture

```text
Box3D C17 / WebAssembly            Soft-system coordinator
rigid bodies and collisions        cloth PBD · rope PBD · shallow water
             │                     SIMD WASM · scalar WASM · JS fallback
             └──────────────┬───────────────────────────────┘
                            │ fixed 60 Hz coordination
                            ▼
              solver-native state + compact streams
                            │
                            ▼
 WebGPU cloth/water reconstruction · rope compute expansion · rigid instancing
                            │
                            ▼
          shadows · HDR/MSAA · atmosphere · effects · post-processing
```

Box3D remains authoritative for rigid bodies. Cloth, rope, and water numerical solvers run on the CPU through JavaScript or WebAssembly. WebGPU handles rendering, intact-surface reconstruction, rope presentation expansion, and GPU resource work.

## Quick start

Requirements:

- Node.js `^20.19.0` or `>=22.12.0`; CI uses Node 22.
- A current desktop browser with WebGPU support.
- `localhost` or HTTPS. Opening `index.html` directly is not supported.

```bash
npm ci
npm run verify:source
npm run doctor
npm run dev
```

Open the local URL printed by Vite. The release includes the native Box3D browser artifacts in `public/box3d/`; if they cannot load, the app falls back to the deterministic JavaScript preview backend.

Run commands from the repository root—the directory containing `package.json`. Do not run them from `third_party/box3d`, which is the upstream C/CMake dependency.

## What you can simulate

### Rigid bodies

- Box3D collisions, gravity, settling, continuous collision, impacts, and sleeping.
- Fixed 60 Hz stepping with four solver substeps by default.
- Stacks, domino chains, towers, bridges, vehicles, construction sites, warehouses, and demolition scenes.
- Structural impulses, radial explosions, projectiles, and object rain.
- Up to 4,096 staged rigid bodies with compact transform/material streams.
- Deterministic preview broadphase using coherent sweep-and-prune.

### Cloth

- Verlet-style position-based dynamics with structural, shear, and bend constraints.
- Banners, curtains, canopies, hammocks, sails, cargo nets, and tensioned membranes.
- Pin layouts, wind, turbulence, gravity, ground and sphere collision, impacts, and blast response.
- Strain visualization and real topology-aware tearing.
- Adaptive intact-cloth projection schedules qualified against a 0.2% fidelity ceiling.
- Twelve dynamic bytes per intact vertex; rest positions and topology remain static on the GPU.
- WebGPU reconstructs normals, UVs, strain, material color, woven response, and shadow position.
- Tearing cloth uses the topology-aware packed CPU path so holes and disconnected triangles remain correct.

### Rope and rigging

- PBD chains with distance and bend constraints.
- Catenaries, ladders, mooring arrays, cable curtains, slings, ziplines, crane cables, and rope nets.
- Anchors, payloads, tension heat, resonance, projectile severing, explosions, and controlled breakage.
- Compact node and segment state instead of CPU-built matrices and colors.
- WebGPU compute expands rope state into main and shadow instance streams.
- Deterministic JavaScript fallback when the packaged kernels are unavailable.

### Interactive water

- Deterministic 2.5D linear shallow-water heightfield.
- Ripples, reflected waves, storm surfaces, boat wakes, fountains, rain, dam-break fronts, vortices, and impact basins.
- Height and horizontal velocity fields, foam, current diagnostics, droplets, and buoyancy proxies.
- GPU-resident `eta`, `u`, and `v` state at 12 dynamic bytes per cell.
- WebGPU reconstructs geometry, normals, curvature, foam, and translucent material response.
- Unchanged water frames avoid additional dynamic uploads.

## WebGPU presentation

The renderer uses a real multi-pass frame graph:

```text
compact simulation streams
        ↓
directional shadow passes
        ↓
HDR scene pass + rigid/soft/effect geometry
        ↓
atmosphere, emissive effects, and transparent water
        ↓
tone mapping, bloom, vignette, and film grain
        ↓
WebGPU swapchain
```

Key features:

- Shared instanced rigid and effect geometry.
- GPU-compute rope presentation expansion.
- Storage-buffer reconstruction for intact cloth and water.
- Packed indexed fallback for tearing cloth.
- Upload-once `uint16` topology and version-keyed upload caches.
- `rgba16float` HDR scene target.
- One-sample or four-sample MSAA based on quality profile.
- Quality-dependent 1,024² or 2,048² directional shadows with up to 3×3 PCF.
- PBR-inspired GGX solid shading.
- Two-sided woven cloth and transparent Fresnel water.
- Atmospheric sky, stars, sun glow, horizon haze, and distance fog.
- Deterministic sparks, smoke, dust, shockwaves, flashes, and camera shake.
- Runtime WGSL diagnostics and Dawn-backed pipeline tests.

The four render profiles change actual GPU work:

| Profile | Internal scale | MSAA | Shadows | Intended use |
|---|---:|---:|---|---|
| Performance | 70% | 1× | Off | maximum throughput |
| Balanced | 85% | 1× | 1,024² / 1 tap | everyday play |
| Cinematic | 100% | 4× | 2,048² / 3×3 PCF | default showcase |
| Ultra | 115% | 4× | 2,048² / 3×3 PCF | high-end capture |

## Scene library and hero demos

The catalog is generated deterministically:

```text
15 families × 5 presentation modes × 10 variants = 750 scenes
```

| Domain | Scenes | Examples |
|---|---:|---|
| Rigid-body families | 600 | stacks, dominoes, towers, bridges, materials, rain, demolition, vehicles, marbles, construction, logistics, architecture |
| Cloth and fabric | 50 | banners, canopies, hammocks, sails, curtains, membranes |
| Rope and rigging | 50 | crane loads, suspension cables, pendulums, ladders, moorings, nets |
| Interactive water | 50 | ripple basins, flumes, storms, wakes, fountains, reservoirs, vortices |

Thirty hero demonstrations layer authored cameras, timed impacts, slow motion, effects, telemetry locks, and final inspection beats over selected scenes. Press `T` to start the Maximum AAA Tour.

See [AAA_SHOWCASE.md](docs/AAA_SHOWCASE.md) for the complete hero list and [DEMO_GUIDE.md](docs/DEMO_GUIDE.md) for the recommended presentation flow.

## Controls

| Input | Action |
|---|---|
| `T` | start or stop the Maximum AAA Tour |
| `C` | play or pause the selected hero sequence |
| `Space` | apply a broad structural impulse |
| `E` | trigger a radial explosion |
| `F` | fire a projectile |
| `R` | load a random scene |
| `P` | pause or resume simulation |
| `N` | advance one fixed simulation frame |
| `D` | toggle diagnostics |
| `←` / `→` | previous or next scene |
| Mouse drag | leave cinematic mode and orbit |
| Mouse wheel | zoom |

The command deck also provides scene search, category filters, stress levels, time scaling, quality selection, replay hashes, backend state, body counts, soft-system telemetry, simulation/render timings, upload volume, and automated state tests.

## Performance

### Version 1.13: exact 1,000-case audit

The current optimization campaign replayed retained historical work, reviewed missed candidates, and measured exactly **1,000 unique deterministic cases** on an Apple M3 Ultra with Node.js 26.

| Classification | Cases |
|---|---:|
| Accepted measured wins | 165 |
| Borderline changed paths | 353 |
| Control cases | 360 |
| Changed paths below the timing floor | 85 |
| Rejected—no win | 37 |
| Correctness failures | **0** |

The predeclared timing floor is 22.5 ms. All 203 cases below that floor—85 changed paths and 118 controls—are excluded from aggregate timing claims.

Across the remaining 555 timer-qualified changed CPU paths, the unweighted case-level geometric mean is **1.0544254732×**, equivalent to about **5.16% less measured CPU time** for that benchmark population. The 242 eligible controls measure **1.0041104525×**. No eligible control met both the material-regression threshold and the global Benjamini–Hochberg significance screen.

This result is not a whole-engine or browser-FPS multiplier. It does not imply that every point estimate improved.

Selected complete-path results:

| Production path | Geometric mean | Scope |
|---|---:|---:|
| Native rigid scene creation | **1.2443×** | 50 |
| Native rigid creation + stepping | **1.0762×** | 30 |
| Deterministic water interactions | **1.0986×** | 41 |
| Water overall | **1.0512×** | 91 |
| Cloth overall | **1.0078×** | 100 eligible cases |
| Rope overall | **1.0030×** | 99 eligible cases |
| Mixed active systems | **1.0027×** | 50 eligible cases |
| JavaScript fallback overall | **0.9983×** | 65 eligible cases |

Retained v1.13 changes include:

- Exact eight-entry LRU cache with MRU-first lookup for repeated native convex-hull construction.
- Cached fallback dynamic-body counts and an exact all-static early return.
- Reset-storage reuse in the deterministic fallback backend.
- Qualified high-count shallow-water staging.
- Stable native-wrapper transform/material pointers.
- Numeric renderer configuration caching.

The audit also rejected plausible changes that did not hold up:

- SIMD `-O2` and scalar `-Os` both lost to the retained `-O3` soft-kernel builds.
- A hybrid renderer scratch/string cache regressed unchanged cloth and water work versus the numeric cache.

Run the exact campaign and evidence gate:

```bash
npm run bench:v1.13:1000
npm run bench:v1.13:gate
```

Read the [benchmark methodology and matrix](docs/V1.13_1000_BENCHMARK_MATRIX.md), [history-gap audit](benchmarks/results/v113-history-gap-audit.md), and [merged raw result](benchmarks/results/v113-production-1000.json).

### Cumulative soft-system progress

The earliest directly comparable full cloth/rope/water baseline is v1.2. Against corresponding maximum-detail v1.10 production workloads, fresh isolated-process measurements found:

| CPU simulation + handoff workload | Historical speedup |
|---|---:|
| Maximum cloth | **7.342×** |
| Maximum rope | **2.746×** |
| Maximum water | **13.342×** |
| Geometric mean | **6.455×** |

These are historical corresponding-workload results, not values to multiply by the v1.13 aggregate. They exclude physical-GPU time, native rigid-body work, and universal browser FPS. See the [original-baseline report](benchmarks/results/original-v1.2-v1.9.md).

### Retained performance gain map

The current tree also retains these independently scoped, validated gains from the intervening releases:

| Retained production path | Measured result | Boundary |
|---|---:|---|
| Intact cloth logical handoff | **75.00% fewer bytes** | 81,600 → 20,400 B; GPU presentation, not physics |
| Rope logical handoff | **87.57% fewer bytes** | 33,120 → 4,116 B; solver remains CPU/WASM |
| Water logical handoff | **74.98% fewer bytes** | 309,200 → 77,360 B; 2.5D heightfield presentation |
| KTX2 BC4 material texture | **49.73% smaller file; 50.00% less resident payload** | Asset size, not frame rate |
| Soft-system retained typed memory | **38.74% lower overall** | v1.11 audit across all 150 soft scenes |
| Native active rigid upload | **20% fewer bytes** | 4,096-body transform-only frame |
| Settled/unchanged rigid and soft uploads | **0 additional bytes** | Exact work elimination |
| v1.11 changed CPU paths | **1.067× geometric mean** | Release-specific changed-path population |
| v1.12 changed CPU paths | **1.064× geometric mean** | 28 changed paths; not whole-engine FPS |
| Cloth sphere / 768-droplet staging | **1.748× / 4.135×** | Exact v1.12 focused paths |
| Camera sampling | **1.140× geometric mean** | Camera subsystem only |
| Static-heavy / mixed native preparation | **1.678× / 1.157×** | Dense native sync remained parity |
| Stable native-wrapper paths | **1.2291× geometric mean** | 25 eligible v1.13 wrapper cases |
| Numeric renderer configuration paths | **1.3162× geometric mean** | 20 eligible v1.13 renderer cases |

The corresponding mechanism, fidelity gate, controls, rejected alternatives, and evidence file for every row are indexed in [PERFORMANCE.md](PERFORMANCE.md) and the [historical gap audit](benchmarks/results/v113-history-gap-audit.md). These ratios have different denominators and are never multiplied into a synthetic engine-wide number.

### TurboQuant boundary

Predictive structured TurboQuant makes remote cloth, rope, and water snapshots roughly seven times smaller, but compression is deliberately disabled in the local render loop. Local Worker transport was much slower once encode/decode work was included. Use TurboQuant for bandwidth-constrained remote spectators, multiplayer snapshots, cloud simulation, telemetry, checkpoints, or replay storage—not same-machine WebGPU uploads.

See [TURBOQUANT.md](docs/TURBOQUANT.md).

## Validation

Run the full release gate:

```bash
npm run validate:v1.13
```

The validated v1.13 release passed:

- Source-manifest verification.
- Clean dependency installation and zero moderate-or-higher npm vulnerabilities.
- Strict TypeScript and 22 deterministic unit suites.
- 750 scene constructors and 30 hero definitions.
- JavaScript, SIMD-WASM, and scalar-WASM soft-system soaks.
- 150 scenes, 3,600 catalog frames, and 1,800 replay frames per soft backend.
- 250 rope batching combinations, including 38 qualified paths and 212 controls.
- Native Box3D soak across all 750 scenes, repeated twice.
- 1,142,268 rigid body-frames per native pass, up to 4,096 bodies.
- Eleven WGSL modules and the real renderer runtime through Dawn with zero uncaptured WebGPU errors.
- KTX2 BC4/R8 upload paths.
- Production and GitHub Pages builds.
- A machine-readable v1.12 visible-browser sweep covering 750 scenes and 30 heroes.
- A manual v1.13 final-path browser recheck with Box3D WASM, cloth, rope, and water active and no console warnings or errors.

Safe Apple GPU renderer/KTX2 smoke gate:

```bash
npm run test:webgpu:metal
```

`npm run validate:hardware` also runs write-producing benchmarks against the default result paths. Run that full command only in a disposable copy or after preserving the frozen evidence; otherwise it can change the renderer identities bound to `npm run bench:v1.13:gate`. It does not automatically populate `post1000-hardware/`.

The retained post-campaign Metal evidence is under [`benchmarks/results/post1000-hardware/`](benchmarks/results/post1000-hardware/). Frozen benchmark-gate snapshots remain bound to the exact campaigns that produced them.

For the full record, see [VALIDATION_REPORT.md](VALIDATION_REPORT.md), [TEST_PLAN.md](docs/TEST_PLAN.md), and [LOCAL_BROWSER_VALIDATION.md](docs/LOCAL_BROWSER_VALIDATION.md).

## Rebuild native Box3D WebAssembly

The release already includes `public/box3d/box3d.js` and `public/box3d/box3d.wasm`. To reproduce them, activate Emscripten 4.0.23 and run:

```bash
source ~/emsdk/emsdk_env.sh
npm run fetch:box3d
npm run build:wasm
npm run test:native-wasm
```

The generated artifacts are written to `public/box3d/`. Build provenance is recorded in [`public/box3d/BUILD_PROVENANCE.json`](public/box3d/BUILD_PROVENANCE.json).

With a Clang toolchain that includes WebAssembly and LLD support, the standalone soft kernels can also be rebuilt and checked byte-for-byte:

```bash
npm run build:soft-kernels
npm run verify:soft-kernels
npm run test:soft-kernels
```

The default release check compares packaged modules byte-for-byte with the current compiler output. The Ubuntu CI and Pages workflows execute the packaged SIMD/scalar runtime and integration tests, then run the remaining v1.13 soaks, native checks, evidence gates, builds, and audit. They deliberately leave byte-identical recompilation to the recorded release toolchain because different Clang/LLD versions are not expected to emit identical binaries.

## Project map

```text
src/main.ts                     application loop, UI, fixed-step coordination
src/scenes.ts                   deterministic 750-scene catalog
src/showcases.ts                30 cinematic hero timelines
src/physics/wasm.ts             native Box3D WebAssembly wrapper
src/physics/fallback.ts         deterministic rigid preview backend
src/soft/simulations.ts         cloth, rope, water, interactions, frame contracts
src/soft/kernels.ts             SIMD → scalar → JavaScript kernel selection
src/webgpu/renderer.ts          frame graph, GPU surfaces, rope compute, HDR/post
src/assets/ktx2.ts              BC4/R8 KTX2 loading and fallback
src/compression/turboquant.ts   optional remote-state codec
wasm/box3d_web.c                native Box3D application bridge
wasm/soft_kernels.c             standalone cloth/rope/water numerical kernels
scripts/                        validation, build, soak, and hardware gates
benchmarks/                     reproducible campaigns, baselines, and evidence
docs/                           architecture, rendering, demo, and test guides
```

## Technical boundaries

- Box3D is authoritative for rigid bodies; WebGPU is not replacing the Box3D constraint solver.
- Soft numerical kernels remain CPU JavaScript/WebAssembly work. WebGPU reconstructs presentation data and expands rope render streams.
- Water is a 2.5D heightfield, not a volumetric SPH, FLIP, or general Navier–Stokes solver.
- Cloth, rope, water, and rigid scenes exchange actions and staging, but arbitrary two-way coupling across every Box3D collision shape is not complete.
- The renderer supports one active cloth or water surface per scene plus instanced ropes, payloads, droplets, rigid bodies, and effects.
- Tearing cloth intentionally retains a topology-aware CPU presentation path.
- Performance measurements describe the tested paths and hardware; they do not prove a universal FPS multiplier.

## Documentation

- [Box3D port architecture](docs/BOX3D_PORT.md)
- [Soft-body and water systems](docs/SOFT_BODY_AND_WATER.md)
- [WebGPU rendering pipeline](docs/RENDERING_PIPELINE.md)
- [AAA showcase guide](docs/AAA_SHOWCASE.md)
- [Demo runbook](docs/DEMO_GUIDE.md)
- [v1.13 benchmark matrix](docs/V1.13_1000_BENCHMARK_MATRIX.md)
- [Complete validation report](VALIDATION_REPORT.md)
- [Release history](CHANGELOG.md)

## License and attribution

This project is licensed under the MIT License. Upstream Box3D remains under its own license. See [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
