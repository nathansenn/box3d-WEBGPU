# Merge benchmarks, 2026-11-01

This report measures the October integration against `main` at `dfedd9f`. The integration covers the Engineering Studio and bridge experiments, the math-runtime pilot with GPU visibility and shadow reuse, the speed and visual-accuracy batch, the rebuilt native engine and the CI repairs. Every number below comes from a raw result file under [`benchmarks/merge-20261101/results/`](../benchmarks/merge-20261101/results/). The generated [summary tables](../benchmarks/merge-20261101/results/SUMMARY.md) list every case.

Speed ratios are main time ÷ merged time. **Above 1.000 the merged branch is faster.** Brackets are 95% bootstrap intervals. A difference counts as real only when its interval excludes 1.000.

## Results at a glance

| Area | Result |
| --- | --- |
| Renderer correctness on a real GPU (NVIDIA L4) | Every gate passes against the colour-matched control: 84/84 byte-exact images, 21/21 visibility checks, 25/25 shadow-cache checks, 3/3 quality corrections, 0 GPU validation errors. The full Dawn renderer runtime test also passes on Vulkan, with pixels executed. |
| Renderer GPU time, shipping defaults | 33–45% less GPU time per frame in five of six scenes, e.g. 0.0468 → 0.0277 ms all-visible (1.689 [1.677, 1.700]). Unchanged with moving bodies (0.998). |
| Renderer wall time per frame (browser) | 1.0–2.1% faster in five of six scenes, about 2.4 ms on both sides; browser submission and synchronisation dominate it, not GPU work. |
| Renderer start-up (Dawn, Vulkan) | No significant difference: 477.6 → 490.8 ms, ratio 0.973 [0.912, 1.028]. |
| GPU-resident water vs CPU water + upload | 3.2× faster at 128², 9.8× at 256², 41× at 512², 217× at 1024² for complete rendered frames. No qualified gain at 64². |
| Native Box3D WASM (48 scenes) | No significant difference: 0.981 [0.958, 1.004]. Trajectories bit-identical in 48/48 scenes. Binary 14.9% larger. |
| Soft bodies, SIMD kernels (80 scenes) | 0.963 [0.945, 0.981] overall. The whole loss sits in the 15 rope scenes moved off batched projection by the CI repair: 13% slower over 150 frames, 20% over 720 frames. The other 35 rope scenes, cloth, water and fracture show no significant difference. Presented state bit-identical with `main` in 75/80 scenes through 720 frames; the other 5 are where `main`'s batching drifts. |
| Soft bodies, JavaScript kernels (80 scenes) | No significant difference overall: 1.014 [0.994, 1.037]. Water 10.6% faster: 1.106 [1.033, 1.190]. |
| Instance partitioning (opt-in) | 1.46× less GPU time at 4,096 unchanged instances. 1.33× more at 128 instances changing every frame. Pixels identical in all 18 cases. |
| Engineering Studio solvers (new) | Bridge 37× and metal press 2.4× faster than real time. The canopy's contact solver runs at only 0.77× real time (service load) and 0.42× (failure load) on this 2.1 GHz host. |
| Material labs (new) | Liquid 60/60, concrete 8/8, granular 8/8 and rubber 8/8 programs finish at 4.5× to 3,500× real time. Glass finishes only the 2 programs that do not fracture. After fracture its contact solver drops to 0.02–0.06× real time: median step 14–111 ms, worst 4.0 s. |
| Threaded engine (new) | Four workers: 1.89× at 1,024 bodies, 2.22× at 4,096, 2.78× at 16,384. Final state identical to the single-threaded build in every run. |
| Production build | JavaScript brotli 213.5 → 443.9 KiB (+108%). WebAssembly brotli 131 → 299 KiB (adds the threaded engine). Deploy size 26 → 151 MiB (Studio textures, models and references). First visit: 237 KiB (AAA lab) → 293 KiB (material labs, the default route) or 344 KiB (canopy, press, bridge). |

## Hosts and method

**CPU host.** Intel Xeon @ 2.10 GHz cloud VM, 4 logical CPUs, 15.7 GiB, Linux 6.18, Node 22.23.4 (V8 12.4). All single-threaded measurements were pinned with `taskset` to one logical CPU and ran one at a time; the threaded-engine and build steps used all CPUs. This is a shared cloud VM without frequency control, so every comparison is interleaved and repeated:

