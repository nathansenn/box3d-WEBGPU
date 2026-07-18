# Validation Report — Box3D WebGPU AAA Physics Lab v1.14.0

Date: July 18, 2026

Status: **v1.14 current-source material-failure release validated; v1.13 source-frozen optimization evidence retained unchanged**

## Scope

V1.14 adds a deterministic reduced-order material-failure domain without rewriting the source-frozen v1.13 benchmark history. The new production surface includes:

- 50 material bending/fracture scenes and two directed material heroes;
- ten normalized comparative presets covering ductile, brittle, progressive, fiber, and hyperelastic responses;
- a beam lattice with axial, shear, diagonal, and bending constraints;
- separate tension/compression yield and break envelopes, plastic set, damage accumulation, fatigue cycling, and cohesive separation;
- a 0–200% normalized load rig with apply, release, and cycle controls;
- live load, strain, threshold, yield/damage, peak-damage, failure-phase, break-count, energy, and replay-hash telemetry;
- compact material member state expanded through the WebGPU rope/material compute presentation path.

The material coefficients are dimensionless and tuned for comparative demonstrations. They are not calibrated constitutive laws, FEA, certified test data, design allowables, fatigue-life predictions, or safety calculations. See [`MATERIAL_FRACTURE.md`](docs/MATERIAL_FRACTURE.md).

V1.13 re-audited the retained v1.2–v1.12 optimization history, evaluated missed candidates, and closed the performance campaign with a source-frozen 1,000-case tournament. Its retained production changes were:

- an exact eight-entry MRU cache for repeated native convex-hull construction;
- cached preview dynamic-body counts, an exact all-static step early return, and reset storage that is not cleared immediately before overwrite;
- a qualified high-count shallow-water path;
- stable native-wrapper transform and color pointers;
- numeric renderer configuration caching.

The current-source audit also retested compiler modes and a renderer cache candidate. SIMD `-O2` and scalar `-Os` failed their active-workload qualification, so both packaged soft kernels remain at `-O3`. A hybrid renderer scratch cache regressed unchanged cloth and water paths, so it was rejected. These rejected candidates are recorded rather than silently removed from the history.

The current tree retains native Box3D C17/Emscripten, deterministic preview physics, JavaScript/SIMD/scalar soft solvers, GPU-resident intact cloth/water, WebGPU-compute rope/material presentation, HDR/MSAA/shadows/post, KTX2 BC4/R8, exact frame/upload caches, **800 scenes, 32 heroes, 200 soft/fluid/material scenes**, and remote-only TurboQuant.

See the complete [`V1.13 1,000-case benchmark matrix`](docs/V1.13_1000_BENCHMARK_MATRIX.md) and [`history-gap audit`](benchmarks/results/v113-history-gap-audit.md) for workload ownership, retained/rejected history, and claim boundaries.

## Release commands

```bash
npm ci
npm run verify:source
npm run validate:v1.14
npm run validate:hardware
npm audit --audit-level=moderate
```

`validate:v1.14` is the current-source cross-platform release gate. It must run the current deterministic, material, renderer, native, build, audit, and manifest checks while preserving the stored source-frozen v1.13 1,000-case result as historical evidence. `validate:hardware` requires Dawn Metal and timestamp-query support. Reproduce the historical tournament only from its frozen v1.13 identity with `npm run bench:v1.13:1000`.

## V1.14 automated coverage results

The final v1.14 source identity passed the following current-source gates.

