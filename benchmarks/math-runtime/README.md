# Math runtime benchmarks

This harness compares the existing water solver's original scalar/SIMD WebAssembly exports, a JavaScript reference, and an optional GPU-resident implementation. It also checks direct resident rendering and measures the actual old/current uploadSurface methods. These are scoped experiments; they do not measure full application FPS, operating-system efficiency, or a theorem-derived speedup.

## Recovery and evidence

The scratch environment reset during persistence. The original raw timing JSON files were lost. Harness sources were recovered from retained source payloads, and the original renderer fixture was regenerated from its exact pinned Git blob. Fresh result files identify their creation time, browser/runtime, adapter, source hashes, settings, and recovery note. Fresh runs supersede the lost raw samples. No old raw samples have been synthesized.

## Fresh results, 2026-10-31

The retained raw reports are [Node CPU](results/node-cpu.json), [explicit software browser](results/browser-software.json), [ordinary browser availability](results/browser-default.json), and [offscreen renderer plus upload overhead](results/render-parity-offscreen-software.json). Chromium 141.0.7390.37 exposed SwiftShader as a fallback adapter only under the explicit software profile; the ordinary profile returned no adapter. Hardware acceleration and canvas presentation remain unqualified.

All 140 main browser comparisons passed. Original scalar WASM, SIMD WASM and GPU results exactly matched the elementary-f32 reference at every recorded checkpoint, including both retained banks. The maximum absolute difference against the JavaScript arithmetic reference was 6.034970283508301e-7. All 15 additional narrow-grid/mixed-parameter/reset comparisons passed. These results qualify the tested fixtures only.

The same software-browser run measured these per-step medians in milliseconds (21 samples after five warmup batches):

| Grid | JavaScript | Original scalar WASM | Original SIMD WASM | WebGPU wall completion | WebGPU timestamp |
|---|---:|---:|---:|---:|---:|
| 48 × 40 | 0.027188 | 0.009688 | 0.005313 | 1.349375 | 1.222143 |
| 96 × 80 | 0.070313 | 0.034687 | 0.015937 | 0.728438 | 0.617165 |
| 256 × 256 | 0.678750 | 0.331250 | 0.178750 | 3.422500 | 3.158590 |
| 512 × 512 | 2.598750 | 1.100000 | 0.622500 | 11.232500 | 10.814513 |

SwiftShader was substantially slower than the existing SIMD kernel. Samples contain scheduling variability and outliers; the nonmonotonic small-grid measurements and raw p95/p99 values should be retained when interpreting them. This run establishes no hardware speedup. At 96×80, GPU encoding/submission CPU time had a 0.0140625 ms median, while synchronized completion had a 0.7284375 ms median; submitting work is not equivalent to finishing it.

Offscreen rendering produced exact pixel equality at 0, 1 and 4 steps, with respectively 15,116, 15,107 and 15,108 water-covered pixels against the background. Both malformed-input cases rejected to background-only output. Restored BC4 noise and ASTC atlas assets loaded; no procedural material fallback, console/page errors or uncaptured GPU validation errors were recorded.

The actual uploadSurface method comparison showed no CPU improvement in this run. Unchanged-frame p50 was 0.000517578 ms for the pinned original and 0.000644531 ms for the current method. Advancing-frame p50 was 0.006562500 ms and 0.007187500 ms respectively. Both paths reported the expected 92,160 dynamic bytes per advancing call, and the current planner computed no metadata nodes inside measured steady-state batches. The differences are observations from one variable shared environment, not a claim about full application performance.


## Run

Use Node 24 or later:

    node benchmarks/math-runtime/run.mjs

This reads public/soft-kernels-scalar.wasm and public/soft-kernels-simd.wasm. Missing binaries remain BLOCKED. --quick reduces samples/checkpoints for a smoke check; --out changes the JSON output; --no-graph skips the graph experiment. --build-root can select a compiled source tree.

For browser execution:

    node benchmarks/math-runtime/serve.mjs

Open http://127.0.0.1:4317/benchmarks/math-runtime/index.html. The localhost-only server serves an explicit resource allowlist, transforms TypeScript, and enables same-origin isolation for finer browser timers. It does not replace project typechecking. BOX3D_BENCH_PORT changes its port.