- **A/B design.** Each sample is a fresh Node process, which avoids JIT and GC carry-over between builds. Rounds alternate which build runs first (ABBA). The statistic is the ratio of medians of per-round means, with a paired percentile bootstrap (20,000 resamples, fixed seed). Family and overall figures are geometric means of per-scene ratios, with a bootstrap over scenes.
- **Builds.** `main` is compiled from a worktree at `dfedd9f` with its own `tsc -p tsconfig.test.json`; the merged build is compiled the same way. The native comparison loads `main`'s committed `public/box3d/box3d.{js,wasm}` beside the merged branch's.
- **Behavioural equivalence.** The native runs compare the engine's replay hash every 30 frames. The soft-body runs compare an exact FNV hash of the presented instance matrices and colours every 30 frames, through frame 150.

**GPU host.** One RunPod Secure Cloud pod with an NVIDIA L4 (driver 595.91.07, Vulkan 1.4), used for about 13 minutes at $0.59/hour. RunPod billed $0.139 for it: $0.138 GPU and $0.001 disk. The RTX 4000 Ada named in the plan was out of stock. Two kinds of run:

- **Browser runs.** Headless Chromium 153 with Dawn's Vulkan backend and unquantized timestamps.
- **Node runs.** The `webgpu` package (Dawn) with `backend=vulkan`.

The browser reported "WebGPU: Hardware accelerated but at reduced performance" because headless Linux composites in software. That affects presentation only; every measurement here renders to owned textures and reads them back. Two host quirks were found and handled in the harness:

- **First adapter request.** On this host the first `requestAdapter()` in a fresh browser returns `null`, and the second returns the L4. Both runners now retry and record the attempt count; it was 2 in every run.
- **Flag set.** The working flags are `--enable-unsafe-webgpu --use-angle=vulkan --enable-features=Vulkan --disable-vulkan-surface --ignore-gpu-blocklist --disable-dawn-features=timestamp_quantization`. A probe of seven flag sets is retained in `results/gpu-l4/diagnostics/`.

## Renderer

### Correctness

The production renderer A/B ([`benchmarks/rendering`](../benchmarks/rendering/README.md)) compares the merged renderer with its pinned baseline, `031724b`. That baseline is `main` plus the math pilot's first three commits (resident water and the water surface planner). Pixel parity against that baseline cannot hold, because the merged renderer intentionally changed its colour pipeline:

- The `pow(x, 2.2)` gamma approximations were replaced with the exact sRGB transfer functions.
- A static ±0.5/255 interleaved-gradient dither was added against banding.

Against the unmodified baseline every image differs, by at most 13 levels per channel and 2.5 levels RMS. To separate that intended change from everything else, `prepare.mjs --visual-control` builds a **control baseline**: the pinned renderer with only those shader edits applied (see [`visual-control.mjs`](../benchmarks/rendering/visual-control.mjs)). Against the control, the merged renderer passes every gate, on SwiftShader and on the L4:

- 84 of 84 images byte-exact.
- 20 visibility checks plus the documented rope exception.
- 25 shadow-cache transitions.
- 3 quality corrections.
- No GPU validation errors.

So every other renderer change in the merge, from both branches and from the merge resolution, is pixel-exact.

On the L4 the full Dawn renderer runtime test (`scripts/webgpu-renderer-runtime-test.mjs`) also passes on Vulkan with pixels executed. It covers:

- rigid, cloth, water and rope paths, and GPU rope reconstruction;
- exact upload caches, resize and empty frames;
- lazy visibility retry, 25 shadow-cache transitions and material boundary gates;
- failed-frame recovery.

It now also runs with instance partitioning enabled. Previously its direct-draw assertions failed in that mode, which CI does not exercise.

### Time per frame

GPU frame span is measured with timestamp queries on the real passes, over 20 alternating pairs after 4 warm-up frames, in the browser on the L4.

With shipping defaults (`candidate-default`), merged against the control baseline:

