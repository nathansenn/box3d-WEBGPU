# Validation Report — Box3D WebGPU AAA Physics Lab v1.13.0

Date: July 16, 2026

Status: **automated cross-platform, native Box3D, Apple Metal, and visible v1.13 browser acceptance passed**

## Scope

V1.13 re-audits the retained v1.2–v1.12 optimization history against the current production source, evaluates missed candidates, and closes the campaign with a source-frozen 1,000-case tournament. The retained v1.13 production changes are:

- an exact eight-entry MRU cache for repeated native convex-hull construction;
- cached preview dynamic-body counts, an exact all-static step early return, and reset storage that is not cleared immediately before overwrite;
- a qualified high-count shallow-water path;
- stable native-wrapper transform and color pointers;
- numeric renderer configuration caching.

The current-source audit also retested compiler modes and a renderer cache candidate. SIMD `-O2` and scalar `-Os` failed their active-workload qualification, so both packaged soft kernels remain at `-O3`. A hybrid renderer scratch cache regressed unchanged cloth and water paths, so it was rejected. These rejected candidates are recorded rather than silently removed from the history.

The release retains native Box3D C17/Emscripten, deterministic preview physics, JavaScript/SIMD/scalar soft solvers, GPU-resident intact cloth/water, WebGPU-compute rope presentation, HDR/MSAA/shadows/post, KTX2 BC4/R8, exact frame/upload caches, 750 scenes, 30 heroes, and remote-only TurboQuant.

See the complete [`V1.13 1,000-case benchmark matrix`](docs/V1.13_1000_BENCHMARK_MATRIX.md) and [`history-gap audit`](benchmarks/results/v113-history-gap-audit.md) for workload ownership, retained/rejected history, and claim boundaries.

## Release commands

```bash
npm ci
npm run verify:source
npm run validate:v1.13
npm run validate:hardware
npm audit --audit-level=moderate
```

`validate:v1.13` is the cross-platform release gate. It verifies the stored, source-frozen 1,000-case evidence rather than rerunning the entire timed tournament on every CI machine. `validate:hardware` requires Dawn Metal and timestamp-query support. Reproduce the full tournament separately with `npm run bench:v1.13:1000`.

## Automated coverage

| Gate | Result |
|---|---:|
| Strict TypeScript | Passed |
| Deterministic Node suites | **22 / 22** |
| Catalog constructors | **750 / 750** |
| Hero definitions | **30 / 30** |
| C17 bridge syntax/API | Passed with warnings as errors |
| SIMD/scalar soft-kernel rebuild | Byte-identical |
| Dawn live WGSL modules | **11 / 11** |
| Dawn uncaptured errors | **0** |
| KTX2 R8/BC4/procedural paths | Passed on null and Metal |
| JavaScript soft soak | 150 scenes; 3,600 catalog + 1,800 replay frames |
| SIMD soft soak | 150 scenes; 3,600 catalog + 1,800 replay frames |
| Scalar soft soak | 150 scenes; 3,600 catalog + 1,800 replay frames |
| Rope legacy equivalence | **250 scene×stress combinations**, 720 frames each |
| Qualified rope batching | 38 maximum-stress combinations; 212 controls |
| Native Box3D soak | **750 scenes twice**, deterministic |
| Native body-frames per pass | **1,142,268** |
| Native maximum bodies | **4,096** |
| Invalid native timestep guard | NaN, ±Inf, zero, negative passed |
| Final v1.13 tournament | **1,000 / 1,000 cases**, zero correctness failures |
| Production build | Passed |
| Relative-base Pages build | Passed |
| npm moderate-or-higher vulnerabilities | **0** |

The rebuilt native artifact is 396,272 bytes with SHA-256 `de1fe4c659bb6c99879555b7b987d53455bcf4768cbfffcb35eac3ee75835a1c`. Its bridge source SHA-256 is `640d65fb3e264cbb0f7f3f487dba22205b981516f35a37707daae03e9a405ce2`. The JavaScript loader is 14,209 bytes with SHA-256 `8ec00439683b8da258916ebe90f0cea6a6d0672641fda571936b6012fd3cec3b`.

## V1.13 final 1,000-case result

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
| HTML | **24.89 kB** |
| Main JavaScript | **239.27 kB**; **66.26 kB gzip** |
| Lazy TurboQuant chunk | **9.25 kB**; **3.18 kB gzip** |

The production and relative-base Pages builds pass. The moderate-or-higher npm audit reports zero vulnerabilities.

## Visible browser acceptance

The final v1.13 build was served locally and opened in the Codex in-app Browser on macOS. It loaded **Box3D WASM**, visibly rendered cloth, rope, and water, and accepted interactions in all three soft/fluid domains. The browser console recorded **0 warnings and 0 errors**.

The retained machine-readable full-catalog browser regression evidence is
[`v112-visible-browser-acceptance.json`](benchmarks/results/v112-visible-browser-acceptance.json).
That sweep covered **750 / 750 scenes** and **30 / 30 hero sequences**. The
v1.13 manual pass above specifically rechecked the final native backend and the
three soft/fluid presentation paths after the new optimization work.

This visible pass complements the state/catalog test and Dawn/Metal submission tests. It does not convert CPU-path benchmark ratios into browser FPS or establish performance on other devices.

## Release assessment

The source-frozen CPU, WebAssembly, native Box3D, Dawn/WebGPU, Metal, KTX2, deterministic-soak, fidelity, 1,000-case benchmark, build, Pages, audit, and visible-browser gates pass. V1.13 is the current validated release candidate. Universal FPS, a native-versus-preview multiplier, and performance portability across browsers/GPUs remain out of scope without a defined multi-device workload matrix.
