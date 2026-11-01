# Production renderer comparison

This harness loads the actual `WebGPURenderer` from a pinned baseline and the working source. It compares unchanged geometry, material assets, camera, quality settings and output resolution. It does not use the separate synthetic quality-benchmark shaders.

## Reproduce

From the repository root, install the existing lockfile dependencies and prepare independent module trees:

```sh
npm ci
node benchmarks/rendering/prepare.mjs
node benchmarks/rendering/serve.mjs
```

The baseline is commit `031724b8501b194d2da770eeb5f407a3520cb311`. Preparation reads its seven runtime source files with `git show`, validates every Git blob against `baseline-sources.json`, and emits ES2022 modules. If the commit is absent in a source export, provide a separate matching checkout:

```sh
node benchmarks/rendering/prepare.mjs --baseline-root /absolute/path/to/pinned-checkout
```

Open `http://127.0.0.1:4318/benchmarks/rendering/index.html` in the target browser and select **Run comparison**, or automate an installed Playwright browser:

```sh
node benchmarks/rendering/run.mjs --playwright-path /absolute/path/to/playwright/index.mjs --executable-path /absolute/path/to/chromium
```

The default profile does not add GPU flags. To validate execution on SwiftShader explicitly, add `--software-gpu`. Results from this profile are software results and cannot qualify a physical GPU. `--quick` reduces warmup and sample counts; `--parity-only` skips timing; `--scenario ID` and `--variant ID` select diagnostic subsets. Use `--out /path/to/result.json` to retain a separate run. The normal complete run uses four warmup frames and twenty measured A/B pairs per timing case. A later physical-device run should use a separate result filename and include browser/backend/adapter details.

## What is measured

- CPU scene preparation/uploads, renderer command encoding/submission, and queue-completed wall time are separate fields.
- When supported, the harness requests `timestamp-query` on **both** devices. It attaches beginning/end timestamp writes to the real render and compute passes without substituting shader source. Query resolution and readback happen after the measured wall interval.
- Each paired sample alternates which renderer goes first. Both queues are drained, resource allocation and warmup are outside the measured samples, and raw samples remain in the JSON.
- GPU frame span includes the interval from the first measured pass through the final postprocessing pass. Per-pass intervals and their sum are retained. CPU encode duration is not GPU time. Queue completion is not browser presentation or app FPS.
- Simulation stepping and screenshot readback are outside rendering measurements. Input uploads and uniforms are inside them. Cases explicitly distinguish unchanged state, camera-only changes, and changing rigid transforms.
- `inputStreamUploadedBytes` counts the renderer's instance, surface and rope upload methods. It excludes scene uniforms and visibility parameters; those writes still contribute to measured CPU and wall time.
- Source SHA-256 values, baseline Git blob checks, emitted-module hashes, harness hashes, canonical KTX2 hashes, browser arguments, CPU model and adapter features accompany every result. Procedural texture fallback fails the run.
- Actual adapter information from each renderer's own device-creation path is recorded and classified. Conflicting available identity fields fail the comparison. A separate preliminary adapter request is not used as proof of the adapters that perform timed work; redacted physical identifiers remain unverified.

## Correctness gates

Image comparisons are byte-exact at identical frozen states, including opaque and transparent materials, independent light/camera visibility, clip boundaries, GPU rope expansion, cloth, sheet, CPU-uploaded water, resident water, 1×/4× MSAA, and one/nine shadow taps. Scene coverage is checked against a sky-only frame to avoid qualifying two empty images.

An independent CPU oracle transforms all eight box corners and evaluates the six WebGPU homogeneous clip planes. GPU lists must remain ordered, contain every visible eligible object, contain only eligible materials, and stay within capacity. Conservative extra objects are allowed. Counts 0, 1, 63, 64, 65, 4097 and 8193 exercise reset, partial workgroups and multi-segment group scans; a large-coordinate cancellation case checks conservative retention. Rope correctness is checked through pixels because its final matrices are produced on the GPU.

Shadow tests exercise reuse, rigid transforms, materials, light matrices, effects, soft-instance uploads, external encoder callbacks, quality changes, shadow-map recreation and framebuffer resizing. Advancing cloth, sheet and rope states must refresh caster content; water-only changes must preserve an otherwise valid shadow map. Three quality fixes have separate references: stale empty-caster depth is compared with an explicitly cleared baseline map; the orthographic depth correction is compared with an independent analytic projection; and half-integer material tags are compared with the pinned renderer forced to issue a transparent draw through an offscreen sentinel. The target tags and shaders remain unchanged in that reference. The speed comparison supplies the **same correct light matrix** to both renderers, so missing shadows in the old production camera cannot create an unfair performance advantage.

The JSON reports pass/fail separately from timing. Selector names and argument values are validated; an unknown selector cannot produce an empty passing run. Expected comparison counts, unique case identities, nonempty coverage, and complete sample counts are checked explicitly. A missing visibility snapshot, mismatched input count, or insufficient capacity fails the run. The rope case has an explicit pixel-only oracle exception because its matrices are generated on the GPU. Every shadow-cache check asserts both the expected cache reuse state and the expected number of shadow passes, in addition to pixel parity. A run with failed image, visibility, quality, coverage, or GPU validation gates does not qualify a speedup. The bootstrap interval describes within-run paired variability; it does not estimate performance on other GPUs.

## Recorded result

The committed [software.json](results/software.json) contains the final 2026-11-01 SwiftShader comparison: 84 image comparisons, 20 independent visibility checks plus the documented rope exception, 25 cache checks, three visual corrections and 24 timing comparisons all passed. The [default.json](results/default.json) records that the ordinary browser profile returned no adapter. See the [research and results report](../../docs/NANITE_RENDERING_REVIEW.md) for timing tables, uncertainty, selected defaults and release limitations.

To regenerate the latency chart from the saved data without running a benchmark, use Python with Matplotlib and NumPy installed:

```sh
python benchmarks/rendering/plot-results.py
```

The plot uses the six `candidate-default` comparisons only. Its right panel shows the median of paired speed ratios, which is a different statistic from the ratio of the two median times in the left panel.