| Scenario | GPU span base → merged (ms) | GPU speed ratio | Wall-clock ratio |
| --- | ---: | ---: | ---: |
| all-visible-opaque | 0.0468 → 0.0277 | 1.689 [1.677, 1.700] | 1.016 [1.008, 1.028] |
| mostly-offscreen | 0.1046 → 0.0575 | 1.819 | 1.016 [1.011, 1.041] |
| mixed-materials | 0.0548 → 0.0338 | 1.620 | 1.010 [1.001, 1.015] |
| paused-orbit | 0.0420 → 0.0254 | 1.651 | 1.012 [1.002, 1.020] |
| moving-rigids | 0.1211 → 0.1214 | 0.998 | 1.004 [0.990, 1.018] |
| quality-4x-nine-taps | 0.1956 → 0.1316 | 1.486 | 1.021 [1.004, 1.033] |

Intervals for every row are in the summary. How to read the table:

- **Where the GPU saving comes from.** Shadow-pass reuse: the `shadow-cache` variant alone reproduces it. When bodies move, the shadow map must be redrawn and there is no saving.
- **The other options.** `material-filter` alone is neutral. `stable-visibility` (GPU visibility lists, opt-in) halves GPU time when most objects are off screen (2.07×). It costs GPU time everywhere else: 0.59× with moving bodies and 0.74–0.93× in visible scenes. That supports keeping it opt-in.
- **Wall-clock.** Wall time per frame is about 2.4 ms on both sides in this browser. It is dominated by command submission and the completion wait, so the GPU saving moves it by only 1–2%. Real-display FPS was not measured: headless Chrome here composites in software.

### Start-up, partitioning and uploads (Dawn, Vulkan)

- **Start-up.** `WebGPURenderer.create` to first idle queue, 21 fresh processes per side: `main` 477.6 ms (MAD 23.5), merged 490.8 ms (MAD 25.6). Ratio 0.973 [0.912, 1.028]: no significant difference.
- **Instance partitioning (opt-in).** GPU pass time per frame from the renderer's own timestamps, 48 frames, direct → partitioned:

| Instances | Changed every frame | Direct → partitioned (ms) | Ratio |
| --- | --- | ---: | ---: |
| 128 | no | 0.0192 → 0.0184 | 1.04 |
| 128 | yes | 0.0251 → 0.0335 | 0.75 |
| 4,096 | no | 0.1053 → 0.0721 | 1.46 |
| 4,096 | yes | 0.1526 → 0.1417 | 1.08 |

  Partitioning pays off at large instance counts and costs at small, frequently changing ones. Images are identical with and without it in all 18 qualification cases.
- **Upload cache.** An unchanged-frame `uploadInstances` call costs 248 ns against 4,345 ns for a changed one (17.6×), with zero bytes uploaded.
- **Native rigid stream.** 4,096 bodies upload 327,680 bytes initially and 262,144 for transform-only frames (exactly 20% less), with 0 bytes when settled.

## Water

**GPU-resident water vs CPU water + upload, complete rendered frames** (`scripts/gpu-water-benchmark.mjs`, Dawn Vulkan, 6 paired process trials, 24 frames × 4 ticks):

| Grid | CPU + upload (ms/frame) | GPU-resident (ms/frame) | Ratio [95%] |
| --- | ---: | ---: | ---: |
| 64² | 0.475 | 0.326 | 1.44 [0.84, 1.73], not qualified |
| 128² | 1.019 | 0.304 | 3.21 [2.37, 3.90] |
| 256² | 3.109 | 0.313 | 9.79 [7.33, 10.99] |
| 512² | 11.474 | 0.292 | 41.3 [25.4, 45.1] |
| 1024² | 63.895 | 0.290 | 217 [140, 236] |

The GPU frame stays near 0.3 ms from 128² to 1024², while CPU cost grows with the cell count.

**Solver kernels.** The [`benchmarks/math-runtime`](../benchmarks/math-runtime/README.md) harness validates every backend against the reference at every checkpoint before timing it. In the browser on the L4, per-step p50:

- **512².** JavaScript 2.109 ms, scalar WASM 0.944, SIMD WASM 0.404, WebGPU 1.044 wall and 0.104 GPU.
- **96×80.** SIMD 0.012 ms against WebGPU 0.234 wall and 0.0074 GPU.

The GPU kernel itself is 4–10× faster than SIMD at the larger grids. But WebGPU wall time per step never drops below about 0.2 ms in this synchronised harness, so SIMD WebAssembly wins on wall time up to 512². That is why the resident design (no per-frame synchronisation, above) is what pays off.

On the CPU host (Node 22, no GPU) the same harness measures, per step p50:

- **512².** JavaScript 3.023 ms, scalar WASM 1.087 ms, SIMD WASM 0.492 ms.
- **96×80.** 0.083, 0.030 and 0.013 ms.

SIMD is 6.1× faster than JavaScript and 2.2× faster than scalar WASM at 512². The scalar and SIMD binaries are `main`'s, unchanged by the merge; the JavaScript reference is new. All three agree with the reference within the harness tolerance at every checkpoint, and the execution-graph experiment completed.

Resident-water rendering on the L4 matches CPU-uploaded copies of the same fields exactly at 0, 1 and 4 steps (0 differing pixels; about 15,110 water pixels each). The `uploadSurface` method costs the same on `main` and merged: 368 vs 371 µs per advancing frame, and 0.5 vs 0.7 µs when unchanged.

## Native engine

48 catalogue scenes (4 per rigid family, stress 5), 30 warm-up and 120 timed `b3w_step(1/60, 4)` per sample, 7 ABBA rounds, `main`'s binary against the rebuilt one:

- **Speed.** Overall 0.981 [0.958, 1.004]. One scene is significantly faster, one significantly slower, and 46 show no significant difference. Dense 4,096-body stacks: 20.97 vs 20.71 ms per step.
- **Behaviour.** The replay hash is bit-identical every 30 frames in all 48 scenes, with equal body counts. The rebuild adds multi-world contexts, body lifecycle and spatial queries, and single-world physics is unchanged in every scene tested.
- **Cost.** The binary is 14.9% larger (400,546 → 460,156 bytes), and module load goes from 7.5 to 8.1 ms.

The merged branch also ships `box3d-mt`, a pthread build of the same engine. Browsers can only load it on cross-origin-isolated pages, and the loader falls back to the single-threaded build otherwise. `scripts/threaded-benchmark.mjs` ran its dense-rain workload with 3 repetitions, a fresh process per run and configurations interleaved, on a quiet machine (load ≤ 1.7 on 4 CPUs). Against the single-threaded build:

- **Four workers.** 1.89× at 1,024 bodies, 2.22× at 4,096 and 2.78× at 16,384.
- **One worker.** No faster: 1.02–1.23×.
- **Equivalence.** Every run's final state equals the single-threaded build's.

## Soft bodies

80 scenes: all 50 rope scenes plus every fifth cloth, water and fracture scene. Stress 5, 30 warm-up and 120 timed frames of `step(1/60, 4)` + `buildFrame(false)`. The frame includes `buildFrame`, because the merged branch moved kinetic-energy work from the step into the first telemetry read. The presented state is bit-identical to `main` in all 80 scenes through frame 150, with both kernel paths.

| Kernels | Overall | Cloth | Rope | Water | Fracture |
| --- | ---: | ---: | ---: | ---: | ---: |
| SIMD WASM (production) | 0.963 [0.945, 0.981] | 0.992 [0.975, 1.008] | 0.945 [0.923, 0.968] | 0.972 [0.908, 1.042] | 1.018 [0.992, 1.044] |
| JavaScript (fallback) | 1.014 [0.994, 1.037] | 1.001 [0.984, 1.015] | 1.003 [0.979, 1.029] | 1.106 [1.033, 1.190] | 0.997 [0.930, 1.077] |

**The rope slowdown is the price of the rope-batching repair.**

- **What changed.** On `main`, rope variants 2, 3 and 5 (pendulum strike, rope ladder, cable curtain) run batched kernel projection at stress 5. Replaying the gate's own workload ([`rope-batching-divergence.json`](../benchmarks/merge-20261101/results/rope-batching-divergence.json)): `main`'s rule batches 38 rope scenes, and 13 of them drift from the legacy per-constraint cadence. All 13 are in those variants. The first difference appears between frames 156 and 216, and positions differ by up to 16.7 units. That drift is why the `rope-batching` CI gate had failed since August. The merge keeps all 15 variant-2, 3 and 5 scenes on the legacy cadence, which restores the gate's bit-exactness guarantee. Every scene it still batches matches the legacy cadence exactly. Two of the 15 (655 and 675) did not drift, but the rule excludes the whole variant.
- **What it costs.** Those 15 scenes are 13.4% slower with SIMD kernels over 150 frames, 0.866 [0.839, 0.891], and 20% slower over 720 frames, 0.795 [0.750, 0.836]. The 35 other rope scenes show no difference: 0.981 [0.961, 1.003].
- **Where it doesn't apply.** With JavaScript kernels batching never applies, and rope shows no difference.
- **Next step.** Making the batched kernel bit-exact for those variants would recover the time.