| Gate | Required result |
|---|---:|
| Strict TypeScript | Passed |
| Deterministic Node suites | **24 / 24** |
| Catalog constructors | **800 / 800** |
| Hero definitions | **32 / 32** |
| Material presets | **10 / 10**, finite and ordered normalized envelopes |
| Material scene constructors | **50 / 50** |
| Material load/action replay | deterministic; finite; monotonic damage/break state |
| Material 100-case campaign | **100 / 100** finite, deterministic, monotonic; 83 yield/damage; 69 fracture |
| C17 bridge syntax/API | Passed with warnings as errors |
| SIMD/scalar soft-kernel rebuild | Byte-identical |
| Dawn live WGSL modules | **11 / 11** |
| Dawn uncaptured errors | **0** |
| KTX2 R8/BC4/procedural paths | Passed on null and Metal |
| JavaScript soft/material soak | 200 scenes; 4,800 catalog + 2,400 replay frames |
| SIMD soft/material soak | 200 scenes; 4,800 catalog + 2,400 replay frames |
| Scalar soft/material soak | 200 scenes; 4,800 catalog + 2,400 replay frames |
| Material WebGPU compute/shadow/main path | Passed; zero uncaptured errors |
| Rope legacy equivalence | **250 scene×stress combinations**, 720 frames each |
| Qualified rope batching | 38 maximum-stress combinations; 212 controls |
| Native Box3D staging soak | **800 scenes twice**, deterministic; 1,145,838 body-frames/pass |
| Native maximum bodies | **4,096** |
| Invalid native timestep guard | NaN, ±Inf, zero, negative passed |
| Retained v1.13 tournament | **1,000 / 1,000 cases**, zero correctness failures; frozen identity unchanged |
| Production build | Passed |
| Relative-base Pages build | Passed |
| npm moderate-or-higher vulnerabilities | **0** |

The rebuilt native artifact is 397,128 bytes with SHA-256 `a245fa22607947cf2e3729a6b50cb106b5542eb42102ff02bcb4f31e8c2d3ff8`. Its bridge source SHA-256 is `e0224f7d2cc1893edfd1aca56a2522b7c5f5186872d04f9d9f175c61b31b1b6a`. The JavaScript loader is 14,209 bytes with SHA-256 `8ec00439683b8da258916ebe90f0cea6a6d0672641fda571936b6012fd3cec3b`.

The exact 100-case material matrix ran 10 presets × 5 modes × stress levels 2/5 for 180 frames and three samples per case. It completed 54,000 timed frames with a 0.398 ms/frame median, 0.844 ms/frame p95, and 1.131 ms/frame maximum across case medians in the representative full release-gate run on this development machine. These numbers are a present-source solver/frame-construction baseline, not a cross-version or physical-GPU speedup.

## Retained v1.13 final 1,000-case result

The tournament completed exactly **1,000 / 1,000** registered production cases with zero correctness failures. It ran in ten deterministic shards against frozen source, benchmark harness, case registry, native artifact, renderer, and hardware-gate identities.

| Outcome | Count |
|---|---:|
| Accepted measured wins | **165** |
| Borderline changed paths | **353** |
| Controls | **360** |
| Changed paths below timing floor | **85** |
| Rejected, no win | **37** |
| Rejected, correctness | **0** |

The predeclared timing floor is 22.5 ms. In total, **203 cases** fell below it: 85 changed paths and 118 controls. All 203 remain in the raw result but are excluded from aggregate timing claims.

The timer-qualified aggregates are:

| Population | Cases | Point-estimate geometric mean |
|---|---:|---:|
| Changed CPU production paths | **555** | **1.0544254732×** |
| Controls | **242** | **1.0041104525×** |

These are Apple M3 Ultra / Node 26 CPU production-path measurements. A 1.0544254732× ratio corresponds to about 5.16% less measured CPU time over this changed-path population; it is not a whole-engine, physical-GPU, or universal browser-FPS claim.

No eligible control met both the predeclared material-regression threshold (`candidate / baseline < 0.94×`) and the global Benjamini–Hochberg screen (`q <= 0.05`). This does not mean every control point estimate improved; it states the exact multiplicity-aware release criterion.

The raw machine-readable result is [`benchmarks/results/v113-production-1000.json`](benchmarks/results/v113-production-1000.json); the human-readable report is [`benchmarks/results/v113-production-1000.md`](benchmarks/results/v113-production-1000.md).

## Retained and rejected directions

The largest robust retained groups are native construction, high-count water work, stable wrapper pointer access, qualified cloth work, frame preparation, and renderer configuration paths. Large unchanged-frame and wrapper microcall ratios are work-elimination evidence near the timer floor; they are not multiplied into a claimed frame-rate gain.