With Playwright installed:

    node benchmarks/math-runtime/playwright-run.mjs

Use --executable-path /absolute/path/to/chrome if the installed browser differs from Playwright's expected revision. --playwright-path /absolute/path/to/playwright/index.mjs selects another installed Playwright runtime. --url changes the local page. The runner records browser version, arguments, errors, and JSON. Optional --screenshot is internal QA only; screenshots are not performance evidence or requested deliverables.

An ordinary browser without an available adapter reports BLOCKED. The explicit --software-gpu profile adds --enable-unsafe-webgpu and --use-angle=swiftshader for local conformance. It is labeled software and must not be used to claim hardware acceleration. --software-vulkan additionally selects Vulkan composition through SwiftShader for diagnosis. Chromium documents these configurations in [SwiftShader guidance](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/docs/gpu/swiftshader.md) and [headless GPU guidance](https://developer.chrome.com/blog/supercharge-web-ai-testing). The experimental WebGPU flag changes adapter availability and relaxes the adapter blocklist; it is not normal browser configuration. The harness adds no web-security, certificate, or managed-policy override. Playwright uses its standard automation defaults, including its container sandbox configuration, and does not reuse a signed-in browser profile.

## Solver correctness

The deterministic seed initializes six independent Float32 arrays: current height/two velocities and all three destination/history arrays. Boundary history is deliberately nonzero. Every checkpoint checks both banks, step count, finite values, maximum/RMS absolute error, exact matches, and normalized error.

The acceptance rule is:

    abs(actual - expected) <= 0.00002 + 0.0002 * abs(expected)

Both JavaScript arithmetic and elementary f32 rounding are reference baselines. f32 is a diagnostic reference, not a timed optimization. Finite seeded comparisons do not prove all-input equivalence or stability.

| Grid | Steps per timed batch | Correctness checkpoints |
|---|---:|---|
| 48 × 40 | 16 | 1, 2, 8, 64, 256, 1024 |
| 96 × 80 | 16 | 1, 2, 8, 64, 256, 1024 |
| 256 × 256 | 4 | 1, 2, 8, 64 |
| 512 × 512 | 4 | 1, 2, 8, 64 |

Width/depth remain 34/24. Time step decreases where needed with grid spacing. All backends share parameters within a case; costs across grid sizes are per step, not equal intervals of simulated physical time.

Additional 3×3, 3×9 and 9×3 cases encode distinct parameter sets in one encoder and then reset/replay. They address uniform last-write hazards, minimum/narrow-grid boundaries, and complete state restoration. Four ordered phases preserve the original velocity/height/row/column dependencies, including retained destination boundary history and final corner ownership.

Candidates with failed or incomplete numerical validation are excluded from timing. Setup/timing/device failures remain failures. Missing devices/binaries remain explicitly blocked. COMPLETED means the available candidates completed; comparisonCoverage identifies qualification separately for every requested backend.

## Timing and transfers

Defaults are five warmup batches, 21 measured batches and seven transfer samples, with a 120-second solver budget and bounded asynchronous waits. JSON preserves raw samples plus p50/p95/p99/min/max/mean. These percentiles describe the sample set, not confidence bounds. Zero-duration samples are flagged as below clock resolution, not zero work.

CPU timing includes the real kernel call and bank/pointer swap on resident arrays. Allocation, initialization and fixture reset occur outside timing. Original WASM is called directly through soft_water_step. All six allocations precede retaining memory views so memory growth cannot detach earlier views.

GPU timing separates encoding, CPU submission, synchronized wall completion and optional GPU timestamps. Timestamps span first velocity-pass start to final column-pass end across the batch; query resolution is outside the timed completion region. GPU timestamps alone cannot establish end-to-end speedup. CPU completion and GPU wall completion are the corresponding synchronized measurements in this harness.

Six-array uploads and full-state readback are measured separately and excluded from resident kernel timings. These operations are diagnostic costs, not the production renderer's three-array traffic model. Rendering, mesh reconstruction, forcing, floaters, droplets and frame presentation are outside solver timings.

## Renderer integration and actual upload overhead

    node benchmarks/math-runtime/playwright-run.mjs --render-parity --software-gpu --out benchmarks/math-runtime/results/render-parity-offscreen-software.json

The real renderer pipelines run with only the final post-pass attachment redirected to an owned output texture. It matches the renderer viewport/format at sample count 1. At a fixed 320×240 viewport, exact pixels are compared after 0, 1 and 4 steps. Compute, binding of updated buffer parity, and drawing occur in one encoder. The CPU path uploads the exact GPU-readback fields to isolate rendering equality from arithmetic differences; a separate f32 check validates the evolved state.

A background comparison requires visible water coverage, preventing blank-equals-blank success. Alternating CPU/resident paths exercises binding restoration. Truncated height storage and a non-Float32 velocity array must reject even when triangle indices address only a small prefix, producing zero reported bytes and background-only output.

Material source information and console messages are retained. If textures are absent, the renderer may use its explicit procedural fallbacks; that limitation must accompany results. Full canonical assets are used when restored and available. Offscreen parity does not qualify canvas presentation, complete application frame cadence, or hardware performance.

The same run compares the actual original and current uploadSurface methods on the same initialized renderer/resources. Five warmup batches and 21 samples alternate timing order. Unchanged-frame batches contain 1,024 calls; advancing-frame batches contain 16. Cache seeding and queue drains are outside CPU timing. Advancing frameVersion forces three dynamic field uploads, 92,160 bytes at 96×80. Counters check that unchanged metadata does not recompute planning nodes during measured batches.

This is a method-level comparison, not a whole-renderer benchmark. Only the fresh retained raw results above support quantitative claims. First-frame API counters are not exact comparable traffic: the legacy method omits uniform bytes/counts unpadded indices, while the resident method includes metadata bytes.

## Pinned baseline fixture

baseline-renderer.mjs is self-contained within this repository. It contains the pinned original renderer after Node TypeScript transformation and relocation of its single runtime asset import. baseline-renderer-provenance.json records original and generated hashes. No research-directory dependency remains.

Regenerate with:

    node benchmarks/math-runtime/prepare-baseline.mjs

Or provide an exact local source:

    node benchmarks/math-runtime/prepare-baseline.mjs --source /path/to/renderer.ts

The generator checks Git blob e75d39fa091f3b91665c967dcfe548a86d8a0352 and SHA-256 af5b3beac1f02f4e6d75e383270151c7679a473fac196b576ff59085c6e3b03f before writing. It accepts removal of one tool-appended LF only when doing so restores the exact pinned blob.

Source: [original renderer](https://github.com/nathansenn/box3d-WEBGPU/blob/dfedd9fe9983200f492d686488d27b6a4b11c650/src/webgpu/renderer.ts).

Original WASM binary SHA-256 values:

| Variant | Bytes | SHA-256 |
|---|---:|---|
| Scalar | 3,926 | 99893fdaf3c94214ef952cd1e0d592242f2b06618480741c00630495854286b6 |
| SIMD | 6,216 | 8744df67b629cca4f15e9ff375723d9b6b2d5411df664c42642ec461c2e10c31 |

Both are from the same pinned commit dfedd9fe9983200f492d686488d27b6a4b11c650.

## Dependency graph experiment

The separate eager-reference experiment computes bounds/checksum over 65,536 vertices and a small camera-dependent output. It uses unchanged, camera-only and geometry-changing scenarios, eight untimed full-vector checks, exact final values/checksums, and work counters.

Unchanged inputs demonstrate skipped work. Geometry changes reveal graph overhead when all work must execute. Large ratios against deliberately eager calculation are not improvements over an existing renderer that already caches values. Use the actual uploadSurface comparison to assess the implemented renderer change.

## Reproducibility

Results include seeds, fixture hashes, settings hashes, measured source hashes, original WASM hashes, adapter/runtime information and raw timing samples. Keep devices/profiles separate. Re-run after source changes and retain JSON with every claim. Hardware qualification, browser presentation and full-frame performance remain separate gates.