**Longer horizon.** The same 80 scenes were rerun for 720 frames (12 simulated seconds), 3 rounds, SIMD kernels; see [`soft-ab-simd-720-frames.json`](../benchmarks/merge-20261101/results/soft-ab-simd-720-frames.json).

- **Identical.** 75 of 80 scenes stay bit-identical with `main` through frame 720.
- **Different.** The five Heavy Pendulum Strike scenes (variant 2) differ from frame 270–300 onward. That is `main`'s batched projection drifting on this workload; the merged branch follows the reference cadence.
- **Not divergent here.** The rope-ladder and cable-curtain scenes do not drift on this milder workload within 720 frames, although they do under the gate's workload above.

Timing over this longer window, from 3 rounds instead of 7:

- **Overall.** 0.962 [0.934, 0.990], the same as the 150-frame run.
- **The 15 rope scenes on the legacy cadence.** 0.795 [0.750, 0.836], about 20% slower. The cost grows later in the run.
- **Everything else.** Within noise, with water slightly faster at 1.052 [1.004, 1.116].

## Engineering Studio and material labs (new in the merge)

These run only on the merged branch, so they are absolute costs on this host. FailureSimulation uses the backends the Studio uses, with 1,920 steps (16 s) at 120 Hz and 7 fresh processes per case. Two solver steps per 60 Hz frame give the budget share.

| Study | Load | Mean ms/step | p95 | Real-time factor | Budget share | Outcome |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| Canopy (CCD contact) | 0.8 | 10.76 | 14.96 | 0.77× | 129% | intact |
| Canopy (CCD contact) | 4 | 19.97 | 56.70 | 0.42× | 240% | 72 links broken from 4.19 s |
| Metal press | 0.8 | 3.53 | 4.58 | 2.36× | 42% | – |
| Metal press | 4 | 3.53 | 4.63 | 2.36× | 42% | 433 broken |
| Bridge, river on | 0.8 | 0.224 | 0.260 | 37× | 2.7% | intact |
| Bridge, river on | 4 | 0.315 | 0.343 | 26× | 3.8% | 26 broken, 53 water impacts |
| Bridge, river off | 4 | 0.286 | 0.298 | 29× | 3.4% | 28 broken |

What the table shows:

- **River cost.** The river response is 2.8% of bridge step time at service load and 4.8% in failure.
- **Canopy.** The canopy's contact solver cannot keep 120 Hz on this 2.1 GHz cloud CPU. Its failure outcome, 72 broken links, matches the authors' 30-second browser review run ([`docs/CANOPY_CONTACT.md`](CANOPY_CONTACT.md)), which reported no lag or overloads on their machine. A faster desktop CPU closes part of that gap, but the canopy has the least headroom of any study.

**Material labs.** Every experiment program was stepped at 120 Hz to its authored length, or until 60 s of wall time.

| Lab | Programs completed | Median ms/step | Real-time factor (median program) | Slowest program |
| --- | ---: | ---: | ---: | --- |
| Liquid | 60/60 | 0.569 | 12.2× | river-backwater 7.1× |
| Concrete | 8/8 | 0.466 | 13.8× | high-strength 13.2× |
| Granular | 8/8 | 1.494 | 5.1× | slow-sluice 4.5× |
| Rubber | 8/8 | 0.0007 | 3,542× | rubber-rebound 2,539× |
| Glass | 2/8 | 79.9 | 0.04× | tempered-dice 0.024× |

Glass is the outlier.

- **The two programs that don't fracture** (thick-panel and acrylic-comparison) run at 2.5× and 3.7× real time.
- **The six that fracture** reach only 1.5–3.8 of their 12 simulated seconds in 60 s of wall time. Median step is 14–111 ms, p95 is 0.46–1.29 s, and the worst step is 4.0 s.
- **Why.** After fracture, `ConvexContactWorld.stepInterval` (`src/engine/convex-contact.ts`) restores the entire world and re-runs half the interval whenever a sweep does not converge. With hundreds of pieces in contact that retry tree dominates.

## Production build

Both trees build with Vite 8.1.6. `results/build-size.json` lists every emitted file with raw, gzip -9 and brotli q11 sizes.