Two previously missed directions were explicitly re-qualified against current source:

- SIMD `-O2` and scalar `-Os` compiler modes were rejected because active-workload geometric means missed the gate, despite bit-exact outputs.
- A hybrid renderer scratch cache was rejected because its all-path geometric mean was below parity and unchanged cloth/water staging regressed, despite exact output and a passing Dawn check.

TurboQuant remains remote-only. It compresses bandwidth-constrained snapshots, but its codec overhead makes the tested same-thread/local-Worker path slower than raw transfer.

## Physical-GPU and renderer evidence

The latest post-tournament Apple M3 Ultra / Dawn Metal evidence is stored under [`benchmarks/results/post1000-hardware/`](benchmarks/results/post1000-hardware/). The renderer SHA-256 is `7c6553969ec5586b5721c5d524d4be74f46608c06adff232aaa2d902bf2a5a9e`.

At 1,920×1,080 with 4,096 cubes and 312 timestamped frames per supported case, the latest median GPU frame spans include:

| Profile-equivalent case | Median GPU frame span |
|---|---:|
| 1× MSAA, shadows off | **0.1382 ms** |
| 4× MSAA, shadows off | **0.1365 ms** |
| 1× MSAA, 1,024², 1-tap PCF | **0.2075 ms** |
| 4× MSAA, 2,048², 9-tap PCF | **0.2266 ms** |

Dawn Metal did not expose 2× MSAA. The unchanged-upload microcall measured 41.41× with zero cached bytes; a settled 4,096-body rigid frame also uploaded zero bytes. Fresh-process renderer startup measured 0.976× versus its historical comparison point and is not promoted as a speedup.

These post-tournament files are the latest hardware rerun. The hardware snapshots frozen into the 1,000-case benchmark remain that benchmark's closure evidence; replacing them after timing would invalidate its recorded identity.

## Production build

| Asset | Size |
|---|---:|
| HTML | **26.90 kB**; **7.19 kB gzip** |
| Main JavaScript | **270.72 kB**; **74.14 kB gzip** |
| Lazy TurboQuant chunk | **9.25 kB**; **3.18 kB gzip** |

The production and relative-base Pages builds pass. The moderate-or-higher npm audit reports zero vulnerabilities.

## Visible browser acceptance

The final v1.14 build was served locally and opened in the Codex in-app Browser on macOS. It loaded **Box3D WASM** and visibly exercised structural steel yielding/unloading, elastomer cycling, soda-lime-glass brittle separation, and carbon-fiber impact failure. Load, release, cycle, and projectile controls updated the live breakpoint/damage telemetry and rendered member topology. The browser console recorded **0 warnings and 0 errors**.

The retained machine-readable full-catalog browser regression evidence is
[`v112-visible-browser-acceptance.json`](benchmarks/results/v112-visible-browser-acceptance.json).
That retained sweep covered **750 / 750 scenes** and **30 / 30 hero sequences**. The new current-source browser sweep additionally passed **800 / 800 scenes**, **32 / 32 hero sequences**, and effects with the material domain active. Representative steel, glass, elastomer, and composite states were visually inspected at 1,280×720.

The current machine-readable browser record is [`v114-visible-browser-acceptance.json`](benchmarks/results/v114-visible-browser-acceptance.json).

This visible pass complements the state/catalog test and Dawn/Metal submission tests. It does not convert CPU-path benchmark ratios into browser FPS or establish performance on other devices.

## V1.14 release assessment

V1.14 is the current validated material-failure release: the final source manifest, 24 Node suites, 800/32 catalog checks, 200-scene three-backend soaks, exact 100-case material campaign, load/fracture determinism, Dawn material-compute submission, native staging, production/Pages builds, audit, and visible browser run passed. V1.13 remains the source-frozen performance baseline and was not rewritten or used to inflate the new material results.

No material threshold may be presented as a real engineering limit. Universal FPS, a native-versus-preview multiplier, physical material accuracy, safety certification, and performance portability across browsers/GPUs remain out of scope without defined hardware and calibrated engineering validation matrices.