| Measure | `main` | Merged |
| --- | ---: | ---: |
| JavaScript, brotli | 213.5 KiB | 443.9 KiB |
| CSS, brotli | 30.1 KiB | 38.6 KiB |
| WebAssembly, brotli | 131.2 KiB | 298.5 KiB |
| All output | 26.1 MiB (43 files) | 150.5 MiB (114 files) |
| Build time (median of 5, alternating) | 1.00 s | 2.27 s |

The extra JavaScript is the Engineering Studio and the material labs. The extra WebAssembly is the rebuilt engine plus the threaded build. The extra output is Studio textures (69 MiB), design references (45 MiB) and tree models (8 MiB). All of these load on demand, not on first visit.

**The site's front page changes.** On `main`, `index.html` boots the AAA Physics Lab (`src/main.ts`). On the merged branch it boots a small router (`src/entry.ts`, 3.5 KiB, 1.5 KiB compressed) that opens the Engineering Studio. The default route is the Liquid lab; `?studio=canopy|plate|bridge|liquid|glass|concrete|rubber|granular` picks a study. The AAA Physics Lab is no longer a page of the production build. First-visit JavaScript and CSS, from the Vite manifest:

| Page | Brotli |
| --- | ---: |
| `main`, AAA lab | 236.6 KiB |
| Merged, material labs | 293.3 KiB |
| Merged, canopy, press or bridge | 343.9 KiB |

## Findings and follow-ups

1. **Rope batching exactness.** 15 rope scenes are 13–20% slower with SIMD kernels until the batched kernel is made bit-exact for rope variants 2, 3 and 5. The alternative is to accept the drift and re-baseline the gate.
2. **Glass lab rollback.** Six of eight glass programs cannot finish their 12 s inside 60 s of wall time. Each non-converged sweep after fracture rolls the whole world back and retries at half the interval, so steps take 14–111 ms at the median and up to 4.0 s. The lab needs a contact solver that retries locally instead of restarting the full world.
3. **Canopy contact cost.** The canopy runs at 0.42–0.77× real time on a 2.1 GHz host. It needs headroom work before it can promise real time on modest CPUs.
4. **GPU visibility lists.** `stable-visibility` should stay opt-in. It helps only mostly-offscreen scenes and costs GPU time in the others.
5. **Instance partitioning.** Worth enabling above a few thousand instances. Not worth it for small, constantly changing sets.
6. **Browser wall time.** Wall time per frame is dominated by synchronisation rather than GPU work. Further GPU-side gains will not show up in it unless frames stop waiting for completion.

## Reproduce

CPU suite, from the repository root. It needs a `main` worktree with `node_modules` and both test builds; see the header of [`run-cpu.sh`](../benchmarks/merge-20261101/run-cpu.sh):

```bash
MAIN_TREE=/path/to/main MAIN_BUILD=/path/to/main/.test-build MERGED_BUILD=/path/to/merged-test-build NATIVE_MAIN=/path/to/main/public/box3d bash benchmarks/merge-20261101/run-cpu.sh
```

Summary tables:

```bash
node benchmarks/merge-20261101/report.mjs
```

GPU runs: the scripts in `results/gpu-l4/diagnostics/` are the exact pod steps. Locally, with a GPU browser:

```bash
node benchmarks/rendering/prepare.mjs --visual-control && node benchmarks/rendering/serve.mjs
```

```bash
node benchmarks/rendering/run.mjs --hardware-vulkan --playwright-path /path/to/playwright/index.mjs --executable-path /path/to/chrome
```

On Dawn with Vulkan, set `WEBGPU_DAWN_BACKEND=vulkan` for `scripts/renderer-startup-benchmark.mjs`, `scripts/gpu-water-benchmark.mjs` and `scripts/webgpu-renderer-runtime-test.mjs`.

## Limits

- One CPU host and one GPU model. Results are specific to them, and the bootstrap intervals describe within-run variability only.
- Wall-clock browser numbers include headless synchronisation. They are not display FPS.
- Equivalence horizons: 150 frames per scene in the timed soft-body runs and 720 frames in the long-horizon run; 150 frames for the native engine.
- The Studio and lab figures have no `main` counterpart.
- The 150-frame soft-body results were produced with `soft-ab.mjs` as committed in `5c76fe4`. The 720-frame run used the current file, which only adds the `--ids` scene selection and longer trajectory labels.
